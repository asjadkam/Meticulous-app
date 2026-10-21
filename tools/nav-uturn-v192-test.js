#!/usr/bin/env node
/* Meticulous v192 — NAV-UTURN suite (geometry reversals).
 *
 * The owner's live drive, Oct 21, 2026 07:38 MDT (to Ivor East
 * Pond on 17 Ave SE / HWY-1A, screenshot in chat): the route
 * doubled back on itself — out on one carriageway, back on the
 * parallel one — and the next-step inset drew a TURN-AROUND
 * arrow over "160 m · Continue on 17 Avenue SE". Standing rule:
 * the truck Navigator NEVER instructs a U-turn — not in words
 * (v135), and now not in geometry either.
 *
 * The v135 layers read maneuver types/text; this defect
 * carried NEITHER — a plain "continue" whose GEOMETRY reversed
 * ~180° at a divided-highway crossover. v192 adds the geometry
 * layer: planReversals measures the bearing in/out of every
 * maneuver boundary off the route line itself (|delta| ≥ 150°
 * = the road points the truck back at itself), doRoute feeds
 * those points into the SAME exclusion re-request as typed
 * U-turns, and the drive inset refuses to draw a turn-around
 * arrow even when every re-request round is spent.
 *
 * Run: node tools/nav-uturn-v192-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function extract(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}

const navSrc = read('modules/navigator.js');
const sb = { console: console };
vm.createContext(sb);
vm.runInContext(extract(navSrc, 'NAVPURE-BEGIN', 'NAVPURE-END'), sb);

console.log('— v192: the geometry layer exists and is wired —');
ok('planReversals + reversalDeltaDeg are NAVPURE',
  typeof sb.planReversals === 'function' && typeof sb.reversalDeltaDeg === 'function');
ok('doRoute feeds reversals into the typed U-turn exclusion set',
  navSrc.indexOf('planReversals(plan, line).forEach') !== -1 &&
  navSrc.indexOf('uts.indexOf(ri) === -1') !== -1);
ok('the exclusion re-request itself is the v135 one (exclude_locations at the maneuver start)',
  navSrc.indexOf('reqBody.exclude_locations') !== -1 &&
  navSrc.indexOf('plan.maneuvers[i].cumStartKm * 1000') !== -1);
ok('the drive inset refuses a turn-around arrow (local or sustained reversal hides it)',
  navSrc.indexOf('Math.abs(dDeg) >= 150') !== -1 &&
  navSrc.indexOf('Math.abs(reversalDeltaDeg(S.plan, S.line, dp.idx)) >= 150') !== -1);

/* ---- fixture geometry: a divided highway, 17 Ave SE style ----
   Leg 1: EAST on the south carriageway (lat 51.04500).
   Crossover: a ~30 m jog north-west through a median opening.
   Leg 2: WEST on the north carriageway (lat 51.04522, ~25 m up).
   Points every ~20 m so pointAlongLine sampling is honest. */
function leg(latA, lonA, latB, lonB, stepM) {
  const pts = [];
  const dLat = latB - latA, dLon = lonB - lonA;
  const approxM = Math.sqrt(Math.pow(dLat * 111320, 2) + Math.pow(dLon * 111320 * Math.cos(latA * Math.PI / 180), 2));
  const n = Math.max(1, Math.round(approxM / stepM));
  for (let i = 0; i <= n; i++) pts.push([latA + dLat * i / n, lonA + dLon * i / n]);
  return { pts: pts, m: approxM };
}
function buildLine(legs) {
  let line = [], total = 0;
  const bounds = [];
  legs.forEach(function (L) {
    const seg = leg(L[0], L[1], L[2], L[3], 20);
    bounds.push(total);
    line = line.concat(seg.pts.slice(line.length ? 1 : 0));
    total += seg.m;
  });
  bounds.push(total);
  return { line: line, bounds: bounds, total: total };
}
function planFromBounds(bounds, specs) {
  /* one spec per LEG, plus the zero-length arrival maneuver
     every real plan ends with */
  const mans = specs.map(function (s, i) {
    return {
      instruction: s[0], verbalPre: '', verbalPost: '', streets: ['17 Avenue SE'],
      lengthKm: (bounds[i + 1] - bounds[i]) / 1000,
      cumStartKm: bounds[i] / 1000, cumEndKm: bounds[i + 1] / 1000, type: s[1]
    };
  });
  const total = bounds[bounds.length - 1];
  mans.push({ instruction: 'Arrive', verbalPre: '', verbalPost: '', streets: [],
    lengthKm: 0, cumStartKm: total / 1000, cumEndKm: total / 1000, type: 4 });
  return { maneuvers: mans, totalKm: total / 1000, totalMin: 5 };
}

console.log('— v192: the divided-highway double-back —');
{
  const built = buildLine([
    [51.04500, -113.9000, 51.04500, -113.8880],   /* east ~835 m */
    [51.04500, -113.8880, 51.04522, -113.8884],   /* crossover jog */
    [51.04522, -113.8884, 51.04522, -113.8980]    /* west ~670 m */
  ]);
  const plan = planFromBounds(built.bounds, [
    ['Head east on 17 Avenue SE', 1],
    ['Continue on 17 Avenue SE', 8],
    ['Continue on 17 Avenue SE', 8]
  ]);
  eq('the old layer sees NO U-turn here (no type, no words — the v192 gap)',
    sb.planUturns(plan), []);
  eq('planReversals flags both maneuvers that start inside the crossover zone',
    sb.planReversals(plan, built.line), [1, 2]);
  const d = sb.reversalDeltaDeg(plan, built.line, 1);
  ok('the sustained bend at the crossover is a reversal (|delta| >= 150)',
    Math.abs(d) >= 150, 'delta ' + d);
}
console.log('— v192: honest roads are NOT flagged —');
{
  /* A plain 90° left turn: north, then west. */
  const built = buildLine([
    [51.0400, -113.9000, 51.0470, -113.9000],
    [51.0470, -113.9000, 51.0470, -113.9100]
  ]);
  const plan = planFromBounds(built.bounds, [
    ['Head north on Barlow Trail SE', 1],
    ['Turn left onto 17 Avenue SE', 10]
  ]);
  eq('a 90-degree left turn is not a reversal', sb.planReversals(plan, built.line), []);
}
{
  /* A gentle S-curve (two ~30° bends). */
  const built = buildLine([
    [51.0450, -113.9000, 51.0456, -113.8898],
    [51.0456, -113.8898, 51.0450, -113.8796]
  ]);
  const plan = planFromBounds(built.bounds, [
    ['Head east', 1], ['Continue', 8]
  ]);
  eq('a gentle S-curve is not a reversal', sb.planReversals(plan, built.line), []);
}
{
  /* A loop-the-block answer (three right turns, all forward):
     the shape a correct truck re-route takes — never flagged. */
  const built = buildLine([
    [51.0450, -113.9000, 51.0450, -113.8886],
    [51.0450, -113.8886, 51.0477, -113.8886],
    [51.0477, -113.8886, 51.0477, -113.9000],
    [51.0477, -113.9000, 51.0504, -113.9000]
  ]);
  const plan = planFromBounds(built.bounds, [
    ['Head east', 1], ['Turn right', 9], ['Turn right', 9], ['Turn right', 9]
  ]);
  eq('looping the block (three forward rights) is not a reversal',
    sb.planReversals(plan, built.line), []);
}
console.log('— v192: degenerate inputs stay silent —');
eq('no plan -> no reversals', sb.planReversals(null, [[51, -113], [51.1, -113]]), []);
eq('no line -> no reversals', sb.planReversals({ maneuvers: [{ cumEndKm: 1 }, { cumEndKm: 2 }] }, null), []);
eq('a one-point line -> no reversals', sb.planReversals({ maneuvers: [{ cumEndKm: 0 }, { cumEndKm: 1 }] }, [[51, -113]]), []);

console.log('\nnav-uturn-v192: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
