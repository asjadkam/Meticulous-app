/* CLOSE-NOT-REACHING-PHONE-NOV11 — end-to-end bench.
 *
 * The owner's report, Nov 11, 2026, 18:48 CST, with a screen
 * recording: "Why on earth is this still ticking?" — followed by
 * "don't you dare ask me if I fully close the app and open it
 * again because you know I did."
 *
 * The evidence chain, all tonight, account asjadkamal482:
 *   18:23 CST — the Nov 11 Aecon Trans dispatch was closed on the
 *     WEB app (his explicit order). Verified on the web: dispatch
 *     Completed (card 28846, foreman 11 h + 1 travel = 12 h,
 *     loads 11, $348.00 Revenue), Dashboard "Ready to work",
 *     00:00:00, START button. The closing surface's own tracker
 *     was idle, so its v82 session stop was a no-op there — the
 *     close pushed NO tracker change and NO sessions entry: the
 *     only cloud evidence of the close is the completed dispatch
 *     record itself (plus its Revenue line).
 *   ~18:39 — the phone reopens (pull #1). ~18:48 — after a FULL
 *     close/reopen (pull #2, a fresh page lifetime), the in-app
 *     timer card still reads "Working… 09:45:52 · Counting from
 *     8:00 AM", PAUSE/STOP live, loads 10 (6 pegs · +4 taps),
 *     miles 226.4 km. Web 411's law — a closed day stands the
 *     phone's session down at the next sync/boot and can never
 *     resurrect — did not hold in his hands.
 *
 * The v411 suite judged each layer SEPARATELY (the real pull
 * against a stub store; the real app.js regions against a
 * trivial bridge; the real shifttrack.js in its own world) and
 * every layer passed. The break lives in the SEAMS, which no
 * shipped suite exercised end to end. Proven by this bench on
 * web 423 bytes, three seams compound:
 *
 *   SEAM 1 — THE TWO v411 IMPLEMENTATIONS READ DIFFERENT
 *   EVIDENCE. The pull-side rule (js/cloudsync.js) judges the
 *   tracker against the UNION of the local lists and the pull's
 *   INCOMING docs; tonight the incoming dsp_list carried the
 *   completed dispatch, so the pull DID idle the phone's stored
 *   tracker. But dsp_list is NOT a record-list key: it settles
 *   by the generic whole-doc stamp game, and a phone-side
 *   dsp_list write stamped after the close push (his close form
 *   was still open on the phone that evening; a boot re-save is
 *   the same class) makes the local OPEN list win — the
 *   completed record never lands in the store at all.
 *
 *   SEAM 2 — THE PAGE GATES RE-LITIGATE FROM THE STORE ALONE.
 *   adoptSessionRecord's v411 branch and healClosedTracker read
 *   only the post-merge store. With seam 1 the proof is false
 *   there forever: the heals never fire, and at the next page
 *   lifetime the adoption — its _lastStateAt reset to 0, the
 *   native record freshly written by its own service — adopts
 *   the RUNNING record wholesale. The page resurrects, and its
 *   flushes push the open list back UP, erasing the close from
 *   the cloud for every later pull.
 *
 *   SEAM 3 — THE RECORD IS NEVER TOLD IN THE CLOSE'S OWN
 *   LIFETIME. Even with friendly stamps (E1), the pull's v411
 *   reset stamps the stored tracker stateAt = now, so the boot
 *   collect's stateNewer contest (record.updatedAt vs the
 *   reset's stamp) refuses the adoption's idle branch entirely:
 *   the page goes idle but the native record — the thing the
 *   widget and bubble follow — keeps running, untold. The
 *   closed-day verdict is documentary, not a stamp race; the
 *   adoption must not judge it by one.
 *
 *   And the book: stopSessionAt's one-booking suppression (v411)
 *   knows only the finished-SESSIONS twin. A dispatch-completion
 *   close books no sessions entry, so a stop tapped on the
 *   still-running phone session would book Nov 11 a SECOND time
 *   (entry + Revenue.onSession) over the standing $348 record.
 *
 * The replay: the real js/cloudsync.js pull and the rea
...[truncated 17409 chars]l js/app.js tracker
 * regions share ONE localStorage across TWO page lifetimes
 * (the 18:39 reopen and the 18:48 full close/reopen); the
 * native record is the SessionRecord-faithful bridge of the
 * v423 suite (revision gate; an idle sync applies — gen 78/79's
 * v73/v85/v87 gates engage only on live incoming facts, so a
 * web stand-down is never refused natively; the break is
 * upstream of the record). Fixtures sit on a fixed past day so
 * the suite is wall-clock independent.
 *
 *   E1 — friendly stamps (the phone's last dsp write OLDER than
 *        the close push): the completed list installs by itself,
 *        yet on web 423 bytes the native record STILL is not
 *        stood down in lifetime 1 (seam 3) and only lifetime 2's
 *        collect saves it. Post-fix both lifetimes converge.
 *   E2 — TONIGHT: the phone's dsp_list stamp is NEWER than the
 *        close push. On web 423 bytes the completed record never
 *        lands, lifetime 2's collect resurrects the page to
 *        RUNNING (the film, digit class for digit class), the
 *        record is never told, and the heals change nothing.
 *        Post-fix the completion lands at pull time (completion
 *        is one-way evidence: it replaces the same-id open copy
 *        before the stamp game runs), the collect stands the
 *        record down in lifetime 1 already — the verdict no
 *        longer judged by the stateNewer stamp race — and the
 *        closed day stays closed.
 *   E3 — the book (brace-extracted real stopSessionAt, the v411
 *        A5 rig + the real closedDayProof411):
 *        E3a a stop on a day whose dispatch stands completed in
 *          the store books NOTHING (post-fix; web 423 books a
 *          second entry + Revenue line — the double-book).
 *        E3b a stop on an open day still books, before and after.
 *        E3c a session started AFTER an earlier same-day close
 *          ended still books (the guard keys on the close's own
 *          endedAt vs the session pin), before and after.
 *
 * Run: node tools/close-not-reaching-phone-nov11-test.js
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
function atDay(hh, mm) { return DAY.getTime() + (hh * 60 + (mm || 0)) * 60000; }
function todayStrOf(d) {
  d = d || new FakeDate();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const TODAY = todayStrOf(new RealDate(DAY.getTime() + 12 * 3600000));
let fakeNow = atDay(18, 39);                                 // the 18:39 reopen
class FakeDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fakeNow])); }
  static now() { return fakeNow; }
}
const PINMS = atDay(8, 0);                                   // the 8:00 AM session pin
const SEG = atDay(17, 39);                                   // segment resumed 1 h before the reopen
const BANK = 28797;                                          // 07:59:57 banked (his fold)
const TRACK_RUN = { status: 'running', sessionId: PINMS, startTs: SEG, elapsed: BANK, stateAt: SEG };
const DSP_OPEN = { id: 'dspT', status: 'saved', scheduledAt: TODAY + 'T08:00', date: TODAY, jobSite: 'Aecon Trans', loads: '10' };
const DSP_DONE = { id: 'dspT', status: 'completed', scheduledAt: TODAY + 'T08:00', date: TODAY, jobSite: 'Aecon Trans', loads: '11',
  endedAt: new RealDate(atDay(18, 23)).toISOString() };      // closed 18:23, the web close

/* =================================================================
 * Worlds
 * ================================================================= */
function makeServer() { return { docs: {}, clock: 100000, rejected: [] }; }
function serverSet(server, id, v, updatedAt) { server.docs[id] = { id: id, v: v, updatedAt: updatedAt || (++server.clock) }; }

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

/* One device: shared localStorage + cloudsync world + native
   bridge. Page lifetimes are built on top, one per reopen. */
function makePhone(dspMetaT) {
  const data = {};
  const localStorage = {
    getItem: function (k) { return (k in data) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    removeItem: function (k) { delete data[k]; },
    key: function (i) { return Object.keys(data)[i] || null; },
    get length() { return Object.keys(data).length; }
  };
  data['mt_tracker'] = JSON.stringify(TRACK_RUN);
  data['mt_sessions'] = JSON.stringify([]);
  data['mt_dsp_list'] = JSON.stringify([DSP_OPEN]);
  data['mt_dsp_active'] = JSON.stringify(DSP_OPEN);
  data['mt___syncmeta'] = JSON.stringify({ uid: 'u1', globallySynced: true, keys: {
    tracker: { t: 6000, s: 5000, u: 'u1' },
    sessions: { t: 5000, s: 5000, u: 'u1' },
    dsp_list: { t: dspMetaT, s: 5000, u: 'u1' },
    dsp_active: { t: 5000, s: 5000, u: 'u1' }
  } });
  const server = makeServer();
  serverSet(server, 'tracker', TRACK_RUN, 5000);       // the phone's echoes
  serverSet(server, 'dsp_list', [DSP_OPEN], 5000);
  serverSet(server, 'sessions', [], 5000);
  // THE 18:23 WEB CLOSE: only the dispatch record changes in the
  // cloud (the closing surface was idle — no tracker doc move,
  // no sessions entry; its Revenue line is not a sync key here).
  serverSet(server, 'dsp_list', [DSP_DONE], 9000);

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
  const bridge = makeBridge();
  bridge.seed({ status: 'running', elapsedBase: BANK, segStartMs: SEG, loads: 6, loadsManual: 0,
    loadsArmed: true, loadsCorr: 4, milesM: 226400, stateAt: SEG, rev: 5,
    updatedAt: atDay(18, 37), src: 'web', sessionKey: 's' + PINMS });
  return { data: data, server: server, csb: csb, bridge: bridge, store: store };
}

/* A fresh page lifetime (one full close/reopen of the app). */
function makePage(phone) {
  const genericEl = { value: '', textContent: '', innerHTML: '',
    classList: { add: function () {}, remove: function () {}, contains: function () { return false; } }, onclick: null };
  const psb = {
    console: console, Promise: Promise, Date: FakeDate, JSON: JSON, Math: Math,
    setTimeout: function () { return 0; }, clearTimeout: function () {},
    confirm: function () { return true; }, closeSidebar: function () {},
    fmtClock: function (s) { return String(s); },
    todayStr: todayStrOf,
    el: function () { return genericEl; },
    store: phone.store, App: { tracker: null },
    trackerPaint: function () {}, paintHero: function () {}, paintBubble: function () {},
    pushWidgetState: function () {}, lastBubbleFacts: function () { return {}; },
    ShiftTrack: phone.bridge
  };
  psb.window = psb;
  vm.createContext(psb);
  vm.runInContext(regionCode + '\n;this.__H = { healClosedTracker: healClosedTracker, closedDayProof411: closedDayProof411 };', psb);
  psb.App.tracker = phone.store.get('tracker', null);        // init's load
  psb.App._sessRev = phone.bridge.rec.rev; psb.App._lastStateAt = 0; psb.App._lastLoadsAt = 0;
  return { sb: psb, H: psb.__H };
}
function settle(ms) { return new Promise(function (r) { setTimeout(r, ms || 800); }); }
async function pump() { for (let i = 0; i < 12; i++) await new Promise(function (r) { setImmediate(r); }); }

async function replayTonight(dspMetaT, label) {
  section(label + ' — lifetime 1 (the 18:39 reopen)');
  fakeNow = atDay(18, 39);
  const phone = makePhone(dspMetaT);
  let page = makePage(phone);
  eq(label + ' L1 boot heal cannot fire pre-pull (the proof is not on the device yet)', page.H.healClosedTracker(), false);
  phone.csb.CloudSync.onAuth({ uid: 'u1' });
  await settle(900);
  eq(label + ' L1 the pull idles the STORED tracker (v411 reads the incoming docs)', phone.store.get('tracker', {}).status, 'idle');
  eq(label + ' L1 the completed dispatch record LANDS in the store', (phone.store.get('dsp_list', [])[0] || {}).status, 'completed');
  ok(label + ' L1 the page-side proof holds in the store', page.H.closedDayProof411(PINMS) === true);
  page.sb.App.tracker = phone.store.get('tracker', page.sb.App.tracker);   // onAuth's re-read
  eq(label + ' L1 page idle after the pull re-read', page.sb.App.tracker.status, 'idle');
  await page.sb.App.collectSessionRecord(); await pump();                  // the boot collect
  eq(label + ' L1 the native record is stood down in the close\u2019s own lifetime', phone.bridge.rec.status, 'idle');
  ok(label + ' L1 the record was told idle (sync or stop)',
    phone.bridge.syncLog.some(function (f) { return f.status === 'idle'; }) || phone.bridge.stoppedLog.length > 0,
    JSON.stringify(phone.bridge.syncLog));

  section(label + ' — lifetime 2 (the 18:48 full close/reopen)');
  fakeNow = atDay(18, 48);
  if (phone.bridge.rec.status !== 'idle') phone.bridge.seed({ updatedAt: RealDate.now() }); // its service wrote while it ran
  page = makePage(phone);
  phone.csb.CloudSync.onAuth({ uid: 'u1' });
  await settle(900);
  page.sb.App.tracker = phone.store.get('tracker', page.sb.App.tracker);
  await page.sb.App.collectSessionRecord(); await pump();
  eq(label + ' L2 the page does NOT resurrect from the native record', page.sb.App.tracker.status, 'idle');
  eq(label + ' L2 the native record stands idle', phone.bridge.rec.status, 'idle');
  fakeNow += 61000; page.H.healClosedTracker();
  fakeNow += 61000; await page.sb.App.collectSessionRecord(); await pump();
  eq(label + ' L2 still idle after heal ticks + another collect', page.sb.App.tracker.status, 'idle');
  eq(label + ' L2 the native record is still idle', phone.bridge.rec.status, 'idle');
  return phone;
}

/* =================================================================
 * E3 — the book: real stopSessionAt (v411 A5 rig) + real proof
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
  const mem = { sessions: opts.sessions || [], onboarding: {}, dsp_active: null, dsp_list: opts.dspList || [] };
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
      tracker: { status: 'running', sessionId: opts.pin, startTs: opts.pin, elapsed: 0, profileId: 'p1' },
      armNativeDay: function () {},
      workProfiles: { activeId: function () { return 'p1'; }, keyFor: function (k) { return k; } }
    },
    Meticulous: { modules: { revenue: { onSession: function () { calls.onSession++; } } } },
    FB: { saveDoc: function () { calls.saveDoc++; } },
    ShiftTrack: { sessionStopped: function () { calls.stopped++; } },
    _stopViaDispatch: false, _endTicketPhoto: null,
    trackerSave: function () {}, trackerPaint: function () {},
    trackerSessionKeyMs: function () { return opts.pin; },
    trackerSessionStartMs: function () { return opts.pin; },
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
    extractFn(appSrc, 'function closedDayProof411(startMs)') + '\n' +
    extractFn(appSrc, 'function closeTravelFor(dayStr)') + '\n' +
    extractFn(appSrc, 'function stopSessionAt(endMs, endOdoVal)');
  vm.createContext(sb);
  vm.runInContext(code + '\n;this.__stop = stopSessionAt;', sb);
  return { sb: sb, mem: mem, calls: calls };
}

(async function () {
  await replayTonight(8000, 'E1 friendly stamps');
  await replayTonight(9500, 'E2 tonight (phone dsp stamp beats the close)');

  section('E3 the book — one close, one booking');
  {
    fakeNow = atDay(18, 52);
    const w = makeStopWorld({ pin: PINMS, dspList: [DSP_DONE] });
    w.sb.__stop(fakeNow);
    eq('E3a a stop on a dispatch-closed day writes NO second session entry', w.mem.sessions.length, 0);
    eq('E3a and posts NO second Revenue line', w.calls.onSession, 0);
    eq('E3a the stop still stands the tracker down', w.sb.App.tracker.status, 'idle');
  }
  {
    fakeNow = atDay(18, 52);
    const w = makeStopWorld({ pin: PINMS, dspList: [DSP_OPEN] });
    w.sb.__stop(fakeNow);
    eq('E3b a stop on an OPEN day still books its session', w.mem.sessions.length, 1);
    eq('E3b and posts its Revenue line', w.calls.onSession, 1);
  }
  {
    fakeNow = atDay(18, 52);
    const doneEarly = { id: 'dspT', status: 'completed', scheduledAt: TODAY + 'T06:00', date: TODAY,
      jobSite: 'Morning job', endedAt: new RealDate(atDay(12, 0)).toISOString() };
    const w = makeStopWorld({ pin: atDay(13, 0), dspList: [doneEarly] });
    w.sb.__stop(fakeNow);
    eq('E3c a session started AFTER an earlier same-day close ended still books', w.mem.sessions.length, 1);
    eq('E3c and posts its Revenue line', w.calls.onSession, 1);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('BENCH ERROR', e); process.exit(2); });
