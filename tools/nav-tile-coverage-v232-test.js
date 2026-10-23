'use strict';
/* v232 NAV-MAP-BLANK-V40 — reproduction-first suite for the blank
 * drive map (owner's screen recording, Fri Oct 23 2026 10:18 MDT:
 * Navigator open, route live to Piegan Dog Park, instruction card
 * + inset + ETA all working — the MAIN map a blank beige field,
 * no road network around the truck, parked at home).
 *
 * CHARACTERIZED ROOT CAUSE (live probe, this run): the drive map
 * itself is healthy — Leaflet builds, 60/60 tiles LOADED at his
 * home coordinates (51.15709, -113.93862) — but the loaded tiles
 * are EMPTY: Esri World Street Map serves a single-colour blank
 * tile (2,421 B, one colour #f3f0cf) at zoom 18 AND 17 for his
 * newer suburb, while the same source has real content at zoom
 * 16 (and downtown has content at 18). The drive map is pinned
 * to zoom 18 (v178 "one zoom closer"), so around his home — and
 * any fringe/new area Esri hasn't detailed — the road network
 * simply isn't in the tiles. Routing/inset/ETA are app-drawn,
 * which is why only the map was blank.
 *
 * THE FIX: the drive tile layer caps its NATIVE zoom at 16
 * (maxNativeZoom) while the view stays at 18 — Leaflet scales
 * the z16 tiles up, so the framing/readability he chose is
 * unchanged and the roads that exist at z16 always draw.
 *
 * This suite drives the REAL modules/navigator.js in a vm world
 * with a RECORDING Leaflet stub and pins the layer contract:
 * RED before the fix (no maxNativeZoom on the layer), GREEN
 * after. The live RED->GREEN (real tiles, real screenshots) is
 * the browser probe in the run report; this suite keeps the
 * contract from regressing.
 *
 * Run: node tools/nav-tile-coverage-v232-test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

const navSrc = read('modules/navigator.js');
const navModSrc = read('modules/navigation.js');
const fixture = JSON.parse(read('tools/navigator-fixture-tripb.json'));
const ORIGIN = [51.0955, -114.099], DEST = [51.1075, -114.0845];

/* ---------- stub DOM (drive-surface pattern) ---------- */
function el(id) {
  const e = {
    id: id || '', children: {}, style: {}, _html: '', textContent: '', value: '', onclick: null,
    _listeners: {}, _kids: [],
    addEventListener: function (ev, fn) { (e._listeners[ev] = e._listeners[ev] || []).push(fn); },
    removeEventListener: function () {},
    fire: function (ev, arg) { (e._listeners[ev] || []).slice().forEach(function (f) { f(arg || {}); }); },
    appendChild: function (kid) { e._kids.push(kid); kid._parent = e; return kid; },
    classList: {
      _s: new Set(),
      add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); },
      toggle: function (c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { on ? this._s.add(c) : this._s.delete(c); } },
      contains: function (c) { return this._s.has(c); }
    },
    querySelector: function (sel) { return e.children[sel] || null; },
    querySelectorAll: function () { return []; },
    getAttribute: function () { return null; },
    setAttribute: function () {}
  };
  Object.defineProperty(e, 'innerHTML', {
    configurable: true,
    get: function () { return e._html; }, set: function (v) { e._html = String(v); }
  });
  return e;
}
function resultsEl() {
  const e = el('nv_presults');
  e._rows = {};
  e.querySelectorAll = function (sel) {
    if (sel !== '[data-pid]') return [];
    return Object.keys(e._rows).map(function (k) { return e._rows[k]; });
  };
  Object.defineProperty(e, 'innerHTML', {
    get: function () { return e._html; },
    set: function (v) {
      e._html = String(v); e._rows = {};
      const re = /data-pid="([^"]+)"/g; let m;
      while ((m = re.exec(e._html))) {
        const pid = m[1];
        e._rows[pid] = { onclick: null, getAttribute: function (n) { return n === 'data-pid' ? pid : null; },
          click: function () { if (this.onclick) this.onclick(); } };
      }
    }
  });
  return e;
}
function makeLocal() {
  const mem = {};
  return { getItem: k => (k in mem) ? mem[k] : null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
}

function makeWorld(opts) {
  opts = opts || {};
  const storeData = opts.storeData || {};
  const store = {
    get: function (k, d) { return storeData[k] !== undefined ? storeData[k] : d; },
    set: function (k, v) { storeData[k] = v; },
    del: function (k) { delete storeData[k]; }
  };
  const ids = ['nv_banner', 'nv_map', 'nv_mode_truck', 'nv_mode_car', 'nv_follow', 'nv_mute',
    'nv_q', 'nv_search', 'nv_results', 'nv_destnote', 'nv_route', 'nv_end', 'nv_note', 'nv_steps',
    'nv_pq', 'nv_presults', 'nv_back', 'nv_drive', 'nv_drive_screen', 'nv_drive_map',
    'nvd_dist', 'nvd_inst', 'nvd_road', 'nvd_eta_main', 'nvd_eta_sub', 'nvd_reroute', 'nvd_plane',
    'nvd_mute', 'nvd_exit', 'nvd_recenter', 'nvd_you', 'nvd_pip_line', 'nvd_speed', 'nvd_speedwrap',
    'nvd_inset', 'pipDock', 'bubbleFace', 'bubClock', 'bubStatus', 'bubLoads', 'bubPlay', 'bubPlus', 'bubMinus', 'bubStop'];
  const reg = {};
  ids.forEach(function (id) { reg[id] = el(id); });
  reg.nv_presults = resultsEl();
  reg.bubbleFace.classList.add('hidden');
  reg.nv_banner.children['.nv-banner-main'] = el();
  reg.nv_banner.children['.nv-banner-sub'] = el();
  const body = el('modBody');
  body.querySelector = function (sel) {
    const id = sel.slice(1);
    return reg[id] || (reg[id] = el(id));
  };
  body.querySelectorAll = function () { return []; };

  const calls = { fetch: [], maps: [], tileLayers: [], spoken: [] };
  const mapHandlers = {};
  function makeMapStub() {
    const m = {
      _adds: 0, _views: [], _panTos: [], _center: null, _zoom: 15,
      setView: function (c, z) { m._views.push([c, z]); m._center = (c && c.lat !== undefined) ? [c.lat, c.lng] : c; if (z) m._zoom = z; return m; },
      panTo: function (c) { const cc = (c && c.lat !== undefined) ? [c.lat, c.lng] : c; m._panTos.push(cc); m._center = cc; return m; },
      setZoomAround: function () {},
      getCenter: function () { return m._center ? { lat: m._center[0], lng: m._center[1] } : null; },
      getZoom: function () { return m._zoom; },
      on: function (ev, fn) { mapHandlers[ev] = fn; },
      addLayer: function () { m._adds++; return m; },
      removeLayer: function () { return m; },
      remove: function () {}, fitBounds: function () {}, invalidateSize: function () {}
    };
    return m;
  }
  const L = {
    map: function () { const m = makeMapStub(); calls.maps.push(m); return m; },
    /* RECORDING tile layer: captures the url + options the module
       builds the layer with, and which map it was added to. */
    tileLayer: function (url, o) {
      const rec = { url: url, opts: o || {}, addedTo: null };
      calls.tileLayers.push(rec);
      const tl = { _rec: rec, addTo: function (m) { rec.addedTo = m; if (m && m.addLayer) m.addLayer(this); return tl; },
        on: function () { return tl; }, setUrl: function () {}, redraw: function () {} };
      rec.stub = tl;
      return tl;
    },
    marker: function () { return { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return this; }, setLatLng: function () {}, setIcon: function () {}, setOpacity: function () {} }; },
    divIcon: function (o) { return o || {}; },
    circleMarker: function () { const cm = { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return cm; }, setLatLng: function () {} }; return cm; },
    polyline: function () { const pl = { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return pl; }, setLatLngs: function () {}, getBounds: function () { return {}; } }; return pl; },
    layerGroup: function (kids) { const g = { _kids: kids, getLayers: function () { return g._kids.slice(); }, addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return g; } }; return g; }
  };
  let geoCb = null;
  const world = {
    console: console, JSON: JSON, Math: Math, Date: Date, setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: setInterval, clearInterval: clearInterval,
    requestAnimationFrame: function (cb) { return setTimeout(function () { cb(Date.now()); }, 5); },
    cancelAnimationFrame: function (id) { clearTimeout(id); },
    window: null, localStorage: makeLocal(),
    document: {
      hidden: false, visibilityState: 'visible',
      addEventListener: function () {}, removeEventListener: function () {},
      createElement: function () { return { href: '', style: {}, click: function () {}, remove: function () {} }; },
      getElementById: function (id) { return reg[id] || null; },
      body: { appendChild: function () {}, classList: { add: function () {}, remove: function () {} } }
    },
    App: {
      _esc: function (s) { return String(s == null ? '' : s); }, _store: store,
      _today: function () { return '2026-10-23'; },
      openModule: function () {},
      showDashboard: function () {},
      tracker: { status: 'running' },
      _pip: false, _authLocked: function () { return false; }
    },
    Meticulous: {},
    L: L,
    navigator: { geolocation: { watchPosition: function (cb) { geoCb = cb; return 7; }, clearWatch: function () {} } },
    speechSynthesis: { cancel: function () {}, speak: function (u) { calls.spoken.push(u.text); } },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    fetch: function (url) {
      calls.fetch.push(url);
      if (url.indexOf('/route') >= 0) {
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(fixture); } });
      }
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); } });
    }
  };
  world.window = world;
  vm.createContext(world);
  vm.runInContext(navModSrc, world);
  vm.runInContext(navSrc, world);
  return {
    world: world, reg: reg, body: body, calls: calls,
    firePos: function (la, lo, hd, sp) { if (geoCb) geoCb({ coords: { latitude: la, longitude: lo, heading: hd, speed: sp }, timestamp: Date.now() }); }
  };
}
function tick() { return new Promise(function (r) { setTimeout(r, 15); }); }

(async function () {
  console.log('— NAV-MAP-BLANK-V40: the drive tile layer must draw roads where Esri has no z17/z18 detail —');
  const w = makeWorld({ storeData: {
    navigator: { profile: {}, muted: true, mode: 'truck' },
    nav_pending: { lat: DEST[0], lng: DEST[1], name: 'Test Dest' }
  } });
  const api = w.world.Meticulous.modules.navigator;
  api.render(w.body);
  w.firePos(ORIGIN[0], ORIGIN[1], 45, 0); // parked, like his recording
  await tick(); await tick();
  if (w.reg.nv_drive.onclick) w.reg.nv_drive.onclick();
  await tick();
  const driveMap = w.calls.maps[w.calls.maps.length - 1];
  check('A0: drive is live and the drive map exists', !!driveMap && w.calls.maps.length >= 2, 'maps=' + w.calls.maps.length);
  const driveLayers = w.calls.tileLayers.filter(function (r) { return r.addedTo === driveMap; });
  check('A1: exactly one tile layer rides the drive map', driveLayers.length === 1, 'layers=' + driveLayers.length);
  const rec = driveLayers[0] || { url: '', opts: {} };
  check('A2: the drive layer is the Esri street source (source swaps belong to the colours batch)',
    /server\.arcgisonline\.com.*World_Street_Map/.test(rec.url), rec.url);
  check('A3: the view framing stays at zoom 18 (his v178 readability choice)',
    driveMap._views.some(function (v) { return v[1] === 18; }) && rec.opts.maxZoom === 18,
    'views=' + JSON.stringify(driveMap._views) + ' maxZoom=' + rec.opts.maxZoom);
  check('A4: THE FIX — tiles are fetched at native zoom 16, where Esri actually has the road network, and scaled up to the z18 view',
    rec.opts.maxNativeZoom === 16, 'maxNativeZoom=' + rec.opts.maxNativeZoom);
  try { api.teardown(); } catch (e) {}

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR', e && e.stack || e); process.exit(2); });
