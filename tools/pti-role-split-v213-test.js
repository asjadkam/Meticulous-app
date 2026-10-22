#!/usr/bin/env node
/* Meticulous v213 — PTI-ROLE-SPLIT (owner, Oct 21, 2026 14:09
 * MDT): "office staff / owners / fleet managers who do NOT
 * drive never fill out a PTI; they only SEE their drivers' PTI
 * reports. Owners who drive as well get the full PTI to do
 * their OWN, and still only SEE their drivers'."
 *
 * The audit found: the dashboard flag/nudge were already
 * office-gated (app.js ptiFlagVisible/shouldNudgePti), and the
 * office face hid the module entirely — but modules/pti.js
 * render() itself had NO role gate (any path that reached it
 * handed an office user the full filing form), and no live
 * surface anywhere showed a boss his drivers' PTI reports
 * (the P&L crew block that carried them is unhosted).
 *
 * The fix: render() branches FIRST on App.userRole() —
 * 'office' gets renderOfficePti (view-only: the connected
 * drivers' shared PTI reports via ConnectPipe.fetchRecords,
 * major defects painted loud, no form controls of any kind);
 * 'driver'/'both' fall through to the full module untouched.
 * PTI joins ROLE_MODULE_ORDER.office (last — the five working
 * tools keep their lead), which also carries it into the
 * office sidebar keep-list; status() speaks the viewer's line
 * to office users.
 *
 * Drives the real modules/pti.js per role in vm worlds.
 * Run: node tools/pti-role-split-v213-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const ptiSrc = read('modules/pti.js');
const appSrc = read('js/app.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 10); }); }

function makeStore(seed) {
  const data = Object.assign({}, seed || {});
  return {
    get: function (k, d) { return (k in data) ? data[k] : d; },
    set: function (k, v) { data[k] = v; },
    del: function (k) { delete data[k]; },
    _data: data
  };
}
function stubEl() {
  const e = {
    _html: '', value: '', textContent: '', onclick: null, onchange: null, style: {},
    classList: { _s: new Set(), add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); },
      toggle: function (c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { on ? this._s.add(c) : this._s.delete(c); } },
      contains: function (c) { return this._s.has(c); } },
    setAttribute: function () {}, getAttribute: function () { return null; },
    addEventListener: function () {}, focus: function () {}, click: function () {},
    querySelector: function () { return null; }, querySelectorAll: function () { return []; }
  };
  Object.defineProperty(e, 'innerHTML', {
    configurable: true,
    get: function () { return e._html; }, set: function (v) { e._html = String(v); }
  });
  return e;
}
function makeBody() {
  const body = stubEl();
  const wrap = stubEl();
  body._wrap = wrap;
  body.querySelector = function (sel) { return sel === '#pti_office_wrap' ? wrap : stubEl(); };
  body.querySelectorAll = function () { return []; };
  return body;
}
function makeWorld(role, recordsOut) {
  const store = makeStore({ onboarding: { firstName: 'Test', lastName: 'User', userRole: role, accountType: role === 'office' ? 'Fleet Manager' : 'Owner-Operator' } });
  const App = {
    _store: store,
    _esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
    _today: function () { return '2026-10-21'; },
    userRole: function () { return role; },
    openModule: function () {}
  };
  const sb = { console: console, Date: Date, Math: Math, JSON: JSON, Meticulous: { modules: {} }, App: App };
  sb.window = sb;
  if (recordsOut) {
    sb.ConnectPipe = {
      fetchRecords: function () { return Promise.resolve(recordsOut); },
      peerNames: function () { return []; }
    };
    sb.window.ConnectPipe = sb.ConnectPipe;
  }
  vm.createContext(sb);
  vm.runInContext(ptiSrc, sb, { filename: 'modules/pti.js' });
  return { api: sb.Meticulous.modules.pti, store: store };
}

const RECORDS = {
  records: {
    'uid-andy': {
      driverName: 'Andy Driver',
      pti: [
        { date: '2026-10-21', filedAt: 1761000000000, kind: 'pre', signed: true, unit: '12', plate: 'ABC123', odometer: 201000, location: 'Yard', result: 'major', driverName: 'Andy Driver',
          defects: [{ item: 'Tires', severity: 'major', note: 'Cut sidewall' }] },
        { date: '2026-10-20', filedAt: 1760900000000, kind: 'post', signed: false, unit: '12', plate: 'ABC123', odometer: 200400, location: '', result: 'pass', driverName: 'Andy Driver', defects: [] }
      ]
    },
    'uid-sam': { driverName: 'Sam Second', pti: [] }
  },
  billing: {}, manifests: {}
};

const FORM_MARKERS = ['data-pti-ok=', 'id="pti_carrier"', 'id="pti_unit"', 'data-pti-def='];

(async function () {
  console.log('— office-only: view-only, no form anywhere —');
  {
    const w = makeWorld('office', RECORDS);
    const body = makeBody();
    w.api.render(body);
    await tick(20);
    const head = body._html, wrap = body._wrap._html;
    ok('the office surface is the drivers-reports card', head.indexOf("Drivers' PTI reports") >= 0, head.slice(0, 120));
    ok('it says plainly that he does not fill these out', head.indexOf("You don't fill these out") >= 0);
    ok('the driver is named', wrap.indexOf('Andy Driver') >= 0, wrap.slice(0, 200));
    ok('the MAJOR defect is painted loud', wrap.indexOf('🚨 MAJOR DEFECT') >= 0 && wrap.indexOf('Cut sidewall') >= 0);
    ok('the clean report reads clean', wrap.indexOf('✓ No defects') >= 0);
    ok('pre/post kinds are shown', wrap.indexOf('Pre-trip') >= 0 && wrap.indexOf('Post-trip') >= 0);
    ok('signed state is shown', wrap.indexOf('Signed by Andy Driver') >= 0 && wrap.indexOf('Not signed yet') >= 0);
    ok('a driver with no PTIs paints nothing', wrap.indexOf('Sam Second') === -1);
    const all = head + wrap;
    FORM_MARKERS.forEach(function (m) {
      ok('NO form marker ' + m + ' on the office surface', all.indexOf(m) === -1);
    });
    ok('no Inspection Mode arming on the office surface', all.indexOf('pti_dot_pin') === -1 && all.indexOf('Inspection Mode') === -1);
    eq("the dashboard card speaks the viewer's line", w.api.status(), "Your drivers' filed inspections");
  }

  console.log('— office-only: honest empties —');
  {
    const w = makeWorld('office', { records: {}, billing: {}, manifests: {} });
    const body = makeBody();
    w.api.render(body);
    await tick(20);
    ok('no reports → the honest empty note', body._wrap._html.indexOf('No PTI reports shared with you yet') >= 0, body._wrap._html.slice(0, 120));
    const w2 = makeWorld('office', null);
    const body2 = makeBody();
    w2.api.render(body2);
    await tick(20);
    ok('no ConnectPipe → still the honest empty note, no crash', body2._wrap._html.indexOf('No PTI reports shared with you yet') >= 0);
  }

  console.log('— driver + both: the full form, exactly as before —');
  for (const role of ['driver', 'both']) {
    const w = makeWorld(role, RECORDS);
    const body = makeBody();
    try { w.api.render(body); } catch (e) { /* wiring stubs: the painted HTML is the assertion surface */ }
    await tick(10);
    const h = body._html;
    ok(role + ': the filing form paints (checklist + carrier fields)',
      FORM_MARKERS.every(function (m) { return h.indexOf(m) >= 0; }), h.slice(0, 160));
    ok(role + ': NOT the office viewer', h.indexOf("Drivers' PTI reports") === -1);
    ok(role + ": the dashboard card keeps the driver's line", w.api.status().indexOf('Today:') === 0, w.api.status());
  }

  console.log('— pins —');
  const renderSlice = ptiSrc.slice(ptiSrc.indexOf('render: function (body)'), ptiSrc.indexOf('/* test hooks'));
  ok('render branches on office BEFORE the form dispatch',
    renderSlice.indexOf("roleNow === 'office'") >= 0 &&
    renderSlice.indexOf("roleNow === 'office'") < renderSlice.indexOf('renderForm(body);'));
  ok('the office face carries PTI (cards + sidebar keep-list read the same list)',
    /office: \['connect', 'dispatch', 'invoice', 'pnl', 'manifest', 'pti'\]/.test(appSrc));
  ok('driver/both face lists are untouched',
    appSrc.indexOf("driver: ['revenue', 'dispatch', 'fuel', 'maintenance', 'pti', 'manifest', 'navigator', 'damage', 'pnl', 'invoice', 'connect']") >= 0 &&
    appSrc.indexOf("both: ['revenue', 'dispatch', 'navigator', 'fuel', 'pnl', 'maintenance', 'pti', 'damage', 'manifest', 'invoice', 'connect']") >= 0);
  eq('webVersion is 213', ver.webVersion, 221);
  ok('index.html pins the v213 build', idxSrc.indexOf('?v=221') >= 0 && idxSrc.indexOf('?v=' + '212') < 0);

  console.log('\npti-role-split-v213 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR ' + (e && e.stack || e)); process.exit(1); });
