#!/usr/bin/env node
/* Meticulous v299 — the Oct 31 manifest pass (owner, Oct 31,
 * 2026 14:22–14:28 MDT, over his printed Oct 31 manifest,
 * the jargon block circled in red by him):
 *
 *  1. MANIFEST-JARGON-BLOCK — "So much of this technical
 *     jargon is not needed": the Day summary's Miles (live)
 *     discrepancy essay (the v275 day accounting: headline,
 *     untracked stretches, before/after-shift lines, the
 *     closing reconciliation) is GONE from the manifest —
 *     print and preview. The clean facts stay: the Odometer
 *     line, the Miles (live) figure, the GPS distance.
 *     collect no longer computes an accounting at all
 *     (milesNote is gone; _dayMiles is gone).
 *  2. MANIFEST-ODO-START-DAY — today's Odometer line read
 *     "170,664 → 170,951 km (287 km)": 170,664 is Oct 30's
 *     PRE-trip reading. Proven in collect: the sessions loop
 *     took the FIRST session entry carrying a startOdo —
 *     a non-driving fragment's stale snapshot — while the
 *     day's real driving session started at 170,749 (the
 *     essay's own bounds math proves it: boundsBefore was
 *     exactly the 85 km between the two). The day's start
 *     is now the earliest startOdo among the day's DRIVING
 *     sessions (liveKm ≥ 1 — the v275 "real driving
 *     session" test); the first-session rule survives only
 *     as the fallback for a day nothing drove.
 *  3. MANIFEST-PEG-NAMES + 6. PEG-IS-THE-DAYS-TRUTH — the
 *     route section printed bare "Pickup peg" / "Dump peg";
 *     a peg's place is resolved by name (his navigation
 *     destinations and his saved places outrank learned
 *     labels and built-ins), and a stop at a peg IS that
 *     peg's site.
 *  4. MANIFEST-HAUL-SUMMARY-LINE — the haul cycles no
 *     longer print stop-by-stop: they collapse into ONE
 *     line per pickup–dump pairing in the route section,
 *     "Remington – Dog Park · N loads". Genuine stops stay.
 *  5. MANIFEST-WRONG-PLACE-NAME — "Maple Ridge" (a built-in
 *     pit a few hundred metres off) named his Remington
 *     arrival stop because naming was one nearest-within-
 *     250 m pool with no navigation truth; "Nitestar" (a
 *     learned label) named the Petro at Road King stop the
 *     same way. Naming now runs: the day's pegs → the day's
 *     counted sites (real labels) → today's NAVIGATION
 *     destinations → his saved places → built-ins/learned
 *     labels → the navigation log by time.
 *
 * Fixtures are his Oct 31, shaped: Aecon Inf → Remington,
 * card #16231, pegs at the Remington load face and the
 * Dog Park dump (51.01965, -114.00539), 3 counted cycles,
 * the 46-minute site wait near the old entrance, the
 * 1:43 PM fuel stop at the Petro at Road King (Barlow).
 *
 * Run: node tools/manifest-jargon-peg-v299-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const manSrc = fs.readFileSync(path.join(ROOT, 'modules', 'manifest.js'), 'utf8');
const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* the real miles engine, wired the way the v275/v283 suites wire it */
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
      _today: function () { return mem.mani_date; },
      tracker: mem.tracker, userRole: function () { return 'both'; }
    },
    LiveMiles: { reportLines: ENGINE.reportLines, _engine: ENGINE },
    Meticulous: { modules: { navigation: { builtinPlaces: function () {
      return [{ name: 'Builtin Pit', lat: 50.50000, lng: -113.50000 }];
    } } } }
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
const iso = (ms) => new Date(ms).toISOString();

/* a crumb trail from a stop script: legs at 100-second crumbs,
   a dwell = two crumbs at the same point bracketing it (the
   trailStops ≥4-minute rule then sees the stop) */
function buildTrail(day, t0min, spec) {
  const out = [];
  let t = Date.parse(day + 'T' + t0min + ':00');
  const push = (ms, pt) => out.push({ t: ms, a: pt[0], o: pt[1] });
  const lerp = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  let cur = spec[0].pt;
  push(t, cur);
  for (let i = 1; i < spec.length; i++) {
    const s = spec[i];
    const tArr = t + s.travel * 60000;
    for (let ms = t + 100000; ms < tArr; ms += 100000) push(ms, lerp(cur, s.pt, (ms - t) / (tArr - t)));
    push(tArr, s.pt);
    t = tArr;
    if (s.dwell) { t += s.dwell * 60000; push(t, s.pt); }
    cur = s.pt;
  }
  return out;
}

const JARGON = /Live tracking counted|untracked between|driven before the tracked shift|driven after the tracked shift|explains the difference|GPS undercount|Miles discrepancy/;

/* ============ 1. the jargon block is gone (Oct 26 shape) ============ */
console.log('— 1. MANIFEST-JARGON-BLOCK: facts stay, the essay goes —');
{
  const DAY = '2026-10-26';
  const T = (s) => Date.parse(DAY + 'T' + s + ':00');
  const HOME = [51.15710, -113.93862], PIT = [51.00874, -114.02517];
  const crumbs = [];
  for (let ms = T('08:02'); ms <= T('17:58'); ms += 540000) {
    const f = (ms - T('08:02')) / (T('17:58') - T('08:02'));
    crumbs.push({ t: ms, a: HOME[0] + (PIT[0] - HOME[0]) * f, o: HOME[1] + (PIT[1] - HOME[1]) * f });
  }
  const mem = {
    mani_date: DAY,
    onboarding: { payStandard: 'Hourly', payRate: 29, ownWageRate: 29, travelBonus: 1 },
    nav_data: { personal: [{ name: 'Home', lat: HOME[0], lng: HOME[1] }], work: [] },
    dsp_list: [], nav_log: [], fuel_fills: [], fuel_expenses: [], dmg_reports: [],
    sessions: [{ date: DAY, endedAt: iso(T('18:00')), seconds: 36000, liveKm: 40,
      startOdo: 100000, endOdo: 100112, milesStatus: 'discrepancy',
      milesReport: ENGINE.reconcileMiles({ liveKm: 40, startOdo: 100000, endOdo: 100112, crumbs: crumbs }) }],
    rev_entries: [], rev_extras: [],
    odo_readings: [{ ts: T('07:18'), value: 100000 }, { ts: T('18:05'), value: 100112 }],
    pti_reports: [],
    tracker: { status: 'idle', startTs: 0, elapsed: 0 },
    livemiles: { days: { s1: { date: DAY, hasFix: true, crumbs: crumbs } } },
    geoloads: { days: {} }
  };
  const M = makeWorld(mem);
  const c = M._collectDay(DAY);
  ok('collect carries NO accounting (milesNote is gone)', c.milesNote === undefined || c.milesNote === null,
    JSON.stringify(c.milesNote));
  const doc = flat(M._docLines(DAY, c, M._toggles()));
  ok('the printed day keeps its Odometer line', /^Odometer\|100,000 → 100,112 km \(112 km\)$/m.test(doc),
    doc.split('\n').filter(l => /Odometer/.test(l)).join(' ;; '));
  ok('the printed day keeps Miles (live)', /^Miles \(live\)\|40\.0 km$/m.test(doc));
  ok('the printed day keeps the GPS distance', /^GPS distance\|40\.0 km$/m.test(doc),
    doc.split('\n').filter(l => /GPS/.test(l)).join(' ;; '));
  ok('NO jargon anywhere in the printed document', !JARGON.test(doc),
    doc.split('\n').filter(l => JARGON.test(l)).join(' ;; '));
  const body = makeBody();
  M.render(body);
  ok('NO jargon anywhere on the screen either', !JARGON.test(body._html));
  ok('the screen shows no discrepancy details block', body._html.indexOf('<details') === -1);
  ok('the accounting function itself is gone', M._dayMiles === undefined);
}

/* ============ 2. the day's odometer starts at the day's own first reading ============ */
console.log('— 2. MANIFEST-ODO-START-DAY: a fragment\'s stale snapshot never starts the day —');
{
  const DAY = '2026-10-31';
  const T = (s) => Date.parse(DAY + 'T' + s + ':00');
  const readings = [
    { ts: Date.parse('2026-10-30T07:21:00'), value: 170664 },  /* Oct 30 pre-trip */
    { ts: Date.parse('2026-10-30T17:23:00'), value: 170749 },  /* Oct 30 post-trip */
    { ts: T('07:06'), value: 170749 },                          /* Oct 31 pre-trip */
    { ts: T('14:20'), value: 170951 }                           /* Oct 31 post-trip */
  ];
  const base = {
    mani_date: DAY,
    onboarding: { payStandard: 'Hourly', payRate: 29, ownWageRate: 29, travelBonus: 1 },
    nav_data: { personal: [], work: [] },
    dsp_list: [], nav_log: [], fuel_fills: [], fuel_expenses: [], dmg_reports: [],
    rev_entries: [], rev_extras: [], odo_readings: readings, pti_reports: [],
    tracker: { status: 'idle', startTs: 0, elapsed: 0 },
    livemiles: { days: {} }, geoloads: { days: {} }
  };
  const mem = JSON.parse(JSON.stringify(base));
  mem.sessions = [
    /* the fragment comes FIRST in the stored array — the
       pre-fix loop took its stale 170,664 on sight */
    { date: DAY, endedAt: iso(T('09:00')), seconds: 600, liveKm: 0.4, startOdo: 170664, endOdo: 170700 },
    { date: DAY, endedAt: iso(T('17:30')), seconds: 32400, liveKm: 151.8, startOdo: 170749, endOdo: 170951 }
  ];
  const M = makeWorld(mem);
  const c = M._collectDay(DAY);
  eq('the day starts at its OWN first reading — 170,749, not yesterday\'s 170,664', c.odoStart, 170749);
  eq('the day ends at its own close — 170,951', c.odoEnd, 170951);
  const doc = flat(M._docLines(DAY, c, M._toggles()));
  ok('the printed span is the true 202 km', /^Odometer\|170,749 → 170,951 km \(202 km\)$/m.test(doc),
    doc.split('\n').filter(l => /Odometer/.test(l)).join(' ;; '));

  const mem2 = JSON.parse(JSON.stringify(base));
  mem2.sessions = [
    { date: DAY, endedAt: iso(T('09:00')), seconds: 600, liveKm: 0.4, startOdo: 170664, endOdo: 170700 }
  ];
  const c2 = makeWorld(mem2)._collectDay(DAY);
  eq('a day nothing drove keeps the only start it has (the fallback stands)', c2.odoStart, 170664);
}

/* ============ 3+4+5+6. peg names, the haul summary, true place names ============ */
console.log('— 3/4/5/6. the Oct 31 shape: pegs by name, cycles in ONE line, his names win —');
{
  const DAY = '2026-10-31';
  const T = (s) => Date.parse(DAY + 'T' + s + ':00');
  const HOME = [51.15710, -113.93862];
  const LOAD_PT = [50.95595, -114.02548];            /* his load peg */
  const DUMP_PT = [51.01965, -114.00539];            /* his dump peg */
  const REM_SAVED = [50.956372, -114.026439];        /* his saved Remington (~82 m from the peg) */
  const REM_NAV = [50.9605833, -114.0300000];        /* the Remington entry he navigated to */
  const MAPLE = [50.96044, -114.03176];              /* the neighbouring place that stole the stop */
  const WAIT_PT = [50.96000, -114.02900];            /* the 46-min site wait, near the old entrance */
  const FUEL_PT = [51.01010, -114.00370];            /* the 1:43 PM fuel stop */
  const PETRO_SAVED = [51.01154, -114.00370];        /* his "Petro at Road King" (~160 m off) */
  const NITESTAR = [51.01074, -114.00370];           /* a learned label ~45 m off the same stop */
  const DOGPARK = [51.019965, -114.00539];           /* Dog Park — a place he navigated to */
  const crumbs = buildTrail(DAY, '06:54', [
    { pt: HOME },
    { pt: WAIT_PT, travel: 71, dwell: 46 },
    { pt: LOAD_PT, travel: 9, dwell: 6 },
    { pt: DUMP_PT, travel: 22, dwell: 8 },
    { pt: LOAD_PT, travel: 19, dwell: 9 },
    { pt: DUMP_PT, travel: 26, dwell: 8 },
    { pt: LOAD_PT, travel: 102, dwell: 7 },
    { pt: DUMP_PT, travel: 38, dwell: 7 },
    { pt: FUEL_PT, travel: 31, dwell: 9 },
    { pt: HOME, travel: 24 }
  ]);
  const mem = {
    mani_date: DAY,
    onboarding: { payStandard: 'Hourly', payRate: 29, ownWageRate: 29, travelBonus: 1 },
    nav_data: {
      personal: [{ name: 'Home', lat: HOME[0], lng: HOME[1] }],
      work: [
        { name: 'Remington', lat: REM_SAVED[0], lng: REM_SAVED[1] },
        { name: 'Maple Ridge', lat: MAPLE[0], lng: MAPLE[1] },
        { name: 'Petro at Road King', lat: PETRO_SAVED[0], lng: PETRO_SAVED[1] }
      ],
      recent: [
        { kind: 'work', name: 'Remington', lat: REM_NAV[0], lng: REM_NAV[1], ts: T('07:50') },
        { kind: 'work', name: 'Dog Park', lat: DOGPARK[0], lng: DOGPARK[1], ts: T('09:20') }
      ]
    },
    geoload_pairs: { pairs: { k1: { dump: { lat: NITESTAR[0], lng: NITESTAR[1], label: 'Nitestar' } } } },
    dsp_list: [{
      date: DAY, scheduledAt: DAY + 'T08:00:00', status: 'completed', endedAt: iso(T('14:30')),
      jobSite: 'Remington', material: '',
      tickets: [{ cardNumber: '16231', foremanHours: 6, startTime: '8:00 AM', finishTime: '2:00 PM' }]
    }],
    nav_log: [], fuel_fills: [], fuel_expenses: [], dmg_reports: [],
    sessions: [{ date: DAY, endedAt: iso(T('17:30')), seconds: 32400, liveKm: 151.8,
      startOdo: 170749, endOdo: 170951 }],
    rev_entries: [], rev_extras: [],
    odo_readings: [
      { ts: Date.parse('2026-10-30T07:21:00'), value: 170664 },
      { ts: Date.parse('2026-10-30T17:23:00'), value: 170749 },
      { ts: T('07:06'), value: 170749 }, { ts: T('14:20'), value: 170951 }
    ],
    pti_reports: [
      { date: DAY, kind: 'pre', filedAt: T('07:06'), odometer: 170749, result: 'none', defects: [], signed: true },
      { date: DAY, kind: 'post', filedAt: T('14:20'), odometer: 170951, result: 'none', defects: [], signed: true }
    ],
    tracker: { status: 'idle', startTs: 0, elapsed: 0 },
    livemiles: { days: { s1: { date: DAY, hasFix: true, crumbs: crumbs } } },
    geoloads: { days: { '2026-10-31': {
      count: 3, corr: 0, countSource: 'pegs',
      sites: {
        load: { lat: LOAD_PT[0], lng: LOAD_PT[1], label: 'Pickup peg', src: 'peg' },
        dump: { lat: DUMP_PT[0], lng: DUMP_PT[1], label: 'Dump peg', src: 'peg' }
      },
      pegs: {
        load: { lat: LOAD_PT[0], lng: LOAD_PT[1], t: T('09:05') },
        dump: { lat: DUMP_PT[0], lng: DUMP_PT[1], t: T('09:34') }
      },
      pegLog: [
        { kind: 'load', t: T('09:05'), lat: LOAD_PT[0], lng: LOAD_PT[1] },
        { kind: 'dump', t: T('09:34'), lat: DUMP_PT[0], lng: DUMP_PT[1] }
      ],
      pegEvents: [
        { kind: 'load', t: T('09:05'), lat: LOAD_PT[0], lng: LOAD_PT[1] },
        { kind: 'dump', t: T('09:34'), lat: DUMP_PT[0], lng: DUMP_PT[1] },
        { kind: 'load', t: T('10:01'), lat: LOAD_PT[0], lng: LOAD_PT[1] },
        { kind: 'dump', t: T('10:36'), lat: DUMP_PT[0], lng: DUMP_PT[1] },
        { kind: 'load', t: T('12:25'), lat: LOAD_PT[0], lng: LOAD_PT[1] },
        { kind: 'dump', t: T('13:10'), lat: DUMP_PT[0], lng: DUMP_PT[1] }
      ]
    } } }
  };
  const M = makeWorld(mem);
  const c = M._collectDay(DAY);
  eq('the peg places resolve by name — the dump peg is Dog Park (his navigation)',
    c.pegPlaces, { load: ['Remington'], dump: ['Dog Park'] });
  eq('the day\'s loads stay the count of record', [c.loads, c.loadsSite], [3, 'Remington']);
  eq('the haul cycles collapse into ONE pairing line',
    (c.haulLines || []).map(h => ({ from: h.from, to: h.to, n: h.n })),
    [{ from: 'Remington', to: 'Dog Park', n: 3 }]);
  eq('the route keeps only the genuine stops — the site wait and the fuel stop',
    (c.routeStops || []).map(s => s.label), ['Remington', 'Petro at Road King']);
  const doc = flat(M._docLines(DAY, c, M._toggles()));
  const haulRows = doc.split('\n').filter(l => /–/.test(l) && /loads?$/.test(l));
  eq('the printed route carries the ONE summary line, in his format',
    haulRows, ['Remington – Dog Park|3 loads']);
  ok('the site wait prints as Remington — the place he navigated to, not Maple Ridge',
    doc.split('\n').some(l => /^Remington\|/.test(l) && /46 min/.test(l)),
    doc.split('\n').filter(l => /Remington|Maple/.test(l)).join(' ;; '));
  ok('the fuel stop prints with HIS name — Petro at Road King, not Nitestar',
    doc.split('\n').some(l => /^Petro at Road King\|/.test(l) && /9 min/.test(l)));
  ok('the route frame stands: Start — Home, End — Home, GPS distance',
    /^Start — Home\|/m.test(doc) && /^End — Home\|/m.test(doc) && /^GPS distance\|151\.8 km$/m.test(doc),
    doc.split('\n').filter(l => /Start|End|GPS/.test(l)).join(' ;; '));
  ok('NO bare peg words anywhere in the document', !/Pickup peg|Dump peg/.test(doc));
  ok('the stolen names never print', !/Maple Ridge|Nitestar/.test(doc));
  ok('the Day summary stays his approved shape',
    /^Loads\|3 on site — Remington$/m.test(doc) &&
    /^Loaded at\|Remington$/m.test(doc) && /^Dumped at\|Dog Park$/m.test(doc),
    doc.split('\n').filter(l => /Loads|Loaded|Dumped/.test(l)).join(' ;; '));
  const body = makeBody();
  M.render(body);
  ok('screen: the summary line shows, and no peg words either',
    body._html.indexOf('Remington – Dog Park') !== -1 && body._html.indexOf('3 loads') !== -1 &&
    !/Pickup peg|Dump peg/.test(body._html));
  ok('screen: his names win there too', body._html.indexOf('Petro at Road King') !== -1 &&
    body._html.indexOf('Nitestar') === -1 && body._html.indexOf('Maple Ridge') === -1);
}

/* ============ 4b. a two-pairing day: one line per pairing ============ */
console.log('— 4b. MANIFEST-HAUL-SUMMARY-LINE: two pairings, two lines —');
{
  const DAY = '2026-10-29';
  const T = (s) => Date.parse(DAY + 'T' + s + ':00');
  const A = [51.00874, -114.02517], X = [50.96850, -114.03340], Y = [51.03394, -114.03809];
  const mem = {
    mani_date: DAY,
    onboarding: { payStandard: 'Hourly', payRate: 29, ownWageRate: 29, travelBonus: 1 },
    nav_data: {
      personal: [],
      work: [
        { name: 'Pit Alpha', lat: A[0], lng: A[1] },
        { name: 'Dump Xray', lat: X[0], lng: X[1] },
        { name: 'Dump Yankee', lat: Y[0], lng: Y[1] }
      ],
      recent: []
    },
    dsp_list: [], nav_log: [], fuel_fills: [], fuel_expenses: [], dmg_reports: [],
    sessions: [], rev_entries: [], rev_extras: [], odo_readings: [], pti_reports: [],
    tracker: { status: 'idle', startTs: 0, elapsed: 0 },
    livemiles: { days: {} },
    geoloads: { days: { '2026-10-29': {
      count: 3, corr: 0, countSource: 'pegs',
      sites: {
        load: { lat: A[0], lng: A[1], label: 'Pickup peg', src: 'peg' },
        dump: { lat: Y[0], lng: Y[1], label: 'Dump peg', src: 'peg' }
      },
      pegs: { load: { lat: A[0], lng: A[1], t: T('08:05') }, dump: { lat: Y[0], lng: Y[1], t: T('10:05') } },
      pegLog: [
        { kind: 'load', t: T('08:05'), lat: A[0], lng: A[1] },
        { kind: 'dump', t: T('08:09'), lat: X[0], lng: X[1] },
        { kind: 'dump', t: T('10:05'), lat: Y[0], lng: Y[1] }
      ],
      pegEvents: [
        { kind: 'load', t: T('08:10'), lat: A[0], lng: A[1] },
        { kind: 'dump', t: T('08:40'), lat: X[0], lng: X[1] },
        { kind: 'load', t: T('09:10'), lat: A[0], lng: A[1] },
        { kind: 'dump', t: T('09:40'), lat: X[0], lng: X[1] },
        { kind: 'load', t: T('10:10'), lat: A[0], lng: A[1] },
        { kind: 'dump', t: T('10:40'), lat: Y[0], lng: Y[1] }
      ]
    } } }
  };
  const M = makeWorld(mem);
  const c = M._collectDay(DAY);
  eq('one line per pairing, counts by pairing',
    (c.haulLines || []).map(h => ({ from: h.from, to: h.to, n: h.n })),
    [{ from: 'Pit Alpha', to: 'Dump Xray', n: 2 }, { from: 'Pit Alpha', to: 'Dump Yankee', n: 1 }]);
  const doc = flat(M._docLines(DAY, c, M._toggles()));
  ok('both lines print, in order',
    doc.split('\n').indexOf('Pit Alpha – Dump Xray|2 loads') !== -1 &&
    doc.split('\n').indexOf('Pit Alpha – Dump Yankee|1 load') !== -1,
    doc.split('\n').filter(l => /Pit Alpha/.test(l)).join(' ;; '));
  ok('no peg words on a no-trail peg day either', !/Pickup peg|Dump peg/.test(doc));
}

/* ============ 5b. the resolver tiers, driven directly ============ */
console.log('— 5b. placeNameFor: his names outrank learned labels and built-ins —');
{
  const DAY = '2026-10-31';
  const FUEL_PT = [51.01010, -114.00370];
  const mem = {
    mani_date: DAY,
    onboarding: {},
    nav_data: {
      personal: [],
      work: [
        { name: 'Petro at Road King', lat: 51.01154, lng: -114.00370 },
        { name: 'His Pit', lat: 50.50180, lng: -113.50000 }
      ],
      recent: []
    },
    geoload_pairs: { pairs: {
      k1: { dump: { lat: 51.01074, lng: -114.00370, label: 'Nitestar' } },
      k2: { dump: { lat: 50.60000, lng: -113.60000, label: 'Far Dump' } }
    } },
    dsp_list: [], nav_log: [], fuel_fills: [], fuel_expenses: [], dmg_reports: [],
    sessions: [], rev_entries: [], rev_extras: [], odo_readings: [], pti_reports: [],
    tracker: { status: 'idle', startTs: 0, elapsed: 0 },
    livemiles: { days: {} }, geoloads: { days: {} }
  };
  const M = makeWorld(mem);
  eq('his saved name beats a nearer learned label', M._placeNameFor(FUEL_PT[0], FUEL_PT[1]), 'Petro at Road King');
  eq('a learned label still names its own ground when he has nothing there',
    M._placeNameFor(50.60000, -113.60000), 'Far Dump');
  eq('his saved name beats a nearer built-in', M._placeNameFor(50.50000, -113.50000), 'His Pit');
  eq('unseen ground still resolves to nothing', M._placeNameFor(50.90000, -113.90000), '');
}

console.log('— statics —');
ok('the jargon generator is out of the source',
  manSrc.indexOf('function dayMilesAccounting') === -1 &&
  manSrc.indexOf('Live tracking counted') === -1 &&
  manSrc.indexOf('untracked between') === -1);
eq('webVersion', ver.webVersion, 299);
ok('index pin agrees', idxSrc.includes('modules/manifest.js?v=' + ver.webVersion));

console.log('\nmanifest-jargon-peg-v299: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
