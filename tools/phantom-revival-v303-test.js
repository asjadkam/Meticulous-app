#!/usr/bin/env node
/* Meticulous v303 — PHANTOM-REVIVAL-OCT31 (owner screen recording,
 * Sat Oct 31, 2026, 19:09 MDT). Hours after his Oct 31 day CLOSED
 * (dispatch complete, post-trip PTI 14:20, 7 h / $203 booked and
 * cloud-verified at 18:05: 151.8 km, 170,749 → 170,951, loads 3),
 * and after a 17:53 video showed "Ready to work · 00:00:00" with a
 * GREEN dot, the phone painted the tracker "Working..." again:
 * elapsed 35:09:15 AND COUNTING, "Counting from 8:00 AM",
 * Miles (live) 0.1 km, screen held, sync dot AMBER.
 *
 * The running session is the Fri Oct 30 08:00:00 plan auto-start
 * (the standing 8:00 AM fallback; its pinned sessionId is that
 * instant, its startOdo is Oct 30's pre-trip 170,664 and its live
 * miles the 0.1 km fragment that posed as the manifest stub all
 * week). No stop ever ran on it on any client, so it exists only
 * as a LIVE copy of the synced `tracker` record — never as a
 * finished `sessions` entry.
 *
 * Why v271 could not bury it:
 *  - The pull tombstone (cloudsync) fires only when the LOCAL
 *    sessions list holds a FINISHED entry naming the cloud copy's
 *    session. A never-closed ghost has no finished twin anywhere
 *    (Oct 30's finished entry is the day's REAL session, started
 *    ~07:23), so the tombstone stays silent and the generic stamp
 *    game installs the ghost's RUNNING copy over the phone's idle
 *    whenever the cloud copy carries the newer stamp.
 *  - init()/onAuth then do exactly what they are built to do with
 *    a restored running session: fold the closed time into its
 *    clock (hence 35:09 and counting), re-attach the miles engine
 *    and restart the native recording service (hence "Screen
 *    held") — a faithful revival of a session that should never
 *    have been installed.
 *  - adoptSessionRecord was never the door (idle layer + newer
 *    record heals; the v271 fixtures prove it), and checkAutoStart
 *    cannot mint it (it stamps TODAY's plan time only).
 *
 * The v303 law, two layers, both keyed on identity:
 *  (1) js/app.js healStaleTracker — at boot (before the relaunch
 *      fold + reattach) and on both onAuth tracker reloads: a
 *      live tracker whose pinned start is on a PREVIOUS local day
 *      AND >= 20 h old is a stale shell; it is discarded WITHOUT
 *      booking (no stopSessionAt, no sessions entry, no revenue —
 *      a stop on this span would book ~35.16 h ≈ $1,020 onto the
 *      closed, verified Oct 31). The idle it leaves carries
 *      discardedSid naming the ghost. Young or same-day sessions
 *      are untouched.
 *  (2) js/cloudsync.js pull, tracker key — a live cloud copy is
 *      never installed over a local value that is not that same
 *      live session when (a) the local idle's discardedSid names
 *      it, or (b) it passes the same stale-shell test. The local
 *      value stands and the key stays dirty ({ t: now, s:
 *      cloudTs }, the tombstone idiom) so the flush pushes the
 *      local truth UP and the account converges — a reinstall
 *      after the discard therefore restores the idle, never the
 *      ghost.
 *
 * Part A drives the REAL app.js regions (the v271 slice pattern)
 * for the heal; Part B drives the REAL js/cloudsync.js pull (the
 * v271 world pattern, with a fake clock) for the install refusal.
 *
 * Run: node tools/phantom-revival-v303-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const csSrc = fs.readFileSync(path.join(ROOT, 'js', 'cloudsync.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}

/* ---------- fake clock (real Oct 2026 calendar, local time) ---------- */
const RealDate = Date;
let fakeNow = 0;
function msOf(dateStr, hhmmss) {
  const dp = dateStr.split('-'), tp = hhmmss.split(':');
  return new RealDate(+dp[0], +dp[1] - 1, +dp[2], +tp[0], +tp[1], +(tp[2] || 0), 0).getTime();
}
class FakeDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fakeNow])); }
  static now() { return fakeNow; }
}
async function pump() { for (let i = 0; i < 12; i++) await new Promise(function (r) { setImmediate(r); }); }

const GHOST = msOf('2026-10-30', '08:00:00');        // the phantom's pinned start
const T_NOW = msOf('2026-10-31', '19:09:15');       // his recording
const T_TODAY8 = msOf('2026-10-31', '08:00:00');    // a legit session today
const T_YEST22 = msOf('2026-10-30', '22:00:00');    // a young previous-day start
const T_SAT6 = msOf('2026-10-31', '06:00:00');      // next-morning check for it

/* ---------- Part A: the boot/onAuth heal (real js/app.js regions) ---------- */
function sliceBetween(s, startMark, endMark, endIncl) {
  const a = s.indexOf(startMark);
  const b = s.indexOf(endMark);
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + startMark);
  return s.slice(a, endIncl ? b + endMark.length : b);
}
const regionA = sliceBetween(appSrc, 'function trackerSave() {', 'App.collectSessionRecord = collectSessionRecord;', true);
const regionB = sliceBetween(appSrc, '/* ---------------- v28: backdate', 'App.trackerToggle = function', false);
const regionCode = regionA + '\n' + regionB;

function makeBridge() {
  const rec = { status: 'idle', elapsedBase: 0, segStartMs: 0, loads: 0, loadsManual: 0,
    loadsArmed: false, loadsCorr: 0, rev: 0, updatedAt: 0, src: '', sessionKey: '' };
  function elapsedSec(now) {
    let s = rec.elapsedBase;
    if (rec.status === 'running' && rec.segStartMs > 0) s += Math.max(0, Math.floor((now - rec.segStartMs) / 1000));
    return Math.max(0, s);
  }
  function snap() {
    return { status: rec.status, elapsedBase: rec.elapsedBase, segStartMs: rec.segStartMs,
      elapsedSec: elapsedSec(fakeNow), loads: rec.loads, loadsManual: rec.loadsManual,
      loadsArmed: rec.loadsArmed, loadsCorr: rec.loadsCorr, rev: rec.rev,
      updatedAt: rec.updatedAt, src: rec.src, sessionKey: rec.sessionKey };
  }
  const syncLog = [], stoppedLog = [];
  return {
    rec: rec, syncLog: syncLog, stoppedLog: stoppedLog,
    sessionSync: function (facts) {
      syncLog.push({ baseRev: facts.baseRev, force: !!facts.force, status: facts.status, sessionKey: facts.sessionKey });
      if (!facts.force && facts.baseRev !== rec.rev) {
        const d = snap(); d.applied = false; return Promise.resolve(d);
      }
      const same = facts.status === rec.status && facts.elapsed === rec.elapsedBase &&
        (facts.startTs || 0) === rec.segStartMs && facts.loads === rec.loads &&
        facts.loadsManual === rec.loadsManual && facts.loadsArmed === rec.loadsArmed &&
        (facts.sessionKey || '') === rec.sessionKey && rec.loadsCorr === 0;
      if (same && !facts.force) { const d = snap(); d.applied = true; return Promise.resolve(d); }
      rec.status = facts.status; rec.elapsedBase = facts.elapsed; rec.segStartMs = facts.startTs || 0;
      rec.loads = facts.loads; rec.loadsManual = facts.loadsManual; rec.loadsArmed = facts.loadsArmed;
      rec.loadsCorr = 0; rec.rev += 1; rec.updatedAt = fakeNow; rec.src = 'web';
      rec.sessionKey = facts.sessionKey || '';
      const d = snap(); d.applied = true; return Promise.resolve(d);
    },
    sessionRecord: function () { return Promise.resolve(snap()); },
    sessionStopped: function (key) { stoppedLog.push(key); }
  };
}

function makeStore() {
  const data = {};
  const writes = [];
  return {
    data: data, writes: writes,
    get: function (k, d) { const r = data['mt_' + k]; return r === undefined ? d : JSON.parse(r); },
    set: function (k, v) { writes.push(k); data['mt_' + k] = JSON.stringify(v); return true; },
    del: function (k) { delete data['mt_' + k]; return true; }
  };
}

function makeWorld(store, bridge) {
  const timers = [];
  const genericEl = { value: '', classList: { add: function () {}, remove: function () {} }, onclick: null };
  const sb = {
    console: console, Promise: Promise, Date: FakeDate, JSON: JSON, Math: Math,
    setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; },
    clearTimeout: function () {},
    confirm: function () { return true; },
    closeSidebar: function () {},
    fmtClock: function (s) { return String(s); },
    todayStr: function (d) {
      d = d || new FakeDate();
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    },
    el: function () { return genericEl; },
    store: store,
    App: { tracker: null },
    trkAccum: function () {
      const t = sb.App.tracker;
      if (!t.accum) t.accum = { manualLoads: 0 };
      return t.accum;
    },
    trackerPaint: function () {},
    paintBubble: function () {},
    pushWidgetState: function () {},
    lastBubbleFacts: function () { return {}; },
    ShiftTrack: bridge
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(regionCode, sb);
  return sb;
}

const realSessions = [
  { date: '2026-10-30', endedAt: new RealDate(msOf('2026-10-30', '17:23:00')).toISOString(), seconds: 36000, liveKm: 191.2 },
  { date: '2026-10-31', endedAt: new RealDate(msOf('2026-10-31', '14:20:00')).toISOString(), seconds: 26760, liveKm: 151.8 }
];

(async function () {
  console.log('\n— A1: the field shape — a 35 h ghost restored at boot is buried UNBOOKED —');
  {
    fakeNow = T_NOW;
    const store = makeStore(), bridge = makeBridge();
    store.set('sessions', realSessions);
    store.set('entries', [{ id: 'rev-oct31', amount: 203.00 }]);
    store.writes.length = 0;
    /* the native record still holds the ghost, re-stamped recently */
    bridge.rec.status = 'running'; bridge.rec.elapsedBase = 0; bridge.rec.segStartMs = GHOST;
    bridge.rec.sessionKey = 's' + GHOST; bridge.rec.updatedAt = fakeNow; bridge.rec.src = 'native'; bridge.rec.rev = 7;
    const w = makeWorld(store, bridge);
    /* the stored shape init() restores: segment start = the
       session's own start, nothing folded yet — the fold in init
       (elapsed += now − startTs) is what makes it 35:09:15. */
    w.App.tracker = { status: 'running', startTs: GHOST, elapsed: 0, sessionId: GHOST, accum: { manualLoads: 0 } };
    w.App._sessRev = -1; w.App._lastStateAt = 0;
    ok('A1: before the heal the restored clock reads the 35:09 of his recording',
      Math.abs(w.trackerElapsedSec() - Math.floor((T_NOW - GHOST) / 1000)) <= 2,
      'elapsed=' + w.trackerElapsedSec());
    const healed = w.healStaleTracker();
    await pump();
    const t = w.App.tracker;
    ok('A1: the heal fires on the stale shell', healed === true);
    ok('A1: the tracker is idle with the ghost named in the discard marker',
      t.status === 'idle' && Number(t.discardedSid) === GHOST, 't=' + JSON.stringify(t));
    ok('A1: $0 booked — sessions and revenue stores are byte-untouched',
      !store.writes.includes('sessions') && !store.writes.includes('entries')
      && JSON.stringify(store.get('sessions', [])) === JSON.stringify(realSessions),
      'writes=' + JSON.stringify(store.writes));
    ok('A1: the ghost\u2019s native recording service is stopped',
      bridge.stoppedLog.includes('s' + GHOST), 'stopped=' + JSON.stringify(bridge.stoppedLog));
    ok('A1: the native record is healed to idle (the widget stops painting the phantom)',
      bridge.rec.status === 'idle', 'rec.status=' + bridge.rec.status);
  }

  console.log('\n— A2: a legit session from this morning is NOT buried —');
  {
    fakeNow = msOf('2026-10-31', '11:00:00');
    const store = makeStore(), bridge = makeBridge();
    const w = makeWorld(store, bridge);
    w.App.tracker = { status: 'running', startTs: fakeNow, elapsed: 0, sessionId: T_TODAY8, accum: { manualLoads: 3 } };
    w.App._sessRev = -1; w.App._lastStateAt = 0;
    store.writes.length = 0;
    const healed = w.healStaleTracker();
    await pump();
    ok('A2: the heal stays silent for a same-day session', healed === false);
    ok('A2: the session is untouched (still running, same identity, no writes)',
      w.App.tracker.status === 'running' && Number(w.App.tracker.sessionId) === T_TODAY8
      && store.writes.length === 0, 'writes=' + JSON.stringify(store.writes));
  }

  console.log('\n— A3: a young previous-day session survives (the conservative prong) —');
  {
    fakeNow = T_SAT6;   /* Sat 06:00; the session started Fri 22:00 — 8 h old */
    const store = makeStore(), bridge = makeBridge();
    const w = makeWorld(store, bridge);
    w.App.tracker = { status: 'running', startTs: fakeNow, elapsed: 0, sessionId: T_YEST22, accum: { manualLoads: 0 } };
    w.App._sessRev = -1; w.App._lastStateAt = 0;
    const healed = w.healStaleTracker();
    await pump();
    ok('A3: previous-day but only 8 h old — NOT buried', healed === false
      && w.App.tracker.status === 'running' && Number(w.App.tracker.sessionId) === T_YEST22);
  }

  console.log('\n— A4: the paused form of the ghost is buried too —');
  {
    fakeNow = T_NOW;
    const store = makeStore(), bridge = makeBridge();
    store.set('sessions', realSessions); store.writes.length = 0;
    const w = makeWorld(store, bridge);
    w.App.tracker = { status: 'paused', startTs: 0, elapsed: 126540, sessionId: GHOST, accum: { manualLoads: 0 } };
    w.App._sessRev = -1; w.App._lastStateAt = 0;
    const healed = w.healStaleTracker();
    await pump();
    ok('A4: paused stale shell buried, $0 booked',
      healed === true && w.App.tracker.status === 'idle'
      && Number(w.App.tracker.discardedSid) === GHOST && !store.writes.includes('sessions'));
  }

  console.log('\n— A5: an unpinned (pre-v69 shape) ghost is judged by its derived start —');
  {
    fakeNow = T_NOW;
    const store = makeStore(), bridge = makeBridge();
    const w = makeWorld(store, bridge);
    /* no sessionId: the derived start (now − elapsed) is Fri ~08:00 */
    w.App.tracker = { status: 'running', startTs: fakeNow, elapsed: 126540, accum: { manualLoads: 0 } };
    w.App._sessRev = -1; w.App._lastStateAt = 0;
    const healed = w.healStaleTracker();
    await pump();
    const ds = Number(w.App.tracker.discardedSid) || 0;
    ok('A5: the derived-start ghost is buried and named',
      healed === true && w.App.tracker.status === 'idle'
      && ds >= msOf('2026-10-30', '07:59:00') && ds <= msOf('2026-10-30', '08:01:00'),
      'discardedSid=' + ds);
  }

  console.log('\n— A6: an idle tracker is never touched —');
  {
    fakeNow = T_NOW;
    const store = makeStore(), bridge = makeBridge();
    const w = makeWorld(store, bridge);
    w.App.tracker = { status: 'idle', startTs: 0, elapsed: 0 };
    const healed = w.healStaleTracker();
    ok('A6: idle in, idle out, no-op', healed === false && w.App.tracker.status === 'idle');
  }

  /* ---------- Part B: the real cloudsync.js pull ---------- */
  console.log('\n— B: the pull — the ghost\u2019s cloud copy can no longer install —');
  function makeWorldB(opts) {
    const data = {};
    const localStorage = {
      getItem: function (k) { return (k in data) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); },
      removeItem: function (k) { delete data[k]; },
      key: function (i) { return Object.keys(data)[i] || null; },
      get length() { return Object.keys(data).length; }
    };
    (opts.local || []).forEach(function (kv) { data['mt_' + kv[0]] = JSON.stringify(kv[1]); });
    if (opts.meta) data['mt___syncmeta'] = JSON.stringify(opts.meta);
    const sb = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
      setInterval: setInterval, Promise: Promise, Date: FakeDate };
    sb.window = sb;
    sb.localStorage = localStorage;
    sb.navigator = { onLine: true };
    sb.document = { getElementById: function () { return null; }, addEventListener: function () {} };
    sb.addEventListener = function () {};
    const pushes = [];
    sb.FB = {
      ready: true,
      user: { uid: 'u1' },
      loadDocs: function () { return Promise.resolve(opts.docs || []); },
      saveDoc: function (col, id, doc) { pushes.push({ id: id, v: doc.v }); return Promise.resolve({}); },
      deleteDoc: function () { return Promise.resolve({}); }
    };
    sb.__pushes = pushes;
    vm.createContext(sb);
    vm.runInContext(csSrc, sb);
    const storeB = {
      get: function (k, d) { const r = localStorage.getItem('mt_' + k); return r === null ? d : JSON.parse(r); },
      set: function (k, v) { localStorage.setItem('mt_' + k, JSON.stringify(v)); return true; },
      del: function (k) { localStorage.removeItem('mt_' + k); return true; }
    };
    sb.CloudSync.attach(storeB);
    return { sb: sb, data: data, pushes: pushes,
      get: function (k) { const r = localStorage.getItem('mt_' + k); return r === null ? null : JSON.parse(r); },
      meta: function () { return JSON.parse(localStorage.getItem('mt___syncmeta') || '{}'); } };
  }
  function settle() { return new Promise(function (r) { setTimeout(r, 400); }); }
  const T_CLOSE31 = msOf('2026-10-31', '14:20:00');
  const ghostDoc = { id: 'tracker', mt: 'tracker',
    v: { status: 'running', elapsed: 0, startTs: msOf('2026-10-31', '18:50:00'), sessionId: GHOST, accum: { manualLoads: 0 } },
    updatedAt: msOf('2026-10-31', '18:05:00') };

  {
    // B1: THE FIELD SHAPE — phone idle after a closed, verified
    // day; the cloud tracker doc still runs the ghost and carries
    // the NEWER stamp (re-pushed during the evening's other-client
    // syncs). The v271 tombstone cannot fire (no finished entry
    // names Fri 08:00 — Oct 30's real entry started ~07:23). On
    // web 302 the generic game installs the ghost here.
    fakeNow = T_NOW;
    const w = makeWorldB({
      local: [['tracker', { status: 'idle', startTs: 0, elapsed: 0 }],
              ['sessions', realSessions]],
      meta: { uid: 'u1', globallySynced: true, keys: { tracker: { t: T_CLOSE31, s: T_CLOSE31, u: 'u1' } } },
      docs: [ghostDoc]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const tk = w.get('tracker');
    ok('B1: the ghost\u2019s running cloud copy does NOT install over the closed day',
      tk && tk.status === 'idle', 'tk=' + JSON.stringify(tk));
    const km = (w.meta().keys || {}).tracker || {};
    ok('B1: the key seals on the LOCAL idle, not on the ghost\u2019s stamp',
      (km.s || 0) >= ghostDoc.updatedAt && (km.t || 0) === (km.s || 0), 'meta=' + JSON.stringify(km));
    ok('B1: the flush converges the cloud to the idle',
      w.pushes.some(function (p) { return p.id === 'tracker' && p.v && p.v.status === 'idle'; }),
      'pushes=' + JSON.stringify(w.pushes.map(function (p) { return p.id + ':' + (p.v && p.v.status); })));
    ok('B1: the verified sessions book is untouched by the pull',
      JSON.stringify(w.get('sessions')) === JSON.stringify(realSessions));
  }
  {
    // B2: the DISCARD MARKER prong, isolated — this ghost is only
    // 18 h old and started TODAY, so the stale test cannot fire;
    // the local idle names it in discardedSid (healStaleTracker
    // buried it this morning). A fresher cloud stamp must still
    // not resurrect it.
    fakeNow = T_NOW;
    const G2 = msOf('2026-10-31', '00:30:00');
    const w = makeWorldB({
      local: [['tracker', { status: 'idle', startTs: 0, elapsed: 0, discardedSid: G2, discardedAt: msOf('2026-10-31', '09:00:00') }],
              ['sessions', realSessions]],
      meta: { uid: 'u1', globallySynced: true, keys: { tracker: { t: T_CLOSE31, s: T_CLOSE31, u: 'u1' } } },
      docs: [{ id: 'tracker', mt: 'tracker',
        v: { status: 'running', elapsed: 0, startTs: msOf('2026-10-31', '18:55:00'), sessionId: G2, accum: { manualLoads: 0 } },
        updatedAt: msOf('2026-10-31', '18:55:00') }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const tk = w.get('tracker');
    ok('B2: a session buried by name stays buried under a fresher stamp',
      tk && tk.status === 'idle' && Number(tk.discardedSid) === G2, 'tk=' + JSON.stringify(tk));
  }
  {
    // B3: the v52 restore case is intact — a same-day cloud
    // session still installs onto a device that never held it.
    fakeNow = msOf('2026-10-31', '11:00:00');
    const w = makeWorldB({
      local: [['tracker', { status: 'idle', startTs: 0, elapsed: 0 }],
              ['sessions', []]],
      meta: { uid: 'u1', globallySynced: true, keys: { tracker: { t: msOf('2026-10-31', '07:00:00'), s: msOf('2026-10-31', '07:00:00'), u: 'u1' } } },
      docs: [{ id: 'tracker', mt: 'tracker',
        v: { status: 'running', elapsed: 0, startTs: msOf('2026-10-31', '10:00:00'), sessionId: T_TODAY8, accum: { manualLoads: 3 } },
        updatedAt: msOf('2026-10-31', '10:00:00') }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const tk = w.get('tracker');
    ok('B3: a same-day cloud session still installs (restore case intact)',
      tk && tk.status === 'running' && Number(tk.sessionId) === T_TODAY8, 'tk=' + JSON.stringify(tk));
  }
  {
    // B4: young previous-day cloud session — the stale test stays
    // silent (8 h old) and the generic rules behave as before.
    fakeNow = T_SAT6;
    const w = makeWorldB({
      local: [['tracker', { status: 'idle', startTs: 0, elapsed: 0 }],
              ['sessions', []]],
      meta: { uid: 'u1', globallySynced: true, keys: { tracker: { t: msOf('2026-10-30', '21:00:00'), s: msOf('2026-10-30', '21:00:00'), u: 'u1' } } },
      docs: [{ id: 'tracker', mt: 'tracker',
        v: { status: 'running', elapsed: 0, startTs: msOf('2026-10-31', '05:00:00'), sessionId: T_YEST22, accum: { manualLoads: 0 } },
        updatedAt: msOf('2026-10-31', '05:00:00') }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const tk = w.get('tracker');
    ok('B4: a young previous-day session still installs (no overreach)',
      tk && tk.status === 'running' && Number(tk.sessionId) === T_YEST22, 'tk=' + JSON.stringify(tk));
  }
  {
    // B5: the local live tracker IS the ghost (the phone-local
    // case) — the pull rule must not idle it from the cloud side;
    // that burial is the boot heal's door (Part A). Same-session
    // arbitration proceeds exactly as before (local stamp newer).
    fakeNow = T_NOW;
    const w = makeWorldB({
      local: [['tracker', { status: 'running', startTs: T_NOW, elapsed: 0, sessionId: GHOST, accum: { manualLoads: 0 } }],
              ['sessions', realSessions]],
      meta: { uid: 'u1', globallySynced: true, keys: { tracker: { t: T_NOW, s: msOf('2026-10-31', '18:00:00'), u: 'u1' } } },
      docs: [ghostDoc]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const tk = w.get('tracker');
    ok('B5: a same-session local live tracker is untouched by the pull rule',
      tk && tk.status === 'running' && Number(tk.sessionId) === GHOST, 'tk=' + JSON.stringify(tk));
  }
  {
    // B6: with a FINISHED twin present the burial still lands
    // (the v271 tombstone and the v303 stale rule agree here).
    fakeNow = T_NOW;
    const twin = { date: '2026-10-31',
      endedAt: new RealDate(msOf('2026-10-31', '19:00:00')).toISOString(), seconds: 126000 };
    const w = makeWorldB({
      local: [['tracker', { status: 'idle', startTs: 0, elapsed: 0 }],
              ['sessions', realSessions.concat([twin])]],
      meta: { uid: 'u1', globallySynced: true, keys: { tracker: { t: T_CLOSE31, s: T_CLOSE31, u: 'u1' } } },
      docs: [ghostDoc]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const tk = w.get('tracker');
    ok('B6: the closed-twin case still ends idle with the close pushed up',
      tk && tk.status === 'idle'
      && w.pushes.some(function (p) { return p.id === 'tracker' && p.v && p.v.status === 'idle'; }),
      'tk=' + JSON.stringify(tk));
  }

  /* ---------- Part C: the fix is present in both files ---------- */
  console.log('\n— C: source pins —');
  ok('C: app.js carries the heal', appSrc.includes('PHANTOM-REVIVAL-OCT31') && appSrc.includes('function healStaleTracker()'));
  ok('C: cloudsync.js carries the install refusal', csSrc.includes('PHANTOM-REVIVAL-OCT31') && csSrc.includes('staleSessionMs303'));
  ok('C: the heal is wired at boot and on the restore paths',
    (appSrc.match(/healStaleTracker\(\); \} catch/g) || []).length >= 3);

  console.log('\nphantom-revival-v303: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR: ' + (e && e.stack || e)); process.exit(2); });
