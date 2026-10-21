#!/usr/bin/env node
/* navigator-v141-test.js — v141 "TRUCK ART REDO: THE ART IS A
 * RENDER NOW" (owner, twice, in his hands). v135's flat glyph:
 * "This truck looks horrible, better 3d image of a truck! Still
 * cartoonish but should have allot more details then a 2d image
 * slapped on." v139 answered with a dimensional inline-SVG
 * redraw — and he rejected it again on Oct 17, 2026 at 13:35
 * MDT, with a live Drive screenshot: "Still horrendous! When I
 * said 3d! That what came to mind? When I said realistic is this
 * it?" The SVG still read as a flat cartoon on his glass.
 *
 * THE v141 ART: each vehicle kind is a PHOTOREALISTIC TOP-DOWN
 * 3D RENDER shipped as a PNG asset (assets/avatar-dump.png /
 * avatar-semi.png / avatar-pickup.png) — a glossy navy cab with
 * sky reflected in the glass, a steel dump box carrying a real
 * gravel load, a corrugated semi trailer, an open pickup bed,
 * treaded tyres, mirrors, chrome tanks, and a soft ground
 * shadow baked into the raster. HOW IT WAS PRODUCED: generated
 * renders (flat chroma-green ground), keyed to transparency
 * with a despill pass, shadow composited under the truck, sized
 * at 3x the marker box. RASTER-PROOFED AT MARKER SIZE in the
 * build: the finished assets were rendered at the exact CSS box
 * (62x118 etc.) over a street-like ground and READ as an image
 * — they read as little real trucks, not clip-art. (The proof
 * image lives with the build's working files; this suite pins
 * the assets' structure — PNG, alpha, dimensions — not taste.)
 * The renders carry true vehicle proportions (aspect ~2.4–4.8);
 * AVATAR_BOX compresses the length the way every navigation
 * marker does. 'arrow' keeps its v139 chevron SVG — a symbol,
 * never the complaint.
 *
 * WHAT THIS SUITE PINS:
 *   1. The asset wiring: AVATAR_ASSET, the <img> glyph, the
 *      bigger AVATAR_BOX table, the arrow untouched.
 *   2. THE ASSETS THEMSELVES: real PNGs on disk, RGBA, exactly
 *      3x their CSS box, transparent corners (keyed, not a
 *      green rectangle), an opaque truck at the centre.
 *   3. The sizing CSS for the raster on both stages (marker +
 *      chooser), with no transform / layer promotion — the
 *      v139 layer budget is not regressed by the new art.
 *   4. BEHAVIOUR in the instrumented DOM (the v139 harness):
 *      the render paints the dump render; the chooser offers
 *      three renders + the arrow; a tap swaps glyph AND box at
 *      the tap and persists; the arrow still paints its SVG;
 *      a fresh render paints the persisted kind; and across
 *      drive ticks the marker is NEVER repainted (v133/v139
 *      mutate-only discipline — the tick touches nothing).
 *
 * THE HONEST LIMIT (also in BUGS.md): no suite can judge
 * realism. The art was proofed at marker size by eye in the
 * build; the verdict that counts is the owner's eyes on his
 * next drive.
 *
 * Run: node tools/navigator-v141-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

const navSrc = read('modules/navigator.js');
const cssRaw = read('css/style.css');
const cssSrc = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));
const fixture = JSON.parse(read('tools/navigator-fixture-tripb.json'));
const ORIGIN = [51.0955, -114.099], DEST = [51.1075, -114.0845];
const BOX = { dump: [92, 132], semi: [92, 144], pickup: [92, 118], arrow: [54, 72] }; /* v175 pin move: chase-view boxes (were 62x118 / 62x136 / 60x104) */

/* Minimal PNG reader: enough to prove the assets are what the
   wiring claims — signature, IHDR geometry, and (via a real
   inflate + unfilter) the alpha at the corners and centre. */
function readPng(p) {
  const buf = fs.readFileSync(path.join(ROOT, p));
  if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return { ok: false, why: 'bad signature' };
  let off = 8, ihdr = null; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.slice(off + 4, off + 8).toString('ascii');
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
    if (type === 'IEND') break;
  }
  if (!ihdr) return { ok: false, why: 'no IHDR' };
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const w = ihdr.w, h = ihdr.h, bpp = 4, stride = w * bpp;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = y * (stride + 1) + 1, out = y * stride, up = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[out + x - bpp] : 0;
      const b = y > 0 ? px[up + x] : 0;
      const c = (x >= bpp && y > 0) ? px[up + x - bpp] : 0;
      let v = raw[row + x];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      px[out + x] = v;
    }
  }
  const alphaAt = function (fx, fy) {
    const x = Math.min(w - 1, Math.max(0, Math.floor(w * fx))), y = Math.min(h - 1, Math.max(0, Math.floor(h * fy)));
    return px[(y * w + x) * 4 + 3];
  };
  return { ok: true, ihdr: ihdr, bytes: buf.length, alphaAt: alphaAt };
}

console.log('— 1. the wiring (static) —');
{
  check('AVATAR_BOX carries the render boxes (v141: dump 62x118, semi 62x136, pickup 60x104; v175 chase view: dump 92x132, semi 92x144, pickup 92x118, arrow 54x72)',
    /AVATAR_BOX = \{ dump: \[92, 132\], semi: \[92, 144\], pickup: \[92, 118\], arrow: \[54, 72\] \}/.test(navSrc));
  check('AVATAR_ASSET maps every vehicle kind to its shipped render',
    navSrc.indexOf("AVATAR_ASSET = { dump: 'assets/avatar-dump.png', semi: 'assets/avatar-semi.png', pickup: 'assets/avatar-pickup.png' }") >= 0);
  check('avatarGlyph paints the vehicle kinds as ONE <img class="nv-avatar-img"> off the asset table',
    /if \(AVATAR_ASSET\[kind\]\) \{\s*return '<img class="nv-avatar-img" src="' \+ AVATAR_ASSET\[kind\]/.test(navSrc));
  check('the drawn vehicle SVG is GONE (no leftover gradient-id glyphs: bxdump / trsemi / bedpk)',
    navSrc.indexOf('bxdump') < 0 && navSrc.indexOf('trsemi') < 0 && navSrc.indexOf('bedpk') < 0 &&
    navSrc.indexOf('function wheel(') < 0 && navSrc.indexOf('function cab(') < 0);
  check('the arrow keeps its drawn chevron with a per-slot gradient id (the only SVG glyph left)',
    navSrc.indexOf('<linearGradient id="ar') >= 0 &&
    navSrc.indexOf("'arrow' + (slot === 'p' ? 'p' : 'm')") >= 0 &&
    navSrc.indexOf('<polygon points="27,4 46,62 27,48 8,62"') >= 0);
  check('the marker is still painted by paintYou/render and swapped only at the chooser tap (wiring untouched)',
    navSrc.indexOf("youEl.innerHTML = avatarGlyph(S.settings.avatar, 'm')") >= 0 &&
    navSrc.indexOf("avatarGlyph(k, 'p')") >= 0);
  /* v142 pin move (the standing convention): the OTA number only
     moves forward, so the pin follows the live version 143 -> 144.
     v143 pin move: 144 -> 145, same convention.
     v144 pin move: 145 -> 146, same convention.
     v145 pin move: 146 -> 147, same convention.
     v146 pin move: 147 -> 148, same convention.
     v149 pin move: 148 -> 149, same convention.
     v150 pin move: 149 -> 150, same convention.
     v151 pin move: 150 -> 151, same convention.
     v152 pin move: 151 -> 152, same convention.
     v154 pin move: 153 -> 154, same convention.
     v155 pin move: 154 -> 155, same convention. */
  /* v147 pin move (the standing convention): 155 -> 156.
     v148 pin move: 156 -> 157, same convention. v156 pin move: 157 -> 158, same convention. v159 pin move: 158 -> 159, same convention. v160 pin move: 159 -> 160, same convention. v161 pin move: 160 -> 161, same convention. */
  check('ships as webVersion 180, and index.html loads the navigator at the 180 pin',
    ver.webVersion === 180 && idxSrc.indexOf('src="modules/navigator.js?v=180"') >= 0,
    'webVersion=' + ver.webVersion);
  check('version.json carries all three render assets in the OTA manifest',
    ['assets/avatar-dump.png', 'assets/avatar-semi.png', 'assets/avatar-pickup.png'].every(function (k) {
      return typeof ver.files[k] === 'string' && ver.files[k].length === 64;
    }));
}

console.log('— 2. the assets themselves —');
['dump', 'semi', 'pickup'].forEach(function (kind) {
  const p = 'assets/avatar-' + kind + '.png';
  const png = fs.existsSync(path.join(ROOT, p)) ? readPng(p) : { ok: false, why: 'missing' };
  check(p + ' is a real PNG with an alpha channel (RGBA, 8-bit, non-interlaced)',
    png.ok && png.ihdr.color === 6 && png.ihdr.depth === 8 && png.ihdr.interlace === 0,
    png.ok ? JSON.stringify(png.ihdr) : png.why);
  check(p + ' is exactly 3x its CSS box (' + BOX[kind][0] + 'x' + BOX[kind][1] + ' -> ' + BOX[kind][0] * 3 + 'x' + BOX[kind][1] * 3 + ')',
    png.ok && png.ihdr.w === BOX[kind][0] * 3 && png.ihdr.h === BOX[kind][1] * 3,
    png.ok ? png.ihdr.w + 'x' + png.ihdr.h : png.why);
  check(p + ' is keyed, not a rectangle: corners fully transparent, the truck opaque at the centre',
    png.ok && png.alphaAt(0.02, 0.02) === 0 && png.alphaAt(0.98, 0.98) === 0 && png.alphaAt(0.5, 0.5) === 255,
    png.ok ? 'corner=' + png.alphaAt(0.02, 0.02) + ' centre=' + png.alphaAt(0.5, 0.5) : png.why);
  check(p + ' is a sane OTA download (< 200 KB)', png.ok && png.bytes < 200000,
    png.ok ? png.bytes + ' bytes' : png.why);
});

console.log('— 3. the sizing CSS (no new layers) —');
{
  function ruleBody(selPart) {
    const re = /([^{}]+)\{([^}]*)\}/g; let m;
    while ((m = re.exec(cssSrc))) { if (m[1].trim().indexOf(selPart) >= 0) return m[2]; }
    return null;
  }
  const mi = ruleBody('.nv-drive-you img');
  check('the marker <img> fills the AVATAR_BOX box (width/height 100%, block) — plain sizing only',
    !!mi && /width:100%/.test(mi) && /height:100%/.test(mi) && !/transform|will-change|filter/.test(mi), String(mi));
  const pi = ruleBody('.nv-avatar-opt img');
  check('the chooser <img> is contained in its button (object-fit:contain) — plain sizing only',
    !!pi && /object-fit:contain/.test(pi) && !/transform|will-change/.test(pi), String(pi));
  const you = ruleBody('.nv-drive-you');
  check('the marker anchor rule is untouched (left:50%, top:64%, NO width — the box still comes from AVATAR_BOX)',
    !!you && /left:50%/.test(you) && /top:64%/.test(you) && !/width:/.test(you), String(you));
}

/* ---------- instrumented DOM (the v139 harness, verbatim pattern) ---------- */
function el() {
  const e = {
    children: {}, style: {}, _html: '', _htmlSets: 0, value: '', onclick: null,
    _text: '', _sets: 0, _sameSets: 0, _emptySets: 0, _attrs: {},
    _listeners: {},
    addEventListener: function (ev, fn) { (e._listeners[ev] = e._listeners[ev] || []).push(fn); },
    fire: function (ev) { (e._listeners[ev] || []).slice().forEach(function (f) { f(); }); },
    classList: {
      _s: new Set(),
      add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); },
      toggle: function (c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { on ? this._s.add(c) : this._s.delete(c); } },
      contains: function (c) { return this._s.has(c); }
    },
    querySelector: function (sel) { return e.children[sel] || null; },
    querySelectorAll: function () { return []; },
    getAttribute: function () { return null; },
    setAttribute: function (n, v) { e._attrs[n] = String(v); },
    resetTextMeter: function () { e._sets = 0; e._sameSets = 0; e._emptySets = 0; }
  };
  Object.defineProperty(e, 'textContent', {
    configurable: true,
    get: function () { return e._text; },
    set: function (v) {
      v = String(v); e._sets++;
      if (v === e._text) e._sameSets++;
      if (v === '') e._emptySets++;
      e._text = v;
    }
  });
  Object.defineProperty(e, 'innerHTML', {
    configurable: true,
    get: function () { return e._html; }, set: function (v) { e._htmlSets++; e._html = String(v); }
  });
  return e;
}
function resultsEl() {
  const e = el();
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
        e._rows[pid] = { onclick: null,
          getAttribute: function (n) { return n === 'data-pid' ? pid : null; },
          click: function () { if (this.onclick) this.onclick(); } };
      }
    }
  });
  e.pick = function (pid) { const r = e._rows[pid]; if (r) r.click(); };
  return e;
}

function makeWorld(storeData) {
  const store = {
    get: function (k, d) { return storeData[k] !== undefined ? storeData[k] : d; },
    set: function (k, v) { storeData[k] = v; },
    del: function (k) { delete storeData[k]; }
  };
  const ids = ['nv_banner', 'nv_map', 'nv_mode_truck', 'nv_mode_car', 'nv_follow', 'nv_mute',
    'nv_q', 'nv_search', 'nv_results', 'nv_destnote', 'nv_route', 'nv_end', 'nv_note', 'nv_steps',
    'nv_pq', 'nv_presults',
    'nv_back', 'nv_drive', 'nv_drive_screen', 'nv_drive_map',
    'nvd_dist', 'nvd_inst', 'nvd_road', 'nvd_eta_main', 'nvd_eta_sub', 'nvd_reroute', 'nvd_plane',
    'nvd_mute', 'nvd_exit', 'nvd_you', 'nvd_avatar_picker'];
  const reg = {};
  ids.forEach(function (id) { reg[id] = el(); });
  reg.nv_presults = resultsEl();
  reg.nv_banner.children['.nv-banner-main'] = el();
  reg.nv_banner.children['.nv-banner-sub'] = el();
  const avOpts = ['dump', 'semi', 'pickup', 'arrow'].map(function (k) {
    const o = el();
    o.getAttribute = function (n) { return n === 'data-avatar' ? k : null; };
    return o;
  });
  reg.nvd_avatar_picker.querySelectorAll = function (sel) { return sel === '[data-avatar]' ? avOpts : []; };
  const body = el();
  body.querySelector = function (sel) { return reg[sel.slice(1)] || null; };
  body.querySelectorAll = function () { return []; };

  const calls = { fetch: [], polylines: [], spoken: [], views: [], opened: [], anchors: [], markers: [], maps: [], groups: [] };
  const mapHandlers = {};
  function makeMapStub() {
    const m = {
      _adds: 0, _removes: 0, _views: [], _panTos: [], _center: null, _zoom: 15,
      setView: function (c, z) { m._views.push([c, z]); calls.views.push([c, z]); m._center = c; if (z) m._zoom = z; return m; },
      panTo: function (c, o) { m._panTos.push([c, o]); m._center = c; return m; },
      getCenter: function () { return m._center ? { lat: m._center[0], lng: m._center[1] } : null; },
      getZoom: function () { return m._zoom; },
      on: function (ev, fn) { mapHandlers[ev] = fn; },
      addLayer: function () { m._adds++; return m; },
      removeLayer: function () { m._removes++; return m; },
      remove: function () {}, fitBounds: function () {}, invalidateSize: function () {}
    };
    return m;
  }
  const L = {
    map: function () { const m = makeMapStub(); calls.maps.push(m); return m; },
    tileLayer: function () { return { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return this; } }; },
    marker: function (ll) { calls.markers.push(ll); return { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return this; }, setLatLng: function () {} }; },
    circleMarker: function () {
      const cm = { _latlngSets: 0, addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return cm; },
        setLatLng: function () { cm._latlngSets++; } };
      return cm;
    },
    polyline: function (pts) {
      calls.polylines.push(pts);
      const pl = { _latlngSets: 0, addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return pl; },
        setLatLngs: function () { pl._latlngSets++; }, getBounds: function () { return {}; } };
      return pl;
    },
    layerGroup: function (kids) {
      const g = { _kids: kids, getLayers: function () { return g._kids.slice(); },
        addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return g; } };
      calls.groups.push(g);
      return g;
    }
  };
  let geoCb = null;
  const world = {
    console: console, JSON: JSON, Math: Math, Date: Date, setTimeout: setTimeout,
    window: null,
    document: {
      hidden: false,
      addEventListener: function () {}, removeEventListener: function () {},
      createElement: function () {
        const a = { href: '', style: {}, click: function () { calls.anchors.push(a.href); }, remove: function () {} };
        return a;
      },
      body: { appendChild: function () {}, classList: { add: function () {}, remove: function () {} } }
    },
    open: function (u) { calls.opened.push(u); },
    App: {
      _esc: function (s) { return String(s == null ? '' : s); }, _store: store,
      _today: function () { return '2026-10-17'; }, openModule: function () {}
    },
    Meticulous: {},
    L: L,
    navigator: { geolocation: { watchPosition: function (cb) { geoCb = cb; return 7; }, clearWatch: function () {} } },
    speechSynthesis: { cancel: function () {}, speak: function (u) { calls.spoken.push(u.text); } },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    fetch: function (url) {
      calls.fetch.push({ url: url });
      if (url.indexOf('/route') >= 0) {
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(fixture); } });
      }
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); } });
    }
  };
  world.window = world;
  vm.createContext(world);
  vm.runInContext(navSrc, world);
  return { world: world, reg: reg, body: body, calls: calls, mapHandlers: mapHandlers,
    avOpts: avOpts, storeData: storeData,
    firePos: function (la, lo, hd, sp) { geoCb({ coords: { latitude: la, longitude: lo, heading: hd, speed: sp } }); } };
}
function tick() { return new Promise(function (r) { setTimeout(r, 10); }); }
function extract(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}

(async function () {
  console.log('— 4. behaviour: the renders on the face —');
  const storeData = { navigator: { serverUrl: 'http://nav.test', profile: {}, muted: false, mode: 'truck' } };
  const w = makeWorld(storeData);
  const api = w.world.Meticulous.modules.navigator;
  w.reg.nv_drive.classList.add('hidden');
  w.reg.nv_drive_screen.classList.add('hidden');
  w.reg.nvd_reroute.classList.add('hidden');
  w.reg.nvd_avatar_picker.classList.add('hidden');
  api.render(w.body);
  const html = w.body._html;

  check('the render paints the DUMP render as the marker, sized + margin-centred from the box (v175: 92x132, -46/-66)',
    html.indexOf('width:92px;height:132px;margin-left:-46px;margin-top:-66px') >= 0 &&
    html.indexOf('<img class="nv-avatar-img" src="assets/avatar-dump.png"') >= 0);
  check('the chooser offers all four kinds: three renders + the drawn arrow, dump selected',
    (html.match(/data-avatar=/g) || []).length === 4 &&
    html.indexOf('src="assets/avatar-semi.png"') >= 0 && html.indexOf('src="assets/avatar-pickup.png"') >= 0 &&
    html.indexOf('id="ararrowp"') >= 0 && /class="nv-avatar-opt on" data-avatar="dump"/.test(html));
  check('no drawn vehicle SVG survives anywhere in the render (the only <polygon> left is the arrow)',
    html.indexOf('bxdump') < 0 && html.indexOf('trsemi') < 0 && html.indexOf('bedpk') < 0);

  w.firePos(ORIGIN[0], ORIGIN[1], 40);
  w.mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } });
  await tick(); await tick();
  w.reg.nv_drive.onclick();
  check('drive screen opened', !w.reg.nv_drive_screen.classList.contains('hidden'));
  await new Promise(function (r) { setTimeout(r, 220); });

  const sb = { console };
  vm.createContext(sb);
  vm.runInContext(extract(navSrc, 'NAVPURE-BEGIN', 'NAVPURE-END'), sb);
  const line = sb.decodeShape(fixture.trip.legs[0].shape);
  const ptAt = function (f) { return line[Math.floor(line.length * f)]; };
  const youSets = w.reg.nvd_you._htmlSets;
  for (let s = 0; s < 10; s++) { const p = ptAt(0.05 + s * 0.05); w.firePos(p[0], p[1], 96); }
  check('ten drive ticks never repaint the marker (v133/v139 mutate-only stands with the raster art)',
    w.reg.nvd_you._htmlSets === youSets, w.reg.nvd_you._htmlSets + ' vs ' + youSets);

  console.log('— 5. behaviour: the chooser swaps renders, boxes and the store —');
  w.reg.nvd_you.onclick();
  check('tapping the marker opens the chooser', !w.reg.nvd_avatar_picker.classList.contains('hidden'));
  w.avOpts[2].onclick(); /* pickup */
  check('the pickup choice persists through the navigator settings store',
    storeData.navigator.avatar === 'pickup', JSON.stringify(storeData.navigator));
  check('the glyph swaps AT THE TAP to the pickup render',
    w.reg.nvd_you._html.indexOf('src="assets/avatar-pickup.png"') >= 0, w.reg.nvd_you._html.slice(0, 70));
  check('the marker box follows the kind: pickup 92x118, margins -46/-59 (plain styles, no transform; v175 pin move from 60x104, -30/-52)',
    w.reg.nvd_you.style.width === '92px' && w.reg.nvd_you.style.height === '118px' &&
    w.reg.nvd_you.style.marginLeft === '-46px' && w.reg.nvd_you.style.marginTop === '-59px',
    JSON.stringify(w.reg.nvd_you.style));
  check('the chooser closes on the choice and marks pickup selected',
    w.reg.nvd_avatar_picker.classList.contains('hidden') && w.avOpts[2].classList.contains('on') &&
    !w.avOpts[0].classList.contains('on'));
  w.reg.nvd_you.onclick();
  w.avOpts[3].onclick(); /* arrow */
  check('the arrow still paints its drawn chevron (SVG, marker-slot gradient id) and persists',
    w.reg.nvd_you._html.indexOf('<svg') >= 0 && w.reg.nvd_you._html.indexOf('id="ararrowm"') >= 0 &&
    storeData.navigator.avatar === 'arrow', w.reg.nvd_you._html.slice(0, 70));
  check('the arrow box is its own (54x72, margins -27/-36)',
    w.reg.nvd_you.style.width === '54px' && w.reg.nvd_you.style.height === '72px' &&
    w.reg.nvd_you.style.marginLeft === '-27px' && w.reg.nvd_you.style.marginTop === '-36px',
    JSON.stringify(w.reg.nvd_you.style));
  api.teardown();

  console.log('— 6. behaviour: a persisted render paints on a fresh render —');
  const store2 = { navigator: { serverUrl: 'http://nav.test', profile: {}, muted: false, mode: 'truck', avatar: 'pickup' } };
  const w2 = makeWorld(store2);
  const api2 = w2.world.Meticulous.modules.navigator;
  api2.render(w2.body);
  check('the persisted pickup paints in the markup, sized from its box (92x118, -46/-59; v175 pin move)',
    w2.body._html.indexOf('src="assets/avatar-pickup.png"') >= 0 &&
    w2.body._html.indexOf('width:92px;height:118px;margin-left:-46px;margin-top:-59px') >= 0);
  api2.teardown();

  console.log('\nnavigator-v141: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
