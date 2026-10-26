#!/usr/bin/env node
/* auth-gate-v269-test.js — v269 (AUTH-LOGOUT-ON-UPDATE): a signed-in
   user must survive OTA update restarts and cold starts WITHOUT
   re-signing, and the app must never show the Sign Up / Sign In
   landing while a session restore is still in flight.

   Owner (Mon Oct 26, 2026 13:22 MDT, screen recording): cold start
   -> splash "Checking for updates... -> Downloading update... ->
   Update ready - restarting..." -> the app lands on the sign-up /
   sign-in landing, fully signed out. "Everytime... The application
   cold starts why does it log me out! Users don't want to login
   again and again." The same morning's five OTA relaunches (v260-
   v264) each forced a sign-in (see the v265 investigation).

   PROVEN MECHANISM (code-level; the phone is the final verdict):
   the session is IGNORED at boot, not destroyed.
     - js/ota.js gates App.init on OTA.ready(). In the bundled copy
       that waits on a hosted version.json fetch (6 s timeout); in
       the downloaded OTA copy it waits on a serial Filesystem
       re-verification (readFile + SHA-256) of every bundle file.
       Either way it is the slowest thing at boot.
     - js/firebase.js is NOT gated on OTA: it inits on
       DOMContentLoaded and its first onAuthStateChanged callback
       restores the persisted user — the SDK's default LOCAL
       persistence at origin https://localhost. OTA.restart() only
       navigates (Capacitor.convertFileSrc) to the /_capacitor_file_/
       PATH on that same origin; DOM/IndexedDB storage is
       origin-scoped, so the session store is shared by the bundled
       and downloaded copies (and the app's own localStorage data
       demonstrably survives the same swaps — v265 saga). The
       restore therefore lands BEFORE init runs, on every native
       boot, update or not.
     - init's onboarded branch then called App.onAuth(null)
       UNCONDITIONALLY, slamming the v216 lock over the restored
       session — and that branch has NO re-check (the
       watchAuthState/routeReturningUser poll exists only in the
       not-onboarded branch). The landing stuck until a manual form
       sign-in produced a fresh App.onAuth(user) via afterAuth().
   Secondary mode, same fix: firebase.js's SDK-missing / init-
   failure paths call App.onAuth(null) once and never retry — a
   transient gstatic failure pins the page in local mode (session
   intact underneath, display signed out). The verdict channel
   marks those authUnavailable so "known signed-out" (permanent
   for the page) is distinguishable from "restore in flight".

   THE FIX (web only — no native change; the session never left
   the shared origin store):
     - js/firebase.js: FB.authStateKnown / FB.authUnavailable +
       FB.whenAuthKnown() — the first onAuthStateChanged verdict,
       delivered exactly once, user-or-null. SDK-missing / init-
       failure mark known-null + authUnavailable.
     - js/app.js: App.bootAuthMode(fb) -> 'user' | 'null' | 'wait'
       | 'legacy'; init routes on the verdict. While 'wait', the
       splash HOLDS (no view is routed) and the verdict — or a 15 s
       wedged-restore fallback — routes. 'legacy' (no auth-state
       machinery: pre-v269 firebase.js, every existing harness
       stub) is the pre-v269 behaviour BYTE-FOR-BYTE, synchronous.
     - Explicit sign-out is untouched: FB.signOut() clears the
       persisted user; the listener's App.onAuth(null) still locks.

   WORLDS (the v216 world builder — real js/app.js + js/cloudsync.js
   + the real module set — with the boot parked on a stubbed
   OTA.ready() so the verdict-vs-init order is controllable; the FB
   stub's __deliver mirrors the shipped firebase.js listener
   exactly: FB.user, flip known, flush waiters, App.onAuth):
     W1 verdict-before-init (THE INCIDENT: restore lands during
        the OTA gate; onboarded user) -> main, signed in, the
        landing NEVER routed after boot.
     W2 verdict-after-init ('wait' path) -> splash holds, then
        main; the landing is never routed at any sample.
     W3 genuine signed-out verdict -> landing, locked shell.
     W4 wedged restore (verdict never arrives) -> the fallback
        routes to the landing (timeout shrunk by the harness);
        nothing is routed before it.
     W5 not-onboarded returning user -> afterAuth routes to
        onboarding; the landing is never flashed.
     W6 explicit sign-out AFTER a signed-in boot still locks.
   F-WORLDS: the real js/firebase.js against a stubbed firebase
   global — the verdict-channel contract (restore user / restore
   null / SDK missing / waiter-before-verdict).
   PINS: bootAuthMode matrix; source pins for the gate wiring,
   the firebase.js listener order, persistence untouched, and
   OTA.restart() being a same-origin navigation.

   Run on the PRE-fix tree, W1/W2/W4/W5 and the bootAuthMode pins
   must FAIL (red); on the fixed tree everything passes (green).
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ok -', m); } else { fail++; console.log('  FAIL -', m); } }
function eq(a, b, m) { ok(a === b, m + ' [got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ']'); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= fake DOM (v216 idiom, verbatim shape) ================= */
function makeDom() {
  const byId = new Map();
  const created = [];
  class FakeEl {
    constructor(tag) {
      this.tagName = String(tag || 'div').toUpperCase();
      this.children = []; this.parentNode = null;
      this.style = {}; this.dataset = {};
      this._text = ''; this._html = ''; this.value = ''; this.checked = false;
      this.disabled = false; this.files = null;
      this._cls = new Set(); this.onclick = null; this._qs = {};
    }
    get classList() {
      const s = this._cls;
      return {
        add(...c) { c.forEach((x) => s.add(x)); },
        remove(...c) { c.forEach((x) => s.delete(x)); },
        toggle(c, force) { const on = force === undefined ? !s.has(c) : !!force; on ? s.add(c) : s.delete(c); return on; },
        contains(c) { return s.has(c); }
      };
    }
    set innerHTML(v) { this._html = String(v == null ? '' : v); if (!v) this.children = []; }
    get innerHTML() { return this._html; }
    set textContent(v) { this._text = String(v == null ? '' : v); }
    get textContent() { return this._text; }
    appendChild(c) { if (c) this.children.push(c); return c; }
    insertBefore(c) { if (c) this.children.push(c); return c; }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
    remove() {}
    click() { if (typeof this.onclick === 'function') this.onclick({ preventDefault() {}, stopPropagation() {} }); }
    setAttribute() {} getAttribute() { return null; }
    addEventListener() {} removeEventListener() {}
    scrollIntoView() {} focus() {} blur() {}
    getContext() { return null; }
    querySelector(sel) {
      if (!this._qs[sel]) { const e = new FakeEl('div'); created.push(e); this._qs[sel] = e; }
      return this._qs[sel];
    }
    querySelectorAll() { return []; }
  }
  const document = {
    readyState: 'complete', visibilityState: 'visible', hidden: false,
    body: new FakeEl('body'),
    getElementById(id) {
      if (!byId.has(id)) { const e = new FakeEl('div'); e.id = id; byId.set(id, e); }
      return byId.get(id);
    },
    createElement(tag) { const e = new FakeEl(tag); created.push(e); return e; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; }
  };
  return { document, byId, created };
}
function makeLS(seed) {
  const m = new Map();
  Object.keys(seed || {}).forEach((k) => m.set(k, String(seed[k])));
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(String(k), String(v)); },
    removeItem(k) { m.delete(k); },
    clear() { m.clear(); },
    key(i) { return Array.from(m.keys())[i] || null; },
    get length() { return m.size; },
    _map: m
  };
}
function mtSeed(obj) {
  const o = {};
  Object.keys(obj).forEach((k) => { o['mt_' + k] = JSON.stringify(obj[k]); });
  return o;
}

/* FB stub: the v216 makeFB cloud shape + the v269 verdict channel.
   __deliver mirrors the shipped js/firebase.js listener exactly:
   FB.user = user; flip known once + flush waiters; App.onAuth. */
function makeFB(sb, cloud) {
  cloud = cloud || {};
  const waiters = [];
  const FB = {
    ready: true, user: null,
    authStateKnown: false, authUnavailable: false,
    whenAuthKnown() {
      if (FB.authStateKnown) return Promise.resolve(FB.user || null);
      return new Promise((res) => waiters.push(res));
    },
    __deliver(user) {
      FB.user = user || null;
      if (!FB.authStateKnown) {
        FB.authStateKnown = true;
        const w = waiters.splice(0);
        w.forEach((r) => { try { r(user || null); } catch (e) {} });
      }
      if (sb.window.App && sb.window.App.onAuth) sb.window.App.onAuth(user || null);
    },
    loadDocs() {
      const uid = FB.user && FB.user.uid;
      const kv = (uid && cloud[uid]) || {};
      return Promise.resolve(Object.keys(kv).map((k) => ({
        id: k, v: JSON.parse(JSON.stringify(kv[k].v)), updatedAt: kv[k].ts
      })));
    },
    saveDoc(col, id, data) {
      if (!FB.user) return Promise.resolve(null);
      const kv = cloud[FB.user.uid] || (cloud[FB.user.uid] = {});
      kv[id] = { v: JSON.parse(JSON.stringify(data.v)), ts: Date.now() };
      return Promise.resolve({});
    },
    deleteDoc(col, id) {
      if (FB.user && cloud[FB.user.uid]) delete cloud[FB.user.uid][id];
      return Promise.resolve({});
    }
  };
  return FB;
}

const MODULES = ['dispatch', 'revenue', 'fuel', 'pnl', 'maintenance', 'pti',
  'damage', 'manifest', 'invoice', 'connect', 'preferences', 'account'];

const UID = 'uidA-harness';
const EMAIL = 'driver.a@example.com';
const PROFILE_A = {
  firstName: 'Asjad', lastName: 'Kamal', accountType: 'Driver', userRole: 'driver',
  employment: 'Contract', payStandard: 'Hourly', payRate: 29, travelMins: 60,
  business: 'Asjad Kamal', country: 'Canada', province: 'AB', nameAsked: true
};
function seedFor(onboarded) {
  return mtSeed({
    onboarding: PROFILE_A,
    onboarded: !!onboarded,
    tracker: { status: 'idle', elapsed: 0, pausedSec: 0, accum: { weightKg: 0, loadCount: 0, tripCount: 0, manualLoads: 0 } },
    con_list: [{ name: 'Umar' }, { name: 'Maria' }],
    __syncmeta: { uid: UID, globallySynced: true, keys: {} }
  });
}

/* Boot the real app with a controllable OTA gate + verdict clock.
   Samples {t, view, ready, user, splashHide} every 5 ms. */
function bootWorld(opts) {
  const dom = makeDom();
  const LS = makeLS(opts.seed || seedFor(true));
  const sb = {
    console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    Promise, Date, JSON, Math, URLSearchParams, Intl,
    document: dom.document, localStorage: LS,
    navigator: { onLine: true, userAgent: 'node-harness' },
    location: { reload() {}, search: '', hash: '', href: 'http://harness/' },
    alert() {}, confirm() { return true; }, prompt() { return null; },
    scrollTo() {}, addEventListener() {}, removeEventListener() {},
    Meticulous: { modules: {}, shared: {} }
  };
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  const FB = makeFB(sb, {});
  sb.FB = FB;
  sb.window.OTA = {
    ready: () => new Promise((r) => setTimeout(r, opts.otaMs)),
    currentVersion: () => 269, checkNow: () => Promise.resolve(false),
    onState: () => {}, state: 'idle'
  };
  vm.createContext(sb);
  vm.runInContext(read('js/cloudsync.js'), sb, { filename: 'cloudsync.js' });
  MODULES.forEach((m) => vm.runInContext(read('modules/' + m + '.js'), sb, { filename: m + '.js' }));
  // app.js eval: the boot gate parks init on OTA.ready() — exactly
  // the deferral the native OTA copy produces.
  vm.runInContext(read('js/app.js'), sb, { filename: 'app.js' });
  if (typeof opts.shrinkGateMs === 'number') sb.window.App._bootAuthTimeoutMs = opts.shrinkGateMs;
  const t0 = Date.now();
  const samples = [];
  const timer = setInterval(() => {
    const A = sb.window.App;
    samples.push({
      t: Date.now() - t0,
      view: A ? A.currentView : undefined,
      ready: !!sb.window.__appReady,
      user: !!(A && A.user),
      splashHide: dom.document.getElementById('splash').classList.contains('hide')
    });
  }, 5);
  if (typeof opts.verdictMs === 'number') {
    setTimeout(() => FB.__deliver(opts.verdictUser || null), opts.verdictMs);
  }
  return { sb, dom, LS, FB, App: sb.window.App, samples, stop: () => clearInterval(timer) };
}
const landedAfterReady = (w) => w.samples.some((s) => s.ready && s.view === 'auth');
const lastSample = (w) => w.samples[w.samples.length - 1] || {};

/* ============================ worlds ============================ */
async function main() {
  /* ---------- W1: verdict-before-init — THE INCIDENT ---------- */
  console.log('— W1: restore lands during the OTA gate (onboarded) —');
  {
    const w = bootWorld({ otaMs: 180, verdictMs: 50, verdictUser: { uid: UID, email: EMAIL } });
    await sleep(700); w.stop();
    const A = w.App;
    ok(w.samples.some((s) => !s.ready && s.user),
      'W1 precondition: the restored user was delivered BEFORE init ran (restore beats the OTA gate)');
    eq(A.currentView, 'main', 'W1: the boot lands on main, still signed in');
    ok(A.user && A.user.uid === UID, 'W1: App.user is the restored user after boot');
    ok(!landedAfterReady(w), 'W1: the sign-in landing was NEVER routed after boot');
    ok(lastSample(w).splashHide, 'W1: the splash is hidden at the end');
  }

  /* ---------- W2: verdict-after-init — the 'wait' path ---------- */
  console.log('— W2: restore still in flight when init runs —');
  {
    const w = bootWorld({ otaMs: 15, verdictMs: 220, verdictUser: { uid: UID, email: EMAIL } });
    await sleep(800); w.stop();
    const A = w.App;
    eq(A.currentView, 'main', 'W2: routes to main when the verdict lands');
    ok(!w.samples.some((s) => s.view === 'auth'), 'W2: the landing was never routed at ANY sample');
    ok(w.samples.some((s) => s.ready && (s.view === undefined || s.view === null || s.view === '')),
      'W2: while the verdict was pending, NO view was routed (the splash held)');
  }

  /* ---------- W3: genuine signed-out verdict ---------- */
  console.log('— W3: Firebase verdict is truly signed out —');
  {
    const w = bootWorld({ otaMs: 180, verdictMs: 50, verdictUser: null });
    await sleep(700); w.stop();
    const A = w.App;
    eq(A.currentView, 'auth', 'W3: a true signed-out verdict lands on the sign-in view');
    ok(!A.user, 'W3: App.user stays null');
    eq(w.dom.document.getElementById('sbEmail').textContent, 'Signed out', 'W3: the shell is the locked shell');
    ok(lastSample(w).splashHide, 'W3: the splash is hidden at the end');
  }

  /* ---------- W4: wedged restore — the fallback ---------- */
  console.log('— W4: the first verdict never arrives —');
  {
    const w = bootWorld({ otaMs: 15, verdictMs: null, shrinkGateMs: 250 });
    await sleep(900); w.stop();
    const A = w.App;
    eq(A.currentView, 'auth', 'W4: the wedged-restore fallback eventually routes to the landing');
    ok(!w.samples.some((s) => s.t < 200 && s.view === 'auth'),
      'W4: nothing was routed before the fallback fired (no premature landing)');
    ok(lastSample(w).splashHide, 'W4: the splash is not left up forever');
  }

  /* ---------- W5: not-onboarded returning user ---------- */
  console.log('— W5: signed-in but not onboarded —');
  {
    const w = bootWorld({
      otaMs: 180, verdictMs: 50, verdictUser: { uid: UID, email: EMAIL },
      seed: seedFor(false)
    });
    await sleep(2500); w.stop();
    const A = w.App;
    eq(A.currentView, 'onboarding', 'W5: afterAuth routes the returning user to onboarding');
    ok(!landedAfterReady(w), 'W5: the sign-in landing was never flashed after boot');
    ok(A.user && A.user.uid === UID, 'W5: App.user is the restored user');
  }

  /* ---------- W6: explicit sign-out still signs out ---------- */
  console.log('— W6: explicit sign-out after a signed-in boot —');
  {
    const w = bootWorld({ otaMs: 180, verdictMs: 50, verdictUser: { uid: UID, email: EMAIL } });
    await sleep(600);
    eq(w.App.currentView, 'main', 'W6 precondition: booted signed-in on main');
    w.FB.__deliver(null); // the listener contract on sign-out
    await sleep(150); w.stop();
    const A = w.App;
    ok(!A.user, 'W6: sign-out clears App.user');
    eq(A.currentView, 'auth', 'W6: sign-out routes to the sign-in view');
    eq(w.dom.document.getElementById('sbEmail').textContent, 'Signed out', 'W6: sign-out locks the shell');
  }

  /* ---------- bootAuthMode matrix ---------- */
  console.log('— bootAuthMode: the pure boot decision —');
  {
    const w = bootWorld({ otaMs: 15, verdictMs: 30, verdictUser: null });
    await sleep(300); w.stop();
    const mode = w.App.bootAuthMode;
    eq(typeof mode, 'function', 'App.bootAuthMode exists');
    if (typeof mode === 'function') {
      eq(mode(undefined), 'legacy', 'mode: no FB at all -> legacy');
      eq(mode(null), 'legacy', 'mode: null FB -> legacy');
      eq(mode({}), 'legacy', 'mode: FB with no auth-state machinery -> legacy (every pre-v269 stub)');
      eq(mode({ ready: true, user: null }), 'legacy', 'mode: the v216-style stub FB -> legacy');
      eq(mode({ authStateKnown: false }), 'wait', 'mode: machinery present, verdict pending -> wait');
      eq(mode({ whenAuthKnown: function () {} }), 'wait', 'mode: whenAuthKnown present, verdict pending -> wait');
      eq(mode({ authStateKnown: false, user: { uid: 'x' } }), 'wait', 'mode: pending verdict wins over a stale user field');
      eq(mode({ authStateKnown: true, user: { uid: 'x' } }), 'user', 'mode: known + user -> user');
      eq(mode({ authStateKnown: true, user: null }), 'null', 'mode: known + no user -> null');
    }
  }

  /* ---------- F-worlds: the real js/firebase.js contract ---------- */
  console.log('— F: real js/firebase.js verdict channel —');
  function bootFirebase(firebaseStub) {
    const calls = [];
    const documentStub = {
      readyState: 'complete',
      addEventListener() {}, removeEventListener() {},
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => []
    };
    const sb = {
      console, setTimeout, clearTimeout, Promise, JSON, Math, Date,
      document: documentStub,
      navigator: { userAgent: 'node' },
      location: { href: 'https://localhost/', protocol: 'https:' },
      addEventListener() {}, removeEventListener() {},
      App: { onAuth: (u) => calls.push(u || null) }
    };
    sb.window = sb; sb.globalThis = sb;
    if (firebaseStub !== undefined) sb.firebase = firebaseStub;
    vm.createContext(sb);
    vm.runInContext(read('js/firebase.js'), sb, { filename: 'firebase.js' });
    return { sb, calls };
  }
  function firebaseSdkStub(restoreUser, delayMs) {
    const authObj = {
      currentUser: restoreUser,
      onAuthStateChanged(cb) { setTimeout(() => cb(restoreUser), delayMs); return function () {}; }
    };
    return {
      apps: [{}],
      initializeApp() {},
      auth: () => authObj,
      firestore: () => ({}),
      messaging: () => { throw new Error('messaging unsupported in harness'); }
    };
  }
  {
    const user = { uid: UID, email: EMAIL };
    const f = bootFirebase(firebaseSdkStub(user, 30));
    await sleep(150);
    eq(f.sb.FB.authStateKnown, true, 'F1: the verdict is known after the restore callback');
    ok(f.sb.FB.user === user, 'F1: FB.user is the restored user');
    eq(f.calls.length, 1, 'F1: App.onAuth delivered exactly once');
    ok(f.calls[0] === user, 'F1: App.onAuth received the restored user');
    const v = await f.sb.FB.whenAuthKnown();
    ok(v === user, 'F1: whenAuthKnown() resolves with the restored user');
  }
  {
    const f = bootFirebase(firebaseSdkStub(null, 30));
    await sleep(150);
    eq(f.sb.FB.authStateKnown, true, 'F2: a null restore still flips the verdict known');
    eq(f.sb.FB.user, null, 'F2: FB.user is null');
    const v = await f.sb.FB.whenAuthKnown();
    eq(v, null, 'F2: whenAuthKnown() resolves null for a real sign-out');
    eq(f.calls.length, 1, 'F2: App.onAuth delivered the null verdict');
  }
  {
    const f = bootFirebase(undefined); // no firebase global at all
    await sleep(50);
    eq(f.sb.FB.authUnavailable, true, 'F3: SDK missing marks authUnavailable');
    eq(f.sb.FB.authStateKnown, true, 'F3: SDK missing still settles the verdict (known-null)');
    const v = await f.sb.FB.whenAuthKnown();
    eq(v, null, 'F3: whenAuthKnown() resolves null when the SDK is missing');
    eq(f.calls.length, 1, 'F3: App.onAuth(null) delivered once (pre-v269 behaviour kept)');
  }
  {
    const user = { uid: UID, email: EMAIL };
    const f = bootFirebase(firebaseSdkStub(user, 60));
    const v = await f.sb.FB.whenAuthKnown(); // waiter registered BEFORE the verdict
    ok(v === user, 'F4: a waiter registered before the verdict resolves with the user');
  }

  /* ---------- source pins ---------- */
  console.log('— source pins —');
  {
    const app = read('js/app.js');
    ok(app.indexOf('AUTH-GATE-BEGIN') >= 0 && app.indexOf('AUTH-GATE-END') >= 0,
      'pin: app.js carries the AUTH-GATE harness block');
    const iReady = app.lastIndexOf('window.__appReady');
    const region = app.slice(app.lastIndexOf('renderOnbStep();', iReady), iReady);
    ok(region.indexOf('bootAuthMode') >= 0 &&
       region.indexOf('bootAuthMode') < region.indexOf('App.onAuth(null);'),
      'pin: init consults bootAuthMode BEFORE any boot-time App.onAuth(null) statement');
    const fb = read('js/firebase.js');
    ok(fb.indexOf('setPersistence') < 0,
      'pin: firebase.js never overrides persistence (the SDK default local persistence is the carrier)');
    const iUser = fb.indexOf('FB.user = user;');
    const iNote = fb.indexOf('noteAuthKnown(user);');
    const iOnAuth = fb.indexOf('App.onAuth(user);');
    ok(iUser >= 0 && iNote > iUser && iOnAuth > iNote,
      'pin: the listener sets FB.user, settles the verdict, THEN delivers App.onAuth');
    const ota = read('js/ota.js');
    ok(ota.indexOf('convertFileSrc') >= 0 &&
       ota.indexOf('localStorage.clear') < 0 && ota.indexOf('deleteDatabase') < 0,
      'pin: OTA.restart() is a same-origin navigation — it clears no storage');
    const cfgPath = path.join(ROOT, '..', 'meticulous-native', 'capacitor.config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = fs.readFileSync(cfgPath, 'utf8');
      ok(/"androidScheme"\s*:\s*"https"/.test(cfg) && !/"url"\s*:/.test(cfg),
        'pin: the native shell serves one stable https://localhost origin (no server.url override)');
    } else {
      console.log('  skip - native capacitor.config.json not present beside the web repo');
    }
  }

  console.log('\nauth-gate-v269: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.log('HARNESS ERROR: ' + (e && e.stack || e)); process.exit(2); });
