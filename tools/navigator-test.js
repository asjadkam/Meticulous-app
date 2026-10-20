'use strict';
/* v77 NAVIGATOR — suite.
 *
 * The turn-by-turn Navigator (modules/navigator.js) routes trucks on
 * Calgary's designated truck network through a self-hosted Valhalla
 * service (truck-nav build steps 1–4). This suite verifies:
 *   1. PURE logic (NAVPURE region): the route request for the step-3/4
 *      proof OD pair deep-equals the exact request the live service
 *      proved against (valhalla/service-route-request.json); profile
 *      defaults/sanitising; polyline6 decoding of the REAL Test B
 *      shape lands within metres of the OD endpoints; distance-along
 *      math; the maneuver plan + current-maneuver tracking over the
 *      real Test B trip (fixture: tools/navigator-fixture-tripb.json,
 *      captured from the live service Oct 15, 2026).
 *   2. RENDER + FLOW in a stubbed DOM: a GPS fix at the Test B origin
 *      and a map-tap destination, pressing Route POSTs the proven
 *      payload shape, draws the polyline, fills the banner + steps
 *      from the real response, speaks the first verbal line, and an
 *      off-route fix held past the hysteresis re-routes.
 *      v137 SUPERSEDES the v98 saved-address rule: the routing
 *      address is a BAKED-IN CONSTANT — a stored address (custom or
 *      deliberately cleared '') no longer steers or disables
 *      routing; every world routes against the shipped server.
 *   3. STATICS: module registry + teardown hook in app.js, Preferences
 *      card (v137: NO server row anywhere user-facing), index.html
 *      pins; and the ONE routing-server address baked in is the
 *      shipped constant (no loopback/private literals in the module).
 */
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
const navModSrc = read('modules/navigation.js');
const appSrc = read('js/app.js');
const prefSrc = read('modules/preferences.js');
const idxSrc = read('index.html');
const cssSrc = read('css/style.css');
const ver = JSON.parse(read('version.json'));
const fixture = JSON.parse(read('tools/navigator-fixture-tripb.json'));
const ORIGIN = [51.0955, -114.099], DEST = [51.1075, -114.0845];

/* ================= 1. pure logic ================= */
console.log('— pure: request building —');
{
  const sb = { console };
  vm.createContext(sb);
  vm.runInContext(extract(navSrc, 'NAVPURE-BEGIN', 'NAVPURE-END'), sb);

  /* The step-4 service proof request, verbatim (truck-nav/valhalla/
     service-route-request.json) — the module must produce exactly it. */
  const PROVEN = {
    locations: [
      { lon: -114.099, lat: 51.0955, type: 'break' },
      { lon: -114.0845, lat: 51.1075, type: 'break' }
    ],
    costing: 'truck',
    costing_options: {
      truck: {
        use_truck_route: 1.0,
        hgv_no_access_penalty: 100000.0,
        height: 3.9, width: 2.6, length: 9.0, weight: 24.0,
        axle_load: 10.0, axle_count: 3, hazmat: false
      }
    },
    directions_options: { units: 'kilometers' }
  };
  const got = sb.buildRouteRequest(ORIGIN, DEST, null, 'truck');
  check('truck request deep-equals the service-proven request', deepEq(got, PROVEN), JSON.stringify(got));

  const car = sb.buildRouteRequest(ORIGIN, DEST, null, 'car');
  check('car request: costing=car, no truck options', car.costing === 'car' && !('costing_options' in car));

  const hz = sb.buildRouteRequest(ORIGIN, DEST, { hazmat: true, weight: 30 }, 'truck');
  check('profile overrides land (hazmat, weight)', hz.costing_options.truck.hazmat === true && hz.costing_options.truck.weight === 30);
  check('untouched profile fields keep tandem defaults', hz.costing_options.truck.height === 3.9 && hz.costing_options.truck.axle_count === 3);

  const p0 = sb.navProfile(null), pBad = sb.navProfile({ height: -2, weight: 'x', axles: 0 });
  check('navProfile(null) = tandem defaults', deepEq(p0, sb.NAV_DEFAULT_PROFILE));
  check('navProfile sanitises nonsense back to defaults', pBad.height === 3.9 && pBad.weight === 24 && pBad.axles === 3);

  console.log('— pure: geometry —');
  const line = sb.decodeShape(fixture.trip.legs[0].shape);
  check('Test B shape decodes to a real line (>100 pts)', line.length > 100, 'got ' + line.length);
  /* Valhalla returns the shape of the ROUTED portion between the
     snapped network points, so the ends sit a few hundred metres from
     the raw OD pins (independently cross-checked against a second
     decoder: identical endpoints, line length 4.881 km vs summary
     4.886 — the decoder is exact; the trim is the engine's). */
  check('line starts near the origin (snapped)', sb.haversineM(line[0], ORIGIN) < 400, sb.haversineM(line[0], ORIGIN).toFixed(1) + ' m');
  check('line ends near the destination (snapped)', sb.haversineM(line[line.length - 1], DEST) < 400, sb.haversineM(line[line.length - 1], DEST).toFixed(1) + ' m');
  let lineKm = 0;
  for (let i = 0; i + 1 < line.length; i++) lineKm += sb.haversineM(line[i], line[i + 1]) / 1000;
  check('decoded line length matches the trip summary (±2%)', Math.abs(lineKm - 4.886) / 4.886 < 0.02, lineKm.toFixed(3) + ' km');
  check('every point stays in the Test B neighbourhood', line.every(function (p) {
    return p[0] > 51.09 && p[0] < 51.115 && p[1] > -114.10 && p[1] < -114.065;
  }));
  const dAirport = sb.haversineM([51.1315, -114.0103], [51.0085, -113.9885]);
  check('haversine airport→Foothills ≈ 13.8 km', dAirport > 13000 && dAirport < 14500, dAirport.toFixed(0) + ' m');
  const on = sb.distToRouteM(line[40], line);
  check('a point on the line is ~0 m off it', on.dist < 5, on.dist.toFixed(2) + ' m');
  const offPt = [line[40][0] + 0.002, line[40][1]]; // ~220 m north
  const off = sb.distToRouteM(offPt, line);
  check('a point 220 m north reads >150 m off-route', off.dist > 150 && off.dist < 300, off.dist.toFixed(0) + ' m');

  console.log('— pure: v125 drive spec (calm basemap + retracting line) —');
  const spec = sb.driveTileSpec();
  check('v125: drive basemap is Esri World Street Map (calm keyless raster, no hot-pink source; CARTO Voyager was first pick but its public CDN now serves API-KEY-REQUIRED placeholder tiles)',
    spec.url.indexOf('server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map') >= 0);
  check('v125: drive basemap is NOT the OSM Carto source (whose salmon motorways went hot pink under the old lift)',
    spec.url.indexOf('tile.openstreetmap.org') === -1 && spec.url.indexOf('cartocdn') === -1);
  /* A straight east-west line [lat, lng]: segments of ~1 degree lng. */
  const rLine = [[50, -114], [50, -113], [50, -112]];
  const rem0 = sb.routeRemainder(rLine, [50, -114]);
  check('v125 retract: at the origin the remainder is the WHOLE line',
    rem0 && rem0.points.length === 3 && Math.abs(rem0.points[0][1] - -114) < 1e-9 && rem0.along === 0);
  const remMid = sb.routeRemainder(rLine, [50, -112.6]);
  check('v125 retract: past the midpoint the drawn line starts AT the truck, not the origin',
    remMid && remMid.points.length === 2 && Math.abs(remMid.points[0][1] - -112.6) < 0.01 &&
    Math.abs(remMid.points[1][1] - -112) < 1e-9 && remMid.seg === 1);
  const remEnd = sb.routeRemainder(rLine, [50, -111.99]);
  check('v125 retract: at the destination the remainder collapses to the final point (still drawable)',
    remEnd && remEnd.points.length === 2 && sb.haversineM(remEnd.points[remEnd.points.length - 1], [50, -112]) < 1);
  check('v125 retract: remainder shrinks monotonically as the truck advances',
    sb.routeRemainder(rLine, [50, -113.8]).along < sb.routeRemainder(rLine, [50, -113.2]).along &&
    sb.routeRemainder(rLine, [50, -113.2]).along < remMid.along);
  check('v125 retract: degenerate inputs stay null (no line / no fix)',
    sb.routeRemainder(null, [50, -114]) === null && sb.routeRemainder(rLine, null) === null);

  console.log('— pure: maneuver plan —');
  const plan = sb.maneuverPlan(fixture.trip);
  check('plan flattens all 10 Test B maneuvers', plan.maneuvers.length === 10, 'got ' + plan.maneuvers.length);
  check('plan total = summary (4.886 km / 7.02 min)', Math.abs(plan.totalKm - 4.886) < 0.01 && Math.abs(plan.totalMin - 7.02) < 0.1);
  check('first maneuver is the Norquay Heights depart', plan.maneuvers[0].instruction.indexOf('Norquay Heights NW') >= 0);
  check('maneuvers carry spoken pre-transition lines', plan.maneuvers.every(function (m) { return typeof m.verbalPre === 'string'; }));
  check('cumulative ends are monotonic and reach the total', plan.maneuvers[9].cumEndKm <= plan.totalKm + 0.001 &&
    plan.maneuvers.every(function (m, i) { return i === 0 || m.cumStartKm >= plan.maneuvers[i - 1].cumEndKm - 1e-9; }));
  check('at 0 m along: maneuver 0', sb.currentManeuverIndex(plan, 0) === 0);
  check('at 200 m along: past the two short opening maneuvers', sb.currentManeuverIndex(plan, 200) === 2);
  check('fmtDist metres/km', sb.fmtDist(240) === '240 m' && sb.fmtDist(4886) === '4.9 km');
  check('fmtMin', sb.fmtMin(7.02) === '7 min' && sb.fmtMin(65) === '1 h 5 min');

  console.log('— pure: drive screen engine (v101) —');
  check('plan maneuvers carry street names', plan.maneuvers[0].streets.indexOf('Norquay Heights NW') >= 0 &&
    plan.maneuvers[5].streets.indexOf('4 Street NW') >= 0);
  check('currentRoadName at start = Norquay Heights NW', sb.currentRoadName(plan, 0) === 'Norquay Heights NW',
    sb.currentRoadName(plan, 0));
  check('currentRoadName at the end falls back to the last named road', sb.currentRoadName(plan, 9) === 'Nottingham Road NW',
    sb.currentRoadName(plan, 9));
  const dp0 = sb.driveProgress(plan, 0);
  check('driveProgress at 0 m: idx 0, ~90 m to the turn, full trip left, full ETA',
    dp0.idx === 0 && Math.abs(dp0.toTurnM - 90) < 2 && Math.abs(dp0.leftM - 4886) < 2 &&
    Math.abs(dp0.etaMin - 7.02) < 0.05 && dp0.next === plan.maneuvers[1]);
  check('driveProgress road at 0 m = Norquay Heights NW', dp0.road === 'Norquay Heights NW', dp0.road);
  /* v124: the arrival answer — a clock time, computed from the
     same proportional ETA driveProgress already carried. */
  check('v124 fmtClock: morning, midnight, noon, late night',
    sb.fmtClock(new Date(2026, 9, 17, 8, 2)) === '8:02 AM' &&
    sb.fmtClock(new Date(2026, 9, 17, 0, 5)) === '12:05 AM' &&
    sb.fmtClock(new Date(2026, 9, 17, 12, 0)) === '12:00 PM' &&
    sb.fmtClock(new Date(2026, 9, 17, 23, 59)) === '11:59 PM');
  const T0 = new Date(2026, 9, 17, 7, 38, 0).getTime();
  const ei0 = sb.driveEtaInfo(plan, 0, T0);
  check('v124 driveEtaInfo at 0 m: arrival = now + the full ETA, full trip left',
    Math.abs(ei0.arriveAt.getTime() - T0 - plan.totalMin * 60000) <= 1 &&
    Math.abs(ei0.leftM - plan.totalKm * 1000) < 2 && Math.abs(ei0.etaMin - plan.totalMin) < 0.01,
    ei0.arriveAt + ' / ' + ei0.etaMin);
  const eiHalf = sb.driveEtaInfo(plan, plan.totalKm * 500, T0);
  check('v124 driveEtaInfo half-way: ETA halves with the distance left',
    Math.abs(eiHalf.etaMin - plan.totalMin / 2) < 0.05 && Math.abs(eiHalf.leftM - plan.totalKm * 500) < 2);
  check('v124 bearingDeg: N / E / S / W from a Calgary fix',
    sb.bearingDeg([51.05, -114.06], [51.06, -114.06]) === 0 &&
    sb.bearingDeg([51.05, -114.06], [51.04, -114.06]) === 180 &&
    sb.bearingDeg([51.05, -114.06], [51.05, -114.05]) > 85 && sb.bearingDeg([51.05, -114.06], [51.05, -114.05]) < 95 &&
    sb.bearingDeg([51.05, -114.06], [51.05, -114.07]) > 265 && sb.bearingDeg([51.05, -114.06], [51.05, -114.07]) < 275);
  check('v128 angDeltaDeg: jitter is 1°, wrap-around is small, opposites are 180',
    sb.angDeltaDeg(90, 91) === 1 && sb.angDeltaDeg(359, 1) === 2 &&
    sb.angDeltaDeg(0, 180) === 180 && sb.angDeltaDeg(45, 45) === 0);
  const saidBag = {};
  check('drivePrompt: 700 m out says nothing', sb.drivePrompt(plan, 0, 700, saidBag) === null);
  check('drivePrompt: 550 m out speaks the far (pre-transition) line once',
    sb.drivePrompt(plan, 0, 550, saidBag) === (plan.maneuvers[1].verbalPre || plan.maneuvers[1].instruction) && saidBag['far:1'] === 1);
  check('drivePrompt: far line is not repeated', sb.drivePrompt(plan, 0, 500, saidBag) === null);
  check('drivePrompt: 150 m out speaks the near (instruction) line',
    sb.drivePrompt(plan, 0, 150, saidBag) === plan.maneuvers[1].instruction && saidBag['near:1'] === 1);
  check('drivePrompt: near line is not repeated', sb.drivePrompt(plan, 0, 100, saidBag) === null);
  const saidFin = {};
  check('drivePrompt: the final maneuver gets NO far prompt', sb.drivePrompt(plan, plan.maneuvers.length - 2, 500, saidFin) === null);
  check('drivePrompt: the final maneuver speaks its arrival line close in',
    sb.drivePrompt(plan, plan.maneuvers.length - 2, 150, saidFin) ===
    (plan.maneuvers[9].verbalPre || plan.maneuvers[9].instruction));

  console.log('— pure: coordinate text parsing (v101 field fix) —');
  check('parseLatLngText: a bare pair parses', deepEq(sb.parseLatLngText('50.951946, -114.027355'), [50.951946, -114.027355]));
  check('parseLatLngText: a pair inside a name parses (the Butterfly shape)',
    deepEq(sb.parseLatLngText('Butterfly, 50.9519460, -114.0273550'), [50.951946, -114.027355]));
  check('parseLatLngText: street text never matches', sb.parseLatLngText('12th Street') === null &&
    sb.parseLatLngText('Highway 2, 5 km') === null && sb.parseLatLngText('') === null && sb.parseLatLngText(null) === null);
  check('parseLatLngText: out-of-range pairs are rejected', sb.parseLatLngText('95.123456, -114.027355') === null &&
    sb.parseLatLngText('50.951946, -190.027355') === null);

  console.log('— pure: NO external handoff (v103) —');
  /* Owner ruling Oct 16, 2026: navigation never leaves the app.
     The v93 link builder is deleted from the pure region — pin
     its ABSENCE so it can never quietly come back. */
  check('v103: the pure region exports no external link builder', typeof sb.ttnLinks === 'undefined');
}

/* ================= 2. render + flow (stubbed DOM) ================= */
function el() {
  const e = {
    children: {}, style: {}, _html: '', _htmlSets: 0, textContent: '', value: '', onclick: null,
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
    get: function () { return e._html; }, set: function (v) { e._htmlSets++; e._html = String(v); }
  });
  return e;
}
/* v103: the Navigator's places-results stub — parses the shared
   picker's data-pid rows out of each paint (the nav-dropdown
   makeResults pattern) so a row can be tapped like a thumb. */
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
function makeWorld(storeData, withNavModule, fetchMode) {
  const store = {
    get: function (k, d) { return storeData[k] !== undefined ? storeData[k] : d; },
    set: function (k, v) { storeData[k] = v; },
    del: function (k) { delete storeData[k]; }
  };
  const ids = ['nv_banner', 'nv_map', 'nv_mode_truck', 'nv_mode_car', 'nv_follow', 'nv_mute',
    'nv_q', 'nv_search', 'nv_results', 'nv_destnote', 'nv_route', 'nv_end', 'nv_note', 'nv_steps',
    /* v103: the shared places picker door (filter + results) */
    'nv_pq', 'nv_presults',
    /* v101: full-screen shell + drive screen */
    'nv_back', 'nv_drive', 'nv_drive_screen', 'nv_drive_map',
    /* v101: full-screen shell + drive screen.
       v139 PIN MOVE: 'nvd_spin' → 'nvd_plane' — the nested
       tilt/spin/mapbox stack is gone; the one transformed
       element is the bounded plane (see BUGS.md v139). */
    'nvd_dist', 'nvd_inst', 'nvd_road', 'nvd_eta_main', 'nvd_eta_sub', 'nvd_reroute', 'nvd_plane', 'nvd_mute', 'nvd_exit'];
  const reg = {};
  ids.forEach(function (id) { reg[id] = el(); });
  reg.nv_presults = resultsEl();
  reg.nv_banner.children['.nv-banner-main'] = el();
  reg.nv_banner.children['.nv-banner-sub'] = el();
  const body = el();
  body.querySelector = function (sel) { return reg[sel.slice(1)] || null; };
  body.querySelectorAll = function () { return []; };

  const calls = { fetch: [], polylines: [], spoken: [], views: [], opened: [], anchors: [], markers: [], maps: [], groups: [] };
  const mapHandlers = {};
  /* v128: every L.map() returns its OWN instrumented stub — the
     suite counts layer adds/removes, setView calls and panTos
     PER MAP, because the drive overlay blink lived in the drive
     map's per-tick recentering and nowhere else. Layers record
     their own mutations (setLatLng / setLatLngs counts). */
  function makeMapStub() {
    const m = {
      _adds: 0, _removes: 0, _views: [], _panTos: [], _center: null, _zoom: 15,
      setView: function (c, z) { m._views.push([c, z]); calls.views.push([c, z]); m._center = c; if (z) m._zoom = z; return m; },
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
    tileLayer: function () { return { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return this; } }; },
    marker: function (ll) { calls.markers.push(ll); return { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return this; }, setLatLng: function () {} }; },
    circleMarker: function () {
      const cm = { _latlngSets: 0, addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return cm; },
        setLatLng: function () { cm._latlngSets++; } };
      return cm;
    },
    polyline: function (pts) {
      calls.polylines.push(pts);
      const pl = { _latlngSets: 0, addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return pl; },
        setLatLngs: function () { pl._latlngSets++; }, getBounds: function () { return {}; } };
      return pl;
    },
    layerGroup: function (kids) {
      const g = { _kids: kids, getLayers: function () { return g._kids.slice(); },
        addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return g; } };
      calls.groups.push(g);
      return g;
    }
  };
  let geoCb = null;
  const world = {
    console: console, JSON: JSON, Math: Math, Date: Date, setTimeout: setTimeout,
    window: null,
    /* v103: document/window.open are stubbed to CAPTURE any
       attempt — the suite asserts nothing ever tries to open
       anything external any more. */
    document: {
      hidden: false,
      addEventListener: function () {}, removeEventListener: function () {},
      createElement: function () {
        const a = { href: '', style: {}, click: function () { calls.anchors.push(a.href); }, remove: function () {} };
        return a;
      },
      body: { appendChild: function () {} }
    },
    open: function (u) { calls.opened.push(u); },
    App: {
      _esc: function (s) { return String(s == null ? '' : s); }, _store: store,
      _today: function () { return '2026-10-16'; }, openModule: function () {}
    },
    Meticulous: {},
    L: L,
    navigator: { geolocation: { watchPosition: function (cb) { geoCb = cb; return 7; }, clearWatch: function () {} } },
    speechSynthesis: { cancel: function () {}, speak: function (u) { calls.spoken.push(u.text); } },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    fetch: function (url, opts) {
      calls.fetch.push({ url: url, opts: opts });
      /* v104: route fetches can be made to fail three ways —
         'throw' (the fetch itself rejects: no answer at all),
         'http503' (an answer with an error status), 'empty'
         (an OK answer with no buildable trip in it). */
      if (url.indexOf('/route') >= 0) {
        if (fetchMode === 'throw') return Promise.reject(new Error('network down'));
        if (fetchMode === 'http503') return Promise.resolve({ ok: false, status: 503, json: function () { return Promise.resolve({}); } });
        if (fetchMode === 'empty') return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ trip: { legs: [] } }); } });
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(fixture); } });
      }
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); } });
    }
  };
  world.window = world;
  vm.createContext(world);
  /* v103: the picker world loads the Navigation module first
     (index.html's own order) so the Navigator's places door is
     wired to the real shared component. */
  if (withNavModule) vm.runInContext(navModSrc, world);
  vm.runInContext(navSrc, world);
  return { world: world, reg: reg, body: body, calls: calls, mapHandlers: mapHandlers, firePos: function (la, lo, hd, sp) { geoCb({ coords: { latitude: la, longitude: lo, heading: hd, speed: sp } }); } };
}
function tick() { return new Promise(function (r) { setTimeout(r, 10); }); }

(async function () {
  console.log('— flow: server set —');
  const w = makeWorld({ navigator: { serverUrl: 'http://nav.test', profile: {}, muted: false, mode: 'truck' } });
  const api = w.world.Meticulous.modules.navigator;
  check('module registers as Meticulous.modules.navigator', !!api);
  check('status reports truck profile when server set', /Truck/.test(api.status()), api.status());
  api.render(w.body);
  check('no unset-server warning when a server is set', w.body.innerHTML.indexOf('routing unavailable') < 0);
  w.firePos(ORIGIN[0], ORIGIN[1]);
  w.mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } });
  check('map tap sets the destination note', /Destination:/.test(w.reg.nv_destnote.textContent), w.reg.nv_destnote.textContent);
  check('v101 tap-pin: the destination line shows the dropped point itself (coordinates)',
    w.reg.nv_destnote.textContent.indexOf('Dropped pin (51.10750, -114.08450)') >= 0, w.reg.nv_destnote.textContent);
  check('v101 tap-pin: the destination marker lands exactly on the tap',
    w.calls.markers.length === 1 && w.calls.markers[0][0] === DEST[0] && w.calls.markers[0][1] === DEST[1]);
  check('v103: no external handoff exists in the sheet (no Turn-by-turn button, no other-app copy)',
    w.body.innerHTML.indexOf('nv_ttn') < 0 && w.body.innerHTML.indexOf('Turn-by-turn') < 0);
  check('v103: MeticulousNav exposes no handoff link builder', w.world.MeticulousNav.ttnLinks === undefined);
  check('v103: the destination note gives no tap instruction — picking the place IS the instruction',
    !/tap/.test(w.reg.nv_destnote.textContent), w.reg.nv_destnote.textContent);
  check('v103: the manual Route affordance remains for re-planning', w.body.innerHTML.indexOf('id="nv_route"') >= 0);
  await tick(); await tick();
  const routeCalls = w.calls.fetch.filter(function (c) { return c.url.indexOf('/route') >= 0; });
  check('v137: AUTO-ROUTE — the tap alone requested the route (no Route press), at the BAKED server (the stored nav.test address no longer steers routing)',
    routeCalls.length === 1 && routeCalls[0].url === 'https://2.31.47.19/route',
    routeCalls.length ? routeCalls[0].url : 'no fetch');
  if (routeCalls.length) {
    const sent = JSON.parse(routeCalls[0].opts.body);
    check('POSTed body is the truck costing shape', sent.costing === 'truck' &&
      sent.costing_options.truck.use_truck_route === 1.0 && sent.costing_options.truck.hgv_no_access_penalty === 100000);
    check('POSTed OD = the GPS origin and tapped destination',
      sent.locations[0].lat === ORIGIN[0] && sent.locations[1].lon === DEST[1]);
  }
  check('polyline drawn from the real response shape', w.calls.polylines.length === 1 && w.calls.polylines[0].length > 100,
    w.calls.polylines.length ? String(w.calls.polylines[0].length) : 'none');
  check('steps list shows the real maneuvers', w.reg.nv_steps.innerHTML.indexOf('Norquay Drive NW') >= 0 &&
    w.reg.nv_steps.innerHTML.indexOf('4.9 km') >= 0);
  check('banner shows the first instruction', w.reg.nv_banner.children['.nv-banner-main'].textContent.indexOf('Norquay Heights NW') >= 0,
    w.reg.nv_banner.children['.nv-banner-main'].textContent);
  check('first verbal line spoken', w.calls.spoken.length >= 1 && w.calls.spoken[0].indexOf('Norquay Heights') >= 0,
    w.calls.spoken[0] || 'nothing spoken');

  console.log('— flow: off-route re-route (hysteresis) —');
  const realNow = Date.now;
  let fakeNow = realNow();
  w.world.Date = (function () { var RD = Date; function FD() { return new RD(fakeNow); } FD.now = function () { return fakeNow; }; return FD; })();
  w.firePos(51.1155, -114.0915); // ~700 m off the line
  await tick();
  check('first off-route fix does NOT re-route yet (hysteresis)', w.calls.fetch.filter(function (c) { return c.url.indexOf('/route') >= 0; }).length === 1);
  fakeNow += 5000;
  w.firePos(51.1155, -114.0915);
  await tick(); await tick();
  check('held off-route past 4 s re-routes from the new position', w.calls.fetch.filter(function (c) { return c.url.indexOf('/route') >= 0; }).length === 2);
  w.world.Date = Date;
  api.teardown();

  console.log('— flow: a stored address no longer steers routing (v137) —');
  /* v137 SUPERSEDES the v98 rule pinned here before (a deliberately
     cleared '' used to keep routing off): the owner's Oct 17 order
     took the server text box out of Preferences entirely and baked
     the address in. A stored '' or custom value from an older build
     is now IGNORED — routing cannot be cleared or repointed from
     any user surface. */
  const w2 = makeWorld({ navigator: { serverUrl: '', profile: {}, muted: false, mode: 'truck' } });
  const api2 = w2.world.Meticulous.modules.navigator;
  check('v137: a stored cleared address is ignored — loadSettings returns the baked constant', w2.world.MeticulousNav.loadSettings().serverUrl === 'https://2.31.47.19');
  check('v137: saveSettings refuses to persist a serverUrl patch',
    w2.world.MeticulousNav.saveSettings({ serverUrl: 'http://evil.test' }).serverUrl === 'https://2.31.47.19');
  check('v137: status reports the truck profile (never "not set")', /Truck/.test(api2.status()) && !/not set/.test(api2.status()), api2.status());
  api2.render(w2.body);
  check('v137: no routing-unavailable warning can appear', w2.body.innerHTML.indexOf('routing unavailable') < 0);
  w2.firePos(ORIGIN[0], ORIGIN[1]);
  w2.mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } });
  await tick(); await tick();
  check('v137: routing still functions on the baked address after a legacy clear',
    w2.calls.fetch.filter(function (c) { return c.url === 'https://2.31.47.19/route'; }).length === 1,
    JSON.stringify(w2.calls.fetch.map(function (c) { return c.url; })));
  api2.teardown();

  console.log('— flow: default server, never set (v98) —');
  const w4 = makeWorld({});
  const api4 = w4.world.Meticulous.modules.navigator;
  check('v98: MeticulousNav exposes the shipped default', w4.world.MeticulousNav.DEFAULT_SERVER_URL === 'https://2.31.47.19',
    w4.world.MeticulousNav.DEFAULT_SERVER_URL);
  check('v98: never-saved → loadSettings returns the default', w4.world.MeticulousNav.loadSettings().serverUrl === 'https://2.31.47.19',
    w4.world.MeticulousNav.loadSettings().serverUrl);
  check('v137: a stored custom address is IGNORED — the baked constant wins (v98 saved-wins rule superseded)',
    makeWorld({ navigator: { serverUrl: 'http://nav.test' } }).world.MeticulousNav.loadSettings().serverUrl === 'https://2.31.47.19');
  check('v98: status reports the truck profile under the default (not "not set")',
    /Truck/.test(api4.status()) && !/not set/.test(api4.status()), api4.status());
  api4.render(w4.body);
  check('v98: no unset-server warning under the default', w4.body.innerHTML.indexOf('routing unavailable') < 0);
  w4.firePos(ORIGIN[0], ORIGIN[1]);
  w4.mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } });
  check('v103: default set: the destination note carries no handoff instruction',
    w4.reg.nv_destnote.textContent.indexOf('Turn-by-turn') < 0 && /Destination:/.test(w4.reg.nv_destnote.textContent),
    w4.reg.nv_destnote.textContent);
  await tick(); await tick();
  const dCalls = w4.calls.fetch.filter(function (c) { return c.url.indexOf('/route') >= 0; });
  check('v103: AUTO-ROUTE under the default — the tap alone POSTs to the shipped default <server>/route',
    dCalls.length === 1 && dCalls[0].url === 'https://2.31.47.19/route',
    dCalls.length ? dCalls[0].url : 'no fetch');
  if (dCalls.length) {
    const dSent = JSON.parse(dCalls[0].opts.body);
    check('v98: default route body is the truck costing shape', dSent.costing === 'truck' &&
      dSent.costing_options.truck.use_truck_route === 1.0 && dSent.costing_options.truck.hgv_no_access_penalty === 100000);
  }
  check('v103: nothing external was opened or anchored under the default',
    w4.calls.anchors.length === 0 && w4.calls.opened.length === 0);
  api4.teardown();

  console.log('— flow: navigation stays in-app (v103), server baked (v137) —');
  /* Since v103 navigation offers NO external fallback: the owner
     ruled it never leaves the app. v137: the world below carries a
     legacy CLEARED address in its store — ignored, because the
     address is baked in — so the in-app guarantees are pinned in a
     world that ROUTES (the old "no server" state no longer exists:
     nothing a user can do turns routing off from the face). */
  const w3 = makeWorld({ navigator: { serverUrl: '', profile: {}, muted: false, mode: 'truck' } });
  const api3 = w3.world.Meticulous.modules.navigator;
  api3.render(w3.body);
  check('v103: there is NO handoff button or other-app copy anywhere in the sheet',
    w3.body.innerHTML.indexOf('nv_ttn') < 0 && w3.body.innerHTML.indexOf('Turn-by-turn') < 0 &&
    w3.body.innerHTML.indexOf('Opens Google Maps') < 0);
  check('v103: MeticulousNav exposes no link builder', w3.world.MeticulousNav.ttnLinks === undefined);
  w3.reg.nv_route.onclick();
  check('no destination: the Route tap explains itself', /Pick a destination first/.test(w3.reg.nv_note.textContent),
    w3.reg.nv_note.textContent);
  check('no destination: nothing was opened', w3.calls.anchors.length === 0 && w3.calls.opened.length === 0);
  w3.firePos(ORIGIN[0], ORIGIN[1]);
  w3.mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } });
  check('v137: the destination note is the normal armed line — the needs-server state is unreachable',
    /Destination:/.test(w3.reg.nv_destnote.textContent) &&
    w3.reg.nv_destnote.textContent.indexOf('routing needs the Navigator server') < 0, w3.reg.nv_destnote.textContent);
  check('v137: the banner never says routing is off',
    w3.reg.nv_banner.children['.nv-banner-sub'].textContent.indexOf('Routing is off') < 0,
    w3.reg.nv_banner.children['.nv-banner-sub'].textContent);
  await tick(); await tick();
  check('v137: the route IS fetched — to the baked server, from a world whose store says routing was cleared',
    w3.calls.fetch.filter(function (c) { return c.url === 'https://2.31.47.19/route'; }).length === 1,
    JSON.stringify(w3.calls.fetch.map(function (c) { return c.url; })));
  check('v103: nothing external was opened or anchored, ever',
    w3.calls.anchors.length === 0 && w3.calls.opened.length === 0);
  api3.teardown();

  console.log('— flow: pending destination WITH coordinates (v101 Butterfly field fix) —');
  /* Oct 16 field defect: a hand-added favorite whose pin was saved
     as its address text arrived as query "Butterfly, 50.9519460,
     -114.0273550" and the Navigator GEOCODED it, offering a
     children's playground kilometres away. A pending destination
     that carries coordinates must be set from them — exactly, and
     with the geocoder never called. */
  const wB = makeWorld({ navigator: { serverUrl: 'http://nav.test', profile: {}, muted: false, mode: 'truck' },
    nav_pending: { name: 'Butterfly', query: 'Butterfly, 50.9519460, -114.0273550', ts: 1 } });
  const apiB = wB.world.Meticulous.modules.navigator;
  apiB.render(wB.body);
  check('Butterfly: destination set under the favorite name', wB.reg.nv_destnote.textContent.indexOf('Destination: Butterfly') >= 0,
    wB.reg.nv_destnote.textContent);
  check('Butterfly: the marker is EXACTLY the favorite pin (50.951946, -114.027355)',
    wB.calls.markers.length === 1 && Math.abs(wB.calls.markers[0][0] - 50.951946) < 1e-9 &&
    Math.abs(wB.calls.markers[0][1] - (-114.027355)) < 1e-9, JSON.stringify(wB.calls.markers));
  check('Butterfly: the search box was not filled with the pin text', wB.reg.nv_q.value === '', JSON.stringify(wB.reg.nv_q.value));
  check('Butterfly: the geocoder was NEVER called', wB.calls.fetch.filter(function (c) { return c.url.indexOf('nominatim') >= 0; }).length === 0,
    JSON.stringify(wB.calls.fetch.map(function (c) { return c.url; })));
  apiB.teardown();

  const wP = makeWorld({ navigator: { serverUrl: 'http://nav.test', profile: {}, muted: false, mode: 'truck' },
    nav_pending: { name: 'A2-L20', lat: 50.96649, lng: -114.03178, ts: 1 } });
  const apiP = wP.world.Meticulous.modules.navigator;
  apiP.render(wP.body);
  check('pend lat/lng: destination set from the fields, no fetch of any kind',
    wP.reg.nv_destnote.textContent.indexOf('Destination: A2-L20') >= 0 && wP.calls.fetch.length === 0 &&
    wP.calls.markers.length === 1 && wP.calls.markers[0][0] === 50.96649 && wP.calls.markers[0][1] === -114.03178,
    wP.reg.nv_destnote.textContent);
  apiP.teardown();

  console.log('— flow: drive screen (v101) —');
  const wD = makeWorld({ navigator: { serverUrl: 'http://nav.test', profile: {}, muted: false, mode: 'truck' } });
  const apiD = wD.world.Meticulous.modules.navigator;
  /* the stub DOM does not parse markup classes — seed the hidden
     state the real DOM gets from the rendered class attributes */
  wD.reg.nv_drive.classList.add('hidden');
  wD.reg.nv_drive_screen.classList.add('hidden');
  wD.reg.nvd_reroute.classList.add('hidden');
  apiD.render(wD.body);
  check('v101: the planning view renders as a full-screen shell with its own Back',
    wD.body.innerHTML.indexOf('class="nv-shell"') >= 0 && wD.body.innerHTML.indexOf('id="nv_back"') >= 0);
  check('v101: Drive ships hidden until a route is active',
    wD.body.innerHTML.indexOf('class="btn primary big hidden" id="nv_drive"') >= 0);
  wD.firePos(ORIGIN[0], ORIGIN[1], 40);
  wD.mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } });
  /* v103: no Route press — the tap auto-routes */
  await tick(); await tick();
  check('route active → Drive is revealed', !wD.reg.nv_drive.classList.contains('hidden'));
  check('route active → Drive takes the ONE primary slot (Route demoted to ghost)',
    wD.reg.nv_route.className === 'btn ghost big', String(wD.reg.nv_route.className));
  wD.reg.nv_drive.onclick();
  check('Drive tap opens the drive screen', !wD.reg.nv_drive_screen.classList.contains('hidden'));
  check('drive map centres on the truck at navigation zoom (17)',
    wD.calls.views.some(function (v) { return v[1] === 17; }), JSON.stringify(wD.calls.views));
  const sbD = { console };
  vm.createContext(sbD);
  vm.runInContext(extract(navSrc, 'NAVPURE-BEGIN', 'NAVPURE-END'), sbD);
  const dLine = sbD.decodeShape(fixture.trip.legs[0].shape);
  const midPt = dLine[Math.floor(dLine.length * 0.12)];
  wD.firePos(midPt[0], midPt[1], 90);
  check('drive screen paints the next instruction + distance',
    wD.reg.nvd_inst.textContent.length > 0 && wD.reg.nvd_dist.textContent.length > 0,
    wD.reg.nvd_inst.textContent + ' / ' + wD.reg.nvd_dist.textContent);
  check('v124: drive bar MAIN line is the arrival CLOCK time, big and bare',
    /^\d{1,2}:\d{2} [AP]M$/.test(wD.reg.nvd_eta_main.textContent), wD.reg.nvd_eta_main.textContent);
  check('v124: drive bar sub line carries Arrive + minutes + distance left',
    /^Arrive ·/.test(wD.reg.nvd_eta_sub.textContent) && /left/.test(wD.reg.nvd_eta_sub.textContent) && /min/.test(wD.reg.nvd_eta_sub.textContent), wD.reg.nvd_eta_sub.textContent);
  /* v139 PIN MOVE: was 'heading-up: the map spins by −heading'
     asserting the spin element's bare 'rotate(-90deg)'. The
     plane now carries ONE composed transform — pitch + heading
     on a single bounded element (see BUGS.md v139). */
  check('heading-up (v139): the plane\'s composed transform spins by −heading around the driver anchor',
    wD.reg.nvd_plane.style.transform === 'perspective(1100px) rotateX(45deg) rotate(-90deg)', String(wD.reg.nvd_plane.style.transform));
  /* v124: a GPS stream that reports NO heading (some devices
     never send one) — movement itself becomes the heading once a
     fix travels ≥10 m, so heading-up still engages. From midPt a
     ~200 m hop north-east reads as a bearing near 32°. */
  wD.firePos(midPt[0] + 0.0015, midPt[1] + 0.0015, null);
  const spinDeg = parseFloat((/rotate\((-?\d+(?:\.\d+)?)deg\)/.exec(String(wD.reg.nvd_plane.style.transform)) || [])[1]);
  check('v124: no GPS heading → the plane follows the movement bearing',
    isFinite(spinDeg) && spinDeg < -20 && spinDeg > -45, String(wD.reg.nvd_plane.style.transform));

  /* v128 — THE BLINK PINS, on the real driveTick, instrumented.
     Owner recording Oct 17 10:25: ~once a second the route line,
     the puck's dot and the bar's arrival text vanished for a
     frame, the banner caught clipped. The mechanism was the
     per-tick setView: every GPS fix restarted Leaflet's animated
     pan, re-projecting the SVG overlay inside the 340% tilted
     plane. A drive tick may now only MUTATE what exists: zero
     layer adds/removes on the drive map, zero setView calls,
     zero banner/bar innerHTML assignments — recentering by
     instant panTo, the line by setLatLngs, the spin gated by a
     2° deadband so heading jitter never repaints the plane. */
  await new Promise(function (r) { setTimeout(r, 200); }); /* the 120 ms settle pass lands — the puck joins inside the baseline */
  const dMap = wD.calls.maps[1];
  check('v128: the drive map is its own instrumented map (planning + drive)', !!dMap && wD.calls.maps.length === 2);
  const dLineGroup = wD.calls.groups[wD.calls.groups.length - 1];
  const htmlOf = function () {
    return [wD.reg.nvd_dist._htmlSets, wD.reg.nvd_inst._htmlSets, wD.reg.nvd_road._htmlSets,
      wD.reg.nvd_eta_main._htmlSets, wD.reg.nvd_eta_sub._htmlSets, wD.reg.nvd_reroute._htmlSets].join(',');
  };
  const base128 = { adds: dMap._adds, removes: dMap._removes, views: dMap._views.length, pans: dMap._panTos.length, html: htmlOf() };
  const ptAt = function (f) { return dLine[Math.floor(dLine.length * f)]; };
  const pA = ptAt(0.18); wD.firePos(pA[0], pA[1], 90);
  check('v128: a real heading change still turns the plane',
    wD.reg.nvd_plane.style.transform === 'perspective(1100px) rotateX(45deg) rotate(-90deg)', String(wD.reg.nvd_plane.style.transform));
  const pB = ptAt(0.22); wD.firePos(pB[0], pB[1], 91);
  check('v128: 1° of heading jitter does NOT touch the plane (the 2° deadband)',
    wD.reg.nvd_plane.style.transform === 'perspective(1100px) rotateX(45deg) rotate(-90deg)', String(wD.reg.nvd_plane.style.transform));
  const pC = ptAt(0.26); wD.firePos(pC[0], pC[1], 96);
  check('v128: a 6° turn clears the deadband and turns the plane',
    wD.reg.nvd_plane.style.transform === 'perspective(1100px) rotateX(45deg) rotate(-96deg)', String(wD.reg.nvd_plane.style.transform));
  [0.30, 0.34, 0.38].forEach(function (f) { const p = ptAt(f); wD.firePos(p[0], p[1], 96); });
  check('v128: six drive ticks added ZERO layers to the drive map', dMap._adds === base128.adds,
    dMap._adds + ' vs baseline ' + base128.adds);
  check('v128: six drive ticks removed ZERO layers from the drive map', dMap._removes === base128.removes,
    dMap._removes + ' vs baseline ' + base128.removes);
  check('v128: six drive ticks called setView ZERO times on the drive map (no per-tick recenter restart)',
    dMap._views.length === base128.views, dMap._views.length + ' vs baseline ' + base128.views);
  check('v128: the ticks DID recenter — by instant panTo (≥5 pans for six moving fixes)',
    dMap._panTos.length - base128.pans >= 5, String(dMap._panTos.length - base128.pans));
  check('v128: six drive ticks assigned banner/bar innerHTML ZERO times', htmlOf() === base128.html,
    htmlOf() + ' vs baseline ' + base128.html);
  check('v128: the route line still RETRACTS — by setLatLngs mutation on both layers, never a rebuild',
    !!dLineGroup && dLineGroup._kids.length === 2 && dLineGroup._kids.every(function (l) { return l._latlngSets >= 1; }));
  check('v128: the bar still updates every tick — by text mutation (the arrival clock is live)',
    /^\d{1,2}:\d{2} [AP]M$/.test(wD.reg.nvd_eta_main.textContent), wD.reg.nvd_eta_main.textContent);
  /* off-route while driving: hysteresis, then a re-route request
     and the rerouting pill on the drive screen */
  const realNowD = Date.now;
  let fakeNowD = realNowD();
  /* v124: the double must survive `new Date(...)` — driveTick
     builds the arrival Date every tick (driveEtaInfo), and a
     plain {now} object throws "Date is not a constructor". */
  wD.world.Date = (function () { var RD = Date; function FD() { return new RD(fakeNowD); } FD.now = function () { return fakeNowD; }; return FD; })();
  wD.firePos(51.1155, -114.0915, 90);
  await tick();
  check('driving: first off-route fix does NOT re-route yet',
    wD.calls.fetch.filter(function (c) { return c.url.indexOf('/route') >= 0; }).length === 1);
  fakeNowD += 5000;
  wD.firePos(51.1155, -114.0915, 90);
  await tick(); await tick();
  check('driving: held off-route re-routes from the new position',
    wD.calls.fetch.filter(function (c) { return c.url.indexOf('/route') >= 0; }).length === 2);
  check('driving: the drive screen shows its off-route/rerouting pill',
    !wD.reg.nvd_reroute.classList.contains('hidden'));
  wD.world.Date = Date;
  /* arrival at the end of the line ends drive mode cleanly */
  const endPt = dLine[dLine.length - 1];
  wD.firePos(endPt[0], endPt[1], 90);
  check('arrival paints on the drive screen', wD.reg.nvd_inst.textContent === 'You have arrived', wD.reg.nvd_inst.textContent);
  wD.reg.nvd_exit.onclick();
  check('End drive closes the drive screen back to the Navigator', wD.reg.nv_drive_screen.classList.contains('hidden'));
  apiD.teardown();

  console.log('— flow: places picker door (v103, shared component) —');
  /* The Navigator's door 1 renders through the Navigation
     module's shared picker: recents-only by default, the full
     list only as filter matches, one tap sets the destination
     on the pin — and auto-route fires from the pick.
     v119: the modules are MERGED — the drive face opens through
     a pending hand-off (the places face's Navigate, a dispatch,
     the chatbot), so this world seeds nav_pending for the Bradi
     favorite, exactly as the app's own hand-off would. The door
     itself is unchanged inside the drive face. */
  const wPk = makeWorld({
    navigator: { serverUrl: 'http://nav.test', profile: {}, muted: false, mode: 'truck' },
    nav_places_migrated: 91,
    nav_pending: { name: 'Aecon Bradi Pit', lat: 51.27206, lng: -114.43179, ts: Date.now() },
    nav_data: {
      work: [{ id: 'fav-bradi', name: 'Aecon Bradi Pit', address: '', type: 'pit',
               lat: 51.27206, lng: -114.43179, visits: 2, lastVisit: 1792000000000 }],
      personal: [], recent: []
    }
  }, true);
  const apiPk = wPk.world.Meticulous.modules.navigator;
  apiPk.render(wPk.body);
  check('picker door: default view shows the visited favorite (recents)',
    wPk.reg.nv_presults.innerHTML.indexOf('Aecon Bradi Pit') >= 0, wPk.reg.nv_presults.innerHTML);
  check('picker door: default view does NOT show never-visited places (no wall)',
    wPk.reg.nv_presults.innerHTML.indexOf('Stoney Trail Aggregate Resource') < 0 && wPk.reg.nv_presults.innerHTML.indexOf('BURNCO Indus Aggregate Pit') < 0,
    wPk.reg.nv_presults.innerHTML);
  wPk.reg.nv_pq.value = 'stoney';
  wPk.reg.nv_pq.fire('input');
  check('picker door: typing renders the full list AS MATCHES (the STAR pit appears, Bradi filtered out)',
    wPk.reg.nv_presults.innerHTML.indexOf('Stoney Trail Aggregate Resource') >= 0 &&
    wPk.reg.nv_presults.innerHTML.indexOf('Aecon Bradi Pit') < 0, wPk.reg.nv_presults.innerHTML);
  wPk.firePos(ORIGIN[0], ORIGIN[1]);
  await tick(); await tick(); // the hand-off's route lands (S.plan set)
  /* v119: the seeded hand-off routed to Bradi once position
     landed, so a plan exists — and a plan blocks auto-routing a
     fresh pick (the standing v103 rule in ANY session). The
     driver ends that route first; then the pick's own auto-route
     is what fires. */
  wPk.reg.nv_end.onclick();
  wPk.reg.nv_presults.pick('bi-stoney-trail-aggregate-resource');
  await tick(); await tick();
  check('picker door: one tap set the destination on the place pin',
    wPk.reg.nv_destnote.textContent.indexOf('Destination: Stoney Trail Aggregate Resource') >= 0, wPk.reg.nv_destnote.textContent);
  const pkRoutes = wPk.calls.fetch.filter(function (c) { return c.url.indexOf('/route') >= 0; });
  /* v119: the seeded hand-off may route to Bradi once position
     lands; the PICK's own auto-route is the one targeting the
     STAR pit. */
  const pkStoney = pkRoutes.filter(function (c) {
    try { const L = JSON.parse(c.opts.body).locations; return L && L[1] && L[1].lat === 51.165429 && L[1].lon === -114.213202; } catch (e) { return false; }
  });
  check('picker door: the pick AUTO-ROUTED (no Route tap)', pkStoney.length === 1, pkRoutes.length + ' route fetches, ' + pkStoney.length + ' to the STAR pit');
  if (pkStoney.length) {
    const pkSent = JSON.parse(pkStoney[0].opts.body);
    check('picker door: the route targets the ship-list STAR pin',
      pkSent.locations[1].lat === 51.165429 && pkSent.locations[1].lon === -114.213202, JSON.stringify(pkSent.locations));
  }
  apiPk.teardown();

  console.log('— pure: picker policy (v103, Navigation module) —');
  {
    const wNv = makeWorld({}, true);
    const navApi = wNv.world.Meticulous.modules.navigation;
    check('the Navigation module exports the shared picker', !!navApi.pickerEntries && !!navApi.pickerRowHTML && !!navApi.pickerFind);
    /* the cap + order, read through the pure policy entry */
    const many = { work: [], personal: [], recent: [] };
    for (let i = 0; i < 8; i++) {
      many.work.push({ id: 'v' + i, name: 'Visited ' + i, address: '', type: 'pit', visits: 1, lastVisit: 1000 + i });
    }
    many.work.push({ id: 'u1', name: 'Unvisited Pit', address: '', type: 'pit', visits: 0 });
    wNv.world.App._store.set('nav_data', many);
    wNv.world.App._store.set('nav_places_migrated', 91);
    const def = navApi.pickerEntries('work', '');
    check('pickerEntries default: at most 6 recents', def.recents === true && def.rows.length === 6, 'rows ' + def.rows.length);
    check('pickerEntries default: most recent first, unvisited excluded',
      def.rows[0].place.id === 'v7' && def.rows.every(function (e) { return e.place.id !== 'u1'; }),
      def.rows.map(function (e) { return e.place.id; }).join(','));
    const filt = navApi.pickerEntries('work', 'pit');
    check('pickerEntries typed: the FULL combined list renders as matches (9 favorites + the 9 shipped built-ins; the recents cap does not apply)',
      filt.recents === false && filt.rows.length === 18, 'rows ' + filt.rows.length);
  }

  console.log('— flow: auto-enter Drive on a go-now arm (v104) —');
  /* Owner verdict, Oct 16, 2026: the route computed and the plan
     view sat there — "That's not turn by turn." A destination
     handed over via nav_pending is a go-now arm: when its route
     lands, Drive opens by itself — no Drive tap, stationary or
     not. Exiting Drive spends the arm: a later re-route for the
     same destination must NOT pull the driver back in. */
  const wG = makeWorld({ navigator: { serverUrl: 'http://nav.test', profile: {}, muted: false, mode: 'truck' },
    nav_pending: { name: 'A2-L20', lat: 50.96649, lng: -114.03178, ts: 1 } });
  const apiG = wG.world.Meticulous.modules.navigator;
  wG.reg.nv_drive.classList.add('hidden');
  wG.reg.nv_drive_screen.classList.add('hidden');
  wG.reg.nvd_reroute.classList.add('hidden');
  apiG.render(wG.body);
  check('v104: hand-off armed: no route before the first fix', wG.calls.fetch.length === 0);
  wG.firePos(ORIGIN[0], ORIGIN[1]); // stationary — no speed on the fix
  await tick(); await tick();
  const gRoutes = function () { return wG.calls.fetch.filter(function (c) { return c.url.indexOf('/route') >= 0; }).length; };
  check('v104: hand-off arm auto-routed on the first fix', gRoutes() === 1, gRoutes() + ' route fetches');
  check('v104: GO-NOW — Drive opened BY ITSELF on route-ready (no Drive tap, truck stationary)',
    !wG.reg.nv_drive_screen.classList.contains('hidden'));
  wG.reg.nvd_exit.onclick();
  check('v104: End drive returns to the plan view', wG.reg.nv_drive_screen.classList.contains('hidden'));
  const realNowG = Date.now;
  let fakeNowG = realNowG();
  wG.world.Date = (function () { var RD = Date; function FD() { return new RD(fakeNowG); } FD.now = function () { return fakeNowG; }; return FD; })();
  wG.firePos(51.1155, -114.0915);
  await tick();
  check('v104: after exit, first off-route fix does not re-route yet', gRoutes() === 1);
  fakeNowG += 5000;
  wG.firePos(51.1155, -114.0915);
  await tick(); await tick();
  check('v104: after exit, a held off-route DOES re-route (the plan lives on)', gRoutes() === 2, gRoutes() + ' route fetches');
  check('v104: …but the re-route does NOT re-enter Drive — the arm was spent by the exit',
    wG.reg.nv_drive_screen.classList.contains('hidden'));
  wG.world.Date = Date;
  apiG.teardown();

  console.log('— flow: auto-enter gating — parked planning vs already moving (v104) —');
  /* Parked manual planning (a place picked inside the Navigator,
     no speed on the fix) keeps the plan view — with Drive
     revealed and pinned at the sheet's top. The same manual pick
     while already rolling (speed ≥ 2 m/s) enters Drive on its
     own; a crawl under the threshold does not. */
  const wS = makeWorld({ navigator: { serverUrl: 'http://nav.test', profile: {}, muted: false, mode: 'truck' } });
  const apiS = wS.world.Meticulous.modules.navigator;
  wS.reg.nv_drive.classList.add('hidden');
  wS.reg.nv_drive_screen.classList.add('hidden');
  apiS.render(wS.body);
  check('v104: Drive renders at the TOP of the sheet — before the Destination card, its note and the recents list',
    wS.body.innerHTML.indexOf('class="nv-sheet"') >= 0 &&
    wS.body.innerHTML.indexOf('id="nv_drive"') > wS.body.innerHTML.indexOf('class="nv-sheet"') &&
    wS.body.innerHTML.indexOf('id="nv_drive"') < wS.body.innerHTML.indexOf('id="nv_destnote"') &&
    wS.body.innerHTML.indexOf('id="nv_drive"') < wS.body.innerHTML.indexOf('id="nv_presults"'));
  wS.firePos(ORIGIN[0], ORIGIN[1]);
  wS.mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } });
  await tick(); await tick();
  check('v104: parked manual pick routed (auto-route stands)', wS.calls.fetch.filter(function (c) { return c.url.indexOf('/route') >= 0; }).length === 1);
  check('v104: parked manual pick REVEALS Drive (the primary is in hand)', !wS.reg.nv_drive.classList.contains('hidden'));
  check('v104: parked manual pick does NOT auto-enter — planning stays in the plan view',
    wS.reg.nv_drive_screen.classList.contains('hidden'));
  apiS.teardown();

  const wM = makeWorld({ navigator: { serverUrl: 'http://nav.test', profile: {}, muted: false, mode: 'truck' } });
  const apiM = wM.world.Meticulous.modules.navigator;
  wM.reg.nv_drive_screen.classList.add('hidden');
  apiM.render(wM.body);
  wM.firePos(ORIGIN[0], ORIGIN[1], null, 8); // rolling at 8 m/s
  wM.mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } });
  await tick(); await tick();
  check('v104: MOVING manual pick auto-enters Drive on route-ready (speed ≥ 2 m/s off the one watch)',
    !wM.reg.nv_drive_screen.classList.contains('hidden'));
  apiM.teardown();

  const wC = makeWorld({ navigator: { serverUrl: 'http://nav.test', profile: {}, muted: false, mode: 'truck' } });
  const apiC = wC.world.Meticulous.modules.navigator;
  wC.reg.nv_drive_screen.classList.add('hidden');
  apiC.render(wC.body);
  wC.firePos(ORIGIN[0], ORIGIN[1], null, 1); // a 1 m/s crawl — below the moving threshold
  wC.mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } });
  await tick(); await tick();
  check('v104: a sub-threshold crawl (1 m/s) does NOT auto-enter',
    wC.reg.nv_drive_screen.classList.contains('hidden'));
  apiC.teardown();

  console.log('— flow: real route errors (v104) —');
  /* The failure line names what ACTUALLY happened — the old
     banner guessed at the server URL for every failure class
     (and was wrong in the Oct 16 field hunt). Three classes,
     three lines, all in the note area; the banner keeps its
     plain "Could not get a route." */
  const errCases = [
    ['throw', "The route server didn't answer", 'no answer at all (fetch threw)'],
    ['http503', 'The route server answered with an error (HTTP 503)', 'an error status, named'],
    ['empty', 'No route could be built between here and there', 'an answer with no route in it']
  ];
  for (const ec of errCases) {
    const wE = makeWorld({ navigator: { serverUrl: 'http://nav.test', profile: {}, muted: false, mode: 'truck' } }, false, ec[0]);
    const apiE = wE.world.Meticulous.modules.navigator;
    apiE.render(wE.body);
    wE.firePos(ORIGIN[0], ORIGIN[1]);
    wE.mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } });
    await tick(); await tick();
    check('v104: error class "' + ec[2] + '" says exactly what happened',
      wE.reg.nv_note.textContent.indexOf(ec[1]) >= 0, wE.reg.nv_note.textContent);
    check('v104: error class "' + ec[2] + '": banner stays plain, no route is drawn, no guessing text',
      wE.reg.nv_banner.children['.nv-banner-main'].textContent === 'Could not get a route.' &&
      wE.calls.polylines.length === 0 &&
      wE.reg.nv_note.textContent.indexOf('Check the Navigator server URL') < 0 &&
      wE.reg.nv_banner.children['.nv-banner-sub'].textContent.indexOf('Check the Navigator server URL') < 0,
      wE.reg.nv_banner.children['.nv-banner-main'].textContent + ' / ' + wE.reg.nv_note.textContent);
    apiE.teardown();
  }

  /* ================= 3. statics ================= */
  console.log('— statics —');
  check('index.html loads modules/navigator.js at ?v=<webVersion>', idxSrc.indexOf('modules/navigator.js?v=' + ver.webVersion) >= 0);
  check('index.html loads the Leaflet library', idxSrc.indexOf('leaflet@1.9.4/dist/leaflet.js') >= 0 && idxSrc.indexOf('leaflet@1.9.4/dist/leaflet.css') >= 0);
  check('app.js registers the Navigator module meta', appSrc.indexOf("navigator:  { title: 'Navigator'") >= 0);
  check('app.js runs module teardown on exit (v77 hook)', appSrc.indexOf('function teardownModule()') >= 0 && appSrc.indexOf('prev.teardown()') >= 0);
  /* v177 deliberate pin move (F4, owner Oct 19): the truck
     dimensions MOVED from Preferences into the Navigator's own
     settings menu — the old "profile card in Preferences" pin is
     INVERTED: Preferences now carries only the DOOR to that menu
     (pf_nv_open + nav_open_settings), and no dimension inputs. */
  check('v177: Preferences carries the Navigator settings DOOR, not the dimension inputs (they moved into the Navigator)',
    prefSrc.indexOf('pf_nv_open') >= 0 && prefSrc.indexOf('nav_open_settings') >= 0 &&
    prefSrc.indexOf('pf_nv_height') < 0 && prefSrc.indexOf('pf_nv_hazmat') < 0);
  /* v137 deliberate pin move: the "preferences Advanced has the
     Navigator server URL" pin is INVERTED — the editable address
     is gone from every user-facing surface (owner, Oct 17). */
  check('v137: Preferences renders NO server URL field or card anywhere (owner: the text box is out)', prefSrc.indexOf('pf_nav_url') < 0 && prefSrc.indexOf('pf_nav_note') < 0 && prefSrc.indexOf('>Server address</label>') < 0 && prefSrc.indexOf('🧭 Navigator server') < 0);
  check('navigator.js carries no loopback/private server literals', !/127\.0\.0\.1|localhost|:8002|198\.19\.|192\.168\./.test(navSrc));
  check('v98→v137: the one baked-in address is the shipped server', navSrc.indexOf("var NAV_DEFAULT_SERVER_URL = 'https://2.31.47.19'") >= 0);
  check('v98: MeticulousNav exposes the default (Preferences/tests)', navSrc.indexOf('DEFAULT_SERVER_URL: NAV_DEFAULT_SERVER_URL') >= 0);
  check('v137: Preferences carries no server-address resolution at all (no fallback copy of the rule)', prefSrc.indexOf('serverUrl') < 0);
  check('navigator.js still carries the honest unset-server line (unreachable since v137 — the address cannot be unset)', navSrc.indexOf('Navigator server not set — routing unavailable') >= 0);
  check('navigator.js adds no native dialogs', !/[^a-z]alert\(|[^a-z]confirm\(/.test(navSrc));
  check('v103: NO external handoff survives in navigator.js (no button, no link builder, no cascade, no other-app URLs)',
    navSrc.indexOf('nv_ttn') < 0 && navSrc.indexOf('ttnLinks') < 0 && navSrc.indexOf('waze.com') < 0 &&
    navSrc.indexOf('google.com/maps/dir') < 0 && navSrc.indexOf('intent://') < 0 && navSrc.indexOf('geo:') < 0 &&
    navSrc.indexOf('Opens Google Maps') < 0);
  check('v103: auto-route ships (the latch + its one fire path)', navSrc.indexOf('function maybeAutoRoute') >= 0 &&
    navSrc.indexOf('S.autoWanted = true') >= 0 && navSrc.indexOf('maybeAutoRoute();') >= 0);
  check('v103: the Navigator places door is the shared search-first picker (the <select> is gone)',
    navSrc.indexOf('id="nv_pq"') >= 0 && navSrc.indexOf('id="nv_presults"') >= 0 &&
    navSrc.indexOf('pickerEntries(') >= 0 && navSrc.indexOf('id="nv_places"') < 0 && navSrc.indexOf('builtinPlaces()') < 0);
  check('v103: the settings row is quiet (the active mode paints navy, never the primary orange)',
    navSrc.indexOf("settings.mode === 'truck' ? 'navy' : 'ghost'") >= 0 && navSrc.indexOf("? 'primary' : 'ghost'") < 0);
  check('v101: the drive screen ships (button + overlay + prompt engine)',
    navSrc.indexOf('id="nv_drive"') >= 0 && navSrc.indexOf('id="nv_drive_screen"') >= 0 &&
    navSrc.indexOf('function drivePrompt') >= 0 && navSrc.indexOf('DRIVE_FAR_M') >= 0);
  check('v101: pending coordinates are parsed out of the arrival text, never geocoded',
    navSrc.indexOf('parseLatLngText(pend.query)') >= 0 && navSrc.indexOf('function parseLatLngText') >= 0);
  check('v101: door 3 — a single map tap drops the pin (pinTap on the map click)',
    navSrc.indexOf('function pinTap') >= 0 && navSrc.indexOf("S.map.on('click'") >= 0);
  check('v101: the planning view is a full-screen shell',
    navSrc.indexOf('class="nv-shell"') >= 0 && cssSrc.indexOf('.nv-shell{position:fixed;inset:0') >= 0);
  /* v139 PIN MOVE: was the v101 tilt pin (rotateX 52deg in the
     CSS tilt layer). The tilt now lives in the plane's ONE
     composed transform at 45° — the stable end of the 45–60
     band (see BUGS.md v139). */
  check('v139 (was v101): the tilt is 45°, composed into the bounded plane\'s single transform — no CSS tilt layer remains',
    navSrc.indexOf('perspective(1100px) rotateX(45deg) rotate(') >= 0 &&
    cssSrc.indexOf('.nv-drive-plane{') >= 0 && cssSrc.indexOf('.nv-drive-tilt{') < 0 &&
    cssSrc.indexOf('.nv-drive{position:fixed;inset:0') >= 0);
  check('v104: the old guessing error text is GONE from navigator.js (it blamed the settings for every failure)',
    navSrc.indexOf('Check the Navigator server URL in Preferences') < 0);
  check('v104: route failures name the real cause — silent server / HTTP status / no route between here and there',
    navSrc.indexOf("The route server didn't answer") >= 0 &&
    navSrc.indexOf('The route server answered with an error (HTTP ') >= 0 &&
    navSrc.indexOf('No route could be built between here and there') >= 0);
  check('v104: auto-enter ships — the go-now arm, the spent latch, speed off the one watch',
    navSrc.indexOf('function maybeAutoEnterDrive') >= 0 && navSrc.indexOf('goNowKey') >= 0 &&
    navSrc.indexOf('driveAutoSpent') >= 0 && navSrc.indexOf('p.coords.speed') >= 0);
  check('v104: in the markup, Drive is the sheet\'s first element — before the Destination card',
    navSrc.indexOf('class="nv-sheet"') >= 0 &&
    navSrc.indexOf('id="nv_drive"') > navSrc.indexOf('class="nv-sheet"') &&
    navSrc.indexOf('id="nv_drive"') < navSrc.indexOf('📍 Destination'));
  check('v104: the first position paint waits for the map-settle pass (opening-balloon fix)',
    navSrc.indexOf('mapSettled') >= 0 && navSrc.indexOf('function paintPos') >= 0 &&
    navSrc.indexOf('animate: false') >= 0);

  console.log('navigator-test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL harness error: ' + (e && e.stack || e)); process.exit(1); });
