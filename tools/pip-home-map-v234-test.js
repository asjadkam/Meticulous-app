/* pip-home-map-v234-test.js — PIP-HOME-SHOWS-FACE-NOT-MAP.
 *
 * Asjad, Fri Oct 23 2026 11:39 MDT, his screen recording: Back
 * from the map correctly lands on the dashboard, but pressing
 * HOME while navigation is running floats the SAME tracker
 * strip face (timer + loads + instruction line) — NOT the map.
 * His words: "in the sis it just shows the same sis when I
 * press home while on dashboard.. Not the map as it should."
 *
 * Standing law: when navigation is active, the floating
 * picture-in-picture must BE the live map (the drive screen in
 * its .nv-pip posture — pointed arrow, small words at the
 * bottom); the map shuts off only via End drive or the map's
 * X. The tracker bubble cluster (v231) is the float only when
 * NOT navigating.
 *
 * REPRODUCTION (code-level, exact): MainActivity.onUserLeaveHint
 * calls showPipFace() unconditionally whenever navDriving ||
 * sessionActive || armed — so mid-navigation the shell-drawn
 * tracker face is laid over the decor and the PiP window shows
 * it (the web layer even feeds it the next-direction line),
 * while the drive screen underneath has already swapped to
 * its .nv-pip map posture on pipChanged, covered. RED before
 * the fix on exactly that: no navDriving guard on the face.
 *
 * Parts:
 *  A — native statics: the face never goes up while navigation
 *      is active (guard inside showPipFace, the single seat);
 *      PiP entry + the wide nav ratio are untouched; the v231
 *      see-through still lives inside showPipFace (so it can
 *      only ever apply when the face legitimately goes up —
 *      the map keeps its window); the widget stand-down still
 *      rides the PiP mode change in both cases.
 *  B — web statics: the map side of the law is intact — the
 *      drive screen swaps to .nv-pip on the shell's pip event;
 *      the web bubble face already stands down while driving;
 *      the driving fact flows web -> wrapper -> plugin static.
 *  C — release pins: web v234 / native v42 (versionCode 17).
 *      (Ship number 234, not 233: a connect run's v233 work was
 *      in flight in the tree when this run prepared — numbers
 *      follow landing order, as with v230/v231/v232 before it.)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; fails.push(name); console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function sliceBetween(s, a, b) {
  const i = s.indexOf(a);
  if (i < 0) return '';
  const j = s.indexOf(b, i + a.length);
  return j < 0 ? s.slice(i) : s.slice(i, j);
}

const NAT = path.join(ROOT, '..', 'meticulous-native', 'android', 'app', 'src', 'main');
const main = fs.readFileSync(path.join(NAT, 'java', 'com', 'meticuloustechnologies', 'app', 'MainActivity.java'), 'utf8');
const plugin = fs.readFileSync(path.join(NAT, 'java', 'com', 'meticuloustechnologies', 'app', 'ShiftTrackPlugin.java'), 'utf8');
const gradle = fs.readFileSync(path.join(NAT, '..', '..', 'build.gradle'), 'utf8');

/* ================= PART A — native ================= */
console.log('PART A — while navigating, the float is the map, never the tracker face');
{
  const showSlice = sliceBetween(main, 'public void showPipFace()', 'public void hidePipFace()');
  ok('A1 showPipFace refuses to go up while navigation is active (navDriving guard returns before the face is added)',
    /if\s*\(\s*ShiftTrackPlugin\.navDriving\s*\)\s*return\s*;/.test(showSlice),
    'no navDriving return-guard in showPipFace');
  ok('A2 the guard sits BEFORE the face is attached (the guard precedes addView in the method)',
    showSlice.indexOf('navDriving') >= 0 && showSlice.indexOf('addView') > showSlice.indexOf('navDriving'));
  const leaveSlice = sliceBetween(main, 'protected void onUserLeaveHint()', '/* v227: put the native tracker face');
  ok('A3 the leave handler still enters PiP in both worlds (enterPipNow + the will-enter announcement survive)',
    /enterPipNow\(\)/.test(leaveSlice) && /onPipWillEnter\(\)/.test(leaveSlice));
  const ratioSlice = sliceBetween(main, 'private Rational pipRatio()', '/* v227: the float');
  ok('A4 the float keeps its navigation shape: pipRatio still keys 16:10 off navDriving (4:3 is the tracker face\'s)',
    /navDriving/.test(ratioSlice) && /16,\s*10/.test(ratioSlice) && /4,\s*3/.test(ratioSlice));
  ok('A5 the v231 see-through still lives inside showPipFace (INVISIBLE + TRANSPARENT) — gated with the face, never applied over the map',
    /INVISIBLE/.test(showSlice) && /TRANSPARENT/.test(showSlice));
  const modeSlice = sliceBetween(main, 'public void onPictureInPictureModeChanged', 'protected void onDestroy');
  ok('A6 the widget stand-down still rides the PiP mode change (one-float rule in both worlds)',
    /setFloatActive/.test(modeSlice) || /setFloatActive/.test(sliceBetween(main, 'onPictureInPictureModeChanged', '\n    }\n}')));
  ok('A7 the plugin\'s web-called enterPip adds NO face (enterPipNow only) — the leave handler remains the face\'s only door',
    !/showPipFace/.test(sliceBetween(plugin, 'public void enterPip(PluginCall call)', '@PluginMethod')));
}

/* ================= PART B — web ================= */
console.log('PART B — the map side of the law is intact');
{
  const nav = read('modules/navigator.js');
  ok('B1 the drive screen swaps to its .nv-pip map posture on the shell\'s pip event (and restores on exit)',
    /classList\.toggle\('nv-pip'/.test(nav) && /addPipListener/.test(nav));
  const app = read('js/app.js');
  const refreshSlice = sliceBetween(app, 'function refreshBubbleFace()', '/* v227: the shell-drawn PiP face');
  ok('B2 the web bubble face already stands down while driving (pipShow excludes ShiftTrack._driving)',
    /_driving/.test(refreshSlice));
  const wrap = read('js/shifttrack.js');
  ok('B3 the driving fact flows end to end: wrapper setDriving flips _driving, plugin stores navDriving',
    /_driving\s*=\s*!!on/.test(wrap) && /navDriving\s*=/.test(plugin));
}

/* ================= PART C — release pins ================= */
console.log('PART C — release pins (web v234 / native v42, versionCode 17)');
{
  const vj = JSON.parse(read('version.json'));
  ok('C1 version.json: webVersion 234, native version 42', vj.webVersion === 241 && vj.version === 42,
    'webVersion=' + vj.webVersion + ' version=' + vj.version);
  ok('C2 APK_VERSION 42 in js/app.js', /var APK_VERSION = 42;/.test(read('js/app.js')));
  ok('C3 native versionCode 17 / versionName 1.15', /versionCode 17/.test(gradle) && /versionName "1\.15"/.test(gradle));
}

console.log('\n' + pass + ' pass, ' + fail + ' fail');
if (fail) { console.log('FAILING: ' + fails.join(' | ')); process.exit(1); }
