#!/usr/bin/env node
/* Meticulous v145 — PULL-TO-REFRESH + CONNECT STALE HELPER
 * (owner, Oct 17 21:11 MDT, over his own screen recording of the
 * Connect screen: "When pulled down, it should update by it self!").
 *
 * Part 1 drives the REAL PTR region extracted from js/app.js
 * (/* PTR-BEGIN *\/ ... /* PTR-END *\/) against fake DOM/touch:
 *   - the pure gesture decision table (ptrDecide)
 *   - a full pull fires EXACTLY ONE refresh cycle (cloud settle +
 *     repaint through the screen's own load path); a second pull
 *     mid-cycle fires nothing; the next pull after settle fires again
 *   - a pull that does not start at the very top never fires
 *   - guards: sheet open / sidebar open / Navigator shell up /
 *     chat sheet open / non-main view -> no cycle at all
 *   - dirty-form guard: typing on the visible screen (or a focused
 *     field) lets the sync leg run but SKIPS the repaint — typed
 *     input is never blown away; the dirt is scoped to its screen
 * Part 2 pins the Connect state copy: the pure cnStateNote helper
 *   extracted from modules/connect.js, plus a full behavioural run
 *   of the REAL connect.js + connectlive.js over a fake Firestore —
 *   search -> send -> the "Request sent" line shows; the peer
 *   ACCEPTS; on re-entry the same result card must show the
 *   connected truth and must NOT still claim "they accept it in
 *   their Connect screen" (the owner's recording, Oct 17 21:10).
 * Part 3: statics (CSS pill + overscroll, region wiring, the
 *   request-sent sentence lives ONLY inside cnStateNote).
 * Run: node tools/pull-refresh-v145-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
const conSrc = fs.readFileSync(path.join(ROOT, 'modules', 'connect.js'), 'utf8');
const clSrc = fs.readFileSync(path.join(ROOT, 'js', 'connectlive.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function extractRegion(src, beginMark, endMark) {
  const bi = src.indexOf(beginMark), ei = src.indexOf(endMark);
  if (bi === -1 || ei === -1) throw new Error('region markers missing: ' + beginMark + ' / ' + endMark);
  return src.slice(src.lastIndexOf('/*', bi), src.indexOf('*/', ei) + 2);
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= Part 1: pull-to-refresh ================= */

function fakeEl(id) {
  const e = {
    id: id || '', children: [], style: {}, textContent: '', innerHTML: '',
    _cls: new Set(),
    appendChild(c) { this.children.push(c); return c; }
  };
  e.classList = {
    add: (c) => e._cls.add(c),
    remove: (c) => e._cls.delete(c),
    contains: (c) => e._cls.has(c),
    toggle: (c, f) => { if (f === undefined) f = !e._cls.has(c); f ? e._cls.add(c) : e._cls.delete(c); }
  };
  return e;
}

function makePtrWorld() {
  const els = {};
  const listeners = {};
  const doc = {
    body: fakeEl('body'),
    activeElement: null,
    _nvShell: null,
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    createElement() { return fakeEl(''); },
    querySelector(sel) { return sel === '.nv-shell' ? this._nvShell : null; },
    getElementById(id) { return els[id] || null; }
  };
  const win = { scrollY: 0 };
  const sync = {
    calls: 0, _state: 'ok',
    syncNow() { this.calls++; this._state = 'syncing'; setTimeout(() => { this._state = 'ok'; }, 250); },
    status() { return { state: this._state }; }
  };
  win.CloudSync = sync;
  const calls = { openModule: [], buildDashboard: 0, trackerTick: 0 };
  const App = {
    currentView: 'main', _modKey: null,
    openModule(k) { calls.openModule.push(k); }
  };
  els['modView'] = fakeEl('modView'); els['modView']._cls.add('hidden');
  els['dashView'] = fakeEl('dashView');
  els['sidebar'] = fakeEl('sidebar');
  const sb = {
    console, setTimeout, clearTimeout, Promise,
    window: win, document: doc, App, CloudSync: sync,
    Meticulous: { modules: {} },
    el: (id) => els[id] || null,
    buildDashboard() { calls.buildDashboard++; },
    trackerTick() { calls.trackerTick++; }
  };
  sb.window.document = doc;
  vm.createContext(sb);
  let region = null, regionErr = null;
  try { region = extractRegion(appSrc, '/* PTR-BEGIN', '/* PTR-END */'); }
  catch (e) { regionErr = e; }
  if (region) vm.runInContext(region, sb);
  function fire(type, ev) {
    (listeners[type] || []).slice().forEach((fn) => fn(ev || {}));
  }
  function pull(dy) {
    fire('touchstart', { touches: [{ clientY: 200 }] });
    fire('touchmove', { touches: [{ clientY: 200 + Math.floor(dy / 2) }], cancelable: true, preventDefault() {} });
    fire('touchmove', { touches: [{ clientY: 200 + dy }], cancelable: true, preventDefault() {} });
    fire('touchend', { touches: [], changedTouches: [{ clientY: 200 + dy }] });
  }
  function pill() { return doc.body.children.filter((c) => c.id === 'ptrPill')[0] || null; }
  return { sb, App, els, doc, win, sync, calls, fire, pull, pill, regionErr };
}

async function part1() {
  console.log('— Part 1: pull-to-refresh (extracted PTR region) —');
  const w = makePtrWorld();
  check('PTR region extracts from js/app.js', !w.regionErr, w.regionErr && w.regionErr.message);
  if (w.regionErr) return;
  const D = w.App.ptrDecide;
  check('ptrDecide is exposed', typeof D === 'function');

  /* the pure decision table */
  eq('decide: start at top tracks', D({ phase: 'start', tracking: false, refreshing: false, view: 'main', overlay: false, scrollY: 0, dy: 0 }), 'track');
  eq('decide: start scrolled ignores', D({ phase: 'start', tracking: false, refreshing: false, view: 'main', overlay: false, scrollY: 40, dy: 0 }), 'ignore');
  eq('decide: start under overlay ignores', D({ phase: 'start', tracking: false, refreshing: false, view: 'main', overlay: true, scrollY: 0, dy: 0 }), 'ignore');
  eq('decide: start while refreshing ignores', D({ phase: 'start', tracking: false, refreshing: true, view: 'main', overlay: false, scrollY: 0, dy: 0 }), 'ignore');
  eq('decide: start on auth ignores', D({ phase: 'start', tracking: false, refreshing: false, view: 'auth', overlay: false, scrollY: 0, dy: 0 }), 'ignore');
  eq('decide: move downward at top shows', D({ phase: 'move', tracking: true, refreshing: false, view: 'main', overlay: false, scrollY: 0, dy: 30 }), 'show');
  eq('decide: move after content scrolled hides', D({ phase: 'move', tracking: true, refreshing: false, view: 'main', overlay: false, scrollY: 12, dy: 30 }), 'hide');
  eq('decide: end past threshold fires', D({ phase: 'end', tracking: true, refreshing: false, view: 'main', overlay: false, scrollY: 0, dy: 120 }), 'fire');
  eq('decide: end short of threshold cancels', D({ phase: 'end', tracking: true, refreshing: false, view: 'main', overlay: false, scrollY: 0, dy: 30 }), 'cancel');
  eq('decide: end untracked ignores', D({ phase: 'end', tracking: false, refreshing: false, view: 'main', overlay: false, scrollY: 0, dy: 120 }), 'ignore');

  /* a full pull on the dashboard = one cycle: sync + dashboard repaint */
  w.pull(140);
  await sleep(100);
  eq('pull: syncNow called exactly once', w.sync.calls, 1);
  check('pull: indicator shows Refreshing', !!w.pill() && /Refreshing/.test(w.pill().textContent), w.pill() && w.pill().textContent);
  /* a second pull mid-cycle fires nothing */
  w.pull(140);
  await sleep(50);
  eq('pull: no double-fire while refreshing', w.sync.calls, 1);
  await sleep(1400);
  eq('pull: dashboard repainted once (cards)', w.calls.buildDashboard, 1);
  eq('pull: dashboard repainted once (tracker)', w.calls.trackerTick, 1);
  check('pull: indicator settled and hid', !!w.pill() && !w.pill().classList.contains('show'));
  /* the next pull after settle fires a fresh cycle */
  w.pull(140);
  await sleep(1200);
  eq('pull: second cycle syncs again', w.sync.calls, 2);
  eq('pull: second cycle repaints again', w.calls.buildDashboard, 2);

  /* short pull = no cycle */
  w.pull(30);
  await sleep(300);
  eq('short pull: no sync', w.sync.calls, 2);

  /* a pull that starts scrolled never fires */
  w.win.scrollY = 240;
  w.pull(160);
  await sleep(300);
  eq('scrolled start: no sync', w.sync.calls, 2);
  w.win.scrollY = 0;

  /* module screen: the repaint re-enters through App.openModule */
  w.els['modView']._cls.delete('hidden');
  w.App._modKey = 'dispatch';
  w.pull(140);
  await sleep(1200);
  eq('module pull: syncs', w.sync.calls, 3);
  eq('module pull: re-enters the same module', w.calls.openModule, ['dispatch']);

  /* guards: sheet open */
  w.els['fbSheet'] = fakeEl('fbSheet'); w.els['fbSheet']._cls.add('open');
  w.pull(140);
  await sleep(300);
  eq('guard: sheet open -> no sync', w.sync.calls, 3);
  w.els['fbSheet']._cls.delete('open');
  /* guards: Navigator shell up */
  w.doc._nvShell = fakeEl('nv');
  w.pull(140);
  await sleep(300);
  eq('guard: navigator shell -> no sync', w.sync.calls, 3);
  w.doc._nvShell = null;
  /* guards: chat sheet open */
  w.els['chatSheet'] = fakeEl('chatSheet'); w.els['chatSheet']._cls.add('open');
  w.pull(140);
  await sleep(300);
  eq('guard: chat sheet open -> no sync', w.sync.calls, 3);
  w.els['chatSheet']._cls.delete('open');
  /* guards: sidebar open */
  w.els['sidebar']._cls.add('open');
  w.pull(140);
  await sleep(300);
  eq('guard: sidebar open -> no sync', w.sync.calls, 3);
  w.els['sidebar']._cls.delete('open');
  /* guards: not on the main view */
  w.App.currentView = 'onboarding';
  w.pull(140);
  await sleep(300);
  eq('guard: onboarding view -> no sync', w.sync.calls, 3);
  w.App.currentView = 'main';

  /* dirty form: typing on the visible screen — sync runs, repaint does NOT */
  w.App._modKey = 'fuel';
  w.fire('input', { target: { tagName: 'INPUT' } });
  w.pull(140);
  await sleep(1200);
  eq('dirty: sync leg still runs', w.sync.calls, 4);
  eq('dirty: repaint skipped (typed input kept)', w.calls.openModule, ['dispatch']);
  /* the dirt belongs to its screen: after moving to another module the pull repaints */
  w.App._modKey = 'pnl';
  w.pull(140);
  await sleep(1200);
  eq('dirty is screen-scoped: other screen repaints', w.calls.openModule, ['dispatch', 'pnl']);

  /* focused field on the dashboard: sync runs, dashboard NOT repainted */
  w.els['modView']._cls.add('hidden');
  w.App._modKey = null;
  w.doc.activeElement = { tagName: 'TEXTAREA' };
  w.pull(140);
  await sleep(1200);
  eq('focused field: sync leg runs', w.sync.calls, 6);
  eq('focused field: dashboard repaint skipped', w.calls.buildDashboard, 2);
  w.doc.activeElement = null;
  w.pull(140);
  await sleep(1200);
  eq('focus released: dashboard repaints again', w.calls.buildDashboard, 3);
}

/* ================= Part 2: Connect state copy ================= */

/* fake Firestore (compat shape), same pattern as connect-live-test */
function FakeDb() { this.cols = {}; this.writes = 0; }
FakeDb.prototype._col = function (name) { return this.cols[name] || (this.cols[name] = new Map()); };
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
FakeDb.prototype.collection = function (name) {
  const db = this;
  const q = (filters) => ({
    where: (f, op, v) => q(filters.concat([[f, op, v]])),
    get: () => {
      const rows = [];
      db._col(name).forEach((data, id) => {
        const okF = filters.every(([f, op, v]) => {
          const dv = data[f];
          if (op === '==') return dv === v;
          if (op === '>=') return dv >= v;
          if (op === '<') return dv < v;
          if (op === 'array-contains') return Array.isArray(dv) && dv.indexOf(v) !== -1;
          return false;
        });
        if (okF) rows.push([id, data]);
      });
      return Promise.resolve(querySnap(rows));
    }
  });
  return Object.assign(q([]), {
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
      }
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
function flush() {
  return new Promise((res) => { let n = 0; (function step() { if (++n > 40) return res(); setTimeout(step, 0); })(); });
}

async function part2() {
  console.log('— Part 2: Connect state copy (cnStateNote + real render) —');
  let noteFn = null, noteErr = null;
  try {
    const region = extractRegion(conSrc, '/* CN-NOTE-BEGIN', '/* CN-NOTE-END');
    const sbx = { console };
    vm.createContext(sbx);
    vm.runInContext(region + '\n;this.__note = cnStateNote;', sbx);
    noteFn = sbx.__note;
  } catch (e) { noteErr = e; }
  check('CN-NOTE region extracts from modules/connect.js', !noteErr, noteErr && noteErr.message);
  if (noteFn) {
    eq('note: sent state carries the request-sent line', noteFn('sent', 'Umar'),
      'Request sent to Umar — they accept it in their Connect screen.');
    const cn = noteFn('connected', 'Umar');
    check('note: connected state tells the connected truth', /Connected/.test(cn) && cn.indexOf('Umar') !== -1, cn);
    check('note: connected state NEVER claims the request is still out', cn.indexOf('they accept it in their Connect screen') === -1, cn);
    check('note: incoming state points at Requests', /asked you/.test(noteFn('incoming', 'Umar')), noteFn('incoming', 'Umar'));
    eq('note: none state is silent', noteFn('none', 'Umar'), '');
    eq('note: declined state carries no sent claim', noteFn('declined', 'Umar'), '');
  }
  /* the sentence lives ONLY in the helper — no stored copy can lag */
  eq('statics: the request-sent sentence occurs exactly once in connect.js',
    conSrc.split('they accept it in their Connect screen').length - 1, 1);
  check('statics: resultsHtml derives its tail from cnStateNote + peerState',
    conSrc.indexOf('cnStateNote(peerState(') !== -1);

  /* behavioural: real connect.js + connectlive.js over the fake db */
  const db = new FakeDb();
  const users = {
    owner: {
      uid: 'uid-owner', email: 'asjadkamal482@gmail.com',
      store: makeStore({ onboarding: { companyName: 'Asjad Kamal', accountType: 'Owner-Operator' }, con_list: [], con_outbox: [] })
    },
    ahmed: {
      uid: 'uid-ahmed', email: 'ahmed_thraya@hotmail.com',
      store: makeStore({ onboarding: { companyName: 'Ahmed Thraya', accountType: 'Fleet Manager' }, con_list: [], con_outbox: [] })
    },
    umar: {
      uid: 'uid-umar', email: 'umar.trucking@example.com',
      store: makeStore({ onboarding: { companyName: 'Umar Dump Truck', accountType: 'Driver' }, con_list: [], con_outbox: [] })
    }
  };
  const sb = { console, setTimeout, Promise };
  sb.window = sb;
  sb.Meticulous = { modules: {} };
  vm.createContext(sb);
  vm.runInContext(clSrc, sb);
  vm.runInContext(conSrc, sb);
  function asUser(u) {
    sb.FB = { ready: true, user: { uid: u.uid, email: u.email }, db: db };
    sb.App = {
      _store: u.store,
      _esc: (s) => String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      _today: () => '2026-10-17'
    };
    sb.window.FB = sb.FB; sb.window.App = sb.App;
    sb.ConnectLive._pubKey = '';
  }
  const CL = () => sb.ConnectLive;

  function makeBody() {
    const cache = {};
    const stub = (sel) => cache[sel] || (cache[sel] = {
      value: '', textContent: '', innerHTML: '', style: {}, disabled: false,
      classList: { toggle() {}, add() {}, remove() {} },
      setAttribute() {}, getAttribute() { return null; },
      focus() {}, scrollIntoView() {}
    });
    const connectBtn = {
      disabled: false, textContent: '', onclick: null,
      getAttribute(k) { return k === 'data-cn-connect' ? '0' : null; }
    };
    return {
      innerHTML: '',
      _stub: stub, _connectBtn: connectBtn,
      querySelector: stub,
      querySelectorAll: (sel) => (sel === '[data-cn-connect]' ? [connectBtn] : [])
    };
  }

  asUser(users.ahmed); await CL().publishMine();
  asUser(users.umar); await CL().publishMine();
  asUser(users.owner);

  const body = makeBody();
  sb.Meticulous.modules.connect.render(body);
  await flush();
  body._stub('#cn_q').value = 'Ahmed';
  body._stub('#cn_search').onclick();
  await flush();
  const res1 = body._stub('#cn_results').innerHTML;
  check('flow: search finds Ahmed with a live Connect door', res1.indexOf('Ahmed Thraya') !== -1 && res1.indexOf('🤝 Connect') !== -1, res1.slice(0, 200));
  check('flow: no request claim before any send', res1.indexOf('Request sent to') === -1);

  body._connectBtn.onclick();
  await flush();
  const res2 = body._stub('#cn_results').innerHTML;
  check('flow: after send, the line says the request is out', res2.indexOf('Request sent to Ahmed Thraya — they accept it in their Connect screen.') !== -1, res2.slice(0, 300));
  check('flow: after send, the button is the sent state', res2.indexOf('Request sent ✓') !== -1);

  /* the peer accepts */
  asUser(users.ahmed);
  const mine = await CL().listMine();
  const inc = mine.incoming.filter((q) => q.status === 'pending')[0];
  check('flow: ahmed sees the incoming request', !!inc);
  await CL().respond(inc, true);
  await flush();

  /* the owner comes back (re-entry — the same path a pull takes) */
  asUser(users.owner);
  sb.Meticulous.modules.connect.render(body);
  await flush(); await flush();
  const res3 = body._stub('#cn_results').innerHTML;
  check('flow: after accept, the card shows the connected state', res3.indexOf('✓ Connected') !== -1, res3.slice(0, 300));
  check('flow: after accept, the stale request-sent line is GONE', res3.indexOf('they accept it in their Connect screen') === -1, res3.slice(0, 300));
  check('flow: after accept, the tail tells the connected truth', res3.indexOf('✓ Connected to Ahmed Thraya') !== -1, res3.slice(0, 300));
  check('flow: the connection itself landed in Current connections', body.innerHTML.indexOf('🤝 Connected') !== -1);

  /* a fresh search clears the peer note — no other name inherits it */
  body._stub('#cn_q').value = 'Umar';
  body._stub('#cn_search').onclick();
  await flush();
  const res4 = body._stub('#cn_results').innerHTML;
  check('flow: a new search shows the new peer clean', res4.indexOf('Umar Dump Truck') !== -1 && res4.indexOf('Ahmed Thraya') === -1, res4.slice(0, 200));
}

/* ================= Part 3: statics ================= */

function part3() {
  console.log('— Part 3: statics —');
  check('css: the pill is styled', cssSrc.indexOf('#ptrPill') !== -1);
  check('css: the app owns the top overscroll (no browser pull-reload)', cssSrc.indexOf('overscroll-behavior-y') !== -1);
  check('app.js: PTR region wires touch listeners',
    appSrc.indexOf("addEventListener('touchstart'") !== -1 && appSrc.indexOf("addEventListener('touchend'") !== -1);
  check('app.js: the refresh runs the cloud settle (CloudSync.syncNow) from the PTR region',
    (() => { try { return extractRegion(appSrc, '/* PTR-BEGIN', '/* PTR-END */').indexOf('CloudSync.syncNow') !== -1; } catch (e) { return false; } })());
  check('app.js: navigation repaints clear the dirt (openModule + showDashboard)',
    (appSrc.split('ptrNoteRepainted').length - 1) >= 3);
}

(async function main() {
  await part1();
  await part2();
  part3();
  console.log('pull-refresh-v145: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  CRASH ' + (e && e.stack || e)); console.log('pull-refresh-v145: ' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
