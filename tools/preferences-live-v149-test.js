#!/usr/bin/env node
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

(async function main() {
  const prefSrc = read('modules/preferences.js');
  const dspSrc = read('modules/dispatch.js');
  const idxSrc = read('index.html');
  const ver = JSON.parse(read('version.json'));

  /* ============ (a) account type applies LIVE ============ */
  console.log('(a) live-apply — the payer changes his account type, no Save, no restart');
  {
    /* The payer's exact evening: signed up as a Driver, told to
       become the owner side; role already office. */
    const w = world({
      uid: 'uid-payer', email: 'umar@aitrucking.example', role: 'office',
      onboarding: { companyName: 'AI Trucking', accountType: 'Driver', userRole: 'office', employment: 'Contract', payStandard: 'Hourly' }
    });
    /* app start published the Driver identity */
    eq('a: the start-of-day publish writes', await w.sb.ConnectLive.publishMine(), true);
    eq('a: the world sees a Driver', w.db._col('directory').get('uid-payer').role, 'Driver');
    const writesBefore = w.db.writes;

    const body = renderPrefs(w);
    const acct = body.querySelector('#pf_acct');
    check('a: the account type select rendered', !!acct);
    acct.value = 'Owner-Operator';
    fireChange(acct);
    eq('a: the change persists WITHOUT Save', w.store.get('onboarding', {}).accountType, 'Owner-Operator');
    check('a: App.onAuth re-ran (the face re-tunes)', w.authCalls.length >= 1);
    await flush();
    eq('a: the directory record now carries the new type', w.db._col('directory').get('uid-payer').role, 'Owner-Operator');
    check('a: the republish really wrote (no restart involved)', w.db.writes > writesBefore);

    /* a later Save must not resurrect the old value */
    body.querySelector('#pf_save').click();
    eq('a: Save after the live change keeps Owner-Operator', w.store.get('onboarding', {}).accountType, 'Owner-Operator');

    /* employment + payment standard ride the same pattern */
    const emp = body.querySelector('#pf_emp');
    emp.value = 'Payroll';
    fireChange(emp);
    eq('a: employment persists the moment it changes', w.store.get('onboarding', {}).employment, 'Payroll');
    const std = body.querySelector('#pf_std');
    std.value = 'Weight';
    fireChange(std);
    eq('a: payment standard persists the moment it changes', w.store.get('onboarding', {}).payStandard, 'Weight');
    body.querySelector('#pf_save').click();
    const after = w.store.get('onboarding', {});
    eq('a: Save keeps all three live values', [after.accountType, after.employment, after.payStandard],
      ['Owner-Operator', 'Payroll', 'Weight']);
  }

  /* ============ (b) the office face gains the company billing door ============ */
  console.log('(b) office client-rate door — renders, saves, prices crew revenue');
  {
    const w = world({
      uid: 'uid-payer', email: 'umar@aitrucking.example', role: 'office',
      onboarding: { companyName: 'AI Trucking', accountType: 'Owner-Operator', userRole: 'office', payStandard: 'Hourly' }
    });
    const body = renderPrefs(w);
    const html = body.innerHTML;
    has('b: office face renders the client billing field', html, 'id="pf_billrate"');
    has('b: its label is the company/client billing rate', html, 'Client billing rate ($/foreman hour)</label>');
    hasnt('b: office face still has NO personal wage field', html, 'id="pf_wagerate"');
    eq('b: before the rate is set, pricingFor prices NO revenue', w.sb.ConnectPipe.pricingFor('uid-driver').clientRate, 0);
    body.querySelector('#pf_billrate').value = '52';
    body.querySelector('#pf_save').click();
    eq('b: Save writes onboarding.billingRate', w.store.get('onboarding', {}).billingRate, '52');
    eq('b: pricingFor now prices crew revenue at $52', w.sb.ConnectPipe.pricingFor('uid-driver').clientRate, 52);
  }
  {
    /* Fleet Manager, office role — the boss face from v137. */
    const w = world({
      uid: 'uid-boss', email: 'boss@example.example', role: 'office',
      onboarding: { companyName: 'Boss Co', accountType: 'Fleet Manager', userRole: 'office', payStandard: 'Hourly', payRate: '40' }
    });
    const body = renderPrefs(w);
    has('b: Fleet Manager face renders the billing door', body.innerHTML, 'id="pf_billrate"');
    hasnt('b: Fleet Manager face has NO personal wage field', body.innerHTML, 'id="pf_wagerate"');
  }
  {
    /* Fleet Manager who also drives: still a payer face for the
       company rate; his own driving pay stays a P&L matter. */
    const w = world({
      uid: 'uid-boss2', email: 'boss2@example.example', role: 'both',
      onboarding: { companyName: 'Boss Co', accountType: 'Fleet Manager', userRole: 'both', payStandard: 'Hourly', payRate: '40' }
    });
    const body = renderPrefs(w);
    has('b: FM/drives face renders the billing door', body.innerHTML, 'id="pf_billrate"');
    hasnt('b: FM/drives face has NO personal wage field', body.innerHTML, 'id="pf_wagerate"');
  }

  /* ============ (c) the driving faces render exactly as before ============ */
  console.log('(c) pfOO + driver faces — byte-for-byte the v137 render');
  {
    const w = world({
      uid: 'uid-owner', email: 'asjadkamal482@gmail.com', role: 'driver',
      onboarding: { accountType: 'Owner-Operator', userRole: 'driver', payStandard: 'Hourly', payRate: '29', billingRate: '', ownWageRate: '', travelBonus: '1' }
    });
    const body = renderPrefs(w);
    const html = body.innerHTML;
    has('c: OO face keeps the billing field', html, 'id="pf_billrate"');
    has('c: OO face keeps the wage field', html, 'id="pf_wagerate"');
    has('c: OO billing placeholder unchanged', html, 'placeholder="Blank = your wage rate"');
    has('c: OO wage label unchanged', html, 'Driver wage rate ($/hour)</label>');
    has('c: OO two-books note unchanged', html, 'If you own the truck AND drive it, a closed haul card posts both sides of your books');
    check('c: OO wage field still shows his effective $29', /id="pf_wagerate"[^>]*value="29"/.test(html));
    /* and its Save still writes both rates, setup rate untouched */
    body.querySelector('#pf_wagerate').value = '31';
    body.querySelector('#pf_save').click();
    const saved = w.store.get('onboarding', {});
    eq('c: OO save writes ownWageRate', saved.ownWageRate, '31');
    eq('c: OO save never writes the setup rate', saved.payRate, '29');
  }
  {
    const w = world({
      uid: 'uid-driver', email: 'driver@example.example', role: 'driver',
      onboarding: { accountType: 'Driver', userRole: 'driver', payStandard: 'Hourly', payRate: '29', billingRate: '', ownWageRate: '' }
    });
    const body = renderPrefs(w);
    const html = body.innerHTML;
    has('c: driver face keeps his pay rate field', html, 'id="pf_wagerate"');
    has('c: driver label unchanged', html, 'Your pay rate ($/hour)</label>');
    hasnt('c: driver face still has NO billing field (not a payer face)', html, 'id="pf_billrate"');
  }

  /* ============ (d) statics — copy truth + ship pins ============ */
  console.log('(d) statics — the Account card tells the truth; the Crew hint names the door');
  has('d: account card copy says settings save on change', prefSrc, 'save the moment you change them');
  has('d: the Crew card hint names the Pay card door', dspSrc,
    'Revenue is not priced yet — set your client rate in Preferences (the Pay card).');
  /* v151 pin move (the standing convention): 150 -> 151.
     v152 pin move: 151 -> 152, same convention.
     v154 pin move: 153 -> 154, same convention.
     v155 pin move: 154 -> 155, same convention.
     v147 pin move: 155 -> 156, same convention.
     v148 pin move: 156 -> 157, same convention. v156 pin move: 157 -> 158, same convention. v159 pin move: 158 -> 159, same convention. v160 pin move: 159 -> 160, same convention. v161 pin move: 160 -> 161, same convention. */
  eq('d: version ships as 167', ver.webVersion, 167);
  check('d: index loads the touched files at the 167 pin',
    idxSrc.indexOf('modules/preferences.js?v=167') !== -1 &&
    idxSrc.indexOf('modules/dispatch.js?v=167') !== -1);

  console.log('\npreferences-live-v149: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL harness error: ' + (e && e.stack || e)); process.exit(1); });
