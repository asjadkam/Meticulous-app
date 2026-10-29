#!/usr/bin/env node
/* Meticulous v278 — CONNECT-PICK PERSISTENCE + L2 ONE-TIME ITEM LIST
 * (Wave A, Oct 29 "Fix it all" run; owner items CONNECT-PICK /
 * L1 / L2 from feedback-queue-oct20-afternoon.md).
 *
 * v207 proved the picker PAINTS and that a MOCKED CL.respond
 * receives the ticked payload. What it never proved — and what
 * the owner actually hit in his hands — is the full path:
 *   (A1) approver taps ticks on Maria's Limited request ->
 *        the REAL CL.respond writes the ticked list onto the
 *        request doc AND the approver's con_list -> the
 *        requester's reconcile materializes the SAME list ->
 *        ConnectPipe enforcement (modulesFor / allowsModule /
 *        limitedNeedsRecords) honours exactly those ticks.
 *   (A2) a One-Time request carries its item list on BOTH
 *        sides: the approver sees "Asking for: ..." (v207-era
 *        code did this), the REQUESTER's own outgoing row must
 *        show the same list too, and a re-send after a decline
 *        must carry the list again — a re-sent request that
 *        drops its modules is a blanket request, which L2
 *        forbids ("no blanket one-time access").
 *
 * RED on the pre-v278 tree: the outgoing row shows no item
 * list at all, and the resend calls CL.sendRequest without
 * the modules argument, so the re-opened doc loses them.
 * Run: node tools/connect-pick-persist-v278-test.js
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

/* ---------------- fake Firestore (v207 pattern) ---------------- */
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

/* ---------------- fake DOM (v207 pattern) ---------------- */
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

/* A Connect render world over the REAL ConnectLive (fake db),
   signed in as `uid`, sharing `db` with the other worlds. */
function fullWorld(uid, db, storeSeed) {
  const store = makeStore(storeSeed);
  const win = {};
  win.window = win;
  win.console = console;
  const opened = [];
  win.App = {
    _store: store, _today: () => '2026-10-29',
    _esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    openModule: (m) => { opened.push(m); }
  };
  win.FB = { ready: true, user: { uid: uid }, db: db };
  vm.createContext(win);
  vm.runInContext(clSrc, win, { filename: 'connectlive.js' });
  win.Meticulous = { modules: { navigation: { shareablePlaces: () => [] } } };
  win.ConnectPipe = { sendDestination: () => Promise.resolve('sent'), publishAll: () => {}, publishRecent: () => Promise.resolve(true) };
  vm.runInContext(conSrc, win, { filename: 'modules/connect.js' });
  const body = makeBody();
  return { win, store, body, opened, CL: win.ConnectLive, api: win.Meticulous.modules.connect };
}
function pipeWorld(uid, storeSeed) {
  const store = makeStore(storeSeed);
  const win = {};
  win.window = win;
  win.console = console;
  win.App = { _store: store, _today: () => '2026-10-29', _esc: (s) => String(s == null ? '' : s) };
  win.FB = { ready: true, user: { uid: uid }, db: new FakeDb() };
  vm.createContext(win);
  vm.runInContext(clSrc, win, { filename: 'connectlive.js' });
  vm.runInContext(cpSrc, win, { filename: 'connectpipe.js' });
  return { win, store, CP: win.ConnectPipe };
}
/* A render world with a MOCKED ConnectLive (v207 pattern) for
   the outgoing/resend surfaces. */
function mockWorld(opts) {
  const store = makeStore(opts.storeSeed || {});
  const win = {};
  win.window = win;
  win.console = console;
  win.App = {
    _store: store, _today: () => '2026-10-29',
    _esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    openModule: () => {}
  };
  win.FB = { ready: true, user: { uid: 'uid-me' }, db: null };
  vm.createContext(win);
  vm.runInContext(clSrc, win, { filename: 'connectlive.js' });
  const CL = win.ConnectLive;
  const cap = { sendRequest: [] };
  CL.listMine = () => Promise.resolve(clone(opts.reqs || { incoming: [], outgoing: [] }));
  CL.reconcile = () => Promise.resolve(false);
  CL.respond = () => Promise.resolve({});
  CL.sendRequest = (p, k, od, mods) => { cap.sendRequest.push({ uid: p.uid, kind: k, onceDate: od, modules: mods }); return Promise.resolve('sent'); };
  CL.search = () => Promise.resolve([]);
  CL.defaultKindFor = () => 'limited';
  CL.defaultKindForRequest = (q) => (q && q.kind) || 'all';
  win.Meticulous = { modules: { navigation: { shareablePlaces: () => [] } } };
  win.ConnectPipe = { sendDestination: () => Promise.resolve('sent'), publishAll: () => {}, publishRecent: () => Promise.resolve(true) };
  vm.runInContext(conSrc, win, { filename: 'modules/connect.js' });
  const body = makeBody();
  return { win, store, body, cap, api: win.Meticulous.modules.connect };
}

const MARIA_REQ_DOC = {
  from: 'uid-maria', to: 'uid-asjad',
  fromName: 'Maria Lott', fromBusiness: 'Dynamic Trucking Calgary', fromRole: 'Fleet Manager', fromFace: 'office', fromPerson: 'Maria Lott',
  toName: 'Asjad Kamal', toBusiness: '', toRole: 'Driver', toFace: 'driver', toPerson: 'Asjad Kamal',
  status: 'pending', kind: 'limited', modules: ['dispatch', 'pnl', 'fuel'],
  createdAt: Date.parse('2026-10-21T13:16:00'), updatedAt: Date.parse('2026-10-21T13:16:00')
};
const DRIVER_SEED = { onboarding: { accountType: 'Driver', firstName: 'Asjad', lastName: 'Kamal' } };

(async function () {
console.log('— A1: full path — ticks tapped, approval persists, pipe enforces —');
{
  const db = new FakeDb();
  db._col('requests').set('uid-maria_uid-asjad', clone(MARIA_REQ_DOC));
  const w = fullWorld('uid-asjad', db, clone(DRIVER_SEED));
  w.api.render(w.body);
  await ticks(8);
  const wrap = w.body._wraps['#cn_req_wrap'];
  ok('A1 the accept row renders Maria\'s request', wrap._html.indexOf('Maria Lott') !== -1);
  /* untick the seeded fuel, tick navigation — the approver's own choice */
  const tap = function (k) {
    const row = w.body.querySelectorAll('[data-cn-modacc]').filter(function (e) { return e.getAttribute('data-cn-modkey') === k; })[0];
    ok('A1 row exists for ' + k, !!row);
    if (row) row.onclick();
  };
  tap('fuel'); tap('navigation');
  await ticks(3);
  const acc = w.body.querySelectorAll('[data-cn-accept]')[0];
  ok('A1 Accept button present', !!acc);
  acc.onclick();
  await ticks(8);
  const doc = db._col('requests').get('uid-maria_uid-asjad');
  eq('A1 the request doc is accepted', doc && doc.status, 'accepted');
  setEq('A1 the request doc carries EXACTLY the ticked modules (fuel unticked, navigation ticked, proposal P&L filtered)',
    doc && doc.modules, ['dispatch', 'navigation']);
  const mine = (w.store.get('con_list', []) || []).filter(function (c) { return c.uid === 'uid-maria'; })[0];
  ok('A1 the approver\'s con_list entry exists', !!mine);
  setEq('A1 the approver\'s con_list carries the ticked modules', mine && mine.modules, ['dispatch', 'navigation']);
  eq('A1 the approver\'s con_list kind is limited', mine && mine.kind, 'limited');

  /* the requester's side materializes the same list on reconcile */
  const db2 = db;
  const w2 = fullWorld('uid-maria', db2, { onboarding: { accountType: 'Fleet Manager', firstName: 'Maria', lastName: 'Lott' } });
  await w2.CL.reconcile();
  await ticks(4);
  const theirs = (w2.store.get('con_list', []) || []).filter(function (c) { return c.uid === 'uid-asjad'; })[0];
  ok('A1 the requester\'s con_list entry materializes', !!theirs);
  setEq('A1 the requester sees the SAME ticked modules', theirs && theirs.modules, ['dispatch', 'navigation']);

  /* the pipe enforces exactly those ticks on the approver's side */
  const pw = pipeWorld('uid-asjad', { con_list: w.store.get('con_list', []) });
  setEq('A1 CP.modulesFor returns the ticked list', pw.CP.modulesFor('uid-maria'), ['dispatch', 'navigation']);
  eq('A1 navigation is allowed (it was ticked)', pw.CP.allowsModule('uid-maria', 'navigation'), true);
  eq('A1 fuel is NOT allowed (it was unticked)', pw.CP.allowsModule('uid-maria', 'fuel'), false);
  eq('A1 pnl is NOT allowed (never offered on a driver account)', pw.CP.allowsModule('uid-maria', 'pnl'), false);
  eq('A1 a records-free tick set does not open the records doc', pw.CP.limitedNeedsRecords('uid-maria'), false);
}

console.log('— A2: the One-Time item list shows on BOTH sides —');
{
  const onceOut = { id: 'req-out1', from: 'uid-me', to: 'uid-boss', toName: 'Boss Man', toRole: 'Owner-Operator', kind: 'once', onceDate: '2026-10-29', modules: ['dispatch', 'navigation'], status: 'pending', createdAt: Date.now() };
  const w = mockWorld({ storeSeed: clone(DRIVER_SEED), reqs: { incoming: [], outgoing: [clone(onceOut)] } });
  w.api.render(w.body);
  await ticks(6);
  const reqHtml = w.body._wraps['#cn_req_wrap']._html;
  ok('A2 the requester\'s outgoing one-time row SHOWS its item list',
    reqHtml.indexOf('Dispatches') !== -1 && reqHtml.indexOf('Navigation') !== -1,
    reqHtml.slice(0, 400));
}
{
  const onceIn = { id: 'req-in1', from: 'uid-boss', fromName: 'Boss Man', fromRole: 'Owner-Operator', kind: 'once', onceDate: '2026-10-29', modules: ['dispatch', 'navigation'], status: 'pending', createdAt: Date.now() };
  const w = mockWorld({ storeSeed: clone(DRIVER_SEED), reqs: { incoming: [clone(onceIn)], outgoing: [] } });
  w.api.render(w.body);
  await ticks(6);
  const reqHtml = w.body._wraps['#cn_req_wrap']._html;
  ok('A2 the approver\'s incoming one-time row SHOWS the asked-for list',
    reqHtml.indexOf('Asking for:') !== -1 && reqHtml.indexOf('Navigation') !== -1);
}

console.log('— A2: a re-send after decline carries the item list again —');
{
  const declined = { id: 'req-out2', from: 'uid-me', to: 'uid-boss', toName: 'Boss Man', toBusiness: 'Boss Co', toRole: 'Owner-Operator', toFace: 'office', toPerson: 'Boss Man', kind: 'once', onceDate: '2026-10-29', modules: ['dispatch', 'navigation'], status: 'declined', createdAt: Date.now() };
  const w = mockWorld({ storeSeed: clone(DRIVER_SEED), reqs: { incoming: [], outgoing: [clone(declined)] } });
  w.api.render(w.body);
  await ticks(6);
  const btn = w.body.querySelectorAll('[data-cn-resend]')[0];
  ok('A2 the declined row offers Send again', !!btn);
  if (btn) {
    btn.onclick();
    await ticks(4);
    eq('A2 one resend call', w.cap.sendRequest.length, 1);
    eq('A2 the resend keeps the kind', w.cap.sendRequest[0] && w.cap.sendRequest[0].kind, 'once');
    setEq('A2 the resend keeps the ITEM LIST (no blanket one-time access)',
      w.cap.sendRequest[0] && w.cap.sendRequest[0].modules, ['dispatch', 'navigation']);
  }
}
{
  const declinedLtd = { id: 'req-out3', from: 'uid-me', to: 'uid-drv', toName: 'Driver Dan', toBusiness: '', toRole: 'Driver', toFace: 'driver', toPerson: 'Driver Dan', kind: 'limited', modules: ['fuel', 'pti'], status: 'declined', createdAt: Date.now() };
  const w = mockWorld({ storeSeed: clone(DRIVER_SEED), reqs: { incoming: [], outgoing: [clone(declinedLtd)] } });
  w.api.render(w.body);
  await ticks(6);
  const btn = w.body.querySelectorAll('[data-cn-resend]')[0];
  if (btn) { btn.onclick(); await ticks(4); }
  setEq('A2 a Limited resend keeps its ticked modules too',
    w.cap.sendRequest[0] && w.cap.sendRequest[0].modules, ['fuel', 'pti']);
}

console.log('\nconnect-pick-persist-v278: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
