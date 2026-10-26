#!/usr/bin/env node
/* Meticulous v264 — NAV-LANE-INSET-EMPTY suite.
 *
 * The owner's verdict, Mon Oct 26, 2026 08:23 MDT, testing the
 * GPS on his drive in: "the card that pops up before the turns
 * still isn't give me any useable information.... Any lanes or
 * anything else."
 *
 * DIAGNOSIS (live probes, Oct 26, against his own server +
 * OpenStreetMap itself — fixtures in nav-lane-v264-fixtures.json
 * are the server's real answers for his site -> home route):
 *
 * (1) DATA — the native Valhalla response carries NO lane data
 *     at any level: four corridor routes probed the way the app
 *     asks (Deerfoot / Stoney / 16 Ave / Glenmore / Peigan),
 *     every maneuver key enumerated — no lane fields, and his
 *     Valhalla 3.9.1 has no config that adds them (checked
 *     valhalla-config.json). But the SAME server asked for the
 *     SAME route with "format":"osrm" returns intersections
 *     with real per-lane indications and the server's own
 *     valid flags (79 laned intersections over the 4 routes).
 * (2) DATA DROPPED — the response DOES carry `sign` blocks
 *     (17 of 58 maneuvers: EXIT 258, 68, 88, 246-245, 234B,
 *     branch + toward), and maneuverPlan threw the whole
 *     object away, so the card could never show an exit
 *     number, the road taken, or where it points.
 * (3) THE OVERPASS FALLBACK COULD NOT FIRE — pickTurnLanes
 *     read ONLY turn:lanes:forward. Direct OSM reads of his
 *     junctions (OSM API bboxes at Deerfoot/16 Ave and
 *     Peigan/Barlow) show Calgary tags plain `turn:lanes` on
 *     one-way carriageways and essentially never the :forward
 *     form (Deerfoot Tr NE: through|through|through;right|
 *     right). Add the public Overpass endpoints' routine
 *     rate-limiting (both answered 429 to a gentle sequential
 *     probe today) and the strip was absent all day, every day.
 *
 * THE FIX pinned below:
 *   - maneuverPlan keeps the sign block (maneuverSign);
 *     sanitizeTruckPlan carries it through; insetSignOf
 *     shapes it for the card (EXIT chip data + branch/toward).
 *   - The adopted route request is replayed once against the
 *     owner's own server in OSRM format (fetchServerLanes);
 *     osrmLaneData reads the laned intersections and
 *     matchServerLanes pins them to maneuvers (<=75 m of the
 *     turn point); the pop-up prefers them — with the server's
 *     valid flags deciding which lanes burn (laneArrowsHtml's
 *     third argument) — and keeps the Overpass cache as the
 *     fallback for uncovered turns.
 *   - pickTurnLanes widened honestly: turn:lanes:forward read
 *     wherever it stands (the suffix IS the forward lanes),
 *     plain turn:lanes read on one-way ways (every lane there
 *     is the driver's, in travel order). Plain turn:lanes on a
 *     two-way way still answers nothing.
 *
 * Run: node tools/nav-lane-inset-v264-test.js
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
const css = read('css/style.css');
const fx = JSON.parse(read('tools/nav-lane-v264-fixtures.json'));
const sb = { console: console };
vm.createContext(sb);
vm.runInContext(extract(navSrc, 'NAVPURE-BEGIN', 'NAVPURE-END'), sb);

console.log('— v264: sign data rides the plan (real server fixture) —');
const plan = sb.maneuverPlan(fx.native);
eq('the fixture route flattens to 11 maneuvers', plan.maneuvers.length, 11);
eq('exit 258 maneuver carries its sign',
  plan.maneuvers[1].sign,
  { exit: '258', branch: ['16 Avenue North'], toward: ['1', 'Banff', 'Medicine Hat'] });
eq('exit 68 maneuver carries its number',
  plan.maneuvers[4].sign.exit, '68');
eq('a plain drive maneuver has no sign', plan.maneuvers[0].sign, null);
eq('5 of 11 maneuvers on this corridor carry a sign',
  plan.maneuvers.filter((m) => !!m.sign).length, 5);
const san = sb.sanitizeTruckPlan(JSON.parse(JSON.stringify(plan)));
eq('sanitizeTruckPlan carries the sign through its copies',
  san.maneuvers[1].sign, plan.maneuvers[1].sign);
eq('insetSignOf shapes the card lines',
  sb.insetSignOf(plan.maneuvers[1]),
  { exit: '258', branchText: '16 Avenue North', towardText: '1 · Banff · Medicine Hat' });
eq('insetSignOf answers null where no sign exists',
  sb.insetSignOf(plan.maneuvers[0]), null);
eq('adjacent duplicate sign texts collapse',
  sb.maneuverSign({ exit_branch_elements: [{ text: '16 Avenue North', consecutive_count: 2 }, { text: '16 Avenue North' }, { text: '1 East' }] }),
  { exit: '', branch: ['16 Avenue North', '1 East'], toward: [] });
eq('an empty sign object answers null', sb.maneuverSign({}), null);

console.log('— v264: server lanes (real OSRM fixture, same route) —');
const laned = sb.osrmLaneData(fx.osrm);
eq('the OSRM answer yields its 24 laned intersections', laned.length, 24);
eq('first laned intersection reads in app tokens',
  laned[0].turn, [['through'], ['through'], ['through'], ['slight_right']]);
eq('first laned intersection keeps the server valid flags',
  laned[0].valid, [true, true, true, false]);
const line = sb.decodeShape(fx.native.legs[0].shape);
const matched = sb.matchServerLanes(laned, line, plan);
eq('server lanes pin to maneuvers 0, 1, 3, 4 on this route',
  Object.keys(matched).map(Number).sort((a, b) => a - b), [0, 1, 3, 4]);
eq('the exit-258 approach: the two RIGHT lanes are the valid ones',
  matched[0].valid, [false, false, true, true]);
eq('the exit-258 approach lanes are the real Deerfoot tagging',
  matched[0].turn, [['through'], ['through'], ['through', 'right'], ['right']]);
const html0 = sb.laneGuidanceHtml(matched[0], 30);
ok('the strip for the exit lights exactly the valid lanes',
  (html0.match(/nv-lane on/g) || []).length === 2 &&
  html0.indexOf('nv-lane on') > html0.indexOf('nv-lane nv-lane-arrows'));
const htmlValid = sb.laneGuidanceHtml({ turn: [['left'], ['through']], valid: [true, false] }, 90);
ok('a server valid flag wins over the geometry guess (right turn, left lane lit)',
  htmlValid.indexOf('nv-lane on') !== -1 &&
  htmlValid.indexOf('nv-lane on') < htmlValid.indexOf('nv-lane nv-lane-arrows'));
eq('no laned intersections -> no pins (honest absence)',
  sb.matchServerLanes([], line, plan), {});

console.log('— v264: pickTurnLanes — the keys his roads actually carry —');
const el = (tags) => ({ tags: tags });
eq('Deerfoot Tr NE as OSM really tags it (plain turn:lanes, one-way motorway)',
  sb.pickTurnLanes([el({ name: 'Deerfoot Trail NE', highway: 'motorway', oneway: 'yes', lanes: '4', 'turn:lanes': 'through|through|through;right|right' })], 'Deerfoot Trail NE'),
  [['through'], ['through'], ['through', 'right'], ['right']]);
eq('Barlow Tr as OSM really tags it — lanes count contradicts the strip, distrusted',
  sb.pickTurnLanes([el({ name: 'Barlow Trail SE', highway: 'primary', oneway: 'yes', lanes: '2', 'turn:lanes': 'left|through|through' })], 'Barlow Trail SE'),
  null);
eq('a leading empty slot (real motorway_link tagging) rejects the value whole',
  sb.pickTurnLanes([el({ highway: 'motorway_link', oneway: 'yes', lanes: '2', 'turn:lanes': '|through;slight_right' })], ''),
  null);
eq('plain turn:lanes on a two-way way still answers nothing',
  sb.pickTurnLanes([el({ oneway: 'no', 'turn:lanes': 'left|through' })], ''), null);
eq(':forward preferred over plain when both stand on a one-way way',
  sb.pickTurnLanes([el({ oneway: 'yes', 'turn:lanes': 'left|left', 'turn:lanes:forward': 'through|right' })], ''),
  [['through'], ['right']]);

console.log('— v264: wiring —');
ok('maneuverPlan reads m.sign', navSrc.indexOf('sign: maneuverSign(m.sign)') !== -1);
ok('sanitize carries sign', navSrc.indexOf('sign: m.sign || null') !== -1);
ok('the adopted request is replayed in OSRM format for lanes',
  navSrc.indexOf("body2.format = 'osrm'") !== -1 &&
  navSrc.indexOf('fetchServerLanes(reqBody, line, plan)') !== -1);
ok('the adopting call site passes its request body',
  navSrc.indexOf('finalizeRoute(line, plan, reqBody);') !== -1);
ok('a new route resets the server-lane set',
  navSrc.indexOf('S.serverLanes = {};') !== -1);
ok('the pop-up prefers server lanes, Overpass cache the fallback',
  navSrc.indexOf('var laneData = (S.serverLanes && S.serverLanes[dp.idx]) ||') !== -1 &&
  navSrc.indexOf('(S.laneByTurn ? S.laneByTurn[dp.idx] : null);') !== -1);
ok('the pop-up paints the sign block under the header',
  navSrc.indexOf("'<div class=\"nv-inset-sign\">'") !== -1 &&
  navSrc.indexOf('nv-inset-exit') !== -1 && navSrc.indexOf('toward ') !== -1);
ok('the sign-block CSS exists (green EXIT chip + two lines)',
  css.indexOf('.nv-inset-sign{') !== -1 && css.indexOf('.nv-inset-exit{') !== -1 &&
  css.indexOf('#1e7d32') !== -1);

console.log('\nnav-lane-inset-v264: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
