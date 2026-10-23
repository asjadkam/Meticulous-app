#!/usr/bin/env node
/* Meticulous v151 — DAILY EARNINGS CHART LEGIBILITY suite.
 *
 * Owner evidence (Oct 17, 2026 22:10–22:11 MDT, over his own
 * Revenue screenshot): "These dates are mushed up" and "Can't
 * tell which graph is for what date." The period chart (canvas
 * #revChart, modules/revenue.js drawChart) failed him twice:
 *  (1) the date labels stride every ceil(days/8) bars and the
 *      LAST day's label is forced beside them with no width math
 *      at all — at 16 days the final pair ("10/16", "10/17") sat
 *      one slot apart and printed on top of each other;
 *  (2) unstrided bars carry no date at all, and the preview
 *      readout under the chart stayed EMPTY until a tap — on
 *      first view no bar was marked and nothing named a day, so
 *      the only way to learn a bar's date was to tap around.
 *
 * This suite runs the REAL drawChart / graphTap /
 * paintGraphPreview (extracted verbatim) over a recording fake
 * canvas and proves:
 *  (a) label geometry: for day counts 1, 7, 16, 31 (and the
 *      default 30) at phone width, the drawn axis labels never
 *      crowd — each label's start clears the previous label's
 *      end by real air under an INDEPENDENT width model — and
 *      the first + last days are always labelled; at small
 *      counts every bar carries its date;
 *  (b) the pure stride rule chartLabelIdx agrees with what
 *      drawChart actually drew;
 *  (c) the preview readout is always present in the period
 *      view: it defaults to the LATEST day, names the date
 *      plainly WITH its dollars ("Fri, Oct 17 — $290.00"), and
 *      exactly one bar — the named day — paints navy;
 *  (d) tapping still follows the two-tap graphTap contract
 *      (pinned elsewhere too; restated here against the real
 *      functions this suite loads).
 * Run: node tools/chart-legibility-v151-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

const invSrc = fs.readFileSync(path.join(ROOT, 'modules', 'invoice.js'), 'utf8');
const revSrc = fs.readFileSync(path.join(ROOT, 'modules', 'revenue.js'), 'utf8');
function extractCommentRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('region not found: ' + beginMark);
  return src.slice(a, b + 2);
}
function helpersSlice() {
  const start = revSrc.indexOf('var S = function');
  const end = revSrc.lastIndexOf('/*', revSrc.indexOf('v38 (B2): paste-import'));
  if (start === -1 || end === -1 || end <= start) throw new Error('revenue helper slice not found');
  return revSrc.slice(start, end);
}
function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i === -1) return null;
  let depth = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  return null;
}

/* ---------- dates relative to the REAL today (drawChart windows end now) ---------- */
function dstr(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function dlabel(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return (d.getMonth() + 1) + '/' + d.getDate();
}
function dlong(daysAgo) {
  return new Date(dstr(daysAgo) + 'T12:00:00').toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
}

/* entries: today $290 (a dispatch completion), yesterday $261, a
   couple more — dayAgg prices them through the shared builder. */
function completion(date, hours, amount) {
  return { date: date, type: 'hourly', hours: hours, amount: String(amount), note: 'Dispatch: Aecon · foreman + travel = ' + hours + 'h', loads: 0 };
}
const ENTRIES = [
  completion(dstr(0), 10, 290.00),
  completion(dstr(1), 9, 261.00),
  completion(dstr(3), 11, 319.00),
  completion(dstr(6), 10.5, 304.50)
];

function makeWorld() {
  const mem = {
    onboarding: { payStandard: 'Hourly', payRate: 29 },
    rev_entries: JSON.parse(JSON.stringify(ENTRIES)),
    rev_extras: [], sessions: [], fuel_fills: [], dsp_list: []
  };
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); },
    del: function (k) { delete mem[k]; }
  };
  const sandbox = {
    console: console,
    App: {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
      _today: function () { return dstr(0); },
      _odoDailyKm: null, tracker: null,
      userRole: function () { return 'driver'; }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractCommentRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sandbox);
  vm.runInContext('var Meticulous = window.Meticulous;', sandbox);
  let code = helpersSlice() + '\nvar graphSel = null;\n';
  /* v189: chartMarkDate joins the extraction list — drawChart and
     paintGraphPreview resolve the default mark through it now. */
  ['chartDates', 'chartMarkDate', 'drawChart', 'chartLabelIdx', 'graphTap', 'dayLoadsFor', 'paintGraphPreview'].forEach(function (fn) {
    const body = extractFn(revSrc, fn);
    if (body) code += '\n' + body + '\n';
  });
  code += '\nthis.__x = { chartDates: (typeof chartDates === "function") ? chartDates : null,' +
    ' drawChart: (typeof drawChart === "function") ? drawChart : null,' +
    ' chartLabelIdx: (typeof chartLabelIdx === "function") ? chartLabelIdx : null,' +
    ' graphTap: graphTap, paintGraphPreview: paintGraphPreview,' +
    ' setSel: function (v) { graphSel = v; }, getSel: function () { return graphSel; } };';
  vm.runInContext(code, sandbox);
  return { x: sandbox.__x, sb: sandbox, mem: mem };
}

/* ---------- recording fake canvas ---------- */
function fakeCanvas(widthCss) {
  const calls = { rects: [], texts: [] };
  /* v201: the ctx also tracks the transform stack — drawChart
     stands its date labels up (save/translate/rotate/fillText/
     restore), and the recorded text carries its effective anchor
     + rotation so the geometry checks below can verify the
     vertical label law. */
  let tx = 0, ty = 0, rot = 0; const tstack = [];
  const ctx = {
    fillStyle: '', font: '', textAlign: '', textBaseline: '',
    clearRect: function () {},
    save: function () { tstack.push([tx, ty, rot]); },
    restore: function () { const s = tstack.pop(); if (s) { tx = s[0]; ty = s[1]; rot = s[2]; } },
    translate: function (x, y) { tx += x; ty += y; },
    rotate: function (r) { rot += r; },
    fillRect: function (x, y, w, h) { calls.rects.push({ x: x, y: y, w: w, h: h, fillStyle: this.fillStyle }); },
    fillText: function (t, x, y) { calls.texts.push({ text: String(t), x: tx + x, y: ty + y, rot: rot, font: this.font, fillStyle: this.fillStyle }); },
    measureText: function (t) { return { width: String(t).length * 12 }; }
  };
  return {
    offsetWidth: widthCss, width: 0, height: 0, style: {},
    getContext: function () { return ctx; },
    _calls: calls
  };
}
function axisLabels(cv) {
  /* v201: the axis labels are the ROTATED grey texts (the $ max
     label is navy and unrotated). */
  return cv._calls.texts.filter(function (t) { return t.fillStyle === '#6b7690' && t.rot !== 0; });
}
function navyBars(cv) {
  return cv._calls.rects.filter(function (r) { return r.fillStyle === '#1F3764'; });
}
/* INDEPENDENT label model, v201 vertical law: a standing label's
   sideways footprint is its FONT THICKNESS (the glyph height), so
   labels have clear air when each label's anchor clears the
   previous anchor by at least the font size the label was drawn
   at — and every anchor must sit inside the canvas (no clipping
   at either card edge, the "10/:" defect). */
function labelsHaveAir(texts, Wd) {
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    const fontPx = parseFloat(t.font) || 20;
    if (t.x - fontPx / 2 < -0.5 || t.x + fontPx / 2 > Wd + 0.5) return false;
    if (i > 0 && t.x - texts[i - 1].x < fontPx - 0.5) return false;
  }
  return true;
}
function fakeBody(canvas) {
  const host = { innerHTML: '' };
  return {
    _host: host,
    querySelector: function (sel) {
      if (sel === '#rv_gprev') return host;
      if (sel === '#revChart') return canvas || null;
      return null;
    }
  };
}
function setPeriod(mem, days) {
  if (days === 30) { delete mem.rev_period; return; }
  mem.rev_period = 'custom';
  mem.rev_customA = dstr(days - 1);
  mem.rev_customB = dstr(0);
}

console.log('— v151: chart label geometry (real drawChart, recording canvas) —');
[1, 7, 16, 30, 31].forEach(function (days) {
  const w = makeWorld();
  setPeriod(w.mem, days);
  const cv = fakeCanvas(360);
  w.x.drawChart(cv);
  const texts = axisLabels(cv);
  eq('days=' + days + ': bar count equals the day count', cv._calls.rects.length, days);
  ok('days=' + days + ': labels never crowd or clip (vertical model)', labelsHaveAir(texts, cv.width),
    JSON.stringify(texts.map(function (t) { return t.text + '@' + Math.round(t.x); })));
  eq('days=' + days + ': first day is labelled', texts.length && texts[0].text, dlabel(days - 1));
  eq('days=' + days + ': last day is labelled', texts.length && texts[texts.length - 1].text, dlabel(0));
  /* v201 CHART-DATES: EVERY bar carries its date, at every count —
     the v151 "readable spread" allowance is superseded by his
     Oct 21 ruling (no silent skipping, ever). */
  eq('days=' + days + ': EVERY bar carries its date', texts.length, days);
});

console.log('— v151: narrow phone width still cannot crowd —');
{
  const w = makeWorld();
  setPeriod(w.mem, 31);
  const cv = fakeCanvas(320);
  w.x.drawChart(cv);
  const texts = axisLabels(cv);
  ok('days=31 @320px: labels never crowd', labelsHaveAir(texts, cv.width),
    JSON.stringify(texts.map(function (t) { return t.text + '@' + Math.round(t.x); })));
  eq('days=31 @320px: first + last still labelled', texts[0].text + '|' + texts[texts.length - 1].text, dlabel(30) + '|' + dlabel(0));
}

console.log('— v151: the pure stride rule agrees with the drawing —');
{
  const w = makeWorld();
  ok('chartLabelIdx exists as a pure rule', typeof w.x.chartLabelIdx === 'function');
  if (w.x.chartLabelIdx) {
    [1, 7, 16, 31, 62].forEach(function (days) {
      const labels = [];
      for (let i = 0; i < days; i++) labels.push(dlabel(days - 1 - i));
      const idx = w.x.chartLabelIdx(days, 720, labels);
      eq('rule days=' + days + ': first index is 0', idx[0], 0);
      eq('rule days=' + days + ': last index is days-1', idx[idx.length - 1], days - 1);
      /* v201: the rule IS "every day" — no index is ever skipped */
      eq('rule days=' + days + ': every index chosen', idx.length, days);
    });
    /* the drawing uses exactly the rule's indices */
    setPeriod(w.mem, 16);
    const cv = fakeCanvas(360);
    w.x.drawChart(cv);
    const labels16 = [];
    for (let i = 0; i < 16; i++) labels16.push(dlabel(15 - i));
    const want = w.x.chartLabelIdx(16, 720, labels16).map(function (i) { return labels16[i]; });
    eq('drawChart draws exactly the rule\u2019s label set (16 days)',
      JSON.stringify(axisLabels(cv).map(function (t) { return t.text; })), JSON.stringify(want));
  }
}

console.log('— v151: the preview readout — present by default, names date + dollars —');
{
  const w = makeWorld();
  setPeriod(w.mem, 30);
  const cv = fakeCanvas(360);
  w.x.drawChart(cv);
  const body = fakeBody(cv);
  w.x.paintGraphPreview(body);
  const html = body._host.innerHTML;
  ok('default preview is NOT empty (no tap needed)', html.length > 0);
  ok('default preview names the LATEST day plainly', html.indexOf(dlong(0)) >= 0, html.slice(0, 120));
  ok('default preview carries the latest day\u2019s dollars in the readout line',
    html.indexOf(dlong(0) + ' — $290.00') >= 0, html.slice(0, 160));
  const navy = navyBars(cv);
  eq('default: exactly one bar is marked', navy.length, 1);
  const bw = cv.width / 30;
  ok('default: the marked bar is the LAST day\u2019s bar',
    navy.length === 1 && Math.abs(navy[0].x - (29 * bw + bw * 0.2)) < 0.01,
    navy.length ? 'x=' + navy[0].x + ' want ~' + (29 * bw + bw * 0.2) : 'none');
}
{
  const w = makeWorld();
  setPeriod(w.mem, 30);
  const cv = fakeCanvas(360);
  w.x.setSel(dstr(1));
  w.x.drawChart(cv);
  const body = fakeBody(cv);
  w.x.paintGraphPreview(body);
  const html = body._host.innerHTML;
  ok('selected preview names the selected day + its dollars',
    html.indexOf(dlong(1) + ' — $261.00') >= 0, html.slice(0, 160));
  const navy = navyBars(cv);
  eq('selected: exactly one bar is marked', navy.length, 1);
  const bw = cv.width / 30;
  ok('selected: the marked bar is the selected day\u2019s bar',
    navy.length === 1 && Math.abs(navy[0].x - (28 * bw + bw * 0.2)) < 0.01,
    navy.length ? 'x=' + navy[0].x : 'none');
}
{
  /* month view safety: no chart on the page + no selection = no
     readout appears out of nowhere */
  const w = makeWorld();
  const body = fakeBody(null);
  w.x.paintGraphPreview(body);
  eq('no chart + no selection: preview stays empty', body._host.innerHTML, '');
}

console.log('— v151: two-tap interaction unchanged —');
{
  const w = makeWorld();
  eq('first tap selects', JSON.stringify(w.x.graphTap(null, dstr(2))), JSON.stringify({ sel: dstr(2), open: null }));
  eq('second tap on the same day opens', JSON.stringify(w.x.graphTap(dstr(2), dstr(2))), JSON.stringify({ sel: null, open: dstr(2) }));
  eq('tap on a different day moves the selection', JSON.stringify(w.x.graphTap(dstr(2), dstr(3))), JSON.stringify({ sel: dstr(3), open: null }));
}

console.log('— v151: ship pins —');
{
  const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
  const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  /* v152 pin move (the standing convention): 151 -> 152.
     v154 pin move: 153 -> 154, same convention.
     v155 pin move: 154 -> 155, same convention.
     v147 pin move: 155 -> 156, same convention.
     v148 pin move: 156 -> 157, same convention. v156 pin move: 157 -> 158, same convention. v159 pin move: 158 -> 159, same convention. v160 pin move: 159 -> 160, same convention. v161 pin move: 160 -> 161, same convention. */
  eq('ships as webVersion 188', ver.webVersion, 236);
  ok('index loads revenue at the 199 pin', idxSrc.indexOf('modules/revenue.js?v=236') !== -1);
  ok('version.json manifest carries the touched module', typeof ver.files['modules/revenue.js'] === 'string' && ver.files['modules/revenue.js'].length === 64);
}

console.log('\nchart-legibility-v151 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
