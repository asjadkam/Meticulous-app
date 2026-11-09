#!/usr/bin/env node
/* Meticulous — ROUTE-SHEET-UPLOAD-FAILS-ON-PHONE-NOV8.
 *
 * THE REPORT (Nov 8, 2026, 18:31 CST): Asjad photographed
 * Nirojini's phone. Her Dispatch shows the Route sheets card
 * (webs 381/382 live in her hands) and under the "Upload the
 * route sheet file" door the note: "That file could not be read
 * as a route sheet — nothing was saved." She tried the upload;
 * it refused. The bench's own sample (tools/fixtures/
 * route-CBE-0574.pdf, a 9-page text-layer PDF) parsed clean on
 * the bench — so the file format was never the problem; a hop
 * in the PHONE-side path was.
 *
 * THE BENCH (real Chromium 157, the app's verbatim code, the
 * real fixture):
 *  - HOP 1, THE READER LOAD — CONVICTED. The PDF reader was
 *    fetched from cdn.jsdelivr.net at upload time. Online, the
 *    verbatim chain saves the sample (8 AM + 8 PM stops). With
 *    the CDN lib unreachable it rejects ("the PDF reader could
 *    not be loaded"); with only the WORKER unreachable it
 *    rejects again ("Setting up fake worker failed") — and in
 *    every failure shape the wiring's catch went straight to
 *    the refusal: the photographed note, byte for byte. The OCR
 *    fallback hung off the SUCCESS branch only, and itself
 *    needed the same reader. The rejected load promise was also
 *    cached for the life of the page, so retrying in the same
 *    session could never recover. The 381 suites never saw any
 *    of this: they pre-seed window.pdfjsLib, so the load hop
 *    they shipped was never the load hop the phone runs.
 *  - HOP 3, THE PICKER'S LABELS — CONVICTED as a second door to
 *    the same note. Routing trusted file.type / file.name. A
 *    PDF with an extension-less name and an empty/octet-stream
 *    type (a shape phone content providers produce) routed to
 *    the photo reader, and the browser cannot decode PDF bytes
 *    as an image (createImageBitmap rejects; <img> errors) —
 *    the read died and the same refusal spoke. An image wearing
 *    a .pdf name died the mirror way inside getDocument.
 *  - HOP 2, THE IMAGE/OCR READ — EXONERATED by measurement.
 *    Real Tesseract over the rendered rideveza pages (fixture:
 *    tools/fixtures/route-CBE-0574-ocr-pages.txt) sorts to the
 *    correct 8 AM + 8 PM stops through the shipped sorter, and
 *    page 1 alone yields its AM stop — a partial save, never
 *    the photographed refusal. The parser was never the defect.
 *    (Which file she actually picked — PDF or image — is not
 *    known; the fix covers both convicted doors regardless.)
 *
 * THE FIX (modules/dispatch.js + js/vendor/):
 *  - The reader ships WITH the app: js/vendor/pdf.min.js +
 *    pdf.worker.min.js (PDF.js 3.11.174, the build the bench
 *    validates). dpPdfJs loads the bundled copy FIRST
 *    (same-origin — no network, and a same-origin worker, so no
 *    cross-origin wrapper); the CDN copy remains as backstop.
 *    A failed load is no longer cached.
 *  - Routing sniffs the file's own first bytes
 *    (RouteSheetFile.sniffKind): %PDF magic takes the PDF path
 *    and image magic takes the photo path, whatever the picker
 *    called them; only an unrecognised file falls back to the
 *    label test.
 *  - A PDF text read that REJECTS now falls back to the
 *    page-OCR read before anything is refused. A genuinely
 *    unreadable file still refuses plainly, and a failed read
 *    still never touches a saved route.
 *
 * LAYERS: (A) the pure sniffer. (B) the measured OCR corpus
 * through the shipped sorter (hop 2's health, pinned). (C) the
 * real Dispatch wiring in worlds whose document stub makes
 * script loads succeed or fail per scenario: bundled reader
 * with the CDN dead (the phone's failure, now saving), CDN
 * backstop, the mislabelled PDF, the image in PDF clothing,
 * the text-read failure falling back to OCR, total load
 * failure refusing honestly — then recovering on retry — and
 * a garbage file still refusing with saved routes standing.
 * Run: node tools/route-sheet-upload-phone-nov8-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const dspSrc = read('modules/dispatch.js');
const appSrc = read('js/app.js');
const splitSrc = read('js/splitshift.js');
const ocrSrc = read('js/ticket-ocr.js');
const invSrc = read('modules/invoice.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function flush(n) {
  return new Promise(function (res) {
    let i = 0;
    (function step() { if (++i > (n || 80)) return res(); setTimeout(step, 0); })();
  });
}
function region(src, begin, end) {
  const i = src.indexOf(begin), j = src.indexOf(end);
  if (i < 0 || j < 0 || j < i) throw new Error('region not found: ' + begin);
  return src.slice(i, j + end.length);
}

/* ================= shared fake DOM (v186/v378 pattern) ================= */
function FakeEl(sel) {
  this._sel = sel || '';
  this._kids = {};
  this._html = '';
  this.value = '';
  this.textContent = '';
  this.style = {};
  this.files = [];
  this.onclick = null;
  this.onchange = null;
  this.onload = null;
  this.onerror = null;
  this.src = '';
  this._listeners = {};
  this.options = [{ text: '' }];
  this.selectedIndex = 0;
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
FakeEl.prototype.scrollIntoView = function () {};
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };
FakeEl.prototype.click = function () {};
function FakeFileReader() {}
FakeFileReader.prototype.readAsDataURL = function () {
  const self = this;
  self.result = 'data:image/jpeg;base64,RAWDATA';
  queueMicrotask(function () { if (self.onload) self.onload(); });
};
function FakeImage() {}
Object.defineProperty(FakeImage.prototype, 'src', {
  get: function () { return ''; },
  set: function () {
    const self = this;
    self.width = 800; self.height = 600;
    queueMicrotask(function () { if (self.onload) self.onload(); });
  }
});
function makeLocal() {
  const backing = { mem: {}, fail: false };
  return {
    backing: backing,
    getItem: function (k) { return (k in backing.mem) ? backing.mem[k] : null; },
    setItem: function (k, v) { backing.mem[k] = String(v); },
    removeItem: function (k) { delete backing.mem[k]; }
  };
}
function extractStore() {
  const i = appSrc.indexOf('var store = {');
  if (i === -1) throw new Error('store not found in js/app.js');
  let depth = 0, j = i;
  for (; j < appSrc.length; j++) {
    if (appSrc[j] === '{') depth++;
    else if (appSrc[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return appSrc.slice(i, j) + ';';
}
function extractRegion(src, beginMark, endMark) {
  const bi = src.indexOf(beginMark), ei = src.indexOf(endMark);
  if (bi === -1 || ei === -1) throw new Error('region markers missing: ' + beginMark);
  return src.slice(src.lastIndexOf('/*', bi), src.indexOf('*/', ei) + 2);
}
function makePipeStub() {
  return {
    connectedPeers: function () { return []; },
    dateShift: function (d) { return d; },
    pullInbox: function () { return Promise.resolve(0); },
    markSeen: function () {},
    fetchCrew: function () { return Promise.resolve([]); },
    fetchRecords: function () { return Promise.resolve({ records: {}, billing: {} }); },
    listSent: function () { return Promise.resolve([]); },
    sendDispatchToMany: function () { return Promise.resolve({ sent: [], failed: [] }); }
  };
}

/* A world whose document stub ANSWERS script loads per the
 * scenario: net.allow(url) decides, net.lib() is the pdfjsLib a
 * successful load installs. Every requested src is recorded. */
function makeWorld(opts) {
  const local = makeLocal();
  const net = opts.net || { allow: function () { return false; }, lib: function () { return null; }, srcs: [] };
  const doc = {
    createElement: function (tag) {
      if (tag === 'canvas') {
        return { width: 0, height: 0,
          getContext: function () { return { drawImage: function () {} }; },
          toDataURL: function () { return 'data:image/jpeg;base64,THUMB'; } };
      }
      return new FakeEl(tag);
    },
    head: { appendChild: function (s) {
      net.srcs.push(s.src);
      setTimeout(function () {
        if (net.allow(s.src)) { sb.pdfjsLib = net.lib(); if (s.onload) s.onload(); }
        else if (s.onerror) s.onerror();
      }, 0);
    } },
    querySelector: function () { return null; },
    addEventListener: function () {}
  };
  const sb = {
    console: console, document: doc, localStorage: local,
    FileReader: FakeFileReader, Image: FakeImage, setTimeout: setTimeout,
    alert: function () {},
    confirm: function () { return true; },
    URL: { createObjectURL: function () { return 'blob:fake'; }, revokeObjectURL: function () {} },
    Meticulous: { modules: {} }
  };
  sb.window = sb;
  sb.App = {
    _store: null,
    _today: function () { return '2026-11-08'; },
    _esc: function (s) { return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    userRole: function () { return opts.role || 'driver'; },
    openModule: function () {},
    tracker: { splitDay: false, status: 'idle' }
  };
  sb.LiveMiles = { subscribe: function () {}, getLastFix: function () { return null; } };
  sb.ConnectPipe = makePipeStub();
  vm.createContext(sb);
  vm.runInContext(extractStore(), sb);
  sb.App._store = sb.store;
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(splitSrc, sb);
  vm.runInContext(dspSrc, sb);
  sb.store.set('onboarding', { userRole: 'driver', firstName: 'Nirojini', lastName: 'K',
    accountType: 'Driver', workPattern: 'split' });
  sb.store.set('dsp_list', []);
  sb.store.set('dsp_active', null);
  const body = new FakeEl('body');
  return { sb: sb, body: body, net: net,
    render: function () { sb.Meticulous.modules.dispatch.render(body); } };
}

/* A fake File with real bytes behind it — arrayBuffer and the
 * slice().arrayBuffer() the sniffer reads. */
function fakeFile(name, type, bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return {
    name: name, type: type,
    arrayBuffer: function () { return Promise.resolve(u8.slice().buffer); },
    slice: function (a, b) {
      const sub = u8.slice(a, b);
      return { arrayBuffer: function () { return Promise.resolve(sub.slice().buffer); } };
    }
  };
}
function fakePdfLib(pagesItems) {
  return {
    GlobalWorkerOptions: {},
    getDocument: function () {
      return { promise: Promise.resolve({
        numPages: pagesItems.length,
        getPage: function (pn) {
          return Promise.resolve({
            getTextContent: function () { return Promise.resolve({ items: pagesItems[pn - 1] }); }
          });
        }
      }) };
    }
  };
}

/* ================= (A) the pure sniffer ================= */
console.log('(A) RouteSheetFile.sniffKind — content, not labels');
(function () {
  const box = {};
  vm.runInNewContext(region(dspSrc, '/* ROUTE-SHEET-FILE-BEGIN', '/* ROUTE-SHEET-FILE-END */') +
    '\nthis.__R = RouteSheetFile;', box);
  const R = box.__R;
  check('the sniffer exists on the pure block', !!R && typeof R.sniffKind === 'function');
  const U = (arr) => new Uint8Array(arr);
  eq('%PDF- magic is a PDF', R.sniffKind(U([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37])), 'pdf');
  eq('JPEG magic is an image', R.sniffKind(U([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10])), 'image');
  eq('PNG magic is an image', R.sniffKind(U([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A])), 'image');
  eq('GIF magic is an image', R.sniffKind(U([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), 'image');
  eq('WEBP magic is an image', R.sniffKind(U([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), 'image');
  eq('plain text is unrecognised (labels decide)', R.sniffKind(U([0x51, 0x75, 0x61, 0x72, 0x74])), '');
  eq('a short buffer is unrecognised', R.sniffKind(U([0x25, 0x50])), '');
  eq('nothing in, nothing claimed', R.sniffKind(null), '');
  check('source pins: the reader is bundled with the app, CDN kept as backstop',
    dspSrc.indexOf("lib: 'js/vendor/pdf.min.js'") > -1 &&
    dspSrc.indexOf("worker: 'js/vendor/pdf.worker.min.js'") > -1 &&
    dspSrc.indexOf('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js') > -1);
  check('source pins: vendored reader files stand in the tree',
    fs.existsSync(path.join(ROOT, 'js/vendor/pdf.min.js')) &&
    fs.existsSync(path.join(ROOT, 'js/vendor/pdf.worker.min.js')));
  check('source pins: a failed load is forgotten, never cached',
    dspSrc.indexOf('dpPdfJsPromise = null; throw e;') > -1);
  check('source pins: the wiring sniffs before it routes',
    dspSrc.indexOf('RouteSheetFile.sniffKind(new Uint8Array(buf))') > -1);
  check('source pins: a rejected text read falls back to the page-OCR read',
    (dspSrc.match(/dpSheetPdfOcr\(f\)\.then\(done\)/g) || []).length >= 2);
})();

/* ================= (B) the measured OCR corpus ================= */
(async function () {
  console.log('(B) hop 2, measured: real Tesseract OCR of the real sheet through the shipped sorter');
  const box = {};
  vm.runInNewContext(region(dspSrc, '/* ROUTE-SHEET-FILE-BEGIN', '/* ROUTE-SHEET-FILE-END */') +
    '\nthis.__R = RouteSheetFile;', box);
  const R = box.__R;
  const engBox = {};
  vm.runInNewContext(region(splitSrc, '/* SPLIT-ENGINE-BEGIN', '/* SPLIT-ENGINE-END */') +
    '\nthis.__E = ENGINE;', engBox);
  const E = engBox.__E;
  const corpus = read('tools/fixtures/route-CBE-0574-ocr-pages.txt');
  const pages = corpus.split(/=== PAGE \d+ ===\n/).slice(1);
  eq('the corpus is the 9 rendered pages', pages.length, 9);
  const all = R.runsFromText(pages.join('\n'));
  eq('the whole-document OCR sorts to the sheet’s AM stops',
    E.parseRouteSheet(all.am).length, 8);
  eq('the whole-document OCR sorts to the sheet’s PM stops',
    E.parseRouteSheet(all.pm).length, 8);
  const p1 = R.runsFromText(pages[0]);
  check('page 1 alone yields its AM stop — a partial save, never the refusal',
    E.parseRouteSheet(p1.am).length >= 1 && p1.ambiguous === false);

  /* ============ (C) the wiring, phone conditions ============ */
  console.log('(C) the file door under phone conditions');
  const pdfjsLibNode = require(path.join(ROOT, 'tools', 'bench-env', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.js'));
  const pdfBytes = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tools', 'fixtures', 'route-CBE-0574.pdf')));
  const doc = await pdfjsLibNode.getDocument({ data: pdfBytes }).promise;
  const pagesItems = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pagesItems.push(tc.items.map(function (it) {
      return { str: it.str, transform: it.transform.slice(), width: it.width, height: it.height };
    }));
  }
  const REFUSAL = 'That file could not be read as a route sheet — nothing was saved. Upload the sheet file the company sent, or photograph the printed sheet.';
  const BOTH = 'Both routes saved — Morning 8 stops, afternoon 8 stops, in order. The day’s route follows this sheet.';
  function upload(w, file) {
    const inp = w.body.querySelector('#dp_sheet_file_in');
    inp.files = [file];
    inp.onchange();
    return flush(140);
  }

  /* C1: the phone's failure, fixed — CDN dead, bundled reader serves */
  {
    const net = { srcs: [], allow: function (u) { return u.indexOf('js/vendor/') > -1; },
      lib: function () { return fakePdfLib(pagesItems); } };
    const w = makeWorld({ net: net });
    w.render();
    await upload(w, fakeFile('route-CBE-0574_261108_162530_13_2dof.pdf', 'application/pdf', pdfBytes));
    eq('CDN dead + bundled reader: ONE upload fills BOTH routes', w.sb.SplitShift.routeSheetInfo(), { am: 8, pm: 8 });
    eq('CDN dead + bundled reader: the note speaks the both-routes words',
      w.body.querySelector('#dp_sheet_file_note').textContent, BOTH);
    eq('the bundled reader was asked FIRST', net.srcs[0], 'js/vendor/pdf.min.js');
    check('the CDN was never touched', net.srcs.every(function (s) { return s.indexOf('jsdelivr') === -1; }),
      JSON.stringify(net.srcs));
    check('the worker stands on the same shelf as the reader',
      w.sb.pdfjsLib.GlobalWorkerOptions.workerSrc === 'js/vendor/pdf.worker.min.js',
      String(w.sb.pdfjsLib.GlobalWorkerOptions.workerSrc));
  }

  /* C2: bundled copy dead too — the CDN backstop carries it */
  {
    const net = { srcs: [], allow: function (u) { return u.indexOf('jsdelivr') > -1; },
      lib: function () { return fakePdfLib(pagesItems); } };
    const w = makeWorld({ net: net });
    w.render();
    await upload(w, fakeFile('route-CBE-0574_261108_162530_13_2dof.pdf', 'application/pdf', pdfBytes));
    eq('bundled dead + CDN alive: the backstop fills BOTH routes', w.sb.SplitShift.routeSheetInfo(), { am: 8, pm: 8 });
    eq('the load order was bundled, then CDN', net.srcs,
      ['js/vendor/pdf.min.js', 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js']);
    check('the worker follows the shelf that served',
      w.sb.pdfjsLib.GlobalWorkerOptions.workerSrc.indexOf('jsdelivr') > -1);
  }

  /* C3: the picker's labels lie — the bytes decide */
  {
    const net = { srcs: [], allow: function () { return true; }, lib: function () { return fakePdfLib(pagesItems); } };
    const w = makeWorld({ net: net });
    w.sb.pdfjsLib = fakePdfLib(pagesItems);
    let ocrCalled = false;
    w.sb.TicketOCR.recognizeWithRotation = function () { ocrCalled = true; return Promise.resolve(''); };
    w.render();
    await upload(w, fakeFile('1699238471', '', pdfBytes));
    eq('extension-less, typeless PDF: sniffed as PDF, BOTH routes saved', w.sb.SplitShift.routeSheetInfo(), { am: 8, pm: 8 });
    check('…and the photo reader was never asked to decode it', ocrCalled === false);
    const w2 = makeWorld({ net: net });
    w2.sb.pdfjsLib = fakePdfLib(pagesItems);
    w2.render();
    await upload(w2, fakeFile('sheet', 'application/octet-stream', pdfBytes));
    eq('octet-stream PDF: sniffed as PDF, BOTH routes saved', w2.sb.SplitShift.routeSheetInfo(), { am: 8, pm: 8 });
  }

  /* C4: an image wearing a .pdf name takes the photo path */
  {
    const net = { srcs: [], allow: function () { return true; }, lib: function () { return fakePdfLib(pagesItems); } };
    const w = makeWorld({ net: net });
    w.sb.pdfjsLib = fakePdfLib(pagesItems);
    let ocrSaw = null;
    w.sb.TicketOCR.recognizeWithRotation = function (img) {
      ocrSaw = img;
      return Promise.resolve('PM Shift\n02:35 PM Wildwood School • 120 45 St SW, Calgary\n03:03 PM 321 21 Ave SW, Calgary');
    };
    w.render();
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4, 5, 6, 7, 8]);
    await upload(w, fakeFile('sheet.pdf', 'application/pdf', pngBytes));
    check('PNG bytes in .pdf clothing: the photo reader got the file', ocrSaw !== null);
    eq('…and its runs saved through the sorter', w.sb.SplitShift.routeSheetInfo(), { am: 0, pm: 2 });
  }

  /* C5: the text read rejects — the page-OCR read carries it */
  {
    let docCalls = 0;
    const flakyLib = {
      GlobalWorkerOptions: {},
      getDocument: function () {
        docCalls++;
        if (docCalls === 1) return { promise: Promise.reject(new Error('text layer would not extract')) };
        return { promise: Promise.resolve({
          numPages: 1,
          getPage: function () {
            return Promise.resolve({
              getViewport: function () { return { width: 100, height: 100 }; },
              render: function () { return { promise: Promise.resolve() }; },
              getTextContent: function () { return Promise.resolve({ items: [] }); }
            });
          }
        }) };
      }
    };
    const net = { srcs: [], allow: function () { return true; }, lib: function () { return flakyLib; } };
    const w = makeWorld({ net: net });
    w.sb.pdfjsLib = flakyLib;
    let ocrPages = 0;
    const fullText = pagesItems.map(function (items) { return R.linesFromItems(items).join('\n'); }).join('\n');
    w.sb.TicketOCR.recognize = function () { ocrPages++; return Promise.resolve(fullText); };
    w.render();
    await upload(w, fakeFile('route-CBE-0574_261108_162530_13_2dof.pdf', 'application/pdf', pdfBytes));
    check('text read rejected: the OCR read was tried', ocrPages >= 1);
    check('…the document was opened again for the OCR read', docCalls >= 2);
    eq('…and the sheet still saved', w.sb.SplitShift.routeSheetInfo().am + w.sb.SplitShift.routeSheetInfo().pm > 0, true);
  }

  /* C6: every load fails — honest refusal; the retry recovers */
  {
    const net = { srcs: [], allow: function () { return false; }, lib: function () { return fakePdfLib(pagesItems); } };
    const w = makeWorld({ net: net });
    w.render();
    await upload(w, fakeFile('route-CBE-0574_261108_162530_13_2dof.pdf', 'application/pdf', pdfBytes));
    eq('all reader loads dead: the refusal still speaks plainly',
      w.body.querySelector('#dp_sheet_file_note').textContent, REFUSAL);
    eq('…and nothing was saved', w.sb.SplitShift.routeSheetInfo(), { am: 0, pm: 0 });
    net.allow = function (u) { return u.indexOf('js/vendor/') > -1; };
    await upload(w, fakeFile('route-CBE-0574_261108_162530_13_2dof.pdf', 'application/pdf', pdfBytes));
    eq('the failure was not cached: the next upload tries fresh and saves',
      w.sb.SplitShift.routeSheetInfo(), { am: 8, pm: 8 });
  }

  /* C7: a garbage file still refuses, and saved routes stand */
  {
    const net = { srcs: [], allow: function () { return true; }, lib: function () { return fakePdfLib(pagesItems); } };
    const w = makeWorld({ net: net });
    w.sb.pdfjsLib = fakePdfLib(pagesItems);
    w.sb.TicketOCR.recognizeWithRotation = function () { return Promise.resolve(''); };
    w.render();
    await upload(w, fakeFile('route-CBE-0574_261108_162530_13_2dof.pdf', 'application/pdf', pdfBytes));
    eq('setup: the good sheet saved', w.sb.SplitShift.routeSheetInfo(), { am: 8, pm: 8 });
    const txt = new TextEncoder().encode('Quarterly Newsletter\nLunch at the office party on Friday\nBring a sandwich and a drink');
    await upload(w, fakeFile('notes.txt', 'text/plain', txt));
    eq('a genuinely unrelated file refuses plainly',
      w.body.querySelector('#dp_sheet_file_note').textContent, REFUSAL);
    eq('…and the saved routes stand untouched', w.sb.SplitShift.routeSheetInfo(), { am: 8, pm: 8 });
  }

  console.log('\nROUTE-SHEET-UPLOAD-PHONE NOV8: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
})().catch(function (e) { console.error('SUITE ERROR', e); process.exit(2); });
