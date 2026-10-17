#!/usr/bin/env node
/* Meticulous v107 — ONE MONEY TRUTH (Stage 1 of the Oct 16
 * overnight program: "FIX EVERYTHING! TONIGHT!").
 *
 * Owner evidence (Oct 16, 2026): his day was a closed dispatch —
 * 11h paid, $319.00, haul card #22729 — plus its own tracker
 * session (stopped 7:00 PM). The app printed THREE different
 * truths: the manifest said $601.75 ($319 + the session's $282.75
 * stacked on top), the manifest End Time said 6:00 PM (derived
 * from the card, while he drove until 7:00 PM), Revenue's 30-day
 * window summed all of history under a "30 days" label (Custom
 * with empty From/To bounds matched every date), and Revenue
 * Loads read 0 against recorded loads.
 *
 * This suite loads the REAL shared builder + dayLoads (invoice.js
 * INV-CYCLE region), the REAL Revenue aggregation helpers, and the
 * REAL manifest collect() into one world, seeds his Oct 16 day in
 * its stored shapes, and proves every surface now tells the same
 * story: $319.00 everywhere, End 7:00 PM, Loads from the record.
 * Run: node tools/money-truth-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function eq(name, got, want) {
  if (String(got) === String(want)) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function money(n) { return Math.round((Number(n) || 0) * 100) / 100; }

const invSrc = fs.readFileSync(path.join(ROOT, 'modules', 'invoice.js'), 'utf8');
const revSrc = fs.readFileSync(path.join(ROOT, 'modules', 'revenue.js'), 'utf8');
const manSrc = fs.readFileSync(path.join(ROOT, 'modules', 'manifest.js'), 'utf8');
const ocrSrc = fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8');

function extractCommentRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('region not found: ' + beginMark);
  return src.slice(a, b + 2);
}
function invCycleRegion() { return extractCommentRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'); }
function revHelpers() {
  const start = revSrc.indexOf('var S = function');
  const end = revSrc.lastIndexOf('/*', revSrc.indexOf('v38 (B2): paste-import'));
  if (start === -1 || end === -1 || end <= start) throw new Error('revenue helper slice not found');
  return revSrc.slice(start, end);
}
function manifestHead() {
  return manSrc.slice(0, manSrc.indexOf('function toggles()'));
}
/* one function out of invoice.js by name (for the banner logic) */
function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('fn not found: ' + name);
  let depth = 0, j = src.indexOf('{', i);
  const start = j;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('fn unbalanced: ' + name);
}

function localISO(y, mo, d, h, mi, s) { return new Date(y, mo - 1, d, h, mi || 0, s || 0).toISOString(); }
function localMs(y, mo, d, h, mi, s) { return new Date(y, mo - 1, d, h, mi || 0, s || 0).getTime(); }

function world(mem, tracker) {
  const store = {
    get: (k, d) => (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d,
    set: (k, v) => { mem[k] = v; },
    del: (k) => { delete mem[k]; }
  };
  const sb = {
    console: console,
    App: {
      _store: store,
      _esc: s => String(s == null ? '' : s),
      _today: () => {
        const n = new Date();
        return n.getFullYear() + '-' + ('0' + (n.getMonth() + 1)).slice(-2) + '-' + ('0' + n.getDate()).slice(-2);
      },
      tracker: tracker || null
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(invCycleRegion(), sb);
  vm.runInContext(revHelpers() + '\n__rev = { dayAgg: dayAgg, summary: summary, inPeriod: inPeriod, monthSummary: monthSummary };', sb);
  vm.runInContext(manifestHead() + '\n__collectRef = collect;\n})();', sb);
  /* the invoice banner pair, with onb() stubbed per-case below */
  vm.runInContext('var __onbVal = {};\nfunction onb() { return __onbVal; }\n' +
    extractFn(invSrc, 'taxDeterminedByPrefs') + '\n' + extractFn(invSrc, 'jurisdictionBanner') +
    '\n__banner = jurisdictionBanner;', sb);
  return sb;
}

const D = '2026-10-16';
/* His Oct 16 day, in stored shapes: the completion entry the
   dispatch close logged (driver role: foreman 10h + travel 1h =
   11h × $29 = $319.00, amount explicit), the tracker shadow entry
   the stopped session logged (9.75h × $29 = $282.75, auto), the
   session record itself (ended 7:00 PM), and the closed dispatch
   (card #22729, foreman 10h, 6 loads confirmed at close). */
function oct16Mem() {
  return {
    onboarding: { payStandard: 'Hourly', payRate: '29', userRole: 'driver' },
    rev_entries: [
      { date: D, type: 'hourly', hours: '11.00', amount: '319.00', note: 'Dispatch: Aecon Inf · foreman 10h + travel 1h = 11h' },
      { date: D, type: 'hourly', hours: '9.75', amount: '282.75', auto: true, note: 'Auto from tracker' }
    ],
    rev_extras: [],
    rev_period: '30',
    sessions: [{ date: D, seconds: 39600, endedAt: localISO(2026, 10, 16, 19, 0, 0) }],
    dsp_list: [{
      date: D, scheduledAt: '2026-10-16T08:00', status: 'completed',
      endedAt: localMs(2026, 10, 16, 17, 47, 0),
      tickets: [{ ocrType: 'haul_card', cardNumber: '22729', foremanHours: '10', loads: '6' }]
    }]
  };
}

console.log('\n— the Oct 16 day: closed dispatch $319 + tracker session —');
{
  const sb = world(oct16Mem(), null);

  const agg = sb.__rev.dayAgg();
  eq('Revenue day row for Oct 16 is $319.00 (never $601.75)', money(agg[D].amount), 319);
  eq('Revenue day hours are the dispatch\u2019s 11 (not 11 + 9.75)', Number(agg[D].hours), 11);

  const sum = sb.__rev.summary();
  eq('Revenue window total is $319.00', money(sum.total), 319);
  eq('Revenue Loads sum the day\u2019s recorded loads (6, from the ticket)', sum.loads, 6);
  eq('Revenue worked days = 1', sum.workedDays, 1);

  const c = sb.__collectRef(D);
  eq('Manifest Total Earned is $319.00', money(c.earned), 319);
  eq('Manifest End Time is the session\u2019s real end, 7:00 PM', c.endT, '7:00 PM');
  eq('Manifest Start Time is the dispatch\u2019s 8:00 AM', c.startT, '8:00 AM');
  eq('Manifest loads read the ticket count', c.loads + '/' + c.loadsSrc, '6/tickets');
}

console.log('\n— Oct 15 stays pinned the other way (card finish beats session end) —');
{
  const mem = oct16Mem();
  mem.rev_entries = [
    { date: '2026-10-15', type: 'hourly', hours: '11.50', amount: '333.50', note: 'Dispatch: Aecon · foreman 10.5h + travel 1h' },
    { date: '2026-10-15', type: 'hourly', hours: '10.05', amount: '291.16', auto: true, note: 'Auto from tracker' }
  ];
  mem.sessions = [{ date: '2026-10-15', seconds: 36162, endedAt: localISO(2026, 10, 15, 18, 2, 43) }];
  mem.dsp_list = [{
    date: '2026-10-14', scheduledAt: '2026-10-15T08:00', status: 'completed',
    endedAt: localMs(2026, 10, 15, 19, 4, 0),
    tickets: [{ ocrType: 'haul_card', cardNumber: '21314', foremanHours: '10.5', loads: '7' }]
  }];
  const sb = world(mem, null);
  const c = sb.__collectRef('2026-10-15');
  eq('Oct 15 manifest earned is the completion only, $333.50', money(c.earned), 333.5);
  eq('Oct 15 End is the card finish 6:30 PM', c.endT, '6:30 PM');
  eq('Oct 15 End source is the card', c.endSrc, 'card');
}

console.log('\n— the live session never stacks on a confirmed day —');
{
  /* today (real clock): a closed dispatch AND a still-running
     session — the running hours must not move the day's money */
  const now = new Date();
  const T = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
  const mem = oct16Mem();
  mem.rev_entries = [
    { date: T, type: 'hourly', hours: '11.00', amount: '319.00', note: 'Dispatch: Aecon Inf · foreman 10h + travel 1h = 11h' }
  ];
  mem.dsp_list = [];
  mem.sessions = [];
  const tracker = { status: 'running', elapsed: 0, startTs: Date.now() - 3600 * 1000 };
  const sb = world(mem, tracker);
  const agg = sb.__rev.dayAgg();
  eq('live 1h on a dispatch day adds nothing (day stays $319 / 11h)',
    money(agg[T].amount) + '/' + Number(agg[T].hours), '319/11');
  ok('the day still paints as live', agg[T].live === true);

  /* and on a day with NO confirmed line, the live session counts */
  const mem2 = oct16Mem();
  mem2.rev_entries = [];
  mem2.dsp_list = [];
  mem2.sessions = [];
  const sb2 = world(mem2, tracker);
  const agg2 = sb2.__rev.dayAgg();
  eq('live 1h on an empty day counts ($29)', money(agg2[T].amount), 29);
}

console.log('\n— Custom window with empty bounds is the rolling window, not all of history —');
{
  const mem = oct16Mem();
  mem.rev_period = 'custom';
  mem.rev_customA = '';
  mem.rev_customB = '';
  const sb = world(mem, null);
  eq('a 2020 date is OUT of the empty-bounds custom window', sb.__rev.inPeriod('2020-01-05'), false);
  eq('a recent date is IN the empty-bounds custom window', sb.__rev.inPeriod(D), true);
  mem.rev_customA = '2026-10-01';
  mem.rev_customB = '2026-10-15';
  const sb2 = world(mem, null);
  eq('bounded custom still excludes Oct 16', sb2.__rev.inPeriod(D), false);
  eq('bounded custom still includes Oct 15', sb2.__rev.inPeriod('2026-10-15'), true);
}

console.log('\n— dayLoads priority: never a sum, recorded beats taps, taps beat geo —');
{
  const sb = world(oct16Mem(), null);
  const dl = sb.Meticulous.shared.dayLoads;
  eq('ticket loads win over everything',
    JSON.stringify(dl(D, { dispatches: [{ tickets: [{ loads: '6' }], loads: '9', loadsSet: true }], sessions: [{ manualLoads: 3 }], geoLoads: 4 })),
    JSON.stringify({ loads: 6, source: 'tickets' }));
  eq('a deliberately recorded dispatch count beats taps',
    JSON.stringify(dl(D, { dispatches: [{ loads: '8', loadsSet: true }], sessions: [{ manualLoads: 3 }], geoLoads: 4 })),
    JSON.stringify({ loads: 8, source: 'recorded' }));
  eq('the untouched form default (loads 1, no loadsSet) proves nothing',
    JSON.stringify(dl(D, { dispatches: [{ loads: '1' }], sessions: [{ manualLoads: 3 }], geoLoads: 4 })),
    JSON.stringify({ loads: 3, source: 'taps' }));
  eq('the learned-site count is the last resort',
    JSON.stringify(dl(D, { dispatches: [], sessions: [], geoLoads: 5 })),
    JSON.stringify({ loads: 5, source: 'sites' }));
  eq('nothing recorded anywhere = 0, honestly',
    JSON.stringify(dl(D, { dispatches: [], sessions: [] })),
    JSON.stringify({ loads: 0, source: '' }));
}

console.log('\n— the invoice location banner follows the tax facts (fold-in) —');
{
  const sb = world(oct16Mem(), null);
  sb.__onbVal = { rateIncludesTax: true, invoiceTaxRate: '5' };
  eq('tax-included ON + rate set + NO province → no banner on the invoice form',
    sb.__banner(true), '');
  ok('payroll keeps the strict banner in the same state',
    sb.__banner(false).indexOf('Set your location first') >= 0);
  sb.__onbVal = { rateIncludesTax: false, invoiceTaxRate: '5' };
  ok('tax NOT determined by Preferences → the invoice banner stands',
    sb.__banner(true).indexOf('Set your location first') >= 0);
  sb.__onbVal = { country: 'Canada', province: 'AB' };
  eq('province set → no banner either way', sb.__banner(true) + sb.__banner(false), '');
}

console.log('\nmoney-truth: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
