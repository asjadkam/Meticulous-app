#!/usr/bin/env node
/* Meticulous v281 — Wave D (Oct 29, 2026, owner's "Fix it all" run).
 *
 * Two proofs the earlier suites did not carry:
 *
 * D1 (DSP-role, owner's FINAL shape + Oct 21 07:20 STILL-WRONG):
 * the v186 suite proved Driver-account worlds and an
 * Owner-Operator account on the BOTH face — but never the
 * brief's exact case: an OWNER-OPERATOR-type account sitting on
 * the DRIVER face (userRole 'driver'). The ruling keys off the
 * driver FACE: that world must see NO Crew today, NO Send a
 * dispatch — only "Add from a message" (+ the quiet manual
 * door). Control: the same account on the office face keeps
 * its tools.
 *
 * D8b (PTI dash-photo warning, parked sub-item of v274): he
 * tapped Sign & file with no odometer — the "⚠️ Snap the dash
 * photo…" warning landed on the form — then snapped the dash
 * and the read LANDED in the form, yet the warning stayed.
 * Driven here against the REAL modules/pti.js: sign tap with
 * an empty odometer puts the warning on the card; the shared
 * photo pipeline's persist callback (captured from
 * App._wirePhotoOCR) lands a reading; the warning must clear
 * from the live card AND never resurrect on a re-render.
 *
 * Run: node tools/wave-d-v281-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');
const dspSrc = read('modules/dispatch.js');
const ocrSrc = read('js/ticket-ocr.js');
const invSrc = read('modules/invoice.js');
const ptiSrc = read('modules/pti.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* ================= shared fake DOM (dsp-role pattern) ================= */
function FakeEl(sel) {
  this._sel = sel || '';
  this._kids = {};
  this._html = '';
  this.value = '';
  this.textContent = '';
  this.style = {};
  this.files = [];
  this.onclick = null;
  this._listeners = {};
  this.options = [{ text: '' }];
  this.selectedIndex = 0;
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
FakeEl.prototype.scrollIntoView = function () {};
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };

function FakeFileReader() {}
FakeFileReader.prototype.readAsDataURL = function () {
  const self = this;
  self.result = 'data:image/jpeg;base64,RAWDATA';
  queueMicrotask(function () { if (self.onload) self.onload(); });
};
function FakeImage() {}
Object.defineProperty(FakeImage.prototype, 'src', {
  get: function () { return ''; },
  set: function () {
    const self = this;
    self.width = 800; self.height = 600;
    queueMicrotask(function () { if (self.onload) self.onload(); });
  }
});
const docStub = {
  createElement: function (tag) {
    if (tag === 'canvas') {
      return { width: 0, height: 0,
        getContext: function () { return { drawImage: function () {} }; },
        toDataURL: function () { return 'data:image/jpeg;base64,THUMB'; } };
    }
    return new FakeEl(tag);
  },
  querySelector: function () { return null; },
  addEventListener: function () {}
};
function makeLocal() {
  const backing = { mem: {}, fail: false };
  return {
    backing: backing,
    getItem: function (k) { return (k in backing.mem) ? backing.mem[k] : null; },
    setItem: function (k, v) { backing.mem[k] = String(v); },
    removeItem: function (k) { delete backing.mem[k]; }
  };
}
function flush() {
  return new Promise(function (res) {
    let n = 0;
    (function step() { if (++n > 40) return res(); setTimeout(step, 0); })();
  });
}
function extractRegion(src, beginMark, endMark) {
  const bi = src.indexOf(beginMark), ei = src.indexOf(endMark);
  if (bi === -1 || ei === -1) throw new Error('region markers missing: ' + beginMark + ' / ' + endMark);
  return src.slice(src.lastIndexOf('/*', bi), src.indexOf('*/', ei) + 2);
}
function extractStore() {
  const i = appSrc.indexOf('var store = {');
  if (i === -1) throw new Error('store not found in js/app.js');
  let depth = 0, j = i;
  for (; j < appSrc.length; j++) {
    if (appSrc[j] === '{') depth++;
    else if (appSrc[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return appSrc.slice(i, j) + ';';
}

/* ================= D1: dispatch face worlds ================= */
function makePipe() {
  return {
    connectedPeers: function () { return [{ uid: 'u-drv', name: 'A Driver', face: 'driver' }]; },
    dateShift: function (d) { return d; },
    pullInbox: function () { return Promise.resolve(0); },
    markSeen: function () {},
    fetchCrew: function () { return Promise.resolve([]); },
    fetchRecords: function () { return Promise.resolve({ records: {}, billing: {} }); },
    listSent: function () { return Promise.resolve([]); }
  };
}
function makeDspWorld(opts) {
  const local = makeLocal();
  const sb = {
    console: console, document: docStub, localStorage: local,
    FileReader: FakeFileReader, Image: FakeImage, setTimeout: setTimeout,
    alert: function () {},
    confirm: function () { return true; },
    Meticulous: { modules: {} }
  };
  sb.window = sb;
  sb.App = {
    _store: null,
    _today: function () { return '2026-10-21'; },
    _esc: function (s) { return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    userRole: function () { return opts.role || 'driver'; },
    openModule: function () {}
  };
  sb.ConnectPipe = makePipe();
  vm.createContext(sb);
  vm.runInContext(extractStore(), sb);
  sb.App._store = sb.store;
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(dspSrc, sb);
  sb.store.set('onboarding', { accountType: opts.accountType, userRole: opts.role, firstName: 'Asjad', lastName: 'Kamal' });
  sb.store.set('dsp_list', []);
  sb.store.set('dsp_active', null);
  const body = new FakeEl('body');
  return { sb: sb, body: body,
    render: function () { sb.Meticulous.modules.dispatch.render(body); } };
}

/* ================= D8b: PTI world ================= */
function makeStore(seed) {
  const data = {};
  Object.keys(seed || {}).forEach(function (k) { data[k] = JSON.parse(JSON.stringify(seed[k])); });
  return {
    get: function (k, d) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : d; },
    set: function (k, v) { data[k] = JSON.parse(JSON.stringify(v)); },
    _data: data
  };
}
/* A body whose #pti_err element mirrors what render() paints into
   it — the live card's warning line, as the phone would show it. */
function makePtiBody() {
  const body = new FakeEl('body');
  const errEl = new FakeEl('#pti_err');
  const fileBtn = new FakeEl('#pti_file');
  const odoEl = new FakeEl('#pti_odo'); odoEl.value = '';
  const kids = { '#pti_err': errEl, '#pti_file': fileBtn, '#pti_odo': odoEl };
  body.querySelector = function (sel) { return kids[sel] || null; };
  body.querySelectorAll = function () { return []; };
  Object.defineProperty(body, 'innerHTML', {
    get: function () { return this._html; },
    set: function (v) {
      this._html = String(v);
      errEl.innerHTML = (this._html.indexOf('Snap the dash photo to capture') !== -1)
        ? '⚠️ Snap the dash photo to capture the odometer first — the inspection needs its reading.'
        : '';
    }
  });
  return { body: body, errEl: errEl, fileBtn: fileBtn, odoEl: odoEl };
}

(async function () {
  console.log('— D1: Owner-Operator account ON the driver face (his exact case) —');
  {
    const w = makeDspWorld({ accountType: 'Owner-Operator', role: 'driver' });
    w.render(); await flush();
    const h = w.body._html;
    ok('OO acct + driver face: NO Crew today card', h.indexOf('Crew today') === -1);
    ok('OO acct + driver face: NO Send a dispatch card', h.indexOf('Send a dispatch') === -1);
    ok('OO acct + driver face: NO dp_crew / dp_send containers',
      h.indexOf('id="dp_crew"') === -1 && h.indexOf('id="dp_send"') === -1);
    ok('OO acct + driver face: Add-from-a-message door stands', h.indexOf('id="dp_ingest"') !== -1);
    ok('OO acct + driver face: the form sits behind the quiet door', h.indexOf('id="dp_form_door"') !== -1);
  }
  {
    const w = makeDspWorld({ accountType: 'Owner-Operator', role: 'office' });
    w.render(); await flush();
    const h = w.body._html;
    ok('control — OO acct + office face: Crew today stands', h.indexOf('Crew today') !== -1);
    ok('control — OO acct + office face: Send a dispatch stands', h.indexOf('Send a dispatch') !== -1);
  }

  console.log('— D8b: the dash-photo warning clears when the read lands —');
  {
    const store = makeStore({
      onboarding: { firstName: 'Asjad', lastName: 'Kamal', truckNo: '07', plate: '04 R209' }
    });
    let ocrPersist = null;
    const sb = { console: console, Date: Date, Meticulous: { modules: {} }, window: {} };
    sb.window = sb;
    sb.App = {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
      _today: function () { return '2026-10-29'; },
      _wirePhotoOCR: function (prefix, kind, persistFn) { ocrPersist = persistFn; },
      _bumpOdometer: function () {},
      userRole: function () { return 'driver'; }
    };
    vm.createContext(sb);
    vm.runInContext(ptiSrc, sb);
    const PTI = sb.Meticulous.modules.pti;
    ok('pti module registers', !!PTI);

    const w = makePtiBody();
    PTI.render(w.body);
    ok('the dash-photo pipeline was wired', typeof ocrPersist === 'function');
    ok('fresh form: no warning on the card', w.errEl.innerHTML === '');
    /* he taps Sign & file with no odometer — the warning lands */
    w.fileBtn.onclick();
    ok('sign tap with no odometer: the warning is on the card',
      w.errEl.innerHTML.indexOf('Snap the dash photo') !== -1, w.errEl.innerHTML);
    /* he snaps the dash — the shared pipeline lands the reading */
    ocrPersist('odometer', 169300);
    eq('the reading landed on the draft', String((store.get('pti_draft', {}) || {}).odo), '169300');
    ok('the warning clears from the live card the moment the read lands',
      w.errEl.innerHTML === '', JSON.stringify(w.errEl.innerHTML));
    PTI.render(w.body);
    ok('a re-render does not resurrect the warning', w.body._html.indexOf('Snap the dash photo to capture') === -1);
  }

  console.log('— ship pins —');
  eq('webVersion', ver.webVersion, 281);
  ok('index pin agrees (pti)', idxSrc.includes('modules/pti.js?v=' + ver.webVersion));

  console.log('wave-d-v281: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
