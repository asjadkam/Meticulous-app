#!/usr/bin/env node
/* Meticulous v196 — NAV-LANES suite.
 *
 * The owner's live drive video, Oct 21, 2026 08:09 MDT: "the
 * drive view shows NO lane guidance — nothing tells the
 * driver which lane to be in for the next turn." The route
 * response carries NO lane data — verified against the live
 * server the same morning (13 maneuvers, zero lane fields)
 * and already on record in BUGS.md. What honestly exists:
 * OpenStreetMap's `lanes` tag on the approach road, read
 * lazily via Overpass as a turn nears (3 km out, once per
 * maneuver per route, the v179 lazy pattern), and the turn's
 * own geometry for WHICH lane (right turn -> rightmost,
 * left -> leftmost, straight -> all continue). Where OSM
 * carries no lane count for a road, there is NO strip —
 * honest absence, never an invented lane (v178's rule).
 * NAMED LIMITATIONS: marked multi-lane turns (OSM
 * `turn:lanes`) are not read; the route lane is derived
 * from the turn direction alone.
 *
 * Run: node tools/nav-lanes-v196-test.js
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
const sb = { console: console };
vm.createContext(sb);
vm.runInContext(extract(navSrc, 'NAVPURE-BEGIN', 'NAVPURE-END'), sb);

console.log('— v196: wiring pins —');
ok('pickLaneCount is NAVPURE', typeof sb.pickLaneCount === 'function');
ok('laneStripHtml is NAVPURE', typeof sb.laneStripHtml === 'function');
ok('the tick warms the lookup 3 km out',
  navSrc.indexOf('if (dp.next && dp.toTurnM <= 3000) fetchLaneCount(dp.idx);') !== -1);
ok('the fetcher reads Overpass for the lanes tag',
  navSrc.indexOf('https://overpass-api.de/api/interpreter') !== -1 &&
  navSrc.indexOf('["highway"]["lanes"]') !== -1);
ok('the fetcher chooses via pickLaneCount',
  navSrc.indexOf('pickLaneCount(j.elements, street)') !== -1);
ok('a new route resets the lane cache',
  navSrc.indexOf('S.laneByTurn = {}; S.laneFetch = {};') !== -1);
ok('the pop-up paints the strip between junction and header',
  navSrc.indexOf("laneStripHtml(S.laneByTurn ? S.laneByTurn[dp.idx] : 0, dDeg) +") !== -1);
ok('the strip CSS exists', css.indexOf('.nv-inset-lanes{') !== -1 && css.indexOf('.nv-lane.on{') !== -1);
ok('no version-196 claim leaks into the module header pins of older suites',
  navSrc.indexOf('webVersion, 197') === -1);

console.log('— v196: pickLaneCount — the honest pick —');
const el = (tags) => ({ tags: tags });
eq('name match wins over other values',
  sb.pickLaneCount([el({ name: 'Other Rd', lanes: '4' }), el({ name: '17 Avenue SE', lanes: '3' })], '17 Avenue SE'), 3);
eq('a single distinct value wins without a name',
  sb.pickLaneCount([el({ lanes: '2' }), el({ lanes: '2' })], ''), 2);
eq('ambiguous values answer nothing',
  sb.pickLaneCount([el({ lanes: '2' }), el({ lanes: '3' })], 'Nowhere St'), 0);
eq('lanes:forward is the fallback tag',
  sb.pickLaneCount([el({ 'lanes:forward': '3' })], ''), 3);
eq('"2|3" per-lane junk is rejected', sb.pickLaneCount([el({ lanes: '2|3' })], ''), 0);
eq('zero lanes rejected', sb.pickLaneCount([el({ lanes: '0' })], ''), 0);
eq('nine lanes rejected as implausible', sb.pickLaneCount([el({ lanes: '9' })], ''), 0);
eq('no elements -> 0', sb.pickLaneCount([], 'x'), 0);
eq('null -> 0', sb.pickLaneCount(null, 'x'), 0);
eq('ways without the tag are skipped',
  sb.pickLaneCount([el({ highway: 'residential' }), el({ lanes: '2' })], ''), 2);

console.log('— v196: laneStripHtml — which lane burns —');
function cells(html) { return (html.match(/nv-lane/g) || []).length; }
function onIdx(html) {
  const parts = html.split('nv-lane');
  for (let i = 1; i < parts.length; i++) if (parts[i].indexOf(' on') === 0) return i - 1;
  return -1;
}
const right = sb.laneStripHtml(3, 90);
eq('3 lanes render 3 cells', cells(right), 3);
eq('a right turn lights the RIGHTMOST lane', onIdx(right), 2);
ok('the route lane arrow turns right', right.indexOf('rotate(90 24 24)') !== -1);
const left = sb.laneStripHtml(4, -90);
eq('a left turn lights the LEFTMOST lane', onIdx(left), 0);
ok('the route lane arrow turns left', left.indexOf('rotate(-90 24 24)') !== -1);
const straight = sb.laneStripHtml(2, 3);
eq('straight on lights every lane', (straight.match(/nv-lane on/g) || []).length, 2);
ok('straight arrows point up', straight.indexOf('rotate(0 24 24)') !== -1);
eq('a slight right (12 deg) still takes the right lane', onIdx(sb.laneStripHtml(3, 12)), 2);
eq('no count -> no strip', sb.laneStripHtml(0, 90), '');
eq('implausible count -> no strip', sb.laneStripHtml(9, 90), '');
eq('junk count -> no strip', sb.laneStripHtml('x', 90), '');

console.log('\nnav-lanes-v196 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
