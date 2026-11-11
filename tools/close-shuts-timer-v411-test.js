#!/usr/bin/env node
/* Meticulous v411 — CLOSE-SHUTS-TIMER + EXTRA-AUTO-SESSIONS
 * (owner law restated Nov 10, 2026; broken in his hands Nov 9
 * AND Nov 10 for the close, phantom auto-sessions alongside).
 *
 * FIX 1 — CLOSE-SHUTS-TIMER. Standing law: closing the shift
 * AUTOMATICALLY shuts the timer down — no separate Stop, ever;
 * the closed state wins over any local running state at sync
 * and at boot, on every device; a closed day can never
 * resurrect a running timer. Web 410's rules (v271/v303/v352)
 * each read the LOCAL sessions list only and match a finished
 * entry by pin — so they all missed the Nov 9/10 shape: the
 * close-out landed on a surface whose tracker was idle, booking
 * the day as a COMPLETED DISPATCH (v82: a dispatch completion
 * is a shift close) and writing NO sessions entry; or the
 * finished entry existed only in the pull's own incoming
 * sessions doc, unapplied when the tracker doc was judged, and
 * the phone's ticking re-stamps won the stamp game. Web 411's
 * closed-day proof (closedDayProof411 / closedProof411 /
 * dayClosed411, one law in three mirrors): a finished twin by
 * pin OR a completed dispatch for the session's day, judged
 * against the union of local + incoming records, enforced at
 * the pull (js/cloudsync.js), at boot + on the tick + at
 * native-record adoption (js/app.js), and at the native boot
 * reconcile (js/shifttrack.js).
 *
 * FIX 2 — EXTRA-AUTO-SESSIONS. One dispatch, one session:
 *  - an auto-start pins its session identity to the plan
 *    ANCHOR itself — the very key the native day-arm was armed
 *    under — not a whole-second derivation up to a second
 *    later, so the arm's session and the web's session are one
 *    identity, not jitter twins (js/app.js checkAutoStart);
 *  - re-arming under a new key (a dispatch EDIT moves the
 *    plan, v342) disarms the old native arm first, so no stale
 *    arm survives to seed a session at the old time
 *    (js/shifttrack.js armDay);
 *  - a stop that finds its own session already booked (the
 *    twin entry landed from the closing surface) stands
 *    everything down but writes no second entry, doc or
 *    Revenue line (js/app.js stopSessionAt).
 *
 * Proof, in the established styles:
 *  S — the real js/cloudsync.js pull, v352 two-world harness:
 *      S1 close only in the pull's incoming sessions doc;
 *      S2 close booked as a completed dispatch only, cloud
 *         carrying the running echo; S3 negative (a live day
 *         is never killed); S4 resurrection refused (local
 *         idle, cloud live, dispatch proof).
 *  A — the real js/app.js tracker regions (v314 slice pattern):
 *      A1 heal on dispatch proof alone; A2 heal on the v352
 *         twin (regression pin); A3 adoption refused on a
 *         closed day (record ended with idle facts); A4 v93
 *         adoption preserved on an open day; A5/A6 the
 *         one-booking stop.
 *  E — the real AUTOSTART-ENGINE region (v342 slice pattern):
 *      E1 repeated triggers = one session, pinned at the
 *         anchor; E2 an edit moves the start and still yields
 *         exactly one session.
 *  G — the real js/shifttrack.js (background-day glue world):
 *      G1 arm replacement disarms the old key; G2 syncOnBoot
 *         stops a closed day's native session; G3 syncOnBoot
 *         leaves an open day's armed session standing (v93).
 *
 * Run: node tools/close-shuts-timer-v411-test.js
 * On pristine web 410 bytes the v411 assertions fail:
 * S1 S2 S4, A1 A3 A5, E1 E2 (the anchor pin), G1 G2.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');
const csSrc = read('js/cloudsync.js');
const shiftSrc = read('js/shifttrack.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
function section(s) { console.log('\n— ' + s + ' —'); }

/* ---------- shared fixtures (Tue Nov 10, 2026, local) ---------- */
function msOf(y, mo, d, hh, mm) { return new Date(y, mo - 1, d, hh, mm || 0, 0, 0).getTime(); }
const START = msOf(2026, 11, 10, 8, 0);            // the day's 8:00 AM session pin
const SECS = 36000;                                // 10 h
const ENTRY = { date: '2026-11-10', seconds: SECS, endedAt: new Date(START + SECS * 1000).toISOString() };
const RUNNING = { status: 'running', sessionId: START, startTs: START, elapsed: 120 };
const IDLE = { status: 'idle', startTs: 0, elapsed: 0 };
const DSP_DONE = { id: 'd1', status: 'completed', scheduledAt: '2026-11-10T08:00', date: '2026-11-10', jobSite: 'Aecon Trans' };
const DSP_OPEN = { id: 'd1', status: 'saved', scheduledAt: '2026-11-10T08:00', date: '2026-11-10', jobSite: 'Aecon Trans' };

/* =================================================================
 * S — the real cloudsync pull (v352 two-world harness)
 * ================================================================= */
function makeServer() { return { docs: {}, clock: 100000, rejected: [] }; }
function serverSet(server, id, v, updatedAt) { server.docs[id] = { id: id, v: v, updatedAt: updatedAt || (++server.clock) }; }
function makeWorld(server, opts) {
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
  const world = { sb: sb, data: data, server: server };
  sb.FB = {
    ready: true, user: { uid: 'u1' },
    loadDocs: function () {
      return Promise.resolve(Object.keys(server.docs).map(function (id) {
        const d = server.docs[id];
        return { id: d.id, v: d.v, updatedAt: d.updatedAt };
      }));
    },
    loadDoc: function (col, id) {
      const d = server.docs[id];
      return Promise.resolve(d ? { id: d.id, v: d.v, updatedAt: d.updatedAt } : null);
    },
    saveDoc: function (col, id, doc) { serverSet(server, id, doc.v); return Promise.resolve({}); },
    deleteDoc: function (col, id) { delete server.docs[id]; return Promise.resolve({}); }
  };
  vm.createContext(sb);
  vm.runInContext(csSrc, sb);
  const store = {
    get: function (k, d) { const r = localStorage.getItem('mt_' + k); return r === null ? d : JSON.parse(r); },
    set: function (k, v) { localStorage.setItem('mt_' + k, JSON.stringify(v)); return true; },
    del: function (k) { localStorage.removeItem('mt_' + k); return true; }
  };
  sb.CloudSync.attach(store);
  world.store = store;
  world.get = function (k) { const r = localStorage.getItem('mt_' + k); return r === null ? null : JSON.parse(r); };
  world.meta = function () { const r = localStorage.getItem('mt___syncmeta'); return r === null ? null : JSON.parse(r); };
  return world;
}
function settle(ms) { return new Promise(function (r) { setTimeout(r, ms || 700); }); }
const META_TICKING = { uid: 'u1', globallySynced: true, keys: { tracker: { t: 9999999999999, s: 4000, u: 'u1' }, sessions: { t: 4000, s: 4000, u: 'u1' }, dsp_list: { t: 4000, s: 4000, u: 'u1' } } };

/* =================================================================
 * A — the real app.js tracker regions (v314 slice pattern)
 * ================================================================= */
const RealDate = Date;
let fakeNow = 0;
class FakeDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fakeNow])); }
  static now() { return fakeNow; }
}
function todayStrOf(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function sliceBetween(s, startMark, endMark, endIncl) {
  const a = s.indexOf(startMark);
  const b = s.indexOf(endMark);
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + startMark);
  return s.slice(a, endIncl ? b + endMark.length : b);
}
const regionA = sliceBetween(appSrc, 'function trackerSave() {', 'App.collectSessionRecord = collectSessionRecord;', true);
const regionB = sliceBetween(appSrc, '/* ---------------- v28: backdate', 'App.trackerToggle = function', false);

function makeAppWorld(opts) {
  const mem = {};
  mem.tracker = opts.tracker;
  mem.sessions = opts.sessions || [];
  mem.dsp_list = opts.dspList || [];
  mem.dsp_active = opts.dspActive || null;
  mem.onboarding = {};
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const bridge = {
    syncLog: [], stoppedLog: [], startedLog: [],
    sessionSync: function (facts) {
      bridge.syncLog.push(JSON.parse(JSON.stringify(facts)));
      return Promise.resolve({ rev: 7, applied: true });
    },
    sessionRecord: function () { return Promise.resolve(null); },
    sessionStopped: function (k) { bridge.stoppedLog.push(k); },
    sessionStarted: function (k) { bridge.startedLog.push(k); }
  };
  const sb = {
    console: console, Promise: Promise, Date: FakeDate, Math: Math, JSON: JSON,
    store: store, todayStr: todayStrOf,
    window: null,
    App: { tracker: JSON.parse(JSON.stringify(opts.tracker)), _sessRev: -1, _lastStateAt: 0, _lastLoadsAt: 0 },
    ShiftTrack: bridge,
    sessionActive: function () {
      const t = sb.App.tracker;
      return !!(t && (t.status === 'running' || t.status === 'paused'));
    },
    setTimeout: function () { return 0; }, clearTimeout: function () {}
  };
  sb.window = sb;
  sb.App._store = store;
  vm.createContext(sb);
  vm.runInContext(regionA + '\n' + regionB + '\n;this.__H = { healClosedTracker: healClosedTracker, healStaleTracker: healStaleTracker, closedDayProof411: (typeof closedDayProof411 !== "undefined" ? closedDayProof411 : function () { return false; }), adoptSessionRecord: adoptSessionRecord };', sb);
  return { sb: sb, mem: mem, bridge: bridge, H: sb.__H };
}
async function pump() { for (let i = 0; i < 10; i++) await new Promise(function (r) { setImmediate(r); }); }

/* =================================================================
 * A5 — stopSessionAt, brace-extracted with its real deps stubbed
 * ================================================================= */
function extractFn(src, marker) {
  const i = src.indexOf(marker);
  if (i === -1) throw new Error('marker not found: ' + marker);
  const open = src.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced: ' + marker);
}
function makeStopWorld(opts) {
  const mem = { sessions: opts.sessions || [], onboarding: {}, dsp_active: null, dsp_list: [] };
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const calls = { onSession: 0, saveDoc: 0, stopped: 0 };
  const sb = {
    console: console, Promise: Promise, Date: FakeDate, Math: Math, JSON: JSON,
    store: store, todayStr: todayStrOf,
    window: null,
    App: {
      tracker: { status: 'running', sessionId: START, startTs: START, elapsed: 0, profileId: 'p1' },
      armNativeDay: function () {},
      workProfiles: { activeId: function () { return 'p1'; }, keyFor: function (k) { return k; } }
    },
    Meticulous: { modules: { revenue: { onSession: function () { calls.onSession++; } } } },
    FB: { saveDoc: function () { calls.saveDoc++; } },
    ShiftTrack: { sessionStopped: function () { calls.stopped++; } },
    _stopViaDispatch: false, _endTicketPhoto: null,
    trackerSave: function () {}, trackerPaint: function () {},
    trackerSessionKeyMs: function () { return START; },
    trackerSessionStartMs: function () { return START; },
    takePendingStartOdo: function () { return null; },
    takePendingStartOdoPhoto: function () { return null; },
    applyEndOdoToEntry: function () {},
    takeSessionAccum: function () {},
    maybePromptOdo: function () {},
    dayEngineStop: function () {},
    autostartDispatchFor: function () { return null; }
  };
  sb.window = sb;
  const code = extractFn(appSrc, 'function trackedSecondsAt(endMs)') + '\n' +
    extractFn(appSrc, 'function closeTravelFor(dayStr)') + '\n' +
    extractFn(appSrc, 'function stopSessionAt(endMs, endOdoVal)');
  vm.createContext(sb);
  vm.runInContext(code + '\n;this.__stop = stopSessionAt;', sb);
  return { sb: sb, mem: mem, calls: calls };
}

/* =================================================================
 * E — the real AUTOSTART-ENGINE region (v342 slice pattern)
 * ================================================================= */
function extractRegion(s, beginMark, endMark) {
  const a = s.lastIndexOf('/*', s.indexOf(beginMark));
  const b = s.indexOf('*/', s.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return s.slice(a, b + 2);
}
const asRegion = extractRegion(appSrc, 'AUTOSTART-ENGINE-BEGIN', 'AUTOSTART-ENGINE-END');
function hhmm(ms) {
  const d = new Date(ms);
  return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}
function makeASWorld(dspRec) {
  const now = new Date();
  const today = todayStrOf(now);
  const mem = {
    onboarding: { autoStart: true, autoStartTime: '06:00', autoStartDays: [0, 1, 2, 3, 4, 5, 6] },
    dsp_active: null, dsp_list: [dspRec], autostart_override: null, autostart: {}, sessions: []
  };
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const calls = { sessionStarted: [] };
  const sb = {
    console: console, Promise: Promise, Math: Math, JSON: JSON,
    store: store, todayStr: todayStrOf,
    window: null,
    App: { tracker: { status: 'idle', startTs: 0, elapsed: 0 }, workProfiles: { activeId: function () { return 'p1'; } } },
    resetAccum: function () {}, trackerSave: function () {}, trackerPaint: function () {},
    maybePromptOdo: function () { return false; },
    trackerSessionStartMs: function () { return Date.now(); },
    trackerSessionKeyMs: function () { return sb.App.tracker.sessionId || Date.now(); },
    pinSplitDay: function () {},
    dayEngineStart: function () {},
    LiveMiles: { startDay: function () {} },
    ShiftTrack: { sessionStarted: function (k) { calls.sessionStarted.push(k); } }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(asRegion, sb);
  return { sb: sb, mem: mem, calls: calls, today: today };
}

/* =================================================================
 * G — the real shifttrack.js (background-day glue world)
 * ================================================================= */
function elStub() {
  const classes = new Set();
  const el = {
    children: [], textContent: '', _html: '',
    classList: {
      add: c => classes.add(c), remove: c => classes.delete(c),
      toggle: (c, on) => { if (on === undefined) on = !classes.has(c); on ? classes.add(c) : classes.delete(c); },
      contains: c => classes.has(c)
    },
    appendChild(c) { el.children.push(c); return c; },
    set innerHTML(v) { el._html = v; if (v === '') el.children = []; },
    get innerHTML() { return el._html; }
  };
  return el;
}
function makeShiftWorld(opts) {
  const mem = {};
  (opts.seed || []).forEach(function (kv) { mem[kv[0]] = kv[1]; });
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const calls = [];
  const plugin = {
    start: function (o) { calls.push(['start', o && o.sessionKey]); return Promise.resolve({ started: true }); },
    stop: function () { calls.push(['stop']); return Promise.resolve({ stopped: true }); },
    status: function () { return Promise.resolve(opts.status || null); },
    readCrumbs: function () { return Promise.resolve({ crumbs: [], more: false }); },
    ack: function () { return Promise.resolve({ deleted: 0 }); },
    armDay: function (o) { calls.push(['armDay', o && o.sessionKey]); return Promise.resolve({ armed: true }); },
    disarmDay: function () { calls.push(['disarmDay']); return Promise.resolve({ disarmed: true }); },
    sessionRecord: function () { return Promise.resolve(opts.record || null); },
    requestBackground: function () { return Promise.resolve({ granted: false }); },
    openBatterySettings: function () { return Promise.resolve({ opened: true }); },
    openAppSettings: function () { return Promise.resolve({ opened: true }); }
  };
  const banner = elStub();
  const sb = {
    console: console, Promise: Promise, Date: Date, Math: Math, JSON: JSON, Object: Object,
    Array: Array, String: String, Number: Number, isFinite: isFinite, parseInt: parseInt,
    setInterval: function () { return 1; }, clearInterval: function () {},
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    document: {
      getElementById: function (id) { return id === 'trkBgAsk' ? banner : null; },
      createElement: function () { return elStub(); },
      createTextNode: function (t) { return { textContent: t }; },
      addEventListener: function () {}
    }
  };
  sb.window = sb;
  sb.App = { _store: store, tracker: { status: opts.trackerStatus || 'idle' } };
  sb.Capacitor = { Plugins: { ShiftTrack: plugin } };
  sb.LiveMiles = { dayKey: function () { return null; }, recordKmFor: function () { return null; } };
  vm.createContext(sb);
  vm.runInContext(shiftSrc, sb);
  return { ST: sb.ShiftTrack, store: store, calls: calls, sb: sb };
}
async function flush(n) { for (let i = 0; i < (n || 24); i++) await new Promise(function (r) { setTimeout(r, 5); }); }

(async function () {
  /* ---------------- S: cloudsync pull ---------------- */
  section('S — cloudsync pull: the closed state wins');
  {
    const server = makeServer();
    serverSet(server, 'tracker', IDLE, 5000);
    serverSet(server, 'sessions', [ENTRY], 5000);
    const P = makeWorld(server, {
      local: [['tracker', RUNNING], ['sessions', []]],
      meta: JSON.parse(JSON.stringify(META_TICKING))
    });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    eq('S1 close only in the incoming sessions doc still ends the phone tracker', (P.get('tracker') || {}).status, 'idle');
  }
  {
    const server = makeServer();
    serverSet(server, 'dsp_list', [DSP_DONE], 5000);
    serverSet(server, 'tracker', RUNNING, 6000);
    const P = makeWorld(server, {
      local: [['tracker', RUNNING], ['sessions', []], ['dsp_list', [DSP_OPEN]]],
      meta: { uid: 'u1', globallySynced: true, keys: { tracker: { t: 4000, s: 4000, u: 'u1' }, dsp_list: { t: 4000, s: 4000, u: 'u1' } } }
    });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    eq('S2 a completed-dispatch close ends the local tracker even when the cloud copy is the running echo', (P.get('tracker') || {}).status, 'idle');
    const m = P.meta();
    ok('S2 the close is marked to push UP (tombstone idiom: still dirty, or the flush already landed it)',
      !!((m && m.keys && m.keys.tracker && m.keys.tracker.t > m.keys.tracker.s) ||
        (server.docs.tracker && server.docs.tracker.v && server.docs.tracker.v.status === 'idle')),
      JSON.stringify(m && m.keys && m.keys.tracker) + ' / server: ' + JSON.stringify(server.docs.tracker && server.docs.tracker.v));
  }
  {
    const server = makeServer();
    serverSet(server, 'tracker', IDLE, 5000);
    const P = makeWorld(server, {
      local: [['tracker', RUNNING], ['sessions', []], ['dsp_list', [DSP_OPEN]]],
      meta: JSON.parse(JSON.stringify(META_TICKING))
    });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    eq('S3 negative: no close proof anywhere — a live day is never killed by an old idle copy', (P.get('tracker') || {}).status, 'running');
  }
  {
    /* S4 uses the REAL today for its pin: with a fixed past
       date the v303 stale-shell rule (previous-day pin) buries
       the echo on web 410 too and the shape proves nothing. */
    const nowD = new Date();
    const pinToday = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate(), 8, 0, 0, 0).getTime();
    const today = todayStrOf(nowD);
    const runToday = { status: 'running', sessionId: pinToday, startTs: pinToday, elapsed: 120 };
    const dspDoneToday = { id: 'd1', status: 'completed', scheduledAt: today + 'T08:00', date: today, jobSite: 'Aecon Trans' };
    const dspOpenToday = { id: 'd1', status: 'saved', scheduledAt: today + 'T08:00', date: today, jobSite: 'Aecon Trans' };
    const server = makeServer();
    serverSet(server, 'dsp_list', [dspDoneToday], 5000);
    serverSet(server, 'tracker', runToday, 6000);
    const P = makeWorld(server, {
      local: [['tracker', IDLE], ['sessions', []], ['dsp_list', [dspOpenToday]]],
      meta: { uid: 'u1', globallySynced: true, keys: { tracker: { t: 4000, s: 4000, u: 'u1' }, dsp_list: { t: 4000, s: 4000, u: 'u1' } } }
    });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    eq('S4 resurrection refused: local idle + cloud running echo + completed dispatch in the incoming docs = closed wins', (P.get('tracker') || {}).status, 'idle');
  }

  /* ---------------- A: app.js tracker regions ---------------- */
  section('A — app.js: heal + adoption on the closed-day proof');
  fakeNow = msOf(2026, 11, 10, 20, 0);
  {
    const w = makeAppWorld({ tracker: RUNNING, sessions: [], dspList: [DSP_DONE] });
    eq('A1 healClosedTracker fires on the completed-dispatch proof alone', w.H.healClosedTracker(), true);
    eq('A1 the tracker stands down to idle', w.sb.App.tracker.status, 'idle');
    ok('A1 the native session is stopped', w.bridge.stoppedLog.length >= 1);
    eq('A1 nothing is booked by the heal (the close already booked the day)', w.mem.sessions.length, 0);
  }
  {
    const w = makeAppWorld({ tracker: RUNNING, sessions: [ENTRY], dspList: [] });
    eq('A2 healClosedTracker still fires on the v352 finished twin', w.H.healClosedTracker(), true);
    eq('A2 the tracker stands down to idle', w.sb.App.tracker.status, 'idle');
  }
  {
    const w = makeAppWorld({ tracker: IDLE, sessions: [], dspList: [DSP_DONE] });
    const rec = { rev: 5, status: 'running', sessionKey: 's' + START, elapsedBase: SECS, segStartMs: fakeNow - 60000, updatedAt: fakeNow, stateAt: fakeNow - 1000, src: 'arm', loads: 0, loadsManual: 0, loadsArmed: false, loadsCorr: 0, elapsedSec: SECS + 60 };
    w.H.adoptSessionRecord(rec);
    await pump();
    eq('A3 a closed day’s native record is never adopted — the web tracker stays idle', w.sb.App.tracker.status, 'idle');
    ok('A3 the record is ENDED with this layer’s idle facts (force sync)',
      w.bridge.syncLog.some(function (f) { return f.status === 'idle' && f.force === true; }),
      JSON.stringify(w.bridge.syncLog));
  }
  {
    const w = makeAppWorld({ tracker: IDLE, sessions: [], dspList: [] });
    const rec = { rev: 5, status: 'running', sessionKey: 's' + START, elapsedBase: 600, segStartMs: fakeNow - 60000, updatedAt: fakeNow, stateAt: fakeNow - 1000, src: 'arm', loads: 0, loadsManual: 0, loadsArmed: false, loadsCorr: 0, elapsedSec: 660 };
    w.H.adoptSessionRecord(rec);
    await pump();
    eq('A4 v93 preserved: an OPEN day’s arm-seeded record is still adopted', w.sb.App.tracker.status, 'running');
  }
  section('A — app.js: one shift, one booking');
  {
    const w = makeStopWorld({ sessions: [ENTRY] });
    w.sb.__stop(START + SECS * 1000);
    eq('A5 a stop whose session is already booked writes NO second entry', w.mem.sessions.length, 1);
    eq('A5 and posts NO second Revenue line', w.calls.onSession, 0);
    eq('A5 but the tracker still stands down to idle (the close law)', w.sb.App.tracker.status, 'idle');
  }
  {
    const w = makeStopWorld({ sessions: [] });
    w.sb.__stop(START + SECS * 1000);
    eq('A6 a first stop books exactly one entry', w.mem.sessions.length, 1);
    eq('A6 and posts its Revenue line once', w.calls.onSession, 1);
  }

  /* ---------------- E: autostart engine ---------------- */
  section('E — autostart: one dispatch, one session');
  {
    const past = Date.now() - 10 * 60000;
    const w = makeASWorld({ id: 'e1', jobSite: 'Aecon Trans', scheduledAt: null, date: null, status: 'saved' });
    w.mem.dsp_list[0].scheduledAt = w.today + 'T' + hhmm(past);
    w.mem.dsp_list[0].date = w.today;
    const anchor = (function () { const d = new Date(past); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), 0, 0).getTime(); })();
    const r1 = w.sb.App.checkAutoStart();
    const sid1 = w.sb.App.tracker.sessionId;
    const r2 = w.sb.App.checkAutoStart();
    const r3 = w.sb.App.checkAutoStart();
    eq('E1 first trigger starts the session', r1, 'started');
    eq('E1 repeated triggers are no-ops (fired)', r2 + ',' + r3, 'fired,fired');
    eq('E1 exactly one native session was started', w.calls.sessionStarted.length, 1);
    eq('E1 the session identity is the plan ANCHOR itself (the arm’s own key)', sid1, anchor);
    eq('E1 the identity never moves across triggers', w.sb.App.tracker.sessionId, sid1);
  }
  {
    const future = Date.now() + 50 * 60000;
    const w = makeASWorld({ id: 'e2', jobSite: 'Aecon Trans', status: 'saved' });
    w.mem.dsp_list[0].scheduledAt = w.today + 'T' + hhmm(future);
    w.mem.dsp_list[0].date = w.today;
    eq('E2 before the plan time nothing starts', w.sb.App.checkAutoStart(), 'not-yet');
    eq('E2 the next plan reads the dispatch time', w.sb.App.autostartNextInfo().time, hhmm(future));
    const past = Date.now() - 5 * 60000;
    w.mem.dsp_list[0].scheduledAt = w.today + 'T' + hhmm(past);   // the edit, exactly as dspApplyEdit stores it
    const anchor = (function () { const d = new Date(past); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), 0, 0).getTime(); })();
    eq('E2 the start follows the edit on the next check', w.sb.App.checkAutoStart(), 'started');
    eq('E2 and the edited plan yields exactly one session', w.calls.sessionStarted.length, 1);
    eq('E2 pinned at the EDITED anchor', w.sb.App.tracker.sessionId, anchor);
    eq('E2 a further trigger is a no-op', w.sb.App.checkAutoStart(), 'fired');
    eq('E2 still exactly one session', w.calls.sessionStarted.length, 1);
  }

  /* ---------------- G: shifttrack glue ---------------- */
  section('G — shifttrack: one arm per dispatch; boot stops a closed day');
  {
    const w = makeShiftWorld({});
    await w.ST.armDay({ key: 's111', fireMs: 1000, startMs: 2000, date: '2026-11-10' });
    await flush(4);
    await w.ST.armDay({ key: 's222', fireMs: 3000, startMs: 4000, date: '2026-11-10' });
    await flush(4);
    const seq = w.calls.map(function (c) { return c[0] + (c[1] ? ':' + c[1] : ''); }).join(' ');
    ok('G1 re-arming under a new key disarms the old arm first', seq.indexOf('armDay:s111') !== -1 && seq.indexOf('disarmDay') > seq.indexOf('armDay:s111') && seq.indexOf('armDay:s222') > seq.indexOf('disarmDay'), seq);
    eq('G1 the stored arm is the new key', (w.store.get('dayarm', null) || {}).key, 's222');
    const disarms = w.calls.filter(function (c) { return c[0] === 'disarmDay'; }).length;
    await w.ST.armDay({ key: 's222', fireMs: 3000, startMs: 4000, date: '2026-11-10' });
    await flush(4);
    eq('G1 a repeat of the same arm stays a no-op (no extra disarm)', w.calls.filter(function (c) { return c[0] === 'disarmDay'; }).length, disarms);
  }
  {
    const nowD = new Date();
    const pinToday = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate(), 8, 0, 0, 0).getTime();
    const today = todayStrOf(nowD);
    const dspDoneToday = { id: 'd1', status: 'completed', scheduledAt: today + 'T08:00', date: today, jobSite: 'Aecon Trans' };
    const status = { available: true, sessionActive: true, sessionKey: 's' + pinToday, armed: false, armStarted: false };
    const rec = { status: 'running', sessionKey: 's' + pinToday, elapsedBase: 3600, segStartMs: pinToday, rev: 3, updatedAt: Date.now() };
    const w = makeShiftWorld({ status: status, record: rec, seed: [['sessions', []], ['dsp_list', [dspDoneToday]], ['dsp_active', null]] });
    w.ST.syncOnBoot();
    await flush();
    ok('G2 syncOnBoot stops the native session of a CLOSED day (drain + stop)', w.calls.some(function (c) { return c[0] === 'stop'; }), JSON.stringify(w.calls));
  }
  {
    const nowD = new Date();
    const pinToday = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate(), 8, 0, 0, 0).getTime();
    const status = { available: true, sessionActive: true, sessionKey: 's' + pinToday, armed: true, armStarted: true, armSessionKey: 's' + pinToday, armStartMs: pinToday };
    const rec = { status: 'running', sessionKey: 's' + pinToday, elapsedBase: 600, segStartMs: pinToday, rev: 3, updatedAt: Date.now() };
    const w = makeShiftWorld({ status: status, record: rec, seed: [['sessions', []], ['dsp_list', []], ['dsp_active', null]] });
    w.ST.syncOnBoot();
    await flush();
    ok('G3 v93 preserved: an OPEN day’s armed native session is left standing at boot', !w.calls.some(function (c) { return c[0] === 'stop'; }), JSON.stringify(w.calls));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR', e && e.stack || e); process.exit(2); });
