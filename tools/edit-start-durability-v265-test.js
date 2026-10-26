#!/usr/bin/env node
/* Meticulous v265 — EDIT-START-NOT-PERSISTED (owner, Mon Oct 26,
 * 2026). His phone session started Oct 25 11:32 AM. At ~08:37 he
 * used the hero's Edit to set its start to 8:00 AM — the hero
 * confirmed "Counting from 8:00 AM", 00:37:46. He installed
 * native v55 (app update -> relaunch). At 08:43 the dashboard
 * again read "Counting from 11:32", 21:10:39, Paused. And the
 * 08:50 browser check proved the phone and the ACCOUNT hold
 * different sessions: the cloud shows the Oct 25 session CLOSED
 * (ended Oct 26 07:17, 19.74h) and a new session running from
 * 8:00 AM (Oct 26 day $24.78 / 0.85h) — his edit DID persist
 * there — while the phone's hero/day kept following the Oct 25
 * session (21.25h / $616 counted live on the phone's Oct 26).
 *
 * The mechanism, proven in code (js/app.js + js/cloudsync.js +
 * meticulous-native SessionRecord.java / ShiftTrackPlugin.java):
 * three copies of the session exist — the local store, the cloud
 * kv doc, and the native SessionRecord. The hero reads the local
 * store only. The record's only writers are rev-gated web syncs,
 * native taps, and clear() from the PHONE's own stop paths; a
 * stop elsewhere never touches it, and a web sync is refused
 * whenever baseRev is stale (SessionRecord.syncFromWeb) — every
 * page reload restarts App._sessRev at -1, which never matches.
 * The refusal path (adoptSessionRecord) arbitrated STATUS and
 * LOADS only: same status -> nothing compared the CLOCK or the
 * SESSION, the consume step re-synced only on a change, and the
 * start-time Edit never even stamped App._lastStateAt — so the
 * record kept the Oct 25 clock invisibly, until his bubble pause
 * tap folded against its stale segment (Oct 25 11:32:00 +
 * 21:10:39 = Oct 26 08:42:39, to the second) and the next
 * adoption installed the fold over the edited tracker. Each
 * adoption also re-stamps the sync meta (km.t = now) through the
 * wrapped store.set, so the cloud pull's whole-key "latest
 * wins" protected the stale local copy forever — the pull could
 * never heal the phone.
 *
 * The law after the fix:
 *  (1) the Edit stamps App._lastStateAt (a state-group change,
 *      like trackerToggle) and schedules one verify collect, so
 *      a refused edit-sync heals inside the same run;
 *  (2) adoptSessionRecord gains a convergence step for the
 *      blind spot (fires ONLY when the arbitration changed
 *      nothing): a native tap can never rewrite the clock of a
 *      record whose status it did not change, so a same-status,
 *      same-session pair with divergent clocks means the record
 *      missed a web clock change — re-sync this layer's facts
 *      and heal it; a same-status pair describing DIFFERENT
 *      sessions means the record is an older session's shell —
 *      the live session outranks it (force sync, the
 *      ghost-branch principle);
 *  (3) the cloud pull arbitrates the tracker by SESSION
 *      identity, not stamps: when both copies carry a sessionId
 *      and they differ, the later session wins — the cloud's
 *      installs locally with clean stamps; the local's falls
 *      through to the generic rules and pushes up.
 *
 * Part A drives the REAL trackerSave/session-record region +
 * the v28 start-edit region out of js/app.js in vm worlds over
 * a JS mirror of SessionRecord.java's exact semantics (rev
 * gate, identical-facts no-op, nativeToggle fold), with the
 * store and the record shared across "relaunches" (fresh page
 * worlds). Part B drives the REAL js/cloudsync.js (the
 * cloudsync-merge-test pattern) through the divergence and its
 * counter-cases.
 *
 * Run: node tools/edit-start-durability-v265-test.js
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
function near(name, got, want, tol) {
  ok(name, Math.abs(got - want) <= tol, 'got ' + got + ', want ~' + want + ' ±' + tol);
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
   sessionSync/sessionRecord contract. */
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
      syncLog.push({ baseRev: facts.baseRev, force: !!facts.force, status: facts.status });
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
    nativeToggle: function () {
      const now = fakeNow;
      if (rec.status === 'running') { rec.elapsedBase = elapsedSec(now); rec.segStartMs = 0; rec.status = 'paused'; }
      else if (rec.status === 'paused') { rec.segStartMs = now; rec.status = 'running'; }
      else return 'idle';
      rec.rev += 1; rec.updatedAt = now; rec.src = 'native';
      return rec.status;
    }
  };
}

function makeStore() {
  const data = {};
  return {
    data: data,
    get: function (k, d) { const r = data['mt_' + k]; return r === undefined ? d : JSON.parse(r); },
    set: function (k, v) { data['mt_' + k] = JSON.stringify(v); return true; },
    del: function (k) { delete data['mt_' + k]; return true; }
  };
}

/* One "page world": fresh App (rev/stamps reset, as a relaunch
   leaves them) over a shared store + bridge. */
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
  sb.__timers = timers;
  sb.__timeEl = timeEl;
  sb.fireTimers = function () { const q = timers.splice(0, timers.length); q.forEach(function (t) { t.fn(); }); };
  return sb;
}

const T0 = msOf('2026-10-25', '11:32:00');        // the Oct 25 session start
const T_EDIT = msOf('2026-10-26', '08:37:00');    // the Edit
const T_TAP = msOf('2026-10-26', '08:42:39');     // his bubble pause tap (11:32:00 + 21:10:39)
const T_800 = msOf('2026-10-26', '08:00:00');     // the edited start

(async function () {
  console.log('\n— A1: the incident — edit refused, healed in-run, tap folds the healed segment, edit survives relaunch —');
  {
    const store = makeStore();
    const bridge = makeBridge();
    // Oct 25, as it was: the session starts and its sync lands (rev 0 -> 1).
    fakeNow = T0;
    store.set('tracker', { status: 'running', elapsed: 0, startTs: T0, sessionId: T0, accum: { manualLoads: 0 } });
    await bridge.sessionSync({ status: 'running', elapsed: 0, startTs: T0, loads: 0, loadsManual: 0,
      loadsArmed: false, sessionKey: 's' + T0, baseRev: 0, force: false });
    ok('seed: record holds the Oct 25 session', bridge.rec.segStartMs === T0 && bridge.rec.rev === 1);

    // Mon 08:37 — a fresh page world (the morning's relaunches reset _sessRev/_lastStateAt).
    fakeNow = T_EDIT;
    const W2 = makeWorld(store, bridge);
    W2.App.tracker = store.get('tracker', { status: 'idle', startTs: 0, elapsed: 0 });
    W2.__timeEl.value = '08:00';
    W2.App.trackerSaveStart();
    await pump();
    near('after the edit, the tracker counts from 8:00 AM', W2.trackerSessionStartMs(), T_800, 1500);
    ok('the edit is stamped as a state-group change', W2.App._lastStateAt === T_EDIT);
    ok('a verify collect is scheduled by the edit',
      W2.__timers.some(function (t) { return t.ms === 600; }));
    // The edit's sync went out with baseRev -1 (fresh world) and was
    // REFUSED — and this time the refusal's adoption saw the clock
    // divergence and healed the record on the spot.
    ok('record healed by the refusal adoption: segment is the edit collapse instant',
      bridge.rec.segStartMs === T_EDIT, 'segStartMs=' + bridge.rec.segStartMs);
    near('record healed: base is the edited 37 minutes', bridge.rec.elapsedBase, 2220, 2);
    const snapH = await bridge.sessionRecord();
    near('record healed: derived start is 8:00 AM', fakeNow - snapH.elapsedSec * 1000, T_800, 2500);

    // The verify collect fires and finds convergence — a no-op.
    W2.fireTimers();
    await pump();
    ok('verify collect is a no-op once healed', bridge.rec.segStartMs === T_EDIT && Math.abs(bridge.rec.elapsedBase - 2220) <= 2);

    // His bubble pause tap at 08:42:39 folds the HEALED segment, not Oct 25's.
    fakeNow = T_TAP;
    bridge.nativeToggle();
    ok('the pause tap folds the healed segment (~42:39, not 21:10:39)',
      Math.abs(bridge.rec.elapsedBase - 2559) <= 2, 'elapsedBase=' + bridge.rec.elapsedBase);

    // Relaunch (v55 install): fresh world, boot collect adopts the record.
    const W3 = makeWorld(store, bridge);
    W3.App.tracker = store.get('tracker', { status: 'idle', startTs: 0, elapsed: 0 });
    W3.App.collectSessionRecord();
    await pump();
    ok('after relaunch the tracker is paused (the tap adopted)', W3.App.tracker.status === 'paused');
    near('after relaunch the elapsed is the healed ~42:39', W3.trackerElapsedSec(), 2559, 2);
    near('after relaunch it still counts from 8:00 AM — the edit SURVIVED', W3.trackerSessionStartMs(), T_800, 2500);
  }

  console.log('\n— A2: a same-status record holding an OLDER session is overwritten by the live session —');
  {
    const store = makeStore();
    const bridge = makeBridge();
    const A = msOf('2026-10-25', '09:00:00');
    const B = msOf('2026-10-26', '08:00:00');
    await bridge.sessionSync({ status: 'running', elapsed: 0, startTs: A, loads: 0, loadsManual: 0,
      loadsArmed: false, sessionKey: 's' + A, baseRev: 0, force: false });
    store.set('tracker', { status: 'running', elapsed: 0, startTs: B, sessionId: B, accum: { manualLoads: 0 } });
    fakeNow = B + 600000;
    const W = makeWorld(store, bridge);
    W.App.tracker = store.get('tracker', { status: 'idle', startTs: 0, elapsed: 0 });
    W.App.collectSessionRecord();
    await pump();
    ok('the record now carries the live session\u2019s key', bridge.rec.sessionKey === 's' + B,
      'sessionKey=' + bridge.rec.sessionKey);
    ok('the record now carries the live session\u2019s segment', bridge.rec.segStartMs === B);
    const forced = bridge.syncLog.filter(function (e) { return e.force; });
    ok('the overwrite went through the force path (ghost-branch principle)', forced.length >= 1);
  }

  console.log('\n— A3: a genuine face-tap adoption is never second-guessed —');
  {
    const store = makeStore();
    const bridge = makeBridge();
    const S0 = msOf('2026-10-26', '08:00:00');
    store.set('tracker', { status: 'running', elapsed: 0, startTs: S0, sessionId: S0, accum: { manualLoads: 0 } });
    await bridge.sessionSync({ status: 'running', elapsed: 0, startTs: S0, loads: 0, loadsManual: 0,
      loadsArmed: false, sessionKey: 's' + S0, baseRev: 0, force: false });
    fakeNow = S0 + 1800000; // 08:30
    const W = makeWorld(store, bridge);
    W.App.tracker = store.get('tracker', { status: 'idle', startTs: 0, elapsed: 0 });
    W.App._sessRev = 1;
    bridge.nativeToggle(); // face tap: pause, folds 1800s, rev -> 2
    const revAfterTap = bridge.rec.rev;
    W.App.collectSessionRecord();
    await pump();
    ok('the tap adoption lands: tracker paused', W.App.tracker.status === 'paused');
    ok('the tap adoption lands: elapsed is the fold (1800)', W.App.tracker.elapsed === 1800,
      'elapsed=' + W.App.tracker.elapsed);
    ok('no heal fired over a genuine adoption (record rev unmoved)', bridge.rec.rev === revAfterTap,
      'rev=' + bridge.rec.rev + ' vs ' + revAfterTap);
    ok('no force sync was used', bridge.syncLog.filter(function (e) { return e.force; }).length === 0);
  }

  console.log('\n— A4: an edit made while PAUSED heals exactly (refused sync, verify collect) —');
  {
    const store = makeStore();
    const bridge = makeBridge();
    const S0 = msOf('2026-10-26', '06:30:00');
    store.set('tracker', { status: 'paused', elapsed: 3600, startTs: 0, sessionId: S0, accum: { manualLoads: 0 } });
    // The record holds the same paused facts (rev 3); this page world's rev view is stale (0).
    bridge.rec.status = 'paused'; bridge.rec.elapsedBase = 3600; bridge.rec.segStartMs = 0;
    bridge.rec.sessionKey = 's' + S0; bridge.rec.rev = 3; bridge.rec.updatedAt = S0;
    fakeNow = msOf('2026-10-26', '09:00:00');
    const W = makeWorld(store, bridge);
    W.App.tracker = store.get('tracker', { status: 'idle', startTs: 0, elapsed: 0 });
    W.App._sessRev = 0;
    W.__timeEl.value = '07:30'; // 90 minutes before 09:00
    W.App.trackerSaveStart();
    await pump();
    ok('paused edit applied locally (elapsed 5400)', W.App.tracker.elapsed === 5400);
    // The edit's sync was refused (stale rev view) — and the refusal
    // adoption's convergence step healed the record exactly (a paused
    // pair carries the whole total, no segment arithmetic).
    ok('record healed to the edited total by the refusal adoption (5400)', bridge.rec.elapsedBase === 5400,
      'elapsedBase=' + bridge.rec.elapsedBase);
    W.fireTimers();
    await pump();
    ok('verify collect confirms convergence (still 5400)', bridge.rec.elapsedBase === 5400);
  }

  /* ---------- Part B: the real cloudsync.js pull ---------- */
  console.log('\n— B: the pull arbitrates the tracker by session identity —');
  const T0s = T0, S800 = T_800;
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

  {
    // B1: the divergence — stale local session (re-stamped newest by
    // adoption echoes) vs the account's newer session.
    const w = makeWorldB({
      local: [['tracker', { status: 'paused', elapsed: 76239, startTs: 0, sessionId: T0s, accum: { manualLoads: 0 } }]],
      meta: { uid: 'u1', globallySynced: true, keys: { tracker: { t: msOf('2026-10-26', '08:43:00'), s: msOf('2026-10-26', '08:10:00'), u: 'u1' } } },
      docs: [{ id: 'tracker', mt: 'tracker', v: { status: 'running', elapsed: 0, startTs: S800, sessionId: S800, accum: { manualLoads: 0 } }, updatedAt: msOf('2026-10-26', '08:10:00') }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const tk = w.get('tracker');
    ok('B1: the account\u2019s newer session installs over the stale local one',
      tk && tk.sessionId === S800 && tk.status === 'running', 'tk=' + JSON.stringify(tk));
    const km = (w.meta().keys || {}).tracker || {};
    ok('B1: the installed copy is clean (no push-back)', km.t === km.s && km.s === msOf('2026-10-26', '08:10:00'),
      'km=' + JSON.stringify(km));
    ok('B1: the stale session is never pushed up over the account',
      !w.pushes.some(function (p) { return p.id === 'tracker' && p.v && p.v.sessionId === T0s; }));
  }
  {
    // B2: the LOCAL session is the newer one — it stands (and pushes up).
    const S900 = msOf('2026-10-26', '09:00:00');
    const w = makeWorldB({
      local: [['tracker', { status: 'running', elapsed: 0, startTs: S900, sessionId: S900, accum: { manualLoads: 0 } }]],
      meta: { uid: 'u1', globallySynced: true, keys: { tracker: { t: msOf('2026-10-26', '09:05:00'), s: msOf('2026-10-26', '08:45:00'), u: 'u1' } } },
      docs: [{ id: 'tracker', mt: 'tracker', v: { status: 'running', elapsed: 0, startTs: S800, sessionId: S800, accum: { manualLoads: 0 } }, updatedAt: msOf('2026-10-26', '08:50:00') }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const tk = w.get('tracker');
    ok('B2: a newer LOCAL session is not displaced by the older cloud one',
      tk && tk.sessionId === S900, 'tk=' + JSON.stringify(tk));
  }
  {
    // B3: same session both sides — the stamp game arbitrates as before
    // (a local edit with the newest stamp wins the conflict).
    const w = makeWorldB({
      local: [['tracker', { status: 'paused', elapsed: 5400, startTs: 0, sessionId: S800, accum: { manualLoads: 0 } }]],
      meta: { uid: 'u1', globallySynced: true, keys: { tracker: { t: msOf('2026-10-26', '09:00:00'), s: msOf('2026-10-26', '08:30:00'), u: 'u1' } } },
      docs: [{ id: 'tracker', mt: 'tracker', v: { status: 'paused', elapsed: 3600, startTs: 0, sessionId: S800, accum: { manualLoads: 0 } }, updatedAt: msOf('2026-10-26', '08:45:00') }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const tk = w.get('tracker');
    ok('B3: same session — the local edit (newest stamp) still wins',
      tk && tk.elapsed === 5400, 'tk=' + JSON.stringify(tk));
  }
  {
    // B4: a legacy local tracker with no sessionId falls through to the
    // generic rules untouched (cloud-only change installs).
    const w = makeWorldB({
      local: [['tracker', { status: 'running', elapsed: 0, startTs: T0s, accum: { manualLoads: 0 } }]],
      meta: { uid: 'u1', globallySynced: true, keys: { tracker: { t: msOf('2026-10-25', '12:00:00'), s: msOf('2026-10-25', '12:00:00'), u: 'u1' } } },
      docs: [{ id: 'tracker', mt: 'tracker', v: { status: 'running', elapsed: 0, startTs: S800, sessionId: S800, accum: { manualLoads: 0 } }, updatedAt: msOf('2026-10-26', '08:10:00') }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const tk = w.get('tracker');
    ok('B4: no local sessionId — generic rules apply (cloud installs)',
      tk && tk.sessionId === S800, 'tk=' + JSON.stringify(tk));
  }

  console.log('\nedit-start-durability-v265: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR: ' + (e && e.stack || e)); process.exit(2); });
