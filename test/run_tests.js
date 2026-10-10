// SENTINEL headless test runner. Usage: node test/run_tests.js  (serves repo on :8091 itself)
const puppeteer = require('/tmp/pwtest/node_modules/puppeteer-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), OUT = __dirname, PORT = 8091, BASE = process.env.BASE || `http://localhost:${PORT}`;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.csv': 'text/csv', '.bin': 'application/octet-stream', '.mp4': 'video/mp4', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  if (!process.env.BASE) await new Promise(r => srv.listen(PORT, r));
  const results = { unit: require('./unit_core.js') };
  delete results.unit.metrics;
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=/tmp/sentinel/cam.y4m', '--use-file-for-fake-audio-capture=' + path.join(OUT, 'dog_bark.wav')] });
  const ctx = browser.defaultBrowserContext(); await ctx.overridePermissions(BASE, ['camera', 'microphone', 'geolocation']);
  function watch(page) { const errs = []; page.on('pageerror', e => errs.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); }); page.on('requestfailed', q => errs.push('reqfail: ' + q.url())); return errs; }
  // 1. model harness
  { const page = await browser.newPage(), errs = watch(page); await page.setViewport({ width: 1500, height: 900 });
    await page.goto(BASE + '/test/harness.html'); await page.waitForFunction('window.__harness && window.__harness.done', { timeout: 300000 });
    results.harness = await page.evaluate(() => window.__harness); results.harness.jsErrors = errs;
    await page.screenshot({ path: OUT + '/harness.png', fullPage: true }); await page.close(); }
  // 2. app on iPhone-size viewport with fake camera (person+dog photo, shifts every 2s) + fake mic (dog bark loop)
  { const page = await browser.newPage(), errs = watch(page);
    await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.setGeolocation({ latitude: 44.2601, longitude: -72.5754, accuracy: 15 });
    await page.goto(BASE + '/'); await page.evaluate(() => localStorage.clear()); await page.reload();
    await page.waitForFunction(() => /READY/.test(document.getElementById('status').textContent), { timeout: 180000 });
    await page.screenshot({ path: OUT + '/app_splash.png' });
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('sentinel.settings.v1') || '{}'); }); 
    await page.click('#btn-start'); await page.waitForFunction(() => document.getElementById('splash').classList.contains('hidden'), { timeout: 30000 });
    await page.evaluate(() => { document.getElementById('s-geo').click(); document.getElementById('s-heat').click(); });
    await page.waitForFunction(() => window.__sentinel.state().audioOk || /disabled/.test(document.getElementById('sound-panel').textContent), { timeout: 120000 });
    await page.evaluate(() => document.getElementById('btn-ref').click());
    await sleep(9000);
    const live = await page.evaluate(() => { const s = window.__sentinel.state(); return { state: { ...s, lastDets: s.lastDets.map(d => d.cls + ' ' + d.score.toFixed(2)) }, hud: document.getElementById('hud').innerText, sound: document.getElementById('sound-panel').innerText, tensors: tf.memory().numTensors }; });
    await page.screenshot({ path: OUT + '/app_live.png' });
    await sleep(3000); live.tensorsLater = await page.evaluate(() => tf.memory().numTensors);
    // field test: 1 trial with person+dog present, backpack absent
    await page.evaluate(() => document.querySelector('#tabs [data-tab=field]').click()); await sleep(300);
    await page.evaluate(() => { document.getElementById('ft-dur').value = 5; document.getElementById('ft-dur').onchange(); document.querySelectorAll('#ft-truth input').forEach(i => { i.checked = i.value !== 'backpack'; }); document.getElementById('ft-start').click(); });
    await sleep(2500); await page.screenshot({ path: OUT + '/app_trial.png' });
    await page.evaluate(() => { document.getElementById('mark-label').value = 'backpack'; document.getElementById('btn-mark-fp').click(); });
    await sleep(3500); await page.evaluate(() => document.querySelector('#tabs [data-tab=field]').click()); await sleep(300);
    const ft = await page.evaluate(() => ({ trials: window.__sentinel.field().trials.map(t => ({ truth: t.truth, nDets: t.dets.length, labels: [...new Set(t.dets.map(d => d.label))], marks: t.marks })), table: document.getElementById('ft-table').innerText }));
    await page.screenshot({ path: OUT + '/app_fieldtest.png', fullPage: true });
    // log + exports
    await page.evaluate(() => document.querySelector('#tabs [data-tab=log]').click()); await sleep(1500);
    await page.screenshot({ path: OUT + '/app_log.png' });
    const exp = await page.evaluate(async () => {
      const r = {}; const evs = window.__sentinel.events(); r.nEvents = evs.length; r.types = [...new Set(evs.map(e => e.type))]; r.withGeo = evs.filter(e => e.geo).length; r.withSnap = evs.filter(e => e.snap).length;
      r.sample = evs.slice(0, 6).map(e => `${e.ts} ${e.type} ${e.label} ${e.conf}`);
      const csv = SCore.eventsCSV(evs), lines = csv.trim().split('\n'); r.csvHeader = lines[0]; r.csvRows = lines.length - 1;
      r.csvValid = lines.length - 1 === evs.length && lines.slice(1).every(l => l.match(/^ev\w+,\d{4}-\d\d-\d\dT/));
      const blobs = []; const orig = URL.createObjectURL; URL.createObjectURL = b => { blobs.push(b); return orig(b); };
      document.getElementById('exp-ev-json').click(); document.getElementById('exp-zip').click(); for (let i = 0; i < 60 && !blobs.some(b => b.name && /\.zip$/.test(b.name)); i++) await new Promise(r => setTimeout(r, 500));
      document.querySelector('#tabs [data-tab=field]').click(); document.getElementById('ft-json').click(); document.getElementById('ft-csv').click();
      URL.createObjectURL = orig;
      const j = JSON.parse(await blobs[0].text()); r.jsonValid = Array.isArray(j.events) && j.events.length >= evs.length;
      const zip = await JSZip.loadAsync(blobs.find(b => b.name && /\.zip$/.test(b.name))); r.zipFiles = Object.keys(zip.files).length; r.zipSample = Object.keys(zip.files).slice(0, 6);
      const fj = JSON.parse(await blobs.find(b => b.name && /fieldtest_\d/.test(b.name) && b.type === 'application/json').text()); r.fieldJsonMetrics = fj.metrics.overall;
      r.fieldCsv = (await blobs.find(b => b.name && /metrics/.test(b.name)).text()).trim().split('\n');
      r.downloadLinks = [...document.querySelectorAll('.dl-links a')].map(a => a.textContent);
      return r; });
    // settings + help screenshots
    for (const t of ['settings', 'help']) { await page.evaluate(t => document.querySelector(`#tabs [data-tab=${t}]`).click(), t); await sleep(300); await page.screenshot({ path: OUT + `/app_${t}.png` }); }
    results.app = { live, fieldTest: ft, export: exp, jsErrors: errs };
    await page.close(); }
  await browser.close(); srv.close();
  fs.writeFileSync(OUT + '/results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
