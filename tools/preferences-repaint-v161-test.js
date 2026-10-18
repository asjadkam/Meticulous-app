#!/usr/bin/env node
/* Meticulous v161 — PREFERENCES LIVE REPAINT suite (the v149 named
 * remainder, closed).
 *
 * v149 made Account type / Employment / Payment standard (and the
 * v52 role select) persist the MOMENT they change — store written,
 * App.onAuth re-run, the directory republished — but the OPEN
 * Preferences page kept its already-painted cards until the man
 * left and came back: change Driver -> Owner-Operator and the Pay
 * card still showed the driver's single rate field; change the
 * role to office and the "Where I park" card and the odometer
 * photo tools still sat on the page. On an iPhone that reads as
 * "it didn't take" — the exact complaint that produced v149.
 *
 * v161: after any of the four live-apply selects changes, the
 * open page re-renders ITSELF from the new state, in place — the
 * module's own render on the same body, no reload, no leaving.
 * Two protections ride with it: (1) typed-but-unsaved field
 * values are snapshotted before the repaint and restored into
 * the new DOM, so the repaint can never eat what the man was
 * mid-typing (file inputs excluded — a browser will not let a
 * page set those); (2) the scroll position is carried over.
 * The name fields do NOT repaint (they gate no card, and a
 * repaint under a man tabbing through text fields would cost
 * him his place); the econ select and the photo toggles do not
 * repaint either (they shape nothing this page paints) — their
 * v46/v127 live-apply is untouched.
 *
 * Worlds run the REAL modules/preferences.js (+ connectlive /
 * connectpipe for the v149 funnel) over the v149 fake DOM,
 * extended so registered elements carry id/type and
 * querySelectorAll('input, select, textarea') returns them (the
 * snapshot's eyes). App.userRole reads the store, as app.js does
 * (a stored answer wins).
 *  (a) account type Driver -> Owner-Operator: the SAME page
 *      gains the two-books Pay card; an unsaved typed company
 *      name survives the repaint and a later Save keeps both
 *  (b) role driver -> office: the SAME page loses the park card
 *      and the odometer tools and gains the office rate door
 *  (c) the repainted page is byte-identical to a fresh entry on
 *      the same state (no double-apply, no drift)
 *  (d) employment + payment standard: persist as v149, repaint
 *      consistently, an unsaved typed value survives
 *  (e) statics: the repaint helper exists and is called by all
 *      four live-apply handlers; ship pins derive from
 *      version.json (no frozen literal — the v159 lesson)
 * Run: node tools/preferences-repaint-v161-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
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

/* ---------------- fake Firestore (v149 shape, unused paths ok) ---------------- */
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

/* ---------------- fake DOM (v149 rendered-id aware, extended) ---------------- */
function FakeEl(sel) {
  this._sel = sel || '';
  this.id = '';
  this.type = '';
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
        el.id = s.id;
        const tm = /\btype="([^"]*)"/.exec(s.full);
        el.type = s.tag === 'select' ? 'select-one' : (tm ? tm[1] : 'text');
        const vm2 = /\bvalue="([^"]*)"/.exec(s.full);
        if (s.tag === 'select') el.value = selVals[s.id] || '';
        else if (vm2) el.value = vm2[1];
        if (/\bchecked\b/.test(s.full)) el.checked = true;
        registry['#' + s.id] = el;
      });
    }
  });
  body.querySelector = function (sel) { return registry[sel] || null; };
  body.querySelectorAll = function (sel) {
    if (sel === 'input, select, textarea') {
      return Object.keys(registry).map(function (k) { return registry[k]; })
        .filter(function (el) { return el._sel && el.id && el.type !== ''; });
    }
    return [];
  };
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
    /* app.js law: a stored answer wins (roleDefaultFor otherwise) */
    userRole: function () { const o = store.get('onboarding', {}) || {}; return o.userRole || 'driver'; },
    user: { uid: opts.uid, email: opts.email },
    onAuth: function (user) {
      authCalls.push(user);
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
  const idxSrc = read('index.html');
  const ver = JSON.parse(read('version.json'));

  /* ============ (a) account type repaints the open page ============ */
  console.log('(a) account type Driver -> Owner-Operator, on the open page');
  {
    const w = world({
      uid: 'uid-driver', email: 'driver@example.example',
      onboarding: { accountType: 'Driver', userRole: 'driver', employment: 'Contract', payStandard: 'Hourly', payRate: '29', companyName: 'Old Co' }
    });
    const body = renderPrefs(w);
    has('a: the driver face opens with his pay rate field', body.innerHTML, 'Your pay rate ($/hour)</label>');
    hasnt('a: ...and no billing field', body.innerHTML, 'id="pf_billrate"');

    /* he types a new company name but has NOT saved it yet */
    body.querySelector('#pf_cname').value = 'Typed Haul Co';

    const acct = body.querySelector('#pf_acct');
    acct.value = 'Owner-Operator';
    fireChange(acct);
    await flush();

    eq('a: the change still persists the moment it lands (v149)', w.store.get('onboarding', {}).accountType, 'Owner-Operator');
    has('a: THE SAME PAGE now carries the billing field', body.innerHTML, 'id="pf_billrate"');
    has('a: ...and the two-books wage label', body.innerHTML, 'My wage rate ($/hour)</label>');
    hasnt('a: ...and the driver-only label is gone', body.innerHTML, 'Your pay rate ($/hour)</label>');
    eq('a: his unsaved typing survived the repaint', body.querySelector('#pf_cname').value, 'Typed Haul Co');

    /* (c) re-entry identity, from (a)'s end state */
    const fresh = renderPrefs(w);
    eq('(c) a fresh entry paints byte-identically to the repainted page', fresh.innerHTML, body.innerHTML);

    /* a later Save: no stale resurrection, no double-apply */
    body.querySelector('#pf_save').click();
    const saved = w.store.get('onboarding', {});
    eq('a: Save keeps the new type', saved.accountType, 'Owner-Operator');
    eq('a: Save keeps his typed company name', saved.companyName, 'Typed Haul Co');
  }

  /* ============ (b) role repaints the open page ============ */
  console.log('(b) role driver -> office, on the open page');
  {
    const w = world({
      uid: 'uid-oo', email: 'oo@example.example',
      onboarding: { accountType: 'Owner-Operator', userRole: 'driver', employment: 'Contract', payStandard: 'Hourly', payRate: '29' }
    });
    const body = renderPrefs(w);
    has('b: the driving face opens with the park card', body.innerHTML, 'Where I park');
    has('b: ...and the odometer field', body.innerHTML, 'id="pf_odo"');
    has('b: ...and the wage field', body.innerHTML, 'id="pf_wagerate"');

    const role = body.querySelector('#pf_role');
    role.value = 'office';
    fireChange(role);
    await flush();

    eq('b: the role persists the moment it changes (v52)', w.store.get('onboarding', {}).userRole, 'office');
    hasnt('b: THE SAME PAGE drops the park card', body.innerHTML, 'Where I park');
    hasnt('b: ...drops the odometer tools', body.innerHTML, 'id="pf_odo"');
    hasnt('b: ...drops the personal wage field', body.innerHTML, 'id="pf_wagerate"');
    has('b: ...and gains the office billing door', body.innerHTML, 'id="pf_billrate"');
    has('b: the role note reads as a fresh entry would paint it', body.innerHTML, 'Your answer now: <b>No — office only</b>');

    const fresh = renderPrefs(w);
    eq('(c) a fresh entry paints byte-identically to the repainted page', fresh.innerHTML, body.innerHTML);
  }

  /* ============ (d) employment + payment standard ============ */
  console.log('(d) employment + payment standard — persist, repaint, no clobber');
  {
    const w = world({
      uid: 'uid-driver2', email: 'driver2@example.example',
      onboarding: { accountType: 'Driver', userRole: 'driver', employment: 'Contract', payStandard: 'Hourly', payRate: '29', travelBonus: '1' }
    });
    const body = renderPrefs(w);
    body.querySelector('#pf_travel').value = '1.5'; /* typed, unsaved */
    const emp = body.querySelector('#pf_emp');
    emp.value = 'Payroll';
    fireChange(emp);
    eq('d: employment persists the moment it changes (v149)', w.store.get('onboarding', {}).employment, 'Payroll');
    eq('d: his unsaved travel value survived', body.querySelector('#pf_travel').value, '1.5');
    const std = body.querySelector('#pf_std');
    std.value = 'Weight';
    fireChange(std);
    eq('d: payment standard persists the moment it changes (v149)', w.store.get('onboarding', {}).payStandard, 'Weight');
    eq('d: his unsaved travel value still survives', body.querySelector('#pf_travel').value, '1.5');
    const fresh = renderPrefs(w);
    eq('(c) a fresh entry paints byte-identically to the repainted page', fresh.innerHTML, body.innerHTML);
    body.querySelector('#pf_save').click();
    const saved = w.store.get('onboarding', {});
    eq('d: Save lands his travel value at last', saved.travelBonus, '1.5');
    eq('d: Save keeps both live values', [saved.employment, saved.payStandard], ['Payroll', 'Weight']);
  }

  /* ============ (e) statics ============ */
  console.log('(e) statics — the repaint wiring + ship pins');
  {
    has('e: the repaint helper is defined', prefSrc, 'function pfRepaintLive(body');
    const calls = (prefSrc.match(/pfRepaintLive\(body\)/g) || []).length;
    check('e: all four live-apply handlers call it (role, account type, employment, standard)', calls >= 4, 'found ' + calls);
    check('e: version.json carries the live webVersion', Number.isInteger(ver.webVersion) && ver.webVersion >= 161, 'got ' + ver.webVersion);
    has('e: index loads preferences at the live pin', idxSrc, 'modules/preferences.js?v=' + ver.webVersion);
  }

  console.log('\npreferences-repaint-v161 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR', e); process.exit(2); });
