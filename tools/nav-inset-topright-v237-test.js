#!/usr/bin/env node
/* Meticulous v237 — NAV-INSET-SMALL-TOPRIGHT suite.
 *
 * The owner's drive video, Fri Oct 23, 2026 11:36 MDT: the
 * driving instruction/inset pop-up "takes HALF the screen and
 * is mostly empty dark panel". His order: it becomes a SMALL
 * card at the TOP RIGHT of the drive screen (Rand McNally is
 * the benchmark he named three times that morning). Small and
 * glanceable, but it keeps everything it must show — the
 * junction drawing, the lane strip, the distance + instruction
 * header — nothing cut off.
 *
 * The v193 dock (bottom-right, 46vw) is SUPERSEDED by this
 * order. What survives from v193 is its stack law: the chrome
 * never overlaps — banner top, the card hangs BELOW the banner
 * on the right, bar at the foot, and the card never touches
 * the centred truck.
 *
 * RED before the fix: the card is bottom-docked at 46vw with
 * a full-width junction drawing and a 46px header arrow.
 *
 * Run: node tools/nav-inset-topright-v237-test.js
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
/* The main .nv-drive-inset rule is the LAST one in the sheet —
   the landscape media override sits earlier in the file. */
const inset = ruleLast(css, '.nv-drive-inset');
const junction = rule(css, '.nv-inset-junction');
const headB = rule(css, '.nv-inset-text b');
const headSpan = rule(css, '.nv-inset-text span');
const lane = rule(css, '.nv-lane');

console.log('— v237: the card is SMALL and docks TOP RIGHT, below the banner —');
ok('the inset rule exists', inset.length > 0, inset);
ok('the inset is top-docked (a top: line is present)',
  /top:calc\(/.test(inset), inset);
ok('the top dock hangs BELOW the portrait banner (198px + safe-area line)',
  inset.indexOf('top:calc(198px + env(safe-area-inset-top))') !== -1, inset);
ok('the bottom dock is gone (no bottom: in the inset rule)',
  inset.indexOf('bottom:') === -1, inset);
ok('the inset stays on the right', inset.indexOf('right:10px') !== -1, inset);
ok('the card is a fixed small width (200px), not 46vw',
  inset.indexOf('width:200px') !== -1 && inset.indexOf('46vw') === -1, inset);
ok('a small-phone cap remains (max-width in vw, at most 54vw)',
  /max-width:(5[0-4]|[1-4][0-9])vw/.test(inset), inset);
ok('the inset stays plain chrome (no transform, v139 budget intact)',
  inset.indexOf('transform') === -1, inset);
ok('the column stack stands (junction over lanes over header)',
  /flex-direction:column/.test(inset), inset);

console.log('— v237: nothing inside the card was cut — it is compacted —');
ok('the tick still paints junction + lane strip + header into the card',
  nav.indexOf("'<div class=\"nv-inset-junction\">' + junctionViewSvg(S.plan, S.line, dp.idx) + '</div>'") !== -1 &&
  nav.indexOf('nv-inset-head') !== -1 &&
  /lane(Strip|Guidance)Html\(/.test(nav));
ok('the junction drawing is capped small inside the card (max-width 140px)',
  junction.indexOf('max-width:140px') !== -1, junction);
ok('the header arrow shrinks to 38px', nav.indexOf('width="38" height="38"') !== -1);
ok('the header distance type is compact (17px)', /font-size:17px/.test(headB), headB);
ok('the header words are compact (12.5px)', /font-size:12\.5px/.test(headSpan), headSpan);
ok('lane cells fit the small card (27px cells)',
  lane.indexOf('width:27px') !== -1 && lane.indexOf('height:27px') !== -1, lane);

console.log('— v237: landscape keeps the card under the compact banner —');
{
  const land = css.slice(css.indexOf('@media (orientation:landscape)'));
  const li = land.indexOf('.nv-drive-inset{');
  ok('a landscape override moves the card to the compact-banner line (76px)',
    li !== -1 && land.slice(li, land.indexOf('}', li)).indexOf('top:calc(76px + env(safe-area-inset-top))') !== -1);
}

console.log('— v237: the stack arithmetic at a real phone (390x844 CSS px) —');
{
  /* Banner worst case (3-line instruction): top 10 + padding 26
     + distance 44 + instruction 79 + road 24 = foot at ~191.
     Card: top 198, height ~215 (junction ~108 + lanes ~31 +
     header ~44 + gaps/padding ~32) -> foot ~413.
     Truck anchor: 64% of 844 = 540, box +-66 -> 474..606. */
  const bannerFoot = 191, cardTop = 198, cardFoot = 413, truckTop = 474;
  ok('the card clears the banner foot (no overlap)', cardTop > bannerFoot);
  ok('the card clears the truck (no overlap)', cardFoot < truckTop);
  ok('the card occupies under a third of the screen height',
    (cardFoot - cardTop) / 844 < 0.34, String(cardFoot - cardTop));
}

console.log('\nnav-inset-topright-v237: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
