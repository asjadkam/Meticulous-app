#!/usr/bin/env node
/* Meticulous — ROUTE-SHEET-UPLOAD-CONFIRMATION-NOV8.
 *
 * THE RULING (Nov 8, 2026, 19:24 CST), Asjad watching Nirojini
 * use the route-sheet upload: "There should be a confirmation
 * step!" Until today (webs 381/382/384) one upload read the
 * file and saved both runs immediately — setRouteSheet ran
 * inside the read's own completion, and the route became her
 * standing dispatch without her ever seeing what the app read.
 *
 * THE FIX (modules/dispatch.js only): a successful file-door
 * read now STAGES. The confirmation stands in the Route sheets
 * card's place: each run the file carried, by name — its stops
 * in order, by their sheet names, and the kid count its
 * roster carries — then a quiet Cancel and, last and
 * unmissable, "✓ Save this route". The preview is built from
 * the split engine's OWN pure parsers over the very texts
 * Save hands setRouteSheet, so the card shows precisely what
 * a save would write. Save runs the pre-existing save loop
 * verbatim (same calls, same notes). Cancel writes nothing
 * and the saved route stands. Ambiguous and unreadable reads
 * keep the plain refusals — no card for a read that produced
 * nothing. The pending read lives in the render closure, so
 * leaving, repainting or relaunching discards it unsaved.
 * The per-run PHOTOGRAPH doors keep their immediate save —
 * out of scope here, parked as a question for the owner.
 *
 * LAYERS: (S) source pins for the gate's shape. (1) the real
 * fixture reaches the confirmation with the right runs, stops
 * and kids and writes NOTHING before Confirm. (2) Confirm
 * lands exactly the records a direct setRouteSheet lands,
 * with today's exact notes. (3)+(4) Cancel writes nothing —
 * with no route standing, and with one standing (byte-
 * identical store). (5)+(6) ambiguous / unreadable reads
 * still refuse, no card. (7) a pending read does not survive
 * a repaint. (8) a one-run read confirms and saves that run
 * only. (9) the photograph door still saves on the read.
 * Run: node tools/route-sheet-upload-confirmation-nov8-test.js
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

const REFUSAL = 'That file could not be read as a route sheet — nothing was saved. Upload the sheet file the company sent, or photograph the printed sheet.';
const TOLD_APART = 'That file’s runs could not be told apart — nothing was saved. Photograph each printed sheet above instead.';
const BOTH = 'Both routes saved — Morning 8 stops, afternoon 8 stops, in order. The day’s route follows this sheet.';
const AM_NOTE = 'Morning route saved — 8 stops, in order. The day’s route follows this sheet.';
const PM_NOTE = 'Afternoon route saved — 8 stops, in order. The day’s route follows this sheet.';
const CANCEL_NONE = 'Nothing was changed — that read was not saved.';
const CANCEL_STANDS = 'Nothing was changed — that read was not saved, and your saved route still stands.';

function sheetSnap(sb) {
  const rec = sb.store.get('splitshift', null);
  return JSON.stringify(rec);
}
function routeData(sb) {
  const rec = sb.store.get('splitshift', {}) || {};
  return JSON.stringify({ routeSheets: rec.routeSheets, routeRoster: rec.routeRoster });
}

/* ================= (S) source pins ================= */
console.log('(S) the gate’s shape, pinned in the source');
(function () {
  check('the pending read is staged in the render closure, not saved on the read',
    dspSrc.indexOf('var dpPendingSheet = null;') > -1 &&
    dspSrc.indexOf('dpPendingSheet = { text: text || \'\', runs: runs, preview: preview };') > -1);
  check('the confirmation is painted into the Route sheets card’s place',
    dspSrc.indexOf("body.querySelector('#dp_sheet_card')") > -1 &&
    dspSrc.indexOf('dpPaintSheetConfirm();') > -1);
  check('the card carries the ordered actions — quiet Cancel, then the one primary Save',
    (function () {
      const paint = region(dspSrc, 'function dpPaintSheetConfirm()', 'function dpSavePendingSheet()');
      return paint.indexOf('id="dp_sheet_cancel"') > -1 &&
        paint.indexOf('id="dp_sheet_confirm"') > paint.indexOf('id="dp_sheet_cancel"') &&
        paint.indexOf('✓ Save this route') > paint.indexOf('id="dp_sheet_cancel"');
    })());
  check('the preview is built from the engine’s own parsers (what Save will write)',
    dspSrc.indexOf('SplitShift._engine') > -1 &&
    dspSrc.indexOf('eng.parseRouteSheet') > -1 &&
    dspSrc.indexOf('eng.parseRouteRoster') > -1);
  eq('setRouteSheet is called from exactly two places: the photo doors and the Save tap',
    (dspSrc.match(/SplitShift\.setRouteSheet\(/g) || []).length, 2);
  check('the Save tap runs the pre-existing save call, verbatim',
    dspSrc.indexOf('SplitShift.setRouteSheet(rc[0], runs[rc[0]], sec382)') > -1);
  check('the photo doors’ immediate save stands untouched',
    dspSrc.indexOf("SplitShift.setRouteSheet) n = SplitShift.setRouteSheet(cfg[0], text || '');") > -1);
})();

(async function () {
  const box = {};
  vm.runInNewContext(region(dspSrc, '/* ROUTE-SHEET-FILE-BEGIN', '/* ROUTE-SHEET-FILE-END */') +
    '\nthis.__R = RouteSheetFile;', box);
  const R = box.__R;
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
  const fullText = pagesItems.map(function (items) { return R.linesFromItems(items).join('\n'); }).join('\n');
  const bundledNet = function () {
    return { srcs: [], allow: function (u) { return u.indexOf('js/vendor/') > -1; },
      lib: function () { return fakePdfLib(pagesItems); } };
  };
  function upload(w, file) {
    const inp = w.body.querySelector('#dp_sheet_file_in');
    inp.files = [file];
    inp.onchange();
    return flush(140);
  }
  function fixtureFile() {
    return fakeFile('route-CBE-0574_261108_162530_13_2dof.pdf', 'application/pdf', pdfBytes);
  }
  function card(w) { return w.body.querySelector('#dp_sheet_card'); }

  /* ============ (1) the read stages; nothing is written ============ */
  console.log('(1) one upload of the fixture reaches the confirmation — and writes nothing');
  const w1 = makeWorld({ net: bundledNet() });
  w1.render();
  const snap1Before = sheetSnap(w1.sb);
  await upload(w1, fixtureFile());
  eq('before Confirm: no route is saved', w1.sb.SplitShift.routeSheetInfo(), { am: 0, pm: 0 });
  eq('before Confirm: the split store is byte-identical', sheetSnap(w1.sb), snap1Before);
  const h1 = card(w1)._html;
  check('the confirmation stands in the card’s place', h1.indexOf('Check this route sheet') > -1);
  check('it names the morning run with its stops and kids',
    h1.indexOf('Morning route — 8 stops · 6 kids') > -1, h1.slice(0, 400));
  check('it names the afternoon run with its stops and kids',
    h1.indexOf('Afternoon route — 8 stops · 6 kids') > -1);
  check('the morning stops stand in sheet order',
    h1.indexOf('321 21 Ave SW') > -1 &&
    h1.indexOf('321 21 Ave SW') < h1.indexOf('Glendale School') &&
    h1.indexOf('Glendale School') < h1.indexOf('Afternoon route — 8 stops'));
  check('the afternoon stops stand in sheet order',
    h1.indexOf('Afternoon route — 8 stops') < h1.indexOf('2:35 PM — Wildwood School') &&
    h1.indexOf('2:35 PM — Wildwood School') < h1.indexOf('3:25 PM — 2702 43 St SW'));
  check('the Save button stands below every stop (the one primary, at the bottom)',
    h1.indexOf('id="dp_sheet_confirm"') > h1.indexOf('3:25 PM — 2702 43 St SW'));
  check('the file note never claimed a save', w1.body.querySelector('#dp_sheet_file_note').textContent !== BOTH);

  /* ============ (2) Confirm lands exactly today's records ============ */
  console.log('(2) Confirm — the same records the direct save lands, the same notes');
  const wB = makeWorld({ net: bundledNet() });
  const runsB = R.runsFromText(fullText);
  wB.sb.SplitShift.setRouteSheet('am', runsB.am, R.sliceShift(fullText, 'am') || '');
  wB.sb.SplitShift.setRouteSheet('pm', runsB.pm, R.sliceShift(fullText, 'pm') || '');
  await flush(140);
  card(w1).querySelector('#dp_sheet_confirm').onclick();
  await flush(140);
  eq('after Confirm: both routes stand', w1.sb.SplitShift.routeSheetInfo(), { am: 8, pm: 8 });
  eq('after Confirm: routes + rosters equal the direct save’s, exactly',
    routeData(w1.sb), routeData(wB.sb));
  eq('the file note speaks today’s both-routes words',
    w1.body.querySelector('#dp_sheet_file_note').textContent, BOTH);
  eq('the morning note speaks today’s words',
    w1.body.querySelector('#dp_sheet_am_note').textContent, AM_NOTE);
  eq('the afternoon note speaks today’s words',
    w1.body.querySelector('#dp_sheet_pm_note').textContent, PM_NOTE);
  check('the card is the intake card again after the save',
    w1.body._html.indexOf('Upload the route sheet file') > -1);

  /* ============ (3) Cancel, nothing standing ============ */
  console.log('(3) Cancel — nothing written, nothing standing');
  const w3 = makeWorld({ net: bundledNet() });
  w3.render();
  const snap3Before = sheetSnap(w3.sb);
  await upload(w3, fixtureFile());
  check('the read staged (card is the confirmation)', card(w3)._html.indexOf('Check this route sheet') > -1);
  card(w3).querySelector('#dp_sheet_cancel').onclick();
  await flush(60);
  eq('after Cancel: no route is saved', w3.sb.SplitShift.routeSheetInfo(), { am: 0, pm: 0 });
  eq('after Cancel: the split store is byte-identical', sheetSnap(w3.sb), snap3Before);
  eq('the note says plainly that nothing was changed',
    w3.body.querySelector('#dp_sheet_file_note').textContent, CANCEL_NONE);
  check('the card is the intake card again after Cancel',
    w3.body._html.indexOf('Upload the route sheet file') > -1);

  /* ============ (4) Cancel, a route standing ============ */
  console.log('(4) Cancel — the route she had stands byte-identical');
  const w4 = makeWorld({ net: bundledNet() });
  w4.render();
  await upload(w4, fixtureFile());
  card(w4).querySelector('#dp_sheet_confirm').onclick();
  await flush(140);
  eq('setup: the route stands', w4.sb.SplitShift.routeSheetInfo(), { am: 8, pm: 8 });
  const snap4Before = sheetSnap(w4.sb);
  await upload(w4, fixtureFile());
  check('the second read staged over the standing route',
    card(w4)._html.indexOf('Check this route sheet') > -1);
  eq('…and the standing route is untouched while she checks',
    sheetSnap(w4.sb), snap4Before);
  card(w4).querySelector('#dp_sheet_cancel').onclick();
  await flush(60);
  eq('after Cancel: the split store is byte-identical', sheetSnap(w4.sb), snap4Before);
  eq('the note says her saved route still stands',
    w4.body.querySelector('#dp_sheet_file_note').textContent, CANCEL_STANDS);

  /* ============ (5) ambiguous read — refusal, no card ============ */
  console.log('(5) an ambiguous read refuses plainly and shows no confirmation');
  const w5 = makeWorld({ net: bundledNet() });
  w5.sb.pdfjsLib = fakePdfLib(pagesItems);
  w5.sb.TicketOCR.recognizeWithRotation = function () {
    return Promise.resolve('7:30 321 21 Ave SW, Calgary\n8:05 Wildwood School, Calgary');
  };
  w5.render();
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4, 5, 6, 7, 8]);
  await upload(w5, fakeFile('sheet.png', 'image/png', pngBytes));
  eq('the runs-could-not-be-told-apart refusal speaks',
    w5.body.querySelector('#dp_sheet_file_note').textContent, TOLD_APART);
  check('no confirmation was shown', card(w5)._html.indexOf('dp_sheet_confirm') === -1);
  eq('nothing was saved', w5.sb.SplitShift.routeSheetInfo(), { am: 0, pm: 0 });

  /* ============ (6) unreadable read — refusal, no card ============ */
  console.log('(6) an unreadable file refuses plainly and shows no confirmation');
  const w6 = makeWorld({ net: bundledNet() });
  w6.sb.pdfjsLib = fakePdfLib(pagesItems);
  w6.sb.TicketOCR.recognizeWithRotation = function () { return Promise.resolve(''); };
  w6.render();
  const txt = new TextEncoder().encode('Quarterly Newsletter\nLunch at the office party on Friday\nBring a sandwich and a drink');
  await upload(w6, fakeFile('notes.txt', 'text/plain', txt));
  eq('the could-not-be-read refusal speaks',
    w6.body.querySelector('#dp_sheet_file_note').textContent, REFUSAL);
  check('no confirmation was shown', card(w6)._html.indexOf('dp_sheet_confirm') === -1);
  eq('nothing was saved', w6.sb.SplitShift.routeSheetInfo(), { am: 0, pm: 0 });

  /* ============ (7) the pending read dies with its paint ============ */
  console.log('(7) a pending read does not survive a repaint into a save');
  const w7 = makeWorld({ net: bundledNet() });
  w7.render();
  const snap7Before = sheetSnap(w7.sb);
  await upload(w7, fixtureFile());
  check('the read staged', card(w7)._html.indexOf('Check this route sheet') > -1);
  w7.render(); /* leaving and coming back repaints the module */
  await flush(60);
  eq('after the repaint: still nothing saved', w7.sb.SplitShift.routeSheetInfo(), { am: 0, pm: 0 });
  eq('after the repaint: the split store is byte-identical', sheetSnap(w7.sb), snap7Before);
  check('the fresh paint is the intake card — no confirmation resurrected',
    w7.body._html.indexOf('Upload the route sheet file') > -1 &&
    w7.body._html.indexOf('Save this route') === -1);

  /* ============ (8) a one-run read ============ */
  console.log('(8) a PM-only read confirms and saves that run only');
  const w8 = makeWorld({ net: bundledNet() });
  w8.sb.pdfjsLib = fakePdfLib(pagesItems);
  w8.sb.TicketOCR.recognizeWithRotation = function () {
    return Promise.resolve('PM Shift\n02:35 PM Wildwood School • 120 45 St SW, Calgary\n03:03 PM 321 21 Ave SW, Calgary');
  };
  w8.render();
  await upload(w8, fakeFile('sheet.png', 'image/png', pngBytes));
  const h8 = card(w8)._html;
  check('the confirmation names only the afternoon run',
    h8.indexOf('Afternoon route — 2 stops') > -1 && h8.indexOf('Morning route') === -1, h8.slice(0, 300));
  eq('before Confirm: nothing saved', w8.sb.SplitShift.routeSheetInfo(), { am: 0, pm: 0 });
  card(w8).querySelector('#dp_sheet_confirm').onclick();
  await flush(140);
  eq('after Confirm: the afternoon route only', w8.sb.SplitShift.routeSheetInfo(), { am: 0, pm: 2 });
  eq('the file note speaks today’s one-run words',
    w8.body.querySelector('#dp_sheet_file_note').textContent,
    'Afternoon route saved — 2 stops, in order. The day’s route follows this sheet.');

  /* ============ (9) the photograph doors are untouched ============ */
  console.log('(9) the photograph door still saves on the read (out of scope, by the ruling)');
  const w9 = makeWorld({ net: bundledNet() });
  w9.sb.TicketOCR.recognizeWithRotation = function () { return Promise.resolve(runsB.am); };
  w9.render();
  const amIn = w9.body.querySelector('#dp_sheet_am_in');
  amIn.files = [fakeFile('sheet.jpg', 'image/jpeg', new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]))];
  amIn.onchange();
  await flush(140);
  eq('a photographed AM sheet saves at once, no confirmation',
    w9.sb.SplitShift.routeSheetInfo(), { am: 8, pm: 0 });

  console.log('\nROUTE-SHEET-UPLOAD-CONFIRMATION NOV8: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
})().catch(function (e) { console.error('SUITE ERROR', e); process.exit(2); });
