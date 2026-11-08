#!/usr/bin/env node
/*
 * fuel-photo-save-drop-v370-test.js — FUEL-PHOTO-SAVE-DROP-NOV7
 * (owner evidence, Nov 7, 2026, live web app as asjadkamal482,
 * verified twice in one evening):
 *
 * A NEW fill (2026-11-07, Shell, 115.262 L / $250.00 / odo
 * 171,868) was filed through the Add form with the receipt
 * photo attached — the form PREVIEW showed the receipt and the
 * OCR read it ("115.262 L · $250 · @ 2.169/L") — Save succeeded,
 * figures exact, book 64 -> 65 records — but the saved entry
 * shows "No photo for this entry", immediately AND after a full
 * reload / re-sync. A re-attach through Edit (same image, plus
 * a dashboard photo in the odometer slot, a 30 s OCR-settle
 * wait, Save, "All synced") failed identically. Nine older
 * entries (Oct 13 – Nov 5) hold photos that DO open.
 *
 * CONVICTED MECHANISM (traced in modules/fuel.js + js/app.js +
 * js/cloudsync.js): the photo is dropped at the LOCAL verified
 * save, by design's own fallback, and then lost everywhere:
 *  - fuPhoto is the 1600px OCR rendition (v127) — the largest
 *    rendition any module stores (Dispatch stores 640px; the
 *    v39 split says the 1600px copy is "purely for OCR;
 *    callers keep/store their own smaller copy").
 *  - The record rides inside ONE localStorage value
 *    (mt_fuel_fills) holding the whole book. store.set catches
 *    a quota throw and returns false (js/app.js v48); the
 *    v48/v127 verified save reads back, sees the mismatch,
 *    DELETES the photo and retries photo-less — the entry
 *    always saves, the photo is kept only when it fits.
 *  - The per-record cloud document (the v350 graft's source,
 *    the photo's only other home) is then written from the
 *    ALREADY-SHED record — fillPhotos(rec) is empty, so
 *    saveFillPhotoDoc is a no-op. The photo exists nowhere:
 *    not in the record, not in the doc, not in the (over-cap,
 *    photo-shed) cloud book copy. No graft can ever heal it.
 *  - The 9 survivors were saved when the store had room (or
 *    on the phone); every NEW photo now meets the wall the
 *    accumulated book built. The sync merge is NOT the thief:
 *    completeness scores a photo +3/+4 and the dedupe union
 *    keeps photos — case B1 below proves a shed cloud twin
 *    cannot strip a photo'd local record.
 * Ruled out: (a) fuPhoto IS assigned in the same callback that
 * produced the OCR read the filing saw; (c) fileToOCRImage
 * always emits a <=1600px JPEG whatever the source format;
 * (e) the odometer handler keeps its own token/state and never
 * touches fuPhoto.
 *
 * THE FIX (modules/fuel.js + one export in js/ticket-ocr.js):
 *  - TicketOCR.fileToStorageImage: a 1280px storage rendition.
 *    The capture handlers now keep the STORAGE rendition for
 *    the record (the 1600px rendition still feeds OCR and the
 *    power read, untouched); worlds without the helper fall
 *    back to the OCR rendition exactly as before.
 *  - The save paths (fill add, fill edit, expense add) capture
 *    the photo stack BEFORE any fallback shed and write the
 *    per-record photo document from a copy that still carries
 *    it — the photo always lands in its account document even
 *    when this device's store cannot hold it in the book, so
 *    the v350 graft can re-attach it wherever there is room.
 *  - The didn't-fit notes now say the photo is kept in the
 *    account copy (true after this fix), not that it is lost.
 *
 * Harness: the v332 stubbed-DOM world (the real modules/fuel.js)
 * with a store that models localStorage FAITHFULLY — values are
 * serialized strings, reads are fresh parses, and set() refuses
 * (returns false, writes nothing) when the resulting origin
 * total would cross the quota, exactly App._store.set's catch
 * path — plus the v241 CloudSync world for the round-trip case.
 * The quota is CALIBRATED from the seeded sizes at runtime:
 * room for the book + a storage-rendition photo + slack, never
 * room for the book + a 1600px-rendition photo.
 *
 * Run: node tools/fuel-photo-save-drop-v370-test.js
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

/* ---------- shared shapes ---------- */
const PHOTO_SEED = 'data:image/jpeg;base64,' + 'P'.repeat(200000);   // a survivor's stored photo
const OCR_URL = 'data:image/jpeg;base64,' + 'O'.repeat(260000);      // the 1600px OCR rendition of the Nov 7 receipt
const STORE_URL = 'data:image/jpeg;base64,' + 'S'.repeat(130000);    // its 1280px storage rendition
const OCR_URL2 = 'data:image/jpeg;base64,' + 'Q'.repeat(240000);     // a second receipt (stack case)
const STORE_URL2 = 'data:image/jpeg;base64,' + 'T'.repeat(120000);
const RECEIPT_TEXT = ['Shell Canada', '#110 - 5305 Country Hills Blvd NE', 'Diesel', 'LITRES 115.262',
  'PRICE/L $2.169', 'TOTAL FUEL $250.00', '11/07/2026 18:00:12'].join('\n');
const RECEIPT2_TEXT = ['Shell Canada', 'Diesel', 'LITRES 10.000', 'PRICE/L $2.169', 'TOTAL FUEL $21.69', '11/07/2026 18:20:00'].join('\n');

function seedBook(withNov7) {
  /* The audited book: 61 fills + 3 expenses = 64 records. Nine
     fills carry photos (Oct 13 - Nov 5) — those dates are seeded
     explicitly; the other 52 fills take distinct days Jun-Oct. */
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

/* ---------- World A: the fuel form over a quota-faithful store ---------- */
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

function makeFuelWorld(opts) {
  /* raw localStorage model: key -> serialized string */
  const raw = {};
  raw['fuel_fills'] = JSON.stringify(opts.fills);
  raw['fuel_expenses'] = JSON.stringify(EXPENSES);
  raw['onboarding'] = JSON.stringify({ payStandard: 'Hourly', ownWageRate: 29, travelBonus: 0 });
  raw['tracker'] = JSON.stringify({ status: 'idle' });
  raw['__origin_filler'] = JSON.stringify('F'.repeat(opts.fillerLen)); // sessions/telemetry/other books
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
      if (totalWith(k, s) > opts.quota) return false; /* localStorage QuotaExceededError, caught by App._store.set */
      raw[k] = s; return true;
    },
    del: function (k) { delete raw[k]; return true; }
  };
  const baseTotal = totalWith('__none__', '');
  const els = {};
  const body = makeEl();
  body.querySelector = function (sel) { if (!els[sel]) els[sel] = makeEl(); return els[sel]; };
  const rowEls = opts.fills.map(function (r, i) { const e = makeEl(); e.setAttribute('data-fuedit', String(i)); return e; });
  body.querySelectorAll = function (sel) {
    if (sel === '[data-fuedit]') return rowEls;
    if (sel === '[data-fxphoto]') return [];
    return [];
  };
  function FakeFileReader() {}
  FakeFileReader.prototype.readAsDataURL = function (file) {
    const self = this; self.result = 'data:raw-' + file.__tag;
    setTimeout(function () { if (self.onload) self.onload(); }, 0);
  };
  const fbDocs = [];
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
      saveDoc: function (col, id, doc) { fbDocs.push({ col: col, id: id, doc: JSON.parse(JSON.stringify(doc)) }); return Promise.resolve({}); },
      loadDoc: function () { return Promise.resolve(null); },
      loadDocs: function () { return Promise.resolve([]); }
    },
    TicketOCR: {
      fileToOCRImage: function (file, cb) { cb(file.__tag === 'r2' ? OCR_URL2 : OCR_URL); },
      fileToStorageImage: function (file, cb) { cb(file.__tag === 'r2' ? STORE_URL2 : STORE_URL); },
      urlToReadImage: function (url, kind, cb) { cb(url); },
      recognizeWithRotation: function (url) {
        return Promise.resolve(url === OCR_URL2 ? RECEIPT2_TEXT : RECEIPT_TEXT);
      },
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
  return { api: sb.Meticulous.modules.fuel, body: body, els: els, raw: raw, fbDocs: fbDocs, baseTotal: baseTotal,
    fills: function () { return JSON.parse(raw['fuel_fills']); } };
}

/* quota: seed total + storage rendition + slack — never + OCR rendition */
function calibrateQuota(w) {
  return w.baseTotal + STORE_URL.length + 20000;
}

(async function () {
  /* ===== A1: the Nov 7 ADD, at the wall — the reproduction ===== */
  {
    const w = makeFuelWorld({ fills: seedBook(false), fillerLen: 5000000, quota: Infinity });
    const quota = calibrateQuota(w);
    /* rebuild with the calibrated quota (same seed => same base) */
    const wq = makeFuelWorld({ fills: seedBook(false), fillerLen: 5000000, quota: quota });
    wq.api.render(wq.body);
    await tick();
    wq.els['#fu_img'].files = [{ __tag: 'r1' }];
    wq.els['#fu_img'].onchange({ target: wq.els['#fu_img'] });
    await tick(); await tick(); await tick();
    eq('A1 OCR filled the litres from the receipt', wq.els['#fu_l'].value, '115.262');
    eq('A1 OCR filled the cost from the receipt', wq.els['#fu_cost'].value, '250');
    wq.els['#fu_odo'].value = '171868';
    wq.els['#fu_add'].onclick();
    await tick();
    const fills = wq.fills();
    eq('A1 the book grew 61 -> 62 fills (64 -> 65 records with expenses)', fills.length, 62);
    const rec = fills.filter(function (r) { return r.date === '2026-11-07'; })[0] || {};
    eq('A1 the saved litres are exact', String(rec.litres), '115.262');
    eq('A1 the saved cost is exact', String(rec.cost), '250');
    eq('A1 the saved odometer is exact', rec.odo, 171868);
    ok('A1 THE PHOTO SURVIVES THE SAVE (record field)', typeof rec.photo === 'string' && rec.photo.length > 0,
      'photo is ' + (rec.photo === undefined ? 'ABSENT — the Nov 7 drop' : typeof rec.photo));
    eq('A1 the record carries the STORAGE rendition, not the 1600px OCR one', rec.photo, STORE_URL);
    const doc = wq.fbDocs.filter(function (d) { return d.col === 'fuel' && rec.id && d.id === 'fillid_' + rec.id; })[0];
    ok('A1 the per-record cloud doc was written under the stable key', !!doc, JSON.stringify(wq.fbDocs.map(function (d) { return d.id; })));
    ok('A1 the per-record doc CARRIES the photo', !!doc && doc.doc.photo === STORE_URL);
    ok('A1 no "didn\'t fit" note was needed', wq.body.innerHTML.indexOf('didn\'t fit') === -1);
  }

  /* ===== A2: the EDIT re-attach, at the wall ===== */
  {
    const seed = seedBook(true);
    const wq = makeFuelWorld({ fills: seed, fillerLen: 5000000, quota: Infinity });
    const quota = calibrateQuota(wq);
    const w = makeFuelWorld({ fills: seedBook(true), fillerLen: 5000000, quota: quota });
    w.api.render(w.body);
    await tick();
    const idx = w.fills().findIndex(function (r) { return r.date === '2026-11-07'; });
    /* open the entry's details, then its edit form (the list rows
       are bound by the module during render) */
    const rows = w.body.querySelectorAll('[data-fuedit]');
    rows[idx].onclick();
    await tick();
    ok('A2 details open on the photo-less entry (the Nov 7 state)', w.body.innerHTML.indexOf('No photo for this entry') >= 0);
    w.els['#fu_det_edit'].onclick();
    await tick();
    /* attach the receipt + the dashboard photo in the odo slot */
    w.els['#fu_img'].files = [{ __tag: 'r1' }];
    w.els['#fu_img'].onchange({ target: w.els['#fu_img'] });
    await tick(); await tick();
    w.els['#fu_odo_in'].files = [{ __tag: 'dash' }];
    /* the odometer OCR reads the OCR rendition of the dash photo;
       the stub parses any text containing the reading */
    w.els['#fu_odo_in'].onchange({ target: w.els['#fu_odo_in'] });
    await tick(); await tick();
    w.els['#fu_add'].onclick();
    await tick();
    const fills = w.fills();
    eq('A2 still 62 fills after the edit', fills.length, 62);
    const rec = fills.filter(function (r) { return r.date === '2026-11-07'; })[0] || {};
    ok('A2 THE RE-ATTACHED PHOTO SURVIVES THE EDIT SAVE', rec.photo === STORE_URL,
      'photo is ' + (rec.photo === undefined ? 'ABSENT — the Nov 7 drop' : 'wrong value'));
    eq('A2 the figures survived the edit untouched', String(rec.litres) + '|' + String(rec.cost) + '|' + rec.odo, '115.262|250|171868');
    const doc = w.fbDocs.filter(function (d) { return d.col === 'fuel' && d.id === 'fillid_fuNov7seed'; })[0];
    ok('A2 the per-record doc now carries the photo too', !!doc && doc.doc.photo === STORE_URL);
  }

  /* ===== A3: roomy store — the control ===== */
  {
    const w = makeFuelWorld({ fills: seedBook(false), fillerLen: 1000, quota: Infinity });
    w.api.render(w.body);
    await tick();
    w.els['#fu_img'].files = [{ __tag: 'r1' }];
    w.els['#fu_img'].onchange({ target: w.els['#fu_img'] });
    await tick(); await tick(); await tick();
    w.els['#fu_odo'].value = '171868';
    w.els['#fu_add'].onclick();
    await tick();
    const rec = w.fills().filter(function (r) { return r.date === '2026-11-07'; })[0] || {};
    eq('A3 with room, the photo persists on the record', rec.photo, STORE_URL);
    ok('A3 with room, no "didn\'t fit" note', w.body.innerHTML.indexOf('didn\'t fit') === -1);
  }

  /* ===== A4: two receipts, one fill, at the wall ===== */
  {
    const wq = makeFuelWorld({ fills: seedBook(false), fillerLen: 5000000, quota: Infinity });
    /* the v332 record shape stores the head receipt twice (photo
       mirrors photos[0]) — the quota fits the two STORAGE
       renditions in that shape, never the two OCR renditions */
    const quota = wq.baseTotal + STORE_URL.length * 2 + STORE_URL2.length + 20000;
    const w = makeFuelWorld({ fills: seedBook(false), fillerLen: 5000000, quota: quota });
    w.api.render(w.body);
    await tick();
    w.els['#fu_img'].files = [{ __tag: 'r1' }];
    w.els['#fu_img'].onchange({ target: w.els['#fu_img'] });
    await tick(); await tick();
    w.els['#fu_img2'].files = [{ __tag: 'r2' }];
    w.els['#fu_img2'].onchange({ target: w.els['#fu_img2'] });
    await tick(); await tick();
    w.els['#fu_odo'].value = '171868';
    w.els['#fu_add'].onclick();
    await tick();
    const rec = w.fills().filter(function (r) { return r.date === '2026-11-07'; })[0] || {};
    eq('A4 the stack rides the record (photo = first receipt)', rec.photo, STORE_URL);
    eq('A4 the stack carries BOTH storage renditions', rec.photos, [STORE_URL, STORE_URL2]);
    const doc = w.fbDocs.filter(function (d) { return d.col === 'fuel' && rec.id && d.id === 'fillid_' + rec.id; })[0];
    ok('A4 the per-record doc carries the whole stack', !!doc && JSON.stringify(doc.doc.photos) === JSON.stringify([STORE_URL, STORE_URL2]));
  }

  /* ===== B1: the pull/echo round-trip cannot strip the photo ===== */
  {
    const book = seedBook(true);
    book.forEach(function (r) { if (r.date === '2026-11-07') { r.photo = STORE_URL; r.id = 'fuNov7seed'; } });
    /* the cloud book copy: over the cap, so the v289 shed law
       stripped every photo field — the new record's cloud twin
       is photo-less, same id, same updAt */
    const cloudBook = book.map(function (r) { const c = {}; for (const k in r) { if (k !== 'photo' && k !== 'photos' && k !== 'photo2') c[k] = r[k]; } return c; });
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
    const pushes = [];
    sb.FB = {
      ready: true, user: { uid: 'u1' },
      loadDocs: function () { return Promise.resolve([{ id: 'fuel_fills', v: cloudBook, updatedAt: 2000 }]); },
      saveDoc: function (col, id, doc) { pushes.push({ id: id, v: doc.v }); return Promise.resolve({}); },
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
    eq('B1 the union keeps all 62 fills', after.length, 62);
    const rec = after.filter(function (r) { return r.date === '2026-11-07'; })[0] || {};
    eq('B1 the shed cloud twin did NOT strip the local photo (merge is innocent)', rec.photo, STORE_URL);
    const cloudRec = cloudBook.filter(function (r) { return r.date === '2026-11-07'; })[0] || {};
    eq('B1 the cloud copy holds the record\'s FACTS (facts cross; only the photo stays home)',
      String(cloudRec.litres) + '|' + String(cloudRec.cost) + '|' + cloudRec.odo, '115.262|250.00|171868');
    const pushed = pushes.filter(function (p) { return p.id === 'fuel_fills'; });
    ok('B1 no push ever makes the cloud copy poorer (any push carries all 62 fills, Nov 7 facts aboard, photo shed per the v289 law)',
      pushed.every(function (p) {
        const pr = p.v.filter(function (r) { return r.date === '2026-11-07'; })[0] || {};
        return p.v.length === 62 && String(pr.litres) === '115.262' && !pr.photo;
      }), pushed.length + ' fuel_fills push(es)');
  }

  /* ===== pins ===== */
  ok('pin: ticket-ocr exports the storage rendition at the text read size',
    ocrSrc.indexOf("TicketOCR.fileToStorageImage = function (file, cb) { _fileToSizedImage(file, 1280, cb); };") >= 0);
  ok('pin: the fill save captures the stack BEFORE any shed (doc guarantee)',
    fuelSrc.indexOf('var addDocStack = fillPhotos(rec);') >= 0 && fuelSrc.indexOf('saveFillPhotoDoc(rec, addDocStack);') >= 0);
  ok('pin: the edit save captures the merged stack BEFORE any shed (doc guarantee)',
    fuelSrc.indexOf('saveFillPhotoDoc(updated, mergedStack);') >= 0);
  ok('pin: the expense save captures its photo BEFORE any shed (doc guarantee)',
    fuelSrc.indexOf('saveExpensePhotoDoc(rec, fxPhoto ? [fxPhoto] : null);') >= 0);

  console.log('\nfuel-photo-save-drop-v370 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR ' + (e && e.stack || e)); process.exit(1); });
