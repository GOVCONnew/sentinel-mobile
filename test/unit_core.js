// Node unit tests for js/core.js (motion, field-test metrics, CSV). Run: node test/unit_core.js
const C = require('../js/core.js'); let pass = 0, fail = 0; const out = [];
function ok(name, cond, info) { (cond ? pass++ : fail++); out.push((cond ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); }
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
// motion
const W = 40, H = 30, a = new Uint8Array(W * H).fill(100), b = a.slice();
for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) b[y * W + x] = 200;
ok('motion identical = 0%', C.motion(a, a, W, H, 60).pct === 0);
const m = C.motion(a, b, W, H, 60); ok('motion differing ≈ 8.33%', near(m.pct, 100 / 12, 1e-6), m.pct.toFixed(3));
ok('motion ROI box excludes change', C.motion(a, b, W, H, 60, { type: 'box', x: 0.5, y: 0.5, w: 0.5, h: 0.5 }).pct === 0);
ok('motion ROI grid includes change', C.motion(a, b, W, H, 60, { type: 'grid', cols: 4, rows: 4, cells: [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0] }).pct === 100);
const c = a.slice(); for (let i = 0; i < c.length; i++) c[i] = 110; // small global drift
ok('low sensitivity ignores small drift', C.motion(a, c, W, H, 0).pct === 0); ok('max sensitivity sees drift', C.motion(a, c, W, H, 100).pct === 100);
const sc = C.sceneChange(a, b, null, W, H); ok('scene change', near(sc.changedPct, 100 / 12, 1e-6) && near(sc.meanPct, 100 * (100 * 100 / 1200) / 255, 1e-6), JSON.stringify(sc));
// debouncer
const d = new C.Debouncer(1000); ok('debounce', d.ok('k', 0) && !d.ok('k', 500) && d.ok('k', 1001) && d.ok('j', 600));
// tracker: same object over frames → one confirmed track
const tr = new C.Tracker({ minHits: 2 }); let fresh = 0;
for (let i = 0; i < 5; i++) fresh += tr.update([{ cls: 'dog', score: .8, x: 10 + i, y: 10, w: 50, h: 40 }], i * 100).length;
ok('tracker confirms once', fresh === 1);
// field metrics on synthetic trials
const T = [
  { id: 1, start: 0, end: 10000, truth: { person: true, dog: false }, dets: [{ label: 'person', score: .9, t: 1000 }, { label: 'person', score: .7, t: 2000 }], marks: [] },     // person TP (ttfd 1000), dog TN
  { id: 2, start: 20000, end: 30000, truth: { person: true, dog: true }, dets: [{ label: 'dog', score: .6, t: 23000 }], marks: [] },                                          // dog TP (3000), person FN
  { id: 3, start: 40000, end: 50000, truth: { person: false, dog: true }, dets: [{ label: 'person', score: .5, t: 41000 }, { label: 'cat', score: .4, t: 42000 }], marks: [{ kind: 'fp', label: 'person' }] }, // person FP + manual FP, dog FN, cat FP
  { id: 4, start: 60000, end: 70000, truth: { backpack: true }, dets: [{ label: 'backpack', score: .8, t: 60500 }], marks: [{ kind: 'miss', label: 'backpack' }] } // TP + manual miss
];
const M = C.fieldMetrics(T), P = M.classes.person, D = M.classes.dog, K = M.classes.cat, B = M.classes.backpack;
ok('person tp/fp/fn = 1/2/1', P.tp === 1 && P.fp === 2 && P.fn === 1, JSON.stringify(P));
ok('person precision 1/3, recall 1/2, f1 0.4', near(P.precision, 1 / 3) && near(P.recall, .5) && near(P.f1, .4));
ok('person meanConf (0.9+0.7+0.5)/3', near(P.meanConf, 0.7)); ok('person TTFD 1000ms', P.meanTTFDms === 1000);
ok('dog tp1 fn1 fp0, P=1 R=.5', D.tp === 1 && D.fn === 1 && D.fp === 0 && D.precision === 1 && D.recall === .5 && D.meanTTFDms === 3000);
ok('cat (not in truth) = FP', K.fp === 1 && K.tp === 0 && K.precision === 0 && K.recall === null && K.f1 === 0);
ok('backpack TP + manual miss', B.tp === 1 && B.fn === 1);
ok('overall tp3 fp3 fn3 P.5 R.5 TTFD1500', M.overall.tp === 3 && M.overall.fp === 3 && M.overall.fn === 3 && near(M.overall.precision, .5) && near(M.overall.recall, .5) && M.overall.meanTTFDms === 1500, JSON.stringify(M.overall));
// CSV
const csv = C.metricsCSV(M).trim().split('\n'); ok('metrics CSV rows', csv.length === 6 && csv[0].startsWith('label,trials,tp'), csv[0]);
ok('csv escaping', C.csvCell('a,"b"\nc') === '"a,""b""\nc"');
const ev = C.eventsCSV([{ id: 'e1', ts: '2026-10-10T00:00:00.000Z', type: 'sound', label: 'Bird', conf: .5, detail: 'YAMNet: Bird, "x"', geo: { lat: 1, lon: 2, acc: 3 }, snap: true }]);
ok('events CSV', ev.split('\n')[1] === 'e1,2026-10-10T00:00:00.000Z,sound,Bird,0.5000,"YAMNet: Bird, ""x""",1,2,3,snapshots/e1.jpg', ev.split('\n')[1]);
ok('trials CSV', C.trialsCSV(T).split('\n')[1].startsWith('1,1970-01-01T00:00:00.000Z,1970-01-01T00:00:10.000Z,10,person,dog,person,'));
console.log(out.join('\n')); console.log(`unit: ${pass} passed, ${fail} failed`);
module.exports = { pass, fail, out, metrics: M };
if (require.main === module && fail) process.exit(1);
