#!/usr/bin/env node
/* Meticulous — TIMER-SELF-PAUSE-NOV13 (owner, Fri Nov 13, 2026,
 * ~11:10-11:14 CST-phone, two screen recordings minutes apart).
 * Recording 1 (~11:10): the tracker card stands PAUSED, frozen
 * at 03:40:47 with a RESUME button, mid-shift, the bubble face
 * agreeing. Recording 2 (~11:11): the same session RUNNING and
 * ticking (03:43:10+, card and bubble in sync). His words: "I
 * noticed in that video the timer was paused. I didn't pause
 * it." The bank is FULL — 03:40:47 is exactly 7:30 AM -> 11:10:47,
 * no counted time lost before the freeze — so the pause was
 * minted at ~11:10:47, minutes after he pegged the dump at the
 * day's second site (11:10), while his page was live and running.
 *
 * His law (Nov 7, restated Nov 11, binding): a running timer
 * pauses/stops ONLY on his tap or a day close — never by an
 * echo, copy, sync, notification action, widget/bubble
 * interaction, or any background event.
 *
 * THE INVENTORY (every writer of a paused state, read end to
 * end on web 450 bytes — js/app.js, js/cloudsync.js,
 * js/shifttrack.js, js/splitshift.js, js/yardstart.js, native
 * SessionRecord.java / FaceActions.java):
 *  - app.js trackerToggle (3933): his tap only — the hero
 *    button, the in-page bubble button, a widget word. The
 *    widget's working buttons have performed NATIVELY since
 *    native v54; the web word channel now carries 'stop' only.
 *  - app.js splitAutoPause (4442): the split engine's hands,
 *    double-gated — SplitShift.startDay claims a session only
 *    when onboarding.workPattern === 'split' (the school-bus
 *    pattern; his is the hourly/foreman pattern), and the
 *    engine must have claimed THIS session at its start.
 *  - app.js adoptSessionRecord flip (2464): fires only on a
 *    record stamped by a DELIBERATE native transition
 *    (rec.stateAt > page's AND rec.src === 'native'). The only
 *    native writer of that shape is SessionRecord.nativeToggle,
 *    reached solely from physical face taps (FaceActions via
 *    WidgetActionReceiver / BubbleOverlay / PipActionReceiver —
 *    explicit-component broadcasts and view clicks; no timer,
 *    alarm, service or notification path calls it). Part B2
 *    proves the gate still admits exactly that shape.
 *  - app.js adoptSessionRecord idle-restore (2502): needs the
 *    page IDLE. His page was live and running at 11:10 (he
 *    pegged the dump from it at 11:10); Part B1 proves a
 *    running page refuses a web-stamped paused record.
 *  - yardstart.js: writes no tracker state at all (dispatch
 *    activation only; its own header law: "It never stops
 *    anything").
 *  - cloudsync pull arbitration: THE ROAD LEFT OPEN (Part A).
 *
 * THE DEFECT (Part A, proven below on web 450 bytes): the
 * pull's never-pause guards are all PIN-FAMILY guards. The
 * v361/v365 stamp rule engages only when both pins sit within
 * the 5000 ms jitter family; the v423 guard fires only in that
 * same family (or for a pin-less copy). A PAUSED cloud copy
 * whose session pin differs from the running local's by MORE
 * than the jitter reaches an install branch neither guard
 * sees:
 *   - pin LATER (any amount past the family): the v265
 *     later-session rule installs it WHOLESALE — no status
 *     check, no stamp arbitration, no jitter tolerance — ahead
 *     of the v423 guard. A2 (pin +1500 ms, the derivation-twin
 *     shape: trackerSessionStartMs is a DERIVATION, and the
 *     v411 record documents one dispatch carrying two pins —
 *     the arm's and the web's) and A3 (pin +26 min: Nov 13's
 *     own twin pair — his manual start pinned the session at
 *     the 7:04 tap while the plan/arm key is the 7:30 anchor
 *     the card counts from).
 *   - pin EARLIER: v265 cannot fire, v303 buries only
 *     discarded/stale-day shells, v352/cd411 judge closes —
 *     the copy falls to the generic stamp game, which installs
 *     it wholesale in the settled window (A4).
 * Once installed in the store, js/app.js onAuth re-reads the
 * store copy into the live page wholesale (app.js:904) — the
 * running timer stands paused mid-flight, on every face, with
 * its full bank: his two recordings, digit for digit. (The
 * resume minutes later is the same family in reverse or his
 * own RESUME tap — the recordings cannot say, and the fix
 * does not depend on it: no copy may mint the pause.)
 *
 * Twin pins are not hypothetical for this day: his session was
 * started by a 7:04 manual tap (pin = the tap) on a 7:30
 * dispatch (anchor/arm pin = 7:30, the card's "Counting from
 * 7:30 AM"), and surfaces restore the session's stateAt
 * VERBATIM (restores and ordinary saves never re-stamp it), so
 * a folded copy of either pin reaches a pull with stamps no
 * arbitration can read as foreign.
 *
 * THE FIX (js/cloudsync.js only, two clauses of one rule —
 * a cloud copy may NEVER install a PAUSED state over a
 * locally RUNNING copy that carries a deliberate-transition
 * stamp, whatever the pins):
 *  1. the v265 later-session rule no longer installs a PAUSED
 *     copy over such a local; the copy falls through to the
 *     guards below (a genuinely newer RUNNING session still
 *     installs exactly as before — A5).
 *  2. the v423 guard's pin-family condition gains the
 *     stamp-carrying case: a stateAt-carrying running local is
 *     pause-proof at any pin distance, in either direction.
 * The scoping is deliberate: a stateAt-LESS running local is
 * a pre-v361 legacy fossil (every transition writer since
 * v361 stamps stateAt — trackerToggle's start included), and
 * its documented v365-A5 boundary (a newer-pin copy wins by
 * pin order) stands untouched — A9 asserts it byte-for-byte.
 * Closes are untouched (cd411/v352 install IDLE on proof,
 * never a pause — A8). Restores over idle/paused locals are
 * untouched (A6/A7).
 *
 *  Run: TZ=America/Edmonton node tools/timer-self-pause-nov13-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');
const csSrc = read('js/cloudsync.js');
const ver = JSON.parse(read('version.json'));
const EXPECTED_VERSION = 451;

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

/* Fri Nov 13, 2026, local components (TZ=America/Edmonton) */
function local(y, mo, d, h, mi, s) { return new RealDate(y, mo, d, h, mi || 0, s || 0).getTime(); }
const TAP = local(2026, 10, 13, 7, 4, 0);          // his manual START tap
const SID_TAP = TAP + 412;                          // the phone session's pin (the tap)
const ANCHOR = local(2026, 10, 13, 7, 30, 0);       // the dispatch anchor
const SID_PLAN = ANCHOR;                            // the plan/arm pin — the twin
const BANK = 13247;                                 // 03:40:47 — recording 1, digit for digit
const T1110 = local(2026, 10, 13, 11, 10, 47);      // the freeze moment the bank implies
function dayStr(ms) {
  const d = new RealDate(ms);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const DAY = dayStr(SID_TAP);

/* His phone's session as it ran all morning: pinned at the
   7:04 tap, counting from the 7:30 anchor, its deliberate
   stamp the morning's start/edit (copies carry it verbatim). */
const RUNNING = { status: 'running', sessionId: SID_TAP, startTs: ANCHOR, elapsed: 3600, stateAt: TAP, startLabelMs: SID_PLAN };
/* The same session pinned at the anchor instead (a surface
   that holds the plan-pinned copy as its live one). */
const RUNNING_PLAN = { status: 'running', sessionId: SID_PLAN, startTs: ANCHOR, elapsed: 3600, stateAt: ANCHOR, startLabelMs: SID_PLAN };
/* Paused copies of the SAME day, bank full, in the three pin
   shapes the guards cannot see as family. */
const PAUSED_JITTER = { status: 'paused', sessionId: SID_TAP + 1500, startTs: 0, elapsed: BANK, stateAt: TAP, startLabelMs: SID_PLAN };
const PAUSED_PLAN = { status: 'paused', sessionId: SID_PLAN, startTs: 0, elapsed: BANK, stateAt: ANCHOR, startLabelMs: SID_PLAN };
const PAUSED_TAP = { status: 'paused', sessionId: SID_TAP, startTs: 0, elapsed: BANK, stateAt: TAP, startLabelMs: SID_PLAN };

/* ================= Part A — cloudsync worlds =================
   (the v365/v423 harness pattern, unchanged) */
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
function metaWith(trackerKm) {
  return { uid: 'u1', globallySynced: true, keys: { tracker: trackerKm } };
}
const SETTLED = { t: 4000, s: 4000, u: 'u1' };

/* ============ Part B — the adoption rig (app.js slices) ======
   (the v365/v423 harness pattern, unchanged) */
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

/* The bridge per SessionRecord.java: sessionSync arbitrates
   by stateAt (v73 freeze / v85 ratchet — neither is exercised
   by these scenarios' shapes), stamps src 'web' on an applied
   write and keeps it under a freeze (v88); the record snapshot
   is the full face truth. */
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
  console.log('— A: the cloud road (js/cloudsync.js), Nov 13 shapes —');
  /* A1 — the control: a paused copy of the SAME pin, stamps
     verbatim. The v423 guard already holds this door; it must
     keep holding it. */
  {
    const server = makeServer();
    serverSet(server, 'tracker', { status: 'paused', sessionId: SID_TAP, startTs: 0, elapsed: BANK, stateAt: TAP, startLabelMs: SID_PLAN }, 5000);
    const P = makeWorld(server, { local: [['tracker', RUNNING]], meta: metaWith(SETTLED) });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    eq('A1 (control) a same-pin paused copy never installs over the running session', (P.get('tracker') || {}).status, 'running');
  }
  /* A2 — TODAY, the derivation twin: the paused copy's pin is
     the same session re-derived 1500 ms later (the v361 jitter
     family is 5000 ms wide, but the stamp rule needs the
     stamps to DIFFER and these are verbatim-equal, so no
     stamp rule engages at all) — and the v265 later-session
     rule, which has NO jitter tolerance, installs any copy
     whose pin is 1 ms greater. Pre-fix: PAUSED lands in the
     store; onAuth's re-read pauses the live page. */
  {
    const server = makeServer();
    serverSet(server, 'tracker', PAUSED_JITTER, 5000);
    const P = makeWorld(server, { local: [['tracker', RUNNING]], meta: metaWith(SETTLED) });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    const t = P.get('tracker') || {};
    eq('A2 a derivation-twin paused copy (pin +1500 ms) NEVER installs over the running session', t.status, 'running');
    eq('A2 the live session identity is untouched', t.sessionId, SID_TAP);
    const m = ((P.meta() || {}).keys || {}).tracker || {};
    ok('A2 the running truth is marked to push UP (tombstone idiom)', m.t > 4000 && typeof m.s === 'number', JSON.stringify(m));
  }
  /* A3 — TODAY, the day's own twin pins: his 7:04 manual tap
     pinned the phone's session; the 7:30 anchor pins the
     plan/arm copy. A paused copy under the ANCHOR pin is a
     "later session" to v265 and installs wholesale pre-fix. */
  {
    const server = makeServer();
    serverSet(server, 'tracker', PAUSED_PLAN, 5000);
    const P = makeWorld(server, { local: [['tracker', RUNNING]], meta: metaWith(SETTLED) });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    const t = P.get('tracker') || {};
    eq('A3 an anchor-twin paused copy (pin = the 7:30 plan) NEVER installs over the running session', t.status, 'running');
    eq('A3 the live session identity is untouched', t.sessionId, SID_TAP);
  }
  /* A3b — the same twin in the both-changed window (the local
     key dirty from the minute re-save, the cloud stamp newer):
     v265 ignores dirtiness entirely, so the install pre-fix
     is the same. */
  {
    const server = makeServer();
    serverSet(server, 'tracker', PAUSED_PLAN, 5000);
    const P = makeWorld(server, { local: [['tracker', RUNNING]], meta: metaWith({ t: 4500, s: 4000, u: 'u1' }) });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    eq('A3b a both-changed pull NEVER installs the anchor-twin pause either', (P.get('tracker') || {}).status, 'running');
  }
  /* A4 — the mirror: the live copy is the plan-pinned one and
     the paused copy carries the EARLIER tap pin. No pin rule
     guards an earlier pin over a running local; the generic
     game installs it in the settled window pre-fix. */
  {
    const server = makeServer();
    serverSet(server, 'tracker', PAUSED_TAP, 5000);
    const P = makeWorld(server, { local: [['tracker', RUNNING_PLAN]], meta: metaWith(SETTLED) });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    const t = P.get('tracker') || {};
    eq('A4 an earlier-pin paused copy NEVER installs over the running session', t.status, 'running');
    eq('A4 the live session identity is untouched', t.sessionId, SID_PLAN);
  }
  /* A5 — the v265 law that must SURVIVE: a genuinely newer
     RUNNING session still wins by pin order over a stale
     running local (the Oct 26 shape the rule was built for). */
  {
    const server = makeServer();
    serverSet(server, 'tracker', { status: 'running', sessionId: SID_PLAN, startTs: ANCHOR, elapsed: 3000, stateAt: ANCHOR, startLabelMs: SID_PLAN }, 5000);
    const P = makeWorld(server, { local: [['tracker', RUNNING]], meta: metaWith(SETTLED) });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    const t = P.get('tracker') || {};
    eq('A5 a newer RUNNING session still installs by pin order (v265 untouched)', t.status, 'running');
    eq('A5 the newer session identity lands', t.sessionId, SID_PLAN);
  }
  /* A6 — the restore that must SURVIVE: an idle local takes a
     paused copy of a later pin exactly as before (a session
     restored onto a surface that holds none). */
  {
    const server = makeServer();
    serverSet(server, 'tracker', PAUSED_PLAN, 5000);
    const P = makeWorld(server, { local: [['tracker', { status: 'idle', startTs: 0, elapsed: 0, stateAt: TAP }]], meta: metaWith(SETTLED) });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    eq('A6 an idle local still restores a later-pin paused session', (P.get('tracker') || {}).status, 'paused');
  }
  /* A7 — the v361 direction that must SURVIVE: a later
     deliberate RESUME installs over a local pause. */
  {
    const server = makeServer();
    const TPAUSE = local(2026, 10, 13, 9, 24, 0), TRESUME = local(2026, 10, 13, 10, 5, 0);
    serverSet(server, 'tracker', { status: 'running', sessionId: SID_TAP, startTs: TRESUME, elapsed: BANK, stateAt: TRESUME, startLabelMs: SID_PLAN }, 7000);
    const P = makeWorld(server, { local: [['tracker', { status: 'paused', sessionId: SID_TAP, startTs: 0, elapsed: BANK, stateAt: TPAUSE, startLabelMs: SID_PLAN }]], meta: metaWith(SETTLED) });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    eq('A7 a later deliberate resume still installs over a local pause', (P.get('tracker') || {}).status, 'running');
  }
  /* A8 — the close law that must SURVIVE (v411/cd411): the
     day closed on another surface — the pull's own docs carry
     the completed dispatch and the idle tracker — a running
     local still stands down to IDLE. A close is not a pause
     and this fix never touches it. */
  {
    const server = makeServer();
    serverSet(server, 'tracker', { status: 'idle', startTs: 0, elapsed: 0, stateAt: T1110 }, 5000);
    serverSet(server, 'dsp_list', [{ id: 'd1', status: 'completed', scheduledAt: DAY + 'T07:30', date: DAY, jobSite: 'Aecon Trans' }], 5000);
    const meta = { uid: 'u1', globallySynced: true, keys: { tracker: SETTLED, dsp_list: { t: 4000, s: 4000, u: 'u1' }, sessions: { t: 4000, s: 4000, u: 'u1' } } };
    const P = makeWorld(server, { local: [['tracker', RUNNING], ['sessions', []], ['dsp_list', [{ id: 'd1', status: 'in-progress', scheduledAt: DAY + 'T07:30', date: DAY, jobSite: 'Aecon Trans' }]]], meta: meta });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    eq('A8 a closed day still stands a running local down (close law untouched)', (P.get('tracker') || {}).status, 'idle');
  }
  /* A9 — the documented v365 boundary, asserted UNCHANGED:
     a stateAt-LESS legacy running local (a pre-v361 fossil —
     no current writer produces one for a live session) still
     arbitrates a newer-pin copy by pin order. The fix is
     scoped to stamp-carrying copies — every copy the shipped
     code has written since v361 — and this boundary is the
     price of that scope, stated as plainly as v365 stated it. */
  {
    const server = makeServer();
    serverSet(server, 'tracker', { status: 'paused', sessionId: SID_TAP + 287, startTs: 0, elapsed: BANK, stateAt: local(2026, 10, 13, 8, 24, 47), startLabelMs: SID_TAP + 287 }, 5000);
    const legacy = { status: 'running', sessionId: SID_TAP, startTs: ANCHOR, elapsed: 900 };
    const P = makeWorld(server, { local: [['tracker', legacy]], meta: metaWith(SETTLED) });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    eq('A9 (boundary, unchanged) a stateAt-less legacy local still arbitrates by pin order', (P.get('tracker') || {}).status, 'paused');
  }

  console.log('— B: the record road (adoptSessionRecord), Nov 13 postures —');
  /* B1 — his actual posture at 11:10: the page LIVE and
     RUNNING (he pegged the dump from it a minute earlier).
     A record standing paused on a WEB stamp (a second
     surface's fold synced into the record) may not flip it:
     the v365 gate demands a deliberate NATIVE transition.
     The record is healed from the page instead. */
  {
    const bridge = makeBridge();
    bridge.seed({ status: 'paused', elapsedBase: BANK, segStartMs: 0, loads: 3, loadsManual: 1,
      loadsArmed: true, milesM: 51600, stateAt: T1110, rev: 21, updatedAt: T1110, src: 'web', sessionKey: 's' + SID_TAP });
    const { w } = phonePage(bridge, { status: 'running', startTs: ANCHOR, elapsed: 3600, sessionId: SID_TAP,
      stateAt: TAP, startLabelMs: SID_PLAN, accum: { manualLoads: 1 } }, TAP);
    fakeNow = T1110 + 5000;
    w.App.collectSessionRecord();
    await pump();
    eq('B1 a running page NEVER folds to a web-stamped paused record', w.App.tracker.status, 'running');
  }
  /* B2 — the one record shape that may fold a running page,
     asserted intact: a DELIBERATE native transition (src
     'native', stateAt newer than the page's) — a shape whose
     only writer in the shipped code is SessionRecord
     .nativeToggle, reached solely from physical face taps.
     The gate is tap-shaped by construction; this is the
     control that proves the fix did not need to touch it. */
  {
    const bridge = makeBridge();
    bridge.seed({ status: 'paused', elapsedBase: BANK, segStartMs: 0, loads: 3, loadsManual: 1,
      loadsArmed: true, milesM: 51600, stateAt: T1110, rev: 23, updatedAt: T1110, src: 'native', sessionKey: 's' + SID_TAP });
    const { w } = phonePage(bridge, { status: 'running', startTs: ANCHOR, elapsed: 3600, sessionId: SID_TAP,
      stateAt: TAP, startLabelMs: SID_PLAN, accum: { manualLoads: 1 } }, TAP);
    fakeNow = T1110 + 5000;
    w.App.collectSessionRecord();
    await pump();
    eq('B2 a deliberate native face-tap pause still folds a running page (v365 untouched)', w.App.tracker.status, 'paused');
    eq('B2 the adopted pause carries the record bank', w.App.tracker.elapsed, BANK);
  }
  /* B3 — the arm-seed restore that must SURVIVE: a fresh page
     meets the DayScheduler's seeded RUNNING record under the
     ANCHOR pin and adopts it running — the twin key heals to
     the page's session on the next sync, never to a pause. */
  {
    const bridge = makeBridge();
    bridge.seed({ status: 'running', elapsedBase: 0, segStartMs: ANCHOR, loads: 0, loadsManual: 0,
      loadsArmed: false, milesM: -1, stateAt: ANCHOR, rev: 3, updatedAt: ANCHOR, src: 'arm', sessionKey: 's' + SID_PLAN });
    const { w } = phonePage(bridge, { status: 'idle', startTs: 0, elapsed: 0 }, 0);
    fakeNow = local(2026, 10, 13, 7, 35, 0);
    w.App.collectSessionRecord();
    await pump();
    eq('B3 the arm seed still restores running at reopen', w.App.tracker.status, 'running');
  }

  console.log('— C: source pins —');
  ok('C1 the v265 rule refuses a paused copy over a stamp-carrying running local (v451)',
    /TIMER-SELF-PAUSE-NOV13/.test(csSrc) && /trk265Local/.test(csSrc));
  ok('C2 the v423 guard covers a stamp-carrying running local at any pin distance (v451)',
    /lp423Stamped/.test(csSrc));
  ok('C3 the v365 cloud rule stands untouched',
    /sa365LocalRunning && !sa365CloudRunning/.test(csSrc));
  ok('C4 the v365 deliberate flip stands untouched',
    /recDelib365 = \(rec\.stateAt \|\| 0\) > \(t\.stateAt \|\| 0\) && rec\.src === 'native'/.test(appSrc));
  ok('C5 the v411 close rule stands untouched',
    /cd411JudgeSid/.test(csSrc) && /function healClosedTracker\(\)/.test(appSrc));
  ok('C6 the split engine stays preference-gated (its only road to the tracker)',
    /workPattern === 'split'/.test(read('js/splitshift.js')) && /App\.splitAutoPause = function/.test(appSrc));

  console.log('— ship pins —');
  eq('webVersion is ' + EXPECTED_VERSION, ver.webVersion, EXPECTED_VERSION);
  const crypto = require('crypto');
  ok('version.json hashes match the shipped files',
    ver.files['js/cloudsync.js'] === crypto.createHash('sha256').update(read('js/cloudsync.js')).digest('hex'));

  console.log('\ntimer-self-pause-nov13: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL suite threw: ' + (e && e.stack || e)); process.exit(1); });
