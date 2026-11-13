#!/usr/bin/env node
/* Meticulous — NAV-ROUTE-LEARN suite (owner, Fri Nov 13, 2026:
 * "The navigator is not learning the route I usually take. I
 * have taught it a couple of times how to get to work; it
 * doesn't show me that route — it's constantly telling me to
 * take Métis Trail." His Nov 13 recording shows the whole
 * failure in one drive: the server route says "Turn left onto
 * Métis Trail", he drives his own way ("Off route,
 * rerouting"), and the drive home teaches the learner
 * NOTHING.)
 *
 * Four independent breaks, each proven against the 447 code:
 *  (a) THE SCREEN: the v433 truck-legality guard read the
 *      route screen's verdict as the LEARNING verdict. The
 *      screen flags 'offnet' stretches (>= 250 m beyond the
 *      access allowances) — ordinary legal streets that are
 *      simply not on the designated truck network. Every
 *      home->work drive runs them, so every taught drive
 *      judged 'flagged': nothing planted, nothing adopted (a
 *      planted route's own adoption screen tainted it), the
 *      server's network pull (Métis Trail) won forever. The
 *      435 law itself stands: REPORTED (48 Ave class) and
 *      RESTRICTED stretches still block and taint.
 *  (b) THE KEY: pairs matched by ~150 m cell only — the same
 *      home->work pair is a different pair when a drive starts
 *      a street over or the route is requested after pulling
 *      out of the driveway.
 *  (c) THE TRIP-KILL: leaving a learned route nulled the
 *      trip's reference line, so the drive could neither
 *      strengthen the record nor teach the way actually
 *      driven.
 *  (d) THE END: completion demanded the trace end within
 *      250 m of the pin; a big yard's gate sits further.
 * (Plus the store: nlSave swallowed refused writes whole —
 * structural pin (6.3).)
 *
 * Loads the REAL NAVPURE region of modules/navigator.js and
 * the REAL NAVLEARN region of js/navlearn.js into vm worlds.
 * Run: node tools/nav-route-learn-v448-test.js
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

const navSrc = read('modules/navigator.js');
const nlSrc = read('js/navlearn.js');
const npWorld = {};
vm.createContext(npWorld);
vm.runInContext(extract(navSrc, 'NAVPURE-BEGIN', 'NAVPURE-END') +
  '\n;this.__np = { learnVerdictFromScreen: learnVerdictFromScreen, learnedRouteDecision: learnedRouteDecision, truckNetScreen: truckNetScreen };', npWorld);
const NP = npWorld.__np;
const nlWorld = {};
vm.createContext(nlWorld);
vm.runInContext(extract(nlSrc, 'NAVLEARN-BEGIN', 'NAVLEARN-END') +
  '\n;this.__nl = { assessDrive: nlAssessDrive, applyDrive: nlApplyDrive, lookupIn: nlLookupIn, findRecord: nlFindRecord, pairKeyFor: nlPairKey, emptyData: nlEmptyData };', nlWorld);
const NL = nlWorld.__nl;

/* ---- geometry builders (the stage-1 suite's shapes) ---- */
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
const HOME = [51.15710, -113.93862];        /* Cornerstone Blvd NE */
const WORK = [51.1252222, -113.9828056];    /* the Nov 13 destination pin */
const EAST = 0.00429;                        /* ~300 m */
const serverLine = pathThrough([HOME, [51.14100, -113.97000], WORK], 120);       /* the router's way (Métis pull) */
const hisWay = pathThrough([HOME, [HOME[0], HOME[1] + EAST], [WORK[0], WORK[1] + EAST], WORK], 120); /* his way: east first, parallel, west in */
const pairKey = NL.pairKeyFor(HOME, WORK);

function driveObj(trace, suggested, onLearned, flag, now) {
  return {
    pairKey: pairKey, origin: trace[0], dest: WORK, destLabel: 'Aecon Trans',
    trace: trace, durationSec: 600, onLearned: onLearned, now: now || 1000000,
    screenFlag: flag, assessment: NL.assessDrive(trace, suggested, WORK)
  };
}

/* ---- (1) the learning verdict: offnet is legal ---- */
const OFFNET = { stretches: [{ kind: 'offnet', fromKm: 0.7, toKm: 2.9 }], viaNames: [], longestOffnetM: 2200, longestReportedM: 0, longestRestrictedM: 0 };
const REPORTED = { stretches: [{ kind: 'reported', fromKm: 1.0, toKm: 1.2 }], viaNames: ['48 Avenue NE'], longestOffnetM: 0, longestReportedM: 200, longestRestrictedM: 0 };
const RESTRICTED = { stretches: [{ kind: 'restricted', fromKm: 0.5, toKm: 0.9 }], viaNames: [], longestOffnetM: 0, longestReportedM: 0, longestRestrictedM: 400 };
const MIXED = { stretches: [{ kind: 'offnet', fromKm: 0.2, toKm: 1.0 }, { kind: 'reported', fromKm: 2.0, toKm: 2.2 }], viaNames: [], longestOffnetM: 800, longestReportedM: 200, longestRestrictedM: 0 };
check('(1.1) an off-network-only screen is CLEAN for learning', NP.learnVerdictFromScreen(OFFNET) === 'clean');
check('(1.2) a reported stretch still FLAGS learning', NP.learnVerdictFromScreen(REPORTED) === 'flagged');
check('(1.3) a restricted stretch still FLAGS learning', NP.learnVerdictFromScreen(RESTRICTED) === 'flagged');
check('(1.4) offnet + reported FLAGS (the 435 law is not diluted)', NP.learnVerdictFromScreen(MIXED) === 'flagged');
check('(1.5) no screen -> unknown', NP.learnVerdictFromScreen(null) === 'unknown' && NP.learnVerdictFromScreen({}) === 'unknown');
check('(1.6) the adoption decision on the mapped verdict: clean adopts, flagged taints',
  NP.learnedRouteDecision(true, NP.learnVerdictFromScreen(OFFNET)) === 'adopt' &&
  NP.learnedRouteDecision(true, NP.learnVerdictFromScreen(REPORTED)) === 'taint');

/* ---- (2) the teach: his driven way plants under the mapped flag ---- */
let data = NL.emptyData();
const d1 = driveObj(hisWay, serverLine, false, NP.learnVerdictFromScreen(OFFNET), 1000000);
check('(2.0) his drive deviated from the server line (the Métis story)', d1.assessment.deviated === true && d1.assessment.completed === true, JSON.stringify(d1.assessment));
const r1 = NL.applyDrive(data, d1);
data = r1.data;
check('(2.1) taught drive #1 PLANTS (was: blocked as truck-illegal)', r1.why === 'planted', r1.why);
const rec1 = NL.lookupIn(data, HOME, WORK);
check('(2.2) the pair now has a learned route', !!rec1 && rec1.line.length > 5);
const d2 = driveObj(hisWay, rec1 ? rec1.line : serverLine, true, 'clean', 1001000);
const r2 = NL.applyDrive(data, d2);
data = r2.data;
check('(2.3) riding the learned route STRENGTHENS it, line untouched', r2.why === 'strengthened' && NL.lookupIn(data, HOME, WORK).count === 2, r2.why);

/* ---- (3) the pairing: a street over is the same pair ---- */
const HOME_OVER = [HOME[0] + 0.0018, HOME[1] + 0.0025];   /* ~250 m away — a neighbouring cell */
check('(3.0) the shifted origin really is a different cell key', NL.pairKeyFor(HOME_OVER, WORK) !== pairKey);
const recOver = NL.lookupIn(data, HOME_OVER, WORK);
check('(3.1) lookup from a neighbouring cell FINDS the pair (was: miss)', !!recOver);
check('(3.2) the found key rides the record for a correct taint', !!recOver && recOver.__foundKey === pairKey, recOver && recOver.__foundKey);
check('(3.3) a genuinely different pair (600 m+ away) still misses',
  NL.lookupIn(data, [HOME[0] + 0.006, HOME[1] + 0.008], WORK) === null);

/* ---- (4) leaving a learned route re-teaches the driven way ---- */
const hisWay2 = pathThrough([HOME, [HOME[0] - 0.004, HOME[1] + EAST], [WORK[0] - 0.002, WORK[1] + EAST], WORK], 120);
const d3 = driveObj(hisWay2, rec1.line, true, 'clean', 1002000);
check('(4.0) the second way deviates from the learned line', d3.assessment.deviated === true, JSON.stringify(d3.assessment));
const before = JSON.stringify(NL.lookupIn(data, HOME, WORK).line);
const r3 = NL.applyDrive(data, d3);
data = r3.data;
check('(4.1) on-learned + deviated REPLACES the learned line (was: strengthened blind / unjudgeable)',
  (r3.why === 'refreshed' || r3.why === 'planted') && JSON.stringify(NL.lookupIn(data, HOME, WORK).line) !== before, r3.why);

/* ---- (5) taint integrity under the new mapping ---- */
const dBad = driveObj(hisWay, NL.lookupIn(data, HOME, WORK).line, true, NP.learnVerdictFromScreen(REPORTED), 1003000);
const r4 = NL.applyDrive(data, dBad);
data = r4.data;
check('(5.1) a learned record ridden over a reported street TAINTS', r4.why === 'tainted', r4.why);
check('(5.2) a tainted record is never offered again', NL.lookupIn(data, HOME, WORK) === null);

/* ---- (6) the completion radius: the yard gate ---- */
const traceShort = pathThrough([WORK, [WORK[0] + 0.0027, WORK[1]]], 60);   /* ends ~300 m short of the pin */
const shortDriveLine = pathThrough([HOME, WORK], 120);
const aShort = NL.assessDrive(pathThrough([HOME, [WORK[0] + 0.0027, WORK[1]]], 120), shortDriveLine, WORK);
check('(6.1) a drive ending ~300 m from the pin COMPLETES (yard gate; was: incomplete at 250 m)', aShort.completed === true, JSON.stringify(aShort));
const aFar = NL.assessDrive(pathThrough([HOME, [WORK[0] + 0.0063, WORK[1]]], 120), shortDriveLine, WORK);
check('(6.2) a drive ending ~700 m short does NOT complete', aFar.completed === false, JSON.stringify(aFar));

/* ---- (7) structural pins ---- */
check('(7.1) doRoute maps the adoption verdict through learnVerdictFromScreen',
  navSrc.indexOf("if (lverdict === 'flagged' && learnVerdictFromScreen(lres.screen) !== 'flagged') lverdict = 'clean';") !== -1);
check('(7.2) doRoute taints by the offered record key',
  navSrc.indexOf('NavLearn.markTainted(lbuilt0.key || NavLearn.pairKeyFor(S.pos, S.dest)') !== -1);
check('(7.3) exitDrive maps the teach flag through learnVerdictFromScreen',
  navSrc.indexOf("if (lflag448 === 'flagged' && learnVerdictFromScreen(tres.screen) !== 'flagged') lflag448 = 'clean';") !== -1);
check('(7.4) the trip-kill is gone: leaving a learned route no longer nulls the reference',
  navSrc.indexOf('S.learnTrip.suggested = null') === -1 && navSrc.indexOf('S.learnTrip.onLearned = false') === -1);
check('(7.5) suppression still spends the learned route for the drive',
  navSrc.indexOf('S.learnSuppressDest = NavLearn.destCellOf(S.dest)') !== -1);
check('(7.6) navlearn saves are VERIFIED (read-back) with a session truth on refusal',
  nlSrc.indexOf('nlMem = ok ? null : d') !== -1 && nlSrc.indexOf('back.routes') !== -1);
check('(7.7) the WARNING path keeps the full screen (truckNetWarning untouched by the mapping)',
  navSrc.indexOf('S.pendingNetWarn = truckNetWarning(res.screen)') !== -1);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
