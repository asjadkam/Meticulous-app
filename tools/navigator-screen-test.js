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
 *      v125 MOVED THE (b)/(c) PINS DELIBERATELY (owner recording
 *      + landscape shot, Oct 17 08:56-09:04 MDT): the drive lift
 *      is REMOVED (OSM Carto's salmon motorways at saturate(1.42)
 *      rendered HOT PINK) and the drive basemap is Esri World
 *      Street Map drawn unfiltered (CARTO Voyager was first
 *      pick; its public CDN now serves API-key placeholder
 *      tiles, verified live during the build); the ETA column takes all leftover space
 *      with a WRAPPING sub (measured 105px + truncated on v124);
 *      the route core is deep blue #1a56db and RETRACTS as
 *      travelled; tile fade-in is disabled (the flicker fix);
 *      the chat FAB hides while Drive is open (it covered the
 *      bar in both orientations); landscape compacts the banner
 *      and the tilt plane grows to 340% (dark-wedge fix).
 *  (d) BOTH pickers obey the tap rule (the tap writes the place
 *      into the search box), and the Places card moves its ✓ in
 *      place instead of repainting/re-sorting the list.
 *  (e) v128 (owner recordings, Oct 17 10:25 + 10:27 MDT): the
 *      Drive overlays blinked ~1×/sec (the per-tick setView
 *      restarted the animated pan, re-projecting the SVG overlay
 *      inside the tilted plane) and the tapped place's detail
 *      rendered at the BOTTOM of the list, Navigate a scroll
 *      away. Pins: the tick recenters by deadbanded instant
 *      panTo (setView gone), the spin is gated by a ≥2°
 *      deadband, the reroute pill writes only on state flips,
 *      the places detail MOVES under the tapped row, repaints
 *      bring it home first, and row subtitles never carry a raw
 *      coordinate pair. The behavioral proofs live in
 *      navigator-test (instrumented drive ticks) and
 *      navigator-v128-test (ordered-DOM accordion).
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
/* v139 PIN MOVES (see BUGS.md v139): the 340% mapbox, the
   viewport's perspective property and the CSS 52° tilt layer
   are GONE — replaced by ONE bounded plane carrying a composed
   transform. The sky-gradient backstop keeps its job. */
ok('v139+v178+v220+v260: the map rides ONE bounded plane — 260% × 300% (v178 A1 re-pin: 190% left the top corners short at diagonal headings; v220: height grew to 300% so the pitched far field reaches the top of the glass; v260 NAV-TOP-CUTOFF: width 230% -> 260% for the translate-compensated reach on the owner\'s 768x1024 screen), centred on the anchor by its offsets',
  /\.nv-drive-plane\{[^}]*width:260%;height:300%;left:-80%;top:-86%/.test(css) &&
  !/\.nv-drive-mapbox\{/.test(css) && !/\.nv-drive-tilt\{/.test(css) && !/\.nv-drive-spin\{/.test(css));
ok('v139+v260: the viewport carries NO perspective property — the projection is composed into the plane\'s single transform (v260: the composed string gains a translateY lift segment between perspective and rotateX — empty when no lift applies, so the rest string is byte-identical to the v259 form)',
  !/\.nv-drive-viewport\{[^}]*perspective:/.test(css) &&
  nav.indexOf("'perspective(1100px)' + liftStr + ' rotateX(50deg) rotate('") >= 0);
ok('the viewport backstop is a sky gradient, not flat gray',
  /\.nv-drive-viewport\{[^}]*linear-gradient\(180deg,#0b1424/.test(css));
ok('v139: the tilt is 50° in the composed plane transform (45° from v139 to v258; v259 NAV-CHASE-ANGLE-STEEPER raised it so more road ahead shows; was 52° in a CSS layer before v139, BUGS.md v139)',
  nav.indexOf('rotateX(50deg)') >= 0 && css.indexOf('rotateX(52deg)') < 0);
ok('a second settle invalidateSize pass exists (+650ms)',
  nav.indexOf('}, 650);') >= 0 && (nav.match(/invalidateSize\(\)/g) || []).length >= 3);

console.log('\n— (b)+(c) the bottom bar: arrival visible, buttons whole; tiles readable —');
ok('v125: the ETA stack takes ALL leftover bar space and the sub WRAPS (was: v124 two-line stack, sub nowrap+ellipsis — measured 105px wide in a real engine, sub truncated to "Arrive · 4 min · …")',
  /\.nv-drive-eta\{[^}]*flex:1 1 0%;[^}]*flex-direction:column/.test(css) &&
  /\.nv-drive-eta-main\{[^}]*font-weight:800[^}]*white-space:nowrap/.test(css) &&
  /\.nv-drive-eta-sub\{[^}]*-webkit-line-clamp:2/.test(css) &&
  !/\.nv-drive-eta-sub\{[^}]*text-overflow:ellipsis/.test(css));
ok('v124: bar buttons keep their NATURAL width (the 0px-ETA crush fix)',
  /\.nv-drive-bar \.btn\{flex:none;width:auto;margin:0;/.test(css));
ok('the ETA text carries the first destination segment only',
  nav.indexOf("S.destLabel.split(',')[0]") >= 0);
ok('v125: the ETA stack renders a visible placeholder from Drive open (never blank)',
  nav.indexOf('id="nvd_eta_main">--:--</div>') >= 0 &&
  nav.indexOf('Getting your arrival time…') >= 0);
ok('v125+v178: the drive route line is cased white 24 under a deep BLUE core 18 (v178 A3 re-pin: thicker still — readable at a glance; colour unchanged, a colour no road uses)',
  nav.indexOf("color: '#1a56db', weight: 18") >= 0 && nav.indexOf('weight: 24') >= 0 &&
  nav.indexOf('function makeDriveLine()') >= 0);
ok('v125: the route line RETRACTS as travelled (driveTick redraws from the projected position)',
  nav.indexOf('routeRemainder(S.line, S.pos)') >= 0 &&
  nav.indexOf('layers[li].setLatLngs(rem.points)') >= 0);
ok('tiles: the planning map keeps the shared lift',
  /\.nv-mapzone \.leaflet-tile\{filter:contrast\(1\.08\) saturate\(1\.18\);\}/.test(css));
ok('v125: NO filter on drive tiles (the 1.16/1.42 lift made OSM Carto\'s salmon motorways HOT PINK — owner recording, Oct 17) and no leftover drive-tile filter rule',
  !/\.nv-drive-map \.leaflet-tile\{filter:/.test(css) && !/filter:contrast\(1\.16\) saturate\(1\.42\)/.test(css));
ok('v125: the drive basemap is Esri World Street Map via driveTileSpec; the drive map no longer loads OSM tiles',
  nav.indexOf('server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map') >= 0 &&
  nav.indexOf('L.tileLayer(tspec.url') >= 0 &&
  nav.indexOf("L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(S.driveMap)") === -1);
ok('v125 flicker fix: the drive map disables Leaflet tile fade-in and keeps a deeper tile buffer',
  nav.indexOf('fadeAnimation: false') >= 0 && nav.indexOf('keepBuffer: 4') >= 0);
ok('v125: while Drive is open the shell chat FAB is hidden (it sat on End drive / Sound in engine measurements)',
  /body\.mt-driving #fbFab\{display:none!important;\}/.test(css) &&
  nav.indexOf("classList.add('mt-driving')") >= 0 && nav.indexOf("classList.remove('mt-driving')") >= 0);
ok('v125 landscape: the banner compacts (horizontal, smaller) under a short landscape viewport',
  /@media \(orientation:landscape\) and \(max-height:500px\)\{[^}]*\.nv-drive-top\{display:flex/.test(css.replace(/\n/g, ' ')) &&
  /\.nv-drive-dist\{font-size:30px;\}/.test(css));

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

console.log('\n— (e) v128: the drive tick mutates, never rebuilds —');
ok('v128+v260: driveTick recenters with a deadbanded instant panTo — the per-tick setView is GONE (v260 re-pin: the pan and its 3 m deadband aim at the follow TARGET — followTarget() — the ahead point the cutoff compensation centres on; comparing against the raw truck point would re-fire the pan every tick and undo the compensation)',
  nav.indexOf('S.driveMap.panTo(ft, { animate: false })') >= 0 &&
  nav.indexOf('haversineM(ft, [ctr.lat, ctr.lng]) > 3') >= 0 &&
  nav.indexOf('S.driveMap.setView(S.pos, 17)') === -1);
ok('v128: the spin write is gated by the ≥2° deadband (angDeltaDeg), so heading jitter never repaints the tilted plane',
  nav.indexOf('angDeltaDeg(S.heading, S.drive.headingApplied) >= 2') >= 0 &&
  nav.indexOf('function angDeltaDeg') >= 0);
ok('v128: the reroute pill writes only when its shown state flips (the rrShown cache)',
  nav.indexOf('S.drive.rrShown !== rrKey') >= 0 && nav.indexOf('rrShown: null') >= 0);
ok('v128: per-tick layer traffic stays the v125 mutations only (marker setLatLng, line setLatLngs)',
  nav.indexOf('S.driveMarker.setLatLng(S.pos)') >= 0 &&
  nav.indexOf('layers[li].setLatLngs(rem.points)') >= 0);

console.log('\n— (f) v128: the places detail expands AT THE TAP —');
ok('v128: the detail panel MOVES under the tapped row (placeDetail + insertBefore) instead of rendering at the bottom of the list',
  navi.indexOf('function placeDetail()') >= 0 &&
  navi.indexOf('resEl.insertBefore(detailEl, rowEl.nextSibling)') >= 0);
ok('v128: every list repaint first brings the detail home, so a repaint can never strand it inside the list it replaces',
  navi.indexOf('function detailToHome()') >= 0 && navi.indexOf('detailToHome();') >= 0);
ok('v128: rows never print a raw coordinate pair as the address (the nameIsCoords gate on the row subtitle)',
  navi.indexOf("!nameIsCoords(p.address)") >= 0);
ok('v128: the in-list expansion is styled as an expansion (indented, accent edge)',
  /#nv_results #nv_detail\{[^}]*border-left:3px solid/.test(css));

console.log('\nnavigator-screen: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
