#!/usr/bin/env node
/* Meticulous v84 — BUILT-IN NAVIGATOR PLACES.
 *
 * Owner evidence (Oct 15, 2026): Navigator → Work favorites was
 * EMPTY — "Where did you save the addresses? And how do I even
 * input a address?" The compiled places lived in Claude-side
 * files (job-sites directory + confirmed pits list); the app held
 * none. This suite loads the REAL NAV-BUILTIN region of
 * modules/navigation.js and verifies the seed against the source
 * data: exact pins copied from the owner's dispatch messages,
 * confirmed places only, and the wiring that makes them
 * searchable/tappable in Navigation AND selectable as a Navigator
 * destination.
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

const sb = {};
vm.createContext(sb);
vm.runInContext(extractCommentRegion(navSrc, 'NAV-BUILTIN-BEGIN', 'NAV-BUILTIN-END') +
  '\nthis.__x = { BUILTINS, builtinPlaces, findBuiltin };', sb);
const X = sb.__x;
const P = X.BUILTINS;
const byName = {};
P.forEach(p => { byName[p.name] = p; });

console.log('\n— the seed —');
eq('25 built-in places', P.length, 25);
ok('every entry is marked builtin with a bi- id', P.every(p => p.builtin === true && p.id.indexOf('bi-') === 0));
ok('ids are unique', new Set(P.map(p => p.id)).size === P.length);
ok('names are unique', new Set(P.map(p => p.name)).size === P.length);
ok('every entry has a pin OR a street address', P.every(p => (p.lat && p.lng) || p.address));
ok('every pin sits in Alberta', P.every(p => !p.lat || (p.lat > 49 && p.lat < 52.5 && p.lng > -115.5 && p.lng < -113)));
ok('every type is one of pit / job site / dump site / fuel',
  P.every(p => ['pit', 'job site', 'dump site', 'fuel'].indexOf(p.type) !== -1));

console.log('\n— exact pins from the owner’s dispatch history —');
eq('12th Street pin (Oct 15 dispatch)', byName['12th Street'].lat + ',' + byName['12th Street'].lng, '51.000861,-114.033528');
eq('Aecon Bradi Pit pin', byName['Aecon Bradi Pit'].lat + ',' + byName['Aecon Bradi Pit'].lng, '51.27206,-114.43179');
eq('A2-L20 pin', byName['A2-L20'].lat + ',' + byName['A2-L20'].lng, '50.96649,-114.03178');
eq('Amrize pin', byName['Amrize'].lat + ',' + byName['Amrize'].lng, '50.9942951,-114.0334216');
eq('Pier 3 pin', byName['Pier 3'].lat + ',' + byName['Pier 3'].lng, '50.95537,-114.02769');
eq('CIP dump pin shares the L30 CIP spot', byName['CIP (dump pin)'].lat + ',' + byName['CIP (dump pin)'].lng,
  byName['L30 CIP'].lat + ',' + byName['L30 CIP'].lng);
eq('Mobil — Westwinds address (his main diesel stop)', byName['Mobil — Westwinds'].address, '300-3633 Westwinds Dr NE, Calgary');
eq('Mobil — Heritage Meadows address', byName['Mobil — Heritage Meadows'].address, '100-20 Heritage Meadows Way SE, Calgary');
eq('fuel places are type fuel', byName['Mobil — Westwinds'].type + '/' + byName['Mobil — Heritage Meadows'].type, 'fuel/fuel');

console.log('\n— confirmed only: the unconfirmed stay OUT —');
ok('no "Star Pit" entry', !P.some(p => /star pit/i.test(p.name)), '');
ok('no Aecon Scale Star Pit (its pin was never proven to mark the pit)', !P.some(p => /scale star/i.test(p.name)));
ok('no Black Diamond pit (loading unconfirmed)', !P.some(p => /black diamond/i.test(p.name)));
ok('no South plant (bare mention)', !P.some(p => /south plant/i.test(p.name)));
ok('no Cedar Glen (pin never resolved to numbers)', !P.some(p => /cedar glen/i.test(p.name)));
eq('findBuiltin resolves by id', (X.findBuiltin(byName['A2-L20'].id) || {}).name, 'A2-L20');
eq('builtinPlaces returns the list', X.builtinPlaces().length, 25);

console.log('\n— wiring —');
ok('Navigation api exposes builtinPlaces', navSrc.includes('builtinPlaces: builtinPlaces'));
ok('openNav navigates to the PIN when a place has one', navSrc.includes("(fav.lat + ',' + fav.lng)"));
ok('Work tab renders the built-in card with search', navSrc.includes('id="nv_bi_q"') && navSrc.includes('Built-in places'));
ok('built-in rows carry the standard nav buttons', navSrc.includes('navButtons(f, \'work\')') || navSrc.includes("navButtons(f, 'work')"));
ok('findFav resolves built-ins (visits/Go-again keep the pin)', navSrc.includes('findBuiltin(id)'));
ok('recent entries keep the pin', navSrc.includes('rec.lat = fav.lat'));
ok('Navigator offers the built-in picker', torSrc.includes('id="nv_places"') && torSrc.includes('builtinPlaces()'));
ok('Navigator picker sets the destination on the pin', torSrc.includes('setDest([p.lat, p.lng], p.name)'));
ok('Navigator reads the list lazily (no load-order dependency)', torSrc.includes('Meticulous.modules.navigation.builtinPlaces'));
ok('no routing-server config touched (no serverUrl writes in either module)', !/serverUrl\s*[:=]/.test(navSrc));

console.log('\nnav-places test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
