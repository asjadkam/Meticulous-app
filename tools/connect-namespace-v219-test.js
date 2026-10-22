#!/usr/bin/env node
/* connect-namespace-v219-test.js — CONNECT-DELETE-CROSS-ACCOUNT
 * (owner, Oct 21–22, 2026; his Connect-first priority).
 *
 * What he lived: he removed connections while signed in as the
 * TESTER account, and the connections vanished from his MAIN
 * account too — "I DELETED MY CONNECTIONS IN TESTER ACCOUT... IT
 * DELETED MY CONNECTIONS HERE IN MY MAIN ACCIUNT?" The back end
 * was innocent (Firestore request docs cannot be deleted; a
 * console read Oct 22 proved all three pairs still accepted and
 * his cloud list complete): the device-local store was shared
 * across accounts, so the tester session's edits to con_list /
 * con_hidden were the very slots the main account rendered, and
 * CloudSync carried them along. A console updatedAt touch did
 * NOT heal his phone (Oct 22, 08:21 MDT) — the local store
 * governs the render, so the fix is app-side.
 *
 * The fix under test (js/app.js + js/cloudsync.js):
 *   - The Connect family's local keys (con_list, con_hidden,
 *     con_outbox, pipe_landed, pipe_seen, nav_shares,
 *     cp_hist_peers, __peer_wages) are stored per owner under a
 *     physical key con_list__<uid> ('local' signed out) — the
 *     v216 profile-ownership discipline. CloudSync keys its meta
 *     by the physical key, so the kv doc carries the same
 *     namespacing: a removal in account A's session is physically
 *     incapable of landing in account B's namespace, on-device
 *     or in B's cloud tree.
 *   - Migration on first pull under the fix: an account's
 *     namespaced list seeds from ITS OWN cloud kv legacy doc +
 *     reconcile from the accepted requests docs; the device-
 *     shared legacy slot seeds only when attributable to the
 *     signing-in owner (sync meta names him, or no account ever
 *     synced here), and con_hidden NEVER seeds from it — a fresh
 *     namespace starts with no hides, because the removals he
 *     made were in the tester session, not in main's.
 *
 * Driven proof — the REAL js/app.js + js/cloudsync.js +
 * js/connectlive.js + the real modules boot in a vm over a
 * FakeEl DOM, on HIS EXACT FIXTURE (uids and records from the
 * Oct 22 console reads):
 *   device LS = the shared slot after the tester session (only
 *     the tester pair left in con_list; Umar + Maria in
 *     con_hidden; sync meta naming the TESTER as the last synced
 *     account, so the slot is NOT attributable to main);
 *   main's cloud kv = the good 4-entry list; requests = the
 *     three accepted docs (Umar pair, Maria limited with her
 *     four modules, tester pair, kind all).
 *   P1 sign in as MAIN: his list materializes ALL THREE pairs,
 *      Maria healed to her full module list from the request
 *      doc, no hides in main's namespace, the legacy slot
 *      untouched, pushes land ONLY under namespaced doc ids.
 *   P2 main removes Maria himself: she stays removed for main
 *      across a reconcile (his own hide, his own namespace).
 *   P3 sign in as TESTER: his namespace holds only his own pair;
 *      he hides MAIN there; back as MAIN the tester pair STILL
 *      shows — a hide written under the tester's namespace does
 *      not suppress the pair on main (the named acceptance), and
 *      Maria stays hidden by main's own hide alone.
 *   P4 signed out: the local namespace is empty — nothing bled.
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

/* ---------------- FakeEl DOM (the v216 harness idiom) -------- */
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

/* ---------------- fake Firestore db (requests + directory) --- */
function makeDb(cols) {
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  function colRef(name) {
    const col = cols[name];
    return {
      doc(id) {
        return {
          get() {
            const v = col.get(id);
            return Promise.resolve({ exists: v !== undefined, id, data: () => clone(v) });
          },
          set(data, opts) {
            const cur = col.get(id) || {};
            col.set(id, opts && opts.merge ? Object.assign(cur, clone(data)) : clone(data));
            return Promise.resolve();
          },
          update(data) {
            const cur = col.get(id);
            if (!cur) return Promise.reject(new Error('not-found'));
            Object.assign(cur, clone(data));
            return Promise.resolve();
          }
        };
      },
      where(field, op, val) {
        return {
          get() {
            const out = [];
            col.forEach((v, id) => { if (v && v[field] === val) out.push({ id, data: () => clone(v) }); });
            return Promise.resolve({ forEach(cb) { out.forEach(cb); } });
          }
        };
      }
    };
  }
  return { collection: colRef };
}

/* ---------------- FB stub (kv cloud + db) -------------------- */
function makeFB(cloud, db, writes) {
  const FB = {
    ready: true, user: null, db,
    loadDocs() {
      const uid = FB.user && FB.user.uid;
      const kv = (uid && cloud[uid]) || {};
      return Promise.resolve(Object.keys(kv).map((k) => ({
        id: k, v: JSON.parse(JSON.stringify(kv[k].v)), updatedAt: kv[k].ts
      })));
    },
    saveDoc(col, id, data) {
      if (!FB.user) return Promise.resolve(null);
      writes.push({ uid: FB.user.uid, id });
      const kv = cloud[FB.user.uid] || (cloud[FB.user.uid] = {});
      kv[id] = { v: JSON.parse(JSON.stringify(data.v)), ts: Date.now() };
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
  const sb = {
    console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
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
  MODULES.forEach((m) => vm.runInContext(read('modules/' + m + '.js'), sb, { filename: m + '.js' }));
  vm.runInContext(read('js/app.js'), sb, { filename: 'app.js' });
  return { sb, dom, LS, FB, App: sb.window.App };
}

async function settle(rounds) {
  for (let i = 0; i < (rounds || 40); i++) {
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 5));
  }
}

/* ---------------- HIS EXACT FIXTURE (Oct 22 console reads) --- */
const MAIN = '72kLjT1dbCOLdW6BvrmXsFpPi0g1';
const UMAR = 'BbrMZxRs8eOY9uRJVWrkPhAlxaH3';
const TESTER = 'XxgAtELVbDO32vA0wa6JKwDxALz2';
const MARIA = 'WH3rL1aWGMSAkUf01xRcLkm46Di2';
const OLD_TS = Date.now() - 86400000;

const PROFILE_MAIN = {
  firstName: 'Asjad', lastName: 'Kamal', accountType: 'Driver', userRole: 'driver',
  business: 'Asjad Kamal', companyName: 'Asjad Kamal', nameAsked: true
};
const PROFILE_TESTER = {
  firstName: 'Dave', lastName: 'Cooper', accountType: 'Owner-Operator', userRole: 'office',
  business: 'Testing trucking', companyName: 'Testing trucking', nameAsked: true
};
const ENTRY_SELF = { id: 'u' + MAIN, name: 'Asjad Kamal', business: 'Testing trucking', role: 'Driver', kind: 'all', status: 'connected', uid: MAIN };
const ENTRY_UMAR = { id: 'u' + UMAR, name: 'AI Trucking', business: 'AI Trucking', role: 'Owner-Operator', status: 'connected', uid: UMAR, viaConnect: true };
const ENTRY_TESTER = { id: 'u' + TESTER, name: 'Dave Cooper', business: 'Testing trucking', role: 'Owner-Operator', kind: 'all', status: 'connected', uid: TESTER, viaConnect: true };
/* Maria's entry as her kv copy carried it (3 modules); her request
   doc carries all four — reconcile must heal PTI in from the doc. */
const ENTRY_MARIA_KV = { id: 'u' + MARIA, name: 'Maria', business: '', role: 'Fleet Manager', kind: 'limited', modules: ['dispatch', 'manifest', 'navigation'], status: 'connected', uid: MARIA, viaConnect: true };

function buildFixture() {
  const requests = new Map([
    [MAIN + '_' + UMAR, {
      from: MAIN, to: UMAR, fromName: 'Asjad Kamal', fromBusiness: 'Asjad Kamal',
      fromRole: 'Owner-Operator', toName: 'AI Trucking', toBusiness: 'AI Trucking',
      toRole: 'Driver', status: 'accepted', createdAt: OLD_TS, updatedAt: OLD_TS
    }],
    [MARIA + '_' + MAIN, {
      from: MARIA, to: MAIN, fromName: 'Maria Lott', fromBusiness: '', fromRole: 'Fleet Manager',
      fromFace: 'office', fromPerson: 'Maria Lott', toName: 'Asjad Kamal',
      toBusiness: 'Testing trucking', toRole: 'Driver', toFace: 'both',
      kind: 'limited', modules: ['dispatch', 'manifest', 'pti', 'navigation'],
      status: 'accepted', createdAt: OLD_TS, updatedAt: OLD_TS
    }],
    [TESTER + '_' + MAIN, {
      from: TESTER, to: MAIN, fromName: 'Asjad Kamal', fromBusiness: 'Nikam',
      toName: 'Asjad Kamal', toBusiness: 'Meticulous technologies', toRole: 'Owner-Operator',
      kind: 'all', status: 'accepted', createdAt: OLD_TS, updatedAt: OLD_TS
    }]
  ]);
  const directory = new Map([
    [MAIN, { name: 'Asjad Kamal', business: 'Asjad Kamal', role: 'Driver', face: 'driver', person: 'Asjad Kamal' }],
    [UMAR, { name: 'AI Trucking', business: 'AI Trucking', role: 'Driver', face: 'driver', person: '' }],
    [TESTER, { name: 'Dave Cooper', business: 'Testing trucking', role: 'Owner-Operator', face: 'office', person: 'Dave Cooper' }],
    [MARIA, { name: 'Maria Lott', business: '', role: 'Fleet Manager', face: 'office', person: 'Maria Lott' }]
  ]);
  const db = makeDb({ requests, directory });
  const cloud = {};
  cloud[MAIN] = {
    onboarding: { v: PROFILE_MAIN, ts: OLD_TS },
    con_list: { v: [ENTRY_SELF, ENTRY_UMAR, ENTRY_TESTER, ENTRY_MARIA_KV], ts: OLD_TS }
  };
  cloud[TESTER] = {};
  const seedLS = mtSeed({
    onboarding: PROFILE_TESTER,
    onboarded: true,
    /* the shared slot after the tester session: only the tester
       pair survived the removals; the hides name Umar + Maria */
    con_list: [ENTRY_TESTER],
    con_hidden: [UMAR, MARIA],
    /* the TESTER synced last on this device — the slot is NOT
       attributable to main, so main must seed from his cloud */
    __syncmeta: { uid: TESTER, globallySynced: true, keys: {} }
  });
  return { db, cloud, seedLS, writes: [] };
}

const uidsOf = (list) => (list || []).map((c) => c && c.uid).filter(Boolean);
const hasUid = (list, uid) => uidsOf(list).indexOf(uid) !== -1;
const rawJson = (LS, k) => { const r = LS.getItem(k); return r === null ? null : JSON.parse(r); };

async function main() {
  const fx = buildFixture();
  const w = bootWorld(fx.seedLS, fx.cloud, fx.db, fx.writes);
  const A = w.App, store = A._store, LS = w.LS;

  /* ---- P0: signed out — the local namespace holds nothing ---- */
  console.log('— P0: signed out —');
  eq(JSON.stringify(store.get('con_list', [])), '[]', 'P0: signed-out (local) connection list is empty');
  eq(LS.getItem('mt_con_list__local'), null, 'P0: no local-namespace slot was seeded from the shared slot');

  /* ---- P1: sign in as MAIN — the list is his again ---------- */
  console.log('— P1: sign in as MAIN —');
  w.FB.user = { uid: MAIN, email: 'main@test' };
  A.onAuth(w.FB.user);
  await settle(60);
  try { w.sb.CloudSync.flush(); } catch (e) {}
  await settle(20);

  const list1 = store.get('con_list', []);
  ok(hasUid(list1, UMAR), 'P1: Umar is back in main\'s list');
  ok(hasUid(list1, MARIA), 'P1: Maria is back in main\'s list');
  ok(hasUid(list1, TESTER), 'P1: the tester pair is in main\'s list');
  const maria1 = list1.filter((c) => c.uid === MARIA)[0] || {};
  eq(maria1.kind, 'limited', 'P1: Maria\'s kind is her accepted Limited');
  ok(Array.isArray(maria1.modules) && maria1.modules.indexOf('pti') !== -1 &&
     maria1.modules.indexOf('dispatch') !== -1 && maria1.modules.indexOf('manifest') !== -1 &&
     maria1.modules.indexOf('navigation') !== -1,
     'P1: Maria\'s modules healed from her request doc (all four, incl. PTI)');
  const hidden1 = store.get('con_hidden', []);
  ok(hidden1.indexOf(UMAR) === -1 && hidden1.indexOf(MARIA) === -1,
     'P1: the tester session\'s hides do NOT live in main\'s namespace');
  const physMain = rawJson(LS, 'mt_con_list__' + MAIN);
  ok(Array.isArray(physMain) && hasUid(physMain, UMAR) && hasUid(physMain, MARIA) && hasUid(physMain, TESTER),
     'P1: the physical slot mt_con_list__<main> holds all three pairs');
  eq(LS.getItem('mt_con_list__' + TESTER), null, 'P1: nothing was written into the tester\'s namespace');
  /* The legacy key itself is settled by the engine's pre-existing
     merge rules exactly as before the fix (this seed's local copy
     is clean, so main's own cloud copy wins it) — the point is
     that nothing reads it anymore: the remnant governed no one. */
  const legacy = rawJson(LS, 'mt_con_list');
  ok(Array.isArray(legacy) && hasUid(legacy, UMAR) && hasUid(legacy, MARIA) && hasUid(legacy, TESTER),
     'P1: the legacy key settled to main\'s own cloud copy under the old merge rules (inert either way)');
  eq(w.sb.Meticulous.modules.connect.status(), '4 connections', 'P1: the Connect face counts his four entries');
  ok(!fx.writes.some((x) => x.uid === MAIN && x.id === 'con_list'),
     'P1: main\'s session never wrote the legacy kv doc name again');
  const cloudNs = fx.cloud[MAIN]['con_list__' + MAIN];
  ok(cloudNs && hasUid(cloudNs.v, UMAR) && hasUid(cloudNs.v, MARIA) && hasUid(cloudNs.v, TESTER),
     'P1: the namespaced cloud doc in main\'s own tree holds all three pairs');
  eq(store.get('onboarding', {}).firstName, 'Asjad', 'P1: main\'s own profile is active (gate + pull intact)');

  /* ---- P2: MAIN removes Maria himself — his hide, his alone - */
  console.log('— P2: main removes Maria in his own session —');
  store.set('con_list', store.get('con_list', []).filter((c) => c.uid !== MARIA));
  const hid2 = store.get('con_hidden', []);
  if (hid2.indexOf(MARIA) === -1) hid2.push(MARIA);
  store.set('con_hidden', hid2);
  await w.sb.ConnectLive.reconcile();
  await settle(20);
  const list2 = store.get('con_list', []);
  ok(!hasUid(list2, MARIA), 'P2: Maria stays removed for main after reconcile (his own hide governs)');
  ok(hasUid(list2, UMAR) && hasUid(list2, TESTER), 'P2: Umar and the tester pair remain for main');
  eq(JSON.stringify(rawJson(LS, 'mt_con_hidden__' + MAIN)), JSON.stringify([MARIA]),
     'P2: the hide lives in main\'s physical namespace only');

  /* ---- P3: TESTER session — isolation both ways ------------- */
  console.log('— P3: sign in as TESTER —');
  w.FB.user = null; A.onAuth(null);
  w.FB.user = { uid: TESTER, email: 'tester@test' };
  A.onAuth(w.FB.user);
  await settle(60);
  const listT = store.get('con_list', []);
  ok(hasUid(listT, MAIN), 'P3: the tester\'s own namespace materializes his pair with main (from the requests doc)');
  ok(!hasUid(listT, MARIA) && !hasUid(listT, UMAR), 'P3: none of main\'s connections bleed into the tester\'s list');
  /* the tester removes/hides MAIN in HIS session — the replay of
     the original defect, now confined to his namespace */
  store.set('con_list', store.get('con_list', []).filter((c) => c.uid !== MAIN));
  const hidT = store.get('con_hidden', []);
  if (hidT.indexOf(MAIN) === -1) hidT.push(MAIN);
  store.set('con_hidden', hidT);
  await w.sb.ConnectLive.reconcile();
  await settle(20);
  ok(!hasUid(store.get('con_list', []), MAIN), 'P3: the tester\'s own hide works in his namespace');

  console.log('— P3b: back as MAIN — the tester\'s hide must not reach him —');
  w.FB.user = null; A.onAuth(null);
  w.FB.user = { uid: MAIN, email: 'main@test' };
  A.onAuth(w.FB.user);
  await settle(60);
  const list3 = store.get('con_list', []);
  ok(hasUid(list3, TESTER), 'P3b: the tester pair STILL shows on main — a hide under the tester\'s namespace does not suppress it');
  ok(hasUid(list3, UMAR), 'P3b: Umar still shows on main');
  ok(!hasUid(list3, MARIA), 'P3b: Maria stays hidden on main — by main\'s own hide alone');
  eq(JSON.stringify(rawJson(LS, 'mt_con_hidden__' + TESTER)), JSON.stringify([MAIN]),
     'P3b: the tester\'s hide is physically confined to mt_con_hidden__<tester>');
  eq(JSON.stringify(rawJson(LS, 'mt_con_hidden__' + MAIN)), JSON.stringify([MARIA]),
     'P3b: main\'s hide is physically confined to mt_con_hidden__<main>');

  /* ---- P4: signed out again — local stays empty ------------- */
  console.log('— P4: signed out —');
  w.FB.user = null; A.onAuth(null);
  await settle(10);
  eq(JSON.stringify(store.get('con_list', [])), '[]', 'P4: the local namespace is still empty — nothing bled into it');

  console.log('connect-namespace-v219: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.log('  FAIL: suite error: ' + (e && e.stack || e)); process.exitCode = 1; });
