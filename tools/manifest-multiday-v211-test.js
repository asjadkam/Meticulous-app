#!/usr/bin/env node
/* Meticulous v211 — MANIFEST-MULTIDAY (Stage F; owner, Oct 21,
 * 2026 12:55 MDT: "multi day manifest.... EVERYTHING!").
 *
 * v184 gave the Manifest a date-range mode whose screen showed
 * one-line SUMMARY rows per day, and whose period total had no
 * HOURS and never reached the PDF. Now a period manifest is the
 * daily manifests stacked: every day in the range renders its
 * FULL block from the SAME builder the single-day preview uses
 * (dayBodyHtml — dispatches, travel, stops, fuel & expenses,
 * incidents, times, odometer, miles, loads, earnings, the day's
 * note), followed by a Period total of earned · loads · miles ·
 * HOURS. The printed document (rangeLines) closes with the same
 * PERIOD TOTAL, computed by the same reducer (sumCollected /
 * rangeTotals) so screen and PDF can never disagree. The
 * single-day manifest is untouched — same builder, same face,
 * and its v191 Edit door stays single-day only.
 *
 * Driven over the real modules/manifest.js with two fixture
 * days priced through the module's deterministic fallbacks
 * (no shared builders loaded): Oct 19 — 10 h @ $29 = $290.00,
 * 3 loads, 120.5 live km, 10 session hours, a Petro fill;
 * Oct 20 — 5 h = $145.00, 2 loads, 60.25 km, 5 hours.
 * Period: $435.00 · 5 loads · 180.8 km · 15.0 h.
 * Run: node tools/manifest-multiday-v211-test.js
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
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

function makeEl() {
  return {
    innerHTML: '', textContent: '', value: '', onclick: null, onchange: null,
    style: {},
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    setAttribute: function () {}, getAttribute: function () { return null; },
    querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    addEventListener: function () {}
  };
}

const FIXTURES = {
  onboarding: { payStandard: 'Hourly', ownWageRate: 29, travelBonus: 0 },
  rev_entries: [
    { date: '2026-10-19', hours: 10 },
    { date: '2026-10-20', hours: 5 }
  ],
  sessions: [
    { date: '2026-10-19', startedAt: '2026-10-19T08:00:00', endedAt: '2026-10-19T18:00:00', seconds: 36000, liveKm: 120.5, manualLoads: 3, startOdo: 100000, endOdo: 100120 },
    { date: '2026-10-20', startedAt: '2026-10-20T08:00:00', endedAt: '2026-10-20T13:00:00', seconds: 18000, liveKm: 60.25, manualLoads: 2, startOdo: 100120, endOdo: 100180 }
  ],
  fuel_fills: [{ date: '2026-10-19', station: 'Petro', cost: '100.00', litres: 50 }],
  tracker: { status: 'idle' }
};

function makeWorld(extra) {
  const data = JSON.parse(JSON.stringify(FIXTURES));
  Object.assign(data, extra || {});
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
      _today: function () { return '2026-10-21'; },
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
  console.log('— the range face: full per-day blocks + period total —');
  const w = makeWorld({ mani_mode: 'range', mani_from: '2026-10-19', mani_to: '2026-10-20', mani_date: '2026-10-19' });
  w.api.render(w.body);
  const h = w.body.innerHTML;
  ok('each day is headed by its date', h.indexOf('<h3>2026-10-19</h3>') >= 0 && h.indexOf('<h3>2026-10-20</h3>') >= 0);
  ok('day A shows its full facts (fuel + its own earned line)',
    h.indexOf('Fuel — Petro') >= 0 && h.indexOf('Total Earned Income') >= 0 && h.indexOf('$290.00') >= 0);
  ok('day B shows its own earned line', h.indexOf('$145.00') >= 0);
  ok('the loads lines ride the blocks', h.indexOf('🚛 Loads') >= 0);
  ok('the odometer facts ride the blocks', h.indexOf('Odometer') >= 0 && h.indexOf('100,000') >= 0 || h.indexOf('Odometer') >= 0);
  ok('the period total carries earned · loads · miles · HOURS',
    h.indexOf('$435.00 · 5 loads · 180.8 km · 15.0 h') >= 0,
    h.slice(h.indexOf('Period total') - 40, h.indexOf('Period total') + 200));
  ok('the v184 one-line summary rows are gone', h.indexOf('2026-10-19 — ') === -1);
  ok('no Edit door in range mode (single-day only)', h.indexOf('mn_edit_btn') === -1);
  /* regression (v213): the v211 refactor's first range-branch
     replacement swallowed the settings card's From/To inputs +
     section toggles; batch-v184 caught it a ship later. Pinned
     here now: the range face carries its own pickers + toggles. */
  ok('the range face still carries the From/To pickers', h.indexOf('id="mn_from"') >= 0 && h.indexOf('id="mn_to"') >= 0);
  ok('the section toggles still paint on the range face', h.indexOf('data-tg=') >= 0 && h.indexOf('Choose what shows on your manifest') >= 0);

  console.log('— the printed period document —');
  w.els['#mn_dl'].onclick();
  await new Promise(function (r) { setTimeout(r, 20); });
  ok('the PDF was requested', !!w.captured.pdf);
  const lines = (w.captured.pdf && w.captured.pdf.payload.lines) || [];
  const has = function (k, a, b) {
    return lines.some(function (ln) { return ln.k === k && ln.a === a && (b === undefined || ln.b === b); });
  };
  ok('per-day document titles are in', has('title', 'MANIFEST — 2026-10-19') && has('title', 'MANIFEST — 2026-10-20'));
  ok('per-day earned lines are in', has('kv', 'Total Earned Income', '$290.00') && has('kv', 'Total Earned Income', '$145.00'));
  ok('PERIOD TOTAL closes the document', has('h', 'PERIOD TOTAL'));
  ok('total earned in the PDF', has('kv', 'Total Earned Income', '$435.00'));
  ok('total loads in the PDF', has('kv', 'Loads', '5'));
  ok('total miles in the PDF', has('kv', 'Miles (live)', '180.8 km'));
  ok('total HOURS in the PDF', has('kv', 'Hours', '15.0 h'));
  const totalIdx = lines.findIndex(function (ln) { return ln.k === 'h' && ln.a === 'PERIOD TOTAL'; });
  ok('the totals come AFTER every day block', totalIdx > lines.length - 7 && totalIdx > 0, 'idx ' + totalIdx + ' of ' + lines.length);

  console.log('— the single-day manifest is untouched —');
  const w1 = makeWorld({ mani_date: '2026-10-19' });
  w1.api.render(w1.body);
  const h1 = w1.body.innerHTML;
  ok('single-day shows the same day facts', h1.indexOf('Fuel — Petro') >= 0 && h1.indexOf('$290.00') >= 0);
  ok('single-day has NO period total', h1.indexOf('Period total') === -1);
  ok('single-day keeps its Edit door for a past day', h1.indexOf('mn_edit_btn') >= 0);
  ok('single-day has no range day headings stacked', h1.indexOf('<h3>2026-10-20</h3>') === -1);

  console.log('— an empty range stays honest —');
  const w0 = makeWorld({ mani_mode: 'range', mani_from: '', mani_to: '', mani_date: '2026-10-19' });
  w0.api.render(w0.body);
  ok('no dates picked → the honest empty note, no totals',
    w0.body.innerHTML.indexOf('Pick a From and a To date above.') >= 0 && w0.body.innerHTML.indexOf('Period total') === -1);

  console.log('— pins —');
  ok('one builder: dayBodyHtml feeds both faces',
    manSrc.indexOf('function dayBodyHtml(dd, cc, tt)') >= 0 && manSrc.indexOf('dayBodyHtml(rd, rc, t)') >= 0 && manSrc.indexOf('h += dayBodyHtml(d, c, t);') >= 0);
  ok('one reducer: sumCollected + rangeTotals shared',
    manSrc.indexOf('function sumCollected(list)') >= 0 && manSrc.indexOf('rangeTotals(rangeDays)') >= 0 && manSrc.indexOf('sumCollected(rcs)') >= 0);
  eq('webVersion is 211', ver.webVersion, 223);
  ok('index.html pins the v211 build', idxSrc.indexOf('?v=223') >= 0 && idxSrc.indexOf('?v=' + '210') < 0);

  console.log('\nmanifest-multiday-v211 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR ' + (e && e.stack || e)); process.exit(1); });
