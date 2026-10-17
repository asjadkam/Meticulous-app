#!/usr/bin/env node
/* Meticulous v126 — live-miles REBUILD: the owner's Oct 14–17 pattern.
 * The MILES-ENGINE region of js/miles.js is sliced out verbatim and
 * driven through the day the owner actually lives:
 *
 *   app open at the session start (a few live fixes near home)
 *   -> app killed while he drives (Maps / texts / camera)
 *   -> the native service records the whole drive as breadcrumbs
 *   -> app wakes AT THE DESTINATION: the geo watch delivers a live
 *      fix FIRST (the join re-anchor), and only then does the
 *      breadcrumb drain fold the service's run in.
 *
 * Pre-v126 the wake fix teleported the engine's anchor past the
 * whole drive; mergeCrumbs then treated every crumb at-or-before
 * the anchor as "already observed" and skipped the lot — the drain
 * acked them natively and the leg was gone for good (Oct 17:
 * 13.3 live km on the dashboard against 45 odometer km by 09:27,
 * the entire ~31 km home->site leg absent).
 *
 * Pins:
 *  (a) wake order fix-then-crumbs: total = the full route, not the
 *      foreground fragment;
 *  (b) wake order crumbs-then-fix: same full total (order-proof);
 *  (c) two kill/wake cycles with a wake fix at each stop: the full
 *      route still reconstructs, exactly once (re-fed crumbs no-op);
 *  (d) honesty: when NOBODY observed the first stretch (service
 *      also dead), that stretch stays uncounted — the join is
 *      reported as a gap join and only the observed run counts.
 *
 * Route: a realistic SE-Calgary polyline, home (Cornerstone NE)
 * -> Deerfoot south -> Stoney Trail -> the Maple Ridge pit — the
 * owner's actual Oct 17 dispatch run, ~24 km of road.
 * Run: node tools/miles-rebuild-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.log('  NOT OK -', name); }
}

function extract(file, beginMark, endMark) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found in ' + file);
  return src.slice(a, b + 2);
}
const milesCode = extract('js/miles.js', 'MILES-ENGINE-BEGIN', 'MILES-ENGINE-END');
const msb = {};
vm.createContext(msb);
vm.runInContext(milesCode, msb);
const M = msb.ENGINE;
if (!M || typeof M.createMilesTracker !== 'function') throw new Error('miles engine not extracted');

/* ---------- the route (dense polyline = ground truth) ---------- */
const T0 = 1792212000000; // Sat Oct 17, 2026 08:00:00 MDT in ms (approx epoch is fine)
const WAYPOINTS = [
  [51.15709, -113.93862],  // home, Cornerstone NE
  [51.13800, -113.96200],
  [51.11800, -113.98500],  // Deerfoot Tr south
  [51.09200, -114.00800],
  [51.06200, -114.03200],
  [51.03200, -114.04800],
  [51.00600, -114.05600],  // Deerfoot / Stoney area
  [50.98400, -114.04600],  // Stoney Trail east
  [50.96044, -114.03176]   // Maple Ridge pit (the Oct 17 dispatch pin)
];
function buildRoute(stepM) {
  const pts = [];
  for (let w = 0; w < WAYPOINTS.length - 1; w++) {
    const a = WAYPOINTS[w], b = WAYPOINTS[w + 1];
    const segM = M.haversineM(a[0], a[1], b[0], b[1]);
    const n = Math.max(1, Math.round(segM / stepM));
    for (let i = (w === 0 ? 0 : 1); i <= n; i++) {
      pts.push([a[0] + (b[0] - a[0]) * (i / n), a[1] + (b[1] - a[1]) * (i / n)]);
    }
  }
  // cumulative distance along the polyline
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + M.haversineM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  }
  return { pts: pts, cum: cum, totalM: cum[cum.length - 1] };
}
const ROUTE = buildRoute(50); // a point every ~50 m
const SPEED_MPS = 16500 / 3600; // ~60 km/h average over the run
function timeAtDist(dM) { return T0 + Math.round(dM / SPEED_MPS) * 1000; }
function fixAtDist(dM) {
  // nearest dense point at-or-before dM
  let lo = 0, hi = ROUTE.cum.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ROUTE.cum[mid] <= dM) lo = mid; else hi = mid - 1; }
  const p = ROUTE.pts[lo];
  return { latitude: p[0], longitude: p[1], accuracy: 8, time: timeAtDist(ROUTE.cum[lo]) };
}
function crumbAtDist(dM) {
  const f = fixAtDist(dM);
  return { t: f.time, a: f.latitude, o: f.longitude, c: 8 };
}
/* The native service's run: a crumb every ~600 m of road, from the
   arm's fire time (before the first live fix) to the destination. */
function serviceCrumbs(fromM, toM) {
  const out = [];
  for (let d = fromM; d <= toM; d += 600) out.push(crumbAtDist(d));
  if (out.length && out[out.length - 1].t < timeAtDist(toM)) out.push(crumbAtDist(toM));
  return out;
}
const FULL = ROUTE.totalM;
const WITHIN = function (tr, meters, pct) {
  return Math.abs(tr.totalM() - meters) <= meters * pct;
};
console.log('route: ' + (FULL / 1000).toFixed(2) + ' km, ' + ROUTE.pts.length + ' dense points');
ok(FULL >= 20000, 'route is a real >= 20 km run (got ' + (FULL / 1000).toFixed(1) + ' km)');

/* The morning, shared by (a) and (b): live fixes over the first
   500 m while the app is open at home, then the app dies. */
function morningStart() {
  const tr = M.createMilesTracker();
  tr.begin('s1', null);
  [0, 120, 240, 360, 500].forEach(function (d) { tr.ingest(fixAtDist(d)); });
  return tr.snapshot();
}

/* (a) THE OWNER'S WAKE ORDER: live fix at the destination FIRST,
   then the drain folds the service's whole run. */
{
  const snap = morningStart();
  const tr = M.createMilesTracker();
  tr.begin('s1', snap);                                   // relaunch: join armed
  const j = tr.ingest(fixAtDist(FULL));                   // wake fix at the pit
  ok(j.joined === true, '(a) the wake fix takes the join path (segment not counted yet)');
  const res = tr.mergeCrumbs(serviceCrumbs(0, FULL));     // then the drain lands
  ok(res.gapJoins === 0, '(a) the service observed the join — no gap join reported');
  ok(WITHIN(tr, FULL, 0.02),
    '(a) after the wake fold the total is the FULL route ' + (FULL / 1000).toFixed(1) +
    ' km (got ' + (tr.totalM() / 1000).toFixed(2) + ' km) — not the 0.5 km foreground fragment');
  const again = tr.mergeCrumbs(serviceCrumbs(0, FULL));
  ok(again.accepted === 0 && WITHIN(tr, FULL, 0.02),
    '(a) re-feeding the same run after the rebuild is a no-op (exactly once)');
}

/* (b) THE LUCKY ORDER: drain first, live fix after — same total. */
{
  const snap = morningStart();
  const tr = M.createMilesTracker();
  tr.begin('s1', snap);
  tr.mergeCrumbs(serviceCrumbs(0, FULL));
  tr.ingest(fixAtDist(FULL));
  ok(WITHIN(tr, FULL, 0.02),
    '(b) crumbs-then-fix reconstructs the same full route (got ' + (tr.totalM() / 1000).toFixed(2) + ' km)');
}

/* (c) TWO kill/wake cycles: wake fix at a mid-route stop, killed
   again, wake fix at the destination, crumbs drained once at the
   end (they sat in the native file through both cycles). */
{
  const snap = morningStart();
  const mid = Math.round(FULL * 0.45);
  let tr = M.createMilesTracker();
  tr.begin('s1', snap);
  tr.ingest(fixAtDist(mid));                              // wake at the mid stop: join teleport #1
  tr.ingest(fixAtDist(mid + 300));                        // a little foreground rolling at the stop
  const snap2 = tr.snapshot();                            // killed again
  tr = M.createMilesTracker();
  tr.begin('s1', snap2);
  tr.ingest(fixAtDist(FULL));                             // wake at the pit: join teleport #2
  tr.mergeCrumbs(serviceCrumbs(0, FULL));                 // the day's whole run folds at last
  ok(WITHIN(tr, FULL, 0.02),
    '(c) two teleports + one late fold still rebuild the full route exactly once (got ' +
    (tr.totalM() / 1000).toFixed(2) + ' km)');
}

/* (d) HONESTY: the service was ALSO dead for the first stretch —
   its first crumb lands ~14 km in, ~25 min after the last live
   fix. That stretch was observed by nobody: it must stay
   uncounted, the join must be reported as a gap, and the
   observed remainder must count. */
{
  const snap = morningStart();
  const tr = M.createMilesTracker();
  tr.begin('s1', snap);
  tr.ingest(fixAtDist(FULL));                             // wake fix at the pit (join teleport)
  const resumeM = 14000;
  const res = tr.mergeCrumbs(serviceCrumbs(resumeM, FULL));
  ok(res.gapJoins >= 1, '(d) the unobserved join is reported as a gap join, never silently bridged');
  const observed = FULL - resumeM + 500;                  // 500 m live + the observed run (chords approx)
  ok(tr.totalM() <= observed * 1.02 && tr.totalM() >= (FULL - resumeM) * 0.95,
    '(d) only the observed run counts: ~' + (observed / 1000).toFixed(1) + ' km of ' +
    (FULL / 1000).toFixed(1) + ' km (got ' + (tr.totalM() / 1000).toFixed(2) + ' km)');
  ok(tr.totalM() < FULL * 0.75, '(d) the missing ~14 km is NOT invented');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
