#!/usr/bin/env node
/* Meticulous v241 — DOWNLOAD-BUTTON-DEAD (owner, Oct 22, 2026
 * 20:06 MDT, his Dispatch screen recording): the "⬇ Download
 * this photo" button on the dispatch card photo did nothing
 * when tapped. His law: every uploaded photo (haul card,
 * odometer, fuel receipts — everything) must be downloadable.
 *
 * Root cause: the one shared door (App._photoDl, js/app.js) was
 * an <a href="data:…" download> anchor. Android's WebView —
 * the native shell — ignores download anchors on data: URLs
 * entirely, so in the app the tap went nowhere; the queue's
 * note adds the path once leaned on a file host that was
 * removed. The fix keeps the one shared door but makes it a
 * real button: the photo is registered under a token and ONE
 * delegated click handler delivers it — in the native shell,
 * through the Capacitor Filesystem plugin to the phone's
 * Documents (the exact path MetPdf saves PDFs by,
 * js/pdfexport.js); in a plain browser, a Blob download. The
 * app hands the stored photo straight to the phone — no
 * external host anywhere in the path.
 *
 * Run: node tools/photo-download-v241-test.js
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

/* Extract the download door: the v241 block when present,
 * else the legacy helper alone (the RED baseline). */
function extractDoor() {
  const src = read('js/app.js');
  const m = src.indexOf('DOWNLOAD-BUTTON-DEAD');
  if (m !== -1) {
    const start = src.lastIndexOf('/*', m);
    const endMark = src.indexOf('DOWNLOAD-BUTTON-DEAD-END', m);
    if (start !== -1 && endMark !== -1) {
      return src.slice(start, src.indexOf('*/', endMark) + 2);
    }
  }
  const a = src.indexOf('App._photoDl = function');
  const b = src.indexOf('};', a);
  return src.slice(a, b + 2);
}
const PHOTO = 'data:image/jpeg;base64,QUJD';
function makeWorld(native) {
  const listeners = {};
  const writes = [];
  const anchors = [];
  const blobs = [];
  function FakeBlob(parts, opts) { this.parts = parts; this.type = opts && opts.type; blobs.push(this); }
  const doc = {
    addEventListener: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    createElement: function (tag) {
      const el = { tag: tag, href: '', download: '', clicked: false,
        click: function () { this.clicked = true; } };
      anchors.push(el);
      return el;
    },
    body: { appendChild: function () {}, removeChild: function () {} }
  };
  const sb = {
    App: {}, console: console, document: doc,
    setTimeout: setTimeout, atob: atob, Blob: FakeBlob,
    URL: { createObjectURL: function () { return 'blob:fake'; }, revokeObjectURL: function () {} }
  };
  sb.window = sb;
  if (native) {
    sb.Capacitor = {
      isNativePlatform: function () { return true; },
      Plugins: { Filesystem: {
        writeFile: function (opts) { writes.push(opts); return Promise.resolve({ uri: 'file:///docs/' + opts.path }); }
      } }
    };
  }
  vm.createContext(sb);
  vm.runInContext(extractDoor(), sb);
  return { sb: sb, listeners: listeners, writes: writes, anchors: anchors, blobs: blobs };
}
function tokenOf(html) {
  const m = /data-photodl="([^"]+)"/.exec(html || '');
  return m ? m[1] : null;
}
function clickBtn(w, token) {
  const btn = {
    textContent: '⬇ Download this photo',
    getAttribute: function (n) { return n === 'data-photodl' ? token : null; },
    closest: function () { return this; },
    parentNode: null
  };
  (w.listeners.click || []).forEach(function (fn) {
    fn({ target: btn, preventDefault: function () {} });
  });
  return btn;
}
function tick() { return new Promise(function (r) { setTimeout(r, 30); }); }

(async function () {
  /* ---- A: the door is a working button, not a dead anchor ---- */
  {
    const w = makeWorld(true);
    const html = w.sb.App._photoDl(PHOTO, 'dispatch-card');
    ok('A1 the door renders a button carrying a download token',
      html.indexOf('<button') === 0 && !!tokenOf(html), html);
    ok('A2 no data:-href anchor remains (the dead mechanism)',
      html.indexOf('href="data:') === -1, html);
    eq('A3 no photo -> no button', w.sb.App._photoDl(null, 'x'), '');
    eq('A4 non-data photo -> no button', w.sb.App._photoDl('https://example.com/x.jpg', 'x'), '');
  }

  /* ---- B: native shell — the tap writes the photo to Documents ---- */
  {
    const w = makeWorld(true);
    const html = w.sb.App._photoDl(PHOTO, 'dispatch-card');
    const btn = clickBtn(w, tokenOf(html));
    await tick();
    eq('B1 exactly one file is written', w.writes.length, 1);
    const wr = w.writes[0] || {};
    eq('B2 it lands in the phone\u2019s Documents', wr.directory, 'DOCUMENTS');
    eq('B3 under a Meticulous folder, named for the record', wr.path, 'Meticulous/meticulous-dispatch-card.jpg');
    eq('B4 the bytes are the stored photo\u2019s', wr.data, 'QUJD');
    ok('B5 the button confirms the save', btn.textContent.indexOf('Saved') !== -1, btn.textContent);
  }

  /* ---- C: plain browser — the tap downloads a Blob ---- */
  {
    const w = makeWorld(false);
    const html = w.sb.App._photoDl(PHOTO, 'fuel-receipt-2026-10-22');
    clickBtn(w, tokenOf(html));
    await tick();
    eq('C1 a Blob of the photo is built', w.blobs.length, 1);
    eq('C2 with the jpeg type', w.blobs.length && w.blobs[0].type, 'image/jpeg');
    const a = w.anchors.filter(function (x) { return x.tag === 'a'; })[0] || {};
    eq('C3 the temp anchor carries the record\u2019s filename', a.download, 'meticulous-fuel-receipt-2026-10-22.jpg');
    eq('C4 and is clicked', a.clicked, true);
    eq('C5 nothing is written through a native bridge in a browser', w.writes.length, 0);
  }

  /* ---- D: the surfaces still wire the one shared door ---- */
  {
    ok('D1 dispatch ticket photos (4 record views)',
      (read('modules/dispatch.js').match(/App\._photoDl\(/g) || []).length >= 4);
    ok('D2 fuel receipt detail', read('modules/fuel.js').indexOf("App._photoDl(dRec.photo, 'fuel-receipt-'") !== -1);
    ok('D3 pti photos (filed + defect views)',
      (read('modules/pti.js').match(/App\._photoDl\(/g) || []).length >= 2);
    ok('D4 damage record photo', read('modules/damage.js').indexOf("App._photoDl(r.photo, 'damage-'") !== -1);
  }

  console.log('\nphoto-download-v241 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
