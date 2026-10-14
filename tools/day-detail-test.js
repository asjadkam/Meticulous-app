#!/usr/bin/env node
/* Meticulous v47 — Day Details: behavioral tests against the REAL
 * shipped code. The data assembly under test (dayDetailData, in the
 * DAY-DETAIL region of modules/revenue.js) is sliced out verbatim,
 * together with the module's own aggregation helpers (entries, extras,
 * payFor, payCtx, dayAgg, monthSummary), and run in a vm sandbox over
 * an in-memory store. App._odoDailyKm is the REAL one, extracted from
 * the ODO-MASTER region of js/app.js exactly as tools/odo-photos-test.js
 * does. So the totals compared here are produced by the shipped math
 * on both sides — the detail page cannot drift from the Month view.
 * Run: node tools/day-detail-test.js
 *
 * Covers Asjad's Oct 14 spec:
 *  (a) a day with 2 entries — detail totals equal the entries' sum AND
 *      equal the row monthSummary produces for that same day
 *  (b) a day whose session carries startOdo/endOdo — the km shown
 *      equals App._odoDailyKm(session); start/end stamps derive as
 *      endedAt / endedAt - seconds
 *  (c) a day with a fuel fill — the fuel section matches the store
 *      record (litres, cost, station)
 *  (d) a day with entries but no session/fuel/dispatches — those
 *      sections come back absent (empty), entries still listed;
 *      extras on a day land in extras AND in the day's earnings total
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const revSrc = fs.readFileSync(path.join(ROOT, 'modules', 'revenue.js'), 'utf8');

function extract(src, beginMark, endMark) {
  // markers sit inside /* ... */ comments — span the whole comment blocks
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}

/* Revenue helpers: from the store shims at the top of the module
 * through monthSummary (ending right before the v38 (B2) import block),
 * plus the DAY-DETAIL region itself. */
function revHelpers() {
  const start = revSrc.indexOf('var S = function');
  const end = revSrc.lastIndexOf('/*', revSrc.indexOf('v38 (B2): paste-import'));
  if (start === -1 || end === -1 || end <= start) throw new Error('revenue helper slice not found');
  return revSrc.slice(start, end);
}

const FIXTURE_SESSION = {
  date: '2026-10-13', seconds: 41400, endedAt: '2026-10-13T19:30:00.000Z',
  startOdo: 168400, endOdo: 168614, liveKm: 210.5, milesStatus: 'confirmed'
};

function makeWorld() {
  const mem = {
    onboarding: { payStandard: 'Hourly', payRate: 29 },
    rev_entries: [
      { date: '2026-10-13', type: 'hourly', hours: 10, note: 'Hours sheet import' },
      { date: '2026-10-13', type: 'hourly', hours: 1.5, amount: '43.50', note: 'Yard time' },
      { date: '2026-10-14', type: 'hourly', hours: 8, note: 'Hours sheet import' }
    ],
    rev_extras: [
      { type: 'bonus', amount: '25.00', date: '2026-10-14', note: 'Safety bonus' }
    ],
    sessions: [JSON.parse(JSON.stringify(FIXTURE_SESSION))],
    fuel_fills: [
      { date: '2026-10-13', litres: '83.965', cost: '191.36', station: 'Mobil', odo: 168510 }
    ],
    dsp_list: [
      { date: '2026-10-13', jobSite: 'Aecon — Deerfoot', status: 'completed', ticketNo: 'T-9' },
      { date: '2026-10-09', jobSite: 'Other day job', status: 'saved' }
    ]
  };
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); },
    del: function (k) { delete mem[k]; }
  };
  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  const sandbox = {
    console: console,
    store: store,
    todayStr: todayStr,
    trackerSave: function () {},
    App: {
      _store: store,
      _today: function () { return '2026-10-14'; },
      _esc: function (s) { return String(s == null ? '' : s); },
      tracker: null
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  // real App._odoDailyKm from js/app.js (ODO regions), as in v46's test
  vm.runInContext(
    extract(appSrc, 'ODO-MASTER-BEGIN', 'ODO-MASTER-END') + '\n' +
    extract(appSrc, 'ODO-PROMPT-BEGIN', 'ODO-PROMPT-END'), sandbox);
  sandbox.App._odoDailyKm = sandbox.odoDailyKm;
  // the shipped revenue aggregation + the DAY-DETAIL region
  vm.runInContext(revHelpers() + '\n' + extract(revSrc, 'DAY-DETAIL-BEGIN', 'DAY-DETAIL-END'), sandbox);
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

const w = makeWorld();
const d13 = w.dayDetailData('2026-10-13');
const d14 = w.dayDetailData('2026-10-14');

/* (a) two entries on the 13th: totals = entry sum = Month row */
eq('a: two entries listed', d13.entries.length, 2);
eq('a: entry amounts priced like dayAgg (10h x $29 derived)', d13.entries[0].amount, 290);
eq('a: explicit amount wins', d13.entries[1].amount, 43.5);
eq('a: entries keep their global indexes (delete wiring)', d13.entries[0].index + ',' + d13.entries[1].index, '0,1');
eq('a: detail hours = 10 + 1.5', d13.hours, 11.5);
eq('a: detail earnings = 290 + 43.50', d13.amount, 333.5);
const ms = w.monthSummary('2026-10');
const row13 = ms.days.filter(function (r) { return r.date === '2026-10-13'; })[0];
ok('a: month row for the 13th exists', !!row13);
eq('a: detail hours == Month row hours', d13.hours, row13.hours);
eq('a: detail earnings == Month row earnings', d13.amount, row13.amount);

/* (b) session on the 13th: km via the real App._odoDailyKm */
eq('b: one session for the day', d13.sessions.length, 1);
eq('b: odo km equals App._odoDailyKm(session)', d13.sessions[0].odoKm, w.odoDailyKm(FIXTURE_SESSION));
eq('b: odo km is end - start', d13.sessions[0].odoKm, 214);
eq('b: end stamp is endedAt', d13.sessions[0].endMs, Date.parse(FIXTURE_SESSION.endedAt));
eq('b: start stamp is endedAt - seconds', d13.sessions[0].startMs,
  Date.parse(FIXTURE_SESSION.endedAt) - FIXTURE_SESSION.seconds * 1000);
eq('b: live GPS km carried through', d13.sessions[0].liveKm, 210.5);
eq('b: reconciliation status carried through', d13.sessions[0].milesStatus, 'confirmed');
eq('b: odometer readings carried through', d13.sessions[0].startOdo + ',' + d13.sessions[0].endOdo, '168400,168614');

/* (c) fuel fill on the 13th matches the store record */
eq('c: one fill for the day', d13.fuel.length, 1);
eq('c: litres match', d13.fuel[0].litres, 83.965);
eq('c: cost matches', d13.fuel[0].cost, 191.36);
eq('c: station matches', d13.fuel[0].station, 'Mobil');

/* dispatches: the 13th's job shows; the 9th's does not leak in */
eq('dispatches: one job for the day', d13.dispatches.length, 1);
eq('dispatches: job site matches', d13.dispatches[0].jobSite, 'Aecon — Deerfoot');

/* (d) the 14th: entries + an extra, but no session/fuel/dispatches */
eq('d: one entry listed', d14.entries.length, 1);
eq('d: no sessions section data', d14.sessions.length, 0);
eq('d: no fuel section data', d14.fuel.length, 0);
eq('d: no dispatches section data', d14.dispatches.length, 0);
eq('d: the extra is listed', d14.extras.length, 1);
eq('d: extra amount matches', d14.extras[0].amount, 25);
eq('d: earnings include the extra (8h x $29 + $25)', d14.amount, 257);
eq('d: extrasAmt reported separately', d14.extrasAmt, 25);
eq('d: no extras on the 13th', d13.extras.length, 0);

console.log('\nday-detail test: ' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
