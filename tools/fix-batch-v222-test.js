#!/usr/bin/env node
/* Meticulous v222 — the six in-hands defects from the v220/v37
 * field test (Oct 22 afternoon), fixed as ONE run:
 *   1 BUBBLE-NO-SHOW-OCT22        — the session arm must reach the
 *      shell from the DURABLE web session (v38 setSession), not
 *      only from the native service's own start (a reinstall wipes
 *      the native prefs the arm used to ride on).
 *   2 LIVE-MILES-DISPLAY-RESET-OCT22 — after a reinstall the hero
 *      restarted at ~0 km over a ~131 km day: the engines startDay
 *      against an empty store and the sign-in re-attach then skips
 *      (the key already matches). reseedFromStore adopts the
 *      persisted record when it is AHEAD of the live engine.
 *   3 LOADS-RESTORE-FAIL-OCT22    — the same story for the load
 *      count: machine count AND the signed corr come back exactly.
 *   4 NAV-STUCK-OCT22             — the drive view froze while the
 *      clock advanced: the module's own watchPosition can die
 *      silently. v222: the app's maintained fix stream feeds the
 *      drive too (deduped by fix time) and a watchdog re-registers
 *      a silent watch. THE INSTRUMENT: fixes arriving on the app
 *      stream must advance the rendered position.
 *   5 PIP-LANDS-HOME-OCT22        — Back from the map parks the
 *      drive screen into the in-app screen-in-screen dock OVER
 *      THE DASHBOARD (never the launcher); the module stays alive.
 *   6 WIDGET-SIZE-3X3-OCT22       — native statics: tight 2x2
 *      target cells, resizable, the fill spacer in the layout.
 * Run: node tools/fix-batch-v222-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NROOT = path.resolve(ROOT, '..', 'meticulous-native');
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function readN(p) { return fs.readFileSync(path.join(NROOT, p), 'utf8'); }
function flush() { return new Promise(function (r) { setTimeout(r, 5); }); }

/* ==================================================================
 * Part A — LiveMiles reseed (item 2). The wake-hold world pattern:
 * the REAL js/miles.js glue in a vm over a stub store + geo.
 * ================================================================== */
console.log('— Part A: LiveMiles reseed after a reinstall (item 2) —');
const milesSrc = read('js/miles.js');
function mkMilesWorld(backing, T0) {
  let fakeNow = T0;
  class FakeDate extends Date { static now() { return fakeNow; } }
  const memStore = {
    get(k, d) { const v = backing['mt_' + k]; return v === undefined ? d : JSON.parse(v); },
    set(k, v) { backing['mt_' + k] = JSON.stringify(v); return true; },
    del(k) { delete backing['mt_' + k]; return true; }
  };
  const els = {};
  function fakeEl(id) {
    if (!els[id]) {
      const classes = new Set(['hidden']);
      els[id] = { id: id, textContent: '',
        classList: { toggle: function (c, f) { if (f === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (f) classes.add(c); else classes.delete(c); },
          add: function (c) { classes.add(c); }, remove: function (c) { classes.delete(c); },
          contains: function (c) { return classes.has(c); } } };
    }
    return els[id];
  }
  const geo = { _watching: false, _cb: null,
    available: function () { return true; }, isWatching: function () { return geo._watching; },
    start: function (cb) { geo._cb = cb; geo._watching = true; return Promise.resolve(true); },
    stop: function () { geo._watching = false; geo._cb = null; return Promise.resolve(); },
    deliver: function (fix) { if (geo._cb) geo._cb(fix); } };
  const App = { _store: memStore, tracker: { status: 'running', startTs: T0, elapsed: 0 }, geo: geo };
  const sb = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
    Promise: Promise, JSON: JSON, Math: Math, Date: FakeDate, navigator: {},
    document: { visibilityState: 'visible', getElementById: fakeEl }, App: App };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(milesSrc, sb);
  return { LiveMiles: sb.LiveMiles, geo: geo, els: els,
    setNow: function (ms) { fakeNow = ms; } };
}
function mfix(lat, lng, t) { return { latitude: lat, longitude: lng, accuracy: 8, time: t }; }

(async function partA() {
  const T0 = 1792212000000; // a fixed morning
  const KEY = 's' + T0;
  /* World 1: the original day — ~1.1 km of driving, persisted. */
  const backing1 = {};
  const w1 = mkMilesWorld(backing1, T0);
  ok(w1.LiveMiles.startDay(KEY) === true, 'A1: the original day starts');
  for (let i = 0; i <= 10; i++) {
    w1.setNow(T0 + i * 10000);
    w1.geo.deliver(mfix(51.05 + i * 0.001, -114.07, T0 + i * 10000));
  }
  await flush();
  w1.LiveMiles.flush();
  const rec1 = JSON.parse(backing1['mt_livemiles']);
  const day1 = rec1.days[KEY];
  ok(day1 && day1.totalM > 1000, 'A2: the original day persisted ~1.1 km', day1 && day1.totalM);

  /* World 2: the reinstall — a fresh empty store, the boot
     startDay runs BEFORE the cloud record lands (the field bug),
     then the record lands and the re-attach reseeds. */
  const backing2 = {};
  const w2 = mkMilesWorld(backing2, T0);
  ok(w2.LiveMiles.startDay(KEY, { resume: true }) === true, 'A3: the reinstall boot resumes the session');
  ok(!w2.LiveMiles.currentKm(), 'A4: pre-pull the engine sits at 0 (the field state)');
  backing2['mt_livemiles'] = backing1['mt_livemiles']; // the pull lands
  ok(w2.LiveMiles.reseedFromStore() === true, 'A5: reseed adopts the landed record');
  const t2 = w2.LiveMiles.currentKm() * 1000;
  ok(Math.abs(t2 - day1.totalM) < day1.totalM * 0.05, 'A6: the engine total is the day total again', t2 + ' vs ' + day1.totalM);
  w2.LiveMiles.paint();
    const a7m = /([\d.]+) km/.exec(w2.els.trkMiles.textContent);
  ok(a7m && parseFloat(a7m[1]) >= 1.0, 'A7: the hero paints the restored km, not 0.4', w2.els.trkMiles.textContent);
  /* exactly-once: re-feeding the last old fix counts nothing new */
  w2.setNow(T0 + 110000);
  w2.geo.deliver(mfix(51.06, -114.07, T0 + 100000));
  await flush();
  ok(Math.abs(w2.LiveMiles.currentKm() * 1000 - t2) < 5, 'A8: the replayed old fix is not counted twice', w2.LiveMiles.currentKm());
  /* new driving after the reseed: the first live fix re-anchors
     (the stretch since the saved record was unobserved — the
     engine's honest join), the next one counts, once. */
  w2.setNow(T0 + 120000);
  w2.geo.deliver(mfix(51.062, -114.07, T0 + 120000));
  await flush();
  ok(Math.abs(w2.LiveMiles.currentKm() * 1000 - t2) < 5, 'A9: the first post-restore fix re-anchors (unobserved gap stays uncounted)');
  w2.setNow(T0 + 130000);
  w2.geo.deliver(mfix(51.064, -114.07, T0 + 130000));
  await flush();
  const t3 = w2.LiveMiles.currentKm() * 1000;
  ok(t3 > t2 + 150 && t3 < t2 + 300, 'A10: driving after the re-anchor counts once', t3 - t2);
  ok(w2.LiveMiles.reseedFromStore() === false, 'A11: a second reseed is a no-op once the engine is ahead');

  /* World 3: a SMALLER stale record never drags a live engine back. */
  const backing3 = {};
  const w3 = mkMilesWorld(backing3, T0);
  w3.LiveMiles.startDay(KEY, { resume: true });
  for (let i = 0; i <= 5; i++) {
    w3.setNow(T0 + i * 10000);
    w3.geo.deliver(mfix(51.05 + i * 0.001, -114.07, T0 + i * 10000));
  }
  await flush();
  const liveBefore = w3.LiveMiles.currentKm() * 1000;
  const stale = JSON.parse(backing1['mt_livemiles']);
  stale.days[KEY].totalM = 100; stale.days[KEY].segs = []; stale.days[KEY].crumbs = [];
  backing3['mt_livemiles'] = JSON.stringify(stale);
  ok(w3.LiveMiles.reseedFromStore() === false && w3.LiveMiles.currentKm() * 1000 === liveBefore,
    'A12: a stale smaller record never rewinds the live engine');

  await partB();
})().catch(function (e) { console.log('  FAIL - Part A threw: ' + (e && e.stack || e)); fail++; partB(); });

/* ==================================================================
 * Part B — GeoLoads reseed (item 3). The loads-gps-fix world
 * pattern: the REAL js/geoloads.js over a stub store; the day's
 * machine count + signed corr must come back exactly.
 * ================================================================== */
const glSrc = read('js/geoloads.js');
function mkStore(seed) {
  const data = {};
  Object.keys(seed || {}).forEach(function (k) { data[k] = JSON.parse(JSON.stringify(seed[k])); });
  return { get: function (k, d) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : d; },
    set: function (k, v) { data[k] = JSON.parse(JSON.stringify(v)); },
    del: function (k) { delete data[k]; }, _data: data };
}
function mkLoadsWorld(store) {
  const sb = { console: console, Date: Date, Math: Math, JSON: JSON };
  sb.window = sb;
  let handler = null;
  sb.LiveMiles = { available: function () { return true; },
    subscribe: function (fn) { handler = fn; } };
  sb.App = { _store: store };
  vm.createContext(sb);
  vm.runInContext(glSrc, sb);
  return { GeoLoads: sb.GeoLoads, feed: function (fix) { return handler(fix); } };
}
const GT0 = (function () { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 6, 0, 0).getTime(); })();
function gdstr(ts) { const d = new Date(ts); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
const GDAY = gdstr(GT0);
function goff(lat, lng, eM, nM) { return [lat + nM / 111320, lng + eM / (111320 * Math.cos(lat * Math.PI / 180))]; }
const GSTILL = [[0, 0], [15, 10], [-12, 8], [10, -14], [-8, -10]];
function gfx(tS, ll) { return { latitude: ll[0], longitude: ll[1], accuracy: 8, time: GT0 + tS * 1000 }; }
function gpark(w, clock, c, durS) {
  const steps = Math.floor(durS / 10);
  for (let k = 0; k <= steps; k++) { const s = GSTILL[k % GSTILL.length]; w.feed(gfx(clock.t, goff(c.lat, c.lng, s[0], s[1]))); clock.t += 10; }
}
function gdrive(w, clock, A, B, durS) {
  const steps = Math.floor(durS / 10);
  for (let k = 1; k <= steps; k++) { const f = k / steps; w.feed(gfx(clock.t, [A.lat + (B.lat - A.lat) * f, A.lng + (B.lng - A.lng) * f])); clock.t += 10; }
}
const GPIT = { lat: 50.9850, lng: -114.0520 };
const GDUMP = { lat: 50.9505, lng: -114.0145 };
function dspSeed() {
  return { dsp_active: { id: 'dsp-v222', jobSite: 'Pit', dropoff: 'Dump', status: 'active',
    lat: GPIT.lat, lng: GPIT.lng, dumpLat: GDUMP.lat, dumpLng: GDUMP.lng },
    nav_data: { personal: [], work: [], recent: [] } };
}
function cycle(w, clock) {
  gpark(w, clock, GPIT, 130); gdrive(w, clock, GPIT, GDUMP, 120); gpark(w, clock, GDUMP, 130);
  gdrive(w, clock, GDUMP, GPIT, 120);
}
async function partB() {
  console.log('— Part B: GeoLoads reseed after a reinstall (item 3) —');
  const KEY = 's' + GT0;
  const storeA = mkStore(dspSeed());
  const wA = mkLoadsWorld(storeA);
  ok(wA.GeoLoads.startDay(KEY) === true, 'B1: the original day arms from the dispatch pins');
  const clockA = { t: 0 };
  cycle(wA, clockA); cycle(wA, clockA);
  ok(wA.GeoLoads.today().count === 2, 'B2: two cycles counted by the machine', wA.GeoLoads.today().count);
  wA.GeoLoads.nudge(1);
  const beforeA = wA.GeoLoads.today();
  ok(beforeA.count === 3 && beforeA.corr === 1, 'B3: his +1 tap rides on top (3 shown, corr 1)', JSON.stringify(beforeA));
  wA.GeoLoads.flush();
  const savedLoads = JSON.parse(JSON.stringify(storeA._data.geoloads));
  ok(savedLoads.days[GDAY] && savedLoads.days[GDAY].state && savedLoads.days[GDAY].state.count === 2 && savedLoads.days[GDAY].corr === 1,
    'B4: the persisted day record carries the machine count (state 2) + corr 1');

  /* The reinstall: fresh store, boot startDay first (count 0),
     then the record lands and the re-attach reseeds. */
  const storeB = mkStore(dspSeed());
  const wB = mkLoadsWorld(storeB);
  ok(wB.GeoLoads.startDay(KEY, { resume: true }) === true, 'B5: the reinstall boot re-arms');
  ok(wB.GeoLoads.today().count === 0, 'B6: pre-pull the count sits at 0 (the field state)');
  storeB.set('geoloads', savedLoads);
  ok(wB.GeoLoads.reseedFromStore() === true, 'B7: reseed adopts the landed record');
  const afterB = wB.GeoLoads.today();
  ok(afterB.count === 3 && afterB.corr === 1, 'B8: count AND corr come back exactly (3, corr 1)', JSON.stringify(afterB));
  const clockB = { t: 2000 };
  cycle(wB, clockB);
  ok(wB.GeoLoads.today().count === 4, 'B9: the next real cycle counts on top — 4, no double, no loss', wB.GeoLoads.today().count);
  ok(wB.GeoLoads.reseedFromStore() === false, 'B10: a second reseed is a no-op once live is ahead');

  /* His hand is never overwritten: a corr nudged THIS page life
     survives a reseed of an older record. */
  const storeC = mkStore(dspSeed());
  const wC = mkLoadsWorld(storeC);
  wC.GeoLoads.startDay(KEY, { resume: true });
  wC.GeoLoads.nudge(1); // he re-adds a load by hand before the pull lands
  storeC.set('geoloads', savedLoads);
  wC.GeoLoads.reseedFromStore();
  const afterC = wC.GeoLoads.today();
  ok(afterC.count === 3 && afterC.corr === 1, 'B11: his in-life tap is kept and re-persisted over the landed record', JSON.stringify(afterC));

  partC();
}

/* ==================================================================
 * Part C — Navigator: the fix-stream fallback + watchdog (item 4)
 * and the in-app park (item 5). The v139 instrumented-DOM pattern,
 * extended: a controllable watchPosition, captured intervals, a
 * fake clock, the app's fix stream (LiveMiles.subscribe), and a
 * #pipDock the parked screen can land in.
 * ================================================================== */
const navSrc = read('modules/navigator.js');
const fixture = JSON.parse(read('tools/navigator-fixture-tripb.json'));
const ORIGIN = [51.0955, -114.099], DEST = [51.1075, -114.0845];

function cEl() {
  const e = { children: {}, style: {}, _html: '', _htmlSets: 0, value: '', onclick: null,
    _text: '', _attrs: {}, _listeners: {}, _kids: [], _parent: null,
    addEventListener: function (ev, fn) { (e._listeners[ev] = e._listeners[ev] || []).push(fn); },
    appendChild: function (c) { e._kids.push(c); c._parent = e; return c; },
    classList: { _s: new Set(),
      add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); },
      toggle: function (c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { on ? this._s.add(c) : this._s.delete(c); } },
      contains: function (c) { return this._s.has(c); } },
    querySelector: function (sel) { return e.children[sel] || null; },
    querySelectorAll: function () { return []; },
    getAttribute: function () { return null; },
    setAttribute: function (n, v) { e._attrs[n] = String(v); } };
  Object.defineProperty(e, 'textContent', { configurable: true,
    get: function () { return e._text; }, set: function (v) { e._text = String(v); } });
  Object.defineProperty(e, 'innerHTML', { configurable: true,
    get: function () { return e._html; }, set: function (v) { e._htmlSets++; e._html = String(v); } });
  return e;
}

function mkNavWorld() {
  let fakeNow = 1792300000000;
  class FakeDate extends Date {
    constructor() { super(fakeNow); }
    static now() { return fakeNow; }
  }
  const storeData = { navigator: { serverUrl: 'http://nav.test', profile: {}, muted: false, mode: 'truck' } };
  const store = { get: function (k, d) { return storeData[k] !== undefined ? storeData[k] : d; },
    set: function (k, v) { storeData[k] = v; }, del: function (k) { delete storeData[k]; } };
  const ids = ['nv_banner', 'nv_map', 'nv_mode_truck', 'nv_mode_car', 'nv_follow', 'nv_mute',
    'nv_q', 'nv_search', 'nv_results', 'nv_destnote', 'nv_route', 'nv_end', 'nv_note', 'nv_steps',
    'nv_pq', 'nv_presults', 'nv_back', 'nv_drive', 'nv_drive_screen', 'nv_drive_map',
    'nvd_dist', 'nvd_inst', 'nvd_road', 'nvd_eta_main', 'nvd_eta_sub', 'nvd_reroute', 'nvd_plane',
    'nvd_pip_line', 'nvd_mute', 'nvd_exit', 'nvd_you', 'nvd_avatar_picker'];
  const reg = {};
  ids.forEach(function (id) { reg[id] = cEl(); });
  reg.nv_banner.children['.nv-banner-main'] = cEl();
  reg.nv_banner.children['.nv-banner-sub'] = cEl();
  const dock = cEl(); dock.id = 'pipDock';
  const body = cEl();
  body.querySelector = function (sel) { return reg[sel.slice(1)] || null; };
  const calls = { spoken: [], markerSets: [], youSets: [], panTos: [], views: [], dashboards: 0, opens: [] };
  const mapHandlers = {};
  function makeMapStub() {
    const m = { _center: null, _zoom: 15,
      setView: function (c, z) { calls.views.push([c, z]); m._center = c; if (z) m._zoom = z; return m; },
      panTo: function (c) { calls.panTos.push(c); m._center = c; return m; },
      getCenter: function () { return m._center ? { lat: m._center[0], lng: m._center[1] } : null; },
      getZoom: function () { return m._zoom; },
      on: function (ev, fn) { mapHandlers[ev] = fn; },
      addLayer: function () { return m; }, removeLayer: function () { return m; },
      remove: function () {}, fitBounds: function () {}, invalidateSize: function () {} };
    return m;
  }
  const L = {
    map: function () { return makeMapStub(); },
    tileLayer: function () { return { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return this; }, on: function () {} }; },
    marker: function (ll) { const mk = { _ll: ll, addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return mk; },
      setLatLng: function (nll) { mk._ll = nll; calls.markerSets.push(nll); } }; return mk; },
    circleMarker: function () { const cm = { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return cm; }, setLatLng: function (nll) { calls.youSets.push(nll); } }; return cm; },
    polyline: function () { const pl = { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return pl; }, setLatLngs: function () {}, getBounds: function () { return {}; } }; return pl; },
    layerGroup: function (kids) { const g = { _kids: kids, getLayers: function () { return g._kids.slice(); }, addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return g; } }; return g; }
  };
  const watchCbs = []; let watchSeq = 0;
  const intervals = {}; let intSeq = 0;
  let milesFn = null; let geoLast = null;
  const world = {
    console: console, JSON: JSON, Math: Math, Date: FakeDate, setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: function (fn) { const id = ++intSeq; intervals[id] = fn; return id; },
    clearInterval: function (id) { delete intervals[id]; },
    window: null,
    document: { hidden: false,
      addEventListener: function () {}, removeEventListener: function () {},
      createElement: function () { return { href: '', style: {}, click: function () {}, remove: function () {} }; },
      body: { appendChild: function () {}, classList: { add: function () {}, remove: function () {} } },
      getElementById: function (id) { return id === 'pipDock' ? dock : (reg[id] || null); } },
    open: function () {},
    App: { _esc: function (s) { return String(s == null ? '' : s); }, _store: store,
      _today: function () { return '2026-10-22'; },
      openModule: function (k) { calls.opens.push(k); },
      showDashboard: function () { calls.dashboards++; } },
    Meticulous: {}, L: L,
    LiveMiles: { available: function () { return true; },
      subscribe: function (fn) { milesFn = fn; return function () {}; } },
    MeticulousGeo: { last: function () { return geoLast; } },
    navigator: { geolocation: {
      watchPosition: function (cb) { watchCbs.push(cb); return ++watchSeq; },
      clearWatch: function () {} } },
    speechSynthesis: { cancel: function () {}, speak: function (u) { calls.spoken.push(u.text); } },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    fetch: function (url) {
      if (url.indexOf('/route') >= 0) return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(fixture); } });
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); } });
    }
  };
  world.window = world;
  vm.createContext(world);
  vm.runInContext(navSrc, world);
  return { api: world.Meticulous.modules.navigator, reg: reg, body: body, dock: dock, calls: calls,
    mapHandlers: mapHandlers, watchCbs: watchCbs, intervals: intervals,
    fireWatch: function (la, lo, hd, sp) { const cb = watchCbs[watchCbs.length - 1]; if (cb) cb({ coords: { latitude: la, longitude: lo, heading: hd, speed: sp } }); },
    feedMiles: function (fix) { if (milesFn) milesFn(fix); },
    setGeoLast: function (f) { geoLast = f; },
    advance: function (ms) { fakeNow += ms; },
    now: function () { return fakeNow; },
    pumpIntervals: function () { Object.keys(intervals).forEach(function (id) { try { intervals[id](); } catch (e) {} }); } };
}
function ctick() { return new Promise(function (r) { setTimeout(r, 15); }); }

async function partC() {
  console.log('— Part C: Navigator fix stream + watchdog + park (items 4, 5) —');
  const w = mkNavWorld();
  w.api.render(w.body);
  w.fireWatch(ORIGIN[0], ORIGIN[1], 40, 0);
  w.mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } });
  await ctick(); await ctick();
  w.reg.nv_drive.onclick();
  await ctick();
  ok(w.watchCbs.length >= 1, 'C1: the drive registers its GPS watch');
  ok(!w.reg.nv_drive_screen.classList.contains('hidden'), 'C2: the drive screen is open');
  const setsAtOpen = w.calls.panTos.length;

  /* The module watch goes SILENT (the field freeze: no error, no
     fixes). The app's own stream keeps delivering — the rendered
     position must advance on it. This is the item-4 instrument. */
  const T1 = w.now() + 60000;
  w.feedMiles({ latitude: 51.1000, longitude: -114.0920, accuracy: 8, time: T1 });
  const adv = w.calls.panTos.length > setsAtOpen &&
    Math.abs(w.calls.panTos[w.calls.panTos.length - 1][0] - 51.1000) < 1e-9;
  ok(adv, 'C3: with the module watch silent, an app-stream fix ADVANCES the rendered position (NAV-STUCK)');
  const setsAfterAdv = w.calls.panTos.length;
  w.feedMiles({ latitude: 51.1000, longitude: -114.0920, accuracy: 8, time: T1 });
  ok(w.calls.panTos.length === setsAfterAdv, 'C4: the same fix twice is fed once (time dedupe)');
  w.feedMiles({ latitude: 51.0900, longitude: -114.1000, accuracy: 8, time: T1 - 30000 });
  ok(w.calls.panTos.length === setsAfterAdv, 'C5: a stale fix never drags the position back');

  /* The watchdog: 12s+ of total silence re-registers the watch. */
  const watchesBefore = w.watchCbs.length;
  w.advance(13000);
  w.pumpIntervals();
  ok(w.watchCbs.length > watchesBefore, 'C6: after >12 s of silence the watchdog re-registers the watch');

  /* Item 5: Back parks the drive over the DASHBOARD. */
  const dashBefore = w.calls.dashboards;
  const handled = w.api.back();
  ok(handled === true, 'C7: Back during a drive is handled by the module');
  ok(w.dock._kids.indexOf(w.reg.nv_drive_screen) >= 0, 'C8: the drive screen lands in the in-app dock (screen-in-screen)');
  ok(w.reg.nv_drive_screen.classList.contains('nv-mini'), 'C9: the parked screen wears the mini posture');
  ok(w.calls.dashboards === dashBefore + 1, 'C10: the DASHBOARD is raised beneath it — never the launcher');
  ok(w.api.keepAlive() === true, 'C11: a parked drive reports keepAlive (the shell must not tear it down)');
  const setsParked = w.calls.panTos.length;
  w.feedMiles({ latitude: 51.1030, longitude: -114.0880, accuracy: 8, time: w.now() + 90000 });
  ok(w.calls.panTos.length > setsParked, 'C12: the parked drive stays ALIVE — fixes still move it in the dock');

  /* Reopening restores the full drive; ending it from there works. */
  w.api.render(w.body);
  ok(w.body._kids.indexOf(w.reg.nv_drive_screen) >= 0 && !w.reg.nv_drive_screen.classList.contains('nv-mini'),
    'C13: reopening the module restores the full drive screen');
  ok(w.api.keepAlive() === false, 'C14: a restored drive is no longer parked');
  const htmlBefore = w.body._htmlSets;
  w.reg.nvd_exit.onclick();
  ok(w.body._htmlSets > htmlBefore, 'C15: End Drive from a restored drive rebuilds the module face');
  ok(w.reg.nv_drive_screen.classList.contains('hidden'), 'C16: the drive screen closes with the drive');

  partD();
}

/* ==================================================================
 * Part D — statics: the bubble arm (item 1), the widget (item 6),
 * and the shell wiring for items 2/3/5.
 * ================================================================== */
function partD() {
  console.log('— Part D: statics — bubble arm, shell wiring, widget —');
  const app = read('js/app.js');
  const sht = read('js/shifttrack.js');
  const idx = read('index.html');
  const css = read('css/style.css');

  /* Item 1 — the arm rides the durable web session (v38 shell). */
  ok(sht.indexOf('setSession: function (on)') >= 0 && sht.indexOf('p.setSession({ on:') >= 0,
    'D1: the web layer exposes the session arm to the shell (ShiftTrack.setSession)');
  ok(app.indexOf('ShiftTrack.setSession(true)') >= 0 &&
     sht.indexOf('ShiftTrack.setSession(true)') >= 0 && sht.indexOf('ShiftTrack.setSession(false)') >= 0,
    'D2: the arm rises on session start/re-attach and falls at session stop');
  const plug = readN('android/app/src/main/java/com/meticuloustechnologies/app/ShiftTrackPlugin.java');
  ok(plug.indexOf('public void setSession') >= 0 && plug.indexOf('KEY_SESSION_ARMED') >= 0,
    'D3: the native plugin takes the arm and persists it apart from the service-run flag');
  const cs = readN('android/app/src/main/java/com/meticuloustechnologies/app/CrumbStore.java');
  ok(cs.indexOf('KEY_SESSION_ARMED') >= 0, 'D4: the armed flag has its own persisted key');
  const ma = readN('android/app/src/main/java/com/meticuloustechnologies/app/MainActivity.java');
  ok(ma.indexOf('sessionArmedPersisted()') >= 0 && ma.indexOf('KEY_SESSION_ARMED') >= 0,
    'D5: onUserLeaveHint honours the persisted arm even after a reinstall wiped the statics');
  ok(idx.indexOf('id="bubbleFace"') >= 0 && idx.indexOf('id="bubClock"') >= 0 &&
     idx.indexOf('id="bubPlay"') >= 0 && idx.indexOf('id="bubStop"') >= 0 && idx.indexOf('id="bubLoads"') >= 0,
    'D6: the bubble face carries ONLY timer + play/stop + loads');

  /* Items 2/3 — the re-attach reseeds, at once and after the pull. */
  ok(app.indexOf('LiveMiles.reseedFromStore()') >= 0 && app.indexOf('GeoLoads.reseedFromStore()') >= 0,
    'D7: the sign-in re-attach reseeds both engines from the store');
  ok(app.indexOf('whenFirstPullDone(12000).then') >= 0 &&
     (app.match(/LiveMiles\.reseedFromStore\(\)/g) || []).length >= 2 &&
     (app.match(/GeoLoads\.reseedFromStore\(\)/g) || []).length >= 2,
    'D8: a post-first-pull pass reseeds both engines again once the cloud records land');
  const miles = read('js/miles.js');
  ok(miles.indexOf('reseedFromStore: function ()') >= 0 && miles.indexOf('saved.totalM > liveTotal') >= 0,
    'D9: LiveMiles reseeds only when the persisted record is AHEAD');
  const gl = read('js/geoloads.js');
  ok(gl.indexOf('reseedFromStore: function ()') >= 0 && gl.indexOf('nudgedLive') >= 0,
    'D10: GeoLoads reseeds the machine count and never overwrites an in-life hand correction');

  /* Item 5 shell side: teardown/open honour keepAlive; dock exists. */
  ok(app.indexOf('prev.keepAlive()') >= 0 && app.indexOf('mod.keepAlive()') >= 0,
    'D11: the shell keeps a parked module alive across navigation');
  ok(idx.indexOf('id="pipDock"') >= 0 && css.indexOf('#pipDock') >= 0 && css.indexOf('.nv-drive.nv-mini') >= 0,
    'D12: the in-app screen-in-screen dock + mini posture ship');

  /* Item 6 — the widget: tight 2x2, resizable, filled. */
  const winfo = readN('android/app/src/main/res/xml/widget_tracker_info.xml');
  ok(winfo.indexOf('targetCellWidth="2"') >= 0 && winfo.indexOf('targetCellHeight="2"') >= 0,
    'D13: the widget defaults to a tight 2x2 tile');
  ok(winfo.indexOf('resizeMode="horizontal|vertical"') >= 0 && winfo.indexOf('minResizeWidth="110dp"') >= 0,
    'D14: the widget is user-resizable with a sane floor');
  const wlay = readN('android/app/src/main/res/layout/widget_tracker.xml');
  ok(wlay.indexOf('layout_weight="1"') >= 0, 'D15: the layout fills the tile (weighted spacer — no empty body)');
  const tw = readN('android/app/src/main/java/com/meticuloustechnologies/app/TrackerWidget.java');
  ok(tw.indexOf('onAppWidgetOptionsChanged') >= 0, 'D16: a resize re-pushes the widget views at once');
  const gradle = readN('android/app/build.gradle');
  ok(gradle.indexOf('versionCode 14') >= 0, 'D17: the shell carrying all this is v39 (versionCode 14) — rolled forward at the v39 pointer; the v222 facts ride in its bundle');

  console.log('\nfix-batch-v222: ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}
