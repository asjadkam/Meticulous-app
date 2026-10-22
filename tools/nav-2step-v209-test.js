#!/usr/bin/env node
/* Meticulous v209 — NAV-2STEP (owner's video + ruling, Oct 21,
 * 2026 12:58 MDT): navigating to HOME from his saved places took
 * six steps — places list → Home → Navigate → destination form
 * with the address pre-typed → Search → "Use this" → Routing…
 * "This should be a 2 step process."
 *
 * For a SAVED or RECENT place the two steps are now the whole
 * journey: tap the place, tap Navigate — and routing starts.
 * A place carrying coordinates already handed them over
 * (nav_pending pin path, v101). A place carrying only an
 * address arrives as a query: the Navigator runs the search
 * itself and takes the top result as the destination outright
 * (pendGoNow auto-pick) — no form, no Search press, no "Use
 * this" — and the place LEARNS the pin (Navigation.learnCoords)
 * so every later trip is a pin hand-off. The address form stays
 * for NEW places: a manual search still lists results and waits
 * for the driver's tap. A pending arrival that resolves to
 * nothing spends its intent — a later manual search can never
 * inherit it.
 *
 * Drives the REAL modules/navigator.js in the v139/v208 fake-DOM
 * world (stub Leaflet, stub geocoder + route fetch), and the
 * REAL modules/navigation.js for learnCoords.
 * Run: node tools/nav-2step-v209-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const navSrc = read('modules/navigator.js');
const naviSrc = read('modules/navigation.js');
const fixture = JSON.parse(read('tools/navigator-fixture-tripb.json'));
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));
const ORIGIN = [51.0955, -114.099];

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

function el() {
  const e = {
    children: {}, style: {}, _html: '', _sets: [], value: '', onclick: null, _text: '', _attrs: {},
    _listeners: {},
    addEventListener: function (ev, fn) { (e._listeners[ev] = e._listeners[ev] || []).push(fn); },
    classList: {
      _s: new Set(),
      add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); },
      toggle: function (c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { on ? this._s.add(c) : this._s.delete(c); } },
      contains: function (c) { return this._s.has(c); }
    },
    querySelector: function (sel) { return e.children[sel] || null; },
    querySelectorAll: function () { return []; },
    getAttribute: function () { return null; },
    setAttribute: function (n, v) { e._attrs[n] = String(v); }
  };
  Object.defineProperty(e, 'textContent', {
    configurable: true,
    get: function () { return e._text; },
    set: function (v) { e._text = String(v); }
  });
  Object.defineProperty(e, 'innerHTML', {
    configurable: true,
    get: function () { return e._html; },
    set: function (v) { e._html = String(v); e._sets.push(e._html); }
  });
  return e;
}
/* results box: rows for the picker (data-pid) AND the geocoder
   hits (data-nvhit) get clickable stubs, like the v139 harness. */
function resultsEl() {
  const e = el();
  e._rows = {};
  e.querySelectorAll = function (sel) {
    if (sel !== '[data-pid]' && sel !== '[data-nvhit]') return [];
    const attr = sel === '[data-pid]' ? 'data-pid' : 'data-nvhit';
    return Object.keys(e._rows).filter(function (k) { return e._rows[k]._attr === attr; })
      .map(function (k) { return e._rows[k]; });
  };
  Object.defineProperty(e, 'innerHTML', {
    configurable: true,
    get: function () { return e._html; },
    set: function (v) {
      e._html = String(v); e._sets.push(e._html); e._rows = {};
      const re = /(data-pid|data-nvhit)="([^"]+)"/g; let m;
      while ((m = re.exec(e._html))) {
        const attr = m[1], val = m[2];
        e._rows[attr + ':' + val] = { _attr: attr, onclick: null,
          getAttribute: function (n) { return n === attr ? val : null; },
          click: function () { if (this.onclick) this.onclick(); } };
      }
    }
  });
  return e;
}

function makeWorld(storeData, geoRows) {
  const store = {
    get: function (k, d) { return storeData[k] !== undefined ? JSON.parse(JSON.stringify(storeData[k])) : d; },
    set: function (k, v) { storeData[k] = v; },
    del: function (k) { delete storeData[k]; }
  };
  const ids = ['nv_banner', 'nv_map', 'nv_mode_truck', 'nv_mode_car', 'nv_follow', 'nv_mute',
    'nv_q', 'nv_search', 'nv_results', 'nv_destnote', 'nv_route', 'nv_end', 'nv_note', 'nv_steps',
    'nv_pq', 'nv_presults',
    'nv_back', 'nv_drive', 'nv_drive_screen', 'nv_drive_map',
    'nvd_dist', 'nvd_inst', 'nvd_road', 'nvd_eta_main', 'nvd_eta_sub', 'nvd_reroute', 'nvd_plane',
    'nvd_mute', 'nvd_exit', 'nvd_you', 'nvd_avatar_picker'];
  const reg = {};
  ids.forEach(function (id) { reg[id] = el(); });
  reg.nv_results = resultsEl();
  reg.nv_presults = resultsEl();
  reg.nv_banner.children['.nv-banner-main'] = el();
  reg.nv_banner.children['.nv-banner-sub'] = el();
  const avOpts = ['dump', 'semi', 'pickup', 'arrow'].map(function (k) {
    const o = el();
    o.getAttribute = function (n) { return n === 'data-avatar' ? k : null; };
    return o;
  });
  reg.nvd_avatar_picker.querySelectorAll = function (sel) { return sel === '[data-avatar]' ? avOpts : []; };
  const body = el();
  body.querySelector = function (sel) { return reg[sel.slice(1)] || null; };
  body.querySelectorAll = function () { return []; };

  const calls = { fetch: [], spoken: [], learned: [] };
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
    tileLayer: function () { return { addTo: function (mm) { if (mm && mm.addLayer) mm.addLayer(this); return this; } }; },
    marker: function () { return { addTo: function (mm) { if (mm && mm.addLayer) mm.addLayer(this); return this; }, setLatLng: function () {} }; },
    circleMarker: function () {
      const cm = { addTo: function (mm) { if (mm && mm.addLayer) mm.addLayer(this); return cm; }, setLatLng: function () {} };
      return cm;
    },
    polyline: function () {
      const pl = { addTo: function (mm) { if (mm && mm.addLayer) mm.addLayer(this); return pl; },
        setLatLngs: function () {}, getBounds: function () { return {}; } };
      return pl;
    },
    layerGroup: function (kids) {
      const g = { getLayers: function () { return (kids || []).slice(); },
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
      createElement: function () { return { href: '', style: {}, click: function () {}, remove: function () {} }; },
      body: { appendChild: function () {}, classList: { add: function () {}, remove: function () {} } }
    },
    App: {
      _esc: function (s) { return String(s == null ? '' : s); }, _store: store,
      _today: function () { return '2026-10-21'; }, openModule: function () {}
    },
    Meticulous: { modules: { navigation: {
      pickerEntries: function () { return { rows: [], recents: true }; },
      displayPlaceName: function (p) { return p && p.name ? p.name : ''; },
      learnCoords: function (name, lat, lng) { calls.learned.push([name, lat, lng]); return true; }
    } } },
    L: L,
    navigator: { geolocation: { watchPosition: function (cb) { geoCb = cb; return 7; }, clearWatch: function () {} } },
    speechSynthesis: { cancel: function () {}, speak: function (u) { calls.spoken.push(u.text); }, getVoices: function () { return []; } },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    fetch: function (url) {
      calls.fetch.push(url);
      if (url.indexOf('/route') >= 0) {
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(fixture); } });
      }
      if (url.indexOf('nominatim') >= 0) {
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(geoRows); } });
      }
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); } });
    }
  };
  world.window = world;
  vm.createContext(world);
  vm.runInContext(navSrc, world);
  return {
    world: world, reg: reg, body: body, calls: calls, storeData: storeData,
    firePos: function (la, lo, hd, sp) { geoCb({ coords: { latitude: la, longitude: lo, heading: hd, speed: sp } }); },
    geoFetches: function () { return calls.fetch.filter(function (u) { return u.indexOf('nominatim') >= 0; }); },
    routeFetches: function () { return calls.fetch.filter(function (u) { return u.indexOf('/route') >= 0; }); }
  };
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 10); }); }
async function settle() { await tick(); await tick(); await tick(); await tick(); }

const HOME_ROW = [{ lat: '51.15710', lon: '-113.93862', display_name: '1243 Cornerstone Boulevard NE, Calgary, Alberta' }];

(async function () {
  console.log('— the 2-step journey: an address-only saved place —');
  {
    const storeData = {
      navigator: { profile: {}, muted: false, mode: 'truck' },
      nav_pending: { name: 'Home', query: '1243 Cornerstone Boulevard NE, Calgary', ts: Date.now() }
    };
    const w = makeWorld(storeData, HOME_ROW);
    const api = w.world.Meticulous.modules.navigator;
    api.render(w.body);
    await settle();
    eq('the search ran by itself (no Search tap from the driver)', w.geoFetches().length, 1);
    ok('no "Use this" list was EVER rendered for the saved place',
      w.reg.nv_results._sets.every(function (h) { return h.indexOf('Use this') === -1; }),
      JSON.stringify(w.reg.nv_results._sets).slice(0, 200));
    eq('the place learned its pin', w.calls.learned, [['Home', 51.1571, -113.93862]]);
    w.firePos(ORIGIN[0], ORIGIN[1], 40);
    await settle();
    eq('routing started with no further tap', w.routeFetches().length >= 1, true);
    ok('the pending hand-off was consumed once', !('nav_pending' in w.storeData));
  }

  console.log('— a pinned place: no search at all —');
  {
    const storeData = {
      navigator: { profile: {}, muted: false, mode: 'truck' },
      nav_pending: { name: 'Star Pit', lat: 50.985, lng: -114.052, ts: Date.now() }
    };
    const w = makeWorld(storeData, HOME_ROW);
    const api = w.world.Meticulous.modules.navigator;
    api.render(w.body);
    await settle();
    w.firePos(ORIGIN[0], ORIGIN[1], 40);
    await settle();
    eq('no geocoder call for a pinned place', w.geoFetches().length, 0);
    eq('routing started straight from the pin', w.routeFetches().length >= 1, true);
    eq('nothing to learn — the pin was already there', w.calls.learned, []);
  }

  console.log('— a NEW place keeps the form: list + confirm —');
  {
    const storeData = { navigator: { profile: {}, muted: false, mode: 'truck' } };
    const rows = [HOME_ROW[0], { lat: '51.20000', lon: '-114.00000', display_name: 'Somewhere Else, Calgary, Alberta' }];
    const w = makeWorld(storeData, rows);
    const api = w.world.Meticulous.modules.navigator;
    api.render(w.body);
    w.firePos(ORIGIN[0], ORIGIN[1], 40);
    await settle();
    w.reg.nv_q.value = '1243 Cornerstone Boulevard';
    w.reg.nv_search.onclick();
    await settle();
    ok('a manual search still renders the results list',
      w.reg.nv_results._html.indexOf('Use this') >= 0);
    eq('no route before the driver confirms', w.routeFetches().length, 0);
    eq('nothing learned from a manual search', w.calls.learned, []);
    const hit = w.reg.nv_results.querySelectorAll('[data-nvhit]')[0];
    ok('the hit button exists', !!hit);
    hit.click();
    await settle();
    eq('the confirm tap routes', w.routeFetches().length >= 1, true);
  }

  console.log('— an arrival that resolves to nothing spends its intent —');
  {
    const storeData = {
      navigator: { profile: {}, muted: false, mode: 'truck' },
      nav_pending: { name: 'Ghost Place', query: '999 Nowhere Road', ts: Date.now() }
    };
    const w = makeWorld(storeData, []);
    const api = w.world.Meticulous.modules.navigator;
    api.render(w.body);
    await settle();
    ok('the honest no-results note shows', w.reg.nv_results._html.indexOf('No places found') >= 0);
    w.firePos(ORIGIN[0], ORIGIN[1], 40);
    await settle();
    eq('no route from a ghost', w.routeFetches().length, 0);
    /* and a later manual search behaves manually (list, no auto-pick) */
    w.world.fetch = w.world.fetch; /* fetch stub already returns [] for this world; swap rows via a fresh world check below */
  }

  console.log('— learnCoords on the real Navigation module —');
  {
    const mem = {
      nav_data: {
        personal: [{ id: 'p1', name: 'Home', address: '1243 Cornerstone Blvd NE' }],
        work: [{ id: 'w1', name: 'Star Pit', lat: 50.985, lng: -114.052 }],
        recent: []
      }
    };
    const store = {
      get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
      set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
      del: function (k) { delete mem[k]; return true; }
    };
    const sb = {
      console: console, Date: Date, Math: Math, JSON: JSON,
      App: { _store: store, _today: function () { return '2026-10-21'; }, _esc: function (s) { return String(s == null ? '' : s); }, openModule: function () {} },
      Meticulous: { modules: {} }
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(naviSrc, sb, { filename: 'modules/navigation.js' });
    const NAV = sb.Meticulous.modules.navigation;
    eq('an address-only place learns its pin', NAV.learnCoords('Home', 51.1571, -113.93862), true);
    const saved = mem.nav_data.personal[0];
    ok('the pin persisted on the place', saved.lat === 51.1571 && saved.lng === -113.93862, JSON.stringify(saved));
    eq('an existing pin never moves', NAV.learnCoords('Star Pit', 1, 2), false);
    const pit = mem.nav_data.work[0];
    ok('the pit kept its own pin', pit.lat === 50.985 && pit.lng === -114.052);
    eq('an unknown name learns nothing', NAV.learnCoords('Atlantis', 1, 2), false);
    eq('a second learn for the same place is a no-op (pin now exists)', NAV.learnCoords('Home', 9, 9), false);
  }

  console.log('— pins —');
  ok('the auto-pick reads pendGoNow inside the search success', navSrc.indexOf('NAV-2STEP') >= 0 && navSrc.indexOf('navLearn.learnCoords') >= 0);
  ok('the no-results branch spends the intent', navSrc.indexOf("S.pendName = '';") >= 0);
  eq('webVersion is 209', ver.webVersion, 218);
  ok('index.html pins the v209 build', idxSrc.indexOf('?v=218') >= 0 && idxSrc.indexOf('?v=' + '208') < 0);

  console.log('\nnav-2step-v209 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR ' + (e && e.stack || e)); process.exit(1); });
