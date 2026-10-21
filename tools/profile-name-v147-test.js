#!/usr/bin/env node
/* Meticulous v147 — PROFILE NAME (owner, Oct 17, 2026 21:31 MDT:
 * "And in preferences why are we not asking first and last name?"
 * / "How are we suppose to connect?").
 *
 * THE DEFECT: setup and Preferences never asked the PERSON's
 * name. Directory identity fell back to the BUSINESS name (his
 * payer appears in Connect as "AI Trucking", a company, not a
 * man) or an email-derived string — Connect is between people,
 * and nobody can find or recognize a person who was never asked
 * his name. Compounding it: signup silently defaulted the account
 * type toward Driver — the onboarding opts question could be
 * walked past unanswered while every fallback (identity role,
 * the Preferences role note's literal "(Driver)", the Preferences
 * select showing Driver first) treated the missing answer as
 * Driver, so people were mis-typed from birth.
 *
 * THE FIX (this test's contract):
 *  - onboarding asks FIRST + LAST NAME as its first step, and
 *    the account type is a REAL question: Next / Skip / Finish
 *    all hold at it while unanswered (the v76 role-question law),
 *    with a nudge at the question; nothing anywhere stamps or
 *    displays a Driver default for an unanswered type.
 *  - Preferences carries the same two fields on the Account
 *    card, persisting with the v149 live-apply pattern (change
 *    -> store + closure sync + directory republish in-session);
 *    an unanswered account type renders an honest "— pick
 *    one —" instead of Driver.
 *  - CL.identity() gains `person` (first + last). The display
 *    name law: the person's full name when known, business as
 *    the second line, and when no person name exists today's
 *    behaviour stands byte-for-byte. `person` rides the SAME
 *    channels `face` rides (v155): directory record, request
 *    snapshots, con_list entries, the reconcile heal — and the
 *    business now lands on the con_list entry too, so bill-to
 *    matching (peerNames) keeps the peer's business even when
 *    his display name becomes his person.
 *  - search matches person-name tokens as well as business
 *    tokens; crew board rows, P&L driver labels, dispatch
 *    picker labels and shared-day headers name the PERSON
 *    (they all read the shared identity / day doc, whose
 *    driverName now carries the person).
 *  - existing accounts get a ONE-TIME dashboard ask (until
 *    answered or skipped — never again after either): it never
 *    blocks the app and never gates any save.
 *
 * Worlds run the REAL js/connectlive.js + js/connectpipe.js +
 * modules/connect.js + modules/preferences.js + the DSP-PIPE
 * region of modules/dispatch.js over the connect-live fake
 * Firestore, and the REAL onboarding region of js/app.js in a
 * second sandbox over a fake DOM. Covers (a) setup, (b)
 * Preferences live-apply, (c) identity channels + heal, (d)
 * listing renders, (e) search by person, (f) attribution,
 * (g) the one-time ask, (h) no save gated by a missing name,
 * (i) ship pins (155 -> 156).
 * Run: node tools/profile-name-v147-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const clSrc = read('js/connectlive.js');
const cpSrc = read('js/connectpipe.js');
const conSrc = read('modules/connect.js');
const prefSrc = read('modules/preferences.js');
const dspSrc = read('modules/dispatch.js');
const pnlSrc = read('modules/pnl.js');
const appSrc = read('js/app.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function has(name, hay, needle) { check(name, String(hay).indexOf(needle) >= 0, 'missing: ' + String(needle).slice(0, 70)); }
function hasnt(name, hay, needle) { check(name, String(hay).indexOf(needle) < 0, 'should not contain: ' + String(needle).slice(0, 70)); }
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

/* ---------------- fake store ---------------- */
function makeStore(seed) {
  const m = new Map(Object.entries(clone(seed || {})));
  return {
    get: (k, d) => (m.has(k) ? clone(m.get(k)) : d),
    set: (k, v) => { m.set(k, clone(v)); return true; },
    del: (k) => { m.delete(k); return true; }
  };
}

/* ---------------- registry body (v149 rendered-id aware) ---------------- */
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

/* ================= the Connect world ================= */
const TODAY = '2026-10-17';
const db = new FakeDb();
const users = {
  /* the payer: a company in the books, a MAN in person */
  payer: {
    uid: 'uid-payer', email: 'umar@aitrucking.example', role: 'office',
    store: makeStore({
      onboarding: { companyName: 'AI Trucking', accountType: 'Owner-Operator', userRole: 'office', firstName: 'Umar', lastName: 'Farooq', payStandard: 'Hourly' },
      con_list: [], con_hidden: [], dsp_list: [], dsp_active: null, sessions: [], tracker: { status: 'idle', startTs: 0, elapsed: 0 }
    })
  },
  /* the owner-driver: NO person name — today's behaviour is his control */
  driver: {
    uid: 'uid-driver', email: 'asjadkamal482@gmail.com', role: 'driver',
    store: makeStore({
      onboarding: { companyName: 'Asjad Kamal', accountType: 'Owner-Operator', userRole: 'driver', payStandard: 'Hourly', payRate: '29' },
      con_list: [], con_hidden: [], dsp_list: [], dsp_active: null, sessions: [], tracker: { status: 'idle', startTs: 0, elapsed: 0 }
    })
  },
  /* a named driver under a different business name */
  named: {
    uid: 'uid-named', email: 'mike@deserthauling.example', role: 'driver',
    store: makeStore({
      onboarding: { companyName: 'Desert Hauling', accountType: 'Driver', userRole: 'driver', firstName: 'Mike', lastName: 'Reyes', payStandard: 'Hourly' },
      con_list: [], con_hidden: [],
      dsp_list: [{
        id: 'dn1', jobSite: 'Maple Ridge', date: TODAY, scheduledAt: TODAY + 'T08:00',
        equipment: 'Tandem', material: 'Clay', ticketNo: '22729', amount: '319.00',
        status: 'completed', endedAt: Date.now() - 3600e3, loads: '3', loadsSet: true,
        tickets: [{ id: 't1', cardNumber: '22729', material: 'Clay', loads: 3, foremanHours: 10, photo: null }]
      }],
      dsp_active: null,
      sessions: [{ date: TODAY, seconds: 11 * 3600, endedAt: new Date(Date.now() - 3600e3).toISOString(), liveKm: 96.5 }],
      tracker: { status: 'idle', startTs: 0, elapsed: 0 }
    })
  },
  /* a legacy phone: his link to the payer was formed BEFORE
     person names existed — the entry is the business, no person */
  legacy: {
    uid: 'uid-legacy', email: 'legacy@example.com', role: 'driver',
    store: makeStore({
      onboarding: { companyName: 'Legacy Co', accountType: 'Driver', userRole: 'driver' },
      con_list: [
        { id: 'u1', name: 'AI Trucking', role: 'Owner-Operator', face: 'office', contact: '', uid: 'uid-payer', status: 'connected', viaConnect: true }
      ],
      con_hidden: [], dsp_list: [], dsp_active: null, sessions: [], tracker: { status: 'idle', startTs: 0, elapsed: 0 }
    })
  },
  /* an account whose type was never answered (walked past setup) */
  untyped: {
    uid: 'uid-untyped', email: 'new@example.com', role: 'driver',
    store: makeStore({
      onboarding: { companyName: '', payStandard: 'Hourly' },
      con_list: [], con_hidden: []
    })
  }
};

const sb = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Promise: Promise, JSON: JSON, Date: Date, Math: Math };
sb.window = sb;
sb.Meticulous = { modules: {} };
sb.esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
sb.dspFmtH = function (x) {
  var n = Math.round((parseFloat(x) || 0) * 100) / 100;
  return (n % 1 === 0) ? n.toFixed(1) : String(n);
};
sb.alert = function () {};
sb.confirm = function () { return true; };
const authCalls = [];
vm.createContext(sb);
vm.runInContext(clSrc, sb);
vm.runInContext(cpSrc, sb);
vm.runInContext(conSrc, sb);
vm.runInContext(prefSrc, sb);
function extract(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}
vm.runInContext(extract(dspSrc, 'DSP-PIPE-BEGIN', 'DSP-PIPE-END'), sb);
(function () {
  const i = dspSrc.indexOf('function dspComposeSched');
  const j = dspSrc.indexOf('\n  }', i);
  vm.runInContext(dspSrc.slice(i, j + 4), sb);
})();

function asUser(u) {
  sb.FB = { ready: true, user: { uid: u.uid, email: u.email }, db: db };
  sb.App = {
    _store: u.store,
    _esc: sb.esc,
    _today: () => TODAY,
    _masterOdometer: function () { return null; },
    userRole: function () { return u.role; },
    user: { uid: u.uid, email: u.email },
    onAuth: function (user) {
      authCalls.push(user);
      try { if (sb.ConnectLive) sb.ConnectLive.onAuth(user); } catch (e) {}
    },
    goSignIn: function () {},
    toast: function () {}
  };
  sb.window.FB = sb.FB; sb.window.App = sb.App;
  sb.ConnectLive._pubKey = '';
  sb.ConnectPipe._pubCache = {};
  sb.ConnectPipe._recCache = {};
  sb.ConnectPipe._billedKnown = null;
  sb.ConnectPipe._lastPullAt = 0;
  sb.pipeDays = null; sb.pipeRecords = null; sb.pipeBilling = null; sb.pipeSent = null; sb.pipeSendMsg = '';
}
const CL = () => sb.ConnectLive;
const CP = () => sb.ConnectPipe;
const dirDoc = (uid) => db._col('directory').get(uid);
const reqDoc = (id) => db._col('requests').get(id);

/* ================= the onboarding world (real js/app.js region) ================= */
function OnbEl(id) {
  FakeEl.call(this, id);
  this._kids = {};
}
OnbEl.prototype = Object.create(FakeEl.prototype);
OnbEl.prototype.querySelector = function (sel) {
  return this._kids[sel] || (this._kids[sel] = new FakeEl(sel));
};
function OnbStepsEl() {
  FakeEl.call(this, 'onbSteps');
  this._html = '';
  this._opts = [];
}
OnbStepsEl.prototype = Object.create(FakeEl.prototype);
Object.defineProperty(OnbStepsEl.prototype, 'innerHTML', {
  get: function () { return this._html; },
  set: function (v) {
    this._html = String(v);
    this._opts = [];
    const re = /<div class="opt[^"]*" data-v="([^"]*)"/g;
    let m;
    while ((m = re.exec(this._html))) {
      const val = m[1];
      this._opts.push({
        _v: val, onclick: null,
        getAttribute: function (n) { return n === 'data-v' ? val : null; }
      });
    }
  }
});
OnbStepsEl.prototype.querySelectorAll = function (sel) {
  return sel === '.opt' ? this._opts : [];
};

/* connect-live-style body: a generic per-selector stub for every
   querySelector (the Connect module paints into divs the parsed
   registry never sees; its guards all read the stubs). */
function makeLiveBody() {
  const cache = {};
  const stub = (sel) => cache[sel] || (cache[sel] = new FakeEl(sel));
  const body = new FakeEl('body');
  body.querySelector = stub;
  body.querySelectorAll = function () { return []; };
  return body;
}

function makeOnbWorld(seed) {
  const store = makeStore(seed || {});
  const reg = {};
  const stepsEl = new OnbStepsEl();
  reg['onbSteps'] = stepsEl;
  /* el() follows the real DOM: a step's inputs exist only while
     that step is rendered (they live in the steps element's
     html); the shell ids always exist. */
  const SHELL = { onbSteps: 1, onbProg: 1, onbBack: 1, onbNext: 1, onbSkip: 1, nameCard: 1 };
  const el = function (id) {
    if (!SHELL[id] && stepsEl.innerHTML.indexOf('id="' + id + '"') === -1) return null;
    return reg[id] || (reg[id] = new FakeEl(id));
  };
  const ob = { console: console, setTimeout: setTimeout, Promise: Promise, JSON: JSON, Date: Date, Math: Math };
  ob.window = ob;
  ob.store = store;
  ob.el = el;
  ob.esc = sb.esc;
  ob.document = {
    createElement: function () { return new FakeEl('x'); },
    addEventListener: function () {},
    getElementById: function (id) { return reg[id] || null; }
  };
  ob.App = {
    onb: {}, onbStep: 0,
    _store: store,
    _view: '',
    showView: function (v) { ob.App._view = v; },
    userRole: function () { return 'driver'; },
    _masterOdometer: function () { return null; },
    tracker: null
  };
  ob.isUserRole = function (v) { return v === 'driver' || v === 'both' || v === 'office'; };
  ob.resolveUserRole = function (o) {
    o = o || {};
    if (ob.isUserRole(o.userRole)) return o.userRole;
    return ({ 'Driver': 'driver', 'Owner-Operator': 'both', 'Fleet Manager': 'office' })[o.accountType] || 'driver';
  };
  vm.createContext(ob);
  const region = appSrc.slice(
    appSrc.indexOf('/* ---------------- onboarding'),
    appSrc.indexOf('/* auth first, then onboarding'));
  vm.runInContext(region, ob);
  vm.runInContext(extract(appSrc, 'NAME-CARD-BEGIN', 'NAME-CARD-END'), ob);
  return { ob: ob, store: store, el: el, stepsEl: stepsEl, App: ob.App };
}
function stepIndex(ob, key) {
  for (let i = 0; i < ob.ONB_STEPS.length; i++) { if (ob.ONB_STEPS[i].key === key) return i; }
  return -1;
}

(async function main() {
  check('engines load', !!CL() && !!CP() && !!(sb.Meticulous.modules.connect) && !!(sb.Meticulous.modules.preferences));

  /* ============ (a) setup asks the person + the type, for real ============ */
  console.log('(a) onboarding — name step first, names stored, type asked not defaulted');
  {
    const w = makeOnbWorld({});
    const ob = w.ob;
    eq('a: the FIRST setup step is the name step', ob.ONB_STEPS[0].key, 'name');
    const acctStep = ob.ONB_STEPS[stepIndex(ob, 'accountType')];
    eq('a: the type step keeps the three real choices',
      acctStep.opts.map(function (o) { return o[0]; }), ['Driver', 'Owner-Operator', 'Fleet Manager']);

    w.App.onb = {}; w.App.onbStep = 0;
    ob.renderOnbStep();
    has('a: the name step asks plainly', w.stepsEl.innerHTML, 'What is your name?');
    has('a: first name field renders', w.stepsEl.innerHTML, 'id="ob_fname"');
    has('a: last name field renders', w.stepsEl.innerHTML, 'id="ob_lname"');
    w.el('ob_fname').value = 'Umar';
    w.el('ob_lname').value = 'Farooq';
    ob.collectOnbInputs();
    eq('a: completing the step stores both names on the onboarding record',
      [w.store.get('onboarding', {}).firstName, w.store.get('onboarding', {}).lastName], ['Umar', 'Farooq']);

    /* the type question: nothing is pre-picked for a fresh user */
    w.App.onb = {}; w.App.onbStep = stepIndex(ob, 'accountType');
    ob.renderOnbStep();
    hasnt('a: a fresh type step pre-selects NOTHING', w.stepsEl.innerHTML, 'opt sel');
    const drv = w.stepsEl._opts.filter(function (d) { return d._v === 'Owner-Operator'; })[0];
    check('a: the type options render as tappable choices', !!drv);
    drv.onclick();
    eq('a: tapping a type stores the pick', w.store.get('onboarding', {}).accountType, 'Owner-Operator');

    /* Finish holds at the type question while it is unanswered —
       the v76 role law, extended to the question that was being
       silently defaulted. */
    const w2 = makeOnbWorld({});
    w2.App.onb = { userRole: 'office', firstName: 'Umar', lastName: 'Farooq', companyName: 'AI Trucking' };
    w2.ob.finishOnboarding();
    eq('a: Finish does NOT complete with the type unanswered', w2.store.get('onboarded', false), false);
    eq('a: Finish lands back ON the type question', w2.App.onbStep, stepIndex(w2.ob, 'accountType'));
    has('a: the held question shows its nudge', w2.stepsEl.innerHTML, 'id="onb_type_warn"');

    /* ...and completes the moment the person picks — names and
       the chosen type both stored, and setup having asked means
       the one-time dashboard ask stays silent for this account. */
    w2.App.onb.accountType = 'Owner-Operator';
    w2.ob.finishOnboarding();
    eq('a: Finish completes once the type is picked', w2.store.get('onboarded', false), true);
    const done = w2.store.get('onboarding', {});
    eq('a: the finished record carries names + chosen type',
      [done.firstName, done.lastName, done.accountType], ['Umar', 'Farooq', 'Owner-Operator']);
    eq('a: setup having asked marks the one-time ask done', done.nameAsked, true);

    /* the movers gate at the type question too (source, boss style) */
    const next = appSrc.slice(appSrc.indexOf("el('onbNext').onclick = function () {"), appSrc.indexOf("el('onbNext').onclick = function () {") + 1400);
    has('a: Next holds at the unanswered type question', next, "cur.key === 'accountType'");
    const skip = appSrc.slice(appSrc.indexOf("el('onbSkip').onclick = function () {"), appSrc.indexOf("el('onbSkip').onclick = function () {") + 1100);
    has('a: Skip lands on the type question when it is unanswered', skip, 'isAccountType(App.onb.accountType)');
    hasnt('a: nothing in app.js stamps a Driver default into the record', appSrc, "accountType = 'Driver'");
  }

  /* ============ (b) Preferences carries the name, live ============ */
  console.log('(b) Preferences — name fields render, persist live, republish the directory');
  {
    asUser(users.payer);
    const body = makeBody();
    sb.Meticulous.modules.preferences.render(body);
    has('b: the Account card carries a First name field', body.innerHTML, 'id="pf_fname"');
    has('b: the Account card carries a Last name field', body.innerHTML, 'id="pf_lname"');
    check('b: the fields open with the stored names',
      /id="pf_fname" value="Umar"/.test(body.innerHTML) && /id="pf_lname" value="Farooq"/.test(body.innerHTML));

    /* a nameless account adds his name here — the change alone
       persists it (v149 pattern) and republishes the directory */
    asUser(users.driver);
    await CL().publishMine();
    eq('b: nameless publish: name = business', dirDoc('uid-driver').name, 'Asjad Kamal');
    eq('b: nameless publish: person honestly empty', dirDoc('uid-driver').person, '');
    const body2 = makeBody();
    sb.Meticulous.modules.preferences.render(body2);
    body2.querySelector('#pf_fname').value = 'Asjad';
    body2.querySelector('#pf_lname').value = 'Kamal';
    const before = authCalls.length;
    body2.querySelector('#pf_lname').onchange({ target: body2.querySelector('#pf_lname') });
    const stored = users.driver.store.get('onboarding', {});
    eq('b: the change persists WITHOUT Save', [stored.firstName, stored.lastName], ['Asjad', 'Kamal']);
    check('b: App.onAuth re-ran (the directory republishes in-session)', authCalls.length > before);
    await flush();
    eq('b: the directory now shows the PERSON', dirDoc('uid-driver').name, 'Asjad Kamal');
    eq('b: the directory carries his person name', dirDoc('uid-driver').person, 'Asjad Kamal');
    eq('b: the business still rides as itself', dirDoc('uid-driver').business, 'Asjad Kamal');
    /* a later Save cannot write the stale closure back */
    body2.querySelector('#pf_save').click();
    eq('b: Save after the live change keeps the names',
      [users.driver.store.get('onboarding', {}).firstName, users.driver.store.get('onboarding', {}).lastName], ['Asjad', 'Kamal']);
    /* restore the nameless control for the sections below */
    users.driver.store.set('onboarding', { companyName: 'Asjad Kamal', accountType: 'Owner-Operator', userRole: 'driver', payStandard: 'Hourly', payRate: '29' });
    sb.ConnectLive._pubKey = '';
    await CL().publishMine();

    /* an unanswered account type shows itself — no silent Driver */
    asUser(users.untyped);
    const body3 = makeBody();
    sb.Meticulous.modules.preferences.render(body3);
    has('b: an unanswered type renders the honest pick-one option', body3.innerHTML, '<option value="" selected>— pick one —</option>');
    eq('b: the type select value is honestly empty', body3.querySelector('#pf_acct').value, '');
    hasnt('b: the role note no longer invents (Driver)', body3.innerHTML, 'account type (Driver)');
  }

  /* ============ (c) identity channels: directory, requests, con_list, heal ============ */
  console.log('(c) the person rides directory -> requests -> con_list, and the heal refreshes him');
  {
    asUser(users.payer);
    await CL().publishMine();
    const pd = dirDoc('uid-payer');
    eq('c: directory keys = the identity fields + person (+derived indexes)',
      Object.keys(pd).sort(), ['business', 'businessLower', 'face', 'name', 'nameLower', 'person', 'role', 'tokens', 'updatedAt']);
    eq('c: the directory NAME is the person', pd.name, 'Umar Farooq');
    eq('c: the person rides as his own field', pd.person, 'Umar Farooq');
    eq('c: the business stays itself, second', pd.business, 'AI Trucking');
    check('c: tokens carry person AND business words',
      pd.tokens.indexOf('umar') !== -1 && pd.tokens.indexOf('farooq') !== -1 && pd.tokens.indexOf('trucking') !== -1);
    /* the publish guard hears a name-only change */
    users.payer.store.set('onboarding', Object.assign({}, users.payer.store.get('onboarding', {}), { lastName: 'Farooqi' }));
    eq('c: a name-only change republishes', await CL().publishMine(), true);
    eq('c: the healed person lands', dirDoc('uid-payer').person, 'Umar Farooqi');
    users.payer.store.set('onboarding', Object.assign({}, users.payer.store.get('onboarding', {}), { lastName: 'Farooq' }));
    await CL().publishMine();

    /* requests snapshot the person, both directions */
    asUser(users.named);
    const peer = (await CL().search('Umar'))[0];
    check('c: search found the payer to ask', !!peer);
    eq('c: send resolves sent', await CL().sendRequest(peer), 'sent');
    const rd = reqDoc('uid-named_uid-payer');
    eq('c: the request snapshots both persons',
      [rd.fromPerson, rd.toPerson], ['Mike Reyes', 'Umar Farooq']);
    eq('c: the snapshot names are the persons too',
      [rd.fromName, rd.toName], ['Mike Reyes', 'Umar Farooq']);

    asUser(users.payer);
    const mine = await CL().listMine();
    eq('c: accepting resolves true', await CL().respond(mine.incoming[0], true), true);
    const pLink = users.payer.store.get('con_list', []).filter(function (c) { return c.uid === 'uid-named'; })[0];
    check('c: the accepter con_list gains the link', !!pLink);
    eq('c: the link names the PERSON, business second on the entry',
      pLink && [pLink.name, pLink.person, pLink.business], ['Mike Reyes', 'Mike Reyes', 'Desert Hauling']);

    asUser(users.named);
    eq('c: the requester reconcile lands his side', await CL().reconcile(), true);
    const nLink = users.named.store.get('con_list', []).filter(function (c) { return c.uid === 'uid-payer'; })[0];
    eq('c: requester side names the payer as a person',
      nLink && [nLink.name, nLink.person, nLink.business], ['Umar Farooq', 'Umar Farooq', 'AI Trucking']);
    eq('c: reconcile stays idempotent', await CL().reconcile(), false);

    /* the heal: a pre-v147 link (business name, no person) is
       refreshed from the peer's CURRENT directory record */
    asUser(users.legacy);
    eq('c: reconcile heals the stale link', await CL().reconcile(), true);
    const lLink = users.legacy.store.get('con_list', []).filter(function (c) { return c.uid === 'uid-payer'; })[0];
    eq('c: the healed entry names the person, keeps the business',
      lLink && [lLink.name, lLink.person, lLink.business], ['Umar Farooq', 'Umar Farooq', 'AI Trucking']);
    eq('c: the heal is idempotent', await CL().reconcile(), false);

    /* bill-to names keep the BUSINESS even with a person up front */
    asUser(users.payer);
    check('c: peerNames still carries the peer business for bill-to matching',
      CP().peerNames('uid-named').indexOf('Desert Hauling') !== -1);
    check('c: an invoice billed to the business still matches the peer',
      CP().peerMatchesBillTo('uid-named', 'Desert Hauling') === true);
  }

  /* ============ (d) listing renders: person first, business second ============ */
  console.log('(d) directory listing + connections render person-first; nameless byte-identical');
  {
    asUser(users.driver);
    await CL().publishMine();
    const body = makeLiveBody();
    sb.Meticulous.modules.connect.render(body);
    await flush();
    body.querySelector('#cn_q').value = 'Umar';
    body.querySelector('#cn_search').click();
    await flush();
    const resHtml = body.querySelector('#cn_results').innerHTML;
    has('d: the result headline is the PERSON', resHtml, '<div class="a">Umar Farooq</div>');
    has('d: the business rides the second line', resHtml, '<div class="b">Owner-Operator · AI Trucking</div>');

    /* the nameless control renders EXACTLY as before v147 */
    asUser(users.payer);
    const body2 = makeLiveBody();
    sb.Meticulous.modules.connect.render(body2);
    await flush();
    body2.querySelector('#cn_q').value = 'Asjad';
    body2.querySelector('#cn_search').click();
    await flush();
    const res2 = body2.querySelector('#cn_results').innerHTML;
    has('d: a nameless result keeps the business as its headline', res2, '<div class="a">Asjad Kamal</div>');
    has('d: and no duplicate business is printed under it', res2, '<div class="b">Owner-Operator</div>');
    hasnt('d: the business is not repeated on the second line', res2, 'Owner-Operator · Asjad Kamal');

    /* current connections: the person headlines, business under;
       a manual entry renders exactly as it always did */
    const body3 = makeLiveBody();
    sb.Meticulous.modules.connect.render(body3);
    await flush();
    has('d: the connection headlines the person', body3.innerHTML, '<div class="a">Mike Reyes</div>');
    has('d: the connection second line carries his business', body3.innerHTML, 'Driver · Desert Hauling');
    users.payer.store.set('con_list', users.payer.store.get('con_list', []).concat([
      { id: 'c1', name: 'Boss Man', role: 'Fleet manager', contact: '' }
    ]));
    const body4 = makeLiveBody();
    sb.Meticulous.modules.connect.render(body4);
    await flush();
    has('d: a manual entry renders untouched beside it', body4.innerHTML, '<div class="a">Boss Man</div>');
    has('d: its second line is role only, as before', body4.innerHTML, '<div class="b">Fleet manager</div>');
  }

  /* ============ (e) search finds the person ============ */
  console.log('(e) search — first name, last name, business token, full name');
  {
    asUser(users.driver);
    eq('e: by first name', (await CL().search('Umar')).map(function (p) { return p.uid; }), ['uid-payer']);
    eq('e: by last name', (await CL().search('Farooq')).map(function (p) { return p.uid; }), ['uid-payer']);
    eq('e: by the full person name', (await CL().search('umar farooq')).map(function (p) { return p.uid; }), ['uid-payer']);
    eq('e: by business token, as before', (await CL().search('Trucking')).map(function (p) { return p.uid; }), ['uid-payer']);
    const r = (await CL().search('Umar'))[0];
    eq('e: the result carries the person for the snapshot',
      r && [r.name, r.person, r.business], ['Umar Farooq', 'Umar Farooq', 'AI Trucking']);
  }

  /* ============ (f) attribution: shared day, crew board, picker, P&L input ============ */
  console.log('(f) attribution — the day a man shares names the man');
  {
    asUser(users.named);
    const doc = CP().buildDay(TODAY);
    check('f: the shared day builds', !!doc);
    eq('f: the shared day header name is the PERSON', doc && doc.driverName, 'Mike Reyes');
    eq('f: the shared day business stays the business', doc && doc.driverBusiness, 'Desert Hauling');
    eq('f: publish lands it', await CP().publishDay(TODAY), true);
    const shared = db._col('shareddays').get('uid-named_' + TODAY);
    eq('f: the published day names the person', shared && shared.driverName, 'Mike Reyes');

    /* the payer's crew board reads that same doc */
    asUser(users.payer);
    sb.pipeDays = [clone(shared)];
    const crew = sb.crewHtml();
    has('f: the crew board headlines the person', crew, 'Mike Reyes — ');
    hasnt('f: the crew board does not headline the company', crew, 'Desert Hauling — ');

    /* the dispatch picker offers him by his person name */
    const send = sb.sendHtml();
    has('f: the picker label is the person', send, '>Mike Reyes</option>');

    /* P&L groups and labels those same shared days by
       day.driverName (the doc pinned above is its input) */
    has('f: P&L crew groups read the day driverName', pnlSrc, 'byDriver[day.driver] = { name: day.driverName');
    has('f: P&L crew wages read the day driverName', pnlSrc, 'byUid[day.driver] = { name: day.driverName');

    /* and a NAMELESS driver's day is byte-identical to before */
    asUser(users.driver);
    users.driver.store.set('dsp_list', [{
      id: 'dd1', jobSite: 'Maple Ridge', date: TODAY, scheduledAt: TODAY + 'T08:00',
      equipment: 'Tandem', material: 'Clay', ticketNo: '22729', amount: '319.00',
      status: 'completed', endedAt: Date.now() - 3600e3, loads: '3', loadsSet: true,
      tickets: [{ id: 't1', cardNumber: '22729', material: 'Clay', loads: 3, foremanHours: 10, photo: null }]
    }]);
    users.driver.store.set('sessions', [{ date: TODAY, seconds: 11 * 3600, endedAt: new Date(Date.now() - 3600e3).toISOString(), liveKm: 96.5 }]);
    const doc2 = CP().buildDay(TODAY);
    eq('f: a nameless day still names the business, as today', doc2 && doc2.driverName, 'Asjad Kamal');
  }

  /* ============ (g) the one-time ask for existing accounts ============ */
  console.log('(g) one-time name ask — shows once, saves, skips, never returns');
  {
    const w = makeOnbWorld({
      onboarded: true,
      onboarding: { companyName: 'AI Trucking', accountType: 'Owner-Operator', userRole: 'office' }
    });
    const card = w.el('nameCard');
    card._kids = {};
    card.querySelector = function (sel) { return this._kids[sel] || (this._kids[sel] = new FakeEl(sel)); };
    card.classList.add('hidden');
    w.ob.paintNameCard();
    check('g: a nameless existing account SEES the ask', !card.classList.contains('hidden'));
    has('g: the ask carries both fields + a skip', card.innerHTML,
      'id="nm_first"');
    has('g: the ask carries the last name field', card.innerHTML, 'id="nm_last"');
    has('g: the ask carries a Skip button', card.innerHTML, 'id="nm_skip"');
    /* saving blank is not an answer — the card stays, nothing is marked */
    card.querySelector('#nm_save').click();
    check('g: a blank Save answers nothing (card stays up)', !card.classList.contains('hidden'));
    eq('g: a blank Save marks nothing', w.store.get('onboarding', {}).nameAsked, undefined);
    /* a real answer: stored through the same onboarding record */
    card.querySelector('#nm_first').value = 'Umar';
    card.querySelector('#nm_last').value = 'Farooq';
    card.querySelector('#nm_save').click();
    const o = w.store.get('onboarding', {});
    eq('g: the answer lands on the onboarding record', [o.firstName, o.lastName], ['Umar', 'Farooq']);
    eq('g: the answer marks the ask done', o.nameAsked, true);
    check('g: the card goes away', card.classList.contains('hidden'));
    w.ob.paintNameCard();
    check('g: it never shows again after an answer', card.classList.contains('hidden'));

    /* skip: one tap, never again, no name invented */
    const w2 = makeOnbWorld({
      onboarded: true,
      onboarding: { companyName: 'AI Trucking', accountType: 'Owner-Operator', userRole: 'office' }
    });
    const card2 = w2.el('nameCard');
    card2._kids = {};
    card2.querySelector = function (sel) { return this._kids[sel] || (this._kids[sel] = new FakeEl(sel)); };
    card2.classList.add('hidden');
    w2.ob.paintNameCard();
    check('g: the second account sees the ask too', !card2.classList.contains('hidden'));
    card2.querySelector('#nm_skip').click();
    eq('g: skip marks the ask done', w2.store.get('onboarding', {}).nameAsked, true);
    eq('g: skip invents no name', w2.store.get('onboarding', {}).firstName, undefined);
    w2.ob.paintNameCard();
    check('g: it never shows again after a skip', card2.classList.contains('hidden'));

    /* named already / not onboarded: the ask never appears */
    const w3 = makeOnbWorld({
      onboarded: true,
      onboarding: { companyName: 'Desert Hauling', firstName: 'Mike', lastName: 'Reyes' }
    });
    const card3 = w3.el('nameCard');
    card3.classList.add('hidden');
    w3.ob.paintNameCard();
    check('g: an account with a name is never asked', card3.classList.contains('hidden'));
    const w4 = makeOnbWorld({ onboarding: { companyName: 'Fresh Co' } });
    const card4 = w4.el('nameCard');
    card4.classList.add('hidden');
    w4.ob.paintNameCard();
    check('g: a mid-setup account is never asked (setup asks instead)', card4.classList.contains('hidden'));
  }

  /* ============ (h) a missing name never gates a save ============ */
  console.log('(h) no save anywhere is blocked by a missing name');
  {
    /* Preferences Save with the name fields empty */
    asUser(users.untyped);
    const body = makeBody();
    sb.Meticulous.modules.preferences.render(body);
    body.querySelector('#pf_save').click();
    eq('h: Preferences saves fine with no name and no type picked',
      users.untyped.store.get('onboarding', {}).accountType, '');
    /* onboarding Finish with the name fields left blank */
    const w = makeOnbWorld({});
    w.App.onb = { userRole: 'driver', accountType: 'Driver', companyName: 'Solo Co' };
    w.ob.finishOnboarding();
    eq('h: setup finishes with the name left blank', w.store.get('onboarded', false), true);
    /* the directory still publishes for a nameless account */
    asUser(users.untyped);
    eq('h: a nameless account still publishes + is findable', await CL().publishMine(), true);
    eq('h: its directory name falls back as today', dirDoc('uid-untyped').name, 'New');
  }

  /* ============ (i) ship pins ============ */
  console.log('(i) ship pins');
  /* v147 ship pins: 155 -> 156. v148 pin move: 156 -> 157, same convention. v156 pin move: 157 -> 158, same convention. v159 pin move: 158 -> 159, same convention. v160 pin move: 159 -> 160, same convention. v161 pin move: 160 -> 161, same convention. v162 pin move: 161 -> 162, same convention. */
  eq('i: version ships as 199', ver.webVersion, 203);
  check('i: index loads every touched file at the 199 pin',
    idxSrc.indexOf('js/app.js?v=203') !== -1 &&
    idxSrc.indexOf('js/connectlive.js?v=203') !== -1 &&
    idxSrc.indexOf('modules/connect.js?v=203') !== -1 &&
    idxSrc.indexOf('modules/preferences.js?v=203') !== -1 &&
    idxSrc.indexOf('modules/dispatch.js?v=203') !== -1);
  check('i: index cohort carries no stale 156 pin', idxSrc.indexOf('?v=156') === -1);
  has('i: the dashboard carries the one-time ask slot', idxSrc, 'id="nameCard"');

  console.log('\nprofile-name-v147 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL harness error: ' + (e && e.stack || e)); process.exit(1); });
