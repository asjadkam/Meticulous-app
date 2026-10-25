#!/usr/bin/env node
/* Meticulous v137 — PREFERENCES FACE CLEANUP suite.
 *
 * Owner catches, Oct 17, 2026 (screenshots of his Preferences):
 *  (1) 12:22 — the Pay card's generic "Rate ($)" + "Client billing
 *      rate — owner-operators [Same as rate]" + "My wage rate —
 *      owner-operators [Same as rate]": "This shouldn't say my
 *      rate... Under pnl each driver gets their own rate!" v137:
 *      NO universal rate field in Preferences. Crew pay rates live
 *      in each driver's P&L entry (the v132 pipe prices wages from
 *      pnl_drivers — untouched). Preferences keeps only the
 *      signed-in user's OWN money identity, framed as theirs:
 *      owner-operator → his billing rate + his wage rate; pure
 *      driver → his one pay rate; office/boss → NO rate fields.
 *      [v149 amendment, Oct 17 21:43: the office/boss face now
 *      renders the CLIENT BILLING RATE — a company setting, not a
 *      personal rate; the two absence pins below moved in place.
 *      The personal-rate rule is untouched.]
 *      Every rate reader migrated to the right chain (own books:
 *      ownWageRate || payRate; billing: billingRate || ownWageRate
 *      || payRate) so the owner's numbers are byte-identical:
 *      stub Oct 1–15 = 124.5 h × $29 = $3,610.50, invoice math,
 *      the $319 day (the day itself is pinned in money-truth-test).
 *  (2) 12:25–12:26 — "Power read and navigator Server are
 *      plumbing! Don't need to be there!" + the server address sat
 *      in an editable text box ("If that is altered app.."). v137:
 *      BOTH cards are removed from the face entirely; Power Read
 *      keeps working in the background (defaults on; the app
 *      figures it out by itself — users are never asked for a
 *      key); the Navigator server address is a BAKED-IN CONSTANT
 *      (loadSettings always returns it; stored values ignored;
 *      saveSettings refuses to persist one) with NO user-editable
 *      surface anywhere.
 *  (3) The travel-bonus helper named the owner ("Asjad: 1h, some
 *      drivers: 1.5h."). v137: rewritten generically, and EVERY
 *      shipped source file is scrubbed of his name — this suite
 *      greps modules/, js/ and index.html and fails if it returns.
 *
 * Deliberate pin moves this build made in OTHER suites (each cited
 * in place): navigator-test (v98 saved-address rule superseded;
 * Preferences server-field pin inverted), card-previews-test
 * (cleared-server status expectation), invoice-format-test (save
 * line + archived-rate literal), role-package-test (v94/v107
 * "toggle/field survives" pins inverted to absences).
 *
 * Run: node tools/preferences-v137-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  ✗ FAIL: ' + label); }
}
function eq(got, want, label) {
  ok(got === want, label + ' (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')');
}
function has(label, hay, needle) { ok(String(hay).indexOf(needle) >= 0, label); }
function hasnt(label, hay, needle) { ok(String(hay).indexOf(needle) < 0, label); }

const prefSrc = read('modules/preferences.js');
const invSrc = read('modules/invoice.js');
const appSrc = read('js/app.js');

/* ================= fake DOM (rendered-id aware) =================
 * Stricter than the account-login stub on purpose: querySelector
 * returns an element ONLY for ids actually present in the rendered
 * HTML (values seeded from the markup, select = selected/first
 * option), and null otherwise — exactly the contract the v137
 * guarded rate-save relies on in a real DOM. */
function FakeEl(sel) {
  this._sel = sel || '';
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
      // selects: value = the selected option's text (else first option)
      const selRe = /<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g;
      const selVals = {};
      while ((m = selRe.exec(html))) {
        const opts = [];
        const oRe = /<option([^>]*)>([^<]*)<\/option>/g;
        let om;
        while ((om = oRe.exec(m[2]))) opts.push({ sel: /selected/.test(om[1]), text: om[2] });
        const chosen = opts.filter(function (o) { return o.sel; })[0] || opts[0];
        selVals[m[1]] = chosen ? chosen.text : '';
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

function memStore(seed) {
  const data = Object.assign({}, seed || {});
  return {
    get: function (k, d) { return (k in data) ? data[k] : d; },
    set: function (k, v) { data[k] = v; },
    del: function (k) { delete data[k]; },
    _data: data
  };
}

function prefsWorld(onboarding, role) {
  const store = memStore({ onboarding: onboarding });
  const App = {
    _store: store,
    _esc: function (s) { return String(s == null ? '' : s); },
    _masterOdometer: function () { return null; },
    userRole: function () { return role; },
    user: null,
    onAuth: function () {},
    goSignIn: function () {},
    toast: function () {}
  };
  const sb = { window: {}, Meticulous: { modules: {} }, App, console, alert: function () {}, confirm: function () { return true; } };
  sb.window.App = App;
  vm.createContext(sb);
  vm.runInContext(read('modules/preferences.js'), sb);
  return { sb, store };
}

/* ================= 1. The three faces ================= */
console.log('— 1. Preferences renders rates as the user\'s OWN money identity, per role —');
{
  /* The owner's exact setup: Owner-Operator, driving himself,
     $29 everywhere, rates never split. */
  const w = prefsWorld({ accountType: 'Owner-Operator', userRole: 'driver', payStandard: 'Hourly', payRate: '29', billingRate: '', ownWageRate: '', travelBonus: '1' }, 'driver');
  const body = makeBody();
  w.sb.Meticulous.modules.preferences.render(body);
  const html = body.innerHTML;
  /* PAY-CARD-ROLE pin move (owner, Oct 21, 2026 15:29 MDT —
     "I thought I told you we don't have driver pay/owner pay...
     Owner revenue is based on the job!?"): the global client
     billing field is OFF every Preferences face; billing rates
     live on the job (Dispatch job rates), and the stored global
     value survives as the fallback default. The v137/v163
     billing pins below are superseded by that ruling. */
  hasnt('OO face: NO billing rate field (PAY-CARD-ROLE — rates live on the job)', html, 'id="pf_billrate"');
  has('OO face: the wage rate field renders', html, 'id="pf_wagerate"');
  hasnt('OO face: NO universal Rate field (pf_rate is gone)', html, 'id="pf_rate"');
  hasnt('OO face: no "Same as rate" placeholder anywhere', html, 'Same as rate');
  hasnt('OO face: no client billing label anywhere', html, 'Client billing rate');
  has('OO face: wage label is "Your wage rate" (PAY-CARD-ROLE — it is his OWN wage; supersedes the v163 "Driver wage rate" rename)', html, 'Your wage rate ($/hour)</label>');
  ok(/id="pf_wagerate"[^>]*value="29"/.test(html), 'OO face: the wage field SHOWS his effective $29 (from the setup rate), not a blank');
  hasnt('OO face: no billing placeholder (the chain note left with the field)', html, 'Blank = your wage rate');
  has('travel note is the generic rewrite (mandated wording)', html,
    'Fixed daily bonus added to foreman ticket hours — for example 1 h, some drivers 1.5 h.');
  hasnt('rendered page contains NO owner name', html, 'Asjad');
  /* the rest of the page is untouched */
  has('other cards intact: business name field', html, 'id="pf_cname"');
  has('other cards intact: next invoice number', html, 'id="pf_nextinv"');
  has('other cards intact: truck number', html, 'id="pf_tnum"');
  has('cloud sync card intact (v136): retry button renders', html, 'id="pf_syncnow"');
}
{
  /* A pure driver: one field — his own pay rate. */
  const w = prefsWorld({ accountType: 'Driver', userRole: 'driver', payStandard: 'Hourly', payRate: '29', billingRate: '', ownWageRate: '' }, 'driver');
  const body = makeBody();
  w.sb.Meticulous.modules.preferences.render(body);
  const html = body.innerHTML;
  has('driver face: his pay rate field renders (as pf_wagerate)', html, 'id="pf_wagerate"');
  has('driver face: the label is "Your pay rate"', html, 'Your pay rate ($/hour)</label>');
  hasnt('driver face: NO billing rate field', html, 'id="pf_billrate"');
  hasnt('driver face: NO universal rate field', html, 'id="pf_rate"');
}
{
  /* The boss: office face — no personal rate fields at all, while
     the Pay card itself (standard + travel bonus) remains. */
  const w = prefsWorld({ accountType: 'Fleet Manager', userRole: 'office', payStandard: 'Hourly', payRate: '40' }, 'office');
  const body = makeBody();
  w.sb.Meticulous.modules.preferences.render(body);
  const html = body.innerHTML;
  /* v149 pin move (owner catch, Oct 17 21:43): the boss face DOES
     render the client billing rate now — it is a COMPANY setting,
     not a personal rate, and its absence left an office-only
     owner unable to set the very rate his Crew card told him to
     set in Preferences. The v137 rule that survives intact is the
     personal one: no wage/pay rate field on this face.
     PAY-CARD-ROLE SUPERSESSION (owner, Oct 21, 2026 15:29 MDT):
     the billing field came off EVERY face, this one included —
     rates live on the job now, and the stored company value
     survives as data (the pricing fallback), not as a field. */
  hasnt('boss face: NO billing rate field (PAY-CARD-ROLE supersedes the v149 door)', html, 'id="pf_billrate"');
  hasnt('boss face: NO wage/pay rate field', html, 'id="pf_wagerate"');
  hasnt('boss face: NO universal rate field', html, 'id="pf_rate"');
  has('boss face: the Pay card itself remains', html, 'id="pf_std"');
  has('boss face: travel bonus remains (not a rate)', html, 'id="pf_travel"');
}
{
  /* Fleet Manager who also drives: still the boss account type —
     his own driving is priced through his P&L entry, not a
     Preferences rate. */
  const w = prefsWorld({ accountType: 'Fleet Manager', userRole: 'both', payStandard: 'Hourly', payRate: '40' }, 'both');
  const body = makeBody();
  w.sb.Meticulous.modules.preferences.render(body);
  const html = body.innerHTML;
  hasnt('FM/drives face: NO personal rate fields', html, 'id="pf_wagerate"');
  /* v149 pin move, same catch as the boss face above: the company
     billing rate renders on payer faces; personal rates stay off.
     PAY-CARD-ROLE SUPERSESSION (Oct 21, 2026): off every face —
     see the boss face note. */
  hasnt('FM/drives face: NO billing rate field (PAY-CARD-ROLE supersedes v149)', html, 'id="pf_billrate"');
}

/* ================= 2. Save: guarded writes, setup rate untouched ================= */
console.log('— 2. Save writes only the rendered rate fields; the setup rate is never stomped —');
{
  const w = prefsWorld({ accountType: 'Owner-Operator', userRole: 'driver', payStandard: 'Hourly', payRate: '29', billingRate: '93', ownWageRate: '', travelBonus: '1', truckNo: '07' }, 'driver');
  const body = makeBody();
  w.sb.Meticulous.modules.preferences.render(body);
  /* the face a save sees: wage field shows 29 (seeded from the
     setup rate); he now splits his wage to 31. PAY-CARD-ROLE:
     there is no billing field on the face at all anymore. */
  body.querySelector('#pf_wagerate').value = '31';
  body.querySelector('#pf_save').click();
  const saved = w.store.get('onboarding', {});
  eq(saved.ownWageRate, '31', 'save: the wage field writes ownWageRate');
  eq(saved.billingRate, '93', 'save: the stored company billing rate SURVIVES untouched — no field renders it, no Save writes it; it lives on as the pricing fallback (PAY-CARD-ROLE migration)');
  eq(saved.payRate, '29', 'save: the setup rate payRate is NOT written by Preferences anymore — it survives as the legacy fallback');
  eq(saved.travelBonus, '1', 'save: travel bonus still saves');
}
{
  /* The boss saves Preferences with NO rate fields rendered at
     all: the handler must not throw and must not invent or erase
     stored rates. (v149 once rendered the company billing field
     on this face; PAY-CARD-ROLE, Oct 21, 2026, took it off every
     face — the stored value below must survive as the pricing
     fallback, and the office-gated Truck card must not make the
     save reach for inputs that were never rendered.) */
  const w = prefsWorld({ accountType: 'Fleet Manager', userRole: 'office', payStandard: 'Hourly', payRate: '40', ownWageRate: '38', billingRate: '85', truckNo: '12', safetyExpiry: '2027-05-31' }, 'office');
  const body = makeBody();
  w.sb.Meticulous.modules.preferences.render(body);
  let threw = null;
  try { body.querySelector('#pf_save').click(); } catch (e) { threw = e; }
  eq(threw, null, 'boss save: no throw with no rate fields and no Truck card rendered');
  const saved = w.store.get('onboarding', {});
  eq(saved.payRate, '40', 'boss save: stored setup rate untouched');
  eq(saved.ownWageRate, '38', 'boss save: stored wage rate untouched (nothing rendered, nothing written)');
  eq(saved.billingRate, '85', 'boss save: stored company billing rate untouched — it survives as fallback data (PAY-CARD-ROLE)');
  eq(saved.truckNo, '12', 'boss save: stored truck number untouched (Truck card is driver-only now — PREFS-ROLE-SPLIT)');
  eq(saved.safetyExpiry, '2027-05-31', 'boss save: stored safety expiry untouched (same gate)');
}

/* ================= 3. Plumbing out of the face ================= */
console.log('— 3. Power Read card + server text box: gone from every rendered face —');
{
  const w = prefsWorld({ accountType: 'Owner-Operator', userRole: 'driver', payStandard: 'Hourly', payRate: '29' }, 'driver');
  const body = makeBody();
  w.sb.Meticulous.modules.preferences.render(body);
  const html = body.innerHTML;
  hasnt('render: no Power Read toggle', html, 'pf_pr_on');
  hasnt('render: no Power read card copy', html, 'Power read on');
  hasnt('render: no server address input', html, 'pf_nav_url');
  hasnt('render: no server note element', html, 'pf_nav_note');
  hasnt('render: no "Server address" label', html, 'Server address');
  hasnt('render: no Navigator server card', html, 'Navigator server');
  has('Advanced still holds its real plumbing: updates', html, 'id="pf_checkupd"');
  has('Advanced still holds its real plumbing: reset', html, 'id="pf_resetonb"');
  const advAt = html.indexOf('id="pf_view_advanced"');
  ok(advAt > 0 && html.indexOf('id="pf_checkupd"') > advAt, 'the surviving plumbing sits in the Advanced view');
  hasnt('source: Preferences carries no server-address resolution at all', prefSrc, 'serverUrl');
  hasnt('source: Preferences never flips the Power Read switch anymore', prefSrc, 'PowerRead.setOn');
  hasnt('source: no Power Read toggle id in Preferences source', prefSrc, 'pf_pr_on');
  hasnt('source: no server input id in Preferences source', prefSrc, 'pf_nav_url');
}

/* ================= 4. Power Read still works in the background ================= */
console.log('— 4. Power Read machinery untouched: defaults ON, API intact —');
{
  const backing = {};
  const store = {
    get: function (k, d) { return (k in backing) ? backing[k] : d; },
    set: function (k, v) { backing[k] = v; },
    del: function (k) { delete backing[k]; }
  };
  const sb = {
    console, setTimeout, clearTimeout, Promise, JSON, Date, Math,
    navigator: { onLine: true },
    fetch: function () { return Promise.reject(new Error('offline in test')); },
    App: { _store: store }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(read('js/ticket-ocr.js'), sb);
  vm.runInContext(read('js/powerread.js'), sb);
  const PR = sb.PowerRead;
  ok(!!PR && typeof PR.escalate === 'function', 'PowerRead loads with its capture API (escalate)');
  eq(PR.isOn(), true, 'Power Read defaults ON with nothing stored (the app figures it out by itself)');
  PR.setOn(false);
  eq(PR.isOn(), false, 'the setOn API still works (no UI remains to call it — background behaviour only)');
  PR.setOn(true);
  eq(PR.isOn(), true, 'setOn(true) restores');
  has('powerread source: the proxy has NO key UI by design (v94 comment stands)', read('js/powerread.js'), 'is deliberately NO UI for it anywhere in the app');
}

/* ================= 5. The baked server ================= */
console.log('— 5. Navigator server: a baked-in constant, functional in every legacy world —');
{
  function navWorld(seed) {
    const data = Object.assign({}, seed || {});
    const store = {
      get: function (k, d) { return (k in data) ? data[k] : d; },
      set: function (k, v) { data[k] = v; },
      del: function (k) { delete data[k]; }
    };
    const sb = {
      console, Math, Date, JSON, setTimeout,
      Meticulous: { modules: {} },
      App: {
        _store: store,
        _today: function () { return '2026-10-17'; },
        _esc: function (s) { return String(s == null ? '' : s); },
        userRole: function () { return 'driver'; },
        tracker: null
      }
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(read('modules/navigator.js'), sb);
    return sb;
  }
  const DEF = 'https://2.31.47.19';
  eq(navWorld({}).MeticulousNav.loadSettings().serverUrl, DEF, 'never set → the baked production address');
  eq(navWorld({ navigator: { serverUrl: '' } }).MeticulousNav.loadSettings().serverUrl, DEF,
    'a legacy CLEARED address is ignored (routing can no longer be switched off from the face)');
  eq(navWorld({ navigator: { serverUrl: 'http://nav.test' } }).MeticulousNav.loadSettings().serverUrl, DEF,
    'a legacy CUSTOM address is ignored (routing can no longer be repointed)');
  const w = navWorld({});
  eq(w.MeticulousNav.saveSettings({ serverUrl: 'http://evil.test' }).serverUrl, DEF,
    'saveSettings REFUSES to persist a serverUrl patch');
  w.MeticulousNav.saveSettings({ muted: true });
  eq(w.MeticulousNav.loadSettings().muted, true, 'other settings still persist through saveSettings (machinery intact)');
  eq(w.MeticulousNav.DEFAULT_SERVER_URL, DEF, 'the exposed constant IS the verified production address');
  eq(w.Meticulous.modules.navigator.status(), 'No trips yet',
    'v254: the card status line reads No trips yet in a baked world (no destination recorded — never the truck profile)');
  hasnt('index.html carries no server-address input either', read('index.html'), 'pf_nav_url');
}

/* ================= 6. The money: byte-identical for the owner's setup ================= */
console.log('— 6. Money pins: Oct 1–15 = 124.5 h × $29 at the wage chain, before AND after a v137 save —');
{
  function extractStore(src) {
    const a = src.indexOf('var store = {');
    const b = src.indexOf('};', a);
    if (a === -1 || b === -1) throw new Error('store slice not found');
    return src.slice(a, b + 2);
  }
  function extractRegion(src, beginMark, endMark) {
    const a = src.lastIndexOf('/*', src.indexOf(beginMark));
    const b = src.indexOf('*/', src.indexOf(endMark));
    if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
    return src.slice(a, b + 2);
  }
  const backing = new Map();
  const localStorage = {
    getItem: function (k) { return backing.has(k) ? backing.get(k) : null; },
    setItem: function (k, v) { backing.set(k, String(v)); },
    removeItem: function (k) { backing.delete(k); }
  };
  const sb = {
    console, localStorage,
    App: { _today: function () { return '2026-10-17'; }, _esc: function (s) { return String(s == null ? '' : s); } }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(extractStore(appSrc), sb);
  sb.App._store = sb.store;
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  const a = invSrc.indexOf('function psWageRate');
  const b = invSrc.indexOf('function renderPayroll');
  if (a === -1 || b === -1 || b <= a) throw new Error('ps gross slice not found');
  vm.runInContext(invSrc.slice(a, b), sb);
  function completion(date, hours, amount) {
    return { date: date, type: 'hourly', hours: hours, amount: String(amount), note: 'Dispatch: Aecon · foreman + travel = ' + hours + 'h', loads: 0 };
  }
  sb.App._store.set('rev_entries', [
    completion('2026-10-01', 10.5, 304.50), completion('2026-10-02', 11, 319.00),
    completion('2026-10-03', 9, 261.00), completion('2026-10-05', 10.5, 304.50),
    completion('2026-10-06', 11.5, 333.50), completion('2026-10-07', 11.5, 333.50),
    completion('2026-10-08', 12.5, 362.50), completion('2026-10-09', 14.5, 420.50),
    completion('2026-10-13', 11.5, 333.50), completion('2026-10-14', 10.5, 304.50),
    completion('2026-10-15', 11.5, 333.50)
  ]);
  /* His stored shape TODAY (setup in October): rates never split. */
  const before = sb.psPeriodGross({ payStandard: 'Hourly', payRate: '29', billingRate: '', ownWageRate: '' }, '2026-10-01', '2026-10-15');
  eq(before.hours, 124.5, 'stub gross: 124.5 hours (his real Oct 1–15)');
  eq(before.gross, 3610.50, 'stub gross BEFORE any v137 save: $3,610.50 — unchanged');
  /* The shape AFTER his first v137 Preferences save (the wage
     field showed 29 and wrote it to ownWageRate). */
  const after = sb.psPeriodGross({ payStandard: 'Hourly', payRate: '29', billingRate: '', ownWageRate: '29' }, '2026-10-01', '2026-10-15');
  eq(after.gross, 3610.50, 'stub gross AFTER a v137 save: $3,610.50 — byte-identical');
  /* And the wage field is genuinely the live one when he splits. */
  const split = sb.psPeriodGross({ payStandard: 'Hourly', payRate: '29', billingRate: '52', ownWageRate: '31' }, '2026-10-01', '2026-10-15');
  eq(split.gross, 3859.50, 'split setup: the stub prices at HIS wage rate ($31), never the billing rate ($52)');
}
/* Every own-books reader carries the wage chain; no bare payRate
   read survives outside a chain (comments stripped by line rule). */
{
  function codeLines(src) {
    let inBlock = false;
    return src.split('\n').filter(function (ln) {
      const t = ln.trim();
      if (inBlock) { if (t.indexOf('*/') >= 0) inBlock = false; return false; }
      if (t.indexOf('/*') === 0) { if (t.indexOf('*/') < 0) inBlock = true; return false; }
      if (t.indexOf('//') === 0 || t.indexOf('*') === 0) return false;
      return true;
    }).join('\n');
  }
  const readers = {
    'modules/invoice.js': invSrc,
    'modules/dispatch.js': read('modules/dispatch.js'),
    'modules/manifest.js': read('modules/manifest.js'),
    'modules/revenue.js': read('modules/revenue.js'),
    'modules/pnl.js': read('modules/pnl.js'),
    'js/chatbot.js': read('js/chatbot.js'),
    'js/connectpipe.js': read('js/connectpipe.js'),
    'modules/preferences.js': prefSrc
  };
  Object.keys(readers).forEach(function (f) {
    const bad = codeLines(readers[f]).split('\n').filter(function (ln) {
      return ln.indexOf('.payRate') >= 0 && ln.indexOf('ownWageRate') < 0;
    });
    eq(bad.length, 0, f + ': every payRate read rides the ownWageRate chain (no universal-rate reader left)');
  });
  has('the ONE remaining payRate writer is the setup flow itself (by design)', appSrc, "if (g('ob_rate')) o.payRate = g('ob_rate');");
  /* Billing chain: billing || wage || setup, in both readers.
     PNL-REVENUE-RATE SUPERSESSION (owner, Oct 21, 2026 15:33
     MDT): the Connect pipe's client rate lost its wage middle —
     a wage value must never price revenue, so pricingFor reads
     the stored company rate ALONE (the fallback behind the
     job's own rate). The dispatch completion chain is untouched
     by that ruling (the v52 plan routes by role; jobRate wins
     inside it) and keeps its v137 shape. */
  has('dispatch completion: billing chain carries the wage middle', read('modules/dispatch.js'),
    'parseFloat(o.billingRate) || parseFloat(o.ownWageRate) || parseFloat(o.payRate)');
  has('connect pipe: client rate is the stored company rate ALONE (PNL-REVENUE-RATE — no wage fallback prices revenue)', read('js/connectpipe.js'),
    'out.clientRate = parseFloat(o.billingRate) || 0;');
  hasnt('connect pipe: the wage-middle client chain is GONE', read('js/connectpipe.js'),
    'out.clientRate = parseFloat(o.billingRate) || parseFloat(o.ownWageRate)');
  /* Crew rates lived in P&L until v198 (PNL-CLEAN-2, owner
     Oct 20 19:53 reaffirmed Oct 21 09:17): the per-driver
     pay-rate surface is OFF the P&L face — P&L is the Monthly
     analysis only; a driver's wage is set on the driver's own
     side and crosses via Connect. Pin the absence. */
  const pnlSrc = read('modules/pnl.js');
  ok('P&L: NO per-driver pay-rate surface remains (v198)', pnlSrc.indexOf('Setting the pay rate for ') === -1 && pnlSrc.indexOf('id="pnl_dadd"') === -1);
  has('P&L: driver entries carry their own rate', pnlSrc, 'money(parseFloat(d.rate) || 0)');
  has('connect pipe: crew wages price from the pnl_drivers entry, never Preferences', read('js/connectpipe.js'),
    "rate: parseFloat(d.rate) || 0");
}

/* ================= 7. The name scrub ================= */
console.log('— 7. The owner\'s name appears NOWHERE in shipped source —');
{
  const files = [];
  fs.readdirSync(path.join(ROOT, 'modules')).forEach(function (f) { if (/\.js$/.test(f)) files.push('modules/' + f); });
  fs.readdirSync(path.join(ROOT, 'js')).forEach(function (f) { if (/\.js$/.test(f)) files.push('js/' + f); });
  files.push('index.html');
  files.forEach(function (f) {
    ok(!/\bAsjad\b/.test(read(f)), 'no owner name in ' + f);
  });
  has('Connect search placeholder is generic now', read('modules/connect.js'), 'placeholder="e.g. a person or business"');
  has('the mandated generic travel note ships in Preferences', prefSrc,
    'Fixed daily bonus added to foreman ticket hours — for example 1 h, some drivers 1.5 h.');
}

console.log('\npreferences-v137: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
