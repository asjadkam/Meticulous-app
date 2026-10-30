'use strict';
/* v286 SIS + TIMER — reproduction-first suite for the owner's
 * Oct 30, 2026 in-hands verdicts (TWO named items, one root):
 *
 *   ITEM 2 — PIP-HOME (SIS), verdict FAILED on v60 (Oct 30 07:40
 *   MDT, his video): driving with the Navigator active to Simply
 *   Stone BEFORE his 8:00 AM session started (dashboard frames in
 *   the clip: "Ready to work" 00:00:00, live miles counting), he
 *   pressed Back from navigation and landed on the plain
 *   dashboard — NO floating face, no screen-in-screen. The v227
 *   park floats the TRACKER face, and the shell raises that face
 *   only while a session is live (refreshBubbleFace gates on
 *   sessionActive) — a driver navigating before his session (or
 *   after it) parks into nothing: the drive screen hides in the
 *   dock and no float exists to tap back into it.
 *   This suite runs the REAL module back()/parkDrive with the
 *   REAL app.js bubble block in TWO worlds:
 *     A (no session): Back must float the drive screen itself as
 *        the compact mini map (his Oct 30 spec: map visible,
 *        compact, no mic, tap returns to full navigation) —
 *        RED on the shipped tree (screen parks hidden, no float).
 *     B (session running): the v227 law must stand untouched —
 *        tracker face floats, drive screen survives hidden.
 *
 *   ITEM 1 root-mate — TIMER-DISPLAY-FROZEN (Oct 30 10:34 MDT):
 *   the dashboard hero advanced ~3 s in ~3 min while the session
 *   counted underneath ("Screen not held — the app may sleep").
 *   The hero's only paint driver is a 1 s setInterval — exactly
 *   the continuation Chromium freezes/throttles when the OS puts
 *   the page to sleep. Part C drives the HERO-PAINT seam: while
 *   the dashboard is visible and a session is live, animation
 *   frames (which exist only when the page is actually being
 *   rendered) re-paint the hero on a bounded cadence, and a
 *   return-to-visibility kick paints the true time at once.
 *   RED on the shipped tree (no such seam exists).
 *
 *   Part D — release coherence + the native widget chain: the
 *   widget's minute repaint must ride the EXACT alarm tier (the
 *   DayScheduler ladder), not setAndAllowWhileIdle alone — under
 *   Doze the inexact tier is deferred, which is the WIDGET-FREEZE
 *   half of this same root (v59/v279 verdicts FAILED twice).
 *
 * Run: node tools/sis-timer-v286-test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const NAT = path.resolve(ROOT, '..', 'meticulous-native');
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function readNat(p) { return fs.readFileSync(path.join(NAT, p), 'utf8'); }

const navSrc = read('modules/navigator.js');
const navModSrc = read('modules/navigation.js');
const appSrc = read('js/app.js');
const stSrc = read('js/shifttrack.js');
const fixture = JSON.parse(read('tools/navigator-fixture-tripb.json'));
const ORIGIN = [51.0955, -114.099], DEST = [51.1075, -114.0845];

/* ---------- stub DOM (drive-surface-v227 pattern) ---------- */
function el(id) {
  const e = {
    id: id || '', children: {}, style: {}, _html: '', textContent: '', value: '', onclick: null,
    _listeners: {}, _kids: [], _parent: null,
    addEventListener: function (ev, fn) { (e._listeners[ev] = e._listeners[ev] || []).push(fn); },
    removeEventListener: function (ev, fn) {
      const l = e._listeners[ev] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
    },
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
  const sessionLive = !!opts.sessionLive;
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
  const bodyEl = el('body');
  bodyEl.appendChild = function () {};

  const calls = { fetch: [], polylines: [], spoken: [], views: [], maps: [], groups: [], showDashboard: 0, opened: [] };
  const mapHandlers = {};
  function makeMapStub() {
    const m = {
      _adds: 0, _removes: 0, _views: [], _panTos: [], _center: null, _zoom: 15, _invalidated: 0,
      setView: function (c, z) { m._views.push([c, z]); m._center = (c && c.lat !== undefined) ? [c.lat, c.lng] : c; if (z) m._zoom = z; return m; },
      panTo: function (c) { const cc = (c && c.lat !== undefined) ? [c.lat, c.lng] : c; m._panTos.push(cc); m._center = cc; return m; },
      setZoomAround: function () {},
      getCenter: function () { return m._center ? { lat: m._center[0], lng: m._center[1] } : null; },
      getZoom: function () { return m._zoom; },
      on: function (ev, fn) { mapHandlers[ev] = fn; },
      addLayer: function () { m._adds++; return m; },
      removeLayer: function () { m._removes++; return m; },
      remove: function () {}, fitBounds: function () {}, invalidateSize: function () { m._invalidated++; }
    };
    return m;
  }
  const L = {
    map: function () { const m = makeMapStub(); calls.maps.push(m); return m; },
    tileLayer: function () { const tl = { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return tl; }, on: function () { return tl; }, setUrl: function () {}, redraw: function () {} }; return tl; },
    marker: function () { return { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return this; }, setLatLng: function () {} }; },
    circleMarker: function () { const cm = { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return cm; }, setLatLng: function () {} }; return cm; },
    polyline: function (pts) { calls.polylines.push(pts); const pl = { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return pl; }, setLatLngs: function () {}, getBounds: function () { return {}; } }; return pl; },
    layerGroup: function (kids) { const g = { _kids: kids, getLayers: function () { return g._kids.slice(); }, addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return g; } }; calls.groups.push(g); return g; }
  };
  let geoCb = null;
  const listeners = {};
  const pluginStub = {
    start: function () { return Promise.resolve({ started: true }); },
    stop: function () { return Promise.resolve({ stopped: true }); },
    status: function () { return Promise.resolve({ available: true, sessionActive: false }); },
    readCrumbs: function () { return Promise.resolve({ crumbs: [], more: false }); },
    ack: function () { return Promise.resolve({ deleted: 0 }); },
    setDriving: function () { return Promise.resolve({}); },
    setSession: function () { return Promise.resolve({}); },
    enterPip: function () { return Promise.resolve({ ok: true }); },
    addListener: function (name, fn) { (listeners[name] = listeners[name] || []).push(fn); return Promise.resolve({}); }
  };
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
      body: bodyEl
    },
    App: {
      _esc: function (s) { return String(s == null ? '' : s); }, _store: store,
      _today: function () { return '2026-10-30'; },
      openModule: function (k) { calls.opened.push(k); },
      showDashboard: function () { calls.showDashboard++; },
      tracker: { status: sessionLive ? 'running' : 'idle' },
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
    },
    /* leaf stubs for the real app.js bubble block */
    sessionActive: function () { return sessionLive; },
    trackerElapsedSec: function () { return 3725; },
    fmtClock: function (sec) { sec = Math.floor(sec); var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2); },
    loadsGlance: function () { return '🚛 3 loads'; }
  };
  world.window = world;
  world.Capacitor = { Plugins: { ShiftTrack: pluginStub } };
  vm.createContext(world);
  vm.runInContext(stSrc, world);
  vm.runInContext(navModSrc, world);
  vm.runInContext(navSrc, world);
  /* the REAL app.js bubble-face block joins the world */
  const bubStart = appSrc.indexOf('App._bubble = false;');
  if (bubStart >= 0) {
    const bubBlock = appSrc.slice(bubStart, appSrc.indexOf('/* v220 (WIDGET-CONTROLS)', bubStart));
    vm.runInContext(bubBlock, world);
  }
  return {
    world: world, reg: reg, body: body, calls: calls,
    firePos: function (la, lo, hd, sp) { if (geoCb) geoCb({ coords: { latitude: la, longitude: lo, heading: hd, speed: sp }, timestamp: Date.now() }); }
  };
}
function tick() { return new Promise(function (r) { setTimeout(r, 15); }); }

(async function () {
  /* ================= Part A — PIP-HOME, NO session (the Oct 30 repro) ================= */
  console.log('— A: PIP-HOME Oct 30 — Back from navigation with NO session running —');
  {
    const w = makeWorld({ sessionLive: false, storeData: {
      navigator: { profile: {}, muted: true, mode: 'truck' },
      nav_pending: { lat: DEST[0], lng: DEST[1], name: 'Simply Stone' }
    } });
    const api = w.world.Meticulous.modules.navigator;
    api.render(w.body);
    w.firePos(ORIGIN[0], ORIGIN[1], 45, 8);
    await tick(); await tick();
    if (w.reg.nv_drive.onclick) w.reg.nv_drive.onclick();
    await tick();
    const handled = api.back();
    check('A1: Back on the map page is handled by the module', handled === true);
    check('A2: the driver lands on the MAIN DASHBOARD', w.calls.showDashboard >= 1, 'showDashboard=' + w.calls.showDashboard);
    check('A3: the drive screen is IN the shell dock', w.reg.nv_drive_screen._parent === w.reg.pipDock);
    check('A4: a float EXISTS — the drive screen floats as the compact mini map (nv-mini, visible)',
      w.reg.nv_drive_screen.classList.contains('nv-mini') &&
      !w.reg.nv_drive_screen.classList.contains('hidden') &&
      !w.reg.nv_drive_screen.classList.contains('nv-parked'));
    check('A5: the mini wears the compact PiP posture (chrome trimmed, mic off the face)',
      w.reg.nv_drive_screen.classList.contains('nv-pip'));
    check('A6: exactly ONE float — the tracker face stays down (no session facts to show)',
      w.reg.bubbleFace.classList.contains('hidden'));
    check('A7: navigation is NOT ended by the park (drive alive underneath)',
      api.keepAlive() === true);
    /* tap the bubble -> full navigation restored */
    w.reg.nv_drive_screen.fire('click', {});
    check('A8: tapping the mini asks the shell to reopen the Navigator',
      w.calls.opened.indexOf('navigator') >= 0, 'opened=' + JSON.stringify(w.calls.opened));
    /* the shell reopens the module: render() restores the parked drive full-screen */
    const w2body = w.body;
    api.render(w2body);
    await tick();
    check('A9: restore re-homes the drive screen full-screen (mini posture gone)',
      !w.reg.nv_drive_screen.classList.contains('nv-mini') &&
      !w.reg.nv_drive_screen.classList.contains('hidden') &&
      w.reg.nv_drive_screen._parent === w2body);
    check('A10: after restore the drive is no longer parked', api.keepAlive() === false);
    try { api.teardown(); } catch (e) {}
  }

  /* ================= Part B — PIP-HOME with a session (v227 law stands) ================= */
  console.log('— B: PIP-HOME with a session running — v227 tracker-face law unchanged —');
  {
    const w = makeWorld({ sessionLive: true, storeData: {
      navigator: { profile: {}, muted: true, mode: 'truck' },
      nav_pending: { lat: DEST[0], lng: DEST[1], name: 'Simply Stone' }
    } });
    const api = w.world.Meticulous.modules.navigator;
    api.render(w.body);
    w.firePos(ORIGIN[0], ORIGIN[1], 45, 8);
    await tick(); await tick();
    if (w.reg.nv_drive.onclick) w.reg.nv_drive.onclick();
    await tick();
    const handled = api.back();
    check('B1: Back on the map page is handled by the module', handled === true);
    check('B2: the driver lands on the MAIN DASHBOARD', w.calls.showDashboard >= 1, 'showDashboard=' + w.calls.showDashboard);
    check('B3: with a session, the drive screen survives HIDDEN in the dock (not a mini map)',
      !w.reg.nv_drive_screen.classList.contains('nv-mini') &&
      w.reg.nv_drive_screen.classList.contains('nv-parked') &&
      w.reg.nv_drive_screen.classList.contains('hidden'));
    check('B4: the TRACKER bubble face is the floated piece — visible over the dashboard',
      !w.reg.bubbleFace.classList.contains('hidden'));
    check('B5: the docked face wears the dock posture', w.reg.bubbleFace.classList.contains('bub-dock'));
    check('B6: navigation is NOT ended by the dock (the drive is parked alive)',
      api.keepAlive() === true);
    check('B7: the bubble face shows the tracker facts (clock + loads painted)',
      w.reg.bubClock.textContent === '01:02:05' && /3 loads/.test(w.reg.bubLoads.textContent),
      'clock=' + w.reg.bubClock.textContent + ' loads=' + w.reg.bubLoads.textContent);
    try { api.teardown(); } catch (e) {}
  }

  /* ================= Part C — TIMER-DISPLAY-FROZEN: the hero paint seam ================= */
  console.log('— C: TIMER-DISPLAY-FROZEN — hero paint rides animation frames + a visibility kick —');
  {
    const b0 = appSrc.indexOf('/* HERO-PAINT-BEGIN');
    const b1 = appSrc.indexOf('/* HERO-PAINT-END */');
    check('C0: the HERO-PAINT block exists in js/app.js', b0 >= 0 && b1 > b0);
    if (b0 >= 0 && b1 > b0) {
      const block = appSrc.slice(b0, b1 + '/* HERO-PAINT-END */'.length);
      const worldC = { App: {}, console: console };
      vm.createContext(worldC);
      vm.runInContext(block, worldC);
      check('C1: App.heroPaint is a function', typeof worldC.App.heroPaint === 'function');
      if (typeof worldC.App.heroPaint === 'function') {
        let now = 0, visible = true, dash = true, live = true, ticks = 0;
        let queue = [];
        const env = {
          raf: function (cb) { queue.push(cb); return queue.length; },
          caf: function () { queue = []; },
          now: function () { return now; },
          visible: function () { return visible; },
          dashShown: function () { return dash; },
          live: function () { return live; },
          tick: function () { ticks++; }
        };
        function pump(t) { now = t; const q = queue; queue = []; q.forEach(function (cb) { cb(t); }); }
        const d = worldC.App.heroPaint(env);
        d.start();
        pump(0);
        check('C2: first frame paints at once', ticks === 1, 'ticks=' + ticks);
        pump(100);
        check('C3: frames inside the cadence do not repaint (bounded cost)', ticks === 1, 'ticks=' + ticks);
        pump(250);
        check('C4: the next cadence frame repaints (the seconds stay honest)', ticks === 2, 'ticks=' + ticks);
        visible = false; pump(500); pump(750);
        check('C5: while the page is not visible, frames do not paint', ticks === 2, 'ticks=' + ticks);
        visible = true; d.kick();
        check('C6: a return to visibility paints the true time IMMEDIATELY (the kick)', ticks === 3, 'ticks=' + ticks);
        live = false; pump(1000); d.kick();
        check('C7: no session live -> no hero painting from this driver', ticks === 3, 'ticks=' + ticks);
        live = true; dash = false; pump(1250);
        check('C8: dashboard not on screen -> frames do not paint the hero', ticks === 3, 'ticks=' + ticks);
        dash = true; pump(1500);
        check('C9: back on the dashboard, frames paint again', ticks === 4, 'ticks=' + ticks);
        d.stop(); const before = ticks; pump(2000);
        check('C10: a stopped driver stays stopped', ticks === before, 'ticks=' + ticks);
      }
      /* the init glue: rAF driver + return-to-visibility kicks are wired in app.js */
      check('C11: init wires the driver (heroPaint( call in js/app.js)', /heroPaint\(\{/.test(appSrc));
      check('C12: init kicks the paint on visibility return / pageshow / focus',
        /visibilitychange/.test(appSrc) && /pageshow/.test(appSrc) && /\.kick\(\)/.test(appSrc));
    }
  }

  /* ================= Part D — release coherence + native chain tier ================= */
  console.log('— D: pins, native counters, and the widget repaint chain tier —');
  {
    const vj = JSON.parse(read('version.json'));
    const idx = read('index.html');
    function pinOf(file) {
      const m = idx.match(new RegExp(file.replace(/\./g, '\\.') + '\\?v=(\\d+)'));
      return m ? parseInt(m[1], 10) : null;
    }
    check('D1: index.html js/app.js pin == webVersion', pinOf('js/app.js') === vj.webVersion,
      'pin=' + pinOf('js/app.js') + ' webVersion=' + vj.webVersion);
    check('D2: index.html modules/navigator.js pin == webVersion', pinOf('modules/navigator.js') === vj.webVersion,
      'pin=' + pinOf('modules/navigator.js') + ' webVersion=' + vj.webVersion);
    const css = read('css/style.css');
    check('D3: the compact mini posture exists in css/style.css (tappable float)',
      /\.nv-drive\.nv-mini\{[^}]*pointer-events:auto/.test(css));
    const apkM = appSrc.match(/var APK_VERSION = (\d+);/);
    check('D4: version.json native counter == APK_VERSION in js/app.js',
      !!apkM && parseInt(apkM[1], 10) === vj.version,
      'APK_VERSION=' + (apkM && apkM[1]) + ' version=' + vj.version);
    const tw = readNat('android/app/src/main/java/com/meticuloustechnologies/app/TrackerWidget.java');
    const ds = readNat('android/app/src/main/java/com/meticuloustechnologies/app/DayScheduler.java');
    check('D5: the widget repaint chain rides the EXACT alarm ladder (not inexact alone)',
      /scheduleChainAlarm/.test(tw) || /setExactAndAllowWhileIdle/.test(tw));
    check('D6: DayScheduler exposes the shared chain ladder for the widget',
      /scheduleChainAlarm/.test(ds));
    check('D7: the chain ladder keeps an inexact LAST-RESORT fallback',
      /scheduleChainAlarm[\s\S]{0,1600}setAndAllowWhileIdle/.test(ds));
    const gradle = readNat('android/app/build.gradle');
    const vc = gradle.match(/versionCode\s+(\d+)/);
    check('D8: native versionCode bumped past v60 (35)', !!vc && parseInt(vc[1], 10) > 35,
      'versionCode=' + (vc && vc[1]));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('SUITE ERROR', e); process.exit(2); });
