// Score raw detector outputs. node bench/score.js [--thr person=0.5,animal=0.5,vehicle=0.5] -> prints table, writes bench/results/scores.json
const fs = require('fs'), path = require('path'), C = require('../js/core.js');
const GT = JSON.parse(fs.readFileSync(path.join(__dirname, 'eval/ground_truth.json'))), byFile = Object.fromEntries(GT.map(g => [g.file, g]));
const GROUP = {}; C.GROUPS.People.forEach(c => GROUP[c] = 'person'); C.GROUPS.Animals.forEach(c => GROUP[c] = 'animal'); C.GROUPS.Vehicles.forEach(c => GROUP[c] = 'vehicle');
const G3 = ['person', 'animal', 'vehicle'], NEG_FPS = 2;
const pct = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
function present(dets, thr) { const p = {}; for (const d of dets) { const g = GROUP[d[0]]; if (g && d[1] >= thr[g]) p[g] = Math.max(p[g] || 0, d[1]); } return p; }
function score(rec, thr) {
  const M = Object.fromEntries(G3.concat('all').map(g => [g, { tp: 0, fp: 0, fn: 0 }])), hard = { tp: 0, fn: 0 };
  const neg = {}, negG = {}; let negFrames = 0, negFPFrames = 0;
  for (const it of rec.items) {
    const p = present(it.dets, thr);
    if (it.set === 'eval') {
      const g = byFile[it.file]; if (!g) continue;
      for (const k of G3) { const t = g.labels.includes(k), d = k in p; const m = M[k]; if (t && d) m.tp++; else if (t) m.fn++; else if (d) m.fp++; }
      if (g.tags.length) for (const k of g.labels) (k in p) ? hard.tp++ : hard.fn++;
    } else {
      negFrames++; if (Object.keys(p).length) negFPFrames++; for (const g of Object.keys(p)) negG[g] = (negG[g] || 0) + 1;
      const clip = it.file.replace(/_\d+\.jpg$|\.jpg$/, ''); (neg[clip] = neg[clip] || []).push(Object.keys(p));
    }
  }
  for (const k of G3) for (const f of ['tp', 'fp', 'fn']) M.all[f] += M[k][f];
  const fin = m => { const P = m.tp + m.fp ? m.tp / (m.tp + m.fp) : null, R = m.tp + m.fn ? m.tp / (m.tp + m.fn) : null; return { ...m, P, R, F1: P != null && R != null && P + R ? 2 * P * R / (P + R) : 0 }; };
  // persistence-confirmed alarms on negative foliage clips: group present in >=2 of last 3 sampled frames (2 fps), 10 s debounce
  let alarms = 0, negSec = 0;
  for (const [clip, fr] of Object.entries(neg)) {
    if (!/foliage/.test(clip)) continue; negSec += fr.length / NEG_FPS; const last = {};
    fr.forEach((gs, i) => { for (const g of G3) { const n = [0, 1, 2].filter(j => i - j >= 0 && fr[i - j].includes(g)).length; if (n >= 2 && (last[g] == null || (i - last[g]) / NEG_FPS >= 10)) { alarms++; last[g] = i; } } });
  }
  const tot = rec.t.map(x => x[0] + x[1] + x[2]);
  return { name: rec.name, label: rec.label, backend: rec.backend, loadMs: rec.loadMs, ...Object.fromEntries(G3.concat('all').map(k => [k, fin(M[k])])),
    negFPByGroup: Object.fromEntries(G3.map(g => [g, (negG[g] || 0) / Math.max(1, negFrames)])), hardRecall: hard.tp / Math.max(1, hard.tp + hard.fn), negFrames, negFPFrameRate: negFPFrames / Math.max(1, negFrames), rawFPperMin: negFPFrames / Math.max(1e-9, negFrames / NEG_FPS / 60),
    confirmedFPperMin: alarms / Math.max(1e-9, negSec / 60), p50: pct(tot, .5), p95: pct(tot, .95), pre50: pct(rec.t.map(x => x[0]), .5), inf50: pct(rec.t.map(x => x[1]), .5), post50: pct(rec.t.map(x => x[2]), .5) };
}
function load() { const d = path.join(__dirname, 'results'); return fs.readdirSync(d).filter(f => f.startsWith('raw_')).map(f => JSON.parse(fs.readFileSync(path.join(d, f)))).filter(r => !r.error); }
function bestThr(rec, g) { let best = { t: 0.8, f: -1 }; for (let t = 0.2; t <= 0.8001; t += 0.05) { const thr = { person: 1, animal: 1, vehicle: 1 }; thr[g] = t; const sc = score(rec, thr), s = sc[g]; if (sc.negFPByGroup[g] <= 0.03 && s.F1 > best.f + 1e-9) best = { t: +t.toFixed(2), f: s.F1 }; } return best.t; }
if (require.main === module) {
  const arg = (process.argv.find(a => a.startsWith('--thr=')) || '').slice(6), fixed = { person: 0.5, animal: 0.5, vehicle: 0.5 };
  arg.split(',').filter(Boolean).forEach(kv => { const [k, v] = kv.split('='); fixed[k] = +v; });
  const out = {}, f = v => v == null ? '  —  ' : (v * 100).toFixed(0).padStart(4) + '%', ms = v => v == null ? '—' : v.toFixed(0);
  console.log('config'.padEnd(18), 'backend'.padEnd(14), 'thr   ', 'pers P/R    ', 'anim P/R    ', 'veh P/R     ', 'ALL F1', 'hardR', 'rawFP/min', 'confFP/min', 'p50ms', 'p95ms');
  for (const rec of load().sort((a, b) => a.name.localeCompare(b.name))) {
    const tuned = rec.name.startsWith('v1') ? fixed : { person: bestThr(rec, 'person'), animal: bestThr(rec, 'animal'), vehicle: bestThr(rec, 'vehicle') };
    out[rec.name] = { fixed: score(rec, fixed), tuned: score(rec, tuned), tunedThr: tuned };
    for (const [k, s] of [['@0.5', out[rec.name].fixed], ['tuned', out[rec.name].tuned]]) {
      if (rec.name.startsWith('v1') && k === 'tuned') continue;
      console.log(rec.name.padEnd(18), String(rec.backend).padEnd(14), k.padEnd(6), f(s.person.P) + f(s.person.R), ' ', f(s.animal.P) + f(s.animal.R), ' ', f(s.vehicle.P) + f(s.vehicle.R), ' ', f(s.all.F1), f(s.hardRecall), s.rawFPperMin.toFixed(1).padStart(8), s.confirmedFPperMin.toFixed(2).padStart(9), ms(s.p50).padStart(6), ms(s.p95).padStart(6), k === 'tuned' ? JSON.stringify(tuned) : '');
    }
  }
  fs.writeFileSync(path.join(__dirname, 'results/scores.json'), JSON.stringify(out, null, 1));
}
module.exports = { score, load, bestThr };
