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
    pipe_landed: 1, pipe_seen: 1, nav_shares: 1, cp_hist_peers: 1,
    /* v307: kept in step with app.js — the received-document
       inbox + its seen book namespace per owner the same way */
    doc_shares: 1, docshare_seen: 1 };
  /* web403 (DELETE-STICKINESS-NOV10 — the owner's ruling, Nov 10,
     2026: "Do what you have to — no deletes if the cloud and app
     both agree... If they disagree the option to delete has to be
     there!"). A DELIBERATE delete of a record-list entry is
     tombstoned: the tombstone rides INSIDE the record's own
     cloud document as the sibling field `del`
     ({ <recordId>: { t, fp } } — t = when deleted, fp = the
     agreed record's content fingerprint), so a pull can never
     see the list without its tombstones. Devices keep their
     accepted set at the TOP level of the meta (m.dels, per key)
     — the v276 rule: the pull replaces whole per-key records,
     so delete state that must survive pulls cannot live inside
     km. A tombstone binds only an id both sides once agreed in
     the cloud: it is authored solely from pendingRecordDeletes
     (shadow-named, locally absent — the agreed-shadow rule), so
     a record that exists only on one device is never tombstoned
     away, and a genuinely new record can never collide with one
     (identities are unique per creation). Where a tombstone
     meets a record EDITED after the delete (content fingerprint
     differs from the agreed one), the tombstone cannot settle
     it: the record is held back from the cloud, listed in
     m.delConf, and surfaced to the user as a choice (Preferences
     → Advanced sync card; CloudSync.resolveDelConflict). A
     KEEP choice revokes the tombstone (m.delRev) — the keeper's
     next push restores the record and clears the doc's entry,
     and a pull that finds the record back in the list with no
     tombstone forgets the accepted one. GC RULE: a tombstone is
     dropped from a write (and from the accepted set) only when
     it is older than DEL_GC_MS (90 days) AND its id is absent
     from both the merged list and the cloud list at that moment
     — by then every live device has long applied it; a record
     still present anywhere keeps its tombstone. Records nobody
     deleted keep the v241/v272 never-lose union untouched. */
  var DEL_GC_MS = 90 * 24 * 60 * 60 * 1000;
  var DEBOUNCE_MS = 2500;
  var TELEMETRY_PUSH_MIN_MS = 60000;    // v276: min gap between cloud writes of one telemetry key
  var MAX_DOC_BYTES = 900000;           // Firestore ~1MiB/doc limit; stay under
  /* v296 (SYNC-STILL-FAILING — the v295 verdict failed in the
     owner's hands too, Oct 31, 2026, incl. after a force-stop +
     cold start): Firestore's REAL document limit is 1,048,576
     BYTES under its own size accounting (field names + values;
     a number costs 8 bytes however many digits its JSON text
     has). The telemetry copy gate measured JSON TEXT LENGTH
     against 900,000 — for crumb-heavy data (13-digit timestamps,
     6-decimal coordinates) the JSON text runs ~1.7x the real
     size (the v295 harness measured a full 14-day value at
     1,036,280 chars but 612,337 real bytes), so the app could
     refuse — honestly, by name, forever — writes Firestore
     would happily accept. The telemetry gate now measures the
     REAL size (fsDocEstimate) against a safety-margined cap.
     JSON length remains the gate for the other key kinds,
     untouched. */
  var FS_DOC_LIMIT = 1048576;           // Firestore's hard per-document limit, bytes
  var TELE_FS_CAP_BYTES = 1000000;      // telemetry copy cap under real accounting (margin below the hard limit)
  var MIN_PULL_GAP_MS = 60000;          // don't re-pull more often than this
  /* v279 (WATCHDOG-PULL-READ-BURN, named in v276): a REPEAT
     pull — this uid already pulled once in this page session —
     waits this long between full-tree reads. The 30 s watchdog
     kicks syncNow whenever keys sit dirty, and on a live shift
     the telemetry engines keep a key dirty almost constantly,
     so at the old 60 s gap the pull re-read the whole ~36-doc
     kv tree ~once a minute all shift: ~21,600 reads per
     driver-day against Spark's 50,000 reads/day project-wide.
     The pull's job after the first one is CONVERGENCE (another
     device's writes landing here); the first pull — cold-start
     restore — is never gated by this gap (see pull()), and
     PUSHES are never gated at all: syncNow's flush proceeds on
     the watchdog cadence whether the pull ran or not. Every
     merge law the pull carries (record union + shadow,
     telemetry day-merge, phantom guard, onboarding field
     merge) is unchanged — it runs at the convergence cadence
     instead of every minute. */
  var REPEAT_PULL_GAP_MS = 10 * 60 * 1000;
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
    _teleUrgent: false,     // v276: the next flush carries telemetry NOW (stop/pause/hide/unload)
    /* v296: telemetry push diagnostics — the last attempt per
       telemetry key (stage reached, verbatim error, real sizes)
       and the last cloud-doc inventory per key, captured at
       push/pull time. Mirrored to localStorage mt___syncdiag so
       the Advanced readout survives a cold start. */
    _teleDiag: {},          // key -> last push attempt record
    _cloudTeleInv: {},      // key -> last cloud doc inventory
    _diagPersist: null,     // parsed mt___syncdiag cache
    _truth: null,           // last computed syncTruth()
    _statusListeners: []
  };
  window.CloudSync = S;
  S._BLOCKED_GRACE_MS = BLOCKED_GRACE_MS; // exposed for the v136 suite
  S._TELEMETRY_PUSH_MIN_MS = TELEMETRY_PUSH_MIN_MS; // exposed for the v276 suite

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
  /* v303 (PHANTOM-REVIVAL-OCT31): the stale-shell test for a live
     tracker copy — its pinned session start (sessionId, the v69
     pin) is on a PREVIOUS local day AND at least 20 h old. A
     session can never legitimately be restored across a day
     boundary in this app (days close the day they start; the
     autostart engine calls such a session 'running-stale' — not
     today's work), so a live copy passing both prongs is a dead
     echo, never work. Mirrored in js/app.js (staleTrackerStartMs).
     Local-day compare via a yyyymmdd key built from local parts.
     v314 (PHANTOM-SESSION-31H): the >= 20 h prong is DROPPED in
     both mirrors — previous local day alone decides. The age
     prong only bought a phantom time (the Nov 2 09:00 session
     reached 31:08:43 the next day untouched, its heal wired
     only at cold open while the app stayed alive); a previous-
     day live copy is a dead echo at any age in this app. */
  function dayKey303(ms) {
    var d303 = new Date(ms);
    return d303.getFullYear() * 10000 + (d303.getMonth() + 1) * 100 + d303.getDate();
  }
  function staleSessionMs303(startMs, nowMs) {
    if (!(startMs > 0) || !(nowMs > 0)) return false;
    return dayKey303(startMs) < dayKey303(nowMs);
  }
  /* v411 (CLOSE-SHUTS-TIMER, owner law restated Nov 10, broken
     in his hands Nov 9 AND Nov 10): the closed-day proof — the
     booked evidence that the day a session belongs to is
     CLOSED. Two proofs, the two shapes a close writes:
       (1) a FINISHED sessions entry whose own start (endedAt −
           seconds) names the session's pin within the v69
           jitter family (±5000 ms) — the v271/v352 test; OR
       (2) a dispatch record for the session's day standing
           COMPLETED — a dispatch completion IS a shift close
           (js/app.js v82: applyCompletion stops the session),
           and a close run on a surface whose own tracker was
           idle (the Nov 9/10 web close-out) books the day this
           way and writes NO sessions entry at all, leaving
           proof (1) nothing to match.
     The caller passes the UNION of this device's local lists
     and the pull's own incoming docs, so the verdict never
     depends on which doc the forEach reaches first. Mirrored
     in js/app.js (closedDayProof411) and js/shifttrack.js
     (dayClosed411). */
  function closedProof411(sessionsArr, dspList, dspActive, startMs) {
    if (!(startMs > 0)) return false;
    var day = dayKey303(startMs);
    if (Array.isArray(sessionsArr)) {
      for (var i = 0; i < sessionsArr.length; i++) {
        var e = sessionsArr[i];
        if (!e || !e.endedAt || !(Number(e.seconds) > 0)) continue;
        var st = Date.parse(e.endedAt) - Number(e.seconds) * 1000;
        if (isFinite(st) && Math.abs(st - startMs) <= 5000) return true;
      }
    }
    var lists411 = [dspList, dspActive ? [dspActive] : null];
    for (var li = 0; li < lists411.length; li++) {
      var arr = lists411[li];
      if (!Array.isArray(arr)) continue;
      for (var j = 0; j < arr.length; j++) {
        var d = arr[j];
        if (!d || d.status !== 'completed') continue;
        var rd = '';
        if (typeof d.scheduledAt === 'string') {
          var m411 = /^(\d{4})-(\d{2})-(\d{2})/.exec(d.scheduledAt);
          if (m411) rd = m411[1] + m411[2] + m411[3];
        }
        if (!rd && typeof d.date === 'string') {
          var m411b = /^(\d{4})-(\d{2})-(\d{2})/.exec(d.date);
          if (m411b) rd = m411b[1] + m411b[2] + m411b[3];
        }
        if (rd && Number(rd) === day) return true;
      }
    }
    return false;
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
  /* v276: the telemetry coalesce clock lives at the TOP level
     of the meta (m.teleTp), never inside a per-key record: the
     pull replaces whole per-key records in several branches
     (the v224 telemetry merge among them), and a clock stored
     there would be wiped by the first pull of a shift — the
     gate would spring open mid-shift and the cadence with it.
     v413: the clock stamps every telemetry ATTEMPT, landed or
     failed (see pushOne's done) — it is the gate's "last
     attempt" mark, so a failed backup backs off for the same
     window a landed one coalesces for. */
  function teleLastPush(key) {
    var m = getMeta();
    return (m.teleTp && m.teleTp[key]) || 0;
  }
  function stampTelePush(key) {
    var m = getMeta();
    if (!m.teleTp) m.teleTp = {};
    m.teleTp[key] = Date.now();
  }

  /* ---------------- v136: durable vs telemetry, plain names ----------------
   * TELEMETRY keys hold continuously rewritten LIVE snapshots (the
   * miles engine persists livemiles, the load counter persists
   * geoloads — each at most every ~10s while a session runs). They
   * sync through the same flush as everything else; only the SETTLE
   * accounting differs (see the header note). Every other syncable
   * key is DURABLE user data and decides green.
   *
   * v276 (SPARK-QUOTA — the Oct 27 stress test + the owner's
   * no-paid-plan-until-the-first-paying-user rule): the flush
   * used to push a telemetry key on nearly every cycle, ~3,000–
   * 7,000 Firestore writes per driver-day against the free
   * plan's 20,000/day project cap. Telemetry pushes are now
   * COALESCED: at most one cloud write per key per
   * TELEMETRY_PUSH_MIN_MS (60s), however often the engines
   * persist locally (local persistence is unchanged — the
   * phone's own copy is never behind). The gate lifts at once
   * (an URGENT flush) on the events that matter: a tracker pause
   * or stop landing in the store — every stop, day close and
   * dispatch close funnels through stopSessionAt, which stamps
   * the tracker 'paused' / 'idle', and the wrapped store.set
   * below sees those stamps — plus the page hiding and
   * beforeunload (the same moments js/app.js flushes the
   * engines). A telemetry TOMBSTONE is never gated: a
   * deliberate delete goes out on the normal debounce. The
   * per-key clock (m.teleTp in the sync meta — the last
   * telemetry attempt, landed or failed since v413) survives
   * restarts and pull merges. What this
   * does NOT change: pull merging (the v224 day-total merge
   * restores a cold start from whatever the cloud holds — the
   * stop/hide flushes keep that copy final at every moment a
   * shift can end), durable keys (they push immediately, as
   * always), and the v271/v272 semantics. */
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

  /* v296 (SYNC-FAILURE-WARNING-UNMISSABLE, owner order Oct 31,
     2026): the header dot can be — and was — ignored for a whole
     week while fuel never reached the cloud. While the sync
     truth stands at a NAMED failure (state 'err': a store that
     keeps failing to back up, dead transport past its grace,
     offline with work waiting — the truth machine only paints
     'err' after repetition/grace, never on a single blip), the
     MAIN dashboard carries a persistent red strip in plain
     words. It clears by itself the moment a sync lands green
     (the truth leaves 'err'), because every refreshDot repaints
     it from the same state machine as the dot — one truth,
     three faces. The element lives in index.html (#syncWarn);
     where it is absent (suite worlds) this is a no-op. */
  var syncWarnEl = null;
  function paintSyncWarn(t) {
    var elw = syncWarnEl;
    try {
      if (elw && document && document.contains && !document.contains(elw)) elw = null;
    } catch (e) {}
    if (!elw) {
      try { elw = document.getElementById('syncWarn'); } catch (e) { elw = null; }
      syncWarnEl = elw;
    }
    if (!elw) return;
    var show = !!(t && t.state === 'err');
    try {
      elw.classList.toggle('hidden', !show);
      if (show) elw.textContent = '⚠ Not backing up — your work is only on this phone';
    } catch (e) {}
  }

  function refreshDot() {
    var t = syncTruth();
    paintSyncWarn(t);
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
        /* v276: a tracker pause or stop is one of the moments
           telemetry must reach the cloud NOW (see the telemetry
           note above). stopSessionAt — the funnel for tracker
           stop, day close and dispatch close — stamps the
           tracker 'idle'; the pause toggle stamps 'paused'.
           The engines' final snapshots land in the store in
           the same breath (stopDay/flush run first), so the
           urgent flush carries the day's final totals. */
        if (pk === 'tracker' && v && typeof v === 'object' &&
            (v.status === 'paused' || v.status === 'idle')) {
          S._teleUrgent = true;
        }
        /* v301 (SYNC-PUSH-TRIGGERS) — NARROWED by v413
           (SYNC-FLAPPING-NOV11): v301 re-armed the urgent flag
           on EVERY telemetry stamp that landed while the
           tracker sat idle or paused, so the final totals of a
           close would ride the debounce out. In the owner's
           hands (Nov 11, 2026, 00:56 CST) that rule fired all
           night instead: the day-miles watch is armed before a
           dispatch day while the tracker sits idle, and every
           engine persist (each one re-stamps the day record)
           became an urgent full read-merge-write of the
           ~240 KB telemetry document on the 2.5 s debounce —
           the 60 s coalesce never applied, attempts rolled
           back to back inside a minute, slow ones were
           abandoned by the 20 s push race and recorded FAILED
           at the read/write step, and the status cycled
           Syncing… → All synced → Syncing… until a manual
           press ran a pull whose comparison sealed the key.
           The urgent flag now comes only from the moments
           that are actually urgent: the tracker TRANSITION
           stamp above (the close's own stop/pause stamp —
           the engines' final snapshots land in the same
           breath, so the close still rides out at once) and
           the hide / beforeunload / pagehide flushes. Every
           other telemetry stamp — post-close accrual
           included — rides the 60 s coalesce like the rest
           of the day. */
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
        if (document.visibilityState === 'hidden') flushUrgent();
        /* v301 (SYNC-PUSH-TRIGGERS): returning to the app syncs
           at once — whatever folded in while the page slept (a
           native fold, a correction, a close) does not wait
           for the 30 s watchdog to happen by. */
        else if (document.visibilityState === 'visible' && S.uid) syncNow();
      });
      window.addEventListener('beforeunload', function () { flushUrgent(); });
      /* v301: pagehide is the door mobile WebViews actually
         close through; beforeunload alone missed it. */
      window.addEventListener('pagehide', function () { flushUrgent(); });
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
    S._bootGateOpen = false; // v301: each session's pushes wait for its own first pull
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
      /* v296: if this was the 20 s race expiring on a telemetry
         attempt, stamp the timeout onto the attempt record the
         push left open — the Advanced readout then shows WHICH
         stage consumed the 20 s instead of a bare failure. (A
         late completion of the underlying push overwrites the
         record with its real outcome, as it should.) */
      try {
        var openAtt = S._teleDiag && S._teleDiag[key];
        if (openAtt && openAtt.open && String((e && e.message) || e).indexOf('push-timeout') === 0) {
          openAtt.err = msg + ' — the attempt was still at stage "' + openAtt.stage + '" when the ' +
            Math.round(PUSH_TIMEOUT_MS / 1000) + 's budget expired';
          openAtt.open = false;
          noteTeleAttempt(key, openAtt);
        }
      } catch (e4) {}
      try { (S._flushErrors = S._flushErrors || []).push({ key: key, msg: msg }); } catch (e2) {}
      try { console.warn('[cloudsync] ' + msg); } catch (e3) {}
      return false;
    });
  }

  function flush() {
    if (S.flushing) { scheduleFlush(); return; }
    /* v301 (SYNC-PUSH-TRIGGERS): no push precedes this session's
       first pull. Boot-time store stamps (engine persists, the
       state rebuild, adoption writes) schedule this flush on a
       2.5 s debounce, while the first pull of a cold start can
       take longer — and a generic key's push is a blind
       overwrite, so a young pre-restore value (fresh-install
       defaults, a just-begun tracker) could stomp the cloud
       before restore landed, and the pull then adopted the
       stomp as truth. The flush now defers until the first
       pull settles — success, failure or the waiter's own
       timeout (9 s), so a hung pull can never wedge pushes
       for the session. syncNow's own flush is unaffected: it
       runs from the pull's completion, when pulledUid is
       already set. */
    if (S.uid && S.pulledUid !== S.uid && !S._bootGateOpen) {
      if (!S._bootGateWaiting) {
        S._bootGateWaiting = true;
        var gateUid = S.uid;
        S.whenFirstPullDone(9000).then(function () {
          S._bootGateWaiting = false;
          if (S.uid === gateUid) S._bootGateOpen = true;
          try { flush(); } catch (e) {}
        });
      }
      refreshDot();
      return;
    }
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
    /* v276 (SPARK-QUOTA): the telemetry coalesce gate. The urgent
       flag is consumed HERE — only by a flush that is actually
       proceeding — so a pause/stop/hide that lands while another
       flush is in flight still makes the re-run urgent. A gated
       telemetry key simply stays dirty; the 30s watchdog (or the
       next durable flush after the window) carries it. */
    var teleUrgent = !!S._teleUrgent;
    S._teleUrgent = false;
    var pushKeys = keys.filter(function (k) {
      if (!isTelemetryKey(k)) return true;
      if (teleUrgent) return true;
      var km = keyMeta(k);
      if (km.d) return true; // a tombstone never waits for the window
      return (Date.now() - teleLastPush(k)) >= TELEMETRY_PUSH_MIN_MS;
    });
    S._flushDurable = pushKeys.some(function (k) { return !isTelemetryKey(k); });
    var chain = Promise.resolve();
    pushKeys.forEach(function (k) { chain = chain.then(function () { return pushOneWithTimeout(k); }); });
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

  /* v289 (FUEL-LIST-STALE, owner report Oct 30, 2026): the sync
     copy of a fuel book. Receipt photos ride inside the fill
     records as data URLs, so a working book outgrows the one-doc
     byte cap on photos alone — and pushOne's oversized guard ran
     BEFORE the record-list branch, skipped every write and sealed
     the key clean, freezing the cloud copy at the last state that
     fit (Oct 22) while fills kept saving locally; the first local
     loss after that (the Oct 30 install churn) restored the frozen
     copy wholesale and the newer fills were gone from phone AND
     cloud — the same signature as Oct 20–22 and Oct 26. The facts
     are what the list, the merges and P&L read, and they fit
     trivially, so when the full array exceeds the cap the cloud
     copy carries the same records without the photo field (each
     fill's photo is ALSO written to its own per-fill cloud doc by
     the Fuel save handler itself, so no photo leaves the account).
     Fuel identity never reads the photo (date/time/litres/cost/
     station/odo), so merges, the shadow and the v188 duplicate
     rule are untouched; and merge completeness scores a photo +3,
     so a photo-bearing local copy always beats the stripped cloud
     twin — a pull can never strip a photo off the phone. */
  /* v301 (SYNC-STUB-MERGE, owner evidence Oct 31, 2026 16:44–
     16:54 MDT): the shed is no longer fuel-only. The same
     freeze the v289 law killed for fuel had taken `sessions`
     in the field: a session entry carries its start/end dash
     photos (data URLs — the day's odometer evidence), so once
     the phone's book crossed the gate the rlSave above failed
     EVERY push honestly ("exceeds the cloud document size
     limit even without receipt photos"), the key stayed dirty
     as the standing named failure ("your shift records"), and
     the only sessions writer that could land was a small
     photo-less second instance — whose Oct 31 fragment (a
     young tracker snapshot: 170,664 km, liveKm 0.1, no end
     reading) became the cloud's whole truth for the day,
     while the livemiles push landed fine beside it. The
     manifest reads Miles (live), GPS distance and the
     Odometer line from the SESSIONS entries, not from the
     telemetry totals — so the cloud rendered the stub with
     a green "landed ✓" for miles. Now every photo-bearing
     record list sheds its photo fields from the sync copy
     when the full book exceeds the cap. The facts always
     ride; the photos stay in the local store, and each also
     lives in its own per-record cloud doc (fuel: the save
     handler's per-fill doc, v289; sessions: the stop's
     per-session doc in app.js). A PTI report's SIGNATURE is
     a fact (it is weighted in merge completeness) and is
     never in a shed set — only its defect-photo field is.
     Identity and completeness never read the shed fields
     for these keys either (sessions identity =
     date|seconds|endedAt), so merges and the shadow rule
     are untouched. */
  var RECORD_PHOTO_FIELDS = {
    fuel_fills: ['photo'],
    sessions: ['startPhoto', 'endPhoto', 'photo'],
    pti_reports: ['photo'],
    dmg_reports: ['photo'],
    rev_entries: ['photo'],
    rev_extras: ['photo'],
    /* v339 (DOCUMENT-VAULT): the document's file bytes ride
       `data` — the fuel law verbatim: the facts (label, name,
       kind, sender, dates) always cross; the bytes shed from
       the sync copy only when the whole vault book outgrows
       one cloud doc, and stay in the local store. */
    docs_items: ['data']
  };
  function recordSyncCopy(key, arr) {
    var fields = RECORD_PHOTO_FIELDS[key];
    if (!fields || !Array.isArray(arr)) return arr;
    if (JSON.stringify(arr).length <= MAX_DOC_BYTES) return arr;
    return arr.map(function (rec) {
      if (!rec || typeof rec !== 'object') return rec;
      var had = false, fi;
      for (fi = 0; fi < fields.length; fi++) if (rec[fields[fi]]) { had = true; break; }
      if (!had) return rec;
      var c = {};
      for (var f in rec) { if (fields.indexOf(f) === -1) c[f] = rec[f]; }
      return c;
    });
  }
  function syncCopyJson(key, arr) { return JSON.stringify(recordSyncCopy(key, arr)); }

  /* v293 (SYNC-LIVE-MILES-NOT-PUSHING): the sync copy of a
     telemetry value (livemiles / geoloads). The document carries
     a rolling 14 days of day records; a livemiles record's
     breadcrumb trail is the heavy part (the engine throttles
     crumbs to one per 30 s / 50 m of driving — a long day still
     runs past a thousand). Under the cap the value rides whole.
     Over it, the trails are thinned EVENLY (first and last crumb
     kept, the shape of the day preserved at coarser resolution)
     on a deep copy — the local store always keeps the full
     trail, and every fact the merges, the dashboards and the
     manifest read (per-day totals, anchors, segs, counts,
     corrections, pegs, events) rides intact at every rung. The
     ladder sheds the oldest days' trails first at the harsh
     rungs; the last rung drops trails entirely and keeps the
     facts. Deterministic for a given value, so the pull can
     compare sync copies and a shed cloud copy seals (the v289
     A7 lesson) instead of re-pushing the whole history every
     cycle. */
  function thinCrumbs(crumbs, cap) {
    if (!Array.isArray(crumbs) || crumbs.length <= cap) return crumbs;
    if (cap <= 0) return [];
    if (cap === 1) return [crumbs[0]];
    var out = [], seen = {};
    for (var i = 0; i < cap; i++) {
      var idx = Math.round(i * (crumbs.length - 1) / (cap - 1));
      if (!seen[idx]) { seen[idx] = 1; out.push(crumbs[idx]); }
    }
    return out;
  }
  /* v295 (SYNC-STILL-FAILING-ON-293 — the v293 verdict failed in
     the owner's hands, Oct 31, 2026): two defects in the v293
     copy, both reproduced in tools/sync-realfail-v295-test.js.
     (1) The ladder thinned ONLY per-day crumbs — but the merged
     value is built on the CLOUD value's shell (mergeTelemetryDays)
     and day records ride wholesale, so any heavy bulk an older
     app shape ever wrote — a top-level field beside `days`, a fat
     non-fact array inside the day records — is preserved by every
     merge and shed by NO rung: even the facts-only copy stayed
     over the cap and the push failed honestly on EVERY cycle,
     forever (the field signature exactly: fast, repeatable,
     livemiles-only, cloud frozen, failure painted by name). Bulk
     the sync layer never reads is now shed from the COPY before
     the crumb ladder runs: top-level non-days fields, and per-day
     array fields outside the key's fact set (livemiles: crumbs /
     segs; geoloads: events / pegEvents / pegs), whose JSON
     exceeds TELE_SHED_BYTES. The local store always keeps the
     full value; every fact the merges, the dashboards and the
     manifest read rides at every rung.
     (2) The ladder built all six rungs EAGERLY — six full JSON
     round-trip deep copies plus their serializations, computed
     twice per cycle (pull comparison + push): ~34x the value's
     own size in JSON traffic for a 2.8 MB value, all on the main
     thread (the owner's screen froze and double-drew its labels
     mid-sync). The copy is now built STRUCTURALLY (shallow
     clones — the copy is only ever serialized, never mutated)
     and the rungs are evaluated LAZILY, first fit wins; the
     crumb ladder keeps v293's exact caps and stays deterministic
     for a given value, so a shed cloud copy still seals. */
  var TELE_FACT_ARRAYS = {
    livemiles: { crumbs: 1, segs: 1 },
    geoloads: { events: 1, pegEvents: 1, pegs: 1 }
  };
  var TELE_SHED_BYTES = 8192;
  function teleFieldLen(v) {
    try { var s = JSON.stringify(v); return s ? s.length : 0; } catch (e) { return 0; }
  }
  /* v296: Firestore's own size accounting for a value (the
     formula the v295 harness proved against: field name UTF-8
     +1, numbers 8 bytes, strings UTF-8 +1, booleans/null 1,
     maps/arrays the sum of their parts; timestamps — the
     serverTimestamp saveDoc adds — 8). A walk, not a
     serialization: far cheaper than JSON.stringify on a
     multi-MB value, which is also main-thread relief. */
  function fsSizeEstimate(v) {
    if (v === null || v === undefined) return 1;
    var tv = typeof v;
    if (tv === 'boolean') return 1;
    if (tv === 'number') return 8;
    if (tv === 'string') return utf8Len(v) + 1;
    if (Array.isArray(v)) {
      var sa = 0;
      for (var i = 0; i < v.length; i++) sa += fsSizeEstimate(v[i]);
      return sa;
    }
    if (tv === 'object') {
      if (typeof v.toMillis === 'function') return 8; // a Firestore timestamp
      var so = 0;
      for (var k in v) {
        if (Object.prototype.hasOwnProperty.call(v, k)) so += utf8Len(k) + 1 + fsSizeEstimate(v[k]);
      }
      return so;
    }
    return 1;
  }
  function utf8Len(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }
  /* The estimated size of the kv DOCUMENT { v, updatedAt } for
     a key, resource name included — the number Firestore's
     1,048,576-byte limit is actually enforced against. */
  function fsDocEstimate(key, val) {
    var name = 'projects/meticulous-dd570/databases/(default)/documents/users/' +
      (S.uid || '') + '/kv/' + docIdFor(key);
    return utf8Len(name) + 1 + (utf8Len('v') + 1 + fsSizeEstimate(val)) +
      (utf8Len('updatedAt') + 1 + 8);
  }
  /* v296: telemetrySyncCopy measures and gates on the REAL
     Firestore size (fsDocEstimate vs TELE_FS_CAP_BYTES), not
     JSON text length — see the constants note. The shed set
     also closes the last gap in the v295 class: v295 shed only
     OBJECT-typed bulk (arrays/maps); a heavy STRING field (an
     old shape's serialized log riding in a day record or on
     the shell) rode every rung exactly the same way. Any
     non-fact field whose real size exceeds TELE_SHED_BYTES —
     string, array or map — is now shed from the copy. Facts
     are never shed: crumbs/segs (livemiles) and events/
     pegEvents/pegs (geoloads) ride the crumb ladder as before,
     and every small field rides whole. The optional `out`
     object receives the build's account (rung chosen, real
     size, shed field names) for the diagnostics below. */
  function telemetrySyncCopy(key, val, out) {
    if (!val || typeof val !== 'object' || !val.days || typeof val.days !== 'object') return val;
    var wholeFs = fsDocEstimate(key, val);
    if (out) { out.rung = 'whole'; out.fsBytes = wholeFs; out.shed = []; }
    if (wholeFs <= TELE_FS_CAP_BYTES) return val;
    var dayKeys = Object.keys(val.days);
    /* newest first, by the records' own updatedAt — the harsh
       rungs shed the oldest days' trails before the newest. */
    var newestFirst = dayKeys.slice().sort(function (a, b) {
      var ra = val.days[a] || {}, rb = val.days[b] || {};
      return (rb.updatedAt || 0) - (ra.updatedAt || 0);
    });
    /* The shed set is decided ONCE — it does not depend on the
       rung: heavy non-fact bulk, per day record and at the shell.
       Small fields always ride (cheap, and possibly meaningful
       to a future shape). */
    var factArrays = TELE_FACT_ARRAYS[key] || { crumbs: 1, segs: 1 };
    var shedDay = {}, shedTop = {}, shedAny = false, shedNames = {};
    dayKeys.forEach(function (dk) {
      var rec = val.days[dk];
      if (!rec || typeof rec !== 'object') return;
      for (var f in rec) {
        if (!Object.prototype.hasOwnProperty.call(rec, f)) continue;
        if (f === 'crumbs' || factArrays[f]) continue;
        if (fsSizeEstimate(rec[f]) > TELE_SHED_BYTES) {
          (shedDay[dk] = shedDay[dk] || {})[f] = 1;
          shedAny = true; shedNames[f] = 1;
        }
      }
    });
    for (var tf in val) {
      if (!Object.prototype.hasOwnProperty.call(val, tf)) continue;
      if (tf === 'days') continue;
      if (fsSizeEstimate(val[tf]) > TELE_SHED_BYTES) { shedTop[tf] = 1; shedAny = true; shedNames[tf] = 1; }
    }
    if (out) out.shed = Object.keys(shedNames);
    function build(cap, keepDays) {
      var nd = {};
      newestFirst.forEach(function (dk, i) {
        var rec = val.days[dk];
        if (!rec || typeof rec !== 'object') { nd[dk] = rec; return; }
        var shed = shedDay[dk], c = {};
        for (var f in rec) {
          if (!Object.prototype.hasOwnProperty.call(rec, f)) continue;
          if (shed && shed[f]) continue;
          if (f === 'crumbs' && Array.isArray(rec.crumbs)) {
            c[f] = (i < keepDays)
              ? (cap === null ? rec.crumbs.slice() : thinCrumbs(rec.crumbs, cap))
              : [];
          } else c[f] = rec[f];
        }
        nd[dk] = c;
      });
      var outv = {};
      for (var f2 in val) {
        if (!Object.prototype.hasOwnProperty.call(val, f2)) continue;
        if (f2 === 'days' || shedTop[f2]) continue;
        outv[f2] = val[f2];
      }
      outv.days = nd;
      return outv;
    }
    /* Rung 0 (bulk shed, trails whole) exists only when there is
       bulk to shed — with none, it would be the value itself,
       already known to be over the cap. */
    var rungs = [];
    if (shedAny) rungs.push([null, dayKeys.length]);
    rungs.push([400, dayKeys.length], [120, dayKeys.length], [40, dayKeys.length],
               [40, 3], [24, 1], [0, 0]);
    var lastCopy = null, lastFs = 0;
    for (var i = 0; i < rungs.length; i++) {
      lastCopy = build(rungs[i][0], rungs[i][1]);
      lastFs = fsDocEstimate(key, lastCopy);
      if (lastFs <= TELE_FS_CAP_BYTES) {
        if (out) {
          out.rung = (rungs[i][0] === null) ? 'shed, trails whole'
            : 'crumbs ' + rungs[i][0] + '/day' + (rungs[i][1] < dayKeys.length ? ', newest ' + rungs[i][1] + ' days' : '');
          out.fsBytes = lastFs;
        }
        return lastCopy;
      }
    }
    if (out) { out.rung = 'facts only — still over'; out.fsBytes = lastFs; }
    return lastCopy; // facts only; caller fails honestly if even this is over
  }
  function telemetryCopyJson(key, val) { return JSON.stringify(telemetrySyncCopy(key, val)); }

  /* v297 (SYNC-STILL-FAILING, fourth pass — the cause is PROVEN,
     no longer a candidate): the owner's phone read its own
     attempt record aloud (Oct 31, 2026, 11:53 MDT, web 296):
     "Error: push livemiles: Function … called with invalid
     data. N… (found in document users/72kLjT1dbCOLdWo…)" at
     sizes of 32 KB local / 56 KB cloud / 72 KB copy — size was
     never the phone's problem. The refused value is the miles
     engine's counted-coverage spans: a day record's `segs` rode
     as [t0, t1] PAIRS — a list inside a list, the one shape the
     document store rejects outright ("Nested arrays are not
     supported"). Every day with a counted span poisoned every
     backup: deterministic, cold-start-proof, and invisible to
     three passes of harnesses whose Firestore double never
     enforced the nested-list rule (their fixture records
     carried the very same pairs and "landed"). The engine now
     persists the spans as { f, t } maps (js/miles.js), and THIS
     boundary makes the whole class impossible rather than
     merely unlikely: before any telemetry write, the copy is
     walked — the first value the store would refuse is NAMED
     in the attempt record (path + kind), and the copy is then
     deep-cleaned so the write lands. Cleaning repairs facts,
     never drops them: a span list becomes its { f, t } map; a
     NaN/infinite number becomes blank (a total the merge reads
     as "no total", never a fake zero); a Date or timestamp
     object becomes its time number; an undefined field is
     simply absent (it held no value); any other list-in-list
     becomes a numeric-key map. The local store is untouched —
     this runs on the sync copy only. */
  var FS_DROP = {};
  function fsIsPlain(v) {
    if (!v || typeof v !== 'object') return false;
    /* plain = made by an object literal, in ANY realm: its
       prototype is null or is itself a bare prototype (whose
       own prototype is null). A class instance's prototype
       chain is one link longer. */
    var p = Object.getPrototypeOf(v);
    return p === null || Object.getPrototypeOf(p) === null;
  }
  function fsIsDate(v) {
    try { return Object.prototype.toString.call(v) === '[object Date]'; } catch (e) { return false; }
  }
  /* The first value in `v` the store would refuse, as
     { path, kind } — or null when the value is clean. */
  function findFsInvalid(v, path) {
    if (v === undefined) return { path: path || '(the whole value)', kind: 'undefined' };
    var tv = typeof v;
    if (tv === 'function' || tv === 'symbol') return { path: path || '(the whole value)', kind: 'a function' };
    if (tv === 'number') {
      if (isNaN(v)) return { path: path, kind: 'NaN' };
      if (!isFinite(v)) return { path: path, kind: 'Infinity' };
      return null;
    }
    if (v === null || tv === 'string' || tv === 'boolean') return null;
    if (fsIsDate(v)) return { path: path, kind: 'a Date' };
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) {
        if (Array.isArray(v[i])) return { path: path + '[' + i + ']', kind: 'a nested array' };
        var ra = findFsInvalid(v[i], path + '[' + i + ']');
        if (ra) return ra;
      }
      return null;
    }
    if (typeof v.toMillis === 'function') return null; // a stored timestamp is legal there
    if (!fsIsPlain(v)) return { path: path, kind: 'a custom object' };
    for (var k in v) {
      if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
      var ro = findFsInvalid(v[k], path ? path + '.' + k : k);
      if (ro) return ro;
    }
    return null;
  }
  /* Deep-clean a sync copy for the write. Returns the cleaned
     value (FS_DROP for a field that held no storable value);
     every repair is named in `cleaned`. Deterministic. */
  function sanitizeForFirestore(v, path, cleaned, depth) {
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') return FS_DROP;
    var tv = typeof v;
    if (tv === 'number') {
      if (isFinite(v)) return v;
      cleaned.push(path + ' held ' + (isNaN(v) ? 'NaN' : 'an infinite number') + ' — written blank');
      return null;
    }
    if (v === null || tv === 'string' || tv === 'boolean') return v;
    var d = (depth || 0) + 1;
    if (d > 40) { cleaned.push(path + ' was nested too deep — written blank'); return null; }
    if (fsIsDate(v)) {
      cleaned.push(path + ' held a Date — written as its time number');
      var gt = 0;
      try { gt = v.getTime(); } catch (e) {}
      return isFinite(gt) ? gt : null;
    }
    if (Array.isArray(v)) {
      var isSegs = /(^|\.)segs$/.test(path);
      var out = [], notedSegs = false, i2, el, sv;
      for (i2 = 0; i2 < v.length; i2++) {
        el = v[i2];
        if (Array.isArray(el)) {
          if (isSegs) {
            var f0 = sanitizeForFirestore(el[0], path + '[' + i2 + '].f', cleaned, d);
            var f1 = sanitizeForFirestore(el[1], path + '[' + i2 + '].t', cleaned, d);
            if (typeof f0 === 'number' && typeof f1 === 'number') out.push({ f: f0, t: f1 });
            if (!notedSegs) { cleaned.push(path + ' held coverage spans as lists — re-shaped as maps'); notedSegs = true; }
          } else {
            var mo = {}, mj;
            for (mj = 0; mj < el.length; mj++) {
              var svm = sanitizeForFirestore(el[mj], path + '[' + i2 + '][' + mj + ']', cleaned, d);
              if (svm !== FS_DROP) mo[String(mj)] = svm;
            }
            cleaned.push(path + '[' + i2 + '] held a list inside a list — written as a map');
            out.push(mo);
          }
        } else {
          sv = sanitizeForFirestore(el, path + '[' + i2 + ']', cleaned, d);
          out.push(sv === FS_DROP ? null : sv);
        }
      }
      return out;
    }
    if (typeof v.toMillis === 'function') {
      cleaned.push(path + ' held a timestamp object — written as its time number');
      try { var tm = v.toMillis(); return isFinite(tm) ? tm : null; } catch (e) { return null; }
    }
    var plain = fsIsPlain(v);
    var oo = {};
    for (var k3 in v) {
      if (!Object.prototype.hasOwnProperty.call(v, k3)) continue;
      var sv3 = sanitizeForFirestore(v[k3], path ? path + '.' + k3 : k3, cleaned, d);
      if (sv3 !== FS_DROP) oo[k3] = sv3;
    }
    if (!plain) cleaned.push(path + ' held an object the cloud cannot store — written as a plain copy');
    return oo;
  }

  /* ---------------- v296: telemetry diagnostics ----------------
   * Three sync builds (293, 295) shipped against a failure whose
   * actual error string the app had been capturing all along —
   * in S._keyFails — where no screen ever showed it, and whose
   * cloud document no pass had ever inventoried. These helpers
   * end that: every telemetry push attempt records the stage it
   * reached, the verbatim error, per-stage timings and the real
   * sizes; every pull inventories the cloud doc's actual fields
   * (names + sizes, top-level and per-day). Both are persisted
   * to mt___syncdiag (internal — never synced) so the record
   * survives a cold start, and surfaced via status().teleDiag
   * to the Advanced troubleshooting readout. */
  var DIAG_LS_KEY = '__syncdiag';       // -> mt___syncdiag (never synced)
  function diagStore() {
    if (!S._diagPersist) {
      S._diagPersist = parseJson(lsGetRaw(DIAG_LS_KEY), null) || {};
      if (!S._diagPersist.attempts) S._diagPersist.attempts = {};
      if (!S._diagPersist.cloudInv) S._diagPersist.cloudInv = {};
    }
    return S._diagPersist;
  }
  function saveDiag() {
    try { lsSetRaw(DIAG_LS_KEY, JSON.stringify(diagStore())); } catch (e) {}
  }
  function teleInventory(val) {
    var inv = { days: 0, fsBytes: 0, top: [], dayFields: [] };
    if (!val || typeof val !== 'object') return inv;
    inv.fsBytes = fsSizeEstimate(val);
    var agg = {}, tf;
    for (tf in val) {
      if (!Object.prototype.hasOwnProperty.call(val, tf)) continue;
      if (tf === 'days') continue;
      inv.top.push({ f: tf, t: Array.isArray(val[tf]) ? 'array' : typeof val[tf], b: fsSizeEstimate(val[tf]) });
    }
    var dv = (val.days && typeof val.days === 'object') ? val.days : null;
    if (dv) {
      var dks = Object.keys(dv);
      inv.days = dks.length;
      dks.forEach(function (dk) {
        var rec = dv[dk];
        if (!rec || typeof rec !== 'object') return;
        for (var rf in rec) {
          if (!Object.prototype.hasOwnProperty.call(rec, rf)) continue;
          var sz = fsSizeEstimate(rec[rf]);
          var a = agg[rf] || (agg[rf] = { f: rf, n: 0, b: 0, max: 0 });
          a.n++; a.b += sz; if (sz > a.max) a.max = sz;
        }
      });
    }
    inv.dayFields = Object.keys(agg).map(function (k) { return agg[k]; })
      .sort(function (a, b) { return b.b - a.b; }).slice(0, 10);
    inv.top.sort(function (a, b) { return b.b - a.b; });
    inv.top = inv.top.slice(0, 10);
    return inv;
  }
  function noteTeleAttempt(key, att) {
    S._teleDiag[key] = att;
    try { diagStore().attempts[key] = att; saveDiag(); } catch (e) {}
  }
  function noteCloudInv(key, inv) {
    S._cloudTeleInv[key] = inv;
    try { diagStore().cloudInv[key] = inv; saveDiag(); } catch (e) {}
  }
  function diagSnapshot() {
    var d = diagStore();
    var attempts = {}, inv = {}, k;
    for (k in d.attempts) if (Object.prototype.hasOwnProperty.call(d.attempts, k)) attempts[k] = d.attempts[k];
    for (k in S._teleDiag) if (Object.prototype.hasOwnProperty.call(S._teleDiag, k)) attempts[k] = S._teleDiag[k];
    for (k in d.cloudInv) if (Object.prototype.hasOwnProperty.call(d.cloudInv, k)) inv[k] = d.cloudInv[k];
    for (k in S._cloudTeleInv) if (Object.prototype.hasOwnProperty.call(S._cloudTeleInv, k)) inv[k] = S._cloudTeleInv[k];
    return { attempts: attempts, cloudInv: inv };
  }
  S.diag = function () { return diagSnapshot(); };
  /* v295: a macrotask yield — the telemetry push awaits this
     around its two heavy CPU steps (the merge, the copy build)
     so a big sync never holds the main thread across frames:
     the page keeps painting while the backup lands. */
  function yieldFrame() { return new Promise(function (res) { setTimeout(res, 0); }); }

  /* v276 (SPARK-QUOTA): read the ONE cloud doc a record-list
     push merges against (its current array, or null). Before
     v276 the push loaded the WHOLE kv collection (~36 docs)
     to find this one doc — 36 Firestore reads per record
     save on a plan that allows 50,000 a day. FB.loadDoc reads
     exactly the doc the write will land on. The loadDocs
     fallback stands for a half-updated bundle mid-OTA
     (cloudsync v276 over firebase.js v275): same search, same
     merge, more reads — correctness never depends on which
     door the read came through. A read failure rejects, and
     the caller fails the push honestly (v272 law). */
  function loadCloudDoc(key, docId) {
    if (typeof FB.loadDoc === 'function') {
      return FB.loadDoc(KV_COLLECTION, docId).then(function (d) {
        return (d && Array.isArray(d.v)) ? d.v : null;
      });
    }
    return FB.loadDocs(KV_COLLECTION).then(function (docs) {
      var arr = null;
      (docs || []).forEach(function (d) {
        if ((d.mt || d.id) === key && Array.isArray(d.v)) arr = d.v;
      });
      return arr;
    });
  }

  /* web403: loadCloudDoc's sibling — the record-list push also
     needs the doc's tombstone field (`del`), which loadCloudDoc
     narrows away. Same contract otherwise: arr is null when no
     usable doc exists. */
  function loadCloudListDoc(key, docId) {
    if (typeof FB.loadDoc === 'function') {
      return FB.loadDoc(KV_COLLECTION, docId).then(function (d) {
        return { arr: (d && Array.isArray(d.v)) ? d.v : null,
                 del: (d && d.del && typeof d.del === 'object') ? d.del : null };
      });
    }
    return FB.loadDocs(KV_COLLECTION).then(function (docs) {
      var out = { arr: null, del: null };
      (docs || []).forEach(function (d) {
        if ((d.mt || d.id) === key) {
          if (Array.isArray(d.v)) out.arr = d.v;
          if (d.del && typeof d.del === 'object') out.del = d.del;
        }
      });
      return out;
    });
  }

  /* v276 (SPARK-QUOTA): an urgent flush — telemetry rides NOW,
     ahead of its coalesce window. Raised by the tracker
     pause/stop stamps in the wrapped store.set, and by the
     page-hide / beforeunload listeners in attach(). */
  function flushUrgent() {
    S._teleUrgent = true;
    flush();
  }
  S.flushUrgent = flushUrgent;

  /* v288 (REWORK2): read the ONE cloud doc a TELEMETRY push
     merges against, as a value of any shape (loadCloudDoc above
     narrows to arrays for the record lists). Same one-doc read,
     same honest failure: a read failure rejects and the caller
     fails the push rather than overwriting blind. */
  function loadCloudValue(key, docId) {
    if (typeof FB.loadDoc === 'function') {
      return FB.loadDoc(KV_COLLECTION, docId).then(function (d) {
        return (d && d.v !== undefined) ? d.v : null;
      });
    }
    return FB.loadDocs(KV_COLLECTION).then(function (docs) {
      var v = null;
      (docs || []).forEach(function (d) {
        if ((d.mt || d.id) === key && d.v !== undefined) v = d.v;
      });
      return v;
    });
  }

  /* v288 (REWORK2 — REINSTALL-LIVE-KM): after-pull subscribers.
     Fired at the end of every pull that CHANGED one of the
     watched keys locally (the telemetry day maps + the tracker):
     the shell adopts the healed store into the running engines
     and re-pushes the session facts to the native record. The
     v222/v287 reseeds rode auth-gated call sites (App.onAuth's
     reattach, the first-pull callback); the owner's v62 verdict
     (Oct 30, 14:46 MDT — the day still reset to ~0.1 km in his
     hands) proved those gates can all be missed on a real
     reinstall sequence. The pull itself is the one moment that
     cannot be missed: it is what lands the healed values. */
  var afterPullCbs = [];
  S.onAfterPull = function (fn) {
    if (typeof fn === 'function' && afterPullCbs.indexOf(fn) < 0) afterPullCbs.push(fn);
  };
  function fireAfterPull(changedKeys) {
    if (!changedKeys.length) return;
    afterPullCbs.forEach(function (fn) {
      try { fn(changedKeys.slice()); } catch (e) {}
    });
  }

  function pushOne(key) {
    var km = keyMeta(key);
    var raw = lsGetRaw(key);
    var docId = docIdFor(key);
    var done = function (ok) {
      if (ok) {
        km.s = Date.now(); delete km.d; S.stats.pushed++;
        /* v276: the coalesce clock starts at the landed write
           (a tombstone delete stamps nothing — the key is gone,
           and a later recreate is a new snapshot, not a tick). */
        if (isTelemetryKey(key) && raw !== null) stampTelePush(key);
        delete S._keyFails[key]; // v136: a successful push clears the key's failure record
        var _dm = getMeta(); _dm.uid = S.uid; _dm.globallySynced = true;
      } else if (isTelemetryKey(key) && raw !== null) {
        /* v413 (SYNC-FLAPPING-NOV11): a FAILED telemetry
           attempt stamps the coalesce clock too — the clock
           now reads "last attempt", landed or not. Before
           this, a failure left the clock untouched, so the
           key stayed eligible on the very next flush and a
           sick link (or a doc that fails honestly) was
           retried on every persist, watchdog tick and
           debounce with no quiet between attempts — the
           back-to-back FAILED rows in the owner's Nov 11
           recording. A failed backup now waits out the same
           60 s as a landed one; the key stays dirty and the
           failure stays named exactly as before. */
        stampTelePush(key);
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
    /* v289: record-list keys never take this skip — they proceed
       to the read-merge-write below, which writes the sync copy
       (recordSyncCopy) that fits the cap, or fails honestly.
       v293 (SYNC-LIVE-MILES-NOT-PUSHING, owner evidence Oct 31,
       2026): TELEMETRY keys never take it either. The skip sealed
       the key clean (km.s = km.t) while writing nothing, so once
       the livemiles document — a rolling 14 days of day records,
       each with its full breadcrumb trail — crossed the cap, every
       push was silently skipped and the cloud copy froze at the
       last state that fit (Oct 31: 0.1 km against the phone's
       60.6 km) while every small key around it kept landing. The
       telemetry branch below now writes a sync copy under the
       cap (telemetrySyncCopy), or fails honestly. */
    if (size > MAX_DOC_BYTES && !RECORD_LIST_KEYS[key] && !isTelemetryKey(key)) {
      try { console.warn('[cloudsync] skipping oversized key (kept locally):', key, size); } catch (e) {}
      km.s = km.t; // don't retry forever; local copy remains the truth
      delete S._keyFails[key]; // v136: handled by design — not a standing failure
      saveMeta();
      return Promise.resolve(false);
    }
    if (!fbReady()) return Promise.resolve(false);
    /* v272 (FUEL-HISTORY-LOST-RECURRENCE): a record-list key is
       never blind-overwritten. The push reads the cloud doc
       first and writes the UNION (mergeRecordLists3 — the same
       shadow rule as the pull), so a store instance holding an
       older array can no longer roll the cloud back over
       records it never saw; cloud-only records are learned
       into the local store at the same moment. If the read
       fails, the push fails honestly — the key stays dirty and
       is retried — rather than overwriting append-only data
       blind. The shadow (km.sh) advances only on a landed
       write: it then names exactly what the cloud holds. */
    if (RECORD_LIST_KEYS[key] && Array.isArray(val)) {
      var rlPushFail = function (e) {
        var msg = 'push ' + key + ': ' + String((e && e.message) || e);
        try { (S._flushErrors = S._flushErrors || []).push({ key: key, msg: msg }); } catch (e2) {}
        try { console.warn('[cloudsync] ' + msg); } catch (e3) {}
        return done(false);
      };
      var rlSave = function (arr, delMap, writeDel, acceptedAfter) {
        /* v289: write the sync copy (facts-complete; photos ride
           only while the whole book fits the doc cap). A copy that
           STILL exceeds the cap fails honestly — the key stays
           dirty and the failure is named — never the old silent
           seal that froze the cloud at Oct 22. The shadow advances
           from the full merged array: fuel identities never read
           the photo, so the identity set is the same either way.
           web403: the tombstone map rides the same write (the
           `del` field), so the list and its tombstones can never
           be seen apart; acceptedAfter persists this device's
           accepted set only once the write has landed. */
        var copy = recordSyncCopy(key, arr);
        if (JSON.stringify(copy).length > MAX_DOC_BYTES) {
          try { (S._flushErrors = S._flushErrors || []).push({ key: key, msg: 'push ' + key + ': the record list exceeds the cloud document size limit even without receipt photos' }); } catch (e) {}
          return Promise.resolve(done(false));
        }
        var payload = { v: copy };
        if (writeDel) payload.del = delMap || {};
        return FB.saveDoc(KV_COLLECTION, docId, payload).then(function (res) {
          if (res === null) {
            try { (S._flushErrors = S._flushErrors || []).push({ key: key, msg: 'push ' + key + ': not signed in' }); } catch (e2) {}
            return done(false);
          }
          km.sh = recordIdList(key, arr);
          if (acceptedAfter) {
            var mm = getMeta();
            if (Object.keys(acceptedAfter).length) { if (!mm.dels) mm.dels = {}; mm.dels[key] = acceptedAfter; }
            else if (mm.dels) delete mm.dels[key];
            saveMeta();
          }
          return done(true);
        }).catch(rlPushFail);
      };
      try {
        return loadCloudListDoc(key, docId).then(function (cd) {
          var cloudArr = cd.arr || [];
          var pFlags = {};
          var mgAll = mergeRecordLists3(key, val, cloudArr, km.sh, pFlags);
          /* web403: tombstone the deletes this merge applied,
             filter the write by every tombstone in force plus
             the undecided records (held back until the user
             decides), and learn the local store the filtered
             union WITH the undecided records still in it. */
          var pAuth = authoredTombs(key, pFlags, cloudArr);
          if (pAuth) acceptDels(key, pAuth);
          processCloudDels(key, cd.del || {}, val, cloudArr, mgAll);
          var uni = computeDelUnion(key, cd.del || {}, pAuth);
          var writeIds = {};
          Object.keys(uni.write).forEach(function (id) { writeIds[id] = 1; });
          var confP = conflictIdSet(key);
          Object.keys(confP).forEach(function (id) { writeIds[id] = 1; });
          var mgWrite = mgAll.filter(function (r) {
            var id = recordIdentity(key, r);
            return !(id && writeIds[id]);
          });
          var heldBack = mgAll.filter(function (r) {
            var id = recordIdentity(key, r);
            return !!(id && confP[id]);
          });
          var mgLocal = applyDelFilter(key, mgWrite.concat(heldBack), val);
          if (JSON.stringify(mgLocal) !== JSON.stringify(val)) lsSetRaw(key, JSON.stringify(mgLocal));
          var present = recordIdList(key, mgWrite).concat(recordIdList(key, cloudArr));
          uni.write = gcDelMap(uni.write, present);
          var accOut = {};
          Object.keys(uni.accepted).forEach(function (id) { if (uni.write[id]) accOut[id] = uni.accepted[id]; });
          var hadDel = !!(cd.del && Object.keys(cd.del).length);
          return rlSave(mgWrite, uni.write,
            hadDel || !!Object.keys(uni.write).length, accOut);
        }).catch(rlPushFail);
      } catch (e) { return Promise.resolve(rlPushFail(e)); }
    }
    /* v288 (REWORK2 — REINSTALL-LIVE-KM, owner verdict Oct 30
       14:46 MDT): a telemetry key (livemiles / geoloads) is
       never blind-overwritten either — the same v272 law the
       record lists got, applied to the day maps. Before this,
       pushOne wrote the local value wholesale: a fresh install's
       young engine snapshot (~0.1 km, begun against an empty
       store before the first pull landed) pushed UP over the
       cloud's full day (39.3 km) and destroyed it everywhere —
       the pull-side day merge (v224) never got a push-side
       twin. The push now reads the cloud doc first and writes
       mergeTelemetryDays' union (larger day wins, exactly the
       pull's rule), learns the union into the local store at
       the same moment, and fails honestly — key stays dirty,
       retried — when the read fails, rather than overwriting
       a day's driving blind. */
    if (isTelemetryKey(key) && val && typeof val === 'object' &&
        val.days && typeof val.days === 'object') {
      /* v296: the attempt is INSTRUMENTED end to end (see the
         diagnostics helpers above): the stage it reached, the
         verbatim error, per-stage timings, the real sizes of
         the local value / cloud doc / merged value / copy, the
         rung that fit and what was shed — recorded on every
         attempt, success or failure, and persisted so a cold
         start still shows the last attempt. The merge's learn
         compare now rides mergeTelemetryDays' change flag
         instead of two full-value serializations (part of the
         remaining sync churn behind the ghosted screen). */
      var tlT0 = Date.now();
      var att = {
        at: tlT0, ok: false, open: true, stage: 'read', err: null,
        localBytes: size, readMs: 0, mergeMs: 0, writeMs: 0,
        cloudFsBytes: 0, mergedFsBytes: 0, copyFsBytes: 0,
        rung: null, shed: [], days: 0,
        invalidPath: null, invalidKind: null, cleaned: []
      };
      if (!S._teleDiag) S._teleDiag = {};
      S._teleDiag[key] = att;
      var tlClose = function () {
        att.open = false;
        /* the diagnostics are a passenger, never a pilot: a
           world without the diag helpers (a sliced test world)
           must not be able to break the push itself. */
        try { noteTeleAttempt(key, att); } catch (e) {}
      };
      var tlPushFail = function (e) {
        var msg = 'push ' + key + ': ' + String((e && e.message) || e);
        att.err = msg;
        tlClose();
        try { (S._flushErrors = S._flushErrors || []).push({ key: key, msg: msg }); } catch (e2) {}
        try { console.warn('[cloudsync] ' + msg); } catch (e3) {}
        return done(false);
      };
      var tlSave = function (v) {
        /* v293: write the SYNC COPY (telemetrySyncCopy) — the
           full merged value stays in the local store (the learn
           above already wrote it there); the cloud copy carries
           every fact the merges and dashboards read, with the
           breadcrumb trails thinned only when the document
           would exceed the cap. A copy that STILL exceeds it
           fails honestly — the key stays dirty and the failure
           is named — never the old silent seal.
           v296: the gate is the REAL Firestore size
           (TELE_FS_CAP_BYTES), and the failure names the sizes. */
        att.stage = 'copy';
        var outMeta = {};
        var copy = telemetrySyncCopy(key, v, outMeta);
        att.rung = outMeta.rung || null;
        att.shed = outMeta.shed || [];
        /* v297: name the first value the store would refuse,
           then clean the copy so the write can land (see the
           sanitizer note above telemetryCopyJson) — the refusal
           this replaces WAS the livemiles failure. The size
           gate below then measures the copy actually written. */
        att.invalidPath = null; att.invalidKind = null; att.cleaned = [];
        try {
          var badFs = findFsInvalid(copy, '');
          if (badFs) { att.invalidPath = badFs.path; att.invalidKind = badFs.kind; }
          var cleanedFs = [];
          copy = sanitizeForFirestore(copy, '', cleanedFs, 0);
          att.cleaned = cleanedFs.slice(0, 12);
          att.copyFsBytes = fsDocEstimate(key, copy);
        } catch (e) {
          att.copyFsBytes = outMeta.fsBytes || fsDocEstimate(key, copy);
        }
        if (att.copyFsBytes > TELE_FS_CAP_BYTES) {
          var bigMsg = 'push ' + key + ': the tracking history is too large for one cloud document even with its map trail thinned (about ' +
            att.copyFsBytes + ' bytes; the limit is about ' + FS_DOC_LIMIT + ')';
          att.err = bigMsg;
          tlClose();
          try { (S._flushErrors = S._flushErrors || []).push({ key: key, msg: bigMsg }); } catch (e) {}
          return Promise.resolve(done(false));
        }
        att.stage = 'write';
        var tlW0 = Date.now();
        return FB.saveDoc(KV_COLLECTION, docId, { v: copy }).then(function (res) {
          att.writeMs = Date.now() - tlW0;
          if (res === null) {
            att.err = 'push ' + key + ': not signed in';
            tlClose();
            try { (S._flushErrors = S._flushErrors || []).push({ key: key, msg: att.err }); } catch (e2) {}
            return done(false);
          }
          att.ok = true; att.err = null;
          tlClose();
          return done(true);
        }).catch(tlPushFail);
      };
      try {
        return loadCloudValue(key, docId).then(function (cloudVal) {
          att.readMs = Date.now() - tlT0;
          if (!cloudVal || typeof cloudVal !== 'object' ||
              !cloudVal.days || typeof cloudVal.days !== 'object') {
            att.stage = 'copy';
            return yieldFrame().then(function () { return tlSave(val); });
          }
          try {
            att.cloudFsBytes = fsDocEstimate(key, cloudVal);
            noteCloudInv(key, teleInventory(cloudVal));
          } catch (e) {}
          /* v295: yield around the merge and the copy build —
             the sync's two heavy CPU steps — so the page keeps
             painting while a big telemetry value backs up (with
             the v293 ladder the owner's screen froze and its
             labels double-drew for seconds per attempt). */
          return yieldFrame().then(function () {
            att.stage = 'merge';
            var tlM0 = Date.now();
            var mgFlags = {};
            var mg = mergeTelemetryDays(key, val, cloudVal, mgFlags);
            att.mergeMs = Date.now() - tlM0;
            att.mergedFsBytes = fsDocEstimate(key, mg);
            att.days = mg.days ? Object.keys(mg.days).length : 0;
            if (mgFlags.changed) lsSetRaw(key, JSON.stringify(mg));
            return yieldFrame().then(function () { return tlSave(mg); });
          });
        }).catch(tlPushFail);
      } catch (e) { return Promise.resolve(tlPushFail(e)); }
    }
    try {
      /* v301 (SYNC-RETRY-RESIDUAL): the generic fall-through was
         the last write door with no sanitizer — a value carrying
         a nested array or an undefined leaf (a shape no special
         branch claims) was refused by the store on EVERY cycle
         and stood as a named failure forever, beside pushes
         that landed. The write now goes through the same
         deep-clean the telemetry door got in v297. Sealing on
         this path is stamp-based, so a cleaned write cannot
         dirty-loop; the local value itself is untouched. */
      return FB.saveDoc(KV_COLLECTION, docId, { v: sanitizeForFirestore(val, '', [], 0) }).then(function (res) {
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
  /* v293: same-lineage test for geoloads day records (see the
     arbitration note in mergeTelemetryDays): the same machine
     count, or the same counted-event trail (events / pegEvents
     length + last stamp). A young fragment fails both — its
     count is smaller and its trail is a short prefix — so the
     v224 fragment protection is preserved. */
  function geoTrailSig(rec) {
    try {
      var parts = [];
      ['events', 'pegEvents'].forEach(function (f) {
        var arr = rec && rec[f];
        if (Array.isArray(arr) && arr.length) {
          var last = arr[arr.length - 1];
          parts.push(f + ':' + arr.length + ':' + (last && last.t !== undefined ? last.t : JSON.stringify(last)));
        } else parts.push(f + ':0:');
      });
      return parts.join('|');
    } catch (e) { return ''; }
  }
  function geoSameLineage(lr, cr) {
    if (!lr || !cr) return false;
    if (typeof lr.count === 'number' && typeof cr.count === 'number' && lr.count === cr.count) return true;
    var ls = geoTrailSig(lr), cs = geoTrailSig(cr);
    return !!ls && ls === cs && ls !== 'events:0:|pegEvents:0:';
  }
  /* v296: the optional `flags` out-object learns whether the
     merged value differs from the LOCAL value (a cloud day won,
     a day exists on one side only, or the cloud shell differs
     from the local shell) — callers use it to decide the local
     learn WITHOUT serializing two multi-MB values to compare
     them (part of the sync churn behind the frozen/ghosted
     screen). The merge laws themselves are untouched. */
  function mergeTelemetryDays(key, localV, cloudV, flags) {
    var out = {}, k, seen = {};
    var a = (localV && localV.days) || {}, b = (cloudV && cloudV.days) || {};
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) seen[k] = true;
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) seen[k] = true;
    for (k in seen) {
      var lr = a[k], cr = b[k];
      if (!lr) { out[k] = cr; if (flags) flags.changed = true; continue; }
      if (!cr) { out[k] = lr; continue; }
      var lt = telemetryDayTotal(key, lr), ct = telemetryDayTotal(key, cr);
      /* v293 (the correction half of SYNC-STOMP): for geoloads,
         two records of the SAME lineage — the same machine count,
         or the same event trail — differ only in the driver's
         signed correction and later state, and a correction
         legitimately moves the day's total DOWN (Oct 30, 2026:
         19 counted with corr -2 = 17 closed, against an earlier
         snapshot at corr +1 = 20 — the larger-total law below
         kept the 20 in the cloud forever and re-taught it to
         the phone on every pull). Same lineage arbitrates by
         updatedAt: the later record is the day's truth. Counts
         that DIFFER keep the v224 law (a fresh engine's young
         fragment has a smaller count and must never beat the
         full day), and livemiles totals only ever grow within
         a day, so the totals law stands there untouched. */
      if (key === 'geoloads' && geoSameLineage(lr, cr)) {
        out[k] = ((cr.updatedAt || 0) >= (lr.updatedAt || 0)) ? cr : lr;
        continue;
      }
      if (ct > lt) out[k] = cr;
      else if (lt > ct) out[k] = lr;
      else {
        /* v293: a totals tie prefers the crumb-RICHER record —
           a shed cloud copy (telemetrySyncCopy) must never strip
           the phone's full breadcrumb trail on a pull. Records
           without crumbs (geoloads) fall through to the stamp. */
        var lc = (lr.crumbs && lr.crumbs.length) || 0;
        var cc = (cr.crumbs && cr.crumbs.length) || 0;
        if (lc !== cc) out[k] = lc > cc ? lr : cr;
        else out[k] = ((cr.updatedAt || 0) >= (lr.updatedAt || 0)) ? cr : lr;
      }
    }
    /* the merged value rides the CLOUD shell (any top-level
       fields it carries) with the unioned day map; when the cloud
       value is not a day-map object, the local shell carries it. */
    var shell = (cloudV && typeof cloudV === 'object' && cloudV.days) ? cloudV
      : (localV && typeof localV === 'object' ? localV : {});
    var merged = {}, sk;
    for (sk in shell) if (Object.prototype.hasOwnProperty.call(shell, sk)) merged[sk] = shell[sk];
    merged.days = out;
    if (flags && !flags.changed) {
      /* v296: did any contested day resolve to the CLOUD record,
         or does the winning shell differ from the local value's?
         Either means the merged value differs from the local
         one (a local-only day or a local win leaves it equal). */
      for (var fk in seen) {
        if (Object.prototype.hasOwnProperty.call(seen, fk) && out[fk] !== a[fk]) { flags.changed = true; break; }
      }
      if (!flags.changed) {
        var lvObj = (localV && typeof localV === 'object') ? localV : {};
        var shellKeys = {}, lk;
        for (lk in shell) if (Object.prototype.hasOwnProperty.call(shell, lk)) shellKeys[lk] = true;
        for (lk in lvObj) if (Object.prototype.hasOwnProperty.call(lvObj, lk)) shellKeys[lk] = true;
        for (lk in shellKeys) {
          if (lk === 'days') continue;
          if (shell[lk] !== lvObj[lk]) { flags.changed = true; break; }
        }
      }
    }
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
     copy heals instead of the phone losing records.
     v272 SUPERSESSION (FUEL-HISTORY-LOST-RECURRENCE): the
     settled-only guard above is RETIRED. It protected one
     shape (a pending delete) by surrendering the other (every
     pending append): a key is dirty from each save until its
     push confirms, and in that window the generic stamp war
     deleted records wholesale whenever the cloud stamp was
     newer — the Oct 20 + Oct 22 fills were lost this way a
     second time, phone and cloud alike. The union now runs in
     every cycle, and the delete protection the guard existed
     for is carried by the per-key shadow instead (km.sh —
     see mergeRecordLists3 below): an absence is honored as a
     deliberate deletion only when the record was part of the
     last cloud state this device verified. The different-
     account guard stands unchanged. */
  var RECORD_LIST_KEYS = { fuel_fills: 1, rev_entries: 1, rev_extras: 1, pti_reports: 1, sessions: 1, dmg_reports: 1, docs_items: 1 };
  function recordIdentity(key, rec) {
    if (!rec || typeof rec !== 'object') return null;
    if (key === 'pti_reports') return rec.id ? 'id:' + rec.id : null;
    /* v339 (DOCUMENT-VAULT): a vault document's id is its
       identity — its own adds carry one, and a received
       document's id is built from its Connect shareId, so the
       union can never double-file a document. */
    if (key === 'docs_items') return rec.id ? 'id:' + rec.id : null;
    /* v293 (FUEL-EDIT-STOMPED): a fuel fill born under the new
       save path carries a stable id that an edit preserves, so
       its identity survives the edit — the fingerprint below
       (which includes the very fields an edit rewrites) is only
       for records born before ids. */
    if (key === 'fuel_fills' && rec.id) return 'id:' + rec.id;
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
  /* v293 (FUEL-EDIT-STOMPED, owner evidence Oct 31, 2026): two
     id-less copies of ONE fill. An edit rewrites litres / cost /
     station — all fingerprint fields — so the edited copy and
     its pre-edit twin carry different recordIdentity values and
     the union below kept both, forever: the cloud showed the
     corrected $235.82 / 93.6 L entry AND the stale $250 one as
     two fills. Copies of one fill agree on the facts an ordinary
     edit never moves: the date, and the odometer (an odometer
     CHANGE between copies is a deliberate correction edit, and
     those copies carry the updAt version stamp the new save
     path writes). Times, when both copies carry one, must
     agree. Records with ids never come here — identity already
     matched them (or their ids genuinely differ). */
  function fuelSameFill(a, b) {
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (a.id || b.id) return false;
    if (!a.date || a.date !== b.date) return false;
    var at = a.time || '', bt = b.time || '';
    if (at && bt && at !== bt) return false;
    var ao = parseFloat(a.odo) || 0, bo = parseFloat(b.odo) || 0;
    /* v354 (EDIT-SAVE-STILL-EATS-SIBLING): the updAt clause
       below used to forgive an odometer conflict on the stamp
       alone. On Oct 22 that ate a bystander: the edited Mobil
       (38.970 L, odo 170,079, updAt-stamped, OCR time) paired
       with the day's OTHER fill — Petro 99.047 L, odo 169,999,
       no time on the record, so the time veto could not fire —
       won the slot on updAt, and the Petro vanished from the
       union (Audit 64 -> 63) though nobody touched it. An
       odometer conflict is forgiven ONLY when a second anchor
       survives: both copies carry the SAME time (the v293
       correction-edit shape). No shared time, conflicting
       odometers — two fills, full stop. */
    if (ao > 0 && bo > 0 && ao !== bo && !((a.updAt || b.updAt) && at && bt && at === bt)) return false;
    if (!(ao > 0 || bo > 0) && !(at && bt)) return false; // nothing anchors them as one fill
    return true;
  }
  /* v354 (DEDUPE LAW — the restore hazard): two copies of one
     fill that agree on the facts a duplicate cannot fake —
     same date, same litres, same total — resolve to ONE
     record keeping the UNION of their fields: the photos of
     whichever copy has them, the fullest station name, an
     odometer reading if either has one, and every other field
     the fuller copy carries. Born of the Oct 14/15 restore:
     the lost fills were re-added through the Add form, then
     the phone's local book healed the ORIGINALS back alongside
     them (Audit 62 -> 64) — duplicates differing only in the
     fields one path dropped (the form's odometer guard threw
     Oct 15's 519,326 away; the originals carry the fuller
     station names). Two records whose ids BOTH exist and
     differ are genuinely two records and never fold; two
     copies that disagree on BOTH anchors (odometers conflict
     AND times conflict) are two fills that happen to share
     figures and never fold either. */
  function fuelDedupeKey(rec) {
    if (!rec || typeof rec !== 'object' || !rec.date) return null;
    var l = parseFloat(rec.litres), c = parseFloat(rec.cost);
    if (isNaN(l) || isNaN(c)) return null;
    return rec.date + '|' + Math.round(l * 1000) + '|' + Math.round(c * 100);
  }
  function fuelPhotoList(rec) {
    var out = [];
    function push(v) { if (typeof v === 'string' && v && out.indexOf(v) < 0) out.push(v); }
    if (!rec) return out;
    push(rec.photo);
    if (Array.isArray(rec.photos)) rec.photos.forEach(push);
    push(rec.photo2);
    return out;
  }
  function fuelUnionFill(base, other) {
    if (!base || typeof base !== 'object') return other || base;
    if (!other || typeof other !== 'object' || other === base) return base;
    var out = {}, k;
    for (k in base) { if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k]; }
    for (k in other) {
      if (!Object.prototype.hasOwnProperty.call(other, k)) continue;
      var bv = out[k], ov = other[k];
      if ((bv === null || bv === undefined || bv === '') && ov !== null && ov !== undefined && ov !== '') out[k] = ov;
    }
    /* an odometer of 0 / blank is a missing reading, not a
       fact — the other copy's real reading fills it. */
    if (!(parseFloat(out.odo) > 0) && parseFloat(other.odo) > 0) out.odo = other.odo;
    if (typeof base.station === 'string' && typeof other.station === 'string' &&
        other.station.length > base.station.length) out.station = other.station;
    var ps = fuelPhotoList(base);
    fuelPhotoList(other).forEach(function (p) { if (ps.indexOf(p) < 0) ps.push(p); });
    if (ps.length) {
      out.photo = ps[0];
      if (ps.length > 1) out.photos = ps; else delete out.photos;
      delete out.photo2; // folded into photo/photos above
    }
    var bu = +base.updAt || 0, ou = +other.updAt || 0;
    if (ou > bu) out.updAt = other.updAt;
    return out;
  }
  function fuelHardConflict(a, b) {
    var ao = parseFloat(a && a.odo) || 0, bo = parseFloat(b && b.odo) || 0;
    if (!(ao > 0 && bo > 0 && ao !== bo)) return false;
    var at = (a && a.time) || '', bt = (b && b.time) || '';
    return !!(at && bt && at !== bt);
  }
  function dedupeFuelFills(arr, doomed) {
    var groups = {}, order = [];
    arr.forEach(function (r, i) {
      var k = fuelDedupeKey(r);
      if (k === null) return;
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(i);
    });
    var consumed = {};
    order.forEach(function (k) {
      var idxs = groups[k].filter(function (i) { return !consumed[i]; });
      if (idxs.length < 2) return;
      /* the base carries the surviving identity: a copy whose
         identity is NOT shadow-doomed beats a doomed one (the
         merge filter would kill a doomed survivor), then the
         fuller record, then the later-offered (local) copy. */
      var baseIdx = idxs[0], bi;
      for (bi = 1; bi < idxs.length; bi++) {
        var cand = arr[idxs[bi]], cur = arr[baseIdx];
        var candDoomed = !!(doomed && doomed[recordIdentity('fuel_fills', cand)]);
        var curDoomed = !!(doomed && doomed[recordIdentity('fuel_fills', cur)]);
        if (candDoomed !== curDoomed) { if (curDoomed) baseIdx = idxs[bi]; continue; }
        var cs = recordCompleteness('fuel_fills', cand), bs = recordCompleteness('fuel_fills', cur);
        if (cs > bs || (cs === bs && idxs[bi] > baseIdx)) baseIdx = idxs[bi];
      }
      for (bi = 0; bi < idxs.length; bi++) {
        var i = idxs[bi];
        if (i === baseIdx || consumed[i]) continue;
        var a = arr[baseIdx], b = arr[i];
        if (a.id && b.id && a.id !== b.id) continue; // two real records
        if (fuelHardConflict(a, b)) continue; // two fills sharing figures
        arr[baseIdx] = fuelUnionFill(a, b);
        consumed[i] = 1;
      }
    });
    return arr.filter(function (r, i) { return !consumed[i]; });
  }
  /* v293: which of two copies of one fuel fill survives.
     A shadow-doomed copy (this device deleted that identity on
     purpose) yields to its sibling — without this, an edit
     whose old identity sits in the shadow could be filtered
     out whole when the stale copy happened to win on
     completeness. Then the version stamp (updAt — the newest
     version of the record wins), then completeness (the v241
     law), then the local copy.
     v349 (EDIT-SAVE-PHOTO-DELETES-ENTRY, owner evidence Nov 5,
     23:23): the doomed branch below returned `rd` — whether the
     CANDIDATE is doomed — while its own inline comment states
     the law as `cd` (the candidate wins exactly when the
     INCUMBENT is the doomed one). The sentence the comment
     feared came true by the branch itself: an id-less fill
     edited so its fingerprint moved (the receipt OCR supplying
     a time the record never carried) pairs its clean edited
     copy (candidate) against the stale cloud copy (incumbent,
     identity in the shadow); the inverted return kept the
     doomed incumbent in the slot, and mergeRecordLists3's
     filter then deleted it as a deliberate deletion — the
     record was gone from list, Audit and cloud on the first
     merge after its own save (Oct 14 + Oct 15 fills, twice).
     The return is now the comment's law. A true delete has no
     sibling to pair with, so the filter still removes it. */
  function fuelCopyWins(cur, rec, isLocal, doomed, curId, recId) {
    if (doomed) {
      var cd = !!doomed[curId], rd = !!doomed[recId];
      if (cd !== rd) return cd; // rec wins exactly when cur is the doomed one
    }
    var cu = +cur.updAt || 0, ru = +rec.updAt || 0;
    if (cu !== ru) return ru > cu;
    var cs = recordCompleteness('fuel_fills', cur), ns = recordCompleteness('fuel_fills', rec);
    if (ns !== cs) return ns > cs;
    return isLocal;
  }
  /* v354: when two fuel copies paired as one fill ALSO meet
     the dedupe law (same date + litres + total), the survivor
     is their UNION, not the bare winner — the winner-takes-all
     arbitration used to throw the loser's odometer, fuller
     station name and photo away even when it kept the record.
     Pairs whose figures moved (a real figures edit) keep the
     v293 winner-takes-all law untouched. */
  function fuelPairResult(key, cur, rec, recWins) {
    if (fuelDedupeKey(cur) !== null && fuelDedupeKey(cur) === fuelDedupeKey(rec)) {
      return fuelUnionFill(recWins ? rec : cur, recWins ? cur : rec);
    }
    return recWins ? rec : cur;
  }
  function mergeRecordLists(key, localArr, cloudArr, doomed) {
    var out = [], pos = {};
    function offer(rec, isLocal) {
      var id = recordIdentity(key, rec);
      if (id === null) { out.push(rec); return; }
      if (id in pos) {
        var slot = pos[id];
        if (key === 'fuel_fills') {
          var w0 = fuelCopyWins(out[slot], rec, isLocal, doomed, recordIdentity(key, out[slot]), id);
          out[slot] = fuelPairResult(key, out[slot], rec, w0);
        } else {
          var cur = out[slot];
          /* v301 (SYNC-STUB-MERGE): a session's liveKm is the
             one fact that legitimately GROWS after the record
             first exists — patchSessionEntry folds late miles
             into the stopped entry in place (same identity,
             larger liveKm), and the post-close accrual does
             the same. Between two copies of ONE session the
             larger liveKm is strictly later knowledge, the
             same totals law telemetry days live by (v224):
             it wins before the field-count compare and
             before locality, so a young same-session copy
             (born on a second instance with the day barely
             begun) can never outrank the real entry on any
             device, in either merge direction. */
          var takeIt;
          if (key === 'sessions') {
            var lkC = (cur && typeof cur.liveKm === 'number') ? cur.liveKm : -1;
            var lkR = (rec && typeof rec.liveKm === 'number') ? rec.liveKm : -1;
            if (lkC !== lkR) takeIt = lkR > lkC;
          }
          if (takeIt === undefined) {
            var cs = recordCompleteness(key, cur), ns = recordCompleteness(key, rec);
            takeIt = ns > cs || (isLocal && ns === cs);
          }
          if (takeIt) out[slot] = rec;
        }
        return;
      }
      if (key === 'fuel_fills') {
        /* v354: BEST match, not first match. The scan used to
           stop at the first same-fill candidate in array order;
           when a looser candidate sat ahead of the record's
           true twin, the pairing (and its slot aliasing) bound
           to the wrong record. Anchors score: equal odometer
           4, equal time 2, dedupe-key equality 1. */
        var bestJ = -1, bestScore = -1;
        for (var j = 0; j < out.length; j++) {
          if (!fuelSameFill(out[j], rec)) continue;
          var o = out[j], sc = 0;
          var ao2 = parseFloat(o.odo) || 0, bo2 = parseFloat(rec.odo) || 0;
          if (ao2 > 0 && bo2 > 0 && ao2 === bo2) sc += 4;
          if (o.time && rec.time && o.time === rec.time) sc += 2;
          var dk = fuelDedupeKey(rec);
          if (dk !== null && dk === fuelDedupeKey(o)) sc += 1;
          if (sc > bestScore) { bestScore = sc; bestJ = j; }
        }
        if (bestJ >= 0) {
          var oid = recordIdentity(key, out[bestJ]);
          var w1 = fuelCopyWins(out[bestJ], rec, isLocal, doomed, oid, id);
          out[bestJ] = fuelPairResult(key, out[bestJ], rec, w1);
          pos[id] = bestJ;
          if (oid) pos[oid] = bestJ;
          return;
        }
      }
      pos[id] = out.length; out.push(rec);
    }
    (cloudArr || []).forEach(function (r) { offer(r, false); });
    (localArr || []).forEach(function (r) { offer(r, true); });
    /* v354: the dedupe pass — copies the pairing could not
       reach (an id on one side bars fuelSameFill) still fold
       when the dedupe law's facts agree. */
    if (key === 'fuel_fills') out = dedupeFuelFills(out, doomed);
    return out;
  }

  /* v272 (FUEL-HISTORY-LOST-RECURRENCE — the v241 fix did not
     hold in the field; owner, Oct 26, 2026: the Fill-ups list
     stops at Oct 19 AGAIN, the Oct 20 + Oct 22 fills gone from
     the phone AND the cloud): the v241 union ran only while the
     local key was SETTLED. A record-list key is dirty from the
     moment a record is saved until its push is confirmed —
     seconds on a good connection, indefinitely when flushes
     fail on fringe signal — and in every dirty cycle the key
     fell through to the generic stamp war, which REPLACED the
     local list wholesale whenever the cloud stamp was newer
     and sealed the meta clean. The fresher cloud copy could
     itself be a rolled-back one, because pushOne overwrote the
     doc blind. The two halves met in the field exactly as they
     had before v241; the v241 suite never saw it because every
     case preset a settled meta.
     The law now: a record-list key merges on BOTH sides of the
     sync, dirty or settled.
       - The pull union runs in dirty cycles too.
       - pushOne for these keys is READ-MERGE-WRITE (below):
         it unions the cloud doc into the write and learns
         cloud-only records into the local store; if the read
         fails, the push fails honestly (the key stays dirty
         and is retried) — never a blind overwrite.
       - Deliberate deletions stay deleted via a per-key
         SHADOW (km.sh): the record identities of the last
         cloud state this device verified. An identity that is
         in the shadow, absent from the local list, and still
         present in the cloud is a record this device deleted
         on purpose — pendingRecordDeletes names it, and the
         merge filters it out (so its push carries the delete
         up instead of resurrecting it). An identity absent
         from the shadow was never agreed with the cloud, so
         its absence locally proves nothing and the union
         keeps the cloud's copy.
       - With no shadow on record (the first cycle after this
         build, or a key this device never synced), the merge
         is the plain union: appends can never be lost; a
         delete made in that one cycle may need one repeat —
         visible and recoverable, never silent loss. */
  function recordIdList(key, arr) {
    var out = [], seen = {};
    (arr || []).forEach(function (r) {
      var id = recordIdentity(key, r);
      if (id !== null && !seen[id]) { seen[id] = 1; out.push(id); }
    });
    return out;
  }
  function pendingRecordDeletes(key, shadowIds, localArr, cloudArr) {
    var del = {};
    if (!shadowIds || !shadowIds.length) return del;
    var localIds = {}, cloudIds = {};
    (localArr || []).forEach(function (r) { var id = recordIdentity(key, r); if (id !== null) localIds[id] = 1; });
    (cloudArr || []).forEach(function (r) { var id = recordIdentity(key, r); if (id !== null) cloudIds[id] = 1; });
    shadowIds.forEach(function (id) { if (!localIds[id] && cloudIds[id]) del[id] = 1; });
    return del;
  }
  function mergeRecordLists3(key, localArr, cloudArr, shadowIds, flags) {
    /* v293: the pending-delete set is computed FIRST and handed
       to the merge: a shadow-deleted identity that still has a
       same-fill sibling in the union (the edit that replaced
       it) yields to that sibling inside the merge, and the
       filter below then removes only true deletions. */
    var del = pendingRecordDeletes(key, shadowIds, localArr, cloudArr);
    /* v354 (DEDUPE LAW): a doomed fuel identity whose cloud
       record has a dedupe twin in the local list (same date +
       litres + total, no hard conflict, no id clash) is not a
       deletion at all — the local twin IS that fill, wearing
       the fields its own save path kept, and the union below
       folds the two into one record. Without this rescue the
       folded survivor — which takes the fuller station name
       and odometer, i.e. often the doomed copy's own
       fingerprint — would be filtered out as its own delete.
       A true delete has no local twin, so the shadow law is
       untouched (pinned by the v349 E2 case and S5 below). */
    if (key === 'fuel_fills') {
      var delIds = Object.keys(del);
      for (var di = 0; di < delIds.length; di++) {
        var did = delIds[di], crec = null, ci;
        for (ci = 0; ci < (cloudArr || []).length; ci++) {
          if (recordIdentity(key, cloudArr[ci]) === did) { crec = cloudArr[ci]; break; }
        }
        if (!crec) continue;
        var dk2 = fuelDedupeKey(crec);
        if (dk2 === null) continue;
        for (ci = 0; ci < (localArr || []).length; ci++) {
          var lrec = localArr[ci];
          if (fuelDedupeKey(lrec) !== dk2) continue;
          if (fuelHardConflict(lrec, crec)) continue;
          if (lrec.id && crec.id && lrec.id !== crec.id) continue;
          delete del[did];
          break;
        }
      }
    }
    var merged = mergeRecordLists(key, localArr, cloudArr, del);
    var any = false, dk;
    for (dk in del) { if (Object.prototype.hasOwnProperty.call(del, dk)) { any = true; break; } }
    if (!any) return merged;
    return merged.filter(function (r) {
      var id = recordIdentity(key, r);
      var drop = !(id === null || !del[id]);
      /* web403: name the deletions this merge actually applied
         (post fuel-rescue) on the caller's flags — the authoring
         signal for the DELETE-STICKINESS tombstones. Callers
         that pass no flags see no change. */
      if (drop && flags) { (flags.deleted = flags.deleted || {})[id] = r; }
      return !drop;
    });
  }

  /* ---------------- web403: DELETE-STICKINESS tombstones -------
     The machinery behind the law stated at DEL_GC_MS above.
     State (all TOP level of the meta, per the v276 rule):
       m.dels   { key: { id: {t, fp} } }  tombstones this device
                  has authored or accepted — applied to every
                  merge result for that key, on every cycle.
       m.delConf [ {key, id, t, fp, label} ]  disagreements
                  awaiting the user's choice (status() surfaces
                  them; the Preferences sync card renders them).
       m.delRev { key: { id: ms } }  keep-revocations not yet
                  confirmed landed in the cloud doc.            */
  function recordContentFp(key, rec) {
    var id = recordIdentity(key, rec);
    if (!id) return null;
    /* a fingerprint identity already IS the content */
    if (id.indexOf('fp:') === 0) return id;
    var shed = { photo: 1 };
    (RECORD_PHOTO_FIELDS[key] || []).forEach(function (f) { shed[f] = 1; });
    var parts = [];
    Object.keys(rec || {}).sort().forEach(function (k) {
      if (shed[k]) return;
      parts.push(k + '=' + JSON.stringify(rec[k]));
    });
    return 'cfp:' + parts.join('|');
  }
  function findRecordById(key, arr, id) {
    var out = null;
    (arr || []).forEach(function (r) { if (!out && recordIdentity(key, r) === id) out = r; });
    return out;
  }
  function recordLabel(key, rec) {
    var names = { rev_entries: 'Revenue entry', fuel_fills: 'Fuel fill',
      docs_items: 'Document', pti_reports: 'PTI report',
      dmg_reports: 'Damage report', sessions: 'Shift record',
      rev_extras: 'Revenue extra' };
    var base = names[key] || 'Record', bits = [];
    if (rec) {
      if (rec.date) bits.push(String(rec.date));
      if (key === 'rev_entries' && rec.amount !== null && rec.amount !== undefined) bits.push('$' + rec.amount);
      if (key === 'fuel_fills' && rec.litres !== null && rec.litres !== undefined) bits.push(rec.litres + ' L');
      if (rec.station) bits.push(String(rec.station));
      if (rec.title) bits.push(String(rec.title).slice(0, 40));
      if (rec.note) bits.push(String(rec.note).slice(0, 40));
      if (rec.desc) bits.push(String(rec.desc).slice(0, 40));
    }
    return bits.length ? base + ' — ' + bits.join(' · ') : base;
  }
  function authoredTombs(key, flags, cloudArr) {
    if (!flags || !flags.deleted) return null;
    var out = null;
    Object.keys(flags.deleted).forEach(function (id) {
      /* the fingerprint basis is the AGREED record — the cloud's
         own copy; the merged record is only a fallback */
      var rec = findRecordById(key, cloudArr, id) || flags.deleted[id];
      (out = out || {})[id] = { t: Date.now(), fp: recordContentFp(key, rec) };
    });
    return out;
  }
  function cloneDelMap(map) {
    var out = {};
    if (map && typeof map === 'object') {
      Object.keys(map).forEach(function (id) {
        var tb = map[id] || {};
        out[id] = { t: Number(tb.t) || 0, fp: tb.fp || null };
      });
    }
    return out;
  }
  function acceptDels(key, map) {
    if (!map) return;
    var m = getMeta();
    if (!m.dels) m.dels = {};
    if (!m.dels[key]) m.dels[key] = {};
    Object.keys(map).forEach(function (id) { m.dels[key][id] = map[id]; });
    saveMeta();
  }
  function conflictIdSet(key) {
    var m = getMeta(), out = {};
    (m.delConf || []).forEach(function (c) { if (c && c.key === key) out[c.id] = 1; });
    return out;
  }
  /* GC RULE (named at DEL_GC_MS): drop a tombstone only when it
     is older than DEL_GC_MS AND its id is absent from both lists
     in play — a record still present anywhere keeps its guard. */
  function gcDelMap(map, presentIds) {
    var now = Date.now(), present = {}, out = {};
    (presentIds || []).forEach(function (id) { present[id] = 1; });
    Object.keys(map || {}).forEach(function (id) {
      var tb = map[id];
      if (tb && (now - (Number(tb.t) || 0)) > DEL_GC_MS && !present[id]) return;
      out[id] = tb;
    });
    return out;
  }
  /* Process one cloud doc's `del` field against this device:
     accept what settles, surface what doesn't, forget what a
     keeper revoked. rlLocal is the pre-merge local list (the
     edit test reads OUR copy, never the union winner).
     web406: cloudTs is the doc's own stamp where the caller
     knows it (the pull does; the push passes 0 = unknown, and
     unknown never forgets). */
  function processCloudDels(key, cloudDel, rlLocal, cloudArr, mergedArr, cloudTs) {
    var m = getMeta(), changed = false;
    if (!m.dels) m.dels = {};
    var dels = cloneDelMap(m.dels[key]);
    var rev = (m.delRev && m.delRev[key]) ? cloneDelMap(m.delRev[key]) : {};
    var conf = (m.delConf || []).slice();
    function confIdx(id) {
      for (var i = 0; i < conf.length; i++) if (conf[i].key === key && conf[i].id === id) return i;
      return -1;
    }
    Object.keys(cloudDel || {}).forEach(function (id) {
      if (rev[id]) return;              /* our keep is in flight — our push clears it */
      if (confIdx(id) >= 0) return;     /* already the user's to decide */
      var tomb = cloudDel[id] || {};
      var localRec = findRecordById(key, rlLocal, id);
      if (localRec) {
        var fp = recordContentFp(key, localRec);
        if (fp && tomb.fp && fp !== tomb.fp) {
          /* deleted there, EDITED here after the delete — the
             tombstone cannot settle this; the user decides */
          conf.push({ key: key, id: id, t: Number(tomb.t) || Date.now(),
                      fp: tomb.fp, label: recordLabel(key, localRec) });
          changed = true;
          return;
        }
      }
      if (!dels[id] || dels[id].t !== (Number(tomb.t) || 0)) {
        dels[id] = { t: Number(tomb.t) || 0, fp: tomb.fp || null };
        changed = true;
      }
    });
    /* a choice whose record the user already removed by hand in
       the module is moot — accept the tombstone and clear it */
    for (var ci = conf.length - 1; ci >= 0; ci--) {
      if (conf[ci].key !== key) continue;
      if (!findRecordById(key, rlLocal, conf[ci].id)) {
        if (cloudDel && cloudDel[conf[ci].id] && !dels[conf[ci].id]) {
          var tb2 = cloudDel[conf[ci].id] || {};
          dels[conf[ci].id] = { t: Number(tb2.t) || 0, fp: tb2.fp || null };
        }
        conf.splice(ci, 1);
        changed = true;
      }
    }
    /* revoke-forget: the record is back in the cloud list and
       its tombstone is gone — a keeper restored it; forget ours.
       web406: only when the doc itself is NEWER than the
       tombstone — a doc written BEFORE the ruling (the
       pre-tombstone resurrection a resolveOrphan(delete) is
       about to overwrite with its own flush) also lacks the
       entry, and forgetting there would eat the ruling in the
       same syncNow that carries it. A keeper's restoring push
       post-dates the tombstone by construction. */
    var cloudIds = {};
    (cloudArr || []).forEach(function (r) { var id2 = recordIdentity(key, r); if (id2) cloudIds[id2] = 1; });
    Object.keys(dels).forEach(function (id) {
      if (!(cloudDel && cloudDel[id]) && cloudIds[id] && confIdx(id) < 0 &&
          (Number(cloudTs) || 0) > (Number(dels[id].t) || 0)) {
        delete dels[id]; changed = true;
      }
    });
    /* a revocation the cloud doc no longer names has landed */
    Object.keys(rev).forEach(function (id) {
      if (!(cloudDel && cloudDel[id])) { delete rev[id]; changed = true; }
    });
    var present = recordIdList(key, mergedArr).concat(recordIdList(key, cloudArr));
    var gc = gcDelMap(dels, present);
    if (Object.keys(gc).length !== Object.keys(dels).length) changed = true;
    dels = gc;
    if (changed) {
      if (Object.keys(dels).length) m.dels[key] = dels; else delete m.dels[key];
      if (Object.keys(rev).length) { if (!m.delRev) m.delRev = {}; m.delRev[key] = rev; }
      else if (m.delRev) delete m.delRev[key];
      m.delConf = conf;
      saveMeta();
    }
  }
  /* The union with accepted tombstones applied. Undecided
     (conflict-held) records are exempt — and keep the LOCAL
     version, the very copy the user is deciding about. */
  function applyDelFilter(key, merged, rlLocal) {
    var m = getMeta();
    var dels = (m.dels && m.dels[key]) || {};
    var conf = conflictIdSet(key);
    if (!Object.keys(dels).length && !Object.keys(conf).length) return merged;
    return (merged || []).filter(function (r) {
      var id = recordIdentity(key, r);
      return !(id && dels[id] && !conf[id]);
    }).map(function (r) {
      var id = recordIdentity(key, r);
      if (id && conf[id]) return findRecordById(key, rlLocal, id) || r;
      return r;
    });
  }
  /* What the cloud should see of a list: undecided records are
     stripped — they are held back until the user decides. */
  function stripConflictHeld(key, arr) {
    var conf = conflictIdSet(key);
    if (!Object.keys(conf).length) return arr;
    return (arr || []).filter(function (r) {
      var id = recordIdentity(key, r);
      return !(id && conf[id]);
    });
  }
  /* The tombstone map a push writes: the cloud's current entries
     (minus our in-flight keep-revocations), unioned with our
     accepted set and any deletes this very push authored — a
     rolled-back doc can never undelete, because every holder
     re-asserts the tombstones it accepted. */
  function computeDelUnion(key, cloudDel, authored) {
    var m = getMeta();
    var acc = cloneDelMap(m.dels && m.dels[key]);
    var rev = (m.delRev && m.delRev[key]) || {};
    var write = {};
    Object.keys(cloudDel || {}).forEach(function (id) {
      if (!rev[id]) write[id] = (cloudDel[id] && typeof cloudDel[id] === 'object')
        ? { t: Number(cloudDel[id].t) || 0, fp: cloudDel[id].fp || null } : { t: 0, fp: null };
    });
    Object.keys(acc).forEach(function (id) { write[id] = acc[id]; });
    if (authored) Object.keys(authored).forEach(function (id) {
      write[id] = authored[id]; acc[id] = authored[id];
    });
    return { write: write, accepted: acc };
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

  /* web403: the user's ruling on one surfaced disagreement.
     keep=true: the record stays; the tombstone is revoked
     (m.delRev) and this device's next push restores the record
     to the cloud list and clears the doc's entry — the keeper's
     choice propagates like the delete did. keep=false: the
     tombstone is accepted and the local copy dropped here too.
     Either way the choice is cleared and a sync runs. */
  S.resolveDelConflict = function (key, id, keep) {
    try {
      if (!RECORD_LIST_KEYS[key]) return false;
      var m = getMeta();
      var conf = (m.delConf || []).slice(), idx = -1;
      for (var i = 0; i < conf.length; i++) {
        if (conf[i].key === key && conf[i].id === id) { idx = i; break; }
      }
      if (idx < 0) return false;
      var c = conf[idx];
      conf.splice(idx, 1);
      m.delConf = conf;
      var km = keyMeta(key);
      if (keep) {
        if (!m.delRev) m.delRev = {};
        if (!m.delRev[key]) m.delRev[key] = {};
        m.delRev[key][id] = Date.now();
      } else {
        if (!m.dels) m.dels = {};
        if (!m.dels[key]) m.dels[key] = {};
        m.dels[key][id] = { t: c.t || Date.now(), fp: c.fp || null };
        var arr = parseJson(lsGetRaw(key), null);
        if (Array.isArray(arr)) {
          var kept = arr.filter(function (r) { return recordIdentity(key, r) !== id; });
          if (kept.length !== arr.length) lsSetRaw(key, JSON.stringify(kept));
        }
      }
      /* stamp the key so the ruling itself ships on this flush */
      km.t = Date.now(); km.u = S.uid;
      saveMeta();
      try { S.syncNow(); } catch (e) {}
      return true;
    } catch (e) { return false; }
  };

  /* web406 (DELETE-PRETOMBSTONE-NOV10): the disagreements the
     tombstone layer cannot see, because the deletion PREDATES
     tombstones. The $695.98 revenue record was deleted Nov 10,
     08:05 by a pre-404 client: its write carried no del entry,
     so on the holder's next pull the absence matches NO 404
     path — processCloudDels reads only the doc's del map
     (empty), pendingRecordDeletes needs the id PRESENT in the
     cloud list (it is absent) — and the union's never-lose law
     re-writes the record into the cloud on the holder's own
     push: the deletion is silently undone, forever (bench:
     the world-E replay). A rolled-back cloud copy (world B)
     presents the IDENTICAL stored signature — local ∧
     agreed-shadow ∧ ¬cloud, no tombstone — and there is NO
     distinguishing signal in the stored data; per the owner's
     ruling (Nov 10, 10:11 — "if they disagree the option to
     delete has to be there") the CHOICE ITSELF is the
     resolution: the disagreement is offered on the device
     that still holds the record (m.orphans → status() →
     Preferences sync card), nothing is ever auto-deleted,
     Delete authors the tombstone web 404 would have written,
     and Keep stands the record (the union already restores
     it — never-lose honoured by his choice, not by silence).
     The mirror shape rides the same surface: records the
     pending-delete honor EXCLUDES (shadow ∧ cloud ∧ ¬local —
     the Nov 10 Documents case: filed to the account, verified
     in the cloud book, yet the phone's vault read empty
     because its shadow remembered them as its own pending
     deletion and every union kept them out — and a 404 push
     would tombstone them account-wide without anyone ruling).
     A fresh deliberate pending delete converges by push
     within a cycle; one still excluded on a LATER pull has
     survived a push round, so it is offered the same way:
     Keep revokes the exclusion (the shadow entry is dropped
     and the union lands the record), Delete tombstones it.
     m.orphanKeep { key: { id: ms } } marks a ruled Keep so the
     same standing absence is not re-offered; the mark clears
     when the record is back in the cloud list (agreement
     restored), so a future absence offers afresh.
     m.pdSeen { key: { id: ms } } is the first-sight book for
     exclusions (offer only on a repeat sighting). */
  function detectOrphans(key, rlLocal, cloudArr, cloudDel, shadowIn, kmSIn) {
    var m = getMeta();
    var cloudIds = {}, i, id;
    (cloudArr || []).forEach(function (r) { var rid = recordIdentity(key, r); if (rid) cloudIds[rid] = 1; });
    var shadowSet = {};
    (shadowIn || []).forEach(function (sid) { shadowSet[sid] = 1; });
    var delMap = (m.dels && m.dels[key]) || {};
    var conf = conflictIdSet(key);
    var orphans = (m.orphans || []).slice();
    var dirty = false;
    function hasOrphan(rid) {
      for (var j = 0; j < orphans.length; j++) if (orphans[j].key === key && orphans[j].id === rid) return true;
      return false;
    }
    /* keep-marks clear when agreement is restored (the record
       is back in the cloud list) — a future absence is a new
       disagreement and offers afresh */
    if (m.orphanKeep && m.orphanKeep[key]) {
      Object.keys(m.orphanKeep[key]).forEach(function (kid) {
        if (cloudIds[kid]) { delete m.orphanKeep[key][kid]; dirty = true; }
      });
      if (!Object.keys(m.orphanKeep[key]).length) { delete m.orphanKeep[key]; dirty = true; }
    }
    var keepMarks = (m.orphanKeep && m.orphanKeep[key]) || {};
    /* moot offers clear: a held record the user removed by
       hand in the module, an excluded record that landed or
       left the cloud story */
    orphans = orphans.filter(function (o) {
      if (!o || o.key !== key) return true;
      if (o.kind === 'excluded') {
        if (findRecordById(key, rlLocal, o.id)) { dirty = true; return false; }
        if (!cloudIds[o.id]) { dirty = true; return false; }
        return true;
      }
      if (!findRecordById(key, rlLocal, o.id)) { dirty = true; return false; }
      return true;
    });
    /* HELD: held here, once agreed, gone from the cloud with
       no tombstone — the pre-tombstone deletion shape */
    (rlLocal || []).forEach(function (rec) {
      var rid = recordIdentity(key, rec);
      if (!rid || !shadowSet[rid]) return;
      if (cloudIds[rid]) return;
      if (cloudDel && cloudDel[rid]) return;   // the tombstone world (web403) owns it
      if (delMap[rid] || conf[rid]) return;
      if (keepMarks[rid]) return;               // he ruled keep on this standing absence
      if (hasOrphan(rid)) return;
      /* no local edit past the agreed state: an fp identity
         IS the content fingerprint, so it cannot have been
         edited; for id/dsp identities an updatedAt newer than
         the last agreed stamp is the only edit evidence there
         is — such a record is never offered (the union keeps
         it; never-lose). */
      if (rid.indexOf('fp:') !== 0 && typeof rec.updatedAt === 'number' && rec.updatedAt > (kmSIn || 0)) return;
      orphans.push({ key: key, id: rid, kind: 'held', t: Date.now(),
                     fp: recordContentFp(key, rec), label: recordLabel(key, rec) });
      dirty = true;
    });
    /* EXCLUDED: in the cloud, once agreed, absent here — the
       pending-delete honor is keeping it out. Offered only
       when the exclusion survives to a repeat pull. */
    var pd = {};
    if (m.pdSeen && m.pdSeen[key]) Object.keys(m.pdSeen[key]).forEach(function (pid) { pd[pid] = m.pdSeen[key][pid]; });
    var pdDirty = false, seenNow = {};
    (cloudArr || []).forEach(function (rec) {
      var rid = recordIdentity(key, rec);
      if (!rid || !shadowSet[rid]) return;
      if (findRecordById(key, rlLocal, rid)) return;
      if (cloudDel && cloudDel[rid]) return;
      if (delMap[rid] || conf[rid]) return;
      seenNow[rid] = 1;
      if (hasOrphan(rid)) return;
      if (pd[rid]) {
        orphans.push({ key: key, id: rid, kind: 'excluded', t: Date.now(),
                       fp: null, label: recordLabel(key, rec) });
        dirty = true;
      } else { pd[rid] = Date.now(); pdDirty = true; }
    });
    Object.keys(pd).forEach(function (pid) { if (!seenNow[pid]) { delete pd[pid]; pdDirty = true; } });
    if (dirty) { if (orphans.length) m.orphans = orphans; else delete m.orphans; }
    if (pdDirty) {
      if (!m.pdSeen) m.pdSeen = {};
      if (Object.keys(pd).length) m.pdSeen[key] = pd; else delete m.pdSeen[key];
    }
    if (dirty || pdDirty) saveMeta();
  }

  /* web406: the user's ruling on one pre-tombstone
     disagreement. held + keep: the record stands (the union
     restores it to the cloud — never-lose by his choice) and
     the absence is marked ruled so it is not re-offered.
     held + delete: the local copy is dropped here and the
     tombstone is accepted with the local copy's fingerprint,
     so every holder drops it and no push resurrects it.
     excluded + keep: the exclusion is revoked (the shadow
     entry is dropped) and the next pull's union lands the
     record on this device. excluded + delete: the tombstone
     is authored (fp null — no local copy exists to conflict)
     and the pushes converge the account on deleted. Either
     way the offer clears and a sync runs. */
  S.resolveOrphan = function (key, id, keep) {
    try {
      if (!RECORD_LIST_KEYS[key]) return false;
      var m = getMeta();
      var orphans = (m.orphans || []).slice(), idx = -1;
      for (var i = 0; i < orphans.length; i++) {
        if (orphans[i].key === key && orphans[i].id === id) { idx = i; break; }
      }
      if (idx < 0) return false;
      var o = orphans[idx];
      orphans.splice(idx, 1);
      if (orphans.length) m.orphans = orphans; else delete m.orphans;
      var km = keyMeta(key);
      if (o.kind === 'excluded') {
        if (km.sh) km.sh = km.sh.filter(function (x) { return x !== id; });
        if (m.pdSeen && m.pdSeen[key]) delete m.pdSeen[key][id];
        if (!keep) {
          if (!m.dels) m.dels = {};
          if (!m.dels[key]) m.dels[key] = {};
          m.dels[key][id] = { t: Date.now(), fp: null };
        }
      } else if (keep) {
        if (!m.orphanKeep) m.orphanKeep = {};
        if (!m.orphanKeep[key]) m.orphanKeep[key] = {};
        m.orphanKeep[key][id] = Date.now();
      } else {
        var arr = parseJson(lsGetRaw(key), null);
        var rec = Array.isArray(arr) ? findRecordById(key, arr, id) : null;
        if (!m.dels) m.dels = {};
        if (!m.dels[key]) m.dels[key] = {};
        m.dels[key][id] = { t: Date.now(), fp: rec ? recordContentFp(key, rec) : (o.fp || null) };
        if (Array.isArray(arr)) {
          var kept = arr.filter(function (r) { return recordIdentity(key, r) !== id; });
          if (kept.length !== arr.length) lsSetRaw(key, JSON.stringify(kept));
        }
      }
      /* stamp the key so the ruling itself ships on this flush */
      km.t = Date.now(); km.u = S.uid;
      saveMeta();
      try { S.syncNow(); } catch (e) {}
      return true;
    } catch (e) { return false; }
  };

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
    /* v279: a REPEAT pull (this uid already pulled in this page
       session) additionally waits out REPEAT_PULL_GAP_MS — the
       first pull for a uid always runs at once, so a cold start
       or a fresh sign-in restores immediately; only the
       watchdog's convergence re-reads are spaced out. */
    if (S.pulledUid === S.uid && S.lastPullAt > 0 &&
        Date.now() - S.lastPullAt < REPEAT_PULL_GAP_MS) {
      return Promise.resolve({ applied: 0 }); // convergence pull not due yet
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
      /* v288 (REWORK2): snapshot the watched keys' local values
         before the merge pass — the after-pull diff below is
         what tells the shell a heal actually landed. */
      var teleBefore = {};
      try {
        ['livemiles', 'geoloads', 'tracker'].forEach(function (wk) {
          teleBefore[wk] = lsGetRaw(wk);
        });
      } catch (e) {}
      docs.forEach(function (d) {
        var key = d.mt || d.id;
        if (!isSyncable(key)) return;
        cloudKeys[key] = true;
        var cloudTs = cloudTsMillis(d.updatedAt) || now;
        var km = keyMeta(key);
        var raw = lsGetRaw(key);
        var localDirty = (km.t || 0) > (km.s || 0);
        var cloudChanged = cloudTs > (km.s || 0);

        /* v296: inventory the telemetry cloud docs as they
           actually are — field names + real sizes, top-level
           and per-day — on EVERY pull, whichever branch below
           handles the key. This is the read three sync passes
           never had: what the account's livemiles / geoloads
           documents truly carry. */
        if ((key === 'livemiles' || key === 'geoloads') &&
            d.v && typeof d.v === 'object' && d.v.days && typeof d.v.days === 'object') {
          try { noteCloudInv(key, teleInventory(d.v)); } catch (e) {}
        }

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
            /* v296: the learn decision rides the merge's change
               flag (v296 note at mergeTelemetryDays) — two
               full-value serializations per pull per telemetry
               key were part of the churn that ghosted the page. */
            var teleFlags = {};
            var teleMerged = mergeTelemetryDays(key, teleLocal, d.v, teleFlags);
            if (teleFlags.changed) {
              lsSetRaw(key, JSON.stringify(teleMerged));
              applied++;
            }
            /* v293: compare the SYNC COPY against the cloud doc —
               a full-trail local value whose thinned copy IS the
               cloud state once the push has landed; comparing the
               full value would keep the key dirty forever and
               re-push the whole history every cycle. */
            if (telemetryCopyJson(key, teleMerged) !== JSON.stringify(d.v)) {
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
           above) — runs before the generic whole-key rules;
           a stamp outcome never deletes a record from these
           keys. v272: the union now runs in DIRTY cycles too —
           the settled-only gate was the recurrence hole (see
           mergeRecordLists3) — and the per-key shadow (km.sh)
           carries this device's pending deletions through it.
           The recorded-owner guard stands: another account's
           local records never union into this account's tree. */
        if (RECORD_LIST_KEYS[key] && raw !== null && Array.isArray(d.v) &&
            !(km.u && S.uid && km.u !== S.uid)) {
          var rlLocal = parseJson(raw, undefined);
          if (Array.isArray(rlLocal)) {
            /* web406: the agreed state as this pull FOUND it —
               the orphan detector's evidence (the branch tail
               rewrites km.sh/km.s, so capture both first). */
            var shadowIn406 = (km.sh || []).slice();
            var kmSIn406 = km.s || 0;
            /* web406 (DOCUMENTS-HELD-OUT-NOV10): the shadow the
               merge may use. The pending-delete honor exists
               for an IN-FLIGHT delete — a local write this
               device has not pushed yet, which is exactly a
               DIRTY key (km.t > km.s; attach()'s store.set
               wrapper stamps every local write). On a SETTLED
               key there is no delete in flight, so a shadow id
               the cloud still holds but the local list lacks
               is not a pending deletion — it is spent
               bookkeeping (the Nov 10 shape: the phone's vault
               read "No documents yet" while its shadow named
               the two filed CVSA documents, and every union
               kept them out; a landed push would even have
               tombstoned them account-wide). Spent ids are
               pruned from the merge shadow on a settled key,
               so the union lands the account's records again.
               A fresh deliberate delete is dirty by
               construction and is never pruned. */
            var shadowForMerge406 = shadowIn406;
            if ((km.t || 0) <= (km.s || 0)) {
              var cloudIdSet406 = {}, localIdSet406 = {};
              d.v.forEach(function (r) { var rid = recordIdentity(key, r); if (rid) cloudIdSet406[rid] = 1; });
              rlLocal.forEach(function (r) { var rid = recordIdentity(key, r); if (rid) localIdSet406[rid] = 1; });
              var pruned406 = shadowIn406.filter(function (sid) {
                return !(cloudIdSet406[sid] && !localIdSet406[sid]);
              });
              if (pruned406.length !== shadowIn406.length) {
                shadowForMerge406 = pruned406;
                km.sh = pruned406.slice();
              }
            }
            /* web403 (DELETE-STICKINESS-NOV10): the tombstone
               layer rides the same union. The merge runs with
               its flags out — deletions this merge applies for
               THIS device are tombstoned into the accepted set
               at once. The doc's own `del` field is then
               processed (accept / conflict / revoke-forget),
               and the final local list is the union with
               accepted tombstones applied and undecided records
               exempt. The dirty compare below runs on the CLOUD
               VIEW of that list — undecided records stripped:
               held back from the cloud until the user decides,
               so an undecided cycle stays dirty and the flush's
               own hold-back keeps them out of the write. */
            var delFlags = {};
            var rlMerged = mergeRecordLists3(key, rlLocal, d.v, shadowForMerge406, delFlags);
            var authP = authoredTombs(key, delFlags, d.v);
            if (authP) acceptDels(key, authP);
            processCloudDels(key, (d.del && typeof d.del === 'object') ? d.del : {},
              rlLocal, d.v, rlMerged, cloudTs);
            var rlFinal = applyDelFilter(key, rlMerged, rlLocal);
            var rlView = stripConflictHeld(key, rlFinal);
            if (JSON.stringify(rlFinal) !== JSON.stringify(rlLocal)) {
              lsSetRaw(key, JSON.stringify(rlFinal));
              applied++;
            }
            /* v289: compare the SYNC COPY against the cloud doc —
               a photo-bearing local book's stripped copy IS the
               cloud state once the push has landed; comparing the
               full array would keep the key dirty forever and
               re-push the whole book every cycle. */
            if (syncCopyJson(key, rlView) !== JSON.stringify(d.v)) {
              /* the union holds records the cloud lacks — keep
                 the key dirty so the flush pushes the union UP.
                 The shadow names the cloud state just verified,
                 VERBATIM: a pending deletion must stay visible
                 to the push's own merge (in the shadow, absent
                 locally, still in the cloud) until a landed
                 write confirms it — advancing the shadow past
                 it here would make the push resurrect it. */
              km.t = Math.max(cloudTs, now); km.s = cloudTs;
              km.sh = recordIdList(key, d.v);
            } else {
              km.t = cloudTs; km.s = cloudTs;
              /* web403: the clean shadow names what this device
                 now holds — the tombstone-filtered list — so a
                 settled tombstone can never re-fire as a fresh
                 pending delete on a later cycle. */
              km.sh = recordIdList(key, rlFinal);
            }
            /* web406 (DELETE-PRETOMBSTONE-NOV10): surface the
               disagreements no tombstone can name — records a
               pre-tombstone deletion removed from the cloud
               while this device still holds them, and records
               this device's own shadow is holding out of its
               lists. Detection only: the union above already
               ran exactly as before (never-lose untouched). */
            try {
              detectOrphans(key, rlLocal, d.v,
                (d.del && typeof d.del === 'object') ? d.del : {},
                shadowIn406, kmSIn406);
            } catch (e) {}
            return;
          }
        }

        /* v361 (MORNING-LEG, owner Nov 7, 2026 08:50–08:54): two
           copies of the SAME session must show the same pause
           state on every client — and the stamp game below cannot
           promise it. A running session's periodic re-save
           re-stamps its key every minute (js/app.js v220), so a
           second client's RUNNING echo of the day (a restored
           browser session that auto-started the same 8:00 AM
           dispatch) keeps out-stamping the phone's deliberate
           PAUSE: on Nov 7 the phone sat paused at the pickup peg
           while the account copy ticked on "running" — one day,
           two faces, both "All synced". The copies now carry
           stateAt (js/app.js v361): the moment of the last
           DELIBERATE transition (start / pause / resume / stop /
           edit), set only at transition sites and never by the
           tick re-save. When both copies name the same session
           (pins within the v271 whole-second jitter family,
           ±5000 ms — two clients that auto-started the same plan
           pin a few hundred ms apart) and both carry a stateAt,
           the LATER deliberate state wins, before pin order
           (v265) and before stamps: the cloud's installs when its
           transition is newer; the local stands — tombstone
           idiom, flush pushes it UP — when the local's is.
           Different sessions (pins beyond the jitter) fall
           through to v265 untouched, as do copies from clients
           too old to carry stateAt. */
        if (key === 'tracker' && raw !== null && d.v &&
            typeof d.v === 'object' && !Array.isArray(d.v)) {
          var sa361Local = parseJson(raw, null);
          if (sa361Local && typeof sa361Local === 'object' && !Array.isArray(sa361Local)) {
            var sa361SidL = Number(sa361Local.sessionId) || 0;
            var sa361SidC = Number(d.v.sessionId) || 0;
            var sa361L = Number(sa361Local.stateAt) || 0;
            var sa361C = Number(d.v.stateAt) || 0;
            if (sa361SidL > 0 && sa361SidC > 0 &&
                Math.abs(sa361SidL - sa361SidC) <= 5000 &&
                sa361L > 0 && sa361C > 0 && sa361L !== sa361C) {
              /* v365 (TIMER-STOPPED-BY-ITSELF, owner Nov 7,
                 2026 10:49 — stated twice, plainly: "No, I
                 never press stop or pause. It stop by
                 itself."): a cloud copy may NEVER pause or
                 stop a locally RUNNING session, whatever its
                 stateAt claims. The stamp is not proof of a
                 tap: the record-adoption path (js/app.js
                 adoptSessionRecord) stamped ADOPTED states
                 into t.stateAt, so a pause manufactured by an
                 echo (a second client's copy landing in the
                 phone's native record with the echo's young
                 clock — the web 363 trace) could mint itself a
                 "deliberate" stamp and then win HERE on stamp
                 order alone. js/app.js v365 closes the mint;
                 this rule closes the road for every copy
                 already minted: when the local copy is
                 RUNNING and the cloud's is not, the local
                 stands — tombstone idiom, the flush pushes
                 the running truth UP. Every other direction
                 arbitrates by stateAt exactly as v361 wrote it
                 (a later deliberate RESUME still installs over
                 a local pause; a later deliberate CLOSE still
                 installs over a local pause — neither touches a
                 running local). */
              var sa365LocalRunning = sa361Local.status === 'running';
              var sa365CloudRunning = d.v.status === 'running';
              if (sa365LocalRunning && !sa365CloudRunning) {
                meta.keys[key] = { t: now, s: cloudTs };
                return;
              }
              if (sa361C > sa361L) {
                lsSetRaw(key, JSON.stringify(d.v));
                meta.keys[key] = { t: cloudTs, s: cloudTs };
                applied++;
              } else {
                meta.keys[key] = { t: now, s: cloudTs };
              }
              return;
            }
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

        /* v271 (PHANTOM-RESURRECTION): a close is a tombstone.
           The identity rule above cannot fire once this layer's
           tracker is CLOSED: stopSessionAt resets it to a fresh
           idle object with no sessionId, so a cloud copy of the
           same session still marked RUNNING (the close never
           flushed up, or another client re-pushed the running
           copy — Oct 26: the phone's close sat local-only while
           the account copy kept running) met a sid-less local
           and the stamp game below could install the running
           copy back over the deliberate close. Sessions never
           reopen, so a locally CLOSED session is the truth: if
           the local sessions list holds a finished entry whose
           own start (endedAt − seconds) names the cloud copy's
           session (within whole-second jitter, the v69 pin
           tolerance), the cloud copy is that session's stale
           echo — keep the local idle and mark the key dirty so
           the flush pushes the close UP and the account
           converges on closed. Fires only with a local idle
           tracker value actually present. */
        if (key === 'tracker' && raw !== null && d.v &&
            typeof d.v === 'object' && !Array.isArray(d.v)) {
          var tb271Sid = Number(d.v.sessionId) || 0;
          var tb271Live = d.v.status === 'running' || d.v.status === 'paused';
          var tb271Local = parseJson(raw, null);
          var tb271Idle = !tb271Local || typeof tb271Local !== 'object' ||
            Array.isArray(tb271Local) || !tb271Local.status ||
            tb271Local.status === 'idle';
          if (tb271Sid > 0 && tb271Live && tb271Idle) {
            var tb271Sessions = parseJson(lsGetRaw('sessions'), null);
            if (Array.isArray(tb271Sessions)) {
              for (var tb271i = 0; tb271i < tb271Sessions.length; tb271i++) {
                var tb271e = tb271Sessions[tb271i];
                if (!tb271e || !tb271e.endedAt || !(Number(tb271e.seconds) > 0)) continue;
                var tb271Start = Date.parse(tb271e.endedAt) - Number(tb271e.seconds) * 1000;
                if (isFinite(tb271Start) && Math.abs(tb271Start - tb271Sid) <= 5000) {
                  meta.keys[key] = { t: now, s: cloudTs };
                  return;
                }
              }
            }
          }
        }

        /* v303 (PHANTOM-REVIVAL-OCT31): the tombstone above needs
           a FINISHED twin in the local sessions list. A ghost that
           was never stopped on any client (Oct 30 08:00's plan
           auto-start: no stop ever ran on it, so no finished entry
           exists anywhere) slips past that rule, and the generic
           stamp game below could install its RUNNING cloud copy
           over a deliberate idle — on Oct 31 at 19:09 the phone
           painted "Working..." at 35:09 elapsed over a day that
           had closed at 14:20 and been cloud-verified at 18:05.
           Two identity proofs now bury such a copy without ever
           installing it:
           (a) DISCARD MARKER — this device already discarded that
               very session (the local idle carries discardedSid
               naming it, js/app.js healStaleTracker): the ghost
               is dead by name, whatever stamp it arrives with.
           (b) STALE SHELL — the copy's pinned start passes
               staleSessionMs303 (previous local day AND >= 20 h
               old): an echo, not work.
           Either way the local value stands and the key stays
           dirty ({ t: now, s: cloudTs } — the tombstone idiom) so
           the flush pushes the local truth UP and the account
           converges on it. A live copy naming the SAME session
           as the local live tracker is untouched (same-session
           edits arbitrate exactly as before), and a young or
           same-day cloud session still installs exactly as
           before (the v52 restore case). Fires only with a
           parseable local tracker value present. */
        if (key === 'tracker' && raw !== null && d.v &&
            typeof d.v === 'object' && !Array.isArray(d.v)) {
          var rv303Sid = Number(d.v.sessionId) || 0;
          var rv303Live = d.v.status === 'running' || d.v.status === 'paused';
          if (rv303Sid > 0 && rv303Live) {
            var rv303Local = parseJson(raw, null);
            if (rv303Local && typeof rv303Local === 'object' && !Array.isArray(rv303Local)) {
              var rv303LocalSid = Number(rv303Local.sessionId) || 0;
              var rv303LocalLive = rv303Local.status === 'running' || rv303Local.status === 'paused';
              var rv303Same = rv303LocalLive && rv303LocalSid === rv303Sid;
              if (!rv303Same) {
                var rv303Discarded = Number(rv303Local.discardedSid) === rv303Sid;
                if (rv303Discarded || staleSessionMs303(rv303Sid, now)) {
                  meta.keys[key] = { t: now, s: cloudTs };
                  return;
                }
              }
            }
          }
        }

        /* v352 (PHONE-TIMER-RUNS-AFTER-WEB-CLOSE, owner Nov 5,
           20:02): the mirror image of the v271 tombstone — and
           the one shape none of the rules above covered. The
           LOCAL tracker is the live one (the phone, still
           working its day) and the CLOUD copy is the closed day
           (the web session's End-shift: an idle tracker, no
           sessionId). v265 needs a cloud sessionId to compare,
           v271 needs an idle LOCAL, v303 needs a live CLOUD —
           so the phone's copy fell to the stamp game below,
           where its own ticking re-stamps made it unbeatable:
           the books showed the day closed (sessions union) while
           the phone's timer ran on (11:02:52 and counting at
           20:02, the day closed at 18:00). The booked truth is
           the same test v271 runs, from the other chair: if the
           local sessions list holds a FINISHED entry whose own
           start names the local live session (within the v69
           jitter), the account has closed this day — install
           the cloud's idle copy with clean stamps. The app's
           own healClosedTracker (js/app.js) stands the engines
           and the widget down on its tick; this rule makes the
           store itself converge at pull time. */
        if (key === 'tracker' && raw !== null && d.v &&
            typeof d.v === 'object' && !Array.isArray(d.v)) {
          var ct352CloudLive = d.v.status === 'running' || d.v.status === 'paused';
          var ct352Local = parseJson(raw, null);
          if (!ct352CloudLive && ct352Local && typeof ct352Local === 'object' &&
              !Array.isArray(ct352Local) &&
              (ct352Local.status === 'running' || ct352Local.status === 'paused')) {
            var ct352Sid = Number(ct352Local.sessionId) || 0;
            if (ct352Sid > 0) {
              var ct352Sessions = parseJson(lsGetRaw('sessions'), null);
              if (Array.isArray(ct352Sessions)) {
                for (var ct352i = 0; ct352i < ct352Sessions.length; ct352i++) {
                  var ct352e = ct352Sessions[ct352i];
                  if (!ct352e || !ct352e.endedAt || !(Number(ct352e.seconds) > 0)) continue;
                  var ct352Start = Date.parse(ct352e.endedAt) - Number(ct352e.seconds) * 1000;
                  if (isFinite(ct352Start) && Math.abs(ct352Start - ct352Sid) <= 5000) {
                    lsSetRaw(key, JSON.stringify(d.v));
                    meta.keys[key] = { t: cloudTs, s: cloudTs };
                    applied++;
                    return;
                  }
                }
              }
            }
          }
        }

        /* v411 (CLOSE-SHUTS-TIMER, owner Nov 9 + Nov 10, in his
           hands twice after v352 shipped): the closed state wins
           over ANY local running state at sync — the general law
           the v271/v303/v352 rules each cover one shape of. All
           three older rules read the LOCAL sessions list only,
           so each missed the Nov 9/10 shape end to end: the
           close-out landed on a surface whose tracker was idle,
           booking the day as a COMPLETED DISPATCH (no sessions
           entry at all — proof (2) in closedProof411), or the
           finished entry existed only in the pull's OWN incoming
           sessions doc, which the per-key forEach had not
           applied yet when the tracker doc was judged (the
           tracker is judged against a local list that does not
           hold the close, falls to the stamp game, and its own
           ticking re-stamps win — the running copy then pushes
           UP over the account's closed day). This rule therefore
           judges the tracker against the UNION of the local
           lists and this pull's incoming docs for sessions /
           dsp_list / dsp_active, and settles every posture:
             - local LIVE + cloud idle: install the idle (the
               v352 outcome, on the widened evidence);
             - local LIVE + cloud live (the same session's echo,
               pins within the jitter family, or a pin-less
               copy): the local tracker goes IDLE in the
               stopSessionAt reset shape and the key stays dirty
               — tombstone idiom — so the flush pushes the close
               UP and the account converges on closed;
             - local IDLE + cloud live: the running copy is
               refused (the v271 outcome, on the widened
               evidence) and the key stays dirty the same way.
           A cloud live copy naming a DIFFERENT session (pins
           beyond the jitter family) is untouched here — v265's
           later-session rule and the generic game arbitrate it
           exactly as before. */
        if (key === 'tracker' && raw !== null && d.v &&
            typeof d.v === 'object' && !Array.isArray(d.v)) {
          var cd411Local = parseJson(raw, null);
          var cd411CloudLive = d.v.status === 'running' || d.v.status === 'paused';
          var cd411CloudSid = Number(d.v.sessionId) || 0;
          var cd411LocalLive = !!(cd411Local && typeof cd411Local === 'object' &&
            !Array.isArray(cd411Local) &&
            (cd411Local.status === 'running' || cd411Local.status === 'paused'));
          var cd411LocalSid = cd411LocalLive ? (Number(cd411Local.sessionId) || 0) : 0;
          var cd411JudgeSid = cd411LocalLive ? cd411LocalSid : cd411CloudSid;
          var cd411SameEcho = !cd411CloudLive || cd411CloudSid === 0 ||
            !cd411LocalLive || Math.abs(cd411CloudSid - cd411LocalSid) <= 5000;
          if (cd411JudgeSid > 0 && cd411SameEcho &&
              (cd411LocalLive || cd411CloudLive)) {
            var cd411Sessions = parseJson(lsGetRaw('sessions'), null) || [];
            var cd411DspL = parseJson(lsGetRaw('dsp_list'), null) || [];
            var cd411DspA = parseJson(lsGetRaw('dsp_active'), null);
            docs.forEach(function (dd) {
              var kk411 = dd.mt || dd.id;
              if (kk411 === 'sessions' && Array.isArray(dd.v)) cd411Sessions = cd411Sessions.concat(dd.v);
              else if (kk411 === 'dsp_list' && Array.isArray(dd.v)) cd411DspL = cd411DspL.concat(dd.v);
              else if (kk411 === 'dsp_active' && dd.v && typeof dd.v === 'object' && !Array.isArray(dd.v)) cd411DspA = dd.v;
            });
            if (closedProof411(cd411Sessions, cd411DspL, cd411DspA, cd411JudgeSid)) {
              if (cd411LocalLive && !cd411CloudLive) {
                lsSetRaw(key, JSON.stringify(d.v));
                meta.keys[key] = { t: cloudTs, s: cloudTs };
                applied++;
              } else if (cd411LocalLive) {
                lsSetRaw(key, JSON.stringify({ status: 'idle', startTs: 0, elapsed: 0, stateAt: now }));
                meta.keys[key] = { t: now, s: cloudTs };
                applied++;
              } else {
                meta.keys[key] = { t: now, s: cloudTs };
              }
              return;
            }
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
      /* v288 (REWORK2): the pull landed — if it changed a
         watched key, tell the subscribers NOW (engine adoption
         + native facts refresh ride this; see S.onAfterPull). */
      try {
        var teleChanged = [];
        ['livemiles', 'geoloads', 'tracker'].forEach(function (wk) {
          if (teleBefore[wk] !== lsGetRaw(wk)) teleChanged.push(wk);
        });
        fireAfterPull(teleChanged);
      } catch (e) {}
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
      /* v296: the telemetry diagnostics (last push attempt per
         telemetry key + the cloud docs' real field inventory) —
         the Advanced troubleshooting readout paints from this. */
      teleDiag: diagSnapshot(),
      /* web403: delete disagreements awaiting the user's choice
         (Preferences → Advanced renders them with both buttons).
         Information only — never a dot input: an undecided
         record must not paint the sync dot red. */
      delConflicts: (m.delConf || []).slice(),
      /* web406: pre-tombstone disagreements awaiting the
         user's choice (same card, same two-button ruling). */
      orphans: (m.orphans || []).slice(),
      lastError: S.lastError, stats: S.stats
    };
  };
})();
