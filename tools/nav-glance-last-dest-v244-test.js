#!/usr/bin/env node
/* Meticulous v244 — NAV-GLANCE-LAST-DEST (owner, Oct 23, 2026
 * 15:10 MDT): the Navigator card's quick look showed the truck
 * profile ("Truck · 24 t · Calgary truck routes"); his call: it
 * should show the LAST PLACE NAVIGATED TO, the way Revenue shows
 * the last entry and Fuel the last fill. Display-line change only.
 *
 * The v78 status() already preferred an in-session lastNavDest,
 * but that variable dies with the page: after an app restart the
 * card fell back to the profile line even though he navigated
 * somewhere yesterday. This suite drives the REAL module (the
 * navigator-test world): route to a destination, then load a
 * FRESH module over the SAME store — the restart — and the card
 * must still name the place. Places are named, never coordinates:
 * a bare pin reads "Dropped pin" (its rename lands when the
 * reverse lookup answers), never a lat,lng string.
 *
 * Run: node tools/nav-glance-last-dest-v244-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const navSrc = read('modules/navigator.js');
const navModSrc = read('modules/navigation.js');
const fixture = JSON.parse(read('tools/navigator-fixture-tripb.json'));
const ORIGIN = [51.0955, -114.099], DEST = [51.1075, -114.0845];

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}

function el() {
  const e = {
    children: {}, style: {}, _html: '', textContent: '', value: '', onclick: null,
    _listeners: {},
    addEventListener: function (ev, fn) { (e._listeners[ev] = e._listeners[ev] || []).push(fn); },
    fire: function (ev) { (e._listeners[ev] || []).slice().forEach(function (f) { f(); }); },
    classList: {
      _s: new Set(),
      add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); },
      toggle: function (c, on) { on ? this._s.add(c) : this._s.delete(c); },
      contains: function (c) { return this._s.has(c); }
    },
    querySelector: function (sel) { return e.children[sel] || null; },
    querySelectorAll: function () { return []; },
    getAttribute: function () { return null; },
    setAttribute: function () {}
  };
  Object.defineProperty(e, 'innerHTML', {
    get: function () { return e._html; }, set: function (v) { e._html = String(v); }
  });
  return e;
}
function resultsEl() {
  const e = {
    children: {}, style: {}, _html: '', textContent: '', value: '', onclick: null, _rows: {},
    classList: {
      _s: new Set(),
      add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); },
      toggle: function (c, on) { on ? this._s.add(c) : this._s.delete(c); },
      contains: function (c) { return this._s.has(c); }
    },
    querySelector: function () { return null; },
    querySelectorAll: function (sel) {
      if (sel !== '[data-pid]') return [];
      return Object.keys(e._rows).map(function (k) { return e._rows[k]; });
    },
    getAttribute: function () { return null; },
    setAttribute: function () {}
  };
  Object.defineProperty(e, 'innerHTML', {
    get: function () { return e._html; },
    set: function (v) {
      e._html = String(v); e._rows = {};
      const re = /data-pid="([^"]+)"/g; let m;
      while ((m = re.exec(e._html))) {
        const pid = m[1];
        e._rows[pid] = { onclick: null,
          getAttribute: function (n) { return n === 'data-pid' ? pid : null; },
          click: function () { if (this.onclick) this.onclick(); } };
      }
    }
  });
  e.pick = function (pid) { const r = e._rows[pid]; if (r) r.click(); };
  return e;
}
function makeWorld(storeData) {
  const store = {
    get: function (k, d) { return storeData[k] !== undefined ? storeData[k] : d; },
    set: function (k, v) { storeData[k] = v; },
    del: function (k) { delete storeData[k]; }
  };
  const ids = ['nv_banner', 'nv_map', 'nv_mode_truck', 'nv_mode_car', 'nv_follow', 'nv_mute',
    'nv_q', 'nv_search', 'nv_results', 'nv_destnote', 'nv_route', 'nv_end', 'nv_note', 'nv_steps',
    'nv_pq', 'nv_presults',
    'nv_back', 'nv_drive', 'nv_drive_screen', 'nv_drive_map',
    'nvd_dist', 'nvd_inst', 'nvd_road', 'nvd_eta_main', 'nvd_eta_sub', 'nvd_reroute', 'nvd_plane', 'nvd_mute', 'nvd_exit'];
  const reg = {};
  ids.forEach(function (id) { reg[id] = el(); });
  reg.nv_presults = resultsEl();
  reg.nv_banner.children['.nv-banner-main'] = el();
  reg.nv_banner.children['.nv-banner-sub'] = el();
  const body = el();
  body.querySelector = function (sel) { return reg[sel.slice(1)] || null; };
  body.querySelectorAll = function () { return []; };

  const calls = { polylines: [], markers: [], maps: [] };
  const mapHandlers = {};
  function makeMapStub() {
    const m = {
      _adds: 0, _removes: 0, _views: [], _panTos: [], _center: null, _zoom: 15,
      setView: function (c, z) { m._views.push([c, z]); m._center = c; if (z) m._zoom = z; return m; },
      panTo: function (c, o) { m._panTos.push([c, o]); m._center = c; return m; },
      getCenter: function () { return m._center ? { lat: m._center[0], lng: m._center[1] } : null; },
      getZoom: function () { return m._zoom; },
      on: function (ev, fn) { mapHandlers[ev] = fn; },
      addLayer: function () { m._adds++; return m; },
      removeLayer: function () { m._removes++; return m; },
      remove: function () {}, fitBounds: function () {}, invalidateSize: function () {}
    };
    return m;
  }
  const L = {
    map: function () { const m = makeMapStub(); calls.maps.push(m); return m; },
    tileLayer: function () { return { addTo: function (mm) { if (mm && mm.addLayer) mm.addLayer(this); return this; } }; },
    marker: function (ll) { calls.markers.push(ll); return { addTo: function (mm) { if (mm && mm.addLayer) mm.addLayer(this); return this; }, setLatLng: function () {} }; },
    circleMarker: function () {
      const cm = { addTo: function (mm) { if (mm && mm.addLayer) mm.addLayer(this); return cm; }, setLatLng: function () {} };
      return cm;
    },
    polyline: function (pts) {
      calls.polylines.push(pts);
      const pl = { addTo: function (mm) { if (mm && mm.addLayer) mm.addLayer(this); return pl; },
        setLatLngs: function () {}, getBounds: function () { return {}; } };
      return pl;
    },
    layerGroup: function (kids) {
      const g = { _kids: kids, getLayers: function () { return g._kids.slice(); },
        addTo: function (mm) { if (mm && mm.addLayer) mm.addLayer(this); return g; } };
      return g;
    }
  };
  let geoCb = null;
  const world = {
    console: console, JSON: JSON, Math: Math, Date: Date, setTimeout: setTimeout,
    window: null,
    document: {
      hidden: false,
      addEventListener: function () {}, removeEventListener: function () {},
      createElement: function () {
        const a = { href: '', style: {}, click: function () {}, remove: function () {} };
        return a;
      },
      body: { appendChild: function () {} }
    },
    open: function () {},
    App: {
      _esc: function (s) { return String(s == null ? '' : s); }, _store: store,
      _today: function () { return '2026-10-24'; }, openModule: function () {}
    },
    Meticulous: {},
    L: L,
    navigator: { geolocation: { watchPosition: function (cb) { geoCb = cb; return 7; }, clearWatch: function () {} } },
    speechSynthesis: { cancel: function () {}, speak: function () {}, getVoices: function () { return []; } },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    fetch: function (url) {
      if (url.indexOf('/route') >= 0) {
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(fixture); } });
      }
      /* reverse geocode etc.: no answer in the harness world */
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); } });
    }
  };
  world.window = world;
  vm.createContext(world);
  vm.runInContext(navModSrc, world);
  vm.runInContext(navSrc, world);
  return { world: world, reg: reg, body: body, calls: calls, mapHandlers: mapHandlers,
    firePos: function (la, lo, hd, sp) { geoCb({ coords: { latitude: la, longitude: lo, heading: hd, speed: sp } }); } };
}
function tick() { return new Promise(function (r) { setTimeout(r, 15); }); }
const COORDS = /-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/;

(async function () {
  /* Session 1 arrives the way his days do: a destination handed
     off as nav_pending (the dispatch/places door), the route
     builds, the card must learn the place's NAME. */
  const storeData = {
    navigator: { profile: {}, muted: false, mode: 'truck' },
    nav_pending: { lat: DEST[0], lng: DEST[1], name: 'East Ivor Pond' }
  };

  console.log('— session 1: route somewhere, the card learns the place —');
  const w1 = makeWorld(storeData);
  const api1 = w1.world.Meticulous.modules.navigator;
  ok('before any route the card keeps the profile line', /Truck · .* · Calgary truck routes/.test(api1.status()), api1.status());
  api1.render(w1.body);
  w1.firePos(ORIGIN[0], ORIGIN[1]);
  await tick(); await tick(); await tick(); await tick();
  ok('the route was actually built (polyline drawn)', w1.calls.polylines.length > 0);
  ok('in-session the card names the place routed to', api1.status() === '→ East Ivor Pond', api1.status());
  ok('the destination NAME is persisted in the navigator store',
    !!(storeData.navigator && storeData.navigator.lastDest === 'East Ivor Pond'),
    JSON.stringify(storeData.navigator || {}));

  console.log('— session 2: app restart over the same store —');
  const w2 = makeWorld(storeData);
  const api2 = w2.world.Meticulous.modules.navigator;
  ok('after restart the card still shows the LAST PLACE NAVIGATED TO',
    api2.status() === '→ East Ivor Pond', api2.status());
  ok('the glance never shows raw coordinates', !COORDS.test(api2.status()), api2.status());

  console.log('— untouched behaviours —');
  const w3 = makeWorld({});
  ok('a store that never routed anywhere keeps the profile line',
    /Truck · .* · Calgary truck routes/.test(w3.world.Meticulous.modules.navigator.status()),
    w3.world.Meticulous.modules.navigator.status());
  const w4 = makeWorld({ navigator: { lastDest: 'East Ivor Pond' } });
  ok('a stored place name is what the card shows', w4.world.Meticulous.modules.navigator.status() === '→ East Ivor Pond',
    w4.world.Meticulous.modules.navigator.status());
  const w5 = makeWorld({ navigator: { lastDest: '51.10750, -114.08450' } });
  ok('a stored COORDINATE string is never shown as a place (falls back)',
    !COORDS.test(w5.world.Meticulous.modules.navigator.status()) && w5.world.Meticulous.modules.navigator.status().indexOf('→') !== 0,
    w5.world.Meticulous.modules.navigator.status());

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
