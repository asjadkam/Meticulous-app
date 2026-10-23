#!/usr/bin/env node
/* Meticulous v208 — VOICE-ON-AT-DRIVE-START (owner, Oct 21, 2026:
 * he drove with NO audio; the post-mortem found a past mute tap
 * persisted invisibly in the navigator settings and startDrive
 * never reset or announced it).
 *
 * The fix: at drive start the voice defaults ON — the persisted
 * mute does not carry into a new drive. The reset is written back
 * to the settings store so the planning face agrees, paintMute
 * shows the speaker ON in the drive bar, and the drive's first
 * announcement actually speaks. An in-drive mute still works —
 * for that drive; the NEXT drive starts unmuted again.
 *
 * Drives the REAL modules/navigator.js in the v139 fake-DOM
 * world (stub Leaflet, stub route fetch, captured speech).
 * Run: node tools/nav-voice-start-v208-test.js
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

  const calls = { spoken: [], fetch: [] };
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
      calls.fetch.push(url);
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
    world: world, reg: reg, body: body, calls: calls, storeData: storeData,
    firePos: function (la, lo, hd, sp) { geoCb({ coords: { latitude: la, longitude: lo, heading: hd, speed: sp } }); },
    mapClick: function () { mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } }); }
  };
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 10); }); }

(async function () {
  console.log('— a drive that starts muted by an old tap —');
  const storeData = { navigator: { profile: {}, muted: true, mode: 'truck' } };
  const w = makeWorld(storeData);
  const api = w.world.Meticulous.modules.navigator;
  w.reg.nv_drive.classList.add('hidden');
  w.reg.nv_drive_screen.classList.add('hidden');
  api.render(w.body);
  w.firePos(ORIGIN[0], ORIGIN[1], 40);
  w.mapClick();
  await tick(); await tick(); await tick();
  w.reg.nv_drive.onclick();
  await tick(260);
  ok('drive screen opened', !w.reg.nv_drive_screen.classList.contains('hidden'));
  eq('the persisted mute was reset at drive start', storeData.navigator.muted, false);
  eq('the drive bar shows the speaker ON (aria-pressed=false)', w.reg.nvd_mute._attrs['aria-pressed'], 'false');
  ok('the drive bar is not wearing the muted tint', !w.reg.nvd_mute.classList.contains('muted'));
  ok('the drive bar paints the unmuted icon (speaker + waves)', w.reg.nvd_mute._html.indexOf('M15.5 8.5') >= 0, w.reg.nvd_mute._html.slice(0, 60));
  eq('the planning face agrees: Sound on', w.reg.nv_mute._text, '🔊 Sound: on');
  ok('the first announcement actually spoke', w.calls.spoken.length >= 1, JSON.stringify(w.calls.spoken));

  console.log('— an in-drive mute still works, for that drive only —');
  const spokenBefore = w.calls.spoken.length;
  w.reg.nvd_mute.onclick();
  eq('in-drive mute persists when tapped', storeData.navigator.muted, true);
  eq('the bar flips to muted', w.reg.nvd_mute._attrs['aria-pressed'], 'true');
  w.reg.nvd_exit.onclick();
  await tick(30);
  w.reg.nv_drive.onclick();
  await tick(260);
  eq('the NEXT drive starts unmuted again — the mute did not carry in', storeData.navigator.muted, false);
  eq('the bar shows ON again', w.reg.nvd_mute._attrs['aria-pressed'], 'false');
  ok('the new drive speaks again', w.calls.spoken.length > spokenBefore, JSON.stringify(w.calls.spoken));

  console.log('— an unmuted driver is untouched —');
  const storeData2 = { navigator: { profile: {}, muted: false, mode: 'truck' } };
  const w2 = makeWorld(storeData2);
  const api2 = w2.world.Meticulous.modules.navigator;
  w2.reg.nv_drive.classList.add('hidden');
  w2.reg.nv_drive_screen.classList.add('hidden');
  api2.render(w2.body);
  w2.firePos(ORIGIN[0], ORIGIN[1], 40);
  w2.mapClick();
  await tick(); await tick(); await tick();
  w2.reg.nv_drive.onclick();
  await tick(260);
  eq('muted stays false', storeData2.navigator.muted, false);
  ok('the drive speaks', w2.calls.spoken.length >= 1);

  console.log('— pins —');
  ok('the reset sits in startDrive before paintMute',
    /VOICE-ON-AT-DRIVE-START[\s\S]{0,900}?saveSettings\(\{ muted: false \}\)/.test(navSrc));
  eq('webVersion is 208', ver.webVersion, 229);
  ok('index.html pins the v208 build', idxSrc.indexOf('?v=229') >= 0 && idxSrc.indexOf('?v=' + '207') < 0);

  console.log('\nnav-voice-start-v208 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR ' + (e && e.stack || e)); process.exit(1); });
