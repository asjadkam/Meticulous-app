'use strict';
/* NAV-SCREEN-STILL-CUTTING + NAV-TRAFFIC-NOT-SHOWING (v277) —
   owner, Wed Oct 28, 2026 07:27 MDT, drive video (Country Hills
   Blvd NE -> the 201 South/Stoney Trail ramp on the right):
   "screen is still cutting" and live traffic not showing.
   Frame evidence (his recording, 07:25): the map renders ONLY
   in a top strip; below ~40% of the glass the truck floats on
   the viewport's pale sky gradient; the inset shows 420 m
   while the banner shows 380 m; the inset card covers the
   top-right where his right ramp bends.
 *
 * WHY EVERY EARLIER HARNESS PASSED: the v266 render harness
 * runs at 768x1024 (the Fold INNER display) where the 260%
 * plane's half-width (998px) JUST covers the required
 * pre-image radius (~985px). He drives on the COVER display,
 * 411x960, where the same plane's half-width is 534px against
 * a ~900px requirement at diagonal/side headings — and the
 * v273 coverage derivation only ever sampled the TOP STRIP of
 * the viewport (its bottom two-thirds were never checked by
 * anything). At heading 90 the pristine tree covers 33% of
 * this screen. This suite runs the render at HIS size and
 * checks the WHOLE viewport, at several headings.
 *
 * Pins: (a) render-level plane coverage frac > 0.97 at
 * headings 90/45/135 on the real module; (b) NAVPURE-level:
 * coverageLiftPx's lift + the CSS-parsed plane give ZERO
 * uncovered full-viewport samples at every heading for every
 * viewport class; (c) the inset's distance text tracks the
 * banner's cadence (no 50 m bucket staleness) and the inset
 * docks AWAY from the bend it describes (right bend -> left
 * dock); (d) NAV-TRAFFIC end-to-end PROOF: the city feed is
 * fetched, the incident marker group lands ON the drive map,
 * the chip shows and the warning speaks once — the v262
 * pipeline exercised as a pipeline, not as source pins.
 */

const fs = require('fs');
const vm = require('vm');

const NAV_PATH = process.argv[2];
const CSS_PATH = process.argv[3];
const LABEL = process.argv[4] || 'tree';
const navSrc = fs.readFileSync(NAV_PATH, 'utf8');
const cssSrc = fs.readFileSync(CSS_PATH, 'utf8');

/* ---------- plane geometry from the shipped CSS ---------- */
function planeGeom(css) {
  const m = css.match(/\.nv-drive-plane\s*\{([^}]*)\}/);
  const rule = m ? m[1] : '';
  const num = (re, dflt) => { const mm = rule.match(re); return mm ? parseFloat(mm[1]) : dflt; };
  return {
    wPct: num(/width:\s*([\d.]+)%/, 230), hPct: num(/height:\s*([\d.]+)%/, 300),
    lPct: num(/left:\s*(-?[\d.]+)%/, -65), tPct: num(/top:\s*(-?[\d.]+)%/, -86),
    origin: (rule.match(/transform-origin:\s*([\d.]+)%\s+([\d.]+)%/) || [null, '50', '50']).slice(1).map(Number)
  };
}
const GEOM = planeGeom(cssSrc);
const VW = 411, VH = 960; // owner's REAL drive screen: Fold7 COVER display, 1080x2520 @ DPR 2.625
const PLANE_W = VW * GEOM.wPct / 100, PLANE_H = VH * GEOM.hPct / 100;

/* ---------- CSS transform projection (real matrix math) ---------- */
function matMul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
    o[r * 4 + c] = s;
  }
  return o;
}
const mTrans = (x, y) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, 0, 0, 0, 0, 1];
const mPersp = d => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1 / d, 1];
function mRotX(deg) { const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]; }
function mRotZ(deg) { const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function applyMat(m, x, y) {
  const w = m[12] * x + m[13] * y + m[15];
  return { x: (m[0] * x + m[1] * y + m[3]) / w, y: (m[4] * x + m[5] * y + m[7]) / w, w };
}
/* Parse a planeTransform string and compute the fraction of a
   viewport sample grid the projected plane covers. Samples are
   forward-projected from a dense grid over the plane rect:
   a viewport cell counts covered if any projected plane point
   lands in it (points behind the eye, w<=0, do not render). */
function planeCoverage(transformStr) {
  if (!transformStr) return { written: false, covered: 0, frac: 0 };
  const num = (re) => { const m = transformStr.match(re); return m ? parseFloat(m[1]) : null; };
  const persp = num(/perspective\((-?[\d.]+)px\)/);
  const lift = num(/translateY\((-?[\d.]+)px\)/) || 0; // signed, as written
  const pitch = num(/rotateX\((-?[\d.]+)deg\)/) || 0;
  const rot = num(/rotate\((-?[\d.]+)deg\)/) || 0;
  const x0 = GEOM.lPct / 100 * VW, y0 = GEOM.tPct / 100 * VH;
  const ox = x0 + PLANE_W * GEOM.origin[0] / 100, oy = y0 + PLANE_H * GEOM.origin[1] / 100;
  let M = mTrans(ox, oy);
  if (persp) M = matMul(M, mPersp(persp));
  M = matMul(M, mTrans(0, lift));
  M = matMul(M, mRotX(pitch));
  M = matMul(M, mRotZ(rot));
  M = matMul(M, mTrans(-ox, -oy));
  const cell = 16, cols = Math.ceil(VW / cell), rows = Math.ceil(VH / cell);
  const hit = new Uint8Array(cols * rows);
  /* dense sampling: near the eye plane a thin strip of the plane
     stretches over whole screen bands, so a coarse grid reads a
     healthy render as holes (verified against the standalone
     projection diagnostic: 400x520 sampling shows the v260
     design at 99-100% where 260x340 showed 45%). */
  const NX = 800, NY = 1040;
  for (let i = 0; i <= NX; i++) for (let j = 0; j <= NY; j++) {
    const px = x0 + PLANE_W * i / NX, py = y0 + PLANE_H * j / NY;
    const q = applyMat(M, px, py);
    if (!(q.w > 0.0005) || !isFinite(q.x) || !isFinite(q.y)) continue;
    if (q.x < -2000 || q.x > VW + 2000 || q.y < -2000 || q.y > VH + 2000) continue;
    const cx = Math.floor(q.x / cell), cy = Math.floor(q.y / cell);
    if (cx >= 0 && cx < cols && cy >= 0 && cy < rows) hit[cy * cols + cx] = 1;
  }
  let covered = 0; for (let k = 0; k < hit.length; k++) covered += hit[k];
  return { written: true, covered, frac: covered / hit.length, persp, lift, pitch, rot };
}

/* ---------- fixtures at the owner's Oct 26 location ---------- */
const HOME = [50.9690, -114.0350];            // site area, Peigan Trail SE
const CORNER = [50.9690, -114.01862];         // 1.15 km east — the signed turn
const DEST = [50.96135, -114.01862];          // 0.85 km south of the corner
function buildLine() {
  const pts = [];
  for (let i = 0; i <= 10; i++) pts.push([HOME[0], HOME[1] + (CORNER[1] - HOME[1]) * i / 10]);
  for (let i = 1; i <= 8; i++) pts.push([HOME[0] + (DEST[0] - HOME[0]) * i / 8, CORNER[1]]);
  return pts;
}
const LINE = buildLine();
function encodeShape(points) {
  let out = '', lastLat = 0, lastLng = 0;
  const enc = (v) => { let s = ''; let x = v < 0 ? ~(v << 1) : (v << 1); while (x >= 0x20) { s += String.fromCharCode((0x20 | (x & 0x1f)) + 63); x >>= 5; } s += String.fromCharCode(x + 63); return s; };
  points.forEach(p => {
    const la = Math.round(p[0] * 1e6), ln = Math.round(p[1] * 1e6);
    out += enc(la - lastLat) + enc(ln - lastLng); lastLat = la; lastLng = ln;
  });
  return out;
}
const TRIP_JSON = {
  trip: {
    summary: { length: 2.0, time: 170 },
    legs: [{
      shape: encodeShape(LINE),
      maneuvers: [
        { type: 1, instruction: 'Head east on Peigan Trail SE', verbal_pre_transition_instruction: 'Head east on Peigan Trail Southeast', street_names: ['Peigan Trail SE'], length: 1.15, time: 90 },
        { type: 10, instruction: 'Turn right onto 52 Street SE', verbal_pre_transition_instruction: 'In 1.2 kilometres, turn right onto 52 Street Southeast', street_names: ['52 Street SE'], length: 0.85, time: 80,
          sign: { exit_number_elements: [{ text: '234B-A' }], exit_branch_elements: [{ text: '52 Street SE' }], exit_toward_elements: [{ text: 'Downtown' }] } },
        { type: 4, instruction: 'Arrive at your destination', street_names: [], length: 0, time: 0 }
      ]
    }]
  }
};
const OSRM_JSON = {
  routes: [{
    legs: [{
      steps: [
        { intersections: [{ location: [CORNER[1], CORNER[0]], lanes: [
          { indications: ['through'], valid: true },
          { indications: ['through', 'right'], valid: true },
          { indications: ['right'], valid: true }] }] },
        { intersections: [] }
      ]
    }]
  }]
};
/* One City incident ON the route, ~700 m ahead of the start.
   Field names are the ones parseCityIncidents actually reads
   (latitude / longitude / start_dt_utc / incident_info /
   description) — the Socrata columns of dataset 4jah-h97u. */
const INCIDENT_PT = [50.9690, -114.0250];
const CITY_JSON = [{
  start_dt_utc: '2026-10-26T14:00:00.000', description: 'Collision', incident_info: 'Two vehicles',
  latitude: String(INCIDENT_PT[0]), longitude: String(INCIDENT_PT[1])
}];
const SEARCH_JSON = [{ lat: String(DEST[0]), lon: String(DEST[1]), display_name: '52 Street SE, Calgary, Alberta' }];

/* ---------- the stubbed world ---------- */
function makeWorld(seedStore) {
  const W = {
    errors: [],            // exceptions that escaped into a harness-driven call
    geoCb: null, fetchUrls: [],
    mapsCreated: [], tileLayers: [], tileRequests: [],
    rafScheduled: 0, rafQueue: [],
    planeTransformWrites: 0, lastTransform: '',
    spoken: []
  };
  const store = Object.assign({}, seedStore || {});
  const reg = {};
  let W_hitBtn = null; // assigned below, before any module code runs
  function el(id) {
    const e = {
      id: id || '', children: [], _innerHTML: '', textContent: '', value: '', title: '',
      className: '', dataset: {}, onclick: null, disabled: false,
      clientWidth: 0, clientHeight: 0, parentElement: null, _childCache: {},
      style: {}, classList: {
        _s: new Set(),
        add(...cs) { cs.forEach(c => this._s.add(c)); },
        remove(...cs) { cs.forEach(c => this._s.delete(c)); },
        toggle(c, f) { if (f === undefined) f = !this._s.has(c); if (f) this._s.add(c); else this._s.delete(c); return f; },
        contains(c) { return this._s.has(c); }
      },
      set innerHTML(v) { this._innerHTML = String(v); },
      get innerHTML() { return this._innerHTML; },
      appendChild(c) { this.children.push(c); if (c) c.parentElement = this; return c; },
      addEventListener() {}, removeEventListener() {},
      querySelector(sel) {
        if (!sel) return null;
        if (sel[0] === '#') return reg[sel.slice(1)] || null;
        if (!this._childCache[sel]) this._childCache[sel] = el(sel);
        return this._childCache[sel];
      },
      querySelectorAll(sel) { return sel === '[data-nvhit]' ? [W_hitBtn] : []; },
      setAttribute() {}, getAttribute() { return null; }, remove() {},
      focus() {}, blur() {}, click() { if (this.onclick) this.onclick(); }
    };
    return e;
  }
  /* the drive viewport + plane get real sizes + parentage */
  const viewportEl = el('vp'); viewportEl.clientWidth = VW; viewportEl.clientHeight = VH;
  const planeEl = el('nvd_plane');
  planeEl.parentElement = viewportEl;
  planeEl.style = new Proxy({}, {
    set(t, k, v) { if (k === 'transform') { W.planeTransformWrites++; W.lastTransform = String(v); } t[k] = v; return true; },
    get(t, k) { return t[k]; }
  });
  ['nv_back', 'nv_banner', 'nv_destnote', 'nv_search', 'nv_results', 'nv_q', 'nv_pq', 'nv_presults',
   'nv_route', 'nv_drive', 'nv_end', 'nv_steps', 'nv_note', 'nv_map', 'nv_mute', 'nv_gear', 'nv_settings',
   'nv_mode_truck', 'nv_mode_car', 'nv_follow',
   'nvs_axleload', 'nvs_axles', 'nvs_close', 'nvs_grades', 'nvs_hazmat', 'nvs_height', 'nvs_length',
   'nvs_limit', 'nvs_mute', 'nvs_note', 'nvs_speed', 'nvs_testvoice', 'nvs_voicenote', 'nvs_weight', 'nvs_width',
   'nvd_inst', 'nvd_road', 'nvd_dist', 'nvd_eta_main', 'nvd_eta_sub', 'nvd_mute', 'nvd_gear', 'nvd_exit', 'nvd_inset',
   'nvd_speed', 'nvd_limit', 'nvd_speedwrap', 'nvd_recenter', 'nvd_you', 'nvd_reroute', 'nvd_traffic', 'nvd_pip_line',
   'nvd_avatar_picker', 'nvd_layers', 'nvd_layers_panel', 'nvd_layers_note',
   'nvd_layer_standard', 'nvd_layer_satellite', 'nvd_layer_traffic', 'nvd_layer_elevation',
   'nv_drive_screen', 'nv_drive_map', 'nv_here_lbl', 'nv_dest_lbl'].forEach(id => { reg[id] = el(id); });
  reg.nvd_plane = planeEl;
  reg.nv_drive_map.clientWidth = PLANE_W; reg.nv_drive_map.clientHeight = PLANE_H;
  /* the results button the search flow clicks */
  const resultBtn = el('res0'); resultBtn.dataset = { lat: String(DEST[0]), lng: String(DEST[1]), label: SEARCH_JSON[0].display_name };
  W_hitBtn = resultBtn; resultBtn.getAttribute = (n) => (n === 'data-nvhit' ? '0' : null);
  const body = el('body');
  const baseQS = body.querySelector.bind(body);
  body.querySelector = (sel) => {
    if (sel === '.nv-drive-viewport') return viewportEl;
    return baseQS(sel);
  };
  body.querySelectorAll = (sel) => sel === '.nv-result' ? [resultBtn] : [];
  const doc = {
    getElementById: (id) => reg[id] || null,
    querySelector: (sel) => body.querySelector(sel),
    addEventListener() {}, removeEventListener() {},
    body: el('docbody'), documentElement: el('html'), hidden: false
  };
  /* ---- Leaflet stub with tile modelling ---- */
  function project(lat, lng, z) {
    const s = 256 * Math.pow(2, z), x = (lng + 180) / 360 * s;
    const sin = Math.sin(lat * Math.PI / 180);
    return { x, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
  }
  function unproject(x, y, z) {
    const s = 256 * Math.pow(2, z), lng = x / s * 360 - 180;
    const n = Math.PI - 2 * Math.PI * y / s;
    return { lat: 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng };
  }
  function computeTiles(layer, map) {
    if (!map || !map._center) return;
    const tz = (layer.opts && layer.opts.maxNativeZoom != null) ? Math.min(map._zoom, layer.opts.maxNativeZoom) : map._zoom;
    const scale = Math.pow(2, map._zoom - tz);
    const c = project(map._center[0], map._center[1], tz);
    const hw = (PLANE_W / 2) / scale, hh = (PLANE_H / 2) / scale, buf = (layer.opts.keepBuffer || 0) * 256;
    const x0 = Math.floor((c.x - hw - buf) / 256), x1 = Math.floor((c.x + hw + buf) / 256);
    const y0 = Math.floor((c.y - hh - buf) / 256), y1 = Math.floor((c.y + hh + buf) / 256);
    const tiles = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      tiles.push({ z: tz, x, y, url: layer.url.replace('{z}', tz).replace('{x}', x).replace('{y}', y).replace('{s}', 'a') });
    }
    layer._tiles = tiles;
    W.tileRequests.push({ url: layer.url, tileZoom: tz, count: tiles.length, tiles });
  }
  function mkMap(id) {
    const map = {
      _id: id, _center: null, _zoom: 18, _layers: [],
      setView(ll, z) { this._center = [ll.lat !== undefined ? ll.lat : ll[0], ll.lng !== undefined ? ll.lng : ll[1]]; if (z) this._zoom = z; this._layers.forEach(l => { if (l._isTile) computeTiles(l, this); }); return this; },
      panTo(ll) { this._center = [ll.lat !== undefined ? ll.lat : ll[0], ll.lng !== undefined ? ll.lng : ll[1]]; this._layers.forEach(l => { if (l._isTile) computeTiles(l, this); }); return this; },
      getCenter() { return this._center ? { lat: this._center[0], lng: this._center[1] } : null; },
      getZoom() { return this._zoom; },
      project(ll, z) { return project(ll.lat !== undefined ? ll.lat : ll[0], ll.lng !== undefined ? ll.lng : ll[1], z || this._zoom); },
      unproject(p, z) { return unproject(p.x, p.y, z || this._zoom); },
      latLngToLayerPoint(ll) { const c = this.project(this.getCenter()), p = this.project(ll); return { x: p.x - c.x + PLANE_W / 2, y: p.y - c.y + PLANE_H / 2 }; },
      layerPointToLatLng(p) { const c = this.project(this.getCenter()); return this.unproject({ x: p.x + c.x - PLANE_W / 2, y: p.y + c.y - PLANE_H / 2 }); },
      invalidateSize() { this._layers.forEach(l => { if (l._isTile) computeTiles(l, this); }); return this; },
      on() { return this; }, addLayer(l) { this._layers.push(l); if (l._isTile) computeTiles(l, this); return this; },
      removeLayer(l) { this._layers = this._layers.filter(x => x !== l); return this; },
      hasLayer(l) { return this._layers.indexOf(l) !== -1; },
      fitBounds() { return this; }, getBounds() { return { pad() { return this; } }; },
      remove() {}, dragging: { enable() {}, disable() {} }, touchZoom: {}, doubleClickZoom: {}, scrollWheelZoom: {}, boxZoom: {}, keyboard: {}
    };
    W.mapsCreated.push(map);
    return map;
  }
  const Lstub = {
    map: (id, opts) => mkMap(id),
    tileLayer: (url, opts) => {
      const layer = { _isTile: true, url, opts: opts || {}, _tiles: [],
        addTo(map) { map.addLayer(this); return this; },
        setUrl(u) { this.url = u; return this; }, redraw() { return this; }, on() { return this; } };
      W.tileLayers.push(layer);
      return layer;
    },
    polyline: (pts, o) => ({ _pts: pts, addTo(m) { if (m) m.addLayer(this); return this; }, setLatLngs(p) { this._pts = p; }, getBounds() { return { pad() { return this; } }; }, on() { return this; } }),
    layerGroup: (ls) => ({ _ls: ls || [], addTo(m) { if (m) m.addLayer(this); (this._ls || []).forEach(l => { l._groupMap = m; }); return this; }, getLayers() { return this._ls; }, on() { return this; } }),
    marker: (ll, o) => ({ addTo(m) { if (m) m.addLayer(this); return this; }, setLatLng() { return this; }, setIcon() { return this; }, setOpacity() { return this; }, on() { return this; } }),
    circleMarker: (ll, o) => ({ addTo(m) { if (m) m.addLayer(this); return this; }, setLatLng() { return this; }, on() { return this; } }),
    divIcon: (o) => ({ _o: o }), icon: (o) => ({ _o: o }),
    latLng: (a, b) => ({ lat: a, lng: b })
  };
  const fetchStub = (url, opts) => {
    W.fetchUrls.push(String(url));
    let payload = {};
    const u = String(url);
    if (u.indexOf('nominatim') !== -1) payload = SEARCH_JSON;
    else if (u.indexOf('/route') !== -1) {
      let body = {};
      try { body = JSON.parse((opts && opts.body) || '{}'); } catch (e) {}
      payload = body.format === 'osrm' ? OSRM_JSON : TRIP_JSON;
    }
    else if (u.indexOf('data.calgary.ca') !== -1) payload = CITY_JSON;
    else if (u.indexOf('open-meteo') !== -1) payload = { elevation: new Array(64).fill(1100) };
    else if (u.indexOf('overpass') !== -1) payload = { elements: [] };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(payload))) });
  };
  const sb = {
    console: { log: (...a) => console.log('[mod]', ...a), warn() {}, error: (...a) => console.log('[mod-err]', ...a) },
    setTimeout: (fn) => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: (fn) => { W.rafScheduled++; W.rafQueue.push(fn); return W.rafScheduled; },
    cancelAnimationFrame: () => {},
    devicePixelRatio: 2,
    innerWidth: VW, innerHeight: VH,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {
      geolocation: {
        watchPosition: (cb, err, opts) => { W.geoCb = cb; return 7; },
        getCurrentPosition: (cb) => { W.geoCb = cb; },
        clearWatch: () => {}
      },
      wakeLock: null
    },
    speechSynthesis: { speak(u) { W.spoken.push(u && u.text); }, cancel() {}, getVoices: () => [], addEventListener() {} },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    fetch: fetchStub,
    L: Lstub,
    document: doc,
    App: {
      _store: {
        get: (k, d) => (k in store ? store[k] : d),
        set: (k, v) => { store[k] = v; },
        del: (k) => { delete store[k]; }
      },
      showDashboard() {}, setDriveDocked() {}, moduleBack() { return false; },
      _esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      geo: null
    },
    Meticulous: { modules: {} },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Blob: function () {}, FileReader: function () {},
    addEventListener() {}, removeEventListener() {}
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(navSrc, sb, { filename: 'navigator.js' });
  W.sb = sb; W.reg = reg; W.body = body; W.resultBtn = resultBtn; W.store = store;
  W.drainRaf = () => {
    let n = 0;
    while (W.rafQueue.length && n < 200) {
      const fn = W.rafQueue.shift(); n++;
      try { fn(16 * n); } catch (e) { W.errors.push('rAF: ' + (e && e.message)); }
    }
  };
  W.fireFix = (lat, lng, heading, speed) => {
    if (!W.geoCb) { W.errors.push('no GPS callback registered'); return; }
    const before = { raf: W.rafScheduled, tw: W.planeTransformWrites };
    try {
      W.geoCb({ coords: { latitude: lat, longitude: lng, heading: (heading === null ? NaN : heading), speed: (speed === null ? NaN : speed), accuracy: 8 }, timestamp: Date.now() });
    } catch (e) { W.errors.push('fix threw: ' + (e && e.message) + ' @ ' + String((e && e.stack) || '').split('\n').slice(1, 3).join(' <- ')); }
    W.drainRaf();
    W.lastFixDelta = { raf: W.rafScheduled - before.raf, tw: W.planeTransformWrites - before.tw };
  };
  W.click = (id) => {
    const e = reg[id];
    if (!e || typeof e.onclick !== 'function') { W.errors.push('no onclick for #' + id); return; }
    try { e.onclick(); } catch (err) { W.errors.push('click #' + id + ' threw: ' + (err && err.message)); }
  };
  W.flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); W.drainRaf(); };
  return W;
}

/* ---------- shared assertions ---------- */
let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('ok   - ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; fails.push(name); console.log('FAIL - ' + name + (extra ? '  [' + extra + ']' : '')); }
}
/* the z18 tile that contains a point */
function tileXY(lat, lng, z) {
  const n = Math.pow(2, z);
  const x = Math.floor((lng + 180) / 360 * n);
  const latR = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n);
  return { x, y };
}
function expectDriveRender(W, tag, era) {
  const driveMap = W.mapsCreated.filter(m => m._id === 'nv_drive_map')[0];
  ok(tag + ': drive map created', !!driveMap);
  const street = W.tileLayers.filter(l => driveMap && driveMap._layers.indexOf(l) !== -1 &&
    (l.url.indexOf('openstreetmap') !== -1 || l.url.indexOf('arcgisonline') !== -1 && l.url.indexOf('World_Street') !== -1 || l.url.indexOf('arcgisonline') !== -1))[0];
  ok(tag + ': a base tile layer is on the drive map', !!street, W.tileLayers.map(l => l.url).join(' | '));
  const lastReq = street ? W.tileRequests.filter(r => r.url === street.url || true).slice(-1)[0] : null;
  const tiles = street && street._tiles ? street._tiles : [];
  ok(tag + ': tiles requested for the drive view', tiles.length > 0, 'count=' + tiles.length);
  if (era >= 260) {
    const want = tileXY(HOME[0], HOME[1], 18);
    const has = tiles.some(t => t.z === 18 && t.x === want.x && t.y === want.y);
    ok(tag + ': tiles at NATIVE z18 incl. the tile containing (50.969,-114.035)', has && tiles.every(t => t.z === 18),
      'want z18 x' + want.x + ' y' + want.y + '; got zooms ' + Array.from(new Set(tiles.map(t => t.z))).join(','));
    ok(tag + ': street source is OSM standard', !!street && street.url.indexOf('tile.openstreetmap.org') !== -1, street && street.url);
  }
  const cov = planeCoverage(W.lastTransform);
  ok(tag + ': plane transform written', cov.written, W.lastTransform.slice(0, 110));
  ok(tag + ': plane covers the viewport (no all-gradient state)', cov.written && cov.frac > 0.97,
    'coverage=' + (cov.frac * 100).toFixed(1) + '% lift=' + cov.lift + ' pitch=' + cov.pitch + ' rot=' + cov.rot);
  return { driveMap, street, cov };
}

(async function main() {
  const era = (() => { const m = navSrc.match(/webVersion|v(2[0-9][0-9])/); return 0; })();
  const isV260plus = navSrc.indexOf('driveTileSpec') !== -1 && navSrc.indexOf('maxNative: 18') !== -1;
  const eraN = isV260plus ? 260 : 259;
  console.log('=== ' + LABEL + ' (navigator.js ' + NAV_PATH + ') plane=' + GEOM.wPct + '%x' + GEOM.hPct + '% @ ' + GEOM.lPct + '%,' + GEOM.tPct + '% origin ' + GEOM.origin.join('/') + ' ===');

  /* ----- Flow A: fresh drive-open, then approach + park ----- */
  {
    const W = makeWorld();
    const api = W.sb.Meticulous.modules.navigator;
    api.render(W.body);
    await W.flush();
    W.fireFix(HOME[0], HOME[1], 90, 0);            // parked fix: position only
    await W.flush();
    W.reg.nv_q.value = '52 Street SE';
    W.click('nv_search'); await W.flush();
    if (process.env.DEBUG_NAV) console.log('DBG after search: resultsHTML=' + JSON.stringify(W.reg.nv_results.innerHTML.slice(0, 120)) + ' hitOnclick=' + typeof W.resultBtn.onclick);
    try { W.resultBtn.onclick && W.resultBtn.onclick(); } catch (e) { W.errors.push('result click: ' + e.message); }
    await W.flush();
    W.click('nv_route'); await W.flush();
    if (process.env.DEBUG_NAV) console.log('DBG after route: note="' + W.reg.nv_note.textContent + '" driveHidden=' + W.reg.nv_drive.classList.contains('hidden') + ' fetches=' + JSON.stringify(W.fetchUrls));
    W.click('nv_drive'); await W.flush();
    if (process.env.DEBUG_NAV) console.log('DBG after drive click: maps=' + W.mapsCreated.map(m => m._id).join(',') + ' errors=' + JSON.stringify(W.errors));
    ok('A: no exceptions through route + drive-open', W.errors.length === 0, W.errors.join(' ;; '));
    let r = expectDriveRender(W, 'A fresh drive-open', eraN);
    /* approach the turn: 500 m along the east leg (toTurn ~650 m) */
    const mid = [HOME[0], HOME[1] + (CORNER[1] - HOME[1]) * 0.45];
    W.fireFix(mid[0], mid[1], 90, 9); await W.flush();
    W.fireFix(mid[0], mid[1], 90, 9); await W.flush();
    const insetHtml = W.reg.nvd_inset.innerHTML;
    const insetShown = !W.reg.nvd_inset.classList.contains('hidden');
    ok('A: inset paints the sign block (EXIT 234B-A)', insetHtml.indexOf('EXIT 234B-A') !== -1, insetHtml.slice(0, 160));
    ok('A: inset paints lane guidance from the server-lane answer', /nv-lane|lane/i.test(insetHtml), insetHtml.slice(0, 220));
    ok('A: inset is visible inside 800 m', insetShown);
    ok('A: inset docks AWAY from the bend — a right turn moves the card to the left dock',
      W.reg.nvd_inset.classList.contains('nv-inset-left'),
      'classes=' + Array.from(W.reg.nvd_inset.classList._s).join(','));
    /* distance sync: step ~21 m at a time INSIDE one 50 m
       repaint bucket — the banner text (10 m cadence) moves,
       the inset's distance must move with it, not hold the
       bucket's entry value (his frame: banner 380, inset 420). */
    {
      const bEl = () => W.reg.nvd_inset.querySelector('.nv-inset-text b');
      let syncOk = true, seen = [];
      let lng = mid[1];
      for (let s = 0; s < 3; s++) {
        lng += 0.0003;
        W.fireFix(HOME[0], lng, 90, 9); await W.flush();
        const bTxt = (W.reg.nvd_dist.textContent || '').trim();
        const iTxt = (bEl().textContent || '').trim();
        seen.push('banner=' + bTxt + ' inset=' + iTxt);
        if (!bTxt || bTxt !== iTxt) syncOk = false;
      }
      ok('A: inset distance text tracks the banner step for step', syncOk, seen.join(' | '));
    }
    /* v262: the on-route incident (~190 m ahead of the mid
       point) must light the traffic chip and speak once. */
    ok('A: traffic chip shows for the on-route incident', !W.reg.nvd_traffic.classList.contains('hidden') &&
      (W.reg.nvd_traffic.textContent || '').indexOf('Traffic ahead') !== -1,
      'text="' + (W.reg.nvd_traffic.textContent || '') + '"');
    ok('A: traffic warning spoken once', W.spoken.filter(s => s && s.indexOf('Traffic ahead') === 0).length === 1,
      JSON.stringify(W.spoken));
    {
      const dm = W.mapsCreated.filter(m => m._id === 'nv_drive_map')[0];
      const groups = dm ? dm._layers.filter(l => l && l._ls) : [];
      const marked = groups.filter(g => (g._ls || []).length > 0);
      ok('A: TRAFFIC PROOF — the incident marker group is ON the drive map',
        marked.length > 0, 'groups=' + groups.length + ' sizes=' + marked.map(g => (g._ls || []).length).join(','));
      ok('A: TRAFFIC PROOF — the city feed was fetched in the flow',
        W.fetchUrls.some(u => u.indexOf('data.calgary.ca') !== -1), W.fetchUrls.join(' | '));
    }
    /* park at 0 km/h for a stretch of fixes, heading held */
    const errsBefore = W.errors.length;
    for (let i = 0; i < 6; i++) { W.fireFix(mid[0], mid[1], null, 0); await W.flush(); }
    ok('A: parked 0 km/h fixes raise no exceptions', W.errors.length === errsBefore, W.errors.slice(errsBefore).join(' ;; '));
    r = expectDriveRender(W, 'A parked at 0 km/h', eraN);
  }

  /* ----- Flow B: relaunch with a restored route (nav_pending) ----- */
  {
    const W = makeWorld({ nav_pending: { lat: DEST[0], lng: DEST[1], label: '52 Street SE', query: '52 Street SE' } });
    const api = W.sb.Meticulous.modules.navigator;
    api.render(W.body);
    await W.flush();
    W.fireFix(HOME[0], HOME[1], 90, 8); await W.flush();   // rolling: auto-route + auto-enter drive
    W.fireFix(HOME[0], HOME[1], 90, 8); await W.flush();
    ok('B: no exceptions through relaunch restore', W.errors.length === 0, W.errors.join(' ;; '));
    expectDriveRender(W, 'B relaunch-restored drive', eraN);
    const errsBefore = W.errors.length;
    for (let i = 0; i < 4; i++) { W.fireFix(HOME[0], HOME[1], null, 0); await W.flush(); }
    ok('B: parked fixes after restore raise no exceptions', W.errors.length === errsBefore, W.errors.slice(errsBefore).join(' ;; '));
    expectDriveRender(W, 'B parked after restore', eraN);
  }

  /* ----- Flow C: the same drive at diagonal headings ----- */
  for (const HDG of [45, 135]) {
    const W = makeWorld();
    const api = W.sb.Meticulous.modules.navigator;
    api.render(W.body);
    await W.flush();
    W.fireFix(HOME[0], HOME[1], HDG, 0);
    await W.flush();
    W.reg.nv_q.value = '52 Street SE';
    W.click('nv_search'); await W.flush();
    try { W.resultBtn.onclick && W.resultBtn.onclick(); } catch (e) { W.errors.push('result click: ' + e.message); }
    await W.flush();
    W.click('nv_route'); await W.flush();
    W.click('nv_drive'); await W.flush();
    for (let i = 0; i < 8; i++) { W.fireFix(HOME[0], HOME[1], HDG, 8); await W.flush(); }
    ok('C' + HDG + ': no exceptions through drive-open at heading ' + HDG, W.errors.length === 0, W.errors.join(' ;; '));
    const r = expectDriveRender(W, 'C' + HDG + ' drive at heading ' + HDG, eraN);
    ok('C' + HDG + ': the written transform is at the driven heading', Math.abs(((r.cov.rot || 0) + HDG + 540) % 360 - 180) < 6 || Math.abs((r.cov.rot || 0) + HDG) < 6,
      'rot=' + r.cov.rot);
  }

  /* ----- NAVPURE: full-viewport coverage, CSS-parsed plane ----- */
  {
    const vm2 = require('vm');
    const a0 = navSrc.lastIndexOf('/*', navSrc.indexOf('NAVPURE-BEGIN'));
    const b0 = navSrc.indexOf('*/', navSrc.indexOf('NAVPURE-END'));
    const sb2 = { console: console };
    vm2.createContext(sb2);
    vm2.runInContext(navSrc.slice(a0, b0 + 2), sb2);
    ok('NAVPURE: coverageLiftPx is exported', typeof sb2.coverageLiftPx === 'function');
    /* independent inverse-homography checker — geometry parsed
       off the SHIPPED css, never restated numbers */
    function mul(A, B) { const C = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += A[r * 4 + k] * B[k * 4 + c]; C[r * 4 + c] = s; } return C; }
    function uncovered(W, H, lift, deg) {
      const pw = GEOM.wPct / 100 * W, ph = GEOM.hPct / 100 * H, x0 = GEOM.lPct / 100 * W, y0 = GEOM.tPct / 100 * H;
      const ox = x0 + pw / 2, oy = y0 + ph / 2;
      const t = deg * Math.PI / 180, cp = Math.cos(t), sp = Math.sin(t);
      const P = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,-1/1100,1];
      const T = [1,0,0,0, 0,1,0,-lift, 0,0,1,0, 0,0,0,1];
      const c50 = Math.cos(50 * Math.PI / 180), s50 = Math.sin(50 * Math.PI / 180);
      const RX = [1,0,0,0, 0,c50,-s50,0, 0,s50,c50,0, 0,0,0,1];
      const RZ = [cp,sp,0,0, -sp,cp,0,0, 0,0,1,0, 0,0,0,1];
      const M = mul([1,0,0,ox, 0,1,0,oy, 0,0,1,0, 0,0,0,1], mul(mul(P, mul(T, mul(RX, RZ))), [1,0,0,-ox, 0,1,0,-oy, 0,0,1,0, 0,0,0,1]));
      const a = M[0], b = M[1], c = M[3], d = M[4], e = M[5], f = M[7], g = M[12], h = M[13], ii = M[15];
      const A = e * ii - f * h, B = -(d * ii - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
      if (!det) return 9999;
      const inv = [A/det, -(b*ii-c*h)/det, (b*f-c*e)/det, B/det, (a*ii-c*g)/det, -(a*f-c*d)/det, C/det, -(a*h-b*g)/det, (a*e-b*d)/det];
      let n = 0;
      for (let gy = 0; gy <= 40; gy++) for (let gx = 0; gx <= 20; gx++) {
        const sx = W * gx / 20, sy = H * gy / 40;
        const X = inv[0]*sx + inv[1]*sy + inv[2], Y = inv[3]*sx + inv[4]*sy + inv[5], Wd = inv[6]*sx + inv[7]*sy + inv[8];
        if (!Wd) { n++; continue; }
        const px = X / Wd, py = Y / Wd;
        const wf = M[12]*px + M[13]*py + M[15];
        if (!(wf > 0 && px >= x0 - 0.5 && px <= x0 + pw + 0.5 && py >= y0 - 0.5 && py <= y0 + ph + 0.5)) n++;
      }
      return n;
    }
    const VPS = [[411, 960], [768, 1024], [360, 640], [960, 411], [221, 139], [412, 915], [390, 844]];
    for (const [W, H] of VPS) {
      const L = sb2.coverageLiftPx(W, H);
      let bad = 0, worstDeg = -1;
      for (let deg = 0; deg < 360; deg += 5) { const n = uncovered(W, H, L, deg); if (n > 0) { bad += n; if (worstDeg < 0) worstDeg = deg; } }
      ok('NAVPURE: FULL viewport covered at every heading — ' + W + 'x' + H + ' (lift ' + L + 'px)',
        bad === 0, 'uncovered=' + bad + ' firstBadHeading=' + worstDeg);
    }
    ok('CSS: the plane is 460% x 300% centred on the anchor (left:-180%, top:-86%)',
      /\.nv-drive-plane\{[^}]*width:460%;height:300%;left:-180%;top:-86%/.test(cssSrc));
    ok('CSS: the inset has a left dock (away from a right bend)',
      /\.nv-drive-inset\.nv-inset-left\{[^}]*left:10px[^}]*right:auto/.test(cssSrc));
  }

  console.log('=== ' + LABEL + ': ' + pass + ' pass, ' + fail + ' fail ===');
  if (fails.length) console.log('failed: ' + fails.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
