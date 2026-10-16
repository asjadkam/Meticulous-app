#!/usr/bin/env node
/* Meticulous v61 — Maintenance "Update odometer" camera/file buttons:
 * behavioral tests against the REAL shipped code.
 *
 * The owner asked (Oct 14, from a screenshot of the Maintenance
 * screen): "This update button should also have a lil camera button
 * to just snap a picture." v61 wires the field to the SAME shared
 * odometer photo pipeline as onboarding/Preferences
 * (App._wirePhotoOCR = onbWirePhoto in js/app.js: local OCR read →
 * v58 tap-to-pick hunt chips → v59 power-read escalation on a local
 * miss), with two Maintenance-specific properties under test here:
 *
 *  1. FILL-ONLY: the persist callback Maintenance passes is an
 *     empty no-op (extracted verbatim from modules/maintenance.js),
 *     so NO read path — primary, chip, or power-read chip — can
 *     write the master odometer. Only the card's own Save commits,
 *     through the unchanged save handler.
 *  2. ORIGIN: the pipeline's new optional opts.origin labels this
 *     host's power-read escalations { module: 'maintenance' };
 *     hosts passing no opts keep the historical 'preferences'
 *     origin byte-identically (regression check).
 *
 * app.js is exercised by slicing the real region (var _onbOcrToken
 * .. onbWirePhoto) into a vm sandbox with a tiny fake DOM and stub
 * TicketOCR / PowerRead at the module boundary — the parsing,
 * wiring, chip rendering and escalation logic under test are the
 * shipped ones.
 * Run: node tools/maint-odo-photo-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const mtSrc = fs.readFileSync(path.join(ROOT, 'modules', 'maintenance.js'), 'utf8');
const pfSrc = fs.readFileSync(path.join(ROOT, 'modules', 'preferences.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* ---------------- tiny fake DOM ---------------- */
function makeDocument() {
  const all = new Set();
  class El {
    constructor(tag) {
      this.tagName = String(tag || 'div').toUpperCase();
      this.children = []; this.parentNode = null;
      this.id = ''; this._value = ''; this._innerHTML = ''; this.textContent = '';
      this.style = {}; this.className = ''; this.type = ''; this.files = [];
      this.onclick = null; this.onchange = null;
      all.add(this);
    }
    set value(v) { this._value = (v === null || v === undefined) ? '' : String(v); }
    get value() { return this._value; }
    set innerHTML(v) { this._innerHTML = String(v); if (!v) this.children = []; }
    get innerHTML() { return this._innerHTML; }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    insertBefore(node, ref) {
      node.parentNode = this;
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i >= 0) this.children.splice(i, 0, node); else this.children.push(node);
      return node;
    }
    get nextSibling() {
      if (!this.parentNode) return null;
      const s = this.parentNode.children, i = s.indexOf(this);
      return i >= 0 ? (s[i + 1] || null) : null;
    }
    click() { if (this.onclick) this.onclick(); }
    findAll(pred, out) {
      out = out || [];
      this.children.forEach(function (c) { if (pred(c)) out.push(c); c.findAll(pred, out); });
      return out;
    }
  }
  return {
    createElement: function (tag) { return new El(tag); },
    getElementById: function (id) {
      let hit = null;
      all.forEach(function (e) { if (e.id === id) hit = e; });
      return hit;
    }
  };
}

/* ---------------- world: real app.js region + stubs ---------------- */
const regionStart = appSrc.indexOf('var _onbOcrToken');
const regionEnd = appSrc.indexOf('function collectOnbInputs');
if (regionStart < 0 || regionEnd < 0 || regionEnd <= regionStart) {
  console.log('FAIL could not slice the onbWirePhoto region from js/app.js');
  process.exit(1);
}
const regionCode = appSrc.slice(regionStart, regionEnd);

function makeWorld(opts) {
  opts = opts || {};
  const doc = makeDocument();
  const root = doc.createElement('div');
  function mk(id, tag) { const e = doc.createElement(tag || 'div'); e.id = id; root.appendChild(e); return e; }
  const els = {};
  ['mt_odo', 'mt_odo_cam', 'mt_odo_pick', 'mt_odo_cam_in', 'mt_odo_in', 'mt_odo_prev', 'mt_odo_status',
   'pf_odo', 'pf_odo_cam', 'pf_odo_pick', 'pf_odo_cam_in', 'pf_odo_in', 'pf_odo_prev', 'pf_odo_status']
    .forEach(function (id) { els[id] = mk(id, /_cam$|_pick$/.test(id) ? 'button' : 'div'); });

  const mem = {};
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); },
    del: function (k) { delete mem[k]; }
  };
  const captured = {};
  function FileReader() {}
  FileReader.prototype.readAsDataURL = function () {
    this.result = 'data:image/jpeg;base64,PHOTO';
    if (this.onload) this.onload();
  };
  const TicketOCR = {
    recognize: function () { return Promise.resolve(opts.ocrText || ''); },
    huntCandidates: function (url, o) {
      captured.hunt = o;
      if (opts.huntRes) o.onUpdate(opts.huntRes);
      return Promise.resolve({});
    },
    fileToOCRImage: function (file, cb) { cb('data:image/jpeg;base64,OCR'); }
  };
  const PowerRead = {
    escalate: function (o) {
      captured.escalate = o;
      if (o.onStatus) o.onStatus({ state: 'working' });
      if (opts.powerFields && o.onResult) o.onResult({ fields: opts.powerFields, reader: o.reader });
      return Promise.resolve({ status: 'done' });
    }
  };
  const sandbox = {
    console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
    document: doc, FileReader: FileReader, TicketOCR: TicketOCR, PowerRead: PowerRead,
    App: { onb: {}, tracker: { status: 'idle', startTs: 0, elapsed: 0 } },
    store: store,
    el: function (id) { return doc.getElementById(id); },
    todayStr: function (d) { d = d || new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); },
    trackerSave: function () {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(regionCode, sandbox);
  return { sandbox: sandbox, doc: doc, els: els, mem: mem, store: store, captured: captured };
}

const flush = async function () { for (let i = 0; i < 10; i++) await new Promise(function (r) { setImmediate(r); }); };
function snapPhoto(w, prefix) {
  const camIn = w.els[prefix + '_cam_in'];
  camIn.files = [{ name: 'dash.jpg' }];
  camIn.onchange();
}

/* The REAL persist callback Maintenance passes — extracted verbatim
 * from modules/maintenance.js so the fill-only contract is tested
 * against the shipped call, not a copy of it. */
const persistMatch = mtSrc.match(/_wirePhotoOCR\(\s*'mt_odo',\s*'odometer',\s*(function\s*\(\s*\)\s*\{\s*\})/);
const maintPersist = persistMatch ? (0, eval)('(' + persistMatch[1] + ')') : null;

(async function main() {
  console.log('— static: Maintenance markup & wiring —');
  ['mt_odo_cam', 'mt_odo_pick', 'mt_odo_cam_in', 'mt_odo_in', 'mt_odo_prev', 'mt_odo_status'].forEach(function (id) {
    ok('markup has #' + id, mtSrc.indexOf('id="' + id + '"') >= 0);
  });
  const camInLine = (mtSrc.match(/<input type="file" id="mt_odo_cam_in"[^>]*>/) || [''])[0];
  const pickInLine = (mtSrc.match(/<input type="file" id="mt_odo_in"[^>]*>/) || [''])[0];
  ok('camera input is separate and capture=environment', /capture="environment"/.test(camInLine));
  ok('file input is separate, no capture', pickInLine.length > 0 && !/capture=/.test(pickInLine));
  ok('photo buttons are quiet (btn small ghost)', /class="btn small ghost" id="mt_odo_cam"/.test(mtSrc) && /class="btn small ghost" id="mt_odo_pick"/.test(mtSrc));
  ok('Save is the card primary (btn navy)', /class="btn navy" id="mt_odo_save"/.test(mtSrc));
  ok('wiring passes a no-op persist (extracted verbatim)', !!persistMatch);
  ok('wiring labels origin maintenance', /_wirePhotoOCR\('mt_odo', 'odometer', function \(\) \{\}, \{ origin: \{ module: 'maintenance', label: 'Maintenance' \} \}\)/.test(mtSrc));
  ok('queued-result peek scoped to maintenance', mtSrc.indexOf("peekResult('odometer', 'maintenance')") >= 0 && mtSrc.indexOf("takeResult('odometer', 'maintenance')") >= 0);
  const saveHandler = mtSrc.match(/#mt_odo_save'\)\.onclick = function \(\) \{([\s\S]*?)\n      \};/);
  /* v86: the handler changed ON PURPOSE — it used to write the
     typed number straight over the master (any value, either
     direction); it now routes through App._odoSaveDecision and
     writes the DECISION's value. */
  ok('Save handler routes the master through the supervised decision (v86)', !!saveHandler && saveHandler[1].indexOf("parseFloat(body.querySelector('#mt_odo').value)") >= 0 && saveHandler[1].indexOf('App._odoSaveDecision') >= 0 && saveHandler[1].indexOf("W('odo', dec.value)") >= 0, saveHandler ? '' : 'handler not found');
  /* v97: the pin's count moved ON PURPOSE — v97 adds the second
     supervised write (applyOdoCorrection, the dash-photo correction
     flow), also a decision value. The invariant that matters is
     unchanged: EVERY W('odo', …) in the module writes dec.value
     from App._odoSaveDecision — no stray master write exists. */
  eq('exactly two W(\'odo\', …) writes in the module (Save + v97 correction flow)', (mtSrc.match(/W\('odo',/g) || []).length, 2);
  ok('every W(\'odo\', …) write is the decision value', (mtSrc.match(/W\('odo', [^)]*\)/g) || []).every(function (w) { return w === "W('odo', dec.value)"; }));

  console.log('— static: app.js generalization is opt-in —');
  ok('onbWirePhoto accepts opts', /function onbWirePhoto\(prefix, kind, persistFn, opts\)/.test(appSrc));
  ok('origin falls back to preferences when no opts', appSrc.indexOf("(opts && opts.origin) || { module: 'preferences', label: 'Preferences' }") >= 0);
  ok('onboarding call site unchanged (no opts)', appSrc.indexOf("onbWirePhoto('ob_odo', 'odometer');") >= 0);
  ok('Preferences call sites unchanged (3 args)', pfSrc.indexOf("_wirePhotoOCR('pf_odo', 'odometer', prefsPersistPhoto)") >= 0);

  console.log('— A: local read fills the field; master untouched (real no-op persist) —');
  {
    const w = makeWorld({ ocrText: 'TOTAL 182345 km', huntRes: null, powerFields: null });
    w.sandbox.onbWirePhoto('mt_odo', 'odometer', maintPersist, { origin: { module: 'maintenance', label: 'Maintenance' } });
    ok('camera button wired', typeof w.els.mt_odo_cam.onclick === 'function');
    ok('file button wired', typeof w.els.mt_odo_pick.onclick === 'function');
    let camInClicked = false, pickInClicked = false;
    w.els.mt_odo_cam_in.click = function () { camInClicked = true; };
    w.els.mt_odo_in.click = function () { pickInClicked = true; };
    w.els.mt_odo_cam.onclick();
    ok('camera button opens the camera input only', camInClicked && !pickInClicked);
    camInClicked = false;
    w.els.mt_odo_pick.onclick();
    ok('file button opens the file input only', pickInClicked && !camInClicked);
    snapPhoto(w, 'mt_odo');
    await flush();
    eq('field filled from the local read', w.els.mt_odo.value, '182345');
    ok('status reports the read', w.els.mt_odo_status.innerHTML.indexOf('182,345') >= 0);
    ok('master odometer NOT written', !('mt_odo' in w.mem), JSON.stringify(Object.keys(w.mem)));
    ok('nothing at all written to the store', Object.keys(w.mem).length === 0, JSON.stringify(Object.keys(w.mem)));
    ok('no power-read escalation when the local read lands', !w.captured.escalate);
    ok('preview shows the snapped photo', w.els.mt_odo_prev.innerHTML.indexOf('<img') >= 0);
  }

  console.log('— A2: the pipeline DOES route writes through persist (spy sanity) —');
  {
    const calls = [];
    const w = makeWorld({ ocrText: 'TOTAL 182345 km' });
    w.sandbox.onbWirePhoto('mt_odo', 'odometer', function (k, v) { calls.push([k, v]); }, { origin: { module: 'maintenance', label: 'Maintenance' } });
    snapPhoto(w, 'mt_odo');
    await flush();
    eq('persist called once with the read', JSON.stringify(calls), JSON.stringify([['odometer', '182345']]));
  }

  console.log('— B: v58 hunt chips render here and only fill —');
  {
    const w = makeWorld({ ocrText: 'TOTAL 182345 km', huntRes: { odo: [{ value: 190002 }] } });
    w.sandbox.onbWirePhoto('mt_odo', 'odometer', maintPersist, { origin: { module: 'maintenance', label: 'Maintenance' } });
    snapPhoto(w, 'mt_odo');
    await flush();
    const box = w.doc.getElementById('mt_odo_chips');
    ok('chips box created under the status line', !!box);
    const chips = box ? box.findAll(function (e) { return e.tagName === 'BUTTON'; }) : [];
    eq('one candidate chip', chips.length, 1);
    eq('chip labelled with the candidate', chips.length ? chips[0].textContent : '', '190,002 km');
    if (chips.length) chips[0].onclick();
    eq('chip tap fills the field', w.els.mt_odo.value, '190002');
    ok('master odometer STILL not written after chip tap', !('mt_odo' in w.mem));
  }

  console.log('— C: local miss → power-read escalation, maintenance origin, fill-only chip —');
  {
    const w = makeWorld({ ocrText: 'blurry dash, nothing legible', powerFields: { value: '175000' } });
    w.sandbox.onbWirePhoto('mt_odo', 'odometer', maintPersist, { origin: { module: 'maintenance', label: 'Maintenance' } });
    snapPhoto(w, 'mt_odo');
    await flush();
    ok('escalation fired on the local miss', !!w.captured.escalate);
    eq('escalation reader is odometer', w.captured.escalate && w.captured.escalate.reader, 'odometer');
    eq('escalation origin module is maintenance', w.captured.escalate && w.captured.escalate.origin && w.captured.escalate.origin.module, 'maintenance');
    eq('escalation origin label is Maintenance', w.captured.escalate && w.captured.escalate.origin && w.captured.escalate.origin.label, 'Maintenance');
    const box = w.doc.getElementById('mt_odo_chips');
    const labels = box ? box.findAll(function (e) { return e.tagName === 'DIV'; }) : [];
    ok('power-read chip carries the check-first label', labels.some(function (e) { return e.textContent.indexOf('Power read — check before') >= 0; }), JSON.stringify(labels.map(function (e) { return e.textContent; })));
    const chips = box ? box.findAll(function (e) { return e.tagName === 'BUTTON'; }) : [];
    eq('one power-read chip', chips.length, 1);
    eq('field NOT auto-filled by the power read', w.els.mt_odo.value, '');
    if (chips.length) chips[0].onclick();
    eq('chip tap fills the field', w.els.mt_odo.value, '175000');
    ok('master odometer STILL not written', !('mt_odo' in w.mem));
    ok('status tells the user Save is still theirs', w.els.mt_odo_status.innerHTML.indexOf('Power read') >= 0);
  }

  console.log('— D: no opts → historical preferences origin (v59 regression) —');
  {
    const w = makeWorld({ ocrText: 'blurry dash, nothing legible', powerFields: { value: '175000' } });
    w.sandbox.onbWirePhoto('pf_odo', 'odometer');
    const camIn = w.els.pf_odo_cam_in;
    camIn.files = [{ name: 'dash.jpg' }];
    camIn.onchange();
    await flush();
    eq('default origin module stays preferences', w.captured.escalate && w.captured.escalate.origin && w.captured.escalate.origin.module, 'preferences');
    eq('default origin label stays Preferences', w.captured.escalate && w.captured.escalate.origin && w.captured.escalate.origin.label, 'Preferences');
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('FAIL harness error: ' + (e && e.stack || e)); process.exit(1); });
