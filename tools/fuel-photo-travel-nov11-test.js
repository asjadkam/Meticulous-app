#!/usr/bin/env node
/* fuel-photo-travel-nov11-test.js — FUEL-PHOTO-SYNC-NOV11
 * (owner evidence, Nov 11, 2026, 18:57 CST, his phone):
 *
 * Tonight's Nov 11 fill (Shell #110, 110.292 L, $239.22, odo
 * 172,726) was filed through the WEB session with the receipt
 * photo attached — the web save confirmed it and the web
 * details view showed the photo. The ENTRY synced to his phone
 * (top of the Fuel list, figures exact) — but the PHOTO did
 * not: the phone's row paints no thumbnail, while the Nov 9 and
 * Nov 10 rows (photos he attached on the phone itself) show
 * theirs. His question: "Why is there no receipt attached to
 * the fuel today?"
 *
 * Traced chain (modules/fuel.js + js/cloudsync.js + js/firebase.js):
 *  - the book sync copy sheds `photo` by design (v289), so the
 *    receiving surface's ONLY source for the photo is the
 *    per-record cloud document the save handler writes
 *    (saveFillPhotoDoc, stable key fillid_<id>) — read back by
 *    healPhotoGrafts (v350).
 *  - healPhotoGrafts is guarded by photoGraftRan: it runs ONCE
 *    per page session, at the first Fuel render, and snapshots
 *    the photo-less records AT THAT MOMENT. A record that
 *    arrives by sync pull LATER in the same session — exactly
 *    tonight's shape: the app was open all day, the web filed
 *    the fill at 18:45-18:47, he opened Fuel at 18:57 — is
 *    never looked up until the next full app restart.
 * The v350 suite covers heal-on-arrival (record already local
 * at first render). It never models an arrival AFTER the heal.
 *
 * Cases:
 *  T1 tonight's exact sequence: phone renders Fuel earlier in
 *     the session (heal runs, nothing missing); the web files
 *     the fill with its photo through the REAL add form (the
 *     photo document lands in the shared cloud); the pull
 *     delivers the photo-less record; the phone renders Fuel
 *     again — the photo must be on the record and the row must
 *     paint the thumbnail.
 *  T2 control: the record is already local before the phone's
 *     first render (the v350 shape) — heals, as today.
 *  T3 the second-receipt slot: a two-receipt fill travels the
 *     same road — BOTH photos land on the receiving record.
 *  T4 a photo-less record whose photo exists NOWHERE stays
 *     photo-less; an immediate re-render spends no further
 *     cloud reads on it (the retry is bounded); after the
 *     retry window, a render looks again — and a document that
 *     lands late still heals in the same session.
 *  T5 nothing is disturbed: the phone's own photo'd entries
 *     keep their photos and every fact stays byte-identical.
 *
 * Harness: two instances of the REAL modules/fuel.js — surface
 * A on the v370 quota-store world driving the real add form,
 * surface B on the v350 fresh-copy store world — over ONE
 * shared FB document store (the account). The pull is modelled
 * as cloudsync delivers it (v370 B1 proved the merge with the
 * real cloudsync.js: facts + id cross, photo fields shed).
 *
 * Run: node tools/fuel-photo-travel-nov11-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const fuelSrc = read('modules/fuel.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function short(v) { const s = JSON.stringify(v); return s && s.length > 110 ? s.slice(0, 107) + '…' : s; }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + short(got) + ', want ' + short(want)); }
const tick = (ms) => new Promise(function (r) { setTimeout(r, ms || 30); });

/* ---------- shared shapes ---------- */
const STORE_URL = 'data:image/jpeg;base64,' + 'S'.repeat(130000);   // tonight's receipt, storage rendition
const STORE_URL2 = 'data:image/jpeg;base64,' + 'T'.repeat(120000);  // the second receipt (top-up)
const OCR_URL = 'data:image/jpeg;base64,' + 'O'.repeat(260000);
const OCR_URL2 = 'data:image/jpeg;base64,' + 'Q'.repeat(240000);
const PHOTO_NOV10 = 'data:image/jpeg;base64,NOV10RECEIPT';
const PHOTO_NOV09 = 'data:image/jpeg;base64,NOV09RECEIPT';
const RECEIPT_TEXT = ['Shell Canada', '#110 - 5305 Country Hills Blvd NE', 'Diesel', 'LITRES 110.292',
  'PRICE/L $2.169', 'TOTAL FUEL $239.22', '11/11/2026 18:42:55'].join('\n');
const RECEIPT2_TEXT = ['Shell Canada', 'Diesel', 'LITRES 10.000', 'PRICE/L $2.169', 'TOTAL FUEL $21.69', '11/11/2026 18:55:00'].join('\n');

/* his phone book BEFORE tonight's fill — the Nov 9 + Nov 10 rows
   from his screenshot, photos aboard (he attached those himself) */
const NOV10 = { id: 'fuNov10', date: '2026-11-10', litres: '71.97', cost: '156.10', station: 'Shell Canada #110, 5305 Country Hills Blvd, Calgary', odo: 172414, photo: PHOTO_NOV10, updAt: 1000 };
const NOV09 = { id: 'fuNov09', date: '2026-11-09', litres: '65.907', cost: '142.29', station: 'MOBIL@ 1742 GAS STN, 300 - 3633 Westwinds Dr, Calgary', odo: 172228, photo: PHOTO_NOV09, updAt: 1000 };
const OLD_PLAIN = { id: 'fuOldPlain', date: '2026-09-14', litres: '70.000', cost: '130.00', station: 'Mobil', odo: 165000, updAt: 900 };

/* ---------- the shared account ---------- */
function makeCloud() {
  const docs = { kv: {}, fuel: {} };
  const calls = { loadDoc: [], loadDocs: 0, saveDoc: [] };
  const FB = {
    user: { uid: 'u1' },
    saveDoc: function (col, id, doc) {
      calls.saveDoc.push([col, id]);
      (docs[col] = docs[col] || {})[id] = JSON.parse(JSON.stringify(doc));
      return Promise.resolve({});
    },
    loadDoc: function (col, id) {
      calls.loadDoc.push([col, id]);
      const d = (docs[col] || {})[id];
      if (d === undefined) return Promise.resolve(null);
      return Promise.resolve(Object.assign({ id: id }, JSON.parse(JSON.stringify(d))));
    },
    loadDocs: function (col) {
      calls.loadDocs++;
      return Promise.resolve(Object.keys(docs[col] || {}).map(function (id) {
        return Object.assign({ id: id }, JSON.parse(JSON.stringify(docs[col][id])));
      }));
    }
  };
  return { docs: docs, calls: calls, FB: FB };
}

/* ---------- element stub ---------- */
function makeEl() {
  const el = {
    children: {}, style: {}, _html: '', textContent: '', value: '', checked: false,
    files: [], onclick: null, onchange: null, _attrs: {},
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
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

/* ---------- surface A: the filing session (v370 form world) ---------- */
function makeSurfaceA(cloud, seedFills) {
  const raw = {};
  raw['fuel_fills'] = JSON.stringify(seedFills);
  raw['fuel_expenses'] = JSON.stringify([]);
  raw['onboarding'] = JSON.stringify({ payStandard: 'Hourly', ownWageRate: 29, travelBonus: 0 });
  raw['tracker'] = JSON.stringify({ status: 'idle' });
  const store = {
    get: function (k, d) { return (k in raw) ? JSON.parse(raw[k]) : d; },
    set: function (k, v) { raw[k] = JSON.stringify(v); return true; },
    del: function (k) { delete raw[k]; return true; }
  };
  const els = {};
  const body = makeEl();
  body.querySelector = function (sel) { if (!els[sel]) els[sel] = makeEl(); return els[sel]; };
  body.querySelectorAll = function () { return []; };
  function FakeFileReader() {}
  FakeFileReader.prototype.readAsDataURL = function (file) {
    const self = this; self.result = 'data:raw-' + file.__tag;
    setTimeout(function () { if (self.onload) self.onload(); }, 0);
  };
  const sb = {
    console: console, Date: Date, Math: Math, JSON: JSON, Promise: Promise, setTimeout: setTimeout,
    FileReader: FakeFileReader,
    FB: cloud.FB,
    App: {
      _store: store,
      _today: function () { return '2026-11-11'; },
      _esc: function (s) { return String(s == null ? '' : s); },
      openModule: function () {},
      _photoDl: function () { return ''; },
      _masterOdometer: function () { return 172726; },
      _logOdoReading: function () {},
      _parseOdometerReading: function () { return null; }
    },
    Meticulous: { modules: {} },
    TicketOCR: {
      fileToOCRImage: function (file, cb) { cb(file.__tag === 'r2' ? OCR_URL2 : OCR_URL); },
      fileToStorageImage: function (file, cb) { cb(file.__tag === 'r2' ? STORE_URL2 : STORE_URL); },
      urlToReadImage: function (url, kind, cb) { cb(url); },
      recognizeWithRotation: function (url) { return Promise.resolve(url === OCR_URL2 ? RECEIPT2_TEXT : RECEIPT_TEXT); },
      parseFuelReceipt: function (text) {
        const L = /LITRES\s+([\d.]+)/.exec(text || ''), C = /TOTAL FUEL\s+\$([\d.]+)/.exec(text || ''),
          P = /PRICE\/L\s+\$([\d.]+)/.exec(text || '');
        return { litres: L ? L[1] : null, cost: C ? C[1] : null, station: 'Shell', date: '2026-11-11', time: '18:42', pricePerLitre: P ? P[1] : null, address: '5305 Country Hills Blvd NE' };
      },
      describeFuelRead: function (p) {
        const f = [];
        if (p.litres) f.push(p.litres + ' L'); if (p.cost) f.push('$' + p.cost); if (p.pricePerLitre) f.push('@ ' + p.pricePerLitre + '/L');
        return { found: f, missing: [] };
      },
      parseExpenseReceipt: function () { return { total: null, vendor: null, date: null }; },
      describeExpenseRead: function () { return { found: [], missing: [] }; },
      shrinkDataUrl: function (u, max, cb) { cb(u); }
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fuelSrc, sb, { filename: 'modules/fuel.js' });
  return { api: sb.Meticulous.modules.fuel, body: body, els: els,
    fills: function () { return JSON.parse(raw['fuel_fills']); } };
}

/* drive surface A's real add form: attach receipt(s), save */
async function fileFillViaForm(A, twoReceipts) {
  A.api.render(A.body);
  await tick();
  A.els['#fu_img'].files = [{ __tag: 'r1' }];
  A.els['#fu_img'].onchange({ target: A.els['#fu_img'] });
  await tick(); await tick(); await tick();
  if (twoReceipts) {
    A.els['#fu_img2'].files = [{ __tag: 'r2' }];
    A.els['#fu_img2'].onchange({ target: A.els['#fu_img2'] });
    await tick(); await tick();
  }
  A.els['#fu_odo'].value = '172726';
  A.els['#fu_add'].onclick();
  await tick(); await tick();
  return A.fills();
}

/* the pull, exactly as cloudsync delivers it: facts + id cross,
   photo fields shed (the v289 law) */
function shedCopy(rec) {
  const c = {};
  for (const k in rec) { if (k !== 'photo' && k !== 'photos' && k !== 'photo2' && k !== 'updatedAt') c[k] = rec[k]; }
  return c;
}

/* ---------- surface B: the receiving phone (v350 store world) ---------- */
function makeSurfaceB(cloud, seedFills) {
  const data = {
    onboarding: { payStandard: 'Hourly', ownWageRate: 29, travelBonus: 0 },
    tracker: { status: 'idle' },
    fuel_fills: JSON.parse(JSON.stringify(seedFills)),
    fuel_expenses: []
  };
  const store = {
    get: function (k, d) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : d; },
    set: function (k, v) { data[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete data[k]; return true; }
  };
  /* a clock the bench can advance (the heal's retry window) */
  const RealDate = Date;
  let offset = 0;
  function FakeDate() {
    const a = Array.prototype.slice.call(arguments);
    if (a.length && typeof a[0] === 'number') a[0] += offset;
    return a.length ? new (Function.prototype.bind.apply(RealDate, [null].concat(a)))() : new RealDate(RealDate.now() + offset);
  }
  FakeDate.now = function () { return RealDate.now() + offset; };
  FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC;
  FakeDate.prototype = RealDate.prototype;
  const body = makeEl();
  const els = {};
  body.querySelector = function (sel) { if (!els[sel]) els[sel] = makeEl(); return els[sel]; };
  const sb = {
    console: console, Date: FakeDate, Math: Math, JSON: JSON, Promise: Promise, setTimeout: setTimeout,
    FB: cloud.FB,
    App: {
      _store: store,
      _today: function () { return '2026-11-11'; },
      _esc: function (s) { return String(s == null ? '' : s); },
      openModule: function () {},
      _photoDl: function () { return ''; },
      _masterOdometer: function () { return 172726; },
      _logOdoReading: function () {}
    },
    Meticulous: { modules: {} }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fuelSrc, sb, { filename: 'modules/fuel.js' });
  return { api: sb.Meticulous.modules.fuel, body: body, data: data,
    advanceClock: function (ms) { offset += ms; },
    pull: function (rec) { data.fuel_fills = JSON.parse(JSON.stringify(data.fuel_fills.concat([rec]))); },
    fills: function () { return JSON.parse(JSON.stringify(data.fuel_fills)); } };
}
function factsOf(list) {
  return JSON.stringify(list.map(function (r) {
    const c = {};
    for (const k in r) { if (k !== 'photo' && k !== 'photos' && k !== 'photo2') c[k] = r[k]; }
    return c;
  }));
}

(async function () {
  /* ===== T1: tonight's exact sequence ===== */
  console.log('— T1: filed on the web, pulled to a phone whose Fuel module already opened once —');
  {
    const cloud = makeCloud();
    const B = makeSurfaceB(cloud, [NOV10, NOV09]);
    /* the morning: he opens Fuel — the heal runs, nothing is missing */
    B.api.render(B.body);
    await tick(60);
    /* the evening: the web session files tonight's fill, photo attached */
    const A = makeSurfaceA(cloud, [NOV10, NOV09]);
    const aFills = await fileFillViaForm(A, false);
    const filed = aFills.filter(function (r) { return r.date === '2026-11-11'; })[0] || {};
    eq('T1 the web save kept the figures exact', String(filed.litres) + '|' + String(filed.cost) + '|' + filed.odo, '110.292|239.22|172726');
    ok('T1 the filed record was born with an id', !!filed.id, JSON.stringify(Object.keys(filed)));
    const doc = cloud.docs.fuel['fillid_' + filed.id];
    ok('T1 the receipt photo reached its per-record cloud document', !!doc && doc.photo === STORE_URL,
      'cloud fuel docs: ' + Object.keys(cloud.docs.fuel).join(','));
    /* the pull: the shed copy lands in the phone's book */
    B.pull(shedCopy(filed));
    eq('T1 the pulled record is photo-less (the v289 shed)', (B.fills().filter(function (r) { return r.id === filed.id; })[0] || {}).photo, undefined);
    /* he opens Fuel to check — tonight's screenshot */
    B.api.render(B.body);
    await tick(80);
    const onPhone = B.fills().filter(function (r) { return r.id === filed.id; })[0] || {};
    eq('T1 THE PHOTO IS ON THE PHONE COPY', onPhone.photo, STORE_URL);
    ok('T1 the list row paints the receipt thumbnail', B.body.innerHTML.indexOf('<img src="' + STORE_URL + '"') >= 0);
    /* T5 folded in: his own entries untouched */
    const n10 = B.fills().filter(function (r) { return r.id === 'fuNov10'; })[0] || {};
    const n09 = B.fills().filter(function (r) { return r.id === 'fuNov09'; })[0] || {};
    eq('T5 the Nov 10 entry keeps its own photo', n10.photo, PHOTO_NOV10);
    eq('T5 the Nov 9 entry keeps its own photo', n09.photo, PHOTO_NOV09);
    eq('T5 every fact on the phone book is exactly as filed/seeded',
      factsOf(B.fills()), factsOf([NOV10, NOV09, shedCopy(filed)]));
  }

  /* ===== T2: the v350 shape — record local before the first render ===== */
  console.log('— T2: control, arrival before the first open —');
  {
    const cloud = makeCloud();
    const A = makeSurfaceA(cloud, []);
    const aFills = await fileFillViaForm(A, false);
    const filed = aFills.filter(function (r) { return r.date === '2026-11-11'; })[0] || {};
    const B = makeSurfaceB(cloud, [shedCopy(filed)]);
    B.api.render(B.body);
    await tick(80);
    const onPhone = B.fills()[0] || {};
    eq('T2 the photo heals on a fresh open, as before', onPhone.photo, STORE_URL);
  }

  /* ===== T3: two receipts, one fill ===== */
  console.log('— T3: the second-receipt slot travels too —');
  {
    const cloud = makeCloud();
    const B = makeSurfaceB(cloud, [NOV10]);
    B.api.render(B.body);
    await tick(60);
    const A = makeSurfaceA(cloud, [NOV10]);
    const aFills = await fileFillViaForm(A, true);
    const filed = aFills.filter(function (r) { return r.date === '2026-11-11'; })[0] || {};
    eq('T3 the filed stack carries both receipts', filed.photos, [STORE_URL, STORE_URL2]);
    const doc = cloud.docs.fuel['fillid_' + filed.id] || {};
    eq('T3 the cloud document carries the whole stack', doc.photos, [STORE_URL, STORE_URL2]);
    B.pull(shedCopy(filed));
    B.api.render(B.body);
    await tick(80);
    const onPhone = B.fills().filter(function (r) { return r.id === filed.id; })[0] || {};
    eq('T3 the phone copy leads with the first receipt', onPhone.photo, STORE_URL);
    eq('T3 the phone copy carries BOTH receipts', onPhone.photos, [STORE_URL, STORE_URL2]);
  }

  /* ===== T4: nowhere-to-heal stays photo-less; retries are bounded; late docs land ===== */
  console.log('— T4: bounded retries, and a late-landing document still heals —');
  {
    const cloud = makeCloud();
    const B = makeSurfaceB(cloud, [OLD_PLAIN]);
    B.api.render(B.body);
    await tick(60);
    eq('T4 a record with no surviving photo stays photo-less', (B.fills()[0] || {}).photo, undefined);
    const readsAfterFirst = cloud.calls.loadDoc.length;
    B.api.render(B.body);
    await tick(60);
    eq('T4 an immediate re-open spends no further reads on the same record', cloud.calls.loadDoc.length, readsAfterFirst);
    eq('T4 it is still photo-less (nothing was invented)', (B.fills()[0] || {}).photo, undefined);
    /* the photo's only copy reaches the account late; the retry window passes */
    cloud.docs.fuel['fillid_fuOldPlain'] = Object.assign({}, OLD_PLAIN, { photo: STORE_URL });
    B.advanceClock(6 * 60 * 1000);
    B.api.render(B.body);
    await tick(80);
    eq('T4 after the window, the late document heals in the same session', (B.fills()[0] || {}).photo, STORE_URL);
  }

  /* ===== pins ===== */
  ok('pin: the heal keeps a per-record attempt ledger (no once-per-session blanket)',
    fuelSrc.indexOf('var photoGraftTried = {}') >= 0 && fuelSrc.indexOf('if (photoGraftRan) return;') === -1);
  eq('pin: webVersion is 426', ver.webVersion, 426);
  ok('pin: index.html pins fuel.js?v=426', idxSrc.indexOf('modules/fuel.js?v=426') >= 0);

  console.log('\nfuel-photo-travel-nov11: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL suite threw: ' + (e && e.stack || e)); process.exit(1); });
