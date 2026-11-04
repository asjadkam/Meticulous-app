#!/usr/bin/env node
/* v323 regression suite — Nov 4, 2026 live-day defects (TIMER-REANCHORED-MIDDAY + LOADS-DOUBLE-COUNTING).
 * Part 1 (TIMER): drives the REAL app.js trackerSave->sessionFacts->
 *   bridge(SessionRecord.java semantics, copied from the v314 rig)
 *   round trip + adoptSessionRecord, replaying Asjad's Nov 4 shape:
 *   session start 09:00, syncs during the day, a NATIVE pause, and
 *   the web adopting it. Question: does the native record's clock
 *   (the widget/PiP face truth) match the web tracker's clock?
 * Part 2 (LOADS): drives the REAL js/geoloads.js glue (v284 rig
 *   pattern) through candidate double-count / miss scenarios at a
 *   pegged pair.
 * Run: node tools/defects-nov4-v323-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const geoSrc = fs.readFileSync(path.join(ROOT, 'js', 'geoloads.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

/* ================= Part 1: the timer round trip ================= */
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

/* The bridge: SessionRecord.java + ShiftTrackPlugin.sessionSync,
   semantics copied from the v314 rig (which mirrors the Java). */
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
    rec: rec, snap: snap,
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
    sessionStopped: function () {},
    /* FaceActions/nativeToggle, SessionRecord.java verbatim shape */
    nativePause: function () {
      if (rec.status !== 'running') return;
      rec.elapsedBase = elapsedSec(fakeNow);
      rec.status = 'paused'; rec.segStartMs = 0; rec.rev += 1; rec.updatedAt = fakeNow; rec.src = 'native';
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
function makeWorld(store, bridge) {
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

const START = msOf('2026-11-04', '09:00:00');

(async function part1() {
  console.log('Part 1 — TIMER: web<->native record round trip (Nov 4 shape)');
  const store = makeStore();
  const bridge = makeBridge();
  const w = makeWorld(store, bridge);
  fakeNow = START;
  w.App.tracker = { status: 'running', startTs: START, elapsed: 0, sessionId: START, accum: { manualLoads: 0 } };
  w.App._sessRev = -1; w.App._lastStateAt = 0; w.App._sessKey = 's' + START;
  bridge.rec.sessionKey = '';

  /* the day runs; the web syncs at 10:00 and 12:00 (trackerSave) */
  fakeNow = msOf('2026-11-04', '10:00:00');
  w.trackerSave(); await pump();
  fakeNow = msOf('2026-11-04', '12:00:00');
  w.trackerSave(); await pump();

  const recAt1200 = bridge.snap();
  console.log('    record at 12:00 after web syncs: elapsedBase=' + recAt1200.elapsedBase +
    ' segStartMs=' + recAt1200.segStartMs + ' elapsedSec=' + recAt1200.elapsedSec +
    ' (true total = 10800)');
  ok('T1 native record clock at 12:00 reads the true 3h00m (10800s)',
    recAt1200.elapsedSec === 10800, 'record reads ' + recAt1200.elapsedSec + 's');

  /* a face tap pauses natively at 12:40 (the video's frozen shape) */
  fakeNow = msOf('2026-11-04', '12:40:38');
  bridge.nativePause();
  const recPaused = bridge.snap();
  console.log('    record after native pause at 12:40:38: elapsedBase=' + recPaused.elapsedBase + ' (true frozen total = 13238)');
  ok('T2 the native pause freezes the TRUE elapsed (13238s = 3:40:38)',
    recPaused.elapsedBase === 13238, 'froze ' + recPaused.elapsedBase + 's');

  /* the web comes to the foreground and adopts the record */
  await w.App.collectSessionRecord(); await pump();
  const t = w.App.tracker;
  console.log('    web tracker after adoption: status=' + t.status + ' elapsed=' + t.elapsed + ' startTs=' + t.startTs);
  ok('T3 web adoption of the pause keeps the true frozen elapsed (13238s)',
    t.status === 'paused' && t.elapsed === 13238, 'web elapsed=' + t.elapsed);

  /* a LEGACY inflated record (written before any fix) must not be
     able to push the day past its own wall-clock age on adoption */
  const store2 = makeStore();
  const bridge2 = makeBridge();
  const w2 = makeWorld(store2, bridge2);
  fakeNow = msOf('2026-11-04', '12:40:38');
  w2.App.tracker = { status: 'running', startTs: START, elapsed: 0, sessionId: START, accum: { manualLoads: 0 } };
  w2.App._sessRev = -1; w2.App._lastStateAt = 0; w2.App._sessKey = 's' + START;
  bridge2.rec.status = 'paused';
  bridge2.rec.elapsedBase = 24000;           // inflated: 6h40m on a 3h40m-old session
  bridge2.rec.segStartMs = 0;
  bridge2.rec.sessionKey = 's' + START;
  bridge2.rec.rev = 7; bridge2.rec.updatedAt = fakeNow; bridge2.rec.src = 'native';
  await w2.App.collectSessionRecord(); await pump();
  const t2 = w2.App.tracker;
  const cap = Math.floor((fakeNow - START) / 1000);
  console.log('    legacy-record adoption: web elapsed=' + t2.elapsed + ' cap=' + cap);
  ok('T4 an impossible record (elapsed > session age) is clamped to the session age on adoption',
    t2.status !== 'paused' || t2.elapsed <= cap, 'web elapsed=' + t2.elapsed + ' > cap ' + cap);

  part2();
})().catch(function (e) { console.log('PART1 ERROR', e && e.stack || e); part2(); });

/* ================= Part 2: the loads scenarios ================= */
function mkSharedStore(data) {
  data = data || {};
  return {
    get: function (k, dflt) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : dflt; },
    set: function (k, v) { data[k] = JSON.parse(JSON.stringify(v)); },
    _data: data
  };
}
function mkGeoWorld(store) {
  const sb = { console: console, Date: RealDate, Math: Math, JSON: JSON };
  sb.window = sb;
  let handler = null;
  sb.LiveMiles = { available: function () { return true; }, subscribe: function (fn) { handler = fn; } };
  sb.App = { _store: store };
  vm.createContext(sb);
  vm.runInContext(geoSrc, sb);
  if (!sb.GeoLoads) throw new Error('GeoLoads not exposed');
  return { GeoLoads: sb.GeoLoads, feed: function (fix) { return handler(fix); } };
}
const GT0 = new RealDate(2026, 10, 4, 6, 0, 0).getTime();
function gdstr(ts) {
  const d = new RealDate(ts);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const GTODAY = gdstr(GT0);
function goff(lat, lng, eM, nM) { return [lat + nM / 111320, lng + eM / (111320 * Math.cos(lat * Math.PI / 180))]; }
function gpt(base, eM, nM) { const ll = goff(base.lat, base.lng, eM, nM); return { lat: ll[0], lng: ll[1] }; }
const GSTILL = [[0, 0], [15, 10], [-12, 8], [10, -14], [-8, -10]];
function mkFeed(world) {
  return function (tS, ll) { return world.feed({ latitude: ll[0], longitude: ll[1], accuracy: 8, time: GT0 + tS * 1000 }); };
}
function park(feed, clock, center, durS, still) {
  const steps = Math.floor(durS / 10);
  const pat = still || GSTILL;
  for (let k = 0; k <= steps; k++) {
    const w = pat[k % pat.length];
    feed(clock.t, goff(center.lat, center.lng, w[0], w[1]));
    clock.t += 10;
  }
}
function drive(feed, clock, A, B, durS) {
  const steps = Math.floor(durS / 10);
  for (let k = 1; k <= steps; k++) {
    const f = k / steps;
    feed(clock.t, [A.lat + (B.lat - A.lat) * f, A.lng + (B.lng - A.lng) * f]);
    clock.t += 10;
  }
}
const GHOME = { lat: 51.15709, lng: -113.93862 };
const GDSP = { id: 'dsp-aecon', jobSite: 'Aecon Inf', dropoff: '', status: 'active', date: GTODAY, scheduledAt: GTODAY + 'T09:00:00' };
function gbaseData() {
  return { nav_data: { personal: [{ name: 'Home', lat: GHOME.lat, lng: GHOME.lng }], work: [], recent: [] },
    dsp_list: [GDSP], dsp_active: GDSP };
}
function seedPair(w, feed, clock, L, D) {
  park(feed, clock, L, 120);
  const rp = w.GeoLoads.setPeg('load');
  drive(feed, clock, L, D, 120);
  park(feed, clock, D, 120);
  const rd = w.GeoLoads.setPeg('dump');
  return rp && rp.ok && rd && rd.ok && rd.armed === true;
}
function oneCycle(w, feed, clock, from, L, D) {
  drive(feed, clock, from, L, 90);
  park(feed, clock, L, 150);
  drive(feed, clock, L, D, 90);
  park(feed, clock, D, 150);
  return D;
}

function part2() {
  console.log('Part 2 — LOADS: peg-pair scenarios (Nov 4 shape)');

  /* S1: close pair (130 m), one real cycle, then the truck waits
     at the saddle between the faces for 10 minutes (queueing),
     GPS wander +-15 m — it carries nothing and never leaves. */
  {
    const store = mkSharedStore(gbaseData());
    const w = mkGeoWorld(store);
    const feed = mkFeed(w); const clock = { t: 0 };
    w.GeoLoads.startDay('s' + GT0, {});
    const L = { lat: 51.122, lng: -114.010 };
    const D = gpt(L, 130, 0);
    ok('S1 seeds arm', seedPair(w, feed, clock, L, D));
    let cur = oneCycle(w, feed, clock, D, L, D);
    const afterCycle = w.GeoLoads.today().count;
    const MID = gpt(L, 65, 0);
    park(feed, clock, MID, 600);
    const afterWait = w.GeoLoads.today().count;
    console.log('    S1 count after 1 real cycle=' + afterCycle + ', after 10 min saddle wait=' + afterWait);
    ok('S1 one real cycle counts exactly 1', afterCycle === 1, 'got ' + afterCycle);
    ok('S1 a 10-minute wait at the saddle counts NOTHING more', afterWait === 1, 'got ' + afterWait);
  }

  /* S2: after the real cycle's tip, the truck pulls forward
     30 m (still well inside the dump fence), waits, then drives
     BACK to the load face empty (repositioning), waits there,
     then returns to the dump EMPTY and waits again (site shuffle).
     No load is ever picked up. */
  {
    const store = mkSharedStore(gbaseData());
    const w = mkGeoWorld(store);
    const feed = mkFeed(w); const clock = { t: 0 };
    w.GeoLoads.startDay('s' + GT0, {});
    const L = { lat: 51.122, lng: -114.010 };
    const D = gpt(L, 130, 0);
    seedPair(w, feed, clock, L, D);
    let cur = oneCycle(w, feed, clock, D, L, D);
    const Dfwd = gpt(D, 30, 0);
    drive(feed, clock, cur, Dfwd, 30); park(feed, clock, Dfwd, 120);
    drive(feed, clock, Dfwd, L, 90); park(feed, clock, L, 150);
    drive(feed, clock, L, D, 90); park(feed, clock, D, 150);
    const c = w.GeoLoads.today().count;
    console.log('    S2 count after empty shuffle=' + c);
    /* DOCUMENTED LIMIT (not gated): an empty truck that parks a
       full dwell AT the load face and then at the dump face is
       movement-identical to a real cycle — no GPS counter can
       tell it apart, and gating it would break real cycles under
       the owner's generous-fence law. Recorded here so the
       behaviour is known, not hidden. */
    ok('S2 documented limit: a full empty cycle-shape counts as a cycle (GPS-indistinguishable)', c === 2, 'got ' + c);
  }

  /* S3: the morning miss — cycle 2 LOADS 95 m from the load peg
     centre (outside the 70 m fence; the pile face moved), tips at
     the dump peg. The load centre has no recovery of its own. */
  {
    const store = mkSharedStore(gbaseData());
    const w = mkGeoWorld(store);
    const feed = mkFeed(w); const clock = { t: 0 };
    w.GeoLoads.startDay('s' + GT0, {});
    const L = { lat: 51.122, lng: -114.010 };
    const D = gpt(L, 400, 0);
    seedPair(w, feed, clock, L, D);
    let cur = oneCycle(w, feed, clock, D, L, D);
    const c1 = w.GeoLoads.today().count;
    const L2 = gpt(L, 0, 95);
    drive(feed, clock, cur, L2, 90); park(feed, clock, L2, 240);
    drive(feed, clock, L2, D, 120); park(feed, clock, D, 150);
    const c2 = w.GeoLoads.today().count;
    console.log('    S3 count cycle1=' + c1 + ', after loading 95 m off the load peg=' + c2);
    ok('S3 cycle 1 counts', c1 === 1, 'got ' + c1);
    ok('S3 a load picked up 95 m from the load peg still counts its cycle', c2 === 2, 'got ' + c2);
  }


  /* S5: queue creep at the saddle after a counted cycle — the
     truck waits in a queue that creeps toward the dump face in
     steps, parks 50 s at each step. It carries nothing. */
  {
    const store = mkSharedStore(gbaseData());
    const w = mkGeoWorld(store);
    const feed = mkFeed(w); const clock = { t: 0 };
    w.GeoLoads.startDay('s' + GT0, {});
    const L = { lat: 51.122, lng: -114.010 };
    const D = gpt(L, 130, 0);
    seedPair(w, feed, clock, L, D);
    let cur = oneCycle(w, feed, clock, D, L, D);
    const c1 = w.GeoLoads.today().count;
    /* queue: start 25 m load-side of midpoint, creep +12 m / 50 s */
    let q = gpt(L, 40, 0);
    drive(feed, clock, cur, q, 40);
    for (let k = 0; k < 5; k++) { park(feed, clock, q, 50); q = gpt(q, 12, 0); drive(feed, clock, gpt(q, -12, 0), q, 15); }
    park(feed, clock, q, 120);
    const c2 = w.GeoLoads.today().count;
    console.log('    S5 count after cycle=' + c1 + ', after queue creep=' + c2);
    /* DOCUMENTED LIMIT (not gated): a queue that creeps across a
       close pair, parking a full dwell on the load side of the
       overlap and then on the dump side, is movement-shaped like
       a slow cycle. Tightening the arm fence to block it would
       contradict the owner's generous-fence law and re-break
       real pickups at wandering faces. Recorded, not hidden. */
    ok('S5 documented limit: a full-dwell queue creep across a close pair counts as a cycle', c2 === 2, 'got ' + c2);
  }

  /* S6: the hand-tap race (v323 guard) — the machine has ARMED
     the cycle; at the dump the tip dwell is fragmented
     (repositioning), the number has not moved, the driver taps
     +1 by hand; THEN the machine's dwell finally confirms the
     same tip. One physical load must read 1, not 2. */
  {
    const store = mkSharedStore(gbaseData());
    const w = mkGeoWorld(store);
    const feed = mkFeed(w); const clock = { t: 0 };
    w.GeoLoads.startDay('s' + GT0, {});
    const L = { lat: 51.122, lng: -114.010 };
    const D = gpt(L, 400, 0);
    seedPair(w, feed, clock, L, D);
    drive(feed, clock, D, L, 90); park(feed, clock, L, 150);   // armed
    drive(feed, clock, L, D, 90);
    park(feed, clock, D, 5);                                   // too short to confirm
    const Dout = gpt(D, 0, 260);
    drive(feed, clock, D, Dout, 20); park(feed, clock, Dout, 70); // hop well out, candidate dies
    drive(feed, clock, Dout, D, 20);
    const beforeTap = w.GeoLoads.today().count;
    w.GeoLoads.nudge(1);                                       // his hand +1 at the tip
    const afterTap = w.GeoLoads.today().count;
    park(feed, clock, D, 180);                                 // the machine confirms now
    const afterMachine = w.GeoLoads.today().count;
    console.log('    S6 before tap=' + beforeTap + ', after tap=' + afterTap + ', after machine confirm=' + afterMachine);
    ok('S6 the fragmented tip has NOT counted before the tap', beforeTap === 0, 'got ' + beforeTap);
    ok('S6 hand +1 at the tip shows the load', afterTap === 1, 'got ' + afterTap);
    ok('S6 the machine confirming the SAME tip adds NOTHING (one load = one count)', afterMachine === 1, 'got ' + afterMachine);
  }

  /* S6b: his morning shape — the tip lands 250 m from the dump
     centre (outside fence AND recovery band): a true machine
     miss. His +1 there is a pure correction (too far from the
     dump centre to mark a carry) and must STAND alongside the
     next cycle's machine count. */
  {
    const store = mkSharedStore(gbaseData());
    const w = mkGeoWorld(store);
    const feed = mkFeed(w); const clock = { t: 0 };
    w.GeoLoads.startDay('s' + GT0, {});
    const L = { lat: 51.122, lng: -114.010 };
    const D = gpt(L, 400, 0);
    seedPair(w, feed, clock, L, D);
    drive(feed, clock, D, L, 90); park(feed, clock, L, 150);
    const Dfar = gpt(D, 0, 250);
    drive(feed, clock, L, Dfar, 120); park(feed, clock, Dfar, 150);  // missed tip
    const afterMiss = w.GeoLoads.today().count;
    w.GeoLoads.nudge(1);
    const afterTap = w.GeoLoads.today().count;
    drive(feed, clock, Dfar, L, 120); park(feed, clock, L, 150);     // cycle 2 loads
    drive(feed, clock, L, D, 90); park(feed, clock, D, 150);         // cycle 2 tips, machine counts
    const final = w.GeoLoads.today().count;
    console.log('    S6b after missed tip=' + afterMiss + ', after tap=' + afterTap + ', final=' + final);
    ok('S6b the far tip is a machine miss', afterMiss === 0, 'got ' + afterMiss);
    ok('S6b his +1 stands for the missed load', afterTap === 1, 'got ' + afterTap);
    ok('S6b the next machine count ADDS (no undercount)', final === 2, 'got ' + final);
  }

  /* S6c: tap at the real tip (carry marked), but the machine
     never confirms that stop — the truck returns to the load
     face (mark clears, tap stands), loads, tips again, and the
     machine counts that one. Total must be 2. */
  {
    const store = mkSharedStore(gbaseData());
    const w = mkGeoWorld(store);
    const feed = mkFeed(w); const clock = { t: 0 };
    w.GeoLoads.startDay('s' + GT0, {});
    const L = { lat: 51.122, lng: -114.010 };
    const D = gpt(L, 400, 0);
    seedPair(w, feed, clock, L, D);
    drive(feed, clock, D, L, 90); park(feed, clock, L, 150);
    drive(feed, clock, L, D, 90);
    park(feed, clock, D, 10);
    w.GeoLoads.nudge(1);                                       // tap at the tip
    const afterTap = w.GeoLoads.today().count;
    drive(feed, clock, D, L, 90); park(feed, clock, L, 150);   // back to the pile: mark clears
    drive(feed, clock, L, D, 90); park(feed, clock, D, 180);   // real tip, machine counts
    const final = w.GeoLoads.today().count;
    console.log('    S6c after tap=' + afterTap + ', final=' + final);
    ok('S6c tap at the tip shows the load', afterTap === 1, 'got ' + afterTap);
    ok('S6c a LATER machine count still adds (the tap stood for the missed stop)', final === 2, 'got ' + final);
  }

  /* S4: sanity — two plain cycles at a 400 m pair still count 2 */
  {
    const store = mkSharedStore(gbaseData());
    const w = mkGeoWorld(store);
    const feed = mkFeed(w); const clock = { t: 0 };
    w.GeoLoads.startDay('s' + GT0, {});
    const L = { lat: 51.122, lng: -114.010 };
    const D = gpt(L, 400, 0);
    seedPair(w, feed, clock, L, D);
    let cur = oneCycle(w, feed, clock, D, L, D);
    cur = oneCycle(w, feed, clock, cur, L, D);
    const c = w.GeoLoads.today().count;
    ok('S4 two plain cycles count 2', c === 2, 'got ' + c);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
