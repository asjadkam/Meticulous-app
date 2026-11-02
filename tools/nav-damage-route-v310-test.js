#!/usr/bin/env node
/* Meticulous v310 — NAV-DAMAGE-OPENS-WRONG-MODULE (owner video,
 * Nov 2, 2026 14:27 MDT: he opens the side menu, taps "Damage &
 * Incident", the header reads "Damage & Incident" but the BODY
 * shows the Connect module — Find people / Requests / Current
 * connections; his words: it "keeps opening preferences", the
 * Damage module never appears).
 *
 * ROOT CAUSE (proven in this harness against the pre-fix code):
 * the registry and the menu are wired right — 'damage' reaches
 * App.openModule and Meticulous.modules.damage renders the real
 * form. The thief is Connect: modules/connect.js's render arms
 * ASYNC completions (refreshLive's reconcile leg, pullInbox,
 * flushOutbox's done) that funnel into one `rerender` closure
 * capturing the shell's ONE shared module body. When a
 * completion lands after the user has navigated away, it
 * repaints Connect's DOM over the open module's screen, under
 * that module's own title. The owner had a queued docshare
 * flushing and a connection reconciling — both fire it.
 *
 * THE FIX (v310, modules/connect.js only): the rerender funnel
 * checks the shell's App._modKey — the truth of what is open —
 * and a completion that lands while another module holds the
 * body does not paint. Connect re-reads everything on its next
 * real open, so nothing is lost.
 *
 * This suite:
 *  1. STATIC WIRING AUDIT — every sidebar entry and every
 *     MODULE_META key maps to a module registered under the
 *     SAME key in modules/ (shell specials dashboard/feedback/
 *     logout excepted); damage is registered by damage.js,
 *     connect by connect.js, and neither file registers the
 *     other's key (the collision suspects, ruled out).
 *  2. THE VIDEO, REPLAYED — shell opens Connect (its async
 *     legs armed on deferred promises), the sidebar's Damage &
 *     Incident entry is "tapped" through the shell's real
 *     title code (extracted MODULE_META/moduleTitle) — header
 *     reads "Damage & Incident", body is the damage form —
 *     then Connect's completions land late (reconcile changed,
 *     inbox pulled 2, queued docshare sent): the body must
 *     STILL be the damage form, with no Connect DOM in it.
 *  3. CONTROL — the same completions landing while Connect is
 *     still the open module DO repaint it (the guard starves
 *     nothing on its own screen).
 *
 * Run: node tools/nav-damage-route-v310-test.js
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
const dmgSrc = read('modules/damage.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
const clone = (v) => JSON.parse(JSON.stringify(v));
function tick() { return new Promise(function (r) { setTimeout(r, 5); }); }
async function ticks(n) { for (let i = 0; i < (n || 4); i++) await tick(); }

/* ================= helpers (v307 harness shape) ============ */
function makeStore(seed) {
  const m = new Map(Object.entries(clone(seed || {})));
  return {
    get: (k, d) => (m.has(k) ? clone(m.get(k)) : d),
    set: (k, v) => { m.set(k, clone(v)); return true; },
    del: (k) => { m.delete(k); return true; }
  };
}
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

/* ================= 1. static wiring audit ================== */
console.log('== 1. static wiring audit ==');
const sidebarBlock = /var SIDEBAR_ITEMS = \[([\s\S]*?)\];/.exec(appSrc);
ok('SIDEBAR_ITEMS found in js/app.js', !!sidebarBlock);
const sidebar = [];
if (sidebarBlock) {
  const re = /\[\s*'([a-z]+)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\]/g;
  let m;
  while ((m = re.exec(sidebarBlock[1]))) sidebar.push({ key: m[1], icon: m[2], label: m[3] });
}
ok('sidebar entries parsed', sidebar.length >= 15, 'got ' + sidebar.length);
const dmgItem = sidebar.filter(function (it) { return it.key === 'damage'; })[0];
ok('sidebar carries a damage entry', !!dmgItem);
ok('the damage entry is labelled "Damage & Incident"', !!dmgItem && dmgItem.label === 'Damage & Incident',
  dmgItem ? dmgItem.label : 'none');

const modDir = path.join(ROOT, 'modules');
const registrations = {};   // key -> file
fs.readdirSync(modDir).filter(function (f) { return f.endsWith('.js'); }).forEach(function (f) {
  const src = read('modules/' + f);
  const re = /Meticulous\.modules\.([a-zA-Z]+)\s*=/g;
  let m;
  while ((m = re.exec(src))) registrations[m[1]] = f;
});
const SHELL_SPECIALS = { dashboard: 1, feedback: 1, logout: 1 };
const unrouted = sidebar.filter(function (it) {
  return !SHELL_SPECIALS[it.key] && registrations[it.key] !== it.key + '.js';
});
ok('every sidebar entry routes to the module registered under its own key',
  unrouted.length === 0, unrouted.map(function (it) { return it.key; }).join(','));
ok("damage is registered by modules/damage.js", registrations.damage === 'damage.js', registrations.damage);
ok("connect is registered by modules/connect.js", registrations.connect === 'connect.js', registrations.connect);
ok("damage.js does not register 'connect'", !/Meticulous\.modules\.connect\s*=/.test(dmgSrc));
ok("connect.js does not register 'damage'", !/Meticulous\.modules\.damage\s*=/.test(conSrc));
/* the one deliberate alias: the retired 'navigation' module
   registers under its own key and the shell routes the key to
   'navigator' (v119) — it is not a sidebar entry, so it cannot
   misroute a tap. */
ok("the 'navigation' alias is shell-side only (not a sidebar entry)",
  registrations.navigation === 'navigation.js' && !sidebar.some(function (it) { return it.key === 'navigation'; }));

/* ================= the world =============================== */
const ONB = {
  accountType: 'Driver', userRole: 'driver', firstName: 'Asjad', lastName: 'Kamal',
  companyName: 'Asjad Kamal', contractingCo: 'AI Trucking'
};
const MARIA = { id: 'c-maria', name: 'Maria Lott', role: 'Fleet Manager', uid: 'uid-maria', status: 'connected', kind: 'limited', modules: ['dispatch', 'manifest', 'pti', 'navigation', 'damage'], viaConnect: true };
const QUEUED_DOC = { id: 'ob-1', type: 'damage', connId: 'c-maria', sent: false, label: 'Damage report', content: { desc: 'Backed into a light pole', date: '2026-11-02' } };
const MY_REPORT = { tab: 'equipment', desc: 'Backed into a light pole', photo: '', photos: [], at: '11/2/2026, 11:16:05 AM', date: '2026-11-02', dispatch: '' };

const store = makeStore({
  onboarding: clone(ONB),
  con_list: [clone(MARIA)],
  con_outbox: [clone(QUEUED_DOC)],
  dmg_reports: [clone(MY_REPORT)],
  dmg_tab: 'equipment'
});
const win = {};
win.window = win;
win.console = console;
win.store = store;
const escFn = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const body = makeBody();
const shell = { title: '', error: null };
win.App = {
  _store: store, _today: () => '2026-11-02', _esc: escFn, _modKey: null,
  user: { uid: 'uid-me' }
};
vm.createContext(win);
/* the shell's REAL role + title code, extracted from js/app.js */
vm.runInContext(extractRegion(appSrc, 'ROLE-BEGIN', 'ROLE-END'), win, { filename: 'app-role.js' });
vm.runInContext(extractRegion(appSrc, 'MODULE-TITLE-BEGIN', 'MODULE-TITLE-END'), win, { filename: 'app-module-title.js' });
ok('shell title code extracted (MODULE_META + moduleTitle)',
  !!win.MODULE_META && typeof win.moduleTitle === 'function' && win.moduleTitle('damage') === 'Damage & Incident',
  win.MODULE_META ? String(win.moduleTitle && win.moduleTitle('damage')) : 'no MODULE_META');
const metaKeys = Object.keys(win.MODULE_META || {});
const metaUnrouted = metaKeys.filter(function (k) { return registrations[k] !== k + '.js'; });
ok('every MODULE_META key maps to the module registered under its own key',
  metaUnrouted.length === 0, metaUnrouted.join(','));

/* ConnectLive: the real file, its cloud legs replaced by
   deferred promises the test resolves by hand — that is what
   makes the late landing deterministic. */
vm.runInContext(clSrc, win, { filename: 'connectlive.js' });
const CL = win.ConnectLive;
const pend = { listMine: [], reconcile: [], pullInbox: [], sendDoc: [] };
function defer(arr) { let res; const p = new Promise(function (r) { res = r; }); arr.push({ p: p, res: res }); return p; }
CL.listMine = () => defer(pend.listMine);
CL.reconcile = () => defer(pend.reconcile);
CL.publishMine = () => {};
CL.respond = () => Promise.resolve({});
CL.sendRequest = () => Promise.resolve('sent');
CL.search = () => Promise.resolve([]);
CL.defaultKindFor = () => 'limited';
CL.defaultKindForRequest = () => 'limited';
win.FB = { ready: true, user: { uid: 'uid-me' }, db: null };
win.Meticulous = { modules: { navigation: { shareablePlaces: () => [] } } };
const cap = { sendDoc: [] };
win.ConnectPipe = {
  sendDestination: () => Promise.resolve('sent'),
  sendDispatch: () => Promise.resolve('sent'),
  sendDoc: (uid, share) => { cap.sendDoc.push({ uid: uid, share: clone(share) }); return defer(pend.sendDoc); },
  pullInbox: () => defer(pend.pullInbox),
  publishAll: () => {}, publishRecent: () => Promise.resolve(true)
};
vm.runInContext(conSrc, win, { filename: 'modules/connect.js' });
vm.runInContext(dmgSrc, win, { filename: 'modules/damage.js' });
ok('both modules registered in the world',
  !!win.Meticulous.modules.connect && !!win.Meticulous.modules.damage);

/* render counter on Connect (its internal rerender resolves
   through the registry, so this counts stale repaints too) */
let connectRenders = 0;
const origConnectRender = win.Meticulous.modules.connect.render;
win.Meticulous.modules.connect.render = function (b) { connectRenders++; return origConnectRender(b); };

/* the shell's dispatch, mirroring js/app.js App.openModule for
   module keys (registry lookup -> _modKey -> title -> wipe ->
   resetView -> render), with the title from the REAL code */
win.App.openModule = function (key) {
  if (key === 'navigation') key = 'navigator'; // v119 alias, as in the shell
  const mod = win.Meticulous.modules[key];
  if (!mod) return false;
  win.App._modKey = key;
  shell.title = win.MODULE_META[key] ? win.moduleTitle(key) : key;
  body.innerHTML = '';
  try { if (mod.resetView) mod.resetView(); } catch (e) {}
  try { mod.render(body); } catch (e) { shell.error = e; body.innerHTML = '<div class="empty">Could not load module.</div>'; }
  return true;
};

async function settleConnectLegs() {
  /* listMine lands -> refreshLive asks reconcile; then every
     armed leg lands the way the owner's phone landed them:
     the pair CHANGED, the inbox had news, the queued
     docshare crossed. */
  pend.listMine.splice(0).forEach(function (d) { d.res({ incoming: [], outgoing: [] }); });
  await ticks(3);
  pend.reconcile.splice(0).forEach(function (d) { d.res(true); });
  pend.pullInbox.splice(0).forEach(function (d) { d.res(2); });
  pend.sendDoc.splice(0).forEach(function (d) { d.res('sent'); });
  await ticks(8);
}

/* ================= 2. the video, replayed ================== */
(async function () {
  console.log('== 2. the video, replayed ==');
  win.App.openModule('connect');
  await ticks(2);
  ok('Connect opens as Connect', body.innerHTML.indexOf('Find people') >= 0 && win.App._modKey === 'connect');
  ok('the queued docshare send is in flight', cap.sendDoc.length === 1, 'sendDoc calls: ' + cap.sendDoc.length);
  const rendersArmed = connectRenders;

  /* the tap: the sidebar button for Damage & Incident calls
     App.openModule('damage') — the exact handler in
     buildSidebar. */
  win.App.openModule(dmgItem.key);
  ok('header reads "Damage & Incident"', shell.title === 'Damage & Incident', shell.title);
  ok('body is the Damage module (report form)',
    body.innerHTML.indexOf('id="dg_add"') >= 0 && body.innerHTML.indexOf('New report') >= 0);
  ok('the filed pole report shows in the history list',
    body.innerHTML.indexOf('Backed into a light pole') >= 0);
  ok('no Connect DOM on the Damage screen',
    body.innerHTML.indexOf('Find people') === -1 && body.innerHTML.indexOf('cn_req_wrap') === -1);

  await settleConnectLegs();
  ok("Connect's late completions did not repaint over Damage",
    connectRenders === rendersArmed, 'connect renders: ' + rendersArmed + ' -> ' + connectRenders);
  ok('body is STILL the Damage module after the late legs land',
    body.innerHTML.indexOf('id="dg_add"') >= 0 && body.innerHTML.indexOf('New report') >= 0);
  ok('header still reads "Damage & Incident"', shell.title === 'Damage & Incident' && win.App._modKey === 'damage');
  ok('no Connect DOM crept in late',
    body.innerHTML.indexOf('Find people') === -1 && body.innerHTML.indexOf('Current connections') === -1);
  ok('the docshare still crossed (the send itself was never blocked)',
    (store.get('con_outbox', [])[0] || {}).sent === true);

  /* ================= 3. control ============================ */
  console.log('== 3. control: Connect open, legs land, Connect repaints ==');
  win.App.openModule('connect');
  await ticks(2);
  const beforeControl = connectRenders;
  await settleConnectLegs();
  ok('legs landing while Connect is open DO repaint Connect',
    connectRenders > beforeControl, 'renders: ' + beforeControl + ' -> ' + connectRenders);
  ok('the repainted screen is Connect itself',
    body.innerHTML.indexOf('Find people') >= 0 && win.App._modKey === 'connect');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
