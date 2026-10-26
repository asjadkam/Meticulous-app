#!/usr/bin/env node
/* Meticulous v270 — CLOSE-END-FUTURE-GUARD + TRAVEL-MISSING-ON-
 * TRACKER-CLOSE (owner, Mon Oct 26, 2026 17:07 MDT, his screenshot
 * of the End shift sheet): closing at 5:06 PM he set the end to the
 * foreman ticket's finish, 6:00 PM, and the app popped "6:00 PM
 * hasn't happened yet — it's 5:06 PM now. End the shift at 5:06 PM
 * instead?" His words: "That shouldn't be a limitation... Because
 * I wanna stop it 6 pm as per the ticket!" Pay follows the FOREMAN
 * TICKET — its finish is the truth, and it is routinely ahead of
 * the moment he performs the close. He tapped OK (the close ran to
 * now) and the day booked as a bare "Auto from tracker" entry:
 * $264.69 = 9.13h x $29 (8:00 AM -> 5:06 PM) with NO travel hour —
 * a dispatch day closed through the tracker dropped the travel a
 * dispatch-shaped close composes (foreman 10h + travel 1h = 11.0h,
 * the Oct 22 entry).
 *
 * The law after this fix:
 *  (1) the close flow accepts an end LATER than now on the same
 *      day: no "hasn't happened yet" dialog; the close books the
 *      session to the entered end (the v249 confirm-to-now
 *      substitution is superseded by the owner's direct order).
 *  (2) a session closed with a future end STAYS closed — idle in
 *      the store, idle in the native record, unmoved by a relaunch
 *      collect, by the clock passing the booked end, or by a cloud
 *      pull whose newest copy is the stale RUNNING session.
 *  (3) on a day with an active dispatch (the app's own day
 *      resolution — autostartDispatchFor), a tracker close stamps
 *      the session with his Preferences travel bonus, and Revenue's
 *      onSession composes the entry the dispatch way: foreman
 *      (session) hours + travel hours = paid hours x his rate, with
 *      the split fields stored (travelInIncome). No dispatch that
 *      day -> no travel invented. The v241 one-close law stands: a
 *      completion entry for the day still silences the tracker
 *      entry entirely (no double travel).
 *  (4) the sanities he did NOT ask to remove stay: an end that
 *      leaves zero tracked seconds is refused ("not after the
 *      start"); an end on the clock earlier than the start keeps
 *      the overnight roll (next morning) and its >12 h confirm.
 *      The end stays a time-of-day on the session's start date
 *      (+ the overnight roll) — a future calendar day cannot be
 *      entered.
 *
 * Drives the REAL js/app.js close region + session-record
 * machinery + the REAL modules/revenue.js onSession + the REAL
 * js/cloudsync.js, in vm worlds over a JS mirror of
 * SessionRecord.java's semantics (rev gate, identical-facts
 * no-op, clear() on stop), with a fake clock set on the incident
 * itself: Mon Oct 26, 2026, session from 8:00 AM, close at
 * 5:06 PM, ticket finish 6:00 PM, wage $29/h, travel bonus 1h.
 *
 * Run: node tools/close-end-future-v270-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const revSrc = fs.readFileSync(path.join(ROOT, 'modules', 'revenue.js'), 'utf8');
const csSrc = fs.readFileSync(path.join(ROOT, 'js', 'cloudsync.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function extractFn(src, marker) {
  const i = src.indexOf(marker);
  if (i === -1) throw new Error('marker not found: ' + marker);
  let depth = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { k++; break; } }
  }
  return src.slice(i, k);
}
function extractRegion(src, beginMark, endMark) {
  const bi = src.indexOf(beginMark), ei = src.indexOf(endMark);
  if (bi === -1 || ei === -1) throw new Error('region markers missing: ' + beginMark);
  return src.slice(src.lastIndexOf('/*', bi), src.indexOf('*/', ei) + 2);
}
function sliceBetween(s, startMark, endMark, endIncl) {
  const a = s.indexOf(startMark), b = s.indexOf(endMark);
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + startMark);
  return s.slice(a, endIncl ? b + endMark.length : b);
}
function extractStore() {
  const i = appSrc.indexOf('var store = {');
  let depth = 0, j = i;
  for (; j < appSrc.length; j++) {
    if (appSrc[j] === '{') depth++;
    else if (appSrc[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return appSrc.slice(i, j) + ';';
}

/* ---------------- fake clock (the incident day, local time) ---------------- */
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

const DAY = '2026-10-26';
const T_START = msOf(DAY, '08:00:00');
const T_CLOSE = msOf(DAY, '17:06:00');
const T_END = msOf(DAY, '18:00:00');

/* ---------------- SessionRecord mirror (v265 pattern + clear) ---------------- */
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
  return {
    rec: rec,
    sessionSync: function (facts) {
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
    /* the plugin's stop path: SessionRecord.clear() — a fresh idle
       snap, rev+1 (a no-op when the record is already idle+empty). */
    sessionStopped: function () {
      if (rec.status === 'idle' && rec.loads === 0 && rec.loadsCorr === 0 &&
          rec.elapsedBase === 0 && rec.sessionKey === '') return;
      rec.status = 'idle'; rec.elapsedBase = 0; rec.segStartMs = 0; rec.loads = 0;
      rec.loadsManual = 0; rec.loadsArmed = false; rec.loadsCorr = 0;
      rec.rev += 1; rec.updatedAt = fakeNow; rec.src = 'web'; rec.sessionKey = '';
    },
    drainNow: function () {}
  };
}

/* ---------------- fake DOM ---------------- */
function FakeEl(id) {
  this.id = id || ''; this.value = ''; this._html = ''; this.textContent = '';
  this.style = {}; this.onclick = null; this.files = [];
  const self = this;
  this.classList = { add: function () {}, remove: function () {} };
  Object.defineProperty(this, 'innerHTML', {
    get: function () { return self._html; },
    set: function (v) { self._html = String(v); }
  });
}
FakeEl.prototype.querySelector = function () { return new FakeEl('q'); };
FakeEl.prototype.querySelectorAll = function () { return []; };
FakeEl.prototype.addEventListener = function () {};
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };

/* ---------------- the page world ---------------- */
const recordRegion = sliceBetween(appSrc, 'function trackerSave() {', 'App.collectSessionRecord = collectSessionRecord;', true);
const declBlock = appSrc.slice(appSrc.indexOf('var _stopViaDispatch = false;'),
  appSrc.indexOf('function stopSessionAt'));
const photoVar = appSrc.slice(appSrc.indexOf('var _takenStartOdoPhoto'),
  appSrc.indexOf(';', appSrc.indexOf('var _takenStartOdoPhoto')) + 1);
const closeCode = [
  extractStore(),
  recordRegion,
  declBlock,
  photoVar,
  extractFn(appSrc, 'function fmtClock'),
  extractFn(appSrc, 'function fmtTimeAMPM'),
  extractFn(appSrc, 'function todayStr'),
  extractFn(appSrc, 'function trackerSessionStartMs'),
  extractFn(appSrc, 'function trackerElapsedSec'),
  extractFn(appSrc, 'function trackerSessionKeyMs'),
  extractFn(appSrc, 'function trackedSecondsAt'),
  extractFn(appSrc, 'function autostartParseSched'),
  extractFn(appSrc, 'function autostartRecordDate'),
  extractFn(appSrc, 'function autostartDispatchFor'),
  extractFn(appSrc, 'function closeTravelFor'),
  extractFn(appSrc, 'function trkAccum'),
  extractFn(appSrc, 'function takeSessionAccum'),
  extractFn(appSrc, 'function ptiStartOdoFor'),
  extractFn(appSrc, 'function takePendingStartOdo'),
  extractFn(appSrc, 'function takePendingStartOdoPhoto'),
  extractFn(appSrc, 'function applyEndOdoToEntry'),
  extractFn(appSrc, 'function liveKmNow'),
  extractFn(appSrc, 'function closeTrackerEndSheet'),
  extractFn(appSrc, 'App.trackerSaveEnd = function'),
  extractFn(appSrc, 'function endCloseSummary'),
  extractFn(appSrc, 'function paintEndReview'),
  extractFn(appSrc, 'App.trackerBackEnd = function'),
  extractFn(appSrc, 'App.trackerConfirmEnd = function'),
  extractFn(appSrc, 'function stopSessionAt'),
  extractRegion(appSrc, 'ODO-MASTER-BEGIN', 'ODO-MASTER-END')
].join('\n');

function makeLocal() {
  const mem = {};
  return { mem: mem,
    getItem: function (k) { return (k in mem) ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; },
    key: function (i) { return Object.keys(mem)[i] || null; },
    get length() { return Object.keys(mem).length; } };
}

function makeWorld(shared) {
  const els = {};
  const calls = { confirms: [], alerts: [] };
  const sb = {
    console: console, Promise: Promise, Date: FakeDate, JSON: JSON, Math: Math,
    localStorage: shared.local,
    setTimeout: function (fn) { shared.timers.push(fn); return shared.timers.length; },
    clearTimeout: function () {},
    setInterval: function () { return 0; }, clearInterval: function () {},
    confirm: function (m) { calls.confirms.push(String(m)); return shared.confirmAnswer; },
    alert: function (m) { calls.alerts.push(String(m)); },
    el: function (id) { return els[id] || (els[id] = new FakeEl(id)); },
    esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    closeSidebar: function () {},
    trackerPaint: function () {},
    paintBubble: function () {},
    pushWidgetState: function () {},
    lastBubbleFacts: function () { return {}; },
    Meticulous: { modules: {} },
    App: { tracker: null, _sessRev: -1 },
    ShiftTrack: shared.bridge
  };
  sb.window = sb;
  sb.document = { addEventListener: function () {}, querySelector: function () { return null; },
    createElement: function () { return new FakeEl('new'); }, getElementById: function () { return null; } };
  vm.createContext(sb);
  vm.runInContext(closeCode, sb);
  sb.App._store = sb.store;
  sb.App._today = function () { return sb.todayStr(new Date()); };
  sb.App._esc = sb.esc;
  sb.App.tracker = sb.store.get('tracker', { status: 'idle', startTs: 0, elapsed: 0 });
  vm.runInContext(revSrc, sb); // the REAL Revenue (onSession) wired into the close
  return { sb: sb, els: els, el: sb.el, calls: calls, store: sb.store };
}

function makeShared() {
  return { local: makeLocal(), bridge: makeBridge(), timers: [], confirmAnswer: true };
}
function seedSettings(store) {
  store.set('onboarding', { payStandard: 'hourly', payRate: 29, travelBonus: 1 });
}
function seedDispatch(store) {
  const d = { id: 'dOct26', date: DAY, scheduledAt: DAY + 'T08:00', jobSite: 'Aecon Inf',
    status: 'active', tickets: [] };
  store.set('dsp_list', [JSON.parse(JSON.stringify(d))]);
  store.set('dsp_active', JSON.parse(JSON.stringify(d)));
}
async function startSession(w) {
  fakeNow = T_START;
  w.sb.App.tracker = { status: 'running', elapsed: 0, startTs: T_START, sessionId: T_START,
    accum: { weightKg: 0, loadCount: 0, tripCount: 0, manualLoads: 0 } };
  w.sb.App._sessRev = 0;
  await w.sb.ShiftTrack.sessionSync({ status: 'running', elapsed: 0, startTs: T_START,
    loads: 0, loadsManual: 0, loadsArmed: false, sessionKey: 's' + T_START, baseRev: 0, force: false });
  w.sb.App._sessRev = 1;
}

(async function main() {
  /* ============ A: the incident — future end on a dispatch day ============ */
  console.log('\n— A: close at 5:06 PM with the ticket finish 6:00 PM (dispatch day) —');
  const sharedA = makeShared();
  const wA = makeWorld(sharedA);
  seedSettings(wA.store); seedDispatch(wA.store);
  await startSession(wA);
  fakeNow = T_CLOSE;
  wA.el('trkEndTime').value = '18:00';
  wA.sb.App.trackerSaveEnd();
  eq('A: NO dialog at all for a same-day future end', wA.calls.confirms.length, 0);
  ok('A: no alert either', wA.calls.alerts.length === 0, JSON.stringify(wA.calls.alerts));
  const revHtml = wA.el('trkEndReview').innerHTML;
  ok('A: the review paints', revHtml.indexOf('Check the close') >= 0, revHtml.slice(0, 80));
  ok('A: the review shows HIS end (8:00 AM → 6:00 PM)', /8:00 AM → 6:00 PM/.test(revHtml),
    (revHtml.match(/Shift<\/span><b>[^<]*/) || [''])[0]);
  ok('A: the review promises the composed day ($319.00 = 11h x $29)',
    revHtml.indexOf('$319.00') >= 0, (revHtml.match(/Logs to Revenue<\/span><b>[^<]*/) || [''])[0]);
  wA.sb.App.trackerConfirmEnd();
  await pump();
  const sessA = wA.store.get('sessions', []);
  eq('A: one session booked', sessA.length, 1);
  eq('A: session seconds are to the ENTERED end (10h)', sessA[0].seconds, 36000);
  eq('A: session dated on the close day', sessA[0].date, DAY);
  eq('A: session endedAt is the entered 6:00 PM', sessA[0].endedAt, new RealDate(T_END).toISOString());
  eq('A: session carries the travel stamp (1h)', sessA[0].travelHours, 1);
  const revA = wA.store.get('rev_entries', []);
  eq('A: one Revenue entry', revA.length, 1);
  eq('A: it is the tracker entry', revA[0].note, 'Auto from tracker');
  eq('A: paid hours composed foreman + travel (11.00)', revA[0].hours, '11.00');
  eq('A: amount is the ticket math ($319.00)', revA[0].amount, '319.00');
  eq('A: split stored — foreman 10h', revA[0].foremanHours, 10);
  eq('A: split stored — travel 1h', revA[0].travelHours, 1);
  eq('A: travel is in income (driver composition)', revA[0].travelInIncome, true);
  eq('A: tracker is idle after the close', wA.sb.App.tracker.status, 'idle');
  eq('A: native record is idle after the close', sharedA.bridge.rec.status, 'idle');
  eq('A: native record key cleared', sharedA.bridge.rec.sessionKey, '');

  /* ============ B: the future-ended close STAYS closed ============ */
  console.log('\n— B: relaunch + the clock passing the booked end — nothing re-opens —');
  {
    fakeNow = msOf(DAY, '18:30:00'); // past the booked 6:00 PM end
    const wB = makeWorld(sharedA); // fresh page world, same store + record
    wB.sb.App.collectSessionRecord();
    await pump();
    eq('B: after relaunch past the end, tracker still idle', wB.sb.App.tracker.status, 'idle');
    ok('B: the booked session is untouched (still one, still 10h)',
      wB.store.get('sessions', []).length === 1 && wB.store.get('sessions', [])[0].seconds === 36000, true);
    eq('B: the Revenue entry is untouched', wB.store.get('rev_entries', []).length, 1);
    fakeNow = msOf('2026-10-27', '07:00:00'); // next morning
    wB.sb.App.collectSessionRecord();
    await pump();
    eq('B: next morning — still idle, no resurrection', wB.sb.App.tracker.status, 'idle');
    eq('B: native record still idle', sharedA.bridge.rec.status, 'idle');
    eq('B: still exactly one session booked', wB.store.get('sessions', []).length, 1);
  }

  /* ============ C: a stale RUNNING cloud copy cannot resurrect it ============ */
  console.log('\n— C: cloud pull with the stale running session — the close stands —');
  {
    const data = {};
    const ls = {
      getItem: function (k) { return (k in data) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); },
      removeItem: function (k) { delete data[k]; },
      key: function (i) { return Object.keys(data)[i] || null; },
      get length() { return Object.keys(data).length; }
    };
    // local: the tracker's post-close truth, stamped at the close
    data['mt_tracker'] = JSON.stringify({ status: 'idle', startTs: 0, elapsed: 0 });
    data['mt___syncmeta'] = JSON.stringify({ uid: 'u1', globallySynced: true,
      keys: { tracker: { t: T_CLOSE, s: msOf(DAY, '08:05:00'), u: 'u1' } } });
    const pushes = [];
    const sb = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
      setInterval: setInterval, Promise: Promise, Date: RealDate };
    sb.window = sb;
    sb.localStorage = ls;
    sb.navigator = { onLine: true };
    sb.document = { getElementById: function () { return null; }, addEventListener: function () {} };
    sb.addEventListener = function () {};
    sb.FB = {
      ready: true, user: { uid: 'u1' },
      loadDocs: function () {
        return Promise.resolve([{ id: 'tracker', mt: 'tracker',
          v: { status: 'running', elapsed: 0, startTs: T_START, sessionId: T_START, accum: { manualLoads: 0 } },
          updatedAt: msOf(DAY, '08:05:00') }]);
      },
      saveDoc: function (col, id, doc) { pushes.push({ id: id, v: doc.v }); return Promise.resolve({}); },
      deleteDoc: function () { return Promise.resolve({}); }
    };
    vm.createContext(sb);
    vm.runInContext(csSrc, sb);
    const storeC = {
      get: function (k, d) { const r = ls.getItem('mt_' + k); return r === null ? d : JSON.parse(r); },
      set: function (k, v) { ls.setItem('mt_' + k, JSON.stringify(v)); return true; },
      del: function (k) { ls.removeItem('mt_' + k); return true; }
    };
    sb.CloudSync.attach(storeC);
    sb.CloudSync.onAuth({ uid: 'u1' });
    await new Promise(function (r) { setTimeout(r, 400); });
    const tk = JSON.parse(ls.getItem('mt_tracker'));
    eq('C: the pull leaves the closed (idle) tracker standing', tk.status, 'idle');
    ok('C: the stale running session was never installed',
      tk.sessionId === undefined && tk.startTs === 0, JSON.stringify(tk));
  }

  /* ============ D: no dispatch that day — no travel invented ============ */
  console.log('\n— D: same close, NO dispatch — bare hours, honestly —');
  {
    const shared = makeShared();
    const w = makeWorld(shared);
    seedSettings(w.store);
    await startSession(w);
    fakeNow = T_CLOSE;
    w.el('trkEndTime').value = '18:00';
    w.sb.App.trackerSaveEnd();
    eq('D: no dialog', w.calls.confirms.length, 0);
    w.sb.App.trackerConfirmEnd();
    await pump();
    const sess = w.store.get('sessions', []);
    eq('D: session booked to the entered end (10h)', sess[0].seconds, 36000);
    eq('D: NO travel stamp on the session', sess[0].travelHours, undefined);
    const rev = w.store.get('rev_entries', []);
    eq('D: paid hours are the session hours alone (10.00)', rev[0].hours, '10.00');
    eq('D: amount $290.00', rev[0].amount, '290.00');
    eq('D: no split fields invented', rev[0].travelHours, undefined);
  }

  /* ============ E: dispatch day, ordinary end (now) — travel still composes ============ */
  console.log('\n— E: dispatch day closed at now (5:06 PM) — travel not dropped —');
  {
    const shared = makeShared();
    const w = makeWorld(shared);
    seedSettings(w.store); seedDispatch(w.store);
    await startSession(w);
    fakeNow = T_CLOSE;
    w.el('trkEndTime').value = '17:06';
    w.sb.App.trackerSaveEnd();
    eq('E: no dialog for a now end', w.calls.confirms.length, 0);
    w.sb.App.trackerConfirmEnd();
    await pump();
    const rev = w.store.get('rev_entries', []);
    eq('E: session 9.1h + travel 1h = 10.10 paid hours', rev[0].hours, '10.10');
    eq('E: amount $292.90', rev[0].amount, '292.90');
    eq('E: split stored — foreman 9.1h', rev[0].foremanHours, 9.1);
    eq('E: split stored — travel 1h', rev[0].travelHours, 1);
  }

  /* ============ F: v241 one-close law — a completion still silences the tracker entry ============ */
  console.log('\n— F: completion entry already on the day — tracker close adds nothing —');
  {
    const shared = makeShared();
    const w = makeWorld(shared);
    seedSettings(w.store); seedDispatch(w.store);
    w.store.set('rev_entries', [{ date: DAY, amount: '319.00', type: 'hourly', hours: '11.00',
      note: 'Dispatch: Aecon Inf · foreman 10h + travel 1h = 11h', dspId: 'dOct26',
      foremanHours: 10, travelHours: 1, travelInIncome: true, profileId: 'p1' }]);
    await startSession(w);
    fakeNow = T_CLOSE;
    w.el('trkEndTime').value = '18:00';
    w.sb.App.trackerSaveEnd();
    w.sb.App.trackerConfirmEnd();
    await pump();
    const rev = w.store.get('rev_entries', []);
    eq('F: still exactly ONE entry for the day', rev.length, 1);
    eq('F: it is the completion entry (no double travel)', rev[0].dspId, 'dOct26');
    eq('F: its amount stands ($319.00)', rev[0].amount, '319.00');
  }

  /* ============ G: the sanities he did not ask to remove ============ */
  console.log('\n— G: end-not-after-start refused; overnight roll + 12h confirm kept —');
  {
    const shared = makeShared();
    const w = makeWorld(shared);
    seedSettings(w.store);
    fakeNow = T_CLOSE;
    // a paused session with nothing tracked: any end leaves 0 seconds
    w.sb.App.tracker = { status: 'paused', elapsed: 0, startTs: 0, sessionId: T_START,
      accum: { weightKg: 0, loadCount: 0, tripCount: 0, manualLoads: 0 } };
    w.el('trkEndTime').value = '18:00';
    w.sb.App.trackerSaveEnd();
    eq('G1: zero-second end refused out loud', w.calls.alerts.length, 1);
    ok('G1: the refusal names the real problem', /not after the start/.test(w.calls.alerts[0] || ''),
      w.calls.alerts[0]);
    eq('G1: no review painted', w.el('trkEndReview').innerHTML, '');
    eq('G1: nothing booked', w.store.get('sessions', []).length, 0);
    eq('G1: the session is untouched (still paused)', w.sb.App.tracker.status, 'paused');
  }
  {
    const shared = makeShared();
    shared.confirmAnswer = false; // he declines the sanity question
    const w = makeWorld(shared);
    seedSettings(w.store);
    await startSession(w);
    fakeNow = T_CLOSE;
    w.el('trkEndTime').value = '07:00'; // on the clock before the 8:00 start -> overnight roll
    w.sb.App.trackerSaveEnd();
    eq('G2: the overnight end is gated by the >12h confirm (kept sanity)', w.calls.confirms.length, 1);
    ok('G2: the gate is the shift-length question, NOT a future refusal',
      /Is that right\?/.test(w.calls.confirms[0] || '') && !/hasn't happened/.test(w.calls.confirms[0] || ''),
      w.calls.confirms[0]);
    ok('G2: declined -> no review, nothing booked',
      w.el('trkEndReview').innerHTML === '' && w.store.get('sessions', []).length === 0, true);
    shared.confirmAnswer = true; // accepted: the pre-existing overnight behaviour, unchanged
    w.sb.App.trackerSaveEnd();
    w.sb.App.trackerConfirmEnd();
    await pump();
    const sess = w.store.get('sessions', []);
    ok('G2: accepted -> booked to next-morning 7:00 (23h)', sess.length === 1 && sess[0].seconds === 82800, true);
    eq('G2: the overnight entry dates to the end day', sess[0] && sess[0].date, '2026-10-27');
  }

  /* ============ H: statics ============ */
  console.log('\n— H: statics —');
  {
    ok('H: the "hasn\'t happened yet" dialog is GONE from app.js',
      appSrc.indexOf("hasn't happened yet") === -1);
    const seAt = appSrc.indexOf('App.trackerSaveEnd = function');
    const seBody = seAt !== -1 ? appSrc.slice(seAt, appSrc.indexOf('/* v143: the close review', seAt)) : '';
    ok('H: trackerSaveEnd no longer clamps a future end to now',
      seBody.indexOf('end = new Date();') === -1 && seBody.indexOf("hasn't happened") === -1);
    ok('H: the end is still built on the session start date (same-day bound kept)',
      seBody.indexOf('sd.getFullYear(), sd.getMonth(), sd.getDate()') >= 0);
    ok('H: the zero-second refusal is still in the close path',
      seBody.indexOf('That end time is not after the start.') >= 0);
    ok('H: the >12h sanity confirm is still in the close path',
      seBody.indexOf('Is that right?') >= 0);
    ok('H: stopSessionAt stamps the travel on dispatch days',
      /entry\.travelHours\s*=\s*closeTravel/.test(appSrc));
    ok('H: onSession composes foreman + travel from the session stamp',
      revSrc.indexOf('session.travelHours') >= 0 && revSrc.indexOf('travelInIncome = true') >= 0);
  }

  console.log('\nclose-end-future-v270: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR: ' + (e && e.stack || e)); process.exit(2); });
