#!/usr/bin/env node
/*
 * fuel-photo-save-drop-v373-test.js — FUEL-PHOTO-SAVE-DROP-NOV7
 * ROUND 4 (owner evidence, Nov 7, 2026, evening): the web 372 fix
 * works generally — the Nov 7 entry self-healed from its account
 * copy and attach pass Part A put photos on Oct 1, 2, 3, 5, 6, 7,
 * 8 (all verified displayed after full reload, figures exact).
 * Oct 10 (Mobil, 105.977 L, $250.00, $2.359/L, odometer BLANK)
 * is the lone exception: TWO clean edit-attach saves, both with
 * the "didn't fit — kept in your account copy" note, and after
 * reload + fresh sessions the entry still shows "No photo for
 * this entry." Attempt 2 also flashed "Sync problem — a fuel
 * entry hasn't backed up" during the post-save wait.
 *
 * This round drives the REAL shipped code (the v372 harness's
 * slices: app.js store, fuel.js whole, ticket-ocr rendition
 * code) through the Part A evening itself:
 *
 *   PHASE 0 — a fresh profile restores the book from the cloud
 *     (photo fields shed, per v289) and the v350 graft lands the
 *     nine surviving baseline photos from their account docs,
 *     through the fit ladder + reclaim, exactly as it did live.
 *   PHASE 1 — the Part A sequence in that same world: edit-
 *     attach Oct 1, 2, 3, 5, 6, 7, 8, then Oct 10, each through
 *     the real form/save path, with each file's MEASURED
 *     rendition sizes (PIL/libjpeg q85 on the owner's real
 *     receipt downloads, Nov 7) and the live OCR outcomes
 *     (Oct 1 + Oct 10 unreadable; the rest read).
 *   PHASE 2 — full reload in the same profile; the graft runs
 *     again.
 *   PHASE 3 — a fresh profile WITH headroom and only the cloud
 *     docs to heal from: the doc-existence / key round-trip
 *     proof for Oct 10 and for the "didn't fit" control Oct 2.
 *   PHASE 4 — the deterministic spent-book unit: every stored
 *     photo already at or under the reclaim's 960px ceiling, the
 *     origin at the wall, Oct 10's doc present in the account.
 *     Swept over five record shapes for the Oct 10 entry (id /
 *     no-id, time / no-time, string / numeric figures).
 *
 * Firestore is faked FAITHFULLY at the one seam that matters:
 * saveDoc rejects any document whose payload exceeds the real
 * 1,048,576-byte Firestore limit (Oct 10's real doc payload is
 * ~510K chars — it must RESOLVE), and resolves the rest.
 *
 * Run: node tools/fuel-photo-save-drop-v373-test.js [--trace]
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
const storeSlice = sliceBlock(appSrc, 'var store = {', '\n  };');
const ocrSlice =
  sliceBlock(ocrSrc, 'function _fileToSizedImage', 'TicketOCR.fileToStorageImage = function (file, cb) { _fileToSizedImage(file, 1280, cb); };') +
  '\n' + sliceBlock(ocrSrc, 'TicketOCR.shrinkDataUrl = function', '\n  };');

/* ---------- measured size physics (PIL/libjpeg q85, Nov 7, on the
   owner's real receipt downloads; data-URL char lengths) ---------- */
const FILE_PROFILES = {
  oct1:  { 1600: 755000, 1280: 520663, 960: 296431, 640: 125907 },
  oct2:  { 1600: 716000, 1280: 493999, 960: 300899, 640: 136415 },
  oct3:  { 1600: 685000, 1280: 472227, 960: 277527, 640: 123011 },
  oct5:  { 1600: 600000, 1280: 414199, 960: 253395, 640: 119459 },
  oct6:  { 1600: 521000, 1280: 359331, 960: 223651, 640: 106107 },
  oct7:  { 1600: 486000, 1280: 335055, 960: 197947, 640: 85631 },
  oct8:  { 1600: 486000, 1280: 335039, 960: 206611, 640: 98923 },
  oct10: { 1600: 740000, 1280: 510391, 960: 306511, 640: 139571 },
  base:  { 1600: 560000, 1280: 380000, 960: 235000, 640: 105000 }  /* the baseline phone-era photos (round-3 measured band) */
};
function photoStr(token, len) {
  const head = 'data:image/jpeg;base64,' + token + ':';
  return head + 'x'.repeat(Math.max(0, len - head.length));
}
/* the module's own key derivation, mirrored for seed/doc setup */
function contentKey(rec) {
  return 'fill_' + [rec.date || '', rec.odo || '', rec.litres || '', rec.cost || '']
    .join('_').replace(/[^a-zA-Z0-9]+/g, '-');
}
function docKey(rec) {
  if (rec.id) return 'fillid_' + String(rec.id).replace(/[^a-zA-Z0-9_-]+/g, '-');
  return contentKey(rec);
}

/* ---------- the book: the audited 62 fills, Part A cast in full ---------- */
const BASELINE_PHOTOS = [ /* the 9 photo-carrying fills of the Nov 7 audit */
  ['2026-10-13', 357000], ['2026-10-14', 697000], ['2026-10-15', 660000],
  ['2026-10-16', 599000], ['2026-10-17', 560000], ['2026-10-19', 500000],
  ['2026-10-22', 460000], ['2026-11-04', 410000], ['2026-11-05', 530000]
];
const PARTA = [ /* photo-less at the start of the pass, real figures */
  { date: '2026-10-01', litres: '82.832', cost: '192.09', station: 'Mobil', profile: 'oct1', ocr: 'junk' },
  { date: '2026-10-02', litres: '108.271', cost: '250', station: 'Mobil', profile: 'oct2', ocr: 'read', time: '17:40', price: '2.309' },
  { date: '2026-10-03', litres: '97.357', cost: '223.92', station: 'Mobil', profile: 'oct3', ocr: 'read' },
  { date: '2026-10-05', litres: '108.742', cost: '250', station: 'Mobil', profile: 'oct5', ocr: 'read' },
  { date: '2026-10-06', litres: '108.742', cost: '250', station: 'Mobil', profile: 'oct6', ocr: 'read' },
  { date: '2026-10-07', litres: '115.794', cost: '250', station: 'Mobil', profile: 'oct7', ocr: 'read' },
  { date: '2026-10-08', litres: '54.637', cost: '93.92', station: 'Mobil', profile: 'oct8', ocr: 'read' }
];
function oct10Record(shape) {
  const rec = { date: '2026-10-10', station: 'Mobil', pricePerLitre: '2.359' };
  if (shape === 'numeric') { rec.litres = 105.977; rec.cost = 250; }
  else { rec.litres = '105.977'; rec.cost = '250'; }
  if (shape === 'id-time' || shape === 'id-notime') { rec.id = 'fuOct10seed'; rec.updAt = 500; }
  if (shape === 'id-time' || shape === 'legacy-time') rec.time = '12:05';
  /* every shape: NO odo — the entry's odometer is blank */
  return rec;
}
function seedBook(oct10Shape) {
  const fills = [];
  const photoByDate = {};
  BASELINE_PHOTOS.forEach(function (pd) { photoByDate[pd[0]] = pd[1]; });
  let n = 0;
  for (let t = Date.UTC(2026, 5, 25); fills.length < 41 && t < Date.UTC(2026, 9, 1); t += 2 * 86400000) {
    const ds = new Date(t).toISOString().slice(0, 10);
    if (photoByDate[ds]) continue;
    n++;
    fills.push({ date: ds, litres: (80 + n).toFixed(3), cost: (150 + n).toFixed(2), station: 'Mobil', odo: 160000 + n * 137 });
  }
  PARTA.forEach(function (p) {
    fills.push({ date: p.date, litres: p.litres, cost: p.cost, station: p.station });
  });
  fills.push(oct10Record(oct10Shape));
  ['2026-10-20', '2026-10-21', '2026-10-30'].forEach(function (ds, i) {
    fills.push({ date: ds, litres: (90 + i * 7).toFixed(3), cost: (210 + i * 11).toFixed(2), station: 'Petro-Canada', odo: 170100 + i * 320 });
  });
  BASELINE_PHOTOS.forEach(function (pd, i) {
    fills.push({
      date: pd[0], litres: (83 + i).toFixed(3), cost: (190 + i).toFixed(2),
      station: i % 2 ? 'Petro-Canada' : 'Mobil', odo: 168000 + i * 211,
      photo: photoStr('SEED' + i, pd[1])
    });
  });
  fills.push({ id: 'fuNov7seed', date: '2026-11-07', time: '06:07', litres: '115.262', cost: '250.00', station: 'Shell', odo: 171868, updAt: 1000,
    photo: photoStr('NOV7', FILE_PROFILES.base[640]) });
  fills.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
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
/* the baseline docs the account holds at the start of the evening:
   the v350 per-record docs, written by the phone-era saves with
   the records' 1600px-era photos on them */
function seedCloud(oct10Shape) {
  const book = seedBook(oct10Shape);
  const docs = {};
  book.forEach(function (r) {
    if (!r.photo) return;
    const d = {}; for (const k in r) d[k] = r[k];
    docs[docKey(r)] = d;
  });
  return { docs: docs, kvBook: shedCopy(book), writes: [] };
}

/* ---------- localStorage with the Chromium quota model ---------- */
const CEILING = 10 * 1024 * 1024; /* bytes; 2 per char, keys included */
function makeLocalStorage(seedFills, otherFillerChars) {
  const data = {};
  function sizeOf(k, v) { return 2 * (k.length + v.length); }
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
      if (totalWith(k, v) > CEILING) {
        const err = new Error('QuotaExceededError'); err.name = 'QuotaExceededError';
        throw err;
      }
      data[k] = v;
    },
    removeItem: function (k) { delete data[k]; },
    key: function (i) { return Object.keys(data)[i] || null; },
    get length() { return Object.keys(data).length; },
    _data: data,
    _headroom: function () { let t = 0; for (const k in data) t += sizeOf(k, data[k]); return CEILING - t; }
  };
  data['mt_fuel_fills'] = JSON.stringify(seedFills);
  data['mt_fuel_expenses'] = JSON.stringify(EXPENSES);
  const F = function (n2) { return 'x'.repeat(n2); };
  data['mt_livemiles'] = JSON.stringify({ days: { filler: F(otherFillerChars) } });
  data['mt_sessions'] = JSON.stringify([{ filler: F(120000) }]);
  data['mt_pti_reports'] = JSON.stringify([{ filler: F(60000) }]);
  data['mt_geoloads'] = JSON.stringify({ days: { filler: F(40000) } });
  data['mt_rev_entries'] = JSON.stringify([{ filler: F(30000) }]);
  data['mt_tracker'] = JSON.stringify({ status: 'idle' });
  data['mt_onboarding'] = JSON.stringify({ payStandard: 'Hourly', ownWageRate: 29, travelBonus: 0 });
  data['mt___syncmeta'] = JSON.stringify({ uid: 'u1', keys: {} });
  return ls;
}
/* solve the livemiles filler so the seeded origin sits
   targetHeadroomChars under the ceiling (the round-3 pin:
   photo-less saves land, a +640-rung photo does not) */
function calibrateFiller(seedFills, targetHeadroomChars) {
  const probe = makeLocalStorage(seedFills, 0);
  const head0 = probe._headroom() / 2; /* in chars */
  return Math.max(0, Math.round(head0 - targetHeadroomChars));
}

/* ---------- the pixel seam (per-file measured sizes) ---------- */
function makePixelRegistry() {
  const registry = {};
  BASELINE_PHOTOS.forEach(function (pd, i) {
    registry['SEED' + i] = { sizes: FILE_PROFILES.base, w: 1600, h: 1200 };
  });
  registry['NOV7'] = { sizes: FILE_PROFILES.base, w: 640, h: 480 };
  return registry;
}
let CANV_N = 0; /* global across worlds: a canvas token names one
   image for the whole run, as a data URL does in the real app */
function makePixelSeam(trace, registry) {
  let canvN = CANV_N;
  const syncCanv = function () { CANV_N = canvN; };
  function profileSize(sizes, maxPx) {
    const keys = Object.keys(sizes).map(Number).sort(function (a, b) { return a - b; });
    for (let i = 0; i < keys.length; i++) if (maxPx <= keys[i]) return sizes[keys[i]];
    return sizes[keys[keys.length - 1]];
  }
  function FakeFileReader() {}
  FakeFileReader.prototype.readAsDataURL = function (file) {
    const self = this;
    self.result = 'data:raw:' + (file && file.__profile || 'oct10');
    setTimeout(function () { if (self.onload) self.onload(); }, 0);
  };
  function FakeImage() { this._meta = null; }
  Object.defineProperty(FakeImage.prototype, 'src', {
    set: function (v) {
      const self = this;
      let m = /^data:raw:(\w+)/.exec(v || '');
      if (m) {
        const prof = FILE_PROFILES[m[1]] || FILE_PROFILES.oct10;
        self._meta = { sizes: prof, w: 4000, h: 3000 };
      } else {
        m = /^data:image\/jpeg;base64,([A-Z0-9]+)/.exec(v || '');
        self._meta = (m && registry[m[1]]) ? registry[m[1]] : { sizes: FILE_PROFILES.base, w: 1600, h: 1200 };
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
          const meta = (c._img && c._img._meta) || { sizes: FILE_PROFILES.base };
          const maxPx = Math.max(c.width, c.height);
          const size = profileSize(meta.sizes, maxPx);
          const token = 'CANV' + (canvN++); syncCanv();
          registry[token] = { sizes: meta.sizes, w: c.width, h: c.height };
          return photoStr(token, size);
        }
      };
      return c;
    },
    addEventListener: function () {}
  };
  return { FileReader: FakeFileReader, Image: FakeImage, document: documentFake, registry: registry };
}

/* ---------- DOM (the v372 world's pattern) ---------- */
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

/* ---------- the world ---------- */
const FS_DOC_LIMIT = 1048576;
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
  const world = { ocrText: opts.ocrText || '' };
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
      _parseOdometerReading: function () { return null; }
    },
    Meticulous: { modules: {} },
    FB: {
      user: { uid: 'u1' },
      saveDoc: function (col, id, doc) {
        const payload = JSON.stringify(doc).length;
        const photoLen = doc && typeof doc.photo === 'string' ? doc.photo.length : 0;
        if (payload > FS_DOC_LIMIT) {
          trace.push('FB.saveDoc ' + col + '/' + id + ' payload=' + payload + ' -> REJECTED (exceeds the Firestore document limit)');
          return Promise.reject(new Error('firestore: document too large'));
        }
        if (col === 'fuel') cloud.docs[id] = JSON.parse(JSON.stringify(doc));
        cloud.writes.push({ col: col, id: id });
        trace.push('FB.saveDoc ' + col + '/' + id + ' photo=' + photoLen + ' payload=' + payload + ' -> RESOLVED');
        return Promise.resolve({});
      },
      loadDoc: function (col, id) {
        if (col === 'fuel' && cloud.docs[id]) {
          const d = JSON.parse(JSON.stringify(cloud.docs[id])); d.id = id;
          trace.push('FB.loadDoc fuel/' + id + ' -> HIT (photo ' + (d.photo ? d.photo.length : 0) + ' chars)');
          return Promise.resolve(d);
        }
        if (col === 'kv' && id === 'fuel_fills' && cloud.kvBook) {
          return Promise.resolve({ v: JSON.parse(JSON.stringify(cloud.kvBook)) });
        }
        if (col === 'kv' && id === 'fuel_expenses') return Promise.resolve({ v: JSON.parse(JSON.stringify(EXPENSES)) });
        if (col === 'fuel') trace.push('FB.loadDoc fuel/' + id + ' -> MISS');
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
      recognizeWithRotation: function () { return Promise.resolve(world.ocrText); },
      parseFuelReceipt: function (text) {
        const L = /LITRES\s+([\d.]+)/.exec(text || ''), C = /TOTAL\s+\$([\d.]+)/.exec(text || ''),
          P = /PRICE\s+([\d.]+)/.exec(text || ''), T = /TIME\s+(\d+:\d+)/.exec(text || '');
        return { litres: L ? L[1] : null, cost: C ? C[1] : null, station: null, date: null, time: T ? T[1] : null, pricePerLitre: P ? P[1] : null, address: null };
      },
      describeFuelRead: function (p) {
        const f = [];
        if (p.litres) f.push(p.litres + ' L'); if (p.cost) f.push('$' + p.cost);
        return { found: f, missing: f.length ? [] : ['everything'] };
      },
      parseExpenseReceipt: function () { return { total: null, vendor: null, date: null }; },
      describeExpenseRead: function () { return { found: [], missing: [] }; }
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(storeSlice + '\n;this.__store = store;', sb, { filename: 'js/app.js (store slice)' });
  sb.App._store = sb.__store;
  /* instrument the seam: every verified-write attempt on the book —
     per-record photo lengths, and PHANTOM writes (a write whose
     book is byte-identical to the previous one: a reclaim that
     "succeeded" while freeing nothing) */
  const stats = { phantomWrites: 0, shrinkEvents: [], writes: 0, oct10Log: [] };
  let prevJson = ls.getItem('mt_fuel_fills');
  let prevLens = {};
  JSON.parse(prevJson).forEach(function (r) { prevLens[r.date] = r.photo ? r.photo.length : 0; });
  const origSet = sb.__store.set;
  sb.__store.set = function (k, v) {
    const r = origSet(k, v);
    if (k === 'fuel_fills') {
      stats.writes++;
      const nowLens = {};
      (v || []).forEach(function (rec) { nowLens[rec.date] = rec.photo ? rec.photo.length : 0; });
      const oBefore = prevLens['2026-10-10'] || 0, oAfter = nowLens['2026-10-10'] || 0;
      if (oBefore !== oAfter) {
        const frames = (new Error().stack || '').split('\n').slice(1, 8)
          .map(function (s) { const m = /at (\S+)/.exec(s); return m ? m[1] : ''; })
          .filter(function (s) { return s && s !== 'Object' && s.indexOf('sb.__store') < 0; }).slice(0, 3).join(' < ');
        stats.oct10Log.push({ ok: r === true, from: oBefore, to: oAfter, via: frames });
      }
      if (r !== true) return r; /* a refused write changes nothing on disk — it is not state */
      const nowJson = JSON.stringify(v);
      if (nowJson === prevJson) stats.phantomWrites++;
      (v || []).forEach(function (rec) {
        const before = prevLens[rec.date] || 0, after = nowLens[rec.date];
        if (before && after && after < before) stats.shrinkEvents.push({ date: rec.date, from: before, to: after, freed: before - after });
        if (before && !after) stats.shrinkEvents.push({ date: rec.date, from: before, to: 0, freed: before, LOST: true });
      });
      prevJson = nowJson; prevLens = nowLens;
    }
    return r;
  };
  vm.runInContext(ocrSlice, sb, { filename: 'js/ticket-ocr.js (rendition slice)' });
  vm.runInContext(fuelSrc, sb, { filename: 'modules/fuel.js' });
  return {
    api: sb.Meticulous.modules.fuel, body: body, els: els, stats: stats, world: world,
    fills: function () { return JSON.parse(ls.getItem('mt_fuel_fills')); }
  };
}

function byDate(fills, ds) { return fills.filter(function (r) { return r.date === ds; })[0] || {}; }
function dumpTrace(trace, title) {
  console.log('  --- TRACE ' + title + ' ---');
  trace.forEach(function (line, i) { console.log('   ' + String(i + 1).padStart(2, ' ') + '. ' + line); });
}

/* one Part A attach, through the real form: open the entry,
   edit, attach the file, wait for the renditions, save, let
   the ladder + reclaim settle */
async function attachFlow(w, dateStr, profile, ocrText) {
  const idx = w.fills().findIndex(function (r) { return r.date === dateStr; });
  if (idx < 0) throw new Error('entry not found: ' + dateStr);
  w.body.querySelectorAll('[data-fuedit]')[idx].onclick();
  await flush(4);
  w.els['#fu_det_edit'].onclick();
  await flush(4);
  /* the fake DOM keeps field values across renders; a real
     render starts from the record — set the fields the way the
     prefill leaves them for these entries (odo blank) */
  w.els['#fu_odo'].value = '';
  w.world.ocrText = ocrText;
  w.els['#fu_img'].files = [{ __profile: profile }];
  w.els['#fu_img'].onchange({ target: w.els['#fu_img'] });
  await flush(16);
  w.els['#fu_add'].onclick();
  await flush(50);
  const rec = byDate(w.fills(), dateStr);
  return {
    landed: typeof rec.photo === 'string' && rec.photo.length > 0,
    size: rec.photo ? rec.photo.length : 0,
    noteDidntFit: w.body.innerHTML.indexOf("didn't fit") >= 0
  };
}
function ocrFor(p) {
  if (p.ocr === 'junk') return 'PREAUTH — terminal copy, figures illegible';
  return ['Mobil', 'LITRES ' + p.litres, 'TOTAL $' + p.cost,
    p.price ? 'PRICE ' + p.price : '', p.time ? 'TIME ' + p.time : ''].join('\n');
}

(async function () {
  let unhandled = 0;
  process.on('unhandledRejection', function () { unhandled++; });

  /* ===== PHASES 0–3: the Part A evening, replayed ===== */
  {
    console.log('\n== PHASE 0–3 — restore + graft, the Part A sequence, reload, fresh-profile heal ==');
    const shape = 'legacy-notime';
    /* the book as the device holds it at the start of the pass:
       the nine baseline photos local at their stored sizes, the
       account docs holding the same photos (seedCloud), the
       origin at the wall (the round-3 pin) */
    const restored = seedBook(shape);
    const filler = calibrateFiller(restored, 5000);
    const ls = makeLocalStorage(restored, filler);
    const cloud = seedCloud(shape);
    const trace = [];
    const registry = makePixelRegistry();
    console.log('  headroom at the start of the pass: ' + Math.round(ls._headroom() / 2) + ' chars');

    /* PHASE 0 — Fuel open #1: state check (nothing photo-less
       among the baselines; the graft has nothing to do yet) */
    const w0 = makeWorld(ls, cloud, trace, { pixelRegistry: registry });
    w0.api.render(w0.body);
    await flush(30);
    const landed0 = BASELINE_PHOTOS.filter(function (pd) { return !!byDate(w0.fills(), pd[0]).photo; }).length;
    console.log('  baseline photos present locally: ' + landed0 + ' of 9; headroom now ' + Math.round(ls._headroom() / 2) + ' chars');
    ok('P0 the book opens with its nine baseline photos in place', landed0 === 9, landed0 + '/9');

    /* PHASE 1 — the Part A sequence */
    const outcomes = {};
    for (const p of PARTA) {
      outcomes[p.date] = await attachFlow(w0, p.date, p.profile, ocrFor(p));
      const key = docKey(byDate(w0.fills(), p.date));
      outcomes[p.date].doc = !!(cloud.docs[key] && cloud.docs[key].photo);
      console.log('  attach ' + p.date + ': landed=' + outcomes[p.date].landed + ' size=' + outcomes[p.date].size +
        ' didntFitNote=' + outcomes[p.date].noteDidntFit + ' doc=' + outcomes[p.date].doc);
    }
    const o10 = await attachFlow(w0, '2026-10-10', 'oct10', 'PREAUTH — terminal copy, figures illegible');
    const oct10AfterSave = byDate(w0.fills(), '2026-10-10');
    const oct10Key = docKey(oct10Record(shape));
    console.log('  attach 2026-10-10: landed=' + o10.landed + ' size=' + o10.size + ' didntFitNote=' + o10.noteDidntFit);
    console.log('  Oct 10 doc in the account: ' + (cloud.docs[oct10Key] ? 'YES key=' + oct10Key + ' photo=' + (cloud.docs[oct10Key].photo || '').length + ' chars' : 'NO (key ' + oct10Key + ')'));
    console.log('  phantom (zero-free) book writes so far: ' + w0.stats.phantomWrites + '; real shrink events: ' +
      w0.stats.shrinkEvents.filter(function (e) { return e.freed > 0 && !e.LOST; }).length);
    if (SHOW_TRACE) dumpTrace(trace, 'phases 0–1');

    ok('P1a Oct 1–8 all landed during the pass', PARTA.every(function (p) { return outcomes[p.date].landed; }),
      PARTA.filter(function (p) { return !outcomes[p.date].landed; }).map(function (p) { return p.date; }).join(','));
    ok('P1b Oct 10\'s per-record doc WAS written, with the full storage rendition',
      !!cloud.docs[oct10Key] && (cloud.docs[oct10Key].photo || '').length === FILE_PROFILES.oct10[1280],
      cloud.docs[oct10Key] ? 'doc photo=' + (cloud.docs[oct10Key].photo || '').length : 'no doc under ' + oct10Key);
    ok('P1c Oct 10\'s photo LANDS on the device during its own save flow', o10.landed === true, 'size=' + o10.size);
    ok('P1d Oct 10 figures exact after the save', oct10AfterSave.litres === '105.977' && String(oct10AfterSave.cost) === '250' && !oct10AfterSave.odo,
      JSON.stringify({ l: oct10AfterSave.litres, c: oct10AfterSave.cost, o: oct10AfterSave.odo }));
    eq('P1e the book still holds all 62 fills', w0.fills().length, 62);

    /* PHASE 2 — full reload, same profile: the graft runs again */
    const w1 = makeWorld(ls, cloud, trace, { pixelRegistry: registry });
    w1.api.render(w1.body);
    await flush(90);
    const oct10AfterReload = byDate(w1.fills(), '2026-10-10');
    ok('P2 after reload Oct 10 still holds its photo', typeof oct10AfterReload.photo === 'string' && oct10AfterReload.photo.length > 0,
      'photo is ' + (oct10AfterReload.photo === undefined ? 'ABSENT' : typeof oct10AfterReload.photo));
    const idx2 = w1.fills().findIndex(function (r) { return r.date === '2026-10-10'; });
    w1.body.querySelectorAll('[data-fuedit]')[idx2].onclick();
    await flush(4);
    ok('P2b the details page no longer says "No photo for this entry"', w1.body.innerHTML.indexOf('No photo') < 0);

    /* PHASE 3 — fresh profile WITH headroom: docs alone must heal */
    const ls3 = makeLocalStorage(shedCopy(w1.fills()), 0);
    const w3 = makeWorld(ls3, cloud, [], { pixelRegistry: registry });
    w3.api.render(w3.body);
    await flush(90);
    const oct10Healed = byDate(w3.fills(), '2026-10-10');
    const oct2Healed = byDate(w3.fills(), '2026-10-02');
    ok('P3a with room, Oct 10 heals from its account doc (which still holds the FULL storage rendition)',
      typeof oct10Healed.photo === 'string' && oct10Healed.photo.length > 0 &&
      (cloud.docs[oct10Key].photo || '').length === FILE_PROFILES.oct10[1280],
      'local photo=' + (oct10Healed.photo ? oct10Healed.photo.length : 'ABSENT') +
      '; doc photo=' + ((cloud.docs[oct10Key] || {}).photo || '').length);
    ok('P3b with room, the "didn\'t fit" control Oct 2 also heals from its doc alone (graft-based persistence)',
      typeof oct2Healed.photo === 'string' && oct2Healed.photo.length > 0,
      'photo=' + (oct2Healed.photo ? oct2Healed.photo.length : 'ABSENT'));
    ok('P3c no photo was lost anywhere in the evening (every baseline + Part A photo still on some copy)',
      BASELINE_PHOTOS.every(function (pd) { return !!byDate(w1.fills(), pd[0]).photo || !!(cloud.docs[docKey(byDate(w1.fills(), pd[0]))] || {}).photo; }) &&
      PARTA.every(function (p) { return !!byDate(w1.fills(), p.date).photo; }));
  }

  /* ===== PHASE 4: the spent book, swept over Oct 10's record shapes ===== */
  for (const shape of ['id-time', 'id-notime', 'legacy-time', 'legacy-notime', 'numeric']) {
    console.log('\n== PHASE 4 (' + shape + ') — every stored photo already at/under 960px, origin at the wall ==');
    const trace = [];
    const registry = makePixelRegistry();
    /* a book whose photos are ALL ladder-era sizes: the nine
       baselines at 960, Nov 7 at 640, seven Part A photos at
       960/640 — the state Part A left behind */
    const book = seedBook(shape);
    book.forEach(function (r) {
      if (r.date === '2026-11-07') return; /* already 640 */
      const pd = BASELINE_PHOTOS.filter(function (x) { return x[0] === r.date; })[0];
      if (pd) r.photo = photoStr('SEED' + BASELINE_PHOTOS.indexOf(pd), FILE_PROFILES.base[960]);
    });
    PARTA.forEach(function (p, i) {
      const r = byDate(book, p.date);
      r.photo = photoStr('PA' + i, FILE_PROFILES[p.profile][i % 2 ? 640 : 960]);
      registry['PA' + i] = { sizes: FILE_PROFILES[p.profile], w: i % 2 ? 640 : 960, h: i % 2 ? 480 : 720 };
    });
    const cloud = seedCloud(shape); /* baseline + Nov 7 docs */
    /* the Part A docs exist too (each Part A save wrote one) */
    PARTA.forEach(function (p) {
      const r = byDate(book, p.date);
      const d = {}; for (const k in r) d[k] = r[k];
      delete d.photo;
      d.photo = photoStr('PADOC' + PARTA.indexOf(p), FILE_PROFILES[p.profile][1280]);
      registry['PADOC' + PARTA.indexOf(p)] = { sizes: FILE_PROFILES[p.profile], w: 1280, h: 960 };
      cloud.docs[docKey(r)] = d;
    });
    /* the baselines' local copies are 960px renditions in this
       phase — their pixel dims say so */
    BASELINE_PHOTOS.forEach(function (pd, i) { registry['SEED' + i] = { sizes: FILE_PROFILES.base, w: 960, h: 720 }; });
    /* Oct 10's doc: written by its (failed) saves, full rendition */
    const o10 = oct10Record(shape);
    const o10doc = {}; for (const k in o10) o10doc[k] = o10[k];
    o10doc.photo = photoStr('O10DOC', FILE_PROFILES.oct10[1280]);
    registry['O10DOC'] = { sizes: FILE_PROFILES.oct10, w: 1280, h: 960 };
    cloud.docs[docKey(o10)] = o10doc;
    cloud.kvBook = shedCopy(book);
    const filler = calibrateFiller(book, 5000);
    const ls = makeLocalStorage(book, filler);
    console.log('  headroom at start: ' + Math.round(ls._headroom() / 2) + ' chars; Oct 10 doc key: ' + docKey(o10));
    const w = makeWorld(ls, cloud, trace, { pixelRegistry: registry });
    w.api.render(w.body);
    await flush(90);
    const rec = byDate(w.fills(), '2026-10-10');
    const realShrinks = w.stats.shrinkEvents.filter(function (e) { return e.freed > 0 && !e.LOST; });
    console.log('  graft outcome: Oct 10 photo=' + (rec.photo ? rec.photo.length + ' chars' : 'ABSENT') +
      '; phantom writes=' + w.stats.phantomWrites + '; real shrinks=' + realShrinks.length +
      realShrinks.slice(0, 3).map(function (e) { return ' [' + e.date + ' ' + e.from + '->' + e.to + ']'; }).join(''));
    w.stats.oct10Log.forEach(function (e) {
      console.log('    Oct 10 write ' + (e.ok ? 'LANDED' : 'REFUSED') + ': ' + e.from + ' -> ' + e.to + ' via ' + e.via);
    });
    if (SHOW_TRACE) dumpTrace(trace, 'phase 4 ' + shape);
    ok('P4-' + shape + 'a Oct 10\'s photo LANDS in the spent book (the reclaim frees real room)',
      typeof rec.photo === 'string' && rec.photo.length > 0, 'photo is ' + (rec.photo === undefined ? 'ABSENT' : typeof rec.photo));
    ok('P4-' + shape + 'b no stored photo was lost to make the room',
      !w.stats.shrinkEvents.some(function (e) { return e.LOST; }) &&
      book.every(function (r) { return !r.photo || !!byDate(w.fills(), r.date).photo; }));
    ok('P4-' + shape + 'c every shrunk neighbour keeps its FULL copy in its account doc',
      realShrinks.every(function (e) {
        const r = byDate(w.fills(), e.date);
        const d = cloud.docs[docKey(r)];
        return !!d && (d.photo || '').length >= e.from;
      }));
    eq('P4-' + shape + 'd the book still holds all 62 fills', w.fills().length, 62);
  }

  /* ===== PHASE 4b: the spent book with the once-a-day scan
     pre-latched — is the scan's duplicate graft a co-cause? ===== */
  {
    console.log('\n== PHASE 4b — spent book, scan latch pre-set (single graft path only) ==');
    const shape = 'legacy-notime';
    const trace = [];
    const registry = makePixelRegistry();
    const book = seedBook(shape);
    book.forEach(function (r) {
      const pd = BASELINE_PHOTOS.filter(function (x) { return x[0] === r.date; })[0];
      if (pd) r.photo = photoStr('SEED' + BASELINE_PHOTOS.indexOf(pd), FILE_PROFILES.base[960]);
    });
    PARTA.forEach(function (p, i) {
      const r = byDate(book, p.date);
      r.photo = photoStr('PA' + i, FILE_PROFILES[p.profile][i % 2 ? 640 : 960]);
      registry['PA' + i] = { sizes: FILE_PROFILES[p.profile], w: i % 2 ? 640 : 960, h: i % 2 ? 480 : 720 };
    });
    BASELINE_PHOTOS.forEach(function (pd, i) { registry['SEED' + i] = { sizes: FILE_PROFILES.base, w: 960, h: 720 }; });
    const cloud = seedCloud(shape);
    PARTA.forEach(function (p) {
      const r = byDate(book, p.date);
      const d = {}; for (const k in r) d[k] = r[k];
      delete d.photo;
      d.photo = photoStr('PADOC' + PARTA.indexOf(p), FILE_PROFILES[p.profile][1280]);
      registry['PADOC' + PARTA.indexOf(p)] = { sizes: FILE_PROFILES[p.profile], w: 1280, h: 960 };
      cloud.docs[docKey(r)] = d;
    });
    const o10 = oct10Record(shape);
    const o10doc = {}; for (const k in o10) o10doc[k] = o10[k];
    o10doc.photo = photoStr('O10DOC', FILE_PROFILES.oct10[1280]);
    registry['O10DOC'] = { sizes: FILE_PROFILES.oct10, w: 1280, h: 960 };
    cloud.docs[docKey(o10)] = o10doc;
    cloud.kvBook = shedCopy(book);
    const filler = calibrateFiller(book, 5000);
    const ls = makeLocalStorage(book, filler);
    ls._data['mt___fuel_photo_scan'] = String(Date.now()); /* the scan already ran today */
    const w = makeWorld(ls, cloud, trace, { pixelRegistry: registry });
    w.api.render(w.body);
    await flush(90);
    const rec = byDate(w.fills(), '2026-10-10');
    console.log('  graft outcome (scan latched): Oct 10 photo=' + (rec.photo ? rec.photo.length + ' chars' : 'ABSENT') +
      '; phantom writes=' + w.stats.phantomWrites);
    w.stats.oct10Log.forEach(function (e) {
      console.log('    Oct 10 write ' + (e.ok ? 'LANDED' : 'REFUSED') + ': ' + e.from + ' -> ' + e.to + ' via ' + e.via);
    });
    ok('P4b with the scan latched, Oct 10\'s photo still LANDS in the spent book',
      typeof rec.photo === 'string' && rec.photo.length > 0, 'photo is ' + (rec.photo === undefined ? 'ABSENT' : typeof rec.photo));
  }

  console.log('\nunhandled rejections observed (saveFillPhotoDoc has no .catch — round 3 note): ' + unhandled);
  console.log('\nfuel-photo-save-drop-v373 (ROUND 4) test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR ' + (e && e.stack || e)); process.exit(1); });
