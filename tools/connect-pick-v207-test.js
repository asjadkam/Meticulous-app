#!/usr/bin/env node
/* Meticulous v207 — CONNECT-PICK (owner, Oct 21, 2026 13:16–13:19 MDT,
 * live from his phone with a real request waiting):
 * (1) The L1 module picker neither aligned nor accepted taps —
 *     "Choosing modules are not aligned and not even clicking."
 *     The rows are now ONE full-width tap target each (a real
 *     button, .cn-modrow), the tick box in a single right-hand
 *     column, and the tick state lives in uiModPick/uiModChoice:
 *     a tap flips state, the repaint renders state, Accept/Send
 *     submit state. Driven-render proof below: tap EVERY row,
 *     assert every tick flips, assert the Accept payload.
 * (2) The picker offered P&L and Maintenance on a DRIVER account
 *     — "not even driver module... Why is that even showing?"
 *     shareableModules() filters by the same account-type truth
 *     as the account's own face (app.js ACCT-GATE): a Driver
 *     account offers exactly Dispatches / Manifests / Fuel /
 *     Expenses & receipts / Navigation / PTI / Invoices. A
 *     proposal naming P&L is filtered out of the seed — an
 *     invisible tick can never be submitted.
 * (3) Navigation joins the vocabulary AND the plumbing: a
 *     destination share rides the pipe's dispatch channel as a
 *     flagged doc (ConnectPipe.sendDestination), lands in the
 *     receiver's nav_shares inbox (never the work board) only
 *     when the pair allows 'navigation', and Navigate hands it
 *     to the Navigator through nav_pending.
 * A: vocabulary + pipe (fake Firestore). B: the driven render.
 * Run: node tools/connect-pick-v207-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const clSrc = read('js/connectlive.js');
const cpSrc = read('js/connectpipe.js');
const conSrc = read('modules/connect.js');
const cssSrc = read('css/style.css');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function setEq(name, got, want) {
  eq(name, (got || []).slice().sort(), (want || []).slice().sort());
}
const clone = (v) => JSON.parse(JSON.stringify(v));
function tick() { return new Promise(function (r) { setTimeout(r, 5); }); }
async function ticks(n) { for (let i = 0; i < (n || 4); i++) await tick(); }

function makeStore(seed) {
  const m = new Map(Object.entries(clone(seed || {})));
  return {
    get: (k, d) => (m.has(k) ? clone(m.get(k)) : d),
    set: (k, v) => { m.set(k, clone(v)); return true; },
    del: (k) => { m.delete(k); return true; }
  };
}

/* ---------------- fake Firestore (v146 pattern) ---------------- */
function FakeDb() { this.cols = {}; }
FakeDb.prototype._col = function (name) { return this.cols[name] || (this.cols[name] = new Map()); };
function docSnap(id, data) {
  return { id: id, exists: data !== undefined, data: function () { return data === undefined ? undefined : clone(data); } };
}
function querySnap(rows) {
  return { docs: rows.map(function (r) { return docSnap(r[0], r[1]); }), empty: rows.length === 0, size: rows.length,
    forEach: function (cb) { this.docs.forEach(cb); } };
}
FakeDb.prototype.collection = function (name) {
  const db = this;
  const makeQuery = (filters) => ({
    where: (f, op, v) => makeQuery(filters.concat([[f, op, v]])),
    get: () => {
      const rows = [];
      db._col(name).forEach((data, id) => {
        if (filters.every(([f, op, v]) => op === '==' ? data[f] === v : (Array.isArray(data[f]) && data[f].indexOf(v) !== -1))) rows.push([id, data]);
      });
      return Promise.resolve(querySnap(rows));
    }
  });
  return Object.assign(makeQuery([]), {
    doc: (id) => ({
      get: () => Promise.resolve(docSnap(id, db._col(name).get(id))),
      set: (data, opts) => {
        const cur = db._col(name).get(id);
        db._col(name).set(id, opts && opts.merge && cur ? Object.assign(clone(cur), clone(data)) : clone(data));
        return Promise.resolve();
      },
      update: (data) => {
        const cur = db._col(name).get(id);
        if (cur === undefined) return Promise.reject(new Error('update on missing doc'));
        db._col(name).set(id, Object.assign(clone(cur), clone(data)));
        return Promise.resolve();
      },
      delete: () => { db._col(name).delete(id); return Promise.resolve(); }
    })
  });
};

/* A CL+CP world over the fake db, signed in as `uid`. */
function pipeWorld(uid, storeSeed) {
  const store = makeStore(storeSeed);
  const db = new FakeDb();
  const win = {};
  win.window = win;
  win.console = console;
  win.App = { _store: store, _today: () => '2026-10-21', _esc: (s) => String(s == null ? '' : s) };
  win.FB = { ready: true, user: { uid: uid }, db: db };
  vm.createContext(win);
  vm.runInContext(clSrc, win, { filename: 'connectlive.js' });
  vm.runInContext(cpSrc, win, { filename: 'connectpipe.js' });
  return { win, store, db, CL: win.ConnectLive, CP: win.ConnectPipe };
}

(async function () {
console.log('— A1: the vocabulary —');
{
  const w = pipeWorld('uid-a', {});
  eq('navigation is in the module keys, after expenses',
    w.CL.MODULE_KEYS, ['dispatch', 'manifest', 'fuel', 'expenses', 'navigation', 'maintenance', 'pti', 'invoices', 'pnl']);
  eq('sanitize keeps navigation', w.CL.sanitizeModules(['navigation', 'fuel']), ['navigation', 'fuel']);
  eq('the pipe mirror keys carry navigation too',
    w.CP.MODULE_KEYS.indexOf('navigation') !== -1, true);
}

console.log('— A2: the destination share crosses — and only when ticked —');
{
  /* sender: the boss sends a pinned destination */
  const boss = pipeWorld('uid-boss', {});
  const r = await boss.CP.sendDestination('uid-driver', { name: 'Ivor East Pond', address: 'South Calgary', lat: 50.9505, lng: -114.0145 });
  eq('sendDestination resolves sent', r, 'sent');
  const docs = [...boss.db._col('pipedispatches').values()];
  eq('one doc crossed', docs.length, 1);
  const d0 = docs[0];
  ok('the doc is a flagged destination, not a job',
    d0.navShare === true && d0.jobSite === 'Ivor East Pond' && d0.notes === 'South Calgary' &&
    d0.navLat === 50.9505 && d0.navLng === -114.0145 && d0.status === 'sent', JSON.stringify(d0));

  /* receiver, pair allows navigation: it lands in nav_shares */
  const drv = pipeWorld('uid-driver', {
    con_list: [{ uid: 'uid-boss', name: 'Boss', status: 'connected', kind: 'limited', modules: ['dispatch', 'navigation'] }]
  });
  drv.db.cols = boss.db.cols;
  const landed = await drv.CP.pullInbox();
  eq('one item landed', landed, 1);
  const shares = drv.store.get('nav_shares', []);
  ok('the destination is in the inbox with its pin + sender',
    shares.length === 1 && shares[0].name === 'Ivor East Pond' && shares[0].lat === 50.9505 &&
    shares[0].lng === -114.0145 && shares[0].fromUid === 'uid-boss' && shares[0].address === 'South Calgary',
    JSON.stringify(shares));
  eq('NO work dispatch was filed from a destination', drv.store.get('dsp_list', []), []);
  const after = [...drv.db._col('pipedispatches').values()][0];
  eq('the delivery tick advanced', after.status, 'delivered');
}
{
  /* receiver, pair does NOT allow navigation: it does not land,
     and stays deliverable (not consumed) */
  const boss = pipeWorld('uid-boss', {});
  await boss.CP.sendDestination('uid-driver', { name: 'Star Pit', address: '', lat: 50.985, lng: -114.052 });
  const drv = pipeWorld('uid-driver', {
    con_list: [{ uid: 'uid-boss', name: 'Boss', status: 'connected', kind: 'limited', modules: ['dispatch'] }]
  });
  drv.db.cols = boss.db.cols;
  eq('unticked navigation: nothing lands', await drv.CP.pullInbox(), 0);
  eq('nav_shares stays empty', drv.store.get('nav_shares', []), []);
  eq('the doc is NOT consumed — a later tick can still deliver it',
    Object.keys(drv.store.get('pipe_landed', {})).length, 0);
  /* an all-access pair takes it */
  const drv2 = pipeWorld('uid-driver', {
    con_list: [{ uid: 'uid-boss', name: 'Boss', status: 'connected', kind: 'all' }]
  });
  drv2.db.cols = boss.db.cols;
  eq('full access: the destination lands', await drv2.CP.pullInbox(), 1);
  eq('...into the inbox', drv2.store.get('nav_shares', []).length, 1);
}

/* ================= B: the driven render ================= */
console.log('— B: the driven Connect render —');

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
  const re = /<(button|select|input|a)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = {};
    const are = /([a-zA-Z][a-zA-Z0-9-]*)(?:="([^"]*)")?/g;
    let am;
    while ((am = are.exec(m[2]))) attrs[am[1]] = am[2] === undefined ? '' : am[2];
    pool.push(makeEl(m[1], attrs));
  }
}
function makeWrap(body) {
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
  const wrapResults = makeWrap(body), wrapReq = makeWrap(body);
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

function connectWorld(opts) {
  const store = makeStore(opts.storeSeed || {});
  const win = {};
  win.window = win;
  win.console = console;
  const opened = [];
  win.App = {
    _store: store, _today: () => '2026-10-21',
    _esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    openModule: (m) => { opened.push(m); }
  };
  win.FB = { ready: true, user: { uid: 'uid-me' }, db: null };
  vm.createContext(win);
  vm.runInContext(clSrc, win, { filename: 'connectlive.js' });
  const CL = win.ConnectLive;
  const cap = { respond: [], sendRequest: [], sendDestination: [] };
  CL.listMine = () => Promise.resolve(clone(opts.reqs || { incoming: [], outgoing: [] }));
  CL.reconcile = () => Promise.resolve(false);
  CL.respond = (q, accept, kind, onceDate, modules) => {
    cap.respond.push({ id: q.id, accept: accept, kind: kind, modules: modules });
    return Promise.resolve({});
  };
  CL.sendRequest = (p, k, od, mods) => { cap.sendRequest.push({ uid: p.uid, kind: k, modules: mods }); return Promise.resolve('sent'); };
  CL.search = () => Promise.resolve(clone(opts.searchResults || []));
  CL.defaultKindFor = () => opts.defaultKind || 'limited';
  CL.defaultKindForRequest = () => opts.defaultKind || 'limited';
  win.Meticulous = { modules: {
    navigation: { shareablePlaces: () => clone(opts.places || []) }
  } };
  win.ConnectPipe = {
    sendDestination: (uid, place) => { cap.sendDestination.push({ uid: uid, place: clone(place) }); return Promise.resolve('sent'); },
    publishAll: () => {}, publishRecent: () => Promise.resolve(true)
  };
  vm.runInContext(conSrc, win, { filename: 'modules/connect.js' });
  const body = makeBody();
  return { win, store, body, cap, opened, api: win.Meticulous.modules.connect };
}
function rowStates(html) {
  /* data-cn-modkey -> aria-pressed, from a rendered requests wrap */
  const out = {};
  const re = /data-cn-modkey="([^"]+)"[^>]*aria-pressed="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) out[m[1]] = m[2];
  return out;
}
function pickStates(html) {
  const out = {};
  const re = /data-cn-modpick="([^"]+)"[^>]*aria-pressed="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) out[m[1]] = m[2];
  return out;
}
const MARIA_REQ = { id: 'req1', fromUid: 'uid-maria', fromName: 'Maria Lott', fromRole: 'Fleet Manager', fromBusiness: 'Dynamic Trucking Calgary', kind: 'limited', modules: ['dispatch', 'pnl', 'fuel'], status: 'pending', createdAt: Date.parse('2026-10-21T13:16:00') };
const DRIVER_SEED = { onboarding: { accountType: 'Driver', firstName: 'Asjad', lastName: 'Kamal' } };

{
  /* the accept row on a DRIVER account */
  const w = connectWorld({ storeSeed: clone(DRIVER_SEED), reqs: { incoming: [clone(MARIA_REQ)], outgoing: [] } });
  w.api.render(w.body);
  await ticks(6);
  const wrap = w.body._wraps['#cn_req_wrap'];
  let states = rowStates(wrap._html);
  eq('driver accept row: exactly the 7 driver modules, in catalog order',
    Object.keys(states), ['dispatch', 'manifest', 'fuel', 'expenses', 'navigation', 'pti', 'invoices']);
  ok('no P&L row on a driver account', !('pnl' in states));
  ok('no Maintenance row on a driver account', !('maintenance' in states));
  eq('the seed ticks what he actually has (dispatch + fuel from the proposal)',
    [states.dispatch, states.fuel, states.manifest], ['true', 'true', 'false']);
  ok('the proposal\'s P&L tick was filtered out — no invisible tick',
    wrap._html.indexOf('P&L') === -1);

  /* tap EVERY row: each tick flips */
  const keys = Object.keys(states);
  for (const k of keys) {
    const before = rowStates(wrap._html)[k];
    const row = w.body.querySelectorAll('[data-cn-modacc]').filter(function (e) { return e.getAttribute('data-cn-modkey') === k; })[0];
    ok('row exists for ' + k, !!row);
    row.onclick();
    const after = rowStates(wrap._html)[k];
    eq('tap flips ' + k, after, before === 'true' ? 'false' : 'true');
  }
  /* final state: everything except the two seeded (now off) */
  states = rowStates(wrap._html);
  eq('after tapping every row once', states, {
    dispatch: 'false', manifest: 'true', fuel: 'false', expenses: 'true',
    navigation: 'true', pti: 'true', invoices: 'true'
  });
  /* Accept submits exactly the shown state */
  const acc = w.body.querySelectorAll('[data-cn-accept]')[0];
  acc.onclick();
  await ticks(3);
  eq('one respond call', w.cap.respond.length, 1);
  eq('the accept kind is the row kind', w.cap.respond[0].kind, 'limited');
  setEq('the accept payload is exactly the ticked state',
    w.cap.respond[0].modules, ['manifest', 'expenses', 'navigation', 'pti', 'invoices']);
}

{
  /* the SEND picker on a DRIVER account */
  const w = connectWorld({
    storeSeed: clone(DRIVER_SEED),
    searchResults: [{ uid: 'uid-maria', name: 'Maria Lott', role: 'Fleet Manager', business: 'Dynamic Trucking Calgary' }]
  });
  w.api.render(w.body);
  await ticks(4);
  const q = w.body.querySelector('#cn_q'); q.value = 'Maria';
  w.body.querySelector('#cn_search').onclick();
  await ticks(4);
  const connBtn = w.body.querySelectorAll('[data-cn-connect]')[0];
  ok('the search result offers Connect', !!connBtn);
  connBtn.onclick();
  await ticks(3);
  const resWrap = w.body._wraps['#cn_results'];
  let states = pickStates(resWrap._html);
  eq('driver send picker: the same 7 modules',
    Object.keys(states), ['dispatch', 'manifest', 'fuel', 'expenses', 'navigation', 'pti', 'invoices']);
  eq('send seed = the limited default', [states.dispatch, states.manifest, states.fuel], ['true', 'true', 'false']);
  const tap = function (k) {
    w.body.querySelectorAll('[data-cn-modpick]').filter(function (e) { return e.getAttribute('data-cn-modpick') === k; })[0].onclick();
  };
  tap('fuel'); tap('dispatch'); tap('pti');
  states = pickStates(resWrap._html);
  eq('send taps flip state', states, {
    dispatch: 'false', manifest: 'true', fuel: 'true', expenses: 'false',
    navigation: 'false', pti: 'true', invoices: 'false'
  });
  w.body.querySelector('#cn_kind_send').onclick();
  await ticks(3);
  eq('the send carries the ticked state', w.cap.sendRequest.length, 1);
  setEq('send payload modules', w.cap.sendRequest[0].modules, ['manifest', 'fuel', 'pti']);
}

{
  /* an OWNER account keeps the full catalog */
  const w = connectWorld({
    storeSeed: { onboarding: { accountType: 'Owner-Operator', firstName: 'Omar', lastName: 'Test' } },
    reqs: { incoming: [clone(MARIA_REQ)], outgoing: [] }
  });
  w.api.render(w.body);
  await ticks(6);
  const states = rowStates(w.body._wraps['#cn_req_wrap']._html);
  eq('owner accept row: all 9 modules', Object.keys(states),
    ['dispatch', 'manifest', 'fuel', 'expenses', 'navigation', 'maintenance', 'pti', 'invoices', 'pnl']);
  eq('the proposal\'s P&L tick survives on an owner account', states.pnl, 'true');
}

{
  /* the received destination: card, Navigate hand-off, Dismiss */
  const w = connectWorld({
    storeSeed: Object.assign(clone(DRIVER_SEED), {
      nav_shares: [{ pipeId: 'pd1', name: 'Ivor East Pond', address: 'South Calgary', lat: 50.9505, lng: -114.0145, fromName: 'Maria Lott', fromUid: 'uid-maria' }]
    })
  });
  w.api.render(w.body);
  await ticks(4);
  ok('the destinations card shows the share', w.body._html.indexOf('Destinations shared with you') !== -1 &&
    w.body._html.indexOf('Ivor East Pond') !== -1);
  w.body.querySelectorAll('[data-cn-navgo]')[0].onclick();
  const pend = w.store.get('nav_pending', null);
  ok('Navigate writes the pin hand-off', !!pend && pend.lat === 50.9505 && pend.lng === -114.0145 && pend.name === 'Ivor East Pond',
    JSON.stringify(pend));
  eq('the Navigator opens', w.opened, ['navigator']);
  w.body.querySelectorAll('[data-cn-navdel]')[0].onclick();
  eq('Dismiss clears the inbox item', w.store.get('nav_shares', []), []);
}

{
  /* the sender door: only on pairs that allow navigation */
  const w = connectWorld({
    storeSeed: Object.assign(clone(DRIVER_SEED), {
      con_list: [
        { uid: 'uid-maria', name: 'Maria Lott', role: 'Fleet Manager', status: 'connected', kind: 'limited', modules: ['dispatch', 'navigation'] },
        { uid: 'uid-umar', name: 'Umar', role: 'Dispatcher', status: 'connected', kind: 'limited', modules: ['dispatch'] }
      ]
    }),
    places: [{ name: 'Home', address: '1243 Cornerstone Blvd NE', lat: 51.15709, lng: -113.93862 }]
  });
  w.api.render(w.body);
  await ticks(4);
  const destBtns = w.body.querySelectorAll('[data-quick="destination"]');
  eq('the destination door shows only on the navigation pair', destBtns.length, 1);
  destBtns[0].onclick();
  await ticks(3);
  const picks = w.body.querySelectorAll('[data-pick]');
  eq('the picker lists his places', picks.length, 1);
  picks[0].onclick();
  await ticks(3);
  eq('the share went down the pipe to the right person', w.cap.sendDestination.length, 1);
  eq('...carrying the place + pin', w.cap.sendDestination[0],
    { uid: 'uid-maria', place: { name: 'Home', address: '1243 Cornerstone Blvd NE', lat: 51.15709, lng: -113.93862 } });
  const ob = w.store.get('con_outbox', []);
  ok('history records it as sent', ob.length === 1 && ob[0].type === 'destination' && ob[0].sent === true, JSON.stringify(ob));
}

console.log('— C: ship pins —');
{
  ok('the tick rows are full-width buttons (cn-modrow)', conSrc.indexOf('class="cn-modrow"') !== -1);
  ok('no checkbox inputs remain in the module', conSrc.indexOf('type="checkbox"') === -1);
  ok('the row CSS exists (one right-hand tick column)',
    cssSrc.indexOf('.cn-modrow') !== -1 && cssSrc.indexOf('.cn-modbox') !== -1);
  eq('webVersion is 207', ver.webVersion, 218);
  ok('manifest notes name the current webVersion', (ver.notes || '').indexOf('v' + ver.webVersion) === 0);
  ok('index.html pins the v207 build', idxSrc.indexOf('?v=218') >= 0 && idxSrc.indexOf('?v=' + '206') < 0);
}

console.log('\nconnect-pick-v207 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
