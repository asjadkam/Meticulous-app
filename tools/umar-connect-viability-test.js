#!/usr/bin/env node
/* umar-connect-viability-test.js — UMAR CONNECT, EXHAUSTIVE
 * VIABILITY CAMPAIGN (owner's order, Oct 23, 2026 06:57 MDT:
 * "make sure a million times that umars connection is viable
 * and he sees everything that is going on daily").
 *
 * The v226 suite (tools/umar-connect-blank-test.js) proved the
 * plain close -> publish -> partner-fetch path and the two
 * rollback shapes for the DAY doc. This campaign goes wider:
 * the whole Full-access surface (every closed day in history,
 * dispatches + manifests, fuel + receipt photos, expenses,
 * PTI, maintenance, wage, billing) and a ten-scenario matrix:
 *
 *   S1  full-access surface, exact figures, every section
 *   S2  rolled-back republish across today + yesterday (+ a
 *       history day republished by a later sweep)
 *   S3  CANCELLED day (today Oct 23 is one): the partner view
 *       must show the day as cancelled/no-work — never an open
 *       job, never phantom hours — in BOTH orders (cancel after
 *       publish, cancel before first publish)
 *   S4  fuel + expense day with no dispatch: records carry it
 *   S5  corrected close: the partner ends on the corrected card
 *   S6  back-to-back days closed while the partner app is away;
 *       a partner on the PREVIOUS web build reads the new docs
 *   S7  revoke: viewers pruned, billing emptied, photo viewers
 *       cleared — and the preserve logic must NOT resurrect
 *       the revoked partner on a later rolled-back republish
 *   S8  records-doc rollback (the gap parked by the v226 run):
 *       fuel/receipts/expenses/PTI/maintenance + the billing
 *       doc + a limited peer's manifests doc under a rolled-
 *       back store republish
 *   S9  fresh Full pair formed today: complete history crosses
 *       at pair formation (the Oct 18 law), not just new closes
 *   S10 Maria's LIMITED pair: exactly her ticked scope — no
 *       wider, no narrower — and it survives the S8 rollback
 *
 * Same idiom as the v226 suite: the REAL boot stack in two/three
 * vm worlds over one fake Firestore. Run:
 *   TZ=America/Edmonton node tools/umar-connect-viability-test.js
 * PROBE=1 prints the published docs after the S1 publish.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; } else { fail++; console.log('  FAIL: ' + m); } }
function eq(a, b, m) { ok(a === b, m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/* ---------------- FakeEl DOM ---------------- */
function makeDom() {
  const byId = new Map();
  const created = [];
  class FakeEl {
    constructor(tag) {
      this.tagName = String(tag || 'div').toUpperCase();
      this._html = ''; this._text = ''; this.value = ''; this.checked = false;
      this.disabled = false; this.files = []; this.style = {}; this.dataset = {};
      this.children = []; this._qs = {};
      this.classList = {
        _s: new Set(),
        add(...cs) { cs.forEach((c) => this._s.add(c)); },
        remove(...cs) { cs.forEach((c) => this._s.delete(c)); },
        contains(c) { return this._s.has(c); },
        toggle(c, force) {
          const on = force === undefined ? !this._s.has(c) : !!force;
          if (on) this._s.add(c); else this._s.delete(c); return on;
        }
      };
    }
    get innerHTML() { return this._html; }
    set innerHTML(v) { this._html = String(v == null ? '' : v); if (!v) this.children = []; }
    get textContent() { return this._text; }
    set textContent(v) { this._text = String(v == null ? '' : v); }
    appendChild(c) { if (c) this.children.push(c); return c; }
    insertBefore(c) { if (c) this.children.push(c); return c; }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
    remove() {}
    click() { if (typeof this.onclick === 'function') this.onclick({ preventDefault() {}, stopPropagation() {} }); }
    setAttribute() {} getAttribute() { return null; }
    addEventListener() {} removeEventListener() {}
    scrollIntoView() {} focus() {} blur() {}
    getContext() { return null; }
    querySelector(sel) {
      if (!this._qs[sel]) { const e = new FakeEl('div'); created.push(e); this._qs[sel] = e; }
      return this._qs[sel];
    }
    querySelectorAll() { return []; }
  }
  const document = {
    readyState: 'complete', visibilityState: 'visible', hidden: false,
    body: new FakeEl('body'),
    getElementById(id) {
      if (!byId.has(id)) { const e = new FakeEl('div'); e.id = id; byId.set(id, e); }
      return byId.get(id);
    },
    createElement(tag) {
      const e = new FakeEl(tag); created.push(e);
      /* the receipt rendition path needs a working canvas */
      if (String(tag).toLowerCase() === 'canvas') {
        e.getContext = () => ({ drawImage() {} });
        e.toDataURL = () => 'data:image/jpeg;base64,RENDITION';
      }
      return e;
    },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; }
  };
  return { document, byId };
}

/* ---------------- localStorage stub ---------------- */
function makeLS(seed) {
  const m = new Map();
  Object.keys(seed || {}).forEach((k) => m.set(k, String(seed[k])));
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(String(k), String(v)); },
    removeItem(k) { m.delete(k); },
    clear() { m.clear(); },
    key(i) { return Array.from(m.keys())[i] || null; },
    get length() { return m.size; },
    _map: m
  };
}
function mtSeed(obj) {
  const o = {};
  Object.keys(obj).forEach((k) => { o['mt_' + k] = JSON.stringify(obj[k]); });
  return o;
}

/* ---------------- fake Firestore ---------------- */
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

/* ---------------- FB stub ---------------- */
function makeFB(cloud, db, writes) {
  const FB = {
    ready: true, user: null, db,
    loadDocs() {
      const uid = FB.user && FB.user.uid;
      const kv = (uid && cloud[uid]) || {};
      return Promise.resolve(Object.keys(kv).map((k) => ({
        id: k, v: clone(kv[k].v), updatedAt: kv[k].ts
      })));
    },
    saveDoc(col, id, data) {
      if (!FB.user) return Promise.resolve(null);
      writes.push({ uid: FB.user.uid, id });
      const kv = cloud[FB.user.uid] || (cloud[FB.user.uid] = {});
      kv[id] = { v: clone(data.v), ts: Date.now() };
      return Promise.resolve({});
    },
    deleteDoc(col, id) {
      if (FB.user && cloud[FB.user.uid]) delete cloud[FB.user.uid][id];
      return Promise.resolve({});
    }
  };
  return FB;
}

const MODULES = ['dispatch', 'revenue', 'fuel', 'pnl', 'maintenance', 'pti',
  'damage', 'manifest', 'invoice', 'connect', 'preferences', 'account'];
function bootWorld(seedLS, cloud, db, writes, overrides) {
  const dom = makeDom();
  const LS = makeLS(seedLS);
  const FB = makeFB(cloud, db, writes);
  const capT = (fn, ms, ...a) => setTimeout(fn, Math.min(ms || 0, 250), ...a);
  class FakeImage {
    constructor() { this.width = 1200; this.height = 800; }
    set src(v) { const f = this.onload; if (f) setTimeout(() => f(), 0); }
    get src() { return ''; }
  }
  const sb = {
    console, setTimeout: capT, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    Promise, Date, JSON, Math, URLSearchParams, Intl,
    document: dom.document, localStorage: LS, Image: FakeImage,
    navigator: { onLine: true, userAgent: 'node-harness' },
    location: { reload() {}, search: '', hash: '', href: 'http://harness/' },
    alert() {}, confirm() { return true; }, prompt() { return null; },
    scrollTo() {}, addEventListener() {}, removeEventListener() {},
    FB, Meticulous: { modules: {}, shared: {} }
  };
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  vm.createContext(sb);
  const load = (p) => vm.runInContext((overrides && overrides[p]) || read(p), sb, { filename: p });
  load('js/cloudsync.js');
  load('js/connectlive.js');
  load('js/connectpipe.js');
  load('js/ticket-ocr.js');
  MODULES.forEach((m) => load('modules/' + m + '.js'));
  load('js/app.js');
  return { sb, dom, LS, FB, App: sb.window.App, CP: sb.window.ConnectPipe, CL: sb.window.ConnectLive };
}

async function settle(rounds) {
  for (let i = 0; i < (rounds || 40); i++) {
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 1));
  }
}

/* ------------------------- fixtures ------------------------- */
const MAIN = '72kLjT1dbCOLdW6BvrmXsFpPi0g1';
const UMAR = 'BbrMZxRs8eOY9uRJVWrkPhAlxaH3';
const TESTER = 'XxgAtELVbDO32vA0wa6JKwDxALz2';
const MARIA = 'WH3rL1aWGMSAkUf01xRcLkm46Di2';
const NEWBOSS = 'Nb7Xk2Qp9wRtYuIoP4sDfGhJkLz3';
const NOW = Date.now();
const OLD_TS = NOW - 86400000;
const NS_TS = NOW - 3600000;
const LEGACY_TS_OLD = NOW - 7200000;

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const _now = new Date();
const T = ymd(_now);
const D1 = ymd(new Date(_now.getTime() - 1 * 86400000));
const D2 = ymd(new Date(_now.getTime() - 2 * 86400000));
const D3 = ymd(new Date(_now.getTime() - 3 * 86400000));
const D4 = ymd(new Date(_now.getTime() - 4 * 86400000));
const D10 = ymd(new Date(_now.getTime() - 10 * 86400000));

const PROFILE_MAIN = {
  firstName: 'Asjad', lastName: 'Kamal', accountType: 'Driver', userRole: 'driver',
  business: 'Asjad Kamal', companyName: 'Asjad Kamal', nameAsked: true,
  travelBonus: 1, payStandard: 'hourly', ownWageRate: 29
};
const PROFILE_UMAR = {
  firstName: 'Umar', lastName: '', accountType: 'Owner-Operator', userRole: 'both',
  business: 'AI Trucking', companyName: 'AI Trucking', nameAsked: true, billingRate: 93
};
const PROFILE_MARIA = {
  firstName: 'Maria', lastName: 'Lott', accountType: 'Fleet Manager', userRole: 'office',
  business: 'Dynamic Trucking', companyName: 'Dynamic Trucking', nameAsked: true
};
const PROFILE_NB = {
  firstName: 'New', lastName: 'Boss', accountType: 'Owner-Operator', userRole: 'both',
  business: 'NB Trucking', companyName: 'NB Trucking', nameAsked: true, billingRate: 93
};

const ENTRY_SELF = { id: 'u' + MAIN, name: 'Asjad Kamal', business: 'Asjad Kamal', role: 'Driver', kind: 'all', status: 'connected', uid: MAIN };
const ENTRY_UMAR = { id: 'u' + UMAR, name: 'AI Trucking', business: 'AI Trucking', role: 'Owner-Operator', status: 'connected', uid: UMAR, viaConnect: true };
const ENTRY_TESTER = { id: 'u' + TESTER, name: 'Dave Cooper', business: 'Testing trucking', role: 'Owner-Operator', kind: 'all', status: 'connected', uid: TESTER, viaConnect: true };
const ENTRY_MARIA = { id: 'u' + MARIA, name: 'Maria Lott', business: 'Dynamic Trucking', role: 'Fleet Manager', kind: 'limited', modules: ['dispatch', 'manifest', 'pti', 'navigation'], status: 'connected', uid: MARIA, viaConnect: true };
const ENTRY_NEWBOSS = { id: 'u' + NEWBOSS, name: 'NB Trucking', business: 'NB Trucking', role: 'Owner-Operator', kind: 'all', status: 'connected', uid: NEWBOSS, viaConnect: true };
const GOOD_LIST = [ENTRY_SELF, ENTRY_UMAR, ENTRY_TESTER, ENTRY_MARIA];
const ENTRY_MAIN_FOR_UMAR = { id: 'u' + MAIN, name: 'Asjad Kamal', business: 'Asjad Kamal', role: 'Driver', status: 'connected', uid: MAIN, viaConnect: true };
const ENTRY_MAIN_FOR_MARIA = { id: 'u' + MAIN, name: 'Asjad Kamal', business: 'Asjad Kamal', role: 'Driver', kind: 'limited', modules: ['dispatch', 'manifest', 'pti', 'navigation'], status: 'connected', uid: MAIN, viaConnect: true };
const ENTRY_MAIN_FOR_NB = { id: 'u' + MAIN, name: 'Asjad Kamal', business: 'Asjad Kamal', role: 'Driver', status: 'connected', uid: MAIN, viaConnect: true };

function buildDb(withNewBoss) {
  const db = new FakeDb();
  const requests = db._col('requests');
  requests.set(MAIN + '_' + UMAR, {
    from: MAIN, to: UMAR, fromName: 'Asjad Kamal', fromBusiness: 'Asjad Kamal',
    fromRole: 'Driver', toName: 'AI Trucking', toBusiness: 'AI Trucking',
    toRole: 'Owner-Operator', status: 'accepted', createdAt: OLD_TS, updatedAt: OLD_TS
  });
  requests.set(MARIA + '_' + MAIN, {
    from: MARIA, to: MAIN, fromName: 'Maria Lott', fromBusiness: 'Dynamic Trucking', fromRole: 'Fleet Manager',
    fromFace: 'office', fromPerson: 'Maria Lott', toName: 'Asjad Kamal', toBusiness: 'Asjad Kamal',
    toRole: 'Driver', toFace: 'driver', kind: 'limited', modules: ['dispatch', 'manifest', 'pti', 'navigation'],
    status: 'accepted', createdAt: OLD_TS, updatedAt: OLD_TS
  });
  requests.set(TESTER + '_' + MAIN, {
    from: TESTER, to: MAIN, fromName: 'Dave Cooper', fromBusiness: 'Testing trucking',
    toName: 'Asjad Kamal', toBusiness: 'Asjad Kamal', toRole: 'Driver',
    kind: 'all', status: 'accepted', createdAt: OLD_TS, updatedAt: OLD_TS
  });
  if (withNewBoss) {
    requests.set(NEWBOSS + '_' + MAIN, {
      from: NEWBOSS, to: MAIN, fromName: 'NB Trucking', fromBusiness: 'NB Trucking',
      toName: 'Asjad Kamal', toBusiness: 'Asjad Kamal', toRole: 'Driver',
      kind: 'all', status: 'accepted', createdAt: NOW, updatedAt: NOW
    });
  }
  const directory = db._col('directory');
  directory.set(MAIN, { name: 'Asjad Kamal', business: 'Asjad Kamal', role: 'Driver', face: 'driver', person: 'Asjad Kamal' });
  directory.set(UMAR, { name: 'AI Trucking', business: 'AI Trucking', role: 'Owner-Operator', face: 'both', person: 'Umar' });
  directory.set(TESTER, { name: 'Dave Cooper', business: 'Testing trucking', role: 'Owner-Operator', face: 'office', person: 'Dave Cooper' });
  directory.set(MARIA, { name: 'Maria Lott', business: 'Dynamic Trucking', role: 'Fleet Manager', face: 'office', person: 'Maria Lott' });
  directory.set(NEWBOSS, { name: 'NB Trucking', business: 'NB Trucking', role: 'Owner-Operator', face: 'both', person: 'New Boss' });
  return db;
}

/* one completed dispatch record as the driver's books hold it */
function dspRec(id, date, ticketNo, foreman, loads, opts) {
  const o = opts || {};
  const d = {
    id: id, date: date, scheduledAt: date + 'T08:00:00', jobSite: o.jobSite || 'Aecon Inf',
    material: o.material || 'Clay', ticketNo: ticketNo, status: o.status || 'completed',
    tickets: o.noTickets ? [] : [{ cardNumber: ticketNo, ticketNo: ticketNo, foremanHours: foreman, loads: loads, material: o.material || 'Clay' }],
    startedAt: Date.parse(date + 'T08:00:00'), endedAt: Date.parse(date + 'T17:00:00')
  };
  if (o.pipeFrom) { d.pipeFrom = o.pipeFrom; d.pipeId = o.pipeId || ''; }
  return d;
}
function revEntry(id, date, foreman, travel, amount, loads, note) {
  return { id: id, date: date, hours: foreman + travel, amount: amount, foremanHours: foreman, travelHours: travel, loads: loads, note: note, auto: false };
}
function sessionRec(date, seconds, liveKm) {
  return { date: date, seconds: seconds, endedAt: date + 'T17:00:00', liveKm: liveKm };
}

const FILLS = [
  { date: D3, time: '09:12', station: 'Petro-Canada', litres: 80.5, cost: 185.00, odo: 169800, photo: 'data:image/jpeg;base64,PHOTOF1DATA' },
  { date: D2, time: '13:05', station: 'Mobil', litres: 64.1, cost: 146.72, odo: 169950 },
  { date: T, time: '12:47', station: 'Petro-Canada', litres: 99.047, cost: 239.59, odo: 169999, photo: 'data:image/jpeg;base64,PHOTOF3DATA' },
  { date: D4, time: '08:03', station: 'Petro-Canada', litres: 50.25, cost: 120.10, odo: 169700 }
];
const EXPENSES = [
  { date: D2, what: 'Tire repair', cost: 145.00 },
  { date: T, what: 'Truck wash', cost: 45.50 },
  { date: D4, what: 'DEF fluid', cost: 32.99 }
];
const PTIS = [
  { date: T, filedAt: Date.parse(T + 'T07:24:00'), kind: 'pre', signed: true, unit: '07', plate: '04 R209', odometer: 169888, location: 'Home', result: 'pass', driverName: 'Asjad Kamal', defects: [] },
  { date: D2, filedAt: Date.parse(D2 + 'T17:30:00'), kind: 'post', signed: true, unit: '07', plate: '04 R209', odometer: 169975, location: 'Yard', result: 'minor', driverName: 'Asjad Kamal', defects: [{ item: 'Mirror', severity: 'minor', note: 'Cracked' }] }
];
const MT_EVENTS = [{ date: D10, type: 'Oil change', odo: 169500, cost: 189.99, notes: '' }];
const INV1 = {
  id: 'inv1152', no: '1152', date: T, billTo: 'AI Trucking', pa: D3, pb: T,
  sub: 1357.14, tax: 67.86, total: 1425.00, taxRate: 5, taxIncluded: false, rate: 29,
  revLines: [], items: [], payments: [], company: null,
  dayHours: { [D3]: 9, [D2]: 10.5, [D1]: 11, [T]: 11 }, cardDays: null, truckNo: '07', notes: ''
};

/* Asjad's full books: four closed days + today's #22864 close */
function richStore() {
  return {
    onboarding: clone(PROFILE_MAIN), onboarded: true,
    dsp_list: [
      dspRec('dspA', D3, '10101', 8, 5, { jobSite: 'Pit A', material: 'Gravel' }),
      dspRec('dspB', D2, '20202', 9.5, 12, {}),
      dspRec('dspM', D2, '20203', 2, 3, { pipeFrom: MARIA, pipeId: 'pdMaria1' }),
      dspRec('dspC', D1, '30303', 10, 8, {}),
      dspRec('dspT', T, '22864', 10, 8, {})
    ],
    rev_entries: [
      revEntry('revA', D3, 8, 1, 261, 5, 'Dispatch: Pit A'),
      revEntry('revB', D2, 9.5, 1, 304.50, 12, 'Dispatch: Aecon Inf'),
      revEntry('revC', D1, 10, 1, 319, 8, 'Dispatch: Aecon Inf'),
      revEntry('revT', T, 10, 1, 319, 8, 'Dispatch: Aecon Inf')
    ],
    sessions: [sessionRec(D3, 30600, 120), sessionRec(D2, 34200, 150), sessionRec(D1, 33580, 139), sessionRec(T, 33580, 141)],
    fuel_fills: clone(FILLS), fuel_expenses: clone(EXPENSES), pti_reports: clone(PTIS),
    mt_odo: 170079, mt_nextServiceOdo: 175429, mt_nextServiceDate: '2026-11-27',
    mt_annualDate: '2027-05-31', mt_events: clone(MT_EVENTS),
    inv_list: [clone(INV1)]
  };
}

function cloudFor(uid, storeObj, conList, extra) {
  const kv = {};
  Object.keys(storeObj).forEach((k) => { kv[k] = { v: clone(storeObj[k]), ts: OLD_TS }; });
  kv.con_list = { v: clone(conList), ts: LEGACY_TS_OLD };
  kv['con_list__' + uid] = { v: clone(conList), ts: NS_TS };
  Object.keys(extra || {}).forEach((k) => { kv[k] = extra[k]; });
  return kv;
}
function mainCloud(storeObj, conList, histPeers) {
  const cloud = {};
  const extra = {};
  if (histPeers) {
    extra.cp_hist_peers = { v: clone(histPeers), ts: OLD_TS };
    extra['cp_hist_peers__' + MAIN] = { v: clone(histPeers), ts: OLD_TS };
  }
  cloud[MAIN] = cloudFor(MAIN, storeObj, conList, extra);
  cloud[UMAR] = {
    onboarding: { v: clone(PROFILE_UMAR), ts: OLD_TS },
    ['con_list__' + UMAR]: { v: [clone(ENTRY_MAIN_FOR_UMAR)], ts: OLD_TS }
  };
  cloud[MARIA] = {
    onboarding: { v: clone(PROFILE_MARIA), ts: OLD_TS },
    ['con_list__' + MARIA]: { v: [clone(ENTRY_MAIN_FOR_MARIA)], ts: OLD_TS }
  };
  cloud[NEWBOSS] = {
    onboarding: { v: clone(PROFILE_NB), ts: OLD_TS },
    ['con_list__' + NEWBOSS]: { v: [clone(ENTRY_MAIN_FOR_NB)], ts: OLD_TS }
  };
  return cloud;
}
function mainLS(storeObj, conList, histPeers) {
  const seed = Object.assign({}, storeObj, {
    ['con_list__' + MAIN]: conList, con_hidden: [],
    __syncmeta: { uid: MAIN, globallySynced: true, keys: {} }
  });
  if (histPeers) seed['cp_hist_peers__' + MAIN] = histPeers;
  return mtSeed(seed);
}
function peerLS(uid, profile, list) {
  return mtSeed({
    onboarding: profile, onboarded: true,
    ['con_list__' + uid]: list, con_hidden: [],
    __syncmeta: { uid: uid, globallySynced: true, keys: {} }
  });
}

async function bootAsjad(lsSeed, cloud, db, writes, overrides) {
  const w = bootWorld(lsSeed, cloud, db, writes, overrides);
  w.FB.user = { uid: MAIN, email: 'asjad.kamal@gmail.com' };
  w.App.onAuth(w.FB.user);
  await settle(60);
  try { w.sb.CloudSync.flush(); } catch (e) {}
  await settle(20);
  return w;
}
async function bootPeer(uid, email, lsSeed, cloud, db, writes, overrides) {
  const w = bootWorld(lsSeed, cloud, db, writes, overrides);
  w.FB.user = { uid: uid, email: email };
  w.App.onAuth(w.FB.user);
  await settle(60);
  try { w.sb.CloudSync.flush(); } catch (e) {}
  await settle(20);
  return w;
}
const dayDoc = (db, date) => db._col('shareddays').get(MAIN + '_' + date);
const recDoc = (db) => db._col('sharedrecords').get(MAIN);
const billDoc = (db, viewer) => db._col('sharedbilling').get(MAIN + '_' + viewer);
const mfDoc = (db, viewer) => db._col('sharedmanifests').get(MAIN + '_' + viewer);

/* ------------------------- scenarios ------------------------ */

/* S1 — the whole Full-access surface, exact figures */
async function s1() {
  console.log('— S1 full-access surface —');
  const db = buildDb(false);
  const store = richStore();
  const cloud = mainCloud(store, GOOD_LIST, [UMAR, TESTER, MARIA]);
  const writes = [];
  const wA = await bootAsjad(mainLS(store, GOOD_LIST, [UMAR, TESTER, MARIA]), cloud, db, writes);
  await wA.CP.publishAll();
  await settle(20);

  if (process.env.PROBE) {
    console.log('PROBE shareddays:', JSON.stringify(Array.from(db._col('shareddays').keys())));
    console.log('PROBE records:', JSON.stringify(recDoc(db)));
    console.log('PROBE billing UMAR:', JSON.stringify(billDoc(db, UMAR)));
    console.log('PROBE manifests MARIA:', JSON.stringify(mfDoc(db, MARIA)));
    console.log('PROBE photos:', JSON.stringify(Array.from(db._col('sharedphotos').keys())));
  }

  /* day docs for every closed day + today */
  const expectClose = { [D3]: [8, 1], [D2]: [9.5, 1], [D1]: [10, 1], [T]: [10, 1] };
  Object.keys(expectClose).forEach((ds) => {
    const doc = dayDoc(db, ds);
    ok(!!doc, 'S1: a day doc exists for ' + ds);
    if (!doc) return;
    ok((doc.viewers || []).indexOf(UMAR) !== -1, 'S1: Umar is a viewer on ' + ds);
    ok(!!doc.close && doc.close.foremanHours === expectClose[ds][0] && doc.close.travelHours === expectClose[ds][1],
      'S1: ' + ds + ' close is foreman ' + expectClose[ds][0] + ' + travel ' + expectClose[ds][1] + ' (got ' + JSON.stringify(doc.close) + ')');
  });
  const dT = dayDoc(db, T);
  eq(dT.loads, 8, 'S1: today\'s loads on the day doc');
  eq(dayDoc(db, D2).loads, 15, 'S1: D2 loads count both tickets (12 + the Maria-sent 3)');

  /* the partner's own reads */
  const wU = await bootPeer(UMAR, 'osouraya@hotmail.com', peerLS(UMAR, PROFILE_UMAR, [ENTRY_MAIN_FOR_UMAR]), cloud, db, writes);
  const days = await wU.CP.fetchCrewRange(D3, T);
  eq(days.length, 4, 'S1: Umar\'s range fetch returns all four days (got ' + days.length + ')');
  const byDate = {};
  days.forEach((d) => { byDate[d.date] = d; });
  Object.keys(expectClose).forEach((ds) => {
    ok(!!byDate[ds] && !!byDate[ds].close && byDate[ds].close.foremanHours === expectClose[ds][0],
      'S1: Umar sees ' + ds + ' with its foreman close');
  });
  /* the exact price of today on his books: revenue 10 x 93,
     wages (10 + 1) x his driver's own 29 = 319.00 */
  const priced = wU.CP.priceDay(byDate[T], { clientRate: 93, wage: { payType: 'hourly', rate: 29 } });
  eq(priced.revenue, 930, 'S1: today prices at $930 revenue on Umar\'s books');
  eq(priced.wage, 319, 'S1: today prices at $319.00 wages on Umar\'s books');

  const recs = await wU.CP.fetchRecords();
  const rec = (recs.records || {})[MAIN];
  ok(!!rec, 'S1: Umar\'s records fetch returns Asjad\'s records doc');
  if (rec) {
    eq((rec.fuel || []).length, 4, 'S1: all 4 fuel fills cross (got ' + (rec.fuel || []).length + ')');
    const f3 = (rec.fuel || []).filter((f) => f.date === T)[0];
    ok(!!f3 && f3.litres === 99.047 && f3.cost === 239.59 && f3.odo === 169999 && f3.station === 'Petro-Canada' && !!f3.photoRef && !!f3.photoKey,
      'S1: today\'s fill crosses with exact receipt data + photo ref (got ' + JSON.stringify(f3) + ')');
    eq((rec.expenses || []).length, 3, 'S1: all 3 expenses cross');
    ok(!!rec.maintenance && rec.maintenance.odometer === 170079 && rec.maintenance.annualExpiry === '2027-05-31' && (rec.maintenance.services || []).length === 1,
      'S1: maintenance crosses (odo, annual expiry, service history)');
    eq((rec.pti || []).length, 2, 'S1: both PTI reports cross');
    const p1 = (rec.pti || [])[0];
    ok(!!p1 && p1.plate === '04 R209' && p1.result === 'pass' && p1.odometer === 169888,
      'S1: today\'s PTI crosses with plate/result/odometer (got ' + JSON.stringify(p1) + ')');
    const p2 = (rec.pti || [])[1];
    ok(!!p2 && p2.result === 'minor' && (p2.defects || []).length === 1 && p2.defects[0].item === 'Mirror',
      'S1: the D2 PTI crosses with its defect');
    ok(!!rec.driverWage && rec.driverWage.rate === 29 && rec.driverWage.payType === 'hourly',
      'S1: the driver\'s own wage (29/h) crosses for the boss\'s books');
    /* the receipt photo itself */
    const photo = await wU.CP.fetchPhoto(MAIN, f3.photoKey);
    eq(photo, 'data:image/jpeg;base64,RENDITION', 'S1: Umar can pull today\'s receipt photo rendition');
  }
  const bill = (recs.billing || {})[MAIN];
  ok(!!bill, 'S1: Umar\'s billing fetch returns his billing doc');
  if (bill) {
    eq((bill.invoices || []).length, 1, 'S1: the one invoice billed to AI Trucking crosses');
    const inv = (bill.invoices || [])[0];
    ok(!!inv && inv.no === '1152' && inv.total === 1425 && inv.hours === 41.5 && inv.status === 'Issued',
      'S1: invoice summary is exact (no/total/hours/status) (got ' + JSON.stringify(inv && { no: inv.no, total: inv.total, hours: inv.hours, status: inv.status }) + ')');
    ok(!!inv && !!inv.doc && inv.doc.no === '1152', 'S1: the full invoice document payload crosses');
    const mfDays = (((bill.manifests || [])[0] || {}).days || []);
    ok(mfDays.length >= 1, 'S1: the billed period\'s manifests cross (' + mfDays.length + ' day(s) of lines)');
    const mfDates = mfDays.map((d) => d.date);
    ok(mfDates.indexOf(D3) !== -1 && mfDates.indexOf(T) !== -1,
      'S1: manifests carry lines for the period\'s first and last days (got ' + JSON.stringify(mfDates) + ')');
  }
  return { db, cloud, writes, wA };
}

/* S2 — rolled-back republish must not degrade ANY published day */
async function s2() {
  console.log('— S2 rollback across published days —');
  const db = buildDb(false);
  const store = richStore();
  const cloud = mainCloud(store, GOOD_LIST, [UMAR, TESTER, MARIA]);
  const writes = [];
  const wA = await bootAsjad(mainLS(store, GOOD_LIST, [UMAR, TESTER, MARIA]), cloud, db, writes);
  await wA.CP.publishAll();
  await settle(20);
  ok(!!dayDoc(db, T) && dayDoc(db, T).close.foremanHours === 10, 'S2 setup: today published with its close');

  /* the stamp war: cloud day keys come back PRE-close, newer */
  const preDsp = clone(store.dsp_list).map((d) => Object.assign({}, d, { status: 'active', tickets: [], endedAt: null }));
  cloud[MAIN].dsp_list = { v: preDsp, ts: Date.now() + 60000 };
  cloud[MAIN].rev_entries = { v: [], ts: Date.now() + 60000 };
  const wB = await bootAsjad(Object.fromEntries(wA.LS._map), cloud, db, writes);
  await wB.CP.publishDay(D2);   /* a later sweep re-publishes a history day too */
  await settle(20);

  [T, D1, D2].forEach((ds) => {
    const doc = dayDoc(db, ds);
    ok(!!doc && !!doc.close && doc.close.source !== 'session' && doc.close.foremanHours > 0,
      'S2: ' + ds + ' keeps a real close after the rolled-back republish (got ' + JSON.stringify(doc && doc.close) + ')');
    const completed = (doc && doc.dispatches || []).filter((d) => d.status === 'completed');
    ok(completed.length >= 1, 'S2: ' + ds + ' keeps its completed dispatch(es)');
  });
  eq(dayDoc(db, T).close.foremanHours, 10, 'S2: today\'s close is still foreman 10');
  eq(dayDoc(db, D1).close.foremanHours, 10, 'S2: yesterday\'s close is still foreman 10');
  eq(dayDoc(db, D2).close.foremanHours, 9.5, 'S2: D2\'s close is still foreman 9.5');
}

/* S3 — the cancelled day, both orders */
async function s3() {
  console.log('— S3 cancelled day —');
  /* order 1: the day publishes as an open job, THEN is cancelled */
  {
    const db = buildDb(false);
    const store = richStore();
    store.dsp_list = [dspRec('dspX', T, '', 0, 0, { status: 'saved', noTickets: true, jobSite: 'Aecon Inf' })];
    store.rev_entries = []; store.sessions = [];
    const cloud = mainCloud(store, GOOD_LIST, [UMAR, TESTER, MARIA]);
    const writes = [];
    const wA = await bootAsjad(mainLS(store, GOOD_LIST, [UMAR, TESTER, MARIA]), cloud, db, writes);
    await settle(20);
    const before = dayDoc(db, T);
    ok(!!before && (before.dispatches || []).length === 1 && before.dispatches[0].status === 'saved',
      'S3 setup: the open job for today is on the partner\'s board');

    /* he cancels it in his app; the app republishes the day */
    const list = wA.App._store.get('dsp_list', []);
    list[0].status = 'cancelled';
    wA.App._store.set('dsp_list', list);
    await wA.CP.publishDay(T);
    await settle(10);

    const after = dayDoc(db, T);
    ok(!!after, 'S3: the cancelled day still has a day doc (not missing/broken)');
    if (after) {
      const open = (after.dispatches || []).filter((d) => d.status !== 'cancelled');
      eq(open.length, 0, 'S3: no open job remains on the partner\'s board for the cancelled day (got ' + JSON.stringify((after.dispatches || []).map((d) => d.status)) + ')');
      const cx = (after.dispatches || []).filter((d) => d.status === 'cancelled');
      eq(cx.length, 1, 'S3: the day shows the dispatch AS cancelled');
      ok(!after.close, 'S3: the cancelled day carries no close (no phantom hours)');
      eq(after.loads, 0, 'S3: the cancelled day carries no loads');
      const priced = wA.CP.priceDay(after, { clientRate: 93, wage: { payType: 'hourly', rate: 29 } });
      ok(priced.revenue === null && priced.wage === null, 'S3: the cancelled day prices to nothing on the boss\'s books');
    }
    const wU = await bootPeer(UMAR, 'osouraya@hotmail.com', peerLS(UMAR, PROFILE_UMAR, [ENTRY_MAIN_FOR_UMAR]), cloud, db, writes);
    const days = await wU.CP.fetchCrew(T);
    eq(days.length, 1, 'S3: Umar\'s board returns the cancelled day as a day (not a gap)');
    if (days.length) {
      ok((days[0].dispatches || []).every((d) => d.status === 'cancelled'), 'S3: Umar sees it cancelled, not open');
    }
  }
  /* order 2: cancelled BEFORE the day ever publishes */
  {
    const db = buildDb(false);
    const store = richStore();
    store.dsp_list = [dspRec('dspX', T, '', 0, 0, { status: 'cancelled', noTickets: true, jobSite: 'Aecon Inf' })];
    store.rev_entries = []; store.sessions = [];
    const cloud = mainCloud(store, GOOD_LIST, [UMAR, TESTER, MARIA]);
    const writes = [];
    await bootAsjad(mainLS(store, GOOD_LIST, [UMAR, TESTER, MARIA]), cloud, db, writes);
    await settle(20);
    const doc = dayDoc(db, T);
    ok(!!doc, 'S3b: a day cancelled before publish still lands as a day doc');
    if (doc) {
      eq((doc.dispatches || []).filter((d) => d.status === 'cancelled').length, 1, 'S3b: the cancelled dispatch is on the doc, marked cancelled');
      ok(!doc.close && doc.loads === 0, 'S3b: no close, no loads — no phantom work');
    }
  }
}

/* S4 — fuel + expense on a day with no dispatch at all */
async function s4() {
  console.log('— S4 fuel/expense-only day —');
  const db = buildDb(false);
  const store = richStore();
  const cloud = mainCloud(store, GOOD_LIST, [UMAR, TESTER, MARIA]);
  const writes = [];
  const wA = await bootAsjad(mainLS(store, GOOD_LIST, [UMAR, TESTER, MARIA]), cloud, db, writes);
  await wA.CP.publishAll();
  await settle(20);
  ok(!dayDoc(db, D4), 'S4: no day doc is invented for a day with no work on it');
  const wU = await bootPeer(UMAR, 'osouraya@hotmail.com', peerLS(UMAR, PROFILE_UMAR, [ENTRY_MAIN_FOR_UMAR]), cloud, db, writes);
  const recs = await wU.CP.fetchRecords();
  const rec = (recs.records || {})[MAIN];
  ok(!!rec, 'S4: records still fetch');
  if (rec) {
    const f4 = (rec.fuel || []).filter((f) => f.date === D4)[0];
    ok(!!f4 && f4.litres === 50.25 && f4.cost === 120.10 && f4.odo === 169700,
      'S4: the no-dispatch day\'s fill crosses exactly (got ' + JSON.stringify(f4) + ')');
    const e4 = (rec.expenses || []).filter((e) => e.date === D4)[0];
    ok(!!e4 && e4.what === 'DEF fluid' && e4.cost === 32.99, 'S4: the no-dispatch day\'s expense crosses exactly');
  }
  const days = await wU.CP.fetchCrew(D4);
  eq(days.length, 0, 'S4: the board shows no work day for D4 — and no error');
}

/* S5 — a corrected close replaces the first close */
async function s5() {
  console.log('— S5 corrected close —');
  const db = buildDb(false);
  const store = richStore();
  const cloud = mainCloud(store, GOOD_LIST, [UMAR, TESTER, MARIA]);
  const writes = [];
  const wA = await bootAsjad(mainLS(store, GOOD_LIST, [UMAR, TESTER, MARIA]), cloud, db, writes);
  await wA.CP.publishAll();
  await settle(20);
  eq(dayDoc(db, T).close.foremanHours, 10, 'S5 setup: the first close is foreman 10');

  /* the foreman corrects the card: 10.0 -> 9.5 foreman hours.
     Same record, re-completed (the dispatch module's own flow). */
  const st = wA.App._store;
  const dsp = st.get('dsp_list', []).map((d) => {
    if (d.id !== 'dspT') return d;
    const c = clone(d);
    c.tickets = [{ cardNumber: '22864', ticketNo: '22864', foremanHours: 9.5, loads: 8, material: 'Clay' }];
    return c;
  });
  st.set('dsp_list', dsp);
  const rev = st.get('rev_entries', []).map((e) => {
    if (e.id !== 'revT') return e;
    return Object.assign({}, e, { foremanHours: 9.5, hours: 10.5, amount: 304.50 });
  });
  st.set('rev_entries', rev);
  await wA.CP.publishDay(T);
  await settle(10);

  const doc = dayDoc(db, T);
  eq(doc.close.foremanHours, 9.5, 'S5: the published close is the CORRECTED 9.5');
  eq(doc.close.travelHours, 1, 'S5: the travel hour survives the correction');
  const sd = (doc.dispatches || []).filter((d) => d.ticketNo === '22864')[0];
  ok(!!sd && sd.foremanHours === 9.5 && sd.status === 'completed', 'S5: the dispatch itself carries the corrected hours');
  eq((doc.dispatches || []).filter((d) => d.ticketNo === '22864').length, 1, 'S5: exactly one #22864 on the day (no stale twin)');
  const priced = wA.CP.priceDay(doc, { clientRate: 93, wage: { payType: 'hourly', rate: 29 } });
  eq(priced.wage, 304.50, 'S5: the corrected day prices at $304.50 wages');
}

/* S6 — days close while the partner is away; an old-build
 * partner still reads the new docs (shape never changed) */
async function s6() {
  console.log('— S6 back-to-back days + old-build reader —');
  const db = buildDb(false);
  const store = richStore();
  const cloud = mainCloud(store, GOOD_LIST, [UMAR, TESTER, MARIA]);
  const writes = [];
  const wA = await bootAsjad(mainLS(store, GOOD_LIST, [UMAR, TESTER, MARIA]), cloud, db, writes);
  await wA.CP.publishDay(D3);
  await wA.CP.publishDay(D2);
  await wA.CP.publishAll();
  await settle(20);

  let oldPipe = null;
  try {
    oldPipe = require('child_process').execSync(
      'git -C ' + JSON.stringify(ROOT) + ' show 78aabab:js/connectpipe.js', { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  } catch (e) { oldPipe = null; }
  ok(!!oldPipe, 'S6: the previous build\'s pipe source is available for the old-reader leg');
  if (oldPipe) {
    const wOld = await bootPeer(UMAR, 'osouraya@hotmail.com', peerLS(UMAR, PROFILE_UMAR, [ENTRY_MAIN_FOR_UMAR]),
      cloud, db, writes, { 'js/connectpipe.js': oldPipe });
    const daysOld = await wOld.CP.fetchCrewRange(D3, T);
    eq(daysOld.length, 4, 'S6: a partner on the PREVIOUS web build reads all four day docs written by the new build (got ' + daysOld.length + ')');
    const tOld = daysOld.filter((d) => d.date === T)[0];
    ok(!!tOld && !!tOld.close && tOld.close.foremanHours === 10, 'S6: the old build reads today\'s close exactly');
  }
  const wU = await bootPeer(UMAR, 'osouraya@hotmail.com', peerLS(UMAR, PROFILE_UMAR, [ENTRY_MAIN_FOR_UMAR]), cloud, db, writes);
  const days = await wU.CP.fetchCrewRange(D3, T);
  eq(days.length, 4, 'S6: after days away, the partner\'s board catches up on every closed day');
}

/* S7 — revoke works, and preserve never resurrects it */
async function s7() {
  console.log('— S7 revoke + no resurrection —');
  const db = buildDb(false);
  const store = richStore();
  const cloud = mainCloud(store, GOOD_LIST, [UMAR, TESTER, MARIA]);
  const writes = [];
  const wA = await bootAsjad(mainLS(store, GOOD_LIST, [UMAR, TESTER, MARIA]), cloud, db, writes);
  await wA.CP.publishAll();
  await settle(20);
  ok((dayDoc(db, T).viewers || []).indexOf(UMAR) !== -1, 'S7 setup: Umar starts as a viewer');

  /* Asjad removes Umar. The next publish prunes him everywhere. */
  const st = wA.App._store;
  st.set('con_list', clone(GOOD_LIST).filter((c) => c.uid !== UMAR));
  try { wA.sb.CloudSync.flush(); } catch (e) {}
  await wA.CP.publishAll();
  await settle(20);

  const dv = dayDoc(db, T).viewers || [];
  ok(dv.indexOf(UMAR) === -1 && dv.indexOf(TESTER) !== -1,
    'S7: the day doc\'s viewers drop Umar and keep the others (got ' + JSON.stringify(dv) + ')');
  const rv = (recDoc(db) || {}).viewers || [];
  ok(rv.indexOf(UMAR) === -1 && rv.indexOf(TESTER) !== -1, 'S7: the records doc\'s viewers drop Umar');
  const bill = billDoc(db, UMAR);
  ok(!!bill && (bill.invoices || []).length === 0 && (bill.manifests || []).length === 0,
    'S7: Umar\'s billing doc is emptied on revoke');
  const photoDocs = Array.from(db._col('sharedphotos').values());
  ok(photoDocs.length > 0 && photoDocs.every((p) => (p.viewers || []).indexOf(UMAR) === -1),
    'S7: receipt photo docs no longer name Umar');
  const wU = await bootPeer(UMAR, 'osouraya@hotmail.com', peerLS(UMAR, PROFILE_UMAR, [ENTRY_MAIN_FOR_UMAR]), cloud, db, writes);
  const gone = await wU.CP.fetchCrew(T);
  eq(gone.length, 0, 'S7: the revoked partner\'s board returns nothing for today');

  /* now the stamp war on a fresh cold start: content preserved
     for the remaining viewers, access NOT resurrected */
  const preDsp = clone(store.dsp_list).map((d) => Object.assign({}, d, { status: 'active', tickets: [], endedAt: null }));
  cloud[MAIN].dsp_list = { v: preDsp, ts: Date.now() + 60000 };
  cloud[MAIN].rev_entries = { v: [], ts: Date.now() + 60000 };
  const wB = await bootAsjad(Object.fromEntries(wA.LS._map), cloud, db, writes);
  await settle(30);
  const dv2 = dayDoc(db, T).viewers || [];
  ok(dv2.indexOf(UMAR) === -1, 'S7: after a rolled-back republish, Umar is STILL not a viewer');
  ok(!!dayDoc(db, T).close && dayDoc(db, T).close.foremanHours === 10 && dv2.indexOf(TESTER) !== -1,
    'S7: the close itself is still preserved for the remaining viewers');

  /* S7b: EVERY peer removed — no partner remains a viewer
     anywhere. (The driver's own self entry legitimately stays
     in the list — production con_list always holds one, and
     the day/records docs are his own regardless.) */
  wB.App._store.set('con_list', [clone(ENTRY_SELF)]);
  await wB.CP.publishAll();
  await settle(20);
  const rv2 = (recDoc(db) || {}).viewers || [];
  ok(rv2.indexOf(UMAR) === -1 && rv2.indexOf(TESTER) === -1 && rv2.indexOf(MARIA) === -1,
    'S7b: with every peer removed, the records doc names no partner (got ' + JSON.stringify(rv2) + ')');
  const pd2 = Array.from(db._col('sharedphotos').values());
  ok(pd2.every((p) => (p.viewers || []).every((v) => v === MAIN)),
    'S7b: receipt photo docs name no partner when the last peer goes');
}

/* S8 — the records doc under a rolled-back store (parked gap) */
async function s8() {
  console.log('— S8 records/billing rollback —');
  {
    const db = buildDb(false);
    const store = richStore();
    const cloud = mainCloud(store, GOOD_LIST, [UMAR, TESTER, MARIA]);
    const writes = [];
    const wA = await bootAsjad(mainLS(store, GOOD_LIST, [UMAR, TESTER, MARIA]), cloud, db, writes);
    await wA.CP.publishAll();
    await settle(20);
    eq((recDoc(db).fuel || []).length, 4, 'S8 setup: records publish all 4 fills');
    eq((billDoc(db, UMAR).invoices || []).length, 1, 'S8 setup: billing publishes the invoice');

    /* the rolled-back store: older, shorter books, newer stamps */
    const FUT = Date.now() + 60000;
    cloud[MAIN].fuel_fills = { v: [clone(FILLS[0])], ts: FUT };
    cloud[MAIN].fuel_expenses = { v: [], ts: FUT };
    cloud[MAIN].pti_reports = { v: [clone(PTIS[1])], ts: FUT };
    cloud[MAIN].inv_list = { v: [], ts: FUT };
    cloud[MAIN].mt_odo = { v: 169500, ts: FUT };
    cloud[MAIN].mt_events = { v: [], ts: FUT };
    const wB = await bootAsjad(Object.fromEntries(wA.LS._map), cloud, db, writes);
    await settle(30);

    const rec = recDoc(db);
    eq((rec.fuel || []).length, 4, 'S8: the records doc KEEPS all 4 fills after the rolled-back republish (got ' + (rec.fuel || []).length + ')');
    ok((rec.fuel || []).some((f) => f.date === T && f.litres === 99.047), 'S8: today\'s fill is still in the records');
    eq((rec.expenses || []).length, 3, 'S8: the records doc KEEPS all 3 expenses (got ' + (rec.expenses || []).length + ')');
    eq((rec.pti || []).length, 2, 'S8: the records doc KEEPS both PTI reports (got ' + (rec.pti || []).length + ')');
    ok(!!rec.maintenance && rec.maintenance.odometer === 170079 && (rec.maintenance.services || []).length === 1,
      'S8: maintenance keeps the current odometer + service history (got ' + JSON.stringify(rec.maintenance && rec.maintenance.odometer) + ')');
    const bill = billDoc(db, UMAR);
    eq((bill.invoices || []).length, 1, 'S8: the billing doc KEEPS the invoice (the clearing pass must not misfire on a rolled-back store) (got ' + (bill.invoices || []).length + ')');
    ok((bill.manifests || []).length >= 1, 'S8: the billing doc keeps its manifests');
    const photoKeys = Array.from(db._col('sharedphotos').keys());
    ok(photoKeys.some((k) => k.indexOf('169999') !== -1), 'S8: today\'s receipt photo doc is NOT pruned by the rolled-back store');

    const wU = await bootPeer(UMAR, 'osouraya@hotmail.com', peerLS(UMAR, PROFILE_UMAR, [ENTRY_MAIN_FOR_UMAR]), cloud, db, writes);
    const recs = await wU.CP.fetchRecords();
    const r2v = (recs.records || {})[MAIN];
    ok(!!r2v && (r2v.fuel || []).length === 4 && (r2v.pti || []).length === 2,
      'S8: Umar still fetches the full records after the rollback');
  }
  /* S8b: a limited peer's manifests doc under the same attack */
  {
    const db = buildDb(false);
    const store = richStore();
    const cloud = mainCloud(store, GOOD_LIST, [UMAR, TESTER, MARIA]);
    const writes = [];
    const wA = await bootAsjad(mainLS(store, GOOD_LIST, [UMAR, TESTER, MARIA]), cloud, db, writes);
    await wA.CP.publishAll();
    await settle(20);
    const mf0 = mfDoc(db, MARIA);
    ok(!!mf0 && ((mf0.manifests || [])[0] || { days: [] }).days.some((d) => d.date === D2),
      'S8b setup: Maria\'s manifests doc carries the day she dispatched (D2)');
    const FUT = Date.now() + 60000;
    cloud[MAIN].dsp_list = { v: clone(store.dsp_list).filter((d) => d.id !== 'dspM'), ts: FUT };
    const wB = await bootAsjad(Object.fromEntries(wA.LS._map), cloud, db, writes);
    await settle(30);
    const mf = mfDoc(db, MARIA);
    const days = (((mf || {}).manifests || [])[0] || { days: [] }).days || [];
    ok(days.some((d) => d.date === D2), 'S8b: Maria\'s manifests doc KEEPS her dispatched day after the rolled-back republish');
  }
}

/* S9 — a fresh Full pair gets the complete history at formation */
async function s9() {
  console.log('— S9 fresh pair, full history —');
  const db = buildDb(true);
  const store = richStore();
  const cloud = mainCloud(store, GOOD_LIST, [UMAR, TESTER, MARIA]);
  const writes = [];
  const wA = await bootAsjad(mainLS(store, GOOD_LIST, [UMAR, TESTER, MARIA]), cloud, db, writes);
  /* if the accept did not land him in the list by itself, land
     it the way the app does, then run the publish cycle */
  const list = wA.App._store.get('con_list', []);
  if (!list.some((c) => c.uid === NEWBOSS)) {
    wA.App._store.set('con_list', list.concat([clone(ENTRY_NEWBOSS)]));
  }
  await wA.CP.publishAll();
  await settle(30);

  [D3, D2, D1, T].forEach((ds) => {
    const doc = dayDoc(db, ds);
    ok(!!doc && (doc.viewers || []).indexOf(NEWBOSS) !== -1,
      'S9: the history day ' + ds + ' names the new Full partner');
  });
  ok(((recDoc(db) || {}).viewers || []).indexOf(NEWBOSS) !== -1, 'S9: the records doc names the new partner');
  const wN = await bootPeer(NEWBOSS, 'newboss@example.com', peerLS(NEWBOSS, PROFILE_NB, [ENTRY_MAIN_FOR_NB]), cloud, db, writes);
  const days = await wN.CP.fetchCrewRange(D3, T);
  eq(days.length, 4, 'S9: the new partner\'s board shows the complete history — all four days (got ' + days.length + ')');
  const recs = await wN.CP.fetchRecords();
  ok(!!(recs.records || {})[MAIN] && ((recs.records || {})[MAIN].fuel || []).length === 4,
    'S9: the new partner fetches the full records (past and present)');
}

/* S10 — Maria's Limited scope: exactly as ticked, and it holds */
async function s10() {
  console.log('— S10 limited scope (Maria) —');
  const db = buildDb(false);
  const store = richStore();
  const cloud = mainCloud(store, GOOD_LIST, [UMAR, TESTER, MARIA]);
  const writes = [];
  const wA = await bootAsjad(mainLS(store, GOOD_LIST, [UMAR, TESTER, MARIA]), cloud, db, writes);
  await wA.CP.publishAll();
  await settle(20);

  async function mariaView(label) {
    const wM = await bootPeer(MARIA, 'maria@dynamictruckingcalgary.com', peerLS(MARIA, PROFILE_MARIA, [ENTRY_MAIN_FOR_MARIA]), cloud, db, writes);
    const recs = await wM.CP.fetchRecords();
    const rec = (recs.records || {})[MAIN];
    ok(!!rec, label + ': Maria gets a records view (she ticked PTI)');
    if (rec) {
      ok(Array.isArray(rec.pti) && rec.pti.length === 2, label + ': PTI crosses to her (ticked)');
      ok(rec.fuel === undefined && rec.expenses === undefined && rec.maintenance === undefined,
        label + ': fuel/expenses/maintenance are stripped — not ticked');
      ok(rec.driverWage === undefined, label + ': the wage does NOT cross to her (P&L not ticked)');
    }
    ok(!(recs.billing || {})[MAIN], label + ': no billing reaches her (Invoices/P&L not ticked)');
    const mf = (recs.manifests || {})[MAIN];
    ok(!!mf, label + ': her manifests doc reaches her');
    if (mf) {
      const mdays = (((mf.manifests || [])[0] || {}).days || []).map((d) => d.date);
      eq(JSON.stringify(mdays), JSON.stringify([D2]), label + ': her manifests hold ONLY the day she dispatched (got ' + JSON.stringify(mdays) + ')');
    }
    const days = await wM.CP.fetchCrew(T);
    eq(days.length, 1, label + ': her board shows today (Dispatch was ticked)');
  }
  await mariaView('S10');

  /* the S8 attack must neither widen nor narrow her scope */
  const FUT = Date.now() + 60000;
  cloud[MAIN].dsp_list = { v: clone(store.dsp_list).filter((d) => d.id !== 'dspM'), ts: FUT };
  cloud[MAIN].fuel_fills = { v: [clone(FILLS[0])], ts: FUT };
  const wB = await bootAsjad(Object.fromEntries(wA.LS._map), cloud, db, writes);
  await settle(30);
  await mariaView('S10-after-rollback');
}

async function main() {
  console.log('viability harness days: D3=' + D3 + ' D2=' + D2 + ' D1=' + D1 + ' T=' + T + ' (TZ local)');
  await s1();
  await s2();
  await s3();
  await s4();
  await s5();
  await s6();
  await s7();
  await s8();
  await s9();
  await s10();
  console.log('umar-connect-viability: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.log('  FAIL: suite error: ' + (e && e.stack || e)); process.exitCode = 1; });
