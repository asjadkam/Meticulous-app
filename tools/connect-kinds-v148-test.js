#!/usr/bin/env node
/* Meticulous v148 — CONNECTION KINDS suite (owner, Oct 17, 2026
 * 21:35–21:36 + 22:26 MDT). At connect time a man chooses the KIND
 * of connection: "Connect all" · "Connect limited" · "One time
 * connection". His rules: the payer of record gets All; a
 * DISPATCHER (dispatches work, isn't the payer) usually connects
 * Limited, so the picker DEFAULTS by role; Limited scope =
 * DISPATCH + MANIFESTS cross only (fuel, receipts, maintenance,
 * expenses, invoices and the P&L money picture do NOT cross);
 * One-Time = a single job/day, then it ends BY ITSELF. His own
 * live pair (him <-> his payer) is FULL ACCESS — every existing
 * connection is grandfathered as Connect All, unchanged.
 *
 * Runs the REAL shipped code — js/connectlive.js +
 * js/connectpipe.js whole, modules/manifest.js whole (the
 * manifest's own collect/docLines), the INV-CYCLE region of
 * modules/invoice.js, modules/pnl.js whole (crew card +
 * crewWagesFor via _calc), modules/connect.js whole (the picker,
 * the accept select, the connection rows) — over a fake
 * Firestore and per-user memory stores.
 *
 *  (a) kind defaults: the send-side preselection (a dispatcher
 *      face asking a driver who is NOT his payroll driver ->
 *      Limited; a payer with the driver on his books -> All; a
 *      driver asking anyone -> All) and the accept-side
 *      preselection (the proposal governs; a kind-less pre-v148
 *      request from an office face to a driving accepter who has
 *      never billed him -> Limited; billed him -> All)
 *  (b) stamping: sendRequest writes kind (+ onceDate for once)
 *      on the request doc; accept stamps the ACCEPTED kind on
 *      both con_lists (the accepter may change the proposal);
 *      a pre-v148 pair (no kind anywhere) materializes with NO
 *      kind key and behaves as All everywhere
 *  (c) Limited publishing: the driver's day/records/photos
 *      viewers EXCLUDE the limited peer; no billing doc is
 *      written for him (a stale one is emptied); a manifests doc
 *      crosses carrying ONLY the days he dispatched; the
 *      dispatch pipe still flows BOTH ways
 *  (d) Limited reading: fetchCrew returns nothing for a limited
 *      driver even when a stale day doc still names the viewer;
 *      fetchRecords hands a limited peer manifests ONLY; the P&L
 *      crew card paints NO money/fuel/invoice surfaces for him
 *      and DOES paint his manifests; crewWagesFor books NO P&L
 *      leg for him even with a poisoned crew-day cache
 *  (e) One-Time: the pair flows at All scope while alive; the
 *      driver's close of the riding dispatch ends it on his side
 *      (entry ended, endedAt stamped, publishing stops); the
 *      other side ends on its next reconcile; the day ending
 *      ends a second pair by itself; a fresh connection to the
 *      same man works again (the ended doc re-opens)
 *  (f) kind change re-governs: All -> Limited stops the next
 *      publish (viewers pruned, billing emptied, manifests
 *      appear, the peer's reads close); Limited -> All resumes
 *  (g) the Connect screen: connection rows name their kind
 *      ("Full access" for All), an ended one-time row reads
 *      ended; the request picker offers the three kinds in the
 *      owner's words with the role default preselected, and the
 *      chosen kind is what the request carries; the accept row
 *      carries the kind select preselected to the proposal
 *  (h) rules statics (connect-live (h) style): the requests
 *      kind-governance + ended-reopen update branches; the
 *      pairLimited/pairEnded gate on the shareddays /
 *      sharedrecords / sharedphotos / sharedbilling reads; the
 *      sharedmanifests block (driver + the ONE named viewer,
 *      ended pairs shut); nothing world-readable — plus the
 *      behavioural read matrix over the REAL published docs,
 *      mirroring the shipped predicates
 *  (i) grandfather byte-identity: with no kind anywhere, the
 *      published day/records/billing docs carry no kind keys
 *      and the exact pre-v148 shapes/viewers; version pins
 * Run: node tools/connect-kinds-v148-test.js
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
const conSrc = read('modules/connect.js');
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

/* A body stub whose querySelectorAll fabricates clickable
   elements from the painted HTML (the connect-live harness
   pattern, extended so the picker can actually be driven). */
function makeBody() {
  const els = {};
  function mkEl(key) {
    if (els[key]) return els[key];
    const el = {
      value: '', textContent: '', innerHTML: '', style: {}, disabled: false,
      options: [{ text: '' }], selectedIndex: 0, files: [],
      _attrs: {},
      classList: { toggle: function () {}, add: function () {}, remove: function () {} },
      setAttribute: function (k, v) { el._attrs[k] = v; },
      getAttribute: function (k) { return (k in el._attrs) ? el._attrs[k] : null; },
      addEventListener: function () {}, removeEventListener: function () {},
      focus: function () {}, scrollIntoView: function () {},
      querySelector: function (sel) { return mkEl(key + '>' + sel); },
      querySelectorAll: function () { return []; },
      onclick: null, onchange: null, onkeydown: null
    };
    els[key] = el;
    return el;
  }
  const body = { _html: '' };
  Object.defineProperty(body, 'innerHTML', {
    get: function () { return body._html; },
    set: function (v) { body._html = String(v); }
  });
  body.querySelector = function (sel) { return mkEl('q:' + sel); };
  body.querySelectorAll = function (sel) {
    const m = /\[([\w-]+)/.exec(sel);
    if (!m) return [];
    const attr = m[1];
    const out = [];
    const re = new RegExp(attr + '="([^"]*)"', 'g');
    /* painted HTML lives in the body's own markup AND in child
       stubs' innerHTML (painted regions: results, requests) */
    const chunks = [body._html].concat(Object.keys(els).map((k) => els[k].innerHTML || ''));
    let n = 0;
    chunks.forEach((html) => {
      re.lastIndex = 0;
      let mm;
      while ((mm = re.exec(html))) {
        const el = mkEl('qa:' + sel + ':' + mm[1] + ':' + (n++));
        el._attrs[attr] = mm[1];
        out.push(el);
      }
    });
    return out;
  };
  body._els = els;
  body._mk = mkEl;
  return body;
}

let TODAY = '2026-10-17';
const D_YEST = '2026-10-16', D_OLD = '2026-10-10';
const PHOTO = 'data:image/jpeg;base64,PHOTOSECRET';

const INV_BOSS = {
  id: 'inv1', no: '1151', date: '2026-10-16',
  billTo: 'AI Trucking, 1506 16 St NE, Calgary AB T2E 4T2',
  pa: '2026-10-01', pb: '2026-10-15',
  revLines: [{ date: '2026-10-01', amt: 3610.50, src: 'dispatch' }], items: [],
  taxRate: 5, taxIncluded: true, sub: 3610.50, tax: 171.93, total: 3610.50,
  dayHours: { '2026-10-01': 124.5 }, cardDays: null, rate: 29, truckNo: '07',
  notes: '', company: { name: 'Asjad Kamal', addr: '', gst: '' },
  province: 'Alberta', country: 'Canada', payments: [], paidAmount: null, paid: null
};

function driverStore() {
  return makeStore({
    onboarding: { companyName: 'Asjad Kamal', firstName: 'Asjad', lastName: 'Kamal', accountType: 'Owner-Operator', userRole: 'driver', travelBonus: 1, payRate: 29 },
    con_list: [],
    dsp_list: [
      {
        id: 'dsp-today', jobSite: 'Maple Ridge', date: TODAY, scheduledAt: TODAY + 'T08:00',
        equipment: 'Tandem', material: 'Clay', ticketNo: '22729', status: 'completed',
        endedAt: Date.now() - 3600e3, loads: '3', loadsSet: true,
        tickets: [{ id: 't1', cardNumber: '22729', material: 'Clay', loads: 3, foremanHours: 10, photo: null }]
      },
      {
        /* a job the DISPATCHER sent down the pipe, completed —
           the one manifest day he is entitled to see */
        id: 'dsp-pipe', jobSite: 'Dispatcher Yard Job', date: D_YEST, scheduledAt: D_YEST + 'T08:00',
        equipment: 'Tandem', material: 'Gravel', ticketNo: '9001', status: 'completed',
        endedAt: Date.now() - 86400e3, loads: '2', loadsSet: true,
        pipeId: 'pd-disp-1', pipeFrom: 'uid-disp',
        tickets: [{ id: 't2', cardNumber: '9001', material: 'Gravel', loads: 2, foremanHours: 8, photo: null }]
      },
      {
        /* a day the dispatcher had NOTHING to do with — its
           manifest must never reach him */
        id: 'dsp-old', jobSite: 'Private Job', date: D_OLD, scheduledAt: D_OLD + 'T08:00',
        equipment: 'Tandem', material: 'Clay', ticketNo: '5555', status: 'completed',
        endedAt: Date.now() - 7 * 86400e3, loads: '1', loadsSet: true,
        tickets: [{ id: 't3', cardNumber: '5555', material: 'Clay', loads: 1, foremanHours: 6, photo: null }]
      }
    ],
    dsp_active: null,
    sessions: [
      { date: TODAY, seconds: 11 * 3600, endedAt: new Date(Date.now() - 3600e3).toISOString(), liveKm: 96.5 },
      { date: D_YEST, seconds: 9 * 3600, endedAt: new Date(Date.now() - 86400e3).toISOString(), liveKm: 80 }
    ],
    tracker: { status: 'idle', startTs: 0, elapsed: 0 },
    rev_entries: [
      { date: TODAY, type: 'hourly', hours: '11', amount: '319.00', note: 'Dispatch: Maple Ridge · foreman 10h', foremanHours: 10, travelHours: 1, loads: 1 },
      { date: D_YEST, type: 'hourly', hours: '9', amount: '261.00', note: 'Dispatch: Dispatcher Yard Job · foreman 8h', foremanHours: 8, travelHours: 1, loads: 1 }
    ],
    fuel_fills: [
      { date: TODAY, time: '14:27', litres: 64.096, cost: 146.72, station: 'Petro-Canada', odo: 169300, photo: PHOTO }
    ],
    fuel_expenses: [{ date: TODAY, what: 'Truck wash', cost: '25.00' }],
    mt_odo: '169300', mt_nextServiceOdo: '175429', mt_nextServiceDate: '2026-11-27', mt_annualDate: '2027-05-31',
    mt_events: [{ date: '2026-09-20', odo: 164000, type: 'Oil change', cost: 189.99, notes: '' }],
    inv_list: [INV_BOSS]
  });
}

const users = {
  driver: { uid: 'uid-driver', email: 'driver@example.com', role: 'driver', store: driverStore() },
  boss: {
    uid: 'uid-boss', email: 'boss@example.com', role: 'office',
    store: makeStore({
      onboarding: { companyName: 'AI Trucking', accountType: 'Fleet Manager', userRole: 'office', billingRate: 52 },
      con_list: [], dsp_list: [], dsp_active: null,
      pnl_drivers: [{ id: 'pd1', name: 'Asjad Kamal', payType: 'hourly', rate: 29, uid: 'uid-driver', viaConnect: true, travelHours: 0, start: '2026-10' }]
    })
  },
  disp: {
    uid: 'uid-disp', email: 'dispatch@example.com', role: 'office',
    store: makeStore({
      onboarding: { companyName: 'Saleem Dispatch', accountType: 'Fleet Manager', userRole: 'office', billingRate: 60 },
      con_list: [], dsp_list: [], dsp_active: null, pnl_drivers: []
    })
  },
  driver2: {
    uid: 'uid-driver2', email: 'driver2@example.com', role: 'driver',
    store: makeStore({
      onboarding: { companyName: 'Second Driver Co', accountType: 'Driver', userRole: 'driver' },
      con_list: [], dsp_list: [], dsp_active: null, inv_list: []
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
vm.createContext(sb);
vm.runInContext(ocrSrc, sb);
vm.runInContext(clSrc, sb);
vm.runInContext(cpSrc, sb);
vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
vm.runInContext(manSrc, sb);
vm.runInContext(pnlSrc, sb);
vm.runInContext(conSrc, sb);
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
  sb.ConnectLive._pubKey = '';
  sb.ConnectLive._reqs = null;
  sb.ConnectPipe._pubCache = {};
  sb.ConnectPipe._recCache = {};
  sb.ConnectPipe._billedKnown = null;
  sb.ConnectPipe._billedSession = {};
  sb.ConnectPipe._mfKnown = null;
  sb.ConnectPipe._mfSession = {};
  sb.ConnectPipe._photoCache = {};
  sb.ConnectPipe._lastPullAt = 0;
  sb.ConnectPipe._crewCache = null;
  sb.ConnectPipe._peerCache = null;
}
function flush() {
  return new Promise((res) => { let n = 0; (function step() { if (++n > 60) return res(); setTimeout(step, 0); })(); });
}
const CL = () => sb.ConnectLive;
const CP = () => sb.ConnectPipe;
const reqDoc = (a, b) => db._col('requests').get(a + '_' + b);
const connOf = (u, uid) => (u.store.get('con_list', []) || []).filter((c) => c && c.uid === uid)[0];
const dayDoc = (date) => db._col('shareddays').get('uid-driver_' + date);
const recDoc = () => db._col('sharedrecords').get('uid-driver');
const billDoc = (viewer) => db._col('sharedbilling').get('uid-driver_' + viewer);
const mfDoc = (viewer) => db._col('sharedmanifests').get('uid-driver_' + viewer);

/* connect a pair directly through the real handshake, with an
   explicit kind (or none, for the grandfather cases) */
async function connectPair(fromUser, toUser, kind, onceDate, acceptKind) {
  // identity of the TARGET comes from his own world
  asUser(toUser); const idn = CL().identity();
  asUser(fromUser);
  const r = await CL().sendRequest({ uid: toUser.uid, name: idn.name, business: idn.business, role: idn.role, face: idn.face, person: idn.person }, kind, onceDate);
  if (r !== 'sent' && r !== 'connected') throw new Error('sendRequest failed: ' + r);
  asUser(toUser);
  const mine = await CL().listMine();
  const q = mine.incoming.filter((x) => x.from === fromUser.uid && x.status === 'pending')[0];
  if (!q) throw new Error('no pending request for accept');
  const ok = await CL().respond(q, true, acceptKind !== undefined ? acceptKind : kind, onceDate);
  if (!ok) throw new Error('respond failed');
  asUser(fromUser);
  await CL().reconcile();
  asUser(toUser);
  await CL().reconcile();
}

(async function main() {
  /* ============ (a) kind defaults — the role preselection ============ */
  console.log('(a) kind defaults — preselection by role');
  check('a: CL exposes the kind vocabulary', typeof CL().isKind === 'function' && CL().isKind('all') && CL().isKind('limited') && CL().isKind('once') && !CL().isKind('bogus'));
  eq('a: an entry with no kind reads as all (grandfather)', CL().kindOf({}), 'all');
  eq('a: an entry with a kind reads it', CL().kindOf({ kind: 'limited' }), 'limited');
  // send-side: the DISPATCHER (office face, driver not on his books) asking a driver
  asUser(users.disp);
  eq('a: dispatcher -> driver (not his payroll) preselects limited',
    CL().defaultKindFor({ uid: 'uid-driver', face: 'driver' }), 'limited');
  // send-side: the PAYER (office face, driver ON his books) asking the driver
  asUser(users.boss);
  eq('a: payer -> his own payroll driver preselects all',
    CL().defaultKindFor({ uid: 'uid-driver', face: 'driver' }), 'all');
  // send-side: a driver asking anyone -> all
  asUser(users.driver);
  eq('a: driver -> office peer preselects all',
    CL().defaultKindFor({ uid: 'uid-disp', face: 'office' }), 'all');
  // accept-side: the proposal governs when the doc carries one
  eq('a: accept preselect = the proposed kind',
    CL().defaultKindForRequest({ kind: 'limited', fromFace: 'driver' }), 'limited');
  // accept-side, kind-less (pre-v148) request: office requester,
  // driving accepter who has never billed him -> limited
  asUser(users.driver2);
  eq('a: accept, kind-less office request, never billed -> limited',
    CL().defaultKindForRequest({ from: 'uid-disp', fromFace: 'office', fromName: 'Saleem Dispatch', fromBusiness: 'Saleem Dispatch' }), 'limited');
  // the same accepter HAS billed the boss -> he is a payer -> all
  asUser(users.driver);
  eq('a: accept, kind-less office request from my payer -> all',
    CL().defaultKindForRequest({ from: 'uid-boss', fromFace: 'office', fromName: 'AI Trucking', fromBusiness: 'AI Trucking' }), 'all');

  /* ============ (b) stamping — request + accept, and the grandfather ============ */
  console.log('(b) stamping — kind on the doc and both con_lists');
  await connectPair(users.disp, users.driver, 'limited');
  const docLD = reqDoc('uid-disp', 'uid-driver');
  eq('b: the request doc carries the proposed kind', docLD.kind, 'limited');
  eq('b: the doc is accepted', docLD.status, 'accepted');
  eq('b: the accepter con_list entry carries the kind', connOf(users.driver, 'uid-disp').kind, 'limited');
  eq('b: the requester con_list entry carries the kind', connOf(users.disp, 'uid-driver').kind, 'limited');
  eq('b: both entries connected', [connOf(users.driver, 'uid-disp').status, connOf(users.disp, 'uid-driver').status], ['connected', 'connected']);
  // the accepter may CHANGE the proposal at accept: boss proposes
  // limited by hand, driver accepts as all
  await connectPair(users.boss, users.driver2, 'limited', undefined, 'all');
  eq('b: accept changed the kind — the doc carries the accepted kind', reqDoc('uid-boss', 'uid-driver2').kind, 'all');
  eq('b: accept changed the kind — both entries carry it',
    [connOf(users.driver2, 'uid-boss').kind, connOf(users.boss, 'uid-driver2').kind], ['all', 'all']);
  // grandfather: a pair formed with NO kind anywhere (pre-v148)
  const u3 = { uid: 'uid-old1', email: 'old1@example.com', role: 'office', store: makeStore({ onboarding: { companyName: 'Old Payer', accountType: 'Fleet Manager', userRole: 'office' }, con_list: [], dsp_list: [], dsp_active: null }) };
  const u4 = { uid: 'uid-old2', email: 'old2@example.com', role: 'driver', store: makeStore({ onboarding: { companyName: 'Old Driver', accountType: 'Driver', userRole: 'driver' }, con_list: [], dsp_list: [], dsp_active: null }) };
  users['old1'] = u3; users['old2'] = u4;
  await connectPair(u3, u4, undefined);
  const eOld = connOf(u4, 'uid-old1');
  check('b: grandfather pair — no kind key materializes on the entry', !!eOld && !('kind' in eOld));
  eq('b: grandfather pair reads as all', CL().kindOf(eOld), 'all');
  check('b: grandfather doc carries no kind either', !('kind' in reqDoc('uid-old1', 'uid-old2')));

  /* ============ (c) Limited publishing gates ============ */
  console.log('(c) Limited — what the driver publishes (and withholds)');
  // the driver also connects to his payer at All for contrast
  await connectPair(users.driver, users.boss, 'all');
  asUser(users.driver);
  await CP().publishAll();
  await CP().publishRecords();
  const day = dayDoc(TODAY);
  check('c: the day doc exists', !!day);
  eq('c: day viewers = the All payer ONLY (limited dispatcher excluded)', day.viewers, ['uid-boss']);
  const rec = recDoc();
  eq('c: records viewers = the All payer ONLY', rec.viewers, ['uid-boss']);
  const photoDocs = Array.from(db._col('sharedphotos').values());
  eq('c: exactly one photo doc, viewers = All payer only', photoDocs.map((p) => p.viewers), [['uid-boss']]);
  check('c: NO billing doc is written for the limited dispatcher', !billDoc('uid-disp'));
  check('c: the payer billing doc carries his invoice', !!billDoc('uid-boss') && billDoc('uid-boss').invoices.map((i) => i.no).join() === '1151');
  const mf = mfDoc('uid-disp');
  check('c: a manifests doc crosses to the limited dispatcher', !!mf);
  keysEq('c: manifests doc shape', mf, ['driver', 'viewer', 'driverName', 'driverBusiness', 'manifests', 'updatedAt']);
  eq('c: the manifests carry ONLY the day he dispatched', (mf.manifests[0].days || []).map((d) => d.date), [D_YEST]);
  check('c: the dispatched day lines ride (job named)', JSON.stringify(mf.manifests).indexOf('Dispatcher Yard Job') !== -1);
  check('c: the private day NEVER crosses in the manifests', JSON.stringify(mf.manifests).indexOf('Private Job') === -1);
  check('c: no manifest doc for the All payer (his ride sharedbilling)', !mfDoc('uid-boss'));
  // the pipe still flows BOTH ways on a limited connection
  asUser(users.disp);
  eq('c: dispatcher can still SEND a dispatch down the pipe', await CP().sendDispatch('uid-driver', { date: TODAY, jobSite: 'Limited Job', material: '', equipment: '', notes: '' }), 'sent');
  asUser(users.driver);
  eq('c: the dispatch lands in the driver list', await CP().pullInbox(), 1);
  eq('c: driver can send one back up the pipe', await CP().sendDispatch('uid-disp', { date: TODAY, jobSite: 'Back Job', material: '', equipment: '', notes: '' }), 'sent');

  /* ============ (d) Limited reading gates ============ */
  console.log('(d) Limited — what the office side can read and render');
  // a STALE full day doc still naming the dispatcher as a viewer
  // (published before the kind existed): the reader must refuse it
  db._col('shareddays').set('uid-driver_2026-10-15', {
    driver: 'uid-driver', date: '2026-10-15', driverName: 'Asjad Kamal', driverBusiness: 'Asjad Kamal',
    viewers: ['uid-disp'], session: { hours: 9, active: false, startedAt: null, endedAt: null, km: 10 },
    dispatches: [], close: { source: 'entry', foremanHours: 8, travelHours: 1, bonusHours: 0, loads: 2, material: 'Clay', ticketNo: '1' },
    loads: 2, ticketsClosed: 0, updatedAt: Date.now()
  });
  asUser(users.disp);
  /* v176 (L1) SUPERSEDES the v148 line below: a pre-v176 Limited pair reads as the
     legacy preset ['dispatch','manifest'], and Dispatch ticked means the board days
     DO cross. What Limited still never carries is the money picture (see the P&L
     crew-card checks in this section + crewWagesFor). */
  check('d: fetchCrewRange gives a legacy-limited viewer his dispatch days (v176 L1 preset)', (await CP().fetchCrewRange('2026-10-01', '2026-10-31')).filter((d) => d.driver === 'uid-driver').length >= 1);
  const fr = await CP().fetchRecords();
  check('d: fetchRecords hands a limited peer NO records', !fr.records['uid-driver']);
  check('d: fetchRecords hands a limited peer NO billing', !fr.billing['uid-driver']);
  check('d: fetchRecords hands a limited peer his manifests', !!fr.manifests['uid-driver']);
  // the P&L crew card on the dispatcher's face: renders through
  // the real module — NO money/fuel/invoice surfaces for the
  // limited driver, and his manifests DO show
  const pnlBody = makeBody();
  sb.Meticulous.modules.pnl.render(pnlBody);
  await flush();
  /* v181 (D5 REDEFINED, owner Oct 20, 2026 19:53–19:54) SUPERSEDES
     the v148/v176 crew-card checks that stood here: there is NO
     crew card on the P&L face at all any more — no manifest door,
     no fuel, no invoices, no money picture. P&L keeps only the
     Monthly analysis; Connect detail lives in Connect. The wage
     LEG gate below (crewWagesFor) is unchanged and still tested. */
  const crewHtmlOut = pnlBody.innerHTML || '';
  check('d: P&L face has NO crew card at all (D5)',
    crewHtmlOut.indexOf('Connected crew') === -1 && crewHtmlOut.indexOf('pnl_crew') === -1 &&
    crewHtmlOut.indexOf('data-pnlmanl') === -1, crewHtmlOut.slice(0, 300));
  check('d: P&L face shows NO fuel dump for a limited driver',
    crewHtmlOut.indexOf('Petro-Canada') === -1 && crewHtmlOut.indexOf('His fuel') === -1);
  check('d: P&L face shows NO invoice dump for a limited driver',
    crewHtmlOut.indexOf('His pay invoices') === -1);
  check('d: P&L face shows NO crew money picture for a limited driver',
    crewHtmlOut.indexOf('Revenue (your client rate)') === -1 && crewHtmlOut.indexOf('Crew revenue') === -1);
  // crewWagesFor: poison the cache with full priced days for the
  // limited driver — no leg may be booked
  const pnl = sb.Meticulous.modules.pnl;
  users.disp.store.set('__crew_days', { '2026-10': [dayDoc(TODAY) || {
    driver: 'uid-driver', date: TODAY, driverName: 'Asjad Kamal', session: { hours: 11, km: 90 },
    dispatches: [{ id: 'x', status: 'completed', foremanHours: 10, travelHours: 1, loads: 3, tickets: [] }], close: null, loads: 3
  }] });
  users.disp.store.set('pnl_drivers', [{ id: 'pdX', name: 'Asjad Kamal', payType: 'hourly', rate: 29, uid: 'uid-driver', viaConnect: true }]);
  const calc = pnl._calc('2026-10');
  eq('d: crew wages booked for a limited driver = 0 (no P&L leg)', calc.crewWages, 0);
  check('d: no per-driver leg either', !calc.crewWagesByDriver || !calc.crewWagesByDriver['uid-driver']);
  users.disp.store.set('pnl_drivers', []);
  users.disp.store.set('__crew_days', {});

  /* ============ (e) One-Time — the connection that ends itself ============ */
  console.log('(e) One-Time — stamp, flow, self-end, re-connect');
  const u5 = { uid: 'uid-onceboss', email: 'onceboss@example.com', role: 'office', store: makeStore({ onboarding: { companyName: 'One Job Payer', accountType: 'Fleet Manager', userRole: 'office', billingRate: 55 }, con_list: [], dsp_list: [], dsp_active: null, pnl_drivers: [] }) };
  users['onceboss'] = u5;
  // driver2 has a pipe dispatch FROM uid-onceboss dated TODAY,
  // still OPEN — the pair is made for that job's day
  const onceDsp = {
    id: 'dsp-once', jobSite: 'One Day Job', date: TODAY, scheduledAt: TODAY + 'T08:00',
    equipment: 'Tandem', material: 'Clay', ticketNo: '777', status: 'saved',
    pipeId: 'pd-once-1', pipeFrom: 'uid-onceboss', tickets: []
  };
  users.driver2.store.set('dsp_list', [onceDsp]);
  users.driver2.store.set('sessions', [{ date: TODAY, seconds: 6 * 3600, endedAt: new Date(Date.now() - 3600e3).toISOString(), liveKm: 40 }]);
  users.driver2.store.set('rev_entries', [{ date: TODAY, type: 'hourly', hours: '6', amount: '150', note: 'Dispatch: One Day Job', foremanHours: 5, travelHours: 1 }]);
  await connectPair(u5, users.driver2, 'once', TODAY);
  const docOnce = reqDoc('uid-onceboss', 'uid-driver2');
  eq('e: the once doc carries kind + the day it is for', [docOnce.kind, docOnce.onceDate], ['once', TODAY]);
  eq('e: both entries carry the once kind', [connOf(users.driver2, 'uid-onceboss').kind, connOf(u5, 'uid-driver2').kind], ['once', 'once']);
  // while alive it flows at All scope: the driver2 day publishes to him
  asUser(users.driver2);
  const beforeEnd = CP().buildDay(TODAY);
  check('e: while alive, the once peer IS a day viewer', !!beforeEnd && beforeEnd.viewers.indexOf('uid-onceboss') !== -1);
  eq('e: while alive, the connection stays connected', connOf(users.driver2, 'uid-onceboss').status, 'connected');
  await CP().publishDay(TODAY);
  // the riding dispatch COMPLETES on the driver's books, dated
  // the once day -> his next reconcile ends the connection (the
  // day-end trigger cannot fire: today IS the once day)
  const dl = users.driver2.store.get('dsp_list', []);
  dl[0] = Object.assign({}, dl[0], { status: 'completed', tickets: [{ id: 'tx', cardNumber: '777', material: 'Clay', loads: 1, foremanHours: 5, photo: null }] });
  users.driver2.store.set('dsp_list', dl);
  await CL().reconcile();
  eq('e: driver side — the entry ended itself when the day closed', connOf(users.driver2, 'uid-onceboss').status, 'ended');
  check('e: endedAt is stamped on the pair doc', (reqDoc('uid-onceboss', 'uid-driver2').endedAt || 0) > 0);
  // publishing stops: the day no longer names him
  await CP().publishDay(TODAY);
  const dayAfter = db._col('shareddays').get('uid-driver2_' + TODAY);
  check('e: after the end, the day doc no longer names him', !dayAfter || (dayAfter.viewers || []).indexOf('uid-onceboss') === -1);
  // the other side ends on ITS next reconcile
  asUser(u5);
  await CL().reconcile();
  eq('e: payer side — the entry ended on reconcile', connOf(u5, 'uid-driver2').status, 'ended');
  // a fresh connection can be made again: the ended doc re-opens
  eq('e: re-connect sends again over the ended pair', await CL().sendRequest({ uid: 'uid-driver2', name: 'Second Driver Co', business: '', role: 'Driver', face: 'driver', person: '' }, 'once', TODAY), 'sent');
  eq('e: the doc is pending again, the end cleared', [reqDoc('uid-onceboss', 'uid-driver2').status, reqDoc('uid-onceboss', 'uid-driver2').endedAt], ['pending', 0]);
  // day-end trigger on a second pair: once for TODAY, nothing
  // closes it — tomorrow, it ends by itself on reconcile
  const u6 = { uid: 'uid-dayend', email: 'dayend@example.com', role: 'office', store: makeStore({ onboarding: { companyName: 'Day End Co', accountType: 'Fleet Manager', userRole: 'office' }, con_list: [], dsp_list: [], dsp_active: null }) };
  users['dayend'] = u6;
  await connectPair(u6, users.driver, 'once', TODAY);
  eq('e: day-end pair alive on its day', connOf(users.driver, 'uid-dayend').status, 'connected');
  TODAY = '2026-10-18';
  asUser(users.driver);
  await CL().reconcile();
  eq('e: the day ending ends it by itself', connOf(users.driver, 'uid-dayend').status, 'ended');
  TODAY = '2026-10-17';

  /* ============ (f) kind change re-governs ============ */
  console.log('(f) kind change — All -> Limited -> All');
  asUser(users.driver);
  check('f: boss pair starts at all', connOf(users.driver, 'uid-boss').kind === 'all');
  asUser(users.boss);
  eq('f: at All, the payer reads the day', (await CP().fetchCrewRange('2026-10-01', '2026-10-31')).filter((d) => d.driver === 'uid-driver' && d.date === TODAY).length, 1);
  // the boss sends one job down the pipe (so a manifest day of
  // his exists on the driver's books before the flip)
  asUser(users.boss);
  eq('f: the boss dispatches a job for a past day', await CP().sendDispatch('uid-driver', { date: '2026-10-12', jobSite: 'Boss Sent Job', material: '', equipment: '', notes: '' }), 'sent');
  asUser(users.driver);
  eq('f: the job lands on the driver books', await CP().pullInbox(), 1);
  // the DRIVER flips the pair to limited from his side — prime
  // this session's publish first, so the flip's republish is the
  // very next cycle (the v146 revocation posture)
  await CP().publishAll();
  eq('f: setKind applies', await CL().setKind('uid-boss', 'limited'), true);
  eq('f: my entry re-stamps at once', connOf(users.driver, 'uid-boss').kind, 'limited');
  eq('f: the pair doc re-stamps (the other side will follow)', reqDoc('uid-driver', 'uid-boss').kind, 'limited');
  await CP().publishAll();
  eq('f: after the flip, day viewers exclude the now-limited payer', dayDoc(TODAY).viewers, []);
  eq('f: after the flip, records viewers exclude him', recDoc().viewers, []);
  const billAfterFlip = billDoc('uid-boss');
  check('f: after the flip, his billing doc is emptied', !!billAfterFlip && billAfterFlip.invoices.length === 0 && billAfterFlip.manifests.length === 0);
  check('f: after the flip, a manifests doc appears for him (his dispatched day only)', !!mfDoc('uid-boss') && (mfDoc('uid-boss').manifests[0].days || []).map((d) => d.date).join() === '2026-10-12');
  asUser(users.boss);
  await CL().reconcile();
  eq('f: the payer side entry follows the flip', connOf(users.boss, 'uid-driver').kind, 'limited');
  /* v176 (L1): after the flip to Limited the pair reads as the legacy preset
     (dispatch ticked), so the board days still cross; the money gates are what
     shut (records/billing below + crewWagesFor). */
  check('f: after the flip to Limited the dispatch days still cross (v176 L1 preset)', (await CP().fetchCrewRange('2026-10-01', '2026-10-31')).filter((d) => d.driver === 'uid-driver').length >= 1);
  // and back to All — everything resumes
  asUser(users.driver);
  eq('f: setKind back to all', await CL().setKind('uid-boss', 'all'), true);
  await CP().publishAll();
  eq('f: back at All, day viewers name him again', dayDoc(TODAY).viewers, ['uid-boss']);
  check('f: back at All, his billing carries his invoice again', billDoc('uid-boss').invoices.map((i) => i.no).join() === '1151');
  const mfAfterAll = mfDoc('uid-boss');
  check('f: back at All, the limited manifests doc is emptied', !!mfAfterAll && (mfAfterAll.manifests || []).length === 0);

  /* ============ (g) the Connect screen ============ */
  console.log('(g) the Connect screen — rows, picker, accept select');
  // rows: the driver's connections name their kinds
  asUser(users.driver);
  let body = makeBody();
  sb.Meticulous.modules.connect.render(body);
  await flush();
  const html1 = body.innerHTML;
  check('g: an All row reads Full access', html1.indexOf('Full access') !== -1);
  check('g: a Limited row names its kind', html1.indexOf('Connect limited') !== -1);
  check('g: an ended one-time row reads ended', html1.indexOf('One time connection') !== -1 && /ended/.test(html1));
  check('g: rows carry the kind change control', html1.indexOf('data-cn-kindchg') !== -1);
  check('g: the honesty line now names the kinds', html1.indexOf('kind decides what crosses') !== -1 || html1.indexOf('kinds') !== -1);
  // the picker: a FRESH dispatcher (office face, nobody on his
  // books) searching the driver gets the three kinds with
  // Limited preselected; the send carries the choice
  const fresh = { uid: 'uid-fresh', email: 'fresh@example.com', role: 'office', store: makeStore({ onboarding: { companyName: 'Fresh Dispatch', accountType: 'Fleet Manager', userRole: 'office' }, con_list: [], dsp_list: [], dsp_active: null, pnl_drivers: [] }) };
  users['fresh'] = fresh;
  asUser(users.driver);
  await CL().publishMine();
  asUser(fresh);
  body = makeBody();
  sb.Meticulous.modules.connect.render(body);
  await flush();
  body._mk('q:#cn_q').value = 'Asjad';
  body._mk('q:#cn_search').onclick();
  await flush();
  const connectBtns = body.querySelectorAll('[data-cn-connect]');
  eq('g: the search found the driver with a Connect button', connectBtns.length, 1);
  connectBtns[0].onclick();
  await flush();
  const pickHtml = (body._els['q:#cn_results'] || {}).innerHTML || '';
  check('g: the picker offers the three kinds in his words',
    pickHtml.indexOf('Connect all') !== -1 && pickHtml.indexOf('Connect limited') !== -1 && pickHtml.indexOf('One time connection') !== -1);
  check('g: the picker preselects Limited for a dispatcher (its meaning line shows)',
    pickHtml.indexOf('Only the modules you tick cross') !== -1, pickHtml.slice(0, 300)); // v176 (L1): the line is the tick law now
  check('g: each kind carries its one plain meaning line',
    pickHtml.indexOf('Everything crosses') !== -1 && pickHtml.indexOf('ends by itself when that day closes') !== -1);
  const sendBtn = body._mk('q:#cn_kind_send');
  check('g: the picker has its send button', typeof sendBtn.onclick === 'function');
  sendBtn.onclick();
  await flush();
  const freshDoc = reqDoc('uid-fresh', 'uid-driver');
  check('g: the sent request carries the preselected kind', !!freshDoc && freshDoc.kind === 'limited' && freshDoc.status === 'pending');
  // the accept row on the driver's side: the kind select rides
  // it, preselected to the proposal; the driver changes it to
  // All as he accepts, and the accepted kind governs
  asUser(users.driver);
  body = makeBody();
  sb.Meticulous.modules.connect.render(body);
  await flush();
  const reqHtml = (body._els['q:#cn_req_wrap'] || {}).innerHTML || '';
  check('g: the accept row carries the kind select', reqHtml.indexOf('data-cn-kindsel') !== -1, reqHtml.slice(0, 300));
  check('g: the accept select is preselected to the proposal (limited meaning shows)',
    reqHtml.indexOf('Only the modules you tick cross') !== -1); // v176 (L1)
  const kindSel = body.querySelectorAll('[data-cn-kindsel]').filter((el) => el._attrs['data-cn-kindsel'] === 'uid-fresh_uid-driver')[0];
  const acceptBtn = body.querySelectorAll('[data-cn-accept]').filter((el) => el._attrs['data-cn-accept'] === 'uid-fresh_uid-driver')[0];
  check('g: the accept controls are wired', !!kindSel && !!acceptBtn && typeof acceptBtn.onclick === 'function');
  kindSel.value = 'all';
  if (kindSel.onchange) kindSel.onchange();
  acceptBtn.onclick();
  await flush();
  eq('g: the accepted kind governs — doc + entry carry All', [reqDoc('uid-fresh', 'uid-driver').kind, connOf(users.driver, 'uid-fresh').kind], ['all', 'all']);

  /* ============ (h) rules — statics + the mirrored read matrix ============ */
  console.log('(h) rules — kind gates');
  const reqBlock = rulesSrc.slice(rulesSrc.indexOf('match /requests/'), rulesSrc.indexOf('match /shareddays/'));
  /* v176 (L1): the same branch may also move the approver's
     ticked `modules` list — the pin moves with the owner's order. */
  check('h: requests gain the either-party kind-governance branch',
    reqBlock.indexOf("affectedKeys().hasOnly(['kind', 'onceDate', 'modules', 'endedAt', 'updatedAt'])") !== -1);
  check('h: the kind branch holds only on accepted docs',
    reqBlock.indexOf("resource.data.status == 'accepted'") !== -1);
  check('h: an ended pair can be re-opened by its sender',
    reqBlock.indexOf("resource.data.get('endedAt', 0) > 0") !== -1 && reqBlock.indexOf("request.resource.data.get('endedAt', 0) == 0") !== -1);
  const dayBlock = rulesSrc.slice(rulesSrc.indexOf('match /shareddays/'), rulesSrc.indexOf('match /pipedispatches/'));
  const recBlock = rulesSrc.slice(rulesSrc.indexOf('match /sharedrecords/'), rulesSrc.indexOf('match /sharedbilling/'));
  const billBlock = rulesSrc.slice(rulesSrc.indexOf('match /sharedbilling/'), rulesSrc.indexOf('match /sharedphotos/'));
  const photoBlock = rulesSrc.slice(rulesSrc.indexOf('match /sharedphotos/'), rulesSrc.indexOf('match /sharedmanifests/'));
  const mfBlock = rulesSrc.slice(rulesSrc.indexOf('match /sharedmanifests/'));
  check('h: shareddays viewer read is kind-gated', dayBlock.indexOf('pairLimited') !== -1 && dayBlock.indexOf('pairEnded') !== -1);
  check('h: sharedrecords viewer read is kind-gated', recBlock.indexOf('pairLimited') !== -1 && recBlock.indexOf('pairEnded') !== -1);
  check('h: sharedbilling viewer read is kind-gated', billBlock.indexOf('pairLimited') !== -1 && billBlock.indexOf('pairEnded') !== -1);
  check('h: sharedphotos viewer read is kind-gated', photoBlock.indexOf('pairLimited') !== -1 && photoBlock.indexOf('pairEnded') !== -1);
  check('h: sharedmanifests exists — driver + the named viewer only',
    mfBlock.indexOf('match /sharedmanifests/{mfId}') !== -1 &&
    mfBlock.indexOf('request.auth.uid == resource.data.viewer') !== -1 &&
    mfBlock.indexOf('request.auth.uid == request.resource.data.driver') !== -1);
  check('h: sharedmanifests shuts for an ended pair but NOT for a limited one',
    mfBlock.indexOf('pairEnded') !== -1 && mfBlock.indexOf('pairLimited') === -1);
  check('h: nothing in the kind-gated collections is world-readable',
    (dayBlock + recBlock + billBlock + photoBlock + mfBlock).indexOf('allow read: if true') === -1);
  /* behavioural matrix over the REAL docs, mirroring the shipped
     predicates (the statics above pin the predicates themselves) */
  const pairKindOf = (a, b) => {
    const d1 = reqDoc(a, b), d2 = reqDoc(b, a);
    return { limited: [d1, d2].some((d) => d && d.status === 'accepted' && d.kind === 'limited'),
             ended: [d1, d2].some((d) => d && d.status === 'accepted' && (d.endedAt || 0) > 0) };
  };
  const canReadShared = (doc, uid) => {
    if (!doc) return false;
    if (uid === doc.driver) return true;
    const named = doc.viewer ? uid === doc.viewer : (doc.viewers || []).indexOf(uid) !== -1;
    if (!named) return false;
    const pk = pairKindOf(doc.driver, uid);
    return !pk.limited && !pk.ended;
  };
  const canReadManifests = (doc, uid) => {
    if (!doc) return false;
    if (uid === doc.driver) return true;
    if (uid !== doc.viewer) return false;
    return !pairKindOf(doc.driver, uid).ended;
  };
  // plant full docs naming the limited dispatcher, as a stale
  // pre-kind publish would have left them
  const staleRec = { driver: 'uid-driver', viewers: ['uid-disp'], fuel: [], expenses: [], maintenance: null };
  const staleBill = { driver: 'uid-driver', viewer: 'uid-disp', invoices: [{}], manifests: [] };
  eq('h: matrix — limited viewer is shut out of records/billing/day shapes',
    [canReadShared(staleRec, 'uid-disp'), canReadShared(staleBill, 'uid-disp')], [false, false]);
  eq('h: matrix — the All payer reads his docs', [canReadShared(recDoc(), 'uid-boss'), canReadShared(billDoc('uid-boss'), 'uid-boss')], [true, true]);
  eq('h: matrix — the limited viewer DOES read his manifests doc', canReadManifests(mfDoc('uid-disp'), 'uid-disp'), true);
  eq('h: matrix — a stranger reads nothing', [canReadShared(recDoc(), 'uid-stranger'), canReadManifests(mfDoc('uid-disp'), 'uid-stranger')], [false, false]);
  /* the dayend pair ended in (e) and was never re-opened (the
     onceboss pair WAS re-opened — alive again by design) */
  eq('h: matrix — an ended pair is shut out of everything', canReadShared({ driver: 'uid-driver', viewers: ['uid-dayend'] }, 'uid-dayend'), false);

  /* ============ (i) grandfather byte-identity + pins ============ */
  console.log('(i) grandfather — no kind anywhere, nothing changes');
  const dOld = { driver: 'uid-old2' };
  asUser(users.old2);
  users.old2.store.set('dsp_list', [{
    id: 'od1', jobSite: 'Old Job', date: TODAY, scheduledAt: TODAY + 'T08:00', status: 'completed',
    tickets: [{ id: 'ot1', cardNumber: '42', material: 'Clay', loads: 1, foremanHours: 4, photo: null }]
  }]);
  users.old2.store.set('sessions', [{ date: TODAY, seconds: 5 * 3600, endedAt: new Date().toISOString(), liveKm: 20 }]);
  users.old2.store.set('onboarding', { companyName: 'Old Driver', accountType: 'Driver', userRole: 'driver', travelBonus: 0 });
  await CP().publishAll();
  const oldDay = db._col('shareddays').get('uid-old2_' + TODAY);
  check('i: grandfather day publishes to his peer', !!oldDay && oldDay.viewers.join() === 'uid-old1');
  keysEq('i: grandfather day doc — the exact pre-v148 key set', oldDay,
    ['driver', 'date', 'driverName', 'driverBusiness', 'viewers', 'session', 'dispatches', 'close', 'loads', 'ticketsClosed', 'updatedAt']);
  check('i: no kind keys anywhere in the published docs', JSON.stringify(oldDay).indexOf('"kind"') === -1);
  check('i: index loads both engines at the shipped version',
    idxSrc.indexOf('js/connectlive.js?v=' + ver.webVersion) !== -1 && idxSrc.indexOf('js/connectpipe.js?v=' + ver.webVersion) !== -1);

  console.log('\nconnect-kinds-v148 test: ' + pass + '/' + (pass + fail) + ' passed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
