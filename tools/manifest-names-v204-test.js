#!/usr/bin/env node
/* Meticulous v204 — MANIFEST-NAMES + the home filter, verified
 * against his exact screenshot (owner, Oct 21, 2026 10:09 MDT):
 *  (1) "Where the truck went" rendered stops as raw coordinates
 *      ("Stop — 51.15710, -113.93860"). Ruling: NAMES, not
 *      coordinates — a stop at a learned or saved place shows
 *      the place's name (Home, the pit, the dump site);
 *      coordinates only for a place the app has never seen.
 *      placeNameFor (modules/manifest.js) resolves the nearest
 *      known place within 250 m: saved places (nav_data), the
 *      built-in pits, learned pairs' labelled dump sites.
 *      collect() wires it into the stop labels, and the screen
 *      list AND the PDF both render those labels.
 *  (2) The same screenshot still listed the two HOME stops
 *      (51.15710 · 6:06 AM · 42 min; 51.15712 · 6:52 AM ·
 *      17 min) that v190 was supposed to drop. Verified here
 *      against those exact stops: with the Home pin present
 *      the filter drops both (they sit ~2 m from it). The one
 *      in-code miss: v190's homePin matched ONLY the exact
 *      name 'home' — a pin named with an emoji or "My Home"
 *      read as NO pin, and no pin means no filtering at all.
 *      homePin now takes the exact name first, then a name
 *      carrying 'home' as a word.
 * Run: node tools/manifest-names-v204-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const man = read('modules/manifest.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* ---- the extracted region, driven like the v190 suite ---- */
function makeWorld(store) {
  const sb = {
    console: console,
    G: function (k, d) { return (k in store) ? store[k] : d; }
  };
  sb.window = sb;
  sb.Meticulous = { modules: { navigation: { builtinPlaces: function () {
    return [
      { name: 'Amrize Industrial', lat: 51.008548, lng: -114.007485 },
      { name: 'Aecon Gravel Pit', lat: 50.722818, lng: -114.188562 }
    ];
  } } } };
  vm.createContext(sb);
  const a = man.indexOf('function trailDistM');
  const b = man.indexOf('/* v87: ONE Odometer line');
  if (a === -1 || b === -1) throw new Error('region markers missing');
  vm.runInContext(man.slice(a, b), sb);
  return sb;
}

const HOME = { lat: 51.15709, lng: -113.93862 };
console.log('— v204: the home filter against HIS exact stops —');
{
  const sb = makeWorld({ nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [] } });
  eq('homePin finds the pin', sb.homePin(), HOME);
  const stops = [
    { at: 'x', label: '', lat: 51.15710, lng: -113.93860, mins: 42 },  /* 6:06 AM — his screenshot */
    { at: 'x', label: '', lat: 51.15712, lng: -113.93855, mins: 17 },  /* 6:52 AM — his screenshot */
    { at: 'x', label: '', lat: 50.95050, lng: -114.01450, mins: 5 }    /* a work stop at the pond */
  ];
  const kept = sb.dropHomeStops(stops, sb.homePin());
  eq('both screenshot home stops are dropped, the work stop stays', kept.map(function (s) { return s.mins; }), [5]);
}
console.log('— v204: the pin the exact-only read missed —');
{
  const sb = makeWorld({ nav_data: { personal: [{ name: 'Home 🏠', lat: HOME.lat, lng: HOME.lng }], work: [] } });
  eq('a pin named "Home 🏠" now resolves', sb.homePin(), HOME);
  const sb2 = makeWorld({ nav_data: { personal: [{ name: 'My Home', lat: 51.2, lng: -114.1 }, { name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [] } });
  eq('the exact name still wins over a wordy one', sb2.homePin(), HOME);
  const sb3 = makeWorld({ nav_data: { personal: [{ name: 'Star Pit', lat: 51.05, lng: -113.95 }], work: [] } });
  eq('no home anywhere: no pin, no filtering invented', sb3.homePin(), null);
}

console.log('— v204: stop names, not coordinates —');
{
  const sb = makeWorld({
    nav_data: {
      personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }],
      work: [
        { name: 'Star Pit', lat: 50.98500, lng: -114.05200 },
        { name: 'Far Yard', lat: 51.30000, lng: -114.30000 }
      ]
    },
    geoload_pairs: { pairs: { '50.985,-114.052': { dump: { lat: 50.95050, lng: -114.01450, label: 'Ivor East Pond' } } } }
  });
  eq('a stop at the saved pit shows its name', sb.placeNameFor(50.98510, -114.05210), 'Star Pit');
  eq('a stop at the learned dump shows its label', sb.placeNameFor(50.95050, -114.01450), 'Ivor East Pond');
  eq('a stop at a built-in pit shows its name', sb.placeNameFor(51.00860, -114.00740), 'Amrize Industrial');
  eq('a stop at home shows Home (when it is listed at all)', sb.placeNameFor(51.15709, -113.93862), 'Home');
  eq('a stop the app has never seen resolves to nothing — coordinates stay', sb.placeNameFor(50.50000, -113.50000), '');
  eq('a stop 400 m from the nearest place is still unseen', sb.placeNameFor(50.98860, -114.05200), '');
}

console.log('— v204: statics —');
ok('collect wires placeNameFor into the stop labels',
  man.indexOf('if (!label) label = placeNameFor(s.lat, s.lng);') !== -1);
ok('placeNameFor is exported for this suite', man.indexOf('_placeNameFor: placeNameFor') !== -1);
ok('the screen list renders the label before coordinates',
  man.indexOf("esc(s.label || ('Stop — '") !== -1);
ok('the PDF lines render the same labels',
  man.indexOf("a: s.label || ('Stop — '") !== -1);
eq('webVersion', ver.webVersion, 239);
ok('index pin agrees', idxSrc.includes('modules/manifest.js?v=' + ver.webVersion));

console.log('manifest-names-v204: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
