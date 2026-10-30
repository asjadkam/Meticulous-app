#!/usr/bin/env node
/* Meticulous v86 — LIVE-DRIVE REPLICATIONS.
 *
 * Owner evidence (Oct 15, 2026, ~20:07 MDT): a live end-to-end
 * drive of the PRODUCTION app (real browser, throwaway instance)
 * caught five defects the suites had all missed — because no
 * suite drove the REAL chains end-to-end. The module suites stub
 * the tracker, seed the session record by hand, or extract single
 * functions; the breaks lived BETWEEN the pieces. This suite
 * drives production code whole:
 *
 *   D1  the real Fuel module against the real odometer decision
 *       (master 168,759 + typed 519,326 — the receipt's invoice
 *       number — exactly the owner's live case), plus the
 *       decision/bump units for the new two-sided gate.
 *   D2  the real tracker functions + real Dispatch module + real
 *       Manifest: +1 load tapped twice, plain Complete, and the
 *       manifest must show the count 2 (session → record →
 *       manifest, nothing seeded past the taps).
 *   D3  the close flow's new manual door: no photo → type ticket #
 *       + foreman hours → the same confirm → completed record +
 *       Revenue entry; plus the grouping truth for a confirmed
 *       day carrying a tiny "Auto from tracker" session entry.
 *   D4  (a) the dispatch form's split date/time fields: a time
 *       typed ALONE saves as today at that time; (b) a dispatch
 *       scheduled 08:00 drives the manifest Start (not the session
 *       time), and a dispatch with no confirmed time gets the
 *       LABELLED tracker fallback.
 *   D5  plain Complete with a running session shows the
 *       shift-closed sentence; without a session it does not.
 *
 * Run: node tools/live-drive-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');
const dspSrc = read('modules/dispatch.js');
const manSrc = read('modules/manifest.js');
const fuelSrc = read('modules/fuel.js');
const ocrSrc = read('js/ticket-ocr.js');
const invSrc = read('modules/invoice.js');
const revSrc = read('modules/revenue.js');

let pass = 0, fail = 0;
function eq(name, got, want) {
  if (String(got) === String(want)) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function has(name, hay, needle) { ok(name, String(hay).indexOf(needle) >= 0, 'missing ' + JSON.stringify(needle)); }

/* ---------------- shared fake DOM / extraction ---------------- */
function FakeEl(sel) {
  this._sel = sel || ''; this._kids = {}; this._html = '';
  this.value = ''; this.textContent = ''; this.style = {}; this.files = [];
  this.checked = false; this.onclick = null; this._listeners = {};
  this.options = [{ text: '' }]; this.selectedIndex = 0;
}
Object.defineProperty(FakeEl.prototype, 'innerHTML', {
  get: function () { return this._html; },
  set: function (v) { this._html = String(v); this._kids = {}; }
});
FakeEl.prototype.querySelector = function (sel) { return this._kids[sel] || (this._kids[sel] = new FakeEl(sel)); };
FakeEl.prototype.querySelectorAll = function () { return []; };
FakeEl.prototype.addEventListener = function (type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); };
FakeEl.prototype.fire = function (type) { const s = this; (this._listeners[type] || []).slice().forEach(fn => fn({ target: s })); };
FakeEl.prototype.click = function () { if (this.onclick) this.onclick({ target: this }); };
FakeEl.prototype.scrollIntoView = function () {};
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };
const docStub = {
  createElement: function (tag) { return new FakeEl(tag); },
  querySelector: function () { return null; },
  getElementById: function () { return null; },
  addEventListener: function () {}
};
function makeLocal() {
  const mem = {};
  return { mem, getItem: k => (k in mem) ? mem[k] : null,
    setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
}
function extractFn(src, marker) {
  const i = src.indexOf(marker);
  if (i === -1) throw new Error('marker not found: ' + marker);
  let depth = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { k++; break; } }
  }
  return src.slice(i, k);
}
function extractStore() {
  const i = appSrc.indexOf('var store = {');
  let depth = 0, j = i;
  for (; j < appSrc.length; j++) {
    if (appSrc[j] === '{') depth++;
    else if (appSrc[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return appSrc.slice(i, j) + ';';
}
function extractRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('region not found: ' + beginMark);
  return src.slice(a, b + 2);
}
function todayStr(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const TODAY = todayStr();
const TOMORROW = todayStr(new Date(Date.now() + 86400000));
const escFn = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ============ D1 units: the two-sided decision + the bump ============ */
console.log('\n— D1 units: odoSaveDecision / bumpOdometer (real js/app.js code) —');
{
  const sb = { console, localStorage: makeLocal() };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(extractStore(), sb);
  vm.runInContext(extractRegion(appSrc, 'ODO-MASTER-BEGIN', 'ODO-MASTER-END'), sb);
  const D = sb.odoSaveDecision, B = sb.bumpOdometer;
  eq('jump unarmed keeps the master', JSON.stringify(D(519326, 168759, false)), '{"action":"keep","value":168759}');
  eq('jump ARMED is a correction', JSON.stringify(D(519326, 168759, true)), '{"action":"correct","value":519326}');
  eq('exactly +1000 km still sets', JSON.stringify(D(169759, 168759, false)), '{"action":"set","value":169759}');
  eq('+1001 km is a jump (refused unarmed)', JSON.stringify(D(169760, 168759, false)), '{"action":"keep","value":168759}');
  eq('ordinary raise still sets', JSON.stringify(D(168900, 168759, false)), '{"action":"set","value":168900}');
  eq('below unarmed still keeps', JSON.stringify(D(168700, 168759, false)), '{"action":"keep","value":168759}');
  eq('below ARMED still corrects', JSON.stringify(D(168700, 168759, true)), '{"action":"correct","value":168700}');
  sb.store.set('mt_odo', '168759');
  eq('bump refuses a jump (sparse refused key)', JSON.stringify(B(519326)), '{"value":168759,"raised":false,"previous":168759,"refused":"jump"}');
  eq('master untouched by the refused bump', sb.store.get('mt_odo'), '168759');
  eq('bump still raises a plausible value', JSON.stringify(B(168900)), '{"value":168900,"raised":true,"previous":168759}');
  eq('master after the plausible bump', sb.store.get('mt_odo'), '168900');
}

/* ============ D1 drive: the REAL fuel form, the owner's exact case ============ */
console.log('\n— D1 drive: fuel save with 519326 against a 168,759 master —');
{
  const sb = { console, document: docStub, localStorage: makeLocal(), Meticulous: { modules: {} } };
  const fuelAlerts = [];
  sb.alert = m => fuelAlerts.push(String(m));
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(extractStore(), sb);
  vm.runInContext(extractRegion(appSrc, 'ODO-MASTER-BEGIN', 'ODO-MASTER-END'), sb);
  vm.runInContext(extractFn(appSrc, 'function odoMasterNow') + '\n' + extractFn(appSrc, 'function odoImplausible'), sb);
  sb.App = {
    _store: sb.store, _today: () => '2026-10-15', _esc: escFn,
    _masterOdometer: sb.masterOdometer, _bumpOdometer: sb.bumpOdometer,
    _odoImplausible: sb.odoImplausible, _odoSaveDecision: sb.odoSaveDecision,
    _parseOdometerReading: sb.parseOdometerReading
  };
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(fuelSrc, sb);
  sb.store.set('mt_odo', '168759');
  const body = new FakeEl('body');
  sb.Meticulous.modules.fuel.render(body);
  has('form carries the correction door (hidden until the gate trips)', body.innerHTML, 'id="fu_odo_fix"');
  body.querySelector('#fu_l').value = '78.175';
  body.querySelector('#fu_cost').value = '193.80';
  const odoEl = body.querySelector('#fu_odo');
  odoEl.value = '519326'; odoEl.fire('input');
  eq('the door OPENS for the jump value', body.querySelector('#fu_odo_fixrow').style.display, '');
  has('the door explains the jump in plain words', body.querySelector('#fu_odo_fixnote').textContent, 'way past your odometer now');
  body.querySelector('#fu_add').click();
  eq('MASTER NOT POISONED: still 168,759', sb.store.get('mt_odo'), '168759');
  const fills1 = sb.store.get('fuel_fills', []);
  eq('the fill-up still saved', fills1.length, 1);
  eq('the saved fill carries NO odometer reading', fills1[0] && fills1[0].odo, undefined);
  eq('the saved fill kept its litres', fills1[0] && fills1[0].litres, '78.175');
  has('the refusal is said out loud on the form', body.innerHTML, 'Odometer NOT updated');
  has('the refusal names both numbers', body.innerHTML, '519,326');
  /* the armed correction door, from THIS form */
  body.querySelector('#fu_l').value = '78.175';
  body.querySelector('#fu_cost').value = '193.80';
  body.querySelector('#fu_odo').value = '519326';
  body.querySelector('#fu_odo_fix').checked = true;
  body.querySelector('#fu_add').click();
  eq('ARMED: the correction writes through', sb.store.get('mt_odo'), '519326');
  const fills2 = sb.store.get('fuel_fills', []);
  eq('ARMED: the fill kept its reading', fills2[1] && fills2[1].odo, 519326);
  has('ARMED: the outcome is said out loud', body.innerHTML, 'Master odometer corrected to 519,326 km.');
  /* an ordinary save still bumps, in a fresh world */
  const sb2 = { console, document: docStub, localStorage: makeLocal(), Meticulous: { modules: {} } };
  sb2.alert = () => {};
  sb2.window = sb2;
  vm.createContext(sb2);
  vm.runInContext(extractStore(), sb2);
  vm.runInContext(extractRegion(appSrc, 'ODO-MASTER-BEGIN', 'ODO-MASTER-END'), sb2);
  vm.runInContext(extractFn(appSrc, 'function odoMasterNow') + '\n' + extractFn(appSrc, 'function odoImplausible'), sb2);
  sb2.App = {
    _store: sb2.store, _today: () => '2026-10-15', _esc: escFn,
    _masterOdometer: sb2.masterOdometer, _bumpOdometer: sb2.bumpOdometer,
    _odoImplausible: sb2.odoImplausible, _odoSaveDecision: sb2.odoSaveDecision,
    _parseOdometerReading: sb2.parseOdometerReading
  };
  vm.runInContext(ocrSrc, sb2);
  vm.runInContext(fuelSrc, sb2);
  sb2.store.set('mt_odo', '168759');
  const b2 = new FakeEl('body');
  sb2.Meticulous.modules.fuel.render(b2);
  b2.querySelector('#fu_l').value = '50';
  b2.querySelector('#fu_cost').value = '120.00';
  b2.querySelector('#fu_odo').value = '168900';
  b2.querySelector('#fu_add').click();
  eq('an ordinary reading still raises the master', sb2.store.get('mt_odo'), '168900');
  has('the ordinary outcome note is unchanged', b2.innerHTML, 'Master odometer updated to 168,900 km.');
}

/* ============ the chain world: tracker + dispatch + manifest, whole ============ */
function makeChainWorld() {
  const sb = { console, document: docStub, localStorage: makeLocal(), Meticulous: { modules: {} } };
  const alerts = [], revLog = [], sessLog = [];
  sb.alert = m => alerts.push(String(m));
  sb.confirm = () => true;
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(extractStore(), sb);
  sb.App = {
    _store: sb.store, _today: () => TODAY, _esc: escFn,
    userRole: () => 'driver',
    tracker: { status: 'idle', startTs: 0, elapsed: 0 }
  };
  sb.App._store = sb.store;
  vm.runInContext('var trackerPaint = function () {}; var trackerTick = function () {};', sb);
  const fns = [
    'function todayStr', 'function round2', 'function kgFromUnit',
    'function trackerSave', 'function sessionActive', 'function trkAccum',
    'function resetAccum', 'function trackerAddLoadTap', 'function trackerAddTrip',
    'function noteDispatchCompleted', 'function takeSessionAccum',
    'function trackedSecondsAt', 'function trackerSessionStartMs',
    'function ptiStartOdoFor', 'function takePendingStartOdo', 'function takePendingStartOdoPhoto', 'function applyOdoReading', 'function applyEndOdoToEntry',
    'function autostartParseSched', 'function autostartRecordDate', 'function autostartDispatchFor', 'function closeTravelFor',
    'function stopSessionAt'
  ];
  let code = fns.map(m => extractFn(appSrc, m)).join('\n');
  /* v206: takePendingStartOdo's photo stash var lives in the
     ODO-PROMPT region, outside the extracted functions — declare
     it here from the app's own line, or the read throws. */
  code = appSrc.slice(appSrc.indexOf('var _takenStartOdoPhoto'),
    appSrc.indexOf(';', appSrc.indexOf('var _takenStartOdoPhoto')) + 1) + '\n' + code;
  /* v143: stopSessionAt now reads the _endTicketPhoto hand-in
     vars declared directly above it in app.js — extract the
     declaration block too, or the read throws in this world
     (the same sloppy-global accident that used to cover
     _stopViaDispatch no longer covers a READ before write). */
  code = appSrc.slice(appSrc.indexOf('var _stopViaDispatch = false;'),
    appSrc.indexOf('function stopSessionAt')) + '\n' + code;
  code += '\n' + extractRegion(appSrc, 'ODO-MASTER-BEGIN', 'ODO-MASTER-END');
  code += '\n' + extractFn(appSrc, 'App.stopSessionOnDispatchClose = function ()');
  vm.runInContext(code, sb);
  sb.App.noteDispatchCompleted = function (info) { return sb.noteDispatchCompleted(info); };
  vm.runInContext("App.trackerLoadTaps = function () { return App.tracker.status !== 'idle' ? trkAccum().manualLoads : 0; };", sb);
  sb.Meticulous.modules.revenue = {
    addEntry: e => revLog.push(JSON.parse(JSON.stringify(e))),
    onSession: s => sessLog.push(JSON.parse(JSON.stringify(s)))
  };
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(dspSrc, sb);
  vm.runInContext(manSrc, sb);
  const manHead = manSrc.slice(0, manSrc.indexOf('function toggles()'));
  vm.runInContext(manHead + '\nglobalThis.__collect = collect;\n})();', sb);
  sb.store.set('onboarding', { payStandard: 'hourly', payRate: 29, travelBonus: 1 });
  return { sb, store: sb.store, alerts, revLog, sessLog, collect: sb.__collect };
}
function seedActive(w, over) {
  const dsp = Object.assign({
    id: 'dlive1', date: TODAY, scheduledAt: '', jobSite: 'Aecon — 12th Street',
    equipment: 'Tandem', loads: '1', amount: '', netWeight: '', ticketNo: '',
    driverId: '', driverName: '', tickets: [], photo: null, status: 'active'
  }, over || {});
  w.store.set('dsp_list', [JSON.parse(JSON.stringify(dsp))]);
  w.store.set('dsp_active', JSON.parse(JSON.stringify(dsp)));
  return dsp;
}
function startSession(w, secondsAgo) {
  w.sb.App.tracker = { status: 'running', startTs: Date.now() - secondsAgo * 1000, elapsed: 0,
    accum: { weightKg: 0, loadCount: 0, tripCount: 0, manualLoads: 0 } };
  w.sb.trackerSave();
}

/* ============ D2 + D5 + D4b-fallback: one live-shaped day ============ */
console.log('\n— D2/D5/D4b: 2 taps, plain Complete, manifest (no confirmed times) —');
{
  const w = makeChainWorld();
  seedActive(w, {}); /* no scheduledAt, no startedAt — the live drive's shape */
  startSession(w, 30);
  w.sb.trackerAddLoadTap(); w.sb.trackerAddLoadTap();
  eq('the taps counted on the live session', w.sb.trkAccum().manualLoads, 2);
  const body = new FakeEl('body');
  w.sb.Meticulous.modules.dispatch.render(body);
  body.querySelector('#dp_complete').click();
  /* v143 PIN MOVE: plain Complete opens the shared confirm step —
     the drive confirms it (owner, Oct 17 16:22 MDT). */
  body.querySelector('#dp_closeflow').querySelector('#dp_cf_confirm').click();
  const sessions = w.store.get('sessions', []);
  eq('one session record landed', sessions.length, 1);
  eq('the session record carries manualLoads = 2', sessions[0] && sessions[0].manualLoads, 2);
  const closed = w.store.get('dsp_list', [])[0];
  eq('the dispatch closed', closed && closed.status, 'completed');
  eq('the form-default Loads stayed on the record (not a manifest source)', closed && closed.loads, '1');
  /* D5: the feedback */
  eq('exactly one completion alert', w.alerts.length, 1);
  has('D5: the alert carries the shift-closed sentence', w.alerts[0] || '', 'Your shift was closed with it — the tracker is stopped.');
  /* D2: the manifest */
  const c = w.collect(TODAY);
  eq('collect: loads = 2', c.loads, 2);
  eq('collect: loads source = taps', c.loadsSrc, 'taps');
  const bodyM = new FakeEl('body');
  w.sb.Meticulous.modules.manifest.render(bodyM);
  has('preview: the Loads line shows the count', bodyM.innerHTML, '🚛 Loads</span><b>2</b>');
  ok('preview: v291 — the v86 source annotation is GONE (the one Loads line carries the count)', bodyM.innerHTML.indexOf('Counted with the +1 load button') < 0);
  /* D4b fallback: no confirmed time anywhere → labelled tracker fallback */
  eq('collect: start falls back to the tracker', c.startSrc, 'tracker');
  has('preview: the tracker fallback is LABELLED', bodyM.innerHTML, 'from the tracker');
}

/* ============ D5 negative: no session, no sentence ============ */
console.log('\n— D5: Complete with NO running session —');
{
  const w = makeChainWorld();
  seedActive(w, {});
  const body = new FakeEl('body');
  w.sb.Meticulous.modules.dispatch.render(body);
  body.querySelector('#dp_complete').click();
  /* v143 PIN MOVE: plain Complete opens the shared confirm step —
     the drive confirms it (owner, Oct 17 16:22 MDT). */
  body.querySelector('#dp_closeflow').querySelector('#dp_cf_confirm').click();
  /* v185 PIN MOVE (v165 law, owner Oct 18, 2026 21:48 MDT):
     closing a day asks for the day's PTI until one is on file —
     one plain line in the completion alert, never a block. This
     world files no PTI, so the alert is the plain completion
     PLUS that line; the D5-negative point stands — with NO
     session running there is NO shift-closed sentence. */
  eq('the plain completion alert fires (v165: + the PTI ask, no PTI on file here)',
    w.alerts[0], 'Dispatch completed. No PTI filed for ' + TODAY + ' yet — open PTI to file it.');
  ok('no session -> no shift-closed sentence', (w.alerts[0] || '').indexOf('Your shift was closed') === -1);
}

/* ============ D4b priority: scheduled 08:00 wins the manifest Start ============ */
console.log('\n— D4b: dispatch scheduled 08:00 + plain Complete → manifest Start 8:00 AM —');
{
  const w = makeChainWorld();
  seedActive(w, { scheduledAt: TODAY + 'T08:00', startedAt: Date.now() - 3600000 });
  startSession(w, 30);
  const body = new FakeEl('body');
  w.sb.Meticulous.modules.dispatch.render(body);
  body.querySelector('#dp_complete').click();
  /* v143 PIN MOVE: plain Complete opens the shared confirm step —
     the drive confirms it (owner, Oct 17 16:22 MDT). */
  body.querySelector('#dp_closeflow').querySelector('#dp_cf_confirm').click();
  const c = w.collect(TODAY);
  eq('manifest Start is the SCHEDULED 8:00 AM (not the session time)', c.startT, '8:00 AM');
  eq('manifest Start source is the dispatch', c.startSrc, 'dispatch');
  ok('manifest End is present from the close stamp', c.endT !== '—' && c.endSrc === 'dispatch', 'endT=' + c.endT + ' src=' + c.endSrc);
}

/* ============ D3: the manual close door, end-to-end ============ */
console.log('\n— D3: close with ticket, typed by hand (no photo) —');
{
  const w = makeChainWorld();
  seedActive(w, { scheduledAt: TODAY + 'T08:00', startedAt: Date.now() - 3600000 });
  const body = new FakeEl('body');
  w.sb.Meticulous.modules.dispatch.render(body);
  body.querySelector('#dp_close_ticket').click();
  const flow = body.querySelector('#dp_closeflow');
  has('capture step offers the photo door', flow.innerHTML, 'id="dp_ct_cam"');
  has('capture step offers the MANUAL door (v86)', flow.innerHTML, 'id="dp_ct_manual"');
  has('the manual door says what it is', flow.innerHTML, 'Type it instead — no photo');
  flow.querySelector('#dp_ct_manual').click();
  has('confirm view reached empty-handed', flow.innerHTML, 'id="dp_cf_confirm"');
  has('confirm view takes a ticket number (v86)', flow.innerHTML, 'id="dp_cf_ticketno"');
  has('confirm view takes foreman hours', flow.innerHTML, 'id="dp_cf_hours"');
  has('confirm view says it was typed by hand', flow.innerHTML, 'Typed by hand');
  flow.querySelector('#dp_cf_ticketno').value = '21314';
  const hrs = flow.querySelector('#dp_cf_hours');
  hrs.value = '10.5'; hrs.fire('input');
  has('the plan preview prices the typed hours ($333.50)', flow.querySelector('#dp_cf_plan').innerHTML, '$333.50');
  flow.querySelector('#dp_cf_confirm').click();
  const rec = w.store.get('dsp_list', [])[0];
  eq('dispatch completed', rec && rec.status, 'completed');
  eq('one ticket filed', rec && rec.tickets.length, 1);
  eq('the ticket carries the typed number', rec && rec.tickets[0].cardNumber, '21314');
  eq('the ticket carries the typed hours', rec && rec.tickets[0].foremanHours, '10.5');
  ok('the ticket has NO photo (typed, not photographed)', !(rec && rec.tickets[0].photo));
  eq('the ticket is marked as typed by hand', rec && rec.tickets[0].manual, true);
  eq('exactly one Revenue entry logged', w.revLog.length, 1);
  eq('the entry is the foreman + travel money', w.revLog[0] && w.revLog[0].amount, '333.50');
}

/* ============ D3 grouping: confirmed day + tiny auto session entry ============ */
console.log('\n— D3: grouped totals ignore the tiny auto entry beside a confirmed day —');
{
  const mem = {
    onboarding: { payStandard: 'Hourly', payRate: 29 },
    rev_entries: [
      { date: '2026-10-15', type: 'hourly', hours: '11.50', amount: '333.50', note: 'Dispatch: Aecon — 12th Street · foreman + travel = 11.5h', loads: 0 },
      { date: '2026-10-15', type: 'hourly', hours: '0.01', note: 'Auto from tracker', auto: true, loads: 0 }
    ],
    rev_extras: [], sessions: [], fuel_fills: [], dsp_list: []
  };
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); },
    del: function (k) { delete mem[k]; }
  };
  const sb = { console, App: { _store: store, _esc: s => String(s == null ? '' : s), _today: () => '2026-10-15', _odoDailyKm: null, tracker: null } };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext('var Meticulous = window.Meticulous;', sb);
  const hStart = revSrc.indexOf('var S = function');
  const hEnd = revSrc.lastIndexOf('/*', revSrc.indexOf('v38 (B2): paste-import'));
  vm.runInContext(revSrc.slice(hStart, hEnd), sb);
  vm.runInContext(extractRegion(revSrc, 'DAY-DETAIL-BEGIN', 'DAY-DETAIL-END'), sb);
  vm.runInContext('this.__x = { dayAgg, monthSummary };', sb);
  const agg = sb.__x.dayAgg();
  eq('the day counts ONCE at the confirmed $333.50', Math.round((agg['2026-10-15'].amount || 0) * 100) / 100, 333.50);
  eq('the day is NOT flagged unconfirmed', agg['2026-10-15'].unconfirmed, false);
  eq('the month total is the confirmed figure only', Math.round((sb.__x.monthSummary('2026-10').total || 0) * 100) / 100, 333.50);
}

/* ============ D4a: the split form fields ============ */
console.log('\n— D4a: dispatch form date/time fields —');
{
  const w = makeChainWorld();
  const body = new FakeEl('body');
  w.sb.Meticulous.modules.dispatch.render(body);
  has('the form has a date field', body.innerHTML, 'id="dp_date" type="date"');
  has('the form has a time field', body.innerHTML, 'id="dp_time" type="time"');
  ok('no datetime-local remains', body.innerHTML.indexOf('datetime-local') === -1);
  body.querySelector('#dp_site').value = 'Aecon Inf';
  body.querySelector('#dp_time').value = '08:00'; /* a time typed ALONE — the live failure */
  body.querySelector('#dp_add').click();
  const list = w.store.get('dsp_list', []);
  eq('the save landed', list.length, 1);
  eq('a time typed alone saves as TODAY at that time', list[0] && list[0].scheduledAt, TODAY + 'T08:00');
  /* restore: a kept draft's datetime lands split across the pair */
  const w2 = makeChainWorld();
  w2.store.set('dsp_draft', { fields: { jobSite: 'Aecon Inf', scheduledAt: TOMORROW + 'T08:00', equipment: 'Tandem' }, tickets: [] });
  const b2 = new FakeEl('body');
  w2.sb.Meticulous.modules.dispatch.render(b2);
  eq('restored draft: the date field', b2.querySelector('#dp_date').value, TOMORROW);
  eq('restored draft: the time field', b2.querySelector('#dp_time').value, '08:00');
}

console.log('\nlive-drive test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
