#!/usr/bin/env node
/* Meticulous v73 — CLOSE WITH TICKET PHOTO (owner, Oct 14: the
 * ticket photo should BE the close of the dispatch, not an
 * attachment chore inside Edit plus a separate Complete tap).
 *
 * Behavioral tests against the REAL modules/dispatch.js, loaded
 * whole into a vm sandbox over the REAL App._store (extracted from
 * js/app.js) on a quota-failable localStorage stub, plus the REAL
 * js/ticket-ocr.js (only recognizeWithRotation is stubbed — the
 * parse/summary engines are the shipping ones) and a minimal fake
 * DOM. The module is DRIVEN like a finger: tap "📸 Close with
 * ticket photo" → pick the photo → read the confirm view → type
 * the hours → tap Confirm.
 *
 * Covers:
 *  (a) happy path — haul card read (card #23177), typed foreman
 *      hours, confirm preview shows the exact plan, one Confirm:
 *      dispatch completed + active cleared + ticket attached with
 *      the photo stored ONCE + the Revenue entry deep-equals the
 *      DSP-COMPLETE plan output for the same closed record
 *  (b) weak read — the OCR engine fails outright: the SAME confirm
 *      view says so, takes typed hours, and closes identically
 *      (photo still attached; never a dead end, never a 2nd form)
 *  (c) failed save — quota failure at Confirm: plain error in the
 *      view, dispatch STILL ACTIVE, nothing logged, and the retry
 *      closes cleanly with no duplicate ticket
 *  (d) busy draft — an unfinished EDIT draft on this dispatch
 *      blocks the close with plain words; draft + dispatch +
 *      revenue all untouched
 *  (e) plain Complete-without-photo regression — the pre-v73 button
 *      still completes and logs the identical plan entry
 *  (f) pure-region units (dspBuildClosed / dspCloseRecord /
 *      dspCloseBlocked) + statics (button, no new native dialogs,
 *      index.html pin coherence)
 * Run: node tools/dispatch-close-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const dspSrc = fs.readFileSync(path.join(ROOT, 'modules', 'dispatch.js'), 'utf8');
const ocrSrc = fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8');
const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
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

/* ---------------- fixtures ---------------- */
const TODAY = '2026-10-14';
const THUMB = 'data:image/jpeg;base64,THUMB';
const CARD_TEXT = [
  'AECON', 'DAILY TRUCK HAUL CARD', 'Project: IFTI', 'Date: Oct 14, 2026',
  'Carrier: AI Trucking', 'Truck No: 07', 'Pit: On-site',
  'START TIME 8:00 AM  FINISH TIME 5:30 PM  TOTAL HOURS 9.5',
  'PAYMENT UNIT  HOUR  TONNE  TONNE / KM', 'OPERATOR SIGNATURE', '23177'
].join('\n');
const SETT = { std: 'hourly', rate: 29, travelBonus: 1, role: 'driver', driver: null, today: TODAY };
function activeDispatch() {
  return {
    id: 'dclose1', date: TODAY, time: '08:00', scheduledAt: TODAY + 'T08:00',
    jobSite: 'Aecon Infrastructure', notes: 'Go to Ivor East Pond empty',
    truckType: 'Tandem', equipment: 'Tandem', loads: '1', amount: '', netWeight: '',
    ticketNo: '', driverId: '', driverName: '', tickets: [], photo: null,
    status: 'active', startedAt: Date.parse(TODAY + 'T07:26:00')
  };
}

/* ---------------- fake DOM ---------------- */
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
        toDataURL: function () { return THUMB; } };
    }
    return new FakeEl(tag);
  },
  querySelector: function () { return null; },
  addEventListener: function () {}
};

/* ---------------- worlds ---------------- */
function makeLocal(failFlag) {
  const mem = {};
  return {
    mem: mem,
    getItem: function (k) { return (k in mem) ? mem[k] : null; },
    setItem: function (k, v) {
      if (failFlag.on) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
      mem[k] = String(v);
    },
    removeItem: function (k) { delete mem[k]; }
  };
}
function flush() {
  return new Promise(function (res) {
    let n = 0;
    (function step() { if (++n > 40) return res(); setTimeout(step, 0); })();
  });
}
function makeRegionWorld() {
  const failFlag = { on: false };
  const backing = makeLocal(failFlag);
  const sb = { console: console, document: docStub, localStorage: backing };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(extractStore(), sb);
  sb.App = { _store: sb.store, _today: function () { return TODAY; } };
  vm.runInContext(ocrSrc, sb);
  const regions = extractRegion(dspSrc, 'DSP-SAVE-BEGIN', 'DSP-CLOSE-END');
  vm.runInContext(regions, sb);
  return { sb: sb, store: sb.store, backing: backing, failFlag: failFlag };
}
function makeModuleWorld(recognize) {
  const failFlag = { on: false };
  const backing = makeLocal(failFlag);
  const revLog = [], alerts = [];
  const sb = {
    console: console, document: docStub, localStorage: backing,
    FileReader: FakeFileReader, Image: FakeImage,
    alert: function (m) { alerts.push(String(m)); },
    confirm: function () { return true; },
    Meticulous: { modules: {} }
  };
  sb.window = sb;
  sb.App = {
    _store: null,
    _today: function () { return TODAY; },
    _esc: function (s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    userRole: function () { return 'driver'; }
  };
  vm.createContext(sb);
  vm.runInContext(extractStore(), sb);
  sb.App._store = sb.store;
  vm.runInContext(ocrSrc, sb);
  sb.TicketOCR.recognizeWithRotation = recognize;
  vm.runInContext(dspSrc, sb);
  sb.Meticulous.modules.revenue = {
    addEntry: function (e) { revLog.push(JSON.parse(JSON.stringify(e))); }
  };
  const body = new FakeEl('body');
  const store = sb.store;
  store.set('onboarding', { payStandard: 'hourly', payRate: 29, travelBonus: 1 });
  return {
    sb: sb, body: body, store: store, backing: backing, failFlag: failFlag,
    revLog: revLog, alerts: alerts,
    render: function () { sb.Meticulous.modules.dispatch.render(body); },
    flow: function () { return body.querySelector('#dp_closeflow'); },
    seedActive: function (d) {
      store.set('dsp_list', [JSON.parse(JSON.stringify(d))]);
      store.set('dsp_active', JSON.parse(JSON.stringify(d)));
    }
  };
}
function expectedEntry(regionWorld, closedRec) {
  return regionWorld.sb.dspCompletionFor(JSON.parse(JSON.stringify(closedRec)), SETT).plan.entry;
}

/* drive the capture step: tap Close, pick the photo, land on confirm */
async function driveToConfirm(w) {
  w.body.querySelector('#dp_close_ticket').click();
  const flow = w.flow();
  check('capture step offers camera + file (two-button rule)',
    flow.innerHTML.indexOf('id="dp_ct_cam"') >= 0 && flow.innerHTML.indexOf('id="dp_ct_pick"') >= 0);
  const input = flow.querySelector('#dp_ct_img');
  input.files = [{ name: 'haul-card.jpg' }];
  input.onchange({ target: input });
  await flush();
  return flow;
}

(async function main() {
  const RW = makeRegionWorld();

  /* ---------------- (f) pure-region units ---------------- */
  {
    eq('f: no draft → not blocked', RW.sb.dspCloseBlocked(null, 'dclose1'), '');
    eq('f: create-draft (no editId) → not blocked', RW.sb.dspCloseBlocked({ fields: {} }, 'dclose1'), '');
    eq('f: edit draft for ANOTHER dispatch → not blocked', RW.sb.dspCloseBlocked({ editId: 'other' }, 'dclose1'), '');
    check('f: edit draft for THIS dispatch → blocked, plain words',
      RW.sb.dspCloseBlocked({ editId: 'dclose1' }, 'dclose1').indexOf('Nothing was closed.') >= 0);
    const orig = activeDispatch();
    const before = JSON.stringify(orig);
    const ticket = { id: 't1', photo: THUMB, ocrType: 'haul_card', cardNumber: '23177', foremanHours: '9.5', paymentUnit: 'HOUR' };
    const closed = RW.sb.dspBuildClosed(orig, ticket, 123456);
    eq('f: buildClosed does not mutate the open record', JSON.stringify(orig), before);
    eq('f: closed status', closed.status, 'completed');
    eq('f: closed endedAt', closed.endedAt, 123456);
    eq('f: ticket appended once', closed.tickets.length, 1);
    eq('f: photo stored once — top-level cleared when tickets carry it', closed.photo, null);
    const legacy = RW.sb.dspBuildClosed(Object.assign(activeDispatch(), { photo: 'data:OLD' }), null, 99);
    eq('f: no-ticket close keeps the legacy top-level photo', legacy.photo, 'data:OLD');
    RW.store.set('dsp_list', []); RW.store.set('dsp_active', null);
    eq('f: close of a missing record reports missing',
      RW.sb.dspCloseRecord(closed), { ok: false, stage: 'missing' });
  }

  /* ---------------- (a) happy path ---------------- */
  {
    const w = makeModuleWorld(function () { return Promise.resolve(CARD_TEXT); });
    w.seedActive(activeDispatch());
    w.render();
    check('a: active card carries the close-with-ticket action',
      w.body.innerHTML.indexOf('id="dp_close_ticket"') >= 0 &&
      w.body.innerHTML.indexOf('📸 Close with ticket photo') >= 0);
    check('a: plain Complete still on the card', w.body.innerHTML.indexOf('id="dp_complete"') >= 0);
    const listBefore = JSON.stringify(w.store.get('dsp_list', []));
    const flow = await driveToConfirm(w);
    check('a: confirm view reached after the read', flow.innerHTML.indexOf('id="dp_cf_confirm"') >= 0);
    check('a: confirm view names the card that was read', flow.innerHTML.indexOf('Haul card #23177') >= 0);
    check('a: NOTHING written before Confirm (list byte-identical)',
      JSON.stringify(w.store.get('dsp_list', [])) === listBefore);
    eq('a: dispatch still active before Confirm', (w.store.get('dsp_active', null) || {}).id, 'dclose1');
    eq('a: no revenue before Confirm', w.revLog.length, 0);

    const hours = flow.querySelector('#dp_cf_hours');
    hours.value = '9.5'; hours.fire('input');
    check('a: preview shows the exact earnings Confirm will log ($304.50)',
      flow.querySelector('#dp_cf_plan').innerHTML.indexOf('$304.50') >= 0);
    check('a: preview shows the plan note (foreman + travel split)',
      flow.querySelector('#dp_cf_plan').innerHTML.indexOf('foreman 9.5h + travel 1h = 10.5h') >= 0);

    flow.querySelector('#dp_cf_confirm').click();
    const list = w.store.get('dsp_list', []);
    eq('a: still exactly one dispatch record', list.length, 1);
    const rec = list[0];
    eq('a: dispatch completed', rec.status, 'completed');
    check('a: endedAt stamped', typeof rec.endedAt === 'number' && rec.endedAt > 0);
    eq('a: active cleared', w.store.get('dsp_active', null), null);
    eq('a: ticket attached once', rec.tickets.length, 1);
    eq('a: ticket carries the read card number', rec.tickets[0].cardNumber, '23177');
    eq('a: ticket carries the confirmed hours', rec.tickets[0].foremanHours, '9.5');
    eq('a: photo stored ONCE in the whole record',
      JSON.stringify(rec).split(THUMB).length - 1, 1);
    eq('a: top-level photo cleared (photo lives in tickets[])', rec.photo, null);
    eq('a: exactly one Revenue entry logged', w.revLog.length, 1);
    eq('a: Revenue entry deep-equals the DSP-COMPLETE plan for the same record',
      w.revLog[0], expectedEntry(RW, rec));
    eq('a: entry amount', w.revLog[0].amount, '304.50');
    eq('a: entry hours (foreman + travel)', w.revLog[0].hours, '10.50');
    eq('a: entry foremanHours split', w.revLog[0].foremanHours, 9.5);
    eq('a: entry travelHours split', w.revLog[0].travelHours, 1);
    check('a: completion announced like plain Complete', w.alerts.some(function (a) { return a.indexOf('Dispatch completed.') === 0; }));
  }

  /* ---------------- (b) weak read: engine fails ---------------- */
  {
    const w = makeModuleWorld(function () { return Promise.reject(new Error('ocr down')); });
    w.seedActive(activeDispatch());
    w.render();
    const flow = await driveToConfirm(w);
    check('b: failed read still lands on the SAME confirm view (no dead end)',
      flow.innerHTML.indexOf('id="dp_cf_confirm"') >= 0);
    check('b: confirm view says plainly the photo could not be read',
      flow.innerHTML.indexOf('couldn\'t be read') >= 0 || flow.innerHTML.indexOf('couldn’t be read') >= 0);
    check('b: the same view takes typed hours', flow.innerHTML.indexOf('id="dp_cf_hours"') >= 0);
    flow.querySelector('#dp_cf_hours').value = '9.5';
    flow.querySelector('#dp_cf_hours').fire('input');
    check('b: typed hours drive the same plan preview',
      flow.querySelector('#dp_cf_plan').innerHTML.indexOf('$304.50') >= 0);
    flow.querySelector('#dp_cf_confirm').click();
    const rec = w.store.get('dsp_list', [])[0];
    eq('b: dispatch completed on typed hours', rec.status, 'completed');
    eq('b: unread ticket still attached', rec.tickets.length, 1);
    eq('b: unread ticket is honestly typed', rec.tickets[0].ocrType, 'unknown');
    eq('b: photo still stored once (the record)', JSON.stringify(rec).split(THUMB).length - 1, 1);
    eq('b: revenue equals the plan for the same record', w.revLog[0], expectedEntry(RW, rec));
    eq('b: revenue amount matches the typed hours', w.revLog[0].amount, '304.50');
  }

  /* ---------------- (c) failed save keeps everything un-closed ---------------- */
  {
    const w = makeModuleWorld(function () { return Promise.resolve(CARD_TEXT); });
    w.seedActive(activeDispatch());
    w.render();
    const flow = await driveToConfirm(w);
    flow.querySelector('#dp_cf_hours').value = '9.5';
    flow.querySelector('#dp_cf_hours').fire('input');
    w.failFlag.on = true;
    flow.querySelector('#dp_cf_confirm').click();
    check('c: failed close shows a plain in-page error',
      flow.innerHTML.indexOf('did NOT go through') >= 0 || flow.querySelector('#dp_cf_err').innerHTML.indexOf('did NOT go through') >= 0);
    eq('c: dispatch still active after the failed close', (w.store.get('dsp_active', null) || {}).status, 'active');
    eq('c: list copy still open', w.store.get('dsp_list', [])[0].status, 'active');
    eq('c: no ticket written by the failed close', w.store.get('dsp_list', [])[0].tickets.length, 0);
    eq('c: nothing logged to Revenue', w.revLog.length, 0);
    eq('c: no completion announced', w.alerts.length, 0);
    w.failFlag.on = false;
    flow.querySelector('#dp_cf_confirm').click();
    const rec = w.store.get('dsp_list', [])[0];
    eq('c: retry closes the dispatch', rec.status, 'completed');
    eq('c: retry attaches the ticket exactly once (no duplicate)', rec.tickets.length, 1);
    eq('c: retry logs exactly one Revenue entry', w.revLog.length, 1);
  }

  /* ---------------- (d) busy edit draft refuses ---------------- */
  {
    const w = makeModuleWorld(function () { return Promise.resolve(CARD_TEXT); });
    w.seedActive(activeDispatch());
    const draft = {
      fields: { jobSite: 'Aecon Infrastructure', scheduledAt: TODAY + 'T08:00', equipment: 'Tandem',
        lat: '', lng: '', material: '', ticketNo: '', amount: '', loads: '1', notes: 'edited note', driverId: '' },
      photo: null, tickets: [], legacyPhoto: null, editId: 'dclose1', savedAt: Date.now()
    };
    w.store.set('dsp_draft', JSON.parse(JSON.stringify(draft)));
    w.render();
    w.body.querySelector('#dp_close_ticket').click();
    const note = w.body.querySelector('#dp_close_note').innerHTML;
    check('d: refusal is plain and names the unfinished edit',
      note.indexOf('unfinished edit') >= 0 && note.indexOf('Nothing was closed.') >= 0, note.slice(0, 120));
    check('d: capture sheet never opened', w.flow().innerHTML.indexOf('dp_ct_cam') < 0);
    eq('d: the edit draft is untouched', w.store.get('dsp_draft', null), draft);
    eq('d: dispatch still active', (w.store.get('dsp_active', null) || {}).status, 'active');
    eq('d: nothing logged', w.revLog.length, 0);
  }

  /* ---------------- (e) plain Complete regression ---------------- */
  {
    const w = makeModuleWorld(function () { return Promise.resolve(CARD_TEXT); });
    const d = activeDispatch();
    d.tickets = [{ id: 't0', photo: THUMB, ocrType: 'haul_card', cardNumber: '23177',
      foremanHours: '9.5', paymentUnit: 'HOUR', netWeight: null, date: TODAY }];
    w.seedActive(d);
    w.render();
    w.body.querySelector('#dp_complete').click();
    const rec = w.store.get('dsp_list', [])[0];
    eq('e: plain Complete completes the dispatch', rec.status, 'completed');
    eq('e: plain Complete clears active', w.store.get('dsp_active', null), null);
    eq('e: existing ticket kept as-is', rec.tickets.length, 1);
    eq('e: plain Complete logs the identical plan entry', w.revLog[0], expectedEntry(RW, rec));
    eq('e: plain Complete amount', w.revLog[0].amount, '304.50');
  }

  /* ---------------- statics ---------------- */
  {
    check('s: close action wired on the active card', dspSrc.indexOf('id="dp_close_ticket"') >= 0);
    check('s: confirm is ONE button doing the whole close', dspSrc.indexOf('Confirm — close this dispatch') >= 0);
    check('s: verified close transaction exists and is used', /function dspCloseRecord/.test(dspSrc) && dspSrc.indexOf('dspCloseRecord(doneRec)') >= 0);
    check('s: preview and Confirm share the one money assembly',
      dspSrc.indexOf('dspCompletionFor(preview, completionSettings(preview))') >= 0 &&
      dspSrc.indexOf('dspCompletionFor(cur, completionSettings(cur))') >= 0);
    const dialogs = (dspSrc.match(/(alert|confirm)\(/g) || []).length;
    /* v103: the count DROPS by one on purpose — the history
       delete confirm moved in-app (dispatch-delete-test drives
       it); no NEW native dialog may appear. */
    eq('s: native dialog count (v103: delete confirm is in-app; 3 remain)', dialogs, 3);
    check('s: index.html loads dispatch.js at ?v=<webVersion>',
      idxSrc.indexOf('modules/dispatch.js?v=' + ver.webVersion) >= 0);
  }

  console.log('\ndispatch-close test: ' + pass + '/' + (pass + fail) + ' passed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
