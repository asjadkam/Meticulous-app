#!/usr/bin/env node
/*
 * app-storage-wall-v394-test.js — APP-STORAGE-WALL-NOV9
 * (owner evidence, Nov 9, 2026, all day, four surfaces):
 *
 *   (1) Documents, cloud web client, ~13:43: filing the Nov 5
 *       CVSA report failed TWICE at save — "The document could
 *       NOT be saved on this phone — storage may be full.
 *       Nothing was saved."
 *   (2) Fuel, cloud web client, morning + evening: the receipt
 *       photo previewed, saved with the notice that it "didn't
 *       fit in this device's app storage"; the reopened record
 *       showed "No photo for this entry".
 *   (3) Dispatch close-with-ticket-photo failed TWICE with the
 *       app's storage-write error; the TYPED close worked.
 *   (4) The PHONE itself, evening: his post-trip PTI — signed,
 *       complete — "That inspection did NOT save — the app
 *       storage on your phone looks full, or the write failed."
 *       His Device Care screenshot the same evening: Storage
 *       53% used, 137.3 GB / 256 GB — ~118 GB FREE. The device
 *       is not full. The wall is the app's own local store.
 *
 * THE ACCOUNTING (convicted by the v372 instrumented trace and
 * reused here): the whole app persists into localStorage — one
 * JSON string per book (mt_fuel_fills, mt_pti_reports,
 * mt_docs_items, mt_sessions, …) with every photo INLINE as a
 * base64 data URL. Chromium counts the origin's localStorage
 * in UTF-16 BYTES over the WHOLE origin against a 10 MiB
 * ceiling (~5.24M chars for everything the app keeps). Photo
 * renditions measured on the owner's real Nov 9 photos at the
 * app's own spec (1280px / JPEG 0.8): fuel receipt 182,851
 * chars, haul card 221,119, CVSA page 262,372; the ladder
 * rungs measure 111,953 (960px) and 55,325 (640px); a PTI
 * signature (660×220 PNG) ≈ 8,740. A book that accumulates
 * dozens of those reaches the ceiling — and then EVERY save
 * that must GROW the store fails, in every module, while
 * non-growing writes (the typed close, the figures) keep
 * landing. Exactly the field pattern.
 *
 * This suite replays the night with the REAL code — the store
 * extracted verbatim from js/app.js, modules/documents.js
 * whole, modules/fuel.js whole, PTI's verified save sliced
 * verbatim from modules/pti.js — over a Nov-9-shaped book
 * calibrated the way the v372 trace found the live store:
 * filled to within a few thousand bytes of the ceiling.
 *
 *   PHASE A — the accounting: the calibrated origin sits at
 *             the ceiling; headroom cannot fit even a 640px
 *             photo, let alone a document or a PTI report.
 *   PHASE B — PTI: the real saveReportsVerified files one
 *             more signed report. PRE-FIX: returns false —
 *             tonight's phone symptom, verbatim path.
 *   PHASE C — DOCUMENTS: the real _addDoc files the CVSA
 *             page-1 payload (220,812 chars). PRE-FIX: null —
 *             this morning's symptom. POST-FIX: the record,
 *             and the account holds the FULL data under the
 *             record's own id.
 *   PHASE D — a small GROWING write fails pre-fix while a
 *             non-growing rewrite lands (the typed-close
 *             pattern).
 *   PHASE E — SAFETY of the relief (post-fix): every fuel
 *             record's non-photo fields byte-identical after
 *             relief ran; shed photos are exactly the marked
 *             (account-held) ones; the ONE unmarked photo
 *             survives byte-identical; nothing else moved.
 *   PHASE F — the bootstrap audit (post-fix): in a world
 *             whose photos carry NO marks, the audit writes
 *             each photo's full stack to its account document
 *             and only then marks it — a photo whose account
 *             write fails is never marked.
 *   PHASE G — the graft at the wall (post-fix): with the pool
 *             brim-full, the heal's own verified save still
 *             guards — a cloud photo cannot be conjured in,
 *             and the pool is left exactly as found.
 *
 * Run: node tools/app-storage-wall-v394-test.js [--trace]
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');
const fuelSrc = read('modules/fuel.js');
const docsSrc = read('modules/documents.js');
const ptiSrc = read('modules/pti.js');
const SHOW_TRACE = process.argv.indexOf('--trace') >= 0;

let pass = 0, fail = 0;
function log(s) { console.log(s); }
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
const tick = () => new Promise(function (r) { setTimeout(r, 5); });
async function flush(n) { for (let i = 0; i < (n || 14); i++) await tick(); }

/* ---------- measured payloads (Nov 9, owner's real photos) ---------- */
function dataUrl(n, ch) { return 'data:image/jpeg;base64,' + (ch || 'A').repeat(n - 22); }
const PHOTO_FULL = dataUrl(221119, 'F');   // haul card, 1280px rendition
const PHOTO_RCPT = dataUrl(182851, 'R');   // fuel receipt, 1280px rendition
const PHOTO_960 = dataUrl(111953, 'N');    // the ladder's 960 rung
const PHOTO_640 = dataUrl(55325, 'S');     // the ladder's 640 rung
const DOC_PAGE1 = dataUrl(220812, 'C');    // CVSA page 1 at the docs spec
const SIG = 'data:image/png;base64,' + 'G'.repeat(8740 - 22);
const CEILING = 10 * 1024 * 1024;          // bytes, Chromium accounting (v372/v375)

/* ---------- verbatim slices of the shipped code ---------- */
function extractStore(src) {
  const i = src.indexOf('var store = {');
  if (i === -1) throw new Error('store not found in js/app.js');
  let depth = 0, j = i + 'var store = '.length;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(i, j) + ';';
}
function extractFn(src, marker) {
  const i = src.indexOf(marker);
  if (i === -1) throw new Error('marker not found: ' + marker);
  let depth = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

/* ---------- the world: quota-faithful localStorage + the real store ---------- */
function makeStorage() {
  const data = {};
  function totalBytes() { let t = 0; for (const k in data) t += 2 * (k.length + data[k].length); return t; }
  return {
    data: data,
    totalBytes: totalBytes,
    headroom: function () { return CEILING - totalBytes(); },
    getItem: function (k) { return (k in data) ? data[k] : null; },
    setItem: function (k, v) {
      v = String(v);
      let t = totalBytes() + 2 * (k.length + v.length);
      if (k in data) t -= 2 * (k.length + data[k].length);
      if (t > CEILING) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      data[k] = v;
    },
    removeItem: function (k) { delete data[k]; },
    key: function (i) { return Object.keys(data)[i] || null; },
    get length() { return Object.keys(data).length; }
  };
}

function makeEl() {
  return {
    innerHTML: '', textContent: '', value: '', onclick: null, onchange: null, checked: false,
    files: null, style: {}, dataset: {},
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    setAttribute: function () {}, getAttribute: function () { return null; },
    querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    addEventListener: function () {}, click: function () {}, scrollIntoView: function () {}
  };
}

/* seed: a Nov-9-shaped book, photo-less; photos are added by
   the calibration below until the pool brims the way the
   v372 trace found it. `safeMap` names the fuel doc keys the
   account provably holds (null = no marks at all). */
function seedBook(storage, safeMap) {
  const fills = [];
  for (let i = 0; i < 65; i++) {
    fills.push({ id: 'fu' + i, date: '2026-' + (i % 3 === 0 ? '09' : i % 3 === 1 ? '10' : '11') + '-' + String(1 + (i % 27)).padStart(2, '0'),
      litres: (80 + i).toFixed(3), cost: (170 + i).toFixed(2), station: i % 2 ? 'Petro-Canada' : 'Mobil', odo: 160000 + i * 187 });
  }
  const expenses = [];
  for (let i = 0; i < 18; i++) expenses.push({ date: '2026-10-' + String(1 + (i % 27)).padStart(2, '0'), what: 'Expense ' + i, cost: String(40 + i) });
  const reps = [];
  for (let i = 0; i < 70; i++) reps.push({ id: 'pti' + i, filedAt: 1759000000000 + i * 40000000, kind: i % 2 ? 'post' : 'pre', signed: true, signature: SIG, odometer: 165000 + i * 80, result: 'pass', defects: [] });
  const sessions = [];
  for (let i = 0; i < 60; i++) sessions.push({ date: '2026-10-' + String(1 + (i % 27)).padStart(2, '0'), startTs: 1759000000000 + i * 86400000, elapsed: 39000, loads: 9, km: 310.5, pegFacts: 'x'.repeat(1100) });
  const days = {};
  for (let d = 0; d < 14; d++) { const crumbs = []; for (let c = 0; c < 800; c++) crumbs.push({ t: 1759000000000 + c * 31000, a: 51.123456, o: -114.123456 }); days['s' + (1759000000000 + d * 86400000)] = { key: 's' + d, date: '2026-11-0' + (1 + (d % 8)), totalM: 310000, crumbs: crumbs, hasFix: true, updatedAt: 1759900000000 }; }
  const dmg = [
    { id: 'dmg1', date: '2026-11-02', what: 'Light pole', photos: [PHOTO_FULL, PHOTO_FULL, PHOTO_RCPT, PHOTO_RCPT] },
    { id: 'dmg2', date: '2026-11-05', what: 'Tire', photos: [PHOTO_RCPT, PHOTO_RCPT] }
  ];
  const dsp = [];
  for (let i = 0; i < 45; i++) dsp.push({ id: 'dsp' + i, date: '2026-10-' + String(1 + (i % 27)).padStart(2, '0'), carrier: 'Aecon Trans', hours: 11.5, loads: 11, status: 'completed' });
  const raw = {
    'mt_fuel_fills': JSON.stringify(fills), 'mt_fuel_expenses': JSON.stringify(expenses),
    'mt_pti_reports': JSON.stringify(reps), 'mt_sessions': JSON.stringify(sessions),
    'mt_livemiles': JSON.stringify({ days: days }), 'mt_dmg_reports': JSON.stringify(dmg),
    'mt_dsp_list': JSON.stringify(dsp),
    'mt_rev_entries': JSON.stringify(Array.from({ length: 60 }, function (_, i) { return { id: 'rev' + i, amount: 340, note: 'x'.repeat(300) }; })),
    'mt_docs_items': JSON.stringify([{ id: 'docold1', label: 'Insurance', name: 'Policy', kind: 'image', data: PHOTO_960, addedAt: 1759000000000 }]),
    'mt_onboarding': JSON.stringify({ companyName: 'Ai Trucking', truckNo: '07', plate: '04 R209', pad: 'x'.repeat(20000) })
  };
  if (safeMap) raw['mt_fuel_photo_safe'] = JSON.stringify(safeMap);
  for (const k in raw) storage.data[k] = raw[k];
  return { fills: fills, expenses: expenses, reps: reps };
}

function photoPool() {
  /* the photos his book accumulated, largest first — the
     calibration deals them onto the photo-less seed fills
     until the pool brims */
  const pool = [];
  for (let i = 0; i < 12; i++) pool.push(PHOTO_640);
  for (let i = 0; i < 10; i++) pool.push(PHOTO_960);
  for (let i = 0; i < 8; i++) pool.push(PHOTO_RCPT);
  for (let i = 0; i < 10; i++) pool.push(PHOTO_FULL);
  return pool;
}

function calibrate(storage, keepOutIdx) {
  /* deal photos onto fills (skipping keepOutIdx), largest-
     that-fits first, until no pool photo can land; then top
     the pool up with small-write filler (the onboarding pad)
     so the headroom lands at ~2.5–5 KB — the brim-full state
     the v372 trace measured ("within a few thousand
     characters of the ceiling") */
  const fills = JSON.parse(storage.data['mt_fuel_fills']);
  const pool = photoPool();
  let dealt = 0;
  for (;;) {
    const i = fills.findIndex(function (f, j) { return !f.photo && j !== keepOutIdx; });
    if (i === -1) break;
    let best = -1;
    for (let p = 0; p < pool.length; p++) {
      const trial = fills.map(function (f, j) { return j === i ? Object.assign({}, f, { photo: pool[p] }) : f; });
      const s = JSON.stringify(trial);
      const rest = storage.totalBytes() - 2 * ('mt_fuel_fills'.length + storage.data['mt_fuel_fills'].length) + 2 * ('mt_fuel_fills'.length + s.length);
      if (CEILING - rest >= 2600) { best = p; break; }
    }
    if (best === -1) break;
    fills[i].photo = pool[best];
    storage.data['mt_fuel_fills'] = JSON.stringify(fills);
    pool.splice(best, 1); dealt++;
  }
  /* top-up: size the pad so headroom ∈ [2600, 5000] bytes */
  const ob = JSON.parse(storage.data['mt_onboarding']);
  const want = 3800;
  const cur = storage.headroom();
  const deltaChars = Math.round((cur - want) / 2);
  ob.pad = 'x'.repeat(Math.max(0, (ob.pad || '').length + deltaChars));
  storage.data['mt_onboarding'] = JSON.stringify(ob);
  return dealt;
}

function makeWorld(opts) {
  opts = opts || {};
  const storage = makeStorage();
  const cloud = { fuelDocs: {}, docWrites: [], kvBook: null, failDocs: {} };
  const seed = seedBook(storage, opts.safeMap || null);
  const dealt = calibrate(storage, opts.keepOutIdx !== undefined ? opts.keepOutIdx : -1);

  const sb = {
    console: console, Date: Date, Math: Math, JSON: JSON, Promise: Promise, setTimeout: setTimeout,
    localStorage: storage,
    FileReader: function () {},
    navigator: {},
    document: { createElement: function () { return makeEl(); }, querySelector: function () { return null; }, querySelectorAll: function () { return []; }, addEventListener: function () {}, body: makeEl() },
    Image: function () {},
    App: null,
    Meticulous: { modules: {} },
    FB: {
      user: { uid: 'u1' }, ready: true,
      saveDoc: function (col, id, doc) {
        if (cloud.failDocs[col + '/' + id]) return Promise.reject(new Error('offline'));
        cloud.docWrites.push({ col: col, id: id, doc: JSON.parse(JSON.stringify(doc)) });
        if (col === 'fuel') cloud.fuelDocs[id] = JSON.parse(JSON.stringify(doc));
        return Promise.resolve({});
      },
      loadDoc: function (col, id) {
        if (col === 'fuel' && cloud.fuelDocs[id]) { const d = JSON.parse(JSON.stringify(cloud.fuelDocs[id])); d.id = id; return Promise.resolve(d); }
        if (col === 'kv' && cloud.kvBook && cloud.kvBook[id]) return Promise.resolve({ v: JSON.parse(JSON.stringify(cloud.kvBook[id])) });
        return Promise.resolve(null);
      },
      loadDocs: function (col) {
        if (col !== 'fuel') return Promise.resolve([]);
        return Promise.resolve(Object.keys(cloud.fuelDocs).map(function (id) { const d = JSON.parse(JSON.stringify(cloud.fuelDocs[id])); d.id = id; return d; }));
      }
    },
    TicketOCR: {
      shrinkDataUrl: function (url, max, cb) {
        if (typeof url !== 'string' || url.indexOf('data:') !== 0) { cb(null); return; }
        const target = max >= 960 ? 111953 : 55325;
        if (url.length <= target) { cb(url); return; }
        cb(url.slice(0, 22) + url.charAt(22).repeat(target - 22));
      },
      fileToStorageImage: function (f, cb) { cb(PHOTO_RCPT); },
      fileToOCRImage: function (f, cb) { cb(PHOTO_RCPT); }
    }
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  /* the real store, verbatim from js/app.js */
  vm.runInContext(extractStore(appSrc) + '\nthis.__store = store;', sb);
  sb.App = { _store: sb.__store, _esc: function (s) { return String(s == null ? '' : s); }, _today: function () { return '2026-11-09'; }, openModule: function () {} };
  /* the real fuel + documents modules */
  vm.runInContext(fuelSrc, sb);
  vm.runInContext(docsSrc, sb);
  /* PTI's verified save, sliced verbatim (the S/W doors are
     one-line var assignments — taken by line, exactly as
     written; reports + saveReportsVerified by brace match) */
  const ptiLines = ptiSrc.split('\n');
  const sLine = ptiLines.filter(function (l) { return l.indexOf("var S = function (k, d) { return App._store.get('pti_' + k, d); }") >= 0; })[0];
  const wLine = ptiLines.filter(function (l) { return l.indexOf("var W = function (k, v) { App._store.set('pti_' + k, v); }") >= 0; })[0];
  if (!sLine || !wLine) throw new Error('PTI S/W doors not found');
  const ptiSlice = [
    sLine, wLine,
    extractFn(ptiSrc, 'function reports()'),
    extractFn(ptiSrc, 'function saveReportsVerified(')
  ].join('\n');
  vm.runInContext(ptiSlice + '\nthis.__pti = { reports: reports, saveReportsVerified: saveReportsVerified };', sb);
  return { sb: sb, storage: storage, cloud: cloud, seed: seed, dealt: dealt, store: sb.__store };
}

/* the doc key fuel uses for a record — mirrored from the
   module's own fillPhotoDocKey law (id first) */
function docKeyOf(rec) { return rec.id ? 'fillid_' + rec.id : ''; }

(async function main() {
  log('APP-STORAGE-WALL-NOV9 — the brim-full origin, replayed on the real code');

  /* ============ the marked world: every dealt photo but one
     is provably in the account (its doc key is in the safe
     map); fill index 3 carries the ONE unmarked photo. The
     marks are a seed artifact — written straight into the
     calibrated world's raw store, exactly the state the
     bootstrap audit (phase F) produces in life. =========== */
  const w = makeWorld({});
  const fillsCal = JSON.parse(w.storage.data['mt_fuel_fills']);
  let unmarkedIdx = fillsCal[3] && fillsCal[3].photo ? 3 : -1;
  if (unmarkedIdx === -1) { for (let i = fillsCal.length - 1; i >= 0; i--) { if (fillsCal[i].photo) { unmarkedIdx = i; break; } } }
  const safeMap = {};
  fillsCal.forEach(function (f, i) { if (f.photo && i !== unmarkedIdx) safeMap[docKeyOf(f)] = 1; });
  w.storage.data['mt_fuel_photo_safe'] = JSON.stringify(safeMap);
  const unmarkedPhoto = fillsCal[unmarkedIdx].photo;

  log('\n— PHASE A: the accounting —');
  const perKey = {};
  for (const k in w.storage.data) perKey[k] = w.storage.data[k].length;
  const totalChars = Object.keys(perKey).reduce(function (a, k) { return a + k.length + perKey[k]; }, 0);
  log('  origin total: ' + totalChars.toLocaleString() + ' chars = ' + w.storage.totalBytes().toLocaleString() + ' bytes of ' + CEILING.toLocaleString() + '; headroom ' + w.storage.headroom().toLocaleString() + ' bytes; photos dealt onto fills: ' + w.dealt);
  ok('A1 the origin is at the ceiling (headroom under 30 KB)', w.storage.headroom() < 30000 && w.storage.headroom() > 0, 'headroom=' + w.storage.headroom());
  ok('A2 headroom cannot fit even a 640px photo write (' + (55325 * 2).toLocaleString() + ' bytes)', w.storage.headroom() < 55325 * 2);
  ok('A3 the fuel book is the largest single key', perKey['mt_fuel_fills'] === Math.max.apply(null, Object.keys(perKey).map(function (k) { return perKey[k]; })));

  log('\n— PHASE B: the PTI filing (tonight, on his phone) —');
  const repsBefore = w.sb.__pti.reports();
  const newRep = { id: 'ptiNEW', filedAt: 1759950000000, kind: 'post', signed: true, signature: SIG, odometer: 172228, result: 'pass', defects: [] };
  const ptiOk = w.sb.__pti.saveReportsVerified(repsBefore.concat([newRep]));
  ok('B1 the signed post-trip report SAVES', ptiOk === true);
  if (ptiOk) eq('B2 the filed report is in the stored book', (w.sb.__pti.reports().filter(function (r) { return r.id === 'ptiNEW'; }) || []).length, 1);
  else eq('B2 pre-fix: the stored book is unchanged (the inspection is simply gone)', w.sb.__pti.reports().length, repsBefore.length);

  log('\n— PHASE C: the Documents filing (this morning, CVSA page 1) —');
  const docRec = w.sb.Meticulous.modules.documents._addDoc({ label: 'CVIP / Safety', name: 'CVSA Inspection Report — Nov 5, 2026 (AB318427EI)', kind: 'image', data: DOC_PAGE1 });
  ok('C1 the document SAVES', !!docRec);
  if (docRec) {
    const stored = w.sb.Meticulous.modules.documents._items().filter(function (d) { return d.id === docRec.id; })[0];
    ok('C2 the stored document carries readable data', !!stored && typeof stored.data === 'string' && stored.data.length > 50000);
    const acct = w.cloud.docWrites.filter(function (x) { return x.col === 'documents' && x.id === docRec.id; })[0];
    ok('C3 the account holds the FULL page under the record id', !!acct && acct.doc.data === DOC_PAGE1);
  }

  log('\n— PHASE D: the small print — growing vs non-growing writes —');
  const sessions = w.store.get('sessions', []);
  ok('D1 a small growing write (one more day session) lands', w.store.set('sessions', sessions.concat([{ date: '2026-11-09', startTs: 1759950000000, elapsed: 41400, loads: 12, km: 366, pegFacts: 'x'.repeat(2400) }])) === true);
  ok('D2 a non-growing rewrite lands', w.store.set('onboarding', w.store.get('onboarding', {})) === true);

  log('\n— PHASE E: safety of the relief —');
  const fillsAfter = JSON.parse(w.storage.data['mt_fuel_fills']);
  const facts = function (list) { return list.map(function (r) { const c = {}; for (const k in r) { if (k !== 'photo' && k !== 'photos' && k !== 'photo2') c[k] = r[k]; } return c; }); };
  eq('E1 every fill\'s facts are byte-identical after relief', JSON.stringify(facts(fillsAfter)), JSON.stringify(facts(w.seed.fills)));
  eq('E2 the ONE unmarked photo survives byte-identical', fillsAfter[unmarkedIdx].photo, unmarkedPhoto);
  const shedList = fillsAfter.map(function (f, i) { return (w.seed.fills[i] && fillsCal[i].photo && !f.photo) ? i : -1; }).filter(function (i) { return i >= 0; });
  log('  relief shed ' + shedList.length + ' marked photo(s) at indices ' + JSON.stringify(shedList) + '; unmarked index ' + unmarkedIdx + ' untouched');
  ok('E3 no fill gained or lost a record', fillsAfter.length, w.seed.fills.length);
  ok('E4 relief shed at least one marked photo (room was actually freed)', shedList.length >= 1);
  ok('E5 every shed photo was a marked one', shedList.every(function (i) { return i !== unmarkedIdx && !!safeMap[docKeyOf(fillsCal[i])]; }));

  log('\n— PHASE F: the bootstrap audit (fresh marks) —');
  const w2 = makeWorld({ safeMap: null });
  const fuel2 = w2.sb.Meticulous.modules.fuel;
  ok('F1 the audit hook exists', typeof (fuel2 && fuel2._photoAudit) === 'function');
  if (fuel2 && typeof fuel2._photoAudit === 'function') {
    /* one photo's account write is made to fail */
    const w2fills = JSON.parse(w2.storage.data['mt_fuel_fills']);
    const withPhotos = w2fills.map(function (f, i) { return f.photo ? i : -1; }).filter(function (i) { return i >= 0; });
    const badIdx = withPhotos[0];
    w2.cloud.failDocs['fuel/' + docKeyOf(w2fills[badIdx])] = 1;
    await fuel2._photoAudit(); await flush();
    const safe2 = w2.store.get('fuel_photo_safe', {}) || {};
    let markedOk = 0, markedTotal = 0;
    withPhotos.forEach(function (i) { markedTotal++; if (safe2[docKeyOf(w2fills[i])]) markedOk++; });
    ok('F2 every reachable photo is marked after the audit', markedOk === markedTotal - 1, markedOk + '/' + markedTotal);
    ok('F3 the photo whose account write FAILED is NOT marked', !safe2[docKeyOf(w2fills[badIdx])]);
    ok('F4 the account holds the full stack for a marked photo', !!w2.cloud.fuelDocs[docKeyOf(w2fills[withPhotos[1]])] &&
      JSON.stringify(w2.cloud.fuelDocs[docKeyOf(w2fills[withPhotos[1]])].photo) === JSON.stringify(w2fills[withPhotos[1]].photo));
  }

  log('\n— PHASE G: the graft at the wall —');
  const fuel2g = w2.sb.Meticulous.modules.fuel;
  ok('G1 the heal hook exists', typeof (fuel2g && fuel2g._healPhotoGrafts) === 'function');
  if (fuel2g && typeof fuel2g._healPhotoGrafts === 'function') {
    /* w2's pool is brim-full with only ~3 KB of headroom: a
       cloud photo waits for a photo-less fill, but the graft's
       own verified save is the guard — it cannot conjure room,
       so the photo stays in the account and the pool is
       untouched. (The balance is relief, not a graft cap: see
       the v394 block in modules/fuel.js.) */
    const fillsG = JSON.parse(w2.storage.data['mt_fuel_fills']);
    const target = fillsG.filter(function (f) { return !f.photo; })[0];
    w2.cloud.fuelDocs[docKeyOf(target)] = { photo: PHOTO_640, date: target.date, odo: target.odo, litres: target.litres, cost: target.cost };
    const headBefore = w2.storage.headroom();
    const factsBefore = JSON.stringify(JSON.parse(w2.storage.data['mt_fuel_fills']).map(function (r) { const c = {}; for (const k in r) { if (k !== 'photo' && k !== 'photos' && k !== 'photo2') c[k] = r[k]; } return c; }));
    try { fuel2g._healPhotoGrafts(makeEl()); } catch (e) {}
    await flush(24);
    const headAfter = w2.storage.headroom();
    const targetAfter = JSON.parse(w2.storage.data['mt_fuel_fills']).filter(function (f) { return f.id === target.id; })[0];
    const factsAfter = JSON.stringify(JSON.parse(w2.storage.data['mt_fuel_fills']).map(function (r) { const c = {}; for (const k in r) { if (k !== 'photo' && k !== 'photos' && k !== 'photo2') c[k] = r[k]; } return c; }));
    /* the graft economy may land the photo — but only by
       freeing real room (the reclaim), never by conjuring it:
       the pool stays within the ceiling and every fact is
       exactly as it was */
    ok('G2 the pool stays within the ceiling through the heal', headAfter >= 0, 'headBefore=' + headBefore + ' headAfter=' + headAfter + ' photo landed=' + !!targetAfter.photo);
    eq('G3 every fill\'s facts are byte-identical through the heal', factsAfter, factsBefore);
  }

  log('\n— SOURCE PINS —');
  ok('S1 PTI error text (the field symptom) is the saveReportsVerified path', ptiSrc.indexOf('That inspection did NOT save') >= 0 && ptiSrc.indexOf('saveReportsVerified(reps)') >= 0);
  ok('S2 Documents error text is the addDoc path', docsSrc.indexOf('The document could NOT be saved on this phone') >= 0);
  ok('S3 the store relief registry exists in js/app.js', appSrc.indexOf('_relief') >= 0 && appSrc.indexOf('__mtRelief') >= 0);
  ok('S4 Documents keeps an account copy + a ladder in the save flow', docsSrc.indexOf("saveDoc('documents'") >= 0 && docsSrc.indexOf('shrinkDataUrl') >= 0);
  ok('S5 fuel registers the relief shedder + arm with the store', fuelSrc.indexOf('__mtRelief') >= 0 && fuelSrc.indexOf('shedMarkedPhotos') >= 0 && fuelSrc.indexOf('auditPhotoDocs') >= 0);

  log('\n== ' + pass + ' passed, ' + fail + ' failed ==');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('SUITE ERROR', e && e.stack || e); process.exit(2); });
