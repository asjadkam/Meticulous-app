/*
 * LIVE-MILES-LEG-EATEN-NOV9 — the gap-bridge suite.
 *
 * His Nov 9, 2026 day, replayed through the real engine (the
 * MILES-ENGINE region of js/miles.js, extracted the same way
 * tools/miles-rebuild-test.js extracts it; the paths are the
 * conviction replay's densified ones): left home 07:57
 * (pre-dispatch, the day watch counting), the 08:30 session
 * adopted the day whole, waited at the Go Empty To pit, the
 * watch then died for the whole leg to Hauling To, and the app
 * relaunched at the site to a card reading 16.1 live km against
 * ~40 road km. The conviction (replay against the pre-fix
 * engine, same geometry): leg 1 counted in full; the relaunch
 * join booked leg 2 as 0.00 km; the replay total landed at
 * 16.13 km — his number.
 *
 * The fix (GAP-BRIDGE): a join/gap bounded by two real fixes of
 * the same record counts its straight-line FLOOR, provisionally —
 * labelled in the record (bridgedM/bridges), refused when the
 * chord is site wander (< 45 m) or the implied speed is
 * impossible (> 160 km/h), never stacked over an earlier bridge,
 * and settled when observed ground folds over it: a chain seeded
 * from the span's own join origin that reaches its end replaces
 * the chord wholesale; any other coverage replaces only its
 * slice. The road distance is never guessed; the day still
 * settles from the odometer.
 *
 * Pins:
 *  (A) today's shape end to end: the counter lands within a
 *      sane band of the road truth (>= 85%, <= 102%), the bridge
 *      is the dark leg's chord, pre-dispatch adoption is intact,
 *      the pit wait counts nothing, the bridge persists in the
 *      snapshot as sync-safe maps, and the crumb gap still shows
 *      in the gap finder (honesty kept).
 *  (B) refusal gates: a wake fix inside the still radius bridges
 *      nothing; an impossible-speed join bridges nothing.
 *  (C) refinement: a later native fold whose chain is seeded
 *      from the bridge's origin replaces the chord with the
 *      observed road, exactly once (a re-feed is a no-op), and
 *      bridgedM drains to ~0.
 *  (D) the merge door: a refused seed join (the old
 *      miles-rebuild case-(d) shape) now bridges seed->first
 *      crumb under the same gates; gapJoins still reported.
 *  (E) no stacking: a merge-door bridge over a span an ingest
 *      bridge already covers books nothing twice.
 */
'use strict';
var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
function extract(file, beginMark, endMark) {
  var src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  var a = src.lastIndexOf('/*', src.indexOf(beginMark));
  var b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found in ' + file);
  return src.slice(a, b + 2);
}
var msb = {};
vm.createContext(msb);
vm.runInContext(extract('js/miles.js', 'MILES-ENGINE-BEGIN', 'MILES-ENGINE-END'), msb);
var E = msb.ENGINE;
if (!E || typeof E.createMilesTracker !== 'function') throw new Error('miles engine not extracted');
var H = E.haversineM;

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ok   ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }

var T = function (h, m) { return Date.UTC(2026, 10, 9, h + 6, m, 0); }; // CST -> UTC
var HOME = [51.15709, -113.93862], PIT = [51.1225089, -114.0122197], HAUL = [51.3078889, -114.0369722];

/* Densify a waypoint path into ~40 m steps, timestamped by speed. */
function pathFixes(wps, t0, speedKmh) {
  var pts = [];
  for (var w = 0; w < wps.length - 1; w++) {
    var a = wps[w], b = wps[w + 1];
    var segM = H(a[0], a[1], b[0], b[1]);
    var n = Math.max(1, Math.round(segM / 40));
    for (var i = (w === 0 ? 0 : 1); i <= n; i++) pts.push([a[0] + (b[0] - a[0]) * (i / n), a[1] + (b[1] - a[1]) * (i / n)]);
  }
  var cum = 0, out = [];
  for (var k = 0; k < pts.length; k++) {
    if (k > 0) cum += H(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]);
    out.push({ latitude: pts[k][0], longitude: pts[k][1], accuracy: 8,
               time: t0 + Math.round(cum / (speedKmh * 1000 / 3600)) * 1000, _cum: cum });
  }
  return { fixes: out, totalM: cum };
}
var LEG1_WPS = [HOME, [51.1830, -113.9820], [51.1500, -113.9490], [51.1180, -113.9750], PIT];
var LEG2_WPS = [PIT, [51.1750, -114.0210], [51.2250, -114.0280], [51.2700, -114.0330], HAUL];
var SITE_WPS = [HAUL, [51.30620, -114.03400], [51.30850, -114.03300], [51.30980, -114.03650], HAUL];
var leg1 = pathFixes(LEG1_WPS, T(7, 57), 24); // city average: ~38 min, pit ~08:35
var leg2 = pathFixes(LEG2_WPS, T(8, 55), 62);
var site = pathFixes(SITE_WPS, T(9, 26), 18);
var TRUTH_KM = (leg1.totalM + leg2.totalM + site.totalM) / 1000;
var CHORD_M = H(PIT[0], PIT[1], HAUL[0], HAUL[1]);

function crumbOf(f) { return { t: f.time, a: f.latitude, o: f.longitude, c: 8 }; }
/* A native-service style run over a densified path: a crumb every ~600 m. */
function runCrumbs(p, stepM) {
  var out = [];
  for (var i = 0; i < p.fixes.length; i++) {
    if (i === 0 || p.fixes[i]._cum - (out.length ? out[out.length - 1]._cum : 0) >= stepM) {
      var c = crumbOf(p.fixes[i]); c._cum = p.fixes[i]._cum; out.push(c);
    }
  }
  var last = crumbOf(p.fixes[p.fixes.length - 1]); last._cum = p.totalM;
  if (out[out.length - 1].t !== last.t) out.push(last);
  return out;
}

/* ---------------- (A) today, end to end ---------------- */
console.log('(A) Nov 9 replay — dark leg bridged at its floor  (road truth ~' + TRUTH_KM.toFixed(1) + ' km)');
var R; // the relaunched tracker, shared with (C)
(function () {
  // Day watch from departure; the 08:30 session adopts it whole
  // (begin from the watch's snapshot — the shipped adoption shape).
  var day = E.createMilesTracker();
  day.begin('d2026-11-09', null);
  var tr = day, session = null;
  leg1.fixes.forEach(function (f) {
    if (!session && f.time >= T(8, 30)) {
      session = E.createMilesTracker();
      session.begin('s1', tr.snapshot());
      tr = session;
    }
    tr.ingest(f);
  });
  ok(!!session, '(A) the 08:30 session start fired mid-leg');
  ok(near(tr.totalM(), leg1.totalM, leg1.totalM * 0.02),
     '(A) leg 1 counted in full across the adoption (' + (tr.totalM() / 1000).toFixed(2) + ' of ' + (leg1.totalM / 1000).toFixed(2) + ' km)');

  // Parked at the pit: wander inside the stillness radius counts 0.
  var before = tr.totalM();
  [[51.12252, -114.01220], [51.12249, -114.01225], [51.12251, -114.01218]].forEach(function (p, i) {
    tr.ingest({ latitude: p[0], longitude: p[1], accuracy: 9, time: T(8, 38) + i * 7 * 60000 });
  });
  ok(near(tr.totalM(), before, 30), '(A) pit wait counts ~nothing (drift/stillness intact)');

  // The watch dies for leg 2. Relaunch at Hauling To, 09:25.
  var r = E.createMilesTracker();
  r.begin('s1', tr.snapshot());
  var join = r.ingest({ latitude: HAUL[0], longitude: HAUL[1], accuracy: 8, time: T(9, 25) });
  ok(join.joined === true, '(A) the relaunch fix still takes the join path');
  ok(join.bridgedM > 0 && near(join.bridgedM, CHORD_M, CHORD_M * 0.03),
     '(A) the join bridges the dark leg at its floor (' + (join.bridgedM / 1000).toFixed(2) +
     ' km vs chord ' + (CHORD_M / 1000).toFixed(2) + ' km; pre-fix it booked 0.00)');
  ok(r.bridgedM() > 0, '(A) the estimate is labelled in the record (bridgedM > 0)');

  // Site movement after arrival.
  site.fixes.slice(1).forEach(function (f) { r.ingest(f); });
  var totalKm = r.totalM() / 1000;
  ok(totalKm >= TRUTH_KM * 0.85,
     '(A) counter lands >= 85% of the road truth (' + totalKm.toFixed(2) + ' of ~' + TRUTH_KM.toFixed(1) + ' km; his card read 16.1)');
  ok(totalKm <= TRUTH_KM * 1.02, '(A) counter never exceeds the road truth (' + totalKm.toFixed(2) + ' km)');

  // Honesty: the crumb gap across the dark leg still shows.
  var gaps = E.analyzeGaps(r.snapshot().crumbs);
  ok(gaps.length >= 1 && gaps[0].approxKm >= 18,
     '(A) gap finder still reports the dark leg (' + gaps.length + ' gap(s), largest ' + (gaps[0] && gaps[0].approxKm) + ' km)');

  // The bridge persists in the snapshot, sync-safe, and restores.
  var snap2 = r.snapshot();
  ok(snap2.bridges && snap2.bridges.length >= 1 && snap2.bridgedM > 18000,
     '(A) bridge persists in the snapshot as {f,t,m} maps');
  var r2 = E.createMilesTracker();
  r2.begin('s1', snap2);
  ok(near(r2.bridgedM(), r.bridgedM(), 2) && near(r2.totalM(), r.totalM(), 2),
     '(A) restore keeps the bridged total whole');

  R = r;
})();

/* ---------------- (B) refusal gates ---------------- */
console.log('(B) gates — wander and teleports bridge nothing');
(function () {
  var t = E.createMilesTracker();
  t.begin('s1', null);
  t.ingest({ latitude: PIT[0], longitude: PIT[1], accuracy: 12, time: T(8, 0) });
  var w = E.createMilesTracker();
  w.begin('s1', t.snapshot());
  var j1 = w.ingest({ latitude: PIT[0] + 0.0002, longitude: PIT[1] + 0.0001, accuracy: 9, time: T(8, 30) });
  ok(j1.joined === true && (j1.bridgedM || 0) === 0 && w.bridgedM() === 0,
     '(B) a wake fix inside the still radius bridges nothing');

  var t2 = E.createMilesTracker();
  t2.begin('s1', null);
  t2.ingest({ latitude: PIT[0], longitude: PIT[1], accuracy: 12, time: T(8, 0) });
  var w2 = E.createMilesTracker();
  w2.begin('s1', t2.snapshot());
  // ~100 km in 10 minutes = 600 km/h implied: a bad fix, not a drive.
  var j2 = w2.ingest({ latitude: PIT[0] + 0.9, longitude: PIT[1], accuracy: 9, time: T(8, 10) });
  ok(j2.joined === true && (j2.bridgedM || 0) === 0 && w2.totalM() === 0,
     '(B) an impossible-speed join bridges nothing (old zero-join stands)');
})();

/* ---------------- (C) refinement ---------------- */
console.log('(C) an observed fold replaces the chord, exactly once');
(function () {
  // The same morning as (A), through the relaunch join.
  var day = E.createMilesTracker();
  day.begin('d2026-11-09', null);
  var tr = day, session = null;
  leg1.fixes.forEach(function (f) {
    if (!session && f.time >= T(8, 30)) {
      session = E.createMilesTracker();
      session.begin('s1', tr.snapshot());
      tr = session;
    }
    tr.ingest(f);
  });
  var r = E.createMilesTracker();
  r.begin('s1', tr.snapshot());
  r.ingest({ latitude: HAUL[0], longitude: HAUL[1], accuracy: 8, time: T(9, 25) });
  site.fixes.slice(1).forEach(function (f) { r.ingest(f); });
  var beforeKm = r.totalM() / 1000;
  ok(r.bridgedM() > 18000, '(C) setup: the dark leg stands bridged (' + (r.bridgedM() / 1000).toFixed(2) + ' km)');

  // The native service WAS watching: it sat at the pit from
  // before the truck left (crumbs at the origin point, inside
  // the join window) and recorded the whole road to Hauling To.
  // The chain seeds from the record's join origin and arrives
  // at the chord's end point — the connected case: the chord is
  // replaced wholesale by the observed road.
  var run = [{ t: T(8, 40), a: PIT[0], o: PIT[1], c: 8 },
             { t: T(8, 47), a: PIT[0], o: PIT[1], c: 8 }]
    .concat(runCrumbs(leg2, 600));
  var m1 = r.mergeCrumbs(run);
  var afterKm = r.totalM() / 1000;
  ok(m1.gapJoins === 0, '(C) the run connects through the join origin (no gap join)');
  ok(near(afterKm, TRUTH_KM, TRUTH_KM * 0.03),
     '(C) total converges to the observed road (' + afterKm.toFixed(2) + ' km vs truth ~' + TRUTH_KM.toFixed(1) + '; bridged was ' + beforeKm.toFixed(2) + ')');
  // The dark leg's chord drains entirely; what may remain labelled
  // is the ~80 m adoption-join step from the morning handoff,
  // booked provisionally at 08:30 and never re-observed by a fold.
  // The total is exact either way — bridgedM is only the label.
  ok(r.bridgedM() < 200, '(C) bridgedM drains to ~0 once observed (' + r.bridgedM().toFixed(0) + ' m left — the adoption step)');
  var m2 = r.mergeCrumbs(run);
  ok(m2.addedM === 0 && near(r.totalM() / 1000, afterKm, 0.001),
     '(C) re-feeding the same run is a no-op — never counted twice');
})();

/* ---------------- (D) the merge door ---------------- */
console.log('(D) refused seed join bridges under the same gates');
(function () {
  var t = E.createMilesTracker();
  t.begin('s1', null);
  t.ingest({ latitude: PIT[0], longitude: PIT[1], accuracy: 12, time: T(8, 55) }); // anchor at the pit
  var w = E.createMilesTracker();
  w.begin('s1', t.snapshot());                        // relaunch: join armed, origin = pit
  var j = w.ingest({ latitude: PIT[0] + 0.0002, longitude: PIT[1], accuracy: 9, time: T(9, 0) });
  ok(j.joined === true && (j.bridgedM || 0) === 0, '(D) same-site wake: no bridge, join origin preserved');
  // Nobody observed the drive to HAUL; the run holds only the site loop.
  var run = [crumbOf(site.fixes[0])].concat(runCrumbs(site, 200).slice(1));
  var m = w.mergeCrumbs(run);
  ok(m.gapJoins === 1, '(D) the unobserved join is still reported as a gap join');
  ok(m.bridgedM > 0 && near(m.bridgedM, CHORD_M, CHORD_M * 0.03),
     '(D) …and now bridged at its floor (' + (m.bridgedM / 1000).toFixed(2) + ' km)');
  ok(w.totalM() > CHORD_M, '(D) total = chord + the observed site loop');
})();

/* ---------------- (E) no stacking ---------------- */
console.log('(E) bridges never stack over the same ground');
(function () {
  // The (A) shape, but the fold's run starts 25 min after the
  // join origin (a refused seed join): the merge door must NOT
  // book a second chord over the span the ingest bridge holds.
  var day = E.createMilesTracker();
  day.begin('d2026-11-09', null);
  leg1.fixes.forEach(function (f) { day.ingest(f); });
  var r = E.createMilesTracker();
  r.begin('s1', day.snapshot());
  var join = r.ingest({ latitude: HAUL[0], longitude: HAUL[1], accuracy: 8, time: T(9, 25) });
  var bridgedAtJoin = r.bridgedM();
  ok(join.bridgedM > 0 && bridgedAtJoin > 18000, '(E) ingest bridge landed (' + (bridgedAtJoin / 1000).toFixed(2) + ' km)');
  // A partial run: only the last third of leg 2 was observed,
  // starting well after the origin (seed join refused).
  var tail = leg2.fixes.filter(function (f) { return f._cum > leg2.totalM * 0.66; });
  var tailPath = { fixes: tail, totalM: leg2.totalM };
  var m = r.mergeCrumbs(runCrumbs(tailPath, 600));
  ok(m.gapJoins === 1 && (m.bridgedM || 0) === 0,
     '(E) the refused seed join books no second chord over the bridged span');
  var expected = leg1.totalM + CHORD_M + (leg2.totalM * 0.34);
  ok(r.totalM() <= expected * 1.03,
     '(E) total stays estimate + observed tail, never stacked (' + (r.totalM() / 1000).toFixed(2) + ' km)');
  ok(r.bridgedM() > 8000,
     '(E) the unobserved prefix keeps its labelled estimate (' + (r.bridgedM() / 1000).toFixed(2) + ' km still bridged)');
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
