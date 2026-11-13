'use strict';
/* nav-pip-float-v447-test.js — NAV-PIP-FLOAT-TRIO (Nov 13, 2026,
 * owner screen recording 07:10-07:11 CST + his words): while
 * navigating with NO live session, Back floats the drive screen
 * as the in-app mini map — and in his hands the float is broken
 * three ways:
 *   (a) NO MAP: the float is a plain blue gradient with only the
 *       pointed arrow + the next-turn strip. The park re-fits the
 *       Leaflet map ONCE, synchronously, in the same turn the
 *       screen is moved into the dock and shrunk — on the phone
 *       the shrunken box has not laid out yet, so Leaflet keeps
 *       its full-screen pixel size and the window shows the
 *       off-plane sky gradient (the v273 defect family; the
 *       map's own creation path never trusts a single immediate
 *       pass — it re-fits at 120 ms and 650 ms, v107). The park
 *       path has NO settle pass.
 *   (b) NOT DRAGGABLE: the parked mini installs a tap handler
 *       only. Nothing in the module or the CSS lets the driver
 *       move the float.
 *   (c) BACK DUMPS OUT OF NAV: with the Places panel open over
 *       a live drive, Back parks the drive + lands on the
 *       dashboard — the v287 drive-first gate shadows the v348
 *       panel closer, whose own law is that Back folds the
 *       panel FIRST, "before anything else on the map face".
 *       S.backFn (exitDrive) must stay AFTER the park attempt —
 *       it ENDS the drive; moving it earlier would make Back
 *       kill navigation instead of floating it.
 *
 * Method: brace-matched extraction of the real functions from
 * modules/navigator.js, evaluated in a vm sandbox with fakes —
 * the suite's established idiom (back-button-test.js).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const NAV = fs.readFileSync(path.join(ROOT, 'modules', 'navigator.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; fails.push(name); console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

/* brace-matched extraction of `function NAME(...) { ... }` */
function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  let j = src.indexOf('{', i), depth = 0, k = j;
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { k++; break; } }
  }
  return src.slice(i, k);
}
/* extraction of an object property `key: function (...) { ... }` */
function extractProp(src, key) {
  const i = src.indexOf(key + ': function');
  if (i < 0) return null;
  let j = src.indexOf('{', i), depth = 0, k = j;
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { k++; break; } }
  }
  return 'var __prop = ' + src.slice(i + key.length + 2, k) + ';';
}

/* ================= (a) settle refits on posture change ===== */
console.log('A — the parked mini re-fits its map after layout settles');
{
  const docEl = extractFn(NAV, 'docEl');
  const refit = extractFn(NAV, 'refitDriveMap');
  const apply = extractFn(NAV, 'applyPipFace');
  ok('A0 the pip seams extract (docEl / refitDriveMap / applyPipFace)', !!(docEl && refit && apply));
  if (docEl && refit && apply) {
    let refits = 0;
    const timers = [];
    const el = () => ({ classList: { toggle() {}, add() {}, remove() {} }, style: {}, innerHTML: '' });
    const sandbox = {
      S: { drive: {}, _refitDrive: function () { refits++; } },
      nvBody: null,
      document: { getElementById: function () { return el(); }, body: { classList: { toggle() {}, add() {} } } },
      avatarGlyph: function () { return ''; },
      avatarBoxStyle: function () { return ''; },
      setTimeout: function (fn, ms) { timers.push({ fn, ms }); return timers.length; },
      clearTimeout: function () {},
      console
    };
    vm.createContext(sandbox);
    vm.runInContext(docEl + '\n' + refit + '\n' + apply, sandbox);
    sandbox.applyPipFace(true);
    const syncRefits = refits;
    ok('A1 the posture change still re-fits immediately (existing behaviour kept)', syncRefits >= 1, 'sync refits=' + syncRefits);
    const settle = timers.filter(t => t.ms >= 100);
    ok('A2 settle re-fits are scheduled after a posture change (the park must not trust one same-turn pass)',
      settle.length >= 1, 'pending timers=' + timers.length + ' settle=' + settle.length);
    settle.forEach(t => t.fn());
    ok('A3 the settle passes actually re-fit the drive map', refits > syncRefits, 'refits after settle=' + refits);
  }
}

/* ================= (b) the mini is draggable ================ */
console.log('B — the parked mini map can be dragged');
{
  ok('B1 the module installs a drag on the parked mini (pointerdown/move/up handlers exist)',
    /pointerdown/.test(NAV) && /pointermove/.test(NAV) && /pointerup/.test(NAV));
  ok('B2 the mini CSS lets pointer drags reach the handlers (touch-action:none on .nv-mini)',
    /\.nv-drive\.nv-mini\{[^}]*touch-action\s*:\s*none/.test(CSS));
  const drag = extractFn(NAV, 'installMiniDrag');
  const undrag = extractFn(NAV, 'removeMiniDrag');
  ok('B3 a named installMiniDrag seam exists for the park path', !!drag);
  if (drag) {
    const listeners = {};
    const scr = {
      style: {},
      addEventListener: function (t, fn) { listeners[t] = fn; },
      removeEventListener: function (t) { delete listeners[t]; },
      getBoundingClientRect: function () { return { left: 500, top: 600, width: 180, height: 135 }; },
      setPointerCapture: function () {}
    };
    const sandbox = {
      S: {},
      window: { innerWidth: 800, innerHeight: 1000 },
      console
    };
    vm.createContext(sandbox);
    vm.runInContext((undrag || '') + '\n' + drag, sandbox);
    sandbox.installMiniDrag(scr);
    ok('B4 installing the drag wires pointerdown on the mini', typeof listeners.pointerdown === 'function');
    if (listeners.pointerdown) {
      listeners.pointerdown({ clientX: 590, clientY: 660, pointerId: 1, preventDefault() {} });
      listeners.pointermove({ clientX: 490, clientY: 560, pointerId: 1, preventDefault() {} });
      ok('B5 a drag moves the float (left/top follow the finger, right/bottom released)',
        scr.style.left === '400px' && scr.style.top === '500px' && scr.style.right === 'auto' && scr.style.bottom === 'auto',
        JSON.stringify(scr.style));
      listeners.pointerup({ clientX: 490, clientY: 560, pointerId: 1, preventDefault() {} });
      ok('B6 a real drag swallows the follow-up tap (the float must not reopen full-screen after a move)',
        sandbox.S._miniDragSwallow === true);
      /* a plain tap: no movement -> no swallow, no reposition */
      sandbox.S._miniDragSwallow = false; scr.style = {};
      listeners.pointerdown({ clientX: 590, clientY: 660, pointerId: 1, preventDefault() {} });
      listeners.pointerup({ clientX: 592, clientY: 661, pointerId: 1, preventDefault() {} });
      ok('B7 a plain tap is untouched (no swallow, no move) — tap-to-reopen still works',
        sandbox.S._miniDragSwallow !== true && scr.style.left === undefined);
    }
  }
}

/* ================= (c) Back folds in-nav layers first ====== */
console.log('C — Back on the GPS screen steps within navigation before it floats');
{
  const backSrc = extractProp(NAV, 'back');
  ok('C0 the module back() extracts', !!backSrc);
  if (backSrc) {
    let parkCalls = 0, panelOpen = true;
    const sandbox = {
      S: { drive: {}, parked: false },
      nvFace: 'drive',
      nvBody: null,
      nvPlacesPanelCloser: function () { if (panelOpen) { panelOpen = false; return true; } return false; },
      parkDrive: function () { parkCalls++; sandbox.S.parked = true; return true; },
      window: {},
      console
    };
    vm.createContext(sandbox);
    vm.runInContext(backSrc + '\nvar back = __prop;', sandbox);
    const r1 = sandbox.back();
    ok('C1 Back with the Places panel open over a live drive folds the panel and STAYS in navigation',
      r1 === true && parkCalls === 0 && panelOpen === false,
      'returned=' + r1 + ' parkCalls=' + parkCalls + ' panelOpen=' + panelOpen);
    const r2 = sandbox.back();
    ok('C2 Back at the bare drive face still parks/floats (his Oct 22 PIP-LANDS-HOME law unchanged)',
      r2 === true && parkCalls === 1, 'returned=' + r2 + ' parkCalls=' + parkCalls);
    ok('C3 back() never reaches S.backFn/exitDrive before the park (Back must not end navigation)',
      backSrc.indexOf('parkDrive()') >= 0 &&
      (backSrc.indexOf('S.backFn') < 0 || backSrc.indexOf('S.backFn') > backSrc.indexOf('parkDrive()')));
  }
}

console.log('\n' + pass + ' pass, ' + fail + ' fail');
if (fail) { console.log('FAILING: ' + fails.join(' | ')); process.exit(1); }
