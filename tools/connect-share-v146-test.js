#!/usr/bin/env node
/* Meticulous v146 — CONNECT SHARE suite (owner orders, Oct 17,
 * 2026, 21:25–21:33 MDT: "The most important thing is that he
 * sees my fuel... My maintenance record, and my pay goes as an
 * expense in his pnl" + "Make sure he gets my fuel receipts, my
 * pay invoices and my expenses" + "He also gets my manifests...")
 * plus the PRIORITY FIX ordered 21:41 MDT over the payer's own
 * screenshot (a tracker-closed day published foreman 0 / travel
 * 0 and could never price).
 *
 * Runs the REAL shipped code — js/connectlive.js +
 * js/connectpipe.js whole, the INV-CYCLE region of
 * modules/invoice.js (the shared invoice composer), modules/
 * manifest.js whole (the manifest's own collect/docLines),
 * modules/pnl.js whole (crew card + _calc), and the DSP-PIPE
 * region of modules/dispatch.js (the Crew board card) — over a
 * fake Firestore and per-user memory stores.
 *
 *  (a) records publish: shape + exact keys + viewers named from
 *      CURRENT connections; the receipt DATA rides, the photo
 *      bytes do NOT; content guard (no rewrite of same facts)
 *  (b) receipt photos: one sharedphotos doc per photo fill, a
 *      rendition (never the stored original), pruned when the
 *      fill loses its photo
 *  (c) billing split: each payer's doc carries ONLY the invoices
 *      billed to him (+ the pairing manifests); the other
 *      customer's invoice never crosses; a settled-outside record
 *      never crosses; the payer renders/prints the driver's own
 *      document from the payload
 *  (d) rules posture: statics in the connect-live (h) style for
 *      the three new collections + a behavioural read matrix
 *      (stranger denied, each payer only his own billing)
 *  (e) payer surface: the P&L crew card paints his fuel rows +
 *      receipt button + expenses + maintenance facts + invoice
 *      rows from the shared records
 *  (f) the P&L pay-expense leg: DERIVED from the crew-day cache —
 *      per priced day, idempotent, $0 while the rate is unset, a
 *      correction re-prices (never stacks), and a non-Connect
 *      account's figures are unchanged
 *  (g) CLOSE FACTS (the 21:41 fix): a tracker-closed day
 *      publishes its real split; a dispatch-closed day is
 *      unchanged; both-exist -> the completion wins; a corrected
 *      close re-publishes the corrected split; the payer's Crew
 *      card shows the close (never "0.0 foreman")
 *  (h) revoke: a removed peer is pruned from viewers and his
 *      billing doc is emptied (seeded across sessions); the last
 *      peer leaving empties the viewers list
 *  (i) statics: publish hooks, version pins, cache locality
 * Run: node tools/connect-share-v146-test.js
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
const invSrc = read('modules/invoice.js');
const manSrc = read('modules/manifest.js');
const pnlSrc = read('modules/pnl.js');
const dspSrc = read('modules/dispatch.js');
const conSrc = read('modules/connect.js');
const fuelSrc = read('modules/fuel.js');
const mtSrc = read('modules/maintenance.js');
const cloudSrc = read('js/cloudsync.js');
const rulesSrc = read('firestore.rules');
const idxSrc = read('index.html');
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
function keysEq(name, obj, wantSorted) {
  eq(name, Object.keys(obj || {}).sort(), wantSorted.slice().sort());
}
function extractRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}

/* ---------------- fake Firestore (compat shape) ---------------- */
function FakeDb() { this.cols = {}; this.writes = 0; }
FakeDb.prototype._col = function (name) {
  return this.cols[name] || (this.cols[name] = new Map());
};
function docSnap(id, data) {
  return { id: id, exists: data !== undefined, data: function () { return data === undefined ? undefined : clone(data); } };
}
function querySnap(rows) {
  return {
    docs: rows.map(function (r) { return docSnap(r[0], r[1]); }),
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

/* ---------------- fake store + user worlds ---------------- */
function makeStore(seed) {
  const m = new Map(Object.entries(clone(seed || {})));
  return {
    get: (k, d) => (m.has(k) ? clone(m.get(k)) : d),
    set: (k, v) => { m.set(k, clone(v)); return true; },
    del: (k) => { m.delete(k); return true; }
  };
}

/* ---------------- fake DOM (boss-firstrun pattern) ---------------- */
function FakeEl(sel) {
  this._sel = sel || ''; this._kids = {}; this._html = '';
  this.value = ''; this.textContent = ''; this.style = {}; this.files = [];
  this.onclick = null; this._listeners = {}; this.options = [{ text: '' }];
  this.selectedIndex = 0;
  this.classList = { add: function () {}, remove: function () {}, toggle: function () {} };
}
Object.defineProperty(FakeEl.prototype, 'innerHTML', {
  get: function () { return this._html; },
  set: function (v) { this._html = String(v); this._kids = {}; }
});
FakeEl.prototype.querySelector = function (sel) {
  return this._kids[sel] || (this._kids[sel] = new FakeEl(sel));
};
FakeEl.prototype.querySelectorAll = function () { return []; };
FakeEl.prototype.addEventListener = function (type, fn) {
  (this._listeners[type] = this._listeners[type] || []).push(fn);
};
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };

const TODAY = '2026-10-17', OCT1 = '2026-10-01', OCT16 = '2026-10-16', OCT15 = '2026-10-15';
const PHOTO = 'data:image/jpeg;base64,PHOTOSECRET';

const INV1151 = {
  id: 'inv1', no: '1151', date: '2026-10-16',
  billTo: 'AI Trucking, 1506 16 St NE, Calgary AB T2E 4T2',
  pa: OCT1, pb: OCT15,
  revLines: [{ date: OCT1, amt: 3610.50, src: 'dispatch' }], items: [],
  taxRate: 5, taxIncluded: true, sub: 3610.50, tax: 171.93, total: 3610.50,
  dayHours: { '2026-10-01': 124.5 }, cardDays: null, rate: 29, truckNo: '07',
  notes: '', company: { name: 'Asjad Kamal', addr: '1243 Cornerstone Blvd NE, Calgary T3N 2A6', gst: '76566 2010 RT0001' },
  province: 'Alberta', country: 'Canada', payments: [], paidAmount: null, paid: null
};
const INV2000 = {
  id: 'inv2', no: '2000', date: '2026-10-01',
  billTo: 'Other Customer Inc, 1 Other Way, Calgary AB',
  pa: '2026-09-16', pb: '2026-09-30',
  revLines: [{ date: '2026-09-20', amt: 500 }], items: [],
  taxRate: 0, taxIncluded: false, sub: 500, tax: 0, total: 500,
  dayHours: { '2026-09-20': 10 }, cardDays: null, rate: 50, truckNo: '07',
  notes: '', company: { name: 'Asjad Kamal', addr: '1243 Cornerstone Blvd NE, Calgary T3N 2A6', gst: '' },
  province: 'Alberta', country: 'Canada', payments: [], paidAmount: null, paid: null
};
const INV_SETTLED_OUTSIDE = {
  id: 'inv3', no: '1149', date: '2026-09-15', billTo: '', pa: '2026-09-01', pb: '2026-09-15',
  revLines: [], items: [], taxRate: 5, taxIncluded: true, sub: null, tax: null, total: null,
  dayHours: {}, cardDays: null, rate: 29, truckNo: '07', notes: '',
  company: { name: 'Asjad Kamal', addr: '', gst: '' }, province: 'Alberta', country: 'Canada',
  settledOutside: true, payments: [], paidAmount: null, paid: null
};

const users = {
  driver: {
    uid: 'uid-driver', email: 'asjadkamal482@gmail.com', role: 'driver',
    store: makeStore({
      onboarding: { companyName: 'Asjad Kamal', accountType: 'Owner-Operator', travelBonus: 1, payRate: 29, billingRate: 999, ownWageRate: 29 },
      con_list: [
        { id: 'ub', name: 'AI Trucking', role: 'Fleet Manager', contact: '', uid: 'uid-boss', status: 'connected', viaConnect: true },
        { id: 'up2', name: 'Other Customer Inc', role: 'Fleet Manager', contact: '', uid: 'uid-payer2', status: 'connected', viaConnect: true }
      ],
      dsp_list: [
        {
          id: 'dsp-oct1', jobSite: 'Aecon Inf', date: OCT1, scheduledAt: OCT1 + 'T08:00',
          equipment: 'Tandem', material: 'Clay', ticketNo: '21314', amount: '319.00',
          status: 'completed', endedAt: Date.now() - 86400e3, loads: '4', loadsSet: true,
          tickets: [{ id: 'tk1', cardNumber: '21314', material: 'Clay', loads: 4, foremanHours: 10, photo: null }]
        },
        {
          id: 'dsp1', jobSite: 'Maple Ridge', date: TODAY, scheduledAt: TODAY + 'T08:00',
          equipment: 'Tandem', material: 'Clay', ticketNo: '22729', amount: '319.00',
          status: 'completed', endedAt: Date.now() - 3600e3, loads: '3', loadsSet: true,
          tickets: [{ id: 't1', cardNumber: '22729', material: 'Clay', loads: 3, foremanHours: 10, photo: PHOTO }]
        },
        {
          /* Oct 16: the ticketless close — completed through the
             day sheet with NO ticket; the day's hours live in the
             session + the tracker's revenue entry (section g) */
          id: 'dsp-oct16', jobSite: 'Aecon Inf', date: OCT16, scheduledAt: OCT16 + 'T08:00',
          equipment: 'Tandem', material: 'Clay', ticketNo: '21621', amount: '',
          status: 'completed', endedAt: Date.now() - 7200e3, loads: '6', loadsSet: true,
          tickets: []
        },
        {
          id: 'dsp2', jobSite: 'Ivor East Pond', date: TODAY, scheduledAt: TODAY + 'T13:00',
          equipment: 'Tandem', material: '', ticketNo: '', status: 'saved',
          source: 'fleet manager', tickets: [], photo: null
        }
      ],
      dsp_active: null,
      sessions: [
        { date: TODAY, seconds: 11 * 3600, endedAt: new Date(Date.now() - 3600e3).toISOString(), liveKm: 96.5 },
        { date: OCT16, seconds: 25236, endedAt: new Date(Date.now() - 7200e3).toISOString(), liveKm: 134 }
      ],
      tracker: { status: 'idle', startTs: 0, elapsed: 0 },
      rev_entries: [
        { date: OCT1, type: 'hourly', hours: '11', amount: '319.00', note: 'Dispatch: Aecon Inf · foreman 10h', foremanHours: 10, travelHours: 1, loads: 1 },
        { date: TODAY, type: 'hourly', hours: '11', amount: '319.00', note: 'Dispatch: Maple Ridge · foreman 10h', foremanHours: 10, travelHours: 1, loads: 1 },
        { date: OCT16, type: 'hourly', hours: '7.01', amount: '203.29', note: 'Auto from tracker', auto: true }
      ],
      fuel_fills: [
        { date: TODAY, time: '14:27', litres: 64.096, cost: 146.72, station: 'Petro-Canada 4949 Barlow Tr SE', odo: 169300, photo: PHOTO },
        { date: OCT15, litres: 66.24, cost: 193.80, station: 'Petro-Canada', odo: 168900 }
      ],
      fuel_expenses: [
        { date: OCT16, what: 'Truck wash', cost: '25.00' },
        { date: '2026-10-10', what: 'DEF fluid', cost: '18.50' }
      ],
      mt_odo: '169300', mt_nextServiceOdo: '175429', mt_nextServiceDate: '2026-11-27',
      mt_annualDate: '2027-05-31',
      mt_events: [{ date: '2026-09-20', odo: 164000, type: 'Oil change', cost: 189.99, notes: '' }],
      inv_list: [INV1151, INV2000, INV_SETTLED_OUTSIDE]
    })
  },
  boss: {
    uid: 'uid-boss', email: 'boss@aitrucking.example', role: 'office',
    store: makeStore({
      onboarding: { companyName: 'AI Trucking', accountType: 'Fleet Manager', billingRate: 52, payRate: 40 },
      con_list: [
        { id: 'ud1', name: 'Asjad Kamal', role: 'Driver', contact: '', uid: 'uid-driver', status: 'connected', viaConnect: true }
      ],
      pnl_drivers: [
        { id: 'pd1', name: 'Asjad Kamal', payType: 'hourly', rate: 29, uid: 'uid-driver', viaConnect: true, travelHours: 0, start: '2026-10' }
      ],
      dsp_list: [], dsp_active: null
    })
  },
  payer2: {
    uid: 'uid-payer2', email: 'other@example.com', role: 'office',
    store: makeStore({
      onboarding: { companyName: 'Other Customer Inc', accountType: 'Fleet Manager', billingRate: 50 },
      con_list: [
        { id: 'ud1', name: 'Asjad Kamal', role: 'Driver', contact: '', uid: 'uid-driver', status: 'connected', viaConnect: true }
      ],
      dsp_list: [], dsp_active: null
    })
  },
  stranger: {
    uid: 'uid-stranger', email: 'nobody@example.com', role: 'driver',
    store: makeStore({
      onboarding: { companyName: 'Stranger Co', accountType: 'Driver' },
      con_list: [], dsp_list: [], dsp_active: null, sessions: [], tracker: { status: 'idle', startTs: 0, elapsed: 0 }
    })
  }
};

const db = new FakeDb();
const sb = { console: console, setTimeout: setTimeout, Promise: Promise };
sb.window = sb;
sb.Meticulous = { modules: {} };
sb.esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
sb.dspFmtH = function (x) {
  var n = Math.round((parseFloat(x) || 0) * 100) / 100;
  return (n % 1 === 0) ? n.toFixed(1) : String(n);
};
sb.printDocCalls = [];
sb.printDoc = function (title, html) { sb.printDocCalls.push({ title: title, html: html }); };
vm.createContext(sb);
vm.runInContext(ocrSrc, sb);
vm.runInContext(clSrc, sb);
vm.runInContext(cpSrc, sb);
vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
vm.runInContext(manSrc, sb);
vm.runInContext(pnlSrc, sb);
/* the receipt rendition is a canvas job in the app; the suite
   injects a deterministic stand-in through the pipe's own hook */
sb.ConnectPipe._rendition = function () { return Promise.resolve('data:image/jpeg;base64,RENDITION'); };

function asUser(u) {
  sb.FB = { ready: true, user: { uid: u.uid, email: u.email }, db: db };
  sb.App = {
    _store: u.store,
    _esc: sb.esc,
    _today: () => TODAY,
    userRole: () => u.role,
    tracker: u.store.get('tracker', null)
  };
  sb.window.FB = sb.FB; sb.window.App = sb.App;
  /* a fresh phone session: per-session engine guards start empty */
  sb.ConnectLive._pubKey = '';
  sb.ConnectPipe._pubCache = {};
  sb.ConnectPipe._recCache = {};
  sb.ConnectPipe._billedKnown = null;
  sb.ConnectPipe._billedSession = {};
  sb.ConnectPipe._photoCache = {};
  sb.ConnectPipe._lastPullAt = 0;
  sb.ConnectPipe._crewCache = null;
  sb.ConnectPipe._peerCache = null;
}
function flush() {
  return new Promise((res) => { let n = 0; (function step() { if (++n > 40) return res(); setTimeout(step, 0); })(); });
}
const CP = () => sb.ConnectPipe;
const recDoc = () => db._col('sharedrecords').get('uid-driver');
const billDoc = (viewer) => db._col('sharedbilling').get('uid-driver_' + viewer);
const dayDoc = (uid, date) => db._col('shareddays').get(uid + '_' + date);

(async function main() {
  /* ============ (a) records publish ============ */
  console.log('(a) UP — the shared records (fuel / expenses / maintenance)');
  asUser(users.driver);
  eq('a: publishRecords writes', await CP().publishRecords(), true);
  const rec = recDoc();
  check('a: the records doc exists', !!rec);
  keysEq('a: records doc carries facts only (exact key set)', rec,
    ['driver', 'driverName', 'driverBusiness', 'viewers', 'fuel', 'expenses', 'maintenance', 'updatedAt']);
  eq('a: viewers = my CURRENT connections, both payers', rec.viewers, ['uid-boss', 'uid-payer2']);
  eq('a: identity rides (name + business)', [rec.driverName, rec.driverBusiness], ['Asjad Kamal', 'Asjad Kamal']);
  eq('a: fuel newest first, 2 entries', rec.fuel.map((x) => x.date), [TODAY, OCT15]);
  keysEq('a: a fuel entry is the full receipt DATA (exact key set)', rec.fuel[0],
    ['date', 'time', 'station', 'litres', 'cost', 'pricePerLitre', 'odo', 'photoRef', 'photoKey']);
  eq('a: receipt data — station/litres/total/$ per L/odo',
    [rec.fuel[0].station, rec.fuel[0].litres, rec.fuel[0].cost, rec.fuel[0].pricePerLitre, rec.fuel[0].odo],
    ['Petro-Canada 4949 Barlow Tr SE', 64.096, 146.72, 2.289, 169300]);
  eq('a: the photo is a REFERENCE here, never bytes',
    [rec.fuel[0].photoRef, typeof rec.fuel[0].photoKey, JSON.stringify(rec).indexOf('PHOTOSECRET') === -1],
    [true, 'string', true]);
  eq('a: a fill without a photo says so', [rec.fuel[1].photoRef, rec.fuel[1].photoKey], [false, null]);
  eq('a: expenses ride itemized', rec.expenses, [
    { date: OCT16, what: 'Truck wash', cost: 25 },
    { date: '2026-10-10', what: 'DEF fluid', cost: 18.5 }
  ]);
  eq('a: maintenance — odometer + next service + annual expiry',
    [rec.maintenance.odometer, rec.maintenance.nextServiceOdo, rec.maintenance.nextServiceDate, rec.maintenance.annualExpiry],
    [169300, 175429, '2026-11-27', '2027-05-31']);
  eq('a: maintenance — recent services ride', rec.maintenance.services.map((s) => s.type), ['Oil change']);
  const writesAfterFirst = db.writes;
  eq('a: republish of unchanged facts writes nothing', await CP().publishRecords(), false);
  eq('a: write count unchanged (content guard)', db.writes, writesAfterFirst);

  /* ============ (b) receipt photos ============ */
  console.log('(b) receipt photos — sharedphotos');
  const fillKey = CP().fillKey(users.driver.store.get('fuel_fills', [])[0]);
  const photoDoc = db._col('sharedphotos').get('uid-driver_' + fillKey);
  check('b: one photo doc for the one photo fill', !!photoDoc);
  eq('b: the photo doc carries the RENDITION, not the stored original',
    [photoDoc.photo, JSON.stringify(photoDoc).indexOf('PHOTOSECRET') === -1], ['data:image/jpeg;base64,RENDITION', true]);
  eq('b: photo doc viewers = the same current connections', photoDoc.viewers, ['uid-boss', 'uid-payer2']);
  eq('b: exactly one photo doc exists', db._col('sharedphotos').size, 1);
  /* the fill loses its photo -> the rendition is pruned */
  const fillsNow = users.driver.store.get('fuel_fills', []);
  fillsNow[0] = Object.assign({}, fillsNow[0], { photo: null });
  users.driver.store.set('fuel_fills', fillsNow);
  await CP().publishRecords();
  eq('b: superseded rendition pruned by its owner', db._col('sharedphotos').size, 0);
  eq('b: the records doc now shows no photo ref', recDoc().fuel[0].photoRef, false);
  /* restore the photo for the surface sections */
  fillsNow[0] = Object.assign({}, fillsNow[0], { photo: PHOTO });
  users.driver.store.set('fuel_fills', fillsNow);
  await CP().publishRecords();
  eq('b: photo restored + republished', db._col('sharedphotos').size, 1);

  /* ============ (c) billing split ============ */
  console.log('(c) billing — invoices + manifests, bill-to matched per payer');
  const bBoss = billDoc('uid-boss');
  const bP2 = billDoc('uid-payer2');
  check('c: both payers have a billing doc', !!bBoss && !!bP2);
  keysEq('c: billing doc shape (exact key set)', bBoss,
    ['driver', 'viewer', 'driverName', 'driverBusiness', 'invoices', 'manifests', 'updatedAt']);
  eq('c: the boss doc carries ONLY his invoice', bBoss.invoices.map((i) => i.no), ['1151']);
  eq('c: payer2 doc carries ONLY his invoice', bP2.invoices.map((i) => i.no), ['2000']);
  eq('c: the other customer never appears in the boss doc',
    JSON.stringify(bBoss).indexOf('Other Customer') === -1, true);
  eq('c: AI Trucking never appears in payer2 doc',
    JSON.stringify(bP2).indexOf('AI Trucking') === -1, true);
  eq('c: invoice summary — number/period/hours/amount/status',
    [bBoss.invoices[0].no, bBoss.invoices[0].pa, bBoss.invoices[0].pb, bBoss.invoices[0].hours, bBoss.invoices[0].total, bBoss.invoices[0].status, bBoss.invoices[0].balance],
    ['1151', OCT1, OCT15, 124.5, 3610.5, 'Issued', 3610.5]);
  eq('c: the document payload rides (company + lines + tax facts)',
    [bBoss.invoices[0].doc.company.name, bBoss.invoices[0].doc.company.gst, bBoss.invoices[0].doc.revLines.length, bBoss.invoices[0].doc.taxIncluded],
    ['Asjad Kamal', '76566 2010 RT0001', 1, true]);
  eq('c: the settled-outside record crossed to NOBODY',
    [bBoss, bP2].every((b) => b.invoices.every((i) => i.no !== '1149')), true);
  eq('c: payer2 invoice summary', [bP2.invoices[0].hours, bP2.invoices[0].total, bP2.invoices[0].status], [10, 500, 'Issued']);
  eq('c: the manifest rides with the billed period', bBoss.manifests.map((m) => m.pa + '_' + m.pb), [OCT1 + '_' + OCT15]);
  eq('c: manifest days carry the manifest module\u2019s own printed lines',
    [bBoss.manifests[0].days[0].date, bBoss.manifests[0].days[0].lines[0].k],
    [OCT1, 'title']);
  check('c: manifest title line is the document\u2019s own',
    bBoss.manifests[0].days[0].lines[0].a.indexOf('MANIFEST — ' + OCT1) !== -1);
  eq('c: payer2 (September period, no day records) gets no manifest', bP2.manifests, []);
  /* the payer renders/prints the DRIVER'S document from the payload */
  const docHtml = sb.Meticulous.shared.invoiceDocHtml(bBoss.invoices[0].doc);
  check('c: payer-side render is the driver\u2019s document (number, bill-to, total, GST #)',
    docHtml.indexOf('INVOICE #1151') !== -1 && docHtml.indexOf('AI Trucking') !== -1 &&
    docHtml.indexOf('$3610.50') !== -1 && docHtml.indexOf('76566 2010 RT0001') !== -1);
  sb.printDocCalls = [];
  sb.Meticulous.shared.printInvoiceDoc(bBoss.invoices[0].doc);
  eq('c: payer-side print composes through the same printDoc door',
    [sb.printDocCalls.length, sb.printDocCalls[0].title, sb.printDocCalls[0].html === docHtml],
    [1, 'Invoice 1151', true]);
  /* the payer-side reads */
  asUser(users.boss);
  const bossFetch = await CP().fetchRecords();
  eq('c: boss fetchRecords — records + his billing only',
    [bossFetch.records['uid-driver'].fuel.length, bossFetch.billing['uid-driver'].invoices.map((i) => i.no)],
    [2, ['1151']]);
  asUser(users.payer2);
  const p2Fetch = await CP().fetchRecords();
  eq('c: payer2 fetchRecords — his billing only',
    p2Fetch.billing['uid-driver'].invoices.map((i) => i.no), ['2000']);
  asUser(users.stranger);
  eq('c: a stranger with no connections fetches nothing', await CP().fetchRecords(), { records: {}, billing: {} });
  const photoBack = await (async () => { asUser(users.boss); return CP().fetchPhoto('uid-driver', fillKey); })();
  eq('c: the payer can pull the receipt photo by its key', photoBack, 'data:image/jpeg;base64,RENDITION');

  /* ============ (d) rules posture ============ */
  console.log('(d) rules — posture statics + the behavioural read matrix');
  const recBlock = rulesSrc.slice(rulesSrc.indexOf('match /sharedrecords/'), rulesSrc.indexOf('match /sharedbilling/'));
  const billBlock = rulesSrc.slice(rulesSrc.indexOf('match /sharedbilling/'), rulesSrc.indexOf('match /sharedphotos/'));
  const photoBlock = rulesSrc.slice(rulesSrc.indexOf('match /sharedphotos/'), rulesSrc.indexOf('// No other paths'));
  check('d: sharedrecords readable by the driver + named viewers only',
    recBlock.indexOf('request.auth.uid == resource.data.driver') !== -1 &&
    recBlock.indexOf('request.auth.uid in resource.data.viewers') !== -1);
  check('d: sharedrecords writable only by the driver it describes (doc id bound)',
    recBlock.indexOf('request.auth.uid == request.resource.data.driver') !== -1 &&
    recBlock.indexOf('request.auth.uid == driverId') !== -1 &&
    recBlock.indexOf('request.resource.data.viewers is list') !== -1);
  check('d: sharedrecords never deletable', recBlock.indexOf('allow delete: if false;') !== -1);
  check('d: sharedbilling readable by the driver + the ONE named viewer only',
    billBlock.indexOf('request.auth.uid == resource.data.driver') !== -1 &&
    billBlock.indexOf('request.auth.uid == resource.data.viewer') !== -1);
  check('d: sharedbilling driver/viewer immutable, writer = driver only',
    billBlock.indexOf('request.resource.data.driver == resource.data.driver') !== -1 &&
    billBlock.indexOf('request.resource.data.viewer == resource.data.viewer') !== -1 &&
    billBlock.indexOf('allow delete: if false;') !== -1);
  check('d: sharedphotos readable by driver + named viewers; delete is the owner\u2019s prune only',
    photoBlock.indexOf('request.auth.uid in resource.data.viewers') !== -1 &&
    photoBlock.indexOf('allow delete: if request.auth != null') !== -1 &&
    photoBlock.indexOf('request.auth.uid == resource.data.driver;') !== -1);
  check('d: nothing in the new collections is world-readable',
    (recBlock + billBlock + photoBlock).indexOf('allow read: if true') === -1 &&
    (recBlock + billBlock + photoBlock).indexOf('request.auth == null') === -1);
  /* behavioural matrix over the REAL published docs, mirroring
     the shipped rule predicates (the statics above pin the
     predicates themselves to the rules file) */
  const canReadRec = (doc, uid) => !!doc && (uid === doc.driver || (doc.viewers || []).indexOf(uid) !== -1);
  const canReadBill = (doc, uid) => !!doc && (uid === doc.driver || uid === doc.viewer);
  eq('d: read matrix — records (driver/boss/payer2/stranger)',
    [canReadRec(recDoc(), 'uid-driver'), canReadRec(recDoc(), 'uid-boss'), canReadRec(recDoc(), 'uid-payer2'), canReadRec(recDoc(), 'uid-stranger')],
    [true, true, true, false]);
  eq('d: read matrix — boss billing (boss yes, payer2 NO, stranger NO)',
    [canReadBill(billDoc('uid-boss'), 'uid-boss'), canReadBill(billDoc('uid-boss'), 'uid-payer2'), canReadBill(billDoc('uid-boss'), 'uid-stranger')],
    [true, false, false]);
  eq('d: read matrix — payer2 billing (payer2 yes, boss NO)',
    [canReadBill(billDoc('uid-payer2'), 'uid-payer2'), canReadBill(billDoc('uid-payer2'), 'uid-boss')],
    [true, false]);

  /* ============ (e) payer surface — the P&L crew card ============ */
  console.log('(e) payer surface — P&L crew card from the shared records');
  asUser(users.driver);
  eq('e: the driver publishes today\u2019s day', await CP().publishDay(TODAY), true);
  asUser(users.boss);
  const pnlBody = new FakeEl('body');
  sb.Meticulous.modules.pnl.render(pnlBody);
  await flush();
  const crewHtmlOut = (pnlBody._kids['#pnl_crew'] || {})._html || '';
  check('e: crew card names the driver + priced day (revenue at client rate, wages at his pay rate)',
    crewHtmlOut.indexOf('Asjad Kamal') !== -1 && crewHtmlOut.indexOf('$520.00') !== -1 && crewHtmlOut.indexOf('$319.00') !== -1);
  check('e: his fuel rows — the full receipt data',
    crewHtmlOut.indexOf('Petro-Canada 4949 Barlow Tr SE') !== -1 &&
    crewHtmlOut.indexOf('64.096 L') !== -1 && crewHtmlOut.indexOf('$146.72') !== -1 &&
    crewHtmlOut.indexOf('$2.289/L') !== -1);
  check('e: the receipt photo is one tap away', crewHtmlOut.indexOf('data-pnlphoto="uid-driver:') !== -1);
  check('e: his expenses itemized', crewHtmlOut.indexOf('Truck wash') !== -1 && crewHtmlOut.indexOf('$25.00') !== -1);
  check('e: his maintenance record — odometer, next service, annual expiry',
    crewHtmlOut.indexOf('169,300 km') !== -1 && crewHtmlOut.indexOf('175,429 km') !== -1 &&
    crewHtmlOut.indexOf('2027-05-31') !== -1 && crewHtmlOut.indexOf('Oil change') !== -1);
  check('e: his pay invoice billed to this payer — row + view/print + manifest doors',
    crewHtmlOut.indexOf('Invoice #1151') !== -1 && crewHtmlOut.indexOf('$3610.50') !== -1 &&
    crewHtmlOut.indexOf('data-pnlinv="uid-driver:inv1"') !== -1 &&
    crewHtmlOut.indexOf('data-pnlman="uid-driver:' + OCT1 + '_' + OCT15 + '"') !== -1);
  check('e: the other customer\u2019s invoice is NOT on this payer\u2019s card',
    crewHtmlOut.indexOf('#2000') === -1 && crewHtmlOut.indexOf('Other Customer') === -1);
  check('e: after the fetch lands, the totals repaint WITH the crew wages attributed',
    pnlBody._html.indexOf('Connected crew wages') !== -1 &&
    pnlBody._html.indexOf('Asjad Kamal (Connect)') !== -1);

  /* ============ (f) the P&L pay-expense leg ============ */
  console.log('(f) P&L leg — derived crew wages in the expense totals');
  const PNL = sb.Meticulous.modules.pnl;
  const calcBoss = () => PNL._calc('2026-10');
  eq('f: e2e — the real fetched day prices into the totals (11 h × $29)',
    [calcBoss().crewWages, calcBoss().crewWagesByDriver['uid-driver'].wage, calcBoss().crewWagesByDriver['uid-driver'].days],
    [319, 319, 1]);
  eq('f: expenses carry exactly the crew wages (empty local books)', calcBoss().expenses, 319);
  const trackerDay = {
    driver: 'uid-driver', date: OCT16, driverName: 'Asjad Kamal', driverBusiness: 'Asjad Kamal',
    viewers: ['uid-boss'], session: { hours: 7.01, active: false, startedAt: null, endedAt: null, km: 134 },
    dispatches: [], close: { source: 'tracker', foremanHours: 7.01, travelHours: 0, bonusHours: 0, loads: 0, material: 'Clay', ticketNo: '21621' },
    loads: 0, ticketsClosed: 0, updatedAt: Date.now()
  };
  users.boss.store.set('__crew_days', { '2026-10': [trackerDay] });
  eq('f: a tracker-closed day prices from its close facts (7.01 × $29)', calcBoss().crewWages, 203.29);
  eq('f: idempotent — a second calc is the same number, never stacked',
    [calcBoss().crewWages, calcBoss().expenses], [203.29, 203.29]);
  const correctedDay = clone(trackerDay);
  correctedDay.close = { source: 'dispatch', foremanHours: 8, travelHours: 1, bonusHours: 1, loads: 0, material: 'Clay', ticketNo: '21621' };
  users.boss.store.set('__crew_days', { '2026-10': [correctedDay] });
  eq('f: a corrected day RE-prices (8+1+1 × $29 = 290, not 203.29 + 290)', calcBoss().crewWages, 290);
  const driversSave = users.boss.store.get('pnl_drivers', []);
  users.boss.store.set('pnl_drivers', []);
  eq('f: rate unset -> $0, exactly as the board shows', [calcBoss().crewWages, calcBoss().expenses], [0, 0]);
  users.boss.store.set('pnl_drivers', driversSave);
  eq('f: rate set again -> priced again', calcBoss().crewWages, 290);
  /* non-Connect account: identical local books, no pipe at all */
  const noPipe = (() => {
    const seed = {
      onboarding: { companyName: 'AI Trucking', accountType: 'Fleet Manager', billingRate: 52, payRate: 40 },
      rev_entries: [{ date: '2026-10-05', type: 'hourly', hours: '10', amount: '290.00', note: 'Manual work' }],
      fuel_fills: [{ date: '2026-10-05', litres: 50, cost: 100, station: 'Petro' }]
    };
    const store2 = makeStore(seed);
    const sb2 = { window: {}, Meticulous: { modules: {} }, console: console,
      App: { _store: store2, _esc: sb.esc, _today: () => TODAY } };
    vm.createContext(sb2);
    vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb2);
    vm.runInContext(pnlSrc, sb2);
    return sb2.Meticulous.modules.pnl._calc('2026-10');
  })();
  users.boss.store.set('rev_entries', [{ date: '2026-10-05', type: 'hourly', hours: '10', amount: '290.00', note: 'Manual work' }]);
  users.boss.store.set('fuel_fills', [{ date: '2026-10-05', litres: 50, cost: 100, station: 'Petro' }]);
  users.boss.store.del('__crew_days');
  const bossNoCache = calcBoss();
  eq('f: no crew cache -> crewWages 0 and every figure equals the no-Connect account',
    [bossNoCache.income, bossNoCache.expenses, bossNoCache.net, bossNoCache.wages, bossNoCache.fuel, bossNoCache.crewWages],
    [noPipe.income, noPipe.expenses, noPipe.net, noPipe.wages, noPipe.fuel, 0]);

  /* ============ (g) close facts — the 21:41 priority fix ============ */
  console.log('(g) close facts — tracker close / dispatch close / precedence / correction');
  asUser(users.boss);
  const pricing = CP().pricingFor('uid-driver');
  eq('g: payer pricing (client rate + his pay rate)', [pricing.clientRate, pricing.wage.rate], [52, 29]);
  asUser(users.driver);
  const d16 = CP().buildDay(OCT16);
  eq('g: tracker-closed day — the close facts ARE the day sheet\u2019s split',
    d16.close, { source: 'tracker', foremanHours: 7.01, travelHours: 0, bonusHours: 0, loads: 0, material: 'Clay', ticketNo: '21621' });
  const p16 = CP().priceDay(d16, pricing);
  eq('g: the day PRICES now (revenue 7.01 × $52, wage 7.01 × $29)',
    [p16.revenue, p16.wage, p16.rows.some((r) => !!r.close)], [364.52, 203.29, true]);
  eq('g: publishDay writes the close facts', await CP().publishDay(OCT16), true);
  eq('g: the published record carries them', dayDoc('uid-driver', OCT16).close.foremanHours, 7.01);
  const dT = CP().buildDay(TODAY);
  const pT = CP().priceDay(dT, pricing);
  eq('g: dispatch-closed day unchanged (ticket leg: 520 revenue / 319 wage, no close row)',
    [dT.close.source, pT.revenue, pT.wage, pT.rows.every((r) => !r.close)], ['dispatch', 520, 319, true]);
  /* both exist: a completion entry lands beside the tracker entry —
     the completion wins, exactly as the books print it */
  const revSave = users.driver.store.get('rev_entries', []);
  users.driver.store.set('rev_entries', revSave.concat([
    { date: OCT16, type: 'hourly', hours: '9', amount: '261.00', note: 'Dispatch: Aecon Inf · foreman 8h', foremanHours: 8, travelHours: 1 }
  ]));
  const cfBoth = CP().buildCloseFacts(OCT16, 7.01);
  eq('g: both-exist precedence — the completion\u2019s split wins over the tracker entry',
    [cfBoth.source, cfBoth.foremanHours, cfBoth.travelHours], ['dispatch', 8, 1]);
  users.driver.store.set('rev_entries', revSave);
  /* correction re-publish: Oct 15 closes at 7.01 tracker hours,
     then the close is corrected to foreman 8 + travel 1 + bonus 1 */
  const sessSave = users.driver.store.get('sessions', []);
  users.driver.store.set('sessions', sessSave.concat([
    { date: OCT15, seconds: 25236, endedAt: new Date(Date.now() - 9000e3).toISOString(), liveKm: 121 }
  ]));
  users.driver.store.set('rev_entries', revSave.concat([
    { date: OCT15, type: 'hourly', hours: '7.01', amount: '203.29', note: 'Auto from tracker', auto: true }
  ]));
  eq('g: Oct 15 publishes with the tracker close', await CP().publishDay(OCT15), true);
  eq('g: ...at 7.01 foreman', dayDoc('uid-driver', OCT15).close.foremanHours, 7.01);
  users.driver.store.set('rev_entries', revSave.concat([
    { date: OCT15, type: 'hourly', hours: '10', amount: '290.00', note: 'Dispatch: Aecon Inf · corrected close', foremanHours: 8, travelHours: 1, bonusHours: 1 }
  ]));
  asUser(users.driver); /* a fresh app session: guards reset, facts differ -> write */
  eq('g: the corrected close re-publishes', await CP().publishDay(OCT15), true);
  eq('g: the payer-side record shows the CORRECTED split',
    dayDoc('uid-driver', OCT15).close, { source: 'dispatch', foremanHours: 8, travelHours: 1, bonusHours: 1, loads: 0, material: '', ticketNo: '' });
  eq('g: the corrected day prices at 10 h × $29 = $290',
    CP().priceDay(dayDoc('uid-driver', OCT15), pricing).wage, 290);
  /* the payer's Crew board card for the tracker-closed day */
  vm.runInContext(extractRegion(dspSrc, 'DSP-PIPE-BEGIN', 'DSP-PIPE-END'), sb);
  asUser(users.boss);
  sb.pipeDays = [dayDoc('uid-driver', OCT16)];
  sb.pipeRecords = {}; sb.pipeBilling = {};
  const card = sb.crewHtml();
  check('g: the card shows the close — hours, card #, day-sheet wording',
    card.indexOf('Hours — 7.01 foreman') !== -1 && card.indexOf('#21621') !== -1 &&
    card.indexOf('closed on his day sheet') !== -1 && card.indexOf('$203.29') !== -1);
  check('g: the card never says the screenshot\u2019s lies',
    card.indexOf('no tickets closed yet') === -1 && card.indexOf('0.0 foreman') === -1);

  /* ============ (h) revoke / prune ============ */
  console.log('(h) revoke — viewers pruned, billing emptied');
  asUser(users.driver); /* fresh session: the billing seed reads the cloud */
  const bossOnly = [users.driver.store.get('con_list', [])[0]];
  users.driver.store.set('con_list', bossOnly);
  await CP().publishRecords();
  eq('h: the removed payer leaves the viewers list', recDoc().viewers, ['uid-boss']);
  eq('h: his billing doc is emptied (nothing lingers)', billDoc('uid-payer2').invoices, []);
  eq('h: the remaining payer\u2019s billing is untouched', billDoc('uid-boss').invoices.map((i) => i.no), ['1151']);
  users.driver.store.set('con_list', []);
  await CP().publishRecords();
  eq('h: the last peer leaving empties the viewers list', recDoc().viewers, []);
  const photoKey2 = CP().fillKey(users.driver.store.get('fuel_fills', [])[0]);
  eq('h: receipt renditions stop naming viewers too',
    db._col('sharedphotos').get('uid-driver_' + photoKey2).viewers, []);

  /* ============ (i) statics ============ */
  console.log('(i) statics — hooks, pins, locality');
  /* v149 pin move (the standing convention): the OTA number only
     moves forward, so this suite's ship pins follow the live
     version 148 -> 149. */
  check('i: version ships as 149', ver.webVersion === 149);
  check('i: index loads the touched files at the 149 pin',
    idxSrc.indexOf('js/connectpipe.js?v=149') !== -1 &&
    idxSrc.indexOf('modules/pnl.js?v=149') !== -1 &&
    idxSrc.indexOf('modules/dispatch.js?v=149') !== -1 &&
    idxSrc.indexOf('modules/invoice.js?v=149') !== -1);
  check('i: publish hooks ride the module lifecycles (fuel / maintenance / invoice renders)',
    fuelSrc.indexOf('ConnectPipe.publishRecords()') !== -1 &&
    mtSrc.indexOf('ConnectPipe.publishRecords()') !== -1 &&
    invSrc.indexOf('ConnectPipe.publishRecords()') !== -1);
  check('i: Connect open publishes everything (publishAll)', conSrc.indexOf('ConnectPipe.publishAll()') !== -1);
  check('i: the manifest doors the pipe reads exist', manSrc.indexOf('_collectDay: collect') !== -1 && manSrc.indexOf('_docLines: docLines') !== -1);
  check('i: the crew-day cache is a local-only __ key, and CloudSync never carries __ keys',
    pnlSrc.indexOf("'__crew_days'") !== -1 && cloudSrc.indexOf("indexOf('__') !== 0") !== -1);
  check('i: the pipe exposes the v146 surface',
    cpSrc.indexOf('CP.publishRecords') !== -1 && cpSrc.indexOf('CP.fetchRecords') !== -1 &&
    cpSrc.indexOf('CP.buildCloseFacts') !== -1 && cpSrc.indexOf("collection('sharedrecords')") !== -1 &&
    cpSrc.indexOf("collection('sharedbilling')") !== -1 && cpSrc.indexOf("collection('sharedphotos')") !== -1);

  console.log('\nconnect-share-v146 test: ' + pass + '/' + (pass + fail) + ' passed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
