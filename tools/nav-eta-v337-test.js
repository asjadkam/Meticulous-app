'use strict';
/*
 * nav-eta-v337-test.js — NAV-ETA (owner's Nov 4 drive):
 *  (a) arrival was NEVER declared — parked at the airport
 *      site, 0 km/h, the bar still read "140 m left · 8 min"
 *      to the end of the recording;
 *  (b) the ETA jumped — arrival 8:50 -> 8:54 while the
 *      distance FELL (Stoney Trail), and 10 min -> 16 min
 *      while barely moving (clip 2).
 *
 * (a) The standing arrival triggers (<=30 m of route left on
 *     the line, or <40 m to the pin in the final stretch) can
 *     never fire at a yard: the truck leaves the drawn line at
 *     the gate, the along-projection freezes with 100+ m
 *     "left", and it parks >40 m from the pin. v337 adds the
 *     parked-at-the-site shape (NAVPURE parkedArrivalOk + a
 *     20 s dwell in trackProgress): stopped (<0.5 m/s) within
 *     150 m of the pin with <=300 m of route left, sustained
 *     20 s, declares arrival. The Oct 17 highway pass-by fails
 *     every gate (fast, kilometres left).
 * (b) The tick's estimate switches wholesale between
 *     estimators (blend / provider / blend) and each switch
 *     teleported the arrival clock. v337 slew-limits the
 *     SHOWN eta (NAVPURE etaSlew, 0.1 min per second) and
 *     resets the limiter on a new plan.
 *
 * THEN: webVersion is 337 + the index navigator tag.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const navSrc = read('modules/navigator.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) { ok(name, got === want, 'got ' + got + ', want ' + want); }
function approx(name, got, want, tol) { ok(name, Math.abs(got - want) <= tol, 'got ' + got + ', want ~' + want); }

function extract(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error('markers missing');
  return src.slice(i, j + b.length);
}
const sb = { console: console, Math: Math };
vm.createContext(sb);
vm.runInContext(extract(navSrc, '/* ================= NAVPURE-BEGIN =================', '/* ================= NAVPURE-END ================= */'), sb);
const parkedArrivalOk = sb.parkedArrivalOk;
const etaSlew = sb.etaSlew;
ok('both helpers are in NAVPURE', typeof parkedArrivalOk === 'function' && typeof etaSlew === 'function');

/* — the parked-at-the-site gates — */
eq('parked at the site: arrival shape holds', parkedArrivalOk(120, 140, 0), true);
eq('parked deep in a yard (145 m from the pin)', parkedArrivalOk(145, 290, 0.2), true);
eq('an unknown speed reads as stopped only inside the gates', parkedArrivalOk(100, 200, null), true);
eq('still rolling at 2 m/s: NOT arrival', parkedArrivalOk(120, 140, 2), false);
eq('highway pass-by (30 m from the pin, 2.4 km left): NOT arrival', parkedArrivalOk(30, 2400, 25), false);
eq('stopped but 400 m of route left: NOT yet', parkedArrivalOk(120, 400, 0), false);
eq('stopped 200 m from the pin: outside the radius', parkedArrivalOk(200, 140, 0), false);
eq('the old atPin shape still works through its own trigger (sanity: gates are additive)',
  parkedArrivalOk(39, 240, 0), true);

/* — the slew — */
eq('first paint takes the target whole', etaSlew(null, 12, 1000), 12);
approx('a +4 min estimator jump moves the shown eta by one tick of slew (0.1)', etaSlew(10, 14, 1000), 10.1, 1e-9);
approx('a -6 min jump likewise drifts, never teleports', etaSlew(16, 10, 1000), 15.9, 1e-9);
eq('within one step, the shown eta lands exactly', etaSlew(10, 10.05, 1000), 10.05);
approx('a long stall converges by at most the 2 min cap', etaSlew(10, 30, 60000), 12, 1e-9);
{
  /* the Stoney replay: target jumps +4 and holds — the shown
     value must take ~40 s to arrive, moving every tick */
  let shown = 10; const target = 14; let mono = true; let prev = shown;
  for (let t = 0; t < 45; t++) { shown = etaSlew(shown, target, 1000); if (shown < prev - 1e-9) mono = false; prev = shown; }
  ok('the +4 jump converges monotonically', mono);
  approx('and lands on the target in ~40 s', shown, 14, 0.05);
}

/* — wiring — */
ok('trackProgress runs the parked shape with a 20 s dwell on the plan',
  navSrc.indexOf('parkedArrivalOk(dDest, leftAlongM, S.speed)') >= 0 &&
  navSrc.indexOf('Date.now() - S.parkSpellAt >= 20000') >= 0 &&
  navSrc.indexOf('if (atDoor || atPin || parkedArr)') >= 0);
ok('the standing triggers are untouched', navSrc.indexOf('var atDoor = pr.dist <= 60 && leftAlongM <= 30;') >= 0 &&
  navSrc.indexOf('var atPin = dDest < 40 && leftAlongM <= 250;') >= 0);
ok('both ETA paints use the slewed value',
  navSrc.indexOf('fmtClock(new Date(Date.now() + shownEtaMin * 60000))') >= 0 &&
  navSrc.indexOf("fmtMin(shownEtaMin)") >= 0 &&
  navSrc.indexOf('fmtMin(liveEtaMin)') === -1);
ok('a new plan resets the limiter', navSrc.indexOf('S.drive.etaPlan !== S.plan') >= 0);
ok('webVersion is 337', ver.webVersion === 337, 'got ' + ver.webVersion);
ok('index.html pins navigator.js?v=337', idxSrc.indexOf('modules/navigator.js?v=337') >= 0);

console.log('\nnav-eta-v337 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
