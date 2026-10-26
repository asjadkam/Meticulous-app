#!/usr/bin/env node
/* navigator-v139-test.js — v139 "DRIVE IMAGE BREAKING: THE
 * ARCHITECTURE, NOT ANOTHER LAYER" (owner, Oct 17, 2026 12:48 MDT:
 * "This image breaking is getting worst on every build! fix it").
 *
 * THE EVIDENCE (his ~74 s screen recording on v135, read
 * frame-by-frame; findings in ~/memory/2026-10-17.md): brief
 * PERFECT frames over an unchanged DOM alternate with —
 *   • the navy banner painted displaced ~+40% right / −6% up,
 *     half off-screen ("on 2/Deerfoot Trail" only);
 *   • the ETA bar displaced by the SAME vector (left half gone);
 *   • grey unloaded tile wedges sweeping the plane, the blue
 *     route line reduced to stubs;
 *   • at ~55 s, bar AND docked mic gone entirely.
 * Identical displacement of two independent sibling layers over
 * an unchanged DOM is not layout and not writes (v133 already
 * made the writes write-on-change, and its meters still pass):
 * it is the WebView compositor misplacing and dropping layers
 * under load. The load was architectural: a 340%×340% map box
 * (≈11.6 viewport areas, ≈24M device px) inside a static tilt
 * layer inside a perspective parent, its spin layer a permanent
 * will-change promotion with a .45s transition — and the marker
 * sitting INSIDE that perspective context, the chrome promoted
 * into layers of its own in the same starved context. Five
 * builds patched layers around that structure (v124–v135);
 * the breaking got worse every time, as the owner said.
 *
 * THE v139 STRUCTURE (what this suite pins):
 *   1. ONE transformed element on the whole drive screen:
 *      .nv-drive-plane, 190% × 190% of the viewport (≈3.2× less
 *      raster than 340%), centred on the anchor by its offsets,
 *      carrying the Leaflet map as its only child. The drive
 *      tick writes its ONE composed transform —
 *      perspective(1100px) rotateX(45deg) rotate(−heading) —
 *      only on a ≥2° heading change (the v128 deadband). No
 *      transition, no will-change, no backface-visibility, no
 *      preserve-3d, no perspective PROPERTY anywhere on the
 *      screen. The tilt is 45° (was 52°): at bounded size the
 *      steeper pitch outruns the plane on tall phones; stability
 *      won the last 7°, said plainly in BUGS.md.
 *   2. THE CHROME CANNOT SHEAR: banner, ETA bar, marker,
 *      chooser, reroute pill and the docked mic are plain
 *      absolutely-positioned boxes — direct children of the
 *      .nv-drive root (marker/chooser/pill moved OUT of the
 *      viewport element) — with NO transform of any kind:
 *      centring is done with negative margins (marker, from
 *      AVATAR_BOX), auto margins (chooser/pill) and arithmetic
 *      (the dock: top:calc(50% − 26px)). A box with no transform
 *      and no layer promotion paints where it is laid out;
 *      there is no second position for the compositor to pick.
 *   3. THE LAYER BUDGET IS AN ASSERTED LIST: across every
 *      drive-screen rule (selectors matching .nv-drive,
 *      .nv-avatar, or the body.mt-driving dock) the ONLY
 *      transform-related declaration allowed is the plane's
 *      transform-origin. Everything else — transform,
 *      will-change, translateZ, preserve-3d, backface-visibility
 *      — is asserted ABSENT.
 *
 * RIDING ALONG (same road test):
 *   4. THE MUTE BUTTON (owner 12:42: 'Instead of saying sound
 *      on and off! It should give an option to mute!'): the
 *      drive bar's text toggle is now a speaker-icon button —
 *      waves when live; × + orange slash + warning tint when
 *      muted; state unmistakable at a glance; aria-pressed
 *      carried. The state is the same settings.muted as ever:
 *      it persisted across drives before, it persists now; the
 *      planning card keeps its text toggle on the same setting;
 *      speak() still gates on it; the paint is write-on-change.
 *   5. THE TRUCK ART (owner 12:46: 'better 3d image of a truck!
 *      Still cartoonish but should have allot more details then
 *      a 2d image slapped on'): every chooser kind is redrawn
 *      dimensional — gradient-shaded cab with glass, mirrors,
 *      bumper, lights and a roof beacon; steel dump box with a
 *      recessed bed and ribs / corrugated semi trailer / pickup
 *      bed; wheels with tyres AND hubs; the ground shadow baked
 *      into the art (the marker's drop-shadow FILTER is gone).
 *      Gradient ids are unique per kind AND per instance. The
 *      chooser, the tap-to-change and the persistence are
 *      unchanged; the tick still never touches the marker.
 *
 * THE HONEST LIMIT (also in BUGS.md): this suite pins the
 * structure and the write behaviour in a DOM harness. The
 * compositor that tore the frames is the owner's WebView GPU —
 * it cannot run here. On-glass stability is proven only by the
 * owner's next drive recording.
 *
 * Run: node tools/navigator-v139-test.js
 */
'use strict';
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
const cssRaw = read('css/style.css');
const cssSrc = cssRaw.replace(/\/\*[\s\S]*?\*\//g, ''); /* rules only — comments carry the history, not pins */
const fixture = JSON.parse(read('tools/navigator-fixture-tripb.json'));
const ORIGIN = [51.0955, -114.099], DEST = [51.1075, -114.0845];

/* All CSS rules belonging to the drive screen: any selector
   mentioning .nv-drive / .nv-avatar, plus the drive-dock rules. */
function driveRules(css) {
  const out = [];
  const re = /([^{}]+)\{([^}]*)\}/g; let m;
  while ((m = re.exec(css))) {
    const sel = m[1].trim();
    if (sel.indexOf('.nv-drive') >= 0 || sel.indexOf('.nv-avatar') >= 0 ||
        sel.indexOf('mt-driving') >= 0 || sel.indexOf('.nv-mute') >= 0) {
      out.push({ sel: sel, body: m[2] });
    }
  }
  return out;
}
const rules = driveRules(cssSrc);
function ruleBody(selPart) {
  const r = rules.filter(function (x) { return x.sel.indexOf(selPart) >= 0; })[0];
  return r ? r.body : null;
}
const TRANSFORM_DECL = /(^|[;{])\s*transform\s*:/;

console.log('— 1. ONE transformed element: the bounded plane —');
{
  check('the tilt/spin/mapbox layers are GONE from the CSS (no rules remain)',
    !/\.nv-drive-(tilt|spin|mapbox)\s*\{/.test(cssSrc));
  check('the tilt/spin/mapbox elements are GONE from the markup (navigator.js builds none)',
    navSrc.indexOf('nv-drive-tilt') < 0 && navSrc.indexOf('nv-drive-spin') < 0 &&
    navSrc.indexOf('nv-drive-mapbox') < 0 && navSrc.indexOf('nvd_spin') < 0);
  const plane = ruleBody('.nv-drive-plane');
  check('the plane is bounded: 260% x 300%, centred on the anchor by its offsets (left:-80% = 50 - 260/2, top:-86% = 64 - 300/2) — v220 re-pin: the plane grew TALLER for far-field/top coverage (NAV-CUTOFF-REPEAT); width unchanged from the v178 re-pin (A1). v260 re-pin (NAV-TOP-CUTOFF): width grew 230% -> 260% for the raster the translate-compensated reach samples on the owner\'s 768x1024 drive screen; centre unmoved',
    !!plane && /width:260%/.test(plane) && /height:300%/.test(plane) &&
    /left:-80%/.test(plane) && /top:-86%/.test(plane) && /transform-origin:50% 50%/.test(plane),
    String(plane));
  const sizePct = 260; /* v178 re-pin (A1): plane grew 190 -> 230 for corner coverage; v260: -> 260, budget claim re-based below */
  check('the raster budget: the plane area stays a bounded fraction of the v135 340% plane — v178 re-pin: A1 corner coverage bought with a bounded raster increase. v220: (230x300)/(340x340) = 0.60 of the v135 raster. v260 re-pin: (260x300)/(340x340) = 0.67 — still a third cheaper than the v135 raster, a bounded, deliberate trade for a map that reaches the top of the glass on the owner\'s real screen (768x1024, 50° posture, translate-compensated)',
    Math.pow(sizePct / 340, 2) < 0.6 && (260 * 300) / (340 * 340) < 0.7, String(Math.pow(sizePct / 340, 2)));
  check('340% exists nowhere in the drive CSS any more',
    !rules.some(function (r) { return r.body.indexOf('340%') >= 0; }));
  check('the viewport is a plain overflow-hidden box: NO perspective property, NO transform',
    (function () { const v = ruleBody('.nv-drive-viewport'); return !!v && !/perspective/.test(v) && !TRANSFORM_DECL.test(v); })());
  const flatNav = navSrc.replace(/'\s*\+\s*'/g, '');
  check('the viewport contains the plane and ONLY the plane (the map inside it) — marker/chooser/pill live outside',
    flatNav.indexOf('<div class="nv-drive-viewport"><div class="nv-drive-plane" id="nvd_plane"><div id="nv_drive_map" class="nv-drive-map"></div></div></div>') >= 0 &&
    flatNav.indexOf('id="nvd_you"') > flatNav.indexOf('nv-drive-viewport') &&
    flatNav.indexOf('id="nvd_reroute"') > flatNav.indexOf('nv-drive-viewport'));
  check('navigator.js has exactly ONE style.transform writer (the plane\'s), and it writes the composed transform',
    (navSrc.match(/\.style\.transform\s*=/g) || []).length === 1 &&
    /plane\.style\.transform = planeTransform\(hdg\)/.test(navSrc) &&
    navSrc.indexOf("'perspective(1100px) rotateX(45deg) rotate('") >= 0,
    String((navSrc.match(/\.style\.transform\s*=/g) || []).length));
  check('the tick\'s plane write keeps the v128 gate: >=2 degrees via angDeltaDeg, applied-heading recorded',
    /angDeltaDeg\(S\.heading, S\.drive\.headingApplied\) >= 2/.test(navSrc) &&
    /S\.drive\.headingApplied = hdg/.test(navSrc));
}

console.log('— 2. the chrome cannot shear: no transforms, no promotions —');
{
  const offenders = rules.filter(function (r) {
    return /will-change|translateZ|preserve-3d|backface-visibility/.test(r.body);
  });
  check('LAYER BUDGET: zero will-change / translateZ / preserve-3d / backface-visibility in EVERY drive-screen rule',
    offenders.length === 0, offenders.map(function (r) { return r.sel; }).join(', '));
  const transformed = rules.filter(function (r) {
    return r.sel.indexOf('.nv-drive-plane') < 0 && TRANSFORM_DECL.test(r.body);
  });
  check('LAYER BUDGET: the ONLY transform declaration on the drive screen is the plane\'s transform-origin — no rule but the plane\'s declares any transform',
    transformed.length === 0 &&
    rules.every(function (r) { return r.sel.indexOf('.nv-drive-plane') >= 0 || !/transform/.test(r.body); }),
    transformed.map(function (r) { return r.sel; }).join(', '));
  ['.nv-drive-top', '.nv-drive-bar', '.nv-drive-you', '.nv-avatar-picker', '.nv-drive-reroute'].forEach(function (sel) {
    const b = ruleBody(sel);
    check('chrome rule ' + sel + ' is plain: no transform, no will-change, no transition',
      !!b && !/transform|will-change|transition/.test(b), String(b));
  });
  const dock = ruleBody('body.mt-driving #chatFab');
  check('the docked mic: centred by arithmetic (top:calc(50% - 26px)), NO transform',
    !!dock && /top:calc\(50% - 26px\)/.test(dock) && !/transform/.test(dock), String(dock));
  check('the marker is margin-centred by construction: .nv-drive-you holds the anchor (left:50%, top:64%) and NO width — the box comes from AVATAR_BOX in JS',
    (function () { const b = ruleBody('.nv-drive-you'); return !!b && /left:50%/.test(b) && /top:64%/.test(b) && !/width:/.test(b); })());
  check('the marker\'s drop-shadow FILTER is gone (the shadow is baked into the art)',
    !rules.some(function (r) { return /filter:/.test(r.body); }));
  check('chooser + reroute pill centre by auto margins (left:0;right:0;margin auto), not translateX',
    (function () {
      const p = ruleBody('.nv-avatar-picker'), r = ruleBody('.nv-drive-reroute');
      return !!p && !!r && /margin-left:auto/.test(p) && /margin-left:auto/.test(r);
    })());
}

console.log('— 3. the mute button (static) —');
{
  check('the drive bar markup builds the mute button from muteIcon() with aria-pressed from the persisted setting',
    navSrc.indexOf('id="nvd_mute"') >= 0 && navSrc.indexOf('muteIcon(settings.muted)') >= 0 &&
    navSrc.indexOf("aria-pressed") >= 0 && navSrc.indexOf('nv-mute') >= 0);
  check('no "Sound: on/off" TEXT is painted on the drive face any more (the drive button is an icon)',
    !/id="nvd_mute">[^<]*Sound/.test(navSrc) && navSrc.indexOf("driveText(body.querySelector('#nvd_mute')") < 0);
  check('the planning card KEEPS its text toggle on the same setting (driveText mutePlan, same label)',
    navSrc.indexOf("driveText(body.querySelector('#nv_mute'), 'mutePlan', label)") >= 0 &&
    navSrc.indexOf("settings.muted ? '🔇 Sound: off' : '🔊 Sound: on'") >= 0);
  check('the muted state has a glanceable CSS voice: the .muted rule tints the button (colour only — no opacity)',
    (function () { const b = ruleBody('#nvd_mute.muted'); return !!b && /background:/.test(b) && !/opacity/.test(b); })());
  check('the voice gate + persistence are untouched: speak() still honours settings.muted; toggleMute still saves it',
    /if \(!text \|\| !S \|\| S\.settings\.muted\) return;/.test(navSrc) &&
    /saveSettings\(\{ muted: S\.settings\.muted \}\)/.test(navSrc));
  check('the mute paint is write-on-change (S.mutePainted guard) and driveTick never touches the mute button',
    /S\.mutePainted !== S\.settings\.muted/.test(navSrc) &&
    (function () {
      const t = navSrc.slice(navSrc.indexOf('function driveTick()'), navSrc.indexOf('function driveArrived()'));
      return t.indexOf('paintMute') < 0 && t.indexOf('nvd_mute') < 0;
    })());
}

console.log('— 4. the truck art (static) —');
{
  /* v141 PIN MOVES (this section): the v139 art was inline SVG —
     gradients, two-tone wheel painter, per-slot gradient ids.
     The owner rejected that art too (Oct 17, 13:35 MDT: "Still
     horrendous! When I said realistic is this it?"), so v141
     ships rendered PNG assets for the vehicle kinds; the full
     raster pins live in tools/navigator-v141-test.js. What
     remains here: the box table (new, bigger sizes), the asset
     wiring, and the arrow — the one kind that is still drawn. */
  check('AVATAR_BOX carries a per-kind box for all four kinds (v141: bigger boxes for the renders; v175: chase-view boxes)',
    /AVATAR_BOX = \{ dump: \[92, 132\], semi: \[92, 144\], pickup: \[92, 118\], arrow: \[54, 72\] \}/.test(navSrc));
  check('v141: the vehicle kinds are rendered assets (AVATAR_ASSET -> assets/avatar-<kind>.png), painted as <img>',
    navSrc.indexOf("dump: 'assets/avatar-dump.png'") >= 0 &&
    navSrc.indexOf("semi: 'assets/avatar-semi.png'") >= 0 &&
    navSrc.indexOf("pickup: 'assets/avatar-pickup.png'") >= 0 &&
    navSrc.indexOf('class="nv-avatar-img"') >= 0);
  check('v141: the arrow keeps its drawn chevron (gradient + baked shadow ellipse) — the only SVG glyph left',
    navSrc.indexOf('<linearGradient id="ar') >= 0 && navSrc.indexOf('<ellipse') >= 0 &&
    navSrc.indexOf('opacity=".20"') >= 0);
  check('the glyph painters are called for the marker AND the picker (wiring unchanged)',
    navSrc.indexOf("avatarGlyph(settings.avatar, 'm')") >= 0 && navSrc.indexOf("avatarGlyph(k, 'p')") >= 0);
  check('the render sizes the marker inline from AVATAR_BOX (avatarBoxStyle: negative half-box margins) — centred before any JS runs',
    navSrc.indexOf('avatarBoxStyle(settings.avatar)') >= 0 &&
    navSrc.indexOf("margin-left:' + (-b[0] / 2)") >= 0 &&
    navSrc.indexOf("margin-top:' + (-b[1] / 2)") >= 0);
}

/* ---------- instrumented DOM (the v133 harness pattern) ---------- */
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
  /* The plane's style.transform is an instrumented accessor:
     every write is counted, so the deadband is measured, not
     assumed. */
  const planeMeter = { sets: 0, val: '' };
  const pStyle = {};
  Object.defineProperty(pStyle, 'transform', {
    configurable: true,
    get: function () { return planeMeter.val; },
    set: function (v) { planeMeter.sets++; planeMeter.val = String(v); }
  });
  reg.nvd_plane.style = pStyle;
  /* Avatar chooser options, as the module's wiring expects. */
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
    planeMeter: planeMeter, avOpts: avOpts, storeData: storeData,
    firePos: function (la, lo, hd, sp) { geoCb({ coords: { latitude: la, longitude: lo, heading: hd, speed: sp } }); } };
}
function tick() { return new Promise(function (r) { setTimeout(r, 10); }); }
function extract(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}
const COMPOSED = function (h) { return 'perspective(1100px) rotateX(45deg) rotate(' + (-h) + 'deg)'; };

(async function () {
  console.log('— 5. behaviour: the plane on a real drive —');
  const storeData = { navigator: { serverUrl: 'http://nav.test', profile: {}, muted: false, mode: 'truck' } };
  const w = makeWorld(storeData);
  const api = w.world.Meticulous.modules.navigator;
  w.reg.nv_drive.classList.add('hidden');
  w.reg.nv_drive_screen.classList.add('hidden');
  w.reg.nvd_reroute.classList.add('hidden');
  w.reg.nvd_avatar_picker.classList.add('hidden');
  api.render(w.body);

  /* v141 PIN MOVE: box 54x84 -> 62x118; the glyph signature was
     the v139 steel-box gradient id (bxdumpm) — v141's glyph is
     the rendered dump asset. */
  check('the render paints the marker sized + margin-centred from AVATAR_BOX (dump 92x132, -46/-66; v175 pin move from 62x118, -31/-59)',
    w.body._html.indexOf('width:92px;height:132px;margin-left:-46px;margin-top:-66px') >= 0 &&
    w.body._html.indexOf('assets/avatar-dump.png') >= 0);
  check('the render paints the UNMUTED icon button (speaker + waves, aria-pressed=false, no text label)',
    /id="nvd_mute" aria-pressed="false"/.test(w.body._html) &&
    w.body._html.indexOf('M15.5 8.5') >= 0 && !/id="nvd_mute"[^>]*>🔊/.test(w.body._html));

  w.firePos(ORIGIN[0], ORIGIN[1], 40);
  w.mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } });
  await tick(); await tick();
  w.reg.nv_drive.onclick();
  check('drive screen opened', !w.reg.nv_drive_screen.classList.contains('hidden'));
  await new Promise(function (r) { setTimeout(r, 220); }); /* settle passes land */

  check('the plane is painted from drive open (composed transform at the current heading 40) — never a flat map',
    w.planeMeter.val === COMPOSED(40), w.planeMeter.val);
  const setsAtOpen = w.planeMeter.sets;

  const sb = { console };
  vm.createContext(sb);
  vm.runInContext(extract(navSrc, 'NAVPURE-BEGIN', 'NAVPURE-END'), sb);
  const line = sb.decodeShape(fixture.trip.legs[0].shape);
  const ptAt = function (f) { return line[Math.floor(line.length * f)]; };

  const p1 = ptAt(0.10); w.firePos(p1[0], p1[1], 90);
  check('a real turn writes the composed transform ONCE (rotate(-90deg) inside perspective + 45deg pitch)',
    w.planeMeter.val === COMPOSED(90) && w.planeMeter.sets === setsAtOpen + 1,
    w.planeMeter.val + ' sets=' + w.planeMeter.sets);
  const p2 = ptAt(0.14); w.firePos(p2[0], p2[1], 91);
  check('1 degree of jitter writes NOTHING (the 2 degree deadband holds on the plane)',
    w.planeMeter.sets === setsAtOpen + 1 && w.planeMeter.val === COMPOSED(90));
  const p3 = ptAt(0.18); w.firePos(p3[0], p3[1], 96);
  check('a 6 degree turn writes again, still the one composed string',
    w.planeMeter.val === COMPOSED(96) && w.planeMeter.sets === setsAtOpen + 2);

  const youSets = w.reg.nvd_you._htmlSets;
  for (let s = 0; s < 10; s++) { const p = ptAt(0.2 + s * 0.03); w.firePos(p[0], p[1], 96); }
  check('ten more ticks never repaint the marker (the tick still never touches #nvd_you)',
    w.reg.nvd_you._htmlSets === youSets, w.reg.nvd_you._htmlSets + ' vs ' + youSets);

  console.log('— 6. behaviour: the mute button —');
  check('startDrive painted the live icon into the drive button (speaker + waves, not text)',
    w.reg.nvd_mute._html.indexOf('<svg') >= 0 && w.reg.nvd_mute._html.indexOf('M15.5 8.5') >= 0 &&
    w.reg.nvd_mute._html.indexOf('Sound') < 0, w.reg.nvd_mute._html.slice(0, 60));
  check('the button starts un-muted: no .muted class, aria-pressed=false',
    !w.reg.nvd_mute.classList.contains('muted') && w.reg.nvd_mute._attrs['aria-pressed'] === 'false',
    JSON.stringify(w.reg.nvd_mute._attrs));
  w.reg.nvd_mute.onclick();
  check('one tap mutes: the setting persists to the navigator store',
    storeData.navigator.muted === true, JSON.stringify(storeData.navigator));
  check('the muted paint is unmistakable: X + orange slash in the icon, .muted tint class, aria-pressed=true',
    w.reg.nvd_mute._html.indexOf('#f26522') >= 0 && w.reg.nvd_mute._html.indexOf('x1="16"') >= 0 &&
    w.reg.nvd_mute.classList.contains('muted') && w.reg.nvd_mute._attrs['aria-pressed'] === 'true');
  check('the planning face stays a text toggle on the same setting (now reads Sound: off)',
    w.reg.nv_mute.textContent === '🔇 Sound: off', w.reg.nv_mute.textContent);
  const spokenAtMute = w.calls.spoken.length;
  const p4 = ptAt(0.55); w.firePos(p4[0], p4[1], 96);
  check('muted means silent: driving on produces no new speech',
    w.calls.spoken.length === spokenAtMute, w.calls.spoken.length + ' vs ' + spokenAtMute);
  w.reg.nvd_mute.onclick();
  check('a second tap un-mutes and persists (and the waves return)',
    storeData.navigator.muted === false && w.reg.nvd_mute._html.indexOf('M15.5 8.5') >= 0 &&
    !w.reg.nvd_mute.classList.contains('muted'));

  console.log('— 7. behaviour: the truck chooser —');
  w.reg.nvd_you.onclick();
  check('tapping the marker opens the chooser', !w.reg.nvd_avatar_picker.classList.contains('hidden'));
  w.avOpts[1].onclick(); /* semi */
  check('the choice persists through the navigator settings store',
    storeData.navigator.avatar === 'semi', JSON.stringify(storeData.navigator));
  /* v141 PIN MOVE: the semi's signature was its corrugated-
     trailer gradient id (trsemim) — now the semi render asset;
     the box follows the v141 table. */
  check('the glyph swaps AT THE TAP to the semi (its render asset painted)',
    w.reg.nvd_you._html.indexOf('assets/avatar-semi.png') >= 0, w.reg.nvd_you._html.slice(0, 60));
  check('the marker box follows the kind: semi 92x144, margins -46/-72 (plain styles, no transform; v175 pin move from 62x136, -31/-68)',
    w.reg.nvd_you.style.width === '92px' && w.reg.nvd_you.style.height === '144px' &&
    w.reg.nvd_you.style.marginLeft === '-46px' && w.reg.nvd_you.style.marginTop === '-72px',
    JSON.stringify(w.reg.nvd_you.style));
  check('the chooser closes on the choice and marks semi selected',
    w.reg.nvd_avatar_picker.classList.contains('hidden') && w.avOpts[1].classList.contains('on') &&
    !w.avOpts[0].classList.contains('on'));
  /* v141 PIN MOVE: the old check counted eight per-kind/per-slot
     gradient ids on the face. The vehicles are rasters now — the
     drawn arrow is the only gradient left, and it still
     namespaces its id per slot (picker instance painted here;
     the marker slot is pinned in navigator-v141-test). */
  check('v141: the drawn arrow still namespaces its gradient per slot (picker instance on the face)',
    w.body._html.indexOf('id="ararrowp"') >= 0 &&
    navSrc.indexOf("'arrow' + (slot === 'p' ? 'p' : 'm')") >= 0);
  api.teardown();

  console.log('— 8. behaviour: the persisted states paint correctly on a fresh render —');
  const store2 = { navigator: { serverUrl: 'http://nav.test', profile: {}, muted: true, mode: 'truck', avatar: 'semi' } };
  const w2 = makeWorld(store2);
  const api2 = w2.world.Meticulous.modules.navigator;
  api2.render(w2.body);
  check('a muted driver reopens muted: the render paints the slashed icon + .muted class + aria-pressed=true',
    /id="nvd_mute" aria-pressed="true"/.test(w2.body._html) && w2.body._html.indexOf('nv-mute muted') >= 0 &&
    w2.body._html.indexOf('#f26522') >= 0);
  /* v141 PIN MOVE: semi signature trsemim -> the render asset;
     box 54x92 -> 62x136. */
  check('the persisted avatar paints in the markup, sized from its box (semi 92x144, -46/-72; v175 pin move)',
    w2.body._html.indexOf('assets/avatar-semi.png') >= 0 &&
    w2.body._html.indexOf('width:92px;height:144px;margin-left:-46px;margin-top:-72px') >= 0);
  api2.teardown();

  console.log('\nnavigator-v139: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
