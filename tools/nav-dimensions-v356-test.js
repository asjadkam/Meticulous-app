/* nav-dimensions-v356-test.js — proof for web 356
 * (DIMENSION-AWARE ROUTING — addendum 7's routing half, owner
 * Nov 6, 2026 08:32 MDT: "Why parked... Start now"):
 *  1. The SAVED VEHICLE profile's dimensions (Preferences ->
 *     Truck / onboarding VIN record: vehHeightM / vehLengthM /
 *     vehWeightKg) flow into every truck route request —
 *     kilograms become the tonnes Valhalla's costing takes.
 *  2. With NO vehicle dimensions saved, the route request is
 *     byte-for-byte the proven request it has always been.
 *  3. The clearance second look: OSM maxheight tags that run
 *     along the adopted route are matched by geometry; the
 *     LOWEST restriction below the vehicle's height raises
 *     exactly one warning; a restriction at/above the height,
 *     a tag off the route, and no data at all all stay silent.
 *  4. loadSettings (the one profile source every route is
 *     built from) lays the vehicle dimensions over the
 *     Navigator profile; the gear menu shows vehicle-owned
 *     fields locked and names their door.
 * Run:  node tools/nav-dimensions-v356-test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm');
const ROOT = __dirname + '/..';
let pass = 0, fail = 0; const fails = [];
function ok(c, m) { if (c) { pass++; } else { fail++; fails.push(m); console.log('  FAIL - ' + m); } }
function eq(a, b, m) { ok(a === b, m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function read(p) { return fs.readFileSync(ROOT + '/' + p, 'utf8'); }
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
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

/* ---------- NAVPURE ---------- */
const sb = { console };
vm.createContext(sb);
vm.runInContext(extract(navSrc, 'NAVPURE-BEGIN', 'NAVPURE-END'), sb);
ok(typeof sb.vehicleDimsFromOnboarding === 'function', 'NAVPURE exposes vehicleDimsFromOnboarding');
ok(typeof sb.profileWithVehicleDims === 'function', 'NAVPURE exposes profileWithVehicleDims');
ok(typeof sb.clearanceWarning === 'function' && typeof sb.clearanceFindings === 'function' && typeof sb.parseMaxheightM === 'function',
  'NAVPURE exposes the clearance trio');

const ORIGIN = [51.0955, -114.099], DEST = [51.1075, -114.0845];
const PROVEN = {
  locations: [
    { lon: -114.099, lat: 51.0955, type: 'break' },
    { lon: -114.0845, lat: 51.1075, type: 'break' }
  ],
  costing: 'truck',
  costing_options: {
    truck: {
      use_truck_route: 1.0, hgv_no_access_penalty: 100000.0,
      height: 3.9, width: 2.6, length: 9.0, weight: 24.0,
      axle_load: 10.0, axle_count: 3, hazmat: false
    }
  },
  directions_options: { units: 'kilometers' }
};

console.log('— vehicle dims: reading the saved vehicle profile —');
{
  const full = sb.vehicleDimsFromOnboarding({ vehHeightM: '4.1', vehLengthM: '11.0', vehWeightKg: '26000' });
  eq(full && full.height, 4.1, 'height read from vehHeightM (string ok)');
  eq(full && full.length, 11.0, 'length read from vehLengthM');
  eq(full && full.weight, 26, 'weight: 26000 kg becomes 26 tonnes');
  const partial = sb.vehicleDimsFromOnboarding({ vehHeightM: 3.9 });
  ok(partial && partial.height === 3.9 && !('length' in partial) && !('weight' in partial),
    'a height-only vehicle yields a height-only dims object');
  eq(sb.vehicleDimsFromOnboarding({}), null, 'empty record -> null');
  eq(sb.vehicleDimsFromOnboarding(null), null, 'no record -> null');
  eq(sb.vehicleDimsFromOnboarding({ vehHeightM: 'x', vehLengthM: -2, vehWeightKg: 0 }), null,
    'nonsense values are not dimensions');
  eq(sb.vehicleDimsFromOnboarding({ vehHeightM: '', vehWeightKg: '' }), null, 'blank fields are not dimensions');
}

console.log('— vehicle dims: into the route request —');
{
  const dims = sb.vehicleDimsFromOnboarding({ vehHeightM: 4.1, vehLengthM: 11, vehWeightKg: 26000 });
  const merged = sb.profileWithVehicleDims(null, dims);
  eq(merged.height, 4.1, 'merged profile height = the vehicle\'s');
  eq(merged.length, 11, 'merged profile length = the vehicle\'s');
  eq(merged.weight, 26, 'merged profile weight = the vehicle\'s (tonnes)');
  eq(merged.width, 2.6, 'width still comes from the Navigator profile (defaults)');
  eq(merged.axleLoad, 10, 'axle load untouched by the vehicle overlay');
  eq(merged.axles, 3, 'axle count untouched by the vehicle overlay');

  const req = sb.buildRouteRequest(ORIGIN, DEST, merged, 'truck');
  eq(req.costing_options.truck.height, 4.1, 'REQUEST carries the vehicle height');
  eq(req.costing_options.truck.length, 11, 'REQUEST carries the vehicle length');
  eq(req.costing_options.truck.weight, 26, 'REQUEST carries the vehicle weight');
  eq(req.costing_options.truck.width, 2.6, 'REQUEST width unchanged');
  eq(req.costing_options.truck.use_truck_route, 1.0, 'REQUEST truck-network costing unchanged');

  const customBase = sb.profileWithVehicleDims({ width: 2.9, axleLoad: 12, hazmat: true }, dims);
  const req2 = sb.buildRouteRequest(ORIGIN, DEST, customBase, 'truck');
  ok(req2.costing_options.truck.width === 2.9 && req2.costing_options.truck.axle_load === 12 && req2.costing_options.truck.hazmat === true,
    'Navigator-profile fields the vehicle does not own still ride the request');

  ok(deepEq(sb.buildRouteRequest(ORIGIN, DEST, sb.profileWithVehicleDims(null, null), 'truck'), PROVEN),
    'NO vehicle dims -> request deep-equals the proven request');
  ok(deepEq(sb.buildRouteRequest(ORIGIN, DEST, sb.profileWithVehicleDims({ height: 3.9, width: 2.6, length: 9.0, weight: 24, axleLoad: 10, axles: 3, hazmat: false }, sb.vehicleDimsFromOnboarding({})), 'truck'), PROVEN),
    'an EMPTY vehicle record changes nothing either');
  const car = sb.buildRouteRequest(ORIGIN, DEST, merged, 'car');
  ok(car.costing === 'car' && !('costing_options' in car), 'car mode stays car (no truck options, as before)');
}

console.log('— maxheight parsing —');
{
  eq(sb.parseMaxheightM('3.8'), 3.8, 'bare number is metres');
  eq(sb.parseMaxheightM('3.8 m'), 3.8, 'number + m');
  eq(sb.parseMaxheightM('4.20'), 4.2, 'two-decimal metres');
  const fi = sb.parseMaxheightM('12\'6"');
  ok(fi !== null && Math.abs(fi - 3.81) < 0.005, 'feet/inches 12\'6" -> ~3.81 m (got ' + fi + ')');
  const fi2 = sb.parseMaxheightM('12 ft 6 in');
  ok(fi2 !== null && Math.abs(fi2 - 3.81) < 0.005, '"12 ft 6 in" -> ~3.81 m (got ' + fi2 + ')');
  const ft = sb.parseMaxheightM('14 ft');
  ok(ft !== null && Math.abs(ft - 4.2672) < 0.005, '"14 ft" -> ~4.27 m (got ' + ft + ')');
  eq(sb.parseMaxheightM('none'), null, '"none" is not a value');
  eq(sb.parseMaxheightM(''), null, 'empty is not a value');
  eq(sb.parseMaxheightM(null), null, 'null tag -> null');
  eq(sb.parseMaxheightM('3.8; 4.0'), null, 'a two-value string is not guessed at');
}

console.log('— clearance findings + the one warning —');
{
  /* a straight ~1.11 km northbound line */
  const line = [[51.000, -114.000], [51.005, -114.000], [51.010, -114.000]];
  const wayOn = { type: 'way', tags: { maxheight: '3.8' }, geometry: [{ lat: 51.0049, lon: -114.0002 }, { lat: 51.0051, lon: -114.0002 }] }; // ~14 m off the line: the road itself
  const wayTall = { type: 'way', tags: { maxheight: '5.0' }, geometry: [{ lat: 51.0079, lon: -114.0002 }, { lat: 51.0081, lon: -114.0002 }] };
  const wayFar = { type: 'way', tags: { maxheight: '3.0' }, geometry: [{ lat: 51.005, lon: -114.004 }, { lat: 51.006, lon: -114.004 }] }; // ~280 m west — a parallel street
  const wayNoTag = { type: 'way', tags: { name: 'Nowhere Road' }, geometry: [{ lat: 51.005, lon: -114.0 }, { lat: 51.006, lon: -114.0 }] };
  const wayNoGeom = { type: 'way', tags: { maxheight: '2.0' } };

  const f = sb.clearanceFindings([wayOn, wayTall, wayFar, wayNoTag, wayNoGeom], line);
  eq(f.length, 2, 'only the two on-route tagged ways become findings (got ' + f.length + ')');
  ok(f.length && f[0].maxheightM === 3.8 && Math.abs(f[0].atKm - 0.55) < 0.06,
    'the 3.8 m way is found ~0.55 km along the route' + (f.length ? ' (atKm ' + f[0].atKm.toFixed(2) + ')' : ''));
  ok(f.length === 2 && f[1].maxheightM === 5.0, 'findings are in route order');

  const w = sb.clearanceWarning(f, 4.1);
  ok(w && w.maxheightM === 3.8 && w.vehicleHeightM === 4.1, 'a 4.1 m vehicle is warned about the 3.8 m restriction');
  eq(sb.clearanceWarning(f, 3.5), null, 'a 3.5 m vehicle fits under everything here -> no warning');
  eq(sb.clearanceWarning([{ maxheightM: 4.1, atKm: 0.3 }], 4.1), null, 'a restriction EQUAL to the height is a fit, not a warning');
  eq(sb.clearanceWarning([{ maxheightM: 4.5, atKm: 0.3 }], 4.1), null, 'a restriction ABOVE the height -> no warning');
  const low = sb.clearanceWarning([{ maxheightM: 4.0, atKm: 0.9 }, { maxheightM: 3.6, atKm: 0.2 }], 4.1);
  ok(low && low.maxheightM === 3.6 && low.atKm === 0.2, 'the warning names the LOWEST restriction on the route');
  eq(sb.clearanceWarning([], 4.1), null, 'no restriction data -> no warning');
  eq(sb.clearanceWarning(null, 4.1), null, 'null findings -> no warning, no crash');
  eq(sb.clearanceWarning(undefined, 4.1), null, 'undefined findings -> no warning, no crash');
  eq(sb.clearanceWarning(f, null), null, 'no vehicle height -> no warning');
  eq(sb.clearanceWarning(f, 0), null, 'zero vehicle height -> no warning');
  ok(deepEq(sb.clearanceFindings(null, line), []) && deepEq(sb.clearanceFindings([], line), []) && deepEq(sb.clearanceFindings([wayOn], null), []),
    'missing data yields empty findings, never a crash');

  /* the two carriageways of one underpass fold into one finding */
  const twin1 = { type: 'way', tags: { maxheight: '3.9' }, geometry: [{ lat: 51.0050, lon: -114.0001 }, { lat: 51.0052, lon: -114.0001 }] };
  const twin2 = { type: 'way', tags: { maxheight: '3.8' }, geometry: [{ lat: 51.0050, lon: -113.9999 }, { lat: 51.0052, lon: -113.9999 }] };
  const tf = sb.clearanceFindings([twin1, twin2], line);
  eq(tf.length, 1, 'twin carriageways at one spot fold into ONE finding');
  ok(tf.length === 1 && tf[0].maxheightM === 3.8, 'the folded finding keeps the lowest value');
}

console.log('— loadSettings: the vehicle overlay at the one profile source —');
{
  const storeData = {};
  const appStub = {
    _esc: function (s) { return String(s === null || s === undefined ? '' : s); },
    _store: {
      get: function (k, dflt) { return Object.prototype.hasOwnProperty.call(storeData, k) ? storeData[k] : dflt; },
      set: function (k, v) { storeData[k] = v; }
    }
  };
  const box = {
    console: console, App: appStub,
    document: { addEventListener: function () {}, querySelector: function () { return null; }, body: {} },
    localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval,
    fetch: undefined, L: undefined, speechSynthesis: undefined
  };
  box.window = box;
  vm.createContext(box);
  let loaded = true, loadErr = '';
  try { vm.runInContext(navSrc, box); } catch (e) { loaded = false; loadErr = String(e && e.message || e); }
  ok(loaded && box.MeticulousNav && typeof box.MeticulousNav.loadSettings === 'function',
    'the module loads under stubs and exposes MeticulousNav.loadSettings' + (loaded ? '' : ' — ' + loadErr));

  if (loaded) {
    storeData.onboarding = { vehHeightM: '4.1', vehLengthM: '11', vehWeightKg: '26000', vin: '1HGBH41JXMN109186' };
    const st = box.MeticulousNav.loadSettings();
    eq(st.profile.height, 4.1, 'loadSettings profile height = the saved vehicle\'s');
    eq(st.profile.length, 11, 'loadSettings profile length = the saved vehicle\'s');
    eq(st.profile.weight, 26, 'loadSettings profile weight = the saved vehicle\'s (tonnes)');
    eq(st.profile.width, 2.6, 'loadSettings profile width still the Navigator default');
    ok(st.vehicleDims && st.vehicleDims.height === 4.1, 'settings carry vehicleDims for the menu + the check');
    const reqV = sb.buildRouteRequest(ORIGIN, DEST, st.profile, 'truck');
    ok(reqV.costing_options.truck.height === 4.1 && reqV.costing_options.truck.weight === 26,
      'a request built from loadSettings output carries the vehicle dimensions');

    delete storeData.onboarding;
    const st2 = box.MeticulousNav.loadSettings();
    ok(deepEq(st2.profile, sb.NAV_DEFAULT_PROFILE), 'no vehicle record -> profile is the tandem defaults, unchanged');
    eq(st2.vehicleDims, null, 'no vehicle record -> vehicleDims null');
    ok(deepEq(sb.buildRouteRequest(ORIGIN, DEST, st2.profile, 'truck'), PROVEN),
      'no vehicle record -> the proven request, byte for byte');

    storeData.navigator = { profile: { height: 3.6, width: 2.5, length: 8.0, weight: 20, axleLoad: 9, axles: 2, hazmat: true } };
    storeData.onboarding = { vehHeightM: 4.4 };
    const st3 = box.MeticulousNav.loadSettings();
    ok(st3.profile.height === 4.4 && st3.profile.length === 8.0 && st3.profile.weight === 20 && st3.profile.hazmat === true,
      'a height-only vehicle overlays ONLY the height; the rest stays the Navigator profile\'s');
    delete storeData.navigator; delete storeData.onboarding;
  }
}

console.log('— statics: wiring + pins —');
{
  ok(navSrc.indexOf("vehicleDimsFromOnboarding(App._store.get('onboarding', {}) || {})") >= 0,
    'loadSettings reads the SAME onboarding record Preferences writes');
  ok(navSrc.indexOf('fetchClearanceWarnings(line)') >= 0, 'every adopted route runs the clearance second look');
  ok(navSrc.indexOf('id="nv_clearance"') >= 0, 'the Directions card carries the one warning line');
  ok(navSrc.indexOf('Low clearance ahead: ') >= 0, 'the warning is one plain line naming both heights');
  ok(navSrc.indexOf("way[\"maxheight\"]") >= 0, 'the check reads maxheight tags from Overpass (the speed-limit source)');
  ok(navSrc.indexOf('st.vehicleDims && st.vehicleDims.height') >= 0, 'the gear menu locks the vehicle-owned height');
  ok(idxSrc.indexOf('modules/navigator.js?v=' + ver.webVersion) >= 0,
    'index.html loads modules/navigator.js at ?v=<webVersion>');
  eq(ver.webVersion, 356, 'version.json is web 356');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('FAILURES:\n - ' + fails.join('\n - ')); process.exit(1); }
