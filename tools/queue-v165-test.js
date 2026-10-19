#!/usr/bin/env node
/* Meticulous v165 — PTI COMPLETION suite (owner, Oct 18, 2026
 * 21:48 MDT): the module's face name is PTI; the form carries a
 * Pre-trip / Post-trip choice (default Pre-trip); DOT Inspection
 * Mode hands an officer the last 14 days ONLY with the rest of
 * the app locked behind the driver's PIN; the dashboard card is
 * the compliance badge (unsigned inspections + days without a
 * pre-trip), unsigned reports keep asking to be signed, and a
 * day-close with no PTI on file says so.
 *
 * Run: node tools/queue-v165-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function memStore(seed) {
  const data = JSON.parse(JSON.stringify(seed || {}));
  return {
    _data: data,
    get: function (k, d) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : d; },
    set: function (k, v) { data[k] = v; return true; },
    del: function (k) { delete data[k]; }
  };
}
function FakeEl(sel) {
  this._sel = sel || ''; this._kids = {}; this._html = '';
  this.value = ''; this.textContent = ''; this.style = {}; this.files = [];
  this.onclick = null; this._listeners = {}; this.options = [{ text: '' }]; this.selectedIndex = 0;
  this.classList = { add: function () {}, remove: function () {}, toggle: function () {} };
}
Object.defineProperty(FakeEl.prototype, 'innerHTML', {
  get: function () { return this._html; },
  set: function (v) { this._html = String(v); this._kids = {}; }
});
FakeEl.prototype.querySelector = function (sel) {
  return this._kids[sel] || (this._kids[sel] = new FakeEl(sel));
};
FakeEl.prototype.querySelectorAll = function (sel) {
  const html = this._html || '';
  const out = [];
  const re = new RegExp(sel.replace(/[[\]]/g, '') + '="([^"]*)"', 'g');
  this._attrKids = this._attrKids || {};
  let m;
  while ((m = re.exec(html))) {
    const key = sel + '=' + m[1];
    if (!this._attrKids[key]) {
      const el = new FakeEl(sel);
      el.getAttribute = (function (v) { return function () { return v; }; })(m[1]);
      this._attrKids[key] = el;
    }
    out.push(this._attrKids[key]);
  }
  return out;
};
FakeEl.prototype.addEventListener = function (type, fn) {
  (this._listeners[type] = this._listeners[type] || []).push(fn);
};
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };

function dstr(daysFromToday, hour) {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth(), n.getDate() + daysFromToday, hour || 12);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function rep(id, date, filedAt, extra) {
  return Object.assign({
    id: id, schedule: 'Schedule 1', kind: 'pre', signed: true, signedAt: filedAt, signedName: 'Test Driver',
    filedAt: filedAt, date: date, carrier: 'C', carrierAddr: '', unit: '07', plate: '',
    location: '', lat: null, lng: null, odometer: 1000, items: {}, defects: [], result: 'pass',
    driverName: 'Test Driver', attestation: 'x'
  }, extra || {});
}

function makeWorld(seed) {
  const store = memStore(seed);
  const sb = {
    window: {}, Meticulous: { modules: {} }, console: console,
    App: {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s); },
      _today: function () { return dstr(0); },
      _wirePhotoOCR: null, _bumpOdometer: function () { return {}; }
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(read('modules/pti.js'), sb);
  return { sb: sb, store: store, pti: sb.Meticulous.modules.pti };
}

/* ---- A: kind + signed on the built report ---- */
{
  const w = makeWorld({});
  const items = {};
  w.pti._sched1.forEach(function (it) { items[it.id] = { r: 'ok' }; });
  const pre = w.pti._buildReport({ items: items, odo: '500', driverNameEffective: 'Test Driver' }, Date.now());
  eq('A1 a filing defaults to Pre-trip', pre.kind, 'pre');
  eq('A2 a filing is signed at filing (the attestation tap is the signature)',
    [pre.signed, pre.signedName], [true, 'Test Driver']);
  const post = w.pti._buildReport({ items: items, odo: '500', kind: 'post', driverNameEffective: 'Test Driver' }, Date.now());
  eq('A3 the Post-trip choice rides the report', post.kind, 'post');
  eq('A4 kind labels read plainly', [w.pti._kindOf(post), w.pti._kindOf({})], ['post', 'pre']);
  const lines = w.pti._reportLines(post);
  ok('A5 the printed report names the kind', JSON.stringify(lines).indexOf('POST-TRIP') !== -1);
  const unsignedLines = w.pti._reportLines(Object.assign({}, pre, { signed: false }));
  ok('A6 an unsigned report prints NOT SIGNED', JSON.stringify(unsignedLines).indexOf('NOT SIGNED') !== -1);
}

/* ---- B: compliance badge + DOT window ---- */
{
  const now = Date.now();
  const seed = { pti_reports: [
    rep('r-old', dstr(-20), now - 20 * 86400000),
    rep('r-3', dstr(-3), now - 3 * 86400000),
    rep('r-2post', dstr(-2), now - 2 * 86400000, { kind: 'post' }),
    rep('r-1unsigned', dstr(-1), now - 86400000, { signed: false, signedAt: 0, signedName: '' })
  ]};
  const w = makeWorld(seed);
  const dot = w.pti._dotReports();
  eq('B1 the officer sees the last 14 days only (the 20-day-old report stays home)',
    dot.map(function (r) { return r.id; }), ['r-1unsigned', 'r-2post', 'r-3']);
  const c = w.pti._compliance();
  eq('B2 compliance counts the unsigned report', c.unsigned, 1);
  /* window back to the first filing (20 days ago) capped at 14:
     days -14..-1 with pre-trips on -3 and -1 → 12 gap days; the
     post-trip day (-2) does not clear a pre-trip gap */
  eq('B3 gap days count pre-trips only, back to the first filing', c.gaps, 12);
  ok('B4 the badge names what is owed', w.pti.status().indexOf('⚠ 1 unsigned') !== -1 &&
    w.pti.status().indexOf('12 days without a pre-trip (14d)') !== -1, w.pti.status());
  const clean = makeWorld({ pti_reports: [rep('t', dstr(0), Date.now())] });
  eq('B5 a filed-and-signed today reads clean (no false nag)', clean.pti.status(), 'Today: filed ✓ no defects');
  const empty = makeWorld({});
  eq('B6 no history at all: no gap nag, just not-filed', empty.pti.status(), 'Today: not filed yet');
}

/* ---- C: DOT lock — render, PIN set, wrong PIN, exit ---- */
{
  const now = Date.now();
  const w = makeWorld({ pti_reports: [rep('t', dstr(0), now), rep('old', dstr(-30), now - 30 * 86400000)] });
  const body = new FakeEl('body');
  w.pti.render(body);
  ok('C1 the form offers DOT Inspection Mode + a PIN set on first entry',
    body._html.indexOf('DOT Inspection Mode') !== -1 && body._html.indexOf('pti_dot_set') !== -1);
  const pin1 = body.querySelector('#pti_dot_newpin'); pin1.value = '4321';
  body.querySelector('#pti_dot_newpin2').value = '4321';
  body._kids['#pti_dot_set'].onclick();
  eq('C2 the PIN is stored hashed, never in plain sight',
    [!!w.store._data.pti_dot.pinHash, JSON.stringify(w.store._data).indexOf('4321') === -1], [true, true]);
  ok('C3 in Inspection Mode the paint is the officer list — no form, no checklist',
    body._html.indexOf('Vehicle Inspection Reports') !== -1 &&
    body._html.indexOf('Schedule 1 checklist') === -1 && body._html.indexOf('pti_file') === -1);
  ok('C4 the officer list hides the 30-day-old report', body._html.indexOf(dstr(-30)) === -1);
  const pinEl = body.querySelector('#pti_dot_pin'); pinEl.value = '0000';
  body._kids['#pti_dot_exit'].onclick();
  ok('C5 a wrong PIN keeps the app locked', w.pti._dotActive() === true &&
    body._html.indexOf('doesn’t match') !== -1);
  body.querySelector('#pti_dot_pin').value = '4321';
  body._kids['#pti_dot_exit'].onclick();
  ok('C6 the right PIN unlocks back to the form', w.pti._dotActive() === false &&
    body._html.indexOf('Schedule 1 checklist') !== -1);
}

/* ---- D: the sign flow for an unsigned report ---- */
{
  const now = Date.now();
  const w = makeWorld({ onboarding: { firstName: 'Test', lastName: 'Driver' },
    pti_reports: [rep('u', dstr(-1), now - 86400000, { signed: false, signedAt: 0, signedName: '' })] });
  const body = new FakeEl('body');
  w.pti.render(body);
  ok('D1 the form keeps asking: an unsigned-inspection prompt card leads',
    body._html.indexOf('not signed yet') !== -1);
  const rows = body.querySelectorAll('[data-pti-open]');
  eq('D2 the unsigned report is one tap away', rows.length >= 1, true);
  rows[0].onclick();
  ok('D3 its report view carries the sign card', body._html.indexOf('pti_sign') !== -1 &&
    body._html.indexOf('NOT SIGNED') !== -1);
  body.querySelector('#pti_sign_name').value = 'Test Driver';
  body._kids['#pti_sign'].onclick();
  /* v170 supersedes the tap-only sign: the pad is required — with
     no drawing the sign REFUSES (the full drawn-sign flow is
     covered by tools/queue-v170-test.js with a canvas harness). */
  ok('D4 without a drawn signature the sign refuses (v170 pad law)',
    w.store._data.pti_reports[0].signed === false &&
    (body._kids['#pti_sign_err']._html || '').indexOf('Draw your signature') !== -1);
  eq('D5 and the badge still counts it unsigned', w.pti.status().indexOf('⚠ 1 unsigned') !== -1, true);
}

/* ---- E: shell lock + close prompt (source) ---- */
{
  const appSrc = read('js/app.js');
  ok('E1 the shell routes non-PTI opens back to PTI while locked',
    appSrc.indexOf("if (key !== 'pti' && dotLockActive()) key = 'pti';") !== -1);
  ok('E2 the dashboard itself is behind the lock',
    appSrc.indexOf('if (dotLockActive()) { App.openModule(\'pti\'); return; }') !== -1);
  ok('E3 the module face name is PTI everywhere',
    /pti:\s*\{\s*title: 'PTI'/.test(appSrc) && appSrc.indexOf("['pti', '🔍', 'PTI']") !== -1);
  const dspSrc = read('modules/dispatch.js');
  ok('E4 a day-close with no PTI on file says so (never blocks the close)',
    dspSrc.indexOf('No PTI filed for ') !== -1 && dspSrc.indexOf("App._store.get('pti_reports', [])") !== -1);
  const cpSrc = read('js/connectpipe.js');
  ok('E5 the shared PTI record carries kind + signed',
    cpSrc.indexOf("kind: r.kind === 'post' ? 'post' : 'pre'") !== -1 && cpSrc.indexOf('signed: !!r.signed') !== -1);
  const ptiSrc = read('modules/pti.js');
  ok('E6 the form carries the Pre/Post choice, defaulting to Pre',
    ptiSrc.indexOf('data-pti-kind="pre"') !== -1 && ptiSrc.indexOf("kind: 'pre'") !== -1);
}

console.log('\nqueue-v165 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
