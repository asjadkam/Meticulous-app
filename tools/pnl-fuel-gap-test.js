#!/usr/bin/env node
/* Meticulous — P&L FUEL GAP diagnostic suite (Oct 16, 2026).
 *
 * Field discrepancy on the owner's real account: P&L October 2026
 * shows ⛽ Fuel $2,773.12, while a manual sum of the Fuel module's
 * October fill-ups came to $2,329.32 (Δ $443.80), plus an "Other
 * (from Fuel module)" line of $31.69.
 *
 * This suite pins the code-level identity the diagnosis rests on:
 *
 *   P&L fuel(month)      == Σ cost of fuel_fills whose date string
 *                           starts with the month — each entry once.
 *   P&L fuelOther(month) == Σ cost of fuel_expenses in the month —
 *                           a DISJOINT store; a fill can never leak
 *                           into it, nor an expense into fuel.
 *
 * …over an adversarial fixture: out-of-order appends (receipt-photo
 * saves carry the receipt's date, so October fills can sit anywhere
 * in the stored list — the module list renders stored order, NOT
 * date order, and has no month total of its own), duplicate-looking
 * pairs, float-artifact cost strings, datetime-suffixed and
 * non-padded dates, month-boundary fills, and a same-day/same-amount
 * expense beside a fill. It also pins statically that fuel.js is the
 * ONLY writer of fuel_fills and that the module list applies no
 * filter — list and P&L read the one same array.
 *
 * Run: node tools/pnl-fuel-gap-test.js
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
function eq(name, got, want) { ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function extractRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('region not found: ' + beginMark);
  return src.slice(a, b + 2);
}
function memStore(seed) {
  const data = JSON.parse(JSON.stringify(seed || {}));
  return {
    get: function (k, d) { return (k in data) ? data[k] : d; },
    set: function (k, v) { data[k] = v; return true; },
    del: function (k) { delete data[k]; }
  };
}

const invSrc = read('modules/invoice.js');
const pnlSrc = read('modules/pnl.js');
const fuelSrc = read('modules/fuel.js');

function makePnl(seed) {
  const store = memStore(seed);
  const sb = {
    window: {}, Meticulous: { modules: {} }, console: console,
    App: {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s); },
      _today: function () { return '2026-10-16'; }
    }
  };
  vm.createContext(sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(pnlSrc, sb);
  return { pnl: sb.Meticulous.modules.pnl, store: store };
}

/* The reference implementation the diagnosis claims calc() matches:
   a plain prefix-sum over the raw store, written independently here. */
function refFuel(fills, m) {
  return round2((fills || []).reduce(function (s, f) {
    return s + ((f && f.date && String(f.date).indexOf(m) === 0) ? (parseFloat(f.cost) || 0) : 0);
  }, 0));
}

/* ---- Adversarial October fixture ----------------------------------
   Stored (append) order is deliberately NOT date order — this is
   what the module's Fill-ups list renders (reversed), with October
   rows scattered among September/November neighbours.            */
const FILLS = [
  { date: '2026-09-28', cost: '180.00', litres: '75.0', station: 'Mobil Westwinds' },   // Sep — excluded
  { date: '2026-10-02', cost: '210.40', litres: '88.1', station: 'Mobil Westwinds' },   // Oct
  { date: '2026-10-14', cost: 234.32, litres: 94.522, station: 'Mobil Westwinds' },     // Oct (his real fill)
  { date: '2026-09-30', cost: '165.25', litres: '70.0', station: 'Shell' },             // Sep 30 boundary — excluded
  { date: '2026-10-05', cost: '199.91000366210935', litres: '88.10600280761719', station: 'Petro-Canada' }, // Oct, float-artifact strings
  { date: '2026-10-15', cost: 193.80, litres: 78.175, station: 'Mobil Heritage' },      // Oct (his real fill)
  { date: '2026-10-15', cost: 193.80, litres: 78.175, station: 'Mobil Heritage' },      // Oct — duplicate-looking pair: BOTH count
  { date: '2026-11-01', cost: '220.00', litres: '90.0', station: 'Mobil Westwinds' },   // Nov boundary — excluded
  { date: '2026-10-16', cost: 199.91, litres: 88.106, station: 'Petro-Canada Barlow' }, // Oct (his real fill)
  { date: '2026-10-31', cost: '150.00', litres: '62.0', station: 'Costco' },            // Oct 31 boundary — in
  { date: '2026-10-09', cost: '0', litres: '40.0', station: 'Unknown' },                // Oct, zero cost — adds 0
  { date: '2026-10-20T18:10:00', cost: '75.55', litres: '31.0', station: 'Petro-Pass' },// Oct, datetime-suffixed date still prefixes
  { date: '10/14/2026', cost: '999.99', litres: '400', station: 'Legacy import' }       // non-ISO date — NEVER counted (biases P&L DOWN only)
];
const EXPENSES = [
  { date: '2026-10-15', cost: '193.80', what: 'DEF fluid' },  // same day + amount as a fill — separate line, counted once
  { date: '2026-10-03', cost: 31.69, what: 'DEF' },           // matches the field "Other" figure's shape
  { date: '2026-09-15', cost: '50.00', what: 'Washer fluid' }  // Sep — excluded
];

(function () {
  console.log('\n— Fuel identity: P&L fuel == once-each prefix sum over fuel_fills —');
  const w = makePnl({
    onboarding: { payStandard: 'Hourly', payRate: 29 },
    rev_entries: [], rev_extras: [],
    fuel_fills: FILLS, fuel_expenses: EXPENSES,
    pnl_drivers: [], pnl_wage_entries: [], pnl_travel_claims: [], pnl_card_wages: [], pnl_expenses: []
  });
  const c = w.pnl._calc('2026-10');
  const wantFuel = refFuel(FILLS, '2026-10');
  eq('fuel == independent prefix-sum of the same store', round2(c.fuel), wantFuel);
  eq('fuel == hand-summed October entries (210.40+234.32+199.91+193.80+193.80+199.91+150.00+0+75.55)',
    wantFuel, round2(210.40 + 234.32 + 199.91 + 193.80 + 193.80 + 199.91 + 150.00 + 0 + 75.55));
  eq('September fills never leak into October', round2(w.pnl._calc('2026-09').fuel), round2(180.00 + 165.25));
  eq('November boundary fill lands in November only', round2(w.pnl._calc('2026-11').fuel), 220.00);

  console.log('\n— Disjoint lines: fills vs other-expenses can never cross or double —');
  eq('fuelOther == Σ October fuel_expenses (193.80 + 31.69)', round2(c.fuelOther), round2(193.80 + 31.69));
  ok('the same-day/same-amount expense did NOT inflate the fuel line',
    round2(c.fuel) === wantFuel && round2(c.fuel) !== round2(wantFuel + 193.80));
  const c2 = makePnl({
    onboarding: { payStandard: 'Hourly', payRate: 29 },
    rev_entries: [], rev_extras: [], fuel_fills: FILLS, fuel_expenses: [],
    pnl_drivers: [], pnl_wage_entries: [], pnl_travel_claims: [], pnl_card_wages: [], pnl_expenses: []
  }).pnl._calc('2026-10');
  eq('with fuel_expenses empty, fuelOther is 0 and fuel is unchanged',
    round2(c2.fuelOther) + '|' + round2(c2.fuel), '0|' + wantFuel);
})();

(function () {
  console.log('\n— Owner ground truth: the three real fills price to $628.03 —');
  const w = makePnl({
    onboarding: { payStandard: 'Hourly', payRate: 29 },
    rev_entries: [], rev_extras: [],
    fuel_fills: [
      { date: '2026-10-14', cost: 234.32 }, { date: '2026-10-15', cost: 193.80 }, { date: '2026-10-16', cost: 199.91 }
    ],
    fuel_expenses: [], pnl_drivers: [], pnl_wage_entries: [], pnl_travel_claims: [], pnl_card_wages: [], pnl_expenses: []
  });
  eq('Oct 14+15+16 fills == $628.03', round2(w.pnl._calc('2026-10').fuel), 628.03);
})();

(function () {
  console.log('\n— Statics: one writer, one array, no hidden second total —');
  const mods = ['modules/fuel.js', 'modules/pnl.js', 'modules/manifest.js', 'modules/maintenance.js', 'modules/revenue.js', 'modules/dispatch.js', 'modules/invoice.js'];
  const writers = mods.filter(function (p) {
    const s = read(p);
    return /_store\.set\('fuel_fills'|W\('fills'/.test(s);
  });
  eq('fuel_fills is written ONLY by modules/fuel.js', writers.join(','), 'modules/fuel.js');
  ok('pnl.js reads the same key the module writes (fuel_fills)',
    pnlSrc.includes("App._store.get('fuel_fills', [])") && fuelSrc.includes("App._store.get('fuel_' + k, d)"));
  ok('fuel.js writes fills through the verified single-array save (no append-mirror)',
    fuelSrc.includes('saveFillsVerified') && !/fuel_expenses/.test(fuelSrc.slice(fuelSrc.indexOf("querySelector('#fu_add')"), fuelSrc.indexOf("querySelector('#fx_add')"))));
  ok('the Fill-ups list renders EVERY stored fill (stored order reversed, no month filter)',
    fuelSrc.includes('flAll.slice().reverse()') && !/flAll\.filter/.test(fuelSrc));
  ok('no flow writes a fill AND an expense together (no legacy mirror in shipped code)',
    !/saveDoc\('fuel'[\s\S]{0,200}fuel_expenses/.test(fuelSrc + pnlSrc));
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
