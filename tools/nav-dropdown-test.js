#!/usr/bin/env node
/* Meticulous v87 — NAVIGATION PLACES: THE DROPDOWN, DRIVEN.
 *
 * Owner (Oct 15, 2026, evening, from his phone): "We have to clean
 * this application up — don't need 40 different cards for each and
 * every saved location. That should be all in a dropdown… 1 field
 * to fill in the address, no need for 40 different cards." And on
 * the v84 per-card buttons: "Why is it showing me buttons for all
 * the other apps when I can just use my own now?" And earlier the
 * same evening: "Add favourite shouldn't be in the face when you
 * open it. It has to live inside the favourites button."
 *
 * v87 contract, driven here against the REAL modules:
 *  A. Navigation renders ONE filter input + ONE select holding
 *     the combined list (25 built-ins tagged "Built-in" + the
 *     tab's favorites tagged "Yours") — no per-place cards, no
 *     external-app buttons anywhere in the HTML.
 *  B. Picking a place shows its panel with ONE primary action,
 *     Navigate, which (a) records the visit exactly as before
 *     (work → manifest feed + recent, pin riding the recent;
 *     personal → recent only, NEVER the feed), (b) stores the
 *     one-shot nav_pending hand-off (pin when the place has one,
 *     address query when it does not), and (c) opens the in-app
 *     Navigator. window.open is never called.
 *  C. The Add form starts hidden behind "+ Add favorite"; saving
 *     returns to the list with the new place selected; a personal
 *     favorite can be removed from its selected panel.
 *  D. The Navigator consumes nav_pending on open through the
 *     same setDest the picker uses (pin → destination note set,
 *     record deleted) and, for an address-only place, fills its
 *     search box and runs the search (fetch to Nominatim).
 *
 * Run: node tools/nav-dropdown-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const navSrc = fs.readFileSync(path.join(ROOT, 'modules', 'navigation.js'), 'utf8');
const torSrc = fs.readFileSync(path.join(ROOT, 'modules', 'navigator.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function tick() { return new Promise(function (r) { setTimeout(r, 10); }); }

/* ================= fake DOM (navigation) ================= */
function makeEl() {
  const e = { style: {}, value: '', _html: '', onclick: null, _listeners: {}, _kids: {} };
  Object.defineProperty(e, 'innerHTML', {
    configurable: true,
    get: function () { return e._html; },
    set: function (v) { e._html = String(v); }
  });
  e.addEventListener = function (ev, fn) { (e._listeners[ev] = e._listeners[ev] || []).push(fn); };
  e.fire = function (ev) { (e._listeners[ev] || []).slice().forEach(function (f) { f(); }); };
  e.click = function () { if (e.onclick) e.onclick(); };
  e.querySelector = function (sel) { return e._kids[sel] || (e._kids[sel] = makeEl()); };
  e.querySelectorAll = function () { return []; };
  e.getAttribute = function () { return null; };
  return e;
}
/* a <select> stub with browser value semantics: setting its
   options HTML adopts the option marked selected (else the
   first) as its value */
function makeSelect() {
  const e = makeEl();
  Object.defineProperty(e, 'innerHTML', {
    get: function () { return e._html; },
    set: function (v) {
      e._html = String(v);
      const opts = [];
      const re = /<option value="([^"]*)"([^>]*)>/g;
      let m;
      while ((m = re.exec(e._html))) opts.push({ value: m[1], selected: / selected/.test(m[2]) });
      e._opts = opts;
      const sel = opts.filter(function (o) { return o.selected; })[0] || opts[0];
      e.value = sel ? sel.value : '';
    }
  });
  return e;
}
function makeNavBody() {
  const body = { _html: '', _byId: {}, _tabs: [], _rgos: [] };
  Object.defineProperty(body, 'innerHTML', {
    get: function () { return body._html; },
    set: function (v) {
      body._html = String(v);
      body._tabs = [];
      let m;
      const tre = /data-tab="(work|personal)"/g;
      while ((m = tre.exec(body._html))) {
        const t = m[1];
        body._tabs.push({ onclick: null, getAttribute: function (n) { return n === 'data-tab' ? t : null; },
          click: function () { if (this.onclick) this.onclick(); } });
      }
      body._rgos = [];
      const rre = /data-rgo="([^"]+)"/g;
      while ((m = rre.exec(body._html))) {
        const id = m[1];
        body._rgos.push({ onclick: null, getAttribute: function (n) { return n === 'data-rgo' ? id : null; },
          click: function () { if (this.onclick) this.onclick(); } });
      }
    }
  });
  body.querySelector = function (sel) {
    if (!body._byId[sel]) body._byId[sel] = (sel === '#nv_sel') ? makeSelect() : makeEl();
    return body._byId[sel];
  };
  body.querySelectorAll = function (sel) {
    if (sel === '[data-tab]') return body._tabs;
    if (sel === '[data-rgo]') return body._rgos;
    return [];
  };
  return body;
}
function optionCount(selEl) { return (selEl._html.match(/<option /g) || []).length; }

function makeNavWorld(mem) {
  const opened = [], alerts = [];
  let opens = 0;
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const sandbox = {
    console: console, Promise: Promise, setTimeout: setTimeout,
    App: {
      _store: store,
      _esc: function (s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
      _today: function () { return '2026-10-15'; },
      openModule: function (id) { opened.push(id); }
    },
    Meticulous: { modules: {} },
    open: function () { opens++; },
    alert: function (m) { alerts.push(m); },
    confirm: function () { return true; }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(navSrc, sandbox, { filename: 'modules/navigation.js' });
  return { api: sandbox.Meticulous.modules.navigation, opened: opened, alerts: alerts, opens: function () { return opens; } };
}

/* ================= fake DOM (navigator consumption) ================= */
function torEl() {
  const e = {
    children: {}, style: {}, _html: '', textContent: '', value: '', onclick: null,
    classList: { _s: new Set(),
      add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); },
      toggle: function (c, on) { on ? this._s.add(c) : this._s.delete(c); },
      contains: function (c) { return this._s.has(c); } },
    querySelector: function (sel) { return e.children[sel] || null; },
    querySelectorAll: function () { return []; },
    getAttribute: function () { return null; }, setAttribute: function () {}
  };
  Object.defineProperty(e, 'innerHTML', {
    get: function () { return e._html; }, set: function (v) { e._html = String(v); }
  });
  return e;
}
function makeTorWorld(mem) {
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const ids = ['nv_banner', 'nv_map', 'nv_mode_truck', 'nv_mode_car', 'nv_follow', 'nv_mute',
    'nv_q', 'nv_search', 'nv_results', 'nv_destnote', 'nv_route', 'nv_end', 'nv_note', 'nv_steps'];
  const reg = {};
  ids.forEach(function (id) { reg[id] = torEl(); });
  reg.nv_banner.children['.nv-banner-main'] = torEl();
  reg.nv_banner.children['.nv-banner-sub'] = torEl();
  const body = torEl();
  body.querySelector = function (sel) { return reg[sel.slice(1)] || null; };
  const fetches = [];
  const sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, setTimeout: setTimeout,
    document: {},
    App: { _esc: function (s) { return String(s == null ? '' : s); }, _store: store },
    Meticulous: {},
    navigator: { geolocation: { watchPosition: function () { return 7; }, clearWatch: function () {} } },
    speechSynthesis: { cancel: function () {}, speak: function () {} },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    fetch: function (url) { fetches.push(url); return Promise.resolve({ ok: true, json: function () { return Promise.resolve([]); } }); }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(torSrc, sandbox, { filename: 'modules/navigator.js' });
  return { api: sandbox.Meticulous.modules.navigator, reg: reg, body: body, fetches: fetches };
}

(async function () {
  /* ================= A+B+C: the Navigation drive ================= */
  console.log('— A: one field, no card wall —');
  const mem = {};
  const w = makeNavWorld(mem);
  const body = makeNavBody();
  w.api.render(body);
  const sel = body.querySelector('#nv_sel');
  const detail = body.querySelector('#nv_detail');
  check('the filter input renders', body._html.indexOf('id="nv_q"') >= 0);
  check('the select renders', body._html.indexOf('id="nv_sel"') >= 0);
  check('all 25 built-ins are options in the ONE list', optionCount(sel) === 25, 'got ' + optionCount(sel));
  check('every option is tagged Built-in', (sel._html.match(/· Built-in/g) || []).length === 25);
  check('no external-app buttons anywhere', body._html.indexOf('Google Maps') < 0 && body._html.indexOf('Waze') < 0 &&
    body._html.indexOf('CoPilot') < 0 && body._html.indexOf('Apple Maps') < 0 && body._html.indexOf('data-navapp') < 0);
  check('no per-place cards (a built-in name appears once — its option)', (body._html + sel._html).split('Aecon Bradi Pit').length - 1 === 1,
    'count ' + ((body._html + sel._html).split('Aecon Bradi Pit').length - 1));
  check('nothing is selected yet — the panel asks for a pick, no Navigate offered', detail._html.indexOf('Pick a place') >= 0);
  check('the Add form starts hidden (not the landing face)', body._html.indexOf('id="nv_addwrap" style="display:none') >= 0);

  console.log('— C: add favorite behind its button —');
  body.querySelector('#nv_addopen').click();
  check('the button opens the form', body.querySelector('#nv_addwrap').style.display === 'block');
  body.querySelector('#nv_addcancel').click();
  check('Cancel closes it again', body.querySelector('#nv_addwrap').style.display === 'none');
  body.querySelector('#nv_addopen').click();
  body.querySelector('#nv_name').value = 'My Test Yard';
  body.querySelector('#nv_addr').value = '1 Industrial Rd';
  body.querySelector('#nv_type').value = 'pit';
  body.querySelector('#nv_add').click();
  check('the favorite saved', mem.nav_data && mem.nav_data.work.length === 1 && mem.nav_data.work[0].name === 'My Test Yard');
  check('back at the list the new place is SELECTED', detail._html.indexOf('My Test Yard') >= 0 && detail._html.indexOf('Yours') >= 0);
  check('the list now holds 26 options (25 built-ins + his)', optionCount(sel) === 26, 'got ' + optionCount(sel));
  check('the form closed itself after the save', body._html.indexOf('id="nv_addwrap" style="display:none') >= 0);

  console.log('— A: type to filter —');
  const q = body.querySelector('#nv_q');
  q.value = 'bradi'; q.fire('input');
  check('filter narrows to the matching place', optionCount(sel) === 1 && sel._html.indexOf('Aecon Bradi Pit') >= 0,
    'options ' + optionCount(sel));
  q.value = ''; q.fire('input');
  check('clearing the filter restores the full list', optionCount(sel) === 26);

  console.log('— B: Navigate a pinned built-in —');
  sel.value = 'bi-a2-l20'; sel.fire('change');
  check('the panel shows the place, tagged Built-in', detail._html.indexOf('A2-L20') >= 0 && detail._html.indexOf('Built-in') >= 0);
  check('the panel offers the ONE primary action', !!detail.querySelector('#nv_go').onclick);
  detail.querySelector('#nv_go').click();
  check('the hand-off carries the PIN (not a name search)', !!mem.nav_pending && mem.nav_pending.lat === 50.96649 && mem.nav_pending.lng === -114.03178,
    JSON.stringify(mem.nav_pending));
  check('the in-app Navigator opened', w.opened[w.opened.length - 1] === 'navigator');
  check('no external app was ever opened', w.opens() === 0);
  check('the visit hit the manifest feed (work)', (mem.manifest_feed || []).some(function (f) { return f.summary === 'Navigated to work site: A2-L20'; }));
  check('the recent entry keeps the pin', mem.nav_data.recent[0].name === 'A2-L20' && mem.nav_data.recent[0].lat === 50.96649);

  console.log('— B: Navigate an address-only built-in —');
  sel.value = 'bi-mobil-westwinds'; sel.fire('change');
  detail.querySelector('#nv_go').click();
  check('the hand-off carries the address as the search text', !!mem.nav_pending &&
    mem.nav_pending.query === 'Mobil — Westwinds, 300-3633 Westwinds Dr NE, Calgary' && mem.nav_pending.lat === undefined,
    JSON.stringify(mem.nav_pending));

  console.log('— C: remove a personal favorite from its panel —');
  const favId = mem.nav_data.work[0].id;
  sel.value = favId; sel.fire('change');
  check('a Yours place shows Remove in its panel', detail._html.indexOf('Remove this place') >= 0);
  detail.querySelector('#nv_remove').click();
  check('the favorite is gone', mem.nav_data.work.length === 0);
  check('the panel cleared with it', detail._html.indexOf('My Test Yard') < 0);

  console.log('— B: personal tab — never logged, still navigable —');
  mem.nav_data.personal = [{ id: 'p1', name: 'Home Depot', address: '99 Retail Ave' }];
  const feedBefore = (mem.manifest_feed || []).length;
  body._tabs.filter(function (t) { return t.getAttribute('data-tab') === 'personal'; })[0].click();
  check('personal list holds ONLY his place (no built-ins)', optionCount(sel) === 1 && sel._html.indexOf('Home Depot') >= 0 && sel._html.indexOf('Built-in') < 0,
    'options ' + optionCount(sel));
  sel.value = 'p1'; sel.fire('change');
  detail.querySelector('#nv_go').click();
  check('personal Navigate hands off the address', !!mem.nav_pending && mem.nav_pending.query === 'Home Depot, 99 Retail Ave');
  check('personal visits NEVER reach the manifest feed', (mem.manifest_feed || []).length === feedBefore);
  check('the personal recent is recorded as personal', mem.nav_data.recent[0].kind === 'personal');

  console.log('— B: Recent "Go again" rides the same hand-off —');
  w.api.render(body); /* returning to the screen re-renders the recents (as the app does) */
  const recId = mem.nav_data.recent[0].id;
  const rgo = body._rgos.filter(function (b) { return b.getAttribute('data-rgo') === recId; })[0];
  check('the recent row rendered a Go again', !!rgo);
  delete mem.nav_pending;
  if (rgo) rgo.click();
  check('Go again re-hands the destination + opens the Navigator',
    !!mem.nav_pending && mem.nav_pending.query === 'Home Depot, 99 Retail Ave' && w.opened[w.opened.length - 1] === 'navigator');

  /* ================= D: the Navigator consumes it ================= */
  console.log('— D: Navigator consumes a pinned hand-off —');
  {
    const m2 = { nav_pending: { name: 'A2-L20', lat: 50.96649, lng: -114.03178, ts: 1 } };
    const t = makeTorWorld(m2);
    t.api.render(t.body);
    check('the pending record is consumed (deleted)', !('nav_pending' in m2));
    check('the destination note names the place (setDest ran)', t.reg.nv_destnote.textContent.indexOf('Destination: A2-L20') >= 0,
      t.reg.nv_destnote.textContent);
    t.api.teardown && t.api.teardown();
  }
  console.log('— D: Navigator consumes an address-only hand-off —');
  {
    const m3 = { nav_pending: { name: 'Mobil — Westwinds', query: 'Mobil — Westwinds, 300-3633 Westwinds Dr NE, Calgary', ts: 1 } };
    const t3 = makeTorWorld(m3);
    t3.api.render(t3.body);
    check('the search box is filled with the handed-over address', t3.reg.nv_q.value === 'Mobil — Westwinds, 300-3633 Westwinds Dr NE, Calgary',
      t3.reg.nv_q.value);
    check('the search actually ran (Nominatim fetch)', t3.fetches.some(function (u) { return u.indexOf('nominatim.openstreetmap.org/search') >= 0 && u.indexOf('Westwinds') >= 0; }),
      JSON.stringify(t3.fetches));
    check('the pending record is consumed (deleted)', !('nav_pending' in m3));
    await tick();
    t3.api.teardown && t3.api.teardown();
  }

  console.log('\nnav-dropdown test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR', e); process.exit(2); });
