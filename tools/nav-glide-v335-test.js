'use strict';
/*
 * nav-glide-v335-test.js — NAV-GPS-STEPPING-NOT-SMOOTH (owner,
 * Nov 4, 2026, 09:02): "Gps still moving like it's taking steps
 * Not in a smooth buttery way." Frame review: the camera
 * re-frames in discrete steps; two markers ride ~300–400 m
 * apart (the raw cursor up-route, the truck trailing).
 *
 * Root shape: fixes land ~1 Hz. The v300 animator eased toward
 * an aim extrapolated a FIXED 1.2 s ahead of the LAST fix, and
 * the rAF loop DIED whenever the gap closed — so each fix
 * produced an ease-burst, then a dead wait for the next fix:
 * motion in steps at any steady speed.
 *
 * v335: the aim is glideAim (NAVPURE) — the truck's position
 * advanced along its heading by speed × (fix age + 1.2 s
 * lead), total advance capped at 45 m, age capped at 2.5 s —
 * and the animator stays alive while the truck is moving on a
 * live stream (<3 s since the last fix), so the aim advances
 * continuously between fixes. Parked, free-look, or a quiet
 * stream still lets the loop die.
 *
 * THEN: webVersion is 335 + the index navigator tag.
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
function approx(name, got, want, tol) { ok(name, Math.abs(got - want) <= tol, 'got ' + got + ', want ~' + want); }

function extract(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error('markers missing');
  return src.slice(i, j + b.length);
}
const sb = { console: console, Math: Math };
vm.createContext(sb);
vm.runInContext(extract(navSrc, '/* ================= NAVPURE-BEGIN =================', '/* ================= NAVPURE-END ================= */'), sb);
const glideAim = sb.glideAim;
ok('glideAim is in NAVPURE', typeof glideAim === 'function');

const P = [51.05, -114.06];
function distM(a, b) {
  const kx = 111320 * Math.cos(a[0] * Math.PI / 180), ky = 110540;
  return Math.hypot((b[0] - a[0]) * ky, (b[1] - a[1]) * kx);
}

/* the aim math */
eq0: {
  const still = glideAim(P, 90, 0, 900);
  ok('a stopped truck aims at itself', still === P);
  const noH = glideAim(P, null, 25, 900);
  ok('no heading → aims at itself', noH === P);
  const fresh = glideAim(P, 0, 25, 0);
  approx('a fresh fix leads by 1.2 s (30 m at 25 m/s)', distM(P, fresh), 30, 0.6);
  ok('heading 0 advances latitude only', Math.abs(fresh[1] - P[1]) < 1e-9 && fresh[0] > P[0]);
  const aged = glideAim(P, 0, 25, 1000);
  approx('a 1 s-old fix advances age + lead (55 → capped 45 m)', distM(P, aged), 45, 0.6);
  const east = glideAim(P, 90, 10, 0);
  approx('heading 90 advances longitude only (12 m)', distM(P, east), 12, 0.4);
  ok('east leaves latitude alone', Math.abs(east[0] - P[0]) < 1e-9 && east[1] > P[1]);
  const stale = glideAim(P, 0, 25, 60000);
  approx('a stale fix stops advancing (age cap → same 45 m cap)', distM(P, stale), 45, 0.6);
  const young = glideAim(P, 0, 10, 500);
  approx('a young fix at city speed advances 17 m', distM(P, young), 17, 0.5);
  /* continuity: the aim moves MONOTONICALLY with age — no step */
  let mono = true, prev = -1;
  for (let age = 0; age <= 2000; age += 100) {
    const d = distM(P, glideAim(P, 0, 15, age));
    if (d < prev - 1e-9) mono = false;
    prev = d;
  }
  ok('the aim advances monotonically with fix age (the anti-step property)', mono);
}

/* the wiring */
ok('driveAnim aims through glideAim on the fix age',
  navSrc.indexOf('glideAim(S.pos, aimH, S.speed, Date.now() - (S.lastFixAt || Date.now()))') >= 0);
ok('the v300 fixed-lead block is gone',
  navSrc.indexOf('Math.min((S.speed || 0) * 1.2, 30)') === -1);
ok('the animator stays alive while moving on a live stream',
  navSrc.indexOf("(S.speed || 0) > 1 &&") >= 0 && navSrc.indexOf('Date.now() - S.lastFixAt < 3000') >= 0);
ok('free-look still lets the loop die', navSrc.indexOf('!S.driveFree && (S.speed || 0) > 1') >= 0);
ok('webVersion is 335', ver.webVersion === 335, 'got ' + ver.webVersion);
ok('index.html pins navigator.js?v=335', idxSrc.indexOf('modules/navigator.js?v=335') >= 0);

console.log('\nnav-glide-v335 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
