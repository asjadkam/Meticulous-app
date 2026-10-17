#!/usr/bin/env node
/* Meticulous v81 — REVENUE GROUPED TRUTH suite.
 *
 * Owner evidence (Oct 15, 2026): the Revenue screen showed
 * "Earnings · 14d $3,572.16" — a raw sum of every stored entry,
 * including Oct 15's tracker double ($291.16 beside the $333.50
 * dispatch completion) and Oct 14 at the session's 9.63h. The
 * confirmed days total $3,306.00 for Oct 2–15 ($3,610.50 for
 * Oct 1–15 — the invoice #1151 figures).
 *
 * This suite loads the REAL INV-CYCLE region of modules/invoice.js
 * (which publishes Meticulous.shared.buildRevenueLines) and the
 * REAL aggregation helpers + DAY-DETAIL region of
 * modules/revenue.js into one vm world, seeds the poisoned
 * dataset, and proves every Revenue total now equals the grouped
 * per-day truth the invoice prints from — while Day Details still
 * lists the raw entries for viewing/editing.
 * Run: node tools/revenue-grouped-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function eq(name, got, want) {
  const okK = String(got) === String(want);
  if (okK) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function money(n) { return Math.round((Number(n) || 0) * 100) / 100; }

const invSrc = fs.readFileSync(path.join(ROOT, 'modules', 'invoice.js'), 'utf8');
const revSrc = fs.readFileSync(path.join(ROOT, 'modules', 'revenue.js'), 'utf8');
function extractCommentRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('region not found: ' + beginMark);
  return src.slice(a, b + 2);
}
function revHelpers() {
  const start = revSrc.indexOf('var S = function');
  const end = revSrc.lastIndexOf('/*', revSrc.indexOf('v38 (B2): paste-import'));
  if (start === -1 || end === -1 || end <= start) throw new Error('revenue helper slice not found');
  return revSrc.slice(start, end);
}
function dayDetailRegion() {
  return extractCommentRegion(revSrc, 'DAY-DETAIL-BEGIN', 'DAY-DETAIL-END');
}

/* The poisoned dataset, exactly as stored on the owner's phone:
   nine confirmed days (Oct 1–13, dispatch completions), Oct 14 and
   Oct 15 each carrying a completion AND its tracker shadow, one
   tracker-only day (Oct 10), one two-tracker day (Oct 11). */
function completion(date, hours, amount) {
  return { date: date, type: 'hourly', hours: hours, amount: String(amount), note: 'Dispatch: Aecon · foreman + travel = ' + hours + 'h', loads: 0 };
}
function tracker(date, hours, amount) {
  return { date: date, type: 'hourly', hours: hours, amount: String(amount), note: 'Auto from tracker', auto: true, loads: 0 };
}
const ENTRIES = [
  completion('2026-10-01', 10.5, 304.50),
  completion('2026-10-02', 11, 319.00),
  completion('2026-10-03', 9, 261.00),
  completion('2026-10-05', 10.5, 304.50),
  completion('2026-10-06', 11.5, 333.50),
  completion('2026-10-07', 11.5, 333.50),
  completion('2026-10-08', 12.5, 362.50),
  completion('2026-10-09', 14.5, 420.50),
  completion('2026-10-13', 11.5, 333.50),
  tracker('2026-10-10', 5, 145.00),
  tracker('2026-10-11', 3, 87.00),
  tracker('2026-10-11', 2, 58.00),
  completion('2026-10-14', 10.5, 304.50),
  tracker('2026-10-14', 9.63, 279.27),
  completion('2026-10-15', 11.5, 333.50),
  tracker('2026-10-15', 10.04, 291.16)
];

function makeWorld() {
  const mem = {
    onboarding: { payStandard: 'Hourly', payRate: 29 },
    rev_entries: JSON.parse(JSON.stringify(ENTRIES)),
    rev_extras: [],
    sessions: [], fuel_fills: [], dsp_list: []
  };
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); },
    del: function (k) { delete mem[k]; }
  };
  const sandbox = {
    console: console,
    App: {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s); },
      _today: function () { return '2026-10-15'; },
      _odoDailyKm: null, tracker: null
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  /* invoice region first (publishes the shared builder), then the
     revenue helpers + day-detail region that consume it. The
     invoice region's other functions reference module helpers at
     CALL time only; loading the region is side-effect-free apart
     from the shared publication. */
  vm.runInContext(extractCommentRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sandbox);
  vm.runInContext('var Meticulous = window.Meticulous;', sandbox);
  vm.runInContext(revHelpers(), sandbox);
  vm.runInContext(dayDetailRegion(), sandbox);
  vm.runInContext('this.__x = { dayAgg, monthSummary, dayTotal, dayDetailData, payFor, payCtx, entries, extras };', sandbox);
  return { x: sandbox.__x, sb: sandbox };
}

const w = makeWorld();
const X = w.x;

console.log('\n— Revenue grouped truth (the Oct 15 dataset) —');
ok('shared builder published by the invoice module', !!(w.sb.Meticulous && w.sb.Meticulous.shared && typeof w.sb.Meticulous.shared.buildRevenueLines === 'function'));

/* Sanity: the RAW sum really is the poisoned one. (The phone's
   actual invoice-10 total, $3,876.43, is this same sum minus the
   Oct 14 completion the phone never held and minus the two
   synthetic days: 4470.93 − 304.50 − 145 − 145 = 3876.43.) */
{
  const ctx = X.payCtx();
  let raw = 0;
  X.entries().forEach(e => { raw += X.payFor(e, ctx.std, ctx.rate); });
  eq('fixture raw sum is the poisoned $4,470.93', money(raw), 4470.93);
  eq('raw sum reconciles with the phone’s invoice-10 $3,876.43', money(raw - 304.50 - 145 - 145), 3876.43);
}

const agg = X.dayAgg();
eq('Oct 15 counts ONCE at the completion $333.50', money(agg['2026-10-15'].amount), 333.50);
eq('Oct 15 hours are the completion’s 11.5', agg['2026-10-15'].hours, 11.5);
eq('Oct 15 not flagged unconfirmed', agg['2026-10-15'].unconfirmed, false);
eq('Oct 14 counts ONCE at the completion $304.50', money(agg['2026-10-14'].amount), 304.50);
eq('Oct 10 tracker-only day counts once, $145.00', money(agg['2026-10-10'].amount), 145.00);
eq('Oct 10 flagged unconfirmed', agg['2026-10-10'].unconfirmed, true);
eq('Oct 11 two-tracker day counts $0', money(agg['2026-10-11'].amount), 0);
eq('Oct 11 flagged duplicate', agg['2026-10-11'].duplicate, true);
eq('Oct 11 still a worked day', agg['2026-10-11'].hasEntry, true);

let win14 = 0;
Object.keys(agg).forEach(ds => { if (ds >= '2026-10-02' && ds <= '2026-10-15') win14 += agg[ds].amount; });
eq('Oct 2–15 grouped total (excl. synthetic days it is the owner’s $3,306.00 + $145 − $0)', money(win14), 3451.00);

const ms = X.monthSummary('2026-10');
eq('month total = grouped truth $3,755.50', money(ms.total), 3755.50);
eq('month worked days = 13', ms.daysWorked, 13);
eq('month hours = confirmed hours only', Math.round(ms.hours * 100) / 100, 129.5);
const row15 = ms.days.find(d => d.date === '2026-10-15');
eq('month row Oct 15 = $333.50 / 11.5h', money(row15.amount) + '/' + row15.hours, '333.5/11.5');
const row10 = ms.days.find(d => d.date === '2026-10-10');
eq('month row Oct 10 carries the unconfirmed flag', row10.unconfirmed, true);
const row11 = ms.days.find(d => d.date === '2026-10-11');
eq('month row Oct 11 carries the duplicate flag', row11.duplicate, true);

/* Invoice agreement: the builder over the same store totals the
   same money — Revenue and the invoice can no longer disagree. */
{
  const built = w.sb.Meticulous.shared.buildRevenueLines(X.entries(), X.extras(), 29, 'hourly');
  let invTotal = 0;
  built.lines.forEach(l => { invTotal += l.amt; });
  eq('invoice builder total = Revenue month total', money(invTotal), money(ms.total));
  eq('builder flags Oct 10 unconfirmed', JSON.stringify(built.unconfirmedDates), JSON.stringify(['2026-10-10']));
  eq('builder flags Oct 11 duplicate-blocked', JSON.stringify(built.duplicateDates), JSON.stringify(['2026-10-11']));
}

/* Day Details: the day total is grouped; the raw entries are still
   all there to view and fix. */
{
  const d = X.dayDetailData('2026-10-15');
  eq('day detail Oct 15 amount = $333.50 (not $624.66)', money(d.amount), 333.50);
  /* v116 supersedes this pin's shape, not its intent: the detail
     still LISTS both raw records — but only the builder-priced one
     renders as a money entry; the other is evidence ("Also
     recorded", no dollar amount), so the list can no longer sum
     past the header the way the owner's Oct 15 screenshot did. */
  eq('day detail Oct 15 lists ONE money entry (the priced record)', d.entries.length, 1);
  eq('day detail Oct 15 still lists the other raw record as evidence', d.evidence.length, 1);
  eq('day detail Oct 15 not flagged', d.unconfirmed + '/' + d.duplicate, 'false/false');
  const d10 = X.dayDetailData('2026-10-10');
  eq('day detail Oct 10 flagged unconfirmed', d10.unconfirmed, true);
  eq('day detail Oct 10 amount = $145.00', money(d10.amount), 145.00);
  const d11 = X.dayDetailData('2026-10-11');
  eq('day detail Oct 11 flagged duplicate, $0 counted', d11.duplicate + '/' + money(d11.amount), 'true/0');
}

console.log('\n— v118: the Month view’s Loads metric actually shows the number —');
{
  /* Item 9: monthSummary never computed loads and the Month view
     had no Loads card at all — the metric rendered NOTHING in
     every window the soak tried. The month's loads now ride the
     shared dayLoads ladder (the Oct 16 day: ticket loads 6). */
  const w2 = makeWorld();
  /* dayLoadsFor lives past the helper slice's end marker in the
     shipped file (it belongs to the graph-preview section); the
     real module is one IIFE, so eval the function in directly. */
  const dlSrc = (() => {
    const i = revSrc.indexOf('function dayLoadsFor');
    let depth = 0, j = revSrc.indexOf('{', i);
    for (; j < revSrc.length; j++) {
      if (revSrc[j] === '{') depth++;
      else if (revSrc[j] === '}') { depth--; if (depth === 0) return revSrc.slice(i, j + 1); }
    }
    throw new Error('dayLoadsFor unbalanced');
  })();
  vm.runInContext(dlSrc, w2.sb);
  w2.sb.App._store.set('dsp_list', [{
    date: '2026-10-16', scheduledAt: '2026-10-16T08:00', status: 'completed',
    tickets: [{ ocrType: 'haul_card', cardNumber: '22729', foremanHours: '10', loads: '6' }]
  }]);
  w2.sb.App._store.set('rev_entries', [
    { date: '2026-10-16', type: 'hourly', hours: '11.00', amount: '319.00', note: 'Dispatch: Aecon Inf · foreman 10h + travel 1h = 11h' }
  ]);
  const ms = w2.x.monthSummary('2026-10');
  eq('v118 loads: monthSummary sums the recorded loads through the shared ladder', ms.loads, 6);
  ok('v118 loads: the Month view renders a Loads card with the number',
    revSrc.indexOf('class="note">Loads</div>') !== -1 && revSrc.indexOf('ms.loads') !== -1);
  const msEmpty = w2.x.monthSummary('2026-09');
  eq('v118 loads: a month with no recorded loads shows 0, not a blank', msEmpty.loads, 0);
}

console.log('\nrevenue-grouped test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
