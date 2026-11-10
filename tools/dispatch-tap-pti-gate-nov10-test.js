#!/usr/bin/env node
'use strict';
/* DISPATCH-TAP-ROUTES-TO-PTI-NOV10 — owner screen recording,
 * Nov 10, 2026, 07:25 CST: the dashboard showed "Ready to work /
 * Starts 8:30 AM · Aecon Trans / ⚠ No PTI filed today"; he tapped
 * the DISPATCH card and was forced into the PTI Inspection Mode
 * (officer) view; the only exit was the orange Exit Inspection
 * Mode button.
 *
 * CONVICTION (code-read): the card wiring is faithful — every
 * dashboard card calls App.openModule(data-mod) (js/app.js). The
 * hijack is the v165 DOT LOCK: openModule rewrites ANY non-PTI
 * key to 'pti' while dotLockActive() reads a stored
 * pti_dot.active, and showDashboard routes there too. That state
 * is an ordinary SYNCED store record (cloudsync isSyncable takes
 * every key): an activation minted days earlier on any client —
 * the Nov 5 roadside stop is the standing example — can sit in
 * the store, or re-land from the cloud, with NO freshness bound
 * and NO on-screen signal (buildDashboard never consults it), so
 * the driver's next module tap springs it: navigation is
 * replaced by Inspection Mode he never entered that day.
 *
 * THE RULE (owner, Nov 10): a module tap opens the module
 * tapped. Inspection Mode remains what it was designed to be —
 * a DELIBERATE Begin tap on this phone, binding while it is
 * fresh — but a stale or unstamped activation never engages the
 * shell lock, and the shell clears it on sight so it cannot
 * re-arm. The missing-PTI nudge (dashboard flag + once-a-day
 * sheet) stays exactly as it was: a flag and a sheet, never a
 * redirect.
 *
 * Part A runs the REAL shell functions (dotLockActive,
 * teardownModule, showDashboard, openModule) extracted from
 * js/app.js over an in-memory store. Part B runs the REAL
 * modules/pti.js (v327 harness shape) for the module-side rule.
 * Run: node tools/dispatch-tap-pti-gate-nov10-test.js */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');
const ptiSrc = read('modules/pti.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function section(name, fn) {
  console.log('\n— ' + name + ' —');
  try { fn(); } catch (e) { fail++; console.log('  FAIL section threw: ' + (e && e.stack || e)); }
}

/* ================= Part A: the shell ================= */
const RealDate = Date;
const NOW = new RealDate(2026, 10, 10, 13, 25, 0).getTime(); // Nov 10, 07:25 MST
const HOUR = 3600000, DAYMS = 86400000;
function FakeDate(...args) { return args.length ? new RealDate(...args) : new RealDate(NOW); }
FakeDate.now = () => NOW;
FakeDate.parse = RealDate.parse;
FakeDate.UTC = RealDate.UTC;
FakeDate.prototype = RealDate.prototype;

function extractFn(src, marker) {
  const i = src.indexOf(marker);
  if (i === -1) throw new Error('marker not found: ' + marker);
  let depth = 0, j = src.indexOf('{', i);
  const start = src.lastIndexOf('\n', i) + 1;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + marker);
}

function makeEl(id) {
  const classes = new Set();
  return {
    id: id, textContent: '', innerHTML: '', style: {},
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c),
      toggle: (c) => { classes.has(c) ? classes.delete(c) : classes.add(c); },
      contains: (c) => classes.has(c)
    },
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, setAttribute() {}, getAttribute() { return null; }
  };
}

function makeShell(dotSeed) {
  const data = { pti_reports: [] };
  if (dotSeed !== undefined) data.pti_dot = JSON.parse(JSON.stringify(dotSeed));
  const store = {
    _data: data,
    get(k, d) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : d; },
    set(k, v) { data[k] = JSON.parse(JSON.stringify(v)); },
    del(k) { delete data[k]; }
  };
  const renders = [];
  const els = {};
  const sb = {
    console: console, Date: FakeDate,
    Meticulous: { modules: {
      dispatch: { render() { renders.push('dispatch'); } },
      pti: { render() { renders.push('pti'); } }
    } },
    MODULE_META: { dispatch: { title: 'Dispatch', icon: '🚚', tier: 'basic' }, pti: { title: 'PTI', icon: '🔍', tier: 'basic' } },
    moduleTitle: (k) => k,
    esc: (s) => String(s == null ? '' : s),
    paintPowerBanner() {},
    scrollTo() {},
    buildDashboard() { renders.push('dashboard'); },
    el(id) { return els[id] || (els[id] = makeEl(id)); },
    window: null
  };
  sb.window = sb;
  sb.App = {
    _store: store, _modKey: null,
    tierAllows() { return true; },
    ptrNoteRepainted() {}
  };
  sb.window.App = sb.App;
  vm.createContext(sb);
  /* the lock bound rides with the predicate (it is declared
     immediately above it in js/app.js) */
  const boundDecl = /var DOT_LOCK_MAX_MS = [^;]+;/.exec(appSrc);
  if (!boundDecl) throw new Error('DOT_LOCK_MAX_MS declaration not found in js/app.js');
  vm.runInContext(
    boundDecl[0] + '\n' +
    extractFn(appSrc, 'function dotLockActive') + '\n' +
    extractFn(appSrc, 'function teardownModule') + '\n' +
    extractFn(appSrc, 'App.showDashboard = function') + '\n' +
    extractFn(appSrc, 'App.openModule = function'), sb);
  return { sb: sb, App: sb.App, store: store, renders: renders, els: els };
}

section('A1 — the field morning: stale unstamped lock, no PTI filed today', function () {
  /* pti_dot.active exactly as every build up to web 406 writes
     it from the Begin tap: {active:true}, no freshness stamp. */
  const w = makeShell({ active: true });
  w.App.openModule('dispatch');
  eq('tapping Dispatch opens DISPATCH', w.App._modKey, 'dispatch');
  ok('the Dispatch view rendered (PTI never painted)', w.renders.join(',') === 'dispatch', w.renders.join(','));
  eq('the stale lock is cleared on sight (it cannot re-arm)', w.store._data.pti_dot.active, false);
  w.renders.length = 0;
  w.App.showDashboard();
  ok('the dashboard itself opens (no route back to PTI)',
    w.renders.indexOf('dashboard') !== -1 && w.renders.indexOf('pti') === -1, w.renders.join(','));
  w.renders.length = 0;
  w.App.openModule('pti');
  eq('PTI still opens by its OWN tap', w.App._modKey, 'pti');
  ok('the PTI view rendered', w.renders.join(',') === 'pti');
});

section('A2 — a lock stamped days ago (a synced leftover) does not engage', function () {
  const w = makeShell({ active: true, since: NOW - 5 * DAYMS });
  w.App.openModule('dispatch');
  eq('tapping Dispatch opens DISPATCH', w.App._modKey, 'dispatch');
  eq('the stale lock is cleared on sight', w.store._data.pti_dot.active, false);
});

section('A3 — a deliberate, fresh Begin still locks (the roadside design stands)', function () {
  const w = makeShell({ active: true, since: NOW - 5 * 60000 });
  w.App.openModule('dispatch');
  eq('a fresh Inspection Mode still routes other taps to PTI', w.App._modKey, 'pti');
  ok('the officer view is what paints', w.renders.join(',') === 'pti', w.renders.join(','));
  eq('a fresh lock is NOT cleared', w.store._data.pti_dot.active, true);
  w.renders.length = 0;
  w.App.showDashboard();
  ok('the dashboard stays behind a fresh lock', w.renders.indexOf('pti') !== -1 && w.renders.indexOf('dashboard') === -1, w.renders.join(','));
});

section('A4 — no lock state at all: every tap lands where it points', function () {
  const w = makeShell(undefined);
  w.App.openModule('dispatch');
  eq('Dispatch opens', w.App._modKey, 'dispatch');
  w.App.openModule('pti');
  eq('PTI opens', w.App._modKey, 'pti');
});

section('A5 — the nudge stays a nudge (source pins)', function () {
  ok('the dashboard flag still paints the warning as a door of its own',
    appSrc.indexOf('⚠ No PTI filed today — tap to file') !== -1 &&
    /f\.onclick = function \(\) \{ App\.openModule\('pti'\); \};/.test(appSrc));
  ok('the once-a-day nudge sheet still exists',
    appSrc.indexOf('App.maybePtiNudge = function') !== -1 && appSrc.indexOf('ptiNudgeSheet') !== -1);
  const nudgeBody = extractFn(appSrc, 'App.maybePtiNudge = function');
  ok('the nudge sheet itself performs NO navigation', nudgeBody.indexOf('openModule') === -1);
  ok('openModule holds exactly ONE rewrite to pti (the DOT lock line)',
    (appSrc.match(/key = 'pti'/g) || []).length === 1 &&
    appSrc.indexOf("if (key !== 'pti' && dotLockActive()) key = 'pti';") !== -1);
  ok('the shell lock predicate is freshness-bound',
    /DOT_LOCK_MAX_MS/.test(appSrc) && /since/.test(extractFn(appSrc, 'function dotLockActive')));
});

/* ================= Part B: the PTI module side ================= */
function makeBody() {
  const registry = new Map();
  function el() {
    return {
      onclick: null, value: '', textContent: '', innerHTML: '', style: {},
      disabled: false,
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {}, removeEventListener() {},
      getContext: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 660, height: 220 }),
      setAttribute() {}, getAttribute: () => null,
      querySelector: () => null, querySelectorAll: () => []
    };
  }
  return {
    _html: '',
    set innerHTML(h) { this._html = String(h); registry.clear(); },
    get innerHTML() { return this._html; },
    querySelector(sel) {
      if (sel.charAt(0) !== '#') return null;
      if (this._html.indexOf('id="' + sel.slice(1) + '"') < 0) return null;
      if (!registry.has(sel)) registry.set(sel, el());
      return registry.get(sel);
    },
    querySelectorAll() { return []; }
  };
}
function makePtiWorld(dotSeed) {
  const data = {
    onboarding: { firstName: 'Asjad', lastName: 'Kamal', contractingCo: 'AI Trucking', companyName: 'Asjad Kamal', truckNo: '07' },
    pti_reports: []
  };
  if (dotSeed !== undefined) data.pti_dot = JSON.parse(JSON.stringify(dotSeed));
  const store = {
    _data: data,
    get(k, d) { return (k in data) ? data[k] : d; },
    set(k, v) { data[k] = v; }
  };
  const sb = {
    console: console, Date: FakeDate, Meticulous: { modules: {} }, window: null,
    App: {
      _store: store,
      _esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      _today: () => '2026-11-10',
      userRole: () => 'driver'
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(ptiSrc, sb);
  return { sb: sb, store: store, PTI: sb.Meticulous.modules.pti };
}

section('B1 — the module side of the field morning', function () {
  const w = makePtiWorld({ active: true }); // unstamped — the pre-fix Begin shape
  const body = makeBody();
  w.PTI.render(body);
  eq('an unstamped activation does not read as active', w.PTI._dotActive(), false);
  ok('PTI paints its FORM, not the officer view',
    body.innerHTML.indexOf('id="pti_dot_enter"') !== -1 && body.innerHTML.indexOf('🛂 Vehicle Inspection Reports') === -1);
});

section('B2 — Begin stamps its activation; Exit still one tap', function () {
  const w = makePtiWorld(undefined);
  const body = makeBody();
  w.PTI.render(body);
  const begin = body.querySelector('#pti_dot_enter');
  ok('Begin is wired', !!(begin && begin.onclick));
  begin.onclick();
  eq('Begin activates Inspection Mode', w.PTI._dotActive(), true);
  ok('Begin stamps the activation time', typeof w.store._data.pti_dot.since === 'number' &&
    Math.abs(w.store._data.pti_dot.since - NOW) < 1000, JSON.stringify(w.store._data.pti_dot));
  ok('the officer view paints after Begin', body.innerHTML.indexOf('🛂 Vehicle Inspection Reports') !== -1);
  const exit = body.querySelector('#pti_dot_exit');
  ok('Exit is wired', !!(exit && exit.onclick));
  exit.onclick();
  eq('Exit leaves Inspection Mode', w.PTI._dotActive(), false);
});

section('B3 — stale vs fresh on the module side', function () {
  const stale = makePtiWorld({ active: true, since: NOW - 5 * DAYMS });
  const bStale = makeBody();
  stale.PTI.render(bStale);
  eq('a 5-day-old activation does not read as active', stale.PTI._dotActive(), false);
  ok('the form paints over a stale activation', bStale.innerHTML.indexOf('id="pti_dot_enter"') !== -1);
  const fresh = makePtiWorld({ active: true, since: NOW - 1 * HOUR });
  const bFresh = makeBody();
  fresh.PTI.render(bFresh);
  eq('a 1-hour-old activation still reads as active (restart mid-stop cannot slip out)', fresh.PTI._dotActive(), true);
  ok('the officer view paints for the fresh activation', bFresh.innerHTML.indexOf('🛂 Vehicle Inspection Reports') !== -1);
});

console.log('\ndispatch-tap-pti-gate-nov10: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
