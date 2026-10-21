#!/usr/bin/env node
/* Meticulous v163 — P&L CLUSTER + MAINTENANCE LIFETIME + PAY LABEL suite.
 *
 * The owner's orders, Oct 18, 2026:
 *  - P&L showed revenue and profit with NO wages line, while an
 *    unexplained $84.19 sat inside the expense total (18:26 MDT)
 *    → driver wages are now ONE FIXED auto-computed line (like
 *    fuel), always printed, never hand-editable.
 *  - A connected driver's wage is HIS OWN (settled 20:40 MDT:
 *    each driver sets his wage on his own side; it travels via
 *    Connect and posts in the boss's app as an expense at the
 *    driver's rate — the boss never sets driver wages).
 *  - P&L monthly miles read "241" off fill stamps (18:26) and
 *    miles were a typable text box (21:06: "Miles are NOT a
 *    text box") → miles come ONLY from the dated odometer log;
 *    the input and its store are gone; no typed fallback.
 *  - NATL deleted (21:06) — a specific benefits package, not a
 *    generic expense line. A "+" adds custom expense lines.
 *  - Maintenance lifetime distance regressed to a 790 km leg
 *    fragment (20:55) → the bookend rule (master − earliest
 *    dated odo_readings entry) is hardened with the poison
 *    discipline, the seed learns two more dated sources
 *    (maintenance events, PTI reports), and the "Between
 *    fill-ups (legs)" line is DELETED (20:56).
 *  - Preferences Pay card label: "My wage rate" → "Driver wage
 *    rate" (18:10).
 *
 * Run: node tools/queue-v163-test.js
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
  ok(name, String(got) === String(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function near(name, got, want, eps) {
  ok(name, Math.abs(got - want) < (eps || 1e-9), 'got ' + got + ', want ~' + want);
}

function memStore(seed) {
  const data = JSON.parse(JSON.stringify(seed || {}));
  return {
    _data: data,
    get: function (k, d) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : d; },
    set: function (k, v) { data[k] = v; return true; },
    del: function (k) { delete data[k]; }
  };
}
function extractRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('region not found: ' + beginMark);
  return src.slice(a, b + 2);
}

const invSrc = read('modules/invoice.js');
const pnlSrc = read('modules/pnl.js');
const cpSrc = read('js/connectpipe.js');
const mtSrc = read('modules/maintenance.js');
const prefSrc = read('modules/preferences.js');
const appSrc = read('js/app.js');

/* ============ A. the P&L + ConnectPipe world ============ */
function makePnl(seed) {
  const store = memStore(seed);
  const sb = {
    window: {}, Meticulous: { modules: {} }, console: console,
    App: {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s); },
      _today: function () { return '2026-10-19'; },
      _masterOdometer: function () {
        const v = parseFloat(store.get('mt_odo', ''));
        return (isFinite(v) && v > 0) ? v : null;
      },
      _odoImplausible: function (v) {
        const m = parseFloat(store.get('mt_odo', ''));
        if (!(v > 0)) return 'below';
        if (isFinite(m) && m > 0 && v > m + 1000) return 'jump';
        return null;
      },
      userRole: function () { return 'office'; }
    }
  };
  sb.window = sb; /* connectpipe reads window.ConnectPipe / window.App */
  vm.createContext(sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(cpSrc, sb);
  vm.runInContext(pnlSrc, sb);
  return { sb: sb, store: store, pnl: sb.Meticulous.modules.pnl, CP: sb.ConnectPipe };
}

/* --- A1: NATL is gone; a saved natl amount counts for nothing --- */
{
  const w = makePnl({
    onboarding: { payStandard: 'hourly', ownWageRate: 29 },
    pnl_detail: { '2026-10': { natl: { amount: 500 }, misc: { amount: 10 } } }
  });
  ok('A1 DETAIL_CATS has no natl row',
    !w.pnl._DETAIL_CATS.some(function (c) { return c.key === 'natl'; }));
  const c = w.pnl._calc('2026-10');
  ok('A1 calc detail rows have no natl',
    !c.detail.some(function (r) { return r.key === 'natl'; }));
  near('A1 saved natl $500 enters no total (only misc $10 counts)', c.detailTotal, 10);
}

/* --- A2: custom expense lines ride the same totals --- */
{
  const w = makePnl({
    onboarding: { payStandard: 'hourly' },
    pnl_custom_cats: [{ key: 'cwash', label: 'Truck wash' }],
    pnl_detail: { '2026-10': { cwash: { amount: 75 } } }
  });
  const c = w.pnl._calc('2026-10');
  const row = c.detail.filter(function (r) { return r.key === 'cwash'; })[0];
  ok('A2 custom line appears in calc rows', !!row);
  eq('A2 custom line label', row && row.label, 'Truck wash');
  eq('A2 custom line flagged custom', row && row.custom, true);
  near('A2 custom amount in the detail total', c.detailTotal, 75);
  eq('A2 _customCats reads the store', w.pnl._customCats().length, 1);
}

/* --- A3: monthly miles — odometer only, no override, no typed fallback --- */
{
  const w = makePnl({
    onboarding: { payStandard: 'hourly', ownWageRate: 29 },
    mt_odo: '169300',
    odo_readings: [
      { ts: 1, date: '2026-09-30', value: 160000 },
      { ts: 2, date: '2026-10-10', value: 165000 },
      { ts: 3, date: '2026-10-15', value: 519326 }, /* the poisoned stamp */
      { ts: 4, date: '2026-10-31', value: 169300 }
    ],
    pnl_miles_2026_10: 241, /* the old typed override — must be ignored */
    rev_entries: [{ date: '2026-10-05', miles: 9999, hours: 0, amount: 0 }]
  });
  near('A3 month miles = odometer bookends (169300 - 160000)', w.pnl._totalMiles('2026-10'), 9300);
  const c = w.pnl._calc('2026-10');
  near('A3 calc miles agree', c.miles, 9300);
  const w2 = makePnl({ onboarding: {}, rev_entries: [{ date: '2026-10-05', miles: 500, amount: 0 }] });
  eq('A3 no readings at all -> 0 (typed revenue miles never substitute)',
    w2.pnl._totalMiles('2026-10'), 0);
}

/* --- A4: the driver's OWN wage wins over any boss-side entry --- */
{
  const w = makePnl({
    onboarding: { payStandard: 'hourly', billingRate: 93 },
    pnl_drivers: [{ id: 'dX', name: 'Crew D', payType: 'hourly', rate: 40, uid: 'uidX' }],
    __peer_wages: { uidX: { payType: 'hourly', rate: 29 } }
  });
  const p = w.CP.pricingFor('uidX');
  eq('A4 wage comes from the driver himself', p.wage && p.wage.rate, 29);
  eq('A4 wage source is the driver', p.wageSource, 'driver');
  eq('A4 client rate is still the boss\u2019s own', p.clientRate, 93);
  const w2 = makePnl({
    onboarding: { payStandard: 'hourly' },
    pnl_drivers: [{ id: 'dX', name: 'Crew D', payType: 'hourly', rate: 40, uid: 'uidX' }]
  });
  const p2 = w2.CP.pricingFor('uidX');
  eq('A4 pre-crossing fallback keeps the local entry', p2.wage && p2.wage.rate, 40);
  eq('A4 fallback source named local', p2.wageSource, 'local');
}

/* --- A5: crew wages land in the fixed line + the totals --- */
{
  const day = {
    driver: 'uidX', driverName: 'Crew D', date: '2026-10-16',
    session: { hours: 11, km: 0 }, loads: 0, dispatches: [],
    close: { source: 'entry', foremanHours: 10, travelHours: 1, bonusHours: 0, loads: 0 }
  };
  const w = makePnl({
    onboarding: { payStandard: 'hourly', billingRate: 93 },
    __peer_wages: { uidX: { payType: 'hourly', rate: 29 } },
    __crew_days: { '2026-10': [day] }
  });
  const c = w.pnl._calc('2026-10');
  near('A5 crew wage priced at HIS rate (11h x 29)', c.crewWages, 319);
  near('A5 wagesTotal carries the crew wage', c.wagesTotal, 319);
  /* v200 SUPERSEDES the 319 pin below it in spirit: the day now
     ALSO books its revenue (10 foreman x $93 = $930, OWNER-AUTO-
     UPDATE), and the standing Brokerage auto row (10% of revenue)
     prices on it — expenses = 319 wages + 93 brokerage. */
  near('A5 the expense total contains it — with the line to show it', c.expenses, 412);
  near('A5 v200: the day books its revenue leg too', c.crewRevenue, 930);
  eq('A5 per-driver attribution names him', c.crewWagesByDriver.uidX && c.crewWagesByDriver.uidX.name, 'Crew D');
}

/* --- A6: my own wage, as I publish it --- */
{
  const w = makePnl({ onboarding: { payStandard: 'hourly', ownWageRate: 29 } });
  const sw = w.CP.sharedWage();
  eq('A6 sharedWage payType', sw && sw.payType, 'hourly');
  eq('A6 sharedWage rate', sw && sw.rate, 29);
  const w2 = makePnl({ onboarding: { payStandard: 'miles', payRate: 1.5 } });
  const sw2 = w2.CP.sharedWage();
  eq('A6 per-mile standard maps to permile', sw2 && sw2.payType, 'permile');
  eq('A6 legacy payRate fallback carries', sw2 && sw2.rate, 1.5);
  const w3 = makePnl({ onboarding: { payStandard: 'hourly' } });
  eq('A6 no wage set -> nothing crosses', w3.CP.sharedWage(), null);
}

/* --- A7: face statics — the fixed line, the dead input, the + door --- */
/* v181 (D5 REDEFINED, owner Oct 20, 2026 19:53–19:54) SUPERSEDES the
   breakdown-line pin: the Expense breakdown card is OFF the P&L face —
   the Monthly analysis's Total salaries row (next check) is the one
   wages face, still printed off the same fixed wagesTotal figure. */
ok('A7 no breakdown Driver wages line remains on the face (D5)',
  pnlSrc.indexOf('Expense breakdown') === -1 && pnlSrc.indexOf('money(c.wagesTotal)') !== -1);
ok('A7 the miles text box is gone from the face', pnlSrc.indexOf('id="pnl_miles"') === -1);
ok('A7 no handler writes a miles override any more', pnlSrc.indexOf("W('miles_' + m") === -1);
ok('A7 the + add-line door renders', pnlSrc.indexOf('id="pnl_addcat"') !== -1);
ok('A7 no boss-side Set-his-pay-rate door remains (P&L or Dispatch board)',
  pnlSrc.indexOf('data-pnlsetpay') === -1 && read('modules/dispatch.js').indexOf('data-pipesetpay') === -1);
ok('A7 analysis salaries row uses the same fixed figure',
  pnlSrc.indexOf('Total salaries (driver wages)') !== -1);

/* ============ B. Maintenance lifetime hardening ============ */
function makeMt(seed, master) {
  const store = memStore(seed);
  const sb = {
    window: {}, Meticulous: { modules: {} }, console: console,
    App: {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s); },
      _today: function () { return '2026-10-19'; },
      _masterOdometer: function () { return master; },
      _odoImplausible: function (v) {
        if (!(v > 0)) return 'below';
        if (master && v > master + 1000) return 'jump';
        return null;
      },
      _econConvert: function (kpl) { return kpl; },
      _econFormat: function (kpl) { return { value: String(kpl), unit: 'km/L' }; }
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(mtSrc, sb);
  return { sb: sb, store: store, mt: sb.Meticulous.modules.maintenance };
}
{
  const fills = [
    { date: '2026-10-05', litres: 400, cost: 900, odo: 0 },
    { date: '2026-10-12', litres: 411.68, cost: 940, odo: 0 }
  ];
  const w = makeMt({
    mt_odo: '169300', fuel_fills: fills,
    odo_readings: [
      { ts: 1, date: '2026-09-01', value: 519326 }, /* poisoned early stamp */
      { ts: 2, date: '2026-10-01', value: 166131 },
      { ts: 3, date: '2026-10-17', value: 169300 }
    ]
  }, 169300);
  const lt = w.mt._lifetimeStats();
  eq('B1 lifetime still computes', lt.ok, true);
  near('B1 distance = master - earliest HONEST reading (3169, not the fragment)', lt.distance, 3169);
  eq('B1 the window opens at the honest reading', lt.fromDate, '2026-10-01');
  near('B1 economy over the window litres', lt.economy, 3169 / 811.68, 0.01);
  const w2 = makeMt({
    mt_odo: '169300', fuel_fills: fills,
    odo_readings: [{ ts: 1, date: '2026-09-01', value: 519326 }]
  }, 169300);
  eq('B1 a log of only poison -> honest no-figure state', w2.mt._lifetimeStats().ok, false);
}
ok('B2 the legs row is deleted from the face',
  mtSrc.indexOf('Between fill-ups (legs)</span>') === -1);

/* ============ C. the seed learns events + PTI reports ============ */
{
  const sliceStart = appSrc.indexOf('var _onbOcrToken');
  const sliceEnd = appSrc.indexOf('function collectOnbInputs');
  ok('C0 app.js odo slice found', sliceStart >= 0 && sliceEnd > sliceStart);
  if (sliceStart >= 0 && sliceEnd > sliceStart) {
    const store = memStore({
      mt_odo: '169300',
      odo_readings: [],
      fuel_fills: [],
      sessions: [],
      mt_events: [{ date: '2026-09-15', odo: 160000, type: 'Oil change', cost: '189.99' }],
      pti_reports: [{ date: '2026-09-20', odometer: 161000, filedAt: new Date(2026, 8, 20, 7, 0).getTime() }]
    });
    const sb = {
      window: {}, Meticulous: { modules: {} }, console: console,
      store: store,
      App: { _store: store }
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(appSrc.slice(sliceStart, sliceEnd), sb);
    sb.App._seedOdoReadings = sb.seedOdoReadings; /* bare fn lands on the global */
    const added = sb.App._seedOdoReadings();
    const log = store.get('odo_readings', []);
    eq('C1 seed added both new sources', added, 2);
    ok('C1 the event reading is in the log',
      log.some(function (r) { return r.value === 160000 && r.source === 'seed-event'; }));
    ok('C1 the PTI reading is in the log',
      log.some(function (r) { return r.value === 161000 && r.source === 'seed-pti'; }));
    eq('C1 re-running the seed adds nothing', sb.seedOdoReadings(), 0);
  }
}

/* ============ D. Preferences label ============ */
ok('D1 the Pay card reads Driver wage rate', prefSrc.indexOf('Driver wage rate ($/hour)') !== -1);
ok('D1 the old My wage rate label is gone', prefSrc.indexOf('My wage rate') === -1);

console.log('\nqueue-v163 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
