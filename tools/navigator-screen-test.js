#!/usr/bin/env node
/* Meticulous v107 — NAVIGATOR SCREEN (Stage 7 of the Oct 16
 * overnight program).
 *
 * Owner evidence (Oct 16, 2026 20:12-20:14 MDT, Drive screenshot
 * + recording): a ~40% dead gray band across the Drive screen's
 * map, the bottom bar's ETA crushed into a tall narrow column by
 * the Sound / End drive buttons, and a place tap that "only moved
 * a ✓ mark and re-sorted" the recents list with a garbled flicker
 * — while his rule stands verbatim: "When I touch any of the
 * saved addresses it should populate in the search bar itself!"
 *
 * Pins (the geometry + the tap rule's wiring):
 *  (a) the drive plane is oversized enough (300%) and the
 *      perspective deep enough (1000px) for the projected far
 *      edge to clear the viewport top, with a sky gradient
 *      behind any residual sliver; a second settle invalidateSize
 *      pass backs the first;
 *  (b) the ETA is one line (nowrap + ellipsis + min-width:0),
 *      the bar buttons keep their width, and the ETA text itself
 *      carries only the destination's first segment;
 *      v124 MOVED THIS PIN DELIBERATELY (owner, Oct 17 07:17 —
 *      "What's the arrival time?", over a Drive screen whose bar
 *      showed no arrival info at all): measured in a real engine,
 *      the v107 row crushed the ETA to 0 px wide — the global
 *      .btn{width:100%} defeated flex:none, each button claimed
 *      the whole bar, and End drive sat off-screen. The ETA is
 *      now a two-line stack (arrival CLOCK time on top, remaining
 *      under it), the bar buttons are scoped to natural width,
 *      and the drive tiles get a stronger lift of their own;
 *  (c) tiles get the contrast/saturation lift;
 *  (d) BOTH pickers obey the tap rule (the tap writes the place
 *      into the search box), and the Places card moves its ✓ in
 *      place instead of repainting/re-sorting the list.
 * Run: node tools/navigator-screen-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}

const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
const nav = fs.readFileSync(path.join(ROOT, 'modules', 'navigator.js'), 'utf8');
const navi = fs.readFileSync(path.join(ROOT, 'modules', 'navigation.js'), 'utf8');

console.log('\n— (a) the map fills its area —');
ok('mapbox is 300% (was 210%)', /\.nv-drive-mapbox\{[^}]*width:300%;height:300%/.test(css));
ok('perspective deepened to 1000px', /\.nv-drive-viewport\{[^}]*perspective:1000px/.test(css));
ok('the viewport backstop is a sky gradient, not flat gray',
  /\.nv-drive-viewport\{[^}]*linear-gradient\(180deg,#0b1424/.test(css));
ok('the 52° standard tilt is unchanged', css.indexOf('rotateX(52deg)') >= 0);
ok('a second settle invalidateSize pass exists (+650ms)',
  nav.indexOf('}, 650);') >= 0 && (nav.match(/invalidateSize\(\)/g) || []).length >= 3);

console.log('\n— (b)+(c) the bottom bar: arrival visible, buttons whole; tiles readable —');
ok('v124: the ETA is a two-line stack (arrival main + remaining sub)',
  /\.nv-drive-eta\{[^}]*flex-direction:column/.test(css) &&
  /\.nv-drive-eta-main\{[^}]*font-weight:800[^}]*white-space:nowrap/.test(css) &&
  /\.nv-drive-eta-sub\{[^}]*white-space:nowrap[^}]*text-overflow:ellipsis/.test(css));
ok('v124: bar buttons keep their NATURAL width (the 0px-ETA crush fix)',
  /\.nv-drive-bar \.btn\{flex:none;width:auto;margin:0;/.test(css));
ok('the ETA text carries the first destination segment only',
  nav.indexOf("S.destLabel.split(',')[0]") >= 0);
ok('v124: the drive route line is cased + heavy (17 white under 11 colour)',
  nav.indexOf('weight: 17') >= 0 && nav.indexOf('weight: 11') >= 0 &&
  nav.indexOf('function makeDriveLine()') >= 0);
ok('tiles: the planning map keeps the shared lift',
  /\.nv-mapzone \.leaflet-tile\{filter:contrast\(1\.08\) saturate\(1\.18\);\}/.test(css));
ok('v124: the DRIVE map gets a stronger lift of its own',
  /\.nv-drive-map \.leaflet-tile\{filter:contrast\(1\.16\) saturate\(1\.42\);\}/.test(css));

console.log('\n— (a2) v124: Drive is full-bleed, chrome floats —');
ok('v124: the drive viewport covers the whole screen (absolute, inset 0)',
  /\.nv-drive-viewport\{position:absolute;inset:0;/.test(css));
ok('v124: the maneuver banner floats over the map as a card',
  /\.nv-drive-top\{position:absolute;[^}]*border-radius:16px/.test(css));
ok('v124: the ETA bar floats over the map as a card',
  /\.nv-drive-bar\{position:absolute;[^}]*border-radius:16px/.test(css));
ok('v124: the dispatch secondary action row is uniform (one height, zeroed margins)',
  /\.dsp-actions \.btn\{margin:0;min-height:48px;/.test(css));

console.log('\n— (d) the tap rule, both pickers —');
{
  const tapAt = nav.indexOf('THE TAP RULE');
  ok("the Navigator's picker states the tap rule", tapAt >= 0);
  const tapBody = nav.slice(tapAt, tapAt + 1200);
  ok('a pinned tap writes the place NAME into the search box',
    tapBody.indexOf('if (q) q.value = pName;') >= 0); // v118: the resolved name (displayPlaceName), never a coordinates-name
  ok('…and still sets the destination from the pin',
    tapBody.indexOf('setDest([p.lat, p.lng], pName);') >= 0);
  ok('an address-only tap still hands the address to the search',
    tapBody.indexOf('q.value = p.address; searchBtn.onclick();') >= 0);
}
{
  ok('the Places picker states the tap rule', navi.indexOf('THE TAP RULE') >= 0);
  ok('a place tap writes the name into the ONE field',
    navi.indexOf('if (picked && qEl) qEl.value = displayPlaceName(picked.place);') >= 0); // v118: resolved name
  ok('the ✓ moves IN PLACE (row innerHTML), no list repaint on tap',
    navi.indexOf('rb.innerHTML = pickerRowInner(re, selId[kind]);') >= 0);
  const tapFn = navi.slice(navi.indexOf('if (picked && qEl)'), navi.indexOf('if (picked && qEl)') + 700);
  ok('the tap handler does not call paintResults',
    tapFn.indexOf('paintResults()') === -1);
  ok('the shared row component exposes its inner markup for the in-place move',
    navi.indexOf('function pickerRowInner(e, pickedId)') >= 0 &&
    navi.indexOf('pickerRowInner(e, pickedId) + \'</button>\'') >= 0);
  ok('Go again populates the field instead of jumping straight to the Navigator',
    navi.indexOf('if (qEl) qEl.value = rName;') >= 0); // v118: the resolved recent name (displayPlaceName(r))
  ok('a recent with no saved place still gets its detail (selRecent)',
    navi.indexOf('selRecent = { id: r.id') >= 0 && navi.indexOf("src: 'recent'") >= 0);
}

console.log('\nnavigator-screen: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
