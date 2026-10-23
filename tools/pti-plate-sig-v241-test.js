#!/usr/bin/env node
/* Meticulous v241 — PTI-PLATE-SAVE + PTI-SIGNATURE-SAVE (owner,
 * Oct 22, 2026 17:36 MDT, his PTI screen recording): the filed
 * report carried NEITHER the plate nor the drawn signature —
 * only the printed name.
 *
 * Root causes pinned by this suite:
 *  PLATE — profile().plate reads onboarding.plate / .plateNo,
 *  but NOTHING in the app ever wrote either (onboarding asks the
 *  truck number only; Preferences edited the truck number only),
 *  so the PTI plate field pre-filled blank forever, and a blank
 *  harvest at filing stored ''. The fix: Preferences gains the
 *  Licence plate field on the Truck card (set-once, like the
 *  truck number); filing resolves the plate as typed -> draft ->
 *  profile (never blank when the truck record carries one); and
 *  a plate filed with a report is written back onto the truck
 *  record, so typing it once — anywhere — makes it stick.
 *  SIGNATURE — the in-app path (pad -> draft -> buildReport ->
 *  store) is sound in isolation (the v170 suite proves it). The
 *  persistence hole: fileInspection ignored the store write's
 *  result — on a full phone the reports write fails silently
 *  (App._store.set returns false, v48) while the draft is wiped
 *  and the flow sails on, so the filing (signature and all) is
 *  simply gone. The fix verifies the write the way Fuel's
 *  saveFillsVerified does: a failed save keeps the draft whole
 *  and says so on the form — never a silent loss. (The sync-side
 *  rollback vector is covered by cloudsync-record-union-v241.)
 *
 * Run: node tools/pti-plate-sig-v241-test.js
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

const SIGURL = 'data:image/jpeg;base64,SIGBYTES';
function memStore(seed, failKeys) {
  const data = JSON.parse(JSON.stringify(seed || {}));
  return {
    _data: data,
    get: function (k, d) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : d; },
    set: function (k, v) {
      if (failKeys && failKeys[k]) return false; /* storage full: the write does not land */
      data[k] = JSON.parse(JSON.stringify(v)); return true;
    },
    del: function (k) { delete data[k]; }
  };
}
function FakeCtx() {
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '',
    fillRect: function () {}, beginPath: function () {}, moveTo: function () {},
    lineTo: function () {}, stroke: function () {}, drawImage: function () {}
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
  set: function (v) { this._html = String(v); this._kids = {}; this._attrKids = {}; }
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
FakeEl.prototype.fire = function (type, ev) {
  (this._listeners[type] || []).forEach(function (fn) { fn(ev || {}); });
};
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };
FakeEl.prototype.getContext = function () { return FakeCtx(); };
FakeEl.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: 660, height: 220 }; };
FakeEl.prototype.toDataURL = function () { return SIGURL; };
FakeEl.prototype.setPointerCapture = function () {};

function dstr(daysFromToday) {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth(), n.getDate() + daysFromToday, 12);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function makeWorld(seed, failKeys) {
  const store = memStore(seed, failKeys);
  const sb = {
    window: {}, Meticulous: { modules: {} }, console: console,
    Image: function () { return {}; },
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
function fullDraft(pti, sig) {
  const items = {};
  pti._sched1.forEach(function (it) { items[it.id] = { r: 'ok' }; });
  return { items: items, odo: '170079', carrier: null, carrierAddr: null, unit: null,
    plate: null, loc: '', driver: null, lat: null, lng: null, kind: 'pre', sig: sig || '' };
}
function drawOn(body, prefix) {
  const cv = body.querySelector('#' + prefix + '_sig');
  cv.fire('pointerdown', { clientX: 10, clientY: 10, pointerId: 1, preventDefault: function () {} });
  cv.fire('pointermove', { clientX: 60, clientY: 30, preventDefault: function () {} });
  cv.fire('pointerup', { pointerId: 1 });
}
function fileFromForm(w, plateInputValue) {
  const body = new FakeEl('body');
  w.pti.render(body);
  body.querySelector('#pti_odo').value = '170079';
  if (plateInputValue !== undefined) body.querySelector('#pti_plate').value = plateInputValue;
  body.querySelector('#pti_file').onclick();
  return body;
}

/* ---- A: PLATE — Preferences carries it (source pins) ---- */
{
  const pref = read('modules/preferences.js');
  ok('A1 the Truck card has a Licence plate field', pref.indexOf('id="pf_plate"') !== -1);
  ok('A2 the Preferences save writes onboarding.plate (guarded like the truck number)',
    /o\.plate\s*=\s*g\('pf_plate'\)/.test(pref));
}

/* ---- B: PLATE — typed once on a PTI, it sticks to the truck record ---- */
{
  const w = makeWorld({ onboarding: { firstName: 'Asjad', lastName: 'Kamal', truckNo: '07' } });
  w.store.set('pti_draft', fullDraft(w.pti, SIGURL));
  const body = fileFromForm(w, '04 R209');
  const reps = w.store._data.pti_reports || [];
  eq('B1 the typed plate rides the filed report', reps.length && reps[0].plate, '04 R209');
  eq('B2 the filed plate is written back onto the truck record',
    (w.store._data.onboarding || {}).plate, '04 R209');
  const body2 = new FakeEl('body');
  w.pti.render(body2); /* lands on the just-filed report face */
  body2.querySelector('#pti_back').onclick(); /* back to a fresh form */
  ok('B3 the next PTI pre-fills the plate from the truck record',
    body2._html.indexOf('id="pti_plate" value="04 R209"') !== -1,
    body2._html.slice(body2._html.indexOf('pti_plate') - 60, body2._html.indexOf('pti_plate') + 60));
}

/* ---- C: PLATE — never blank when the truck record carries one ---- */
{
  const w = makeWorld({ onboarding: { firstName: 'Asjad', lastName: 'Kamal', truckNo: '07', plate: '04 R209' } });
  w.store.set('pti_draft', fullDraft(w.pti, SIGURL));
  fileFromForm(w, ''); /* the input reached filing blank; the profile must still land */
  const reps = w.store._data.pti_reports || [];
  eq('C1 a blank plate input cannot blank the filed plate', reps.length && reps[0].plate, '04 R209');
}

/* ---- D: SIGNATURE — draw on the real pad, file, it persists ---- */
{
  const w = makeWorld({ onboarding: { firstName: 'Asjad', lastName: 'Kamal', truckNo: '07', plate: '04 R209' } });
  w.store.set('pti_draft', fullDraft(w.pti, ''));
  const body = new FakeEl('body');
  w.pti.render(body);
  drawOn(body, 'pti');
  body.querySelector('#pti_odo').value = '170079';
  body.querySelector('#pti_file').onclick();
  const reps = w.store._data.pti_reports || [];
  eq('D1 the drawn signature persists on the filed report', reps.length && reps[0].signature, SIGURL);
  ok('D2 the filed report face shows the signature image',
    body._html.indexOf('src="' + SIGURL + '"') !== -1);
  const lines = w.pti._reportLines(reps[0]);
  ok('D3 the PDF lines carry the signature image',
    lines.some(function (l) { return l.k === 'sigimg'; }));
}

/* ---- E: SIGNATURE — a failed store write is never silent ---- */
{
  const w = makeWorld({ onboarding: { firstName: 'Asjad', lastName: 'Kamal' } }, { pti_reports: true });
  w.store.set('pti_draft', fullDraft(w.pti, SIGURL));
  const body = fileFromForm(w, '04 R209');
  ok('E1 a failed save says so on the form (no silent loss)',
    body._html.indexOf('did NOT save') !== -1, body._html.slice(0, 200));
  eq('E2 the draft — signature and all — survives a failed save',
    (w.store._data.pti_draft || {}).sig, SIGURL);
  ok('E3 no phantom filed view after a failed save',
    body._html.indexOf('✅ Filed') === -1);
}

/* ---- F: SIGN-LATER — a failed write-back is never silent either ---- */
{
  const now = Date.now();
  const w = makeWorld({ onboarding: { firstName: 'Asjad', lastName: 'Kamal' }, pti_reports: [{
    id: 'u1', schedule: 'Schedule 1', kind: 'pre', signed: false, signedAt: 0, signedName: '',
    filedAt: now - 86400000, date: dstr(-1), carrier: 'C', carrierAddr: '', unit: '07', plate: '04 R209',
    location: '', lat: null, lng: null, odometer: 1000, items: {}, defects: [], result: 'pass',
    driverName: 'Asjad Kamal', attestation: 'x', signature: ''
  }] }, { pti_reports: true });
  const body = new FakeEl('body');
  w.pti.render(body);
  const rows = body.querySelectorAll('[data-pti-open]');
  rows[0].onclick();
  drawOn(body, 'pti2');
  body.querySelector('#pti_sign_name').value = 'Asjad Kamal';
  body.querySelector('#pti_sign').onclick();
  const errEl = body.querySelector('#pti_sign_err');
  ok('F1 the sign-later failure surfaces in the sign card',
    (errEl._html || errEl.textContent || '').indexOf('did NOT save') !== -1 ||
    body._html.indexOf('did NOT save') !== -1);
}

console.log('\npti-plate-sig-v241 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
