#!/usr/bin/env node
/* Meticulous v274 — PTI-SIGNATURE-NOT-SAVED (owner, Oct 26, 2026
 * 18:27 MDT, his screen recording of the post-trip filing): the
 * Sign & file box opened EMPTY even though he had signed the
 * pre-trip the same morning — "Why is it not saving my signature?"
 *
 * Root cause pinned by this suite: there is NO saved-signature
 * store at all. The drawn signature lives only on the in-progress
 * draft (pti_draft.sig, v170) and on filed reports. fileInspection
 * wipes the draft to blankDraft() after every successful filing —
 * sig:'' with it — so the next form necessarily opens empty and he
 * redraws every time. v241's PTI-SIGNATURE-SAVE verified the
 * REPORTS write (a filed signature could no longer be lost
 * silently); it never gave the app a signature memory.
 *
 * The v274 law (his standing PTI law: the app saves his signature
 * like it saves his plate):
 *  - a signature that lands on a filed report (Sign & file, or the
 *    sign-later card) becomes the SAVED signature (pti_sigsave);
 *  - a FRESH form (nothing answered, no odometer yet) opens with
 *    the saved signature already in the box and in the draft —
 *    filing off it needs no redraw;
 *  - drawing again replaces it: the new drawing files, and the
 *    saved copy updates to the new drawing;
 *  - Clear stays honest: a cleared box files NOTHING (validation
 *    still demands a drawing) and the saved signature does NOT
 *    sneak back into that same in-progress form on re-render.
 *
 * Run: node tools/pti-signature-persist-v274-test.js
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
const OLDURL = 'data:image/jpeg;base64,OLDSIGBYTES';
function memStore(seed, failKeys) {
  const data = JSON.parse(JSON.stringify(seed || {}));
  return {
    _data: data,
    get: function (k, d) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : d; },
    set: function (k, v) {
      if (failKeys && failKeys[k]) return false;
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
const ONB = { firstName: 'Asjad', lastName: 'Kamal', truckNo: '07', plate: '04 R209' };
function blankDraftSeed() {
  return { items: {}, odo: '', carrier: null, carrierAddr: null, unit: null, plate: null, loc: '', driver: null, lat: null, lng: null, kind: 'pre', sig: '' };
}
function drawOn(body, prefix) {
  const cv = body.querySelector('#' + prefix + '_sig');
  cv.fire('pointerdown', { clientX: 10, clientY: 10, pointerId: 1, preventDefault: function () {} });
  cv.fire('pointermove', { clientX: 60, clientY: 30, preventDefault: function () {} });
  cv.fire('pointerup', { pointerId: 1 });
}
/* From a rendered fresh form: answer the checklist, set the dash
   reading, file. Elements are re-queried after every render. */
function completeAndFile(w, body) {
  body.querySelector('#pti_allok').onclick();
  body.querySelector('#pti_odo').value = '170079';
  body.querySelector('#pti_file').onclick();
}

/* ---- W1: THE INCIDENT — draw + file once; the NEXT form must
   open with the signature already saved ---- */
{
  const w = makeWorld({ onboarding: ONB });
  w.store.set('pti_draft', blankDraftSeed());
  const body = new FakeEl('body');
  w.pti.render(body);
  drawOn(body, 'pti');
  completeAndFile(w, body);
  const reps = w.store._data.pti_reports || [];
  eq('W1a the drawn signature rides the filed report', reps.length && reps[0].signature, SIGURL);
  eq('W1b filing SAVES the signature for next time (pti_sigsave)',
    w.store._data.pti_sigsave, SIGURL);
  body.querySelector('#pti_back').onclick(); /* back to a fresh form */
  eq('W1c the next form opens with the saved signature in the draft',
    (w.store._data.pti_draft || {}).sig, SIGURL);
  ok('W1d the next form\'s pad says Signed',
    String(body.querySelector('#pti_sig_note').textContent || '').indexOf('Signed') !== -1,
    'note=' + JSON.stringify(body.querySelector('#pti_sig_note').textContent));
}

/* ---- W2: a saved signature pre-loads a fresh form ---- */
{
  const w = makeWorld({ onboarding: ONB, pti_sigsave: OLDURL });
  const body = new FakeEl('body');
  w.pti.render(body);
  eq('W2a the fresh draft is seeded from the saved signature',
    (w.store._data.pti_draft || {}).sig, OLDURL);
  ok('W2b the pad opens marked Signed',
    String(body.querySelector('#pti_sig_note').textContent || '').indexOf('Signed') !== -1,
    'note=' + JSON.stringify(body.querySelector('#pti_sig_note').textContent));
}

/* ---- W3: file off the pre-loaded signature — no redraw ---- */
{
  const w = makeWorld({ onboarding: ONB, pti_sigsave: OLDURL });
  w.store.set('pti_draft', blankDraftSeed());
  const body = new FakeEl('body');
  w.pti.render(body);
  completeAndFile(w, body);
  const reps = w.store._data.pti_reports || [];
  eq('W3a the filing lands with no redraw', reps.length, 1);
  eq('W3b the pre-loaded signature is the one on the report',
    reps.length && reps[0].signature, OLDURL);
  eq('W3c and the report is honestly signed', reps.length && reps[0].signed, true);
}

/* ---- W4: Clear stays honest — a cleared box files nothing, and
   the saved signature does not sneak back into the SAME form ---- */
{
  const w = makeWorld({ onboarding: ONB, pti_sigsave: OLDURL });
  w.store.set('pti_draft', blankDraftSeed());
  const body = new FakeEl('body');
  w.pti.render(body);
  body.querySelector('#pti_sig_clear').onclick();
  eq('W4a Clear empties the draft signature', (w.store._data.pti_draft || {}).sig, '');
  completeAndFile(w, body);
  eq('W4b a cleared form files NOTHING', (w.store._data.pti_reports || []).length, 0);
  eq('W4c the saved signature did not sneak back on the error re-render',
    (w.store._data.pti_draft || {}).sig, '');
  eq('W4d and the saved copy itself is untouched by Clear',
    w.store._data.pti_sigsave, OLDURL);
}

/* ---- W5: drawing again replaces the saved copy ---- */
{
  const w = makeWorld({ onboarding: ONB, pti_sigsave: OLDURL });
  w.store.set('pti_draft', blankDraftSeed());
  const body = new FakeEl('body');
  w.pti.render(body);
  drawOn(body, 'pti'); /* the pad now holds the NEW drawing */
  completeAndFile(w, body);
  const reps = w.store._data.pti_reports || [];
  eq('W5a the new drawing is what files', reps.length && reps[0].signature, SIGURL);
  eq('W5b and the saved copy updates to the new drawing',
    w.store._data.pti_sigsave, SIGURL);
}

/* ---- W6: the sign-later card — pre-loaded too, and a drawing
   there updates the saved copy ---- */
{
  const unsigned = {
    id: 'pti1000', schedule: 'Schedule 1', kind: 'pre', signed: false,
    filedAt: Date.now() - 86400000, date: dstr(-1), carrier: 'Ai Trucking', carrierAddr: '',
    unit: '07', plate: '04 R209', location: '', odometer: 170000, items: {},
    defects: [], result: 'pass', driverName: 'Asjad Kamal', attestation: ''
  };
  const w = makeWorld({ onboarding: ONB, pti_sigsave: OLDURL, pti_reports: [unsigned] });
  const body = new FakeEl('body');
  w.pti.render(body);
  const rows = body.querySelectorAll('[data-pti-open]');
  rows[0].onclick(); /* open the unsigned report */
  body.querySelector('#pti_sign_name').value = 'Asjad Kamal'; /* the real input carries it */
  body.querySelector('#pti_sign').onclick(); /* sign with what the box shows */
  const reps = w.store._data.pti_reports || [];
  eq('W6a the sign-later card signs off the pre-loaded saved signature',
    reps.length && reps[0].signature, OLDURL);
  eq('W6b and the report is signed', reps.length && reps[0].signed, true);
}
{
  const unsigned = {
    id: 'pti1001', schedule: 'Schedule 1', kind: 'pre', signed: false,
    filedAt: Date.now() - 86400000, date: dstr(-1), carrier: 'Ai Trucking', carrierAddr: '',
    unit: '07', plate: '04 R209', location: '', odometer: 170000, items: {},
    defects: [], result: 'pass', driverName: 'Asjad Kamal', attestation: ''
  };
  const w = makeWorld({ onboarding: ONB, pti_reports: [unsigned] });
  const body = new FakeEl('body');
  w.pti.render(body);
  const rows = body.querySelectorAll('[data-pti-open]');
  rows[0].onclick();
  drawOn(body, 'pti2');
  body.querySelector('#pti_sign_name').value = 'Asjad Kamal';
  body.querySelector('#pti_sign').onclick();
  const reps = w.store._data.pti_reports || [];
  eq('W6c a drawing on the sign-later card is what signs',
    reps.length && reps[0].signature, SIGURL);
  eq('W6d and it becomes the saved signature', w.store._data.pti_sigsave, SIGURL);
}

console.log('\npti-signature-persist-v274: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
