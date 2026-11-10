#!/usr/bin/env node
/* Meticulous v397 — DASHBOARD-TILE-STALE-NOV10 tests.
 *
 * Owner (Nov 10, 2026, 09:10 MDT, his dashboard screenshot):
 * "First of all, why does it say no documents? ... and second
 * of all why are my fuel receipts not uploaded pictures to my
 * records?" The screenshot's tiles: Revenue "Last entry:
 * $695.98 · yesterday" — hours after that entry was deleted
 * through the front door (the Revenue list itself tops at
 * $362.50, verified in the cloud book); Documents "No
 * documents yet" — while the vault held the 2 CVSA pages
 * filed Nov 9. The BOOK was correct everywhere; the tiles lied.
 *
 * THE MECHANISM (convicted in js/app.js + js/cloudsync.js):
 * a module card's subtext is computed live exactly ONCE,
 * inside buildDashboard (modStatus -> module.status() ->
 * App._store, a fresh localStorage read — no cache anywhere
 * in the read path), and buildDashboard runs only on auth,
 * on showDashboard (navigating home) and on pull-to-refresh.
 * Nothing in the standing paint cadence ever touches
 * #modGrid again: trackerTick (the 1 s interval + the
 * heroPaint visibility kick) paints the hero, the bubble
 * and the live-miles line only, and CloudSync's after-pull
 * signal (S.onAfterPull) diffs only the telemetry keys
 * (livemiles / geoloads / tracker) for engine adoption.
 * A change that lands WITHOUT a navigation — a cloud pull
 * carrying another session's edit (the Revenue deletion,
 * the Documents filings), a write from a second page
 * lifetime sharing the store — therefore leaves the grid
 * showing the subtexts of its last paint, while every
 * module, rendering fresh when opened, reads the current
 * book. In-session changes (his PTI filed on the phone,
 * his fuel saved on the phone) were masked by the
 * navigation repaint — the two proven tiles are precisely
 * the two whose latest changes arrived remotely.
 *
 * THE FIX (v397): TILE-HEAL in js/app.js, the codebase's
 * own signature-gated repaint pattern (the hero's _heroSig
 * discipline) driven from the same tick: tileHeal re-reads
 * each painted card's live subtext through the SAME
 * modStatus door buildDashboard uses and rewrites only
 * the .s nodes whose text actually changed. The card set,
 * order, tier gates and handlers stay buildDashboard's;
 * the heal owns only the subtext surface, for EVERY card.
 * Throttled to 15 s inside the tick; gated to the visible
 * dashboard; inert while auth-locked.
 *
 * This suite runs the REAL store literal, the REAL
 * modStatus and the REAL TILE-HEAL region sliced out of
 * js/app.js over the REAL revenue / documents / fuel
 * modules, on a fake DOM grid painted with buildDashboard's
 * own formula. Failing-first on the shipped web-396 bytes:
 * the TILE-HEAL region does not exist there, so every heal
 * assertion fails while the paint assertions (which encode
 * the pre-fix truth — the statuses were always live) pass.
 *
 * Run: node tools/dashboard-tile-stale-v397-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
const appSrc = read('js/app.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function has(name, hay, needle) { ok(name, String(hay).indexOf(needle) >= 0, 'missing: ' + needle.slice(0, 60)); }
function sliceFn(src, marker) {
  const i = src.indexOf(marker);
  if (i === -1) return '';
  let depth = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(i, j);
}
function extractStore(src) {
  const i = src.indexOf('var store = {');
  if (i === -1) throw new Error('store not found in js/app.js');
  let depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(i, j);
}
function extractRegion(src, beginMark, endMark) {
  if (src.indexOf(beginMark) === -1 || src.indexOf(endMark) === -1) return '';
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) return '';
  return src.slice(a, b + 2);
}
function todayStr(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const TODAY = todayStr();

/* ---------------- the world ---------------- */
function makeWorld() {
  const lsData = {};
  const localStorage = {
    getItem: function (k) { return (k in lsData) ? lsData[k] : null; },
    setItem: function (k, v) { lsData[k] = String(v); },
    removeItem: function (k) { delete lsData[k]; }
  };
  const sb = {
    console: console, Math: Math, Date: Date, JSON: JSON,
    setTimeout: setTimeout, localStorage: localStorage,
    Meticulous: { modules: {} }
  };
  sb.window = sb;
  sb.App = {
    _today: function () { return TODAY; },
    _esc: function (s) { return String(s == null ? '' : s); },
    userRole: function () { return 'both'; },
    tracker: null
  };
  vm.createContext(sb);
  /* the REAL store literal out of js/app.js */
  sb.__store = vm.runInContext(extractStore(appSrc) + '\nstore;', sb);
  sb.App._store = sb.__store;
  /* the REAL modStatus door */
  sb.modStatus = vm.runInContext(sliceFn(appSrc, 'function modStatus(key)') + '\nmodStatus;', sb);
  /* fake DOM: the dashboard grid, painted below with
     buildDashboard's own formula */
  const dashClasses = new Set(['hidden']);
  const grid = { _cards: [], innerHTML: '',
    querySelectorAll: function (sel) { return sel === '.modcard' ? grid._cards : []; } };
  const dashView = { classList: {
    contains: function (c) { return dashClasses.has(c); },
    add: function (c) { dashClasses.add(c); },
    remove: function (c) { dashClasses.delete(c); },
    toggle: function (c, on) { if (on) dashClasses.add(c); else dashClasses.delete(c); }
  } };
  sb.__grid = grid; sb.__dashView = dashView; sb.__dashClasses = dashClasses;
  sb.el = function (id) {
    if (id === 'modGrid') return grid;
    if (id === 'dashView') return dashView;
    return null;
  };
  /* the REAL modules over the real store */
  ['modules/revenue.js', 'modules/documents.js', 'modules/fuel.js'].forEach(function (f) {
    vm.runInContext(read(f), sb);
  });
  /* the TILE-HEAL region (absent on the shipped 396 bytes) */
  const region = extractRegion(appSrc, 'TILE-HEAL-BEGIN', 'TILE-HEAL-END');
  sb.__region = region;
  if (region) { try { vm.runInContext(region, sb); } catch (e) { sb.__regionErr = e; } }
  return sb;
}
function paintGrid(sb, keys) {
  /* buildDashboard's paint, verbatim in substance:
     '<div class="s">' + esc(modStatus(key)) + '</div>' per card */
  sb.__grid._cards = keys.map(function (key) {
    const sEl = { textContent: sb.modStatus(key) };
    return {
      _key: key, _s: sEl,
      getAttribute: function (a) { return a === 'data-mod' ? key : null; },
      querySelector: function (sel) { return sel === '.s' ? sEl : null; }
    };
  });
}
function tileText(sb, key) {
  const c = sb.__grid._cards.filter(function (x) { return x._key === key; })[0];
  return c ? c._s.textContent : null;
}
function seedBook(sb) {
  const ls = sb.localStorage;
  ls.setItem('mt_onboarding', JSON.stringify({ payStandard: 'hourly', payRate: 29, accountType: 'Driver' }));
  /* Revenue: the $362.50 close-out entry, then the $695.98
     auto entry appended after it (same date — the tie goes
     to the entry appended last, so it is the "last entry"). */
  ls.setItem('mt_rev_entries', JSON.stringify([
    { date: TODAY, hours: 12.5, amount: 362.50 },
    { date: TODAY, hours: 24, amount: 695.98 }
  ]));
  ls.setItem('mt_rev_extras', JSON.stringify([]));
  ls.setItem('mt_docs_items', JSON.stringify([]));
  ls.setItem('mt_fuel_fills', JSON.stringify([
    { date: TODAY, litres: 65.907, cost: 142.29, station: 'Westwinds', odo: 172228 }
  ]));
}

/* ================= the lifecycle ================= */
console.log('— DASHBOARD-TILE-STALE-NOV10: paint, remote change, heal —');
const sb = makeWorld();
seedBook(sb);
sb.__dashClasses.delete('hidden'); // dashboard on screen
paintGrid(sb, ['revenue', 'documents', 'fuel']);

eq('paint: revenue tile shows the $695.98 last entry', tileText(sb, 'revenue'), 'Last entry: $695.98 · today');
eq('paint: documents tile shows the empty vault', tileText(sb, 'documents'), 'No documents yet');
eq('paint: fuel tile shows the last fill', tileText(sb, 'fuel'), 'Last fill: 65.9 L · $142.29 · today');
ok('the statuses themselves were always live (modStatus reads the book)',
  sb.modStatus('revenue') === 'Last entry: $695.98 · today');

/* The changes land the way the app writes them — the same
   store.set calls the modules' own save/delete paths make
   (revenue W('entries'), documents saveItemsVerified's
   W('items'), fuel W('fills')) — with NO navigation home:
   this is a pull landing another session's edits while the
   dashboard sits open. */
sb.__store.set('rev_entries', [{ date: TODAY, hours: 12.5, amount: 362.50 }]);
sb.__store.set('docs_items', [
  { id: 'docCvsaP1', label: 'CVIP / Safety', name: 'CVSA AB318427EI p1', addedAt: 1 },
  { id: 'docCvsaP2', label: 'CVIP / Safety', name: 'CVSA AB318427EI p2', addedAt: 2 }
]);
sb.__store.set('fuel_fills', [
  { date: TODAY, litres: 65.907, cost: 142.29, station: 'Westwinds', odo: 172228 },
  { date: TODAY, litres: 80.290, cost: 172.54, station: 'Country Village', odo: 172308 }
]);

eq('the book itself is already right (module-truth)', sb.modStatus('revenue'), 'Last entry: $362.50 · today');
eq('pre-heal: the painted revenue tile still lies', tileText(sb, 'revenue'), 'Last entry: $695.98 · today');
eq('pre-heal: the painted documents tile still lies', tileText(sb, 'documents'), 'No documents yet');

/* the heal — the tick's own driver, forced past its throttle */
ok('TILE-HEAL region present in js/app.js', !!sb.__region && !sb.__regionErr,
  sb.__regionErr ? String(sb.__regionErr) : 'region absent');
ok('App._tileHeal exported', !!(sb.App && typeof sb.App._tileHeal === 'function'));
if (typeof sb.App._tileHeal === 'function') {
  eq('heal reports it changed the grid', sb.App._tileHeal(true), true);
  eq('post-heal: revenue tile follows the book', tileText(sb, 'revenue'), 'Last entry: $362.50 · today');
  eq('post-heal: documents tile follows the book', tileText(sb, 'documents'), '2 documents');
  eq('post-heal: fuel tile follows the book', tileText(sb, 'fuel'), 'Last fill: 80.3 L · $172.54 · today');
  eq('second heal is a no-op (change-gated, no churn)', sb.App._tileHeal(true), false);
  eq('throttled heal inside 15 s does not run', sb.App._tileHeal(false), false);
  /* hidden dashboard: the heal stands down */
  sb.__store.set('docs_items', []);
  sb.__dashClasses.add('hidden');
  eq('heal stands down while the dashboard is hidden', sb.App._tileHeal(true), false);
  eq('hidden: tile untouched', tileText(sb, 'documents'), '2 documents');
  sb.__dashClasses.delete('hidden');
  eq('back on screen, the heal lands the change', sb.App._tileHeal(true), true);
  eq('documents tile back to the empty truth', tileText(sb, 'documents'), 'No documents yet');
}

/* ================= source pins ================= */
console.log('— wiring pins —');
has('TILE-HEAL-BEGIN marker in js/app.js', appSrc, 'TILE-HEAL-BEGIN');
has('TILE-HEAL-END marker in js/app.js', appSrc, 'TILE-HEAL-END');
{
  const tick = sliceFn(appSrc, 'function trackerTick() {');
  has('trackerTick drives tileHeal', tick, 'tileHeal()');
  has('buildDashboard still paints via the one modStatus door', appSrc, "esc(modStatus(key))");
}
eq('index.html pins js/app.js to v397', idxSrc.indexOf('js/app.js?v=397') !== -1, true);
eq('version.json webVersion is 397', ver.webVersion, 397);

console.log('\n' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
