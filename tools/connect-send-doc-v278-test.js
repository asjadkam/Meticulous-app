#!/usr/bin/env node
/* Meticulous v278 — CONNECT-SEND-DOC-SELECTION (owner, Oct 29,
 * 2026 ~08:59 MDT, screen recordings — REOPENED): Connect ->
 * Dave Cooper -> "Send doc" -> picking a Kind (Damage photo
 * etc.) does not surface his saved items ("No damage photos
 * saved yet", create-one detour) — "This is still not selecting
 * properly, docs as well." Dispatch / destination selecting
 * were named in the same breath.
 *
 * v243 built the general picker and its harness passed — on
 * seed shapes the app itself never writes, and under the one
 * profile state where its read scope happens to line up. The
 * real-account seams, each reproduced RED below on the
 * pre-v278 tree with the writers' REAL record shapes:
 *
 *  (1) PROFILE SCOPE: the picker offered the ACTIVE work
 *      profile's book, but Connect can only ever send the
 *      MAIN profile's book (the v242 fence: another carrier's
 *      day never crosses to Ai connections). On a real account
 *      sitting on a non-main profile, every saved main-book
 *      item vanished ("No damage photos saved yet") while the
 *      few non-main items it DID list could never be sent
 *      (queueShare refused them all). The picker must read the
 *      SHAREABLE book — Profile 1 — whatever profile is
 *      active, and a shareable item must actually send.
 *  (2) MANIFEST FIELD: every manifest_feed writer in the app
 *      (dispatch / navigation / revenue) pushes
 *      {ts, date, kind, summary} — the picker read `text`,
 *      a field no writer produces, so real manifest entries
 *      listed as a bare "Manifest entry" and shared EMPTY.
 *  (3) DISPATCH SCOPE + PIN: the dispatch branch ignored the
 *      profile fence entirely (a non-main dispatch could be
 *      picked for a main connection) and its packaged content
 *      dropped the record's pin (lat/lng, dump pin, pickup /
 *      dropoff) — the send handler reads content.lat etc.,
 *      so a Connect-sent dispatch always arrived pin-less and
 *      could never offer Navigate (DSP-PIN-NAVIGATE).
 *
 * Run: node tools/connect-send-doc-v278-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');
const clSrc = read('js/connectlive.js');
const conSrc = read('modules/connect.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
const clone = (v) => JSON.parse(JSON.stringify(v));
function tick() { return new Promise(function (r) { setTimeout(r, 5); }); }
async function ticks(n) { for (let i = 0; i < (n || 4); i++) await tick(); }

function extractRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('region not found: ' + beginMark);
  return src.slice(a, b + 2);
}
function makeStore(seed) {
  const m = new Map(Object.entries(clone(seed || {})));
  return {
    get: (k, d) => (m.has(k) ? clone(m.get(k)) : d),
    set: (k, v) => { m.set(k, clone(v)); return true; },
    del: (k) => { m.delete(k); return true; }
  };
}
function makeEl(tag, attrs) {
  const el = {
    tagName: tag, _attrs: attrs || {}, _html: '', value: '', disabled: false,
    textContent: '', style: {}, files: [],
    classList: { _s: new Set(),
      add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); },
      toggle: function (c) { if (this._s.has(c)) this._s.delete(c); else this._s.add(c); },
      contains: function (c) { return this._s.has(c); } },
    getAttribute: function (n) { return n in this._attrs ? this._attrs[n] : null; },
    setAttribute: function (n, v) { this._attrs[n] = String(v); },
    onclick: null, onchange: null
  };
  Object.defineProperty(el, 'innerHTML', {
    configurable: true,
    get: function () { return el._html; },
    set: function (v) { el._html = String(v); }
  });
  return el;
}
function parsePool(html, pool) {
  const re = /<(button|select|input|a|textarea)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = {};
    const are = /([a-zA-Z][a-zA-Z0-9-]*)(?:="([^"]*)")?/g;
    let am;
    while ((am = are.exec(m[2]))) attrs[am[1]] = am[2] === undefined ? '' : am[2];
    pool.push(makeEl(m[1], attrs));
  }
}
function makeWrap() {
  const w = makeEl('div', {});
  w._pool = [];
  Object.defineProperty(w, 'innerHTML', {
    get: function () { return w._html; },
    set: function (v) { w._html = String(v); w._pool = []; parsePool(w._html, w._pool); }
  });
  return w;
}
function makeBody() {
  const body = makeEl('div', {});
  body._pool = [];
  const wrapResults = makeWrap(), wrapReq = makeWrap();
  body._wraps = { '#cn_results': wrapResults, '#cn_req_wrap': wrapReq };
  Object.defineProperty(body, 'innerHTML', {
    get: function () { return body._html; },
    set: function (v) { body._html = String(v); body._pool = []; parsePool(body._html, body._pool); }
  });
  function all() { return body._pool.concat(wrapResults._pool, wrapReq._pool); }
  body.querySelector = function (sel) {
    if (body._wraps[sel]) return body._wraps[sel];
    if (sel.charAt(0) === '#') {
      const id = sel.slice(1);
      return all().filter(function (e) { return e._attrs.id === id; })[0] || null;
    }
    return null;
  };
  body.querySelectorAll = function (sel) {
    const m = /^\[([a-zA-Z0-9-]+)(?:="([^"]*)")?\]$/.exec(sel);
    if (!m) return [];
    return all().filter(function (e) {
      if (!(m[1] in e._attrs)) return false;
      return m[2] === undefined || e._attrs[m[1]] === m[2];
    });
  };
  return body;
}

const ONB = {
  accountType: 'Driver', firstName: 'Asjad', lastName: 'Kamal',
  companyName: 'Asjad Kamal', contractingCo: 'AI Trucking', contractingAddr: '1506 16 St NE',
  truckNo: '07', plate: '04 R209', ownWageRate: '29', payRate: '29',
  baseLocation: 'Home yard, Calgary'
};
const DAVE = { id: 'c-dave', name: 'Dave Cooper', role: 'Owner-Operator', uid: 'uid-dave', status: 'connected', kind: 'all', viaConnect: true };
const WP_TWO = { list: [
  { id: 'p1', company: 'AI Trucking', truckNo: '07', plate: '04 R209', rate: '29', rateIncludesTax: true, taxRate: '5', nextInvoiceNo: '1152' },
  { id: 'p2', company: 'Other Carrier Ltd', truckNo: '12', plate: 'XYZ 999', rate: '35', rateIncludesTax: false, taxRate: '5', nextInvoiceNo: '1' }
], activeId: 'p2' };
const ONB_P2 = Object.assign(clone(ONB), { contractingCo: 'Other Carrier Ltd', truckNo: '12', plate: 'XYZ 999', ownWageRate: '35', nextInvoiceNo: '1' });

function connectWorld(seed) {
  const store = makeStore(Object.assign({ con_list: [clone(DAVE)], onboarding: clone(ONB) }, seed || {}));
  const win = {};
  win.window = win;
  win.console = console;
  const opened = [];
  win.App = {
    _store: store, _today: () => '2026-10-29',
    _esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    openModule: (m) => { opened.push(m); },
    user: { uid: 'uid-me' }
  };
  win.FB = { ready: true, user: { uid: 'uid-me' }, db: null };
  vm.createContext(win);
  vm.runInContext(extractRegion(appSrc, 'WORK-PROFILES-BEGIN', 'WORK-PROFILES-END'), win, { filename: 'app-workprofiles.js' });
  vm.runInContext(clSrc, win, { filename: 'connectlive.js' });
  const CL = win.ConnectLive;
  CL.listMine = () => Promise.resolve({ incoming: [], outgoing: [] });
  CL.reconcile = () => Promise.resolve(false);
  CL.respond = () => Promise.resolve({});
  CL.sendRequest = () => Promise.resolve('sent');
  CL.search = () => Promise.resolve([]);
  CL.defaultKindFor = () => 'limited';
  CL.defaultKindForRequest = () => 'limited';
  win.Meticulous = { modules: { navigation: { shareablePlaces: () => [] } } };
  const cap = { sendDispatch: [] };
  win.ConnectPipe = {
    sendDestination: () => Promise.resolve('sent'),
    sendDispatch: (uid, fields) => { cap.sendDispatch.push({ uid: uid, fields: clone(fields) }); return Promise.resolve('sent'); },
    publishAll: () => {}, publishRecent: () => Promise.resolve(true)
  };
  vm.runInContext(conSrc, win, { filename: 'modules/connect.js' });
  const body = makeBody();
  return { win, store, body, opened, cap, api: win.Meticulous.modules.connect };
}
async function openPicker(w, kind, quick) {
  w.api.render(w.body);
  await ticks(6);
  const btn = w.body.querySelectorAll('[data-quick="' + (quick || 'doc') + '"]')[0];
  ok('picker: the ' + (quick || 'doc') + ' button is on the connection', !!btn);
  if (!btn) return;
  btn.onclick();
  await ticks(3);
  if (kind) {
    const sel = w.body.querySelector('#cn_ptype');
    if (!sel) { ok('picker: the Kind select renders', false); return; }
    sel.value = kind;
    if (sel.onchange) sel.onchange();
    await ticks(3);
  }
}
function pickButtons(w) { return w.body.querySelectorAll('[data-pick]'); }
function allHtml(w) { return w.body._html + w.body._wraps['#cn_results']._html + w.body._wraps['#cn_req_wrap']._html; }

/* the writers' REAL shapes */
const DMG_P1 = { tab: 'equipment', desc: 'Cracked mirror', photo: 'data:image/jpeg;base64,DMGPHOTO', at: '2026-10-22, 5:42:03 p.m.', date: '2026-10-22', profileId: 'p1', dispatch: '' };
const FILL_P1 = { date: '2026-10-22', time: '12:47', litres: 99.047, cost: 239.59, station: 'Petro-Canada Roadking', odo: 169999, photo: 'data:image/jpeg;base64,FUELRCPT', profileId: 'p1' };
const FEED_REAL = { ts: 1792800000000, date: '2026-10-22', kind: 'dispatch', summary: 'Dispatch completed: Aecon Inf · ticket #22864' };

(async function () {
console.log('— S1: populated MAIN book, active profile is the OTHER carrier —');
{
  const w = connectWorld({ dmg_reports: [clone(DMG_P1)], fuel_fills: [clone(FILL_P1)], work_profiles: clone(WP_TWO), onboarding: clone(ONB_P2), 'mt_ns_sticker_photo__p2': '', mt_ns_sticker_photo: 'data:image/jpeg;base64,NSSTICKER' });
  await openPicker(w, 'damage');
  const btns = pickButtons(w);
  eq('S1 the saved MAIN-book damage photo is LISTED even while Profile 2 is active', btns.length, 1);
  ok('S1 its row names what he wrote', allHtml(w).indexOf('Cracked mirror') !== -1);
  if (btns.length) {
    btns[0].onclick();
    await ticks(3);
    const ob = w.store.get('con_outbox', []);
    eq('S1 selecting it actually SENDS (queues the share) — no profile trap', ob.length, 1);
    ok('S1 the photo rides the share', !!(ob[0] && ob[0].content && ob[0].content.photo === 'data:image/jpeg;base64,DMGPHOTO'));
  }
  await openPicker(w, 'fuel');
  eq('S1 the saved MAIN-book fuel receipt is LISTED too', pickButtons(w).length, 1);
  await openPicker(w, 'sticker');
  ok('S1 the MAIN truck\'s sticker photo is LISTED (p1 chain, not the active truck\'s)',
    pickButtons(w).length >= 1 && allHtml(w).indexOf('Service sticker') !== -1, 'picks=' + pickButtons(w).length);
}

console.log('— S2: the other profile\'s items are NOT offered to main connections —');
{
  const w = connectWorld({
    dmg_reports: [{ tab: 'load', desc: 'Temp carrier damage', photo: 'data:image/jpeg;base64,P2DMG', at: '2026-10-24, 9:00:00 a.m.', date: '2026-10-24', profileId: 'p2', dispatch: '' }],
    work_profiles: clone(WP_TWO), onboarding: clone(ONB_P2)
  });
  await openPicker(w, 'damage');
  eq('S2 a Profile-2 damage photo is NOT listed for a main connection', pickButtons(w).length, 0);
}

console.log('— S3: manifest entries in the writers\' real shape —');
{
  const w = connectWorld({ manifest_feed: [clone(FEED_REAL)] });
  await openPicker(w, 'manifest');
  const btns = pickButtons(w);
  eq('S3 the real manifest entry is listed', btns.length, 1);
  ok('S3 its row shows the entry\'s own words, not a bare "Manifest entry"',
    allHtml(w).indexOf('Dispatch completed: Aecon Inf') !== -1, allHtml(w).slice(0, 300));
  if (btns.length) {
    btns[0].onclick();
    await ticks(3);
    const ob = w.store.get('con_outbox', []);
    ok('S3 the share carries the entry text',
      !!(ob[0] && ob[0].content && ob[0].content.text === 'Dispatch completed: Aecon Inf · ticket #22864'),
      JSON.stringify(ob[0] && ob[0].content));
  }
}

console.log('— S4: dispatch selecting — fence + the pin rides —');
{
  const dspP2 = { id: 'dsp-p2', date: '2026-10-24', scheduledAt: '2026-10-24T08:00', jobSite: 'Temp Carrier Site', profileId: 'p2', lat: 51.01, lng: -114.01, tickets: [] };
  const dspP1 = { id: 'dsp-p1', date: '2026-10-28', scheduledAt: '2026-10-28T08:00', jobSite: 'Aecon Inf', profileId: 'p1', lat: 50.9505, lng: -114.0145, dumpLat: 50.96, dumpLng: -114.02, pickup: 'STAR pit', dropoff: '12th Street', tickets: [] };
  const w = connectWorld({ dsp_list: [clone(dspP2), clone(dspP1)] });
  await openPicker(w, null, 'dispatch');
  const btns = pickButtons(w);
  eq('S4 only the MAIN-book dispatch is offered (the temp carrier\'s is fenced out)', btns.length, 1);
  ok('S4 the offered dispatch is the main-book one', allHtml(w).indexOf('Aecon Inf') !== -1 && allHtml(w).indexOf('Temp Carrier Site') === -1);
  if (btns.length) {
    btns[0].onclick();
    await ticks(4);
    eq('S4 the dispatch went down the pipe', w.cap.sendDispatch.length, 1);
    const f = w.cap.sendDispatch[0] && w.cap.sendDispatch[0].fields;
    ok('S4 the PIN rides the send (Navigate can be offered on arrival)',
      !!(f && f.lat === 50.9505 && f.lng === -114.0145), JSON.stringify(f));
    ok('S4 the dump pin + pickup/dropoff ride too',
      !!(f && f.dumpLat === 50.96 && f.dumpLng === -114.02 && f.pickup === 'STAR pit' && f.dropoff === '12th Street'),
      JSON.stringify(f));
  }
}

console.log('— S5: the v243 main-profile cases still hold —');
{
  const w = connectWorld({ dmg_reports: [clone(DMG_P1)] });
  await openPicker(w, 'damage');
  eq('S5 damage lists under Profile 1 as before', pickButtons(w).length, 1);
}

console.log('\nconnect-send-doc-v278: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
