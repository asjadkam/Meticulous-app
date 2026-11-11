#!/usr/bin/env node
/* Meticulous — NAV-ML-LEARNING stage 1 suite (owner, Nov 10,
 * 2026: the Navigator must learn each trucker's own route
 * choices — a road too small, traffic, or plain gut feel —
 * instead of always spitting out the same router route).
 *
 * This suite loads the REAL NAVLEARN pure region of
 * js/navlearn.js into a vm world and drives it with simulated
 * traces over a Calgary-grid pair (origin A south, destination
 * B ~4.4 km due north; the server route runs straight up one
 * street, the driver's own way runs up a parallel street
 * ~300 m east), and proves:
 *   (1) a completed drive that materially deviates from the
 *       suggested route PLANTS a learned route for the pair;
 *   (2) driving the same deviation again REFRESHES it and the
 *       count rises — one drive plants, repeats strengthen;
 *   (3) the third navigation of the pair is offered the LEARNED
 *       path (lookup + planFor return his driven line, with his
 *       own average time as the ETA);
 *   (4) a completed drive ON the learned route strengthens it
 *       again and keeps the stored line byte-identical;
 *   (5) a fresh profile (empty data) has NO learned route for
 *       the pair — standard routing, exactly as before;
 *   (6) a drive that simply follows the suggested route plants
 *       nothing;
 *   (7) an abandoned drive (ends far from the destination) and
 *       a too-short hop plant nothing;
 *   (8) pair keying rides ~150 m cells: a start 50 m away
 *       (inside the cell) is the same pair, a start 400 m away
 *       is a different pair;
 *   (9) capture thinning keeps a whole drive to a few hundred
 *       points at ≥ ~25 m spacing;
 *  (10) integration: the Navigator carries exactly the four
 *       hooks (lookup in doRoute, beginTrip in startDrive,
 *       pushFix in onPos, finishTrip in exitDrive) plus the
 *       learned-route suppression on the off-route path — and
 *       neither navlearn.js nor the hooks add any UI control:
 *       capture costs zero taps.
 * Run: node tools/nav-ml-learning-stage1-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? ' — ' + detail : '')); }
}
function extract(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}

/* ---- the real pure region, in a vm world ---- */
const nlSrc = read('js/navlearn.js');
const region = extract(nlSrc, 'NAVLEARN-BEGIN', 'NAVLEARN-END');
const world = {};
vm.createContext(world);
vm.runInContext(region + '\n;this.__nl = { cellKeyOf: nlCellKeyOf, pairKeyFor: nlPairKey, thinTrace: nlThinTrace, lineLengthM: nlLineLengthM, assessDrive: nlAssessDrive, applyDrive: nlApplyDrive, lookupIn: nlLookupIn, buildPlan: nlBuildPlan, emptyData: nlEmptyData };', world);
const NL = world.__nl;

/* ---- trace builders (deterministic) ---- */
function lerp(a, b, t) { return a + (b - a) * t; }
function lineBetween(a, b, stepM) {
  const dLat = b[0] - a[0], dLon = b[1] - a[1];
  const approxM = Math.sqrt(Math.pow(dLat * 110540, 2) + Math.pow(dLon * 111320 * Math.cos(a[0] * Math.PI / 180), 2));
  const n = Math.max(2, Math.round(approxM / stepM));
  const out = [];
  for (let i = 0; i <= n; i++) out.push([lerp(a[0], b[0], i / n), lerp(a[1], b[1], i / n)]);
  return out;
}
function pathThrough(pts, stepM) {
  let out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const seg = lineBetween(pts[i], pts[i + 1], stepM);
    out = out.concat(i === 0 ? seg : seg.slice(1));
  }
  return out;
}
function jitter(line, m, seed) {
  /* deterministic ±m wobble perpendicular-ish (lon only, small) */
  const k = m / (111320 * Math.cos(line[0][0] * Math.PI / 180));
  return line.map(function (p, i) {
    const s = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
    const f = (s - Math.floor(s)) * 2 - 1;
    return [p[0], p[1] + f * k];
  });
}

const A = [51.0496, -114.0590];            /* origin — the centre of its ~150 m cell */
const B = [51.0896, -114.0590];            /* destination, ~4.42 km north */
const EAST = 0.00429;                      /* ~300 m east at this latitude */
const suggested = lineBetween(A, B, 150);  /* the router's straight line */
const hisWayPts = [A, [A[0], A[1] + EAST], [B[0], B[1] + EAST], B];
const hisWay = pathThrough(hisWayPts, 120);/* his drive: east, north parallel, west in */
const pairKey = NL.pairKeyFor(A, B);

function drive(data, trace, suggestedLine, onLearned, durSec, now) {
  const assessment = NL.assessDrive(trace, suggestedLine, B);
  return NL.applyDrive(data, {
    pairKey: pairKey, origin: A, dest: B, destLabel: 'The Dump',
    trace: trace, durationSec: durSec, onLearned: onLearned,
    now: now, assessment: assessment
  });
}

/* (8) cell keying */
check('(8) same pair from 50 m away (inside the cell)', NL.pairKeyFor([A[0] + 0.00045, A[1]], B) === pairKey);
check('(8) different pair from 400 m away', NL.pairKeyFor([A[0] + 0.0036, A[1]], B) !== pairKey);
check('(8) return trip is its own pair', NL.pairKeyFor(B, A) !== pairKey);

/* (9) thinning */
(function () {
  const raw = pathThrough(hisWayPts, 5); /* a fix every ~5 m */
  const thinned = NL.thinTrace(raw, 25);
  let minGap = Infinity;
  for (let i = 0; i + 1 < thinned.length - 1; i++) {
    const d = NL.lineLengthM([thinned[i], thinned[i + 1]]);
    if (d < minGap) minGap = d;
  }
  check('(9) thinning shrinks the trace hard', thinned.length < raw.length / 3, thinned.length + ' vs ' + raw.length);
  check('(9) kept spacing ≥ ~25 m (final point excepted)', minGap >= 24, minGap.toFixed(1));
  check('(9) thinned trace keeps both ends', thinned[0] === raw[0] && thinned[thinned.length - 1] === raw[raw.length - 1]);
})();

/* the deviation really is material, the follow really is not */
(function () {
  const dev = NL.assessDrive(hisWay, suggested, B);
  check('deviation drive completes', dev.completed === true, JSON.stringify(dev));
  check('deviation reads material (fracOff > 0.25)', dev.deviated === true && dev.fracOff > 0.25, 'frac=' + dev.fracOff.toFixed(2));
  const fol = NL.assessDrive(jitter(suggested, 12, 3), suggested, B);
  check('followed drive completes but does not deviate', fol.completed === true && fol.deviated === false, 'frac=' + fol.fracOff.toFixed(2));
})();

/* (5) fresh profile first — nothing learned, nothing offered */
let data = NL.emptyData();
check('(5) fresh profile: lookup is null', NL.lookupIn(data, A, B) === null);

/* (6) a followed drive plants nothing */
(function () {
  const r = drive(data, jitter(suggested, 12, 3), suggested, false, 600, 1000000);
  check('(6) followed drive changes nothing', r.changed === false && r.why === 'followed', r.why);
  check('(6) still no learned route', NL.lookupIn(data, A, B) === null);
})();

/* (7) abandoned + too-short drives plant nothing */
(function () {
  const half = lineBetween(A, [51.0696, -114.0590], 120); /* stops ~2.2 km short */
  const r1 = drive(data, half, suggested, false, 300, 1001000);
  check('(7) abandoned drive teaches nothing', r1.changed === false && r1.why === 'incomplete', r1.why);
  const hop = lineBetween([51.0891, -114.0590], B, 30);    /* ~55 m hop at the door */
  const r2 = NL.applyDrive(data, {
    pairKey: NL.pairKeyFor([51.0891, -114.0590], B), origin: [51.0891, -114.0590], dest: B,
    destLabel: 'The Dump', trace: hop, durationSec: 60, onLearned: false, now: 1002000,
    assessment: NL.assessDrive(hop, suggested, B)
  });
  check('(7) too-short hop teaches nothing', r2.changed === false && r2.why === 'incomplete', r2.why);
  check('(7) store still empty', Object.keys(data.routes).length === 0);
})();

/* (1) first deviation plants the learned route */
(function () {
  const r = drive(data, hisWay, suggested, false, 900, 1003000);
  check('(1) deviation plants', r.changed === true && r.why === 'planted', r.why);
  const rec = NL.lookupIn(data, A, B);
  check('(1) record exists with count 1', !!rec && rec.count === 1);
  check('(1) stored line is his driven way (length ≈ his, not the router’s)',
    Math.abs(NL.lineLengthM(rec.line) - NL.lineLengthM(hisWay)) < NL.lineLengthM(hisWay) * 0.05 &&
    NL.lineLengthM(rec.line) > NL.lineLengthM(suggested) * 1.05,
    NL.lineLengthM(rec.line).toFixed(0) + ' vs his ' + NL.lineLengthM(hisWay).toFixed(0) + ' / router ' + NL.lineLengthM(suggested).toFixed(0));
})();

/* (2) second deviation refreshes and strengthens */
(function () {
  const r = drive(data, jitter(hisWay, 15, 7), suggested, false, 840, 1004000);
  const rec = NL.lookupIn(data, A, B);
  check('(2) repeat deviation strengthens (count 2)', r.changed === true && !!rec && rec.count === 2, r.why);
})();

/* (3) the third navigation is offered the learned path */
(function () {
  const rec = NL.lookupIn(data, [A[0] + 0.00045, A[1]], B); /* starts 50 m off the original spot, same cell */
  check('(3) lookup from inside the origin cell finds it', !!rec);
  const plan = NL.buildPlan(rec.line, rec, 'The Dump');
  check('(3) offered line IS the learned line', JSON.stringify(plan && rec.line) === JSON.stringify(rec.line) && plan.totalKm > NL.lineLengthM(suggested) / 1000 * 1.05);
  check('(3) ETA is his own average time (870 s → 14.5 min)', Math.abs(plan.totalMin - 14.5) < 0.01, plan.totalMin);
  check('(3) plan shape matches maneuverPlan’s', plan.maneuvers.length === 2 &&
    plan.maneuvers[0].cumStartKm === 0 && Math.abs(plan.maneuvers[0].cumEndKm - plan.totalKm) < 1e-9 &&
    plan.maneuvers[1].cumStartKm === plan.totalKm && /Your usual route to The Dump/.test(plan.maneuvers[0].instruction) &&
    plan.maneuvers[1].verbalPost === 'You have arrived.');
})();

/* (4) a drive ON the learned route strengthens, line untouched */
(function () {
  const recBefore = NL.lookupIn(data, A, B);
  const lineBefore = JSON.stringify(recBefore.line);
  const r = drive(data, jitter(recBefore.line, 10, 11), recBefore.line, true, 870, 1005000);
  const rec = NL.lookupIn(data, A, B);
  check('(4) learned-route drive strengthens (count 3)', r.changed === true && r.why === 'strengthened' && rec.count === 3, r.why);
  check('(4) stored line byte-identical after it', JSON.stringify(rec.line) === lineBefore);
})();

/* (10) integration — the hooks exist, and learning adds no UI */
(function () {
  const nav = read('modules/navigator.js');
  const idx = read('index.html');
  check('(10) doRoute consults NavLearn.lookup', /function doRoute\(\)[\s\S]{0,4000}NavLearn\.lookup/.test(nav));
  check('(10) startDrive opens capture (beginTrip)', nav.indexOf('NavLearn.beginTrip') !== -1);
  check('(10) onPos feeds capture (pushFix)', nav.indexOf('NavLearn.pushFix') !== -1);
  check('(10) exitDrive closes capture (finishTrip)', nav.indexOf('NavLearn.finishTrip') !== -1);
  check('(10) leaving a learned route suppresses it', nav.indexOf('learnSuppressDest = NavLearn.destCellOf') !== -1 && nav.indexOf('S.learnSuppressDest !== NavLearn.destCellOf') !== -1);
  check('(10) navlearn.js touches no DOM', !/document\.|querySelector|addEventListener|createElement/.test(nlSrc.replace(/\/\*[\s\S]*?\*\//g, '')));
  check('(10) the hooks add no button or handler', !/NavLearn[\s\S]{0,120}(onclick|addEventListener|<button)/.test(nav));
  check('(10) index.html loads navlearn before navigator', idx.indexOf('js/navlearn.js') !== -1 && idx.indexOf('js/navlearn.js') < idx.indexOf('modules/navigator.js'));
  check('(10) learned summary line present', nav.indexOf('Your usual route — learned from your driving') !== -1);
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
