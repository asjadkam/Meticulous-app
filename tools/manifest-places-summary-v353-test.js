#!/usr/bin/env node
/* Meticulous v353 — MANIFEST-NO-RAW-GPS-STOPS +
 * MANIFEST-CLUMP-50M + MANIFEST-PDF-COLUMNS-CUT-OFF
 * (owner Nov 5, 2026 23:30–23:32 MDT, over the Nov 5 manifest).
 *
 * 1+2. "Manifest doesnt have to write every gps tag where it
 * stops... Just so many dumps in this locations." The route
 * section listed every GPS stop — unnamed ones as RAW
 * COORDINATES ("Stop — 51.12009, -113.97448") — and stops a
 * few metres apart listed separately. Now the genuine stops
 * CLUMP (single-linkage, ~50 m): one summary line per place,
 * its name and its stop count, merged with the v299 haul
 * pairing lines in time order, on BOTH faces (print +
 * screen, one helper). A cluster is named by a member stop's
 * resolved label, else by placeNameFor at its centre, else
 * "Unnamed stop". The Start/End frame lost its coordinate
 * fallback the same way: a name or the bare word, never
 * numbers. Fixture: c shaped exactly as collect() returns it
 * for a Nov 5-style day — three stops a few metres apart at
 * the airport cell (one carrying the saved name), two more
 * clumped unnamed stops beside a saved place, one lone stop.
 *
 * 3. The Day summary values ran off the PDF's right edge.
 * Root cause, measured: MetPdf drew kv values (and headings,
 * table headers) in Helvetica-BOLD but measured every string
 * with the REGULAR width table — bold renders wider, so a
 * right-aligned value anchored at RIGHT - (regular width)
 * protruded past the margin by the bold delta: +0.6–2.9 pt on
 * short values (the clipped end times), +15–39 pt on the long
 * ones, the longest ending at the physical page edge. The
 * engine now carries the bold AFM table and measures, wraps
 * and anchors in the drawn weight; an over-wide value wraps
 * right-aligned under its label; and a cols table that still
 * exceeds the page after the floor yield scales to fit. The
 * proof renders Nov 5-shaped lines (plus stress lines) and
 * measures EVERY text op in the produced PDF bytes against
 * the margins with the true (bold-aware) metrics.
 *
 * Run: node tools/manifest-places-summary-v353-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const manSrc = read('modules/manifest.js');
const pdfSrc = read('js/pdfexport.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }

/* ---------- the manifest module in a stub world ---------- */
function makeManifest(mem) {
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const sb = {
    console: console, setTimeout: setTimeout, Promise: Promise,
    App: {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s); },
      _today: function () { return '2026-11-05'; },
      tracker: { status: 'idle' }, userRole: function () { return 'both'; }
    },
    Meticulous: { modules: { navigation: { builtinPlaces: function () { return []; } } } }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(manSrc, sb, { filename: 'modules/manifest.js' });
  return sb.Meticulous.modules.manifest;
}

const mem = {
  mani_date: '2026-11-05',
  nav_data: { personal: [{ name: 'Home', lat: 51.15709, lng: -113.93862 }, { name: 'Shell Country Hills', lat: 51.14900, lng: -113.97500 }], work: [] }
};
const M = makeManifest(mem);
const toggles = M._toggles();
['nav', 'expense', 'start', 'end', 'odo', 'loads', 'earned', 'pti', 'incident'].forEach(function (k) { if (k in toggles) toggles[k] = true; });

function stop(lat, lng, label, h, m, mins) {
  const d = new Date(2026, 10, 5, h, m, 0);
  return { at: d.toISOString(), label: label, lat: lat, lng: lng, mins: mins };
}
const c = {
  live: false, dispatches: [], navLog: [],
  routeInfo: {
    start: { lat: 51.15710, lng: -113.93860, at: new Date(2026, 10, 5, 8, 36).toISOString(), label: '' },
    end: { lat: 51.15708, lng: -113.93864, at: new Date(2026, 10, 5, 19, 32).toISOString(), label: '' },
    km: 221.4
  },
  routeStops: [
    stop(51.12009, -113.97448, 'Airport Cell', 10, 4, 6),     // the dump ground…
    stop(51.12022, -113.97431, '', 11, 2, 5),                  // …a few metres over
    stop(51.11995, -113.97460, '', 12, 15, 7),                 // …and again
    stop(51.14902, -113.97501, '', 19, 59, 9),                 // fuel, unnamed stops…
    stop(51.14910, -113.97492, '', 20, 5, 3),                  // …clumped beside Shell
    stop(51.13100, -114.01000, '', 15, 40, 12)                 // a lone unnamed stop
  ],
  haulLines: [{ from: 'Aecon Trans', to: 'Airport Cell', n: 6, at: new Date(2026, 10, 5, 10, 30).getTime() }],
  fills: [], expenses: [], incidents: [], sessions: [], revEntries: [],
  earned: 290, startT: '9:00 AM', endT: '6:00 PM', startSrc: 'dispatch', endSrc: 'dispatch',
  odoStart: 171261, odoEnd: 171497, odoStartPhoto: null, odoEndPhoto: null,
  liveKm: 221.4, liveKmAny: true, milesIssues: null, geoDay: null,
  pegPlaces: { load: ['Aecon Trans'], dump: ['Airport Cell'] },
  loads: 6, loadsSrc: 'peg', loadsSite: 'Airport Cell', dayNote: '', dayEdit: null,
  pti: { pre: null, post: null }, gpsTrail: true, complete: false, missing: []
};
const lines = M._docLines('2026-11-05', c, toggles);
const flat = lines.map(function (l) { return (l.a || '') + ' | ' + (l.b || ''); }).join('\n');

console.log('— the route section: clumped place lines, no coordinates —');
ok('NO raw coordinates anywhere in the document', !/\d{2}\.\d{3,}/.test(flat), flat.split('\n').filter(function (x) { return /\d{2}\.\d{3,}/.test(x); }).join(' ;; '));
ok('no "Stop —" coordinate rows remain', flat.indexOf('Stop —') === -1);
const airport = lines.filter(function (l) { return l.a === 'Airport Cell'; });
eq('the three airport stops print as ONE line', airport.length, 1);
eq('…carrying the clump count', airport.length && airport[0].b, '3 stops');
const shell = lines.filter(function (l) { return l.a === 'Shell Country Hills'; });
eq('the unnamed clump takes the saved place name at its centre', shell.length && shell[0].b, '2 stops');
const unnamed = lines.filter(function (l) { return l.a === 'Unnamed stop'; });
eq('a place nothing can name prints as Unnamed stop — still no coordinates', unnamed.length && unnamed[0].b, '1 stop');
ok('the haul pairing line still prints beside the clumps',
  lines.some(function (l) { return l.a === 'Aecon Trans – Airport Cell' && l.b === '6 loads'; }));
const startLine = lines.filter(function (l) { return /^Start/.test(l.a || ''); })[0];
const endLine = lines.filter(function (l) { return /^End/.test(l.a || ''); })[0];
eq('the Start frame resolves the saved Home name (no coordinate fallback)', startLine && startLine.a, 'Start — Home');
eq('the End frame resolves the saved Home name', endLine && endLine.a, 'End — Home');
ok('the whole manifest source holds no coordinate-printing fallback left',
  manSrc.indexOf('toFixed(5)') === -1 && /stopClusters353\(c\.routeStops\)/.test(manSrc));

console.log('— the PDF: every value inside the page —');
const psb = { console: console, setTimeout: setTimeout, Promise: Promise };
psb.window = psb;
vm.createContext(psb);
vm.runInContext(pdfSrc, psb);
const MetPdf = psb.MetPdf;
ok('bold measurement is real: a letters string measures wider bold than regular',
  MetPdf._textWidth('Airport Cell', 10.5, true) > MetPdf._textWidth('Airport Cell', 10.5, false));
const doc = { title: 'MANIFEST — 2026-11-05', lines: lines.concat([
  { k: 'kv', a: 'Dumped at', b: 'Calgary International Airport North Cell Number Four → Spyhill Landfill Northwest Calgary Alberta' },
  { k: 'kv', a: 'Loads', b: '17 on site — Calgary International Airport North Cell Number Four Construction Entrance' },
  { k: 'cols', head: true, compact: true, cells: [{ t: 'Date' }, { t: 'km', r: 1 }, { t: 'Hours', r: 1 }, { t: 'Loads', r: 1 }, { t: 'Fuel', r: 1 }] },
  { k: 'cols', compact: true, cells: [{ t: 'Wed, Nov 5' }, { t: '221.4', r: 1 }, { t: '10.5', r: 1 }, { t: '6', r: 1 }, { t: '199.4', r: 1 }] }
]) };
const pdf = MetPdf.buildPdf(doc);
const rawPdf = Buffer.from(pdf.base64, 'base64').toString('latin1');
const PAGE_W = 595, MARGIN = 46, RIGHT = PAGE_W - MARGIN;
let ops = 0, bad = [];
rawPdf.split('\n').forEach(function (op) {
  const m = op.match(/\/(\w+) ([\d.]+) Tf .*?1 0 0 1 ([\d.]+) ([\d.]+) Tm \((.*)\) Tj/);
  if (!m) return;
  ops++;
  const w = MetPdf._textWidth(m[5].replace(/\\([()\\])/g, '$1'), parseFloat(m[2]), m[1] === 'F2');
  const x = parseFloat(m[3]);
  if (x < MARGIN - 0.6 || x + w > RIGHT + 0.6) bad.push(m[5].slice(0, 44) + ' @x=' + x + ' w=' + Math.round(w));
});
ok('the rendered manifest measures ' + ops + ' text ops', ops > 25, 'ops=' + ops);
eq('EVERY text op sits inside the margins (nothing runs off the right edge)', bad, []);
ok('the cols table ends exactly at the right margin', pdf.tables.length === 1 &&
  Math.abs(pdf.tables[0].xs[4] + pdf.tables[0].widths[4] - RIGHT) < 0.2, JSON.stringify(pdf.tables));
/* a deliberately impossible table: 20 columns must still fit */
const wide = [{ k: 'cols', head: true, cells: Array.from({ length: 20 }, function (_, i) { return { t: 'Col' + i }; }) },
  { k: 'cols', cells: Array.from({ length: 20 }, function () { return { t: '123.4', r: 1 }; }) }];
const pdf2 = MetPdf.buildPdf({ title: 'wide', lines: wide });
const t2 = pdf2.tables[0];
ok('a 20-column table scales to the page instead of running off it',
  !!t2 && t2.xs[19] + t2.widths[19] <= RIGHT + 0.2, JSON.stringify(t2 && [t2.xs[19], t2.widths[19]]));
eq('webVersion is 353', ver.webVersion, 353);
ok('index.html pins manifest.js?v=353 + pdfexport.js?v=353',
  idxSrc.indexOf('modules/manifest.js?v=353') >= 0 && idxSrc.indexOf('js/pdfexport.js?v=353') >= 0);

console.log('\nmanifest-places-summary-v353: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
