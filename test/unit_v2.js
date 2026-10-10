// Node unit tests for SENTINEL v2 modules. Run: node test/unit_v2.js
const C = require('../js/core.js'), T = require('../js/track.js'), MO = require('../js/motion.js'), A = require('../js/audiologic.js'), I = require('../js/incidents.js');
let pass = 0, fail = 0; const out = [];
function ok(name, cond, info) { (cond ? pass++ : fail++); out.push((cond ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); }
// NMS
const n = C.nmsClassAware([{ cls: 'person', score: .9, x: 0, y: 0, w: 10, h: 10 }, { cls: 'person', score: .8, x: 1, y: 0, w: 10, h: 10 }, { cls: 'dog', score: .7, x: 1, y: 0, w: 10, h: 10 }, { cls: 'person', score: .6, x: 50, y: 0, w: 10, h: 10 }], .5);
ok('class-aware NMS', n.kept.length === 3 && n.suppressed.length === 1 && n.suppressed[0].det.score === .8);
// enhancement
const dark = new Uint8ClampedArray(4 * 1000); for (let i = 0; i < dark.length; i += 4) { dark[i] = dark[i + 1] = dark[i + 2] = 20 + (i / 4) % 30; dark[i + 3] = 255; }
const e1 = C.enhanceRGBA(dark, { mode: 'auto' }); let m = 0; for (let i = 0; i < dark.length; i += 4) m += dark[i]; ok('enhance brightens dark frame', e1.applied && m / 1000 > 80, 'mean after ' + (m / 1000).toFixed(0));
const bright = new Uint8ClampedArray(4 * 100).fill(180); ok('enhance skips normal frame (auto)', !C.enhanceRGBA(bright, { mode: 'auto' }).applied);
// tracker
const det = (x, s = .7, cls = 'person') => ({ cls, score: s, x, y: 100, w: 40, h: 100 });
let tr = new T.Tracker(), confAt = -1; for (let i = 0; i < 6; i++) { if (tr.update([det(100 + i * 4)], 640, 480, i * 200).confirmed.length) confAt = i; }
ok('confirm after N=3 of M=5', confAt === 2, 'confirmed at frame ' + confAt);
tr = new T.Tracker(); let c2 = 0; for (let i = 0; i < 12; i++) c2 += tr.update(i % 4 === 0 ? [det(i * 40, .9)] : [], 640, 480, i * 200).confirmed.length; ok('isolated flicker never confirms', c2 === 0);
tr = new T.Tracker(); const ids = []; for (let i = 0; i < 14; i++) { const vis = i < 5 || i > 8; tr.update(vis ? [det(100 + i * 6)] : [], 640, 480, i * 200); const t = tr.tracks.find(t => t.id); if (t && vis) ids.push(t.id); }
ok('stable ID across 4-frame occlusion (velocity prediction)', ids.length > 5 && ids.every(x => x === ids[0]), JSON.stringify([...new Set(ids)]));
tr = new T.Tracker(); let lowAlive = true; for (let i = 0; i < 10; i++) { tr.update([det(100, i < 3 ? .8 : .3)], 640, 480, i * 200); } lowAlive = tr.tracks.some(t => t.state === 'confirmed');
ok('low-score matches keep confirmed track alive (ByteTrack 2nd stage)', lowAlive);
tr = new T.Tracker(); let c3 = 0; for (let i = 0; i < 10; i++) c3 += tr.update([det(100, .3)], 640, 480, i * 200).confirmed.length; ok('below class threshold never confirms', c3 === 0 && tr.update([det(100, .3)], 640, 480, 2200).diag[0].reason === 'below_class_threshold');
tr = new T.Tracker({ zones: [{ type: 'roi', pts: [[0.5, 0], [1, 0], [1, 1], [0.5, 1]] }] }); let ev = 0; for (let i = 0; i < 6; i++) ev += tr.update([det(100, .9)], 640, 480, i * 200).events.length; ok('confirmed track outside ROI → no event', ev === 0 && tr.tracks[0].zone === 'outside_roi');
tr = new T.Tracker({ zones: [{ type: 'exclude', pts: [[0, 0], [0.4, 0], [0.4, 1], [0, 1]] }] }); ev = 0; for (let i = 0; i < 6; i++) ev += tr.update([det(400, .9)], 640, 480, i * 200).events.length; ok('confirmed track outside exclusion → 1 event', ev === 1);
tr = new T.Tracker({ allowedClasses: new Set(['person']) }); ok('class filter reason', tr.update([det(1, .9, 'car')], 640, 480, 0).diag[0].reason === 'class_filtered');
// motion engine
const W = 160, H = 120; function tex(seed) { const a = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = 100 + 50 * Math.sin(x * .37 + seed) * Math.cos(y * .29) + 30 * Math.sin((x + y) * .11); return a; }
const base = tex(0); function shifted(dx, dy, gain = 1) { const a = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const sx = Math.min(W - 1, Math.max(0, x - dx)), sy = Math.min(H - 1, Math.max(0, y - dy)); a[y * W + x] = Math.min(255, base[sy * W + sx] * gain); } return a; }
let E = new MO.Engine(W, H), alerts = 0; for (let i = 0; i < 80; i++) { const r = E.process(shifted(Math.round(3 * Math.sin(i * 1.3)), Math.round(2 * Math.cos(i * .9)), 0.8 + 0.2 * Math.sin(i / 8)), i * 100); if (r.alert) alerts++; }
ok('motion: camera shake + light ramp → no alert', alerts === 0, 'alerts ' + alerts + ', last shift ' + E.shift);
E = new MO.Engine(W, H); let first = -1; for (let i = 0; i < 80; i++) { const f = shifted(0, 0); if (i >= 40) { const x0 = 10 + (i - 40) * 3; for (let y = 60; y < 90; y++) for (let x = x0; x < x0 + 12; x++) f[y * W + x] = 20; } const r = E.process(f, i * 100); if (r.alert && first < 0) first = i; }
ok('motion: walking dark blob → coherent alert', first >= 40 && first < 50, 'first alert frame ' + first);
const zm = MO.zoneMask([{ type: 'exclude', pts: [[0, 0], [1, 0], [1, 1], [0, 1]] }], W, H, T.pointInPoly); E = new MO.Engine(W, H); E.setZoneMask(zm); let za = 0; for (let i = 0; i < 80; i++) { const f = shifted(0, 0); if (i >= 40) { const x0 = 10 + (i - 40) * 3; for (let y = 60; y < 90; y++) for (let x = x0; x < x0 + 12; x++) f[y * W + x] = 20; } if (E.process(f, i * 100).alert) za++; }
ok('motion: exclusion zone suppresses alert', za === 0);
// audio logic
const classes = ['Speech', 'Dog', 'Bark', 'Vehicle', 'Car', 'Wind', 'Rain', 'Bird', 'Chainsaw', 'Gunshot, gunfire'];
const ix = Object.fromEntries(classes.map((c, i) => [c, i]));
let S = new A.Smoother(classes), evs = []; for (let i = 0; i < 40; i++) { const s = {}; s[ix.Wind] = .7; s[ix.Car] = .35; s[ix.Vehicle] = .95; S.push(s, -25, i * 500).events.forEach(e => evs.push(e.cat)); }
ok('audio: wind + vehicle confusion → no event', evs.length === 0, JSON.stringify(evs));
S = new A.Smoother(classes); evs = []; for (let i = 0; i < 20; i++) { const s = {}; if (i >= 10 && i < 13) s[ix.Dog] = .8; S.push(s, -25, i * 500).events.forEach(e => evs.push(e.cat + '@' + i)); }
ok('audio: dog bark → Dog event', evs.length === 1 && evs[0].startsWith('Dog'), JSON.stringify(evs));
S = new A.Smoother(classes); evs = []; for (let i = 0; i < 20; i++) { const s = {}; if (i === 10) s[ix.Bird] = .9; S.push(s, -25, i * 500).events.forEach(e => evs.push(e.cat)); }
ok('audio: single-window bird blip (minWin 2) → no event', evs.length === 0);
S = new A.Smoother(classes); evs = []; for (let i = 0; i < 400; i++) { const s = {}; s[ix.Car] = .45; S.push(s, -25, i * 500).events.forEach(e => evs.push(i)); }
ok('audio: steady engine → onset event, then absorbed by baseline', evs.length >= 1 && evs.length <= 6 && evs[evs.length-1] < 140, JSON.stringify(evs));
// incidents + field test
const IM = new I.IncidentManager(); IM.add({ t: 0, kind: 'motion', coherent: true }); ok('motion cue alone does not open incident (default)', !IM.cur);
IM.add({ t: 1000, kind: 'track', trackId: 3, label: 'person', group: 'person', score: .8, firstSeen: 400 }); IM.add({ t: 5000, kind: 'audio', label: 'Speech', score: .6 });
ok('incident: reasons + co-occurrence (possibly related)', IM.cur.reasons.length === 2 && IM.cur.correlation && /possibly related/.test(IM.cur.correlation.note) && IM.cur.tracks['3'].timeToConfirmMs === 600);
IM.tick(40000, []); ok('incident closes after gap', !IM.cur);
const recs = [{ id: 'a', ts: '2026-10-10T10:00:00Z', type: 'object', label: 'person', conf: .8 }, { id: 'b', ts: '2026-10-11T10:00:00Z', type: 'sound', label: 'Dog', conf: .4, detail: 'bark' }];
ok('search filter', I.filterRecords(recs, { type: 'sound' }).length === 1 && I.filterRecords(recs, { minConf: .5 }).length === 1 && I.filterRecords(recs, { text: 'bark' }).length === 1 && I.filterRecords(recs, { from: Date.parse('2026-10-11') }).length === 1);
const sess = { start: Date.parse('2026-10-10T10:00:00Z'), end: Date.parse('2026-10-10T10:30:00Z'), geo: { lat: 44.26012, lon: -72.57541 }, model: 'effdet0' };
const labs = [{ t: sess.start + 61234, kind: 'tp', cls: 'person', conf: .83, ttcMs: 640 }, { t: sess.start + 120000, kind: 'fp', cls: 'dog', conf: .4 }, { t: sess.start + 130000, kind: 'miss', cls: 'person' }];
const fm = I.fieldMetricsV2(labs, sess); ok('field v2 metrics', fm.classes.person.tp === 1 && fm.classes.person.fn === 1 && fm.classes.person.recall === .5 && fm.classes.dog.fpPerHour === 2 && fm.overall.precision === .5 && fm.overall.meanTimeToConfirmMs === 640);
const an = I.anonymize(sess, labs), anJ = JSON.stringify(an); ok('anonymised export: relative/rounded times, no GPS by default, no images', an.gps === null && an.labels[0].tSec === 61 && !/2026-10-10T/.test(anJ) && !/snap|jpg|data:image/.test(anJ) && an.date === '2026-10-10');
ok('anonymised export: coarse GPS only when opted in', JSON.stringify(I.anonymize(sess, labs, { includeGps: true }).gps) === '{"lat":44.26,"lon":-72.58}');
console.log(out.join('\n')); console.log(`unit v2: ${pass} passed, ${fail} failed`);
module.exports = { pass, fail, out };
if (require.main === module && fail) process.exit(1);
