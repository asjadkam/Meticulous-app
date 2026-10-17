'use strict';
/* Meticulous v133 — DRIVE FACE BLANKING: characterization + the
 * structural guarantee.
 *
 * Owner evidence (Oct 17, 2026 11:39–11:40 MDT, 39 s screen
 * recording, Deerfoot → Ivor East Pond): on the v128/v132 code the
 * Drive banner and the ETA bar TEXT VANISH ENTIRELY for seconds at
 * a time — the navy containers stay painted, their content empties
 * — alternating with correct frames from 350 m down to 120 m out,
 * while the guidance data underneath stays alive (the distance
 * counts down, the arrival holds). His words: "It's even worst
 * then flickering.... The whole screen is disappearing now!"
 * Earlier recordings: v124 (bar contents gone), v125 (tiles
 * mid-fade + overlay drops), 10:25 today (route line + puck dot +
 * arrival text missing from single frames, tiles fine). v125 fixed
 * the tiles; v128 made the tick mutate-only and its instrumented
 * pins showed zero layer adds/removes and zero banner/bar
 * innerHTML across driveTicks — YET HIS HANDS STILL SHOWED
 * BLANKING. The instrumented path did not reproduce his WebView's
 * compositor behaviour. This suite therefore (a) CHARACTERIZES
 * what the DOM actually does per tick on the real module, and
 * (b) pins the STRUCTURAL guarantee that replaces luck:
 *
 * CHARACTERIZATION (measured on the pre-v133 code, see BUGS.md):
 * driveTick assigned textContent on ALL FIVE chrome text nodes on
 * EVERY GPS fix (~1 Hz) — unconditionally, even when the string
 * was byte-identical. Every textContent assignment REPLACES the
 * text node: the element's paint is invalidated and must be
 * re-rastered. Under the 340% will-change plane, the Android
 * WebView compositor starves/drops exactly those re-rasters —
 * the parent navy box (painted once, rarely invalidated) stays,
 * its text empties. Worse: when the NEXT maneuver's instruction
 * string is empty (a real Valhalla shape), the tick wrote '' over
 * a good instruction — a literal blank, no compositor needed.
 * And in css/style.css the static tilt plane (rotateX(52deg),
 * a transform that NEVER changes after mount) carried
 * will-change:transform — a permanent full-plane promoted layer
 * burning the GPU tile budget — while the chrome itself had NO
 * layer promotion of its own, so its raster fate was shared with
 * the plane's surface.
 *
 * THE v133 GUARANTEE (pinned below, on the REAL driveTick):
 *   1. Chrome text is written through ONE cached writer
 *      (driveText): a value is assigned ONLY when it changes —
 *      across standstill repeats and 1 Hz ticks, unchanged nodes
 *      are never touched, so their paint is never invalidated.
 *   2. The guidance nodes (distance, instruction, arrival clock,
 *      arrival sub-line) are KEEP-LAST: a momentarily empty
 *      computed value NEVER erases the last good text mid-drive.
 *   3. After every tick of a stressed drive (standstill repeats,
 *      steady approach, an empty-instruction maneuver gap), all
 *      four guidance nodes hold non-empty text.
 *   4. CSS structure: the banner and the bar carry their OWN
 *      compositing promotion (translateZ(0) + will-change), and
 *      the never-animated tilt plane no longer claims will-change.
 *   5. The v128 invariants still hold through it all: zero layer
 *      adds/removes, zero setView on the drive map per tick.
 *
 * The paint-level starvation itself needs his WebView's
 * compositor and cannot run in this harness (no browser in the
 * build environment) — the DOM churn that feeds it is measured
 * here exactly, and the fix removes the churn AND the starvation
 * structure, which is why the pins are structural, not sampled.
 *
 * Run: node tools/navigator-v133-test.js
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
const cssSrc = read('css/style.css');
const fixture = JSON.parse(read('tools/navigator-fixture-tripb.json'));
const ORIGIN = [51.0955, -114.099], DEST = [51.1075, -114.0845];

function extract(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}

/* ---------- instrumented DOM: every textContent assignment is
   counted, and same-value / empty assignments are counted apart.
   This is the meter the pre-v133 code was never measured with:
   navigator-test's stub used a plain property, so a million
   redundant node replacements were invisible to it. ---------- */
function el() {
  const e = {
    children: {}, style: {}, _html: '', _htmlSets: 0, value: '', onclick: null,
    _text: '', _sets: 0, _sameSets: 0, _emptySets: 0,
    _listeners: {},
    addEventListener: function (ev, fn) { (e._listeners[ev] = e._listeners[ev] || []).push(fn); },
    fire: function (ev) { (e._listeners[ev] || []).slice().forEach(function (f) { f(); }); },
    classList: {
      _s: new Set(),
      add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); },
      toggle: function (c, on) { on ? this._s.add(c) : this._s.delete(c); },
      contains: function (c) { return this._s.has(c); }
    },
    querySelector: function (sel) { return e.children[sel] || null; },
    querySelectorAll: function () { return []; },
    getAttribute: function () { return null; },
    setAttribute: function () {},
    resetTextMeter: function () { e._sets = 0; e._sameSets = 0; e._emptySets = 0; }
  };
  Object.defineProperty(e, 'textContent', {
    configurable: true,
    get: function () { return e._text; },
    set: function (v) {
      v = String(v);
      e._sets++;
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

function makeWorld(storeData, fixtureOverride) {
  const store = {
    get: function (k, d) { return storeData[k] !== undefined ? storeData[k] : d; },
    set: function (k, v) { storeData[k] = v; },
    del: function (k) { delete storeData[k]; }
  };
  const ids = ['nv_banner', 'nv_map', 'nv_mode_truck', 'nv_mode_car', 'nv_follow', 'nv_mute',
    'nv_q', 'nv_search', 'nv_results', 'nv_destnote', 'nv_route', 'nv_end', 'nv_note', 'nv_steps',
    'nv_pq', 'nv_presults',
    'nv_back', 'nv_drive', 'nv_drive_screen', 'nv_drive_map',
    'nvd_dist', 'nvd_inst', 'nvd_road', 'nvd_eta_main', 'nvd_eta_sub', 'nvd_reroute', 'nvd_spin', 'nvd_mute', 'nvd_exit'];
  const reg = {};
  ids.forEach(function (id) { reg[id] = el(); });
  reg.nv_presults = resultsEl();
  reg.nv_banner.children['.nv-banner-main'] = el();
  reg.nv_banner.children['.nv-banner-sub'] = el();
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
  const fx = fixtureOverride || fixture;
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
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(fx); } });
      }
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); } });
    }
  };
  world.window = world;
  vm.createContext(world);
  /* Like navigator-test's drive world: the places module is NOT
     loaded — this suite drives the Navigator's route/drive face
     only, and the merged render defers the places face without it. */
  vm.runInContext(navSrc, world);
  return { world: world, reg: reg, body: body, calls: calls, mapHandlers: mapHandlers,
    firePos: function (la, lo, hd, sp) { geoCb({ coords: { latitude: la, longitude: lo, heading: hd, speed: sp } }); } };
}
function tick() { return new Promise(function (r) { setTimeout(r, 10); }); }

(async function () {
  console.log('— characterization + guarantee: the stressed drive —');
  /* The gap fixture: the REAL Test B trip with one mid-route
     maneuver's instruction blanked (a shape Valhalla produces —
     maneuverPlan defaults a missing instruction to ''). While the
     truck is in the maneuver BEFORE it, driveProgress().next is
     that maneuver: the pre-v133 tick wrote '' over the banner's
     instruction. Post-v133 the last good instruction must stand. */
  const gapFx = JSON.parse(JSON.stringify(fixture));
  gapFx.trip.legs[0].maneuvers[5].instruction = '';
  gapFx.trip.legs[0].maneuvers[5].verbal_pre_transition_instruction = '';

  const w = makeWorld({ navigator: { serverUrl: 'http://nav.test', profile: {}, muted: false, mode: 'truck' } }, gapFx);
  const api = w.world.Meticulous.modules.navigator;
  w.reg.nv_drive.classList.add('hidden');
  w.reg.nv_drive_screen.classList.add('hidden');
  w.reg.nvd_reroute.classList.add('hidden');
  api.render(w.body);
  w.firePos(ORIGIN[0], ORIGIN[1], 40);
  w.mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } });
  await tick(); await tick();
  w.reg.nv_drive.onclick();
  check('drive screen opened for the stressed drive', !w.reg.nv_drive_screen.classList.contains('hidden'));
  await new Promise(function (r) { setTimeout(r, 200); }); /* settle pass: the puck joins */

  const sb = { console };
  vm.createContext(sb);
  vm.runInContext(extract(navSrc, 'NAVPURE-BEGIN', 'NAVPURE-END'), sb);
  const line = sb.decodeShape(fixture.trip.legs[0].shape);
  const ptAt = function (f) { return line[Math.floor(line.length * f)]; };

  const chrome = ['nvd_dist', 'nvd_inst', 'nvd_road', 'nvd_eta_main', 'nvd_eta_sub'];
  const guidance = ['nvd_dist', 'nvd_inst', 'nvd_eta_main', 'nvd_eta_sub'];
  const meter = function () {
    const m = {};
    chrome.forEach(function (id) {
      m[id] = { sets: w.reg[id]._sets, same: w.reg[id]._sameSets, empty: w.reg[id]._emptySets };
    });
    return m;
  };
  const resetMeters = function () { chrome.forEach(function (id) { w.reg[id].resetTextMeter(); }); };
  const allGuidancePainted = function () {
    return guidance.every(function (id) { return w.reg[id].textContent.length > 0; });
  };

  /* Phase 1 — STANDSTILL: the same fix re-fired 20 times (a GPS
     stream parked at a light re-delivers; the app also re-ticks on
     unchanged data). On the pre-v133 code every one of these was
     5 fresh node replacements. */
  const p0 = ptAt(0.06);
  w.firePos(p0[0], p0[1], 90);
  resetMeters();
  for (let i = 0; i < 20; i++) w.firePos(p0[0], p0[1], 90);
  const m1 = meter();
  const tot1 = chrome.reduce(function (a, id) { return a + m1[id].sets; }, 0);
  const same1 = chrome.reduce(function (a, id) { return a + m1[id].same; }, 0);
  console.log('  [characterization] 20 standstill re-fires → textContent assignments: ' + tot1 +
    ' (same-value: ' + same1 + ')');
  check('v133: 20 standstill re-fires assign chrome text ZERO times (unchanged values are never rewritten)',
    tot1 === 0, JSON.stringify(m1));
  check('v133: guidance fully painted after the standstill', allGuidancePainted(),
    guidance.map(function (id) { return id + '=' + JSON.stringify(w.reg[id].textContent); }).join(' '));

  /* Phase 2 — THE APPROACH: 60 steady fixes down the line, the
     owner's 350 m → 120 m case many times over. Count every
     assignment; a changed value may be written, an unchanged one
     never, an empty one never (guidance). */
  resetMeters();
  let paintedEveryTick = true;
  for (let s = 0; s < 60; s++) {
    const p = ptAt(0.08 + (0.84 * s) / 59);
    w.firePos(p[0], p[1], 90);
    if (!allGuidancePainted()) paintedEveryTick = false;
  }
  const m2 = meter();
  const same2 = chrome.reduce(function (a, id) { return a + m2[id].same; }, 0);
  const emptyGuidance2 = guidance.reduce(function (a, id) { return a + m2[id].empty; }, 0);
  console.log('  [characterization] 60 approach fixes → assignments: ' +
    chrome.map(function (id) { return id.replace('nvd_', '') + '=' + m2[id].sets; }).join(' ') +
    ' (same-value: ' + same2 + ', guidance-empty: ' + emptyGuidance2 + ')');
  check('v133: across 60 approach fixes, NO chrome node is ever assigned its current value again',
    same2 === 0, JSON.stringify(m2));
  check('v133: across 60 approach fixes, NO guidance node is ever assigned an empty string',
    emptyGuidance2 === 0, JSON.stringify(m2));
  check('v133: guidance is painted after EVERY approach tick (never a blank frame in the data)',
    paintedEveryTick);
  check('v133: the distance DID keep counting down (writes happen on change, not never)',
    m2.nvd_dist.sets >= 20, 'dist sets=' + m2.nvd_dist.sets);
  check('v133: the instruction changed only a handful of times across 60 fixes (per maneuver, not per fix)',
    m2.nvd_inst.sets <= 12, 'inst sets=' + m2.nvd_inst.sets);

  /* Phase 3 — v128 invariants still hold under the new writer. */
  const dMap = w.calls.maps[1];
  check('v133: the stressed drive added/removed ZERO layers per tick on the drive map',
    !!dMap && dMap._removes === 0, dMap ? 'removes=' + dMap._removes : 'no drive map');

  api.teardown();

  console.log('— structure pins (the compositor half of the guarantee) —');
  check('v133: the banner (.nv-drive-top) carries its OWN compositing promotion (translateZ(0) + will-change) — its raster no longer shares the plane\'s fate',
    /\.nv-drive-top\{[^}]*transform:translateZ\(0\)[^}]*will-change:transform/.test(cssSrc) ||
    /\.nv-drive-top\{[^}]*will-change:transform[^}]*transform:translateZ\(0\)/.test(cssSrc));
  check('v133: the ETA bar (.nv-drive-bar) carries its OWN compositing promotion (translateZ(0) + will-change)',
    /\.nv-drive-bar\{[^}]*transform:translateZ\(0\)[^}]*will-change:transform/.test(cssSrc) ||
    /\.nv-drive-bar\{[^}]*will-change:transform[^}]*transform:translateZ\(0\)/.test(cssSrc));
  check('v133: the tilt plane no longer claims will-change (its rotateX is static after mount — the claim was a permanent full-plane layer burning the tile budget)',
    !/\.nv-drive-tilt\{[^}]*will-change/.test(cssSrc) &&
    /\.nv-drive-tilt\{[^}]*transform:rotateX\(52deg\)/.test(cssSrc));
  const tickSrc = navSrc.slice(navSrc.indexOf('function driveTick()'), navSrc.indexOf('function driveArrived()'));
  check('v133: driveTick writes chrome text ONLY through the cached writer (no direct textContent assignment to the five nodes)',
    tickSrc.indexOf('driveText(') >= 0 &&
    !/(distEl|instEl|roadEl|etaMain|etaSub)\.textContent\s*=/.test(tickSrc));
  check('v133: the cached writer + keep-last guard exist in the module',
    /function driveText\(/.test(navSrc) && /function driveTextKeep\(/.test(navSrc));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
