'use strict';
/*
 * fuel-list-photos-nov10-test.js — FUEL-LIST-PHOTOS-NOV10 (owner,
 * Nov 10, 2026, 09:33 CST): "I want the pictures on the fuel
 * records itself." The Fuel & Expense Fill-ups list rows carried
 * NO picture — a fill's receipt photo showed only inside the
 * record's detail view, so on the list a photo-carrying record
 * looked exactly like a photo-less one (his 09:10 screenshot:
 * "why are my fuel receipts not uploaded pictures to my
 * records?"). The expense rows have worn the photo on the row
 * since v346 (fxRowHTML); the fill rows never got the same dress.
 *
 * The fix (modules/fuel.js only): a fill row whose record
 * carries a receipt photo shows the record's OWN stored first
 * receipt as the same 46px thumbnail the expense rows wear
 * (fillThumbHTML, bound through fillPhotos — the one stack
 * reader, v332 — so photo / photos / photo2 shapes all bind).
 * No new image payload is made or stored; the row binds the
 * rendition already in the record. A photo-less fill's row is
 * byte-for-byte the row it has always been.
 *
 * RED on web-397 bytes: the photo / stack / photo2 rows carry
 * no <img> at all. GREEN after the fix: each photo shape's row
 * binds its first receipt; the photo-less row is untouched;
 * both list surfaces (the face list + the module's Audit list,
 * which build the same row) agree; the row still opens the
 * same detail view.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const fuelSrc = read('modules/fuel.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

/* The web version this fix ships as — set at ship time. */
const SHIP_WEB = 399;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

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

const PH_A = 'data:image/jpeg;base64,RECEIPT_A_SINGLE';
const PH_B1 = 'data:image/jpeg;base64,RECEIPT_B_FIRST';
const PH_B2 = 'data:image/jpeg;base64,RECEIPT_B_SECOND';
const PH_C = 'data:image/jpeg;base64,RECEIPT_C_PHOTO2';

/* The owner's book shapes, through the store the module itself
 * reads: a lone `photo`, a `photos` stack (photo = first), a
 * stray `photo2`, and a fill with no photo at all. */
function seedFills() {
  return [
    { date: '2026-11-09', time: '13:24', litres: 80.29, cost: 172.54, station: 'Mobil Country Village', odo: 172051, photo: PH_A, read: 'power' },
    { date: '2026-11-08', time: '18:56', litres: 65.907, cost: 142.29, station: 'Mobil Westwinds', odo: 172228, photo: PH_B1, photos: [PH_B1, PH_B2], read: 'power' },
    { date: '2026-11-07', time: '09:10', litres: 50, cost: 110, station: 'Petro-Canada', odo: 171900, photo2: PH_C, read: 'power' },
    { date: '2026-11-06', time: '08:00', litres: 40, cost: 88, station: 'Mobil', odo: 171700, read: 'power' }
  ];
}

function makeWorld() {
  const data = {
    onboarding: { payStandard: 'Hourly', ownWageRate: 29, travelBonus: 0 },
    fuel_fills: seedFills(), fuel_expenses: [], tracker: { status: 'idle' }
  };
  const store = {
    get: function (k, d) { return (k in data) ? data[k] : d; },
    set: function (k, v) { data[k] = v; return true; },
    del: function (k) { delete data[k]; return true; }
  };
  const els = {};
  const body = makeEl();
  body.querySelector = function (sel) { if (!els[sel]) els[sel] = makeEl(); return els[sel]; };
  const rowEls = data.fuel_fills.map(function (f, i) { const e = makeEl(); e.setAttribute('data-fuedit', String(i)); return e; });
  body.querySelectorAll = function (sel) { return sel === '[data-fuedit]' ? rowEls : []; };
  function FakeFileReader() {}
  FakeFileReader.prototype.readAsDataURL = function () {};
  const sb = {
    console: console, Date: Date, Math: Math, JSON: JSON, Promise: Promise, setTimeout: setTimeout,
    FileReader: FakeFileReader,
    App: {
      _store: store,
      _today: function () { return '2026-11-10'; },
      _esc: function (s) { return String(s == null ? '' : s); },
      openModule: function () {},
      _photoDl: function () { return ''; },
      _masterOdometer: function () { return 172236; },
      _logOdoReading: function () {}
    },
    Meticulous: { modules: {} },
    TicketOCR: {
      fileToOCRImage: function (file, cb) { cb(''); },
      recognizeWithRotation: function () { return Promise.resolve(''); },
      parseFuelReceipt: function () { return {}; },
      describeFuelRead: function () { return { found: [], missing: [] }; },
      shrinkDataUrl: function (u, max, cb) { cb(u); }
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fuelSrc, sb, { filename: 'modules/fuel.js' });
  return { api: sb.Meticulous.modules.fuel, body: body, els: els, data: data, rowEls: rowEls };
}
const tick = () => new Promise(function (r) { setTimeout(r, 25); });

/* Split a rendered list face into rows keyed by the fill's real
 * index (the data-fuedit the tap wiring uses). */
function rowsByIndex(html) {
  const out = {};
  const parts = String(html).split('<div class="listitem" data-fuedit="');
  for (let i = 1; i < parts.length; i++) {
    const idx = parts[i].slice(0, parts[i].indexOf('"'));
    out[idx] = parts[i];
  }
  return out;
}
const THUMB_DRESS = 'width:46px;height:46px;object-fit:cover;border-radius:8px';

function assertRows(label, html) {
  const rows = rowsByIndex(html);
  ok(label + ': all four fills render a row', Object.keys(rows).length === 4, Object.keys(rows).join(','));
  ok(label + ': the lone-photo row carries an <img>', (rows['0'] || '').indexOf('<img src="' + PH_A + '"') >= 0);
  ok(label + ': the lone-photo thumb wears the shared 46px dress', (rows['0'] || '').indexOf(THUMB_DRESS) >= 0);
  ok(label + ': the stack row binds the FIRST receipt', (rows['1'] || '').indexOf('<img src="' + PH_B1 + '"') >= 0);
  ok(label + ': the stack row does not bind the second receipt', (rows['1'] || '').indexOf('<img src="' + PH_B2 + '"') < 0);
  ok(label + ': the photo2 row binds its photo', (rows['2'] || '').indexOf('<img src="' + PH_C + '"') >= 0);
  ok(label + ': the photo-less row carries NO <img>', (rows['3'] || '').indexOf('<img') < 0);
  ok(label + ': the photo-less row keeps its chevron (renders exactly as today)',
    (rows['3'] || '').indexOf('>›</span>') >= 0);
  ok(label + ': rows still name their facts (litres/date/station)',
    (rows['0'] || '').indexOf('80.29') >= 0 && (rows['0'] || '').indexOf('Mobil Country Village') >= 0);
}

(async function () {
  const w = makeWorld();
  w.api.render(w.body);
  await tick();

  /* The face list shows the latest 3 until Show more — open it
   * so all four seeded fills are on the face. */
  if (w.els['#fu_more'] && w.els['#fu_more'].onclick) { w.els['#fu_more'].onclick(); await tick(); }
  assertRows('face list', w.body.innerHTML);

  /* The tap still opens the same detail view (the photo record's
   * own page, photo full-size as before). */
  w.rowEls[0].onclick();
  await tick();
  ok('tapping the photo row opens its detail view with the photo full-size',
    w.body.innerHTML.indexOf(PH_A) >= 0 && w.body.innerHTML.indexOf('data-fuedit') < 0);

  /* Back to the face through the detail view's own ‹ Back door
   * (it clears the detail target), then into the module's Audit
   * list — the same row shape's other surface. */
  if (w.els['#fu_det_back'] && w.els['#fu_det_back'].onclick) { w.els['#fu_det_back'].onclick(); await tick(); }
  if (w.els['#fu_audit'] && w.els['#fu_audit'].onclick) { w.els['#fu_audit'].onclick(); await tick(); }
  ok('the Audit surface is showing', w.api._auditView && w.api._auditView() === true);
  assertRows('audit list', w.body.innerHTML);

  /* — pins: no new payload is minted anywhere in the fix — */
  ok('the row binds through the one stack reader (fillThumbHTML rides fillPhotos)',
    fuelSrc.indexOf('function fillThumbHTML(f)') >= 0 &&
    fuelSrc.indexOf('var photos = fillPhotos(f);') >= 0);
  ok('no thumbnail is stored on the record (no thumb field writes)',
    fuelSrc.indexOf('.thumb =') < 0 && fuelSrc.indexOf('thumb:') < 0);
  ok('webVersion is ' + SHIP_WEB, ver.webVersion === SHIP_WEB, 'got ' + ver.webVersion);
  ok('index.html pins fuel.js?v=' + SHIP_WEB, idxSrc.indexOf('modules/fuel.js?v=' + SHIP_WEB) >= 0);

  console.log('\nfuel-list-photos-nov10 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR ' + (e && e.stack || e)); process.exit(1); });
