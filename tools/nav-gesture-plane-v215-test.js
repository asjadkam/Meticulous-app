#!/usr/bin/env node
/* Meticulous v215 — NAV-GESTURE-PLANE (owner's video, Oct 21,
 * 2026 15:22 MDT): driving home, he pinches to zoom out and
 * the whole sheet — map AND truck — scales/rotates/tilts as
 * one rigid plane, repeated pinches spin and slide the view
 * far off the truck. His words: "Why is my truck moving with
 * the zoom?" Same video, 15:24 MDT: "tilt towards the right
 * of the truck is still there... Making the entire map look
 * oblong."
 *
 * Root causes, three:
 *   1. Leaflet's own pinch (touchZoom) zooms about the FINGER
 *      CENTROID. Every pinch walked the truck's ground point
 *      off the map centre — off the fixed avatar — and
 *      free-look then stood the follow camera down, leaving
 *      the truck floating over whatever terrain the sheet
 *      stopped on.
 *   2. The gesture channel LOCKED on the first threshold
 *      crossed. A natural pinch skews 12–20° long before its
 *      spread reaches the 40 px pinch threshold, so pinches
 *      locked as ROTATE mid-gesture and the plane spun while
 *      Leaflet zoomed (see the gestureClass guards, Part 1).
 *   3. Twist/tilt pivot on the plane's centre — the truck
 *      only while the camera sits on the truck. Nothing
 *      re-anchored the camera before a gesture acted.
 *
 * The fix: the gestures drive the map CAMERA about the
 * truck. touchZoom is off; the observer applies the pinch
 * itself via setZoomAround on the truck's own latlng (the
 * zoom changes, the truck's screen point does not move, the
 * follow camera keeps the truck). At any channel's lock-in
 * the camera re-anchors on the truck once, so the twist's
 * bearing rotation and the tilt's pitch are truly about the
 * truck's GPS position — the plane centre, the avatar's
 * fixed anchor. The avatar stays a sibling overlay outside
 * the plane (v139) and never transforms. A fresh drive
 * zeroes the manual adjustments at entry, so no residual
 * lean can greet it.
 *
 * Part 1: NAVPURE — the classifier's new pinch guards + the
 * pinch-zoom arithmetic. Part 2: the real module driven in
 * a fake-DOM world whose Leaflet stub is a REAL CAMERA
 * (Web-Mercator center/zoom; setZoomAround with Leaflet's
 * own keep-the-latlng's-point semantics), so the avatar
 * anchor can be MEASURED, not assumed:
 *   (a) the truck's GPS point projects to the avatar anchor
 *       (within 3 px) before, during and after every gesture;
 *   (b) the camera changes as commanded — pinch ×3 = three
 *       zoom levels about the truck, twist 45° = the bearing
 *       term by exactly 45°, tilt = the pitch term only;
 *   (c) a pinch carrying 24° of incidental skew (the video)
 *       never locks rotate and never touches the plane;
 *   (d) the snap-back restores the pure chase view, centred.
 * Part 3: the LEVEL / TRUE-PROPORTION proofs — the actual
 * transform string the module writes is parsed and a ground
 * square at the anchor is projected through it: at rest the
 * travel-perpendicular edge is exactly horizontal (roll 0),
 * the travel edge exactly vertical, and the only x/y scale
 * difference is the pitch's own cos foreshortening (no sheet
 * skew, no anisotropic scale); after a tilt, roll is still 0
 * and the foreshortening is still exactly cos(pitch).
 * Run: node tools/nav-gesture-plane-v215-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const navSrc = read('modules/navigator.js');
const fixture = JSON.parse(read('tools/navigator-fixture-tripb.json'));
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));
const ORIGIN = [51.0955, -114.099], DEST = [51.1075, -114.0845];
const HEAD = 40;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function near(name, got, want, tol) {
  ok(name, Math.abs(got - want) <= (tol || 0.01), 'got ' + got + ', want ~' + want + ' ±' + (tol || 0.01));
}

/* ---------- Part 1: NAVPURE ---------- */
console.log('— NAVPURE: the pinch guards + pinch zoom —');
const pureBegin = navSrc.indexOf('NAVPURE-BEGIN');
const pureEndMark = navSrc.indexOf('NAVPURE-END');
const pureRegion = navSrc.slice(navSrc.indexOf('function ', pureBegin), navSrc.lastIndexOf('/*', pureEndMark));
const pure = {};
{
  const sb = { Math: Math, JSON: JSON, console: console };
  vm.createContext(sb);
  vm.runInContext(pureRegion + '\nthis.__x = { gestureVec: gestureVec, gestureClass: gestureClass, pinchZoomFrom: pinchZoomFrom };', sb);
  Object.assign(pure, sb.__x);
}
{
  const base = { angle: 0, dist: 100, midY: 100 };
  /* every v210 classification pin survives */
  eq('v210: a pinch (spread +45) is a pinch even with a 20° twist in it',
    pure.gestureClass(base, { angle: 20, dist: 145, midY: 100 }), 'pinch');
  eq('v210: a pure twist (+20°, spread +5) is rotate',
    pure.gestureClass(base, { angle: 20, dist: 105, midY: 104 }), 'rotate');
  eq('v210: a vertical slide is tilt',
    pure.gestureClass(base, { angle: 2, dist: 103, midY: 60 }), 'tilt');
  eq('v210: jitter is nothing yet',
    pure.gestureClass(base, { angle: 5, dist: 112, midY: 109 }), null);
  /* the video: a pinch-IN whose fingers skew as they close.
     Start dist 200; the state partway in — spread −20, twist
     8°, midpoint sagging — must already read PINCH (the old
     race locked ROTATE a step later, at twist 12°). */
  eq('the video pinch (spread −20, twist 8°) reads pinch, not rotate',
    pure.gestureClass({ angle: 0, dist: 200, midY: 100 }, { angle: 8, dist: 180, midY: 112.5 }), 'pinch');
  eq('the video pinch deeper in (spread −30, twist 12°) reads pinch',
    pure.gestureClass({ angle: 0, dist: 200, midY: 100 }, { angle: 12, dist: 170, midY: 119 }), 'pinch');
  /* the guards do not eat real gestures */
  eq('a committed slide with finger-breathing (midY −40, spread +25, twist 5°) is tilt',
    pure.gestureClass(base, { angle: 5, dist: 125, midY: 60 }), 'tilt');
  eq('an extreme twist (45°) with a breathing spread (+25) is rotate',
    pure.gestureClass(base, { angle: 45, dist: 125, midY: 104 }), 'rotate');
  /* the pinch-zoom arithmetic */
  near('spread doubling is +1 zoom', pure.pinchZoomFrom(18, 100, 200), 19);
  near('spread halving is −1 zoom', pure.pinchZoomFrom(18, 200, 100), 17);
  near('no spread change, no zoom change', pure.pinchZoomFrom(16, 120, 120), 16);
  near('zoom clamps at the top of the band', pure.pinchZoomFrom(18.6, 100, 400), 19);
  near('zoom clamps at the bottom of the band', pure.pinchZoomFrom(15, 100, 40), 14);
  near('a dead spread is guarded', pure.pinchZoomFrom(18, 0, 100), 18);
}

/* ---------- Part 2 + 3: the driven drive, real camera ---------- */
function el() {
  const e = {
    children: {}, style: {}, _html: '', value: '', onclick: null, _text: '', _attrs: {},
    _listeners: {},
    addEventListener: function (ev, fn) { (e._listeners[ev] = e._listeners[ev] || []).push(fn); },
    removeEventListener: function (ev, fn) {
      const l = e._listeners[ev] || [];
      const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
    },
    firePtr: function (ev, pid, x, y) {
      (e._listeners[ev] || []).slice().forEach(function (f) { f({ pointerId: pid, clientX: x, clientY: y }); });
    },
    classList: {
      _s: new Set(),
      add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); },
      toggle: function (c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { on ? this._s.add(c) : this._s.delete(c); } },
      contains: function (c) { return this._s.has(c); }
    },
    querySelector: function (sel) { return e.children[sel] || null; },
    querySelectorAll: function () { return []; },
    getAttribute: function () { return null; },
    setAttribute: function (n, v) { e._attrs[n] = String(v); }
  };
  Object.defineProperty(e, 'textContent', {
    configurable: true,
    get: function () { return e._text; },
    set: function (v) { e._text = String(v); }
  });
  Object.defineProperty(e, 'innerHTML', {
    configurable: true,
    get: function () { return e._html; }, set: function (v) { e._html = String(v); }
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
    configurable: true,
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
  return e;
}

/* Web-Mercator world-pixel projection (Leaflet's own CRS). */
function project(lat, lng, zoom) {
  const s = 256 * Math.pow(2, zoom);
  const sinLat = Math.sin(lat * Math.PI / 180);
  return {
    x: (lng + 180) / 360 * s,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * s
  };
}
function unproject(x, y, zoom) {
  const s = 256 * Math.pow(2, zoom);
  const n = Math.PI - 2 * Math.PI * y / s;
  return [180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), x / s * 360 - 180];
}
/* The plane is 230% wide × 300% tall of a 412×915 glass
   (style.css; height grew in v220 for top coverage), so the
   drive map — which fills the plane — measures 948×2745 and
   its centre IS the avatar anchor (50% / 64% of the glass). */
const MAP_W = 948, MAP_H = 2745;

function makeWorld() {
  const storeData = { navigator: { profile: {}, muted: false, mode: 'truck' } };
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
    'nvd_mute', 'nvd_exit', 'nvd_you', 'nvd_avatar_picker', 'nvd_recenter'];
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

  const calls = { spoken: [] };
  const mapHandlers = {};
  const mapsById = {};
  /* A Leaflet stub with REAL camera semantics: center + zoom
     over a Mercator world; setZoomAround keeps the given
     latlng's container point fixed, exactly Leaflet's own
     arithmetic. */
  function makeCamera(id, opts) {
    const m = {
      _id: id, _opts: opts || {}, _center: [51.05, -114.06], _zoom: 11,
      setView: function (c, z) { m._center = [c[0], c[1]]; if (z !== undefined) m._zoom = z; return m; },
      panTo: function (c) { m._center = [c[0] !== undefined ? c[0] : c.lat, c[1] !== undefined ? c[1] : c.lng]; return m; },
      getCenter: function () { return { lat: m._center[0], lng: m._center[1] }; },
      getZoom: function () { return m._zoom; },
      setZoomAround: function (ll, z) {
        const anchor = Array.isArray(ll) ? ll : [ll.lat, ll.lng];
        const before = m.latLngToContainerPoint(anchor);
        m._zoom = z;
        const w = project(anchor[0], anchor[1], z);
        const c = unproject(w.x - (before.x - MAP_W / 2), w.y - (before.y - MAP_H / 2), z);
        m._center = c;
        return m;
      },
      latLngToContainerPoint: function (ll) {
        const a = Array.isArray(ll) ? ll : [ll.lat, ll.lng];
        const p = project(a[0], a[1], m._zoom), c = project(m._center[0], m._center[1], m._zoom);
        return { x: p.x - c.x + MAP_W / 2, y: p.y - c.y + MAP_H / 2 };
      },
      on: function (ev, fn) { mapHandlers[ev] = fn; },
      addLayer: function () { return m; }, removeLayer: function () { return m; },
      remove: function () {}, fitBounds: function () {}, invalidateSize: function () {}
    };
    mapsById[id] = m;
    return m;
  }
  const L = {
    map: function (id, opts) { return makeCamera(id, opts); },
    tileLayer: function () { return { addTo: function (mm) { if (mm && mm.addLayer) mm.addLayer(this); return this; } }; },
    marker: function () {
      const mk = { addTo: function (mm) { if (mm && mm.addLayer) mm.addLayer(this); return mk; },
        setLatLng: function () {}, setOpacity: function () {}, setIcon: function () {} };
      return mk;
    },
    circleMarker: function () {
      const cm = { addTo: function (mm) { if (mm && mm.addLayer) mm.addLayer(this); return cm; }, setLatLng: function () {} };
      return cm;
    },
    polyline: function () {
      const pl = { addTo: function (mm) { if (mm && mm.addLayer) mm.addLayer(this); return pl; },
        setLatLngs: function () {}, getBounds: function () { return {}; } };
      return pl;
    },
    layerGroup: function (kids) {
      const g = { getLayers: function () { return (kids || []).slice(); },
        addTo: function (mm) { if (mm && mm.addLayer) mm.addLayer(this); return g; } };
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
      createElement: function () { return { href: '', style: {}, click: function () {}, remove: function () {} }; },
      body: { appendChild: function () {}, classList: { add: function () {}, remove: function () {} } }
    },
    App: {
      _esc: function (s) { return String(s == null ? '' : s); }, _store: store,
      _today: function () { return '2026-10-21'; }, openModule: function () {}
    },
    Meticulous: {},
    L: L,
    navigator: { geolocation: { watchPosition: function (cb) { geoCb = cb; return 7; }, clearWatch: function () {} } },
    speechSynthesis: { cancel: function () {}, speak: function (u) { calls.spoken.push(u.text); }, getVoices: function () { return []; } },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    fetch: function (url) {
      if (url.indexOf('/route') >= 0) {
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(fixture); } });
      }
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); } });
    }
  };
  world.window = world;
  vm.createContext(world);
  vm.runInContext(navSrc, world);
  return {
    world: world, reg: reg, body: body, calls: calls, mapsById: mapsById,
    firePos: function (la, lo, hd, sp) { geoCb({ coords: { latitude: la, longitude: lo, heading: hd, speed: sp } }); },
    mapClick: function () { mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } }); },
    fireZoomStart: function () { if (mapHandlers.zoomstart) mapHandlers.zoomstart(); }
  };
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 10); }); }

/* Parse the plane transform the module actually wrote and
   compose it the way CSS does (origin at the plane centre):
   perspective(d) · rotateX(pitch) · rotate(rot), applied
   right-to-left to plane-space points (y down). */
function parsePlane(str) {
  const m = /perspective\(([-\d.]+)px\) rotateX\(([-\d.]+)deg\) rotate\(([-\d.]+)deg\)/.exec(str || '');
  if (!m) return null;
  return { persp: Number(m[1]), pitch: Number(m[2]), rot: Number(m[3]) };
}
function projectPlane(x, y, t) {
  const a = t.rot * Math.PI / 180;
  const x1 = x * Math.cos(a) - y * Math.sin(a), y1 = x * Math.sin(a) + y * Math.cos(a);
  const p = t.pitch * Math.PI / 180;
  const y2 = y1 * Math.cos(p), z2 = y1 * Math.sin(p);
  const w = 1 - z2 / t.persp;
  return { x: x1 / w, y: y2 / w };
}
/* The LEVEL + TRUE-PROPORTION proof over a ground square at
   the anchor (side 2L, edges along travel / perpendicular):
   the perpendicular edge must project exactly horizontal
   (roll 0), the travel edge exactly vertical, and the only
   scale difference between the edges must be cos(pitch) —
   the projection's own foreshortening, nothing else. */
function assertLevelTrue(label, transformStr, headingDeg) {
  const t = parsePlane(transformStr);
  ok(label + ': the plane transform parses as the composed chase view', !!t, String(transformStr));
  if (!t) return;
  const h = headingDeg * Math.PI / 180;
  const eT = { x: Math.sin(h), y: -Math.cos(h) };   /* travel, plane coords */
  const eP = { x: Math.cos(h), y: Math.sin(h) };    /* right of travel */
  const L = 120;
  const ppA = projectPlane(eP.x * L, eP.y * L, t), ppB = projectPlane(-eP.x * L, -eP.y * L, t);
  const ptA = projectPlane(eT.x * L, eT.y * L, t), ptB = projectPlane(-eT.x * L, -eT.y * L, t);
  const roll = Math.atan2(ppA.y - ppB.y, ppA.x - ppB.x) * 180 / Math.PI;
  near(label + ': roll is zero (perpendicular edge level)', Math.abs(roll), 0, 0.1);
  near(label + ': travel edge exactly vertical (no side-skew)', Math.abs(ptA.x - ptB.x), 0, 0.5);
  const sP = Math.sqrt(Math.pow(ppA.x - ppB.x, 2) + Math.pow(ppA.y - ppB.y, 2)) / (2 * L);
  const sT = Math.sqrt(Math.pow(ptA.x - ptB.x, 2) + Math.pow(ptA.y - ptB.y, 2)) / (2 * L);
  near(label + ': perpendicular scale is 1 (nothing stretched)', sP, 1, 0.01);
  near(label + ': travel scale is exactly cos(pitch) — foreshortening from the projection only',
    sT / sP, Math.cos(t.pitch * Math.PI / 180), 0.02);
  const c = projectPlane(0, 0, t);
  near(label + ': the ground point under the avatar projects to the avatar anchor', Math.abs(c.x) + Math.abs(c.y), 0, 0.01);
  ok(label + ': no sheet tricks in the transform (no scale / rotateY / skew)',
    !/scale\(|rotateY|skew/.test(transformStr));
}

(async function () {
  console.log('— the driven drive: pinch ×3 (skewed), twist 45°, tilt, snap-back —');
  const w = makeWorld();
  const api = w.world.Meticulous.modules.navigator;
  w.reg.nv_drive.classList.add('hidden');
  w.reg.nv_drive_screen.classList.add('hidden');
  w.reg.nvd_recenter.classList.add('hidden');
  api.render(w.body);
  w.firePos(ORIGIN[0], ORIGIN[1], HEAD);
  w.mapClick();
  await tick(); await tick(); await tick();
  w.reg.nv_drive.onclick();
  await tick(260);
  const plane = w.reg.nvd_plane;
  const map = w.reg.nv_drive_map;
  const drive = w.mapsById.nv_drive_map;
  const REST = 'perspective(1100px) rotateX(45deg) rotate(-40deg)';
  function truckErr() {
    const p = drive.latLngToContainerPoint(ORIGIN);
    return Math.max(Math.abs(p.x - MAP_W / 2), Math.abs(p.y - MAP_H / 2));
  }

  eq('the drive map is created with Leaflet pinch OFF (v215: it zoomed about the fingers)',
    drive._opts.touchZoom, false);
  eq('at rest the plane is the pure v139 chase composition', plane.style.transform, REST);
  near('at rest the truck sits on its avatar anchor', truckErr(), 0, 3);
  near('the drive opens at zoom 18', drive.getZoom(), 18, 0.01);
  assertLevelTrue('at rest', plane.style.transform, HEAD);

  /* PINCH ×3 — the video's gesture: fingers close from 200 px
     to 100 px in six steps, skewing +4° per step (24° of
     incidental twist riding the pinch). Per gesture the zoom
     must fall exactly one level, the plane must never be
     written, the truck must never leave its anchor, and the
     follow must never stand down. */
  for (let g = 0; g < 3; g++) {
    const z0 = drive.getZoom();
    map.firePtr('pointerdown', 1, 300, 400);
    map.firePtr('pointerdown', 2, 500, 400);
    for (let k = 1; k <= 6; k++) {
      const dist = 200 - (100 / 6) * k, ang = (4 * k) * Math.PI / 180;
      map.firePtr('pointermove', 2, 300 + dist * Math.cos(ang), 400 + dist * Math.sin(ang));
      near('pinch ' + (g + 1) + ' step ' + k + ': the truck never leaves its anchor', truckErr(), 0, 3);
      eq('pinch ' + (g + 1) + ' step ' + k + ': the plane is never written by a pinch',
        plane.style.transform, REST);
    }
    map.firePtr('pointerup', 1); map.firePtr('pointerup', 2);
    near('pinch ' + (g + 1) + ' took exactly one zoom level off, about the truck', drive.getZoom(), z0 - 1, 0.02);
    eq('pinch ' + (g + 1) + ' never entered free-look (follow keeps the truck)',
      w.reg.nvd_recenter.classList.contains('hidden'), true);
  }
  near('three pinches = three zoom levels', drive.getZoom(), 15, 0.02);

  /* a zoomstart fired mid-pinch must not stand the follow down */
  map.firePtr('pointerdown', 1, 300, 400);
  map.firePtr('pointerdown', 2, 500, 400);
  map.firePtr('pointermove', 2, 460, 430);
  w.fireZoomStart();
  eq('a zoomstart under our own pinch is not read as free-look',
    w.reg.nvd_recenter.classList.contains('hidden'), true);
  map.firePtr('pointerup', 1); map.firePtr('pointerup', 2);

  /* TWIST 45° — constant spread, second finger orbits +45°.
     (The zoom probe above cost 0.3 of a level by design; the
     twist is judged against the zoom it starts with.) */
  const zTwist = drive.getZoom();
  map.firePtr('pointerdown', 1, 300, 400);
  map.firePtr('pointerdown', 2, 400, 400);
  [9, 18, 27, 36, 45].forEach(function (deg) {
    const r = deg * Math.PI / 180;
    map.firePtr('pointermove', 2, 300 + 100 * Math.cos(r), 400 + 100 * Math.sin(r));
  });
  eq('a 45° clockwise twist turns the bearing term by exactly 45°',
    plane.style.transform, 'perspective(1100px) rotateX(45deg) rotate(5deg)');
  near('the twist never moved the truck off its anchor', truckErr(), 0, 3);
  near('the twist never touched the zoom', drive.getZoom(), zTwist, 0.02);
  map.firePtr('pointerup', 1); map.firePtr('pointerup', 2);

  /* SNAP-BACK restores the chase view, centred. */
  w.reg.nvd_recenter.onclick();
  eq('snap-back restores the pure chase composition', plane.style.transform, REST);
  near('snap-back leaves the camera centred on the truck', truckErr(), 0, 3);

  /* TILT — both fingers slide UP 40 px (pitch only). */
  map.firePtr('pointerdown', 1, 300, 500);
  map.firePtr('pointerdown', 2, 400, 500);
  [10, 20, 30, 40].forEach(function (dy) {
    map.firePtr('pointermove', 1, 300, 500 - dy);
    map.firePtr('pointermove', 2, 400, 500 - dy);
  });
  eq('sliding both fingers up 40px pitches to 55° — the bearing term untouched (pitch only, no yaw)',
    plane.style.transform, 'perspective(1100px) rotateX(55deg) rotate(-40deg)');
  near('the tilt never moved the truck off its anchor', truckErr(), 0, 3);
  assertLevelTrue('after the tilt', plane.style.transform, HEAD);
  map.firePtr('pointerup', 1); map.firePtr('pointerup', 2);

  /* SNAP-BACK again — nothing residual greets the next drive. */
  w.reg.nvd_recenter.onclick();
  eq('snap-back flattens the tilt — pure chase composition, zero residual lean',
    plane.style.transform, REST);
  assertLevelTrue('back at rest', plane.style.transform, HEAD);

  console.log('— pins —');
  ok('the pinch is applied through setZoomAround (Leaflet camera), never a sheet scale',
    navSrc.indexOf('setZoomAround') >= 0 && navSrc.indexOf('gesturePinchZoom') >= 0);
  ok('the camera re-anchors on the truck at a gesture lock-in',
    navSrc.indexOf('gestureAnchor') >= 0 && navSrc.indexOf('_gestAnchored') >= 0);
  ok('a fresh drive zeroes the manual adjustments at entry',
    /v215 \(NAV-GESTURE-PLANE\): a NEW drive[\s\S]{0,600}S\.viewRot = 0; S\.viewPitch = null;/.test(navSrc));
  ok('still exactly ONE .style.transform writer (paintPlane)',
    (navSrc.match(/\.style\.transform =/g) || []).length === 1);
  eq('webVersion is 215', ver.webVersion, 255);
  ok('index.html pins the v215 build', idxSrc.indexOf('?v=255') >= 0);

  console.log('\nnav-gesture-plane-v215 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR ' + (e && e.stack || e)); process.exit(1); });
