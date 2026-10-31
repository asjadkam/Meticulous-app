#!/usr/bin/env node
/* Meticulous v294 — PLACES-NO-EDIT-LOCATION (owner evidence
 * Oct 31, 2026): a saved place (Navigator > Places) offered only
 * "Navigate" and "Remove this place" — no way to change its
 * location; the Add form takes only a text address. The owner
 * ordered the "Remington" place moved from 50.9605833, -114.03 to
 * the site's new location 50.956372, -114.026439 and it could not
 * be done.
 *
 * The v294 contract, driven here against the REAL
 * modules/navigation.js:
 *  - A favorite's detail carries "Re-pin to my location" (one tap:
 *    the place takes the device's current GPS fix through the
 *    app's usual MeticulousGeo.getCurrent cascade) and an
 *    Advanced section with Latitude / Longitude fields whose Save
 *    writes the SAME record (no duplicate place).
 *  - Name / type / note / visits / lastVisit ride through every
 *    location change untouched; the record keeps its id.
 *  - Every location write stamps the record's updAt (the v293
 *    version-stamp rule: the newest version of a record is the
 *    one sync keeps) and goes through the one saveData door.
 *  - Ranges are validated (lat -90..90, lng -180..180); junk,
 *    blanks and out-of-range values change nothing.
 *  - Built-ins get NO edit controls (they are not the user's
 *    records) and setPlaceCoords refuses their ids.
 *
 * Run: node tools/places-edit-location-v294-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const navSrc = fs.readFileSync(path.join(ROOT, 'modules', 'navigation.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function tick() { return new Promise(function (r) { setTimeout(r, 10); }); }

/* ================= fake DOM (adapted from nav-dropdown-test) == */
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
function makeSelect() {
  const e = makeEl();
  Object.defineProperty(e, 'innerHTML', {
    configurable: true,
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
    configurable: true,
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
function firstPid(resEl) { const m = /data-pid="([^"]+)"/.exec(resEl._html); return m && m[1]; }

/* ================= world ================= */
const REM_ID = 'nrem294';
const OLD_LAT = 50.9605833, OLD_LNG = -114.03;
const NEW_LAT = 50.956372, NEW_LNG = -114.026439;
function seedMem() {
  return {
    nav_places_migrated: 91,
    nav_data: {
      work: [{ id: REM_ID, name: 'Remington', type: 'job site',
               note: 'Also the entrance for Pier 3', address: '',
               lat: OLD_LAT, lng: OLD_LNG, visits: 5, lastVisit: Date.now() - 60000 }],
      personal: [{ id: 'nhome294', name: 'Home', address: '1243 Cornerstone Blvd NE, Calgary',
                   lat: 51.15709, lng: -113.93862 }],
      recent: []
    }
  };
}
function makeWorld(mem, geo) {
  const opened = [], alerts = [];
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
      _today: function () { return '2026-10-31'; },
      openModule: function (id) { opened.push(id); }
    },
    Meticulous: { modules: {} },
    alert: function (m) { alerts.push(m); },
    confirm: function () { return true; }
  };
  if (geo !== undefined) sandbox.MeticulousGeo = geo;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(navSrc, sandbox, { filename: 'modules/navigation.js' });
  return { api: sandbox.Meticulous.modules.navigation, opened: opened, alerts: alerts };
}
function rem(mem) { return (mem.nav_data.work || []).filter(function (f) { return f.id === REM_ID; })[0]; }

(async function () {
  console.log('PLACES-NO-EDIT-LOCATION v294');

  /* ---- A: the API surface exists ---- */
  {
    const mem = seedMem();
    const w = makeWorld(mem, { available: function () { return true; },
      getCurrent: function () { return Promise.resolve(null); } });
    check('A1 api.setPlaceCoords exists', typeof w.api.setPlaceCoords === 'function');
    check('A2 api.repinPlace exists', typeof w.api.repinPlace === 'function');
  }

  /* ---- B: setPlaceCoords — the same record, stamped ---- */
  {
    const mem = seedMem();
    const w = makeWorld(mem, undefined);
    const before = Date.now();
    const out = (typeof w.api.setPlaceCoords === 'function')
      ? w.api.setPlaceCoords('work', REM_ID, NEW_LAT, NEW_LNG) : null;
    const r = rem(mem);
    check('B1 save returns the record', !!out && out.id === REM_ID);
    check('B2 no duplicate place (work list still 1)', mem.nav_data.work.length === 1, 'len=' + mem.nav_data.work.length);
    check('B3 lat/lng are the new numbers', r && r.lat === NEW_LAT && r.lng === NEW_LNG,
      r ? (r.lat + ',' + r.lng) : 'no record');
    check('B4 name/type/note/visits/lastVisit untouched',
      !!r && r.name === 'Remington' && r.type === 'job site' &&
      r.note === 'Also the entrance for Pier 3' && r.visits === 5 && typeof r.lastVisit === 'number');
    check('B5 updAt stamped at the edit (v293 version rule)',
      !!r && typeof r.updAt === 'number' && r.updAt >= before && r.updAt <= Date.now() + 5000,
      r ? 'updAt=' + r.updAt : 'no record');
    check('B6 personal places untouched', mem.nav_data.personal.length === 1 && mem.nav_data.personal[0].lat === 51.15709);
  }

  /* ---- C: typed strings (the Advanced fields) + validation ---- */
  {
    const mem = seedMem();
    const w = makeWorld(mem, undefined);
    if (typeof w.api.setPlaceCoords === 'function') {
      const out = w.api.setPlaceCoords('work', REM_ID, '50.956372', '-114.026439');
      check('C1 string coordinates accepted, stored as numbers',
        !!out && rem(mem).lat === NEW_LAT && typeof rem(mem).lat === 'number');
    } else check('C1 string coordinates accepted, stored as numbers', false, 'no api');
    const bad = [[91, 0], [0, -181], [-90.5, 0], ['abc', 0], ['', ''], [null, null], [undefined, 5], ['  ', '10']];
    let allRejected = true, stillNew = true;
    if (typeof w.api.setPlaceCoords === 'function') {
      bad.forEach(function (pair) {
        if (w.api.setPlaceCoords('work', REM_ID, pair[0], pair[1]) !== null) allRejected = false;
      });
      const r = rem(mem);
      stillNew = r.lat === NEW_LAT && r.lng === NEW_LNG && mem.nav_data.work.length === 1;
    } else { allRejected = false; stillNew = false; }
    check('C2 out-of-range / junk / blank all rejected', allRejected);
    check('C3 rejected saves change nothing', stillNew);
    check('C4 built-in ids refused (not the user\'s record)',
      typeof w.api.setPlaceCoords === 'function'
        ? w.api.setPlaceCoords('work', 'bi-burnco-indus-aggregate-pit', 1, 1) === null : false);
    check('C5 unknown id refused',
      typeof w.api.setPlaceCoords === 'function'
        ? w.api.setPlaceCoords('work', 'nope', 1, 1) === null : false);
    check('C6 bad kind refused',
      typeof w.api.setPlaceCoords === 'function'
        ? w.api.setPlaceCoords('yard', REM_ID, 1, 1) === null : false);
  }

  /* ---- D: re-pin through the app's GPS cascade ---- */
  {
    const mem = seedMem();
    const fix = { latitude: NEW_LAT, longitude: NEW_LNG, accuracy: 6, time: Date.now() };
    const w = makeWorld(mem, { available: function () { return true; },
      getCurrent: function () { return Promise.resolve(fix); } });
    let ok = false;
    if (typeof w.api.repinPlace === 'function') ok = await w.api.repinPlace('work', REM_ID);
    const r = rem(mem);
    check('D1 re-pin resolves true on a fix', ok === true);
    check('D2 the place now sits on the fix', !!r && r.lat === NEW_LAT && r.lng === NEW_LNG);
    check('D3 re-pin kept the record whole (id/name/visits, updAt stamped)',
      !!r && r.id === REM_ID && r.name === 'Remington' && r.visits === 5 &&
      typeof r.updAt === 'number' && mem.nav_data.work.length === 1);
  }
  {
    const mem = seedMem();
    const w = makeWorld(mem, { available: function () { return true; },
      getCurrent: function () { return Promise.resolve(null); } });
    let ok = true;
    if (typeof w.api.repinPlace === 'function') ok = await w.api.repinPlace('work', REM_ID);
    else ok = 'missing';
    const r = rem(mem);
    check('D4 no fix -> resolves false, place unmoved',
      ok === false && !!r && r.lat === OLD_LAT && r.lng === OLD_LNG);
  }
  {
    const mem = seedMem();
    const w = makeWorld(mem, undefined); /* no MeticulousGeo at all */
    let ok = true;
    if (typeof w.api.repinPlace === 'function') ok = await w.api.repinPlace('work', REM_ID);
    else ok = 'missing';
    check('D5 no geo capability -> resolves false, no throw', ok === false && rem(mem).lat === OLD_LAT);
  }

  /* ---- E: the detail surface (real render) ---- */
  {
    const mem = seedMem();
    const fix = { latitude: NEW_LAT, longitude: NEW_LNG, accuracy: 6, time: Date.now() };
    const w = makeWorld(mem, { available: function () { return true; },
      getCurrent: function () { return Promise.resolve(fix); } });
    const body = makeNavBody();
    w.api.render(body);
    const resEl = body._byId['#nv_results'];
    const detail = body._byId['#nv_detail'];
    const pid = firstPid(resEl);
    check('E1 the seeded favorite renders as a row', !!pid, resEl._html.slice(0, 120));
    if (pid) resEl.pick(pid);
    check('E2 detail carries Re-pin to my location', detail._html.indexOf('Re-pin to my location') >= 0, detail._html.slice(0, 200));
    check('E3 detail carries the Advanced lat/lng fields',
      detail._html.indexOf('Advanced') >= 0 && detail._html.indexOf('id="nv_adv_lat"') >= 0 && detail._html.indexOf('id="nv_adv_lng"') >= 0);
    check('E4 Navigate + Remove unchanged',
      detail._html.indexOf('Navigate') >= 0 && detail._html.indexOf('Remove this place') >= 0);

    /* E5: the Advanced Save wiring moves the record */
    detail.querySelector('#nv_adv_lat').value = '50.956372';
    detail.querySelector('#nv_adv_lng').value = '-114.026439';
    detail.querySelector('#nv_adv_save').click();
    const r1 = rem(mem);
    check('E5 Advanced Save writes the same record (no duplicate)',
      !!r1 && r1.lat === NEW_LAT && r1.lng === NEW_LNG && mem.nav_data.work.length === 1 && typeof r1.updAt === 'number');

    /* E6: invalid Advanced values alert and change nothing */
    const alertsBefore = w.alerts.length;
    detail.querySelector('#nv_adv_lat').value = '95';
    detail.querySelector('#nv_adv_lng').value = '0';
    detail.querySelector('#nv_adv_save').click();
    const r2 = rem(mem);
    check('E6 out-of-range Advanced save alerts, record unmoved',
      w.alerts.length === alertsBefore + 1 && r2.lat === NEW_LAT && r2.lng === NEW_LNG);

    /* E7: the Re-pin button wiring lands the GPS fix */
    detail.querySelector('#nv_repin').click();
    await tick(); await tick();
    const r3 = rem(mem);
    check('E7 Re-pin button lands the current fix on the record',
      !!r3 && r3.lat === NEW_LAT && r3.lng === NEW_LNG && mem.nav_data.work.length === 1);
  }

  /* ---- F: built-ins show no edit controls ---- */
  {
    const mem = seedMem();
    const w = makeWorld(mem, undefined);
    const body = makeNavBody();
    w.api.render(body);
    const qEl = body._byId['#nv_q'];
    qEl.value = 'BURNCO';
    qEl.fire('input');
    const resEl = body._byId['#nv_results'];
    const detail = body._byId['#nv_detail'];
    const pid = firstPid(resEl);
    check('F1 a built-in renders as a row under filter', !!pid && pid.indexOf('bi-') === 0, resEl._html.slice(0, 120));
    if (pid) resEl.pick(pid);
    check('F2 built-in detail has NO re-pin / Advanced fields',
      detail._html.indexOf('Re-pin to my location') < 0 && detail._html.indexOf('nv_adv_lat') < 0,
      detail._html.slice(0, 200));
    check('F3 built-in detail still navigates', detail._html.indexOf('Navigate') >= 0);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR', e && e.stack || e); process.exit(2); });
