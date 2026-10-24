#!/usr/bin/env node
/* Meticulous v210 — NAV-GESTURES (owner's video + words, Oct 21,
 * 2026 13:14 MDT): pinch-to-zoom works, but "no 2 fingers to
 * rotate and change orientation or 2 fingers to change the
 * angle like with other gps's."
 *
 * Both gestures now live on the DRIVE view:
 *   - two-finger TWIST rotates the view (S.viewRot composes
 *     into the plane's one transform, against the twist so the
 *     map follows the fingers);
 *   - two-finger vertical SLIDE tilts it (S.viewPitch overrides
 *     the composed 45° pitch; fingers up = pitch up toward the
 *     horizon, down = flatten toward top-down).
 * The channel is decided by the NAVPURE gestureClass with PINCH
 * judged first and on its own threshold — a pinch never reads
 * as a rotate — then rotate/tilt by dominance against their own
 * thresholds, so a real gesture's cross-talk never steals the
 * channel. Handlers are PASSIVE observers: Leaflet keeps pinch
 * zoom + one-finger pan untouched. Engaging either gesture
 * enters free-look (the follow camera stands down); the
 * Re-center pill — or the 15 s snap-back — zeroes both
 * adjustments and restores the pure heading-up chase view.
 * With no gesture, the composed transform strings are
 * byte-identical to v139/v177.
 *
 * Part 1: the NAVPURE math, unit-proven. Part 2: the real
 * module driven in the v139/v208 fake-DOM world — synthetic
 * pointer events on the drive map, the plane's transform read
 * back after each gesture and after the snap-back.
 * Run: node tools/nav-gestures-v210-test.js
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
  ok(name, Math.abs(got - want) <= (tol || 0.01), 'got ' + got + ', want ~' + want);
}

/* ---------- Part 1: NAVPURE gesture math ---------- */
console.log('— NAVPURE: the gesture math —');
const pureBegin = navSrc.indexOf('NAVPURE-BEGIN');
const pureEndMark = navSrc.indexOf('NAVPURE-END');
const pureRegion = navSrc.slice(navSrc.indexOf('function ', pureBegin), navSrc.lastIndexOf('/*', pureEndMark));
const pure = {};
{
  const sb = { Math: Math, JSON: JSON, console: console };
  vm.createContext(sb);
  vm.runInContext(pureRegion + '\nthis.__x = { gestureVec: gestureVec, gestureAngDelta: gestureAngDelta, gestureClass: gestureClass, tiltPitchFrom: tiltPitchFrom, gestureRotOffset: gestureRotOffset };', sb);
  Object.assign(pure, sb.__x);
}
{
  const v = pure.gestureVec({ x: 0, y: 0 }, { x: 3, y: 4 });
  near('vec distance', v.dist, 5);
  near('vec angle', v.angle, 53.13, 0.01);
  near('vec midY', v.midY, 2);
  const base = { angle: 0, dist: 100, midY: 100 };
  eq('a pinch (spread +45) is a pinch even with a 20° twist in it',
    pure.gestureClass(base, { angle: 20, dist: 145, midY: 100 }), 'pinch');
  eq('a pinch-in (spread -45) is a pinch too',
    pure.gestureClass(base, { angle: -15, dist: 55, midY: 100 }), 'pinch');
  eq('a pure twist (+20°, spread +5) is rotate',
    pure.gestureClass(base, { angle: 20, dist: 105, midY: 104 }), 'rotate');
  eq('a twist the other way (-25°) is rotate',
    pure.gestureClass(base, { angle: -25, dist: 98, midY: 96 }), 'rotate');
  eq('a vertical slide (midY -40, twist 2°, spread +3) is tilt',
    pure.gestureClass(base, { angle: 2, dist: 103, midY: 60 }), 'tilt');
  eq('a downward slide (midY +35) is tilt',
    pure.gestureClass(base, { angle: -3, dist: 99, midY: 135 }), 'tilt');
  eq('jitter (twist 5°, midY 9, spread 12) is nothing yet',
    pure.gestureClass(base, { angle: 5, dist: 112, midY: 109 }), null);
  eq('tilt pitch: fingers up 40px from 45 → 55', pure.tiltPitchFrom(45, -40), 55);
  eq('tilt pitch: fingers down 100px from 45 → 20', pure.tiltPitchFrom(45, 100), 20);
  eq('tilt pitch clamps at 65', pure.tiltPitchFrom(45, -200), 65);
  eq('tilt pitch clamps at 0', pure.tiltPitchFrom(45, 400), 0);
  eq('rot offset: clockwise twist 30° from 0 → -30 (map follows fingers)', pure.gestureRotOffset(0, 10, 40), -30);
  eq('rot offset composes on a base', pure.gestureRotOffset(5, 40, 10), 35);
  eq('angle delta wraps the short way', pure.gestureAngDelta(350, 10), 20);
}

/* ---------- Part 2: the driven drive view ---------- */
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
  function makeMapStub() {
    const m = {
      setView: function () { return m; }, panTo: function () { return m; },
      getCenter: function () { return null; }, getZoom: function () { return 15; },
      on: function (ev, fn) { mapHandlers[ev] = fn; },
      addLayer: function () { return m; }, removeLayer: function () { return m; },
      remove: function () {}, fitBounds: function () {}, invalidateSize: function () {}
    };
    return m;
  }
  const L = {
    map: function () { return makeMapStub(); },
    tileLayer: function () { return { addTo: function (mm) { if (mm && mm.addLayer) mm.addLayer(this); return this; } }; },
    marker: function () { return { addTo: function (mm) { if (mm && mm.addLayer) mm.addLayer(this); return this; }, setLatLng: function () {} }; },
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
    world: world, reg: reg, body: body, calls: calls,
    firePos: function (la, lo, hd, sp) { geoCb({ coords: { latitude: la, longitude: lo, heading: hd, speed: sp } }); },
    mapClick: function () { mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } }); }
  };
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 10); }); }

(async function () {
  console.log('— the driven drive view: twist, tilt, snap-back —');
  const w = makeWorld();
  const api = w.world.Meticulous.modules.navigator;
  w.reg.nv_drive.classList.add('hidden');
  w.reg.nv_drive_screen.classList.add('hidden');
  w.reg.nvd_recenter.classList.add('hidden');
  api.render(w.body);
  w.firePos(ORIGIN[0], ORIGIN[1], 40);
  w.mapClick();
  await tick(); await tick(); await tick();
  w.reg.nv_drive.onclick();
  await tick(260);
  const plane = w.reg.nvd_plane;
  const map = w.reg.nv_drive_map;
  eq('at rest the plane is the pure v139 chase composition',
    plane.style.transform, 'perspective(1100px) rotateX(45deg) rotate(-40deg)');
  eq('the gesture observers are attached (one per pointer event)',
    (map._listeners['pointerdown'] || []).length, 1);
  eq('the recenter pill is hidden while following',
    w.reg.nvd_recenter.classList.contains('hidden'), true);

  /* TWIST: two fingers down, second finger orbits the first by
     +30° in three 10° steps (dist held at 100). */
  map.firePtr('pointerdown', 1, 100, 100);
  map.firePtr('pointerdown', 2, 200, 100);
  [10, 20, 30].forEach(function (deg) {
    const r = deg * Math.PI / 180;
    map.firePtr('pointermove', 2, 100 + 100 * Math.cos(r), 100 + 100 * Math.sin(r));
  });
  eq('a 30° clockwise twist turns the view 30° clockwise (rotate(-40+30))',
    plane.style.transform, 'perspective(1100px) rotateX(45deg) rotate(-10deg)');
  eq('the twist entered free-look (recenter pill showing)',
    w.reg.nvd_recenter.classList.contains('hidden'), false);
  map.firePtr('pointerup', 1); map.firePtr('pointerup', 2);
  eq('lifting the fingers keeps the manual view (free-look holds)',
    plane.style.transform, 'perspective(1100px) rotateX(45deg) rotate(-10deg)');

  /* SNAP-BACK: the pill restores the pure chase view. */
  w.reg.nvd_recenter.onclick();
  eq('recenter zeroes the rotation — pure chase composition back',
    plane.style.transform, 'perspective(1100px) rotateX(45deg) rotate(-40deg)');

  /* TILT: both fingers slide UP 40px in four 10px steps. */
  map.firePtr('pointerdown', 1, 100, 200);
  map.firePtr('pointerdown', 2, 200, 200);
  [10, 20, 30, 40].forEach(function (dy) {
    map.firePtr('pointermove', 1, 100, 200 - dy);
    map.firePtr('pointermove', 2, 200, 200 - dy);
  });
  eq('sliding both fingers up 40px pitches the view up (45 + 10)',
    plane.style.transform, 'perspective(1100px) rotateX(55deg) rotate(-40deg)');
  map.firePtr('pointerup', 1); map.firePtr('pointerup', 2);
  w.reg.nvd_recenter.onclick();
  eq('recenter flattens the tilt back to the posture default',
    plane.style.transform, 'perspective(1100px) rotateX(45deg) rotate(-40deg)');

  /* PINCH: a big spread changes nothing of ours (Leaflet zooms). */
  map.firePtr('pointerdown', 1, 100, 100);
  map.firePtr('pointerdown', 2, 200, 100);
  map.firePtr('pointermove', 2, 260, 100);
  eq('a pinch leaves the plane composition untouched',
    plane.style.transform, 'perspective(1100px) rotateX(45deg) rotate(-40deg)');
  map.firePtr('pointerup', 1); map.firePtr('pointerup', 2);

  /* ONE FINGER: never a gesture. */
  map.firePtr('pointerdown', 1, 100, 100);
  map.firePtr('pointermove', 1, 300, 300);
  eq('one-finger movement does nothing to the view',
    plane.style.transform, 'perspective(1100px) rotateX(45deg) rotate(-40deg)');
  map.firePtr('pointerup', 1);

  console.log('— pins —');
  ok('planeTransform threads viewRot + viewPitch',
    navSrc.indexOf('S.viewRot') >= 0 && navSrc.indexOf('S.viewPitch') >= 0 &&
    /rotateX\(' \+ pitch/.test(navSrc));
  ok('the gestures attach in startDrive + detach in exitDrive',
    navSrc.indexOf('attachDriveGestures()') >= 0 && navSrc.indexOf('detachDriveGestures()') >= 0);
  ok('gesture handlers are passive observers', (navSrc.match(/passive: true/g) || []).length >= 4);
  ok('still exactly ONE .style.transform writer (paintPlane)',
    (navSrc.match(/\.style\.transform =/g) || []).length === 1);
  eq('webVersion is 210', ver.webVersion, 252);
  ok('index.html pins the v210 build', idxSrc.indexOf('?v=252') >= 0 && idxSrc.indexOf('?v=' + '209') < 0);

  console.log('\nnav-gestures-v210 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR ' + (e && e.stack || e)); process.exit(1); });
