#!/usr/bin/env node
/* Meticulous v106 — LOGIN GETS ITS OWN PAGE suite (owner directive,
 * Oct 16, 2026 19:49 MDT: "Give login its own page!").
 *
 * Pins:
 *  (1) Preferences renders with ZERO password inputs (source + real
 *      render, signed in and out irrelevant — the fields are GONE),
 *      and its source carries no change-password handler, no sign-in
 *      door, no Security card.
 *  (2) The new Account & login screen (modules/account.js) carries the
 *      moved Security card byte-for-byte in behaviour: signed-in line,
 *      the three password fields (same ids), the ghost Change password
 *      button — and its submit path calls the SAME handler flow as the
 *      old Preferences card: FB.changePassword(new), with the
 *      reauthenticate(current) fallback on auth/requires-recent-login,
 *      the v45 plain-English error map, and the invisible-char clean.
 *  (3) The signed-out render keeps the v95 sign-in door (primary,
 *      top of the card, wired to App.goSignIn) on the new screen.
 *  (4) Navigation: the drawer carries "Account & login" near the
 *      bottom (after Subscription, before Feedback), App.openModule
 *      titles it, and it is NOT a dashboard card (no MODULE_META).
 * Run: node tools/account-login-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.log('  ✗ FAIL: ' + label); }
}
function eq(a, b, label) { ok(a === b, label + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

/* ================= fake DOM (cf. boss-firstrun-test) ================= */
function FakeEl(sel) {
  this._sel = sel || '';
  this._kids = {};
  this._html = '';
  this.value = '';
  this.textContent = '';
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
FakeEl.prototype.click = function () { if (this.onclick) this.onclick({ target: this }); };
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };

function memStore(seed) {
  const data = Object.assign({}, seed || {});
  return {
    get: function (k, d) { return (k in data) ? data[k] : d; },
    set: function (k, v) { data[k] = v; },
    del: function (k) { delete data[k]; }
  };
}
function flush() {
  return new Promise(function (r) { setImmediate(r); })
    .then(function () { return new Promise(function (r) { setImmediate(r); }); })
    .then(function () { return new Promise(function (r) { setImmediate(r); }); });
}

/* ================= worlds ================= */
function prefsWorld() {
  const App = {
    _store: memStore({ onboarding: { accountType: 'Owner-Operator', userRole: 'both', payRate: '29' } }),
    _esc: function (s) { return String(s == null ? '' : s); },
    _masterOdometer: function () { return null; },
    userRole: function () { return 'driver'; },
    user: null,
    onAuth: function () {},
    goSignIn: function () {}
  };
  const sb = { window: {}, Meticulous: { modules: {} }, App, console };
  sb.window.App = App;
  vm.createContext(sb);
  vm.runInContext(read('modules/preferences.js'), sb);
  return sb;
}

function accountWorld(fb) {
  const calls = { goSignIn: 0 };
  const App = {
    _store: memStore({}),
    _esc: function (s) { return String(s == null ? '' : s); },
    goSignIn: function () { calls.goSignIn++; }
  };
  const sb = { window: {}, Meticulous: { modules: {} }, App, FB: fb, console };
  sb.window.App = App;
  sb.window.FB = fb;
  vm.createContext(sb);
  vm.runInContext(read('modules/account.js'), sb);
  return { sb, calls };
}

async function main() {
  /* ================= 1. Preferences: no passwords, anywhere ================= */
  console.log('(1) Preferences — zero password inputs');
  {
    const pref = read('modules/preferences.js');
    ok(pref.indexOf('type="password"') === -1, 'prefs source: no password-type input');
    ok(pref.indexOf('pf_pw_') === -1, 'prefs source: no pf_pw_* ids (fields or wiring)');
    ok(pref.indexOf('pf_signin') === -1, 'prefs source: no sign-in door left behind');
    ok(pref.indexOf('securityCard') === -1 && pref.indexOf('🔒 Security') === -1, 'prefs source: no Security card');
    ok(pref.indexOf('FB.changePassword') === -1 && pref.indexOf('FB.reauthenticate') === -1, 'prefs source: no password-change handler calls');
    ok(pref.indexOf('id="pf_save"') >= 0, 'prefs source: Save preferences survives (one bottom primary)');

    const sb = prefsWorld();
    const body = new FakeEl('body');
    sb.Meticulous.modules.preferences.render(body);
    const html = body.innerHTML;
    ok(html.indexOf('type="password"') === -1, 'prefs RENDER: zero password inputs in the HTML');
    eq((html.match(/type="password"/g) || []).length, 0, 'prefs RENDER: password input count is exactly 0');
    ok(html.indexOf('pf_pw') === -1 && html.indexOf('pf_signin') === -1, 'prefs RENDER: no password/door ids rendered');
    ok(html.indexOf('Security') === -1, 'prefs RENDER: no Security card rendered');
    ok(html.indexOf('id="pf_save"') >= 0 && html.indexOf('id="pf_acct"') >= 0 && html.indexOf('id="pf_adv_toggle"') >= 0,
      'prefs RENDER: the rest of the page is intact (Account card, Advanced drawer, Save)');
  }

  /* ================= 2. Account & login: the moved card ================= */
  console.log('(2) Account & login — fields + the same submit path');
  {
    const acct = read('modules/account.js');
    ok(acct.indexOf('Meticulous.modules.account') >= 0, 'account: registers Meticulous.modules.account');
    ['pf_pw_cur', 'pf_pw_new', 'pf_pw_conf', 'pf_pw_btn', 'pf_pw_note'].forEach(function (id) {
      eq((acct.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, 'account: exactly one #' + id);
    });
    eq((acct.match(/type="password"/g) || []).length, 3, 'account: exactly three password inputs live here now');
    ok(/btn ghost" id="pf_pw_btn"/.test(acct), 'account: Change password keeps its quiet ghost styling');
    ok(acct.indexOf('FB.changePassword') >= 0 && acct.indexOf('FB.reauthenticate') >= 0, 'account: wired to FB.changePassword + FB.reauthenticate (the same handlers)');

    /* success path */
    const changed = [], reauthed = [];
    const fb = {
      user: { email: 'boss@example.com' },
      changePassword: function (nw) { changed.push(nw); return Promise.resolve(); },
      reauthenticate: function (cur) { reauthed.push(cur); return Promise.resolve(); }
    };
    const w = accountWorld(fb);
    const body = new FakeEl('body');
    w.sb.Meticulous.modules.account.render(body);
    const html = body.innerHTML;
    ok(html.indexOf('Signed in as boss@example.com') >= 0, 'account RENDER: the signed-in account line');
    ok(html.indexOf('id="pf_pw_cur"') >= 0 && html.indexOf('id="pf_pw_new"') >= 0 && html.indexOf('id="pf_pw_conf"') >= 0,
      'account RENDER: Current / New / Confirm password fields');
    ok(html.indexOf('>Change password</button>') >= 0, 'account RENDER: Change password button');
    body.querySelector('#pf_pw_cur').value = 'oldpass';
    body.querySelector('#pf_pw_new').value = 'newpass1';
    body.querySelector('#pf_pw_conf').value = 'newpass1';
    body.querySelector('#pf_pw_btn').click();
    await flush();
    deepEqArr(changed, ['newpass1'], 'account SUBMIT: FB.changePassword called once with the new password');
    eq(reauthed.length, 0, 'account SUBMIT: no reauthentication on the clean path');
    eq(body.querySelector('#pf_pw_note').textContent, '✓ Password changed.', 'account SUBMIT: success note, verbatim');
    eq(body.querySelector('#pf_pw_cur').value, '', 'account SUBMIT: fields cleared after success');

    /* validation paths — the handler must refuse before touching FB */
    const w2 = accountWorld(fb);
    const b2 = new FakeEl('body');
    w2.sb.Meticulous.modules.account.render(b2);
    b2.querySelector('#pf_pw_cur').value = 'oldpass';
    b2.querySelector('#pf_pw_new').value = 'newpass1';
    b2.querySelector('#pf_pw_conf').value = 'different1';
    b2.querySelector('#pf_pw_btn').click();
    await flush();
    eq(b2.querySelector('#pf_pw_note').textContent, 'New passwords do not match.', 'account SUBMIT: mismatch refused with the same words');
    eq(changed.length, 1, 'account SUBMIT: mismatch never reaches FB.changePassword');
    b2.querySelector('#pf_pw_new').value = 'short';
    b2.querySelector('#pf_pw_conf').value = 'short';
    b2.querySelector('#pf_pw_btn').click();
    await flush();
    eq(b2.querySelector('#pf_pw_note').textContent, 'New password must be at least 6 characters.', 'account SUBMIT: short password refused with the same words');
    eq(changed.length, 1, 'account SUBMIT: short password never reaches FB.changePassword');

    /* requires-recent-login: reauthenticate(current) then retry — and
       the current password is cleaned (trailing space stripped) */
    const changed2 = [], reauthed2 = [];
    let firstTry = true;
    const fb2 = {
      user: { email: 'boss@example.com' },
      changePassword: function (nw) {
        changed2.push(nw);
        if (firstTry) { firstTry = false; const e = new Error('recent'); e.code = 'auth/requires-recent-login'; return Promise.reject(e); }
        return Promise.resolve();
      },
      reauthenticate: function (cur) { reauthed2.push(cur); return Promise.resolve(); }
    };
    const w3 = accountWorld(fb2);
    const b3 = new FakeEl('body');
    w3.sb.Meticulous.modules.account.render(b3);
    b3.querySelector('#pf_pw_cur').value = 'oldpass ';
    b3.querySelector('#pf_pw_new').value = 'newpass1';
    b3.querySelector('#pf_pw_conf').value = 'newpass1';
    b3.querySelector('#pf_pw_btn').click();
    await flush();
    deepEqArr(reauthed2, ['oldpass'], 'account REAUTH: reauthenticate called with the CLEANED current password');
    deepEqArr(changed2, ['newpass1', 'newpass1'], 'account REAUTH: change retried after reauthentication');
    eq(b3.querySelector('#pf_pw_note').textContent, '✓ Password changed.', 'account REAUTH: ends on the success note');

    /* wrong current password: the v45 plain-English map */
    const fb3 = {
      user: { email: 'boss@example.com' },
      changePassword: function () { const e = new Error('nope'); e.code = 'auth/wrong-password'; return Promise.reject(e); },
      reauthenticate: function () { return Promise.resolve(); }
    };
    const w4 = accountWorld(fb3);
    const b4 = new FakeEl('body');
    w4.sb.Meticulous.modules.account.render(b4);
    b4.querySelector('#pf_pw_cur').value = 'wrongpass';
    b4.querySelector('#pf_pw_new').value = 'newpass1';
    b4.querySelector('#pf_pw_conf').value = 'newpass1';
    b4.querySelector('#pf_pw_btn').click();
    await flush();
    eq(b4.querySelector('#pf_pw_note').textContent, 'Current password is wrong.', 'account SUBMIT: wrong current password in plain English (no raw Firebase text)');
  }

  /* ================= 3. Signed-out: the v95 door lives here now ================= */
  console.log('(3) Account & login — signed-out render keeps the sign-in door');
  {
    const w = accountWorld({});
    const body = new FakeEl('body');
    w.sb.Meticulous.modules.account.render(body);
    const html = body.innerHTML;
    ok(html.indexOf('btn primary" id="pf_signin"') >= 0, 'account signed-out: ONE primary Sign in door at the top of the card');
    ok(html.indexOf('Local mode') >= 0, 'account signed-out: the Local-mode explanation survives verbatim');
    ok(html.indexOf('type="password"') === -1, 'account signed-out: no password fields when signed out');
    body.querySelector('#pf_signin').click();
    eq(w.calls.goSignIn, 1, 'account signed-out: the door routes to App.goSignIn');
  }

  /* ================= 4. Navigation ================= */
  console.log('(4) Navigation — drawer entry, title, no dashboard card');
  {
    const app = read('js/app.js');
    const idx = read('index.html');
    const ver = JSON.parse(read('version.json'));
    const iSub = app.indexOf("['subscription', '💳', 'Subscription']");
    const iAcct = app.indexOf("['account', '🔑', 'Account & login']");
    const iFb = app.indexOf("['feedback', '💬', 'Feedback']");
    ok(iSub >= 0 && iAcct > iSub && iFb > iAcct, 'nav: Account & login sits near the bottom of the drawer (Subscription … Account & login … Feedback)');
    ok(app.indexOf("account: 'Account & login'") >= 0, 'nav: App.openModule titles the screen "Account & login"');
    ok(app.indexOf('account: 1') >= 0, 'nav: account rides the special-module set (like preferences/subscription)');
    const metaStart = app.indexOf('var MODULE_META');
    const meta = app.slice(metaStart, app.indexOf('};', metaStart) + 2);
    ok(!/(^|\s)account\s*:/.test(meta), 'nav: NO dashboard card for Account & login (MODULE_META has no account entry)');
    ok(idx.indexOf('src="modules/account.js?v=' + ver.webVersion + '"') >= 0, 'nav: index.html loads modules/account.js at the live pin (v' + ver.webVersion + ')');
    ok(idx.indexOf('src="modules/preferences.js?v=' + ver.webVersion + '"') >= 0, 'nav: index.html loads modules/preferences.js at the live pin');
    ok(idx.indexOf('modules/account.js') > idx.indexOf('modules/preferences.js'), 'nav: account.js loads after preferences.js (module registry order)');
  }

  console.log('\naccount-login-test: ' + pass + '/' + (pass + fail) + ' passed');
  process.exit(fail ? 1 : 0);
}
function deepEqArr(a, b, label) { eq(JSON.stringify(a), JSON.stringify(b), label); }

main().catch(function (e) { console.error(e); process.exit(1); });
