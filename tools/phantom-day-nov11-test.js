#!/usr/bin/env node
/* Meticulous v418 — PHANTOM-DAY-NOV1 / GHOST-AUTO-NOV8 /
 * NOV2-SAVE-BLOCK suite.
 *
 * Owner evidence (Nov 11, 2026 screenshot, invoice Line items,
 * period Nov 1–15): the invoice carried a 14.78h / $428.71
 * "from tracker — unconfirmed" line for Nov 1 (a Sunday, his day
 * off — he never worked it), a $0.01 "Auto from tracker" line for
 * Nov 8 (also a Sunday day off), and a red banner refusing to save
 * at all because Nov 2 holds more than one tracker entry with no
 * dispatch completion.
 *
 * This suite loads the REAL INV-CYCLE region of modules/invoice.js
 * (which publishes Meticulous.shared.buildRevenueLines) and the
 * real store from js/app.js into a vm world — the same harness
 * shape as tools/invoice-cycle-test.js — and proves:
 *   (1) a tracker day whose only session record started the day
 *       BEFORE (sessions are dated by their end day, so the whole
 *       span books onto the stop date) produces NO line;
 *   (2) a tracker day with no session record at all produces NO
 *       line when sessions evidence exists;
 *   (3) with NO sessions argument (or an empty one) the builder
 *       keeps its old behaviour byte for byte — the fallback every
 *       consumer already assumes;
 *   (4) a sub-0.1-unit tracker drip ($0.01) never becomes a line,
 *       with or without sessions evidence, genuine session or not —
 *       the rule Revenue's entryMoneyFlags has held since v116;
 *   (5) a genuine same-day tracker-only day still lines,
 *       unconfirmed, exactly as before;
 *   (6) a two-tracker day still lands in duplicateDates and off
 *       the lines, but invIssue now SUCCEEDS with it — the day is
 *       excluded, the save is not blocked;
 *   (7) his five real Nov days (dispatch completions) price
 *       unchanged: 11h/$319, 10h/$290, 10.5h/$304.50, 12.5h/$362.50,
 *       7.5h/$217.50 at $29/h.
 * Run: node tools/phantom-day-nov11-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const invSrc = fs.readFileSync(path.join(ROOT, 'modules', 'invoice.js'), 'utf8');

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
  const backing = { map: new Map(), fail: false };
  const localStorage = {
    getItem: function (k) { return backing.map.has(k) ? backing.map.get(k) : null; },
    setItem: function (k, v) { backing.map.set(k, String(v)); },
    removeItem: function (k) { backing.map.delete(k); }
  };
  const sandbox = {
    console: console,
    localStorage: localStorage,
    App: { _today: function () { return '2026-11-11'; }, _esc: function (s) { return String(s == null ? '' : s); } }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractStore(appSrc), sandbox);
  sandbox.App._store = sandbox.store;
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sandbox);
  return sandbox;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* ---- fixtures ---- */
function tracker(date, hours, amount) {
  return { date: date, type: 'hourly', hours: String(hours), amount: String(amount), note: 'Auto from tracker', auto: true, loads: 0 };
}
function completion(date, hours, amount) {
  return { date: date, type: 'hourly', hours: String(hours), amount: String(amount), note: 'Dispatch: Aecon · foreman + travel = ' + hours + 'h', loads: 0 };
}
/* A session record as app.js stopSessionAt writes it: dated by its
   END day, endedAt an ISO instant. endLocal is [y, m, d, hh, mm] in
   DEVICE-LOCAL time, so the start derivation is zone-safe. */
function sess(date, endLocal, seconds) {
  const end = new Date(endLocal[0], endLocal[1] - 1, endLocal[2], endLocal[3], endLocal[4], 0);
  return { date: date, seconds: seconds, endedAt: end.toISOString() };
}
function lineFor(built, date) {
  return (built.lines || []).filter(function (l) { return l.date === date; })[0] || null;
}

const w = makeWorld();
const B = w.invCycBuildRevenueLines;
const RATE = 29, STD = 'hourly';

/* ---------------- (1) Nov 1: the phantom ---------------- */
(function () {
  const entries = [tracker('2026-11-01', 14.78, 428.71)];
  /* The session that produced it: started Oct 31 20:00 local,
     stopped Nov 1 10:47 local — the record is dated Nov 1 (its
     end day) and carries the whole 14.78h span. */
  const sessions = [sess('2026-11-01', [2026, 11, 1, 10, 47], 14.78 * 3600)];
  const built = B(entries, [], RATE, STD, [], sessions);
  eq('nov1 phantom: no line', lineFor(built, '2026-11-01'), null);
  eq('nov1 phantom: no lines at all', built.lines.length, 0);
  eq('nov1 phantom: date not flagged duplicate', built.duplicateDates.indexOf('2026-11-01'), -1);
  eq('nov1 phantom: date not unconfirmed', built.unconfirmedDates.indexOf('2026-11-01'), -1);
})();

/* ---------------- (2) Nov 1 shape, no session record at all ---------------- */
(function () {
  const entries = [tracker('2026-11-01', 14.78, 428.71)];
  const sessions = [sess('2026-11-04', [2026, 11, 4, 18, 0], 11 * 3600)]; // evidence exists, none for Nov 1
  const built = B(entries, [], RATE, STD, [], sessions);
  eq('nov1 no-record: no line', lineFor(built, '2026-11-01'), null);
})();

/* ---------------- (3) fallback: no sessions evidence -> old behaviour ---------------- */
(function () {
  const entries = [tracker('2026-11-01', 14.78, 428.71)];
  const noArg = B(entries, [], RATE, STD, []);
  eq('fallback (no arg): line stands', lineFor(noArg, '2026-11-01') && lineFor(noArg, '2026-11-01').amt, 428.71);
  const empty = B(entries, [], RATE, STD, [], []);
  eq('fallback (empty array): line stands', lineFor(empty, '2026-11-01') && lineFor(empty, '2026-11-01').amt, 428.71);
})();

/* ---------------- (4) Nov 8: the $0.01 drip ---------------- */
(function () {
  const entries = [tracker('2026-11-08', '0.00', '0.01')];
  const withEvidence = B(entries, [], RATE, STD, [], [sess('2026-11-04', [2026, 11, 4, 18, 0], 11 * 3600)]);
  eq('nov8 drip (evidence): no line', lineFor(withEvidence, '2026-11-08'), null);
  const noEvidence = B(entries, [], RATE, STD, []);
  eq('nov8 drip (no evidence): no line', lineFor(noEvidence, '2026-11-08'), null);
  /* Even a genuine same-day session cannot make a drip money —
     the v116 rule Revenue already held. */
  const genuine = B([tracker('2026-11-08', '0.05', '1.45')], [], RATE, STD, [],
    [sess('2026-11-08', [2026, 11, 8, 9, 3], 180)]);
  eq('drip with genuine session: no line', lineFor(genuine, '2026-11-08'), null);
})();

/* ---------------- (5) a genuine tracker-only day still lines ---------------- */
(function () {
  const entries = [tracker('2026-11-03', 8, 232.00)];
  const sessions = [sess('2026-11-03', [2026, 11, 3, 17, 0], 8 * 3600)]; // started Nov 3 09:00 local
  const built = B(entries, [], RATE, STD, [], sessions);
  const l = lineFor(built, '2026-11-03');
  eq('genuine tracker day: line amt', l && l.amt, 232);
  eq('genuine tracker day: unconfirmed flagged', built.unconfirmedDates.indexOf('2026-11-03') !== -1, true);
})();

/* ---------------- (6) Nov 2: duplicate day excluded, save NOT blocked ---------------- */
(function () {
  const entries = [tracker('2026-11-02', 5, 145.00), tracker('2026-11-02', 3, 87.00)];
  const sessions = [sess('2026-11-02', [2026, 11, 2, 18, 0], 8 * 3600)];
  const built = B(entries, [], RATE, STD, [], sessions);
  eq('nov2: still reported duplicate', JSON.stringify(built.duplicateDates), JSON.stringify(['2026-11-02']));
  eq('nov2: excluded from lines', lineFor(built, '2026-11-02'), null);

  const draft = { items: [], taxRate: 0, billTo: 'Ai Trucking', no: '', date: '2026-11-11', notes: '' };
  w.App._store.set('inv_draft', draft);
  const r = w.invIssue({
    draft: draft,
    revLines: built.lines, sub: 0, tax: 0, total: 0,
    pa: '2026-11-01', pb: '2026-11-15', today: '2026-11-11', now: 418001,
    duplicateDates: built.duplicateDates,
    company: { name: 'Meticulous Technologies', gst: '', addr: '' }, province: 'AB', country: 'Canada'
  });
  eq('nov2: issue succeeds despite the duplicate day', r.ok, true);
  eq('nov2: invoice archived', w.App._store.get('inv_list', []).length, 1);
})();

/* ---------------- (7) his real Nov days price unchanged ---------------- */
(function () {
  const entries = [
    completion('2026-11-04', 11, 319.00),
    completion('2026-11-05', 10, 290.00),
    completion('2026-11-07', 10.5, 304.50),
    completion('2026-11-09', 12.5, 362.50),
    completion('2026-11-10', 7.5, 217.50)
  ];
  const sessions = [
    sess('2026-11-04', [2026, 11, 4, 18, 0], 11 * 3600),
    sess('2026-11-05', [2026, 11, 5, 18, 0], 10 * 3600),
    sess('2026-11-07', [2026, 11, 7, 18, 0], 10.5 * 3600),
    sess('2026-11-09', [2026, 11, 9, 18, 0], 12.5 * 3600),
    sess('2026-11-10', [2026, 11, 10, 18, 0], 7.5 * 3600)
  ];
  const built = B(entries, [], RATE, STD, [], sessions);
  eq('real days: five lines', built.lines.length, 5);
  eq('real days: Nov 4', lineFor(built, '2026-11-04') && lineFor(built, '2026-11-04').amt, 319);
  eq('real days: Nov 5', lineFor(built, '2026-11-05') && lineFor(built, '2026-11-05').amt, 290);
  eq('real days: Nov 7', lineFor(built, '2026-11-07') && lineFor(built, '2026-11-07').amt, 304.5);
  eq('real days: Nov 9', lineFor(built, '2026-11-09') && lineFor(built, '2026-11-09').amt, 362.5);
  eq('real days: Nov 10', lineFor(built, '2026-11-10') && lineFor(built, '2026-11-10').amt, 217.5);
  eq('real days: none unconfirmed', built.unconfirmedDates.length, 0);
})();

/* ---------------- (8) the full screenshot period, all shapes at once ---------------- */
(function () {
  const entries = [
    tracker('2026-11-01', 14.78, 428.71),
    tracker('2026-11-02', 5, 145.00), tracker('2026-11-02', 3, 87.00),
    completion('2026-11-04', 11, 319.00),
    completion('2026-11-05', 10, 290.00),
    completion('2026-11-07', 10.5, 304.50),
    tracker('2026-11-08', '0.00', '0.01'),
    completion('2026-11-09', 12.5, 362.50),
    completion('2026-11-10', 7.5, 217.50)
  ];
  const sessions = [
    sess('2026-11-01', [2026, 11, 1, 10, 47], 14.78 * 3600),
    sess('2026-11-02', [2026, 11, 2, 18, 0], 8 * 3600),
    sess('2026-11-04', [2026, 11, 4, 18, 0], 11 * 3600),
    sess('2026-11-05', [2026, 11, 5, 18, 0], 10 * 3600),
    sess('2026-11-07', [2026, 11, 7, 18, 0], 10.5 * 3600),
    sess('2026-11-09', [2026, 11, 9, 18, 0], 12.5 * 3600),
    sess('2026-11-10', [2026, 11, 10, 18, 0], 7.5 * 3600)
  ];
  const built = B(entries, [], RATE, STD, [], sessions);
  eq('period: exactly the five real lines', built.lines.length, 5);
  eq('period: total', built.lines.reduce(function (a, l) { return a + l.amt; }, 0), 1493.5);
  eq('period: only Nov 2 duplicate', JSON.stringify(built.duplicateDates), JSON.stringify(['2026-11-02']));
  eq('period: no unconfirmed days', built.unconfirmedDates.length, 0);
})();

console.log('\nphantom-day-nov11: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
