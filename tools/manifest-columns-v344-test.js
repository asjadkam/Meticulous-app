#!/usr/bin/env node
/* Meticulous v344 — MULTI-DAY-MANIFEST-COLUMNS.
 *
 * Owner (Nov 5, 2026 22:41, with a screenshot of the Oct 1–31
 * multi-day manifest PDF): the per-day lines were loose
 * right-aligned text ("0.0 km · 0.0 h · 0 loads · 82.8 L fuel") —
 * he wants them ORGANISED into a proper table: date in its own
 * column, and every day's km in ONE straight column, hours in
 * their own, loads in their own, fuel in their own — rows
 * aligned under plain headings (Date · km · Hours · Loads ·
 * Fuel). The rest of the v331 spec is unchanged: per day ONLY
 * km/hours/loads/fuel; page 2 = period totals of hours/fuel/
 * loads only; a month fits page 1.
 *
 * Proof shape: an October-style 31-day range is built through
 * the REAL manifest module (collect → daySummaryOf → rangeLines)
 * and the REAL MetPdf layout: the document carries ONE table of
 * 5 columns; the layout's recorded column x-positions are single
 * and strictly increasing (one straight column per figure); the
 * day figures equal the v331 loose-text figures for the same
 * seeded days; the PDF is exactly 2 pages.
 *
 * Run: node tools/manifest-columns-v344-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const manSrc = read('modules/manifest.js');
const cssSrc = read('css/style.css');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }

function makeEl() {
  return {
    innerHTML: '', textContent: '', value: '', onclick: null, onchange: null, style: {},
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    setAttribute: function () {}, getAttribute: function () { return null; },
    querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    addEventListener: function () {}
  };
}

/* October-style month: 31 days, a spread of figures incl. a
   fuel-only day (the 82.8 L shape from his screenshot) and
   zero days — seeded the way the app stores them. */
function octoberData() {
  const data = {
    onboarding: { payStandard: 'Hourly', ownWageRate: 29, travelBonus: 0 },
    rev_entries: [], sessions: [], fuel_fills: [], tracker: { status: 'idle' },
    mani_mode: 'range', mani_from: '2026-10-01', mani_to: '2026-10-31', mani_date: '2026-10-01'
  };
  for (let d = 1; d <= 31; d++) {
    const ds = '2026-10-' + ('0' + d).slice(-2);
    const hrs = (d % 9) + 2;                 /* 3..10 h */
    const km = Math.round((d * 37.3) % 260); /* spread of km */
    const loads = d % 7;
    data.rev_entries.push({ date: ds, hours: hrs });
    data.sessions.push({ date: ds, startedAt: ds + 'T08:00:00', endedAt: ds + 'T18:00:00', seconds: hrs * 3600, liveKm: km + 0.4, manualLoads: loads, startOdo: 100000, endOdo: 100100 });
    if (d % 3 === 0) data.fuel_fills.push({ date: ds, station: 'Shell', cost: '100.00', litres: 82.8 });
  }
  return data;
}

function makeWorld(data) {
  const store = {
    get: function (k, d) { return (k in data) ? data[k] : d; },
    set: function (k, v) { data[k] = v; return true; },
    del: function (k) { delete data[k]; return true; }
  };
  const captured = { pdf: null };
  const els = {};
  ['#mn_date', '#mn_from', '#mn_to', '#mn_mode_day', '#mn_mode_range', '#mn_print', '#mn_dl', '#mn_msg', '#mn_doc'].forEach(function (id) { els[id] = makeEl(); });
  const body = makeEl();
  body.querySelector = function (sel) { return els[sel] || null; };
  body.querySelectorAll = function () { return []; };
  const sb = {
    console: console, Date: Date, Math: Math, JSON: JSON,
    App: {
      _store: store,
      _today: function () { return '2026-11-05'; },
      _esc: function (s) { return String(s == null ? '' : s); },
      openModule: function () {},
      _photoDl: function () { return ''; },
      tracker: { status: 'idle' }
    },
    Meticulous: { modules: {} },
    MetPdf: { savePdf: function (payload, filename) { captured.pdf = { payload: payload, filename: filename }; return Promise.resolve({ message: 'saved' }); }, isNativeShell: function () { return false; } }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(manSrc, sb, { filename: 'modules/manifest.js' });
  return { api: sb.Meticulous.modules.manifest, body: body, els: els, data: data, captured: captured };
}

function loadPdf() {
  const psb = { console: console, Date: Date, Math: Math, JSON: JSON };
  psb.window = psb;
  psb.document = { createElement: function () { return { style: {}, click: function () {} }; }, body: { appendChild: function () {}, removeChild: function () {} } };
  psb.navigator = {};
  vm.createContext(psb);
  vm.runInContext(read('js/pdfexport.js'), psb, { filename: 'js/pdfexport.js' });
  return psb.window.MetPdf;
}

(async function () {
  const w = makeWorld(octoberData());

  /* — the printed October document — */
  w.api.render(w.body);
  w.els['#mn_dl'].onclick();
  await new Promise(function (r) { setTimeout(r, 20); });
  ok('the PDF was requested', !!w.captured.pdf);
  const lines = (w.captured.pdf && w.captured.pdf.payload.lines) || [];
  eq('line kinds: title, head row, 31 day rows, break, total head, 3 totals',
    lines.map(function (ln) { return ln.k; }),
    ['title', 'cols'].concat(Array(31).fill('cols'), ['pb', 'h', 'kv', 'kv', 'kv']));
  eq('the heading row is plain', lines[1],
    { k: 'cols', head: true, compact: true, cells: [{ t: 'Date' }, { t: 'km', r: 1 }, { t: 'Hours', r: 1 }, { t: 'Loads', r: 1 }, { t: 'Fuel', r: 1 }] });
  ok('the day rows carry the compact density flag (a month fits page 1)',
    lines.slice(2, 33).every(function (ln) { return ln.compact === true; }));
  ok('every day row has exactly 5 cells', lines.slice(2, 33).every(function (ln) { return ln.cells && ln.cells.length === 5; }));
  ok('every figure cell is right-aligned (r:1), the date is not',
    lines.slice(2, 33).every(function (ln) {
      return !ln.cells[0].r && ln.cells.slice(1).every(function (c) { return c.r === 1; });
    }));

  /* same figures as the v331 loose-text shape for the same days:
     recompute the old text from the module's own summarizer and
     compare figure-for-figure against the cells. */
  let figOk = true, figDetail = '';
  lines.slice(2, 33).forEach(function (ln, i) {
    const ds = '2026-10-' + ('0' + (i + 1)).slice(-2);
    const s = w.api._daySummaryOf(w.api._collectDay(ds));
    const want = [null, (Math.round(s.km * 10) / 10).toFixed(1), (Math.round(s.hours * 10) / 10).toFixed(1), '' + (s.loads || 0), (Math.round(s.fuelL * 10) / 10).toFixed(1)];
    for (let c = 1; c < 5; c++) {
      if (ln.cells[c].t !== want[c]) { figOk = false; figDetail = ds + ' col ' + c + ': got ' + ln.cells[c].t + ', want ' + want[c]; }
    }
  });
  ok('the table figures equal the v331 day figures, day for day', figOk, figDetail);

  /* — the rendered layout: ONE table, straight columns — */
  const MetPdf = loadPdf();
  const built = MetPdf.buildPdf({ title: 't', lines: lines });
  eq('the October PDF is exactly 2 pages', built.pages, 2);
  const p1 = MetPdf.buildPdf({ title: 't', lines: lines.slice(0, 33) });
  eq('page 1 alone (title + the whole month table) is ONE page — the density law', p1.pages, 1);
  eq('page 1 carries ONE table', built.tables.length, 1);
  eq('the table has 5 columns and 32 rows (head + 31 days)',
    built.tables[0] && [built.tables[0].cols, built.tables[0].rows], [5, 32]);
  ok('the 5 column x-positions are single and strictly increasing (one straight column each)',
    built.tables[0] && built.tables[0].xs.length === 5 &&
    built.tables[0].xs.every(function (x, i, a) { return i === 0 || x > a[i - 1]; }),
    JSON.stringify(built.tables[0] && built.tables[0].xs));

  /* — the screen preview is the same table — */
  const h = w.body.innerHTML;
  ok('the preview paints the summary table with the plain headings',
    h.indexOf('<table class="mn-sumtab">') >= 0 && h.indexOf('<th>Date</th>') >= 0 &&
    h.indexOf('<th class="r">km</th>') >= 0 && h.indexOf('<th class="r">Hours</th>') >= 0 &&
    h.indexOf('<th class="r">Loads</th>') >= 0 && h.indexOf('<th class="r">Fuel</th>') >= 0);
  eq('the preview paints 31 day rows', (h.match(/<tr><td>/g) || []).length, 31);
  ok('no loose "·"-joined day text remains in the preview',
    !/\d+\.\d km · \d+\.\d h · \d+ loads? ·/.test(h.slice(h.indexOf('id="mn_preview"'), h.indexOf('id="mn_print"'))));
  ok('the table CSS stands (straight right-aligned figure columns)',
    cssSrc.indexOf('.mn-sumtab{') >= 0 && cssSrc.indexOf('.mn-sumtab .r{text-align:right') >= 0);

  /* — pins — */
  eq('webVersion is 344', ver.webVersion, 344);
  ok('index.html pins manifest.js?v=344 + style.css?v=344 + pdfexport.js?v=344',
    idxSrc.indexOf('modules/manifest.js?v=344') >= 0 && idxSrc.indexOf('css/style.css?v=344') >= 0 &&
    idxSrc.indexOf('js/pdfexport.js?v=344') >= 0);

  console.log('\nmanifest-columns-v344: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR ' + (e && e.stack || e)); process.exit(1); });
