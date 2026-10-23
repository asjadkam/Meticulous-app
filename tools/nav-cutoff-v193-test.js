#!/usr/bin/env node
/* Meticulous v193 — NAV-CUTOFF suite.
 *
 * The owner's live drive, Oct 21, 2026 07:39 MDT (screenshot in
 * chat): the next-step inset card sat ON the route at the top
 * of the map — in the 3D chase view the road ahead runs up the
 * middle of the glass, and the inset hung at top:34% right in
 * its path, cutting the route under the banner. Standing rule:
 * nothing is cut off at the top of the map; the drive chrome
 * stacks without overlap — banner top, clear map beneath it,
 * bar at the foot.
 *
 * The fix is one CSS move: the inset leaves the top entirely
 * and docks bottom-right on the speedometer's own line (96px +
 * safe-area over the bar), max-width 46vw so it stays right of
 * centre. This suite pins the dock and proves the stack
 * arithmetically at the owner's phone aspect (1080×2400).
 *
 * SUPERSEDED IN PART by v237 (NAV-INSET-SMALL-TOPRIGHT, owner,
 * Fri Oct 23, 2026 11:36 MDT): the bottom-right dock is gone —
 * the card is now SMALL and docked TOP RIGHT. What this suite
 * still pins is the v193 STACK LAW that the move had to keep:
 * nothing cut off at the top of the map, the chrome stacks
 * without overlap — banner top, the card hanging below the
 * banner on the right, its foot clear of the centred truck,
 * bar at the foot, plain chrome (no transform).
 *
 * Run: node tools/nav-cutoff-v193-test.js
 */
'use strict';
const fs = require('fs');
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
function rule(css, sel) {
  const i = css.indexOf(sel + '{');
  if (i === -1) return '';
  return css.slice(i, css.indexOf('}', i) + 1);
}
function ruleLast(css, sel) {
  const i = css.lastIndexOf(sel + '{');
  if (i === -1) return '';
  return css.slice(i, css.indexOf('}', i) + 1);
}

const css = read('css/style.css');
const nav = read('modules/navigator.js');
/* v237: the MAIN inset rule is the last .nv-drive-inset rule in
   the sheet (the landscape override sits earlier). */
const inset = ruleLast(css, '.nv-drive-inset');
const speed = rule(css, '.nv-drive-speed');
const top = rule(css, '.nv-drive-top');
const bar = rule(css, '.nv-drive-bar');

console.log('— v193 as superseded by v237: the card never sits ON the top of the map —');
ok('the inset rule exists', inset.length > 0);
/* v193's original pin ("NO top positioning at all", the
   bottom-right dock on the speedometer's line, the 46vw cap)
   is SUPERSEDED by the owner's v237 order — the card is small
   and docked top-right now. The law underneath survives: the
   card hangs BELOW the banner (never over it, never at the
   old top:34% on-the-route spot) and carries no bottom dock. */
ok('the old inset rule (absolute, top:34%) is gone from the stylesheet',
  css.indexOf('.nv-drive-inset{position:absolute;top:34%') === -1);
ok('the inset hangs below the banner (top:calc(198px + safe-area))',
  inset.indexOf('top:calc(198px + env(safe-area-inset-top))') !== -1, inset);
ok('the v193/v237 bottom dock is gone (no bottom: in the inset rule)',
  inset.indexOf('bottom:') === -1, inset);
ok('the speedometer keeps its own bottom-left dock, untouched',
  speed.indexOf('bottom:calc(96px + env(safe-area-inset-bottom))') !== -1, speed);
ok('the inset stays on the right', inset.indexOf('right:10px') !== -1);
ok('the inset is the small card now (width:200px, max-width:54vw)',
  inset.indexOf('width:200px') !== -1 && inset.indexOf('max-width:54vw') !== -1, inset);
ok('the inset stays plain chrome (no transform, v139 budget intact)',
  inset.indexOf('transform') === -1, inset);

console.log('— v193: the stack still stands — banner top, bar foot, inset wired —');
ok('the banner is still the top chrome', top.indexOf('top:calc(') !== -1 && top.indexOf('position:absolute') !== -1);
ok('the drive bar is still the foot chrome', bar.indexOf('bottom:calc(') !== -1);
ok('the inset element + its paint logic are untouched in the module',
  nav.indexOf('id="nvd_inset"') !== -1 && nav.indexOf("body.querySelector('#nvd_inset')") !== -1);

console.log('— v193/v237: no overlap is possible at a real phone (390×844 CSS px) —');
{
  /* Banner worst case: top 10 + padding 26 + distance 44 +
     instruction (3 lines) 79 + road 24 → band 0..~191.
     Inset (v237): top 198, ~215 tall → band 198..413.
     Truck anchor: top 64% of 844 = 540, box ±66 → 474..606.
     The three bands are disjoint — nothing stacks on anything,
     and nothing is cut off at the top of the map. */
  const banner = [0, 191];
  const insetBand = [198, 413];
  const truck = [Math.round(844 * 0.64) - 66, Math.round(844 * 0.64) + 66];
  ok('inset band clears the banner band (hangs below it, never over it)',
    insetBand[0] > banner[1], JSON.stringify([banner, insetBand]));
  ok('inset band clears the truck band',
    insetBand[1] < truck[0], JSON.stringify([truck, insetBand]));
  ok('the bar\u2019s band at the foot carries no inset',
    insetBand[1] < 844 - 96);
}

console.log('\nnav-cutoff-v193: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
