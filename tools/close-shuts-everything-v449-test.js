/* CLOSE-SHUTS-EVERYTHING — end-to-end bench (owner, Fri Nov 13,
 * 2026, 08:45 CST): "Did you make sure that if I close the shift —
 * either the Stop button on the timer or in the dispatch — one
 * closing should close everything? I should not have to close it
 * everywhere else by itself."
 *
 * THE LAW: closing a shift from ANY single place — (a) the
 * timer's Stop, or (b) the dispatch close-out — closes
 * EVERYTHING: the day is closed, the dispatch record stands
 * completed, dsp_active is clear, the live timer stops on every
 * surface (tracker card, widget, bubble, native record) on every
 * device, and a closed day can NEVER resurrect — not at sync,
 * boot, reopen, or via any echo of stale local state. A manual
 * timer Stop closes that day's dispatch with it, no second step.
 *
 * STATE OF PLAY on the bytes this bench first ran against
 * (web 447):
 *   - The dispatch close (b) completes the record and stops the
 *     session in its own lifetime (v82), and webs 425/440 made
 *     the TIMER verdict survive the phone's stale echoes (the
 *     closed-day proof's three prongs). The close-echo bench
 *     proves those legs; this bench re-runs its B replay with
 *     the assertions 440 never made — the cloud list's survival
 *     is asserted there since v445; the dsp_active snapshot's
 *     fate is asserted HERE for the first time.
 *   - The timer Stop (a) NEVER TOUCHED THE DISPATCH: the real
 *     stopSessionAt books the session + Revenue and stands the
 *     timer down, but app.js writes dsp_list / dsp_active
 *     NOWHERE, and the End-shift review says so in plain words
 *     ("Your dispatch is still open — ending the shift does not
 *     close it. Close it from the Dispatch card..."). The day
 *     the owner stops from the timer stays OPEN in Dispatch on
 *     every surface until somebody closes it a second time —
 *     the exact complaint. Part A proves it, then proves the
 *     fix.
 *   - dsp_active is a whole-doc key settled by stamps: a
 *     phone-side re-save of the stale snapshot stamped after a
 *     remote close wins its local stamp game and pushes back
 *     UP, resurrecting an ACTIVE dispatch on the face of a day
 *     every other gate agrees is closed — one tap on Complete
 *     away from a second, stale-facts close (a duplicate travel
 *     claim rides it: claims append, they do not key-replace).
 *     Section S-B probes that shape; the pull must heal the
 *     snapshot against the list it just merged.
 *   - The dsp_list union (v445) arbitrates same-record copies
 *     by field-count completeness, tie to the local copy. A
 *     completed copy built from a leaner twin can TIE or LOSE
 *     to a stale open copy that gained a mid-day field offline
 *     (an edit in a dead zone — his working conditions). The
 *     v424 pull repair already ruled completion is one-way
 *     evidence, wholesale, on the pull side; the merge itself
 *     never got the rule. Sections S-T probe both shapes.
 *
 * Sections:
 *   A — the REAL stopSessionAt (brace-extracted, v411 rig):
 *       the timer-Stop close, its guards, its no-double-book
 *       shapes.
 *   S — sync worlds (the close-echo rig: real cloudsync + real
 *       app.js tracker regions over a shared fake server):
 *       S-A the timer-stop close crossing to a second device;
 *       S-B the dispatch close's full blast radius incl. the
 *           dsp_active resurrection shape + the re-close guard;
 *       S-T the union arbitration probes;
 *       S-C the open-day guard (nothing heals, nothing closes).
 *   P — source pins for the End-shift review's words.
 *
 * Run: node tools/close-shuts-everything-v449-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');
const csSrc = read('js/cloudsync.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + extra : '')); }
}
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
function section(s) { console.log('\n— ' + s + ' —'); }

/* ---------- fixtures: a fixed past day (the run's yesterday) ---------- */
const RealDate = Date;
const day0 = new RealDate(); day0.setUTCHours(0, 0, 0, 0);
const DAY = new RealDate(day0.getTime() - 86400000);        // yesterday, UTC midnight
const DAYM1 = new RealDate(DAY.getTime() - 86400000);      // the day before
function atDay(hh, mm) { return DAY.getTime() + (hh * 60 + (mm || 0)) * 60000; }
function todayStrOf(d) {
  d = d || new FakeDate();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const TODAY = todayStrOf(new RealDate(DAY.getTime() + 12 * 3600000));
const YDAY = todayStrOf(new RealDate(DAYM1.getTime() + 12 * 3600000));
let fakeNow = atDay(17, 0);
class FakeDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fakeNow])); }
  static now() { return fakeNow; }
}
const PINMS = atDay(9, 0);                                   // the 9:00 AM session pin
const ENDMS = atDay(17, 0);                                  // the 5:00 PM stop
/* The day's dispatch, as the morning left it on every surface:
   activated (status 'active' in BOTH copies — dspActivateRecord
   writes list + snapshot together). */
const DSP_ACTIVE = { id: 'dspT', status: 'active', scheduledAt: TODAY + 'T09:00', date: TODAY,
  jobSite: 'Aecon Trans', loads: '7', startedAt: PINMS };
const DSP_SAVED = { id: 'dspS', status: 'saved', scheduledAt: TODAY + 'T18:00', date: TODAY, jobSite: 'Evening job' };
const DSP_YDAY_ACTIVE = { id: 'dspY', status: 'active', scheduledAt: YDAY + 'T08:00', date: YDAY,
  jobSite: 'Other job', startedAt: DAYM1.getTime() + 8 * 3600000 };
const DSP_DONE = { id: 'dspT', status: 'completed', scheduledAt: TODAY + 'T09:00', date: TODAY,
  jobSite: 'Aecon Trans', loads: '7', startedAt: PINMS,
  endedAt: new RealDate(atDay(16, 47)).toISOString() };      // closed 16:47 from the web
const REV_DONE = { dspId: 'dspT', date: TODAY, amount: 261, hours: 9, note: 'Dispatch: Aecon Trans' };

/* =================================================================
 * A — the real stopSessionAt (the v411 stop-world, dsp-wired)
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
  const mem = {
    sessions: opts.sessions || [], onboarding: {},
    dsp_active: (opts.dspActive === undefined ? null : opts.dspActive),
    dsp_list: opts.dspList || [], rev_entries: opts.revEntries || []
  };
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const calls = { onSession: 0, saveDoc: [], stopped: 0 };
  const sb = {
    console: console, Promise: Promise, Date: FakeDate, Math: Math, JSON: JSON,
    store: store, todayStr: todayStrOf,
    window: null,
    App: {
      tracker: { status: 'running', sessionId: PINMS, startTs: atDay(16, 30), elapsed: 27000, profileId: 'p1' },
      armNativeDay: function () {},
      workProfiles: { activeId: function () { return 'p1'; }, keyFor: function (k) { return k; } }
    },
    Meticulous: { modules: { revenue: { onSession: function () { calls.onSession++; } } } },
    FB: { saveDoc: function (col, id) { calls.saveDoc.push(col + ':' + id); } },
    ShiftTrack: { sessionStopped: function () { calls.stopped++; } },
    _stopViaDispatch: !!opts.viaDispatch, _endTicketPhoto: null,
    trackerSave: function () {}, trackerPaint: function () {},
    trackerSessionKeyMs: function () { return PINMS; },
    trackerSessionStartMs: function () { return PINMS; },
    takePendingStartOdo: function () { return null; },
    takePendingStartOdoPhoto: function () { return null; },
    applyEndOdoToEntry: function () {},
    takeSessionAccum: function () {},
    maybePromptOdo: function () {},
    dayEngineStop: function () {},
    autostartDispatchFor: function () { return null; },
    closedDayProof411: function () { return false; }
  };
  sb.window = sb;
  let code = extractFn(appSrc, 'function trackedSecondsAt(endMs)') + '\n' +
    extractFn(appSrc, 'function closeTravelFor(dayStr)') + '\n';
  /* the fix's helper rides along when the shipped bytes carry it */
  if (appSrc.indexOf('function closeDispatchOnStop449(') !== -1) {
    code += extractFn(appSrc, 'function closeDispatchOnStop449(dayStr, endMs)') + '\n';
  }
  code += extractFn(appSrc, 'function stopSessionAt(endMs, endOdoVal)');
  vm.createContext(sb);
  vm.runInContext(code + '\n;this.__stop = stopSessionAt;', sb);
  return { sb: sb, mem: mem, calls: calls };
}
async function pump() { for (let i = 0; i < 10; i++) await new Promise(function (r) { setImmediate(r); }); }
function settle(ms) { return new Promise(function (r) { setTimeout(r, ms || 800); }); }

/* =================================================================
 * S — sync worlds (the close-echo rig, shared server, two devices)
 * ================================================================= */
function makeServer() { return { docs: {}, clock: 0 }; }
function serverSet(server, id, v, updatedAt) {
  server.docs[id] = { id: id, v: v, updatedAt: updatedAt || (RealDate.now() + (server.clock += 7)) };
}
function makeBridge() {
  const rec = { status: 'idle', elapsedBase: 0, segStartMs: 0, loads: 0, loadsManual: 0,
    loadsArmed: false, loadsCorr: 0, milesM: -1, stateAt: 0, rev: 0, updatedAt: 0, src: '', sessionKey: '' };
  function elapsedSec(now) {
    let s = rec.elapsedBase;
    if (rec.status === 'running' && rec.segStartMs > 0) s += Math.max(0, Math.floor((now - rec.segStartMs) / 1000));
    return Math.max(0, s);
  }
  function snap() {
    return { status: rec.status, elapsedBase: rec.elapsedBase, segStartMs: rec.segStartMs,
      elapsedSec: elapsedSec(fakeNow), loads: rec.loads, loadsManual: rec.loadsManual,
      loadsArmed: rec.loadsArmed, loadsCorr: rec.loadsCorr, milesM: rec.milesM,
      stateAt: rec.stateAt, rev: rec.rev, updatedAt: rec.updatedAt, src: rec.src, sessionKey: rec.sessionKey };
  }
  const bridge = {
    rec: rec, snap: snap, syncLog: [], stoppedLog: [],
    seed: function (fields) { Object.keys(fields).forEach(function (k) { rec[k] = fields[k]; }); },
    sessionSync: function (facts) {
      bridge.syncLog.push(JSON.parse(JSON.stringify(facts)));
      if (!facts.force && facts.baseRev !== rec.rev) {
        const d = snap(); d.applied = false; return Promise.resolve(d);
      }
      let status = facts.status;
      if (status !== 'running' && status !== 'paused' && status !== 'idle') status = 'idle';
      rec.status = status; rec.elapsedBase = facts.elapsed; rec.segStartMs = facts.startTs || 0;
      rec.loads = facts.loads; rec.loadsManual = facts.loadsManual; rec.loadsArmed = facts.loadsArmed;
      rec.milesM = (facts.milesM == null ? -1 : facts.milesM); rec.loadsCorr = 0;
      rec.stateAt = Math.max(rec.stateAt, facts.stateAt || 0);
      rec.rev += 1; rec.updatedAt = fakeNow; rec.src = 'web';
      rec.sessionKey = facts.sessionKey || '';
      const d = snap(); d.applied = true; return Promise.resolve(d);
    },
    sessionRecord: function () { return Promise.resolve(snap()); },
    sessionStopped: function (k) { bridge.stoppedLog.push(k); },
    sessionStarted: function () {},
    setSession: function () {},
    sessionRestored: function () {}
  };
  return bridge;
}
function sliceBetween(s, startMark, endMark, endIncl) {
  const a = s.indexOf(startMark);
  const b = s.indexOf(endMark);
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + startMark + ' .. ' + endMark);
  return s.slice(a, endIncl ? b + endMark.length : b);
}
const regionA = sliceBetween(appSrc, 'function trackerSave() {', 'App.collectSessionRecord = collectSessionRecord;', true);
const regionB = sliceBetween(appSrc, '/* ---------------- v28: backdate', 'App.trackerToggle = function', false);
const regionC = sliceBetween(appSrc, 'function payMode() {', '/* v82 (item 3b)', false);
const regionCode = regionA + '\n' + regionB + '\n' + regionC;

function makeDevice(server, seed) {
  const data = {};
  const localStorage = {
    getItem: function (k) { return (k in data) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    removeItem: function (k) { delete data[k]; },
    key: function (i) { return Object.keys(data)[i] || null; },
    get length() { return Object.keys(data).length; }
  };
  Object.keys(seed.data).forEach(function (k) { data['mt_' + k] = JSON.stringify(seed.data[k]); });
  data['mt___syncmeta'] = JSON.stringify({ uid: 'u1', globallySynced: true, keys: seed.meta });
  const bridge = makeBridge();
  if (seed.bridge) bridge.seed(seed.bridge);
  const device = { data: data, localStorage: localStorage, bridge: bridge };
  device.newWorld = function () {
    const csb = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, Promise: Promise };
    csb.window = csb;
    csb.localStorage = localStorage;
    csb.navigator = { onLine: true };
    csb.document = { getElementById: function () { return null; }, addEventListener: function () {} };
    csb.addEventListener = function () {};
    csb.FB = {
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
    vm.createContext(csb);
    vm.runInContext(csSrc, csb);
    const store = {
      get: function (k, d) { const r = localStorage.getItem('mt_' + k); return r === null ? d : JSON.parse(r); },
      set: function (k, v) { localStorage.setItem('mt_' + k, JSON.stringify(v)); return true; },
      del: function (k) { localStorage.removeItem('mt_' + k); return true; }
    };
    csb.CloudSync.attach(store);
    return { csb: csb, store: store };
  };
  return device;
}
function makePage(device, world) {
  const genericEl = { value: '', textContent: '', innerHTML: '',
    classList: { add: function () {}, remove: function () {}, contains: function () { return false; } }, onclick: null };
  const psb = {
    console: console, Promise: Promise, Date: FakeDate, JSON: JSON, Math: Math,
    setTimeout: function () { return 0; }, clearTimeout: function () {},
    confirm: function () { return true; }, closeSidebar: function () {},
    fmtClock: function (s) { return String(s); },
    todayStr: todayStrOf,
    el: function () { return genericEl; },
    store: world.store, App: { tracker: null },
    trackerPaint: function () {}, paintHero: function () {}, paintBubble: function () {},
    pushWidgetState: function () {}, lastBubbleFacts: function () { return {}; },
    ShiftTrack: device.bridge
  };
  psb.window = psb;
  vm.createContext(psb);
  vm.runInContext(regionCode + '\n;this.__H = { healClosedTracker: healClosedTracker, closedDayProof411: closedDayProof411 };', psb);
  psb.App.tracker = world.store.get('tracker', null);        // init's load
  psb.App._sessRev = device.bridge.rec.rev; psb.App._lastStateAt = 0; psb.App._lastLoadsAt = 0;
  return { sb: psb, H: psb.__H };
}
/* one reopen lifetime on a device: fresh world + page, the
   sign-in pull, onAuth's re-read, the boot collect, two heals */
async function reopen(device) {
  const world = device.newWorld();
  const page = makePage(device, world);
  world.csb.CloudSync.onAuth({ uid: 'u1' });
  await settle(900);
  page.sb.App.tracker = world.store.get('tracker', page.sb.App.tracker);
  await page.sb.App.collectSessionRecord(); await pump();
  fakeNow += 61000; page.H.healClosedTracker();
  fakeNow += 61000; await page.sb.App.collectSessionRecord(); await pump();
  return { page: page, world: world };
}
function settledMeta(keys) {
  const m = {};
  keys.forEach(function (k) { m[k] = { t: 1, s: 1, u: 'u1' }; });
  return m;
}
const TRACK_RUN = { status: 'running', sessionId: PINMS, startTs: atDay(16, 30), elapsed: 27000, stateAt: atDay(16, 30) };
const BRIDGE_RUN = { status: 'running', elapsedBase: 27000, segStartMs: atDay(16, 30), loads: 6, loadsManual: 0,
  loadsArmed: true, loadsCorr: 1, milesM: 116200, stateAt: atDay(16, 30), rev: 5,
  updatedAt: atDay(16, 37), src: 'web', sessionKey: 's' + PINMS };

(async function () {
  /* ================= A — the timer Stop itself ================= */
  section('A1 timer Stop on a dispatched day — the Stop must close the dispatch with it');
  {
    fakeNow = ENDMS;
    const w = makeStopWorld({ dspList: [DSP_ACTIVE], dspActive: DSP_ACTIVE });
    w.sb.__stop(ENDMS, '');
    eq('A1 the session books exactly once', w.mem.sessions.length, 1);
    eq('A1 Revenue is told exactly once', w.calls.onSession, 1);
    eq('A1 the day\u2019s dispatch stands COMPLETED in the list', (w.mem.dsp_list[0] || {}).status, 'completed');
    eq('A1 the completion carries the stop\u2019s own end time', (w.mem.dsp_list[0] || {}).endedAt, new RealDate(ENDMS).toISOString());
    eq('A1 dsp_active is cleared', w.mem.dsp_active, null);
    eq('A1 the tracker stands idle', w.sb.App.tracker.status, 'idle');
    ok('A1 the native service was told to stop', w.calls.stopped > 0);
    ok('A1 the closed record mirrors to the cloud doc (dispatches, like a completion)',
      w.calls.saveDoc.indexOf('dispatches:dspT') !== -1, JSON.stringify(w.calls.saveDoc));
  }
  section('A2 timer Stop with NO dispatch that day — books normally, touches nothing');
  {
    fakeNow = ENDMS;
    const w = makeStopWorld({ dspList: [], dspActive: null });
    w.sb.__stop(ENDMS, '');
    eq('A2 the session books', w.mem.sessions.length, 1);
    eq('A2 dsp_list untouched', w.mem.dsp_list.length, 0);
    eq('A2 dsp_active stays null', w.mem.dsp_active, null);
  }
  section('A3 guards — a saved (never started) dispatch and yesterday\u2019s stale active are NOT closed by today\u2019s Stop');
  {
    fakeNow = ENDMS;
    const w = makeStopWorld({ dspList: [DSP_YDAY_ACTIVE, DSP_SAVED], dspActive: null });
    w.sb.__stop(ENDMS, '');
    eq('A3 yesterday\u2019s record keeps its status', (w.mem.dsp_list[0] || {}).status, 'active');
    eq('A3 today\u2019s saved record keeps its status', (w.mem.dsp_list[1] || {}).status, 'saved');
    eq('A3 the session still books', w.mem.sessions.length, 1);
  }
  section('A4 the dispatch-close funnel (record already completed) — the Stop books NOTHING and moves NOTHING');
  {
    fakeNow = ENDMS;
    const w = makeStopWorld({ dspList: [DSP_DONE], dspActive: null, viaDispatch: true });
    w.sb.__stop(ENDMS, '');
    eq('A4 no session entry is written', w.mem.sessions.length, 0);
    eq('A4 Revenue is not told', w.calls.onSession, 0);
    eq('A4 the completed record\u2019s own endedAt stands', (w.mem.dsp_list[0] || {}).endedAt, DSP_DONE.endedAt);
    eq('A4 the tracker stands idle', w.sb.App.tracker.status, 'idle');
  }
  section('A5 a second Stop on an already timer-closed day books nothing twice');
  {
    fakeNow = ENDMS;
    const twin = { date: TODAY, seconds: 28800, endedAt: new RealDate(ENDMS).toISOString() };
    const w = makeStopWorld({ dspList: [DSP_DONE], dspActive: null, sessions: [twin] });
    w.sb.__stop(ENDMS, '');
    eq('A5 the sessions list is unchanged', w.mem.sessions.length, 1);
    eq('A5 Revenue is not told again', w.calls.onSession, 0);
  }

  /* ================= S-A — the timer-stop close crosses devices ================= */
  section('S-A timer Stop on the phone — a second device converges closed on its next pull');
  {
    fakeNow = ENDMS;
    const server = makeServer();
    const sessEntry = { date: TODAY, seconds: 28800, endedAt: new RealDate(ENDMS).toISOString() };
    const autoRev = { date: TODAY, type: 'hourly', hours: '8.00', amount: '232.00', note: 'Auto from tracker', auto: true };
    /* device W (the web surface) still holds the morning state */
    serverSet(server, 'tracker', TRACK_RUN);
    serverSet(server, 'dsp_list', [DSP_ACTIVE]);
    serverSet(server, 'dsp_active', DSP_ACTIVE);
    serverSet(server, 'sessions', []);
    serverSet(server, 'rev_entries', []);
    const devW = makeDevice(server, {
      data: { tracker: TRACK_RUN, dsp_list: [DSP_ACTIVE], dsp_active: DSP_ACTIVE, sessions: [], rev_entries: [] },
      meta: settledMeta(['tracker', 'dsp_list', 'dsp_active', 'sessions', 'rev_entries']),
      bridge: BRIDGE_RUN
    });
    /* the phone's stop lands in the cloud (its flush): idle
       tracker, the booked session, the auto Revenue line — and,
       post-fix, the completed list + the cleared snapshot */
    serverSet(server, 'tracker', { status: 'idle', startTs: 0, elapsed: 0, stateAt: ENDMS });
    serverSet(server, 'sessions', [sessEntry]);
    serverSet(server, 'rev_entries', [autoRev]);
    serverSet(server, 'dsp_list', [DSP_DONE]);
    serverSet(server, 'dsp_active', null);
    const r = await reopen(devW);
    eq('S-A the second device\u2019s list shows the day COMPLETED', (r.world.store.get('dsp_list', [])[0] || {}).status, 'completed');
    eq('S-A the second device\u2019s dsp_active is clear', r.world.store.get('dsp_active', null), null);
    eq('S-A the second device\u2019s stored tracker idles at the pull', r.world.store.get('tracker', {}).status, 'idle');
    ok('S-A the closed-day proof holds on the second device', r.page.H.closedDayProof411(PINMS) === true);
    eq('S-A the page does NOT resurrect', r.page.sb.App.tracker.status, 'idle');
    eq('S-A the native record stands idle', devW.bridge.rec.status, 'idle');
  }

  /* ================= S-B — the dispatch close's blast radius ================= */
  section('S-B dispatch closed on the web; the phone flushes stale list AND stale snapshot; reopen must converge ALL of it');
  {
    fakeNow = atDay(16, 48);
    const server = makeServer();
    serverSet(server, 'tracker', TRACK_RUN);
    serverSet(server, 'dsp_list', [DSP_ACTIVE]);
    serverSet(server, 'dsp_active', DSP_ACTIVE);
    serverSet(server, 'sessions', []);
    serverSet(server, 'rev_entries', []);
    const phone = makeDevice(server, {
      data: { tracker: TRACK_RUN, dsp_list: [DSP_ACTIVE], dsp_active: DSP_ACTIVE, sessions: [], rev_entries: [] },
      meta: settledMeta(['tracker', 'dsp_list', 'dsp_active', 'sessions', 'rev_entries']),
      bridge: BRIDGE_RUN
    });
    const world = phone.newWorld();
    makePage(phone, world);
    world.csb.CloudSync.onAuth({ uid: 'u1' });          // the morning sign-in
    await settle(900);
    /* 16:47 — the web close lands (list + idle tracker + rev) */
    serverSet(server, 'dsp_list', [DSP_DONE]);
    serverSet(server, 'tracker', { status: 'idle', startTs: 0, elapsed: 0, stateAt: atDay(16, 47) });
    serverSet(server, 'rev_entries', [REV_DONE]);
    serverSet(server, 'dsp_active', null);
    /* 16:48 — his full close: pagehide flushUrgent, no pull
       first; the phone's dirty keys include the tracker's
       standing re-save AND phone-side dsp writes of the Nov 11
       class — the list AND the active snapshot, both stale */
    world.store.set('tracker', TRACK_RUN);
    world.store.set('dsp_list', [DSP_ACTIVE]);
    world.store.set('dsp_active', DSP_ACTIVE);
    await settle(2800);
    try { world.csb.CloudSync.flush(); } catch (e) {}
    await settle(600);
    eq('S-B the flush cannot roll the cloud list back (v445 union)', (server.docs['dsp_list'].v[0] || {}).status, 'completed');
    eq('S-B the flush cannot resurrect the cloud\u2019s active snapshot',
      (server.docs['dsp_active'] ? server.docs['dsp_active'].v : null), null);
    fakeNow = atDay(16, 50);
    if (phone.bridge.rec.status !== 'idle') phone.bridge.seed({ updatedAt: fakeNow });
    const r = await reopen(phone);
    eq('S-B the phone\u2019s list stands COMPLETED', (r.world.store.get('dsp_list', [])[0] || {}).status, 'completed');
    eq('S-B the phone\u2019s dsp_active is CLEAR — the Dispatch face offers no second close', r.world.store.get('dsp_active', null), null);
    eq('S-B the phone\u2019s stored tracker idles', r.world.store.get('tracker', {}).status, 'idle');
    eq('S-B the page does NOT resurrect', r.page.sb.App.tracker.status, 'idle');
    eq('S-B the native record stands idle', phone.bridge.rec.status, 'idle');
    const eB = phone.bridge.snap().elapsedSec;
    fakeNow += 600000;
    eq('S-B the widget/bubble clock is FROZEN at the close', phone.bridge.snap().elapsedSec, eB);
    /* the re-close temptation, timer side: a Stop tapped on the
       healed phone store must book NOTHING (v411/v424 guards,
       driven here over the real store the reopen left) */
    const w2 = makeStopWorld({
      dspList: r.world.store.get('dsp_list', []), dspActive: r.world.store.get('dsp_active', null),
      sessions: r.world.store.get('sessions', []), viaDispatch: false
    });
    w2.sb.App.tracker = { status: 'running', sessionId: PINMS, startTs: atDay(16, 30), elapsed: 27000, profileId: 'p1' };
    w2.sb.__stop(fakeNow, '');
    eq('S-B a Stop after the close books no second session', w2.mem.sessions.length, 0);
    eq('S-B a Stop after the close tells Revenue nothing', w2.calls.onSession, 0);
  }

  /* ================= S-T — the union arbitration probes ================= */
  section('S-T a completed copy must win the union against a stale open copy of EQUAL or GREATER field count');
  {
    /* the open copy gained a mid-day field offline (note) AND
       kept a top-level photo the close folded into its ticket:
       completeness(open) == completeness(completed) + 1 */
    const DSP_OPEN_FAT = { id: 'dspT', status: 'active', scheduledAt: TODAY + 'T09:00', date: TODAY,
      jobSite: 'Aecon Trans', loads: '7', startedAt: PINMS, photo: 'data:photo-top', note: 'gate code 4419' };
    const DSP_DONE_LEAN = { id: 'dspT', status: 'completed', scheduledAt: TODAY + 'T09:00', date: TODAY,
      jobSite: 'Aecon Trans', loads: '7', startedAt: PINMS, endedAt: new RealDate(atDay(16, 47)).toISOString(),
      tickets: [{ id: 't1', photo: 'data:photo-top', loads: '7' }] };
    fakeNow = atDay(16, 48);
    const server = makeServer();
    serverSet(server, 'dsp_list', [DSP_DONE_LEAN]);
    serverSet(server, 'rev_entries', [REV_DONE]);
    const phone = makeDevice(server, {
      data: { dsp_list: [DSP_OPEN_FAT], rev_entries: [] },
      meta: settledMeta(['dsp_list', 'rev_entries'])
    });
    const world = phone.newWorld();
    world.csb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    /* the phone never pulled the close; its pagehide flush
       pushes its stale list up (read-merge-write) */
    world.store.set('dsp_list', [DSP_OPEN_FAT]);
    await settle(2800);
    try { world.csb.CloudSync.flush(); } catch (e) {}
    await settle(600);
    eq('S-T the cloud keeps the COMPLETED record against the fatter stale open copy',
      (server.docs['dsp_list'].v[0] || {}).status, 'completed');
    eq('S-T the phone\u2019s own store learns the COMPLETED record from its flush',
      (world.store.get('dsp_list', [])[0] || {}).status, 'completed');
  }

  /* ================= S-C — the open-day guard ================= */
  section('S-C an OPEN day: flush + reopen changes nothing — active survives, session runs');
  {
    fakeNow = atDay(16, 48);
    const server = makeServer();
    serverSet(server, 'tracker', TRACK_RUN);
    serverSet(server, 'dsp_list', [DSP_ACTIVE]);
    serverSet(server, 'dsp_active', DSP_ACTIVE);
    serverSet(server, 'sessions', []);
    serverSet(server, 'rev_entries', []);
    const phone = makeDevice(server, {
      data: { tracker: TRACK_RUN, dsp_list: [DSP_ACTIVE], dsp_active: DSP_ACTIVE, sessions: [], rev_entries: [] },
      meta: settledMeta(['tracker', 'dsp_list', 'dsp_active', 'sessions', 'rev_entries']),
      bridge: BRIDGE_RUN
    });
    const world = phone.newWorld();
    makePage(phone, world);
    world.csb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    world.store.set('tracker', TRACK_RUN);
    world.store.set('dsp_list', [DSP_ACTIVE]);
    world.store.set('dsp_active', DSP_ACTIVE);
    await settle(2800);
    try { world.csb.CloudSync.flush(); } catch (e) {}
    await settle(600);
    fakeNow = atDay(16, 50);
    if (phone.bridge.rec.status !== 'idle') phone.bridge.seed({ updatedAt: fakeNow });
    const r = await reopen(phone);
    eq('S-C the open day\u2019s dispatch stays ACTIVE in the list', (r.world.store.get('dsp_list', [])[0] || {}).status, 'active');
    eq('S-C the open day\u2019s dsp_active survives', (r.world.store.get('dsp_active', null) || {}).id, 'dspT');
    eq('S-C the open day\u2019s page restores RUNNING', r.page.sb.App.tracker.status, 'running');
    eq('S-C the heal does NOT fire on an open day', r.page.H.closedDayProof411(PINMS), false);
  }

  /* ================= P — the review's words ================= */
  section('P the End-shift review must not send him to Dispatch for a second close');
  {
    ok('P the old two-close instruction is GONE from app.js',
      appSrc.indexOf('ending the shift does not close it') === -1);
    ok('P the review names the one-close law in its place',
      appSrc.indexOf('closes with this shift') !== -1);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('BENCH ERROR', e); process.exit(2); });
