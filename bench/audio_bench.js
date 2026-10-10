// Replays bench/results/yamnet_dump.json through v1 and v2 audio event logic.
const fs = require('fs'), path = require('path'), A = require('../js/audiologic.js');
const D = JSON.parse(fs.readFileSync(path.join(__dirname, 'results/yamnet_dump.json')));
const EXPECT = { pos_bird_1: ['Bird'], pos_chainsaw_1: ['Chainsaw'], pos_dog_1: ['Dog'], pos_footsteps_birds_1: ['Footsteps', 'Bird'], pos_cars_birds_1: ['Vehicle', 'Bird'], pos_cars_2: ['Vehicle'], pos_gunshot_1: ['Gunshot'] };
const WATCH = ['Bird', 'Chainsaw', 'Gunshot', 'Vehicle', 'Dog', 'Speech', 'Footsteps'];
function run(opts) {
  const res = {};
  for (const [clip, wins] of Object.entries(D.clips)) {
    const sec = wins.length * 0.5 + 0.475, r = {};
    for (const algo of ['v1', 'v2']) {
      const L = algo === 'v1' ? new A.V1(D.classes, WATCH, 0.3) : new A.Smoother(D.classes, opts); const ev = [];
      wins.forEach(w => L.push(w.s, w.db, w.t * 1000).events.forEach(e => ev.push(e.cat + '@' + w.t.toFixed(1))));
      const exp = EXPECT[clip] || [], cats = ev.map(e => e.split('@')[0]), fp = cats.filter(c => !exp.includes(c)).length;
      r[algo] = { events: ev, fp, fpPerMin: fp / (sec / 60), hit: exp.length ? exp.some(c => cats.includes(c)) : null };
    }
    res[clip] = { seconds: sec, negative: clip.startsWith('neg'), top: Object.entries(wins.reduce((a, w) => { for (const [i, v] of Object.entries(w.s)) a[i] = Math.max(a[i] || 0, v); return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([i, v]) => D.classes[i] + ' ' + v.toFixed(2)), ...r };
  }
  return res;
}
if (require.main === module) { const r = run(); fs.writeFileSync(path.join(__dirname, 'results/audio.json'), JSON.stringify(r, null, 1));
  for (const [k, v] of Object.entries(r)) console.log(k.padEnd(22), 'v1', JSON.stringify(v.v1.events), 'fp', v.v1.fp, 'hit', v.v1.hit, '| v2', JSON.stringify(v.v2.events), 'fp', v.v2.fp, 'hit', v.v2.hit, '| top:', v.top.join('; ')); }
module.exports = { run };
