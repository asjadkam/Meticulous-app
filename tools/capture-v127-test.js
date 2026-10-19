#!/usr/bin/env node
/* Meticulous v127 — MAINTENANCE / FUEL CAPTURE suite.
 *
 * Every case traces to the owner's Oct 17, 2026 field test:
 *  (a) 09:32 — the Maintenance odometer Power Read returned
 *      169,211 correctly, its tap-to-use suggestion showed ~2 s,
 *      then vanished before he could tap; the field kept the old
 *      value. ROOT CAUSE (pinned in js/app.js at prBox): the chip
 *      lived in the SHARED #<prefix>_chips box, which the
 *      background candidate hunt blanks wholesale on every pass;
 *      the pooled hunt runs seconds behind the ~2 s cloud answer.
 *      v127: the suggestion gets its OWN box (#<prefix>_prbox),
 *      cleared only by accept / dismiss / a NEW photo — and an
 *      empty later hunt pass no longer blanks the hunt box.
 *  (b) 09:32 — "maintenance should have section to take a picture
 *      of the annual safety sticker": Maintenance gains its own
 *      sticker card (photo → read → confirm → Save), writing
 *      mt_annualDate AND mirroring onboarding.safetyExpiry (the
 *      v118 two-store rule). Fill-only until Save, like the
 *      odometer card.
 *  (c) 09:14 — the Fuel trend card read "2.5 km/L · Last 1
 *      fill-ups" off ONE leg. Under 3 legs there is no trend: the
 *      card says "Last leg — a trend needs 3 legs; you have N so
 *      far". The v109 leg sanity filter is untouched.
 *  (d) 09:33 — "there has to be a way to change the unit… some
 *      users prefer mpg, not km/L": Preferences → "Fuel economy
 *      shown as" (km/L · L/100 km · MPG US), default km/L,
 *      applied at print time everywhere; records stay km/L.
 *  (e) 09:39 — "It should tell over the life time how many km's
 *      and how many liters of fuel and how much kmpl": the
 *      Maintenance summary gains Lifetime distance / fuel /
 *      economy, honestly labelled with the records' span.
 *  (f) 09:53 — "Why is there no photo entry?... The picture I
 *      took yesterday?": the fuel save never wrote a photo field;
 *      the captured receipt (the 1600px OCR rendition) is now
 *      persisted on save AND on edit-with-fresh-photo. If it
 *      can't fit, the entry saves without it and says so once.
 *  (g) 09:56 — "If the shift isn't closed yet. It should say
 *      income earned today so far": the manifest earned row is
 *      "Income earned today so far" while the day is live,
 *      "Total Earned Income" once closed — both renderers.
 *  (h) 09:57 — "You should fix that": the dated odometer log
 *      (v122) is SEEDED from dated records the app already holds
 *      (fuel fills + sessions, source-tagged, idempotent, the
 *      519,326 invoice-number stamp can never seed), and
 *      Maintenance gains "＋ Add a past reading" — a past reading
 *      lands through the audited correction path with its chosen
 *      timestamp and moves the manifest's day boundary.
 *
 * Worlds: (a) drives the REAL app.js photo-pipeline slice with a
 * deferred hunt + scripted power read; (d)/(h1) drive the REAL
 * ODO-MASTER + ECON slice; (b)/(c)/(e)/(f)/(h2) drive the REAL
 * modules/fuel.js + modules/maintenance.js with the REAL app.js
 * helpers wired onto App; (g)/(h3) drive the REAL
 * modules/manifest.js (manifest-odo harness pattern; the shared
 * revenue builder is stubbed at its documented boundary — its own
 * math is pinned by tools/money-truth-test.js).
 * Run: node tools/capture-v127-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const fuelSrc = fs.readFileSync(path.join(ROOT, 'modules', 'fuel.js'), 'utf8');
const mtSrc = fs.readFileSync(path.join(ROOT, 'modules', 'maintenance.js'), 'utf8');
const manSrc = fs.readFileSync(path.join(ROOT, 'modules', 'manifest.js'), 'utf8');
const pfSrc = fs.readFileSync(path.join(ROOT, 'modules', 'preferences.js'), 'utf8');
const ocrSrc = fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function near(name, got, want, eps) {
  ok(name, Math.abs(got - want) < (eps || 1e-9), 'got ' + got + ', want ~' + want);
}
const flush = async function () { for (let i = 0; i < 12; i++) await new Promise(function (r) { setImmediate(r); }); };

/* ---------------- the app.js slice: ODO-MASTER + ECON + photo pipeline ---------------- */
const sliceStart = appSrc.indexOf('var _onbOcrToken');
const sliceEnd = appSrc.indexOf('function collectOnbInputs');
if (sliceStart < 0 || sliceEnd < 0 || sliceEnd <= sliceStart) {
  console.log('FAIL could not slice the app.js region'); process.exit(1);
}
const appSlice = appSrc.slice(sliceStart, sliceEnd);
['function logOdoReading', 'function seedOdoReadings', 'function econConvert',
 'function econFormat', 'function prSuggest', 'function onbWirePhoto'].forEach(function (s) {
  if (appSlice.indexOf(s) < 0) { console.log('FAIL slice is missing ' + s); process.exit(1); }
});

/* ---------------- raw store (real app semantics: JSON deep copies) ---------------- */
function makeStore(limit) {
  const mem = {};
  return {
    _mem: mem,
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) {
      const s = JSON.stringify(v);
      if (limit && s.length > limit) return false; /* the quota wall: the write does not land */
      mem[k] = JSON.parse(s); return true;
    },
    del: function (k) { delete mem[k]; return true; }
  };
}
const escFn = function (s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};
function FileReader() {}
FileReader.prototype.readAsDataURL = function () {
  this.result = 'data:image/jpeg;base64,RAWPHOTO';
  if (this.onload) this.onload();
};

/* ---------------- fake DOM for the photo pipeline (maint-odo-photo pattern) ---------------- */
function makeDocument() {
  const all = new Set();
  class El {
    constructor(tag) {
      this.tagName = String(tag || 'div').toUpperCase();
      this.children = []; this.parentNode = null;
      this.id = ''; this._value = ''; this._innerHTML = ''; this.textContent = '';
      this.style = {}; this.className = ''; this.type = ''; this.files = [];
      this.onclick = null; this.onchange = null;
      all.add(this);
    }
    set value(v) { this._value = (v === null || v === undefined) ? '' : String(v); }
    get value() { return this._value; }
    set innerHTML(v) { this._innerHTML = String(v); if (!v) this.children = []; }
    get innerHTML() { return this._innerHTML; }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    insertBefore(node, ref) {
      node.parentNode = this;
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i >= 0) this.children.splice(i, 0, node); else this.children.push(node);
      return node;
    }
    get nextSibling() {
      if (!this.parentNode) return null;
      const s = this.parentNode.children, i = s.indexOf(this);
      return i >= 0 ? (s[i + 1] || null) : null;
    }
    click() { if (this.onclick) this.onclick(); }
    findAll(pred, out) {
      out = out || [];
      this.children.forEach(function (c) { if (pred(c)) out.push(c); c.findAll(pred, out); });
      return out;
    }
  }
  return {
    createElement: function (tag) { return new El(tag); },
    getElementById: function (id) {
      let hit = null;
      all.forEach(function (e) { if (e.id === id) hit = e; });
      return hit;
    }
  };
}

/* ============ (a) THE SUGGESTION PERSISTS ============
 * The owner's exact sequence: snap the dash → the local read
 * fails → the power read answers 169,211 → the suggestion paints
 * → the pooled hunt's passes land AFTER it. Before v127 the
 * hunt's next pass erased the chip in ~2 s. */
async function partA() {
  console.log('\n— (a) power-read suggestion: no auto-clear path —');
  ok('static: the prbox is touched only by prBox/prSuggest + the new-photo clear',
    (appSrc.match(/prefix \+ '_prbox'/g) || []).length === 3,
    'sites: ' + (appSrc.match(/prefix \+ '_prbox'/g) || []).length);
  ok('static: no timer anywhere clears the suggestion box',
    !/setTimeout[\s\S]{0,200}_prbox/.test(appSrc) && !/setInterval[\s\S]{0,200}_prbox/.test(appSrc));

  const doc = makeDocument();
  const root = doc.createElement('div');
  const els = {};
  ['mt_odo', 'mt_odo_cam', 'mt_odo_pick', 'mt_odo_cam_in', 'mt_odo_in', 'mt_odo_prev', 'mt_odo_status']
    .forEach(function (id) {
      const e = doc.createElement(/_cam$|_pick$/.test(id) ? 'button' : 'div');
      e.id = id; root.appendChild(e); els[id] = e;
    });
  const store = makeStore();
  store.set('mt_odo', '169166');
  const state = { powerFields: { value: '169211' } };
  const captured = { hunt: null, escalate: null };
  const TicketOCR = {
    recognize: function () { return Promise.resolve('blurry dash, nothing legible'); },
    huntCandidates: function (url, o) { captured.hunt = o; return Promise.resolve({}); }, /* deferred: the test fires the passes */
    fileToOCRImage: function (file, cb) { cb('data:image/jpeg;base64,OCR'); }
  };
  const PowerRead = {
    escalate: function (o) {
      captured.escalate = o;
      if (o.onStatus) o.onStatus({ state: 'working' });
      if (state.powerFields && o.onResult) o.onResult({ fields: state.powerFields });
      return Promise.resolve({ status: 'done' });
    }
  };
  const persistCalls = [];
  const sandbox = {
    console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
    document: doc, FileReader: FileReader, TicketOCR: TicketOCR, PowerRead: PowerRead,
    App: { onb: {}, tracker: { status: 'idle', startTs: 0, elapsed: 0 } },
    store: store,
    el: function (id) { return doc.getElementById(id); },
    todayStr: function (d) { d = d || new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); },
    trackerSave: function () {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(appSlice, sandbox);
  sandbox.onbWirePhoto('mt_odo', 'odometer', function (k, v) { persistCalls.push([k, v]); }, { origin: { module: 'maintenance', label: 'Maintenance' } });

  function snap() { els.mt_odo_cam_in.files = [{ name: 'dash.jpg' }]; els.mt_odo_cam_in.onchange(); }
  function prbox() { return doc.getElementById('mt_odo_prbox'); }
  function valueChips(box) { return box ? box.findAll(function (e) { return e.tagName === 'BUTTON' && e.textContent !== '✕ Not it'; }) : []; }
  function dismissBtn(box) { const b = box ? box.findAll(function (e) { return e.tagName === 'BUTTON' && e.textContent === '✕ Not it'; }) : []; return b[0] || null; }

  snap();
  await flush();
  ok('the power read escalated on the local miss', !!captured.escalate);
  ok('the hunt is running in the background (its passes land later)', !!captured.hunt);
  const box1 = prbox();
  ok('the suggestion painted in its OWN box', !!box1);
  eq('one value chip, labelled with his real reading', valueChips(box1).length ? valueChips(box1)[0].textContent : '', '169,211 km');
  eq('the field is NOT auto-filled', els.mt_odo.value, '');
  eq('nothing persisted before a tap', persistCalls.length, 0);

  /* The regression itself: the hunt's later passes land now. */
  captured.hunt.onUpdate({ odo: [] });
  eq('an EMPTY later hunt pass leaves the suggestion standing', valueChips(prbox()).length, 1);
  captured.hunt.onUpdate({ odo: [{ value: 169300 }] });
  eq('a NON-EMPTY later hunt pass leaves the suggestion standing', valueChips(prbox()).length, 1);
  const huntBox = doc.getElementById('mt_odo_chips');
  eq('the hunt painted its own chip in its own box', huntBox ? huntBox.findAll(function (e) { return e.tagName === 'BUTTON'; }).length : 0, 1);
  captured.hunt.onUpdate({ odo: [] });
  eq('an empty pass no longer blanks the hunt box either', huntBox.findAll(function (e) { return e.tagName === 'BUTTON'; }).length, 1);

  /* A NEW photo is a user act — the one legitimate clear. */
  state.powerFields = null; /* this photo's power read never answers */
  snap();
  await flush();
  eq('a new photo clears the pending suggestion', valueChips(prbox()).length, 0);
  eq('a new photo clears the hunt chips too', doc.getElementById('mt_odo_chips').findAll(function (e) { return e.tagName === 'BUTTON'; }).length, 0);

  /* Accept: the tap fills + persists through the host persist(). */
  state.powerFields = { value: '169211' };
  snap();
  await flush();
  eq('the suggestion is back for the new photo', valueChips(prbox()).length, 1);
  valueChips(prbox())[0].click();
  eq('accept fills the field', els.mt_odo.value, '169211');
  eq('accept persists through the host persist()', JSON.stringify(persistCalls), JSON.stringify([['odometer', '169211']]));
  eq('accept clears the suggestion box', valueChips(prbox()).length, 0);

  /* Dismiss: clears ONLY the suggestion box; the field is untouched. */
  snap();
  await flush();
  eq('the suggestion returns on the next photo', valueChips(prbox()).length, 1);
  dismissBtn(prbox()).click();
  eq('dismiss clears the suggestion box', valueChips(prbox()).length, 0);
  eq('dismiss never touches the field', els.mt_odo.value, '169211');
  ok('dismiss says what happened', els.mt_odo_status.innerHTML.indexOf('set aside') >= 0);
}

/* ============ (d) THE ECONOMY UNIT — pure conversions ============ */
function makeAppWorld() {
  const store = makeStore();
  const sandbox = { console: console, store: store };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(appSlice, sandbox);
  return { sandbox: sandbox, store: store };
}
function partD() {
  console.log('\n— (d) economy unit: conversion exactness + preference semantics —');
  const w = makeAppWorld();
  const sb = w.sandbox;
  eq('default unit is km/L', sb.econUnit(), 'kpl');
  eq('km/L passes through', sb.econConvert(2.93, 'kpl'), 2.93);
  near('L/100 km = 100 / (km/L)', sb.econConvert(2.93, 'l100'), 100 / 2.93, 1e-12);
  near('MPG (US) = km/L × 2.3521458', sb.econConvert(2.93, 'mpg'), 2.93 * 2.3521458, 1e-12);
  near('L/100 km round-trips to km/L', 100 / sb.econConvert(2.93, 'l100'), 2.93, 1e-9);
  near('MPG round-trips to km/L', sb.econConvert(2.93, 'mpg') / 2.3521458, 2.93, 1e-9);
  eq('default format is km/L (his long-run truth, 2.93)', sb.econFormat(2.93).value + ' ' + sb.econFormat(2.93).unit, '2.9 km/L');
  w.store.set('mt_econUnit', 'l100');
  eq('the preference reads live', sb.econUnit(), 'l100');
  eq('format in L/100 km', sb.econFormat(2.93).value + ' ' + sb.econFormat(2.93).unit, '34.1 L/100 km');
  w.store.set('mt_econUnit', 'mpg');
  eq('format in MPG', sb.econFormat(2.93).value + ' ' + sb.econFormat(2.93).unit, '6.9 MPG');
  w.store.set('mt_econUnit', 'gallons-per-smile');
  eq('an invalid stored value falls back to km/L', sb.econUnit(), 'kpl');
  eq('no economy → no conversion (never a fake 0)', sb.econConvert(0), null);
  eq('no economy → no format', sb.econFormat(0), null);

  console.log('\n— (d) the Preferences door (statics) —');
  ok('the select lives in Preferences', pfSrc.indexOf('id="pf_econ"') >= 0);
  ok('all three units are offered', pfSrc.indexOf("['kpl', 'km/L']") >= 0 && pfSrc.indexOf("['l100', 'L/100 km']") >= 0 && pfSrc.indexOf("['mpg', 'MPG (US)']") >= 0);
  ok('the stored choice is the one marked selected at render', pfSrc.indexOf("App._econUnit()") >= 0 && pfSrc.indexOf("econU === x[0] ? ' selected'") >= 0);
  ok('changing it persists immediately to mt_econUnit', pfSrc.indexOf("App._store.set('mt_econUnit', econSel.value)") >= 0);
}

/* ============ (h1) THE SEED ============ */
function partH1() {
  console.log('\n— (h1) seed: fills + sessions → the dated log, idempotent, poison-proof —');
  const FILLS = [
    { date: '2026-10-13', time: '09:12', odo: 168510, litres: 94.522, cost: 234.32 },
    { date: '2026-10-14', time: '17:32', odo: 168759, litres: 100.0, cost: 247.90 },
    { date: '2026-10-15', time: '12:05', odo: 168936, litres: 72.0, cost: 178.49 },
    { date: '2026-10-15', time: '17:55', odo: 519326, litres: 78.175, cost: 193.80 }, /* the invoice number */
    { date: '2026-10-16', time: '18:02', odo: 169166, litres: 88.106, cost: 199.91 }
  ];
  const w = makeAppWorld();
  w.store.set('mt_odo', '169166');
  w.store.set('fuel_fills', JSON.parse(JSON.stringify(FILLS)));
  w.store.set('sessions', [{
    date: '2026-10-16', endedAt: new Date(2026, 9, 16, 19, 26).getTime(), seconds: 36000,
    startOdo: 168936, endOdo: 169166
  }]);
  const added = w.sandbox.seedOdoReadings();
  eq('five entries seeded (4 fills + the session start; the session end dedupes)', added, 5);
  const log = w.store.get('odo_readings', []);
  eq('the log holds exactly those five', log.length, 5);
  ok('the poisoned 519,326 stamp never seeded', log.every(function (r) { return r.value !== 519326; }), JSON.stringify(log));
  const byVD = {};
  log.forEach(function (r) { byVD[r.value + '|' + r.date] = r; });
  eq('fill entries carry their source', byVD['168510|2026-10-13'].source, 'seed-fill');
  eq('the Oct 15 pump reading seeded at the fill time', byVD['168936|2026-10-15'].ts, new Date(2026, 9, 15, 12, 5).getTime());
  eq('the session start seeded as seed-session', byVD['168936|2026-10-16'].source, 'seed-session');
  eq('the session start sits at endedAt − seconds', byVD['168936|2026-10-16'].ts, new Date(2026, 9, 16, 9, 26).getTime());
  eq('the Oct 16 reading is present once (fill + session end dedupe)', log.filter(function (r) { return r.value === 169166; }).length, 1);
  ok('the log is time-sorted', log.every(function (r, i) { return i === 0 || log[i - 1].ts <= r.ts; }));
  const before = JSON.stringify(log);
  eq('running the seed again adds nothing', w.sandbox.seedOdoReadings(), 0);
  eq('…and the log is byte-identical', JSON.stringify(w.store.get('odo_readings', [])), before);

  const w2 = makeAppWorld();
  w2.store.set('mt_odo', '169166');
  w2.store.set('fuel_fills', JSON.parse(JSON.stringify(FILLS)));
  w2.store.set('odo_readings', [{ ts: new Date(2026, 9, 14, 19, 26).getTime(), date: '2026-10-14', value: 168759, source: 'maintenance' }]);
  eq('a reading already in the log is not re-seeded', w2.sandbox.seedOdoReadings(), 3);
  const log2 = w2.store.get('odo_readings', []);
  eq('the existing entry keeps its own source (auditable)', log2.filter(function (r) { return r.value === 168759; })[0].source, 'maintenance');
  eq('no duplicate of it exists', log2.filter(function (r) { return r.value === 168759 && r.date === '2026-10-14'; }).length, 1);
}

/* ---------------- module worlds: REAL modules + REAL app helpers ----------------
 * The body stub mimics a fresh DOM per render: setting innerHTML
 * resets every field stub, then markup value="…" attributes land
 * (exactly what a browser would show), and [data-fuedit] rows are
 * rebuilt from the markup. */
function makeBody() {
  const stubs = {};
  function mkStub() {
    return {
      value: '', innerHTML: '', textContent: '', style: {}, checked: false,
      onclick: null, onchange: null, _attrs: {},
      setAttribute: function (k, v) { this._attrs[k] = String(v); },
      getAttribute: function (k) { return (k in this._attrs) ? this._attrs[k] : null; },
      addEventListener: function () {},
      click: function () { if (this.onclick) this.onclick({ target: this }); }
    };
  }
  function stub(sel) { return stubs[sel] || (stubs[sel] = mkStub()); }
  const body = { _html: '', _rows: [] };
  Object.defineProperty(body, 'innerHTML', {
    get: function () { return this._html; },
    set: function (v) {
      this._html = String(v);
      Object.keys(stubs).forEach(function (k) {
        const s = stubs[k];
        s.value = ''; s.innerHTML = ''; s.textContent = ''; s._attrs = {}; s.onclick = null; s.onchange = null; s.checked = false;
      });
      const tagRe = /<[^>]*\bid="([^"]+)"[^>]*>/g; let m;
      while ((m = tagRe.exec(this._html))) {
        const vm2 = /\bvalue="([^"]*)"/.exec(m[0]);
        if (vm2) stub('#' + m[1]).value = vm2[1];
      }
      this._rows = [];
      const rowRe = /data-fuedit="(\d+)"/g;
      while ((m = rowRe.exec(this._html))) {
        const idx = m[1];
        this._rows.push({ _idx: idx, onclick: null, getAttribute: function (n) { return n === 'data-fuedit' ? idx : null; } });
      }
    }
  });
  body.querySelector = function (sel) { return stub(sel); };
  body.querySelectorAll = function (sel) { return sel === '[data-fuedit]' ? body._rows : []; };
  return body;
}

function makeModuleWorld(opts) {
  opts = opts || {};
  const store = makeStore(opts.storeLimit || 0);
  (opts.seed || []).forEach(function (kv) { store.set(kv[0], kv[1]); });
  const wireCalls = [];
  const sandbox = {
    console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Promise: Promise,
    store: store, /* the app slice's functions read the bare `store` global, as in app.js */
    FileReader: FileReader,
    document: { createElement: function () { return { style: {} }; }, getElementById: function () { return null; } },
    App: {
      _store: store, _esc: escFn, _today: function () { return '2026-10-17'; },
      onb: {}, tracker: { status: 'idle', startTs: 0, elapsed: 0 },
      _wirePhotoOCR: function () { wireCalls.push([].slice.call(arguments)); }
    },
    Meticulous: { modules: {} }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(appSlice, sandbox);
  /* the REAL app.js helpers, wired onto App exactly as app.js exposes them */
  sandbox.App._logOdoReading = sandbox.logOdoReading;
  sandbox.App._seedOdoReadings = sandbox.seedOdoReadings;
  sandbox.App._masterOdometer = sandbox.masterOdometer;
  sandbox.App._bumpOdometer = sandbox.bumpOdometer;
  sandbox.App._odoSaveDecision = sandbox.odoSaveDecision;
  sandbox.App._odoImplausible = sandbox.odoImplausible;
  sandbox.App._parseOdometerReading = sandbox.parseOdometerReading;
  sandbox.App._econUnit = sandbox.econUnit;
  sandbox.App._econConvert = sandbox.econConvert;
  sandbox.App._econFormat = sandbox.econFormat;
  vm.runInContext(ocrSrc, sandbox); /* the REAL receipt parsers */
  if (opts.ocrUrl !== undefined || opts.receiptText !== undefined) {
    sandbox.TicketOCR.fileToOCRImage = function (file, cb) { cb(opts.ocrUrl || ''); };
    sandbox.TicketOCR.recognizeWithRotation = function () { return Promise.resolve(opts.receiptText || ''); };
  }
  if (opts.fuel) vm.runInContext(fuelSrc, sandbox);
  if (opts.maint) vm.runInContext(mtSrc, sandbox);
  return { sandbox: sandbox, store: store, wireCalls: wireCalls, body: makeBody() };
}

const MOBIL = [
  'Mobil 1742 Gas Stn', '300-3633 Westwinds Dr', 'Calgary, AB T3K 5K3',
  '2026-10-13 18:18:47', 'Pump 8', 'BIODE',
  '83.965 (L)  2.279 ($/L)  191.36 ($)', 'TOTAL CAD $ 191.36',
  'GST included in total $9.11', 'VISA ****8684', 'THANK YOU'
].join('\n');
const OCR_URL = 'data:image/jpeg;base64,OCRRECEIPT';

/* ============ (c) TREND HONESTY + (d) UNIT AT RENDER ============ */
function partC() {
  console.log('\n— (c) the trend card tells the truth about what it is —');
  const F1 = [
    { date: '2026-10-15', odo: 168759, litres: 100, cost: 240, station: 'Mobil' },
    { date: '2026-10-16', odo: 168936, litres: 72, cost: 175, station: 'Mobil' }
  ];
  const F2 = F1.concat([{ date: '2026-10-17', odo: 169166, litres: 88.106, cost: 200, station: 'Petro-Canada' }]);
  const F3 = F2.concat([{ date: '2026-10-18', odo: 169400, litres: 95, cost: 230, station: 'Petro-Canada' }]);
  function trendHtml(fills, unit) {
    const seed = [['fuel_fills', JSON.parse(JSON.stringify(fills))], ['mt_odo', '169400']];
    if (unit) seed.push(['mt_econUnit', unit]);
    const w = makeModuleWorld({ fuel: true, seed: seed });
    w.sandbox.Meticulous.modules.fuel.render(w.body);
    return w.body._html;
  }
  const h1 = trendHtml(F1);
  ok('one leg: labelled as the last leg, never a trend', h1.indexOf('Last leg — a trend needs 3 legs; you have 1 so far') >= 0, h1.slice(h1.indexOf('Fuel trend'), h1.indexOf('Fuel trend') + 400));
  ok('one leg: the figure itself is the leg (2.5 km/L)', h1.indexOf('2.5 <small') >= 0 && h1.indexOf('>2.5 km/L<') >= 0);
  ok('one leg: the old "Last 1 fill-ups" claim is gone', h1.indexOf('fill-ups') < 0 || h1.indexOf('Last 1 fill-ups') < 0);
  const h2 = trendHtml(F2);
  ok('two legs: still not a trend', h2.indexOf('Last leg — a trend needs 3 legs; you have 2 so far') >= 0);
  const h3 = trendHtml(F3);
  ok('three legs: a trend at last, counted in legs', h3.indexOf('Last 3 legs') >= 0);
  ok('three legs: no "needs 3 legs" hedge remains', h3.indexOf('a trend needs 3 legs') < 0);

  console.log('\n— (d) the chosen unit at render (records stay km/L) —');
  const hm = trendHtml(F1, 'mpg');
  ok('MPG chosen: the leg prints in MPG (2.5 km/L → 5.9 MPG)', hm.indexOf('5.9 <small') >= 0 && hm.indexOf('>5.9 MPG<') >= 0, hm.slice(hm.indexOf('Fuel trend'), hm.indexOf('Fuel trend') + 400));
  ok('MPG chosen: no km/L figure is printed on the card', hm.indexOf('2.5 km/L') < 0);
  const hl = trendHtml(F1, 'l100');
  ok('L/100 km chosen: the leg prints converted (2.5 → 40.0)', hl.indexOf('40.0 <small') >= 0 && hl.indexOf('L/100 km') >= 0);
}

/* ============ (f) THE RECEIPT PHOTO SURVIVES THE SAVE ============ */
async function partF() {
  console.log('\n— (f) save keeps the receipt photo; details shows it —');
  {
    const w = makeModuleWorld({
      fuel: true, ocrUrl: OCR_URL, receiptText: MOBIL,
      seed: [['mt_odo', '169166']]
    });
    const F = w.sandbox.Meticulous.modules.fuel;
    F.render(w.body);
    const pick = w.body.querySelector('#fu_img');
    pick.onchange({ target: { files: [{ name: 'receipt.jpg' }] } });
    await flush();
    eq('the receipt read filled litres', w.body.querySelector('#fu_l').value, '83.965');
    eq('the receipt read filled cost', w.body.querySelector('#fu_cost').value, '191.36');
    w.body.querySelector('#fu_odo').value = '169211';
    w.body.querySelector('#fu_add').click();
    const saved = w.store.get('fuel_fills', []);
    eq('one fill saved', saved.length, 1);
    eq('the photo rode onto the record', saved[0].photo, OCR_URL);
    eq('the read time rode along too', saved[0].time, '18:18');
    eq('the odometer rode along', saved[0].odo, 169211);
    /* details round-trip: row tap → the photo is on the page */
    w.body._rows[0].onclick();
    ok('details renders the saved photo', w.body._html.indexOf('<img id="fu_det_photo" src="' + OCR_URL + '"') >= 0);
    ok('details does NOT claim "No photo"', w.body._html.indexOf('No photo for this entry') < 0);
  }

  console.log('\n— (f) no photo → the clean no-photo state —');
  {
    const w = makeModuleWorld({ fuel: true, seed: [['mt_odo', '169166']] });
    const F = w.sandbox.Meticulous.modules.fuel;
    F.render(w.body);
    w.body.querySelector('#fu_l').value = '50';
    w.body.querySelector('#fu_cost').value = '120';
    w.body.querySelector('#fu_add').click();
    const saved = w.store.get('fuel_fills', []);
    eq('the typed fill saved', saved.length, 1);
    ok('no photo field was invented', !('photo' in saved[0]), JSON.stringify(saved[0]));
    w.body._rows[0].onclick();
    ok('details shows the clean no-photo state', w.body._html.indexOf('No photo for this entry') >= 0);
  }

  console.log('\n— (f) the photo cannot fit → the entry still saves, and says so once —');
  {
    const BIG = 'data:image/jpeg;base64,' + 'A'.repeat(4000);
    const w = makeModuleWorld({
      fuel: true, ocrUrl: BIG, receiptText: MOBIL, storeLimit: 2000,
      seed: [['mt_odo', '169166']]
    });
    const F = w.sandbox.Meticulous.modules.fuel;
    F.render(w.body);
    const pick = w.body.querySelector('#fu_img');
    pick.onchange({ target: { files: [{ name: 'receipt.jpg' }] } });
    await flush();
    w.body.querySelector('#fu_add').click();
    const saved = w.store.get('fuel_fills', []);
    eq('the fill-up saved anyway', saved.length, 1);
    ok('…without the photo that could not fit', !('photo' in saved[0]), JSON.stringify(Object.keys(saved[0])));
    eq('…with its numbers intact', saved[0].litres, '83.965');
    ok('the drop is said once, in the save note', w.body._html.indexOf('didn\'t fit in the app storage, so this entry was saved without it') >= 0);
  }

  console.log('\n— (f) edit: a fresh photo replaces; no photo keeps the old —');
  {
    const OLD = 'data:image/jpeg;base64,OLDRECEIPT';
    const seedFill = { date: '2026-10-13', time: '18:18', odo: 168936, litres: '83.965', cost: '191.36', station: 'Mobil', photo: OLD };
    const w = makeModuleWorld({
      fuel: true, ocrUrl: OCR_URL, receiptText: MOBIL,
      seed: [['mt_odo', '169166'], ['fuel_fills', [JSON.parse(JSON.stringify(seedFill))]]]
    });
    const F = w.sandbox.Meticulous.modules.fuel;
    F.render(w.body);
    w.body._rows[0].onclick();                       /* details */
    w.body.querySelector('#fu_det_edit').click();    /* → edit form */
    const pick = w.body.querySelector('#fu_img');
    pick.onchange({ target: { files: [{ name: 'new.jpg' }] } });
    await flush();
    w.body.querySelector('#fu_add').click();         /* Save changes */
    let saved = w.store.get('fuel_fills', []);
    eq('the fresh photo replaced the stored one', saved[0].photo, OCR_URL);

    F.render(w.body);
    w.body._rows[0].onclick();
    w.body.querySelector('#fu_det_edit').click();
    w.body.querySelector('#fu_l').value = '90';      /* a plain edit, no new photo */
    w.body.querySelector('#fu_add').click();
    saved = w.store.get('fuel_fills', []);
    eq('an edit with no new photo keeps the stored photo', saved[0].photo, OCR_URL);
    eq('…and the edit itself landed', saved[0].litres, '90');
  }

  console.log('\n— (f) edit under quota: the old photo is the fallback, the edit still lands —');
  {
    const OLD = 'data:image/jpeg;base64,OLD';
    const BIG = 'data:image/jpeg;base64,' + 'B'.repeat(4000);
    const seedFill = { date: '2026-10-13', odo: 168936, litres: '83.965', cost: '191.36', station: 'Mobil', photo: OLD };
    const w = makeModuleWorld({
      fuel: true, ocrUrl: BIG, receiptText: MOBIL, storeLimit: 2000,
      seed: [['mt_odo', '169166'], ['fuel_fills', [JSON.parse(JSON.stringify(seedFill))]]]
    });
    const F = w.sandbox.Meticulous.modules.fuel;
    F.render(w.body);
    w.body._rows[0].onclick();
    w.body.querySelector('#fu_det_edit').click();
    const pick = w.body.querySelector('#fu_img');
    pick.onchange({ target: { files: [{ name: 'new.jpg' }] } });
    await flush();
    w.body.querySelector('#fu_l').value = '91';
    w.body.querySelector('#fu_add').click();
    const saved = w.store.get('fuel_fills', []);
    eq('the edit landed despite the photo not fitting', saved[0].litres, '91');
    eq('the previous photo was kept as the fallback', saved[0].photo, OLD);
    ok('the drop is said in the save note', w.body._html.indexOf('The new receipt photo didn\'t fit') >= 0);
  }
}

/* ============ (e) LIFETIME TOTALS ============ */
function partE() {
  console.log('\n— (e) lifetime totals: every fill counted for fuel; distance/economy are the bookends since v156 (legs keep their own line) —');
  const FILLS = [
    { date: '2026-10-13', odo: 168510, litres: 94.522, cost: 234.32, station: 'Mobil — Westwinds' },
    { date: '2026-10-14', odo: 168759, litres: 100.0, cost: 247.90, station: 'Mobil — Heritage Meadows' },
    { date: '2026-10-15', odo: 168936, litres: 72.0, cost: 178.49, station: 'Mobil' },
    { date: '2026-10-15', odo: 519326, litres: 78.175, cost: 193.80, station: 'Mobil (poisoned stamp)' },
    { date: '2026-10-16', odo: 169166, litres: 88.106, cost: 199.91, station: 'Petro-Canada — Barlow Tr' }
  ];
  /* v156 DELIBERATE PIN MOVE (cited): this part pinned v127's
     semantics — Lifetime distance = the leg sum, Lifetime economy
     = the leg economy. v156 (Fuel Distance Truth) supersedes
     exactly that: the Lifetime rows are the odometer BOOKENDS
     (master − earliest dated reading) and the leg figures live on
     their own labelled line. The world therefore gains the dated
     reading the real app's log holds for its first fill
     (2026-10-13 @ 168,510 — the seed-fill source), which makes
     the bookend distance coincide with the leg span here (656),
     while the economy becomes the honest bookend figure:
     656 ÷ 432.803 L (every fill in the window) = 1.52 km/L. The
     leg pins themselves (legs / kmTracked / legLitres / avgKpl)
     are UNCHANGED — the leg math did not move, only which rows
     may call themselves Lifetime. */
  const seed = [['mt_odo', '169166'], ['fuel_fills', JSON.parse(JSON.stringify(FILLS))],
    ['odo_readings', [{ ts: new Date(2026, 9, 13, 12).getTime(), date: '2026-10-13', value: 168510, source: 'seed-fill' }]]];
  const w = makeModuleWorld({ maint: true, seed: seed });
  const M = w.sandbox.Meticulous.modules.maintenance;
  const ms = M._mileageStats();
  eq('lifetime legs: the 3 real ones (the poisoned stamp forms none)', ms.legs, 3);
  eq('leg distance: real legs only', Math.round(ms.kmTracked), 249 + 177 + 230);
  near('leg litres (economy basis)', ms.legLitres, 100 + 72 + 88.106, 1e-9);
  near('lifetime fuel counts EVERY fill-up — the poisoned fill still burned diesel', ms.totalLitres, 94.522 + 100 + 72 + 78.175 + 88.106, 1e-9);
  eq('lifetime fill count', ms.fillCount, 5);
  eq('the records span opens at the first fill', ms.firstFillDate, '2026-10-13');
  eq('the records span closes at the last fill', ms.lastFillDate, '2026-10-16');
  near('the leg economy stays the leg average (avgKpl) — it is the legs line’s figure now', ms.avgKpl, 656 / 260.106, 1e-9);
  const lt156 = M._lifetimeStats();
  eq('v156: the bookend distance coincides with the leg span in this world', Math.round(lt156.distance), 656);
  near('v156: the lifetime economy is distance ÷ every litre in the window', lt156.economy, 656 / 432.803, 1e-9);

  M.render(w.body);
  const h = w.body._html;
  ok('the card shows Lifetime distance', h.indexOf('Lifetime distance') >= 0 && h.indexOf('656') >= 0);
  ok('the card shows Lifetime fuel (432.8 L)', h.indexOf('Lifetime fuel') >= 0 && h.indexOf('432.8 L') >= 0);
  ok('the card shows Lifetime economy', h.indexOf('Lifetime economy') >= 0);
  /* v163 SUPERSEDES this v127 pin: the owner ordered the
     "Between fill-ups (legs)" line DELETED (Oct 18, 2026 20:56
     MDT) — it must not appear on the face at all. */
  ok('v163: the legs line is deleted from the face', h.indexOf('Between fill-ups (legs)') < 0);
  ok('the span is labelled honestly (records, first → last, count, bookend basis)',
    h.indexOf('2026-10-13 → 2026-10-16 (5 fill-ups)') >= 0 &&
    h.indexOf('Distance runs from your earliest odometer reading') >= 0 &&
    h.indexOf('fuel counts every fill-up') >= 0);

  const w2 = makeModuleWorld({ maint: true, seed: seed.concat([['mt_econUnit', 'mpg']]) });
  w2.sandbox.Meticulous.modules.maintenance.render(w2.body);
  ok('the lifetime economy prints in the chosen unit (1.52 km/L → 3.6 MPG)',
    w2.body._html.indexOf('Lifetime economy') >= 0 && w2.body._html.indexOf('3.6 MPG') >= 0,
    w2.body._html.slice(w2.body._html.indexOf('Lifetime economy'), w2.body._html.indexOf('Lifetime economy') + 120));
}

/* ============ (b) THE STICKER SECTION IN MAINTENANCE ============ */
function partB() {
  console.log('\n— (b) Maintenance sticker section: snap → read → confirm → save —');
  ok('static: the card exists', mtSrc.indexOf('🛡️ Annual safety inspection') >= 0);
  ['mt_safety_cam', 'mt_safety_pick', 'mt_safety_cam_in', 'mt_safety_in', 'mt_safety_prev', 'mt_safety_status', 'mt_safety', 'mt_safety_save']
    .forEach(function (id) { ok('static: markup has #' + id, mtSrc.indexOf('id="' + id + '"') >= 0); });
  ok('static: wired fill-only through the shared pipeline, maintenance origin',
    mtSrc.indexOf("App._wirePhotoOCR('mt_safety', 'safety', function () {}, { origin: { module: 'maintenance', label: 'Maintenance' } })") >= 0);

  const w = makeModuleWorld({
    maint: true,
    seed: [['mt_odo', '169166'], ['onboarding', { safetyExpiry: '2027-05-01', payStandard: 'Hourly', payRate: 29 }]]
  });
  const M = w.sandbox.Meticulous.modules.maintenance;
  M.render(w.body);
  const safetyWire = w.wireCalls.filter(function (c) { return c[0] === 'mt_safety'; });
  eq('render wires the sticker field once', safetyWire.length, 1);
  eq('…with the safety kind', safetyWire.length && safetyWire[0][1], 'safety');
  eq('…labelled with the maintenance origin', safetyWire.length && safetyWire[0][3] && safetyWire[0][3].origin.module, 'maintenance');
  ok('confirm-first: rendering + wiring wrote NO sticker date', w.store.get('mt_annualDate', '') === '' || w.store.get('mt_annualDate', '') === undefined,
    JSON.stringify(w.store.get('mt_annualDate', '(unset)')));
  eq('…and the onboarding mirror is untouched', w.store.get('onboarding', {}).safetyExpiry, '2027-05-01');

  w.body.querySelector('#mt_safety').value = '2027-05-31';
  w.body.querySelector('#mt_safety_save').click();
  eq('Save writes mt_annualDate', w.store.get('mt_annualDate', ''), '2027-05-31');
  eq('Save mirrors onboarding.safetyExpiry (the v118 two-store rule)', w.store.get('onboarding', {}).safetyExpiry, '2027-05-31');
}

/* ============ (h2) ADD A PAST READING ============ */
let pastLog = null;
function partH2() {
  console.log('\n— (h2) the past-reading door: chosen timestamp, audited path, master untouched —');
  ok('static: the quiet door exists', mtSrc.indexOf('＋ Add a past reading') >= 0);
  ['mt_past_date', 'mt_past_time', 'mt_past_val', 'mt_past_save', 'mt_past_note'].forEach(function (id) {
    ok('static: markup has #' + id, mtSrc.indexOf('id="' + id + '"') >= 0);
  });
  ok('static: the write goes through _logOdoReading with the correction flag',
    mtSrc.indexOf("App._logOdoReading(v, 'past', ts, true)") >= 0);

  const w = makeModuleWorld({ maint: true, seed: [['mt_odo', '169300']] });
  const M = w.sandbox.Meticulous.modules.maintenance;
  M.render(w.body);
  function addPast(date, time, val) {
    w.body.querySelector('#mt_past_date').value = date;
    w.body.querySelector('#mt_past_time').value = time;
    w.body.querySelector('#mt_past_val').value = val;
    w.body.querySelector('#mt_past_save').click();
  }
  addPast('2026-10-15', '19:26', '168936'); /* below today's master — history, by design */
  let log = w.store.get('odo_readings', []);
  eq('the past reading landed', log.length, 1);
  eq('…with its chosen timestamp', log[0].ts, new Date(2026, 9, 15, 19, 26).getTime());
  eq('…on its chosen date', log[0].date, '2026-10-15');
  eq('…carrying the past source', log[0].source, 'past');
  eq('…at its value', log[0].value, 168936);
  eq('the master was NOT touched by the log write', w.store.get('mt_odo', ''), '169300');
  ok('the note confirms the entry', w.body.querySelector('#mt_past_note').innerHTML.indexOf('Recorded') >= 0);

  addPast('2026-10-14', '19:26', '168759');
  log = w.store.get('odo_readings', []);
  eq('a second past reading lands too (the box stays open)', log.length, 2);

  addPast('2026-10-14', '19:26', '168759');
  log = w.store.get('odo_readings', []);
  eq('the same reading again adds nothing', log.length, 2);
  ok('…and the note says it is already recorded', w.body.querySelector('#mt_past_note').innerHTML.indexOf('already recorded') >= 0);
  pastLog = log;
}

/* ============ manifest world (manifest-odo harness pattern) ============ */
function makeManBody() {
  const body = { _html: '', _btns: {} };
  body._date = { value: '', onchange: null };
  function rebuild() {
    body._toggles = [];
    const re = /data-tg="([^"]+)"( checked)?/g;
    let m;
    while ((m = re.exec(body._html))) {
      const key = m[1];
      body._toggles.push({ checked: !!m[2], onchange: null, getAttribute: function (n) { return n === 'data-tg' ? key : null; } });
    }
    const dm = body._html.match(/id="mn_date" value="([^"]+)"/);
    body._date.value = dm ? dm[1] : '';
  }
  Object.defineProperty(body, 'innerHTML', {
    get: function () { return body._html; },
    set: function (v) { body._html = v; rebuild(); }
  });
  body._msg = { textContent: '' };
  body.querySelector = function (sel) {
    if (sel === '#mn_date') return body._date;
    if (sel === '#mn_msg') return body._msg;
    return body._btns[sel] || (body._btns[sel] = { onclick: null });
  };
  body.querySelectorAll = function (sel) { return sel === '[data-tg]' ? body._toggles : []; };
  return body;
}
function manFixture(day) {
  return {
    mani_date: day,
    onboarding: { payStandard: 'Hourly', payRate: 29 },
    dsp_list: [], nav_log: [], fuel_fills: [], fuel_expenses: [], dmg_reports: [],
    sessions: [], rev_entries: [], rev_extras: [],
    tracker: { status: 'idle', startTs: 0, elapsed: 0 }
  };
}
function makeManWorld(mem, today) {
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const captured = { doc: null };
  const sandbox = {
    console: console, setTimeout: setTimeout, Promise: Promise,
    App: {
      _store: store, _esc: escFn,
      _today: function () { return today; },
      tracker: mem.tracker || null
    },
    Meticulous: {
      modules: {},
      /* the shared revenue builder, stubbed at its boundary: it
         prices the day's confirmed entries at qty × rate (its own
         dedup/pricing math is pinned by money-truth-test). */
      shared: {
        buildRevenueLines: function (entries, extras, rate) {
          return {
            lines: (entries || []).map(function (e) { return { amt: (parseFloat(e.hours) || 0) * rate, src: 'entry' }; }),
            duplicateDates: []
          };
        }
      }
    },
    MetPdf: {
      isNativeShell: function () { return false; },
      savePdf: function (doc) { captured.doc = doc; return Promise.resolve({ message: 'ok' }); }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(manSrc, sandbox, { filename: 'modules/manifest.js' });
  const body = makeManBody();
  return {
    body: body,
    render: function () { sandbox.Meticulous.modules.manifest.render(body); },
    pdfLines: function () { body.querySelector('#mn_dl').onclick(); return captured.doc ? captured.doc.lines : []; }
  };
}

/* ============ (g) THE INCOME LABEL ============ */
function partG() {
  console.log('\n— (g) manifest income label: live vs closed, both renderers —');
  {
    const mem = manFixture('2026-10-17');
    mem.tracker = { status: 'paused', startTs: Date.now(), elapsed: 7200 }; /* 2 h in, shift still open */
    const w = makeManWorld(mem, '2026-10-17');
    w.render();
    ok('preview (live): "Income earned today so far"', w.body._html.indexOf('<span>Income earned today so far</span><b>$58.00</b>') >= 0,
      w.body._html.slice(w.body._html.indexOf('Income earned'), w.body._html.indexOf('Income earned') + 90));
    ok('preview (live): no earned ROW carries the closed-day label (the sections-toggle name may stay)',
      w.body._html.indexOf('<div class="kv"><span>Total Earned Income</span>') < 0);
    const kv = w.pdfLines().filter(function (l) { return l.k === 'kv' && /Income/.test(l.a); })[0];
    ok('pdf (live): the same so-far label', !!kv && kv.a === 'Income earned today so far' && kv.b === '$58.00', JSON.stringify(kv));
  }
  {
    const mem = manFixture('2026-10-17');
    mem.tracker = { status: 'running', startTs: Date.now() - 2 * 3600 * 1000, elapsed: 0 };
    const w = makeManWorld(mem, '2026-10-17');
    w.render();
    ok('preview (running): the so-far label too', w.body._html.indexOf('Income earned today so far') >= 0);
  }
  {
    const mem = manFixture('2026-10-15');
    mem.sessions = [{ date: '2026-10-15', endedAt: Date.parse('2026-10-15T18:30:00'), seconds: 36000, startOdo: 168759, endOdo: 168936 }];
    mem.rev_entries = [{ date: '2026-10-15', hours: 10 }];
    const w = makeManWorld(mem, '2026-10-17');
    w.render();
    ok('preview (closed): "Total Earned Income"', w.body._html.indexOf('<span>Total Earned Income</span><b>$290.00</b>') >= 0,
      w.body._html.slice(w.body._html.indexOf('Total Earned'), w.body._html.indexOf('Total Earned') + 90));
    ok('preview (closed): no so-far wording', w.body._html.indexOf('so far') < 0);
    const kv = w.pdfLines().filter(function (l) { return l.k === 'kv' && /Income/.test(l.a); })[0];
    ok('pdf (closed): the same total label', !!kv && kv.a === 'Total Earned Income' && kv.b === '$290.00', JSON.stringify(kv));
  }
}

/* ============ (h3) PAST READINGS MOVE THE RIGHT DAY BOUNDARY ============ */
function partH3() {
  console.log('\n— (h3) the backfilled log bounds the manifest day —');
  ok('the (h2) door produced the log this case consumes', Array.isArray(pastLog) && pastLog.length === 2);
  const mem = manFixture('2026-10-15');
  mem.sessions = [{ date: '2026-10-15', endedAt: Date.parse('2026-10-15T17:45:00'), seconds: 35100 }];
  mem.dsp_list = [{ date: '2026-10-15', scheduledAt: '2026-10-15T08:00:00', status: 'completed', endedAt: Date.parse('2026-10-15T17:45:00'), tickets: [] }];
  mem.odo_readings = JSON.parse(JSON.stringify(pastLog || []));
  const w = makeManWorld(mem, '2026-10-17');
  w.render();
  ok('preview: Oct 15 opens at last night\'s backfilled reading and closes at tonight\'s',
    w.body._html.indexOf('<span>Odometer</span><b>168,759 → 168,936 km (177 km)</b>') >= 0,
    w.body._html.slice(w.body._html.indexOf('Odometer'), w.body._html.indexOf('Odometer') + 120));
  const kv = w.pdfLines().filter(function (l) { return l.k === 'kv' && l.a === 'Odometer'; })[0];
  ok('pdf: the same boundaries', !!kv && kv.b === '168,759 → 168,936 km (177 km)', JSON.stringify(kv));
}

(async function main() {
  await partA();
  partD();
  partH1();
  partC();
  await partF();
  partE();
  partB();
  partH2();
  partG();
  partH3();
  console.log('\ncapture-v127: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('FAIL harness error: ' + (e && e.stack || e)); process.exit(1); });
