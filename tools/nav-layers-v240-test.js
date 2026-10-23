'use strict';
/* Meticulous v240 — NAV-LAYERS-BUTTON suite.
 *
 * The owner, Fri Oct 23, 2026 11:36 MDT (drive video + the
 * Google/Rand McNally references): a corner button like
 * Google Maps' layers control on the drive screen — switch
 * between Satellite, Traffic, Elevation (and back to the
 * standard map). "I want the button because in future
 * traffic will be there!"
 *
 * What is real NOW (probed against the live Esri CDN at z15,
 * his home tile, before building):
 *   Standard  — Esri World Street Map (the shipped layer).
 *   Satellite — Esri World Imagery answers real tiles.
 *   Elevation — Esri World Hillshade (Elevation service)
 *               answers real tiles: shaded relief laid over
 *               the street map at 45% — a real elevation
 *               view, not a label.
 *   Traffic   — NO data source is wired. The entry exists
 *               (his order: the button now, traffic later);
 *               tapping it says so plainly in the panel and
 *               changes NOTHING on the map. No fake layer.
 * Every drive layer fetches at native z15 under the z18 view
 * (the v232/v235 coverage contract — a layer switch must
 * never reintroduce a blank map). The choice persists in the
 * navigator settings.
 *
 * RED before the fix: no layers button, no panel, no specs.
 *
 * Run: node tools/nav-layers-v240-test.js
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

console.log('— v240: wiring pins —');
check('the drive face carries the layers button', navSrc.indexOf('id="nvd_layers"') !== -1);
check('the drive face carries the layers panel + note line',
  navSrc.indexOf('id="nvd_layers_panel"') !== -1 && navSrc.indexOf('id="nvd_layers_note"') !== -1);
check('all four layer entries exist (standard, satellite, traffic, elevation)',
  ['nvd_layer_standard', 'nvd_layer_satellite', 'nvd_layer_traffic', 'nvd_layer_elevation']
    .every(function (id) { return navSrc.indexOf('id="' + id + '"') !== -1; }));
check('the satellite spec is Esri World Imagery (probed live)',
  /World_Imagery\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}/.test(navSrc));
check('the elevation overlay is Esri World Hillshade (probed live)',
  /Elevation\/World_Hillshade\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}/.test(navSrc));
check('the traffic entry is honest: tapping it says traffic is not live yet',
  /Traffic isn/.test(navSrc) && /traffic feed is wired/.test(navSrc));
check('the choice is a persisted navigator setting (loadSettings whitelist)',
  /driveLayer: \(s\.driveLayer === 'satellite' \|\| s\.driveLayer === 'elevation'\)/.test(navSrc));
check('the button/panel CSS exists',
  css.indexOf('.nv-layers-btn{') !== -1 && css.indexOf('.nv-layers-panel{') !== -1 &&
  css.indexOf('.nv-layer-opt.on{') !== -1);
check('the layers chrome hides in PiP (the v220 small-words law)',
  /\.nv-drive\.nv-pip [^{]*\.nv-layers-btn/.test(css) && /\.nv-drive\.nv-pip [^{]*\.nv-layers-panel/.test(css));

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
    'nvd_inset', 'nvd_layers', 'nvd_layers_panel', 'nvd_layers_note',
    'nvd_layer_standard', 'nvd_layer_satellite', 'nvd_layer_traffic', 'nvd_layer_elevation',
    'pipDock', 'bubbleFace', 'bubClock', 'bubStatus', 'bubLoads', 'bubPlay', 'bubPlus', 'bubMinus', 'bubStop'];
  const reg = {};
  ids.forEach(function (id) { reg[id] = el(id); });
  reg.nv_presults = resultsEl();
  reg.bubbleFace.classList.add('hidden');
  /* the markup starts the panel + note hidden — model it */
  reg.nvd_layers_panel.classList.add('hidden');
  reg.nvd_layers_note.classList.add('hidden');
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
      _adds: 0, _views: [], _panTos: [], _center: null, _zoom: 15, _removed: [],
      setView: function (c, z) { m._views.push([c, z]); m._center = (c && c.lat !== undefined) ? [c.lat, c.lng] : c; if (z) m._zoom = z; return m; },
      panTo: function (c) { const cc = (c && c.lat !== undefined) ? [c.lat, c.lng] : c; m._panTos.push(cc); m._center = cc; return m; },
      setZoomAround: function () {},
      getCenter: function () { return m._center ? { lat: m._center[0], lng: m._center[1] } : null; },
      getZoom: function () { return m._zoom; },
      on: function (ev, fn) { mapHandlers[ev] = fn; },
      addLayer: function () { m._adds++; return m; },
      removeLayer: function (l) { m._removed.push(l); return m; },
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
    world: world, reg: reg, body: body, calls: calls, storeData: storeData,
    firePos: function (la, lo, hd, sp) { if (geoCb) geoCb({ coords: { latitude: la, longitude: lo, heading: hd, speed: sp }, timestamp: Date.now() }); }
  };
}
function tick() { return new Promise(function (r) { setTimeout(r, 15); }); }

(async function () {
  console.log('— v240: the layers button works on a live drive —');
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
  const onMap = function () { return w.calls.tileLayers.filter(function (r) { return r.addedTo === driveMap; }); };
  check('W1: the layers button is bound', typeof w.reg.nvd_layers.onclick === 'function');
  check('W2: the drive opens on the standard street layer (Esri WSM, street class)',
    onMap().length === 1 && /World_Street_Map/.test(onMap()[0].url) && onMap()[0].opts.className === 'nv-tile-street',
    JSON.stringify(onMap().map(function (r) { return r.url; })));

  if (w.reg.nvd_layers.onclick) w.reg.nvd_layers.onclick();
  check('W3: tapping the button opens the panel',
    w.reg.nvd_layers_panel && !w.reg.nvd_layers_panel.classList.contains('hidden'));

  if (w.reg.nvd_layer_satellite.onclick) w.reg.nvd_layer_satellite.onclick();
  await tick();
  const sat = onMap()[onMap().length - 1] || { url: '', opts: {} };
  check('W4: Satellite swaps the base layer to World Imagery at native z15',
    /World_Imagery/.test(sat.url) && sat.opts.maxNativeZoom === 15, sat.url);

  if (w.reg.nvd_layer_elevation.onclick) w.reg.nvd_layer_elevation.onclick();
  await tick();
  const urls = onMap().map(function (r) { return r.url; });
  const hill = onMap().filter(function (r) { return /World_Hillshade/.test(r.url); })[0];
  check('W5: Elevation brings the street map back WITH a hillshade overlay',
    /World_Street_Map/.test(urls[urls.length - 2] || '') && !!hill, JSON.stringify(urls));
  check('W6: the hillshade rides translucent (a relief, not a replacement)',
    !!hill && typeof hill.opts.opacity === 'number' && hill.opts.opacity < 1,
    hill ? String(hill.opts.opacity) : 'none');

  const beforeTraffic = onMap().length;
  if (w.reg.nvd_layer_traffic.onclick) w.reg.nvd_layer_traffic.onclick();
  await tick();
  check('W7: Traffic adds NO layer and fakes nothing (layer count unchanged)',
    onMap().length === beforeTraffic, beforeTraffic + ' -> ' + onMap().length);
  check('W8: Traffic says so plainly in the panel',
    !!w.reg.nvd_layers_note && /live yet/.test(w.reg.nvd_layers_note.textContent || '') &&
    !w.reg.nvd_layers_note.classList.contains('hidden'),
    w.reg.nvd_layers_note ? w.reg.nvd_layers_note.textContent : 'no note el');
  check('W9: the layer choice after Traffic is still Elevation (nothing switched)',
    w.storeData.navigator && w.storeData.navigator.driveLayer === 'elevation',
    JSON.stringify(w.storeData.navigator || {}));

  if (w.reg.nvd_layer_standard.onclick) w.reg.nvd_layer_standard.onclick();
  await tick();
  const back = onMap()[onMap().length - 1] || { url: '', opts: {} };
  check('W10: Standard restores the street layer (with its colour-lift class)',
    /World_Street_Map/.test(back.url) && back.opts.className === 'nv-tile-street', back.url);
  check('W11: the final choice persisted', w.storeData.navigator.driveLayer === 'standard');
  try { api.teardown(); } catch (e) {}

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR', e && e.stack || e); process.exit(2); });
