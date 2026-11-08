#!/usr/bin/env node
/* Meticulous v380 — ROUTE-SHEET-FILE-UPLOAD-NOV8.
 *
 * Four owner orders, Nov 8, 2026:
 *  (1) 16:38 CST — he holds Nirojini's route sheet as a PDF file
 *      and asks where it uploads for her: "just like there is a
 *      text I can copy paste there has to be an option to upload
 *      the file!" The intake (v355 addendum 5) was a PHOTO-ONLY
 *      door — a camera input feeding TicketOCR. The PDF the bus
 *      company actually sends had no way in.
 *  (2) 16:43 CST — the PLACEMENT CORRECTION, verbatim: "It
 *      should be In the Dispatch." The intake lived on the
 *      Preferences Pay card; the route sheet is part of the
 *      day's dispatch, and Dispatch is where she will look.
 *  (3) 16:47 CST — "If file has them both": a file carrying
 *      BOTH runs fills BOTH routes from one upload, each run's
 *      stops sorted into its own sheet by the file's own
 *      markings; runs that cannot be told apart save nothing.
 *  (4) 16:48 CST — "Why would a user upload 2 separate": the
 *      file door is ONE door, not one per run. The Photograph
 *      doors stay per run (a photo is of one printed sheet);
 *      the file is uploaded ONCE and the app sorts the runs.
 *
 * THE SAMPLE, examined honestly: tools/fixtures/route-CBE-0574.pdf
 * is the company's own export (rideveza "Route Details", route
 * CBE-0574, 4Seasons Transportation) — 9 pages WITH A TEXT LAYER
 * (~7,300 characters), carrying THREE runs in one file: AM,
 * NOON and PM shifts. The app's route model is two runs (AM/PM
 * doors); NOON has no door and is never saved.
 *
 * THE FIX (modules/dispatch.js; the Preferences card REMOVED in
 * the same fix — a move, not a copy):
 *  - A "🚌 Route sheets" card stands in the driver's own Dispatch
 *    face directly under the Today's dispatch card, gated to
 *    non-office split-pattern accounts (the faces that saw it in
 *    Preferences). Per run: the Photograph door (the v355 wiring,
 *    unchanged). Under both runs: ONE Upload door for the sheet
 *    file (PDF or image file, no camera) — there is no per-run
 *    file door and no flow that asks her to split the file.
 *  - Reads: an image file takes the photo reader untouched; a
 *    PDF with a text layer is read as text; a PDF with no text
 *    layer is rendered page by page into the same OCR. Whatever
 *    text a read produces, the pure RouteSheetFile sorter
 *    (runsFromText) sorts it into the runs the FILE carries —
 *    the sheet's own "AM Shift"/"PM Shift" sections first (the
 *    timed stop lines only — check-ins, care plans, student
 *    rows and directions are not stops; NOON has no route and
 *    is never saved), each stop's own AM/PM marking when the
 *    file has no sections — and each carried run goes through
 *    SplitShift.setRouteSheet exactly as photo text does. A
 *    read with no stops, or runs that cannot be told apart,
 *    says so plainly on the note line and saves nothing.
 *
 * LAYERS: (A) the real Dispatch render over the v186/v378
 * stub-DOM — a bus account sees the per-run Photograph doors and
 * the ONE Upload door (and NO per-run file doors); standard and
 * office accounts see none. (B) the pure reader + sorter + the
 * REAL sample PDF (read by the same PDF.js the app loads, from
 * tools/bench-env) + the real split engine: the sorter splits
 * the sample into the sheet's 8 AM stops and 8 PM stops, in
 * order; failures save nothing. (C) end-to-end through the real
 * Dispatch wiring: a fake PDF.js serving the sample's real text
 * items, a fake File, the ONE input's own onchange — ONE upload
 * fills BOTH routes and the note speaks; a one-run file fills
 * its run only; a garbage file then refuses plainly and the
 * saved routes stand. (D) the move + the photo mechanics,
 * pinned in source.
 * Run: node tools/route-sheet-file-upload-nov8-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const dspSrc = read('modules/dispatch.js');
const prefSrc = read('modules/preferences.js');
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
const clone = (v) => JSON.parse(JSON.stringify(v));
function flush(n) {
  return new Promise(function (res) {
    let i = 0;
    (function step() { if (++i > (n || 60)) return res(); setTimeout(step, 0); })();
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
const docStub = {
  createElement: function (tag) {
    if (tag === 'canvas') {
      return { width: 0, height: 0,
        getContext: function () { return { drawImage: function () {} }; },
        toDataURL: function () { return 'data:image/jpeg;base64,THUMB'; } };
    }
    return new FakeEl(tag);
  },
  querySelector: function () { return null; },
  addEventListener: function () {}
};
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
  const sb = {
    console: console, document: docStub, localStorage: local,
    FileReader: FakeFileReader, Image: FakeImage, setTimeout: setTimeout,
    alert: function () {},
    confirm: function () { return true; },
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
  if (opts.withSplit) vm.runInContext(splitSrc, sb);
  vm.runInContext(dspSrc, sb);
  const onb = { userRole: opts.role || 'driver', firstName: 'Nirojini', lastName: 'K' };
  if (opts.accountType !== undefined) onb.accountType = opts.accountType;
  if (opts.workPattern !== undefined) onb.workPattern = opts.workPattern;
  sb.store.set('onboarding', onb);
  sb.store.set('dsp_list', []);
  sb.store.set('dsp_active', null);
  const body = new FakeEl('body');
  return { sb: sb, body: body,
    render: function () { sb.Meticulous.modules.dispatch.render(body); } };
}

/* ================= the expected routes (from the sheet itself) ================= */
const AM_NAMES = [
  '321 21 Ave SW, Calgary, AB T2S 0G7, Canada',
  '1005 Cameron Ave SW, Calgary, AB T2T 0K2, Canada',
  'WB 17 Av SW @ 27 St SW, Calgary, AB T3E 6K8, Canada',
  '3380 Spruce Dr SW, Calgary, AB T3C 3A2, Canada',
  '19 Hemlock Crescent SW, Calgary, AB T3C 2Z2, Canada',
  'Wildwood School • 120 45 St SW, Calgary, AB T3C 2B3, Canada',
  '2702 43 St SW, Calgary, AB T3E 3N5, Canada',
  'Glendale School • 2415 Kelwood Dr SW, Calgary, AB T3E 3Z8, Canada'
];
const AM_TIMES = ['7:26 AM', '7:33 AM', '7:41 AM', '7:47 AM', '7:50 AM', '7:55 AM', '8:24 AM', '8:26 AM'];
const PM_NAMES = [
  'Wildwood School • 120 45 St SW, Calgary, AB T3C 2B3, Canada',
  '3380 Spruce Dr SW, Calgary, AB T3C 3A2, Canada',
  '19 Hemlock Crescent SW, Calgary, AB T3C 2Z2, Canada',
  '1005 Cameron Ave SW, Calgary, AB T2T 0K2, Canada',
  '321 21 Ave SW, Calgary, AB T2S 0G7, Canada',
  'WB 17 Av SW @ 26 St SW, Calgary, AB T3C 1K7, Canada',
  'Glendale School • 2415 Kelwood Dr SW, Calgary, AB T3E 3Z8, Canada',
  '2702 43 St SW, Calgary, AB T3E 3N5, Canada'
];
const PM_TIMES = ['2:35 PM', '2:40 PM', '2:44 PM', '2:56 PM', '3:03 PM', '3:10 PM', '3:22 PM', '3:25 PM'];

/* ================= (A) render gates on the real module ================= */
console.log('(A) Dispatch render gates');
(function () {
  const bus = makeWorld({ accountType: 'Driver', role: 'driver', workPattern: 'split' });
  bus.render();
  const h = bus.body._html;
  check('bus account: the Route sheets card stands in Dispatch', h.indexOf('id="dp_sheet_card"') > -1 && h.indexOf('Route sheets') > -1);
  ['dp_sheet_am', 'dp_sheet_am_in', 'dp_sheet_am_note',
   'dp_sheet_pm', 'dp_sheet_pm_in', 'dp_sheet_pm_note',
   'dp_sheet_file', 'dp_sheet_file_in', 'dp_sheet_file_note'].forEach(function (id) {
    check('bus account: door #' + id + ' rendered', h.indexOf('id="' + id + '"') > -1);
  });
  check('bus account: both runs labelled', h.indexOf('Morning route sheet') > -1 && h.indexOf('Afternoon route sheet') > -1);
  check('bus account: ONE upload door, named as the file door',
    h.indexOf('Upload the route sheet file') > -1 &&
    (h.match(/id="dp_sheet_file"/g) || []).length === 1 && (h.match(/id="dp_sheet_file_in"/g) || []).length === 1);
  check('bus account: NO per-run file doors (she never uploads twice)',
    h.indexOf('dp_sheet_am_file') === -1 && h.indexOf('dp_sheet_pm_file') === -1 &&
    h.indexOf('Upload the AM route sheet file') === -1 && h.indexOf('Upload the PM route sheet file') === -1);

  const std = makeWorld({ accountType: 'Driver', role: 'driver', workPattern: 'standard' });
  std.render();
  check('standard (non-bus) account: NO route-sheet doors in Dispatch',
    std.body._html.indexOf('dp_sheet_card') === -1 && std.body._html.indexOf('dp_sheet_am') === -1);

  const off = makeWorld({ accountType: 'Driver', role: 'office', workPattern: 'split' });
  off.render();
  check('office face: NO route-sheet doors (the sheet is the driver\'s own day)',
    off.body._html.indexOf('dp_sheet_card') === -1);

  const bossSplit = makeWorld({ accountType: 'Fleet Manager', role: 'office', workPattern: 'split' });
  bossSplit.render();
  check('fleet-manager office face: sender screen yes, route-sheet doors no',
    bossSplit.body._html.indexOf('dp_send') > -1 && bossSplit.body._html.indexOf('dp_sheet_card') === -1);
})();

/* ================= (D) the move + photo mechanics (source pins) ================= */
console.log('(D) the move + photo mechanics');
(function () {
  check('Preferences no longer carries the route-sheet card',
    prefSrc.indexOf('pf_sheet') === -1 && prefSrc.indexOf('Morning route sheet') === -1);
  check('Preferences keeps the VIN door (only the sheet moved)', prefSrc.indexOf('pf_vin') > -1);
  check('photo inputs keep the camera door, byte for byte',
    (dspSrc.match(/id="dp_sheet_(am|pm)_in" accept="image\/\*" capture="environment"/g) || []).length === 2);
  check('the ONE upload input takes PDF + image and carries NO camera capture',
    (dspSrc.match(/id="dp_sheet_file_in" accept="application\/pdf,image\/\*"/g) || []).length === 1 &&
    !/dp_sheet_file_in"[^>]*capture/.test(dspSrc));
  check('no per-run file doors survive anywhere in the module',
    dspSrc.indexOf('dp_sheet_am_file') === -1 && dspSrc.indexOf('dp_sheet_pm_file') === -1);
  check('photo failure wording unchanged',
    dspSrc.indexOf('That photo could not be read as a route sheet — try a closer, straight-on shot of the printed sheet.') > -1);
  check('file failure wording is plain and says nothing was saved',
    dspSrc.indexOf('That file could not be read as a route sheet — nothing was saved.') > -1);
  check('runs-that-cannot-be-told-apart wording is plain and saves nothing',
    dspSrc.indexOf('That file’s runs could not be told apart — nothing was saved.') > -1);
  check('the gate is split-pattern and not-office',
    dspSrc.indexOf("dspSplitDay = !isOffice && (App._store.get('onboarding', {}) || {}).workPattern === 'split'") > -1);
  const iToday = dspSrc.indexOf('id="dp_today_card"');
  const iSheet = dspSrc.indexOf('id="dp_sheet_card"');
  const iUp = dspSrc.indexOf('id="dp_upcoming_card"');
  check('placement: the sheet card stands under Today\'s dispatch, above Upcoming',
    iToday > -1 && iSheet > iToday && iUp > iSheet);
  check('PDF reader: PDF.js pinned, OCR fallback + text-layer gate wired',
    dspSrc.indexOf('pdfjs-dist@3.11.174') > -1 && dspSrc.indexOf('dpSheetPdfOcr') > -1 &&
    dspSrc.indexOf('res.chars >= RouteSheetFile.TEXT_MIN') > -1);
  check('the file door sorts the whole file text through runsFromText (never per-door shaping)',
    dspSrc.indexOf('RouteSheetFile.runsFromText(text || \'\')') > -1 &&
    dspSrc.indexOf('shapePdfText(res.text') === -1);
  check('photo wiring still runs through TicketOCR.recognizeWithRotation into setRouteSheet',
    dspSrc.indexOf('TicketOCR.recognizeWithRotation(URL.createObjectURL(f))') > -1 &&
    dspSrc.indexOf('SplitShift.setRouteSheet(cfg[0], text || \'\')') > -1);
})();

/* ================= async layers: the real PDF ================= */
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
function fakeFile() {
  return { name: 'route-CBE-0574_261108_162530_13_2dof.pdf', type: 'application/pdf',
    arrayBuffer: function () { return Promise.resolve(new ArrayBuffer(8)); } };
}
function itemsOf(lines) {
  return lines.map(function (l, i) {
    return { str: l, transform: [1, 0, 0, 1, 50, 700 - i * 20], width: 200, height: 10 };
  });
}

(async function () {
  /* ---- the pure reader, out of the shipped file ---- */
  const rsfBox = {};
  vm.runInNewContext(region(dspSrc, '/* ROUTE-SHEET-FILE-BEGIN', '/* ROUTE-SHEET-FILE-END */') +
    '\nthis.__R = RouteSheetFile;', rsfBox);
  const R = rsfBox.__R;
  check('(B) the pure reader extracts from dispatch.js', !!R && typeof R.shapePdfText === 'function');

  const engBox = {};
  vm.runInNewContext(region(splitSrc, '/* SPLIT-ENGINE-BEGIN', '/* SPLIT-ENGINE-END */') +
    '\nthis.__E = ENGINE;', engBox);
  const E = engBox.__E;

  /* ---- the REAL sample, read by the same PDF.js the app loads ---- */
  console.log('(B) the real sample PDF through the pure reader + split engine');
  const pdfjsLib = require(path.join(ROOT, 'tools', 'bench-env', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.js'));
  const data = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tools', 'fixtures', 'route-CBE-0574.pdf')));
  const doc = await pdfjsLib.getDocument({ data: data }).promise;
  eq('the sample is 9 pages', doc.numPages, 9);
  const pagesItems = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pagesItems.push(tc.items.map(function (it) {
      return { str: it.str, transform: it.transform.slice(), width: it.width, height: it.height };
    }));
  }
  const pdfText = pagesItems.map(function (items) { return R.linesFromItems(items).join('\n'); }).join('\n');
  check('the sample HAS a text layer (thousands of characters)', pdfText.replace(/\s/g, '').length > 5000,
    'chars=' + pdfText.replace(/\s/g, '').length);
  check('the file carries all three runs in one PDF',
    pdfText.indexOf('AM Shift') > -1 && pdfText.indexOf('NOON Shift') > -1 && pdfText.indexOf('PM Shift') > -1);

  const shapedAm = R.shapePdfText(pdfText, 'am');
  const shapedPm = R.shapePdfText(pdfText, 'pm');
  const parsedAm = E.parseRouteSheet(shapedAm);
  const parsedPm = E.parseRouteSheet(shapedPm);
  eq('AM shaped text reads as exactly 8 stops', parsedAm.length, 8);
  eq('AM stop names, in the sheet\'s order', parsedAm.map(function (s) { return s.name; }), AM_NAMES);
  eq('AM stop times', parsedAm.map(function (s) { return s.time; }), AM_TIMES);
  eq('PM shaped text reads as exactly 8 stops', parsedPm.length, 8);
  eq('PM stop names, in the sheet\'s order (26 St in PM, 27 St in AM — the sections do not bleed)',
    parsedPm.map(function (s) { return s.name; }), PM_NAMES);
  eq('PM stop times', parsedPm.map(function (s) { return s.time; }), PM_TIMES);
  check('no furniture, students or care plans survive as stops',
    !parsedAm.concat(parsedPm).some(function (s) {
      return /check[-\s]?in|pre-trip|start run|arrive|care plan|pick-up|drop-off| sabuktigin| jabbar| fatima| danil| ethan| almurtada/i.test(s.name);
    }));

  /* ---- the ONE-door sorter over the same real text ---- */
  const runs = R.runsFromText(pdfText);
  check('the sorter sees the file’s own shift sections (marked, not ambiguous)',
    runs.marked === true && runs.ambiguous === false);
  eq('ONE read of the file sorts into the sheet’s AM stops',
    E.parseRouteSheet(runs.am).map(function (s) { return s.name; }), AM_NAMES);
  eq('…and into the sheet’s PM stops (the NOON run is never saved)',
    E.parseRouteSheet(runs.pm).map(function (s) { return s.name; }), PM_NAMES);
  eq('the sorted runs carry the sheet’s own times',
    [E.parseRouteSheet(runs.am).map(function (s) { return s.time; }),
     E.parseRouteSheet(runs.pm).map(function (s) { return s.time; })],
    [AM_TIMES, PM_TIMES]);

  /* ---- into the real split engine (v355 glue pattern) ---- */
  function makeGlue() {
    const data2 = { onboarding: { workPattern: 'split' }, sessions: [] };
    const store = {
      get: function (k, d) { return (k in data2 ? data2[k] : d); },
      set: function (k, v) { data2[k] = v; },
      del: function (k) { delete data2[k]; }
    };
    const sandbox = {};
    sandbox.window = sandbox;
    sandbox.App = { _store: store, tracker: { splitDay: false, status: 'idle' } };
    sandbox.LiveMiles = { subscribe: function () {}, getLastFix: function () { return null; } };
    vm.createContext(sandbox);
    vm.runInContext(splitSrc, sandbox);
    return { SS: sandbox.SplitShift, data: data2 };
  }
  const g = makeGlue();
  eq('ONE sorted upload fills BOTH routes', [g.SS.setRouteSheet('am', runs.am), g.SS.setRouteSheet('pm', runs.pm)], [8, 8]);
  eq('routeSheetInfo counts both', g.SS.routeSheetInfo(), { am: 8, pm: 8 });
  eq('the saved AM route is the sheet, in order', g.SS.routeToday().am.map(function (s) { return s.name; }), AM_NAMES);
  eq('the saved PM route is the sheet, in order', g.SS.routeToday().pm.map(function (s) { return s.name; }), PM_NAMES);
  eq('re-uploading the file replaces, never appends', g.SS.setRouteSheet('am', runs.am), 8);
  eq('a failed read saves nothing and wipes nothing',
    [g.SS.setRouteSheet('am', ''), g.SS.routeSheetInfo().am], [0, 8]);

  /* ---- reader + sorter edge honesty ---- */
  eq('a PM-only marked file sorts to PM only (headers present, AM absent)',
    (function () { const r = R.runsFromText('PM Shift\n02:35 PM Wildwood School • 120 45 St SW, Calgary'); return [r.am, r.pm.split('\n').length, r.marked]; })(),
    ['', 1, true]);
  eq('a sectionless one-run file sorts by its stops’ own AM markings',
    (function () { const r = R.runsFromText('7:02 AM  Elm Street & 4 Avenue\n7:05 AM  Oak Crescent'); return [r.am.split('\n').length, r.pm, r.marked]; })(),
    [2, '', false]);
  eq('a sectionless one-run file sorts by its stops’ own PM markings',
    (function () { const r = R.runsFromText('2:35 PM  Wildwood School Gate\n3:03 PM  Cameron Avenue'); return [r.am, r.pm.split('\n').length]; })(),
    ['', 2]);
  eq('a sectionless file with unmarked clock times cannot be told apart — ambiguous, nothing sorted',
    (function () { const r = R.runsFromText('7:02  Elm Street & 4 Avenue\n2:35  Wildwood School Gate'); return [r.ambiguous, r.am, r.pm]; })(),
    [true, '', '']);
  eq('garbage text shapes to nothing',
    R.shapePdfText('Quarterly Newsletter\nLunch at the office party on Friday\nBring a sandwich and a drink', 'am'), '');
  eq('garbage text sorts to nothing (and is not ambiguous — there is simply no route in it)',
    (function () { const r = R.runsFromText('Quarterly Newsletter\nLunch at the office party on Friday'); return [r.am, r.pm, r.ambiguous]; })(),
    ['', '', false]);
  eq('linesFromItems groups rows and spaces the print gaps',
    R.linesFromItems([
      { str: '07:26 AM', transform: [1, 0, 0, 1, 50, 700], width: 40, height: 10 },
      { str: '321 21 Ave SW', transform: [1, 0, 0, 1, 130, 700], width: 80, height: 10 },
      { str: 'next row', transform: [1, 0, 0, 1, 50, 680], width: 40, height: 10 }
    ]), ['07:26 AM 321 21 Ave SW', 'next row']);
  check('isPdfFile: type, name, and negatives',
    R.isPdfFile({ type: 'application/pdf' }) === true && R.isPdfFile({ name: 'sheet.PDF' }) === true &&
    R.isPdfFile({ type: 'image/png', name: 'sheet.png' }) === false && R.isPdfFile(null) === false);

  /* ---- (C) end-to-end through the real Dispatch wiring ---- */
  console.log('(C) end-to-end upload through the real wiring');
  const w = makeWorld({ accountType: 'Driver', role: 'driver', workPattern: 'split', withSplit: true });
  w.sb.pdfjsLib = fakePdfLib(pagesItems);
  w.render();
  const fileIn = w.body.querySelector('#dp_sheet_file_in');
  const fileNote = w.body.querySelector('#dp_sheet_file_note');
  const amNote = w.body.querySelector('#dp_sheet_am_note');
  const pmNote = w.body.querySelector('#dp_sheet_pm_note');
  check('the wiring took the ONE file input', typeof fileIn.onchange === 'function');
  fileIn.files = [fakeFile()];
  fileIn.onchange();
  await flush(80);
  eq('ONE upload of the both-runs sample fills BOTH routes', w.sb.SplitShift.routeSheetInfo(), { am: 8, pm: 8 });
  eq('the file note speaks the both-routes words', fileNote.textContent,
    'Both routes saved — Morning 8 stops, afternoon 8 stops, in order. The day’s route follows this sheet.');
  eq('the AM run note follows the save', amNote.textContent,
    'Morning route saved — 8 stops, in order. The day’s route follows this sheet.');
  eq('the PM run note follows the save', pmNote.textContent,
    'Afternoon route saved — 8 stops, in order. The day’s route follows this sheet.');
  eq('the AM route the day will follow is the sheet, in order',
    w.sb.SplitShift.routeToday().am.map(function (s) { return s.name; }), AM_NAMES);
  eq('the PM route the day will follow is the sheet, in order',
    w.sb.SplitShift.routeToday().pm.map(function (s) { return s.name; }), PM_NAMES);

  /* a one-run file through the same door fills its run only */
  const w2 = makeWorld({ accountType: 'Driver', role: 'driver', workPattern: 'split', withSplit: true });
  w2.sb.pdfjsLib = fakePdfLib([itemsOf([
    'PM Shift',
    '02:35 PM Wildwood School • 120 45 St SW, Calgary, AB T3C 2B3, Canada',
    '03:03 PM 321 21 Ave SW, Calgary, AB T2S 0G7, Canada'
  ])]);
  w2.render();
  const fileIn2 = w2.body.querySelector('#dp_sheet_file_in');
  const fileNote2 = w2.body.querySelector('#dp_sheet_file_note');
  fileIn2.files = [fakeFile()];
  fileIn2.onchange();
  await flush(80);
  eq('a PM-only file fills the PM run only — the app sorted it, not the user',
    w2.sb.SplitShift.routeSheetInfo(), { am: 0, pm: 2 });
  eq('the file note speaks the one-run words', fileNote2.textContent,
    'Afternoon route saved — 2 stops, in order. The day’s route follows this sheet.');

  w.sb.pdfjsLib = fakePdfLib([itemsOf([
    'Quarterly Newsletter', 'Lunch at the office party on Friday', 'Bring a sandwich and a drink'
  ])]);
  fileIn.files = [fakeFile()];
  fileIn.onchange();
  await flush(80);
  eq('a garbage file refuses plainly on the note line', fileNote.textContent,
    'That file could not be read as a route sheet — nothing was saved. Upload the sheet file the company sent, or photograph the printed sheet.');
  eq('…and the saved routes stand untouched', w.sb.SplitShift.routeSheetInfo(), { am: 8, pm: 8 });

  console.log('\nROUTE-SHEET-FILE-UPLOAD NOV8: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
})().catch(function (e) { console.error('SUITE ERROR', e); process.exit(2); });
