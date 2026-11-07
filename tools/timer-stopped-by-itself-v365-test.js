#!/usr/bin/env node
/* Meticulous v365 — TIMER-STOPPED-BY-ITSELF (owner, Sat Nov 7,
 * 2026, 10:38–10:52: "Why on earth is my timer frozen?" …
 * "No, I never pass stop or pause. It stop by itself." …
 * "And if this system is broken fix it ASAP. You cannot have
 * others using this broken system and we are not going to break
 * others system.")
 *
 * The user's account governs: he never tapped pause. The web
 * 361 finding ("his deliberate pause at the peg, stateAt
 * 08:24:47") is RE-EXAMINED here and found manufactured — the
 * "deliberate" stamp was minted by the bug itself:
 *
 *  THE MECHANISM (code-traced, both layers):
 *  1. The second client's RUNNING echo of the same 8:00 plan
 *     landed in the phone's native SessionRecord in a PAUSED
 *     state holding the echo's young clock (web 363's own
 *     trace: bank 540 s, segment pinning ~08:05, stateAt the
 *     echo's ~08:09 start). On the pre-v73 record the landing
 *     re-stamped rec.updatedAt on every write (nativeLoad —
 *     every face +/- tap — and every web sync), while the
 *     record's contents stayed the echo's pause.
 *  2. js/app.js adoptSessionRecord arbitrated the flip to
 *     PAUSED by that SAVE stamp: `stateNewer = rec.updatedAt
 *     >= max(_lastStateAt, t.stateAt)`. The phone's page —
 *     RUNNING since its 08:16:47 auto-start — collected the
 *     record on a foreground return (visibilitychange ->
 *     collectSessionRecord) and folded ITSELF to paused with
 *     the echo's banked 00:24:47.
 *  3. The adoption then stamped the adopted pause as this
 *     layer's newest deliberate transition (t.stateAt =
 *     rec.updatedAt ≈ 08:24:47, the echo segment's own age) —
 *     THE MINT. From then on every arbitration (cloudsync
 *     v361 included) read the stamp as proof of his tap.
 *  4. The same mint armed the cloudsync road: a paused copy
 *     carrying a minted stateAt NEWER than a running copy's
 *     last real transition won the v361 same-session rule and
 *     installed over the running session on any client that
 *     pulled it.
 *
 *  BLAST RADIUS: both defective paths live in shared code —
 *  js/app.js (OTA-shipped to every client) and js/cloudsync.js
 *  (every signed-in client). ANY user whose session runs on a
 *  phone while any second surface of THEIR OWN account (an
 *  office web session, a restored browser, the native record
 *  fed by an echo) carries a paused copy of the same session
 *  could be paused uncommanded — pay hours ride on this timer
 *  for every driver on the system. Owner-operators running
 *  phone + desktop are the most exposed shape. Connect mirror
 *  viewers never write tracker state (read-only faces), so no
 *  viewer can cause it in another's book — but a driver's own
 *  surfaces suffice. The fix is code-only, shipped by the
 *  normal OTA pipeline; no user's data is touched.
 *
 *  THE FIX (web 365):
 *  - js/app.js adoptSessionRecord: a record may flip a RUNNING
 *    page to PAUSED only on the record's own DELIBERATE-
 *    transition stamp — stateAt strictly newer than the page's
 *    AND src 'native' (a face toggle is the only native writer
 *    of a pause; web writes are 'web', the arm seed 'arm').
 *    Anything else is an echo: the record is healed FROM the
 *    page's running facts and the page never stops. Equal
 *    stamps (this page's own earlier manufacture) never count.
 *  - js/cloudsync.js v361 rule: a cloud copy may NEVER pause
 *    or stop a locally RUNNING session, whatever its stateAt
 *    claims — the local stands and pushes UP. All other
 *    directions keep v361's stamp order (a later deliberate
 *    resume still installs over a local pause; a later
 *    deliberate close still installs over a local pause via
 *    the v352 tombstone family — neither ever touches a
 *    running local).
 *  - Preserved untouched: the v352 close law (a day closed on
 *    another client stands the phone down — healClosedTracker
 *    + the ct352 rule, neither modified), splitAutoPause (the
 *    split engine's own deliberate mechanism, gated on
 *    tracker.splitDay), face taps (nativeToggle — a real tap
 *    still pauses instantly, B2/B3 below), and all
 *    counting/miles behaviour.
 *
 *  Run: node tools/timer-stopped-by-itself-v365-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');
const csSrc = read('js/cloudsync.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));
const NATIVE_SR = path.resolve(ROOT, '..', 'meticulous-native', 'android',
  'app', 'src', 'main', 'java', 'com', 'meticuloustechnologies', 'app', 'SessionRecord.java');
const srSrc = fs.readFileSync(NATIVE_SR, 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }

const RealDate = Date;
let fakeNow = 0;
class FakeDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fakeNow])); }
  static now() { return fakeNow; }
}
async function pump() { for (let i = 0; i < 14; i++) await new Promise(function (r) { setImmediate(r); }); }
function settle(ms) { return new Promise(function (r) { setTimeout(r, ms || 600); }); }

/* Nov 7, 2026, America/Edmonton (UTC-6, no DST) */
const T0 = Date.parse('2026-11-07T08:00:00-06:00');        // the dispatch anchor
const SID = T0 + 412;                                       // the phone's pin
const SID_B = T0 + 699;                                     // the echo client's pin (same plan)
const SEG = Date.parse('2026-11-07T08:16:47-06:00');        // the phone's auto-start fold
const TPAUSE = Date.parse('2026-11-07T08:24:47-06:00');     // the echo clock's age / the minted stamp
const BANKED = 1487;                                        // 00:24:47
const T0920 = Date.parse('2026-11-07T09:20:00-06:00');
const TRESUME = Date.parse('2026-11-07T09:05:00-06:00');

/* The minted paused copy: the echo's identity and young clock,
   carrying a stateAt that READS as a deliberate 08:24:47 pause
   but was manufactured by adoption (see header). */
const MINTED_PAUSED = { status: 'paused', sessionId: SID_B, startTs: 0, elapsed: BANKED, stateAt: TPAUSE, startLabelMs: SID_B };
const PHONE_RUNNING = { status: 'running', sessionId: SID, startTs: SEG, elapsed: 1007, stateAt: SEG, startLabelMs: SID };

/* ================= Part A — cloudsync worlds ================= */
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
const CLEANMETA = { uid: 'u1', globallySynced: true, keys: { tracker: { t: 4000, s: 4000, u: 'u1' } } };
function cleanMeta() { return JSON.parse(JSON.stringify(CLEANMETA)); }

/* ============ Part B — the adoption rig (app.js slices) ============ */
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

/* The bridge as the phone ran it THAT MORNING: the pre-v73
   record (gen <= 52 native — no stateAt gate; stateAt carried
   but never arbitrated; every applied sync re-stamps
   updatedAt). sessionRecord() hands the web layer the full
   snapshot, exactly like ShiftTrackPlugin. */
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
  return {
    rec: rec, snap: snap,
    /* test-only: seed the record as another writer left it */
    seed: function (fields) { Object.keys(fields).forEach(function (k) { rec[k] = fields[k]; }); },
    sessionSync: function (facts) {
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
    sessionStopped: function () {}
  };
}
function makeStoreB() {
  const data = {};
  return {
    data: data,
    get: function (k, d) { const r = data['mt_' + k]; return r === undefined ? d : JSON.parse(r); },
    set: function (k, v) { data['mt_' + k] = JSON.stringify(v); return true; },
    del: function (k) { delete data['mt_' + k]; return true; }
  };
}
function makeWorldB(store, bridge) {
  const genericEl = { value: '', textContent: '', innerHTML: '',
    classList: { add: function () {}, remove: function () {}, contains: function () { return false; } }, onclick: null };
  const sb = {
    console: console, Promise: Promise, Date: FakeDate, JSON: JSON, Math: Math,
    setTimeout: function () { return 0; }, clearTimeout: function () {},
    confirm: function () { return true; }, closeSidebar: function () {},
    fmtClock: function (s) { return String(s); },
    todayStr: function (d) {
      d = d || new FakeDate();
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    },
    el: function () { return genericEl; },
    store: store, App: { tracker: null },
    trackerPaint: function () {}, paintHero: function () {}, paintBubble: function () {},
    pushWidgetState: function () {}, lastBubbleFacts: function () { return {}; },
    ShiftTrack: bridge
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(regionCode, sb);
  return sb;
}
function phonePage(bridge, tracker, lastStateAt) {
  const store = makeStoreB();
  const w = makeWorldB(store, bridge);
  w.App.tracker = tracker;
  w.App._sessRev = -1; w.App._lastStateAt = lastStateAt; w.App._lastLoadsAt = 0;
  return { store: store, w: w };
}

(async function () {
  console.log('— A: the cloud road (cloudsync v365) —');
  /* A1 — TODAY, driver phone + office web: the phone's page
     RUNNING (its own last real transition = the 08:16:47
     auto-start) pulls the minted PAUSED copy carrying the
     NEWEST doc stamp in the world and a stateAt that outranks
     its start. Pre-fix, the v361 rule installed the pause.
     Now the running session must stand, untouched, and be
     marked to push UP. */
  {
    const server = makeServer();
    serverSet(server, 'tracker', MINTED_PAUSED, 999999);
    const P = makeWorld(server, { local: [['tracker', PHONE_RUNNING]], meta: cleanMeta() });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    const t = P.get('tracker') || {};
    eq('A1 the running session is NEVER paused by a cloud copy', t.status, 'running');
    eq('A1 its segment start is untouched', t.startTs, SEG);
    eq('A1 its identity is untouched', t.sessionId, SID);
    eq('A1 no stamp was minted onto it', t.stateAt, SEG);
    const m = ((P.meta() || {}).keys || {}).tracker || {};
    ok('A1 the running truth is marked to push UP (tombstone idiom)', m.t > 4000 && typeof m.s === 'number', JSON.stringify(m));
  }
  /* A2 — owner-operator shape: his phone minted the same bad
     copy; his DESKTOP page is the running one. The arbitration
     is account-agnostic shared code — the desktop's running
     session must stand identically. */
  {
    const server = makeServer();
    serverSet(server, 'tracker', MINTED_PAUSED, 999999);
    const D = makeWorld(server, { local: [['tracker', PHONE_RUNNING]], meta: cleanMeta() });
    D.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    eq('A2 the second surface of the same account is protected identically', (D.get('tracker') || {}).status, 'running');
  }
  /* A3 — the v361 law that must SURVIVE: a later deliberate
     RESUME still installs over a local pause. */
  {
    const server = makeServer();
    serverSet(server, 'tracker', { status: 'running', sessionId: SID, startTs: TRESUME, elapsed: BANKED, stateAt: TRESUME, startLabelMs: SID }, 7000);
    const P = makeWorld(server, { local: [['tracker', { status: 'paused', sessionId: SID, startTs: 0, elapsed: BANKED, stateAt: TPAUSE, startLabelMs: SID }]], meta: cleanMeta() });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    const t = P.get('tracker') || {};
    eq('A3 a later deliberate resume still installs over a local pause', t.status, 'running');
    eq('A3 the resume carries its transition stamp', t.stateAt, TRESUME);
  }
  /* A4 — an OLDER cloud transition never resurrects over a
     newer local pause (the stamp order still guards the
     paused side). */
  {
    const server = makeServer();
    serverSet(server, 'tracker', { status: 'running', sessionId: SID_B, startTs: T0 + 5000, elapsed: 540, stateAt: T0 + 9 * 60000, startLabelMs: SID_B }, 8000);
    const P = makeWorld(server, { local: [['tracker', { status: 'paused', sessionId: SID, startTs: 0, elapsed: BANKED, stateAt: TPAUSE, startLabelMs: SID }]], meta: cleanMeta() });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    eq('A4 the older echo never resurrects over the newer pause', (P.get('tracker') || {}).status, 'paused');
  }
  /* A5 — the boundary, stated honestly: a legacy local copy
     carrying NO stateAt cannot engage the same-session rule at
     all (it also cannot mint one — the mint needs the stamp),
     and falls through to the pre-v361 stamp game exactly as
     before. Clean meta -> the cloud copy installs. */
  {
    const server = makeServer();
    serverSet(server, 'tracker', MINTED_PAUSED, 5000);
    const legacy = { status: 'running', sessionId: SID, startTs: SEG, elapsed: 900 };
    const L = makeWorld(server, { local: [['tracker', legacy]], meta: cleanMeta() });
    L.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    eq('A5 a stateAt-less legacy local arbitrates by the old game (boundary, unchanged)', (L.get('tracker') || {}).status, 'paused');
  }

  console.log('— B: the bridge road (adoptSessionRecord v365) —');
  /* B1 — TODAY at the bridge: the record holds the echo's
     PAUSED young clock, src 'web', stateAt 0 (pre-v73 records
     never arbitrated it), updatedAt refreshed minutes ago by
     day-fact syncs. The page is RUNNING. Pre-fix, stateNewer
     (updatedAt >= stateAt) folded the page to the record's
     pause and minted t.stateAt from rec.updatedAt. Now: the
     page must stay running, mint nothing, and the record must
     be healed FROM the page. */
  {
    const bridge = makeBridge();
    bridge.seed({ status: 'paused', elapsedBase: BANKED, segStartMs: 0, loads: 1, loadsManual: 0,
      loadsArmed: true, milesM: 76200, stateAt: 0, rev: 7, updatedAt: T0920, src: 'web', sessionKey: 's' + SID_B });
    const { w } = phonePage(bridge, { status: 'running', startTs: SEG, elapsed: 1007, sessionId: SID,
      stateAt: SEG, startLabelMs: SID, accum: { manualLoads: 0 } }, SEG);
    fakeNow = T0920;
    w.App.collectSessionRecord();
    await pump();
    eq('B1 the running page is NEVER folded to an echo pause', w.App.tracker.status, 'running');
    eq('B1 its segment is untouched', w.App.tracker.startTs, SEG);
    eq('B1 NO stamp is minted by the encounter', w.App.tracker.stateAt, SEG);
    ok('B1 the record is healed FROM the page (running, the page\u2019s own session)',
      bridge.rec.status === 'running' && bridge.rec.sessionKey === 's' + SID,
      JSON.stringify(bridge.snap()));
  }
  /* B2 — a REAL face tap still wins instantly: the record was
     toggled natively (src 'native', stateAt = the tap). The
     running page adopts the pause — that IS his deliberate
     tap, one step removed. */
  {
    const bridge = makeBridge();
    const TNATIVE = Date.parse('2026-11-07T09:10:00-06:00');
    bridge.seed({ status: 'paused', elapsedBase: 3900, segStartMs: 0, loads: 1, loadsManual: 0,
      loadsArmed: true, milesM: 70000, stateAt: TNATIVE, rev: 9, updatedAt: TNATIVE, src: 'native', sessionKey: 's' + SID });
    const { w } = phonePage(bridge, { status: 'running', startTs: SEG, elapsed: 1007, sessionId: SID,
      stateAt: SEG, startLabelMs: SID, accum: { manualLoads: 0 } }, SEG);
    fakeNow = TNATIVE + 5000;
    w.App.collectSessionRecord();
    await pump();
    eq('B2 a native face-tap pause still adopts at once', w.App.tracker.status, 'paused');
    eq('B2 the adopted pause carries the tap\u2019s bank', w.App.tracker.elapsed, 3900);
    eq('B2 the adopted transition is stamped from the record\u2019s tap', w.App.tracker.stateAt, TNATIVE);
  }
  /* B3 — the mirror: a native RESUME of a paused page still
     adopts (the running branch was never the defect). */
  {
    const bridge = makeBridge();
    const TNATIVE = Date.parse('2026-11-07T09:10:00-06:00');
    const TRES2 = Date.parse('2026-11-07T09:20:00-06:00');
    bridge.seed({ status: 'running', elapsedBase: 3900, segStartMs: TRES2, loads: 1, loadsManual: 0,
      loadsArmed: true, milesM: 71000, stateAt: TRES2, rev: 11, updatedAt: TRES2, src: 'native', sessionKey: 's' + SID });
    const { w } = phonePage(bridge, { status: 'paused', startTs: 0, elapsed: 3900, sessionId: SID,
      stateAt: TNATIVE, startLabelMs: SID, accum: { manualLoads: 0 } }, TNATIVE);
    fakeNow = TRES2 + 5000;
    w.App.collectSessionRecord();
    await pump();
    eq('B3 a native face-tap resume still adopts at once', w.App.tracker.status, 'running');
    eq('B3 the resumed segment is the tap\u2019s', w.App.tracker.startTs, TRES2);
  }
  /* B4 — an ALREADY-minted record (stateAt == the page's own
     stamp, src 'web') can never pause a running page on a
     later collect: equal stamps are this page's own earlier
     manufacture, never proof of a tap, and 'web' is never a
     face. */
  {
    const bridge = makeBridge();
    bridge.seed({ status: 'paused', elapsedBase: BANKED, segStartMs: 0, loads: 2, loadsManual: 0,
      loadsArmed: true, milesM: 82000, stateAt: TPAUSE, rev: 13, updatedAt: Date.parse('2026-11-07T09:30:00-06:00'), src: 'web', sessionKey: 's' + SID_B });
    const { w } = phonePage(bridge, { status: 'running', startTs: Date.parse('2026-11-07T09:12:00-06:00'), elapsed: 3300, sessionId: SID,
      stateAt: TPAUSE, startLabelMs: SID, accum: { manualLoads: 0 } }, TPAUSE);
    fakeNow = Date.parse('2026-11-07T09:30:00-06:00');
    w.App.collectSessionRecord();
    await pump();
    eq('B4 an equal-stamp web-sourced record never pauses a running page', w.App.tracker.status, 'running');
  }
  /* B5 — a stale IDLE record against a live page changes
     nothing (the standing defensive branch, untouched). */
  {
    const bridge = makeBridge();
    bridge.seed({ status: 'idle', elapsedBase: 0, segStartMs: 0, rev: 3, updatedAt: T0920, src: 'web', sessionKey: '' });
    const { w } = phonePage(bridge, { status: 'running', startTs: SEG, elapsed: 1007, sessionId: SID,
      stateAt: SEG, startLabelMs: SID, accum: { manualLoads: 0 } }, SEG);
    fakeNow = T0920;
    w.App.collectSessionRecord();
    await pump();
    eq('B5 a stray idle record still leaves the session alone', w.App.tracker.status, 'running');
  }

  console.log('— C: source pins —');
  ok('C1 adoption gates the pause flip on a native deliberate stamp',
    /recDelib365 = \(rec\.stateAt \|\| 0\) > \(t\.stateAt \|\| 0\) && rec\.src === 'native'/.test(appSrc));
  ok('C2 the refusal heals the record from the page (ghost-branch idiom)',
    /TIMER-STOPPED-BY-ITSELF/.test(appSrc) && /an echo: the record is/.test(appSrc));
  ok('C3 cloudsync refuses a non-running cloud copy over a running local',
    /sa365LocalRunning && !sa365CloudRunning/.test(csSrc) && /TIMER-STOPPED-BY-ITSELF/.test(csSrc));
  ok('C4 the native face toggle is the one native pause writer (src native + stamp)',
    /n\.src = "native";/.test(srSrc) && /n\.stateAt = now;/.test(srSrc));
  ok('C5 the v352 close law stands untouched (heal + tombstone family intact)',
    /function healClosedTracker\(\)/.test(appSrc) && /ct352CloudLive/.test(csSrc));
  ok('C6 the split engine\u2019s deliberate self-pause stands (splitDay-gated, untouched)',
    /App\.splitAutoPause = function/.test(appSrc));

  console.log('— ship pins —');
  eq('webVersion is 366 (365 + the deploy-unblock release)', ver.webVersion, 366);
  ok('index.html pins app.js?v=365 and cloudsync.js?v=365',
    idxSrc.indexOf('js/app.js?v=365') >= 0 && idxSrc.indexOf('js/cloudsync.js?v=365') >= 0 /* the v365 asset tags ride unchanged into 366 */);
  const crypto = require('crypto');
  ok('version.json hashes match the shipped files',
    ver.files['js/app.js'] === crypto.createHash('sha256').update(read('js/app.js')).digest('hex') &&
    ver.files['js/cloudsync.js'] === crypto.createHash('sha256').update(read('js/cloudsync.js')).digest('hex'));

  console.log('\ntimer-stopped-by-itself-v365: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL suite threw: ' + (e && e.stack || e)); process.exit(1); });
