#!/usr/bin/env node
/* Meticulous v87 — MANIFEST ODOMETER LINE + LOADS-NOTE SILENCE.
 *
 * Owner evidence (Oct 15, 2026, evening):
 *  (1) "There are no Odos on the manifest either… even though I
 *      gave you the starting and ending." His own sheet carries
 *      the start/end odometer pair every day; the manifest had
 *      two separate section lines but no day line. v87: ONE
 *      Odometer line — start → end with the day's km between
 *      them; an end that was never captured is SAID ("end not
 *      recorded"), never invented; no captures → no line. The
 *      start is the session start reading, else the day's
 *      earliest odo-bearing record (a fuel fill); a mid-day fill
 *      is NEVER promoted to the day's end.
 *  (2) "I told you yesterday that dump coordinates are usually
 *      not available on dispatch… They are verbally relayed to
 *      us on site!" The manifest printed "GPS load counting
 *      needs site coordinates on the dispatch — none were set,
 *      so no loads were GPS-counted this day." — a wrong-premise
 *      excuse blaming the driver's paperwork for an app design
 *      gap. v87 removes the blocked-reason notes from BOTH
 *      renderers: silence over blame. (The geoloads engine still
 *      records its reason on its own day record — internal data,
 *      untouched here.)
 *
 * Drives the REAL modules/manifest.js in a fake-DOM world (the
 * manifest-export harness pattern): preview HTML + the typed PDF
 * lines captured through a stubbed MetPdf.savePdf.
 *
 * Run: node tools/manifest-odo-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const manSrc = fs.readFileSync(path.join(ROOT, 'modules', 'manifest.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function has(name, hay, needle) { check(name, String(hay).indexOf(needle) >= 0, 'missing ' + JSON.stringify(needle)); }
function hasnt(name, hay, needle) { check(name, String(hay).indexOf(needle) < 0, 'should not contain ' + JSON.stringify(needle)); }

const DAY = '2026-10-15';

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
    mani_date: DAY,
    onboarding: { payStandard: 'Hourly', payRate: 29 },
    dsp_list: [], nav_log: [], fuel_fills: [], fuel_expenses: [], dmg_reports: [],
    sessions: [], rev_entries: [], rev_extras: [],
    tracker: { status: 'idle', startTs: 0, elapsed: 0 }
  };
}

function makeWorld(mem) {
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const captured = { doc: null };
  const sandbox = {
    console: console, setTimeout: setTimeout, Promise: Promise,
    App: {
      _store: store,
      _esc: function (s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
      _today: function () { return DAY; },
      tracker: mem.tracker || null
    },
    Meticulous: { modules: {} },
    MetPdf: {
      isNativeShell: function () { return false; },
      savePdf: function (doc) { captured.doc = doc; return Promise.resolve({ message: 'ok' }); }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(manSrc, sandbox, { filename: 'modules/manifest.js' });
  const body = makeBody();
  return {
    body: body, captured: captured,
    render: function () { sandbox.Meticulous.modules.manifest.render(body); },
    pdfLines: function () {
      body.querySelector('#mn_dl').onclick();
      return captured.doc ? captured.doc.lines : [];
    }
  };
}
function odoKv(lines) {
  return lines.filter(function (l) { return l.k === 'kv' && l.a === 'Odometer'; })[0] || null;
}

/* ============ (a) both captures: one line, day km between ============ */
console.log('\n— (a) start + end captured —');
{
  const mem = fixtureMem();
  mem.sessions = [{ date: DAY, endedAt: Date.parse('2026-10-15T18:30:00'), seconds: 37800, startOdo: 168759, endOdo: 168971 }];
  const w = makeWorld(mem);
  w.render();
  has('preview: one Odometer line, start → end (km)', w.body._html, '<span>Odometer</span><b>168,759 → 168,971 km (212 km)</b>');
  hasnt('preview: the old separate Start Odometer line is gone', w.body._html, 'Start Odometer');
  hasnt('preview: the old separate End Odometer line is gone', w.body._html, 'End Odometer');
  const kv = odoKv(w.pdfLines());
  check('pdf: Odometer kv carries the same text', !!kv && kv.b === '168,759 → 168,971 km (212 km)', kv && kv.b);
}

/* ============ (b) start only: the end is said, not invented ============ */
console.log('\n— (b) start captured, end never captured —');
{
  const mem = fixtureMem();
  mem.sessions = [{ date: DAY, endedAt: Date.parse('2026-10-15T18:30:00'), seconds: 37800, startOdo: 168759 }];
  const w = makeWorld(mem);
  w.render();
  has('preview: start shown, end not recorded', w.body._html, '<span>Odometer</span><b>168,759 km → end not recorded</b>');
  const kv = odoKv(w.pdfLines());
  check('pdf: same honest line', !!kv && kv.b === '168,759 km → end not recorded', kv && kv.b);
}

/* ============ (c) no captures at all: no line ============ */
console.log('\n— (c) nothing captured —');
{
  const w = makeWorld(fixtureMem());
  w.render();
  hasnt('preview: no Odometer line', w.body._html, '<div class="kv"><span>Odometer</span>');
  check('pdf: no Odometer kv', odoKv(w.pdfLines()) === null);
}

/* ============ (d) his Oct 15 shape: session start + mid-day fuel capture, end absent ============ */
console.log('\n— (d) Oct 15 shape — start 168,759, fuel capture mid-day, end absent —');
{
  const mem = fixtureMem();
  mem.sessions = [{ date: DAY, endedAt: Date.parse('2026-10-15T18:02:43'), seconds: 36163, startOdo: 168759 }];
  mem.fuel_fills = [{ date: DAY, time: '17:55', station: 'Mobil @ 1739', litres: '78.175', cost: '193.80', odo: 168905 }];
  const w = makeWorld(mem);
  w.render();
  has('preview: the line opens at the SESSION start, not the pump reading', w.body._html, '<span>Odometer</span><b>168,759 km → end not recorded</b>');
  hasnt('preview: the mid-day fill was NOT promoted to the day end', w.body._html, '168,905');
  const kv = odoKv(w.pdfLines());
  check('pdf: same — end not recorded', !!kv && kv.b === '168,759 km → end not recorded', kv && kv.b);
}

/* ============ (e) no session reading: the day's earliest record stands in ============ */
console.log('\n— (e) fill-only day —');
{
  const mem = fixtureMem();
  mem.fuel_fills = [
    { date: DAY, time: '17:55', station: 'Mobil @ 1739', litres: '78.175', cost: '193.80', odo: 168905 },
    { date: DAY, time: '09:12', station: 'Shell', litres: '40', cost: '99.00', odo: 168800 }
  ];
  const w = makeWorld(mem);
  w.render();
  has('preview: the EARLIEST fill reading is the start (odo only moves up)', w.body._html, '<span>Odometer</span><b>168,800 km → end not recorded</b>');
}

/* ============ (f) Item 3: GPS-blocked day — silence, in both renderers ============ */
console.log('\n— (f) geoloads blocked day: no excuse text anywhere —');
['no-site-coords', 'one-site', 'sites-too-close', 'learning', 'ambiguous-dump'].forEach(function (reason) {
  const mem = fixtureMem();
  mem.geoloads = { days: {} };
  mem.geoloads.days[DAY] = { blocked: reason, count: 0 };
  const w = makeWorld(mem);
  w.render();
  const flat = JSON.stringify(w.pdfLines());
  check('preview silent for blocked=' + reason,
    w.body._html.indexOf('GPS load counting needs') < 0 &&
    w.body._html.indexOf('site coordinates on the dispatch') < 0 &&
    w.body._html.indexOf('Loads counted by GPS') < 0);
  check('pdf silent for blocked=' + reason,
    flat.indexOf('GPS load counting needs') < 0 &&
    flat.indexOf('site coordinates on the dispatch') < 0 &&
    flat.indexOf('Loads counted by GPS') < 0);
});
check('source: the wrong-premise sentence is gone from manifest.js',
  manSrc.indexOf('GPS load counting needs site coordinates on the dispatch') < 0);
check('source: GEOLOAD_BLOCKED no longer exists in manifest.js', manSrc.indexOf('GEOLOAD_BLOCKED') < 0 ||
  manSrc.indexOf('var GEOLOAD_BLOCKED') < 0);

/* ============ (g) the section toggle still rules the line ============ */
console.log('\n— (g) Odometer section OFF —');
{
  const mem = fixtureMem();
  mem.mft_sections = { odo: false };
  mem.sessions = [{ date: DAY, endedAt: Date.parse('2026-10-15T18:30:00'), seconds: 37800, startOdo: 168759, endOdo: 168971 }];
  const w = makeWorld(mem);
  w.render();
  hasnt('preview: no Odometer line when the section is off', w.body._html, '<div class="kv"><span>Odometer</span>');
  check('pdf: no Odometer kv when the section is off', odoKv(w.pdfLines()) === null);
}

console.log('\nmanifest-odo test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
