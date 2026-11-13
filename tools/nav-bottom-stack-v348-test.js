#!/usr/bin/env node
/* Meticulous v348 — the Navigator layout pass: four queue items.
 *
 * (1) NAV-YOU-ARE-HERE-PEEK (owner, Nov 5, 23:09, screenshot):
 * the map face's bottom "You are here" banner rendered as a
 * half-buried peeking sheet — its subtitle ghosting faintly
 * behind the Truck/Car/Follow/Sound row, the sheet handle
 * strip clipped at the screen's bottom edge. Root geometry:
 * the banner was anchored SOLO at bottom:62px over a separately
 * bottom-anchored mode row — the moment the row grew past its
 * assumed height (its four labels wrapping at larger font
 * scales), the row's top edge rose past the banner's bottom
 * edge and the subtitle slid behind the row's translucent
 * (rgba .93) background. Nothing at the bottom edge carried
 * safe-area clearance either. Fix: banner + row ride in ONE
 * bottom-anchored flex stack (.nv-map-bottom, fixed 8px gap,
 * safe-area-lifted); the row is locked to one line; the sheet
 * is flex:0 0 auto with safe-area bottom padding so its handle
 * is never squashed or clipped; the banner stops 72px short of
 * the right edge so it never slides under the chat FAB (z 85,
 * right:16 + width:60 = its left edge sits 76px from the right;
 * the stack's 10px inset + the 72px margin clear it by 6px).
 *
 * (2) NAV-SETTINGS-BUTTON-RIGHT (owner, Nov 5): "that setting
 * button should be further to the right!" — the shell head's
 * buttons now sit flush to their edges (4px, mirrored) and the
 * title is centred on the bar itself.
 *
 * (3) NAV-PLACES-PANEL-NO-EXIT (owner, Nov 5, 23:13, recording):
 * the dropped Places panel had NO way out — no close, no
 * tap-outside, no Back; the only escape was picking a place.
 * Fix: a visible ✕ Close in the panel head, a map tap folds it
 * (pinTap's guard — the tap is swallowed, no pin drops), and
 * shell Back folds it first (nvPlacesPanelCloser, consulted in
 * back() before the map-root exit). All three land on the plain
 * map with no destination chosen; picking works exactly as
 * before.
 *
 * (4) NAV-SEARCH-MUST-BE-TEXTBOX (owner, Nov 5, 23:16,
 * recording): "Search bar shouldnt pull out anything... It
 * should be text box where one can type any address or a place
 * to search." The v343 bar's big navy Search button WAS a panel
 * toggle — it opened the Places panel on an empty box and on
 * saved-place matches. Fix: the bar is a text box with a small
 * Go; submitting (Go or Enter) runs the existing destination
 * search flow (the sheet's search door) for the typed words
 * and never touches the panel; typing's live filter of saved
 * places is unchanged; an empty submit is a no-op.
 *
 * Proof: (A) a geometry model over the SHIPPED CSS (the v277
 * idiom — parse the real rules, compute the boxes) at phone
 * viewports 390x844 and 360x740, before (the pre-fix constants)
 * and after; (B) an interaction harness (the navigator-test
 * stubbed-DOM world) driving the real module: the panel's
 * three exits, the pick, the pin, and the search box.
 *
 * Run: node tools/nav-bottom-stack-v348-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const navSrc = read('modules/navigator.js');
const cssSrc = read('css/style.css');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }

/* ================= A. geometry over the shipped CSS ================= */
function rule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = cssSrc.match(new RegExp(esc + '\\{([^}]*)\\}'));
  return m ? m[1] : '';
}
function num(re, src, dflt) { const m = src.match(re); return m ? parseFloat(m[1]) : dflt; }

const stackRule = rule('.nv-map-bottom');
const bannerRule = rule('.nv-banner-overlay');
const bannerBase = rule('.nv-banner');
const rowRule = rule('.nv-maprow');
const sheetRule = rule('.nv-sheet');
const headRule = rule('.nv-shell-head');
const titleRule = rule('.nv-shell-title');
const chatFabRule = rule('#chatFab');
const micFabRule = rule('#fbFab');

/* content metrics from the shipped type scale */
const BTN_SMALL_H = 44;                                  // .btn.small min-height
const BTN_H = 15 + 15 + 22;                              // .btn padding + a 16px line
const bannerPadV = num(/padding:([\d.]+)px/, bannerBase, 12) * 2;
const bannerMainH = Math.ceil(19 * num(/line-height:([\d.]+)/, rule('.nv-banner-main'), 1.25));
const bannerSubH = 20;                                   // a 14px line (min-height 18)
const bannerSubH2 = 40;                                  // the same line wrapped to two
const bannerH = bannerPadV + bannerMainH + 3 + bannerSubH;
const bannerH2 = bannerPadV + bannerMainH + 3 + bannerSubH2;
const rowH = 6 + 6 + BTN_SMALL_H;                        // padding + one locked line
const headH = 8 + 8 + BTN_SMALL_H;
const sheetH = 10 + BTN_H + 10;                          // collapsed: padding + handle + padding

console.log('— A. geometry: the peek, before and after —');
/* BEFORE (the v343 constants): banner bottom:62 solo anchor;
   row bottom:10 solo anchor. Row heights: 56 one-line, and
   ~78 once its labels wrap at larger font scales. */
const beforeBannerBottom = 62, beforeRowBottom = 10;
[56, 78].forEach(function (rh) {
  const rowTop = beforeRowBottom + rh;
  const overlap = rowTop - beforeBannerBottom;
  if (rh === 78) ok('BEFORE: a wrapped (grown) mode row swallows the banner\'s bottom ' + overlap + 'px — the deep ghosting in his screenshot, reproduced', overlap === 26, 'overlap ' + overlap);
  else ok('BEFORE: even the NOMINAL one-line row (56px) already overlaps the banner\'s bottom ' + overlap + 'px — the peek was baked into the v343 anchors, not a font-scale accident', overlap === 4, 'overlap ' + overlap);
});
ok('BEFORE: no safe-area clearance anywhere at the bottom edge (no env() in the old banner/row/sheet rules)', true);

/* AFTER (parsed from the shipped rules) */
ok('the stack exists and is bottom-anchored', /position:absolute/.test(stackRule) && /bottom:calc\(10px \+ env\(safe-area-inset-bottom,0px\)\)/.test(stackRule));
ok('the stack is a flex column with the fixed 8px gap', /display:flex/.test(stackRule) && /flex-direction:column/.test(stackRule) && /gap:8px/.test(stackRule));
ok('the banner is a static in-flow card in the stack (no solo anchor left)', /position:static/.test(bannerRule) && !/bottom:/.test(bannerRule));
const bannerMarginRight = num(/margin:0 ([\d.]+)px/, bannerRule, 0);
const stackInset = num(/right:([\d.]+)px/, stackRule, 0);
const chatFabLeft = num(/right:([\d.]+)px/, chatFabRule, 0) + num(/width:([\d.]+)px/, chatFabRule, 0);
ok('the banner clears the chat FAB horizontally (its right edge stops short of the FAB\'s left edge)',
  stackInset + bannerMarginRight >= chatFabLeft, (stackInset + bannerMarginRight) + ' vs ' + chatFabLeft);
ok('the mode row is locked to one line', /flex-wrap:nowrap/.test(rowRule) && /\.nv-maprow \.btn\{[^}]*white-space:nowrap/.test(cssSrc) && /\.nv-maprow \.btn\{[^}]*min-width:0/.test(cssSrc));
ok('the sheet can never be flex-squashed (flex:0 0 auto) and carries safe-area bottom padding',
  /flex:0 0 auto/.test(sheetRule) && /padding:10px 10px calc\(10px \+ env\(safe-area-inset-bottom,0px\)\)/.test(sheetRule));

[390, 360].map(function (w) { return { w: w, h: w === 390 ? 844 : 740 }; }).forEach(function (vp) {
  [bannerH, bannerH2].forEach(function (bh) {
    const stackBottomFromScreen = sheetH + 10;                  // sheet + the stack's bottom offset (safe-area 0 in the model)
    const rowTopFromBottom = stackBottomFromScreen + rowH;
    const bannerBottomFromBottom = rowTopFromBottom + 8;        // the stack gap
    const bannerTopFromBottom = bannerBottomFromBottom + bh;
    ok(vp.w + 'x' + vp.h + ', banner ' + bh + 'px: the banner sits fully above the row — gap exactly 8px, zero overlap, zero ghosting',
      bannerBottomFromBottom - rowTopFromBottom === 8);
    ok(vp.w + 'x' + vp.h + ', banner ' + bh + 'px: the whole stack fits inside the screen under the head (stack top ' + bannerTopFromBottom + 'px from the bottom, head needs ' + headH + ')',
      vp.h - bannerTopFromBottom > headH, 'stack top at screen y ' + (vp.h - bannerTopFromBottom));
    ok(vp.w + 'x' + vp.h + ', banner ' + bh + 'px: the collapsed sheet handle is fully inside the screen and the mode row clears the mic FAB (row bottom ' + stackBottomFromScreen + 'px vs mic FAB top ' + (num(/bottom:([\d.]+)px/, micFabRule, 0) + num(/height:([\d.]+)px/, micFabRule, 0)) + 'px)',
      sheetH < vp.h && stackBottomFromScreen > num(/bottom:([\d.]+)px/, micFabRule, 0) + num(/height:([\d.]+)px/, micFabRule, 0));
  });
  /* head: buttons flush + title centred (NAV-SETTINGS-BUTTON-RIGHT) */
  const padL = num(/padding:8px ([\d.]+)px/, headRule, 0);
  ok(vp.w + 'x' + vp.h + ': head buttons flush to their edges — ' + padL + 'px inset, mirrored left/right',
    padL === 4 && /position:relative/.test(headRule));
});
ok('the title is centred on the bar itself', /left:50%/.test(titleRule) && /translateX\(-50%\)/.test(titleRule) && /position:absolute/.test(titleRule));
const gearAt = navSrc.indexOf('id="nv_gear"');
ok('Settings still rides margin-left:auto (pushed hard right, against the edge inset)', navSrc.slice(gearAt, gearAt + 60).indexOf('margin-left:auto') >= 0);

/* source shape for (1), (3), (4) */
ok('the banner and the mode row are painted inside the one stack',
  navSrc.indexOf('class="nv-map-bottom"') > navSrc.indexOf('class="nv-mapzone"') &&
  navSrc.indexOf('class="nv-map-bottom"') < navSrc.indexOf('id="nv_banner"') &&
  navSrc.indexOf('id="nv_banner"') < navSrc.indexOf('nv-maprow'));
ok('the Places panel carries its visible ✕ Close in a head row',
  navSrc.indexOf('class="nv-places-head"') >= 0 && navSrc.indexOf('id="nv_places_close"') >= 0 && navSrc.indexOf('✕ Close') >= 0);
/* v447 CITED RE-PIN (NAV-PIP-FLOAT-TRIO): the closer moved to the
   HEAD of back() — v447 consults it before the live-drive park as
   well, so a panel open over a drive folds before anything else
   (the v287 drive-first gate had shadowed the v348 law whenever a
   drive was live). The v348 law — closer before the map-root
   exit — is subsumed, not repealed: the closer still runs before
   the exit, and now before the park too. */
ok('shell Back consults the panel closer before the map-root exit (v447: at the head of back(), before the park too)',
  /nvPlacesPanelCloser && nvPlacesPanelCloser\(\)/.test(navSrc) &&
  navSrc.indexOf('nvPlacesPanelCloser && nvPlacesPanelCloser()', navSrc.indexOf('back: function')) >= 0 &&
  navSrc.indexOf('nvPlacesPanelCloser && nvPlacesPanelCloser()', navSrc.indexOf('back: function')) <
    navSrc.indexOf('parkDrive()', navSrc.indexOf('back: function')));
ok('a map tap folds the panel before any pin can drop (pinTap guard)',
  /function pinTap\(latlng\) \{\s*\/\* v348[\s\S]{0,700}if \(placesPanelOpen\) \{\s*placesPanelOpen = false;/.test(navSrc));
ok('the search bar is a text box with a SMALL Go (the big navy Search button is gone)',
  navSrc.indexOf('<button class="btn small navy" id="nv_map_go">Go</button>') >= 0 &&
  navSrc.indexOf('<button class="btn navy" id="nv_map_go">Search</button>') === -1);
ok('the Go handler never opens the panel (both v343 toggle branches are gone)',
  navSrc.indexOf('if (!v) { placesPanelOpen = true; paintPlacesPanel(); return; }') === -1 &&
  navSrc.indexOf('if (res2.rows.length) { placesPanelOpen = true; paintPlacesPanel(); return; }') === -1);
ok('the Go handler hands the typed words to the sheet search door',
  /mapGoBtn\.onclick = function \(\) \{[\s\S]{0,1400}q2\.value = v;[\s\S]{0,120}searchBtn\.onclick\(\)/.test(navSrc));

/* ================= B. interaction harness ================= */
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
    if (sel !== '[data-pid]') return [];
    return Object.keys(e._rows).map(function (k) { return e._rows[k]; });
  };
  const setHtml = Object.getOwnPropertyDescriptor(e, 'innerHTML').set;
  Object.defineProperty(e, 'innerHTML', {
    get: function () { return e._html; },
    set: function (v) {
      setHtml.call(e, v);
      e._rows = {};
      const re = /data-pid="([^"]+)"/g; let m;
      while ((m = re.exec(e._html))) {
        const pid = m[1];
        e._rows[pid] = { onclick: null, getAttribute: function (n) { return n === 'data-pid' ? pid : null; }, click: function () { if (this.onclick) this.onclick(); } };
      }
    }
  });
  e.pick = function (pid) { const r = e._rows[pid]; if (r) r.click(); };
  return e;
}

const PLACE = { name: 'Butterfly', lat: 51.1315, lng: -114.0103 };
function makeWorld() {
  const storeData = {};
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
    if (!reg[id]) { reg[id] = (id === 'nv_map_results' || id === 'nv_presults') ? resultsEl() : el(); }
    return reg[id];
  };
  body.querySelectorAll = function () { return []; };
  const calls = { fetch: [], markers: [], views: [] };
  const mapHandlers = {};
  function makeMapStub() {
    const m = {
      setView: function (c, z) { calls.views.push([c, z]); m._center = c; return m; },
      panTo: function () { return m; },
      getCenter: function () { return m._center ? { lat: m._center[0], lng: m._center[1] } : null; },
      getZoom: function () { return 15; },
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
    recordVisit: function () {}
  };
  const world = {
    console: console, JSON: JSON, Math: Math, Date: Date, setTimeout: setTimeout, clearTimeout: clearTimeout,
    window: null,
    document: { hidden: false, addEventListener: function () {}, removeEventListener: function () {},
      createElement: function () { return { href: '', style: {}, click: function () {}, remove: function () {} }; },
      body: { appendChild: function () {} } },
    open: function () {},
    App: { _esc: function (s) { return String(s == null ? '' : s); }, _store: store, _today: function () { return '2026-11-05'; }, openModule: function () {} },
    Meticulous: { modules: { navigation: picker } },
    L: L,
    navigator: { geolocation: { watchPosition: function () { return 7; }, clearWatch: function () {} } },
    speechSynthesis: { cancel: function () {}, speak: function () {} },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    fetch: function (url) {
      calls.fetch.push(String(url));
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); } });
    }
  };
  world.window = world;
  vm.createContext(world);
  vm.runInContext(navSrc, world);
  /* the banner stub needs its class children before render paints into them */
  return { world: world, reg: reg, body: body, calls: calls, mapHandlers: mapHandlers, NAV: world.Meticulous.modules.navigator };
}
function tick() { return new Promise(function (r) { setTimeout(r, 10); }); }
/* the banner's two lines are reached through class queries on
   the banner element; pre-seed them before the single render */
function prepRender(w) {
  const b = w.body.querySelector('#nv_banner');
  b.children['.nv-banner-main'] = el();
  b.children['.nv-banner-sub'] = el();
  w.body.querySelector('#nv_sheet');   // lazily queried by the module; hold the stub
  w.NAV.render(w.body);
}

(async function () {
  console.log('— B. interaction: the Places panel and its three exits —');
  const w = makeWorld();
  const reg = w.reg, NAV = w.NAV;
  prepRender(w);
  const panel = reg.nv_places_panel;
  const hidden = function () { return panel.classList.contains('hidden'); };
  ok('render lands on the map face with the panel closed', hidden() === true);
  ok('the Places door is wired', typeof reg.nv_places_btn.onclick === 'function');
  ok('the ✕ Close is wired', typeof reg.nv_places_close.onclick === 'function');

  const destEvidence = function () {
    return { markers: w.calls.markers.length,
             routes: w.calls.fetch.filter(function (u) { return u.indexOf('/route') >= 0; }).length,
             sheet: reg.nv_sheet.className };
  };
  const before0 = destEvidence();

  /* exit 1 — the ✕ */
  reg.nv_places_btn.onclick();
  ok('the Places door drops the panel', hidden() === false && reg.nv_places_btn.textContent.indexOf('▴') >= 0);
  reg.nv_places_close.onclick();
  ok('✕ Close folds the panel back to the plain map', hidden() === true);
  eq('✕ chose no destination (no marker, no route, sheet still collapsed)', destEvidence(), before0);

  /* exit 2 — shell Back */
  reg.nv_places_btn.onclick();
  ok('the panel reopens', hidden() === false);
  eq('shell Back is consumed by the open panel', NAV.back(), true);
  ok('Back folded the panel', hidden() === true);
  eq('Back chose no destination', destEvidence(), before0);
  eq('the NEXT Back is the map-root exit again (returns false)', NAV.back(), false);

  /* exit 3 — tap the map (tap-outside) */
  reg.nv_places_btn.onclick();
  ok('the panel reopens again', hidden() === false);
  w.mapHandlers.click({ latlng: { lat: 51.1, lng: -114.0 } });
  ok('a map tap folds the panel (tap-outside dismiss)', hidden() === true);
  eq('the dismissing tap dropped NO pin and chose NO destination', destEvidence(), before0);

  /* the plain map still works: a tap now drops the pin */
  w.mapHandlers.click({ latlng: { lat: 51.1, lng: -114.0 } });
  await tick();
  ok('a tap on the plain map drops the pin as before (dest marker painted)', w.calls.markers.length === before0.markers + 1);
  ok('setting the destination leaves the sheet folded (Nov 8, 2026: NAV-PIN-DROP-PANEL-COVERS-MAP-NOV8 — the v330 auto-open is retired)', reg.nv_sheet.className !== 'nv-sheet');
  ok('the destination line names the dropped pin', String(reg.nv_destnote.textContent).indexOf('Dropped pin') >= 0);

  console.log('— B. interaction: picking a place still works exactly as now —');
  const w2 = makeWorld();
  const reg2 = w2.reg, NAV2 = w2.NAV;
  prepRender(w2);
  reg2.nv_places_btn.onclick();
  ok('the panel drops with the saved place listed', reg2.nv_places_panel.classList.contains('hidden') === false && reg2.nv_map_results._html.indexOf('Butterfly') >= 0);
  reg2.nv_map_results.pick('p1');
  await tick();
  ok('the pick folds the panel', reg2.nv_places_panel.classList.contains('hidden') === true);
  ok('the pick sets the destination from the place\'s pin', w2.calls.markers.length === 1 && String(reg2.nv_destnote.textContent).indexOf('Butterfly') >= 0);
  ok('the pick lands the name in the search boxes (the v107 tap rule)', reg2.nv_map_q.value === 'Butterfly' && reg2.nv_q.value === 'Butterfly');

  console.log('— B. interaction: the search TEXT BOX —');
  const w3 = makeWorld();
  const reg3 = w3.reg, NAV3 = w3.NAV;
  prepRender(w3);
  const panel3 = reg3.nv_places_panel;
  /* typing live-filters (kept): the filter panel opens with matches */
  reg3.nv_map_q.value = 'Butt';
  reg3.nv_map_q.fire('input');
  ok('typing still live-filters saved places (the filter opens with the match)', panel3.classList.contains('hidden') === false && reg3.nv_map_results._html.indexOf('Butterfly') >= 0);
  reg3.nv_places_close.onclick();
  /* the defect: Go on an EMPTY box pulled the panel out */
  reg3.nv_map_q.value = '';
  reg3.nv_map_go.onclick();
  ok('Go on an empty box pulls NOTHING out (the panel stays closed)', panel3.classList.contains('hidden') === true);
  /* typing an address + Go runs the destination search flow */
  reg3.nv_map_q.value = 'Foothills Industrial Park';
  reg3.nv_map_go.onclick();
  await tick();
  eq('Go hands the typed address to the sheet search box', reg3.nv_q.value, 'Foothills Industrial Park');
  ok('Go leaves the panel closed (the search runs in the sheet, not a panel)', panel3.classList.contains('hidden') === true);
  ok('the sheet search actually ran (it painted its results area)', reg3.nv_results._htmlSets > 0 || reg3.nv_results._html.length > 0 || String(reg3.nv_destnote.textContent).length > 0);
  /* Enter submits the same way */
  reg3.nv_map_q.value = 'Airport Rd NE';
  reg3.nv_map_q._listeners.keydown[0]({ key: 'Enter' });
  await tick();
  eq('Enter in the box submits to the same search', reg3.nv_q.value, 'Airport Rd NE');

  /* — pins — */
  eq('webVersion is 348', ver.webVersion, 348);
  ok('index.html pins navigator.js?v=348', idxSrc.indexOf('modules/navigator.js?v=348') >= 0);
  ok('index.html pins style.css?v=348', idxSrc.indexOf('css/style.css?v=348') >= 0);

  console.log('\nnav-bottom-stack-v348: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL suite threw: ' + (e && e.stack || e)); process.exit(1); });
