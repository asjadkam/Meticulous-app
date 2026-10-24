#!/usr/bin/env node
/* Meticulous v212 — the WEB half of native v36 (Stage E bridges).
 *
 * The Android shell (native v36) extends the ShiftTrack plugin
 * with five methods; this build carries their web halves:
 *   speakText/stopSpeak  — NATIVE TTS: the Navigator's speak()
 *     hands the line to the native engine when the shim accepts
 *     it (it keeps talking backgrounded / in PiP and is immune
 *     to the WebView speechSynthesis failure modes); the web
 *     voice remains the fallback everywhere else, and a native
 *     engine that reports itself unable flips the shim's
 *     _ttsDead so later lines fall back instead of vanishing.
 *   navNotify/navNotifyClear — the TRAY READOUT: driveTick
 *     mirrors the next-turn line to the notification tray,
 *     change-gated; exitDrive clears it.
 *   setDriving — the PiP arm MainActivity reads on leave.
 *   widgetState — the WIDGET mirror: paintHero pushes the
 *     dashboard's own composed facts, change-gated.
 * Every wrapper is feature-detected: v35 shells, browsers and
 * iPhones see exactly the app they had.
 *
 * Part 1 drives the real js/shifttrack.js against stub plugins.
 * Part 2 drives the real modules/navigator.js in the v208
 * fake-DOM world with a recording ShiftTrack bridge.
 * Run: node tools/native-bridge-v212-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const shimSrc = read('js/shifttrack.js');
const navSrc = read('modules/navigator.js');
const appSrc = read('js/app.js');
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
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 10); }); }

/* ---------- Part 1: the shim against stub plugins ---------- */
function shimWorld(pluginImpl) {
  const world = {
    console: console, JSON: JSON, Math: Math, Date: Date, setTimeout: setTimeout,
    document: { addEventListener: function () {}, visibilityState: 'visible' },
    App: { _store: { get: function (k, d) { return d; }, set: function () {}, del: function () {} }, tracker: { status: 'idle' } }
  };
  world.window = world;
  if (pluginImpl) world.Capacitor = { Plugins: { ShiftTrack: pluginImpl } };
  vm.createContext(world);
  vm.runInContext(shimSrc, world);
  return world;
}
function v35Plugin() {
  return {
    start: function () { return Promise.resolve({}); },
    stop: function () { return Promise.resolve({}); },
    status: function () { return Promise.resolve({}); },
    readCrumbs: function () { return Promise.resolve({ crumbs: [] }); },
    ack: function () { return Promise.resolve({}); },
    armDay: function () { return Promise.resolve({}); },
    disarmDay: function () { return Promise.resolve({}); }
  };
}

(async function () {
  console.log('— the shim: v36 plugin present —');
  {
    const calls = [];
    const p = v35Plugin();
    let speakAnswer = { ok: true };
    p.speakText = function (a) { calls.push(['speakText', a.text]); return Promise.resolve(speakAnswer); };
    p.stopSpeak = function () { calls.push(['stopSpeak']); return Promise.resolve({}); };
    p.navNotify = function (a) { calls.push(['navNotify', a.title, a.text]); return Promise.resolve({}); };
    p.navNotifyClear = function () { calls.push(['navNotifyClear']); return Promise.resolve({}); };
    p.setDriving = function (a) { calls.push(['setDriving', a.on]); return Promise.resolve({}); };
    p.widgetState = function (a) { calls.push(['widgetState', a.status, a.primary, a.secondary]); return Promise.resolve({}); };
    const w = shimWorld(p);
    const ST = w.window.ShiftTrack;
    eq('speakNative accepts the line', ST.speakNative('Turn left onto 16 Ave'), true);
    eq('the line reached the native engine', calls[0], ['speakText', 'Turn left onto 16 Ave']);
    ST.navNotify('Turn left', '300 m · 12 km left');
    ST.setDriving(true);
    ST.pushWidgetState({ status: 'Working…', primary: '02:31:00', secondary: '3 loads' });
    ST.stopNativeSpeak();
    ST.navNotifyClear();
    eq('every bridge call landed', calls.map(function (c) { return c[0]; }),
      ['speakText', 'navNotify', 'setDriving', 'widgetState', 'stopSpeak', 'navNotifyClear']);
    eq('the widget payload rides verbatim', calls[3], ['widgetState', 'Working…', '02:31:00', '3 loads']);
    /* the engine reports itself dead → later lines fall back */
    speakAnswer = { ok: false };
    eq('a line is still attempted while health is unknown', ST.speakNative('Next line'), true);
    await tick(20);
    eq('after an ok:false answer the shim stops offering lines', ST.speakNative('Third line'), false);
  }

  console.log('— the shim: v35 shell / no shell —');
  {
    const w = shimWorld(v35Plugin());
    const ST = w.window.ShiftTrack;
    eq('v35 shell: speakNative declines (web voice will run)', ST.speakNative('Turn left'), false);
    let threw = false;
    try { ST.navNotify('t', 'x'); ST.navNotifyClear(); ST.setDriving(true); ST.pushWidgetState({ status: 'a', primary: 'b', secondary: 'c' }); ST.stopNativeSpeak(); } catch (e) { threw = true; }
    ok('v35 shell: the other wrappers are silent no-ops', !threw);
    const w2 = shimWorld(null);
    eq('no shell: speakNative declines', w2.window.ShiftTrack.speakNative('Turn left'), false);
    ok('no shell: available() is false', w2.window.ShiftTrack.available() === false);
  }

  console.log('— the Navigator routes speech + tray through the bridge —');
  function el() {
    const e = {
      children: {}, style: {}, _html: '', value: '', onclick: null, _text: '', _attrs: {},
      _listeners: {},
      addEventListener: function (ev, fn) { (e._listeners[ev] = e._listeners[ev] || []).push(fn); },
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
  function navWorld(withBridge) {
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
    const calls = { spoken: [], native: [], driving: [], tray: [], trayClears: 0, stopSpeak: 0 };
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
    if (withBridge) {
      world.ShiftTrack = {
        speakNative: function (t) { calls.native.push(t); return true; },
        stopNativeSpeak: function () { calls.stopSpeak++; },
        navNotify: function (title, text) { calls.tray.push([title, text]); },
        navNotifyClear: function () { calls.trayClears++; },
        setDriving: function (on) { calls.driving.push(on); }
      };
    }
    vm.createContext(world);
    vm.runInContext(navSrc, world);
    return {
      world: world, reg: reg, body: body, calls: calls,
      firePos: function (la, lo, hd, sp) { geoCb({ coords: { latitude: la, longitude: lo, heading: hd, speed: sp } }); },
      mapClick: function () { mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } }); }
    };
  }
  {
    const w = navWorld(true);
    const api = w.world.Meticulous.modules.navigator;
    w.reg.nv_drive.classList.add('hidden');
    w.reg.nv_drive_screen.classList.add('hidden');
    api.render(w.body);
    w.firePos(ORIGIN[0], ORIGIN[1], 40);
    w.mapClick();
    await tick(); await tick(); await tick();
    w.reg.nv_drive.onclick();
    await tick(280);
    ok('the first line went to the NATIVE engine', w.calls.native.length >= 1, JSON.stringify(w.calls.native));
    eq('the WebView voice stayed silent (native took the line)', w.calls.spoken.length, 0);
    eq('PiP was armed at drive start', w.calls.driving, [true]);
    ok('the tray readout received the next-turn line', w.calls.tray.length >= 1 && !!w.calls.tray[0][0], JSON.stringify(w.calls.tray));
    w.reg.nvd_exit.onclick();
    await tick(30);
    eq('PiP disarmed at drive end', w.calls.driving, [true, false]);
    eq('the tray readout was cleared', w.calls.trayClears, 1);
    eq('native speech was stopped', w.calls.stopSpeak, 1);
  }
  {
    const w = navWorld(false);
    const api = w.world.Meticulous.modules.navigator;
    w.reg.nv_drive.classList.add('hidden');
    w.reg.nv_drive_screen.classList.add('hidden');
    api.render(w.body);
    w.firePos(ORIGIN[0], ORIGIN[1], 40);
    w.mapClick();
    await tick(); await tick(); await tick();
    w.reg.nv_drive.onclick();
    await tick(280);
    ok('off-shell the WebView voice speaks exactly as before', w.calls.spoken.length >= 1, JSON.stringify(w.calls.spoken));
  }

  console.log('— pins —');
  ok('app.js pushes the widget from paintHero', appSrc.indexOf('function pushWidgetState(m)') >= 0 && appSrc.indexOf('pushWidgetState(m);') >= 0);
  ok('the shim carries all five bridges',
    ['speakText', 'stopSpeak', 'navNotify', 'setDriving', 'widgetState'].every(function (k) { return shimSrc.indexOf(k) >= 0; }));
  ok('the Navigator hooks are in', navSrc.indexOf('ShiftTrack.speakNative') >= 0 && navSrc.indexOf('ShiftTrack.navNotify') >= 0 && navSrc.indexOf('ShiftTrack.setDriving') >= 0);
  eq('webVersion is 212', ver.webVersion, 242);
  ok('index.html pins the v212 build', idxSrc.indexOf('?v=242') >= 0 && idxSrc.indexOf('?v=' + '211') < 0);

  console.log('\nnative-bridge-v212 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR ' + (e && e.stack || e)); process.exit(1); });
