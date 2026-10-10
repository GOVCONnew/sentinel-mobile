const puppeteer = require('/tmp/pwtest/node_modules/puppeteer-core'), fs = require('fs'), path = require('path'), serve = require('../test/server.js');
(async () => { const srv = await serve(path.resolve(__dirname, '..'), 8093);
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 900000, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage(); await p.goto('http://localhost:8093/bench/audio_dump.html'); await p.waitForFunction('window.__dump && window.__dump.done', { timeout: 900000, polling: 2000 });
  fs.writeFileSync(path.join(__dirname, 'results/yamnet_dump.json'), JSON.stringify(await p.evaluate(() => window.__dump))); await b.close(); srv.close(); console.log('ok'); })();
