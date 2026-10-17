#!/usr/bin/env node
/* Meticulous v105 — P&L FLAWLESS suite (owner build order, Oct 16,
 * 2026: "P&L is flawless", plus the haul card's DOUBLE DUTY for
 * owner-operators — one closed card posts as BOTH revenue and
 * expense, correctly, on the right books).
 *
 * Runs the REAL shipped code: the INV-CYCLE region of
 * modules/invoice.js (the shared per-day builder P&L now prices
 * income with), the DSP-COMPLETE region of modules/dispatch.js
 * (the completion money plan + the card-wage merge), and
 * modules/pnl.js loaded whole over an in-memory store, exercised
 * through its own _calc / _driverWages hooks.
 * Run: node tools/pnl-flawless-test.js
 *
 * Ground truth (the owner's real October):
 *  - completions Oct 1–15 = $3,610.50 (124.5 h) — invoice #1151;
 *    Oct 16 = $319.00 (11 h paid: foreman 10 + travel 1, card #22729).
 *  - the Oct 16 POISON: the same day ALSO holds a tracker entry of
 *    9.75h / $282.75 — $319.00 + $282.75 = $601.75 is the manifest
 *    double-count that must never appear in these books.
 *  - fuel on file: Oct 14 $234.32, Oct 15 $193.80, Oct 16 $199.91.
 *
 * The four double-duty cases (owner, Oct 16, 18:58):
 *  1. driver completer → income = (foreman + travel) × rate.
 *  2. office/payer side of the SAME card → revenue = foreman ONLY
 *     × billing rate; expense = (foreman + travel) × driver wage.
 *  3. owner-operator (both) → BOTH postings in his P&L from the
 *     single card, rates independent per side.
 *  4. never twice on one side: postings are keyed by dispatch and
 *     applied with replace semantics.
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
const dspSrc = read('modules/dispatch.js');
const pnlSrc = read('modules/pnl.js');

/* A P&L world: shared builder published, pnl.js loaded whole. */
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
  /* The region publishes Meticulous.shared on the context global
     (the same object pnl.js reads); sb.window.Meticulous is a
     separate stub here — do NOT copy from it. */
  vm.runInContext(pnlSrc, sb);
  return { pnl: sb.Meticulous.modules.pnl, shared: sb.Meticulous.shared, store: store };
}
function makePlan() {
  const sb = { console: console };
  vm.createContext(sb);
  vm.runInContext(extractRegion(dspSrc, 'DSP-COMPLETE-BEGIN', 'DSP-COMPLETE-END'), sb);
  return sb;
}

/* ------- the owner's real October entries, as stored ------- */
function completion(date, hours, amount, note) {
  return { date: date, type: 'hourly', hours: hours, amount: String(amount), note: note || ('Dispatch: Aecon · foreman + travel = ' + hours + 'h'), loads: 0 };
}
function tracker(date, hours, amount) {
  return { date: date, type: 'hourly', hours: hours, amount: String(amount), note: 'Auto from tracker', auto: true, loads: 0 };
}
const OCT_ENTRIES = [
  completion('2026-10-01', 10.5, 304.50), completion('2026-10-02', 11, 319.00),
  completion('2026-10-03', 9, 261.00), completion('2026-10-05', 10.5, 304.50),
  completion('2026-10-06', 11.5, 333.50), completion('2026-10-07', 11.5, 333.50),
  completion('2026-10-08', 12.5, 362.50), completion('2026-10-09', 14.5, 420.50),
  completion('2026-10-13', 11.5, 333.50),
  completion('2026-10-14', 10.5, 304.50), tracker('2026-10-14', 9.63, 279.27),
  completion('2026-10-15', 11.5, 333.50), tracker('2026-10-15', 10.04, 291.16),
  /* Oct 16: the closed dispatch AND its still-running tracker shadow */
  { date: '2026-10-16', type: 'hourly', hours: 11, amount: '319.00',
    note: 'Dispatch: Aecon Inf · foreman 10h + travel 1h = 11h (Ticket #22729: 10h)',
    loads: 1, dspId: 'dsp-oct16', foremanHours: 10, travelHours: 1, travelInIncome: true, ticketNos: ['22729'] },
  tracker('2026-10-16', 9.75, 282.75)
];
const OCT_FUEL = [
  { date: '2026-10-14', cost: 234.32, litres: 94.522, station: 'Mobil Westwinds' },
  { date: '2026-10-15', cost: 193.80, litres: 78.175, station: 'Mobil Heritage' },
  { date: '2026-10-16', cost: 199.91, litres: 88.106, station: 'Petro-Canada Barlow' }
];

/* ================= World A — the owner's October (case 1) ============ */
(function () {
  console.log('\n— World A: owner October, driver books —');
  const w = makePnl({
    onboarding: { payStandard: 'Hourly', payRate: 29 },
    rev_entries: OCT_ENTRIES, rev_extras: [], fuel_fills: OCT_FUEL, fuel_expenses: [],
    pnl_drivers: [], pnl_wage_entries: [], pnl_travel_claims: [], pnl_card_wages: [], pnl_expenses: []
  });
  const c = w.pnl._calc('2026-10');
  eq('A income: grouped October truth $3,929.50 (3,610.50 + 319.00)', round2(c.income), 3929.50);
  eq('A income: NOT the poisoned raw sum', round2(c.income) !== round2(3929.50 + 282.75 + 279.27 + 291.16), true);
  eq('A income by type: hourly carries it all', round2(c.incomeByType.hourly), 3929.50);
  eq('A fuel: the three receipts land automatically ($628.03)', round2(c.fuel), 628.03);
  eq('A expenses = exact sum of their lines', round2(c.fuel + c.fuelOther + c.biz + c.wages + c.detailTotal), round2(c.expenses));
  eq('A net = income − expenses, to the cent', round2(c.income - c.expenses), round2(c.net));
  const brk = c.detail.filter(function (r) { return r.key === 'brokerage'; })[0];
  eq('A detail autos price off GROUPED income (brokerage 10% = $392.95)', round2(brk.amount), 392.95);

  /* The Oct 16 day itself, through the same builder P&L uses: */
  const plan = w.shared.buildRevenueLines(OCT_ENTRIES, [], 29, 'hourly');
  const d16 = plan.lines.filter(function (l) { return l.date === '2026-10-16'; });
  eq('A Oct 16: exactly ONE line for the day', d16.length, 1);
  eq('A Oct 16: the line is the completion $319.00 — never $601.75', d16[0].amt, 319);
  const sumTo = function (pred) { return round2(plan.lines.filter(pred).reduce(function (s, l) { return s + l.amt; }, 0)); };
  eq('A Oct 1–15 lines reconcile to invoice #1151: $3,610.50', sumTo(function (l) { return l.date <= '2026-10-15'; }), 3610.50);
  eq('A Oct 16–31 lines reconcile to the new cycle: $319.00', sumTo(function (l) { return l.date >= '2026-10-16'; }), 319);
})();

/* ================= World B — the payer's books (case 2) =============== */
(function () {
  console.log('\n— World B: office/payer side of the same card —');
  const w = makePnl({
    onboarding: { payStandard: 'Hourly', payRate: 29 },
    rev_entries: [
      /* the office completion: foreman 10h only × $29 billing */
      { date: '2026-10-16', type: 'hourly', hours: 10, amount: '290.00', loads: 1, dspId: 'dspA',
        foremanHours: 10, travelHours: 1, travelInIncome: false,
        note: 'Dispatch: Aecon Inf · foreman 10h · travel 1.0h not in income (office — it is the driver\u2019s wage)' }
    ],
    rev_extras: [], fuel_fills: [], fuel_expenses: [],
    pnl_drivers: [{ id: 'd1', name: 'Umar', payType: 'hourly', rate: 27, travelHours: 1, start: '2026-09' }],
    pnl_wage_entries: [
      { id: 'w1', date: '2026-10-15', driverId: 'd1', qty: 10, unit: 'hrs', rate: 27, wage: 270 }
    ],
    pnl_travel_claims: [
      /* a v52-era claim for the SAME dispatch the posting now covers */
      { id: 'tcOld', date: '2026-10-16', driverId: 'd1', hours: 1, rate: 27, wage: 27, source: 'dispatch', dispatchId: 'dspA' }
    ],
    pnl_card_wages: [
      { id: 'cw_dspA', dspId: 'dspA', date: '2026-10-16', driverId: 'd1', driverName: 'Umar',
        foremanHours: 10, travelHours: 1, hours: 11, rate: 27, wage: 297, source: 'dispatch' }
    ],
    pnl_expenses: []
  });
  const c = w.pnl._calc('2026-10');
  eq('B revenue: foreman ONLY × billing rate = $290.00 (travel never billed)', round2(c.income), 290);
  const dw = w.pnl._driverWages('2026-10');
  eq('B card pay: posting lands whole — (10 + 1)h × $27 = $297.00', dw.per.d1.cardWage, 297);
  ok('B card pay: itemized on the driver\u2019s line', dw.per.d1.cardDetail.indexOf('card pay 11h (foreman 10h + travel 1h)') !== -1, dw.per.d1.cardDetail);
  eq('B travel: legacy claim for the SAME dispatch NOT counted again', dw.per.d1.travelWage, 27);
  eq('B wages total: logged 270 + computed travel 27 + card 297 = $594.00', dw.total, 594);
  eq('B wages flow into calc', round2(c.wages), 594);
})();

/* ================= World C — owner-operator (case 3) ================ */
(function () {
  console.log('\n— World C: owner-operator, both postings, split rates —');
  const w = makePnl({
    onboarding: { payStandard: 'Hourly', payRate: 29 },
    rev_entries: [
      /* the 'both' completion: foreman 10h × $40 billing */
      { date: '2026-10-16', type: 'hourly', hours: 10, amount: '400.00', loads: 1, dspId: 'dspB',
        foremanHours: 10, travelHours: 1, travelInIncome: false,
        note: 'Dispatch: Aecon Inf · foreman 10h billed @ $40/h (Card #22729: 10h) · travel 1.0h not billed — it is your wage cost' }
    ],
    rev_extras: [], fuel_fills: [], fuel_expenses: [],
    pnl_drivers: [], pnl_wage_entries: [], pnl_travel_claims: [],
    pnl_card_wages: [
      { id: 'cw_dspB', dspId: 'dspB', date: '2026-10-16', driverId: 'self', driverName: 'You (owner-operator)',
        foremanHours: 10, travelHours: 1, hours: 11, rate: 29, wage: 319, source: 'dispatch' }
    ],
    pnl_expenses: []
  });
  const c = w.pnl._calc('2026-10');
  eq('C revenue line: 10h × $40 billing = $400.00', round2(c.income), 400);
  eq('C expense line: 11h × $29 wage = $319.00', round2(c.wages), 319);
  eq('C both lines exposed: self row carries the card pay', c.wagesByDriver.self.cardWage, 319);
  eq('C self row is named for the owner-operator view', c.wagesByDriver.self.name, 'You (owner-operator)');
  eq('C gross margin on the card: $400 − $319 = $81.00', round2(c.income - c.wages), 81);
})();

/* ================= Case 4 — never twice on one side =================== */
(function () {
  console.log('\n— Case 4: replace, never duplicate —');
  const dsp = makePlan();
  const merge = dsp.dspMergeCardWages;
  ok('merge helper exists in DSP-COMPLETE', typeof merge === 'function');
  const v1 = { dspId: 'dspX', date: '2026-10-16', driverId: 'self', hours: 11, wage: 310.50 };
  const v2 = { dspId: 'dspX', date: '2026-10-16', driverId: 'self', hours: 11, wage: 319 };
  let list = merge([], v1);
  list = merge(list, v2);
  eq('re-completing a card: still ONE posting', list.length, 1);
  eq('re-completing a card: the corrected wage wins', list[0].wage, 319);
  list = merge(list, { dspId: 'dspY', date: '2026-10-17', driverId: 'self', hours: 11, wage: 319 });
  eq('a different dispatch: a second posting is legitimate', list.length, 2);

  /* The write path is keyed end to end (source pins): */
  ok('applyCompletion stamps the entry with its dispatch id', dspSrc.indexOf('revEntry.dspId = cur.id') !== -1);
  ok('applyCompletion applies the posting through the merge', dspSrc.indexOf('dspMergeCardWages(App._store.get(\'pnl_card_wages\'') !== -1);
  ok('revenue.addEntry replaces a same-dispatch entry', read('modules/revenue.js').indexOf('x.dspId !== e.dspId') !== -1);
  ok('revenue.addEntry keeps the split fields on the stored entry',
    read('modules/revenue.js').indexOf('entry.foremanHours = e.foremanHours') !== -1 &&
    read('modules/revenue.js').indexOf('entry.ticketNos = e.ticketNos.slice()') !== -1);

  /* Driver case at plan level (case 1 restated where it is priced): */
  const plan = dsp.dspCompletionPlan;
  const sum = { ticketCount: 1, totalForemanHours: 10, travelBonus: 1, totalPaidHours: 11, totalNetWeight: 0,
    breakdown: [{ index: 1, label: 'Card #22729', type: 'haul_card', foremanHours: 10, paymentUnit: null, netWeight: null }] };
  const base = { sum: sum, std: 'hourly', rate: 29, date: '2026-10-16', jobSite: 'Aecon Inf', ticketCount: 1, travelBonusRaw: 1, driver: null, legacyAmount: '', legacyNetWeight: '', loads: '1', ticketNo: '' };
  const pd = plan(Object.assign({}, base, { role: 'driver' }));
  eq('case 1 plan: driver income = (10 + 1)h × $29 = $319.00', pd.entry.amount, '319.00');
  eq('case 1 plan: no wage posting on a driver\u2019s own books', pd.wagePosting, null);
  const po = plan(Object.assign({}, base, { role: 'office', driver: { id: 'd1', name: 'Umar', rate: 27 } }));
  eq('case 2 plan: revenue = 10h × $29 = $290.00', po.entry.amount, '290.00');
  eq('case 2 plan: wage posting = 11h × $27 = $297.00', po.wagePosting.wage, 297);
})();

/* ---------- v118: P&L total miles — never a poisoned max−min ----------
   The soak's October P&L showed "Total miles 350,816" against a
   169,166 master: the old max−min over the month's fill stamps
   still trusted the poisoned Oct 15 stamp (519,326 — a receipt
   invoice number) as the max: 519,326 − 168,510 = 350,816.
   Total miles is now the SUM of the month's plausible odometer
   legs between consecutive readings (forward, ≤ 50,000 km —
   the v109 leg rule); the legs into and out of a poisoned stamp
   both fail it, so the stamp contributes nothing. */
{
  const pnlSrc = fs.readFileSync(path.join(ROOT, 'modules', 'pnl.js'), 'utf8');
  function xFn(src, name) {
    const i = src.indexOf('function ' + name + '(');
    if (i === -1) throw new Error('fn not found: ' + name);
    let depth = 0, j = src.indexOf('{', i);
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
    }
    throw new Error('fn unbalanced: ' + name);
  }
  const mem = { fuel_fills: [], rev_entries: [] };
  const sb = {
    console: console,
    App: { _store: { get: (k, d) => (k in mem ? mem[k] : d), set: (k, v) => { mem[k] = v; } } }
  };
  sb.window = sb;
  const vm2 = require('vm');
  vm2.createContext(sb);
  vm2.runInContext(
    'var S = function (k, d) { return App._store.get(\'pnl_\' + k, d); };\n' +
    xFn(pnlSrc, 'inMonth') + '\n' + xFn(pnlSrc, 'totalMiles') + '\n__tm = totalMiles;', sb);
  const tm = sb.__tm;
  mem.fuel_fills = [
    { date: '2026-10-03', odo: '168510' },
    { date: '2026-10-14', odo: '168759' },
    { date: '2026-10-15', odo: '519326' },
    { date: '2026-10-16', odo: '169166' }
  ];
  eq('v118 miles: the poisoned stamp contributes nothing — October total is the honest legs only', tm('2026-10'), 249);
  ok('v118 miles: the total is a plausible four-figure-class number, not 350,816', tm('2026-10') < 10000 && tm('2026-10') !== 350816);
  mem.fuel_fills = [
    { date: '2026-10-03', odo: '168510' },
    { date: '2026-10-14', odo: '168759' },
    { date: '2026-10-16', odo: '169166' }
  ];
  eq('v118 miles: clean data still telescopes to last − first (656 km)', tm('2026-10'), 656);
  mem['pnl_miles_2026-10'] = '1234';
  eq('v118 miles: a manual override still wins outright', tm('2026-10'), 1234);
  delete mem['pnl_miles_2026-10'];
}

/* ---------- v120: Connect a driver (owner, Oct 16 22:00) ----------
   The Add-driver flow gains two doors: Connect (primary) and
   manual (quiet secondary, unchanged). The Connect pipe today
   is Phase-1/local ONLY (connect.js's own header), so the
   pending state must say so in plain words — never a fake
   "invite sent / connected". What ships: the pending driver in
   the wages list immediately, a connection in Connect's own
   store, wage math untouched.
   v131 SUPERSESSION (deliberate pin moves below): finding and
   connecting people in Connect is LIVE, so the door changed:
   the button now routes to Connect's live people search and the
   email/phone invite form (which delivered nothing) is gone.
   v120 pending entries keep rendering a status line, reworded
   to point at the live Connect screen; wage math untouched. */
{
  console.log('\n— v120: Connect a driver —');
  ok('v120: the Connect door is the one big primary action', pnlSrc.indexOf('id="pnl_connect_open"') !== -1 && pnlSrc.indexOf('🤝 Connect a driver') !== -1 && pnlSrc.indexOf('btn primary big') !== -1);
  ok('v120: the manual door is the quiet secondary', pnlSrc.indexOf('id="pnl_manual_open"') !== -1 && pnlSrc.indexOf('Add manually instead') !== -1);
  ok('v120: the manual form is unchanged (same ids, same fields)', ['id="pnl_dname"', 'id="pnl_drate"', 'id="pnl_dtype"', 'id="pnl_dstart"', 'id="pnl_dtravel"', 'id="pnl_dadd"'].every(function (s) { return pnlSrc.indexOf(s) !== -1; }));
  ok('v131: the honest status line ships verbatim (v120 note superseded — connections are live now)', pnlSrc.indexOf('Connections are live now — find them in Connect, tap Connect, and when they accept you are connected.') !== -1);
  ok('v120: no fake delivery claim anywhere in the pnl copy', !/Invite sent|invitation (was )?sent|✓ Connected/.test(pnlSrc));
  ok('v131: the Connect door routes to the LIVE Connect search (the v120 local-only invite + its con_list landing are gone)',
    pnlSrc.indexOf("App.openModule('connect')") !== -1 && pnlSrc.indexOf('__mtConnectSearch') !== -1 &&
    pnlSrc.indexOf('pnl_ccontact') === -1 && pnlSrc.indexOf('pnl_csend') === -1 && pnlSrc.indexOf("role: 'Driver', contact: contact") === -1);
  /* The pending line itself, extracted and driven: */
  const seg = (() => {
    const a = pnlSrc.indexOf('var PNL_INVITE_NOTE');
    const b = pnlSrc.indexOf('function pnlInviteLine', a);
    const c2 = pnlSrc.indexOf('\n  }', pnlSrc.indexOf('return ', b)) + 4;
    if (a === -1 || b === -1) throw new Error('invite line not found');
    return pnlSrc.slice(a, c2);
  })();
  const inviteLine = new Function('esc', seg + '\nreturn pnlInviteLine;')(function (s) { return String(s == null ? '' : s); });
  const pend = inviteLine({ viaConnect: true, inviteStatus: 'pending', contact: 'driver@example.com', name: 'driver@example.com' });
  ok('v120: a pending driver renders the honest status line', pend.indexOf('Invite saved — waiting for them to accept.') !== -1 && pend.indexOf('Connections are live now') !== -1, pend);
  eq('v120: a manual driver renders NO invite line', inviteLine({ name: 'Bob' }), '');
  eq('v120: a linked driver renders NO pending line', inviteLine({ viaConnect: true, inviteStatus: 'linked' }), '');
  /* Wage math on a pending driver: identical rules. */
  const w = makePnl({
    onboarding: { payStandard: 'Hourly', payRate: 29 },
    rev_entries: [], rev_extras: [], fuel_fills: [], fuel_expenses: [],
    pnl_drivers: [{ id: 'dConn', name: 'driver@example.com', contact: 'driver@example.com', viaConnect: true, inviteStatus: 'pending', payType: 'hourly', rate: 25, travelHours: 1, start: '2026-10' }],
    pnl_wage_entries: [{ id: 'w1', date: '2026-10-10', driverId: 'dConn', qty: 10, unit: 'hrs', rate: 25, wage: 250 }],
    pnl_travel_claims: [], pnl_card_wages: [], pnl_expenses: []
  });
  const cc = w.pnl._calc('2026-10');
  const per = cc.wagesByDriver && cc.wagesByDriver.dConn;
  ok('v120: the pending driver appears in the wages breakdown immediately', !!per);
  eq('v120: wage math unchanged (10h × $25 logged + travel 1h × 1 day × $25)', per && round2(per.wage), 275);
  ok('v120: the breakdown carries the pending flag for its status line', !!per && per.viaConnect === true && per.inviteStatus === 'pending');
}

console.log('\npnl-flawless: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
