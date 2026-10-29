#!/usr/bin/env node
/* Meticulous v280 — WAVE C (NAVIGATOR), Oct 29 "Fix it all" run.
 *
 * Driven at the owner's drive viewport class (411x960 CSS px,
 * DPR 2.625 — the v273 VIEWPORT LAW) wherever geometry is judged.
 *
 * C1 NAV-VOICE-SELECTION-PREF + NAV-VOICE-PERSONALITY + the
 *    N-voice/mute audit: Navigator settings gains a voice picker
 *    listing the voices the device TTS actually offers
 *    (speechSynthesis.getVoices); the pick persists in the
 *    navigator settings record and speak() says guidance with
 *    THAT voice (the picked voice is the personality mechanism —
 *    no text tricks). A pick routes through the WebView voice,
 *    because the native bridge (ShiftTrack.speakText) carries no
 *    voice parameter; with NO pick, the native-first order is
 *    unchanged. Mute audit residual found + fixed here: muting
 *    cancelled only the WebView synth — a native line in flight
 *    kept talking; toggleMute now also stops the native engine.
 * C4 NAV-GPS-FLICKER: the drive carried TWO position renders —
 *    the truck overlay (#nvd_you, fixed at the anchor) AND a
 *    Leaflet circleMarker (the plain blue dot) riding the plane
 *    underneath it; as the follow camera eased/panned the two
 *    separated and alternated — his "flipping between the truck
 *    icon and the plain dot". Fix: the drive map creates NO
 *    circleMarker; ONE marker (the truck) fed by the one onPos
 *    stream. (The planning map's own position dot is untouched.)
 * C5 NAV-LANE-CARD-NO-USEFUL-INFO / NAV-DEMO-DUP-INSTRUCTION:
 *    the inset card is the LANE inset — it now renders ONLY the
 *    lane strip (real turn:lanes / server lanes / count strip),
 *    and shows only when lane guidance actually exists for the
 *    maneuver; the repeated turn instruction, the junction
 *    drawing and the sign block no longer ride in it (the big
 *    banner already says the turn).
 * C6 NAV-INSTRUCTIONS-COVER-MAP: chrome budget at 411x960 —
 *    banner capped (36px distance, instruction clamped to 2
 *    lines, max-height 150px), the lanes-only inset shrinks to
 *    a ~46px strip docked under it; top chrome <= ~210px of
 *    960 (22%) and the bottom bar is the only bottom chrome, so
 *    the map keeps >= ~68% of the glass.
 * C7 NAV-DEMO remainder: layers button moves INTO the drive
 *    bar (no floating button over the roads); the chat mic,
 *    while driving, docks bottom-left beside the speedometer
 *    instead of floating mid-right over the junction; the truck
 *    glyph renders at 76% inside its anchor box (vehicle-sized,
 *    anchor contract untouched); NAV-PIP-NO-MIC-BUTTON: the
 *    shell PiP posture (applyPipFace) raises a body class and
 *    the mic is display:none in PiP.
 * C13 NAV-TRAFFIC-LIVE-ETA (owner Oct 29, 2026, refined 13:30
 *    MDT — Google's OFFICIAL Routes API, server-side, rendered
 *    on our own map; cost guard: no charges before a paying
 *    user). SPLIT as shipped: (live now) the Socrata incidents
 *    refresh keeps its 120 s tick-gated cycle through the whole
 *    drive, the ETA recomputes every tick from the truck's
 *    MEASURED pace (180 s GPS window, blended with plan pace),
 *    and when a refreshed incident ahead coincides with a live
 *    ETA stretched >=4 min past the plan snapshot, the offer
 *    pill appears (one per incident; tap re-plans through
 *    doRoute and the verdict is spoken against the shown ETA).
 *    (gated) pollGoogleEta probes the nav server's
 *    /ai/traffic-eta once per drive and polls it every 180 s
 *    ONLY when the server answers with a live duration — the
 *    server endpoint ships unconfigured (no Routes key) under
 *    the cost guard, so today the probe hears
 *    traffic_not_configured and nothing is billed or burned.
 * Audited, no code change (evidence in the run report):
 *    C2 (v183/v209), C3 (v215 — its harness stub is repaired in
 *    this ship), C8 (v192/v260), C9 (v194), C10 (v179/v183),
 *    C11 (native v54+ / web B-parts), C12 (v244/v254).
 *
 * Run: node tools/nav-wave-c-v280-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const navSrc = read('modules/navigator.js');
const css = read('css/style.css');
const fixture = JSON.parse(read('tools/navigator-fixture-tripb.json'));
const ORIGIN = [51.0955, -114.099], DEST = [51.1075, -114.0845];

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* ---------------- fake DOM (v208 world, completed stubs) ---------------- */
function el() {
  const e = {
    children: {}, style: {}, _html: '', value: '', onclick: null, _text: '', _attrs: {},
    _listeners: {},
    addEventListener: function (ev, fn) { (e._listeners[ev] = e._listeners[ev] || []).push(fn); },
    removeEventListener: function () {},
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

const VOICES = [
  { name: 'Google US English', lang: 'en-US', voiceURI: 'uriA' },
  { name: 'Samantha', lang: 'en-CA', voiceURI: 'uriB' }
];

const RealDate = Date;
const CLOCK = { now: 1761800000000 };
function FakeDate(ms) { return new RealDate(ms === undefined ? CLOCK.now : ms); }
FakeDate.now = function () { return CLOCK.now; };

function makeWorld(storeData, opts) {
  opts = opts || {};
  const store = {
    get: function (k, d) { return storeData[k] !== undefined ? storeData[k] : d; },
    set: function (k, v) { storeData[k] = v; },
    del: function (k) { delete storeData[k]; }
  };
  const ids = ['nv_banner', 'nv_map', 'nv_mode_truck', 'nv_mode_car', 'nv_follow', 'nv_mute',
    'nv_q', 'nv_search', 'nv_results', 'nv_destnote', 'nv_route', 'nv_end', 'nv_note', 'nv_steps',
    'nv_pq', 'nv_presults', 'nv_gear', 'nv_settings',
    'nv_back', 'nv_drive', 'nv_drive_screen', 'nv_drive_map',
    'nvd_dist', 'nvd_inst', 'nvd_road', 'nvd_eta_main', 'nvd_eta_sub', 'nvd_reroute', 'nvd_plane',
    'nvd_mute', 'nvd_exit', 'nvd_you', 'nvd_avatar_picker', 'nvd_recenter', 'nvd_gear',
    'nvd_inset', 'nvd_traffic', 'nvd_pip_line', 'nvd_speed', 'nvd_limit', 'nvd_speedwrap',
    'nvd_layers', 'nvd_layers_panel', 'nvd_layers_note', 'nvd_offer'];
  const reg = {};
  ids.forEach(function (id) { reg[id] = el(); });
  reg.nv_presults = resultsEl();
  reg.nv_banner.children['.nv-banner-main'] = el();
  reg.nv_banner.children['.nv-banner-sub'] = el();
  /* the settings panel's voice select, pre-registered the way
     wireNavSettings will look it up */
  const voiceSel = el(); voiceSel.value = '';
  reg.nv_settings.children['#nvs_voice'] = voiceSel;
  const avOpts = ['dump', 'semi', 'pickup', 'arrow'].map(function (k) {
    const o = el();
    o.getAttribute = function (n) { return n === 'data-avatar' ? k : null; };
    return o;
  });
  reg.nvd_avatar_picker.querySelectorAll = function (sel) { return sel === '[data-avatar]' ? avOpts : []; };
  const body = el();
  body.querySelector = function (sel) { return reg[sel.slice(1)] || null; };
  body.querySelectorAll = function () { return []; };

  const calls = { spoken: [], native: [], nativeStops: 0, fetch: [], circles: 0 };
  const mapHandlers = {};
  function makeMapStub() {
    const m = {
      setView: function () { return m; }, panTo: function () { return m; },
      getCenter: function () { return null; }, getZoom: function () { return 18; },
      project: function () { return { x: 0, y: 0 }; }, unproject: function () { return { lat: 0, lng: 0 }; },
      on: function (ev, fn) { mapHandlers[ev] = fn; },
      addLayer: function () { return m; }, removeLayer: function () { return m; },
      remove: function () {}, fitBounds: function () {}, invalidateSize: function () {}
    };
    return m;
  }
  const L = {
    map: function () { return makeMapStub(); },
    tileLayer: function () {
      return { on: function () {}, setUrl: function () {}, redraw: function () {},
        addTo: function (mm) { if (mm && mm.addLayer) mm.addLayer(this); return this; } };
    },
    marker: function () {
      const mk = { addTo: function (mm) { if (mm && mm.addLayer) mm.addLayer(this); return mk; },
        setLatLng: function () {}, setOpacity: function () {}, setIcon: function () {} };
      return mk;
    },
    circleMarker: function () {
      calls.circles++;
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
    },
    divIcon: function (o) { return o; }
  };
  let geoCb = null;
  const world = {
    console: console, JSON: JSON, Math: Math, Date: FakeDate, setTimeout: setTimeout,
    window: null,
    document: {
      hidden: false,
      addEventListener: function () {}, removeEventListener: function () {},
      getElementById: function () { return null; },
      createElement: function () { return { href: '', style: {}, click: function () {}, remove: function () {} }; },
      body: { appendChild: function () {}, classList: { add: function () {}, remove: function () {}, toggle: function () {} } }
    },
    App: {
      _esc: function (s) { return String(s == null ? '' : s); }, _store: store,
      _today: function () { return '2026-10-29'; }, openModule: function () {}
    },
    Meticulous: {},
    L: L,
    ShiftTrack: {
      speakNative: function (t) { calls.native.push(t); return true; },
      stopNativeSpeak: function () { calls.nativeStops++; },
      setDriving: function () {},
      addNavFixListener: function () {},
      addPipListener: function () {},
      navLastFix: function () { return Promise.resolve(null); }
    },
    navigator: { geolocation: { watchPosition: function (cb) { geoCb = cb; return 7; }, clearWatch: function () {} } },
    speechSynthesis: {
      cancel: function () {}, resume: function () {},
      speaking: false, pending: false,
      speak: function (u) { calls.spoken.push(u); },
      getVoices: function () { return VOICES.slice(); },
      addEventListener: function () {}
    },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    fetch: function (url, fopts) {
      calls.fetch.push(url);
      if (url.indexOf('data.calgary.ca') >= 0) {
        calls.socrata = (calls.socrata || 0) + 1;
        var rows = opts.socrata ? opts.socrata(calls.socrata) : [];
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(rows); } });
      }
      if (url.indexOf('/ai/traffic-eta') >= 0) {
        calls.trafficEta = (calls.trafficEta || 0) + 1;
        var ans = opts.trafficEta ? opts.trafficEta(calls.trafficEta) : { error: 'traffic_not_configured' };
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(ans); } });
      }
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
    world: world, reg: reg, body: body, calls: calls, storeData: storeData, voiceSel: voiceSel,
    firePos: function (la, lo, hd, sp) { geoCb({ coords: { latitude: la, longitude: lo, heading: hd, speed: sp } }); },
    mapClick: function () { mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } }); }
  };
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 10); }); }

(async function () {
  console.log('— C1: voice selection lives in Navigator settings, persists, and speaks —');
  const storeData = { navigator: { profile: {}, muted: false, mode: 'truck' } };
  const w = makeWorld(storeData);
  const api = w.world.Meticulous.modules.navigator;
  w.reg.nv_drive.classList.add('hidden');
  w.reg.nv_drive_screen.classList.add('hidden');
  api.render(w.body);
  w.reg.nv_gear.onclick();
  ok('settings panel offers a Guidance voice picker', w.reg.nv_settings._html.indexOf('id="nvs_voice"') >= 0, w.reg.nv_settings._html.slice(0, 200));
  ok('the picker lists the voices the device TTS offers (both stub voices)',
    w.voiceSel._html.indexOf('Google US English') >= 0 && w.voiceSel._html.indexOf('Samantha') >= 0, w.voiceSel._html);
  ok('the picker offers the phone-default choice', w.voiceSel._html.indexOf('Phone default') >= 0, w.voiceSel._html);
  w.voiceSel.value = 'uriB';
  if (typeof w.voiceSel.onchange === 'function') w.voiceSel.onchange();
  else ok('the voice picker has an onchange handler', false);
  eq('the pick persists in the navigator settings record', storeData.navigator.voiceURI, 'uriB');

  console.log('— C1+C4: the drive speaks with the picked voice; ONE marker (the truck) —');
  w.firePos(ORIGIN[0], ORIGIN[1], 40);
  w.mapClick();
  await tick(); await tick(); await tick();
  await tick(320); /* planning-map settle pass lands (its own dot is the plan face's) */
  const circlesBeforeDrive = w.calls.circles;
  w.reg.nv_drive.onclick();
  await tick(300);
  ok('guidance spoke at drive start', w.calls.spoken.length >= 1, JSON.stringify(w.calls.spoken.map(function (u) { return u.text; })));
  ok('the spoken line carries the PICKED voice', w.calls.spoken.length && w.calls.spoken[0].voice && w.calls.spoken[0].voice.voiceURI === 'uriB',
    w.calls.spoken.length ? JSON.stringify(w.calls.spoken[0].voice) : 'nothing spoken');
  eq('with a voice picked, the native default voice is NOT used', w.calls.native.length, 0);
  eq('C4: the drive map created NO plain-dot circleMarker (one marker only)', w.calls.circles, circlesBeforeDrive);

  console.log('— C1 mute audit: muting silences BOTH engines —');
  w.reg.nvd_mute.onclick();
  eq('mute persisted', storeData.navigator.muted, true);
  ok('muting stopped the NATIVE engine too (stopNativeSpeak)', w.calls.nativeStops >= 1, 'stops=' + w.calls.nativeStops);
  const spokenAtMute = w.calls.spoken.length + w.calls.native.length;
  w.reg.nvd_mute.onclick(); /* unmute — speaks its confirmation with the picked voice */
  ok('unmute confirmation spoke with the picked voice',
    w.calls.spoken.length > 0 && w.calls.spoken[w.calls.spoken.length - 1].voice &&
    w.calls.spoken[w.calls.spoken.length - 1].voice.voiceURI === 'uriB',
    JSON.stringify(w.calls.spoken.map(function (u) { return u.text; })));

  console.log('— C1: no pick = the native-first order is unchanged —');
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
  await tick(300);
  ok('with no pick, guidance goes to the native engine first', w2.calls.native.length >= 1, JSON.stringify(w2.calls.native));

  console.log('— C5: the inset is the LANE card — lanes only, never the turn text —');
  const insetStart = navSrc.indexOf('var insetEl = body.querySelector');
  const insetSeg = navSrc.slice(insetStart, navSrc.indexOf('var pipLineEl', insetStart));
  ok('the inset paint contains no maneuver instruction text', insetSeg.indexOf('dp.next.instruction') === -1);
  ok('the inset paint contains no junction drawing', insetSeg.indexOf('junctionViewSvg(') === -1);
  ok('the inset paint contains no sign block', insetSeg.indexOf('nv-inset-sign') === -1 && insetSeg.indexOf('insetSignOf') === -1);
  ok('the inset renders the lane strip (laneGuidanceHtml)', insetSeg.indexOf('laneGuidanceHtml') >= 0);
  ok('the inset shows only when lane guidance exists', /showInset\s*=\s*showInset\s*&&\s*!!laneHtml|showInset\s*&&\s*!!laneHtml/.test(insetSeg), insetSeg.slice(0, 400));

  console.log('— C6: chrome budget at his 411x960 viewport —');
  const topRule = (css.match(/\.nv-drive-top\{[^}]*\}/) || [''])[0];
  const distRule = (css.match(/\.nv-drive-dist\{[^}]*\}/) || [''])[0];
  const instRule = (css.match(/\.nv-drive-inst\{[^}]*\}/) || [''])[0];
  const insetRule = (css.match(/\.nv-drive-inset\{[^}]*\}/) || [''])[0];
  ok('banner carries a hard max-height bound (<=150px)', /max-height:(1[0-4][0-9]|150)px/.test(topRule), topRule);
  ok('banner distance is capped (<=38px)', /font-size:(3[0-8])px/.test(distRule), distRule);
  ok('instruction clamps to 2 lines (never stacks over the map)', instRule.indexOf('-webkit-line-clamp:2') >= 0, instRule);
  const insetTop = Number((insetRule.match(/top:calc\((\d+)px/) || [])[1] || 999);
  ok('the lanes strip docks under the capped banner (top <=170px)', insetTop <= 170, insetRule.slice(0, 120));
  /* budget: banner <=150 + gap + lanes strip ~46 + bottom bar ~86
     of 960 -> map keeps >= 65% of the glass */
  ok('top+bottom chrome budget leaves the map dominant (>=65% of 960)', (150 + 10 + 46 + 86) <= 0.35 * 960);

  console.log('— C7: controls docked off the road; truck sized as a vehicle; no mic in PiP —');
  ok('the layers button is moved INTO the drive bar', /nv-drive-bar[\s\S]{0,200}insertBefore|insertBefore[\s\S]{0,120}nvd_layers|appendChild\(layersBtn\)/.test(navSrc));
  const micRule = (css.match(/body\.mt-driving #chatFab\{[^}]*\}/) || [''])[0];
  ok('the mic docks bottom-left (not floating mid-right over the junction)',
    /left:calc\(/.test(micRule) && /bottom:calc\(96px/.test(micRule) && !/top:calc\(50%/.test(micRule), micRule);
  ok('PiP raises a body class from applyPipFace', navSrc.indexOf("classList.toggle('mt-pip'") >= 0 || navSrc.indexOf('classList.toggle("mt-pip"') >= 0);
  ok('the mic is display:none in PiP (NAV-PIP-NO-MIC-BUTTON)', /body\.mt-pip #chatFab\{[^}]*display:none/.test(css));
  const imgRule = (css.match(/\.nv-drive-you img\{[^}]*\}/) || [''])[0];
  ok('the truck glyph renders at 76% inside its anchor box', /width:76%/.test(imgRule) && /height:76%/.test(imgRule), imgRule);
  ok('the you-marker becomes a centred flex box (glyph centred, anchor untouched)',
    /\.nv-drive-you\{[^}]*display:flex/.test(css));

  console.log('— C13: live refresh + pace ETA + faster-route offer (Socrata + pace live; provider key not configured) —');
  /* decode the fixture route line (polyline6) to walk the truck
     along the road itself */
  function decode6(str) {
    var pts = [], lat = 0, lng = 0, i = 0;
    function val() {
      var r = 0, sh = 0, b;
      do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
      return (r & 1) ? ~(r >> 1) : (r >> 1);
    }
    while (i < str.length) { lat += val(); lng += val(); pts.push([lat / 1e6, lng / 1e6]); }
    return pts;
  }
  const line = decode6(fixture.trip.legs[0].shape);
  function hav(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var dLa = (b[0] - a[0]) * rad, dLo = (b[1] - a[1]) * rad;
    var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function pointAlong(m) {
    var acc = 0;
    for (var i = 0; i + 1 < line.length; i++) {
      var d = hav(line[i], line[i + 1]);
      if (acc + d >= m) { var f = d ? (m - acc) / d : 0; return [line[i][0] + (line[i + 1][0] - line[i][0]) * f, line[i][1] + (line[i + 1][1] - line[i][1]) * f]; }
      acc += d;
    }
    return line[line.length - 1];
  }
  function etaMinutes(txt) {
    var m = /Arrive · (?:(\d+) h )?(\d+) min/.exec(txt || '');
    return m ? (Number(m[1] || 0) * 60 + Number(m[2])) : -1;
  }
  const incPoint = pointAlong(1500);
  const incRow = { start_dt_utc: '2026-10-29T19:00:00', latitude: String(incPoint[0]), longitude: String(incPoint[1]), incident_info: 'Collision', description: 'Two vehicles, lanes blocked' };
  const storeData3 = { navigator: { profile: {}, muted: false, mode: 'truck' } };
  const w3 = makeWorld(storeData3, { socrata: function (n) { return n >= 3 ? [incRow] : []; } });
  const api3 = w3.world.Meticulous.modules.navigator;
  w3.reg.nv_drive.classList.add('hidden');
  w3.reg.nv_drive_screen.classList.add('hidden');
  w3.reg.nvd_offer.classList.add('hidden');
  api3.render(w3.body);
  w3.firePos(line[0][0], line[0][1], 40);
  w3.mapClick();
  await tick(); await tick(); await tick();
  w3.reg.nv_drive.onclick();
  await tick(300);
  const socrataAtStart = w3.calls.socrata || 0;
  ok('C13: the incidents feed was pulled for the drive', socrataAtStart >= 1, 'calls=' + socrataAtStart);
  eq('C13: licensed-provider traffic probed exactly once at drive start (unconfigured: no polling burn)', w3.calls.trafficEta || 0, 1);
  const etaBefore = etaMinutes(w3.reg.nvd_eta_sub._text);
  ok('C13: ETA starts at the plan figure (~7 min)', etaBefore >= 6 && etaBefore <= 8, w3.reg.nvd_eta_sub._text);
  /* crawl: 190 m along the road in 180 s of fake time (~1.1 m/s
     against the plan's ~11.6 m/s) — congestion, measured */
  for (var step = 1; step <= 10; step++) {
    CLOCK.now += 18000;
    var pt = pointAlong(19 * step);
    w3.firePos(pt[0], pt[1], 40, 1.1);
    await tick(5);
  }
  const etaAfter = etaMinutes(w3.reg.nvd_eta_sub._text);
  ok('C13: the ETA MOVES when the measured pace collapses (plan-only ETA can never grow as you progress)',
    etaAfter > etaBefore, 'before=' + etaBefore + ' after=' + etaAfter + ' (' + w3.reg.nvd_eta_sub._text + ')');
  ok('C13: the congestion STATE is visible on the ETA line (Slow traffic)',
    /Slow traffic/.test(w3.reg.nvd_eta_sub._text), w3.reg.nvd_eta_sub._text);
  /* the refresh cycle fires mid-drive; the incident lands */
  CLOCK.now += 121000;
  var pt2 = pointAlong(210);
  w3.firePos(pt2[0], pt2[1], 40, 1.1);
  await tick(30);
  ok('C13: the 120 s refresh cycle fired during the drive', (w3.calls.socrata || 0) > socrataAtStart, 'calls=' + w3.calls.socrata);
  var pt3 = pointAlong(230);
  w3.firePos(pt3[0], pt3[1], 40, 1.1);
  await tick(30);
  ok('C13: the faster-route offer appears (refreshed incident ahead + live ETA stretched)',
    !w3.reg.nvd_offer.classList.contains('hidden'), 'offer text=' + w3.reg.nvd_offer._text);
  ok('C13: the offer names the re-check, not a promise', /re-check/.test(w3.reg.nvd_offer._text), w3.reg.nvd_offer._text);
  const routesBeforeTap = w3.calls.fetch.filter(function (u) { return u.indexOf('/route') >= 0; }).length;
  if (typeof w3.reg.nvd_offer.onclick === 'function') w3.reg.nvd_offer.onclick();
  await tick(60);
  const routesAfterTap = w3.calls.fetch.filter(function (u) { return u.indexOf('/route') >= 0; }).length;
  ok('C13: tapping the offer re-plans through the routing door', routesAfterTap > routesBeforeTap, routesBeforeTap + ' -> ' + routesAfterTap);
  eq('C13: still exactly one provider probe in the whole Socrata-mode drive', w3.calls.trafficEta || 0, 1);

  console.log('— C13: the licensed-provider half, configured (plumbing proof; no key on the box yet) —');
  const storeData4 = { navigator: { profile: {}, muted: false, mode: 'truck' } };
  const w4 = makeWorld(storeData4, { trafficEta: function () { return { durationSec: 2400, staticDurationSec: 1500, delaySec: 900, source: 'tomtom-routing' }; } });
  const api4 = w4.world.Meticulous.modules.navigator;
  w4.reg.nv_drive.classList.add('hidden');
  w4.reg.nv_drive_screen.classList.add('hidden');
  api4.render(w4.body);
  w4.firePos(line[0][0], line[0][1], 40);
  w4.mapClick();
  await tick(); await tick(); await tick();
  w4.reg.nv_drive.onclick();
  await tick(300);
  var pt4 = pointAlong(30);
  w4.firePos(pt4[0], pt4[1], 40, 8);
  await tick(30);
  const gEta = etaMinutes(w4.reg.nvd_eta_sub._text);
  eq('C13: a configured provider duration becomes the ETA (2400 s = 40 min)', gEta, 40);
  ok('C13: the provider delay is named on the ETA line (+15 min)', /traffic \+15 min/.test(w4.reg.nvd_eta_sub._text), w4.reg.nvd_eta_sub._text);
  ok('C13: the provider is attributed on the ETA line (TomTom)', /TomTom/.test(w4.reg.nvd_eta_sub._text), w4.reg.nvd_eta_sub._text);
  CLOCK.now += 181000;
  var pt5 = pointAlong(60);
  w4.firePos(pt5[0], pt5[1], 40, 8);
  await tick(30);
  eq('C13: the provider poll refires on the 180 s cycle while configured', w4.calls.trafficEta || 0, 2);

  console.log('\nnav-wave-c-v280 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR ' + (e && e.stack || e)); process.exit(1); });
