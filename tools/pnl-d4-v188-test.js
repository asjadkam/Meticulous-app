#!/usr/bin/env node
/* Meticulous v188 — D4: P&L Monthly analysis aggregation
 * (owner, Oct 21, 2026 07:22 MDT, his own screenshot): October's
 * Monthly analysis showed Total salaries $623.50 — impossible:
 * Oct 14–20 wages alone are $1,870.50 (D10 audit) — and Total
 * fuel $3,365.62 still carried the duplicated Oct 15 Mobil
 * $193.80 the audit excluded.
 *
 * The law under test:
 *  - Total salaries = the sum over ALL days in the period of
 *    (paid hours × the day's wage) — priced off the SAME shared
 *    per-day builder that prices income, so the two can never
 *    split. Card-wage postings for the owner's own days price
 *    those days inside driverWages too; they must not double.
 *  - Total fuel excludes a duplicated fill-up: same date +
 *    station + amount + litres recorded twice counts once.
 *  - Revenue is untouched: October still reconciles to the
 *    audit's $4,843.00 on 167.0 paid hours.
 *
 * Fixtures are the audit's own figures (connect-pnl-audit-oct20):
 * Oct 14–20 per the per-day table; Oct 1–13 as the audit's
 * verified aggregate (102.5 paid h = $2,972.50, invoice #1151),
 * spread as ten 10.25 h days.
 * Run: node tools/pnl-d4-v188-test.js
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
const idxSrc = read('index.html'); const ver = JSON.parse(read('version.json'));
function makePnl(seed) {
  const store = memStore(seed);
  const sb = { window: {}, Meticulous: { modules: {} }, console: console, App: { _store: store, _esc: (s) => String(s == null ? '' : s), _today: () => '2026-10-21', userRole: () => 'both' } };
  sb.window.window = sb.window;
  vm.createContext(sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(pnlSrc, sb);
  return sb.Meticulous.modules.pnl;
}

/* The audit's Oct 14–20: [date, paidH, foremanH, wage] */
const DAYS = [
  ['2026-10-14', 10.5, 9.5, 304.50], ['2026-10-15', 11.5, 10.5, 333.50],
  ['2026-10-16', 11.0, 10.0, 319.00], ['2026-10-17', 10.0, 8.0, 290.00],
  ['2026-10-19', 10.5, 9.5, 304.50], ['2026-10-20', 11.0, 10.0, 319.00]
];
/* Oct 1–13 aggregate (audit, invoice #1151): 102.5 h = $2,972.50 */
const EARLY = [];
for (let i = 0; i < 10; i++) {
  EARLY.push(['2026-10-' + ('0' + (i + 1)).slice(-2), 10.25, 9.25, 297.25]);
}
function entry(d) {
  return { date: d[0], type: 'hourly', hours: String(d[1]), amount: String(d[3]),
    note: 'Dispatch', foremanHours: d[2], travelHours: d[1] - d[2], travelInIncome: true };
}
const AUDIT_FUEL = [
  { date: '2026-10-14', station: 'Mobil', cost: 234.32, litres: 94.522, odo: 168759 },
  { date: '2026-10-15', station: 'Mobil', cost: 193.80, litres: 78.175, odo: 168936 },
  { date: '2026-10-16', station: 'Petro-Canada', cost: 199.91, litres: 88.106, odo: 169166 },
  { date: '2026-10-17', station: 'Petro-Canada', cost: 146.72, litres: 64.096, odo: 169300 },
  { date: '2026-10-19', station: '', cost: 206.60, litres: 0 },
  { date: '2026-10-20', station: 'Petro-Canada', cost: 239.18, litres: 104.036, odo: 169775 }
];
/* the audit's finding 1: the Oct 15 fill, recorded a second time,
   its copy carrying the receipt invoice number as the odometer */
const DUP = { date: '2026-10-15', station: 'Mobil', cost: 193.80, litres: 78.175, odo: 519326 };

function seedWith(postingDates, fills) {
  return {
    onboarding: { payStandard: 'hourly', payRate: 29, ownWageRate: 29, accountType: 'Driver', userRole: 'both' },
    pnl_drivers: [], pnl_wage_entries: [], pnl_travel_claims: [],
    pnl_card_wages: DAYS.concat(EARLY).filter((d) => postingDates.indexOf(d[0]) >= 0)
      .map((d, i) => ({ driverId: 'self', driverName: 'You (owner-operator)', date: d[0], wage: d[3], hours: d[1], foremanHours: d[2], travelHours: d[1] - d[2], dspId: 'dsp-' + d[0] })),
    rev_entries: DAYS.concat(EARLY).map(entry),
    rev_extras: [], fuel_fills: fills, fuel_expenses: [], pnl_expenses: [], odo_readings: []
  };
}

/* ---- his phone's shape: postings for only TWO days (the $623.50
   symptom) + the duplicated fill in the list ---- */
{
  const pnl = makePnl(seedWith(['2026-10-14', '2026-10-16'], AUDIT_FUEL.concat([DUP])));
  const c = pnl._calc('2026-10');
  eq('revenue (month) reconciles to the audit', c.income, 4843);
  eq('Total salaries (month) = ALL days priced, not just posted days', c.wagesTotal, 4843);
  eq('Total fuel (month) excludes the duplicate fill', c.fuel, 1220.53);
  ok('expenses add up off the same wages figure',
    Math.abs(c.expenses - (c.fuel + c.fuelOther + c.biz + c.detailTotal + c.wagesTotal)) < 0.005,
    'got ' + c.expenses);
  const r = pnl._calc('R:2026-10-14:2026-10-20');
  eq('range Oct 14–20 salaries = the audit window', r.wagesTotal, 1870.5);
  eq('range Oct 14–20 fuel = the audit window, deduped', r.fuel, 1220.53);
  eq('range Oct 14–20 revenue', r.income, 1870.5);
}
/* ---- the v181 fixture shape: postings for EVERY day — the total
   must not move (no double count through the new path) ---- */
{
  const pnl = makePnl(seedWith(DAYS.concat(EARLY).map((d) => d[0]), AUDIT_FUEL));
  eq('all-days-posted: salaries unchanged', pnl._calc('2026-10').wagesTotal, 4843);
  eq('all-days-posted: fuel unchanged (no duplicate stored)', pnl._calc('2026-10').fuel, 1220.53);
}
/* ---- no postings at all: the days still price ---- */
{
  const pnl = makePnl(seedWith([], AUDIT_FUEL));
  eq('no postings: salaries still = all days', pnl._calc('2026-10').wagesTotal, 4843);
}
/* ---- a genuinely different second fill the same day survives:
   same station, same day, DIFFERENT amount is a different fill ---- */
{
  const fills = AUDIT_FUEL.concat([DUP, { date: '2026-10-15', station: 'Mobil', cost: 50.00, litres: 20.161, odo: 168950 }]);
  const pnl = makePnl(seedWith([], fills));
  eq('a different second fill still counts', pnl._calc('2026-10').fuel, 1270.53);
}

eq('ships as webVersion 188', ver.webVersion, 245);
ok('index loads pnl at the 199 pin', idxSrc.indexOf('modules/pnl.js?v=245') !== -1);

console.log('\npnl-d4 v188: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
