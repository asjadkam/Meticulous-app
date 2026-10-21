#!/usr/bin/env node
/* signin-lock-v216-test.js — DATA-BEHIND-SIGNIN + PROFILE-RESTORE-
 * INTEGRITY (owner, Oct 21, 2026 15:26 + 15:28 MDT).
 *
 * What he saw: he uninstalled and reinstalled the app mid-shift.
 * The app restored his whole day from the device/cloud record —
 * timer, loads, revenue, invoices (he praised that) — BUT it stood
 * in LOCAL MODE, signed OUT, rendering everything in the clear:
 * Revenue $1,448, Invoice $1,232.50, the last fuel fill, the active
 * dispatch, PTI status, Connect "4 connections", and the drawer
 * header naming his account type. His words: "I am not even signed
 * in and all my information is out there... That's way too data
 * breach... Leave it outside the door?" And on the second account:
 * "I am 100% certain I left this account as Dave cooper and owner
 * operator account" — yet its Preferences showed his REAL profile
 * (Asjad Kamal, Driver): identity data bled across accounts on one
 * device, because the 'onboarding' profile record lived in ONE
 * device-wide slot and the sync merge let a foreign profile's
 * fields survive under whichever account signed in next.
 *
 * The fix under test (js/app.js + js/cloudsync.js + the js/miles.js
 * and js/parkplace.js paint guards):
 *   1. Signed out, NOTHING of the user's data renders: the sign-in
 *      screen is the only screen. The dashboard grid, the drawer
 *      menu, the tracker hero, the module surface, the onboarding
 *      surface and the sidebar account block paint nothing of the
 *      stored day. Builders, painters and every navigation entry
 *      point (showView('main') / showDashboard / openModule — card,
 *      drawer, deep link, restored tab state) are gated on
 *      App.user. Data stays stored; the moment he signs in,
 *      everything restores bit-for-bit (the survival he praised).
 *      Signing out mid-session clears the rendered surface
 *      immediately; the session underneath runs on untouched.
 *   2. The profile record is OWNED by the signed-in account:
 *      CloudSync.profileGate swaps the 'onboarding' slot at every
 *      auth change — outgoing record stashed under its owner
 *      (mt___profiles), incoming owner's record activated, or the
 *      slot vacated so the sign-in pull takes THAT account's cloud
 *      profile wholesale (cloud wins over any post-gate default
 *      stamps). Local (signed-out) mode owns a slot of its own.
 *
 * Driven proof — the REAL js/app.js boots in a vm over a FakeEl
 * DOM with the REAL modules loaded, on a seeded signed-out profile
 * carrying a full day of data (the world-1 seed mirrors his video:
 * running timer with 13 load taps, revenue/invoice/fuel/dispatch/
 * connect figures computed by the real modules from the seed):
 *   W1 signed out: the walked DOM contains NONE of the seeded
 *      figures/labels (revenue total, invoice total, loads line,
 *      fuel line, connection count, dispatch site, PTI flag, his
 *      name) and every bypass lands back on the sign-in screen;
 *      the stored day is untouched underneath.
 *   W1 sign in (same account): the same figures render.
 *   W1 sign out mid-session: the surface blanks SYNCHRONOUSLY and
 *      the session underneath is still running.
 *   W2: local storage seeded with Account A's profile; sign in as
 *      Account B (different cloud profile) — every rendered profile
 *      field is B's, none of A's strings appear anywhere; A's
 *      record survives intact in its own slot; signing back in as
 *      A restores A's profile (round trip).
 * Plus source pins for the two auxiliary paint guards (miles,
 * parkplace) whose engines the harness DOM does not drive.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; } else { fail++; console.log('  FAIL: ' + m); } }
function eq(a, b, m) { ok(a === b, m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

/* ---------------- FakeEl DOM (the account-login-test.js idiom,
 * extended: a persistent per-id registry + child tracking so the
 * whole rendered surface can be walked and searched) ------------ */
function makeDom() {
  const byId = new Map();
  const created = [];
  class FakeEl {
    constructor(tag) {
      this.tagName = String(tag || 'div').toUpperCase();
      this._html = ''; this._text = ''; this.value = ''; this.checked = false;
      this.disabled = false; this.files = []; this.style = {}; this.dataset = {};
      this.children = []; this._qs = {};
      const self = this;
      this.classList = {
        _s: new Set(),
        add(...cs) { cs.forEach((c) => this._s.add(c)); },
        remove(...cs) { cs.forEach((c) => this._s.delete(c)); },
        contains(c) { return this._s.has(c); },
        toggle(c, force) {
          const on = force === undefined ? !this._s.has(c) : !!force;
          if (on) this._s.add(c); else this._s.delete(c); return on;
        }
      };
      this._self = self;
    }
    get innerHTML() { return this._html; }
    set innerHTML(v) { this._html = String(v == null ? '' : v); if (!v) this.children = []; }
    get textContent() { return this._text; }
    set textContent(v) { this._text = String(v == null ? '' : v); }
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
  function harvest() {
    let out = [];
    const seen = new Set();
    function walk(e) {
      if (!e || seen.has(e)) return; seen.add(e);
      if (e._html) out.push(e._html);
      if (e._text) out.push(e._text);
      (e.children || []).forEach(walk);
      Object.keys(e._qs || {}).forEach((k) => walk(e._qs[k]));
    }
    byId.forEach(walk); created.forEach(walk); walk(document.body);
    return out.join('\n');
  }
  return { document, byId, harvest };
}

/* ---------------- localStorage stub ---------------- */
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

/* ---------------- FB stub (the cloud the suites already use) --- */
function makeFB(cloud) {
  const FB = {
    ready: true, user: null,
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

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------------- world builder ----------------
 * Boots the REAL app: js/cloudsync.js + the real modules + js/app.js
 * (whose tail attaches CloudSync to the real store and runs init).
 * onboarded:true seeds take the v21 boot path — the exact path of
 * his reinstall video: onAuth(null), then showView('main'). */
const MODULES = ['dispatch', 'revenue', 'fuel', 'pnl', 'maintenance', 'pti',
  'damage', 'manifest', 'invoice', 'connect', 'preferences', 'account'];
function bootWorld(seedLS, cloud) {
  const dom = makeDom();
  const LS = makeLS(seedLS);
  const FB = makeFB(cloud || {});
  const sb = {
    console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    Promise, Date, JSON, Math, URLSearchParams, Intl,
    document: dom.document, localStorage: LS,
    navigator: { onLine: true, userAgent: 'node-harness' },
    location: { reload() {}, search: '', hash: '', href: 'http://harness/' },
    alert() {}, confirm() { return true; }, prompt() { return null; },
    scrollTo() {}, addEventListener() {}, removeEventListener() {},
    FB, Meticulous: { modules: {}, shared: {} }
  };
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  vm.createContext(sb);
  vm.runInContext(read('js/cloudsync.js'), sb, { filename: 'cloudsync.js' });
  MODULES.forEach((m) => vm.runInContext(read('modules/' + m + '.js'), sb, { filename: m + '.js' }));
  vm.runInContext(read('js/app.js'), sb, { filename: 'app.js' });
  return { sb, dom, LS, FB, App: sb.window.App };
}

/* The expected dashboard figures are read from the REAL modules
 * inside the booted world itself (status() computes; it never
 * paints) — the faithful oracle: exactly the strings buildDashboard
 * will render from this seed once the door opens. */

async function settle(rounds) {
  for (let i = 0; i < (rounds || 40); i++) {
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 5));
  }
}
function dstr(daysAgo) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

const UID_A = 'uidA-harness', UID_B = 'uidB-harness';
const PROFILE_A = {
  firstName: 'Asjad', lastName: 'Kamal', accountType: 'Driver', userRole: 'driver',
  employment: 'Contract', payStandard: 'Hourly', payRate: 29, travelMins: 60,
  business: 'Asjad Kamal', country: 'Canada', province: 'AB', nameAsked: true
};
const PROFILE_B = {
  firstName: 'Dave', lastName: 'Cooper', accountType: 'Owner-Operator', userRole: 'office',
  employment: 'Contract', payStandard: 'Hourly', payRate: 52, travelMins: 0,
  business: 'Cooper Hauling', country: 'Canada', province: 'AB', nameAsked: true
};

async function main() {
  /* ================= WORLD 1: the locked door ================= */
  console.log('— W1: seeded signed-out day (his reinstall video) —');
  const now = Date.now();
  const seed1 = mtSeed({
    onboarding: PROFILE_A,
    onboarded: true,
    tracker: {
      status: 'running', startTs: now - (7 * 3600 + 10 * 60) * 1000,
      elapsed: 0, pausedSec: 0,
      accum: { weightKg: 0, loadCount: 0, tripCount: 0, manualLoads: 13 }
    },
    dsp_active: { id: 'd1', jobSite: 'Aecon Inf', status: 'active', scheduledAt: dstr(0) + 'T08:00:00' },
    dsp_list: [{ id: 'd1', jobSite: 'Aecon Inf', status: 'active', scheduledAt: dstr(0) + 'T08:00:00' }],
    rev_entries: [
      { type: 'hourly', date: dstr(5), hours: 20, notes: 'seed' },
      { type: 'hourly', date: dstr(2), hours: 22.5, notes: 'seed' }
    ],
    fuel_fills: [{ date: dstr(2), litres: 90.3, cost: 206.60, station: 'Petro-Canada' }],
    con_list: [{ name: 'Umar' }, { name: 'Saleem' }, { name: 'Boss' }, { name: 'Maria' }],
    __syncmeta: { uid: UID_A, globallySynced: true, keys: {} }
  });
  const w1 = bootWorld(seed1, {});
  const A = w1.App, D = w1.dom, el1 = (id) => D.byId.get(id);
  /* Fragments of the seeded day that must never appear while locked
   * (profile-independent: site, counts, amounts, his name). */
  const FRAGMENTS = ['Aecon Inf', '4 connections', '90.3', 'Loads today',
    'No PTI filed today', 'Asjad', 'Kamal', '1232.50', 'Working'];
  let FIGURES = FRAGMENTS;
  function assertLocked(tag) {
    eq(A.currentView, 'auth', tag + ': the sign-in screen is the current view');
    ok(el1('auth') && el1('auth').classList.contains('active'), tag + ': #auth is the active view');
    ok(!(el1('main') && el1('main').classList.contains('active')), tag + ': #main is NOT active');
    const domText = D.harvest();
    FIGURES.forEach((f) => ok(domText.indexOf(f) < 0, tag + ': DOM contains none of "' + f + '"'));
    eq(el1('modGrid').innerHTML, '', tag + ': the dashboard grid is empty');
    eq(el1('sbNav').innerHTML, '', tag + ': the drawer menu is empty');
    eq(el1('modBody').innerHTML, '', tag + ': the module surface is empty');
    ok(el1('trkClock').textContent === '00:00:00' && el1('trkClock').innerHTML === '00:00:00',
      tag + ': the tracker clock shows the neutral face (got text=' + JSON.stringify(el1('trkClock').textContent) + ' html=' + JSON.stringify(el1('trkClock').innerHTML) + ')');
    eq(el1('trkExtra').innerHTML, '', tag + ': the tracker extra line (loads) is empty');
    eq(el1('sbName').textContent, 'Meticulous', tag + ': the drawer names no account type');
    eq(el1('sbEmail').textContent, 'Signed out', tag + ': the drawer shows no email/profile');
    ok(A._authLocked(), tag + ': App._authLocked() reports the lock');
  }
  assertLocked('W1 cold start signed out');

  /* No entry point bypasses the door. */
  A.showView('main');
  eq(A.currentView, 'auth', 'W1 bypass: showView(main) lands on the sign-in screen');
  A.openModule('revenue');
  eq(A.currentView, 'auth', 'W1 bypass: openModule(revenue) lands on the sign-in screen');
  eq(el1('modBody').innerHTML, '', 'W1 bypass: no module body painted');
  A.openModule('preferences');
  eq(A.currentView, 'auth', 'W1 bypass: openModule(preferences) lands on the sign-in screen — no profile behind the door');
  A.showDashboard();
  eq(A.currentView, 'auth', 'W1 bypass: showDashboard() lands on the sign-in screen');

  /* The stored day is untouched underneath the lock. */
  const trkStored = JSON.parse(w1.LS.getItem('mt_tracker'));
  ok(trkStored.status === 'running' && trkStored.accum.manualLoads === 13,
    'W1 storage: the running session + its 13 loads survive untouched under the lock');
  eq(JSON.parse(w1.LS.getItem('mt_rev_entries')).length, 2, 'W1 storage: revenue entries untouched');
  const stash1 = JSON.parse(w1.LS.getItem('mt___profiles') || '{}');
  ok(stash1[UID_A] && stash1[UID_A].firstName === 'Asjad',
    'W1 storage: his profile is preserved under its own account slot while signed out');
  eq(w1.sb.CloudSync.profileOwner(), 'local', 'W1 storage: the active profile slot is the local one');

  /* Sign in as the same account — everything restores. */
  console.log('— W1: sign in — the day restores bit-for-bit —');
  w1.FB.user = { uid: UID_A, email: 'asjad@test' };
  A.onAuth(w1.FB.user);
  await settle();
  eq(A.currentView, 'main', 'W1 sign-in: the dashboard is the current view');
  /* The day's figures, computed by the real modules in this world
   * with his profile active — exactly what the cards must show. */
  const M1 = w1.sb.Meticulous.modules;
  const exp = {};
  ['dispatch', 'revenue', 'fuel', 'invoice', 'connect'].forEach((k) => {
    try { exp[k] = M1[k].status(); } catch (e) { exp[k] = '__ERR__ ' + e.message; }
  });
  console.log('  restored figures: ' + JSON.stringify(exp));
  ok(exp.connect === '4 connections', 'W1 seed check: connect figure is the video\'s (' + exp.connect + ')');
  ok(exp.invoice.indexOf('1232.50') >= 0, 'W1 seed check: invoice figure is the video\'s $1,232.50 (' + exp.invoice + ')');
  const grid = el1('modGrid').innerHTML;
  [exp.revenue, exp.invoice, exp.fuel, exp.connect, 'Aecon Inf'].forEach((f) =>
    ok(grid.indexOf(f) >= 0, 'W1 sign-in: dashboard renders "' + f + '"'));
  FIGURES = FRAGMENTS.concat([exp.revenue, exp.invoice, exp.fuel, exp.connect]);
  ok(el1('trkExtra').innerHTML.indexOf('Loads today: <b>13</b>') >= 0,
    'W1 sign-in: the tracker shows the 13 loads again (got: ' + el1('trkExtra').innerHTML.slice(0, 120) + ')');
  ok(/^\d{2}:\d{2}:\d{2}$/.test(el1('trkClock').innerHTML) && el1('trkClock').innerHTML !== '00:00:00',
    'W1 sign-in: the timer shows the running session (' + el1('trkClock').innerHTML + ')');
  ok(el1('trkPtiFlag').textContent.indexOf('No PTI filed today') >= 0, 'W1 sign-in: the PTI flag paints again');
  eq(el1('sbName').textContent, 'Driver', 'W1 sign-in: the drawer names his account type');
  eq(el1('sbEmail').textContent, 'asjad@test', 'W1 sign-in: the drawer shows his email');
  eq(w1.sb.CloudSync.profileOwner(), UID_A, 'W1 sign-in: the profile slot is his account again');

  /* Sign out mid-session — the surface clears at once. */
  console.log('— W1: sign out mid-session —');
  w1.FB.user = null;
  A.onAuth(null);
  assertLocked('W1 after sign-out (synchronous)');
  const trkAfter = JSON.parse(w1.LS.getItem('mt_tracker'));
  ok(trkAfter.status === 'running', 'W1 after sign-out: the session underneath is still running');

  /* ================= WORLD 2: profile integrity ================= */
  console.log('— W2: Account A local, sign in as Account B —');
  const seed2 = mtSeed({
    onboarding: PROFILE_A, onboarded: true,
    __syncmeta: { uid: UID_A, globallySynced: true, keys: {} }
  });
  const cloud2 = {};
  cloud2[UID_B] = { onboarding: { v: PROFILE_B, ts: 1760000000000 } };
  cloud2[UID_A] = { onboarding: { v: PROFILE_A, ts: 1760000000000 } };
  const w2 = bootWorld(seed2, cloud2);
  const B = w2.App, D2 = w2.dom, el2 = (id) => D2.byId.get(id);
  ok(D2.harvest().indexOf('Asjad') < 0, 'W2 cold start signed out: A\'s profile renders nowhere');
  ok(D2.harvest().indexOf('Dave') < 0, 'W2 cold start signed out: B\'s profile renders nowhere');

  w2.FB.user = { uid: UID_B, email: 'dave@test' };
  B.onAuth(w2.FB.user);
  await settle();
  const slotB = B._store.get('onboarding', {});
  eq(slotB.firstName, 'Dave', 'W2 sign-in B: the active profile record is B\'s (first name)');
  eq(slotB.lastName, 'Cooper', 'W2 sign-in B: the active profile record is B\'s (last name)');
  eq(slotB.accountType, 'Owner-Operator', 'W2 sign-in B: the active profile record is B\'s (account type)');
  eq(slotB.userRole, 'office', 'W2 sign-in B: the drives-answer is B\'s, not a stamped default');
  eq(el2('sbName').textContent, 'Owner-Operator', 'W2 sign-in B: the drawer names B\'s account type');
  eq(el2('sbEmail').textContent, 'dave@test', 'W2 sign-in B: the drawer shows B\'s email');
  const domB = D2.harvest();
  ok(domB.indexOf('Asjad') < 0 && domB.indexOf('Kamal') < 0,
    'W2 sign-in B: none of A\'s profile strings appear anywhere in the rendered DOM');
  ok(el2('modGrid').innerHTML.indexOf('P&amp;L') >= 0 || el2('modGrid').innerHTML.indexOf('P&L') >= 0,
    'W2 sign-in B: the owner dashboard renders (P&L card present for Owner-Operator)');
  /* Preferences — the exact screen from his screenshot. */
  B.openModule('preferences');
  const prefHtml = el2('modBody').innerHTML;
  ok(prefHtml.indexOf('Dave') >= 0 && prefHtml.indexOf('Cooper') >= 0,
    'W2 sign-in B: Preferences shows B\'s name');
  ok(prefHtml.indexOf('Asjad') < 0 && prefHtml.indexOf('Kamal') < 0,
    'W2 sign-in B: Preferences shows none of A\'s name — the Dave Cooper screenshot, fixed');
  const stash2 = JSON.parse(w2.LS.getItem('mt___profiles') || '{}');
  ok(stash2[UID_A] && stash2[UID_A].firstName === 'Asjad' && stash2[UID_A].accountType === 'Driver',
    'W2: A\'s profile survives intact in A\'s own slot while B is active');
  eq(w2.sb.CloudSync.profileOwner(), UID_B, 'W2: the active profile slot is B\'s');

  /* Sign out, then back in as A — the round trip. */
  w2.FB.user = null; B.onAuth(null);
  ok(D2.harvest().indexOf('Dave') < 0, 'W2 sign-out: B\'s profile leaves the rendered surface too');
  w2.FB.user = { uid: UID_A, email: 'asjad@test' };
  B.onAuth(w2.FB.user);
  await settle();
  eq(el2('sbName').textContent, 'Driver', 'W2 round trip: A signs back in and the drawer names A\'s account type');
  B.openModule('preferences');
  const prefA = el2('modBody').innerHTML;
  ok(prefA.indexOf('Asjad') >= 0 && prefA.indexOf('Kamal') >= 0, 'W2 round trip: Preferences shows A\'s profile again');
  ok(prefA.indexOf('Dave') < 0 && prefA.indexOf('Cooper') < 0, 'W2 round trip: none of B\'s strings remain');
  eq(w2.sb.CloudSync.profileOwner(), UID_A, 'W2 round trip: the active profile slot is A\'s again');

  /* ============ source pins: the auxiliary paint guards ======= */
  console.log('— source pins: auxiliary painters + gate wiring —');
  const miles = read('js/miles.js');
  ok(miles.indexOf('App._authLocked') >= 0 && miles.indexOf('trkMiles') >= 0,
    'pin: LiveMiles.paint blanks the miles/wake lines while locked');
  const park = read('js/parkplace.js');
  ok(park.indexOf('App._authLocked') >= 0, 'pin: the park card never paints while locked');
  const app = read('js/app.js');
  ok(app.indexOf("name === 'main' && !App.user") >= 0, 'pin: showView routes main -> auth while signed out');
  ok(app.indexOf('CloudSync.profileGate(user || null)') >= 0, 'pin: App.onAuth runs the profile gate before painting');
  const cs = read('js/cloudsync.js');
  ok(cs.indexOf('S.profileGate = function') >= 0 && cs.indexOf('_profVacatedFor') >= 0,
    'pin: CloudSync owns the per-account profile slot swap + the cloud-wins marker');

  console.log('\nsignin-lock: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.log('HARNESS ERROR: ' + (e && e.stack || e)); process.exit(2); });
