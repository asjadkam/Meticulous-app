#!/usr/bin/env node
/* Meticulous v162 — Pre-Trip Inspection (Schedule 1) tests.
 *
 * Runs the REAL shipped code: modules/pti.js and js/connectpipe.js
 * are loaded whole into vm sandboxes over an in-memory store and
 * exercised through the modules' own hooks (pti._sched1/_validate/
 * _buildReport/_reportLines, CP.sharedPti). Source assertions pin
 * the registration (driver + both faces carry the card, the office
 * order does NOT), the odometer wiring (the shared photo pipeline
 * in, App._bumpOdometer out — never a direct mt_odo write, never a
 * parallel store), and the office-side paint in modules/pnl.js.
 * Run: node tools/pti-v162-test.js
 *
 * Owner's rules under test (Oct 18, 2026):
 *  - PTI is a module of its own, Schedule 1 first (23 systems).
 *  - The odometer is captured INSIDE the inspection off the dash
 *    photo (the shared App._wirePhotoOCR fast path), confirm-first:
 *    the filing commits it through App._bumpOdometer(v, 'pti').
 *  - A defect requires severity + note; a major defect is
 *    unmissable on the report, the PDF lines, and the boss's copy.
 *  - Connected owners/dispatchers see the PTI (CP.sharedPti rides
 *    sharedrecords; facts only — photo bytes never cross).
 *  - No standalone PTI card on the office face.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* ---------------- the frozen clock (v209, Stage D) ----------------
 * This suite lives on Mon Oct 19, 2026: App._today is pinned to
 * that date below, and the fixture reports are filed that day.
 * But compliance() counts gap days back from the GLOBAL clock
 * (Date.now), so with only _today pinned, every real day after
 * Oct 19 added a phantom "day without a pre-trip" to status()
 * and the exact status string drifted (the standing baseline
 * failure). The app behavior is correct — in the real app both
 * clocks are the same clock. The fixture now pins BOTH: a Date
 * whose no-arg constructor and now() return Oct 19, 2026 noon
 * local, while dated constructions delegate untouched. */
const RealDate = Date;
const FROZEN_MS = new RealDate(2026, 9, 19, 12, 0, 0).getTime();
function FrozenDate(...args) {
  return args.length ? new RealDate(...args) : new RealDate(FROZEN_MS);
}
FrozenDate.now = () => FROZEN_MS;
FrozenDate.parse = RealDate.parse;
FrozenDate.UTC = RealDate.UTC;
FrozenDate.prototype = RealDate.prototype;

/* ---------------- in-memory store + App stub ---------------- */
function makeStore(seed) {
  const data = Object.assign({}, seed || {});
  return {
    get(k, d) { return (k in data) ? data[k] : d; },
    set(k, v) { data[k] = v; },
    _data: data
  };
}
function makeApp(store) {
  return {
    _store: store,
    _esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    _today: () => '2026-10-19'
  };
}

/* ---------------- modules/pti.js ---------------- */
const store1 = makeStore({ onboarding: { firstName: 'Asjad', lastName: 'Kamal', contractingCo: 'AI Trucking', contractingAddr: '1506 16 St NE, Calgary, AB', companyName: 'Asjad Kamal', truckNo: '07' } });
const sb1 = { console, Date: FrozenDate, Meticulous: { modules: {} }, App: makeApp(store1), window: {} };
sb1.window = sb1;
vm.createContext(sb1);
vm.runInContext(read('modules/pti.js'), sb1);
const PTI = sb1.Meticulous.modules.pti;
ok('pti module registers', !!PTI);
ok('pti has status + render', typeof PTI.status === 'function' && typeof PTI.render === 'function');

/* Schedule 1: the 23 systems, in the Schedule's own order */
const S1 = PTI._sched1;
eq('Schedule 1 carries 23 systems', S1.length, 23);
eq('first system is Air Brake System', S1[0].name, 'Air Brake System');
eq('last system is Windshield Wiper / Washer', S1[S1.length - 1].name, 'Windshield Wiper / Washer');
const names = S1.map((i) => i.name);
['Cab', 'Cargo Securement', 'Coupling Devices', 'Dangerous Goods', 'Driver Controls', 'Driver Seat',
 'Electric Brake System', 'Emergency Equipment and Safety Devices', 'Exhaust System', 'Frame and Cargo Body',
 'Fuel System', 'General', 'Glass and Mirrors', 'Heater / Defroster', 'Horn', 'Hydraulic Brake System',
 'Lamps and Reflectors', 'Steering', 'Suspension System', 'Tires', 'Wheels, Hubs and Fasteners'
].forEach((n) => ok('Schedule 1 includes ' + n, names.indexOf(n) >= 0));
eq('system ids are unique', new Set(S1.map((i) => i.id)).size, 23);
ok('every system carries defect guidance', S1.every((i) => (i.minor || '') + (i.major || '') !== ''));

/* validation */
function fullItems(mut) {
  const items = {};
  S1.forEach((i) => { items[i.id] = { r: 'ok' }; });
  if (mut) mut(items);
  return items;
}
let d = { items: {}, odo: '', driverNameEffective: 'Asjad Kamal' };
ok('no odometer → refused', PTI._validate(d).indexOf('odometer') >= 0);
d = { items: {}, odo: '169300', driverNameEffective: 'Asjad Kamal' };
ok('unchecked items → refused with the count', PTI._validate(d).indexOf('0 of 23') >= 0);
/* v170 (owner, Oct 19, 2026 06:55 MDT): signing takes the DRAWN
   signature too (the Motive pad) — the all-valid fixture carries
   one, and a missing drawing refuses with its own words. */
d = { items: fullItems(), odo: '169300', driverNameEffective: 'Asjad Kamal' };
ok('no drawn signature → refused', PTI._validate(d).indexOf('Draw your signature') >= 0);
d = { items: fullItems(), odo: '169300', driverNameEffective: 'Asjad Kamal', sig: 'data:image/jpeg;base64,XXXX' };
eq('all OK + odo + name + drawn signature → valid', PTI._validate(d), '');
d = { items: fullItems((it) => { it.fuel = { r: 'defect', note: 'Dripping leak' }; }), odo: '169300', driverNameEffective: 'Asjad Kamal' };
ok('defect without severity → refused', PTI._validate(d).indexOf('Minor or Major') >= 0);
d = { items: fullItems((it) => { it.fuel = { r: 'defect', sev: 'major', note: '' }; }), odo: '169300', driverNameEffective: 'Asjad Kamal' };
ok('defect without a note → refused', PTI._validate(d).indexOf('needs a note') >= 0);
d = { items: fullItems((it) => { it.fuel = { r: 'defect', sev: 'major', note: 'Dripping leak at the tank' }; }), odo: '169300', driverNameEffective: '' };
ok('no printed name → refused', PTI._validate(d).indexOf('printed name') >= 0);

/* buildReport: a major + a minor, filed Mon Oct 19 2026 07:02 local */
const ts = new Date(2026, 9, 19, 7, 2, 0).getTime();
const rep = PTI._buildReport({
  items: fullItems((it) => {
    it.fuel = { r: 'defect', sev: 'major', note: 'Dripping leak at the tank', photo: 'data:image/jpeg;base64,AAAA' };
    it.horn = { r: 'defect', sev: 'minor', note: 'Horn weak' };
  }),
  odo: '169300', carrier: 'AI Trucking', carrierAddr: '1506 16 St NE, Calgary, AB',
  unit: '07', plate: '', loc: 'Home yard, Calgary', lat: 51.15709, lng: -113.93862,
  driverNameEffective: 'Asjad Kamal'
}, ts);
eq('report date derives from the filing moment', rep.date, '2026-10-19');
eq('report filedAt is the real filing moment', rep.filedAt, ts);
eq('a major defect makes the result major', rep.result, 'major');
eq('both defects are on the report', rep.defects.length, 2);
eq('the fuel defect is the major one', rep.defects.filter((x) => x.severity === 'major')[0].item, 'Fuel System');
eq('odometer is numeric on the report', rep.odometer, 169300);
eq('schedule named on the report', rep.schedule, 'Schedule 1');
ok('attestation rides the report', rep.attestation.indexOf('Schedule 1') >= 0 && rep.attestation.indexOf('true and complete') >= 0);
eq('all 23 systems answered on the report', Object.keys(rep.items).length, 23);
eq('an OK system reads ok', rep.items.airbrake.r, 'ok');

const passRep = PTI._buildReport({ items: fullItems(), odo: '169300', carrier: 'AI Trucking', carrierAddr: '', unit: '07', plate: 'ABC 123', loc: 'Calgary', driverNameEffective: 'Asjad Kamal' }, ts);
eq('no defects → result pass', passRep.result, 'pass');
eq('no defects → empty defect list', passRep.defects.length, 0);

/* the printed lines carry every legally required field */
const lines = PTI._reportLines(rep);
const flat = lines.map((l) => (l.a || '') + '|' + (l.b || '')).join('\n');
ok('PDF lines name the carrier', flat.indexOf('AI Trucking') >= 0);
ok('PDF lines carry the carrier address', flat.indexOf('1506 16 St NE') >= 0);
ok('PDF lines carry the odometer', flat.indexOf('169,300 km') >= 0);
ok('PDF lines carry the location', flat.indexOf('Home yard, Calgary') >= 0);
ok('PDF lines carry the printed name', flat.indexOf('Asjad Kamal') >= 0);
ok('PDF lines shout the major defect', flat.indexOf('MAJOR DEFECT FOUND') >= 0);
ok('PDF lines detail the major defect note', flat.indexOf('Dripping leak at the tank') >= 0);
ok('PDF lines carry the attestation', flat.indexOf('true and complete in substance') >= 0);
ok('PDF lines carry the signature line', lines.some((l) => l.a === 'Signed'));
const passFlat = PTI._reportLines(passRep).map((l) => (l.a || '') + '|' + (l.b || '')).join('\n');
ok('a clean report states no defects were found', passFlat.indexOf('No major or minor defects were found') >= 0);
ok('a clean report carries the plate', passFlat.indexOf('ABC 123') >= 0);
ok('a clean report has no major banner', passFlat.indexOf('MAJOR DEFECT FOUND') < 0);

/* dashboard status line */
store1.set('pti_reports', [passRep]);
eq('status: filed clean today', PTI.status(), 'Today: filed ✓ no defects');
store1.set('pti_reports', [rep]);
ok('status: major defect shouts', PTI.status().indexOf('MAJOR DEFECT') >= 0);
store1.set('pti_reports', []);
eq('status: nothing filed today', PTI.status(), 'Today: not filed yet');

/* ---------------- js/connectpipe.js — CP.sharedPti ---------------- */
const store2 = makeStore({
  pti_reports: [
    { id: 'pti1', date: '2026-10-18', filedAt: 1000, unit: '07', plate: '', odometer: 169166, location: 'Yard', result: 'pass', driverName: 'Asjad Kamal', defects: [], items: {} },
    { id: 'pti2', date: '2026-10-19', filedAt: 2000, unit: '07', plate: '', odometer: 169300, location: 'Home', result: 'major', driverName: 'Asjad Kamal',
      defects: [{ item: 'Fuel System', severity: 'major', note: 'Dripping leak', hasPhoto: true }], items: { fuel: { r: 'defect', sev: 'major', note: 'Dripping leak', photo: 'data:image/jpeg;base64,SECRETBYTES' } } }
  ],
  con_list: []
});
const sb2 = { console, Date: FrozenDate, App: makeApp(store2), Meticulous: { modules: {} }, FB: null };
sb2.window = sb2;
vm.createContext(sb2);
vm.runInContext(read('js/connectpipe.js'), sb2);
const CP = sb2.ConnectPipe;
ok('ConnectPipe loads', !!CP && typeof CP.sharedPti === 'function');
const shared = CP.sharedPti();
eq('shared PTI carries both reports', shared.length, 2);
eq('shared PTI is newest first', shared[0].date, '2026-10-19');
eq('shared PTI carries the result', shared[0].result, 'major');
eq('shared PTI carries the defect facts', shared[0].defects[0].item + '|' + shared[0].defects[0].severity + '|' + shared[0].defects[0].note, 'Fuel System|major|Dripping leak');
ok('shared PTI NEVER carries photo bytes', JSON.stringify(shared).indexOf('SECRETBYTES') < 0 && JSON.stringify(shared).indexOf('data:image') < 0);
ok('buildRecords publishes pti', read('js/connectpipe.js').indexOf('pti: CP.sharedPti()') >= 0);

/* ---------------- registration + wiring (source) ---------------- */
const appSrc = read('js/app.js');
/* v165 rename (owner, Oct 18, 2026 21:48 MDT): the module's face
   name is PTI — the v162 'Pre-Trip Inspection' title pin superseded. */
ok('MODULE_META names the module', /pti:\s*\{\s*title: 'PTI'/.test(appSrc));
const roleBlock = appSrc.slice(appSrc.indexOf('ROLE_MODULE_ORDER = {'), appSrc.indexOf('};', appSrc.indexOf('ROLE_MODULE_ORDER = {')));
ok('driver face carries the PTI card', /driver: \[[^\]]*'pti'/.test(roleBlock));
ok('both face carries the PTI card', /both: \[[^\]]*'pti'/.test(roleBlock));
/* v213 (PTI-ROLE-SPLIT, owner Oct 21, 2026 14:09 MDT) supersedes
   the v167/v162 'no PTI card on the office face' pin: the office
   face now carries PTI as a VIEWER (drivers' reports) — the form
   itself is role-gated inside modules/pti.js and proven absent
   for office by tools/pti-role-split-v213-test.js. */
ok('office face carries the PTI card as a viewer (v213)', /office: \[[^\]]*'pti'/.test(roleBlock));
ok('MODULE_ORDER carries pti', /MODULE_ORDER = \[[^\]]*'pti'/.test(appSrc));
ok('sidebar carries pti', appSrc.indexOf("['pti', '🔍', 'PTI']") >= 0);

const ptiSrc = read('modules/pti.js');
ok('PTI wires the shared dash-photo pipeline', ptiSrc.indexOf("App._wirePhotoOCR('pti_odo', 'odometer'") >= 0);
ok('PTI photo origin is its own', ptiSrc.indexOf("module: 'pti'") >= 0);
ok('the filing commits via App._bumpOdometer(…, \'pti\')', ptiSrc.indexOf("App._bumpOdometer(rep.odometer, 'pti')") >= 0);
ok('PTI sets the day-start on today’s session', ptiSrc.indexOf('s.startOdo = rep.odometer') >= 0);
ok('PTI never writes mt_odo directly (no parallel odometer path)', ptiSrc.indexOf("set('mt_odo'") < 0 && ptiSrc.indexOf('set("mt_odo"') < 0);
ok('filing publishes to connected peers', ptiSrc.indexOf('ConnectPipe.publishRecords') >= 0);
ok('PTI prints through MetPdf', ptiSrc.indexOf('MetPdf.savePdf') >= 0);

const pnlSrc = read('modules/pnl.js');
ok('the boss’s records block paints PTI', pnlSrc.indexOf('rec.pti') >= 0 && pnlSrc.indexOf('His PTIs') >= 0);
ok('the boss’s PTI paint shouts majors', pnlSrc.indexOf('🚨 MAJOR DEFECT') >= 0);

ok('index.html loads the module', read('index.html').indexOf('modules/pti.js?v=226') >= 0);
ok('sharedrecords rules exist for the ride', read('firestore.rules').indexOf('match /sharedrecords/{driverId}') >= 0);

console.log('pti-v162 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
