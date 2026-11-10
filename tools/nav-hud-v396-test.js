#!/usr/bin/env node
/* Meticulous v396 — NAV-SPEED-LIMIT-RED-NOV10 +
 * NAV-HUD-LAYOUT-NOV10 tests.
 *
 * Owner (Nov 10, 2026, from live driving, verbatim):
 *  "First of all, the speed limiter is always on red, on first
 *   glance it seems like the user is driving too fast. As they
 *   are usually used to the speedometer on Google Maps, second
 *   of all why are the three speedometer speed limiter and
 *   road hand all clumped up together on the left I told you I
 *   want the road hand on the right and speedometer should be
 *   dynamic"
 *
 * THE DEFECTS (convicted below, failing-first on the shipped
 * web-395 bytes):
 *  1. RED ALWAYS: .nv-drive-limit (css/style.css) is drawn as
 *     a red sign in its ONLY state — background #fff, text
 *     #c81e1e, 4px border #c81e1e. Nothing in the code ever
 *     recolours it: paintSpeedOverlay only sets its text and
 *     its hidden class. So at 40 in a 50 zone the sign glows
 *     the red of a violation. Google Maps' law (his reference):
 *     the limit sign stays a NEUTRAL sign and turns red ONLY
 *     when the current speed is actually over the limit.
 *  2. THE LEFT CLUMP: the speed wrap (.nv-drive-speed, left
 *     10px, bottom 96px) STACKS speedo over limit in a column,
 *     and the road hand — #chatFab, the element this codebase
 *     itself names "the road hand" (css v93 header, js/
 *     chatbot.js) — was moved by v280 from its right-edge dock
 *     to bottom-LEFT on the speedometer's own line (left:92px,
 *     bottom:96px). Three drive controls share one corner.
 *
 * THE FIX (v396):
 *  1. The limit sign's standing dress is NEUTRAL (white sign,
 *     near-black border + number — a real speed sign). Red
 *     lives only in .nv-drive-limit.over. The judge is the
 *     NAVPURE speedOverLimit(shownKmh, limitKmh): true only
 *     when the speed the dial SHOWS (the rounded km/h the
 *     driver reads) is over a known limit; unknown speed or
 *     unknown limit is never "over". paintSpeedOverlay applies
 *     the class, and the drive tick repaints the overlay on
 *     the same tick that moves the dial — the colour is live.
 *  2. The road hand returns to the RIGHT edge, centred by
 *     arithmetic — the exact v135/v139 dock geometry
 *     (top:calc(50% - 26px), right:calc(6px + safe-area)),
 *     whose pins in navigator-v135 (K1) and navigator-v139
 *     have stood FAILING since v280 moved the dock; this ship
 *     repairs them. The v280 wave-C mic assertion is flipped
 *     with a marked pin move (the owner's newer order wins).
 *  3. The speedometer is DYNAMIC as one unit, Google-style:
 *     .nv-drive-speed becomes a ROW — the live dial prominent,
 *     the limit sign beside it, one wrap (#nvd_speedwrap),
 *     not a stacked column in the clump.
 *
 * Run: node tools/nav-hud-v396-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const navSrc = read('modules/navigator.js');
const cssSrc = read('css/style.css');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, got === want, 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function rule(sel) {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = cssSrc.match(new RegExp(esc + '\\{[^}]*\\}'));
  return m ? m[0] : '';
}
function extract(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error('markers missing');
  return src.slice(i, j + b.length);
}

console.log('— A. the over-limit judge (NAVPURE): red ONLY when over —');
const sb = { console: console, Math: Math };
vm.createContext(sb);
vm.runInContext(extract(navSrc, '/* ================= NAVPURE-BEGIN =================', '/* ================= NAVPURE-END ================= */'), sb);
const over = sb.speedOverLimit;
ok('speedOverLimit is in NAVPURE', typeof over === 'function');
if (typeof over === 'function') {
  eq('under the limit is NOT over (40 in a 50)', over(40, 50), false);
  eq('AT the limit is NOT over (50 in a 50)', over(50, 50), false);
  eq('one over IS over (51 in a 50)', over(51, 50), true);
  eq('highway over IS over (118 in a 100)', over(118, 100), true);
  eq('parked is NOT over (0 in a 50)', over(0, 50), false);
  eq('unknown speed is never over', over(null, 50), false);
  eq('unknown limit is never over (no borrowed red)', over(90, null), false);
  eq('a zero/garbage limit is never over', over(90, 0), false);
}

console.log('— B. the sign dress: neutral standing, red only in .over —');
const limRule = rule('.nv-drive-limit');
ok('the limit sign exists', limRule.length > 0, limRule);
ok('the standing sign carries NO red (not #c81e1e anywhere in the base rule)',
  limRule.length > 0 && limRule.indexOf('#c81e1e') < 0, limRule);
ok('the standing sign is a neutral sign (dark border + dark number on white)',
  /border:4px solid #[0-9a-fA-F]{6}/.test(limRule) && /background:#fff/.test(limRule), limRule);
const overRule = rule('.nv-drive-limit.over');
ok('an .over state exists for the sign', overRule.length > 0, overRule);
ok('the .over state is the red one (border + number #c81e1e)',
  overRule.indexOf('#c81e1e') >= 0, overRule);

console.log('— C. wiring: the painter judges, the tick keeps it live —');
ok('paintSpeedOverlay toggles the over class through the NAVPURE judge',
  /classList\.toggle\('over',\s*!!v && speedOverLimit\(shownKmh, S\.limitKmh\)\)/.test(navSrc));
ok('the judged speed is the speed the dial shows (rounded km/h from S.speed)',
  /Math\.max\(0, Math\.round\(S\.speed \* 3\.6\)\)/.test(navSrc));
ok('the drive tick repaints the overlay beside the speed write (colour is live, not fetch-stale)',
  /driveText\(spdEl, 'speed'[\s\S]{0,700}paintSpeedOverlay\(\)/.test(navSrc));
ok('paintSpeedOverlay still hides the badge when the limit is unknown (no invented number)',
  /classList\.toggle\('hidden', !v\)/.test(navSrc));

console.log('— D. the road hand: back on the RIGHT edge —');
const dock = rule('body.mt-driving #chatFab');
ok('the drive dock rule exists', dock.length > 0, dock);
ok('the road hand docks on the RIGHT edge (right:calc(6px + safe-area))',
  /right:calc\(6px \+ env\(safe-area-inset-right,0px\)\)/.test(dock), dock);
ok('the dock is centred by arithmetic (top:calc(50% - 26px)), the v135/v139 geometry',
  /top:calc\(50% - 26px\)/.test(dock), dock);
ok('the dock is NOT on the left anymore (no left:92px speedometer-line perch)',
  dock.indexOf('left:calc(92px') < 0 && dock.indexOf('bottom:calc(96px') < 0, dock);
ok('the dock carries NO transform (the v139 vanishing-layer law)',
  !/(^|[;{])\s*transform\s*:/.test(dock), dock);
ok('the dock stays above the drive screen (z-index:2100)', /z-index:2100/.test(dock), dock);
ok('the mic is still display:none in PiP (NAV-PIP-NO-MIC-BUTTON untouched)',
  /body\.mt-pip #chatFab\{[^}]*display:none/.test(cssSrc));
ok('outside Drive the FAB keeps its ordinary spot (base rule untouched)',
  /#chatFab\{[^}]*bottom:88px/.test(cssSrc));

console.log('— E. the speedometer: one dynamic unit, not a stacked clump —');
const wrapRule = rule('.nv-drive-speed');
ok('the speed wrap exists', wrapRule.length > 0, wrapRule);
ok('the wrap is a ROW (dial beside the sign), not a column stack',
  /flex-direction:row/.test(wrapRule) && !/flex-direction:column/.test(wrapRule), wrapRule);
ok('the wrap stays docked bottom-left as ONE unit (left:10px, the speed line)',
  /left:10px/.test(wrapRule) && /bottom:calc\(96px/.test(wrapRule), wrapRule);
ok('the markup keeps dial + sign inside the one wrap (#nvd_speedwrap)',
  navSrc.indexOf('id="nvd_speedwrap"') >= 0 &&
  navSrc.indexOf('id="nvd_speed"') > navSrc.indexOf('id="nvd_speedwrap"') &&
  navSrc.indexOf('id="nvd_limit"') > navSrc.indexOf('id="nvd_speedwrap"'));
ok('the dial is still painted live from the GPS stream (the dynamic readout)',
  /driveText\(spdEl, 'speed', \(S\.speed !== null/.test(navSrc));

console.log('— F. THEN: the version pins —');
eq('webVersion is 396', ver.webVersion, 396);
ok('index.html pins navigator.js?v=396', idxSrc.indexOf('modules/navigator.js?v=396') >= 0);
ok('index.html pins style.css?v=396', idxSrc.indexOf('css/style.css?v=396') >= 0);
eq('the native pointer is preserved (version 73)', ver.version, 73);

console.log('\nnav-hud-v396 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
