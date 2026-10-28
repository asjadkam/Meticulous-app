#!/usr/bin/env node
/* Meticulous v260 — NAV-TOP-CUTOFF + NAV-PIXELATED-ROADS +
 * NAV-VIBRANT-COLORS + NAV-NO-UTURN suite (owner, Mon Oct 26,
 * 2026 07:41/07:43 MDT, driving Peigan Trail SE; the U-turn
 * behaviour itself is driven in navigator-v135-test.js §F —
 * this file pins the pure helpers, the transform strings, the
 * tile contract and the palette values).
 *
 * THE THREE RENDERING DEFECTS, as diagnosed on evidence:
 *  1. TOP CUTOFF — the map plane's far edge never reached the
 *     top of his 768x1024 drive screen: a homography of the
 *     exact v259 composition (plane 230%x300% at left -65% /
 *     top -86%, origin 50% 50%, anchor 50%/64%, perspective
 *     1100px, pitch 50°) projects the far edge only ~477px
 *     above the anchor against ~655px needed — the top ~15%
 *     uncovered at EVERY heading (the wide dark band under
 *     the banner was the viewport's sky gradient showing
 *     through). The v139/v220 coverage math used a 360x640
 *     reference screen. Fix: translateY compensation in
 *     planeTransform (lift = 0.49 x viewport height, set by
 *     paintPlane; posture stays exactly 50°) + plane width
 *     260%, and the follow camera centres on the compensated
 *     followTarget so the truck stays on its anchor.
 *  2. PIXELATION — the drive view runs at zoom 18 while the
 *     street layer was capped at native z15 (v232/v235, for
 *     Esri's blank fringe tiles): an 8x upscale. Live probes
 *     (Oct 26): Esri z18 over his home block 0/9 detailed
 *     tiles, z17 3/9; OpenStreetMap standard z18 9/9 home,
 *     8/9 Peigan. Fix: street source = OSM at native z18;
 *     satellite (verified real at z18) also native 18;
 *     hillshade stays 15 (soft relief, outside the complaint).
 *  3. PALE PALETTE — OSM raw is paler than Esri (suburb mean
 *     saturation 0.052), so the street lift is re-tuned by
 *     PIL simulation on the live tiles: saturate(2.3)
 *     hue-rotate(11deg) contrast(1.16) — suburb 0.052 ->
 *     0.110, Deerfoot/Bow 0.111 -> 0.206; water #a7c6e4 ->
 *     #98d1ff, trunk -> #ffbe40, primary -> #ffe749,
 *     motorway #e88ea0 -> #ff767e (the +11deg holds it out of
 *     the v124 hot-pink band; +22deg was simulated and
 *     rejected — water went periwinkle, parks teal).
 *  4. NO-UTURN — pure helpers pinned here (forwardOrigin,
 *     the via/heading request shapes); the routing behaviour
 *     is pinned in navigator-v135-test.js §F.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };
const navSrc = read('modules/navigator.js');
const css = read('css/style.css');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? ' — ' + detail : '')); }
}
function extract(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}
function extractFn(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) throw new Error('fn missing: ' + sig);
  let depth = 0, k = src.indexOf('{', i);
  const start = k;
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + sig);
}

/* ---------- NAVPURE: tile specs + forward helpers ---------- */
console.log('— NAVPURE: tile contract + forward-origin helpers —');
const sb = { console: console };
vm.createContext(sb);
vm.runInContext(extract(navSrc, 'NAVPURE-BEGIN', 'NAVPURE-END'), sb);

const spec = sb.driveTileSpec();
check('the drive street source is OpenStreetMap standard (real z18 detail over his areas)',
  /tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png/.test(spec.url), spec.url);
check('the street spec renders at NATIVE z18 (maxNative 18 — no upscaling)',
  spec.maxNative === 18, 'maxNative=' + spec.maxNative);
check('the street spec keeps the lift class (the palette scope)',
  spec.cls === 'nv-tile-street', spec.cls);
const sat = sb.satelliteTileSpec();
check('the satellite spec also renders native z18 (Esri imagery verified real at z18)',
  sat.maxNative === 18, 'maxNative=' + sat.maxNative);
check('paintDriveLayers reads the native zoom off the spec',
  /maxNativeZoom: spec\.maxNative \|\| 15/.test(navSrc));

const HOME = [51.15709, -113.93862];
const east = sb.forwardOrigin(HOME, 90, 500);
check('forwardOrigin 500 m east lands ~500 m away (±3 m), bearing ~90 (±2°)',
  Math.abs(sb.haversineM(east, HOME) - 500) < 3 && east[1] > HOME[1] && Math.abs(east[0] - HOME[0]) < 0.001,
  JSON.stringify(east) + ' d=' + sb.haversineM(east, HOME));
const north = sb.forwardOrigin(HOME, 0, 1200);
check('forwardOrigin 1200 m north lands ~1200 m away (±4 m), latitude up, longitude ~still',
  Math.abs(sb.haversineM(north, HOME) - 1200) < 4 && north[0] > HOME[0] && Math.abs(north[1] - HOME[1]) < 0.001,
  JSON.stringify(north));
check('forwardOrigin refuses junk (null pos, NaN heading, zero distance)',
  sb.forwardOrigin(null, 90, 500) === null && sb.forwardOrigin(HOME, NaN, 500) === null &&
  sb.forwardOrigin(HOME, 90, 0) === null);

/* ---------- buildRouteRequest shapes ---------- */
console.log('— buildRouteRequest: proven shape by default, forward shape on request —');
const plain = sb.buildRouteRequest(HOME, [51.1, -114.0], {}, 'truck', { routePref: 'fastest' });
check('the default request is the proven shape: 2 break locations, no heading, no through',
  plain.locations.length === 2 && plain.locations.every(function (l) { return l.type === 'break'; }) &&
  plain.locations[0].heading === undefined, JSON.stringify(plain.locations));
const fwd = sb.buildRouteRequest(HOME, [51.1, -114.0], {}, 'truck',
  { routePref: 'fastest', via: east, heading: 40 });
check('the forward request inserts ONE through location between origin and destination',
  fwd.locations.length === 3 && fwd.locations[1].type === 'through' &&
  Math.abs(fwd.locations[1].lat - east[0]) < 1e-9 && Math.abs(fwd.locations[1].lon - east[1]) < 1e-9,
  JSON.stringify(fwd.locations));
check('the forward request puts the heading on the ORIGIN location only',
  fwd.locations[0].heading === 40 && fwd.locations[1].heading === undefined &&
  fwd.locations[2].heading === undefined, JSON.stringify(fwd.locations));
check('truck costing survives the forward shape',
  fwd.costing === 'truck' && !!fwd.costing_options.truck &&
  fwd.costing_options.truck.use_truck_route === 1.0);

/* ---------- planeTransform strings ---------- */
console.log('— planeTransform: the cutoff compensation —');
const ptSb = { console: console, S: null, getNavViewMode: function () { return ptSb._mode || '3d'; }, _mode: '3d' };
vm.createContext(ptSb);
vm.runInContext(extractFn(navSrc, 'function planeTransform(headingDeg)'), ptSb);
const pt = ptSb.planeTransform;
ptSb.S = { viewRot: 0, viewPitch: null };
check('at rest with NO lift the transform is the v259 string byte-identical',
  pt(30) === 'perspective(1100px) rotateX(50deg) rotate(-30deg)', pt(30));
ptSb.S = { viewRot: 0, viewPitch: null, driveLiftPx: 500 };
check('with the lift the translateY segment lands between perspective and rotateX, pitch still 50°',
  pt(30) === 'perspective(1100px) translateY(-500px) rotateX(50deg) rotate(-30deg)', pt(30));
ptSb.S = { viewRot: 10, viewPitch: 55, driveLiftPx: 500 };
check('the composed (gesture) path carries the lift too, pitch from the gesture',
  pt(30) === 'perspective(1100px) translateY(-500px) rotateX(55deg) rotate(-40deg)', pt(30));
ptSb._mode = '2d';
check('2D stays flat — no translate, no pitch, lift or not',
  pt(30) === 'rotate(-40deg)', pt(30));
ptSb._mode = '3d';

/* ---------- follow wiring (source pins) ---------- */
console.log('— the follow camera compensates the same shift —');
check('followTarget exists and centres on the truck when no lift applies',
  /function followTarget\(\)/.test(navSrc) && /if \(!S\.driveMap \|\| !S\.driveLiftPx/.test(navSrc));
check('the tick pan, the animator and the snap-back all aim at followTarget',
  /S\.driveMap\.panTo\(ft, \{ animate: false \}\)/.test(navSrc) &&
  /var tgt = followTarget\(\) \|\| S\.pos;/.test(navSrc) &&
  /S\.driveMap\.panTo\(followTarget\(\) \|\| S\.pos, \{ animate: false \}\)/.test(navSrc));
check('paintPlane derives the lift from the live viewport (v273 RE-PIN: the flat 0.49-of-height ' +
  'fraction is superseded — it ran out on the owner\'s real 411x960 screen; the lift is now ' +
  'coverageLiftPx(clientWidth, clientHeight), derived per viewport — see nav-verdict-v273)',
  /S\.driveLiftPx = \(vpEl && vpEl\.clientHeight && !gestPivot\) \? coverageLiftPx\(vpEl\.clientWidth, vpEl\.clientHeight\) : 0;/.test(navSrc));
check('the lift suspends while a rotate/tilt gesture owns the view (v215 pivot contract)',
  /var gestPivot = S\._gestLock === 'rotate' \|\| S\._gestLock === 'tilt'/.test(navSrc) &&
  /if \(S\._gestLock !== 'pinch'\) gestureAnchor\(\);/.test(navSrc));

/* ---------- CSS pins: plane + palette ---------- */
console.log('— CSS: plane geometry + the vibrant palette —');
check('the plane is 460% x 300%, centred on the anchor (left:-180%, top:-86%)',
  /\.nv-drive-plane\{[^}]*width:460%;height:300%;left:-180%;top:-86%/.test(css));
/* v277 re-pin (NAV-SCREEN-STILL-CUTTING): the plane widened
 * 260% -> 460% — at the owner's real 411x960 the 260% width
 * covered only a third of the screen at side headings (the
 * full-viewport homography lives in nav-screen-cutting-v277).
 * The lift assertions in this suite are width-agnostic. */
const ti = css.indexOf('.nv-tile-street{');
const trule = ti === -1 ? '' : css.slice(ti, css.indexOf('}', ti) + 1);
check('the street lift is the v260 measured chain: saturate(2.3) hue-rotate(11deg) contrast(1.16)',
  /saturate\(2\.3\)/.test(trule) && /hue-rotate\(11deg\)/.test(trule) && /contrast\(1\.16\)/.test(trule), trule);
check('the lift stays scoped to the street class (satellite/hillshade unlifted)',
  css.indexOf('.nv-tile-sat{filter') === -1 && css.indexOf('.nv-tile-hill{filter') === -1);
check('the drive map underlay is the warm sand of the new palette',
  /\.nv-drive-map\{[^}]*background:#e9e2d0/.test(css));

console.log('\nnav-v260: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
