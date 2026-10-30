'use strict';
/* v287 REWORK — reproduction-first suite for the owner's Oct 30,
 * 2026 13:31 MDT in-hands verdict on v61 / web 286: "Neither fixed
 * and it messed up my Live km's while reinstall! Not fixed but
 * worst!" Three named items:
 *
 *   ITEM 1 — REINSTALL-LIVE-KM. Reinstalling mid-shift broke the
 *   live km counter on the running day. Code audit (run record
 *   widget-sis-fix-oct30.md + rework notes) found:
 *     D1: ShiftTrack.sessionStarted is called ONLY from the two
 *         start flows (js/app.js) — never from a restore path.
 *         After a reinstall the native foreground service + the
 *         45 s crumb-drain loop are never re-armed for the
 *         restored session, so background miles stop recording.
 *     D3: LiveMiles.startDay adopts same-day fragments ONLY when
 *         no saved session record exists (if (!saved)) — miles
 *         counted into the day-watch fragment during the reinstall
 *         window are orphaned when the cloud-restored session
 *         record exists.
 *     D2: a reinstall resets the location grant; the geo error
 *         latches LiveMiles broken (the miles line hides) and the
 *         shifttrack banner's Allow flow never re-pokes the miles
 *         watcher after the grant lands.
 *   Part 1 drives the REAL js/shifttrack.js and js/miles.js.
 *
 *   ITEM 2 — WIDGET-FREEZE (v61 failed in his hands). The widget's
 *   repaint chain degrades silently to inexact alarms when the
 *   exact-alarm grant is absent (a fresh install resets it), and
 *   the widget's miles text comes ONLY from the web-pushed
 *   'widget_state' string — the native session record carries no
 *   miles, so a sleeping/dead page freezes the miles even when a
 *   repaint fires. Part 2 pins the native sources: a Doze-immune
 *   repaint driver inside the recording service, and miles carried
 *   on the session record itself, composed by the widget.
 *
 *   ITEM 3 — PIP-HOME (v61 failed in his hands). The v286 suite
 *   called the module's back() directly with a mocked shell. This
 *   suite drives the FULL chain — the REAL SYS-BACK block, the
 *   REAL teardownModule/showDashboard/moduleBack/openModule slice
 *   and the REAL bubble block from js/app.js, the REAL navigator
 *   module — including the home-bound fallthrough (Part C): any
 *   shell path that heads home with a live, unparked drive must
 *   PARK it (a float appears, navigation survives), never tear it
 *   down. RED on the v61/286 tree: showDashboard tears the module
 *   down and no float exists.
 *
 * Run: node tools/rework-v287-test.js
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
function tick() { return new Promise(function (r) { setTimeout(r, 15); }); }

const appSrc = read('js/app.js');
const stSrc = read('js/shifttrack.js');
const milesSrc = read('js/miles.js');
const navSrc = read('modules/navigator.js');
const navModSrc = read('modules/navigation.js');

/* ================= shared stubs ================= */
function makeLocal() {
  const mem = {};
  return { getItem: k => (k in mem) ? mem[k] : null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
}
function makeStore(data) {
  return {
    get: function (k, d) { return data[k] !== undefined ? data[k] : d; },
    set: function (k, v) { data[k] = v; },
    del: function (k) { delete data[k]; }
  };
}

/* ================= Part 1A — D1: restore never re-arms the native session ================= */
async function part1A() {
  console.log('— 1A: REINSTALL-LIVE-KM / D1 — a restored session must re-arm the native service + drain —');
  const T0 = Date.UTC(2026, 9, 30, 14, 0, 0); // 8:00 AM MDT
  const storeData = {
    tracker: { status: 'running', startMs: T0, date: '2026-10-30' },
    settings: {}
  };
  const pluginCalls = { start: [], readCrumbs: 0, setSession: [] };
  const listeners = {};
  const plugin = {
    start: function (o) { pluginCalls.start.push(o); return Promise.resolve({ started: true }); },
    stop: function () { return Promise.resolve({ stopped: true }); },
    status: function () { return Promise.resolve({ available: true, sessionActive: false, recording: false }); },
    readCrumbs: function () { pluginCalls.readCrumbs++; return Promise.resolve({ crumbs: [], more: false }); },
    ack: function () { return Promise.resolve({ deleted: 0 }); },
    setDriving: function () { return Promise.resolve({}); },
    setSession: function (o) { pluginCalls.setSession.push(o); return Promise.resolve({}); },
    requestPermissions: function () { return Promise.resolve({ background: true }); },
    sessionSync: function () { return Promise.resolve({}); },
    sessionState: function () { return Promise.resolve({ found: false }); },
    addListener: function (name, fn) { (listeners[name] = listeners[name] || []).push(fn); return Promise.resolve({}); }
  };
  const world = {
    console: console, JSON: JSON, Math: Math, Date: Date,
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval,
    localStorage: makeLocal(),
    document: { addEventListener: function () {}, hidden: false, visibilityState: 'visible' },
    navigator: {},
    App: {
      _store: makeStore(storeData),
      _today: function () { return '2026-10-30'; },
      liveSessionKey: function () { const t = storeData.tracker; return (t && t.status && t.status !== 'idle' && t.startMs) ? 's' + t.startMs : null; }
    }
  };
  world.window = world;
  world.Capacitor = { Plugins: { ShiftTrack: plugin } };
  vm.createContext(world);
  vm.runInContext(stSrc, world);
  const ST = world.ShiftTrack;
  check('1A0: ShiftTrack loaded', !!ST);
  /* the restore moment: the page (re)loads with a live tracker in
     the store — exactly what load()/syncOnBoot see after a reinstall */
  try { ST.load(); } catch (e) {}
  await tick();
  check('1A1: a restore-rearm API exists (ShiftTrack.sessionRestored)',
    typeof (ST && ST.sessionRestored) === 'function');
  if (ST && typeof ST.sessionRestored === 'function') {
    pluginCalls.start.length = 0; pluginCalls.readCrumbs = 0;
    ST.sessionRestored('s' + T0);
    await tick(); await tick();
    check('1A2: the rearm starts the native service for the restored key',
      pluginCalls.start.some(function (o) { return o && o.sessionKey === 's' + T0; }),
      'start calls=' + JSON.stringify(pluginCalls.start));
    check('1A3: the rearm engages the crumb drain (readCrumbs runs)',
      pluginCalls.readCrumbs >= 1, 'readCrumbs=' + pluginCalls.readCrumbs);
  }
}

/* ================= Part 1B — D3: fragment miles orphaned when the session record exists ================= */
async function part1B() {
  console.log('— 1B: REINSTALL-LIVE-KM / D3 — reinstall-window fragment miles must fold into the restored session —');
  const T0 = Date.UTC(2026, 9, 30, 14, 0, 0);
  const KEY = 's' + T0;
  /* a straight 0.001°-latitude line north: each step ≈ 111.19 m.
     Records use the engine's own persisted shape (snapshot()):
     anchor {time, latitude, longitude}, crumbs {t, a, o}, segs as
     [from, to] coverage intervals. */
  function crumbLine(lat0, n, stepLat, t0, dtMs) {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ t: t0 + i * dtMs, a: lat0 + i * stepLat, o: -114.0 });
    return out;
  }
  /* saved session record: 10 crumbs ≈ 9 steps ≈ 1000 m, ending T0+9 min */
  const savedCrumbs = crumbLine(51.0, 10, 0.001, T0, 60000);
  /* day-watch fragment (armed at fresh boot before sign-in): the
     drive continues — 6 crumbs ≈ 5 steps ≈ 556 m, starting 1 min
     after the saved record's last crumb (inside the join gate) */
  const fragCrumbs = crumbLine(51.009, 6, 0.001, T0 + 10 * 60000, 60000);
  const storeData = {
    livemiles: { days: {} }
  };
  storeData.livemiles.days[KEY] = {
    key: KEY, date: '2026-10-30', totalM: 1000, hasFix: true,
    anchor: { time: T0 + 9 * 60000, latitude: 51.009, longitude: -114.0 },
    crumbs: savedCrumbs, segs: [[T0, T0 + 9 * 60000]], joinFrom: null,
    updatedAt: T0 + 9 * 60000
  };
  storeData.livemiles.days['d2026-10-30'] = {
    key: 'd2026-10-30', date: '2026-10-30', totalM: 556, hasFix: true,
    anchor: { time: T0 + 15 * 60000, latitude: 51.014, longitude: -114.0 },
    crumbs: fragCrumbs, segs: [[T0 + 10 * 60000, T0 + 15 * 60000]], joinFrom: null,
    updatedAt: T0 + 15 * 60000
  };
  let watchStarts = 0;
  const geo = {
    available: function () { return true; },
    start: function () { watchStarts++; return Promise.resolve(true); },
    stop: function () {},
    isWatching: function () { return watchStarts > 0; }
  };
  const world = {
    console: console, JSON: JSON, Math: Math, Date: Date,
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval,
    localStorage: makeLocal(),
    document: { addEventListener: function () {}, hidden: false, visibilityState: 'visible' },
    navigator: {},
    App: { _store: makeStore(storeData), geo: geo, _today: function () { return '2026-10-30'; } }
  };
  world.window = world;
  vm.createContext(world);
  vm.runInContext(milesSrc, world);
  const LM = world.LiveMiles;
  check('1B0: LiveMiles loaded', !!LM);
  const okStart = LM.startDay(KEY, { resume: true });
  await tick();
  check('1B1: startDay reattaches to the restored session', okStart === true);
  const km = LM.recordKmFor(KEY);
  check('1B2: the restored total includes the fragment miles (≈1.56 km, not 1.00 km)',
    km !== null && km >= 1.45 && km <= 1.65, 'recordKmFor=' + km);
  const days = storeData.livemiles.days;
  check('1B3: the fragment record is retired after the fold (no double-count on the next boot)',
    !days['d2026-10-30'] || !days['d2026-10-30'].totalM,
    'fragment=' + JSON.stringify(days['d2026-10-30'] && days['d2026-10-30'].totalM));
}

/* ================= Part 1C — D2: the permission grant must re-poke the miles watcher ================= */
function part1C() {
  console.log('— 1C: REINSTALL-LIVE-KM / D2 — after the location grant lands, the miles watcher is re-poked —');
  const st = stSrc;
  const grantAt = st.indexOf('requestBackground');
  check('1C1: the grant path (banner Allow / requestBackground wrapper, js/shifttrack.js) re-pokes LiveMiles',
    grantAt >= 0 && st.indexOf('LiveMiles.onVisible', grantAt) > grantAt &&
    st.indexOf('LiveMiles.onVisible', grantAt) - grantAt < 4000,
    'poke offset=' + (grantAt >= 0 ? (st.indexOf('LiveMiles.onVisible', grantAt) - grantAt) : 'n/a'));
}

/* ================= Part 2 — WIDGET-FREEZE (native sources) ================= */
function part2() {
  console.log('— 2: WIDGET-FREEZE — Doze-immune repaint driver + miles on the session record —');
  const svc = readNat('android/app/src/main/java/com/meticuloustechnologies/app/ShiftTrackingService.java');
  check('2A: the recording service itself drives widget repaints while recording (no alarm grant needed)',
    /TrackerWidget\.refreshFromRecord/.test(svc) && /(postDelayed|scheduleAtFixedRate|Timer)/.test(svc));
  const rec = readNat('android/app/src/main/java/com/meticuloustechnologies/app/SessionRecord.java');
  check('2B: SessionRecord carries a web-synced miles field',
    /milesM/.test(rec) && /syncFromWeb[\s\S]{0,2400}milesM/.test(rec));
  check('2C: SessionRecord.copy() preserves the miles field',
    /private static Snap copy\(Snap s\) \{[\s\S]{0,1200}milesM/.test(rec));
  const tw = readNat('android/app/src/main/java/com/meticuloustechnologies/app/TrackerWidget.java');
  check('2D: the widget composes its miles from the session record when a session is live',
    /patchGlanceMiles/.test(tw) && /s\.milesM/.test(tw) &&
    /refreshFromRecord[\s\S]{0,3500}patchGlanceMiles/.test(tw));
}

/* ================= Part 3 — PIP-HOME: the FULL shell chain ================= */
function elStub(id) {
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
function resultsEl3() {
  const e = elStub('nv_presults');
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
const fixture = JSON.parse(read('tools/navigator-fixture-tripb.json'));
const ORIGIN = [51.0955, -114.099], DEST = [51.1075, -114.0845];

function makeWorld3(opts) {
  const sessionLive = !!opts.sessionLive;
  const storeData = opts.storeData || {};
  const store = makeStore(storeData);
  const ids = ['nv_banner', 'nv_map', 'nv_mode_truck', 'nv_mode_car', 'nv_follow', 'nv_mute',
    'nv_q', 'nv_search', 'nv_results', 'nv_destnote', 'nv_route', 'nv_end', 'nv_note', 'nv_steps',
    'nv_pq', 'nv_presults', 'nv_back', 'nv_drive', 'nv_drive_screen', 'nv_drive_map',
    'nvd_dist', 'nvd_inst', 'nvd_road', 'nvd_eta_main', 'nvd_eta_sub', 'nvd_reroute', 'nvd_plane',
    'nvd_mute', 'nvd_exit', 'nvd_recenter', 'nvd_you', 'nvd_pip_line', 'nvd_speed', 'nvd_speedwrap',
    'nvd_inset', 'pipDock', 'bubbleFace', 'bubClock', 'bubStatus', 'bubLoads', 'bubPlay', 'bubPlus', 'bubMinus', 'bubStop',
    'dashView', 'modView', 'modTitle', 'sidebar'];
  const reg = {};
  ids.forEach(function (id) { reg[id] = elStub(id); });
  reg.nv_presults = resultsEl3();
  reg.bubbleFace.classList.add('hidden');
  reg.nv_banner.children['.nv-banner-main'] = elStub();
  reg.nv_banner.children['.nv-banner-sub'] = elStub();
  const body = elStub('modBody');
  body.querySelector = function (sel) {
    const id = sel.slice(1);
    return reg[id] || (reg[id] = elStub(id));
  };
  body.querySelectorAll = function () { return []; };
  reg.modBody = body;
  const bodyEl = elStub('body');
  bodyEl.appendChild = function () {};

  const calls = { fetch: [], polylines: [], spoken: [], views: [], maps: [], groups: [], showDashboard: 0, opened: [], buildDashboard: 0, showView: [] };
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
    layerGroup: function (kids) { const g = { _kids: kids, getLayers: function () { return g._kids.slice(); }, addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return m; } }; calls.groups.push(g); return g; }
  };
  let geoCb = null;
  const pluginListeners = {};
  const pluginStub = {
    start: function () { return Promise.resolve({ started: true }); },
    stop: function () { return Promise.resolve({ stopped: true }); },
    status: function () { return Promise.resolve({ available: true, sessionActive: false }); },
    readCrumbs: function () { return Promise.resolve({ crumbs: [], more: false }); },
    ack: function () { return Promise.resolve({ deleted: 0 }); },
    setDriving: function () { return Promise.resolve({}); },
    setSession: function () { return Promise.resolve({}); },
    enterPip: function () { return Promise.resolve({ ok: true }); },
    addListener: function (name, fn) { (pluginListeners[name] = pluginListeners[name] || []).push(fn); return Promise.resolve({}); }
  };
  const backListeners = [];
  const world = {
    console: console, JSON: JSON, Math: Math, Date: Date, setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: setInterval, clearInterval: clearInterval,
    requestAnimationFrame: function (cb) { return setTimeout(function () { cb(Date.now()); }, 5); },
    cancelAnimationFrame: function (id) { clearTimeout(id); },
    window: null, localStorage: makeLocal(),
    history: { length: 1, back: function () {} },
    addEventListener: function () {}, scrollTo: function () {},
    document: {
      hidden: false, visibilityState: 'visible',
      addEventListener: function () {}, removeEventListener: function () {},
      createElement: function () { return { href: '', style: {}, click: function () {}, remove: function () {} }; },
      getElementById: function (id) { return reg[id] || null; },
      body: bodyEl
    },
    el: function (id) { return reg[id] || (reg[id] = elStub(id)); },
    showView: function (v) { calls.showView.push(v); },
    MODULE_META: { navigator: { title: 'Navigator' } },
    moduleTitle: function () { return 'Navigator'; },
    dotLockActive: function () { return false; },
    buildDashboard: function () { calls.buildDashboard++; },
    App: {
      _esc: function (s) { return String(s == null ? '' : s); }, _store: store,
      _today: function () { return '2026-10-30'; },
      tracker: { status: sessionLive ? 'running' : 'idle' },
      _pip: false, _authLocked: function () { return false; },
      showView: function (v) { calls.showView.push(v); world.App.currentView = (v === 'dash') ? 'main' : v; },
      currentView: 'main',
      tierAllows: function () { return true; },
      ptrNoteRepainted: function () {}
    },
    Meticulous: { modules: {} },
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
    sessionActive: function () { return sessionLive; },
    /* leaf stubs for the real SYS-BACK fx wiring (sheet/sidebar/
       onboarding acts are not exercised by these cases) */
    closeTrackerStartSheet: function () {}, closeTrackerEndSheet: function () {},
    closeOdoSheet: function () {}, closeLoadSheet: function () {},
    closeSidebar: function () {}, collectOnbInputs: function () {},
    onbPrevVisible: function () { return -1; }, renderOnbStep: function () {},
    trackerElapsedSec: function () { return 3725; },
    fmtClock: function (sec) { sec = Math.floor(sec); var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2); },
    loadsGlance: function () { return '🚛 3 loads'; }
  };
  world.window = world;
  world.window.history = world.history;
  world.Capacitor = { Plugins: { ShiftTrack: pluginStub, App: { addListener: function (name, fn) { if (name === 'backButton') backListeners.push(fn); return Promise.resolve({}); }, exitApp: function () {} } } };
  /* App.openModule is sliced from the real app.js below; wrap it to
     record entries the way the v286 suite did */
  vm.createContext(world);
  vm.runInContext(stSrc, world);
  vm.runInContext(navModSrc, world);
  vm.runInContext(navSrc, world);
  world.Meticulous.modules.navigator = world.Meticulous.modules.navigator || null;
  /* the module registers itself on Meticulous.modules at load */
  const api = (world.Meticulous.modules && world.Meticulous.modules.navigator) || null;
  /* REAL app.js slices: bubble block, SYS-BACK block, shell block */
  const bubStart = appSrc.indexOf('App._bubble = false;');
  const bubBlock = appSrc.slice(bubStart, appSrc.indexOf('/* v220 (WIDGET-CONTROLS)', bubStart));
  vm.runInContext(bubBlock, world);
  const sb0 = appSrc.indexOf('/* SYS-BACK-BEGIN');
  const sb1 = appSrc.indexOf('/* v19/v30: native-APK update banner');
  /* SYS-BACK block + HERO-PAINT block + the REAL fx wiring IIFE
     (snapshot/perform) that registers the backButton listener */
  vm.runInContext(appSrc.slice(sb0, sb1), world);
  const sh0 = appSrc.indexOf('  function teardownModule()');
  const sh1 = appSrc.indexOf('/* PTR-BEGIN', sh0);
  vm.runInContext(appSrc.slice(sh0, sh1), world);
  const rawOpen = world.App.openModule;
  world.App.openModule = function (k) { calls.opened.push(k); return rawOpen(k); };
  return {
    world: world, reg: reg, body: body, calls: calls, api: api,
    backListeners: backListeners,
    firePos: function (la, lo, hd, sp) { if (geoCb) geoCb({ coords: { latitude: la, longitude: lo, heading: hd, speed: sp }, timestamp: Date.now() }); },
    pressBack: function () { backListeners.slice().forEach(function (f) { f({}); }); }
  };
}

async function startDriveInWorld(w) {
  w.world.App.openModule('navigator');
  w.firePos(ORIGIN[0], ORIGIN[1], 45, 8);
  await tick(); await tick();
  if (w.reg.nv_drive.onclick) w.reg.nv_drive.onclick();
  await tick();
}

async function part3() {
  console.log('— 3A: PIP-HOME full chain, NO session — Back must float the mini map —');
  {
    const w = makeWorld3({ sessionLive: false, storeData: {
      navigator: { profile: {}, muted: true, mode: 'truck' },
      nav_pending: { lat: DEST[0], lng: DEST[1], name: 'Simply Stone' }
    } });
    check('3A0: navigator module registered', !!w.api);
    check('3A0b: the shell back listener is wired', w.backListeners.length >= 1, 'listeners=' + w.backListeners.length);
    await startDriveInWorld(w);
    w.pressBack();
    await tick();
    check('3A1: the driver lands on the dashboard (dash shown, module view hidden, dashboard built)',
      !w.reg.dashView.classList.contains('hidden') && w.reg.modView.classList.contains('hidden') && w.calls.buildDashboard >= 1,
      'buildDashboard=' + w.calls.buildDashboard);
    check('3A2: the drive screen floats as the compact mini map in the dock',
      w.reg.nv_drive_screen._parent === w.reg.pipDock &&
      w.reg.nv_drive_screen.classList.contains('nv-mini') &&
      !w.reg.nv_drive_screen.classList.contains('hidden'));
    check('3A3: navigation survives the park (module kept alive)', w.api.keepAlive() === true);
    check('3A4: the tracker face stays down (no session)', w.reg.bubbleFace.classList.contains('hidden'));
    try { w.api.teardown(); } catch (e) {}
  }
  console.log('— 3B: PIP-HOME full chain, session live — Back must float the tracker face —');
  {
    const w = makeWorld3({ sessionLive: true, storeData: {
      navigator: { profile: {}, muted: true, mode: 'truck' },
      nav_pending: { lat: DEST[0], lng: DEST[1], name: 'Simply Stone' }
    } });
    await startDriveInWorld(w);
    w.pressBack();
    await tick();
    check('3B1: the driver lands on the dashboard (dash shown, module view hidden, dashboard built)',
      !w.reg.dashView.classList.contains('hidden') && w.reg.modView.classList.contains('hidden') && w.calls.buildDashboard >= 1,
      'buildDashboard=' + w.calls.buildDashboard);
    check('3B2: the TRACKER bubble face is floated — visible over the dashboard',
      !w.reg.bubbleFace.classList.contains('hidden'));
    check('3B3: the drive screen survives HIDDEN in the dock (v227 law)',
      w.reg.nv_drive_screen._parent === w.reg.pipDock &&
      w.reg.nv_drive_screen.classList.contains('nv-parked') &&
      w.reg.nv_drive_screen.classList.contains('hidden'));
    check('3B4: navigation survives the park (module kept alive)', w.api.keepAlive() === true);
    /* tap-back: the shell reopens the Navigator */
    w.world.App.openModule('navigator');
    await tick();
    check('3B5: tap-back restores the drive full-screen',
      w.reg.nv_drive_screen._parent === w.body &&
      !w.reg.nv_drive_screen.classList.contains('hidden') &&
      !w.reg.nv_drive_screen.classList.contains('nv-parked'));
    try { w.api.teardown(); } catch (e) {}
  }
  console.log('— 3C: PIP-HOME home-bound fallthrough — showDashboard with a live unparked drive must PARK, not kill —');
  {
    const w = makeWorld3({ sessionLive: true, storeData: {
      navigator: { profile: {}, muted: true, mode: 'truck' },
      nav_pending: { lat: DEST[0], lng: DEST[1], name: 'Simply Stone' }
    } });
    await startDriveInWorld(w);
    /* the shell heads home WITHOUT the module's back() being
       consumed (the fallthrough his hands hit): today this tears
       the module down — drive killed, no float anywhere */
    w.world.App.showDashboard();
    await tick();
    check('3C1: navigation SURVIVES a home-bound shell move (parked, not torn down)',
      w.api.keepAlive() === true);
    check('3C2: a float exists after the home-bound move (tracker face up)',
      !w.reg.bubbleFace.classList.contains('hidden'));
    check('3C3: the drive screen is parked in the dock',
      w.reg.nv_drive_screen._parent === w.reg.pipDock);
    try { w.api.teardown(); } catch (e) {}
  }
}

(async function () {
  await part1A();
  await part1B();
  part1C();
  part2();
  await part3();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('SUITE ERROR', e); process.exit(2); });
