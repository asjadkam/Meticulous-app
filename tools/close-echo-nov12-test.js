/* CLOSE-ECHO-NOV12 — end-to-end bench.
 *
 * The owner's report, Thu Nov 12, 2026, ~16:49 CST: his Nov 12
 * day was closed from the WEB app (Dispatch -> Close with
 * ticket photo, card 28884; the web book verified: dispatch
 * Completed, 9 h / $261.00 Revenue, web timer 00:00:00 "Ready
 * to work"). Minutes later his PHONE still showed the shift
 * timer at 07:48:45 "Working..." and counting — loads and live
 * miles still accruing — and it kept counting after he fully
 * closed and reopened the app (screenshot
 * ~/workspace/user/files/68100_60_ydln.jpg).
 *
 * Web 425 (close-not-reaching-phone-nov11) fixed the Nov 11
 * shape and its bench still passes on these bytes. Today
 * differs, and this bench replays the difference exactly:
 *
 *   D1 — THE CLOSING SURFACE'S TRACKER WAS LIVE. On Nov 11 the
 *   web surface was idle, so the close pushed ONLY the
 *   completed dispatch. Today the web surface held the phone
 *   session's live echo (07:45 counting), so its close ALSO
 *   pushed a tracker=idle doc — and, its store already holding
 *   the completed record, the v425 one-booking suppression
 *   booked NO sessions entry: the cloud evidence of the close
 *   is the completed dispatch + the idle tracker + the
 *   completion's Revenue line (rev_entries, keyed by dspId).
 *
 *   D2 — THE PHONE PAGE NEVER SYNCED IN THE CLOSE'S WINDOW.
 *   He was driving home, the app backgrounded/frozen: no pull
 *   ran between the close landing in the cloud (~16:47) and
 *   his full close of the app (~16:48).
 *
 *   D3 — THE FULL CLOSE FLUSHED THE PHONE'S STALE BOOK UP.
 *   pagehide fires flushUrgent — a PUSH with no pull first.
 *   The phone's dirty keys (the tracker's standing re-saves;
 *   a phone-side dsp_list write of the Nov 11 record's
 *   documented class) push the RUNNING tracker and the OPEN
 *   dispatch list over the close's cloud copies, stamped
 *   later than the close. The completion is erased from the
 *   two documents every shipped gate reads (tracker,
 *   dsp_list); later pulls judge an OPEN day forever.
 *
 * The one close-evidence that an echo push CANNOT erase is
 * the completion's Revenue line: rev_entries is a record-list
 * key — it settles by union, never by whole-doc stamps — and
 * the phone held no rev_entries write of its own, so the
 * entry survives D3 untouched in the cloud and lands on the
 * phone at the next pull. But NO shipped gate reads it:
 * closedDayProof411 / closedProof411 / dayClosed411 know only
 * (1) a finished sessions twin and (2) a completed dispatch
 * record. Post-fix a third prong joins them: a rev_entries
 * entry whose dspId names a dispatch (local or incoming)
 * whose record day is the session's day — an entry with a
 * dspId is written ONLY by a completion (applyCompletion),
 * and a completion IS a shift close (the v82 law).
 *
 *   A — friendly: phone syncs while the page lives (the 425
 *       guarantees, today's D1 evidence). Passes before and
 *       after the fix.
 *   B — TONIGHT (D1+D2+D3, dsp_list dirty at pagehide): on
 *       pre-fix bytes the cloud completion is erased, the
 *       reopen resurrects page + record and the heals never
 *       fire. Post-fix the revenue prong carries the verdict
 *       and everything converges in the reopen's own pull.
 *   B2 — D3 with dsp_list CLEAN at pagehide (only the tracker
 *       echo is pushed over): passes before and after — the
 *       erasure needs the list.
 *   C — the reverse guard: an OPEN day (no close anywhere),
 *       same flush + reopen — the session must restore
 *       RUNNING, untouched, before and after.
 *   D — the other-day guard: a completion Revenue line for
 *       YESTERDAY's dispatch must not close TODAY's session.
 *
 * Worlds: each page lifetime gets a FRESH cloudsync world
 * over the SAME localStorage + server (a real app reload
 * rebuilds the engine; the same-uid guard is per-lifetime).
 * Server stamps are real-scale and monotonic, like
 * Firestore's server timestamps against the meta's clocks.
 *
 * Run: node tools/close-echo-nov12-test.js
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
let fakeNow = atDay(16, 50);
class FakeDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fakeNow])); }
  static now() { return fakeNow; }
}
const PINMS = atDay(9, 0);                                   // the 9:00 AM session pin
const SEG = atDay(16, 30);                                   // live segment start
const BANK = 27000;                                          // 7:30:00 banked
const TRACK_RUN = { status: 'running', sessionId: PINMS, startTs: SEG, elapsed: BANK, stateAt: SEG };
const TRACK_IDLE_WEB = { status: 'idle', startTs: 0, elapsed: 0, stateAt: atDay(16, 47) };
const DSP_OPEN = { id: 'dspT', status: 'saved', scheduledAt: TODAY + 'T09:00', date: TODAY, jobSite: 'Aecon Trans', loads: '7' };
const DSP_DONE = { id: 'dspT', status: 'completed', scheduledAt: TODAY + 'T09:00', date: TODAY, jobSite: 'Aecon Trans', loads: '7',
  endedAt: new RealDate(atDay(16, 47)).toISOString() };      // closed 16:47 from the web
const REV_DONE = { dspId: 'dspT', date: TODAY, amount: 261, hours: 9, note: 'Dispatch: Aecon Trans' };
const DSP_DONE_Y = { id: 'dspY', status: 'completed', scheduledAt: YDAY + 'T08:00', date: YDAY, jobSite: 'Other job',
  endedAt: new RealDate(DAYM1.getTime() + 17 * 3600000).toISOString() };
const REV_DONE_Y = { dspId: 'dspY', date: YDAY, amount: 300, hours: 10, note: 'Dispatch: Other job' };

/* =================================================================
 * Worlds (the nov11 rig, per-lifetime sync worlds)
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

function makePhone() {
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
  data['mt_rev_entries'] = JSON.stringify([]);
  data['mt___syncmeta'] = JSON.stringify({ uid: 'u1', globallySynced: true, keys: {
    tracker: { t: 1, s: 1, u: 'u1' },
    sessions: { t: 1, s: 1, u: 'u1' },
    dsp_list: { t: 1, s: 1, u: 'u1' },
    dsp_active: { t: 1, s: 1, u: 'u1' },
    rev_entries: { t: 1, s: 1, u: 'u1' }
  } });
  const server = makeServer();
  serverSet(server, 'tracker', TRACK_RUN);       // the phone's echoes
  serverSet(server, 'dsp_list', [DSP_OPEN]);
  serverSet(server, 'sessions', []);
  serverSet(server, 'rev_entries', []);

  const bridge = makeBridge();
  bridge.seed({ status: 'running', elapsedBase: BANK, segStartMs: SEG, loads: 6, loadsManual: 0,
    loadsArmed: true, loadsCorr: 1, milesM: 116200, stateAt: SEG, rev: 5,
    updatedAt: atDay(16, 37), src: 'web', sessionKey: 's' + PINMS });

  const phone = { data: data, localStorage: localStorage, server: server, bridge: bridge };
  /* A fresh sync engine over the same device storage + cloud —
     one per page lifetime, as a real reload rebuilds it. */
  phone.newWorld = function () {
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
  return phone;
}

/* The 16:47 web close (D1): the closing surface's tracker was
   the session's live echo, so the close pushes the completed
   list, an IDLE tracker and the completion's Revenue line —
   and (the v425 suppression, its store already holding the
   completed record) NO sessions entry. */
function webClose(phone) {
  serverSet(phone.server, 'dsp_list', [DSP_DONE]);
  serverSet(phone.server, 'tracker', TRACK_IDLE_WEB);
  serverSet(phone.server, 'rev_entries', [REV_DONE]);
}

/* The 16:48 full close (D3): pagehide's flushUrgent — a push
   with no pull first, from the DYING page's own engine. The
   phone's writes re-stamp the dirty keys (the tracker's
   standing re-save; optionally a phone-side dsp_list write
   of the documented class), then the flush pushes them. */
async function pagehideFlush(world, dspDirty) {
  world.store.set('tracker', TRACK_RUN);
  if (dspDirty) world.store.set('dsp_list', [DSP_OPEN]);
  await settle(2800);          // the debounce fires the push
  try { world.csb.CloudSync.flush(); } catch (e) {}
  await settle(600);
}

/* A fresh page lifetime over a fresh sync world. */
function makePage(phone, world) {
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
    ShiftTrack: phone.bridge
  };
  psb.window = psb;
  vm.createContext(psb);
  vm.runInContext(regionCode + '\n;this.__H = { healClosedTracker: healClosedTracker, closedDayProof411: closedDayProof411 };', psb);
  psb.App.tracker = world.store.get('tracker', null);        // init's load
  psb.App._sessRev = phone.bridge.rec.rev; psb.App._lastStateAt = 0; psb.App._lastLoadsAt = 0;
  return { sb: psb, H: psb.__H };
}
function settle(ms) { return new Promise(function (r) { setTimeout(r, ms || 800); }); }
async function pump() { for (let i = 0; i < 12; i++) await new Promise(function (r) { setImmediate(r); }); }

/* One reopen lifetime: fresh world + page, boot heal
   (pre-pull), the sign-in pull, onAuth's re-read, the boot
   collect, two heal ticks. Returns the page. */
async function reopen(phone, label) {
  const world = phone.newWorld();
  const page = makePage(phone, world);
  eq(label + ' boot heal cannot fire pre-pull (the proof is not on the device yet)', page.H.healClosedTracker(), false);
  world.csb.CloudSync.onAuth({ uid: 'u1' });
  await settle(900);
  page.sb.App.tracker = world.store.get('tracker', page.sb.App.tracker);   // onAuth's re-read
  await page.sb.App.collectSessionRecord(); await pump();                  // the boot collect
  fakeNow += 61000; page.H.healClosedTracker();
  fakeNow += 61000; await page.sb.App.collectSessionRecord(); await pump();
  return { page: page, world: world };
}

(async function () {
  /* ---------- A — friendly: the phone syncs while the page lives ---------- */
  section('A friendly (the 425 guarantees, today\u2019s D1 evidence)');
  {
    fakeNow = atDay(16, 48);
    const phone = makePhone();
    const world = phone.newWorld();
    const page = makePage(phone, world);                // the live page
    webClose(phone);
    world.csb.CloudSync.onAuth({ uid: 'u1' });          // a sync cycle lands
    await settle(900);
    eq('A the pull idles the STORED tracker', world.store.get('tracker', {}).status, 'idle');
    eq('A the completed dispatch record LANDS in the store', (world.store.get('dsp_list', [])[0] || {}).status, 'completed');
    page.sb.App.tracker = world.store.get('tracker', page.sb.App.tracker);
    eq('A page idle after the pull re-read', page.sb.App.tracker.status, 'idle');
    await page.sb.App.collectSessionRecord(); await pump();
    eq('A the native record is stood down in the close\u2019s own lifetime', phone.bridge.rec.status, 'idle');
  }

  /* ---------- B — TONIGHT: frozen page, pagehide erasure, reopen ---------- */
  section('B tonight (D1+D2+D3 — the dsp_list echo erases the close)');
  {
    fakeNow = atDay(16, 48);
    const phone = makePhone();
    const world = phone.newWorld();
    makePage(phone, world);                             // the live page
    world.csb.CloudSync.onAuth({ uid: 'u1' });          // the morning sign-in (cloud == echoes)
    await settle(900);
    webClose(phone);                                    // 16:47 — no sync on the phone after this
    await pagehideFlush(world, true);
    eq('B the pagehide flush ERASES the completed list from the cloud (model sanity)',
      (phone.server.docs['dsp_list'].v[0] || {}).status, 'saved');
    eq('B the completion\u2019s Revenue line SURVIVES in the cloud (union key, never pushed by the phone)',
      (phone.server.docs['rev_entries'].v[0] || {}).dspId, 'dspT');
    fakeNow = atDay(16, 50);
    if (phone.bridge.rec.status !== 'idle') phone.bridge.seed({ updatedAt: fakeNow });
    const r = await reopen(phone, 'B');
    eq('B the completion\u2019s Revenue line LANDS in the phone\u2019s store', (r.world.store.get('rev_entries', [])[0] || {}).dspId, 'dspT');
    ok('B the page-side proof holds in the store (the revenue prong)', r.page.H.closedDayProof411(PINMS) === true);
    eq('B the pull idles the STORED tracker', r.world.store.get('tracker', {}).status, 'idle');
    eq('B the page does NOT resurrect', r.page.sb.App.tracker.status, 'idle');
    eq('B the native record stands idle', phone.bridge.rec.status, 'idle');
    /* ALL FACES: the widget and the bubble read the native
       record alone — its clock must be FROZEN, not just its
       flag: ten more minutes move nothing. */
    const eB = phone.bridge.snap().elapsedSec;
    fakeNow += 600000;
    eq('B the widget/bubble clock is FROZEN at the close (record elapsed unmoved in 10 min)', phone.bridge.snap().elapsedSec, eB);
    ok('B the record was TOLD idle (sync or stop reached the bridge)',
      phone.bridge.syncLog.some(function (f) { return f.status === 'idle'; }) || phone.bridge.stoppedLog.length > 0,
      JSON.stringify(phone.bridge.syncLog));
  }

  /* ---------- B2 — the erasure needs the list ---------- */
  section('B2 pagehide pushes only the tracker echo');
  {
    fakeNow = atDay(16, 48);
    const phone = makePhone();
    const world = phone.newWorld();
    makePage(phone, world);
    world.csb.CloudSync.onAuth({ uid: 'u1' });          // the morning sign-in
    await settle(900);
    webClose(phone);
    await pagehideFlush(world, false);
    eq('B2 the completed list SURVIVES in the cloud', (phone.server.docs['dsp_list'].v[0] || {}).status, 'completed');
    fakeNow = atDay(16, 50);
    if (phone.bridge.rec.status !== 'idle') phone.bridge.seed({ updatedAt: fakeNow });
    const r = await reopen(phone, 'B2');
    eq('B2 the page does NOT resurrect', r.page.sb.App.tracker.status, 'idle');
    eq('B2 the native record stands idle', phone.bridge.rec.status, 'idle');
    const eB2 = phone.bridge.snap().elapsedSec;
    fakeNow += 600000;
    eq('B2 the widget/bubble clock is FROZEN at the close', phone.bridge.snap().elapsedSec, eB2);
  }

  /* ---------- C — the reverse guard: an OPEN day is untouched ---------- */
  section('C open day (no close anywhere) — flush + reopen restores RUNNING');
  {
    fakeNow = atDay(16, 48);
    const phone = makePhone();
    const world = phone.newWorld();
    makePage(phone, world);
    world.csb.CloudSync.onAuth({ uid: 'u1' });          // the morning sign-in
    await settle(900);
    await pagehideFlush(world, true);
    fakeNow = atDay(16, 50);
    if (phone.bridge.rec.status !== 'idle') phone.bridge.seed({ updatedAt: fakeNow });
    const world2 = phone.newWorld();
    const page = makePage(phone, world2);
    world2.csb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    page.sb.App.tracker = world2.store.get('tracker', page.sb.App.tracker);
    await page.sb.App.collectSessionRecord(); await pump();
    fakeNow += 61000; page.H.healClosedTracker();
    eq('C the open day\u2019s page restores RUNNING', page.sb.App.tracker.status, 'running');
    eq('C the open day\u2019s native record keeps RUNNING', phone.bridge.rec.status, 'running');
    eq('C the heal does NOT fire on an open day', page.H.closedDayProof411(PINMS), false);
  }

  /* ---------- D — the other-day guard ---------- */
  section('D a completion Revenue line for YESTERDAY\u2019s dispatch closes nothing today');
  {
    fakeNow = atDay(16, 50);
    const phone = makePhone();
    const world = phone.newWorld();
    world.store.set('rev_entries', [REV_DONE_Y]);
    world.store.set('dsp_list', [DSP_OPEN, DSP_DONE_Y]);
    const page = makePage(phone, world);
    eq('D the proof refuses yesterday\u2019s completion', page.H.closedDayProof411(PINMS), false);
    eq('D the heal does NOT fire', page.H.healClosedTracker(), false);
    eq('D the session still stands', page.sb.App.tracker.status, 'running');
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('BENCH ERROR', e); process.exit(2); });
