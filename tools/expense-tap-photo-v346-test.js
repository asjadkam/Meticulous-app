#!/usr/bin/env node
/* Meticulous v346 — EXPENSE-TAP-OPENS-RECEIPT.
 *
 * Owner (Nov 5, 2026 22:53, with a screen recording): in Fuel &
 * Expense → Other expenses, the entries are not tappable —
 * tapping the Malwa Tires entry ($294, which HAS its invoice
 * photo attached) does nothing. He should tap an expense and
 * have its invoice/receipt picture open up.
 *
 * Fix (modules/fuel.js): an expense row that carries a receipt
 * photo (the record's photo / photos stack, read by the one
 * v332 fillPhotos reader) now paints with the photo itself as
 * a thumbnail + a "📷 Receipt photo — tap to view ›" line —
 * first-glance obvious — and the tap opens the expense photo
 * view: the entry's facts and EVERY photo full-width with the
 * App._photoDl door, the exact pattern of the fill-up details
 * view / Documents / Damage. Back returns to the list the tap
 * came from (Other-expenses view or the Audit list — both
 * expense lists carry the same tappable rows). An expense with
 * no photo keeps its plain row, untappable, unchanged.
 *
 * Run: node tools/expense-tap-photo-v346-test.js
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

const MALWA = 'data:image/jpeg;base64,MALWAINVOICE';
const DEF1 = 'data:image/jpeg;base64,DEFONE';
const DEF2 = 'data:image/jpeg;base64,DEFTWO';

function makeWorld() {
  const data = {
    onboarding: { payStandard: 'Hourly', ownWageRate: 29, travelBonus: 0 },
    fuel_fills: [], tracker: { status: 'idle' },
    fuel_expenses: [
      { what: 'Wash', cost: '52.50', date: '2026-11-04' },
      { what: 'Malwa Tires & Services', cost: '294', date: '2026-11-05', photo: MALWA },
      { what: 'DEF (Petro-Canada Langdon)', cost: '31.69', date: '2026-11-03', photos: [DEF1, DEF2] }
    ]
  };
  const store = {
    get: function (k, d) { return (k in data) ? data[k] : d; },
    set: function (k, v) { data[k] = v; return true; },
    del: function (k) { delete data[k]; return true; }
  };
  const els = {};
  const body = makeEl();
  body.querySelector = function (sel) { if (!els[sel]) els[sel] = makeEl(); return els[sel]; };
  let lastFxRows = [];
  body.querySelectorAll = function (sel) {
    if (sel !== '[data-fxphoto]') return [];
    /* the rows the CURRENT paint carries: derived from the
       body's own markup, like the real DOM would answer */
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
  const sb = {
    console: console, Date: Date, Math: Math, JSON: JSON, Promise: Promise, setTimeout: setTimeout,
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

const w = makeWorld();
const api = w.api, body = w.body, els = w.els;

/* — the Other-expenses list — */
api.render(body);
ok('the face renders', body.innerHTML.indexOf('fx_tab') >= 0 || !!els['#fx_tab']);
els['#fx_tab'].onclick();
let h = body.innerHTML;
ok('the Malwa row is tappable (data-fxphoto=1)', h.indexOf('data-fxphoto="1"') >= 0, h.slice(h.indexOf('fx_list'), h.indexOf('fx_list') + 300));
ok('the Malwa row shows its photo as a thumbnail', h.indexOf('<img src="' + MALWA + '"') >= 0);
ok('the Malwa row says tap to view at first glance', h.indexOf('📷 Receipt photo — tap to view ›') >= 0);
ok('the DEF row (photos stack) is tappable too', h.indexOf('data-fxphoto="2"') >= 0 && h.indexOf('<img src="' + DEF1 + '"') >= 0);
ok('the photo-less Wash row stays plain — no tap, no thumbnail',
  h.indexOf('Wash') >= 0 && !/data-fxphoto="0"/.test(h) && h.indexOf('Wash — $52.50') >= 0);
eq('no photo view is open yet', api._fxPhotoIdx(), null);

/* — the tap opens the photo — */
const malwaRow = w.rows().filter(function (el) { return el.getAttribute('data-fxphoto') === '1'; })[0];
ok('the painted row got its tap wired', !!malwaRow && typeof malwaRow.onclick === 'function');
malwaRow.onclick();
eq('the tap opens the Malwa expense', api._fxPhotoIdx(), 1);
h = body.innerHTML;
ok('the photo view shows the entry', h.indexOf('🧾 Expense') >= 0 && h.indexOf('Malwa Tires & Services') >= 0 && h.indexOf('$294.00') >= 0);
ok('the invoice photo opens full-width', h.indexOf('<img src="' + MALWA + '" style="width:100%') >= 0);
ok('the photo carries the download door (the app pattern)', h.indexOf('data-photodl-stub="expense-receipt-2026-11-05"') >= 0);

/* — Back returns to the list — */
eq('shell Back is consumed by the photo view', api.back(), true);
eq('the photo view is closed', api._fxPhotoIdx(), null);
ok('Back lands on the Other-expenses list again', body.innerHTML.indexOf('data-fxphoto="1"') >= 0);

/* — a photos-stack expense shows every photo — */
const defRow = w.rows().filter(function (el) { return el.getAttribute('data-fxphoto') === '2'; })[0];
defRow.onclick();
h = body.innerHTML;
ok('the stack expense shows BOTH photos full-width',
  h.indexOf('<img src="' + DEF1 + '" style="width:100%') >= 0 && h.indexOf('<img src="' + DEF2 + '" style="width:100%') >= 0);
api.back();

/* — photo-less expense: nothing to tap, nothing errors — */
let threw = false;
try {
  const washRow = w.rows().filter(function (el) { return el.getAttribute('data-fxphoto') === '0'; })[0];
  eq('no tappable row exists for the photo-less expense', washRow, undefined);
  api.resetView();
  eq('resetView leaves no photo view open', api._fxPhotoIdx(), null);
} catch (e) { threw = true; }
ok('the photo-less path never errors', !threw);

/* — the Audit list carries the same tappable rows —
   reached the way the app reaches it: out of the fx view
   (its Back), then the face's Audit door. */
els['#fx_back'].onclick();
api.render(body);
els['#fu_audit'].onclick();
h = body.innerHTML;
ok('we are really on the Audit list', h.indexOf('Audit — Other expenses') >= 0);
ok('the Audit expenses list shows the tappable photo rows', h.indexOf('data-fxphoto="1"') >= 0 && h.indexOf('📷 Receipt photo — tap to view ›') >= 0);
const auditRow = w.rows().filter(function (el) { return el.getAttribute('data-fxphoto') === '1'; })[0];
auditRow.onclick();
eq('a tap from Audit opens the same photo view', api._fxPhotoIdx(), 1);
api.back();
ok('Back from an Audit-opened photo lands back on the Audit list', body.innerHTML.indexOf('Audit — Other expenses') >= 0);

/* — pins — */
eq('webVersion is 346', ver.webVersion, 346);
ok('index.html pins fuel.js?v=346', idxSrc.indexOf('modules/fuel.js?v=346') >= 0);

console.log('\nexpense-tap-photo-v346: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
