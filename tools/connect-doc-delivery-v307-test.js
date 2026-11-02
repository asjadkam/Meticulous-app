#!/usr/bin/env node
/* Meticulous v307 — CONNECT-DOC-DELIVERY + DAMAGE-AS-A-MODULE +
 * THE CONNECTION EDITOR (owner, Nov 2, 2026: "I need Maria to
 * receive my report and my pictures! Right now!" -> "Fix it!" ->
 * "If the user is limited access, but has access to Damage &
 * Incident, you shouldn't have to send reports. You can just
 * connect to it." -> "Right now there is no way to edit what a
 * limited connection does.").
 *
 * Three pieces, one ship:
 *  (1) DOC DELIVERY: the Send-doc picker really sends documents
 *      to connected peers (CP.sendDoc over the dispatch pipe,
 *      kind 'docshare'); queued entries heal via flushOutbox on
 *      the Connect screen; the receiver lands them in doc_shares
 *      (deduped by shareId) and sees them in Connect. Oversize
 *      content stays queued, honestly.
 *  (2) DAMAGE IS A MODULE: 'damage' ticks like PTI — the facts
 *      ride sharedrecords, the photo rides sharedphotos named
 *      only for damage viewers, the reader strips the section
 *      for unticked peers, the union-preserve keeps published
 *      reports through a rolled-back rebuild.
 *  (3) THE EDITOR: a connection card gains "Edit access" — kind
 *      + module ticks in one place, saved through CL.setKind
 *      onto the con_list fields the pipe reads; the card's
 *      "Can see:" line reads the new ticks back.
 *
 * Run: node tools/connect-doc-delivery-v307-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');
const clSrc = read('js/connectlive.js');
const cpSrc = read('js/connectpipe.js');
const ocrSrc = read('js/ticket-ocr.js');
const conSrc = read('modules/connect.js');
const dmgSrc = read('modules/damage.js');
const rulesSrc = read('firestore.rules');

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

/* ================= fake Firestore (connect-pipe-test shape) == */
function FakeDb() { this.cols = {}; this.writes = 0; }
FakeDb.prototype._col = function (name) {
  return this.cols[name] || (this.cols[name] = new Map());
};
function docSnap(id, data) {
  return { id: id, exists: data !== undefined, data: function () { return data === undefined ? undefined : clone(data); } };
}
function querySnap(rows) {
  return {
    docs: rows.map(function (r) { return docSnap(r[0], r[1]); }),
    empty: rows.length === 0, size: rows.length,
    forEach: function (cb) { this.docs.forEach(cb); }
  };
}
function matchOp(v, op, val) {
  if (op === '==') return v === val;
  if (op === 'array-contains') return Array.isArray(v) && v.indexOf(val) !== -1;
  throw new Error('fake db: unsupported op ' + op);
}
FakeDb.prototype.collection = function (name) {
  const db = this;
  const makeQuery = (filters) => ({
    where: (f, op, v) => makeQuery(filters.concat([[f, op, v]])),
    get: () => {
      const rows = [];
      db._col(name).forEach((data, id) => {
        if (filters.every(([f, op, v]) => matchOp(data[f], op, v))) rows.push([id, data]);
      });
      return Promise.resolve(querySnap(rows));
    }
  });
  return Object.assign(makeQuery([]), {
    doc: (id) => ({
      get: () => Promise.resolve(docSnap(id, db._col(name).get(id))),
      set: (data, opts) => {
        db.writes++;
        const cur = db._col(name).get(id);
        db._col(name).set(id, opts && opts.merge && cur ? Object.assign(clone(cur), clone(data)) : clone(data));
        return Promise.resolve();
      },
      update: (data) => {
        db.writes++;
        const cur = db._col(name).get(id);
        if (cur === undefined) return Promise.reject(new Error('update on missing doc'));
        db._col(name).set(id, Object.assign(clone(cur), clone(data)));
        return Promise.resolve();
      },
      delete: () => { db.writes++; db._col(name).delete(id); return Promise.resolve(); }
    })
  });
};
function makeStore(seed) {
  const m = new Map(Object.entries(clone(seed || {})));
  return {
    get: (k, d) => (m.has(k) ? clone(m.get(k)) : d),
    set: (k, v) => { m.set(k, clone(v)); return true; },
    del: (k) => { m.delete(k); return true; }
  };
}

/* ================= fake DOM (connect-send-doc-v278 shape) ==== */
function extractRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('region not found: ' + beginMark);
  return src.slice(a, b + 2);
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

/* ================= WORLD A: the Connect screen =============== */
const ONB = {
  accountType: 'Driver', firstName: 'Asjad', lastName: 'Kamal',
  companyName: 'Asjad Kamal', contractingCo: 'AI Trucking', contractingAddr: '1506 16 St NE',
  truckNo: '07', plate: '04 R209', ownWageRate: '29', payRate: '29',
  baseLocation: 'Home yard, Calgary'
};
const DAVE = { id: 'c-dave', name: 'Dave Cooper', role: 'Owner-Operator', uid: 'uid-dave', status: 'connected', kind: 'all', viaConnect: true };
const MARIA = { id: 'c-maria', name: 'Maria Lott', role: 'Fleet Manager', uid: 'uid-maria', status: 'connected', kind: 'all', viaConnect: true };
const MANUAL = { id: 'c-man', name: 'Manual Mike', role: 'Dispatcher', contact: '' };
const DMG_P1 = { tab: 'equipment', desc: 'Backed into a light pole', photo: 'data:image/jpeg;base64,POLEPHOTO', photos: ['data:image/jpeg;base64,POLEPHOTO'], at: '11/2/2026, 11:16:05 AM', date: '2026-11-02', dispatch: 'Butterfly → Aecon', profileId: 'p1' };

function connectWorld(seed, pipeOverrides) {
  const store = makeStore(Object.assign({ onboarding: clone(ONB) }, seed || {}));
  const win = {};
  win.window = win;
  win.console = console;
  const opened = [];
  win.App = {
    _store: store, _today: () => '2026-11-02',
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
  const cap = { sendDoc: [], sendDispatch: [] };
  win.ConnectPipe = Object.assign({
    sendDestination: () => Promise.resolve('sent'),
    sendDispatch: (uid, fields) => { cap.sendDispatch.push({ uid: uid, fields: clone(fields) }); return Promise.resolve('sent'); },
    sendDoc: (uid, share) => { cap.sendDoc.push({ uid: uid, share: clone(share) }); return Promise.resolve('sent'); },
    pullInbox: () => Promise.resolve(0),
    publishAll: () => {}, publishRecent: () => Promise.resolve(true)
  }, pipeOverrides || {});
  vm.runInContext(conSrc, win, { filename: 'modules/connect.js' });
  const body = makeBody();
  return { win, store, body, opened, cap, CL, api: win.Meticulous.modules.connect };
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
    /* v311: the Kind control is tappable rows now, not a
       native select — tap the requested kind's row. */
    const row = w.body.querySelectorAll('[data-cn-ptype="' + kind + '"]')[0];
    if (!row) { ok('picker: the kind rows render', false); return; }
    if (row.onclick) row.onclick();
    await ticks(3);
  }
}
function allHtml(w) { return w.body._html + w.body._wraps['#cn_results']._html + w.body._wraps['#cn_req_wrap']._html; }
const NOV2_ENTRY = {
  type: 'damage', label: 'Damage photo — 2026-11-02 — Backed into a light pole',
  to: 'Maria Lott', connId: 'c-maria', refId: 'g0',
  content: { title: 'Backed into a light pole', desc: 'Backed into a light pole', date: '2026-11-02', photo: 'data:image/jpeg;base64,POLEPHOTO' },
  ts: 1793654165000, note: ''
};

/* ================= WORLD B: the real pipe over FakeDb ======== */
const db = new FakeDb();
const sb = { console: console, setTimeout: setTimeout, Promise: Promise };
sb.window = sb;
sb.Meticulous = { modules: {} };
sb.esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
sb.dspFmtH = function (x) {
  var n = Math.round((parseFloat(x) || 0) * 100) / 100;
  return (n % 1 === 0) ? n.toFixed(1) : String(n);
};
vm.createContext(sb);
vm.runInContext(ocrSrc, sb);
vm.runInContext(clSrc, sb);
vm.runInContext(cpSrc, sb);
sb.ConnectPipe._rendition = function () { return Promise.resolve('data:image/jpeg;base64,RENDITION'); };

const DMG_A = { tab: 'equipment', desc: 'Backed into a light pole', photo: 'data:image/jpeg;base64,POLEPHOTO', photos: ['data:image/jpeg;base64,POLEPHOTO'], at: '11/2/2026, 11:16:05 AM', date: '2026-11-02', dispatch: 'Butterfly → Aecon', profileId: 'p1' };
const DMG_B = { tab: 'load', desc: 'Load shifted, tarp torn', photo: '', photos: [], at: '10/30/2026, 9:02:11 AM', date: '2026-10-30', dispatch: '', profileId: 'p1' };
const DMG_P2 = { tab: 'equipment', desc: 'Other carrier scratch', photo: 'data:image/jpeg;base64,OTHER', photos: [], at: '10/29/2026, 8:00:00 AM', date: '2026-10-29', dispatch: '', profileId: 'p2' };
const FILL_A = { date: '2026-11-01', time: '08:12', litres: 90.5, cost: 210.25, station: 'Petro-Canada', odo: 170800, photo: 'data:image/jpeg;base64,FUELPHOTO', profileId: 'p1' };

const pipeUsers = {
  driver: {
    uid: 'uid-driver', email: 'driver@example', role: 'driver',
    store: makeStore({
      onboarding: { companyName: 'Asjad Kamal', accountType: 'Owner-Operator', travelBonus: 1, payRate: 29, ownWageRate: 29 },
      con_list: [
        { id: 'ub', name: 'Boss Man', role: 'Fleet Manager', uid: 'uid-boss', status: 'connected', kind: 'all', viaConnect: true },
        { id: 'um', name: 'Maria Lott', role: 'Fleet Manager', uid: 'uid-maria', status: 'connected', kind: 'limited', modules: ['dispatch', 'manifest', 'fuel', 'pti', 'navigation'], viaConnect: true },
        { id: 'ud', name: 'Dana Dispatch', role: 'Dispatcher', uid: 'uid-dana', status: 'connected', kind: 'limited', modules: ['dispatch', 'damage'], viaConnect: true }
      ],
      dmg_reports: [clone(DMG_B), clone(DMG_A), clone(DMG_P2)],
      fuel_fills: [clone(FILL_A)],
      dsp_list: [], dsp_active: null, sessions: [], tracker: { status: 'idle', startTs: 0, elapsed: 0 }
    })
  },
  boss: {
    uid: 'uid-boss', email: 'boss@example', role: 'office',
    store: makeStore({
      onboarding: { companyName: 'AI Trucking', accountType: 'Fleet Manager' },
      con_list: [{ id: 'ud1', name: 'Asjad Kamal', role: 'Driver', uid: 'uid-driver', status: 'connected', kind: 'all', viaConnect: true }],
      dsp_list: [], dsp_active: null, sessions: [], tracker: { status: 'idle', startTs: 0, elapsed: 0 }
    })
  },
  maria: {
    uid: 'uid-maria', email: 'maria@example', role: 'office',
    store: makeStore({
      onboarding: { companyName: 'Dynamic Trucking', accountType: 'Fleet Manager' },
      con_list: [{ id: 'ud1', name: 'Asjad Kamal', role: 'Driver', uid: 'uid-driver', status: 'connected', kind: 'limited', modules: ['dispatch', 'manifest', 'fuel', 'pti', 'navigation'], viaConnect: true }],
      dsp_list: [], dsp_active: null, sessions: [], tracker: { status: 'idle', startTs: 0, elapsed: 0 }
    })
  },
  dana: {
    uid: 'uid-dana', email: 'dana@example', role: 'office',
    store: makeStore({
      onboarding: { companyName: 'Dana Co', accountType: 'Fleet Manager' },
      con_list: [{ id: 'ud1', name: 'Asjad Kamal', role: 'Driver', uid: 'uid-driver', status: 'connected', kind: 'limited', modules: ['dispatch', 'damage'], viaConnect: true }],
      dsp_list: [], dsp_active: null, sessions: [], tracker: { status: 'idle', startTs: 0, elapsed: 0 }
    })
  }
};
function asUser(u) {
  sb.FB = { ready: true, user: { uid: u.uid, email: u.email }, db: db };
  sb.App = {
    _store: u.store, _esc: sb.esc, _today: () => '2026-11-02',
    userRole: () => u.role, tracker: u.store.get('tracker', null)
  };
  sb.window.FB = sb.FB; sb.window.App = sb.App;
  const CP = sb.ConnectPipe;
  CP._pubCache = {}; CP._recCache = {}; CP._billedKnown = null; CP._mfKnown = null;
  CP._billedSession = {}; CP._mfSession = {}; CP._photoCache = {};
  CP._lastPullAt = 0; CP._pulling = false; CP._peerCache = null; CP._crewCache = null;
  sb.ConnectLive._pubKey = '';
}
const CP = () => sb.ConnectPipe;

(async function () {
/* ================= (1a) pick a damage doc for a connected peer */
console.log('— 1a: picking a damage report for a connected peer sends it —');
{
  const w = connectWorld({ con_list: [clone(DAVE)], dmg_reports: [clone(DMG_P1)] });
  await openPicker(w, 'damage');
  const btns = w.body.querySelectorAll('[data-pick]');
  eq('1a the saved damage report is listed', btns.length, 1);
  if (btns.length) {
    btns[0].onclick();
    await ticks(5);
    eq('1a the pipe send path was called once', w.cap.sendDoc.length, 1);
    const s = w.cap.sendDoc[0] || {};
    ok('1a the send names the peer + the damage type', s.uid === 'uid-dave' && s.share && s.share.type === 'damage', JSON.stringify(s));
    ok('1a the send carries a stamped shareId', !!(s.share && s.share.shareId));
    const ob = w.store.get('con_outbox', []);
    eq('1a exactly one History entry', ob.length, 1);
    ok('1a the entry is BORN sent:true (no queue-forever)', !!(ob[0] && ob[0].sent === true), JSON.stringify(ob[0]));
    ok('1a the entry carries the same shareId as the send', !!(ob[0] && s.share && ob[0].shareId === s.share.shareId));
    ok('1a the photo rides the send', !!(s.share && s.share.content && s.share.content.photo === 'data:image/jpeg;base64,POLEPHOTO'));
  }
}

/* ================= (1b/1c) flushOutbox heals the Nov 2 entry == */
console.log('— 1b/1c: a pre-existing queued entry flushes exactly once —');
{
  const w = connectWorld({ con_list: [clone(MARIA), clone(MANUAL)], con_outbox: [clone(NOV2_ENTRY)] });
  w.api.render(w.body);
  await ticks(8);
  eq('1b flush called sendDoc exactly once', w.cap.sendDoc.length, 1);
  const s = w.cap.sendDoc[0] || {};
  ok('1b the flush targeted Maria by uid', s.uid === 'uid-maria', JSON.stringify(s));
  ok('1b the flushed share keeps the Nov 2 content whole', !!(s.share && s.share.content && s.share.content.photo === 'data:image/jpeg;base64,POLEPHOTO' && s.share.content.desc === 'Backed into a light pole'));
  let ob = w.store.get('con_outbox', []);
  ok('1b the entry is stamped sent:true after the flush', ob[0] && ob[0].sent === true, JSON.stringify(ob[0]));
  ok('1b the entry gained a shareId, and it is the one sent', !!(ob[0] && ob[0].shareId && s.share && ob[0].shareId === s.share.shareId));
  w.api.render(w.body);
  await ticks(8);
  eq('1c a second render/flush does NOT resend', w.cap.sendDoc.length, 1);
}

/* ================= (1d) manual connections never flush ====== */
console.log('— 1d: manual (uid-less) connections are never flushed —');
{
  const manEntry = Object.assign(clone(NOV2_ENTRY), { to: 'Manual Mike', connId: 'c-man' });
  const w = connectWorld({ con_list: [clone(MANUAL)], con_outbox: [manEntry] });
  w.api.render(w.body);
  await ticks(8);
  eq('1d sendDoc was never called for the manual entry', w.cap.sendDoc.length, 0);
  const ob = w.store.get('con_outbox', []);
  ok('1d the manual entry stays queued, untouched', !!(ob[0] && !ob[0].sent && !ob[0].shareId), JSON.stringify(ob[0]));
}

/* ================= (1e) oversize stays queued honestly ======= */
console.log('— 1e: oversize content is never offered to the pipe —');
{
  const big = Object.assign(clone(NOV2_ENTRY), {
    content: { title: 'Huge', desc: 'Huge', date: '2026-11-02', photo: 'data:image/jpeg;base64,' + 'A'.repeat(950000) }
  });
  const w = connectWorld({ con_list: [clone(MARIA)], con_outbox: [big] });
  w.api.render(w.body);
  await ticks(8);
  eq('1e sendDoc was never called for the oversize entry', w.cap.sendDoc.length, 0);
  const ob = w.store.get('con_outbox', []);
  ok('1e the entry stays queued', !!(ob[0] && !ob[0].sent));
  ok('1e the entry carries the honest reason', !!(ob[0] && /Too large to send/.test(ob[0].note || '')), JSON.stringify(ob[0] && ob[0].note));
}

/* ================= (3) THE EDITOR ============================ */
console.log('— 3: the connection editor — Maria\'s real case —');
{
  /* Maria is kind 'all' today (flipped this morning). The owner
     needs her Limited, with her existing modules + Damage. */
  const w = connectWorld({ con_list: [clone(MARIA)] });
  w.api.render(w.body);
  await ticks(6);
  const editBtn = w.body.querySelectorAll('[data-cn-edit]')[0];
  ok('3 the Edit access door is on her card', !!editBtn);
  if (editBtn) {
    editBtn.onclick();
    await ticks(3);
    const kindBtn = w.body.querySelectorAll('[data-cn-edit-kind="limited"]')[0];
    ok('3 the editor offers the Limited kind', !!kindBtn);
    if (kindBtn) {
      kindBtn.onclick();
      await ticks(3);
      const tickKeys = w.body.querySelectorAll('[data-cn-editmod]').map(function (b) { return b.getAttribute('data-cn-editmod'); });
      ok('3 the tick list includes Damage & Incident', tickKeys.indexOf('damage') !== -1, tickKeys.join(','));
      // tick damage + pti + navigation (dispatch/manifest are the seeded defaults)
      for (const k of ['damage', 'pti', 'navigation']) {
        const row = w.body.querySelectorAll('[data-cn-editmod="' + k + '"]')[0];
        if (row) { row.onclick(); await ticks(2); }
      }
      const save = w.body.querySelector('#cn_edit_save');
      ok('3 the editor has its one Save at the bottom', !!save);
      if (save) {
        save.onclick();
        await ticks(6);
        const entry = (w.store.get('con_list', []) || [])[0] || {};
        eq('3a the save persisted kind=limited on the con_list entry', entry.kind, 'limited');
        ok('3a the save persisted the ticked modules incl. damage',
          Array.isArray(entry.modules) && entry.modules.indexOf('damage') !== -1 &&
          entry.modules.indexOf('dispatch') !== -1 && entry.modules.indexOf('manifest') !== -1 &&
          entry.modules.indexOf('pti') !== -1 && entry.modules.indexOf('navigation') !== -1,
          JSON.stringify(entry.modules));
        const h = allHtml(w);
        ok('3c the card Can-see line names Damage & Incident after the edit',
          h.indexOf('Can see:') !== -1 && h.indexOf('Damage &amp; Incident') !== -1);
        ok('3c the flash confirms the update', h.indexOf('Access updated for Maria Lott') !== -1);
        /* and back to All: the restriction lifts entirely */
        const editBtn2 = w.body.querySelectorAll('[data-cn-edit]')[0];
        if (editBtn2) {
          editBtn2.onclick();
          await ticks(3);
          const allBtn = w.body.querySelectorAll('[data-cn-edit-kind="all"]')[0];
          if (allBtn) { allBtn.onclick(); await ticks(3); }
          ok('3 the tick list is gone under Connect all', w.body.querySelectorAll('[data-cn-editmod]').length === 0);
          const save2 = w.body.querySelector('#cn_edit_save');
          if (save2) {
            save2.onclick();
            await ticks(6);
            const e2 = (w.store.get('con_list', []) || [])[0] || {};
            ok('3 saving Connect all restores kind=all with no module restriction',
              e2.kind === 'all' && !e2.modules, JSON.stringify(e2));
          }
        }
      }
    }
  }
}

/* ================= (2)+(1f) the pipe: damage module + sendDoc */
console.log('— 2: damage publishes as a module (facts + photo), strips per tick —');
{
  asUser(pipeUsers.driver);
  const wrote = await CP().publishRecords();
  ok('2 the records publish ran', wrote === true || wrote === false);
  const recDoc = db._col('sharedrecords').get('uid-driver');
  ok('2a the records doc exists', !!recDoc);
  if (recDoc) {
    eq('2a viewers name the boss + BOTH limited peers (damage counts toward records viewership)',
      (recDoc.viewers || []).slice().sort(), ['uid-boss', 'uid-dana', 'uid-maria']);
    const dmg = recDoc.damage || [];
    eq('2a the damage section carries the two main-profile reports (the p2 report is fenced out)', dmg.length, 2);
    eq('2a newest first', dmg[0] && dmg[0].desc, 'Backed into a light pole');
    eq('2a the fact carries facts only (exact key set; v312 adds photoKeys — every photo, not just the first)',
      Object.keys(dmg[0] || {}).sort(), ['at', 'date', 'desc', 'dispatch', 'kind', 'photoKey', 'photoKeys', 'photoRef']);
    ok('2a the fact names its kind + dispatch reference',
      dmg[0].kind === 'equipment' && dmg[0].dispatch === 'Butterfly → Aecon');
    ok('2a the photo is a reference, never bytes', dmg[0].photoRef === true && !!dmg[0].photoKey && JSON.stringify(dmg[0]).indexOf('POLEPHOTO') === -1);
    const key = dmg[0].photoKey;
    const photoDoc = db._col('sharedphotos').get('uid-driver_' + key);
    ok('2a the photo rendition doc exists under the report key', !!photoDoc);
    if (photoDoc) {
      eq('2a the photo names ONLY damage viewers (Dana + boss; Maria unticked is not named)',
        (photoDoc.viewers || []).slice().sort(), ['uid-boss', 'uid-dana']);
      ok('2a the photo doc carries the rendition, keyed as damage',
        photoDoc.dmgKey === key && photoDoc.photo === 'data:image/jpeg;base64,RENDITION');
    }
  }
  /* the union-preserve: a rolled-back rebuild must not unpublish */
  pipeUsers.driver.store.set('dmg_reports', [clone(DMG_B)]);
  await CP().publishRecords();
  const recDoc2 = db._col('sharedrecords').get('uid-driver');
  ok('2d the published damage report SURVIVES a rolled-back rebuild (union)',
    !!recDoc2 && (recDoc2.damage || []).some(function (x) { return x.desc === 'Backed into a light pole'; }),
    JSON.stringify(recDoc2 && recDoc2.damage));
  const key2 = CP().dmgKey(DMG_A);
  ok('2d its photo rendition survives too (prune follows the published section)',
    !!db._col('sharedphotos').get('uid-driver_' + key2));
  pipeUsers.driver.store.set('dmg_reports', [clone(DMG_B), clone(DMG_A), clone(DMG_P2)]);

  /* reader side — Maria (no damage tick) */
  asUser(pipeUsers.maria);
  ok('3b/2b allowsModule(damage) is false for Maria\'s unticked pair', CP().allowsModule('uid-driver', 'damage') === false);
  const mOut = await CP().fetchRecords();
  const mRec = (mOut.records || {})['uid-driver'];
  ok('2b Maria still receives the records doc (fuel was ticked)', !!mRec);
  ok('2b the damage section is STRIPPED for Maria', !!mRec && mRec.damage === undefined);
  ok('2b her ticked fuel section is intact', !!mRec && Array.isArray(mRec.fuel));

  /* reader side — Dana (damage ticked, nothing else records) */
  asUser(pipeUsers.dana);
  ok('2a allowsModule(damage) is true for Dana\'s ticked pair', CP().allowsModule('uid-driver', 'damage') === true);
  const dOut = await CP().fetchRecords();
  const dRec = (dOut.records || {})['uid-driver'];
  ok('2a Dana receives the damage section', !!dRec && Array.isArray(dRec.damage) && dRec.damage.length === 2);
  ok('2a Dana\'s unticked fuel section is stripped', !!dRec && dRec.fuel === undefined);

  /* reader side — the boss (Full access) */
  asUser(pipeUsers.boss);
  ok('3d modulesFor is null under Connect all (no tick restriction)', CP().modulesFor('uid-driver') === null);
  const bOut = await CP().fetchRecords();
  const bRec = (bOut.records || {})['uid-driver'];
  ok('2c a Full-access peer receives the damage section', !!bRec && Array.isArray(bRec.damage) && bRec.damage.length === 2);
}

console.log('— 1f: sendDoc end-to-end — write, land, dedupe, ticks —');
{
  asUser(pipeUsers.driver);
  const r = await CP().sendDoc('uid-boss', {
    type: 'damage', label: 'Damage photo — 2026-11-02 — Backed into a light pole',
    content: { title: 'Backed into a light pole', desc: 'Backed into a light pole', date: '2026-11-02', photo: 'data:image/jpeg;base64,POLEPHOTO' },
    shareId: 'ds-test-1'
  });
  eq('1f sendDoc resolves sent', r, 'sent');
  const docs = Array.from(db._col('pipedispatches').values());
  eq('1f exactly one pipe doc was written', docs.length, 1);
  const pd = docs[0] || {};
  ok('1f the doc is a docshare with the damage payload',
    pd.kind === 'docshare' && pd.docType === 'damage' && pd.shareId === 'ds-test-1' &&
    pd.status === 'sent' && pd.from === 'uid-driver' && pd.to === 'uid-boss' &&
    pd.content && pd.content.photo === 'data:image/jpeg;base64,POLEPHOTO', JSON.stringify(pd).slice(0, 200));
  const pdId = Array.from(db._col('pipedispatches').keys())[0];

  asUser(pipeUsers.boss);
  const landed = await CP().pullInbox();
  ok('1f pullInbox lands the doc share', landed >= 1);
  let shares = pipeUsers.boss.store.get('doc_shares', []);
  eq('1f the receiver holds exactly one doc share', shares.length, 1);
  ok('1f the share carries label, sender and content',
    shares[0] && shares[0].shareId === 'ds-test-1' && shares[0].docType === 'damage' &&
    /light pole/.test(shares[0].label || '') && shares[0].fromName !== undefined &&
    shares[0].content && shares[0].content.photo === 'data:image/jpeg;base64,POLEPHOTO',
    JSON.stringify(shares[0]).slice(0, 200));
  const after1 = db._col('pipedispatches').get(pdId);
  ok('1f delivered tick advanced on landing', after1.status === 'delivered' && after1.deliveredAt > 0, JSON.stringify(after1));
  /* a duplicate delivery of the same shareId under a new pipe id lands once */
  db._col('pipedispatches').set('pd-dupe', Object.assign(clone(pd), { status: 'sent', deliveredAt: 0, seenAt: 0 }));
  CP()._lastPullAt = 0;
  await CP().pullInbox();
  shares = pipeUsers.boss.store.get('doc_shares', []);
  eq('1f a re-delivery with the same shareId does NOT land twice', shares.length, 1);
  /* seen ticks, once */
  const wBefore = db.writes;
  CP().markDocSeen(shares);
  await ticks(3);
  const after2 = db._col('pipedispatches').get(pdId);
  ok('1f seen tick advanced when the share was rendered', after2.status === 'seen' && after2.seenAt > 0, JSON.stringify(after2));
  CP().markDocSeen(shares);
  await ticks(3);
  ok('1f markDocSeen writes once per delivery, ever', db.writes <= wBefore + 2, 'writes ' + wBefore + ' -> ' + db.writes);

  /* a removed peer refuses the send, honestly */
  asUser(pipeUsers.driver);
  pipeUsers.driver.store.set('con_hidden', ['uid-boss']);
  const docsBefore = db._col('pipedispatches').size;
  const r2 = await CP().sendDoc('uid-boss', { type: 'damage', label: 'x', content: {}, shareId: 'ds-test-2' });
  eq('1f sendDoc to a removed peer resolves error', r2, 'error');
  eq('1f nothing was written for the removed peer', db._col('pipedispatches').size, docsBefore);
  pipeUsers.driver.store.set('con_hidden', []);
}

/* ================= (4) v308: the editor gains Maintenance only */
console.log('— 4: EDITOR-MODULES-MISSING-MAINTENANCE — Maintenance ticks, P&L never does —');
{
  /* Maria on a DRIVER account (ONB): under the v207 trim her
     editor hid Maintenance and Save stripped it — it could never
     be granted on Limited. The owner's v308 correction (Nov 2):
     Maintenance joins the editor; P&L does NOT — "P&L is not a
     module for a driver to share." The pipe's internal pnl key
     (CP.MODULE_KEYS) is untouched and untested here as a tick. */
  const keyMatch = cpSrc.match(/CP\.MODULE_KEYS = \[([^\]]+)\]/);
  const PIPE_KEYS = keyMatch ? Array.from(keyMatch[1].matchAll(/'([a-z]+)'/g)).map(function (m) { return m[1]; }) : [];
  eq('4a statics: CP.MODULE_KEYS still carries its ten internal keys', PIPE_KEYS.length, 10);
  const EDITOR_KEYS = PIPE_KEYS.filter(function (k) { return k !== 'pnl'; });
  const w = connectWorld({ con_list: [clone(MARIA)] });
  w.api.render(w.body);
  await ticks(6);
  const editBtn = w.body.querySelectorAll('[data-cn-edit]')[0];
  ok('4 the Edit access door is on her card', !!editBtn);
  if (editBtn) {
    editBtn.onclick();
    await ticks(3);
    const kindBtn = w.body.querySelectorAll('[data-cn-edit-kind="limited"]')[0];
    if (kindBtn) { kindBtn.onclick(); await ticks(3); }
    const tickKeys = w.body.querySelectorAll('[data-cn-editmod]').map(function (b) { return b.getAttribute('data-cn-editmod'); });
    eq('4a the editor lists the module set minus pnl (9 ticks)', tickKeys.slice().sort(), EDITOR_KEYS.slice().sort());
    ok('4a Maintenance IS a tick in the editor', tickKeys.indexOf('maintenance') !== -1, tickKeys.join(','));
    ok('4a P&L is NOT a tick in the editor', tickKeys.indexOf('pnl') === -1, tickKeys.join(','));
    const clMods = (w.CL && w.CL.MODULES) || [];
    const lbl = (k) => { const m = clMods.filter(function (x) { return x.key === k; })[0]; return m ? m.label : ''; };
    ok('4a the maintenance tick carries the Maintenance label', lbl('maintenance') === 'Maintenance', lbl('maintenance'));
    const hOpen = allHtml(w);
    ok('4a the open editor paints the Maintenance row', hOpen.indexOf('Maintenance') !== -1);
    const mRow = w.body.querySelectorAll('[data-cn-editmod="maintenance"]')[0];
    ok('4 the maintenance row is tappable in the editor', !!mRow);
    if (mRow) { mRow.onclick(); await ticks(2); }
    const save = w.body.querySelector('#cn_edit_save');
    ok('4 the editor Save renders', !!save);
    if (save) {
      save.onclick();
      await ticks(6);
      const entry = (w.store.get('con_list', []) || [])[0] || {};
      eq('4b the save persisted kind=limited', entry.kind, 'limited');
      ok('4b the save persisted maintenance on the con_list entry',
        Array.isArray(entry.modules) && entry.modules.indexOf('maintenance') !== -1,
        JSON.stringify(entry.modules));
      ok('4b the save wrote NO pnl tick', Array.isArray(entry.modules) && entry.modules.indexOf('pnl') === -1,
        JSON.stringify(entry.modules));
      const h = allHtml(w);
      ok('4d the card Can-see line names Maintenance',
        h.indexOf('Can see:') !== -1 && h.indexOf('Maintenance') !== -1);
      /* pipe side: the pipe reads the very entry the editor saved */
      asUser(pipeUsers.driver);
      const syncMaria = (e) => (pipeUsers.driver.store.get('con_list', []) || []).map(function (c) {
        return c.uid === 'uid-maria' ? Object.assign({}, c, { kind: e.kind, modules: (e.modules || []).slice() }) : c;
      });
      pipeUsers.driver.store.set('con_list', syncMaria(entry));
      const mods = CP().modulesFor('uid-maria') || [];
      ok('4b CP.modulesFor returns maintenance from the saved entry',
        mods.indexOf('maintenance') !== -1, JSON.stringify(mods));
      ok('4c allowsModule(maintenance) is true while ticked', CP().allowsModule('uid-maria', 'maintenance') === true);
      /* untick maintenance, save again: the grant closes */
      const editBtn2 = w.body.querySelectorAll('[data-cn-edit]')[0];
      if (editBtn2) {
        editBtn2.onclick();
        await ticks(3);
        const row2 = w.body.querySelectorAll('[data-cn-editmod="maintenance"]')[0];
        if (row2) { row2.onclick(); await ticks(2); }
        const save2 = w.body.querySelector('#cn_edit_save');
        if (save2) {
          save2.onclick();
          await ticks(6);
          const e2 = (w.store.get('con_list', []) || [])[0] || {};
          ok('4c the untick persisted (maintenance gone)',
            Array.isArray(e2.modules) && e2.modules.indexOf('maintenance') === -1,
            JSON.stringify(e2.modules));
          pipeUsers.driver.store.set('con_list', syncMaria(e2));
          ok('4c allowsModule(maintenance) is false after untick + save', CP().allowsModule('uid-maria', 'maintenance') === false);
        }
      }
    }
  }
}

/* ================= (5) v309: the card dropdown is GONE ====== */
console.log('— 5: CONNECT-KIND-DROPDOWN-FLICKER — one door: the editor —');
{
  /* Owner, Nov 2, 2026: the connection card's standalone kind
     <select> "flickers away every time I touch it" (the Connect
     screen's live repaints close it) and it duplicates the Edit
     access editor's kind choices. v309 removes the control and
     its handler; the Kind line stays read-only and the editor
     remains the one door for kind changes. */
  ok('5a statics: no card-level kind select survives in the module',
    conSrc.indexOf('data-cn-kindchg') === -1);
  const w = connectWorld({ con_list: [clone(MARIA)] });
  w.api.render(w.body);
  await ticks(6);
  const h = allHtml(w);
  ok('5a the rendered card carries NO kind dropdown',
    w.body.querySelectorAll('[data-cn-kindchg]').length === 0 && h.indexOf('data-cn-kindchg') === -1);
  ok('5c the Kind line still renders her current kind',
    h.indexOf('Kind:') !== -1 && h.indexOf('Full access') !== -1);
  const editBtn = w.body.querySelectorAll('[data-cn-edit]')[0];
  ok('5b the Edit access door is still on her card', !!editBtn);
  if (editBtn) {
    editBtn.onclick();
    await ticks(3);
    const kinds = w.body.querySelectorAll('[data-cn-edit-kind]').map(function (b) { return b.getAttribute('data-cn-edit-kind'); });
    eq('5b the editor still offers all three kinds', kinds.slice().sort(), ['all', 'limited', 'once']);
  }
}

/* ================= (6) v311: send-doc kind rows ============ */
console.log('— 6: SEND-DOC-KIND-PICKER-FLICKER — the Kind select is tappable rows now —');
{
  /* Owner video, Nov 2, 2026, 15:16: the Send doc form's Kind
     <select> flickers on his phone — the same native-control
     family removed from the connection card in v309. v311
     replaces it with in-page radio rows in the v307 editor's
     shape; the tapped row is the kind the send packages, and
     the default stays Damage photo (the old first option). */
  ok('6a statics: the native Kind select is gone from the module',
    conSrc.indexOf('id="cn_ptype"') === -1);
  ok('6a statics: the kind rows exist in the module',
    conSrc.indexOf('data-cn-ptype') !== -1);
  const w = connectWorld({ con_list: [clone(DAVE)], dmg_reports: [clone(DMG_P1)], fuel_fills: [clone(FILL_A)] });
  w.api.render(w.body);
  await ticks(6);
  const docBtn = w.body.querySelectorAll('[data-quick="doc"]')[0];
  ok('6 the Send doc button is on the connection', !!docBtn);
  if (docBtn) {
    docBtn.onclick();
    await ticks(3);
    const h = allHtml(w);
    const formStart = h.indexOf('Send a document to');
    const formEnd = formStart === -1 ? -1 : h.indexOf('id="cn_pcancel"', formStart);
    const form = (formStart !== -1 && formEnd !== -1) ? h.slice(formStart, formEnd) : '';
    ok('6a the send-doc form renders', !!form);
    ok('6a the rendered form contains NO <select>', !!form && form.indexOf('<select') === -1, form.slice(0, 160));
    ok('6a no #cn_ptype control renders', w.body.querySelector('#cn_ptype') === null);
    const rows = w.body.querySelectorAll('[data-cn-ptype]');
    eq('6b one tappable row per kind', rows.length, 9);
    eq('6b the rows are the nine kinds in the old select order',
      rows.map(function (b) { return b.getAttribute('data-cn-ptype'); }),
      ['damage', 'ticket', 'fuel', 'pti', 'odo', 'sticker', 'invoice', 'manifest', 'location']);
    ok('6b Damage photo is the default selection (● on its row)',
      form.indexOf('● 📸 Damage photo') !== -1);
    ok('6b an unchosen kind is a quiet ○ row',
      form.indexOf('○ ⛽ Fuel receipt') !== -1);
    const dmgRow = rows.filter(function (b) { return b.getAttribute('data-cn-ptype') === 'damage'; })[0];
    ok('6b the chosen row carries the selected (primary) styling',
      !!dmgRow && (dmgRow.getAttribute('class') || '').indexOf('primary') !== -1,
      dmgRow && dmgRow.getAttribute('class'));
    eq('6b the default kind lists its items (the damage report)', w.body.querySelectorAll('[data-pick]').length, 1);
    /* tap Fuel receipt: the selection moves, the list follows,
       and the send packages the TAPPED kind */
    const fuelRow = rows.filter(function (b) { return b.getAttribute('data-cn-ptype') === 'fuel'; })[0];
    ok('6c the fuel row is tappable', !!(fuelRow && fuelRow.onclick));
    if (fuelRow && fuelRow.onclick) {
      fuelRow.onclick();
      await ticks(3);
      const h2 = allHtml(w);
      ok('6c the tapped row is now the marked one (● moved to Fuel receipt)',
        h2.indexOf('● ⛽ Fuel receipt') !== -1 && h2.indexOf('○ 📸 Damage photo') !== -1);
      const fuelRow2 = w.body.querySelectorAll('[data-cn-ptype="fuel"]')[0];
      ok('6c the fuel row now carries the selected styling',
        !!fuelRow2 && (fuelRow2.getAttribute('class') || '').indexOf('primary') !== -1,
        fuelRow2 && fuelRow2.getAttribute('class'));
      const picks = w.body.querySelectorAll('[data-pick]');
      eq('6c the item list switched to the tapped kind', picks.length, 1);
      if (picks.length) {
        picks[0].onclick();
        await ticks(5);
        eq('6c the send went out once', w.cap.sendDoc.length, 1);
        const s = w.cap.sendDoc[0] || {};
        ok('6c the send uses the TAPPED kind, not the default',
          s.uid === 'uid-dave' && s.share && s.share.type === 'fuel', JSON.stringify(s));
        ok('6c the fuel content rides the send',
          !!(s.share && s.share.content && s.share.content.photo === 'data:image/jpeg;base64,FUELPHOTO'));
      }
      /* reopen and send the damage photo: the docshare flow
         still sends end-to-end on the default kind */
      const docBtn2 = w.body.querySelectorAll('[data-quick="doc"]')[0];
      ok('6d the Send doc button is back after the send', !!docBtn2);
      if (docBtn2) {
        docBtn2.onclick();
        await ticks(3);
        const picks2 = w.body.querySelectorAll('[data-pick]');
        eq('6d reopening defaults to Damage photo and lists the report', picks2.length, 1);
        if (picks2.length) {
          picks2[0].onclick();
          await ticks(5);
          eq('6d the damage docshare sent too', w.cap.sendDoc.length, 2);
          const s2 = w.cap.sendDoc[1] || {};
          ok('6d the second send is the damage share with its photo',
            s2.share && s2.share.type === 'damage' && s2.share.content && s2.share.content.photo === 'data:image/jpeg;base64,POLEPHOTO',
            JSON.stringify(s2));
          const ob = w.store.get('con_outbox', []);
          eq('6d History holds both sends', ob.length, 2);
          ok('6d both entries are born sent:true',
            ob.length === 2 && ob[0].sent === true && ob[1].sent === true && ob[0].type === 'fuel' && ob[1].type === 'damage',
            JSON.stringify(ob.map(function (o) { return o.type + ':' + o.sent; })));
        }
      }
    }
  }
}

/* ================= (7) v312: BOTH receiver doors ============ */
console.log('— 7: v312 — the Damage module door (primary) + the Connect document door —');
{
  /* Owner, Nov 2, 2026, 15:26–15:27: a Limited connection
     ticked for Damage means the receiver JUST OPENS the
     Damage & Incident module and sees the reports there —
     and the Connect documents card is a working door too.
     Neither door may leave her hunting. */

  /* ---- 7a: the pipe publishes EVERY photo ---- */
  const DMG_C = { tab: 'equipment', desc: 'Backed into a light pole at the site gate', photo: 'data:image/jpeg;base64,P1', photos: ['data:image/jpeg;base64,P1', 'data:image/jpeg;base64,P2', 'data:image/jpeg;base64,P3'], at: '11/2/2026, 11:16:05 AM', date: '2026-11-02', dispatch: 'Butterfly → Aecon', profileId: 'p1' };
  asUser(pipeUsers.driver);
  pipeUsers.driver.store.set('dmg_reports', [clone(DMG_C)]);
  await CP().publishRecords();
  const recDoc7 = db._col('sharedrecords').get('uid-driver');
  /* the union-preserve keeps earlier reports published beside
     it (section 2's pair) — pick THIS report's fact by its text */
  const fact7 = recDoc7 && (recDoc7.damage || []).filter(function (x) { return x.desc === DMG_C.desc; })[0];
  ok('7a the multi-photo report publishes as a fact', !!fact7);
  if (fact7) {
    eq('7a photoKeys carries EVERY photo key', (fact7.photoKeys || []).length, 3);
    ok('7a photoKey still names the first photo', fact7.photoKey === fact7.photoKeys[0]);
    const docs7 = fact7.photoKeys.map(function (k) { return db._col('sharedphotos').get('uid-driver_' + k); });
    ok('7a a rendition doc exists per photo', docs7.every(Boolean));
    ok('7a every rendition names ONLY damage viewers (boss + Dana; Maria unticked is not named)',
      docs7.every(function (d) { return d && (d.viewers || []).slice().sort().join(',') === 'uid-boss,uid-dana'; }),
      JSON.stringify(docs7.map(function (d) { return d && d.viewers; })));
  }

  /* ---- 7b/7c: the receiver's Damage module, rendered ---- */
  function makeDmgEl(tag, attrs) {
    const el = {
      tagName: tag, _attrs: attrs || {}, _html: '', _pool: [], value: '', disabled: false,
      textContent: '', style: {},
      classList: { _s: new Set(),
        add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); },
        toggle: function (c) {}, contains: function (c) { return this._s.has(c); } },
      getAttribute: function (n) { return n in this._attrs ? this._attrs[n] : null; },
      setAttribute: function (n, v) { this._attrs[n] = String(v); },
      onclick: null, onchange: null,
      querySelector: function (sel) {
        if (sel.charAt(0) === '#') { const id = sel.slice(1); return el._pool.filter(function (e) { return e._attrs.id === id; })[0] || null; }
        return null;
      },
      querySelectorAll: function (sel) {
        const m = /^\[([a-zA-Z0-9-]+)(?:="([^"]*)")?\]$/.exec(sel);
        if (!m) return [];
        return el._pool.filter(function (e) {
          if (!(m[1] in e._attrs)) return false;
          return m[2] === undefined || e._attrs[m[1]] === m[2];
        });
      }
    };
    Object.defineProperty(el, 'innerHTML', {
      configurable: true,
      get: function () { return el._html; },
      set: function (v) {
        el._html = String(v); el._pool = [];
        const re = /<(div|button|span|img|p|h3|a)\b([^>]*)>/g;
        let m;
        while ((m = re.exec(el._html))) {
          const attrs = {}; const are = /([a-zA-Z][a-zA-Z0-9-]*)(?:="([^"]*)")?/g; let am;
          while ((am = are.exec(m[2]))) attrs[am[1]] = am[2] === undefined ? '' : am[2];
          el._pool.push(makeDmgEl(m[1], attrs));
        }
      }
    });
    return el;
  }
  function dmgHtml(body) {
    return [body._html].concat(body._pool.map(function (e) { return e._html; })).join('\n');
  }
  vm.runInContext(dmgSrc, sb, { filename: 'modules/damage.js' });

  /* the boss (Full access): the report is listed, opens whole */
  asUser(pipeUsers.boss);
  const bodyB = makeDmgEl('div', {});
  sb.Meticulous.modules.damage.render(bodyB);
  await ticks(8);
  const wrapB = bodyB.querySelector('#dmg_office_wrap');
  ok('7b the office viewer lists the shared report as a card',
    !!wrapB && wrapB._html.indexOf('Damage report from') !== -1, wrapB && wrapB._html.slice(0, 160));
  ok('7b the card says what tapping does', !!wrapB && wrapB._html.indexOf('Tap to open') !== -1);
  ok('7b the multi-photo card counts its photos', !!wrapB && wrapB._html.indexOf('3 photos') !== -1);
  const btnsB = wrapB ? wrapB.querySelectorAll('[data-dmgopen]') : [];
  ok('7b the reports render as tappable cards', btnsB.length >= 1, 'got ' + btnsB.length);
  /* tap the DMG_C card specifically — its index in the list is
     its index in the records the viewer read */
  const bOut7 = await CP().fetchRecords();
  const bDmg7 = ((bOut7.records || {})['uid-driver'] || {}).damage || [];
  const idxC = bDmg7.findIndex(function (x) { return x.desc === DMG_C.desc; });
  ok('7b the receiver\'s records carry the report', idxC !== -1);
  if (idxC !== -1 && btnsB[idxC]) {
    btnsB[idxC].onclick();
    await ticks(8);
    const dh = dmgHtml(bodyB);
    ok('7b the open view shows the full report text', dh.indexOf('Backed into a light pole at the site gate') !== -1);
    ok('7b the open view shows the dispatch line', dh.indexOf('Butterfly → Aecon') !== -1);
    eq('7b the open view loads ALL its photos', (dh.match(/RENDITION/g) || []).length, 3);
    const backB = bodyB.querySelector('#dmg_op_back');
    ok('7b the open view has its Back door', !!backB);
    if (backB) {
      backB.onclick();
      await ticks(8);
      const wrapB2 = bodyB.querySelector('#dmg_office_wrap');
      ok('7b Back returns to the report list',
        !!wrapB2 && wrapB2.querySelectorAll('[data-dmgopen]').length === btnsB.length);
    }
  }

  /* Maria (Limited, damage NOT ticked): she does NOT see it */
  asUser(pipeUsers.maria);
  const bodyM = makeDmgEl('div', {});
  sb.Meticulous.modules.damage.render(bodyM);
  await ticks(8);
  const wrapM = bodyM.querySelector('#dmg_office_wrap');
  ok('7c an unticked receiver does NOT see the report',
    !!wrapM && wrapM.querySelectorAll('[data-dmgopen]').length === 0 && wrapM._html.indexOf('light pole') === -1,
    wrapM && wrapM._html.slice(0, 160));
  ok('7c she gets the honest empty state',
    !!wrapM && wrapM._html.indexOf('No damage reports shared with you yet') !== -1);

  /* leave the pipe world as section 2 left it */
  asUser(pipeUsers.driver);
  pipeUsers.driver.store.set('dmg_reports', [clone(DMG_B), clone(DMG_A), clone(DMG_P2)]);
  await CP().publishRecords();

  /* ---- 7e: the Connect documents card is a door too ---- */
  const share7 = {
    pipeId: 'pd-1', shareId: 'ds-1', docType: 'damage',
    label: 'Damage photo — 2026-11-02 — I was backing up at twin west',
    content: { title: 'Damage report', desc: 'I was backing up at twin west. The pole came in my blind spot.', date: '2026-11-02', dispatch: 'Butterfly → Aecon', photo: 'data:image/jpeg;base64,P1', photos: ['data:image/jpeg;base64,P1', 'data:image/jpeg;base64,P2'] },
    fromUid: 'uid-dave', fromName: 'Dave Cooper', sentAt: 1793662320000, at: 1793662320000
  };
  const w7 = connectWorld({ con_list: [clone(DAVE)], doc_shares: [share7] });
  w7.api.render(w7.body);
  await ticks(6);
  const cards7 = w7.body.querySelectorAll('[data-cn-docopen]');
  eq('7e the received document renders as a tappable card', cards7.length, 1);
  const h7 = allHtml(w7);
  ok('7e the card says what tapping does (and counts the photos)',
    h7.indexOf('Tap to open') !== -1 && h7.indexOf('2 photos') !== -1);
  if (cards7.length) {
    cards7[0].onclick();
    await ticks(3);
    const dh7 = w7.body._html;
    eq('7e the full view shows the report text ONCE (no label echo)',
      dh7.split('I was backing up at twin west').length - 1, 1, dh7.slice(0, 300));
    ok('7e the full view shows the dispatch line', dh7.indexOf('Butterfly → Aecon') !== -1);
    ok('7e the full view shows ALL photos',
      dh7.indexOf('data:image/jpeg;base64,P1') !== -1 && dh7.indexOf('data:image/jpeg;base64,P2') !== -1);
    w7.api.render(w7.body);
    await ticks(3);
    ok('7e a screen repaint keeps the document open',
      w7.body._html.indexOf('I was backing up at twin west') !== -1 &&
      w7.body._html.indexOf('Documents shared with you') === -1);
    const back7 = w7.body.querySelector('#cn_doc_back');
    ok('7e the full view has its Back door', !!back7);
    if (back7) {
      back7.onclick();
      await ticks(4);
      eq('7e Back returns to the documents list', w7.body.querySelectorAll('[data-cn-docopen]').length, 1);
    }
  }

  /* ---- 7f: the sender packages ALL photos + the dispatch -- */
  const multi7 = { tab: 'equipment', desc: 'Multi photo report', photo: 'data:image/jpeg;base64,P1', photos: ['data:image/jpeg;base64,P1', 'data:image/jpeg;base64,P2', 'data:image/jpeg;base64,P3'], at: '11/2/2026, 9:00:00 AM', date: '2026-11-02', dispatch: 'Butterfly → Aecon', profileId: 'p1' };
  const w7f = connectWorld({ con_list: [clone(DAVE)], dmg_reports: [multi7] });
  await openPicker(w7f, 'damage');
  const picks7 = w7f.body.querySelectorAll('[data-pick]');
  eq('7f the multi-photo report is listed in the picker', picks7.length, 1);
  if (picks7.length) {
    picks7[0].onclick();
    await ticks(5);
    const s7 = w7f.cap.sendDoc[0] || {};
    const c7 = (s7.share && s7.share.content) || {};
    eq('7f the package carries ALL photos', (c7.photos || []).length, 3);
    ok('7f the package keeps photo = the first photo', c7.photo === 'data:image/jpeg;base64,P1');
    ok('7f the package carries the dispatch line', c7.dispatch === 'Butterfly → Aecon');
  }

  /* ---- 7g: an oversize photo doc crosses, shrunk for the wire */
  const bigPhoto7 = 'data:image/jpeg;base64,' + 'A'.repeat(950000);
  const big7 = Object.assign(clone(NOV2_ENTRY), {
    content: { title: 'Big', desc: 'Big', date: '2026-11-02', photo: bigPhoto7, photos: [bigPhoto7] }
  });
  const w7g = connectWorld({ con_list: [clone(MARIA)], con_outbox: [big7] },
    { _rendition: function () { return Promise.resolve('data:image/jpeg;base64,SMALL'); } });
  w7g.api.render(w7g.body);
  await ticks(10);
  eq('7g an oversize PHOTO document now crosses, shrunk for the wire', w7g.cap.sendDoc.length, 1);
  const s7g = w7g.cap.sendDoc[0] || {};
  ok('7g the wire copy carries the rendition, not the raw photo',
    !!(s7g.share && s7g.share.content && s7g.share.content.photo === 'data:image/jpeg;base64,SMALL'));
  const ob7g = w7g.store.get('con_outbox', []);
  ok('7g the entry is stamped sent:true', !!(ob7g[0] && ob7g[0].sent === true));
  ok('7g the stored package keeps the original photo (only the wire copy shrank)',
    !!(ob7g[0] && ob7g[0].content && ob7g[0].content.photo === bigPhoto7));
}

/* ================= statics: rules + surfaces ================= */
console.log('— statics: rules gates + the receiver surface —');
{
  const nr = rulesSrc.slice(rulesSrc.indexOf('function pairLimitedNoRecords'), rulesSrc.indexOf('function pairLimitedNoBilling'));
  ok('rules: pairLimitedNoRecords checks the damage tick like every records module',
    nr.indexOf("pairAllows(a, b, 'damage')") !== -1);
  const pipeBlock = rulesSrc.slice(rulesSrc.indexOf('match /pipedispatches/'), rulesSrc.indexOf('match /sharedrecords/'));
  ok('rules: the pipe create door is the sender-as-sent shape a docshare satisfies',
    pipeBlock.indexOf("request.resource.data.status == 'sent'") !== -1 &&
    pipeBlock.indexOf('request.auth.uid == request.resource.data.from') !== -1);
  ok('surface: the Damage module has the office viewer fed by the shared records',
    dmgSrc.indexOf('renderOfficeDamage') !== -1 && dmgSrc.indexOf('rec.damage') !== -1 &&
    dmgSrc.indexOf('fetchRecords') !== -1 && dmgSrc.indexOf('fetchPhoto') !== -1);
  ok('surface: Connect renders the received doc shares',
    conSrc.indexOf('Documents shared with you') !== -1 && conSrc.indexOf('doc_shares') !== -1);
  ok('surface: the office face has a door to the Damage module (v312 — the v307 viewer was unreachable)',
    /office: \['connect', 'dispatch', 'invoice', 'pnl', 'manifest', 'pti', 'damage'\]/.test(appSrc));
}

console.log('\nconnect-doc-delivery-v307: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('HARNESS ERROR', e && e.stack || e); process.exit(2); });
