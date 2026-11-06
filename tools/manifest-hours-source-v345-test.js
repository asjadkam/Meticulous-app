#!/usr/bin/env node
/* Meticulous v345 — MANIFEST-HOURS-WRONG-SOURCE.
 *
 * Owner (Nov 5, 2026 22:45–22:47): the October multi-day
 * manifest showed impossible day hours — 88.9 h, 59.7 h, 54.8 h,
 * 29.7 h, 19.3 h, 19.0 h — and a 351 h period total. First
 * explanation offered (tracker sessions never stopped) was
 * WRONG; his correction, verbatim: "There are noooo run away
 * days! My actual hours are in my revenue.. Or my invoices."
 *
 * The defect: the multi-day summary's per-day hours summed
 * TRACKER sessions (session seconds + live tracker hours).
 * His actual hours are the ones recorded in REVENUE — each
 * day's revenue entries' recorded hours (foreman ticket hours
 * + travel), the same hours his invoices bill.
 *
 * Fix: daySummaryOf (the ONE producer of this summary's hours —
 * screen preview, printed table, page-2 total, audit list) now
 * sums the day's revEntries' hours, which collect() returns.
 * Tracker hours never enter. Days with revenue hours but no
 * session show those hours; days with sessions but no revenue
 * hours show 0.0 h in this summary. km / loads / fuel sources
 * are untouched.
 *
 * Proof shape (this suite):
 *  BEFORE — the pre-fix formula, replicated verbatim, over an
 *    October-shaped store whose tracker sessions carry the six
 *    impossible figures he named: it reproduces them day for
 *    day, and the 351.0 h total he saw.
 *  AFTER — the REAL module over the SAME store: every day's
 *    hours equal that day's revenue hours; the total is the
 *    revenue total (the invoice-hours cross-check: the summary
 *    total is exactly the sum of the store's rev_entries hours);
 *    the printed table + page-2 total carry the corrected
 *    figures; no impossible day remains.
 *
 * Run: node tools/manifest-hours-source-v345-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const manSrc = read('modules/manifest.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
function r1(v) { return Math.round((v || 0) * 10) / 10; }

function makeEl() {
  return {
    innerHTML: '', textContent: '', value: '', onclick: null, onchange: null, style: {},
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    setAttribute: function () {}, getAttribute: function () { return null; },
    querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    addEventListener: function () {}
  };
}

/* The six impossible October days he named, on plausible dates;
   the remaining days' tracker hours are sized so the tracker
   column totals EXACTLY the 351.0 h he saw on page 2. */
const RUNAWAY = { '2026-10-03': 88.9, '2026-10-08': 59.7, '2026-10-12': 54.8, '2026-10-17': 29.7, '2026-10-21': 19.3, '2026-10-26': 19.0 };
function octoberStore() {
  const data = {
    onboarding: { payStandard: 'Hourly', ownWageRate: 29, travelBonus: 0 },
    rev_entries: [], sessions: [], fuel_fills: [], tracker: { status: 'idle' },
    mani_mode: 'range', mani_from: '2026-10-01', mani_to: '2026-10-31', mani_date: '2026-10-01'
  };
  const named = Object.values(RUNAWAY).reduce(function (a, b) { return a + b; }, 0); /* 271.4 */
  const others = [];
  for (let d = 1; d <= 31; d++) {
    const ds = '2026-10-' + ('0' + d).slice(-2);
    /* Oct 31 carries NO session at all (see the revenue seed) */
    if (!RUNAWAY[ds] && ds !== '2026-10-31') others.push(ds);
  }
  /* remaining tracker hours: 351.0 - 271.4 = 79.6 over 24 days */
  const per = Math.floor((79.6 / others.length) * 10) / 10; /* 3.3 */
  let assigned = 0;
  others.forEach(function (ds, i) {
    let h = (i === others.length - 1) ? Math.round((79.6 - assigned) * 10) / 10 : per;
    assigned = Math.round((assigned + h) * 10) / 10;
    data.sessions.push({ date: ds, startedAt: ds + 'T08:00:00', endedAt: ds + 'T18:00:00', seconds: Math.round(h * 3600), liveKm: 100.4, manualLoads: 2, startOdo: 100000, endOdo: 100100 });
  });
  Object.keys(RUNAWAY).forEach(function (ds) {
    data.sessions.push({ date: ds, startedAt: ds + 'T08:00:00', endedAt: ds + 'T18:00:00', seconds: Math.round(RUNAWAY[ds] * 3600), liveKm: 100.4, manualLoads: 2, startOdo: 100000, endOdo: 100100 });
  });
  /* His REAL hours — revenue entries: worked days carry sane
     foreman+travel hours; Oct 31 has revenue but NO session at
     all (the day the tracker never ran); the runaway days carry
     ordinary revenue hours like any other day. */
  for (let d = 1; d <= 31; d++) {
    const ds = '2026-10-' + ('0' + d).slice(-2);
    if (d % 7 === 0) continue; /* Sundays off — no revenue */
    if (ds === '2026-10-31') { data.rev_entries.push({ date: ds, hours: 10 }); continue; }
    data.rev_entries.push({ date: ds, hours: 9 + (d % 4) * 0.5 }); /* 9.0 .. 10.5 */
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

(async function () {
  const data = octoberStore();
  const days = [];
  for (let d = 1; d <= 31; d++) days.push('2026-10-' + ('0' + d).slice(-2));

  /* ============ BEFORE: the pre-fix (tracker) formula ============ */
  console.log('— BEFORE: the tracker-source formula reproduces October —');
  function oldSummaryHours(ds) {
    let secs = 0;
    data.sessions.filter(function (s) { return s.date === ds; }).forEach(function (s) { secs += s.seconds || 0; });
    return secs / 3600; /* + live hours (none — the store's tracker is idle) */
  }
  let oldTotal = 0, oldSeen = {};
  days.forEach(function (ds) { const h = oldSummaryHours(ds); oldSeen[ds] = r1(h); oldTotal += h; });
  Object.keys(RUNAWAY).forEach(function (ds) {
    eq('BEFORE ' + ds + ' shows the impossible ' + RUNAWAY[ds] + ' h he named', oldSeen[ds], RUNAWAY[ds]);
  });
  eq('BEFORE the period total is the 351.0 h he saw', r1(oldTotal), 351.0);
  ok('the shipped code no longer contains the tracker-hours formula',
    manSrc.indexOf('hours: secs / 3600 + ((rc.live && rc.live.hours) || 0)') === -1 &&
    manSrc.indexOf('revH += parseFloat(e && e.hours) || 0') >= 0);

  /* ============ AFTER: the real module, revenue source ============ */
  console.log('— AFTER: revenue-sourced hours through the real module —');
  const w = makeWorld(data);
  const sum = w.api._daySummaryOf, coll = w.api._collectDay;
  let revTotal = 0, allMatch = true, worst = 0, detail = '';
  days.forEach(function (ds) {
    const want = data.rev_entries.filter(function (e) { return e.date === ds; })
      .reduce(function (a, e) { return a + (parseFloat(e.hours) || 0); }, 0);
    revTotal += want;
    const got = sum(coll(ds)).hours;
    if (Math.abs(got - want) > 1e-9) { allMatch = false; detail = ds + ': got ' + got + ', want ' + want; }
    if (got > worst) worst = got;
  });
  ok('every day\'s summary hours equal that day\'s revenue hours', allMatch, detail);
  eq('no day exceeds a sane shift (max day = the largest revenue day)', worst, 10.5);
  Object.keys(RUNAWAY).forEach(function (ds) {
    const want = data.rev_entries.filter(function (e) { return e.date === ds; })
      .reduce(function (a, e) { return a + (parseFloat(e.hours) || 0); }, 0);
    eq('AFTER ' + ds + ': ' + RUNAWAY[ds] + ' h tracker figure is gone — revenue hours show', r1(sum(coll(ds)).hours), r1(want));
  });
  eq('a sessions-but-no-revenue day shows 0.0 h (Oct 7 — tracker ran, no revenue entry)',
    sum(coll('2026-10-07')).hours, 0);
  eq('a revenue-but-no-session day shows its revenue hours (Oct 31)',
    sum(coll('2026-10-31')).hours, 10);
  const rt = w.api._rangeTotals(days);
  eq('the range total IS the revenue total (the invoice-hours cross-check)', r1(rt.hours), r1(revTotal));
  ok('the corrected total is far under the tracker 351.0', rt.hours < 300, 'got ' + rt.hours);
  console.log('    [proof] October tracker total 351.0 h → revenue total ' + r1(rt.hours) + ' h');

  /* collect() carries the day's revenue entries to the summarizer */
  ok('collect() returns the day\'s revEntries', Array.isArray(coll('2026-10-19').revEntries) &&
    coll('2026-10-19').revEntries.length === 1);

  /* ============ the printed document + preview ============ */
  console.log('— the faces —');
  w.api.render(w.body);
  w.els['#mn_dl'].onclick();
  await new Promise(function (r) { setTimeout(r, 20); });
  const lines = (w.captured.pdf && w.captured.pdf.payload.lines) || [];
  const totalLine = lines.filter(function (ln) { return ln.k === 'kv' && ln.a === 'Total hours'; })[0];
  eq('page 2 Total hours is the revenue total', totalLine && totalLine.b, (Math.round(revTotal * 10) / 10).toFixed(1) + ' h');
  const rowFor = {};
  lines.forEach(function (ln) { if (ln.k === 'cols' && !ln.head) rowFor[ln.cells[0].t] = ln.cells[2].t; });
  eq('the Oct 3 table row shows its revenue hours, not 88.9', rowFor['Sat, Oct 3'], '10.5');
  ok('no table row carries a tracker figure', Object.keys(rowFor).every(function (k) {
    return ['88.9', '59.7', '54.8', '29.7', '19.3', '19.0'].indexOf(rowFor[k]) === -1;
  }));
  const pv = w.body.innerHTML.slice(w.body.innerHTML.indexOf('id="mn_preview"'), w.body.innerHTML.indexOf('id="mn_print"'));
  ok('the preview Period total is the revenue total', pv.indexOf('Total hours') >= 0 && pv.indexOf((Math.round(revTotal * 10) / 10).toFixed(1) + ' h') >= 0);

  /* km / loads / fuel sources untouched: km still the live-km
     figure the day carries (flagged in the report — out of
     scope for this item), loads and fuel from their records. */
  eq('km source unchanged (live km of the day)', sum(coll('2026-10-19')).km, 100.4);

  /* — pins — */
  eq('webVersion is 345', ver.webVersion, 345);
  ok('index.html pins manifest.js?v=345', idxSrc.indexOf('modules/manifest.js?v=345') >= 0);

  console.log('\nmanifest-hours-source-v345: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR ' + (e && e.stack || e)); process.exit(1); });
