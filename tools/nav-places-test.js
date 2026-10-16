#!/usr/bin/env node
/* Meticulous v91 — PLACES: FAMOUS PITS SHIP, THE OWNER'S 25 MIGRATE.
 *
 * Owner (Oct 16, 2026, on site at A2-L20, looking at the v87
 * dropdown): "All these places are useful for me, but not useful
 * for everyone else… I don't see a reason why this should ship
 * out with these locations preloaded. Figure out a way to save
 * them in my favourites… But these can't stay in the GPS." Then,
 * refined the same morning: a SMALL set of FAMOUS public pits MAY
 * ship — Stoney pit, Lafarge North, Lafarge South, Volker Stevin,
 * SP (= South Plant), Lafarge Industrial, North Plant — under a
 * PIN HONESTY RULE: a place ships only with a pin/address verified
 * from a PUBLIC source (the company's own site, a public business
 * listing); unverifiable places stay out and are flagged.
 *
 * Verified from public listings on build day (Oct 16, 2026):
 *   - Stoney Pit — listing "Stoney Trail Aggregate Resource",
 *     12411 85 St NW, Calgary, pin 51.165429,-114.213202
 *     (website stoneytrailpit.ca — the pit's own site).
 *   - Volker Stevin — 7175 12 St SE, Calgary, pin
 *     50.990329,-114.037808 (listing website volkerstevin.ca —
 *     the company's own site lists this address).
 * NOT verified (no public listing ties the name to a specific
 * pin/address), therefore NOT shipped: Lafarge North, Lafarge
 * South, Lafarge Industrial, North Plant, South Plant.
 *
 * This suite verifies, against the REAL module:
 *  A. The shipped built-in dataset is EXACTLY the verified famous
 *     set — type 'pit', exact pins/addresses, sources named in
 *     the code comment next to the data.
 *  B. The owner's 25 survive ONLY inside the NAV-MIGRATION code
 *     path (this fixture is their other allowed home) — byte-exact
 *     names/pins/notes/addresses — and appear nowhere else in the
 *     module: the built-in dataset holds none of them.
 *  C. The v87 wiring is untouched (one field, nav_pending hand-off,
 *     Add behind its button) and the v91 wiring exists (migration
 *     entry point + versioned flag, the Yard pick).
 * Migration BEHAVIOR (fresh vs existing, dedupe, delete-sticks)
 * is driven in tools/nav-dropdown-test.js.
 * Run: node tools/nav-places-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function eq(name, got, want) {
  if (String(got) === String(want)) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}

const navSrc = fs.readFileSync(path.join(ROOT, 'modules', 'navigation.js'), 'utf8');
const torSrc = fs.readFileSync(path.join(ROOT, 'modules', 'navigator.js'), 'utf8');
function extractCommentRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('region not found: ' + beginMark);
  return src.slice(a, b + 2);
}
function regionBounds(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('region not found: ' + beginMark);
  return [a, b + 2];
}

/* ================= A: the shipped famous set ================= */
console.log('\n— A: the shipped built-ins are the verified famous set —');
const sb = {};
vm.createContext(sb);
vm.runInContext(extractCommentRegion(navSrc, 'NAV-BUILTIN-BEGIN', 'NAV-BUILTIN-END') +
  '\nthis.__x = { BUILTINS, builtinPlaces, findBuiltin };', sb);
const P = sb.__x.BUILTINS;
const byName = {};
P.forEach(p => { byName[p.name] = p; });

eq('exactly 2 built-in places ship', P.length, 2);
ok('every entry is marked builtin with a bi- id', P.every(p => p.builtin === true && p.id.indexOf('bi-') === 0));
ok('ids and names are unique', new Set(P.map(p => p.id)).size === P.length && new Set(P.map(p => p.name)).size === P.length);
ok('every famous entry is type pit (owner order)', P.every(p => p.type === 'pit'));
ok('every famous entry carries BOTH a pin and a street address', P.every(p => p.lat && p.lng && p.address));
eq('Stoney Pit pin (public listing: Stoney Trail Aggregate Resource)', byName['Stoney Pit'].lat + ',' + byName['Stoney Pit'].lng, '51.165429,-114.213202');
eq('Stoney Pit address', byName['Stoney Pit'].address, '12411 85 St NW, Calgary');
eq('Volker Stevin pin (public listing, volkerstevin.ca)', byName['Volker Stevin'].lat + ',' + byName['Volker Stevin'].lng, '50.990329,-114.037808');
eq('Volker Stevin address', byName['Volker Stevin'].address, '7175 12 St SE, Calgary');
const builtinRegion = navSrc.slice.apply(navSrc, regionBounds(navSrc, 'NAV-BUILTIN-BEGIN', 'NAV-BUILTIN-END'));
ok('the dataset comment names its public sources', builtinRegion.includes('stoneytrailpit.ca') && builtinRegion.includes('volkerstevin.ca'));
ok('the unverifiable five are named as NOT shipped in the comment',
  ['Lafarge North', 'Lafarge South', 'Lafarge Industrial', 'North Plant', 'South Plant'].every(n => builtinRegion.includes(n)));

/* ================= B: the owner's 25 live only in the migration ================= */
console.log('\n— B: the owner’s 25 — byte-exact, migration-only —');
/* the fixture: the v84/v87 dataset, verbatim —
   [name, lat, lng, type, note, address] */
const FIXTURE = [
  ['12th Street', 51.000861, -114.033528, 'pit', 'Clay loading · one pin covers both sides — confirm North/South before rolling', ''],
  ['Aecon Bradi Pit', 51.27206, -114.43179, 'pit', 'Loads 80mm · near Cochrane', ''],
  ['Simply Stone', 50.96851, -114.0334, 'pit', 'Stone yard', ''],
  ['L5', 50.96657, -114.03564, 'pit', 'Aecon Inf load point', ''],
  ['Pier 3', 50.95537, -114.02769, 'job site', 'Enter through Remington', ''],
  ['North Plant', 51.1832681, -114.0366215, 'job site', '', ''],
  ['Southland Under Bridge', 50.967364, -114.033821, 'job site', 'Under the bridge, Southland', ''],
  ['Greenline', 51.00779, -114.02766, 'job site', 'Load point — also used as a dump spot', ''],
  ['Twins East', 50.9552222, -114.0249722, 'job site', 'Aecon Inf', ''],
  ['A2-L20', 50.96649, -114.03178, 'job site', 'Possibly the same pond complex as L20 Pond', ''],
  ['L20 Pond', 50.96602, -114.03211, 'job site', '', ''],
  ['L30 CIP', 50.9794722, -114.0388056, 'job site', 'The CIP dump pin is this same spot', ''],
  ['CIP (dump pin)', 50.9794722, -114.0388056, 'dump site', 'Dump for 12th Street clay · same spot as L30 CIP', ''],
  ['Ivor East Pond', 50.95134, -114.01563, 'job site', '', ''],
  ['Remington', 50.9605833, -114.03, 'job site', 'Also the entrance for Pier 3', ''],
  ['Remington — bridge spot', 50.953, -114.02235, 'job site', 'The bridge in Remington', ''],
  ['Deerfoot / Bow Bottom exit', 50.9510199, -114.0257907, 'job site', 'Northbound Deerfoot exit from Bow Bottom Trail — right side of the ramp', ''],
  ['Maple Ridge', 50.96044, -114.03176, 'job site', '', ''],
  ['Amrize', 50.9942951, -114.0334216, 'dump site', 'Hauling-to site · several gates/piles in this area — confirm the pin for the day', ''],
  ['Burco Blvd (dump spot)', 50.9943056, -114.0334167, 'dump site', 'The "dump here" pin from the Burco Blvd 40mm drain run', ''],
  ['P Hauling yard (Ryan King)', 50.8785371, -114.0116239, 'job site', 'Ryan King / P Hauling address pin', ''],
  ['Volker — Cochrane job', 51.1770806, -114.4612953, 'job site', 'Via Hwy 22 to Griffin — avoid the no-truck route', ''],
  ['Lillydale Chicken', 51.0339417, -114.0380928, 'job site', 'Pin sent with a "Go Empty To" dispatch', '12059 44 St SE, Calgary'],
  ['Mobil — Westwinds', null, null, 'fuel', 'His main diesel stop', '300-3633 Westwinds Dr NE, Calgary'],
  ['Mobil — Heritage Meadows', null, null, 'fuel', '', '100-20 Heritage Meadows Way SE, Calgary']
];
const sbm = { App: { _store: { get: () => null, set: () => true } }, Meticulous: { modules: {} } };
sbm.window = sbm;
vm.createContext(sbm);
vm.runInContext(extractCommentRegion(navSrc, 'NAV-MIGRATION-BEGIN', 'NAV-MIGRATION-END') +
  '\nthis.__m = { MIGRATION_RAW, MIGRATION_VERSION };', sbm);
const M = sbm.__m.MIGRATION_RAW;
eq('the migration dataset holds all 25', M.length, 25);
eq('the migration flag is versioned (91)', sbm.__m.MIGRATION_VERSION, 91);
let allExact = true, firstBad = '';
FIXTURE.forEach((f, i) => {
  const r = M[i] || [];
  const same = r[0] === f[0] && String(r[1]) === String(f[1]) && String(r[2]) === String(f[2]) &&
    r[3] === f[3] && r[4] === f[4] && (r[5] || '') === f[5];
  if (!same) { allExact = false; firstBad = 'row ' + i + ' (' + f[0] + '): ' + JSON.stringify(r); }
});
ok('every migration row is byte-exact vs the v84/v87 fixture', allExact, firstBad);
ok('none of the 25 is in the shipped built-in dataset', FIXTURE.every(f => !byName[f[0]]));
/* confinement: outside the migration region, none of the 23
   distinctive names appears anywhere in the module (North Plant
   / South Plant also live in the famous-set comment as NOT
   shipped, so they are checked against the dataset above). */
const migB = regionBounds(navSrc, 'NAV-MIGRATION-BEGIN', 'NAV-MIGRATION-END');
const outsideMig = navSrc.slice(0, migB[0]) + navSrc.slice(migB[1]);
const DISTINCT = FIXTURE.map(f => f[0]).filter(n => n !== 'North Plant' && n !== 'South Plant');
ok('the other 23 names appear ONLY inside the migration region',
  DISTINCT.every(n => !outsideMig.includes(n)),
  DISTINCT.filter(n => outsideMig.includes(n)).join(', '));
ok('the built-in region itself holds none of the 25 names', FIXTURE.every(f => !builtinRegion.includes("'" + f[0] + "'")) ||
  FIXTURE.every(f => !byName[f[0]]));

/* ================= C: wiring ================= */
console.log('\n— C: wiring —');
ok('Navigation api exposes builtinPlaces', navSrc.includes('builtinPlaces: builtinPlaces'));
ok('v87: the ONE picker field renders (filter input + select)', navSrc.includes('id="nv_q"') && navSrc.includes('id="nv_sel"'));
ok('v87: combined list assembly (built-ins + favorites, tagged by source)', navSrc.includes('function placesFor') && navSrc.includes("src: 'builtin'") && navSrc.includes("src: 'fav'"));
ok('v87: Navigate hands the PIN over via nav_pending', navSrc.includes("App._store.set('nav_pending'") && navSrc.includes('pend.lat = fav.lat'));
ok('v87: Navigate opens the in-app Navigator', navSrc.includes("App.openModule('navigator')"));
ok('v87: the detail panel carries the ONE primary action', navSrc.includes('id="nv_go"') && navSrc.includes('🧭 Navigate'));
ok('v87: the Add form lives behind its button (never the landing face)', navSrc.includes('id="nv_addopen"') && navSrc.includes("addOpen ? 'block' : 'none'"));
ok('v87: NO card wall, NO external nav URLs', !navSrc.includes('data-navapp') && !navSrc.includes('navButtons(') &&
  !navSrc.includes('waze.com') && !navSrc.includes('maps.apple.com') && !navSrc.includes('google.com/maps') && !navSrc.includes('geo:0,0'));
ok('v87: visits still record (manifest feed + recent keep the pin)', navSrc.includes('manifestFeedPush') && navSrc.includes('rec.lat = fav.lat'));
ok('v91: migration runs from data() and is flag-guarded', navSrc.includes('function data()') &&
  navSrc.includes('migrateLegacyPlaces();') && navSrc.includes("S('places_migrated', 0)") && navSrc.includes("W('places_migrated', MIGRATION_VERSION)"));
ok('v91: migration dedupes by name AND by pin', navSrc.includes('nameKey') && navSrc.includes('Math.abs(+f.lat - r[1]) < 1e-6'));
ok('v91: Navigation api exposes the migration for tests/tools', navSrc.includes('migrateLegacyPlaces: migrateLegacyPlaces'));
ok('v91: the Yard pick renders as ONE select in the places card', navSrc.includes('id="nv_yard"') && navSrc.includes("W('yard', { kind:"));
ok('v91: plain empty-state copy (no "already here" promise)', !navSrc.includes('are already here') && navSrc.includes('Pick a place above.'));
ok('v87: Navigator consumes the pending destination through setDest', torSrc.includes("App._store.get('nav_pending'") && torSrc.includes("App._store.del('nav_pending')"));
ok('Navigator offers the built-in picker', torSrc.includes('id="nv_places"') && torSrc.includes('builtinPlaces()'));
ok('Navigator picker sets the destination on the pin', torSrc.includes('setDest([p.lat, p.lng], p.name)'));
ok('no routing-server config touched (no serverUrl writes in either module)', !/serverUrl\s*[:=]/.test(navSrc));

console.log('\nnav-places test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
