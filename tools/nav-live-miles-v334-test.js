'use strict';
/*
 * nav-live-miles-v334-test.js — LIVE-MILES-ON-NAV-SCREEN: the
 * day's live miles must be visible ON the navigation screen,
 * so the driver never has to leave a drive to check them.
 *
 * Build (v334): a quiet third line in the drive bar's ETA
 * stack (#nvd_miles), painted by the drive tick from
 * LiveMiles.currentKm — the tracker dial's own reader (v41:
 * null before the first fix, and null hides the line; no data
 * is never shown as 0 km). Named placement choice: the DRIVE
 * bar only — that is the screen he is trapped on mid-drive;
 * the planning screen is one tap from Home, where the tracker
 * card already shows the figure.
 *
 * THEN: webVersion is 334 + index tags.
 */
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
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

/* render the module (the v330 harness shape) and read the
   painted drive-screen markup */
function makeEl() {
  const el = {
    children: {}, style: {}, dataset: {}, value: '', textContent: '', _html: '',
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    setAttribute: function () {}, getAttribute: function () { return null; },
    addEventListener: function () {}, appendChild: function () {},
    querySelector: function () { return makeEl(); }, querySelectorAll: function () { return []; }
  };
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return this._html; },
    set: function (v) { this._html = String(v); }
  });
  return el;
}
const storeData = {};
const sb = {
  console: console, Date: Date, Math: Math, JSON: JSON, Promise: Promise, setTimeout: setTimeout, clearTimeout: clearTimeout,
  navigator: { geolocation: null },
  localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
  App: {
    _store: { get: function (k, d) { return (k in storeData) ? storeData[k] : d; }, set: function (k, v) { storeData[k] = v; return true; }, del: function (k) { delete storeData[k]; return true; } },
    _esc: function (s) { return String(s == null ? '' : s); },
    _today: function () { return '2026-11-05'; },
    openModule: function () {},
    geo: null, tracker: { status: 'running', startTs: Date.now() - 3600000 }
  },
  Meticulous: { modules: {} },
  L: undefined,
  LiveMiles: { currentKm: function () { return 87.32; }, subscribe: function () {}, flowing: function () { return true; } },
  fetch: function () { return Promise.reject(new Error('offline')); }
};
sb.window = sb;
vm.createContext(sb);
vm.runInContext(navSrc, sb, { filename: 'modules/navigator.js' });
const body = makeEl();
sb.Meticulous.modules.navigator.render(body);
const h = body.innerHTML;

ok('the drive bar carries the miles line', h.indexOf('id="nvd_miles"') >= 0);
ok('it sits in the ETA stack (after the ETA sub, before the bar buttons)',
  h.indexOf('id="nvd_eta_sub"') >= 0 &&
  h.indexOf('id="nvd_eta_sub"') < h.indexOf('id="nvd_miles"') &&
  h.indexOf('id="nvd_miles"') < h.indexOf('id="nvd_mute"'));
ok('it starts hidden (no figure until the engine has one)', h.indexOf('class="nv-drive-miles hidden" id="nvd_miles"') >= 0);
ok('the tick paints it from LiveMiles.currentKm',
  navSrc.indexOf("typeof LiveMiles.currentKm === 'function'") >= 0 && navSrc.indexOf("driveText(milesEl, 'milesToday', '🛣 ' + dayKm.toFixed(1) + ' km today')") >= 0);
ok('a null figure hides the line (never a fake zero)',
  navSrc.indexOf("milesEl.classList.add('hidden')") >= 0 && navSrc.indexOf('no data is not 0 km') >= 0);
ok('the CSS gives it the quiet sub-line style', cssSrc.indexOf('.nv-drive-miles{') >= 0);
ok('webVersion is 334', ver.webVersion === 334, 'got ' + ver.webVersion);
ok('index.html pins navigator.js?v=334 + style.css?v=334',
  idxSrc.indexOf('modules/navigator.js?v=334') >= 0 && idxSrc.indexOf('css/style.css?v=334') >= 0);

console.log('\nnav-live-miles-v334 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
