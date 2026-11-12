#!/usr/bin/env node
/* Meticulous v434 — NAV-SEARCHBOX-LINK (owner's film, Nov 12,
 * 2026 11:21–11:22 CST, on web 432 — "It's not working now").
 *
 * THE FILM: in the Navigator he pastes into the TOP search box
 * ("Search places or an address…") the text
 *   "Hauling To: https://maps.app.goo.gl/8FsunB9m3Rijgymq8?g_st=ic"
 * — the Hauling To short link exactly as it arrives in a
 * dispatch text. The Places panel answers "No place matches
 * that — try Search as address below." Underneath, the nav
 * state thrashes: banners flip between the old plan's
 * instructions ("Drive north · 250 m to destination"), "You
 * have arrived — Aecon Trans" (the PREVIOUS destination) and
 * "Destination set — Getting your truck route…"; the remaining
 * distance walks 250 → 220 → 180 m while he stands still; the
 * destination pin on the map stays the OLD pin by the airport,
 * not the link's pin (51.1225089,-114.0122197).
 *
 * THE DEFECTS, in the shipped 432 bytes:
 *  (1) The MAIN search box had no link intake of its own. The
 *      v395 pin step stood at the head of the SHEET search; the
 *      map Go reached it only by delegation, its words landing
 *      in the folded sheet — and the map face's own answer to
 *      the paste was the Places panel's dead end.
 *  (2) setDest left the OLD plan standing under a NEW
 *      destination: maybeAutoRoute refuses to fire while any
 *      plan stands, so no route to the new pin was ever
 *      requested, and every fix ran trackProgress against the
 *      old line with the new pin in S.dest — paintStep
 *      repainting the old instructions over the "Destination
 *      set" banner, arrival judged on the old route's tail.
 *      A route request in flight for the old destination could
 *      also LAND after the change and be adopted wholesale.
 *
 * THE FIX (modules/navigator.js only):
 *  - The map search box reads a link itself (searchBoxPin /
 *    mapLinkGo): the same sentPinCoords read and the same ONE
 *    link brain (PinLinks.resolveUrl) as the sheet, landed
 *    through the same landSentPin — with its feedback on the
 *    MAP banner. The Places panel never dead-ends a link: it
 *    shows the one honest line ("That is a Maps link — tap
 *    Go…"). Ordinary text is not consumed and searches exactly
 *    as before.
 *  - setDest retires the old route the moment a NEW
 *    destination lands (plan, line, steps, arrival) and arms
 *    exactly one auto-route for the new pin; doRoute stamps
 *    the destination it answers and drops a stale landing (or
 *    a stale failure) instead of adopting it.
 *
 * BEHAVIOURAL below: his exact paste replayed through the map
 * search box; the Go Empty labelled line; a bare link; a full
 * link; typed-text regressions; the ARRIVED → new-destination
 * handover as a state machine (banner sampled at every step —
 * monotone: set → routing → guidance, never the old arrival
 * again, no second route request while he stands still); and
 * the stale-landing drop. The world is the v395 stub world
 * plus a fake clock, a query-aware picker, per-destination
 * route fixtures and a gateable route answer.
 *
 * Run: node tools/nav-searchbox-link-v433-test.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const navSrc = read('modules/navigator.js');
const pinSrc = read('js/pinlinks.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function near(name, got, want) {
  ok(name, Array.isArray(got) && Math.abs(got[0] - want[0]) < 1e-6 && Math.abs(got[1] - want[1]) < 1e-6,
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* ---------- fixtures ---------- */
const P0 = [51.123631, -113.983585];              /* his filmed spot, Nov 12 11:21 CST */
const GO_EMPTY = [51.1252222, -113.9828056];      /* the Nov 12 Go Empty pin */
const HAULING = [51.1225089, -114.0122197];       /* the Nov 12 Hauling To pin */
const HIS_PASTE = 'Hauling To: https://maps.app.goo.gl/8FsunB9m3Rijgymq8?g_st=ic';
const GO_EMPTY_LINE = 'Go Empty: https://maps.app.goo.gl/31tR5SGgMHcsBLGHA';
const BARE_LINK = 'https://maps.app.goo.gl/8FsunB9m3Rijgymq8';
const FULL_LINK = 'https://www.google.com/maps/search/?api=1&query=51.1225089,-114.0122197';
const DEST = [51.1075, -114.0845];                /* the geocoder's place */
const PLACE = { name: 'Butterfly', lat: 51.1315, lng: -114.0103 };

function havM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
/* polyline encode, precision 6 (the module's decodeShape) */
function encShape(pts) {
  let out = '', plat = 0, plon = 0;
  function enc(v) {
    let n = v < 0 ? ~(v << 1) : (v << 1), s = '';
    while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
    return s + String.fromCharCode(n + 63);
  }
  pts.forEach(function (p) {
    const la = Math.round(p[0] * 1e6), lo = Math.round(p[1] * 1e6);
    out += enc(la - plat) + enc(lo - plon); plat = la; plon = lo;
  });
  return out;
}
/* a straight-line Valhalla-shaped trip origin → dest */
function makeTrip(origin, dest, street) {
  const pts = [];
  for (let i = 0; i <= 7; i++) {
    pts.push([origin[0] + (dest[0] - origin[0]) * i / 7, origin[1] + (dest[1] - origin[1]) * i / 7]);
  }
  const km = havM(origin, dest) / 1000;
  return {
    trip: {
      summary: { length: km, time: 300 },
      legs: [{
        summary: { length: km, time: 300 },
        shape: encShape(pts),
        maneuvers: [
          { type: 1, instruction: 'Drive north on ' + street + '.', verbal_pre_transition_instruction: 'Drive north on ' + street + '.', verbal_post_transition_instruction: '', street_names: [street], length: km * 0.8, begin_shape_index: 0, end_shape_index: 6 },
          { type: 4, instruction: 'Arrive at your destination.', verbal_pre_transition_instruction: '', verbal_post_transition_instruction: 'You have arrived.', street_names: [], length: km * 0.2, begin_shape_index: 6, end_shape_index: 7 }
        ]
      }]
    }
  };
}
function streetFor(dest) {
  if (Math.abs(dest[0] - GO_EMPTY[0]) < 1e-6 && Math.abs(dest[1] - GO_EMPTY[1]) < 1e-6) return 'Alpha Street';
  if (Math.abs(dest[0] - HAULING[0]) < 1e-6 && Math.abs(dest[1] - HAULING[1]) < 1e-6) return 'Bravo Street';
  return 'Test Road';
}

/* ---------- the stub world (v395 lineage) ---------- */
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

const RealDate = Date;
function makeWorld(storeData) {
  let fakeNow = 1762000000000;
  function FakeDate() {
    if (arguments.length) return new (Function.prototype.bind.apply(RealDate, [null].concat(Array.prototype.slice.call(arguments))))();
    return new RealDate(fakeNow);
  }
  FakeDate.now = function () { return fakeNow; };
  FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC; FakeDate.prototype = RealDate.prototype;

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
  const calls = { fetch: [], routeReqs: [], markers: [], markerMoves: [], spoken: [], visits: [], lastMarker: null };
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
    marker: function (ll) {
      calls.markers.push(ll);
      const mk = { _ll: ll, addTo: function () { return mk; }, setLatLng: function (nl) { mk._ll = nl; calls.markerMoves.push(nl); } };
      calls.lastMarker = mk;
      return mk;
    },
    circleMarker: function () { return { addTo: function () { return this; }, setLatLng: function () {} }; },
    polyline: function () { return { addTo: function () { return this; }, setLatLngs: function () {}, getBounds: function () { return {}; } }; },
    layerGroup: function () { return { addTo: function () { return this; }, getLayers: function () { return []; } }; },
    divIcon: function () { return {}; }
  };
  const picker = {
    /* query-aware: recents show the saved place; a typed query
       matches it only by name — a link matches NOTHING (the
       shipped panel's dead-end condition). */
    pickerEntries: function (kind, q) {
      const t = String(q || '').toLowerCase();
      if (!t || t.indexOf('butterfly') >= 0) return { recents: !t, rows: [{ place: PLACE }] };
      return { recents: false, rows: [] };
    },
    pickerRowHTML: function () { return '<div data-pid="p1">' + PLACE.name + '</div>'; },
    pickerFind: function () { return { place: PLACE }; },
    displayPlaceName: function (p) { return p.name; },
    setTab: function () {},
    recordVisit: function (name, la, ln) { calls.visits.push([name, la, ln]); },
    learnCoords: function () {}
  };
  let geoCb = null;
  /* the route gate: holdDest = [lat,lng] whose /route answer is
     deferred until releaseRoutes() */
  const gate = { holdDest: null, pending: [] };
  function routeResponse(bodyJson) {
    const locs = bodyJson.locations || [];
    const d = locs[locs.length - 1] || {};
    const o = locs[0] || {};
    const dest = [Number(d.lat), Number(d.lon)], origin = [Number(o.lat), Number(o.lon)];
    const trip = makeTrip(origin, dest, streetFor(dest));
    return { ok: true, status: 200, url: '', json: function () { return Promise.resolve(trip); } };
  }
  const world = {
    console: console, JSON: JSON, Math: Math, Date: FakeDate, setTimeout: setTimeout, clearTimeout: clearTimeout,
    requestAnimationFrame: function (cb) { return setTimeout(function () { cb(fakeNow); }, 5); },
    cancelAnimationFrame: function (id) { clearTimeout(id); },
    window: null,
    document: { hidden: false, addEventListener: function () {}, removeEventListener: function () {},
      createElement: function () { return { href: '', style: {}, click: function () {}, remove: function () {} }; },
      body: { appendChild: function () {}, classList: { add: function () {}, remove: function () {} } } },
    open: function () {},
    App: { _esc: function (s) { return String(s == null ? '' : s); }, _store: store, _today: function () { return '2026-11-12'; }, openModule: function () {} },
    Meticulous: { modules: { navigation: picker } },
    L: L,
    navigator: { geolocation: { watchPosition: function (cb) { geoCb = cb; return 7; }, clearWatch: function () {} } },
    speechSynthesis: { cancel: function () {}, speak: function (u) { calls.spoken.push(u.text); }, getVoices: function () { return []; } },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    fetch: function (url, opts) {
      const u = String(url);
      calls.fetch.push(u);
      if (u.indexOf('/route') >= 0) {
        let bj = {};
        try { bj = JSON.parse((opts && opts.body) || '{}'); } catch (e) {}
        calls.routeReqs.push({ body: bj, osrm: bj.format === 'osrm' });
        const locs = bj.locations || [];
        const d = locs[locs.length - 1] || {};
        if (gate.holdDest && Math.abs(Number(d.lat) - gate.holdDest[0]) < 1e-6 && Math.abs(Number(d.lon) - gate.holdDest[1]) < 1e-6) {
          return new Promise(function (res) { gate.pending.push(function () { res(routeResponse(bj)); }); });
        }
        return Promise.resolve(routeResponse(bj));
      }
      if (u.indexOf('maps.app.goo.gl') >= 0) {
        let landing = 'https://www.google.com/maps';
        if (u.indexOf('31tR5SGgMHcsBLGHA') >= 0) landing = 'https://www.google.com/maps/place/Go+Empty/@51.1252222,-113.9828056,17z';
        else if (u.indexOf('8FsunB9m3Rijgymq8') >= 0) landing = 'https://www.google.com/maps/place/Hauling+To/@51.1225089,-114.0122197,17z';
        return Promise.resolve({ ok: true, status: 200, url: landing, json: function () { return Promise.resolve({}); } });
      }
      if (u.indexOf('2.31.47.19') >= 0) {
        return Promise.resolve({ ok: false, status: 403, url: u, json: function () { return Promise.reject(new Error('forbidden')); } });
      }
      if (u.indexOf('nominatim') >= 0 && u.indexOf('reverse') >= 0) {
        return Promise.resolve({ ok: true, status: 200, url: u, json: function () { return Promise.resolve({ display_name: 'Test Road, Calgary', address: { road: 'Test Road' } }); } });
      }
      if (u.indexOf('nominatim') >= 0) {
        let q = '';
        try { q = decodeURIComponent((u.split('q=')[1] || '').split('&')[0]); } catch (e) {}
        if (q === 'Geocoder Place') {
          return Promise.resolve({ ok: true, status: 200, url: u, json: function () { return Promise.resolve([{ lat: String(DEST[0]), lon: String(DEST[1]), display_name: 'Geocoder Place, Calgary, Canada' }]); } });
        }
        return Promise.resolve({ ok: true, status: 200, url: u, json: function () { return Promise.resolve([]); } });
      }
      return Promise.resolve({ ok: true, status: 200, url: u, json: function () { return Promise.resolve([]); } });
    }
  };
  world.window = world;
  vm.createContext(world);
  vm.runInContext(pinSrc, world);
  vm.runInContext(navSrc, world);
  return {
    world: world, reg: reg, body: body, calls: calls, storeData: storeData, gate: gate,
    NAV: world.Meticulous.modules.navigator,
    advance: function (ms) { fakeNow += ms; },
    firePos: function (la, lo, speed) {
      try { if (geoCb) geoCb({ coords: { latitude: la, longitude: lo, heading: 40, speed: speed || 0 } }); }
      catch (e) { /* the banner writes happen before any paint a stub cannot serve */ }
    },
    releaseRoutes: function () { const p = gate.pending.splice(0); p.forEach(function (f) { f(); }); }
  };
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 10); }); }
async function settle(n) { for (let i = 0; i < (n || 8); i++) await tick(10); }
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
function bannerMain(w) { return w.body.querySelector('#nv_banner').children['.nv-banner-main'].textContent; }
function bannerSub(w) { return w.body.querySelector('#nv_banner').children['.nv-banner-sub'].textContent; }
function genuineReqs(w) {
  return w.calls.routeReqs.filter(function (r) { return !r.osrm; }).map(function (r) { return r.body; });
}
function destOf(req) {
  const locs = (req && req.locations) || [];
  const d = locs[locs.length - 1] || {};
  return [Number(d.lat), Number(d.lon)];
}
function searched(w) {
  return w.calls.fetch.some(function (u) { return u.indexOf('nominatim') >= 0 && u.indexOf('/search') >= 0; });
}
async function mapGo(w, text) {
  Q(w, 'nv_map_q').value = text;
  Q(w, 'nv_map_q').fire('input');
  Q(w, 'nv_map_go').onclick();
  await settle();
}

(async function () {
  console.log('— S. source pins —');
  {
    ok('the map box has its own link read (searchBoxPin)', navSrc.indexOf('function searchBoxPin(') !== -1);
    ok('the map box lands links itself (mapLinkGo)', navSrc.indexOf('function mapLinkGo(') !== -1);
    const goBody = navSrc.slice(navSrc.indexOf('var mapGoBtn'), navSrc.indexOf('var mapAddrBtn'));
    ok('the Go handler consumes a link before delegating', goBody.indexOf('mapLinkGo(v)') !== -1);
    const panelBody = navSrc.slice(navSrc.indexOf('function paintPlacesPanel()'), navSrc.indexOf('function searchBoxPin('));
    ok('the Places panel answers a link with the honest line, never the dead end',
      panelBody.indexOf('That is a Maps link') !== -1 && panelBody.indexOf('searchBoxPin(nvMapQ)') !== -1);
    const sdBody = navSrc.slice(navSrc.indexOf('function setDest('), navSrc.indexOf('function maybeAutoRoute()'));
    ok('setDest retires the old plan for a NEW destination',
      sdBody.indexOf('S.plan = null; S.line = null;') !== -1 &&
      sdBody.indexOf('S.plan = null; S.line = null;') < sdBody.indexOf('maybeAutoRoute();'));
    ok('doRoute stamps the destination it answers (destMoved)',
      navSrc.indexOf('var destMoved = function ()') !== -1 &&
      navSrc.indexOf('if (destMoved())') !== -1);
    ok('the pin door stands untouched (openSentPin still reads #nv_link)',
      navSrc.indexOf('function openSentPin()') !== -1 &&
      navSrc.indexOf("var inp = body.querySelector('#nv_link');") !== -1);
    ok('the v432 standstill judge stands untouched',
      navSrc.indexOf('S.stillState = standstillStep(S.stillState, lat, lon, Date.now());') !== -1);
  }

  console.log('— A. HIS PASTE: the labelled Hauling To short link in the MAIN search box —');
  {
    const w = makeWorld({});
    prepRender(w);
    w.firePos(P0[0], P0[1], 0);
    Q(w, 'nv_map_q').value = HIS_PASTE;
    Q(w, 'nv_map_q').fire('input');
    const panel = String(Q(w, 'nv_map_results').innerHTML);
    ok('the panel never dead-ends the paste (no "No place matches that")',
      panel.indexOf('No place matches that') === -1, 'panel=' + panel);
    ok('the panel names it as a Maps link', panel.indexOf('Maps link') >= 0, 'panel=' + panel);
    Q(w, 'nv_map_go').onclick();
    await settle();
    near('the destination pin is the link’s pin', w.calls.lastMarker && w.calls.lastMarker._ll, HAULING);
    eq('exactly one route request', genuineReqs(w).length, 1);
    near('the route request is FOR the link’s pin', genuineReqs(w).length ? destOf(genuineReqs(w)[0]) : null, HAULING);
    ok('no Places/geocoder search was run on the link text', !searched(w),
      'fetches=' + JSON.stringify(w.calls.fetch));
    eq('the visit is recorded (Manifest law)', w.calls.visits, [['Sent pin', HAULING[0], HAULING[1]]]);
  }

  console.log('— B. the Go Empty labelled line —');
  {
    const w = makeWorld({});
    prepRender(w);
    w.firePos(P0[0], P0[1], 0);
    await mapGo(w, GO_EMPTY_LINE);
    near('the Go Empty pin lands', w.calls.lastMarker && w.calls.lastMarker._ll, GO_EMPTY);
    eq('exactly one route request', genuineReqs(w).length, 1);
    near('the request is for the Go Empty pin', genuineReqs(w).length ? destOf(genuineReqs(w)[0]) : null, GO_EMPTY);
    ok('no Places search on the link text', !searched(w));
  }

  console.log('— C. a bare short link —');
  {
    const w = makeWorld({});
    prepRender(w);
    w.firePos(P0[0], P0[1], 0);
    await mapGo(w, BARE_LINK);
    near('the bare link’s pin lands', w.calls.lastMarker && w.calls.lastMarker._ll, HAULING);
    eq('exactly one route request', genuineReqs(w).length, 1);
    ok('no Places search on the link text', !searched(w));
  }

  console.log('— D. a full link (pin inside the text) —');
  {
    const w = makeWorld({});
    prepRender(w);
    w.firePos(P0[0], P0[1], 0);
    await mapGo(w, FULL_LINK);
    near('the full link’s pin lands', w.calls.lastMarker && w.calls.lastMarker._ll, HAULING);
    eq('exactly one route request', genuineReqs(w).length, 1);
    ok('the short-link follow was not needed', !w.calls.fetch.some(function (u) { return u.indexOf('maps.app.goo.gl') >= 0; }));
  }

  console.log('— E. regression: ordinary text still searches places —');
  {
    const w = makeWorld({});
    prepRender(w);
    w.firePos(P0[0], P0[1], 0);
    await mapGo(w, 'Geocoder Place');
    ok('the geocoder was consulted for typed words', searched(w));
    ok('the results list is painted', String(Q(w, 'nv_results').innerHTML).indexOf('Geocoder Place') >= 0);
    Q(w, 'nv_results').hit(0);
    await settle();
    near('Use this lands the geocoder pin', w.calls.lastMarker && w.calls.lastMarker._ll, DEST);
    eq('one route request, for the picked place', genuineReqs(w).length, 1);
  }
  {
    const w = makeWorld({});
    prepRender(w);
    w.firePos(P0[0], P0[1], 0);
    await mapGo(w, 'Aecon');
    ok('an unknown name still runs the place search', searched(w));
    eq('no route is requested for a name with no result', genuineReqs(w).length, 0);
    ok('the honest no-result words still land', String(Q(w, 'nv_results').innerHTML).indexOf('No places found') >= 0,
      'box=' + Q(w, 'nv_results').innerHTML);
  }

  console.log('— F. the handover: ARRIVED at A, then his paste sets B —');
  {
    const w = makeWorld({});
    prepRender(w);
    w.firePos(P0[0], P0[1], 0);
    /* route to Go Empty (A) and arrive */
    await mapGo(w, 'https://www.google.com/maps/search/?api=1&query=51.1252222,-113.9828056');
    eq('route to A requested once', genuineReqs(w).length, 1);
    w.advance(1000);
    w.firePos(GO_EMPTY[0], GO_EMPTY[1], 0);
    await settle();
    eq('arrival at A is the standing state before the paste', bannerMain(w), 'You have arrived');

    /* hold B's route answer; paste his link and tap Go */
    w.gate.holdDest = HAULING;
    Q(w, 'nv_map_q').value = HIS_PASTE;
    Q(w, 'nv_map_q').fire('input');
    Q(w, 'nv_map_go').onclick();
    await settle();
    eq('B’s route is requested exactly once', genuineReqs(w).length, 2);
    near('the second request is for B', destOf(genuineReqs(w)[1]), HAULING);
    near('the map pin is B’s pin', w.calls.lastMarker && w.calls.lastMarker._ll, HAULING);
    const seen = [bannerMain(w)];
    ok('the banner leaves the old arrival for the one honest state',
      bannerMain(w) === 'Destination set' || bannerMain(w) === 'Routing…', 'main=' + bannerMain(w));

    /* standing still, route in flight: jitter fixes, sampled */
    const jit = [[0.00003, 0.00002], [-0.00002, 0.00003], [0.00001, -0.00002]];
    for (let i = 0; i < jit.length; i++) {
      w.advance(1000);
      w.firePos(P0[0] + jit[i][0], P0[1] + jit[i][1], 0);
      await settle(2);
      seen.push(bannerMain(w));
    }
    ok('no state flips while the route is in flight (one stable state)',
      seen.every(function (s) { return s === seen[0]; }) && seen[0] !== 'You have arrived',
      'seen=' + JSON.stringify(seen));
    ok('the old arrival never re-renders', seen.indexOf('You have arrived') === -1);
    eq('no repeated route request while he stands still', genuineReqs(w).length, 2);

    /* the route lands: guidance for B takes over, once */
    w.gate.holdDest = null;
    w.releaseRoutes();
    await settle();
    eq('guidance is B’s plan', bannerMain(w), 'Drive north on Bravo Street.');
    const sub0 = bannerSub(w);
    ok('the remaining distance is B’s (the long way back across town)',
      /to destination/.test(sub0) && sub0.indexOf('250 m') === -1, 'sub=' + sub0);

    /* parked by B's route start: the countdown holds still */
    const subs = [];
    for (let i = 0; i < 4; i++) {
      w.advance(1000);
      w.firePos(P0[0] + jit[i % 3][0], P0[1] + jit[i % 3][1], 0);
      await settle(2);
      subs.push(bannerSub(w));
      ok('no arrival against the new destination while parked (fix ' + (i + 1) + ')',
        bannerMain(w) !== 'You have arrived', 'main=' + bannerMain(w));
    }
    ok('the countdown holds still once the standstill proof stands',
      subs[2] === subs[3], 'subs=' + JSON.stringify(subs));
    eq('still exactly two route requests in total', genuineReqs(w).length, 2);
  }

  console.log('— G. the stale landing: A’s route answers after B was set —');
  {
    const w = makeWorld({});
    prepRender(w);
    w.firePos(P0[0], P0[1], 0);
    w.gate.holdDest = GO_EMPTY;
    await mapGo(w, 'https://www.google.com/maps/search/?api=1&query=51.1252222,-113.9828056');
    eq('A’s route is in flight', genuineReqs(w).length, 1);
    /* he changes his mind mid-flight: paste the Hauling To link */
    await mapGo(w, HIS_PASTE);
    near('the pin moves to B at once', w.calls.lastMarker && w.calls.lastMarker._ll, HAULING);
    /* A's answer finally lands — it must be dropped, and B's
       own route requested in its place */
    w.gate.holdDest = null;
    w.releaseRoutes();
    await settle();
    eq('B’s route is requested after the stale drop', genuineReqs(w).length, 2);
    near('the second request is for B', destOf(genuineReqs(w)[1]), HAULING);
    eq('the adopted guidance is B’s, never A’s', bannerMain(w), 'Drive north on Bravo Street.');
  }

  console.log('— H. a dead short link in the map box: plain words, never silence —');
  {
    const w = makeWorld({});
    prepRender(w);
    w.firePos(P0[0], P0[1], 0);
    await mapGo(w, 'https://maps.app.goo.gl/DeadCode0000000');
    eq('no marker is invented', w.calls.lastMarker, null);
    eq('no route is requested', genuineReqs(w).length, 0);
    ok('the banner carries the plain words', bannerMain(w) === 'That link did not lead to a pin I could read.',
      'main=' + bannerMain(w));
    ok('the sheet results box carries the same words (v395 law)',
      String(Q(w, 'nv_results').innerHTML).indexOf('full link carries the pin') >= 0,
      'box=' + Q(w, 'nv_results').innerHTML);
    ok('the geocoder is never fed the link', !searched(w));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR', e && e.stack || e); process.exit(2); });
