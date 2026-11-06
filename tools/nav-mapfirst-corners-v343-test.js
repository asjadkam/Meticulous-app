#!/usr/bin/env node
/* Meticulous v343 — NAV-MAP-FIRST-NOT-IN-HANDS + NAV-MAP-CORNERS-LAYOUT.
 *
 * Owner (Nov 5, 2026 22:37, with screenshot): the Navigator still
 * opened on the old list page (Work/Personal tabs, Places search,
 * Recent places) — NO map. Web 330 collapsed the planning sheet
 * inside the drive face, but the module's FRONT face was still
 * 'places': `var nvFace = 'places'` + resetView → 'places', and
 * render delegated the whole body to the Navigation list
 * component, so plain entry never reached the map at all.
 *
 * v343:
 *  (1) MAP-FIRST, for real: nvFace defaults to 'drive' (the map
 *      face), resetView lands on 'drive', and the Back staircase
 *      is re-based — Back at the map root exits the module, Back
 *      on the places face returns to the MAP. The places face is
 *      a sub-view reached from the map's "Manage places" door.
 *  (2) CORNERS: everything the list page held now lives on the
 *      map as overlays — a search bar at the top edge, the
 *      Work/Personal switch as pills beside a Places door, and
 *      a places panel (recent/saved, shared picker, kind =
 *      nvKind) dropping from that stack. The sheet picker follows
 *      the same nvKind. The banner tucks to the bottom edge.
 *      Nothing is lost: Add favorite / Yard / place detail /
 *      Recent destinations stay on the places face, opened on
 *      the same tab via Navigation.setTab.
 *
 * Run: node tools/nav-mapfirst-corners-v343-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const navSrc = read('modules/navigator.js');
const naviSrc = read('modules/navigation.js');
const cssSrc = read('css/style.css');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* ---------------- load the real module ---------------- */
const storeData = {};
const sb = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Meticulous: { modules: {} },
  App: {
    _store: {
      get(k, d) { return (k in storeData) ? storeData[k] : d; },
      set(k, v) { storeData[k] = v; },
      del(k) { delete storeData[k]; }
    },
    _esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    _today: () => '2026-11-05'
  },
  window: {}, document: { addEventListener() {}, querySelector: () => null },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
};
sb.window = sb;
vm.createContext(sb);
vm.runInContext(navSrc, sb);
const NAV = sb.Meticulous.modules.navigator;
ok('navigator module registers', !!NAV);

/* ---------------- (1) map-first landing ---------------- */
console.log('— map-first landing —');
ok("the front face defaults to the map ('drive')",
  navSrc.indexOf("var nvFace = 'drive';") !== -1);
ok('no stale places-default remains',
  navSrc.indexOf("var nvFace = 'places';") === -1);
ok('resetView lands fresh entry on the map',
  navSrc.indexOf("resetView: function () { nvFace = 'drive';") !== -1);
ok('resetView no longer lands on places',
  navSrc.indexOf("resetView: function () { nvFace = 'places'; },") === -1);
ok('Back on the places face returns to the map',
  /if \(nvFace === 'places'\) \{\s*\/\* v343[\s\S]{0,220}nvFace = 'drive';/.test(navSrc));
ok('the places delegation still exists (the sub-view is intact)',
  navSrc.indexOf("if (nvFace === 'places')") !== -1 &&
  navSrc.indexOf('navMod.render(body); return;') !== -1);
ok('pending destination still promotes to the drive face',
  navSrc.indexOf("if (hasPending) nvFace = 'drive';") !== -1);
ok('the prefs settings door is still consumed before the places delegation',
  (() => {
    const r = navSrc.indexOf('render: function (body)');
    const c = navSrc.indexOf('openSettingsWanted = true', r);
    const p = navSrc.indexOf("if (nvFace === 'places')", r);
    return c > r && c < p;
  })());
/* functional smoke: at the map root with no drive, Back exits */
ok('resetView runs without throwing', (() => { try { NAV.resetView(); return true; } catch (e) { return false; } })());
eq('Back at the module root is not consumed (exits to dashboard)',
  (() => { try { return NAV.back(); } catch (e) { return 'threw'; } })(), false);
ok('the sent-pin parser still works (v330 regression)',
  JSON.stringify(NAV._sentPinCoords('https://www.google.com/maps/@51.1252778,-113.9839531,17z')) ===
  JSON.stringify([51.1252778, -113.9839531]));

/* ---------------- (2) corners overlays ---------------- */
console.log('— corners overlays —');
['nv_map_q', 'nv_map_go', 'nv_kind_work', 'nv_kind_personal', 'nv_places_btn',
 'nv_places_panel', 'nv_map_results', 'nv_map_addr', 'nv_map_manage'].forEach(function (id) {
  ok('overlay element #' + id + ' is painted on the map', navSrc.indexOf('id="' + id + '"') !== -1);
});
ok('the overlays live inside the map zone (painted before the sheet)',
  navSrc.indexOf('class="nv-map-top"') > navSrc.indexOf('class="nv-mapzone"') &&
  navSrc.indexOf('class="nv-map-top"') < navSrc.indexOf('id="nv_sheet"'));
ok('the kind switch is one module state (nvKind, default work)',
  navSrc.indexOf("var nvKind = 'work';") !== -1);
ok('the overlay panel paints through the shared picker at nvKind',
  navSrc.indexOf('navPicker.pickerEntries(nvKind, nvMapQ)') !== -1);
ok('the sheet picker follows the same switch (no hardcoded work)',
  navSrc.indexOf('navPicker.pickerEntries(nvKind, nvPickQ)') !== -1 &&
  navSrc.indexOf("navPicker.pickerEntries('work', nvPickQ)") === -1 &&
  navSrc.indexOf('navPicker.pickerFind(nvKind, b.getAttribute') !== -1 &&
  navSrc.indexOf("navPicker.pickerFind('work', b.getAttribute") === -1);
ok('the kind pills are wired to the one switch',
  navSrc.indexOf("setNvKind('work')") !== -1 && navSrc.indexOf("setNvKind('personal')") !== -1);
ok('a panel pick sets the destination from its pin (v107 tap rule kept)',
  /paintPlacesPanel[\s\S]{0,4000}setDest\(\[p\.lat, p\.lng\], pName\)/.test(navSrc));
ok('the map search runs the destination search flow for free text',
  /mapGoBtn\.onclick[\s\S]{0,1600}searchBtn\.onclick\(\)/.test(navSrc));
ok('Search as address hands the words to the same search door',
  navSrc.indexOf('id="nv_map_addr"') !== -1 && /mapAddrBtn\.onclick[\s\S]{0,400}searchBtn\.onclick\(\)/.test(navSrc));
ok('Manage places opens the places face on the same tab',
  /mapManageBtn\.onclick[\s\S]{0,700}setTab\(nvKind\)[\s\S]{0,200}nvFace = 'places';/.test(navSrc));
ok('Navigation exposes the additive setTab door',
  naviSrc.indexOf('setTab: function (kind)') !== -1);
ok('map-tap pin drop still wired (v330 kept)',
  /S\.map\.on\('click', function \(e\) \{\s*pinTap\(/.test(navSrc));
ok('the sent-pin door still lives in the sheet (v330 kept)',
  navSrc.indexOf('id="nv_link"') !== -1 && navSrc.indexOf('linkOpenBtn.onclick = openSentPin') !== -1);

/* ---------------- CSS tucks ---------------- */
console.log('— css —');
ok('the top stack is an overlay on the map',
  /\.nv-map-top\{position:absolute;top:10px/.test(cssSrc));
ok('the places panel drops under the stack, centre clear',
  /\.nv-places-panel\{position:absolute;top:108px/.test(cssSrc));
ok('the search bar is a white pill on the map',
  cssSrc.indexOf('.nv-mapsearch{') !== -1);
ok('the banner tucks to the bottom edge above the mode row (v348 pin move, NAV-YOU-ARE-HERE-PEEK: the bottom:62px solo anchor WAS the peek defect — the banner now rides the one .nv-map-bottom stack as a static card above the row)',
  /\.nv-map-bottom\{position:absolute/.test(cssSrc) &&
  /\.nv-banner-overlay\{position:static/.test(cssSrc));

/* ---------------- ship pins ---------------- */
console.log('— ship pins —');
eq('webVersion is 343', ver.webVersion, 343);
ok('index.html pins navigator.js?v=343', idxSrc.indexOf('modules/navigator.js?v=343') !== -1);
ok('index.html pins navigation.js?v=343', idxSrc.indexOf('modules/navigation.js?v=343') !== -1);
ok('index.html pins style.css?v=343', idxSrc.indexOf('css/style.css?v=343') !== -1);

console.log('\nnav-mapfirst-corners-v343: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
