'use strict';
/*
 * nav-speed-limit-v338-test.js — NAV-SPEED-MISREADS (Nov 4
 * drive): the limit badge showed 60 on Stoney Trail (posted
 * 100) for minutes while he did 62–79, and the 80 Ave NE
 * badge read 70 in portrait frames, 60 in landscape frames —
 * the badge disagreed with the road and with itself.
 *
 * v338 repairs, around the v300 judge (semantics unchanged):
 *  1. the judge (pickLimitAnswer) is NAVPURE and tested:
 *     name-matched way wins (nearest such), else the nearest
 *     way within 20 m, else unknown — never a borrowed number.
 *  2. a sequence guard: only the LATEST Overpass query may
 *     paint (two overlapping answers used to land in arrival
 *     order — the portrait/landscape disagreement).
 *  3. a stale answer (>75 m of travel since its query) is
 *     discarded and the throttle softened, instead of painting
 *     a previous road's limit for the whole leg (the Stoney
 *     60).
 *  4. a new drive never opens wearing the previous drive's
 *     limit.
 *
 * THEN: webVersion is 338 + the index navigator tag.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const navSrc = read('modules/navigator.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) { ok(name, got === want, 'got ' + got + ', want ' + want); }

function extract(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error('markers missing');
  return src.slice(i, j + b.length);
}
const sb = { console: console, Math: Math };
vm.createContext(sb);
vm.runInContext(extract(navSrc, '/* ================= NAVPURE-BEGIN =================', '/* ================= NAVPURE-END ================= */'), sb);
const pick = sb.pickLimitAnswer;
ok('pickLimitAnswer is in NAVPURE', typeof pick === 'function');

/* geometry helpers: a straight east-west way at lat offset */
const M_PER_DEG_LAT = 110540;
function way(name, maxspeed, latOffM, lonSpan) {
  const lat = 51.05 + latOffM / M_PER_DEG_LAT;
  return { tags: { name: name, maxspeed: maxspeed }, geometry: [{ lat: lat, lon: -114.06 }, { lat: lat, lon: -114.06 + (lonSpan || 0.01) }] };
}
const POS = [51.05, -114.055]; // mid-span

eq('the road under the truck wins (nearest)', pick([way('80 Avenue NE', '70', 8)], POS, ''), 70);
eq('a named match beats a nearer unnamed way',
  pick([way('Ramp', '60', 5), way('Stoney Trail', '100', 25)], POS, 'stoney trail'), 100);
eq('two named ways: the NEARER named wins (the mainline, not the braid ramp)',
  pick([way('Stoney Trail', '60', 30), way('Stoney Trail', '100', 10)], POS, 'stoney trail'), 100);
eq('nothing within 20 m and no name match → unknown (null), never borrowed',
  pick([way('Frontage Road', '50', 45)], POS, 'stoney trail'), null);
eq('an unparseable maxspeed is skipped, not read as a limit',
  pick([way('80 Avenue NE', 'fast', 8), way('80 Avenue NE', '70', 12)], POS, ''), 70);
eq('mph tags convert (60 mph on a US-style tag)', pick([way('Highway', '60 mph', 8)], POS, ''), 97);
eq('no elements → unknown', pick([], POS, 'stoney trail'), null);
eq('no position → unknown', pick([way('X', '50', 0)], null, ''), null);

/* wiring pins */
ok('only the latest query may paint (sequence guard)',
  navSrc.indexOf('var mySeq = (S.limitSeq = (S.limitSeq || 0) + 1);') >= 0 &&
  navSrc.indexOf('if (mySeq !== S.limitSeq) return;') >= 0);
ok('a stale answer (>75 m on) is discarded with a softened throttle',
  navSrc.indexOf('haversineM(queryPos, S.pos) > 75') >= 0 &&
  navSrc.indexOf('S.limitFetchedAt = Date.now() - 20000;') >= 0);
ok('the callback judges through pickLimitAnswer',
  navSrc.indexOf('S.limitKmh = pickLimitAnswer(j && j.elements, [lat, lon], roadWanted);') >= 0);
ok('a new drive resets the limit state',
  navSrc.indexOf('S.limitKmh = null; S.limitPos = null; S.limitFetchedAt = 0;') >= 0);
ok('webVersion is 338', ver.webVersion === 338, 'got ' + ver.webVersion);
ok('index.html pins navigator.js?v=338', idxSrc.indexOf('modules/navigator.js?v=338') >= 0);

console.log('\nnav-speed-limit-v338 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
