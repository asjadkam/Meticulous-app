#!/usr/bin/env node
/* Meticulous v314 — PHANTOM-SESSION-31H (owner video, Mon Nov 2,
 * 2026, 16:09 CST). The tracker hero paints "Working... 31:08:43 /
 * Counting from 9:00 AM", miles (live) 23.9 km, loads 0 — and the
 * home-screen widget paints the IDENTICAL 31:08:43, because both
 * faces read the one live session (the widget through the native
 * SessionRecord that trackerSave syncs). The session is his
 * Nov 2 09:00 start — the start he set editing his dispatch after
 * oversleeping (the 08:00 auto-started record was stopped and
 * DELETED by him that morning; this is the day's real session,
 * never stopped). It crossed into the next day unclosed.
 *
 * Why web 303 could not kill it — the heal existed and its stale
 * test would even have answered TRUE at the video's instant
 * (31.2 h old, previous day), but:
 *  (1) TRIGGERS: healStaleTracker was wired ONLY at cold open
 *      (init), on the sign-in restore and on the first-pull
 *      reload. A session that turns stale WHILE the app process
 *      stays alive — no cold open in between, the foreground
 *      tracker keeping the page resident — is never re-tested.
 *      The 1 s trackerTick painted the clock and re-saved the
 *      record every minute (v220) but never asked the stale
 *      question; the visibilitychange handler collected widget /
 *      PiP / session-record state on return but never healed.
 *  (2) THE 20 h PRONG: the stale test ALSO demanded >= 20 h of
 *      age, sparing any previous-day session younger than that
 *      even at a cold open — pure headroom for phantoms, in an
 *      app where no session legitimately crosses midnight (days
 *      close the day they start; autostart already calls such a
 *      session "not today's work").
 *
 * The v314 law:
 *  (1) The day prong alone decides (both mirrors: app.js
 *      staleTrackerStartMs, cloudsync.js staleSessionMs303) — a
 *      live session whose pinned start is not today (device-
 *      local) is a stale shell. This SUPERSEDES two v303
 *      fixtures: A3 and B4 pinned the young-previous-day survival
 *      the 20 h prong existed to protect; both are re-pinned in
 *      THIS suite (D4/D5) as burials/refusals, and the v303
 *      suite's A3/B4 expectations are updated to point here.
 *  (2) healStaleTrackerPeriodic re-tests on the app's own
 *      cadence while it lives: called at the head of trackerTick
 *      (throttled to one evaluation a minute) and at the head of
 *      the visibilitychange return-to-visible branch, BEFORE the
 *      collects that could re-adopt the native record. The
 *      burial is the identical unbooked discard (no stopSessionAt
 *      ever runs); trackerSave inside the heal syncs the idle
 *      facts into the native session record, so the widget face
 *      stops with the web session — widget coherence needs NO
 *      native change (proven D3: after the periodic burial the
 *      record is idle and sessionStopped fired for the ghost).
 *
 * Part D drives the REAL app.js regions (the v303 slice pattern,
 * extended with the trackerTick slice); Part E drives the REAL
 * js/cloudsync.js pull (the v303 world pattern) for the mirror.
 *
 * Run: node tools/phantom-session-v314-test.js
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

/* ---------- fake clock (real Nov 2026 calendar, local time) ---------- */
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

const START = msOf('2026-11-02', '09:00:00');       // his edited start
const T_VIDEO = msOf('2026-11-03', '16:09:43');    // the video's reckoning: 31:09:43 elapsed
const T_MORN = msOf('2026-11-03', '08:00:00');      // next-morning: 23 h old, previous day
const T_19H = msOf('2026-11-03', '04:00:00');       // 19 h old, previous day (under the old prong)

/* ---------- Part D: the heal + the periodic trigger (real app.js) ---------- */
function sliceBetween(s, startMark, endMark, endIncl) {
  const a = s.indexOf(startMark);
  const b = s.indexOf(endMark);
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + startMark);
  return s.slice(a, endIncl ? b + endMark.length : b);
}
const regionA = sliceBetween(appSrc, 'function trackerSave() {', 'App.collectSessionRecord = collectSessionRecord;', true);
const regionB = sliceBetween(appSrc, '/* ---------------- v28: backdate', 'App.trackerToggle = function', false);
const regionC = sliceBetween(appSrc, 'function payMode() {', '/* v82 (item 3b)', false);
const regionD = sliceBetween(appSrc, 'function trackerTick() {', '/* ---------------- v28: backdate', false);
const regionCode = regionA + '\n' + regionB + '\n' + regionC + '\n' + regionD;

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
  const genericEl = { value: '', textContent: '', innerHTML: '',
    classList: { add: function () {}, remove: function () {}, contains: function () { return false; } }, onclick: null };
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
    trackerPaint: function () {},
    paintHero: function () {},
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

function liveWorld(now, store, bridge) {
  const w = makeWorld(store, bridge);
  fakeNow = now;
  w.App.tracker = { status: 'running', startTs: START, elapsed: 0, sessionId: START, accum: { manualLoads: 0 } };
  w.App._sessRev = -1; w.App._lastStateAt = 0;
  return w;
}

(async function () {
  console.log('\n— D1: the field shape at the video instant — elapsed really is 31:09 —');
  {
    const store = makeStore(), bridge = makeBridge();
    const w = liveWorld(msOf('2026-11-02', '09:05:00'), store, bridge);
    fakeNow = T_VIDEO;
    const sec = w.trackerElapsedSec();
    ok('D1: the restored clock reads the 31:09 of his video',
      Math.abs(sec - Math.floor((T_VIDEO - START) / 1000)) <= 2, 'elapsed=' + sec);
    ok('D1: the day prong alone now calls the start stale',
      w.staleTrackerStartMs(START, T_VIDEO) === true);
  }

  console.log('\n— D2: still legit on its own day — the periodic guard stays silent —');
  {
    const store = makeStore(), bridge = makeBridge();
    const w = liveWorld(msOf('2026-11-02', '09:05:00'), store, bridge);
    fakeNow = msOf('2026-11-02', '16:09:00');   // his afternoon: 7:09 elapsed
    store.writes.length = 0;
    const buried = w.healStaleTrackerPeriodic();
    await pump();
    ok('D2: same-day session — periodic heal does not fire', buried === false);
    ok('D2: the session is untouched (running, same identity, no tracker write)',
      w.App.tracker.status === 'running' && Number(w.App.tracker.sessionId) === START
      && !store.writes.includes('tracker'), 'writes=' + JSON.stringify(store.writes));
    ok('D2: the clock still reads its true 7:09',
      Math.abs(w.trackerElapsedSec() - 7 * 3600 - 9 * 60) <= 2, 'elapsed=' + w.trackerElapsedSec());
  }

  console.log('\n— D3: crossing while OPEN — the tick buries it, unbooked, widget record too —');
  {
    const store = makeStore(), bridge = makeBridge();
    store.set('sessions', [{ date: '2026-11-02', seconds: 28800 }]);
    store.set('entries', [{ id: 'rev-nov2', amount: 232.00 }]);
    const w = liveWorld(msOf('2026-11-02', '09:05:00'), store, bridge);
    /* the native record holds the same live session (widget face) */
    bridge.rec.status = 'running'; bridge.rec.elapsedBase = 0; bridge.rec.segStartMs = START;
    bridge.rec.sessionKey = 's' + START; bridge.rec.updatedAt = fakeNow; bridge.rec.src = 'native'; bridge.rec.rev = 3;
    await pump();
    store.writes.length = 0;
    fakeNow = T_MORN;   // next morning, app never cold-opened
    w.trackerTick();    // the per-second tick the hero rides
    await pump();
    const t = w.App.tracker;
    ok('D3: the tick buried the crossed session without any cold open', t.status === 'idle',
      't=' + JSON.stringify(t));
    ok('D3: the discard marker names the Nov 2 09:00 session',
      Number(t.discardedSid) === START, 'discardedSid=' + t.discardedSid);
    ok('D3: $0 booked — sessions and revenue stores are byte-untouched',
      !store.writes.includes('sessions') && !store.writes.includes('entries'),
      'writes=' + JSON.stringify(store.writes));
    ok('D3: the burial stopped the ghost\u2019s native recording service',
      bridge.stoppedLog.includes('s' + START), 'stopped=' + JSON.stringify(bridge.stoppedLog));
    ok('D3: the native SessionRecord is idle — the widget stops with the web session (no native change needed)',
      bridge.rec.status === 'idle', 'rec.status=' + bridge.rec.status);
    ok('D3: the hero clock is dead — elapsed reads 0, not 23 h',
      w.trackerElapsedSec() === 0, 'elapsed=' + w.trackerElapsedSec());
  }

  console.log('\n— D4: SUPERSEDES v303 A3 — a young previous-day session is buried at open now —');
  {
    const store = makeStore(), bridge = makeBridge();
    const w = makeWorld(store, bridge);
    fakeNow = msOf('2026-11-03', '06:00:00');   // Tue 06:00; started Mon 22:00 — 8 h old
    const YEST = msOf('2026-11-02', '22:00:00');
    w.App.tracker = { status: 'running', startTs: fakeNow, elapsed: 0, sessionId: YEST, accum: { manualLoads: 0 } };
    w.App._sessRev = -1; w.App._lastStateAt = 0;
    const healed = w.healStaleTracker();
    await pump();
    ok('D4: previous-day at ANY age is a stale shell (v303 A3 re-pinned by v314 law)',
      healed === true && w.App.tracker.status === 'idle' && Number(w.App.tracker.discardedSid) === YEST);
  }

  console.log('\n— D5: the 19 h shape the old prong spared — buried as soon as it is previous-day —');
  {
    const store = makeStore(), bridge = makeBridge();
    const w = liveWorld(msOf('2026-11-02', '09:05:00'), store, bridge);
    fakeNow = T_19H;   // Tue 04:00 — 19 h old
    ok('D5: the stale test fires at 19 h previous-day (was false under the 20 h prong)',
      w.staleTrackerStartMs(START, T_19H) === true);
    const buried = w.healStaleTrackerPeriodic();
    await pump();
    ok('D5: the periodic guard buries it', buried === true && w.App.tracker.status === 'idle');
  }

  console.log('\n— D6: a paused previous-day shell is buried by the periodic guard too —');
  {
    const store = makeStore(), bridge = makeBridge();
    const w = makeWorld(store, bridge);
    fakeNow = T_MORN;
    w.App.tracker = { status: 'paused', startTs: 0, elapsed: 82800, sessionId: START, accum: { manualLoads: 0 } };
    w.App._sessRev = -1; w.App._lastStateAt = 0;
    const buried = w.healStaleTrackerPeriodic();
    await pump();
    ok('D6: paused stale shell buried, marker names it',
      buried === true && w.App.tracker.status === 'idle' && Number(w.App.tracker.discardedSid) === START);
  }

  console.log('\n— D7: source pins — the new trigger points are wired —');
  ok('D7: the periodic wrapper exists', typeof makeWorld(makeStore(), makeBridge()).healStaleTrackerPeriodic === 'function');
  ok('D7: trackerTick re-tests staleness',
    appSrc.includes('try { healStaleTrackerPeriodic(); } catch (e) {}') &&
    appSrc.indexOf('healStaleTrackerPeriodic') > appSrc.indexOf('function trackerTick()'));
  ok('D7: the heal is wired at boot, restore paths AND periodically (>= 5 call sites)',
    (appSrc.match(/healStaleTracker(Periodic)?\(\); \} catch/g) || []).length >= 5,
    'sites=' + (appSrc.match(/healStaleTracker(Periodic)?\(\); \} catch/g) || []).length);

  /* ---------- Part E: the cloudsync mirror ---------- */
  console.log('\n— E: the pull mirror — a previous-day cloud copy is refused at any age —');
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
  {
    /* E1: SUPERSEDES v303 B4 — a young (8 h) previous-day cloud
       session no longer installs over a local idle. */
    fakeNow = msOf('2026-11-03', '06:00:00');
    const YEST22 = msOf('2026-11-02', '22:00:00');
    const w = makeWorldB({
      local: [['tracker', { status: 'idle', startTs: 0, elapsed: 0 }],
              ['sessions', []]],
      meta: { uid: 'u1', globallySynced: true, keys: { tracker: { t: msOf('2026-11-02', '21:00:00'), s: msOf('2026-11-02', '21:00:00'), u: 'u1' } } },
      docs: [{ id: 'tracker', mt: 'tracker',
        v: { status: 'running', elapsed: 0, startTs: msOf('2026-11-03', '05:00:00'), sessionId: YEST22, accum: { manualLoads: 0 } },
        updatedAt: msOf('2026-11-03', '05:00:00') }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const tk = w.get('tracker');
    ok('E1: a young previous-day cloud session is REFUSED (v303 B4 re-pinned by v314 law)',
      tk && tk.status === 'idle', 'tk=' + JSON.stringify(tk));
  }
  {
    /* E2: the restore case is intact — a same-day cloud session
       still installs onto a device that never held it. */
    fakeNow = msOf('2026-11-03', '11:00:00');
    const TODAY8 = msOf('2026-11-03', '08:00:00');
    const w = makeWorldB({
      local: [['tracker', { status: 'idle', startTs: 0, elapsed: 0 }],
              ['sessions', []]],
      meta: { uid: 'u1', globallySynced: true, keys: { tracker: { t: msOf('2026-11-03', '07:00:00'), s: msOf('2026-11-03', '07:00:00'), u: 'u1' } } },
      docs: [{ id: 'tracker', mt: 'tracker',
        v: { status: 'running', elapsed: 0, startTs: msOf('2026-11-03', '10:00:00'), sessionId: TODAY8, accum: { manualLoads: 3 } },
        updatedAt: msOf('2026-11-03', '10:00:00') }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const tk = w.get('tracker');
    ok('E2: a same-day cloud session still installs (restore case intact)',
      tk && tk.status === 'running' && Number(tk.sessionId) === TODAY8, 'tk=' + JSON.stringify(tk));
  }

  console.log('\nphantom-session-v314: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR: ' + (e && e.stack || e)); process.exit(2); });
