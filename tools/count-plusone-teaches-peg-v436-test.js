#!/usr/bin/env node
/* COUNT-PLUSONE-TEACHES-PEG (Nov 12, 2026): the owner's order,
 * in his words on the Nov 12 drive: the load he was just on did
 * NOT count; counting has to be dynamic — when he taps +1
 * manually it should change the peg slightly, because that
 * morning the job site moved his dump spot a few metres and the
 * machine missed the count, so he +1'd it by hand.
 *
 * THE GAP (proven in the shipped code, web 435): counted events
 * teach the site — the visit counter adopts proven faces as
 * points, the peg counter drifts its centres on counted events
 * (onEvent / DRIFT_STEP_M), fence-recovery walks a centre toward
 * a witnessed missed face — but a MANUAL +1 moved only the
 * day's signed correction (GeoLoads.nudge). The tap, the one
 * signal that is ground truth by definition ("I tipped HERE"),
 * taught the site nothing, so the next tip at the moved face
 * missed the same way and he tapped again.
 *
 * THE FIX (js/geoloads.js + one guarded call in js/app.js):
 *   - The visit counter and the peg counter gain teachTip():
 *     a +1 at the tip, taken from the counter's own last fix
 *     (held to the peg-planting 50 m accuracy bar), teaches the
 *     site under the machines' own disciplines — bounded nudge
 *     of the nearest point / bounded drift of the centre inside
 *     cluster distance; a driver-proven face point further out,
 *     out to the site's chain reach; NOTHING within the shadow
 *     reach of the other end (load ground is never taught as
 *     dump ground); NOTHING across town.
 *   - nudge(+1) runs the lesson and, when it lands on the
 *     site's ground with the visit still open, marks the visit
 *     hand-counted against the TAUGHT ground (the v324 mark,
 *     extended). The visit counter's ingest now reports
 *     closedVisit (the other-end dwell confirmed), and feedFix
 *     clears the mark on it — the v323 S6c discipline on this
 *     machine — so a tap whose visit closed uncounted STANDS,
 *     and only the machine confirming the SAME tip retires it.
 *   - A +1 in teach mode (no counter yet, the dump given out
 *     loud and never pinned) seeds the day's dump at the
 *     truck's position via GeoLoads.teachTap() — the navigated
 *     adoption's standard — beginning present with the visit
 *     counted-in-state, so that tip can never count twice.
 * The tap's count is the correction in every path — the
 * GPS-counted vs tap-counted split on the card stays honest:
 * the taught load reads as his tap forever; the NEXT load at
 * the taught spot is the one GPS counts by itself.
 *
 * Scenarios replay the day at the glue level (the harness of
 * tools/loads-missed-dispatchpin-nov10-test.js, same geometry —
 * it is also the Nov 12 Aecon pair):
 *   A  his morning: a tip at a moved face is missed; one +1
 *      teaches the face; the next tip there counts by GPS; the
 *      taught load stays on the tap side of the split.
 *   A2 the few-metres case: a +1 near the pin nudges the seed
 *      point toward the real tip spot by the bounded step.
 *   B  tips at the original spot keep counting; a +1 tapped at
 *      the LOAD end teaches nothing and stands as a correction.
 *   C  a mid-day re-peg never resets the count; the taught
 *      spot survives a relaunch and counts the next tip there.
 *   D  a +1 tapped at home counts the load and teaches nothing.
 *   E  teach mode: a +1 seeds the dump; that tip never double-
 *      counts; the next visit there counts by GPS. A rough fix
 *      seeds nothing.
 *   F  a both-pegs day: the +1 drifts the dump centre toward
 *      the real face by one bounded step; one load reads once.
 *
 * Run: node tools/count-plusone-teaches-peg-v436-test.js
 * On web 435 bytes A/A2/C/D/E/F fail at the teach assertions
 * (the tap taught nothing); on the fix all pass.
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
function mkFeed(world, acc) {
  return function (tS, ll) { return world.feed({ latitude: ll[0], longitude: ll[1], accuracy: acc || 8, time: T0 + tS * 1000 }); };
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

/* the Nov 12 day's own geometry (the Aecon dispatch): the load
   pin is the Go Empty point, the dump pin the Hauling To point,
   ~2.9 km apart; his pickup face sits by the load pin. */
const HOME = { lat: 51.15709, lng: -113.93862 };
const DSP_LOADPIN = { lat: 51.1252222, lng: -113.9828056 };
const DUMP = { lat: 51.1225089, lng: -114.0122197 };
const LOADFACE = { lat: 51.12442, lng: -113.98356 };
const FACE_A = (function () { const p = goff(DUMP.lat, DUMP.lng, 25, 15); return { lat: p[0], lng: p[1] }; })();
/* the moved face: ~300 m south of the pin — outside presence
   (250 m), inside the recovery reach (450 m) */
const M1 = (function () { const p = goff(DUMP.lat, DUMP.lng, 0, -300); return { lat: p[0], lng: p[1] }; })();
const M2 = (function () { const p = goff(DUMP.lat, DUMP.lng, 150, -300); return { lat: p[0], lng: p[1] }; })();
/* the few-metres face: 40 m from the pin */
const FACE_40 = (function () { const p = goff(DUMP.lat, DUMP.lng, 40, 0); return { lat: p[0], lng: p[1] }; })();
/* a face 120 m north of the peg face, for the peg day */
const FACE_F = (function () { const p = goff(FACE_A.lat, FACE_A.lng, 0, 120); return { lat: p[0], lng: p[1] }; })();

function baseData() {
  const dsp = { id: 'dsp-nov12', jobSite: 'Aecon Trans', dropoff: '', status: 'active',
    date: TODAY, scheduledAt: TODAY + 'T09:00:00',
    lat: DSP_LOADPIN.lat, lng: DSP_LOADPIN.lng, dumpLat: DUMP.lat, dumpLng: DUMP.lng };
  return { nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] },
    dsp_list: [dsp], dsp_active: dsp };
}
function teachData() {
  const dsp = { id: 'dsp-nov12-teach', jobSite: 'Aecon Trans', dropoff: '', status: 'active',
    date: TODAY, scheduledAt: TODAY + 'T09:00:00',
    lat: DSP_LOADPIN.lat, lng: DSP_LOADPIN.lng };
  return { nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] },
    dsp_list: [dsp], dsp_active: dsp };
}
function mach(w) { return w.GeoLoads.status().count; }
function dayRec(store) {
  const d = store._data['geoloads'];
  return d && d.days ? d.days[TODAY] : null;
}
function dayPoints(store) {
  const r = dayRec(store);
  return (r && r.state && Array.isArray(r.state.points)) ? r.state.points : [];
}
function nearPoint(pts, p) {
  let best = Infinity;
  pts.forEach(function (q) { const d = havM(q, p); if (d < best) best = d; });
  return best;
}

/* the day's prologue (the Nov 10 suite's shape): home to the
   load face, PEG PICKUP there; the dump stays the dispatch pin. */
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
}
function loopBack(feed, clock, pos) {
  driveTo(feed, clock, pos, LOADFACE, 240);
  park(feed, clock, LOADFACE, 240);
}
/* the moved-face tip the machine misses: the truck works back
   and forth across the face while it tips — two spots 150 m
   apart, both ~300 m from the pin. No stop-cluster can age
   (each jump restarts it), no presence builds (both spots sit
   outside the 250 m circle), the shadow's stillness discipline
   restarts at every jump. Four minutes of it: nothing counts. */
function creepTip(feed, clock, pos) {
  for (let k = 0; k < 12; k++) {
    feed(clock.t, [M1.lat, M1.lng]); clock.t += 10;
    feed(clock.t, [M2.lat, M2.lng]); clock.t += 10;
  }
  park(feed, clock, M2, 30); /* settle on M2: the tap's fix is here */
  pos.lat = M2.lat; pos.lng = M2.lng;
}

console.log('geometry — the day\'s own distances');
ok(havM(M1, DUMP) > 250 && havM(M1, DUMP) <= 450 && havM(M2, DUMP) > 250 && havM(M2, DUMP) <= 450,
  'the moved faces sit outside presence, inside the recovery reach — M1 ' + Math.round(havM(M1, DUMP)) + ' m, M2 ' + Math.round(havM(M2, DUMP)) + ' m');
ok(Math.abs(havM(M1, M2) - 150) < 5, 'the creep spots are 150 m apart — ' + Math.round(havM(M1, M2)) + ' m');
ok(Math.abs(havM(FACE_40, DUMP) - 40) < 3, 'the few-metres face is 40 m off the pin — ' + Math.round(havM(FACE_40, DUMP)) + ' m');
ok(havM(HOME, DUMP) > 4000, 'home is kilometres from the dump — ' + Math.round(havM(HOME, DUMP)) + ' m');

/* ---------- A: his morning ---------- */
console.log('A — a missed tip at the moved face, one +1, the next tip counts by GPS');
(function () {
  const store = mkSharedStore(baseData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  prologue(w, feed, clock, pos);
  loop(feed, clock, pos, FACE_A, 300);
  ok(mach(w) === 1, 'A1 the first tip at the pin face counts by GPS — got ' + mach(w));
  loopBack(feed, clock, pos);
  driveTo(feed, clock, pos, M1, 240);
  creepTip(feed, clock, pos);
  ok(mach(w) === 1, 'A2 the tip at the moved face is MISSED by the machine — got ' + mach(w));
  ok(w.GeoLoads.today().count === 1, 'A2b the card shows the miss — today=' + w.GeoLoads.today().count);
  w.GeoLoads.nudge(1); /* his +1, tapped at the moved face */
  ok(w.GeoLoads.today().count === 2, 'A3 his +1 shows the load at once — today=' + w.GeoLoads.today().count);
  ok(w.GeoLoads.today().corr === 1, 'A3b the taught load reads as HIS tap, not as GPS — corr=' + w.GeoLoads.today().corr);
  ok(nearPoint(dayPoints(store), M2) <= 25, 'A4 the tap TAUGHT the face: a site point now sits at the moved spot — nearest ' + Math.round(nearPoint(dayPoints(store), M2)) + ' m');
  loopBack(feed, clock, pos);
  ok(w.GeoLoads.today().count === 2, 'A5 the load-end close changes nothing — the tap stands — today=' + w.GeoLoads.today().count);
  loop(feed, clock, pos, M2, 300);
  ok(mach(w) === 2, 'A6 the NEXT tip at the moved face counts BY GPS, no tap — machine=' + mach(w));
  ok(w.GeoLoads.today().count === 3, 'A6b three loads, read once each — today=' + w.GeoLoads.today().count);
  ok(w.GeoLoads.today().corr === 1, 'A6c the split stays honest: 2 by GPS + 1 by his tap — corr=' + w.GeoLoads.today().corr);
})();

/* ---------- A2: the few-metres nudge ---------- */
console.log('A2 — a +1 a few metres off the pin moves the seed point, slightly');
(function () {
  const store = mkSharedStore(baseData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  prologue(w, feed, clock, pos);
  loop(feed, clock, pos, FACE_40, 300);
  ok(mach(w) === 1, 'A2-1 a tip 40 m off the pin counts (presence is wide) — machine=' + mach(w));
  const before = dayPoints(store)[0];
  const dBefore = havM(before, FACE_40);
  w.GeoLoads.nudge(1); /* he taps +1 standing at the real tip spot */
  const after = dayPoints(store)[0];
  const dAfter = havM(after, FACE_40);
  const moved = havM(before, after);
  ok(moved > 5 && moved <= 25.5, 'A2-2 the seed point MOVED toward the real spot by one bounded step — ' + moved.toFixed(1) + ' m');
  ok(dAfter < dBefore - 10, 'A2-3 the point sits closer to where he actually tipped — ' + Math.round(dBefore) + ' m -> ' + Math.round(dAfter) + ' m');
  loopBack(feed, clock, pos);
  loop(feed, clock, pos, FACE_40, 300);
  ok(w.GeoLoads.today().count === 3, 'A2-4 the day reads on cleanly: 2 machine + his tap — today=' + w.GeoLoads.today().count);
})();

/* ---------- B: the load-end tap teaches nothing ---------- */
console.log('B — original spots keep counting; a +1 at the load end is a bare correction');
(function () {
  const store = mkSharedStore(baseData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  prologue(w, feed, clock, pos);
  loop(feed, clock, pos, FACE_A, 300);
  ok(mach(w) === 1, 'B1 tip #1 at the original face counts — got ' + mach(w));
  driveTo(feed, clock, pos, LOADFACE, 240);
  park(feed, clock, LOADFACE, 120);
  w.GeoLoads.nudge(1); /* a +1 tapped AT THE LOAD END, mid-loading */
  ok(w.GeoLoads.today().count === 2, 'B2 the tap counts the load he means — today=' + w.GeoLoads.today().count);
  const pts = dayPoints(store);
  ok(pts.length === 1 && havM(pts[0], DUMP) <= 1, 'B3 the dump site did NOT move toward the load end — points=' + pts.length + ', seed off by ' + (pts.length ? Math.round(havM(pts[0], DUMP)) : -1) + ' m');
  ok(nearPoint(pts, LOADFACE) > 1000, 'B3b no dump point was planted at the pickup — nearest ' + Math.round(nearPoint(pts, LOADFACE)) + ' m');
  park(feed, clock, LOADFACE, 120);
  loop(feed, clock, pos, FACE_A, 300);
  ok(mach(w) === 2, 'B4 tip #2 at the original face counts by GPS — machine=' + mach(w));
  ok(w.GeoLoads.today().count === 3, 'B4b the load-end tap was never retired against it — today=' + w.GeoLoads.today().count);
})();

/* ---------- C: re-peg keeps the count; relaunch keeps the taught spot ---------- */
console.log('C — re-peg and relaunch');
(function () {
  const store = mkSharedStore(baseData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  prologue(w, feed, clock, pos);
  loop(feed, clock, pos, FACE_A, 300);
  loopBack(feed, clock, pos);
  driveTo(feed, clock, pos, M1, 240);
  creepTip(feed, clock, pos);
  w.GeoLoads.nudge(1);
  ok(w.GeoLoads.today().count === 2, 'C1 setup: one GPS load + one taught tap — today=' + w.GeoLoads.today().count);
  /* a RELAUNCH on the same store: the taught spot must survive */
  const w2 = mkGeoWorld(store, geoSrc);
  const feed2 = mkFeed(w2);
  const clock2 = { t: clock.t };
  w2.GeoLoads.startDay('s' + T0, {});
  ok(w2.GeoLoads.today().count === 2, 'C2 the relaunch keeps the whole day — today=' + w2.GeoLoads.today().count);
  ok(nearPoint(dayPoints(store), M2) <= 25, 'C2b the TAUGHT spot survived the relaunch — nearest ' + Math.round(nearPoint(dayPoints(store), M2)) + ' m');
  const pos2 = { lat: M2.lat, lng: M2.lng };
  loopBack(feed2, clock2, pos2);
  loop(feed2, clock2, pos2, M2, 300);
  ok(w2.GeoLoads.today().count === 3, 'C3 the tip at the taught spot counts by GPS after the relaunch — today=' + w2.GeoLoads.today().count);
  /* a mid-day RE-PEG of the pickup at a new face */
  const LOADFACE2 = (function () { const p = goff(LOADFACE.lat, LOADFACE.lng, -300, 100); return { lat: p[0], lng: p[1] }; })();
  driveTo(feed2, clock2, pos2, LOADFACE2, 240);
  park(feed2, clock2, LOADFACE2, 60);
  const pegRes = w2.GeoLoads.setPeg('load');
  ok(pegRes && pegRes.ok, 'C4 the re-peg lands — ' + JSON.stringify(pegRes));
  ok(w2.GeoLoads.today().count === 3, 'C4b the re-peg does NOT reset the day count — today=' + w2.GeoLoads.today().count);
  park(feed2, clock2, LOADFACE2, 120);
  loop(feed2, clock2, pos2, FACE_A, 300);
  ok(w2.GeoLoads.today().count === 4, 'C5 counting runs on from the re-peg — today=' + w2.GeoLoads.today().count);
})();

/* ---------- D: the far tap ---------- */
console.log('D — a +1 tapped at home counts and teaches nothing');
(function () {
  const store = mkSharedStore(baseData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  prologue(w, feed, clock, pos);
  loop(feed, clock, pos, FACE_A, 300);
  ok(mach(w) === 1, 'D1 tip #1 counts — got ' + mach(w));
  driveTo(feed, clock, pos, HOME, 300);
  park(feed, clock, HOME, 120);
  w.GeoLoads.nudge(1); /* the evening +1, tapped at home for a load he means */
  ok(w.GeoLoads.today().count === 2, 'D2 the far tap still counts the load — today=' + w.GeoLoads.today().count);
  const pts = dayPoints(store);
  ok(pts.length === 1 && havM(pts[0], DUMP) <= 1, 'D3 the dump peg was NOT dragged across town — points=' + pts.length);
  driveTo(feed, clock, pos, LOADFACE, 300);
  park(feed, clock, LOADFACE, 240);
  loop(feed, clock, pos, FACE_A, 300);
  ok(w.GeoLoads.today().count === 3, 'D4 the next real tip adds on top — today=' + w.GeoLoads.today().count);
})();

/* ---------- E: teach mode — the tap seeds the dump ---------- */
console.log('E — no pin for the dump: the +1 declares it');
(function () {
  const store = mkSharedStore(teachData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, HOME, 30);
  driveTo(feed, clock, pos, DSP_LOADPIN, 300);
  park(feed, clock, DSP_LOADPIN, 240); /* he loads at the pin */
  driveTo(feed, clock, pos, DUMP, 300);
  park(feed, clock, DUMP, 50);         /* first tip, still short of the learner's 2 min */
  const st0 = w.GeoLoads.status();
  ok(!st0.counter, 'E1 no counter exists yet — the dump is untaught (mode=' + st0.mode + ')');
  ok(w.GeoLoads.today().count === 0, 'E1b nothing counted yet — today=' + w.GeoLoads.today().count);
  ok(w.GeoLoads.teachTap() === true, 'E2 the +1 is consumed as the declaration');
  ok(w.GeoLoads.today().count === 1, 'E2b the tap counts the load — today=' + w.GeoLoads.today().count);
  const st1 = w.GeoLoads.status();
  ok(st1.counter && st1.counter.mode === 'dump-visit' && st1.sites && st1.sites.dump && st1.sites.dump.src === 'tap',
    'E2c the day armed the visit counter on the TAP spot — mode=' + (st1.counter && st1.counter.mode) + ', src=' + (st1.sites && st1.sites.dump && st1.sites.dump.src));
  park(feed, clock, DUMP, 180);        /* he finishes the tip and leaves at leisure */
  ok(w.GeoLoads.today().count === 1 && mach(w) === 0, 'E3 the SAME tip never counts twice — today=' + w.GeoLoads.today().count + ', machine=' + mach(w));
  driveTo(feed, clock, pos, DSP_LOADPIN, 300);
  park(feed, clock, DSP_LOADPIN, 240); /* load again — the visit closes */
  driveTo(feed, clock, pos, DUMP, 300);
  park(feed, clock, DUMP, 180);
  ok(mach(w) === 1, 'E4 the NEXT visit at the tap-seeded spot counts BY GPS — machine=' + mach(w));
  ok(w.GeoLoads.today().count === 2, 'E4b two loads, read once each — today=' + w.GeoLoads.today().count);
})();

console.log('E2 — a rough fix declares nothing');
(function () {
  const store = mkSharedStore(teachData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  w.GeoLoads.startDay('s' + T0, {});
  driveTo(feed, clock, pos, DSP_LOADPIN, 300);
  park(feed, clock, DSP_LOADPIN, 240);
  driveTo(feed, clock, pos, DUMP, 300);
  const rough = mkFeed(w, 90);
  rough(clock.t, [DUMP.lat, DUMP.lng]); clock.t += 10;
  ok(w.GeoLoads.teachTap() === false, 'E2-1 a 90 m fix cannot declare the dump');
  ok(w.GeoLoads.today().count === 0 && !w.GeoLoads.status().counter, 'E2-2 nothing armed, nothing counted');
})();

/* ---------- F: the both-pegs day ---------- */
console.log('F — a +1 at a face off the peg drifts the dump centre, slightly');
(function () {
  /* a no-dump-pin dispatch: the day starts unarmed, so both
     pegs can be planted by hand (load first, then dump where
     he tips) before the peg counter exists — a both-pegs day
     with a clean zero. (On a both-pins dispatch the visit
     counter arms on the pins first, and the drive to plant
     the dump peg is itself a counted visit — the visit law
     working as designed, not a peg day.) */
  const store = mkSharedStore(teachData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, HOME, 60);
  driveTo(feed, clock, pos, LOADFACE, 300);
  park(feed, clock, LOADFACE, 120);
  w.GeoLoads.setPeg('load');
  driveTo(feed, clock, pos, FACE_A, 240);
  park(feed, clock, FACE_A, 60);
  w.GeoLoads.setPeg('dump');
  ok(w.GeoLoads.today().countSource === 'pegs', 'F0 the both-pegs day runs the peg counter — source=' + w.GeoLoads.today().countSource);
  driveTo(feed, clock, pos, LOADFACE, 240);
  park(feed, clock, LOADFACE, 150);    /* the pickup arms the cycle */
  driveTo(feed, clock, pos, FACE_F, 240);
  ok(mach(w) === 0, 'F1 on arrival at the moved face nothing has counted yet — machine=' + mach(w));
  const cenBefore = dayRec(store) && dayRec(store).pegCentres && dayRec(store).pegCentres.dump;
  w.GeoLoads.nudge(1);                 /* his +1 at the real face */
  ok(w.GeoLoads.today().count === 1, 'F2 his +1 shows the load — today=' + w.GeoLoads.today().count);
  const cenAfter = dayRec(store) && dayRec(store).pegCentres && dayRec(store).pegCentres.dump;
  ok(cenBefore && cenAfter && havM(cenAfter, FACE_F) < havM(cenBefore, FACE_F) - 10,
    'F3 the dump centre moved TOWARD the real face — ' + (cenBefore ? Math.round(havM(cenBefore, FACE_F)) : -1) + ' m -> ' + (cenAfter ? Math.round(havM(cenAfter, FACE_F)) : -1) + ' m');
  ok(cenBefore && cenAfter && havM(cenBefore, cenAfter) > 10 && havM(cenBefore, cenAfter) <= 25.5,
    'F3b the tap\'s own step is the bounded one — ' + (cenBefore && cenAfter ? havM(cenBefore, cenAfter).toFixed(1) : -1) + ' m');
  park(feed, clock, FACE_F, 150);      /* he finishes the tip */
  ok(w.GeoLoads.today().count === 1, 'F4 the machine confirming the same tip adds NOTHING — today=' + w.GeoLoads.today().count);
  driveTo(feed, clock, pos, LOADFACE, 240);
  park(feed, clock, LOADFACE, 240);
  driveTo(feed, clock, pos, FACE_A, 240);
  park(feed, clock, FACE_A, 180);
  ok(w.GeoLoads.today().count === 2, 'F5 the next cycle at the peg face counts — today=' + w.GeoLoads.today().count);
})();

console.log('\n' + passed + ' passed / ' + failed + ' failed');
process.exit(failed ? 1 : 0);
