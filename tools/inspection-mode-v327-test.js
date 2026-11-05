#!/usr/bin/env node
/* Meticulous v327 — INSPECTION-MODE-14-DAY tests.
 *
 * Runs the REAL shipped modules/pti.js in a vm sandbox over an
 * in-memory store, with a frozen clock (Thu Nov 5, 2026, noon —
 * the day the owner named this item mid-inspection) and a
 * minimal fake DOM for the render paths.
 *
 * Owner's spec under test (Nov 5, 2026, three messages in ~7
 * minutes, incl. two amendments):
 *  - Inspection Mode modelled on Motive's DOT Inspection Mode:
 *    a dedicated entry whose screen reads "Inspect logs for
 *    previous 14 days + today — Tap 'Begin Inspection' and hand
 *    your phone to the officer", one Begin Inspection button,
 *    and a Send option for the same window.
 *  - Begin → clean full-page day sheets swiped day to day in
 *    one go; the window is the previous 14 days + today (15
 *    sheets); a day with no inspection says so on its own sheet.
 *  - AMENDMENT 1: each day page is a SUMMARY per inspection —
 *    date (the sheet heading), pre/post, time, odometer, ONE
 *    result line (all items OK or the defects NAMED), signed —
 *    never the item-by-item checklist; no HOS pages (not an ELD).
 *  - AMENDMENT 2: NO access-code / PIN gate anywhere — "Nobody
 *    does that." Begin is one tap; Exit is one tap.
 * Run: node tools/inspection-mode-v327-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* ---------------- frozen clock: Thu Nov 5, 2026, noon ---------------- */
const RealDate = Date;
const FROZEN_MS = new RealDate(2026, 10, 5, 12, 0, 0).getTime();
function FrozenDate(...args) {
  return args.length ? new RealDate(...args) : new RealDate(FROZEN_MS);
}
FrozenDate.now = () => FROZEN_MS;
FrozenDate.parse = RealDate.parse;
FrozenDate.UTC = RealDate.UTC;
FrozenDate.prototype = RealDate.prototype;
const DAY = 86400000;
function dayStr(ms) {
  const d = new RealDate(ms);
  const z = (n) => ('0' + n).slice(-2);
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}

/* ---------------- store + App stub ---------------- */
function makeStore(seed) {
  const data = Object.assign({}, seed || {});
  return {
    get(k, d) { return (k in data) ? data[k] : d; },
    set(k, v) { data[k] = v; },
    _data: data
  };
}
function makeApp(store) {
  return {
    _store: store,
    _esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    _today: () => '2026-11-05',
    userRole: () => 'driver'
  };
}

/* ---------------- minimal fake DOM ----------------
 * body holds innerHTML; querySelector returns ONE stable stub
 * per '#id' that actually appears in the current HTML (null
 * otherwise — the module's own guards do the rest). */
function makeBody() {
  const registry = new Map();
  function el() {
    return {
      onclick: null, value: '', textContent: '', innerHTML: '', style: {},
      disabled: false,
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {}, removeEventListener() {},
      getContext: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 660, height: 220 }),
      setAttribute() {}, getAttribute: () => null,
      querySelector: () => null, querySelectorAll: () => []
    };
  }
  const body = {
    _html: '',
    set innerHTML(h) { this._html = String(h); registry.clear(); },
    get innerHTML() { return this._html; },
    querySelector(sel) {
      if (sel.charAt(0) !== '#') return null;
      if (this._html.indexOf('id="' + sel.slice(1) + '"') < 0) return null;
      if (!registry.has(sel)) registry.set(sel, el());
      return registry.get(sel);
    },
    querySelectorAll(sel) {
      if (sel.indexOf('data-pti-open') >= 0) {
        const out = [];
        const re = /data-pti-open="([^"]+)"/g; let m;
        while ((m = re.exec(this._html))) { const e = el(); e.getAttribute = () => m[1]; out.push(e); }
        return out;
      }
      return [];
    }
  };
  return body;
}

/* ---------------- fixtures ----------------
 * Today (Nov 5): a signed pre-trip, all OK, 08:18, odo 171037;
 * a signed post-trip with a minor defect (Horn), 16:43.
 * Nov 3: a signed pre-trip with a MAJOR defect (Fuel System).
 * Nov 2: an UNSIGNED pre-trip, all OK.
 * Oct 22 (14 days back): a pre-trip — inside the window.
 * Oct 21 (15 days back): a pre-trip — outside the window. */
function rep(id, filedAt, kind, odo, result, defects, signed) {
  return {
    id, date: dayStr(filedAt), filedAt, kind, odometer: odo,
    result, defects: defects || [], signed: !!signed,
    unit: '07', plate: '04 R209', carrier: 'AI Trucking', driverName: 'Asjad Kamal', items: {}
  };
}
const reportsFixture = [
  rep('r-today-pre', new RealDate(2026, 10, 5, 8, 18).getTime(), 'pre', 171037, 'pass', [], true),
  rep('r-today-post', new RealDate(2026, 10, 5, 16, 43).getTime(), 'post', 171261, 'minor',
    [{ id: 'horn', item: 'Horn', severity: 'minor', note: 'Weak' }], true),
  rep('r-nov3', new RealDate(2026, 10, 3, 7, 5).getTime(), 'pre', 170800, 'major',
    [{ id: 'fuel', item: 'Fuel System', severity: 'major', note: 'Leak' }], true),
  rep('r-nov2', new RealDate(2026, 10, 2, 6, 58).getTime(), 'pre', 170500, 'pass', [], false),
  rep('r-oct22', new RealDate(2026, 9, 22, 7, 0).getTime(), 'pre', 169000, 'pass', [], true),
  rep('r-oct21', new RealDate(2026, 9, 21, 7, 0).getTime(), 'pre', 168800, 'pass', [], true)
];

const store = makeStore({
  onboarding: { firstName: 'Asjad', lastName: 'Kamal', contractingCo: 'AI Trucking', companyName: 'Asjad Kamal', truckNo: '07' },
  pti_reports: reportsFixture
});
const sb = { console, Date: FrozenDate, Meticulous: { modules: {} }, App: makeApp(store), window: {} };
sb.window = sb;
vm.createContext(sb);
vm.runInContext(read('modules/pti.js'), sb);
const PTI = sb.Meticulous.modules.pti;
ok('pti module registers', !!PTI);

/* ---------------- the window: previous 14 days + today ---------------- */
const days = PTI._dotDays();
eq('dotDays yields 15 sheets', days.length, 15);
eq('first sheet is today', days[0].ds, '2026-11-05');
eq('first sheet flagged today', days[0].today, true);
eq('last sheet is 14 days back', days[14].ds, '2026-10-22');
const win = PTI._dotReports();
eq('window holds 5 of 6 fixture reports', win.length, 5);
ok('the 15-days-back report is outside', !win.some((r) => r.id === 'r-oct21'));
ok('the 14-days-back report is inside', win.some((r) => r.id === 'r-oct22'));

/* ---------------- the summary line (amendment 1) ---------------- */
const sPass = PTI._dotSummaryText(reportsFixture[0]);
ok('summary: kind first', sPass.indexOf('Pre-trip · ') === 0, sPass);
ok('summary: carries the time', /· \d{1,2}:\d{2} (a\.m\.|p\.m\.) ·/.test(sPass), sPass);
ok('summary: odometer formatted', sPass.indexOf('Odometer 171,037 km') >= 0, sPass);
ok('summary: pass reads All items OK', sPass.indexOf('All items OK') >= 0, sPass);
ok('summary: signed stated', /· Signed$/.test(sPass), sPass);
const sMinor = PTI._dotSummaryText(reportsFixture[1]);
ok('summary: post-trip kind', sMinor.indexOf('Post-trip · ') === 0, sMinor);
ok('summary: minor defect NAMED with severity', sMinor.indexOf('Defects: Horn (minor)') >= 0, sMinor);
const sMajor = PTI._dotSummaryText(reportsFixture[2]);
ok('summary: major defect NAMED with severity', sMajor.indexOf('Defects: Fuel System (major)') >= 0, sMajor);
const sUnsigned = PTI._dotSummaryText(reportsFixture[3]);
ok('summary: unsigned stated plainly', /· NOT signed$/.test(sUnsigned), sUnsigned);
ok('summary: no checklist dump (single line)', sPass.indexOf('\n') < 0 && sPass.split(' · ').length === 5, sPass);

/* ---------------- source: the PIN is GONE (amendment 2) ---------------- */
const src = read('modules/pti.js');
ok('no PIN-entry field anywhere in the module', src.indexOf('pti_dot_pin') < 0 && src.indexOf('pti_dot_newpin') < 0);
ok('no pinHash gate remains in code', !/function pinHash/.test(src) && src.indexOf('_pinHash') < 0);
ok('no "Unlock" wording remains', src.indexOf('Unlock') < 0);

/* ---------------- the entry card (Motive shape) ---------------- */
const body = makeBody();
PTI.render(body);
ok('entry card is titled Inspection Mode', body.innerHTML.indexOf('🛂 DOT Inspection Mode') >= 0);
ok('entry copy is the Motive line', body.innerHTML.indexOf('Inspect logs for previous 14 days + today') >= 0);
ok('entry copy says hand the phone to the officer', body.innerHTML.indexOf('hand your phone to the officer') >= 0);
ok('one Begin Inspection button', body.innerHTML.indexOf('id="pti_dot_enter"') >= 0 && body.innerHTML.indexOf('Begin Inspection') >= 0);
ok('entry carries the Send door', body.innerHTML.indexOf('id="pti_dot_send_entry"') >= 0);
ok('entry asks for NO pin', body.innerHTML.indexOf('PIN') < 0, body.innerHTML.slice(0, 400));

/* ---------------- Begin: one tap into the officer flow ---------------- */
const beginBtn = body.querySelector('#pti_dot_enter');
ok('Begin button is wired', !!(beginBtn && beginBtn.onclick));
beginBtn.onclick();
eq('Begin activates Inspection Mode', PTI._dotActive(), true);
ok('officer header paints', body.innerHTML.indexOf('🛂 Vehicle Inspection Reports') >= 0);
ok('sheet 1 is today', body.innerHTML.indexOf('Day 1 of 15') >= 0 && body.innerHTML.indexOf('Today') >= 0);
ok('today sheet shows BOTH inspections as summaries',
  body.innerHTML.indexOf('Pre-trip') >= 0 && body.innerHTML.indexOf('Post-trip') >= 0 &&
  body.innerHTML.indexOf('All items OK') >= 0 && body.innerHTML.indexOf('Horn (minor)') >= 0);
ok('officer view carries its own Send door', body.innerHTML.indexOf('id="pti_dot_send"') >= 0);
ok('officer view asks for NO pin', body.innerHTML.indexOf('PIN') < 0 && body.innerHTML.indexOf('password') < 0);
ok('summaries do not open the full checklist', body.innerHTML.indexOf('data-pti-open') < 0);

/* ---------------- the pager: day to day in one go ---------------- */
const olderBtn = body.querySelector('#pti_dot_older');
ok('Older-day pager is wired', !!(olderBtn && olderBtn.onclick));
olderBtn.onclick(); // Nov 4 — no fixture that day
ok('sheet 2 is an empty day, stated on its own sheet',
  body.innerHTML.indexOf('Day 2 of 15') >= 0 && body.innerHTML.indexOf('No inspection filed this day.') >= 0);
body.querySelector('#pti_dot_older').onclick(); // Nov 3
ok('sheet 3 names the major defect',
  body.innerHTML.indexOf('Day 3 of 15') >= 0 && body.innerHTML.indexOf('Fuel System (major)') >= 0);
body.querySelector('#pti_dot_newer').onclick(); // back to Nov 4
ok('Newer-day pager walks back', body.innerHTML.indexOf('Day 2 of 15') >= 0);
for (let i = 0; i < 20; i++) { const b = body.querySelector('#pti_dot_older'); if (b && b.onclick) b.onclick(); }
ok('pager clamps at the oldest sheet', body.innerHTML.indexOf('Day 15 of 15') >= 0);
ok('oldest sheet holds the 14-days-back pre-trip', body.innerHTML.indexOf('Pre-trip') >= 0);

/* ---------------- Exit: one tap, no code ---------------- */
const exitBtn = body.querySelector('#pti_dot_exit');
ok('Exit button is wired', !!(exitBtn && exitBtn.onclick));
exitBtn.onclick();
eq('Exit leaves Inspection Mode with no code asked', PTI._dotActive(), false);
ok('driver is back on the form (Begin door again)', body.innerHTML.indexOf('id="pti_dot_enter"') >= 0);

/* ---------------- the Send lines (via the PDF builder input) ----------------
 * dotSendPdf rides MetPdf.savePdf; capture its lines argument. */
let sentDoc = null;
sb.window.MetPdf = { savePdf: (doc, fname) => { sentDoc = { doc, fname }; return Promise.resolve({ ok: true, message: 'PDF saved.' }); } };
PTI.render(body);
body.querySelector('#pti_dot_send_entry').onclick();
ok('Send produced a document', !!sentDoc);
if (sentDoc) {
  const all = sentDoc.doc.lines.map((l) => l.a || '').join('\n');
  eq('Send covers 15 day headings', sentDoc.doc.lines.filter((l) => l.k === 'h').length, 15);
  ok('Send names the minor defect', all.indexOf('Horn (minor)') >= 0);
  ok('Send names the major defect', all.indexOf('Fuel System (major)') >= 0);
  ok('Send states the unsigned one', all.indexOf('NOT signed') >= 0);
  ok('Send states empty days', all.indexOf('No inspection filed this day.') >= 0);
  ok('Send excludes the 15-days-back report', all.indexOf('2026-10-21') < 0 && sentDoc.doc.lines.filter((l) => l.k === 'h').length === 15);
  ok('Send is summaries — no Schedule 1 checklist', all.indexOf('Air Brake System') < 0);
}

console.log('\ninspection-mode-v327: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
