#!/usr/bin/env node
/* Meticulous v395 — NAV-LINK-NO-ROUTE-NOV10 tests.
 *
 * Owner (Nov 10, 2026 ~08:47 CST, screen clip + his "Yes" to
 * the read-back): in the Navigator he pasted the dump site's
 * Google Maps link —
 *   https://www.google.com/maps/search/?api=1&query=51.1225089,-114.0122197
 * — into the SEARCH BOX (the map face's #nv_map_q, the box the
 * clip shows the link sitting in) and tapped Go. The map stood
 * on "You are here": no pin, no route, nothing.
 *
 * THE DEFECT (convicted below, failing-first on the shipped
 * web-394 bytes): the search brain (searchBtn.onclick — the ONE
 * handler the sheet Search, the map Go and "Search as address"
 * all run) has NO pin step. It consults saved places, then feeds
 * the raw text to the Nominatim geocoder. A link is not a place
 * name: the geocoder returns nothing for it, the v183 retry then
 * re-searches the text after the link's first comma (the tail of
 * the coordinate pair), fails again, and writes "No places
 * found" into #nv_results — inside the FOLDED sheet, where the
 * driver never sees it. From his seat the paste silently died.
 * The paste bar (#nv_link / Open pin, openSentPin) reads the
 * same link fine — the two doors disagreed about what a link is.
 *
 * THE FIX (modules/navigator.js, searchBtn.onclick only): the
 * pin step the paste bar already had now stands at the head of
 * the search, before saved places and before the geocoder —
 *  (1) a pin INSIDE the text (sentPinCoords: an api=1/@/dir
 *      pair, a %2C pair, a !3d/!4d segment, bare "lat, lng",
 *      a whole message carrying a full link) lands at once
 *      through landSentPin — the same setDest + setView +
 *      recordVisit landing a manual pin drop gets, route
 *      auto-firing from setDest;
 *  (2) a link that HIDES its pin (a short link, or any bare
 *      Maps URL the local read cannot open) is followed through
 *      the ONE link brain (PinLinks.resolveUrl — direct follow,
 *      then the server door) and lands the same way;
 *  (3) a link that yields nothing gets the paste bar's plain
 *      words in the results box — never a silent geocoder trip,
 *      and the geocoder is never fed a link again.
 * Typed place search, saved-place wins, pin drop and the paste
 * bar are untouched and pinned as regressions below.
 *
 * The world is the v348/v208 stub world of
 * nav-pindrop-panel-nov8-test.js, plus the REAL js/pinlinks.js
 * loaded ahead of the module, a geocoder stub that answers a
 * link the way Nominatim does (nothing), a short-link follow
 * stub, and the server door answering 403 (as probed).
 *
 * Run: node tools/navlink-searchbox-v395-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const navSrc = read('modules/navigator.js');
const pinSrc = read('js/pinlinks.js');
const fixture = JSON.parse(read('tools/navigator-fixture-tripb.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* ---------- the stub world (v348 registry + v208 route/geo) ---------- */
function el() {
  const e = {
    children: {}, style: {}, _html: '', _htmlSets: 0, textContent: '', value: '', onclick: null, className: '',
    _listeners: {},
    addEventListener: function (ev, fn) { (e._listeners[ev] = e._listeners[ev] || []).push(fn); },
    fire: function (ev, arg) { (e._listeners[ev] || []).slice().forEach(function (f) { f(arg); }); },
    classList: {
      _s: new Set(),
      add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); },
      toggle: function (c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) { this._s.add(c); } else { this._s.delete(c); } },
      contains: function (c) { return this._s.has(c); }
    },
    querySelector: function (sel) { return e.children[sel] || null; },
    querySelectorAll: function () { return []; },
    getAttribute: function () { return null; },
    setAttribute: function () {}
  };
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
    if (sel !== '[data-pid]' && sel !== '[data-nvhit]') return [];
    const attr = sel === '[data-pid]' ? 'data-pid' : 'data-nvhit';
    return Object.keys(e._rows).filter(function (k) { return k.indexOf(attr + ':') === 0; })
      .map(function (k) { return e._rows[k]; });
  };
  const setHtml = Object.getOwnPropertyDescriptor(e, 'innerHTML').set;
  Object.defineProperty(e, 'innerHTML', {
    get: function () { return e._html; },
    set: function (v) {
      setHtml.call(e, v);
      e._rows = {};
      let m;
      const rePid = /data-pid="([^"]+)"/g;
      while ((m = rePid.exec(e._html))) {
        const pid = m[1];
        e._rows['data-pid:' + pid] = { onclick: null, getAttribute: function (n) { return n === 'data-pid' ? pid : null; }, click: function () { if (this.onclick) this.onclick(); } };
      }
      const reHit = /data-nvhit="([^"]+)"/g;
      while ((m = reHit.exec(e._html))) {
        const hit = m[1];
        e._rows['data-nvhit:' + hit] = { onclick: null, getAttribute: function (n) { return n === 'data-nvhit' ? hit : null; }, click: function () { if (this.onclick) this.onclick(); } };
      }
    }
  });
  e.pick = function (pid) { const r = e._rows['data-pid:' + pid]; if (r) r.click(); };
  e.hit = function (i) { const r = e._rows['data-nvhit:' + i]; if (r) r.click(); };
  return e;
}

const PLACE = { name: 'Butterfly', lat: 51.1315, lng: -114.0103 };
const ORIGIN = [51.0955, -114.099], DEST = [51.1075, -114.0845];
const DUMP = [51.1225089, -114.0122197];           /* today's dump-site pin (his clip) */
const DIRP = [51.3078892, -114.0369748];           /* the dir-link fixture pin */
const API1 = 'https://www.google.com/maps/search/?api=1&query=51.1225089,-114.0122197';
const DIRL = 'https://www.google.com/maps/dir/?api=1&destination=51.3078892,-114.0369748';
const SHORT = 'https://maps.app.goo.gl/dDWbHiiE88CWriqV7';
const SHORT_LANDING = 'https://www.google.com/maps/place/Dump+Site/@51.1225089,-114.0122197,17z';
const SHORT_DEAD = 'https://maps.app.goo.gl/DeadLink00';

function makeWorld(storeData) {
  const store = {
    get: function (k, d) { return storeData[k] !== undefined ? storeData[k] : d; },
    set: function (k, v) { storeData[k] = v; },
    del: function (k) { delete storeData[k]; }
  };
  const reg = {};
  const body = el();
  body.querySelector = function (sel) {
    if (sel.charAt(0) !== '#') return null;
    const id = sel.slice(1);
    if (!reg[id]) { reg[id] = (id === 'nv_results' || id === 'nv_map_results' || id === 'nv_presults') ? resultsEl() : el(); }
    return reg[id];
  };
  body.querySelectorAll = function () { return []; };
  const calls = { fetch: [], markers: [], spoken: [], visits: [] };
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
    tileLayer: function () { return { addTo: function () { return this; } }; },
    marker: function (ll) { calls.markers.push(ll); return { addTo: function () { return this; }, setLatLng: function () {} }; },
    circleMarker: function () { return { addTo: function () { return this; }, setLatLng: function () {} }; },
    polyline: function () { return { addTo: function () { return this; }, setLatLngs: function () {}, getBounds: function () { return {}; } }; },
    layerGroup: function () { return { addTo: function () { return this; }, getLayers: function () { return []; } }; }
  };
  const picker = {
    pickerEntries: function () { return { recents: true, rows: [{ place: PLACE }] }; },
    pickerRowHTML: function () { return '<div data-pid="p1">' + PLACE.name + '</div>'; },
    pickerFind: function () { return { place: PLACE }; },
    displayPlaceName: function (p) { return p.name; },
    setTab: function () {},
    recordVisit: function (name, la, ln) { calls.visits.push([name, la, ln]); },
    learnCoords: function () {}
  };
  let geoCb = null;
  const world = {
    console: console, JSON: JSON, Math: Math, Date: Date, setTimeout: setTimeout, clearTimeout: clearTimeout,
    window: null,
    document: { hidden: false, addEventListener: function () {}, removeEventListener: function () {},
      createElement: function () { return { href: '', style: {}, click: function () {}, remove: function () {} }; },
      body: { appendChild: function () {}, classList: { add: function () {}, remove: function () {} } } },
    open: function () {},
    App: { _esc: function (s) { return String(s == null ? '' : s); }, _store: store, _today: function () { return '2026-11-10'; }, openModule: function () {} },
    Meticulous: { modules: { navigation: picker } },
    L: L,
    navigator: { geolocation: { watchPosition: function (cb) { geoCb = cb; return 7; }, clearWatch: function () {} } },
    speechSynthesis: { cancel: function () {}, speak: function (u) { calls.spoken.push(u.text); }, getVoices: function () { return []; } },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    fetch: function (url) {
      const u = String(url);
      calls.fetch.push(u);
      if (u.indexOf('/route') >= 0) {
        return Promise.resolve({ ok: true, status: 200, url: u, json: function () { return Promise.resolve(fixture); } });
      }
      if (u.indexOf('maps.app.goo.gl') >= 0) {
        /* the direct follow: a live short link lands on its full
           Maps address (the pin rides in it); a dead one lands on
           a pin-less page. */
        const landing = u.indexOf('Dead') >= 0 ? 'https://www.google.com/maps' : SHORT_LANDING;
        return Promise.resolve({ ok: true, status: 200, url: landing, json: function () { return Promise.resolve({}); } });
      }
      if (u.indexOf('2.31.47.19') >= 0) {
        /* the server door, as probed from this network: forbidden */
        return Promise.resolve({ ok: false, status: 403, url: u, json: function () { return Promise.reject(new Error('forbidden')); } });
      }
      if (u.indexOf('nominatim') >= 0 && u.indexOf('reverse') >= 0) {
        return Promise.resolve({ ok: true, status: 200, url: u, json: function () { return Promise.resolve({ display_name: 'Test Road, Calgary', address: { road: 'Test Road' } }); } });
      }
      if (u.indexOf('nominatim') >= 0) {
        /* the geocoder, honestly: a place NAME resolves; a link,
           a bare number, anything else returns nothing. */
        let q = '';
        try { q = decodeURIComponent((u.split('q=')[1] || '').split('&')[0]); } catch (e) {}
        if (q === 'Geocoder Place') {
          return Promise.resolve({ ok: true, status: 200, url: u, json: function () { return Promise.resolve([{ lat: String(DEST[0]), lon: String(DEST[1]), display_name: 'Geocoder Place, Calgary, Canada' }]); } });
        }
        return Promise.resolve({ ok: true, status: 200, url: u, json: function () { return Promise.resolve([]); } });
      }
      return Promise.resolve({ ok: true, status: 200, url: u, json: function () { return Promise.resolve([]); } });
    }
  };
  world.window = world;
  vm.createContext(world);
  vm.runInContext(pinSrc, world);
  vm.runInContext(navSrc, world);
  return {
    world: world, reg: reg, body: body, calls: calls, storeData: storeData,
    NAV: world.Meticulous.modules.navigator,
    firePos: function (la, lo) { if (geoCb) geoCb({ coords: { latitude: la, longitude: lo, heading: 40, speed: 0 } }); },
    mapClick: function (la, lo) { mapHandlers.click({ latlng: { lat: la, lng: lo } }); }
  };
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 10); }); }
async function settle() { for (let i = 0; i < 8; i++) await tick(10); }
function Q(w, id) { return w.body.querySelector('#' + id); }
function prepRender(w) {
  const b = w.body.querySelector('#nv_banner');
  b.children['.nv-banner-main'] = el();
  b.children['.nv-banner-sub'] = el();
  w.body.querySelector('#nv_sheet');
  w.body.querySelector('#nv_sheet_toggle');
  w.body.querySelector('#nv_drive').classList.add('hidden');
  w.body.querySelector('#nv_drive_screen').classList.add('hidden');
  w.NAV.render(w.body);
}
function lastMarker(w) { return w.calls.markers.length ? w.calls.markers[w.calls.markers.length - 1] : null; }
function routed(w) { return w.calls.fetch.some(function (u) { return u.indexOf('/route') >= 0; }); }
function geocodedLink(w) {
  return w.calls.fetch.some(function (u) {
    return u.indexOf('nominatim') >= 0 && u.indexOf('reverse') < 0 && /q=https/.test(u);
  });
}
async function mapGo(w, text) {
  Q(w, 'nv_map_q').value = text;
  Q(w, 'nv_map_go').onclick();
  await settle();
}

(async function () {
  console.log('— S. source pins —');
  const searchBody = navSrc.slice(navSrc.indexOf('searchBtn.onclick = function ()'),
    navSrc.indexOf('/* v103 door 1: the places picker'));
  ok('the search reads a pin out of the text (sentPinCoords) before the geocoder',
    searchBody.indexOf('sentPinCoords(q)') !== -1 &&
    searchBody.indexOf('sentPinCoords(q)') < searchBody.indexOf('nominatim.openstreetmap.org'));
  ok('the search follows a hidden pin through the one link brain (PinLinks.resolveUrl)',
    searchBody.indexOf('PinLinks.resolveUrl') !== -1);
  ok('a landed search pin goes through landSentPin (the manual-pin landing)',
    searchBody.indexOf('landSentPin(') !== -1);
  ok('the paste bar door stands untouched (openSentPin still reads #nv_link)',
    navSrc.indexOf('function openSentPin()') !== -1 &&
    navSrc.indexOf("var inp = body.querySelector('#nv_link');") !== -1);

  console.log('— A. the owner clip: api=1 link in the SEARCH BOX —');
  {
    const w = makeWorld({});
    prepRender(w);
    w.firePos(ORIGIN[0], ORIGIN[1]);
    await mapGo(w, API1);
    eq('the pin lands as the destination marker', lastMarker(w), DUMP);
    ok('the route is requested for it', routed(w));
    eq('the visit is recorded (Manifest law)', w.calls.visits, [['Sent pin', DUMP[0], DUMP[1]]]);
    ok('the geocoder is never fed the link', !geocodedLink(w));
  }

  console.log('— B. a maps/dir link in the search box —');
  {
    const w = makeWorld({});
    prepRender(w);
    w.firePos(ORIGIN[0], ORIGIN[1]);
    await mapGo(w, DIRL);
    eq('the dir destination lands as the marker', lastMarker(w), DIRP);
    ok('the route is requested for it', routed(w));
    ok('the geocoder is never fed the link', !geocodedLink(w));
  }

  console.log('— C. a short link in the search box (pin hidden behind the redirect) —');
  {
    const w = makeWorld({});
    prepRender(w);
    w.firePos(ORIGIN[0], ORIGIN[1]);
    await mapGo(w, SHORT);
    eq('the followed pin lands as the marker', lastMarker(w), DUMP);
    ok('the route is requested for it', routed(w));
    ok('the geocoder is never fed the link', !geocodedLink(w));
  }

  console.log('— D. bare coordinates in the search box —');
  {
    const w = makeWorld({});
    prepRender(w);
    w.firePos(ORIGIN[0], ORIGIN[1]);
    await mapGo(w, '51.3078892, -114.0369748');
    eq('the pair lands as the marker', lastMarker(w), DIRP);
    ok('the route is requested for it', routed(w));
  }

  console.log('— E. a whole dispatch message carrying the link, in the search box —');
  {
    const w = makeWorld({});
    prepRender(w);
    w.firePos(ORIGIN[0], ORIGIN[1]);
    await mapGo(w, 'Dump site: ' + API1 + ' — go empty');
    eq('the pin inside the message lands', lastMarker(w), DUMP);
    ok('the route is requested for it', routed(w));
  }

  console.log('— J. a dead short link: plain words, never silence —');
  {
    const w = makeWorld({});
    prepRender(w);
    w.firePos(ORIGIN[0], ORIGIN[1]);
    await mapGo(w, SHORT_DEAD);
    eq('no marker is invented', lastMarker(w), null);
    ok('no route is requested', !routed(w));
    ok('the results box carries the paste-bar words (the full link carries the pin)',
      String(Q(w, 'nv_results').innerHTML).indexOf('full link carries the pin') >= 0,
      'box=' + Q(w, 'nv_results').innerHTML);
    ok('the geocoder is never fed the link', !geocodedLink(w));
  }

  console.log('— F. regression: typed place search still lists, Use this still lands —');
  {
    const w = makeWorld({});
    prepRender(w);
    w.firePos(ORIGIN[0], ORIGIN[1]);
    await mapGo(w, 'Geocoder Place');
    ok('the results list is painted', String(Q(w, 'nv_results').innerHTML).indexOf('Geocoder Place') >= 0);
    Q(w, 'nv_results').hit(0);
    await settle();
    eq('Use this lands the geocoder pin', lastMarker(w), DEST);
    ok('the route is requested for it', routed(w));
  }

  console.log('— G. regression: the sheet search box, a saved place still wins —');
  {
    const w = makeWorld({});
    prepRender(w);
    w.firePos(ORIGIN[0], ORIGIN[1]);
    Q(w, 'nv_q').value = 'Butterfly';
    Q(w, 'nv_search').onclick();
    await settle();
    eq('the saved place pin lands outright', lastMarker(w), [PLACE.lat, PLACE.lng]);
    ok('the route is requested for it', routed(w));
  }

  console.log('— H. regression: a map tap still drops a pin and routes —');
  {
    const w = makeWorld({});
    prepRender(w);
    w.firePos(ORIGIN[0], ORIGIN[1]);
    w.mapClick(DEST[0], DEST[1]);
    await settle();
    ok('the pin dropped (dest marker painted)', w.calls.markers.length >= 1);
    ok('the route is requested for it', routed(w));
  }

  console.log('— I. regression: the paste bar still lands the same link —');
  {
    const w = makeWorld({});
    prepRender(w);
    w.firePos(ORIGIN[0], ORIGIN[1]);
    Q(w, 'nv_link').value = API1;
    Q(w, 'nv_link_open').onclick();
    await settle();
    eq('the paste-bar pin lands', lastMarker(w), DUMP);
    ok('the route is requested for it', routed(w));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('SUITE ERROR', e); process.exit(2); });
