#!/usr/bin/env node
/* Meticulous v242 — WORK-PROFILES (owner, Fri Oct 23, 2026 evening:
 * "Build it tonight"). Tomorrow Ai Trucking has no work and he drives
 * one day for another carrier — different truck, different company
 * charged, different rate, different tax, PTI on that truck, another
 * ticket. His shape: switchable work profiles under Preferences;
 * the Ai Trucking / Truck 07 books stay untouched and separate; the
 * other profile keeps its own invoice for the other company.
 *
 * The laws proven here, against the REAL shipped code (the
 * WORK-PROFILES seam sliced verbatim from js/app.js, the real
 * Revenue module, the real INV-CYCLE region + revenueLinePlan from
 * modules/invoice.js, the real PTI module on a fake DOM, and the
 * real cloudsync record-union functions):
 *  (a) MIGRATION — the existing settings become Profile 1 and the
 *      October totals are IDENTICAL after: the Oct 16–31 invoice
 *      plan total, the Revenue month total and the dashboard glance
 *      do not move a cent.
 *  (b) ISOLATION — entries created under Profile B never appear in
 *      Profile A's invoice plan, day totals, or Revenue glance
 *      (and the reverse).
 *  (c) PTI — a report filed under B carries B's plate + carrier
 *      and B's stamp; under A, A's.
 *  (d) A DAY KEEPS ITS PROFILE — a running session's late stop
 *      still lands in the book it started in after a mid-day
 *      switch; a completion under one profile never eats the
 *      other profile's tracker entry for the same date.
 *  (e) INVOICES PER PROFILE — numbering is independent (Ai keeps
 *      1152 → 1153; a new profile starts at its own 1), collisions
 *      are judged inside the profile's own book only, and issued
 *      records carry their profile's stamp.
 *  (f) THE SEAM — derivation, switch mirroring (onboarding is the
 *      active profile's working copy), capture of legacy-card
 *      edits, plate write-back.
 *  (g) SYNC — the record-union pull can never strip a profileId
 *      stamp: the stamped copy of a record is the more complete
 *      copy and wins.
 *
 * Run: node tools/work-profiles-v242-test.js
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
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

function memStore(seed) {
  const data = JSON.parse(JSON.stringify(seed || {}));
  return {
    _data: data,
    get: function (k, d) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : d; },
    set: function (k, v) { data[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete data[k]; }
  };
}
function extractRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}
function extractFn(src, name) {
  const sig = 'function ' + name + '(';
  const i = src.indexOf(sig);
  if (i === -1) throw new Error('fn not found: ' + name);
  let depth = 0, j = src.indexOf('{', i), k = j;
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(i, k + 1);
}

/* ---------------- fixtures: his real shape ---------------- */
const ONB = {
  payStandard: 'Hourly', ownWageRate: '29', payRate: '29', travelBonus: '1',
  contractingCo: 'AI Trucking', contractingAddr: '1506 16 St NE',
  companyName: 'Asjad Kamal', gst: '', firstName: 'Asjad', lastName: 'Kamal',
  truckNo: '07', plate: '04 R209',
  nextInvoiceNo: '1152', rateIncludesTax: true, invoiceTaxRate: '5',
  homeProvince: 'Alberta', country: 'Canada', province: 'AB'
};
/* his October completions as the app holds them (Oct 22 = the
   single $319.00 entry after the Oct 23 cleanup) */
const OCT = [
  { date: '2026-10-16', amount: '319.00', type: 'hourly', hours: '11.00', loads: 1, note: 'Dispatch: Aecon Inf', dspId: 'd-oct16', foremanHours: 10, travelHours: 1 },
  { date: '2026-10-17', amount: '290.00', type: 'hourly', hours: '10.00', loads: 1, note: 'Dispatch: Aecon Inf', dspId: 'd-oct17', foremanHours: 9, travelHours: 1 },
  { date: '2026-10-19', amount: '275.50', type: 'hourly', hours: '10.50', loads: 1, note: 'Dispatch: Aecon Inf', dspId: 'd-oct19', foremanHours: 9.5, travelHours: 1 },
  { date: '2026-10-20', amount: '290.00', type: 'hourly', hours: '10.00', loads: 1, note: 'Dispatch: Aecon Inf', dspId: 'd-oct20', foremanHours: 9, travelHours: 1 },
  { date: '2026-10-21', amount: '304.50', type: 'hourly', hours: '10.50', loads: 1, note: 'Dispatch: Aecon Inf', dspId: 'd-oct21', foremanHours: 9.5, travelHours: 1 },
  { date: '2026-10-22', amount: '319.00', type: 'hourly', hours: '11.00', loads: 1, note: 'Dispatch: Aecon Inf', dspId: 'd-oct22', foremanHours: 10, travelHours: 1 }
];
const OCT_TOTAL = 1798.00; /* 319+290+275.50+290+304.50+319 */
const INV1151 = { no: '1151', pa: '2026-10-01', pb: '2026-10-15', date: '2026-10-15', total: 3610.50, items: [], status: 'paid' };
const PROFILE_B = { company: 'Other Carrier Ltd', truckNo: '12', plate: 'XYZ 999', rate: '35', rateIncludesTax: false, taxRate: '5', nextInvoiceNo: '1' };

const appSrc = read('js/app.js');
const invSrc = read('modules/invoice.js');

/* ---------------- main world: seam + revenue + invoice ---------------- */
function makeWorld(seed) {
  const store = memStore(seed);
  const sb = {
    window: {}, Meticulous: { modules: {}, shared: {} }, console: console,
    App: {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s); },
      _today: function () { return '2026-10-23'; }
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(extractRegion(appSrc, 'WORK-PROFILES-BEGIN', 'WORK-PROFILES-END'), sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext('var CA_TAX = { AB: 5 }; var CA_NAME2CODE = { Alberta: "AB" };', sb);
  ['onb', 'psWageRate', 'revenueLinePlan', 'wpIdOf'].forEach(function (fn) {
    vm.runInContext(extractFn(invSrc, fn), sb);
  });
  sb.Meticulous.shared.buildRevenueLines = sb.invCycBuildRevenueLines;
  sb.Meticulous.shared.revenueEntrySource = sb.invCycEntrySrc;
  sb.Meticulous.shared.dayLoads = sb.invCycDayLoads;
  vm.runInContext(read('modules/revenue.js'), sb);
  return { sb: sb, store: store, rev: sb.Meticulous.modules.revenue, WP: sb.App.workProfiles };
}
function planTotal(w, a, b, pid) {
  const plan = pid ? w.sb.revenueLinePlan(a, b, pid) : w.sb.revenueLinePlan(a, b);
  const tot = (plan.lines || []).reduce(function (s, l) { return s + (Number(l.amt) || 0); }, 0);
  return Math.round(tot * 100) / 100;
}
function dayEntries(w, date) {
  return (w.store._data.rev_entries || []).filter(function (e) { return e && e.date === date; });
}

/* ================= (a) MIGRATION — October does not move ================= */
{
  const w = makeWorld({ onboarding: ONB, rev_entries: OCT, rev_extras: [], inv_list: [INV1151] });
  ok('a0 the seam exists', !!w.WP);
  const st = w.WP.load();
  eq('a1 migration derives exactly ONE profile', st.list.length, 1);
  eq('a2 Profile 1 is his Ai Trucking / Truck 07', {
    company: st.list[0].company, truckNo: st.list[0].truckNo, plate: st.list[0].plate,
    rate: String(st.list[0].rate), rateIncludesTax: !!st.list[0].rateIncludesTax,
    taxRate: String(st.list[0].taxRate), nextInvoiceNo: String(st.list[0].nextInvoiceNo)
  }, {
    company: 'AI Trucking', truckNo: '07', plate: '04 R209',
    rate: '29', rateIncludesTax: true, taxRate: '5', nextInvoiceNo: '1152'
  });
  eq('a3 Profile 1 is active', st.activeId, 'p1');
  eq('a4 label names company + truck', w.WP.label('p1'), 'AI Trucking · Truck 07');
  eq('a5 Oct 16-31 invoice plan total BEFORE any profile use', planTotal(w, '2026-10-16', '2026-10-31', 'p1'), OCT_TOTAL);
  eq('a6 Revenue month total for October', Math.round(w.rev.monthSummary('2026-10').total * 100) / 100, OCT_TOTAL);
  eq('a7 the dashboard glance is his Oct 22 entry', w.rev.status(), 'Last entry: $319.00 · yesterday');
  /* persisting the migration (first mutation) must not move a cent */
  w.WP.captureActive();
  eq('a8 plan total AFTER the migration persists', planTotal(w, '2026-10-16', '2026-10-31', 'p1'), OCT_TOTAL);
  eq('a9 month total AFTER the migration persists', Math.round(w.rev.monthSummary('2026-10').total * 100) / 100, OCT_TOTAL);
  eq('a10 legacy unstamped records read as Profile 1', w.WP.idOf(OCT[0]), 'p1');
  eq('a11 rateOf(Profile 1) is his $29', w.WP.rateOf('p1'), 29);
}

/* ================= (b) ISOLATION + (d) mid-day + (e) numbering ================= */
{
  const w = makeWorld({ onboarding: ONB, rev_entries: OCT, rev_extras: [], inv_list: [INV1151] });
  const b = w.WP.add(Object.assign({}, PROFILE_B));
  eq('b0 the new profile gets its own id', b.id, 'p2');
  eq('b1 adding does not switch', w.WP.activeId(), 'p1');
  eq('b2 the persisted list now holds the derived Profile 1 + B', (w.store._data.work_profiles.list || []).length, 2);
  eq('b3 persisted Profile 1 kept his data through the add', w.store._data.work_profiles.list[0].company, 'AI Trucking');

  ok('b4 switch to B lands', w.WP.switchTo('p2') === true);
  const ob = w.store._data.onboarding;
  eq('b5 the working copy now mirrors B', {
    contractingCo: ob.contractingCo, truckNo: ob.truckNo, plate: ob.plate,
    ownWageRate: String(ob.ownWageRate), nextInvoiceNo: String(ob.nextInvoiceNo),
    rateIncludesTax: !!ob.rateIncludesTax
  }, {
    contractingCo: 'Other Carrier Ltd', truckNo: '12', plate: 'XYZ 999',
    ownWageRate: '35', nextInvoiceNo: '1', rateIncludesTax: false
  });

  /* a tracker day under B: 11h at B's $35 */
  w.rev.onSession({ date: '2026-10-24', seconds: 11 * 3600, profileId: 'p2' });
  const bDay = dayEntries(w, '2026-10-24');
  eq('b6 the B session entry is priced at Bs rate', bDay.length && bDay[0].amount, '385.00');
  eq('b7 the B session entry carries Bs stamp', bDay.length && bDay[0].profileId, 'p2');
  /* an extra under B (the extras writer itself is pinned in (h)) */
  const xt = w.store._data.rev_extras || []; xt.push({ date: '2026-10-24', type: 'bonus', amount: '50.00', note: 'Wait time', profileId: 'p2' });
  w.store.set('rev_extras', xt);

  eq('b8 Bs invoice plan for Oct 16-31 is ONLY Bs money', planTotal(w, '2026-10-16', '2026-10-31', 'p2'), 435.00);
  eq('b9 As invoice plan is untouched by B', planTotal(w, '2026-10-16', '2026-10-31', 'p1'), OCT_TOTAL);
  eq('b10 the unscoped plan (P&Ls door) still sees the whole book', planTotal(w, '2026-10-16', '2026-10-31'), OCT_TOTAL + 435.00);
  eq('b11 Revenue month total under B is only Bs', Math.round(w.rev.monthSummary('2026-10').total * 100) / 100, 435.00);
  ok('b12 the glance under B shows Bs last entry, never As $319',
    w.rev.status().indexOf('$385.00') !== -1 && w.rev.status().indexOf('319') === -1, w.rev.status());

  ok('b13 switch back to A lands', w.WP.switchTo('p1') === true);
  const oa = w.store._data.onboarding;
  eq('b14 the working copy mirrors A again', {
    contractingCo: oa.contractingCo, truckNo: oa.truckNo, plate: oa.plate,
    ownWageRate: String(oa.ownWageRate), nextInvoiceNo: String(oa.nextInvoiceNo), rateIncludesTax: !!oa.rateIncludesTax
  }, {
    contractingCo: 'AI Trucking', truckNo: '07', plate: '04 R209',
    ownWageRate: '29', nextInvoiceNo: '1152', rateIncludesTax: true
  });
  eq('b15 month total under A is October again', Math.round(w.rev.monthSummary('2026-10').total * 100) / 100, OCT_TOTAL);
  eq('b16 the glance under A is his $319 line again', w.rev.status(), 'Last entry: $319.00 · yesterday');

  /* ---- (d) a day keeps the profile it started with ---- */
  w.rev.onSession({ date: '2026-10-25', seconds: 5 * 3600, profileId: 'p1' });   /* A session: 5h x $29 */
  w.WP.switchTo('p2');
  w.rev.onSession({ date: '2026-10-25', seconds: 5 * 3600, profileId: 'p2' });   /* B session: 5h x $35 */
  let d25 = dayEntries(w, '2026-10-25');
  eq('d1 the same date holds one tracker entry per book', d25.length, 2);
  eq('d2 As tracker entry kept As price + stamp', d25.filter(function (e) { return e.profileId === 'p1'; }).map(function (e) { return e.amount; }), ['145.00']);
  eq('d3 Bs tracker entry kept Bs price + stamp', d25.filter(function (e) { return e.profileId === 'p2'; }).map(function (e) { return e.amount; }), ['175.00']);

  /* B completes its dispatch for the same date: only Bs tracker entry is superseded */
  w.rev.addEntry({ date: '2026-10-25', amount: '385.00', type: 'hourly', hours: '11.00', loads: 1, note: 'Dispatch: Other Carrier Ltd', dspId: 'd-b25', profileId: 'p2', foremanHours: 10, travelHours: 1 });
  d25 = dayEntries(w, '2026-10-25');
  eq('d4 Bs completion superseded ONLY Bs tracker entry', d25.length, 2);
  eq('d5 As tracker entry survived Bs completion', d25.filter(function (e) { return e.profileId === 'p1'; }).map(function (e) { return e.amount; }), ['145.00']);

  /* a late re-stop of the A session while B is ACTIVE: converges in As book */
  w.rev.onSession({ date: '2026-10-25', seconds: 5 * 3600, profileId: 'p1' });
  d25 = dayEntries(w, '2026-10-25');
  eq('d6 the A re-stop under B-active replaced As entry in place', d25.length, 2);
  eq('d7 As entry is still As figure (5h x $29)', d25.filter(function (e) { return e.profileId === 'p1'; }).map(function (e) { return e.amount; }), ['145.00']);

  /* A completes too: only As tracker entry goes */
  w.WP.switchTo('p1');
  w.rev.addEntry({ date: '2026-10-25', amount: '319.00', type: 'hourly', hours: '11.00', loads: 1, note: 'Dispatch: Aecon Inf', dspId: 'd-a25', profileId: 'p1', foremanHours: 10, travelHours: 1 });
  d25 = dayEntries(w, '2026-10-25');
  eq('d8 after both completions the day holds exactly the two completions', d25.length, 2);
  eq('d9 plan for Oct 25 under A', planTotal(w, '2026-10-25', '2026-10-25', 'p1'), 319.00);
  eq('d10 plan for Oct 25 under B', planTotal(w, '2026-10-25', '2026-10-25', 'p2'), 385.00);
  /* a completion speaking for a date silences that profiles late stops only */
  w.rev.onSession({ date: '2026-10-25', seconds: 3 * 3600, profileId: 'p1' });
  eq('d11 a late A stop after As completion adds nothing', dayEntries(w, '2026-10-25').length, 2);

  /* ---- (e) invoice numbering per profile (real invIssue) ---- */
  function issue(w2, pid, draftNo, prefNo, pa, pb) {
    return w2.sb.invIssue({
      draft: { items: [], taxRate: 5, billTo: 'X', no: draftNo, date: '2026-10-31', notes: '' },
      revLines: [{ desc: 'work', amt: 100, date: pa, src: 'entry' }],
      sub: 100, tax: 0, total: 100, pa: pa, pb: pb, today: '2026-10-31', now: 1700000000000,
      company: { name: 'Asjad Kamal', gst: '', addr: '' }, province: 'AB', country: 'Canada',
      prefNo: prefNo, profileId: pid
    });
  }
  /* under A (active): Ai's next number is 1152 */
  let r = issue(w, 'p1', '', String(w.store._data.onboarding.nextInvoiceNo), '2026-10-16', '2026-10-31');
  eq('e1 issuing under A takes #1152', r.ok && r.rec.no, '1152');
  eq('e2 the issued record carries As stamp', r.ok && r.rec.profileId, 'p1');
  eq('e3 the next A number reported is 1153', r.nextPrefNo, '1153');
  w.store._data.onboarding.nextInvoiceNo = r.nextPrefNo; w.store.set('onboarding', w.store._data.onboarding); /* what setNextInvoiceNo does */
  r = issue(w, 'p1', '1152', '1153', '2026-10-16', '2026-10-31');
  eq('e4 re-using 1152 under A is refused as a collision', r.ok, false);
  /* switching captures the advanced number into As record */
  w.WP.switchTo('p2');
  eq('e5 As record now holds 1153', String(w.WP.of('p1').nextInvoiceNo), '1153');
  eq('e6 the working copy shows Bs own next number', String(w.store._data.onboarding.nextInvoiceNo), '1');
  r = issue(w, 'p2', '', '1', '2026-10-24', '2026-10-31');
  eq('e7 issuing under B starts at Bs own #1 — not 1154', r.ok && r.rec.no, '1');
  eq('e8 the B record carries Bs stamp', r.ok && r.rec.profileId, 'p2');
  eq('e9 the next B number is 2', r.nextPrefNo, '2');
  r = issue(w, 'p2', '1152', '2', '2026-10-24', '2026-10-31');
  eq('e10 the number 1152 is free inside Bs book (no cross-profile collision)', r.ok, true);
  const list = w.store._data.inv_list || [];
  eq('e11 the whole issued book holds every invoice', list.length, 4);
  eq('e12 As book: legacy #1151 + #1152', list.filter(function (x) { return w.WP.idOf(x) === 'p1'; }).length, 2);
  eq('e13 Bs book: its two issues', list.filter(function (x) { return w.WP.idOf(x) === 'p2'; }).length, 2);
}

/* ================= (f) seam units ================= */
{
  const w = makeWorld({ onboarding: ONB });
  eq('f1 idOf a stamped record', w.WP.idOf({ profileId: 'p2' }), 'p2');
  eq('f2 idOf null', w.WP.idOf(null), 'p1');
  eq('f3 rateOf an unknown profile falls back to the account chain', w.WP.rateOf('pZZZ'), 29);
  /* legacy-card edit while A active is captured, and survives a round trip */
  const o = w.store._data.onboarding; o.ownWageRate = '31'; w.store.set('onboarding', o);
  w.WP.captureActive();
  eq('f4 a legacy Preferences edit lands in the active record', String(w.WP.of('p1').rate), '31');
  w.WP.add(Object.assign({}, PROFILE_B));
  w.WP.switchTo('p2');
  eq('f5 under B the working rate is Bs', String(w.store._data.onboarding.ownWageRate), '35');
  w.WP.switchTo('p1');
  eq('f6 back under A the edited rate is restored', String(w.store._data.onboarding.ownWageRate), '31');
  /* profile edits: inactive edits never touch the working copy; active edits mirror */
  w.WP.saveProfile('p2', { plate: 'NEW 111' });
  eq('f7 editing inactive B writes Bs record only', w.WP.of('p2').plate, 'NEW 111');
  eq('f8 the working copy still wears As plate', w.store._data.onboarding.plate, '04 R209');
  w.WP.switchTo('p2');
  w.WP.notePlate('XYZ 999');
  eq('f9 a plate filed under B writes back to Bs record', w.WP.of('p2').plate, 'XYZ 999');
  eq('f10 ...and to the working copy while B is active', w.store._data.onboarding.plate, 'XYZ 999');
  eq('f11 As plate is untouched by Bs write-back', w.WP.of('p1').plate, '04 R209');
}

/* ================= (c) PTI per profile (real module, fake DOM) ================= */
const SIGURL = 'data:image/jpeg;base64,SIGBYTES';
function FakeCtx() {
  return { fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '',
    fillRect: function () {}, beginPath: function () {}, moveTo: function () {},
    lineTo: function () {}, stroke: function () {}, drawImage: function () {} };
}
function FakeEl(sel) {
  this._sel = sel || ''; this._kids = {}; this._html = '';
  this.value = ''; this.textContent = ''; this.style = {}; this.files = [];
  this.onclick = null; this._listeners = {}; this.options = [{ text: '' }]; this.selectedIndex = 0;
  this.classList = { add: function () {}, remove: function () {}, toggle: function () {} };
}
Object.defineProperty(FakeEl.prototype, 'innerHTML', {
  get: function () { return this._html; },
  set: function (v) { this._html = String(v); this._kids = {}; this._attrKids = {}; }
});
FakeEl.prototype.querySelector = function (sel) { return this._kids[sel] || (this._kids[sel] = new FakeEl(sel)); };
FakeEl.prototype.querySelectorAll = function (sel) {
  const html = this._html || ''; const out = [];
  const re = new RegExp(sel.replace(/[[\]]/g, '') + '="([^"]*)"', 'g');
  this._attrKids = this._attrKids || {};
  let m;
  while ((m = re.exec(html))) {
    const key = sel + '=' + m[1];
    if (!this._attrKids[key]) {
      const el = new FakeEl(sel);
      el.getAttribute = (function (v) { return function () { return v; }; })(m[1]);
      this._attrKids[key] = el;
    }
    out.push(this._attrKids[key]);
  }
  return out;
};
FakeEl.prototype.addEventListener = function (type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); };
FakeEl.prototype.fire = function (type, ev) { (this._listeners[type] || []).forEach(function (fn) { fn(ev || {}); }); };
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };
FakeEl.prototype.getContext = function () { return FakeCtx(); };
FakeEl.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: 660, height: 220 }; };
FakeEl.prototype.toDataURL = function () { return SIGURL; };
FakeEl.prototype.setPointerCapture = function () {};

function makePtiWorld(onb, profiles) {
  const store = memStore({ onboarding: onb, work_profiles: profiles });
  const sb = {
    window: {}, Meticulous: { modules: {} }, console: console,
    Image: function () { return {}; },
    App: {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s); },
      _today: function () { return '2026-10-24'; },
      _wirePhotoOCR: null, _bumpOdometer: function () { return {}; }
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(extractRegion(appSrc, 'WORK-PROFILES-BEGIN', 'WORK-PROFILES-END'), sb);
  vm.runInContext(read('modules/pti.js'), sb);
  return { sb: sb, store: store, pti: sb.Meticulous.modules.pti };
}
function filePti(w) {
  const items = {};
  w.pti._sched1.forEach(function (it) { items[it.id] = { r: 'ok' }; });
  w.store.set('pti_draft', { items: items, odo: '170079', carrier: null, carrierAddr: null, unit: null,
    plate: null, loc: '', driver: null, lat: null, lng: null, kind: 'pre', sig: SIGURL });
  const body = new FakeEl('body');
  w.pti.render(body);
  /* a real DOM input HOLDS its rendered value — the fake inputs
     start blank, so hand them exactly what the render printed
     (this is also the pre-fill proof: the values below are read
     out of the rendered HTML, never out of the store). */
  ['pti_carrier', 'pti_unit', 'pti_plate'].forEach(function (id) {
    const m = new RegExp('id="' + id + '" value="([^"]*)"').exec(body._html);
    body.querySelector('#' + id).value = m ? m[1] : '';
    body['_' + id] = m ? m[1] : null;
  });
  body.querySelector('#pti_odo').value = '170079';
  body._formHtml = body._html; /* filing re-renders onto the report face — keep the form */
  body.querySelector('#pti_file').onclick();
  return body;
}
{
  const P1REC = { id: 'p1', company: 'AI Trucking', truckNo: '07', plate: '04 R209', rate: '29', rateIncludesTax: true, taxRate: '5', nextInvoiceNo: '1152' };
  const P2REC = Object.assign({ id: 'p2' }, PROFILE_B);
  /* B active: the working copy mirrors B (as the switch leaves it) */
  const onbB = Object.assign({}, ONB, { contractingCo: 'Other Carrier Ltd', truckNo: '12', plate: 'XYZ 999', ownWageRate: '35', nextInvoiceNo: '1', rateIncludesTax: false });
  const wB = makePtiWorld(onbB, { list: [P1REC, P2REC], activeId: 'p2' });
  const bodyB = filePti(wB);
  const repB = (wB.store._data.pti_reports || [])[0] || {};
  eq('c0 the form pre-fills Bs plate from the active profile', bodyB._pti_plate, 'XYZ 999');
  eq('c1 the PTI filed under B carries Bs plate', repB.plate, 'XYZ 999');
  eq('c2 ...Bs carrier', repB.carrier, 'Other Carrier Ltd');
  eq('c3 ...Bs truck unit', repB.unit, '12');
  eq('c4 ...and Bs stamp', repB.profileId, 'p2');
  ok('c5 the PTI form names the active profile (working-for line)',
    bodyB._formHtml.indexOf('Working for') !== -1 && bodyB._formHtml.indexOf('Other Carrier Ltd') !== -1, bodyB._formHtml.slice(0, 160));
  /* A active */
  const wA = makePtiWorld(ONB, { list: [P1REC, P2REC], activeId: 'p1' });
  filePti(wA);
  const repA = (wA.store._data.pti_reports || [])[0] || {};
  eq('c6 the PTI filed under A carries As plate', repA.plate, '04 R209');
  eq('c7 ...As carrier', repA.carrier, 'AI Trucking');
  eq('c8 ...and As stamp', repA.profileId, 'p1');
}

/* ================= (g) the union can never strip a stamp ================= */
{
  const cs = read('js/cloudsync.js');
  const sb = { console: console };
  vm.createContext(sb);
  vm.runInContext('var RECORD_LIST_KEYS = { fuel_fills: 1, rev_entries: 1, rev_extras: 1, pti_reports: 1, sessions: 1 };', sb);
  ['recordIdentity', 'recordCompleteness', 'mergeRecordLists'].forEach(function (fn) {
    vm.runInContext(extractFn(cs, fn), sb);
  });
  const bare = { id: 'pti1', date: '2026-10-24', plate: 'XYZ 999', signed: true };
  const stamped = Object.assign({}, bare, { profileId: 'p2' });
  const m1 = sb.mergeRecordLists('pti_reports', [bare], [stamped]);
  eq('g1 union of a bare + stamped PTI keeps ONE record', m1.length, 1);
  eq('g2 ...and the stamp survives', m1[0] && m1[0].profileId, 'p2');
  const m2 = sb.mergeRecordLists('pti_reports', [stamped], [bare]);
  eq('g3 the stamp survives the other order too', m2[0] && m2[0].profileId, 'p2');
  const sBare = { date: '2026-10-24', seconds: 39600, endedAt: '2026-10-24T18:00:00.000Z' };
  const sStamped = Object.assign({}, sBare, { profileId: 'p2' });
  const m3 = sb.mergeRecordLists('sessions', [sBare], [sStamped]);
  eq('g4 a session stamp survives its union', m3[0] && m3[0].profileId, 'p2');
}

/* ================= (h) wiring pins ================= */
{
  const pref = read('modules/preferences.js');
  ok('h1 Preferences carries the WORK PROFILES card', /Work profiles/.test(pref) && pref.indexOf('pf_wp_add') !== -1);
  ok('h2 the card wires a one-tap switch', pref.indexOf('pf_wp_use') !== -1 || /data-wp-use/.test(pref));
  ok('h3 Preferences Save captures into the active profile record', /captureActive/.test(pref));
  const idx = read('index.html');
  ok('h4 the dashboard carries the profile chip slot', idx.indexOf('id="trkProfile"') !== -1);
  ok('h5 the tracker stamps its starting profile', /tracker[\s\S]{0,200}profileId|profileId[\s\S]{0,120}trackerSave/.test(appSrc) && appSrc.indexOf('App.workProfiles') !== -1);
  ok('h6 the saved session entry carries the stamp', /entry\.profileId/.test(appSrc));
  const dsp = read('modules/dispatch.js');
  ok('h7 dispatch prices a completion from the records own profile', /workProfiles/.test(dsp));
  ok('h8 dispatch stamps the revenue entry it posts', /revEntry\.profileId|profileId:.*WP|profileId:.*workProfile/.test(dsp));
  const inv = invSrc;
  ok('h9 revenueLinePlan takes the profile scope', /function revenueLinePlan\(a, b, pid\)/.test(inv));
  ok('h10 the invoice book reads through the profile filter', /invoicesFor\(/.test(inv));
  const man = read('modules/manifest.js');
  ok('h11 the manifest prices a day at its own profiles rate', /workProfiles/.test(man));
  const rev = read('modules/revenue.js');
  ok('h12 Revenue reads are scoped to the active profile', /entriesAll\(\)/.test(rev) && /activeId\(\)/.test(rev));
  ok('h13 the extras writer stamps the active profile', /profileId/.test(rev));
}

/* ================= (i) TRAP 1 — the odometer is PER TRUCK ================= */
function extractAssign(src, marker) {
  const i = src.indexOf(marker);
  if (i === -1) throw new Error('assign not found: ' + marker);
  let depth = 0, j = src.indexOf('{', i), k = j;
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(i, k + 2);
}
function makeOdoWorld(seed) {
  const store = memStore(seed);
  const sb = {
    window: {}, console: console,
    App: { _store: store, _esc: function (s) { return String(s == null ? '' : s); }, _today: function () { return '2026-10-23'; } }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(extractRegion(appSrc, 'WORK-PROFILES-BEGIN', 'WORK-PROFILES-END'), sb);
  vm.runInContext('var ODO_MAX_JUMP_KM = 1000;', sb);
  sb.store = store;
  ['masterOdometer', 'logOdoReading', 'bumpOdometer', 'seedOdoReadings'].forEach(function (fn) {
    vm.runInContext(extractFn(appSrc, fn), sb);
  });
  return { sb: sb, store: store, WP: sb.App.workProfiles };
}
{
  const w = makeOdoWorld({ onboarding: JSON.parse(JSON.stringify(ONB)), mt_odo: '170079', odo_readings: [{ ts: 1, date: '2026-10-22', value: 170079, source: 'pti' }] });
  eq('i1 under Ai the master is Truck 07s 170,079', w.sb.masterOdometer(), 170079);
  eq('i2 keyFor under Profile 1 is the legacy key', w.WP.keyFor('mt_odo'), 'mt_odo');
  w.WP.add(PROFILE_B);
  w.WP.switchTo('p2');
  eq('i3 under the temp profile the master is EMPTY (its own chain)', w.sb.masterOdometer(), null);
  eq('i4 keyFor under Profile 2 is its own chain key', w.WP.keyFor('mt_odo'), 'mt_odo__p2');
  const b1 = w.sb.bumpOdometer(51200, 'pti');
  ok('i5 the temp trucks first reading raises ITS master', b1.raised === true && b1.value === 51200);
  eq('i6 Truck 07s master is UNTOUCHED by the temp reading', w.store._data.mt_odo, '170079');
  eq('i7 the temp reading landed in the temp chain', w.store._data.mt_odo__p2, '51200');
  eq('i8 Truck 07s dated log gained nothing', (w.store._data.odo_readings || []).length, 1);
  ok('i9 the temp log holds the temp reading', (w.store._data.odo_readings__p2 || []).some(function (r) { return r.value === 51200; }));
  const b2 = w.sb.bumpOdometer(51350, 'pti');
  ok('i10 the temp chain climbs on its own', b2.raised === true && w.store._data.mt_odo__p2 === '51350' && w.store._data.mt_odo === '170079');
  const b3 = w.sb.bumpOdometer(40000, 'pti');
  ok('i11 a below-temp-master capture is refused in the temp chain', b3.raised === false && w.store._data.mt_odo__p2 === '51350');
  w.WP.switchTo('p1');
  eq('i12 back on Ai the master is 170,079 again', w.sb.masterOdometer(), 170079);
  const b4 = w.sb.bumpOdometer(170050, 'pti');
  ok('i13 a below-07 capture is still refused (chain discipline intact)', b4.raised === false && w.store._data.mt_odo === '170079');

  /* the seed can never carry another truck's evidence into a chain */
  const w2 = makeOdoWorld({
    onboarding: JSON.parse(JSON.stringify(ONB)), mt_odo: '170079', odo_readings: [], sessions: [], mt_events: [],
    fuel_fills: [
      { date: '2026-10-22', time: '12:47', odo: 169999, litres: 99.047, cost: 239.59 },
      { date: '2026-10-24', time: '09:00', odo: 51200, litres: 50, cost: 100, profileId: 'p2' }
    ],
    pti_reports: [
      { odometer: 170050, filedAt: new Date(2026, 9, 23, 8, 0).getTime(), date: '2026-10-23' },
      { odometer: 99999, filedAt: new Date(2026, 9, 24, 8, 0).getTime(), date: '2026-10-24', profileId: 'p2' }
    ]
  });
  w2.sb.seedOdoReadings();
  const vals = (w2.store._data.odo_readings || []).map(function (r) { return r.value; });
  ok('i14 the seed still takes Truck 07s own fill + PTI evidence', vals.indexOf(169999) !== -1 && vals.indexOf(170050) !== -1, JSON.stringify(vals));
  ok('i15 the seed refuses the temp trucks fill + PTI', vals.indexOf(51200) === -1 && vals.indexOf(99999) === -1, JSON.stringify(vals));

  /* stickers + baseline are carried per truck, never inherited */
  const onbS = Object.assign({}, ONB, { safetyExpiry: '2027-05-31', odometerBaseline: '170079' });
  const w3 = makeWorld({ onboarding: JSON.parse(JSON.stringify(onbS)), rev_entries: JSON.parse(JSON.stringify(OCT)), inv_list: [INV1151] });
  w3.WP.captureActive();
  eq('i16 Profile 1s record carries 07s sticker', w3.WP.of('p1').safetyExpiry, '2027-05-31');
  const pB = w3.WP.add({}); w3.WP.switchTo(pB.id);
  eq('i17 the temp profile opens with NO sticker (not 07s)', w3.store._data.onboarding.safetyExpiry, '');
  const ob = w3.store._data.onboarding; ob.safetyExpiry = '2026-08-31'; w3.store.set('onboarding', ob);
  w3.WP.captureActive();
  eq('i18 the temp trucks sticker lands on ITS record', w3.WP.of(pB.id).safetyExpiry, '2026-08-31');
  w3.WP.switchTo('p1');
  eq('i19 back on Ai, 07s sticker is restored exactly', w3.store._data.onboarding.safetyExpiry, '2027-05-31');
}

/* ================= (j) TRAP 2 — the Connect fence ================= */
{
  const cp = read('js/connectpipe.js');
  const sb = { window: {}, console: console, CP: {}, _data: null };
  sb.window = sb;
  vm.createContext(sb);
  sb.store = function () {
    return { get: function (k, d) { return (k in sb._data) ? sb._data[k] : d; } };
  };
  vm.runInContext('var store = this.store; var CP = this.CP;', sb);
  vm.runInContext(extractFn(cp, 'wpIdOfRec'), sb);
  vm.runInContext(extractAssign(cp, 'CP.recordDate = function'), sb);
  vm.runInContext(extractAssign(cp, 'CP._dayFenced = function'), sb);
  const D = '2026-10-24';
  function fencedWith(data) { sb._data = data; return sb.CP._dayFenced(D); }
  eq('j1 an unstamped (legacy) day is NOT fenced', fencedWith({ dsp_list: [{ date: D, scheduledAt: D + 'T08:00', status: 'completed' }], sessions: [{ date: D, seconds: 36000 }], rev_entries: [{ date: D, amount: '319.00' }] }), false);
  eq('j2 a Profile-1-stamped day is NOT fenced', fencedWith({ dsp_list: [], sessions: [{ date: D, seconds: 36000, profileId: 'p1' }], rev_entries: [] }), false);
  eq('j3 a day with a temp-profile SESSION is fenced', fencedWith({ dsp_list: [], sessions: [{ date: D, seconds: 39600, profileId: 'p2' }], rev_entries: [] }), true);
  eq('j4 a day with a temp-profile DISPATCH is fenced', fencedWith({ dsp_list: [{ date: D, scheduledAt: D + 'T08:00', profileId: 'p2' }], sessions: [], rev_entries: [] }), true);
  eq('j5 a day with a temp-profile ENTRY is fenced', fencedWith({ dsp_list: [], sessions: [], rev_entries: [{ date: D, amount: '385.00', profileId: 'p2' }] }), true);
  eq('j6 temp stamps on OTHER dates do not fence this day', fencedWith({ dsp_list: [], sessions: [{ date: '2026-10-25', seconds: 39600, profileId: 'p2' }], rev_entries: [] }), false);
  const pubDay = extractAssign(cp, 'CP.publishDay = function');
  ok('j7 publishDay checks the fence before building', pubDay.indexOf('_dayFenced') !== -1 && pubDay.indexOf('_dayFenced') < pubDay.indexOf('buildDay'));
  ok('j8 the records doc filters temp fills', /fuel[\s\S]{0,400}wpIdOfRec\(x\) === 'p1'/.test(cp));
  ok('j9 shared PTI filters temp reports', /sharedPti[\s\S]{0,600}wpIdOfRec\(r\) === 'p1'/.test(cp));
  ok('j10 billing filters temp invoices', /buildBilling[\s\S]{0,400}wpIdOfRec\(r\) === 'p1'/.test(cp));
  ok('j11 manifest days skip fenced dates', (cp.match(/_dayFenced\(d\)/g) || []).length >= 2);
}

/* ================= (k) TRAP 3 — switch-back restores Ai EXACTLY ================= */
{
  const w = makeWorld({ onboarding: JSON.parse(JSON.stringify(ONB)), rev_entries: JSON.parse(JSON.stringify(OCT)), inv_list: [INV1151] });
  w.WP.captureActive();
  const p1Before = JSON.stringify(w.WP.of('p1'));
  const onbFields = function () {
    const o = w.store._data.onboarding;
    return { contractingCo: o.contractingCo, truckNo: o.truckNo, plate: o.plate, ownWageRate: o.ownWageRate, rateIncludesTax: o.rateIncludesTax, invoiceTaxRate: o.invoiceTaxRate, nextInvoiceNo: o.nextInvoiceNo };
  };
  const fieldsBefore = JSON.stringify(onbFields());
  const pB = w.WP.add(PROFILE_B);
  w.WP.switchTo(pB.id);
  /* his edits under B, saved the legacy way (pf_save -> captureActive) */
  const ob = w.store._data.onboarding;
  ob.contractingCo = 'Other Carrier Ltd'; ob.truckNo = '12'; ob.plate = 'XYZ 999';
  ob.ownWageRate = '35'; ob.rateIncludesTax = false; ob.invoiceTaxRate = '5'; ob.nextInvoiceNo = '7';
  w.store.set('onboarding', ob);
  w.WP.captureActive();
  w.WP.switchTo('p1');
  eq('k1 the working copy is byte-for-byte Ai again', JSON.stringify(onbFields()), fieldsBefore);
  eq('k2 Profile 1s stored record is byte-for-byte what it was', JSON.stringify(w.WP.of('p1')), p1Before);
  eq('k3 Octobers invoice plan under Ai is unchanged', planTotal(w, '2026-10-16', '2026-10-31', 'p1'), OCT_TOTAL);
  eq('k4 Profile 2 kept its own edited facts', [w.WP.of(pB.id).company, w.WP.of(pB.id).nextInvoiceNo, w.WP.of(pB.id).rate], ['Other Carrier Ltd', '7', '35']);
  eq('k5 the Ai working rate is 29 again', w.WP.rateOf('p1'), 29);
}

/* ================= (l) TRAPS 4+5 — close prompt + dispatch-driven start ================= */
{
  const revSlice = extractFn(appSrc, 'paintEndReview');
  ok('l1 the close review offers the switch-back under a non-main profile', revSlice.indexOf('trkEndSwitchBack') !== -1 && revSlice.indexOf("sessPid !== 'p1'") !== -1);
  ok('l2 the switch-back runs the Confirm BEFORE the switch', revSlice.indexOf('App.trackerConfirmEnd()') !== -1 && revSlice.indexOf('App.trackerConfirmEnd()') < revSlice.indexOf("switchTo('p1')"));
  const plan = extractFn(appSrc, 'autostartPlan');
  ok('l3 the autostart plan never filters by profile (the dispatch time drives the start)', plan.indexOf('profileId') === -1);
  ok('l4 the tracker start stamps are seam-safe (inline guards)', appSrc.indexOf('try { t.profileId = App.workProfiles.activeId(); } catch (e) {}') !== -1 && appSrc.indexOf('try { App.tracker.profileId = App.workProfiles.activeId(); } catch (e) {}') !== -1);
  const fuel = read('modules/fuel.js');
  ok('l5 a new fill is stamped with its profile', fuel.indexOf('rec.profileId = wpActiveId()') !== -1);
  const mt = read('modules/maintenance.js');
  ok('l6 Maintenance routes per-truck keys through the chain', mt.indexOf('MT_TRUCK_KEYS') !== -1 && mt.indexOf('mtChainKey') !== -1);
  const rem = read('modules/reminders.js');
  ok('l7 reminders read the active trucks master + sticker', rem.indexOf("wpKey('mt_odo')") !== -1 && rem.indexOf("wpKey('mt_annualDate')") !== -1);
}

console.log('\nwork-profiles-v242 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
