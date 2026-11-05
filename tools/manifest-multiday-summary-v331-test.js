'use strict';
/*
 * manifest-multiday-summary-v331-test.js — MULTI-DAY-MANIFEST-
 * SUMMARY (owner, Nov 5, 2026 ~12:39, verbatim): "The multi-day
 * manifest should NOT be as detailed as a regular manifest. It
 * is a SUMMARY. For each day it should show just: how many kms
 * the driver did that day, total hours, how many loads, and the
 * fuel filled that day. NO starting or ending odometer, NO
 * starting or ending time, NO GPS marks on the page, and skip
 * how much the driver made — a month's worth of work should fit
 * on 1 page. Page 2 is just the summary of the selected days:
 * total hours run, total fuel filled, total loads in the
 * period." (Total km for the range was NOT specified — left off
 * page 2, named in the queue log.)
 *
 * Pins:
 *  - daySummaryOf: the one per-day summarizer (km on the live
 *    basis, hours = session span + live hours, loads, fuel
 *    litres summed from the day's fills).
 *  - the range PREVIEW: one compact line per day (label · km ·
 *    hours · loads · fuel), a Period total of hours/fuel/loads
 *    ONLY — no pay, no odometer, no times, no GPS, no range km.
 *  - the range PDF lines: title + one kv per day, a real page
 *    break, then PERIOD TOTAL with exactly three kv lines.
 *  - MetPdf honours the 'pb' break: the built PDF has 2 pages,
 *    and 31 day lines alone fit ONE page (the density law).
 *  - the single-day manifest is untouched (full detail, Edit
 *    door, no period total).
 *
 * THEN: webVersion is 331 + index tags.
 */
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
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
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
  /* — the summarizer — */
  const w0 = makeWorld({});
  const sum = w0.api._daySummaryOf;
  eq('a full day: km · hours · loads · fuel litres',
    sum({ liveKmAny: true, liveKm: 120.5, sessions: [{ seconds: 36000 }], loads: 3, fills: [{ litres: 50 }, { litres: '25.5' }] }),
    { km: 120.5, hours: 10, loads: 3, fuelL: 75.5 });
  eq('no live km that day → 0 km (the v211 basis)',
    sum({ liveKmAny: false, liveKm: 999, sessions: [], loads: 0, fills: [] }).km, 0);
  eq('a live day adds its live hours on top of closed sessions',
    sum({ liveKmAny: true, liveKm: 10, sessions: [{ seconds: 3600 }], live: { hours: 0.5 }, loads: 1, fills: [] }).hours, 1.5);
  eq('a null collect reads as an empty day', sum(null), { km: 0, hours: 0, loads: 0, fuelL: 0 });
  const rt = w0.api._rangeTotals(['2026-10-19', '2026-10-20']);
  eq('rangeTotals carries the fuel total too', rt.fuelL, 50);
  eq('rangeTotals hours', Math.round(rt.hours * 10) / 10, 15);

  /* — the range preview — */
  const w = makeWorld({ mani_mode: 'range', mani_from: '2026-10-19', mani_to: '2026-10-20', mani_date: '2026-10-19' });
  w.api.render(w.body);
  const h = w.body.innerHTML;
  ok('day A is ONE summary line', h.indexOf('Mon, Oct 19') >= 0 && h.indexOf('120.5 km · 10.0 h · 3 loads · 50.0 L fuel') >= 0, h.slice(h.indexOf('Preview'), h.indexOf('Preview') + 400));
  ok('day B is ONE summary line', h.indexOf('Tue, Oct 20') >= 0 && h.indexOf('60.3 km · 5.0 h · 2 loads · 0.0 L fuel') >= 0);
  /* The ban list governs the manifest PREVIEW (the settings
     card above it legitimately names its toggles "Odometer" /
     "Total Earned Income" — the v213 pin keeps those). */
  const pv = h.slice(h.indexOf('id="mn_preview"'), h.indexOf('id="mn_print"'));
  ok('NO odometer in the summary preview', pv.indexOf('Odometer') === -1 && pv.indexOf('100,000') === -1 && pv.indexOf('100,120') === -1, pv.slice(0, 300));
  ok('NO pay in the summary preview', pv.indexOf('Total Earned Income') === -1 && pv.indexOf('$') === -1);
  ok('NO full day blocks stacked (no Fuel & expenses section)', h.indexOf('Fuel &amp; expenses') === -1 && h.indexOf('Fuel & expenses') === -1);
  ok('the period total shows hours', h.indexOf('Total hours') >= 0 && h.indexOf('15.0 h') >= 0);
  ok('the period total shows fuel', h.indexOf('Total fuel') >= 0 && h.indexOf('50.0 L') >= 0);
  ok('the period total shows loads', h.indexOf('Total loads') >= 0);
  ok('NO range km total (not specified — left off)', h.indexOf('180.8 km') === -1 && h.indexOf('Total km') === -1);
  ok('the From/To pickers + toggles still paint', h.indexOf('id="mn_from"') >= 0 && h.indexOf('data-tg=') >= 0);

  /* — the printed range document — */
  w.els['#mn_dl'].onclick();
  await new Promise(function (r) { setTimeout(r, 20); });
  ok('the PDF was requested', !!w.captured.pdf);
  const lines = (w.captured.pdf && w.captured.pdf.payload.lines) || [];
  eq('the document is exactly: title, 2 day lines, break, total head, 3 total lines',
    lines.map(function (ln) { return ln.k; }),
    ['title', 'kv', 'kv', 'pb', 'h', 'kv', 'kv', 'kv']);
  eq('day A line', lines[1], { k: 'kv', a: 'Mon, Oct 19', b: '120.5 km · 10.0 h · 3 loads · 50.0 L fuel' });
  eq('day B line', lines[2], { k: 'kv', a: 'Tue, Oct 20', b: '60.3 km · 5.0 h · 2 loads · 0.0 L fuel' });
  eq('total hours line', lines[5], { k: 'kv', a: 'Total hours', b: '15.0 h' });
  eq('total fuel line', lines[6], { k: 'kv', a: 'Total fuel', b: '50.0 L' });
  eq('total loads line', lines[7], { k: 'kv', a: 'Total loads', b: '5' });
  ok('no line carries money', lines.every(function (ln) { return String(ln.a || '').indexOf('$') === -1 && String(ln.b || '').indexOf('$') === -1; }));
  ok('no line carries a range km total or odometer', lines.every(function (ln) { return !/180\.8|Odometer|Miles/.test(String(ln.a || '') + String(ln.b || '')); }));

  /* — MetPdf honours the break; a month fits page 1 — */
  const psb = { console: console, Date: Date, Math: Math, JSON: JSON };
  psb.window = psb;
  psb.document = { createElement: function () { return { style: {}, click: function () {} }; }, body: { appendChild: function () {}, removeChild: function () {} } };
  psb.navigator = {};
  vm.createContext(psb);
  vm.runInContext(read('js/pdfexport.js'), psb, { filename: 'js/pdfexport.js' });
  const built = psb.window.MetPdf.buildPdf({ title: 't', lines: lines });
  eq('the summary PDF is exactly 2 pages (days, then totals)', built.pages, 2);
  const monthLines = [{ k: 'title', a: 'MANIFEST — month' }];
  for (let i = 1; i <= 31; i++) monthLines.push({ k: 'kv', a: 'Day ' + i, b: '150.0 km · 10.0 h · 8 loads · 120.0 L fuel' });
  const monthBuilt = psb.window.MetPdf.buildPdf({ title: 't', lines: monthLines });
  eq('31 day lines fit ONE page (the density law)', monthBuilt.pages, 1);

  /* — the single-day manifest is untouched — */
  const w1 = makeWorld({ mani_date: '2026-10-19' });
  w1.api.render(w1.body);
  const h1 = w1.body.innerHTML;
  ok('single-day keeps its full detail', h1.indexOf('Total Earned Income') >= 0 && h1.indexOf('$290.00') >= 0);
  ok('single-day has NO period total', h1.indexOf('Period total') === -1);
  ok('single-day keeps its Edit door', h1.indexOf('mn_edit_btn') >= 0);

  /* — pins — */
  ok('one summarizer: daySummaryOf feeds sumCollected',
    manSrc.indexOf('function daySummaryOf(rc)') >= 0 && manSrc.indexOf('var s = daySummaryOf(rc);') >= 0);
  ok('the range document breaks to its own totals page',
    manSrc.indexOf("{ k: 'pb' }") >= 0 && read('js/pdfexport.js').indexOf("ln.k === 'pb'") >= 0);
  eq('webVersion is 331', ver.webVersion, 331);
  ok('index.html pins manifest.js?v=331 + pdfexport.js?v=331',
    idxSrc.indexOf('modules/manifest.js?v=331') >= 0 && idxSrc.indexOf('js/pdfexport.js?v=331') >= 0);

  console.log('\nmanifest-multiday-summary-v331 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR ' + (e && e.stack || e)); process.exit(1); });
