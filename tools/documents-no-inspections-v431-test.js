#!/usr/bin/env node
/* Meticulous v431 — DOCUMENTS-PAGE-INSPECTIONS-REMOVAL tests.
 *
 * Owner, Nov 12, 2026 (over a screenshot of the Documents
 * page, confirmed with a thumbs-up on the read-back): the
 * Documents page mixes two things — "My documents" and below
 * it a "My inspections" list of his PTIs. Inspections do NOT
 * belong on the Documents page; the page holds documents
 * only (licence, registration, insurance). Inspections live
 * in their own place — the PTI module.
 *
 * THE REMOVAL (modules/documents.js only): the face's
 * "🔍 My inspections" card (newest 3 + "Show more — N more
 * inspections"), its Show-more wiring and its row wiring are
 * deleted. Nothing else moves: the Add form, the My documents
 * list, the document detail/delete flow, the owner Send card
 * and the Audit view are byte-for-byte the v430 behaviour,
 * and no inspection record is touched — the PTI module's own
 * Past inspections list reads the same pti_reports, proven
 * below against the REAL modules/pti.js.
 *
 * This suite SUPERSEDES the two v339 face assertions that
 * pinned the removed card ('face: My inspections card shows
 * the FULL history summary' and the face's [data-insp-open]
 * rows): they tested a section the owner ordered removed.
 * The v339 suite's data-layer, vault, send and pipe sections
 * are unaffected and still stand.
 *
 * Runs the REAL shipped modules/documents.js + modules/pti.js
 * in vm sandboxes on the house harness pattern (v339/v328).
 *
 * Run: node tools/documents-no-inspections-v431-test.js
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
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
const clone = (v) => JSON.parse(JSON.stringify(v));

/* ---------------- frozen clock: Thu Nov 5, 2026, noon ---------------- */
const RealDate = Date;
const FROZEN_MS = new RealDate(2026, 10, 5, 12, 0, 0).getTime();
function FrozenDate(...args) { return args.length ? new RealDate(...args) : new RealDate(FROZEN_MS); }
FrozenDate.now = () => FROZEN_MS;
FrozenDate.parse = RealDate.parse;
FrozenDate.UTC = RealDate.UTC;
FrozenDate.prototype = RealDate.prototype;
function dayStr(ms) {
  const d = new RealDate(ms);
  const z = (n) => ('0' + n).slice(-2);
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}

/* ---------------- store + fake DOM (the v339 harness) ---------------- */
function makeStore(seed) {
  const m = new Map(Object.entries(clone(seed || {})));
  return {
    get: (k, d) => (m.has(k) ? clone(m.get(k)) : d),
    set: (k, v) => { m.set(k, clone(v)); return true; },
    del: (k) => { m.delete(k); return true; },
    _m: m
  };
}
function makeEl(tag, attrs) {
  const el = {
    tagName: tag, _attrs: attrs || {}, _html: '', value: '', disabled: false,
    textContent: '', style: {}, files: [],
    classList: { add() {}, remove() {}, toggle() {} },
    getAttribute: function (n) { return n in this._attrs ? this._attrs[n] : null; },
    setAttribute: function (n, v) { this._attrs[n] = String(v); },
    onclick: null, onchange: null,
    addEventListener: function () {}, removeEventListener: function () {},
    querySelector: () => null, querySelectorAll: () => []
  };
  Object.defineProperty(el, 'innerHTML', {
    configurable: true,
    get: function () { return el._html; },
    set: function (v) { el._html = String(v); }
  });
  return el;
}
function parsePool(html, pool) {
  const re = /<(button|select|input|a|textarea|div|span)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = {};
    const are = /([a-zA-Z][a-zA-Z0-9-]*)(?:="([^"]*)")?/g;
    let am;
    while ((am = are.exec(m[2]))) attrs[am[1]] = am[2] === undefined ? '' : am[2];
    pool.push(makeEl(m[1], attrs));
  }
}
function makeBody() {
  const body = makeEl('div', {});
  body._pool = [];
  Object.defineProperty(body, 'innerHTML', {
    get: function () { return body._html; },
    set: function (v) { body._html = String(v); body._pool = []; parsePool(body._html, body._pool); }
  });
  body.querySelector = function (sel) {
    if (sel.charAt(0) === '#') {
      const id = sel.slice(1);
      return body._pool.filter(function (e) { return e._attrs.id === id; })[0] || null;
    }
    return null;
  };
  body.querySelectorAll = function (sel) {
    const m = /^\[([a-zA-Z0-9-]+)(?:="([^"]*)")?\]$/.exec(sel);
    if (!m) return [];
    return body._pool.filter(function (e) {
      if (!(m[1] in e._attrs)) return false;
      return m[2] === undefined || e._attrs[m[1]] === m[2];
    });
  };
  return body;
}
function makeApp(store, role) {
  return {
    _store: store,
    _esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    _today: () => '2026-11-05',
    userRole: () => role || 'driver',
    _photoDl: () => ''
  };
}

/* ---------------- fixtures (the v339 shapes) ---------------- */
function rep(id, filedAt, kind, odo, result, defects, signed) {
  return {
    id, date: dayStr(filedAt), filedAt, kind, odometer: odo,
    result, defects: defects || [], signed: !!signed,
    unit: '07', plate: '04 R209', carrier: 'AI Trucking', driverName: 'Asjad Kamal', items: {}
  };
}
const PTI_FIXTURE = [
  rep('r-old', new RealDate(2026, 8, 14, 7, 0).getTime(), 'pre', 165000, 'pass', [], true),
  rep('r-today-pre', new RealDate(2026, 10, 5, 8, 18).getTime(), 'pre', 171037, 'pass', [], true),
  rep('r-nov3', new RealDate(2026, 10, 3, 7, 5).getTime(), 'pre', 170800, 'major',
    [{ id: 'fuel', item: 'Fuel System', severity: 'major', note: 'Leak' }], true),
  rep('r-nov2', new RealDate(2026, 10, 2, 6, 58).getTime(), 'pre', 170500, 'pass', [], false)
];

/* ---------------- worlds ---------------- */
function docsWorld(seed, role, pipeStub) {
  const store = makeStore(seed || {});
  const win = {};
  win.window = win;
  win.console = console;
  win.Date = FrozenDate;
  win.App = makeApp(store, role);
  win.Meticulous = { modules: {} };
  if (pipeStub) win.ConnectPipe = pipeStub;
  vm.createContext(win);
  vm.runInContext(read('modules/pti.js'), win, { filename: 'modules/pti.js' });
  vm.runInContext(read('modules/documents.js'), win, { filename: 'modules/documents.js' });
  return { win, store, api: win.Meticulous.modules.documents, PTI: win.Meticulous.modules.pti };
}
function ptiWorld(seed) {
  const store = makeStore(seed || {});
  const win = {};
  win.window = win;
  win.console = console;
  win.Date = FrozenDate;
  win.App = makeApp(store, 'driver');
  win.Meticulous = { modules: {} };
  vm.createContext(win);
  vm.runInContext(read('modules/pti.js'), win, { filename: 'modules/pti.js' });
  return { win, store, PTI: win.Meticulous.modules.pti };
}

(async function main() {
  /* ---------- source pins: the section is GONE, not hidden ---------- */
  const docSrc = read('modules/documents.js');
  ok('source: no docs_insp_more anywhere', docSrc.indexOf('docs_insp_more') < 0);
  ok('source: no inspShowAll state anywhere', docSrc.indexOf('inspShowAll') < 0);
  const idxSrc = read('index.html');
  /* pin moved v431 -> v442 (DOC-OPEN-NOV12 shipped a new
     documents.js; the removal this suite proves is untouched) */
  ok('index loads modules/documents.js?v=442', idxSrc.indexOf('modules/documents.js?v=442') >= 0);

  /* ---------- the driver face: documents only ---------- */
  {
    const w = docsWorld({ onboarding: {}, pti_reports: PTI_FIXTURE });
    const body = makeBody();
    w.api.render(body);
    const html = body.innerHTML;
    ok('face: Add a document card with the one primary Save',
      html.indexOf('Add a document') >= 0 && html.indexOf('id="docs_save"') >= 0 && html.indexOf('Save document') >= 0);
    ok('face: My documents card stands', html.indexOf('📁 My documents') >= 0);
    ok('face: documents empty state intact',
      html.indexOf('No documents yet — add your licence, registration or insurance above.') >= 0);
    ok('face: NO My inspections card', html.indexOf('My inspections') < 0);
    ok('face: NO inspections show-more wording', html.indexOf('more inspection') < 0);
    ok('face: NO inspection empty-state wording', html.indexOf('No inspections filed yet') < 0);
    eq('face: zero tappable inspection rows', body.querySelectorAll('[data-insp-open]').length, 0);
    ok('face: no #docs_insp_more button', body.querySelector('#docs_insp_more') === null);
    ok('face: no send card for a driver', html.indexOf('docs_send_btn') < 0);
    eq('status still counts documents only', w.api.status(), 'No documents yet');
  }

  /* ---------- documents flow unchanged on the same face ---------- */
  {
    const w = docsWorld({ onboarding: {}, pti_reports: PTI_FIXTURE });
    w.api._addDoc({ label: 'Registration', name: 'Registration 2026', kind: 'image', data: 'data:image/jpeg;base64,CCC' });
    w.api._addDoc({ label: 'Insurance', name: 'Insurance 2026', kind: 'image', data: 'data:image/jpeg;base64,DDD' });
    w.api._addDoc({ label: 'Licence', name: 'Licence', kind: 'pdf', data: 'data:application/pdf;base64,EEE' });
    w.api._addDoc({ label: 'CVIP / Safety', name: 'CVIP 2026', kind: 'image', data: 'data:image/jpeg;base64,FFF' });
    const body = makeBody();
    w.api.render(body);
    let html = body.innerHTML;
    ok('flow: saved documents list under My documents (newest 3)',
      html.indexOf('CVIP 2026') >= 0 && html.indexOf('Insurance 2026') >= 0);
    ok('flow: the 4th document waits behind the cap', html.indexOf('Registration 2026') < 0);
    ok('flow: documents cap + Show more intact', html.indexOf('Show more — 1 more document') >= 0);
    ok('flow: STILL no inspections section with documents present', html.indexOf('My inspections') < 0);
    const moreB = body.querySelector('#docs_more');
    ok('flow: documents Show more button wired', !!moreB && typeof moreB.onclick === 'function');
    moreB.onclick();
    html = body.innerHTML;
    ok('flow: Show more expands the documents list', html.indexOf('Show less') >= 0 && html.indexOf('Registration 2026') >= 0);
    const rows = body.querySelectorAll('[data-doc-open]');
    eq('flow: all 4 documents tappable after expand', rows.length, 4);
    rows[0].onclick();
    ok('flow: document detail still opens', body.innerHTML.indexOf('id="docs_del"') >= 0);
    eq('data: the 4 PTI reports were never touched', w.store.get('pti_reports', []).length, 4);
  }

  /* ---------- the office face: send card, still no inspections ---------- */
  {
    const pipe = {
      connectedPeers: () => [{ uid: 'uid-driver', name: 'Asjad Kamal', status: 'connected' }],
      newShareId: () => 'dsshare1',
      sendDoc: () => Promise.resolve('sent'),
      pullInbox: () => Promise.resolve(0)
    };
    const w = docsWorld({ onboarding: {}, pti_reports: PTI_FIXTURE }, 'office', pipe);
    const body = makeBody();
    w.api.render(body);
    ok('office face: send card present', body.innerHTML.indexOf('id="docs_send_btn"') >= 0);
    ok('office face: NO My inspections card', body.innerHTML.indexOf('My inspections') < 0);
  }

  /* ---------- the Audit view (a separate door, NOT named in the
     ruling) still reads the filed inspections — the removal
     broke nothing behind it ---------- */
  {
    const w = docsWorld({ onboarding: {}, pti_reports: PTI_FIXTURE });
    const body = makeBody();
    w.api.render(body);
    const auditB = body.querySelector('#docs_audit_btn');
    ok('audit: the Audit button still stands on the face', !!auditB);
    auditB.onclick();
    const html = body.innerHTML;
    ok('audit: documents audit intact', html.indexOf('Audit — Documents') >= 0);
    ok('audit: inspections audit still reads all 4 reports',
      html.indexOf('Audit — Inspections') >= 0 && html.indexOf('4 on file') >= 0);
  }

  /* ---------- the inspections' own home: the PTI module still
     lists every filed inspection from the same records ---------- */
  {
    const w = ptiWorld({
      onboarding: { firstName: 'Asjad', lastName: 'Kamal', contractingCo: 'AI Trucking', companyName: 'Asjad Kamal', truckNo: '07' },
      pti_reports: PTI_FIXTURE
    });
    ok('pti: module registers', !!w.PTI);
    const body = makeBody();
    /* the v328 fake body for PTI: PTI paints into innerHTML and
       wires by id lookups — the documents pool body covers the
       paint, which is what this proof needs. */
    w.PTI.render(body);
    const html = body.innerHTML;
    ok('pti: the inspection form still paints', html.indexOf('🚛 Inspection — Schedule 1') >= 0);
    ok('pti: Past inspections list stands in the PTI module', html.indexOf('📁 Past inspections') >= 0);
    const hist = html.slice(html.indexOf('📁 Past inspections'));
    ok('pti: newest reports listed there (Nov 5 + Nov 3)',
      hist.indexOf('2026-11-05') >= 0 && hist.indexOf('2026-11-03') >= 0);
    ok('pti: the rest wait behind its own Show more', hist.indexOf('Show more — 1 more inspection') >= 0);
  }

  console.log('\ndocuments-no-inspections-v431: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
