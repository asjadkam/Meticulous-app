#!/usr/bin/env node
/* Meticulous v241 — SHIFT-CLOSE-DUP-ENTRY (owner, Oct 22, 2026
 * close-out recording + 17:20/17:47 dashboard frames; named
 * again Oct 23, 15:07 — the card still read "Last entry:
 * $280.92 · yesterday").
 *
 * The defect: closing the dispatch with the ticket posted the
 * correct foreman entry ($319.00 = 10h foreman + 1h travel at
 * $29), but the tracker stop then posted a SECOND entry from
 * raw elapsed ($270.51 = 9h19m40s x $29, no travel) through
 * Revenue.onSession, which appended unconditionally. The figure
 * later MOVED to $280.92 (9h41m x $29) with no edit by him —
 * a second stop/recovery re-fired onSession and appended again,
 * and the dashboard glance ("last entry" = latest-dated, tie to
 * last appended) showed the newest tracker figure.
 *
 * The law (his): one close, one entry — the day's revenue entry
 * is the foreman-hours + travel-bonus completion entry. Every
 * writer of the day entry, accounted for:
 *  - manual add/edit (Revenue UI) — his own hand, untouched.
 *  - addEntry (dispatch completion, dspId-keyed) — authoritative.
 *  - onSession (tracker stop) — FIXED here: it stays silent when
 *    a completion entry already speaks for the session's date,
 *    a completion landing later REMOVES the day's tracker entry,
 *    and repeated stops REPLACE the day's tracker entry instead
 *    of stacking — a recompute can never stack or drift again.
 *  - importDays (paste import) — deliberate, untouched.
 *  - the cloud pull — covered by cloudsync-record-union-v241.
 *
 * Run: node tools/revenue-dup-entry-v241-test.js
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

function memStore(seed) {
  const data = JSON.parse(JSON.stringify(seed || {}));
  return {
    _data: data,
    get: function (k, d) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : d; },
    set: function (k, v) { data[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete data[k]; }
  };
}
const TODAY = '2026-10-22';
function makeWorld() {
  const store = memStore({
    onboarding: { payStandard: 'hourly', ownWageRate: 29, payRate: 29, travelBonus: 1 }
  });
  const sb = {
    window: {}, Meticulous: { modules: {} }, console: console,
    App: {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s); },
      _today: function () { return TODAY; }
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(read('modules/revenue.js'), sb);
  return { sb: sb, store: store, rev: sb.Meticulous.modules.revenue };
}
function dayEntries(w, date) {
  return (w.store._data.rev_entries || []).filter(function (e) { return e && e.date === date; });
}
const COMPLETION = { date: TODAY, amount: '319.00', type: 'hourly', hours: '11.00',
  dspId: 'd-oct22', foremanHours: 10, travelHours: 1, travelInIncome: true,
  note: 'Dispatch: Aecon Inf · foreman 10h + travel 1h = 11h' };
const STOP1 = { date: TODAY, seconds: 9 * 3600 + 19 * 60 + 40 };  /* 9h19m40s -> $270.51 */
const STOP2 = { date: TODAY, seconds: 9 * 3600 + 41 * 60 + 13 };  /* 9h41m13s -> $280.92 */

/* ---- A: completion first, then the tracker stop (his Oct 22 order) ---- */
{
  const w = makeWorld();
  w.rev.addEntry(Object.assign({}, COMPLETION));
  w.rev.onSession(Object.assign({}, STOP1));
  const day = dayEntries(w, TODAY);
  eq('A1 exactly ONE entry for the day', day.length, 1);
  eq('A2 the surviving entry is the foreman completion', day.length && day[0].amount, '319.00');
  eq('A3 the dashboard glance shows the foreman entry',
    w.rev.status(), 'Last entry: $319.00 · today');
}

/* ---- B: tracker stop first, completion lands after ---- */
{
  const w = makeWorld();
  w.rev.onSession(Object.assign({}, STOP1));
  eq('B0 the tracker alone posts its estimate', dayEntries(w, TODAY).length, 1);
  w.rev.addEntry(Object.assign({}, COMPLETION));
  const day = dayEntries(w, TODAY);
  eq('B1 the completion supersedes the tracker entry — still ONE entry', day.length, 1);
  eq('B2 the surviving entry is the foreman completion', day.length && day[0].amount, '319.00');
  eq('B3 the dashboard glance shows the foreman entry',
    w.rev.status(), 'Last entry: $319.00 · today');
}

/* ---- C: repeated stops (the $270.51 -> $280.92 drift) ---- */
{
  const w = makeWorld();
  w.rev.onSession(Object.assign({}, STOP1));
  w.rev.onSession(Object.assign({}, STOP2));
  const day = dayEntries(w, TODAY);
  eq('C1 two stops still post exactly ONE tracker entry', day.length, 1);
  eq('C2 the entry converges to the latest stop — no stacking',
    day.length && day[0].amount, '280.92');
  w.rev.addEntry(Object.assign({}, COMPLETION));
  w.rev.onSession(Object.assign({}, STOP2));
  const day2 = dayEntries(w, TODAY);
  eq('C3 a stop after the completion changes nothing', day2.length, 1);
  eq('C4 the glance still shows the foreman entry',
    w.rev.status(), 'Last entry: $319.00 · today');
}

/* ---- D: guards — tracker-only days and other days are untouched ---- */
{
  const w = makeWorld();
  w.rev.onSession(Object.assign({}, STOP1));
  const day = dayEntries(w, TODAY);
  eq('D1 a day with no completion still gets its tracker entry',
    [day.length, day.length && day[0].amount], [1, '270.51']);
  w.rev.addEntry({ date: '2026-10-21', amount: '304.50', type: 'hourly', hours: '10.50',
    dspId: 'd-oct21', note: 'Dispatch: Aecon Inf' });
  eq('D2 a completion for ANOTHER date leaves this day\u2019s tracker entry alone',
    dayEntries(w, TODAY).length, 1);
  const manual = { date: TODAY, amount: '50.00', type: 'load', loads: 1, note: 'Manual entry' };
  w.rev.addEntry(manual);
  eq('D3 a manual (non-dispatch) addEntry never eats the tracker entry',
    dayEntries(w, TODAY).length, 2);
}

console.log('\nrevenue-dup-entry-v241 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
