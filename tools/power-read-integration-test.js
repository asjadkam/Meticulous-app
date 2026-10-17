#!/usr/bin/env node
/* Meticulous v63 — POWER READ INTEGRATION suite.
 *
 * Why this exists: v59's mocked suite (tools/power-read-test.js) proved
 * js/powerread.js against a fake store/fetch, but the Oct 14, 2026
 * END-TO-END test on the owner's real photos failed live anyway:
 *
 *   1. DASH (true 168,518): local OCR returned the WRONG value 45,100.
 *      A value existed, so the local-empty-only trigger called it a
 *      success and the power read never ran. → v63 plausibility gate:
 *      a value BELOW the master odometer (mt_odo) is physically
 *      impossible, counts as a FAILED read, and escalates.
 *   2. STICKER (true 175,429 + 28 Sept): local parse found nothing —
 *      the exact v59 trigger — yet no ⚡ ever appeared. Reproduced
 *      here against the REAL modules/maintenance.js + REAL
 *      js/powerread.js: the escalation DID fire (nsPowerRead →
 *      PowerRead.escalate) and died in escalate's skip gate
 *      (enabled() false on that device → {status:'skipped'} with NO
 *      callback, NO fetch, NO trace — v59's "silent when off/keyless"
 *      design made the failure indistinguishable from success).
 *      Every non-skip outcome writes a ⚡ status line, so silence can
 *      only be the skip. → v63: a host that asked (passed onStatus)
 *      is told WHY via state 'unavailable', and every host renders it.
 *
 * This suite drives the REAL shipped hosts (maintenance module whole,
 * the app.js photo-pipeline region verbatim, the fuel module whole)
 * wired to the REAL powerread.js and the REAL ticket-ocr parsers.
 * Only the OCR engine I/O (recognize / fileToOCRImage /
 * huntCandidates) and fetch are stubbed. Fixtures ARE the two real
 * Oct 14 cases: dash local=45100 with master=168518; sticker
 * local-empty through the real Maintenance path (camera AND file).
 * Run: node tools/power-read-integration-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
async function flush(n) {
  for (let i = 0; i < (n || 14); i++) await new Promise(r => setImmediate(r));
  await new Promise(r => setTimeout(r, 20));
  for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));
}

/* ---------------- fake DOM (innerHTML id-parsing, like the app) ---------------- */
class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = []; this.parentNode = null;
    this.id = ''; this._value = ''; this._innerHTML = '';
    this.style = {}; this.className = ''; this.type = '';
    this.files = []; this.checked = false; this.textContent = '';
    this.onclick = null; this.onchange = null;
  }
  set value(v) { this._value = (v === null || v === undefined) ? '' : String(v); }
  get value() { return this._value; }
  set innerHTML(v) {
    this._innerHTML = String(v);
    this.children = [];
    if (!v) return;
    const re = /<(\w+)((?:(?!>).)*?)>/g; let m;
    while ((m = re.exec(v)) !== null) {
      const attrs = m[2] || '';
      const idm = attrs.match(/\bid="([^"]+)"/);
      if (!idm) continue;
      const c = new El(m[1]);
      c.id = idm[1];
      const vm2 = attrs.match(/\bvalue="([^"]*)"/);
      if (vm2) c._value = vm2[1];
      const tm = attrs.match(/\btype="([^"]*)"/);
      if (tm) c.type = tm[1];
      c.parentNode = this;
      this.children.push(c);
    }
  }
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
  findAll(pred, out) {
    out = out || [];
    this.children.forEach(c => { if (pred(c)) out.push(c); c.findAll(pred, out); });
    return out;
  }
  _match(sel) {
    if (sel.charAt(0) === '#') return this.findAll(e => e.id === sel.slice(1));
    if (sel.charAt(0) === '.') { const t = sel.slice(1); return this.findAll(e => (' ' + e.className + ' ').indexOf(' ' + t + ' ') >= 0); }
    return this.findAll(e => e.tagName === sel.toUpperCase());
  }
  querySelector(sel) { const h = this._match(sel); return h[0] || null; }
  querySelectorAll(sel) { return this._match(sel); }
  click() { if (this.onclick) this.onclick({ target: this }); }
  addEventListener() {}
  setAttribute(k, v) { this['_attr_' + k] = v; }
  getAttribute(k) { return this['_attr_' + k] || null; }
}
function makeDocument() {
  const all = [];
  return {
    _all: all,
    createElement(tag) { const e = new El(tag); all.push(e); return e; },
    getElementById(id) {
      for (const e of all) { if (e.id === id) return e; const hit = e.findAll(x => x.id === id); if (hit.length) return hit[0]; }
      return null;
    }
  };
}

/* ---------------- store: real js/app.js semantics ---------------- */
function makeStore() {
  const data = {};
  return {
    _data: data,
    get(k, d) { const v = data['mt_' + k]; return v === undefined ? d : JSON.parse(v); },
    set(k, v) { data['mt_' + k] = JSON.stringify(v); return true; },
    del(k) { delete data['mt_' + k]; return true; },
  };
}
const escFn = s => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function FileReader() {}
FileReader.prototype.readAsDataURL = function () {
  this.result = 'data:image/jpeg;base64,PHOTO';
  if (this.onload) this.onload();
};
function geminiOk(payload) {
  return Promise.resolve({
    status: 200, ok: true,
    json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: typeof payload === 'string' ? payload : JSON.stringify(payload) }] } }] }),
  });
}
function geminiErr(status, message) {
  return Promise.resolve({
    status: status, ok: false,
    json: () => Promise.resolve({ error: { message: message || 'err', status: 'X' } }),
  });
}

/* Base sandbox: REAL ticket-ocr.js (parsers) + REAL powerread.js.
 * OCR engine I/O + fetch are per-world stubs. PowerRead.escalate is
 * wrapped with a recording spy that delegates to the real function. */
function makeBaseWorld(opts) {
  const store = makeStore();
  (opts.seed || []).forEach(([k, v]) => store.set(k, v));
  /* v102: these worlds model installs whose cloud transport is
     the saved key (or nothing at all). The shipped DEFAULT proxy
     URL would otherwise become the route by merely being absent
     (and win over the key), so clear it unless a world seeds it. */
  if (!(opts.seed || []).some(([k]) => k === 'powerReadProxyUrl')) store.set('powerReadProxyUrl', '');
  const fetchCalls = [];
  const fetchMock = (url, o) => { fetchCalls.push({ url, opts: o }); return opts.fetchHandler(url, o); };
  const doc = makeDocument();
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, JSON, Date, Math,
    navigator: { onLine: true },
    fetch: fetchMock,
    document: doc,
    FileReader,
    Meticulous: { modules: {} },
    App: {
      _store: store,
      _today: () => '2026-10-14',
      _esc: escFn,
      onb: {}, tracker: { status: 'idle', startTs: 0, elapsed: 0 },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'powerread.js'), 'utf8'), sandbox);
  const TicketOCR = sandbox.TicketOCR;
  TicketOCR.fileToOCRImage = function (file, cb) { cb('data:image/jpeg;base64,OCRIMG'); };
  TicketOCR.recognize = function (url, onProg) { if (onProg) onProg(0.5); return Promise.resolve(opts.ocrText || ''); };
  TicketOCR.recognizeWithRotation = function (url, onProg) { if (onProg) onProg(0.14); return Promise.resolve(opts.ocrText || ''); };
  TicketOCR.huntCandidates = function (url, o) {
    if (o && o.onUpdate && opts.huntRes) o.onUpdate(opts.huntRes);
    return Promise.resolve(opts.huntRes || {});
  };
  const escalateCalls = [];
  const realEscalate = sandbox.PowerRead.escalate;
  sandbox.PowerRead.escalate = function (o) {
    escalateCalls.push({ reader: o.reader, origin: o.origin, hasImage: !!o.image });
    return realEscalate(o);
  };
  return { sandbox, store, doc, fetchCalls, escalateCalls };
}

/* The garbled text Tesseract actually produced from the owner's real
   sticker photo on Oct 14 (measured with the real pipeline): the real
   parser finds NEITHER miles nor date in it. */
const STICKER_GARBAGE = 'INXS JP\n— =\nERLE Dui\nDATE _ =A\nMILES =\nhae \\ UIC U2) |\nR—\ni\n-\n';
const MOBIL = [
  'Mobil 1742 Gas Stn', '300-3633 Westwinds Dr', 'Calgary, AB T3K 5K3',
  '2026-10-13 18:18:47', 'Pump 8', 'BIODE',
  '83.965 (L)  2.279 ($/L)  191.36 ($)', 'TOTAL CAD $ 191.36',
  'GST included in total $9.11', 'VISA ****8684', 'THANK YOU'
].join('\n');

/* ============ PART M — REAL modules/maintenance.js sticker flow ============ */
function makeMaintWorld(opts) {
  const w = makeBaseWorld(Object.assign({
    ocrText: STICKER_GARBAGE,
    huntRes: { odo: [{ v: 11542, conf: 0.4 }], dates: [], text: '11542' },
  }, opts));
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'modules', 'maintenance.js'), 'utf8'), w.sandbox);
  const body = w.doc.createElement('div');
  w.sandbox.Meticulous.modules.maintenance.render(body);
  return Object.assign(w, { body });
}
const MAINT_SEED = [
  ['mt_odo', '168518'],
  ['mt_nextServiceOdo', '175429'],
  ['mt_nextServiceDate', ''],
];

async function partMaintenance() {
  console.log('\n— M: real Maintenance sticker flow (real case: local-empty) —');

  /* M1: key present, FILE input, provider reads the sticker → ⚡ lands */
  {
    const w = makeMaintWorld({
      seed: MAINT_SEED.concat([['powerReadKey', 'TESTKEY-123']]),
      fetchHandler: () => geminiOk({ miles: 175429, date: '2026-09-28' }),
    });
    const fileIn = w.body.querySelector('#mt_ns_in');
    fileIn.files = [{ name: 'sticker.jpg' }];
    fileIn.onchange({ target: fileIn });
    await flush();
    eq('M1 escalation fired (reader sticker)', w.escalateCalls.length, 1);
    eq('M1 escalation origin is maintenance', w.escalateCalls[0] && w.escalateCalls[0].origin.module, 'maintenance');
    eq('M1 provider called once', w.fetchCalls.length, 1);
    const line = w.body.querySelector('#mt_ns_read').innerHTML;
    ok('M1 read line is the ⚡ power-read result', /⚡ <b>Power read — check before saving:<\/b>/.test(line), line);
    eq('M1 miles filled by power read', w.body.querySelector('#mt_ns_odo').value, '175429');
    eq('M1 date filled by power read', w.body.querySelector('#mt_ns_date').value, '2026-09-28');
    eq('M1 master odometer untouched', w.store.get('mt_odo', ''), '168518');
    eq('M1 stored next-service target untouched (Save not pressed)', w.store.get('mt_nextServiceOdo', ''), '175429');
  }

  /* M2: key present, CAMERA input — same flow, both paths wired */
  {
    const w = makeMaintWorld({
      seed: MAINT_SEED.concat([['powerReadKey', 'TESTKEY-123']]),
      fetchHandler: () => geminiOk({ miles: 175429, date: '2026-09-28' }),
    });
    const camIn = w.body.querySelector('#mt_ns_cam_in');
    camIn.files = [{ name: 'sticker-cam.jpg' }];
    camIn.onchange({ target: camIn });
    await flush();
    eq('M2 camera path escalates too', w.escalateCalls.length, 1);
    eq('M2 camera path fills date', w.body.querySelector('#mt_ns_date').value, '2026-09-28');
  }

  /* M3: THE LIVE FAILURE — no cloud route on this device. v62
     behaviour: plain local banner, zero fetch, zero ⚡ (proven in
     the repro harness). v63: the skip must SAY SO in the same line.
     v94: the line is ONE quiet sentence with NO key errand — the
     pre-v94 "key not set / paste your key" wording encoded the
     superseded BYO-key contract (owner ruling, Oct 16, 2026). */
  {
    const w = makeMaintWorld({
      seed: MAINT_SEED.slice(),
      fetchHandler: () => { throw new Error('fetch must never be called without a key'); },
    });
    const fileIn = w.body.querySelector('#mt_ns_in');
    fileIn.files = [{ name: 'sticker.jpg' }];
    fileIn.onchange({ target: fileIn });
    await flush();
    eq('M3 escalation was still attempted by the wiring', w.escalateCalls.length, 1);
    eq('M3 zero provider calls without a key', w.fetchCalls.length, 0);
    const line = w.body.querySelector('#mt_ns_read').innerHTML;
    ok('M3 read line EXPLAINS the skip in one quiet line (⚡ + cloud reader not reachable)', /⚡ Power read couldn\'t run — the cloud reader isn\'t reachable/.test(line), line);
    ok('M3 v94: the skip line carries no key instructions', !/API key|paste|AI Studio|key not set/i.test(line), line);
    eq('M3 fields left exactly as stored', w.body.querySelector('#mt_ns_odo').value, '175429');
    eq('M3 master untouched', w.store.get('mt_odo', ''), '168518');
  }

  /* M4: key present but the provider rejects it → plain ⚡ error, never silent */
  {
    const w = makeMaintWorld({
      seed: MAINT_SEED.concat([['powerReadKey', 'BADKEY']]),
      fetchHandler: () => geminiErr(400, 'API key not valid. Please pass a valid API key.'),
    });
    const fileIn = w.body.querySelector('#mt_ns_in');
    fileIn.files = [{ name: 'sticker.jpg' }];
    fileIn.onchange({ target: fileIn });
    await flush();
    const line = w.body.querySelector('#mt_ns_read').innerHTML;
    eq('M4 provider was called', w.fetchCalls.length, 1);
    ok('M4 read line shows the ⚡ error in plain words (v94 copy — no key to go check)', /⚡ Power read couldn\'t complete that read/.test(line) && !/API key/.test(line), line);
    eq('M4 master untouched after provider error', w.store.get('mt_odo', ''), '168518');
  }

  /* M5: switch OFF on this device → the line says it's off */
  {
    const w = makeMaintWorld({
      seed: MAINT_SEED.concat([['powerReadKey', 'TESTKEY-123'], ['powerReadOn', false]]),
      fetchHandler: () => { throw new Error('fetch must never be called while off'); },
    });
    const fileIn = w.body.querySelector('#mt_ns_in');
    fileIn.files = [{ name: 'sticker.jpg' }];
    fileIn.onchange({ target: fileIn });
    await flush();
    const line = w.body.querySelector('#mt_ns_read').innerHTML;
    eq('M5 zero provider calls while off', w.fetchCalls.length, 0);
    ok('M5 read line says the power read is off (v94 trimmed wording)', /⚡ Power read is off — turn it on in Preferences/.test(line), line);
  }
}

/* ===== PART A — REAL app.js photo pipeline (onbWirePhoto region) ===== */
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const regionStart = appSrc.indexOf('var _onbOcrToken');
const regionEnd = appSrc.indexOf('function collectOnbInputs');
if (regionStart < 0 || regionEnd < 0 || regionEnd <= regionStart) {
  console.log('FAIL could not slice the onbWirePhoto region from js/app.js');
  process.exit(1);
}
const regionCode = appSrc.slice(regionStart, regionEnd);

function makeAppWorld(opts) {
  const w = makeBaseWorld(Object.assign({ huntRes: { odo: [] } }, opts));
  if (opts.deferOcrImage) {
    w.sandbox.TicketOCR.fileToOCRImage = function (file, cb) { w._deferredCb = cb; };
  }
  const doc = w.doc;
  const root = doc.createElement('div');
  const els = {};
  ['pf_odo', 'pf_odo_cam', 'pf_odo_pick', 'pf_odo_cam_in', 'pf_odo_in', 'pf_odo_prev', 'pf_odo_status']
    .forEach(id => { const e = doc.createElement(/_cam$|_pick$/.test(id) ? 'button' : 'div'); e.id = id; root.appendChild(e); els[id] = e; });
  w.sandbox.el = id => doc.getElementById(id);
  w.sandbox.store = w.store;
  w.sandbox.todayStr = function (d) { d = d || new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
  w.sandbox.trackerSave = function () {};
  vm.runInContext(regionCode, w.sandbox);
  const persistCalls = [];
  w.sandbox.onbWirePhoto('pf_odo', 'odometer', function (kind, v) { persistCalls.push([kind, v]); });
  return Object.assign(w, { els, persistCalls });
}
function snapAppPhoto(w) {
  const camIn = w.els.pf_odo_cam_in;
  camIn.files = [{ name: 'dash.jpg' }];
  camIn.onchange();
}

async function partApp() {
  console.log('\n— A: real app.js odometer pipeline (real case: 45100 vs master 168518) —');

  /* A1: THE DASH CASE — local read 45,100 with master 168,518.
     v62: filled + persisted + "✓ We read 45,100" + NO escalation.
     v63: gate counts it FAILED → no fill, no persist, escalation
     fires, and the power answer lands as a tap-to-use chip. */
  {
    const w = makeAppWorld({
      seed: [['mt_odo', '168518'], ['powerReadKey', 'TESTKEY-123']],
      ocrText: 'TOTAL 45100\nKM',
      fetchHandler: () => geminiOk({ value: 168518 }),
    });
    snapAppPhoto(w);
    await flush();
    eq('A1 escalation fired on the impossible value', w.escalateCalls.length, 1);
    eq('A1 escalation reader is odometer', w.escalateCalls[0] && w.escalateCalls[0].reader, 'odometer');
    eq('A1 provider called once', w.fetchCalls.length, 1);
    eq('A1 field NOT filled with the impossible 45100', w.els.pf_odo.value, '');
    eq('A1 persist NEVER called with the misread', w.persistCalls.length, 0);
    eq('A1 master unchanged', w.store.get('mt_odo', ''), '168518');
    /* v127: the power-read suggestion lives in its OWN box
       (#pf_odo_prbox) — the shared #pf_odo_chips box was erased by
       the hunt's later passes (owner's 169,211 chip, Oct 17). The
       box also carries the ✕ Not it dismiss button; the chip count
       below counts value chips only. */
    const box = w.doc.getElementById('pf_odo_prbox');
    ok('A1 power-read chip box exists', !!box);
    const btns = box ? box.findAll(e => e.tagName === 'BUTTON' && e.textContent !== '✕ Not it') : [];
    eq('A1 exactly one power-read chip', btns.length, 1);
    eq('A1 chip offers the true 168,518 km', btns[0] && btns[0].textContent, '168,518 km');
    ok('A1 status announces the power read find', /⚡ Power read found a reading/.test(w.els.pf_odo_status.innerHTML), w.els.pf_odo_status.innerHTML);
    if (btns[0]) btns[0].click();
    eq('A1 chip tap fills the field', w.els.pf_odo.value, '168518');
    eq('A1 chip tap persists once, the confirmed value', JSON.stringify(w.persistCalls), JSON.stringify([['odometer', '168518']]));
  }

  /* A1b: while the power read is still being prepared, the status
     line must show the gate's plain explanation (not a fake ✓). */
  {
    const w = makeAppWorld({
      seed: [['mt_odo', '168518'], ['powerReadKey', 'TESTKEY-123']],
      ocrText: 'TOTAL 45100\nKM',
      fetchHandler: () => geminiOk({ value: 168518 }),
      deferOcrImage: true,
    });
    snapAppPhoto(w);
    await flush();
    const st = w.els.pf_odo_status.innerHTML;
    ok('A1b status explains: read 45,100 but odometer already at 168,518', /45,100/.test(st) && /already at/.test(st) && /168,518/.test(st), st);
    eq('A1b field untouched while gated', w.els.pf_odo.value, '');
    eq('A1b persist not called while gated', w.persistCalls.length, 0);
  }

  /* A2: plausible read ABOVE the master (within the jump) →
     accepted, NO escalation (cost discipline: the power read is
     not a per-photo tax). v80: "plausible above" now means within
     ODO_MAX_JUMP_KM — the v63 fixture value 182,345 (+13,827) is a
     wild jump since Oct 15 and lives in A2b below. */
  {
    const w = makeAppWorld({
      seed: [['mt_odo', '168518'], ['powerReadKey', 'TESTKEY-123']],
      ocrText: 'TOTAL 168934 km',
      fetchHandler: () => { throw new Error('fetch must not be called for a plausible read'); },
    });
    snapAppPhoto(w);
    await flush();
    eq('A2 plausible value filled', w.els.pf_odo.value, '168934');
    eq('A2 plausible value persisted', JSON.stringify(w.persistCalls), JSON.stringify([['odometer', '168934']]));
    eq('A2 NO escalation for a plausible read', w.escalateCalls.length, 0);
    eq('A2 zero provider calls', w.fetchCalls.length, 0);
  }

  /* A2b: THE RECEIPT CASE (Oct 15, 2026) — local read 519,326 (a
     fuel receipt's INVOICE NO.) with master 168,518. v63's one-sided
     gate FILLED it. v80: the two-sided gate counts it failed → no
     fill, no persist, escalation fires, and the cloud's plausible
     answer lands as a tap-to-use chip, never auto-applied. */
  {
    const w = makeAppWorld({
      seed: [['mt_odo', '168518'], ['powerReadKey', 'TESTKEY-123']],
      ocrText: 'INVOICE NO 519326',
      fetchHandler: () => geminiOk({ value: 168934 }),
    });
    snapAppPhoto(w);
    await flush();
    eq('A2b escalation fired on the wild jump', w.escalateCalls.length, 1);
    eq('A2b field NOT filled with 519326', w.els.pf_odo.value, '');
    eq('A2b persist NEVER called with the misread', w.persistCalls.length, 0);
    eq('A2b master unchanged', w.store.get('mt_odo', ''), '168518');
    ok('A2b status explains the jump', /519,326/.test(w.els.pf_odo_status.innerHTML) || /Power read found/.test(w.els.pf_odo_status.innerHTML), w.els.pf_odo_status.innerHTML);
    const box = w.doc.getElementById('pf_odo_prbox');
    const btns = box ? box.findAll(e => e.tagName === 'BUTTON' && e.textContent !== '✕ Not it') : [];
    eq('A2b exactly one power-read chip', btns.length, 1);
    eq('A2b chip offers the plausible 168,934 km', btns[0] && btns[0].textContent, '168,934 km');
  }

  /* A3: NO master yet (first-run onboarding) → the same 45,100 is a
     legitimate first reading: accepted, no gate, no escalation. */
  {
    const w = makeAppWorld({
      seed: [['powerReadKey', 'TESTKEY-123']],
      ocrText: 'TOTAL 45100 km',
      fetchHandler: () => { throw new Error('fetch must not be called without a master'); },
    });
    snapAppPhoto(w);
    await flush();
    eq('A3 first-run value filled', w.els.pf_odo.value, '45100');
    eq('A3 first-run value persisted', w.persistCalls.length, 1);
    eq('A3 no escalation without a master', w.escalateCalls.length, 0);
  }

  /* A4: local read EMPTY → escalation fires (v59 path, unchanged);
     provider can't read it either → labelled ⚡ couldn't-read line. */
  {
    const w = makeAppWorld({
      seed: [['mt_odo', '168518'], ['powerReadKey', 'TESTKEY-123']],
      ocrText: 'blur blur no digits here',
      fetchHandler: () => geminiOk({ value: null }),
    });
    snapAppPhoto(w);
    await flush();
    eq('A4 empty local read escalates', w.escalateCalls.length, 1);
    ok('A4 final line is the ⚡ couldnt-read-either message', /⚡ Power read couldn't read it either/.test(w.els.pf_odo_status.innerHTML), w.els.pf_odo_status.innerHTML);
    eq('A4 master unchanged', w.store.get('mt_odo', ''), '168518');
  }
}

/* ============ PART F — REAL modules/fuel.js hosts ============ */
function extractFn(source, marker) {
  const start = source.indexOf(marker);
  const braceStart = source.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) break; }
  }
  return source.slice(start, i + 1);
}
const realParseOdo = eval('(' + extractFn(appSrc, 'function parseOdometerReading') + ')');

function makeFuelWorld(opts) {
  const w = makeBaseWorld(Object.assign({ huntRes: null }, opts));
  w.sandbox.App._parseOdometerReading = realParseOdo;
  w.sandbox.App._bumpOdometer = function (v) {
    const n = parseFloat(v);
    const prevRaw = parseFloat(w.store.get('mt_odo', ''));
    const prev = (isFinite(prevRaw) && prevRaw > 0) ? prevRaw : null;
    if (!(n > 0)) return { value: prev, raised: false, previous: prev };
    if (prev === null || n > prev) { w.store.set('mt_odo', String(n)); return { value: n, raised: true, previous: prev }; }
    return { value: prev, raised: false, previous: prev };
  };
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'modules', 'fuel.js'), 'utf8'), w.sandbox);
  const body = w.doc.createElement('div');
  w.sandbox.Meticulous.modules.fuel.render(body);
  return Object.assign(w, { body });
}

async function partFuel() {
  console.log('\n— F: real Fuel hosts (receipt + odometer) —');

  /* F1: receipt local parse finds NOTHING → generic power read
     transcribes, the SAME local parser fills the form. */
  {
    const w = makeFuelWorld({
      seed: [['mt_odo', '168518'], ['powerReadKey', 'TESTKEY-123']],
      ocrText: 'smudged unreadable receipt ###',
      fetchHandler: () => geminiOk({ text: MOBIL }),
    });
    const pick = w.body.querySelector('#fu_img');
    pick.files = [{ name: 'receipt.jpg' }];
    pick.onchange({ target: pick });
    await flush();
    eq('F1 receipt escalation fired', w.escalateCalls.length, 1);
    eq('F1 escalation reader is text', w.escalateCalls[0] && w.escalateCalls[0].reader, 'text');
    const line = w.body.querySelector('#fu_read').innerHTML;
    ok('F1 read line is the ⚡ power-read label', /⚡ <b>Power read — check before saving:<\/b>/.test(line), line);
    eq('F1 litres filled from power transcription', w.body.querySelector('#fu_l').value, '83.965');
    eq('F1 cost filled from power transcription', w.body.querySelector('#fu_cost').value, '191.36');
    eq('F1 master untouched (Save not pressed)', w.store.get('mt_odo', ''), '168518');
  }

  /* F2: fuel odometer photo reads BELOW the master → gate: never
     filled, escalates, power value fills with the ⚡ label. */
  {
    const w = makeFuelWorld({
      seed: [['mt_odo', '168518'], ['powerReadKey', 'TESTKEY-123']],
      ocrText: 'TOTAL 45100 km',
      fetchHandler: () => geminiOk({ value: 168518 }),
    });
    const pick = w.body.querySelector('#fu_odo_in');
    pick.files = [{ name: 'dash.jpg' }];
    pick.onchange({ target: pick });
    await flush();
    eq('F2 below-master fuel odo escalates', w.escalateCalls.length, 1);
    eq('F2 escalation reader is odometer', w.escalateCalls[0] && w.escalateCalls[0].reader, 'odometer');
    eq('F2 field holds the POWER value, not the misread', w.body.querySelector('#fu_odo').value, '168518');
    const line = w.body.querySelector('#fu_odo_read').innerHTML;
    ok('F2 line is the ⚡ power-read label', /⚡ <b>Power read — check before saving:<\/b>/.test(line), line);
    eq('F2 master untouched (Save not pressed)', w.store.get('mt_odo', ''), '168518');
  }

  /* F3: fuel odometer plausible → filled locally, NO escalation.
     v80: plausible-above means within the jump (see A2). */
  {
    const w = makeFuelWorld({
      seed: [['mt_odo', '168518'], ['powerReadKey', 'TESTKEY-123']],
      ocrText: 'TOTAL 168934 km',
      fetchHandler: () => { throw new Error('fetch must not be called for a plausible read'); },
    });
    const pick = w.body.querySelector('#fu_odo_in');
    pick.files = [{ name: 'dash.jpg' }];
    pick.onchange({ target: pick });
    await flush();
    eq('F3 plausible value filled locally', w.body.querySelector('#fu_odo').value, '168934');
    eq('F3 no escalation', w.escalateCalls.length, 0);
  }

  /* F4: fuel receipt with NO cloud route → the skip explains itself
     in-page, in the v94 quiet wording (no key instructions). */
  {
    const w = makeFuelWorld({
      seed: [['mt_odo', '168518']],
      ocrText: 'smudged unreadable receipt ###',
      fetchHandler: () => { throw new Error('fetch must never be called without a key'); },
    });
    const pick = w.body.querySelector('#fu_img');
    pick.files = [{ name: 'receipt.jpg' }];
    pick.onchange({ target: pick });
    await flush();
    eq('F4 escalation attempted by the wiring', w.escalateCalls.length, 1);
    eq('F4 zero provider calls without a key', w.fetchCalls.length, 0);
    const line = w.body.querySelector('#fu_read').innerHTML;
    ok('F4 read line explains the skip', /⚡ Power read couldn\'t run — the cloud reader isn\'t reachable/.test(line) && !/API key|paste|AI Studio|key not set/i.test(line), line);
  }
}

/* ===== PART S — static audit of the hosts that can't be driven whole =====
 * The day start/end odometer sheet lives deep in the app.js IIFE; its
 * trigger now shares odoLocalFailed with the behaviourally-proven
 * pipeline above (A1). These checks pin the wiring in the shipped
 * source so a future edit can't quietly unwire it. */
function partStatic() {
  console.log('\n— S: static host audit (shipped source) —');
  const sheetStart = appSrc.indexOf('function odoSheetHandleFile');
  const sheetEnd = appSrc.indexOf('timed auto-start', sheetStart);
  const sheet = appSrc.slice(sheetStart, sheetEnd);
  ok('S1 odo sheet gates its fill on odoLocalFailed', sheet.indexOf('!odoLocalFailed(km)') >= 0);
  ok('S2 odo sheet escalates on the gated/empty path', sheet.indexOf('odoSheetPowerRead(ocrUrl, kindAtStart)') >= 0);
  ok('S3 odo sheet surfaces unavailable (never silent)', sheet.indexOf("s.state === 'unavailable'") >= 0);
  const fuelSrc = fs.readFileSync(path.join(ROOT, 'modules', 'fuel.js'), 'utf8');
  eq('S4 fuel has unavailable surfaces in BOTH consumers', (fuelSrc.match(/state === 'unavailable'/g) || []).length, 2);
  ok('S5 fuel odometer gate uses the shared plausibility rule', fuelSrc.indexOf('PowerRead.odoReadFailed') >= 0);
  const mtSrc = fs.readFileSync(path.join(ROOT, 'modules', 'maintenance.js'), 'utf8');
  ok('S6 maintenance sticker surfaces unavailable', mtSrc.indexOf("s.state === 'unavailable'") >= 0);
  const prSrc = fs.readFileSync(path.join(ROOT, 'js', 'powerread.js'), 'utf8');
  ok('S7 escalate reports unavailable instead of silent skip', prSrc.indexOf("state: 'unavailable'") >= 0);
  ok('S8 powerread exposes the plausibility gate', prSrc.indexOf('PowerRead.odoReadFailed') >= 0 && prSrc.indexOf('PowerRead.masterOdo') >= 0);
}

(async function main() {
  await partMaintenance();
  await partApp();
  await partFuel();
  partStatic();
  console.log('\npower-read-integration: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL harness error: ' + (e && e.stack || e)); process.exit(1); });
