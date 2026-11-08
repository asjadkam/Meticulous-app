#!/usr/bin/env node
/* Meticulous v347 — EXPENSE-ADD-FORM-DROPS-PHOTO.
 *
 * Found Nov 5, 2026 23:01 by the v346 build: in modules/fuel.js
 * the Other-expenses ADD form previewed and OCR-read the receipt
 * photo, but its save wrote only { what, cost, date } — the photo
 * was silently dropped. The fill-up form has saved its photo
 * since v127; the expense form never did, so every expense the
 * owner added himself through that form carries no receipt even
 * though he took the picture.
 *
 * Fix (modules/fuel.js, wireFx): the form now holds the photo
 * (fxPhoto — the 1600px OCR rendition from fileToOCRImage, the
 * exact rendition fuPhoto keeps) and Add writes it on the record
 * as `photo` — the first-receipt field the one v332 fillPhotos
 * reader reads, the shape the fill-up save writes — so the saved
 * expense paints its thumbnail in both expense lists and opens
 * through the v346 tap view, and syncs inside the record the way
 * fill-up photos do. The save is verified (saveExpensesVerified,
 * the v48 rule beside saveFillsVerified): if the photo is what
 * didn't fit, it retries ONCE without it and says so — the entry
 * always saves; if even that fails, the form stays open with a
 * plain did-NOT-save message instead of silently losing it.
 * No photo attached → the record is byte-for-byte the old one.
 *
 * Run: node tools/expense-add-photo-v347-test.js
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
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }

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

const FXPHOTO = 'data:image/jpeg;base64,FXRECEIPT';

/* mode: 'ok' stores everything; 'photoWontFit' silently refuses
   any fuel_expenses write whose payload carries the photo (the
   quota failure the verified save exists to catch);
   'neverStores' refuses every fuel_expenses write. */
function makeWorld(mode) {
  const data = { onboarding: { payStandard: 'Hourly', ownWageRate: 29, travelBonus: 0 }, fuel_fills: [], tracker: { status: 'idle' }, fuel_expenses: [] };
  /* the real App._store is localStorage-backed: get returns a
     fresh JSON.parse copy, set stringifies — model exactly
     that, or the verified save has nothing to verify against. */
  const store = {
    get: function (k, d) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : d; },
    set: function (k, v) {
      if (k === 'fuel_expenses' && mode === 'neverStores') return true;
      if (k === 'fuel_expenses' && mode === 'photoWontFit' && JSON.stringify(v).indexOf('FXRECEIPT') >= 0) return true;
      data[k] = JSON.parse(JSON.stringify(v)); return true;
    },
    del: function (k) { delete data[k]; return true; }
  };
  const els = {};
  const body = makeEl();
  body.querySelector = function (sel) { if (!els[sel]) els[sel] = makeEl(); return els[sel]; };
  let lastFxRows = [];
  body.querySelectorAll = function (sel) {
    if (sel !== '[data-fxphoto]') return [];
    lastFxRows = [];
    const re = /data-fxphoto="(\d+)"/g;
    let m;
    while ((m = re.exec(body.innerHTML))) {
      const el = makeEl();
      el.setAttribute('data-fxphoto', m[1]);
      lastFxRows.push(el);
    }
    return lastFxRows;
  };
  function FileReaderStub() {}
  FileReaderStub.prototype.readAsDataURL = function () {
    this.result = 'data:image/jpeg;base64,RAWPREVIEW';
    if (this.onload) this.onload();
  };
  const sb = {
    console: console, Date: Date, Math: Math, JSON: JSON, Promise: Promise, setTimeout: setTimeout,
    FileReader: FileReaderStub,
    TicketOCR: {
      fileToOCRImage: function (file, cb) { cb(FXPHOTO); },
      recognizeWithRotation: function () { return Promise.resolve('MALWA TIRES TOTAL 294.00'); },
      parseExpenseReceipt: function () { return { total: '294', vendor: 'Malwa Tires & Services', date: '2026-11-02' }; },
      describeExpenseRead: function () { return { found: ['Malwa Tires & Services', '$294'], missing: [] }; }
    },
    App: {
      _store: store,
      _today: function () { return '2026-11-05'; },
      _esc: function (s) { return String(s == null ? '' : s); },
      openModule: function () {},
      _photoDl: function (p, label) { return '<button data-photodl-stub="' + label + '">dl</button>'; },
      _masterOdometer: function () { return 171497; },
      _logOdoReading: function () {}
    },
    Meticulous: { modules: {} }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fuelSrc, sb, { filename: 'modules/fuel.js' });
  return { api: sb.Meticulous.modules.fuel, body: body, els: els, data: data, rows: function () { return lastFxRows; } };
}

function openFxView(w) {
  w.api.render(w.body);
  w.els['#fx_tab'].onclick();
}
/* attach, then let the receipt read settle — in the app the
   read lands long before Add is tapped; fxOcrDate rides it. */
async function attachPhoto(w) {
  const cam = w.els['#fx_img_cam'];
  cam.files = [{ name: 'receipt.jpg' }];
  cam.onchange({ target: cam });
  await new Promise(function (r) { setTimeout(r, 0); });
}

(async function () {
/* — (a) adding an expense WITH a photo saves the photo — */
{
  const w = makeWorld('ok');
  openFxView(w);
  await attachPhoto(w);
  w.els['#fx_what'].value = 'Malwa Tires & Services';
  w.els['#fx_cost'].value = '294';
  w.els['#fx_add'].onclick();
  eq('one expense was saved', w.data.fuel_expenses.length, 1);
  const rec = w.data.fuel_expenses[0];
  eq('the saved record carries the receipt photo as `photo` (the fill-up shape)', rec.photo, FXPHOTO);
  ok('a single receipt writes no `photos` stack (the fill-up v332 shape)', !('photos' in rec));
  eq('the what/cost ride as before', [rec.what, rec.cost], ['Malwa Tires & Services', '294']);
  eq('the OCR-read date still lands on the record', rec.date, '2026-11-02');

  /* — (b) the saved expense shows + opens in the list — */
  let h = w.body.innerHTML;
  ok('the re-painted list row is tappable', h.indexOf('data-fxphoto="0"') >= 0, h.slice(h.indexOf('fx_list'), h.indexOf('fx_list') + 300));
  ok('the row shows the saved photo as its thumbnail', h.indexOf('<img src="' + FXPHOTO + '"') >= 0);
  ok('the row says tap to view at first glance', h.indexOf('📷 Receipt photo — tap to view ›') >= 0);
  const row = w.rows().filter(function (el) { return el.getAttribute('data-fxphoto') === '0'; })[0];
  row.onclick();
  eq('the tap opens the just-saved expense', w.api._fxPhotoIdx(), 0);
  h = w.body.innerHTML;
  ok('the saved invoice photo opens full-width', h.indexOf('<img src="' + FXPHOTO + '" style="width:100%') >= 0);
  ok('the open view carries the download door', h.indexOf('data-photodl-stub="expense-receipt-2026-11-02"') >= 0);
  eq('shell Back closes the photo view', w.api.back(), true);

  /* — (b2) and in the Audit list too — */
  w.els['#fx_back'].onclick();
  w.api.render(w.body);
  w.els['#fu_audit'].onclick();
  h = w.body.innerHTML;
  ok('the Audit expenses list shows the saved photo row tappable',
    h.indexOf('Audit — Other expenses') >= 0 && h.indexOf('data-fxphoto="0"') >= 0 && h.indexOf('<img src="' + FXPHOTO + '"') >= 0);
  const aRow = w.rows().filter(function (el) { return el.getAttribute('data-fxphoto') === '0'; })[0];
  aRow.onclick();
  eq('a tap from Audit opens the saved photo', w.api._fxPhotoIdx(), 0);
  w.api.back();
}

/* — (c) an expense added WITHOUT a photo stays photo-less — */
{
  const w = makeWorld('ok');
  openFxView(w);
  w.els['#fx_what'].value = 'Wash';
  w.els['#fx_cost'].value = '52.50';
  let threw = false;
  try { w.els['#fx_add'].onclick(); } catch (e) { threw = true; }
  ok('the photo-less add never errors', !threw);
  eq('one expense was saved', w.data.fuel_expenses.length, 1);
  const rec = w.data.fuel_expenses[0];
  eq('the record is exactly the pre-v347 shape', rec, { what: 'Wash', cost: '52.50', date: '2026-11-05' });
  const h = w.body.innerHTML;
  ok('its row stays plain — no tap, no thumbnail', h.indexOf('Wash — $52.50') >= 0 && !/data-fxphoto=/.test(h));
}

/* — the photo doesn't fit: entry saves without it, said out loud — */
{
  const w = makeWorld('photoWontFit');
  openFxView(w);
  await attachPhoto(w);
  w.els['#fx_what'].value = 'Coolant';
  w.els['#fx_cost'].value = '42.99';
  w.els['#fx_add'].onclick();
  eq('the expense still saved', w.data.fuel_expenses.length, 1);
  ok('it saved without the photo that didn\'t fit', !('photo' in w.data.fuel_expenses[0]) && !('photos' in w.data.fuel_expenses[0]));
  /* web 370 wording: the photo is no longer lost when it doesn't
     fit — it is kept in the account copy — so the note says that;
     the law this pin guards (the shed is SAID, never silent) is
     unchanged. */
  ok('the drop is said out loud, never silent', w.els['#fx_read'].innerHTML.indexOf('Expense saved') >= 0 && w.els['#fx_read'].innerHTML.indexOf("kept in your account copy") >= 0, w.els['#fx_read'].innerHTML);
}

/* — the write fails entirely: form stays open, nothing silently lost — */
{
  const w = makeWorld('neverStores');
  openFxView(w);
  await attachPhoto(w);
  w.els['#fx_what'].value = 'Coolant';
  w.els['#fx_cost'].value = '42.99';
  w.els['#fx_add'].onclick();
  eq('nothing was saved', w.data.fuel_expenses.length, 0);
  ok('a plain did-NOT-save message shows', w.els['#fx_read'].innerHTML.indexOf('did NOT save') >= 0, w.els['#fx_read'].innerHTML);
  eq('the typed entry is still in the form', [w.els['#fx_what'].value, w.els['#fx_cost'].value], ['Coolant', '42.99']);
}

/* — pins — */
eq('webVersion is 347', ver.webVersion, 347);
ok('index.html pins fuel.js?v=347', idxSrc.indexOf('modules/fuel.js?v=347') >= 0);

console.log('\nexpense-add-photo-v347: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL suite threw: ' + (e && e.stack || e)); process.exit(1); });
