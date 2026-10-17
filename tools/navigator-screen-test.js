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

console.log('\n— (b)+(c) the bottom bar is one readable row; tiles readable —');
ok('ETA is a single ellipsized line', /\.nv-drive-eta\{[^}]*min-width:0[^}]*white-space:nowrap[^}]*text-overflow:ellipsis/.test(css));
ok('bar buttons never shrink', /\.nv-drive-bar \.btn\{flex:none;\}/.test(css));
ok('the ETA text carries the first destination segment only',
  nav.indexOf("S.destLabel.split(',')[0]") >= 0);
ok('tiles get the contrast/saturation lift on both maps',
  /\.nv-drive-map \.leaflet-tile,\.nv-mapzone \.leaflet-tile\{filter:contrast\(1\.08\) saturate\(1\.18\);\}/.test(css));

console.log('\n— (d) the tap rule, both pickers —');
{
  const tapAt = nav.indexOf('THE TAP RULE');
  ok("the Navigator's picker states the tap rule", tapAt >= 0);
  const tapBody = nav.slice(tapAt, tapAt + 1200);
  ok('a pinned tap writes the place NAME into the search box',
    tapBody.indexOf('if (q) q.value = p.name;') >= 0);
  ok('…and still sets the destination from the pin',
    tapBody.indexOf('setDest([p.lat, p.lng], p.name);') >= 0);
  ok('an address-only tap still hands the address to the search',
    tapBody.indexOf('q.value = p.address; searchBtn.onclick();') >= 0);
}
{
  ok('the Places picker states the tap rule', navi.indexOf('THE TAP RULE') >= 0);
  ok('a place tap writes the name into the ONE field',
    navi.indexOf('if (picked && qEl) qEl.value = picked.place.name;') >= 0);
  ok('the ✓ moves IN PLACE (row innerHTML), no list repaint on tap',
    navi.indexOf('rb.innerHTML = pickerRowInner(re, selId[kind]);') >= 0);
  const tapFn = navi.slice(navi.indexOf('if (picked && qEl)'), navi.indexOf('if (picked && qEl)') + 700);
  ok('the tap handler does not call paintResults',
    tapFn.indexOf('paintResults()') === -1);
  ok('the shared row component exposes its inner markup for the in-place move',
    navi.indexOf('function pickerRowInner(e, pickedId)') >= 0 &&
    navi.indexOf('pickerRowInner(e, pickedId) + \'</button>\'') >= 0);
  ok('Go again populates the field instead of jumping straight to the Navigator',
    navi.indexOf('if (qEl) qEl.value = r.name;') >= 0);
  ok('a recent with no saved place still gets its detail (selRecent)',
    navi.indexOf('selRecent = { id: r.id') >= 0 && navi.indexOf("src: 'recent'") >= 0);
}

console.log('\nnavigator-screen: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
