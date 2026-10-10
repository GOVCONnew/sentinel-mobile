/* SENTINEL v2 — robust motion engine for outdoor scenes.
 * 1) global motion compensation: integer block-matching of camera shift (SAD on subsampled gradient image) and
 *    alignment of the background model; 2) illumination normalisation: global gain compensation + gradient-structure
 *    confirmation (shadows/light ramps change intensity, rarely edges); 3) adaptive background: per-pixel running mean
 *    and variance (MOG-lite, single Gaussian) so swaying foliage learns high variance; 4) blob filtering: connected
 *    components, min area, cross-frame blob tracking, persistence and directional coherence (net displacement vs path
 *    length) to separate walkers from oscillating vegetation. Pure JS. */
(function (global) {
  'use strict';
  function Engine(W, H, o) {
    this.W = W; this.H = H; this.o = Object.assign({ sens: 60, alpha: 0.04, alphaFg: 0.005, minAreaFrac: 0.0015, persist: 4, coherence: 0.55, minTravelFrac: 0.1, maxShift: 6, warm: 30, gate: 'strict' }, o || {});
    this.mask = null; this.reset();
  }
  Engine.prototype.reset = function () { var n = this.W * this.H; this.mu = null; this.var = new Float32Array(n); this.n = 0; this.blobs = []; this.nextBlob = 1; this.prev = null; this.fg = new Uint8Array(n); this.shift = [0, 0]; };
  Engine.prototype.setZoneMask = function (m) { this.mask = m; }; // Uint8Array W*H, 1 = evaluate
  function grad(g, W, H) { var o = new Float32Array(W * H); for (var y = 1; y < H - 1; y++) for (var x = 1; x < W - 1; x++) { var i = y * W + x; o[i] = Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + W] - g[i - W]); } return o; }
  Engine.prototype._estimateShift = function (gp, gc) {
    var W = this.W, H = this.H, R = this.o.maxShift, best = [0, 0], bs = Infinity, m = R + 2;
    for (var dy = -R; dy <= R; dy++) for (var dx = -R; dx <= R; dx++) {
      var s = 0; for (var y = m; y < H - m; y += 2) for (var x = m; x < W - m; x += 2) s += Math.abs(gc[y * W + x] - gp[(y - dy) * W + (x - dx)]);
      s *= (1 + 0.002 * (dx * dx + dy * dy)); if (s < bs) { bs = s; best = [dx, dy]; }
    }
    return best;
  }
  function shiftArr(a, W, H, dx, dy) { if (!dx && !dy) return a; var o = new a.constructor(a.length); for (var y = 0; y < H; y++) { var sy = Math.min(H - 1, Math.max(0, y - dy)); for (var x = 0; x < W; x++) { var sx = Math.min(W - 1, Math.max(0, x - dx)); o[y * W + x] = a[sy * W + sx]; } } return o; }
  /** gray: Uint8Array W*H. Returns stats {rawPct, fgPct, shift, gain, blobs, movers, alert, warm} */
  Engine.prototype.process = function (gray, now) {
    var W = this.W, H = this.H, n = W * H, o = this.o, i;
    var g = new Float32Array(n); for (i = 0; i < n; i++) g[i] = gray[i];
    var gr = grad(g, W, H);
    if (!this.mu) { this.mu = g.slice(); this.gmu = gr.slice(); for (i = 0; i < n; i++) this.var[i] = 36; this.prevG = gr; this.n = 1; return { rawPct: 0, fgPct: 0, shift: [0, 0], gain: 1, blobs: [], movers: [], alert: false, warm: true }; }
    // raw (v1-style) frame difference for reference
    var rawCnt = 0; if (this.prev) for (i = 0; i < n; i++) if (Math.abs(g[i] - this.prev[i]) > 25) rawCnt++;
    this.prev = g;
    // 1) global motion compensation (camera shake): shift of this frame relative to previous gradient image
    var sh = this._estimateShift(this.prevG, gr); this.prevG = gr;
    if (sh[0] || sh[1]) { this.mu = shiftArr(this.mu, W, H, sh[0], sh[1]); this.var = shiftArr(this.var, W, H, sh[0], sh[1]); this.gmu = shiftArr(this.gmu, W, H, sh[0], sh[1]); this.shiftAcc = (this.shiftAcc || 0) + 1; }
    // 2) illumination: global gain = ratio of medians-ish (means over evaluated pixels)
    var sc = 0, sb = 0; for (i = 0; i < n; i += 3) { sc += g[i]; sb += this.mu[i]; }
    var gain = sb > 0 ? sc / sb : 1; gain = Math.max(0.4, Math.min(2.5, gain));
    // 3) adaptive background test
    var k = 4.5 - (o.sens / 100) * 2.5, minT = 14 - (o.sens / 100) * 7, fg = this.fg, cnt = 0, tot = 0, M = this.mask, warm = this.n < o.warm;
    for (i = 0; i < n; i++) {
      var mu = this.mu[i] * gain, d = g[i] - mu, sd = Math.sqrt(this.var[i]), th = Math.max(minT, k * sd);
      var ad = Math.abs(d), gd = Math.abs(gr[i] - this.gmu[i] * gain), isFg = ad > th && (o.gate === "strict" ? gd > Math.max(10, 0.6 * th) : (gd > Math.max(8, 0.4 * th) || ad > 2 * th));
      fg[i] = isFg ? 1 : 0;
      var a = isFg ? o.alphaFg : o.alpha; if (warm) a = Math.max(a, 1 / (this.n + 1));
      this.mu[i] += a * (g[i] / gain - this.mu[i]); this.var[i] += a * (d * d - this.var[i]); if (this.var[i] < 9) this.var[i] = 9;
      this.gmu[i] += a * (gr[i] / gain - this.gmu[i]);
    }
    this.n++;
    // 3b) 3x3 majority filter (remove speckle)
    var f2 = new Uint8Array(n);
    for (var y = 1; y < H - 1; y++) for (var x = 1; x < W - 1; x++) { i = y * W + x; var s = fg[i - W - 1] + fg[i - W] + fg[i - W + 1] + fg[i - 1] + fg[i] + fg[i + 1] + fg[i + W - 1] + fg[i + W] + fg[i + W + 1]; f2[i] = s >= 5 ? 1 : 0; }
    for (i = 0; i < n; i++) { if (M && !M[i]) { f2[i] = 0; continue; } tot++; if (f2[i]) cnt++; }
    this.fg = f2;
    // 4) connected components + blob tracking
    var lab = new Int32Array(n), comps = [], stack = [];
    for (i = 0; i < n; i++) if (f2[i] && !lab[i]) {
      var id = comps.length + 1, c = { area: 0, sx: 0, sy: 0, x0: W, y0: H, x1: 0, y1: 0 }; lab[i] = id; stack.push(i);
      while (stack.length) { var p = stack.pop(), px = p % W, py = (p / W) | 0; c.area++; c.sx += px; c.sy += py; if (px < c.x0) c.x0 = px; if (px > c.x1) c.x1 = px; if (py < c.y0) c.y0 = py; if (py > c.y1) c.y1 = py;
        var nb = [p - 1, p + 1, p - W, p + W]; for (var q = 0; q < 4; q++) { var r = nb[q]; if (r >= 0 && r < n && f2[r] && !lab[r] && !(q < 2 && ((r / W) | 0) !== py)) { lab[r] = id; stack.push(r); } } }
      if (c.area >= o.minAreaFrac * n) { c.cx = c.sx / c.area; c.cy = c.sy / c.area; comps.push(c); } else comps.push(null);
    }
    comps = comps.filter(Boolean);
    var self = this, used = {}, D = Math.max(W, H) * 0.12;
    this.blobs.forEach(function (b) { b.seen = false; });
    comps.forEach(function (c) {
      var best = null, bd = D; self.blobs.forEach(function (b) { if (used[b.id]) return; var dd = Math.hypot(b.cx - c.cx, b.cy - c.cy); if (dd < bd) { bd = dd; best = b; } });
      if (best) { used[best.id] = 1; best.path += bd; best.cx = c.cx; best.cy = c.cy; best.box = c; best.age++; best.seen = true; best.miss = 0; }
      else self.blobs.push({ id: self.nextBlob++, ox: c.cx, oy: c.cy, cx: c.cx, cy: c.cy, path: 0, age: 1, box: c, seen: true, miss: 0 });
    });
    this.blobs.forEach(function (b) { if (!b.seen) b.miss++; });
    this.blobs = this.blobs.filter(function (b) { return b.miss <= 2; });
    var movers = this.blobs.filter(function (b) { var net = Math.hypot(b.cx - b.ox, b.cy - b.oy); b.net = net; b.coh = b.path > 0 ? net / b.path : 0; return b.seen && b.age >= o.persist && net >= o.minTravelFrac * W && b.coh >= o.coherence; });
    return { rawPct: 100 * rawCnt / n, fgPct: tot ? 100 * cnt / tot : 0, shift: sh, gain: gain, blobs: this.blobs.filter(function (b) { return b.seen; }), movers: movers, alert: !warm && movers.length > 0, warm: warm };
  };
  /** Build zone mask (1 = evaluate) at W×H from normalized polygons (roi/exclude). */
  function zoneMask(zones, W, H, pip) {
    var m = new Uint8Array(W * H).fill(1); if (!zones || !zones.length) return null;
    var rois = zones.filter(function (z) { return z.type === 'roi'; }), ex = zones.filter(function (z) { return z.type === 'exclude'; });
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) { var nx = (x + .5) / W, ny = (y + .5) / H, ok = !rois.length || rois.some(function (z) { return pip(nx, ny, z.pts); }); if (ok && ex.some(function (z) { return pip(nx, ny, z.pts); })) ok = false; m[y * W + x] = ok ? 1 : 0; }
    return m;
  }
  var api = { Engine: Engine, zoneMask: zoneMask };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else global.SMotion = api;
})(typeof window !== 'undefined' ? window : globalThis);
