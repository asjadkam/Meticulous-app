#!/usr/bin/env node
/* Meticulous v302 — REVENUE-LEARNS-PAY-CYCLE (owner, Oct 31,
 * 2026 17:17 MDT, with his Revenue screen recording: "Revenue
 * module should learn by itself... I am obviously getting paid
 * every 1st and 5th... That another ML you can boast about.").
 *
 * The module learns the pay rhythm from the user's OWN invoicing
 * history (inv_list pa/pb + inv_stubs a/b) — never hard-coded:
 *   (a) an Asjad-shaped history (settled #1151's Oct 1–15 span
 *       issued in-app twice as #1152/#1153, plus #1154 Oct 16–31,
 *       plus a one-day test-era record) learns SEMI-MONTHLY,
 *       opens on Nov 1–15, chips/snap/payday are right, and the
 *       October totals reconcile to the cent with his own
 *       recording ($6,864.21 · 74 loads; Oct 16–31 = $3,253.71,
 *       the as-issued #1154 total, phantom day included — the
 *       phantom is a separate queue item, untouched here);
 *   (b) a weekly-shaped history learns WEEKLY (Mon-start);
 *   (c) sparse/split histories learn NOTHING and the module's
 *       pre-v302 behaviour is intact;
 *   (d) monthly + biweekly shapes learn their own rhythms.
 *
 * Run: node tools/revenue-paycycle-v302-test.js
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
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function money(name, got, want) {
  ok(name, Math.round((Number(got) || 0) * 100) === Math.round(want * 100),
    'got ' + got + ', want ' + want);
}

function extractCommentRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('region not found: ' + beginMark);
  return src.slice(a, b + 2);
}
const invCycleRegion = extractCommentRegion(read('modules/invoice.js'), 'INV-CYCLE-BEGIN', 'INV-CYCLE-END');

function memStore(seed) {
  const data = JSON.parse(JSON.stringify(seed || {}));
  return {
    _data: data,
    get: function (k, d) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : d; },
    set: function (k, v) { data[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete data[k]; }
  };
}
function makeWorld(seed, today) {
  const store = memStore(seed);
  const sb = {
    window: {}, Meticulous: { modules: {} }, console: console,
    App: {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s); },
      _today: function () { return today; }
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(invCycleRegion, sb);       /* the real shared builder + dayLoads */
  vm.runInContext(read('modules/revenue.js'), sb);
  return { sb: sb, store: store, rev: sb.Meticulous.modules.revenue, pc: sb.Meticulous.modules.revenue._payCycle };
}

/* ---------- (a) Asjad-shaped history ---------- */
console.log('\n(a) Asjad-shaped history — learns semi-monthly 1st + 15th');
const invA = [
  { id: 'inv0', no: '10', date: '2026-10-14', pa: '2026-10-14', pb: '2026-10-14' }, /* test-era one-day print: teaches nothing */
  { id: 'inv2', no: '1152', date: '2026-10-16', pa: '2026-10-01', pb: '2026-10-15' },
  { id: 'inv3', no: '1153', date: '2026-10-17', pa: '2026-10-01', pb: '2026-10-15' }, /* duplicate issue of the same period */
  { id: 'inv4', no: '1154', date: '2026-10-31', pa: '2026-10-16', pb: '2026-10-31' }
];
/* His October day book: Oct 1–15 = #1151's 124.5 h / $3,610.50;
   Oct 16–31 = #1154 as issued, $3,253.71 (the Oct 25 phantom is
   the lone tracker entry — counted, unconfirmed, untouched). */
function ent(date, hours, amount, extra) {
  const e = { date: date, type: 'hourly', hours: hours, amount: amount, note: 'Day work' };
  if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
  return e;
}
const entriesA = [];
[['2026-10-01', 10], ['2026-10-02', 9.5], ['2026-10-03', 9], ['2026-10-05', 10],
 ['2026-10-06', 9.5], ['2026-10-07', 10], ['2026-10-08', 9], ['2026-10-09', 10],
 ['2026-10-10', 9.5], ['2026-10-12', 9], ['2026-10-13', 10], ['2026-10-14', 9.5],
 ['2026-10-15', 9.5]].forEach(function (d) { entriesA.push(ent(d[0], d[1], (d[1] * 29).toFixed(2))); });
entriesA.push(ent('2026-10-16', 11, '319.00'));
entriesA.push(ent('2026-10-17', 10, '290.00'));
entriesA.push(ent('2026-10-19', 10.5, '304.50'));
entriesA.push(ent('2026-10-20', 11, '319.00'));
entriesA.push(ent('2026-10-21', 10.5, '304.50'));
entriesA.push(ent('2026-10-22', 11, '319.00'));
entriesA.push(ent('2026-10-25', 4.7, '136.21', { auto: true, note: 'Auto from tracker' }));
entriesA.push(ent('2026-10-26', 11, '319.00'));
entriesA.push(ent('2026-10-28', 5, '145.00'));
entriesA.push(ent('2026-10-29', 10.5, '304.50'));
entriesA.push(ent('2026-10-30', 10, '290.00'));
entriesA.push(ent('2026-10-31', 7, '203.00'));
const geoA = { days: {} };
[['2026-10-01', 3], ['2026-10-02', 3], ['2026-10-03', 2], ['2026-10-05', 3],
 ['2026-10-06', 2], ['2026-10-07', 3], ['2026-10-08', 2], ['2026-10-09', 3],
 ['2026-10-10', 2], ['2026-10-12', 3], ['2026-10-13', 2], ['2026-10-14', 2],
 ['2026-10-15', 1], ['2026-10-20', 12], ['2026-10-21', 17], ['2026-10-26', 10],
 ['2026-10-31', 4]].forEach(function (d) { geoA.days[d[0]] = { count: d[1] }; });

const wA = makeWorld({
  onboarding: { payStandard: 'hourly', ownWageRate: 29, payRate: 29 },
  inv_list: invA, rev_entries: entriesA, geoloads: geoA
}, '2026-11-01');
const spansA = wA.pc.collectSpans(invA, []);
eq('A1 duplicate issues + the one-day test print collapse to 2 distinct spans', spansA,
  [{ a: '2026-10-01', b: '2026-10-15' }, { a: '2026-10-16', b: '2026-10-31' }]);
const ruleA = wA.pc.learn(spansA);
eq('A2 learns semi-monthly', ruleA && ruleA.kind, 'semi');
eq('A3 the current period on Nov 1 is Nov 1–15', wA.pc.periodOf(ruleA, '2026-11-01'),
  { a: '2026-11-01', b: '2026-11-15' });
eq('A4 Oct 31 belongs to Oct 16–31', wA.pc.periodOf(ruleA, '2026-10-31'),
  { a: '2026-10-16', b: '2026-10-31' });
eq('A5 chips: current + 3 back, capped', wA.pc.periodsBack(ruleA, '2026-11-01', 4),
  [{ a: '2026-11-01', b: '2026-11-15' }, { a: '2026-10-16', b: '2026-10-31' },
   { a: '2026-10-01', b: '2026-10-15' }, { a: '2026-09-16', b: '2026-09-30' }]);
eq('A6 a mis-tapped range snaps out to whole periods', wA.pc.snap(ruleA, '2026-10-03', '2026-11-17'),
  { a: '2026-10-01', b: '2026-11-30' });
eq('A7 an already-true range is left alone', wA.pc.snap(ruleA, '2026-10-01', '2026-10-31'),
  { a: '2026-10-01', b: '2026-10-31' });
eq('A8 payday for Nov 1–15 is ~Nov 15', wA.pc.payday(ruleA, { a: '2026-11-01', b: '2026-11-15' }), '2026-11-15');
eq('A9 payday for Oct 16–31 is ~Nov 1', wA.pc.payday(ruleA, { a: '2026-10-16', b: '2026-10-31' }), '2026-11-01');
eq('A10 the rule in plain words', wA.pc.words(ruleA), 'you invoice on the 15th and month-end');

const ruleA2 = wA.pc.refresh();
eq('A11 refresh learns semi-monthly', ruleA2 && ruleA2.kind, 'semi');
eq('A12 the learned rule is stored per profile', (wA.store._data.rev_paycycle_p1 || {}).kind, 'semi');
eq('A13 first learn opens the view on the learned period', wA.store._data.rev_period, 'learned');
eq('A14 …on the live current-period chip', wA.store._data.rev_learnedOff, 0);
eq('A15 bounds resolve to Nov 1–15', wA.pc.bounds(), { a: '2026-11-01', b: '2026-11-15' });
eq('A16 the period label length is the period itself', wA.pc.periodDays(), 15);
ok('A17 inPeriod honours the learned bounds',
  wA.pc.inPeriod('2026-11-15') === true && wA.pc.inPeriod('2026-11-16') === false && wA.pc.inPeriod('2026-10-31') === false);
wA.store.set('rev_period', '30');
wA.pc.refresh();
eq('A18 a later refresh never re-seizes his own pick', wA.store._data.rev_period, '30');

wA.store.set('rev_period', 'custom');
wA.store.set('rev_customA', '2026-10-01');
wA.store.set('rev_customB', '2026-10-31');
const sumOct = wA.pc.summary();
money('A19 Oct 1–31 total reconciles with his recording', sumOct.total, 6864.21);
eq('A20 Oct 1–31 loads reconcile', sumOct.loads, 74);
money('A21 the Month path agrees independently', wA.rev.monthSummary('2026-10').total, 6864.21);
wA.store.set('rev_period', 'learned');
wA.store.set('rev_learnedOff', 1);
wA.store.set('rev_learnedA', '2026-10-16');
wA.store.set('rev_learnedB', '2026-10-31');
const sumHalf = wA.pc.summary();
money('A22 the Oct 16–31 chip totals the as-issued #1154', sumHalf.total, 3253.71);
eq('A23 …with its 43 loads', sumHalf.loads, 43);

/* A stray off-grid span cannot veto the book's rhythm */
const ruleA3 = wA.pc.learn(wA.pc.collectSpans(invA.concat([
  { id: 'invX', no: '9', date: '2026-09-20', pa: '2026-09-01', pb: '2026-09-30' }
]), []));
eq('A24 a full-month stray among semi-monthly spans still learns semi', ruleA3 && ruleA3.kind, 'semi');

/* ---------- (b) Weekly-shaped history ---------- */
console.log('\n(b) Weekly-shaped history — learns weekly');
const invB = [
  { id: 'w1', no: '201', date: '2026-10-12', pa: '2026-10-05', pb: '2026-10-11' },
  { id: 'w2', no: '202', date: '2026-10-19', pa: '2026-10-12', pb: '2026-10-18' }
];
const stubsB = [{ id: 'ps1', a: '2026-10-19', b: '2026-10-25' }]; /* the third week lives on a pay stub */
const wB = makeWorld({
  onboarding: { payStandard: 'hourly', ownWageRate: 29, payRate: 29 },
  inv_list: invB, inv_stubs: stubsB
}, '2026-10-28');
const spansB = wB.pc.collectSpans(invB, stubsB);
eq('B1 invoice + stub spans merge into one history', spansB.length, 3);
const ruleB = wB.pc.learn(spansB);
eq('B2 learns weekly', ruleB && ruleB.kind, 'weekly');
eq('B3 …starting Mondays', ruleB && ruleB.dow, 1);
eq('B4 the current week on Wed Oct 28 is Oct 26–Nov 1', wB.pc.periodOf(ruleB, '2026-10-28'),
  { a: '2026-10-26', b: '2026-11-01' });
eq('B5 snap pulls a ragged range to whole weeks', wB.pc.snap(ruleB, '2026-10-07', '2026-10-20'),
  { a: '2026-10-05', b: '2026-10-25' });
eq('B6 payday for Oct 19–25 is ~Oct 26', wB.pc.payday(ruleB, { a: '2026-10-19', b: '2026-10-25' }), '2026-10-26');
eq('B7 the rule in plain words', wB.pc.words(ruleB), 'you invoice every week (Mondays)');
wB.pc.refresh();
eq('B8 refresh stores the weekly rule', (wB.store._data.rev_paycycle_p1 || {}).kind, 'weekly');
eq('B9 bounds are the live week', wB.pc.bounds(), { a: '2026-10-26', b: '2026-11-01' });
eq('B10 a week is 7 days on the label', wB.pc.periodDays(), 7);

/* ---------- (c) Sparse / split history — learns nothing ---------- */
console.log('\n(c) Sparse or split history — no rule, old behaviour intact');
const wC = makeWorld({ onboarding: { payStandard: 'hourly', ownWageRate: 29, payRate: 29 } }, '2026-10-31');
const pc = wC.pc;
eq('C1 no history learns nothing', pc.learn([]), null);
eq('C2 one period is too little to teach', pc.learn([{ a: '2026-10-01', b: '2026-10-15' }]), null);
eq('C3 the same period twice is still one distinct period',
  pc.learn([{ a: '2026-10-01', b: '2026-10-15' }, { a: '2026-10-01', b: '2026-10-15' }]), null);
eq('C4 a split history (one semi + one weekly) learns nothing',
  pc.learn([{ a: '2026-10-01', b: '2026-10-15' }, { a: '2026-10-05', b: '2026-10-11' }]), null);
eq('C5 two Mondays + two Tuesdays is no rhythm either',
  pc.learn([{ a: '2026-10-05', b: '2026-10-11' }, { a: '2026-10-06', b: '2026-10-12' },
            { a: '2026-10-12', b: '2026-10-18' }, { a: '2026-10-13', b: '2026-10-19' }]), null);
eq('C6 refresh finds no rule', pc.refresh(), null);
ok('C7 nothing speculative is stored', !wC.store._data.rev_paycycle_p1);
ok('C8 the period selection is untouched', !('rev_period' in wC.store._data));
wC.store.set('rev_period', 'custom');
wC.store.set('rev_customA', '2026-10-01');
wC.store.set('rev_customB', '2026-10-31');
ok('C9 custom framing behaves exactly as before',
  pc.inPeriod('2026-10-15') === true && pc.inPeriod('2026-09-15') === false && pc.periodDays() === 31);

/* ---------- (d) Monthly + biweekly shapes ---------- */
console.log('\n(d) Monthly and biweekly shapes');
const pcD = wC.pc;
const ruleM = pcD.learn([{ a: '2026-09-01', b: '2026-09-30' }, { a: '2026-10-01', b: '2026-10-31' }]);
eq('D1 full months learn monthly', ruleM && ruleM.kind, 'monthly');
eq('D2 the current month is the period', pcD.periodOf(ruleM, '2026-11-10'), { a: '2026-11-01', b: '2026-11-30' });
eq('D3 monthly payday is ~the 1st', pcD.payday(ruleM, { a: '2026-10-01', b: '2026-10-31' }), '2026-11-01');
const ruleBi = pcD.learn([{ a: '2026-10-05', b: '2026-10-18' }, { a: '2026-10-19', b: '2026-11-01' },
                          { a: '2026-11-02', b: '2026-11-15' }]);
eq('D4 14-day spans learn biweekly', ruleBi && ruleBi.kind, 'biweekly');
eq('D5 the anchored grid holds weeks later', pcD.periodOf(ruleBi, '2026-11-03'), { a: '2026-11-02', b: '2026-11-15' });
eq('D6 biweekly payday is the next period start', pcD.payday(ruleBi, { a: '2026-11-02', b: '2026-11-15' }), '2026-11-16');

/* ---------- wiring pins (source order + face strings) ---------- */
console.log('\n(wiring) render learns before it frames; the face carries the new words');
const revSrc = read('modules/revenue.js');
ok('W1 render re-learns before reading the period',
  revSrc.indexOf('var pcRule = refreshPayCycle();') !== -1 &&
  revSrc.indexOf('var pcRule = refreshPayCycle();') < revSrc.indexOf("var period = S('period', '30');"));
ok('W2 learned chips are capped at four', revSrc.indexOf("pcPeriodsBack(pcRule, App._today(), 4)") !== -1);
ok('W3 the learned rule prints in plain words', revSrc.indexOf('Learned from your invoices:') !== -1);
ok('W4 the snap names itself', revSrc.indexOf('Snapped to your pay periods:') !== -1);
ok('W5 the legacy chips remain the no-rule face', revSrc.indexOf('PERIOD_OPTS.map') !== -1);

console.log('\nrevenue-paycycle-v302: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
