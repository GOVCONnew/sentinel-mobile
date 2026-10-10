// node bench/run_bench.js [config,config...]  -> bench/results/raw_<config>.json (one browser per config for clean memory)
const puppeteer = require('/tmp/pwtest/node_modules/puppeteer-core'), fs = require('fs'), path = require('path'), serve = require('../test/server.js');
const ROOT = path.resolve(__dirname, '..'), PORT = 8092;
const ALL = ['v1-coco-lite', 'v1-coco-mnv2', 'coco-lite@320', 'coco-mnv2@320', 'effdet0@320', 'effdet2@448', 'yolov8n@320', 'yolov8n@416', 'yolov8n@640', 'yolo11n@320', 'yolo11n@416', 'yolo11n@640', 'yolo11n@416+enh', 'effdet2@448+enh'];
(async () => {
  const srv = await serve(ROOT, PORT); fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  for (const c of (process.argv[2] ? process.argv[2].split(',') : ALL)) {
    const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 1800000, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const p = await b.newPage(); p.on('console', m => { if (m.type() === 'error') console.log('  console:', m.text().slice(0, 200)); });
    await p.goto(`http://localhost:${PORT}/bench/bench.html?configs=${encodeURIComponent(c)}`);
    await p.waitForFunction('window.__bench && window.__bench.done', { timeout: 1800000, polling: 2000 });
    const r = await p.evaluate(() => window.__bench.results);
    fs.writeFileSync(path.join(__dirname, 'results', 'raw_' + c.replace(/[@+]/g, '_') + '.json'), JSON.stringify(r[c]));
    const t = r[c].t ? r[c].t.map(x => x[0] + x[1] + x[2]).sort((a, b) => a - b) : [];
    console.log(c, r[c].backend, r[c].error ? 'ERROR ' + r[c].error.slice(0, 300) : `p50 ${t[t.length >> 1].toFixed(0)}ms`);
    await b.close();
  }
  srv.close();
})();
