#!/usr/bin/env node
/* Meticulous v91 — NAVIGATION PLACES: THE DROPDOWN, DRIVEN, and
 * THE GREAT PLACES MOVE.
 *
 * v87 contract (unchanged): ONE filter input + ONE select, one
 * primary action (Navigate, into the app's OWN Navigator via the
 * nav_pending hand-off), the Add form behind its button, work
 * visits logged to the Manifest, personal visits never logged.
 *
 * v91 (owner, Oct 16, 2026): the shipped dropdown no longer holds
 * his 25 personal places as built-ins — a fresh install shows
 * only the small FAMOUS public set (verified pins, see
 * nav-places-test). An install that predates the removal gets
 * the 25 copied ONCE into its own work favorites (byte-exact,
 * deduped, flag-guarded) — the owner keeps everything, tagged
 * "Yours", and a favorite he deletes stays deleted.
 *
 * Driven here against the REAL modules:
 *  FRESH world: 2 built-in options, no owner places anywhere,
 *     the migration flag set with NOTHING copied.
 *  EXISTING world (his shape: a Home personal place, no work
 *     favorites): the 25 arrive as Yours with exact pins, the
 *     pin-less Mobils stay pin-less, visits log, deletion sticks.
 *  DEDUPE world: a name-duplicate and a pin-duplicate are not
 *     doubled.
 *  D: the Navigator consumes nav_pending exactly as in v87.
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
    if (!body._byId[sel]) body._byId[sel] = (sel === '#nv_sel' || sel === '#nv_yard') ? makeSelect() : makeEl();
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
      _today: function () { return '2026-10-16'; },
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

function favByName(mem, name) {
  return (mem.nav_data.work || []).filter(function (f) { return f.name === name; })[0];
}

(async function () {
  /* ================= FRESH: the product ships clean ================= */
  console.log('— FRESH: a new install — famous pits only, nothing of his —');
  const memF = {};
  const wf = makeNavWorld(memF);
  const bf = makeNavBody();
  wf.api.render(bf);
  const selF = bf.querySelector('#nv_sel');
  const detailF = bf.querySelector('#nv_detail');
  check('the filter input renders', bf._html.indexOf('id="nv_q"') >= 0);
  check('the select renders', bf._html.indexOf('id="nv_sel"') >= 0);
  check('the Yard pick renders (one quiet select)', bf._html.indexOf('id="nv_yard"') >= 0);
  check('fresh dropdown holds EXACTLY the 2 famous built-ins', optionCount(selF) === 2, 'got ' + optionCount(selF));
  check('both are tagged Built-in', (selF._html.match(/· Built-in/g) || []).length === 2);
  check('Stoney Pit and Volker Stevin are the two', selF._html.indexOf('Stoney Pit') >= 0 && selF._html.indexOf('Volker Stevin') >= 0);
  check('NONE of the owner’s 25 is anywhere on the fresh screen',
    ['Aecon Bradi Pit', '12th Street', 'A2-L20', 'Simply Stone', 'P Hauling yard', 'Mobil — Westwinds', 'Pier 3', 'North Plant']
      .every(function (n) { return (bf._html + selF._html).indexOf(n) < 0; }));
  check('nothing copied into favorites on a fresh install', !memF.nav_data || !(memF.nav_data.work || []).length);
  check('the migration flag was still set (never re-runs)', memF.nav_places_migrated === 91, JSON.stringify(memF.nav_places_migrated));
  check('the panel asks for a pick, plainly', detailF._html.indexOf('Pick a place above.') >= 0);
  check('no external-app buttons anywhere', bf._html.indexOf('Google Maps') < 0 && bf._html.indexOf('Waze') < 0 &&
    bf._html.indexOf('CoPilot') < 0 && bf._html.indexOf('Apple Maps') < 0 && bf._html.indexOf('data-navapp') < 0);
  check('the Add form starts hidden (not the landing face)', bf._html.indexOf('id="nv_addwrap" style="display:none') >= 0);

  console.log('— FRESH: add favorite behind its button —');
  bf.querySelector('#nv_addopen').click();
  check('the button opens the form', bf.querySelector('#nv_addwrap').style.display === 'block');
  bf.querySelector('#nv_addcancel').click();
  check('Cancel closes it again', bf.querySelector('#nv_addwrap').style.display === 'none');
  bf.querySelector('#nv_addopen').click();
  bf.querySelector('#nv_name').value = 'My Test Yard';
  bf.querySelector('#nv_addr').value = '1 Industrial Rd';
  bf.querySelector('#nv_type').value = 'pit';
  bf.querySelector('#nv_add').click();
  check('the favorite saved', memF.nav_data && memF.nav_data.work.length === 1 && memF.nav_data.work[0].name === 'My Test Yard');
  check('back at the list the new place is SELECTED, tagged Yours', detailF._html.indexOf('My Test Yard') >= 0 && detailF._html.indexOf('Yours') >= 0);
  check('the list now holds 3 options (2 famous + his)', optionCount(selF) === 3, 'got ' + optionCount(selF));

  console.log('— FRESH: filter + navigate a famous built-in —');
  const qF = bf.querySelector('#nv_q');
  qF.value = 'stoney'; qF.fire('input');
  check('filter narrows to the matching famous pit', optionCount(selF) === 1 && selF._html.indexOf('Stoney Pit') >= 0);
  qF.value = ''; qF.fire('input');
  check('clearing the filter restores the full list', optionCount(selF) === 3);
  selF.value = 'bi-stoney-pit'; selF.fire('change');
  check('the panel shows the place, tagged Built-in', detailF._html.indexOf('Stoney Pit') >= 0 && detailF._html.indexOf('Built-in') >= 0);
  check('the panel offers the ONE primary action', !!detailF.querySelector('#nv_go').onclick);
  detailF.querySelector('#nv_go').click();
  check('the hand-off carries the VERIFIED public pin', !!memF.nav_pending && memF.nav_pending.lat === 51.165429 && memF.nav_pending.lng === -114.213202,
    JSON.stringify(memF.nav_pending));
  check('the in-app Navigator opened', wf.opened[wf.opened.length - 1] === 'navigator');
  check('no external app was ever opened', wf.opens() === 0);
  check('the visit hit the manifest feed (work)', (memF.manifest_feed || []).some(function (f) { return f.summary.indexOf('Navigated to work site: Stoney Pit') === 0; }),
    JSON.stringify(memF.manifest_feed));
  check('the recent entry keeps the pin', memF.nav_data.recent[0].name === 'Stoney Pit' && memF.nav_data.recent[0].lat === 51.165429);

  /* ================= EXISTING: his 25 come home as favorites ================= */
  console.log('— EXISTING: the upgrade migration —');
  const mem = { nav_data: { work: [], personal: [{ id: 'home1', name: 'Home', address: '1243 Cornerstone Blvd NE' }], recent: [] } };
  const w = makeNavWorld(mem);
  const body = makeNavBody();
  w.api.render(body);
  const sel = body.querySelector('#nv_sel');
  const detail = body.querySelector('#nv_detail');
  check('all 25 arrived as work favorites', mem.nav_data.work.length === 25, 'got ' + mem.nav_data.work.length);
  check('the work list shows 2 built-ins + his 25', optionCount(sel) === 27, 'got ' + optionCount(sel));
  check('his 25 are tagged Yours', (sel._html.match(/· Yours/g) || []).length === 25);
  check('the famous two are tagged Built-in', (sel._html.match(/· Built-in/g) || []).length === 2);
  const a2 = favByName(mem, 'A2-L20');
  check('A2-L20 kept its exact pin', !!a2 && a2.lat === 50.96649 && a2.lng === -114.03178, JSON.stringify(a2));
  const bradi = favByName(mem, 'Aecon Bradi Pit');
  check('Aecon Bradi Pit kept pin + note', !!bradi && bradi.lat === 51.27206 && bradi.lng === -114.43179 && bradi.note === 'Loads 80mm · near Cochrane');
  const mob = favByName(mem, 'Mobil — Westwinds');
  check('Mobil — Westwinds stayed pin-less with its address', !!mob && mob.lat === undefined && mob.address === '300-3633 Westwinds Dr NE, Calgary');
  check('his personal Home was NOT touched by the migration', mem.nav_data.personal.length === 1 && mem.nav_data.personal[0].id === 'home1');
  check('the migration flag is set', mem.nav_places_migrated === 91);
  check('the Yard select offers Automatic — Home place', bf && body.querySelector('#nv_yard')._html.indexOf('Automatic — Home place') >= 0);

  console.log('— EXISTING: filter, navigate, log —');
  const q = body.querySelector('#nv_q');
  q.value = 'bradi'; q.fire('input');
  check('filter narrows to the migrated favorite', optionCount(sel) === 1 && sel._html.indexOf('Aecon Bradi Pit') >= 0 && sel._html.indexOf('Yours') >= 0);
  q.value = ''; q.fire('input');
  check('clearing the filter restores all 27', optionCount(sel) === 27);
  sel.value = bradi.id; sel.fire('change');
  check('the panel shows the migrated place as Yours, with Remove', detail._html.indexOf('Aecon Bradi Pit') >= 0 &&
    detail._html.indexOf('Yours') >= 0 && detail._html.indexOf('Remove this place') >= 0);
  detail.querySelector('#nv_go').click();
  check('Navigate hands over the migrated PIN', !!mem.nav_pending && mem.nav_pending.lat === 51.27206 && mem.nav_pending.lng === -114.43179,
    JSON.stringify(mem.nav_pending));
  check('the visit hit the manifest feed', (mem.manifest_feed || []).some(function (f) { return f.summary === 'Navigated to work site: Aecon Bradi Pit'; }));
  check('the visit counted on the favorite', favByName(mem, 'Aecon Bradi Pit').visits === 1);
  sel.value = mob.id; sel.fire('change');
  detail.querySelector('#nv_go').click();
  check('the pin-less favorite hands over its address as the search text', !!mem.nav_pending &&
    mem.nav_pending.query === 'Mobil — Westwinds, 300-3633 Westwinds Dr NE, Calgary' && mem.nav_pending.lat === undefined,
    JSON.stringify(mem.nav_pending));

  console.log('— EXISTING: a deleted migrated favorite STAYS deleted —');
  const stone = favByName(mem, 'Simply Stone');
  sel.value = stone.id; sel.fire('change');
  detail.querySelector('#nv_remove').click();
  check('the favorite is gone', mem.nav_data.work.length === 24 && !favByName(mem, 'Simply Stone'));
  check('re-running the migration adds nothing back', w.api.migrateLegacyPlaces() === 0 && mem.nav_data.work.length === 24);
  w.api.render(body);
  check('after a re-render it is still gone', !favByName(mem, 'Simply Stone') && optionCount(sel) === 26);

  console.log('— EXISTING: personal tab — his Home, never logged —');
  body._tabs.filter(function (t) { return t.getAttribute('data-tab') === 'personal'; })[0].click();
  check('personal list holds ONLY his Home (no built-ins, no work favorites)', optionCount(sel) === 1 && sel._html.indexOf('Home') >= 0 && sel._html.indexOf('Built-in') < 0,
    'options ' + optionCount(sel));
  const feedBefore = (mem.manifest_feed || []).length;
  sel.value = 'home1'; sel.fire('change');
  detail.querySelector('#nv_go').click();
  check('personal Navigate hands off the address', !!mem.nav_pending && mem.nav_pending.query === 'Home, 1243 Cornerstone Blvd NE');
  check('personal visits NEVER reach the manifest feed', (mem.manifest_feed || []).length === feedBefore);

  /* ================= DEDUPE ================= */
  console.log('— DEDUPE: name-twin and pin-twin are not doubled —');
  const memD = { nav_data: { work: [
    { id: 'x1', name: 'aecon bradi pit', address: '', type: 'pit', visits: 3 },
    { id: 'x2', name: 'My A2 spot', address: '', type: 'job site', lat: 50.96649, lng: -114.03178, visits: 0 }
  ], personal: [], recent: [] } };
  const wd = makeNavWorld(memD);
  const bd = makeNavBody();
  wd.api.render(bd);
  check('23 added around the 2 pre-existing (25 total, not 27)', memD.nav_data.work.length === 25, 'got ' + memD.nav_data.work.length);
  check('exactly one Bradi (case-insensitive name match)', memD.nav_data.work.filter(function (f) { return /bradi/i.test(f.name); }).length === 1);
  check('exactly one favorite on the A2-L20 pin (pin match)', memD.nav_data.work.filter(function (f) { return f.lat === 50.96649 && f.lng === -114.03178; }).length === 1);
  check('no favorite literally named A2-L20 was added', !favByName(memD, 'A2-L20'));
  check('the pre-existing favorites kept their visits', (memD.nav_data.work.filter(function (f) { return f.id === 'x1'; })[0] || {}).visits === 3);

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
