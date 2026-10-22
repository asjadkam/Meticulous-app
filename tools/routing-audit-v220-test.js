#!/usr/bin/env node
/* routing-audit-v220-test.js — PREFS-OPENS-CONNECT (owner, Oct 22,
 * 2026): tapping Preferences navigated to Connect.
 *
 * The audit: boot the REAL app (cloudsync + all modules + app.js,
 * the signin-lock-v216 harness idiom), sign in under each account
 * shape, then walk EVERY tappable routing surface the shell builds —
 * the dashboard cards (data-mod), the drawer items (data-act) — and
 * for every key, drive the one shared door (App.openModule, which
 * is exactly what both click handlers call) with a render spy on
 * every module. A surface passes only if the module that renders
 * is the module the surface names, the header title is that
 * module's own title, and no other module renders instead.
 *
 * The reported pair is pinned by name: 'preferences' must render
 * Preferences (title 'Preferences'), never Connect.
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

/* ---------------- FakeEl DOM (account-login / v216 idiom) ------ */
function makeDom() {
  const byId = new Map();
  const created = [];
  class FakeEl {
    constructor(tag) {
      this.tagName = String(tag || 'div').toUpperCase();
      this._html = ''; this._text = ''; this.value = ''; this.checked = false;
      this.disabled = false; this.files = []; this.style = {}; this.dataset = {};
      this.children = []; this._qs = {};
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
    getContext() {
      const grad = { addColorStop() {} };
      return {
        clearRect() {}, fillRect() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
        stroke() {}, fill() {}, arc() {}, fillText() {}, strokeText() {}, save() {}, restore() {},
        translate() {}, rotate() {}, scale() {}, setTransform() {}, drawImage() {},
        measureText() { return { width: 0 }; }, createLinearGradient() { return grad; }
      };
    }
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
const MODULES = ['dispatch', 'revenue', 'fuel', 'pnl', 'maintenance', 'pti',
  'damage', 'manifest', 'invoice', 'connect', 'preferences', 'account', 'navigator', 'navigation',
  'subscription', 'reminders', 'autostart'];
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
  MODULES.forEach((m) => {
    try { vm.runInContext(read('modules/' + m + '.js'), sb, { filename: m + '.js' }); } catch (e) { /* module absent in this build */ }
  });
  vm.runInContext(read('js/app.js'), sb, { filename: 'app.js' });
  return { sb, dom, LS, FB, App: sb.window.App };
}
async function settle(rounds) {
  for (let i = 0; i < (rounds || 40); i++) {
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 5));
  }
}

/* Sanctioned remaps inside App.openModule (js/app.js): the retired
 * 'navigation' door -> 'navigator'; a tier-locked module ->
 * 'subscription'. Anything else must render ITSELF. */
const REMAP = { navigation: 'navigator' };

async function auditWorld(label, profile, uid) {
  console.log('— ' + label + ' —');
  const seed = mtSeed({
    onboarding: profile,
    onboarded: true,
    tracker: { status: 'idle', startTs: 0, elapsed: 0 },
    __syncmeta: { uid: uid, globallySynced: true, keys: {} }
  });
  const w = bootWorld(seed, {});
  const A = w.App, D = w.dom, M = w.sb.Meticulous.modules;
  w.FB.user = { uid: uid, email: 'audit@test' };
  A.onAuth(w.FB.user);
  await settle();

  /* render spies on every registered module */
  const rendered = [];
  const orig = {};
  Object.keys(M).forEach((k) => {
    if (M[k] && typeof M[k].render === 'function') {
      orig[k] = M[k].render;
      M[k].render = function (body) { rendered.push(k); return orig[k].call(M[k], body); };
    }
  });

  /* surfaces: dashboard cards + drawer items, read from the real
   * painted HTML (the pairing of key+label is the thing under
   * audit — a swapped pairing in the builder fails here). */
  A.showDashboard();
  const gridHtml = D.byId.get('modGrid').innerHTML || '';
  const navHtml = D.byId.get('sbNav').innerHTML || '';
  const cardKeys = [];
  gridHtml.replace(/data-mod="([^"]+)"/g, (m0, k) => { cardKeys.push(k); return m0; });
  const drawerPairs = [];
  navHtml.replace(/data-act="([^"]+)"[^>]*>(?:<span>[^<]*<\/span>\s*)?([^<]*)<\/button>/g, (m0, k, label) => { drawerPairs.push({ key: k, label: label }); return m0; });
  ok(cardKeys.length > 0, label + ': dashboard paints cards (' + cardKeys.length + ')');
  ok(drawerPairs.length > 0, label + ': drawer paints items (' + drawerPairs.length + ')');

  const titleOf = () => (D.byId.get('modTitle') ? D.byId.get('modTitle').textContent : '');
  const auditKey = (key, surface) => {
    rendered.length = 0;
    A.openModule(key);
    const want = REMAP[key] || key;
    const got = rendered.slice();
    const tierLocked = got.length === 1 && got[0] === 'subscription' && want !== 'subscription';
    /* the Navigator is a COMPOSED module: its own render drives
       the merged places face (modules/navigation.js) inside
       itself. That is composition, not a misroute — the first
       render must still be the Navigator's own. */
    const composed = want === 'navigator' && got.length >= 1 && got[0] === 'navigator' &&
      got.slice(1).every((g) => g === 'navigation');
    ok((got.length === 1 && (got[0] === want || tierLocked)) || composed,
      label + ' ' + surface + ' "' + key + '" renders its own module (rendered: ' + JSON.stringify(got) + ')');
    if (key === 'preferences') {
      eq(got[0], 'preferences', label + ': PREFS-OPENS-CONNECT — Preferences renders Preferences, never Connect');
      eq(titleOf(), 'Preferences', label + ': the header reads Preferences');
    }
    if (key === 'connect') {
      eq(got[0], 'connect', label + ': Connect renders Connect (and only Connect opens it)');
    }
    return got[0];
  };

  /* The drawer's three ACTION items are not modules and never
   * pass through openModule: the sidebar handler routes them
   * itself (app.js buildSidebar: dashboard -> showDashboard,
   * feedback -> openFeedback, logout -> doLogout). They are out
   * of this audit's scope by design; a source pin below keeps
   * that routing explicit. */
  const NON_MODULE = { dashboard: 1, feedback: 1, logout: 1 };
  const seen = {};
  cardKeys.forEach((k) => { seen[k] = auditKey(k, 'card'); });
  drawerPairs.filter((p) => !NON_MODULE[p.key]).forEach((p) => {
    const got = auditKey(p.key, 'drawer');
    /* a drawer item LABELLED for one module must not open another:
       the label text names its module in plain words for the two
       entries this bug report is about. */
    if (/preference/i.test(p.label)) eq(got, 'preferences', label + ': the drawer item labelled "' + p.label.trim() + '" opens Preferences');
    if (/^connect$/i.test(p.label.trim())) eq(got, 'connect', label + ': the drawer item labelled "Connect" opens Connect');
    seen[p.key] = got;
  });

  /* the direct specials, whether or not a surface showed them */
  ['preferences', 'connect', 'account', 'subscription'].forEach((k) => {
    if (!seen[k]) auditKey(k, 'door');
  });

  Object.keys(M).forEach((k) => { if (orig[k]) M[k].render = orig[k]; });
}

async function main() {
  console.log('— source pins: the surfaces and the shared door —');
  const appSrc = read('js/app.js');
  ok(/c\.onclick = function \(\) \{ App\.openModule\(c\.getAttribute\('data-mod'\)\); \}/.test(appSrc),
    'dashboard cards open the key on their OWN element (data-mod), read at tap time');
  ok(/else App\.openModule\(act\);/.test(appSrc) &&
     /if \(act === 'dashboard'\) App\.showDashboard\(\);/.test(appSrc) &&
     /else if \(act === 'feedback'\) openFeedback\(\);/.test(appSrc) &&
     /else if \(act === 'logout'\) doLogout\(\);/.test(appSrc),
    'drawer items open their OWN data-act; dashboard/feedback/logout are actions, not modules');
  ok(!/openModule\('connect'\)/.test(appSrc.replace(/App\.openModule = function[\s\S]*?\n  \};/, '')),
    'no code path in app.js force-opens Connect behind another key');

  await auditWorld('driver', {
    firstName: 'Asjad', lastName: 'Kamal', accountType: 'Driver', userRole: 'driver',
    employment: 'Contract', payStandard: 'Hourly', payRate: 29, travelMins: 60,
    business: 'Asjad Kamal', country: 'Canada', province: 'AB', nameAsked: true
  }, 'uidAuditDriver');
  await auditWorld('owner-operator (office)', {
    firstName: 'Dave', lastName: 'Cooper', accountType: 'Owner-Operator', userRole: 'office',
    employment: 'Contract', payStandard: 'Hourly', payRate: 52, travelMins: 0,
    business: 'Cooper Hauling', country: 'Canada', province: 'AB', nameAsked: true
  }, 'uidAuditOwner');
  await auditWorld('fleet manager', {
    firstName: 'Maria', lastName: 'Lott', accountType: 'Fleet Manager', userRole: 'office',
    employment: 'Contract', payStandard: 'Hourly', payRate: 40, travelMins: 0,
    business: 'Dynamic Trucking', country: 'Canada', province: 'AB', nameAsked: true
  }, 'uidAuditFleet');
  console.log('\nrouting-audit-v220: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
