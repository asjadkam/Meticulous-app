#!/usr/bin/env node
/* NAV-PIN-DROP-PANEL-COVERS-MAP-NOV8 (owner, Nov 8, 2026 —
 * screen recording ~09:18, gen 60 / web 375): "Once I drop a
 * pin... The menu from under covers up the entire screen. I
 * should see the direction... Not navigation."
 *
 * THE DEFECT: dropping a pin in the Navigator unfolded the
 * "📍 Destination, places & directions" sheet (#nv_sheet) over
 * the map. The auto-open was ONE line in setDest (the v330
 * rule "a destination existing is what the sheet is FOR"), and
 * EVERY destination door funnels through setDest — so the
 * panel swallowed the map on every one of them:
 *   pin drop (pinTap) · search saved-place match · search
 *   top-row auto-land · search result pick · the sheet's own
 *   place picker · the map Places panel pick · the sent-pin /
 *   Open pin door (landSentPin — paste link, whole-message
 *   pins, deep-link hand-off) · the dispatch hand-off
 *   (nav_pending, coordinates or saved-place pin).
 * doRoute never touched the sheet (the open he saw after a
 * route landed was setDest's, a moment earlier); startDrive
 * never folded it either, so a sheet open at drive start was
 * still open under/behind the drive screen.
 *
 * THE FIX (modules/navigator.js):
 *  (1) setDest no longer touches sheetOpen — setting a
 *      destination NEVER unfolds the sheet. paintSheet's only
 *      remaining state writers are the initial collapsed state
 *      and the handle itself.
 *  (2) startDrive folds the sheet if it is open, so the drive
 *      is driven by the map + banner and the shell the driver
 *      returns to is map-first too.
 * The sheet's contents, the manual fold/unfold, and every
 * route/drive function are untouched.
 *
 * This suite drives the REAL modules/navigator.js in the
 * v348/v208 stub world (stub Leaflet, stub route fixture,
 * captured geolocation) and asserts the sheet's painted state
 * — className + handle label, paintSheet's own outputs —
 * across every door. Run: node tools/nav-pindrop-panel-nov8-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const navSrc = read('modules/navigator.js');
const fixture = JSON.parse(read('tools/navigator-fixture-tripb.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* ---------- the stub world (v348 registry + v208 route/geo) ---------- */
function el() {
  const e = {
    children: {}, style: {}, _html: '', _htmlSets: 0, textContent: '', value: '', onclick: null, className: '',
    _listeners: {},
    addEventListener: function (ev, fn) { (e._listeners[ev] = e._listeners[ev] || []).push(fn); },
    fire: function (ev, arg) { (e._listeners[ev] || []).slice().forEach(function (f) { f(arg); }); },
    classList: {
      _s: new Set(),
      add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); },
      toggle: function (c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) { this._s.add(c); } else { this._s.delete(c); } },
      contains: function (c) { return this._s.has(c); }
    },
    querySelector: function (sel) { return e.children[sel] || null; },
    querySelectorAll: function () { return []; },
    getAttribute: function () { return null; },
    setAttribute: function () {}
  };
  Object.defineProperty(e, 'innerHTML', {
    configurable: true,
    get: function () { return e._html; }, set: function (v) { e._htmlSets++; e._html = String(v); }
  });
  return e;
}
function resultsEl() {
  const e = el();
  e._rows = {};
  e.querySelectorAll = function (sel) {
    if (sel !== '[data-pid]' && sel !== '[data-nvhit]') return [];
    const attr = sel === '[data-pid]' ? 'data-pid' : 'data-nvhit';
    return Object.keys(e._rows).filter(function (k) { return k.indexOf(attr + ':') === 0; })
      .map(function (k) { return e._rows[k]; });
  };
  const setHtml = Object.getOwnPropertyDescriptor(e, 'innerHTML').set;
  Object.defineProperty(e, 'innerHTML', {
    get: function () { return e._html; },
    set: function (v) {
      setHtml.call(e, v);
      e._rows = {};
      let m;
      const rePid = /data-pid="([^"]+)"/g;
      while ((m = rePid.exec(e._html))) {
        const pid = m[1];
        e._rows['data-pid:' + pid] = { onclick: null, getAttribute: function (n) { return n === 'data-pid' ? pid : null; }, click: function () { if (this.onclick) this.onclick(); } };
      }
      const reHit = /data-nvhit="([^"]+)"/g;
      while ((m = reHit.exec(e._html))) {
        const hit = m[1];
        e._rows['data-nvhit:' + hit] = { onclick: null, getAttribute: function (n) { return n === 'data-nvhit' ? hit : null; }, click: function () { if (this.onclick) this.onclick(); } };
      }
    }
  });
  e.pick = function (pid) { const r = e._rows['data-pid:' + pid]; if (r) r.click(); };
  e.hit = function (i) { const r = e._rows['data-nvhit:' + i]; if (r) r.click(); };
  return e;
}

const PLACE = { name: 'Butterfly', lat: 51.1315, lng: -114.0103 };
const ORIGIN = [51.0955, -114.099], DEST = [51.1075, -114.0845];

function makeWorld(storeData) {
  const store = {
    get: function (k, d) { return storeData[k] !== undefined ? storeData[k] : d; },
    set: function (k, v) { storeData[k] = v; },
    del: function (k) { delete storeData[k]; }
  };
  const reg = {};
  const body = el();
  body.querySelector = function (sel) {
    if (sel.charAt(0) !== '#') return null;
    const id = sel.slice(1);
    if (!reg[id]) { reg[id] = (id === 'nv_results' || id === 'nv_map_results' || id === 'nv_presults') ? resultsEl() : el(); }
    return reg[id];
  };
  body.querySelectorAll = function () { return []; };
  const calls = { fetch: [], markers: [], spoken: [] };
  const mapHandlers = {};
  function makeMapStub() {
    const m = {
      setView: function () { return m; }, panTo: function () { return m; },
      getCenter: function () { return null; }, getZoom: function () { return 15; },
      on: function (ev, fn) { mapHandlers[ev] = fn; },
      addLayer: function () { return m; }, removeLayer: function () { return m; },
      remove: function () {}, fitBounds: function () {}, invalidateSize: function () {}
    };
    return m;
  }
  const L = {
    map: function () { return makeMapStub(); },
    tileLayer: function () { return { addTo: function () { return this; } }; },
    marker: function (ll) { calls.markers.push(ll); return { addTo: function () { return this; }, setLatLng: function () {} }; },
    circleMarker: function () { return { addTo: function () { return this; }, setLatLng: function () {} }; },
    polyline: function () { return { addTo: function () { return this; }, setLatLngs: function () {}, getBounds: function () { return {}; } }; },
    layerGroup: function () { return { addTo: function () { return this; }, getLayers: function () { return []; } }; }
  };
  const picker = {
    pickerEntries: function () { return { recents: true, rows: [{ place: PLACE }] }; },
    pickerRowHTML: function () { return '<div data-pid="p1">' + PLACE.name + '</div>'; },
    pickerFind: function () { return { place: PLACE }; },
    displayPlaceName: function (p) { return p.name; },
    setTab: function () {},
    recordVisit: function () {},
    learnCoords: function () {}
  };
  let geoCb = null;
  const world = {
    console: console, JSON: JSON, Math: Math, Date: Date, setTimeout: setTimeout, clearTimeout: clearTimeout,
    window: null,
    document: { hidden: false, addEventListener: function () {}, removeEventListener: function () {},
      createElement: function () { return { href: '', style: {}, click: function () {}, remove: function () {} }; },
      body: { appendChild: function () {}, classList: { add: function () {}, remove: function () {} } } },
    open: function () {},
    App: { _esc: function (s) { return String(s == null ? '' : s); }, _store: store, _today: function () { return '2026-11-08'; }, openModule: function () {} },
    Meticulous: { modules: { navigation: picker } },
    L: L,
    navigator: { geolocation: { watchPosition: function (cb) { geoCb = cb; return 7; }, clearWatch: function () {} } },
    speechSynthesis: { cancel: function () {}, speak: function (u) { calls.spoken.push(u.text); }, getVoices: function () { return []; } },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    fetch: function (url) {
      calls.fetch.push(String(url));
      if (String(url).indexOf('/route') >= 0) {
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(fixture); } });
      }
      if (String(url).indexOf('nominatim') >= 0 && String(url).indexOf('reverse') >= 0) {
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ display_name: 'Test Road, Calgary', address: { road: 'Test Road' } }); } });
      }
      if (String(url).indexOf('nominatim') >= 0) {
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([{ lat: String(DEST[0]), lon: String(DEST[1]), display_name: 'Geocoder Place, Calgary, Canada' }]); } });
      }
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); } });
    }
  };
  world.window = world;
  vm.createContext(world);
  vm.runInContext(navSrc, world);
  return {
    world: world, reg: reg, body: body, calls: calls, storeData: storeData,
    NAV: world.Meticulous.modules.navigator,
    firePos: function (la, lo) { if (geoCb) geoCb({ coords: { latitude: la, longitude: lo, heading: 40, speed: 0 } }); },
    mapClick: function (la, lo) { mapHandlers.click({ latlng: { lat: la, lng: lo } }); }
  };
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 10); }); }
function Q(w, id) { return w.body.querySelector('#' + id); }
function prepRender(w) {
  const b = w.body.querySelector('#nv_banner');
  b.children['.nv-banner-main'] = el();
  b.children['.nv-banner-sub'] = el();
  w.body.querySelector('#nv_sheet');
  w.body.querySelector('#nv_sheet_toggle');
  w.body.querySelector('#nv_drive').classList.add('hidden');
  w.body.querySelector('#nv_drive_screen').classList.add('hidden');
  w.NAV.render(w.body);
}
/* paintSheet's own outputs are the state: the sheet is OPEN only
   when its class is exactly 'nv-sheet' and its handle says fold. */
function sheetOpen(w) { return w.reg.nv_sheet.className === 'nv-sheet'; }
function sheetFolded(w) {
  return w.reg.nv_sheet.className !== 'nv-sheet' &&
    String(w.reg.nv_sheet_toggle.textContent).indexOf('tap to fold') < 0;
}

(async function () {
  console.log('— S. source pins —');
  ok('no code path sets sheetOpen = true outside the handle (the only writer flips it)',
    navSrc.indexOf('sheetOpen = true') === -1 && navSrc.indexOf('sheetOpen = !sheetOpen') !== -1);
  const setDestBody = navSrc.slice(navSrc.indexOf('function setDest(latlng, label, goNow)'),
    navSrc.indexOf('function maybeAutoRoute()'));
  ok('setDest carries the Nov 8 retirement note and no paintSheet call',
    setDestBody.indexOf('NAV-PIN-DROP-PANEL-COVERS-MAP-NOV8') !== -1 && setDestBody.indexOf('paintSheet') === -1);
  const driveBody = navSrc.slice(navSrc.indexOf('function startDrive()'),
    navSrc.indexOf('function startDrive()') + 1600);
  ok('startDrive folds the sheet when it is open',
    /if \(sheetOpen\) \{ sheetOpen = false; paintSheet\(\); \}/.test(driveBody));
  ok('the sheet markup still starts collapsed and keeps its handle',
    navSrc.indexOf('nv-sheet nv-sheet-collapsed') !== -1 && navSrc.indexOf('id="nv_sheet_toggle"') !== -1);

  console.log('— B1. pin drop: the map stays in front —');
  const w = makeWorld({});
  prepRender(w);
  ok('render lands map-first (sheet not open)', sheetFolded(w), 'class=' + w.reg.nv_sheet.className);
  w.firePos(ORIGIN[0], ORIGIN[1]);
  w.mapClick(DEST[0], DEST[1]);
  ok('the pin dropped (dest marker painted)', w.calls.markers.length >= 1);
  eq('the destination line names the dropped pin', String(Q(w, 'nv_destnote').textContent).indexOf('Dropped pin') >= 0, true);
  ok('PIN DROP leaves the sheet folded', sheetFolded(w),
    'class=' + w.reg.nv_sheet.className + ' label=' + w.reg.nv_sheet_toggle.textContent);
  await tick(); await tick(); await tick();
  ok('the route was requested (auto-route still works)', w.calls.fetch.some(function (u) { return u.indexOf('/route') >= 0; }));
  ok('ROUTE COMPUTED leaves the sheet folded', sheetFolded(w), 'class=' + w.reg.nv_sheet.className);
  ok('Drive is revealed on the active route (reachable without the sheet)', !w.reg.nv_drive.classList.contains('hidden'));

  console.log('— B2. the handle is the only door, and it works both ways —');
  Q(w, 'nv_sheet_toggle').onclick();
  ok('his tap on the handle opens the sheet', sheetOpen(w) && String(w.reg.nv_sheet_toggle.textContent).indexOf('tap to fold') >= 0,
    'class=' + w.reg.nv_sheet.className);
  Q(w, 'nv_sheet_toggle').onclick();
  ok('his second tap folds it again', !sheetOpen(w) && String(w.reg.nv_sheet_toggle.textContent).indexOf('tap to open') >= 0,
    'class=' + w.reg.nv_sheet.className);

  console.log('— B3. a drive starting folds an open sheet —');
  Q(w, 'nv_sheet_toggle').onclick();
  ok('the sheet is open going into Drive', sheetOpen(w));
  Q(w, 'nv_drive').onclick();
  await tick(120);
  ok('the drive screen opened', !w.reg.nv_drive_screen.classList.contains('hidden'));
  ok('DRIVE START folded the sheet', w.reg.nv_sheet.className === 'nv-sheet nv-sheet-collapsed' &&
    String(w.reg.nv_sheet_toggle.textContent).indexOf('tap to open') >= 0,
    'class=' + w.reg.nv_sheet.className + ' label=' + w.reg.nv_sheet_toggle.textContent);

  console.log('— B4. search pick (saved place wins the search) —');
  const w2 = makeWorld({});
  prepRender(w2);
  w2.firePos(ORIGIN[0], ORIGIN[1]);
  Q(w2, 'nv_q').value = 'Butterfly';
  Q(w2, 'nv_search').onclick();
  await tick(); await tick();
  ok('the search set the destination', String(Q(w2, 'nv_destnote').textContent).indexOf('Butterfly') >= 0,
    'note=' + w2.reg.nv_destnote.textContent);
  ok('SEARCH PICK leaves the sheet folded', sheetFolded(w2), 'class=' + w2.reg.nv_sheet.className);

  console.log('— B5. the map Places panel pick —');
  const w3 = makeWorld({});
  prepRender(w3);
  w3.firePos(ORIGIN[0], ORIGIN[1]);
  Q(w3, 'nv_places_btn').onclick();
  ok('the Places panel opened with the saved place listed',
    !Q(w3, 'nv_places_panel').classList.contains('hidden') && Q(w3, 'nv_map_results')._html.indexOf('Butterfly') >= 0);
  Q(w3, 'nv_map_results').pick('p1');
  await tick();
  ok('the panel pick set the destination', String(Q(w3, 'nv_destnote').textContent).indexOf('Butterfly') >= 0,
    'note=' + w3.reg.nv_destnote.textContent);
  ok('PLACES PICK leaves the sheet folded', sheetFolded(w3), 'class=' + w3.reg.nv_sheet.className);

  console.log('— B6. the Open pin door (a pasted pin) —');
  const w4 = makeWorld({});
  prepRender(w4);
  w4.firePos(ORIGIN[0], ORIGIN[1]);
  Q(w4, 'nv_link').value = DEST[0] + ',' + DEST[1];
  Q(w4, 'nv_link_open').onclick();
  await tick(); await tick();
  ok('the sent pin landed as the destination', w4.calls.markers.length >= 1 &&
    String(Q(w4, 'nv_destnote').textContent).indexOf('Sent pin') >= 0,
    'note=' + w4.reg.nv_destnote.textContent);
  ok('OPEN PIN leaves the sheet folded', sheetFolded(w4), 'class=' + w4.reg.nv_sheet.className);

  console.log('— B7. the dispatch hand-off (nav_pending) —');
  const w5 = makeWorld({ nav_pending: { name: 'Dispatch Pit', lat: 51.2, lng: -114.1 } });
  prepRender(w5);
  ok('the hand-off set the destination', String(Q(w5, 'nv_destnote').textContent).indexOf('Dispatch Pit') >= 0,
    'note=' + w5.reg.nv_destnote.textContent);
  ok('DISPATCH PIN leaves the sheet folded', sheetFolded(w5), 'class=' + w5.reg.nv_sheet.className);

  console.log('\nnav-pindrop-panel-nov8 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR ' + (e && e.stack || e)); process.exit(1); });
