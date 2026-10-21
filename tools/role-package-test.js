#!/usr/bin/env node
/* Meticulous v52 — role package tests:
 * (1) onboarding "Do you drive a truck yourself?" (onboarding.userRole),
 * (2) role-tuned dashboards, (3) travel-bonus gating (audit Oct 14).
 *
 * Runs the REAL shipped code: the ROLE region of js/app.js and the
 * DSP-COMPLETE region of modules/dispatch.js are extracted verbatim into
 * vm sandboxes; modules/pnl.js is loaded whole over an in-memory store
 * and exercised via its own _driverWages / _calc test hooks. Source
 * assertions cover the Preferences layout (stub card removed, cloud
 * sync in Advanced, NO Security card since v106 — login has its own
 * page, tools/account-login-test.js — one bottom Save, role control
 * in the Account card) and onboarding step placement. v54 extended the
 * layout assertions: standalone Notifications card removed, its push
 * button a row inside Advanced (updates → notifications → sync →
 * reset).
 * Run: node tools/role-package-test.js
 *
 * Owner's rules under test (Oct 14, 2026):
 *  - userRole is the PERSON ('driver' | 'both' | 'office'), separate
 *    from accountType; existing users migrate by accountType
 *    (Driver→driver, Owner-Operator→both, Fleet Manager→office),
 *    idempotently, never stomping a picked value.
 *  - office dashboards: no tracker card; office modules lead; nothing
 *    entitled is ever removed — emphasis only.
 *  - dispatch completion as driver/both: the Revenue entry is the
 *    pre-v52 entry to the cent (Asjad's October: 10.5 foreman + 1
 *    travel = 11.5h × $29 = $333.50), plus foremanHours/travelHours
 *    split fields. As office: travel never enters income; it is
 *    routed to the identified driver as a P&L wage claim, or the
 *    completion text discloses it was held out.
 *  - P&L wages: travel pay = per-driver travelHours × distinct logged
 *    days × rate, itemized, PLUS routed dispatch claims — a day with
 *    a claim is never double-paid by the computed component.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.log('  ✗ FAIL: ' + label); }
}
function eq(a, b, label) { ok(a === b, label + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function deepEq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), label + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

function extract(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}

function memStore(seed) {
  const data = Object.assign({}, seed || {});
  const writes = [];
  return {
    data, writes,
    get(k, d) { return (k in data) ? data[k] : d; },
    set(k, v) { writes.push(k); data[k] = v; return true; },
    del(k) { delete data[k]; return true; }
  };
}

/* ================= 1. ROLE region (js/app.js) ================= */
const appSrc = read('js/app.js');
const roleRegion = extract(appSrc, 'ROLE-BEGIN', 'ROLE-END');
ok(!/alert\(|confirm\(/.test(roleRegion), 'ROLE region: no native alert/confirm');

function roleSandbox(store) {
  const sb = { store, App: {}, console };
  vm.createContext(sb);
  vm.runInContext(roleRegion, sb);
  return sb;
}

{
  const sb = roleSandbox(memStore());
  eq(sb.roleDefaultFor('Driver'), 'driver', 'default: Driver→driver');
  eq(sb.roleDefaultFor('Owner-Operator'), 'both', 'default: Owner-Operator→both');
  eq(sb.roleDefaultFor('Fleet Manager'), 'office', 'default: Fleet Manager→office');
  eq(sb.roleDefaultFor(undefined), 'driver', 'default: unset accountType→driver');
  eq(sb.resolveUserRole({ accountType: 'Owner-Operator', userRole: 'office' }), 'office', 'resolve: picked value wins over accountType default');
  eq(sb.resolveUserRole({ accountType: 'Fleet Manager' }), 'office', 'resolve: missing→accountType default');
  eq(sb.resolveUserRole({ accountType: 'Driver', userRole: 'boss' }), 'driver', 'resolve: invalid value→default');
  eq(sb.App.userRole(), 'driver', 'App.userRole on empty store→driver');
}
{
  // Migration: stamps the default once, idempotent, never stomps a pick.
  const st = memStore({ onboarding: { accountType: 'Fleet Manager' } });
  const sb = roleSandbox(st);
  eq(sb.ensureUserRole(), 'office', 'migration: Fleet Manager→office');
  eq(st.data.onboarding.userRole, 'office', 'migration: stamped into onboarding');
  const writesAfterFirst = st.writes.length;
  eq(sb.ensureUserRole(), 'office', 'migration: second run same result');
  eq(st.writes.length, writesAfterFirst, 'migration: idempotent — second run writes nothing');
}
{
  const st = memStore({ onboarding: { accountType: 'Owner-Operator', userRole: 'driver' } });
  const sb = roleSandbox(st);
  eq(sb.ensureUserRole(), 'driver', 'migration: user pick preserved (OO who only drives)');
  eq(st.writes.length, 0, 'migration: no write when a valid pick exists');
}
{
  const st = memStore({ onboarding: { accountType: 'Driver', userRole: 'bogus' } });
  const sb = roleSandbox(st);
  eq(sb.ensureUserRole(), 'driver', 'migration: invalid stored value replaced by default');
  eq(st.data.onboarding.userRole, 'driver', 'migration: invalid value stamped over');
}

/* ---- dashboard composition per role ---- */
{
  const sb = roleSandbox(memStore());
  eq(sb.roleShowsTracker('office'), false, 'dashboard: office ⇒ NO tracker card');
  eq(sb.roleShowsTracker('driver'), true, 'dashboard: driver ⇒ tracker');
  eq(sb.roleShowsTracker('both'), true, 'dashboard: both ⇒ tracker');

  /* v77: 'navigator' joins every role order right after 'navigation'
     (eleven modules now — the set grows, nothing is removed).
     v119: MERGED — 'navigation' is GONE as a door (owner: "Why
     are there 2 modules?"); the Navigator is the one door and
     the set is ten. */
  const ALL = ['revenue', 'dispatch', 'navigator', 'fuel', 'pnl', 'maintenance', 'damage', 'manifest', 'invoice', 'connect'];
  /* v162: 'pti' (Pre-Trip Inspection) joins the DRIVER faces —
     driver + both carry eleven modules; the office set stays the
     ten above (no PTI card on the office face, owner Oct 18). */
  const ALL_DRIVE = ['revenue', 'dispatch', 'navigator', 'fuel', 'pnl', 'maintenance', 'pti', 'damage', 'manifest', 'invoice', 'connect'];
  deepEq(sb.roleModuleOrder('both'), ALL_DRIVE, 'dashboard: both = the merged order (one Navigator door, no Navigation)');
  /* v76 (F4): superseded Oct 14, 2026 by the owner's Connect Phase-2
     blueprint — the office home leads with the boss's five tools,
     Connect FIRST, then Dispatch, Invoice, Maintenance, P&L.
     v167 SUPERSEDES the set itself (owner, Oct 18, 2026 21:50
     MDT): the office face carries ONLY the five office tools —
     Connect, Dispatch, Invoice, P&L, Manifest; the driver
     modules are removed from the office face entirely. */
  const OFFICE_FIVE = ['connect', 'dispatch', 'invoice', 'pnl', 'manifest'];
  deepEq(sb.roleModuleOrder('office'), OFFICE_FIVE, 'dashboard: office = ONLY the five office tools, connect first');
  eq(sb.roleModuleOrder('driver')[0], 'revenue', 'dashboard: driver leads with revenue (tracker feeds it)');
  ['driver', 'both', 'office'].forEach(function (r) {
    const ord = sb.roleModuleOrder(r);
    const want = (r === 'office') ? OFFICE_FIVE : ALL_DRIVE; // v167: office = the five only
    eq(ord.length, want.length, 'dashboard ' + r + ': ' + want.length + ' modules present (v119 merge: Navigation folded into Navigator; v162: PTI on driver faces; v167: office keeps only its five)');
    deepEq(ord.slice().sort(), want.slice().sort(), 'dashboard ' + r + ': the role’s module set');
  });

  const KEYS = ['dashboard', 'revenue', 'dispatch', 'navigation', 'navigator', 'fuel', 'pnl', 'maintenance', 'damage', 'manifest', 'invoice', 'connect', 'reminders', 'preferences', 'subscription', 'feedback', 'logout'];
  const items = KEYS.map(function (k) { return [k, '', k]; });
  const off = sb.roleSidebarOrder('office', items).map(function (i) { return i[0]; });
  /* v167: the office sidebar is FILTERED to the five tools + the
     account utilities — driver modules never appear (supersedes
     the v76 'keeps every item' pin). */
  deepEq(off.slice(0, 6), ['dashboard', 'connect', 'dispatch', 'invoice', 'pnl', 'manifest'], 'sidebar: office leads with the office five, connect first');
  eq(off.length, 11, 'sidebar: office keeps the five + utilities only');
  deepEq(off.slice().sort(), ['account', 'connect', 'dashboard', 'dispatch', 'feedback', 'invoice', 'logout', 'manifest', 'pnl', 'preferences', 'reminders', 'subscription'].filter(function (k) { return KEYS.indexOf(k) >= 0; }).sort(), 'sidebar: office set = five tools + utilities');
  const drv = sb.roleSidebarOrder('driver', items).map(function (i) { return i[0]; });
  deepEq(drv.slice(0, 3), ['dashboard', 'revenue', 'dispatch'], 'sidebar: driver leads with revenue/dispatch');
  eq(drv.length, 17, 'sidebar: driver keeps every item');
  const both = sb.roleSidebarOrder('both', items).map(function (i) { return i[0]; });
  deepEq(both, KEYS, 'sidebar: both = the pre-v52 order, unchanged');
}

/* ---- onboarding placement (source) ---- */
{
  const iAcct = appSrc.indexOf("{ key: 'accountType'");
  const iRole = appSrc.indexOf("{ key: 'userRole'");
  const iEmp = appSrc.indexOf("{ key: 'employment'");
  ok(iAcct >= 0 && iRole > iAcct && iEmp > iRole, 'onboarding: userRole question sits right after accountType, before employment');
  ok(appSrc.indexOf("key: 'userRole'") === appSrc.lastIndexOf("key: 'userRole'"), 'onboarding: exactly one userRole step');
  ok(read('index.html').indexOf('id="trkCard"') >= 0, 'index.html: tracker card carries id=trkCard for role tuning');
}

/* ================= 2. DSP-COMPLETE region (modules/dispatch.js) ================= */
const dspSrc = read('modules/dispatch.js');
const planRegion = extract(dspSrc, 'DSP-COMPLETE-BEGIN', 'DSP-COMPLETE-END');
ok(!/alert\(|confirm\(/.test(planRegion), 'DSP-COMPLETE region: no native alert/confirm');
const dsp = { console };
vm.createContext(dsp);
vm.runInContext(planRegion, dsp);
const plan = dsp.dspCompletionPlan;

/* Pre-v52 reference implementation (the old handler's ticket paths),
   copied from git history semantics — driver/both output must match
   it field-for-field on the shared fields. */
function preV52Entry(sum, std, rate, travelBonus, jobSite, date, ticketCount) {
  if (std === 'weight' && sum.totalNetWeight > 0 && rate > 0) {
    const wAmt = sum.totalNetWeight * rate;
    return { date, amount: wAmt.toFixed(2), tons: sum.totalNetWeight.toFixed(2), type: 'weight', loads: ticketCount,
      note: 'Dispatch: ' + jobSite + ' · ' + sum.totalNetWeight.toFixed(2) + 't @ $' + rate + '/t' + ' (' + ticketCount + ' tickets)' };
  }
  if ((std === 'hourly' || std === 'trip') && sum.totalForemanHours > 0) {
    const hAmt = sum.totalPaidHours * rate;
    const brk = sum.breakdown.map(function (b) { return b.label + ': ' + (b.foremanHours || 0) + 'h'; }).join(', ');
    return { date, amount: hAmt.toFixed(2), hours: sum.totalPaidHours.toFixed(2), type: 'hourly', loads: ticketCount,
      note: 'Dispatch: ' + jobSite + ' · foreman ' + sum.totalForemanHours + 'h + travel ' + travelBonus + 'h' + ' = ' + sum.totalPaidHours + 'h' + (brk ? ' (' + brk + ')' : '') };
  }
  return null;
}
function sharedFields(e) {
  if (!e) return null;
  const o = { date: e.date, amount: e.amount, type: e.type, loads: e.loads, note: e.note };
  if (e.hours !== undefined) o.hours = e.hours;
  if (e.tons !== undefined) o.tons = e.tons;
  return o;
}

/* The owner's real October day: 10.5 foreman + 1 travel = 11.5h @ $29. */
const octSum = { ticketCount: 1, totalForemanHours: 10.5, travelBonus: 1, totalPaidHours: 11.5, totalNetWeight: 0,
  breakdown: [{ index: 1, label: 'Card #48213', type: 'haul_card', foremanHours: 10.5, paymentUnit: null, netWeight: null }] };
const octBase = { sum: octSum, std: 'hourly', rate: 29, date: '2026-10-14', jobSite: 'Aecon Infrastructure', ticketCount: 1, travelBonusRaw: 1, driver: null, legacyAmount: '', legacyNetWeight: '', loads: '1', ticketNo: '' };

{
  const want = sharedFields(preV52Entry(octSum, 'hourly', 29, 1, 'Aecon Infrastructure', '2026-10-14', 1));
  /* v105: 'driver' keeps the pre-v52 parity below. 'both' left this
     loop deliberately — the owner-operator's card now posts BOTH
     books (client billing + his own wage posting), pinned in the
     dedicated block further down (owner order, Oct 16, 2026). */
  ['driver'].forEach(function (r) {
    const p = plan(Object.assign({}, octBase, { role: r }));
    deepEq(sharedFields(p.entry), want, 'completion ' + r + ': entry identical to pre-v52 (dry-run parity)');
    eq(p.entry.amount, '333.50', 'completion ' + r + ': $333.50 — October math unchanged to the cent');
    eq(p.entry.foremanHours, 10.5, 'completion ' + r + ': foremanHours split field stored');
    eq(p.entry.travelHours, 1, 'completion ' + r + ': travelHours split field stored');
    eq(p.entry.travelInIncome, true, 'completion ' + r + ': travelInIncome=true');
    eq(p.claim, null, 'completion ' + r + ': no wage claim (the driver keeps his bonus)');
    eq(p.wagePosting, null, 'completion ' + r + ': no wage posting — the entry IS his income');
    eq(p.heldOut, 0, 'completion ' + r + ': nothing held out');
    eq(p.disclosure, '', 'completion ' + r + ': no disclosure needed');
  });
}
{
  const drv = { id: 'd1', name: 'Umar', rate: 27 };
  const p = plan(Object.assign({}, octBase, { role: 'office', driver: drv }));
  eq(p.entry.amount, '304.50', 'completion office+driver: foreman only in income (10.5 × $29)');
  eq(p.entry.hours, '10.50', 'completion office+driver: hours exclude travel');
  eq(p.entry.foremanHours, 10.5, 'completion office+driver: foremanHours stored');
  eq(p.entry.travelHours, 1, 'completion office+driver: travelHours stored (held out, on record)');
  eq(p.entry.travelInIncome, false, 'completion office+driver: travelInIncome=false');
  /* v105 (owner, Oct 16, 2026): the v52 travel-only claim is
     superseded — the card posts the driver's FULL wage (foreman +
     travel) to P&L from this one record. No claim is minted. */
  eq(p.claim, null, 'completion office+driver: no travel-only claim anymore (v105)');
  ok(p.wagePosting && p.wagePosting.driverId === 'd1', 'completion office+driver: wage posting routed to the matched driver');
  eq(p.wagePosting.foremanHours, 10.5, 'completion office+driver: posting foreman hours');
  eq(p.wagePosting.travelHours, 1, 'completion office+driver: posting travel hours');
  eq(p.wagePosting.hours, 11.5, 'completion office+driver: posting hours = foreman + travel');
  eq(p.wagePosting.rate, 27, 'completion office+driver: posting priced at the DRIVER\u2019s rate');
  eq(p.wagePosting.wage, 310.50, 'completion office+driver: posting wage = 11.5h × $27 (travel INSIDE, not on top)');
  eq(p.wagePosting.source, 'dispatch', 'completion office+driver: posting source tagged');
  eq(p.heldOut, 1, 'completion office+driver: heldOut reported');
  eq(p.disclosure, 'Travel 1.0h not added to income — the card\u2019s full wage (11.5h \u00d7 $27 = $310.50) was posted to Umar\u2019s pay in P&L.', 'completion office+driver: disclosure names the wage and the driver');
}
{
  const p = plan(Object.assign({}, octBase, { role: 'office', driver: null }));
  eq(p.claim, null, 'completion office, no driver: no claim');
  eq(p.wagePosting, null, 'completion office, no driver: no wage posting (nobody identified to pay)');
  eq(p.entry.amount, '304.50', 'completion office, no driver: travel still excluded from income');
  eq(p.disclosure, 'Travel 1.0h not added to income — assign the driver in P&L to pay it.', 'completion office, no driver: disclosure says where to pay it');
}
{
  const zeroSum = Object.assign({}, octSum, { travelBonus: 0, totalPaidHours: 10.5 });
  const p = plan(Object.assign({}, octBase, { sum: zeroSum, role: 'office', travelBonusRaw: 0 }));
  eq(p.disclosure, '', 'completion office, zero travel bonus: no disclosure, nothing to hold out');
  eq(p.entry.amount, '304.50', 'completion office, zero travel bonus: entry = foreman math');
  /* …and with a driver identified, the base wage still posts even
     when there is no travel hour at all (v105). */
  const pz = plan(Object.assign({}, octBase, { sum: zeroSum, role: 'office', travelBonusRaw: 0, driver: { id: 'd1', name: 'Umar', rate: 27 } }));
  eq(pz.wagePosting.wage, 283.50, 'completion office+driver, zero travel: posting = foreman 10.5h × $27');
  eq(pz.disclosure, '', 'completion office+driver, zero travel: nothing held out, no disclosure');
}
/* v105: 'both' — the owner-operator's card does DOUBLE DUTY
   (owner order, Oct 16, 2026: one closed card posts as BOTH
   revenue and expense, on the right books). Revenue = foreman
   hours ONLY × billing rate; expense posting = (foreman +
   travel) × wage rate. The travel hour appears in the expense,
   never in the revenue.
   v179 (D1, owner Oct 20, 2026) REVISES the single-rate case:
   when the billing rate and the wage rate are the SAME rate
   (this fixture — no split rates on the card, both fall back to
   the one $29), the one rate is his pay and his paid hours
   include the travel hour, so the entry is the PAID total —
   (foreman + travel) × rate — and travelInIncome is true. His
   Oct 19 read $275.50 for a $304.50 day under the old pin. The
   two-rate split below (billing $40 vs wage $29) is unchanged. */
{
  const p = plan(Object.assign({}, octBase, { role: 'both' }));
  eq(p.entry.amount, '333.50', 'completion both (single-rate, v179 D1): revenue = PAID hours × the one rate (11.5 × $29)');
  eq(p.entry.hours, '11.50', 'completion both (single-rate, v179 D1): revenue hours are the PAID hours');
  eq(p.entry.foremanHours, 10.5, 'completion both: foremanHours stored');
  eq(p.entry.travelHours, 1, 'completion both: travelHours on record');
  eq(p.entry.travelInIncome, true, 'completion both (single-rate, v179 D1): travelInIncome=true — the one rate pays the travel hour too');
  eq(p.claim, null, 'completion both: no claim');
  eq(p.heldOut, 0, 'completion both: nothing held out — the travel lands in the wage posting');
  eq(p.disclosure, '', 'completion both: no disclosure');
  eq(p.mode, 'both-books', 'completion both: mode names the double duty');
  ok(p.wagePosting && p.wagePosting.driverId === 'self', 'completion both: wage posting lands on his own books (self)');
  eq(p.wagePosting.hours, 11.5, 'completion both: posting hours = foreman + travel');
  eq(p.wagePosting.wage, 333.50, 'completion both: posting = 11.5h × $29 wage rate (same-rate default)');
  /* Different rates per side (the owner's worked example):
     foreman 10h, billing $40, wage $29, travel 1h → revenue
     $400.00, expense $319.00, gross margin on the card $81.00. */
  const exSum = { ticketCount: 1, totalForemanHours: 10, travelBonus: 1, totalPaidHours: 11, totalNetWeight: 0,
    breakdown: [{ index: 1, label: 'Card #22729', type: 'haul_card', foremanHours: 10, paymentUnit: null, netWeight: null }] };
  const px = plan({ sum: exSum, std: 'hourly', rate: 29, billingRate: 40, wageRate: 29, role: 'both', date: '2026-10-16', jobSite: 'Aecon Inf', ticketCount: 1, travelBonusRaw: 1, driver: null, legacyAmount: '', legacyNetWeight: '', loads: '1', ticketNo: '' });
  eq(px.entry.amount, '400.00', 'completion both, split rates: revenue = 10h × $40 billing = $400.00');
  eq(px.wagePosting.wage, 319, 'completion both, split rates: expense = 11h × $29 wage = $319.00');
  eq(Math.round((parseFloat(px.entry.amount) - px.wagePosting.wage) * 100) / 100, 81, 'completion both, split rates: gross margin on the card = $81.00');
}
{
  const wSum = { ticketCount: 2, totalForemanHours: 0, travelBonus: 1, totalPaidHours: 1, totalNetWeight: 24.5, breakdown: [] };
  const want = sharedFields(preV52Entry(wSum, 'weight', 12, 1, 'Pit 9', '2026-10-14', 2));
  ['driver', 'office'].forEach(function (r) {
    const p = plan({ sum: wSum, std: 'weight', rate: 12, role: r, date: '2026-10-14', jobSite: 'Pit 9', ticketCount: 2, travelBonusRaw: 1, driver: { id: 'd1', name: 'Umar', rate: 27 }, legacyAmount: '', legacyNetWeight: '', loads: '2', ticketNo: '' });
    deepEq(sharedFields(p.entry), want, 'completion weight ' + r + ': tonnes entry identical to pre-v52, bonus cannot enter');
    eq(p.claim, null, 'completion weight ' + r + ': no travel claim on weight work');
    eq(p.wagePosting, null, 'completion weight ' + r + ': no wage posting on weight work');
  });
}
{
  const p = plan({ sum: null, std: 'hourly', rate: 29, role: 'office', date: '2026-10-14', jobSite: 'Yard', ticketCount: 0, travelBonusRaw: 1, driver: null, legacyAmount: '450', legacyNetWeight: '', loads: '3', ticketNo: 'T-9' });
  eq(p.entry.type, 'load', 'legacy amount fallback: type load');
  eq(p.entry.amount, '450.00', 'legacy amount fallback: amount preserved');
  eq(p.entry.note, 'Dispatch: Yard · ticket #T-9', 'legacy amount fallback: note preserved');
  const pw = plan({ sum: null, std: 'weight', rate: 10, role: 'driver', date: '2026-10-14', jobSite: 'Yard', ticketCount: 0, travelBonusRaw: 1, driver: null, legacyAmount: '', legacyNetWeight: '18.25', loads: '1', ticketNo: '' });
  eq(pw.entry.amount, '182.50', 'legacy weight fallback: tonnes × rate preserved');
  const pn = plan({ sum: null, std: 'hourly', rate: 29, role: 'driver', date: '2026-10-14', jobSite: 'Yard', ticketCount: 0, travelBonusRaw: 1, driver: null, legacyAmount: '', legacyNetWeight: '', loads: '1', ticketNo: '' });
  eq(pn.entry, null, 'no tickets, no legacy values: no entry (pre-v52 behaviour)');
}

/* ================= 3. P&L wages with travel (modules/pnl.js whole) ================= */
{
  const store = memStore({
    onboarding: { payStandard: 'Hourly', payRate: '29' },
    pnl_drivers: [
      { id: 'd1', name: 'Umar', payType: 'hourly', rate: 29, travelHours: 1, start: '2026-09' },
      { id: 'd2', name: 'Sal', payType: 'salary', rate: 3000, start: '2026-01' },
      { id: 'd3', name: 'NoTravel', payType: 'hourly', rate: 29, start: '2026-09' }
    ],
    pnl_wage_entries: [
      { id: 'w1', date: '2026-10-05', driverId: 'd1', qty: 10, unit: 'hrs', rate: 29, wage: 290 },
      { id: 'w2', date: '2026-10-06', driverId: 'd1', qty: 10, unit: 'hrs', rate: 29, wage: 300 }, // snapshot: rate was different when logged — must be kept as stored
      { id: 'w3', date: '2026-10-07', driverId: 'd1', qty: 8, unit: 'hrs', rate: 29, wage: 232 },
      { id: 'w4', date: '2026-10-05', driverId: 'd3', qty: 5, unit: 'hrs', rate: 29, wage: 145 },
      { id: 'w5', date: '2026-09-30', driverId: 'd1', qty: 10, unit: 'hrs', rate: 29, wage: 290 }  // other month — excluded
    ],
    pnl_travel_claims: [
      { id: 'tc1', date: '2026-10-07', driverId: 'd1', hours: 1, rate: 29, wage: 29, source: 'dispatch', jobSite: 'Aecon' }
    ]
  });
  const App = {
    _store: store,
    _esc: function (s) { return String(s == null ? '' : s); },
    _today: function () { return '2026-10-14'; }
  };
  const sb = { window: {}, Meticulous: { modules: {} }, App, console };
  vm.createContext(sb);
  vm.runInContext(read('modules/pnl.js'), sb);
  const pnl = sb.Meticulous.modules.pnl;

  const dw = pnl._driverWages('2026-10');
  eq(dw.per.d1.wage, 909, 'P&L wages: d1 total = base snapshots 822 + travel 87');
  eq(dw.per.d1.travelWage, 87, 'P&L wages: d1 travel = computed 58 (1h × 2 unclaimed days × $29) + claim 29');
  eq(dw.per.d1.travelDetail, 'travel 1h × 2 days = $58.00 · dispatch travel 1h = $29.00', 'P&L wages: travel itemized on its own line (claim day not double-paid)');
  eq(dw.per.d2.wage, 3000, 'P&L wages: salary driver unchanged');
  eq(dw.per.d2.travelWage, 0, 'P&L wages: salary driver gets no computed travel');
  eq(dw.per.d3.wage, 145, 'P&L wages: driver without travelHours — wage untouched');
  eq(dw.per.d3.travelWage, 0, 'P&L wages: driver without travelHours — no travel component');
  eq(dw.total, 4054, 'P&L wages: month total includes travel exactly once');
  const c = pnl._calc('2026-10');
  eq(c.wages, 4054, 'P&L calc: wages total flows through with travel included');
  eq(c.wagesByDriver.d1.travelWage, 87, 'P&L calc: per-driver travel exposed for the breakdown line');
}

/* ================= 4. Preferences layout (source) ================= */
{
  const pref = read('modules/preferences.js');
  ok(pref.indexOf('Auto tracker settings live in') === -1, 'prefs: Tracker auto-start stub card REMOVED');
  ok(pref.indexOf('<h3>☁️ Cloud sync</h3>') === -1, 'prefs: standalone Cloud sync card REMOVED');
  ok(pref.indexOf('☁️ Cloud sync — troubleshooting') >= 0, 'prefs: cloud-sync troubleshooting row lives in Advanced');
  ok(pref.indexOf('<h3>🔔 Notifications</h3>') === -1, 'prefs: standalone Notifications card REMOVED (v54)');
  eq((pref.match(/id="pf_push"/g) || []).length, 1, 'prefs: exactly one Enable push button (moved into Advanced, not duplicated)');
  eq((pref.match(/id="pf_syncnow"/g) || []).length, 1, 'prefs: exactly one Retry sync button (moved, not duplicated)');
  eq((pref.match(/id="pf_role"/g) || []).length, 1, 'prefs: exactly one role control');
  eq((pref.match(/id="pf_save"/g) || []).length, 1, 'prefs: exactly one Save preferences button');
  const iAcct = pref.indexOf('id="pf_acct"');
  const iRole = pref.indexOf('id="pf_role"');
  const iSave = pref.indexOf('id="pf_save"');
  ok(iRole > iAcct, 'prefs: role control sits next to Account type (same card)');
  const iAdv = pref.indexOf('⚙️ Advanced');
  const iSyncRow = pref.indexOf('☁️ Cloud sync — troubleshooting');
  const iReset = pref.indexOf('id="pf_resetonb"');
  const iUpd = pref.indexOf('id="pf_checkupd"');
  const iPushRow = pref.indexOf('🔔 Notifications');
  ok(iPushRow > iAdv, 'prefs: Notifications row is inside Advanced (v54)');
  ok(iPushRow > iUpd, 'prefs Advanced order: Check for updates … then Notifications');
  ok(iSyncRow > iPushRow, 'prefs Advanced order: Notifications … then cloud-sync troubleshooting');
  ok(iReset > iSyncRow, 'prefs Advanced order: cloud sync … then Reset onboarding (fenced danger, last)');
  ok(iSyncRow > iAdv, 'prefs: sync troubleshooting row is inside Advanced');
  ok(iReset > iUpd, 'prefs: Reset onboarding fenced below Check for updates');
  /* v106 (owner directive, Oct 16, 2026): the Security card LEFT
     Preferences — login has its own page (modules/account.js, pinned
     in tools/account-login-test.js). The v52 "Security last card"
     order pins are replaced by absence pins.
     v107 PIN MOVE: the page-order pin ("Advanced … then Save")
     described ONE scrolling page. With the tab strip, the two
     views are siblings: Save closes the SETTINGS view, and the
     Advanced view follows as its own container. */
  ok(iSave > 0 && pref.indexOf('id="pf_view_advanced"') > iSave, 'v107 prefs order: Save preferences closes the Settings view; the Advanced view is its own sibling container');
  ok(pref.indexOf('securityCard') === -1, 'v106 prefs: no Security card is built or appended anymore');
  ok(pref.indexOf('type="password"') === -1, 'v106 prefs: NO password input anywhere in Preferences');
  ok(pref.indexOf('id="pf_pw_btn"') === -1 && pref.indexOf('id="pf_pw_cur"') === -1 && pref.indexOf('id="pf_pw_new"') === -1 && pref.indexOf('id="pf_pw_conf"') === -1, 'v106 prefs: no change-password fields remain');
  ok(pref.indexOf('btn primary big') >= 0 && pref.indexOf('id="pf_save"') > pref.indexOf('btn primary big') - 60, 'prefs: Save is the solid primary (big) button');
  ok(pref.indexOf('id="pf_syncnow"') > 0 && /btn ghost" id="pf_syncnow"/.test(pref), 'prefs: Retry sync uses quiet secondary (ghost) styling');
  /* v94 (owner ruling, Oct 16, 2026 — keys move server-side; the
     owner screenshotted the nag in disgust): NO key UI anywhere in
     Preferences, and the Advanced explainers are trimmed to short
     plain lines. The pre-v94 pins this replaces lived in the
     power-read suites (the v80 key-state paint); the card's copy
     now states the server shape and the switch alone remains. */
  ok(pref.indexOf('pf_pr_key') === -1, 'v94 prefs: NO key input rendered anywhere in Preferences');
  ok(!/Paste your key|Google AI Studio|Get API key|key not set/i.test(pref), 'v94 prefs: no key-instruction strings in Preferences');
  /* v137 SUPERSEDES the v94/v107 "the switch/field survives" pins
     below (owner, Oct 17 12:25 MDT: "Power read and navigator
     Server are plumbing! Don't need to be there!"): BOTH controls
     are removed from the Preferences face entirely. The Power
     Read machinery is untouched (defaults on, capture flows
     unchanged); the routing address is a baked-in constant in
     the Navigator module. What survives is the ABSENCE. */
  eq((pref.match(/id="pf_pr_on"/g) || []).length, 0, 'v137 prefs: the Power read toggle is GONE from the face (owner order, Oct 17)');
  ok(pref.indexOf('A second, cloud look at photos') === -1 && pref.indexOf('Nothing to set up') === -1, 'v137 prefs: the Power read card copy is gone with the card');
  ok(pref.indexOf('Honest limit: an ask can only appear') === -1, 'v94 prefs: park-place "honest limit" essay is gone');
  ok(pref.indexOf('or set it now while you are parked there') === -1, 'v94 prefs: park-place explainer trimmed (old essay wording absent)');
  ok(pref.indexOf('The Navigator routes trucks on Calgary') === -1, 'v94 prefs: Navigator server explainer trimmed (old essay wording absent)');
  ok(pref.indexOf('>Server address</label>') === -1, 'v137 prefs: NO server address field anywhere (owner order, Oct 17)');
  ok(pref.indexOf('No server set — the Navigator will say routing is unavailable.') === -1, 'v137 prefs: the no-server note is gone with the card');
  ok(pref.indexOf('Free key:') === -1 && pref.indexOf('Key saved on this device') === -1, 'v94 prefs: no key-state paint remains in the Power read note');

  /* v95 (owner, Oct 16, 2026): TWO rulings from his screenshots.
     (1) THE SIGN-IN DOOR: a Local-mode user had no reachable sign-in
     (the only route was Advanced → Reset onboarding questions, whose
     confirm() automation auto-cancels). Preferences carried ONE
     primary "Sign in" at the top of the Security card in the
     signed-out render — in the open, never inside Advanced.
     v106 SUPERSEDES the door's ADDRESS, not the ruling: the door
     moved WITH the Security card to the Account & login screen
     (modules/account.js), where it still sits at the top of the
     card, primary-styled, wired to App.goSignIn — pinned in
     tools/account-login-test.js. Preferences keeps NO door.
     (2) ADVANCED: v95 made it a drawer behind one toggle; v107
     (owner, Oct 16 19:39-19:43) SUPERSEDES the drawer: "advanced
     should open in a different window of its own... move advanced
     as a smaller tab on the top of the entire preferences tab" —
     a [Settings | Advanced] tab strip at the TOP swaps two views;
     Advanced holds plumbing only, slimmed: the background-tracking
     block, the power-read counter prose, the standing sync
     readout, and the park-place block are GONE from Preferences
     (park-place re-homed to the dashboard — park-place-test).
     v116 (owner, Oct 16 21:38) SUPERSEDES the park half again:
     the dashboard card was overruled ("It's supposed to ask in
     the preferences") and "Where I park" is back as a Settings-
     view card under NEW ids (pf_park_note / pf_park_set /
     pf_park_nn / pf_park_forget — pinned in park-place-test);
     the retired Advanced-era ids in the absence list below stay
     retired, and the card is NOT Advanced plumbing. */
  ok(pref.indexOf('id="pf_signin"') === -1, 'v106 prefs: the Sign in door moved to Account & login (no door left in Preferences)');
  ok(pref.indexOf('Sign in to change your password.') === -1, 'v95 prefs: the old dead-end note (a sign-in with no door) is gone');
  eq((pref.match(/id="pf_tab_settings"/g) || []).length, 1, 'v107 prefs: exactly one Settings tab');
  eq((pref.match(/id="pf_tab_advanced"/g) || []).length, 1, 'v107 prefs: exactly one Advanced tab');
  ok(pref.indexOf('id="pf_adv_toggle"') === -1 && pref.indexOf('id="pf_adv_body"') === -1, 'v107 prefs: the drawer is gone (no toggle, no expanding body)');
  ok(/id="pf_view_advanced" class="hidden"/.test(pref), 'v107 prefs: the Advanced view renders hidden (Settings is the opening view)');
  ok(pref.indexOf('id="pf_tab_advanced"') < pref.indexOf('id="pf_acct"'), 'v107 prefs: the tab strip sits at the TOP, above the first settings card');
  const iAdvView = pref.indexOf('id="pf_view_advanced"');
  ['pf_checkupd', 'pf_push', 'pf_syncnow', 'pf_resetonb'].forEach(function (id) {
    eq((pref.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, 'v107 prefs: Advanced control #' + id + ' survives exactly once');
    ok(pref.indexOf('id="' + id + '"') > iAdvView, 'v107 prefs: #' + id + ' renders INSIDE the Advanced view');
  });
  /* v137: pf_pr_on + pf_nav_url moved from the survives list to
     the ABSENT list (owner order, Oct 17 — see the v137 note in
     the v94 block above). */
  ['pf_bgtrack', 'pf_bgallow', 'pf_bgbatt', 'pf_pr_note', 'pf_parknote', 'pf_parkset', 'pf_parkforget', 'pf_pr_on', 'pf_nav_url', 'pf_nav_note'].forEach(function (id) {
    eq(pref.indexOf('id="' + id + '"'), -1, 'v107/v137 prefs: removed skeleton/feature element #' + id + ' is absent from Preferences');
  });
  ok(pref.indexOf('id="pf_save"') > pref.indexOf('id="pf_view_settings"') && pref.indexOf('id="pf_save"') < iAdvView, 'v107 prefs: Save preferences lives in the Settings view');
  ok(pref.indexOf('🔒 Security') === -1, 'v106 prefs: no Security heading anywhere on the page (it lives on Account & login)');
  ok(pref.indexOf("querySelector('#pf_tab_advanced')") >= 0 && pref.indexOf('function showTab(adv)') >= 0, 'v107 prefs: the tabs are wired (showTab swaps the two views)');
  ok(pref.indexOf("confirm('Show the setup questions again") >= 0, 'v95 prefs: Reset onboarding keeps its own confirm + purpose, unchanged');
}

/* ================= 5. The sign-in door (js/app.js + index.html) ================= */
{
  const idx = read('index.html');
  eq((idx.match(/id="sbSignIn"/g) || []).length, 1, 'v95 door: exactly one drawer Sign in button in index.html');
  ok(/class="btn primary hidden" id="sbSignIn"/.test(idx), 'v95 door: primary-styled and hidden until App.onAuth paints it');
  ok(idx.indexOf('id="sbSignIn"') > idx.indexOf('id="sidebar"') && idx.indexOf('id="sbSignIn"') < idx.indexOf('id="sbNav"'), 'v95 door: sits in the drawer account block, above the nav');
  ok(appSrc.indexOf('App.goSignIn = function') >= 0, 'v95 door: App.goSignIn exists');
  const gStart = appSrc.indexOf('App.goSignIn = function');
  const gBody = appSrc.slice(gStart, appSrc.indexOf('};', gStart) + 2);
  ok(gBody.indexOf("showAuthForm('signin')") >= 0 && gBody.indexOf("App.showView('auth')") >= 0, 'v95 door: goSignIn routes straight to the sign-in form');
  ok(gBody.indexOf('App.showDashboard()') >= 0, 'v95 door: goSignIn first returns #main to the dashboard (no stale module render after sign-in)');
  ok(!/store\.|onboarded|localStorage/.test(gBody), 'v95 door: goSignIn touches NO store, NO onboarding flag, NO local data');
  const oaStart = appSrc.indexOf('App.onAuth = function');
  const oaBody = appSrc.slice(oaStart, oaStart + 1400);
  ok(oaBody.indexOf('sbSignIn') >= 0 && oaBody.indexOf("classList.toggle('hidden', !!user)") >= 0, 'v95 door: App.onAuth paints the door iff there is no signed-in user');
  ok(appSrc.indexOf("el('sbSignIn')") >= 0 && appSrc.indexOf('closeSidebar(); if (App.goSignIn) App.goSignIn();') >= 0, 'v95 door: the drawer button is wired (close drawer → goSignIn)');
  ok(appSrc.indexOf("el('authSkip').onclick = enterLocalMode") >= 0 && idx.indexOf('id="authSkip"') >= 0, 'v95 door: the form keeps its "Continue without an account" way back to the Local dashboard');
}

console.log('\nrole-package-test: ' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
