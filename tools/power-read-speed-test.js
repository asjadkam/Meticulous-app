'use strict';
/* v142 POWER READ SPEED — the race, the bounds, and the correction
 * rules.
 *
 * Characterization this build answers to (Oct 17, measured):
 * the cloud read answers in 1.5–6 s against the live endpoint on
 * the owner's real fixtures — the minutes came from every surface
 * running the local Tesseract read to completion FIRST (8.9 s for
 * a 1600px dash rendition on a desktop-class CPU, 23.4 s at full
 * camera resolution; a phone is slower), the proxy route having
 * NO client timeout, and the v118 retry doubling the serial wait.
 *
 * This suite pins:
 *   A. the engine (real js/powerread.js, mocked fetch + MANUAL
 *      timers): beginEarly starts the fetch at capture; a second
 *      beginEarly / an escalate for the same photo ADOPTS it (one
 *      fetch, one read); settle callbacks fire before the adopting
 *      escalation's onResult; a hung fetch is aborted at the 20 s
 *      ceiling, retried ONCE at the 12 s ceiling, then lands as
 *      'waiting' with the photo queued (total: 2 fetches, never a
 *      third); offline beginEarly queues once; an implausible
 *      cloud odometer value settles 'implausible', never 'done';
 *      disabled → beginEarly is null and nothing is sent.
 *   B. the renditions (real js/ticket-ocr.js): READ_MAX per reader;
 *      the local OCR rendition stays 1600px; recognize caps its
 *      input through _capReadSize, which passes non-DOM inputs
 *      through untouched.
 *   C. surface statics: every Power Read surface starts the cloud
 *      read at capture (app.js ×3, fuel ×2, maintenance, dispatch
 *      ×2 funnels) and routes its escalation through the adoption.
 *   D. the glue rules, driven through the REAL onbWirePhoto in a
 *      fake DOM: cloud disagrees + field untouched → corrected
 *      through persist, saying so; cloud disagrees + driver typed
 *      → field untouched, value waits as a chip; cloud first →
 *      chip up while the local read is still running; agreement →
 *      one line, no second persist.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) { ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
const flush = async function (n) { for (let i = 0; i < (n || 12); i++) await new Promise(function (r) { setImmediate(r); }); };

const prSrc = fs.readFileSync(path.join(ROOT, 'js', 'powerread.js'), 'utf8');
const ocrSrc = fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const fuelSrc = fs.readFileSync(path.join(ROOT, 'modules', 'fuel.js'), 'utf8');
const mtSrc = fs.readFileSync(path.join(ROOT, 'modules', 'maintenance.js'), 'utf8');
const dspSrc = fs.readFileSync(path.join(ROOT, 'modules', 'dispatch.js'), 'utf8');

/* ================= A. the engine ================= */
console.log('— A: engine — beginEarly, adoption, bounds —');
function makeEngineWorld() {
  const data = {};
  const writes = [];
  const store = {
    get(k, d) { const v = data['mt_' + k]; return v === undefined ? d : JSON.parse(v); },
    set(k, v) { writes.push(k); data['mt_' + k] = JSON.stringify(v); return true; },
    del(k) { delete data['mt_' + k]; return true; }
  };
  const timers = [];
  function fakeSetTimeout(cb, ms) { const t = { cb: cb, ms: ms, cleared: false, fired: false }; timers.push(t); return t; }
  function fakeClearTimeout(t) { if (t) t.cleared = true; }
  function fireTimer(ms) {
    const t = timers.find(function (x) { return !x.cleared && !x.fired && x.ms === ms; });
    if (t) { t.fired = true; t.cb(); }
    return !!t;
  }
  class FakeSignal {
    constructor() { this.aborted = false; this._ls = []; }
    addEventListener(ev, fn) { if (ev === 'abort') this._ls.push(fn); }
  }
  class FakeAbortController {
    constructor() { this.signal = new FakeSignal(); }
    abort() { this.signal.aborted = true; this.signal._ls.forEach(function (f) { f(); }); }
  }
  const nav = { onLine: true };
  let fetchCalls = [];
  let fetchHandler = null;
  const mockFetch = function (url, opts) { fetchCalls.push({ url: url, opts: opts }); return fetchHandler(url, opts); };
  const sandbox = {
    console: console, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout,
    Promise: Promise, JSON: JSON, Date: Date, Math: Math,
    navigator: nav, fetch: mockFetch, AbortController: FakeAbortController,
    App: { _store: store }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(ocrSrc, sandbox);
  vm.runInContext(prSrc, sandbox);
  return {
    PowerRead: sandbox.PowerRead, store: store, nav: nav, timers: timers,
    fireTimer: fireTimer,
    calls: function () { return fetchCalls; },
    setFetch: function (h) { fetchHandler = h; },
    resetCalls: function () { fetchCalls = []; }
  };
}
function proxyOk(payload) {
  return function () {
    return Promise.resolve({
      status: 200, ok: true,
      json: function () { return Promise.resolve({ text: typeof payload === 'string' ? payload : JSON.stringify(payload) }); }
    });
  };
}
const IMG = 'data:image/jpeg;base64,/9j/AAAAphotoone';
const IMG2 = 'data:image/jpeg;base64,/9j/BBBBphototwo';

async function engine() {
  const W = makeEngineWorld();
  const PR = W.PowerRead;
  ok('engine loaded with beginEarly', !!PR && typeof PR.beginEarly === 'function');
  eq('per-attempt ceiling is 20 s', PR.FETCH_TIMEOUT_MS, 20000);
  eq('retry ceiling is 12 s', PR.RETRY_TIMEOUT_MS, 12000);
  W.store.set('mt_odo', '168518'); // master: 169211 plausible, 45100 not

  /* --- adoption + ordering + dedupe --- */
  W.setFetch(proxyOk({ value: 169211 }));
  const order = [];
  let settledOut = null;
  const h1 = PR.beginEarly({ reader: 'odometer', image: IMG, origin: { module: 'test', label: 'T' }, onSettled: function (o) { order.push('settle'); settledOut = o; } });
  ok('beginEarly returns a handle', !!h1 && typeof h1.onSettled === 'function');
  eq('the fetch starts AT CAPTURE (before any local read)', W.calls().length, 1);
  const h2 = PR.beginEarly({ reader: 'odometer', image: IMG });
  ok('same photo + reader dedupes to the same handle', h2 === h1);
  eq('still one fetch after the duplicate beginEarly', W.calls().length, 1);
  let escFields = null;
  const escP = PR.escalate({ reader: 'odometer', image: IMG, onResult: function (r) { order.push('result'); escFields = r.fields; } });
  eq('the adopting escalate sends NOTHING new', W.calls().length, 1);
  const escOut = await escP;
  await flush();
  eq('escalate resolves done', escOut.status, 'done');
  eq('settle callback fired BEFORE the escalation onResult', order.join(','), 'settle,result');
  eq('both saw the same value', settledOut && settledOut.fields && settledOut.fields.value, 169211);
  eq('escalation fields carry the value', escFields && escFields.value, 169211);
  eq('the read counted once', PR.monthCount(), 1);

  /* --- a different photo is a different read --- */
  W.resetCalls();
  W.setFetch(proxyOk({ value: 169300 }));
  const out2 = await PR.escalate({ reader: 'odometer', image: IMG2 });
  eq('a different photo escalates on its own fetch', W.calls().length, 1);
  eq('and resolves done', out2.status, 'done');

  /* --- the timeout bound: hung fetch → abort → ONE retry → waiting --- */
  const W2 = makeEngineWorld();
  const PR2 = W2.PowerRead;
  W2.store.set('mt_odo', '168518');
  W2.setFetch(function (url, opts) {
    return new Promise(function (resolve, reject) {
      if (opts && opts.signal) opts.signal.addEventListener('abort', function () { reject(new Error('aborted')); });
    });
  });
  let timeoutOutcome = null;
  PR2.beginEarly({ reader: 'odometer', image: IMG, onSettled: function (o) { timeoutOutcome = o; } });
  eq('hung read: fetch started', W2.calls().length, 1);
  ok('a 20 s ceiling timer is armed', W2.fireTimer(20000));
  await flush();
  eq('after the abort the retry waits, no fetch yet', W2.calls().length, 1);
  ok('the v118 retry delay is armed', W2.fireTimer(1200));
  await flush();
  eq('the retry sends exactly one more fetch', W2.calls().length, 2);
  ok('the retry attempt carries the shorter 12 s ceiling', W2.fireTimer(12000));
  await flush();
  ok('the read settled after the bounded retry', !!timeoutOutcome);
  eq('a dead network lands as waiting (photo queued), not minutes of spinner', timeoutOutcome && timeoutOutcome.status, 'waiting');
  eq('the photo is queued exactly once', PR2.queueLength(), 1);
  eq('total fetches for the whole read: 2 — never a third', W2.calls().length, 2);

  /* --- offline at capture --- */
  const W3 = makeEngineWorld();
  const PR3 = W3.PowerRead;
  W3.nav.onLine = false;
  let offOutcome = null;
  PR3.beginEarly({ reader: 'odometer', image: IMG, onSettled: function (o) { offOutcome = o; } });
  await flush();
  eq('offline beginEarly sends nothing', W3.calls().length, 0);
  eq('offline settles as waiting', offOutcome && offOutcome.status, 'waiting');
  eq('offline queues the photo once', PR3.queueLength(), 1);
  const offEsc = await PR3.escalate({ reader: 'odometer', image: IMG });
  eq('escalate while offline also waits', offEsc.status, 'waiting');
  eq('and does not double-queue', PR3.queueLength(), 1);

  /* --- implausible cloud value can never settle 'done' --- */
  const W4 = makeEngineWorld();
  const PR4 = W4.PowerRead;
  W4.store.set('mt_odo', '168518');
  W4.setFetch(proxyOk({ value: 45100 }));
  let impOutcome = null;
  PR4.beginEarly({ reader: 'odometer', image: IMG, onSettled: function (o) { impOutcome = o; } });
  await flush();
  eq('a below-master cloud value settles implausible', impOutcome && impOutcome.status, 'implausible');
  let impResult = false;
  const impEsc = await PR4.escalate({ reader: 'odometer', image: IMG, onResult: function () { impResult = true; } });
  eq('the adopting escalate reports implausible', impEsc.status, 'implausible');
  ok('onResult never fires for an implausible value', impResult === false);

  /* --- disabled: nothing starts --- */
  const W5 = makeEngineWorld();
  const PR5 = W5.PowerRead;
  PR5.setOn(false);
  eq('switch off → beginEarly is null', PR5.beginEarly({ reader: 'odometer', image: IMG }), null);
  eq('switch off → zero fetches', W5.calls().length, 0);
}

/* ================= B. renditions ================= */
function ocrChecks() {
  console.log('— B: renditions —');
  const sandbox = { console: console, Promise: Promise };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(ocrSrc, sandbox);
  const T = sandbox.TicketOCR;
  ok('TicketOCR loaded', !!T);
  eq('cloud send: odometer rendition is 1024px', T.READ_MAX.odometer, 1024);
  eq('cloud send: text rendition is 1280px', T.READ_MAX.text, 1280);
  eq('cloud send: sticker rendition is 1280px', T.READ_MAX.sticker, 1280);
  ok('the LOCAL OCR rendition stays 1600px', ocrSrc.indexOf("_fileToSizedImage(file, 1600, cb)") !== -1);
  ok('recognize routes its input through the size cap', ocrSrc.indexOf('TicketOCR._capReadSize(image)') !== -1);
  return T;
}
async function capChecks(T) {
  const fileObj = { name: 'x.jpg' };
  eq('cap passes a File/Blob input through untouched', await T._capReadSize(fileObj), fileObj);
  eq('cap passes a non-data string through untouched', await T._capReadSize('https://example.invalid/x.jpg'), 'https://example.invalid/x.jpg');
  /* No Image in this sandbox: a data URL passes through unchanged
     (the same degradation contract as the phone paths' guards). */
  eq('cap passes a data URL through when Image is unavailable', await T._capReadSize('data:image/jpeg;base64,AAAA'), 'data:image/jpeg;base64,AAAA');
  let passthrough = null;
  T.urlToReadImage('data:image/jpeg;base64,AAAA', 'odometer', function (v) { passthrough = v; });
  eq('urlToReadImage passes through when Image is unavailable', passthrough, 'data:image/jpeg;base64,AAAA');
}

/* ================= C. surface statics ================= */
function statics() {
  console.log('— C: surface statics —');
  const count = function (src, s) { return (src.match(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length; };
  ok('app.js: the photo wiring starts the cloud at capture', appSrc.indexOf('PowerRead.beginEarly') !== -1);
  eq('app.js: three beginEarly call sites (photo wiring + both sheets)', count(appSrc, 'PowerRead.beginEarly({'), 3);
  ok('app.js: settle handler for the wiring exists', appSrc.indexOf('function onbCloudSettled') !== -1);
  ok('app.js: both sheet settle handlers exist', appSrc.indexOf('function odoSheetCloudSettled') !== -1 && appSrc.indexOf('function endSheetCloudSettled') !== -1);
  ok('app.js: odoPowerRead takes the early image', appSrc.indexOf('function odoPowerRead(prefix, prImg, file, token, state)') !== -1);
  ok('app.js: the local photo read starts immediately on the photo (its size cap lives in TicketOCR, pinned in B)', appSrc.indexOf('TicketOCR.recognize(dataUrl, function (p)') !== -1);
  eq('fuel.js: two beginEarly call sites (receipt + odometer photo)', count(fuelSrc, 'PowerRead.beginEarly({'), 2);
  ok('fuel.js: both settle handlers exist', fuelSrc.indexOf('function fuCloudSettled') !== -1 && fuelSrc.indexOf('function fuOdoCloudSettled') !== -1);
  eq('maintenance.js: one beginEarly call site (sticker)', count(mtSrc, 'PowerRead.beginEarly({'), 1);
  ok('maintenance.js: the sticker settle handler exists', mtSrc.indexOf('function nsCloudSettled') !== -1);
  eq('dispatch.js: both funnels start the cloud at capture', count(dspSrc, 'dspBeginEarly(ocrUrl || photoUrl'), 2);
  ok('dispatch.js: the escalation takes the early image', dspSrc.indexOf('function escalateTicketRead(ocrUrl, onMerged, prImg)') !== -1);
  ok('dispatch.js: the close funnel escalates with the early image', dspSrc.indexOf('}, early.prImg);') !== -1);
  ok('powerread.js: the proxy route carries an abort ceiling', /callProxy[\s\S]{0,1600}AbortController/.test(prSrc));
  ok('ticket-ocr.js: fileToReadImage serves the send rendition', ocrSrc.indexOf('TicketOCR.fileToReadImage = function') !== -1);
}

/* ================= D. glue drive: onbWirePhoto ================= */
console.log('— D: glue — the correction rules in the real photo wiring —');
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
    },
    _El: El
  };
}
const regionStart = appSrc.indexOf('var _onbOcrToken');
const regionEnd = appSrc.indexOf('function collectOnbInputs');
if (regionStart < 0 || regionEnd <= regionStart) { console.log('FAIL could not slice the app.js region'); process.exit(1); }
const regionCode = appSrc.slice(regionStart, regionEnd);

function makeGlueWorld() {
  const doc = makeDocument();
  const root = doc.createElement('div');
  function mk(id, tag) { const e = doc.createElement(tag || 'div'); e.id = id; root.appendChild(e); return e; }
  const els = {};
  ['mt_odo', 'mt_odo_cam', 'mt_odo_pick', 'mt_odo_cam_in', 'mt_odo_in', 'mt_odo_prev', 'mt_odo_status']
    .forEach(function (id) { els[id] = mk(id, /_cam$|_pick$/.test(id) ? 'button' : 'div'); });
  const mem = {};
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); },
    del: function (k) { delete mem[k]; }
  };
  function FileReader() {}
  FileReader.prototype.readAsDataURL = function () {
    this.result = 'data:image/jpeg;base64,PHOTO';
    if (this.onload) this.onload();
  };
  const captured = { settle: null, earlyImage: null, escalateCalls: 0 };
  let recognizeImpl = function () { return Promise.resolve(''); };
  const TicketOCR = {
    recognize: function () { return recognizeImpl(); },
    huntCandidates: function () { return Promise.resolve({}); },
    fileToOCRImage: function (file, cb) { cb('data:image/jpeg;base64,OCR'); }
    /* no urlToReadImage on purpose: the guarded fallback path
       (startCloud with the OCR rendition) is what runs here. */
  };
  const PowerRead = {
    escalate: function () { captured.escalateCalls++; return Promise.resolve({ status: 'skipped' }); },
    beginEarly: function (opts) {
      captured.earlyImage = opts.image;
      return { onSettled: function (cb) { captured.settle = cb; } };
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
  return {
    sandbox: sandbox, els: els, captured: captured,
    setRecognize: function (fn) { recognizeImpl = fn; },
    snap: function () {
      const camIn = els.mt_odo_cam_in;
      camIn.files = [{ name: 'dash.jpg' }];
      camIn.onchange();
    },
    prButtons: function () {
      const box = doc.getElementById('mt_odo_prbox');
      return box ? box.findAll(function (e) { return e.tagName === 'BUTTON'; }) : [];
    }
  };
}

async function glue() {
  /* G1: local lands 169200; the cloud disagrees (169211) and the
     field still holds exactly the local value → corrected through
     persist, and the status SAYS corrected. */
  {
    const w = makeGlueWorld();
    const persistCalls = [];
    w.setRecognize(function () { return Promise.resolve('TOTAL 169200 km'); });
    w.sandbox.onbWirePhoto('mt_odo', 'odometer', function (k, v) { persistCalls.push([k, v]); }, { origin: { module: 'maintenance', label: 'Maintenance' } });
    w.snap();
    await flush();
    eq('G1: beginEarly fired at capture (stub world has no urlToReadImage — the photo itself is the image)', w.captured.earlyImage, 'data:image/jpeg;base64,PHOTO');
    eq('G1: the local read filled the field', w.els.mt_odo.value, '169200');
    eq('G1: no escalation was needed', w.captured.escalateCalls, 0);
    w.captured.settle({ status: 'done', fields: { value: 169211 } });
    await flush();
    eq('G1: an untouched field is corrected to the cloud value', w.els.mt_odo.value, '169211');
    ok('G1: the correction persisted through the same persist()', persistCalls.some(function (c) { return String(c[1]) === '169211'; }), JSON.stringify(persistCalls));
    ok('G1: the status says it was corrected', /corrected the reading/.test(w.els.mt_odo_status.innerHTML), w.els.mt_odo_status.innerHTML);
  }
  /* G2: the driver TYPED over the local value before the cloud
     settled → the cloud value never overwrites; it waits as a chip. */
  {
    const w = makeGlueWorld();
    const persistCalls = [];
    w.setRecognize(function () { return Promise.resolve('TOTAL 169200 km'); });
    w.sandbox.onbWirePhoto('mt_odo', 'odometer', function (k, v) { persistCalls.push([k, v]); }, { origin: { module: 'maintenance', label: 'Maintenance' } });
    w.snap();
    await flush();
    w.els.mt_odo.value = '169300'; /* the driver's own act */
    w.captured.settle({ status: 'done', fields: { value: 169211 } });
    await flush();
    eq('G2: the driver\'s typed value is NEVER overwritten', w.els.mt_odo.value, '169300');
    ok('G2: the cloud value was not persisted', !persistCalls.some(function (c) { return String(c[1]) === '169211'; }), JSON.stringify(persistCalls));
    const btns = w.prButtons();
    ok('G2: the cloud value waits as a tap-to-use chip', btns.length >= 1 && btns[0].textContent.indexOf('169,211') !== -1, JSON.stringify(btns.map(function (b) { return b.textContent; })));
    ok('G2: the status names the disagreement', /different reading/.test(w.els.mt_odo_status.innerHTML), w.els.mt_odo_status.innerHTML);
  }
  /* G3: the cloud lands FIRST (the owner's dash: local Tesseract
     is slow and finds nothing on dot-matrix displays) → its chip
     is up while the local read is still running; when the local
     read then lands, it fills the field and the chip stays as the
     alternative — nothing waited for the local read. */
  {
    const w = makeGlueWorld();
    const persistCalls = [];
    let resolveLocal = null;
    w.setRecognize(function () { return new Promise(function (r) { resolveLocal = r; }); });
    w.sandbox.onbWirePhoto('mt_odo', 'odometer', function (k, v) { persistCalls.push([k, v]); }, { origin: { module: 'maintenance', label: 'Maintenance' } });
    w.snap();
    await flush(3);
    ok('G3: the cloud read started while the local read is still running', typeof w.captured.settle === 'function');
    w.captured.settle({ status: 'done', fields: { value: 169211 } });
    await flush();
    const btns = w.prButtons();
    ok('G3: the cloud suggestion is up in seconds, local still pending', btns.length >= 1 && btns[0].textContent.indexOf('169,211') !== -1);
    eq('G3: the field is untouched until a tap (confirm-first)', w.els.mt_odo.value, '');
    resolveLocal('TOTAL 169200 km');
    await flush();
    eq('G3: the late local read fills the field as before', w.els.mt_odo.value, '169200');
    ok('G3: the cloud chip stays as the driver\'s alternative', w.prButtons().length >= 1);
  }
  /* G4: agreement → one line, no correction, no second persist. */
  {
    const w = makeGlueWorld();
    const persistCalls = [];
    w.setRecognize(function () { return Promise.resolve('TOTAL 169200 km'); });
    w.sandbox.onbWirePhoto('mt_odo', 'odometer', function (k, v) { persistCalls.push([k, v]); }, { origin: { module: 'maintenance', label: 'Maintenance' } });
    w.snap();
    await flush();
    w.captured.settle({ status: 'done', fields: { value: 169200 } });
    await flush();
    eq('G4: the field keeps the agreed value', w.els.mt_odo.value, '169200');
    eq('G4: exactly one persist (the local read\'s)', persistCalls.length, 1);
    ok('G4: the status records the agreement', /agrees/.test(w.els.mt_odo_status.innerHTML), w.els.mt_odo_status.innerHTML);
  }
}

(async function main() {
  await engine();
  const T = ocrChecks();
  await capChecks(T);
  statics();
  await glue();
  console.log('\npower-read-speed: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('SUITE ERROR', e); process.exit(1); });
