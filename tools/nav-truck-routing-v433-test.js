#!/usr/bin/env node
/* Meticulous — NAV-TRUCK-ROUTING v433 suite (owner, Nov 12,
 * 2026: the Navigator routed him along 48 Avenue NE, a "50%
 * weight legal" street, while LOADED; and his own driven
 * Métis Trail route for the same pair did not win on the next
 * loaded run — "I was just training it last time that it's
 * not supposed to take me from the inside road, it's supposed
 * to take me from Métis. It did not though.").
 *
 * This suite loads the REAL NAVPURE region of
 * modules/navigator.js and the REAL NAVLEARN region of
 * js/navlearn.js into vm worlds and proves:
 *  (1) LOADED DEFAULT: buildRouteRequest on the default
 *      profile asks the engine for a 24.3 t truck (the tandem
 *      dump's licensed mass); an explicit saved weight still
 *      wins (the vehicle-record path is untouched).
 *  (2) THE REPORTED STREET FLAGS: a through-route down
 *      48 Avenue NE flags 'reported' even though the fixture
 *      City layer lists that stretch as an UNRESTRICTED truck
 *      route (the real layer does exactly that — the load ban
 *      lives in no data feed, which is why the reported table
 *      exists). The warning names the street and its limit,
 *      and an exclusion ring builds inside Valhalla's
 *      10,000 m circumference cap.
 *  (3) ACCESS IS NOT EXEMPT FOR REPORTED STREETS: a short
 *      route ENDING on 48 Avenue NE still flags — a loaded
 *      truck may not use it at all. (The same short off-network
 *      tail on an unreported street does NOT flag: bylaw local
 *      access is real.)
 *  (4) THE LEGAL ROUTE SCREENS CLEAN: a line riding the
 *      designated network end to end is clean; a through-line
 *      across unlisted residential streets flags 'offnet'.
 *  (5) LEARNING NEVER LEARNS A RESTRICTED LEG: a completed
 *      deviation screened 'flagged' plants NOTHING; screened
 *      'unknown' plants nothing; the same deviation screened
 *      'clean' plants (the guard is the screen, not a ban on
 *      learning); a flagged drive ON a learned route TAINTS
 *      it and lookup never offers it again; with no flag the
 *      stage-1 rules run untouched.
 *  (6) THE MÉTIS CASE (his pair-shape, Nov 12 11:27): the
 *      engine-shortest line runs the restricted inside road
 *      (flags); a learned legal route exists for the pair and
 *      screens clean -> learnedRouteDecision says ADOPT, the
 *      presented line is the learned one — the learned route
 *      WINS, the server is never asked. A tainted learned
 *      record yields 'none' (server routing), never adoption.
 *  (7) COVERAGE: Calgary lines judge 'in'; an Edmonton line
 *      is 'out' (the screen stays silent where it has no
 *      honest data).
 *  (8) INTEGRATION: the Navigator carries the restored v419
 *      hooks (lookup / beginTrip / pushFix / finishTrip) plus
 *      markTainted, the screen, the exclusion re-ask and the
 *      warning slot; index.html pins both files at v=433.
 * Run: node tools/nav-truck-routing-v433-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}

function loadRegion(file, beginMark, endMark) {
  const src = fs.readFileSync(file, 'utf8');
  /* the house extraction (cf. tools/navigator-test.js): from
     the comment that opens the BEGIN marker to the close of
     the comment that carries the END marker. */
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a < 0 || b < 0 || b <= a) throw new Error('region not found in ' + file);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src.slice(a, b + 2), ctx);
  return ctx;
}

const NAV = loadRegion(path.join(ROOT, 'modules/navigator.js'), 'NAVPURE-BEGIN', 'NAVPURE-END');
const NL = loadRegion(path.join(ROOT, 'js/navlearn.js'), 'NAVLEARN-BEGIN', 'NAVLEARN-END');

function densify(line, stepM) {
  const out = [line[0]];
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1];
    const d = NAV.haversineM(a, b), n = Math.max(1, Math.round(d / stepM));
    for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}
function seg(pts, type, restricted) { return { type: type || 'Unrestricted truck route', restricted: restricted || '', pts: pts }; }

/* ---------- fixtures ---------- */
/* 48 Avenue NE's eastern straight, from the shipped table. */
const REP = NAV.REPORTED_RESTRICTIONS;
const east48 = REP[0].lines[0];
/* Engine-shortest: Barlow north, then straight down 48 Ave. */
const ENGINE_LINE = densify([[51.0900, -114.0016], [51.0955, -114.0005]].concat(east48.slice(1)).concat([[51.1040, -113.9822], [51.1060, -113.9818]]), 60);
/* The layer as it really is: Barlow + 48 Ave both designated,
   48 Ave even "Unrestricted" — the ban is invisible to it. */
const LAYER_48 = [
  seg(densify([[51.0900, -114.0016], [51.0960, -113.9985]], 80)),
  seg(densify(east48, 80))
];
/* Legal corridor: Barlow -> Airport Trail -> 36 St. */
const LEGAL_LINE = [[51.0955, -114.0016], [51.0995, -114.0008], [51.1042, -113.9948], [51.1066, -113.9852], [51.1066, -113.9773]];
const LAYER_LEGAL = [seg(densify(LEGAL_LINE, 80))];

/* ---------- (1) loaded default ---------- */
console.log('\n(1) loaded-truck default');
{
  const req = NAV.buildRouteRequest([51.09, -114.0], [51.10, -113.98], NAV.navProfile(null), 'truck');
  check('default profile asks the engine for 24.3 t', req.costing_options.truck.weight === 24.3, req.costing_options.truck.weight);
  check('default costing is truck with the designated-network pull', req.costing === 'truck' && req.costing_options.truck.use_truck_route === 1.0);
  const req2 = NAV.buildRouteRequest([51.09, -114.0], [51.10, -113.98], { weight: 30 }, 'truck');
  check('an explicit saved weight still wins (vehicle record path untouched)', req2.costing_options.truck.weight === 30);
  const reqC = NAV.buildRouteRequest([51.09, -114.0], [51.10, -113.98], NAV.navProfile(null), 'car');
  check('car mode carries no truck options', reqC.costing === 'car' && !reqC.costing_options);
}

/* ---------- (2) the reported street flags ---------- */
console.log('\n(2) 48 Avenue NE through-route');
let screen48;
{
  screen48 = NAV.truckNetScreen(LAYER_48, REP, ENGINE_LINE, null);
  check('through-route down 48 Ave flags', screen48.flagged === true, screen48);
  check('worst stretch is the reported street', screen48.worst && screen48.worst.kind === 'reported' && screen48.worst.name === '48 Avenue NE', screen48.worst);
  check('reported metres are real (>1 km)', screen48.reportedM > 1000, screen48.reportedM);
  const warn = NAV.truckNetWarning(screen48);
  check('warning names the street + its 50% limit', !!warn && /48 Avenue NE/.test(warn.banner) && /50% weight limit/.test(warn.banner), warn);
  check('spoken warning says a loaded truck must not use it', !!warn && /loaded truck must not use it/i.test(warn.speak), warn);
  const ring = NAV.truckNetExclusion(ENGINE_LINE, screen48);
  check('exclusion ring builds', Array.isArray(ring) && ring.length > 8, ring && ring.length);
  check('exclusion ring is closed ([lon,lat])', !!ring && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]);
  let per = 0;
  for (let i = 0; i + 1 < ring.length; i++) per += NAV.haversineM([ring[i][1], ring[i][0]], [ring[i + 1][1], ring[i + 1][0]]);
  check('exclusion perimeter inside the 10,000 m engine cap', per > 0 && per < 10000, Math.round(per));
}

/* ---------- (2b) reported-only pass (no fetched data) ---------- */
console.log('\n(2b) reported table flags with NO layer at all');
{
  const repOnly = NAV.truckNetScreen(null, REP, ENGINE_LINE, null, { reportedOnly: true });
  check('reported-only screen of the 48 Ave line flags', repOnly.flagged && repOnly.worst.kind === 'reported', repOnly.worst);
  const repLegal = NAV.truckNetScreen(null, REP, densify(LEGAL_LINE, 40), null, { reportedOnly: true });
  check('reported-only screen of the legal line does NOT flag (no off-network judgement without data)', repLegal.flagged === false, repLegal);
  const emptyLayer = NAV.truckNetScreen([], REP, densify(LEGAL_LINE, 40), null);
  check('an empty layer alone would flag off-network — which is why the runtime treats an empty fetch as unknown, never flagged', emptyLayer.flagged === true, emptyLayer.flagged);
}

/* ---------- (3) access rules ---------- */
console.log('\n(3) access: reported is never exempt, off-network access is');
{
  const tail48 = densify([[51.10575, -113.98234], [51.10365, -113.98251], [51.10256, -113.98259], [51.10177, -113.98285]], 40);
  const sTail = NAV.truckNetScreen(LAYER_48, REP, tail48, null);
  check('a short route ENDING on 48 Ave still flags (reported)', sTail.flagged && sTail.worst.kind === 'reported', sTail);
  const tailOff = densify([[51.1200, -114.0500], [51.1200, -114.0440]], 40);
  const sOff = NAV.truckNetScreen([], REP, tailOff, null);
  check('the same short tail off-network does NOT flag (local access)', sOff.flagged === false && sOff.offM > 0, sOff);
  const throughOff = densify([[51.1200, -114.0600], [51.1200, -114.0300]], 60);
  const sThru = NAV.truckNetScreen([], REP, throughOff, null);
  check('a through-line across unlisted streets flags offnet', sThru.flagged && sThru.worst.kind === 'offnet', sThru);
}

/* ---------- (4) legal route clean ---------- */
console.log('\n(4) designated-network route');
{
  const sLegal = NAV.truckNetScreen(LAYER_LEGAL, REP, densify(LEGAL_LINE, 40), null);
  check('a line riding the designated network screens clean', sLegal.flagged === false, sLegal);
  const plan = { maneuvers: [{ instruction: 'Head east', streets: ['Airport Trail NE'], cumStartKm: 0, cumEndKm: 3, lengthKm: 3 }] };
  const sNamed = NAV.truckNetScreen([], REP, densify([[51.1200, -114.0600], [51.1200, -114.0300]], 60), plan);
  check('off-network warning names the street from the plan', sNamed.flagged && NAV.truckNetWarning(sNamed).banner.indexOf('Airport Trail NE') >= 0, NAV.truckNetWarning(sNamed));
}

/* ---------- learning fixtures ---------- */
const OA = [51.0900, -114.0000], DB = [51.1000, -114.0000];
const SUGGESTED = densify([OA, DB], 100);
const DEVIATION = densify([OA, [51.0905, -113.9955], [51.0995, -113.9955], DB], 100);
function driveFor(trace, suggested, extra) {
  const a = NL.nlAssessDrive(trace, suggested, DB);
  return Object.assign({
    pairKey: NL.nlPairKey(OA, DB), origin: OA, dest: DB, destLabel: 'the dump',
    trace: trace, durationSec: 600, onLearned: false, now: 1000000, assessment: a
  }, extra || {});
}

/* ---------- (5) learning guard ---------- */
console.log('\n(5) learning never learns a restricted leg');
{
  let d = NL.nlEmptyData();
  let r = NL.nlApplyDrive(d, driveFor(DEVIATION, SUGGESTED, { screenFlag: 'flagged' }));
  check("flagged deviation plants nothing (why 'restricted')", r.changed === false && r.why === 'restricted' && !NL.nlLookupIn(r.data, OA, DB), r.why);
  r = NL.nlApplyDrive(NL.nlEmptyData(), driveFor(DEVIATION, SUGGESTED, { screenFlag: 'unknown' }));
  check("unscreened deviation plants nothing (why 'unverified')", r.changed === false && r.why === 'unverified' && !NL.nlLookupIn(r.data, OA, DB), r.why);
  r = NL.nlApplyDrive(NL.nlEmptyData(), driveFor(DEVIATION, SUGGESTED, { screenFlag: 'clean' }));
  check('the same deviation screened clean DOES plant (guard = the screen)', r.changed === true && r.why === 'planted' && !!NL.nlLookupIn(r.data, OA, DB), r.why);
  r = NL.nlApplyDrive(NL.nlEmptyData(), driveFor(DEVIATION, SUGGESTED, {}));
  check('no flag at all -> stage-1 rules untouched (planted)', r.changed === true && r.why === 'planted', r.why);
  /* taint: plant, then ride it flagged */
  let planted = NL.nlApplyDrive(NL.nlEmptyData(), driveFor(DEVIATION, SUGGESTED, { screenFlag: 'clean' })).data;
  const recLine = NL.nlLookupIn(planted, OA, DB).line;
  const onL = driveFor(densify(recLine, 100), recLine, { onLearned: true, screenFlag: 'flagged' });
  onL.assessment = { completed: true, deviated: false, fracOff: 0, lengthM: 1200, endDistM: 0, points: 12 };
  r = NL.nlApplyDrive(planted, onL);
  check("a flagged drive ON a learned route taints it (why 'tainted')", r.changed === true && r.why === 'tainted' && !!r.data.routes[NL.nlPairKey(OA, DB)].tainted, r.why);
  check('a tainted record is never offered again', NL.nlLookupIn(r.data, OA, DB) === null);
  /* and a clean ride still strengthens (stage-1 pin, flag present) */
  let planted2 = NL.nlApplyDrive(NL.nlEmptyData(), driveFor(DEVIATION, SUGGESTED, { screenFlag: 'clean' })).data;
  const rec2 = NL.nlLookupIn(planted2, OA, DB);
  const onC = driveFor(densify(rec2.line, 100), rec2.line, { onLearned: true, screenFlag: 'clean' });
  onC.assessment = { completed: true, deviated: false, fracOff: 0, lengthM: 1200, endDistM: 0, points: 12 };
  r = NL.nlApplyDrive(planted2, onC);
  check("a clean drive ON a learned route still strengthens it (why 'strengthened')", r.changed === true && r.why === 'strengthened' && NL.nlLookupIn(r.data, OA, DB).count === 2, r.why);
}

/* ---------- (6) the Métis case ---------- */
console.log('\n(6) his pair: learned legal route beats the engine shortcut');
{
  const O = [51.0955, -114.0016], D = [51.1225, -113.9828];
  const METIS = densify([[51.0955, -114.0016], [51.1080, -114.0016], [51.1225, -114.0016], [51.1252, -113.9950], [51.1225, -113.9828]], 100);
  const LAYER_METIS = [seg(densify([[51.0955, -114.0016], [51.1080, -114.0016], [51.1225, -114.0016], [51.1252, -113.9950], [51.1225, -113.9828]], 80))];
  const sEngine = NAV.truckNetScreen(LAYER_48, REP, ENGINE_LINE, null);
  const sMetis = NAV.truckNetScreen(LAYER_METIS, REP, METIS, null);
  check('the engine-shortest (48 Ave) flags', sEngine.flagged === true);
  check('his driven Métis line screens clean', sMetis.flagged === false, sMetis);
  /* he drove Métis while the app suggested the inside road */
  const aM = NL.nlAssessDrive(METIS, ENGINE_LINE, D);
  check('his Métis drive reads as a completed deviation (it teaches)', aM.completed && aM.deviated, aM);
  let data = NL.nlEmptyData();
  const pk = NL.nlPairKey(O, D);
  let rM = NL.nlApplyDrive(data, { pairKey: pk, origin: O, dest: D, destLabel: 'the dump', trace: METIS, durationSec: 900, onLearned: false, now: 2000000, assessment: aM, screenFlag: 'clean' });
  check('the clean Métis drive planted the learned route', rM.changed === true && !!NL.nlLookupIn(rM.data, O, D), rM.why);
  const rec = NL.nlLookupIn(rM.data, O, D);
  const storedScreen = NAV.truckNetScreen(LAYER_METIS, REP, densify(rec.line, 40), null);
  const verdict = storedScreen.flagged ? 'flagged' : 'clean';
  const dec = NAV.learnedRouteDecision(!!rec, verdict);
  check("decision for the pair is ADOPT — the learned route is presented, the server never asked", dec === 'adopt', dec);
  check('the presented line is his learned line (not the engine line)', Math.abs(NL.nlLineLengthM(rec.line) - NL.nlLineLengthM(METIS)) / NL.nlLineLengthM(METIS) < 0.2, NL.nlLineLengthM(rec.line));
  check("a flagged learned line decides 'taint', an unscreenable one 'skip-once', none 'none'",
    NAV.learnedRouteDecision(true, 'flagged') === 'taint' &&
    NAV.learnedRouteDecision(true, 'unknown') === 'skip-once' &&
    NAV.learnedRouteDecision(false, 'clean') === 'none');
}

/* ---------- (7) coverage ---------- */
console.log('\n(7) coverage honesty');
{
  check('a Calgary line is in coverage', NAV.truckNetCoverage(LEGAL_LINE) === 'in');
  check('an Edmonton line is out of coverage', NAV.truckNetCoverage([[53.55, -113.49], [53.56, -113.48]]) === 'out');
}

/* ---------- (8) integration ---------- */
console.log('\n(8) wiring restored + pins');
{
  const nav = fs.readFileSync(path.join(ROOT, 'modules/navigator.js'), 'utf8');
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('doRoute consults NavLearn.lookup', nav.indexOf('NavLearn.lookup') >= 0);
  check('startDrive opens capture (beginTrip)', nav.indexOf('NavLearn.beginTrip') >= 0);
  check('onPos feeds capture (pushFix)', nav.indexOf('NavLearn.pushFix') >= 0);
  check('exitDrive closes capture (finishTrip)', nav.indexOf('NavLearn.finishTrip') >= 0);
  check('flagged learned adoption taints (markTainted)', nav.indexOf('NavLearn.markTainted') >= 0);
  check('server routes are screened (screenThenFinalize)', nav.indexOf('screenThenFinalize') >= 0);
  check('exclusion re-ask rides exclude_polygons', nav.indexOf('exclude_polygons') >= 0);
  check('warning has its slot on the Directions card', nav.indexOf('nv_trucknet') >= 0);
  check('index.html pins navlearn + navigator at v=433', idx.indexOf('js/navlearn.js?v=433') >= 0 && idx.indexOf('modules/navigator.js?v=433') >= 0);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
