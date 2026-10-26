#!/usr/bin/env node
/* Meticulous v238 — NAV-LANE-INFO-REAL suite.
 *
 * The owner's drive video, Fri Oct 23, 2026 11:36 MDT (Rand
 * McNally screenshots the benchmark): the pop-up "shows NO
 * lane information" — it must show REAL lane guidance, arrows
 * over the actual lanes for the upcoming turn, making clear
 * which lane to be in, designed-in — not an afterthought.
 *
 * What honestly exists: the routing response carries NO lane
 * data (verified live, Oct 21; BUGS.md). The v196 strip read
 * OSM's `lanes` COUNT and guessed the route lane from the
 * turn's geometry alone (its suite named the limitation:
 * "marked multi-lane turns (OSM turn:lanes) are not read").
 * v238 reads the real thing: OSM `turn:lanes` — the marked
 * movement(s) of EACH lane on the approach road — and draws
 * one cell per real lane with the arrow(s) that lane actually
 * allows; the lanes that serve the maneuver burn bright.
 *
 * ORIENTATION RULE (named): a turn:lanes strip is only read
 * from `turn:lanes:forward` on a ONE-WAY approach way (or a
 * motorway, one-way by construction) — there the forward
 * lanes are exactly the driver's lanes, in travel order.
 * Anything else (two-way combined tagging, ambiguous or junk
 * values, a lane count that contradicts lanes:forward)
 * answers NOTHING and the card falls back to the v196 count
 * strip — or to no strip. No lane is ever invented.
 *
 * RED before the fix: pickTurnLanes / laneArrowsHtml /
 * laneGuidanceHtml do not exist; the fetcher never asks for
 * turn:lanes; the tick paints the geometry-guess strip.
 *
 * Run: node tools/nav-lane-info-v238-test.js
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

console.log('— v238: the real-lane reader exists and is wired —');
ok('pickTurnLanes is NAVPURE', typeof sb.pickTurnLanes === 'function');
ok('laneArrowsHtml is NAVPURE', typeof sb.laneArrowsHtml === 'function');
ok('laneGuidanceHtml is NAVPURE', typeof sb.laneGuidanceHtml === 'function');
ok('the fetcher asks Overpass for turn:lanes ways too',
  navSrc.indexOf('"^turn:lanes"') !== -1 && navSrc.indexOf('["highway"]["lanes"]') !== -1);
ok('the fetcher stores the picked turn lanes with the count',
  navSrc.indexOf('pickTurnLanes(els, street)') !== -1 && navSrc.indexOf('pickLaneCount(els, street)') !== -1);
ok('the pop-up paints through laneGuidanceHtml (v264: laneData — server lanes first, this cache the fallback)',
  navSrc.indexOf('laneGuidanceHtml(laneData, dDeg)') !== -1 &&
  navSrc.indexOf('(S.laneByTurn ? S.laneByTurn[dp.idx] : null)') !== -1);
ok('the arrows-strip CSS exists (auto-width cells + wrap variant)',
  css.indexOf('.nv-lane.nv-lane-arrows{') !== -1 && css.indexOf('.nv-inset-lanes.wrap{') !== -1);

const el = (tags) => ({ tags: tags });
const OW = { oneway: 'yes', 'turn:lanes:forward': 'left|through|through;right' };

console.log('— v238: pickTurnLanes — the honest pick —');
eq('a one-way approach with marked lanes reads',
  sb.pickTurnLanes([el(OW)], ''), [['left'], ['through'], ['through', 'right']]);
eq('name match wins over a different value',
  sb.pickTurnLanes([
    el({ oneway: 'yes', name: 'Other Rd', 'turn:lanes:forward': 'through|right' }),
    el({ oneway: 'yes', name: '17 Avenue SE', 'turn:lanes:forward': 'left|through' })
  ], '17 Avenue SE'), [['left'], ['through']]);
eq('ambiguous values answer nothing',
  sb.pickTurnLanes([
    el({ oneway: 'yes', 'turn:lanes:forward': 'left|through' }),
    el({ oneway: 'yes', 'turn:lanes:forward': 'through|right' })
  ], 'Nowhere St'), null);
/* v264 RE-BASE (NAV-LANE-INSET-EMPTY, evidence Oct 26, 2026):
 * the two pins below asserted the v238 orientation gate. Direct
 * OSM reads of the owner's corridors (Deerfoot Tr / 16 Ave and
 * Peigan Tr / Barlow bboxes via the OSM API) show Calgary tags
 * plain `turn:lanes` on one-way carriageways and essentially
 * never `turn:lanes:forward` — the gate read a key his roads
 * don't carry. v264 widens honestly: the :forward suffix names
 * the forward lanes BY DEFINITION wherever it stands, and
 * plain turn:lanes on a one-way way names exactly the driver's
 * lanes. Plain turn:lanes on a TWO-WAY way stays unread. */
eq('v264: turn:lanes:forward is read wherever it stands (suffix = the forward lanes)',
  sb.pickTurnLanes([el({ 'turn:lanes:forward': 'left|through' })], ''), [['left'], ['through']]);
eq('v264: plain turn:lanes on a one-way way is read (Calgary carriageway tagging)',
  sb.pickTurnLanes([el({ oneway: 'yes', 'turn:lanes': 'left|through' })], ''), [['left'], ['through']]);
eq('v264: plain turn:lanes on a TWO-WAY way is still NOT read (spans both directions)',
  sb.pickTurnLanes([el({ oneway: 'no', 'turn:lanes': 'left|through' })], ''), null);
eq('a motorway approach is one-way by construction',
  sb.pickTurnLanes([el({ highway: 'motorway', 'turn:lanes:forward': 'through|right' })], ''),
  [['through'], ['right']]);
eq('junk movement tokens reject the whole value',
  sb.pickTurnLanes([el({ oneway: 'yes', 'turn:lanes:forward': 'left|sideways' })], ''), null);
eq('an empty lane slot rejects the whole value',
  sb.pickTurnLanes([el({ oneway: 'yes', 'turn:lanes:forward': 'left||through' })], ''), null);
eq('a count contradicting lanes:forward is distrusted',
  sb.pickTurnLanes([el({ oneway: 'yes', 'lanes:forward': '3', 'turn:lanes:forward': 'left|through' })], ''), null);
eq('a count agreeing with lanes:forward is trusted',
  sb.pickTurnLanes([el({ oneway: 'yes', 'lanes:forward': '2', 'turn:lanes:forward': 'left|through' })], ''),
  [['left'], ['through']]);
eq('no elements -> null', sb.pickTurnLanes([], 'x'), null);
eq('null -> null', sb.pickTurnLanes(null, 'x'), null);
eq('seven marked lanes are implausible -> null',
  sb.pickTurnLanes([el({ oneway: 'yes', 'turn:lanes:forward': 'through|through|through|through|through|through|through' })], ''), null);

console.log('— v238: laneArrowsHtml — arrows over the REAL lanes —');
const TL = [['left'], ['through'], ['through', 'right']];
function onIdx(html) {
  const parts = html.split('<span class="nv-lane');
  const out = [];
  for (let i = 1; i < parts.length; i++) if (parts[i].indexOf(' on') === 0 || parts[i].indexOf(' on ') === 0 || /^ on[ "]/.test(parts[i])) out.push(i - 1);
  return out;
}
const right = sb.laneArrowsHtml(TL, 90);
eq('three real lanes render three cells', (right.match(/<span class="nv-lane/g) || []).length, 3);
eq('a right turn lights ONLY the lane marked right', onIdx(right), [2]);
ok('the left lane shows its real left arrow', right.indexOf('rotate(-90 24 24)') !== -1);
ok('the through+right lane shows both of its real arrows',
  right.indexOf('rotate(0 24 24)') !== -1 && right.indexOf('rotate(90 24 24)') !== -1);
const straight = sb.laneArrowsHtml(TL, 0);
eq('straight on lights the through lanes (2 and 3)', onIdx(straight), [1, 2]);
const left = sb.laneArrowsHtml(TL, -90);
eq('a left turn lights ONLY the lane marked left', onIdx(left), [0]);
const none = sb.laneArrowsHtml([['left'], ['left']], 0);
eq('when no lane serves the move, none is lit (the tagging is shown, not faked)',
  onIdx(none), []);
eq('no lanes -> no strip', sb.laneArrowsHtml(null, 90), '');
eq('empty lanes -> no strip', sb.laneArrowsHtml([], 90), '');

console.log('— v238: laneGuidanceHtml — real first, honest fallback —');
ok('turn lanes win over the count',
  sb.laneGuidanceHtml({ count: 3, turn: TL }, 90).indexOf('rotate(90 24 24)') !== -1);
eq('count-only data falls back to the v196 strip (3 cells, rightmost lit)',
  (sb.laneGuidanceHtml({ count: 3, turn: null }, 90).match(/nv-lane/g) || []).length, 3);
eq('a bare number (pre-v238 cache shape) still renders the strip',
  (sb.laneGuidanceHtml(2, 0).match(/nv-lane/g) || []).length, 2);
eq('nothing known -> nothing shown', sb.laneGuidanceHtml(null, 90), '');
eq('an honest empty answer -> nothing shown', sb.laneGuidanceHtml({ count: 0, turn: null }, 90), '');

console.log('\nnav-lane-info-v238: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
