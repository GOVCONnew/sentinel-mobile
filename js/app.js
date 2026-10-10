/* SENTINEL Mobile — app controller: camera, scheduling, motion, audio, event log, field test, export, UI. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var DEFAULTS = { model: 'lite_mobilenet_v2', thr: 0.5, classes: SCore.DEFAULT_CLASSES.slice(), sens: 60, mtrig: 3, heat: false, roi: 'off',
    roiBox: null, roiGrid: new Array(16).fill(1), audio: true, athr: 0.3, watch: ['Bird', 'Chainsaw', 'Gunshot', 'Vehicle', 'Dog', 'Speech', 'Footsteps'],
    deb: 10, snap: true, geo: false, low: false };
  var S = SStore.loadSettings(DEFAULTS), events = SStore.loadEvents();
  var field = SStore.loadField() || { name: 'Field session', objects: [{ desc: 'person', cls: 'person' }, { desc: 'dog', cls: 'dog' }, { desc: 'backpack', cls: 'backpack' }], trials: [], dur: 15 };
  var caps = {}, stream = null, running = false, started = false, mic = null, audioOk = false, audioMsg = '';
  var tracker = new SCore.Tracker({ minHits: 2, maxAgeMs: 2500 }), deb = new SCore.Debouncer(S.deb * 1000);
  var detFps = 0, lastDetDone = 0, lastDets = [], fpsEMA = 0, lastFrameT = 0, detMs = 0, lastDetT = 0, busy = false, lastAudioT = 0, lastMotT = 0, topSound = null;
  var MW = 80, MH = 60, mcan = document.createElement('canvas'), mctx; mcan.width = MW; mcan.height = MH; mctx = mcan.getContext('2d', { willReadFrequently: true });
  var prevGray = null, refGray = null, motionPct = 0, motionMask = null, scene = null, geo = null, geoWatch = null, trial = null, roiEdit = false;
  var video = $('cam'), ov = $('overlay'), octx = ov.getContext('2d');
  window.__sentinel = { S: S, events: function () { return events; }, field: function () { return field; }, state: function () { return { running: running, motionPct: motionPct, scene: scene, topSound: topSound, detMs: detMs, fps: detFps, renderFps: fpsEMA, lastDets: lastDets, audioOk: audioOk, audioMsg: audioMsg, backend: window.tf && tf.getBackend(), micMode: mic && mic.mode, idb: SStore.idbOk() }; } };

  function save() { S.deb = +S.deb || 10; deb.ms = S.deb * 1000; SStore.saveSettings(S); }
  function toast(t, ms) { var e = $('toast'); e.textContent = t; e.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(function () { e.classList.add('hidden'); }, ms || 2200); }
  function status(s) { $('status').textContent = s; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------- capabilities ----------
  function detectCaps() {
    caps = { https: isSecureContext, media: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia), webgl: SDet.hasWebGL(),
      audio: !!(window.AudioContext || window.webkitAudioContext), worklet: !!(window.AudioWorkletNode), idb: !!window.indexedDB,
      share: !!(navigator.share && navigator.canShare), geo: !!navigator.geolocation, wakeLock: 'wakeLock' in navigator, zip: !!window.JSZip };
    var txt = Object.keys(caps).map(function (k) { return (caps[k] ? '✓ ' : '✗ ') + k; }).join('  ');
    $('caps').textContent = txt; $('help-env').textContent = 'This device: ' + txt;
    if (!caps.https) $('caps').textContent += ' — NOT HTTPS: camera/mic blocked. Open the GitHub Pages URL.';
  }

  // ---------- tabs ----------
  function showTab(name) {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.id === 'tab-' + name); });
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    if (name === 'log') renderLog(); if (name === 'field') renderField(); if (name === 'live') resize();
  }
  document.querySelectorAll('#tabs button').forEach(function (b) { b.onclick = function () { showTab(b.dataset.tab); }; });
  $('btn-splash-help').onclick = function () { $('splash').classList.add('hidden'); showTab('help'); if (!started) { var bk = document.createElement('button'); bk.className = 'btn primary'; bk.textContent = 'BACK TO START'; bk.onclick = function () { $('splash').classList.remove('hidden'); bk.remove(); }; $('tab-help').prepend(bk); } };

  // ---------- settings UI ----------
  function bindRange(id, key, fmt) { var e = $(id); e.value = S[key]; var v = $(id + '-v'), up = function () { S[key] = +e.value; v.textContent = fmt(S[key]); save(); }; e.oninput = up; v.textContent = fmt(S[key]); }
  function bindChk(id, key, cb) { var e = $(id); e.checked = !!S[key]; e.onchange = function () { S[key] = e.checked; save(); cb && cb(); }; }
  function buildSettings() {
    $('s-model').value = S.model;
    $('s-model').onchange = async function () { S.model = this.value; save(); toast('Loading ' + S.model + '…'); try { await SDet.loadModel(S.model, status); toast('Model ready: ' + S.model); } catch (e) { toast('Model load failed'); } };
    bindRange('s-thr', 'thr', function (v) { return Math.round(v * 100) + '%'; });
    bindRange('s-sens', 'sens', function (v) { return v + ' (Δ>' + SCore.diffThreshold(v) + ')'; });
    bindRange('s-mtrig', 'mtrig', function (v) { return v + '%'; });
    bindRange('s-athr', 'athr', function (v) { return Math.round(v * 100) + '%'; });
    bindChk('s-heat', 'heat', syncBtns); bindChk('s-snap', 'snap'); bindChk('s-low', 'low');
    bindChk('s-geo', 'geo', setupGeo); bindChk('s-audio', 'audio', function () { if (S.audio && started) startAudio(); else stopAudio(); });
    $('s-deb').value = S.deb; $('s-deb').onchange = function () { S.deb = +this.value; save(); };
    $('s-roi').value = S.roi; $('s-roi').onchange = function () { S.roi = this.value; save(); syncBtns(); };
    $('s-roi-clear').onclick = function () { S.roiBox = null; S.roiGrid = new Array(16).fill(1); save(); toast('ROI reset'); };
    if (!SStore.idbOk()) { $('s-snap').checked = false; $('s-snap').disabled = true; S.snap = false; $('s-snap').parentNode.append(' — unavailable (no IndexedDB)'); }
    // class checklist
    var host = $('s-classes'); host.innerHTML = '';
    Object.keys(SCore.GROUPS).forEach(function (g) {
      var d = document.createElement('details'); d.className = 'group'; d.open = g !== 'Other';
      d.innerHTML = '<summary>' + g + ' <button class="btn sm" data-a="all">ALL</button> <button class="btn sm" data-a="none">NONE</button></summary><div class="grid"></div>';
      SCore.GROUPS[g].forEach(function (c) { var l = document.createElement('label'); l.className = 'chk'; l.innerHTML = '<input type="checkbox" value="' + c + '"' + (S.classes.indexOf(c) >= 0 ? ' checked' : '') + '>' + c; d.querySelector('.grid').append(l); });
      d.addEventListener('change', readClasses);
      d.querySelectorAll('summary button').forEach(function (b) { b.onclick = function (ev) { ev.preventDefault(); d.querySelectorAll('input').forEach(function (i) { i.checked = b.dataset.a === 'all'; }); readClasses(); }; });
      host.append(d);
    });
    renderWatch();
    $('s-watch-add').onclick = function () { var v = $('s-watch-new').value.trim(); if (v && S.watch.indexOf(v) < 0) { S.watch.push(v); save(); renderWatch(); } $('s-watch-new').value = ''; };
    $('s-env').textContent = 'Backend: ' + (window.tf ? tf.getBackend() : '-') + ' · mic: ' + (mic ? mic.mode : 'off') + ' · ' + (audioMsg || '');
  }
  function readClasses() { S.classes = Array.from(document.querySelectorAll('#s-classes input:checked')).map(function (i) { return i.value; }); save(); }
  function renderWatch() {
    var h = $('s-watch'); h.innerHTML = '';
    S.watch.forEach(function (w, i) { var c = document.createElement('span'); c.className = 'chip on'; c.innerHTML = esc(w) + ' <span class="x">×</span>'; c.querySelector('.x').onclick = function () { S.watch.splice(i, 1); save(); renderWatch(); }; h.append(c); });
  }

  // ---------- camera ----------
  async function startCamera(withMic) {
    var v = { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } };
    try { stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: withMic }); }
    catch (e) { if (withMic) { console.warn('cam+mic failed, retrying video only', e); audioMsg = 'Microphone unavailable/denied: ' + e.name; stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false }); } else throw e; }
    video.srcObject = stream; await video.play();
    await new Promise(function (r) { if (video.videoWidth) r(); else video.onloadedmetadata = r; });
    resize();
  }
  function resize() { var r = ov.getBoundingClientRect(), d = window.devicePixelRatio || 1; ov.width = Math.max(1, r.width * d); ov.height = Math.max(1, r.height * d); octx.setTransform(d, 0, 0, d, 0, 0); }
  window.addEventListener('resize', resize); window.addEventListener('orientationchange', function () { setTimeout(resize, 300); });

  // ---------- wake lock ----------
  var wakeLock = null;
  async function keepAwake() { try { if ('wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', function () { wakeLock = null; }); } } catch (e) {} try { await $('nosleep').play(); } catch (e) {} }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && started) {
      keepAwake();
      if (stream && stream.getVideoTracks().some(function (t) { return t.readyState === 'ended'; })) { toast('Camera was suspended — restarting'); startCamera(S.audio && caps.audio).then(function () { if (S.audio) startAudio(); }).catch(function () {}); }
      if (mic && mic.ctx && mic.ctx.state !== 'running') mic.ctx.resume();
    }
  });

  // ---------- geolocation ----------
  function setupGeo() {
    if (geoWatch != null) { navigator.geolocation.clearWatch(geoWatch); geoWatch = null; geo = null; }
    if (!S.geo) return; if (!caps.geo) { toast('Geolocation not supported'); return; }
    geoWatch = navigator.geolocation.watchPosition(function (p) { geo = { lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy) }; },
      function (e) { toast('Location ' + (e.code === 1 ? 'denied' : 'unavailable') + ' — events logged without GPS'); geo = null; }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  }

  // ---------- audio ----------
  async function startAudio() {
    var el = $('sound-panel');
    if (!S.audio) { el.innerHTML = '<div class="muted">Sound classification disabled in Settings.</div>'; return; }
    try {
      if (!caps.audio) throw new Error('WebAudio not supported on this browser');
      var at = stream && stream.getAudioTracks()[0];
      if (!at || at.readyState === 'ended') {
        try { var as = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); at = as.getAudioTracks()[0]; stream.addTrack(at); }
        catch (e) { throw new Error('Microphone unavailable or denied (' + e.name + '). Enable it in Settings › Safari › Microphone.'); }
      }
      if (mic) mic.stop(); mic = new SAudio.Mic(); await mic.start(new MediaStream([at]));
      if (!SAudio.isReady()) { el.innerHTML = '<div class="muted">Loading YAMNet sound model (~16 MB, cached after first load)…</div>'; await SAudio.load(); }
      audioOk = true; audioMsg = 'YAMNet ready (' + mic.mode + ', ' + mic.rate + ' Hz → 16 kHz)'; el.innerHTML = '<div class="muted">' + audioMsg + ' — listening…</div>';
    } catch (e) {
      console.warn('audio disabled', e); audioOk = false; audioMsg = 'Sound panel disabled: ' + e.message;
      el.innerHTML = '<div class="muted" style="color:var(--warn)">⚠ ' + esc(audioMsg) + '</div>'; $('h-sound').textContent = '🔇 off';
    }
  }
  function stopAudio() { if (mic) mic.stop(); mic = null; audioOk = false; $('sound-panel').innerHTML = '<div class="muted">Sound classification off.</div>'; $('h-sound').textContent = '🔇 off'; }
  async function audioStep(now) {
    if (!audioOk || !mic || !mic.ready()) return;
    busy = true;
    try {
      var r = await SAudio.classify(mic.buf, 3); topSound = r.top[0]; topSound.ms = r.ms;
      $('sound-panel').innerHTML = r.top.map(function (t) { return '<div class="srow"><span>' + esc(t.label) + '</span><div class="bar"><i style="width:' + Math.round(t.score * 100) + '%"></i></div><b>' + Math.round(t.score * 100) + '%</b></div>'; }).join('') + '<div class="muted mono">YAMNet ' + Math.round(r.ms) + ' ms</div>';
      $('h-sound').textContent = '🔊 ' + topSound.label + ' ' + Math.round(topSound.score * 100) + '%';
      r.top.forEach(function (t) {
        if (t.score < S.athr) return;
        S.watch.forEach(function (w) {
          if (t.label.toLowerCase().indexOf(w.toLowerCase()) >= 0 && deb.ok('sound:' + w, now)) logEvent('sound', w, t.score, 'YAMNet: ' + t.label);
        });
      });
    } catch (e) { console.warn('audio step', e); }
    busy = false;
  }

  // ---------- motion ----------
  function motionStep() {
    if (!video.videoWidth) return;
    mctx.drawImage(video, 0, 0, MW, MH);
    var g = SCore.toGray(mctx.getImageData(0, 0, MW, MH).data, MW, MH), roi = currentRoi();
    if (prevGray) { var m = SCore.motion(prevGray, g, MW, MH, S.sens, roi); motionPct = m.pct; motionMask = m.mask; }
    prevGray = g; scene = refGray ? SCore.sceneChange(refGray, g, roi, MW, MH) : null;
    var now = performance.now();
    if (motionPct >= S.mtrig && deb.ok('motion', now)) logEvent('motion', 'motion', motionPct / 100, 'motion ' + motionPct.toFixed(1) + '%' + (scene ? ', scene Δ ' + scene.meanPct.toFixed(1) + '%' : '') + (roi ? ' (ROI)' : ''));
    $('h-mot').textContent = motionPct.toFixed(1) + '%'; $('m-mot').style.width = Math.min(100, motionPct * 3) + '%'; $('m-mot-v').textContent = motionPct.toFixed(1) + '%';
    if (scene) { $('m-scene').style.width = Math.min(100, scene.changedPct) + '%'; $('m-scene-v').textContent = scene.meanPct.toFixed(1) + '% / ' + scene.changedPct.toFixed(0) + '%'; }
    if (mic) { var db = 20 * Math.log10(mic.level + 1e-8); $('m-lvl').style.width = Math.max(0, Math.min(100, (db + 70) / 70 * 100)) + '%'; $('m-lvl-v').textContent = db.toFixed(0) + ' dB'; }
  }
  function currentRoi() {
    if (S.roi === 'box' && S.roiBox) return { type: 'box', x: S.roiBox.x, y: S.roiBox.y, w: S.roiBox.w, h: S.roiBox.h };
    if (S.roi === 'grid') return { type: 'grid', cols: 4, rows: 4, cells: S.roiGrid };
    return null;
  }
  // ROI editing on the overlay. Coordinates are stored as fractions of the SOURCE frame (object-fit cover aware).
  function viewToSrcFrac(px, py) { var r = ov.getBoundingClientRect(), T = SDet.coverTransform(video.videoWidth || 1, video.videoHeight || 1, r.width, r.height); return { x: Math.max(0, Math.min(1, (px - r.left - T.ox) / T.s / (video.videoWidth || 1))), y: Math.max(0, Math.min(1, (py - r.top - T.oy) / T.s / (video.videoHeight || 1))) }; }
  var drag = null;
  $('stage').addEventListener('pointerdown', function (e) {
    if (!roiEdit) return; var p = viewToSrcFrac(e.clientX, e.clientY);
    if (S.roi === 'grid') { var i = Math.min(3, Math.floor(p.y * 4)) * 4 + Math.min(3, Math.floor(p.x * 4)); S.roiGrid[i] = S.roiGrid[i] ? 0 : 1; save(); }
    else { S.roi = 'box'; $('s-roi').value = 'box'; drag = p; }
  });
  $('stage').addEventListener('pointermove', function (e) { if (!drag) return; var p = viewToSrcFrac(e.clientX, e.clientY); S.roiBox = { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) }; });
  window.addEventListener('pointerup', function () { if (drag) { drag = null; if (S.roiBox && (S.roiBox.w < 0.03 || S.roiBox.h < 0.03)) S.roiBox = null; save(); prevGray = null; } });

  // ---------- detection ----------
  async function detStep(now) {
    busy = true;
    try {
      var t0 = performance.now();
      var dets = await SDet.detect(video, video.videoWidth, video.videoHeight, { minScore: S.thr, classes: new Set(S.classes), longSide: S.low ? 256 : 320 });
      if (lastDetDone) detFps = detFps ? detFps * 0.8 + 200 / Math.max(1, now - lastDetDone) : 1000 / Math.max(1, now - lastDetDone); lastDetDone = now;
      detMs = detMs ? detMs * 0.8 + (performance.now() - t0) * 0.2 : performance.now() - t0; lastDets = dets;
      var fresh = tracker.update(dets, now);
      if (trial) dets.forEach(function (d) { trial.dets.push({ label: d.cls, score: +d.score.toFixed(4), t: Date.now() }); });
      fresh.forEach(function (t) { if (deb.ok('obj:' + t.cls + ':' + t.id, now) && deb.ok('objcls:' + t.cls, now)) logEvent('object', t.cls, t.score, 'track #' + t.id); });
    } catch (e) { console.warn('detect', e); }
    busy = false;
  }

  // ---------- render ----------
  function draw() {
    var r = ov.getBoundingClientRect(), W = r.width, H = r.height; octx.clearRect(0, 0, W, H);
    if (!video.videoWidth) return;
    var T = SDet.coverTransform(video.videoWidth, video.videoHeight, W, H);
    if (S.heat && motionMask) {
      var cw = video.videoWidth / MW * T.s, ch = video.videoHeight / MH * T.s; octx.fillStyle = 'rgba(255,40,0,0.45)';
      for (var i = 0; i < motionMask.length; i++) if (motionMask[i]) octx.fillRect(T.ox + (i % MW) * cw, T.oy + ((i / MW) | 0) * ch, cw + 0.5, ch + 0.5);
    }
    var roi = currentRoi();
    if (roi || roiEdit) {
      octx.save(); octx.strokeStyle = '#FFB000'; octx.setLineDash([6, 4]); octx.lineWidth = 2;
      var VW = video.videoWidth * T.s, VH = video.videoHeight * T.s;
      if (S.roi === 'grid') for (var c = 0; c < 16; c++) { var gx = T.ox + (c % 4) * VW / 4, gy = T.oy + ((c / 4) | 0) * VH / 4; if (!S.roiGrid[c]) { octx.fillStyle = 'rgba(0,0,0,0.55)'; octx.fillRect(gx, gy, VW / 4, VH / 4); } if (roiEdit) octx.strokeRect(gx, gy, VW / 4, VH / 4); }
      else if (S.roiBox) octx.strokeRect(T.ox + S.roiBox.x * VW, T.oy + S.roiBox.y * VH, S.roiBox.w * VW, S.roiBox.h * VH);
      octx.restore();
    }
    var vis = tracker.visible(), counts = {};
    vis.forEach(function (t) { SDet.drawBox(octx, SDet.toView(t.box, T), t, 1); counts[t.cls] = (counts[t.cls] || 0) + 1; });
    $('h-cnt').textContent = vis.length; $('h-counts').textContent = Object.keys(counts).map(function (k) { return k + '×' + counts[k]; }).join('  ');
  }
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!running || !video.videoWidth) return;
    var now = performance.now();
    if (lastFrameT) { var f = 1000 / Math.max(1, now - lastFrameT); fpsEMA = fpsEMA ? fpsEMA * 0.9 + f * 0.1 : f; } lastFrameT = now;
    if (now - lastMotT >= (S.low ? 400 : 120)) { lastMotT = now; motionStep(); }
    // alternate inference: never run detection and audio at the same time; audio gets priority when due
    if (!busy && SDet.isReady()) {
      if (audioOk && now - lastAudioT >= (S.low ? 2000 : 750)) { lastAudioT = now; audioStep(now); }
      else if (now - lastDetT >= (S.low ? 1000 : 0)) { lastDetT = now; detStep(now); }
    }
    draw(); if (trial) trialTick();
    if (((now / 250) | 0) !== loop._k) { loop._k = (now / 250) | 0; $('h-fps').textContent = detFps.toFixed(1); $('h-ms').textContent = Math.round(detMs); }
  }

  // ---------- events ----------
  function snapshotBlob() {
    return new Promise(function (res) {
      var w = video.videoWidth, h = video.videoHeight, k = Math.min(1, 960 / Math.max(w, h)), c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
      var x = c.getContext('2d'); x.drawImage(video, 0, 0, c.width, c.height);
      var T = { s: k, ox: 0, oy: 0 }; tracker.visible().forEach(function (t) { SDet.drawBox(x, SDet.toView(t.box, T), t, 1.2); });
      x.font = '700 14px Calibri, system-ui, sans-serif'; x.fillStyle = '#9ACD32'; x.fillText('NEWTON SENTINEL ' + new Date().toISOString(), 8, c.height - 10);
      c.toBlob(res, 'image/jpeg', 0.8);
    });
  }
  var evSeq = Date.now();
  async function logEvent(type, label, conf, detail) {
    var e = { id: 'ev' + (evSeq++).toString(36), ts: new Date().toISOString(), type: type, label: label, conf: conf != null ? +conf.toFixed(4) : null, detail: detail || '', geo: S.geo && geo ? geo : null, snap: false };
    events.push(e); SStore.saveEvents(events);
    var li = document.createElement('li'); li.textContent = e.ts.slice(11, 19) + ' · ' + type.toUpperCase() + ' · ' + label + (conf != null ? ' ' + Math.round(conf * 100) + '%' : '');
    $('live-events').prepend(li); while ($('live-events').children.length > 6) $('live-events').lastChild.remove();
    if (S.snap && SStore.idbOk() && video.videoWidth) { try { var b = await snapshotBlob(); await SStore.putSnap(e.id, b); e.snap = true; SStore.saveEvents(events); } catch (err) { console.warn('snap', err); } }
    return e;
  }
  var thumbURLs = [];
  async function renderLog() {
    thumbURLs.forEach(URL.revokeObjectURL); thumbURLs = [];
    var types = Array.from(document.querySelectorAll('.lf:checked')).map(function (i) { return i.value; });
    var list = events.filter(function (e) { return types.indexOf(e.type) >= 0; }).slice(-300).reverse(), ul = $('log-list'); ul.innerHTML = '';
    $('log-count').textContent = events.length + ' events';
    for (var i = 0; i < list.length; i++) {
      var e = list[i], li = document.createElement('li');
      li.innerHTML = '<div class="th"></div><div><div><span class="ty ' + e.type + '">' + e.type.toUpperCase() + '</span> <b>' + esc(e.label) + '</b> ' + (e.conf != null ? Math.round(e.conf * 100) + '%' : '') + '</div><div class="t">' + e.ts + '</div><div class="t">' + esc(e.detail) + (e.geo ? ' · ' + e.geo.lat + ',' + e.geo.lon + ' ±' + e.geo.acc + 'm' : '') + '</div></div>';
      ul.append(li);
      if (e.snap) (function (el, id) { SStore.getSnap(id).then(function (b) { if (!b) return; var u = URL.createObjectURL(b); thumbURLs.push(u); el.innerHTML = '<img src="' + u + '" alt="snapshot">'; }).catch(function () {}); })(li.querySelector('.th'), e.id);
    }
  }
  document.querySelectorAll('.lf').forEach(function (c) { c.onchange = renderLog; });
  $('log-clear').onclick = async function () { if (!confirm('Delete all ' + events.length + ' events and snapshots?')) return; events = []; SStore.saveEvents(events); await SStore.clearSnaps(); renderLog(); };

  // ---------- export ----------
  function stamp() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }
  function eventsJSON() { return JSON.stringify({ app: 'Newton SENTINEL Mobile', exported: new Date().toISOString(), settings: { model: S.model, thr: S.thr, sens: S.sens, athr: S.athr }, events: events }, null, 2); }
  function fieldJSON() { return JSON.stringify({ app: 'Newton SENTINEL Mobile', exported: new Date().toISOString(), session: field.name, objects: field.objects, model: S.model, threshold: S.thr, metrics: SCore.fieldMetrics(field.trials), trials: field.trials }, null, 2); }
  function offer(files, host) {
    var h = $(host); h.innerHTML = '';
    files.forEach(function (f) { var a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.textContent = '⬇ ' + f.name; h.append(a); a.click(); });
  }
  async function share(files, host) {
    if (navigator.share && navigator.canShare && navigator.canShare({ files: files })) { try { await navigator.share({ files: files, title: 'SENTINEL export' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    toast('Sharing files not supported here — downloading'); offer(files, host);
  }
  function file(txt, name, type) { return new File([txt], name, { type: type }); }
  async function buildZip() {
    if (!window.JSZip) throw new Error('JSZip not loaded');
    var z = new JSZip(); z.file('events.csv', SCore.eventsCSV(events)); z.file('events.json', eventsJSON());
    if (field.trials.length) { z.file('fieldtest_metrics.csv', SCore.metricsCSV(SCore.fieldMetrics(field.trials))); z.file('fieldtest_trials.csv', SCore.trialsCSV(field.trials)); z.file('fieldtest.json', fieldJSON()); }
    var n = 0; for (var i = 0; i < events.length; i++) if (events[i].snap) { try { var b = await SStore.getSnap(events[i].id); if (b) { z.file('snapshots/' + events[i].id + '.jpg', b); n++; } } catch (e) {} }
    var blob = await z.generateAsync({ type: 'blob' }); return { file: new File([blob], 'sentinel_' + stamp() + '.zip', { type: 'application/zip' }), snaps: n };
  }
  $('exp-ev-csv').onclick = function () { offer([file(SCore.eventsCSV(events), 'sentinel_events_' + stamp() + '.csv', 'text/csv')], 'dl-links'); };
  $('exp-ev-json').onclick = function () { offer([file(eventsJSON(), 'sentinel_events_' + stamp() + '.json', 'application/json')], 'dl-links'); };
  $('exp-zip').onclick = async function () { try { toast('Building ZIP…'); var z = await buildZip(); offer([z.file], 'dl-links'); toast('ZIP ready (' + z.snaps + ' snapshots)'); } catch (e) { toast('ZIP failed: ' + e.message + ' — use CSV/JSON'); } };
  $('exp-share').onclick = async function () { var fs; try { fs = [(await buildZip()).file]; } catch (e) { fs = [file(SCore.eventsCSV(events), 'sentinel_events.csv', 'text/csv'), file(eventsJSON(), 'sentinel_events.json', 'application/json')]; } share(fs, 'dl-links'); };
  function ftFiles() { var m = SCore.fieldMetrics(field.trials), s = stamp(); return [file(SCore.metricsCSV(m), 'sentinel_fieldtest_metrics_' + s + '.csv', 'text/csv'), file(SCore.trialsCSV(field.trials), 'sentinel_fieldtest_trials_' + s + '.csv', 'text/csv')]; }
  $('ft-csv').onclick = function () { offer(ftFiles(), 'ft-links'); };
  $('ft-json').onclick = function () { offer([file(fieldJSON(), 'sentinel_fieldtest_' + stamp() + '.json', 'application/json')], 'ft-links'); };
  $('ft-share').onclick = function () { share(ftFiles().concat([file(fieldJSON(), 'sentinel_fieldtest.json', 'application/json')]), 'ft-links'); };

  // ---------- field test ----------
  function saveField() { SStore.saveField(field); }
  function allCocoOptions(sel) { return Object.keys(SCore.GROUPS).map(function (g) { return '<optgroup label="' + g + '">' + SCore.GROUPS[g].map(function (c) { return '<option' + (c === sel ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</optgroup>'; }).join(''); }
  function fmt(v, pct) { return v == null ? '—' : pct ? (v * 100).toFixed(0) + '%' : v; }
  function renderField() {
    $('ft-name').value = field.name; $('ft-dur').value = field.dur;
    var h = $('ft-objects'); h.innerHTML = '';
    field.objects.forEach(function (o, i) { var c = document.createElement('div'); c.className = 'chip'; c.innerHTML = esc(o.desc) + ' → <b>' + esc(o.cls) + '</b> <span class="x">×</span>'; c.querySelector('.x').onclick = function () { field.objects.splice(i, 1); saveField(); renderField(); }; h.append(c); });
    if (!$('ft-new-cls').options.length) $('ft-new-cls').innerHTML = allCocoOptions('person');
    var t = $('ft-truth'); if (!trial) { t.innerHTML = ''; field.objects.forEach(function (o) { var l = document.createElement('label'); l.className = 'chip'; l.innerHTML = '<input type="checkbox" value="' + esc(o.cls) + '"> ' + esc(o.desc); t.append(l); }); }
    var m = SCore.fieldMetrics(field.trials), rows = Object.keys(m.classes).map(function (k) { return [k, m.classes[k]]; }).concat(field.trials.length ? [['OVERALL', m.overall]] : []);
    $('ft-table').innerHTML = '<tr><th>CLASS</th><th>TP</th><th>FP</th><th>FN</th><th>PREC</th><th>RECALL</th><th>F1</th><th>MEAN CONF</th><th>TTFD s</th></tr>' +
      (rows.length ? rows.map(function (r) { var k = r[1]; return '<tr><td>' + esc(r[0]) + '</td><td>' + k.tp + '</td><td>' + k.fp + '</td><td>' + k.fn + '</td><td>' + fmt(k.precision, 1) + '</td><td>' + fmt(k.recall, 1) + '</td><td>' + fmt(k.f1, 1) + '</td><td>' + fmt(k.meanConf, 1) + '</td><td>' + (k.meanTTFDms == null ? '—' : (k.meanTTFDms / 1000).toFixed(2)) + '</td></tr>'; }).join('') : '<tr><td colspan="9" class="muted">No trials yet</td></tr>');
    $('ft-trials').innerHTML = '<tr><th>#</th><th>PRESENT</th><th>DETECTED</th><th>MARKS</th><th>DUR s</th></tr>' + field.trials.map(function (tr) {
      return '<tr><td>' + tr.id + '</td><td>' + esc(Object.keys(tr.truth).filter(function (k) { return tr.truth[k]; }).join(', ') || '(none)') + '</td><td>' + esc(Array.from(new Set(tr.dets.map(function (d) { return d.label; }))).join(', ') || '(none)') + '</td><td>' + esc((tr.marks || []).map(function (m) { return m.kind + ':' + m.label; }).join(', ')) + '</td><td>' + (tr.end ? ((tr.end - tr.start) / 1000).toFixed(0) : '…') + '</td></tr>'; }).join('');
  }
  $('ft-name').onchange = function () { field.name = this.value; saveField(); };
  $('ft-dur').onchange = function () { field.dur = Math.max(3, +this.value || 15); saveField(); };
  $('ft-add').onclick = function () { var d = $('ft-new-desc').value.trim() || $('ft-new-cls').value; field.objects.push({ desc: d, cls: $('ft-new-cls').value }); $('ft-new-desc').value = ''; saveField(); renderField(); };
  $('ft-reset').onclick = function () { if (confirm('Clear all trials in this session?')) { field.trials = []; saveField(); renderField(); } };
  function startTrial() {
    if (!running) { toast('Start the camera first (Live tab)'); return; }
    var truth = {}; document.querySelectorAll('#ft-truth input').forEach(function (i) { truth[i.value] = truth[i.value] || i.checked; });
    trial = { id: field.trials.length + 1, start: Date.now(), end: null, dur: field.dur * 1000, truth: truth, dets: [], marks: [] };
    field.trials.push(trial); saveField();
    $('trial-num').textContent = trial.id; $('trialbar').classList.remove('hidden'); $('ft-start').disabled = true; $('ft-stop').disabled = false;
    $('mark-label').innerHTML = Array.from(new Set(field.objects.map(function (o) { return o.cls; }).concat(S.classes))).map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    $('ft-status').textContent = 'Trial ' + trial.id + ' running…'; showTab('live');
  }
  function stopTrial() {
    if (!trial) return; trial.end = Date.now(); saveField();
    $('ft-status').textContent = 'Trial ' + trial.id + ' done: ' + trial.dets.length + ' raw detections.'; trial = null;
    $('trialbar').classList.add('hidden'); $('ft-start').disabled = false; $('ft-stop').disabled = true; toast('Trial complete — see Field Test'); renderField();
  }
  function trialTick() { var left = trial.start + trial.dur - Date.now(); $('trial-left').textContent = Math.max(0, Math.ceil(left / 1000)); if (left <= 0) stopTrial(); }
  $('ft-start').onclick = startTrial; $('ft-stop').onclick = stopTrial;
  function mark(kind) {
    var l = $('mark-label').value; if (trial) { trial.marks.push({ kind: kind, label: l, t: Date.now() }); saveField(); }
    logEvent('manual', 'mark ' + kind + ': ' + l, null, trial ? 'trial ' + trial.id : ''); toast('Marked ' + kind.toUpperCase() + ' · ' + l);
  }
  $('btn-mark-fp').onclick = function () { mark('fp'); }; $('btn-mark-miss').onclick = function () { mark('miss'); };

  // ---------- live buttons ----------
  function syncBtns() { $('btn-heat').classList.toggle('on', S.heat); $('s-heat').checked = S.heat; $('btn-roi').classList.toggle('on', roiEdit || S.roi !== 'off'); $('btn-run').textContent = running ? 'PAUSE' : 'RESUME'; $('roi-hint').classList.toggle('hidden', !roiEdit); $('roi-hint').textContent = S.roi === 'grid' ? 'ROI: tap grid cells to include/exclude, then tap ROI to finish' : 'ROI: drag a box on the view, then tap ROI to finish'; }
  $('btn-heat').onclick = function () { S.heat = !S.heat; save(); syncBtns(); };
  $('btn-roi').onclick = function () { if (!roiEdit && S.roi === 'off') { S.roi = 'box'; $('s-roi').value = 'box'; } roiEdit = !roiEdit; save(); syncBtns(); };
  $('btn-ref').onclick = function () { if (prevGray) { refGray = prevGray.slice(); toast('Reference frame set'); logEvent('manual', 'reference set', null, 'scene-change reference frame'); } };
  $('btn-snap').onclick = function () { var o = S.snap; S.snap = SStore.idbOk(); logEvent('manual', 'snapshot', null, 'manual snapshot').then(function () { S.snap = o; toast(SStore.idbOk() ? 'Snapshot saved' : 'Logged (no IndexedDB → no image)'); }); };
  $('btn-run').onclick = function () { running = !running; if (running) { video.play(); tracker.reset(); } syncBtns(); };

  // ---------- boot ----------
  async function boot() {
    detectCaps(); await SStore.init(); buildSettings(); syncBtns();
    $('splash-mic').checked = S.audio; if (!caps.audio) { $('splash-mic').checked = false; $('splash-mic').disabled = true; }
    if (!window.tf || !window.cocoSsd) { status('CDN LOAD FAILED — check connection'); return; }
    try { await SDet.loadModel(S.model, status); status('READY · ' + tf.getBackend().toUpperCase() + ' · TAP START'); }
    catch (e) { console.error(e); status('MODEL LOAD FAILED: ' + e.message); }
  }
  $('btn-start').onclick = async function () {
    if (!caps.media) { status('CAMERA API UNAVAILABLE' + (caps.https ? '' : ' — PAGE MUST BE HTTPS')); return; }
    S.audio = $('splash-mic').checked; $('s-audio').checked = S.audio; save();
    status('STARTING CAMERA…'); keepAwake();
    // create/resume audio context synchronously-ish within gesture is handled by Mic.start
    try { await startCamera(S.audio); }
    catch (e) { status('CAMERA ' + (e.name === 'NotAllowedError' ? 'DENIED — see Help' : 'ERROR: ' + e.name)); return; }
    started = true; running = true; $('splash').classList.add('hidden'); showTab('live'); syncBtns(); setupGeo();
    if (!SDet.isReady()) { try { await SDet.loadModel(S.model, status); } catch (e) { toast('Detector failed to load'); } }
    startAudio().then(function () { $('s-env').textContent = 'Backend: ' + tf.getBackend() + ' · mic: ' + (mic ? mic.mode : 'off') + ' · ' + audioMsg; });
  };
  requestAnimationFrame(loop); boot();
})();
