#!/usr/bin/env node
/* Meticulous v446 — SHADOW-POISON-NOV12.
 *
 * Owner evidence (Nov 12, 2026, evening): today's fuel entry
 * (Mobil Westwinds, 63.370 L, $133.65, odo 172,903, receipt
 * attached) was created and verified in the Fuel list TWICE —
 * and vanished TWICE. The second creation was re-verified in
 * the list WITH its photo after "Retry sync now" reported
 * "All synced · 5:43 PM"; forty minutes later a fresh check
 * found 66 fill-ups again, the entry nowhere, the cloud copy
 * at 66 day records, "Last backup try — landed ✓", "All
 * synced". Several other recent entries' receipt thumbnails
 * were broken in the same lists.
 *
 * THE MECHANISM (proven below, section A, against the shipped
 * sync code — not a story): js/cloudsync.js' lsSetRaw swallowed
 * EVERY localStorage failure, and the record-list pull settled
 * the key and advanced the per-key shadow (km.sh — "the records
 * this device holds") from the merged value it had merely
 * TRIED to write, never verifying the write landed. Replay:
 * a healthy surface lands fill fuNEW in the cloud; the owner's
 * phone — whose store sits at the quota wall (the whole v441
 * saga: photo sheds, broken thumbnails) — pulls; the merged
 * book write silently fails, yet the meta persists SETTLED
 * with the shadow naming fuNEW; the phone's next flush reads
 * "in my shadow, absent from my book, present in the cloud" —
 * the deliberate-delete signature — and authors fuNEW's
 * deletion plus a sticky tombstone. The entry is gone from
 * every surface while every surface reports All synced. The
 * first loss is the same family (a creation whose store never
 * durably held it, certified as synced by its own window).
 *
 * THE FIX (js/cloudsync.js + modules/fuel.js):
 *  1. Verified writes: the record-list pull persists the
 *     merged book through lsSetVerified (set + read-back
 *     compare). A write the store refuses leaves the local
 *     book standing, the shadow and its basis un-advanced, and
 *     the key DIRTY (never settled) — the flush pushes the
 *     union UP from the cloud's own copy and the status stays
 *     honest until the record truly lands somewhere durable.
 *  2. The delete-authoring basis (km.shb): a pending delete
 *     may only be read from a record this device PROVABLY held
 *     — in the shadow AND in the basis (the identities of the
 *     local list as last verified persisted under the shadow),
 *     absent locally, present in the cloud. A legacy meta with
 *     no basis is seeded from the book the device demonstrably
 *     holds at first sight, intersected with the shadow — so
 *     an inherited poisoned shadow is defused by the upgrade
 *     itself. (A delete made before any basis existed may need
 *     one repeat: visible and recoverable, never silent loss.)
 *  3. Fuel records get a durable home (modules/fuel.js):
 *     syncFillDocs maintains a per-record document in the
 *     account's 'fuel' collection for EVERY fill (the stable
 *     key the v350 photo docs already use), written at the one
 *     verified-save door all fill writes pass through — and
 *     deleted when the fill leaves the book, so a deliberate
 *     delete removes its document too. healMissingFills (once
 *     per session, at module open) restores into the book any
 *     documented fill that is in NEITHER the local NOR the
 *     cloud book, revoking exactly its tombstone through
 *     CloudSync.reviveRecord — a surviving document is the
 *     proof the record was wiped, not deleted.
 *
 * Sections:
 *   A  the poison replay, field-faithful (the phone's meta
 *      writes land — its store holds the small meta; only the
 *      big merged-book write bounces) + the deliberate-delete
 *      guard. On pristine 445 bytes A fails at the law: the
 *      fill is filtered out of the cloud and tombstoned.
 *   B  the fuel record heal: tonight's fill (document +
 *      tombstone, absent from both books) is restored WITH
 *      its photo and its tombstone revoked; a photo-less
 *      documented fill restores too; an expense document never
 *      lands in the fills book; a deliberate delete removes
 *      the fill's document and a fresh session does not
 *      resurrect it.
 *   C  pins.
 *
 * Harness: section A drives the REAL js/cloudsync.js in a vm
 * world whose localStorage models quota faithfully (a setItem
 * that would exceed the cap throws BEFORE writing — the
 * platform contract — so a failed write is atomic); section B
 * drives the REAL modules/fuel.js in the v350 graft bench's
 * stubbed-DOM world, extended with FB.deleteDoc and a
 * CloudSync stub recording reviveRecord calls.
 *
 * Run: node tools/shadow-poison-v446-test.js
 *      MT_ROOT=<tree> node tools/shadow-poison-v446-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = process.env.MT_ROOT ? path.resolve(process.env.MT_ROOT) : path.resolve(__dirname, '..');
const cloudsyncSrc = fs.readFileSync(path.join(ROOT, 'js', 'cloudsync.js'), 'utf8');
const fuelSrc = fs.readFileSync(path.join(ROOT, 'modules', 'fuel.js'), 'utf8');
const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }

/* ================= section A: the sync world =================
 * The v445 bench family's session harness: the REAL
 * js/cloudsync.js alone in a vm, a stateful fake cloud, and a
 * localStorage whose setItem throws BEFORE writing once the
 * total would exceed the cap — the platform's quota contract,
 * so a failed write is atomic (nothing partial lands). */

function makeCloud() { return { docs: {} }; }
function cloudSet(cloud, key, v, updatedAt, del) {
  cloud.docs[key] = { v: JSON.parse(JSON.stringify(v)), del: del || {}, updatedAt: updatedAt };
}
function cloudGet(cloud, key) {
  const d = cloud.docs[key];
  return d ? JSON.parse(JSON.stringify(d.v)) : null;
}
function makeQuotaStorage(data, capBytes) {
  function total() {
    return Object.keys(data).reduce(function (n, k) { return n + k.length + String(data[k]).length; }, 0);
  }
  return {
    getItem: function (k) { return (k in data) ? data[k] : null; },
    setItem: function (k, v) {
      const nv = String(v);
      const old = (k in data) ? (k.length + String(data[k]).length) : 0;
      if (total() - old + k.length + nv.length > capBytes) {
        const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e;
      }
      data[k] = nv;
    },
    removeItem: function (k) { delete data[k]; },
    key: function (i) { return Object.keys(data)[i] || null; },
    get length() { return Object.keys(data).length; }
  };
}
function makePlainStorage(data) {
  return {
    getItem: function (k) { return (k in data) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    removeItem: function (k) { delete data[k]; },
    key: function (i) { return Object.keys(data)[i] || null; },
    get length() { return Object.keys(data).length; }
  };
}
function makeSession(data, cloud, storage) {
  const localStorage = storage || makePlainStorage(data);
  const sb = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, Promise: Promise };
  sb.window = sb;
  sb.localStorage = localStorage;
  sb.navigator = { onLine: true };
  sb.document = { getElementById: function () { return null; }, addEventListener: function () {} };
  sb.addEventListener = function () {};
  sb.FB = {
    ready: true,
    user: { uid: 'u1' },
    loadDocs: function () {
      return Promise.resolve(Object.keys(cloud.docs).map(function (k) {
        const d = cloud.docs[k];
        return { id: k, mt: k, v: JSON.parse(JSON.stringify(d.v)), del: JSON.parse(JSON.stringify(d.del || {})), updatedAt: d.updatedAt };
      }));
    },
    loadDoc: function (col, id) {
      const d = cloud.docs[id];
      if (!d) return Promise.resolve(null);
      return Promise.resolve({ id: id, mt: id, v: JSON.parse(JSON.stringify(d.v)), del: JSON.parse(JSON.stringify(d.del || {})), updatedAt: d.updatedAt });
    },
    saveDoc: function (col, id, payload) {
      cloud.docs[id] = {
        v: JSON.parse(JSON.stringify(payload.v)),
        del: payload.del ? JSON.parse(JSON.stringify(payload.del)) : (cloud.docs[id] ? cloud.docs[id].del : {}),
        updatedAt: Date.now()
      };
      return Promise.resolve({});
    },
    deleteDoc: function (col, id) { delete cloud.docs[id]; return Promise.resolve({}); }
  };
  vm.createContext(sb);
  vm.runInContext(cloudsyncSrc, sb);
  const store = {
    get: function (k, d) { const r = localStorage.getItem('mt_' + k); return r === null ? d : JSON.parse(r); },
    set: function (k, v) { localStorage.setItem('mt_' + k, JSON.stringify(v)); return true; },
    del: function (k) { localStorage.removeItem('mt_' + k); return true; }
  };
  sb.CloudSync.attach(store);
  return {
    sb: sb, CS: sb.CloudSync, store: store,
    get: function (k) { const r = localStorage.getItem('mt_' + k); return r === null ? null : JSON.parse(r); },
    meta: function () { const r = localStorage.getItem('mt___syncmeta'); return r === null ? null : JSON.parse(r); },
    signIn: function () { sb.CloudSync.onAuth({ uid: 'u1' }); }
  };
}
function forcePull(s) { s.CS.lastPullAt = 0; return s.CS.pull(); }
function settleA(ms) { return new Promise(function (r) { setTimeout(r, ms || 350); }); }
function hasRec(arr, pred) { return (arr || []).some(pred); }
function recIds(arr) { return (arr || []).map(function (r) { return r.id; }).sort(); }

/* his real-shaped records: two older fills + tonight's */
const PH = 'data:image/jpeg;base64,' + 'A'.repeat(4000);
const F1 = { id: 'fuA1', date: '2026-11-10', time: '08:12', litres: 95.5, cost: 201.40, station: 'Shell', odo: 172400, updAt: 100, photo: PH };
const F2 = { id: 'fuA2', date: '2026-11-11', time: '17:02', litres: 110.292, cost: 239.22, station: 'Shell', odo: 172726, updAt: 200, photo: PH };
const F_NEW = { id: 'fuNEW', date: '2026-11-12', time: '17:08', litres: 63.370, cost: 133.65, station: 'Mobil Westwinds (3633 Westwinds Dr NE, Calgary)', odo: 172903, updAt: 300, photo: PH };

/* ================= section B: the fuel world ================= */

function makeEl() {
  const el = {
    children: {}, style: {}, _html: '', textContent: '', value: '', checked: false,
    files: [], onclick: null, onchange: null, _attrs: {},
    setAttribute: function (k, v) { el._attrs[k] = v; },
    getAttribute: function (k) { return (k in el._attrs) ? el._attrs[k] : null; },
    addEventListener: function () {},
    querySelector: function () { return makeEl(); },
    querySelectorAll: function () { return []; },
    scrollIntoView: function () {}
  };
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return el._html; },
    set: function (v) { el._html = String(v); }
  });
  return el;
}

function makeFuelWorld(seed) {
  const data = {
    onboarding: { payStandard: 'Hourly', ownWageRate: 29, travelBonus: 0 },
    tracker: { status: 'idle' },
    fuel_fills: JSON.parse(JSON.stringify(seed.fills || [])),
    fuel_expenses: JSON.parse(JSON.stringify(seed.expenses || []))
  };
  const store = {
    get: function (k, d) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : d; },
    set: function (k, v) { data[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete data[k]; return true; }
  };
  const docs = seed.docs || { kv: {}, fuel: {} };
  const fbCalls = { saveDoc: [], deleteDoc: [] };
  const FB = {
    user: { uid: 'u1' },
    saveDoc: function (col, id, doc) {
      fbCalls.saveDoc.push([col, id]);
      (docs[col] = docs[col] || {})[id] = JSON.parse(JSON.stringify(doc));
      return Promise.resolve({});
    },
    deleteDoc: function (col, id) {
      fbCalls.deleteDoc.push([col, id]);
      if (docs[col]) delete docs[col][id];
      return Promise.resolve({});
    },
    loadDoc: function (col, id) {
      const d = (docs[col] || {})[id];
      if (d === undefined) return Promise.resolve(null);
      return Promise.resolve(Object.assign({ id: id }, JSON.parse(JSON.stringify(d))));
    },
    loadDocs: function (col) {
      return Promise.resolve(Object.keys(docs[col] || {}).map(function (id) {
        return Object.assign({ id: id }, JSON.parse(JSON.stringify(docs[col][id])));
      }));
    }
  };
  const reviveCalls = [];
  const CloudSync = {
    recordId: function (key, rec) { return (rec && rec.id) ? 'id:' + rec.id : null; },
    reviveRecord: function (key, id) { reviveCalls.push([key, id]); return true; }
  };
  const els = {};
  const body = makeEl();
  body.querySelector = function (sel) { if (!els[sel]) els[sel] = makeEl(); return els[sel]; };
  let fuRowEls = [];
  body.querySelectorAll = function (sel) {
    if (sel !== '[data-fuedit]') return [];
    const out = [];
    const re = /data-fuedit="(\d+)"/g;
    let m;
    while ((m = re.exec(body.innerHTML))) {
      const el = makeEl();
      el.setAttribute('data-fuedit', m[1]);
      out.push(el);
    }
    fuRowEls = out;
    return out;
  };
  const sb = {
    console: console, Date: Date, Math: Math, JSON: JSON, Promise: Promise, setTimeout: setTimeout,
    FB: FB, CloudSync: CloudSync,
    App: {
      _store: store,
      _today: function () { return '2026-11-12'; },
      _esc: function (s) { return String(s == null ? '' : s); },
      openModule: function () {},
      _photoDl: function (p, label) { return '<button data-photodl-stub="' + label + '">dl</button>'; },
      _masterOdometer: function () { return 172903; },
      _logOdoReading: function () {}
    },
    Meticulous: { modules: {} }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fuelSrc, sb, { filename: 'modules/fuel.js' });
  return { api: sb.Meticulous.modules.fuel, body: body, els: els, data: data, docs: docs,
           fbCalls: fbCalls, reviveCalls: reviveCalls,
           fuRows: function () { return fuRowEls; } };
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 30); }); }

const PHOTO_NOV12 = 'data:image/jpeg;base64,NOV12RECEIPT';
const FILL_OLD = { id: 'fuOLD1', date: '2026-11-11', time: '18:02', litres: '110.292', cost: '239.22', station: 'Shell', odo: 172726, profileId: 'p1', updAt: 100 };
const FILL_NOV12 = { id: 'fuNOV12', date: '2026-11-12', time: '17:08', litres: '63.370', cost: '133.65', station: 'Mobil Westwinds', odo: 172903, profileId: 'p1', updAt: 200, photo: PHOTO_NOV12 };
const FILL_NOV12B = { id: 'fuNOV12B', date: '2026-11-12', time: '09:15', litres: '20.000', cost: '42.18', station: 'Mobil Westwinds', odo: 172850, profileId: 'p1', updAt: 190 };

(async function () {
  console.log('— A: the poison replay (quota-walled phone, healthy browser) —');
  {
    const cloud = makeCloud();
    cloudSet(cloud, 'fuel_fills', [F1, F2], Date.now() - 60000);

    /* the phone: its store holds the two old fills; headroom is
       enough for the small meta writes but NOT for the merged
       book carrying one more photo'd fill — the field shape
       (his phone lives at the wall; the browser profile is
       roomy). */
    const pdata = {};
    pdata['mt_fuel_fills'] = JSON.stringify([F1, F2]);
    const seedTotal = Object.keys(pdata).reduce(function (n, k) { return n + k.length + pdata[k].length; }, 0);
    const P = makeSession(pdata, cloud, makeQuotaStorage(pdata, seedTotal + 2000));
    P.signIn(); await settleA(600);
    ok('A0 the phone settled on the old book', hasRec(P.get('fuel_fills'), function (r) { return r.id === 'fuA2'; }) &&
      !hasRec(P.get('fuel_fills'), function (r) { return r.id === 'fuNEW'; }));
    const sh0 = ((P.meta() || {}).keys || {})['fuel_fills'] || {};
    ok('A0 the phone shadow names only the two old fills', JSON.stringify(sh0.sh || []).indexOf('fuNEW') < 0,
      JSON.stringify(sh0.sh));

    /* the healthy browser lands tonight's fill */
    const bdata = {};
    bdata['mt_fuel_fills'] = JSON.stringify([F1, F2]);
    const B = makeSession(bdata, cloud);
    B.signIn(); await settleA(600);
    B.store.set('fuel_fills', [F1, F2, F_NEW]);
    B.CS.flush(); await settleA(500);
    ok('A1 the healthy surface landed the new fill in the cloud',
      hasRec(cloudGet(cloud, 'fuel_fills'), function (r) { return r.id === 'fuNEW'; }),
      JSON.stringify(recIds(cloudGet(cloud, 'fuel_fills'))));

    /* the phone pulls: the merged book cannot be written */
    await forcePull(P); await settleA(500);
    ok('A2 the phone local book still lacks the fill (its write failed)',
      !hasRec(P.get('fuel_fills'), function (r) { return r.id === 'fuNEW'; }),
      JSON.stringify(recIds(P.get('fuel_fills'))));
    const shP = ((P.meta() || {}).keys || {})['fuel_fills'] || {};
    console.log('    [evidence] phone shadow after the failed-write pull: ' + JSON.stringify(shP.sh || []));
    console.log('    [evidence] phone meta stamps t/s: ' + shP.t + '/' + shP.s + ' (settled = ' + (shP.t <= shP.s) + ')');
    ok('A3 THE LAW: the shadow never certified the fill as held', JSON.stringify(shP.sh || []).indexOf('fuNEW') < 0,
      JSON.stringify(shP.sh));
    ok('A4 the phone never settled over a record it could not hold (status stays honest)', !(shP.t <= shP.s),
      't=' + shP.t + ' s=' + shP.s);

    /* any later local write to the book (a module save, a
       migration rewrite) — same content, fits — then a flush */
    P.store.set('fuel_fills', [F1, F2]);
    P.CS.flush(); await settleA(600);
    const cloudAfter = cloudGet(cloud, 'fuel_fills');
    const delAfter = (cloud.docs['fuel_fills'] || {}).del || {};
    console.log('    [evidence] cloud after the phone flush: ' + JSON.stringify(recIds(cloudAfter)) +
      ' del=' + JSON.stringify(delAfter));
    ok('A5 THE LAW: the cloud still holds the fill after the phone flush',
      hasRec(cloudAfter, function (r) { return r.id === 'fuNEW'; }),
      'cloud=' + JSON.stringify(recIds(cloudAfter)));
    ok('A6 THE LAW: no tombstone was authored against the fill',
      !Object.keys(delAfter).some(function (id) { return id.indexOf('fuNEW') >= 0; }),
      'del=' + JSON.stringify(delAfter));

    const ddata = {};
    const D = makeSession(ddata, cloud);
    D.signIn(); await settleA(600);
    ok('A7 a fresh device pulls the fill down',
      hasRec(D.get('fuel_fills'), function (r) { return r.id === 'fuNEW'; }));
  }

  console.log('— A-guard: a deliberate delete by a device that truly holds the record still dies —');
  {
    const cloud2 = makeCloud();
    cloudSet(cloud2, 'fuel_fills', [F1, F2], Date.now() - 60000);
    const gdata = {};
    gdata['mt_fuel_fills'] = JSON.stringify([F1, F2]);
    const G = makeSession(gdata, cloud2);
    G.signIn(); await settleA(600);
    G.store.set('fuel_fills', [F1]); /* the owner deletes fuA2, on a healthy store */
    G.CS.flush(); await settleA(600);
    ok('A8 the deliberate delete removes the record from the cloud',
      !hasRec(cloudGet(cloud2, 'fuel_fills'), function (r) { return r.id === 'fuA2'; }),
      'cloud=' + JSON.stringify(recIds(cloudGet(cloud2, 'fuel_fills'))));
  }

  console.log('— B1: the record heal restores tonight\'s fill (document + tombstone, absent from both books) —');
  {
    const w = makeFuelWorld({
      fills: [FILL_OLD],
      docs: {
        kv: { fuel_fills: { v: [FILL_OLD], del: { 'id:fuNOV12': { t: 999, fp: 'cfp:cost=133.65|date=2026-11-12|litres=63.37|odo=172903|st=mobil westwinds' } } } },
        fuel: {
          fillid_fuOLD1: JSON.parse(JSON.stringify(FILL_OLD)),
          fillid_fuNOV12: JSON.parse(JSON.stringify(FILL_NOV12)),
          fillid_fuNOV12B: JSON.parse(JSON.stringify(FILL_NOV12B))
        }
      }
    });
    w.api.render(w.body);
    await tick(80);
    const got = (w.data.fuel_fills || []).map(function (r) { return r.id; }).sort();
    eq('B1 both documented fills are back in the book', got, ['fuNOV12', 'fuNOV12B', 'fuOLD1']);
    const nov12 = (w.data.fuel_fills || []).filter(function (r) { return r.id === 'fuNOV12'; })[0] || {};
    eq('B1 the restored fill carries its receipt photo', nov12.photo, PHOTO_NOV12);
    eq('B1 the restored fill\'s facts are exact', [nov12.date, nov12.litres, nov12.cost, nov12.odo], ['2026-11-12', '63.370', '133.65', 172903]);
    eq('B1 exactly the tombstoned fill\'s tombstone was revoked', w.reviveCalls, [['fuel_fills', 'id:fuNOV12']]);
    ok('B1 the restore kept every durable document (no deleteDoc)', w.fbCalls.deleteDoc.length === 0,
      JSON.stringify(w.fbCalls.deleteDoc));
    ok('B1 the photo-less restored fill has its document maintained too', !!w.docs.fuel.fillid_fuNOV12B);
  }

  console.log('— B2: an expense document never lands in the fills book —');
  {
    const w = makeFuelWorld({
      fills: [FILL_OLD],
      docs: {
        kv: { fuel_fills: { v: [FILL_OLD] } },
        fuel: { exp_abc123: { what: 'Tire repair', cost: '85.00', date: '2026-11-12', photo: 'data:image/jpeg;base64,EXP' } }
      }
    });
    w.api.render(w.body);
    await tick(80);
    eq('B2 the fills book is untouched', (w.data.fuel_fills || []).map(function (r) { return r.id; }), ['fuOLD1']);
  }

  console.log('— B3: a deliberate delete removes the document — a fresh session does not resurrect —');
  {
    const FILL_X = { id: 'fuX1', date: '2026-11-09', time: '08:00', litres: '50.000', cost: '105.00', station: 'Petro-Canada', odo: 172400, profileId: 'p1', updAt: 90, photo: 'data:image/jpeg;base64,XPHOTO' };
    const sharedDocs = {
      kv: { fuel_fills: { v: [FILL_X] } },
      fuel: { fillid_fuX1: JSON.parse(JSON.stringify(FILL_X)) }
    };
    const wA = makeFuelWorld({ fills: [FILL_X], docs: sharedDocs });
    wA.api.render(wA.body);
    await tick(80);
    const row = wA.fuRows()[0];
    ok('B3 the fill row is wired', !!row);
    row.onclick(); /* open the details */
    const delBtn = wA.els['#fu_det_del'];
    ok('B3 the detail delete button is wired', !!(delBtn && delBtn.onclick));
    delBtn.onclick(); /* arm */
    delBtn.onclick(); /* delete */
    await tick(40);
    eq('B3 the fill left the book', (wA.data.fuel_fills || []).length, 0);
    ok('B3 the delete removed the fill\'s durable document', !sharedDocs.fuel.fillid_fuX1,
      'docs left: ' + Object.keys(sharedDocs.fuel).join(','));

    sharedDocs.kv.fuel_fills = { v: [], del: { 'id:fuX1': { t: 1234, fp: 'cfp:cost=105|date=2026-11-09|litres=50|odo=172400|st=petro-canada' } } };
    const wB = makeFuelWorld({ fills: [], docs: sharedDocs });
    wB.api.render(wB.body);
    await tick(80);
    eq('B3 the fresh session does not resurrect the deleted fill', (wB.data.fuel_fills || []).length, 0);
    eq('B3 no revive was attempted for it', wB.reviveCalls, []);
  }

  console.log('— C: pins —');
  eq('webVersion is 446', ver.webVersion, 446);
  ok('index.html pins cloudsync.js?v=446', idxSrc.indexOf('js/cloudsync.js?v=446') >= 0);
  ok('index.html pins fuel.js?v=446', idxSrc.indexOf('modules/fuel.js?v=446') >= 0);
  ok('the verified-write door exists', cloudsyncSrc.indexOf('function lsSetVerified') >= 0);
  ok('the delete-authoring basis exists', cloudsyncSrc.indexOf('function shadowBasis') >= 0 && cloudsyncSrc.indexOf('km.shb') >= 0);
  ok('the fuel durable-doc maintenance exists', fuelSrc.indexOf('function syncFillDocs') >= 0);
  ok('the fuel record heal exists and render opens it', fuelSrc.indexOf('function healMissingFills') >= 0 && fuelSrc.indexOf('healMissingFills(body)') >= 0);

  console.log('\nshadow-poison-v446: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL suite threw: ' + (e && e.stack || e)); process.exit(1); });
