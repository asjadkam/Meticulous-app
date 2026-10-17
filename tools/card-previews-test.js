#!/usr/bin/env node
/* Meticulous v78 — dashboard card PREVIEWS: behavioral tests against
 * the REAL shipped modules. Asjad (Oct 15, 2026): "I do miss the
 * design of the old app wherein there used to be something to
 * preview on the dashboard cards itself." Each home card's muted
 * line (app.js buildDashboard -> modStatus -> module.status()) now
 * carries the ONE most useful live fact from that module's own
 * stored data:
 *   dispatch  — active / today's / next dispatch (site → drop-off)
 *   invoice   — the OPEN period + its running revenue total
 *   fuel      — the most recent fill (litres · $ · when)
 *   connect   — shares waiting lead; connection count is fallback
 *   navigator — last destination routed this session, else server state
 *   manifest  — today's worked time (the tracker COMPLEMENT: the hero
 *               card counts the running session, this totals the day)
 *               — and office faces never see tracker facts.
 * Maintenance (next due) and P&L (month net) already showed their
 * fact and are untouched; their suites pin them.
 * Run: node tools/card-previews-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

const TODAY = '2026-10-15'; // a Thursday

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

function makeStore(mem) {
  return {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); },
    del: function (k) { delete mem[k]; }
  };
}

/* Light world: load ONE module file over an in-memory store. */
function makeWorld(file, mem, opts) {
  opts = opts || {};
  const sandbox = {
    console: console, Math: Math, Date: Date, JSON: JSON, setTimeout: setTimeout,
    Meticulous: { modules: {} }, // the core creates this in production
    App: {
      _store: makeStore(mem),
      _today: function () { return opts.today || TODAY; },
      _esc: function (s) { return String(s == null ? '' : s); },
      userRole: function () { return opts.role || 'both'; },
      tracker: opts.tracker || null
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read(file), sandbox);
  return sandbox;
}

/* ================= dispatch ================= */
console.log('— dispatch preview —');
{
  const w = makeWorld('modules/dispatch.js', {
    dsp_active: { jobSite: '12th Street South', dropoff: 'Ivor East Pond', status: 'active' },
    dsp_list: []
  });
  eq('active dispatch: site → drop-off', w.Meticulous.modules.dispatch.status(),
    'Active: 12th Street South → Ivor East Pond');
}
{
  const w = makeWorld('modules/dispatch.js', {
    dsp_active: { jobSite: 'Aecon Yard', status: 'active' }, dsp_list: []
  });
  eq('active dispatch without drop-off', w.Meticulous.modules.dispatch.status(), 'Active: Aecon Yard');
}
{
  const w = makeWorld('modules/dispatch.js', {
    dsp_active: null,
    dsp_list: [{ jobSite: 'Gravel Pit', destination: 'Site B', scheduledAt: '2026-10-15T08:00', status: 'saved', date: '2026-10-15' }]
  });
  eq("today's saved dispatch", w.Meticulous.modules.dispatch.status(), 'Today: Gravel Pit → Site B');
}
{
  const w = makeWorld('modules/dispatch.js', {
    dsp_active: null,
    dsp_list: [{ jobSite: 'Pit X', scheduledAt: '2026-10-16T08:00', status: 'saved', date: '2026-10-15' }]
  });
  eq('next upcoming dispatch carries its day', w.Meticulous.modules.dispatch.status(), 'Pit X · Fri Oct 16');
}
{
  const w = makeWorld('modules/dispatch.js', {
    dsp_active: null,
    dsp_list: [{ jobSite: 'A', status: 'completed' }, { jobSite: 'B', status: 'completed' }]
  });
  eq('history-only falls back to the count', w.Meticulous.modules.dispatch.status(), '2 completed');
}
{
  const w = makeWorld('modules/dispatch.js', { dsp_active: null, dsp_list: [] });
  eq('empty state is quiet', w.Meticulous.modules.dispatch.status(), 'No dispatch today');
}

/* ================= invoice ================= */
console.log('— invoice preview —');
const ONB = { payStandard: 'Hourly', payRate: 29, country: 'Canada', province: 'AB' };
{
  const w = makeWorld('modules/invoice.js', {
    onboarding: ONB, inv_list: [],
    rev_entries: [{ date: '2026-10-05', hours: 9.5 }], rev_extras: []
  });
  eq('open period (containing today) + running total', w.Meticulous.modules.invoice.status(), 'Oct 1–15: $275.50');
}
{
  const w = makeWorld('modules/invoice.js', {
    onboarding: ONB,
    inv_list: [{ no: '1151', date: '2026-10-15', pb: '2026-10-15' }],
    rev_entries: [{ date: '2026-10-05', hours: 9.5 }], rev_extras: []
  });
  eq('after issuing, the NEXT period is open and empty', w.Meticulous.modules.invoice.status(), 'Oct 16–31 · no entries yet');
}
{
  const w = makeWorld('modules/invoice.js', {
    onboarding: ONB,
    inv_list: [{ no: '1151', date: '2026-10-15', pb: '2026-10-15' }],
    rev_entries: [{ date: '2026-10-16', hours: 10 }], rev_extras: []
  });
  eq('next period totals its own entries only', w.Meticulous.modules.invoice.status(), 'Oct 16–31: $290.00');
}

/* ================= fuel ================= */
console.log('— fuel preview —');
{
  const w = makeWorld('modules/fuel.js', {
    fuel_fills: [
      { date: '2026-10-13', litres: 80, cost: 150 },
      { date: '2026-10-14', litres: 94.522, cost: 234.32 }
    ]
  });
  eq('most recent fill wins (not the first, not MPG)', w.Meticulous.modules.fuel.status(),
    'Last fill: 94.5 L · $234.32 · yesterday');
}
{
  const w = makeWorld('modules/fuel.js', { fuel_fills: [{ date: '2026-10-15', litres: 50, cost: 100 }] });
  eq('a fill today says today', w.Meticulous.modules.fuel.status(), 'Last fill: 50 L · $100.00 · today');
}
{
  const w = makeWorld('modules/fuel.js', { fuel_fills: [{ date: '2026-10-01', litres: 60, cost: 120 }] });
  eq('an older fill falls back to the short date', w.Meticulous.modules.fuel.status(), 'Last fill: 60 L · $120.00 · Oct 1');
}
{
  const w = makeWorld('modules/fuel.js', { fuel_fills: [] });
  eq('empty state', w.Meticulous.modules.fuel.status(), 'No fill-ups yet');
}

/* ================= connect ================= */
console.log('— connect preview —');
{
  const w = makeWorld('modules/connect.js', { con_list: [{ name: 'Umar' }], con_outbox: [] });
  eq('connections are the quiet fact', w.Meticulous.modules.connect.status(), '1 connection');
}
{
  const w = makeWorld('modules/connect.js', { con_list: [{ name: 'Umar' }], con_outbox: [{}, {}] });
  eq('waiting shares lead', w.Meticulous.modules.connect.status(), '2 waiting to send · 1 connection');
}
{
  const w = makeWorld('modules/connect.js', { con_list: [], con_outbox: [] });
  eq('empty state', w.Meticulous.modules.connect.status(), 'No connections yet');
}

/* ================= manifest (tracker complement + role gate) ================= */
console.log('— manifest preview —');
const SESS = [{ date: TODAY, seconds: 7200, endedAt: '2026-10-15T17:00:00.000Z' }];
{
  const w = makeWorld('modules/manifest.js', { sessions: SESS, mani_date: TODAY }, { role: 'driver' });
  eq('saved sessions total the day', w.Meticulous.modules.manifest.status(), 'Today: 2 h 0 m worked');
}
{
  const w = makeWorld('modules/manifest.js', { sessions: SESS, mani_date: TODAY }, {
    role: 'both',
    tracker: { status: 'running', elapsed: 3600, startTs: Date.now() - 600000 }
  });
  eq('the live session joins the total', w.Meticulous.modules.manifest.status(),
    'Today: 3 h 10 m worked · still working');
}
{
  const w = makeWorld('modules/manifest.js', { sessions: SESS, mani_date: TODAY }, {
    role: 'office',
    tracker: { status: 'running', elapsed: 3600, startTs: Date.now() - 600000 }
  });
  eq('office faces never see tracker facts', w.Meticulous.modules.manifest.status(), 'Daily log · ' + TODAY);
}
{
  const w = makeWorld('modules/manifest.js', { sessions: [], mani_date: TODAY }, { role: 'driver' });
  eq('nothing worked yet keeps the plain line', w.Meticulous.modules.manifest.status(), 'Daily log · ' + TODAY);
}

/* ================= navigator ================= */
console.log('— navigator preview —');
{
  const w = makeWorld('modules/navigator.js', {});
  eq('never set: the shipped default server routes (v98)', w.Meticulous.modules.navigator.status(),
    'Truck · 24 t · Calgary truck routes');
}
{
  const w = makeWorld('modules/navigator.js', {
    navigator: { serverUrl: '', profile: {}, muted: false, mode: 'truck' }
  });
  /* v137 deliberate pin move: the v98 "cleared → routing off"
     expectation is superseded — the address is baked in, so a
     legacy cleared value is ignored and the profile line stands. */
  eq('a legacy cleared address is ignored: profile line (v137)', w.Meticulous.modules.navigator.status(),
    'Truck · 24 t · Calgary truck routes');
}
{
  const w = makeWorld('modules/navigator.js', {
    navigator: { serverUrl: 'http://nav.test', profile: {}, muted: false, mode: 'truck' }
  });
  eq('server set, nothing routed yet: profile line', w.Meticulous.modules.navigator.status(),
    'Truck · 24 t · Calgary truck routes');
}

/* Navigator flow world (stubbed DOM/Leaflet/GPS/fetch, modeled on
 * tools/navigator-test.js): route once, then read the card line. */
function el() {
  const e = {
    children: {}, style: {}, value: '', textContent: '', _html: '', onclick: null,
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    querySelector: function (sel) { return e.children[sel] || null; },
    querySelectorAll: function () { return []; },
    getAttribute: function () { return null; },
    setAttribute: function () {}
  };
  Object.defineProperty(e, 'innerHTML', {
    get: function () { return e._html; }, set: function (v) { e._html = String(v); }
  });
  return e;
}
const fixture = JSON.parse(read('tools/navigator-fixture-tripb.json'));
function makeNavWorld(storeData) {
  const store = {
    get: function (k, d) { return storeData[k] !== undefined ? storeData[k] : d; },
    set: function (k, v) { storeData[k] = v; },
    del: function (k) { delete storeData[k]; }
  };
  const ids = ['nv_banner', 'nv_map', 'nv_mode_truck', 'nv_mode_car', 'nv_follow', 'nv_mute',
    'nv_q', 'nv_search', 'nv_results', 'nv_destnote', 'nv_route', 'nv_end', 'nv_note', 'nv_steps'];
  const reg = {};
  ids.forEach(function (id) { reg[id] = el(); });
  reg.nv_banner.children['.nv-banner-main'] = el();
  reg.nv_banner.children['.nv-banner-sub'] = el();
  const body = el();
  body.querySelector = function (sel) { return reg[sel.slice(1)] || null; };
  body.querySelectorAll = function () { return []; };
  const mapHandlers = {};
  const mapStub = {
    setView: function () { return mapStub; },
    on: function (ev, fn) { mapHandlers[ev] = fn; },
    remove: function () {}, fitBounds: function () {}, getZoom: function () { return 15; },
    invalidateSize: function () {}, removeLayer: function () {}
  };
  const L = {
    map: function () { return mapStub; },
    tileLayer: function () { return { addTo: function () {} }; },
    marker: function () { return { addTo: function () { return this; }, setLatLng: function () {} }; },
    circleMarker: function () { return { addTo: function () { return this; }, setLatLng: function () {} }; },
    polyline: function () { return { addTo: function () { return this; }, getBounds: function () { return {}; } }; }
  };
  let geoCb = null;
  const world = {
    console: console, JSON: JSON, Math: Math, Date: Date, setTimeout: setTimeout,
    window: null, document: {},
    App: { _esc: function (s) { return String(s == null ? '' : s); }, _store: store },
    Meticulous: {}, L: L,
    navigator: { geolocation: { watchPosition: function (cb) { geoCb = cb; return 7; }, clearWatch: function () {} } },
    speechSynthesis: { cancel: function () {}, speak: function () {} },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    fetch: function (url) {
      const payload = url.indexOf('/route') >= 0 ? fixture : [];
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve(payload); } });
    }
  };
  world.window = world;
  vm.createContext(world);
  vm.runInContext(read('modules/navigator.js'), world);
  return {
    world: world, reg: reg, body: body, mapHandlers: mapHandlers,
    firePos: function (la, lo) { geoCb({ coords: { latitude: la, longitude: lo } }); }
  };
}
function tick() { return new Promise(function (r) { setTimeout(r, 10); }); }

(async function () {
  const w = makeNavWorld({ navigator: { serverUrl: 'http://nav.test', profile: {}, muted: false, mode: 'truck' } });
  const api = w.world.Meticulous.modules.navigator;
  api.render(w.body);
  w.firePos(51.0955, -114.099);
  w.mapHandlers.click({ latlng: { lat: 51.1075, lng: -114.0845 } });
  w.reg.nv_route.onclick();
  await tick(); await tick();
  eq('after a route, the card names the destination', api.status(), '→ Dropped pin');
  api.teardown();
  eq('…and it survives leaving the module (teardown)', api.status(), '→ Dropped pin');

  /* ================= statics ================= */
  console.log('— statics —');
  const css = read('css/style.css');
  ok('card preview line is ONE muted line (nowrap + ellipsis)',
    /\.modcard \.s\{[^}]*white-space:nowrap[^}]*text-overflow:ellipsis/.test(css));
  const appSrc = read('js/app.js');
  ok('dashboard cards are fed by modStatus(key)', appSrc.indexOf('modStatus(key)') >= 0);
  const ver = JSON.parse(read('version.json'));
  const idx = read('index.html');
  ['dispatch', 'invoice', 'fuel', 'connect', 'navigator', 'manifest'].forEach(function (m) {
    ok('index.html pins modules/' + m + '.js at ?v=' + ver.webVersion,
      idx.indexOf('modules/' + m + '.js?v=' + ver.webVersion) >= 0);
  });

  console.log('card-previews-test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
