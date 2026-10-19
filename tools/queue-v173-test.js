#!/usr/bin/env node
/* Meticulous v173 — RATES MODEL suite (owner, Oct 18, 2026
 * 21:13 + 21:17 MDT — the double-broker rulings, build-and-show):
 *   - rates attach to the JOB: a dispatch carries its own
 *     jobRate, and closing the job prices its billing legs at
 *     the job's rate (the global Preferences rate is only the
 *     fallback for jobs that carry none). Wage legs NEVER read
 *     the job rate — a driver's pay is the driver's own rate.
 *   - a customer's LAST rate is their remembered default
 *     (dsp_rates, keyed by payer, ticket name as fallback): a
 *     new job naming that customer opens at the last rate; it
 *     changes only by a hand on a job, at that job's save.
 *   - a job carries ticket name / rate source / payer as THREE
 *     separate parties (his example: drives for P Hauling, the
 *     rate set by S&S — who stays OFF the ticket — paid by
 *     Kidco).
 *   - rates never cross Connect: the shared record carries
 *     none of the four fields.
 *
 * Run: node tools/queue-v173-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');
const dspSrc = read('modules/dispatch.js');
const navSrc = read('modules/navigation.js');
const ocrSrc = read('js/ticket-ocr.js');
const invSrc = read('modules/invoice.js');
const cpSrc = read('js/connectpipe.js');

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
function extractRegion(src, beginMark, endMark) {
  const bi = src.indexOf(beginMark), ei = src.indexOf(endMark);
  if (bi === -1 || ei === -1) throw new Error('region markers missing');
  return src.slice(src.lastIndexOf('/*', bi), src.indexOf('*/', ei) + 2);
}
function extractStore() {
  const i = appSrc.indexOf('var store = {');
  let depth = 0, j = i;
  for (; j < appSrc.length; j++) {
    if (appSrc[j] === '{') depth++;
    else if (appSrc[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return appSrc.slice(i, j) + ';';
}
function makeLocal() {
  const mem = {};
  return { mem: mem,
    getItem: function (k) { return (k in mem) ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; } };
}
const docStub = {
  createElement: function (tag) { return new FakeEl(tag); },
  querySelector: function () { return null; },
  addEventListener: function () {}
};
function FakeEl(sel) {
  this._sel = sel || ''; this._kids = {}; this._html = '';
  this.value = ''; this.textContent = ''; this.style = {}; this.files = [];
  this.onclick = null; this._listeners = {}; this.options = [{ text: '' }]; this.selectedIndex = 0;
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
FakeEl.prototype.fire = function (type) {
  const self = this;
  (this._listeners[type] || []).slice().forEach(function (fn) { fn({ target: self }); });
};
FakeEl.prototype.click = function () { if (this.onclick) this.onclick({ target: this }); };
FakeEl.prototype.scrollIntoView = function () {};
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };
function flush() {
  return new Promise(function (res) {
    let n = 0;
    (function step() { if (++n > 40) return res(); setTimeout(step, 0); })();
  });
}

/* ---- A: the pure completion plan — the job's rate prices the job ---- */
function regionWorld() {
  const backing = makeLocal();
  const sb = { console: console, document: docStub, localStorage: backing };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(extractStore(), sb);
  sb.App = { _store: sb.store, _today: function () { return '2026-10-19'; },
    _esc: function (s) { return String(s == null ? '' : s); } };
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(extractRegion(dspSrc, 'DSP-SAVE-BEGIN', 'DSP-COMPLETED-END'), sb);
  return sb;
}
{
  const sb = regionWorld();
  const sum = { totalForemanHours: 8, travelBonus: 1, totalPaidHours: 9, totalNetWeight: 0, breakdown: [] };
  const base = { sum: sum, std: 'hourly', rate: 29, role: 'driver', date: '2026-10-19', jobSite: 'S', ticketCount: 1, travelBonusRaw: 1, driver: null, billingRate: 93, wageRate: 29, legacyAmount: null, legacyNetWeight: null, loads: null, ticketNo: null };
  const withJob = sb.dspCompletionPlan(Object.assign({}, base, { jobRate: 110 }));
  eq('A1 a driver\u2019s closed day prices at the JOB rate when the job carries one',
    withJob.entry.amount, '990.00');
  const noJob = sb.dspCompletionPlan(Object.assign({}, base, { jobRate: 0 }));
  eq('A2 a job with no rate falls back to the Preferences rate, as before',
    noJob.entry.amount, '261.00');
  const both = sb.dspCompletionPlan(Object.assign({}, base, { role: 'both', jobRate: 110 }));
  eq('A3 the owner-operator\u2019s billing leg prices at the job rate',
    both.entry.amount, '880.00');
  eq('A4 and his wage leg stays at HIS wage — the job rate never touches wages',
    both.wagePosting.wage, 261);
  const office = sb.dspCompletionPlan(Object.assign({}, base, { role: 'office', rate: 93, jobRate: 110, driver: { id: 'd1', name: 'Crew', rate: 30 } }));
  eq('A5 an office close prices income at the job rate', office.entry.amount, '880.00');
  eq('A6 and the driver\u2019s posting stays at the DRIVER\u2019S OWN rate', office.wagePosting.rate, 30);
  const wsum = { totalForemanHours: 0, travelBonus: 0, totalPaidHours: 0, totalNetWeight: 20, breakdown: [] };
  const weight = sb.dspCompletionPlan(Object.assign({}, base, { std: 'weight', sum: wsum, rate: 0, jobRate: 50 }));
  eq('A7 a by-weight job prices off its job rate alone', weight.entry.amount, '1000.00');

  /* the remembered default */
  sb.dspRememberJobRate({ jobRate: '110', payer: 'Kidco', ticketName: 'P Hauling' });
  eq('A8 a saved job\u2019s rate becomes its payer\u2019s remembered default',
    sb.dspLastRateFor('Kidco'), 110);
  eq('A9 the key is the payer, not the ticket name', sb.dspLastRateFor('P Hauling'), 0);
  sb.dspRememberJobRate({ jobRate: '95', ticketName: 'P Hauling' });
  eq('A10 with no payer named, the ticket name carries the memory',
    sb.dspLastRateFor('p hauling'), 95);
  sb.dspRememberJobRate({ jobRate: '', payer: 'Kidco' });
  eq('A11 a save with no rate never rewrites the memory', sb.dspLastRateFor('Kidco'), 110);
}

/* ---- B: the form flow — parties + rate save, memory fills the next job ---- */
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
function makeBody() {
  const body = new FakeEl('body');
  body._btnCache = {};
  body.querySelectorAll = function (sel) {
    const m = /^\[(data-[a-z]+)\]$/.exec(sel);
    if (!m) return [];
    const attr = m[1];
    const c = body._btnCache[attr];
    if (c && c.html === body._html) return c.btns;
    const out = [];
    const re = new RegExp(attr + '="([^"]*)"', 'g');
    let mm;
    while ((mm = re.exec(body._html))) {
      const v = mm[1];
      out.push({ onclick: null,
        getAttribute: function (n) { return n === attr ? v : null; },
        click: function () { if (this.onclick) this.onclick(); } });
    }
    body._btnCache[attr] = { html: body._html, btns: out };
    return out;
  };
  return body;
}
function moduleWorld() {
  const backing = makeLocal();
  const opened = [];
  const sb = {
    console: console, document: docStub, localStorage: backing,
    FileReader: FakeFileReader, Image: FakeImage, setTimeout: setTimeout,
    alert: function () {}, confirm: function () { return true; },
    Meticulous: { modules: {} }
  };
  sb.window = sb;
  sb.App = {
    _store: null,
    _today: function () { return '2026-10-19'; },
    _esc: function (s) { return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    userRole: function () { return 'driver'; },
    openModule: function (name) { opened.push(name); }
  };
  vm.createContext(sb);
  vm.runInContext(extractStore(), sb);
  sb.App._store = sb.store;
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(navSrc, sb);
  vm.runInContext(dspSrc, sb);
  sb.store.set('onboarding', { payStandard: 'hourly', payRate: 29, travelBonus: 1, contractingCo: 'AI Trucking' });
  return { sb: sb, store: sb.store, body: makeBody() };
}

(async function main() {
  const w = moduleWorld();
  const render = function () { w.sb.Meticulous.modules.dispatch.render(w.body); };
  render(); await flush();
  eq('B1 a fresh form opens with the ticket name prefilled from Preferences',
    w.body.querySelector('#dp_ticketname').value, 'AI Trucking');
  const q = function (id) { return w.body.querySelector(id); };
  q('#dp_site').value = 'Simply Stone';
  q('#dp_ticketname').value = 'P Hauling';
  q('#dp_ratesrc').value = 'S&S';
  q('#dp_payer').value = 'Kidco';
  q('#dp_jobrate').value = '110';
  q('#dp_add').click(); await flush();
  const recs = w.store.get('dsp_list', []);
  eq('B2 the saved job carries its rate and all three parties, separately',
    recs.length === 1 && [recs[0].jobRate, recs[0].ticketName, recs[0].rateSource, recs[0].payer],
    ['110', 'P Hauling', 'S&S', 'Kidco']);
  eq('B3 and the payer\u2019s remembered default is now this job\u2019s rate',
    (w.store.get('dsp_rates', {}) || {}).kidco, 110);

  render(); await flush();
  q('#dp_site').value = 'Next Job';
  q('#dp_payer').value = 'Kidco';
  q('#dp_payer').fire('change');
  eq('B4 a new job naming the same payer opens at their last rate',
    q('#dp_jobrate').value, '110');
  q('#dp_jobrate').value = '120';
  q('#dp_payer').fire('change');
  eq('B5 a rate typed by hand is never stomped by the memory',
    q('#dp_jobrate').value, '120');
  q('#dp_add').click(); await flush();
  eq('B6 saving the changed rate makes IT the remembered default',
    (w.store.get('dsp_rates', {}) || {}).kidco, 120);

  /* ---- C: rates never cross Connect ---- */
  const backing2 = makeLocal();
  const sb2 = { console: console, localStorage: backing2, window: {} };
  sb2.window = sb2;
  sb2.App = { _store: memStore({ onboarding: {} }), _today: function () { return '2026-10-19'; },
    _esc: function (s) { return String(s == null ? '' : s); } };
  vm.createContext(sb2);
  vm.runInContext(cpSrc, sb2);
  const shared = sb2.ConnectPipe.sharedDispatch({
    id: 'x1', jobSite: 'S', status: 'completed', tickets: [],
    jobRate: '110', ticketName: 'P Hauling', rateSource: 'S&S', payer: 'Kidco'
  }, 1);
  ok('C1 the shared record carries NO job rate and NO rate source (rates never cross)',
    !('jobRate' in shared) && !('rateSource' in shared) && !('rate' in shared));
  ok('C2 and the ticket name / payer stay home-side facts too',
    !('ticketName' in shared) && !('payer' in shared));

  console.log('\nqueue-v173 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
