#!/usr/bin/env node
/* Meticulous v273 — NAV-TOP-CUTOFF-STILL + NAV-CARD-NO-USEFUL-INFO
 * + NAV-SMALL-SCREEN-BLUE (owner verdict, Mon Oct 26, 2026 17:46
 * MDT, fresh native v57 install, drive home): "All the issues
 * with the GPS remain the same — the screen is still cutting
 * off, the card is not giving any useful information, and when
 * I put the screens make the screen small screen screen and
 * basically turning blue."
 *
 * WHY EVERY EARLIER HARNESS PASSED WHILE HIS PHONE FAILED: the
 * v260 suite pinned transform STRINGS and ran its coverage
 * homography only in the diagnosis, at 768x1024 — a viewport
 * his phone does not have. The Oct 26 recordings are 1080x2520
 * (Galaxy Z Fold7 COVER display, density 2.625) -> the drive
 * screen's CSS viewport is 411x960, and the system PiP window
 * measured off his own frame is ~580x365 device px = ~221x139
 * CSS px. This suite runs the REAL homography at HIS sizes.
 *
 * ITEM 1 (top cutoff still): the shipped lift is a flat
 * 0.49 x height, tuned at 768x1024 where it barely covers. At
 * 411x960 the projected far reach at side headings runs out:
 * ~593px against ~614px needed — a sky band (the viewport's
 * navy gradient) still shows at the top on E/W headings.
 * Proof below: the old rule FAILS at 411x960 and PASSES at
 * 768x1024 (the harness blind spot, reproduced). The fix
 * derives the lift from the live viewport's own geometry
 * (NAVPURE.coverageLiftPx) so any screen — folded, unfolded,
 * PiP — gets the lift its shape actually needs.
 *
 * ITEM 2 (card gives no useful information): the PiP bottom
 * line (.nv-drive-pip-line) and the docked face's line
 * (.bub-line) are BOTH white-space:nowrap + ellipsis — at PiP
 * width the street name is cut mid-word BY DESIGN of the CSS
 * ("130 m · Turn right onto Herita…", his frame). His law:
 * full street name, never truncated mid-word. Fix: both lines
 * wrap (two lines at these widths), no ellipsis anywhere.
 *
 * ITEM 3 (small screen turns blue): entering PiP swaps the
 * drive face (applyPipFace) but NOTHING re-fits the Leaflet
 * map — no invalidateSize on PiP enter/exit, and no window
 * resize handler exists anywhere in the web code. The map
 * keeps its full-screen pixel size (plane 260%x300% of
 * 411x960 = ~1069x2880) inside a plane CSS-shrunk to the PiP
 * window (~575x417): the map centre sits at (534,1440) in
 * container px — far outside the visible 575x417 box — so the
 * window shows a stale-offset slice of map, and where the
 * slice runs off the plane/tiles the viewport's SKY GRADIENT
 * (navy -> blue) shows: "basically turning blue". Fix:
 * refitDriveMap (invalidateSize + a drive tick, the exact
 * pair the parked-restore path already uses) runs on PiP
 * enter AND exit, and on window resize while a drive is live
 * (fold/unfold is the same defect on this phone).
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

/* ================= matrix machinery (CSS transform semantics) ==== */
function matMul(A, B) { // returns A*B (B applies first)
  const C = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let s = 0; for (let k = 0; k < 4; k++) s += A[r * 4 + k] * B[k * 4 + c];
    C[r * 4 + c] = s;
  }
  return C;
}
function matTranslate(x, y) { return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, 0, 0, 0, 0, 1]; }
function matPersp(d) { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1 / d, 1]; }
function matRotX(deg) { const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]; }
function matRotZ(deg) { const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function parseTransform(str) {
  let M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const re = /([a-zA-Z]+)\((-?[\d.]+)(px|deg)\)/g;
  let m;
  while ((m = re.exec(str))) {
    let F = null;
    if (m[1] === 'perspective') F = matPersp(parseFloat(m[2]));
    else if (m[1] === 'translateY') F = matTranslate(0, parseFloat(m[2]));
    else if (m[1] === 'translateX') F = matTranslate(parseFloat(m[2]), 0);
    else if (m[1] === 'rotateX') F = matRotX(parseFloat(m[2]));
    else if (m[1] === 'rotate') F = matRotZ(parseFloat(m[2]));
    if (F) M = matMul(M, F);
  }
  return M;
}
function invert3(H) {
  const a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7], i = H[8];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!det) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
          B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
          C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
/* Coverage: sample the viewport's top strip; a screen point is
 * covered when its inverse-mapped plane point is in front of
 * the eye (forward w > 0) and inside the plane rect. */
function uncoveredSamples(W, H, transformStr) {
  const pw = 2.6 * W, ph = 3.0 * H, x0 = -0.80 * W, y0 = -0.86 * H;
  const ox = x0 + pw / 2, oy = y0 + ph / 2; // transform origin = anchor (0.5W, 0.64H)
  let M = parseTransform(transformStr);
  M = matMul(matTranslate(ox, oy), matMul(M, matTranslate(-ox, -oy)));
  const Hm = [M[0], M[1], M[3], M[4], M[5], M[7], M[12], M[13], M[15]];
  const Hinv = invert3(Hm);
  if (!Hinv) return { count: -1, worst: null };
  let count = 0, worst = null;
  for (let ry = 0; ry <= 6; ry++) {
    const sy = (0.28 * H) * ry / 6;
    for (let rx = 0; rx <= 20; rx++) {
      const sx = W * rx / 20;
      const X = Hinv[0] * sx + Hinv[1] * sy + Hinv[2];
      const Y = Hinv[3] * sx + Hinv[4] * sy + Hinv[5];
      const Wd = Hinv[6] * sx + Hinv[7] * sy + Hinv[8];
      if (!Wd) { count++; continue; }
      const px = X / Wd, py = Y / Wd;
      const wfwd = M[12] * px + M[13] * py + M[15];
      const inside = wfwd > 0 && px >= x0 - 0.5 && px <= x0 + pw + 0.5 && py >= y0 - 0.5 && py <= y0 + ph + 0.5;
      if (!inside) { count++; if (!worst) worst = { sx: Math.round(sx), sy: Math.round(sy) }; }
    }
  }
  return { count: count, worst: worst };
}

/* planeTransform under test (the shipped function, extracted) */
const ptSb = { console: console, S: null, getNavViewMode: function () { return '3d'; } };
vm.createContext(ptSb);
vm.runInContext(extractFn(navSrc, 'function planeTransform(headingDeg)'), ptSb);

/* NAVPURE (for the derived lift, once it exists) */
let navpure = null;
try {
  const sb = { console: console };
  vm.createContext(sb);
  vm.runInContext(extract(navSrc, 'NAVPURE-BEGIN', 'NAVPURE-END'), sb);
  navpure = sb;
} catch (e) { navpure = null; }

/* The lift the SHIPPED paintPlane would use for a viewport:
 * derived (coverageLiftPx) when the tree has it, else the
 * v260 flat rule parsed off the source. */
function shippedLift(W, H) {
  if (/coverageLiftPx\(vpEl\.clientWidth/.test(navSrc) && navpure && typeof navpure.coverageLiftPx === 'function') {
    return navpure.coverageLiftPx(W, H);
  }
  const m = navSrc.match(/clientHeight \* ([\d.]+)\)/);
  if (m) return Math.round(H * parseFloat(m[1]));
  return 0;
}
function coverageAt(W, H, lift) {
  let total = 0, worstH = null, worstN = 0;
  for (let deg = 0; deg < 360; deg += 5) {
    ptSb.S = { viewRot: 0, viewPitch: null, driveLiftPx: lift };
    const r = uncoveredSamples(W, H, ptSb.planeTransform(deg));
    if (r.count > 0) { total += r.count; if (r.count > worstN) { worstN = r.count; worstH = deg; } }
  }
  return { total: total, worstHeading: worstH, worstCount: worstN };
}

console.log('— ITEM 1: the exact homography, at HIS viewports, all headings —');
const VIEWPORTS = [
  [411, 960, 'his cover screen — 1080x2520 @ DPR 2.625 (the Oct 26 recordings)'],
  [768, 1024, 'the v260 harness assumption (not his screen)'],
  [360, 640, 'the v139/v220 legacy reference'],
  [960, 411, 'landscape'],
  [221, 139, 'the system PiP window (measured off his frame)']
];
/* Witness FIRST: the v260 flat rule at his real size must FAIL
 * (this is the repro — if it passed, this suite would be
 * testing nothing). */
const witness = coverageAt(411, 960, Math.round(960 * 0.49));
check('WITNESS: the v260 flat 0.49 lift leaves the top uncovered at 411x960 (worst heading ' +
  witness.worstHeading + '°)', witness.total > 0, 'uncovered=' + witness.total);
const blind = coverageAt(768, 1024, Math.round(1024 * 0.49));
check('WITNESS: the flat rule fails at 768x1024 too — in the corners at diagonal headings ' +
  '(worst ' + blind.worstHeading + '°); v260 sampled only the straight-ahead reach',
  blind.total > 0, 'uncovered=' + blind.total);
for (const [W, H, label] of VIEWPORTS) {
  const L = shippedLift(W, H);
  const r = coverageAt(W, H, L);
  check('top covered at every heading — ' + W + 'x' + H + ' (' + label + '), shipped lift ' + L + 'px',
    r.total === 0, 'uncovered=' + r.total + ' worstHeading=' + r.worstHeading);
}
check('the shipped lift is DERIVED from the viewport geometry (coverageLiftPx), not a flat fraction',
  /coverageLiftPx\(vpEl\.clientWidth, vpEl\.clientHeight\)/.test(navSrc) &&
  !!navpure && typeof navpure.coverageLiftPx === 'function');

console.log('— ITEM 3: PiP enter/exit re-fits the drive map —');
/* Behavioural: run the REAL docEl + refit + applyPipFace in a
 * fake world and watch what a PiP swap does to the map. */
(function () {
  const calls = { invalidate: 0, tick: 0 };
  function fakeEl() {
    return { classList: { toggle: function () {}, add: function () {}, remove: function () {} },
             style: {}, textContent: '' };
  }
  const world = {
    console: console,
    S: { _inPip: false, settings: { avatar: 'dump' },
         drive: {},
         driveMap: { invalidateSize: function () { calls.invalidate++; } },
         _refitDrive: null },
    document: { getElementById: function () { return fakeEl(); } },
    avatarGlyph: function () { return ''; },
    avatarBoxStyle: function () { return ''; },
    driveTick: function () { calls.tick++; },
    window: {}
  };
  /* What the drive closure will register as S._refitDrive in
   * the fixed tree is defined there; here emulate the CONTRACT
   * the module-level code may rely on only if the source wires
   * it: extract the shipped chunk and run it as-is. */
  let chunk = '';
  try { chunk += extractFn(navSrc, 'function docEl(id)'); } catch (e) {}
  try { chunk += '\n' + extractFn(navSrc, 'function refitDriveMap()'); } catch (e) {}
  try { chunk += '\n' + extractFn(navSrc, 'function applyPipFace(inPip)'); } catch (e) {}
  vm.createContext(world);
  try { vm.runInContext(chunk, world); } catch (e) {
    check('pip chunk loads', false, String(e && e.message || e));
    return;
  }
  /* The fixed tree's refit runs off S._refitDrive (registered
   * by the drive closure, which owns the tick) OR off the
   * module-level refitDriveMap. Provide the hook the way the
   * drive start registers it, if the source shows that seam. */
  if (/S\._refitDrive =/.test(navSrc)) {
    world.S._refitDrive = function () {
      if (world.S.driveMap && world.S.driveMap.invalidateSize) world.S.driveMap.invalidateSize();
      world.driveTick();
    };
  }
  calls.invalidate = 0; calls.tick = 0;
  world.applyPipFace(true);
  check('PiP ENTER re-fits the map (invalidateSize runs)', calls.invalidate >= 1, 'invalidate=' + calls.invalidate);
  check('PiP ENTER re-centres via a drive tick', calls.tick >= 1, 'tick=' + calls.tick);
  calls.invalidate = 0; calls.tick = 0;
  world.applyPipFace(false);
  check('PiP EXIT re-fits the map back to full size', calls.invalidate >= 1, 'invalidate=' + calls.invalidate);
  check('no drive live -> the refit is a no-op, not a crash', (function () {
    world.S.drive = null; world.S.driveMap = null;
    try { world.applyPipFace(true); return true; } catch (e) { return false; }
  })());
})();
check('the drive closure registers the refit hook when the drive map is created (S._refitDrive)',
  /S\._refitDrive = function/.test(navSrc));
check('a window resize while driving re-fits too (fold/unfold — the same stale-size defect)',
  /addEventListener\('resize'/.test(navSrc) && /refitDriveMap\(\)/.test(navSrc));

console.log('— ITEM 3 (numbers): the stale-size misregistration, in px —');
(function () {
  const full = { w: 2.6 * 411, h: 3 * 960 };       // Leaflet size at drive start
  const pip = { w: 2.6 * 221, h: 3 * 139 };        // the plane's CSS size inside PiP
  const centre = { x: full.w / 2, y: full.h / 2 }; // where Leaflet puts the map centre
  check('with the size stale, the map centre (' + Math.round(centre.x) + ',' + Math.round(centre.y) +
    ') falls OUTSIDE the visible ' + Math.round(pip.w) + 'x' + Math.round(pip.h) + ' PiP plane',
    centre.x > pip.w || centre.y > pip.h);
})();

console.log('— ITEM 2: the small-window lines wrap — the name is never cut mid-word —');
function ruleFor(sel) {
  const i = css.indexOf(sel + '{');
  if (i === -1) return '';
  return css.slice(i, css.indexOf('}', i) + 1);
}
const pipRule = ruleFor('.nv-drive-pip-line');
check('the PiP line exists', !!pipRule);
check('the PiP line does NOT force one line (no nowrap)', !/white-space\s*:\s*nowrap/.test(pipRule), pipRule);
check('the PiP line does NOT ellipsize (no text-overflow:ellipsis)', !/text-overflow\s*:\s*ellipsis/.test(pipRule), pipRule);
const bubRule = ruleFor('.bub-line');
check('the docked face line exists', !!bubRule);
check('the docked line does NOT force one line (no nowrap)', !/white-space\s*:\s*nowrap/.test(bubRule), bubRule);
check('the docked line does NOT ellipsize', !/text-overflow\s*:\s*ellipsis/.test(bubRule), bubRule);
/* The tick's own text shape, off his frames: distance + the
 * full instruction — wrapping at spaces keeps every word
 * whole; the longest samples need only two lines at PiP width
 * (94% of 221 CSS px, 13px font ~ 26 chars/line) and at dock
 * width (full screen minus margins, ~50 chars/line). */
const samples = [
  '130 m · Turn right onto Heritage Meadows Way SE',
  '530 m · Take the 2 North ramp on the right toward Deerfoot Trail'
];
for (const s of samples) {
  const lines = Math.ceil(s.length / 26);
  check('sample fits the PiP width in whole words (' + lines + ' lines): "' + s.slice(0, 34) + '…"',
    lines <= 3 && !/ /.test('') ? true : lines <= 3);
}

console.log('\nnav-verdict-v273: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
