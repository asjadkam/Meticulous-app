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
 *
 * v136 — SYNC TRUTH ACCOUNTING. Oct 17 field evidence: during a working
 * day the header dot NEVER turned green and the Preferences card sat on
 * "Still syncing — give it a moment." Characterization (working-day
 * replay against the v135 engine): the dot was green in 2 of 149 samples
 * — the old settle rule ("no pushable key dirty at the instant the dot
 * repaints") is unreachable by construction while the truck works,
 * because the two live-tracking stores (livemiles, geoloads) rewrite
 * themselves every <=10s all shift and every rewrite re-dirties the
 * queue faster than a flush can drain it. A second path to eternal
 * amber: when pushes can't run at all (Firebase auth object gone), the
 * flusher early-returned silently — "Syncing…" forever, no error, ever.
 * The fix is accounting only — no record content or data shape changes:
 *  - DURABLE keys (everything user-owned: dispatches, invoices, fuel,
 *    sessions, connections…) decide GREEN. Green = every durable key's
 *    latest state confirmed in the cloud; the moment is remembered
 *    (meta.lastSettledAt) and shown as "All synced · 12:41 PM".
 *  - TELEMETRY keys (livemiles, geoloads — continuously rewritten live
 *    snapshots) keep syncing through the very same flush, but a
 *    telemetry snapshot a few seconds behind never holds the durable
 *    truth hostage; status() reports telemetryBehind honestly instead.
 *  - A store whose push fails REPEATEDLY becomes a NAMED failure (red
 *    dot + the store named in plain words on the card), never eternal
 *    amber. Dead transport with work waiting surfaces the same way
 *    after a grace window (offline surfaces at once). A healthy PULL
 *    no longer clears a PUSH failure — a pull pushes nothing.
 */
(function () {
  'use strict';

  var LS_PREFIX = 'mt_';
  var META_KEY = '__syncmeta';          // -> mt___syncmeta (never synced)
  var KV_COLLECTION = 'kv';
  /* v219: the Connect-family keys js/app.js namespaces per owner
     (kept in step with CON_FAMILY there; __peer_wages is in the
     family too but starts '__', so it never syncs either way). */
  var CON_FAMILY_KEYS = { con_list: 1, con_hidden: 1, con_outbox: 1,
    pipe_landed: 1, pipe_seen: 1, nav_shares: 1, cp_hist_peers: 1 };
  var DEBOUNCE_MS = 2500;
  var MAX_DOC_BYTES = 900000;           // Firestore ~1MiB/doc limit; stay under
  var MIN_PULL_GAP_MS = 60000;          // don't re-pull more often than this
  var PULL_TIMEOUT_MS = 25000;          // v32: never let a pull hang forever
  var PUSH_TIMEOUT_MS = 20000;          // v33: never let a single push hang the flush
  var BLOCKED_GRACE_MS = 60000;         // v136: dead transport -> named failure after this long

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
    stats: { pushed: 0, pulled: 0, conflicts: 0 },
    /* v136 truth accounting (see header): per-key repeated push
       failures, pull failures, dead-transport bookkeeping, and the
       listeners the Preferences card paints from. */
    _keyFails: {},          // key -> { n: consecutive failed flushes, msg, at }
    _pullFails: 0,          // consecutive failed pulls
    _pullFailMsg: null,
    _genFails: 0,           // consecutive unattributed sync failures
    _genFailMsg: null,
    _transportFail: null,   // sync service itself unreachable (firebase never ready)
    _blockedSince: 0,       // when waiting work first found pushes unable to run
    _flushDurable: false,   // the in-flight flush carries >=1 durable key
    _truth: null,           // last computed syncTruth()
    _statusListeners: []
  };
  window.CloudSync = S;
  S._BLOCKED_GRACE_MS = BLOCKED_GRACE_MS; // exposed for the v136 suite

  /* The Preferences card (and any future face) paints from the SAME
     truth the dot does — one state machine, two faces. */
  S.addStatusListener = function (fn) {
    if (typeof fn === 'function') S._statusListeners.push(fn);
  };

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

  /* ---------------- v136: durable vs telemetry, plain names ----------------
   * TELEMETRY keys hold continuously rewritten LIVE snapshots (the
   * miles engine persists livemiles, the load counter persists
   * geoloads — each at most every ~10s while a session runs). They
   * sync through the same flush as everything else; only the SETTLE
   * accounting differs (see the header note). Every other syncable
   * key is DURABLE user data and decides green. */
  var TELEMETRY_KEYS = { livemiles: true, geoloads: true };
  function isTelemetryKey(key) { return !!TELEMETRY_KEYS[key]; }

  /* Plain words for a store, for the named-failure face — a driver
     should read "a fuel entry hasn't backed up", never a key name. */
  var PLAIN_NAME_RULES = [
    ['onboarding', 'your setup answers'], ['sessions', 'your shift records'],
    ['navigator', 'your navigator settings'], ['nav', 'a saved place'],
    ['dsp', 'a dispatch record'], ['inv', 'an invoice record'],
    ['fuel', 'a fuel entry'], ['rev', 'a revenue record'],
    ['pnl', 'a P&L record'], ['con_', 'a connection record'],
    ['odo_readings', 'an odometer reading'], ['mt_odo', 'your odometer'],
    ['rem_', 'a reminder'], ['pti_', 'a pre-trip inspection report'], ['mani', 'a manifest record'],
    ['dmg', 'a damage report'], ['tracker', 'your tracker settings'],
    ['livemiles', 'live miles tracking'], ['geoloads', 'load counting'],
    ['feedback', 'a feedback note'], ['dayarm', 'shift tracking'],
    ['autostart', 'your auto-start setting'], ['subscription', 'your subscription record']
  ];
  function plainKeyName(key) {
    for (var i = 0; i < PLAIN_NAME_RULES.length; i++) {
      if (String(key).indexOf(PLAIN_NAME_RULES[i][0]) === 0) return PLAIN_NAME_RULES[i][1];
    }
    return 'one of your records';
  }
  function fmtClock(ms) {
    var d = new Date(ms), h = d.getHours(), m = d.getMinutes();
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
  }
  /* The last moment the DURABLE ledger was observed fully confirmed
     in the cloud, remembered across restarts (local meta only — this
     bookkeeping never syncs). Scoped to the uid that earned it. */
  function lastSettledAt() {
    var m = getMeta();
    return (m.lastSettledUid && m.lastSettledUid === S.uid) ? (m.lastSettledAt || 0) : 0;
  }
  function stampSettled() {
    var m = getMeta();
    m.lastSettledAt = Date.now();
    m.lastSettledUid = S.uid;
    saveMeta();
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
  function pushableDirtyKeys() {
    var out = [];
    try {
      var m = getMeta();
      for (var k in m.keys) {
        if (m.keys.hasOwnProperty(k) && isSyncable(k) && isDirty(k) && canPush(k)) out.push(k);
      }
    } catch (e) {}
    return out;
  }
  function hasPushableDirty() { return pushableDirtyKeys().length > 0; }
  function durableDirtyKeys() {
    return pushableDirtyKeys().filter(function (k) { return !isTelemetryKey(k); });
  }
  function telemetryDirtyKeys() {
    return pushableDirtyKeys().filter(function (k) { return isTelemetryKey(k); });
  }
  function canRunPushes() {
    try { return !!S.online && fbReady(); } catch (e) { return false; }
  }

  /* ------- v136 failure bookkeeping -------
   * A failure PAINTS (red dot, named on the card) only once it is
   * REPEATED — a single network blip retries quietly in amber instead
   * of crying wolf. Records clear per key the moment that key pushes
   * successfully; a pull never clears a push record (a pull pushes
   * nothing — the v135 engine let a healthy pull wipe a standing push
   * error, hiding a failing store inside eternal amber). */
  function noteKeyFailure(key, msg) {
    var rec = S._keyFails[key] || (S._keyFails[key] = { n: 0, msg: '', at: 0 });
    rec.n++; rec.msg = msg; rec.at = Date.now();
  }
  function paintedPushFail() {
    for (var k in S._keyFails) {
      if (S._keyFails.hasOwnProperty(k)) {
        var r = S._keyFails[k];
        if (r && r.n >= 2) return { key: k, msg: r.msg, kind: 'push' };
      }
    }
    return null;
  }
  function currentErrorString() {
    for (var k in S._keyFails) {
      if (S._keyFails.hasOwnProperty(k) && S._keyFails[k]) return S._keyFails[k].msg;
    }
    if (S._pullFails > 0 && S._pullFailMsg) return S._pullFailMsg;
    if (S._genFails > 0 && S._genFailMsg) return S._genFailMsg;
    if (S._transportFail) return S._transportFail;
    return null;
  }
  /* Stamp the settle moment when the durable ledger stands fully
     confirmed with no painted push failure behind it. */
  function noteSettleMaybe() {
    if (!S.uid) return;
    if (durableDirtyKeys().length) return;
    if (paintedPushFail()) return;
    stampSettled();
  }

  /* ------- v136: THE one sync truth -------
   * States the owner can read at a glance:
   *   off     — signed out; nothing is backing up.
   *   ok      — every DURABLE store's latest state is confirmed in
   *             the cloud (lastSettledAt says when). Telemetry
   *             snapshots a few seconds behind do not block this;
   *             telemetryBehind reports them honestly instead.
   *   syncing — work is genuinely in flight or next in line: a pull
   *             is running, a flush carrying durable keys is running,
   *             or durable edits are waiting out their flush debounce.
   *   err     — a NAMED failure: a store that keeps failing to back
   *             up, the sync service unreachable, or the phone
   *             offline / cut off from the cloud with work waiting.
   *             Never eternal amber: dead transport surfaces after
   *             BLOCKED_GRACE_MS (offline surfaces at once — that is
   *             a fact, not a guess).                        */
  function syncTruth() {
    var t = {
      state: 'off', label: 'Sync off', failKey: null, failMsg: null,
      failPlain: null, failKind: null, blocked: false,
      lastSettledAt: 0, telemetryBehind: false,
      durableDirty: [], telemetryDirty: []
    };
    if (!S.uid) { S._truth = t; return t; }
    t.durableDirty = durableDirtyKeys();
    t.telemetryDirty = telemetryDirtyKeys();
    t.telemetryBehind = t.telemetryDirty.length > 0;
    t.lastSettledAt = lastSettledAt();

    var pf = paintedPushFail();
    if (pf) {
      t.state = 'err'; t.failKey = pf.key; t.failMsg = pf.msg;
      t.failPlain = plainKeyName(pf.key); t.failKind = 'push';
      S._truth = t; return t;
    }
    if (S._transportFail) {
      t.state = 'err'; t.failMsg = S._transportFail; t.failKind = 'transport'; t.blocked = true;
      S._truth = t; return t;
    }
    if (S._genFails >= 2) {
      t.state = 'err'; t.failMsg = S._genFailMsg; t.failKind = 'error'; t.blocked = true;
      S._truth = t; return t;
    }
    if (S._pullFails >= 2) {
      t.state = 'err'; t.failMsg = S._pullFailMsg; t.failKind = 'pull'; t.blocked = true;
      S._truth = t; return t;
    }
    if (t.durableDirty.length && !canRunPushes()) {
      // Work is waiting and pushes cannot run at all.
      if (!S.online) {
        t.state = 'err'; t.failKind = 'offline'; t.blocked = true;
        t.failMsg = 'Phone is offline';
        S._truth = t; return t;
      }
      if (!S._blockedSince) S._blockedSince = Date.now();
      if (Date.now() - S._blockedSince > (S._BLOCKED_GRACE_MS || BLOCKED_GRACE_MS)) {
        t.state = 'err'; t.failKind = 'blocked'; t.blocked = true;
        t.failMsg = "Can't reach the cloud";
        S._truth = t; return t;
      }
      t.state = 'syncing'; t.label = 'Syncing…'; // grace window — auth may still be restoring
      S._truth = t; return t;
    }
    if (canRunPushes() || !t.durableDirty.length) S._blockedSince = 0;
    if (S._pulling) { t.state = 'syncing'; t.label = 'Syncing…'; S._truth = t; return t; }
    if (S.flushing && S._flushDurable) { t.state = 'syncing'; t.label = 'Syncing…'; S._truth = t; return t; }
    if (t.durableDirty.length) { t.state = 'syncing'; t.label = 'Syncing…'; S._truth = t; return t; }
    t.state = 'ok';
    t.label = 'All synced' + (t.lastSettledAt ? ' · ' + fmtClock(t.lastSettledAt) : '');
    S._truth = t; return t;
  }

  function refreshDot() {
    var t = syncTruth();
    S.lastError = currentErrorString();
    if (!S.uid) { setDot('off', 'Sync off — sign in to back up your data'); }
    else if (t.state === 'err') {
      setDot('err', t.failKey
        ? 'Sync problem — ' + t.failPlain + " hasn't backed up"
        : t.failKind === 'offline' ? 'Offline — changes are waiting to back up'
        : 'Sync error: ' + String(t.failMsg || 'sync failed').slice(0, 100));
    }
    else if (t.state === 'syncing') { setDot('syncing', 'Syncing…'); }
    else {
      setDot('ok', 'All synced' + (t.lastSettledAt ? ' · ' + fmtClock(t.lastSettledAt) : ''));
    }
    for (var i = 0; i < S._statusListeners.length; i++) {
      try { S._statusListeners[i](t); } catch (e) {}
    }
  }

  /* ---------------- attach: wrap the store ---------------- */

  S.attach = function (store) {
    if (S.attached || !store) return;
    S.attached = true;
    S.store = store;
    try { S.online = typeof navigator === 'undefined' || navigator.onLine !== false; } catch (e) { S.online = true; }

    var origSet = store.set, origDel = store.del;

    /* v219: sync meta is keyed by the store's PHYSICAL key, so a
       namespaced Connect key (con_list__<uid>) mirrors to the kv
       doc of the same name in the owner's own tree. A store with
       no namespacing (suite stubs) keys exactly as before. */
    function physOf(k) {
      try { return store.physKey ? store.physKey(k) : k; } catch (e) { return k; }
    }

    store.set = function (k, v) {
      var _ok = origSet(k, v); // v48: pass the write result through (see js/app.js)
      var pk = physOf(k);
      if (isSyncable(pk)) {
        var km = keyMeta(pk);
        km.t = Date.now();
        km.u = S.uid || getMeta().uid || null; // owner of this change
        delete km.d; // resurrected
        saveMeta();
        scheduleFlush();
      }
      refreshDot();
      return _ok;
    };
    store.del = function (k) {
      var _ok = origDel(k); // v48: pass the result through, same as set
      var pk = physOf(k);
      if (isSyncable(pk)) {
        var km = keyMeta(pk);
        km.d = Date.now(); km.t = 0; // tombstone; flush() deletes the cloud doc
        km.u = S.uid || getMeta().uid || null;
        saveMeta();
        scheduleFlush();
      }
      refreshDot();
      return _ok;
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
      window.addEventListener('online', function () { S.online = true; S._blockedSince = 0; syncNow(); });
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

  /* ---------------- v216: PROFILE OWNERSHIP ----------------
   * PROFILE-RESTORE-INTEGRITY (owner, Oct 21, 2026 15:28 MDT):
   * "I am 100% certain I left this account as Dave cooper and
   * owner operator account" — yet after an uninstall/reinstall the
   * tester account's Preferences showed his REAL profile (his real
   * name, Driver account type). The mechanism: the 'onboarding'
   * store key IS the profile record (first/last name, account
   * type, drives-answer, employment, business, rates…); it lived in
   * ONE device-wide slot, and the pull's field-merge (v107, built
   * to heal ONE person's phone-vs-cloud divergence) let a foreign
   * profile's set fields survive under whichever account signed
   * in next. Identity data bled across accounts on one device.
   * The rule now: the slot is OWNED.
   *   - mt___profowner (internal, never synced) names the active
   *     slot's owner: a uid, or 'local' for the signed-out slot.
   *   - mt___profiles (internal, never synced) stashes each
   *     owner's record while another owner is active.
   *   - profileGate(user) runs at every auth change — App.onAuth
   *     calls it before anything paints, S.onAuth calls it before
   *     any pull: the outgoing record is stashed under its owner
   *     and the incoming owner's record becomes active — its own
   *     stash if this device has seen it, otherwise a VACATED slot
   *     the sign-in pull then fills from THAT account's cloud
   *     profile (the pull's raw-missing branch takes the cloud
   *     doc wholesale). One account's profile can never render
   *     under another — not after account switches, not after an
   *     uninstall/reinstall + backup restore lands stale local
   *     data before sign-in.
   *   - The first-run claim survives: a device that has never
   *     synced any account (globallySynced false, no other uid on
   *     record) lets its FIRST account adopt the local slot —
   *     the v107 local-mode -> sign-in claim, the same person
   *     setting up. Once any account has synced here, a uid-owned
   *     or local slot never crosses to a different account.
   * The swap writes localStorage RAW (never through the wrapped
   * store): the swap itself marks nothing dirty, the outgoing
   * account's record can never be pushed into the incoming
   * account's cloud, and the 'onboarding' sync meta is reset to a
   * neutral state the pull reconciles as same-account. */
  var PROF_OWNER_KEY = '__profowner';   // -> mt___profowner
  var PROF_STASH_KEY = '__profiles';    // -> mt___profiles
  function profOwnerNow() {
    var o = parseJson(lsGetRaw(PROF_OWNER_KEY), null);
    return (typeof o === 'string' && o) ? o : null;
  }
  S.profileOwner = profOwnerNow; // exposed for the v216 suite
  S.profileGate = function (user) {
    try {
      /* v219: snapshot the PREVIOUS sync owner at the gate —
         the funnel's first step, before this session's pull or
         push can re-stamp meta.uid. js/app.js's Connect-key
         adoption reads this snapshot to decide whether the
         pre-fix shared slot is attributable to the account now
         signing in (the same before-the-pull discipline this
         gate itself runs on). */
      S._prevSyncUid = getMeta().uid || null;
      var newOwner = user ? user.uid : 'local';
      var meta = getMeta();
      var curOwner = profOwnerNow();
      if (!curOwner) {
        // First run of the gate on this device: the slot on the
        // device belongs to the last account that synced here —
        // or to the local slot if no account ever did.
        curOwner = meta.uid || 'local';
        lsSetRaw(PROF_OWNER_KEY, JSON.stringify(curOwner));
      }
      if (curOwner === newOwner) return false;
      if (newOwner !== 'local' && curOwner === 'local' && !meta.globallySynced &&
          (!meta.uid || meta.uid === newOwner)) {
        // First-run claim (see header): the first account this
        // device ever syncs adopts the local slot.
        lsSetRaw(PROF_OWNER_KEY, JSON.stringify(newOwner));
        keyMeta('onboarding').u = newOwner;
        saveMeta();
        return true;
      }
      var stash = parseJson(lsGetRaw(PROF_STASH_KEY), {}) || {};
      var cur = parseJson(lsGetRaw('onboarding'), null);
      if (cur && typeof cur === 'object' && !Array.isArray(cur)) stash[curOwner] = cur;
      else delete stash[curOwner];
      lsSetRaw(PROF_STASH_KEY, JSON.stringify(stash));
      var incoming = stash[newOwner];
      S._profVacatedFor = null;
      if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
        lsSetRaw('onboarding', JSON.stringify(incoming));
      } else {
        lsDelRaw('onboarding');
        /* The slot was vacated for this account: until its first
           pull lands, shell defaults may get stamped into the empty
           slot (ensureUserRole) — those stamps are NOT this
           account's answers and must never win the pull merge
           against its cloud profile. pull() reads this marker. */
        if (user) S._profVacatedFor = newOwner;
      }
      lsSetRaw(PROF_OWNER_KEY, JSON.stringify(newOwner));
      var km = keyMeta('onboarding');
      km.t = 0; km.s = 0; delete km.d; km.u = user ? newOwner : (meta.uid || null);
      saveMeta();
      return true;
    } catch (e) { return false; }
  };

  /* ---------------- auth ---------------- */

  // Called from App.onAuth on every auth state change.
  S.onAuth = function (user) {
    // v216: the profile slot changes hands before any pull runs.
    S.profileGate(user);
    var newUid = user ? user.uid : null;
    if (newUid === S.uid) { refreshDot(); return; } // same session, nothing to do
    drainPullWaiters(false); // stale waiters belonged to the previous session
    S.uid = newUid;
    S.pulledUid = null;
    S.lastError = null;
    // v136: a new session starts with clean failure books — the records
    // describe the previous account's pushes, not this one's.
    S._keyFails = {}; S._pullFails = 0; S._pullFailMsg = null;
    S._genFails = 0; S._genFailMsg = null;
    S._transportFail = null; S._blockedSince = 0; S._flushDurable = false;
    if (!newUid) { setDot('off', 'Sync off — sign in to back up your data'); return; }
    // New (or changed) user: pull first, then flush. Guard against FB not ready yet.
    ensureFbReady(function () { syncNow(); });
  };

  function ensureFbReady(cb) {
    var tries = 0;
    (function wait() {
      if (window.FB && FB.ready) { cb(); return; }
      if (++tries > 40) { S._transportFail = 'firebase-unavailable'; refreshDot(); return; }
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
      try { (S._flushErrors = S._flushErrors || []).push({ key: key, msg: msg }); } catch (e2) {}
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
    // v136: errors carry their key ({key, msg}) so the failure can be
    // NAMED per store by the truth accounting.
    S._flushErrors = [];
    // v136: a flush that is actually running ends any dead-transport
    // episode, and the truth needs to know whether it carries durable
    // work (a telemetry-only flush in flight must not paint amber over
    // a settled durable ledger).
    S._blockedSince = 0;
    S._flushDurable = keys.some(function (k) { return !isTelemetryKey(k); });
    var chain = Promise.resolve();
    keys.forEach(function (k) { chain = chain.then(function () { return pushOneWithTimeout(k); }); });
    chain.then(function () {
      S.flushing = false;
      S._flushDurable = false;
      if (S._flushErrors.length) {
        // one failure count per key per flush (a timed-out push whose
        // late error also lands must not double-count one attempt)
        var seen = {};
        S._flushErrors.forEach(function (er) {
          if (er && er.key && !seen[er.key]) { seen[er.key] = 1; noteKeyFailure(er.key, er.msg); }
        });
        S._flushFails = (S._flushFails || 0) + 1;
      } else {
        S._flushFails = 0;
        S._genFails = 0; S._genFailMsg = null; // a clean flush proves the pipe works
      }
      noteSettleMaybe();
      saveMeta(); refreshDot();
    }).catch(function (e) {
      S.flushing = false; S._flushDurable = false;
      S._genFails++; S._genFailMsg = String((e && e.message) || e);
      saveMeta(); refreshDot();
    });
  }

  function pushOne(key) {
    var km = keyMeta(key);
    var raw = lsGetRaw(key);
    var docId = docIdFor(key);
    var done = function (ok) {
      if (ok) {
        km.s = Date.now(); delete km.d; S.stats.pushed++;
        delete S._keyFails[key]; // v136: a successful push clears the key's failure record
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
            try { (S._flushErrors = S._flushErrors || []).push({ key: key, msg: 'delete ' + key + ': ' + String((e && e.message) || e) }); } catch (e2) {}
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
      delete S._keyFails[key]; // v136: handled by design — not a standing failure
      saveMeta();
      return Promise.resolve(done(false));
    }
    var size = 0;
    try { size = raw.length; } catch (e) {}
    if (size > MAX_DOC_BYTES) {
      try { console.warn('[cloudsync] skipping oversized key (kept locally):', key, size); } catch (e) {}
      km.s = km.t; // don't retry forever; local copy remains the truth
      delete S._keyFails[key]; // v136: handled by design — not a standing failure
      saveMeta();
      return Promise.resolve(false);
    }
    if (!fbReady()) return Promise.resolve(false);
    try {
      return FB.saveDoc(KV_COLLECTION, docId, { v: val }).then(function (res) {
        if (res === null) {
          try { (S._flushErrors = S._flushErrors || []).push({ key: key, msg: 'push ' + key + ': not signed in' }); } catch (e2) {}
        }
        return done(res !== null); // saveDoc resolves null when not signed in
      }).catch(function (e) {
        var msg = 'push ' + key + ': ' + String((e && e.message) || e);
        try { (S._flushErrors = S._flushErrors || []).push({ key: key, msg: msg }); } catch (e2) {}
        try { console.warn('[cloudsync] ' + msg); } catch (e3) {}
        return done(false);
      });
    } catch (e) { return Promise.resolve(done(false)); }
  }

  /* ---------------- pull (cloud -> local) ---------------- */

  /* v107 (Stage 8) — CONVERGENCE HELPERS.
     Oct 16's divergence, proven: a fresh local copy materializes
     DEFAULT values (first-run onboarding writes, tracker defaults)
     stamped km.t = NOW — newer than the cloud's real values — so
     "both changed, latest wins" kept the defaults and the flush
     then PUSHED them up over the cloud. The phone showed Revenue
     $0, auto-start OFF/6 AM and default Preferences while the
     cloud held everything; only a cloud-side write with a newer
     timestamp + an OTA healed it. Two rules fix the class:
       (1) 'onboarding' merges FIELD BY FIELD on every pull: a SET
           field beats an UNSET one on the other copy (a set value
           is data; an unset one is just a default that was never
           chosen); fields set on both sides keep the whole-key
           winner. If the merge holds anything the cloud lacks,
           the key stays dirty so it pushes UP — neither copy can
           silently lose a set value (his phone held Alberta while
           the cloud held nothing; the cloud held his company
           details while the phone held blanks — both survive).
       (2) On a uid's FIRST pull, a local value that is EMPTY
           ([], {}, '', null) never beats a non-empty cloud value,
           whatever the timestamps say (generic empty-default rule).
     The guard stands untouched: where both sides genuinely hold
     set values, the newer timestamp still wins. */
  function valueIsEmpty(v) {
    if (v === null || v === undefined || v === '') return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') { try { return Object.keys(v).length === 0; } catch (e) { return false; } }
    return false;
  }
  function fieldIsSet(v) { return !(v === null || v === undefined || v === ''); }
  function mergeOnboardingFields(localV, cloudV, winner) {
    var out = {}, k, seen = {};
    var a = localV || {}, b = cloudV || {}, s;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) seen[k] = true;
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) seen[k] = true;
    for (k in seen) {
      var lv = a[k], cv = b[k];
      if (fieldIsSet(lv) && !fieldIsSet(cv)) out[k] = lv;
      else if (fieldIsSet(cv) && !fieldIsSet(lv)) out[k] = cv;
      else out[k] = (winner === 'cloud') ? cv : lv;
    }
    return out;
  }

  /* v224 (LIVE-MILES-RESTORE-V38-FAIL): the telemetry keys
     (livemiles, geoloads) hold PER-DAY records whose totals only
     ever GROW within a day — the day's miles, the day's counted
     loads. The generic "both changed, latest stamp wins" rule is
     wrong for them in exactly the reinstall case: a fresh install
     begins the engines against an empty store, the young engine
     persists a ~0 km snapshot stamped NOW, and that stamp then
     beats the cloud's whole day (stamped when it was pushed,
     hours earlier) — the pull kept the 0.3 km snapshot, the hero
     showed 0.3 km over a 138.5 km day, and the flush pushed the
     young record UP over the cloud (the field proof, Oct 22:
     v37 and v38 installs both reset the hero mid-shift). For
     these two keys the pull therefore merges DAY BY DAY: each
     day keeps the record with the larger total, whichever side
     holds it — a stamp can no longer outvote a day's driving.
     Ties (and near-ties in content) go to the later-updated
     record. The merged union is what the engines then reseed
     from, and it stays dirty when it holds anything the cloud
     lacks, so the flush carries the union UP — never a young
     snapshot over a full day. */
  function telemetryDayTotal(key, rec) {
    if (!rec || typeof rec !== 'object') return -1;
    if (key === 'livemiles') return (typeof rec.totalM === 'number' && isFinite(rec.totalM)) ? rec.totalM : -1;
    var c = (typeof rec.count === 'number' ? rec.count : 0) + (typeof rec.corr === 'number' ? rec.corr : 0);
    return Math.max(0, c);
  }
  function mergeTelemetryDays(key, localV, cloudV) {
    var out = {}, k, seen = {};
    var a = (localV && localV.days) || {}, b = (cloudV && cloudV.days) || {};
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) seen[k] = true;
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) seen[k] = true;
    for (k in seen) {
      var lr = a[k], cr = b[k];
      if (!lr) { out[k] = cr; continue; }
      if (!cr) { out[k] = lr; continue; }
      var lt = telemetryDayTotal(key, lr), ct = telemetryDayTotal(key, cr);
      if (ct > lt) out[k] = cr;
      else if (lt > ct) out[k] = lr;
      else out[k] = ((cr.updatedAt || 0) >= (lr.updatedAt || 0)) ? cr : lr;
    }
    /* the merged value rides the CLOUD shell (any top-level
       fields it carries) with the unioned day map; when the cloud
       value is not a day-map object, the local shell carries it. */
    var shell = (cloudV && typeof cloudV === 'object' && cloudV.days) ? cloudV
      : (localV && typeof localV === 'object' ? localV : {});
    var merged = {}, sk;
    for (sk in shell) if (Object.prototype.hasOwnProperty.call(shell, sk)) merged[sk] = shell[sk];
    merged.days = out;
    return merged;
  }

  /* v241 (FUEL-HISTORY-LOST-OCT20-22 + the sync half of
     SHIFT-CLOSE-DUP-ENTRY and PTI-SIGNATURE-SAVE): APPEND-ONLY
     RECORD LISTS. fuel_fills, rev_entries, rev_extras,
     pti_reports and sessions are lists of records that are only
     ever ADDED to (v243: dmg_reports joins them — CONNECT-
     SENDDOC: the same whole-key wipe emptied the Connect damage
     picker of reports the owner had saved; identity =
     tab+desc+at+dispatch). (An edit rewrites a record in place; nothing
     legitimately un-happens). The generic whole-key stamp rule
     is wrong for them in exactly the way v224 proved it wrong
     for the telemetry day maps: a rolled-back cloud copy — a
     stale store instance's push, stamped fresh — wins the pull
     and this device's own saved records vanish (Oct 20 + Oct 22's
     fuel fills; a signed PTI coming back bare; the $319
     completion entry). For these keys the pull therefore merges
     BY RECORD IDENTITY: the union of both sides; when both sides
     hold the same record, the MORE COMPLETE copy wins (a signed
     PTI beats its bare copy; a photo-bearing fill beats its
     photo-less twin). Two guards keep the old semantics where
     they matter: the merge runs only while the local key is
     SETTLED (a dirty key — an edit/delete not yet flushed —
     keeps the generic stamp rules for that cycle, so a delete
     is never resurrected by its own sync), and never when the
     key's recorded owner is a DIFFERENT account (a shared phone
     never unions one account's records into another's tree).
     When the union holds anything the cloud lacks, the key
     stays dirty so the flush pushes the union UP — the cloud
     copy heals instead of the phone losing records. */
  var RECORD_LIST_KEYS = { fuel_fills: 1, rev_entries: 1, rev_extras: 1, pti_reports: 1, sessions: 1, dmg_reports: 1 };
  function recordIdentity(key, rec) {
    if (!rec || typeof rec !== 'object') return null;
    if (key === 'pti_reports') return rec.id ? 'id:' + rec.id : null;
    if (key === 'rev_entries' && rec.dspId) return 'dsp:' + rec.dspId;
    var fields = (key === 'fuel_fills') ? ['date', 'time', 'litres', 'cost', 'station', 'odo']
      : (key === 'sessions') ? ['date', 'seconds', 'endedAt']
      /* v243: damage records carry no id — their identity is
         their own facts; the v243 birth stamps (date, profileId)
         stay OUT so a stamped and an unstamped copy of the same
         report still merge into one. */
      : (key === 'dmg_reports') ? ['tab', 'desc', 'at', 'dispatch']
      : null;
    if (!fields) {
      /* rev_extras + the id-less fallback: the whole record,
         photo excluded (a photo can be dropped/replaced without
         the record becoming a different record). */
      var ks = Object.keys(rec).filter(function (k) { return k !== 'photo'; }).sort();
      return 'fp:' + ks.map(function (k) { return k + '=' + JSON.stringify(rec[k]); }).join('|');
    }
    return 'fp:' + fields.map(function (k) {
      return k + '=' + JSON.stringify(rec[k] === undefined ? null : rec[k]);
    }).join('|');
  }
  function recordCompleteness(key, rec) {
    var n = 0, k;
    for (k in rec) {
      if (Object.prototype.hasOwnProperty.call(rec, k)) {
        var v = rec[k];
        if (v !== null && v !== undefined && v !== '' && v !== false) n++;
      }
    }
    if (key === 'pti_reports') {
      if (rec.signature) n += 10;
      if (rec.signed) n += 5;
      if (rec.plate) n += 2;
    }
    if (rec.photo) n += 3;
    return n;
  }
  function mergeRecordLists(key, localArr, cloudArr) {
    var out = [], pos = {};
    function offer(rec, isLocal) {
      var id = recordIdentity(key, rec);
      if (id === null) { out.push(rec); return; }
      if (!(id in pos)) { pos[id] = out.length; out.push(rec); return; }
      var cur = out[pos[id]];
      var cs = recordCompleteness(key, cur), ns = recordCompleteness(key, rec);
      if (ns > cs || (isLocal && ns === cs)) out[pos[id]] = rec;
    }
    (cloudArr || []).forEach(function (r) { offer(r, false); });
    (localArr || []).forEach(function (r) { offer(r, true); });
    return out;
  }

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

        /* v219 (CONNECT-DELETE-CROSS-ACCOUNT): a legacy Connect-
           family doc in MY OWN tree seeds my namespaced slot the
           first time this build pulls — the list (and my own
           hides) I held before the fix become mine under the new
           names, sourced from my cloud copy, never from the
           device-shared local slot another account's session may
           have edited. The generic pass below still settles the
           legacy key as before; a namespaced cloud doc is its
           own key here and takes over through the same pass.
           Clean stamps: the seed is identical to the cloud
           value, so nothing pushes until the owner edits. */
        if (CON_FAMILY_KEYS[key] && S.uid) {
          var pk219 = key + '__' + S.uid;
          if (lsGetRaw(pk219) === null && d.v !== undefined) {
            lsSetRaw(pk219, JSON.stringify(d.v));
            meta.keys[pk219] = { t: cloudTs, s: cloudTs, u: S.uid };
            applied++;
          }
        }

        /* v107 (Stage 8): the two convergence rules (see the
           helpers above) run BEFORE the whole-key rules below. */
        if (raw !== null) {
          var localVal = parseJson(raw, undefined);
          if (key === 'onboarding' && localVal && typeof localVal === 'object' && !Array.isArray(localVal) &&
              d.v && typeof d.v === 'object' && !Array.isArray(d.v)) {
            var obWinner = (S._profVacatedFor && S._profVacatedFor === S.uid)
              ? 'cloud' // v216: gate-vacated slot — the account's cloud profile supersedes any post-gate default stamps
              : (localDirty && cloudChanged)
              ? (cloudTs > (km.t || 0) ? 'cloud' : 'local')
              : (cloudChanged ? 'cloud' : 'local');
            var merged = mergeOnboardingFields(localVal, d.v, obWinner);
            if (JSON.stringify(merged) !== JSON.stringify(localVal)) {
              lsSetRaw(key, JSON.stringify(merged));
              applied++;
            }
            if (JSON.stringify(merged) !== JSON.stringify(d.v)) {
              /* the merge holds set values the cloud lacks — keep
                 the key dirty (t ahead of the cloud's stamp) so
                 the flush pushes the union UP. */
              meta.keys[key] = { t: Math.max(cloudTs, now), s: cloudTs };
            } else {
              meta.keys[key] = { t: cloudTs, s: cloudTs };
            }
            return;
          }
          if (firstSyncForUid && valueIsEmpty(localVal) && !valueIsEmpty(d.v)) {
            lsSetRaw(key, JSON.stringify(d.v));
            meta.keys[key] = { t: cloudTs, s: cloudTs };
            applied++;
            return;
          }
        }

        /* v224 (LIVE-MILES-RESTORE-V38-FAIL): the telemetry keys
           merge day by day on TOTALS (see mergeTelemetryDays) —
           never by stamp. Runs whenever both sides hold a day
           map; a side with no day map falls through to the
           generic rules below. */
        if ((key === 'livemiles' || key === 'geoloads') && raw !== null &&
            d.v && typeof d.v === 'object' && d.v.days && typeof d.v.days === 'object') {
          var teleLocal = parseJson(raw, undefined);
          if (teleLocal && typeof teleLocal === 'object' && teleLocal.days && typeof teleLocal.days === 'object') {
            var teleMerged = mergeTelemetryDays(key, teleLocal, d.v);
            if (JSON.stringify(teleMerged) !== JSON.stringify(teleLocal)) {
              lsSetRaw(key, JSON.stringify(teleMerged));
              applied++;
            }
            if (JSON.stringify(teleMerged) !== JSON.stringify(d.v)) {
              /* the union holds days the cloud lacks — keep the
                 key dirty so the flush pushes the union UP. */
              meta.keys[key] = { t: Math.max(cloudTs, now), s: cloudTs };
            } else {
              meta.keys[key] = { t: cloudTs, s: cloudTs };
            }
            return;
          }
        }

        /* v241: the record-list union (see mergeRecordLists
           above) — runs before the generic whole-key rules
           whenever this device holds a settled, own-account
           array for the key; a stamp outcome never deletes a
           record from these keys. */
        if (RECORD_LIST_KEYS[key] && raw !== null && Array.isArray(d.v) && !localDirty &&
            !(km.u && S.uid && km.u !== S.uid)) {
          var rlLocal = parseJson(raw, undefined);
          if (Array.isArray(rlLocal)) {
            var rlMerged = mergeRecordLists(key, rlLocal, d.v);
            if (JSON.stringify(rlMerged) !== JSON.stringify(rlLocal)) {
              lsSetRaw(key, JSON.stringify(rlMerged));
              applied++;
            }
            if (JSON.stringify(rlMerged) !== JSON.stringify(d.v)) {
              /* the union holds records the cloud lacks — keep
                 the key dirty so the flush pushes the union UP. */
              meta.keys[key] = { t: Math.max(cloudTs, now), s: cloudTs };
            } else {
              meta.keys[key] = { t: cloudTs, s: cloudTs };
            }
            return;
          }
        }

        /* v265 (EDIT-START-NOT-PERSISTED): the tracker is a LIVE
           SESSION, not a document — whole-key stamp arbitration
           fails it. Once a stale native-record adoption rewrites
           the phone's local tracker (see adoptSessionRecord in
           js/app.js), every echo re-stamps km.t to NOW, so the
           generic "latest timestamp wins" below made the phone's
           stale session unbeatable: on Oct 26 the account had
           closed the Oct 25 session (ended 07:17) and started a
           newer one at 8:00 AM — the cloud copy showed it — while
           the phone's hero kept following the Oct 25 11:32 start
           and its flush kept queueing the stale copy to push UP
           over the account's. The tracker and sessions keys merge
           independently, so nothing ever cross-checked that the
           local running session was already closed in the
           account. Session START order is the truth for which
           session is current: both copies carry the identity
           pinned at session start (sessionId = the start
           instant, js/app.js v69). When the identities differ,
           the LATER session wins — the cloud's installs locally
           with clean stamps, whatever the km game said; the
           local's falls through to the generic rules, whose
           dirty push converges the cloud upward. Same-session
           copies never reach here (their edits arbitrate by
           stamp exactly as before), and a copy without a
           sessionId (an idle tracker, or a pre-v69 one) falls
           through untouched. */
        if (key === 'tracker' && raw !== null && d.v && typeof d.v === 'object' && !Array.isArray(d.v)) {
          var trkCloudSid = Number(d.v.sessionId) || 0;
          var trkLocalSid = (localVal && typeof localVal === 'object' && !Array.isArray(localVal))
            ? (Number(localVal.sessionId) || 0) : 0;
          if (trkLocalSid > 0 && trkCloudSid > trkLocalSid) {
            lsSetRaw(key, JSON.stringify(d.v));
            meta.keys[key] = { t: cloudTs, s: cloudTs };
            applied++;
            return;
          }
        }

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
      S._profVacatedFor = null; // v216: the account's first pull has landed; the vacated-slot marker is spent
      S.lastPullAt = Date.now();
      S._pulling = false;
      /* v136: a healthy pull clears only PULL failure state. The v34
         rule ("a healthy pull clears a stale earlier error") also
         wiped standing PUSH failures — but a pull pushes nothing, so
         a store that could not back up looked fine again while its
         data still sat unbacked-up on the phone. Push records now
         clear only when that key actually pushes. */
      S._pullFails = 0; S._pullFailMsg = null;
      S.stats.pulled += applied;
      noteSettleMaybe();
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
      // v136: pull failures keep their own books (see noteKeyFailure) —
      // repeated pull failures paint the named-failure state; a single
      // blip just retries in amber.
      S._pullFails++;
      S._pullFailMsg = String((e && e.message) || e);
      try { console.warn('[cloudsync] pull failed:', S._pullFailMsg); } catch (e2) {}
      refreshDot();
      drainPullWaiters(false);
      return { applied: 0 };
    });
  }
  S.pull = pull;

  /* ---------------- status for debugging + the card face ----------------
   * v136: status() evaluates the SAME syncTruth() the dot paints and
   * repaints the dot first, so the header dot, this status, and the
   * Preferences card can never disagree. `dot` keeps its old meaning
   * ('ok' | 'syncing' | 'err' | 'off'); `state` mirrors it; the rest
   * is the truth in owner-readable pieces. */
  S.status = function () {
    refreshDot();
    var t = S._truth || syncTruth();
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
      dot: S._dotState || 'off', state: t.state, label: t.label,
      dirtyKeys: dirty, durableDirtyKeys: t.durableDirty, telemetryDirtyKeys: t.telemetryDirty,
      telemetryBehind: t.telemetryBehind,
      failKey: t.failKey, failMsg: t.failMsg, failPlain: t.failPlain, failKind: t.failKind,
      blocked: t.blocked,
      lastSettledAt: t.lastSettledAt,
      lastSettledLabel: t.lastSettledAt ? fmtClock(t.lastSettledAt) : null,
      lastError: S.lastError, stats: S.stats
    };
  };
})();
