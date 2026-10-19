#!/usr/bin/env node
/* Meticulous v171 — CONNECTIONS DEDUPE suite (owner, Oct 18,
 * 2026 21:35 MDT — his screenshot: 'Current connections (3)'
 * with 'Asjad Kamal · Owner-Operator · Meticulous technologies'
 * painted TWICE, identically, plus AI Trucking). One card per
 * real connection, keyed by ACCOUNT (uid): the data layer
 * (ConnectLive.dedupeConList — persisted by upsertConn and by
 * the reconcile heal) and the face (modules/connect.js reads
 * its list deduped, so the count and every row action agree).
 * Uid-less manual entries are the user's own address book and
 * are never merged.
 *
 * Run: node tools/queue-v171-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function memStore(seed) {
  const data = JSON.parse(JSON.stringify(seed || {}));
  return {
    _data: data,
    get: function (k, d) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : d; },
    set: function (k, v) { data[k] = v; return true; },
    del: function (k) { delete data[k]; }
  };
}
const DUP = { id: 'uX', name: 'Asjad Kamal', role: 'Owner-Operator', business: 'Meticulous technologies', contact: '', uid: 'uid-self', status: 'connected', viaConnect: true };
const DUP2 = { id: 'uX2', name: 'Asjad Kamal', role: 'Owner-Operator', business: 'Meticulous technologies', contact: '', uid: 'uid-self', status: 'connected', viaConnect: true };
const BOSS = { id: 'uB', name: 'AI Trucking', role: 'Fleet Manager', business: '', contact: '', uid: 'uid-boss', status: 'connected', viaConnect: true };

function makeLiveWorld(seed) {
  const store = memStore(seed);
  const sb = {
    window: {}, console: console,
    App: { _store: store, _esc: function (s) { return String(s == null ? '' : s); }, _today: function () { return '2026-10-19'; } }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(read('js/connectlive.js'), sb);
  return { sb: sb, store: store, CL: sb.ConnectLive };
}

/* ---- A: the pure dedupe ---- */
{
  const w = makeLiveWorld({});
  const out = w.CL.dedupeConList([DUP, BOSS, DUP2]);
  eq('A1 two rows for one account collapse to one', out.map(function (c) { return c.uid; }), ['uid-self', 'uid-boss']);
  const mixed = w.CL.dedupeConList([
    { uid: 'u1', status: 'pending', name: 'P' },
    { uid: 'u1', status: 'connected', name: 'P', business: 'Biz' }
  ]);
  eq('A2 the strongest status survives', [mixed.length, mixed[0].status], [1, 'connected']);
  const merged = w.CL.dedupeConList([
    { uid: 'u1', status: 'connected', name: 'P', kind: 'limited' },
    { uid: 'u1', status: 'pending', name: 'P', business: 'Biz', contact: 'c@x' }
  ]);
  eq('A3 the survivor keeps its own fields and gains the dropped row\u2019s missing ones',
    [merged[0].kind, merged[0].business, merged[0].contact], ['limited', 'Biz', 'c@x']);
  const manual = w.CL.dedupeConList([
    { id: 'c1', name: 'Same Name', contact: '1' },
    { id: 'c2', name: 'Same Name', contact: '2' }
  ]);
  eq('A4 uid-less manual entries are never merged (his own address book)', manual.length, 2);
}

/* ---- B: persistence — upsert + the stored list ---- */
{
  const w = makeLiveWorld({ con_list: [JSON.parse(JSON.stringify(DUP)), JSON.parse(JSON.stringify(DUP2)), JSON.parse(JSON.stringify(BOSS))] });
  w.CL.upsertConn({ uid: 'uid-boss', name: 'AI Trucking', role: 'Fleet Manager' }, 'connected');
  eq('B1 an upsert leaves the stored list deduped by account',
    w.store._data.con_list.map(function (c) { return c.uid; }), ['uid-self', 'uid-boss']);
}

/* ---- C: the face — one card, true count ---- */
function FakeEl(sel) {
  this._sel = sel || ''; this._kids = {}; this._html = '';
  this.value = ''; this.textContent = ''; this.style = {}; this.files = [];
  this.onclick = null; this._listeners = {}; this.options = [{ text: '' }]; this.selectedIndex = 0;
  this.classList = { add: function () {}, remove: function () {}, toggle: function () {} };
}
Object.defineProperty(FakeEl.prototype, 'innerHTML', {
  get: function () { return this._html; },
  set: function (v) { this._html = String(v); this._kids = {}; }
});
FakeEl.prototype.querySelector = function (sel) {
  return this._kids[sel] || (this._kids[sel] = new FakeEl(sel));
};
FakeEl.prototype.querySelectorAll = function () { return []; };
FakeEl.prototype.addEventListener = function (type, fn) {
  (this._listeners[type] = this._listeners[type] || []).push(fn);
};
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };
{
  const store = memStore({ con_list: [JSON.parse(JSON.stringify(DUP)), JSON.parse(JSON.stringify(DUP2)), JSON.parse(JSON.stringify(BOSS))], con_outbox: [] });
  const sb = {
    window: {}, Meticulous: { modules: {} }, console: console,
    ConnectLive: { pendingIn: 0 },
    App: { _store: store, _esc: function (s) { return String(s == null ? '' : s); }, _today: function () { return '2026-10-19'; } }
  };
  sb.window = sb;
  sb.window.ConnectLive = sb.ConnectLive;
  vm.createContext(sb);
  vm.runInContext(read('modules/connect.js'), sb);
  const mod = sb.Meticulous.modules.connect;
  eq('C1 the dashboard status counts real connections only', mod.status(), '2 connections');
  const body = new FakeEl('body');
  mod.render(body);
  ok('C2 the card header tells the true count', body._html.indexOf('Current connections (2)') !== -1);
  const cardStart = body._html.indexOf('Current connections');
  const card = body._html.slice(cardStart);
  eq('C3 the same person paints exactly once',
    (card.match(/Asjad Kamal/g) || []).length, 1);
  ok('C4 the other connection still paints', card.indexOf('AI Trucking') !== -1);
}

console.log('\nqueue-v171 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
