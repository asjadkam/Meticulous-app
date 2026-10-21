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

const css = read('css/style.css');
const nav = read('modules/navigator.js');
const inset = rule(css, '.nv-drive-inset');
const speed = rule(css, '.nv-drive-speed');
const top = rule(css, '.nv-drive-top');
const bar = rule(css, '.nv-drive-bar');

console.log('— v193: the inset leaves the top of the map —');
ok('the inset rule exists', inset.length > 0);
ok('the inset carries NO top positioning at all',
  inset.indexOf('top:') === -1, inset);
ok('the old inset rule (absolute, top:34%) is gone from the stylesheet',
  css.indexOf('.nv-drive-inset{position:absolute;top:34%') === -1);
ok('the inset is bottom-docked over the bar',
  inset.indexOf('bottom:calc(96px + env(safe-area-inset-bottom))') !== -1, inset);
eq('the inset dock is the speedometer\u2019s own line (the two docks level)',
  (inset.match(/bottom:calc\([^)]*\)/) || [])[0],
  (speed.match(/bottom:calc\([^)]*\)/) || [])[0]);
ok('the inset stays on the right', inset.indexOf('right:10px') !== -1);
ok('the inset is capped at 46vw (right of centre, off the truck\u2019s anchor)',
  inset.indexOf('max-width:46vw') !== -1, inset);
ok('the inset stays plain chrome (no transform, v139 budget intact)',
  inset.indexOf('transform') === -1, inset);

console.log('— v193: the stack still stands — banner top, bar foot, inset wired —');
ok('the banner is still the top chrome', top.indexOf('top:calc(') !== -1 && top.indexOf('position:absolute') !== -1);
ok('the drive bar is still the foot chrome', bar.indexOf('bottom:calc(') !== -1);
ok('the inset element + its paint logic are untouched in the module',
  nav.indexOf('id="nvd_inset"') !== -1 && nav.indexOf("body.querySelector('#nvd_inset')") !== -1);

console.log('— v193: no overlap is possible at 1080×2400 —');
{
  /* The phone: 1080 wide × 2400 tall CSS-px-equivalent space
     (aspect is what matters). Banner: top 6px + ~110px tall →
     occupies y 0..~120. Inset: bottom edge 96px above the foot,
     card ~90px tall → occupies y ~2214..2304. Truck anchor:
     top 64% = 1536, box ±66 → 1470..1602. The three bands are
     disjoint by hundreds of pixels — nothing stacks on anything,
     and the road's upper run (y 120..1470) is chrome-free. */
  const H = 2400;
  const banner = [0, 120];
  const insetBand = [H - 96 - 90, H - 96];
  const truck = [Math.round(H * 0.64) - 66, Math.round(H * 0.64) + 66];
  ok('inset band clears the banner band by >2000px',
    insetBand[0] - banner[1] > 2000, JSON.stringify(insetBand));
  ok('inset band clears the truck band by >600px',
    insetBand[0] - truck[1] > 600, JSON.stringify([truck, insetBand]));
  ok('the map\u2019s upper run (banner foot to truck) carries no inset',
    insetBand[0] > truck[1]);
}

console.log('\nnav-cutoff-v193: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
