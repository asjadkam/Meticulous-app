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
 * sync in Advanced, Security last card, one bottom Save, role control
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

  const ALL = ['revenue', 'dispatch', 'navigation', 'fuel', 'pnl', 'maintenance', 'damage', 'manifest', 'invoice', 'connect'];
  deepEq(sb.roleModuleOrder('both'), ALL, 'dashboard: both = the pre-v52 order, unchanged');
  /* v76 (F4): superseded Oct 14, 2026 by the owner's Connect Phase-2
     blueprint — the office home leads with the boss's five tools,
     Connect FIRST, then Dispatch, Invoice, Maintenance, P&L. */
  deepEq(sb.roleModuleOrder('office').slice(0, 5), ['connect', 'dispatch', 'invoice', 'maintenance', 'pnl'], 'dashboard: office leads with the boss five, connect first');
  eq(sb.roleModuleOrder('driver')[0], 'revenue', 'dashboard: driver leads with revenue (tracker feeds it)');
  ['driver', 'both', 'office'].forEach(function (r) {
    const ord = sb.roleModuleOrder(r);
    eq(ord.length, 10, 'dashboard ' + r + ': all 10 modules present (nothing removed)');
    deepEq(ord.slice().sort(), ALL.slice().sort(), 'dashboard ' + r + ': same module set, reordered only');
  });

  const KEYS = ['dashboard', 'revenue', 'dispatch', 'navigation', 'fuel', 'pnl', 'maintenance', 'damage', 'manifest', 'invoice', 'connect', 'reminders', 'preferences', 'subscription', 'feedback', 'logout'];
  const items = KEYS.map(function (k) { return [k, '', k]; });
  const off = sb.roleSidebarOrder('office', items).map(function (i) { return i[0]; });
  /* v76 (F4): sidebar lead follows the same blueprint order. */
  deepEq(off.slice(0, 6), ['dashboard', 'connect', 'dispatch', 'invoice', 'maintenance', 'pnl'], 'sidebar: office leads with the boss five, connect first');
  eq(off.length, 16, 'sidebar: office keeps every item');
  const drv = sb.roleSidebarOrder('driver', items).map(function (i) { return i[0]; });
  deepEq(drv.slice(0, 3), ['dashboard', 'revenue', 'dispatch'], 'sidebar: driver leads with revenue/dispatch');
  eq(drv.length, 16, 'sidebar: driver keeps every item');
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
  ['driver', 'both'].forEach(function (r) {
    const p = plan(Object.assign({}, octBase, { role: r }));
    deepEq(sharedFields(p.entry), want, 'completion ' + r + ': entry identical to pre-v52 (dry-run parity)');
    eq(p.entry.amount, '333.50', 'completion ' + r + ': $333.50 — October math unchanged to the cent');
    eq(p.entry.foremanHours, 10.5, 'completion ' + r + ': foremanHours split field stored');
    eq(p.entry.travelHours, 1, 'completion ' + r + ': travelHours split field stored');
    eq(p.entry.travelInIncome, true, 'completion ' + r + ': travelInIncome=true');
    eq(p.claim, null, 'completion ' + r + ': no wage claim (the driver keeps his bonus)');
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
  ok(p.claim && p.claim.driverId === 'd1', 'completion office+driver: claim routed to the matched driver');
  eq(p.claim.hours, 1, 'completion office+driver: claim hours = travel bonus');
  eq(p.claim.wage, 27, 'completion office+driver: claim wage at the DRIVER\u2019s rate (1h × $27)');
  eq(p.claim.source, 'dispatch', 'completion office+driver: claim source tagged');
  eq(p.heldOut, 1, 'completion office+driver: heldOut reported');
  eq(p.disclosure, 'Travel 1.0h not added to income — sent to Umar\u2019s wages in P&L.', 'completion office+driver: disclosure names the driver');
}
{
  const p = plan(Object.assign({}, octBase, { role: 'office', driver: null }));
  eq(p.claim, null, 'completion office, no driver: no claim');
  eq(p.entry.amount, '304.50', 'completion office, no driver: travel still excluded from income');
  eq(p.disclosure, 'Travel 1.0h not added to income — assign the driver in P&L to pay it.', 'completion office, no driver: disclosure says where to pay it');
}
{
  const zeroSum = Object.assign({}, octSum, { travelBonus: 0, totalPaidHours: 10.5 });
  const p = plan(Object.assign({}, octBase, { sum: zeroSum, role: 'office', travelBonusRaw: 0 }));
  eq(p.disclosure, '', 'completion office, zero travel bonus: no disclosure, nothing to hold out');
  eq(p.entry.amount, '304.50', 'completion office, zero travel bonus: entry = foreman math');
}
{
  const wSum = { ticketCount: 2, totalForemanHours: 0, travelBonus: 1, totalPaidHours: 1, totalNetWeight: 24.5, breakdown: [] };
  const want = sharedFields(preV52Entry(wSum, 'weight', 12, 1, 'Pit 9', '2026-10-14', 2));
  ['driver', 'office'].forEach(function (r) {
    const p = plan({ sum: wSum, std: 'weight', rate: 12, role: r, date: '2026-10-14', jobSite: 'Pit 9', ticketCount: 2, travelBonusRaw: 1, driver: { id: 'd1', name: 'Umar', rate: 27 }, legacyAmount: '', legacyNetWeight: '', loads: '2', ticketNo: '' });
    deepEq(sharedFields(p.entry), want, 'completion weight ' + r + ': tonnes entry identical to pre-v52, bonus cannot enter');
    eq(p.claim, null, 'completion weight ' + r + ': no travel claim on weight work');
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
  const iSec = pref.indexOf('h += securityCard'); // append site = render order (the card string is built earlier)
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
  ok(iSec > iSyncRow, 'prefs order: … Advanced (incl. sync troubleshooting) … then Security');
  ok(iSave > iSec, 'prefs order: Security is the LAST card, Save preferences the final button beneath it');
  ok(pref.indexOf('btn primary big') >= 0 && pref.indexOf('id="pf_save"') > pref.indexOf('btn primary big') - 60, 'prefs: Save is the solid primary (big) button');
  ok(pref.indexOf('id="pf_syncnow"') > 0 && /btn ghost" id="pf_syncnow"/.test(pref), 'prefs: Retry sync uses quiet secondary (ghost) styling');
  ok(/btn ghost" id="pf_pw_btn"/.test(pref), 'prefs: Change password button de-crowded to ghost');
}

console.log('\nrole-package-test: ' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
