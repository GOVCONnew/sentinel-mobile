/* SENTINEL — COCO-SSD wrapper + overlay geometry/drawing. Requires globals tf, cocoSsd. */
(function (global) {
  'use strict';
  var model = null, modelBase = null, scratch = null, sctx = null;
  var GROUP_COLORS = { People: '#9ACD32', Animals: '#00E5FF', Vehicles: '#FFB000', Other: '#E0E0E0' };

  function loadScript(src) {
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.crossOrigin = 'anonymous'; s.onload = res; s.onerror = function () { rej(new Error('load ' + src)); }; document.head.appendChild(s); });
  }
  function hasWebGL() { try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
  async function initBackend(onStatus) {
    if (tf.getBackend() && tf.getBackend() !== 'cpu') return tf.getBackend();
    try {
      if (!hasWebGL()) throw new Error('no webgl');
      onStatus && onStatus('INIT WEBGL');
      if (!(await tf.setBackend('webgl'))) throw new Error('webgl failed'); await tf.ready();
    } catch (e) {
      console.warn('WebGL unavailable → WASM', e); onStatus && onStatus('NO WEBGL → WASM');
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/tf-backend-wasm.min.js');
        tf.wasm.setWasmPaths('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/');
        if (!(await tf.setBackend('wasm'))) throw new Error('wasm failed'); await tf.ready();
      } catch (e2) { console.warn('WASM failed → CPU', e2); await tf.setBackend('cpu'); await tf.ready(); }
    }
    return tf.getBackend();
  }
  async function loadModel(base, onStatus) {
    await initBackend(onStatus);
    if (model && modelBase === base) return model;
    onStatus && onStatus('LOADING COCO-SSD ' + base);
    var m = await cocoSsd.load({ base: base });
    if (model && model.dispose) try { model.dispose(); } catch (e) {}
    model = m; modelBase = base;
    // warm-up
    var c = document.createElement('canvas'); c.width = c.height = 64; await model.detect(c, 1, 0.9);
    return model;
  }
  /** Detect on a downscaled copy of source; returns [{cls, score, x,y,w,h}] in source pixel coords. */
  async function detect(source, srcW, srcH, opts) {
    opts = opts || {};
    var k = Math.min(1, (opts.longSide || 320) / Math.max(srcW, srcH)), dw = Math.max(1, Math.round(srcW * k)), dh = Math.max(1, Math.round(srcH * k));
    if (!scratch) { scratch = document.createElement('canvas'); sctx = scratch.getContext('2d'); }
    if (scratch.width !== dw || scratch.height !== dh) { scratch.width = dw; scratch.height = dh; }
    sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high'; sctx.drawImage(source, 0, 0, dw, dh);
    var raw = await model.detect(scratch, opts.maxBoxes || 20, opts.minScore != null ? opts.minScore : 0.5); // model.detect tidies its own tensors
    var inv = 1 / k, allow = opts.classes; // Set or null
    return raw.filter(function (r) { return !allow || allow.has(r['class']); }).map(function (r) {
      return { cls: r['class'], score: r.score, x: r.bbox[0] * inv, y: r.bbox[1] * inv, w: r.bbox[2] * inv, h: r.bbox[3] * inv };
    });
  }
  function coverTransform(sw, sh, vw, vh) { var s = Math.max(vw / sw, vh / sh); return { s: s, ox: (vw - sw * s) / 2, oy: (vh - sh * s) / 2 }; }
  function containTransform(sw, sh, vw, vh) { var s = Math.min(vw / sw, vh / sh); return { s: s, ox: (vw - sw * s) / 2, oy: (vh - sh * s) / 2 }; }
  function toView(b, t) { return { x: b.x * t.s + t.ox, y: b.y * t.s + t.oy, w: b.w * t.s, h: b.h * t.s }; }
  function drawBox(ctx, vb, item, scale) {
    scale = scale || 1; var col = GROUP_COLORS[SCore.groupOf(item.cls)];
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 2 * scale; ctx.strokeRect(vb.x, vb.y, vb.w, vb.h);
    var c = Math.min(vb.w, vb.h) * 0.18; ctx.lineWidth = 4 * scale; ctx.beginPath();
    ctx.moveTo(vb.x, vb.y + c); ctx.lineTo(vb.x, vb.y); ctx.lineTo(vb.x + c, vb.y);
    ctx.moveTo(vb.x + vb.w - c, vb.y + vb.h); ctx.lineTo(vb.x + vb.w, vb.y + vb.h); ctx.lineTo(vb.x + vb.w, vb.y + vb.h - c); ctx.stroke();
    var txt = item.cls.toUpperCase() + (item.id ? ' #' + item.id : '') + ' ' + Math.round(item.score * 100) + '%', fs = Math.round(13 * scale);
    ctx.font = '700 ' + fs + 'px Calibri, -apple-system, system-ui, sans-serif';
    var tw = ctx.measureText(txt).width + 10 * scale, th = fs + 8 * scale, VW = ctx.canvas.clientWidth || ctx.canvas.width;
    var ty = vb.y - th - 2 < 0 ? vb.y + 2 : vb.y - th - 2, tx = Math.min(Math.max(vb.x, 4), Math.max(4, VW - tw - 4));
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(tx, ty, tw, th); ctx.fillStyle = col; ctx.textBaseline = 'middle'; ctx.fillText(txt, tx + 5 * scale, ty + th / 2);
    ctx.restore();
  }
  global.SDet = { loadModel: loadModel, detect: detect, initBackend: initBackend, hasWebGL: hasWebGL, getBase: function () { return modelBase; },
    isReady: function () { return !!model; }, coverTransform: coverTransform, containTransform: containTransform, toView: toView, drawBox: drawBox, COLORS: GROUP_COLORS };
})(window);
