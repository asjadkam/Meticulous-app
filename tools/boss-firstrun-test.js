#!/usr/bin/env node
/* Meticulous v76 — BOSS FIRST-RUN (boss QA Oct 14: F1–F9, the owner
 * Connect two-card directive, and the field-reported Suggested-
 * dispatch "Use does nothing" defect, Oct 14 19:22).
 *
 * Behavioral tests against the REAL shipped code in the repo's harness
 * style: verbatim region extraction into vm sandboxes over in-memory
 * stores (role-package-test), plus fake-DOM drives of the REAL module
 * files (dispatch-close-test). Covers:
 *  (a) ROLE: an unanswered "Do you drive?" NEVER stamps 'both' —
 *      ensureUserRole holds the provisional OFFICE face and writes
 *      nothing; answered picks are never overridden (F1).
 *  (b) office order: Connect FIRST, then Dispatch, Invoice,
 *      Maintenance, P&L — home modules AND sidebar (F4); driver/both
 *      orders byte-unchanged.
 *  (c) onboarding gates: Next / Skip / Finish all hold at the
 *      unanswered role question; office answers hide the driver
 *      homework steps; the company step collects country + province
 *      for Invoice (F1/F2/F8); the Beta banner hides for office (F9).
 *  (d) Dispatch module driven like a finger: office face (plain
 *      Save, saved-on-device wording, no Start anywhere); the Use tap
 *      loads a suggestion INTO the form visibly (banner + populated
 *      fields), refuses loudly at the tap when the form is busy, and
 *      Save still creates exactly ONE record — for the suggestion's
 *      date, with today's active dispatch byte-untouched (F3 + the
 *      Oct 14 19:22 Use field report).
 *  (e) Connect: exactly two cards, per-connection picker packages the
 *      REAL dispatch content into the outbox, picker names dispatches
 *      by jobSite, no native dialogs (F7 + owner two-card directive).
 *  (f) Revenue / Preferences / Invoice source guards (F5/F6/F8).
 * Run: node tools/boss-firstrun-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');
const dspSrc = read('modules/dispatch.js');
const ingestSrc = read('js/dispatch-ingest.js');
const ocrSrc = read('js/ticket-ocr.js');
const conSrc = read('modules/connect.js');
const revSrc = read('modules/revenue.js');
const prefSrc = read('modules/preferences.js');
const invSrc = read('modules/invoice.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function deepEq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function has(name, hay, needle) { ok(name, String(hay).indexOf(needle) >= 0, 'missing: ' + needle.slice(0, 70)); }
function lacks(name, hay, needle) { ok(name, String(hay).indexOf(needle) === -1, 'should not contain: ' + needle.slice(0, 70)); }
function sliceFrom(src, marker, len) {
  const i = src.indexOf(marker);
  return i === -1 ? '' : src.slice(i, i + (len || 1200));
}
function extract(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
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
function todayStr(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function tomorrowStr() {
  const d = new Date(); d.setDate(d.getDate() + 1); return todayStr(d);
}

/* ================= (a)+(b) ROLE region ================= */
function memStore(seed) {
  const data = Object.assign({}, seed || {});
  const writes = [];
  return {
    data, writes,
    get(k, d) { return (k in data) ? data[k] : d; },
    set(k, v) { writes.push(k); data[k] = v; return true; },
    del(k) { delete data[k]; return true; }
  };
}
function roleWorld(seed) {
  const store = memStore(seed);
  const sb = { store, App: {}, console };
  vm.createContext(sb);
  vm.runInContext(extract(appSrc, 'ROLE-BEGIN', 'ROLE-END'), sb);
  return { sb, store };
}

console.log('(a) ROLE — the unanswered question never becomes a driver face (F1)');
{
  /* the QA trap, reproduced: Owner-Operator, onboarded, NO role pick */
  const w = roleWorld({ onboarding: { accountType: 'Owner-Operator', onboarded: true } });
  eq('OO unanswered: ensureUserRole holds at office', w.sb.ensureUserRole(), 'office');
  eq('OO unanswered: NOTHING stamped (userRole stays unset)',
    'userRole' in w.store.data.onboarding, false);
  eq('OO unanswered: zero store writes', w.store.writes.length, 0);
  eq('OO unanswered: App.userRole() is office (no tracker face)', w.sb.App.userRole(), 'office');
  eq('OO unanswered: roleAnswered false', w.sb.roleAnswered(w.store.data.onboarding), false);
  eq('OO unanswered: provisionalRole is office', w.sb.provisionalRole({ accountType: 'Owner-Operator' }), 'office');
  eq('OO unanswered: tracker hidden', w.sb.roleShowsTracker(w.sb.App.userRole()), false);

  /* answered picks are sacred — never overridden, never rewritten */
  ['both', 'office', 'driver'].forEach(function (pick) {
    const a = roleWorld({ onboarding: { accountType: 'Owner-Operator', userRole: pick } });
    eq('OO answered ' + pick + ': ensureUserRole returns the pick', a.sb.ensureUserRole(), pick);
    eq('OO answered ' + pick + ': App.userRole returns the pick', a.sb.App.userRole(), pick);
    eq('OO answered ' + pick + ': zero writes', a.store.writes.length, 0);
  });

  /* the safe defaults keep their old migration behaviour */
  const fm = roleWorld({ onboarding: { accountType: 'Fleet Manager' } });
  eq('FM unanswered: ensureUserRole stamps office', fm.sb.ensureUserRole(), 'office');
  eq('FM unanswered: stamped into onboarding', fm.store.data.onboarding.userRole, 'office');
  const bogus = roleWorld({ onboarding: { accountType: 'Driver', userRole: 'bogus' } });
  eq('Driver bogus role: stamped driver', bogus.sb.ensureUserRole(), 'driver');
  eq('Driver bogus role: written', bogus.store.data.onboarding.userRole, 'driver');
  const empty = roleWorld({});
  eq('empty store: App.userRole() is driver', empty.sb.App.userRole(), 'driver');
  eq('provisionalRole: Driver→driver', empty.sb.provisionalRole({ accountType: 'Driver' }), 'driver');
  eq('provisionalRole: FM→office', empty.sb.provisionalRole({ accountType: 'Fleet Manager' }), 'office');
  eq('provisionalRole: no accountType→driver', empty.sb.provisionalRole({}), 'driver');
  eq('resolveUserRole semantics kept (default map untouched)', empty.sb.resolveUserRole({ accountType: 'Owner-Operator' }), 'both');
}

console.log('(b) office order — the boss five lead, Connect first (F4)');
{
  const w = roleWorld({});
  /* v77: 'navigator' rides right after 'navigation' in every order —
     the boss five still lead the office home; nothing is removed. */
  deepEq('office module order: five lead, same eleven modules', w.sb.roleModuleOrder('office'),
    ['connect', 'dispatch', 'invoice', 'maintenance', 'pnl', 'manifest', 'revenue', 'fuel', 'damage', 'navigation', 'navigator']);
  deepEq('driver module order: pre-v77 order + navigator', w.sb.roleModuleOrder('driver'),
    ['revenue', 'dispatch', 'fuel', 'maintenance', 'manifest', 'navigation', 'navigator', 'damage', 'pnl', 'invoice', 'connect']);
  deepEq('both module order: pre-v77 order + navigator', w.sb.roleModuleOrder('both'),
    ['revenue', 'dispatch', 'navigation', 'navigator', 'fuel', 'pnl', 'maintenance', 'damage', 'manifest', 'invoice', 'connect']);
  const items = [['dashboard'], ['dispatch'], ['revenue'], ['fuel'], ['pnl'], ['maintenance'], ['damage'],
    ['manifest'], ['invoice'], ['reminders'], ['navigation'], ['connect'], ['preferences'], ['subscription']];
  const off = w.sb.roleSidebarOrder('office', items).map(function (i) { return i[0]; });
  deepEq('office sidebar leads: dashboard + the five', off.slice(0, 6),
    ['dashboard', 'connect', 'dispatch', 'invoice', 'maintenance', 'pnl']);
  eq('office sidebar keeps every item', off.length, items.length);
  const drv = w.sb.roleSidebarOrder('driver', items).map(function (i) { return i[0]; });
  deepEq('driver sidebar lead unchanged', drv.slice(0, 3), ['dashboard', 'revenue', 'dispatch']);
}

/* ================= (c) onboarding gates (source) ================= */
console.log('(c) onboarding — role gate, role branching, location fields (F1/F2/F8/F9)');
{
  const next = sliceFrom(appSrc, "el('onbNext').onclick = function () {", 900);
  has('onbNext gates on the role question', next, "cur.key === 'userRole'");
  has('onbNext sets the nudge when blocked', next, '_onbRoleNudge = true');
  has('onbNext walks VISIBLE steps only', next, 'onbNextVisible');

  const skip = sliceFrom(appSrc, "el('onbSkip').onclick = function () {", 700);
  has('onbSkip cannot pass the role question', skip, 'isUserRole(App.onb.userRole)');
  has('onbSkip lands ON the question when blocked', skip, '_onbRoleNudge = true');

  const fin = sliceFrom(appSrc, 'function finishOnboarding() {', 2400);
  has('finishOnboarding holds at the question when unanswered', fin, '!isUserRole(o.userRole)');
  lacks('finishOnboarding never stamps a default role', fin, 'o.userRole = roleDefaultFor');
  has('finishOnboarding mirrors the province for Invoice/P&L', fin, 'homeProvince');

  has('office skip list = the four driver-homework steps', appSrc,
    "var ONB_OFFICE_SKIP = ['base', 'truck', 'odometer', 'safety']");
  const render = sliceFrom(appSrc, 'function renderOnbStep() {', 900);
  has('renderOnbStep snaps past role-hidden steps', render, 'onbStepVisible');
  has('renderOnbStep counts VISIBLE steps', render, 'onbVisibleCount');
  has('role nudge renders at the question', appSrc, 'id="onb_role_warn"');

  has('company step collects country', appSrc, 'id="ob_country"');
  has('company step collects province (code select)', appSrc, 'id="ob_prov"');
  const collect = sliceFrom(appSrc, 'function collectOnbInputs() {', 2400);
  has('collectOnbInputs reads the country', collect, "o.country = g('ob_country')");
  has('collectOnbInputs reads the province', collect, "o.province = g('ob_prov')");

  const trial = sliceFrom(appSrc, 'function syncTrial() {', 1900);
  has('Beta banner hides for the office face', trial, "App.userRole() === 'office'");
  has('Beta banner hide keeps the tier unlock (flag untouched)', trial, "App.userTier = 'premium'");
}

/* ================= fake DOM (cf. dispatch-close-test) ================= */
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
FakeEl.prototype.fire = function (type) {
  const self = this;
  (this._listeners[type] || []).slice().forEach(function (fn) { fn({ target: self }); });
};
FakeEl.prototype.click = function () { if (this.onclick) this.onclick({ target: this }); };
FakeEl.prototype.scrollIntoView = function () { this._scrolled = (this._scrolled || 0) + 1; };
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };

/* stubs for the elements a rendered HTML string advertises: parse the
   tags carrying `attr` and hand back one stub per tag, with every
   attribute readable — paintIngest / Connect wire onclick onto these,
   exactly like the browser wires the real buttons. */
function tagStubs(html, attr) {
  const out = [];
  const re = new RegExp('<[a-zA-Z0-9]+[^>]*?\\b' + attr + '="([^"]*)"[^>]*>', 'g');
  let m;
  while ((m = re.exec(String(html))) !== null) {
    const attrs = {};
    const are = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
    let am;
    while ((am = are.exec(m[0])) !== null) attrs[am[1]] = am[2];
    out.push({ _attrs: attrs, onclick: null, getAttribute: function (n) { return (n in this._attrs) ? this._attrs[n] : null; } });
  }
  return out;
}
/* the ingest wrap: its buttons are found in its own rendered HTML.
   Stubs are CACHED per HTML snapshot — the module wires onclick onto
   the instances IT queried; the test must click those same instances. */
function IngestEl() { FakeEl.call(this, '#dp_ingest'); }
IngestEl.prototype = Object.create(FakeEl.prototype);
IngestEl.prototype.querySelectorAll = function (sel) {
  if (sel !== '[data-suguse]' && sel !== '[data-sugdismiss]') return [];
  const attr = sel === '[data-suguse]' ? 'data-suguse' : 'data-sugdismiss';
  if (!this._stubCache || this._stubCache.html !== this._html) this._stubCache = { html: this._html, byAttr: {} };
  if (!this._stubCache.byAttr[attr]) this._stubCache.byAttr[attr] = tagStubs(this._html, attr);
  return this._stubCache.byAttr[attr];
};
function BodyEl() { FakeEl.call(this, 'body'); }
BodyEl.prototype = Object.create(FakeEl.prototype);
BodyEl.prototype.querySelector = function (sel) {
  if (sel === '#dp_ingest') return this._kids[sel] || (this._kids[sel] = new IngestEl());
  return FakeEl.prototype.querySelector.call(this, sel);
};

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
  const mem = {};
  return {
    mem: mem,
    getItem: function (k) { return (k in mem) ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; }
  };
}

/* ================= (d) Dispatch module, driven ================= */
const TODAY = todayStr();
function activeToday() {
  return {
    id: 'dtoday', date: TODAY, time: '08:00', scheduledAt: TODAY + 'T08:00',
    jobSite: 'Aecon Infrastructure', notes: 'Go to Ivor East Pond empty',
    truckType: 'Tandem', equipment: 'Tandem', loads: '1', amount: '', netWeight: '',
    ticketNo: '', driverId: '', driverName: '', tickets: [], photo: null,
    status: 'active', startedAt: Date.now() - 3600 * 1000
  };
}
function makeDspWorld(role) {
  const backing = makeLocal();
  const alerts = [];
  const sb = {
    console: console, document: docStub, localStorage: backing,
    FileReader: FakeFileReader, Image: FakeImage,
    alert: function (m) { alerts.push(String(m)); },
    confirm: function () { return true; },
    setTimeout: function (fn, ms) { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; },
    requestAnimationFrame: function (fn) { fn(); },
    location: { search: '', pathname: '/' },
    history: { replaceState: function () {} },
    URLSearchParams: URLSearchParams,
    Meticulous: { modules: {} }
  };
  sb.window = sb;
  sb.App = {
    _store: null,
    _today: function () { return TODAY; },
    _esc: function (s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    userRole: function () { return role; }
  };
  vm.createContext(sb);
  vm.runInContext(extractStore(), sb);
  sb.App._store = sb.store;
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(ingestSrc, sb);
  vm.runInContext(dspSrc, sb);
  const revLog = [];
  sb.Meticulous.modules.revenue = { addEntry: function (e) { revLog.push(e); } };
  sb.store.set('onboarding', { payStandard: 'hourly', payRate: 29, travelBonus: 1 });
  const body = new BodyEl();
  return { sb, body, store: sb.store, alerts, revLog,
    render: function () { sb.Meticulous.modules.dispatch.render(body); } };
}

console.log('(d) Dispatch — the Use tap, driven end to end (Oct 14 19:22 field report)');
{
  const w = makeDspWorld('driver');
  w.store.set('dsp_list', [activeToday()]);
  w.store.set('dsp_active', activeToday());
  const entry = w.sb.DispatchIngest.intake('Tomorrow 8:00am\nTandem\nAecon Inf\nGo Empty To A2-L20:', 'paste');
  ok('setup: suggestion filed from the message', !!entry);
  const listBefore = JSON.stringify(w.store.get('dsp_list'));
  const activeBefore = JSON.stringify(w.store.get('dsp_active'));

  w.render();
  const wrap = w.body.querySelector('#dp_ingest');
  has('suggestions card renders the suggestion', wrap.innerHTML, 'Suggested dispatches');
  const useBtns = wrap.querySelectorAll('[data-suguse]');
  eq('one Use button wired', useBtns.length, 1);
  eq('Use button targets the suggestion', useBtns[0].getAttribute('data-suguse'), entry.id);

  useBtns[0].onclick();

  const draft = w.store.get('dsp_draft', null);
  ok('Use wrote the v48 draft', !!draft && !draft.editId);
  eq('draft carries the job site', draft.fields.jobSite, 'Aecon Inf');
  eq('draft carries the scheduled time', draft.fields.scheduledAt, tomorrowStr() + 'T08:00');
  eq('draft carries the equipment', draft.fields.equipment, 'Tandem');
  eq('FORM shows the job site (the load is visible)', w.body.querySelector('#dp_site').value, 'Aecon Inf');
  eq('FORM shows the scheduled time', w.body.querySelector('#dp_when').value, tomorrowStr() + 'T08:00');
  eq('FORM shows the equipment', w.body.querySelector('#dp_equip').value, 'Tandem');
  has('FORM banner names the load (not a silent draft)', w.body.querySelector('#dp_draft_note').innerHTML, 'Loaded from your suggestions');
  has('FORM banner names the suggestion', w.body.querySelector('#dp_draft_note').innerHTML, 'Aecon Inf');
  ok('form card was scrolled to (v75 repeated scroll)', (w.body.querySelector('#dp_form_card')._scrolled || 0) >= 1);
  eq('suggestion consumed by Use', w.sb.DispatchIngest.list().length, 0);
  eq('Use created NO record (list byte-identical)', JSON.stringify(w.store.get('dsp_list')), listBefore);
  eq('today\'s active dispatch untouched by Use', JSON.stringify(w.store.get('dsp_active')), activeBefore);
  lacks('suggestion row gone after Use', w.body.querySelector('#dp_ingest').innerHTML, 'data-suguse');

  /* Save — still the ONLY record-creating step */
  w.body.querySelector('#dp_addstart').click();
  const list = w.store.get('dsp_list');
  eq('Save created exactly ONE new record', list.length, 2);
  const rec = list.filter(function (d) { return d.id !== 'dtoday'; })[0];
  ok('new record exists', !!rec);
  /* the app's canonical record date is dspRecordDate — scheduledAt
     wins over the raw date field, so assert the date the app itself
     will file this record under */
  eq('new record is for the suggestion\'s date (dspRecordDate semantics)',
    String(rec.scheduledAt || rec.date).slice(0, 10), tomorrowStr());
  eq('new record carries the scheduled time', rec.scheduledAt, tomorrowStr() + 'T08:00');
  eq('new record carries the job site', rec.jobSite, 'Aecon Inf');
  eq('new record is NOT started (future date)', rec.status, 'saved');
  eq('today\'s record byte-identical after Save',
    JSON.stringify(list.filter(function (d) { return d.id === 'dtoday'; })[0]),
    listBefore === '' ? '' : JSON.stringify(JSON.parse(listBefore)[0]));
  eq('active pointer still today\'s dispatch', (w.store.get('dsp_active') || {}).id, 'dtoday');
  eq('draft cleared by the verified save', w.store.get('dsp_draft', null), null);
}

console.log('(d2) Dispatch — a busy form refuses Use LOUDLY, at the tap');
{
  const w = makeDspWorld('driver');
  const entry = w.sb.DispatchIngest.intake('Tomorrow 8:00am\nTandem\nAecon Inf\nGo Empty To A2-L20:', 'paste');
  ok('setup: suggestion filed', !!entry);
  w.store.set('dsp_draft', { fields: { jobSite: 'Typed already' }, tickets: [], photo: null, editId: null, savedAt: Date.now() });
  w.render();
  const wrap = w.body.querySelector('#dp_ingest');
  const useBtns = wrap.querySelectorAll('[data-suguse]');
  eq('Use button wired', useBtns.length, 1);
  useBtns[0].onclick();
  eq('suggestion NOT consumed by a refused Use', w.sb.DispatchIngest.list().length, 1);
  eq('busy draft untouched', (w.store.get('dsp_draft') || {}).fields.jobSite, 'Typed already');
  eq('no record created by a refused Use', w.store.get('dsp_list', []).length, 0);
  has('refusal explained AT THE TAP (top of the card)', wrap.innerHTML, 'unsaved dispatch in the form below');
}

console.log('(d3) Dispatch — the office face (F3)');
{
  const w = makeDspWorld('office');
  w.render();
  has('office: the save button is a plain Save', w.body.innerHTML, 'id="dp_add">Save</button>');
  lacks('office: no "Save & start" anywhere', w.body.innerHTML, 'Save & start');
  lacks('office: no dp_addstart button', w.body.innerHTML, 'dp_addstart');
  has('office: the honest local line is in the view', w.body.innerHTML,
    'Dispatches are saved on this device — sending them to your drivers arrives with Connect Phase 2.');

  const w2 = makeDspWorld('office');
  const saved = Object.assign(activeToday(), { id: 'dsaved', status: 'saved', startedAt: null });
  w2.store.set('dsp_list', [saved, activeToday()]);
  w2.store.set('dsp_active', activeToday());
  w2.render();
  has('office: active card reads saved-on-device', w2.body.innerHTML, 'Saved on this device');
  lacks('office: no "In progress" claim', w2.body.innerHTML, '● In progress');
  lacks('office: no Started row', w2.body.innerHTML, '<span>Started</span>');
  lacks('office: history offers no Start button', w2.body.innerHTML, 'data-start=');

  const w3 = makeDspWorld('driver');
  w3.store.set('dsp_list', [Object.assign(activeToday(), { id: 'dsaved', status: 'saved', startedAt: null })]);
  w3.render();
  has('driver: Save & start still offered', w3.body.innerHTML, 'Save & start');
  has('driver: history Start still offered', w3.body.innerHTML, 'data-start=');
}

/* ================= (e) Connect — two cards, real content ================= */
function CEl() { this._html = ''; this._kids = {}; this.value = ''; this.checked = false; }
Object.defineProperty(CEl.prototype, 'innerHTML', {
  get: function () { return this._html; },
  set: function (v) { this._html = String(v); this._kids = {}; }
});
CEl.prototype.querySelector = function (sel) {
  return this._kids[sel] || (this._kids[sel] = new CEl());
};
CEl.prototype.querySelectorAll = function (sel) {
  const m = /\[([a-zA-Z0-9_-]+)\]/.exec(sel);
  if (!m) return [];
  if (!this._stubCache || this._stubCache.html !== this._html) this._stubCache = { html: this._html, byAttr: {} };
  if (!this._stubCache.byAttr[m[1]]) this._stubCache.byAttr[m[1]] = tagStubs(this._html, m[1]);
  return this._stubCache.byAttr[m[1]];
};

console.log('(e) Connect — two cards, content-carrying shares (F7 + owner directive)');
{
  const stripped = conSrc.replace(/\/\*[\s\S]*?\*\//g, '');
  lacks('connect code: no native alert()', stripped, 'alert(');
  lacks('connect code: no native confirm()', stripped, 'confirm(');
  eq('connect renders exactly TWO cards', (conSrc.match(/'<div class="card">/g) || []).length, 2);
  lacks('no "Phase 1 — local only" banner card (code, comments stripped)', stripped, 'Phase 1 — local only');
  lacks('no standalone "Share something" card (code, comments stripped)', stripped, 'Share something');
  lacks('old persisted showAdd key gone', conSrc, 'showAdd');
  has('picker names dispatches by jobSite first', conSrc, 'd.jobSite || d.site');
  has('shares package the item content', conSrc, 'content: item.content || null');

  const backing = makeLocal();
  const alerts = [], confirms = [];
  const sb = {
    console: console, document: docStub, localStorage: backing,
    alert: function (m) { alerts.push(String(m)); },
    confirm: function () { confirms.push(1); return true; },
    Meticulous: { modules: {} }
  };
  sb.window = sb;
  sb.App = {
    _store: null,
    _esc: function (s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  };
  vm.createContext(sb);
  vm.runInContext(extractStore(), sb);
  sb.App._store = sb.store;
  vm.runInContext(conSrc, sb);
  const store = sb.store;
  store.set('con_list', [{ id: 'c1', name: 'Boss Man', role: 'Fleet manager', contact: '' }]);
  store.set('con_outbox', [{ type: 'dispatch', kind: 'Dispatch', label: 'Dispatch', to: 'Boss Man', ts: 1730000000000, note: '' }]); // legacy v75 stub
  store.set('dsp_list', [{ id: 'd9', date: '2026-10-15', jobSite: 'Ivor East Pond', scheduledAt: '2026-10-15T08:00',
    equipment: 'Tandem', material: 'Common', ticketNo: '23177', notes: 'Go empty' }]);

  const body = new CEl();
  const render = function () { sb.Meticulous.modules.connect.render(body); };
  render();
  has('card 1: Current connections', body.innerHTML, 'Current connections');
  has('card 2: History', body.innerHTML, 'History');
  lacks('rendered: no Phase-1 banner', body.innerHTML, 'Phase 1 — local only');
  lacks('rendered: no Share-something card', body.innerHTML, 'Share something');
  has('the honest line is ONE quiet line in the module', body.innerHTML, 'Shares are packaged on this device');
  has('connection listed', body.innerHTML, 'Boss Man');
  has('legacy stub still renders in History', body.innerHTML, 'Queued — on this device');
  has('status counts the connection', sb.Meticulous.modules.connect.status(), '1 connection');

  /* open this connection's dispatch picker and send the real dispatch */
  const quicks = body.querySelectorAll('[data-quick]').filter(function (b) { return b.getAttribute('data-quick') === 'dispatch'; });
  eq('per-connection Send dispatch button wired', quicks.length, 1);
  quicks[0].onclick();
  has('picker names the dispatch by its job site', body.innerHTML, 'Ivor East Pond');
  const picks = body.querySelectorAll('[data-pick]');
  eq('picker offers the one saved dispatch', picks.length, 1);
  picks[0].onclick();
  const ob = store.get('con_outbox');
  eq('outbox grew by exactly one', ob.length, 2);
  const sent = ob[1];
  eq('share type is dispatch', sent.type, 'dispatch');
  eq('share addressed to the connection', sent.to, 'Boss Man');
  has('share label carries the real name', sent.label, 'Ivor East Pond');
  ok('share carries CONTENT (not a stub)', !!sent.content);
  eq('content jobSite', sent.content.jobSite, 'Ivor East Pond');
  eq('content scheduledAt', sent.content.scheduledAt, '2026-10-15T08:00');
  eq('content ticket number rides along', sent.content.ticketNo, '23177');
  has('queued flash confirms where it waits', body.innerHTML, 'queued for Boss Man');
  has('history shows the content summary', body.innerHTML, 'Ivor East Pond');
  eq('no native alert was used anywhere', alerts.length, 0);
  eq('no native confirm was used anywhere', confirms.length, 0);
}

/* ================= (f) Revenue / Preferences / Invoice guards ================= */
console.log('(f) office-hidden plumbing + invoice location bridge (F5/F6/F8)');
{
  const rvGuard = sliceFrom(revSrc, 'var rvIsOffice', 460);
  has('revenue: office flag computed from the live role', rvGuard, "(App.userRole ? App.userRole() : 'driver') === 'office'");
  has('revenue: auto-start card inside the office guard', rvGuard, 'if (!rvIsOffice)');
  has('revenue: card still rendered for drivers', rvGuard, "settingsHTML('rv')");
  has('revenue: save wiring null-guarded', revSrc, 'if (rvAsSave)');

  has('preferences: odometer block is role-conditional', prefSrc, "if (effRole !== 'office')");
  has('preferences: save guards the missing odometer field', prefSrc, "body.querySelector('#pf_odo')");
  has('preferences: save guards the missing photos toggle', prefSrc, 'odoTglSave');

  has('invoice: province-name → code bridge exists', invSrc, 'CA_NAME2CODE');
  has('invoice: bridge reads homeProvince', invSrc, 'o.homeProvince && CA_NAME2CODE[o.homeProvince]');
  has('invoice: GST table untouched', invSrc, 'AB: 5, BC: 5, MB: 5, NB: 15');
}

/* ================= version coherence ================= */
['js/app.js', 'modules/dispatch.js', 'modules/connect.js', 'modules/revenue.js', 'modules/preferences.js', 'modules/invoice.js']
  .forEach(function (f) {
    has('index.html pins ' + f + ' to webVersion ' + ver.webVersion, idxSrc, 'src="' + f + '?v=' + ver.webVersion + '"');
  });

console.log('boss-firstrun-test: ' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
