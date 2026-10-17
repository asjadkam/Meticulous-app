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
function revRegion() { return extractCommentRegion(revSrc, 'DAY-DETAIL-BEGIN', 'DAY-DETAIL-END'); }
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

console.log('\n— dayLoads priority: never a sum, recorded beats the machine, the machine beats taps (v140) —');
{
  const sb = world(oct16Mem(), null);
  const dl = sb.Meticulous.shared.dayLoads;
  eq('ticket loads win over everything',
    JSON.stringify(dl(D, { dispatches: [{ tickets: [{ loads: '6' }], loads: '9', loadsSet: true }], sessions: [{ manualLoads: 3 }], geoLoads: 4 })),
    JSON.stringify({ loads: 6, source: 'tickets' }));
  eq('a deliberately recorded dispatch count beats the machine',
    JSON.stringify(dl(D, { dispatches: [{ loads: '8', loadsSet: true }], sessions: [{ manualLoads: 3 }], geoLoads: 4 })),
    JSON.stringify({ loads: 8, source: 'recorded' }));
  /* v140 PIN MOVE: this case pinned taps-over-geo (the v107 ladder).
     The owner's law — load counts are never the driver's job — moves
     the movement count above his taps: the untouched form default now
     falls to the machine count, and taps speak only when the machine
     has nothing. */
  eq('the untouched form default (loads 1, no loadsSet) proves nothing — the movement count speaks',
    JSON.stringify(dl(D, { dispatches: [{ loads: '1' }], sessions: [{ manualLoads: 3 }], geoLoads: 4 })),
    JSON.stringify({ loads: 4, source: 'sites' }));
  eq('taps are the correction when the machine has nothing',
    JSON.stringify(dl(D, { dispatches: [{ loads: '1' }], sessions: [{ manualLoads: 3 }] })),
    JSON.stringify({ loads: 3, source: 'taps' }));
  eq('the learned-site count alone still reads',
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

console.log('\n— v116: the pay-period chips fit a phone screen (owner order, Oct 16 2026) —');
{
  const cssSrc = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
  ok('the chips row carries the wrapping class', revSrc.indexOf('<div class="row rvchips">') >= 0);
  ok('all six period chips still render from PERIOD_OPTS', ['7', '14', '30', '45', '60', 'custom'].every(function (p) {
    return revSrc.indexOf("'" + p + "'") >= 0;
  }) && revSrc.indexOf('data-p="\' + p[0]') >= 0);
  const chipsDiv = /\.rvchips\{([^}]*)\}/.exec(cssSrc);
  const chipsKid = /\.rvchips>\*\{([^}]*)\}/.exec(cssSrc);
  ok('.rvchips wraps — no overflow-x, no cut-off chip', !!chipsDiv && /flex-wrap\s*:\s*wrap/.test(chipsDiv[1]) && !/overflow-x/.test(chipsDiv[1]));
  ok('.rvchips gap is the 8px the fit math assumes', !!chipsDiv && /gap\s*:\s*8px/.test(chipsDiv[1]));
  ok('.rvchips children may shrink below their content size', !!chipsKid && /min-width\s*:\s*0/.test(chipsKid[1]));
  /* The fit in numbers: a flex-basis in (25%, 33%] gives exactly
     three chips per row at any width. At a 360px viewport the row
     is 360 − 2×20 (.pad) − 2×20 (.card) = 280px wide; three chips
     at basis + two 8px gaps fit inside it, a fourth cannot — so
     it wraps to a second row, fully on screen. */
  const basisM = !!chipsKid && /flex\s*:\s*1\s+1\s+(\d+(?:\.\d+)?)%/.exec(chipsKid[1]);
  ok('.rvchips children flex-basis yields three per row', !!basisM && +basisM[1] > 25 && +basisM[1] <= 33, basisM ? basisM[1] + '%' : 'no match');
  if (basisM) {
    const rowW = 360 - 2 * 20 - 2 * 20, b = +basisM[1] / 100 * rowW, gap = 8;
    ok('at 360px wide: three chips + gaps fit the row', 3 * b + 2 * gap <= rowW, (3 * b + 2 * gap).toFixed(1) + ' vs ' + rowW);
    ok('at 360px wide: a fourth chip cannot fit — it wraps', 4 * b + 3 * gap > rowW, (4 * b + 3 * gap).toFixed(1) + ' vs ' + rowW);
  }
}

console.log('\n— v116: the day detail + flat list tell the header\u2019s truth (owner screenshots, Oct 16 2026) —');
{
  /* Thu Oct 15 in the owner's exact shape: the day recorded three
     ways (sheet import $333.50, dispatch completion $333.50) plus
     two 0.01h tracker drips ($0.24 / $0.23). The header prices the
     dispatch once; the entries list must show exactly that. */
  const mem = oct16Mem();
  mem.rev_entries = [
    { date: '2026-10-15', type: 'hourly', hours: '11.5', amount: '333.50', note: 'Hours sheet import' },
    { date: '2026-10-15', type: 'hourly', hours: '0.01', amount: '0.24', auto: true, note: 'Auto from tracker' },
    { date: '2026-10-15', type: 'hourly', hours: '11.5', amount: '333.50', note: 'Dispatch: Aecon Infrastructure · foreman 10.5h + travel 1h = 11.5h (Card #21314)' },
    { date: '2026-10-15', type: 'hourly', hours: '0.01', amount: '0.23', auto: true, note: 'Auto from tracker' }
  ];
  mem.sessions = [];
  mem.dsp_list = [];
  const sb = world(mem, null);
  vm.runInContext(revRegion() + '\n' + extractFn(revSrc, 'graphTap') +
    '\n__v116 = { dayDetailData: dayDetailData, entryMoneyFlags: entryMoneyFlags, graphTap: graphTap };', sb);

  const d = sb.__v116.dayDetailData('2026-10-15');
  eq('Oct 15 header is the builder truth ($333.50 / 11.5h)', money(d.amount) + '/' + Number(d.hours), '333.5/11.5');
  eq('Oct 15 renders exactly ONE money entry', d.entries.length, 1);
  eq('the money entry is the dispatch record', d.entries.length && d.entries[0].src, 'dispatch');
  eq('the money entry is $333.50', d.entries.length && money(d.entries[0].amount), 333.5);
  eq('displayed entries sum EXACTLY to the header earnings',
    money(d.entries.reduce((a, e) => a + e.amount, 0)), money(d.amount));
  eq('displayed entries sum EXACTLY to the header hours',
    d.entries.reduce((a, e) => a + e.hours, 0), Number(d.hours));
  eq('the other three records are evidence, not money', d.evidence.length, 3);
  ok('both tracker drips are in evidence, flagged as drips',
    d.evidence.filter(e => e.drip).length === 2);
  ok('no drip is a money entry', d.entries.every(e => !e.drip));
  ok('the sheet import is evidence (the dispatch outranks it)',
    d.evidence.some(e => e.src === 'entry'));

  /* the flat list on the same fixture: one money flag — the dispatch */
  const fl = sb.__v116.entryMoneyFlags();
  eq('flat list: exactly one money entry for Oct 15', fl.filter(f => f.money).length, 1);
  ok('flat list: the money entry is the dispatch (index 2)', fl[2].money === true && fl[2].src === 'dispatch');
  ok('flat list: the sheet import is not money', fl[0].money === false);
  ok('flat list: both drips are not money', fl[1].money === false && fl[3].money === false && fl[1].drip && fl[3].drip);

  /* TODAY's shape (Oct 16): tracker $282.75 stacked over the
     closed dispatch $319 — the flat list leads with the dispatch */
  const sb16 = world(oct16Mem(), null);
  vm.runInContext(revRegion() + '\n__v116 = { dayDetailData: dayDetailData, entryMoneyFlags: entryMoneyFlags };', sb16);
  const fl16 = sb16.__v116.entryMoneyFlags();
  ok('Oct 16 flat list: the dispatch is money', fl16[0].money === true && fl16[0].src === 'dispatch');
  ok('Oct 16 flat list: the tracker session is NOT money on a dispatch day', fl16[1].money === false && fl16[1].src === 'tracker');
  const d16 = sb16.__v116.dayDetailData(D);
  eq('Oct 16 detail: one money entry, $319.00', d16.entries.length + '/' + money(d16.entries[0] ? d16.entries[0].amount : 0), '1/319');
  eq('Oct 16 detail: the session entry sits in evidence', d16.evidence.length, 1);

  /* a tracker-only day: the session entry IS the day's entry */
  const memT = oct16Mem();
  memT.rev_entries = [
    { date: '2026-10-14', type: 'hourly', hours: '9.75', amount: '282.75', auto: true, note: 'Auto from tracker' }
  ];
  memT.sessions = []; memT.dsp_list = [];
  const sbT = world(memT, null);
  vm.runInContext(revRegion() + '\n__v116 = { dayDetailData: dayDetailData, entryMoneyFlags: entryMoneyFlags };', sbT);
  const flT = sbT.__v116.entryMoneyFlags();
  ok('tracker-only day: the session entry is money', flT[0].money === true);
  const dT = sbT.__v116.dayDetailData('2026-10-14');
  eq('tracker-only day: detail shows the session as the money entry', dT.entries.length, 1);
  eq('tracker-only day: no evidence rows', dT.evidence.length, 0);

  /* the graph's two-tap state machine */
  const gt = sb.__v116.graphTap;
  eq('graph: first tap selects, opens nothing', JSON.stringify(gt(null, '2026-10-15')), JSON.stringify({ sel: '2026-10-15', open: null }));
  eq('graph: second tap on the SAME day opens it', JSON.stringify(gt('2026-10-15', '2026-10-15')), JSON.stringify({ sel: null, open: '2026-10-15' }));
  eq('graph: tapping a DIFFERENT day moves the selection only', JSON.stringify(gt('2026-10-15', '2026-10-16')), JSON.stringify({ sel: '2026-10-16', open: null }));
  ok('graph: preview hosts exist in both views (chart + Month list)', (revSrc.match(/id="rv_gprev"/g) || []).length >= 2);
  ok('graph: the chart note teaches the two-tap', revSrc.indexOf('Tap a bar to preview the day') >= 0);
  ok('graph: the selected bar paints navy in drawChart', revSrc.indexOf("dates[i] === graphSel") >= 0);
  ok('day detail: the Also recorded card renders evidence with no money column of its own',
    revSrc.indexOf('Also recorded') >= 0 && revSrc.indexOf('rv_ev_toggle') >= 0);
}

console.log('\n— v118: manifest END on the REAL record shapes (a READ ticket finish) —');
{
  /* The v107 fixture's tickets carried no finishTime, so the
     derived finish competed with the session and won/lost
     correctly. His REAL Oct 16 ticket carries a READ finish
     ("6:00 PM" — the card's own 8:00 + 10h), and the read finish
     short-circuited the competition entirely: 6:00 PM printed
     while he drove until 7:00 PM. The card's finish (read or
     derived, the later of the two) now competes with the
     session's end exactly like v107's derived finish did. */
  const mem = oct16Mem();
  mem.dsp_list[0].tickets[0].startTime = '8:00 AM';
  mem.dsp_list[0].tickets[0].finishTime = '6:00 PM';
  const w = world(mem);
  const c = w.__collectRef('2026-10-16');
  eq('v118 end: Oct 16 real shape — the session’s 7:00 PM beats the card’s read 6:00 PM finish', c.endT, '7:00 PM');
  eq('v118 end: Oct 16 real shape — the winning end is the tracker’s', c.endSrc, 'tracker');
}
{
  /* Oct 15 with a READ finish: card 6:30 PM, session 6:02 PM,
     close stamp 7:04 PM — the card still wins; the close stamp
     never competes. */
  const mem15 = {
    onboarding: { payStandard: 'Hourly', payRate: '29', userRole: 'driver' },
    rev_entries: [{ date: '2026-10-15', type: 'hourly', hours: '11.5', amount: '333.50', note: 'Hours sheet import' }],
    rev_extras: [], rev_period: '30',
    sessions: [{ date: '2026-10-15', seconds: 39720, endedAt: localISO(2026, 10, 15, 18, 2, 0) }],
    dsp_list: [{
      date: '2026-10-14', scheduledAt: '2026-10-15T08:00', status: 'completed',
      endedAt: localMs(2026, 10, 15, 19, 4, 0),
      tickets: [{ ocrType: 'haul_card', cardNumber: '21314', foremanHours: '10.5', loads: '5', startTime: '8:00 AM', finishTime: '6:30 PM' }]
    }]
  };
  const w15 = world(mem15);
  const c15 = w15.__collectRef('2026-10-15');
  eq('v118 end: Oct 15 real shape — the card’s read 6:30 PM finish stands', c15.endT, '6:30 PM');
  eq('v118 end: Oct 15 real shape — the winning end is the card’s', c15.endSrc, 'card');
}

console.log('\n— v118: the dashboard Manifest preview quotes the BUILDER’s day —');
{
  /* Item 11: status() summed the raw session seconds — "9 h 45 m
     worked" for Oct 16 — while the day's worked truth (and the
     Manifest's own header) is the closed dispatch's 11 h. With
     a priced record speaking for today, the preview quotes the
     builder's dayHours; a tracker-only day keeps the session
     span, which there IS the day's truth. */
  const manSrcFull = fs.readFileSync(path.join(ROOT, 'modules', 'manifest.js'), 'utf8');
  function extractStatus(src) {
    const i = src.indexOf('status: function');
    if (i === -1) throw new Error('status fn not found');
    let depth = 0, j = src.indexOf('{', i);
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i + 'status: '.length, j + 1); }
    }
    throw new Error('status fn unbalanced');
  }
  const mem = oct16Mem();
  const w = world(mem);
  w.App._today = () => '2026-10-16';
  w.App.userRole = () => 'driver';
  /* in the shipped module, status() reads the module-scope G —
     the same App._store.get the world's collect closure uses;
     the extracted function gets it as a context global here. */
  w.G = function (k, d) { return w.App._store.get(k, d); };
  vm.runInContext('__manStatus = (' + extractStatus(manSrcFull) + ');', w);
  eq('v118 preview: Oct 16 shape (tracker 9.75h + closed dispatch 11h) → "11 h 0 m worked", the builder’s day',
    w.__manStatus(), 'Today: 11 h 0 m worked');
  const memT = oct16Mem();
  memT.dsp_list = [];
  memT.rev_entries = [memT.rev_entries[1]]; // tracker entry only
  memT.sessions[0].seconds = 35100; // the session's own span: 9.75 h, matching its entry
  const wT = world(memT);
  wT.App._today = () => '2026-10-16';
  wT.App.userRole = () => 'driver';
  wT.G = function (k, d) { return wT.App._store.get(k, d); };
  vm.runInContext('__manStatus = (' + extractStatus(manSrcFull) + ');', wT);
  eq('v118 preview: a tracker-only day keeps the session span (9 h 45 m)',
    wT.__manStatus(), 'Today: 9 h 45 m worked');
}

console.log('\n— v124: the dashboard Revenue preview mirrors the period selected inside —');
{
  /* History: v118 made status() a FIXED "Last 30d" glance that
     ignored rev_period entirely (it had mirrored the selection
     before that, and the number seemed to change its mind).
     v124 (owner, Oct 17 07:45 — "why is it not showing me what I
     have selected inside as my period") restores the mirror, but
     through summary() — the module's own aggregation — with the
     selected window NAMED on the card. The two v118 pins below
     are flipped deliberately: period=7 now reads "Last 7d", and
     a custom selection with valid bounds names its own range;
     custom WITHOUT bounds falls back to the rolling window,
     exactly as inPeriod()/periodDays() do. */
  const revSrcFull = fs.readFileSync(path.join(ROOT, 'modules', 'revenue.js'), 'utf8');
  function extractRevStatus(src) {
    const i = src.indexOf('status: function');
    if (i === -1) throw new Error('rev status not found');
    let depth = 0, j = src.indexOf('{', i);
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i + 'status: '.length, j + 1); }
    }
    throw new Error('rev status unbalanced');
  }
  const mem = oct16Mem();
  mem.rev_period = '7'; // a 7-day window selected inside the module…
  const w = world(mem);
  w.App._today = () => '2026-10-16';
  vm.runInContext('__revStatus = (' + extractRevStatus(revSrcFull) + ');', w);
  eq('v124 preview: rev_period=7 selected, the card quotes the selected window',
    w.__revStatus(), 'Last 7d: $319');
  mem.rev_period = 'custom';
  const w2 = world(mem);
  w2.App._today = () => '2026-10-16';
  vm.runInContext('__revStatus = (' + extractRevStatus(revSrcFull) + ');', w2);
  eq('v124 preview: rev_period=custom with NO bounds falls back to the rolling 30d (as inPeriod does)',
    w2.__revStatus(), 'Last 30d: $319');
  mem.rev_customA = '2026-10-01';
  mem.rev_customB = '2026-10-31';
  const w3 = world(mem);
  w3.App._today = () => '2026-10-16';
  vm.runInContext('__revStatus = (' + extractRevStatus(revSrcFull) + ');', w3);
  eq('v124 preview: a bounded custom period names its own range on the card',
    w3.__revStatus(), 'Oct 1 – Oct 31: $319');
  delete mem.rev_period; delete mem.rev_customA; delete mem.rev_customB;
  const w4 = world(mem);
  w4.App._today = () => '2026-10-16';
  vm.runInContext('__revStatus = (' + extractRevStatus(revSrcFull) + ');', w4);
  eq('v124 preview: no selection stored → the default reads exactly as it did under v118',
    w4.__revStatus(), 'Last 30d: $319');
}

console.log('\nmoney-truth: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
