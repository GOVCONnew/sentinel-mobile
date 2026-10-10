/* SENTINEL — persistence: settings + events in localStorage, snapshots (JPEG blobs) in IndexedDB. */
(function (global) {
  'use strict';
  var LS_SET = 'sentinel.settings.v1', LS_EV = 'sentinel.events.v1', LS_FT = 'sentinel.field.v1', MAX_EV = 3000, db = null, idbOk = false;
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { console.warn('localStorage', e); return false; } }
  function openDB() {
    return new Promise(function (res) {
      if (!global.indexedDB) return res(false);
      try {
        var r = indexedDB.open('sentinel', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('snaps'); };
        r.onsuccess = function () { db = r.result; idbOk = true; res(true); };
        r.onerror = function () { res(false); };
      } catch (e) { res(false); }
    });
  }
  function tx(mode, fn) { return new Promise(function (res, rej) { if (!db) return rej(new Error('no idb')); var t = db.transaction('snaps', mode), st = t.objectStore('snaps'), r = fn(st); t.oncomplete = function () { res(r && r.result); }; t.onerror = function () { rej(t.error); }; }); }
  global.SStore = {
    init: openDB, idbOk: function () { return idbOk; },
    loadSettings: function (d) { return Object.assign({}, d, lsGet(LS_SET, {})); }, saveSettings: function (s) { lsSet(LS_SET, s); },
    loadEvents: function () { return lsGet(LS_EV, []); }, saveEvents: function (e) { if (e.length > MAX_EV) e.splice(0, e.length - MAX_EV); lsSet(LS_EV, e); },
    loadField: function () { return lsGet(LS_FT, null); }, saveField: function (f) { lsSet(LS_FT, f); },
    putSnap: function (id, blob) { return tx('readwrite', function (s) { return s.put(blob, id); }); },
    getSnap: function (id) { return tx('readonly', function (s) { return s.get(id); }); },
    clearSnaps: function () { return db ? tx('readwrite', function (s) { return s.clear(); }) : Promise.resolve(); }
  };
})(window);
