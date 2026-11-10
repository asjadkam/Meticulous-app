#!/usr/bin/env node
/* TILE-GHOST-STATUS-NOV10 — the dashboard Revenue tile read
 * "Last entry: $695.98 · yesterday" on the owner's phone at
 * Nov 10, 11:12, while the Revenue module's own Entries list
 * (Custom Nov 1–15) topped at $362.50 (Nov 9, Card #10525)
 * and $304.50 (Nov 7) — the $695.98 nowhere in it.
 *
 * THE CONVICTION (code-read, proven below): the two Nov 10
 * deletions lived under "Also recorded — not counted" on each
 * day view. entryMoneyFlags() (the v116 ladder) prices ONE
 * source per day; a record outside the priced source is NOT
 * money, never renders in the flat Entries list, and lives
 * only in the day detail. But modules/revenue.js status() —
 * the tile's text — iterated the RAW entries() list (latest
 * date wins, tie → last appended) with no money-flag
 * filtering, so the tile faithfully reported a record the
 * module itself hides: the tile and the module disagreed by
 * construction (the owner's TILE-HEAL expectation is that
 * they agree).
 *
 * THE FIX: status() computes "Last entry" over the SAME
 * money set the Entries list renders (entryMoneyFlags); when
 * the builder is unavailable the flags fall back to
 * all-money, exactly as the list itself falls back.
 *
 * This suite runs the REAL revenue module + the REAL shared
 * builder (invoice.js INV-CYCLE) over the REAL store literal
 * and the REAL modStatus door (the v397 harness idiom), on
 * the Nov 9 day in its stored shapes.
 * Run: node tools/tile-ghost-status-nov10-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
const appSrc = read('js/app.js');
const invSrc = read('modules/invoice.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function eq(name, got, want) { ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }

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
function extractCommentRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('region not found: ' + beginMark);
  return src.slice(a, b + 2);
}
function todayStr(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const TODAY = todayStr();
const YDAY = todayStr(new Date(Date.now() - 86400000));
const Y3 = todayStr(new Date(Date.now() - 2 * 86400000));

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
    Meticulous: { modules: {}, shared: {} }
  };
  sb.window = sb;
  sb.App = {
    _today: function () { return TODAY; },
    _esc: function (s) { return String(s == null ? '' : s); },
    userRole: function () { return 'both'; },
    tracker: null
  };
  vm.createContext(sb);
  sb.__store = vm.runInContext(extractStore(appSrc) + '\nstore;', sb);
  sb.App._store = sb.__store;
  sb.modStatus = vm.runInContext(sliceFn(appSrc, 'function modStatus(key)') + '\nmodStatus;', sb);
  /* the REAL shared builder (invoice.js INV-CYCLE region) */
  vm.runInContext(extractCommentRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(read('modules/revenue.js'), sb);
  return sb;
}

console.log('— TILE-GHOST-STATUS-NOV10 —');
/* The Nov 9 day in stored shapes: the priced completion entry
   (Card #10525: foreman 11.5h + travel 1h = 12.5h × $29 =
   $362.50, dsp-born), the tracker auto entry appended after
   it (24h × $29 = $695.98, "Auto from tracker" — the day's
   NOT-counted record), and the Nov 7 money entry below them. */
{
  const sb = makeWorld();
  const ls = sb.localStorage;
  ls.setItem('mt_onboarding', JSON.stringify({ payStandard: 'hourly', payRate: 29, accountType: 'Driver' }));
  ls.setItem('mt_rev_entries', JSON.stringify([
    { dspId: 'dsp-nov7', date: Y3, type: 'hourly', hours: 10.5, amount: 304.50, note: 'Dispatch: Aecon Trans · foreman 9.5h + travel 1h = 10.5h' },
    { dspId: 'dsp-nov9', date: YDAY, type: 'hourly', hours: 12.5, amount: 362.50, note: 'Dispatch: Aecon Trans · foreman 11.5h + travel 1h = 12.5h' },
    { date: YDAY, type: 'hourly', hours: 24, amount: 695.98, auto: true, note: 'Auto from tracker' }
  ]));
  ls.setItem('mt_rev_extras', JSON.stringify([]));
  eq('the tile names the same last entry the module lists ($362.50, not the not-counted $695.98)',
     sb.modStatus('revenue'), 'Last entry: $362.50 · yesterday');
  /* the module's own flat list — the agreement the owner asked for */
  const rev = sb.Meticulous.modules.revenue;
  ok('the module object is loaded', !!(rev && typeof rev.status === 'function'));
  eq('module status() agrees with the tile door', rev.status(), 'Last entry: $362.50 · yesterday');
}
/* Control: a day whose priced source IS the tracker entry —
   the tile must still name it (the filter is the money set,
   not an anti-tracker rule). */
{
  const sb = makeWorld();
  const ls = sb.localStorage;
  ls.setItem('mt_onboarding', JSON.stringify({ payStandard: 'hourly', payRate: 29, accountType: 'Driver' }));
  ls.setItem('mt_rev_entries', JSON.stringify([
    { date: YDAY, type: 'hourly', hours: 9.75, amount: 282.75, auto: true, note: 'Auto from tracker' }
  ]));
  ls.setItem('mt_rev_extras', JSON.stringify([]));
  eq('a tracker entry that IS the day\'s priced source still names the tile',
     sb.modStatus('revenue'), 'Last entry: $282.75 · yesterday');
}
/* Control: no records at all */
{
  const sb = makeWorld();
  sb.localStorage.setItem('mt_onboarding', JSON.stringify({ payStandard: 'hourly', payRate: 29, accountType: 'Driver' }));
  sb.localStorage.setItem('mt_rev_entries', JSON.stringify([]));
  sb.localStorage.setItem('mt_rev_extras', JSON.stringify([]));
  eq('an empty book still reads as before', sb.modStatus('revenue'), 'No entries yet');
}

console.log('\n' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
