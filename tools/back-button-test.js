'use strict';
/* v60 ANDROID SYSTEM BACK — suite.
 *
 * Bug (owner, Oct 14): pressing the Android system back button CLOSED
 * Meticulous from any module, while the in-app back arrow worked. The
 * v18 handler only knew App.currentView and exitApp()'d on every back
 * press inside 'main' — modules/sheets swap inside #main without
 * touching currentView. The v60 fix extracts a pure decision
 * (App.navBackStep) + guarded registration (App.wireSystemBack) into a
 * SYS-BACK block in js/app.js; the DOM snapshot/perform side is thin
 * glue verified statically here.
 *
 * Verifies:
 *   1. Decision table: sheet (all 5) beats everything; sidebar next;
 *      onboarding step-back / step-0-to-auth; module -> dashboard;
 *      dashboard root / auth -> exit passthrough.
 *   2. Full state-grid sweep: every combination yields one of the six
 *      known actions — there is NO tracker-affecting action anywhere.
 *   3. Registration: no Capacitor / no plugin -> returns false, zero
 *      behavior; mock bridge -> listener registered once and drives
 *      fx.perform(fx.snapshot()) end to end; a throwing fx cannot
 *      escape the listener.
 *   4. Static wiring in js/app.js: snapshot reads the five sheet ids +
 *      sidebar + modView; perform dispatches to the sheets' own closers,
 *      closeSidebar, App.showDashboard, the onboarding step-back (with
 *      collectOnbInputs, like the in-app Back button) and exitApp; the
 *      old unconditional main-exit handler is gone; the new code adds
 *      no alert() and never calls tracker stop/toggle/save paths.
 *   5. Release coherence: index.html loads js/app.js?v=<webVersion>
 *      and webVersion is 60.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

/* ---------- extract the real SYS-BACK block from js/app.js ---------- */
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const b0 = appSrc.indexOf('/* SYS-BACK-BEGIN');
const b1 = appSrc.indexOf('/* SYS-BACK-END */');
check('SYS-BACK markers present in js/app.js', b0 >= 0 && b1 > b0);
const block = appSrc.slice(b0, b1 + '/* SYS-BACK-END */'.length);
check('extracted block has no tracker references', !/tracker/i.test(block));

const sandbox = { App: {}, console: console };
vm.createContext(sandbox);
vm.runInContext(block, sandbox);
const App = sandbox.App;
check('App.navBackStep defined', typeof App.navBackStep === 'function');
check('App.wireSystemBack defined', typeof App.wireSystemBack === 'function');
const step = App.navBackStep;

/* ---------- 1. decision table ---------- */
const SHEETS = ['trkStartSheet', 'trkEndSheet', 'odoSheet', 'loadSheet', 'fbSheet'];
SHEETS.forEach(function (id) {
  const a = step({ view: 'main', module: true, sidebar: true, sheet: id, onbStep: 0 });
  check('sheet ' + id + ' beats module+sidebar', a.act === 'sheet' && a.sheet === id, JSON.stringify(a));
});
check('sidebar closes before module nav',
  step({ view: 'main', module: true, sidebar: true, sheet: null }).act === 'sidebar');
check('module open -> dashboard',
  step({ view: 'main', module: true, sidebar: false, sheet: null }).act === 'module');
check('dashboard root -> exit passthrough',
  step({ view: 'main', module: false, sidebar: false, sheet: null }).act === 'exit');
check('auth -> exit',
  step({ view: 'auth', module: false, sidebar: false, sheet: null }).act === 'exit');
check('onboarding step 2 -> prev step',
  step({ view: 'onboarding', onbStep: 2, sheet: null, sidebar: false, module: false }).act === 'onb-prev');
check('onboarding step 1 -> prev step',
  step({ view: 'onboarding', onbStep: 1 }).act === 'onb-prev');
check('onboarding step 0 -> auth (never stranded)',
  step({ view: 'onboarding', onbStep: 0 }).act === 'onb-auth');
check('empty state -> exit, no throw', step({}).act === 'exit' && step().act === 'exit' && step(null).act === 'exit');

/* ---------- 2. state-grid sweep: no tracker-affecting action exists ---------- */
const KNOWN = { sheet: 1, sidebar: 1, 'onb-prev': 1, 'onb-auth': 1, module: 1, exit: 1 };
let gridOk = true, gridN = 0;
['main', 'onboarding', 'auth', 'other'].forEach(function (v) {
  [null].concat(SHEETS).forEach(function (sh) {
    [true, false].forEach(function (sb) {
      [true, false].forEach(function (md) {
        [0, 2].forEach(function (ob) {
          gridN++;
          const a = step({ view: v, sheet: sh, sidebar: sb, module: md, onbStep: ob });
          if (!a || !KNOWN[a.act]) gridOk = false;
          if (sh && a.act !== 'sheet') gridOk = false;             // a sheet always wins
          if (v === 'main' && !sh && !sb && !md && a.act !== 'exit') gridOk = false; // root exits
        });
      });
    });
  });
});
check('state grid (' + gridN + ' combos) yields only known, tracker-free actions', gridOk);

/* ---------- 3. registration + listener end-to-end ---------- */
let performed = [];
const fx = {
  state: { view: 'main', module: false, sheet: null, sidebar: false, onbStep: 0 },
  snapshot: function () { return this.state; },
  perform: function (a) { performed.push(a); },
};
check('no Capacitor -> wire returns false', App.wireSystemBack(undefined, fx) === false);
check('null Capacitor -> false', App.wireSystemBack(null, fx) === false);
check('Capacitor without Plugins -> false', App.wireSystemBack({}, fx) === false);
check('Capacitor without App plugin -> false', App.wireSystemBack({ Plugins: {} }, fx) === false);
check('App plugin without addListener -> false',
  App.wireSystemBack({ Plugins: { App: {} } }, fx) === false);
check('no-Capacitor paths performed nothing', performed.length === 0);

function mockCap() {
  const c = { listeners: {}, Plugins: { App: {
    addListener: function (ev, fn) { c.listeners[ev] = fn; },
    exitApp: function () {},
  } } };
  return c;
}
const cap = mockCap();
check('mock bridge -> wire returns true', App.wireSystemBack(cap, fx) === true);
check('backButton listener registered', typeof cap.listeners.backButton === 'function');

function press(state) { performed = []; fx.state = state; cap.listeners.backButton(); return performed[0]; }
check('press with end sheet open -> close sheet',
  (function (a) { return a && a.act === 'sheet' && a.sheet === 'trkEndSheet'; })(press({ view: 'main', module: false, sheet: 'trkEndSheet', sidebar: false, onbStep: 0 })));
check('press in module -> dashboard',
  press({ view: 'main', module: true, sheet: null, sidebar: false, onbStep: 0 }).act === 'module');
check('press at dashboard root (tracker may be running) -> exit action only',
  press({ view: 'main', module: false, sheet: null, sidebar: false, onbStep: 0 }).act === 'exit');
check('press in onboarding step 3 -> prev',
  press({ view: 'onboarding', module: false, sheet: null, sidebar: false, onbStep: 3 }).act === 'onb-prev');

const fxThrow = { snapshot: function () { throw new Error('dom gone'); }, perform: function () {} };
const cap2 = mockCap();
App.wireSystemBack(cap2, fxThrow);
let escaped = false;
try { cap2.listeners.backButton(); } catch (e) { escaped = true; }
check('throwing snapshot cannot escape the listener', !escaped);
const fxThrow2 = { snapshot: function () { return { view: 'main' }; }, perform: function () { throw new Error('boom'); } };
const cap3 = mockCap();
App.wireSystemBack(cap3, fxThrow2);
escaped = false;
try { cap3.listeners.backButton(); } catch (e) { escaped = true; }
check('throwing perform cannot escape the listener', !escaped);

/* ---------- 4. static wiring of the DOM side in js/app.js ---------- */
const seg0 = appSrc.indexOf('/* v60: Android system back');
const seg1 = appSrc.indexOf('/* v19/v30');
check('v60 wiring segment found', seg0 >= 0 && seg1 > seg0);
const seg = appSrc.slice(seg0, seg1);
SHEETS.forEach(function (id) {
  check('snapshot watches #' + id, seg.indexOf("'" + id + "'") >= 0);
});
check('snapshot watches sidebar', seg.indexOf("el('sidebar')") >= 0);
check('snapshot detects module via modView hidden', seg.indexOf("el('modView')") >= 0 && seg.indexOf("'hidden'") >= 0);
['closeTrackerStartSheet()', 'closeTrackerEndSheet()', 'closeOdoSheet()', 'closeLoadSheet()',
 'closeSidebar()', 'App.showDashboard()', 'renderOnbStep()', 'collectOnbInputs()',
 'Cap.Plugins.App.exitApp()'].forEach(function (needle) {
  check('perform dispatches to ' + needle, seg.indexOf(needle) >= 0);
});
check('old unconditional main-exit handler is gone', appSrc.indexOf('back from main EXITS the app') < 0);
check('v60 segment adds no alert()', seg.indexOf('alert(') < 0);
check('v60 segment never calls tracker stop/toggle/save',
  !/App\.trackerStop|stopSessionAt\(|App\.trackerToggle|trackerSave\(/.test(seg));

/* ---------- 5. release coherence ---------- */
const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
check('webVersion is 60', ver.webVersion === 60, 'got ' + ver.webVersion);
check('index.html loads js/app.js?v=60', idx.indexOf('js/app.js?v=60') >= 0);

console.log('\nback-button-test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
