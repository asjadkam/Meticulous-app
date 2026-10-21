#!/usr/bin/env node
/* Meticulous v181 — BATCH 3 suite (owner, Oct 20, 2026):
 * D5 REDEFINED (19:53–19:54): P&L keeps ONLY the Monthly analysis —
 * no Connected-crew card, no Driver wages detail card, no Income /
 * Expense breakdown cards, no summary row. D3: custom period.
 * D4: wages across ALL days of the period — local postings AND
 * connected-crew wages, month and custom range alike — priced off
 * the owner's REAL October days (D10 audit figures).
 * Run: node tools/batch3-v181-test.js
 */
'use strict';
const fs = require('fs'); const vm = require('vm'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); } }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
function extractRegion(src, b, e) { const a = src.lastIndexOf('/*', src.indexOf(b)); const c = src.indexOf('*/', src.indexOf(e)); return src.slice(a, c + 2); }
function memStore(seed) { const data = JSON.parse(JSON.stringify(seed || {})); return { get: (k, d) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; return true; }, del: (k) => { delete data[k]; } }; }
const invSrc = read('modules/invoice.js'); const pnlSrc = read('modules/pnl.js');
function makePnl(seed, pipe) {
  const store = memStore(seed);
  const sb = { window: {}, Meticulous: { modules: {} }, console: console, App: { _store: store, _esc: (s) => String(s == null ? '' : s), _today: () => '2026-10-20', userRole: () => 'both' } };
  if (pipe) { sb.window.ConnectPipe = pipe; sb.ConnectPipe = pipe; }
  sb.window.window = sb.window;
  vm.createContext(sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(pnlSrc, sb);
  return { pnl: sb.Meticulous.modules.pnl, store, sb };
}
function makeBody() {
  const els = {};
  function mkEl(key) {
    if (els[key]) return els[key];
    const el = { value: '', textContent: '', innerHTML: '', style: {}, disabled: false, options: [{ text: '' }], selectedIndex: 0, files: [], _attrs: {},
      classList: { toggle: function () {}, add: function () {}, remove: function () {} },
      setAttribute: function (k, v) { el._attrs[k] = v; }, getAttribute: function (k) { return (k in el._attrs) ? el._attrs[k] : null; },
      addEventListener: function () {}, focus: function () {}, scrollIntoView: function () {},
      querySelector: function (sel) { return mkEl(key + '>' + sel); }, querySelectorAll: function () { return []; }, onclick: null, onchange: null };
    els[key] = el; return el;
  }
  const body = { _html: '' };
  Object.defineProperty(body, 'innerHTML', { get: function () { return body._html; }, set: function (v) { body._html = String(v); } });
  body.querySelector = function (sel) { return mkEl('q:' + sel); };
  body.querySelectorAll = function () { return []; };
  return body;
}
/* His real Oct 14–20 (D10 audit): [date, paidH, foremanH, wage] */
const DAYS = [
  ['2026-10-14', 10.5, 9.5, 304.50], ['2026-10-15', 11.5, 10.5, 333.50],
  ['2026-10-16', 11.0, 10.0, 319.00], ['2026-10-17', 10.0, 8.0, 290.00],
  ['2026-10-19', 10.5, 9.5, 304.50], ['2026-10-20', 11.0, 10.0, 319.00]
];
const postings = DAYS.map((d, i) => ({ driverId: 'self', driverName: 'You (owner-operator)', date: d[0], wage: d[3], hours: d[1], foremanHours: d[2], travelHours: d[1] - d[2], dspId: 'dsp-' + i }));
const baseSeed = {
  onboarding: { payStandard: 'hourly', payRate: 29, accountType: 'Owner-Operator', userRole: 'both' },
  pnl_drivers: [], pnl_wage_entries: [], pnl_travel_claims: [], pnl_card_wages: postings,
  rev_entries: DAYS.map((d) => ({ date: d[0], type: 'hourly', hours: String(d[1]), amount: String(d[3]), note: 'Dispatch', foremanHours: d[2], travelHours: d[1] - d[2], travelInIncome: true })),
  rev_extras: [], fuel_fills: [{ date: '2026-10-14', cost: 234.32, litres: 94.522 }, { date: '2026-10-15', cost: 193.80, litres: 78.175 }, { date: '2026-10-16', cost: 199.91, litres: 88.106 }, { date: '2026-10-17', cost: 146.72, litres: 64.096 }, { date: '2026-10-19', cost: 206.60, litres: 0 }, { date: '2026-10-20', cost: 239.18, litres: 104.036 }],
  fuel_expenses: [], pnl_expenses: [], odo_readings: []
};
/* ---- D4: local wages across ALL days ---- */
{
  const { pnl } = makePnl(baseSeed);
  eq('D4 month wages = all 6 days', pnl._driverWages('2026-10').total, 1870.5);
  eq('D4 calc wagesTotal (month)', pnl._calc('2026-10').wagesTotal, 1870.5);
  eq('D4 calc income (month)', pnl._calc('2026-10').income, 1870.5);
  eq('D4 calc fuel (month, duplicate counted once as stored)', pnl._calc('2026-10').fuel, 1220.53);
  eq('D4 range wages = all 6 days', pnl._driverWages('R:2026-10-14:2026-10-20').total, 1870.5);
  eq('D4 range wagesTotal', pnl._calc('R:2026-10-14:2026-10-20').wagesTotal, 1870.5);
  eq('D4 sub-range (14–16) wages', pnl._driverWages('R:2026-10-14:2026-10-16').total, 957);
}
/* ---- D4 crew side: cached shared days price across month AND range ---- */
{
  const pipe = {
    pricingFor: () => ({ wage: { payType: 'hourly', rate: 29 }, client: { payType: 'hourly', rate: 29 } }),
    priceDay: (day) => ({ wage: Math.round(((day.close.foremanHours + day.close.travelHours) * 29) * 100) / 100, revenue: null })
  };
  const seed = JSON.parse(JSON.stringify(baseSeed));
  seed.pnl_card_wages = [];
  seed.__crew_days = { '2026-10': DAYS.map((d) => ({ driver: 'uid-driver', driverName: 'Asjad Kamal', date: d[0], close: { foremanHours: d[2], travelHours: d[1] - d[2] }, loads: 0 })) };
  seed.con_list = [{ uid: 'uid-driver', kind: 'all' }];
  const { pnl } = makePnl(seed, pipe);
  eq('D4 crew wages (month)', pnl._calc('2026-10').crewWages, 1870.5);
  eq('D4 crew wages (range)', pnl._calc('R:2026-10-14:2026-10-20').crewWages, 1870.5);
  eq('D4 crew wages (sub-range 14–16)', pnl._calc('R:2026-10-14:2026-10-16').crewWages, 957);
}
/* ---- D3: period plumbing ---- */
{
  const { pnl } = makePnl(baseSeed);
  eq('D3 periodRange parses', pnl._periodRange('R:2026-10-14:2026-10-20'), { from: '2026-10-14', to: '2026-10-20' });
  ok('D3 inPeriod inside', pnl._inPeriod('2026-10-19', 'R:2026-10-14:2026-10-20') === true);
  ok('D3 inPeriod outside', pnl._inPeriod('2026-10-21', 'R:2026-10-14:2026-10-20') === false);
  ok('D3 month key still works', pnl._inPeriod('2026-10-19', '2026-10') === true);
}
/* ---- D5: the face ---- */
{
  const { pnl } = makePnl(baseSeed);
  const body = makeBody();
  pnl.render(body);
  const h = body.innerHTML;
  ok('D5 Monthly analysis IS there', h.indexOf('Monthly analysis') !== -1);
  ok('D5 analysis carries Total salaries', h.indexOf('Total salaries (driver wages)') !== -1);
  ok('D5 NO Connected crew card', h.indexOf('Connected crew') === -1 && h.indexOf('pnl_crew') === -1);
  ok('D5 NO Driver wages detail card', h.indexOf('Driver wages —') === -1);
  ok('D5 NO Income breakdown card', h.indexOf('Income breakdown') === -1);
  ok('D5 NO Expense breakdown card', h.indexOf('Expense breakdown') === -1);
  ok('D5 NO summary row cards', h.indexOf('Gross income') === -1);
  ok('D5 NO crew record dumps (fuel lists / receipt rows)', h.indexOf('His fuel') === -1 && h.indexOf('data-pnlphoto') === -1 && h.indexOf('data-pnlinv') === -1);
  ok('D3 custom-dates picker on the face', h.indexOf('id="pnl_from"') !== -1 && h.indexOf('id="pnl_usedates"') !== -1);
}
console.log('batch3-v181: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
