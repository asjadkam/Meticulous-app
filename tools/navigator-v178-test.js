/* Meticulous v178 — NAVIGATOR OVERHAUL BATCH 3: MAP RENDERING
   (owner, Oct 19, 2026; build order Oct 20).

   A1 "map top edge cutting off": the 190% drive plane's reach
   above the anchor, once pitched (rotateX 45°) and spun to a
   diagonal heading, fell short of the screen's top corners —
   sometimes top-left, sometimes top-right, exactly as reported.
   The plane is now 230% × 230%, still centred on the anchor by
   its offsets (left:-65% = 50 − 230/2, top:-51% = 64 − 230/2),
   still ONE bounded plane under the v139 contract; the raster
   budget re-pin: (230/340)² < 0.5 of the v135 plane.

   A2 "smooth movement": a requestAnimationFrame loop eases the
   applied heading (shortest arc, ≤3°/frame) and the map centre
   toward the latest fix between GPS fixes, through paintPlane —
   the module's ONE .style.transform writer (the pinned line now
   lives inside it; the tick's ≥2° gate is unchanged).

   A3 "thicker lines and names": drive route line casing 17→24 /
   core 12→18, planning line 5→8, drive zoom 17→18 (road names
   render bigger at the closer zoom — the raster lever).

   F2 "turn arrows on the route line + lane-guidance inset":
   a pool of ten chevron markers, created once at Drive start
   and only mutated on the remainder redraw's cadence, lies
   along the road ahead pointing along each segment's bearing
   (SVG transform attribute — never a CSS/style transform). The
   turn inset pops up inside 400 m of a turn: a big arrow bent
   by turnDeltaDeg (the route's own geometry at that turn) over
   distance + instruction. NO lane fabrication: Valhalla's
   response carries no lane data (BUGS.md), so the inset shows
   the turn honestly and nothing more.

   Run: node tools/navigator-v178-test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
const navSrc = read('modules/navigator.js');
const idxSrc = read('index.html');
const cssSrc = read('css/style.css');
const ver = JSON.parse(read('version.json'));

console.log('— A1: the plane covers the corners —');
check('the plane is 230% wide x 300% tall, anchor-centred (left:-65%, top:-86%) — v220 re-pin: A1 grew the SQUARE plane for the corners; the top still fell short on diagonal headings, so v220 grows the HEIGHT only (far-field), centre unmoved',
  /\.nv-drive-plane\{[^}]*width:230%;height:300%;left:-65%;top:-86%/.test(cssSrc));
check('the raster budget holds: (230/340)^2 < 0.5 of the v135 plane',
  Math.pow(230 / 340, 2) < 0.5);

console.log('— A2: movement is interpolated —');
check('exactly ONE .style.transform writer remains, inside paintPlane, with the pinned composed call (v222 pin move: the plane lookup gained the docEl fallback — a PARKED drive screen lives in the shell dock, outside this render body, and its plane must still paint; the writer count and the composed call are unchanged)',
  (navSrc.match(/\.style\.transform\s*=/g) || []).length === 1 &&
  /function paintPlane\(hdg\) \{[\s\S]{0,320}?var plane = body\.querySelector\('#nvd_plane'\) \|\| docEl\('nvd_plane'\);\s*if \(plane\) plane\.style\.transform = planeTransform\(hdg\);/.test(navSrc));
check('the tick keeps its v128 >=2° gate and writes through paintPlane',
  navSrc.indexOf('angDeltaDeg(S.heading, S.drive.headingApplied) >= 2') >= 0 &&
  navSrc.indexOf('paintPlane(hdg);') >= 0 && navSrc.indexOf('driveAnimKick();') >= 0);
check('the animator eases heading on the shortest arc, bounded per frame, and eases the centre',
  navSrc.indexOf('function driveAnim()') >= 0 &&
  navSrc.indexOf('((S.heading - S.drive.headingApplied + 540) % 360) - 180') >= 0 &&
  navSrc.indexOf('Math.max(-3, Math.min(3, dh * 0.22))') >= 0 &&
  navSrc.indexOf('requestAnimationFrame(driveAnim)') >= 0);
check('the animator dies with the drive (cancel on exit, S.drive re-checked per frame)',
  navSrc.indexOf('cancelAnimationFrame(S.drive.animId)') >= 0 &&
  navSrc.indexOf('if (!S || !S.drive) return;') >= 0);

console.log('— A3: thicker lines, bigger names —');
check('drive line casing 24 / core 18; planning line 8; drive zoom 18',
  navSrc.indexOf("color: '#ffffff', weight: 24") >= 0 &&
  navSrc.indexOf("color: '#1a56db', weight: 18") >= 0 &&
  navSrc.indexOf('weight: 8, opacity: 0.9') >= 0 &&
  navSrc.indexOf('}).setView(S.pos || S.line[0], 18);') >= 0);

console.log('— F2: arrows on the line + the turn inset —');
check('the arrow pool is created once at Drive start (10 markers) and only mutated after',
  navSrc.indexOf('S.drive.arrows = [];') >= 0 && navSrc.indexOf('ai < 10') >= 0 &&
  navSrc.indexOf('mk2.setLatLng(rem.points[pi + 1]);') >= 0 &&
  navSrc.indexOf('mk2.setIcon(arrowIcon(bearingDeg(rem.points[pi], rem.points[pi + 1])));') >= 0);
check('chevrons rotate by SVG transform attribute inside a cached divIcon (no CSS transform added)',
  navSrc.indexOf('function arrowIcon(bearing)') >= 0 &&
  navSrc.indexOf('<g transform="rotate(\' + bucket + \' 17 17)">') >= 0 &&
  !/\.nv-route-arrow\{[^}]*transform/.test(cssSrc) && /\.nv-route-arrow\{background:transparent;border:none;\}/.test(cssSrc));
check('turnDeltaDeg measures the bend off the route geometry (pure inputs, signed degrees)',
  navSrc.indexOf('function turnDeltaDeg(plan, line, idx)') >= 0 &&
  navSrc.indexOf('pointAlongLine(line, Math.max(0, m - 60))') >= 0);
/* PIN MOVED by v195 (NAV-POPUP, owner Oct 21, 2026 08:09 MDT):
   the pop-up window doubled 400 m -> 800 m and the card became
   the junction view — see nav-popup-v195-test.js. */
check('the inset exists, shows inside 800 m (v195), repaints on change only (insetKey)',
  navSrc.indexOf('id="nvd_inset"') >= 0 &&
  navSrc.indexOf('dp.toTurnM <= 800') >= 0 &&
  navSrc.indexOf('S.drive.insetKey !== insetKey') >= 0 &&
  cssSrc.indexOf('.nv-drive-inset{') >= 0);
check('no lane fabrication: the module never claims lane data it does not have',
  !/lanes?:\s*\[/.test(navSrc) && navSrc.indexOf('never invented lanes') >= 0);

console.log('— ship pins —');
check('ships as webVersion 188 with the changed files at the 199 pin',
  ver.webVersion === 222 &&
  idxSrc.indexOf('src="modules/navigator.js?v=222"') >= 0 &&
  idxSrc.indexOf('href="css/style.css?v=222"') >= 0,
  'webVersion=' + ver.webVersion);

console.log('\nnavigator-v178: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
