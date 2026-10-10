/* SENTINEL Mobile 2.0 — app controller.
 * Pipeline: camera → [motion engine @160x120, ~10 Hz] → motion cue raises detector rate →
 * [detector RAW candidates] → [tracker: CONFIRMED tracks, rejection reasons] → [zones] → events → incidents.
 * Audio: mic → 16 kHz → YAMNet (0.5 s hop) → smoother/baseline → watch events → incidents (co-occurrence only).
 * All data stays on the device. */
(function () {
  'use strict';
  var VERSION = '2.0.0';
  var $ = function (id) { return document.getElementById(id); };
  var ACAT = {}; Object.keys(SAudioLogic.CATS).forEach(function (k) { ACAT[k] = { thr: SAudioLogic.CATS[k].thr, minWin: SAudioLogic.CATS[k].minWin, on: ['Gunshot', 'Chainsaw', 'Vehicle', 'Dog', 'Speech', 'Footsteps', 'Scream'].indexOf(k) >= 0 }; });
  var DEFAULTS = { model: 'effdet0', size: 0, adapt: true, iou: 0.5, enh: false, classes: SCore.DEFAULT_CLASSES.slice(), cat: JSON.parse(JSON.stringify(STrack.DEFAULT_CAT)),
    sens: 60, heat: false, malert: false, zones: [], raw: true, audio: true, abase: true, acat: ACAT, deb: 10, gap: 30, snap: true, geo: false, low: false };
  var S = SStore.loadSettings(DEFAULTS); S.acat = Object.assign({}, ACAT, S.acat || {}); S.cat = Object.assign({}, STrack.DEFAULT_CAT, S.cat || {});
  var field = SStore.loadField() || { name: 'Field session', objects: [{ desc: 'person', cls: 'person' }, { desc: 'dog', cls: 'dog' }, { desc: 'backpack', cls: 'backpack' }], trials: [], dur: 15, lab: null };
  var caps = {}, stream = null, running = false, started = false, mic = null, audioOk = false, audioMsg = '', geo = null, geoWatch = null;
  var video = $('cam'), ov = $('overlay'), octx = ov.getContext('2d');
  var tracker = new STrack.Tracker({ cat: S.cat, zones: S.zones, allowedClasses: new Set(S.classes) });
  var MW = 160, MH = 120, mcan = document.createElement('canvas'); mcan.width = MW; mcan.height = MH; var mctx = mcan.getContext('2d', { willReadFrequently: true });
  var engine = new SMotion.Engine(MW, MH, { sens: S.sens }), mstat = null, prevGray = null, refGray = null, scene = null, lastMoverT = -1e9;
  var smoother = null, audioState = null, topSound = null;
  var lastRaw = [], lastSup = [], lastDiag = [], busy = false, lastDetT = 0, lastAudioT = 0, lastMotT = 0, deb = new SCore.Debouncer(S.deb * 1000);
  var stats = { det: [], pre: [], infer: [], post: [], motion: [], audio: [], draw: [], detTimes: [], skipped: 0, ticks: 0, vfc: 0, vfcProcessed: 0, baseline: null, drift: false, adaptLog: [] };
  var gapStart = null, trial = null, zoneEdit = null, labeling = field.lab && !field.lab.end ? field.lab : null;
  var incMgr = new SInc.IncidentManager({ gapMs: S.gap * 1000, motionOpens: S.malert, onChange: function (I) { SStore.putIncident(I); renderIncBar(I); } });
  window.__sentinel = { VERSION: VERSION, S: S, field: function () { return field; }, tracker: tracker, engine: engine, stats: stats, incMgr: incMgr,
    state: function () { var c = SDet2.current(); return { running: running, model: c && c.id, backend: c && c.backend, inputSize: c && c.inputSize, motion: mstat && { fgPct: mstat.fgPct, movers: mstat.movers.length, shift: mstat.shift, gain: mstat.gain }, topSound: topSound, audioOk: audioOk, audioMsg: audioMsg, raw: lastRaw.map(function (d) { return d.cls + ' ' + d.score.toFixed(2); }), diag: lastDiag.map(function (r) { return r.det.cls + ':' + (r.reason || 'ok') + ':' + (r.trackState || ''); }), tracks: tracker.tracks.map(function (t) { return { id: t.id || t.tmpId, label: t.label, state: t.state, zone: t.zone }; }), p50: pct(stats.det, .5), p95: pct(stats.det, .95), detRate: detRate(), incident: incMgr.cur, micMode: mic && mic.mode, idb: SStore.idbOk() }; } };

  function save() { deb.ms = (+S.deb || 10) * 1000; incMgr.gapMs = (+S.gap || 30) * 1000; incMgr.motionOpens = S.malert; tracker.cat = S.cat; tracker.zones = S.zones; tracker.allowedClasses = new Set(S.classes); engine.o.sens = S.sens; SStore.saveSettings(S); }
  function toast(t, ms) { var e = $('toast'); e.textContent = t; e.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(function () { e.classList.add('hidden'); }, ms || 2200); }
  function status(s) { $('status').textContent = s; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pct(a, q) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }
  function push(a, v, n) { a.push(v); if (a.length > (n || 120)) a.shift(); }
  function detRate() { var t = stats.detTimes; return t.length > 1 ? 1000 * (t.length - 1) / (t[t.length - 1] - t[0]) : 0; }
  function fmtPct(v) { return v == null ? '—' : Math.round(v * 100) + '%'; }

  // ---------- capabilities ----------
  async function detectCaps() {
    caps = { https: isSecureContext, media: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia), webgpu: await SDet2.hasWebGPU(), webgl: SDet2.hasWebGL(), wasmSimd: typeof WebAssembly === 'object',
      audio: !!(window.AudioContext || window.webkitAudioContext), worklet: !!window.AudioWorkletNode, idb: !!window.indexedDB, share: !!(navigator.share && navigator.canShare), geo: !!navigator.geolocation,
      wakeLock: 'wakeLock' in navigator, rvfc: 'requestVideoFrameCallback' in HTMLVideoElement.prototype, persist: !!(navigator.storage && navigator.storage.persist) };
    var txt = Object.keys(caps).map(function (k) { return (caps[k] ? '✓ ' : '✗ ') + k; }).join('  ');
    $('caps').textContent = txt + (caps.https ? '' : ' — NOT HTTPS: camera/mic blocked'); $('help-env').textContent = 'SENTINEL ' + VERSION + ' · this device: ' + txt;
  }

  // ---------- tabs ----------
  function showTab(name) {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.id === 'tab-' + name); });
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    if (name === 'log') renderHistory(); if (name === 'field') renderField(); if (name === 'live') resize(); if (name === 'diag') renderDiag();
  }
  document.querySelectorAll('#tabs button').forEach(function (b) { b.onclick = function () { showTab(b.dataset.tab); }; });
  $('btn-splash-help').onclick = function () { $('splash').classList.add('hidden'); showTab('help'); if (!started) { var bk = document.createElement('button'); bk.className = 'btn primary'; bk.textContent = 'BACK TO START'; bk.onclick = function () { $('splash').classList.remove('hidden'); bk.remove(); }; $('tab-help').prepend(bk); } };

  // ---------- settings UI ----------
  function bindRange(id, key, fmt) { var e = $(id); e.value = S[key]; var v = $(id + '-v'), up = function () { S[key] = +e.value; v.textContent = fmt(S[key]); save(); }; e.oninput = up; v.textContent = fmt(S[key]); }
  function bindChk(id, key, cb) { var e = $(id); e.checked = !!S[key]; e.onchange = function () { S[key] = e.checked; save(); cb && cb(); }; }
  function fillSizes() { var M = SDet2.MODELS[S.model]; $('s-size').innerHTML = M.sizes.map(function (s) { return '<option value="' + s + '"' + ((S.size || M.def) === s ? ' selected' : '') + '>' + s + (s === M.def ? ' (default)' : '') + '</option>'; }).join(''); }
  function buildSettings() {
    $('s-model').innerHTML = Object.keys(SDet2.MODELS).map(function (k) { return '<option value="' + k + '">' + SDet2.MODELS[k].label + (k === 'effdet0' ? ' — recommended' : '') + '</option>'; }).join('');
    $('s-model').value = S.model; fillSizes();
    $('s-model').onchange = async function () { S.model = this.value; S.size = 0; save(); fillSizes(); toast('Loading ' + SDet2.MODELS[S.model].label + '…'); try { await SDet2.load(S.model, {}, status); stats.det = []; stats.baseline = null; toast('Model ready'); } catch (e) { toast('Model load failed: ' + e.message); } };
    $('s-size').onchange = function () { S.size = +this.value; save(); SDet2.setInputSize(S.size); stats.det = []; stats.baseline = null; };
    bindChk('s-adapt', 'adapt'); bindChk('s-enh', 'enh'); bindRange('s-iou', 'iou', function (v) { return v.toFixed(2); });
    $('s-enh-note').textContent = 'Off by default: on the benchmark it did not improve accuracy (see docs/V2_RESULTS.md). Try it at dusk.';
    bindRange('s-sens', 'sens', function (v) { return v; });
    bindChk('s-heat', 'heat', syncBtns); bindChk('s-malert', 'malert'); bindChk('s-snap', 'snap'); bindChk('s-low', 'low'); bindChk('s-abase', 'abase', function () { if (smoother) smoother.baseGain = S.abase ? 1 : 0, smoother.ambBoost = S.abase ? 0.2 : 0; });
    bindChk('s-geo', 'geo', setupGeo); bindChk('s-audio', 'audio', function () { if (S.audio && started) startAudio(); else stopAudio(); });
    $('s-deb').value = S.deb; $('s-deb').onchange = function () { S.deb = +this.value; save(); };
    $('s-gap').value = S.gap; $('s-gap').onchange = function () { S.gap = +this.value; save(); };
    if (!SStore.idbOk()) { $('s-snap').checked = false; $('s-snap').disabled = true; S.snap = false; $('s-snap').parentNode.append(' — unavailable (no IndexedDB)'); }
    renderCatTable(); renderAcatTable();
    $('s-cat-reset').onclick = function () { S.cat = JSON.parse(JSON.stringify(STrack.DEFAULT_CAT)); save(); renderCatTable(); };
    var host = $('s-classes'); host.innerHTML = '';
    Object.keys(SCore.GROUPS).forEach(function (g) {
      var d = document.createElement('details'); d.className = 'group'; d.open = g !== 'Other';
      d.innerHTML = '<summary>' + g + ' <button class="btn sm" data-a="all">ALL</button> <button class="btn sm" data-a="none">NONE</button></summary><div class="grid"></div>';
      SCore.GROUPS[g].forEach(function (c) { var l = document.createElement('label'); l.className = 'chk'; l.innerHTML = '<input type="checkbox" value="' + c + '"' + (S.classes.indexOf(c) >= 0 ? ' checked' : '') + '>' + c; d.querySelector('.grid').append(l); });
      d.addEventListener('change', readClasses);
      d.querySelectorAll('summary button').forEach(function (b) { b.onclick = function (ev) { ev.preventDefault(); d.querySelectorAll('input').forEach(function (i) { i.checked = b.dataset.a === 'all'; }); readClasses(); }; });
      host.append(d);
    });
  }
  function readClasses() { S.classes = Array.from(document.querySelectorAll('#s-classes input:checked')).map(function (i) { return i.value; }); save(); }
  function renderCatTable() {
    $('s-cat').innerHTML = '<tr><th>CATEGORY</th><th>THRESHOLD</th><th>N</th><th>of M</th></tr>' + Object.keys(S.cat).map(function (k) { var c = S.cat[k]; return '<tr><td>' + k + '</td><td><input data-k="' + k + '" data-f="thr" type="number" step="0.05" min="0.1" max="0.95" value="' + c.thr + '"></td><td><input data-k="' + k + '" data-f="n" type="number" min="1" max="10" value="' + c.n + '"></td><td><input data-k="' + k + '" data-f="m" type="number" min="1" max="15" value="' + c.m + '"></td></tr>'; }).join('');
    $('s-cat').querySelectorAll('input').forEach(function (i) { i.onchange = function () { var c = S.cat[i.dataset.k]; c[i.dataset.f] = +i.value; if (c.n > c.m) c.m = c.n; save(); }; });
  }
  function renderAcatTable() {
    $('s-acat').innerHTML = '<tr><th>WATCH</th><th>ON</th><th>THRESHOLD</th><th>MIN WINDOWS (0.5 s)</th></tr>' + Object.keys(S.acat).map(function (k) { var c = S.acat[k]; return '<tr><td>' + k + '</td><td><input type="checkbox" data-k="' + k + '" data-f="on"' + (c.on ? ' checked' : '') + '></td><td><input data-k="' + k + '" data-f="thr" type="number" step="0.05" min="0.05" max="0.95" value="' + c.thr + '"></td><td><input data-k="' + k + '" data-f="minWin" type="number" min="1" max="10" value="' + c.minWin + '"></td></tr>'; }).join('');
    $('s-acat').querySelectorAll('input').forEach(function (i) { i.onchange = function () { S.acat[i.dataset.k][i.dataset.f] = i.type === 'checkbox' ? i.checked : +i.value; save(); if (smoother) Object.assign(smoother.cfg[i.dataset.k], S.acat[i.dataset.k]); }; });
  }

  // ---------- camera ----------
  async function startCamera(withMic) {
    var v = { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } };
    try { stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: withMic }); }
    catch (e) { if (withMic) { audioMsg = 'Microphone unavailable/denied: ' + e.name; stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false }); } else throw e; }
    video.srcObject = stream; await video.play();
    await new Promise(function (r) { if (video.videoWidth) r(); else video.onloadedmetadata = r; });
    stream.getVideoTracks().forEach(function (t) { t.onended = function () { beginGap('camera track ended'); }; t.onmute = function () { beginGap('camera muted by system'); }; t.onunmute = function () { endGap(); }; });
    if (caps.rvfc) { var cb = function () { stats.vfc++; video.requestVideoFrameCallback(cb); }; video.requestVideoFrameCallback(cb); }
    resize();
  }
  function resize() { var r = ov.getBoundingClientRect(), d = window.devicePixelRatio || 1; ov.width = Math.max(1, r.width * d); ov.height = Math.max(1, r.height * d); octx.setTransform(d, 0, 0, d, 0, 0); }
  window.addEventListener('resize', resize); window.addEventListener('orientationchange', function () { setTimeout(resize, 300); });

  // ---------- wake lock & monitoring gaps (iOS realism) ----------
  var wakeLock = null;
  async function keepAwake() { try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', function () { wakeLock = null; }); } } catch (e) {} try { await $('nosleep').play(); } catch (e) {} }
  function beginGap(why) { if (gapStart || !started) return; gapStart = { t: Date.now(), why: why }; $('h-mon').textContent = '■ PAUSED — NOT MONITORING'; $('h-mon').classList.add('paused'); }
  function endGap() {
    if (!gapStart) return; var g = gapStart; gapStart = null; var dur = (Date.now() - g.t) / 1000;
    $('h-mon').textContent = '● FOREGROUND ONLY'; $('h-mon').classList.remove('paused');
    logEvent('gap', 'monitoring gap', null, 'NOT monitoring for ' + dur.toFixed(0) + ' s (' + g.why + ') from ' + new Date(g.t).toISOString(), { gapStart: new Date(g.t).toISOString(), gapSec: Math.round(dur) });
    engine.reset(); tracker.reset(); prevGray = null; if (smoother) smoother.reset(); stats.baseline = null;
    toast('Monitoring resumed — gap of ' + dur.toFixed(0) + ' s logged', 3500);
  }
  document.addEventListener('visibilitychange', async function () {
    if (!started) return;
    if (document.visibilityState === 'hidden') { beginGap('app hidden / screen locked'); return; }
    keepAwake();
    if (stream && stream.getVideoTracks().some(function (t) { return t.readyState === 'ended'; })) { try { await startCamera(false); if (S.audio) await startAudio(); } catch (e) { toast('Camera could not restart — tap Settings › Safari › Camera, or reload'); return; } }
    if (mic && mic.ctx && mic.ctx.state !== 'running') try { await mic.ctx.resume(); } catch (e) {}
    try { await video.play(); } catch (e) {}
    endGap();
  });
  window.addEventListener('pagehide', function () { beginGap('page hidden (pagehide)'); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) endGap(); });

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
      if (!caps.audio) throw new Error('WebAudio not supported');
      var at = stream && stream.getAudioTracks()[0];
      if (!at || at.readyState === 'ended') {
        try { var as = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); at = as.getAudioTracks()[0]; stream.addTrack(at); }
        catch (e) { throw new Error('Microphone unavailable or denied (' + e.name + '). Enable it in Settings › Safari › Microphone.'); }
      }
      if (mic) mic.stop(); mic = new SAudio.Mic(); await mic.start(new MediaStream([at]));
      if (!SAudio.isReady()) { el.innerHTML = '<div class="muted">Loading YAMNet (~16 MB, cached after first load)…</div>'; await SAudio.load(); }
      smoother = new SAudioLogic.Smoother(SAudio.getClasses(), { cats: S.acat, baseGain: S.abase ? 1 : 0, ambBoost: S.abase ? 0.2 : 0, debounceMs: S.deb * 1000 });
      audioOk = true; audioMsg = 'YAMNet ready (' + mic.mode + ', ' + mic.rate + ' Hz → 16 kHz)'; el.innerHTML = '<div class="muted">' + audioMsg + ' — listening…</div>';
    } catch (e) { audioOk = false; audioMsg = 'Sound panel disabled: ' + e.message; el.innerHTML = '<div class="muted" style="color:var(--warn)">⚠ ' + esc(audioMsg) + '</div>'; $('h-sound').textContent = '🔇 off'; }
  }
  function stopAudio() { if (mic) mic.stop(); mic = null; audioOk = false; $('sound-panel').innerHTML = '<div class="muted">Sound classification off.</div>'; $('h-sound').textContent = '🔇 off'; }
  async function audioStep(now) {
    if (!audioOk || !mic || !mic.ready()) return;
    busy = true;
    try {
      var t0 = performance.now(), r = await SAudio.classify(mic.buf, 3); push(stats.audio, performance.now() - t0);
      var db = 20 * Math.log10(mic.level + 1e-8); topSound = r.top[0];
      audioState = smoother.push(r.scores, db, Date.now());
      $('sound-panel').innerHTML = r.top.map(function (t) { return '<div class="srow"><span>' + esc(t.label) + '</span><div class="bar"><i style="width:' + Math.round(t.score * 100) + '%"></i></div><b>' + Math.round(t.score * 100) + '%</b></div>'; }).join('') +
        '<div class="muted mono">YAMNet ' + Math.round(r.ms) + ' ms · floor ' + (audioState.floorDb != null ? audioState.floorDb.toFixed(0) : '--') + ' dB' + (audioState.gated ? ' · quiet-gated' : '') + (audioState.boost ? ' · wind/rain suppression on' : '') + '</div>';
      $('h-sound').textContent = '🔊 ' + topSound.label + ' ' + Math.round(topSound.score * 100) + '%';
      audioState.events.forEach(function (e) {
        logEvent('sound', e.cat, e.score, 'YAMNet smoothed ' + Math.round(e.score * 100) + '% (raw ' + Math.round(e.raw * 100) + '%, ' + e.durWin + ' windows) · top: ' + r.top.map(function (t) { return t.label; }).join(', ')).then(function (ev) {
          incMgr.add({ t: Date.now(), kind: 'audio', label: e.cat, score: e.score, top: r.top.map(function (t) { return t.label; }), eventId: ev.id });
        });
      });
    } catch (e) { console.warn('audio step', e); }
    busy = false;
  }

  // ---------- motion ----------
  function motionStep(now) {
    if (!video.videoWidth) return;
    var t0 = performance.now();
    mctx.drawImage(video, 0, 0, MW, MH);
    var g = SCore.toGray(mctx.getImageData(0, 0, MW, MH).data, MW, MH);
    mstat = engine.process(g, now); prevGray = g;
    scene = refGray ? SCore.sceneChange(refGray, g, null, MW, MH) : null;
    push(stats.motion, performance.now() - t0);
    if (mstat.movers.length) {
      lastMoverT = now;
      if (deb.ok('motion', now)) logEvent('motion', 'coherent motion', Math.min(1, mstat.fgPct / 10), mstat.movers.length + ' coherent mover(s), fg ' + mstat.fgPct.toFixed(1) + '%, cam shift ' + mstat.shift.join(',') + (S.malert ? '' : ' (cue only — raises detector priority)')).then(function (ev) {
        incMgr.add({ t: Date.now(), kind: 'motion', coherent: true, fgPct: mstat.fgPct, movers: mstat.movers.length, eventId: ev.id });
      });
    }
    $('h-mot').textContent = mstat.fgPct.toFixed(1) + '%'; $('m-mot').style.width = Math.min(100, mstat.fgPct * 4) + '%'; $('m-mot-v').textContent = mstat.fgPct.toFixed(1) + '%';
    $('motion-info').textContent = (mstat.warm ? 'LEARNING BACKGROUND… ' : '') + 'blobs ' + mstat.blobs.length + ' · movers ' + mstat.movers.length + ' · shake ' + mstat.shift.join(',') + ' · light gain ' + mstat.gain.toFixed(2);
    if (scene) { $('m-scene').style.width = Math.min(100, scene.changedPct) + '%'; $('m-scene-v').textContent = scene.meanPct.toFixed(1) + '% / ' + scene.changedPct.toFixed(0) + '%'; }
    if (mic) { var db = 20 * Math.log10(mic.level + 1e-8); $('m-lvl').style.width = Math.max(0, Math.min(100, (db + 70) / 70 * 100)) + '%'; $('m-lvl-v').textContent = db.toFixed(0) + ' dB'; }
  }

  // ---------- detection ----------
  async function detStep(now) {
    busy = true;
    try {
      var W = video.videoWidth, H = video.videoHeight;
      var r = await SDet2.detect(video, W, H, { floor: 0.15, iou: S.iou, enhance: S.enh ? { mode: 'auto' } : null });
      push(stats.pre, r.t.pre); push(stats.infer, r.t.infer); push(stats.post, r.t.post); push(stats.det, r.t.pre + r.t.infer + r.t.post); push(stats.detTimes, now, 30); stats.vfcProcessed++;
      lastRaw = r.dets; lastSup = r.suppressed;
      var u = tracker.update(r.dets, W, H, now); lastDiag = u.diag.concat(r.suppressed.map(function (s) { return { det: s.det, reason: 'nms_suppressed', group: STrack.groupOf(s.det.cls) }; }));
      u.events.forEach(function (t) { onConfirmedTrack(t); });
      tracker.tracks.forEach(function (t) { if (t.evented && t.best && t.best.fresh && t.visible && S.snap && (!t.snapT || now - t.snapT > 3000) && t.best.q > (t.snapQ || 0) * 1.3) { t.best.fresh = false; saveTrackSnap(t); } });
      if (trial) r.dets.forEach(function (d) { trial.dets.push({ label: d.cls, score: +d.score.toFixed(4), t: Date.now() }); });
      adapt();
    } catch (e) { console.warn('detect', e); }
    busy = false;
  }
  async function onConfirmedTrack(t) {
    var toEpoch = function (pt) { return Date.now() - (performance.now() - pt); }, confAt = toEpoch(t.confirmedT), firstAt = toEpoch(t.firstT);
    var ev = await logEvent('object', t.label, t.maxScore, 'track #' + t.id + ' confirmed (' + S.cat[t.group].n + '/' + S.cat[t.group].m + ' frames ≥ ' + S.cat[t.group].thr + '), time-to-confirm ' + ((t.confirmedT - t.firstT) / 1000).toFixed(1) + ' s' + (S.zones.length ? ', zone OK' : ''), { trackId: t.id }, true);
    t.snapId = ev.snap ? ev.id : null; t.snapQ = t.best ? t.best.q : 0; t.snapT = performance.now();
    incMgr.add({ t: Date.now(), confirmedAt: confAt, kind: 'track', trackId: t.id, label: t.label, group: t.group, score: t.maxScore, firstSeen: firstAt, snapId: t.snapId, eventId: ev.id, reasonDetail: S.cat[t.group].n + '/' + S.cat[t.group].m + '≥' + S.cat[t.group].thr });
    if (labeling) t.ttcMs = t.confirmedT - t.firstT;
  }
  async function saveTrackSnap(t) {
    if (!SStore.idbOk()) return; var id = 'snap_' + t.id + '_' + Date.now().toString(36);
    try { var b = await snapshotBlob(); await SStore.putSnap(id, b); t.snapQ = t.best.q; t.snapT = performance.now(); t.snapId = id;
      if (incMgr.cur && incMgr.cur.tracks[String(t.id)]) { var it = incMgr.cur.tracks[String(t.id)]; it.snapId = id; if (incMgr.cur.snaps.indexOf(id) < 0) incMgr.cur.snaps.push(id); SStore.putIncident(incMgr.cur); } } catch (e) {}
  }
  // adaptive input size + thermal/latency drift detection
  function adapt() {
    var c = SDet2.current(); if (!c || stats.det.length < 20) return;
    var recent = pct(stats.det.slice(-20), .5);
    if (!stats.baseline && stats.det.length >= 30) stats.baseline = pct(stats.det.slice(-30), .5);
    stats.drift = !!(stats.baseline && recent > stats.baseline * 1.6);
    if (!S.adapt) return;
    var budget = S.low ? 400 : 180, i = c.sizes.indexOf(c.inputSize), now = performance.now();
    if (stats.lastAdapt && now - stats.lastAdapt < 8000) return;
    if ((recent > budget * 1.3 || stats.drift) && i > 0) { SDet2.setInputSize(c.sizes[i - 1]); stats.lastAdapt = now; stats.det = []; stats.baseline = null; stats.adaptLog.push(new Date().toISOString().slice(11, 19) + ' ↓' + c.sizes[i - 1] + (stats.drift ? ' (latency drift — possible thermal throttling)' : ' (p50 ' + Math.round(recent) + ' ms > budget)')); }
    else if (recent < budget * 0.45 && i < c.sizes.length - 1 && i < c.sizes.indexOf(S.size || SDet2.MODELS[c.id].def) + 1) { SDet2.setInputSize(c.sizes[i + 1]); stats.lastAdapt = now; stats.det = []; stats.adaptLog.push(new Date().toISOString().slice(11, 19) + ' ↑' + c.sizes[i + 1]); }
  }

  // ---------- render ----------
  function draw() {
    var t0 = performance.now(), r = ov.getBoundingClientRect(), W = r.width, H = r.height; octx.clearRect(0, 0, W, H);
    if (!video.videoWidth) return;
    var VW = video.videoWidth, VH = video.videoHeight, T = SDet2Geo.cover(VW, VH, W, H);
    if (S.heat && engine.fg) { var cw = VW / MW * T.s, ch = VH / MH * T.s, fg = engine.fg; octx.fillStyle = 'rgba(255,40,0,0.45)'; for (var i = 0; i < fg.length; i++) if (fg[i]) octx.fillRect(T.ox + (i % MW) * cw, T.oy + ((i / MW) | 0) * ch, cw + 0.5, ch + 0.5); }
    if (mstat && S.heat) mstat.movers.forEach(function (b) { var bx = b.box; octx.strokeStyle = '#FFB000'; octx.lineWidth = 2; octx.strokeRect(T.ox + bx.x0 * VW / MW * T.s, T.oy + bx.y0 * VH / MH * T.s, (bx.x1 - bx.x0 + 1) * VW / MW * T.s, (bx.y1 - bx.y0 + 1) * VH / MH * T.s); });
    // zones
    var zs = S.zones.concat(zoneEdit && zoneEdit.pts.length ? [{ type: zoneEdit.type, pts: zoneEdit.pts, open: true }] : []);
    zs.forEach(function (z) {
      octx.save(); octx.beginPath(); z.pts.forEach(function (p, k) { var x = T.ox + p[0] * VW * T.s, y = T.oy + p[1] * VH * T.s; if (k) octx.lineTo(x, y); else octx.moveTo(x, y); }); if (!z.open) octx.closePath();
      octx.strokeStyle = z.type === 'exclude' ? '#FF3B30' : '#FFB000'; octx.setLineDash([6, 4]); octx.lineWidth = 2; octx.stroke();
      if (!z.open) { octx.fillStyle = z.type === 'exclude' ? 'rgba(255,59,48,0.15)' : 'rgba(255,176,0,0.08)'; octx.fill(); } octx.restore();
    });
    // RAW layer (dimmed, dashed)
    if (S.raw) lastDiag.forEach(function (d) {
      var b = SDet2Geo.toView(d.det, T); octx.save(); octx.globalAlpha = 0.55; octx.setLineDash([3, 3]); octx.lineWidth = 1; octx.strokeStyle = d.reason ? '#8a9a78' : '#cfe8a8'; octx.strokeRect(b.x, b.y, b.w, b.h);
      octx.font = '600 10px -apple-system, system-ui, sans-serif'; octx.fillStyle = '#cfdcbf'; octx.fillText(d.det.cls + ' ' + Math.round(d.det.score * 100) + (d.reason ? ' · ' + d.reason.replace(/_/g, ' ') : ''), b.x + 2, b.y + b.h - 3); octx.restore();
    });
    // CONFIRMED tracks
    var vis = tracker.confirmedVisible(), counts = {};
    vis.forEach(function (t) { var b = SDet2Geo.toView(t.box, T); drawBox(octx, b, t); counts[t.label] = (counts[t.label] || 0) + 1; });
    $('h-cnt').textContent = vis.length; $('h-counts').textContent = Object.keys(counts).map(function (k) { return k + '×' + counts[k]; }).join('  ');
    push(stats.draw, performance.now() - t0);
  }
  var GC = { person: '#9ACD32', animal: '#00E5FF', vehicle: '#FFB000', other: '#E0E0E0' };
  function drawBox(ctx, vb, t, scale) {
    scale = scale || 1; var col = t.zone ? '#8a9a78' : GC[t.group];
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 2.5 * scale; ctx.strokeRect(vb.x, vb.y, vb.w, vb.h);
    var c = Math.min(vb.w, vb.h) * 0.18; ctx.lineWidth = 5 * scale; ctx.beginPath(); ctx.moveTo(vb.x, vb.y + c); ctx.lineTo(vb.x, vb.y); ctx.lineTo(vb.x + c, vb.y); ctx.moveTo(vb.x + vb.w - c, vb.y + vb.h); ctx.lineTo(vb.x + vb.w, vb.y + vb.h); ctx.lineTo(vb.x + vb.w, vb.y + vb.h - c); ctx.stroke();
    var txt = t.label.toUpperCase() + ' #' + t.id + ' ' + Math.round(t.score * 100) + '%' + (t.zone ? ' · ' + t.zone.replace(/_/g, ' ') : ''), fs = Math.round(13 * scale);
    ctx.font = '700 ' + fs + 'px Calibri, -apple-system, system-ui, sans-serif';
    var tw = ctx.measureText(txt).width + 10 * scale, th = fs + 8 * scale, VW = ctx.canvas.clientWidth || ctx.canvas.width, ty = vb.y - th - 2 < 0 ? vb.y + 2 : vb.y - th - 2, tx = Math.min(Math.max(vb.x, 4), Math.max(4, VW - tw - 4));
    ctx.fillStyle = 'rgba(0,0,0,0.78)'; ctx.fillRect(tx, ty, tw, th); ctx.fillStyle = col; ctx.textBaseline = 'middle'; ctx.fillText(txt, tx + 5 * scale, ty + th / 2); ctx.restore();
  }
  window.SDet2Geo = { cover: function (sw, sh, vw, vh) { var s = Math.max(vw / sw, vh / sh); return { s: s, ox: (vw - sw * s) / 2, oy: (vh - sh * s) / 2 }; }, toView: function (b, t) { return { x: b.x * t.s + t.ox, y: b.y * t.s + t.oy, w: b.w * t.s, h: b.h * t.s }; } };

  function loop() {
    requestAnimationFrame(loop);
    if (!running || !video.videoWidth || gapStart) return;
    var now = performance.now(); stats.ticks++;
    if (now - lastMotT >= (S.low ? 250 : 100)) { lastMotT = now; motionStep(now); }
    var active = tracker.tracks.length > 0 || now - lastMoverT < 5000 || (mstat && mstat.blobs.length > 0);
    var detInt = S.low ? (active ? 700 : 2500) : (active ? 0 : 600), audInt = S.low ? 1000 : 500;
    if (!busy && SDet2.isReady()) {
      if (audioOk && now - lastAudioT >= audInt) { lastAudioT = now; audioStep(now); }
      else if (now - lastDetT >= detInt) { lastDetT = now; detStep(now); }
    } else if (busy && now - lastDetT >= detInt) stats.skipped++;
    draw(); if (trial) trialTick();
    incMgr.tick(Date.now(), tracker.confirmedVisible().map(function (t) { return t.id; }));
    if (((now / 300) | 0) !== loop._k) { loop._k = (now / 300) | 0; $('h-fps').textContent = detRate().toFixed(1); var p = pct(stats.det, .5); $('h-ms').textContent = p == null ? '--' : Math.round(p); if ($('tab-diag').classList.contains('active')) renderDiag(); }
  }

  // ---------- events ----------
  function snapshotBlob() {
    return new Promise(function (res) {
      var w = video.videoWidth, h = video.videoHeight, k = Math.min(1, 960 / Math.max(w, h)), c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
      var x = c.getContext('2d'); x.drawImage(video, 0, 0, c.width, c.height);
      tracker.confirmedVisible().forEach(function (t) { drawBox(x, SDet2Geo.toView(t.box, { s: k, ox: 0, oy: 0 }), t, 1.2); });
      x.font = '700 14px Calibri, system-ui, sans-serif'; x.fillStyle = '#9ACD32'; x.fillText('NEWTON SENTINEL 2.0 ' + new Date().toISOString(), 8, c.height - 10);
      c.toBlob(res, 'image/jpeg', 0.8);
    });
  }
  var evSeq = Date.now();
  async function logEvent(type, label, conf, detail, extra, wantSnap) {
    var e = Object.assign({ id: 'ev' + (evSeq++).toString(36), ts: new Date().toISOString(), type: type, label: label, conf: conf != null ? +conf.toFixed(4) : null, detail: detail || '', geo: S.geo && geo ? geo : null, snap: false, v: VERSION, incidentId: incMgr.cur ? incMgr.cur.id : null }, extra || {});
    var li = document.createElement('li'); li.textContent = e.ts.slice(11, 19) + ' · ' + type.toUpperCase() + ' · ' + label + (conf != null ? ' ' + Math.round(conf * 100) + '%' : '');
    $('live-events').prepend(li); while ($('live-events').children.length > 6) $('live-events').lastChild.remove();
    if ((wantSnap || type === 'manual') && S.snap && SStore.idbOk() && video.videoWidth) { try { await SStore.putSnap(e.id, await snapshotBlob()); e.snap = true; } catch (err) {} }
    await SStore.putEvent(e); return e;
  }
  function renderIncBar(I) { var b = $('h-inc'); if (!I || I.status !== 'open') { b.classList.add('hidden'); return; } b.classList.remove('hidden'); b.textContent = '⚠ INCIDENT · ' + I.labels.slice(0, 4).join(', ') + ' · ' + I.reasons.length + ' reason(s)' + (I.correlation ? ' · audio+visual co-occurring' : ''); }

  // ---------- history ----------
  var view = 'inc', thumbURLs = [];
  $('view-inc').onclick = function () { view = 'inc'; this.classList.add('on'); $('view-ev').classList.remove('on'); renderHistory(); };
  $('view-ev').onclick = function () { view = 'ev'; this.classList.add('on'); $('view-inc').classList.remove('on'); renderHistory(); };
  ['f-text', 'f-label', 'f-type', 'f-conf', 'f-from', 'f-to'].forEach(function (id) { $(id).oninput = $(id).onchange = function () { clearTimeout(renderHistory._t); renderHistory._t = setTimeout(renderHistory, 200); }; });
  $('f-clear').onclick = function () { ['f-text', 'f-label', 'f-from', 'f-to'].forEach(function (id) { $(id).value = ''; }); $('f-type').value = 'all'; $('f-conf').value = 0; renderHistory(); };
  function query() { return { text: $('f-text').value, label: $('f-label').value, type: view === 'ev' ? $('f-type').value : 'all', minConf: (+$('f-conf').value || 0) / 100, from: $('f-from').value ? Date.parse($('f-from').value) : null, to: $('f-to').value ? Date.parse($('f-to').value) + 86400000 : null }; }
  function thumb(el, id) { SStore.getSnap(id).then(function (b) { if (!b) return; var u = URL.createObjectURL(b); thumbURLs.push(u); var i = new Image(); i.src = u; i.alt = 'snapshot'; el.append(i); }).catch(function () {}); }
  async function renderHistory() {
    thumbURLs.forEach(URL.revokeObjectURL); thumbURLs = []; renderStorage();
    var ul = $('log-list'); ul.innerHTML = '';
    if (view === 'inc') {
      var all = await SStore.allIncidents(), list = SInc.filterRecords(all, query()).reverse().slice(0, 200);
      $('log-count').textContent = list.length + ' / ' + all.length + ' incidents';
      list.forEach(function (I) {
        var li = document.createElement('li'); li.className = 'inc';
        var tr = Object.keys(I.tracks).map(function (k) { var t = I.tracks[k]; return t.label + ' #' + t.id + ' peak ' + fmtPct(t.peak) + (t.timeToConfirmMs != null ? ', confirm ' + (t.timeToConfirmMs / 1000).toFixed(1) + ' s' : ''); }).join(' · ');
        li.innerHTML = '<div><b>' + esc(I.labels.join(', ') || 'incident') + '</b> <span class="t">' + new Date(I.start).toISOString().replace('T', ' ').slice(0, 19) + ' → ' + new Date(I.end).toISOString().slice(11, 19) + ' UTC · ' + I.status + ' · max ' + fmtPct(I.maxConf) + '</span></div>' +
          (tr ? '<div class="t">Tracks: ' + esc(tr) + '</div>' : '') + (Object.keys(I.audio).length ? '<div class="t">Audio: ' + esc(Object.keys(I.audio).map(function (k) { return k + ' ' + fmtPct(I.audio[k]); }).join(', ')) + (I.audioTop.length ? ' · top: ' + esc(I.audioTop.join(', ')) : '') + '</div>' : '') +
          (I.motion.cues ? '<div class="t">Motion: ' + I.motion.cues + ' coherent cue(s), max fg ' + I.motion.maxFgPct.toFixed(1) + '%</div>' : '') +
          '<div class="rc">Reasons: ' + esc(I.reasons.join(' | ')) + '</div>' + (I.correlation ? '<div class="co">⟷ ' + esc(I.correlation.note) + ' (Δ ' + I.correlation.dtSec + ' s)</div>' : '') + '<div class="thumbs"></div>';
        ul.append(li); (I.snaps || []).slice(0, 4).forEach(function (id) { thumb(li.querySelector('.thumbs'), id); });
      });
    } else {
      var evs = await SStore.allEvents(), l2 = SInc.filterRecords(evs, query()).reverse().slice(0, 300);
      $('log-count').textContent = l2.length + ' / ' + evs.length + ' events';
      l2.forEach(function (e) {
        var li = document.createElement('li');
        li.innerHTML = '<div class="th"></div><div><div><span class="ty ' + e.type + '">' + (e.type === 'gap' ? 'MONITORING GAP' : e.type.toUpperCase()) + '</span> <b>' + esc(e.label) + '</b> ' + (e.conf != null ? Math.round(e.conf * 100) + '%' : '') + '</div><div class="t">' + e.ts + '</div><div class="t">' + esc(e.detail) + (e.geo ? ' · ' + e.geo.lat + ',' + e.geo.lon + ' ±' + e.geo.acc + 'm' : '') + '</div></div>';
        ul.append(li); if (e.snap) thumb(li.querySelector('.th'), e.id);
      });
    }
  }
  async function renderStorage() {
    var e = await SStore.estimate(), el = $('storage');
    el.innerHTML = (e ? 'Storage used: <b>' + (e.usage / 1048576).toFixed(1) + ' MB</b> of ~' + (e.quota / 1048576).toFixed(0) + ' MB · persistent: <b>' + (e.persisted ? 'yes' : 'no') + '</b>' : 'Storage estimate unavailable') +
      '<br>⚠ Safari may delete this site\'s data after ~7 days without use or when storage is low. Export regularly. <button class="btn sm" id="st-persist">REQUEST PERSISTENT STORAGE</button>';
    $('st-persist').onclick = async function () { var ok = await SStore.persist(); toast(ok ? 'Persistent storage granted' : 'Browser declined persistence (Add to Home Screen helps)'); renderStorage(); };
  }
  $('log-clear').onclick = async function () { if (!confirm('Delete ALL events, incidents and snapshots on this device?')) return; await SStore.clearAll(); renderHistory(); };

  // ---------- export ----------
  function stamp() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }
  async function eventsJSON() { return JSON.stringify({ app: 'Newton SENTINEL Mobile', version: VERSION, exported: new Date().toISOString(), settings: { model: S.model, cat: S.cat, iou: S.iou, sens: S.sens, zones: S.zones }, events: await SStore.allEvents(), incidents: await SStore.allIncidents() }, null, 2); }
  function incCSV(incs) { return SCore.toCSV(incs.map(function (I) { return { id: I.id, start: new Date(I.start).toISOString(), end: new Date(I.end).toISOString(), status: I.status, labels: I.labels.join('|'), maxConf: I.maxConf, tracks: Object.keys(I.tracks).map(function (k) { var t = I.tracks[k]; return t.label + '#' + t.id + ':' + (t.peak || 0).toFixed(2); }).join('|'), audio: Object.keys(I.audio).map(function (k) { return k + ':' + I.audio[k].toFixed(2); }).join('|'), motionCues: I.motion.cues, reasons: I.reasons.join('|'), correlation: I.correlation ? I.correlation.type + ' dt=' + I.correlation.dtSec + 's (possibly related)' : '', snapshots: (I.snaps || []).length }; }), ['id', 'start', 'end', 'status', 'labels', 'maxConf', 'tracks', 'audio', 'motionCues', 'reasons', 'correlation', 'snapshots']); }
  function offer(files, host) { var h = $(host); h.innerHTML = ''; files.forEach(function (f) { var a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.textContent = '⬇ ' + f.name; h.append(a); a.click(); }); }
  async function share(files, host) { if (navigator.share && navigator.canShare && navigator.canShare({ files: files })) { try { await navigator.share({ files: files, title: 'SENTINEL export' }); return; } catch (e) { if (e.name === 'AbortError') return; } } toast('Sharing files not supported here — downloading'); offer(files, host); }
  function file(txt, name, type) { return new File([txt], name, { type: type }); }
  async function buildZip() {
    if (!window.JSZip) throw new Error('JSZip not loaded');
    var evs = await SStore.allEvents(), incs = await SStore.allIncidents(), z = new JSZip();
    z.file('events.csv', SCore.eventsCSV(evs)); z.file('incidents.csv', incCSV(incs)); z.file('sentinel.json', await eventsJSON());
    if (field.trials.length) { z.file('fieldtest_metrics.csv', SCore.metricsCSV(SCore.fieldMetrics(field.trials))); z.file('fieldtest_trials.csv', SCore.trialsCSV(field.trials)); }
    var ids = new Set(); evs.forEach(function (e) { if (e.snap) ids.add(e.id); }); incs.forEach(function (I) { (I.snaps || []).forEach(function (s) { ids.add(s); }); });
    var n = 0; for (var id of ids) { try { var b = await SStore.getSnap(id); if (b) { z.file('snapshots/' + id + '.jpg', b); n++; } } catch (e) {} }
    return { file: new File([await z.generateAsync({ type: 'blob' })], 'sentinel_' + stamp() + '.zip', { type: 'application/zip' }), snaps: n };
  }
  $('exp-ev-csv').onclick = async function () { offer([file(SCore.eventsCSV(await SStore.allEvents()), 'sentinel_events_' + stamp() + '.csv', 'text/csv'), file(incCSV(await SStore.allIncidents()), 'sentinel_incidents_' + stamp() + '.csv', 'text/csv')], 'dl-links'); };
  $('exp-ev-json').onclick = async function () { offer([file(await eventsJSON(), 'sentinel_' + stamp() + '.json', 'application/json')], 'dl-links'); };
  $('exp-zip').onclick = async function () { try { toast('Building ZIP…'); var z = await buildZip(); offer([z.file], 'dl-links'); toast('ZIP ready (' + z.snaps + ' snapshots)'); } catch (e) { toast('ZIP failed: ' + e.message); } };
  $('exp-share').onclick = async function () { var fs; try { fs = [(await buildZip()).file]; } catch (e) { fs = [file(await eventsJSON(), 'sentinel.json', 'application/json')]; } share(fs, 'dl-links'); };

  // ---------- field test A: tap-to-label ----------
  function saveField() { SStore.saveField(field); }
  $('lb-start').onclick = function () { if (!running) { toast('Start the camera first'); return; } labeling = field.lab = { start: Date.now(), end: null, labels: [], model: S.model, inputSize: SDet2.current() && SDet2.current().inputSize, geo: geo }; saveField(); renderField(); showTab('live'); toast('Labeling: tap boxes (TP/FP) or empty space (missed)'); };
  $('lb-stop').onclick = function () { if (labeling) { labeling.end = Date.now(); labeling = null; saveField(); renderField(); } };
  $('lb-reset').onclick = function () { if (confirm('Clear labeling session?')) { field.lab = null; labeling = null; saveField(); renderField(); } };
  function anonData() { var L = field.lab; return L ? SInc.anonymize(L, L.labels, { includeGps: $('lb-gps').checked }) : null; }
  $('lb-json').onclick = function () { var a = anonData(); if (!a) return toast('No labeling session'); offer([file(JSON.stringify(a, null, 2), 'sentinel_fieldtest_anon_' + a.date + '.json', 'application/json')], 'lb-links'); };
  $('lb-csv').onclick = function () { var a = anonData(); if (!a) return toast('No labeling session'); var m = a.metrics, rows = Object.keys(m.classes).map(function (k) { return Object.assign({ cls: k }, m.classes[k]); }).concat([Object.assign({ cls: 'OVERALL' }, m.overall)]);
    offer([file(SCore.toCSV(rows, ['cls', 'tp', 'fp', 'fn', 'precision', 'recall', 'f1', 'fpPerHour', 'meanConf', 'meanTimeToConfirmMs']), 'sentinel_fieldtest_anon_metrics_' + a.date + '.csv', 'text/csv'), file(SCore.toCSV(a.labels, ['tSec', 'kind', 'cls', 'conf', 'ttcSec']), 'sentinel_fieldtest_anon_labels_' + a.date + '.csv', 'text/csv')], 'lb-links'); };
  function sheet(html) { var s = $('labelsheet'); s.innerHTML = html; s.classList.remove('hidden'); return s; }
  $('stage').addEventListener('click', function (e) {
    if (zoneEdit) return zoneTap(e);
    if (!labeling) return;
    var r = ov.getBoundingClientRect(), T = SDet2Geo.cover(video.videoWidth, video.videoHeight, r.width, r.height), px = e.clientX - r.left, py = e.clientY - r.top;
    var hit = tracker.confirmedVisible().filter(function (t) { var b = SDet2Geo.toView(t.box, T); return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h; })[0];
    if (e.target.closest && e.target.closest('#labelsheet')) return;
    if (hit) {
      var s = sheet('<div><b>' + esc(hit.label) + ' #' + hit.id + '</b> ' + Math.round(hit.maxScore * 100) + '%</div><div class="row"><button class="btn primary" data-k="tp">CORRECT (TP)</button><button class="btn danger" data-k="fp">FALSE ALARM (FP)</button><button class="btn ghost" data-k="x">CANCEL</button></div>');
      s.querySelectorAll('button').forEach(function (b) { b.onclick = function (ev) { ev.stopPropagation(); s.classList.add('hidden'); if (b.dataset.k === 'x') return; addLabel({ kind: b.dataset.k, cls: hit.label, conf: hit.maxScore, ttcMs: hit.confirmedT - hit.firstT, trackId: hit.id }); }; });
    } else {
      var opts = Array.from(new Set(['person', 'dog', 'horse', 'cow', 'bear', 'bird', 'car', 'truck', 'motorcycle', 'bicycle'].concat(S.classes))).map(function (c) { return '<option>' + c + '</option>'; }).join('');
      var s2 = sheet('<div><b>Missed object here?</b> class: <select id="miss-cls">' + opts + '</select></div><div class="row"><button class="btn warn" data-k="miss">RECORD MISS</button><button class="btn ghost" data-k="x">CANCEL</button></div>');
      s2.querySelectorAll('button').forEach(function (b) { b.onclick = function (ev) { ev.stopPropagation(); s2.classList.add('hidden'); if (b.dataset.k === 'miss') addLabel({ kind: 'miss', cls: $('miss-cls').value, conf: null, ttcMs: null, at: [+(px / r.width).toFixed(2), +(py / r.height).toFixed(2)] }); }; });
    }
  });
  function addLabel(l) { l.t = Date.now(); labeling.labels.push(l); saveField(); toast(l.kind.toUpperCase() + ' · ' + l.cls); logEvent('manual', 'label ' + l.kind + ': ' + l.cls, l.conf, 'field-test label'); }

  // ---------- field test B: timed trials (v1 flow) ----------
  function allCocoOptions(sel) { return Object.keys(SCore.GROUPS).map(function (g) { return '<optgroup label="' + g + '">' + SCore.GROUPS[g].map(function (c) { return '<option' + (c === sel ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</optgroup>'; }).join(''); }
  function fmt(v, p) { return v == null ? '—' : p ? (v * 100).toFixed(0) + '%' : v; }
  function renderField() {
    var L = field.lab; $('lb-start').disabled = !!labeling; $('lb-stop').disabled = !labeling;
    if (L) { var m = SInc.fieldMetricsV2(L.labels, L), rows = Object.keys(m.classes).map(function (k) { return [k, m.classes[k]]; }).concat(L.labels.length ? [['OVERALL', m.overall]] : []);
      $('lb-table').innerHTML = '<tr><th>CLASS</th><th>TP</th><th>FP</th><th>MISS</th><th>PREC</th><th>RECALL</th><th>F1</th><th>FP/h</th><th>CONFIRM s</th></tr>' + (rows.length ? rows.map(function (r) { var k = r[1]; return '<tr><td>' + esc(r[0]) + '</td><td>' + k.tp + '</td><td>' + k.fp + '</td><td>' + k.fn + '</td><td>' + fmt(k.precision, 1) + '</td><td>' + fmt(k.recall, 1) + '</td><td>' + fmt(k.f1, 1) + '</td><td>' + k.fpPerHour.toFixed(1) + '</td><td>' + (k.meanTimeToConfirmMs == null ? '—' : (k.meanTimeToConfirmMs / 1000).toFixed(1)) + '</td></tr>'; }).join('') : '<tr><td colspan="9" class="muted">' + (labeling ? 'Labeling… tap boxes on Live' : 'No labels') + '</td></tr>'); }
    else $('lb-table').innerHTML = '';
    $('ft-name').value = field.name; $('ft-dur').value = field.dur;
    var h = $('ft-objects'); h.innerHTML = '';
    field.objects.forEach(function (o, i) { var c = document.createElement('div'); c.className = 'chip'; c.innerHTML = esc(o.desc) + ' → <b>' + esc(o.cls) + '</b> <span class="x">×</span>'; c.querySelector('.x').onclick = function () { field.objects.splice(i, 1); saveField(); renderField(); }; h.append(c); });
    if (!$('ft-new-cls').options.length) $('ft-new-cls').innerHTML = allCocoOptions('person');
    var t = $('ft-truth'); if (!trial) { t.innerHTML = ''; field.objects.forEach(function (o) { var l = document.createElement('label'); l.className = 'chip'; l.innerHTML = '<input type="checkbox" value="' + esc(o.cls) + '"> ' + esc(o.desc); t.append(l); }); }
    var mm = SCore.fieldMetrics(field.trials), rr = Object.keys(mm.classes).map(function (k) { return [k, mm.classes[k]]; }).concat(field.trials.length ? [['OVERALL', mm.overall]] : []);
    $('ft-table').innerHTML = '<tr><th>CLASS</th><th>TP</th><th>FP</th><th>FN</th><th>PREC</th><th>RECALL</th><th>F1</th><th>MEAN CONF</th><th>TTFD s</th></tr>' + (rr.length ? rr.map(function (r) { var k = r[1]; return '<tr><td>' + esc(r[0]) + '</td><td>' + k.tp + '</td><td>' + k.fp + '</td><td>' + k.fn + '</td><td>' + fmt(k.precision, 1) + '</td><td>' + fmt(k.recall, 1) + '</td><td>' + fmt(k.f1, 1) + '</td><td>' + fmt(k.meanConf, 1) + '</td><td>' + (k.meanTTFDms == null ? '—' : (k.meanTTFDms / 1000).toFixed(2)) + '</td></tr>'; }).join('') : '<tr><td colspan="9" class="muted">No trials yet</td></tr>');
    $('ft-trials').innerHTML = '<tr><th>#</th><th>PRESENT</th><th>DETECTED (raw)</th><th>MARKS</th><th>DUR s</th></tr>' + field.trials.map(function (tr) { return '<tr><td>' + tr.id + '</td><td>' + esc(Object.keys(tr.truth).filter(function (k) { return tr.truth[k]; }).join(', ') || '(none)') + '</td><td>' + esc(Array.from(new Set(tr.dets.map(function (d) { return d.label; }))).join(', ') || '(none)') + '</td><td>' + esc((tr.marks || []).map(function (m) { return m.kind + ':' + m.label; }).join(', ')) + '</td><td>' + (tr.end ? ((tr.end - tr.start) / 1000).toFixed(0) : '…') + '</td></tr>'; }).join('');
  }
  $('ft-name').onchange = function () { field.name = this.value; saveField(); };
  $('ft-dur').onchange = function () { field.dur = Math.max(3, +this.value || 15); saveField(); };
  $('ft-add').onclick = function () { var d = $('ft-new-desc').value.trim() || $('ft-new-cls').value; field.objects.push({ desc: d, cls: $('ft-new-cls').value }); $('ft-new-desc').value = ''; saveField(); renderField(); };
  $('ft-reset').onclick = function () { if (confirm('Clear all trials?')) { field.trials = []; saveField(); renderField(); } };
  function startTrial() {
    if (!running) { toast('Start the camera first (Live tab)'); return; }
    var truth = {}; document.querySelectorAll('#ft-truth input').forEach(function (i) { truth[i.value] = truth[i.value] || i.checked; });
    trial = { id: field.trials.length + 1, start: Date.now(), end: null, dur: field.dur * 1000, truth: truth, dets: [], marks: [] }; field.trials.push(trial); saveField();
    $('trial-num').textContent = trial.id; $('trialbar').classList.remove('hidden'); $('ft-start').disabled = true; $('ft-stop').disabled = false;
    $('mark-label').innerHTML = Array.from(new Set(field.objects.map(function (o) { return o.cls; }).concat(S.classes))).map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    $('ft-status').textContent = 'Trial ' + trial.id + ' running…'; showTab('live');
  }
  function stopTrial() { if (!trial) return; trial.end = Date.now(); saveField(); $('ft-status').textContent = 'Trial ' + trial.id + ' done: ' + trial.dets.length + ' raw detections.'; trial = null; $('trialbar').classList.add('hidden'); $('ft-start').disabled = false; $('ft-stop').disabled = true; toast('Trial complete — see Field Test'); renderField(); }
  function trialTick() { var left = trial.start + trial.dur - Date.now(); $('trial-left').textContent = Math.max(0, Math.ceil(left / 1000)); if (left <= 0) stopTrial(); }
  $('ft-start').onclick = startTrial; $('ft-stop').onclick = stopTrial;
  function mark(kind) { var l = $('mark-label').value; if (trial) { trial.marks.push({ kind: kind, label: l, t: Date.now() }); saveField(); } logEvent('manual', 'mark ' + kind + ': ' + l, null, trial ? 'trial ' + trial.id : ''); toast('Marked ' + kind.toUpperCase() + ' · ' + l); }
  $('btn-mark-fp').onclick = function () { mark('fp'); }; $('btn-mark-miss').onclick = function () { mark('miss'); };
  function ftFiles() { var m = SCore.fieldMetrics(field.trials), s = stamp(); return [file(SCore.metricsCSV(m), 'sentinel_fieldtest_metrics_' + s + '.csv', 'text/csv'), file(SCore.trialsCSV(field.trials), 'sentinel_fieldtest_trials_' + s + '.csv', 'text/csv')]; }
  function fieldJSON() { return JSON.stringify({ app: 'Newton SENTINEL Mobile', version: VERSION, exported: new Date().toISOString(), session: field.name, objects: field.objects, model: S.model, metrics: SCore.fieldMetrics(field.trials), trials: field.trials }, null, 2); }
  $('ft-csv').onclick = function () { offer(ftFiles(), 'ft-links'); };
  $('ft-json').onclick = function () { offer([file(fieldJSON(), 'sentinel_fieldtest_' + stamp() + '.json', 'application/json')], 'ft-links'); };
  $('ft-share').onclick = function () { share(ftFiles().concat([file(fieldJSON(), 'sentinel_fieldtest.json', 'application/json')]), 'ft-links'); };

  // ---------- zones (polygon editor on Live view) ----------
  function zoneTap(e) {
    var r = ov.getBoundingClientRect(), T = SDet2Geo.cover(video.videoWidth || 1, video.videoHeight || 1, r.width, r.height);
    var x = Math.max(0, Math.min(1, (e.clientX - r.left - T.ox) / T.s / (video.videoWidth || 1))), y = Math.max(0, Math.min(1, (e.clientY - r.top - T.oy) / T.s / (video.videoHeight || 1)));
    zoneEdit.pts.push([+x.toFixed(4), +y.toFixed(4)]); zoneHint();
  }
  function zoneHint() { $('zone-hint').classList.toggle('hidden', !zoneEdit); if (zoneEdit) $('zone-hint').textContent = 'Drawing ' + (zoneEdit.type === 'roi' ? 'ROI' : 'EXCLUSION') + ' polygon: tap corners (' + zoneEdit.pts.length + ' pts), then CLOSE SHAPE'; }
  function applyZones() { save(); engine.setZoneMask(SMotion.zoneMask(S.zones, MW, MH, STrack.pointInPoly)); }
  $('btn-zone').onclick = function () { $('zonebar').classList.toggle('hidden'); if ($('zonebar').classList.contains('hidden')) { zoneEdit = null; zoneHint(); } else { zoneEdit = { type: 'roi', pts: [] }; zoneHint(); } syncBtns(); };
  $('z-roi').onclick = function () { zoneEdit = { type: 'roi', pts: [] }; zoneHint(); };
  $('z-ex').onclick = function () { zoneEdit = { type: 'exclude', pts: [] }; zoneHint(); };
  $('z-undo').onclick = function () { if (zoneEdit) zoneEdit.pts.pop(); zoneHint(); };
  $('z-close').onclick = function () { if (zoneEdit && zoneEdit.pts.length >= 3) { S.zones.push({ type: zoneEdit.type, pts: zoneEdit.pts }); applyZones(); toast((zoneEdit.type === 'roi' ? 'ROI' : 'Exclusion zone') + ' saved'); zoneEdit = { type: zoneEdit.type, pts: [] }; zoneHint(); } else toast('Need at least 3 points'); };
  $('z-clear').onclick = function () { S.zones = []; applyZones(); toast('Zones cleared'); };
  $('z-done').onclick = function () { zoneEdit = null; zoneHint(); $('zonebar').classList.add('hidden'); syncBtns(); };

  // ---------- diagnostics ----------
  function ms(v) { return v == null ? '—' : v.toFixed(1) + ' ms'; }
  function renderDiag() {
    var c = SDet2.current(), mem = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + ' MB JS heap' : 'n/a (Safari)', tm = window.tf ? tf.memory() : null;
    var rows = [['Version', VERSION], ['Model', c ? c.label + ' · input ' + c.inputSize + 'px' + (S.adapt ? ' (adaptive)' : '') : '—'], ['Backend', c ? c.backend : '—'], ['Detections/s', detRate().toFixed(2) + ' (render ' + (stats.draw.length ? '' : '') + ')'],
      ['Detector latency p50 / p95', ms(pct(stats.det, .5)) + ' / ' + ms(pct(stats.det, .95))], ['  preprocess / inference / postprocess (p50)', ms(pct(stats.pre, .5)) + ' / ' + ms(pct(stats.infer, .5)) + ' / ' + ms(pct(stats.post, .5))],
      ['Motion engine p50', ms(pct(stats.motion, .5))], ['Audio (YAMNet) p50 / p95', ms(pct(stats.audio, .5)) + ' / ' + ms(pct(stats.audio, .95))], ['Overlay draw p50', ms(pct(stats.draw, .5))],
      ['Frame policy', 'latest-frame only (queue depth ' + (busy ? 1 : 0) + ')'], ['Skipped detector slots (busy)', stats.skipped], ['Camera frames / processed', caps.rvfc ? stats.vfc + ' / ' + stats.vfcProcessed + ' (' + (stats.vfc ? Math.round(100 * (1 - stats.vfcProcessed / stats.vfc)) : 0) + '% not analysed)' : 'n/a'],
      ['Memory', mem + (tm ? ' · tf tensors ' + tm.numTensors + ' / ' + (tm.numBytes / 1048576).toFixed(1) + ' MB' : '')], ['Thermal / latency drift', stats.drift ? '⚠ latency +60% vs baseline — possible thermal throttling' : 'ok' + (stats.baseline ? ' (baseline p50 ' + stats.baseline.toFixed(0) + ' ms)' : '')],
      ['Adaptive changes', stats.adaptLog.slice(-4).join('; ') || 'none'], ['Motion', mstat ? 'fg ' + mstat.fgPct.toFixed(2) + '% · blobs ' + mstat.blobs.length + ' · movers ' + mstat.movers.length + ' · shake ' + mstat.shift.join(',') + ' · gain ' + mstat.gain.toFixed(2) + (mstat.warm ? ' · learning' : '') : '—'],
      ['Zones', S.zones.length + ' (' + S.zones.map(function (z) { return z.type; }).join(', ') + ')'], ['Audio', audioMsg || 'off'], ['Monitoring', gapStart ? 'PAUSED since ' + new Date(gapStart.t).toISOString() : 'active (foreground)']];
    $('d-stats').innerHTML = rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join('');
    $('d-raw').innerHTML = '<tr><th>CLASS</th><th>RAW</th><th>CLASS THR</th><th>TRACK</th><th>TRACK CONF</th><th>STATUS / REASON</th></tr>' + lastDiag.map(function (d) {
      var t = tracker.tracks.filter(function (x) { return (x.id || x.tmpId) === d.trackId; })[0], g = STrack.groupOf(d.det.cls);
      return '<tr><td>' + esc(d.det.cls) + '</td><td>' + Math.round(d.det.score * 100) + '%</td><td>' + Math.round(S.cat[g].thr * 100) + '%</td><td>' + esc(d.trackId || '—') + '</td><td>' + (t ? Math.round(t.maxScore * 100) + '% max' : '—') + '</td><td class="' + (d.reason ? 'rej' : 'ok') + '">' + esc(d.reason ? d.reason.replace(/_/g, ' ') : (t && t.state === 'confirmed' ? 'CONFIRMED' : 'matched')) + '</td></tr>';
    }).join('');
    $('d-tracks').innerHTML = '<tr><th>ID</th><th>LABEL</th><th>STATE</th><th>HITS (N/M)</th><th>AGE s</th><th>PEAK</th><th>ZONE</th></tr>' + tracker.tracks.map(function (t) { var cc = S.cat[t.group]; return '<tr><td>' + esc(t.id || t.tmpId) + '</td><td>' + esc(t.label) + '</td><td class="' + (t.state === 'confirmed' ? 'ok' : 'rej') + '">' + t.state + '</td><td>' + t.hist.reduce(function (a, b) { return a + b; }, 0) + '/' + cc.n + ' of ' + cc.m + '</td><td>' + ((performance.now() - t.firstT) / 1000).toFixed(1) + '</td><td>' + Math.round(t.maxScore * 100) + '%</td><td>' + esc(t.zone || 'ok') + '</td></tr>'; }).join('');
    $('d-audio').innerHTML = audioState ? '<tr><th>CATEGORY</th><th>RAW</th><th>SMOOTHED</th><th>AMBIENT BASE</th><th>EFFECTIVE</th><th>THR</th></tr>' + Object.keys(audioState.cats).map(function (k) { var a = audioState.cats[k]; return '<tr><td>' + k + '</td><td>' + fmtPct(a.raw) + '</td><td>' + fmtPct(a.smooth) + '</td><td>' + fmtPct(a.base) + '</td><td class="' + (a.active ? 'ok' : '') + '">' + fmtPct(a.eff) + '</td><td>' + fmtPct(S.acat[k].thr + (audioState.boost || 0)) + '</td></tr>'; }).join('') : '<tr><td class="muted">audio off</td></tr>';
  }

  // ---------- live buttons ----------
  function syncBtns() { $('btn-heat').classList.toggle('on', S.heat); $('s-heat').checked = S.heat; $('btn-raw').classList.toggle('on', S.raw); $('btn-zone').classList.toggle('on', !!zoneEdit || S.zones.length > 0); $('btn-run').textContent = running ? 'PAUSE' : 'RESUME'; }
  $('btn-heat').onclick = function () { S.heat = !S.heat; save(); syncBtns(); };
  $('btn-raw').onclick = function () { S.raw = !S.raw; save(); syncBtns(); };
  $('btn-ref').onclick = function () { if (prevGray) { refGray = prevGray.slice(); toast('Reference frame set'); logEvent('manual', 'reference set', null, 'scene-change reference frame'); } };
  $('btn-snap').onclick = function () { logEvent('manual', 'snapshot', null, 'manual snapshot').then(function (e) { toast(e.snap ? 'Snapshot saved' : 'Logged (snapshots unavailable/off)'); }); };
  $('btn-run').onclick = function () { running = !running; if (running) { video.play(); tracker.reset(); endGap(); } else beginGap('paused by user'); syncBtns(); };

  // ---------- boot ----------
  async function boot() {
    await detectCaps(); await SStore.init(); buildSettings(); syncBtns(); applyZones();
    $('splash-mic').checked = S.audio; if (!caps.audio) { $('splash-mic').checked = false; $('splash-mic').disabled = true; }
    if (!window.tf) { status('CDN LOAD FAILED — check connection'); return; }
    try { await SDet2.load(S.model, { inputSize: S.size || undefined }, status); var c = SDet2.current(); status('READY · ' + c.backend.toUpperCase() + ' · TAP START'); }
    catch (e) { console.error(e); status('MODEL FAILED (' + e.message + ') → COCO-SSD'); try { S.model = 'coco-lite'; await SDet2.load('coco-lite', {}, status); status('READY (fallback COCO-SSD) · TAP START'); } catch (e2) { status('MODEL LOAD FAILED'); } }
    SStore.persist();
  }
  $('btn-start').onclick = async function () {
    if (!caps.media) { status('CAMERA API UNAVAILABLE' + (caps.https ? '' : ' — PAGE MUST BE HTTPS')); return; }
    S.audio = $('splash-mic').checked; $('s-audio').checked = S.audio; save();
    status('STARTING CAMERA…'); keepAwake();
    try { await startCamera(S.audio); } catch (e) { status('CAMERA ' + (e.name === 'NotAllowedError' ? 'DENIED — see Help (Settings › Safari › Camera)' : 'ERROR: ' + e.name)); return; }
    started = true; running = true; $('splash').classList.add('hidden'); showTab('live'); syncBtns(); setupGeo();
    if (!SDet2.isReady()) { try { await SDet2.load(S.model, {}, status); } catch (e) { toast('Detector failed to load'); } }
    logEvent('manual', 'monitoring started', null, 'SENTINEL ' + VERSION + ' · ' + (SDet2.current() ? SDet2.current().label + ' @' + SDet2.current().inputSize + ' · ' + SDet2.current().backend : ''));
    startAudio();
  };
  requestAnimationFrame(loop); boot();
})();
