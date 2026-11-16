#!/usr/bin/env node
/* Meticulous v460 — LAYOUT-RESTORE-DISPATCH: behavioural tests
 * against the REAL shipped code. The owner's order (Nov 15,
 * 2026, 17:36–17:41 CST): "Why did you mess with the layout? I
 * only asked you to repair the ocr not the layout!" + "Active
 * comes out second if upcoming is there... If not 1st then
 * read from text" + "Where are pu and delivery addresses? And
 * why are the drivers not editable?"
 *
 * This suite renders the REAL Dispatch module (modules/
 * dispatch.js) in a vm world over the REAL store sliced from
 * js/app.js, with the REAL js/dispatch-ingest.js and
 * js/ticket-ocr.js loaded, and pins:
 *  (a) the section ORDER on the rendered screen:
 *      Upcoming (when one stands) -> Active (second; FIRST
 *      when no Upcoming stands) -> the ingest card (Read from
 *      a message: paste box + Read message + the Camera and
 *      Choose-from-file doors directly under it) -> History;
 *  (b) a document-shaped suggestion whose reader found NO
 *      addresses still shows a Pickup address row and a
 *      Delivery address row on its card (PU-DEL-ADDRESS-
 *      FIELDS), plus the Shipper / Consignee name rows;
 *  (c) the drivers a trip report prints land as editable
 *      Driver 1 / Driver 2 fields on the card (DRIVER-FIELDS-
 *      EDITABLE) and carry into the saved draft on Use;
 *  (d) the OCR repair from his screenshot: the same PRO
 *      number read twice with one zero dropped by the camera
 *      ("PRO00299219" / "PRO0299219") is ONE field, while two
 *      genuinely different PRO numbers stay two fields.
 * Run: node tools/dispatch-layout-460-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const ingestSrc = fs.readFileSync(path.join(ROOT, 'js', 'dispatch-ingest.js'), 'utf8');
const ocrSrc = fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8');
const dspSrc = fs.readFileSync(path.join(ROOT, 'modules', 'dispatch.js'), 'utf8');
const geoSrc = fs.readFileSync(path.join(ROOT, 'js', 'pinlinks.js'), 'utf8');

function extractStore(src) {
  const a = src.indexOf('var store = {');
  const b = src.indexOf('};', a);
  if (a === -1 || b === -1) throw new Error('store slice not found');
  return src.slice(a, b + 2);
}

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; failures.push(name); console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* ---------- the fake DOM body (only what paintIngest touches) ---------- */
function makeEl() {
  const el = {
    _html: '', _painted: '', textContent: '', value: '', disabled: false,
    children: [], parentNode: null, style: {}, dataset: {},
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    setAttribute: function () {}, getAttribute: function () { return null; },
    addEventListener: function () {}, removeEventListener: function () {},
    appendChild: function (c) { el.children.push(c); return c; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    focus: function () {}, click: function () {}, scrollIntoView: function () {}
  };
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return el._html; },
    set: function (v) {
      el._html = String(v);
      if (el._isIngest) el._painted = el._html;
    }
  });
  return el;
}
function makeBody() {
  const body = makeEl();
  const ingest = makeEl();
  ingest._isIngest = true;
  const cache = {};
  body.querySelector = function (sel) {
    if (sel === '#dp_ingest') return ingest;
    if (sel.charAt(0) === '#') return cache[sel] || (cache[sel] = makeEl());
    return makeEl();
  };
  body.querySelectorAll = function () { return []; };
  body._ingest = ingest;
  return body;
}

/* ---------- the world ---------- */
function makeWorld() {
  const map = new Map();
  const localStorage = {
    getItem: function (k) { return map.has(k) ? map.get(k) : null; },
    setItem: function (k, v) { map.set(k, String(v)); },
    removeItem: function (k) { map.delete(k); },
    get length() { return map.size; },
    key: function (i) { return Array.from(map.keys())[i] || null; }
  };
  const sandbox = {
    console: console,
    localStorage: localStorage,
    location: { search: '', pathname: '/' },
    history: { replaceState: function () {} },
    URLSearchParams: URLSearchParams,
    document: {
      createElement: function () { return makeEl(); },
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      addEventListener: function () {},
      body: makeEl()
    },
    App: {
      _today: function () { const d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); },
      _esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
      userRole: function () { return 'driver'; }
    }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractStore(appSrc), sandbox);
  sandbox.App._store = sandbox.store;
  vm.runInContext(ocrSrc, sandbox);
  vm.runInContext(geoSrc, sandbox);
  vm.runInContext(ingestSrc, sandbox);
  vm.runInContext(dspSrc, sandbox);
  return sandbox;
}

function todayStr() { const d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function dayStr(offset) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function renderScreen(w) {
  const body = makeBody();
  w.Meticulous.modules.dispatch.render(body);
  /* the screen as the driver meets it: the ingest card is
     painted INTO its placeholder's position in the main string */
  const combined = body._html.replace('<div id="dp_ingest"></div>', function () { return body._ingest._painted; });
  return { main: body._html, ingest: body._ingest._painted, all: combined };
}
function pos(html, needle) { return html.indexOf(needle); }

/* ================= (a) section order ================= */
console.log('(a) the section order: Upcoming -> Active -> Read from a message -> History');
{
  const w = makeWorld();
  const st = w.App._store;
  st.set('dsp_list', [
    { id: 'past1', jobSite: 'Old Yard Job', status: 'completed', date: dayStr(-3), scheduledAt: dayStr(-3) + 'T08:00' },
    { id: 'fut1', jobSite: 'Future Site Job', status: 'saved', date: dayStr(1), scheduledAt: dayStr(1) + 'T07:00' }
  ]);
  st.set('dsp_active', { id: 'act1', jobSite: 'Active Site Job', status: 'started', startedAt: Date.now() });
  const s = renderScreen(w);
  const all = s.all;
  ok('Upcoming card stands', pos(s.main, 'id="dp_upcoming_card"') !== -1);
  ok('Active card stands', pos(s.main, '🚛 Active dispatch') !== -1);
  ok('the ingest card stands (paste box)', pos(s.ingest, 'id="dp_paste"') !== -1);
  ok('History card stands', pos(s.main, '📋 History') !== -1);
  ok('Upcoming is above Active', pos(s.main, 'id="dp_upcoming_card"') < pos(s.main, '🚛 Active dispatch'));
  ok('Active is above Read from a message', pos(all, '🚛 Active dispatch') < pos(all, 'id="dp_paste"'));
  ok('Read message button inside the ingest card', pos(s.ingest, 'id="dp_paste_btn"') !== -1);
  ok('Camera door directly under Read message', pos(s.ingest, 'id="dp_paste_btn"') < pos(s.ingest, 'id="dp_ing_cam_btn"'));
  ok('Choose-from-file door beside Camera', pos(s.ingest, 'id="dp_ing_cam_btn"') < pos(s.ingest, 'id="dp_ing_file_btn"'));
  ok('Read from a message is above History', pos(all, 'id="dp_paste"') < pos(all, '📋 History'));
}
{
  const w = makeWorld();
  const st = w.App._store;
  st.set('dsp_list', [
    { id: 'past1', jobSite: 'Old Yard Job', status: 'completed', date: dayStr(-3), scheduledAt: dayStr(-3) + 'T08:00' }
  ]);
  st.set('dsp_active', { id: 'act1', jobSite: 'Active Site Job', status: 'started', startedAt: Date.now() });
  const s = renderScreen(w);
  const all = s.all;
  ok('no Upcoming card when none stands', pos(s.main, 'id="dp_upcoming_card"') === -1);
  ok('Active is FIRST (before the ingest card)', pos(all, '🚛 Active dispatch') !== -1 && pos(all, '🚛 Active dispatch') < pos(all, 'id="dp_paste"'));
  ok('History still under the ingest card', pos(all, 'id="dp_paste"') < pos(all, '📋 History'));
}
{
  const w = makeWorld();
  const st = w.App._store;
  st.set('dsp_list', [
    { id: 'fut1', jobSite: 'Future Site Job', status: 'saved', date: dayStr(1), scheduledAt: dayStr(1) + 'T07:00' }
  ]);
  const s = renderScreen(w);
  const all = s.all;
  ok('no Active card when none is running', pos(s.main, '🚛 Active dispatch') === -1);
  ok('Upcoming leads when it stands alone', pos(s.main, 'id="dp_upcoming_card"') !== -1 && pos(all, 'id="dp_upcoming_card"') < pos(all, 'id="dp_paste"'));
}

/* ================= (b)+(c) the suggestion card ================= */
console.log('(b) PU/DEL address rows stand even when the reader found none; (c) drivers are editable fields');
const TRIP = [
  'Routed Trip Report: TRP0122884 Driver 1:RaeesKhan Truck:T204 Driver 2:AdeelKhan Trailer:S1113 Start Date: 12/09/20 Start Time: 12:00 AM',
  'PO # 896270',
  'Pro: PRO00299219',
  'PRO: PRO0299219',
  'Order # ORD0248457',
  'Reference # 324167',
  'Appt # 40061-1482529',
  'PAPS # 88412093745',
  'Commodity: Auto Parts',
  'Shipper:',
  'MAGNA SEATING SYSTEMS',
  'Phone: (519) 653-2200',
  'Consignee:',
  'FCA STERLING HEIGHTS',
  'Phone: (586) 826-4400'
].join('\n');
{
  const w = makeWorld();
  const DI = w.DispatchIngest;
  const e = DI.intake(TRIP, 'photo');
  ok('the trip report becomes a suggestion', !!e);
  if (e) {
    eq('the reader found no pickup address in this text (the gap the fields answer)', (e.fields.pickups || []).length, 0);
    eq('the reader found no delivery address in this text', (e.fields.deliveries || []).length, 0);
    const s = renderScreen(w);
    ok('a Pickup address row stands on the card', pos(s.ingest, 'data-sugaddr="pickup:0"') !== -1);
    ok('a Delivery address row stands on the card', pos(s.ingest, 'data-sugaddr="delivery:0"') !== -1);
    ok('the Shipper name row stands', pos(s.ingest, 'data-sugname="shipper"') !== -1);
    ok('the Consignee name row stands', pos(s.ingest, 'data-sugname="consignee"') !== -1);
    ok('a Driver 1 field stands, filled from the document', pos(s.ingest, 'data-sugdetail="driver1"') !== -1 && pos(s.ingest, 'value="RaeesKhan"') !== -1);
    ok('a Driver 2 field stands, filled from the document', pos(s.ingest, 'data-sugdetail="driver2"') !== -1 && pos(s.ingest, 'value="AdeelKhan"') !== -1);
    /* the confirmed drivers + typed addresses carry into the saved dispatch */
    const det = (e.fields.details || []).map(function (d) { return { key: d.key, label: d.label, value: d.value, srcLabel: d.srcLabel }; });
    DI.updateSuggestionFields(e.id, {
      details: det,
      pickups: ['MAGNA SEATING SYSTEMS, 1240 INDUSTRIAL RD, CAMBRIDGE, ON N1R 5G2'],
      deliveries: ['FCA STERLING HEIGHTS, 38111 VAN DYKE AVE, STERLING HEIGHTS, MI 48312']
    });
    const ff = DI.formFieldsFor(DI.list()[0]);
    ok('the confirmed pickup address carries into the record', ff.notes.indexOf('Pickup: MAGNA SEATING SYSTEMS, 1240 INDUSTRIAL RD') !== -1, ff.notes);
    ok('the confirmed delivery address carries into the record', ff.notes.indexOf('Delivery 1: FCA STERLING HEIGHTS, 38111 VAN DYKE AVE') !== -1);
    ok('Driver 1 carries into the record', ff.notes.indexOf('Driver 1: RaeesKhan') !== -1);
    ok('Driver 2 carries into the record', ff.notes.indexOf('Driver 2: AdeelKhan') !== -1);
    ok('the structured drivers ride the record', (ff.details || []).some(function (d) { return d.key === 'driver1' && d.value === 'RaeesKhan'; }));
  }
}

/* ================= (d) the PRO repair ================= */
console.log('(d) the PRO number: one printed number, one field — even with a zero dropped');
{
  const w = makeWorld();
  const T = w.TicketOCR;
  const pros = T.extractKeyNumbers(TRIP).filter(function (n) { return n.type === 'pro'; });
  eq('the screenshot pair is ONE pro field', pros.length, 1);
  eq('the fuller read is kept', pros.length && pros[0].value, 'PRO00299219');
  const two = T.extractKeyNumbers('Pro: PRO00299219\nPro: PRO1176543').filter(function (n) { return n.type === 'pro'; });
  eq('two genuinely different PRO numbers stay two fields', two.length, 2);
  const frag = T.extractKeyNumbers('Pro: PRO00299219\nPRO: 0299219').filter(function (n) { return n.type === 'pro'; });
  eq('the v459 fragment shape still yields one', frag.length, 1);
}

/* ================= summary ================= */
console.log('');
if (fail) { console.log('dispatch-layout-460: ' + pass + ' passed, ' + fail + ' failed'); console.log('FAILURES: ' + failures.join(' | ')); process.exit(1); }
console.log('dispatch-layout-460: ' + pass + ' passed, 0 failed');
