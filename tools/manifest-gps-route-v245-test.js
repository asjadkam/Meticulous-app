#!/usr/bin/env node
/* Meticulous v245 — MANIFEST-GPS-EMPTY-OCT22 (owner, Oct 22,
 * 2026 20:02 MDT, on the printed Oct 22 manifest): the manifest
 * printed NO GPS content — no route, no places/stops — for a
 * 191 km day, because the day's GPS tracking was shattered by
 * two mid-shift installs and "the fragments never joined into
 * a route the manifest could print."
 *
 * Where the join breaks today (modules/manifest.js collect):
 * the day's crumbs are gathered by the livemiles RECORD's
 * `date` field alone. A fragment whose record lost that stamp
 * in the shatter (records can persist without a date — the
 * miles adoption code treats saved.date as optional) is
 * invisible to the manifest even though every crumb in it is
 * timestamped on the day; and a record stamped with the wrong
 * day leaks its crumbs into that day's route while its own
 * day's route goes empty. The crumbs carry their own
 * timestamps — the join must read them.
 *
 * Fixture = his Oct 22 (hidden_files/oct22-day-record.md):
 * Aecon DFTI day, odo 169,888 → 170,079, loads 8, fuel at
 * Petro Roadking 12:47 + Mobil Heritage Meadows 17:13, no
 * navigation used (nav_log empty — the route must come from
 * the trail itself, v184's law).
 *
 * Run: node tools/manifest-gps-route-v245-test.js
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
const HOME = [51.15710, -113.93862];
const PIT = [51.00874, -114.02517];
const PETRO = [51.01460, -114.01330];
const MOBIL = [51.00400, -114.05800];
const crumb = (hhmm, ll) => ({ t: T(hhmm), a: ll[0], o: ll[1] });

const MORNING = [ /* fragment 1: 06:58 → 10:58, two pit dwells */
  crumb('06:58', HOME), crumb('07:12', [51.09, -113.99]), crumb('07:31', PIT),
  crumb('07:52', PIT), crumb('08:20', [51.03, -114.00]), crumb('08:44', PIT),
  crumb('09:05', PIT), crumb('10:58', [51.06, -113.97])
];
const AFTERNOON = [ /* fragment 2: fuel dwell at Petro, a pit dwell */
  crumb('12:41', [51.02, -114.02]), crumb('12:47', PETRO), crumb('12:59', PETRO),
  crumb('13:22', PIT), crumb('13:47', PIT), crumb('15:30', [51.05, -113.98])
];
const EVENING = [ /* fragment 3: fuel dwell at Mobil, drive home */
  crumb('17:08', MOBIL), crumb('17:19', MOBIL), crumb('17:28', [51.10, -113.95])
];

function fixtureMem(days) {
  return {
    mani_date: DAY,
    onboarding: { payStandard: 'Hourly', payRate: 29, ownWageRate: 29, travelBonus: 1 },
    nav_data: { personal: [{ name: 'Home', lat: HOME[0], lng: HOME[1] }], work: [] },
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
    livemiles: { days: days },
    geoloads: { days: { '2026-10-22': { count: 8, sites: {
      load: { lat: PIT[0], lng: PIT[1], label: 'East Ivor' },
      dump: { lat: PIT[0] + 0.001, lng: PIT[1] + 0.001, label: 'East Ivor' }
    }, events: [] } } }
  };
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
function stopSummary(c) {
  return (c.routeStops || []).map(function (s) { return s.mins; });
}

console.log('— control: fragments stamped with the day (today\'s happy path) —');
{
  const M = makeWorld(fixtureMem({
    s1: { date: DAY, hasFix: true, crumbs: MORNING },
    s2: { date: DAY, hasFix: true, crumbs: AFTERNOON },
    s3: { date: DAY, hasFix: true, crumbs: EVENING }
  }));
  const c = M._collectDay(DAY);
  ok('route shows the day\'s stops (2 pit + Petro + pit + Mobil)',
    stopSummary(c).join(',') === '21,21,12,25,11', stopSummary(c).join(','));
  ok('pit stops carry the site\'s name from the GPS pair', c.routeStops[0].label === 'East Ivor', c.routeStops[0] && c.routeStops[0].label);
  ok('no at-home stop is listed', c.routeStops.every(function (s) {
    return Math.abs(s.lat - HOME[0]) > 0.002 || Math.abs(s.lng - HOME[1]) > 0.002;
  }));
}

console.log('— the shatter: stamps lost / wrong, crumbs intact —');
{
  const M = makeWorld(fixtureMem({
    s1: { date: DAY, hasFix: true, crumbs: MORNING },
    s2: { date: '2026-10-23', hasFix: true, crumbs: AFTERNOON },  /* mis-stamped by the reinstall day */
    s3: { hasFix: true, crumbs: EVENING }                          /* no date stamp at all */
  }));
  const c = M._collectDay(DAY);
  ok('the route STILL shows the whole day\'s stops — crumbs join by their own timestamps',
    stopSummary(c).join(',') === '21,21,12,25,11', stopSummary(c).join(','));
  const lines = M._docLines(DAY, c, M._toggles());
  ok('the printed manifest carries the GPS route section',
    lines.some(function (l) { return /Where the truck went/.test(l.a || ''); }));
  ok('the printed route names the pit stop', lines.some(function (l) { return l.a === 'East Ivor'; }));
}

console.log('— no leaks across days —');
{
  const stray = [
    { t: Date.parse('2026-10-23T00:20:00'), a: 51.30, o: -113.80 },
    { t: Date.parse('2026-10-23T00:41:00'), a: 51.30, o: -113.80 }
  ];
  const M = makeWorld(fixtureMem({
    s1: { date: DAY, hasFix: true, crumbs: MORNING.concat(stray) },  /* a record stamped Oct 22 holding post-midnight crumbs */
    s2: { date: DAY, hasFix: true, crumbs: AFTERNOON },
    s3: { date: DAY, hasFix: true, crumbs: EVENING }
  }));
  const c = M._collectDay(DAY);
  ok('post-midnight crumbs never leak into the day\'s route',
    c.routeStops.every(function (s) { return Math.abs(s.lat - 51.30) > 0.01; }),
    JSON.stringify(c.routeStops.map(function (s) { return s.lat; })));
  ok('the day\'s own stops are all still there', stopSummary(c).join(',') === '21,21,12,25,11', stopSummary(c).join(','));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
