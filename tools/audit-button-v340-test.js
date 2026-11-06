'use strict';
/* v340 — AUDIT-BUTTON-EVERY-MODULE (owner Nov 5, 2026 17:16 MST):
   every module holding dated records gets an Audit button at
   the TOP; tapping it opens that module's COMPLETE record
   history in date order. This suite drives every covered
   module with a fake DOM: the button renders first, the audit
   view lists ALL records (uncapped — the faces cap at 3), a
   tap opens the module's own detail where one exists, PTI's
   audit reuses Inspection Mode's Send-PDF door, and Back
   returns to the face. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const idx = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function section(name, fn) {
  console.log('\n— ' + name + ' —');
  try { fn(); } catch (e) { fail++; console.log('  FAIL section threw: ' + (e && e.message)); }
}

/* ---------- registry / pins ---------- */
console.log('— registry —');
ok('web version is 347', ver.webVersion === 352, 'got ' + ver.webVersion);
execSyncTags();
function execSyncTags() {
  ['damage', 'revenue', 'invoice', 'documents'].forEach(function (m) {
    ok('index.html loads ' + m + '.js?v=340', idx.includes('modules/' + m + '.js?v=340'));
  });
  /* v344 (MULTI-DAY-MANIFEST-COLUMNS): manifest.js re-pinned at 344. */
  ok('index.html loads manifest.js?v=345', idx.includes('modules/manifest.js?v=345'));
  /* v347: fuel.js re-pinned at 347 (audit's own list includes it). */
  ok('index.html loads fuel.js?v=351', idx.includes('modules/fuel.js?v=351'));
  /* v341 (INSPECTION-MODE-DAY-BUTTON-LABELS): pti.js re-pinned at 341. */
  ok('index.html loads pti.js?v=341', idx.includes('modules/pti.js?v=341'));
}

/* ---------- fake DOM ---------- */
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
      /* cache per (selector, html): the module wires the els
         it was handed; a test re-querying must get the SAME
         wired els back. */
      if (!this._qsa) this._qsa = {};
      if (this._qsa[sel] && this._qsa[sel].html === this._html) return this._qsa[sel].els;
      const out = [];
      if (sel === '[data-doc-open]' || sel === '[data-insp-open]' || sel === '[data-pti-open]' || sel === '[data-mn-day]' || sel === '[data-fuedit]') {
        const attr = sel.slice(1, -1);
        const re = new RegExp(attr + '="([^"]+)"', 'g');
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
    _today() { return '2026-11-05'; },
    userRole() { return role || 'driver'; },
    fmtKm(n) { return Number(n).toLocaleString('en-CA'); },
    fmtDate(d) { return d; },
    _photoDl: null,
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
  /* Meticulous.shared (buildRevenueLines & friends) is
     published by invoice.js's INV-CYCLE region — the same
     load the revenue suites use. */
  const sb = { App, Meticulous: { modules: {}, shared: {} }, window: null, console };
  sb.window = sb;
  const invSrc = read('modules/invoice.js');
  const a = invSrc.lastIndexOf('/*', invSrc.indexOf('INV-CYCLE-BEGIN'));
  const b = invSrc.indexOf('*/', invSrc.indexOf('INV-CYCLE-END'));
  new Function('window', 'App', 'Meticulous', 'console', invSrc.slice(a, b + 2))(sb, sb.App, sb.Meticulous, console);
  return sb.Meticulous;
}

/* ---------- Documents ---------- */
section('Documents audit', function () {
  const docs = [1, 2, 3, 4].map(function (i) {
    return { id: 'doc' + i, label: 'Insurance', name: 'Policy ' + i, kind: 'image', data: 'data:image/jpeg;base64,D' + i, addedAt: 1761000000000 + i * 86400000 };
  });
  const reps = [0, 1, 2, 3, 4].map(function (i) {
    return { id: 'r' + i, date: '2026-09-1' + i, kind: i % 2 ? 'post' : 'pre', filedAt: new Date(2026, 8, 10 + i, 7, 0).getTime(), odometer: 165000 + i * 100, defects: [], driverSig: 'data:x' };
  });
  const store = makeStore({ docs_items: docs, pti_reports: reps });
  const sb = loadModule('modules/documents.js', baseApp(store, 'driver'));
  const M = sb.Meticulous.modules.documents, body = fakeEl('div');
  M.render(body);
  ok('audit button renders', body.innerHTML.includes('id="docs_audit_btn"'));
  ok('audit button is at the very top', body.innerHTML.indexOf('🔎 Audit') < body.innerHTML.indexOf('Add a document'));
  body.querySelector('#docs_audit_btn').onclick();
  ok('audit view opens', M._viewMode() === 'audit');
  ok('audit lists ALL 4 documents (face showed 3 + Show more)', (body.innerHTML.match(/data-doc-open=/g) || []).length === 4);
  ok('audit lists ALL 5 inspections', (body.innerHTML.match(/data-insp-open=/g) || []).length === 5);
  ok('audit is newest first (Policy 4 above Policy 1)', body.innerHTML.indexOf('Policy 4') < body.innerHTML.indexOf('Policy 1'));
  const rows = body.querySelectorAll('[data-doc-open]');
  rows[0].onclick();
  ok('tap a document in audit opens its detail', M._viewMode() === 'doc');
  ok('Back from the detail returns to the audit', M.back() === true && M._viewMode() === 'audit');
  ok('Back from the audit returns to the face', M.back() === true && M._viewMode() === 'main');
});

/* ---------- Fuel (+ Expenses) ---------- */
section('Fuel audit', function () {
  const fills = [1, 2, 3, 4, 5].map(function (i) {
    return { date: '2026-10-0' + i, litres: String(90 + i), cost: String(200 + i), odo: String(170000 + i), station: 'Stn' + i, photo: 'data:image/jpeg;base64,F' + i };
  });
  const store = makeStore({ fuel_fills: fills, fuel_expenses: [{ what: 'DEF fluid', cost: '20', date: '2026-10-02' }, { what: 'Wipers', cost: '35', date: '2026-10-04' }], onboarding: {}, fuel_price: '' });
  const sb = loadModule('modules/fuel.js', baseApp(store, 'driver'));
  const M = sb.Meticulous.modules.fuel, body = fakeEl('div');
  M.render(body);
  ok('audit button renders on the face', body.innerHTML.includes('id="fu_audit"'));
  ok('audit button sits above the Other-expenses tab', body.innerHTML.indexOf('🔎 Audit') < body.innerHTML.indexOf('Other expenses'));
  body.querySelector('#fu_audit').onclick();
  ok('audit view opens', M._auditView() === true);
  ok('audit lists ALL 5 fill-ups', (body.innerHTML.match(/data-fuedit=/g) || []).length === 5, (body.innerHTML.match(/data-fuedit=/g) || []).length + '');
  ok('audit lists ALL other expenses too', body.innerHTML.includes('DEF fluid') && body.innerHTML.includes('Wipers'));
  ok('audit is newest first (2026-10-05 above 2026-10-01)', body.innerHTML.indexOf('2026-10-05') < body.innerHTML.indexOf('2026-10-01'));
  const rows = body.querySelectorAll('[data-fuedit]');
  rows[0].onclick();
  ok('tap a fill-up in audit opens its details (receipt photo rides)', body.innerHTML.includes('Fill-up details') && body.innerHTML.includes('data:image/jpeg;base64,F'));
  ok('Back from the details returns to the audit', M.back() === true && M._auditView() === true);
  ok('Back from the audit returns to the face', M.back() === true && M._auditView() === false);
});

/* ---------- PTI ---------- */
section('PTI audit', function () {
  const reps = [0, 1, 2, 3, 4].map(function (i) {
    return { id: 'p' + i, date: '2026-10-2' + i, kind: i % 2 ? 'post' : 'pre', filedAt: new Date(2026, 9, 20 + i, 7, 30).getTime(), odometer: 169000 + i * 90, defects: [], driverSig: 'data:x', unit: '07' };
  });
  const store = makeStore({ pti_reports: reps, onboarding: { name: 'Asjad Kamal' } });
  const sb = loadModule('modules/pti.js', baseApp(store, 'driver'));
  const M = sb.Meticulous.modules.pti, body = fakeEl('div');
  M.render(body);
  ok('audit button renders on the form', body.innerHTML.includes('id="pti_audit"'));
  body.querySelector('#pti_audit').onclick();
  ok('audit view opens', M._viewMode() === 'audit');
  ok('audit lists ALL 5 inspections (history card caps at 3)', (body.innerHTML.match(/data-pti-open=/g) || []).length === 5);
  ok('audit reuses the Inspection Mode Send-PDF door', body.innerHTML.includes('id="pti_audit_send"') && body.innerHTML.includes('Send last 14 days + today (PDF)'));
  ok('audit is newest first (Oct 24 above Oct 20)', body.innerHTML.indexOf('2026-10-24') < body.innerHTML.indexOf('2026-10-20'));
  ok('Back returns to the form', M.back() === true && M._viewMode() === 'form');
});

/* ---------- Damage & Incident ---------- */
section('Damage audit', function () {
  const reps = [
    { tab: 'load', date: '2026-10-01', at: 'Oct 1, 2026, 9:00 AM', desc: 'Load damage one', photo: 'data:image/jpeg;base64,A' },
    { tab: 'load', date: '2026-10-03', at: 'Oct 3, 2026, 9:00 AM', desc: 'Load damage two', photo: '' },
    { tab: 'equipment', date: '2026-10-05', at: 'Oct 5, 2026, 9:00 AM', desc: 'Mirror cracked', photo: '' }
  ];
  const store = makeStore({ dmg_reports: reps, dmg_tab: 'load' });
  const sb = loadModule('modules/damage.js', baseApp(store, 'driver'));
  const M = sb.Meticulous.modules.damage, body = fakeEl('div');
  M.render(body);
  ok('audit button renders on the face', body.innerHTML.includes('id="dg_audit"'));
  ok('face shows only the load tab (2 of 3)', body.innerHTML.includes('Load damage one') && !body.innerHTML.includes('Mirror cracked'));
  body.querySelector('#dg_audit').onclick();
  ok('audit view opens', M._auditOn() === true);
  ok('audit lists BOTH kinds together (all 3)', body.innerHTML.includes('Load damage one') && body.innerHTML.includes('Load damage two') && body.innerHTML.includes('Mirror cracked'));
  ok('audit is newest first (Oct 5 above Oct 1)', body.innerHTML.indexOf('Mirror cracked') < body.innerHTML.indexOf('Load damage one'));
  ok('Back returns to the face', M.back() === true && M._auditOn() === false);
});

/* ---------- Revenue ---------- */
section('Revenue audit', function () {
  const entries = [1, 2, 3, 4, 5].map(function (i) {
    return { date: '2026-10-0' + i, type: 'hourly', hours: 10, amount: String(290 + i), note: 'Dispatch day ' + i };
  });
  const extras = [
    { date: '2026-10-02', amount: '50', type: 'bonus', note: 'Wait pay' },
    { date: '2026-10-04', amount: '-25', type: 'deduction', note: 'Fuel card' }
  ];
  const store = makeStore({ rev_entries: entries, rev_extras: extras, onboarding: { payStandard: 'Hourly', payRate: 29 }, sessions: [], fuel_fills: [], dsp_list: [], inv_list: [] });
  const App = baseApp(store, 'driver');
  const shared = loadShared(App);
  const sb = loadModule('modules/revenue.js', App, { Meticulous: shared });
  const M = sb.Meticulous.modules.revenue, body = fakeEl('div');
  M.render(body);
  ok('audit button renders on the face', body.innerHTML.includes('id="rv_audit"'));
  ok('audit button is at the very top (before the Revenue header card)', body.innerHTML.indexOf('🔎 Audit') < body.innerHTML.indexOf('💰 Revenue'));
  body.querySelector('#rv_audit').onclick();
  ok('audit view opens', M._auditView() === true);
  ok('audit lists ALL 5 entries', (body.innerHTML.match(/Dispatch day/g) || []).length === 5);
  ok('audit lists ALL extras with amounts', body.innerHTML.includes('Wait pay') && body.innerHTML.includes('Fuel card'));
  ok('entries newest first (day 5 above day 1)', body.innerHTML.indexOf('Dispatch day 5') < body.innerHTML.indexOf('Dispatch day 1'));
  ok('Back returns to the face', M.back() === true && M._auditView() === false);
});

/* ---------- Invoice ---------- */
section('Invoice audit', function () {
  const invs = [1, 2, 3].map(function (i) {
    return { id: 'inv' + i, no: String(1150 + i), date: '2026-10-0' + (i * 2), billTo: 'AI Trucking', total: 1000 * i, pa: '2026-09-16', pb: '2026-09-30' };
  });
  const store = makeStore({ inv_list: invs, onboarding: { employment: 'Contract', name: 'Asjad Kamal', business: 'Meticulous technologies' }, rev_entries: [], rev_extras: [], sessions: [], dsp_list: [] });
  const App = baseApp(store, 'driver');
  App.workProfiles = { active: function () { return { id: 'p1' }; }, list: function () { return [{ id: 'p1' }]; }, idOf: function () { return 'p1'; }, nameOf: function () { return ''; } };
  const sb = loadModule('modules/invoice.js', App);
  const M = sb.Meticulous.modules.invoice, body = fakeEl('div');
  M.render(body);
  ok('audit button renders on the face', body.innerHTML.includes('id="iv_audit"'));
  ok('audit button is at the very top', body.innerHTML.indexOf('🔎 Audit') < body.innerHTML.indexOf('iv_body'));
  body.querySelector('#iv_audit').onclick();
  ok('audit view opens', M._auditView() === true);
  ok('audit lists ALL 3 invoices with numbers and totals', body.innerHTML.includes('#1151') && body.innerHTML.includes('#1153') && body.innerHTML.includes('$3000.00'));
  ok('audit is newest first (1153 above 1151)', body.innerHTML.indexOf('#1153') < body.innerHTML.indexOf('#1151'));
  ok('Back returns to the face', M.back() === true && M._auditView() === false);
});

/* ---------- Manifest ---------- */
section('Manifest audit', function () {
  const store = makeStore({
    mani_sessions: [], sessions: [
      { date: '2026-10-01', seconds: 36000, km: 150 },
      { date: '2026-10-02', seconds: 32400, km: 140 }
    ],
    fuel_fills: [{ date: '2026-10-03', litres: '100', cost: '240' }],
    dsp_list: [{ id: 'd1', scheduledAt: '2026-10-04T09:00', date: '2026-10-04', status: 'done' }],
    rev_entries: [], rev_extras: [], mani_toggles: {}, mani_date: '2026-11-05', onboarding: {}
  });
  const App = baseApp(store, 'driver');
  const shared = loadShared(App);
  const sb = loadModule('modules/manifest.js', App, { Meticulous: shared });
  const M = sb.Meticulous.modules.manifest, body = fakeEl('div');
  M.render(body);
  ok('audit button renders on the face', body.innerHTML.includes('id="mn_audit"'));
  body.querySelector('#mn_audit').onclick();
  ok('audit view opens', M._auditOn() === true);
  ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].forEach(function (d) {
    ok('audit lists day ' + d, body.innerHTML.includes('data-mn-day="' + d + '"'));
  });
  ok('days newest first (Oct 4 above Oct 1)', body.innerHTML.indexOf('2026-10-04') < body.innerHTML.indexOf('2026-10-01'));
  const rows = body.querySelectorAll('[data-mn-day]');
  const oct2 = rows.filter(function (r) { return r.getAttribute() === '2026-10-02'; })[0];
  oct2.onclick();
  ok('tap a day opens that day (mani_date set, audit closed)', store.get('mani_date') === '2026-10-02' && M._auditOn() === false);
  ok('Back contract holds after leaving audit', M.back() === false);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
