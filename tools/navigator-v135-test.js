#!/usr/bin/env node
/* v139 SUPERSESSION NOTE (Oct 17, 2026): three pins in this file
 * were deliberately moved by v139 and are cited at their checks —
 * K1 (the dock's translateY(-50%) → arithmetic centring, NO
 * transform), K6 (the marker's CSS width/translate centring →
 * AVATAR_BOX margins), and G2/G7/G9 (glyph signatures keyed on
 * the redrawn dimensional art). Everything else in this suite —
 * no U-turns, arrival honesty, the dock's behaviour, the wake
 * lock, K7/K8/K9's opacity/transition discipline — binds v139
 * unchanged. See BUGS.md v139. */
/* navigator-v135-test.js — v135 "DRIVE: TRUCK TRUTH" (owner field
 * notes, Oct 17, 2026 12:05–12:11 MDT, from the recorded Ivor
 * East Pond trips; evidence:
 * hidden_files/east-ivor-drive-recording-evidence.md).
 *
 * Four guarantees, each pinned against the REAL shipped code:
 *
 *  1. NO U-TURNS, EVER (truck mode). The evidence is verbatim:
 *     the banner — and the voice, sound was on — instructed
 *     "Make a left U-turn to stay on Bow Bottom Trail SE."
 *     (750 m → 30 m), then the same on Canyon Meadows Drive SE.
 *     This suite drives the REAL doRoute (initial route AND the
 *     off-route reroute path) against fixture Valhalla responses
 *     carrying type-12 U-turn maneuvers and asserts the
 *     presented maneuver sequence — steps list, banner, and
 *     every SPOKEN line — contains zero U-turns: the route is
 *     re-requested with the turn-around points excluded, and if
 *     every answer still carries one, the plan is rewritten to
 *     the plain continuation before anything can present it.
 *     Car mode keeps the engine's own words (a car can turn).
 *
 *  2. THE AVATAR IS A TRUCK, tappable to change: default dump
 *     truck glyph in the drive markup (not the 30px ▲), a tap
 *     opens the chooser, a choice applies at the tap and
 *     persists through the navigator settings store, and the
 *     drive tick never repaints the marker (v133 stands).
 *
 *  3. THE MIC DOCKS TO THE SIDE: the REAL js/chatbot.js buildUi
 *     runs in a fake DOM and the exact body-class sequence the
 *     owner's phone produces (main active → mt-driving added →
 *     mt-driving removed) is replayed through the mutation
 *     observers — the FAB must be visible + drive-dock tagged
 *     while Drive is open (even if #main drops 'active' under
 *     it), and back to its ordinary rule when Drive closes.
 *     CSS pins put the dock on the screen's right edge, above
 *     the drive screen, with no display:none anywhere near it.
 *     (Why v125 failed is pinned too: its only rule hid #fbFab,
 *     the feedback button — #chatFab was never governed.)
 *
 *  4. FADING: static pins prove the Drive face carries NO
 *     opacity transition/animation/keyframes (the only opacity
 *     on drive chrome is the explicit steady-state opacity:1),
 *     the drive tile layer runs fadeAnimation:false, and the
 *     drive wake lock is requested on startDrive, re-requested
 *     on foreground return, and released on exit/teardown —
 *     the OS screen-dim is the one fade the app can govern,
 *     and now it does.
 *
 *  5. ARRIVAL IS AN ALONG-ROUTE FACT (new defect from the
 *     11:44–11:56 recording): "You have arrived" fired with the
 *     bar still reading "2.4 km left" because the trigger was
 *     straight-line distance to the pin (< 40 m) — the pond pin
 *     sits just off Deerfoot Trail, so passing it on the
 *     highway ended the drive ~2.4 km early. Pinned with a
 *     synthetic out-and-back route in the owner's geometry:
 *     puck ON the outbound leg, 28 m straight-line from the
 *     pin, ~2.5 km of route remaining → arrival must NOT fire;
 *     at the genuine end of the line it must.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };
const navSrc = read('modules/navigator.js');
const chatSrc = read('js/chatbot.js');
const cssSrc = read('css/style.css');
const fixture = JSON.parse(read('tools/navigator-fixture-tripb.json'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}
function extract(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 10); }); }
const UTURN = /u[\s\-]?turn/i;

/* ---------- instrumented element stub (v133 pattern) ---------- */
function el() {
  const e = {
    children: {}, style: {}, _html: '', _htmlSets: 0, value: '', onclick: null,
    _text: '', _sets: 0, _sameSets: 0, _emptySets: 0, _listeners: {},
    addEventListener: function (ev, fn) { (e._listeners[ev] = e._listeners[ev] || []).push(fn); },
    removeEventListener: function () {},
    fire: function (ev) { (e._listeners[ev] || []).slice().forEach(function (f) { f(); }); },
    classList: {
      _s: new Set(),
      add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); },
      toggle: function (c, on) { if (on === undefined) on = !this._s.has(c); on ? this._s.add(c) : this._s.delete(c); },
      contains: function (c) { return this._s.has(c); }
    },
    querySelector: function (sel) { return e.children[sel] || null; },
    querySelectorAll: function () { return []; },
    getAttribute: function () { return null; },
    setAttribute: function () {},
    appendChild: function () {},
    focus: function () {},
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
    get: function () { return e._html; },
    set: function (v) { e._htmlSets++; e._html = String(v); }
  });
  Object.defineProperty(e, 'className', {
    configurable: true,
    get: function () { return Array.from(e.classList._s).join(' '); },
    set: function (v) {
      e.classList._s = new Set(String(v).split(/\s+/).filter(Boolean));
    }
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
  e.pick = function (pid) { const r = e._rows[pid]; if (r) r.click(); };
  return e;
}

/* ---------- fixtures ---------- */
/* The REAL Test B trip with maneuver 4 turned into the owner's
   verbatim experience: a type-12 (uturn_right) maneuver whose
   instruction and BOTH spoken lines say "U-turn". */
function uturnFixture() {
  const fx = JSON.parse(JSON.stringify(fixture));
  const m = fx.trip.legs[0].maneuvers[4];
  m.type = 12;
  m.instruction = 'Make a left U-turn to stay on 48 Avenue NW.';
  m.verbal_pre_transition_instruction = 'In 300 metres, make a left U-turn to stay on 48 Avenue NW.';
  m.verbal_post_transition_instruction = 'Make a left U-turn now.';
  m.street_names = ['48 Avenue NW'];
  return fx;
}
function cleanFixture() { return JSON.parse(JSON.stringify(fixture)); }

/* Standard precision-6 polyline encoder — the mirror of the
   module's decodeShape, so the synthetic arrival trip below is
   a real Valhalla-shaped response, not a mock of one. */
function encodeShape(points) {
  let out = '', prevLat = 0, prevLng = 0;
  function enc(v) {
    v = v < 0 ? ~(v << 1) : (v << 1);
    let s = '';
    while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    return s + String.fromCharCode(v + 63);
  }
  points.forEach(function (p) {
    const la = Math.round(p[0] * 1e6), lo = Math.round(p[1] * 1e6);
    out += enc(la - prevLat) + enc(lo - prevLng);
    prevLat = la; prevLng = lo;
  });
  return out;
}

(async function () {
  /* ============ A. NAVPURE: the U-turn layer, pure ============ */
  console.log('— A. NAVPURE: U-turn detection, exclusion geometry, the sanitize net —');
  const sb = { console: console };
  vm.createContext(sb);
  vm.runInContext(extract(navSrc, 'NAVPURE-BEGIN', 'NAVPURE-END'), sb);

  check('A1 a type-12 maneuver IS a U-turn (Valhalla uturn_right)',
    sb.isUturnManeuver({ type: 12, instruction: 'Turn around' }) === true);
  check('A2 a type-13 maneuver IS a U-turn (Valhalla uturn_left)',
    sb.isUturnManeuver({ type: 13, instruction: 'Turn around' }) === true);
  check('A3 an untyped maneuver whose TEXT says U-turn IS one (belt and braces)',
    sb.isUturnManeuver({ type: 8, instruction: 'Make a U-turn onto 48 Avenue NW.' }) === true);
  check('A4 an ordinary left turn is NOT a U-turn',
    sb.isUturnManeuver({ type: 15, instruction: 'Turn left onto Norquay Drive NW.' }) === false);
  check('A5 a U-turn hiding in a VERBAL line only is still caught',
    sb.isUturnManeuver({ type: 10, instruction: 'Turn right.', verbalPost: 'Then make a U-turn.' }) === true);

  const planA = sb.maneuverPlan(uturnFixture().trip);
  check('A6 planUturns finds exactly the planted U-turn',
    JSON.stringify(sb.planUturns(planA)) === '[4]', JSON.stringify(sb.planUturns(planA)));
  check('A7 planUturns on the clean trip finds none',
    sb.planUturns(sb.maneuverPlan(cleanFixture().trip)).length === 0);

  const san = sb.sanitizeTruckPlan(planA);
  check('A8 the sanitizer rewrites the U-turn to the plain continuation on its road',
    san.maneuvers[4].instruction === 'Continue on 48 Avenue NW', san.maneuvers[4].instruction);
  check('A9 the sanitizer leaves NO U-turn text in ANY field of ANY maneuver',
    san.maneuvers.every(function (m) {
      return !UTURN.test(m.instruction || '') && !UTURN.test(m.verbalPre || '') && !UTURN.test(m.verbalPost || '');
    }));
  check('A10 the sanitized maneuver becomes a continue (type 8), distances untouched',
    san.maneuvers[4].type === 8 &&
    san.maneuvers[4].cumStartKm === planA.maneuvers[4].cumStartKm &&
    san.maneuvers[4].cumEndKm === planA.maneuvers[4].cumEndKm &&
    san.maneuvers[4].lengthKm === planA.maneuvers[4].lengthKm &&
    san.totalKm === planA.totalKm && san.totalMin === planA.totalMin);
  check('A11 the sanitizer counts what it removed and does NOT mutate the engine plan',
    san.uturnsRemoved === 1 && planA.maneuvers[4].type === 12 &&
    UTURN.test(planA.maneuvers[4].instruction));
  check('A12 a clean plan passes through the sanitizer with every word intact',
    (function () {
      const c = sb.maneuverPlan(cleanFixture().trip);
      const s2 = sb.sanitizeTruckPlan(c);
      return s2.uturnsRemoved === 0 && s2.maneuvers.every(function (m, i) {
        return m.instruction === c.maneuvers[i].instruction && m.type === c.maneuvers[i].type;
      });
    })());
  /* The owner's verbatim banner line, as a plan of one street: */
  const bowPlan = { totalKm: 3, totalMin: 6, maneuvers: [
    { type: 13, instruction: 'Make a left U-turn to stay on Bow Bottom Trail SE.',
      verbalPre: 'In 500 metres, make a left U-turn to stay on Bow Bottom Trail SE.',
      verbalPost: 'Make a left U-turn.', streets: ['Bow Bottom Trail SE'],
      lengthKm: 0.02, cumStartKm: 0.75, cumEndKm: 0.77 }
  ]};
  const bowSan = sb.sanitizeTruckPlan(bowPlan);
  check('A13 the VERBATIM Bow Bottom Trail U-turn becomes "Continue on Bow Bottom Trail SE"',
    bowSan.maneuvers[0].instruction === 'Continue on Bow Bottom Trail SE' &&
    !UTURN.test(bowSan.maneuvers[0].verbalPre || '') && !UTURN.test(bowSan.maneuvers[0].verbalPost || ''),
    JSON.stringify(bowSan.maneuvers[0]));

  const lineA = sb.decodeShape(fixture.trip.legs[0].shape);
  const totalLineM = (function () {
    let t = 0; for (let i = 0; i + 1 < lineA.length; i++) t += sb.haversineM(lineA[i], lineA[i + 1]);
    return t;
  })();
  check('A14 pointAlongLine(0) is the line start',
    sb.haversineM(sb.pointAlongLine(lineA, 0), lineA[0]) < 1);
  check('A15 pointAlongLine(total) is the line end',
    sb.haversineM(sb.pointAlongLine(lineA, totalLineM + 500), lineA[lineA.length - 1]) < 1);
  const midPt = sb.pointAlongLine(lineA, totalLineM / 2);
  const midPr = sb.distToRouteM(midPt, lineA);
  check('A16 pointAlongLine(half) lies ON the line at half its length',
    midPr.dist < 1 && Math.abs(midPr.along - totalLineM / 2) < 2,
    'dist=' + midPr.dist + ' along=' + midPr.along + ' want≈' + (totalLineM / 2));

  /* ============ the nav world (v133 harness + v135 needs) ============ */
  const RealDate = Date;
  const AV_KINDS = ['dump', 'semi', 'pickup', 'arrow'];
  function makeNavWorld(opts) {
    opts = opts || {};
    const storeData = opts.storeData || {};
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
    const avOpts = AV_KINDS.map(function (k) {
      const o = el(); o._k = k;
      o.getAttribute = function (n) { return n === 'data-avatar' ? k : null; };
      return o;
    });
    reg.nvd_avatar_picker.querySelectorAll = function (sel) { return sel === '[data-avatar]' ? avOpts : []; };
    reg.nvd_avatar_picker.classList.add('hidden');
    reg.nv_drive.classList.add('hidden');
    reg.nv_drive_screen.classList.add('hidden');
    reg.nvd_reroute.classList.add('hidden');

    const container = el();
    container.querySelector = function (sel) { return reg[sel.slice(1)] || null; };
    container.querySelectorAll = function () { return []; };
    /* document.body gets a REAL classList — mt-driving must be
       observable the way the phone produces it. */
    const docBody = el();
    const docListeners = {};
    const wake = { requests: 0, releases: 0 };
    const wakeSentinel = { release: function () { wake.releases++; return Promise.resolve(); } };

    let fakeNow = RealDate.now();
    function FakeDate(ms) { return new RealDate(ms === undefined ? fakeNow : ms); }
    FakeDate.now = function () { return fakeNow; };
    FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC;
    FakeDate.prototype = RealDate.prototype;

    const calls = { fetch: [], spoken: [], views: [], maps: [], groups: [], polylines: [] };
    const mapHandlers = {};
    function makeMapStub() {
      const m = {
        _adds: 0, _removes: 0, _views: [], _panTos: [], _center: null, _zoom: 15,
        setView: function (c, z) { m._views.push([c, z]); m._center = c; if (z) m._zoom = z; return m; },
        panTo: function (c) { m._panTos.push(c); m._center = c; return m; },
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
      marker: function (ll) { return { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return this; }, setLatLng: function () {} }; },
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
      console: console, JSON: JSON, Math: Math, Date: FakeDate,
      setTimeout: setTimeout, clearTimeout: clearTimeout, window: null,
      document: {
        hidden: false, readyState: 'complete', body: docBody,
        addEventListener: function (ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); },
        removeEventListener: function (ev, fn) {
          const a = docListeners[ev] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
        },
        createElement: function () {
          const a = { href: '', style: {}, click: function () {}, remove: function () {} };
          return a;
        }
      },
      open: function () {},
      App: {
        _esc: function (s) { return String(s == null ? '' : s); }, _store: store,
        _today: function () { return '2026-10-17'; }, openModule: function () {}
      },
      Meticulous: {},
      L: L,
      navigator: {
        geolocation: { watchPosition: function (cb) { geoCb = cb; return 7; }, clearWatch: function () {} },
        wakeLock: { request: function () { wake.requests++; return Promise.resolve(wakeSentinel); } }
      },
      speechSynthesis: { cancel: function () {}, speak: function (u) { calls.spoken.push(u.text); } },
      SpeechSynthesisUtterance: function (t) { this.text = t; },
      fetch: function (url, fetchOpts) {
        /* Only /route calls are routing. The map-tap also fires
           a Nominatim reverse-geocode — a bystander: it gets a
           benign empty answer and never touches the queue. */
        if (String(url).indexOf('/route') < 0) {
          return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
        }
        let bodyObj = null;
        try { bodyObj = JSON.parse((fetchOpts && fetchOpts.body) || '{}'); } catch (e) {}
        calls.fetch.push({ url: url, body: bodyObj });
        return opts.fetchHandler(bodyObj, calls.fetch.length);
      }
    };
    world.window = world;
    vm.createContext(world);
    vm.runInContext(navSrc, world);
    return {
      world: world, reg: reg, container: container, docBody: docBody,
      docListeners: docListeners, calls: calls, mapHandlers: mapHandlers,
      storeData: storeData, wake: wake, avOpts: avOpts,
      api: world.Meticulous.modules.navigator,
      firePos: function (la, lo, hd) {
        geoCb({ coords: { latitude: la, longitude: lo, heading: hd === undefined ? 90 : hd, speed: 8 } });
      },
      advance: function (ms) { fakeNow += ms; }
    };
  }
  function respond(fx) {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(fx); } });
  }
  function queueHandler(queue) {
    return function () {
      const item = queue.length > 1 ? queue.shift() : queue[0];
      if (item === 'REJECT') return Promise.reject(new Error('net down'));
      return respond(item);
    };
  }
  const ORIGIN = [51.0955, -114.099], DEST = [51.1075, -114.0845];
  const TRUCK_STORE = { navigator: { serverUrl: 'http://nav.test', profile: {}, muted: false, mode: 'truck' } };
  async function routeWorld(w) {
    w.api.render(w.container);
    w.firePos(ORIGIN[0], ORIGIN[1], 40);
    w.mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } });
    await tick(); await tick(); await tick(); await tick();
  }
  const lineClean = sb.decodeShape(fixture.trip.legs[0].shape);
  function ptAt(f) { return lineClean[Math.floor(lineClean.length * f)]; }
  async function walkLine(w, from, to, steps) {
    for (let s = 0; s <= steps; s++) {
      const p = ptAt(from + (to - from) * (s / steps));
      w.firePos(p[0], p[1], 90);
      await tick(1);
    }
  }

  /* ============ B. initial route: U-turn answer → re-request ============ */
  console.log('— B. initial route: the engine answers with a U-turn —');
  {
    const w = makeNavWorld({ storeData: JSON.parse(JSON.stringify(TRUCK_STORE)),
      fetchHandler: queueHandler([uturnFixture(), cleanFixture()]) });
    await routeWorld(w);
    check('B1 the route took TWO requests (the U-turn answer was not accepted)',
      w.calls.fetch.length === 2, 'fetches=' + w.calls.fetch.length);
    check('B2 the first request asks for TRUCK costing with truck options (not car)',
      w.calls.fetch[0].body.costing === 'truck' && !!w.calls.fetch[0].body.costing_options &&
      !!w.calls.fetch[0].body.costing_options.truck,
      JSON.stringify(w.calls.fetch[0].body.costing));
    check('B3 the first request carries NO exclusions (nothing to exclude yet)',
      !w.calls.fetch[0].body.exclude_locations);
    const ex = (w.calls.fetch[1].body.exclude_locations || []);
    check('B4 the re-request EXCLUDES the turn-around point (exclude_locations × 1)',
      ex.length === 1, JSON.stringify(ex));
    const planU = sb.maneuverPlan(uturnFixture().trip);
    const wantAlong = planU.maneuvers[4].cumStartKm * 1000;
    const exPr = ex.length ? sb.distToRouteM([ex[0].lat, ex[0].lon], lineClean) : { dist: 1e9, along: -1 };
    check('B5 the excluded point lies ON the route at the U-turn maneuver\'s start (±40 m)',
      exPr.dist < 25 && Math.abs(exPr.along - wantAlong) < 40,
      'dist=' + exPr.dist + ' along=' + exPr.along + ' want≈' + wantAlong);
    const stepsHtml = w.reg.nv_steps._html;
    check('B6 the PRESENTED steps contain no U-turn anywhere',
      !UTURN.test(stepsHtml), stepsHtml.slice(0, 200));
    check('B7 the presented steps are the clean route\'s own words',
      stepsHtml.indexOf('Turn right onto 48 Avenue NW.') >= 0);
    /* Drive it: the voice must stay clean too, and the clean
       near-prompt for that segment is what gets spoken. */
    w.reg.nv_drive.onclick();
    await tick(300);
    await walkLine(w, 0.02, 0.95, 40);
    check('B8 across the whole drive, NOTHING spoken contains a U-turn',
      w.calls.spoken.every(function (s) { return !UTURN.test(s); }),
      JSON.stringify(w.calls.spoken.filter(function (s) { return UTURN.test(s); })));
    check('B9 the voice spoke the clean instruction for the once-U-turn segment',
      w.calls.spoken.some(function (s) { return s.indexOf('Turn right onto 48 Avenue NW') >= 0; }),
      JSON.stringify(w.calls.spoken));
    check('B10 the drive banner never showed a U-turn',
      !UTURN.test(w.reg.nvd_inst._text) && !UTURN.test(w.reg.nvd_dist._text),
      w.reg.nvd_inst._text);
    w.api.teardown();
  }

  /* ============ C. every answer has the U-turn → the sanitize net ============ */
  console.log('— C. the engine insists: every answer carries the U-turn —');
  {
    const w = makeNavWorld({ storeData: JSON.parse(JSON.stringify(TRUCK_STORE)),
      fetchHandler: queueHandler([uturnFixture()]) });
    await routeWorld(w);
    check('C1 re-requests are BOUNDED: exactly 5 fetches (1 + 2 exclusion rounds + 2 v260 forward rounds — NAV-NO-UTURN, Oct 26, 2026: this fixture\'s U-turn begins ~696 m in, inside the first 1 km, so once the exclusion rounds are spent the forward layer fires its two via pushes before the sanitize net; the bound moved 3 -> 5 by design, the net below is unchanged)',
      w.calls.fetch.length === 5, 'fetches=' + w.calls.fetch.length);
    check('C2 both re-requests carried exclusions',
      (w.calls.fetch[1].body.exclude_locations || []).length === 1 &&
      (w.calls.fetch[2].body.exclude_locations || []).length === 1);
    const stepsHtml = w.reg.nv_steps._html;
    check('C3 the presented steps still contain NO U-turn (sanitize net)',
      !UTURN.test(stepsHtml), stepsHtml.slice(0, 200));
    check('C4 the presented step for the turn-around reads as the continuation',
      stepsHtml.indexOf('Continue on 48 Avenue NW') >= 0, stepsHtml.slice(0, 300));
    check('C5 no error banner — the driver kept a route',
      w.reg.nv_banner.children['.nv-banner-main']._text !== 'Could not get a route.',
      w.reg.nv_banner.children['.nv-banner-main']._text);
    w.reg.nv_drive.onclick();
    await tick(300);
    await walkLine(w, 0.02, 0.95, 40);
    check('C6 the VOICE never says U-turn on the sanitized plan',
      w.calls.spoken.every(function (s) { return !UTURN.test(s); }),
      JSON.stringify(w.calls.spoken.filter(function (s) { return UTURN.test(s); })));
    check('C7 the voice speaks the continuation for the turn-around segment',
      w.calls.spoken.some(function (s) { return s.indexOf('Continue on 48 Avenue NW') >= 0; }),
      JSON.stringify(w.calls.spoken));
    w.api.teardown();
  }

  /* ============ D. the exclusion round itself fails ============ */
  console.log('— D. the re-request fails outright —');
  {
    const w = makeNavWorld({ storeData: JSON.parse(JSON.stringify(TRUCK_STORE)),
      fetchHandler: queueHandler([uturnFixture(), 'REJECT']) });
    await routeWorld(w);
    check('D1 exactly 2 fetches (the failed round is not retried forever)',
      w.calls.fetch.length === 2, 'fetches=' + w.calls.fetch.length);
    const stepsHtml = w.reg.nv_steps._html;
    check('D2 the driver still gets guidance: the in-hand route, sanitized',
      stepsHtml.indexOf('Continue on 48 Avenue NW') >= 0 && !UTURN.test(stepsHtml),
      stepsHtml.slice(0, 200));
    check('D3 no error banner on the retry-failure fallback',
      w.reg.nv_banner.children['.nv-banner-main']._text !== 'Could not get a route.');
    w.api.teardown();
  }

  /* ============ E. the REROUTE path (off-route recalculation) ============ */
  console.log('— E. reroute: a missed turn must loop the block, not turn around —');
  {
    const w = makeNavWorld({ storeData: JSON.parse(JSON.stringify(TRUCK_STORE)),
      fetchHandler: queueHandler([cleanFixture(), uturnFixture(), cleanFixture()]) });
    await routeWorld(w);
    w.reg.nv_drive.onclick();
    await tick(300);
    check('E1 the clean initial route took exactly 1 fetch', w.calls.fetch.length === 1);
    /* Go off route (>60 m — this point is ~2 km from the line)
       and hold it past the 4 s trigger. */
    const FAR = [51.13, -114.08];
    w.firePos(FAR[0], FAR[1], 90);
    w.advance(5000);
    w.firePos(FAR[0], FAR[1], 90);
    await tick(); await tick(); await tick(); await tick();
    check('E2 the reroute re-requested TWICE more (U-turn answer refused, exclusion round)',
      w.calls.fetch.length === 3, 'fetches=' + w.calls.fetch.length);
    check('E3 the reroute\'s second request carries the exclusion',
      (w.calls.fetch[2].body.exclude_locations || []).length === 1,
      JSON.stringify(w.calls.fetch.map(function (f) { return !!f.body.exclude_locations; })));
    const stepsHtml = w.reg.nv_steps._html;
    check('E4 the rerouted plan presented to the driver has no U-turn',
      !UTURN.test(stepsHtml));
    w.firePos(ptAt(0.5)[0], ptAt(0.5)[1], 90);
    await walkLine(w, 0.5, 0.95, 20);
    check('E5 nothing spoken across the reroute drive contains a U-turn',
      w.calls.spoken.every(function (s) { return !UTURN.test(s); }),
      JSON.stringify(w.calls.spoken.filter(function (s) { return UTURN.test(s); })));
    check('E6 the banner after the reroute is clean',
      !UTURN.test(w.reg.nvd_inst._text), w.reg.nvd_inst._text);
    w.api.teardown();
  }

  /* ============ F. car mode keeps the engine's words ============ */
  console.log('— F. car mode: a car CAN turn around —');
  {
    const carStore = { navigator: { serverUrl: 'http://nav.test', profile: {}, muted: false, mode: 'car' } };
    const w = makeNavWorld({ storeData: carStore, fetchHandler: queueHandler([uturnFixture()]) });
    await routeWorld(w);
    check('F1 car mode takes the first answer (no exclusion rounds)',
      w.calls.fetch.length === 1, 'fetches=' + w.calls.fetch.length);
    check('F2 car mode does not request truck costing',
      w.calls.fetch[0].body.costing !== 'truck', w.calls.fetch[0].body.costing);
    check('F3 the car plan keeps the engine\'s own U-turn instruction',
      w.reg.nv_steps._html.indexOf('U-turn') >= 0);
    w.api.teardown();
  }

  /* ============ G. the avatar: a truck, tappable to change ============ */
  console.log('— G. the avatar —');
  {
    const w = makeNavWorld({ storeData: JSON.parse(JSON.stringify(TRUCK_STORE)),
      fetchHandler: queueHandler([cleanFixture()]) });
    w.api.render(w.container);
    const markup = w.container._html;
    /* v141 PIN MOVE: the glyph is no longer an inline SVG at
       all — v139's dimensional drawing was rejected by the
       owner too (Oct 17, 13:35), so the vehicle kinds ship as
       rendered PNG assets (see navigator-v141-test). */
    check('G1 the drive markup paints a TRUCK avatar (rendered asset), not the old 30px ▲ text',
      markup.indexOf('id="nvd_you"') >= 0 && markup.indexOf('assets/avatar-dump.png') >= 0 && markup.indexOf('>▲<') < 0);
    /* v139 PIN MOVE: was keyed on the flat art's box-outline
       colour (#9db8d9). The dimensional dump glyph's signature
       is its steel-box gradient (id bxdump<slot>).
       v141 PIN MOVE: the signature is the rendered dump asset. */
    check('G2 the default avatar is the DUMP truck (its rendered asset is in the glyph)',
      markup.indexOf('assets/avatar-dump.png') >= 0);
    check('G3 the chooser offers all four kinds with the dump truck selected',
      (markup.match(/data-avatar=/g) || []).length === 4 &&
      /class="nv-avatar-opt on" data-avatar="dump"/.test(markup));
    check('G4 the avatar starts as the settings default',
      w.world.MeticulousNav.loadSettings().avatar === 'dump');
    /* Tap the truck → chooser opens. */
    w.reg.nvd_you.onclick();
    check('G5 tapping the avatar opens the chooser',
      !w.reg.nvd_avatar_picker.classList.contains('hidden'));
    /* Choose the semi → applies at the tap + persists. */
    w.avOpts[1].onclick();
    check('G6 the choice persists through the navigator settings store',
      w.storeData.navigator && w.storeData.navigator.avatar === 'semi',
      JSON.stringify(w.storeData.navigator));
    /* v139 PIN MOVE: was keyed on the flat trailer fill
       (#e8edf5); the dimensional semi's signature is its
       corrugated-trailer gradient (id trsemi<slot>).
       v141 PIN MOVE: the signature is the rendered semi asset. */
    check('G7 the glyph swaps AT THE TAP (semi render now painted)',
      w.reg.nvd_you._html.indexOf('assets/avatar-semi.png') >= 0, w.reg.nvd_you._html.slice(0, 80));
    check('G8 the chooser closes on the choice and marks it selected',
      w.reg.nvd_avatar_picker.classList.contains('hidden') &&
      w.avOpts[1].classList.contains('on') && !w.avOpts[0].classList.contains('on'));
    /* Persistence across a fresh render (the next app open). */
    w.api.teardown();
    w.api.render(w.container);
    check('G9 a fresh render paints the persisted choice (semi in the markup)',
      w.container._html.indexOf('assets/avatar-semi.png') >= 0 &&
      w.world.MeticulousNav.loadSettings().avatar === 'semi');
    /* Mutate-only: the drive tick must never repaint the marker. */
    w.firePos(ORIGIN[0], ORIGIN[1], 40);
    w.mapHandlers.click({ latlng: { lat: DEST[0], lng: DEST[1] } });
    await tick(); await tick(); await tick();
    w.reg.nv_drive.onclick();
    await tick(300);
    w.reg.nvd_you._htmlSets = 0;
    await walkLine(w, 0.02, 0.6, 25);
    check('G10 across 25 drive ticks the avatar node is NEVER repainted (v133 mutate-only stands)',
      w.reg.nvd_you._htmlSets === 0, 'htmlSets=' + w.reg.nvd_you._htmlSets);
    w.api.teardown();
  }

  /* ============ H. fading, part 1: the drive wake lock ============ */
  console.log('— H. the drive wake lock (the OS dim is the app-governable fade) —');
  {
    const w = makeNavWorld({ storeData: JSON.parse(JSON.stringify(TRUCK_STORE)),
      fetchHandler: queueHandler([cleanFixture()]) });
    await routeWorld(w);
    w.reg.nv_drive.onclick();
    await tick(300);
    check('H1 opening Drive requests a screen wake lock',
      w.wake.requests >= 1, 'requests=' + w.wake.requests);
    check('H2 Drive open carries mt-driving on the body',
      w.docBody.classList.contains('mt-driving'));
    const before = w.wake.requests;
    (w.docListeners['visibilitychange'] || []).forEach(function (f) { f(); });
    check('H3 returning to the foreground re-requests the lock (sentinels auto-release on hide)',
      w.wake.requests > before, 'requests=' + w.wake.requests);
    w.reg.nvd_exit.onclick();
    check('H4 exiting Drive releases the wake lock',
      w.wake.releases >= 1, 'releases=' + w.wake.releases);
    check('H5 exiting Drive removes mt-driving',
      !w.docBody.classList.contains('mt-driving'));
    w.api.teardown();

    const w2 = makeNavWorld({ storeData: JSON.parse(JSON.stringify(TRUCK_STORE)),
      fetchHandler: queueHandler([cleanFixture()]) });
    await routeWorld(w2);
    w2.reg.nv_drive.onclick();
    await tick(300);
    w2.api.teardown();
    check('H6 leaving the module mid-drive also releases the lock and the body class',
      w2.wake.releases >= 1 && !w2.docBody.classList.contains('mt-driving'),
      'releases=' + w2.wake.releases);
  }

  /* ============ I. arrival: along-route, never straight-line ============ */
  console.log('— I. premature arrival: the Ivor East Pond geometry —');
  {
    /* Out-and-back: north on Deerfoot, a jog east at the top,
       south on the pond access to the pin — which sits 28 m
       east of the outbound leg. Passing the pin's latitude on
       the highway = 28 m straight-line, ~2.5 km of route left:
       the owner's t=662 s frame, as geometry. */
    const S0 = [51.0000, -114.0000], N0 = [51.0117, -114.0000],
          E0 = [51.0117, -113.9996], D0 = [51.0003, -113.9996];
    const pts = [S0, N0, E0, D0];
    const segKm = [0, 1, 2].map(function (i) { return sb.haversineM(pts[i], pts[i + 1]) / 1000; });
    const totalKm = segKm.reduce(function (a, b) { return a + b; }, 0);
    const synthTrip = { trip: {
      legs: [{ shape: encodeShape(pts), maneuvers: [
        { type: 1, instruction: 'Head north on Deerfoot Trail SE.', length: segKm[0],
          street_names: ['Deerfoot Trail SE'], verbal_pre_transition_instruction: '', verbal_post_transition_instruction: '' },
        { type: 10, instruction: 'Turn right toward the pond access.', length: segKm[1],
          street_names: ['Ivor East Pond Access'], verbal_pre_transition_instruction: '', verbal_post_transition_instruction: '' },
        { type: 8, instruction: 'Continue south on the pond access.', length: segKm[2],
          street_names: ['Ivor East Pond Access'], verbal_pre_transition_instruction: '', verbal_post_transition_instruction: '' },
        { type: 5, instruction: 'Your destination is on the right.', length: 0,
          street_names: [], verbal_pre_transition_instruction: '', verbal_post_transition_instruction: '' }
      ] }],
      summary: { length: totalKm, time: 360 }
    } };
    check('I0 the synthetic shape round-trips through the module decoder',
      (function () {
        const back = sb.decodeShape(encodeShape(pts));
        return back.length === pts.length && back.every(function (p, i) {
          return Math.abs(p[0] - pts[i][0]) < 1e-5 && Math.abs(p[1] - pts[i][1]) < 1e-5;
        });
      })());
    const P = [51.0003, -114.0000]; /* on the outbound leg, 28 m from the pin */
    check('I1 the test geometry is the owner\'s: puck <40 m straight-line from the pin, >2 km of route left',
      sb.haversineM(P, D0) < 40 && (totalKm * 1000 - sb.distToRouteM(P, pts).along) > 2000,
      'dDest=' + sb.haversineM(P, D0) + ' left=' + (totalKm * 1000 - sb.distToRouteM(P, pts).along));

    const w = makeNavWorld({ storeData: JSON.parse(JSON.stringify(TRUCK_STORE)),
      fetchHandler: function () { return respond(synthTrip); } });
    w.api.render(w.container);
    w.firePos(S0[0], S0[1], 0);
    w.mapHandlers.click({ latlng: { lat: D0[0], lng: D0[1] } });
    await tick(); await tick(); await tick();
    w.reg.nv_drive.onclick();
    await tick(300);
    w.firePos(P[0], P[1], 0); w.firePos(P[0], P[1], 0); w.firePos(P[0], P[1], 0);
    check('I2 passing the pin on the highway does NOT fire arrival (banner)',
      w.reg.nv_banner.children['.nv-banner-main']._text !== 'You have arrived',
      w.reg.nv_banner.children['.nv-banner-main']._text);
    check('I3 the drive is still running with distance left on the bar',
      !w.reg.nv_drive_screen.classList.contains('hidden') &&
      w.reg.nvd_eta_sub._text.indexOf('left') >= 0 &&
      w.reg.nvd_inst._text !== 'You have arrived',
      w.reg.nvd_eta_sub._text);
    w.firePos(D0[0], D0[1], 180);
    check('I4 at the genuine end of the route, arrival DOES fire',
      w.reg.nv_banner.children['.nv-banner-main']._text === 'You have arrived' &&
      w.reg.nvd_inst._text === 'You have arrived',
      w.reg.nv_banner.children['.nv-banner-main']._text + ' / ' + w.reg.nvd_inst._text);
    w.api.teardown();
  }

  /* ============ J. the mic dock: the REAL chatbot buildUi ============ */
  console.log('— J. chatbot FAB: the phone\'s body-class sequence, replayed —');
  {
    const main = el();
    const docBody = el();
    const byId = { main: main };
    const observers = [];
    function MutationObserver(cb) { this.cb = cb; this.targets = []; observers.push(this); }
    MutationObserver.prototype.observe = function (t) { this.targets.push(t); };
    MutationObserver.prototype.disconnect = function () {};
    docBody.appendChild = function (child) { if (child.id) byId[child.id] = child; };
    const chatWorld = {
      console: console, JSON: JSON, Math: Math, Date: RealDate,
      setTimeout: setTimeout, clearTimeout: clearTimeout, window: null,
      document: {
        readyState: 'complete', hidden: false, body: docBody,
        getElementById: function (id) { return byId[id] || null; },
        createElement: function () {
          const e = el(); const qs = {};
          e.querySelector = function (sel) { return qs[sel] || (qs[sel] = el()); };
          return e;
        },
        addEventListener: function () {}, removeEventListener: function () {}
      },
      MutationObserver: MutationObserver,
      localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
      App: {
        _esc: function (s) { return String(s == null ? '' : s); },
        _store: { get: function (k, d) { return d; }, set: function () {}, del: function () {} }
      },
      navigator: {},
      speechSynthesis: { cancel: function () {}, speak: function () {} },
      SpeechSynthesisUtterance: function (t) { this.text = t; },
      fetch: function () { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); } }); }
    };
    chatWorld.window = chatWorld;
    vm.createContext(chatWorld);
    vm.runInContext(chatSrc, chatWorld);
    const fab = byId.chatFab;
    function fireObs(target) {
      observers.forEach(function (o) { if (o.targets.indexOf(target) >= 0) o.cb([]); });
    }
    check('J1 the FAB exists and starts hidden off-main, undocked',
      !!fab && fab.classList.contains('hidden') && !fab.classList.contains('drive-dock'));
    main.classList.add('active'); fireObs(main);
    check('J2 on the main screen the FAB shows, undocked',
      !fab.classList.contains('hidden') && !fab.classList.contains('drive-dock'));
    docBody.classList.add('mt-driving'); fireObs(docBody);
    check('J3 Drive opens (mt-driving added): the FAB is DOCKED and visible',
      fab.classList.contains('drive-dock') && !fab.classList.contains('hidden'));
    main.classList.remove('active'); fireObs(main);
    check('J4 even if #main drops "active" under Drive, the dock HOLDS (Drive governs)',
      fab.classList.contains('drive-dock') && !fab.classList.contains('hidden'));
    docBody.classList.remove('mt-driving'); fireObs(docBody);
    check('J5 Drive closes: the dock lifts and the ordinary rule is back (hidden off-main)',
      !fab.classList.contains('drive-dock') && fab.classList.contains('hidden'));
    main.classList.add('active'); fireObs(main);
    check('J6 back on main: visible again, undocked — the ordinary spot',
      !fab.classList.contains('hidden') && !fab.classList.contains('drive-dock'));
  }

  /* ============ K. static pins: CSS dock, avatar, the fading audit ============ */
  console.log('— K. static pins —');
  {
    const dock = (cssSrc.match(/body\.mt-driving #chatFab\{[^}]*\}/) || [''])[0];
    /* v139 PIN MOVE (supersedes the v135 K1 placement pin): the
       dock keeps its place (right edge, vertically centred,
       above the drive screen) but the translateY(-50%)
       transform is GONE — the 52px button is centred by
       arithmetic (top:calc(50% - 26px)), so the docked mic
       carries no transform at all (see BUGS.md v139). */
    check('K1 v139: the dock pins the FAB to the side edge, centred by arithmetic, above the drive screen — and carries NO transform',
      /top:calc\(50% - 26px\)/.test(dock) && /right:calc\(6px/.test(dock) && /z-index:2100/.test(dock) &&
      !/(^|[;{])\s*transform\s*:/.test(dock), dock);
    check('K2 the dock does NOT hide the FAB (side-docking beat the v125-era hide)',
      dock.length > 0 && dock.indexOf('display:none') < 0, dock);
    check('K3 the chat sheet + scrim rise above the drive screen while driving (the docked mic must open)',
      /body\.mt-driving #chatSheet\{[^}]*z-index:2120/.test(cssSrc) &&
      /body\.mt-driving #chatScrim\{[^}]*z-index:2110/.test(cssSrc));
    check('K4 outside Drive the FAB keeps its ordinary spot (base rule untouched)',
      /#chatFab\{[^}]*bottom:88px/.test(cssSrc));
    check('K5 the v125 wrong-element rule is on the record: #fbFab was the feedback button, never the chat FAB',
      cssSrc.indexOf('body.mt-driving #fbFab{display:none!important;}') >= 0 &&
      cssSrc.indexOf('CHAT FAB, #chatFab') >= 0);
    const youRule = (cssSrc.match(/\.nv-drive-you\{[^}]*\}/) || [''])[0];
    /* v139 PIN MOVE (supersedes the v135 K6 geometry pin): the
       marker keeps its anchor and its tap, but the centring
       transform and the fixed 52px CSS width are GONE — the box
       is sized per kind from AVATAR_BOX by the render/paintYou
       and centred by negative margins (see navigator.js). */
    check('K6 v139: the avatar is BIG and tappable (pointer-events:auto, on the 50%/64% anchor) with NO transform and NO fixed width in CSS — the box comes from AVATAR_BOX',
      /pointer-events:auto/.test(youRule) && /left:50%/.test(youRule) && /top:64%/.test(youRule) &&
      !/(^|[;{])\s*transform\s*:/.test(youRule) && !/width:/.test(youRule) &&
      navSrc.indexOf('AVATAR_BOX') >= 0 && navSrc.indexOf('avatarBoxStyle') >= 0, youRule);
    check('K7 FADING: no opacity transition or animation exists ANYWHERE in the stylesheet',
      !/transition\s*:[^;}]*opacity/.test(cssSrc) && !/animation\s*:[^;}]*opacity/.test(cssSrc));
    const driveBlocks = cssSrc.match(/\.nv-(drive|avatar)[^{]*\{[^}]*\}/g) || [];
    const opacityBlocks = driveBlocks.filter(function (b) { return b.indexOf('opacity:') >= 0; });
    check('K8 FADING: the only opacity on drive chrome is the explicit steady-state opacity:1 (banner + bar)',
      opacityBlocks.length === 2 && opacityBlocks.every(function (b) { return b.indexOf('opacity:1') >= 0; }),
      JSON.stringify(opacityBlocks));
    check('K9 FADING: no drive/avatar block animates (the spin transitions TRANSFORM only)',
      driveBlocks.every(function (b) { return b.indexOf('animation') < 0; }) &&
      driveBlocks.every(function (b) {
        const t = b.match(/transition\s*:[^;}]+/);
        return !t || t[0].indexOf('transform') >= 0;
      }));
    check('K10 FADING: the drive tile layer runs fadeAnimation:false (tiles never fade in)',
      /fadeAnimation:\s*false/.test(navSrc));
    const buildUiSrc = chatSrc.slice(chatSrc.indexOf('function buildUi()'), chatSrc.indexOf('function openSheet()'));
    check('K11 the chatbot watches the BODY class (the mechanism fix), not just #main',
      buildUiSrc.indexOf('observe(document.body') >= 0 && buildUiSrc.indexOf('mt-driving') >= 0 &&
      buildUiSrc.indexOf("'drive-dock'") >= 0);
    check('K12 the navigator raises + drops mt-driving at the drive boundary',
      navSrc.indexOf("classList.add('mt-driving')") >= 0 &&
      navSrc.indexOf("classList.remove('mt-driving')") >= 0);
  }

  /* ============ F. v260: the FORWARD layer (NAV-NO-UTURN) ============
     Owner, Mon Oct 26, 2026 07:43 MDT, driving: "Why on earth is it
     so difficult for you to tell this GPS never to tell me to U-turn."
     The v135/v192 exclusion rounds have a structural hole at the
     START of a route: excluding the turn-around point just moves it
     to the next intersection (or excludes the origin itself), so a
     truck that pulled out pointing AWAY from its destination still
     got a line that doubled back — words sanitized, geometry not.
     v260 adds the layer the exclusions cannot be: once they are
     spent and an offending maneuver still begins within the first
     1 km, the route is re-asked FORWARD — a 'through' point
     projected ahead of the truck along its own heading (500 m,
     then 1200 m) plus the heading on the origin — so the answer
     begins by continuing along the current road. The harness
     world routes from ORIGIN with GPS heading 40 (routeWorld). */
  console.log('— F. v260 forward layer: exclusions spent, U-turn at the start —');
  {
    const w = makeNavWorld({ storeData: JSON.parse(JSON.stringify(TRUCK_STORE)),
      fetchHandler: queueHandler([uturnFixture(), uturnFixture(), uturnFixture(), cleanFixture()]) });
    await routeWorld(w);
    check('F1 the route took FOUR requests (plain + 2 exclusion rounds + 1 forward round)',
      w.calls.fetch.length === 4, 'fetches=' + w.calls.fetch.length);
    check('F2 the exclusion rounds still go first (v135 order preserved)',
      (w.calls.fetch[1].body.exclude_locations || []).length === 1 &&
      (w.calls.fetch[2].body.exclude_locations || []).length === 1);
    const viaBody = w.calls.fetch[3].body;
    check('F3 the fourth request is the FORWARD one: three locations, the middle a THROUGH point, no exclusions',
      (viaBody.locations || []).length === 3 && viaBody.locations[1].type === 'through' &&
      !viaBody.exclude_locations, JSON.stringify(viaBody.locations));
    check('F4 the origin carries the truck\'s live heading (40, from the harness GPS)',
      viaBody.locations[0].heading === 40, 'heading=' + viaBody.locations[0].heading);
    const wantVia = sb.forwardOrigin(ORIGIN, 40, 500);
    const gotVia = [viaBody.locations[1].lat, viaBody.locations[1].lon];
    check('F5 the through point sits ~500 m ahead of the truck along its heading (±25 m)',
      sb.haversineM(gotVia, wantVia) < 25 && Math.abs(sb.haversineM(gotVia, ORIGIN) - 500) < 25,
      'off=' + sb.haversineM(gotVia, wantVia) + ' dist=' + sb.haversineM(gotVia, ORIGIN));
    const stepsF = w.reg.nv_steps._html;
    const cleanWords = sb.maneuverPlan(cleanFixture().trip).maneuvers[4].instruction;
    check('F6 the adopted plan is the FORWARD route itself, not the sanitize rewrite (clean words, no U-turn, no "Continue on 48 Avenue NW" patch)',
      !UTURN.test(stepsF) && stepsF.indexOf(cleanWords) >= 0 &&
      stepsF.indexOf('Continue on 48 Avenue NW') < 0, stepsF.slice(0, 300));
    w.api.teardown();
  }
  {
    const w = makeNavWorld({ storeData: JSON.parse(JSON.stringify(TRUCK_STORE)),
      fetchHandler: queueHandler([uturnFixture()]) });
    await routeWorld(w);
    check('F7 when NOTHING cures it the chain stays bounded: 5 fetches (1 + 2 exclusions + 2 forward pushes)',
      w.calls.fetch.length === 5, 'fetches=' + w.calls.fetch.length);
    const wantVia2 = sb.forwardOrigin(ORIGIN, 40, 1200);
    const gotVia2 = [w.calls.fetch[4].body.locations[1].lat, w.calls.fetch[4].body.locations[1].lon];
    check('F8 the second forward push reaches ~1200 m ahead (±25 m)',
      Math.abs(sb.haversineM(gotVia2, ORIGIN) - 1200) < 25 && sb.haversineM(gotVia2, wantVia2) < 25,
      'dist=' + sb.haversineM(gotVia2, ORIGIN));
    const stepsF2 = w.reg.nv_steps._html;
    check('F9 and the sanitize net STILL presents no U-turn after the forward layer is spent',
      !UTURN.test(stepsF2) && stepsF2.indexOf('Continue on 48 Avenue NW') >= 0, stepsF2.slice(0, 200));
    w.api.teardown();
  }
  {
    const w = makeNavWorld({ storeData: JSON.parse(JSON.stringify(TRUCK_STORE)),
      fetchHandler: queueHandler([uturnFixture(), uturnFixture(), uturnFixture(), 'REJECT', cleanFixture()]) });
    await routeWorld(w);
    check('F10 a FAILED forward request retries once as a plain request, then adopts its answer (5 fetches)',
      w.calls.fetch.length === 5 &&
      (w.calls.fetch[4].body.locations || []).length === 2 && !w.calls.fetch[4].body.exclude_locations,
      'fetches=' + w.calls.fetch.length);
    const stepsF3 = w.reg.nv_steps._html;
    check('F11 the retried route presents clean words, no U-turn',
      !UTURN.test(stepsF3) && stepsF3.indexOf(sb.maneuverPlan(cleanFixture().trip).maneuvers[4].instruction) >= 0,
      stepsF3.slice(0, 200));
    w.api.teardown();
  }

  console.log('\nnavigator-v135: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
