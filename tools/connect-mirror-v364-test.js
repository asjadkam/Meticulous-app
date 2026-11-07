#!/usr/bin/env node
/* Meticulous v364 — CONNECT-ALL DASHBOARD MIRROR + ROLE GATE suite
 * (v364: MIRROR-DIRECTION-BACKWARDS, owner Nov 7, 2026 09:57 MDT —
 * the picker exists ONLY on the receiving side of a share; see
 * the (j) blocks. Everything else is the v358 suite, kept whole.)
 * (v358 correction, owner Nov 7, 2026 08:24 MDT — supersedes the
 * 08:18 read: mirror scope = EVERYTHING the driver sees,
 * Navigator included, Documents carried as an honest gap face;
 * the ONLY exclusion anywhere is the live work TIMER. On the
 * office-only account's own dashboard the Navigator is NOT
 * stripped — the timer/tracker face + odometer prompts are.)
 * (owner, Nov 7, 2026 08:12 + 08:18 MDT).
 *
 * The mirror: a payer with a Connect All connection picks a driver
 * on ONE dashboard control ("Whose book is on screen", default
 * Mine) and the covered modules — Revenue, Dispatch, Fuel &
 * Expense, Maintenance, PTI, Damage & Incident, Manifest — open
 * on that driver's PUBLISHED book (shareddays / sharedrecords /
 * sharedbilling / sharedphotos, read through the real
 * js/connectpipe.js), read-only, under a persistent banner.
 * Limited peers never enter the picker. The role gate: an
 * office-only account (does not drive) gets NO timer card, NO
 * Navigator card, NO odometer prompts on its own dashboard.
 *
 * Runs the REAL shipped code: js/connectpipe.js whole,
 * js/mirror.js whole, the ROLE region + buildDashboard extracted
 * verbatim from js/app.js, over a fake Firestore and a memory
 * store. Covers:
 *  (a) the picker set: only 'all' + live 'once' peers appear —
 *      limited and pending peers never do; no All peer -> no bar
 *  (b) setView discipline: a limited/unknown uid is refused;
 *      Mine restores; the pick persists as the payer's own
 *      mirror_view key and nothing else is written
 *  (c) the banner: names the driver + read-only while active,
 *      hidden at Mine
 *  (d) the module faces read the published docs: dispatch days,
 *      revenue priced at the driver's OWN wage (the priced wage
 *      leg) + his invoices to this payer, fuel + expenses +
 *      receipt photo fetch, maintenance, PTI, damage
 *  (e) the manifest law in mirror: hours come from the day's
 *      revenue-record facts (ticket close / day close) — the
 *      poisoned session hours (99 h / 50 h) NEVER surface; places
 *      by name; the multi-day table + totals
 *  (f) read-only proof: every button in every mirrored face is a
 *      photo fetch; NO store book key changes on either side and
 *      the fake Firestore records ZERO writes across all renders
 *  (g) driver isolation: driver B's face shows B's data only;
 *      switching back to Mine ends the mirror
 *  (h) the role gate on the viewer's own dashboard (real
 *      buildDashboard + the real role region): office-only ->
 *      tracker hidden, no Navigator/Revenue/Fuel cards, office
 *      tools present; driver -> unchanged; the v177 stamp heal
 *      (Fleet Manager + unmarked 'both') resolves office; a
 *      genuinely stored 'driver' still rules (the Oct 17 shape)
 *  (i) statics: the openModule mirror hook + office Navigator
 *      door, the odometer / bubble / park gates, the index.html
 *      chrome (bar, banner, script tag), version pins + hashes
 *  (j) v364 DIRECTION: the picker is gated on CP.receivingFrom —
 *      published-doc evidence that a peer shares TO this account.
 *      A driver-only world (the Nov 7 phone: All pairs are owners
 *      he sends TO; his own day docs publish under his uid and
 *      name those owners as viewers) renders NO picker at all;
 *      an owner-operator world lists only the driver sharing to
 *      him, never his owner; the evidence is one-way (a narrowed
 *      re-probe never un-proves) while kind/status stay live (a
 *      flip to Limited still falls out).
 * Run: node tools/connect-mirror-v364-test.js (supersedes the v358 suite)
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const cpSrc = read('js/connectpipe.js');
const mirSrc = read('js/mirror.js');
const appSrc = read('js/app.js');
const parkSrc = read('js/parkplace.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function section(s) { console.log('— ' + s + ' —'); }
const clone = (v) => JSON.parse(JSON.stringify(v));
function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function extractRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}

/* ---------------- fake Firestore (compat shape) ---------------- */
function FakeDb() { this.cols = {}; this.writes = 0; }
FakeDb.prototype._col = function (name) { return this.cols[name] || (this.cols[name] = new Map()); };
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
      delete: () => { db.writes++; db._col(name).delete(id); return Promise.resolve(); }
    })
  });
};

/* ---------------- fake store / DOM ---------------- */
function makeStore(seed) {
  const m = new Map(Object.entries(clone(seed || {})));
  return {
    get: (k, d) => (m.has(k) ? clone(m.get(k)) : d),
    set: (k, v) => { m.set(k, clone(v)); return true; },
    del: (k) => { m.delete(k); return true; },
    _map: m
  };
}
function mkStubEl() {
  const classes = new Set();
  const el = {
    innerHTML: '', textContent: '', value: '', style: {}, disabled: false, onclick: null, onchange: null,
    classList: {
      add: function (c) { classes.add(c); },
      remove: function (c) { classes.delete(c); },
      toggle: function (c, force) { if (force === undefined) force = !classes.has(c); if (force) classes.add(c); else classes.delete(c); },
      contains: function (c) { return classes.has(c); }
    },
    _qs: {},
    /* reuse ONE stub per element across querySelector calls,
       mirroring the real DOM — wirePhotos assigns onclick on
       the node querySelectorAll fabricates, and a later
       querySelectorAll must return that same node */
    querySelector: function (sel) { return el._qs[sel] || (el._qs[sel] = mkStubEl()); },
    querySelectorAll: function (sel) {
      const key = 'qsa:' + sel;
      if (!el._qs[key]) {
        const peer = el._qs['qsaPeer:' + sel];
        el._qs[key] = peer ? [peer] : [];
      }
      return el._qs[key];
    },
    setAttribute: function () {}, getAttribute: function () { return null; },
    addEventListener: function () {}
  };
  return el;
}
/* A module body: innerHTML paint + .mr-photo buttons fabricated
   from the painted markup, each with a parent exposing its slot. */
function makeBody() {
  const body = { _html: '', _photoBtns: null };
  Object.defineProperty(body, 'innerHTML', {
    get: function () { return body._html; },
    set: function (v) { body._html = String(v); body._photoBtns = null; }
  });
  body.querySelector = function (sel) {
    /* the body's photo buttons are the same nodes mirror's
       wirePhotos (querySelectorAll('.mr-photo')) wired — a
       query for a photo button returns the first of them */
    if (sel === '.mr-photo') {
      const all = body.querySelectorAll('.mr-photo');
      return all.length ? all[0] : mkStubEl();
    }
    return mkStubEl();
  };
  body.querySelectorAll = function (sel) {
    if (sel !== '.mr-photo') return [];
    if (body._photoBtns) return body._photoBtns;
    const out = [];
    const re = /<button[^>]*class="[^"]*mr-photo[^"]*"[^>]*data-mrphoto="([^"]*)"/g;
    let mm;
    while ((mm = re.exec(body._html))) {
      const slot = mkStubEl();
      const btn = mkStubEl();
      btn._key = mm[1];
      btn.getAttribute = function (k) { return k === 'data-mrphoto' ? btn._key : null; };
      btn.parentNode = { querySelector: function (s) { return s === '.mr-slot' ? slot : null; } };
      btn._slot = slot;
      out.push(btn);
    }
    body._photoBtns = out;
    return out;
  };
  return body;
}

/* ---------------- the published docs (builder shapes) --------- */
const TODAY = '2026-11-07';
function seedDb() {
  const db = new FakeDb();
  const days = db._col('shareddays');
  days.set('drvA_2026-11-05', {
    driver: 'drvA', date: '2026-11-05', driverName: 'Asjad Kamal', driverBusiness: 'Ai Trucking',
    viewers: ['boss1'],
    session: { hours: 99, km: 221, active: false, startedAt: null, endedAt: null },
    dispatches: [{
      id: 'd1', origin: 'boss', sentBy: 'boss1', pipeId: 'p1', sourceLabel: '',
      jobSite: 'Aecon Trans', date: '2026-11-05', scheduledAt: '2026-11-05T09:00', equipment: 'Tandem',
      material: 'clay', ticketNo: '23769', notes: '', status: 'completed',
      startedAt: null, closedAt: null, foremanHours: 9, travelHours: 1, travelBillable: false,
      loads: 6, netWeight: 0, tickets: [], photoRef: false
    }],
    close: null, loads: 6, ticketsClosed: 1, updatedAt: 1
  });
  days.set('drvA_2026-11-06', {
    driver: 'drvA', date: '2026-11-06', driverName: 'Asjad Kamal', driverBusiness: 'Ai Trucking',
    viewers: ['boss1'],
    session: { hours: 50, km: 100, active: false, startedAt: null, endedAt: null },
    dispatches: [],
    close: { source: 'revenue', foremanHours: 5, travelHours: 1, bonusHours: 0, loads: 3, material: '', ticketNo: '' },
    loads: 3, ticketsClosed: 0, updatedAt: 1
  });
  days.set('drvA_2026-11-07', {
    driver: 'drvA', date: '2026-11-07', driverName: 'Asjad Kamal', driverBusiness: 'Ai Trucking',
    viewers: ['boss1'],
    session: { hours: 0, km: null, active: false, startedAt: null, endedAt: null },
    dispatches: [{
      id: 'd2', origin: 'boss', sentBy: 'boss1', pipeId: 'p2', sourceLabel: '',
      jobSite: 'Aecon Trans', date: '2026-11-07', scheduledAt: '2026-11-07T08:00', equipment: 'Tandem',
      material: '', ticketNo: '', notes: '', status: 'saved',
      startedAt: null, closedAt: null, foremanHours: 0, travelHours: 0, travelBillable: false,
      loads: 0, netWeight: 0, tickets: [], photoRef: false
    }],
    close: null, loads: 0, ticketsClosed: 0, updatedAt: 1
  });
  days.set('drvB_2026-11-05', {
    driver: 'drvB', date: '2026-11-05', driverName: 'Second Driver', driverBusiness: '',
    viewers: ['boss1'],
    session: { hours: 4, km: 60, active: false, startedAt: null, endedAt: null },
    dispatches: [{
      id: 'd9', origin: 'driver', sentBy: '', pipeId: '', sourceLabel: '',
      jobSite: 'Other Site', date: '2026-11-05', scheduledAt: '2026-11-05T07:00', equipment: '',
      material: '', ticketNo: '', notes: '', status: 'completed',
      startedAt: null, closedAt: null, foremanHours: 4, travelHours: 0, travelBillable: false,
      loads: 2, netWeight: 0, tickets: [], photoRef: false
    }],
    close: null, loads: 2, ticketsClosed: 0, updatedAt: 1
  });
  days.set('drvL_2026-11-05', {
    driver: 'drvL', date: '2026-11-05', driverName: 'Limited Lou', driverBusiness: '',
    viewers: ['boss1'],
    session: { hours: 8, km: 80, active: false, startedAt: null, endedAt: null },
    dispatches: [{
      id: 'dL', origin: 'boss', sentBy: 'boss1', pipeId: 'pL', sourceLabel: '',
      jobSite: 'Limited Site', date: '2026-11-05', scheduledAt: '2026-11-05T08:00', equipment: '',
      material: '', ticketNo: '', notes: '', status: 'completed',
      startedAt: null, closedAt: null, foremanHours: 8, travelHours: 0, travelBillable: false,
      loads: 5, netWeight: 0, tickets: [], photoRef: false
    }],
    close: null, loads: 5, ticketsClosed: 0, updatedAt: 1
  });
  const recs = db._col('sharedrecords');
  recs.set('drvA', {
    driver: 'drvA', driverName: 'Asjad Kamal', driverBusiness: 'Ai Trucking', viewers: ['boss1'],
    fuel: [{ date: '2026-11-05', time: '19:59', station: 'Shell', litres: 91.915, cost: 199.36, pricePerLitre: 2.169, odo: 171495, photoRef: true, photoKey: 'fk1' }],
    expenses: [{ date: '2026-11-05', what: 'Tire change', cost: 294 }],
    maintenance: {
      odometer: 171497, nextServiceOdo: 175429, nextServiceDate: '2026-11-27', annualExpiry: '2027-05-31',
      due: [{ name: 'Oil change', dateBased: false, dueAtKm: 175429, remainingKm: 3932, annualDate: '', days: null, overdue: false }],
      services: [{ date: '2026-10-20', type: 'Oil change', odo: 165000, cost: 180, notes: '' }]
    },
    pti: [{ date: '2026-11-05', filedAt: 1, kind: 'pre', signed: true, unit: '7', plate: '04 R209', odometer: 171261, location: '', result: 'pass', driverName: 'Asjad Kamal', defects: [] }],
    damage: [{ date: '2026-11-02', at: '14:00', desc: 'Light pole contact', kind: 'equipment', dispatch: '', photoRef: true, photoKey: 'dk1', photoKeys: ['dk1'] }],
    /* v358: the nav section, exactly as CP.sharedNav now publishes it */
    nav: {
      trips: [
        { date: '2026-09-18', at: '2026-09-18T16:40:00', name: 'Airport Asphalt Plant' },
        { date: '2026-09-18', at: '2026-09-18T07:12:00', name: 'Aecon Trans' }
      ],
      lastDest: 'Aecon Trans'
    },
    driverWage: { payType: 'hourly', rate: 29 },
    updatedAt: 1
  });
  recs.set('drvB', {
    driver: 'drvB', driverName: 'Second Driver', driverBusiness: '', viewers: ['boss1'],
    fuel: [{ date: '2026-11-05', time: '08:00', station: 'Petro-Canada', litres: 50, cost: 100, pricePerLitre: 2, odo: null, photoRef: false, photoKey: null }],
    expenses: [], maintenance: null, pti: [], damage: [], driverWage: null, updatedAt: 1
  });
  const bills = db._col('sharedbilling');
  bills.set('drvA_boss1', {
    driver: 'drvA', viewer: 'boss1', driverName: 'Asjad Kamal', driverBusiness: 'Ai Trucking',
    invoices: [{ id: 'inv1', no: '1154', date: '2026-11-01', billTo: 'AI Trucking', pa: '2026-10-16', pb: '2026-10-31', hours: 107.5, sub: 3117.5, tax: 0, total: 3117.5, paid: 3117.5, balance: 0, status: 'Paid', doc: {} }],
    manifests: [], updatedAt: 1
  });
  const photos = db._col('sharedphotos');
  photos.set('drvA_fk1', { driver: 'drvA', viewers: ['boss1'], photo: 'data:image/jpeg;base64,RECEIPT' });
  photos.set('drvA_dk1', { driver: 'drvA', viewers: ['boss1'], photo: 'data:image/jpeg;base64,DAMAGE' });
  return db;
}

function bossStoreSeed(conList) {
  return {
    con_list: conList,
    onboarding: { billingRate: 93 },
    rev_entries: [{ id: 'mine1', date: '2026-11-05', amount: 500 }],
    dsp_list: [{ id: 'mineD', date: '2026-11-05', jobSite: 'My Own Site' }],
    fuel_fills: [{ id: 'mineF', date: '2026-11-05', litres: 10, cost: 20 }],
    sessions: [{ date: '2026-11-05', seconds: 3600 }]
  };
}
const CON_ALL = [
  { uid: 'drvA', name: 'Asjad Kamal', business: 'Ai Trucking', status: 'connected' },
  { uid: 'drvB', name: 'Second Driver', business: '', status: 'connected', kind: 'once' },
  { uid: 'drvL', name: 'Limited Lou', business: '', status: 'connected', kind: 'limited', modules: ['manifest'] },
  { uid: 'drvP', name: 'Pending Pete', business: '', status: 'pending' }
];

/* v364 (DIRECTION): small async settles. The fake Firestore
   resolves on the microtask queue; a few macrotask turns let the
   direction evidence (CP.receivingFrom) land and its re-paint
   run before a world is read. */
async function settle(n) {
  for (let i = 0; i < (n || 40); i++) await new Promise(function (r) { setTimeout(r, 1); });
}

/* v364 (DIRECTION): a DRIVER-side world — the Nov 7 phone. The
   viewer ('drvMe') holds ConAll pairs with two OWNERS (the
   screenshot's "Osouraya@hotmail.com Hanan*111" / Umar seat and
   Dave Cooper). Everything published points the other way: the
   driver's OWN day docs publish under his uid and name the
   owners as viewers; the owners publish nothing that names
   him. Built through the real CP.buildDay / CP.buildRecords. */
function makeDriverSideWorld() {
  const db = new FakeDb();
  const store = makeStore({
    con_list: [
      { uid: 'ownU', name: 'Osouraya@hotmail.com Hanan*111', business: 'AI Trucking', status: 'connected' },
      { uid: 'ownD', name: 'Dave Cooper', business: '', status: 'connected' }
    ],
    onboarding: { accountType: 'Driver', userRole: 'driver', roleStamped: 'answer' },
    dsp_list: [{
      id: 'dd1', origin: 'driver', jobSite: 'Aecon Trans', date: '2026-11-05',
      scheduledAt: '2026-11-05T09:00', equipment: 'Tandem', material: 'clay',
      ticketNo: '23769', notes: '', status: 'completed',
      tickets: [{ cardNumber: '23769', foremanHours: 9, loads: 6 }]
    }],
    sessions: [{ date: '2026-11-05', seconds: 36000, endedAt: '2026-11-05T19:00:00' }],
    rev_entries: [{ id: 'r1', date: '2026-11-05', note: 'Dispatch: Aecon Trans', foremanHours: 9, travelHours: 1, hours: 10, loads: 6 }],
    fuel_fills: [], fuel_expenses: []
  });
  const els = { mirrorBar: mkStubEl(), mirrorBanner: mkStubEl() };
  els.mirrorBar.classList.add('hidden');
  els.mirrorBanner.classList.add('hidden');
  const sandbox = {
    console: console,
    document: { getElementById: function (id) { return els[id] || null; } },
    FB: { ready: true, user: { uid: 'drvMe' }, db: db },
    App: {
      _store: store,
      _today: function () { return TODAY; },
      _esc: escHtml,
      userRole: function () { return 'driver'; },
      showDashboard: function () {},
      workProfiles: { idOf: function () { return 'p1'; } },
      tracker: null
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(cpSrc, sandbox);
  vm.runInContext(mirSrc, sandbox);
  return { sandbox: sandbox, db: db, store: store, els: els, M: sandbox.Mirror, CP: sandbox.ConnectPipe };
}

/* v364 (DIRECTION): an OWNER-OPERATOR world — he drives AND a
   driver shares TO him. His con_list carries BOTH directions:
   his owner above him ('ownU', an All pair he sends to — his
   own day doc names ownU a viewer, exactly the driver's shape)
   and his driver below him ('drvX', whose day doc names HIM a
   viewer). The picker may list drvX only. */
function makeBothWaysWorld() {
  const db = new FakeDb();
  const days = db._col('shareddays');
  days.set('drvX_2026-11-05', {
    driver: 'drvX', date: '2026-11-05', driverName: 'His Driver', driverBusiness: '',
    viewers: ['ooMe'],
    session: { hours: 8, km: 90, active: false, startedAt: null, endedAt: null },
    dispatches: [], close: null, loads: 2, ticketsClosed: 0, updatedAt: 1
  });
  days.set('ooMe_2026-11-05', {
    driver: 'ooMe', date: '2026-11-05', driverName: 'Owner Operator', driverBusiness: '',
    viewers: ['ownU'],
    session: { hours: 9, km: 120, active: false, startedAt: null, endedAt: null },
    dispatches: [], close: null, loads: 4, ticketsClosed: 0, updatedAt: 1
  });
  const store = makeStore({
    con_list: [
      { uid: 'ownU', name: 'His Owner', business: '', status: 'connected' },
      { uid: 'drvX', name: 'His Driver', business: '', status: 'connected' }
    ],
    onboarding: { billingRate: 93 }
  });
  const els = { mirrorBar: mkStubEl(), mirrorBanner: mkStubEl() };
  els.mirrorBar.classList.add('hidden');
  els.mirrorBanner.classList.add('hidden');
  const sandbox = {
    console: console,
    document: { getElementById: function (id) { return els[id] || null; } },
    FB: { ready: true, user: { uid: 'ooMe' }, db: db },
    App: {
      _store: store,
      _today: function () { return TODAY; },
      _esc: escHtml,
      userRole: function () { return 'driver'; },
      showDashboard: function () {}
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(cpSrc, sandbox);
  vm.runInContext(mirSrc, sandbox);
  return { sandbox: sandbox, db: db, store: store, els: els, M: sandbox.Mirror, CP: sandbox.ConnectPipe };
}

/* A mirror world: real connectpipe + real mirror over the fakes.
   The viewer is an office-only account (Umar's shape). */
function makeMirrorWorld(conList) {
  const db = seedDb();
  const store = makeStore(bossStoreSeed(conList));
  const els = { mirrorBar: mkStubEl(), mirrorBanner: mkStubEl() };
  els.mirrorBar.classList.add('hidden');
  els.mirrorBanner.classList.add('hidden');
  const sandbox = {
    console: console,
    document: { getElementById: function (id) { return els[id] || null; } },
    FB: { ready: true, user: { uid: 'boss1' }, db: db },
    App: {
      _store: store,
      _today: function () { return TODAY; },
      _esc: escHtml,
      userRole: function () { return 'office'; },
      showDashboard: function () { sandbox.__dash = (sandbox.__dash || 0) + 1; }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(mirSrc, sandbox);
  vm.runInContext(cpSrc, sandbox);
  return { sandbox: sandbox, db: db, store: store, els: els, M: sandbox.Mirror, CP: sandbox.ConnectPipe };
}
function bookSnapshot(store) {
  const out = {};
  ['rev_entries', 'dsp_list', 'fuel_fills', 'sessions', 'con_list', 'onboarding'].forEach(function (k) {
    out[k] = JSON.stringify(store.get(k, null));
  });
  return JSON.stringify(out);
}
function buttonsAudit(html) {
  const tags = html.match(/<button[^>]*>/g) || [];
  return tags.filter(function (t) { return t.indexOf('mr-photo') === -1; });
}

/* ---------------- role world (real region + real dashboard) --- */
const roleRegion = extractRegion(appSrc, 'ROLE-BEGIN', 'ROLE-END');
const dashStart = appSrc.indexOf('  function buildDashboard() {');
const dashEnd = appSrc.indexOf('/* NAME-CARD-BEGIN');
if (dashStart === -1 || dashEnd === -1 || dashEnd <= dashStart) throw new Error('buildDashboard extraction failed');
const dashSrc = appSrc.slice(dashStart, dashEnd);
const META_KEYS = ['revenue', 'dispatch', 'navigator', 'fuel', 'pnl', 'maintenance', 'pti', 'damage', 'documents', 'manifest', 'invoice', 'connect'];
function makeRoleWorld(onboarding) {
  const store = makeStore({ onboarding: onboarding });
  const grid = mkStubEl(), trk = mkStubEl();
  const els = { modGrid: grid, trkCard: trk, mirrorBar: mkStubEl(), mirrorBanner: mkStubEl(), nameCard: mkStubEl() };
  const meta = {};
  META_KEYS.forEach(function (k) { meta[k] = { icon: '•', title: k }; });
  const sandbox = {
    console: console,
    store: store,
    document: { getElementById: function (id) { return els[id] || mkStubEl(); } },
    MODULE_META: meta,
    moduleTitle: function (k) { return k; },
    esc: escHtml,
    modStatus: function () { return ''; },
    paintNameCard: function () {},
    paintPtiFlag: function () {},
    pnlAllowed: function () { return true; },
    maintAllowed: function () { return true; },
    el: function (id) { return els[id] || mkStubEl(); },
    App: { _authLocked: function () { return false; }, tierAllows: function () { return true; }, _store: store }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(roleRegion, sandbox);      // defines App.userRole etc. (uses bare `store`)
  vm.runInContext(mirSrc, sandbox);          // window.Mirror (paintBar self-hides: no CP here)
  vm.runInContext(dashSrc + '\n;this.__buildDashboard = buildDashboard;', sandbox);
  return { sandbox: sandbox, store: store, grid: grid, trk: trk, App: sandbox.App };
}

/* ================= the run ================= */
(async function () {
  section('(a) the picker set');
  {
    const w = makeMirrorWorld(CON_ALL);
    w.M.drivers(); /* v364: kick the direction evidence, then settle */
    await settle();
    const ds = w.M.drivers();
    check('drivers() returns the All + live Once peers only', JSON.stringify(ds.map(function (d) { return d.uid; })) === JSON.stringify(['drvA', 'drvB']), JSON.stringify(ds));
    check('driver names ride the picker', ds[0].name === 'Asjad Kamal' && ds[1].name === 'Second Driver');
    w.M.paintBar();
    check('bar shows with an All peer', !w.els.mirrorBar.classList.contains('hidden'));
    check('bar offers Mine + both drivers', w.els.mirrorBar.innerHTML.indexOf('Mine') !== -1 &&
      w.els.mirrorBar.innerHTML.indexOf('Asjad Kamal') !== -1 && w.els.mirrorBar.innerHTML.indexOf('Second Driver') !== -1);
    check('bar never names the limited or pending peer', w.els.mirrorBar.innerHTML.indexOf('Limited Lou') === -1 &&
      w.els.mirrorBar.innerHTML.indexOf('Pending Pete') === -1);
  }
  {
    const w = makeMirrorWorld([{ uid: 'drvL', name: 'Limited Lou', status: 'connected', kind: 'limited', modules: ['manifest', 'fuel'] }]);
    w.M.drivers(); /* v364: kick first */
    await settle();
    check('limited-only world: drivers() empty', w.M.drivers().length === 0);
    w.M.paintBar();
    check('limited-only world: no picker bar', w.els.mirrorBar.classList.contains('hidden') && w.els.mirrorBar.innerHTML === '');
  }
  {
    const w = makeMirrorWorld([]);
    w.M.drivers(); /* v364: kick first */
    await settle();
    w.M.paintBar();
    check('no connections: no picker bar', w.els.mirrorBar.classList.contains('hidden'));
  }

  section('(b) setView discipline');
  {
    const w = makeMirrorWorld(CON_ALL);
    w.M.drivers(); /* v364: kick first */
    await settle();
    check('default view is Mine (inactive)', w.M.active() === false);
    w.M.setView('drvL');
    check('a Limited uid is refused', w.M.active() === false);
    w.M.setView('nobody');
    check('an unknown uid is refused', w.M.active() === false);
    w.M.setView('drvA');
    check('an All uid activates the mirror', w.M.active() === true && w.M.name() === 'Asjad Kamal');
    check('the pick persists as mirror_view only', JSON.stringify(w.store.get('mirror_view', null)) === JSON.stringify({ uid: 'drvA' }));
    const sel = w.els.mirrorBar.querySelector('#mr_pick');
    w.M.paintBar();
    sel.value = '';
    sel.onchange();
    check('picking Mine in the control ends the mirror', w.M.active() === false);
    w.M.setView('drvB');
    check('a live Once peer can be picked', w.M.active() === true && w.M.name() === 'Second Driver');
    w.M.setView(null);
    check('Back to Mine ends the mirror', w.M.active() === false);
  }

  section('(c) the banner');
  {
    const w = makeMirrorWorld(CON_ALL);
    w.M.drivers(); /* v364: kick first */
    await settle();
    w.M.paintBanner();
    check('banner hidden at Mine', w.els.mirrorBanner.classList.contains('hidden'));
    w.M.setView('drvA');
    w.M.paintBanner();
    check('banner shows while viewing', !w.els.mirrorBanner.classList.contains('hidden'));
    check('banner names the driver + read-only', w.els.mirrorBanner.innerHTML.indexOf('Viewing:') !== -1 &&
      w.els.mirrorBanner.innerHTML.indexOf('Asjad Kamal') !== -1 && w.els.mirrorBanner.innerHTML.indexOf('read-only') !== -1);
    w.M.setView(null);
    w.M.paintBanner();
    check('banner clears back at Mine', w.els.mirrorBanner.classList.contains('hidden') && w.els.mirrorBanner.innerHTML === '');
  }

  section('(d)+(e) the faces read the published docs');
  {
    const w = makeMirrorWorld(CON_ALL);
    w.M.drivers(); /* v364: kick first */
    await settle();
    const before = bookSnapshot(w.store);
    const writesBefore = w.db.writes;
    w.M.setView('drvA');

    const f1 = w.M.dayFacts(w.db._col('shareddays').get('drvA_2026-11-05'));
    check('dayFacts: ticket day hours = foreman + travel (10), never the session 99', f1.hours === 10 && f1.km === 221 && f1.loads === 6, JSON.stringify(f1));
    const f2 = w.M.dayFacts(w.db._col('shareddays').get('drvA_2026-11-06'));
    check('dayFacts: close day hours = close facts (6), never the session 50', f2.hours === 6 && f2.loads === 3, JSON.stringify(f2));

    let body = makeBody();
    await w.M.render('dispatch', body);
    let h = body.innerHTML;
    check('dispatch face: his site + ticket + day total', h.indexOf('Aecon Trans') !== -1 && h.indexOf('23769') !== -1 && h.indexOf('6 loads · 10 h') !== -1);
    check('dispatch face: the close-only day rides too', h.indexOf('2026-11-06') !== -1 && h.indexOf('3 loads · 6 h') !== -1);
    check('dispatch face: no other driver leaks in', h.indexOf('Other Site') === -1 && h.indexOf('Limited Site') === -1);
    check('dispatch face: read-only header names him', h.indexOf('Viewing: Asjad Kamal') !== -1 && h.indexOf('read-only') !== -1);
    check('dispatch face: no buttons at all', (h.match(/<button/g) || []).length === 0);

    body = makeBody();
    await w.M.render('revenue', body);
    h = body.innerHTML;
    check('revenue face: wage leg priced at HIS wage — 10 h x $29 = $290.00', h.indexOf('$290.00') !== -1, h);
    check('revenue face: close day priced (5+1) x $29 = $174.00', h.indexOf('$174.00') !== -1);
    check('revenue face: month wage total $464.00', h.indexOf('$464.00') !== -1);
    check('revenue face: his invoice to this payer rides', h.indexOf('Invoice #1154') !== -1 && h.indexOf('$3,117.50') !== -1);
    check('revenue face: no write controls', buttonsAudit(h).length === 0, JSON.stringify(buttonsAudit(h)));

    body = makeBody();
    await w.M.render('fuel', body);
    h = body.innerHTML;
    check('fuel face: the fill, its money and its receipt button', h.indexOf('Shell') !== -1 && h.indexOf('$199.36') !== -1 && h.indexOf('data-mrphoto="fk1"') !== -1);
    check('fuel face: his expense rides', h.indexOf('Tire change') !== -1 && h.indexOf('$294.00') !== -1);
    check('fuel face: only photo buttons exist', buttonsAudit(h).length === 0, JSON.stringify(buttonsAudit(h)));
    const btns = body.querySelectorAll('.mr-photo');
    check('fuel face: exactly one photo button', btns.length === 1);
    if (btns.length) {
      btns[0].onclick();
      await new Promise(function (r) { setTimeout(r, 10); });
      check('receipt photo fetch paints the rendition', btns[0]._slot.innerHTML.indexOf('data:image/jpeg;base64,RECEIPT') !== -1, btns[0]._slot.innerHTML);
    }

    body = makeBody();
    await w.M.render('maintenance', body);
    h = body.innerHTML;
    check('maintenance face: odometer + next service + due + history', h.indexOf('171,497') !== -1 && h.indexOf('175,429') !== -1 && h.indexOf('Oil change') !== -1);

    body = makeBody();
    await w.M.render('pti', body);
    h = body.innerHTML;
    check('pti face: his report, signed, passed', h.indexOf('Pre-trip') !== -1 && h.indexOf('No defects') !== -1 && h.indexOf('Unit 7') !== -1);

    body = makeBody();
    await w.M.render('damage', body);
    h = body.innerHTML;
    check('damage face: his report + photo button', h.indexOf('Light pole contact') !== -1 && h.indexOf('data-mrphoto="dk1"') !== -1);
    check('damage face: only photo buttons exist', buttonsAudit(h).length === 0);

    body = makeBody();
    await w.M.render('manifest', body);
    h = body.innerHTML;
    check('manifest face: daily log names the place', h.indexOf('Daily log · 2026-11-07') !== -1 && h.indexOf('Aecon Trans') !== -1);
    check('manifest face: multi-day table present', h.indexOf('mn-sumtab') !== -1 && h.indexOf('2026-11-05') !== -1 && h.indexOf('2026-11-06') !== -1);
    check('manifest face: hours are the revenue facts — 10 + 6, totals 16', h.indexOf('>16<') !== -1 || h.indexOf('<b>16</b>') !== -1, h);
    check('manifest face: the poisoned session hours never surface', h.indexOf('99') === -1 && h.indexOf('>50<') === -1);
    check('manifest face: fuel column from his records', h.indexOf('91.9') !== -1);
    check('manifest face: no raw coordinates anywhere', !/\-?\d{1,3}\.\d{4,}/.test(h.replace(/91\.915/g, '')), h);

    const FACE_HTML = [];
    for (const k of ['dispatch', 'revenue', 'fuel', 'maintenance', 'pti', 'damage', 'manifest']) {
      const b2 = makeBody();
      await w.M.render(k, b2);
      FACE_HTML.push(k + '=' + b2.innerHTML);
    }
    body = makeBody();
    await w.M.render('navigator', body);
    h = body.innerHTML;
    FACE_HTML.push('navigator=' + h);
    check('v358 navigator face: his trips from the published nav section', h.indexOf('His trips') !== -1 && h.indexOf('Airport Asphalt Plant') !== -1 && h.indexOf('Aecon Trans') !== -1, h.slice(0, 200));
    check('v358 navigator face: the coordinate-looking log entry never crosses', h.indexOf('51.16') === -1);
    check('v358 navigator face: saved-places gap stated plainly', h.indexOf("don't cross yet") !== -1);
    check('v358 navigator face: no buttons at all', (h.match(/<button/g) || []).length === 0);
    body = makeBody();
    await w.M.render('documents', body);
    h = body.innerHTML;
    FACE_HTML.push('documents=' + h);
    check('v358 documents face: honest gap under his name', h.indexOf('His documents') !== -1 && h.indexOf("don't cross on Connect yet") !== -1 && h.indexOf('Viewing: Asjad Kamal') !== -1);
    const TIMER_MARKS = ['trkMain', 'Counting from', 'Ready to work', 'startSession', 'stopSession', 'pauseSession'];
    check('v358: NO mirrored face ever shows the live timer / session controls',
      FACE_HTML.every(function (x) { return TIMER_MARKS.every(function (m) { return x.indexOf(m) === -1; }); }));

    section('(f) read-only proof');
    check('the payer book keys are byte-identical after every face', bookSnapshot(w.store) === before);
    check('zero Firestore writes across all mirror reads', w.db.writes === writesBefore, 'writes=' + w.db.writes);

    section('(g) driver isolation');
    w.M.setView('drvB');
    body = makeBody();
    await w.M.render('fuel', body);
    h = body.innerHTML;
    check('driver B face shows B only', h.indexOf('Petro-Canada') !== -1 && h.indexOf('Shell') === -1);
    body = makeBody();
    await w.M.render('dispatch', body);
    h = body.innerHTML;
    check('driver B dispatch shows B only', h.indexOf('Other Site') !== -1 && h.indexOf('Aecon Trans') === -1);
    w.M.setView(null);
    check('back at Mine: mirror inactive', w.M.active() === false);
    check('book still byte-identical after switching', bookSnapshot(w.store) === before);
  }

  section('(h) the role gate on the viewer\'s own dashboard');
  {
    const w = makeRoleWorld({ accountType: 'Fleet Manager', userRole: 'office', roleStamped: 'answer' });
    check('a saved office pick resolves office', w.App.userRole() === 'office');
    w.sandbox.__buildDashboard();
    check('office: tracker card hidden', w.trk.style.display === 'none', JSON.stringify(w.trk.style));
    check('v358 office: Navigator card PRESENT (a seeing tool — the timer is the only exclusion)', w.grid.innerHTML.indexOf('data-mod="navigator"') !== -1);
    check('office: no driver module cards (revenue/fuel)', w.grid.innerHTML.indexOf('data-mod="revenue"') === -1 && w.grid.innerHTML.indexOf('data-mod="fuel"') === -1);
    check('office: the office tools are present', ['connect', 'dispatch', 'manifest', 'pti', 'damage'].every(function (k) { return w.grid.innerHTML.indexOf('data-mod="' + k + '"') !== -1; }), w.grid.innerHTML);
    check('office: Mirror.officeOnly() agrees', w.sandbox.Mirror.officeOnly() === true);
  }
  {
    const w = makeRoleWorld({ accountType: 'Driver', userRole: 'driver', roleStamped: 'answer' });
    check('a saved driver pick resolves driver', w.App.userRole() === 'driver');
    w.sandbox.__buildDashboard();
    check('driver: tracker card shown', w.trk.style.display !== 'none');
    check('driver: Navigator + Revenue cards present', w.grid.innerHTML.indexOf('data-mod="navigator"') !== -1 && w.grid.innerHTML.indexOf('data-mod="revenue"') !== -1);
    check('driver: Mirror.officeOnly() false', w.sandbox.Mirror.officeOnly() === false);
  }
  {
    const w = makeRoleWorld({ accountType: 'Fleet Manager', userRole: 'both' });
    check('the v177 heal: Fleet Manager + unmarked both resolves office', w.App.userRole() === 'office');
    w.sandbox.__buildDashboard();
    check('v358 healed office: tracker hidden, Navigator present', w.trk.style.display === 'none' && w.grid.innerHTML.indexOf('data-mod="navigator"') !== -1);
  }
  {
    const w = makeRoleWorld({ accountType: 'Fleet Manager' });
    check('unanswered Fleet Manager holds the safe office face', w.App.userRole() === 'office');
  }
  {
    /* the Oct 17 shape, named: a role genuinely STORED as
       'driver' rules the face — the gate honors the saved role;
       it cannot rescue a switch that never saved. */
    const w = makeRoleWorld({ userRole: 'driver' });
    check('a stored driver role rules (the Oct 17 residual)', w.App.userRole() === 'driver');
    w.sandbox.__buildDashboard();
    check('stored driver: tracker shown', w.trk.style.display !== 'none');
  }

  section('(i) statics');
  check('openModule carries the mirror hook', appSrc.indexOf('Mirror.active() && Mirror.covers(key)') !== -1 && appSrc.indexOf('Mirror.render(key, mbody)') !== -1);
  check('moduleBack falls through in mirror', appSrc.indexOf('Mirror.covers(App._modKey)) return false') !== -1);
  check('buildDashboard paints the picker', appSrc.indexOf('Mirror.paintBar()') !== -1);
  check('v358: NO office Navigator door-shut remains in openModule (superseded read)', appSrc.indexOf("key === 'navigator' && window.Mirror && Mirror.officeOnly()") === -1);
  check('the odometer prompt is office-gated', appSrc.indexOf('ROLE GATE): no odometer prompt exists') !== -1);
  check('the floating timer face is office-gated', appSrc.indexOf('an office-only account never floats one') !== -1);
  check('the park nudge is office-gated', parkSrc.indexOf('Mirror.officeOnly && Mirror.officeOnly()') !== -1);
  check('index carries the picker + banner + script', idxSrc.indexOf('id="mirrorBar"') !== -1 && idxSrc.indexOf('id="mirrorBanner"') !== -1 && idxSrc.indexOf('js/mirror.js?v=364') !== -1);
  check('index bumps connectpipe to v364, app.js rides the v363 pin, style.css stays v357', idxSrc.indexOf('js/app.js?v=363') !== -1 && idxSrc.indexOf('js/connectpipe.js?v=364') !== -1 && idxSrc.indexOf('css/style.css?v=357') !== -1);
  check('mirror covers exactly the nine modules (v358: + Navigator + Documents)', (function () {
    const w = makeMirrorWorld(CON_ALL);
    void w;
    const want = { revenue: 1, dispatch: 1, fuel: 1, maintenance: 1, pti: 1, damage: 1, manifest: 1, navigator: 1, documents: 1 };
    return ['revenue', 'dispatch', 'fuel', 'maintenance', 'pti', 'damage', 'manifest', 'navigator', 'documents'].every(function (k) { return w.M.covers(k) === !!want[k]; }) &&
      ['pnl', 'invoice', 'connect'].every(function (k) { return w.M.covers(k) === false; });
  })());
  check('version.json is web 364 (the direction fix) or later', ver.webVersion >= 364, 'got ' + ver.webVersion);
  ['index.html', 'css/style.css', 'js/app.js', 'js/mirror.js', 'js/parkplace.js', 'js/connectpipe.js'].forEach(function (f) {
    const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
    check('version.json hash matches ' + f, ver.files[f] === h);
  });

  section('(j) v364 — DIRECTION: the picker lives on the receiving side only');
  {
    /* the Nov 7 phone: a pure DRIVER account whose All pairs
       are the owners he sends TO */
    const w = makeDriverSideWorld();
    const day = w.CP.buildDay('2026-11-05');
    check('driver world: his own day publishes under HIS uid, viewers = his owners',
      !!day && day.driver === 'drvMe' && JSON.stringify(day.viewers.slice().sort()) === JSON.stringify(['ownD', 'ownU']),
      day ? JSON.stringify(day.viewers) : 'buildDay null');
    if (day) w.db._col('shareddays').set('drvMe_2026-11-05', day);
    const rec = w.CP.buildRecords();
    check('driver world: his records doc publishes under HIS uid',
      !!rec && rec.driver === 'drvMe' && JSON.stringify(rec.viewers.slice().sort()) === JSON.stringify(['ownD', 'ownU']));
    if (rec) w.db._col('sharedrecords').set('drvMe', rec);

    const probe = await w.CP.receivingFrom();
    check('driver world: receivingFrom proves NOBODY shares to him', Object.keys(probe).length === 0, JSON.stringify(probe));
    w.M.drivers(); /* v364: kick first */
    await settle();
    check('driver world: drivers() is empty — no owner is ever pickable', w.M.drivers().length === 0, JSON.stringify(w.M.drivers()));
    w.M.paintBar();
    check('driver world: NO picker renders — bar hidden, DOM empty',
      w.els.mirrorBar.classList.contains('hidden') && w.els.mirrorBar.innerHTML === '');
    check('driver world: no select control exists in the bar', w.els.mirrorBar.innerHTML.indexOf('mr_pick') === -1);
    w.M.setView('ownU');
    check('driver world: picking the owner (Umar seat) is refused', w.M.active() === false);
    w.M.setView('ownD');
    check('driver world: picking Dave Cooper is refused', w.M.active() === false);
    const leaked = await w.CP.fetchCrewRange('2026-11-01', '2026-11-07');
    check('driver world: fetchCrewRange returns ZERO owner days (viewers-gated — the offer was the whole bug)',
      leaked.length === 0, 'got ' + leaked.length);
    const recsOut = await w.CP.fetchRecords();
    check('driver world: fetchRecords holds no owner book',
      !recsOut.records.ownU && !recsOut.records.ownD);
  }
  {
    /* the owner-operator: both directions on one account */
    const w = makeBothWaysWorld();
    const probe = await w.CP.receivingFrom();
    check('both-ways: receivingFrom names ONLY the driver below him', JSON.stringify(Object.keys(probe)) === JSON.stringify(['drvX']), JSON.stringify(probe));
    w.M.drivers(); /* v364: kick first */
    await settle();
    const ds = w.M.drivers();
    check('both-ways: the picker lists his driver and NOT his owner',
      JSON.stringify(ds.map(function (d) { return d.uid; })) === JSON.stringify(['drvX']), JSON.stringify(ds));
    w.M.paintBar();
    check('both-ways: the bar renders for the receiving side',
      !w.els.mirrorBar.classList.contains('hidden') && w.els.mirrorBar.innerHTML.indexOf('His Driver') !== -1);
    check('both-ways: his owner never appears in the bar', w.els.mirrorBar.innerHTML.indexOf('His Owner') === -1);
    w.M.setView('ownU');
    check('both-ways: picking his owner is refused', w.M.active() === false);
    w.M.setView('drvX');
    check('both-ways: picking his driver works', w.M.active() === true && w.M.name() === 'His Driver');
    w.M.setView(null);
  }
  {
    /* one-way evidence + live kind: a flaky narrowed re-probe
       never un-proves a real share, but a flip to Limited still
       falls out on the very next read (v357 discipline kept) */
    const w = makeMirrorWorld(CON_ALL);
    w.M.drivers(); /* v364: kick first */
    await settle();
    check('one-way: the payer drivers prove in', w.M.drivers().length === 2);
    const realRecv = w.CP.receivingFrom;
    const realCP = w.CP;
    /* swap the pipe handle mirror.js reads (window.ConnectPipe) —
       the module seals its own binding at load; the seam the
       shipped page exposes is the handle itself */
    const swapped = Object.assign({}, realCP, {
      receivingFrom: function () { return Promise.resolve({}); }
    });
    w.sandbox.ConnectPipe = swapped;
    w.M._proveDirection();
    await settle(3);
    check('one-way: a narrowed re-probe never un-proves', w.M.drivers().length === 2);
    w.sandbox.ConnectPipe = realCP;
    const cl = w.store.get('con_list', []);
    cl[0] = Object.assign({}, cl[0], { kind: 'limited', modules: ['manifest'] });
    w.store.set('con_list', cl);
    check('live kind: flipping a proven driver to Limited drops him at once',
      JSON.stringify(w.M.drivers().map(function (d) { return d.uid; })) === JSON.stringify(['drvB']), JSON.stringify(w.M.drivers()));
  }
  check('statics: the direction gate ships in mirror + pipe',
    mirSrc.indexOf('receivingFrom') !== -1 && mirSrc.indexOf('MIRROR-DIRECTION-BACKWARDS') !== -1 && cpSrc.indexOf('CP.receivingFrom = function') !== -1);
  check('statics: receivingFrom queries shareddays on the driver field (no collection scan)',
    cpSrc.indexOf("collection('shareddays').where('driver', '==', p.uid)") !== -1);

  console.log('\nconnect-mirror-v364: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
