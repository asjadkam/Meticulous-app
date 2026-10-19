#!/usr/bin/env node
/* Meticulous v168 — CONNECT COMPLETE HISTORY suite (owner,
 * Oct 18, 2026 13:47 MDT: "It should show everything! Past and
 * present! That's the full access."). Until now a pair carried
 * only what closed AFTER it formed. Now, when a peer is NEW to
 * the driver's Full share list — pair formed, kind raised to
 * Full, viewer added — one complete-history sweep publishes
 * EVERY day with data, and the records set carries the whole
 * book (the 40-fill / 60-expense amputation caps are lifted).
 * Limited peers still get manifests only, never a viewers seat.
 *
 * The world mirrors tools/connect-share-v146-test.js (fake
 * Firestore + the real connectlive/connectpipe/invoice-cycle).
 * Run: node tools/queue-v168-test.js
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

class FakeDb {
  constructor() { this.cols = {}; this.writes = 0; }
  _col(name) { return this.cols[name] || (this.cols[name] = new Map()); }
}
function docSnap(id, data) {
  return { id: id, exists: data !== undefined, data: () => (data === undefined ? undefined : clone(data)) };
}
function querySnap(rows) {
  return {
    docs: rows.map((r) => docSnap(r[0], r[1])),
    empty: rows.length === 0, size: rows.length,
    forEach: function (cb) { this.docs.forEach(cb); }
  };
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
      },
      delete: () => { db._col(name).delete(id); return Promise.resolve(); }
    })
  });
};
function makeStore(seed) {
  const m = new Map(Object.entries(clone(seed || {})));
  return {
    get: (k, d) => (m.has(k) ? clone(m.get(k)) : d),
    set: (k, v) => { m.set(k, clone(v)); return true; },
    del: (k) => { m.delete(k); return true; }
  };
}
function extractRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('region not found: ' + beginMark);
  return src.slice(a, b + 2);
}

const TODAY = '2026-10-17';
const D1 = '2026-09-05', D2 = '2026-09-20', D3 = '2026-10-16';
function dsp(id, date) {
  return {
    id: id, jobSite: 'Aecon Inf', date: date, scheduledAt: date + 'T08:00',
    equipment: 'Tandem', material: 'Clay', ticketNo: 'T' + id, status: 'completed',
    endedAt: Date.now() - 86400e3, loads: '4', loadsSet: true,
    tickets: [{ id: 'tk' + id, cardNumber: 'T' + id, material: 'Clay', loads: 4, foremanHours: 10, photo: null }]
  };
}
const fills = [];
for (let i = 0; i < 45; i++) {
  const d = new Date(2026, 8, 1 + (i % 28), 12);
  const ds = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  fills.push({ date: ds, litres: 50 + i, cost: 100 + i, station: 'Petro-Canada', odo: 160000 + i * 100 });
}
const driverStore = makeStore({
  onboarding: { companyName: 'Asjad Kamal', accountType: 'Owner-Operator', travelBonus: 1, payRate: 29, ownWageRate: 29 },
  con_list: [],
  dsp_list: [dsp('a', D1), dsp('b', D2), dsp('c', D3)],
  dsp_active: null,
  sessions: [
    { date: D1, seconds: 36000, endedAt: new Date(Date.now() - 86400e3).toISOString(), liveKm: 100 },
    { date: D2, seconds: 36000, endedAt: new Date(Date.now() - 86400e3).toISOString(), liveKm: 110 },
    { date: D3, seconds: 36000, endedAt: new Date(Date.now() - 86400e3).toISOString(), liveKm: 120 }
  ],
  tracker: { status: 'idle', startTs: 0, elapsed: 0 },
  rev_entries: [
    { date: D1, type: 'hourly', hours: '11', amount: '319.00', note: 'Dispatch: Aecon Inf · foreman 10h', foremanHours: 10, travelHours: 1, loads: 1 },
    { date: D2, type: 'hourly', hours: '11', amount: '319.00', note: 'Dispatch: Aecon Inf · foreman 10h', foremanHours: 10, travelHours: 1, loads: 1 },
    { date: D3, type: 'hourly', hours: '11', amount: '319.00', note: 'Dispatch: Aecon Inf · foreman 10h', foremanHours: 10, travelHours: 1, loads: 1 }
  ],
  fuel_fills: fills,
  fuel_expenses: [{ date: D2, what: 'Truck wash', cost: '25.00' }],
  mt_odo: '169300', mt_events: [{ date: D2, odo: 164000, type: 'Oil change', cost: 189.99, notes: '' }],
  inv_list: [{
    id: 'inv-old', no: '1140', date: '2026-09-15', billTo: 'AI Trucking, 1506 16 St NE, Calgary AB',
    pa: '2026-09-01', pb: '2026-09-15', revLines: [{ date: D1, amt: 1000, src: 'dispatch' }], items: [],
    taxRate: 5, taxIncluded: true, sub: 1000, tax: 47.62, total: 1000,
    dayHours: { '2026-09-05': 10 }, cardDays: null, rate: 29, truckNo: '07', notes: '',
    company: { name: 'Asjad Kamal', addr: '', gst: '' }, province: 'Alberta', country: 'Canada',
    payments: [], paidAmount: null, paid: null
  }]
});

const db = new FakeDb();
const sb = { console: console, setTimeout: setTimeout, Promise: Promise };
sb.window = sb;
sb.Meticulous = { modules: {} };
sb.esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&g/g, '&amp;').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
sb.FB = { ready: true, user: { uid: 'uid-driver', email: 'driver@example.com' }, db: db };
sb.App = {
  _store: driverStore, _esc: sb.esc, _today: () => TODAY,
  userRole: () => 'driver', tracker: null
};
sb.window.FB = sb.FB; sb.window.App = sb.App;
vm.createContext(sb);
vm.runInContext(read('js/connectlive.js'), sb);
vm.runInContext(read('js/connectpipe.js'), sb);
vm.runInContext(extractRegion(read('modules/invoice.js'), 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
sb.ConnectPipe._rendition = function () { return Promise.resolve('data:image/jpeg;base64,RENDITION'); };
const CP = sb.ConnectPipe;
const dayDoc = (date) => db._col('shareddays').get('uid-driver_' + date);
const recDoc = () => db._col('sharedrecords').get('uid-driver');

(async function main() {
  eq('A1 historyDates finds every day with data, sorted', CP.historyDates(), [D1, D2, D3]);

  await CP.publishAll();
  eq('A2 with no peers, nothing crosses and no sweep is recorded',
    [db._col('shareddays').size, driverStore.get('cp_hist_peers', null)], [0, null]);

  driverStore.set('con_list', [
    { id: 'ub', name: 'AI Trucking', role: 'Fleet Manager', contact: '', uid: 'uid-boss', status: 'connected', viaConnect: true }
  ]);
  await CP.publishAll();
  eq('A3 the new Full peer gets the COMPLETE day history (all 3 past days)',
    [!!dayDoc(D1), !!dayDoc(D2), !!dayDoc(D3)], [true, true, true]);
  eq('A4 every history day names him as a viewer',
    [dayDoc(D1).viewers, dayDoc(D2).viewers, dayDoc(D3).viewers],
    [['uid-boss'], ['uid-boss'], ['uid-boss']]);
  eq('A5 the records doc carries the WHOLE fuel book (45 fills — the 40 cap is gone)',
    recDoc().fuel.length, 45);
  eq('A6 his bill-to-matched invoice crossed in the billing doc',
    (db._col('sharedbilling').get('uid-driver_uid-boss') || {}).invoices.map((i) => i.no), ['1140']);
  eq('A7 the peer joins the known set (the sweep runs once per peer)',
    driverStore.get('cp_hist_peers', null), ['uid-boss']);

  const writes = db.writes;
  await CP.publishAll();
  eq('A8 a later publishAll rewrites nothing (content guards + no re-sweep)', db.writes, writes);

  driverStore.set('con_list', [
    { id: 'ub', name: 'AI Trucking', role: 'Fleet Manager', contact: '', uid: 'uid-boss', status: 'connected', viaConnect: true },
    { id: 'ul', name: 'Limited Lou', role: 'Fleet Manager', contact: '', uid: 'uid-ltd', status: 'connected', viaConnect: true, kind: 'limited' }
  ]);
  await CP.publishAll();
  eq('A9 a LIMITED peer is never named a viewer (manifests only, as ever)',
    dayDoc(D1).viewers, ['uid-boss']);
  eq('A9 the records viewers exclude him too', recDoc().viewers, ['uid-boss']);

  const list = driverStore.get('con_list', []);
  list[1].kind = 'all';
  driverStore.set('con_list', list);
  await CP.publishAll();
  eq('A10 raised to Full, he is NEW again — history re-runs and names him',
    dayDoc(D1).viewers, ['uid-boss', 'uid-ltd']);
  eq('A10 the known set now holds both', driverStore.get('cp_hist_peers', null), ['uid-boss', 'uid-ltd']);

  eq('A11 publishHistoryIfNewPeers is quiet when nobody is new',
    await CP.publishHistoryIfNewPeers(), false);

  console.log('\nqueue-v168 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR: ' + (e && e.stack || e)); process.exit(1); });
