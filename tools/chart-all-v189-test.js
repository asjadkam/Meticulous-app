#!/usr/bin/env node
/* Meticulous v189 — CHART-ALL suite.
 *
 * The owner's order, Oct 21, 2026 07:21 MDT (his Revenue
 * screenshot): with the Oct 16–31 period selected, the Daily
 * earnings card drew only the ~6 days up to today. The card
 * must show EVERY day of the selected period — all 16 — future
 * days included as empty bars. The v164 future-tail pop is
 * reversed. The default mark / preview readout, though, stays
 * on the latest day that is today or earlier (chartMarkDate):
 * the future is drawn, never opened on.
 *
 * Run: node tools/chart-all-v189-test.js
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
function memStore(seed) {
  const data = JSON.parse(JSON.stringify(seed || {}));
  return {
    _data: data,
    get: function (k, d) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : d; },
    set: function (k, v) { data[k] = v; return true; },
    del: function (k) { delete data[k]; }
  };
}
function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i === -1) return null;
  let depth = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  return null;
}
function dstr(daysFromToday) {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth(), n.getDate() + daysFromToday, 12);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function range(a, b) { const o = []; for (let i = a; i <= b; i++) o.push(dstr(i)); return o; }

const revSrc = read('modules/revenue.js');

function makeWorld(seed) {
  const store = memStore(seed);
  const sb = {
    window: {}, console: console,
    App: { _store: store, _esc: function (s) { return String(s == null ? '' : s); }, _today: function () { return dstr(0); } }
  };
  sb.window = sb;
  vm.createContext(sb);
  const start = revSrc.indexOf('var S = function');
  const end = revSrc.lastIndexOf('/*', revSrc.indexOf('v38 (B2): paste-import'));
  vm.runInContext(revSrc.slice(start, end), sb);
  vm.runInContext(extractFn(revSrc, 'chartDates'), sb);
  vm.runInContext(extractFn(revSrc, 'chartMarkDate'), sb);
  return sb;
}

console.log('— v189 CHART-ALL: the whole selected period is on the card —');
{
  /* His exact shape: a 16-day custom period, 5 days in, 10 ahead. */
  const w = makeWorld({ rev_period: 'custom', rev_customA: dstr(-5), rev_customB: dstr(10) });
  const ds = w.chartDates();
  eq('custom 16-day period: ALL 16 days drawn', ds, range(-5, 10));
  eq('the last bar is the period END, not today', ds[ds.length - 1], dstr(10));
  eq('the first bar is the period start', ds[0], dstr(-5));
}
{
  const w = makeWorld({ rev_period: 'custom', rev_customA: dstr(-20), rev_customB: dstr(-10) });
  eq('a past custom period still draws exactly its days', w.chartDates(), range(-20, -10));
}
{
  const w = makeWorld({ rev_period: '30' });
  const ds = w.chartDates();
  ok('preset window unchanged: ends today', ds[ds.length - 1] === dstr(0), ds[ds.length - 1]);
  ok('preset window unchanged: 30 or 31 days', ds.length === 30 || ds.length === 31, 'len ' + ds.length);
}
console.log('— v189: the mark never opens on a future day —');
{
  const w = makeWorld({});
  eq('mark with future tail = today', w.chartMarkDate(range(-5, 10)), dstr(0));
  eq('mark all-past = the last day', w.chartMarkDate(range(-20, -10)), dstr(-10));
  eq('mark all-future = the period\u2019s first day', w.chartMarkDate(range(3, 9)), dstr(3));
  eq('mark of an empty list = null', w.chartMarkDate([]), null);
  eq('mark of null = null', w.chartMarkDate(null), null);
}
console.log('— v189: source pins —');
ok('the future-tail pop is gone from chartDates',
  revSrc.indexOf('out[out.length - 1] > todayS) out.pop()') === -1);
ok('drawChart marks via chartMarkDate',
  revSrc.indexOf('chartMarkDate(dates)') !== -1);
ok('the preview default reads via chartMarkDate',
  revSrc.indexOf('chartMarkDate(cv._dayDates)') !== -1);

console.log('\nchart-all-v189: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
