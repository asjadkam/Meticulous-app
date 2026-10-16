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
 *   2. RENDER + FLOW in a stubbed DOM: with a server URL set, a GPS fix
 *      at the Test B origin and a map-tap destination, pressing Route
 *      POSTs the proven payload shape, draws the polyline, fills the
 *      banner + steps from the real response, speaks the first verbal
 *      line, and an off-route fix held past the hysteresis re-routes.
 *      With the server address DELIBERATELY CLEARED (an explicit '' is
 *      saved) the module states "Navigator server not set — routing
 *      unavailable" and never fetches a route. With NO address ever
 *      saved (v98) it routes against the shipped default server.
 *   3. STATICS: module registry + teardown hook in app.js, Preferences
 *      card + Advanced server row, index.html pins; and the ONE
 *      routing-server address baked in is the shipped v98 default
 *      (no loopback/private literals anywhere in the module).
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

  console.log('— pure: turn-by-turn handoff links (v93) —');
  check('ttnLinks: no destination → null', sb.ttnLinks(null) === null && sb.ttnLinks(['x', 'y']) === null);
  const lk = sb.ttnLinks(DEST, 'Test B');
  check('ttnLinks: web directions is the canonical fallback',
    lk.web === 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent('51.107500,-114.084500') + '&travelmode=driving', lk.web);
  check('ttnLinks: intent leads, addressed to Google Maps, carrying the web fallback',
    lk.intent.indexOf('intent://navigate?q=' + encodeURIComponent('51.107500,-114.084500')) === 0 &&
    lk.intent.indexOf('package=com.google.android.apps.maps') >= 0 &&
    lk.intent.indexOf('S.browser_fallback_url=' + encodeURIComponent(lk.web)) >= 0, lk.intent);
  check('ttnLinks: geo URI carries pin + label',
    lk.geo === 'geo:51.107500,-114.084500?q=' + encodeURIComponent('51.107500,-114.084500 (Test B)'), lk.geo);
  check('ttnLinks: Waze deep link', lk.waze === 'https://waze.com/ul?ll=51.107500,-114.084500&navigate=yes', lk.waze);
}

/* ================= 2. render + flow (stubbed DOM) ================= */
function el() {
  const e = {
    children: {}, style: {}, _html: '', textContent: '', value: '', onclick: null,
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
function makeWorld(storeData) {
  const store = {
    get: function (k, d) { return storeData[k] !== undefined ? storeData[k] : d; },
    set: function (k, v) { storeData[k] = v; },
    del: function (k) { delete storeData[k]; }
  };
  const ids = ['nv_banner', 'nv_map', 'nv_mode_truck', 'nv_mode_car', 'nv_follow', 'nv_mute',
    'nv_q', 'nv_search', 'nv_results', 'nv_destnote', 'nv_route', 'nv_end', 'nv_note', 'nv_steps',
    'nv_ttn', 'nv_ttn_note',
    /* v101: full-screen shell + drive screen */
    'nv_back', 'nv_drive', 'nv_drive_screen', 'nv_drive_map',
    'nvd_dist', 'nvd_inst', 'nvd_road', 'nvd_eta', 'nvd_reroute', 'nvd_spin', 'nvd_mute', 'nvd_exit'];
  const reg = {};
  ids.forEach(function (id) { reg[id] = el(); });
  reg.nv_banner.children['.nv-banner-main'] = el();
  reg.nv_banner.children['.nv-banner-sub'] = el();
  const body = el();
  body.querySelector = function (sel) { return reg[sel.slice(1)] || null; };
  body.querySelectorAll = function () { return []; };

  const calls = { fetch: [], polylines: [], spoken: [], views: [], opened: [], anchors: [], markers: [] };
  const mapHandlers = {};
  const mapStub = {
    setView: function (c, z) { calls.views.push([c, z]); return mapStub; },
    on: function (ev, fn) { mapHandlers[ev] = fn; },
    remove: function () {}, fitBounds: function () {}, getZoom: function () { return 15; },
    invalidateSize: function () {}, removeLayer: function () {}
  };
  const L = {
    map: function () { return mapStub; },
    tileLayer: function () { return { addTo: function () {} }; },
    marker: function (ll) { calls.markers.push(ll); return { addTo: function () { return this; }, setLatLng: function () {} }; },
    circleMarker: function () { return { addTo: function () { return this; }, setLatLng: function () {} }; },
    polyline: function (pts) { calls.polylines.push(pts); return { addTo: function () { return this; }, getBounds: function () { return {}; } }; }
  };
  let geoCb = null;
  const world = {
    console: console, JSON: JSON, Math: Math, Date: Date, setTimeout: setTimeout,
    window: null,
    /* v93: the TTN cascade touches document/window.open — stubbed
       to CAPTURE every attempt so the chain can be asserted. */
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
    App: { _esc: function (s) { return String(s == null ? '' : s); }, _store: store },
    Meticulous: {},
    L: L,
    navigator: { geolocation: { watchPosition: function (cb) { geoCb = cb; return 7; }, clearWatch: function () {} } },
    speechSynthesis: { cancel: function () {}, speak: function (u) { calls.spoken.push(u.text); } },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    fetch: function (url, opts) {
      calls.fetch.push({ url: url, opts: opts });
      const payload = url.indexOf('/route') >= 0 ? fixture : [];
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve(payload); } });
    }
  };
  world.window = world;
  vm.createContext(world);
  vm.runInContext(navSrc, world);
  return { world: world, reg: reg, body: body, calls: calls, mapHandlers: mapHandlers, firePos: function (la, lo, hd) { geoCb({ coords: { latitude: la, longitude: lo, heading: hd } }); } };
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
  check('server set: Route leads, the handoff sits under it ghost-styled (v93)',
    w.body.innerHTML.indexOf('id="nv_route"') < w.body.innerHTML.indexOf('id="nv_ttn"') &&
    w.body.innerHTML.indexOf('class="btn ghost hidden" id="nv_ttn"') >= 0);
  check('server set: destination note still points at Route', /tap Route\./.test(w.reg.nv_destnote.textContent), w.reg.nv_destnote.textContent);
  w.reg.nv_route.onclick();
  await tick(); await tick();
  const routeCalls = w.calls.fetch.filter(function (c) { return c.url.indexOf('/route') >= 0; });
  check('Route POSTs to <server>/route', routeCalls.length === 1 && routeCalls[0].url === 'http://nav.test/route',
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
  w.world.Date = { now: function () { return fakeNow; } };
  w.firePos(51.1155, -114.0915); // ~700 m off the line
  await tick();
  check('first off-route fix does NOT re-route yet (hysteresis)', w.calls.fetch.filter(function (c) { return c.url.indexOf('/route') >= 0; }).length === 1);
  fakeNow += 5000;
  w.firePos(51.1155, -114.0915);
  await tick(); await tick();
  check('held off-route past 4 s re-routes from the new position', w.calls.fetch.filter(function (c) { return c.url.indexOf('/route') >= 0; }).length === 2);
  w.world.Date = Date;
  api.teardown();

  console.log('— flow: server deliberately cleared —');
  /* v98: '' is a SAVED value (the user cleared the field in
     Preferences) — the default must NOT resurrect over it. */
  const w2 = makeWorld({ navigator: { serverUrl: '', profile: {}, muted: false, mode: 'truck' } });
  const api2 = w2.world.Meticulous.modules.navigator;
  check('a cleared server stays cleared (no default resurrection)', w2.world.MeticulousNav.loadSettings().serverUrl === '');
  check('status says the server is not set', /not set/.test(api2.status()), api2.status());
  api2.render(w2.body);
  check('module states routing unavailable, in plain words', w2.body.innerHTML.indexOf('Navigator server not set — routing unavailable') >= 0);
  w2.firePos(ORIGIN[0], ORIGIN[1]);
  w2.reg.nv_route.onclick();
  await tick();
  check('no route fetch is attempted without a server', w2.calls.fetch.length === 0);
  api2.teardown();

  console.log('— flow: default server, never set (v98) —');
  const w4 = makeWorld({});
  const api4 = w4.world.Meticulous.modules.navigator;
  check('v98: MeticulousNav exposes the shipped default', w4.world.MeticulousNav.DEFAULT_SERVER_URL === 'https://2.31.47.19',
    w4.world.MeticulousNav.DEFAULT_SERVER_URL);
  check('v98: never-saved → loadSettings returns the default', w4.world.MeticulousNav.loadSettings().serverUrl === 'https://2.31.47.19',
    w4.world.MeticulousNav.loadSettings().serverUrl);
  check('v98: a saved custom server still wins over the default',
    makeWorld({ navigator: { serverUrl: 'http://nav.test' } }).world.MeticulousNav.loadSettings().serverUrl === 'http://nav.test');
  check('v98: status reports the truck profile under the default (not "not set")',
    /Truck/.test(api4.status()) && !/not set/.test(api4.status()), api4.status());
  api4.render(w4.body);
  check('v98: no unset-server warning under the default', w4.body.innerHTML.indexOf('routing unavailable') < 0);
  w4.reg.nv_ttn.classList.add('hidden');
  w4.reg.nv_ttn_note.classList.add('hidden');
  w4.firePos(ORIGIN[0], ORIGIN[1]);
  w4.mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } });
  check('v98: default set: destination note points at Route', /tap Route\./.test(w4.reg.nv_destnote.textContent), w4.reg.nv_destnote.textContent);
  check('v98: default set: Route leads, the handoff sits under it ghost-styled (v93)',
    w4.body.innerHTML.indexOf('id="nv_route"') < w4.body.innerHTML.indexOf('id="nv_ttn"') &&
    w4.body.innerHTML.indexOf('class="btn ghost hidden" id="nv_ttn"') >= 0);
  w4.reg.nv_route.onclick();
  await tick(); await tick();
  const dCalls = w4.calls.fetch.filter(function (c) { return c.url.indexOf('/route') >= 0; });
  check('v98: Route POSTs to the shipped default <server>/route', dCalls.length === 1 && dCalls[0].url === 'https://2.31.47.19/route',
    dCalls.length ? dCalls[0].url : 'no fetch');
  if (dCalls.length) {
    const dSent = JSON.parse(dCalls[0].opts.body);
    check('v98: default route body is the truck costing shape', dSent.costing === 'truck' &&
      dSent.costing_options.truck.use_truck_route === 1.0 && dSent.costing_options.truck.hgv_no_access_penalty === 100000);
  }
  /* v93 handoff behavior unchanged under the default: same cascade,
     same first link, built from the set destination. */
  const timers4 = [];
  w4.world.setTimeout = function (fn, ms) { timers4.push({ fn: fn, ms: ms }); return timers4.length; };
  w4.reg.nv_ttn.onclick();
  const want4 = w4.world.MeticulousNav.ttnLinks(DEST, 'Dropped pin');
  check('v98: handoff cascade still fires the Google Maps intent first', w4.calls.anchors[0] === want4.intent, w4.calls.anchors[0]);
  api4.teardown();

  console.log('— flow: turn-by-turn handoff (v93) —');
  /* the handoff-primary layout is the NO-server presentation — since
     v98 that state is reached via a deliberately cleared address. */
  const w3 = makeWorld({ navigator: { serverUrl: '', profile: {}, muted: false, mode: 'truck' } });
  const api3 = w3.world.Meticulous.modules.navigator;
  /* the stub DOM does not parse markup classes — seed the hidden
     state the real DOM gets from the rendered class attribute */
  w3.reg.nv_ttn.classList.add('hidden');
  w3.reg.nv_ttn_note.classList.add('hidden');
  api3.render(w3.body);
  check('no server: the handoff is the primary action, above Route',
    w3.body.innerHTML.indexOf('id="nv_ttn"') < w3.body.innerHTML.indexOf('id="nv_route"') &&
    w3.body.innerHTML.indexOf('class="btn primary big hidden" id="nv_ttn"') >= 0);
  check('no server: the honest handoff label ships in the markup',
    w3.body.innerHTML.indexOf('Opens Google Maps for spoken directions.') >= 0);
  check('handoff stays hidden until a destination exists', w3.reg.nv_ttn.classList.contains('hidden'));
  w3.reg.nv_ttn.onclick();
  check('no destination: the tap explains itself', /Pick a destination first/.test(w3.reg.nv_note.textContent), w3.reg.nv_note.textContent);
  check('no destination: nothing was opened', w3.calls.anchors.length === 0 && w3.calls.opened.length === 0);
  w3.firePos(ORIGIN[0], ORIGIN[1]);
  w3.mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } });
  check('destination set → handoff button + label revealed',
    !w3.reg.nv_ttn.classList.contains('hidden') && !w3.reg.nv_ttn_note.classList.contains('hidden'));
  check('no server: destination note points at Turn-by-turn', /tap Turn-by-turn/.test(w3.reg.nv_destnote.textContent), w3.reg.nv_destnote.textContent);
  /* capture the module's cascade timers instead of waiting them out */
  const timers = [];
  w3.world.setTimeout = function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; };
  w3.reg.nv_ttn.onclick();
  const want = w3.world.MeticulousNav.ttnLinks(DEST, 'Dropped pin');
  check('cascade 1: the Google Maps intent fires first, built from the set destination',
    w3.calls.anchors[0] === want.intent, w3.calls.anchors[0]);
  check('cascade note tells the driver what is happening', /Opening turn-by-turn/.test(w3.reg.nv_note.textContent), w3.reg.nv_note.textContent);
  const fireTimer = function (ms) { const t = timers.filter(function (x) { return x.ms === ms; })[0]; if (t) t.fn(); };
  fireTimer(900);
  check('cascade 2: geo URI when still here', w3.calls.anchors[1] === want.geo, w3.calls.anchors[1]);
  fireTimer(2000);
  check('cascade 3: Waze when still here', w3.calls.opened[0] === want.waze, w3.calls.opened[0]);
  fireTimer(3100);
  check('cascade 4: Google Maps web directions last', w3.calls.opened[1] === want.web, w3.calls.opened[1]);
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
  wD.reg.nv_route.onclick();
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
  check('drive screen paints remaining distance + ETA', /left/.test(wD.reg.nvd_eta.textContent), wD.reg.nvd_eta.textContent);
  check('heading-up: the map spins by −heading around the driver anchor',
    wD.reg.nvd_spin.style.transform === 'rotate(-90deg)', String(wD.reg.nvd_spin.style.transform));
  /* off-route while driving: hysteresis, then a re-route request
     and the rerouting pill on the drive screen */
  const realNowD = Date.now;
  let fakeNowD = realNowD();
  wD.world.Date = { now: function () { return fakeNowD; } };
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

  /* ================= 3. statics ================= */
  console.log('— statics —');
  check('index.html loads modules/navigator.js at ?v=<webVersion>', idxSrc.indexOf('modules/navigator.js?v=' + ver.webVersion) >= 0);
  check('index.html loads the Leaflet library', idxSrc.indexOf('leaflet@1.9.4/dist/leaflet.js') >= 0 && idxSrc.indexOf('leaflet@1.9.4/dist/leaflet.css') >= 0);
  check('app.js registers the Navigator module meta', appSrc.indexOf("navigator:  { title: 'Navigator'") >= 0);
  check('app.js runs module teardown on exit (v77 hook)', appSrc.indexOf('function teardownModule()') >= 0 && appSrc.indexOf('prev.teardown()') >= 0);
  check('preferences has the Navigator profile card', prefSrc.indexOf('pf_nv_height') >= 0 && prefSrc.indexOf('pf_nv_hazmat') >= 0);
  check('preferences Advanced has the Navigator server URL', prefSrc.indexOf('pf_nav_url') >= 0 && prefSrc.indexOf('Navigator server') >= 0);
  check('navigator.js carries no loopback/private server literals', !/127\.0\.0\.1|localhost|:8002|198\.19\.|192\.168\./.test(navSrc));
  check('v98: the one baked-in address is the shipped default server', navSrc.indexOf("var NAV_DEFAULT_SERVER_URL = 'https://2.31.47.19'") >= 0);
  check('v98: MeticulousNav exposes the default (Preferences/tests)', navSrc.indexOf('DEFAULT_SERVER_URL: NAV_DEFAULT_SERVER_URL') >= 0);
  check('v98: Preferences fallback carries the same default rule', prefSrc.indexOf("? 'https://2.31.47.19' : String(s.serverUrl)") >= 0);
  check('navigator.js states the honest unset-server line', navSrc.indexOf('Navigator server not set — routing unavailable') >= 0);
  check('navigator.js adds no native dialogs', !/[^a-z]alert\(|[^a-z]confirm\(/.test(navSrc));
  check('navigator.js carries the v93 turn-by-turn handoff', navSrc.indexOf('id="nv_ttn"') >= 0 && navSrc.indexOf('function ttnLinks') >= 0);
  check('the handoff label is the honest one (v101: the drive screen exists — no "coming" copy)',
    navSrc.indexOf('Opens Google Maps for spoken directions.') >= 0 && navSrc.indexOf('drive screen is coming') < 0);
  check('MeticulousNav exposes ttnLinks for the handoff', navSrc.indexOf('ttnLinks: ttnLinks') >= 0);
  check('v101: the drive screen ships (button + overlay + prompt engine)',
    navSrc.indexOf('id="nv_drive"') >= 0 && navSrc.indexOf('id="nv_drive_screen"') >= 0 &&
    navSrc.indexOf('function drivePrompt') >= 0 && navSrc.indexOf('DRIVE_FAR_M') >= 0);
  check('v101: pending coordinates are parsed out of the arrival text, never geocoded',
    navSrc.indexOf('parseLatLngText(pend.query)') >= 0 && navSrc.indexOf('function parseLatLngText') >= 0);
  check('v101: door 3 — a single map tap drops the pin (pinTap on the map click)',
    navSrc.indexOf('function pinTap') >= 0 && navSrc.indexOf("S.map.on('click'") >= 0);
  check('v101: the planning view is a full-screen shell',
    navSrc.indexOf('class="nv-shell"') >= 0 && cssSrc.indexOf('.nv-shell{position:fixed;inset:0') >= 0);
  check('v101: drive tilt is the standard navigation pitch (rotateX 52deg, in the 45–60 band)',
    cssSrc.indexOf('rotateX(52deg)') >= 0 && cssSrc.indexOf('.nv-drive{position:fixed;inset:0') >= 0);

  console.log('navigator-test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL harness error: ' + (e && e.stack || e)); process.exit(1); });
