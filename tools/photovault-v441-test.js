#!/usr/bin/env node
/*
 * photovault-v441-test.js — PHOTO-VAULT-NOV12 (web 441)
 *
 * Owner evidence, Nov 12, 2026, 17:08 CST: the Mobil receipt
 * (63.370 L, $133.65, odo 172,903 km) previewed, the fill saved,
 * and the photo was shed at the save ("didn't fit in this
 * device's app storage") on a phone with ~118 GB free — the
 * fourth surface the localStorage wall has struck (v394). His
 * ruling: the app "has to store thousands if not hundreds of
 * thousands of pictures. So make sure that this space issue is
 * not happening ever again."
 *
 * THE FIX UNDER TEST (js/photovault.js + the store.get door in
 * js/app.js + App._photoDl's reference branch): photo bytes live
 * in the account (users/{uid}/photos — content-hash documents,
 * chunked past one document's reach) with an IndexedDB device
 * cache; books keep "mtphoto://<hash>" references; a sweep
 * migrates every inline photo out of every book; store.get
 * resolves references back to bytes for every existing reader.
 *
 * This suite drives the REAL shipped code — the store extracted
 * verbatim from js/app.js, js/photovault.js whole, js/firebase.js
 * whole for the OWN_COLLECTIONS pin — over a quota-faithful
 * localStorage (10 MiB, UTF-16 accounting, the v372/v394 model),
 * an in-memory Firestore, and a minimal IndexedDB. "Restart" =
 * a fresh vm world over the same localStorage + cloud, with the
 * device cache shared (restart) or fresh (cache wiped).
 *
 *   PHASE 0 — failing first, pre-fix semantics (no vault): at
 *             the calibrated wall the real store refuses the
 *             book + today's REAL receipt photo; the photo-less
 *             retry lands — the field's "No photo for this
 *             entry" state, reproduced.
 *   PHASE 1 — migration: the vault sweep drains the same wall:
 *             the pool drops from ~9.6 MB to under 1.5 MB, every
 *             seeded photo becomes a reference, every photo
 *             still resolves byte-identical after a restart AND
 *             after a full cache wipe (pure account fetch), and
 *             every non-photo field of every record is
 *             byte-identical to the seed.
 *   PHASE 2 — the Nov 12 attach itself: today's fill with the
 *             REAL receipt photo saves through the real store,
 *             is never blocked, and after sweep + restart +
 *             cache wipe the entry shows the photo byte-for-byte.
 *   PHASE 3 — scale: 215 photos (150 fills, 40 expenses, 25
 *             documents) accumulate in waves through the real
 *             store the way the modules write them; no save is
 *             ever refused, the local pool stays slim, and
 *             every photo resolves byte-identical from the
 *             account alone after a restart with a wiped cache.
 *   PHASE 4 — full-size payloads chunk: the REAL odometer
 *             photo (~791k chars of base64) rides as a 2-chunk
 *             manifest; a synthetic 1.6M-char payload as 3
 *             chunks; both resolve byte-identical.
 *   PHASE 5 — signed-out first, sign-in later: a photo stored
 *             with no account lives in the device vault, keeps
 *             resolving across restarts, and reaches the
 *             account on the first sweep after sign-in.
 *   PHASE 6 — pins: fuel's shedder/audit keep their hands off
 *             reference-sized stacks; _photoDl accepts a
 *             reference; account deletion owns the photos tree.
 *
 * Run: node tools/photovault-v441-test.js [--trace]
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');
const vaultSrc = read('js/photovault.js');
const fbSrc = read('js/firebase.js');
const fuelSrc = read('modules/fuel.js');
const SHOW_TRACE = process.argv.indexOf('--trace') >= 0;

let pass = 0, fail = 0;
function log(s) { console.log(s); }
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
const tick = () => new Promise(function (r) { setTimeout(r, 2); });
async function flush(n) { for (let i = 0; i < (n || 20); i++) await tick(); }

/* ---------- payloads ---------- */
function dataUrl(n, tag) {
  const head = Buffer.from('PHOTO#' + tag + '#').toString('base64');
  const pre = 'data:image/jpeg;base64,' + head;
  return pre + 'A'.repeat(Math.max(0, n - pre.length));
}
function realPhotoDataUrl(p) {
  const buf = fs.readFileSync(p);
  return 'data:image/jpeg;base64,' + buf.toString('base64');
}
const RECEIPT_PATH = process.env.PV_RECEIPT ||
  path.resolve(ROOT, '../../your_files/fuel-receipts/fuel-receipt-2026-11-12-mobil-westwinds.jpg');
const ODO_PATH = process.env.PV_ODO ||
  path.resolve(ROOT, '../../your_files/fuel-receipts/odometer-2026-11-12-172903km.jpg');
const RECEIPT = fs.existsSync(RECEIPT_PATH) ? realPhotoDataUrl(RECEIPT_PATH) : dataUrl(150775, 'receipt-fallback');
const ODO = fs.existsSync(ODO_PATH) ? realPhotoDataUrl(ODO_PATH) : dataUrl(791436, 'odo-fallback');
if (SHOW_TRACE) log('receipt chars=' + RECEIPT.length + ' odo chars=' + ODO.length);

const CEILING = 10 * 1024 * 1024; /* bytes, Chromium accounting (v372/v394) */

/* ---------- verbatim store slice (the v394 extraction) ---------- */
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

/* ---------- quota-faithful localStorage (the v394 model) ---------- */
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

/* ---------- in-memory Firestore behind the FB surface ---------- */
function makeCloud() {
  return { docs: {}, reads: 0, writes: 0, failWrites: false };
}
function makeFB(cloud, uid) {
  const FB = {
    user: uid ? { uid: uid, email: 'bench@example.com' } : null,
    ready: true,
    saveDoc: function (col, id, data) {
      if (!FB.user) return Promise.resolve(null);
      if (cloud.failWrites) return Promise.reject(new Error('bench offline'));
      cloud.writes++;
      const copy = JSON.parse(JSON.stringify(data));
      delete copy.updatedAt;
      cloud.docs[col + '/' + id] = copy;
      return Promise.resolve(undefined); /* a landed compat write resolves void */
    },
    loadDoc: function (col, id) {
      if (!FB.user) return Promise.resolve(null);
      cloud.reads++;
      const d = cloud.docs[col + '/' + id];
      if (!d) return Promise.resolve(null);
      return Promise.resolve(Object.assign({ id: id }, JSON.parse(JSON.stringify(d))));
    },
    loadDocs: function (col) {
      if (!FB.user) return Promise.resolve([]);
      cloud.reads++;
      return Promise.resolve(Object.keys(cloud.docs)
        .filter(function (k) { return k.indexOf(col + '/') === 0; })
        .map(function (k) { return Object.assign({ id: k.slice(col.length + 1) }, JSON.parse(JSON.stringify(cloud.docs[k]))); }));
    }
  };
  return FB;
}

/* ---------- minimal IndexedDB (exactly the surface the vault uses) ---------- */
function makeIDB() {
  const dbs = {};
  function fire(fn) { setTimeout(fn, 0); }
  function makeDb(name) {
    return {
      _name: name,
      _stores: { img: {}, meta: {} },
      createObjectStore: function (s) { if (!this._stores[s]) this._stores[s] = {}; return {}; },
      transaction: function (store, mode) {
        const self = this;
        const tx = { oncomplete: null, onerror: null, onabort: null };
        tx.objectStore = function (s) {
          if (!self._stores[s]) self._stores[s] = {};
          const bag = self._stores[s];
          return {
            get: function (key) {
              const rq = { result: undefined, onsuccess: null, onerror: null };
              fire(function () {
                rq.result = (key in bag) ? bag[key] : undefined;
                if (rq.onsuccess) rq.onsuccess();
                fire(function () { if (tx.oncomplete) tx.oncomplete(); });
              });
              return rq;
            },
            put: function (val, key) {
              const rq = { result: key, onsuccess: null, onerror: null };
              fire(function () {
                bag[key] = val;
                if (rq.onsuccess) rq.onsuccess();
                fire(function () { if (tx.oncomplete) tx.oncomplete(); });
              });
              return rq;
            }
          };
        };
        return tx;
      }
    };
  }
  return {
    _dbs: dbs,
    open: function (name, version) {
      const rq = { result: null, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null };
      setTimeout(function () {
        const isNew = !dbs[name];
        if (!dbs[name]) dbs[name] = makeDb(name);
        rq.result = dbs[name];
        if (isNew && rq.onupgradeneeded) rq.onupgradeneeded();
        if (rq.onsuccess) rq.onsuccess();
      }, 0);
      return rq;
    }
  };
}

/* ---------- a world: fresh page over shared device + account ---------- */
function makeWorld(opts) {
  const storage = opts.storage;
  const cloud = opts.cloud;
  const sb = {};
  sb.window = sb;
  sb.localStorage = storage;
  sb.indexedDB = opts.idb;
  sb.crypto = crypto.webcrypto;
  sb.TextEncoder = TextEncoder;
  sb.setTimeout = setTimeout;
  sb.clearTimeout = clearTimeout;
  sb.setInterval = function () { return 0; };       /* the vault's 30 s heartbeat is not the suite's clock */
  sb.clearInterval = function () {};
  sb.console = console;
  sb.document = {
    readyState: 'complete',
    body: null,
    addEventListener: function () {},
    querySelectorAll: function () { return []; }
  };
  sb.FB = makeFB(cloud, opts.signedIn === false ? null : 'testuid');
  vm.createContext(sb);
  vm.runInContext(extractStore(appSrc) + '\nthis.__store = store;', sb);
  sb.App = { _store: sb.__store, user: opts.signedIn === false ? null : { uid: 'testuid' }, _esc: function (s) { return String(s); } };
  if (opts.withVault !== false) vm.runInContext(vaultSrc, sb);
  return sb;
}

/* ---------- seed: the Nov-9-shaped wall (v394 calibration, photo-bearing) ---------- */
function seedWall(storage) {
  const fills = [];
  for (let i = 0; i < 30; i++) {
    const f = { id: 'fu' + i, date: '2026-11-' + String(1 + (i % 11)).padStart(2, '0'),
      litres: (80 + i).toFixed(3), cost: (170 + i).toFixed(2),
      station: i % 2 ? 'Petro-Canada' : 'Mobil', odo: 160000 + i * 187, updAt: 1794000000000 + i };
    if (i < 24) f.photo = dataUrl(140000, 'fill-' + i);
    fills.push(f);
  }
  const reps = [];
  for (let i = 0; i < 10; i++) {
    const r = { id: 'pti' + i, filedAt: 1794000000000 + i * 40000000, kind: i % 2 ? 'post' : 'pre',
      signed: true, signature: 'data:image/png;base64,' + 'G'.repeat(8700), odometer: 165000 + i * 80,
      result: 'pass', defects: [] };
    if (i < 4) r.defects.push({ item: 'lights', sev: 'minor', note: 'dim', photo: dataUrl(140000, 'pti-' + i) });
    reps.push(r);
  }
  const dmg = [
    { id: 'dmg1', date: '2026-11-02', what: 'Light pole', photos: [dataUrl(110000, 'dmg-1a'), dataUrl(110000, 'dmg-1b'), dataUrl(110000, 'dmg-1c')] },
    { id: 'dmg2', date: '2026-11-05', what: 'Tire', photos: [dataUrl(110000, 'dmg-2a'), dataUrl(110000, 'dmg-2b')] }
  ];
  const docs = [];
  for (let i = 0; i < 4; i++) docs.push({ id: 'doc' + i, label: 'Doc ' + i, name: 'Page', kind: 'image', data: dataUrl(110000, 'doc-' + i), addedAt: 1794000000000 + i });
  const raw = {
    'mt_fuel_fills': JSON.stringify(fills),
    'mt_fuel_expenses': JSON.stringify([{ date: '2026-11-03', what: 'DEF', cost: '42.00' }]),
    'mt_pti_reports': JSON.stringify(reps),
    'mt_dmg_reports': JSON.stringify(dmg),
    'mt_docs_items': JSON.stringify(docs),
    'mt_sessions': JSON.stringify([{ date: '2026-11-01', elapsed: 39000, loads: 9, pad: 'x'.repeat(150000) }]),
    'mt_onboarding': JSON.stringify({ companyName: 'Ai Trucking', truckNo: '07', pad: 'x'.repeat(20000) })
  };
  for (const k in raw) storage.data[k] = raw[k];
  /* every photo the seed holds, for the byte-identical roll-call */
  const photos = [];
  fills.forEach(function (f) { if (f.photo) photos.push(f.photo); });
  reps.forEach(function (r) { r.defects.forEach(function (d) { if (d.photo) photos.push(d.photo); }); photos.push(r.signature); });
  dmg.forEach(function (d) { d.photos.forEach(function (p) { photos.push(p); }); });
  docs.forEach(function (d) { photos.push(d.data); });
  return { raw: raw, photos: photos };
}
function stripPhotos(v) {
  if (typeof v === 'string') return (v.indexOf('data:image/') === 0 || v.indexOf('mtphoto://') === 0) ? '<PHOTO>' : v;
  if (Array.isArray(v)) return v.map(stripPhotos);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k in v) o[k] = stripPhotos(v[k]);
    return o;
  }
  return v;
}
function countInlinePhotoBytes(storage) {
  let t = 0;
  for (const k in storage.data) {
    const raw = storage.data[k];
    let m, re = /data:(?:image\/|application\/pdf)/g;
    while ((m = re.exec(raw))) { /* count roughly: from each marker to the next quote */
      const end = raw.indexOf('"', m.index);
      t += (end === -1 ? 0 : end - m.index);
    }
  }
  return t;
}
function collectRefs(storage) {
  const refs = [];
  for (const k in storage.data) {
    let m; const re = /mtphoto:\/\/([A-Za-z0-9_]+)/g;
    while ((m = re.exec(storage.data[k]))) refs.push(m[1]);
  }
  return refs;
}

(async function main() {
  log('PHOTO-VAULT-V441 — photo storage leaves the local pool');

  /* ================= PHASE 0: failing first ================= */
  log('PHASE 0 — the wall, pre-fix (no vault loaded)');
  {
    const storage = makeStorage();
    const seed = seedWall(storage);
    const cloud = makeCloud();
    const w = makeWorld({ storage: storage, cloud: cloud, idb: makeIDB(), withVault: false });
    const fillsNow = JSON.parse(storage.data['mt_fuel_fills']);
    const withPhoto = fillsNow.concat([{ id: 'fuNov12', date: '2026-11-12', litres: '63.370', cost: '133.65', station: 'Mobil Westwinds', odo: 172903, photo: RECEIPT }]);
    ok('P0.1 the pool is at the wall (headroom < one receipt photo)', storage.headroom() < RECEIPT.length * 2, 'headroom=' + storage.headroom());
    const landed = w.__store.set('fuel_fills', withPhoto);
    ok('P0.2 the book + receipt photo is REFUSED by the store', landed === false);
    const noPhoto = fillsNow.concat([{ id: 'fuNov12', date: '2026-11-12', litres: '63.370', cost: '133.65', station: 'Mobil Westwinds', odo: 172903 }]);
    ok('P0.3 the photo-less retry lands (the figures always saved)', w.__store.set('fuel_fills', noPhoto) === true);
    const saved = JSON.parse(storage.data['mt_fuel_fills']).filter(function (f) { return f.id === 'fuNov12'; })[0];
    ok('P0.4 the saved entry carries NO photo — "No photo for this entry"', !!saved && !saved.photo);
  }

  /* ================= PHASE 1: migration ================= */
  log('PHASE 1 — the sweep migrates the same wall');
  let world1;
  {
    const storage = makeStorage();
    const seed = seedWall(storage);
    const cloud = makeCloud();
    const idb = makeIDB();
    world1 = { storage: storage, cloud: cloud, idb: idb, seed: seed };
    const w = makeWorld({ storage: storage, cloud: cloud, idb: idb });
    const beforeBytes = storage.totalBytes();
    await w.PhotoVault.sweep();
    await flush();
    ok('P1.1 the pool drained (was ~' + Math.round(beforeBytes / 1048576 * 10) / 10 + ' MB)', storage.totalBytes() < 1.5 * 1024 * 1024, 'now=' + storage.totalBytes());
    ok('P1.2 no inline photo bytes remain in any book', countInlinePhotoBytes(storage) === 0, 'left=' + countInlinePhotoBytes(storage));
    const refs = collectRefs(storage);
    ok('P1.3 every seeded photo became a reference', refs.length >= seed.photos.length, 'refs=' + refs.length + ' seeded=' + seed.photos.length);
    let factsOk = true;
    for (const k in seed.raw) {
      if (JSON.stringify(stripPhotos(JSON.parse(storage.data[k]))) !== JSON.stringify(stripPhotos(JSON.parse(seed.raw[k])))) factsOk = false;
    }
    ok('P1.4 every non-photo field of every record is byte-identical', factsOk);
    /* restart, device cache intact */
    const w2 = makeWorld({ storage: storage, cloud: cloud, idb: idb });
    let allOk = true;
    for (const p of seed.photos) {
      const got = await resolveByContent(w2, p);
      if (got !== p) allOk = false;
    }
    ok('P1.5 after a restart, every migrated photo resolves byte-identical', allOk);
    /* restart, cache wiped — the account alone must answer */
    const w3 = makeWorld({ storage: storage, cloud: cloud, idb: makeIDB() });
    allOk = true;
    for (const p of seed.photos) {
      const got = await resolveByContent(w3, p);
      if (got !== p) allOk = false;
    }
    ok('P1.6 after a restart with the cache wiped, the account alone returns every photo byte-identical', allOk);
    /* the reader's door: store.get hands modules pictures, not references */
    const fillsBack = w3.__store.get('fuel_fills', []);
    await flush(30);
    const fillsBack2 = w3.__store.get('fuel_fills', []);
    const f0 = fillsBack2.filter(function (f) { return f.id === 'fu0'; })[0];
    ok('P1.7 store.get resolves the fill\'s photo back to its bytes for existing readers', !!f0 && f0.photo === seed.photos[0]);
    world1.finalStorage = storage;
  }
  async function resolveByContent(w, payload) {
    /* find the reference for a known payload by hashing it the
       vault's way, then resolve through the vault's public get */
    const key = await sha(payload);
    return w.PhotoVault.get('mtphoto://' + key);
  }
  async function sha(s) {
    const buf = await crypto.webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  /* ================= PHASE 2: the Nov 12 attach ================= */
  log('PHASE 2 — today\'s fill + the real receipt, on the migrated book');
  {
    const storage = world1.finalStorage;
    const cloud = world1.cloud;
    const w = makeWorld({ storage: storage, cloud: cloud, idb: makeIDB() });
    const fillsNow = w.__store.get('fuel_fills', []);
    await flush(30);
    const fillsHydrated = w.__store.get('fuel_fills', []);
    fillsHydrated.push({ id: 'fuNov12', date: '2026-11-12', litres: '63.370', cost: '133.65', station: 'Mobil Westwinds', odo: 172903, photo: RECEIPT, updAt: Date.now() });
    ok('P2.1 the fill WITH the receipt photo saves through the real store', w.__store.set('fuel_fills', fillsHydrated) === true);
    await w.PhotoVault.sweep();
    const rawRec = JSON.parse(storage.data['mt_fuel_fills']).filter(function (f) { return f.id === 'fuNov12'; })[0];
    ok('P2.2 the stored record holds a reference, not the payload', !!rawRec && typeof rawRec.photo === 'string' && rawRec.photo.indexOf('mtphoto://') === 0, rawRec && String(rawRec.photo).slice(0, 30));
    const w2 = makeWorld({ storage: storage, cloud: cloud, idb: makeIDB() });
    const back = w2.__store.get('fuel_fills', []);
    await flush(30);
    const back2 = w2.__store.get('fuel_fills', []);
    const rec = back2.filter(function (f) { return f.id === 'fuNov12'; })[0];
    ok('P2.3 after restart + cache wipe, the Nov 12 entry shows the receipt byte-for-byte', !!rec && rec.photo === RECEIPT);
    ok('P2.4 the local pool is still slim', storage.totalBytes() < 1.5 * 1024 * 1024, 'now=' + storage.totalBytes());
  }

  /* ================= PHASE 3: scale ================= */
  log('PHASE 3 — 215 photos accumulate in waves');
  {
    const storage = makeStorage();
    const cloud = makeCloud();
    const idb = makeIDB();
    const w = makeWorld({ storage: storage, cloud: cloud, idb: idb });
    const allPhotos = [];
    let refused = 0;
    /* fills: 15 waves x 10 */
    for (let wave = 0; wave < 15; wave++) {
      const fillsNow = w.__store.get('fuel_fills', []);
      await flush(6);
      const fillsH = w.__store.get('fuel_fills', []);
      for (let i = 0; i < 10; i++) {
        const p = dataUrl(60000, 'wave-fill-' + wave + '-' + i);
        allPhotos.push(p);
        fillsH.push({ id: 'fuW' + wave + '_' + i, date: '2026-11-12', litres: '50.000', cost: '100.00', station: 'Mobil', odo: 170000 + wave * 10 + i, photo: p });
      }
      if (!w.__store.set('fuel_fills', fillsH)) refused++;
      await w.PhotoVault.sweep();
    }
    /* expenses: 40 x ~60k */
    for (let e = 0; e < 40; e++) {
      const xNow = w.__store.get('fuel_expenses', []);
      await flush(4);
      const xH = w.__store.get('fuel_expenses', []);
      const p = dataUrl(30000, 'expense-' + e);
      allPhotos.push(p);
      xH.push({ date: '2026-11-10', what: 'Supplies ' + e, cost: '25.00', photo: p });
      if (!w.__store.set('fuel_expenses', xH)) refused++;
      if (e % 8 === 7) await w.PhotoVault.sweep();
    }
    /* documents: 25 x ~200k */
    for (let d = 0; d < 25; d++) {
      const dH = w.__store.get('docs_items', []);
      const p = dataUrl(150000, 'doc-' + d);
      allPhotos.push(p);
      dH.push({ id: 'docW' + d, label: 'Paper ' + d, name: 'Page', kind: 'image', data: p, addedAt: Date.now() });
      if (!w.__store.set('docs_items', dH)) refused++;
      if (d % 5 === 4) await w.PhotoVault.sweep();
    }
    await w.PhotoVault.sweep();
    await flush();
    ok('P3.1 no save was ever refused across 215 photo-bearing writes', refused === 0, 'refused=' + refused);
    ok('P3.2 the local pool stays slim with 215 photos in the account', storage.totalBytes() < 2.5 * 1024 * 1024, 'now=' + storage.totalBytes());
    ok('P3.3 no inline photo bytes remain', countInlinePhotoBytes(storage) === 0);
    const photoDocs = Object.keys(cloud.docs).filter(function (k) { return k.indexOf('photos/') === 0; }).length;
    ok('P3.4 the account holds one manifest per photo (215)', photoDocs === 215, 'docs=' + photoDocs);
    const w2 = makeWorld({ storage: storage, cloud: cloud, idb: makeIDB() });
    let allOk = true, checked = 0;
    for (const p of allPhotos) {
      const got = await resolveByContent(w2, p);
      if (got !== p) allOk = false;
      checked++;
    }
    ok('P3.5 all ' + checked + ' photos resolve byte-identical from the account alone', allOk);
  }

  /* ================= PHASE 4: chunking ================= */
  log('PHASE 4 — full-size payloads ride in chunks');
  {
    const storage = makeStorage();
    const cloud = makeCloud();
    const w = makeWorld({ storage: storage, cloud: cloud, idb: makeIDB() });
    const ref = await w.PhotoVault.put(ODO);
    ok('P4.1 put() hands back a reference for the full-size odometer photo', typeof ref === 'string' && ref.indexOf('mtphoto://') === 0);
    const key = ref.slice('mtphoto://'.length);
    const manifest = cloud.docs['photos/' + key];
    ok('P4.2 the manifest records 2 chunks for ~' + ODO.length + ' chars', !!manifest && manifest.n === 2 && !manifest.d, manifest && ('n=' + manifest.n));
    ok('P4.3 both chunk documents exist', !!cloud.docs['photos/' + key + '~0'] && !!cloud.docs['photos/' + key + '~1']);
    const big = dataUrl(1600000, 'huge');
    const ref2 = await w.PhotoVault.put(big);
    const key2 = ref2.slice('mtphoto://'.length);
    ok('P4.4 a 1.6M-char payload records 3 chunks', !!cloud.docs['photos/' + key2] && cloud.docs['photos/' + key2].n === 3);
    const w2 = makeWorld({ storage: storage, cloud: cloud, idb: makeIDB() });
    ok('P4.5 the odometer photo resolves byte-identical from the account', (await w2.PhotoVault.get(ref)) === ODO);
    ok('P4.6 the 1.6M payload resolves byte-identical from the account', (await w2.PhotoVault.get(ref2)) === big);
  }

  /* ================= PHASE 5: signed out, then in ================= */
  log('PHASE 5 — device vault first, account on sign-in');
  {
    const storage = makeStorage();
    const cloud = makeCloud();
    const idb = makeIDB();
    const w = makeWorld({ storage: storage, cloud: cloud, idb: idb, signedIn: false });
    const p = dataUrl(180000, 'offline-first');
    w.__store.set('fuel_fills', [{ id: 'fuOff', date: '2026-11-12', litres: '10.000', cost: '20.00', station: 'Mobil', photo: p }]);
    await w.PhotoVault.sweep();
    const rawRec = JSON.parse(storage.data['mt_fuel_fills'])[0];
    ok('P5.1 signed out, the record still trades its payload for a reference', !!rawRec && String(rawRec.photo).indexOf('mtphoto://') === 0);
    ok('P5.2 nothing reached the account while signed out', Object.keys(cloud.docs).length === 0);
    const w2 = makeWorld({ storage: storage, cloud: cloud, idb: idb, signedIn: false });
    ok('P5.3 across a restart the device vault still resolves it', (await resolveByContent(w2, p)) === p);
    const w3 = makeWorld({ storage: storage, cloud: cloud, idb: idb, signedIn: true });
    await w3.PhotoVault.sweep();
    await flush();
    ok('P5.4 the first sweep after sign-in lands it in the account', Object.keys(cloud.docs).filter(function (k) { return k.indexOf('photos/') === 0; }).length >= 1);
    const w4 = makeWorld({ storage: storage, cloud: cloud, idb: makeIDB(), signedIn: true });
    ok('P5.5 and from then on the account alone resolves it', (await resolveByContent(w4, p)) === p);
  }

  /* ================= PHASE 6: pins ================= */
  log('PHASE 6 — boundary pins');
  {
    ok('P6.1 the fuel shedder skips reference-sized stacks', fuelSrc.indexOf('if (sz < 20000) return;') !== -1 && fuelSrc.indexOf('PHOTO-VAULT-NOV12') !== -1);
    ok('P6.2 the fuel audit never writes a reference into a photo document', fuelSrc.indexOf('if (stackChars(ps) < 20000) return;') !== -1);
    ok('P6.3 App._photoDl accepts a vault reference', appSrc.indexOf("photo.indexOf('mtphoto://') === 0") !== -1);
    const sb2 = {};
    sb2.window = sb2;
    sb2.console = console;
    sb2.document = { readyState: 'complete', addEventListener: function () {} };
    vm.createContext(sb2);
    vm.runInContext(fbSrc, sb2);
    ok('P6.4 account deletion owns the photos tree', !!sb2.FB && Array.isArray(sb2.FB.OWN_COLLECTIONS) && sb2.FB.OWN_COLLECTIONS.indexOf('photos') !== -1);
    /* a book with no references reads through the new door untouched */
    const storage = makeStorage();
    const cloud = makeCloud();
    const w = makeWorld({ storage: storage, cloud: cloud, idb: makeIDB() });
    const plain = [{ id: 's1', date: '2026-11-12', loads: 7, km: 175.5 }];
    w.__store.set('sessions', plain);
    ok('P6.5 a reference-free book round-trips byte-identical through store.get', JSON.stringify(w.__store.get('sessions', [])) === JSON.stringify(plain));
  }

  log('');
  log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('SUITE ERROR', e && e.stack || e);
  process.exit(2);
});
