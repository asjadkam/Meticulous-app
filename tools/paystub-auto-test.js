#!/usr/bin/env node
/* Meticulous v122 — THE PAY STUB BUILDS ITSELF + module name +
 * dated odometer log + invoice print structure.
 *
 * Owner catches, Oct 17, 2026:
 *  (1) "I changed my payment method to payroll... And that was
 *      suppose to change the name of the invoice module to
 *      paystub!" — the name was hard-coded 'Invoice' in js/app.js
 *      while the guts already switched. v122: moduleTitle() is
 *      the ONE place the presented name is decided.
 *  (2) "It should do the deduction based on the tax code of the
 *      locality as well. That's the whole magic!" — the stub
 *      opened all-zero manual. v122: period defaults to the open
 *      semi-monthly cycle, gross pre-fills from the period's
 *      completed work via the shared per-day builder at the
 *      driver's OWN wage rate, and CPP/CPP2 + EI + federal +
 *      Alberta income tax auto-calculate with CRA's T4127
 *      formulas (PAYROLL-CALC region, modules/invoice.js).
 *  (3) The manifest's Odometer line vanished because the app
 *      had NO dated odometer log — v122 adds odo_readings,
 *      appended on every master write path (ODO-MASTER region).
 *  (4) The invoice print takes the STRUCTURE of his old #1150:
 *      header band, pay-period line, Bill-to block, the hours
 *      as their own ruled section, notes apart, a totals block
 *      with Paid/Balance, and a Prepared-by footer.
 *
 * The tax engine is pinned against CRA's OWN published numbers:
 * T4032AB (Jan 2026) step-by-step worked Examples B and C —
 * the same T4127 Option-1 formulas the Payroll Deductions
 * Online Calculator (PDOC) implements. PDOC itself is an
 * interactive canada.ca flow (an "I accept" gate + form), not
 * drivable from this harness; CRA's worked examples are its
 * published formula outputs and are matched here TO THE CENT.
 *
 * Run: node tools/paystub-auto-test.js
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
function has(name, hay, needle) { ok(name, String(hay).indexOf(needle) >= 0, 'missing ' + JSON.stringify(needle)); }

const appSrc = read('js/app.js');
const invSrc = read('modules/invoice.js');
const manSrc = read('modules/manifest.js');
const mtSrc = read('modules/maintenance.js');
const pfSrc = read('modules/preferences.js');
const fuSrc = read('modules/fuel.js');

function extractStore(src) {
  const a = src.indexOf('var store = {');
  const b = src.indexOf('};', a);
  if (a === -1 || b === -1) throw new Error('store slice not found');
  return src.slice(a, b + 2);
}
function extractRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}
function makeWorld() {
  const backing = new Map();
  const localStorage = {
    getItem: function (k) { return backing.has(k) ? backing.get(k) : null; },
    setItem: function (k, v) { backing.set(k, String(v)); },
    removeItem: function (k) { backing.delete(k); }
  };
  const sandbox = {
    console: console, localStorage: localStorage,
    App: { _today: function () { return '2026-10-17'; }, _esc: function (s) { return String(s == null ? '' : s); } }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractStore(appSrc), sandbox);
  sandbox.App._store = sandbox.store;
  return sandbox;
}

/* ============ (1) the CRA engine vs CRA's published examples ============ */
console.log('\n— PAYROLL-CALC: CRA T4032AB worked Example B (weekly $1,300, RRSP $80, claim code 1/1) —');
{
  const w = makeWorld();
  vm.runInContext(extractRegion(invSrc, 'PAYROLL-CALC-BEGIN', 'PAYROLL-CALC-END'), w);
  const r = w.psCalcDeductions(1300, { year: 2026, province: 'AB', periods: 52, f: 80 });
  eq('B: CPP $73.35', r.cpp, 73.35);
  eq('B: CPP2 $0', r.cpp2, 0);
  eq('B: EI $21.19', r.ei, 21.19);
  eq('B: enhanced CPP deduction F5 $12.33', r.f5, 12.33);
  eq('B: annual taxable income A $62,798.84', r.A, 62798.84);
  eq('B: annual federal tax $5,957.85', r.fedAnnual, 5957.85);
  eq('B: annual Alberta tax $2,892.37', r.provAnnual, 2892.37);
  eq('B: per-period federal $114.57', r.fedTax, 114.57);
  eq('B: per-period Alberta $55.62', r.provTax, 55.62);
  /* CRA states the period's total tax as (T1+T2)/P = $170.20;
     the stub rounds each jurisdiction separately (so the stub's
     own rows always add up exactly) — a 1-cent rounding-path
     difference, pinned here so it is never a surprise. */
  ok('B: per-period total within 1¢ of CRA\'s $170.20 single-division figure', Math.abs(r.tax - 170.20) <= 0.01, 'got ' + r.tax);
}
console.log('\n— PAYROLL-CALC: CRA T4032AB worked Example C (CPP maxed, CPP2 running, K5P fires) —');
{
  const w = makeWorld();
  vm.runInContext(extractRegion(invSrc, 'PAYROLL-CALC-BEGIN', 'PAYROLL-CALC-END'), w);
  const r = w.psCalcDeductions(1600, {
    year: 2026, province: 'AB', periods: 52,
    ytdCpp: 4230.45, ytdCpp2: 24, ytdEi: 1123.07, ytdPensionable: 75200, tcProv: 60000
  });
  eq('C: CPP $0 (annual max reached)', r.cpp, 0);
  eq('C: CPP2 $64.00', r.cpp2, 64);
  eq('C: EI $0 (annual max reached)', r.ei, 0);
  eq('C: F5 = the whole CPP2 $64.00', r.f5, 64);
  eq('C: A $79,872.00', r.A, 79872);
  eq('C: annual federal $9,406.39 (max base CPP + max EI substituted in K2)', r.fedAnnual, 9406.39);
  eq('C: annual Alberta $1,522.95 (K5P supplemental credit applied)', r.provAnnual, 1522.95);
  eq('C: per-period total tax $210.18', r.tax, 210.18);
}
console.log('\n— PAYROLL-CALC: the owner\'s own period + a second sample (semi-monthly, AB) —');
{
  const w = makeWorld();
  vm.runInContext(extractRegion(invSrc, 'PAYROLL-CALC-BEGIN', 'PAYROLL-CALC-END'), w);
  const r = w.psCalcDeductions(3610.50, { year: 2026, province: 'AB', periods: 24 });
  eq('owner: CPP $206.15 (5.95% over the $145.83 period exemption)', r.cpp, 206.15);
  eq('owner: CPP2 $0 (period pay under the YMPE band)', r.cpp2, 0);
  eq('owner: EI $58.85 (1.63%)', r.ei, 58.85);
  eq('owner: annualized A $85,820.40', r.A, 85820.40);
  eq('owner: annual federal $10,625.81', r.fedAnnual, 10625.81);
  eq('owner: annual Alberta $5,165.12', r.provAnnual, 5165.12);
  eq('owner: federal per period $442.74', r.fedTax, 442.74);
  eq('owner: Alberta per period $215.21', r.provTax, 215.21);
  eq('owner: net before other deductions $2,687.55', Math.round((3610.50 - r.cpp - r.ei - r.tax) * 100) / 100, 2687.55);
  const s2 = w.psCalcDeductions(2000, { year: 2026, province: 'AB', periods: 24 });
  eq('sample2: CPP $110.32', s2.cpp, 110.32);
  eq('sample2: EI $32.60', s2.ei, 32.60);
  eq('sample2: federal $155.27', s2.fedTax, 155.27);
  eq('sample2: Alberta $72.67', s2.provTax, 72.67);
  const low = w.psCalcDeductions(800, { year: 2026, province: 'AB', periods: 24 });
  eq('low earner: CPP still applies $38.92', low.cpp, 38.92);
  eq('low earner: income tax $0 (basic amounts + CEA cover it)', low.tax, 0);
  const on = w.psCalcDeductions(2000, { year: 2026, province: 'ON', periods: 24 });
  eq('uncovered province: federal still calculated', on.fedTax, 155.27);
  eq('uncovered province: provTax is null, never guessed', on.provTax, null);
  eq('uncovered province: provSupported false', on.provSupported, false);
  eq('uncovered year: whole result null (form stays manual)', w.psCalcDeductions(2000, { year: 2025, province: 'AB', periods: 24 }), null);
  eq('zero gross: all zeros, no NaN', JSON.stringify(w.psCalcDeductions(0, { year: 2026, province: 'AB', periods: 24 }).tax), '0');
}

/* ============ (2) gross pre-fill: the shared builder at the wage rate ============ */
console.log('\n— psPeriodGross: Oct 1–15 at the driver\'s own wage rate —');
{
  const w = makeWorld();
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), w);
  const a = invSrc.indexOf('function psWageRate');
  const b = invSrc.indexOf('function renderPayroll');
  if (a === -1 || b === -1 || b <= a) throw new Error('ps gross slice not found');
  vm.runInContext(invSrc.slice(a, b), w);
  function completion(date, hours, amount) {
    return { date: date, type: 'hourly', hours: hours, amount: String(amount), note: 'Dispatch: Aecon · foreman + travel = ' + hours + 'h', loads: 0 };
  }
  const entries = [
    completion('2026-10-01', 10.5, 304.50), completion('2026-10-02', 11, 319.00),
    completion('2026-10-03', 9, 261.00), completion('2026-10-05', 10.5, 304.50),
    completion('2026-10-06', 11.5, 333.50), completion('2026-10-07', 11.5, 333.50),
    completion('2026-10-08', 12.5, 362.50), completion('2026-10-09', 14.5, 420.50),
    completion('2026-10-13', 11.5, 333.50), completion('2026-10-14', 10.5, 304.50),
    completion('2026-10-15', 11.5, 333.50)
  ];
  w.App._store.set('rev_entries', entries);
  const o = { payStandard: 'Hourly', payRate: 35, billingRate: 35, ownWageRate: 29 };
  const g = w.psPeriodGross(o, '2026-10-01', '2026-10-15');
  eq('gross: 124.5 hrs shown', g.hours, 124.5);
  eq('gross: hours × OWN wage rate ($29), not the billing rate ($35)', g.gross, 3610.50);
  eq('gross: 11 completed days', g.days, 11);
  const g2 = w.psPeriodGross({ payStandard: 'Hourly', payRate: 29 }, '2026-10-01', '2026-10-15');
  eq('gross: wage falls back to the general rate when no wage rate is set', g2.gross, 3610.50);
  const g3 = w.psPeriodGross(o, '2026-11-01', '2026-11-15');
  eq('gross: an empty period is honestly zero', g3.gross + '/' + g3.days, '0/0');
}

/* ============ (3) Item 1: the module name follows the pay method ============ */
console.log('\n— moduleTitle: Payroll → Pay Stub everywhere —');
{
  const w = makeWorld();
  vm.runInContext(extractRegion(appSrc, 'MODULE-TITLE-BEGIN', 'MODULE-TITLE-END'), w);
  w.store.set('onboarding', { employment: 'Payroll' });
  eq('payroll: invoice module presents as Pay Stub', w.moduleTitle('invoice'), 'Pay Stub');
  eq('payroll: other modules keep their names', w.moduleTitle('dispatch'), 'Dispatch');
  w.store.set('onboarding', { employment: 'Contract' });
  eq('contract: the module stays Invoice', w.moduleTitle('invoice'), 'Invoice');
  w.store.set('onboarding', {});
  eq('unset employment: Invoice (no guessing)', w.moduleTitle('invoice'), 'Invoice');
  has('dashboard card reads moduleTitle', appSrc, "' + moduleTitle(key) + '</div>'");
  has('drawer reads moduleTitle for the invoice row', appSrc, "it[0] === 'invoice' ? moduleTitle('invoice') : it[2]");
  has('module header reads moduleTitle', appSrc, 'var title = meta ? moduleTitle(key) :');
}

/* ============ (4) Item 3a: the dated readings log ============ */
console.log('\n— ODO-MASTER: every master write path appends a dated reading —');
{
  const w = makeWorld();
  vm.runInContext(extractRegion(appSrc, 'ODO-MASTER-BEGIN', 'ODO-MASTER-END'), w);
  const log = function () { return w.store.get('odo_readings', []); };
  const r1 = w.bumpOdometer(168759, 'maintenance');
  eq('bump: first reading sets the master', r1.raised, true);
  eq('bump: the write appended one reading', log().length, 1);
  eq('reading shape: value + source recorded', log()[0].value + '/' + log()[0].source, '168759/maintenance');
  ok('reading shape: ISO date + numeric ts', /^\d{4}-\d{2}-\d{2}$/.test(log()[0].date) && typeof log()[0].ts === 'number', JSON.stringify(log()[0]));
  /* age the first reading past the log's one-minute dedupe
     window — in life the confirming capture comes hours later */
  const aged = log(); aged[0].ts -= 120000; w.store.set('odo_readings', aged);
  const r2 = w.bumpOdometer(168759, 'session');
  eq('bump: an equal capture confirms, master unmoved', r2.raised, false);
  eq('bump: the confirmation is boundary evidence — logged (new moment)', log().length, 2);
  const r3 = w.bumpOdometer(168700, 'session');
  eq('bump: below-master capture never drags the master down', w.masterOdometer(), 168759);
  eq('bump: below-master capture is NOT logged (stale/misread)', log().length, 2);
  const r4 = w.bumpOdometer(519326, 'fuel');
  eq('bump: the Oct 15 poison shape is refused as a jump', r4.refused, 'jump');
  eq('bump: a refused jump is NOT logged', log().length, 2);
  eq('correction: logOdoReading may log below the master when supervised', w.logOdoReading(168700, 'maintenance', null, true), true);
  eq('correction: the master itself is untouched by the log call', w.masterOdometer(), 168759);
  const before = log().length;
  eq('dedupe: the same value inside a minute collapses', w.logOdoReading(168700, 'maintenance', log()[log().length - 1].ts + 5000, true), false);
  eq('dedupe: log unchanged', log().length, before);
  /* write-path wiring (source pins — the house pattern for glue) */
  has('maintenance: correction path logs', mtSrc, "App._logOdoReading(dec.value, 'maintenance', null, true)");
  has('maintenance: ordinary Save logs', mtSrc, "App._logOdoReading(dec.value, 'maintenance')");
  has('preferences: applied write logs', pfSrc, "App._logOdoReading(dec.value, 'preferences', null, dec.action === 'correct')");
  has('onboarding: applied write logs', appSrc, "logOdoReading(obDec.value, 'onboarding', null, obDec.action === 'correct')");
  has('fuel: the master bump carries the fuel source', fuSrc, "App._bumpOdometer(n, 'fuel')");
  has('fuel: an armed correction logs', fuSrc, "App._logOdoReading(odoPlan.value, 'fuel', null, true)");
  has('fuel: a saved fill logs its reading at the fill\'s moment', fuSrc, "App._logOdoReading(odo, 'fuel', fuFillTs(rec))");
  has('app: session captures carry the session source', appSrc, "bumpOdometer(n, 'session')");
  has('app: the log is exposed for the modules', appSrc, 'App._logOdoReading = logOdoReading;');
}
console.log('\n— Item 3c: a dispatch-close stop stamps the session end (source pins) —');
{
  has('the dispatch-close door arms the stamp', appSrc, 'App.stopSessionOnDispatchClose = function () {\n    if (!sessionActive()) return false;\n    _stopViaDispatch = true;');
  has('the stamp reads the latest dated reading', appSrc, "var rlog = store.get(rlogKey, []);"); // v242 trap 1: the SESSION's own truck's log (rlogKey via keyFor)
  has('the stamp falls back to the master', appSrc, "App.workProfiles.keyFor('mt_odo', entry.profileId)"); // v242 trap 1: the fallback master is the session truck's own
  has('the stamp lands on the session entry', appSrc, 'if (stamp > 0) entry.endOdo = stamp;');
  has('a plain tracker Stop never arms it', appSrc, 'App.trackerStop = function () { stopSessionAt(Date.now()); };');
}

/* ============ (5) Item 4: invoice + stub print structure (source pins + paid math) ============ */
console.log('\n— print structure: #1150\'s structure, the app\'s own words —');
{
  const w = makeWorld();
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), w);
  eq('paid: no payment facts → $0', w.invCycPaidTotal({ total: 3610.50 }), 0);
  eq('paid: a payments list sums', w.invCycPaidTotal({ payments: [{ amount: 3000 }, { amount: '100.25' }] }), 3100.25);
  eq('paid: a paid figure counts', w.invCycPaidTotal({ paid: 3000 }), 3000);
  has('print: header band carries the business', invSrc, '<div class="band"><h1>');
  has('print: pay-period line', invSrc, '<b>Pay period:</b> ');
  has('print: Bill-to is its own section', invSrc, '<h3 class="sec">Bill to</h3>');
  has('print: truck number prints when known', invSrc, "'<br>Truck #' + esc(truckNo)");
  has('print: hours are their own section', invSrc, '<h3 class="sec">Hours</h3>');
  has('print: ruled table Description | Rate | Hours | Amount', invSrc, '<th>Description</th><th>Rate</th><th>Hours</th><th style="text-align:right">Amount</th>');
  has('print: day rows read "Oct 1" with the tax-incl. rate', invSrc, "' tax incl.'");
  has('print: notes are a separate section', invSrc, '<h3 class="sec">Notes</h3>');
  has('print: Net subtotal backs the included GST out', invSrc, 'var netSub = rec.taxIncluded ? invCycRound2((Number(rec.sub) || 0) - (Number(rec.tax) || 0))');
  has('print: GST row prints the GST number', invSrc, "' — GST/HST ' + esc(rec.company.gst)");
  has('print: Paid amount row', invSrc, '<span>Paid amount</span>');
  has('print: Balance owing row', invSrc, '<span><b>Balance owing</b></span>');
  has('print: Prepared-by footer with number + page', invSrc, "'<p class=\"muted foot\">Prepared by '");
  has('print: footer carries the invoice number and Page 1', invSrc, "' · Invoice ' + esc(rec.no) + ' · Page 1</p>'");
  has('issue: the truck number is archived on the record', invSrc, 'truckNo: x.truckNo || ');
  /* pay stub print */
  has('stub print: header band', invSrc, '<div class="band"><h1>Pay Stub</h1>');
  has('stub print: hours worked row', invSrc, '<tr><td>Hours worked</td>');
  has('stub print: federal tax row', invSrc, '<tr><td>Income tax — federal</td>');
  has('stub print: provincial tax row', invSrc, '<tr><td>Income tax — ');
  has('stub print: CPP2 disclosed inside CPP', invSrc, "(includes CPP2 $'");
  has('stub print: honesty footer for calculated stubs', invSrc, 'Calculated with the federal');
  has('stub print: legacy stubs keep the manual footer', invSrc, 'Deductions entered manually. This stub is a record, not tax advice.');
  /* the form itself */
  has('form: period defaults to the open cycle', invSrc, 'invCycOpenPeriod(paystubs().map(function (r) { return { pb: r.b }; })');
  has('form: gross pre-fills via psPeriodGross', invSrc, 'psAuto = psPeriodGross(o, a, b);');
  has('form: deductions auto-calculate via the engine', invSrc, 'psCalc = psCalcDeductions(fieldVal(\'gross\')');
  has('form: semi-monthly = 24 periods', invSrc, 'periods: 24');
  has('form: hand-edited gross says so', invSrc, 'Gross edited by hand');
  has('form: overridden fields are named', invSrc, 'Hand-edited: ');
  has('form: the honesty label is on the form', invSrc, 'may differ if your TD1 claims more than the basic amounts');
  has('form: Other deductions stay manual', invSrc, '<label class="f">Other deductions $</label><input id="ps_other"');
  ok('form: the old all-manual copy is gone', invSrc.indexOf('Enter deductions yourself — the app does not calculate tax for you.') < 0);
  has('save: the stub records its hours', invSrc, 'hours: psAuto.hours, gross: gross,');
  has('save: the stub records the tax split', invSrc, 'fedTax: fed, provTax: prov, tax: psR2(fed + prov),');
  has('save: the stub records how it was built', invSrc, 'autoCalc: !!psCalc, overFields: Object.keys(psOver)');
}

/* ============ (6) Item 3b/3d: manifest wiring (source pins; behaviour in manifest-odo-test) ============ */
console.log('\n— manifest: readings-log boundaries + the said-so line —');
{
  has('collect fills boundaries from odo_readings', manSrc, "var rl = G(wpOdoLogKey(dayPid), []);"); // v242 trap 1: the DAY's own truck's log
  has('start = last reading at or before the work start', manSrc, 'if (readings[i].ts <= startAnchor) { odoStart = readings[i].value; break; }');
  has('end = first reading at or after the day\'s end', manSrc, 'if (readings[j].ts >= endAnchor && readings[j].ts < limit) { odoEnd = readings[j].value; break; }');
  has('pdf: no boundary data says so', manSrc, "b: (ol !== null) ? ol : 'no readings captured'");
  has('preview: no boundary data says so', manSrc, "ol2 !== null ? ol2 : 'no readings captured'");
}

console.log('\npaystub-auto: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
