#!/usr/bin/env node
/* Meticulous v190 — M-ROUTE HOME-STOPS suite.
 *
 * The owner's ruling, Oct 21, 2026 07:23 MDT: his Manifest
 * preview for today listed two stops AT HOME (51.15710,
 * −113.93860 — 6:06 AM · 42 min; 6:52 AM · 17 min) as day
 * stops. The day's stops start when the truck leaves home;
 * at-home time is not a work stop. collect() now filters stops
 * within 250 m of the saved Home place out of routeStops, so
 * they leave the screen list AND the PDF (both render
 * collect's routeStops). trailStops stays pure/untouched.
 *
 * Run: node tools/manifest-home-stops-v190-test.js
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

const man = read('modules/manifest.js');

console.log('— v190: source pins —');
ok('homePin resolves the saved favorite named Home from nav_data',
  man.indexOf('function homePin()') !== -1 && man.indexOf("G('nav_data'") !== -1 &&
  man.indexOf("=== 'home'") !== -1);
ok('dropHomeStops exists beside trailStops',
  man.indexOf('function dropHomeStops(stops, home)') !== -1);
ok('collect applies the filter to routeStops',
  man.indexOf('routeStops = dropHomeStops(routeStops, homePin());') !== -1);
ok('the filter is exported for the pipe/tests',
  man.indexOf('_dropHomeStops: dropHomeStops') !== -1);
ok('trailStops itself is untouched by the filter',
  man.slice(man.indexOf('function trailStops'), man.indexOf('function homePin()')).indexOf('home') === -1 ||
  man.slice(man.indexOf('function trailStops'), man.indexOf('/* v190')).indexOf('dropHomeStops') === -1);

console.log('— v190: the filter, driven from the module source —');
{
  /* The region from trailDistM to the v87 comment carries
     trailDistM + trailStops + homePin + dropHomeStops. homePin
     needs G — give the sandbox a store. */
  const store = {
    nav_data: {
      personal: [{ name: 'Home', lat: 51.15710, lng: -113.93860 }],
      work: [{ name: 'Star Pit', lat: 51.05, lng: -113.95 }]
    }
  };
  const sb = { console: console, G: function (k, d) { return (k in store) ? store[k] : d; } };
  vm.createContext(sb);
  const a = man.indexOf('function trailDistM');
  const b = man.indexOf('/* v87: ONE Odometer line');
  vm.runInContext(man.slice(a, b), sb);
  ok('homePin + dropHomeStops extract cleanly',
    typeof sb.homePin === 'function' && typeof sb.dropHomeStops === 'function');
  eq('homePin finds Home in personal', sb.homePin(), { lat: 51.15710, lng: -113.93860 });

  const HOME = { lat: 51.15710, lng: -113.93860 };
  /* His Oct 21 morning: two at-home stops, then real work stops. */
  const stops = [
    { at: 'x', label: '', lat: 51.15710, lng: -113.93860, mins: 42 },   /* 6:06 AM at home */
    { at: 'x', label: '', lat: 51.15730, lng: -113.93830, mins: 17 },   /* 6:52 AM, ~35 m from home */
    { at: 'x', label: 'Star Pit', lat: 51.05000, lng: -113.95000, mins: 25 },
    { at: 'x', label: '', lat: 51.12000, lng: -113.90000, mins: 12 }
  ];
  const kept = sb.dropHomeStops(stops, HOME);
  eq('both home stops are gone, both work stops stay', kept.map(function (s) { return s.mins; }), [25, 12]);
  eq('a stop 200 m from home is still home-side (inside 250 m)',
    sb.dropHomeStops([{ lat: 51.15890, lng: -113.93860, mins: 5 }], HOME), []);
  eq('a stop 400 m from home survives',
    sb.dropHomeStops([{ lat: 51.16070, lng: -113.93860, mins: 5 }], HOME).length, 1);
  eq('no Home pin -> nothing filtered', sb.dropHomeStops(stops, null), stops);
  eq('empty stops -> empty', sb.dropHomeStops([], HOME), []);
  eq('null stops -> empty list, no crash', sb.dropHomeStops(null, HOME), []);

  /* trailStops purity: it still REPORTS the home dwell — the
     filter lives in collect, not in the derivation. */
  const T0 = 1760000000000;
  const crumbs = [
    { t: T0, a: 51.15710, o: -113.93860 }, { t: T0 + 60000, a: 51.15712, o: -113.93861 },
    { t: T0 + 2520000, a: 51.15711, o: -113.93859 }, { t: T0 + 2580000, a: 51.05, o: -113.95 }
  ];
  const raw = sb.trailStops(crumbs);
  ok('trailStops still derives the home dwell (filter is collect-side)',
    raw.length === 1 && raw[0].mins >= 40, JSON.stringify(raw));
}

console.log('\nmanifest-home-stops-v190: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
