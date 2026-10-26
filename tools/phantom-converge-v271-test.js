#!/usr/bin/env node
/* Meticulous v271 — PHANTOM-RESURRECTION (owner screenshot, Mon
 * Oct 26, 2026, 17:24 MDT). Minutes after he installed native
 * v57, the home-screen widget painted timer 29:52:31, 0 loads,
 * "Working..." — the PHANTOM: a session started Oct 25 11:32 AM
 * phone-local, closed in the account that morning, never booked.
 * The day's real session (Oct 26, 8:00 AM start, 10 loads) is
 * what the same widget showed at 17:04.
 *
 * The mechanism, proven in code (js/app.js + js/cloudsync.js +
 * native SessionRecord.java):
 *  - v265 gave the CLOUD PULL session-identity arbitration
 *    (later session wins), but adoptSessionRecord — the only
 *    channel through which the native SessionRecord reaches the
 *    web tracker — arbitrated STATUS and LOADS by stamp alone,
 *    and the v265 convergence step runs only when that
 *    arbitration changed nothing. A record still holding the
 *    older session (the v265 incident proved the Oct 25 shell
 *    sits in the record: elapsedBase 76239) flips a NEWER live
 *    session over to itself — status, clock AND sessionId —
 *    whenever a native widget tap re-stamps the record past
 *    App._lastStateAt, a stamp most actions never set and every
 *    page reload resets to 0. The v57 install relaunch ran the
 *    collect that did it.
 *  - The pull had the mirror hole: stopSessionAt resets the
 *    tracker to a fresh idle object with NO sessionId, so a
 *    cloud copy of the just-closed session still marked RUNNING
 *    met a sid-less local and the stamp game could install the
 *    running copy back over a deliberate close.
 *
 * The law after the fix:
 *  (1) adoptSessionRecord: when both sides name a session and
 *      the record's is OLDER than this layer's live session, the
 *      record is a stale shell — never adopted (no status flip,
 *      no loads, no clock); it is healed with this layer's facts
 *      (the ghost-branch principle extended to live sessions).
 *      Same-session pairs and NEWER record sessions keep the
 *      existing arbitration byte-for-byte.
 *  (2) the pull: a close is a tombstone — if the local sessions
 *      list holds a finished entry whose own start (endedAt −
 *      seconds) names the cloud copy's sessionId (±5 s, the v69
 *      pin jitter), the cloud's RUNNING/PAUSED copy of that
 *      session is its stale echo: the local idle stands and the
 *      key stays dirty so the flush pushes the close up.
 *  (3) the discard books $0 by construction: no stop ever runs
 *      on the phantom — the paths above only ever overwrite the
 *      stale copies with the live layer's facts.
 *
 * Part A drives the REAL trackerSave/session-record region +
 * the v28 region out of js/app.js in vm worlds over a JS mirror
 * of SessionRecord.java's exact semantics, with the store and
 * the record shared across "relaunches". Part B drives the REAL
 * js/cloudsync.js (the edit-start-v265-test pattern).
 *
 * Run: node tools/phantom-converge-v271-test.js
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

const T0 = msOf('2026-10-25', '11:32:00');        // the phantom's start
const T_800 = msOf('2026-10-26', '08:00:00');    // today's session start
const T_900 = msOf('2026-10-26', '09:00:00');    // a later session (restore case)
const T_CLOSE = msOf('2026-10-26', '17:07:00');  // his close attempt
const T_1724 = msOf('2026-10-26', '17:24:31');   // the screenshot moment

/* ---------- Part A: the web session-record machinery ---------- */
function sliceBetween(s, startMark, endMark, endIncl) {
  const a = s.indexOf(startMark);
  const b = s.indexOf(endMark);
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + startMark);
  return s.slice(a, endIncl ? b + endMark.length : b);
}
const regionA = sliceBetween(appSrc, 'function trackerSave() {', 'App.collectSessionRecord = collectSessionRecord;', true);
const regionB = sliceBetween(appSrc, '/* ---------------- v28: backdate', 'App.trackerToggle = function', false);
const regionCode = regionA + '\n' + regionB;

/* A faithful JS mirror of SessionRecord.java + the plugin's
   sessionSync/sessionRecord contract (same as the v265 suite). */
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
  const syncLog = [];
  return {
    rec: rec, syncLog: syncLog,
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
    sessionRecord: function () { return Promise.resolve(snap()); }
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
  const timeEl = { value: '08:00', classList: { add: function () {}, remove: function () {} }, onclick: null };
  const genericEl = { value: '', classList: { add: function () {}, remove: function () {} }, onclick: null };
  const sb = {
    console: console, Promise: Promise, Date: FakeDate, JSON: JSON, Math: Math,
    setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; },
    clearTimeout: function () {},
    confirm: function () { return true; },
    closeSidebar: function () {},
    fmtClock: function (s) { return String(s); },
    el: function (id) { return id === 'trkStartTime' ? timeEl : genericEl; },
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

function seedPhantomRecord(bridge, status) {
  /* the record as the v265 incident proved it: the Oct 25 shell,
     re-stamped by a native tap moments before the relaunch. */
  bridge.rec.status = status;
  bridge.rec.elapsedBase = 76239;
  bridge.rec.segStartMs = status === 'running' ? T0 : 0;
  if (status === 'running') bridge.rec.elapsedBase = 0;
  bridge.rec.loads = 0; bridge.rec.loadsManual = 0; bridge.rec.loadsCorr = 0;
  bridge.rec.sessionKey = 's' + T0;
  bridge.rec.updatedAt = fakeNow;
  bridge.rec.src = 'native';
  bridge.rec.rev = 7;
}

(async function () {
  console.log('\n— A1: the 17:24 mechanism — older record vs the live session —');
  {
    fakeNow = T_1724;
    const store = makeStore(), bridge = makeBridge();
    seedPhantomRecord(bridge, 'paused');
    store.set('sessions', []);
    store.writes.length = 0;
    const w = makeWorld(store, bridge);
    w.App.tracker = { status: 'running', startTs: T_800, elapsed: 0, sessionId: T_800,
      accum: { manualLoads: 10 } };
    w.App._sessRev = -1;              /* a fresh page lifetime */
    w.App._lastStateAt = 0;           /* nothing stamped it */
    await w.App.collectSessionRecord();
    await pump();
    const t = w.App.tracker;
    ok('A1: the live session is NOT flipped to the phantom',
      t.status === 'running' && t.sessionId === T_800,
      't=' + JSON.stringify({ status: t.status, sessionId: t.sessionId }));
    ok('A1: the clock still counts today\u2019s session',
      Math.abs(w.trackerElapsedSec() - Math.floor((T_1724 - T_800) / 1000)) <= 2,
      'elapsed=' + w.trackerElapsedSec());
    ok('A1: today\u2019s 10 loads survive (no loads adoption from the shell)',
      t.accum && t.accum.manualLoads === 10, 'manualLoads=' + (t.accum && t.accum.manualLoads));
    ok('A1: the record is healed to the live session',
      bridge.rec.sessionKey === 's' + T_800 && bridge.rec.status === 'running',
      'rec=' + JSON.stringify({ key: bridge.rec.sessionKey, status: bridge.rec.status }));
    ok('A1: the heal rode a FORCE sync of the live facts',
      bridge.syncLog.some(function (s) { return s.force && s.sessionKey === 's' + T_800; }),
      JSON.stringify(bridge.syncLog));
    ok('A1: $0 booked — no session entry was created or touched',
      !store.writes.includes('sessions') && !store.writes.includes('entries')
      && (store.get('sessions', [])).length === 0,
      'writes=' + JSON.stringify(store.writes));
  }

  console.log('\n— A2: the phantom RUNNING in the record, this layer idle (the close stood) —');
  {
    fakeNow = T_1724;
    const store = makeStore(), bridge = makeBridge();
    seedPhantomRecord(bridge, 'running');
    const w = makeWorld(store, bridge);
    w.App.tracker = { status: 'idle', startTs: 0, elapsed: 0 };
    w.App._sessRev = -1;
    w.App._lastStateAt = T_CLOSE;
    ok('A2: the record\u2019s own clock is the 29:52:31 of his screenshot',
      bridge.rec.elapsedBase + Math.floor((fakeNow - T0) / 1000) === 29 * 3600 + 52 * 60 + 31,
      'secs=' + (bridge.rec.elapsedBase + Math.floor((fakeNow - T0) / 1000)));
    await w.App.collectSessionRecord();
    await pump();
    ok('A2: the web tracker stays idle (no ghost adopted)',
      w.App.tracker.status === 'idle');
    ok('A2: the record is overwritten with the idle truth',
      bridge.rec.status === 'idle', 'rec.status=' + bridge.rec.status);
    ok('A2: $0 booked — the discard never runs a stop',
      !store.writes.includes('sessions') && !store.writes.includes('entries'),
      'writes=' + JSON.stringify(store.writes));
  }

  console.log('\n— A3: same session — a native pause still adopts (v52 protocol intact) —');
  {
    fakeNow = msOf('2026-10-26', '12:00:00');
    const store = makeStore(), bridge = makeBridge();
    bridge.rec.status = 'paused'; bridge.rec.elapsedBase = 3600; bridge.rec.segStartMs = 0;
    bridge.rec.sessionKey = 's' + T_800; bridge.rec.updatedAt = fakeNow; bridge.rec.rev = 3;
    const w = makeWorld(store, bridge);
    w.App.tracker = { status: 'running', startTs: T_800, elapsed: 0, sessionId: T_800,
      accum: { manualLoads: 2 } };
    w.App._sessRev = 3; w.App._lastStateAt = T_800;
    await w.App.collectSessionRecord();
    await pump();
    ok('A3: the same-session pause adopts (status + folded clock)',
      w.App.tracker.status === 'paused' && w.App.tracker.elapsed === 3600
      && Number(w.App.tracker.sessionId) === T_800,
      't=' + JSON.stringify({ status: w.App.tracker.status, elapsed: w.App.tracker.elapsed, sessionId: w.App.tracker.sessionId }));
  }

  console.log('\n— A4: a NEWER record session is not blocked by the guard (restore case) —');
  {
    fakeNow = msOf('2026-10-26', '12:00:00');
    const store = makeStore(), bridge = makeBridge();
    bridge.rec.status = 'paused'; bridge.rec.elapsedBase = 500; bridge.rec.segStartMs = 0;
    bridge.rec.sessionKey = 's' + T_900; bridge.rec.updatedAt = fakeNow; bridge.rec.rev = 4;
    const w = makeWorld(store, bridge);
    w.App.tracker = { status: 'running', startTs: T_800, elapsed: 0, sessionId: T_800,
      accum: { manualLoads: 0 } };
    w.App._sessRev = -1; w.App._lastStateAt = 0;
    await w.App.collectSessionRecord();
    await pump();
    ok('A4: the newer record session still adopts through the old arbitration',
      Number(w.App.tracker.sessionId) === T_900 && w.App.tracker.status === 'paused',
      't=' + JSON.stringify({ status: w.App.tracker.status, sessionId: w.App.tracker.sessionId }));
  }

  /* ---------- Part B: the real cloudsync.js pull ---------- */
  console.log('\n— B: the pull — a close is a tombstone —');
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
    const sb = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, Promise: Promise };
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
  const closedEntry = { endedAt: new RealDate(T_800 + 36000 * 1000).toISOString(), seconds: 36000 };

  {
    // B1: the Oct 26 shape — the phone closed today's session
    // locally; the cloud copy still runs and carries the NEWEST
    // stamp (another client re-pushed it). Pre-fix the stamp
    // game installs the running copy over the close.
    const w = makeWorldB({
      local: [['tracker', { status: 'idle', startTs: 0, elapsed: 0 }],
              ['sessions', [closedEntry]]],
      meta: { uid: 'u1', globallySynced: true, keys: { tracker: { t: T_CLOSE, s: msOf('2026-10-26', '16:00:00'), u: 'u1' } } },
      docs: [{ id: 'tracker', mt: 'tracker', v: { status: 'running', elapsed: 0, startTs: T_800, sessionId: T_800, accum: { manualLoads: 10 } }, updatedAt: msOf('2026-10-26', '17:15:00') }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const tk = w.get('tracker');
    ok('B1: the closed session is NOT resurrected by its running cloud echo',
      tk && tk.status === 'idle', 'tk=' + JSON.stringify(tk));
    ok('B1: the flush pushes the local CLOSE up over the echo',
      w.pushes.some(function (p) {
        return p.id === 'tracker' && p.v && p.v.status === 'idle';
      }), 'pushes=' + JSON.stringify(w.pushes.map(function (p) { return p.id + ':' + (p.v && p.v.status); })));
  }
  {
    // B2: no false tombstone — the closed entry names the
    // PHANTOM (Oct 25), the cloud runs TODAY's session: the
    // rule must not fire, and the generic rules install the
    // cloud session (a device that never held today's tracker).
    const phantomEntry = { endedAt: new RealDate(T0 + 71134 * 1000).toISOString(), seconds: 71134 };
    const w = makeWorldB({
      local: [['tracker', { status: 'idle', startTs: 0, elapsed: 0 }],
              ['sessions', [phantomEntry]]],
      meta: { uid: 'u1', globallySynced: true, keys: { tracker: { t: T_CLOSE, s: T_CLOSE, u: 'u1' } } },
      docs: [{ id: 'tracker', mt: 'tracker', v: { status: 'running', elapsed: 0, startTs: T_800, sessionId: T_800, accum: { manualLoads: 10 } }, updatedAt: msOf('2026-10-26', '17:15:00') }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const tk = w.get('tracker');
    ok('B2: a closed entry for a DIFFERENT session does not tombstone today\u2019s',
      tk && tk.status === 'running' && tk.sessionId === T_800, 'tk=' + JSON.stringify(tk));
  }
  {
    // B3: a PAUSED cloud echo of the closed session is equally
    // tombstoned.
    const w = makeWorldB({
      local: [['tracker', { status: 'idle', startTs: 0, elapsed: 0 }],
              ['sessions', [closedEntry]]],
      meta: { uid: 'u1', globallySynced: true, keys: { tracker: { t: T_CLOSE, s: msOf('2026-10-26', '16:00:00'), u: 'u1' } } },
      docs: [{ id: 'tracker', mt: 'tracker', v: { status: 'paused', elapsed: 32400, startTs: 0, sessionId: T_800, accum: { manualLoads: 10 } }, updatedAt: msOf('2026-10-26', '17:15:00') }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const tk = w.get('tracker');
    ok('B3: a paused echo of the closed session is tombstoned too',
      tk && tk.status === 'idle', 'tk=' + JSON.stringify(tk));
  }
  {
    // B4: no closed entry at all — the rule stays silent and the
    // generic rules behave exactly as before (cloud installs).
    const w = makeWorldB({
      local: [['tracker', { status: 'idle', startTs: 0, elapsed: 0 }],
              ['sessions', []]],
      meta: { uid: 'u1', globallySynced: true, keys: { tracker: { t: T_CLOSE, s: T_CLOSE, u: 'u1' } } },
      docs: [{ id: 'tracker', mt: 'tracker', v: { status: 'running', elapsed: 0, startTs: T_800, sessionId: T_800, accum: { manualLoads: 10 } }, updatedAt: msOf('2026-10-26', '17:15:00') }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const tk = w.get('tracker');
    ok('B4: with no closed entry the cloud session still installs (no overreach)',
      tk && tk.status === 'running' && tk.sessionId === T_800, 'tk=' + JSON.stringify(tk));
  }

  /* ---------- Part C: the fix is present in both files ---------- */
  console.log('\n— C: source pins —');
  ok('C: app.js carries the identity guard', appSrc.includes('PHANTOM-RESURRECTION'));
  ok('C: cloudsync.js carries the tombstone rule', csSrc.includes('a close is a tombstone'));

  console.log('\nphantom-converge-v271: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR: ' + (e && e.stack || e)); process.exit(2); });
