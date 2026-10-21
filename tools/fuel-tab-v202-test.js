#!/usr/bin/env node
/* Meticulous v202 — FUEL-TAB (owner, Oct 21, 2026 10:02 MDT,
 * from his live Fuel & Expense screenshot): the screen stacked
 * TWO forms on one face — the ＋ Fuel-up form and under it an
 * Other-expenses form. His ruling, "again like the older
 * design": Other expenses gets a tab of its own — a small
 * tappable entry at the top of the face (the Revenue-tab
 * pattern, v201) opening its own view holding the form; the
 * face keeps the trend, the Fuel-up form and the Fill-ups list
 * only. Fields + save behavior unchanged inside the view; the
 * past-expenses list rides with its form (history behind the
 * tap). NO-SCROLL: the tab + the fuel form are what the page is
 * for — visible on arrival; the fill-ups history scrolls.
 * Drives the REAL modules/fuel.js over a stub DOM.
 * Run: node tools/fuel-tab-v202-test.js
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
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
const clone = (v) => JSON.parse(JSON.stringify(v));

function makeStore(seed) {
  const m = new Map(Object.entries(clone(seed || {})));
  return {
    get: (k, d) => (m.has(k) ? clone(m.get(k)) : d),
    set: (k, v) => { m.set(k, clone(v)); return true; },
    del: (k) => { m.delete(k); return true; }
  };
}
function StubEl() {
  this.innerHTML = ''; this.style = {}; this.value = '';
  this.onclick = null; this.onchange = null; this.oninput = null;
  this._attrs = {};
}
StubEl.prototype.getAttribute = function (k) { return this._attrs[k] || null; };
StubEl.prototype.setAttribute = function (k, v) { this._attrs[k] = v; };
StubEl.prototype.addEventListener = function () {};
StubEl.prototype.click = function () {};
StubEl.prototype.querySelector = function () { return new StubEl(); };
StubEl.prototype.querySelectorAll = function () { return []; };
function FakeBody() { this.innerHTML = ''; this._one = {}; }
FakeBody.prototype.querySelector = function (sel) {
  return this._one[sel] || (this._one[sel] = new StubEl());
};
FakeBody.prototype.querySelectorAll = function () { return []; };

function makeWorld(seed) {
  const store = makeStore(seed || {});
  const sb = { console: console, setTimeout: setTimeout, Promise: Promise, alert: function () {} };
  sb.window = sb;
  sb.Meticulous = { modules: {} };
  sb.App = {
    _store: store,
    _esc: (s) => String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    _today: () => '2026-10-21',
    userRole: () => 'driver',
    tracker: null
  };
  vm.createContext(sb);
  vm.runInContext(fuelSrc, sb);
  return { sb: sb, store: store, fuel: sb.Meticulous.modules.fuel };
}

const w = makeWorld({
  onboarding: { payStandard: 'hourly', ownWageRate: 29 },
  fuel_fills: [
    { date: '2026-10-20', litres: 210.5, cost: 312.40, station: 'Petro-Pass', odo: 169500 },
    { date: '2026-10-19', litres: 180, cost: 268.10, station: 'Mobil', odo: 169100 }
  ],
  fuel_expenses: [{ what: 'DEF fluid', cost: '24.99', date: '2026-10-18' }]
});
const body = new FakeBody();
w.fuel.render(body);
const h = body.innerHTML;

check('face: the Other-expenses tab is on the face', h.indexOf('id="fx_tab"') >= 0);
check('face: the tab is at the TOP (before the trend card)',
  h.indexOf('id="fx_tab"') >= 0 && h.indexOf('id="fx_tab"') < h.indexOf('⛽ Fuel trend'));
check('face: the Fuel-up form is here', h.indexOf('id="fu_add"') >= 0 && h.indexOf('id="fu_form_card"') >= 0);
check('face: the Fill-ups list is here', h.indexOf('📒 Fill-ups') >= 0);
check('face: NO Other-expenses form fields on the face',
  h.indexOf('id="fx_what"') === -1 && h.indexOf('id="fx_add"') === -1 && h.indexOf('id="fx_cost"') === -1);
check('face: NO past-expenses list on the face', h.indexOf('id="fx_list"') === -1 && h.indexOf('DEF fluid') === -1);

/* open the tab: the view holds the form + its history */
const tab = body._one['#fx_tab'];
check('the tab got wired', typeof tab.onclick === 'function');
tab.onclick();
const hv = body.innerHTML;
check('view: the form is here (What / Cost / photo / Add)',
  hv.indexOf('id="fx_what"') >= 0 && hv.indexOf('id="fx_cost"') >= 0 &&
  hv.indexOf('id="fx_cam"') >= 0 && hv.indexOf('id="fx_add"') >= 0);
check('view: the past-expenses list rides with the form', hv.indexOf('id="fx_list"') >= 0 && hv.indexOf('DEF fluid') >= 0);
check('view: a Back door exists', hv.indexOf('id="fx_back"') >= 0);
check('view: the face is gone (no fuel form, no trend)', hv.indexOf('id="fu_add"') === -1 && hv.indexOf('⛽ Fuel trend') === -1);

/* save an expense inside the view: same store, same shape */
body._one['#fx_what'].value = 'Washer fluid';
body._one['#fx_cost'].value = '9.50';
body._one['#fx_add'].onclick();
const xs = w.store.get('fuel_expenses', []);
eq('save: the expense landed with the standing shape', xs.length && [xs[xs.length - 1].what, xs[xs.length - 1].cost, xs[xs.length - 1].date],
  ['Washer fluid', '9.50', '2026-10-21']);
check('save: still in the view, the new expense listed', body.innerHTML.indexOf('Washer fluid') >= 0);

/* Back returns to the clean face */
body._one['#fx_back'].onclick();
check('Back: the face is back, tab on top, no fx form',
  body.innerHTML.indexOf('id="fx_tab"') >= 0 && body.innerHTML.indexOf('id="fx_what"') === -1);

/* statics + pins */
check('fuel.js: the fx wiring lives in wireFx, called by the view only',
  fuelSrc.includes('function wireFx(body)') && fuelSrc.includes('wireFx(body);'));
check('fuel.js: renderFxView exists and the render branches to it',
  fuelSrc.includes('function renderFxView(body)') && fuelSrc.includes('if (fxView) { renderFxView(body); return; }'));
eq('webVersion', ver.webVersion, 213);
check('index pin agrees', idxSrc.includes('modules/fuel.js?v=' + ver.webVersion));

console.log('fuel-tab-v202: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
