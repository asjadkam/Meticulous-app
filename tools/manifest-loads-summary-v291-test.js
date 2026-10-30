#!/usr/bin/env node
/* Meticulous v291 — MANIFEST-LOADS-SUMMARY + MANIFEST-VERBOSE
 * (owner, Oct 30, 2026 17:28 MDT, over a circled photo of
 * today's manifest): "all 17 load are dumped at one place....
 * Manifest doesn't have to give details of every single
 * load...... It can say just 17 loads on site!" and "All of
 * this writing can be trimmed down."
 *
 * His Oct 30 manifest printed THREE competing load figures —
 * a Loads headline of 20 (the shared ladder's ticket rung),
 * a "Loads counted by GPS" line of 19 (the raw geoloads
 * record), and a row for every load ("Load 1 — dumped
 * 1:34:51 p.m." …) — while his day was 17 loads, counted
 * from his pegs (the dashboard's own words all day: "Loads
 * today: 17 counted from your pegs"). And under Miles
 * (live) it printed a multi-sentence essay reconciling
 * 1.7 live km against the 85 km odometer span.
 *
 * THE LAW after this ship:
 *  - ONE loads line on the manifest: the count of record
 *    plus the site by name — "Loads: 17 on site — Simply
 *    Stone". On a PEG day the count of record is the PEG
 *    count (the geoloads record's count + the driver's
 *    correction — the figure GeoLoads.forDate()/today()
 *    carry), never the raw record and never another
 *    ladder source. The GPS-count line, its explainer and
 *    the per-load rows are GONE from the manifest
 *    entirely, on every day, in both renderers. The
 *    counting engines and the shared dayLoads ladder
 *    (invoice / Revenue) are untouched — this is the
 *    manifest's own collect + presentation.
 *  - The miles accounting keeps every fact (odometer
 *    span, live miles, untracked stretches, the
 *    post-close portion as ONE short line, the undercount
 *    remainder) in short factual lines — no essay
 *    sentences. The numbers the accounting returns
 *    (gap / bounds / residual) are unchanged.
 *  - Every other fact on today's manifest stays:
 *    dispatches + foreman total, GPS trail section, fuel
 *    & expenses, PTI lines, day-summary times, the
 *    Loaded at / Dumped at place lines, Total Earned
 *    Income.
 *
 * Fixture A = his Oct 30, shaped: Aecon Inf, card #18959
 * (ticket loads 20 — the headline's source), geoloads
 * record count 19 with corr −2 on a peg day (the peg
 * count of record: 17), both pegs at Simply Stone,
 * odo 170,664 → 170,749 (85 km), live 1.7 km, PTI pre
 * 7:21 AM / post 5:23 PM no defects, fuel Petro-Canada
 * $250. (This suite loads manifest.js without invoice.js,
 * so the collect fallback ladder runs — tickets first,
 * exactly the rung that printed his 20.)
 *
 * Run: node tools/manifest-loads-summary-v291-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const manSrc = fs.readFileSync(path.join(ROOT, 'modules', 'manifest.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* the real miles engine, wired the way the v283 suite wires it */
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

const DAY = '2026-10-30';
const T = (s) => Date.parse(DAY + 'T' + s + ':00');
const STONE = [50.96850, -114.03340];  /* Simply Stone — his Oct 30 site */
const HOME = [51.15710, -113.93862];

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
const flat = (lines) => lines.map(l => (l.k === 'kv' ? l.a + '|' + l.b : l.a || '')).join('\n');

function baseMem(geoDay, dspList) {
  return {
    mani_date: DAY,
    onboarding: { payStandard: 'Hourly', payRate: 29, ownWageRate: 29, travelBonus: 1 },
    nav_data: {
      personal: [{ name: 'Home', lat: HOME[0], lng: HOME[1] }],
      work: [{ name: 'Simply Stone', lat: STONE[0], lng: STONE[1] }]
    },
    dsp_list: dspList || [], nav_log: [], fuel_fills: [], fuel_expenses: [], dmg_reports: [],
    sessions: [], rev_entries: [], rev_extras: [], odo_readings: [], pti_reports: [],
    tracker: { status: 'idle', startTs: 0, elapsed: 0 },
    livemiles: { days: {} },
    geoloads: { days: { '2026-10-30': geoDay } }
  };
}

/* ================= (a) his Oct 30: a peg day ================= */
console.log('— (a) the peg day: ONE loads line, the peg count, the site —');
{
  const events = [];
  for (let i = 0; i < 19; i++) events.push({ t: T('13:' + ('0' + (10 + i)).slice(-2)) });
  const geoDay = {
    count: 19, corr: -2, countSource: 'pegs',
    sites: {
      load: { lat: STONE[0], lng: STONE[1], label: 'Pickup peg', src: 'peg' },
      dump: { lat: STONE[0], lng: STONE[1], label: 'Dump peg', src: 'peg' }
    },
    events: events,
    pegs: {
      load: { lat: STONE[0], lng: STONE[1], t: T('08:38') },
      dump: { lat: STONE[0], lng: STONE[1], t: T('08:45') }
    },
    pegLog: [
      { kind: 'load', t: T('08:38'), lat: STONE[0], lng: STONE[1] },
      { kind: 'dump', t: T('08:45'), lat: STONE[0], lng: STONE[1] }
    ],
    pegEvents: []
  };
  const mem = baseMem(geoDay, [{
    jobSite: 'Aecon Inf', date: DAY, scheduledAt: DAY + 'T08:00', status: 'completed',
    startedAt: DAY + 'T08:00:00', endedAt: DAY + 'T17:00:00',
    tickets: [{ cardNumber: '18959', foremanHours: 9, paymentUnit: 'HOUR', loads: 20 }]
  }]);
  mem.sessions = [{
    date: DAY, startedAt: DAY + 'T08:00:00', endedAt: DAY + 'T17:00:00',
    seconds: 32400, liveKm: 1.7, manualLoads: 0, startOdo: 170664, endOdo: 170749
  }];
  mem.fuel_fills = [{ date: DAY, station: 'Petro-Canada', cost: 250, odo: 170700 }];
  mem.pti_reports = [
    { date: DAY, kind: 'pre', filedAt: DAY + 'T07:21:00', odometer: 170664, defects: [], result: 'Pass', signed: true },
    { date: DAY, kind: 'post', filedAt: DAY + 'T17:23:00', odometer: 170749, defects: [], result: 'Pass', signed: true }
  ];
  const M = makeWorld(mem);
  const c = M._collectDay(DAY);
  eq('collect: the day\'s loads ARE the peg count — 17, not the ticket 20, not the raw 19',
    [c.loads, c.loadsSrc], [17, 'pegs']);
  eq('collect: the loads site is the day\'s place by name', c.loadsSite, 'Simply Stone');
  const doc = flat(M._docLines(DAY, c, M._toggles()));
  const loadsLines = doc.split('\n').filter(l => /^Loads\|/.test(l));
  eq('printed manifest: exactly ONE loads line', loadsLines.length, 1);
  eq('the one line: count + site', loadsLines[0], 'Loads|17 on site — Simply Stone');
  ok('no GPS-count figure anywhere on the document', !/Loads counted by GPS/.test(doc));
  ok('no per-load rows', !/^Load \d+ — dumped/m.test(doc), doc.split('\n').filter(l => /dumped/.test(l)).join(' ;; '));
  ok('no GPS explainer writing', !/Counted between the load site/.test(doc) && !/stay the record for pay/.test(doc));
  ok('the places still print by name', /^Loaded at\|Simply Stone$/m.test(doc) && /^Dumped at\|Simply Stone$/m.test(doc),
    doc.split('\n').filter(l => /Loaded|Dumped/.test(l)).join(' ;; '));
  ok('the day\'s other facts stay: odometer span', /^Odometer\|170,664 → 170,749 km \(85 km\)$/m.test(doc),
    doc.split('\n').filter(l => /Odometer/.test(l)).join(' ;; '));
  ok('the day\'s other facts stay: fuel', /^Fuel — Petro-Canada\|\$250$/m.test(doc));
  ok('the day\'s other facts stay: PTI rows', /^Pre-trip\|/m.test(doc) && /^Post-trip\|/m.test(doc));
  ok('the day\'s other facts stay: Total Earned Income', /^Total Earned Income\|/m.test(doc));

  console.log('— (a2) the screen twin agrees —');
  const body = makeBody();
  M.render(body);
  const h = body._html;
  ok('screen: the one line — 17 on site — Simply Stone',
    h.indexOf('Loads') >= 0 && h.indexOf('17 on site — Simply Stone') >= 0,
    h.slice(Math.max(0, h.indexOf('Loads') - 40), h.indexOf('Loads') + 120));
  ok('screen: no GPS-count figure', h.indexOf('Loads counted by GPS') < 0);
  ok('screen: no per-load rows', !/Load \d+ — dumped/.test(h));
  ok('screen: no GPS explainer writing', h.indexOf('Counted between the load site') < 0);

  console.log('— (a3) the miles writing on the same day is trimmed —');
  ok('the accounting exists (live 1.7 vs the 85 km span)', Array.isArray(c.milesNote) && c.milesNote.length >= 2,
    JSON.stringify(c.milesNote));
  ok('every accounting line is ONE short line (≤ 100 chars)',
    (c.milesNote || []).every(l => l.length <= 100), JSON.stringify(c.milesNote));
  ok('no essay sentences survive',
    !(c.milesNote || []).some(l => /odometer total was driven|still turn the odometer|outside the tracked hours, so it is not|only counts the ground it saw/.test(l)),
    JSON.stringify(c.milesNote));
  ok('the facts survive in the lines: live, span, difference',
    (c.milesNote || []).some(l => /Live tracking counted 1\.7 km · odometer shows 85 km · difference -83\.3 km/.test(l)),
    JSON.stringify(c.milesNote));
}

/* ================= (b) a learned GPS day: still ONE line ================= */
console.log('— (b) a no-peg day: the GPS block is gone there too —');
{
  const geoDay = {
    count: 3,
    sites: {
      load: { lat: STONE[0], lng: STONE[1], label: 'Simply Stone' },
      dump: { lat: STONE[0], lng: STONE[1], label: 'Simply Stone' }
    },
    events: [{ t: T('10:00') }, { t: T('11:00') }, { t: T('12:00') }]
  };
  const M = makeWorld(baseMem(geoDay, []));
  const c = M._collectDay(DAY);
  const doc = flat(M._docLines(DAY, c, M._toggles()));
  const loadsLines = doc.split('\n').filter(l => /^Loads\|/.test(l));
  eq('one loads line, the counted 3, the site by name', loadsLines, ['Loads|3 on site — Simply Stone']);
  ok('no GPS-count figure', !/Loads counted by GPS/.test(doc));
  ok('no per-load rows', !/^Load \d+ — dumped/m.test(doc));
}

/* ================= (c) a tickets-only day: bare count ================= */
console.log('— (c) no counting ran: the ticket count, no invented site —');
{
  const mem = baseMem(null, [{
    jobSite: 'Aecon Inf', date: DAY, scheduledAt: DAY + 'T08:00', status: 'completed',
    tickets: [{ cardNumber: '18959', foremanHours: 9, paymentUnit: 'HOUR', loads: 7 }]
  }]);
  delete mem.geoloads;
  const M = makeWorld(mem);
  const c = M._collectDay(DAY);
  const doc = flat(M._docLines(DAY, c, M._toggles()));
  const loadsLines = doc.split('\n').filter(l => /^Loads\|/.test(l));
  eq('one loads line, the ticket 7, no site suffix invented', loadsLines, ['Loads|7']);
  eq('no site on the collect either', c.loadsSite, '');
}

/* ================= (d) the accounting, driven directly ================= */
console.log('— (d) MANIFEST-VERBOSE: short lines, every fact, same numbers —');
{
  const M = makeWorld(baseMem(null, []));
  const f = M._dayMiles;
  ok('dayMilesAccounting is exported for the suite', typeof f === 'function');
  if (typeof f === 'function') {
    /* his Oct 30 shape: 85 km span, the session's driving
       ended at 170,714 — 35.0 km of the span is post-close */
    const a = f({ liveKm: 1.7, odoStart: 170664, odoEnd: 170749, crumbs: [],
      driveStartOdo: 170664, driveEndOdo: 170714 });
    eq('the trimmed lines, exactly', a && a.lines, [
      'Live tracking counted 1.7 km · odometer shows 85 km · difference -83.3 km.',
      '≈35.0 km driven after the tracked shift ended — not in the live miles.',
      'Rest ≈48.3 km — GPS undercount (short hops, yard crawls).'
    ]);
    ok('the numbers are unchanged: bounds 35.0 after, residual 48.3',
      !!a && a.boundsAfter === 35 && Math.abs(a.residual - 48.3) < 1e-9 && a.gapKm === 0,
      JSON.stringify(a && { b: a.boundsAfter, r: a.residual, g: a.gapKm }));
    const before = f({ liveKm: 40, odoStart: 170664, odoEnd: 170749, crumbs: [],
      driveStartOdo: 170700, driveEndOdo: 170749 });
    ok('a before-shift portion is ONE short line too',
      !!before && before.lines.some(l => l === '≈36.0 km driven before the tracked shift started — not in the live miles.') &&
      before.lines.every(l => l.length <= 100), JSON.stringify(before && before.lines));
    const over = f({ liveKm: 130, odoStart: 170664, odoEnd: 170749, crumbs: [],
      driveStartOdo: 170664, driveEndOdo: 170749 });
    ok('live ABOVE odometer: one short line, odometer still the record',
      !!over && over.lines.length === 2 && over.lines.every(l => l.length <= 100) &&
      /odometer stays the record/.test(over.lines[1]), JSON.stringify(over && over.lines));
    const within = f({ liveKm: 84.0, odoStart: 170664, odoEnd: 170749, crumbs: [],
      driveStartOdo: 170664, driveEndOdo: 170749 });
    ok('a day inside tolerance still prints NO accounting', within === null, JSON.stringify(within));
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
