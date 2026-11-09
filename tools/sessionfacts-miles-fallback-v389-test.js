#!/usr/bin/env node
/* Meticulous v389 — BUBBLE-KM-MISSING-IN-HANDS-NOV9, the named
 * web-side residual (owner, Mon Nov 9, 2026, 10:05 CST screenshot,
 * gen 65 in his hands: the widget read 16.7 km while the bubble —
 * composing from the native SessionRecord alone — showed loads
 * and NO km).
 *
 * The mechanism, named from the code: the page's sessionFacts()
 * took the session's miles ONLY from
 * LiveMiles.recordKmFor('s' + sessionId) — the PERSISTED record
 * for the session key. While that record holds no fix-backed
 * total, recordKmFor returns null and the facts carried
 * milesM -1, so every sync that day landed "unknown" on the
 * native record (and one such sync could erase a landed total —
 * the native half of that guard rides the gen-67 SessionRecord
 * pass). All day Nov 9 the persisted keyed record stayed
 * fix-less while the page's LIVE engine held the day's km — the
 * hero painted 16.6/16.7 km from LiveMiles.currentKm() — so the
 * widget (whose face starts from the web-pushed widget_state
 * string) showed km the record never held, and the bubble
 * honestly showed none.
 *
 * The contract under test (js/app.js ONLY):
 *  - sessionFacts falls back to the active day's fix-backed
 *    ENGINE total — LiveMiles.currentKm(), the very total the
 *    tracker hero paints — when recordKmFor(sessionKey) yields
 *    no total.
 *  - A landed recordKmFor total always wins, 0 included (a
 *    fix-backed zero is a real total; the fallback never
 *    overrides it).
 *  - With no fix-backed total in EITHER source, milesM stays
 *    -1: no number is invented.
 *  - Idle sessions still carry no miles (-1) regardless of
 *    either source.
 *  - recordKmFor itself is NOT changed: its keyed contract
 *    serves the stop-time / finalize readers, which must never
 *    inherit the live engine's day (pinned at S1).
 *
 * Drives the REAL sessionFacts sliced out of js/app.js (the
 * v325-rig slicing pattern) against stubbed LiveMiles shapes.
 * Run: node tools/sessionfacts-miles-fallback-v389-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const milesSrc = fs.readFileSync(path.join(ROOT, 'js', 'miles.js'), 'utf8');
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

function sliceBetween(s, startMark, endMark, endIncl) {
  const a = s.indexOf(startMark);
  const b = s.indexOf(endMark, a + 1);
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + startMark + ' .. ' + endMark);
  return s.slice(a, endIncl ? b + endMark.length : b);
}
/* loadsNumber + loadsArmedNow + sessionFacts, verbatim from app.js */
const factsCode = sliceBetween(appSrc, 'function loadsNumber() {', 'function syncSessionRecord() {', false);
const keyCode = sliceBetween(appSrc, 'function trackerSessionKeyMs() {', '/* v303 (PHANTOM-REVIVAL-OCT31)', false);

const SESSION_ID = 1762708200000; /* Nov 9, 08:30 local anchor shape */

function makeFacts(liveMiles, trackerOverrides) {
  const tracker = Object.assign({
    status: 'running', elapsed: 3600, startTs: SESSION_ID,
    sessionId: SESSION_ID, stateAt: SESSION_ID + 1000,
    accum: { manualLoads: 2 }
  }, trackerOverrides || {});
  const sandbox = {
    console: console,
    App: { tracker: tracker, _sessRev: 7 },
    trkAccum: function () { return { manualLoads: 2 }; },
    trackerSessionStartMs: function () { return SESSION_ID; },
    trackerSave: function () {},
    GeoLoads: undefined
  };
  sandbox.window = sandbox;
  if (liveMiles !== undefined) sandbox.LiveMiles = liveMiles;
  sandbox.window.LiveMiles = liveMiles;
  vm.createContext(sandbox);
  vm.runInContext(keyCode + '\n' + factsCode, sandbox);
  return sandbox.sessionFacts(false);
}
function lm(recordKm, currentKm) {
  return {
    recordKmFor: function (key) {
      if (key !== 's' + SESSION_ID) throw new Error('wrong key: ' + key);
      return recordKm;
    },
    currentKm: function () { return currentKm; }
  };
}

console.log('F — the fallback behaviour');
ok('F1 Nov 9 shape: recordKmFor null + engine 16.7 km -> facts carry 16700',
  makeFacts(lm(null, 16.7)).milesM === 16700, makeFacts(lm(null, 16.7)).milesM);
ok('F2 recordKmFor null + engine 16.6 km -> 16600 (the hero\'s other Nov 9 reading)',
  makeFacts(lm(null, 16.6)).milesM === 16600);
ok('F3 recordKmFor null + engine null -> -1 (no fix anywhere: unset, never invented)',
  makeFacts(lm(null, null)).milesM === -1);
ok('F4 recordKmFor 12.34 + engine 16.7 -> 12340 (the landed record total wins, unchanged)',
  makeFacts(lm(12.34, 16.7)).milesM === 12340);
ok('F5 recordKmFor 0 + engine 16.7 -> 0 (a fix-backed zero is landed; fallback never overrides)',
  makeFacts(lm(0, 16.7)).milesM === 0);
ok('F6 recordKmFor null + engine 0 -> 0 (a fix-backed zero from the engine lands)',
  makeFacts(lm(null, 0)).milesM === 0);
ok('F7 idle session: both sources rich -> -1 (idle carries no miles; the !idle gate stands)',
  makeFacts(lm(20.0, 20.0), { status: 'idle' }).milesM === -1);
ok('F8 LiveMiles absent entirely -> -1, no throw',
  makeFacts(undefined).milesM === -1);
ok('F9 recordKmFor throws + engine 9.5 -> 9500 (a broken keyed read cannot starve the fallback)',
  makeFacts({ recordKmFor: function () { throw new Error('store gone'); },
              currentKm: function () { return 9.5; } }).milesM === 9500);
ok('F10 recordKmFor null + currentKm throws -> -1, no throw',
  makeFacts({ recordKmFor: function () { return null; },
              currentKm: function () { throw new Error('engine gone'); } }).milesM === -1);
ok('F11 recordKmFor null + engine NaN -> -1 (non-finite refused)',
  makeFacts(lm(null, NaN)).milesM === -1);
ok('F12 the rest of the facts are untouched (status/elapsed/loads ride as before)',
  (function () { const f = makeFacts(lm(null, 16.7));
    return f.status === 'running' && f.elapsed === 3600 && f.loads === 2 &&
      f.sessionKey === 's' + SESSION_ID && f.milesM === 16700; })());

console.log('S — source pins');
const sfStart = appSrc.indexOf('function sessionFacts(force) {');
const sfSlice = appSrc.slice(sfStart, appSrc.indexOf('function syncSessionRecord() {', sfStart));
ok('S1a sessionFacts consults recordKmFor BEFORE the currentKm fallback',
  sfSlice.indexOf('recordKmFor') !== -1 &&
  sfSlice.indexOf('LiveMiles.currentKm') > sfSlice.indexOf('recordKmFor'));
const rkSlice = sliceBetween(milesSrc, 'recordKmFor: function (key) {', '},', true);
ok('S1b recordKmFor itself carries NO engine fallback (its keyed contract is unchanged)',
  rkSlice.indexOf('currentKm') === -1, rkSlice);
ok('S2 version.json webVersion is 389 and index.html pins js/app.js?v=389',
  ver.webVersion === 389 && idxSrc.indexOf('js/app.js?v=389') !== -1,
  'webVersion=' + ver.webVersion);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
