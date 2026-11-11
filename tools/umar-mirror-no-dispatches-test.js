#!/usr/bin/env node
/* UMAR-MIRROR-NO-DISPATCHES (Nov 11, 2026) — the field failure:
 * Asjad texted Umar (his Connect All seat) "You still don't see
 * my dispatches?" and Umar answered "No nothing" — while Asjad's
 * Nov 11 dispatch (Aecon Trans, started 7:29 AM) was in progress.
 *
 * This suite runs the REAL shipped code end to end over one fake
 * Firestore shared by two worlds:
 *   DRIVER (Asjad's shape): a connected Full seat, a dispatch IN
 *     PROGRESS today, a completed one yesterday, an UPCOMING one
 *     tomorrow, a running tracker — and the pair in STEADY STATE
 *     (cp_hist_peers already knows the seat: the complete-history
 *     sweep ran for this pair long ago). The driver runs the real
 *     lifecycle entry CP.publishAll().
 *   SEAT (Umar's shape): an office account whose own dsp_list
 *     holds HIS OWN dispatch; he picks the driver in the mirror
 *     and opens the Dispatch face (real js/mirror.js).
 *
 * The seat's view of the driver must carry the driver's
 * dispatches — today (in progress), upcoming, and recent past —
 * read-only, and never the seat's own records. A Limited seat
 * (Maria's shape: manifest ticked, dispatch NOT ticked) must
 * gain nothing.
 *
 * Run: node tools/umar-mirror-no-dispatches-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const cpSrc = read('js/connectpipe.js');
const mirSrc = read('js/mirror.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function section(s) { console.log('— ' + s + ' —'); }
const clone = (v) => JSON.parse(JSON.stringify(v));
function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&quot;');
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
function makeBody() {
  const body = { _html: '', _photoBtns: null };
  Object.defineProperty(body, 'innerHTML', {
    get: function () { return body._html; },
    set: function (v) { body._html = String(v); body._photoBtns = null; }
  });
  body.querySelector = function (sel) {
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

/* ---------------- the field fixture ---------------- */
const TODAY = '2026-11-11', YDAY = '2026-11-10', TOM = '2026-11-12';
const DRV = 'drvA', SEAT = 'boss1';

function driverStore() {
  const todayRec = {
    id: 'dspNov11', jobSite: 'Aecon Trans', date: TODAY, scheduledAt: TODAY + 'T08:00',
    equipment: 'Tandem', material: '', ticketNo: '', status: 'active',
    startedAt: Date.now() - 3 * 3600e3,
    notes: 'Foreman: Chad\nGo Empty To: (51.1225089, -114.0122197)\nHauling To: (51.3078889, -114.0369722)',
    tickets: [], photo: null
  };
  return makeStore({
    onboarding: { companyName: 'Asjad Kamal', accountType: 'Driver', travelBonus: 1, payRate: 29, ownWageRate: 29 },
    con_list: [
      { id: 'u1', name: 'Umar Dump Truck', role: 'Fleet Manager', face: 'office', uid: SEAT, status: 'connected', viaConnect: true }
    ],
    /* steady state: this pair is old — the complete-history sweep
       already ran for it (it runs once per NEW peer) */
    cp_hist_peers: [SEAT],
    dsp_list: [
      todayRec,
      {
        id: 'dspNov12', jobSite: 'Aecon Trans', date: TOM, scheduledAt: TOM + 'T08:00',
        equipment: 'Tandem', material: '', ticketNo: '', status: 'saved',
        notes: 'Foreman: Chad', tickets: [], photo: null
      },
      {
        id: 'dspNov10', jobSite: 'Aecon Trans', date: YDAY, scheduledAt: YDAY + 'T08:30',
        equipment: 'Tandem', material: '', ticketNo: '28830', status: 'completed',
        endedAt: Date.now() - 20 * 3600e3, loads: '6', loadsSet: true,
        tickets: [{ id: 't1', cardNumber: '28830', material: '', loads: 6, foremanHours: 6.5, photo: null }],
        photo: null
      }
    ],
    dsp_active: clone(todayRec),
    sessions: [],
    tracker: { status: 'running', startTs: Date.now() - 3 * 3600e3, elapsed: 0 }
  });
}

function makeWorld(uid, store, withMirror) {
  const db = makeWorld.sharedDb;
  const els = { mirrorBar: mkStubEl(), mirrorBanner: mkStubEl() };
  els.mirrorBar.classList.add('hidden');
  els.mirrorBanner.classList.add('hidden');
  const sandbox = {
    console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
    document: { getElementById: function (id) { return els[id] || null; } },
    FB: { ready: true, user: { uid: uid }, db: db },
    App: {
      _store: store,
      _today: function () { return TODAY; },
      _esc: escHtml,
      userRole: function () { return uid === DRV ? 'driver' : 'office'; },
      showDashboard: function () {}
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(cpSrc, sandbox);
  if (withMirror) vm.runInContext(mirSrc, sandbox);
  return { sandbox: sandbox, store: store, els: els, CP: sandbox.ConnectPipe, M: sandbox.Mirror || null };
}
makeWorld.sharedDb = new FakeDb();

function settle() { return new Promise(function (r) { setTimeout(r, 10); }); }

/* ================= the run ================= */
(async function () {
  const db = makeWorld.sharedDb;

  section('driver publishes (real CP.publishAll, steady-state pair)');
  const drv = makeWorld(DRV, driverStore(), false);
  await drv.CP.publishAll();
  await settle();

  const days = db._col('shareddays');
  const dToday = days.get(DRV + '_' + TODAY);
  check('P1: today\'s day doc exists', !!dToday);
  check('P1: today\'s doc names the seat as viewer', !!dToday && (dToday.viewers || []).indexOf(SEAT) !== -1,
    dToday && JSON.stringify(dToday.viewers));
  const sdToday = dToday && (dToday.dispatches || []).filter(function (x) { return x.id === 'dspNov11'; })[0];
  check('P1: today\'s doc carries the in-progress dispatch', !!sdToday);
  check('P1: the dispatch rides as active / Working now', !!sdToday && sdToday.status === 'active',
    sdToday && sdToday.status);
  const dYday = days.get(DRV + '_' + YDAY);
  const sdYday = dYday && (dYday.dispatches || []).filter(function (x) { return x.id === 'dspNov10'; })[0];
  check('P2: yesterday\'s doc carries the completed dispatch', !!sdYday && sdYday.status === 'completed');
  const dTom = days.get(DRV + '_' + TOM);
  const sdTom = dTom && (dTom.dispatches || []).filter(function (x) { return x.id === 'dspNov12'; })[0];
  check('P3: the UPCOMING dispatch\'s day is published too', !!sdTom,
    dTom ? 'doc exists, dispatches=' + JSON.stringify((dTom.dispatches || []).map(function (x) { return x.id; })) : 'no doc for ' + TOM);
  check('P3: it rides as Scheduled for its own date', !!sdTom && sdTom.status === 'saved' && sdTom.date === TOM,
    sdTom && (sdTom.status + '@' + sdTom.date));
  /* the content guard: a second cycle leaves the upcoming doc
     byte-identical (today's doc legitimately rewrites — its live
     session hours grow with the clock) */
  const tomBefore = JSON.stringify(days.get(DRV + '_' + TOM));
  await drv.CP.publishAll();
  await settle();
  check('P3: a second publish cycle leaves the upcoming doc untouched (content guard)',
    JSON.stringify(days.get(DRV + '_' + TOM)) === tomBefore);

  section('seat (Full) opens the driver\'s Dispatch face');
  const seatStore = makeStore({
    onboarding: { companyName: 'Ai Trucking', accountType: 'Fleet Manager', billingRate: 93 },
    con_list: [
      { id: 'ud1', name: 'Asjad Kamal', role: 'Driver', face: 'driver', uid: DRV, status: 'connected', viaConnect: true }
    ],
    /* the seat's OWN dispatch — must never appear under the driver's name */
    dsp_list: [{ id: 'mineD', jobSite: 'Umar Own Job', date: TODAY, scheduledAt: TODAY + 'T07:00', status: 'saved', tickets: [] }],
    dsp_active: null, sessions: [], mirror_view: null
  });
  const seat = makeWorld(SEAT, seatStore, true);
  await seat.CP.receivingFrom();
  seat.M._proveDirection();
  await settle();
  const offered = seat.M.drivers().map(function (d) { return d.uid; });
  check('the driver is pickable on the seat', offered.indexOf(DRV) !== -1, JSON.stringify(offered));
  seat.M.setView(DRV);
  check('the mirror activates on the driver', seat.M.active() === true);
  const body = makeBody();
  await seat.M.render('dispatch', body);
  const html = body.innerHTML;
  check('today\'s in-progress dispatch shows (Aecon Trans)', html.indexOf('Aecon Trans') !== -1);
  check('it reads Working now', html.indexOf('Working now') !== -1);
  check('today\'s date heads a section', html.indexOf(TODAY) !== -1);
  check('yesterday\'s completed dispatch shows with its ticket', html.indexOf('28830') !== -1 && html.indexOf('Closed') !== -1);
  check('the UPCOMING dispatch shows, read as Scheduled', html.indexOf(TOM) !== -1 && html.indexOf('Scheduled') !== -1);
  check('the seat\'s OWN dispatch never appears', html.indexOf('Umar Own Job') === -1);
  const btns = (html.match(/<button[^>]*>/g) || []).filter(function (t) { return t.indexOf('mr-photo') === -1 && t.indexOf('mr_back') === -1; });
  check('the face is read-only (no action buttons)', btns.length === 0, JSON.stringify(btns));
  check('the seat\'s own book is untouched by browsing',
    JSON.stringify(seatStore.get('dsp_list', [])).indexOf('Umar Own Job') !== -1 &&
    seatStore.get('dsp_active', null) === null);

  section('seat view when the ONLY shared day is upcoming');
  {
    const db2 = new FakeDb();
    db2._col('shareddays').set(DRV + '_' + TOM, {
      driver: DRV, date: TOM, driverName: 'Asjad Kamal', driverBusiness: '',
      viewers: [SEAT], session: { hours: 0, km: null, active: false, startedAt: null, endedAt: null },
      dispatches: [{
        id: 'dspNov12', origin: 'driver', sentBy: '', pipeId: '', sourceLabel: '',
        jobSite: 'Aecon Trans', date: TOM, scheduledAt: TOM + 'T08:00', equipment: 'Tandem',
        material: '', ticketNo: '', notes: '', status: 'saved', startedAt: null, closedAt: null,
        foremanHours: 0, travelHours: 0, travelBillable: false, loads: 0, netWeight: 0, tickets: [], photoRef: false
      }],
      close: null, loads: 0, ticketsClosed: 0, updatedAt: 1
    });
    makeWorld.sharedDb = db2;
    const seat2 = makeWorld(SEAT, seatStore, true);
    await seat2.CP.receivingFrom();
    seat2.M._proveDirection();
    await settle();
    seat2.M.setView(DRV);
    const body2 = makeBody();
    await seat2.M.render('dispatch', body2);
    check('the Upcoming card shows instead of the empty state',
      body2.innerHTML.indexOf('Upcoming dispatches') !== -1 && body2.innerHTML.indexOf('No days shared yet') === -1);
    check('the last-14-days card is absent when there are no past days',
      body2.innerHTML.indexOf('last 14 days') === -1);
    makeWorld.sharedDb = db;
  }

  section('Limited seat (Maria shape) gains nothing');
  const limStore = makeStore({
    onboarding: { companyName: 'Dynamic Trucking', accountType: 'Fleet Manager' },
    con_list: [
      { id: 'ud1', name: 'Asjad Kamal', role: 'Driver', face: 'driver', uid: DRV, status: 'connected', kind: 'limited', modules: ['manifest'], viaConnect: true }
    ],
    dsp_list: [], dsp_active: null, sessions: [], mirror_view: null
  });
  const lim = makeWorld(SEAT, limStore, true);
  await lim.CP.receivingFrom();
  lim.M._proveDirection();
  await settle();
  lim.M.setView(DRV);
  if (lim.M.active()) {
    check('dispatch face is blocked for an unticked Limited seat', lim.M.blocks('dispatch') === true && lim.M.covers('dispatch') === false);
  } else {
    check('dispatch face is blocked for an unticked Limited seat', true, 'driver not pickable at all — also safe');
  }
  const crew = await lim.CP.fetchCrewRange(YDAY, TODAY);
  check('the pipe reader itself serves her none of his days',
    crew.filter(function (d) { return d && d.driver === DRV; }).length === 0);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
