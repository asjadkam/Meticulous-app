#!/usr/bin/env node
/* Meticulous v262 — NAV-LIVE-TRAFFIC-CITYFEED suite (owner
 * approved Oct 26, 2026 08:14 MDT — "Yes build it!"): live
 * traffic incidents from the City of Calgary's FREE open-data
 * feed (data.calgary.ca, Socrata dataset 4jah-h97u "Current
 * Traffic Incidents" — endpoint, fields, freshness, coverage
 * and licence verified with live calls the morning of the
 * build: rowsUpdatedAt minutes old, newest incident ~13 min
 * old, "Continuous" updates / 10-minute resolution, City of
 * Calgary Open Data Terms).
 *
 * Pins: (a) the pure helpers — SODA parsing (bad coordinates
 * dropped, never guessed) and the on-route projection (only
 * incidents ON the route AHEAD of the truck, within 75 m of
 * its line and 3 km ahead, in approach order; behind/off-route
 * stay silent); (b) the wiring — the feed URL, the trafficOn
 * default, the layers-panel switch replacing the v240 "soon"
 * placeholder, the drive chip, the speech priority, and the
 * no-reroute boundary (warnings never touch the route). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };
const navSrc = read('modules/navigator.js');
const css = read('css/style.css');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? ' — ' + detail : '')); }
}
function extract(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}

/* ---------- NAVPURE: parsing ---------- */
console.log('— parseCityIncidents: the SODA shape, bad rows dropped —');
const sb = { console: console };
vm.createContext(sb);
vm.runInContext(extract(navSrc, 'NAVPURE-BEGIN', 'NAVPURE-END'), sb);

const ROWS = [
  { incident_info: 'Southbound Crowchild Trail approaching 24 Avenue NW',
    description: 'Two vehicle incident. Blocking the left lane',
    start_dt_utc: '2026-10-26T14:02:41.000', latitude: '51.07510', longitude: '-114.11900' },
  { incident_info: 'No coordinates at all', description: 'Ghost',
    start_dt_utc: '2026-10-26T14:00:00.000' },
  { incident_info: 'Junk coordinates', description: 'Ghost',
    start_dt_utc: '2026-10-26T14:00:00.000', latitude: 'abc', longitude: '-114.0' },
  { incident_info: 'Out of range', description: 'Ghost',
    start_dt_utc: '2026-10-26T14:00:00.000', latitude: '91.0', longitude: '-114.0' }
];
const parsed = sb.parseCityIncidents(ROWS);
check('only the honestly-located row survives (3 bad rows dropped, none guessed)',
  parsed.length === 1, 'got ' + parsed.length);
check('string coordinates become numbers; info/desc carried through',
  parsed[0].lat === 51.0751 && parsed[0].lng === -114.119 &&
  /Crowchild/.test(parsed[0].info) && /Two vehicle/.test(parsed[0].desc));
check('the id is the feed identity: start time + fixed-5 position',
  parsed[0].id === '2026-10-26T14:02:41.000|51.07510|-114.11900', parsed[0].id);
check('empty / null answers parse to an empty list (silence, never invention)',
  sb.parseCityIncidents([]).length === 0 && sb.parseCityIncidents(null).length === 0);

/* ---------- NAVPURE: on-route projection ---------- */
console.log('— trafficOnRoute: on the route, ahead of the truck, only —');
const LINE = [[51.0, -114.0], [51.03, -114.0]]; /* ~3.34 km straight north */
function inc(lat, lng, tag) {
  return { id: tag, lat: lat, lng: lng, info: tag, desc: tag };
}
const AHEAD_ON = inc(51.01, -114.0, 'A');       /* ~1.11 km ahead, on the line */
const AHEAD_NEAR = inc(51.02, -113.9995, 'B');  /* ~2.22 km ahead, ~35 m off */
const BEHIND = inc(50.999, -114.0, 'C');        /* behind the truck */
const OFF_ROUTE = inc(51.01, -113.9985, 'D');   /* ~105 m off the line */
const TOO_FAR = inc(51.0295, -114.0, 'E');      /* ~3.28 km ahead — past the 3 km reach */
const hits = sb.trafficOnRoute(LINE, 0, [AHEAD_ON, AHEAD_NEAR, BEHIND, OFF_ROUTE, TOO_FAR], 75, 3000);
check('exactly the two on-route incidents ahead are returned',
  hits.length === 2, 'got ' + hits.map(function (h) { return h.inc.id; }).join(','));
check('they arrive in approach order with growing ahead distances',
  hits[0].inc.id === 'A' && hits[1].inc.id === 'B' && hits[0].aheadM < hits[1].aheadM &&
  Math.abs(hits[0].aheadM - 1112) < 15, JSON.stringify(hits.map(function (h) { return Math.round(h.aheadM); })));
check('an incident the truck has already passed falls silent (truck along 1500 m)',
  sb.trafficOnRoute(LINE, 1500, [AHEAD_ON, AHEAD_NEAR], 75, 3000).length === 1);
check('no route / no incidents -> no hits, no crash',
  sb.trafficOnRoute(null, 0, [AHEAD_ON], 75, 3000).length === 0 &&
  sb.trafficOnRoute(LINE, 0, [], 75, 3000).length === 0);

/* ---------- wiring pins ---------- */
console.log('— wiring: feed, switch, chip, speech, no rerouting —');
check('the feed is the verified City of Calgary Socrata endpoint',
  navSrc.indexOf('https://data.calgary.ca/resource/4jah-h97u.json') !== -1);
check('trafficOn defaults ON and persists as its own setting (not a driveLayer value)',
  /trafficOn: s\.trafficOn === undefined \? true : !!s\.trafficOn/.test(navSrc) &&
  /saveSettings\(\{ trafficOn: on \}\)/.test(navSrc));
check('the v240 "soon" placeholder is gone from the layers panel',
  navSrc.indexOf('nv-layer-soon') === -1 && !/isn.t live yet/.test(navSrc));
check('the layers lamp for Traffic follows trafficOn, not driveLayer',
  /#nvd_layer_traffic'\)\;\s*\n\s*if \(tb\) tb\.classList\.toggle\('on', !!S\.settings\.trafficOn\)/.test(navSrc));
check('the drive screen carries the traffic chip beside the reroute pill',
  navSrc.indexOf('id="nvd_traffic"') !== -1 &&
  /class="nv-drive-traffic hidden"/.test(navSrc));
check('markers are the amber badge; the chip is alert red (CSS present)',
  css.indexOf('.nv-traffic-pin{') !== -1 && css.indexOf('.nv-traffic-pin-wrap{') !== -1 &&
  /\.nv-drive-traffic\{[^}]*#b71c1c/.test(css));
check('markers are radius-gated (40 km) — no city-wide clutter',
  /TRAFFIC_RADIUS_M = 40000/.test(navSrc) && /haversineM\(centre, \[inc\.lat, inc\.lng\]\) <= TRAFFIC_RADIUS_M/.test(navSrc));
check('the refresh is cadence-gated at 2 minutes (inside the feed\u2019s own 10-minute resolution)',
  /TRAFFIC_REFRESH_MS = 120000/.test(navSrc) && /now - S\.trafficAt < TRAFFIC_REFRESH_MS/.test(navSrc));
check('a new route re-arms the once-per-incident warnings',
  /S\.trafficSaid = \{\};\s*\n\s*fetchTraffic\(true\);/.test(navSrc));
check('traffic speaks only when no turn and no grade warning spoke (speak cancels)',
  /if \(!say && !gradeSpoke && trafficHits\.length\)/.test(navSrc));
check('the spoken text is the feed\u2019s own words + distance',
  /speak\('Traffic ahead \u2014 ' \+ \(hit\.inc\.desc/.test(navSrc) && /In ' \+ fmtDist\(hit\.aheadM\)/.test(navSrc));
check('the chip shows the NEAREST hit and hides when the road ahead is clear',
  /trafficHits\[0\]\.aheadM/.test(navSrc) && /trafficShown/.test(navSrc));
check('warnings never touch the route: no reroute call in the traffic path',
  !/fetchTraffic[\s\S]{0,400}maybeFetchPlan/.test(navSrc) &&
  navSrc.indexOf('Display + voice only — the route is') !== -1);

console.log('\nnav-traffic-v262: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
