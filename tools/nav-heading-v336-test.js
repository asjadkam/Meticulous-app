'use strict';
/*
 * nav-heading-v336-test.js — NAV-TRUCK-POINTING-WRONG-WAY
 * (owner, Nov 4, 2026, 09:04): "The truck is not always
 * pointing the right way where the drive is going."
 *
 * Root: onPos took the GPS course RAW at any speed. A course
 * is honest at speed and noise at a crawl — it can sit flipped
 * ~180° against travel through whole minutes of creep, and
 * heading-up rotates the map (the truck's pointing) with it.
 * The movement-derived bearing had a 10 m gate but only ran
 * when the GPS sent NO heading at all.
 *
 * v336: pickHeading (NAVPURE) decides per fix — at speed
 * (>= 3 m/s) the GPS course wins; crawling, a derived bearing
 * from >= 10 m of actual movement outranks the course; with
 * neither, the last believed heading stands.
 *
 * THEN: webVersion is 336 + the index navigator tag.
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

function extract(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error('markers missing');
  return src.slice(i, j + b.length);
}
const sb = { console: console, Math: Math };
vm.createContext(sb);
vm.runInContext(extract(navSrc, '/* ================= NAVPURE-BEGIN =================', '/* ================= NAVPURE-END ================= */'), sb);
const pickHeading = sb.pickHeading;
ok('pickHeading is in NAVPURE', typeof pickHeading === 'function');

/* the trust table (prev, gps, speed, derived) */
eq('at speed the GPS course wins over everything', pickHeading(10, 200, 25, 30), 200);
eq('at speed with no GPS, the derived bearing rules', pickHeading(10, null, 25, 30), 30);
eq('CRAWLING: a flipped GPS course loses to the movement bearing', pickHeading(90, 270, 1.2, 92), 92);
eq('crawling with no movement: the flipped course is ignored, prev stands', pickHeading(90, 270, 0.8, null), 90);
eq('parked: course noise changes nothing', pickHeading(90, 5, 0, null), 90);
eq('cold start takes the GPS course even at a crawl', pickHeading(null, 270, 1.0, null), 270);
eq('cold start with only a derived bearing takes it', pickHeading(null, null, 0, 123), 123);
eq('nothing anywhere → still nothing (no invented heading)', pickHeading(null, null, null, null), null);
eq('a heading is normalised into 0..360', pickHeading(null, 370, 10, null), 10);
eq('a negative heading is normalised', pickHeading(null, -90, 10, null), 270);
eq('unknown speed with a GPS course believes the course', pickHeading(45, 200, null, null), 200);
eq('unknown speed, no course, derived present → derived', pickHeading(45, null, null, 60), 60);

/* the incident replayed: highway north (course honest), then
   a traffic crawl where the course flips — the believed
   heading must never flip with it. */
{
  let h = null;
  h = pickHeading(h, 0, 25, null);            // highway, heading north
  h = pickHeading(h, 2, 24, 1);               // still highway
  eq('highway: believed heading is north', h, 2);
  h = pickHeading(h, 178, 1.1, null);         // crawl begins; course flips, no 10 m move yet
  eq('crawl flip with no movement: heading held', h, 2);
  h = pickHeading(h, 182, 1.4, 4);            // 10 m of real movement north — derived speaks
  eq('crawl with real movement: derived (north) wins over the flipped course', h, 4);
  h = pickHeading(h, 359, 12, 358);           // traffic clears, speed back — course rules again
  eq('back at speed the course rules again', h, 359);
}

/* the wiring */
ok('onPos picks through pickHeading with the derived bearing',
  navSrc.indexOf('pickHeading(S.heading,') >= 0 && navSrc.indexOf('var derivedH = (prevPos && haversineM(prevPos, S.pos) >= 10)') >= 0);
ok('the raw take is gone', navSrc.indexOf('if (heading !== null && heading !== undefined && isFinite(heading)) S.heading = heading;') === -1);
ok('webVersion is 336', ver.webVersion === 336, 'got ' + ver.webVersion);
ok('index.html pins navigator.js?v=336', idxSrc.indexOf('modules/navigator.js?v=336') >= 0);

console.log('\nnav-heading-v336 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
