#!/usr/bin/env node
/* docpick-v443-test.js — DOC-ADD-PICKER-NOV12 (web 443)
 *
 * Owner evidence, Nov 12, 2026 17:49-17:50 CST (his screenshot
 * of Documents → "Add a document", then his words): "It's not
 * opening up anything!" The form renders, the label chips
 * answer, the Name field types — but tapping "📷 Take photo"
 * and "📁 Photo or PDF" opens NOTHING: no camera, no picker.
 *
 * ROOT (the chain, link by link):
 *  - The shell side is sound: Capacitor 8.5.3's stock
 *    BridgeWebChromeClient implements onShowFileChooser
 *    (capture → camera intent with a file-picker fallback;
 *    no capture → ACTION_GET_CONTENT picker), MainActivity
 *    adds no override, and the manifest's missing CAMERA
 *    declaration does not gate the system camera intent.
 *  - The web side hangs the whole flow on ONE fragile link:
 *    fileButtons() renders a <button> whose only connection
 *    to its file input is a JS onclick that calls .click()
 *    on an input styled 1px / opacity:0 / pointer-events:
 *    none. On the owner's phone the page runs in the
 *    Capacitor WebView from the OTA _capacitor_file_ copy,
 *    and that synthetic click on the non-interactable input
 *    is swallowed — the chooser is never requested. The
 *    app's own flows that present the input ITSELF to the
 *    user's tap (dispatch #t_photo, damage #dg_img) are the
 *    ones that have always worked in his hands.
 *
 * THE FIX (modules/documents.js only): the two controls are
 * LABELS bound to their inputs with `for` — the browser's
 * own activation path, dispatched by the browser as part of
 * the user's real tap, the same trust a direct input tap
 * gets. No JS click-forwarding remains on them (a forwarder
 * would double-fire the input in a healthy browser). The
 * inputs, the onchange read path, the preview, the save and
 * the vault are untouched. The Send form rides the same
 * fileButtons() helper and is fixed by the same change.
 *
 * WHAT THIS BENCH MODELS — AND WHAT IT CANNOT:
 *  The fake DOM below implements the two activation paths
 *  as the platform defines them: (1) a script-driven
 *  input.click() from another element's handler is recorded
 *  as a SYNTHETIC attempt and, per the device model above,
 *  opens nothing; (2) a tap on a <label for> fires the bound
 *  input's NATIVE activation, which is what requests the
 *  chooser (recorded with the input's accept + capture).
 *  The bench proves the web layer now asks through path (2)
 *  and only path (2), and that a delivered file flows
 *  preview → save → list → open. It CANNOT simulate the
 *  native camera activity or the system picker UI
 *  themselves — those are Capacitor/Android's, verified
 *  present above; the in-hands verdict is the owner's.
 *
 *   PHASE 0 — failing first, on the shipped shape: the tap
 *             targets are buttons with no `for` binding; a
 *             tap produces exactly one synthetic click and
 *             no chooser. (This phase replays the module
 *             source as of web 442 — it is run against the
 *             FIXED tree too, where its structural claims
 *             about the OLD shape are checked against git's
 *             442 bytes, not the live module.)
 *   PHASE 1 — Add form, camera door: tap "Take photo" →
 *             native activation of the capture input, zero
 *             synthetic clicks; a delivered photo previews.
 *   PHASE 2 — Add form, save: label + name + Save → the
 *             record lands in docs_items, the account copy
 *             is written, the list shows the document.
 *   PHASE 3 — the saved document OPENS from the list (the
 *             web 442 detail, coexisting, unregressed).
 *   PHASE 4 — Add form, picker door: tap "Photo or PDF" →
 *             native activation of the picker input; a
 *             delivered PDF previews as ready and saves as
 *             a pdf record.
 *   PHASE 5 — Send form (owner face): its two labels open
 *             their inputs the same way; a delivered photo
 *             sends through the pipe.
 *   PHASE 6 — guards: no JS forwarding left on any of the
 *             four labels (one tap = one activation), the
 *             save-without-a-file error still speaks, the
 *             label chips / Name / Audit still answer, the
 *             module status is unchanged.
 *   PHASE 7 — pins: index loads documents.js?v=443; the
 *             label shape is in the source; no button
 *             carries the picker ids any more.
 *
 * Run: node tools/docpick-v443-test.js
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
const RAW_PHOTO = 'data:image/jpeg;base64,RAWPHOTOBYTES0123456789';
const SHRUNK = 'data:image/jpeg;base64,SHRUNKBYTES0123456789';
const PDF_URL = 'data:application/pdf;base64,PDFBYTES0123456789';
const PHOTO_FILE = { name: 'licence.jpg', type: 'image/jpeg', _dataUrl: RAW_PHOTO };
const PDF_FILE = { name: 'policy.pdf', type: 'application/pdf', _dataUrl: PDF_URL };

/* The device model: synthetic script clicks on file inputs
   are recorded but open nothing (the swallowed link);
   native activation opens the chooser. Reset per world. */
let TAPS = null;
function freshTaps() { TAPS = { synthetic: [], chooser: [] }; return TAPS; }

/* ---------------- fake DOM (the v442 harness, + labels + activation) ---------------- */
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
    /* A script-driven click: for a file input this is the
       SYNTHETIC path — recorded, and (device model) it opens
       nothing. */
    click: function () {
      if (el.tagName === 'INPUT' && el._attrs.type === 'file' && TAPS) TAPS.synthetic.push(el._attrs.id);
      if (el.onclick) el.onclick();
    },
    /* The browser's own activation of a file input — what a
       tap on the input itself, or on its <label for>, fires.
       This is the request for the chooser. */
    _nativeActivate: function () {
      if (TAPS) TAPS.chooser.push({ id: el._attrs.id, accept: el._attrs.accept || '', capture: el._attrs.capture || '' });
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
  const re = /<(button|label|select|input|a|textarea|div|span|img)\b([^>]*)>/g;
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
/* A user's tap, as the platform delivers it: a button runs
   its handler; a label fires its own click handlers and
   then the browser activates the bound control; an input
   activates itself. */
function tap(body, el) {
  if (!el) throw new Error('tap: element not found');
  if (el.tagName === 'LABEL') {
    if (el.onclick) el.onclick();
    const target = body.querySelector('#' + el.getAttribute('for'));
    if (target && target._nativeActivate) target._nativeActivate();
    return;
  }
  if (el.tagName === 'INPUT') { el._nativeActivate(); return; }
  if (el.onclick) el.onclick();
}
function deliver(input, file) {
  if (!input) throw new Error('deliver: no input');
  input.files = [file];
  if (input.onchange) input.onchange({ target: input });
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
  freshTaps();
  const store = makeStore({ docs_items: opts.docs || [] });
  const calls = { savedDocs: [], sent: [], vaultPut: [] };
  const win = {};
  win.window = win;
  win.console = console;
  win.atob = atob;
  win.Blob = Blob;
  win.URL = { createObjectURL: () => 'blob:fake-1', revokeObjectURL: () => {} };
  win.open = () => {};
  function FakeImage() { this.width = 2000; this.height = 1000; this.onload = null; this.onerror = null; }
  Object.defineProperty(FakeImage.prototype, 'src', {
    set: function () { const s = this; setImmediate(() => { if (s.onload) s.onload(); }); },
    get: function () { return ''; }
  });
  win.Image = FakeImage;
  function FakeFileReader() {}
  FakeFileReader.prototype.readAsDataURL = function (file) {
    const s = this;
    setImmediate(() => { s.result = file._dataUrl; if (s.onload) s.onload(); });
  };
  win.FileReader = FakeFileReader;
  const docBody = makeEl('body', {});
  win.document = {
    body: docBody,
    createElement: (tag) => {
      if (tag === 'canvas') {
        return { width: 0, height: 0, getContext: () => ({ drawImage: function () {} }), toDataURL: () => SHRUNK };
      }
      return makeEl(tag, {});
    },
    addEventListener: () => {}
  };
  win.App = {
    _store: store,
    _esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    userRole: () => opts.role || 'driver',
    _photoDl: () => ''
  };
  win.PhotoVault = {
    isRef: (s) => typeof s === 'string' && s.indexOf('mtphoto://') === 0,
    get: () => Promise.resolve(null),
    put: (url) => { calls.vaultPut.push(url); return Promise.resolve('mtphoto://healed'); }
  };
  win.FB = {
    user: { uid: 'u1' },
    loadDoc: () => Promise.resolve(null),
    saveDoc: (col, id, rec) => { calls.savedDocs.push({ col, id, rec }); return Promise.resolve(undefined); }
  };
  if (opts.peers) {
    win.ConnectPipe = {
      connectedPeers: () => opts.peers,
      newShareId: () => 'share-1',
      sendDoc: (uid, doc) => { calls.sent.push({ uid, doc }); return Promise.resolve('sent'); },
      pullInbox: () => Promise.resolve(0)
    };
  }
  win.Meticulous = { modules: {} };
  vm.createContext(win);
  vm.runInContext(read('modules/documents.js'), win, { filename: 'modules/documents.js' });
  return { win, store, api: win.Meticulous.modules.documents, calls, docBody, taps: TAPS };
}

(async function main() {
  /* ---------- PHASE 0: the shipped shape, failing first ---------- */
  console.log('PHASE 0 — web 442 shape replayed from git bytes (the failing mechanism)');
  {
    const { execSync } = require('child_process');
    let src442 = '';
    try { src442 = execSync('git show 783975f:modules/documents.js', { cwd: ROOT, encoding: 'utf8' }); }
    catch (e) { src442 = ''; }
    ok('phase0: the 442 bytes are reachable for the replay', src442.length > 1000);
    if (src442) {
      ok('phase0: in 442 the camera control was a <button> with no label binding',
        src442.indexOf('<button type="button" class="btn secondary" id="\' + prefix + \'_cam"') >= 0 &&
        src442.indexOf('for="\' + prefix + \'_cam_in"') < 0);
      ok('phase0: in 442 the only door was a JS-forwarded synthetic click',
        src442.indexOf('camB.onclick = function () { camIn.click(); }') >= 0 &&
        src442.indexOf('pickB.onclick = function () { pickIn.click(); }') >= 0);
      /* and the device model of that mechanism: */
      const w = world({});
      const body = makeBody();
      w.api.render(body);
      const camIn = body.querySelector('#docs_cam_in');
      camIn.click();                       /* exactly what the 442 button handler did */
      eq('phase0: the synthetic click is recorded as an attempt', w.taps.synthetic.join(','), 'docs_cam_in');
      eq('phase0: …and no chooser is ever requested (the owner\'s "not opening up anything")', w.taps.chooser.length, 0);
    }
  }

  /* ---------- PHASE 1: the camera door ---------- */
  console.log('PHASE 1 — Add form: "Take photo" opens through the label');
  {
    const w = world({});
    const body = makeBody();
    w.api.render(body);
    const camCtl = body.querySelector('#docs_cam');
    ok('camera control is a label', !!camCtl && camCtl.tagName === 'LABEL');
    eq('camera label is bound to the capture input', camCtl && camCtl.getAttribute('for'), 'docs_cam_in');
    tap(body, camCtl);
    eq('one tap requests the chooser exactly once', w.taps.chooser.length, 1);
    eq('the chooser is the capture input\'s', w.taps.chooser[0] && w.taps.chooser[0].id, 'docs_cam_in');
    eq('the capture input still asks for the camera', w.taps.chooser[0] && w.taps.chooser[0].capture, 'environment');
    eq('the capture input still takes images only', w.taps.chooser[0] && w.taps.chooser[0].accept, 'image/*');
    eq('no synthetic click was spent', w.taps.synthetic.length, 0);
    deliver(body.querySelector('#docs_cam_in'), PHOTO_FILE);
    await settle();
    const prev = body.querySelector('#docs_prev');
    ok('the taken photo previews on the form', !!prev && prev.innerHTML.indexOf(SHRUNK) >= 0,
      prev ? prev.innerHTML.slice(0, 80) : 'no #docs_prev');
  }

  /* ---------- PHASE 2: the save ---------- */
  console.log('PHASE 2 — Add form: label + name + Save lands the document');
  {
    const w = world({});
    const body = makeBody();
    w.api.render(body);
    tap(body, body.querySelector('#docs_cam'));
    deliver(body.querySelector('#docs_cam_in'), PHOTO_FILE);
    await settle();
    const chip = body.querySelectorAll('[data-doclabel]').filter((b) => b.getAttribute('data-doclabel') === 'Licence')[0];
    tap(body, chip);                                    /* re-renders; pending photo is held */
    const nameEl = body.querySelector('#docs_name');
    nameEl.value = 'Class 1 licence';
    tap(body, body.querySelector('#docs_save'));
    await settle();
    const items = w.store.get('docs_items', []);
    eq('exactly one document was saved', items.length, 1);
    eq('it is an image', items[0] && items[0].kind, 'image');
    eq('it carries the picked label', items[0] && items[0].label, 'Licence');
    eq('it carries the typed name', items[0] && items[0].name, 'Class 1 licence');
    eq('it carries the photo bytes', items[0] && items[0].data, SHRUNK);
    eq('the account copy was written with the full page', w.calls.savedDocs.length, 1);
    ok('the list now shows the document', body.innerHTML.indexOf('Class 1 licence') >= 0);
    const row = body.querySelectorAll('[data-doc-open]')[0];
    ok('the list row is tappable', !!row);

    /* ---------- PHASE 3: it opens (442 coexistence) ---------- */
    console.log('PHASE 3 — the saved document opens from the list');
    tap(body, row);
    await settle();
    const img = body.querySelector('#docs_photo_img');
    ok('the detail shows the photo', !!img);
    eq('its src is the document\'s own bytes', img && img.getAttribute('src'), SHRUNK);
    ok('nothing on the face is a broken image', body.innerHTML.indexOf('src="undefined"') < 0);
  }

  /* ---------- PHASE 4: the picker door + a PDF ---------- */
  console.log('PHASE 4 — Add form: "Photo or PDF" opens through the label; a PDF saves');
  {
    const w = world({});
    const body = makeBody();
    w.api.render(body);
    const pickCtl = body.querySelector('#docs_pick');
    ok('picker control is a label', !!pickCtl && pickCtl.tagName === 'LABEL');
    eq('picker label is bound to the picker input', pickCtl && pickCtl.getAttribute('for'), 'docs_in');
    tap(body, pickCtl);
    eq('one tap requests the chooser exactly once', w.taps.chooser.length, 1);
    eq('the chooser is the picker input\'s', w.taps.chooser[0] && w.taps.chooser[0].id, 'docs_in');
    ok('the picker still takes images and PDFs',
      (w.taps.chooser[0] || { accept: '' }).accept.indexOf('image/*') >= 0 &&
      (w.taps.chooser[0] || { accept: '' }).accept.indexOf('.pdf') >= 0);
    eq('no synthetic click was spent', w.taps.synthetic.length, 0);
    deliver(body.querySelector('#docs_in'), PDF_FILE);
    await settle();
    const prev = body.querySelector('#docs_prev');
    ok('the PDF previews as ready to save', !!prev && prev.innerHTML.indexOf('policy.pdf') >= 0 && prev.innerHTML.indexOf('ready to save') >= 0,
      prev ? prev.innerHTML.slice(0, 80) : 'no #docs_prev');
    tap(body, body.querySelector('#docs_save'));
    await settle();
    const items = w.store.get('docs_items', []);
    eq('the PDF was saved', items.length, 1);
    eq('it is a pdf record', items[0] && items[0].kind, 'pdf');
    eq('it carries the PDF bytes', items[0] && items[0].data, PDF_URL);
  }

  /* ---------- PHASE 5: the Send form ---------- */
  console.log('PHASE 5 — Send form: its labels open the same way; a photo sends');
  {
    const w = world({ role: 'both', peers: [{ uid: 'drv1', name: 'Test Driver' }] });
    const body = makeBody();
    w.api.render(body);
    const sCam = body.querySelector('#docs_s_cam');
    const sPick = body.querySelector('#docs_s_pick');
    ok('send form is on the face for an owner face', !!sCam && !!sPick);
    eq('send camera label is bound', sCam && sCam.getAttribute('for'), 'docs_s_cam_in');
    eq('send picker label is bound', sPick && sPick.getAttribute('for'), 'docs_s_in');
    tap(body, sCam);
    tap(body, sPick);
    eq('both send choosers were requested', w.taps.chooser.map((c) => c.id).join(','), 'docs_s_cam_in,docs_s_in');
    eq('no synthetic click was spent', w.taps.synthetic.length, 0);
    deliver(body.querySelector('#docs_s_cam_in'), PHOTO_FILE);
    await settle();
    const prev = body.querySelector('#docs_s_prev');
    ok('the send photo previews', !!prev && prev.innerHTML.indexOf(SHRUNK) >= 0);
    body.querySelector('#docs_send_peer').value = 'drv1';   /* a real select stands on its first option */
    tap(body, body.querySelector('#docs_send_btn'));
    await settle();
    eq('the document crossed the pipe once', w.calls.sent.length, 1);
    eq('it crossed to the picked driver', w.calls.sent[0] && w.calls.sent[0].uid, 'drv1');
    eq('it crossed as an image vaultdoc', w.calls.sent[0] && w.calls.sent[0].doc.content.kind, 'image');
  }

  /* ---------- PHASE 6: guards ---------- */
  console.log('PHASE 6 — guards');
  {
    const w = world({});
    const body = makeBody();
    w.api.render(body);
    ['docs_cam', 'docs_pick'].forEach(function (id) {
      const ctl = body.querySelector('#' + id);
      ok(id + ': no JS click-forwarding rides the label (one tap can never double-fire)', !!ctl && ctl.onclick === null);
    });
    tap(body, body.querySelector('#docs_save'));
    await settle();
    ok('save without a file still speaks plainly', body.innerHTML.indexOf('Add the photo or PDF first') >= 0);
    eq('and saves nothing', w.store.get('docs_items', []).length, 0);
    ok('the Audit door still stands', !!body.querySelector('#docs_audit_btn'));
    eq('module status is unchanged', w.api.status(), 'No documents yet');
  }

  /* ---------- PHASE 7: pins ---------- */
  console.log('PHASE 7 — pins');
  {
    const src = read('modules/documents.js');
    const idx = read('index.html');
    ok('index loads documents.js?v=443', idx.indexOf('modules/documents.js?v=443') >= 0);
    ok('the source binds the controls as labels', src.indexOf('<label class="btn secondary"') >= 0 && src.indexOf('for="\' + prefix + \'_cam_in"') >= 0 && src.indexOf('for="\' + prefix + \'_in"') >= 0);
    ok('no button carries a picker id any more', src.indexOf('<button type="button" class="btn secondary" id="\' + prefix + \'_cam"') < 0 && src.indexOf('<button type="button" class="btn secondary" id="\' + prefix + \'_pick"') < 0);
    ok('the JS click-forwarders are gone', src.indexOf('camB.onclick') < 0 && src.indexOf('pickB.onclick') < 0 && src.indexOf('sCamB.onclick') < 0 && src.indexOf('sPickB.onclick') < 0);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('SUITE ERROR', e); process.exit(2); });
