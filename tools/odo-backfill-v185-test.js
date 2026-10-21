#!/usr/bin/env node
/* Meticulous v185 — ODO-BACKFILL (owner, Oct 20, 2026 21:12 MDT):
 * his dated odometer readings run from MAY 2026 in his sheets.
 * There is no safe direct write into the phone's store from
 * outside the app, so the import is an in-app confirm-first door:
 * paste → Review → Confirm, writing through App._importOdoReadings
 * under the seed's discipline. Both halves are extracted from the
 * REAL sources and driven here.
 * Run: node tools/odo-backfill-v185-test.js */
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } }

const appSrc = read('js/app.js');
const mtSrc = read('modules/maintenance.js');

/* --- the parser, from the real maintenance module --- */
{
  const a = mtSrc.indexOf('function parseOdoImportText');
  const b = mtSrc.indexOf('function lifetimeStats');
  const sb = { console }; vm.createContext(sb);
  vm.runInContext(mtSrc.slice(a, b), sb);
  const parse = sb.parseOdoImportText;
  ok('parser exists in the module', typeof parse === 'function');
  const r = parse('Date, Start ODO\n2026-05-04, 132450\n2026-05-05\t133002\n2026-10-01,166131\ngarbage line\n2026-10-02, 166,400');
  ok('header + garbage counted bad, real lines parsed (incl. the thousands-comma line)', r.readings.length === 4 && r.bad === 2, JSON.stringify(r));
  ok('readings come back date-sorted with clean numbers',
    r.readings[0].date === '2026-05-04' && r.readings[0].value === 132450 && r.readings[2].value === 166131 && r.readings[3].value === 166400);
  ok('a thousands-comma value alone on a line is NOT misread as two numbers',
    parse('2026-10-02, 166400').readings[0].value === 166400);
  ok('empty text parses to nothing, no crash', parse('').readings.length === 0 && parse(null).bad === 0);
  ok('a number past the plausible-odometer ceiling is refused by the parser', parse('2026-10-03, 5193260').readings.length === 0);
}

/* --- the merge, from the real app.js --- */
{
  const a = appSrc.indexOf('function importOdoReadings');
  const b = appSrc.indexOf('function bumpOdometer');
  let mem = {};
  const store = {
    get: (k, d) => (mem[k] !== undefined ? mem[k] : d),
    set: (k, v) => { mem[k] = v; },
  };
  const sb = { console, store, ODO_MAX_JUMP_KM: 1000, masterOdometer: () => 169300 };
  vm.createContext(sb);
  vm.runInContext(appSrc.slice(a, b), sb);
  const imp = sb.importOdoReadings;
  ok('import exists in app.js', typeof imp === 'function');
  mem.odo_readings = [{ ts: new Date(2026, 9, 17, 12).getTime(), date: '2026-10-17', value: 169166, source: 'app' }];
  const res = imp([
    { date: '2026-05-04', value: 132450 },
    { date: '2026-06-01', value: 140200 },
    { date: '2026-10-01', value: 166131 },
    { date: '2026-10-14', value: 168759 },
    { date: '2026-10-17', value: 169166 }, // already recorded -> skip
    { date: '2026-10-10', value: 999999 }, // jump-gate poison -> skip
  ], 'sheet-import');
  ok('four new readings land, the duplicate and the poison are skipped', res.added === 4 && res.skipped === 2, JSON.stringify(res));
  const log = mem.odo_readings;
  ok('the merged log is sorted by date and carries the import source',
    log.length === 5 && log[0].date === '2026-05-04' && log[0].source === 'sheet-import' && log[4].date === '2026-10-17');
  ok('the existing entry is untouched', log[4].source === 'app' && log[4].value === 169166);
  const res2 = imp([{ date: '2026-05-04', value: 132450 }], 'sheet-import');
  ok('re-import is idempotent', res2.added === 0 && mem.odo_readings.length === 5);
  const res3 = imp([{ date: '2026-07-01', value: 100000 }], 'sheet-import'); // backwards vs the chain
  ok('a backwards reading is skipped, not written', res3.added === 0 && res3.skipped === 1, JSON.stringify(res3));
  ok('App exposes the import for the Maintenance door', appSrc.indexOf('App._importOdoReadings = importOdoReadings') !== -1);
}

console.log('— the door —');
ok('bulk box lives in the past-reading door', mtSrc.indexOf('id="mt_past_bulk"') !== -1 && mtSrc.indexOf('id="mt_past_review"') !== -1);
ok('Confirm starts hidden — nothing writes before it', mtSrc.indexOf('id="mt_past_confirm"') !== -1 && mtSrc.indexOf('btn primary hidden') !== -1);
ok('Confirm calls the app import with the sheet-import source', mtSrc.indexOf("App._importOdoReadings(bulkParsed.readings, 'sheet-import')") !== -1);
ok('Review shows the parsed range back before any write', mtSrc.indexOf('Ready to import') !== -1);

console.log('odo-backfill-v185: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
