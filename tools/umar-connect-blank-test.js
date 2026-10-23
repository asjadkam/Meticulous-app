#!/usr/bin/env node
/* umar-connect-blank-test.js — UMAR-CONNECT-BLANK (owner's
 * screenshot + Connect-first order, Oct 22, 2026 21:05 MDT).
 *
 * What he lived: Asjad closed today in the app (dispatch
 * completed, haul card #22864, foreman 10.0h + 1h travel), yet
 * Umar — Full access, paired since Oct 17 — opened his app at
 * ~21:04 and saw NOTHING from Asjad's side: no dispatch, no
 * closed day. He had to text for the hours.
 *
 * REPRODUCTION-FIRST: this suite drives the REAL boot stack
 * (js/app.js + js/cloudsync.js + js/connectlive.js +
 * js/connectpipe.js + the real modules) in two vm worlds sharing
 * one fake Firestore — Asjad's phone and Umar's phone — through
 * tonight's exact sequence:
 *   sign in -> first pull -> reconcile -> publishAll (auth)
 *   -> dispatch-completion publish (ConnectPipe.publishDay, the
 *      dispatch.js:3057 call) -> partner fetchCrew + fetchRecords.
 * Variants isolate tonight's field conditions:
 *   V1 warm device (post-v219 local state intact)
 *   V2 wiped device (reinstall), cloud complete, namespaced
 *      con doc newer than the legacy doc
 *   V3 wiped device, cloud holds ONLY the legacy con doc
 *   V4 wiped device, legacy con doc stamp NEWER than the
 *      namespaced doc's stamp
 *   V5 second cold start after a good publish, where the cloud
 *      kv day keys (dsp_list / rev_entries) hold PRE-close
 *      copies stamped newer than the local close (the pull's
 *      both-changed rule takes the cloud) — the auth-time
 *      publishAll must not degrade the published day
 *   V6 reader-gate diagnostics on Umar's side (kind/modules on
 *      HIS entry for the driver govern his board)
 * Run: node tools/umar-connect-blank-test.js
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

/* ---------------- FakeEl DOM (the v216/v219 harness idiom) -- */
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
    createElement(tag) { const e = new FakeEl(tag); created.push(e); return e; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; }
  };
  return { document, byId };
}

/* ---------------- localStorage stub ------------------------- */
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

/* -------- fake Firestore (connect-pipe-test idiom) ---------- */
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

/* ---------------- FB stub (kv cloud + db) ------------------- */
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
function bootWorld(seedLS, cloud, db, writes) {
  const dom = makeDom();
  const LS = makeLS(seedLS);
  const FB = makeFB(cloud, db, writes);
  /* timers capped: the app's 9s first-pull races and 2.5s sync
     debounce must not cost real seconds per boot — order is
     preserved, only the waits shrink. */
  const capT = (fn, ms, ...a) => setTimeout(fn, Math.min(ms || 0, 250), ...a);
  const sb = {
    console, setTimeout: capT, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    Promise, Date, JSON, Math, URLSearchParams, Intl,
    document: dom.document, localStorage: LS,
    navigator: { onLine: true, userAgent: 'node-harness' },
    location: { reload() {}, search: '', hash: '', href: 'http://harness/' },
    alert() {}, confirm() { return true; }, prompt() { return null; },
    scrollTo() {}, addEventListener() {}, removeEventListener() {},
    FB, Meticulous: { modules: {}, shared: {} }
  };
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  vm.createContext(sb);
  vm.runInContext(read('js/cloudsync.js'), sb, { filename: 'cloudsync.js' });
  vm.runInContext(read('js/connectlive.js'), sb, { filename: 'connectlive.js' });
  vm.runInContext(read('js/connectpipe.js'), sb, { filename: 'connectpipe.js' });
  vm.runInContext(read('js/ticket-ocr.js'), sb, { filename: 'ticket-ocr.js' });
  MODULES.forEach((m) => vm.runInContext(read('modules/' + m + '.js'), sb, { filename: m + '.js' }));
  vm.runInContext(read('js/app.js'), sb, { filename: 'app.js' });
  return { sb, dom, LS, FB, App: sb.window.App, CP: sb.window.ConnectPipe, CL: sb.window.ConnectLive };
}

async function settle(rounds) {
  for (let i = 0; i < (rounds || 40); i++) {
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 1));
  }
}

/* ------------------------- fixture -------------------------- */
const MAIN = '72kLjT1dbCOLdW6BvrmXsFpPi0g1';
const UMAR = 'BbrMZxRs8eOY9uRJVWrkPhAlxaH3';
const TESTER = 'XxgAtELVbDO32vA0wa6JKwDxALz2';
const MARIA = 'WH3rL1aWGMSAkUf01xRcLkm46Di2';
const NOW = Date.now();
const OLD_TS = NOW - 86400000;        // a day ago
const NS_TS = NOW - 3600000;          // this morning (namespaced push)
const LEGACY_TS_OLD = NOW - 7200000;  // legacy stamp, older than ns
const LEGACY_TS_NEW = NOW - 600000;   // legacy stamp, NEWER than ns

const PROFILE_MAIN = {
  firstName: 'Asjad', lastName: 'Kamal', accountType: 'Driver', userRole: 'driver',
  business: 'Asjad Kamal', companyName: 'Asjad Kamal', nameAsked: true,
  travelBonus: 1, payStandard: 'hourly', ownWageRate: 29
};
const PROFILE_UMAR = {
  firstName: 'Umar', lastName: '', accountType: 'Owner-Operator', userRole: 'both',
  business: 'AI Trucking', companyName: 'AI Trucking', nameAsked: true, billingRate: 93
};
const ENTRY_SELF = { id: 'u' + MAIN, name: 'Asjad Kamal', business: 'Asjad Kamal', role: 'Driver', kind: 'all', status: 'connected', uid: MAIN };
const ENTRY_UMAR = { id: 'u' + UMAR, name: 'AI Trucking', business: 'AI Trucking', role: 'Owner-Operator', status: 'connected', uid: UMAR, viaConnect: true };
const ENTRY_TESTER = { id: 'u' + TESTER, name: 'Dave Cooper', business: 'Testing trucking', role: 'Owner-Operator', kind: 'all', status: 'connected', uid: TESTER, viaConnect: true };
const ENTRY_MARIA = { id: 'u' + MARIA, name: 'Maria Lott', business: 'Dynamic Trucking', role: 'Fleet Manager', kind: 'limited', modules: ['dispatch', 'manifest', 'pti', 'navigation'], status: 'connected', uid: MARIA, viaConnect: true };
const GOOD_LIST = [ENTRY_SELF, ENTRY_UMAR, ENTRY_TESTER, ENTRY_MARIA];
const ENTRY_MAIN_FOR_UMAR = { id: 'u' + MAIN, name: 'Asjad Kamal', business: 'Asjad Kamal', role: 'Driver', status: 'connected', uid: MAIN, viaConnect: true };

function buildDb() {
  const db = new FakeDb();
  const requests = db._col('requests');
  /* the Umar pair: accepted Oct 17, pre-kind — NO kind/modules */
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
  const directory = db._col('directory');
  directory.set(MAIN, { name: 'Asjad Kamal', business: 'Asjad Kamal', role: 'Driver', face: 'driver', person: 'Asjad Kamal' });
  directory.set(UMAR, { name: 'AI Trucking', business: 'AI Trucking', role: 'Owner-Operator', face: 'both', person: 'Umar' });
  directory.set(TESTER, { name: 'Dave Cooper', business: 'Testing trucking', role: 'Owner-Operator', face: 'office', person: 'Dave Cooper' });
  directory.set(MARIA, { name: 'Maria Lott', business: 'Dynamic Trucking', role: 'Fleet Manager', face: 'office', person: 'Maria Lott' });
  return db;
}

/* Today's closed day, as Asjad's books hold it after the close
 * (dispatch #22864 completed; the $319 completion entry). */
function dayCloud(today, closed) {
  const dsp = {
    id: 'dsp22864', date: today, scheduledAt: today + 'T08:00:00', jobSite: 'Aecon Inf',
    material: 'Clay/Misc fill', ticketNo: '22864', status: closed ? 'completed' : 'active',
    tickets: closed ? [{ cardNumber: '22864', ticketNo: '22864', foremanHours: 10, loads: 8, material: 'Clay' }] : [],
    startedAt: Date.parse(today + 'T08:00:00'), endedAt: closed ? Date.parse(today + 'T17:19:00') : null
  };
  const rev = closed ? [{
    id: 'rev319', date: today, hours: 11, amount: 319, foremanHours: 10, travelHours: 1,
    loads: 8, note: 'Dispatch: Aecon Inf', auto: false
  }] : [];
  const sessions = [{ date: today, seconds: 33580, endedAt: today + 'T17:19:00', liveKm: 139 }];
  const fuel = [{ id: 'f1', date: today, time: '12:47', station: 'Petro-Canada', litres: 99.047, cost: 239.59, odometer: 169999 }];
  return { dsp_list: [dsp], rev_entries: rev, sessions: sessions, fuel_fills: fuel };
}

function buildCloudMain(today, opts) {
  const o = opts || {};
  const day = dayCloud(today, true);
  const kv = {
    onboarding: { v: clone(PROFILE_MAIN), ts: OLD_TS },
    dsp_list: { v: day.dsp_list, ts: OLD_TS },
    rev_entries: { v: day.rev_entries, ts: OLD_TS },
    sessions: { v: day.sessions, ts: OLD_TS },
    fuel_fills: { v: day.fuel_fills, ts: OLD_TS },
    con_list: { v: clone(GOOD_LIST), ts: o.legacyTs || LEGACY_TS_OLD }
  };
  if (o.nsDoc !== false) kv['con_list__' + MAIN] = { v: clone(GOOD_LIST), ts: NS_TS };
  const cloud = {};
  cloud[MAIN] = kv;
  cloud[UMAR] = {
    onboarding: { v: clone(PROFILE_UMAR), ts: OLD_TS },
    ['con_list__' + UMAR]: { v: [clone(o.umarEntry || ENTRY_MAIN_FOR_UMAR)], ts: OLD_TS }
  };
  return cloud;
}

function warmMainLS(today) {
  return mtSeed({
    onboarding: PROFILE_MAIN, onboarded: true,
    ['con_list__' + MAIN]: GOOD_LIST, con_hidden: [],
    dsp_list: dayCloud(today, true).dsp_list,
    rev_entries: dayCloud(today, true).rev_entries,
    sessions: dayCloud(today, true).sessions,
    fuel_fills: dayCloud(today, true).fuel_fills,
    __syncmeta: { uid: MAIN, globallySynced: true, keys: {} }
  });
}
function warmUmarLS(umarList) {
  return mtSeed({
    onboarding: PROFILE_UMAR, onboarded: true,
    ['con_list__' + UMAR]: umarList || [ENTRY_MAIN_FOR_UMAR], con_hidden: [],
    __syncmeta: { uid: UMAR, globallySynced: true, keys: {} }
  });
}

const uidsOf = (list) => (list || []).map((c) => c && c.uid).filter(Boolean);

/* Drive Asjad's world: sign in, let auth machinery run, then the
 * dispatch-completion publish for today. Returns the world. */
async function runAsjad(lsSeed, cloud, db, writes, today) {
  const w = bootWorld(lsSeed, cloud, db, writes);
  w.FB.user = { uid: MAIN, email: 'asjad.kamal@gmail.com' };
  w.App.onAuth(w.FB.user);
  await settle(60);
  try { w.sb.CloudSync.flush(); } catch (e) {}
  await settle(20);
  /* the completion call itself (modules/dispatch.js:3057) */
  await w.CP.publishDay(today);
  await settle(20);
  return w;
}

/* Drive Umar's world against the same backend; fetch his board. */
async function runUmar(lsSeed, cloud, db, writes, today) {
  const w = bootWorld(lsSeed, cloud, db, writes);
  w.FB.user = { uid: UMAR, email: 'osouraya@hotmail.com' };
  w.App.onAuth(w.FB.user);
  await settle(60);
  try { w.sb.CloudSync.flush(); } catch (e) {}
  await settle(20);
  const days = await w.CP.fetchCrew(today);
  const recs = await w.CP.fetchRecords();
  return { w, days, recs };
}

function checkDayDoc(db, today, label) {
  const doc = db._col('shareddays').get(MAIN + '_' + today);
  ok(!!doc, label + ': the shared day doc exists in Firestore');
  if (!doc) return null;
  ok((doc.viewers || []).indexOf(UMAR) !== -1, label + ': Umar is a named viewer on the day doc (viewers=' + JSON.stringify(doc.viewers) + ')');
  ok(!!doc.close, label + ': the day doc carries close facts');
  if (doc.close) {
    eq(doc.close.foremanHours, 10, label + ': close foreman hours are the card\'s 10.0');
    eq(doc.close.travelHours, 1, label + ': close travel is the +1h');
  }
  const dsp = (doc.dispatches || [])[0];
  ok(!!dsp && dsp.status === 'completed' && dsp.ticketNo === '22864',
    label + ': the completed dispatch #22864 rides the doc (got ' + JSON.stringify(dsp && { status: dsp.status, ticketNo: dsp.ticketNo }) + ')');
  return doc;
}
function checkUmarSees(out, today, label) {
  eq(out.days.length, 1, label + ': Umar\'s board returns today\'s day (got ' + out.days.length + ')');
  if (out.days.length) {
    const d = out.days[0];
    ok(!!d.close && d.close.foremanHours === 10, label + ': Umar sees the close facts (foreman 10)');
  }
  ok(!!(out.recs.records || {})[MAIN], label + ': Umar\'s records fetch returns Asjad\'s records doc');
}

async function variant(label, asjadLS, cloudOpts, today) {
  console.log('— ' + label + ' —');
  const db = buildDb();
  const cloud = buildCloudMain(today, cloudOpts);
  const writes = [];
  const wA = await runAsjad(asjadLS, cloud, db, writes, today);
  const list = wA.App._store.get('con_list', []);
  ok(uidsOf(list).indexOf(UMAR) !== -1 && (list.filter((c) => c.uid === UMAR)[0] || {}).status === 'connected',
    label + ': Asjad\'s con_list holds Umar connected at publish time (list=' + JSON.stringify(uidsOf(list)) + ')');
  checkDayDoc(db, today, label);
  const out = await runUmar(warmUmarLS(), cloud, db, writes, today);
  checkUmarSees(out, today, label);
  return { db, cloud, writes, wA };
}

async function main() {
  /* today by the app's own rule (local Y-M-D); run with
     TZ=America/Edmonton so it matches the phone's day. */
  const d = new Date();
  const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  console.log('harness today = ' + today);

  await variant('V1 warm device', warmMainLS(today), {}, today);
  await variant('V2 wiped device, cloud complete (ns stamp newer)', {}, {}, today);
  await variant('V3 wiped device, legacy con doc only', {}, { nsDoc: false }, today);
  await variant('V4 wiped device, legacy stamp NEWER than namespaced', {}, { legacyTs: LEGACY_TS_NEW }, today);

  /* ---- V5: second cold start, cloud day keys pre-close + newer */
  console.log('— V5 second cold start, cloud day keys rolled back (stamp war) —');
  {
    const db = buildDb();
    const cloud = buildCloudMain(today, {});
    const writes = [];
    const lsSeed = warmMainLS(today);
    const wA = await runAsjad(lsSeed, cloud, db, writes, today);
    checkDayDoc(db, today, 'V5 (after first publish)');
    /* the cloud kv day keys now hold PRE-close copies stamped
       newer than anything local (a stale writer / rolled-back
       cloud): the next cold start's pull takes them under the
       both-changed rule, and its auth-time publishAll runs. */
    const pre = dayCloud(today, false);
    cloud[MAIN].dsp_list = { v: pre.dsp_list, ts: Date.now() + 60000 };
    cloud[MAIN].rev_entries = { v: pre.rev_entries, ts: Date.now() + 60000 };
    const wB = bootWorld(Object.fromEntries(wA.LS._map), cloud, db, writes);
    wB.FB.user = { uid: MAIN, email: 'asjad.kamal@gmail.com' };
    wB.App.onAuth(wB.FB.user);
    await settle(60);
    const doc = db._col('shareddays').get(MAIN + '_' + today);
    ok(!!doc && !!doc.close && doc.close.foremanHours === 10,
      'V5: after the rolled-back cold start, the published day STILL carries the close (foreman 10) — got ' + JSON.stringify(doc && doc.close));
    const dsp = doc && (doc.dispatches || [])[0];
    ok(!!dsp && dsp.status === 'completed',
      'V5: the published dispatch is still the completed one (got ' + JSON.stringify(dsp && dsp.status) + ')');
  }

  /* ---- V6: reader-gate diagnostics on Umar's side ------------ */
  console.log('— V6 reader gates (Umar\'s own entry for Asjad) —');
  {
    const gatedEntry = Object.assign(clone(ENTRY_MAIN_FOR_UMAR), { kind: 'limited', modules: ['pti'] });
    const db = buildDb();
    const cloud = buildCloudMain(today, { umarEntry: gatedEntry });
    const writes = [];
    await runAsjad(warmMainLS(today), cloud, db, writes, today);
    checkDayDoc(db, today, 'V6 setup');
    const outG = await runUmar(warmUmarLS([gatedEntry]), cloud, db, writes, today);
    eq(outG.days.length, 0, 'V6: a limited entry without Dispatch ticked hides the day from his board (gate fact)');
    const tickedEntry = Object.assign(clone(ENTRY_MAIN_FOR_UMAR), { kind: 'limited', modules: ['dispatch', 'manifest'] });
    const cloud2 = buildCloudMain(today, { umarEntry: tickedEntry });
    const outT = await runUmar(warmUmarLS([tickedEntry]), cloud2, db, writes, today);
    eq(outT.days.length, 1, 'V6: a limited entry WITH Dispatch ticked shows the day');
  }

  /* ---- V7: sessions-only rollback (tonight's closest model) ---
   * The v39 cold start demonstrably held a partial day (his
   * manifest that night showed 11 live km against a 191 km
   * odometer day): sessions survive via the telemetry merge
   * while dsp_list / rev_entries come back pre-close. The auth
   * publish from that store must not strip the published day of
   * its completed dispatch or its close facts. */
  console.log('— V7 sessions-only rollback (dsp/rev lost, session kept) —');
  {
    const db = buildDb();
    const cloud = buildCloudMain(today, {});
    const writes = [];
    const wA = await runAsjad(warmMainLS(today), cloud, db, writes, today);
    checkDayDoc(db, today, 'V7 (after first publish)');
    cloud[MAIN].dsp_list = { v: [], ts: Date.now() + 60000 };
    cloud[MAIN].rev_entries = { v: [], ts: Date.now() + 60000 };
    const wB = bootWorld(Object.fromEntries(wA.LS._map), cloud, db, writes);
    wB.FB.user = { uid: MAIN, email: 'asjad.kamal@gmail.com' };
    wB.App.onAuth(wB.FB.user);
    await settle(60);
    const doc = db._col('shareddays').get(MAIN + '_' + today);
    ok(!!doc && !!doc.close && doc.close.foremanHours === 10,
      'V7: the published day KEEPS its close (foreman 10) after the sessions-only rollback — got ' + JSON.stringify(doc && doc.close));
    const dsp = doc && (doc.dispatches || [])[0];
    ok(!!dsp && dsp.status === 'completed' && dsp.ticketNo === '22864',
      'V7: the published day KEEPS the completed dispatch #22864 — got ' + JSON.stringify(dsp && { status: dsp.status, ticketNo: dsp.ticketNo }));
  }

  console.log('umar-connect-blank: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.log('  FAIL: suite error: ' + (e && e.stack || e)); process.exitCode = 1; });
