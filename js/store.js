/* SENTINEL v2 — local persistence. Settings + field session in localStorage; events, incidents and snapshots in
 * IndexedDB (v2 schema; migrates v1 localStorage events). Storage estimate + persistence request. Nothing leaves the device. */
(function (global) {
  'use strict';
  var LS_SET = 'sentinel.settings.v2', LS_SET1 = 'sentinel.settings.v1', LS_EV1 = 'sentinel.events.v1', LS_FT = 'sentinel.field.v2', db = null, idbOk = false, memEvents = [], memInc = [];
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function open() {
    return new Promise(function (res) {
      if (!global.indexedDB) return res(false);
      try {
        var r = indexedDB.open('sentinel', 2);
        r.onupgradeneeded = function (e) { var d = r.result; if (!d.objectStoreNames.contains('snaps')) d.createObjectStore('snaps');
          if (!d.objectStoreNames.contains('events')) d.createObjectStore('events', { keyPath: 'id' }).createIndex('ts', 'ts');
          if (!d.objectStoreNames.contains('incidents')) d.createObjectStore('incidents', { keyPath: 'id' }).createIndex('start', 'start'); };
        r.onsuccess = function () { db = r.result; idbOk = true; res(true); }; r.onerror = function () { res(false); }; r.onblocked = function () { res(false); };
      } catch (e) { res(false); }
    });
  }
  function tx(store, mode, fn) { return new Promise(function (res, rej) { if (!db) return rej(new Error('no idb')); var t = db.transaction(store, mode), st = t.objectStore(store), r = fn(st); t.oncomplete = function () { res(r && r.result); }; t.onerror = function () { rej(t.error); }; }); }
  async function init() {
    var ok = await open();
    var old = lsGet(LS_EV1, null);
    if (ok && old && old.length) { await tx('events', 'readwrite', function (s) { old.forEach(function (e) { s.put(e); }); }); try { localStorage.removeItem(LS_EV1); } catch (e) {} }
    else if (!ok && old) memEvents = old;
    return ok;
  }
  global.SStore = {
    init: init, idbOk: function () { return idbOk; },
    loadSettings: function (d) { return Object.assign({}, d, lsGet(LS_SET, null) || {}); }, saveSettings: function (s) { lsSet(LS_SET, s); },
    loadField: function () { return lsGet(LS_FT, null); }, saveField: function (f) { lsSet(LS_FT, f); },
    putEvent: function (e) { if (!db) { memEvents.push(e); return Promise.resolve(); } return tx('events', 'readwrite', function (s) { return s.put(e); }); },
    allEvents: function () { if (!db) return Promise.resolve(memEvents.slice()); return tx('events', 'readonly', function (s) { return s.getAll(); }).then(function (a) { return (a || []).sort(function (x, y) { return x.ts < y.ts ? -1 : 1; }); }); },
    putIncident: function (i) { var c = JSON.parse(JSON.stringify(i)); if (!db) { var k = memInc.findIndex(function (x) { return x.id === c.id; }); if (k >= 0) memInc[k] = c; else memInc.push(c); return Promise.resolve(); } return tx('incidents', 'readwrite', function (s) { return s.put(c); }); },
    allIncidents: function () { if (!db) return Promise.resolve(memInc.slice()); return tx('incidents', 'readonly', function (s) { return s.getAll(); }).then(function (a) { return (a || []).sort(function (x, y) { return x.start - y.start; }); }); },
    putSnap: function (id, blob) { return tx('snaps', 'readwrite', function (s) { return s.put(blob, id); }); },
    getSnap: function (id) { return tx('snaps', 'readonly', function (s) { return s.get(id); }); },
    clearAll: async function () { memEvents = []; memInc = []; if (!db) return; for (var s of ['snaps', 'events', 'incidents']) await tx(s, 'readwrite', function (st) { return st.clear(); }); },
    estimate: async function () { try { var e = await navigator.storage.estimate(); var p = navigator.storage.persisted ? await navigator.storage.persisted() : null; return { usage: e.usage, quota: e.quota, persisted: p }; } catch (e) { return null; } },
    persist: async function () { try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch (e) { return false; } }
  };
})(window);
