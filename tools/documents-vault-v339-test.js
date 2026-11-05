#!/usr/bin/env node
/* Meticulous v339 — DOCUMENT-VAULT tests.
 *
 * Owner, Nov 5, 2026 17:11 MST: "In the app there should be
 * place to keep all my documents and all my inspections
 * everything!" — and 17:12, the second half: an owner / fleet
 * manager connected through Connect SENDS a document to a
 * driver (renewed ownership, insurance, anything); it lands
 * in the driver's Documents by itself, marked with who sent
 * it and when; renewed versions store alongside, never
 * overwrite; the driver side is receive-and-store only.
 *
 * Runs the REAL shipped modules/documents.js (+ modules/pti.js
 * for the summary format it defers to) and the REAL
 * js/connectpipe.js inbox landing over a fake Firestore, in vm
 * sandboxes on the house harness pattern (v307/v327).
 *
 * Run: node tools/documents-vault-v339-test.js
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
function tick() { return new Promise(function (r) { setTimeout(r, 5); }); }
async function ticks(n) { for (let i = 0; i < (n || 4); i++) await tick(); }

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

/* ---------------- store + fake DOM (v307 parsePool shape) ---------------- */
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

/* ---------------- fixtures ---------------- */
function rep(id, filedAt, kind, odo, result, defects, signed) {
  return {
    id, date: dayStr(filedAt), filedAt, kind, odometer: odo,
    result, defects: defects || [], signed: !!signed,
    unit: '07', plate: '04 R209', carrier: 'AI Trucking', driverName: 'Asjad Kamal', items: {}
  };
}
const PTI_FIXTURE = [
  rep('r-old', new RealDate(2026, 8, 14, 7, 0).getTime(), 'pre', 165000, 'pass', [], true),   // Sep 14 — far outside the 14-day window
  rep('r-today-pre', new RealDate(2026, 10, 5, 8, 18).getTime(), 'pre', 171037, 'pass', [], true),
  rep('r-nov3', new RealDate(2026, 10, 3, 7, 5).getTime(), 'pre', 170800, 'major',
    [{ id: 'fuel', item: 'Fuel System', severity: 'major', note: 'Leak' }], true),
  rep('r-nov2', new RealDate(2026, 10, 2, 6, 58).getTime(), 'pre', 170500, 'pass', [], false)
];

/* ================= WORLD A: the Documents module ================= */
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

(async function main() {
  /* ---------- registry / source checks ---------- */
  const appSrc = read('js/app.js');
  ok('registry: documents in MODULE_ORDER', /MODULE_ORDER = \[[^\]]*'documents'/.test(appSrc));
  ok('registry: documents meta (Documents / 📁)', appSrc.indexOf("documents:  { title: 'Documents', icon: '📁'") >= 0);
  ok('registry: driver face carries documents', /driver: \[[^\]]*'documents'/.test(appSrc));
  ok('registry: office face carries documents (the sender)', /office: \[[^\]]*'documents'/.test(appSrc));
  const idxSrc = read('index.html');
  ok('index loads modules/documents.js', idxSrc.indexOf('modules/documents.js?v=339') >= 0);
  const csSrc = read('js/cloudsync.js');
  ok('sync: docs_items is a record-list key', csSrc.indexOf('docs_items: 1') >= 0);
  ok('sync: docs_items identity is its id', csSrc.indexOf("key === 'docs_items'") >= 0);
  ok('sync: docs_items sheds `data` like fuel sheds photos', /docs_items: \['data'\]/.test(csSrc));
  const cpSrc = read('js/connectpipe.js');
  ok('pipe: vaultdoc landing writes docs_items', cpSrc.indexOf("docType === 'vaultdoc'") >= 0 && cpSrc.indexOf("st.get('docs_items'") >= 0);

  /* ---------- A1: my documents — add / list / delete ---------- */
  {
    const w = docsWorld({ onboarding: {}, pti_reports: PTI_FIXTURE });
    ok('module registers', !!w.api);
    eq('quick labels are the owner-named five', JSON.stringify(w.api._labels),
      JSON.stringify(['Licence', 'Registration', 'Insurance', 'CVIP / Safety', 'Other']));
    const r1 = w.api._addDoc({ label: 'Insurance', name: 'Truck insurance 2026', kind: 'image', data: 'data:image/jpeg;base64,AAA' });
    ok('add returns the record', !!r1 && r1.label === 'Insurance' && r1.kind === 'image');
    const r2 = w.api._addDoc({ label: 'Licence', name: '', kind: 'pdf', data: 'data:application/pdf;base64,BBB' });
    eq('blank name falls back to the label', r2.name, 'Licence');
    eq('a doc with no file is refused', w.api._addDoc({ label: 'Other', name: 'x', kind: 'image', data: '' }), null);
    const list = w.api._items();
    eq('two documents stored', list.length, 2);
    eq('newest first', list[0].id, r2.id);
    const stored = w.store.get('docs_items', []);
    eq('stored under docs_items (the sync record list)', stored.length, 2);
    eq('status counts documents', w.api.status(), '2 documents');
    ok('delete removes exactly that document', w.api._deleteDoc(r1.id) && w.api._items().length === 1 && w.api._items()[0].id === r2.id);
  }

  /* ---------- A2: my inspections — full history, PTI's own summary ---------- */
  {
    const w = docsWorld({ onboarding: {}, pti_reports: PTI_FIXTURE });
    const insps = w.api._inspections();
    eq('FULL history — all 4 reports, not the 14-day window', insps.length, 4);
    eq('newest first', insps[0].id, 'r-today-pre');
    eq('the Sep 14 report is here (outside Inspection Mode\u2019s window)', insps[3].id, 'r-old');
    /* the summary line IS Inspection Mode's line, byte for byte */
    PTI_FIXTURE.forEach(function (r) {
      eq('summary line matches PTI _dotSummaryText (' + r.id + ')', w.api._summaryLine(r), w.PTI._dotSummaryText(r));
    });
    const parts = w.api._summaryParts(PTI_FIXTURE[2]);
    eq('summary parts: major defect named', parts.result, 'Defects: Fuel System (major)');
    eq('summary parts: unsigned is stated', w.api._summaryParts(PTI_FIXTURE[3]).signed, false);
  }

  /* ---------- A3: the face — cards, one primary, fenced delete ---------- */
  {
    const w = docsWorld({ onboarding: {}, pti_reports: PTI_FIXTURE });
    w.api._addDoc({ label: 'Registration', name: 'Registration 2026', kind: 'image', data: 'data:image/jpeg;base64,CCC' });
    const body = makeBody();
    w.api.render(body);
    const html = body.innerHTML;
    ok('face: Add card with ONE primary Save', html.indexOf('id="docs_save"') >= 0 && html.indexOf('Save document') >= 0);
    ok('face: quick labels offered', ['Licence', 'Registration', 'Insurance', 'CVIP / Safety', 'Other'].every(function (l) { return html.indexOf('data-doclabel="' + l + '"') >= 0; }));
    ok('face: photo AND pdf doors', html.indexOf('id="docs_cam"') >= 0 && html.indexOf('accept="image/*,.pdf,application/pdf"') >= 0);
    ok('face: My documents card lists the document', html.indexOf('My documents') >= 0 && html.indexOf('Registration 2026') >= 0);
    ok('face: My inspections card shows the FULL history summary', html.indexOf('My inspections') >= 0 && html.indexOf('Fuel System (major)') >= 0);
    ok('face: no send card for a driver with no office role', html.indexOf('docs_send_btn') < 0);
    /* open the document -> detail; delete is a quiet armed action */
    const openEls = body.querySelectorAll('[data-doc-open]');
    eq('one tappable document row', openEls.length, 1);
    openEls[0].onclick();
    ok('detail: full view opens', body.innerHTML.indexOf('id="docs_del"') >= 0 && body.innerHTML.indexOf('Registration 2026') >= 0);
    ok('detail: delete starts unarmed (fenced)', body.innerHTML.indexOf('🗑 Delete document') >= 0);
    body.querySelector('#docs_del').onclick();
    ok('detail: first tap only arms the delete', w.api._items().length === 1 && body.innerHTML.indexOf('Tap again to delete') >= 0);
    body.querySelector('#docs_del').onclick();
    eq('detail: second tap deletes', w.api._items().length, 0);
    /* open an inspection -> summary sheet, never the checklist */
    const w2 = docsWorld({ onboarding: {}, pti_reports: PTI_FIXTURE });
    const b2 = makeBody();
    w2.api.render(b2);
    const rows = b2.querySelectorAll('[data-insp-open]');
    ok('inspections are tappable rows', rows.length >= 3);
    rows[0].onclick();
    ok('sheet: summary fields only', b2.innerHTML.indexOf('Inspection summary') >= 0 &&
      b2.innerHTML.indexOf('Odometer') >= 0 && b2.innerHTML.indexOf('Signed') >= 0);
    ok('sheet: NO checklist dump', b2.innerHTML.indexOf('Air Brake System') < 0 && b2.innerHTML.indexOf('Schedule 1 checklist') < 0);
  }

  /* ---------- A4: the send face (owner) + wire discipline ---------- */
  {
    const sent = [];
    const pipe = {
      connectedPeers: () => [{ uid: 'uid-driver', name: 'Asjad Kamal', status: 'connected' }],
      newShareId: () => 'dsshare1',
      sendDoc: (uid, share) => { sent.push({ uid, share: clone(share) }); return Promise.resolve('sent'); },
      pullInbox: () => Promise.resolve(0)
    };
    const w = docsWorld({ onboarding: {} }, 'office', pipe);
    const body = makeBody();
    w.api.render(body);
    ok('office face: send card present with the driver picked', body.innerHTML.indexOf('id="docs_send_btn"') >= 0 && body.innerHTML.indexOf('Asjad Kamal') >= 0);
    ok('office face: no inspections card (office files none)', body.innerHTML.indexOf('My inspections') < 0);
    const verdict = await w.api._sendToPeer('uid-driver', { label: 'Insurance', name: 'Insurance renewal 2027', kind: 'image', data: 'data:image/jpeg;base64,DDD' });
    eq('send resolves sent', verdict, 'sent');
    eq('send crossed as a vaultdoc docshare', sent.length === 1 && sent[0].share.type, 'vaultdoc');
    eq('package carries label + name + file', sent[0].share.content.label + '|' + sent[0].share.content.name + '|' + sent[0].share.content.kind, 'Insurance|Insurance renewal 2027|image');
    eq('package carries the file bytes', sent[0].share.content.data, 'data:image/jpeg;base64,DDD');
    const bigPdf = 'data:application/pdf;base64,' + 'A'.repeat(1000000);
    eq('an oversize PDF is refused, never sent cut', await w.api._sendToPeer('uid-driver', { label: 'Other', name: 'Huge', kind: 'pdf', data: bigPdf }), 'toobig');
    eq('nothing more crossed', sent.length, 1);
  }

  /* ---------- B: the pipe landing — receive and store only ---------- */
  {
    const store = makeStore({
      onboarding: {},
      con_list: [{ id: 'c-boss', name: 'Ai Trucking', uid: 'uid-boss', status: 'connected', kind: 'all' }]
    });
    /* fake Firestore: one pipedispatches collection */
    const colDocs = new Map();
    colDocs.set('pd1', {
      from: 'uid-boss', to: 'uid-me', fromName: 'Ai Trucking', fromBusiness: '',
      jobSite: '', date: '', scheduledAt: '', equipment: '', material: '', notes: '',
      kind: 'docshare', docType: 'vaultdoc', label: 'Insurance renewal 2027',
      content: { label: 'Insurance', name: 'Insurance renewal 2027', kind: 'image', data: 'data:image/jpeg;base64,EEE' },
      shareId: 'dsshare9', status: 'sent', sentAt: FROZEN_MS - 60000, deliveredAt: 0, seenAt: 0
    });
    const db = {
      collection: () => ({
        where: () => ({
          get: () => Promise.resolve({
            forEach: (fn) => { colDocs.forEach((data, id) => fn({ id, data: () => clone(data), exists: true })); }
          })
        }),
        doc: (id) => ({
          update: (patch) => { const cur = colDocs.get(id); if (cur) colDocs.set(id, Object.assign({}, cur, clone(patch))); return Promise.resolve(); },
          get: () => Promise.resolve({ exists: !!colDocs.get(id), data: () => clone(colDocs.get(id)) }),
          set: (data) => { colDocs.set(id, clone(data)); return Promise.resolve(); }
        })
      })
    };
    const win = {};
    win.window = win;
    win.console = console;
    win.Date = FrozenDate;
    win.App = makeApp(store, 'driver');
    win.FB = { ready: true, user: { uid: 'uid-me' }, db };
    vm.createContext(win);
    vm.runInContext(read('js/connectpipe.js'), win, { filename: 'js/connectpipe.js' });
    const CP = win.ConnectPipe;
    ok('pipe loads', !!CP && typeof CP.pullInbox === 'function');
    const landed = await CP.pullInbox();
    await ticks(2);
    eq('one delivery landed', landed, 1);
    const vault = store.get('docs_items', []);
    eq('the document filed itself into the vault', vault.length, 1);
    if (vault.length) {
      eq('marked with WHO sent it', vault[0].sentBy, 'Ai Trucking');
      eq('marked with WHEN it was sent', vault[0].sentAt, FROZEN_MS - 60000);
      eq('label + name + file intact', vault[0].label + '|' + vault[0].name + '|' + vault[0].kind, 'Insurance|Insurance renewal 2027|image');
      eq('id is built from the shareId (dedupe key)', vault[0].id, 'doc_dsshare9');
      ok('arrival stamped', vault[0].addedAt > 0);
    }
    eq('receipt advanced to delivered', colDocs.get('pd1').status, 'delivered');
    /* a re-delivery under a NEW pipe id, same shareId, lands ONCE */
    colDocs.set('pd2', Object.assign({}, colDocs.get('pd1'), { status: 'sent' }));
    CP._lastPullAt = 0;
    await CP.pullInbox();
    await ticks(2);
    eq('re-send never duplicates the vault copy', store.get('docs_items', []).length, 1);
    /* a RENEWED version (new shareId) stores ALONGSIDE the old */
    colDocs.set('pd3', {
      from: 'uid-boss', to: 'uid-me', fromName: 'Ai Trucking', fromBusiness: '',
      jobSite: '', date: '', scheduledAt: '', equipment: '', material: '', notes: '',
      kind: 'docshare', docType: 'vaultdoc', label: 'Insurance renewal 2028',
      content: { label: 'Insurance', name: 'Insurance renewal 2028', kind: 'pdf', data: 'data:application/pdf;base64,FFF' },
      shareId: 'dsshare10', status: 'sent', sentAt: FROZEN_MS, deliveredAt: 0, seenAt: 0
    });
    CP._lastPullAt = 0;
    await CP.pullInbox();
    await ticks(2);
    const vault2 = store.get('docs_items', []);
    eq('renewed version stores alongside — never overwrites', vault2.length, 2);
    ok('both versions kept', vault2.some((d) => d.name === 'Insurance renewal 2027') && vault2.some((d) => d.name === 'Insurance renewal 2028'));
  }

  console.log('\ndocuments-vault-v339: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
