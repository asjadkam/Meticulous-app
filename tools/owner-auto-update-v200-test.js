#!/usr/bin/env node
/* Meticulous v200 — OWNER-AUTO-UPDATE (owner, Oct 21, 2026 09:48
 * MDT): "make sure in the owners/fleet managers account that
 * should be updated automatically, using the data I am collecting
 * daily" — his account is a clean Driver now; the owner side
 * (his tester) must build itself from the connected driver's
 * closed days over a Full-access pair, with NO re-entry.
 *
 * What already worked before v200 (proven here again): the
 * driver's closed days publish as facts and cross; the owner's
 * P&L booked their WAGES (crewWagesFor, at the DRIVER's own
 * rate, travel included). What was missing: their REVENUE never
 * entered the owner's books — calc()'s income was own-entries
 * only, so the owner's P&L carried a crew day's cost and none
 * of what it earned.
 *
 * v200: crewRevenueFor(m) in modules/pnl.js — the same cached
 * shared days, the pipe's own pricer (priceDay), at THIS side's
 * client rate (pricingFor), same Limited gate as the wages —
 * joined into calc()'s income; the P&L repaint condition watches
 * crewRevenue too.
 *
 * Fixtures over the REAL connectlive + connectpipe + pnl over a
 * fake Firestore, two worlds sharing one database:
 *  DRIVER closes 2026-10-14 (ticket: 9.5 foreman, travel bonus 1,
 *  his wage $29/h) and 2026-10-15 (ticketless session close, 8h),
 *  plus an OPEN day 2026-10-16 that must price nothing.
 *  OWNER (client rate $93/h, payRate $40 BAIT — a connected
 *  driver's wage never comes from the boss) opens P&L:
 *   revenue  = 9.5×93 + 8×93            = $1,627.50
 *   wages    = (9.5+1)×29 + 8×29        =   $536.50
 *   net      = revenue − wages          = $1,091.00
 *  with ZERO manual entries on the owner side.
 *  A Limited pair (no P&L tick) books NEITHER leg.
 * Run: node tools/owner-auto-update-v200-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const clSrc = read('js/connectlive.js');
const cpSrc = read('js/connectpipe.js');
const ocrSrc = read('js/ticket-ocr.js');
const appSrc = read('js/app.js');
const pnlSrc = read('modules/pnl.js');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
const clone = (v) => JSON.parse(JSON.stringify(v));

/* ---------------- fake Firestore (compat shape) ---------------- */
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

/* ---------------- worlds ---------------- */
function makeStore(seed) {
  const m = new Map(Object.entries(clone(seed || {})));
  return {
    get: (k, d) => (m.has(k) ? clone(m.get(k)) : d),
    set: (k, v) => { m.set(k, clone(v)); return true; },
    del: (k) => { m.delete(k); return true; }
  };
}
const TODAY = '2026-10-21';
const D_TICKET = '2026-10-14', D_SESSION = '2026-10-15', D_OPEN = '2026-10-16';

const users = {
  owner: {
    uid: 'uid-boss', email: 'boss@example.com', role: 'office',
    store: makeStore({
      onboarding: { companyName: 'Test Trucking', accountType: 'Owner-Operator', billingRate: 93, payRate: 40 /* BAIT */ },
      con_list: [
        { id: 'c1', name: 'Asjad Kamal', role: 'Driver', face: 'driver', contact: '', uid: 'uid-driver', status: 'connected', viaConnect: true, kind: 'all' },
        { id: 'c2', name: 'Limited Larry', role: 'Driver', face: 'driver', contact: '', uid: 'uid-ltd', status: 'connected', viaConnect: true, kind: 'limited', modules: ['dispatch'] }
      ],
      rev_entries: [], rev_extras: [], dsp_list: [], dsp_active: null, sessions: []
    })
  },
  driver: {
    uid: 'uid-driver', email: 'driver@example.com', role: 'driver',
    store: makeStore({
      onboarding: { companyName: 'Asjad Kamal', accountType: 'Driver', travelBonus: 1, payRate: 29, billingRate: 999 /* BAIT */, ownWageRate: 29 },
      con_list: [
        { id: 'ub', name: 'Test Trucking', role: 'Owner-Operator', face: 'office', contact: '', uid: 'uid-boss', status: 'connected', viaConnect: true, kind: 'all' }
      ],
      dsp_list: [
        {
          id: 'dsp1', jobSite: 'Star Pit', date: D_TICKET, scheduledAt: D_TICKET + 'T08:00',
          equipment: 'Tandem', material: '20mm drain', ticketNo: '16780', status: 'completed',
          endedAt: Date.now() - 3600e3, loads: '4', loadsSet: true,
          tickets: [{ id: 't1', cardNumber: '16780', material: '20mm drain', loads: 4, foremanHours: 9.5, photo: 'data:image/jpeg;base64,X' }]
        },
        {
          id: 'dsp2', jobSite: 'Not Started Pit', date: D_OPEN, scheduledAt: D_OPEN + 'T08:00',
          equipment: 'Tandem', material: '', ticketNo: '', status: 'saved', tickets: [], photo: null
        }
      ],
      dsp_active: null,
      sessions: [
        { date: D_TICKET, seconds: 10.5 * 3600, endedAt: new Date(Date.now() - 3600e3).toISOString(), liveKm: 210 },
        { date: D_SESSION, seconds: 8 * 3600, endedAt: new Date(Date.now() - 3600e3).toISOString(), liveKm: 160 }
      ],
      tracker: { status: 'idle', startTs: 0, elapsed: 0 }
    })
  },
  ltd: {
    uid: 'uid-ltd', email: 'ltd@example.com', role: 'driver',
    store: makeStore({
      onboarding: { companyName: 'Limited Larry', accountType: 'Driver', travelBonus: 0, payRate: 20, ownWageRate: 20 },
      con_list: [
        { id: 'ub', name: 'Test Trucking', role: 'Owner-Operator', face: 'office', contact: '', uid: 'uid-boss', status: 'connected', viaConnect: true, kind: 'all' }
      ],
      dsp_list: [
        {
          id: 'dl1', jobSite: 'Larry Pit', date: D_TICKET, scheduledAt: D_TICKET + 'T08:00',
          status: 'completed', endedAt: Date.now() - 3600e3, loads: '2', loadsSet: true,
          tickets: [{ id: 't1', cardNumber: '900', loads: 2, foremanHours: 5, photo: null }]
        }
      ],
      dsp_active: null,
      sessions: [{ date: D_TICKET, seconds: 5 * 3600, endedAt: new Date(Date.now() - 3600e3).toISOString(), liveKm: 90 }],
      tracker: { status: 'idle', startTs: 0, elapsed: 0 }
    })
  }
};

const db = new FakeDb();
const sb = { console: console, setTimeout: setTimeout, Promise: Promise };
sb.window = sb;
sb.Meticulous = { modules: {} };
sb.esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
vm.createContext(sb);
vm.runInContext(ocrSrc, sb);
vm.runInContext(clSrc, sb);
vm.runInContext(cpSrc, sb);
/* the shared revenue core (invoice region) + pnl, as the owner runs them */
(function loadPnl() {
  const a = appSrc.lastIndexOf('/*', appSrc.indexOf('SHARED REVENUE CORE (v105)'));
  const b = appSrc.indexOf('*/', appSrc.indexOf('end SHARED REVENUE CORE'));
  if (a === -1 || b === -1) throw new Error('revenue core markers missing');
  vm.runInContext(appSrc.slice(a, b + 2), sb);
})();
vm.runInContext(pnlSrc, sb);

function asUser(u) {
  sb.FB = { ready: true, user: { uid: u.uid, email: u.email }, db: db };
  sb.App = {
    _store: u.store,
    _esc: sb.esc,
    _today: () => TODAY,
    _toast: function () {},
    userRole: () => u.role,
    tracker: u.store.get('tracker', null)
  };
  sb.window.FB = sb.FB; sb.window.App = sb.App;
  sb.ConnectLive._pubKey = '';
  sb.ConnectPipe._pubCache = {};
  sb.ConnectPipe._recCache = {};
  sb.ConnectPipe._lastPullAt = 0;
  sb.ConnectPipe._crewCache = null;
  sb.ConnectPipe._peerCache = null;
}
function flush() {
  return new Promise((res) => { let n = 0; (function step() { if (++n > 40) return res(); setTimeout(step, 0); })(); });
}
const CP = () => sb.ConnectPipe;
const pnl = () => sb.Meticulous.modules.pnl;

(async function main() {
  /* ===== the drivers close their days; the pipe carries them UP ===== */
  asUser(users.driver);
  eq('driver: the ticket day publishes', await CP().publishDay(D_TICKET), true);
  eq('driver: the ticketless session day publishes', await CP().publishDay(D_SESSION), true);
  eq('driver: the open day publishes (facts ride; money must not)', await CP().publishDay(D_OPEN), true);
  await CP().publishRecords();
  await flush();
  asUser(users.ltd);
  eq('limited driver: his completed day publishes too', await CP().publishDay(D_TICKET), true);
  await CP().publishRecords();
  await flush();

  /* ===== the owner side: P&L's own plumbing, verbatim in spirit ===== */
  asUser(users.owner);
  const days = await CP().fetchCrewRange('2026-10-01', '2026-10-31');
  eq('owner: all four shared days arrive with no hand-entry', days.length, 4);
  const byMon = {};
  days.forEach(function (d) { if (d && d.date) { const mk = d.date.slice(0, 7); (byMon[mk] = byMon[mk] || []).push(d); } });
  /* pnl caches crew days under the '__crew_days' key, by month —
     the same write its render plumbing performs */
  users.owner.store.set('__crew_days', byMon);
  const fr = await CP().fetchRecords();
  const pw = {};
  Object.keys((fr && fr.records) || {}).forEach(function (uid) {
    const w = fr.records[uid] && fr.records[uid].driverWage;
    if (w && parseFloat(w.rate) > 0) pw[uid] = { payType: w.payType || 'hourly', rate: parseFloat(w.rate) || 0 };
  });
  users.owner.store.set('__peer_wages', pw);
  eq('owner: the driver wage crossed at HIS rate ($29, not the boss bait $40)', pw['uid-driver'], { payType: 'hourly', rate: 29 });

  /* ===== the books build themselves ===== */
  const c = pnl()._calc('2026-10');
  eq('crew revenue: ticket day 9.5×$93 + session day 8×$93', c.crewRevenue, 1627.50);
  eq('crew revenue attributed to the driver', c.crewRevenueByDriver['uid-driver'].revenue, 1627.50);
  eq('crew wages: (9.5+1 travel)×$29 + 8×$29 — travel on the expense side, at his rate', c.crewWages, 536.50);
  eq('income IS the crew revenue — the owner typed nothing', c.income, 1627.50);
  eq('wages total carries the crew wages', c.wagesTotal, 536.50);
  /* net also carries the standing auto detail rows (Brokerage
     fees default 10% of revenue — the same default that prices
     on own-books income): 1627.50 − 536.50 − 162.75 = 928.25 */
  eq('net = income − expenses, with the standing 10% brokerage auto row', c.net, 928.25);
  eq('the only detail expense is that auto row', c.detailTotal, 162.75);
  eq('the Limited pair books NO revenue leg', (c.crewRevenueByDriver['uid-ltd'] || {}).revenue, undefined);
  eq('the Limited pair books NO wage leg', (c.crewWagesByDriver['uid-ltd'] || {}).wage, undefined);

  /* the open day priced nothing: drop the two closed days from
     the cache and the money disappears with them */
  const openOnly = {};
  openOnly['2026-10'] = days.filter(function (d) { return d.date === D_OPEN; });
  users.owner.store.set('__crew_days', openOnly);
  const c2 = pnl()._calc('2026-10');
  eq('open day alone: revenue $0', c2.crewRevenue, 0);
  eq('open day alone: wages $0', c2.crewWages, 0);
  eq('open day alone: income $0', c2.income, 0);

  /* no crew at all: the own-books figures are untouched */
  users.owner.store.set('__crew_days', {});
  const c3 = pnl()._calc('2026-10');
  eq('no crew: income 0, crew legs 0', [c3.income, c3.crewRevenue, c3.crewWages], [0, 0, 0]);

  /* ===== statics ===== */
  check('pnl.js: crewRevenueFor derives through priceDay + pricingFor',
    pnlSrc.includes('function crewRevenueFor(m)') && pnlSrc.includes('ConnectPipe.priceDay(day, pricing)'));
  check('pnl.js: income joins the crew revenue in calc', pnlSrc.includes('income + cr.total'));
  check('pnl.js: the repaint condition watches crewRevenue', pnlSrc.includes('nc.crewRevenue !== c.crewRevenue'));
  eq('webVersion pin', ver.webVersion, JSON.parse(read('version.json')).webVersion);

  console.log('owner-auto-update-v200: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
})().catch(function (e) { console.log('  FAIL harness: ' + (e && e.stack || e)); process.exit(1); });
