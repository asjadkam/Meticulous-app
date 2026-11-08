#!/usr/bin/env node
/*
 * fuel-photo-graft-wall-v371-test.js — FUEL-PHOTO-SAVE-DROP-NOV7
 * ROUND 2 (owner evidence, Nov 7, 2026, live web app as
 * asjadkamal482, AFTER the web 370 fix shipped):
 *
 * The survival test re-attached the Nov 7 Shell receipt through
 * Edit on the live app — preview correct, Save, "All synced" —
 * and after a FULL reload the entry again showed "No photo for
 * this entry". Figures and count unchanged.
 *
 * What round 1 never modelled: its quota was calibrated so the
 * book + the 1280px storage rendition FITS — every case landed
 * the photo in the local book at save time (Case A). The wall
 * case (Case B) — the book + even the storage rendition does
 * NOT fit — was covered only by the fix's stated residual
 * limit: the photo survives in the per-record cloud document
 * and "grafts back wherever there is room".
 *
 * This suite models Case B end to end, with the quota set so
 * the book + the full storage rendition NEVER fits but a
 * reduced rendition (the ladder's 640px rung) DOES:
 *   phase 1: EDIT attach at the wall — the verified save sheds
 *            (facts land, photo-less), the per-record doc is
 *            written WITH the photo (the web 370 guarantee).
 *   phase 2: RELOAD (fresh module state) + the v350 graft with
 *            the doc in the cloud and the shed book copy as the
 *            only other source. THE QUESTION: does the entry
 *            SHOW its photo afterwards, on this device?
 *   phase 3: the no-doc control — nothing anywhere to heal
 *            with; the record must stay photo-less (nothing is
 *            invented).
 *   phase 4: ADD at the wall — same question at save time.
 *   phase 5: the CloudSync pull round-trip (the v241 world)
 *            over the phase-2 book — a shed cloud twin must
 *            not strip whatever photo the graft landed.
 *
 * Pre-fix expectation (the reproduction): phases 1's doc
 * guarantee holds, but phase 2's record is STILL photo-less
 * after the graft — graftInto persists through the same
 * verified save that shed at edit time, the save refuses the
 * book+photo again, and graftInto deletes the grafted photo
 * from its working copy and gives up for the session. The
 * photo is in the account and invisible on the device that
 * took it, forever, at this book size. Phase 4's record is
 * likewise photo-less until a graft could land (and the graft
 * cannot land either, same wall).
 *
 * THE FIX (web 371): a photo-fit ladder. When a verified save
 * (a save fallback, or the graft) cannot fit the photo's
 * storage rendition beside the book, the SAME photo is
 * re-encoded at descending sizes (TicketOCR.shrinkDataUrl:
 * 960px, then 640px) and the save retried per rung — the
 * record keeps a readable copy ON THIS DEVICE, while the
 * per-record cloud document keeps the full storage rendition
 * untouched. Nothing else changes: the v289 shed law, the
 * dedupe law, OCR autofill, and the v349/v350/v354
 * protections are all exactly as they were.
 *
 * Run: node tools/fuel-photo-graft-wall-v371-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const fuelSrc = read('modules/fuel.js');
const ocrSrc = read('js/ticket-ocr.js');
const csSrc = read('js/cloudsync.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function short(v) { const s = JSON.stringify(v); return s && s.length > 120 ? s.slice(0, 117) + '…' : s; }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + short(got) + ', want ' + short(want)); }

const tick = () => new Promise(function (r) { setTimeout(r, 25); });
async function flush(n) { for (let i = 0; i < (n || 10); i++) await tick(); }

/* ---------- shared shapes (the round-1 suite's) ---------- */
const PHOTO_SEED = 'data:image/jpeg;base64,' + 'P'.repeat(200000);
const OCR_URL = 'data:image/jpeg;base64,' + 'O'.repeat(260000);
const STORE_URL = 'data:image/jpeg;base64,' + 'S'.repeat(130000);
const RECEIPT_TEXT = ['Shell Canada', '#110 - 5305 Country Hills Blvd NE', 'Diesel', 'LITRES 115.262',
  'PRICE/L $2.169', 'TOTAL FUEL $250.00', '11/07/2026 18:00:12'].join('\n');
/* the ladder stub: a rendition of a url at max px, modelled at
   the storage rendition's own scale (area ~ (max/1280)^2) */
function shrunk(url, max) {
  return 'data:image/jpeg;base64,' + 's'.repeat(Math.round(url.length * (max / 1280) * (max / 1280)));
}
const RUNG_640 = shrunk(STORE_URL, 640);

function seedBook(withNov7) {
  const photoDates = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-19', '2026-10-22', '2026-11-04', '2026-11-05'];
  const fills = [];
  let n = 0;
  for (let t = Date.UTC(2026, 5, 25); fills.length < 52 && t < Date.UTC(2026, 10, 6); t += 2 * 86400000) {
    const ds = new Date(t).toISOString().slice(0, 10);
    if (photoDates.indexOf(ds) >= 0) continue;
    n++;
    fills.push({ date: ds, litres: (80 + n).toFixed(3), cost: (150 + n).toFixed(2), station: 'Mobil', odo: 160000 + n * 137 });
  }
  photoDates.forEach(function (ds, i) {
    fills.push({ date: ds, litres: (83 + i).toFixed(3), cost: (190 + i).toFixed(2), station: i % 2 ? 'Petro-Canada' : 'Mobil', odo: 168000 + i * 211, photo: PHOTO_SEED });
  });
  fills.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  if (withNov7) fills.push({ id: 'fuNov7seed', date: '2026-11-07', time: '18:00', litres: '115.262', cost: '250.00', station: 'Shell', odo: 171868, updAt: 1000 });
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

/* ---------- the world: quota-faithful store + a cloud that persists ---------- */
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

/* raw + cloud are SHARED across worlds: a "reload" is a fresh
   module instance over the same store and the same account. */
function makeWorld(raw, cloud, quota) {
  function totalWith(k, v) {
    let t = 0;
    for (const key in raw) t += key.length + (key === k ? v.length : raw[key].length);
    if (!(k in raw)) t += k.length + v.length;
    return t;
  }
  const store = {
    get: function (k, d) { return (k in raw) ? JSON.parse(raw[k]) : d; },
    set: function (k, v) {
      const s = JSON.stringify(v);
      if (totalWith(k, s) > quota) return false;
      raw[k] = s; return true;
    },
    del: function (k) { delete raw[k]; return true; }
  };
  const els = {};
  const body = makeEl();
  body.querySelector = function (sel) { if (!els[sel]) els[sel] = makeEl(); return els[sel]; };
  let rowElsCache = null;
  body.querySelectorAll = function (sel) {
    if (sel === '[data-fuedit]') {
      /* cached: the module binds its row handlers onto the very
         instances it is handed (the round-1 world's rule) */
      if (!rowElsCache) {
        rowElsCache = JSON.parse(raw['fuel_fills']).map(function (r, i) { const e = makeEl(); e.setAttribute('data-fuedit', String(i)); return e; });
      }
      return rowElsCache;
    }
    if (sel === '[data-fxphoto]') return [];
    return [];
  };
  function FakeFileReader() {}
  FakeFileReader.prototype.readAsDataURL = function (file) {
    const self = this; self.result = 'data:raw-' + file.__tag;
    setTimeout(function () { if (self.onload) self.onload(); }, 0);
  };
  const sb = {
    console: console, Date: Date, Math: Math, JSON: JSON, Promise: Promise, setTimeout: setTimeout,
    FileReader: FakeFileReader,
    App: {
      _store: store,
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
        if (col === 'fuel') cloud.docs[id] = JSON.parse(JSON.stringify(doc));
        cloud.writes.push({ col: col, id: id });
        return Promise.resolve({});
      },
      loadDoc: function (col, id) {
        if (col === 'fuel' && cloud.docs[id]) {
          const d = JSON.parse(JSON.stringify(cloud.docs[id])); d.id = id; /* FB merges the doc id in */
          return Promise.resolve(d);
        }
        if (col === 'kv' && id === 'fuel_fills' && cloud.kvBook) return Promise.resolve({ v: JSON.parse(JSON.stringify(cloud.kvBook)) });
        if (col === 'kv' && id === 'fuel_expenses') return Promise.resolve({ v: JSON.parse(JSON.stringify(EXPENSES)) });
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
      fileToOCRImage: function (file, cb) { cb(OCR_URL); },
      fileToStorageImage: function (file, cb) { cb(STORE_URL); },
      shrinkDataUrl: function (url, max, cb) { cb(shrunk(url, max)); },
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
  vm.runInContext(fuelSrc, sb, { filename: 'modules/fuel.js' });
  return { api: sb.Meticulous.modules.fuel, body: body, els: els,
    fills: function () { return JSON.parse(raw['fuel_fills']); } };
}

function freshRaw(withNov7) {
  const raw = {};
  raw['fuel_fills'] = JSON.stringify(seedBook(withNov7));
  raw['fuel_expenses'] = JSON.stringify(EXPENSES);
  raw['onboarding'] = JSON.stringify({ payStandard: 'Hourly', ownWageRate: 29, travelBonus: 0 });
  raw['tracker'] = JSON.stringify({ status: 'idle' });
  raw['__origin_filler'] = JSON.stringify('F'.repeat(5000000));
  return raw;
}
function baseTotalOf(raw) {
  let t = 0; for (const k in raw) t += k.length + raw[k].length; return t;
}
/* THE WALL: headroom for the 640px rung beside the book, never
   for the 960px rung or the full storage rendition */
function wallQuota(raw) { return baseTotalOf(raw) + RUNG_640.length + 12000; }

function nov7(fills) { return fills.filter(function (r) { return r.date === '2026-11-07'; })[0] || {}; }

(async function () {
  /* ===== phases 1+2: edit at the wall, reload, graft ===== */
  {
    const raw = freshRaw(true);
    const quota = wallQuota(raw);
    const cloud = { docs: {}, kvBook: null, writes: [] };

    /* ---- phase 1: the edit attach, at the wall ---- */
    const w1 = makeWorld(raw, cloud, quota);
    w1.api.render(w1.body);
    await flush();
    const idx = w1.fills().findIndex(function (r) { return r.date === '2026-11-07'; });
    w1.body.querySelectorAll('[data-fuedit]')[idx].onclick();
    await flush(4);
    ok('P1 details open on the photo-less entry', w1.body.innerHTML.indexOf('No photo for this entry') >= 0);
    w1.els['#fu_det_edit'].onclick();
    await flush(4);
    w1.els['#fu_img'].files = [{ __tag: 'r1' }];
    w1.els['#fu_img'].onchange({ target: w1.els['#fu_img'] });
    await flush();
    w1.els['#fu_add'].onclick();
    await flush();
    let rec = nov7(w1.fills());
    eq('P1 figures exact after the edit save', String(rec.litres) + '|' + String(rec.cost) + '|' + rec.odo, '115.262|250|171868');
    /* pre-fix, this is where the record stood photo-less (the
       shed) until the phase-2 graft failed on the same wall;
       post-fix the save's own fit ladder has already landed the
       reduced copy by the time the save settles — what must
       NEVER appear locally is the full storage rendition: its
       absence is what proves the wall (and the shed) was real */
    ok('P1 at the wall the FULL storage rendition never lands locally (the shed is real)',
      rec.photo !== STORE_URL, 'photo is the full storage rendition — the wall was not modelled');
    eq('P1 the save-side ladder lands the reduced copy in the same session', rec.photo, RUNG_640);
    ok('P1 the smaller-size note was said out loud', w1.body.innerHTML.indexOf('smaller size') >= 0);
    const doc = cloud.docs['fillid_fuNov7seed'];
    ok('P1 the per-record cloud doc CARRIES the full storage rendition (web 370 guarantee)',
      !!doc && doc.photo === STORE_URL, doc ? 'doc photo ' + (doc.photo ? doc.photo.length + ' chars' : 'absent') : 'no doc written');

    /* the push lands: the cloud book copy is the v289 shed copy */
    cloud.kvBook = shedCopy(w1.fills());

    /* ---- phase 2: full reload, then open Fuel (the graft) ---- */
    const w2 = makeWorld(raw, cloud, quota);
    w2.api.render(w2.body);
    await flush(16);
    rec = nov7(w2.fills());
    ok('P2 AFTER RELOAD + GRAFT the entry HOLDS a photo on this device',
      typeof rec.photo === 'string' && rec.photo.length > 0,
      'photo is ' + (rec.photo === undefined ? 'ABSENT — the graft hit the same wall (the survival-test failure)' : typeof rec.photo));
    if (rec.photo) {
      ok('P2 the on-device copy is a REDUCED rendition (the full one would not fit)',
        rec.photo.length < STORE_URL.length, rec.photo.length + ' chars vs storage ' + STORE_URL.length);
      eq('P2 the on-device copy is the ladder rung that fits', rec.photo, RUNG_640);
    }
    ok('P2 the cloud doc still holds the FULL storage rendition (never downgraded)',
      !!cloud.docs['fillid_fuNov7seed'] && cloud.docs['fillid_fuNov7seed'].photo === STORE_URL);
    const idx2 = w2.fills().findIndex(function (r) { return r.date === '2026-11-07'; });
    w2.body.querySelectorAll('[data-fuedit]')[idx2].onclick();
    await flush(4);
    ok('P2 the details page no longer says "No photo for this entry"',
      w2.body.innerHTML.indexOf('No photo for this entry') === -1);
    eq('P2 figures still exact after the graft', String(rec.litres) + '|' + String(rec.cost) + '|' + rec.odo, '115.262|250|171868');
    eq('P2 the book still holds all 62 fills', w2.fills().length, 62);

    /* ---- phase 5: the pull round-trip cannot strip it ---- */
    {
      const book = w2.fills();
      const cloudBook = shedCopy(book);
      const data = {};
      const localStorage = {
        getItem: function (k) { return (k in data) ? data[k] : null; },
        setItem: function (k, v) { data[k] = String(v); },
        removeItem: function (k) { delete data[k]; },
        key: function (i) { return Object.keys(data)[i] || null; },
        get length() { return Object.keys(data).length; }
      };
      data['mt_fuel_fills'] = JSON.stringify(book);
      data['mt___syncmeta'] = JSON.stringify({ uid: 'u1', keys: { fuel_fills: { t: 1000, s: 1000, u: 'u1' } } });
      const sb = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, Promise: Promise };
      sb.window = sb; sb.localStorage = localStorage;
      sb.navigator = { onLine: true };
      sb.document = { getElementById: function () { return null; }, addEventListener: function () {} };
      sb.addEventListener = function () {};
      sb.FB = {
        ready: true, user: { uid: 'u1' },
        loadDocs: function () { return Promise.resolve([{ id: 'fuel_fills', v: cloudBook, updatedAt: 2000 }]); },
        saveDoc: function () { return Promise.resolve({}); },
        deleteDoc: function () { return Promise.resolve({}); }
      };
      vm.createContext(sb);
      vm.runInContext(csSrc, sb);
      const store = {
        get: function (k, d) { const r = localStorage.getItem('mt_' + k); return r === null ? d : JSON.parse(r); },
        set: function (k, v) { localStorage.setItem('mt_' + k, JSON.stringify(v)); return true; },
        del: function (k) { localStorage.removeItem('mt_' + k); return true; }
      };
      sb.CloudSync.attach(store);
      sb.CloudSync.onAuth({ uid: 'u1' });
      await new Promise(function (r) { setTimeout(r, 500); });
      const after = JSON.parse(data['mt_fuel_fills']);
      const recAfter = nov7(after);
      ok('P5 the shed cloud twin did NOT strip the grafted photo on the pull round-trip',
        recAfter.photo === rec.photo, 'photo is ' + (recAfter.photo === undefined ? 'ABSENT' : 'changed'));
    }
  }

  /* ===== phase 3: the no-doc control ===== */
  {
    const raw = freshRaw(true);
    const quota = wallQuota(raw);
    const cloud = { docs: {}, kvBook: shedCopy(seedBook(true)), writes: [] };
    const w = makeWorld(raw, cloud, quota);
    w.api.render(w.body);
    await flush(16);
    const rec = nov7(w.fills());
    ok('P3 with no photo anywhere reachable, the entry stays photo-less (nothing invented)',
      rec.photo === undefined);
  }

  /* ===== phase 4: the ADD at the wall ===== */
  {
    const raw = freshRaw(false);
    const quota = wallQuota(raw);
    const cloud = { docs: {}, kvBook: null, writes: [] };
    const w = makeWorld(raw, cloud, quota);
    w.api.render(w.body);
    await flush();
    w.els['#fu_img'].files = [{ __tag: 'r1' }];
    w.els['#fu_img'].onchange({ target: w.els['#fu_img'] });
    await flush();
    eq('P4 OCR filled the litres from the receipt', w.els['#fu_l'].value, '115.262');
    w.els['#fu_odo'].value = '171868';
    w.els['#fu_add'].onclick();
    await flush(16);
    const rec = nov7(w.fills());
    eq('P4 the book grew to 62 fills', w.fills().length, 62);
    ok('P4 AFTER THE ADD SAVE the entry HOLDS a photo on this device',
      typeof rec.photo === 'string' && rec.photo.length > 0,
      'photo is ' + (rec.photo === undefined ? 'ABSENT — shed at save, and no graft can run again this session' : typeof rec.photo));
    if (rec.photo) eq('P4 the on-device copy is the ladder rung that fits', rec.photo, RUNG_640);
    const doc = rec.id && cloud.docs['fillid_' + rec.id];
    ok('P4 the per-record doc carries the FULL storage rendition', !!doc && doc.photo === STORE_URL);
  }

  /* ===== pins ===== */
  ok('pin: ticket-ocr exports the data-URL shrinker',
    ocrSrc.indexOf('TicketOCR.shrinkDataUrl = function') >= 0);
  ok('pin: fuel retries the photo at smaller sizes when the book cannot hold it',
    fuelSrc.indexOf('photoFitLadder') >= 0 && fuelSrc.indexOf('PHOTO_FIT_RUNGS') >= 0);
  ok('pin: the graft lands through the same fit ladder',
    fuelSrc.indexOf('photoFitLadder') >= 0);

  console.log('\nfuel-photo-graft-wall-v371 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR ' + (e && e.stack || e)); process.exit(1); });
