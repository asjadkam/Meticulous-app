#!/usr/bin/env node
'use strict';
/* AUDIT-ENTRY-NOT-OPENABLE-NOV8 — Asjad, Nov 8, 2026, 12:24 CST
 * (screen recording): in the Audit — Revenue entries list the
 * rows were inert; his ruling: "Audit has to have a way to
 * click on a record and open its details and the picture!"
 *
 * Conviction (code-read): the web-340 audit door rendered each
 * module's complete history through its OWN flat renderer. For
 * Revenue (renderAuditRev) and Invoice (renderAuditInv) the
 * rows were plain <div class="listitem"> — no data attribute,
 * no handler; the record's identity never reached the row.
 * Fuel / Documents / PTI / Manifest audit rows already carried
 * their door (data-fuedit / data-doc-open / data-pti-open /
 * data-mn-day); Damage's audit row IS the full report. PTI's
 * rows opened the report but its Back forgot the audit (it
 * landed on the form). Invoice has NO on-screen detail view
 * for an issued invoice anywhere (the face offers print only)
 * and invoices carry no picture — named no-door, not wired.
 *
 * This suite pins the fix, against the REAL shipped code, on
 * the v340 suite's harness:
 *  Revenue — audit rows (entries AND extras) carry data-rvday
 *    and open the SAME day detail the face's rows open (v75).
 *    SUPERSESSION (REVENUE-DETAIL-STRIP-NOV10, owner Nov 10,
 *    2026): the day detail no longer renders the day's
 *    haul-ticket picture(s) — the whole-day sections (sessions,
 *    fuel, dispatches, photos) came off the Revenue detail on
 *    his ruling ("that is exactly the job of the Manifest");
 *    the picture's home is the Manifest day view, pinned by
 *    tools/revenue-detail-strip-nov10-test.js. The three
 *    photo assertions below flipped to ABSENCE under that
 *    ruling; the door itself (audit row -> day detail, Back
 *    hygiene) is unchanged and still pinned here. A photo-less
 *    day still opens its details.
 *    Back — shell back() AND the detail's own ‹ Back — returns
 *    to the AUDIT list; a face-opened detail still returns to
 *    the face (flag hygiene). Rows, order and row text
 *    unchanged.
 *  PTI — a report opened from the audit returns to the audit
 *    (shell back() AND the report's own ‹ Back); the report
 *    shows its defect photo; a history-opened report still
 *    returns to the form.
 * Run: node tools/audit-entry-openable-nov8-test.js */
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

/* ---------- fake DOM (v340 harness, + [data-rvday] / [data-day-link]) ---------- */
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
      if (['[data-rvday]', '[data-day-link]', '[data-pti-open]'].indexOf(sel) !== -1) {
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
    _photoDl(src, name) { return '<a data-dl="' + name + '"></a>'; },
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

/* ---------- Revenue ---------- */
section('Revenue — audit rows open the day, picture included', function () {
  const store = makeStore({
    onboarding: { payStandard: 'Hourly', payRate: 29, name: 'T', truck: 'T1', company: 'C', payCycle: 'biweekly', firstName: 'A', lastName: 'K' },
    rev_entries: [
      { date: '2026-10-03', type: 'hourly', hours: 10.5, amount: 304.50, note: 'Dispatch: Aecon Trans - foreman 9.5h + travel 1h = 10.5h' },
      { date: '2026-10-02', type: 'hourly', hours: 4, amount: 116, note: 'Yard day' },
      { date: '2026-10-01', type: 'hourly', hours: 10, amount: 290, note: 'Sheet day' }
    ],
    rev_extras: [
      { date: '2026-10-03', type: 'Waiting time', amount: 25, note: 'at the yard' }
    ],
    sessions: [
      { date: '2026-10-03', seconds: 37800, startedAt: '2026-10-03T13:00:00.000Z', endedAt: '2026-10-03T23:30:00.000Z', startOdo: 170000, endOdo: 170300, ticketPhoto: 'data:image/jpeg;base64,SESPHOTO' }
    ],
    dsp_list: [
      { date: '2026-10-03', jobSite: 'Aecon Trans', status: 'Completed', ticketNo: '13973', tickets: [{ no: '13973', photo: 'data:image/jpeg;base64,DSPHOTO' }] }
    ]
  });
  const App = baseApp(store, 'driver');
  const shared = loadShared(App);
  const sb = loadModule('modules/revenue.js', App, { Meticulous: shared });
  const M = sb.Meticulous.modules.revenue, body = fakeEl('div');
  M.render(body);
  ok('face carries the audit button', body.innerHTML.includes('id="rv_audit"'));
  body.querySelector('#rv_audit').onclick();
  ok('audit view opens', M._auditView() === true);
  const rows = body.querySelectorAll('[data-rvday]');
  ok('every audit row carries its day door (3 entries + 1 extra)', rows.length === 4, 'got ' + rows.length);
  ok('rows keep their order (entries newest first, then extras)',
    rows.map(r => r.getAttribute('data-rvday')).join(',') === '2026-10-03,2026-10-02,2026-10-01,2026-10-03');
  ok('row text and counts unchanged',
    body.innerHTML.includes('$304.50') && body.innerHTML.includes('foreman 9.5h') && body.innerHTML.includes('3 records'));

  rows[0].onclick();
  ok('tap leaves the audit list', M._auditView() === false);
  ok('the SAME day detail the face opens is on screen',
    body.innerHTML.includes('$304.50') && body.innerHTML.includes('Aecon Trans'));
  /* flipped by REVENUE-DETAIL-STRIP-NOV10 (see header): the
     Revenue day detail carries no Dispatches section and no
     ticket photos any more — they live on the Manifest day. */
  ok('no Dispatches section on the Revenue day detail (Nov 10 ruling)',
    !body.innerHTML.includes('Dispatches (1)') && !body.innerHTML.includes('🚚 Dispatches'));
  ok('the dispatch ticket photo does NOT render here any more', !body.innerHTML.includes('data:image/jpeg;base64,DSPHOTO'));
  ok('the session ticket photo does NOT render here any more', !body.innerHTML.includes('data:image/jpeg;base64,SESPHOTO'));
  ok('no ticket-photo frame on the Revenue day detail', !body.innerHTML.includes('alt="Ticket photo"'));

  ok('shell Back returns to the audit list', M.back() === true && M._auditView() === true);
  ok('the audit list is what is on screen', body.innerHTML.includes('Audit — Revenue entries'));

  body.querySelectorAll('[data-rvday]')[0].onclick();
  ok('day detail open again', body.innerHTML.includes('$304.50'));
  body.querySelector('#rv_day_back').onclick();
  ok("the day detail's own ‹ Back returns to the audit list",
    M._auditView() === true && body.innerHTML.includes('Audit — Revenue entries'));

  body.querySelectorAll('[data-rvday]')[1].onclick();
  ok('a day with no photo opens its details, no picture invented',
    body.innerHTML.includes('Yard day') && !body.innerHTML.includes('alt="Ticket photo"'));
  ok('Back to the audit list again', M.back() === true && M._auditView() === true);

  body.querySelectorAll('[data-rvday]')[3].onclick();
  ok('an extras row opens its day, the extra on it',
    body.innerHTML.includes('Extras') && body.innerHTML.includes('Waiting time'));
  ok('Back to the audit list from the extra’s day', M.back() === true && M._auditView() === true);

  body.querySelector('#rv_audit_back').onclick();
  ok("the audit's own Back returns to the face",
    M._auditView() === false && !body.innerHTML.includes('Audit — Revenue entries'));
  const faceRows = body.querySelectorAll('[data-day-link]');
  ok('the face still lists its tappable day rows', faceRows.length > 0, 'got ' + faceRows.length);
  if (faceRows.length && typeof faceRows[0].onclick === 'function') {
    faceRows[0].onclick({ target: null });
    ok('face row opens its day detail', !body.innerHTML.includes('Audit — Revenue entries'));
    ok('a face-opened detail returns to the FACE, not the audit', M.back() === true && M._auditView() === false);
  } else {
    ok('face day rows are wired in the harness (onclick present)', false);
  }
});

/* ---------- PTI ---------- */
section('PTI — audit-opened report returns to the audit', function () {
  const store = makeStore({
    onboarding: { name: 'T', truck: 'T1', company: 'C', firstName: 'A', lastName: 'K' },
    pti_reports: [
      { id: 'r1', date: '2026-10-05', kind: 'pre', unit: '07', plate: 'AB1234', odometer: 169000, driverName: 'A K', carrier: 'C', location: 'Calgary', filedAt: '2026-10-05T13:00:00.000Z',
        items: { cab: { r: 'defect', sev: 'minor', note: 'door latch stiff', photo: 'data:image/jpeg;base64,DEFPHOTO' } },
        defects: [{ item: 'Cab', note: 'door latch stiff' }], result: 'pass', signed: true, signedName: 'A K', signature: 'data:image/png;base64,SIGIMG' },
      { id: 'r2', date: '2026-10-04', kind: 'pre', unit: '07', plate: 'AB1234', odometer: 168800, driverName: 'A K', carrier: 'C', location: 'Calgary', filedAt: '2026-10-04T13:00:00.000Z',
        items: { airbrake: 'ok' }, defects: [], result: 'pass', signed: true, signedName: 'A K' }
    ]
  });
  const App = baseApp(store, 'driver');
  const sb = loadModule('modules/pti.js', App);
  const M = sb.Meticulous.modules.pti, body = fakeEl('div');
  M.render(body);
  ok('face carries the audit button', body.innerHTML.includes('id="pti_audit"'));
  body.querySelector('#pti_audit').onclick();
  ok('audit view opens', M._viewMode() === 'audit');
  const pRows = body.querySelectorAll('[data-pti-open]');
  ok('audit lists both reports', pRows.length === 2, 'got ' + pRows.length);
  pRows[0].onclick();
  ok('tap opens the filed report', M._viewMode() === 'report');
  ok('the full report is the detail', body.innerHTML.includes('Daily Vehicle Inspection Report'));
  ok('the defect photo renders in the report', body.innerHTML.includes('data:image/jpeg;base64,DEFPHOTO'));
  ok('shell Back returns to the audit list', M.back() === true && M._viewMode() === 'audit');
  body.querySelectorAll('[data-pti-open]')[0].onclick();
  ok('report open again', M._viewMode() === 'report');
  body.querySelector('#pti_back').onclick();
  ok("the report's own ‹ Back returns to the audit list", M._viewMode() === 'audit');
  body.querySelector('#pti_audit_back').onclick();
  ok("the audit's own Back returns to the form", M._viewMode() === 'form');
  const hRows = body.querySelectorAll('[data-pti-open]');
  ok('the form history still lists its reports', hRows.length > 0, 'got ' + hRows.length);
  if (hRows.length && typeof hRows[0].onclick === 'function') {
    hRows[0].onclick();
    ok('history row opens the report', M._viewMode() === 'report');
    ok('a history-opened report returns to the FORM, not the audit', M.back() === true && M._viewMode() === 'form');
  } else {
    ok('history rows are wired in the harness (onclick present)', false);
  }
});

console.log('\naudit-entry-openable-nov8: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
