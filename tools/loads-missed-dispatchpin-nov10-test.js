#!/usr/bin/env node
/* LOADS-MISSED — ROUND 3 (Nov 10, 2026): web 393 in the owner's
 * hands. A DISPATCH-PIN day (no mid-day re-peg; the pickup pegged
 * once in the morning, the dump taken from the dispatch's own
 * pin). Loads #1 and #2 counted by themselves; load #3 did not —
 * dashboard at 10:50 his clock: "Loads today: 2 counted by GPS",
 * his words: "It missed a load." His Advanced card at 09:53 read
 * the machine clean: Mode "site pins on the dispatch", counter
 * phase away, its own count 1 (the day total 2 — the morning's
 * first count rides the base after the day's relaunches), last
 * fix accuracy 4 m. So the loop had closed after #2 and the
 * machine stood ready; the third VISIT itself produced nothing.
 *
 * CONVICTION (code, on live web 404 bytes — the crumb trail
 * itself sits behind the account's own Firestore auth and is
 * not readable from the build bench; the conviction is proven
 * against the machine that actually ran that day):
 * configure() arms a both-pins dispatch day with the DUMP-VISIT
 * counter (v324 — js/geoloads.js createDumpVisitCounter). The
 * round-2 fix (v393 VISIT SHADOW) was wired ONLY into the peg
 * cycle counter (createPegCounter's inner createGeoLoadCounter
 * cfg.visitShadow) — the machine that runs dispatch-pin days
 * never got it, and it carries two arrival fragilities of its
 * own, both reproduced below on live bytes with the day's own
 * geometry (load peg 51.12442,-113.98356; dump pin
 * 51.12251,-114.01222; sites ~2.0 km apart):
 *   (W)  Presence is judged only within 250 m of the pin POINT
 *        (VISIT_PRESENCE_M), and the one door that can adopt a
 *        moved work face — the virgin-face PENDING branch — is
 *        gated to stops MORE than 500 m from the pin
 *        (VISIT_FACE_MIN_M). A tip face in between (the normal
 *        case of a face that moved a few hundred metres inside
 *        a big pit; the owner's own v284 law: the spots MOVE
 *        around the site load to load) is witnessed by the
 *        stop-cluster and deliberately ignored by every branch:
 *        no presence, no face adoption, no count — silently.
 *   (W2) The arrival candidate dies on any witnessed absence
 *        chunk > 25 s (candStep grace), with no wider recovery
 *        reach: a tip whose witnessed presence fragments across
 *        the 250 m line — queue creep at the face, fixes spaced
 *        by a throttled stream — restarts the 45 s bar forever
 *        (round 2's exact disease, unfixed on this machine).
 * Tips #1/#2 counted because their faces sat on the pin with
 * clean presence; #3 needed neither luck nor a different day —
 * only one of the two shapes above.
 *
 * FIX (js/geoloads.js, createDumpVisitCounter only):
 *   (1) The VISIT SHADOW, ported to this machine in its own
 *       discipline: while a visit stands open and the day's
 *       loop has demonstrably moved (a counted close, a dump
 *       presence, or a witnessed load-end dwell — the same
 *       evidence the face-learning branches trust), presence
 *       within VISIT_SHADOW_M (presence + 200 m) of a site
 *       point and beyond that reach of the other end accumulates
 *       toward the same 45 s arrival bar — under a stop-cluster
 *       discipline (the accumulation holds only while fixes
 *       stay within VISIT_CLUSTER_M of its running centroid, so
 *       a drive-through's marching fixes can never build it).
 *       Whichever candidate confirms first lands the arrival
 *       through the one landing path — a visit can never count
 *       twice.
 *   (2) A TIP-GRADE stop on the site's own ground counts: the
 *       cluster decision gains a branch for a stop of a tip's
 *       length (LEARN_DWELL_MS) in the dead band (presence,
 *       VISIT_FACE_MIN_M] with the same loop-moved gate — the
 *       face is adopted as a site point and the visit counts
 *       during the tip, not at some later close. Stops beyond
 *       VISIT_FACE_MIN_M keep the v324 pending rail exactly as
 *       before (G5).
 *
 * Run: node tools/loads-missed-dispatchpin-nov10-test.js
 * On live web 404 bytes this suite FAILS at W3/W4 and W2
 * (expected — the failing-first proof). On the fix: all pass.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const geoSrc = fs.readFileSync(path.join(ROOT, 'js', 'geoloads.js'), 'utf8');

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}

const RealDate = Date;
function mkSharedStore(data) {
  data = data || {};
  return {
    get: function (k, dflt) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : dflt; },
    set: function (k, v) { data[k] = JSON.parse(JSON.stringify(v)); },
    _data: data
  };
}
function mkGeoWorld(store, src) {
  const sb = { console: console, Date: RealDate, Math: Math, JSON: JSON };
  sb.window = sb;
  let handler = null;
  sb.LiveMiles = { available: function () { return true; }, subscribe: function (fn) { handler = fn; } };
  sb.App = { _store: store };
  vm.createContext(sb);
  vm.runInContext(src, sb);
  if (!sb.GeoLoads) throw new Error('GeoLoads not exposed');
  return { GeoLoads: sb.GeoLoads, feed: function (fix) { return handler(fix); } };
}
const NOW = new RealDate();
const T0 = new RealDate(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 6, 0, 0).getTime();
function gdstr(ts) {
  const d = new RealDate(ts);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const TODAY = gdstr(T0);
const STILL = [[0, 0], [15, 10], [-12, 8], [10, -14], [-8, -10]];
function goff(lat, lng, eM, nM) { return [lat + nM / 111320, lng + eM / (111320 * Math.cos(lat * Math.PI / 180))]; }
function havM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
function mkFeed(world) {
  return function (tS, ll) { return world.feed({ latitude: ll[0], longitude: ll[1], accuracy: 8, time: T0 + tS * 1000 }); };
}
function park(feed, clock, center, durS) {
  const steps = Math.floor(durS / 10);
  for (let k = 0; k <= steps; k++) {
    const w = STILL[k % STILL.length];
    feed(clock.t, goff(center.lat, center.lng, w[0], w[1]));
    clock.t += 10;
  }
}
function driveTo(feed, clock, pos, dest, durS) {
  const A = { lat: pos.lat, lng: pos.lng };
  const steps = Math.max(1, Math.floor(durS / 10));
  for (let k = 1; k <= steps; k++) {
    const f = k / steps;
    feed(clock.t, [A.lat + (dest.lat - A.lat) * f, A.lng + (dest.lng - A.lng) * f]);
    clock.t += 10;
  }
  pos.lat = dest.lat; pos.lng = dest.lng;
}

/* Nov 10's own geometry (the Advanced card's Sites line + the
   dispatch record): the dump is the dispatch's pin; the load
   end is his morning pickup peg, planted where he loads. */
const HOME = { lat: 51.15709, lng: -113.93862 };
const DSP_LOADPIN = { lat: 51.1252222, lng: -113.9828056 };
const DUMP = { lat: 51.1225089, lng: -114.0122197 };
const LOADFACE = { lat: 51.12442, lng: -113.98356 };
const FACE_A = (function () { const p = goff(DUMP.lat, DUMP.lng, 25, 15); return { lat: p[0], lng: p[1] }; })();
const FACE_B = (function () { const p = goff(DUMP.lat, DUMP.lng, 330, 120); return { lat: p[0], lng: p[1] }; })();
const FACE_C = (function () { const p = goff(DUMP.lat, DUMP.lng, -450, 400); return { lat: p[0], lng: p[1] }; })();
/* the creep spots sit on the LOAD side (east) of the pin, so
   the drive in and out never crosses the pin's own circle —
   the only presence the tip gets is the creep itself. */
const CREEP_IN = (function () { const p = goff(DUMP.lat, DUMP.lng, 230, 0); return { lat: p[0], lng: p[1] }; })();
const CREEP_OUT = (function () { const p = goff(DUMP.lat, DUMP.lng, 290, 0); return { lat: p[0], lng: p[1] }; })();

function baseData() {
  const dsp = { id: 'dsp-nov10', jobSite: 'Aecon Trans', dropoff: '', status: 'active',
    date: TODAY, scheduledAt: TODAY + 'T08:30:00',
    lat: DSP_LOADPIN.lat, lng: DSP_LOADPIN.lng, dumpLat: DUMP.lat, dumpLng: DUMP.lng };
  return { nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] },
    dsp_list: [dsp], dsp_active: dsp };
}
function mach(w) { return w.GeoLoads.status().count; }

/* the day's prologue: from home to the load site, the morning's
   one manual act — PEG PICKUP where he loads (the peg outranks
   the dispatch's load pin; the dump stays the dispatch's pin). */
function prologue(w, feed, clock, pos) {
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, HOME, 60);
  driveTo(feed, clock, pos, LOADFACE, 300);
  park(feed, clock, LOADFACE, 120);
  w.GeoLoads.setPeg('load');
  park(feed, clock, LOADFACE, 60);
}
function loop(feed, clock, pos, face, tipS) {
  driveTo(feed, clock, pos, face, 240);
  park(feed, clock, face, tipS);
  const atTip = pos; // pos now == face
  return atTip;
}
function loopBack(feed, clock, pos) {
  driveTo(feed, clock, pos, LOADFACE, 240);
  park(feed, clock, LOADFACE, 240);
}

console.log('geometry — the day\'s own distances');
ok(havM(FACE_A, DUMP) <= 250, 'FACE_A (tips 1, 2, 4) sits within presence of the dump pin — ' + Math.round(havM(FACE_A, DUMP)) + ' m');
ok(havM(FACE_B, DUMP) > 250 && havM(FACE_B, DUMP) <= 500, 'FACE_B (tip 3) sits in the dead band (250, 500] — ' + Math.round(havM(FACE_B, DUMP)) + ' m');
ok(havM(FACE_C, DUMP) > 500 && havM(FACE_C, DUMP) <= 3500, 'FACE_C sits on the pending rail (500, 3500] — ' + Math.round(havM(FACE_C, DUMP)) + ' m');
ok(havM(CREEP_IN, DUMP) <= 250 && havM(CREEP_OUT, DUMP) > 250 && havM(CREEP_OUT, DUMP) <= 450,
  'creep straddles the presence line inside the recovery reach — in ' + Math.round(havM(CREEP_IN, DUMP)) + ' m, out ' + Math.round(havM(CREEP_OUT, DUMP)) + ' m');
ok(havM(LOADFACE, DUMP) > 1500, 'the two ends are ~2 km apart — ' + Math.round(havM(LOADFACE, DUMP)) + ' m');

/* ---------- W: the Nov 10 day ---------- */
console.log('W — three tips at the dispatch-pin dump, the third at a moved face');
(function () {
  const store = mkSharedStore(baseData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  prologue(w, feed, clock, pos);
  const st = w.GeoLoads.status();
  ok(st.mode === 'armed' && st.counter && st.counter.mode === 'dump-visit',
    'W0 the day arms the DUMP-VISIT counter (mode=' + st.mode + ', counter=' + (st.counter && st.counter.mode) + ')');
  ok(st.sites && Math.abs(st.sites.dump.lat - DUMP.lat) < 0.001 && Math.abs(st.sites.load.lat - LOADFACE.lat) < 0.001,
    'W0b the counter\'s sites are the day\'s own: dump = dispatch pin, load = the morning peg');
  loop(feed, clock, pos, FACE_A, 300);
  ok(mach(w) === 1, 'W1 tip #1 at the pin face counts — got ' + mach(w));
  loopBack(feed, clock, pos);
  ok(mach(w) === 1, 'W1b the load-end dwell itself counts nothing — got ' + mach(w));
  loop(feed, clock, pos, FACE_A, 300);
  ok(mach(w) === 2, 'W2 tip #2 counts — got ' + mach(w));
  loopBack(feed, clock, pos);
  loop(feed, clock, pos, FACE_B, 300);
  ok(mach(w) === 3, 'W3 tip #3 at the moved face (dead band) COUNTS — got ' + mach(w) + ' (on live 404 this FAILS: the #3 miss)');
  park(feed, clock, FACE_B, 180);
  ok(mach(w) === 3, 'W3b the same visit never counts twice — got ' + mach(w));
  loopBack(feed, clock, pos);
  ok(mach(w) === 3, 'W3c the closing load dwell adds nothing — got ' + mach(w));
  loop(feed, clock, pos, FACE_A, 300);
  ok(mach(w) === 4, 'W4 tip #4 counts: the day is not left one behind — got ' + mach(w));
  ok(w.GeoLoads.today().count === mach(w), 'W5 the day record agrees with the machine — today=' + w.GeoLoads.today().count);
})();

/* ---------- W2: the fragmented tip ---------- */
console.log('W2 — tip #2 witnessed in fragments across the presence line');
(function () {
  const store = mkSharedStore(baseData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  prologue(w, feed, clock, pos);
  loop(feed, clock, pos, FACE_A, 300);
  ok(mach(w) === 1, 'W2-1 the clean first tip counts — got ' + mach(w));
  loopBack(feed, clock, pos);
  driveTo(feed, clock, pos, CREEP_IN, 240);
  /* queue creep at the face, throttled stream: presence fixes
     in short runs, absence chunks spaced past the 25 s grace —
     the arrival candidate dies twice on live bytes. */
  const creep = [[0, CREEP_IN], [10, CREEP_IN], [20, CREEP_IN],
    [50, CREEP_OUT], [80, CREEP_OUT],
    [110, CREEP_IN], [120, CREEP_IN], [130, CREEP_IN],
    [160, CREEP_OUT], [190, CREEP_OUT]];
  const c0 = clock.t;
  for (let i = 0; i < creep.length; i++) {
    feed(c0 + creep[i][0], [creep[i][1].lat, creep[i][1].lng]);
  }
  clock.t = c0 + 200;
  pos.lat = CREEP_OUT.lat; pos.lng = CREEP_OUT.lng;
  ok(mach(w) === 2, 'W2-2 the fragmented tip COUNTS — got ' + mach(w) + ' (on live 404 this FAILS)');
  loopBack(feed, clock, pos);
  ok(mach(w) === 2, 'W2-3 the close adds nothing — got ' + mach(w));
})();

/* ---------- G1: drive-throughs ---------- */
console.log('G1 — passes count nothing');
(function () {
  const store = mkSharedStore(baseData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  prologue(w, feed, clock, pos);
  loop(feed, clock, pos, FACE_A, 300);
  loopBack(feed, clock, pos);
  ok(mach(w) === 1, 'G1 setup: one counted loop — got ' + mach(w));
  const OFF = (function () { const p = goff(DUMP.lat, DUMP.lng, 0, 350); return { lat: p[0], lng: p[1] }; })();
  driveTo(feed, clock, pos, OFF, 120);
  driveTo(feed, clock, pos, LOADFACE, 120);
  ok(mach(w) === 1, 'G1a a pass 350 m from the pin at road pace counts nothing — got ' + mach(w));
  const BEYOND = (function () { const p = goff(DUMP.lat, DUMP.lng, -800, 0); return { lat: p[0], lng: p[1] }; })();
  driveTo(feed, clock, pos, BEYOND, 120);
  driveTo(feed, clock, pos, LOADFACE, 120);
  ok(mach(w) === 1, 'G1b a fast pass straight over the pin counts nothing — got ' + mach(w));
})();

/* ---------- G2: a stop near the pit before the loop has moved ---------- */
console.log('G2 — the morning park near the pit is not a load');
(function () {
  const store = mkSharedStore(baseData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: FACE_B.lat, lng: FACE_B.lng };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, FACE_B, 180);
  ok(mach(w) === 0, 'G2 three minutes at the moved face BEFORE any loop counts nothing — got ' + mach(w));
  driveTo(feed, clock, pos, LOADFACE, 240);
  park(feed, clock, LOADFACE, 240);
  driveTo(feed, clock, pos, FACE_A, 240);
  park(feed, clock, FACE_A, 300);
  ok(mach(w) === 1, 'G2b the day\'s real first tip still counts — got ' + mach(w));
})();

/* ---------- G5: the pending rail beyond 500 m is unchanged ---------- */
console.log('G5 — a tip face beyond 500 m still lands at the loop\'s close');
(function () {
  const store = mkSharedStore(baseData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  prologue(w, feed, clock, pos);
  loop(feed, clock, pos, FACE_A, 300);
  loopBack(feed, clock, pos);
  ok(mach(w) === 1, 'G5 setup: one counted loop — got ' + mach(w));
  loop(feed, clock, pos, FACE_C, 300);
  ok(mach(w) === 1, 'G5a the far-face tip does NOT count during the tip (pending rail) — got ' + mach(w));
  loopBack(feed, clock, pos);
  ok(mach(w) === 2, 'G5b it lands when the loop closes at the load end — got ' + mach(w));
})();

console.log('\n' + passed + ' passed / ' + failed + ' failed');
process.exit(failed ? 1 : 0);
