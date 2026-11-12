/* Meticulous photo vault (web 441 — PHOTO-VAULT-NOV12).
 *
 * Owner evidence, Nov 12, 2026, 17:08–17:18 CST: today's Mobil
 * receipt (63.370 L, $133.65, odo 172,903) previewed, the entry
 * saved, and the photo was shed at the save — "didn't fit in
 * this device's app storage" — on a phone with over a hundred
 * GB free. His ruling, verbatim in the order: the app "has to
 * store thousands if not hundreds of thousands of pictures. So
 * make sure that this space issue is not happening ever again."
 *
 * THE DISEASE (convicted by the v372 trace, re-measured by the
 * v394 accounting): every book this app keeps lives in the
 * origin's localStorage with every photo INLINE as a base64
 * data URL, and Chromium caps the WHOLE origin's localStorage
 * at 10 MiB counted in UTF-16 bytes. At the app's own rendition
 * sizes (~180–260k chars a photo) two dozen photos fill the
 * pool; from then on every save that must grow the store can
 * die — fuel receipts (Nov 5/7/9/12), a Documents filing, a
 * signed PTI, a dispatch close. The v350–v394 machinery (photo
 * documents, the fit ladder, the reclaim, the relief shedder)
 * fought for room inside that pool; the pool itself was the
 * wall. Cloud space was never the constraint — the account's
 * Firestore tree sits on the free plan with room to spare —
 * but no byte of a photo could live there as its ONLY home,
 * because every reader reads the local book.
 *
 * THE VAULT: a photo's bytes live in the account, not in the
 * book. put() writes the payload to the signed-in user's own
 * Firestore tree (users/{uid}/photos/{key} — the key is the
 * SHA-256 of the payload, so the same photo stored twice is
 * stored once; payloads past one document's reach ride in
 * chunk documents under the manifest, which is written LAST
 * as the commit point) and caches it in this device's
 * IndexedDB (a store whose quota is a share of the disk, not
 * the 10 MiB localStorage pool). The record keeps a reference
 * — the string "mtphoto://<key>" — where the data URL used to
 * sit. A background sweep walks every book, moves every inline
 * photo it finds into the vault and rewrites the book with
 * references (the rewrite goes through App._store.set, so
 * cloud sync carries the slim book like any other write; a
 * photo leaves the book only when its bytes are confirmed in
 * the account or in the device vault, and a book that changed
 * under the sweep is left for the next round). That sweep is
 * also the migration: every photo already sitting inline in a
 * book is lifted on the first runs after this build lands,
 * and the pool drains to facts and references — a state in
 * which no photo can ever fill it again.
 *
 * READERS NEVER CHANGE THEIR HABITS: App._store.get resolves
 * references to cached bytes at the one door every module
 * reads through; a painter (MutationObserver) swaps any
 * <img src="mtphoto://…"> for its bytes the moment they land;
 * the download button resolves a reference before delivering.
 * A photo therefore survives cache clears, force-stops and
 * device changes: sign in anywhere, the book arrives by sync
 * holding references, and the vault fetches the bytes from
 * the account on first paint.
 *
 * Local mode (signed out) keeps the same shape with the
 * device vault as the only home until sign-in — the sweep
 * retries the account leg for every reference not yet
 * confirmed there, so nothing waits on the driver.
 *
 * Firebase Storage is deliberately NOT used: this project has
 * no storage bucket (probed Nov 12, 2026 — both bucket names
 * answer "The specified bucket does not exist"), and creating
 * one today means moving the project to the pay-as-you-go
 * plan, which is the owner's decision to make, not this fix's.
 * Firestore is already live on the free plan; its 1 GiB of
 * document storage holds on the order of a few thousand
 * receipt-size photos, and the day the account ever nears
 * that, the bucket conversation is a one-line plan change —
 * the references and chunk layout below would not move.
 */
(function () {
  'use strict';
  if (window.PhotoVault) return;

  var REF_PREFIX = 'mtphoto://';
  var CHUNK = 700000;         /* chars per chunk document — a Firestore doc caps at 1,048,576 bytes all-in */
  var MIN_PHOTO_CHARS = 1000; /* a data: payload at least this long is photo-class weight */
  var MEM_CAP = 40;           /* resolved payloads held in page memory */
  var RETRY_PER_ROUND = 50;   /* account-leg retries per sweep round */
  var REF_SCAN_CAP = 3000000; /* raw length past which a book is not parsed just to retry references */

  var mem = {};
  var memOrder = [];
  var cloudedSeen = {};       /* keys confirmed in the account this page session */
  var primeBusy = {};
  var idb = null;
  var idbFailed = false;
  var sweeping = false;
  var sweepQueued = false;
  var kickTimer = null;

  function isRef(s) { return typeof s === 'string' && s.indexOf(REF_PREFIX) === 0; }
  function refKey(s) { return s.slice(REF_PREFIX.length); }
  function isPhotoData(s) {
    return typeof s === 'string' && s.length >= MIN_PHOTO_CHARS &&
      (s.indexOf('data:image/') === 0 || s.indexOf('data:application/pdf') === 0);
  }
  function signedIn() {
    try { return !!(window.FB && FB.user && FB.saveDoc && FB.loadDoc); } catch (e) { return false; }
  }

  /* ---------------- keys: the payload's own hash ---------------- */
  function fallbackKey(s) {
    function fnv(seed) {
      var h = seed >>> 0;
      for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
      return ('0000000' + h.toString(16)).slice(-8);
    }
    return 'f' + fnv(2166136261) + fnv(42424242) + fnv(987654321) + '_' + s.length;
  }
  function keyFor(dataUrl) {
    try {
      if (window.crypto && crypto.subtle && crypto.subtle.digest && typeof TextEncoder !== 'undefined') {
        var bytes = new TextEncoder().encode(dataUrl);
        return crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
          var b = new Uint8Array(buf), hex = '';
          for (var i = 0; i < b.length; i++) hex += ('0' + b[i].toString(16)).slice(-2);
          return hex;
        }, function () { return fallbackKey(dataUrl); });
      }
    } catch (e) {}
    return Promise.resolve(fallbackKey(dataUrl));
  }

  /* ---------------- page-memory cache ---------------- */
  function memPut(key, url) {
    if (!key || !url) return;
    if (!mem[key]) memOrder.push(key);
    mem[key] = url;
    while (memOrder.length > MEM_CAP) {
      var old = memOrder.shift();
      if (old !== key) delete mem[old];
    }
  }

  /* ---------------- device vault (IndexedDB) ----------------
     The whole API surface used is open / createObjectStore /
     transaction / get / put — the cache is a convenience, never
     the only home of anything the account also holds, and every
     failure degrades to "no cache", never to a lost photo. */
  function idbOpen() {
    if (idb) return Promise.resolve(idb);
    if (idbFailed || typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise(function (res) {
      var done = false;
      function give(v) { if (!done) { done = true; res(v); } }
      try {
        var rq = indexedDB.open('mt-photovault', 1);
        rq.onupgradeneeded = function () {
          try { rq.result.createObjectStore('img'); } catch (e) {}
          try { rq.result.createObjectStore('meta'); } catch (e) {}
        };
        rq.onsuccess = function () { idb = rq.result; give(idb); };
        rq.onerror = function () { idbFailed = true; give(null); };
        rq.onblocked = function () { give(null); };
      } catch (e) { idbFailed = true; give(null); }
    });
  }
  function idbReq(store, mode, fn) {
    return idbOpen().then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        var settled = false;
        function give(v) { if (!settled) { settled = true; res(v); } }
        try {
          var tx = db.transaction(store, mode);
          var rq = fn(tx.objectStore(store));
          var out = null, got = false;
          rq.onsuccess = function () { out = rq.result; got = true; };
          rq.onerror = function () { give(null); };
          tx.oncomplete = function () { give(mode === 'readonly' ? (got && out !== undefined ? out : null) : true); };
          tx.onerror = function () { give(null); };
          tx.onabort = function () { give(null); };
        } catch (e) { give(null); }
      });
    });
  }
  function idbGet(store, key) { return idbReq(store, 'readonly', function (os) { return os.get(key); }); }
  function idbPut(store, key, val) {
    return idbReq(store, 'readwrite', function (os) { return os.put(val, key); })
      .then(function (r) { return r === true; });
  }

  /* ---------------- account vault (Firestore) ----------------
     FB.saveDoc resolves null only when there is no signed-in
     collection to write to — a landed compat write resolves
     undefined — so null is the one "did not land" verdict. */
  function mustLand(p) {
    return p.then(function (r) {
      if (r === null) throw new Error('photo write did not land');
      return r;
    });
  }
  function cloudHas(key) {
    if (cloudedSeen[key]) return Promise.resolve(true);
    if (!signedIn()) return Promise.resolve(false);
    return FB.loadDoc('photos', key).then(function (d) {
      if (d && (typeof d.d === 'string' || d.n)) { cloudedSeen[key] = 1; return true; }
      return false;
    }).catch(function () { return false; });
  }
  function cloudPut(key, dataUrl) {
    if (!signedIn()) return Promise.resolve(false);
    var mime = dataUrl.slice(5, dataUrl.indexOf(';'));
    var jobs = [];
    var manifest;
    if (dataUrl.length <= CHUNK) {
      manifest = { v: 1, n: 1, len: dataUrl.length, mime: mime, d: dataUrl };
    } else {
      var n = Math.ceil(dataUrl.length / CHUNK);
      manifest = { v: 1, n: n, len: dataUrl.length, mime: mime };
      for (var i = 0; i < n; i++) {
        (function (i) {
          jobs.push(mustLand(FB.saveDoc('photos', key + '~' + i, { d: dataUrl.slice(i * CHUNK, (i + 1) * CHUNK) })));
        })(i);
      }
    }
    return Promise.all(jobs).then(function () {
      return mustLand(FB.saveDoc('photos', key, manifest)); /* the manifest lands last — it is the commit point */
    }).then(function () { cloudedSeen[key] = 1; return true; })
      .catch(function () { return false; });
  }
  function cloudGet(key) {
    if (!signedIn()) return Promise.resolve(null);
    return FB.loadDoc('photos', key).then(function (d) {
      if (!d) return null;
      cloudedSeen[key] = 1;
      if (typeof d.d === 'string') return d.d;
      var n = d.n || 0;
      if (!n) return null;
      var parts = new Array(n);
      var jobs = [];
      for (var i = 0; i < n; i++) {
        (function (i) {
          jobs.push(FB.loadDoc('photos', key + '~' + i).then(function (c) {
            parts[i] = (c && typeof c.d === 'string') ? c.d : '';
          }).catch(function () { parts[i] = ''; }));
        })(i);
      }
      return Promise.all(jobs).then(function () {
        var url = parts.join('');
        if (d.len && url.length !== d.len) return null;
        return url;
      });
    }).catch(function () { return null; });
  }
  function ensureClouded(key, dataUrl) {
    if (!signedIn()) return Promise.resolve(false);
    return cloudHas(key).then(function (has) {
      if (has) return true;
      return cloudPut(key, dataUrl);
    });
  }
  /* A reference whose account leg has not landed yet (it was
     stored while signed out, or an upload failed): fetch the
     bytes from the device vault and put them in the account.
     Bounded per round by the caller. */
  function retryCloudFor(key) {
    if (!key || cloudedSeen[key] || !signedIn()) return Promise.resolve(false);
    return idbGet('meta', key).then(function (m) {
      if (m && m.c) { cloudedSeen[key] = 1; return false; }
      return cloudHas(key).then(function (has) {
        if (has) { idbPut('meta', key, { c: 1 }); return false; }
        return idbGet('img', key).then(function (url) {
          if (typeof url !== 'string' || !url) return false;
          return cloudPut(key, url).then(function (up) {
            if (up) idbPut('meta', key, { c: 1 });
            return up;
          });
        });
      });
    }).catch(function () { return false; });
  }

  /* ---------------- put / get ---------------- */
  function put(dataUrl) {
    if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:') !== 0) return Promise.resolve(null);
    return keyFor(dataUrl).then(function (key) {
      memPut(key, dataUrl);
      return idbPut('img', key, dataUrl).then(function (idbOk) {
        return ensureClouded(key, dataUrl).then(function (cloudOk) {
          if (cloudOk) idbPut('meta', key, { c: 1 });
          /* the reference is handed back only when the bytes are
             confirmed SOMEWHERE durable — the account, or this
             device's vault (whose account leg the sweep retries).
             Nowhere safe: null, and the caller keeps its inline
             copy exactly as every pre-vault build did. */
          return (cloudOk || idbOk) ? REF_PREFIX + key : null;
        });
      });
    }).catch(function () { return null; });
  }
  function get(refOrKey) {
    var key = isRef(refOrKey) ? refKey(refOrKey) : String(refOrKey || '');
    if (!key) return Promise.resolve(null);
    if (mem[key]) return Promise.resolve(mem[key]);
    return idbGet('img', key).then(function (url) {
      if (typeof url === 'string' && url) { memPut(key, url); return url; }
      return cloudGet(key).then(function (u2) {
        if (u2) {
          memPut(key, u2);
          idbPut('img', key, u2);
          idbPut('meta', key, { c: 1 });
        }
        return u2 || null;
      });
    }).catch(function () { return null; });
  }
  function prime(keys) {
    (keys || []).forEach(function (k) {
      if (!k || mem[k] || primeBusy[k]) return;
      primeBusy[k] = 1;
      get(REF_PREFIX + k).then(
        function () { delete primeBusy[k]; },
        function () { delete primeBusy[k]; });
    });
  }

  /* ---------------- value walking ---------------- */
  function walkStrings(v, fn) {
    if (typeof v === 'string') {
      var r = fn(v);
      return r === undefined ? v : r;
    }
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) v[i] = walkStrings(v[i], fn);
      return v;
    }
    if (v && typeof v === 'object') {
      for (var k in v) {
        if (k === '__proto__') continue;
        if (Object.prototype.hasOwnProperty.call(v, k)) v[k] = walkStrings(v[k], fn);
      }
      return v;
    }
    return v;
  }
  /* store.get's door: references with bytes already in page
     memory resolve in place; the rest are primed for the
     painter and ride through as references this once. */
  function hydrateValue(v) {
    var missing = [];
    var out = walkStrings(v, function (s) {
      if (!isRef(s)) return undefined;
      var key = refKey(s);
      if (mem[key]) return mem[key];
      missing.push(key);
      return undefined;
    });
    if (missing.length) prime(missing);
    return out;
  }

  /* ---------------- the sweep: books -> vault ---------------- */
  function logicalFor(phys) {
    var name = phys.slice(3); /* strip mt_ */
    try {
      var st = window.App && App._store;
      if (st && st.physKey) {
        if (st.physKey(name) === name) return name;
        var idx = name.lastIndexOf('__');
        if (idx > 0) {
          var base = name.slice(0, idx);
          if (st.physKey(base) === name) return base;
        }
      }
    } catch (e) {}
    return null;
  }
  function writeBook(phys, val) {
    /* through the store when the logical name is known, so the
       sync engine sees the slim book as an ordinary local write;
       raw only as the fallback (the migration still lands, and
       the module's next own write carries it up). A shrinking
       write cannot die on the ceiling it is draining. */
    var logical = logicalFor(phys);
    try {
      if (logical && window.App && App._store && App._store.set) {
        if (App._store.set(logical, val)) return true;
      }
    } catch (e) {}
    try { localStorage.setItem(phys, JSON.stringify(val)); return true; } catch (e) { return false; }
  }
  function sweepKey(phys) {
    var raw;
    try { raw = localStorage.getItem(phys); } catch (e) { return Promise.resolve(false); }
    if (raw === null || raw === undefined) return Promise.resolve(false);
    var hasInline = raw.indexOf('data:image/') !== -1 || raw.indexOf('data:application/pdf') !== -1;
    var hasRef = raw.indexOf(REF_PREFIX) !== -1;
    if (!hasInline && !hasRef) return Promise.resolve(false);
    if (!hasInline && raw.length > REF_SCAN_CAP) return Promise.resolve(false);
    var val;
    try { val = JSON.parse(raw); } catch (e) { return Promise.resolve(false); }
    var photos = [], seenP = {}, refs = [], seenR = {};
    walkStrings(val, function (s) {
      if (isPhotoData(s) && !seenP[s]) { seenP[s] = 1; photos.push(s); }
      if (isRef(s)) { var k = refKey(s); if (!seenR[k]) { seenR[k] = 1; refs.push(k); } }
      return undefined;
    });
    var jobs = Promise.resolve(false);
    if (photos.length) {
      var swaps = {};
      var chain = Promise.resolve();
      photos.forEach(function (p) {
        chain = chain.then(function () { return put(p); })
          .then(function (ref) { if (ref) swaps[p] = ref; });
      });
      jobs = chain.then(function () {
        if (!Object.keys(swaps).length) return false;
        var now;
        try { now = localStorage.getItem(phys); } catch (e) { return false; }
        if (now !== raw) { kick(); return false; } /* changed under the sweep — next round takes it */
        var out = walkStrings(val, function (s) { return swaps[s] || undefined; });
        return writeBook(phys, out);
      });
    }
    return jobs.then(function (changed) {
      if (!refs.length || !signedIn()) return changed;
      var rchain = Promise.resolve();
      refs.slice(0, RETRY_PER_ROUND).forEach(function (k) {
        rchain = rchain.then(function () { return retryCloudFor(k); });
      });
      return rchain.then(function () { return changed; });
    });
  }
  function sweep() {
    if (sweeping) { sweepQueued = true; return Promise.resolve(false); }
    sweeping = true;
    var keys = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('mt_') === 0 && k.indexOf('mt___') !== 0) keys.push(k);
      }
    } catch (e) {}
    var chain = Promise.resolve(false);
    var any = false;
    keys.forEach(function (phys) {
      chain = chain.then(function () { return sweepKey(phys); })
        .then(function (c) { if (c) any = true; });
    });
    return chain.then(function () {
      sweeping = false;
      if (sweepQueued) { sweepQueued = false; return sweep(); }
      return any;
    }, function () { sweeping = false; return false; });
  }
  function kick() {
    if (kickTimer) return;
    kickTimer = setTimeout(function () { kickTimer = null; sweep(); }, 800);
  }

  /* ---------------- the painter ---------------- */
  function hydrateImg(img) {
    try {
      var src = img.getAttribute('src');
      if (!isRef(src) || img.__pvBusy) return;
      img.__pvBusy = 1;
      get(src).then(function (url) {
        img.__pvBusy = 0;
        if (url && img.getAttribute('src') === src) {
          img.__pvOwn = 1;
          img.setAttribute('src', url);
        }
      }, function () { img.__pvBusy = 0; });
    } catch (e) {}
  }
  function hydrateDom(root) {
    try {
      var scope = root || document;
      if (!scope || !scope.querySelectorAll) return;
      var imgs = scope.querySelectorAll('img[src^="' + REF_PREFIX + '"]');
      for (var i = 0; i < imgs.length; i++) hydrateImg(imgs[i]);
    } catch (e) {}
  }
  var mo = null;
  function startObserver() {
    try {
      if (mo || typeof MutationObserver === 'undefined' || !document.body) return;
      mo = new MutationObserver(function (muts) {
        var sawInlinePhoto = false;
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === 'attributes' && m.target && m.target.tagName === 'IMG') {
            hydrateImg(m.target);
            var s = m.target.getAttribute && m.target.getAttribute('src');
            if (s && !m.target.__pvOwn && isPhotoData(s)) sawInlinePhoto = true;
          }
          if (m.addedNodes) {
            for (var j = 0; j < m.addedNodes.length; j++) {
              var n = m.addedNodes[j];
              if (n.nodeType !== 1) continue;
              if (n.tagName === 'IMG') {
                hydrateImg(n);
                var s2 = n.getAttribute && n.getAttribute('src');
                if (s2 && !n.__pvOwn && isPhotoData(s2)) sawInlinePhoto = true;
              }
              hydrateDom(n);
            }
          }
        }
        /* a freshly painted inline photo means a photo just
           entered a form or a book — nudge the sweep so its
           bytes reach the vault in this same session */
        if (sawInlinePhoto) kick();
      });
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    } catch (e) {}
  }

  /* ---------------- boot ---------------- */
  function boot() {
    startObserver();
    setTimeout(function () { sweep(); }, 1200);
    setInterval(function () { sweep(); }, 30000);
    try {
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) { startObserver(); sweep(); }
      });
    } catch (e) {}
  }
  try {
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
      else boot();
    }
  } catch (e) {}

  window.PhotoVault = {
    put: put,
    get: get,
    isRef: isRef,
    isPhotoData: isPhotoData,
    hydrateValue: hydrateValue,
    hydrateDom: hydrateDom,
    sweep: sweep,
    kick: kick,
    REF_PREFIX: REF_PREFIX,
    _memClear: function () { mem = {}; memOrder = []; },
    _cloudedSeen: cloudedSeen
  };
})();
