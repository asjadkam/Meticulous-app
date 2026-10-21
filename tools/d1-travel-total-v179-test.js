#!/usr/bin/env node
/* Meticulous v179 — D1: THE DAY TOTAL IS THE PAID TOTAL (owner,
 * Oct 20, 2026, over his own Oct 19: the Revenue preview read
 * Hours 9.5 / $275.50 for a day the Manifest preview called
 * "Foreman total: 9.5h + travel 1h = 10.5h paid" — the travel
 * hour had dropped out of the money).
 *
 * One formula everywhere: paid hours (foreman + travel) × wage.
 * Pins:
 *  (a) the close plan, single-rate owner-operator (billing rate
 *      === wage rate): the entry IS the paid total — 10.5h,
 *      $304.50, travelInIncome true — and the wage posting is the
 *      same $304.50, so the two books can never split.
 *  (b) the close plan, genuinely two-rate (billing 93, wage 29):
 *      the v105 split stands untouched — entry foreman-only
 *      $883.50 billed, posting (fh+th) × 29 = $304.50 of pay.
 *  (c) the shared builder heal for days closed BEFORE the fix:
 *      Oct 19's stored records (entry $275.50 held-out + self
 *      posting $304.50) build to a $304.50 line with dayHours
 *      10.5 — Revenue chart/preview, invoice, manifest and P&L
 *      all read this builder, so they agree by construction.
 *  (d) the heal's guards: a two-rate day's billed line never
 *      moves; a held-out day with NO self posting never moves;
 *      an office-routed posting (another driver's) never heals
 *      the boss's own line; a day already carrying travel in
 *      income is untouched; without postings the builder behaves
 *      exactly as before v179.
 *  (e) the uplift helper itself, on the worked example.
 * Run: node tools/d1-travel-total-v179-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* ---------- the close plan (real DSP-COMPLETE region) ---------- */
function extractRegion(src, beginMark, endMark) {
  const bi = src.indexOf(beginMark), ei = src.indexOf(endMark);
  if (bi === -1 || ei === -1) throw new Error('region markers missing');
  return src.slice(bi, ei);
}
const dspSrc = read('modules/dispatch.js');
const planSandbox = { console: console, Math: Math, JSON: JSON, window: {} };
vm.createContext(planSandbox);
vm.runInContext(extractRegion(dspSrc, '/* ================= DSP-COMPLETE-BEGIN =================', '/* ================= DSP-COMPLETE-END ================='), planSandbox);
const dspCompletionPlan = planSandbox.dspCompletionPlan;
check('plan region loads', typeof dspCompletionPlan === 'function');

const SUM = { totalForemanHours: 9.5, travelBonus: 1, totalPaidHours: 10.5, breakdown: [], totalNetWeight: 0 };
function planFor(over) {
  const x = {
    sum: SUM, std: 'hourly', rate: 29, role: 'both', date: '2026-10-19',
    jobSite: 'Aecon Inf', ticketCount: 7, travelBonusRaw: 1, driver: null,
    billingRate: 29, wageRate: 29, jobRate: 0,
    legacyAmount: null, legacyNetWeight: null, loads: null, ticketNo: null
  };
  Object.keys(over || {}).forEach(function (k) { x[k] = over[k]; });
  return dspCompletionPlan(x);
}

console.log('— close plan: single-rate owner-operator —');
{
  const p = planFor({});
  eq('a: mode', p.mode, 'both-books');
  eq('a: entry amount is the PAID total (10.5 × 29)', p.entry.amount, '304.50');
  eq('a: entry hours are the PAID hours', p.entry.hours, '10.50');
  eq('a: travel is in income', p.entry.travelInIncome, true);
  eq('a: split fields kept', [p.entry.foremanHours, p.entry.travelHours], [9.5, 1]);
  check('a: note names foreman + travel = paid', p.entry.note.indexOf('foreman 9.5h + travel 1h = 10.5h') >= 0, p.entry.note);
  eq('a: wage posting is the same money', p.wagePosting.wage, 304.5);
  eq('a: wage posting hours', p.wagePosting.hours, 10.5);
}
console.log('— close plan: two-rate owner-operator (v105 split stands) —');
{
  const p = planFor({ billingRate: 93, wageRate: 29 });
  eq('b: entry stays foreman-only billing (9.5 × 93)', p.entry.amount, '883.50');
  eq('b: entry hours stay foreman', p.entry.hours, '9.50');
  eq('b: travel still held out of the billed entry', p.entry.travelInIncome, false);
  check('b: note still says travel is the wage cost', p.entry.note.indexOf('not billed — it is your wage cost') >= 0, p.entry.note);
  eq('b: wage posting still the full paid wage', p.wagePosting.wage, 304.5);
}
console.log('— close plan: driver role untouched —');
{
  const p = planFor({ role: 'driver', billingRate: 0, wageRate: 0 });
  eq('driver: entry is foreman + travel at the rate', p.entry.amount, '304.50');
  eq('driver: no wage posting', p.wagePosting, null);
}

/* ---------- the shared builder + heal (real invoice.js) ---------- */
function makeStore(mem) {
  return {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); },
    del: function (k) { delete mem[k]; }
  };
}
const invSandbox = {
  console: console, Math: Math, Date: Date, JSON: JSON, setTimeout: setTimeout,
  Meticulous: { modules: {} },
  App: { _store: makeStore({}), _today: function () { return '2026-10-20'; },
         _esc: function (s) { return String(s == null ? '' : s); } }
};
invSandbox.window = invSandbox;
vm.createContext(invSandbox);
vm.runInContext(read('modules/invoice.js'), invSandbox);
const build = invSandbox.Meticulous.shared.buildRevenueLines;
const uplift = invSandbox.Meticulous.shared.daySelfWageUplift;
check('builder loads', typeof build === 'function');
check('uplift helper is shared', typeof uplift === 'function');

const OCT19_ENTRY = {
  date: '2026-10-19', amount: '275.50', hours: '9.50', type: 'hourly', loads: 7,
  foremanHours: 9.5, travelHours: 1, travelInIncome: false,
  note: 'Dispatch: Aecon Inf · foreman 9.5h billed @ $29/h · travel 1.0h not billed — it is your wage cost'
};
const SELF_POSTING = {
  date: '2026-10-19', driverId: 'self', driverName: 'You (owner-operator)',
  foremanHours: 9.5, travelHours: 1, hours: 10.5, rate: 29, wage: 304.5,
  source: 'dispatch', jobSite: 'Aecon Inf'
};

console.log('— builder heal: the Oct 19 worked example —');
{
  const built = build([OCT19_ENTRY], [], 29, 'hourly', [SELF_POSTING]);
  eq('c: one line for the day', built.lines.length, 1);
  eq('c: line amount is the PAID total', built.lines[0].amt, 304.5);
  eq('c: day hours are the PAID hours', built.dayHours['2026-10-19'], 10.5);
  check('c: line desc reads 10.5 hrs', built.lines[0].desc.indexOf('10.5 hrs @ $29') === 0, built.lines[0].desc);
  eq('c: type totals carry the healed amount', built.typeTotals.hourly, 304.5);
}
console.log('— builder heal: guards —');
{
  const twoRate = Object.assign({}, OCT19_ENTRY, { amount: '883.50', note: 'Dispatch: Aecon Inf · foreman 9.5h billed @ $93/h · travel 1.0h not billed — it is your wage cost' });
  const b1 = build([twoRate], [], 29, 'hourly', [SELF_POSTING]);
  eq('d: two-rate billed line never moves', b1.lines[0].amt, 883.5);
  eq('d: two-rate day hours stay foreman', b1.dayHours['2026-10-19'], 9.5);

  const b2 = build([OCT19_ENTRY], [], 29, 'hourly', []);
  eq('d: no posting → no heal', b2.lines[0].amt, 275.5);
  eq('d: no posting → hours stay foreman', b2.dayHours['2026-10-19'], 9.5);

  const b3 = build([OCT19_ENTRY], [], 29, 'hourly');
  eq('d: postings argument omitted → legacy behaviour', b3.lines[0].amt, 275.5);

  const crewPosting = Object.assign({}, SELF_POSTING, { driverId: 'driver-123', driverName: 'Crew Driver' });
  const b4 = build([OCT19_ENTRY], [], 29, 'hourly', [crewPosting]);
  eq("d: another driver's posting never heals my line", b4.lines[0].amt, 275.5);

  const inIncome = Object.assign({}, OCT19_ENTRY, { amount: '304.50', hours: '10.50', travelInIncome: true });
  const b5 = build([inIncome], [], 29, 'hourly', [SELF_POSTING]);
  eq('d: travel already in income → untouched', b5.lines[0].amt, 304.5);
  eq('d: ...and its hours untouched', b5.dayHours['2026-10-19'], 10.5);
}
console.log('— uplift helper: the worked example —');
{
  eq('e: uplift = posting − held entry', uplift([OCT19_ENTRY], [SELF_POSTING], '2026-10-19'), 29);
  eq('e: no held entry → 0', uplift([], [SELF_POSTING], '2026-10-19'), 0);
  eq('e: no posting → 0', uplift([OCT19_ENTRY], [], '2026-10-19'), 0);
  eq('e: other date → 0', uplift([OCT19_ENTRY], [SELF_POSTING], '2026-10-18'), 0);
}

console.log('d1-travel-total-v179 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
