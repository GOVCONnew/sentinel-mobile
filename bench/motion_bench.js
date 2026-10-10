// Motion benchmark on bench/seq (real foliage video + synthetic sway/light/shadow/shake, positives with walking intruder).
// v1 = SCore.motion frame differencing @80x60, alert at >=3% changed (v1 default, sens 60), 10 s debounce.
// v2 = SMotion.Engine coherent-mover alert @160x120, 10 s debounce.
const fs = require('fs'), path = require('path'), C = require('../js/core.js'), MO = require('../js/motion.js');
const D = path.join(__dirname, 'seq'), idx = JSON.parse(fs.readFileSync(path.join(D, 'index.json')));
function down2(f, W, H) { const o = new Uint8Array(W * H / 4); for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) { const i = 2 * y * W + 2 * x; o[y * W / 2 + x] = (f[i] + f[i + 1] + f[i + W] + f[i + W + 1]) >> 2; } return o; }
function run(sens = 60) {
  const res = {};
  for (const [name, m] of Object.entries(idx)) {
    const buf = fs.readFileSync(path.join(D, name + '.bin')), N = m.n, sz = m.w * m.h, frames = [...Array(N)].map((_, i) => buf.subarray(i * sz, (i + 1) * sz));
    const out = {};
    for (const algo of ['v1', 'v2']) {
      let last = -1e9, alerts = [], prev = null; const E = new MO.Engine(m.w, m.h, { sens }); let ms = 0;
      frames.forEach((f, i) => {
        const t = i / m.fps, t0 = process.hrtime.bigint(); let a;
        if (algo === 'v1') { const g = down2(f, m.w, m.h); a = prev ? C.motion(prev, g, m.w / 2, m.h / 2, sens).pct >= 3 : false; prev = g; }
        else a = E.process(f, t * 1000).alert;
        ms += Number(process.hrtime.bigint() - t0) / 1e6;
        if (a && t - last >= 10) { alerts.push(+t.toFixed(1)); last = t; }
      });
      const w = m.intruder, inWin = w ? alerts.filter(t => t >= w[0] && t <= w[1] + 1) : [], fa = w ? alerts.length - inWin.length : alerts.length;
      out[algo] = { alerts, falseAlerts: fa, falsePerMin: fa / (N / m.fps / 60), detected: w ? inWin.length > 0 : null, delay: w && inWin.length ? +(inWin[0] - w[0]).toFixed(1) : null, msPerFrame: +(ms / N).toFixed(2) };
    }
    res[name] = { positive: !!m.intruder, seconds: N / m.fps, ...out };
  }
  return res;
}
if (require.main === module) {
  const r = run(+(process.argv[2] || 60)); fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true }); fs.writeFileSync(path.join(__dirname, 'results/motion.json'), JSON.stringify(r, null, 1));
  for (const [k, v] of Object.entries(r)) console.log(k.padEnd(26), v.positive ? 'POS' : 'neg', 'v1:', JSON.stringify(v.v1.alerts).padEnd(16), 'FA/min', v.v1.falsePerMin.toFixed(1), v.positive ? 'det ' + v.v1.detected : '', '| v2:', JSON.stringify(v.v2.alerts).padEnd(12), 'FA/min', v.v2.falsePerMin.toFixed(1), v.positive ? 'det ' + v.v2.detected + ' delay ' + v.v2.delay : '', v.v2.msPerFrame + 'ms');
}
module.exports = { run };
