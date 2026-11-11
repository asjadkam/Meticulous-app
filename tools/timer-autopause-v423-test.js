#!/usr/bin/env node
/* Meticulous v423 — TIMER-PAUSED-ITSELF-NOV11 (owner, Wed Nov 11,
 * 2026, 16:33 CST: "I just opened the app to see the count. And
 * found it paused.. Without any action from me! Now it's off by
 * 1.5 hours!"). The card: Paused, 07:59:57 banked, "Counting from
 * 8:00 AM", loads 7, miles 183.4. He had fully closed and reopened
 * the app at ~14:39 (to load webs 421/422); the session resumed;
 * by the time he looked again it stood PAUSED, its bank exactly
 * the elapsed time to ~16:00. He tapped no pause — his law since
 * Nov 7: a running timer pauses ONLY on his tap or a day close.
 *
 * Web 365 closed the two STAMP-arbitrated roads (the cloudsync
 * v361 rule and the adoption flip): both engage only when the
 * copies carry deliberate-transition stamps that DIFFER. The
 * inventory of every remaining road (read end to end on web 422
 * bytes — js/app.js, js/cloudsync.js, js/shifttrack.js,
 * js/splitshift.js, the native SessionRecord.java) leaves two
 * roads that can land a PAUSED state on a running session with
 * no tap anywhere on this device:
 *
 *  ROAD 1 — THE CLOUD STAMP GAME (Part A). Copies of the SAME
 *  session restored on another of his surfaces carry the
 *  session's stateAt VERBATIM — restores and ordinary saves
 *  never re-stamp it, only transitions do. A paused copy of this
 *  session (folded on another surface, or left by an echo)
 *  therefore reaches the pull with an EQUAL stateAt, the v361
 *  rule never engages, and the pull falls to the generic game:
 *  a settled local key takes the cloud copy WHOLESALE
 *  (!localDirty && cloudChanged), and a both-changed key takes
 *  it on the doc stamp alone. js/app.js onAuth then re-reads
 *  the store copy into the live page — the running timer is
 *  paused mid-flight by a flag that was never his tap. A
 *  stateAt-less paused copy (a legacy/echo shell) takes the
 *  same road: the v361 rule needs BOTH stamps > 0.
 *
 *  ROAD 2 — THE REOPEN RESTORE (Part B). adoptSessionRecord's
 *  idle-page restore adopts a PAUSED record wholesale on the
 *  record's SAVE stamp alone (stateNewer = updatedAt >= the
 *  page's stamps, and a relaunched page's _lastStateAt resets
 *  to 0). Any paused record — an echo's young clock, a stale
 *  shell no transition writer ever stamped — becomes the
 *  page's truth at the reopen: he opens the app and finds it
 *  paused, bank intact, exactly as photographed.
 *
 * THE FIX (web 423):
 *  - js/cloudsync.js: a cloud copy may NEVER install a PAUSED
 *    state over a locally RUNNING copy of the same session
 *    (pins within the v361 jitter family, or a pin-less copy),
 *    whatever stamps it carries — the v365 law completed for
 *    the equal/stale-stamp cases its rule cannot see. The
 *    local stands; the key stays dirty (tombstone idiom) so
 *    the flush pushes the running truth UP. A local PAUSE is
 *    untouched (a later deliberate resume still installs —
 *    A3); the v411 close still stands a closed day down (A4);
 *    different-session copies keep their arbitration (A5).
 *  - js/app.js: the idle-page restore adopts a record's PAUSED
 *    state only when the record carries a deliberate-transition
 *    stamp (stateAt > 0 — every real pause writer stamps one:
 *    his page tap, his face tap, a web-surface tap, the split
 *    engine). An UNSTAMPED paused record is no one's tap: the
 *    session restores RUNNING with its bank preserved whole
 *    and its segment re-anchored at the restore moment, so no
 *    counted time is lost and no phantom pause lands (B1). A
 *    stamped pause — his face tap above all — still restores
 *    exactly as paused (B2), and the v365 face-tap flip of a
 *    running page is untouched (B3), as is the arm-seed
 *    restore (B4).
 *
 *  Run: TZ=America/Edmonton node tools/timer-autopause-v423-test.js
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

/* Wed Nov 11, 2026, local components (TZ=America/Edmonton) */
function local(y, mo, d, h, mi, s) { return new RealDate(y, mo, d, h, mi || 0, s || 0).getTime(); }
const PIN = local(2026, 10, 11, 8, 0, 0);              // the 8:00 AM dispatch pin
const SID = PIN + 412;                                 // the phone's session pin
const SID_OLD = local(2026, 10, 10, 8, 0, 0) + 300;    // yesterday's session pin
const BANK = 28797;                                    // 07:59:57 — his card, digit for digit
const T1600 = local(2026, 10, 11, 16, 0, 0);           // the fold moment his bank implies
const T1633 = local(2026, 10, 11, 16, 33, 0);          // when he opened the app and found it
const TPAUSE_LOCAL = local(2026, 10, 11, 9, 24, 0);    // a deliberate-pause stamp (A3)
const TRESUME = local(2026, 10, 11, 15, 5, 0);         // a later deliberate resume (A3)
function dayStr(ms) {
  const d = new RealDate(ms);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const DAY = dayStr(SID);

/* The running session as his phone held it all day: pinned to
   the 8:00 plan, one deliberate transition on it — the morning
   start (stateAt = the pin). */
const RUNNING = { status: 'running', sessionId: SID, startTs: PIN, elapsed: 1007, stateAt: PIN, startLabelMs: SID };
/* The paused copy of the SAME session as another surface holds
   it: restored verbatim (stateAt is still the morning start —
   restores and ordinary saves never re-stamp it), folded to
   paused, carrying his full bank. */
const PAUSED_SAME = { status: 'paused', sessionId: SID, startTs: 0, elapsed: BANK, stateAt: PIN, startLabelMs: SID };

/* ================= Part A — cloudsync worlds =================
   (the v365 harness pattern, unchanged) */
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

/* ============ Part B — the adoption rig (app.js slices) ======
   (the v365 harness pattern, unchanged) */
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

/* The bridge per SessionRecord.java (gen 78): sessionSync
   arbitrates by stateAt (v73 freeze / v85 ratchet — neither is
   exercised by these scenarios' shapes), stamps src 'web' on an
   applied write and keeps it under a freeze (v88); the record
   snapshot is the full face truth. */
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
  console.log('— A: the cloud road (js/cloudsync.js) —');
  /* A1 — TODAY, the settled window: the phone's tracker key is
     settled (its last flush landed; the next minute re-save has
     not stamped it dirty yet) when a pull meets the paused copy
     of the SAME session carrying the session's own stateAt
     verbatim. The v361 rule cannot engage (equal stamps); the
     generic game installs the copy wholesale. Pre-fix the
     store — and, via onAuth's re-read, the live page — stands
     PAUSED. Post-fix the running session stands and the key is
     marked to push UP. */
  {
    const server = makeServer();
    serverSet(server, 'tracker', PAUSED_SAME, 5000);
    const P = makeWorld(server, { local: [['tracker', RUNNING]], meta: metaWith({ t: 4000, s: 4000, u: 'u1' }) });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    const t = P.get('tracker') || {};
    eq('A1 a settled pull NEVER installs a same-session pause over a running session', t.status, 'running');
    eq('A1 its segment start is untouched', t.startTs, PIN);
    eq('A1 no stamp was minted onto it', t.stateAt, PIN);
    const m = ((P.meta() || {}).keys || {}).tracker || {};
    ok('A1 the running truth is marked to push UP (tombstone idiom)', m.t > 4000 && typeof m.s === 'number', JSON.stringify(m));
  }
  /* A2 — TODAY, the both-changed window: the local key is dirty
     (the minute re-save stamped it) AND the cloud changed, and
     the paused copy's doc stamp beats the local stamp. Same
     equal-stateAt blindness, same wholesale install pre-fix. */
  {
    const server = makeServer();
    serverSet(server, 'tracker', PAUSED_SAME, 5000);
    const P = makeWorld(server, { local: [['tracker', RUNNING]], meta: metaWith({ t: 4500, s: 4000, u: 'u1' }) });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    const t = P.get('tracker') || {};
    eq('A2 a both-changed pull NEVER installs a same-session pause over a running session', t.status, 'running');
    eq('A2 its identity is untouched', t.sessionId, SID);
  }
  /* A2b — the stateAt-less echo: a paused copy carrying NO
     deliberate stamp at all (a legacy shell). The v361 rule
     needs both stamps > 0, so this copy also reached the
     generic game unguarded. */
  {
    const server = makeServer();
    const legacyPaused = { status: 'paused', sessionId: SID, startTs: 0, elapsed: BANK, startLabelMs: SID };
    serverSet(server, 'tracker', legacyPaused, 5000);
    const P = makeWorld(server, { local: [['tracker', RUNNING]], meta: metaWith({ t: 4000, s: 4000, u: 'u1' }) });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    eq('A2b a stateAt-less paused copy NEVER installs over a running session', (P.get('tracker') || {}).status, 'running');
  }
  /* A3 — the v361 law that must SURVIVE: a later deliberate
     RESUME still installs over a local pause (his tap on
     another surface is a real transition, and the local side
     is not running — nothing here is pause-proof). */
  {
    const server = makeServer();
    serverSet(server, 'tracker', { status: 'running', sessionId: SID, startTs: TRESUME, elapsed: BANK, stateAt: TRESUME, startLabelMs: SID }, 7000);
    const P = makeWorld(server, { local: [['tracker', { status: 'paused', sessionId: SID, startTs: 0, elapsed: BANK, stateAt: TPAUSE_LOCAL, startLabelMs: SID }]], meta: metaWith({ t: 4000, s: 4000, u: 'u1' }) });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    const t = P.get('tracker') || {};
    eq('A3 a later deliberate resume still installs over a local pause', t.status, 'running');
    eq('A3 the resume carries its transition stamp', t.stateAt, TRESUME);
  }
  /* A4 — the v411 close law that must SURVIVE: the day closed
     (the pull's own docs carry the completed dispatch), the
     cloud tracker is the idle reset — a running local still
     stands down to idle. A close is not a pause, and this
     guard never touches it. */
  {
    const server = makeServer();
    serverSet(server, 'tracker', { status: 'idle', startTs: 0, elapsed: 0, stateAt: T1600 }, 5000);
    serverSet(server, 'dsp_list', [{ id: 'd1', status: 'completed', scheduledAt: DAY + 'T08:00', date: DAY, jobSite: 'Aecon Trans' }], 5000);
    const meta = { uid: 'u1', globallySynced: true, keys: { tracker: { t: 4000, s: 4000, u: 'u1' }, dsp_list: { t: 4000, s: 4000, u: 'u1' }, sessions: { t: 4000, s: 4000, u: 'u1' } } };
    const P = makeWorld(server, { local: [['tracker', RUNNING], ['sessions', []], ['dsp_list', [{ id: 'd1', status: 'in-progress', scheduledAt: DAY + 'T08:00', date: DAY, jobSite: 'Aecon Trans' }]]], meta: meta });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    eq('A4 a closed day still stands a running local down (v411 untouched)', (P.get('tracker') || {}).status, 'idle');
  }
  /* A5 — the boundary: a paused copy of a DIFFERENT (discarded)
     session is not this guard's business — the v303 refusal
     keeps it out exactly as before. */
  {
    const server = makeServer();
    serverSet(server, 'tracker', { status: 'paused', sessionId: SID_OLD, startTs: 0, elapsed: 76239, stateAt: SID_OLD, startLabelMs: SID_OLD }, 5000);
    const localRunning = Object.assign({}, RUNNING, { discardedSid: SID_OLD });
    const P = makeWorld(server, { local: [['tracker', localRunning]], meta: metaWith({ t: 4000, s: 4000, u: 'u1' }) });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    const t = P.get('tracker') || {};
    eq('A5 a discarded other-session echo is still refused by v303, not by this guard', t.status, 'running');
    eq('A5 the live session identity is untouched', t.sessionId, SID);
  }

  console.log('— B: the reopen road (adoptSessionRecord) —');
  /* B1 — TODAY at the reopen: a fresh page lifetime (tracker
     idle, _lastStateAt reset to 0 — the relaunch shape) meets
     the day's record standing PAUSED with his exact bank —
     and NO deliberate-transition stamp on it (stateAt 0: no
     transition writer ever touched this copy). Pre-fix the
     restore adopts the pause wholesale: he opens the app and
     finds it paused at 07:59:57. Post-fix an unstamped pause
     is no one's tap: the session restores RUNNING, its bank
     preserved whole, its segment re-anchored at the restore
     moment. */
  {
    const bridge = makeBridge();
    bridge.seed({ status: 'paused', elapsedBase: BANK, segStartMs: 0, loads: 4, loadsManual: 0,
      loadsArmed: true, milesM: 183400, stateAt: 0, rev: 7, updatedAt: T1600, src: 'web', sessionKey: 's' + SID });
    const { w } = phonePage(bridge, { status: 'idle', startTs: 0, elapsed: 0 }, 0);
    fakeNow = T1633;
    w.App.collectSessionRecord();
    await pump();
    eq('B1 an unstamped paused record NEVER restores as a pause at reopen', w.App.tracker.status, 'running');
    eq('B1 the banked time is preserved whole', w.App.tracker.elapsed, BANK);
    eq('B1 the segment re-anchors at the restore moment', w.App.tracker.startTs, T1633);
  }
  /* B2 — the keep-green mirror: the record's pause IS stamped,
     and its last writer was the face itself (src 'native',
     stateAt = the tap) — his own bubble/widget pause before
     the app closed. Reopening must show it still paused: his
     tap is the only source, and it is a real one. */
  {
    const bridge = makeBridge();
    bridge.seed({ status: 'paused', elapsedBase: BANK, segStartMs: 0, loads: 4, loadsManual: 0,
      loadsArmed: true, milesM: 183400, stateAt: T1600, rev: 9, updatedAt: T1600, src: 'native', sessionKey: 's' + SID });
    const { w } = phonePage(bridge, { status: 'idle', startTs: 0, elapsed: 0 }, 0);
    fakeNow = T1633;
    w.App.collectSessionRecord();
    await pump();
    eq('B2 his own face-tap pause still restores as paused at reopen', w.App.tracker.status, 'paused');
    eq('B2 the restored pause carries the tap\u2019s bank', w.App.tracker.elapsed, BANK);
  }
  /* B3 — the v365 flip that must SURVIVE: a running page, a
     record toggled paused natively moments ago (src 'native',
     stateAt newer than the page's) — the page adopts his tap. */
  {
    const bridge = makeBridge();
    const T1530 = local(2026, 10, 11, 15, 30, 0);
    bridge.seed({ status: 'paused', elapsedBase: 27000, segStartMs: 0, loads: 2, loadsManual: 0,
      loadsArmed: true, milesM: 150000, stateAt: T1530, rev: 11, updatedAt: T1530, src: 'native', sessionKey: 's' + SID });
    const { w } = phonePage(bridge, { status: 'running', startTs: PIN, elapsed: 1007, sessionId: SID,
      stateAt: PIN, startLabelMs: SID, accum: { manualLoads: 0 } }, PIN);
    fakeNow = T1530 + 5000;
    w.App.collectSessionRecord();
    await pump();
    eq('B3 a native face-tap pause still folds a running page (v365 untouched)', w.App.tracker.status, 'paused');
    eq('B3 the adopted pause carries the tap\u2019s bank', w.App.tracker.elapsed, 27000);
  }
  /* B4 — the arm-seed restore that must SURVIVE: a fresh page
     meets the DayScheduler's seeded RUNNING record for today's
     session and adopts it running. */
  {
    const bridge = makeBridge();
    bridge.seed({ status: 'running', elapsedBase: 0, segStartMs: PIN, loads: 0, loadsManual: 0,
      loadsArmed: false, milesM: -1, stateAt: PIN, rev: 3, updatedAt: PIN, src: 'arm', sessionKey: 's' + SID });
    const { w } = phonePage(bridge, { status: 'idle', startTs: 0, elapsed: 0 }, 0);
    fakeNow = local(2026, 10, 11, 8, 20, 0);
    w.App.collectSessionRecord();
    await pump();
    eq('B4 the arm seed still restores running at reopen', w.App.tracker.status, 'running');
  }

  console.log('— C: source pins —');
  ok('C1 cloudsync refuses a same-session cloud pause over a running local (v423 guard)',
    /lp423Local/.test(csSrc) && /TIMER-PAUSED-ITSELF-NOV11/.test(csSrc));
  ok('C2 the restore adopts a pause only on a deliberate-transition stamp (v423)',
    /TIMER-PAUSED-ITSELF-NOV11/.test(appSrc) && /rec\.stateAt \|\| 0\) > 0/.test(appSrc));
  ok('C3 the v365 deliberate flip stands untouched',
    /recDelib365 = \(rec\.stateAt \|\| 0\) > \(t\.stateAt \|\| 0\) && rec\.src === 'native'/.test(appSrc));
  ok('C4 the v365 cloud rule stands untouched',
    /sa365LocalRunning && !sa365CloudRunning/.test(csSrc));
  ok('C5 the v411 close rule stands untouched',
    /cd411JudgeSid/.test(csSrc) && /function healClosedTracker\(\)/.test(appSrc));

  console.log('— ship pins —');
  eq('webVersion is 423', ver.webVersion, 423);
  const crypto = require('crypto');
  ok('version.json hashes match the shipped files',
    ver.files['js/app.js'] === crypto.createHash('sha256').update(read('js/app.js')).digest('hex') &&
    ver.files['js/cloudsync.js'] === crypto.createHash('sha256').update(read('js/cloudsync.js')).digest('hex'));

  console.log('\ntimer-autopause-v423: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL suite threw: ' + (e && e.stack || e)); process.exit(1); });
