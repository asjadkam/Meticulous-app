#!/usr/bin/env node
/* Meticulous v201 — REV-CLEAN + CHART-DATES + NO-SCROLL (owner,
 * Oct 21, 2026 09:50–09:59 MDT, from his live Revenue screenshot):
 *  (1) the two full FORMS (＋ Manual entry, ✨ Extras) sat inline
 *      on the Revenue face — his ruling restores the older design:
 *      two SMALL tabs at the top ("Add rev. manually" / "Add
 *      extras"), each opening its OWN view holding the form,
 *      fields + save behavior unchanged;
 *  (2) the Daily earnings chart is the page's HIGHLIGHT — the
 *      first content card (period view);
 *  (3) auto-start leaves the face behind a menu button of its
 *      own (⏰ Auto-start ▾): the shared settings card + save
 *      unfold under it, unchanged; Preferences' own controls are
 *      untouched (not this item's surface);
 *  (4) CHART-DATES lives in the v151 suite now (every day
 *      labelled, vertical, never clipped) — here: the chart card
 *      still renders and the two-tap preview host rides with it;
 *  (5) NO-SCROLL: tabs + auto-start button + chart all sit at the
 *      top of the face; the Entries list (history) is what comes
 *      after — asserted by document order.
 * Drives the REAL modules/revenue.js (+ real autostart module)
 * over a stub DOM that records the wiring, so the tabs, the
 * toggle and both form saves are exercised, not just painted.
 * Run: node tools/rev-clean-v201-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');
const revSrc = read('modules/revenue.js');
const asSrc = read('modules/autostart.js');
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
/* Stub element: enough DOM for the revenue render + wiring. */
function StubEl() {
  this.innerHTML = ''; this.style = {}; this.value = '';
  this.onclick = null; this.onchange = null; this.oninput = null;
  this._attrs = {}; this.offsetWidth = 360;
}
StubEl.prototype.getAttribute = function (k) { return this._attrs[k] || ''; };
StubEl.prototype.setAttribute = function (k, v) { this._attrs[k] = v; };
StubEl.prototype.querySelector = function () { return new StubEl(); };
StubEl.prototype.querySelectorAll = function () { return []; };
StubEl.prototype.getBoundingClientRect = function () { return { width: 360, left: 0 }; };
StubEl.prototype.getContext = function () {
  return { fillStyle: '', font: '', clearRect: function () {}, fillRect: function () {},
    fillText: function () {}, save: function () {}, restore: function () {},
    translate: function () {}, rotate: function () {} };
};
function FakeBody() {
  this.innerHTML = '';
  this._one = {};   // selector -> singleton stub (querySelector)
  this._many = {};  // selector -> [stubs] (querySelectorAll)
}
FakeBody.prototype.querySelector = function (sel) {
  if (sel === '#revChart') return null; // chart drawing is the v151 suite's ground
  return this._one[sel] || (this._one[sel] = new StubEl());
};
FakeBody.prototype.querySelectorAll = function (sel) { return this._many[sel] || []; };

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
  const a = appSrc.lastIndexOf('/*', appSrc.indexOf('SHARED REVENUE CORE (v105)'));
  const b = appSrc.indexOf('*/', appSrc.indexOf('end SHARED REVENUE CORE'));
  vm.runInContext(appSrc.slice(a, b + 2), sb);
  vm.runInContext(asSrc, sb);
  vm.runInContext(revSrc, sb);
  return { sb: sb, store: store, rev: sb.Meticulous.modules.revenue };
}

function tabStubs(body) {
  const man = new StubEl(); man._attrs['data-rvtab'] = 'manual';
  const ext = new StubEl(); ext._attrs['data-rvtab'] = 'extras';
  body._many['[data-rvtab]'] = [man, ext];
  return { man: man, ext: ext };
}

/* ===== the face: tabs on top, chart first, no forms ===== */
{
  const w = makeWorld({ onboarding: { payStandard: 'hourly', ownWageRate: 29 } });
  const body = new FakeBody();
  const tabs = tabStubs(body);
  w.rev.render(body);
  const h = body.innerHTML;
  const iTabs = h.indexOf('data-rvtab="manual"');
  const iChart = h.indexOf('📊 Daily earnings');
  const iHead = h.indexOf('💰 Revenue');
  const iEntries = h.indexOf('📒 Entries');
  check('face: the manual tab is on the face', iTabs >= 0);
  check('face: the extras tab is on the face', h.indexOf('data-rvtab="extras"') >= 0);
  check('face: auto-start has its own menu button', h.indexOf('id="rv_as_btn"') >= 0 && h.indexOf('⏰ Auto-start') >= 0);
  check('order: tabs strip is FIRST', iTabs >= 0 && iTabs < iChart && iTabs < iHead && iTabs < iEntries);
  check('order: the chart is the first content card (before the header card)', iChart >= 0 && iChart < iHead);
  check('order: header + stats next, Entries history after', iHead >= 0 && iHead < iEntries);
  check('face: NO manual form fields on the face', h.indexOf('id="rv_amt"') === -1 && h.indexOf('id="rv_add"') === -1 && h.indexOf('id="rv_date"') === -1);
  check('face: NO extras form fields on the face', h.indexOf('id="rx_amt"') === -1 && h.indexOf('id="rx_add"') === -1);
  check('face: auto-start panel is CLOSED on arrival (no save button, no settings card)',
    h.indexOf('id="rv_as_save"') === -1);
  check('face: the chart canvas + preview host ride together', h.indexOf('id="revChart"') >= 0 && h.indexOf('id="rv_gprev"') >= 0);

  /* the auto-start menu button unfolds the panel, unchanged */
  const asBtn = body._one['#rv_as_btn'];
  check('the menu button got wired', typeof asBtn.onclick === 'function');
  asBtn.onclick();
  const h2 = body.innerHTML;
  check('panel open: the shared settings + Save auto-start appear', h2.indexOf('id="rv_as_save"') >= 0);
  asBtn.onclick && body._one['#rv_as_btn'].onclick && body._one['#rv_as_btn'].onclick();
  check('panel toggles shut again', body.innerHTML.indexOf('id="rv_as_save"') === -1);

  /* ===== the manual tab opens its own view; the form saves ===== */
  tabs.man.onclick();
  const hv = body.innerHTML;
  check('manual view: the form is here (all fields)', hv.indexOf('id="rv_date"') >= 0 && hv.indexOf('id="rv_amt"') >= 0 &&
    hv.indexOf('id="rv_type"') >= 0 && hv.indexOf('id="rv_loads"') >= 0 && hv.indexOf('id="rv_note"') >= 0 && hv.indexOf('id="rv_add"') >= 0);
  check('manual view: a Back door exists', hv.indexOf('id="rv_form_back"') >= 0);
  check('manual view: the face is gone (no chart, no entries)', hv.indexOf('id="revChart"') === -1 && hv.indexOf('📒 Entries') === -1);
  ['#rv_amt', '#rv_date', '#rv_type', '#rv_loads', '#rv_note'].forEach(function (s) { body.querySelector(s); });
  body._one['#rv_amt'].value = '250.00';
  body._one['#rv_date'].value = '2026-10-20';
  body._one['#rv_type'].value = 'hourly';
  body._one['#rv_loads'].value = '1';
  body._one['#rv_note'].value = 'Test haul';
  body._one['#rv_add'].onclick();
  const ents = w.store.get('rev_entries', []);
  eq('manual save: the entry landed, fields verbatim', ents.length && [ents[0].date, ents[0].amount, ents[0].type, ents[0].note],
    ['2026-10-20', '250.00', 'hourly', 'Test haul']);
  check('manual save: back on the face (chart present again)', body.innerHTML.indexOf('id="revChart"') >= 0);

  /* ===== the extras tab: form + its list, saving works ===== */
  /* the same stub objects ride every render (the fake's registry
     is stable), so each render re-wires the same tabs */
  tabs.ext.onclick();
  const hx = body.innerHTML;
  check('extras view: the form is here', hx.indexOf('id="rx_type"') >= 0 && hx.indexOf('id="rx_amt"') >= 0 && hx.indexOf('id="rx_add"') >= 0);
  ['#rx_amt', '#rx_type', '#rx_date', '#rx_note'].forEach(function (s) { body.querySelector(s); });
  body._one['#rx_amt'].value = '40.00';
  body._one['#rx_type'].value = 'bonus';
  body._one['#rx_date'].value = '2026-10-20';
  body._one['#rx_note'].value = 'Wait pay';
  body._one['#rx_add'].onclick();
  const xtra = w.store.get('rev_extras', []);
  eq('extras save: the extra landed, fields verbatim', xtra.length && [xtra[0].type, xtra[0].amount, xtra[0].date, xtra[0].note],
    ['bonus', '40.00', '2026-10-20', 'Wait pay']);
  check('extras save: back on the face', body.innerHTML.indexOf('data-rvtab="manual"') >= 0);

  /* Back from a form view returns to the face untouched */
  tabs.man.onclick();
  body._one['#rv_form_back'].onclick();
  check('Back: returns to the face', body.innerHTML.indexOf('📊 Daily earnings') >= 0 && body.innerHTML.indexOf('id="rv_add"') === -1);
}

/* ===== month view: same clean face, no forms either ===== */
{
  const w = makeWorld({ onboarding: { payStandard: 'hourly', ownWageRate: 29 }, rev_view: 'month' });
  const body = new FakeBody();
  tabStubs(body);
  w.rev.render(body);
  const h = body.innerHTML;
  check('month face: tabs on top', h.indexOf('data-rvtab="manual"') >= 0);
  check('month face: no forms inline', h.indexOf('id="rv_amt"') === -1 && h.indexOf('id="rx_amt"') === -1);
  check('month face: days list + import still here', h.indexOf('🗓 Days in') >= 0 && h.indexOf('id="rv_imp_btn"') >= 0);
}

/* ===== office face: no auto-start button (v76 F5 stands) ===== */
{
  const w = makeWorld({ onboarding: { payStandard: 'hourly' } });
  w.sb.App.userRole = () => 'office';
  const body = new FakeBody();
  tabStubs(body);
  w.rev.render(body);
  check('office face: tabs yes, auto-start button no',
    body.innerHTML.indexOf('data-rvtab="manual"') >= 0 && body.innerHTML.indexOf('id="rv_as_btn"') === -1);
}

/* ===== statics ===== */
check('revenue.js: chart labels stand vertical (rotate) for every bar, no label gating set remains',
  revSrc.includes('ctx.rotate(-Math.PI / 2)') && revSrc.indexOf('labelSet') === -1);
check('revenue.js: formView branch + renderFormView exist',
  revSrc.includes('if (formView) { renderFormView(body); return; }') && revSrc.includes('function renderFormView(body)'));
eq('webVersion', ver.webVersion, 210);
check('index pin agrees', idxSrc.includes('modules/revenue.js?v=' + ver.webVersion));

console.log('rev-clean-v201: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
