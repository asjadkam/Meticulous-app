/* Meticulous cloud sync (v27) — Firestore key-value mirror of localStorage.
 *
 * How it works:
 *  - Every App._store key (localStorage "mt_<key>") is mirrored to a Firestore
 *    document at users/{uid}/kv/{key} holding { v: <value>, updatedAt: <server ts> }.
 *  - Local writes mark the key dirty; a debounced flusher pushes dirty keys.
 *  - On sign-in we pull the whole kv collection and merge per key:
 *      local missing + cloud present            -> take cloud
 *      local present + cloud missing            -> push local (dirty)
 *      both changed since last sync (conflict)   -> latest timestamp wins
 *      only one side changed                    -> take the changed side
 *  - Offline: dirty keys persist in mt___syncmeta, so nothing is lost if the
 *    app is killed. They flush on the next sign-in / reconnect.
 *  - localStorage stays the offline cache and source of truth for the UI;
 *    cloud sync never blocks rendering.
 *
 * Internal bookkeeping lives in localStorage "mt___syncmeta" and never syncs.
 */
(function () {
  'use strict';

  var LS_PREFIX = 'mt_';
  var META_KEY = '__syncmeta';          // -> mt___syncmeta (never synced)
  var KV_COLLECTION = 'kv';
  var DEBOUNCE_MS = 2500;
  var MAX_DOC_BYTES = 900000;           // Firestore ~1MiB/doc limit; stay under
  var MIN_PULL_GAP_MS = 60000;          // don't re-pull more often than this
  var PULL_TIMEOUT_MS = 25000;          // v32: never let a pull hang forever
  var PUSH_TIMEOUT_MS = 20000;          // v33: never let a single push hang the flush

  var S = {
    attached: false,
    store: null,
    uid: null,            // uid of the active sync session (null = signed out)
    pulledUid: null,      // uid we already pulled for in this page session
    lastPullAt: 0,
    flushing: false,
    flushTimer: null,
    online: true,
    lastError: null,
    stats: { pushed: 0, pulled: 0, conflicts: 0 }
  };
  window.CloudSync = S;

  /* ---------------- tiny helpers ---------------- */

  function lsGetRaw(key) {
    try { return localStorage.getItem(LS_PREFIX + key); } catch (e) { return null; }
  }
  function lsSetRaw(key, raw) {
    try { localStorage.setItem(LS_PREFIX + key, raw); } catch (e) {}
  }
  function lsDelRaw(key) {
    try { localStorage.removeItem(LS_PREFIX + key); } catch (e) {}
  }
  function parseJson(raw, fallback) {
    if (raw === null || raw === undefined) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }
  function isSyncable(key) {
    return typeof key === 'string' && key.length > 0 && key.indexOf('__') !== 0;
  }
  function docIdFor(key) {
    // Firestore doc ids must not contain '/'
    return String(key).replace(/\//g, '_');
  }
  function cloudTsMillis(ts) {
    if (!ts) return 0;
    try {
      if (typeof ts.toMillis === 'function') return ts.toMillis();
      if (typeof ts === 'number') return ts;
      if (ts.seconds) return ts.seconds * 1000 + Math.floor((ts.nanoseconds || 0) / 1e6);
    } catch (e) {}
    return 0;
  }
  function fbReady() {
    try {
      return !!(window.FB && FB.ready && FB.user && S.uid && FB.user.uid === S.uid);
    } catch (e) { return false; }
  }

  /* ---------------- sync metadata ----------------
   * meta = { uid: <last uid>, keys: { <key>: { t: <last local write ms>,
   *                                            s: <last successful cloud sync ms>,
   *                                            d: <tombstone ms, if deleted> } } }
   * A key is "dirty" when t > s (local changed since last push).            */
  var _meta = null;
  function getMeta() {
    if (_meta) return _meta;
    _meta = parseJson(lsGetRaw(META_KEY), null) || { uid: null, keys: {} };
    if (!_meta.keys) _meta.keys = {};
    return _meta;
  }
  function saveMeta() {
    try { lsSetRaw(META_KEY, JSON.stringify(_meta || getMeta())); } catch (e) {}
  }
  function keyMeta(key) {
    var m = getMeta();
    if (!m.keys[key]) m.keys[key] = { t: 0, s: 0 };
    return m.keys[key];
  }
  function isDirty(key) {
    var km = keyMeta(key);
    if (km.d) return true; // unpushed tombstone (local delete)
    return (km.t || 0) > (km.s || 0);
  }

  /* ---------------- sync status dot ---------------- */
  var dotEl = null;
  function dot() {
    if (dotEl) return dotEl;
    try { dotEl = document.getElementById('syncDot'); } catch (e) { dotEl = null; }
    return dotEl;
  }
  function setDot(state, title) {
    S._dotState = state;
    var d = dot();
    if (!d) return;
    d.className = 'syncdot ' + (state === 'ok' ? 'synced'
      : state === 'syncing' ? 'syncing'
      : state === 'err' ? 'syncerr' : 'sync-off');
    if (title) { try { d.title = title; } catch (e) {} }
  }
  // v34: the dot must reflect THIS user's outstanding work only. A key that
  // is dirty but owned by a different uid (shared device) can never be
  // pushed by this session — counting it here wedged the dot at amber
  // "syncing" forever even though everything of the current user's was
  // backed up. flush() already filters with canPush(); the dot now does too.
  function hasPushableDirty() {
    try {
      var m = getMeta();
      for (var k in m.keys) {
        if (m.keys.hasOwnProperty(k) && isSyncable(k) && isDirty(k) && canPush(k)) return true;
      }
    } catch (e) {}
    return false;
  }
  function refreshDot() {
    if (!S.uid) { setDot('off', 'Sync off — sign in to back up your data'); return; }
    // v32: show the actual error so a stuck sync is diagnosable on-device
    if (S.lastError) { setDot('err', 'Sync error: ' + String(S.lastError).slice(0, 100)); return; }
    if (S.flushing || S._pulling) { setDot('syncing', 'Syncing…'); return; }
    // any dirty keys left that this session can actually push?
    var dirty = hasPushableDirty();
    setDot(dirty ? 'syncing' : 'ok', dirty ? 'Syncing…' : 'Backed up ✓');
  }

  /* ---------------- attach: wrap the store ---------------- */

  S.attach = function (store) {
    if (S.attached || !store) return;
    S.attached = true;
    S.store = store;
    try { S.online = typeof navigator === 'undefined' || navigator.onLine !== false; } catch (e) { S.online = true; }

    var origSet = store.set, origDel = store.del;

    store.set = function (k, v) {
      origSet(k, v);
      if (isSyncable(k)) {
        var km = keyMeta(k);
        km.t = Date.now();
        km.u = S.uid || getMeta().uid || null; // owner of this change
        delete km.d; // resurrected
        saveMeta();
        scheduleFlush();
      }
      refreshDot();
    };
    store.del = function (k) {
      origDel(k);
      if (isSyncable(k)) {
        var km = keyMeta(k);
        km.d = Date.now(); km.t = 0; // tombstone; flush() deletes the cloud doc
        km.u = S.uid || getMeta().uid || null;
        saveMeta();
        scheduleFlush();
      }
      refreshDot();
    };

    // Upgrade path: this code is new, so existing local data has no metadata.
    // Backfill it as "old local data" so the first flush uploads it.
    var meta = getMeta();
    if (!meta._backfilled) {
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var full = localStorage.key(i);
          if (full && full.indexOf(LS_PREFIX) === 0) {
            var k = full.slice(LS_PREFIX.length);
            if (isSyncable(k) && !meta.keys[k]) meta.keys[k] = { t: 1, s: 0, u: meta.uid || null };
          }
        }
      } catch (e) {}
      meta._backfilled = true;
      saveMeta();
    }

    try {
      window.addEventListener('online', function () { S.online = true; S.lastError = null; syncNow(); });
      window.addEventListener('offline', function () { S.online = false; refreshDot(); });
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') flush();
      });
      window.addEventListener('beforeunload', function () { flush(); });
      // v33: watchdog — every 30s, if dirty keys exist and no sync is in
      // flight, kick one off. Catches cases where an early-return or a
      // timed-out push left work stranded with a yellow dot.
      // v34: only pushable dirty keys count (same rule as the dot).
      setInterval(function () {
        try {
          if (!S.attached || S.flushing || S._pulling || !S.uid) return;
          if (hasPushableDirty()) syncNow();
        } catch (e) {}
      }, 30000);
    } catch (e) {}

    refreshDot();
  };

  /* ---------------- auth ---------------- */

  // Called from App.onAuth on every auth state change.
  S.onAuth = function (user) {
    var newUid = user ? user.uid : null;
    if (newUid === S.uid) { refreshDot(); return; } // same session, nothing to do
    drainPullWaiters(false); // stale waiters belonged to the previous session
    S.uid = newUid;
    S.pulledUid = null;
    S.lastError = null;
    if (!newUid) { setDot('off', 'Sync off — sign in to back up your data'); return; }
    // New (or changed) user: pull first, then flush. Guard against FB not ready yet.
    ensureFbReady(function () { syncNow(); });
  };

  function ensureFbReady(cb) {
    var tries = 0;
    (function wait() {
      if (window.FB && FB.ready) { cb(); return; }
      if (++tries > 40) { S.lastError = 'firebase-unavailable'; refreshDot(); return; }
      setTimeout(wait, 500);
    })();
  }

  /* ---------------- push (local -> cloud) ---------------- */

  // Push allowlist: on this device's very first sync anything goes (local-mode
  // -> sign-in claim flow). After that, a key may only be pushed by the uid
  // that owns it, so a second user on a shared device can never receive or
  // overwrite the first user's data.
  function canPush(key) {
    var m = getMeta();
    if (!m.globallySynced) return true;
    var km = m.keys[key];
    return ((km && km.u) || m.uid || null) === S.uid;
  }

  function scheduleFlush() {
    if (S.flushTimer) return;
    S.flushTimer = setTimeout(function () { S.flushTimer = null; flush(); }, DEBOUNCE_MS);
  }

  // v33: race a single push against a timeout. A Firestore set()/delete()
  // that never settles used to wedge S.flushing=true forever (infinite
  // yellow dot) — v32 fixed this for pull but not for push. On timeout the
  // key stays dirty (retried later) and the error surfaces as a red dot
  // instead of an endless yellow pulse.
  function pushOneWithTimeout(key) {
    var pushP;
    try { pushP = pushOne(key); }
    catch (e) { pushP = Promise.reject(e); }
    var timeoutP = new Promise(function (_, reject) {
      setTimeout(function () {
        reject(new Error('push-timeout: Firestore gave no response in ' +
          Math.round(PUSH_TIMEOUT_MS / 1000) + 's for key "' + key + '" — check connection, then retry'));
      }, PUSH_TIMEOUT_MS);
    });
    return Promise.race([pushP, timeoutP]).catch(function (e) {
      var msg = 'push ' + key + ': ' + String((e && e.message) || e);
      try { (S._flushErrors = S._flushErrors || []).push(msg); } catch (e2) {}
      try { console.warn('[cloudsync] ' + msg); } catch (e3) {}
      return false;
    });
  }

  function flush() {
    if (S.flushing) { scheduleFlush(); return; }
    if (!fbReady() || !S.online) {
      refreshDot();
      // v33: don't give up silently — Firebase Auth can be slow to restore
      // on a cold start. Previously this returned without rescheduling, so
      // dirty keys sat forever with a yellow dot and no error. Retry soon.
      try {
        if (hasPushableDirty()) setTimeout(function () { if (!S.flushing) flush(); }, 10000);
      } catch (e) {}
      return;
    }
    S.flushing = true;
    setDot('syncing', 'Syncing…');
    var keys = [];
    try {
      var m = getMeta();
      for (var k in m.keys) {
        if (m.keys.hasOwnProperty(k) && isSyncable(k) && isDirty(k) && canPush(k)) keys.push(k);
      }
    } catch (e) {}
    // Also catch keys that exist locally but somehow have no meta (paranoia).
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var full = localStorage.key(i);
        if (full && full.indexOf(LS_PREFIX) === 0) {
          var k2 = full.slice(LS_PREFIX.length);
          if (isSyncable(k2) && keys.indexOf(k2) < 0 && !getMeta().keys[k2]) {
            var _km2 = keyMeta(k2);
            _km2.t = Date.now(); _km2.u = S.uid || getMeta().uid || null;
            if (canPush(k2)) keys.push(k2);
          }
        }
      }
      if (keys.length) saveMeta();
    } catch (e) {}

    // v32: collect per-key push errors. Previously failures were swallowed,
    // keys stayed dirty forever, and the dot pulsed yellow indefinitely with
    // no way to see why. Now the first error surfaces (red dot + message).
    S._flushErrors = [];
    var chain = Promise.resolve();
    keys.forEach(function (k) { chain = chain.then(function () { return pushOneWithTimeout(k); }); });
    chain.then(function () {
      S.flushing = false;
      if (S._flushErrors.length) {
        S.lastError = S._flushErrors[0];
        S._flushFails = (S._flushFails || 0) + 1;
      } else {
        S.lastError = null;
        S._flushFails = 0;
      }
      saveMeta(); refreshDot();
    }).catch(function (e) {
      S.flushing = false; S.lastError = String((e && e.message) || e); saveMeta(); refreshDot();
    });
  }

  function pushOne(key) {
    var km = keyMeta(key);
    var raw = lsGetRaw(key);
    var docId = docIdFor(key);
    var done = function (ok) {
      if (ok) {
        km.s = Date.now(); delete km.d; S.stats.pushed++;
        var _dm = getMeta(); _dm.uid = S.uid; _dm.globallySynced = true;
      }
      saveMeta();
      return ok;
    };
    if (raw === null) {
      // Deleted locally -> delete the cloud doc (tombstone).
      if (!fbReady()) return Promise.resolve(false);
      try {
        return FB.deleteDoc(KV_COLLECTION, docId).then(function () { return done(true); })
          .catch(function (e) {
            try { (S._flushErrors = S._flushErrors || []).push('delete ' + key + ': ' + String((e && e.message) || e)); } catch (e2) {}
            return done(false);
          });
      } catch (e) { return Promise.resolve(done(false)); }
    }
    var val = parseJson(raw, undefined);
    if (val === undefined) {
      // v34: unparseable local value. It can never be pushed as JSON, and
      // leaving it dirty wedged the dot at amber "syncing" forever with no
      // error shown (found in the v34 audit). Treat it like the oversized
      // case below: stop retrying, keep the local copy as the truth.
      try { console.warn('[cloudsync] skipping unparseable key (kept locally):', key); } catch (e) {}
      km.s = km.t;
      saveMeta();
      return Promise.resolve(done(false));
    }
    var size = 0;
    try { size = raw.length; } catch (e) {}
    if (size > MAX_DOC_BYTES) {
      try { console.warn('[cloudsync] skipping oversized key (kept locally):', key, size); } catch (e) {}
      km.s = km.t; // don't retry forever; local copy remains the truth
      saveMeta();
      return Promise.resolve(false);
    }
    if (!fbReady()) return Promise.resolve(false);
    try {
      return FB.saveDoc(KV_COLLECTION, docId, { v: val }).then(function (res) {
        if (res === null) {
          try { (S._flushErrors = S._flushErrors || []).push('push ' + key + ': not signed in'); } catch (e2) {}
        }
        return done(res !== null); // saveDoc resolves null when not signed in
      }).catch(function (e) {
        var msg = 'push ' + key + ': ' + String((e && e.message) || e);
        try { (S._flushErrors = S._flushErrors || []).push(msg); } catch (e2) {}
        try { console.warn('[cloudsync] ' + msg); } catch (e3) {}
        return done(false);
      });
    } catch (e) { return Promise.resolve(done(false)); }
  }

  /* ---------------- pull (cloud -> local) ---------------- */

  function syncNow() {
    // v34: self-heal a desync where Firebase HAS a signed-in user but this
    // engine never got (or lost) that sign-in — on device the dot then sat
    // gray ('off') while the user was signed in. Re-driving onAuth restarts
    // pull+flush. No loop: onAuth sets S.uid, so the nested syncNow proceeds.
    try {
      if (window.FB && FB.user && FB.user.uid !== S.uid) { S.onAuth(FB.user); return; }
    } catch (e) {}
    if (!fbReady()) { refreshDot(); return; }
    pull().then(function () { flush(); }).catch(function () { flush(); });
  }
  S.syncNow = syncNow;
  S.flush = flush;

  /* ---------------- first-pull waiter (v28) ----------------
   * Lets routing code (afterAuth) wait for the first cloud pull to settle
   * before deciding onboarding vs main. On a fresh install the local
   * onboarded flag is empty until the pull restores it; routing immediately
   * would show the onboarding questions even though the answers are saved.
   * Resolves true when a pull completed for the current uid, false on
   * timeout / failure / no signed-in user. Never hangs: always settles. */
  var _pullWaiters = [];
  function drainPullWaiters(v) {
    var w = _pullWaiters; _pullWaiters = [];
    for (var i = 0; i < w.length; i++) { try { w[i](v); } catch (e) {} }
  }
  S.whenFirstPullDone = function (timeoutMs) {
    return new Promise(function (resolve) {
      if (!S.uid || S.pulledUid === S.uid) { resolve(!!S.uid && S.pulledUid === S.uid); return; }
      var done = false;
      var finish = function (v) { if (!done) { done = true; resolve(v); } };
      _pullWaiters.push(finish);
      setTimeout(function () { finish(false); }, timeoutMs || 9000);
    });
  };

  function pull() {
    if (!fbReady() || S._pulling) return Promise.resolve({ applied: 0 });
    if (S.pulledUid === S.uid && Date.now() - S.lastPullAt < MIN_PULL_GAP_MS) {
      return Promise.resolve({ applied: 0 }); // already pulled recently
    }
    S._pulling = true;
    setDot('syncing', 'Syncing…');
    var meta = getMeta();
    var firstSyncForUid = meta.uid !== S.uid;

    // v32: a Firestore get() that never settles used to wedge _pulling=true
    // forever (infinite yellow dot). Race it against a timeout; a late
    // response arriving after the timeout is ignored.
    var timedOut = false, loadP;
    try { loadP = FB.loadDocs(KV_COLLECTION); }
    catch (e) { loadP = Promise.reject(e); }
    var timeoutP = new Promise(function (_, reject) {
      setTimeout(function () {
        timedOut = true;
        reject(new Error('pull-timeout: Firestore gave no response in ' + Math.round(PULL_TIMEOUT_MS / 1000) + 's — check connection, then retry'));
      }, PULL_TIMEOUT_MS);
    });
    return Promise.race([loadP, timeoutP]).then(function (docs) {
      if (timedOut) return { applied: 0 }; // stale late response; ignore
      var applied = 0, cloudKeys = {}, now = Date.now();
      docs.forEach(function (d) {
        var key = d.mt || d.id;
        if (!isSyncable(key)) return;
        cloudKeys[key] = true;
        var cloudTs = cloudTsMillis(d.updatedAt) || now;
        var km = keyMeta(key);
        var raw = lsGetRaw(key);
        var localDirty = (km.t || 0) > (km.s || 0);
        var cloudChanged = cloudTs > (km.s || 0);

        if (raw === null) {
          // Not on this device.
          if (km.d && km.d > cloudTs) {
            // We deleted it more recently than the cloud copy -> delete cloud copy.
            try { FB.deleteDoc(KV_COLLECTION, docIdFor(key)); } catch (e) {}
            delete meta.keys[key];
          } else {
            lsSetRaw(key, JSON.stringify(d.v));
            meta.keys[key] = { t: cloudTs, s: cloudTs };
            applied++;
          }
        } else if (!localDirty && cloudChanged) {
          // Only the cloud changed -> take cloud.
          lsSetRaw(key, JSON.stringify(d.v));
          meta.keys[key] = { t: cloudTs, s: cloudTs };
          applied++;
        } else if (localDirty && cloudChanged) {
          // Both changed -> latest timestamp wins.
          S.stats.conflicts++;
          var localTs = km.t || 0;
          if (cloudTs > localTs) {
            lsSetRaw(key, JSON.stringify(d.v));
            meta.keys[key] = { t: cloudTs, s: cloudTs };
            applied++;
            try { console.log('[cloudsync] conflict on', key, '-> cloud won'); } catch (e) {}
          } else {
            try { console.log('[cloudsync] conflict on', key, '-> local won'); } catch (e) {}
            // local stays dirty; flush() will push it up.
          }
        }
        // else: only local changed (flush handles it) or nothing changed.
      });

      // Fresh account (cloud empty) + local data from local-mode use:
      // mark everything dirty so the flush uploads it. ONLY on this device's
      // very first sync — never for a different user on a shared device
      // (globallySynced guard), so we can't wipe someone else's data.
      if (docs.length === 0 && firstSyncForUid && !meta.globallySynced) {
        try {
          for (var i = 0; i < localStorage.length; i++) {
            var full = localStorage.key(i);
            if (full && full.indexOf(LS_PREFIX) === 0) {
              var k = full.slice(LS_PREFIX.length);
              if (isSyncable(k)) { var km2 = keyMeta(k); if (!(km2.t > km2.s)) km2.t = Date.now(); }
            }
          }
        } catch (e) {}
      }

      meta.uid = S.uid;
      meta.globallySynced = true;
      saveMeta();
      S.pulledUid = S.uid;
      S.lastPullAt = Date.now();
      S._pulling = false;
      S.lastError = null; // v34: a healthy pull clears a stale earlier error
      S.stats.pulled += applied;
      refreshDot();

      // If the pull changed anything the UI already rendered, re-render.
      if (applied > 0) {
        try {
          if (window.App && App.user && App.onAuth && S.uid && App.user.uid === S.uid) {
            App.onAuth(App.user); // same uid -> no re-pull (pulledUid guard)
          }
        } catch (e) {}
        // v28: if the pull restored the onboarded flag while the user was
        // parked on the onboarding questions (auto-routed before the pull
        // finished), take them straight to the main screen. Only when they
        // haven't started answering (step 0) — never yank a form mid-fill.
        try {
          if (window.App && App.currentView === 'onboarding' && (App.onbStep || 0) === 0 &&
              App._store && App._store.get('onboarded', false) === true && App.showView) {
            App.showView('main');
          }
        } catch (e2) {}
      }
      drainPullWaiters(true);
      return { applied: applied };
    }).catch(function (e) {
      S._pulling = false;
      S.lastError = String((e && e.message) || e);
      try { console.warn('[cloudsync] pull failed:', S.lastError); } catch (e2) {}
      refreshDot();
      drainPullWaiters(false);
      return { applied: 0 };
    });
  }
  S.pull = pull;

  /* ---------------- status for debugging ---------------- */
  S.status = function () {
    var m = getMeta(), dirty = [];
    try {
      for (var k in m.keys) {
        // v34: same rule as the dot — dirty AND pushable by this user
        // (the old t>s check also missed unpushed tombstones).
        if (m.keys.hasOwnProperty(k) && isSyncable(k) && isDirty(k) && canPush(k)) dirty.push(k);
      }
    } catch (e) {}
    return {
      attached: S.attached, uid: S.uid, online: S.online,
      dot: S._dotState || 'off', dirtyKeys: dirty, lastError: S.lastError, stats: S.stats
    };
  };
})();
