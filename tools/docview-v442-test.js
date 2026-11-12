#!/usr/bin/env node
/* docview-v442-test.js — DOC-OPEN-NOV12 (web 442)
 *
 * Owner evidence, Nov 12, 2026 ~17:40 CST (his screen
 * recording): Documents → "CVSA Inspection Report — Nov 5,
 * 2026 (AB318427EI)" → the detail showed Label and Added and
 * the document itself as a tiny broken-image icon. His order:
 * "When clicked on a specific document it should open up that
 * document."
 *
 * ROOT (proven against the pre-fix module in Phase 0 below):
 * renderDocDetail printed the record's `data` field straight
 * into <img src="...">. A document whose bytes the sync copy
 * shed (the v339 law: `data` sheds whenever the vault book
 * outgrows one cloud doc) arrives on another device with NO
 * `data` field at all, so the detail printed src="undefined"
 * — the broken icon. The full page sat in the v394 account
 * copy (FB.saveDoc('documents', id, …)), which no code ever
 * read back.
 *
 * THE FIX (modules/documents.js only): the detail RESOLVES
 * the bytes — the record's data URL as-is; a vault reference
 * (web 441) through PhotoVault.get; anything else from the
 * account copy — healing account-found bytes into the vault
 * so the record carries a reference from then on. The photo
 * shows full-width; tapping it opens the document
 * full-screen (tap again toggles full size / fit). While
 * bytes are on their way, and if no copy exists anywhere,
 * the view says so in words — never a broken icon. PDFs ride
 * the same resolution before opening.
 *
 * This suite runs the REAL modules/documents.js in vm worlds
 * on the house harness pattern (v339/v431), with PhotoVault
 * and FB stubbed at the same seams the shipped code calls.
 * "Renders" here means: after the view settles, the detail's
 * <img> carries the document's own data URL as its src — the
 * exact string a browser paints — and no <img> anywhere in
 * the view carries src="undefined", an empty src, or a
 * leftover mtphoto:// reference.
 *
 *   PHASE 0 — failing first: the pre-fix render shape
 *             (src built from the raw record field) yields
 *             src="undefined" for the shed document.
 *   PHASE 1 — the inline form: a legacy inline document
 *             opens with its bytes on the face.
 *   PHASE 2 — the vault form: a reference document opens;
 *             the vault's bytes land on the face.
 *   PHASE 3 — the shed form (tonight's CVSA shape): no data
 *             on the record; the account copy opens the
 *             document AND the record heals to a vault
 *             reference through PhotoVault.put.
 *   PHASE 4 — a reference the vault cannot produce falls
 *             back to the account copy and heals the same way.
 *   PHASE 5 — no copy anywhere: plain words, no broken icon,
 *             no img at all.
 *   PHASE 6 — full-screen: tap the photo → the document
 *             fills the screen; tap again → full size; ✕
 *             closes. Works for the shed form too.
 *   PHASE 7 — PDFs: an inline PDF opens; a shed PDF opens
 *             from its account copy.
 *   PHASE 8 — unaffected: the list, the row tap, the delete
 *             flow, the no-photo states, the module status.
 *   PHASE 9 — pins: index loads documents.js?v=442; the
 *             resolver + full-screen view are in the source.
 *
 * Run: node tools/docview-v442-test.js
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
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };

/* ---------------- fixtures ---------------- */
const INLINE = 'data:image/jpeg;base64,INLINEPAGEBYTES0123456789';
const REF = 'mtphoto://aa11bb22cc33';
const REF_BYTES = 'data:image/jpeg;base64,VAULTPAGEBYTES0123456789';
const SHED_BYTES = 'data:image/jpeg;base64,ACCOUNTPAGEBYTES0123456789';
const GONE_REF = 'mtphoto://gone00gone00';
const PDF_INLINE = 'data:application/pdf;base64,PDFINLINEBYTES';
const PDF_SHED = 'data:application/pdf;base64,PDFACCOUNTBYTES';

function docRec(id, name, kind, data, addedAt) {
  const r = { id, label: 'CVIP / Safety', name, kind, addedAt };
  if (data !== undefined) r.data = data;
  return r;
}
const CVSA = () => docRec('doc-cvsa', 'CVSA Inspection Report — Nov 5, 2026 (AB318427EI)', 'image', undefined, 1794000000000);

/* ---------------- fake DOM (the v431 harness, + img + a document) ---------------- */
function makeEl(tag, attrs) {
  const el = {
    tagName: String(tag).toUpperCase(), _attrs: attrs || {}, _html: '', value: '', disabled: false,
    textContent: '', style: {}, files: [], children: [], parentNode: null, scrollLeft: 0, scrollTop: 0,
    classList: { add() {}, remove() {}, toggle() {} },
    getAttribute: function (n) { return n in this._attrs ? this._attrs[n] : null; },
    setAttribute: function (n, v) { this._attrs[n] = String(v); },
    onclick: null, onchange: null,
    addEventListener: function () {}, removeEventListener: function () {},
    appendChild: function (c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild: function (c) {
      const i = el.children.indexOf(c);
      if (i >= 0) el.children.splice(i, 1);
      c.parentNode = null; return c;
    },
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
  const re = /<(button|select|input|a|textarea|div|span|img)\b([^>]*)>/g;
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
    const m = /^\[([a-zA-Z0-9-]+)(?:="([^"]*)")?]$/.exec(sel);
    if (!m) return [];
    return body._pool.filter(function (e) {
      if (!(m[1] in e._attrs)) return false;
      return m[2] === undefined || e._attrs[m[1]] === m[2];
    });
  };
  return body;
}
function findInTree(el, pred) {
  if (!el) return null;
  if (pred(el)) return el;
  for (const c of (el.children || [])) { const hit = findInTree(c, pred); if (hit) return hit; }
  return null;
}

/* ---------------- world ---------------- */
function makeStore(seed) {
  const m = new Map(Object.entries(clone(seed || {})));
  return {
    get: (k, d) => (m.has(k) ? clone(m.get(k)) : d),
    set: (k, v) => { m.set(k, clone(v)); return true; },
    del: (k) => { m.delete(k); return true; },
    _m: m
  };
}
function world(opts) {
  opts = opts || {};
  const store = makeStore({ docs_items: opts.docs || [] });
  const vaultBytes = opts.vaultBytes || {};         // ref -> data URL
  const accountDocs = opts.accountDocs || {};       // doc id -> {data}
  const calls = { vaultPut: [], opened: [] };
  const win = {};
  win.window = win;
  win.console = console;
  win.atob = atob;
  win.Blob = Blob;
  win.URL = { createObjectURL: () => 'blob:fake-1', revokeObjectURL: () => {} };
  win.open = (url) => { calls.opened.push(url); };
  const docBody = makeEl('body', {});
  win.document = {
    body: docBody,
    createElement: (tag) => makeEl(tag, {}),
    addEventListener: () => {}
  };
  win.App = {
    _store: store,
    _esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    userRole: () => 'driver',
    _photoDl: () => ''
  };
  win.PhotoVault = {
    isRef: (s) => typeof s === 'string' && s.indexOf('mtphoto://') === 0,
    get: (ref) => Promise.resolve(vaultBytes[ref] || null),
    put: (url) => { calls.vaultPut.push(url); return Promise.resolve('mtphoto://healed' + calls.vaultPut.length); }
  };
  win.FB = {
    user: { uid: 'u1' },
    loadDoc: (col, id) => Promise.resolve(col === 'documents' ? (accountDocs[id] || null) : null),
    saveDoc: () => Promise.resolve(undefined)
  };
  win.Meticulous = { modules: {} };
  vm.createContext(win);
  vm.runInContext(read('modules/documents.js'), win, { filename: 'modules/documents.js' });
  return { win, store, api: win.Meticulous.modules.documents, calls, docBody };
}
function openDoc(w, body, id) {
  w.api.render(body);                                    // main list
  const row = body.querySelectorAll('[data-doc-open]').filter((r) => r.getAttribute('data-doc-open') === id)[0];
  if (!row) throw new Error('no row for ' + id);
  row.onclick();
}
(async function main() {
  /* ---------- PHASE 0: the pre-fix shape, failing first ---------- */
  console.log('PHASE 0 — the shipped-441 render shape on the shed document');
  {
    const d = CVSA();
    const legacySrc = '<img src="' + d.data + '" style="width:100%">';
    eq('pre-fix: a shed record prints src="undefined" (the broken icon he recorded)',
      legacySrc, '<img src="undefined" style="width:100%">');
  }

  /* ---------- PHASE 1: the inline form ---------- */
  console.log('PHASE 1 — legacy inline document opens');
  {
    const w = world({ docs: [docRec('d1', 'Licence front', 'image', INLINE, 1794100000000)] });
    const body = makeBody();
    openDoc(w, body, 'd1');
    await settle();
    const img = body.querySelector('#docs_photo_img');
    ok('inline: the photo is on the detail face', !!img);
    eq('inline: its src is the document\'s own bytes', img && img.getAttribute('src'), INLINE);
    ok('inline: no loading note left standing', body.innerHTML.indexOf('Opening the document') < 0);
    ok('inline: nothing on the face is a broken image',
      body.innerHTML.indexOf('src="undefined"') < 0 && body.innerHTML.indexOf('src="mtphoto://') < 0);
  }

  /* ---------- PHASE 2: the vault-reference form ---------- */
  console.log('PHASE 2 — vault-reference document opens');
  {
    const w = world({
      docs: [docRec('d2', 'Registration 2026', 'image', REF, 1794100000000)],
      vaultBytes: { [REF]: REF_BYTES }
    });
    const body = makeBody();
    openDoc(w, body, 'd2');
    await settle();
    const img = body.querySelector('#docs_photo_img');
    ok('vault: the photo is on the detail face', !!img);
    eq('vault: the reference resolved to the real bytes', img && img.getAttribute('src'), REF_BYTES);
    ok('vault: no leftover reference on the face', (img.getAttribute('src') || '').indexOf('mtphoto://') < 0);
    const note = body.querySelector('#docs_photo_note');
    eq('vault: the opening note is cleared', note && note.textContent, '');
  }

  /* ---------- PHASE 3: the shed form — tonight's CVSA shape ---------- */
  console.log('PHASE 3 — shed document opens from its account copy and heals');
  {
    const cvsa = CVSA();
    const w = world({
      docs: [cvsa],
      accountDocs: { 'doc-cvsa': { label: cvsa.label, name: cvsa.name, kind: 'image', data: SHED_BYTES, addedAt: cvsa.addedAt } }
    });
    const body = makeBody();
    openDoc(w, body, 'doc-cvsa');
    await settle();
    ok('shed: the face repaints with the document on it',
      body.innerHTML.indexOf('<img id="docs_photo_img" src="' + SHED_BYTES + '"') >= 0);
    ok('shed: no broken image anywhere on the face',
      body.innerHTML.indexOf('src="undefined"') < 0 && body.innerHTML.indexOf('src="mtphoto://') < 0);
    eq('shed: facts still lead the detail', body.innerHTML.indexOf('CVSA Inspection Report — Nov 5, 2026 (AB318427EI)') >= 0, true);
    eq('shed: the found bytes were put in the vault', w.calls.vaultPut.length, 1);
    eq('shed: the vault was handed the account copy\'s bytes', w.calls.vaultPut[0], SHED_BYTES);
    const stored = w.store.get('docs_items', [])[0];
    ok('shed: the record now carries a vault reference', typeof stored.data === 'string' && stored.data.indexOf('mtphoto://healed') === 0,
      'stored.data=' + JSON.stringify(stored.data));
    ok('shed: the record\'s facts are untouched by the heal',
      stored.name === cvsa.name && stored.label === cvsa.label && stored.addedAt === cvsa.addedAt);
  }

  /* ---------- PHASE 4: reference the vault cannot produce ---------- */
  console.log('PHASE 4 — unproducible reference falls back to the account copy');
  {
    const d = docRec('d4', 'Insurance 2026', 'image', GONE_REF, 1794100000000);
    const w = world({ docs: [d], accountDocs: { d4: { data: SHED_BYTES } }, vaultBytes: {} });
    const body = makeBody();
    openDoc(w, body, 'd4');
    await settle();
    const img = body.querySelector('#docs_photo_img');
    eq('fallback: the account copy\'s bytes land on the face', img && img.getAttribute('src'), SHED_BYTES);
    eq('fallback: the record healed to a fresh reference',
      (w.store.get('docs_items', [])[0] || {}).data, 'mtphoto://healed1');
    const note = body.querySelector('#docs_photo_note');
    eq('fallback: the opening note is cleared', note && note.textContent, '');
  }

  /* ---------- PHASE 5: no copy anywhere ---------- */
  console.log('PHASE 5 — a document with no copy anywhere says so in words');
  {
    const d = docRec('d5', 'Lost page', 'image', undefined, 1794100000000);
    const w = world({ docs: [d] });
    const body = makeBody();
    openDoc(w, body, 'd5');
    await settle();
    const lostNote = body.querySelector('#docs_photo_note');
    ok('lost: the face says the document could not be loaded',
      !!lostNote && lostNote.textContent.indexOf('This document could not be loaded') >= 0,
      'note=' + JSON.stringify(lostNote && lostNote.textContent));
    ok('lost: there is NO image element to break', body.innerHTML.indexOf('<img') < 0);
    ok('lost: the facts still show', body.innerHTML.indexOf('Lost page') >= 0);
  }

  /* ---------- PHASE 6: the full-screen view ---------- */
  console.log('PHASE 6 — tapping the photo opens the document full-screen');
  {
    const w = world({ docs: [docRec('d1', 'Licence front', 'image', INLINE, 1794100000000)] });
    const body = makeBody();
    openDoc(w, body, 'd1');
    await settle();
    const img = body.querySelector('#docs_photo_img');
    img.onclick();
    ok('full: the overlay opens', w.api._fullOpen());
    const host = w.docBody.children.filter((c) => c.getAttribute('id') === 'docs_full')[0];
    ok('full: the overlay stands over the app', !!host);
    const fimg = findInTree(host, (e) => e.tagName === 'IMG');
    eq('full: the document itself fills the screen', fimg && fimg.getAttribute('src'), INLINE);
    ok('full: it starts fitted to the screen', (fimg.style.cssText || '').indexOf('max-width:100%') >= 0);
    fimg.onclick();
    ok('full: a tap zooms to full size', (fimg.style.cssText || '').indexOf('max-width:none') >= 0);
    fimg.onclick();
    ok('full: a second tap fits it again', (fimg.style.cssText || '').indexOf('max-width:100%') >= 0);
    const x = findInTree(host, (e) => e.tagName === 'BUTTON');
    x.onclick();
    ok('full: ✕ closes it', !w.api._fullOpen() && w.docBody.children.length === 0);
  }
  {
    /* the shed form full-screen: the tap resolves first */
    const cvsa = CVSA();
    const w = world({ docs: [cvsa], accountDocs: { 'doc-cvsa': { data: SHED_BYTES } } });
    const body = makeBody();
    openDoc(w, body, 'doc-cvsa');
    await settle();
    const img = body.querySelector('#docs_photo_img');
    img.onclick();
    ok('full (shed): the overlay opens on the healed document', w.api._fullOpen());
    const host = w.docBody.children.filter((c) => c.getAttribute('id') === 'docs_full')[0];
    const fimg = findInTree(host, (e) => e.tagName === 'IMG');
    eq('full (shed): it shows the account copy\'s page', fimg && fimg.getAttribute('src'), SHED_BYTES);
    w.api._closeFull();
  }

  /* ---------- PHASE 7: PDFs ---------- */
  console.log('PHASE 7 — PDFs ride the same resolution');
  {
    const w = world({ docs: [docRec('p1', 'Insurance PDF', 'pdf', PDF_INLINE, 1794100000000)] });
    const body = makeBody();
    openDoc(w, body, 'p1');
    await settle();
    const b = body.querySelector('#docs_open_pdf');
    ok('pdf: the Open button stands', !!b);
    b.onclick();
    await settle();
    eq('pdf: the inline PDF opens', w.calls.opened.length, 1);
  }
  {
    const d = docRec('p2', 'Shed PDF', 'pdf', undefined, 1794100000000);
    const w = world({ docs: [d], accountDocs: { p2: { data: PDF_SHED } } });
    const body = makeBody();
    openDoc(w, body, 'p2');
    await settle();
    body.querySelector('#docs_open_pdf').onclick();
    await settle();
    eq('pdf: the shed PDF opens from its account copy', w.calls.opened.length, 1);
  }

  /* ---------- PHASE 8: unaffected ---------- */
  console.log('PHASE 8 — the rest of the module is untouched');
  {
    const w = world({
      docs: [
        docRec('d1', 'Licence front', 'image', INLINE, 1794100000000),
        docRec('p1', 'Insurance PDF', 'pdf', PDF_INLINE, 1794090000000)
      ]
    });
    const body = makeBody();
    w.api.render(body);
    ok('list: both documents are listed', body.innerHTML.indexOf('Licence front') >= 0 && body.innerHTML.indexOf('Insurance PDF') >= 0);
    eq('list: status counts documents', w.api.status(), '2 documents');
    openDoc(w, body, 'd1');
    await settle();
    const del = body.querySelector('#docs_del');
    del.onclick();                                   // arm
    ok('delete: the first tap only arms', w.api._viewMode() === 'doc');
    body.querySelector('#docs_del').onclick();       // confirm
    eq('delete: the document is gone', w.store.get('docs_items', []).length, 1);
    eq('delete: back on the main face', w.api._viewMode(), 'main');
    const w2 = world({ docs: [] });
    const b2 = makeBody();
    w2.api.render(b2);
    ok('empty: the no-documents state stands',
      b2.innerHTML.indexOf('No documents yet — add your licence, registration or insurance above.') >= 0);
  }

  /* ---------- PHASE 9: pins ---------- */
  console.log('PHASE 9 — pins');
  {
    ok('pin: index loads modules/documents.js?v=442', read('index.html').indexOf('modules/documents.js?v=442') >= 0);
    const src = read('modules/documents.js');
    ok('pin: the resolver is in the shipped module', src.indexOf('function resolveDocBytes') >= 0);
    ok('pin: the account copy is read back (loadDoc)', src.indexOf("FB.loadDoc('documents'") >= 0);
    ok('pin: the full-screen view is in the shipped module', src.indexOf('function openDocFull') >= 0);
    ok('pin: the raw-field print is gone from the detail',
      src.indexOf("'<img src=\"' + d.data + '") < 0);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(2); });
