#!/usr/bin/env node
/* Meticulous — PAY-CARD-ROLE + PREFS-ROLE-SPLIT + PNL-REVENUE-RATE
 * + AUTOSTART-DRIVER-ONLY (owner rulings, Oct 21, 2026, over his
 * own screens, 15:29–15:34 MDT):
 *
 *  (1) 15:29, Preferences → Pay showing BOTH a global "Client
 *      billing rate" and a "Driver wage rate": "I thought I told
 *      you we don't have driver pay/owner pay... Owner revenue is
 *      based on the job!?" The law (Oct 18 + Oct 21): no
 *      driver-pay/owner-pay split — each driver sets his OWN
 *      wage (it travels via Connect and posts as his cost on the
 *      boss's books); owner revenue prices at the JOB (rates on
 *      the job/customer record; a customer's last rate is the
 *      default for their next job). The Pay card keeps only the
 *      user's own pay facts: payment standard, travel bonus, MY
 *      wage. The global billing field is OFF every face.
 *      MIGRATION: the stored global billingRate is NOT deleted
 *      and NOT written anymore — it survives as the fallback
 *      default wherever a job has no rate of its own, so every
 *      existing user's numbers price exactly as before.
 *  (2) 15:30, the Dave Cooper OFFICE account's Preferences
 *      rendered the full Truck card: "This suppose to be only a
 *      driver setting." The whole Truck card renders only for
 *      users who drive (driver + both) — the same drives-answer
 *      that gates the tracker and PTI. An office Save must not
 *      reach for its missing inputs, and stored truck facts
 *      survive untouched.
 *  (3) 15:33, P&L Monthly analysis: "This revenue is not 93 x
 *      by my hours." His October showed revenue $4,843.00 over
 *      167.0h — 167 × $29, his WAGE — where the client rate
 *      gives 167 × $93 = $15,531.00. Salaries $4,843.00 (× $29)
 *      were correct. The law: on every owner-side book the
 *      revenue leg prices hours at the JOB/CLIENT rate (job
 *      record first, migrated global fallback second), for own
 *      days AND crew days; a wage value never reaches a revenue
 *      multiplication. Acceptance fixture = his real October
 *      numbers: 167.0h, client 93, wage 29 → revenue $15,531.00,
 *      salaries $4,843.00, the legs provably reading different
 *      rate sources.
 *  (4) 15:34, Revenue's "⏰ Auto-start ▾" button: "Auto start
 *      is an option for the driver." The button and its settings
 *      card render ONLY for driver + both; office-only never
 *      sees them. Placement unchanged (v201) — role gating only.
 *
 * Worlds run the REAL modules/preferences.js, modules/pnl.js
 * (+ the invoice.js INV-CYCLE region that publishes the shared
 * revenue builder), js/connectpipe.js (pricingFor/priceDispatch
 * are pure over the store) and modules/revenue.js (+ the app.js
 * shared revenue core + modules/autostart.js) over fake DOMs.
 * Run: node tools/pay-card-role-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function has(name, hay, needle) { check(name, String(hay).indexOf(needle) >= 0); }
function hasnt(name, hay, needle) { check(name, String(hay).indexOf(needle) < 0); }
const clone = (v) => JSON.parse(JSON.stringify(v));
const round2 = (n) => Math.round((+n || 0) * 100) / 100;

function memStore(seed) {
  const data = clone(seed || {});
  return {
    get: function (k, d) { return (k in data) ? clone(data[k]) : d; },
    set: function (k, v) { data[k] = clone(v); },
    del: function (k) { delete data[k]; },
    _data: data
  };
}
function extractRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('region not found: ' + beginMark);
  return src.slice(a, b + 2);
}

/* ============ fake DOM for Preferences (rendered-id aware,
   the v137 contract: querySelector finds only rendered ids) ============ */
function FakeEl(sel) {
  this._sel = sel || '';
  this.value = '';
  this.textContent = '';
  this.checked = false;
  this.disabled = false;
  this.style = {};
  this.files = [];
  this.onclick = null;
  this.onchange = null;
  this._listeners = {};
  const classes = new Set();
  this.classList = {
    add: function (c) { classes.add(c); },
    remove: function (c) { classes.delete(c); },
    contains: function (c) { return classes.has(c); },
    toggle: function (c, force) {
      const on = force === undefined ? !classes.has(c) : !!force;
      if (on) classes.add(c); else classes.delete(c);
      return on;
    }
  };
}
FakeEl.prototype.addEventListener = function (type, fn) {
  (this._listeners[type] = this._listeners[type] || []).push(fn);
};
FakeEl.prototype.click = function () { if (this.onclick) this.onclick({ target: this }); };
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };
FakeEl.prototype.querySelector = function () { return null; };
FakeEl.prototype.querySelectorAll = function () { return []; };

function makeBody() {
  const body = new FakeEl('body');
  let registry = {};
  let html = '';
  Object.defineProperty(body, 'innerHTML', {
    get: function () { return html; },
    set: function (v) {
      html = String(v);
      registry = {};
      const tagRe = /<(input|select|textarea|button)\b[^>]*\bid="([^"]+)"[^>]*>/g;
      let m;
      const spans = [];
      while ((m = tagRe.exec(html))) spans.push({ tag: m[1], id: m[2], full: m[0], at: m.index });
      const selRe = /<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g;
      const selVals = {};
      while ((m = selRe.exec(html))) {
        const opts = [];
        const oRe = /<option([^>]*)>([^<]*)<\/option>/g;
        let om;
        while ((om = oRe.exec(m[2]))) opts.push({ sel: /selected/.test(om[1]), text: om[2] });
        const chosen = opts.filter(function (o) { return o.sel; })[0] || opts[0];
        selVals[m[1]] = chosen ? chosen.text : '';
      }
      spans.forEach(function (s) {
        const el = new FakeEl('#' + s.id);
        const vm2 = /\bvalue="([^"]*)"/.exec(s.full);
        if (s.tag === 'select') el.value = selVals[s.id] || '';
        else if (vm2) el.value = vm2[1];
        if (/\bchecked\b/.test(s.full)) el.checked = true;
        registry['#' + s.id] = el;
      });
    }
  });
  body.querySelector = function (sel) { return registry[sel] || null; };
  body.querySelectorAll = function () { return []; };
  return body;
}

const prefSrc = read('modules/preferences.js');
function prefsWorld(onboarding, role) {
  const store = memStore({ onboarding: onboarding });
  const App = {
    _store: store,
    _esc: function (s) { return String(s == null ? '' : s); },
    _masterOdometer: function () { return null; },
    userRole: function () { return role; },
    user: null,
    onAuth: function () {},
    goSignIn: function () {},
    toast: function () {}
  };
  const sb = { window: {}, Meticulous: { modules: {} }, App, console, alert: function () {}, confirm: function () { return true; } };
  sb.window.App = App;
  vm.createContext(sb);
  vm.runInContext(prefSrc, sb);
  return { sb, store };
}
function renderPrefs(w) {
  const body = makeBody();
  w.sb.Meticulous.modules.preferences.render(body);
  return body;
}

/* ================= (a) the Pay card, per face ================= */
console.log('(a) PAY-CARD-ROLE — the Pay card carries only the user\u2019s own pay facts');
{
  const w = prefsWorld({ accountType: 'Owner-Operator', userRole: 'driver', payStandard: 'Hourly', payRate: '29', billingRate: '93', ownWageRate: '29', travelBonus: '1' }, 'driver');
  const html = renderPrefs(w).innerHTML;
  hasnt('a OO: NO client billing field', html, 'id="pf_billrate"');
  hasnt('a OO: no billing label text anywhere', html, 'Client billing rate');
  has('a OO: MY wage field renders', html, 'id="pf_wagerate"');
  has('a OO: the wage label is his OWN wage', html, 'Your wage rate ($/hour)</label>');
  has('a OO: payment standard remains', html, 'id="pf_std"');
  has('a OO: travel bonus remains', html, 'id="pf_travel"');
}
{
  const w = prefsWorld({ accountType: 'Driver', userRole: 'driver', payStandard: 'Hourly', payRate: '29', billingRate: '', ownWageRate: '' }, 'driver');
  const html = renderPrefs(w).innerHTML;
  hasnt('a driver: NO client billing field', html, 'id="pf_billrate"');
  has('a driver: his pay rate field renders', html, 'id="pf_wagerate"');
  has('a driver: the label is "Your pay rate"', html, 'Your pay rate ($/hour)</label>');
  has('a driver: payment standard remains', html, 'id="pf_std"');
  has('a driver: travel bonus remains', html, 'id="pf_travel"');
}
{
  const w = prefsWorld({ accountType: 'Owner-Operator', userRole: 'office', payStandard: 'Hourly', payRate: '40', billingRate: '93' }, 'office');
  const html = renderPrefs(w).innerHTML;
  hasnt('a office: NO client billing field', html, 'id="pf_billrate"');
  hasnt('a office: NO wage field (no personal wage on an office face)', html, 'id="pf_wagerate"');
  has('a office: payment standard remains', html, 'id="pf_std"');
  has('a office: travel bonus remains', html, 'id="pf_travel"');
}
{
  const w = prefsWorld({ accountType: 'Fleet Manager', userRole: 'office', payStandard: 'Hourly', payRate: '40', billingRate: '93' }, 'office');
  const html = renderPrefs(w).innerHTML;
  hasnt('a FM: NO client billing field', html, 'id="pf_billrate"');
  hasnt('a FM: NO wage field', html, 'id="pf_wagerate"');
  has('a FM: payment standard remains', html, 'id="pf_std"');
  has('a FM: travel bonus remains', html, 'id="pf_travel"');
}

/* ================= (a2) PREFS-ROLE-SPLIT — the Truck card ================= */
console.log('(a2) PREFS-ROLE-SPLIT — Truck settings are a driver setting');
{
  const w = prefsWorld({ accountType: 'Owner-Operator', userRole: 'office', payStandard: 'Hourly', truckNo: '07', safetyExpiry: '2027-05-31', billingRate: '93' }, 'office');
  const body = renderPrefs(w);
  const html = body.innerHTML;
  hasnt('a2 office: NO Truck card at all', html, '🚛 Truck');
  hasnt('a2 office: no truck number field', html, 'id="pf_tnum"');
  hasnt('a2 office: no load/trailer type field', html, 'id="pf_ttype"');
  hasnt('a2 office: no odometer field', html, 'id="pf_odo"');
  hasnt('a2 office: no safety sticker field', html, 'id="pf_safety"');
  hasnt('a2 office: no fuel-economy select', html, 'id="pf_econ"');
  hasnt('a2 office: no daily-odometer-photos toggle', html, 'id="pf_odo_photos"');
  hasnt('a2 office: no odometer photo buttons', html, 'id="pf_odo_cam"');
  /* business/office facts are NOT driver settings — they stay */
  has('a2 office: invoice number stays (business fact)', html, 'id="pf_nextinv"');
  has('a2 office: tax-includes-rate stays (business fact)', html, 'id="pf_taxincl"');
  /* and a Save on this face completes, touching nothing stored */
  let threw = null;
  try { body.querySelector('#pf_save').click(); } catch (e) { threw = e; }
  eq('a2 office: Save completes with no Truck card rendered', threw, null);
  const saved = w.store.get('onboarding', {});
  eq('a2 office: stored truck number survives the Save', saved.truckNo, '07');
  eq('a2 office: stored safety expiry survives the Save', saved.safetyExpiry, '2027-05-31');
  eq('a2 (c): stored company billing rate survives the Save — fallback data, not deleted', saved.billingRate, '93');
}
{
  const w = prefsWorld({ accountType: 'Driver', userRole: 'driver', payStandard: 'Hourly', payRate: '29' }, 'driver');
  const html = renderPrefs(w).innerHTML;
  has('a2 driver: the Truck card renders in full', html, '🚛 Truck');
  has('a2 driver: truck number field', html, 'id="pf_tnum"');
  has('a2 driver: odometer field', html, 'id="pf_odo"');
  has('a2 driver: safety sticker field', html, 'id="pf_safety"');
  has('a2 driver: daily-odometer-photos toggle', html, 'id="pf_odo_photos"');
}
{
  const w = prefsWorld({ accountType: 'Owner-Operator', userRole: 'both', payStandard: 'Hourly', payRate: '29' }, 'both');
  const html = renderPrefs(w).innerHTML;
  has('a2 both: the Truck card renders (he drives)', html, '🚛 Truck');
  has('a2 both: truck number field', html, 'id="pf_tnum"');
}

/* ================= (b) PNL-REVENUE-RATE — the October fixture ================= */
const invSrc = read('modules/invoice.js');
const pnlSrc = read('modules/pnl.js');
function makePnl(seed) {
  const store = memStore(seed);
  const sb = {
    window: {}, Meticulous: { modules: {} }, console: console,
    App: {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s); },
      _today: function () { return '2026-10-21'; }
    }
  };
  vm.createContext(sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(pnlSrc, sb);
  return { pnl: sb.Meticulous.modules.pnl, store: store };
}
/* His October shape: days whose stored (paid) amounts are the
   wage leg — foreman + travel hours x $29 — totalling exactly
   167.0h / $4,843.00, the numbers on his screenshot. */
function octoberEntries(wage) {
  const days = ['01', '02', '03', '05', '06', '07', '08', '09', '10', '12', '13', '14', '15', '16'];
  const out = days.map(function (d) {
    return { date: '2026-10-' + d, type: 'hourly', hours: 11, amount: String(11 * wage),
      note: 'Dispatch: Aecon Inf · foreman 10h + travel 1h = 11h', loads: 0 };
  });
  out.push({ date: '2026-10-19', type: 'hourly', hours: 13, amount: String(13 * wage),
    note: 'Dispatch: Aecon Inf · foreman 12h + travel 1h = 13h', loads: 0 });
  return out; /* 14 x 11h + 13h = 167.0h */
}
function pnlSeed(extra) {
  return Object.assign({
    rev_entries: octoberEntries(29), rev_extras: [], fuel_fills: [], fuel_expenses: [],
    pnl_drivers: [], pnl_wage_entries: [], pnl_travel_claims: [], pnl_card_wages: [], pnl_expenses: []
  }, extra || {});
}
console.log('(b) PNL-REVENUE-RATE — revenue prices at the client rate, salaries at the wage');
{
  const w = makePnl(pnlSeed({
    onboarding: { payStandard: 'Hourly', payRate: '29', ownWageRate: '29', billingRate: '93' }
  }));
  const c = w.pnl._calc('2026-10');
  eq('b ACCEPTANCE: revenue = 167.0h x $93 = $15,531.00', round2(c.income), 15531.00);
  eq('b ACCEPTANCE: salaries = 167.0h x $29 = $4,843.00 (unchanged)', round2(c.wagesTotal), 4843.00);
  eq('b: the by-type breakdown follows the repriced income', round2(c.incomeByType.hourly), 15531.00);
}
{
  /* A job rate on the day's dispatch record wins over the
     company fallback — the Oct 5 day prices at $100, the rest
     at $93: 15531 - 11x93 + 11x100 = $15,608.00. */
  const w = makePnl(pnlSeed({
    onboarding: { payStandard: 'Hourly', payRate: '29', ownWageRate: '29', billingRate: '93' },
    dsp_list: [{ id: 'dsp-j1', date: '2026-10-05', scheduledAt: '2026-10-05T08:00:00', jobRate: '100', status: 'completed' }],
    dsp_active: null
  }));
  const c = w.pnl._calc('2026-10');
  eq('b job rate: the job\u2019s own rate prices its day ($15,608.00)', round2(c.income), 15608.00);
  eq('b job rate: salaries still read the wage leg ($4,843.00)', round2(c.wagesTotal), 4843.00);
}
{
  /* No client rate anywhere: the book is byte-identical to the
     pre-change behavior — revenue keeps the builder's amounts. */
  const w = makePnl(pnlSeed({
    onboarding: { payStandard: 'Hourly', payRate: '29', ownWageRate: '29', billingRate: '' }
  }));
  const c = w.pnl._calc('2026-10');
  eq('b parity: no client rate on file -> revenue stays $4,843.00 (nothing repriced, nothing invented)', round2(c.income), 4843.00);
  eq('b parity: salaries $4,843.00', round2(c.wagesTotal), 4843.00);
}
{
  /* The legs provably read DIFFERENT rate sources: moving the
     client rate moves revenue only; moving the wage (and the
     wage-priced day amounts with it) moves salaries only. */
  const w1 = makePnl(pnlSeed({
    onboarding: { payStandard: 'Hourly', payRate: '29', ownWageRate: '29', billingRate: '50' }
  }));
  const c1 = w1.pnl._calc('2026-10');
  eq('b sources: client rate 93 -> 50 moves revenue to 167 x $50 = $8,350.00', round2(c1.income), 8350.00);
  eq('b sources: ...and salaries do not move ($4,843.00)', round2(c1.wagesTotal), 4843.00);
  const w2 = makePnl(pnlSeed({
    onboarding: { payStandard: 'Hourly', payRate: '30', ownWageRate: '30', billingRate: '93' },
    rev_entries: octoberEntries(30)
  }));
  const c2 = w2.pnl._calc('2026-10');
  eq('b sources: wage 29 -> 30 moves salaries to 167 x $30 = $5,010.00', round2(c2.wagesTotal), 5010.00);
  eq('b sources: ...and revenue does not move ($15,531.00)', round2(c2.income), 15531.00);
}

/* ================= (b2) crew days — the pipe pricer ================= */
const cpSrc = read('js/connectpipe.js');
function pipeWorld(onboarding, drivers) {
  const store = memStore({ onboarding: onboarding, pnl_drivers: drivers || [] });
  const App = { _store: store };
  const sb = { window: {}, App: App, console: console, setTimeout: setTimeout, clearTimeout: clearTimeout };
  sb.window.App = App;
  vm.createContext(sb);
  vm.runInContext(cpSrc, sb);
  return { CP: sb.window.ConnectPipe, store: store };
}
console.log('(b2) crew revenue — pricingFor reads the stored company rate ALONE');
{
  const w = pipeWorld(
    { billingRate: '93', ownWageRate: '29', payRate: '29' },
    [{ id: 'd1', uid: 'uid-d', name: 'Crew Driver', rate: '29', payType: 'hourly' }]);
  const pricing = w.CP.pricingFor('uid-d');
  eq('b2: clientRate is the stored company rate $93', pricing.clientRate, 93);
  const priced = w.CP.priceDispatch(
    { id: 'dsp-c1', status: 'completed', foremanHours: 10, travelHours: 1, travelBillable: false }, pricing);
  eq('b2: crew revenue = 10 foreman h x $93 = $930.00 (travel not billed)', priced.revenue, 930);
  eq('b2: crew wages = (10 + 1 travel) x the driver\u2019s $29 = $319.00', priced.wage, 319);
}
{
  /* The wage-fallback trap the owner caught: with NO company
     rate on file, the old chain priced crew revenue at the
     driver's wage. Now revenue is honestly unpriced instead. */
  const w = pipeWorld(
    { billingRate: '', ownWageRate: '29', payRate: '29' },
    [{ id: 'd1', uid: 'uid-d', name: 'Crew Driver', rate: '29', payType: 'hourly' }]);
  const pricing = w.CP.pricingFor('uid-d');
  eq('b2: no company rate -> clientRate 0 (the wage NEVER prices revenue)', pricing.clientRate, 0);
  const priced = w.CP.priceDispatch(
    { id: 'dsp-c1', status: 'completed', foremanHours: 10, travelHours: 1, travelBillable: false }, pricing);
  eq('b2: crew revenue honestly unpriced (null), wages still priced', [priced.revenue, priced.wage], [null, 319]);
}

/* ================= (d) AUTOSTART-DRIVER-ONLY — the Revenue gate ================= */
const appSrc = read('js/app.js');
const revSrc = read('modules/revenue.js');
const asSrc = read('modules/autostart.js');
function StubEl() {
  this.innerHTML = ''; this.style = {}; this.value = '';
  this.onclick = null; this.onchange = null; this.oninput = null;
  this._attrs = {}; this.offsetWidth = 360;
}
StubEl.prototype.getAttribute = function (k) { return this._attrs[k] || ''; };
StubEl.prototype.setAttribute = function (k, v) { this._attrs[k] = v; };
StubEl.prototype.querySelector = function () { return new StubEl(); };
StubEl.prototype.querySelectorAll = function () { return []; };
StubEl.prototype.getBoundingClientRect = function () { return { width: 360, left: 0 }; };
StubEl.prototype.getContext = function () {
  return { fillStyle: '', font: '', clearRect: function () {}, fillRect: function () {},
    fillText: function () {}, save: function () {}, restore: function () {},
    translate: function () {}, rotate: function () {} };
};
function RevBody() {
  this.innerHTML = '';
  this._one = {};
  this._many = {};
}
RevBody.prototype.querySelector = function (sel) {
  if (sel === '#revChart') return null;
  return this._one[sel] || (this._one[sel] = new StubEl());
};
RevBody.prototype.querySelectorAll = function (sel) { return this._many[sel] || []; };
function revWorld(role) {
  const store = memStore({
    onboarding: { accountType: role === 'office' ? 'Owner-Operator' : 'Driver', userRole: role, payStandard: 'Hourly', payRate: '29' },
    rev_entries: [], rev_extras: []
  });
  const sb = { console: console, setTimeout: setTimeout, Promise: Promise, alert: function () {} };
  sb.window = sb;
  sb.Meticulous = { modules: {} };
  sb.App = {
    _store: store,
    _esc: (s) => String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    _today: () => '2026-10-21',
    userRole: () => role,
    tracker: null
  };
  vm.createContext(sb);
  vm.runInContext(extractRegion(appSrc, 'SHARED REVENUE CORE (v105)', 'end SHARED REVENUE CORE'), sb);
  vm.runInContext(asSrc, sb);
  vm.runInContext(revSrc, sb);
  return { sb: sb, store: store, rev: sb.Meticulous.modules.revenue };
}
console.log('(d) AUTOSTART-DRIVER-ONLY — the Revenue Auto-start option is a driver\u2019s');
{
  const w = revWorld('office');
  const body = new RevBody();
  w.rev.render(body);
  hasnt('d office: NO Auto-start button on Revenue', body.innerHTML, 'id="rv_as_btn"');
  hasnt('d office: no Auto-start copy at all', body.innerHTML, '⏰ Auto-start');
  hasnt('d office: no auto-start settings card', body.innerHTML, 'id="rv_as_settings"');
}
{
  const w = revWorld('driver');
  const body = new RevBody();
  w.rev.render(body);
  has('d driver: the Auto-start button renders (v201 placement, unchanged)', body.innerHTML, 'id="rv_as_btn"');
  has('d driver: the Auto-start label renders', body.innerHTML, '⏰ Auto-start');
}
{
  const w = revWorld('both');
  const body = new RevBody();
  w.rev.render(body);
  has('d both: the Auto-start button renders (he drives)', body.innerHTML, 'id="rv_as_btn"');
}

console.log('\npay-card-role: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
