#!/usr/bin/env node
/* Meticulous — VIN-PROFILE-TO-NAVIGATOR-APPWIDE-NOV8 suite.
 *
 * Owner ruling, Nov 8, 2026 18:21 CST: "I don't think it should
 * be kept in the prefernces.. I think it should be kept in
 * navigator prefernces... And I don't think this tool should be
 * available on buses only... This feature should be app wide!"
 *
 * CONVICTION (pre-fix state, verified in the tree):
 *  - The vehicle profile door (v355, addendum 7) was a block
 *    INSIDE the 🚛 Truck card in modules/preferences.js: the
 *    pf_vin input + 📷 Snap VIN + pf_vin_in file door +
 *    pf_vin_status line + hidden pf_vdesc + pf_vheight /
 *    pf_vlength / pf_vweight, saved by the Preferences form
 *    (collectOnbInputs guarded reads + wpFlushDom flush lines)
 *    and wired by decodeVin355 (TicketOCR photo read + NHTSA
 *    vPIC decode, saved onto the onboarding record at once).
 *  - Its gate was the Truck card's: the whole card renders only
 *    when the effective role is NOT 'office' — so office-only
 *    accounts (an owner-operator or fleet manager who does not
 *    drive) never saw the vehicle door at all, and every driver
 *    found it buried in general Preferences, away from the
 *    navigation it feeds.
 *  - The Navigator's OWN preferences surface is the ⚙️ gear
 *    menu (nvSettingsHTML / wireNavSettings in
 *    modules/navigator.js), opened from the plan face gear,
 *    the drive face gear, and the Preferences door
 *    (pf_nv_open -> nav_open_settings). Its "🚛 Your truck"
 *    section already held the Navigator profile's dimensions —
 *    and since v356 the vehicle's height / length / weight
 *    showed there LOCKED, pointing back to "Preferences →
 *    Truck", because that was where they were confirmed.
 *  - The Navigator module itself is in ALL THREE role packages
 *    (js/app.js: driver, office, both) — the module is already
 *    app-wide; the menu carries no role gate of its own.
 *  - Storage: the onboarding record — vin / vehDesc /
 *    vehHeightM / vehLengthM / vehWeightKg (strings as typed).
 *    v356: loadSettings overlays vehicleDimsFromOnboarding onto
 *    the Navigator profile; every route request is built from
 *    that merged profile; the clearance second look reads the
 *    vehicle height. NONE of that wiring is touched here.
 *
 * THE FIX (this bench; NOT shipped by the bench):
 *  - The VIN block (field + Snap VIN photo door + status line)
 *    renders in the gear menu's Your truck section, above
 *    Height — for every account, no gate of its own.
 *  - Height / Length / Weight in that section are the
 *    VEHICLE's fields now: unlocked, showing the effective
 *    (merged) numbers, saving onto the onboarding record the
 *    moment they change (saveVehicleDims; weight shown in
 *    tonnes, stored in kilograms — the record's own units).
 *    Width / axles / hazmat stay the Navigator profile's
 *    (saveProfile carries the vehicle's three through
 *    untouched and never writes the vehicle record).
 *  - The decode flow moved with the card: same vPIC endpoint,
 *    same 17-character extraction from the photo text, same
 *    status words — one wording adapted to the new home: the
 *    old "…and Save" became "…they save as you change them",
 *    because this menu has no Save button. The typed VIN also
 *    saves at once here (in Preferences it waited for the form
 *    Save; the status line always promised it saved).
 *  - Preferences: the block, its form-save reads, its flush
 *    lines and decodeVin355 are GONE (a move, not a copy). The
 *    stored record is never read or written by Preferences
 *    anymore, so existing profiles survive untouched.
 *  - The onboarding wizard's pointer copy now names the
 *    Navigator's settings as where the size is saved.
 *
 * NAMED CHOICE (for the owner's veto): of the Navigator's
 * surfaces, the gear menu is the one a driver would call
 * "Navigator preferences" — it is literally titled "⚙️
 * Navigator settings" and Preferences already defers to it.
 * Runner-up: the Navigator face's own "Saved places & app
 * links" card — a face card, not a preferences surface; not
 * taken.
 *
 * PROOF below: source pins for the move + the ungate + the
 * untouched storage/wiring; the REAL preferences module
 * rendered in three worlds (no vehicle card anywhere); the
 * REAL nvSettingsHTML + loadSettings executed in four worlds
 * (dump-truck driver, school-bus driver, fleet-manager
 * office, brand-new account — the door renders in all, with
 * the pre-move fixture read whole); the REAL decodeVin and
 * saveVehicleDims extracted and run (decode writes vin +
 * vehDesc at once; a failed decode still saves the VIN; a
 * short VIN writes nothing; dims save in the record's units
 * and rebuild the merged profile the routes use; saveProfile
 * never touches the vehicle record).
 *
 * Run: node tools/vin-profile-navigator-appwide-nov8-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  ✗ FAIL: ' + label); }
}
function eq(got, want, label) {
  ok(got === want, label + ' (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')');
}
function has(label, hay, needle) { ok(String(hay).indexOf(needle) >= 0, label); }
function hasnt(label, hay, needle) { ok(String(hay).indexOf(needle) < 0, label); }

const navSrc = read('modules/navigator.js');
const prefSrc = read('modules/preferences.js');
const appSrc = read('js/app.js');

/* ============ extraction helpers (house pattern) ============ */
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('fn not found: ' + name);
  let i = src.indexOf('{', start), depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, j + 1);
}
function extractStmt(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('stmt not found: ' + marker);
  const end = src.indexOf(';', start);
  return src.slice(start, end + 1);
}
function extractVarFn(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('var fn not found: ' + marker);
  let i = src.indexOf('{', start), depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, j + 1) + ';';
}
function memStore(seed) {
  const data = JSON.parse(JSON.stringify(seed || {}));
  return {
    get: function (k, d) { return (k in data) ? data[k] : d; },
    set: function (k, v) { data[k] = v; },
    del: function (k) { delete data[k]; },
    _data: data
  };
}

/* ================= 0. Source pins — the move ================= */
console.log('— 0. Source pins: the door moved, the record and the routing wiring did not —');
hasnt('preferences.js: no pf_vin field anywhere', prefSrc, 'pf_vin');
hasnt('preferences.js: no pf_vdesc field anywhere', prefSrc, 'pf_vdesc');
hasnt('preferences.js: no pf_vheight field anywhere', prefSrc, 'pf_vheight');
hasnt('preferences.js: no pf_vlength field anywhere', prefSrc, 'pf_vlength');
hasnt('preferences.js: no pf_vweight field anywhere', prefSrc, 'pf_vweight');
hasnt('preferences.js: the vPIC decoder left Preferences entirely', prefSrc, 'decodevinvalues');
hasnt('preferences.js: decodeVin355 is gone', prefSrc, 'decodeVin355 = function');
ok(!/decodeVin355\(/.test(prefSrc), 'preferences.js: no decodeVin355 call survives');

has('navigator.js: the VIN field renders in the settings menu', navSrc, 'id="nvs_vin"');
has('navigator.js: the Snap VIN photo door renders', navSrc, 'id="nvs_vin_cam"');
has('navigator.js: the photo file door renders', navSrc, 'id="nvs_vin_in"');
has('navigator.js: the status line renders', navSrc, 'id="nvs_vin_status"');
has('navigator.js: the vPIC decoder lives here now', navSrc, 'decodevinvalues');
has('navigator.js: the photo is read by the haul-card reader', navSrc, 'TicketOCR.recognizeWithRotation');
has('navigator.js: dims save onto the vehicle record', navSrc, 'function saveVehicleDims()');
hasnt('navigator.js: the v356 height lock is gone', navSrc, "vehicleDims.height ? ' disabled'");
hasnt('navigator.js: the v356 length lock is gone', navSrc, "vehicleDims.length ? ' disabled'");
hasnt('navigator.js: the v356 weight lock is gone', navSrc, "vehicleDims.weight ? ' disabled'");
hasnt('navigator.js: no copy points back to Preferences for the vehicle', navSrc, 'come from your vehicle (Preferences');

console.log('— 0b. Storage shape + route wiring untouched —');
has('navigator.js: still reads vehHeightM off the onboarding record', navSrc, "Number(o.vehHeightM)");
has('navigator.js: still reads vehLengthM off the onboarding record', navSrc, "Number(o.vehLengthM)");
has('navigator.js: still reads vehWeightKg off the onboarding record', navSrc, "Number(o.vehWeightKg)");
has('navigator.js: loadSettings still overlays the vehicle dims (v356)', navSrc, "vehDims = vehicleDimsFromOnboarding(App._store.get('onboarding', {}) || {})");
has('navigator.js: the merged profile still feeds every route (v356)', navSrc, 'out.profile = profileWithVehicleDims(out.profile, vehDims)');
has('navigator.js: route costing still reads the profile height', navSrc, 'height: p.height');
has('navigator.js: route costing still reads the profile weight', navSrc, 'weight: p.weight');

console.log('— 0c. The ungate: the Navigator is in every role package; the onboarding pointer moved —');
{
  const pkgs = {};
  ['driver', 'office', 'both'].forEach(function (r) {
    const m = new RegExp(r + ": \\[([^\\]]+)\\]").exec(appSrc);
    pkgs[r] = m ? m[1] : '';
    ok(pkgs[r].indexOf("'navigator'") >= 0, "js/app.js: 'navigator' is in the " + r + ' package (app-wide)');
  });
  has('js/app.js: the wizard pointer names the Navigator’s settings', appSrc, 'its size is saved with it in the Navigator’s settings');
  hasnt('js/app.js: the wizard no longer points at Preferences for the size', appSrc, 'its size is saved with it in Preferences');
}

/* ============ 1. Preferences renders NO vehicle card ============
 * The v137 harness pattern: a rendered-id aware fake DOM, the
 * REAL preferences module, three worlds. */
function FakeEl(sel) {
  this._sel = sel || '';
  this.value = '';
  this.textContent = '';
  this.checked = false;
  this.disabled = false;
  this.style = {};
  this.files = [];
  this.onclick = null;
  this.onchange = null;
  this._listeners = {};
  const classes = new Set();
  this.classList = {
    add: function (c) { classes.add(c); },
    remove: function (c) { classes.delete(c); },
    contains: function (c) { return classes.has(c); },
    toggle: function (c, force) {
      const on = force === undefined ? !classes.has(c) : !!force;
      if (on) classes.add(c); else classes.delete(c);
      return on;
    }
  };
}
FakeEl.prototype.addEventListener = function (type, fn) {
  (this._listeners[type] = this._listeners[type] || []).push(fn);
};
FakeEl.prototype.click = function () { if (this.onclick) this.onclick({ target: this }); };
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };
FakeEl.prototype.querySelector = function () { return null; };
FakeEl.prototype.querySelectorAll = function () { return []; };

function makeBody() {
  const body = new FakeEl('body');
  let registry = {};
  let html = '';
  Object.defineProperty(body, 'innerHTML', {
    get: function () { return html; },
    set: function (v) {
      html = String(v);
      registry = {};
      const tagRe = /<(input|select|textarea|button)\b[^>]*\bid="([^"]+)"[^>]*>/g;
      let m;
      const spans = [];
      while ((m = tagRe.exec(html))) spans.push({ tag: m[1], id: m[2], full: m[0], at: m.index });
      const selRe = /<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g;
      const selVals = {};
      while ((m = selRe.exec(html))) {
        const opts = [];
        const oRe = /<option([^>]*)>([^<]*)<\/option>/g;
        let om;
        while ((om = oRe.exec(m[2]))) opts.push({ sel: /selected/.test(om[1]), text: om[2] });
        const chosen = opts.filter(function (o) { return o.sel; })[0] || opts[0];
        selVals[m[1]] = chosen ? chosen.text : '';
      }
      spans.forEach(function (s) {
        const el = new FakeEl('#' + s.id);
        const vm2 = /\bvalue="([^"]*)"/.exec(s.full);
        if (s.tag === 'select') el.value = selVals[s.id] || '';
        else if (vm2) el.value = vm2[1];
        if (/\bchecked\b/.test(s.full)) el.checked = true;
        registry['#' + s.id] = el;
      });
    }
  });
  body.querySelector = function (sel) { return registry[sel] || null; };
  body.querySelectorAll = function () { return []; };
  return body;
}

function prefsWorld(onboarding, role) {
  const store = memStore({ onboarding: onboarding });
  const App = {
    _store: store,
    _esc: function (s) { return String(s == null ? '' : s); },
    _masterOdometer: function () { return null; },
    userRole: function () { return role; },
    user: null,
    onAuth: function () {},
    goSignIn: function () {},
    toast: function () {}
  };
  const sb = { window: {}, Meticulous: { modules: {} }, App, console, alert: function () {}, confirm: function () { return true; } };
  sb.window.App = App;
  vm.createContext(sb);
  vm.runInContext(prefSrc, sb);
  return { sb, store };
}

console.log('— 1. Preferences: no vehicle card in any world (the real module, rendered) —');
{
  const VEHICLE = { vin: '1HSHXAHN0DJ123456', vehDesc: '2016 · International · DuraStar · Truck', vehHeightM: '3.9', vehLengthM: '9.2', vehWeightKg: '16000' };
  const worlds = [
    ['dump-truck driver with a saved vehicle profile', Object.assign({ accountType: 'Driver', driverKind: 'dump', userRole: 'driver', payRate: '29' }, VEHICLE), 'driver'],
    ['school-bus split driver with a saved vehicle profile', Object.assign({ accountType: 'Driver', driverKind: 'school-bus', workPattern: 'split', userRole: 'driver' }, VEHICLE), 'driver'],
    ['office-only fleet manager', { accountType: 'Fleet Manager', userRole: 'office' }, 'office']
  ];
  worlds.forEach(function (w) {
    const world = prefsWorld(w[1], w[2]);
    const body = makeBody();
    world.sb.Meticulous.modules.preferences.render(body);
    const html = body.innerHTML;
    hasnt(w[0] + ': no VIN field', html, 'pf_vin');
    hasnt(w[0] + ': no Snap VIN door', html, 'Snap VIN');
    hasnt(w[0] + ': no vehicle height field', html, 'pf_vheight');
    hasnt(w[0] + ': the saved VIN itself never renders', html, '1HSHXAHN0DJ123456');
    hasnt(w[0] + ': the saved vehicle description never renders', html, 'DuraStar');
    eq(JSON.stringify(world.store._data.onboarding), JSON.stringify(w[1]),
      w[0] + ': rendering Preferences leaves the stored vehicle record byte-identical');
  });
  const drv = prefsWorld(Object.assign({ accountType: 'Driver', driverKind: 'dump', userRole: 'driver', payRate: '29' }, VEHICLE), 'driver');
  const dbody = makeBody();
  drv.sb.Meticulous.modules.preferences.render(dbody);
  has('the rest of the Truck card is untouched: truck number still renders', dbody.innerHTML, 'id="pf_tnum"');
  has('the rest of the Truck card is untouched: plate still renders', dbody.innerHTML, 'id="pf_plate"');
}

/* ============ 2. The Navigator settings menu, four worlds ============
 * The REAL loadSettings + nvSettingsHTML, extracted and run
 * against seeded stores. */
function navWorld(onboarding, navStored) {
  const store = memStore({ onboarding: onboarding || {}, navigator: navStored || {} });
  const App = {
    _store: store,
    _esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  };
  const sb = { App, console };
  const serverUrl = /var NAV_DEFAULT_SERVER_URL = '[^']*';/.exec(navSrc)[0];
  const defProfile = /var NAV_DEFAULT_PROFILE = \{[^}]*\};/.exec(navSrc)[0];
  const avatarKinds = /var AVATAR_KINDS = \[[^\]]*\];/.exec(navSrc)[0];
  vm.createContext(sb);
  vm.runInContext(
    'var App = this.App;\n' + serverUrl + '\n' + defProfile + '\n' + avatarKinds + '\n' +
    'var esc = function (s) { return App._esc(s); };\n' +
    'function speak() {}\n' +
    'var S = { settings: null };\n' +
    extractFn(navSrc, 'setNavViewMode') + '\n' +
    extractFn(navSrc, 'navProfile') + '\n' +
    extractFn(navSrc, 'vehicleDimsFromOnboarding') + '\n' +
    extractFn(navSrc, 'profileWithVehicleDims') + '\n' +
    extractFn(navSrc, 'loadSettings') + '\n' +
    extractFn(navSrc, 'nvSettingsHTML') + '\n' +
    'S.settings = loadSettings();\n' +
    'this.__settings = S.settings; this.__html = nvSettingsHTML();',
    sb);
  return { html: sb.__html, settings: sb.__settings, store };
}

console.log('— 2. Navigator ⚙️ settings: the vehicle door renders in every world —');
{
  /* The pre-move fixture: exactly what the old Preferences
     card saved (strings, the record's own shape). */
  const PRE_MOVE = { vin: '1HSHXAHN0DJ123456', vehDesc: '2016 · International · DuraStar · Truck', vehHeightM: '3.9', vehLengthM: '9.2', vehWeightKg: '16000' };
  const dump = navWorld(Object.assign({ accountType: 'Driver', driverKind: 'dump', userRole: 'driver' }, PRE_MOVE));
  has('dump-truck driver: the VIN field renders', dump.html, 'id="nvs_vin"');
  ok(/id="nvs_vin"[^>]*value="1HSHXAHN0DJ123456"/.test(dump.html), 'dump-truck driver: the saved VIN shows in the field');
  has('dump-truck driver: the Snap VIN door renders', dump.html, 'id="nvs_vin_cam"');
  has('dump-truck driver: the decoded vehicle names itself in the status line', dump.html, 'Vehicle: <b>2016 · International · DuraStar · Truck</b>');
  ok(/id="nvs_height"[^>]*value="3.9"/.test(dump.html), 'dump-truck driver: height shows the vehicle’s 3.9 m');
  ok(/id="nvs_length"[^>]*value="9.2"/.test(dump.html), 'dump-truck driver: length shows the vehicle’s 9.2 m');
  ok(/id="nvs_weight"[^>]*value="16"/.test(dump.html), 'dump-truck driver: weight shows the vehicle’s 16 tonnes (16000 kg on the record)');
  ok(!/id="nvs_(height|length|weight)"[^>]*disabled/.test(dump.html), 'dump-truck driver: NONE of the vehicle fields is locked anymore');

  const BUS = { vin: '1BAKGCPH5MF123456', vehDesc: '2021 · Blue Bird · Vision · School Bus', vehHeightM: '3.2', vehLengthM: '12', vehWeightKg: '14000' };
  const bus = navWorld(Object.assign({ accountType: 'Driver', driverKind: 'school-bus', workPattern: 'split', userRole: 'driver' }, BUS));
  has('school-bus driver: the VIN field renders', bus.html, 'id="nvs_vin"');
  ok(/id="nvs_vin"[^>]*value="1BAKGCPH5MF123456"/.test(bus.html), 'school-bus driver: the bus VIN shows');
  ok(/id="nvs_height"[^>]*value="3.2"/.test(bus.html), 'school-bus driver: the bus height shows');
  ok(/id="nvs_weight"[^>]*value="14"/.test(bus.html), 'school-bus driver: the bus weight shows in tonnes');

  const office = navWorld({ accountType: 'Fleet Manager', userRole: 'office' });
  has('office-only fleet manager (never saw the door before): the VIN field renders', office.html, 'id="nvs_vin"');
  has('office-only fleet manager: the Snap VIN door renders', office.html, 'id="nvs_vin_cam"');
  has('office-only fleet manager: the empty door carries the helper line', office.html, 'Photograph the VIN plate or type the VIN — the app names the vehicle from it.');
  ok(/id="nvs_height"[^>]*value="3.9"/.test(office.html), 'office-only fleet manager: no vehicle saved -> the profile default height (3.9 m) shows, as before');

  const fresh = navWorld({});
  has('brand-new account (no onboarding at all): the VIN field renders', fresh.html, 'id="nvs_vin"');
  has('brand-new account: the photo door renders', fresh.html, 'id="nvs_vin_in"');
}

/* ============ 3. A pre-move profile rides a route ============ */
console.log('— 3. The pre-move fixture is read whole and rides the merged profile routes are built from —');
{
  const PRE_MOVE = { vin: '1HSHXAHN0DJ123456', vehDesc: '2016 · International · DuraStar · Truck', vehHeightM: '3.9', vehLengthM: '9.2', vehWeightKg: '16000' };
  const w = navWorld(Object.assign({ accountType: 'Driver', driverKind: 'dump' }, PRE_MOVE));
  eq(w.settings.vehicleDims.height, 3.9, 'vehicleDims: height read off the record');
  eq(w.settings.vehicleDims.length, 9.2, 'vehicleDims: length read off the record');
  eq(w.settings.vehicleDims.weight, 16, 'vehicleDims: weight read off the record, in tonnes');
  eq(w.settings.profile.height, 3.9, 'merged profile (what every route request is built from): height is the vehicle’s');
  eq(w.settings.profile.length, 9.2, 'merged profile: length is the vehicle’s');
  eq(w.settings.profile.weight, 16, 'merged profile: weight is the vehicle’s');
  eq(w.store._data.onboarding.vin, '1HSHXAHN0DJ123456', 'reading the settings never disturbed the record');
}

/* ============ 4. The moved flow, run for real ============
 * decodeVin + saveVehicleDims + saveProfile extracted from
 * wireNavSettings and executed against a fake panel. */
function flowWorld(onboarding, fetchImpl) {
  const store = memStore({ onboarding: onboarding || {}, navigator: {} });
  const App = {
    _store: store,
    _esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  };
  const els = {};
  ['nvs_vin', 'nvs_vin_status', 'nvs_height', 'nvs_length', 'nvs_weight', 'nvs_width', 'nvs_axleload', 'nvs_axles', 'nvs_hazmat', 'nvs_note'].forEach(function (id) {
    els['#' + id] = { value: '', checked: false, textContent: '', innerHTML: '', files: [], onclick: null, onchange: null };
  });
  const panel = { querySelector: function (sel) { return els[sel] || null; } };
  const saved = { patches: [] };
  const sb = { App, console, panel, fetch: fetchImpl, TicketOCR: undefined, URL: { createObjectURL: function () { return 'blob:x'; } } };
  const serverUrl = /var NAV_DEFAULT_SERVER_URL = '[^']*';/.exec(navSrc)[0];
  const defProfile = /var NAV_DEFAULT_PROFILE = \{[^}]*\};/.exec(navSrc)[0];
  const avatarKinds = /var AVATAR_KINDS = \[[^\]]*\];/.exec(navSrc)[0];
  vm.createContext(sb);
  vm.runInContext(
    'var App = this.App, panel = this.panel;\n' + serverUrl + '\n' + defProfile + '\n' + avatarKinds + '\n' +
    'var esc = function (s) { return App._esc(s); };\n' +
    'function speak() {}\n' +
    'var S = { settings: null, dest: null, plan: null };\n' +
    'function doRoute() { S.__routes = (S.__routes || 0) + 1; }\n' +
    'function saveSettings(patch) { this.__saved = this.__saved || []; }\n' +
    extractFn(navSrc, 'setNavViewMode') + '\n' +
    extractFn(navSrc, 'navProfile') + '\n' +
    extractFn(navSrc, 'vehicleDimsFromOnboarding') + '\n' +
    extractFn(navSrc, 'profileWithVehicleDims') + '\n' +
    extractFn(navSrc, 'loadSettings') + '\n' +
    extractStmt(navSrc, 'var profIds = {') + '\n' +
    extractFn(navSrc, 'saveProfile') + '\n' +
    extractFn(navSrc, 'saveVehicleDims') + '\n' +
    extractStmt(navSrc, "var vinEl = panel.querySelector('#nvs_vin')") + '\n' +
    extractVarFn(navSrc, 'var decodeVin = function') + '\n' +
    'S.settings = loadSettings();\n' +
    'this.__S = S; this.__els = panel; this.__decodeVin = decodeVin; this.__saveVehicleDims = saveVehicleDims; this.__saveProfile = saveProfile; this.__loadSettings = loadSettings;',
    sb);
  return { sb, store, els, S: sb.__S };
}
const tick = () => new Promise((r) => setImmediate(r));

(async function () {
  console.log('— 4. Decode flow: unchanged, and it saves at once in the new home —');
  {
    const fetchOk = function () {
      return Promise.resolve({ json: function () { return Promise.resolve({ Results: [{ ModelYear: '2016', Make: 'International', Model: 'DuraStar', BodyClass: 'Truck' }] }); } });
    };
    const w = flowWorld({ accountType: 'Driver', driverKind: 'dump' }, fetchOk);
    w.sb.__decodeVin(' 1hshxahn0dj123456 ');
    await tick(); await tick();
    eq(w.store._data.onboarding.vin, '1HSHXAHN0DJ123456', 'typed VIN is sanitised, uppercased and saved at once');
    eq(w.store._data.onboarding.vehDesc, '2016 · International · DuraStar · Truck', 'the decode names the vehicle on the same record (year · make · model · body)');
    has('the status line names the vehicle and asks for the one-time check', w.els['#nvs_vin_status'].innerHTML, 'Vehicle: <b>2016 · International · DuraStar · Truck</b>');
    has('the status wording fits the new home (no form Save here)', w.els['#nvs_vin_status'].innerHTML, 'they save as you change them');
  }
  {
    const fetchDown = function () { return Promise.reject(new Error('offline')); };
    const w = flowWorld({}, fetchDown);
    w.sb.__decodeVin('1HSHXAHN0DJ123456');
    await tick(); await tick();
    eq(w.store._data.onboarding.vin, '1HSHXAHN0DJ123456', 'decoder unreachable: the typed VIN still saves (the decoder is a helper, never a gate)');
    eq(w.store._data.onboarding.vehDesc, undefined, 'decoder unreachable: no description is invented');
    has('decoder unreachable: the status line says so plainly', w.els['#nvs_vin_status'].textContent, 'could not be reached');
  }
  {
    const w = flowWorld({}, function () { return Promise.reject(new Error('must not be called')); });
    w.sb.__decodeVin('ABC123');
    await tick();
    eq(w.store._data.onboarding.vin, undefined, 'a short VIN writes nothing');
    has('a short VIN names itself in the status line', w.els['#nvs_vin_status'].textContent, 'A VIN is 17 characters');
  }

  console.log('— 5. Confirm flow: the three numbers save onto the record, in its own units —');
  {
    const w = flowWorld({ accountType: 'Driver', driverKind: 'dump', splitRate: '30' }, function () { return Promise.reject(new Error('unused')); });
    w.els['#nvs_height'].value = '4.1';
    w.els['#nvs_length'].value = '10.5';
    w.els['#nvs_weight'].value = '18.5';
    w.sb.__saveVehicleDims();
    eq(w.store._data.onboarding.vehHeightM, 4.1, 'height saves onto the vehicle record (metres)');
    eq(w.store._data.onboarding.vehLengthM, 10.5, 'length saves onto the vehicle record (metres)');
    eq(w.store._data.onboarding.vehWeightKg, 18500, 'weight saves onto the vehicle record in KILOGRAMS (18.5 t shown)');
    eq(w.store._data.onboarding.splitRate, '30', 'the rest of the onboarding record survives the write');
    eq(w.S.settings.profile.height, 4.1, 'the merged profile routes are built from carries the new height at once');
    eq(w.S.settings.profile.weight, 18.5, 'the merged profile carries the new weight at once');
    eq(w.S.settings.vehicleDims.height, 4.1, 'vehicleDims (the clearance check’s height source) is the new height');

    w.els['#nvs_height'].value = '';
    w.sb.__saveVehicleDims();
    eq(w.store._data.onboarding.vehHeightM, '', 'clearing the box clears the vehicle’s field');
    eq(w.S.settings.vehicleDims.height, undefined, 'with no vehicle height, vehicleDims carries none');
    eq(w.S.settings.profile.height, 3.9, 'and the Navigator profile’s own height shows through again (the v356 underlay — the 3.9 m default)');
  }
  {
    /* saveProfile must never become a second writer of the
       vehicle record: width is the profile's own; the
       vehicle's three ride through the profile untouched. */
    const before = { accountType: 'Driver', vin: '1HSHXAHN0DJ123456', vehDesc: '2016 · International · DuraStar · Truck', vehHeightM: '3.9', vehLengthM: '9.2', vehWeightKg: '16000' };
    const w = flowWorld(before, function () { return Promise.reject(new Error('unused')); });
    w.els['#nvs_width'].value = '2.8';
    w.els['#nvs_axleload'].value = '';
    w.els['#nvs_axles'].value = '';
    w.els['#nvs_hazmat'].checked = false;
    w.sb.__saveProfile();
    eq(JSON.stringify(w.store._data.onboarding), JSON.stringify(before), 'saveProfile never touches the vehicle record');
    eq(w.S.settings.profile.width, 2.8, 'width still saves to the Navigator profile');
    eq(w.S.settings.profile.height, 3.9, 'the profile save carries the vehicle height through (it does not read it from a form field of its own)');
  }

  console.log('\nVIN-PROFILE-TO-NAVIGATOR-APPWIDE-NOV8: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('SUITE ERROR:', e && e.stack || e); process.exit(2); });
