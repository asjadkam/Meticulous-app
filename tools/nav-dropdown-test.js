#!/usr/bin/env node
/* Meticulous v91 — NAVIGATION PLACES: THE DROPDOWN, DRIVEN, and
 * THE GREAT PLACES MOVE.
 *
 * v87 contract: ONE filter input drives the picker, one primary
 * action (Navigate, into the app's OWN Navigator via the
 * nav_pending hand-off), the Add form behind its button, work
 * visits logged to the Manifest, personal visits never logged.
 * v102: the <select> listbox is GONE (owner: with 48 favorites it
 * was a cramped scroll-box with truncated names) — matches render
 * as full-width tappable rows (data-pid) with FULL names, one tap
 * picks, and the default order is most-recent / most-visited /
 * alphabetical. This suite drives the rows the way a thumb does.
 * v103: the default view is RECENTS ONLY (owner: "why these
 * endless endless lists") — at most 6 most-recently-visited
 * places; the full list renders ONLY as filter matches while
 * typing. The v102-era checks that pinned the full list as the
 * default are re-pinned below to the recents default; every
 * other contract (migration, dedupe, hand-off, visit logging,
 * delete-sticks, personal-never-logged) is unchanged.
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
/* v102: the results-list stub. Setting its innerHTML parses the
   data-pid rows the module paints; rows are cached per paint so
   the onclick the module wires survives until the next paint, and
   pick(id) clicks the row a driver would tap. */
function makeResults() {
  const e = makeEl();
  e._rows = {};
  Object.defineProperty(e, 'innerHTML', {
    configurable: true,
    get: function () { return e._html; },
    set: function (v) {
      e._html = String(v);
      e._rows = {};
      const re = /data-pid="([^"]+)"/g;
      let m;
      while ((m = re.exec(e._html))) {
        const pid = m[1];
        e._rows[pid] = { _pid: pid, onclick: null,
          getAttribute: function (n) { return n === 'data-pid' ? pid : null; },
          click: function () { if (this.onclick) this.onclick(); } };
      }
    }
  });
  e.querySelectorAll = function (sel) {
    if (sel !== '[data-pid]') return [];
    return Object.keys(e._rows).map(function (k) { return e._rows[k]; });
  };
  e.pick = function (pid) { const r = e._rows[pid]; if (r) r.click(); };
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
    if (!body._byId[sel]) body._byId[sel] = (sel === '#nv_yard') ? makeSelect() : (sel === '#nv_results') ? makeResults() : makeEl();
    return body._byId[sel];
  };
  body.querySelectorAll = function (sel) {
    if (sel === '[data-tab]') return body._tabs;
    if (sel === '[data-rgo]') return body._rgos;
    return [];
  };
  return body;
}
function rowCount(resEl) { return (resEl._html.match(/data-pid=/g) || []).length; }
function firstPid(resEl) { const m = /data-pid="([^"]+)"/.exec(resEl._html); return m && m[1]; }

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
  const resF = bf.querySelector('#nv_results');
  const detailF = bf.querySelector('#nv_detail');
  check('the filter input renders', bf._html.indexOf('id="nv_q"') >= 0);
  check('v102: the results list renders (and NO select listbox)', bf._html.indexOf('id="nv_results"') >= 0 && bf._html.indexOf('id="nv_sel"') < 0);
  check('the Yard pick renders (one quiet select)', bf._html.indexOf('id="nv_yard"') >= 0);
  check('v103: a fresh default list is the RECENTS view — nothing visited yet, so NO rows (never the wall)',
    rowCount(resF) === 0 && resF._html.indexOf('type above to find any place') >= 0, 'got ' + rowCount(resF));
  check('NONE of the owner’s 25 is anywhere on the fresh screen',
    ['Aecon Bradi Pit', '12th Street', 'A2-L20', 'Simply Stone', 'P Hauling yard', 'Mobil — Westwinds', 'Pier 3', 'North Plant']
      .every(function (n) { return (bf._html + resF._html).indexOf(n) < 0; }));
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
  check('v103: the new (never visited) favorite does NOT join the default list — recents stay empty until a visit',
    rowCount(resF) === 0, 'got ' + rowCount(resF));

  console.log('— FRESH: filter + navigate a famous built-in —');
  const qF = bf.querySelector('#nv_q');
  qF.value = 'pit'; qF.fire('input');
  check('v103: typing renders the full list AS MATCHES — both famous pits (tagged Built-in) + his pit-typed favorite',
    rowCount(resF) === 3 && (resF._html.match(/· Built-in/g) || []).length === 2 &&
    resF._html.indexOf('Stoney Pit') >= 0 && resF._html.indexOf('Volker Stevin') >= 0 &&
    resF._html.indexOf('My Test Yard') >= 0, 'got ' + rowCount(resF));
  check('v103: unvisited matches order alphabetically (My Test Yard, then Stoney before Volker)',
    firstPid(resF) === memF.nav_data.work[0].id &&
    resF._html.indexOf('Stoney Pit') < resF._html.indexOf('Volker Stevin'));
  qF.value = 'test yard'; qF.fire('input');
  check('v102: a partial word finds the favorite by its FULL name', rowCount(resF) === 1 && resF._html.indexOf('My Test Yard') >= 0);
  qF.value = ''; qF.fire('input');
  check('v103: clearing the filter returns to the RECENTS view (still empty — nothing visited yet)', rowCount(resF) === 0);
  qF.value = 'stoney'; qF.fire('input');
  check('filter narrows to ONLY the matching famous pit', rowCount(resF) === 1 && resF._html.indexOf('Stoney Pit') >= 0 && resF._html.indexOf('Volker Stevin') < 0);
  resF.pick('bi-stoney-pit');
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
  wf.api.render(bf);
  qF.value = ''; qF.fire('input');
  check('v103: after the visit, the default list IS the recents — Stoney, alone',
    rowCount(resF) === 1 && firstPid(resF) === 'bi-stoney-pit', 'got ' + rowCount(resF));

  /* ================= EXISTING: his 25 come home as favorites ================= */
  console.log('— EXISTING: the upgrade migration —');
  const mem = { nav_data: { work: [], personal: [{ id: 'home1', name: 'Home', address: '1243 Cornerstone Blvd NE' }], recent: [] } };
  const w = makeNavWorld(mem);
  const body = makeNavBody();
  w.api.render(body);
  const res = body.querySelector('#nv_results');
  const detail = body.querySelector('#nv_detail');
  check('all 25 arrived as work favorites', mem.nav_data.work.length === 25, 'got ' + mem.nav_data.work.length);
  check('v103: the default work list is the RECENTS view — none of the 27 is dumped on screen before typing',
    rowCount(res) === 0, 'got ' + rowCount(res));
  const qAll = body.querySelector('#nv_q');
  qAll.value = 'e'; qAll.fire('input');
  check('v103: typing renders the FULL combined list as matches (2 built-ins + his 25)',
    rowCount(res) === 27, 'got ' + rowCount(res));
  check('his 25 are tagged Yours', (res._html.match(/· Yours/g) || []).length === 25);
  check('the famous two are tagged Built-in', (res._html.match(/· Built-in/g) || []).length === 2);
  qAll.value = ''; qAll.fire('input');
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
  check('filter narrows to ONLY the migrated favorite', rowCount(res) === 1 && res._html.indexOf('Aecon Bradi Pit') >= 0 && res._html.indexOf('Yours') >= 0);
  q.value = ''; q.fire('input');
  check('v103: clearing the filter returns to the RECENTS view (empty until a visit)', rowCount(res) === 0);
  q.value = 'bradi'; q.fire('input');
  res.pick(bradi.id);
  check('the panel shows the migrated place as Yours, with Remove', detail._html.indexOf('Aecon Bradi Pit') >= 0 &&
    detail._html.indexOf('Yours') >= 0 && detail._html.indexOf('Remove this place') >= 0);
  detail.querySelector('#nv_go').click();
  check('Navigate hands over the migrated PIN', !!mem.nav_pending && mem.nav_pending.lat === 51.27206 && mem.nav_pending.lng === -114.43179,
    JSON.stringify(mem.nav_pending));
  check('the visit hit the manifest feed', (mem.manifest_feed || []).some(function (f) { return f.summary === 'Navigated to work site: Aecon Bradi Pit'; }));
  check('the visit counted on the favorite', favByName(mem, 'Aecon Bradi Pit').visits === 1);
  w.api.render(body);
  q.value = ''; q.fire('input');
  check('v103: after a visit, the default list IS the recents — the visited place, alone in front',
    rowCount(body.querySelector('#nv_results')) === 1 && firstPid(body.querySelector('#nv_results')) === bradi.id,
    'rows=' + rowCount(body.querySelector('#nv_results')) + ' first=' + firstPid(body.querySelector('#nv_results')));
  q.value = 'westwinds'; q.fire('input');
  res.pick(mob.id);
  detail.querySelector('#nv_go').click();
  check('the pin-less favorite hands over its address as the search text', !!mem.nav_pending &&
    mem.nav_pending.query === 'Mobil — Westwinds, 300-3633 Westwinds Dr NE, Calgary' && mem.nav_pending.lat === undefined,
    JSON.stringify(mem.nav_pending));

  console.log('— EXISTING: a deleted migrated favorite STAYS deleted —');
  const stone = favByName(mem, 'Simply Stone');
  q.value = 'simply'; q.fire('input');
  res.pick(stone.id);
  detail.querySelector('#nv_remove').click();
  check('the favorite is gone', mem.nav_data.work.length === 24 && !favByName(mem, 'Simply Stone'));
  check('re-running the migration adds nothing back', w.api.migrateLegacyPlaces() === 0 && mem.nav_data.work.length === 24);
  w.api.render(body);
  q.value = 'e'; q.fire('input');
  check('after a re-render it is still gone (26 matches, no Simply Stone)',
    !favByName(mem, 'Simply Stone') && rowCount(body.querySelector('#nv_results')) === 26 &&
    body.querySelector('#nv_results')._html.indexOf('Simply Stone') < 0,
    'rows=' + rowCount(body.querySelector('#nv_results')));
  q.value = ''; q.fire('input');

  console.log('— EXISTING: personal tab — his Home, never logged —');
  body._tabs.filter(function (t) { return t.getAttribute('data-tab') === 'personal'; })[0].click();
  const resP = body.querySelector('#nv_results');
  check('v103: the personal default is recents too (Home unvisited → no rows yet)', rowCount(resP) === 0, 'rows ' + rowCount(resP));
  const qP = body.querySelector('#nv_q');
  qP.value = 'home'; qP.fire('input');
  check('personal list holds ONLY his Home (no built-ins, no work favorites)', rowCount(resP) === 1 && resP._html.indexOf('Home') >= 0 && resP._html.indexOf('Built-in') < 0,
    'rows ' + rowCount(resP));
  const feedBefore = (mem.manifest_feed || []).length;
  resP.pick('home1');
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
