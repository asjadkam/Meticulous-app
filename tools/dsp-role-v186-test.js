#!/usr/bin/env node
/* Meticulous v186 — DSP-role (owner, Oct 21, 2026 07:20 MDT,
 * confirmed wrong in his hands TWICE: his own screenshot and a
 * read-only in-app inspection — account type Driver, Dispatch
 * still listing "👥 Crew today" + "📤 Send a dispatch").
 *
 * THE RULING (absolute): a driver never sends a dispatch and has
 * no crew view. The v132 gate keyed on the PERSON's role pick
 * (userRole !== 'driver'); his account is Driver while his role
 * answer is "both", so the boss cards stayed. The gate now also
 * keys off the ACCOUNT TYPE: a Driver account renders the driver
 * face — only "Add from a message" (+ the v184 quiet manual door
 * and edit-by-tap) — whatever the role pick says. Owner-Operator
 * and Fleet Manager accounts keep their tools standing.
 *
 * Driven against the REAL modules/dispatch.js over the stub-DOM
 * pattern of the sibling suites, with a ConnectPipe stub present
 * (so "the pipe is missing" can never masquerade as the gate).
 * Run: node tools/dsp-role-v186-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const dspSrc = fs.readFileSync(path.join(ROOT, 'modules', 'dispatch.js'), 'utf8');
const ocrSrc = fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8');
const invSrc = fs.readFileSync(path.join(ROOT, 'modules', 'invoice.js'), 'utf8');
const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
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

/* ---------------- fake DOM (v153/v154 pattern) ---------------- */
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

function makeBody() {
  const body = new FakeEl('body');
  body.querySelectorAll = function () { return []; };
  return body;
}
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

/* ---------------- the world ---------------- */
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
function makeWorld(opts) {
  opts = opts || {};
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
  return { sb: sb, store: sb.store, body: makeBody(),
    render: function () { sb.Meticulous.modules.dispatch.render(this.body); } };
}

(async function () {
  /* ---- the owner's case: Driver account, role "both" ---- */
  {
    const w = makeWorld({ accountType: 'Driver', role: 'both' });
    w.render(); await flush();
    const h = w.body._html;
    check('Driver acct + both role: NO Crew today card', h.indexOf('Crew today') === -1);
    check('Driver acct + both role: NO Send a dispatch card', h.indexOf('Send a dispatch') === -1);
    check('Driver acct + both role: NO dp_crew / dp_send containers',
      h.indexOf('id="dp_crew"') === -1 && h.indexOf('id="dp_send"') === -1);
    check('Driver acct + both role: Add-from-a-message door stands', h.indexOf('id="dp_ingest"') !== -1);
    check('Driver acct + both role: the form sits behind the quiet door', h.indexOf('id="dp_form_door"') !== -1);
  }
  /* ---- Driver account, driver role (the pre-fix clean case) ---- */
  {
    const w = makeWorld({ accountType: 'Driver', role: 'driver' });
    w.render(); await flush();
    const h = w.body._html;
    check('Driver acct + driver role: NO crew/send', h.indexOf('Crew today') === -1 && h.indexOf('Send a dispatch') === -1);
    check('Driver acct + driver role: door present', h.indexOf('id="dp_form_door"') !== -1);
  }
  /* ---- Owner-Operator, both role: the tools stand ---- */
  {
    const w = makeWorld({ accountType: 'Owner-Operator', role: 'both' });
    w.render(); await flush();
    const h = w.body._html;
    check('OO acct + both role: Crew today stands', h.indexOf('Crew today') !== -1);
    check('OO acct + both role: Send a dispatch stands', h.indexOf('Send a dispatch') !== -1);
    check('OO acct + both role: NO quiet door (form stands)', h.indexOf('id="dp_form_door"') === -1);
  }
  /* ---- Fleet Manager, office role: the tools stand ---- */
  {
    const w = makeWorld({ accountType: 'Fleet Manager', role: 'office' });
    w.render(); await flush();
    const h = w.body._html;
    check('FM acct + office role: Crew today stands', h.indexOf('Crew today') !== -1);
    check('FM acct + office role: Send a dispatch stands', h.indexOf('Send a dispatch') !== -1);
  }
  /* ---- source pins ---- */
  check('gate keys off the Driver account type',
    dspSrc.indexOf("accountType === 'Driver'") !== -1 && dspSrc.indexOf('!dspDriverAcct') !== -1);
  eq('ships as webVersion 188', ver.webVersion, 204);
  check('index loads dispatch at the 199 pin', idxSrc.indexOf('modules/dispatch.js?v=204') !== -1);

  console.log('\ndsp-role v186: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
