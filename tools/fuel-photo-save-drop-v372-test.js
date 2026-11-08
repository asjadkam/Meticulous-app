#!/usr/bin/env node
/*
 * fuel-photo-save-drop-v372-test.js — FUEL-PHOTO-SAVE-DROP-NOV7
 * ROUND 3 (owner evidence, Nov 7, 2026: TWO live survival tests
 * failed — web 370 at 19:10 and web 371 at 19:25–19:33, the
 * second on code proven byte-identical to the shipped 371):
 *
 *   1. On Fuel open the Nov 7 entry did NOT self-heal from its
 *      per-record account document.
 *   2. A fresh edit-attach under 371 (preview correct, Save,
 *      "All synced", two full reloads) — photo gone every time.
 *   3. The ladder's "kept at a smaller size" note NEVER appeared.
 *   4. Figures and counts never changed. Silent and total.
 *
 * Rounds 1–2 modelled the failure in harnesses that PASS. This
 * round drives the REAL shipped code end to end and traces the
 * photo through every hop:
 *
 *   REAL (sliced verbatim from the shipped sources at run time):
 *     - js/app.js's store object (the v48 verified-write store)
 *     - modules/fuel.js, whole (form, fuHandlePhoto, edit save,
 *       saveFillsVerified, fallback, fit ladder, photo doc,
 *       v350 graft — every photo decision the app makes)
 *     - js/ticket-ocr.js's _fileToSizedImage / fileToOCRImage /
 *       fileToStorageImage / shrinkDataUrl (the rendition code)
 *     - js/cloudsync.js, whole, for the pull round-trip phase
 *   FAKES ONLY AT THE OUTER SEAMS:
 *     - the pixel seam (FileReader / Image / canvas): a canvas
 *       "encodes" to the sizes sharp MEASURED on the owner's
 *       real receipt photos this morning — a 4000x3000 receipt
 *       is 357–697K base64 chars at 1600px, 240–485K at 1280px,
 *       146–300K at 960px, 69–133K at 640px; the Nov 7 receipt
 *       file (877x2048) is 77K / 58K / 36K / 19K. In this app a
 *       photo IS its data-URL string; length is the physics
 *       every quota decision turns on.
 *     - Firestore (FB): records every call, payload size and
 *       outcome into the trace; can be told to reject.
 *     - localStorage: TWO accounting models over ONE seed —
 *       (A) "harness": size counted in CHARACTERS, 10M ceiling
 *           (the rounds 1–2 model), and
 *       (B) "chromium": size counted in UTF-16 BYTES (2 per
 *           character, keys included), 10 MiB ceiling — the
 *           rule the real browser / WebView enforces.
 *     The seed is the same for both: the audited book (62 fills
 *     + 3 expenses; 9 photo-bearing fills whose photos carry
 *     MEASURED 1600px sizes, 357K–697K chars — rounds 1–2
 *     seeded 200K-char stand-ins) plus the other keys a real
 *     profile carries, sized so the fully-restored store sits
 *     ~10K chars under model B's ceiling — the exact interval
 *     the live evidence pins: photo-less saves land (headroom
 *     >= 0) and a +19K-char photo does not (headroom < 19K).
 *
 * THE TRACE is printed hop by hop: file selection -> OCR and
 * storage rendition landings -> the Save click -> every
 * verified-write attempt on the book (size + verdict) -> the
 * fallback -> every ladder rung -> the per-record doc call
 * (payload + outcome) -> reload -> the graft's reads and apply
 * attempts -> the details page's verdict.
 *
 * Run: node tools/fuel-photo-save-drop-v372-test.js [--trace]
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const fuelSrc = read('modules/fuel.js');
const ocrSrc = read('js/ticket-ocr.js');
const appSrc = read('js/app.js');
const csSrc = read('js/cloudsync.js');
const SHOW_TRACE = process.argv.indexOf('--trace') >= 0;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
const tick = () => new Promise(function (r) { setTimeout(r, 10); });
async function flush(n) { for (let i = 0; i < (n || 12); i++) await tick(); }

/* ---------- verbatim slices of the shipped code ---------- */
function sliceBlock(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  if (a < 0) throw new Error('slice start not found: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  if (b < 0) throw new Error('slice end not found: ' + endMarker);
  return src.slice(a, b + endMarker.length);
}
/* js/app.js: the store object, exactly as shipped */
const storeSlice = sliceBlock(appSrc, 'var store = {', '\n  };');
/* js/ticket-ocr.js: the rendition machinery, exactly as shipped */
const ocrSlice =
  sliceBlock(ocrSrc, 'function _fileToSizedImage', 'TicketOCR.fileToStorageImage = function (file, cb) { _fileToSizedImage(file, 1280, cb); };') +
  '\n' + sliceBlock(ocrSrc, 'TicketOCR.shrinkDataUrl = function', '\n  };');

/* ---------- the measured size physics (sharp, Nov 7) ---------- */
/* base64 chars of a JPEG rendition by longest side */
const PROFILE = {
  nov7:    { 1600: 77000, 1280: 58000, 960: 36000, 640: 19000 },           /* 877x2048, the Nov 7 Shell receipt */
  receipt: { 1600: 530000, 1280: 362000, 960: 228000, 640: 101000 }        /* 4000x3000 camera receipts (means of the measured samples) */
};
/* the 9 surviving book photos, at their audited dates, with
   MEASURED-class 1600px sizes (the sharp samples: 697K, 660K,
   599K, 357K, and the 240–697K band's interior points) */
const PHOTO_FILLS = [
  ['2026-10-13', 357000], ['2026-10-14', 697000], ['2026-10-15', 660000],
  ['2026-10-16', 599000], ['2026-10-17', 560000], ['2026-10-19', 500000],
  ['2026-10-22', 460000], ['2026-11-04', 410000], ['2026-11-05', 530000]
];
const RECEIPT_TEXT = ['Shell Canada', '#110 - 5305 Country Hills Blvd NE', 'Diesel', 'LITRES 115.262',
  'PRICE/L $2.169', 'TOTAL FUEL $250.00', '11/07/2026 18:00:12'].join('\n');

/* ---------- the seed: the audited book + a real profile's other keys ---------- */
function seedBook() {
  const fills = [];
  let n = 0;
  const photoByDate = {};
  PHOTO_FILLS.forEach(function (pd) { photoByDate[pd[0]] = pd[1]; });
  for (let t = Date.UTC(2026, 5, 25); fills.length < 52 && t < Date.UTC(2026, 10, 6); t += 2 * 86400000) {
    const ds = new Date(t).toISOString().slice(0, 10);
    if (photoByDate[ds]) continue;
    n++;
    fills.push({ date: ds, litres: (80 + n).toFixed(3), cost: (150 + n).toFixed(2), station: 'Mobil', odo: 160000 + n * 137 });
  }
  PHOTO_FILLS.forEach(function (pd, i) {
    fills.push({
      date: pd[0], litres: (83 + i).toFixed(3), cost: (190 + i).toFixed(2),
      station: i % 2 ? 'Petro-Canada' : 'Mobil', odo: 168000 + i * 211,
      photo: 'data:image/jpeg;base64,SEED' + i + ':' + 'P'.repeat(pd[1] - 30)
    });
  });
  fills.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  fills.push({ id: 'fuNov7seed', date: '2026-11-07', time: '06:07', litres: '115.262', cost: '250.00', station: 'Shell', odo: 171868, updAt: 1000 });
  return fills;
}
const EXPENSES = [
  { date: '2026-11-05', what: 'Malwa Tires & Services', cost: '294' },
  { date: '2026-10-17', what: 'Wash', cost: '52.50' },
  { date: '2026-10-13', what: 'DEF (Petro-Canada Langdon)', cost: '31.69' }
];
function shedCopy(book) {
  return book.map(function (r) { const c = {}; for (const k in r) { if (k !== 'photo' && k !== 'photos' && k !== 'photo2') c[k] = r[k]; } return c; });
}
/* the other keys a real, fully-restored profile carries —
   filler strings inside plausible shapes; only their SIZES
   matter (they are what the book's headroom is shared with) */
function otherKeys() {
  const F = function (n) { return 'x'.repeat(n); };
  return {
    'mt_livemiles': JSON.stringify({ days: { filler: F(200000) } }),
    'mt_sessions': JSON.stringify([{ filler: F(120000) }]),
    'mt_pti_reports': JSON.stringify([{ filler: F(60000) }]),
    'mt_geoloads': JSON.stringify({ days: { filler: F(40000) } }),
    'mt_rev_entries': JSON.stringify([{ filler: F(30000) }]),
    'mt_tracker': JSON.stringify({ status: 'idle' }),
    'mt_onboarding': JSON.stringify({ payStandard: 'Hourly', ownWageRate: 29, travelBonus: 0 }),
    'mt___syncmeta': JSON.stringify({ uid: 'u1', keys: {} })
  };
}

/* ---------- localStorage with a quota model ---------- */
const CEILING = { harness: 10000000, chromium: 10 * 1024 * 1024 };
function makeLocalStorage(model, trace) {
  const data = {};
  function sizeOf(k, v) { return model === 'chromium' ? 2 * (k.length + v.length) : (k.length + v.length); }
  function totalWith(k, v) {
    let t = 0;
    for (const key in data) t += sizeOf(key, key === k ? v : data[key]);
    if (!(k in data)) t += sizeOf(k, v);
    return t;
  }
  const ls = {
    getItem: function (k) { return (k in data) ? data[k] : null; },
    setItem: function (k, v) {
      v = String(v);
      const t = totalWith(k, v);
      if (t > CEILING[model]) {
        const err = new Error('QuotaExceededError'); err.name = 'QuotaExceededError';
        if (trace && k === 'mt_fuel_fills') trace.push('WRITE mt_fuel_fills ' + v.length + ' chars -> QUOTA THROW (origin total would be ' + t + ' of ' + CEILING[model] + ')');
        throw err;
      }
      if (trace && k === 'mt_fuel_fills') trace.push('WRITE mt_fuel_fills ' + v.length + ' chars -> OK');
      data[k] = v;
    },
    removeItem: function (k) { delete data[k]; },
    key: function (i) { return Object.keys(data)[i] || null; },
    get length() { return Object.keys(data).length; },
    _data: data,
    _headroom: function () { let t = 0; for (const k in data) t += sizeOf(k, data[k]); return CEILING[model] - t; }
  };
  /* seed DIRECTLY (the store accumulated over months of app
     versions; the quota is enforced on every NEW write, as the
     browser enforces it — silent lsSetRaw swallows included) */
  const book = seedBook();
  data['mt_fuel_fills'] = JSON.stringify(book);
  data['mt_fuel_expenses'] = JSON.stringify(EXPENSES);
  const ok2 = otherKeys();
  for (const k in ok2) data[k] = ok2[k];
  return ls;
}

/* ---------- the pixel seam (measured sizes) ---------- */
/* the registry is SHARED across the worlds of one replay: a
   data URL that survives a "reload" in the store is the same
   image afterwards, with the same pixels */
function makePixelRegistry() {
  const registry = {};   /* token -> {profile, maxPx, w, h} */
  PHOTO_FILLS.forEach(function (pd, i) { registry['SEED' + i] = { profile: 'receipt', maxPx: 1600, w: 4000, h: 3000 }; });
  return registry;
}
function makePixelSeam(trace, registry) {
  let canvN = 0;
  function profileSize(profile, maxPx) {
    const table = PROFILE[profile];
    const keys = Object.keys(table).map(Number).sort(function (a, b) { return a - b; });
    for (let i = 0; i < keys.length; i++) if (maxPx <= keys[i]) return table[keys[i]];
    return table[keys[keys.length - 1]];
  }
  function FakeFileReader() {}
  FakeFileReader.prototype.readAsDataURL = function (file) {
    const self = this;
    self.result = 'data:raw:' + (file && file.__profile || 'nov7');
    setTimeout(function () { if (self.onload) self.onload(); }, 0);
  };
  function FakeImage() { this._meta = null; }
  Object.defineProperty(FakeImage.prototype, 'src', {
    set: function (v) {
      const self = this;
      let m = /^data:raw:(\w+)/.exec(v || '');
      if (m) {
        self._meta = m[1] === 'nov7' ? { profile: 'nov7', maxPx: 2048, w: 877, h: 2048 } : { profile: 'receipt', maxPx: 4000, w: 4000, h: 3000 };
      } else {
        m = /^data:image\/jpeg;base64,([A-Z0-9]+)/.exec(v || '');
        self._meta = (m && registry[m[1]]) ? registry[m[1]] : { profile: 'receipt', maxPx: 1600, w: 4000, h: 3000 };
      }
      self.width = self._meta.w; self.height = self._meta.h;
      self.naturalWidth = self._meta.w; self.naturalHeight = self._meta.h;
      setTimeout(function () { if (self.onload) self.onload(); }, 0);
    },
    get: function () { return ''; }
  });
  const documentFake = {
    createElement: function (tag) {
      if (tag !== 'canvas') throw new Error('unexpected element ' + tag);
      const c = {
        width: 0, height: 0, _img: null,
        getContext: function () { return { drawImage: function (img) { c._img = img; } }; },
        toDataURL: function () {
          const meta = (c._img && c._img._meta) || { profile: 'receipt' };
          const maxPx = Math.max(c.width, c.height);
          const size = profileSize(meta.profile, maxPx);
          const token = 'CANV' + (canvN++);
          registry[token] = { profile: meta.profile, maxPx: maxPx, w: c.width, h: c.height };
          if (trace) trace.push('CANVAS encode profile=' + meta.profile + ' max=' + maxPx + ' -> ' + size + ' chars');
          return 'data:image/jpeg;base64,' + token + ':' + 'x'.repeat(Math.max(0, size - 30 - token.length));
        }
      };
      return c;
    },
    addEventListener: function () {}
  };
  return { FileReader: FakeFileReader, Image: FakeImage, document: documentFake, registry: registry };
}

/* ---------- DOM (the v371 world's pattern) ---------- */
function makeEl() {
  return {
    innerHTML: '', textContent: '', value: '', onclick: null, onchange: null, checked: false,
    files: null, style: {},
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    attrs: {},
    setAttribute: function (k, v) { this.attrs[k] = v; }, getAttribute: function (k) { return (k in this.attrs) ? this.attrs[k] : null; },
    querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    addEventListener: function () {}, click: function () { if (this.onclick) this.onclick(); },
    scrollIntoView: function () {}
  };
}

/* ---------- the world: real store + real fuel + real OCR over the seams ---------- */
function makeWorld(ls, cloud, trace, opts) {
  opts = opts || {};
  const pixel = makePixelSeam(trace, opts.pixelRegistry || makePixelRegistry());
  const els = {};
  const body = makeEl();
  body.querySelector = function (sel) { if (!els[sel]) els[sel] = makeEl(); return els[sel]; };
  let rowElsCache = null;
  body.querySelectorAll = function (sel) {
    if (sel === '[data-fuedit]') {
      if (!rowElsCache) {
        rowElsCache = JSON.parse(ls.getItem('mt_fuel_fills')).map(function (r, i) { const e = makeEl(); e.setAttribute('data-fuedit', String(i)); return e; });
      }
      return rowElsCache;
    }
    return [];
  };
  const sb = {
    console: console, Date: Date, Math: Math, JSON: JSON, Promise: Promise, setTimeout: setTimeout,
    FileReader: pixel.FileReader, Image: pixel.Image, document: pixel.document,
    localStorage: ls,
    App: {
      _today: function () { return '2026-11-07'; },
      _esc: function (s) { return String(s == null ? '' : s); },
      openModule: function () {},
      _photoDl: function () { return ''; },
      _masterOdometer: function () { return 171868; },
      _logOdoReading: function () {},
      _parseOdometerReading: function (text) { return /171868/.test(text || '') ? 171868 : null; }
    },
    Meticulous: { modules: {} },
    FB: {
      user: { uid: 'u1' },
      saveDoc: function (col, id, doc) {
        const photoLen = doc && typeof doc.photo === 'string' ? doc.photo.length : 0;
        if (opts.rejectDocs) {
          trace.push('FB.saveDoc ' + col + '/' + id + ' photo=' + photoLen + ' chars -> REJECTED (firestore/permission-denied) — and fuel.js attaches no .catch: the rejection is SILENT');
          return Promise.reject(new Error('firestore/permission-denied'));
        }
        if (col === 'fuel') cloud.docs[id] = JSON.parse(JSON.stringify(doc));
        cloud.writes.push({ col: col, id: id });
        trace.push('FB.saveDoc ' + col + '/' + id + ' photo=' + photoLen + ' chars -> RESOLVED (doc now in the account)');
        return Promise.resolve({});
      },
      loadDoc: function (col, id) {
        if (col === 'fuel' && cloud.docs[id]) {
          const d = JSON.parse(JSON.stringify(cloud.docs[id])); d.id = id;
          trace.push('FB.loadDoc fuel/' + id + ' -> HIT (photo ' + (d.photo ? d.photo.length : 0) + ' chars)');
          return Promise.resolve(d);
        }
        if (col === 'kv' && id === 'fuel_fills' && cloud.kvBook) {
          trace.push('FB.loadDoc kv/fuel_fills -> the book copy (photo fields shed: ' + cloud.kvBook.filter(function (r) { return r.photo; }).length + ' photos in it)');
          return Promise.resolve({ v: JSON.parse(JSON.stringify(cloud.kvBook)) });
        }
        if (col === 'kv' && id === 'fuel_expenses') return Promise.resolve({ v: JSON.parse(JSON.stringify(EXPENSES)) });
        if (col === 'fuel') trace.push('FB.loadDoc fuel/' + id + ' -> MISS (no such doc)');
        return Promise.resolve(null);
      },
      loadDocs: function (col) {
        if (col !== 'fuel') return Promise.resolve([]);
        return Promise.resolve(Object.keys(cloud.docs).map(function (id) {
          const d = JSON.parse(JSON.stringify(cloud.docs[id])); d.id = id; return d;
        }));
      }
    },
    TicketOCR: {
      urlToReadImage: function (url, kind, cb) { cb(url); },
      recognizeWithRotation: function () { return Promise.resolve(RECEIPT_TEXT); },
      parseFuelReceipt: function (text) {
        const L = /LITRES\s+([\d.]+)/.exec(text || ''), C = /TOTAL FUEL\s+\$([\d.]+)/.exec(text || ''),
          P = /PRICE\/L\s+\$([\d.]+)/.exec(text || '');
        return { litres: L ? L[1] : null, cost: C ? C[1] : null, station: 'Shell', date: '2026-11-07', time: '18:00', pricePerLitre: P ? P[1] : null, address: '5305 Country Hills Blvd NE' };
      },
      describeFuelRead: function (p) {
        const f = [];
        if (p.litres) f.push(p.litres + ' L'); if (p.cost) f.push('$' + p.cost); if (p.pricePerLitre) f.push('@ ' + p.pricePerLitre + '/L');
        return { found: f, missing: [] };
      },
      parseExpenseReceipt: function () { return { total: null, vendor: null, date: null }; },
      describeExpenseRead: function () { return { found: [], missing: [] }; }
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  /* the REAL store from js/app.js */
  vm.runInContext(storeSlice + '\n;this.__store = store;', sb, { filename: 'js/app.js (store slice)' });
  sb.App._store = sb.__store;
  /* instrument the seam: every verified-write attempt on the book */
  const origSet = sb.__store.set;
  sb.__store.set = function (k, v) {
    const r = origSet(k, v);
    if (k === 'fuel_fills') {
      const nov7 = (v || []).filter(function (x) { return x && x.date === '2026-11-07'; })[0];
      trace.push('store.set fuel_fills -> ' + r + ' (Nov 7 photo in this write: ' + (nov7 && nov7.photo ? nov7.photo.length + ' chars' : 'NONE') + ')');
    }
    return r;
  };
  /* the REAL rendition machinery from js/ticket-ocr.js */
  vm.runInContext(ocrSlice, sb, { filename: 'js/ticket-ocr.js (rendition slice)' });
  /* instrument the rendition landings */
  ['fileToOCRImage', 'fileToStorageImage', 'shrinkDataUrl'].forEach(function (fn) {
    const orig = sb.TicketOCR[fn];
    if (!orig) return;
    if (fn === 'shrinkDataUrl') {
      sb.TicketOCR[fn] = function (url, max, cb) {
        return orig(url, max, function (out) {
          trace.push('TicketOCR.shrinkDataUrl max=' + max + ' -> ' + (out ? out.length + ' chars' : 'null'));
          cb(out);
        });
      };
    } else {
      sb.TicketOCR[fn] = function (file, cb) {
        return orig(file, function (out) {
          trace.push('TicketOCR.' + fn + ' -> ' + (out ? out.length + ' chars' : 'null'));
          cb(out);
        });
      };
    }
  });
  /* the REAL fuel module, whole */
  vm.runInContext(fuelSrc, sb, { filename: 'modules/fuel.js' });
  return {
    api: sb.Meticulous.modules.fuel, body: body, els: els,
    fills: function () { return JSON.parse(ls.getItem('mt_fuel_fills')); }
  };
}

function nov7(fills) { return fills.filter(function (r) { return r.date === '2026-11-07'; })[0] || {}; }
function dumpTrace(trace, title) {
  console.log('  --- TRACE ' + title + ' ---');
  trace.forEach(function (line, i) { console.log('   ' + String(i + 1).padStart(2, ' ') + '. ' + line); });
}

/* the live test, replayed: open Fuel (graft), edit-attach, Save,
   reload, open Fuel (graft), open the entry */
async function liveReplay(model, opts) {
  opts = opts || {};
  const trace = [];
  const ls = makeLocalStorage(model, trace);
  const cloud = { docs: {}, kvBook: shedCopy(seedBook()), writes: [] };
  const headroom0 = ls._headroom();
  opts = Object.assign({}, opts, { pixelRegistry: makePixelRegistry() });

  const w1 = makeWorld(ls, cloud, trace, opts);
  w1.api.render(w1.body);                       /* Fuel open #1: the graft runs */
  await flush(16);
  const before = nov7(w1.fills());
  trace.push('STATE after Fuel open #1: Nov 7 photo = ' + (before.photo ? before.photo.length + ' chars' : 'ABSENT'));

  const idx = w1.fills().findIndex(function (r) { return r.date === '2026-11-07'; });
  w1.body.querySelectorAll('[data-fuedit]')[idx].onclick();
  await flush(4);
  const detailsSayNoPhoto1 = w1.body.innerHTML.indexOf('No photo for this entry') >= 0;
  w1.els['#fu_det_edit'].onclick();
  await flush(4);
  trace.push('SAVE SEQUENCE START (file selected)');
  w1.els['#fu_img'].files = [{ __profile: 'nov7' }];
  w1.els['#fu_img'].onchange({ target: w1.els['#fu_img'] });
  await flush(14);                              /* OCR + storage renditions land BEFORE the click, as in the live test (the read line had already painted) */
  trace.push('SAVE CLICK');
  w1.els['#fu_add'].onclick();
  await flush(20);
  const afterSave = nov7(w1.fills());
  trace.push('STATE after Save: Nov 7 photo = ' + (afterSave.photo ? afterSave.photo.length + ' chars' : 'ABSENT') + '; note painted: ' + JSON.stringify(w1.body.innerHTML.indexOf('smaller size') >= 0 ? 'smaller-size note PRESENT' : 'no smaller-size note'));
  cloud.kvBook = shedCopy(w1.fills());          /* the push lands: the cloud book copy is the v289 shed copy */

  const w2 = makeWorld(ls, cloud, trace, opts); /* full reload: fresh module over the same store + account */
  w2.api.render(w2.body);                       /* Fuel open #2: the graft runs again */
  await flush(24);
  const afterReload = nov7(w2.fills());
  trace.push('STATE after reload + Fuel open #2: Nov 7 photo = ' + (afterReload.photo ? afterReload.photo.length + ' chars' : 'ABSENT'));
  const idx2 = w2.fills().findIndex(function (r) { return r.date === '2026-11-07'; });
  w2.body.querySelectorAll('[data-fuedit]')[idx2].onclick();
  await flush(4);
  const detailsSayNoPhoto2 = w2.body.innerHTML.indexOf('No photo') >= 0;
  trace.push('DETAILS PAGE after reload: ' + (detailsSayNoPhoto2 ? '"No photo for this entry"' : 'photo shown'));
  return { trace: trace, ls: ls, cloud: cloud, headroom0: headroom0, before: before, afterSave: afterSave, afterReload: afterReload, w2: w2, detailsSayNoPhoto1: detailsSayNoPhoto1, detailsSayNoPhoto2: detailsSayNoPhoto2 };
}

(async function () {
  /* ===== MODEL A (control): harness accounting — chars, 10M ===== */
  {
    console.log('\n== MODEL A — rounds 1–2 accounting (characters, 10M ceiling), same seed, real code ==');
    const r = await liveReplay('harness');
    console.log('  headroom at start: ' + r.headroom0 + ' chars');
    ok('A1 the photo lands at the edit save (storage rendition)', typeof r.afterSave.photo === 'string' && Math.abs(r.afterSave.photo.length - PROFILE.nov7[1280]) <= 30,
      'photo is ' + (r.afterSave.photo ? r.afterSave.photo.length + ' chars' : 'ABSENT'));
    ok('A2 after reload the entry still holds its photo', typeof r.afterReload.photo === 'string' && r.afterReload.photo.length > 0);
    ok('A3 the details page shows the photo (no "No photo" text)', r.detailsSayNoPhoto2 === false);
    if (SHOW_TRACE) dumpTrace(r.trace, 'model A');
  }

  /* ===== MODEL B: the real browser's accounting ===== */
  {
    console.log('\n== MODEL B — Chromium accounting (UTF-16 bytes, 10 MiB ceiling), same seed, real code ==');
    const r = await liveReplay('chromium');
    console.log('  headroom at start: ' + r.headroom0 + ' bytes (' + Math.round(r.headroom0 / 2) + ' chars)');
    dumpTrace(r.trace, 'model B (always printed — this is the conviction)');
    ok('B1 figures survive the edit save exactly', parseFloat(r.afterSave.litres) === 115.262 && parseFloat(r.afterSave.cost) === 250 && r.afterSave.odo === 171868,
      String(r.afterSave.litres) + '|' + String(r.afterSave.cost) + '|' + r.afterSave.odo);
    eq('B2 the book still holds all 62 fills', r.w2.fills().length, 62);
    ok('B3 the per-record doc call FIRED with the photo (the account copy exists)',
      r.trace.some(function (l) { return l.indexOf('FB.saveDoc fuel/fillid_fuNov7seed') === 0; }),
      'no saveDoc line in the trace');
    ok('B4 AFTER RELOAD the entry HOLDS its photo on this device',
      typeof r.afterReload.photo === 'string' && r.afterReload.photo.length > 0,
      'photo is ' + (r.afterReload.photo === undefined ? 'ABSENT' : typeof r.afterReload.photo));
    ok('B5 the details page no longer says "No photo for this entry"', r.detailsSayNoPhoto2 === false);
    ok('B6 the cloud doc still holds the FULL storage rendition (never downgraded)',
      !!r.cloud.docs['fillid_fuNov7seed'] && typeof r.cloud.docs['fillid_fuNov7seed'].photo === 'string' && Math.abs(r.cloud.docs['fillid_fuNov7seed'].photo.length - PROFILE.nov7[1280]) <= 30);
    /* every legacy photo that was shrunk locally to make room
       must have its FULL copy in its own account doc (the doc
       key is the code's own: id key when born with one, else
       the content key) */
    let reclaimOk = true, shrunk = 0;
    r.w2.fills().forEach(function (f) {
      if (!f.photo || f.date === '2026-11-07') return;
      const seed = PHOTO_FILLS.filter(function (pd) { return pd[0] === f.date; })[0];
      if (!seed) return;
      const seedLen = seed[1] - 1; /* the seeded string's true length */
      if (f.photo.length < seedLen - 30) {
        shrunk++;
        const key = f.id ? 'fillid_' + String(f.id).replace(/[^a-zA-Z0-9_-]+/g, '-')
          : 'fill_' + [f.date || '', f.odo || '', f.litres || '', f.cost || ''].join('_').replace(/[^a-zA-Z0-9]+/g, '-');
        const doc = r.cloud.docs[key];
        if (!doc || !doc.photo || doc.photo.length < seedLen - 30) reclaimOk = false;
      }
    });
    console.log('  (legacy photos stored smaller on this device after the fix: ' + shrunk + ')');
    ok('B7 any locally-shrunk legacy photo kept its full copy in its account doc', reclaimOk);
  }

  /* ===== MODEL B2: the doc write REJECTS — is the failure silent? does local landing depend on it? ===== */
  {
    console.log('\n== MODEL B2 — Chromium accounting + Firestore rejects the photo doc ==');
    /* fuel.js's saveFillPhotoDoc attaches NO .catch to the
       FB.saveDoc promise — in the browser a rejection is an
       unhandled rejection (console noise, no UI trace). Node
       would kill this suite for the same rejection, so count
       them here as the evidence they are. */
    let unhandled = 0;
    const onUnhandled = function () { unhandled++; };
    process.on('unhandledRejection', onUnhandled);
    const r = await liveReplay('chromium', { rejectDocs: true });
    await flush(4);
    process.removeListener('unhandledRejection', onUnhandled);
    ok('B2c the rejected doc writes surfaced ONLY as unhandled rejections (' + unhandled + ') — no caller ever learns', unhandled > 0);
    ok('B2a the doc rejection is TRACED (fuel.js gives it no catch — it is silent in the app)',
      r.trace.some(function (l) { return l.indexOf('REJECTED') >= 0; }));
    /* with EVERY doc write rejecting, the reclaim must NOT
       shrink a neighbour photo — its full copy could not be
       confirmed in the account, and the local copy is the
       only one. The photo stays unlanded (the web 370/371
       fallback), the neighbours stay byte-identical, and
       nothing crashes: the safety property outranks the
       landing. */
    ok('B2b with the account unreachable, no neighbour photo is shrunk unsafely (all byte-identical)',
      PHOTO_FILLS.every(function (pd) {
        const f = r.w2.fills().filter(function (x) { return x.date === pd[0]; })[0];
        return f && f.photo && f.photo.length === pd[1] - 1;
      }));
    ok('B2d and the new photo does not land by sacrificing a neighbour (fallback behaviour stands)',
      r.afterReload.photo === undefined);
  }

  /* ===== MODEL B3: no-photo-anywhere control — nothing is invented, neighbours untouched ===== */
  {
    console.log('\n== MODEL B3 — control: an entry with no photo anywhere stays photo-less ==');
    const trace = [];
    const ls = makeLocalStorage('chromium', trace);
    const cloud = { docs: {}, kvBook: shedCopy(seedBook()), writes: [] };
    const w = makeWorld(ls, cloud, trace, {});
    w.api.render(w.body);
    await flush(24);
    const rec = nov7(w.fills());
    ok('B3a with no photo anywhere reachable, the entry stays photo-less', rec.photo === undefined);
    let untouched = true;
    w.fills().forEach(function (f) {
      const seed = PHOTO_FILLS.filter(function (pd) { return pd[0] === f.date; })[0];
      if (seed && (!f.photo || f.photo.length !== seed[1] - 1)) untouched = false;
    });
    ok('B3b no graft with nothing to land leaves every legacy photo byte-identical', untouched);
  }

  /* ===== MODEL B4: the pull round-trip (real cloudsync) cannot strip the landed photo ===== */
  {
    console.log('\n== MODEL B4 — pull round-trip over the landed book (real js/cloudsync.js) ==');
    const r = await liveReplay('chromium');
    const landed = nov7(r.w2.fills());
    if (landed.photo) {
      const data = {};
      const localStorage = {
        getItem: function (k) { return (k in data) ? data[k] : null; },
        setItem: function (k, v) { data[k] = String(v); },
        removeItem: function (k) { delete data[k]; },
        key: function (i) { return Object.keys(data)[i] || null; },
        get length() { return Object.keys(data).length; }
      };
      data['mt_fuel_fills'] = JSON.stringify(r.w2.fills());
      data['mt___syncmeta'] = JSON.stringify({ uid: 'u1', keys: { fuel_fills: { t: 1000, s: 1000, u: 'u1' } } });
      const sb = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, Promise: Promise };
      sb.window = sb; sb.localStorage = localStorage;
      sb.navigator = { onLine: true };
      sb.document = { getElementById: function () { return null; }, addEventListener: function () {} };
      sb.addEventListener = function () {};
      sb.FB = {
        ready: true, user: { uid: 'u1' },
        loadDocs: function () { return Promise.resolve([{ id: 'fuel_fills', v: shedCopy(r.w2.fills()), updatedAt: 2000 }]); },
        saveDoc: function () { return Promise.resolve({}); },
        deleteDoc: function () { return Promise.resolve({}); }
      };
      vm.createContext(sb);
      vm.runInContext(csSrc, sb);
      const store = {
        get: function (k, d) { const raw = localStorage.getItem('mt_' + k); return raw === null ? d : JSON.parse(raw); },
        set: function (k, v) { localStorage.setItem('mt_' + k, JSON.stringify(v)); return true; },
        del: function (k) { localStorage.removeItem('mt_' + k); return true; }
      };
      sb.CloudSync.attach(store);
      sb.CloudSync.onAuth({ uid: 'u1' });
      await new Promise(function (res) { setTimeout(res, 500); });
      const after = JSON.parse(data['mt_fuel_fills']);
      const recAfter = nov7(after);
      ok('B4 the shed cloud twin did NOT strip the landed photo on the pull round-trip', recAfter.photo === landed.photo,
        'photo is ' + (recAfter.photo === undefined ? 'ABSENT' : 'changed'));
    } else {
      ok('B4 the shed cloud twin did NOT strip the landed photo on the pull round-trip', false, 'no photo landed in model B — see B4 phase above');
    }
  }

  console.log('\nfuel-photo-save-drop-v372 (ROUND 3) test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR ' + (e && e.stack || e)); process.exit(1); });
