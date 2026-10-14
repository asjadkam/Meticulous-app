#!/usr/bin/env node
/* Meticulous v49 — optional "Next service" target (Maintenance):
 * behavioral tests against the REAL shipped modules/maintenance.js.
 * The NEXT-SERVICE region is marker-delimited and harness-extractable by
 * design; this test slices it out verbatim and runs it in a vm sandbox
 * over an in-memory store, AND loads the whole module to exercise
 * dueItems()/status() end-to-end — so the logic under test is the logic
 * that ships.
 * Run: node tools/next-service-test.js
 *
 * Covers Asjad's Oct 14, 2026 direction ("It should have a field to log
 * in the next service as well... Not mandatory"):
 *  - target odometer set -> oil countdown = target - odo (interval math
 *    is replaced, not added)
 *  - target + past date -> due-by-date (whichever comes first)
 *  - target + future date + km reached -> due by km
 *  - date alone (no target odo) -> interval model, unchanged
 *  - target cleared -> interval model restored exactly
 *  - logging an oil change clears the target (clearNextService)
 *  - the Oct 14 workaround migration: interval 6911 + no target ->
 *    target 175429 seeded, interval restored to 8000, fires ONCE only
 *    (synced flag), never stomps a target the user set himself
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'modules', 'maintenance.js'), 'utf8');

function extract(beginMark, endMark) {
  // markers sit inside /* ... */ comments — span the whole comment blocks
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}
const region = extract('NEXT-SERVICE-BEGIN', 'NEXT-SERVICE-END');

/* The module's own S/W definitions, verbatim, so extracted code sees the
 * same store access it has in production. */
const PRELUDE =
  "var S = function (k, d) { return App._store.get('mt_' + k, d); };\n" +
  "var W = function (k, v) { App._store.set('mt_' + k, v); };\n";

const TODAY = '2026-10-14';
const ODO = 168518;      // owner master odometer, Oct 14 2026
const TARGET = 175429;   // windshield sticker next-service odometer

function makeStore(mem) {
  return {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); },
    del: function (k) { delete mem[k]; }
  };
}

/* World A: just the extracted NEXT-SERVICE region. */
function makeRegionWorld(mem) {
  const sandbox = {
    console: console,
    App: { _store: makeStore(mem), _today: function () { return TODAY; } }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(PRELUDE + region, sandbox);
  sandbox._mem = mem;
  return sandbox;
}

/* World B: the whole shipped module (dueItems / status / migration). */
function makeModuleWorld(mem) {
  const sandbox = {
    console: console,
    App: {
      _store: makeStore(mem),
      _today: function () { return TODAY; },
      _esc: function (s) { return String(s == null ? '' : s); }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  sandbox._mem = mem;
  return sandbox.Meticulous.modules.maintenance;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* ---------- 1. Pure countdown states (extracted region) ---------- */
const w1 = makeRegionWorld({});

/* target set -> countdown = target - odo, interval ignored */
let st = w1.oilDueState(8000, ODO, null, { odo: TARGET, date: '' }, TODAY);
eq('target: mode is target', st.mode, 'target');
eq('target: remaining = 175429 - 168518', st.remaining, 6911);
eq('target: dueAt is the target', st.dueAt, TARGET);
eq('target: not overdue', st.overdue, false);
eq('target: not due by date (no date)', st.dueByDate, false);

/* a WRONG interval must not change the target countdown */
st = w1.oilDueState(6911, ODO, null, { odo: TARGET, date: '' }, TODAY);
eq('target: interval value irrelevant', st.remaining, 6911);

/* target + past date -> due by date even with km remaining */
st = w1.oilDueState(8000, ODO, null, { odo: TARGET, date: '2026-09-28' }, TODAY);
eq('target+past date: dueByDate', st.dueByDate, true);
eq('target+past date: overdue', st.overdue, true);
eq('target+past date: not due by km', st.dueByKm, false);
eq('target+past date: km remaining still reported', st.remaining, 6911);

/* target + future date + km reached -> due by km, not date */
st = w1.oilDueState(8000, TARGET + 10, null, { odo: TARGET, date: '2027-01-01' }, TODAY);
eq('target+future date, km passed: dueByKm', st.dueByKm, true);
eq('target+future date, km passed: not dueByDate', st.dueByDate, false);
eq('target+future date, km passed: overdue', st.overdue, true);
eq('target+future date, km passed: remaining negative', st.remaining, -10);

/* date alone (no target odo) -> interval model, date ignored */
st = w1.oilDueState(8000, ODO, null, { odo: 0, date: '2020-01-01' }, TODAY);
eq('date alone: mode is interval', st.mode, 'interval');
eq('date alone: dueByDate false despite past date', st.dueByDate, false);
eq('date alone: remaining = full interval (no last service)', st.remaining, 8000);

/* no target -> interval model from last service */
st = w1.oilDueState(8000, ODO, { odo: 162000, date: '2026-08-01' }, { odo: 0, date: '' }, TODAY);
eq('interval: dueAt = last + interval', st.dueAt, 170000);
eq('interval: remaining', st.remaining, 1482);
eq('interval: not overdue', st.overdue, false);

/* interval model overdue (existing behaviour preserved) */
st = w1.oilDueState(8000, ODO, { odo: 160000, date: '2026-07-01' }, { odo: 0, date: '' }, TODAY);
eq('interval: overdue when last + interval < odo', st.overdue, true);
eq('interval: remaining negative', st.remaining, -518);

/* ---------- 2. Field read/write + clear-on-log helper ---------- */
const mem2 = { mt_nextServiceOdo: TARGET, mt_nextServiceDate: '2026-09-28' };
const w2 = makeRegionWorld(mem2);
let ns = w2.nextService();
eq('nextService: reads odo key', ns.odo, TARGET);
eq('nextService: reads date key', ns.date, '2026-09-28');
w2.clearNextService();
ns = w2.nextService();
eq('clearNextService: odo cleared', ns.odo, 0);
eq('clearNextService: date cleared', ns.date, '');
eq('clearNextService: stored odo is empty string', mem2.mt_nextServiceOdo, '');
eq('clearNextService: stored date is empty string', mem2.mt_nextServiceDate, '');
/* after clearing, countdown is pure interval again */
st = w2.oilDueState(8000, ODO, null, w2.nextService(), TODAY);
eq('after clear: interval model restored', st.mode, 'interval');
eq('after clear: remaining = interval', st.remaining, 8000);

/* ---------- 3. Migration (extracted region) ---------- */
/* Owner's exact Oct 14 state: interval saved as the 6911 workaround */
const mem3 = { mt_intervals: { oil: 6911, pm: 16000, grease: 8000 } };
const w3 = makeRegionWorld(mem3);
eq('migration: fires on 6911 + no target', w3.migrateNextService(), true);
eq('migration: interval restored to 8000', mem3.mt_intervals.oil, 8000);
eq('migration: other intervals untouched', mem3.mt_intervals.pm, 16000);
eq('migration: target seeded 175429', mem3.mt_nextServiceOdo, TARGET);
eq('migration: date NOT seeded', mem3.mt_nextServiceDate || '', '');
eq('migration: flag stamped', mem3.mt_nsMigrated, 1);
eq('migration: second call does not fire', w3.migrateNextService(), false);

/* After migration, even if the numbers regress by hand, no re-fire */
mem3.mt_intervals.oil = 6911;
mem3.mt_nextServiceOdo = '';
const w3b = makeRegionWorld(mem3);
eq('migration: flag blocks re-fire after manual regress', w3b.migrateNextService(), false);
eq('migration: regressed interval left alone', mem3.mt_intervals.oil, 6911);
eq('migration: target not re-seeded', mem3.mt_nextServiceOdo, '');

/* A target the user set himself is never stomped */
const mem4 = { mt_intervals: { oil: 6911 }, mt_nextServiceOdo: 200000 };
const w4 = makeRegionWorld(mem4);
eq('migration: no fire when target already set', w4.migrateNextService(), false);
eq('migration: user target preserved', mem4.mt_nextServiceOdo, 200000);
eq('migration: interval left as-is when target set', mem4.mt_intervals.oil, 6911);

/* A normal user (interval never the workaround) is untouched */
const mem5 = { mt_intervals: { oil: 8000 } };
const w5 = makeRegionWorld(mem5);
eq('migration: no fire on normal interval', w5.migrateNextService(), false);
eq('migration: no target invented', mem5.mt_nextServiceOdo || '', '');
eq('migration: flag still stamped (one-time check)', mem5.mt_nsMigrated, 1);

/* No saved intervals at all -> no fire, no crash */
const mem6 = {};
const w6 = makeRegionWorld(mem6);
eq('migration: no fire with empty store', w6.migrateNextService(), false);

/* ---------- 4. Whole module: dueItems + dashboard status ---------- */
/* Owner's real Oct 14 state before v49: workaround interval in place */
const mem7 = {
  mt_odo: ODO,
  mt_intervals: { oil: 6911, grease: 0 }
};
const api = makeModuleWorld(mem7);
eq('module: dashboard reads "Oil change in 6,911 km"', api.status(), 'Oil change in 6,911 km');
eq('module: migration landed interval 8000', mem7.mt_intervals.oil, 8000);
eq('module: migration landed target 175429', mem7.mt_nextServiceOdo, TARGET);
let oil = api._dueItems().items.filter(function (i) { return i.id === 'oil'; })[0];
eq('module: oil item is target mode', oil.mode, 'target');
eq('module: oil remaining 6911', Math.round(oil.remaining), 6911);
eq('module: oil not overdue without a date', oil.overdue, false);

/* Add the sticker date (past) -> due by date, on module AND dashboard */
mem7.mt_nextServiceDate = '2026-09-28';
oil = api._dueItems().items.filter(function (i) { return i.id === 'oil'; })[0];
eq('module: oil dueByDate with past sticker date', oil.dueByDate, true);
eq('module: dashboard reads "Oil change due (date)"', api.status(), 'Oil change due (date)');

/* Clear both fields -> pure interval model returns (8000 from no last) */
mem7.mt_nextServiceOdo = '';
mem7.mt_nextServiceDate = '';
oil = api._dueItems().items.filter(function (i) { return i.id === 'oil'; })[0];
eq('module: cleared target -> interval mode', oil.mode, 'interval');
eq('module: cleared target -> remaining = 8000', Math.round(oil.remaining), 8000);
eq('module: dashboard back to interval text', api.status(), 'Oil change in 8,000 km');

console.log('\nnext-service-test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
