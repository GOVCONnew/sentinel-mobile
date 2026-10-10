// SENTINEL 2.0 headless test runner. Usage: node test/run_tests.js   (BASE=https://... to test the deployed site)
const puppeteer = require('/tmp/pwtest/node_modules/puppeteer-core'), fs = require('fs'), path = require('path'), serve = require('./server.js');
const ROOT = path.resolve(__dirname, '..'), OUT = __dirname, PORT = 8091, BASE = process.env.BASE || `http://localhost:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let srv = null; if (!process.env.BASE) srv = await serve(ROOT, PORT);
  const results = { unitCore: require('./unit_core.js'), unitV2: require('./unit_v2.js') }; delete results.unitCore.metrics;
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 600000,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=/tmp/sentinel/cam.y4m', '--use-file-for-fake-audio-capture=' + path.join(OUT, 'dog_bark.wav')] });
  const ctx = browser.defaultBrowserContext(); await ctx.overridePermissions(BASE, ['camera', 'microphone', 'geolocation']);
  function watch(page) { const errs = []; page.on('pageerror', e => errs.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|^INFO: |W:onnxruntime/.test(m.text())) errs.push('console: ' + m.text()); }); page.on('requestfailed', q => { if (!/favicon/.test(q.url())) errs.push('reqfail: ' + q.url()); }); return errs; }
  // 1. model harness
  { const page = await browser.newPage(), errs = watch(page); await page.setViewport({ width: 1500, height: 900 });
    await page.goto(BASE + '/test/harness.html'); await page.waitForFunction('window.__harness && window.__harness.done', { timeout: 300000 });
    results.harness = await page.evaluate(() => window.__harness); results.harness.jsErrors = errs;
    await page.screenshot({ path: OUT + '/harness.png', fullPage: true }); await page.close(); }
  // 2. app on iPhone-size viewport
  { const page = await browser.newPage(), errs = watch(page);
    await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 2, isMobile: true, hasTouch: false });
    await page.setGeolocation({ latitude: 44.2601, longitude: -72.5754, accuracy: 15 });
    await page.goto(BASE + '/'); await page.evaluate(() => new Promise(r => { localStorage.clear(); const q = indexedDB.deleteDatabase('sentinel'); q.onsuccess = q.onerror = q.onblocked = r; })); await page.reload();
    await page.waitForFunction(() => /READY/.test(document.getElementById('status').textContent), { timeout: 180000 });
    const statusBefore = await page.$eval('#status', e => e.textContent);
    await page.screenshot({ path: OUT + '/app_splash.png' });
    await page.click('#btn-start'); await page.waitForFunction(() => document.getElementById('splash').classList.contains('hidden'), { timeout: 30000 });
    await page.evaluate(() => { document.getElementById('s-geo').click(); });
    await page.waitForFunction(() => window.__sentinel.state().audioOk || /disabled/.test(document.getElementById('sound-panel').textContent), { timeout: 120000 });
    await page.waitForFunction(() => window.__sentinel.state().tracks.filter(t => t.state === 'confirmed').length >= 2, { timeout: 60000 }).catch(() => {});
    await sleep(6000);
    const live = await page.evaluate(() => ({ state: window.__sentinel.state(), hud: document.getElementById('hud').innerText, version: window.__sentinel.VERSION }));
    await page.screenshot({ path: OUT + '/app_live_raw_confirmed.png' });
    // tap-to-label: TP on a confirmed box, MISS on empty space
    await page.evaluate(() => document.querySelector('#tabs [data-tab=field]').click()); await page.click('#lb-start'); await sleep(800);
    const box = await page.evaluate(() => { const v = document.getElementById('cam'), r = document.getElementById('overlay').getBoundingClientRect(), t = window.__sentinel.tracker.confirmedVisible()[0]; if (!t) return null; const s = Math.max(r.width / v.videoWidth, r.height / v.videoHeight), ox = (r.width - v.videoWidth * s) / 2, oy = (r.height - v.videoHeight * s) / 2; return { x: r.left + ox + (t.box.x + t.box.w / 2) * s, y: r.top + oy + (t.box.y + t.box.h / 2) * s, label: t.label }; });
    if (box) { await page.mouse.click(box.x, box.y); await sleep(300); await page.screenshot({ path: OUT + '/app_label_sheet.png' }); await page.evaluate(() => document.querySelector('#labelsheet [data-k=tp]').click()); }
    await page.mouse.click(30, 330); await sleep(300); await page.evaluate(() => { const b = document.querySelector('#labelsheet [data-k=miss]'); if (b) b.click(); });
    await page.evaluate(() => document.querySelector('#tabs [data-tab=field]').click()); await page.click('#lb-stop'); await sleep(300);
    const labeling = await page.evaluate(() => ({ labels: window.__sentinel.field().lab.labels, table: document.getElementById('lb-table').innerText }));
    // timed trial (v1 flow kept)
    await page.evaluate(() => { document.getElementById('ft-dur').value = 4; document.getElementById('ft-dur').onchange(); document.querySelectorAll('#ft-truth input').forEach(i => { i.checked = i.value !== 'backpack'; }); document.getElementById('ft-start').click(); });
    await sleep(5500); await page.evaluate(() => document.querySelector('#tabs [data-tab=field]').click()); await sleep(300);
    const trial = await page.evaluate(() => document.getElementById('ft-table').innerText);
    await page.screenshot({ path: OUT + '/app_fieldtest.png', fullPage: true });
    // simulated iOS backgrounding → monitoring gap
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(2500); const pausedHud = await page.$eval('#h-mon', e => e.textContent);
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(1500);
    // diagnostics
    await page.evaluate(() => document.querySelector('#tabs [data-tab=diag]').click()); await sleep(1200);
    const diag = await page.evaluate(() => ({ stats: document.getElementById('d-stats').innerText, raw: document.getElementById('d-raw').innerText.split('\n').slice(0, 6), tracks: document.getElementById('d-tracks').innerText.split('\n').slice(0, 5) }));
    await page.screenshot({ path: OUT + '/app_diagnostics.png', fullPage: true });
    // history: incidents + events
    await page.evaluate(() => document.querySelector('#tabs [data-tab=log]').click()); await sleep(1500);
    await page.screenshot({ path: OUT + '/app_incidents.png', fullPage: true });
    await page.evaluate(() => document.getElementById('view-ev').click()); await sleep(1200);
    await page.screenshot({ path: OUT + '/app_events.png' });
    const exp = await page.evaluate(async () => {
      const r = {}, evs = await SStore.allEvents(), incs = await SStore.allIncidents();
      r.nEvents = evs.length; r.types = [...new Set(evs.map(e => e.type))]; r.withGeo = evs.filter(e => e.geo).length; r.withSnap = evs.filter(e => e.snap).length; r.gap = evs.filter(e => e.type === 'gap').map(e => e.detail);
      r.sample = evs.slice(0, 8).map(e => `${e.ts} ${e.type} ${e.label} ${e.conf}`);
      r.incidents = incs.map(I => ({ labels: I.labels, reasons: I.reasons, tracks: Object.values(I.tracks).map(t => t.label + '#' + t.id + ' ttc ' + t.timeToConfirmMs), audio: I.audio, correlation: I.correlation && I.correlation.type, snaps: (I.snaps || []).length }));
      const csv = SCore.eventsCSV(evs).trim().split('\n'); r.csvValid = csv.length - 1 === evs.length && csv.slice(1).every(l => /^ev\w+,\d{4}-\d\d-\d\dT/.test(l));
      const blobs = [], orig = URL.createObjectURL; URL.createObjectURL = b => { blobs.push(b); return orig(b); };
      document.getElementById('exp-ev-json').click(); document.getElementById('exp-ev-csv').click(); document.getElementById('exp-zip').click();
      for (let i = 0; i < 60 && !blobs.some(b => /\.zip$/.test(b.name || '')); i++) await new Promise(r => setTimeout(r, 500));
      document.querySelector('#tabs [data-tab=field]').click(); document.getElementById('lb-json').click(); document.getElementById('lb-csv').click(); document.getElementById('ft-csv').click();
      URL.createObjectURL = orig;
      const j = JSON.parse(await blobs.find(b => /^sentinel_\d.*\.json$/.test(b.name)).text()); r.jsonValid = Array.isArray(j.events) && j.events.length >= evs.length && Array.isArray(j.incidents) && j.version === '2.0.0';
      r.incCsvHeader = (await blobs.find(b => /incidents/.test(b.name)).text()).split('\n')[0];
      const zip = await JSZip.loadAsync(blobs.find(b => /\.zip$/.test(b.name))); r.zipFiles = Object.keys(zip.files).length; r.zipSnapshots = Object.keys(zip.files).filter(f => /snapshots\/.+\.jpg/.test(f)).length;
      const an = await blobs.find(b => /anon_\d/.test(b.name) && /json$/.test(b.name)).text(); const aj = JSON.parse(an);
      r.anon = { gps: aj.gps, labels: aj.labels, metrics: aj.metrics.overall, noIsoTimestamps: !/\d{4}-\d\d-\d\dT\d\d/.test(an), noImages: !/jpg|image|snap/i.test(an), noPreciseGeo: !/44\.26|72\.57/.test(an) };
      r.anonCsv = (await blobs.find(b => /anon_metrics/.test(b.name)).text()).trim().split('\n');
      return r; });
    for (const t of ['settings', 'help']) { await page.evaluate(t => document.querySelector(`#tabs [data-tab=${t}]`).click(), t); await sleep(300); await page.screenshot({ path: OUT + `/app_${t}.png` }); }
    results.app = { statusBefore, live, labeling, trial, pausedHud, diag, export: exp, jsErrors: errs };
    await page.close(); }
  await browser.close(); if (srv) srv.close();
  // verdict
  const a = results.app, c = [];
  c.push(['unit core', results.unitCore.fail === 0]); c.push(['unit v2', results.unitV2.fail === 0]); c.push(['harness', results.harness.ok && !results.harness.errors.length]);
  c.push(['no JS errors', !a.jsErrors.length && !results.harness.jsErrors.length]); c.push(['version 2.0', a.live.version === '2.0.0']);
  c.push(['confirmed person+dog tracks', ['person', 'dog'].every(l => a.live.state.tracks.some(t => t.label === l && t.state === 'confirmed'))]);
  c.push(['object events + incident', a.export.types.includes('object') && a.export.incidents.length >= 1]);
  c.push(['sound event (Dog) via v2 logic', a.export.sample.concat(a.export.incidents.map(i => JSON.stringify(i.audio))).some(s => /Dog/.test(s))]);
  c.push(['monitoring gap logged', a.export.gap.length === 1 && /NOT monitoring/.test(a.export.gap[0]) && /PAUSED/.test(a.pausedHud)]);
  c.push(['labeling TP+miss', a.labeling.labels.some(l => l.kind === 'tp') && a.labeling.labels.some(l => l.kind === 'miss')]);
  c.push(['exports valid', a.export.csvValid && a.export.jsonValid && a.export.zipFiles > 3]);
  c.push(['anonymised export clean', a.export.anon.gps === null && a.export.anon.noIsoTimestamps && a.export.anon.noImages && a.export.anon.noPreciseGeo]);
  results.verdict = Object.fromEntries(c); results.allPass = c.every(x => x[1]);
  fs.writeFileSync(OUT + '/results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2)); console.log('ALL PASS:', results.allPass);
  process.exit(results.allPass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
