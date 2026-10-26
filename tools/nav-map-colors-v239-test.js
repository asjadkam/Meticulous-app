'use strict';
/* Meticulous v239 — NAV-MAP-COLORS-3D suite.
 *
 * The owner, Fri Oct 23, 2026 11:36 MDT (drive video + Rand
 * McNally screenshots): "the colours on our map are abysmal" —
 * pale beige/washed against Rand McNally's vibrant, 3D-looking
 * map (saturated greens/blues, clear roads).
 *
 * RE-BASELINE ON THE FIXED BUILD (this run, live tiles at z15,
 * the level the drive layer actually fetches since v235):
 * the washed beige of his Oct 23 morning was largely Esri's
 * BLANK-tile colour — with real z15 content painting, what
 * remains is Esri World Street Map's muted palette. Measured
 * mean HSV saturation (ffmpeg decode of the live CDN tiles):
 *   his home tile (51.15709,-113.93862):  Esri WSM 0.150
 *   downtown tile:                        Esri WSM 0.126
 *   OSM standard, same tiles:             0.103 / 0.106 (LOWER)
 *   Esri World Topo, same tiles:          0.000 / 0.011 (grey)
 * So a SOURCE swap cannot beat the shipped source — OSM is
 * more washed, Topo is essentially greyscale at z15 here.
 * The lever that closes the gap on the SAME proven tiles is
 * a colour lift scoped to the drive street layer only:
 * contrast(1.06) saturate(1.38) — simulated on the live tiles
 * before shipping: home 0.150 -> 0.202 (+35%), downtown
 * 0.126 -> 0.167 (+32%), vivid-pixel share downtown 3.3% ->
 * 9.0%. The tile-coverage contract (Esri source, native z15,
 * view z18) is untouched, so the blank-map fix cannot
 * regress; the satellite/hillshade layers (v240) carry their
 * own classes and NO lift (aerial photos are already true
 * colour).
 *
 * v260 SUPERSEDE (NAV-VIBRANT-COLORS + NAV-PIXELATED-ROADS,
 * owner, Mon Oct 26, 2026 07:41 MDT): the source conclusion
 * above held only while the layer was capped at z15 (where
 * OSM is both pale AND no sharper). At native z18 the
 * picture flips: Esri is blank over his areas while OSM
 * serves real detail, so v260 swaps the drive street source
 * to OSM standard at native z18 and re-tunes the lift for
 * OSM's palette, simulated in PIL on the live tiles:
 * saturate(2.3) hue-rotate(11deg) contrast(1.16) — suburb
 * mean saturation 0.052 -> 0.110, Deerfoot/Bow 0.111 ->
 * 0.206; water -> #98d1ff, trunk -> #ffbe40, primary ->
 * #ffe749, motorway -> #ff767e (the +11deg rotation holds
 * it out of the v124 hot-pink band). The pins below are
 * re-based to the v260 contract.
 *
 * RED before the fix: the drive layer is created with no
 * className and the sheet carries no drive-tile lift.
 *
 * Run: node tools/nav-map-colors-v239-test.js
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
const css = read('css/style.css');
const fixture = JSON.parse(read('tools/navigator-fixture-tripb.json'));
const ORIGIN = [51.0955, -114.099], DEST = [51.1075, -114.0845];

console.log('— v239: wiring pins —');
check('the drive tile spec is the OpenStreetMap standard source (v260 re-pin: the only keyless source with real z18 detail over his areas — Esri z17/18 verified blank Oct 26; the v239 no-swap conclusion held only at the z15 cap)',
  /tile\.openstreetmap\.org/.test(navSrc));
/* v240 supersede note: the layer creation moved into
   paintDriveLayers (the layers switch re-runs it); the class
   now rides the spec (driveTileSpec().cls) into that call. */
check('the drive layer is created with the street class (the lift scope)',
  /cls: 'nv-tile-street'/.test(navSrc) &&
  /resilientTileLayer\(spec\.url, \{[^}]*className: spec\.cls/.test(navSrc));
{
  const i = css.indexOf('.nv-tile-street{');
  const r = i === -1 ? '' : css.slice(i, css.indexOf('}', i) + 1);
  const sat = /saturate\(([\d.]+)\)/.exec(r);
  const con = /contrast\(([\d.]+)\)/.exec(r);
  check('the street-tile lift rule exists', i !== -1, r);
  check('the lift saturates hard enough to close the measured gap (>= 1.3; v260: 2.3, tuned for OSM\'s paler raw palette)',
    !!sat && parseFloat(sat[1]) >= 1.3, r);
  check('the lift adds a measured contrast step (v260 re-pin: 1.16 — the v239 band 1.03..1.10 was tuned for Esri; OSM raw needs the deeper step, simulated on the live tiles)',
    !!con && parseFloat(con[1]) >= 1.10 && parseFloat(con[1]) <= 1.20, r);
}
check('the lift is scoped to the street class only (no blanket drive-tile filter)',
  css.indexOf('.nv-drive-map .leaflet-tile{filter') === -1 &&
  css.indexOf('#nv_drive_map .leaflet-tile') === -1 &&
  css.indexOf('.nv-drive .leaflet-tile{filter') === -1);

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
  console.log('— v239: the live drive layer carries the lift, on the coverage contract —');
  const w = makeWorld({ storeData: {
    navigator: { profile: {}, muted: true, mode: 'truck' },
    nav_pending: { lat: DEST[0], lng: DEST[1], name: 'Test Dest' }
  } });
  const api = w.world.Meticulous.modules.navigator;
  api.render(w.body);
  w.firePos(ORIGIN[0], ORIGIN[1], 45, 0);
  await tick(); await tick();
  if (w.reg.nv_drive.onclick) w.reg.nv_drive.onclick();
  await tick();
  const driveMap = w.calls.maps[w.calls.maps.length - 1];
  const driveLayers = w.calls.tileLayers.filter(function (r) { return r.addedTo === driveMap; });
  check('W1: exactly one tile layer rides the drive map', driveLayers.length === 1, 'layers=' + driveLayers.length);
  const rec = driveLayers[0] || { url: '', opts: {} };
  check('W2: the layer wears the street class (the lift applies to it)',
    rec.opts.className === 'nv-tile-street', 'className=' + rec.opts.className);
  check('W3: the coverage contract (v260 re-pin: native z18 under the z18 view — no upscaling; the z15 cap was the pixelation)',
    rec.opts.maxNativeZoom === 18 && rec.opts.maxZoom === 18,
    'maxNativeZoom=' + rec.opts.maxNativeZoom + ' maxZoom=' + rec.opts.maxZoom);
  try { api.teardown(); } catch (e) {}

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR', e && e.stack || e); process.exit(2); });
