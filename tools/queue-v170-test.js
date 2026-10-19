#!/usr/bin/env node
/* Meticulous v170 — "PTI — FINGER SIGNATURE PAD" suite (owner,
 * Oct 19, 2026 06:55 MDT, Motive's Sign Logs screen as the
 * reference): signing a PTI takes a DRAWN signature — a
 * touch pad (certify text + drawable box + Clear) in the form's
 * Sign & file card and in the unsigned report's sign card. The
 * drawing rides the filed report, shows on the report face, and
 * prints on the PDF (MetPdf gains an embedded-JPEG 'sigimg'
 * line). Printed name + attestation stay. Reports filed before
 * the pad stay signed as filed — nothing is retro-unsigned.
 *
 * Run: node tools/queue-v170-test.js
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
const SIGURL = 'data:image/jpeg;base64,SIGBYTES';
/* a real 1x1 white JPEG, for the PDF embed */
const JPEG_B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AvwEf/9k=';
const JPEGURL = 'data:image/jpeg;base64,' + JPEG_B64;

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
function makeWorld(seed) {
  const store = memStore(seed);
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
function drawOn(body, prefix) {
  const cv = body.querySelector('#' + prefix + '_sig');
  cv.fire('pointerdown', { clientX: 10, clientY: 10, pointerId: 1, preventDefault: function () {} });
  cv.fire('pointermove', { clientX: 60, clientY: 30, preventDefault: function () {} });
  cv.fire('pointermove', { clientX: 120, clientY: 20, preventDefault: function () {} });
  cv.fire('pointerup', { pointerId: 1 });
}

/* ---- A: the report carries the drawing ---- */
{
  const w = makeWorld({});
  const items = {};
  w.pti._sched1.forEach(function (it) { items[it.id] = { r: 'ok' }; });
  const rep = w.pti._buildReport({ items: items, odo: '500', sig: JPEGURL, driverNameEffective: 'Test Driver' }, Date.now());
  eq('A1 the drawn signature rides the filed report', rep.signature, JPEGURL);
  const v = w.pti._validate({ items: items, odo: '500', driverNameEffective: 'Test Driver', sig: '' });
  ok('A2 no drawing → filing refuses with the pad words', v.indexOf('Draw your signature') !== -1, v);
  const lines = w.pti._reportLines(rep);
  const sigLines = lines.filter(function (l) { return l.k === 'sigimg'; });
  eq('A3 the PDF lines carry the signature image at the pad\u2019s aspect',
    sigLines.length === 1 && sigLines[0].img.iw === 660 && sigLines[0].img.ih === 220 &&
    sigLines[0].img.b64 === JPEG_B64, true);
  const prePad = Object.assign({}, rep, { signature: '' });
  eq('A4 a pre-pad report prints with no image line (as filed)',
    w.pti._reportLines(prePad).filter(function (l) { return l.k === 'sigimg'; }).length, 0);
}

/* ---- B: MetPdf embeds the JPEG ---- */
{
  const sb = { window: {}, console: console };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(read('js/pdfexport.js'), sb);
  const out = sb.MetPdf.buildPdf({ title: 'PTI', lines: [
    { k: 'title', a: 'INSPECTION' },
    { k: 'kv', a: 'Signed', b: 'Test Driver' },
    { k: 'sigimg', img: { b64: JPEG_B64, iw: 660, ih: 220 } }
  ]});
  eq('B1 the build reports one embedded image', out.images, 1);
  const asText = Buffer.from(out.bytes).toString('latin1');
  ok('B2 the PDF carries a DCTDecode image XObject placed with /Im0',
    asText.indexOf('/Subtype /Image') !== -1 && asText.indexOf('/DCTDecode') !== -1 &&
    asText.indexOf('/Im0') !== -1 && asText.indexOf(' Do Q') !== -1);
  ok('B3 the JPEG bytes ride the file (SOI marker present)',
    asText.indexOf('\xff\xd8\xff') !== -1);
  const plain = sb.MetPdf.buildPdf({ title: 'X', lines: [{ k: 'p', a: 'hello' }] });
  eq('B4 documents without a signature are unchanged', plain.images, 0);
}

/* ---- C: the form pad — draw, draft, clear ---- */
{
  const w = makeWorld({ onboarding: { firstName: 'Test', lastName: 'Driver' } });
  const body = new FakeEl('body');
  w.pti.render(body);
  ok('C1 the Sign & file card carries the drawable pad + Clear',
    body._html.indexOf('id="pti_sig"') !== -1 && body._html.indexOf('pti_sig_clear') !== -1 &&
    body._html.indexOf('draw it with your finger') !== -1);
  drawOn(body, 'pti');
  eq('C2 a finished stroke saves the drawing onto the draft',
    (w.store._data.pti_draft || {}).sig, SIGURL);
  body.querySelector('#pti_sig_clear').onclick();
  eq('C3 Clear wipes the drawing', (w.store._data.pti_draft || {}).sig, '');
}

/* ---- D: the sign prompt opens the pad ---- */
{
  const now = Date.now();
  const w = makeWorld({ onboarding: { firstName: 'Test', lastName: 'Driver' }, pti_reports: [{
    id: 'u1', schedule: 'Schedule 1', kind: 'pre', signed: false, signedAt: 0, signedName: '',
    filedAt: now - 86400000, date: dstr(-1), carrier: 'C', carrierAddr: '', unit: '07', plate: '',
    location: '', lat: null, lng: null, odometer: 1000, items: {}, defects: [], result: 'pass',
    driverName: 'Test Driver', attestation: 'x', signature: ''
  }]});
  const body = new FakeEl('body');
  w.pti.render(body);
  const rows = body.querySelectorAll('[data-pti-open]');
  rows[0].onclick();
  ok('D1 the unsigned report\u2019s sign card opens the pad',
    body._html.indexOf('id="pti2_sig"') !== -1 && body._html.indexOf('Sign this inspection') !== -1);
  drawOn(body, 'pti2');
  body.querySelector('#pti_sign_name').value = 'Test Driver';
  body.querySelector('#pti_sign').onclick();
  const after = w.store._data.pti_reports[0];
  ok('D2 signing stores the drawn signature with the stamp',
    after.signed === true && after.signature === SIGURL && after.signedAt >= now - 1000);
  ok('D3 the filed report face shows the signature image',
    body._html.indexOf('src="' + SIGURL + '"') !== -1);
}

console.log('\nqueue-v170 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
