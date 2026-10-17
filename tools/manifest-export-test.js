#!/usr/bin/env node
/* Meticulous v69 — Manifest Print / PDF + Download must WORK in the
 * Android shell, and the manifest must show a RUNNING session.
 *
 * Owner field reports (Oct 14):
 *  (1) On the Manifest screen, BOTH "Print / PDF" and "Download" did
 *      nothing when tapped in the v34 shell. Root causes: Print called
 *      window.print() — a silent no-op in the bare Capacitor WebView
 *      (no print bridge) — and Download clicked a blob: <a download>,
 *      which a WebView without a DownloadListener ignores. Fix:
 *      js/pdfexport.js builds a REAL PDF (pure JS writer) and, in the
 *      shell, saves it via the @capacitor/filesystem plugin the shell
 *      already carries (Directory.Documents = the public Documents
 *      folder); in a browser, Print keeps window.print() and
 *      Download saves the PDF as a file. The INVOICE print path
 *      (window.open + w.print) shared the shell flaw and is routed
 *      through the same helper (pay stubs share printDoc).
 *  (2) Today's manifest showed Start Time "—" while a session was
 *      running: collect() read only SAVED sessions (written at STOP).
 *      It now overlays the live tracker (start = now − live seconds,
 *      the same math the saved entry later uses; end stays honestly
 *      open: "Still working" / "Paused"), including a by-mile start
 *      odometer still pending on the tracker.
 *
 * Run: node tools/manifest-export-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pdfSrc = fs.readFileSync(path.join(ROOT, 'js', 'pdfexport.js'), 'utf8');
const manSrc = fs.readFileSync(path.join(ROOT, 'modules', 'manifest.js'), 'utf8');
const invSrc = fs.readFileSync(path.join(ROOT, 'modules', 'invoice.js'), 'utf8');
const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
/* drain every pending microtask chain (savePdf hops several .thens) */
function flush() { return new Promise(function (r) { setTimeout(r, 10); }); }

/* =============== (a) the PDF writer itself =============== */
function pdfWorld(extra) {
  const sandbox = {
    console: console, setTimeout: setTimeout, Promise: Promise,
    Blob: function (parts, opts) { this.parts = parts; this.type = opts && opts.type; },
    URL: { createObjectURL: function () { return 'blob:fake'; }, revokeObjectURL: function () {} },
    document: null // filled by caller where needed
  };
  sandbox.window = sandbox;
  Object.assign(sandbox, extra || {});
  vm.createContext(sandbox);
  vm.runInContext(pdfSrc, sandbox, { filename: 'js/pdfexport.js' });
  return sandbox;
}

{
  const sb = pdfWorld();
  const M = sb.window.MetPdf;
  check('a: MetPdf exposed', !!M && typeof M.buildPdf === 'function');
  const lines = [{ k: 'title', a: 'MANIFEST — 2026-10-14' },
    { k: 'h', a: 'Dispatches' },
    { k: 'kv', a: 'Aecon Infrastructure', b: 'gravel' },
    { k: 'kv', a: 'Start Time', b: '8:00:00 AM' },
    { k: 'kv', a: 'End Time', b: 'Still working' },
    { k: 'note', a: 'A long note that must wrap: ' + 'word '.repeat(30) }];
  for (let i = 0; i < 80; i++) lines.push({ k: 'kv', a: 'Load ' + (i + 1) + ' — dumped', b: '10:00 AM' });
  const pdf = M.buildPdf({ title: 'Manifest — 2026-10-14', lines: lines });
  const bytes = Buffer.from(pdf.bytes);
  check('a: bytes start with %PDF-1.4', bytes.slice(0, 8).toString() === '%PDF-1.4');
  check('a: bytes end with %%EOF', bytes.slice(-6).toString().indexOf('%%EOF') >= 0);
  check('a: multi-page (80 rows)', pdf.pages >= 2, 'pages=' + pdf.pages);
  check('a: /Count matches pages', bytes.includes('/Count ' + pdf.pages));
  const sx = Number(bytes.toString('latin1').match(/startxref\n(\d+)/)[1]);
  check('a: startxref lands on the xref table', bytes.slice(sx, sx + 4).toString() === 'xref');
  check('a: content stream carries the title', bytes.includes('(MANIFEST'));
  check('a: content stream carries the running End Time verbatim', bytes.includes('(Still working)'));
  check('a: content stream carries page footers', bytes.includes('(Page 1 of ' + pdf.pages + ')'));
  const round = M._b64decodeBytes(pdf.base64);
  check('a: base64 round-trips to the same bytes', Buffer.from(round).equals(bytes));
  // escaping must not corrupt the stream
  const tricky = M.buildPdf({ title: 'T', lines: [{ k: 'p', a: 'Cost (est) \\ $5 — “paid”' }] });
  check('a: parens/backslash escaped in stream', Buffer.from(tricky.bytes).includes('(Cost \\(est\\) \\\\ $5'));
}

/* =============== (b) invoice HTML -> lines =============== */
{
  const M = pdfWorld().window.MetPdf;
  const invHtml =
    '<h1>Ai Trucking Ltd</h1>' +
    '<p class="muted">1243 Cornerstone Blvd NE, Calgary<br>GST/HST: 123456789</p>' +
    '<h2>INVOICE #1151</h2>' +
    '<div class="row"><span><b>Bill to:</b> Ai Trucking</span><span><b>Date:</b> 2026-10-15</span></div>' +
    '<table><tr><th>Description</th><th style="text-align:right">Amount</th></tr>' +
    '<tr><td>Oct 14, 2026 — 11.5 h @ $29.00</td><td class="tot">$333.50</td></tr>' +
    '<tr><td>Oct 15, 2026 — 11 h @ $29.00</td><td class="tot">$319.00</td></tr></table>' +
    '<div class="row"><span>Subtotal</span><span>$652.50</span></div>' +
    '<div class="row" style="font-size:18px"><span><b>Total due</b></span><span><b>$652.50</b></span></div>' +
    '<p class="muted">Thank you.</p>';
  const L = M.htmlToLines(invHtml);
  const flat = JSON.stringify(L);
  check('b: company becomes the title', L[0] && L[0].k === 'title' && L[0].a.indexOf('Ai Trucking') >= 0);
  check('b: address paragraph lines survive', flat.indexOf('Cornerstone') >= 0 && flat.indexOf('GST/HST') >= 0);
  check('b: invoice number is a heading', L.some(function (l) { return l.k === 'h' && l.a.indexOf('INVOICE #1151') >= 0; }));
  check('b: bill-to/date becomes a kv', L.some(function (l) { return l.k === 'kv' && l.a.indexOf('Bill to') >= 0 && l.b.indexOf('2026-10-15') >= 0; }));
  check('b: every table row becomes a kv', L.some(function (l) { return l.k === 'kv' && l.b === '$333.50'; }) && L.some(function (l) { return l.k === 'kv' && l.b === '$319.00'; }));
  check('b: total due line present', L.some(function (l) { return l.k === 'kv' && l.a.indexOf('Total due') >= 0 && l.b === '$652.50'; }));
  const stubHtml =
    '<h1>Pay Stub</h1><p class="muted">Ai Trucking<br>Pay period: 2026-10-01 to 2026-10-15</p>' +
    '<table><tr><th>Description</th><th>Amount</th></tr>' +
    '<tr><td>Gross earnings</td><td class="tot">$1,977.50</td></tr>' +
    '<tr><td>EI</td><td class="tot">−$32.00</td></tr></table>' +
    '<div class="row" style="font-size:18px"><span><b>Net pay</b></span><span><b>$1,900.00</b></span></div>';
  const L2 = M.htmlToLines(stubHtml);
  check('b: pay stub rows convert (incl. minus amounts)', L2.some(function (l) { return l.k === 'kv' && l.a === 'EI'; }) &&
    L2.some(function (l) { return l.k === 'kv' && l.a.indexOf('Net pay') >= 0; }));
  const pdf = M.buildPdf({ title: 'Invoice 1151', lines: L });
  check('b: invoice lines build a valid PDF', Buffer.from(pdf.bytes).slice(0, 5).toString() === '%PDF-');
}

/* =============== (c) delivery routing: shell =============== */
{
  const writes = [];
  const sb = pdfWorld();
  sb.window.Capacitor = {
    isNativePlatform: function () { return true; },
    Plugins: {
      Filesystem: {
        writeFile: function (opts) { writes.push(opts); return Promise.resolve({}); },
        getUri: function (o) { return Promise.resolve({ uri: 'file:///storage/emulated/0/Documents/' + o.path }); }
      }
    }
  };
  const M = sb.window.MetPdf;
  check('c: shell detected with the Filesystem plugin present', M.isNativeShell() === true);
  return M.savePdf({ title: 'Manifest — 2026-10-14', lines: [{ k: 'kv', a: 'Start Time', b: '8:00:00 AM' }] }, 'manifest-2026-10-14.pdf').then(function (r) {
    eq('c: exactly one Filesystem write', writes.length, 1);
    eq('c: written into Directory.Documents', writes[0] && writes[0].directory, 'DOCUMENTS');
    eq('c: written under the manifest filename', writes[0] && writes[0].path, 'manifest-2026-10-14.pdf');
    const data = Buffer.from(M._b64decodeBytes(writes[0].data));
    check('c: what was written IS a real PDF', data.slice(0, 5).toString() === '%PDF-' && data.includes('(Start Time)'));
    check('c: result ok + honest Documents message', r.ok === true && /Documents folder/.test(r.message) && /Files app/.test(r.message));
    check('c: result carries the file uri', typeof r.uri === 'string' && r.uri.indexOf('manifest-2026-10-14.pdf') >= 0);
  }).then(runBrowser).then(runManifestWorlds).then(finish);
}

/* =============== (d) delivery routing: browser =============== */
function runBrowser() {
  const clicks = [];
  const anchors = [];
  const sb = pdfWorld();
  sb.document = {
    createElement: function () {
      const a = { click: function () { clicks.push(this); } };
      anchors.push(a); return a;
    },
    body: { appendChild: function () {}, removeChild: function () {} }
  };
  const M = sb.window.MetPdf;
  check('d: no Capacitor -> not the shell', M.isNativeShell() === false);
  return M.savePdf({ title: 'T', lines: [{ k: 'p', a: 'hello' }] }, 'manifest-2026-10-14.pdf').then(function (r) {
    eq('d: one anchor download click', clicks.length, 1);
    eq('d: download attribute is the PDF name', anchors[0] && anchors[0].download, 'manifest-2026-10-14.pdf');
    check('d: browser result ok', r.ok === true && r.where === 'download');
  });
}

/* =============== (e)+(f) the real manifest module =============== */
function makeBody() {
  const body = { _html: '', _btns: {} };
  body._date = { value: '', onchange: null };
  function rebuild() {
    body._toggles = [];
    const re = /data-tg="([^"]+)"( checked)?/g;
    let m;
    while ((m = re.exec(body._html))) {
      const key = m[1];
      body._toggles.push({ checked: !!m[2], onchange: null, getAttribute: function (n) { return n === 'data-tg' ? key : null; } });
    }
    const dm = body._html.match(/id="mn_date" value="([^"]+)"/);
    body._date.value = dm ? dm[1] : '';
  }
  Object.defineProperty(body, 'innerHTML', {
    get: function () { return body._html; },
    set: function (v) { body._html = v; rebuild(); }
  });
  body._msg = { textContent: '' };
  body.querySelector = function (sel) {
    if (sel === '#mn_date') return body._date;
    if (sel === '#mn_msg') return body._msg;
    return body._btns[sel] || (body._btns[sel] = { onclick: null });
  };
  body.querySelectorAll = function (sel) { return sel === '[data-tg]' ? body._toggles : []; };
  return body;
}

function fixtureMem() {
  return {
    onboarding: { payStandard: 'Hourly', payRate: 29 },
    dsp_list: [{ date: '2026-10-14', jobSite: 'Aecon Infrastructure', material: 'gravel' }],
    nav_log: [], fuel_fills: [], fuel_expenses: [], dmg_reports: [],
    sessions: [], rev_entries: [], rev_extras: []
  };
}
function stoppedDayMem() {
  const m = fixtureMem();
  m.sessions = [{ date: '2026-10-14', endedAt: Date.parse('2026-10-14T19:00:00'), seconds: 39600, startOdo: 168518, endOdo: 168685 }];
  m.tracker = { status: 'idle', startTs: 0, elapsed: 0 };
  return m;
}
function todayStrLocal(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

function runManifestWorlds() {
  /* world builder: real manifest.js (+ real pdfexport.js where asked),
     fakes only for App/store/DOM/Capacitor. */
  function makeWorld(mem, opts) {
    opts = opts || {};
    const writes = [];
    const store = {
      get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
      set: function (k, v) { writes.push(k); mem[k] = JSON.parse(JSON.stringify(v)); return true; },
      del: function (k) { delete mem[k]; return true; }
    };
    const printCalls = [];
    const sandbox = {
      console: console, setTimeout: setTimeout, Promise: Promise,
      Blob: function (parts, o) { this.parts = parts; this.type = o && o.type; },
      URL: { createObjectURL: function () { return 'blob:fake'; }, revokeObjectURL: function () {} },
      App: {
        _store: store,
        _esc: function (s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
        _today: function () { return '2026-10-14'; },
        tracker: mem.tracker || null
      },
      Meticulous: { modules: {} }
    };
    sandbox.window = sandbox;
    sandbox.window.print = function () { printCalls.push(1); };
    sandbox.document = {
      createElement: function () { const a = { click: function () { a.clicked = true; } }; sandbox._lastAnchor = a; return a; },
      body: { appendChild: function () {}, removeChild: function () {} }
    };
    if (opts.shell) {
      sandbox.Capacitor = {
        isNativePlatform: function () { return true; },
        Plugins: { Filesystem: {
          writeFile: function (o) { sandbox._fsWrites = sandbox._fsWrites || []; sandbox._fsWrites.push(o); return Promise.resolve({}); },
          getUri: function (o) { return Promise.resolve({ uri: 'file:///storage/emulated/0/Documents/' + o.path }); }
        } }
      };
    }
    vm.createContext(sandbox);
    vm.runInContext(pdfSrc, sandbox, { filename: 'js/pdfexport.js' });
    vm.runInContext(manSrc, sandbox, { filename: 'modules/manifest.js' });
    const body = makeBody();
    return { sandbox: sandbox, body: body, printCalls: printCalls,
      render: function () { sandbox.Meticulous.modules.manifest.render(body); } };
  }

  /* ---- (f1) running session, nothing saved yet: start shows ---- */
  {
    const mem = fixtureMem();
    // app.js semantics: running -> live seconds = elapsed + (now-startTs)
    mem.tracker = { status: 'running', startTs: Date.now(), elapsed: 2 * 3600 };
    const w = makeWorld(mem);
    w.render();
    const mRow = w.body._html.match(/<div class="kv"><span>Start Time<\/span><b>([^<]*)<\/b><\/div>/);
    let startOk = false;
    if (mRow) {
      const parsed = Date.parse('2026-10-14 ' + mRow[1]);
      startOk = isFinite(parsed) && Math.abs(parsed - (Date.now() - 2 * 3600 * 1000)) <= 3000;
    }
    check('f1: Start Time shows the running session start (~2h ago)', startOk, 'row: ' + (mRow && mRow[0]));
    check('f1: End Time honestly open — Still working', w.body._html.indexOf('<div class="kv"><span>End Time</span><b>Still working</b></div>') >= 0);
    /* v122 supersedes the v87 omission pinned here before: with
       the Odometer section ON but nothing captured, the row now
       SAYS "no readings captured" — a silently vanished line is
       indistinguishable from the toggle being ignored (owner,
       Oct 17). Full behaviour pinned in manifest-odo-test.js. */
    check('f1: no captures → the Odometer row says "no readings captured" (v122)', w.body._html.indexOf('<div class="kv"><span>Odometer</span><b>no readings captured</b>') >= 0);
  }
  /* ---- (f2) running + pending by-mile start odo shows ---- */
  {
    const mem = fixtureMem();
    mem.tracker = { status: 'running', startTs: Date.now(), elapsed: 3600,
      odoStart: { date: todayStrLocal(Date.now() - 3600 * 1000), value: 168518 } };
    const w = makeWorld(mem);
    w.render();
    check('f2: Odometer line shows the pending start reading, end honestly open (v87)',
      w.body._html.indexOf('<div class="kv"><span>Odometer</span><b>168,518 km → end not recorded</b></div>') >= 0);
  }
  /* ---- (f3) paused session: end shows Paused ---- */
  {
    const mem = fixtureMem();
    mem.tracker = { status: 'paused', startTs: Date.now() - 999999, elapsed: 5400 };
    const w = makeWorld(mem);
    w.render();
    check('f3: paused day shows its start too', /<span>Start Time<\/span><b>(?!—)/.test(w.body._html));
    check('f3: End Time shows Paused', w.body._html.indexOf('<div class="kv"><span>End Time</span><b>Paused</b></div>') >= 0);
  }
  /* ---- (f4) stopped day: byte-identical to the old behavior ---- */
  {
    const w = makeWorld(stoppedDayMem());
    w.render();
    const wantStart = new Date(Date.parse('2026-10-14T19:00:00') - 39600 * 1000).toLocaleTimeString();
    const wantEnd = new Date(Date.parse('2026-10-14T19:00:00')).toLocaleTimeString();
    check('f4: stopped day start from the saved entry', w.body._html.indexOf('<div class="kv"><span>Start Time</span><b>' + wantStart + '</b></div>') >= 0);
    check('f4: stopped day end from the saved entry', w.body._html.indexOf('<div class="kv"><span>End Time</span><b>' + wantEnd + '</b></div>') >= 0);
    check('f4: stopped day odometer line from the saved entry (v87: one line, day km between)',
      w.body._html.indexOf('<span>Odometer</span><b>168,518 → 168,685 km (167 km)</b>') >= 0);
  }
  /* ---- (f5) saved session + a live one: earliest start wins, end open ---- */
  {
    const mem = stoppedDayMem();
    mem.tracker = { status: 'running', startTs: Date.now(), elapsed: 600 };
    const w = makeWorld(mem);
    w.render();
    const wantStart = new Date(Date.parse('2026-10-14T19:00:00') - 39600 * 1000).toLocaleTimeString();
    check('f5: start stays the day\'s first (saved) start', w.body._html.indexOf('<div class="kv"><span>Start Time</span><b>' + wantStart + '</b></div>') >= 0);
    check('f5: end is open while another session runs', w.body._html.indexOf('<div class="kv"><span>End Time</span><b>Still working</b></div>') >= 0);
  }
  /* ---- (f6) yesterday viewed while today runs: no overlay leakage ---- */
  {
    const mem = stoppedDayMem();
    mem.mani_date = '2026-10-13';
    mem.tracker = { status: 'running', startTs: Date.now(), elapsed: 600 };
    const w = makeWorld(mem);
    w.render();
    check('f6: a past day with no entries still shows —/— (no live leak)',
      w.body._html.indexOf('<div class="kv"><span>Start Time</span><b>—</b></div>') >= 0 &&
      w.body._html.indexOf('Still working') < 0);
  }

  /* ---- (e1) browser world: Print -> window.print; Download -> PDF file ---- */
  {
    const w = makeWorld(fixtureMem());
    w.render();
    w.body._btns['#mn_print'].onclick();
    eq('e1: browser Print still opens the system print dialog', w.printCalls.length, 1);
    w.body._btns['#mn_dl'].onclick();
    const a = w.sandbox._lastAnchor;
    return flush().then(function () {
      check('e1: browser Download clicked a file anchor', !!a && a.clicked === true);
      eq('e1: browser Download filename is the PDF', a && a.download, 'manifest-2026-10-14.pdf');
      check('e1: in-page message confirms the PDF', /PDF downloaded/.test(w.body._msg.textContent), w.body._msg.textContent);
      return runShellWorld();
    });
  }
  function runShellWorld() {
    /* ---- (e2) shell world: BOTH buttons save a real PDF via Filesystem ---- */
    const w = makeWorld(fixtureMem(), { shell: true });
    w.render();
    w.body._btns['#mn_print'].onclick();
    return flush().then(function () {
      const fs1 = w.sandbox._fsWrites || [];
      eq('e2: shell Print saved through Filesystem (no window.print)', fs1.length, 1);
      eq('e2: shell Print never called window.print', w.printCalls.length, 0);
      const data = Buffer.from(w.sandbox.MetPdf._b64decodeBytes(fs1[0].data));
      check('e2: the saved payload is a real PDF of the manifest',
        data.slice(0, 5).toString() === '%PDF-' && data.includes('(MANIFEST') && data.includes('(Aecon Infrastructure)'));
      /* v134 (owner, Oct 17: "Same clean up on manifest"): the
         day's figures stand under their OWN section heading,
         ahead of the figure rows, and the earned total prints as
         the section's closing line — pinned in the actual PDF
         byte stream of the native save. */
      check('e2: v134 — the figures have their own "Day summary" section', data.includes('(Day summary)'));
      check('e2: v134 — the Day summary heading paints before the figures it heads',
        data.includes('(Day summary)') && data.includes('(Start Time)') &&
        data.indexOf('(Day summary)') < data.indexOf('(Start Time)'));
      check('e2: v134 — the earned total prints as the section totals line', data.includes('(Total Earned Income)'));
      check('e2: shell Print message tells the driver where it landed', /Documents folder/.test(w.body._msg.textContent), w.body._msg.textContent);
      w.body._btns['#mn_dl'].onclick();
      return flush().then(function () {
        eq('e2: shell Download also saves through Filesystem', (w.sandbox._fsWrites || []).length, 2);
        runStatics();
      });
    });
  }
}

/* =============== (g) statics =============== */
function runStatics() {
  check('g: manifest no longer downloads a .txt blob', manSrc.indexOf("a.download = 'manifest-'") < 0 && manSrc.indexOf("type: 'text/plain'") < 0);
  check('g: manifest Print is environment-routed', manSrc.indexOf('MetPdf.isNativeShell()') >= 0 && manSrc.indexOf('window.print()') >= 0);
  check('g: manifest Download routes through saveManifestPdf', manSrc.indexOf("saveManifestPdf(body, d, c, t)") >= 0);
  const ip = invSrc.indexOf('MetPdf.isNativeShell()');
  const io = invSrc.indexOf("window.open('', '_blank'");
  check('g: invoice printDoc checks the shell BEFORE window.open', ip >= 0 && io > ip);
  check('g: invoice shell path builds the PDF from the same doc', invSrc.indexOf('MetPdf.htmlToLines(bodyHtml)') >= 0);
  check('g: index.html loads js/pdfexport.js', idxSrc.indexOf('js/pdfexport.js?v=') >= 0);
  check('g: index.html loads manifest.js at ?v=<webVersion>', idxSrc.indexOf('modules/manifest.js?v=' + ver.webVersion) >= 0);
}

function finish() {
  console.log('\nmanifest-export test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
