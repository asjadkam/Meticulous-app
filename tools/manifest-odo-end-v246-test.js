#!/usr/bin/env node
/* Meticulous v246 — MANIFEST-ODO-END-WRONG (owner, Oct 22,
 * 2026 20:02 MDT, same printed manifest): the Odometer line
 * read 169,888 → 170,117 km (229 km); his actual closing
 * odometer (post-trip PTI 17:21 + the 17:13 fuel read) was
 * 170,079 — a 191 km day. 170,117 was the NEXT MORNING's
 * reading (Oct 23 personal driving): the v122 readings-log
 * end fill reached two days forward from the day's end
 * anchor (the last session fragment ended 17:30, after the
 * 17:21 PTI), so the first reading it met was next day's.
 *
 * The closing master reading of a day is the master chain's
 * end-of-day value: the LAST odo_readings entry inside the
 * day's closing window (at/after an hour before the day's
 * end anchor, stamped on the day itself). A mid-day reading
 * — hours before the end — still never closes a day, and a
 * day with nothing in the window keeps its honest
 * "end not recorded" — nothing is fabricated.
 *
 * Fixture = his Oct 22 (hidden_files/oct22-day-record.md).
 * Run: node tools/manifest-odo-end-v246-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const manSrc = fs.readFileSync(path.join(ROOT, 'modules/manifest.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}

const DAY = '2026-10-22';
const T = (s) => Date.parse(DAY + 'T' + s + ':00');

function fixtureMem(over) {
  const mem = {
    mani_date: DAY,
    onboarding: { payStandard: 'Hourly', payRate: 29, ownWageRate: 29, travelBonus: 1 },
    nav_data: { personal: [], work: [] },
    dsp_list: [{
      date: DAY, scheduledAt: '2026-10-22T08:00:00', status: 'completed',
      endedAt: T('17:35'), jobSite: 'Aecon Inf', material: 'Clay / misc fill',
      tickets: [{ cardNumber: '22864', foremanHours: 10, loads: 8, startTime: '8:00 AM', finishTime: '6:00 PM' }]
    }],
    nav_log: [],
    fuel_fills: [
      { date: DAY, station: 'Petro-Canada', litres: 99.047, cost: 239.59, odo: 169999 },
      { date: DAY, station: 'Mobil', litres: 38.970, cost: 86.86, odo: 170079 }
    ],
    fuel_expenses: [], dmg_reports: [],
    sessions: [
      { date: DAY, endedAt: T('11:02'), seconds: 10920, liveKm: 62.4, startOdo: 169888 },
      { date: DAY, endedAt: T('17:30'), seconds: 19800, liveKm: 48.6 }
    ],
    rev_entries: [], rev_extras: [],
    tracker: { status: 'idle', startTs: 0, elapsed: 0 },
    odo_readings: [
      { ts: T('07:24'), value: 169888 },
      { ts: T('12:47'), value: 169999 },
      { ts: T('17:13'), value: 170079 },
      { ts: T('17:21'), value: 170079 },
      { ts: Date.parse('2026-10-23T09:14:00'), value: 170117 }
    ]
  };
  Object.keys(over || {}).forEach(function (k) { mem[k] = over[k]; });
  return mem;
}
function makeWorld(mem) {
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const sandbox = {
    console: console, setTimeout: setTimeout, Promise: Promise,
    App: {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s); },
      _today: function () { return DAY; },
      tracker: mem.tracker, userRole: function () { return 'both'; }
    },
    Meticulous: { modules: {} }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(manSrc, sandbox, { filename: 'modules/manifest.js' });
  return sandbox.Meticulous.modules.manifest;
}
function odoKv(M, c) {
  const lines = M._docLines(DAY, c, M._toggles());
  return lines.filter(function (l) { return l.k === 'kv' && l.a === 'Odometer'; })[0] || null;
}

console.log('— Oct 22: the next morning\'s reading must not close the day —');
{
  const M = makeWorld(fixtureMem());
  const c = M._collectDay(DAY);
  ok('start is the day\'s own 169,888', c.odoStart === 169888, c.odoStart);
  ok('end is the day\'s actual close 170,079 — not Oct 23\'s 170,117', c.odoEnd === 170079, c.odoEnd);
  const kv = odoKv(M, c);
  ok('printed line: 169,888 → 170,079 km (191 km)', !!kv && kv.b === '169,888 → 170,079 km (191 km)', kv && kv.b);
}
{
  /* same day without the next-day reading: the close must
     still be found on the day itself */
  const mem = fixtureMem();
  mem.odo_readings = mem.odo_readings.slice(0, 4);
  const M = makeWorld(mem);
  const c = M._collectDay(DAY);
  ok('end found on the day itself (17:21 PTI reading)', c.odoEnd === 170079, c.odoEnd);
}

console.log('— honesty: nothing to close with → nothing invented —');
{
  /* a last reading two hours before the day's end is mid-day
     evidence, not a close (the manifest-odo case-i law) */
  const mem = fixtureMem({
    fuel_fills: [],
    odo_readings: [
      { ts: T('07:24'), value: 169888 },
      { ts: T('15:30'), value: 170010 }
    ]
  });
  mem.sessions = [
    { date: DAY, endedAt: T('11:02'), seconds: 10920, startOdo: 169888 },
    { date: DAY, endedAt: T('17:30'), seconds: 19800 }
  ];
  const M = makeWorld(mem);
  const c = M._collectDay(DAY);
  ok('a reading 2 h before the end anchor never becomes the end', c.odoEnd === null, c.odoEnd);
}
{
  const mem = fixtureMem({
    fuel_fills: [],
    odo_readings: [{ ts: T('07:24'), value: 169888 }]  /* the pre-trip only */
  });
  mem.sessions = [
    { date: DAY, endedAt: T('11:02'), seconds: 10920, startOdo: 169888 },
    { date: DAY, endedAt: T('17:30'), seconds: 19800 }
  ];
  const M = makeWorld(mem);
  const c = M._collectDay(DAY);
  ok('a lone pre-trip reading never becomes the end', c.odoEnd === null, c.odoEnd);
  const kv = odoKv(M, c);
  ok('printed line says end not recorded', !!kv && kv.b === '169,888 km → end not recorded', kv && kv.b);
}

console.log('— boundaries that already work stay put —');
{
  const mem = fixtureMem();
  mem.sessions = [
    { date: DAY, endedAt: T('11:02'), seconds: 10920, startOdo: 169888 },
    { date: DAY, endedAt: T('17:30'), seconds: 19800, endOdo: 170079, endPhoto: 'x' }
  ];
  const M = makeWorld(mem);
  const c = M._collectDay(DAY);
  ok('a session endOdo still wins over every inference', c.odoEnd === 170079, c.odoEnd);
}
{
  /* the v122 night save: closed 17:45, dash reading saved at
     night on the same day — still the close */
  const mem = fixtureMem({
    dsp_list: [{ date: DAY, scheduledAt: '2026-10-22T08:00:00', status: 'completed', endedAt: T('17:45'), tickets: [] }],
    fuel_fills: [],
    odo_readings: [
      { ts: Date.parse('2026-10-21T21:05:00'), value: 169800 },
      { ts: T('07:24'), value: 169888 },
      { ts: T('21:12'), value: 170079 }
    ]
  });
  mem.sessions = [{ date: DAY, endedAt: T('17:45'), seconds: 35100, startOdo: 169888 }];
  const M = makeWorld(mem);
  const c = M._collectDay(DAY);
  ok('the same-day night save is the close', c.odoEnd === 170079, c.odoEnd);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
