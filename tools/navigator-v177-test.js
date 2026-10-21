/* Meticulous v177 — NAVIGATOR OVERHAUL BATCH 2: THE
   NAVIGATOR'S OWN SETTINGS MENU (F4) + 3D/2D AS AN OPTION (A4)
   (owner, Oct 19, 2026; build order Oct 20).

   F4: a gear/menu INSIDE the Navigator holds the GPS
   preferences — route preference (fastest vs most economical),
   speedometer toggle, speed-limit toggle, voice mute, and the
   TRUCK DIMENSIONS, which MOVE there from Preferences.
   Preferences keeps a DOOR to the same menu (pf_nv_open sets
   nav_open_settings and opens the module; the Navigator render
   consumes the flag and opens the one menu). Same 'navigator'
   store, same settings object — not a copy.

   A4: the chase perspective stays the default, and 3D vs 2D is
   a driver option in that menu. planeTransform keeps its pinned
   one-arg call site and its exact v139 3D string; in 2D it
   composes a flat heading-up rotate.

   Settings TAKE EFFECT: the route preference reaches
   buildRouteRequest (economical sets Valhalla's per-costing
   shortest switch; fastest leaves the proven request
   byte-identical), the view mode reaches planeTransform via
   setNavViewMode, toggles own the overlays' visibility.

   Run: node tools/navigator-v177-test.js */
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
function extract(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}
function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  return ka.every(function (k, i) { return k === kb[i] && deepEq(a[k], b[k]); });
}
const navSrc = read('modules/navigator.js');
const prefSrc = read('modules/preferences.js');
const idxSrc = read('index.html');
const cssSrc = read('css/style.css');
const ver = JSON.parse(read('version.json'));

const sb = { console };
vm.createContext(sb);
vm.runInContext(extract(navSrc, 'NAVPURE-BEGIN', 'NAVPURE-END'), sb);
const ORIGIN = [51.0955, -114.099], DEST = [51.1075, -114.0845];

console.log('— F4: route preference reaches the request —');
{
  const base = sb.buildRouteRequest(ORIGIN, DEST, null, 'truck');
  const fast = sb.buildRouteRequest(ORIGIN, DEST, null, 'truck', { routePref: 'fastest' });
  check('fastest (and no opts) leave the proven request byte-identical',
    deepEq(base, fast) && !('shortest' in (base.costing_options.truck || {})));
  const eco = sb.buildRouteRequest(ORIGIN, DEST, null, 'truck', { routePref: 'economical' });
  check('economical sets the truck costing shortest switch, nothing else moves',
    eco.costing_options.truck.shortest === true &&
    eco.costing_options.truck.use_truck_route === 1.0 &&
    eco.costing === 'truck' && eco.locations.length === 2);
  const ecoCar = sb.buildRouteRequest(ORIGIN, DEST, null, 'car', { routePref: 'economical' });
  check('economical applies to car costing too', !!(ecoCar.costing_options && ecoCar.costing_options.car && ecoCar.costing_options.car.shortest === true));
}

console.log('— A4: 3D/2D is an option; the 3D string is untouched —');
check('view mode accessors exist, default 3d',
  typeof sb.setNavViewMode === 'function' && sb.getNavViewMode() === '3d');
sb.setNavViewMode('2d');
check('setNavViewMode(2d) sticks; junk falls back to 3d',
  sb.getNavViewMode() === '2d' && (sb.setNavViewMode('junk'), sb.getNavViewMode() === '3d'));
check('the v139 3D composed string survives verbatim in the source',
  navSrc.indexOf("'perspective(1100px) rotateX(45deg) rotate('") >= 0);
check('planeTransform branches on the view mode (2d = flat rotate, no pitch)',
  navSrc.indexOf("if (getNavViewMode() === '2d') return 'rotate('") >= 0);
check('the tick still writes the plane through the ONE pinned writer',
  (navSrc.match(/\.style\.transform\s*=/g) || []).length === 1 &&
  /plane\.style\.transform = planeTransform\(hdg\)/.test(navSrc));

console.log('— F4: the menu, the doors, the moved dimensions —');
check('loadSettings carries the new fields with honest defaults',
  navSrc.indexOf("routePref: s.routePref === 'economical' ? 'economical' : 'fastest'") >= 0 &&
  navSrc.indexOf("viewMode: s.viewMode === '2d' ? '2d' : '3d'") >= 0 &&
  navSrc.indexOf('showSpeed: s.showSpeed === undefined ? true : !!s.showSpeed') >= 0 &&
  navSrc.indexOf('showSpeedLimit: s.showSpeedLimit === undefined ? true : !!s.showSpeedLimit') >= 0);
check('the gear exists on BOTH faces (plan + drive) and opens the one panel',
  navSrc.indexOf('id="nv_gear"') >= 0 && navSrc.indexOf('id="nvd_gear"') >= 0 &&
  navSrc.indexOf('id="nv_settings"') >= 0 && navSrc.indexOf('function openNavSettings(') >= 0);
check('the menu holds view, route pref, both overlay toggles, mute, and the truck dimensions',
  ['nvs_speed', 'nvs_limit', 'nvs_mute', 'nvs_height', 'nvs_width', 'nvs_length', 'nvs_weight', 'nvs_axleload', 'nvs_axles', 'nvs_hazmat']
    .every(function (id) { return navSrc.indexOf('id="' + id + '"') >= 0; }) &&
  navSrc.indexOf("seg('nvs_view'") >= 0 && navSrc.indexOf("seg('nvs_route'") >= 0);
check('menu changes persist through the same store and take effect (re-route / repaint / overlay)',
  navSrc.indexOf("saveSettings({ routePref: v })") >= 0 &&
  navSrc.indexOf('saveSettings({ viewMode: v })') >= 0 &&
  navSrc.indexOf('saveSettings({ profile: S.settings.profile })') >= 0 &&
  navSrc.indexOf("{ routePref: S.settings.routePref }") >= 0);
check('the Preferences door sets the flag the Navigator render consumes',
  prefSrc.indexOf("App._store.set('nav_open_settings', 1)") >= 0 &&
  prefSrc.indexOf("App.openModule('navigator')") >= 0 &&
  navSrc.indexOf("App._store.get('nav_open_settings', null)") >= 0 &&
  navSrc.indexOf("App._store.set('nav_open_settings', null)") >= 0);
check('Preferences no longer renders dimension inputs (moved, not copied)',
  prefSrc.indexOf('pf_nv_height') < 0 && prefSrc.indexOf('pf_nv_open') >= 0);
check('the speedometer overlay is fed by the GPS speed through the cached writer',
  navSrc.indexOf('id="nvd_speed"') >= 0 && navSrc.indexOf("driveText(spdEl, 'speed'") >= 0 &&
  navSrc.indexOf('S.speed * 3.6') >= 0);
check('the settings + overlay CSS shipped', cssSrc.indexOf('.nv-settings{') >= 0 && cssSrc.indexOf('.nv-drive-speedo{') >= 0 && cssSrc.indexOf('.nv-drive-limit{') >= 0);

console.log('— ship pins —');
check('ships as webVersion 185 with the changed files at the 185 pin',
  ver.webVersion === 185 &&
  idxSrc.indexOf('src="modules/navigator.js?v=185"') >= 0 &&
  idxSrc.indexOf('src="modules/preferences.js?v=185"') >= 0 &&
  idxSrc.indexOf('href="css/style.css?v=185"') >= 0,
  'webVersion=' + ver.webVersion);

console.log('\nnavigator-v177: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
