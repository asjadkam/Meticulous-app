#!/usr/bin/env node
/* Meticulous v283 — MANIFEST-PEG-PLACES (owner, Oct 29, 2026
 * 14:26 MDT): "make sure these pig pickups and pig dumps are
 * gonna go on the manifest. as where it's being loaded and
 * where it's being dumped."
 *
 * v282 (LOADS-SITE-PEGS) marked peg days in the DATA only
 * (countSource on the day record) — the manifest itself never
 * showed WHERE the day loaded or dumped. THE LAW after this
 * ship:
 *  - A peg day's manifest carries "Loaded at" / "Dumped at"
 *    lines naming the day's pegged places, in BOTH renderers
 *    (the printed docLines document AND the screen twin
 *    dayBodyHtml), right with the day's load lines.
 *  - Places print by NAME — the manifest's own resolver
 *    (placeNameFor: saved places, built-in pits, learned-pair
 *    labels). A peg at a place the app has never seen prints
 *    its peg TIME instead ("Pegged pickup — 2:14 PM").
 *    A peg's coordinates NEVER print.
 *  - Mid-day re-pegs: every DISTINCT place per role, in the
 *    order pegged (a re-tap at the same place — same name, or
 *    within the peg counter's own 30 m — is the same place
 *    and shows once).
 *  - Days without pegs: no Loaded/Dumped-at lines, manifest
 *    exactly as before.
 *  - The peg moves themselves must carry their place: from
 *    this ship GeoLoads.setPeg logs { kind, t, lat, lng } in
 *    the day's pegLog (pre-v283 entries carry kind+t only;
 *    those days resolve from the day's final pegs — no place
 *    is invented for a move whose spot was never recorded).
 *
 * Run: node tools/manifest-peg-places-v283-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const manSrc = fs.readFileSync(path.join(ROOT, 'modules', 'manifest.js'), 'utf8');
const geoSrc = fs.readFileSync(path.join(ROOT, 'js', 'geoloads.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* the real miles engine, wired the way the v275 suite wires it */
function extract(file, beginMark, endMark) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found in ' + file);
  return src.slice(a, b + 2);
}
const msb = {};
vm.createContext(msb);
vm.runInContext(extract('js/miles.js', 'MILES-ENGINE-BEGIN', 'MILES-ENGINE-END'), msb);
const ENGINE = msb.ENGINE;
if (!ENGINE || typeof ENGINE.reconcileMiles !== 'function') throw new Error('miles engine not extracted');

const DAY = '2026-10-29';
const T = (s) => Date.parse(DAY + 'T' + s + ':00');
const HOME = [51.15710, -113.93862];
const PIT_A = [51.00874, -114.02517];   /* saved as 'Stoney Trail Aggregate' */
const PIT_A2 = [51.00883, -114.02517];  /* ~10 m from PIT_A — the same place */
const DUMP_A = [50.96850, -114.03340];  /* saved as 'Simply Stone' */
const PIT_B = [50.72282, -114.18856];   /* saved as 'Aecon Gravel Pit' */
const FAR1 = [51.23456, -113.76543];    /* a place the app has never seen */
const FAR2 = [51.23465, -113.76543];    /* ~10 m from FAR1 — the same place */
const FAR3 = [51.23906, -113.76543];    /* ~500 m from FAR1 — a new place */

function baseMem(geoDay) {
  return {
    mani_date: DAY,
    onboarding: { payStandard: 'Hourly', payRate: 29, ownWageRate: 29, travelBonus: 1 },
    nav_data: {
      personal: [{ name: 'Home', lat: HOME[0], lng: HOME[1] }],
      work: [
        { name: 'Stoney Trail Aggregate', lat: PIT_A[0], lng: PIT_A[1] },
        { name: 'Simply Stone', lat: DUMP_A[0], lng: DUMP_A[1] },
        { name: 'Aecon Gravel Pit', lat: PIT_B[0], lng: PIT_B[1] }
      ]
    },
    dsp_list: [], nav_log: [], fuel_fills: [], fuel_expenses: [], dmg_reports: [],
    sessions: [], rev_entries: [], rev_extras: [], odo_readings: [], pti_reports: [],
    tracker: { status: 'idle', startTs: 0, elapsed: 0 },
    livemiles: { days: {} },
    geoloads: { days: { '2026-10-29': geoDay } }
  };
}
function makeWorld(mem) {
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const sandbox = {
    console: console, setTimeout: setTimeout, Promise: Promise,
    App: {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s); },
      _today: function () { return DAY; },
      tracker: mem.tracker, userRole: function () { return 'both'; }
    },
    LiveMiles: { reportLines: ENGINE.reportLines, _engine: ENGINE },
    Meticulous: { modules: {} }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(manSrc, sandbox, { filename: 'modules/manifest.js' });
  return sandbox.Meticulous.modules.manifest;
}
function makeBody() { /* the pti-v247 body stub, verbatim pattern */
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
const flat = (lines) => lines.map(l => (l.k === 'kv' ? l.a + '|' + l.b : l.a || '')).join('\n');
const COORD = /\d{2}\.\d{3,}/;   /* a coordinate-shaped number (51.00874, -113.76543) */

/* ================= (w) the writer: peg moves carry their place ============ */
console.log('— (w) GeoLoads.setPeg logs the peg’s place in the pegLog —');
{
  const geoData = {
    nav_data: { personal: [{ name: 'Home', lat: HOME[0], lng: HOME[1] }], work: [], recent: [] },
    dsp_list: []
  };
  const gStore = {
    get: function (k, d) { return (k in geoData) ? JSON.parse(JSON.stringify(geoData[k])) : d; },
    set: function (k, v) { geoData[k] = JSON.parse(JSON.stringify(v)); }
  };
  const sb = { console: console, Date: Date, Math: Math, JSON: JSON };
  sb.window = sb;
  let handler = null;
  sb.LiveMiles = { available: function () { return true; }, subscribe: function (fn) { handler = fn; } };
  sb.App = { _store: gStore };
  vm.createContext(sb);
  vm.runInContext(geoSrc, sb);
  const GL = sb.GeoLoads;
  const NOW = new Date();
  const T0 = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 6, 0, 0).getTime();
  const dstr = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
  GL.startDay('s' + T0, {});
  handler({ latitude: PIT_A[0], longitude: PIT_A[1], accuracy: 8, time: T0 + 3600000 });
  const rp = GL.setPeg('load');
  handler({ latitude: DUMP_A[0], longitude: DUMP_A[1], accuracy: 8, time: T0 + 3900000 });
  const rd = GL.setPeg('dump');
  ok('both pegs land', !!(rp && rp.ok && rd && rd.ok), JSON.stringify({ rp: rp, rd: rd }));
  const fd = GL.forDate(dstr(T0));
  ok('pegLog has both moves', !!(fd && Array.isArray(fd.pegLog) && fd.pegLog.length === 2), JSON.stringify(fd && fd.pegLog));
  ok('every pegLog entry carries its lat/lng',
    !!(fd && fd.pegLog.every(e => isFinite(e.lat) && isFinite(e.lng))), JSON.stringify(fd && fd.pegLog));
  ok('the logged places are the pegged spots',
    !!(fd && Math.abs(fd.pegLog[0].lat - PIT_A[0]) < 1e-9 && Math.abs(fd.pegLog[0].lng - PIT_A[1]) < 1e-9 &&
       Math.abs(fd.pegLog[1].lat - DUMP_A[0]) < 1e-9 && Math.abs(fd.pegLog[1].lng - DUMP_A[1]) < 1e-9),
    JSON.stringify(fd && fd.pegLog));
}

/* ================= (a) a peg day: both places, by name ==================== */
console.log('— (a) peg day: the manifest names where it loaded and dumped —');
{
  const geoDay = {
    count: 4, countSource: 'pegs',
    sites: {
      load: { lat: PIT_A[0], lng: PIT_A[1], label: 'Pickup peg', src: 'peg' },
      dump: { lat: DUMP_A[0], lng: DUMP_A[1], label: 'Dump peg', src: 'peg' }
    },
    events: [],
    pegs: {
      load: { lat: PIT_A[0], lng: PIT_A[1], t: T('08:12') },
      dump: { lat: DUMP_A[0], lng: DUMP_A[1], t: T('08:15') }
    },
    pegLog: [
      { kind: 'load', t: T('08:12'), lat: PIT_A[0], lng: PIT_A[1] },
      { kind: 'dump', t: T('08:15'), lat: DUMP_A[0], lng: DUMP_A[1] }
    ]
  };
  const M = makeWorld(baseMem(geoDay));
  const c = M._collectDay(DAY);
  eq('collect carries both peg places by name', c.pegPlaces,
    { load: ['Stoney Trail Aggregate'], dump: ['Simply Stone'] });
  const doc = flat(M._docLines(DAY, c, M._toggles()));
  ok('printed manifest: Loaded at|Stoney Trail Aggregate', doc.split('\n').indexOf('Loaded at|Stoney Trail Aggregate') !== -1,
    doc.split('\n').filter(l => /Loaded|Dumped/.test(l)).join(' ;; '));
  ok('printed manifest: Dumped at|Simply Stone', doc.split('\n').indexOf('Dumped at|Simply Stone') !== -1,
    doc.split('\n').filter(l => /Loaded|Dumped/.test(l)).join(' ;; '));
  ok('no coordinates on the peg lines',
    !doc.split('\n').filter(l => /Loaded at|Dumped at/.test(l)).some(l => COORD.test(l)),
    doc.split('\n').filter(l => /Loaded at|Dumped at/.test(l)).join(' ;; '));
  const body = makeBody();
  M.render(body);
  ok('screen manifest shows Loaded at + the pit name',
    /Loaded at/.test(body._html) && body._html.indexOf('Stoney Trail Aggregate') !== -1, body._html.slice(0, 0));
  ok('screen manifest shows Dumped at + the dump name',
    /Dumped at/.test(body._html) && body._html.indexOf('Simply Stone') !== -1);
}

/* ============ (a2) a legacy v282 day: log has no places ============ */
console.log('— (a2) pre-v283 pegLog (kind + t only): the day’s final pegs still name —');
{
  const geoDay = {
    count: 2, countSource: 'pegs',
    sites: {
      load: { lat: PIT_A[0], lng: PIT_A[1], label: 'Pickup peg', src: 'peg' },
      dump: { lat: DUMP_A[0], lng: DUMP_A[1], label: 'Dump peg', src: 'peg' }
    },
    events: [],
    pegs: {
      load: { lat: PIT_A[0], lng: PIT_A[1], t: T('08:12') },
      dump: { lat: DUMP_A[0], lng: DUMP_A[1], t: T('08:15') }
    },
    pegLog: [ { kind: 'load', t: T('08:12') }, { kind: 'dump', t: T('08:15') } ]
  };
  const M = makeWorld(baseMem(geoDay));
  const c = M._collectDay(DAY);
  eq('final pegs resolve even when the log carries no places', c.pegPlaces,
    { load: ['Stoney Trail Aggregate'], dump: ['Simply Stone'] });
}

/* ============ (b) an unnamed peg: the time label, never coordinates ======= */
console.log('— (b) a peg where the app knows no place: peg time, no coordinates —');
{
  const geoDay = {
    count: 1, countSource: 'pegs',
    sites: { load: { lat: FAR1[0], lng: FAR1[1], label: 'Pickup peg', src: 'peg' }, dump: null },
    events: [],
    pegs: { load: { lat: FAR1[0], lng: FAR1[1], t: T('14:14') }, dump: null },
    pegLog: [ { kind: 'load', t: T('14:14'), lat: FAR1[0], lng: FAR1[1] } ]
  };
  const M = makeWorld(baseMem(geoDay));
  const c = M._collectDay(DAY);
  eq('the unnamed pickup peg falls back to its peg time', c.pegPlaces,
    { load: ['Pegged pickup — 2:14 PM'], dump: [] });
  const doc = flat(M._docLines(DAY, c, M._toggles()));
  ok('printed manifest carries the time label', doc.split('\n').indexOf('Loaded at|Pegged pickup — 2:14 PM') !== -1,
    doc.split('\n').filter(l => /Loaded|Dumped/.test(l)).join(' ;; '));
  ok('no Dumped at line for a role never pegged', !/^Dumped at\|/m.test(doc));
  ok('no coordinate-shaped number anywhere in the document', !COORD.test(doc),
    doc.split('\n').filter(l => COORD.test(l)).join(' ;; '));
}

/* ============ (c) a re-peg day: every distinct place, in order =========== */
console.log('— (c) mid-day job change: both pickup places, in peg order —');
{
  const geoDay = {
    count: 6, countSource: 'pegs',
    sites: {
      load: { lat: PIT_B[0], lng: PIT_B[1], label: 'Pickup peg', src: 'peg' },
      dump: { lat: DUMP_A[0], lng: DUMP_A[1], label: 'Dump peg', src: 'peg' }
    },
    events: [],
    pegs: {
      load: { lat: PIT_B[0], lng: PIT_B[1], t: T('13:20') },
      dump: { lat: DUMP_A[0], lng: DUMP_A[1], t: T('08:09') }
    },
    pegLog: [
      { kind: 'load', t: T('08:05'), lat: PIT_A[0], lng: PIT_A[1] },
      { kind: 'dump', t: T('08:09'), lat: DUMP_A[0], lng: DUMP_A[1] },
      { kind: 'load', t: T('10:40'), lat: PIT_A2[0], lng: PIT_A2[1] },  /* same place re-tapped */
      { kind: 'load', t: T('13:20'), lat: PIT_B[0], lng: PIT_B[1] }    /* the job changed */
    ]
  };
  const M = makeWorld(baseMem(geoDay));
  const c = M._collectDay(DAY);
  eq('both distinct pickup places, in order; the same-place re-tap shows once',
    c.pegPlaces && c.pegPlaces.load, ['Stoney Trail Aggregate', 'Aecon Gravel Pit']);
  const doc = flat(M._docLines(DAY, c, M._toggles()));
  ok('printed manifest: Loaded at|Stoney Trail Aggregate → Aecon Gravel Pit',
    doc.split('\n').indexOf('Loaded at|Stoney Trail Aggregate → Aecon Gravel Pit') !== -1,
    doc.split('\n').filter(l => /Loaded|Dumped/.test(l)).join(' ;; '));
}
console.log('— (c2) unnamed re-pegs: 10 m is the same place, 500 m is a new one —');
{
  const geoDay = {
    count: 3, countSource: 'pegs',
    sites: { load: { lat: FAR3[0], lng: FAR3[1], label: 'Pickup peg', src: 'peg' }, dump: null },
    events: [],
    pegs: { load: { lat: FAR3[0], lng: FAR3[1], t: T('11:30') }, dump: null },
    pegLog: [
      { kind: 'load', t: T('09:00'), lat: FAR1[0], lng: FAR1[1] },
      { kind: 'load', t: T('09:25'), lat: FAR2[0], lng: FAR2[1] },
      { kind: 'load', t: T('11:30'), lat: FAR3[0], lng: FAR3[1] }
    ]
  };
  const M = makeWorld(baseMem(geoDay));
  const c = M._collectDay(DAY);
  eq('unnamed places dedupe by ground, not by label', c.pegPlaces && c.pegPlaces.load,
    ['Pegged pickup — 9:00 AM', 'Pegged pickup — 11:30 AM']);
}

/* ============ (d) a no-peg day: the manifest is untouched ================= */
console.log('— (d) no pegs: no Loaded/Dumped-at lines, the day renders as before —');
{
  const geoDay = {
    count: 3,
    sites: {
      load: { lat: PIT_A[0], lng: PIT_A[1], label: 'East Ivor' },
      dump: { lat: DUMP_A[0], lng: DUMP_A[1], label: 'East Ivor' }
    },
    events: []
  };
  const M = makeWorld(baseMem(geoDay));
  const c = M._collectDay(DAY);
  ok('collect carries no peg places', c.pegPlaces === null || c.pegPlaces === undefined,
    JSON.stringify(c.pegPlaces));
  const doc = flat(M._docLines(DAY, c, M._toggles()));
  ok('no Loaded at / Dumped at lines', !/^Loaded at\|/m.test(doc) && !/^Dumped at\|/m.test(doc));
  ok('v291: the GPS loads block no longer prints — the one loads line only', !/Loads counted by GPS/.test(doc) && !/^Load \d+ — dumped/m.test(doc));
  const body = makeBody();
  M.render(body);
  ok('screen manifest: no Loaded at / Dumped at either',
    body._html.indexOf('Loaded at') === -1 && body._html.indexOf('Dumped at') === -1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
