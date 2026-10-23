'use strict';
/* v227 DRIVE-SURFACE — reproduction-first suite for the three
 * v39 IN-HANDS failures (owner, Oct 22 evening):
 *
 *   F1 NAV-NO-MOVEMENT-V39 — "Map is stuck" WHILE DRIVING.
 *      His sequence: drive running; the WebView-fed position
 *      streams (the module's watchPosition + the app fix stream)
 *      go silent mid-drive — the documented silent-death pattern
 *      (Deerfoot recording: clock advancing, map still) — while
 *      the NATIVE side still holds a live GPS (the shell's own
 *      listener is what kept his miles counting in earlier
 *      incidents). The v222/v224 answers patched the merge
 *      between the two WebView-fed streams; this suite drives
 *      the REAL module with both of those streams dead and a
 *      live NATIVE bridge feed (ShiftTrack 'navFix' events).
 *      On the shipped code the module has no native intake at
 *      all, so the camera can never move: RED. The fix is a
 *      native-side movement pipeline, not another timing patch.
 *
 *   F2 BUBBLE-FACE-V39-FAIL + PIP-NONE-V39 — Back on the map
 *      page must dock the drive over the MAIN DASHBOARD with
 *      the TRACKER face floating (timer, loads +/-, start/stop),
 *      never a miniaturized map. His v39 sequence: drive view ->
 *      Back -> landed on the places page / the float was the
 *      whole map. This suite runs the REAL module back() in a
 *      world carrying the REAL app.js bubble-face block: on the
 *      shipped code the dock receives the drive SCREEN wearing
 *      .nv-mini (the map itself) and the tracker face stays
 *      hidden: RED on both counts.
 *      The native half (the shell draws the face itself, no
 *      web-swap timing) is pinned statically in Part C.
 *
 *   F3 WIDGET-COMPACT-SIZES — the widget must live at 1x1 and
 *      2x1 with an adaptive compact face (owner, Oct 22 17:38:
 *      "If this can fit on 1x1... Or 2x1"). Pinned over the
 *      native sources in Part D: on the shipped code the
 *      provider minimum is a 110dp floor (a 2x2 home) with ONE
 *      layout for every size: RED.
 *
 * Run: node tools/drive-surface-v227-test.js
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
function existsNat(p) { try { fs.accessSync(path.join(NAT, p)); return true; } catch (e) { return false; } }
function extractFn(src, marker) {
  const i = src.indexOf(marker);
  if (i === -1) throw new Error('marker not found: ' + marker);
  let depth = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { k++; break; } }
  }
  return src.slice(i, k);
}

const navSrc = read('modules/navigator.js');
const navModSrc = read('modules/navigation.js');
const appSrc = read('js/app.js');
const stSrc = read('js/shifttrack.js');
const fixture = JSON.parse(read('tools/navigator-fixture-tripb.json'));
const ORIGIN = [51.0955, -114.099], DEST = [51.1075, -114.0845];

/* ---------- stub DOM (navigator-test pattern, extended) ---------- */
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

  const calls = { fetch: [], polylines: [], spoken: [], views: [], maps: [], groups: [], showDashboard: 0, opened: [] };
  const mapHandlers = {};
  function makeMapStub() {
    const m = {
      _adds: 0, _removes: 0, _views: [], _panTos: [], _center: null, _zoom: 15,
      setView: function (c, z) { m._views.push([c, z]); m._center = (c && c.lat !== undefined) ? [c.lat, c.lng] : c; if (z) m._zoom = z; return m; },
      panTo: function (c) { const cc = (c && c.lat !== undefined) ? [c.lat, c.lng] : c; m._panTos.push(cc); m._center = cc; return m; },
      setZoomAround: function () {},
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
    tileLayer: function () { const tl = { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return tl; }, on: function () { return tl; }, setUrl: function () {}, redraw: function () {} }; return tl; },
    marker: function () { return { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return this; }, setLatLng: function () {} }; },
    circleMarker: function () { const cm = { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return cm; }, setLatLng: function () {} }; return cm; },
    polyline: function (pts) { calls.polylines.push(pts); const pl = { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return pl; }, setLatLngs: function () {}, getBounds: function () { return {}; } }; return pl; },
    layerGroup: function (kids) { const g = { _kids: kids, getLayers: function () { return g._kids.slice(); }, addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return g; } }; calls.groups.push(g); return g; }
  };
  let geoCb = null;
  /* the shell: a Capacitor ShiftTrack plugin stub. The REAL
     js/shifttrack.js wraps it; the harness fires native events
     through the same addListener registry the bridge uses. */
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
    /* a real browser runs rAF while the WebView is visible; the
       camera animator steps on it. Frames on a short timer so a
       700 ms wait lets an ease finish, like the real screen. */
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
      openModule: function (k) { calls.opened.push(k); },
      showDashboard: function () { calls.showDashboard++; },
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
    },
    /* leaf stubs for the real app.js bubble block (Part B) */
    sessionActive: function () { return true; },
    trackerElapsedSec: function () { return 3725; },
    fmtClock: function (sec) { sec = Math.floor(sec); var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2); },
    loadsGlance: function () { return '🚛 3 loads'; }
  };
  world.window = world;
  if (opts.withShell) {
    world.Capacitor = { Plugins: { ShiftTrack: pluginStub } };
  }
  vm.createContext(world);
  if (opts.withShell) vm.runInContext(stSrc, world);
  vm.runInContext(navModSrc, world);
  vm.runInContext(navSrc, world);
  return {
    world: world, reg: reg, body: body, calls: calls,
    firePos: function (la, lo, hd, sp) { if (geoCb) geoCb({ coords: { latitude: la, longitude: lo, heading: hd, speed: sp }, timestamp: Date.now() }); },
    fireNavFix: function (la, lo, hd, sp, t) {
      (listeners['navFix'] || []).slice().forEach(function (f) {
        f({ latitude: la, longitude: lo, bearing: hd, speed: sp, time: t, accuracy: 8 });
      });
    },
    hasNavFixListener: function () { return (listeners['navFix'] || []).length > 0; }
  };
}
function tick() { return new Promise(function (r) { setTimeout(r, 15); }); }
function settle() { return new Promise(function (r) { setTimeout(r, 700); }); }
function hav(a, b) {
  const R = 6371000, dLa = (b[0] - a[0]) * Math.PI / 180, dLo = (b[1] - a[1]) * Math.PI / 180;
  const s = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
  return 2 * R * Math.asin(Math.sqrt(s));
}

(async function () {
  /* ================= Part A — F1: nav movement ================= */
  console.log('— A: F1 NAV-NO-MOVEMENT-V39 — both WebView streams dead, native feed live —');
  {
    const w = makeWorld({ withShell: true, storeData: {
      navigator: { profile: {}, muted: true, mode: 'truck' },
      nav_pending: { lat: DEST[0], lng: DEST[1], name: 'Test Dest' }
    } });
    const api = w.world.Meticulous.modules.navigator;
    api.render(w.body);
    w.firePos(ORIGIN[0], ORIGIN[1], 45, 8); // the watch is alive at drive start
    await tick(); await tick();
    if (w.reg.nv_drive.onclick) w.reg.nv_drive.onclick();
    await tick();
    const driveMap = w.calls.maps[w.calls.maps.length - 1];
    check('A0: drive is live and the drive map exists', !!driveMap && w.calls.maps.length >= 2, 'maps=' + w.calls.maps.length);
    check('A1: the real web stack exposes a native nav-fix intake (ShiftTrack.addNavFixListener)',
      typeof w.world.ShiftTrack.addNavFixListener === 'function');
    check('A2: the module subscribed to the native feed', w.hasNavFixListener());
    /* his sequence: the watch now dies SILENTLY (no error, no
       more callbacks) and the app stream is silent too — the
       truck keeps moving and the shell's own GPS keeps firing. */
    const t0 = Date.now();
    /* small steps (~28 m each): enough to clear the 3 m pan
       deadband while the camera animator eases between fixes. */
    const steps = [[51.09575, -114.09875], [51.096, -114.0985], [51.09625, -114.09825]];
    steps.forEach(function (p, i) { w.fireNavFix(p[0], p[1], 45, 9, t0 + (i + 1) * 1000); });
    await settle();
    const last = steps[steps.length - 1];
    const ctr = driveMap.getCenter();
    check('A3: the drive camera followed the native feed to the last fix',
      !!ctr && hav([ctr.lat, ctr.lng], last) < 5,
      ctr ? 'centre=' + ctr.lat + ',' + ctr.lng + ' last fix=' + last.join(',') : 'no centre');
    check('A4: the camera actually panned during the native-feed stretch', driveMap._panTos.length >= 1,
      'panTos=' + driveMap._panTos.length);
    try { api.teardown(); } catch (e) {}
  }
  console.log('— A2: fallback intact — no shell, the watch alone still drives the camera —');
  {
    const w = makeWorld({ withShell: false, storeData: {
      navigator: { profile: {}, muted: true, mode: 'truck' },
      nav_pending: { lat: DEST[0], lng: DEST[1], name: 'Test Dest' }
    } });
    const api = w.world.Meticulous.modules.navigator;
    api.render(w.body);
    w.firePos(ORIGIN[0], ORIGIN[1], 45, 8);
    await tick(); await tick();
    if (w.reg.nv_drive.onclick) w.reg.nv_drive.onclick();
    await tick();
    const driveMap = w.calls.maps[w.calls.maps.length - 1];
    w.firePos(51.096, -114.0985, 45, 9);
    w.firePos(51.09625, -114.09825, 45, 9);
    await settle();
    const ctr = driveMap.getCenter();
    if (process.env.DBG) console.log('    [dbg] planViews=' + w.calls.maps[0]._views.length +
      ' driveViews=' + driveMap._views.length + ' dist=' + JSON.stringify(w.reg.nvd_dist.textContent) +
      ' etaSub=' + JSON.stringify(w.reg.nvd_eta_sub.textContent) + ' spoken=' + w.calls.spoken.length +
      ' maps=' + w.calls.maps.map(function (m, i) { return i + ':v' + m._views.length + '/p' + m._panTos.length; }).join(' '));
    check('A5: watch-fed fixes still move the camera with no native feed present',
      !!ctr && hav([ctr.lat, ctr.lng], [51.09625, -114.09825]) < 5,
      ctr ? 'centre=' + ctr.lat + ',' + ctr.lng : 'no centre');
    try { api.teardown(); } catch (e) {}
  }

  /* ================= Part B — F2: back docks the tracker face ================= */
  console.log('— B: F2 PIP-NONE-V39 / BUBBLE-FACE — Back on the map page —');
  {
    const w = makeWorld({ withShell: true, storeData: {
      navigator: { profile: {}, muted: true, mode: 'truck' },
      nav_pending: { lat: DEST[0], lng: DEST[1], name: 'Test Dest' }
    } });
    /* the REAL app.js bubble-face block (refresh/paint + whatever
       dock seam the fix adds) joins the world */
    const bubStart = appSrc.indexOf('App._bubble = false;');
    check('B0: the bubble block is locatable in js/app.js', bubStart >= 0);
    const bubBlock = appSrc.slice(bubStart, appSrc.indexOf('/* v220 (WIDGET-CONTROLS)', bubStart));
    vm.runInContext(bubBlock, w.world);
    const api = w.world.Meticulous.modules.navigator;
    api.render(w.body);
    w.firePos(ORIGIN[0], ORIGIN[1], 45, 8);
    await tick(); await tick();
    if (w.reg.nv_drive.onclick) w.reg.nv_drive.onclick();
    await tick();
    const handled = api.back();
    check('B1: Back on the map page is handled by the module (never falls out of the app)', handled === true);
    check('B2: the driver lands on the MAIN DASHBOARD', w.calls.showDashboard >= 1, 'showDashboard=' + w.calls.showDashboard);
    check('B3: the drive screen is NOT floated as a mini map — it survives hidden in the dock',
      !w.reg.nv_drive_screen.classList.contains('nv-mini') &&
      w.reg.nv_drive_screen.classList.contains('nv-parked') &&
      w.reg.nv_drive_screen.classList.contains('hidden'));
    check('B4: the TRACKER bubble face is the floated piece — visible over the dashboard',
      !w.reg.bubbleFace.classList.contains('hidden'));
    check('B5: the docked face wears the dock posture (a floating card, not the full screen)',
      w.reg.bubbleFace.classList.contains('bub-dock'));
    check('B6: navigation is NOT ended by the dock (the drive is parked alive)',
      api.keepAlive() === true);
    check('B7: the bubble face shows the tracker facts (clock + loads painted)',
      w.reg.bubClock.textContent === '01:02:05' && /3 loads/.test(w.reg.bubLoads.textContent),
      'clock=' + w.reg.bubClock.textContent + ' loads=' + w.reg.bubLoads.textContent);
    try { api.teardown(); } catch (e) {}
  }

  /* ================= Part C — F2 native: the shell draws the face ================= */
  console.log('— C: F2 native half — native PiP face, no web-swap timing —');
  {
    const ma = readNat('android/app/src/main/java/com/meticuloustechnologies/app/MainActivity.java');
    const plug = readNat('android/app/src/main/java/com/meticuloustechnologies/app/ShiftTrackPlugin.java');
    const facePath = 'android/app/src/main/java/com/meticuloustechnologies/app/PipFaceView.java';
    check('C1: a native PiP face view exists (the shell draws the small face itself)', existsNat(facePath));
    const face = existsNat(facePath) ? readNat(facePath) : '';
    check('C2: MainActivity shows the native face on leave', /PipFaceView/.test(ma) && /showPipFace|pipFace/.test(ma));
    const leaveIdx = ma.indexOf('onUserLeaveHint');
    const showIdx = ma.indexOf('showPipFace', leaveIdx);
    const enterIdx = ma.indexOf('enterPictureInPictureMode', leaveIdx);
    check('C3: the face is up BEFORE PiP entry is requested (no swap race)',
      leaveIdx >= 0 && showIdx > leaveIdx && (enterIdx === -1 || showIdx < ma.indexOf('enterPipNow', leaveIdx) || showIdx < enterIdx),
      'leave=' + leaveIdx + ' show=' + showIdx);
    check('C4: the 150 ms delayed-entry web-swap dependency is GONE from the leave path',
      ma.indexOf('postDelayed') === -1 || ma.indexOf('150') === -1);
    check('C5: PiP params carry ACTIONS (play/pause + load +/- are real controls in the float)',
      /setActions/.test(ma) && /loadPlus|LOAD_PLUS|pip_load_plus/.test(ma + plug) && /loadMinus|LOAD_MINUS|pip_load_minus/.test(ma + plug));
    check('C6: the plugin carries the bubble state the face renders (bubbleState) and collects PiP actions (takePipAction)',
      /void bubbleState/.test(plug) && /void takePipAction/.test(plug));
    check('C7: the native face is tracker-only — no map, no web view, no directions bar in it',
      face.length > 0 && !/WebView|MapView|Leaflet|nv_drive|directions/i.test(face));
    check('C8: the native face renders the clock, the loads and a small status line',
      /clock|Clock/.test(face) && /loads|Loads/.test(face) && /status|Status/.test(face));
    check('C9: a PiP action receiver routes taps back to the tracker (PipActionReceiver)',
      existsNat('android/app/src/main/java/com/meticuloustechnologies/app/PipActionReceiver.java'));
    check('C10: the web wrapper exposes the bubble seam (pushBubbleState / takePipAction / addPipActionListener)',
      /pushBubbleState/.test(stSrc) && /takePipAction/.test(stSrc) && /addPipActionListener/.test(stSrc));
  }

  /* ================= Part D — F3: widget compact sizes ================= */
  console.log('— D: F3 WIDGET-COMPACT-SIZES — 1x1 and 2x1 —');
  {
    const info = readNat('android/app/src/main/res/xml/widget_tracker_info.xml');
    const tw = readNat('android/app/src/main/java/com/meticuloustechnologies/app/TrackerWidget.java');
    const num = function (re) { const m = re.exec(info); return m ? parseInt(m[1], 10) : null; };
    check('D1: the provider lets the widget shrink to a 1x1 cell (min + minResize <= 80dp)',
      (num(/android:minWidth="(\d+)dp/) || 999) <= 80 && (num(/android:minHeight="(\d+)dp/) || 999) <= 80 &&
      (num(/android:minResizeWidth="(\d+)dp/) || 999) <= 80 && (num(/android:minResizeHeight="(\d+)dp/) || 999) <= 80,
      info.replace(/\s+/g, ' ').slice(0, 200));
    const rowPath = 'android/app/src/main/res/layout/widget_tracker_row.xml';
    const miniPath = 'android/app/src/main/res/layout/widget_tracker_mini.xml';
    check('D2: a 2x1 row layout exists', existsNat(rowPath));
    check('D3: a 1x1 mini layout exists', existsNat(miniPath));
    const row = existsNat(rowPath) ? readNat(rowPath) : '';
    const mini = existsNat(miniPath) ? readNat(miniPath) : '';
    check('D4: the row face carries timer + loads line + the three colour controls',
      /widget_primary/.test(row) && /widget_secondary/.test(row) &&
      /widget_btn_start/.test(row) && /widget_btn_pause/.test(row) && /widget_btn_stop/.test(row) &&
      /widget_btn_green/.test(row) && /widget_btn_yellow/.test(row) && /widget_btn_red/.test(row));
    check('D5: the mini face leads with the timer and start/stop (the named 1x1 shape)',
      /widget_primary/.test(mini) && /widget_btn_toggle|widget_btn_start/.test(mini) && /widget_btn_stop/.test(mini));
    check('D6: the provider picks the layout from the widget\'s actual size (options-driven)',
      /OPTION_APPWIDGET_MIN_WIDTH/.test(tw) && /widget_tracker_row/.test(tw) && /widget_tracker_mini/.test(tw));
    check('D7: a resize repaints that widget in its new size class (per-id rebuild)',
      /onAppWidgetOptionsChanged[\s\S]{0,400}buildViews\(context, appWidgetId\)|updateAppWidget\(appWidgetId, buildViews/.test(tw));
  }

  console.log('\ndrive-surface-v227: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('SUITE ERROR', e && e.stack || e); process.exit(2); });
