#!/usr/bin/env node
/* Meticulous v243 — OWN-WAGE-AS-CONNECTED-DRIVER (owner, Fri
 * Oct 23, 2026 21:24 MDT, his REAL account): Preferences showed
 * a "Drivers' wages — set by each driver" card listing
 * "Connected driver $29.00/hour" — HIS OWN wage arriving back
 * as if he were a driver connected to himself. His words:
 * "I am the driver... Why is it saying that my drivers pay
 * rate is 29?"
 *
 * The chain: CP.fetchRecords() enumerates his connected peers
 * — a self-pair row (his own uid in his own connection list)
 * makes his OWN published records doc a "peer's" doc, driver-
 * Wage and all. P&L's crew fetch then cached EVERY uid's wage
 * into __peer_wages with no self-exclusion, and the
 * Preferences card listed every cached uid. The wage list is
 * for OTHER drivers: an account's own wage must never appear
 * in it — excluded at the cache write (P&L) AND at the read
 * (Preferences), so a cache poisoned before the fix also
 * renders clean.
 *
 * Worlds run the REAL modules (preferences.js with the real
 * connectlive/connectpipe; pnl.js with a stubbed ConnectPipe
 * returning his exact self-pair shape).
 *
 * Run: node tools/peer-wages-self-v243-test.js
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
const clone = (v) => JSON.parse(JSON.stringify(v));
function flush(n) {
  return new Promise((res) => { let i = 0; (function step() { if (++i > (n || 40)) return res(); setTimeout(step, 0); })(); });
}
function extractRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('region not found: ' + beginMark);
  return src.slice(a, b + 2);
}

/* ---------------- fake Firestore (connect-live shape) ---------------- */
function FakeDb() { this.cols = {}; this.writes = 0; }
FakeDb.prototype._col = function (name) { return this.cols[name] || (this.cols[name] = new Map()); };
function docSnap(id, data) {
  return { id: id, exists: data !== undefined, data: function () { return data === undefined ? undefined : clone(data); } };
}
function querySnap(rows) {
  return { docs: rows.map(function (r) { return docSnap(r[0], r[1]); }), empty: rows.length === 0, size: rows.length,
    forEach: function (cb) { this.docs.forEach(cb); } };
}
function matchOp(v, op, val) {
  if (op === '==') return v === val;
  if (op === 'array-contains') return Array.isArray(v) && v.indexOf(val) !== -1;
  if (op === '>=') return v !== undefined && v >= val;
  if (op === '<=') return v !== undefined && v <= val;
  throw new Error('fake db: unsupported op ' + op);
}
FakeDb.prototype.collection = function (name) {
  const db = this;
  const makeQuery = (filters) => ({
    where: (f, op, v) => makeQuery(filters.concat([[f, op, v]])),
    get: () => {
      const rows = [];
      db._col(name).forEach((data, id) => {
        if (filters.every(([f, op, v]) => matchOp(data[f], op, v))) rows.push([id, data]);
      });
      return Promise.resolve(querySnap(rows));
    }
  });
  return Object.assign(makeQuery([]), {
    doc: (id) => ({
      get: () => Promise.resolve(docSnap(id, db._col(name).get(id))),
      set: (data, opts) => {
        db.writes++;
        const cur = db._col(name).get(id);
        db._col(name).set(id, opts && opts.merge && cur ? Object.assign(clone(cur), clone(data)) : clone(data));
        return Promise.resolve();
      },
      update: (data) => {
        db.writes++;
        const cur = db._col(name).get(id);
        if (cur === undefined) return Promise.reject(new Error('update on missing doc'));
        db._col(name).set(id, Object.assign(clone(cur), clone(data)));
        return Promise.resolve();
      }
    })
  });
};

/* ---------------- fake DOM (v137 rendered-id aware) ---------------- */
function FakeEl(sel) {
  this._sel = sel || '';
  this.value = ''; this.textContent = ''; this.innerHTML = '';
  this.checked = false; this.disabled = false; this.style = {}; this.files = [];
  this.onclick = null; this.onchange = null; this._listeners = {};
  const classes = new Set();
  this.classList = {
    add: function (c) { classes.add(c); }, remove: function (c) { classes.delete(c); },
    contains: function (c) { return classes.has(c); },
    toggle: function (c, force) {
      const on = force === undefined ? !classes.has(c) : !!force;
      if (on) classes.add(c); else classes.delete(c);
      return on;
    }
  };
}
FakeEl.prototype.addEventListener = function (type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); };
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
        while ((om = oRe.exec(m[2]))) opts.push({ sel: /selected/.test(om[1]), text: om[2], val: /\bvalue="([^"]*)"/.exec(om[1]) });
        const chosen = opts.filter(function (o) { return o.sel; })[0] || opts[0];
        selVals[m[1]] = chosen ? (chosen.val ? chosen.val[1] : chosen.text) : '';
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

function makeStore(seed) {
  const m = new Map(Object.entries(clone(seed || {})));
  return {
    get: (k, d) => (m.has(k) ? clone(m.get(k)) : d),
    set: (k, v) => { m.set(k, clone(v)); return true; },
    del: (k) => { m.delete(k); return true; }
  };
}

const SELF = 'uid-self';
const OTHER = 'uid-other';
const ONB = {
  accountType: 'Driver', userRole: 'driver', firstName: 'Asjad', lastName: 'Kamal',
  companyName: 'Asjad Kamal', contractingCo: 'AI Trucking', truckNo: '07', plate: '04 R209',
  ownWageRate: '29', payRate: '29', rateIncludesTax: true, invoiceTaxRate: '5',
  nextInvoiceNo: '1152', homeProvince: 'Alberta'
};

/* ============ W1: the READ — Preferences never lists his own wage ============ */
function prefsWorld(peerWages) {
  const db = new FakeDb();
  const store = makeStore({ onboarding: clone(ONB), con_list: [], con_hidden: [], __peer_wages: peerWages });
  const sb = { console, setTimeout, clearTimeout, Promise, JSON, Date, Math };
  sb.window = sb;
  sb.Meticulous = { modules: {} };
  sb.esc = (s) => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  sb.dspFmtH = function (x) {
    var n = Math.round((parseFloat(x) || 0) * 100) / 100;
    return (n % 1 === 0) ? n.toFixed(1) : String(n);
  };
  const App = {
    _store: store,
    _esc: sb.esc,
    _masterOdometer: function () { return null; },
    userRole: function () { return 'driver'; },
    user: { uid: SELF, email: 'asjadkamal482@gmail.com' },
    onAuth: function (user) { try { if (sb.ConnectLive) sb.ConnectLive.onAuth(user); } catch (e) {} },
    goSignIn: function () {},
    toast: function () {},
    _today: function () { return '2026-10-23'; }
  };
  sb.App = App;
  sb.FB = { ready: true, user: { uid: SELF, email: 'asjadkamal482@gmail.com' }, db: db };
  sb.alert = function () {};
  sb.confirm = function () { return true; };
  vm.createContext(sb);
  vm.runInContext(read('js/connectlive.js'), sb);
  vm.runInContext(read('js/connectpipe.js'), sb);
  vm.runInContext(read('modules/preferences.js'), sb);
  return { sb, db, store, App };
}

/* ============ W2: the WRITE — P&L's crew fetch never caches his own wage ============ */
function pnlWorld() {
  const store = makeStore({
    onboarding: clone(ONB), rev_entries: [], rev_extras: [], fuel_fills: [], sessions: []
  });
  const sb = {
    window: {}, Meticulous: { modules: {} }, console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
    App: {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s); },
      _today: function () { return '2026-10-23'; },
      user: { uid: SELF },
      toast: function () {}
    }
  };
  sb.window = sb;
  const CP = {
    fetchCrewRange: function () { return Promise.resolve([]); },
    /* his exact shape: his OWN records doc fetched as a "peer's"
       (self-pair), carrying his own $29 driverWage, beside one
       genuine other driver's $35 */
    fetchRecords: function () {
      return Promise.resolve({ records: {
        'uid-self': { driverWage: { payType: 'hourly', rate: 29 } },
        'uid-other': { driverWage: { payType: 'hourly', rate: 35 } }
      }, billing: {}, manifests: {} });
    }
  };
  sb.ConnectPipe = CP;
  sb.window.ConnectPipe = CP;
  sb.FB = { ready: true, user: { uid: SELF } };
  vm.createContext(sb);
  vm.runInContext(extractRegion(read('modules/invoice.js'), 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(read('modules/pnl.js'), sb);
  return { sb, store, pnl: sb.Meticulous.modules.pnl };
}

(async function () {
console.log('— W1: Preferences — the card holds only OTHER drivers —');
{
  /* the cache as P&L wrote it pre-fix: self + one other driver */
  const w = prefsWorld({ 'uid-self': { payType: 'hourly', rate: 29 }, 'uid-other': { payType: 'hourly', rate: 35 } });
  const body = makeBody();
  w.sb.Meticulous.modules.preferences.render(body);
  await flush();
  const html = body.innerHTML;
  ok('W1 the Drivers’ wages card still renders (a real other driver exists)',
    html.indexOf('Drivers') !== -1 && html.indexOf('wages') !== -1);
  ok('W1 the OTHER driver’s wage shows', html.indexOf('$35.00/hour') !== -1);
  ok('W1 HIS OWN $29 wage is NOT in the list', html.indexOf('$29.00/hour') === -1,
    'card html carries $29.00/hour');
}
{
  /* self only in the cache: the card shows NONE — not himself */
  const w = prefsWorld({ 'uid-self': { payType: 'hourly', rate: 29 } });
  const body = makeBody();
  w.sb.Meticulous.modules.preferences.render(body);
  await flush();
  const html = body.innerHTML;
  ok('W1 with only his own wage cached, the card does not render at all',
    html.indexOf('wages — set by each driver') === -1 && html.indexOf('$29.00/hour') === -1);
}

console.log('— W2: P&L crew fetch — the cache never takes his own wage —');
{
  const w = pnlWorld();
  const body = makeBody();
  w.pnl.render(body);
  await flush(60);
  const pw = w.store.get('__peer_wages', {});
  ok('W2 the other driver’s wage is cached', !!(pw[OTHER] && pw[OTHER].rate === 35), JSON.stringify(pw));
  ok('W2 HIS OWN wage is NOT cached', !(SELF in pw), JSON.stringify(pw));
}

console.log('\npeer-wages-self-v243: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
