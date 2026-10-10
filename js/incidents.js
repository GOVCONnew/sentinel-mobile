/* SENTINEL v2 — incident grouping, multimodal co-occurrence (never asserts same source), field-test v2 metrics,
 * anonymised export helpers. Pure JS (window.SInc / module.exports). */
(function (global) {
  'use strict';
  /** IncidentManager: evidence = {t(ms epoch), kind:'track'|'audio'|'motion'|'manual', ...}. Incidents open only on
   *  confirming evidence (confirmed track in zone, audio watch category, coherent motion if opted-in, manual). */
  function IncidentManager(o) { o = o || {}; this.gapMs = o.gapMs || 30000; this.coWindowMs = o.coWindowMs || 10000; this.motionOpens = !!o.motionOpens; this.cur = null; this.seq = 0; this.onChange = o.onChange || function () {}; }
  IncidentManager.prototype._new = function (t) {
    this.seq++; return { id: 'inc' + t.toString(36) + this.seq, start: t, end: t, status: 'open', tracks: {}, audio: {}, audioTop: [], motion: { maxFgPct: 0, movers: 0, cues: 0 }, reasons: [], events: [], labels: [], maxConf: 0, correlation: null, snaps: [] };
  };
  IncidentManager.prototype.add = function (ev) {
    var confirming = ev.kind === 'track' || ev.kind === 'audio' || ev.kind === 'manual' || (ev.kind === 'motion' && ev.coherent && this.motionOpens);
    if (this.cur && ev.t - this.cur.end > this.gapMs) this.close(ev.t);
    if (!this.cur) { if (!confirming) return null; this.cur = this._new(ev.t); }
    var I = this.cur; I.end = Math.max(I.end, ev.t); if (ev.eventId) I.events.push(ev.eventId);
    function reason(r) { if (I.reasons.indexOf(r) < 0) I.reasons.push(r); }
    if (ev.kind === 'track') {
      var k = String(ev.trackId), tr = I.tracks[k] || (I.tracks[k] = { id: ev.trackId, label: ev.label, group: ev.group, peak: 0, firstSeen: ev.firstSeen, confirmedAt: ev.confirmedAt || ev.t, timeToConfirmMs: ev.firstSeen != null ? Math.round((ev.confirmedAt || ev.t) - ev.firstSeen) : null, snapId: null, lastSeen: ev.t });
      tr.peak = Math.max(tr.peak, ev.score || 0); tr.label = ev.label || tr.label; tr.lastSeen = ev.t; if (ev.snapId) { tr.snapId = ev.snapId; if (I.snaps.indexOf(ev.snapId) < 0) I.snaps.push(ev.snapId); }
      reason('CONFIRMED_TRACK:' + tr.group + (ev.reasonDetail ? ' (' + ev.reasonDetail + ')' : ''));
      I.maxConf = Math.max(I.maxConf, ev.score || 0); I.lastVisual = ev.t;
    } else if (ev.kind === 'audio') {
      I.audio[ev.label] = Math.max(I.audio[ev.label] || 0, ev.score || 0); (ev.top || []).forEach(function (l) { if (I.audioTop.indexOf(l) < 0 && I.audioTop.length < 8) I.audioTop.push(l); });
      reason('AUDIO_WATCH:' + ev.label); I.maxConf = Math.max(I.maxConf, ev.score || 0); I.lastAudio = ev.t;
    } else if (ev.kind === 'motion') {
      I.motion.maxFgPct = Math.max(I.motion.maxFgPct, ev.fgPct || 0); I.motion.movers = Math.max(I.motion.movers, ev.movers || 0); I.motion.cues++;
      if (ev.coherent && this.motionOpens) reason('COHERENT_MOTION');
    } else if (ev.kind === 'manual') reason('MANUAL:' + (ev.label || ''));
    if (ev.label && I.labels.indexOf(ev.label) < 0) I.labels.push(ev.label);
    // co-occurrence: visual + audio evidence within window → "possibly related" (no claim of common source)
    if (I.lastVisual != null && I.lastAudio != null && Math.abs(I.lastVisual - I.lastAudio) <= this.coWindowMs)
      I.correlation = { type: 'co-occurring', dtSec: Math.round(Math.abs(I.lastVisual - I.lastAudio) / 1000), note: 'Audio and visual evidence co-occurred in time — possibly related. SENTINEL does not determine that they come from the same source.' };
    this.onChange(I); return I;
  };
  IncidentManager.prototype.tick = function (now, activeTrackIds) {
    if (!this.cur) return; var I = this.cur, live = (activeTrackIds || []).some(function (id) { return I.tracks[String(id)]; });
    if (live) I.end = now; else if (now - I.end > this.gapMs) this.close(now);
  };
  IncidentManager.prototype.close = function () { if (!this.cur) return; this.cur.status = 'closed'; var I = this.cur; this.cur = null; this.onChange(I); };

  /** Search/filter incidents+events. q: {text, type, label, from, to (ms), minConf} */
  function filterRecords(recs, q) {
    q = q || {}; var tx = (q.text || '').toLowerCase().trim();
    return recs.filter(function (r) {
      var t = r.start != null ? r.start : Date.parse(r.ts);
      if (q.from && t < q.from) return false; if (q.to && t > q.to) return false;
      var conf = r.maxConf != null ? r.maxConf : r.conf; if (q.minConf && !(conf >= q.minConf)) return false;
      if (q.type && q.type !== 'all') { var ty = r.reasons ? 'incident' : r.type; if (ty !== q.type) return false; }
      if (q.label && !(r.labels ? r.labels.some(function (l) { return l.toLowerCase().indexOf(q.label.toLowerCase()) >= 0; }) : String(r.label).toLowerCase().indexOf(q.label.toLowerCase()) >= 0)) return false;
      if (tx && JSON.stringify(r).toLowerCase().indexOf(tx) < 0) return false;
      return true;
    });
  }

  /** Field test v2: labels [{t, kind:'tp'|'fp'|'miss', cls, conf, ttcMs}], session {start, end}. */
  function fieldMetricsV2(labels, session) {
    var C = {}, hours = Math.max(1e-9, ((session.end || Date.now()) - session.start) / 3600000);
    function c(k) { return C[k] || (C[k] = { tp: 0, fp: 0, fn: 0, confSum: 0, confN: 0, ttcSum: 0, ttcN: 0 }); }
    labels.forEach(function (l) { var k = c(l.cls); if (l.kind === 'tp') { k.tp++; if (l.ttcMs != null) { k.ttcSum += l.ttcMs; k.ttcN++; } } else if (l.kind === 'fp') k.fp++; else if (l.kind === 'miss') k.fn++; if (l.conf != null && l.kind !== 'miss') { k.confSum += l.conf; k.confN++; } });
    var O = { tp: 0, fp: 0, fn: 0, confSum: 0, confN: 0, ttcSum: 0, ttcN: 0 };
    function fin(k) { var P = k.tp + k.fp ? k.tp / (k.tp + k.fp) : null, R = k.tp + k.fn ? k.tp / (k.tp + k.fn) : null; return { tp: k.tp, fp: k.fp, fn: k.fn, precision: P, recall: R, f1: P != null && R != null && P + R > 0 ? 2 * P * R / (P + R) : (P === 0 || R === 0 ? 0 : null), fpPerHour: k.fp / hours, meanConf: k.confN ? k.confSum / k.confN : null, meanTimeToConfirmMs: k.ttcN ? k.ttcSum / k.ttcN : null }; }
    var out = {}; Object.keys(C).sort().forEach(function (k) { out[k] = fin(C[k]); ['tp', 'fp', 'fn', 'confSum', 'confN', 'ttcSum', 'ttcN'].forEach(function (f) { O[f] += C[k][f]; }); });
    return { classes: out, overall: fin(O), hours: hours };
  }
  /** Anonymise: relative seconds (rounded) from session start, date rounded to day, no images, GPS only if opted in (rounded to ~1 km). */
  function anonymize(session, labels, opts) {
    opts = opts || {}; var s0 = session.start;
    return { app: 'Newton SENTINEL Mobile 2.0', schema: 'sentinel-fieldtest-anon/1', date: new Date(s0).toISOString().slice(0, 10), durationSec: Math.round(((session.end || Date.now()) - s0) / 1000), model: session.model, inputSize: session.inputSize,
      gps: opts.includeGps && session.geo ? { lat: Math.round(session.geo.lat * 100) / 100, lon: Math.round(session.geo.lon * 100) / 100 } : null,
      labels: labels.map(function (l) { return { tSec: Math.round((l.t - s0) / 1000), kind: l.kind, cls: l.cls, conf: l.conf != null ? Math.round(l.conf * 100) / 100 : null, ttcSec: l.ttcMs != null ? Math.round(l.ttcMs / 100) / 10 : null }; }),
      metrics: fieldMetricsV2(labels, session) };
  }
  var api = { IncidentManager: IncidentManager, filterRecords: filterRecords, fieldMetricsV2: fieldMetricsV2, anonymize: anonymize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else global.SInc = api;
})(typeof window !== 'undefined' ? window : globalThis);
