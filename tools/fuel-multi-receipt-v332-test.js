'use strict';
/*
 * fuel-multi-receipt-v332-test.js — FUEL-MULTI-RECEIPT (owner,
 * Nov 4, 2026, at the pump): he often has TWO receipts for one
 * fill (Nov 4 Shell: $250.00 / 105.087 L at 19:09 + $36.57 /
 * 15.370 L at 19:15, same pump, same $2.379/L) and asked to
 * report them TOGETHER as one fuel entry with both receipts as
 * the record.
 *
 * Pins:
 *  - fillPhotos: the one stack reader (photos array wins, then
 *    photo, then a stray photo2; deduped, ordered).
 *  - the form carries the "Add another receipt" door + the
 *    plain-words note.
 *  - adding receipt 2 ADDS its litres + cost into the form
 *    totals at receipt precision (105.087 + 15.370 = 120.457;
 *    250.00 + 36.57 = 286.57 — the real Nov 4 numbers).
 *  - the saved record is ONE entry: combined totals, photo =
 *    the first receipt, photos = both.
 *  - the details view stacks BOTH photos.
 *  - an edit-save keeps the stack whole.
 *
 * THEN: webVersion is 332 + the index fuel.js tag.
 */
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
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
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

const R1_TEXT = ['Shell', '2026-11-04 19:09', 'Pump 4  DIESEL', '105.087 L', 'PRICE/L  2.379', 'TOTAL $250.00'].join('\n');
const R2_TEXT = ['Shell', '2026-11-04 19:15', 'Pump 4  DIESEL', '15.370 L', 'PRICE/L  2.379', 'TOTAL $36.57'].join('\n');

function makeWorld() {
  const data = {
    onboarding: { payStandard: 'Hourly', ownWageRate: 29, travelBonus: 0 },
    fuel_fills: [], fuel_expenses: [], tracker: { status: 'idle' }
  };
  const store = {
    get: function (k, d) { return (k in data) ? data[k] : d; },
    set: function (k, v) { data[k] = v; return true; },
    del: function (k) { delete data[k]; return true; }
  };
  const els = {};
  const body = makeEl();
  body.querySelector = function (sel) { if (!els[sel]) els[sel] = makeEl(); return els[sel]; };
  const rowEl = makeEl(); rowEl.setAttribute('data-fuedit', '0');
  body.querySelectorAll = function (sel) { return sel === '[data-fuedit]' ? [rowEl] : []; };
  function FakeFileReader() {}
  FakeFileReader.prototype.readAsDataURL = function (file) {
    const self = this;
    self.result = 'data:' + file.__tag;
    setTimeout(function () { if (self.onload) self.onload(); }, 0);
  };
  const sb = {
    console: console, Date: Date, Math: Math, JSON: JSON, Promise: Promise, setTimeout: setTimeout,
    FileReader: FakeFileReader,
    App: {
      _store: store,
      _today: function () { return '2026-11-04'; },
      _esc: function (s) { return String(s == null ? '' : s); },
      openModule: function () {},
      _photoDl: function () { return ''; },
      _masterOdometer: function () { return 171259; },
      _logOdoReading: function () {}
    },
    Meticulous: { modules: {} },
    TicketOCR: {
      fileToOCRImage: function (file, cb) { cb('data:' + file.__tag); },
      recognizeWithRotation: function (url) {
        return Promise.resolve(url === 'data:r1' ? R1_TEXT : url === 'data:r2' ? R2_TEXT : '');
      },
      parseFuelReceipt: function (text) {
        const L = /([\d.]+)\s*L\b/.exec(text || ''), C = /\$([\d.]+)/.exec(text || '');
        return { litres: L ? L[1] : null, cost: C ? C[1] : null, station: 'Shell', date: '2026-11-04', time: '19:09' };
      },
      describeFuelRead: function () { return { found: [], missing: [] }; }
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fuelSrc, sb, { filename: 'modules/fuel.js' });
  return { api: sb.Meticulous.modules.fuel, body: body, els: els, data: data, rowEl: rowEl };
}
const tick = () => new Promise(function (r) { setTimeout(r, 25); });

(async function () {
  /* — the stack reader — */
  const w0 = makeWorld();
  const fp = w0.api._fillPhotos;
  eq('a photos stack reads whole, in order', fp({ photos: ['a', 'b'], photo: 'a' }), ['a', 'b']);
  eq('a lone photo reads as a stack of one', fp({ photo: 'a' }), ['a']);
  eq('a stray photo2 is honoured', fp({ photo2: 'b' }), ['b']);
  eq('photo + photo2 stack', fp({ photo: 'a', photo2: 'b' }), ['a', 'b']);
  eq('duplicates collapse', fp({ photos: ['a', 'a', 'b'], photo: 'a' }), ['a', 'b']);
  eq('no photo at all → empty', fp({}), []);
  eq('a null record → empty', fp(null), []);

  /* — the form + the combine flow — */
  const w = makeWorld();
  w.api.render(w.body);
  ok('the form carries the Add-another-receipt door',
    w.body.innerHTML.indexOf('id="fu_add2"') >= 0 && w.body.innerHTML.indexOf('Add the second receipt here') >= 0);
  w.els['#fu_date'].value = '2026-11-04';
  /* receipt 1 through the primary door */
  w.els['#fu_img'].files = [{ __tag: 'r1' }];
  w.els['#fu_img'].onchange({ target: w.els['#fu_img'] });
  await tick(); await tick();
  eq('receipt 1 filled the litres', parseFloat(w.els['#fu_l'].value), 105.087);
  eq('receipt 1 filled the cost', parseFloat(w.els['#fu_cost'].value), 250);
  /* receipt 2 through the new door */
  w.els['#fu_img2'].files = [{ __tag: 'r2' }];
  w.els['#fu_img2'].onchange({ target: w.els['#fu_img2'] });
  await tick(); await tick();
  eq('receipt 2 ADDED its litres (120.457 — the Nov 4 total)', parseFloat(w.els['#fu_l'].value), 120.457);
  eq('receipt 2 ADDED its cost (286.57 — the Nov 4 total)', parseFloat(w.els['#fu_cost'].value), 286.57);
  ok('the read-back names the addition', w.els['#fu_read'].innerHTML.indexOf('Receipt added') >= 0 && w.els['#fu_read'].innerHTML.indexOf('15.37') >= 0, w.els['#fu_read'].innerHTML);
  ok('the extra receipt thumb is painted', w.els['#fu_prev_extra'].innerHTML.indexOf('data:r2') >= 0);

  /* — the save: ONE entry, both photos — */
  w.els['#fu_add'].onclick();
  await tick();
  eq('exactly ONE fill was saved', w.data.fuel_fills.length, 1);
  const rec = w.data.fuel_fills[0] || {};
  eq('the saved litres are the combined total', parseFloat(rec.litres), 120.457);
  eq('the saved cost is the combined total', parseFloat(rec.cost), 286.57);
  eq('photo is the first receipt', rec.photo, 'data:r1');
  eq('photos carries BOTH receipts', rec.photos, ['data:r1', 'data:r2']);

  /* — the details view stacks both — */
  w.rowEl.onclick();
  await tick();
  ok('details show receipt 1', w.body.innerHTML.indexOf('data:r1') >= 0);
  ok('details show receipt 2 stacked under it', w.body.innerHTML.indexOf('data:r2') >= 0);

  /* — an edit-save keeps the stack whole — */
  w.els['#fu_det_edit'].onclick();
  await tick();
  ok('the edit form preloads the extra receipt', w.els['#fu_prev_extra'].innerHTML.indexOf('data:r2') >= 0);
  w.els['#fu_add'].onclick();
  await tick();
  eq('still ONE fill after the edit', w.data.fuel_fills.length, 1);
  eq('the stack survived the edit', (w.data.fuel_fills[0] || {}).photos, ['data:r1', 'data:r2']);
  eq('the combined totals survived the edit', parseFloat((w.data.fuel_fills[0] || {}).litres), 120.457);

  /* — pins — */
  ok('the record writes photo + photos on the add path',
    fuelSrc.indexOf('var newStack = fillPhotos({ photo: fuPhoto || null, photos: fuExtraPhotos });') >= 0);
  ok('the edit path merges onto the entry\'s own stack',
    fuelSrc.indexOf('var mergedStack = fillPhotos(f[editFillIdx]);') >= 0);
  eq('webVersion is 332', ver.webVersion, 332);
  ok('index.html pins fuel.js?v=332', idxSrc.indexOf('modules/fuel.js?v=332') >= 0);

  console.log('\nfuel-multi-receipt-v332 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR ' + (e && e.stack || e)); process.exit(1); });
