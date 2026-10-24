#!/usr/bin/env node
/* Meticulous v252 — APP-LANGUAGE-BUTTON + I18N, FRAMEWORK ship
 * (owner Oct 23, 2026 06:31–06:39 MDT): a Language button in
 * Preferences changes the ENTIRE app's language; his list of
 * 13 with Punjabi in BOTH scripts. This version ships the
 * framework (js/i18n.js: registry, packs, English-fallback,
 * RTL for Urdu/Arabic/Shahmukhi, app_lang persistence) + the
 * Preferences picker + the FIRST converted surface — the
 * dashboard module names through App's moduleTitle seam and
 * the picker card's own heading. Remaining surfaces convert
 * module by module in follow-on versions; nothing here claims
 * full conversion.
 *
 * Run: node tools/i18n-framework-v252-test.js
 */

/* Meticulous v149 — PREFERENCES LIVE-APPLY + OFFICE CLIENT-RATE DOOR.
 *
 * Owner catches, Oct 17, 2026, over a real payer's first evening
 * (Umar, "AI Trucking", iPhone Safari):
 *  (1) 21:45 — "And why does he have to close the app to get have
 *      his settings saved?" The ROLE select persisted the moment
 *      it changed (the v52 pattern), but ACCOUNT TYPE was written
 *      only inside the Save button's handler, and the Preferences
 *      page itself kept the pre-save face — he changed his type
 *      twice and still saw a driver's face until he force-closed
 *      the app. v149: the identity-shaping selects (account type,
 *      employment, payment standard) persist the moment they
 *      change, in the role pattern — store write with the render
 *      closure kept in sync, App.onAuth re-run (sidebar/dashboard
 *      re-tune + the ConnectLive funnel republishes the directory
 *      record with the new type). A Save ends in the same funnel,
 *      so no path leaves the old face behind.
 *  (2) 21:43 — the office/boss face rendered NO rate fields at
 *      all (v137: personal wage rates don't belong on a boss's
 *      face — that stands), but the CLIENT BILLING RATE is a
 *      company setting, and its only Preferences writer was the
 *      owner-operator-who-drives branch — while the payer's own
 *      Crew card instructed "set your client rate in
 *      Preferences" and ConnectPipe.pricingFor reads exactly
 *      that onboarding.billingRate. An office-only owner could
 *      never set it, so his crew revenue could never price.
 *      v149: the billing-rate door renders on the payer faces
 *      (office role, Fleet Manager, owner-operator of any role),
 *      boss-framed; NO personal wage field joins it.
 *      PAY-CARD-ROLE SUPERSESSION (owner, Oct 21, 2026 15:29
 *      MDT): the door is CLOSED — "Owner revenue is based on
 *      the job!?" Billing rates live on the job/customer side;
 *      the stored billingRate survives as the fallback default
 *      and keeps pricing crew revenue through pricingFor.
 *      Section (b) below now pins THAT behavior; section (a)'s
 *      live-apply law is untouched.
 *
 * Worlds run the REAL modules/preferences.js + js/connectlive.js
 * + js/connectpipe.js over the v137 fake DOM (rendered-id aware)
 * and the connect-live fake Firestore, one shared store per
 * world. The App.onAuth stub mirrors the app.js funnel's
 * ConnectLive leg (app.js: "try { if (window.ConnectLive)
 * ConnectLive.onAuth(user); }") and counts calls.
 *
 * Run: node tools/preferences-live-v149-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function has(name, hay, needle) { check(name, String(hay).indexOf(needle) >= 0); }
function hasnt(name, hay, needle) { check(name, String(hay).indexOf(needle) < 0); }
const clone = (v) => JSON.parse(JSON.stringify(v));
function flush() {
  return new Promise((res) => { let n = 0; (function step() { if (++n > 40) return res(); setTimeout(step, 0); })(); });
}

/* ---------------- fake Firestore (connect-live shape) ---------------- */
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
  if (op === '>=') return v !== undefined && v >= val;
  if (op === '<=') return v !== undefined && v <= val;
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
      }
    })
  });
};

/* ---------------- fake DOM (v137 rendered-id aware) ---------------- */
function FakeEl(sel) {
  this._sel = sel || '';
  this.value = '';
  this.textContent = '';
  this.innerHTML = '';
  this.checked = false;
  this.disabled = false;
  this.style = {};
  this.files = [];
  this.onclick = null;
  this.onchange = null;
  this._listeners = {};
  const classes = new Set();
  this.classList = {
    add: function (c) { classes.add(c); },
    remove: function (c) { classes.delete(c); },
    contains: function (c) { return classes.has(c); },
    toggle: function (c, force) {
      const on = force === undefined ? !classes.has(c) : !!force;
      if (on) classes.add(c); else classes.delete(c);
      return on;
    }
  };
}
FakeEl.prototype.addEventListener = function (type, fn) {
  (this._listeners[type] = this._listeners[type] || []).push(fn);
};
FakeEl.prototype.click = function () { if (this.onclick) this.onclick({ target: this }); };
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };
FakeEl.prototype.querySelector = function () { return null; };
FakeEl.prototype.querySelectorAll = function () { return []; };

function makeBody() {
  const body = new FakeEl('body');
  let registry = {};
  let html = '';
  Object.defineProperty(body, 'innerHTML', {
    get: function () { return html; },
    set: function (v) {
      html = String(v);
      registry = {};
      const tagRe = /<(input|select|textarea|button)\b[^>]*\bid="([^"]+)"[^>]*>/g;
      let m;
      const spans = [];
      while ((m = tagRe.exec(html))) spans.push({ tag: m[1], id: m[2], full: m[0], at: m.index });
      const selRe = /<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g;
      const selVals = {};
      while ((m = selRe.exec(html))) {
        const opts = [];
        const oRe = /<option([^>]*)>([^<]*)<\/option>/g;
        let om;
        while ((om = oRe.exec(m[2]))) opts.push({ sel: /selected/.test(om[1]), text: om[2], val: /\bvalue="([^"]*)"/.exec(om[1]) });
        const chosen = opts.filter(function (o) { return o.sel; })[0] || opts[0];
        selVals[m[1]] = chosen ? (chosen.val ? chosen.val[1] : chosen.text) : '';
      }
      spans.forEach(function (s) {
        const el = new FakeEl('#' + s.id);
        const vm2 = /\bvalue="([^"]*)"/.exec(s.full);
        if (s.tag === 'select') el.value = selVals[s.id] || '';
        else if (vm2) el.value = vm2[1];
        if (/\bchecked\b/.test(s.full)) el.checked = true;
        registry['#' + s.id] = el;
      });
    }
  });
  body.querySelector = function (sel) { return registry[sel] || null; };
  body.querySelectorAll = function () { return []; };
  return body;
}

/* ---------------- world ---------------- */
function makeStore(seed) {
  const m = new Map(Object.entries(clone(seed || {})));
  return {
    get: (k, d) => (m.has(k) ? clone(m.get(k)) : d),
    set: (k, v) => { m.set(k, clone(v)); return true; },
    del: (k) => { m.delete(k); return true; }
  };
}

function world(opts) {
  const db = new FakeDb();
  const store = makeStore({ onboarding: opts.onboarding, con_list: [], con_hidden: [] });
  const authCalls = [];
  const sb = { console, setTimeout, clearTimeout, Promise, JSON, Date, Math };
  sb.window = sb;
  sb.Meticulous = { modules: {} };
  sb.esc = (s) => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  sb.dspFmtH = function (x) {
    var n = Math.round((parseFloat(x) || 0) * 100) / 100;
    return (n % 1 === 0) ? n.toFixed(1) : String(n);
  };
  const App = {
    _store: store,
    _esc: sb.esc,
    _masterOdometer: function () { return null; },
    userRole: function () { return opts.role; },
    user: { uid: opts.uid, email: opts.email },
    onAuth: function (user) {
      authCalls.push(user);
      /* app.js:218 — the real funnel's ConnectLive leg */
      try { if (sb.ConnectLive) sb.ConnectLive.onAuth(user); } catch (e) {}
    },
    goSignIn: function () {},
    toast: function () {}
  };
  sb.App = App;
  sb.FB = { ready: true, user: { uid: opts.uid, email: opts.email }, db: db };
  sb.alert = function () {};
  sb.confirm = function () { return true; };
  vm.createContext(sb);
  vm.runInContext(read('js/connectlive.js'), sb);
  vm.runInContext(read('js/connectpipe.js'), sb);
  vm.runInContext(read('modules/preferences.js'), sb);
  return { sb, db, store, authCalls, App };
}

function renderPrefs(w) {
  const body = makeBody();
  w.sb.Meticulous.modules.preferences.render(body);
  return body;
}
function fireChange(el) {
  if (el && el.onchange) el.onchange({ target: el });
}

/* ================= v252 scenarios ================= */
const appSrc = read('js/app.js');
const prefSrc = read('modules/preferences.js');
const indexSrc = read('index.html');

function i18nWorld() {
  const data = new Map();
  const store = {
    get: function (k, d) { return data.has(k) ? data.get(k) : d; },
    set: function (k, v) { data.set(k, v); }
  };
  const docEl = { attrs: {}, setAttribute: function (k, v) { this.attrs[k] = v; } };
  const sb = { console, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Error, parseFloat, parseInt, isFinite, isNaN };
  sb.window = sb;
  sb.document = { documentElement: docEl };
  sb.App = { _store: store };
  vm.createContext(sb);
  vm.runInContext(read('js/i18n.js'), sb);
  return { sb, store, docEl, I: sb.Meticulous.i18n };
}

(async function main() {
  console.log('— the registry: his 13, both Punjabi scripts —');
  {
    const w = i18nWorld();
    const codes = w.I.langs().map(function (L) { return L.code; });
    eq('13 languages', codes.length, 13);
    eq('his order, Punjabi twice', JSON.stringify(codes), JSON.stringify(['en', 'ur', 'pa-sh', 'pa-gur', 'hi', 'ar', 'ru', 'uk', 'es', 'fr', 'bs', 'zh', 'ja']));
    eq('default language is English', w.I.lang(), 'en');
  }
  console.log('— every pack covers the whole framework surface (no blanks) —');
  {
    const w = i18nWorld();
    const enKeys = Object.keys(w.I.pack('en'));
    check('the English pack carries the surface', enKeys.length >= 13, String(enKeys.length));
    w.I.langs().forEach(function (L) {
      const p = w.I.pack(L.code);
      const missing = enKeys.filter(function (k) { return !p[k]; });
      check(L.code + ' covers every key', missing.length === 0, missing.join(','));
    });
  }
  console.log('— t(): chosen pack wins, English behind it, never blank —');
  {
    const w = i18nWorld();
    eq('en fuel', w.I.t('mod.fuel'), 'Fuel & Expense');
    w.I.setLang('uk');
    eq('uk fuel', w.I.t('mod.fuel'), 'Паливо та витрати');
    eq('the choice persisted on app_lang', w.store.get('app_lang', ''), 'uk');
    eq('an unknown key falls to the caller fallback', w.I.t('no.such.key', 'FB'), 'FB');
    eq('an unknown key with no fallback returns the key', w.I.t('no.such.key'), 'no.such.key');
    eq('PTI stays PTI (its own name, every market)', w.I.t('mod.pti'), 'PTI');
    w.I.setLang('xx');
    eq('an unknown language code lands on English', w.I.lang(), 'en');
  }
  console.log('— direction: Urdu, Arabic, Shahmukhi run RTL —');
  {
    const w = i18nWorld();
    w.I.setLang('ur'); eq('ur dir', w.docEl.attrs.dir, 'rtl');
    w.I.setLang('ar'); eq('ar dir', w.docEl.attrs.dir, 'rtl');
    w.I.setLang('pa-sh'); eq('pa-sh dir', w.docEl.attrs.dir, 'rtl'); eq('pa-sh html lang', w.docEl.attrs.lang, 'pa');
    w.I.setLang('pa-gur'); eq('pa-gur dir', w.docEl.attrs.dir, 'ltr');
    w.I.setLang('ja'); eq('ja dir', w.docEl.attrs.dir, 'ltr');
  }
  console.log('— the moduleTitle seam speaks the chosen language —');
  {
    const w = i18nWorld();
    const a = appSrc.indexOf('/* MODULE-TITLE-BEGIN'), b = appSrc.indexOf('/* MODULE-TITLE-END */');
    check('title region markers present', a !== -1 && b > a);
    const region = appSrc.slice(a, b);
    const sb2 = { console, JSON, Math, Date, Object, Array, String, Number };
    sb2.window = sb2;
    sb2.Meticulous = w.sb.Meticulous;
    sb2.store = { get: function (k, d) { return k === 'onboarding' ? { employment: sb2.__emp || 'Contract' } : d; } };
    vm.createContext(sb2);
    vm.runInContext(region + '\nthis.__mt = moduleTitle;', sb2);
    w.I.setLang('en');
    eq('en dispatch title', sb2.__mt('dispatch'), 'Dispatch');
    w.I.setLang('ur');
    eq('ur fuel title', sb2.__mt('fuel'), 'ایندھن اور خرچ');
    w.I.setLang('fr');
    sb2.__emp = 'Payroll';
    eq('fr payroll invoice title', sb2.__mt('invoice'), 'Bulletin de paie');
    sb2.__emp = 'Contract';
    eq('fr contract invoice title', sb2.__mt('invoice'), 'Facture');
  }
  console.log('— the Preferences picker: rendered for everyone, persists on change —');
  {
    const w = world({ role: 'office', uid: 'u9', email: 'o@b.c', onboarding: { firstName: 'O', lastName: 'F' } });
    vm.runInContext(read('js/i18n.js'), w.sb);
    const body = renderPrefs(w);
    const h = body.innerHTML;
    check('the Language card renders (office face too)', h.indexOf('id="pf_lang"') !== -1);
    check('all 13 options render in their own names', h.indexOf('Українська') !== -1 && h.indexOf('ਪੰਜਾਬੀ (ਗੁਰਮੁਖੀ)') !== -1 && h.indexOf('پنجابی (شاہ مکھی)') !== -1 && h.indexOf('Bosanski') !== -1, '');
    const sel = body.querySelector('#pf_lang');
    sel.value = 'uk';
    fireChange(sel);
    eq('the change persisted the moment it was made', w.sb.Meticulous.i18n.lang(), 'uk');
  }
  console.log('— load order + wiring pins —');
  {
    check('i18n.js loads before app.js', indexSrc.indexOf('<script src="js/i18n.js') !== -1 && indexSrc.indexOf('<script src="js/i18n.js') < indexSrc.indexOf('<script src="js/app.js'));
    check('preferences builds the picker from the registry', prefSrc.indexOf('Meticulous.i18n.langs()') !== -1 && prefSrc.indexOf('id="pf_lang"') !== -1);
    check('preferences persists through setLang', prefSrc.indexOf('Meticulous.i18n.setLang') !== -1);
  }
  console.log('\ni18n-framework-v252 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
