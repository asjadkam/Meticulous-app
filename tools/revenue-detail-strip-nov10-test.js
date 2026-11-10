#!/usr/bin/env node
'use strict';
/* REVENUE-DETAIL-STRIP-NOV10 — owner ruling, Nov 10, 2026, 11:27
 * CST, on the Revenue day detail (the page a revenue entry's tap
 * opens): "That is exactly the job [of] the Manifest. So yeah
 * delete that from here. I don't want that over here. That's
 * extra information."
 *
 * The Revenue day detail shows REVENUE items only: the day's
 * totals, its money entries, the "Also recorded — not counted"
 * revenue records (with their Edit/Delete) and its extras. The
 * Fuel section, the tracker Sessions section and the Dispatches
 * section come OFF this page. The whole-day picture is the
 * MANIFEST's job — its own day view keeps every section,
 * untouched, and this suite pins that too.
 *
 * Runs the REAL modules/revenue.js + modules/manifest.js on the
 * audit suite's fake-DOM harness, over the field day's shape
 * (Nov 9, 2026: a $362.50 dispatch-priced day + the $695.98
 * "Auto from tracker" record in Also recorded + a session with
 * a ticket photo + a fuel fill + a dispatch with a ticket).
 * Run: node tools/revenue-detail-strip-nov10-test.js */
process.env.TZ = 'America/Edmonton';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function section(name, fn) {
  console.log('\n— ' + name + ' —');
  try { fn(); } catch (e) { fail++; console.log('  FAIL section threw: ' + (e && e.stack || e)); }
}

/* ---------- fake DOM (audit-suite harness, data-attr generalized) ---------- */
const CTX = new Proxy({}, {
  get: function (t, p) {
    if (p === 'measureText') return function () { return { width: 8 }; };
    if (p === 'canvas') return {};
    if (p === 'createLinearGradient') return function () { return { addColorStop: function () {} }; };
    return function () {};
  },
  set: function () { return true; }
});
function fakeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(), children: [], style: {}, dataset: {},
    value: '', files: [], textContent: '', className: '', id: '',
    width: 300, height: 150, offsetWidth: 300,
    _html: '', _els: {}, onclick: null, onchange: null,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    set innerHTML(v) { this._html = String(v); this._els = {}; },
    get innerHTML() { return this._html; },
    querySelector(sel) {
      if (!this._els[sel]) this._els[sel] = fakeEl(sel === 'canvas' || /canvas/i.test(sel) ? 'canvas' : 'div');
      return this._els[sel];
    },
    querySelectorAll(sel) {
      if (!this._qsa) this._qsa = {};
      if (this._qsa[sel] && this._qsa[sel].html === this._html) return this._qsa[sel].els;
      const out = [];
      const am = /^\[([a-z0-9-]+)\]$/i.exec(sel);
      if (am) {
        const re = new RegExp(am[1] + '="([^"]+)"', 'g');
        let m; const html = this._html;
        while ((m = re.exec(html))) { const v = m[1]; const d = fakeEl('div'); d.getAttribute = () => v; out.push(d); }
      }
      this._qsa[sel] = { html: this._html, els: out };
      return out;
    },
    addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    appendChild() {}, click() { if (this.onclick) this.onclick({ target: this }); },
    focus() {}, scrollIntoView() {},
    getContext() { return CTX; },
    getBoundingClientRect() { return { width: 300, height: 150, left: 0, top: 0, right: 300, bottom: 150 }; },
    closest() { return null; }
  };
  return el;
}
function makeStore(seed) {
  const data = JSON.parse(JSON.stringify(seed || {}));
  return {
    _data: data,
    get(k, d) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : d; },
    set(k, v) { data[k] = JSON.parse(JSON.stringify(v)); },
    del(k) { delete data[k]; }
  };
}
function baseApp(store, role) {
  return {
    _store: store,
    _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); },
    _today() { return '2026-11-10'; },
    userRole() { return role || 'driver'; },
    fmtKm(n) { return Number(n).toLocaleString('en-CA'); },
    fmtDate(d) { return d; },
    _photoDl(src, name) { return '<a data-dl="' + name + '"></a>'; },
    _odoDailyKm(s) {
      const a = parseFloat(s && s.startOdo), b = parseFloat(s && s.endOdo);
      return (isFinite(a) && isFinite(b) && b >= a) ? (b - a) : null;
    },
    tracker: null
  };
}
function loadModule(file, App, extra) {
  const sb = Object.assign({
    App, Meticulous: { modules: {}, shared: {} }, window: null, console,
    document: { createElement: (t) => fakeEl(t), querySelector: () => null, addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'node' }, alert() {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    setTimeout, clearTimeout
  }, extra || {});
  sb.window = sb;
  new Function('window', 'App', 'Meticulous', 'document', 'localStorage', 'sessionStorage', 'navigator', 'alert', 'URL', 'setTimeout', 'clearTimeout', 'console',
    read(file))(sb, sb.App, sb.Meticulous, sb.document, sb.localStorage, sb.sessionStorage, sb.navigator, sb.alert, sb.URL, setTimeout, clearTimeout, console);
  return sb;
}
function loadShared(App) {
  const sb = { App, Meticulous: { modules: {}, shared: {} }, window: null, console };
  sb.window = sb;
  const invSrc = read('modules/invoice.js');
  const a = invSrc.lastIndexOf('/*', invSrc.indexOf('INV-CYCLE-BEGIN'));
  const b = invSrc.indexOf('*/', invSrc.indexOf('INV-CYCLE-END'));
  new Function('window', 'App', 'Meticulous', 'console', invSrc.slice(a, b + 2))(sb, sb.App, sb.Meticulous, console);
  return sb.Meticulous;
}

/* ---------- the field day: Nov 9, 2026 ---------- */
const DAY = '2026-11-09';
function daySeed() {
  return {
    onboarding: { payStandard: 'Hourly', payRate: 29, name: 'T', truck: '07', company: 'C', payCycle: 'biweekly', firstName: 'A', lastName: 'K' },
    rev_entries: [
      { date: DAY, type: 'hourly', hours: 12.5, amount: 362.50, note: 'Dispatch: Aecon Trans (Graham) · foreman 11.5h + travel 1h = 12.5h (Card #10525: 11.5h)' },
      { date: DAY, type: 'hourly', hours: 24, amount: 695.98, note: 'Auto from tracker', auto: true }
    ],
    rev_extras: [
      { date: DAY, type: 'bonus', amount: 25, note: 'Safety bonus' }
    ],
    sessions: [
      { date: DAY, seconds: 41400, endedAt: '2026-11-10T03:00:00.000Z', startOdo: 171870, endOdo: 172236, liveKm: 366.1, milesStatus: 'confirmed', ticketPhoto: 'data:image/jpeg;base64,SESPHOTO' }
    ],
    fuel_fills: [
      { date: DAY, litres: 65.907, cost: 142.29, station: 'Mobil Westwinds', odo: 172228 }
    ],
    dsp_list: [
      { date: DAY, jobSite: 'Aecon Trans', status: 'completed', ticketNo: '10525', tickets: [{ no: '10525', photo: 'data:image/jpeg;base64,DSPHOTO' }] }
    ],
    mani_date: DAY, mani_mode: 'day', mani_toggles: {}
  };
}

/* ---------- Revenue: the stripped day detail ---------- */
section('Revenue day detail — revenue items only', function () {
  const store = makeStore(daySeed());
  const App = baseApp(store, 'driver');
  const shared = loadShared(App);
  const sb = loadModule('modules/revenue.js', App, { Meticulous: shared });
  const M = sb.Meticulous.modules.revenue, body = fakeEl('div');
  M.render(body);
  const rows = body.querySelectorAll('[data-day-link]');
  const row = rows.filter(function (r) { return r.getAttribute('data-day-link') === DAY; })[0];
  ok('the face lists the day row', !!row, 'rows=' + rows.length);
  row.onclick({ target: null });
  const h = body.innerHTML;
  ok('the day detail is on screen (date header + totals)', h.includes('🗓') && h.includes('$362.50'));
  ok('the money entry renders with its Delete', h.includes('Card #10525') && body.querySelectorAll('[data-rvdel]').length >= 1);
  ok('the Also recorded card still renders (revenue records stay)', h.includes('Also recorded'));
  const tgl = body.querySelector('#rv_ev_toggle');
  ok('the Also recorded card opens', !!(tgl && tgl.onclick));
  if (tgl && tgl.onclick) tgl.onclick();
  const h2 = body.innerHTML;
  ok('the not-counted record renders inside Also recorded', h2.includes('Auto from tracker'));
  ok('the not-counted record keeps its Delete', body.querySelectorAll('[data-rvdel]').length >= 2,
    'data-rvdel count=' + body.querySelectorAll('[data-rvdel]').length);
  ok('extras still render with their Delete', h2.includes('✨ Extras') && h2.includes('Safety bonus') && body.querySelectorAll('[data-rxdel]').length >= 1);
  /* the strip itself */
  ok('NO Fuel section on the Revenue day detail', !h2.includes('⛽ Fuel') && !h2.includes('Mobil Westwinds'));
  ok('NO tracker Sessions section on the Revenue day detail', !h2.includes('Tracker session') && !h2.includes('Live GPS distance'));
  ok('NO Dispatches section on the Revenue day detail', !h2.includes('🚚 Dispatches'));
  ok('NO ticket photos on the Revenue day detail (they live on the Manifest day)',
    !h2.includes('SESPHOTO') && !h2.includes('DSPHOTO') && !h2.includes('alt="Ticket photo"'));
  /* source pin: the sections are gone from the renderer, not hidden */
  const revSrc = read('modules/revenue.js');
  const rd = revSrc.slice(revSrc.indexOf('function renderDayDetail'), revSrc.indexOf('var lastImport'));
  ok('source: renderDayDetail builds no Fuel/Sessions/Dispatches cards',
    !rd.includes('⛽ Fuel') && !rd.includes('Tracker session') && !rd.includes('🚚 Dispatches') && !rd.includes('data-rsdel'));
});

/* ---------- Manifest: the whole-day picture is untouched ---------- */
section('Manifest day view — all its sections stand', function () {
  const store = makeStore(daySeed());
  const App = baseApp(store, 'driver');
  const sb = loadModule('modules/manifest.js', App);
  const M = sb.Meticulous.modules.manifest, body = fakeEl('div');
  M.render(body);
  const h = body.innerHTML;
  ok('the Manifest day renders its Dispatches section', h.includes('<h3>Dispatches</h3>'), h.slice(0, 200));
  ok('the Manifest day renders its Fuel & expenses section', h.includes('<h3>Fuel & expenses</h3>'));
  ok('the Manifest day still names the fill', h.includes('Mobil Westwinds'));
});

console.log('\nrevenue-detail-strip-nov10: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
