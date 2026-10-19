#!/usr/bin/env node
/* Meticulous v164 — ENTRIES LATEST-3 + CHART DATE TRUTH suite.
 *
 * The owner's orders, Oct 18, 2026:
 *  - 20:54 MDT: the Entries list scrolls endlessly — show the
 *    latest 3, the rest behind a Show-more tap.
 *  - 20:36 MDT (a REPEAT of Oct 17): "These dates are still not
 *    fixed!" — the daily earnings chart's bars named the wrong
 *    days. End to end, the chart's dates now come from ONE
 *    source: the selected period's own dates (inPeriod — the
 *    totals' rule), stepped by CALENDAR days. The old build
 *    (a) stepped by raw 86400000-ms chunks off "now" and
 *    (b) always drew "the last N days ending today", so with
 *    his Oct 16–31 period selected it drew Oct 3→18 — bars for
 *    days his period never covered, and period days with no
 *    bars.
 *
 * Run: node tools/queue-v164-test.js
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
function extractRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('region not found: ' + beginMark);
  return src.slice(a, b + 2);
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

const invSrc = read('modules/invoice.js');
const revSrc = read('modules/revenue.js');

/* ---- chartDates world: the module's own helpers, verbatim ---- */
function makeDatesWorld(seed) {
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
  return { sb: sb, store: store, chartDates: sb.chartDates, inPeriod: sb.inPeriod };
}

{
  const w = makeDatesWorld({ rev_period: '30' });
  const ds = w.chartDates();
  ok('A1 preset window ends today', ds[ds.length - 1] === dstr(0), ds[ds.length - 1]);
  ok('A1 preset window covers the totals\u2019 days (30 or 31 dates)', ds.length === 30 || ds.length === 31, 'len ' + ds.length);
  let consec = true, allIn = true;
  for (let i = 0; i < ds.length; i++) {
    if (!w.inPeriod(ds[i])) allIn = false;
    if (i > 0) {
      const diff = (new Date(ds[i] + 'T12:00:00') - new Date(ds[i - 1] + 'T12:00:00')) / 86400000;
      if (diff !== 1) consec = false;
    }
  }
  ok('A1 every bar date is inside the period the totals use', allIn);
  ok('A1 dates are consecutive CALENDAR days (no drift, no duplicates)', consec);
}
{
  const w = makeDatesWorld({ rev_period: 'custom', rev_customA: dstr(-3), rev_customB: dstr(5) });
  eq('A2 custom period: bars are the period\u2019s own days, future tail dropped',
    w.chartDates(), [dstr(-3), dstr(-2), dstr(-1), dstr(0)]);
}
{
  const w = makeDatesWorld({ rev_period: 'custom', rev_customA: dstr(-20), rev_customB: dstr(-10) });
  const ds = w.chartDates();
  eq('A3 a past custom period draws ITS days (not the last N ending today)',
    [ds.length, ds[0], ds[ds.length - 1]], [11, dstr(-20), dstr(-10)]);
}
ok('A4 the raw-millisecond date stepping is gone from the chart',
  revSrc.indexOf('getTime() - i * 86400000') === -1);

/* ---- the Entries list: latest 3, rest behind Show more ---- */
function FakeEl(sel) {
  this._sel = sel || ''; this._kids = {}; this._html = '';
  this.value = ''; this.textContent = ''; this.style = {}; this.files = [];
  this.onclick = null; this.onchange = null; this.oninput = null;
  this._listeners = {}; this.options = [{ text: '' }]; this.selectedIndex = 0;
  this.offsetWidth = 600; this.width = 0; this.height = 0;
  this.classList = { add: function () {}, remove: function () {}, toggle: function () {} };
}
Object.defineProperty(FakeEl.prototype, 'innerHTML', {
  get: function () { return this._html; },
  set: function (v) { this._html = String(v); this._kids = {}; }
});
FakeEl.prototype.querySelector = function (sel) {
  return this._kids[sel] || (this._kids[sel] = new FakeEl(sel));
};
FakeEl.prototype.querySelectorAll = function () { return []; };
FakeEl.prototype.addEventListener = function (type, fn) {
  (this._listeners[type] = this._listeners[type] || []).push(fn);
};
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };
FakeEl.prototype.getContext = function () {
  return { clearRect: function () {}, fillRect: function () {}, fillText: function () {}, fillStyle: '', font: '' };
};
FakeEl.prototype.getBoundingClientRect = function () { return { width: 600, left: 0 }; };

function makeRenderWorld() {
  const ents = [];
  for (let i = 0; i < 5; i++) {
    ents.push({ date: dstr(-i), type: 'hourly', hours: 10, amount: '290.00', note: 'Manual work ' + i });
  }
  const store = memStore({
    onboarding: { payStandard: 'hourly', ownWageRate: 29 },
    rev_entries: ents, rev_extras: [], rev_period: '30',
    sessions: [], fuel_fills: [], dsp_list: []
  });
  const sb = {
    window: {}, Meticulous: { modules: {}, shared: {} }, console: console,
    App: {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s); },
      _today: function () { return dstr(0); },
      _odoDailyKm: function () { return null; },
      tracker: null,
      userRole: function () { return 'driver'; }
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  sb.Meticulous.shared = sb.window.Meticulous.shared;
  sb.Meticulous.modules.autostart = {
    settingsHTML: function () { return ''; },
    saveFrom: function () {}, wireToday: function () {}
  };
  vm.runInContext(read('modules/revenue.js'), sb);
  return { sb: sb, store: store, rev: sb.Meticulous.modules.revenue };
}

function entriesCard(html) {
  const a = html.indexOf('📒 Entries');
  const b = html.indexOf('rv_export');
  return a === -1 ? '' : html.slice(a, b === -1 ? undefined : b);
}
{
  const w = makeRenderWorld();
  const body = new FakeEl('body');
  w.rev.render(body);
  const card = entriesCard(body._html);
  const rows = (card.match(/data-rvdel=/g) || []).length;
  eq('B1 the list opens with the latest 3 entries only', rows, 3);
  ok('B1 the rest wait behind Show more', card.indexOf('Show more') !== -1 && card.indexOf('2 more entries') !== -1);
  ok('B1 the newest day leads', card.indexOf('Manual work 0') !== -1 && card.indexOf('Manual work 4') === -1);
  const moreBtn = body._kids['#rv_more'];
  ok('B1 the Show more button is wired', !!moreBtn && typeof moreBtn.onclick === 'function');
  moreBtn.onclick();
  const card2 = entriesCard(body._html);
  eq('B2 after the tap, all 5 entries show', (card2.match(/data-rvdel=/g) || []).length, 5);
  ok('B2 and it folds back with Show less', card2.indexOf('Show less') !== -1);
  const lessBtn = body._kids['#rv_more'];
  lessBtn.onclick();
  eq('B3 Show less returns to 3', (entriesCard(body._html).match(/data-rvdel=/g) || []).length, 3);
}

console.log('\nqueue-v164 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
