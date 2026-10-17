#!/usr/bin/env node
/* Meticulous v129 — THE COMPLETED FACE: a closed dispatch must
 * LOOK closed (owner, Oct 17, 2026 — his Oct 16 Aecon dispatch,
 * ticket #22729, opened on a half-empty Edit form: Material
 * blank, Ticket # blank, Amount 0.00, though the day was closed
 * at 11.0 h / $319.00; his words: "Can you close that dispatch
 * with that picture? I sent you yesterday?").
 *
 * Behavioral tests against the REAL shipped code:
 *  - a REGION world: the DSP-SAVE..DSP-COMPLETED regions verbatim
 *    from modules/dispatch.js + the REAL App._store + the REAL
 *    ticket-ocr.js + the REAL INV-CYCLE region from
 *    modules/invoice.js (so Meticulous.shared.buildRevenueLines /
 *    dayLoads are the shipping builders, not stubs);
 *  - a MODULE world: the whole modules/dispatch.js driven like a
 *    finger over a stub DOM (the dispatch-delete button-parsing
 *    pattern + the dispatch-close FakeEl pattern).
 *
 * Covers:
 *  (a) the facts miner: parsed ticket fields win; a stored
 *      docRead report is mined through the gibberish gate (a
 *      dirty entry is never a fact); dspCloseFactsFor heals the
 *      owner's Oct 16 shape; dspEditFieldsFor heals with it
 *  (b) dspApplyCloseFacts: fill-only for ticket #/material (a
 *      typed value wins), the plan amount stamps, the ticket
 *      gains its own mined facts, the input is not mutated
 *  (c) dspCompletedFace on the Oct 16 shape: healed ticket # /
 *      material / hours (10 + 1 = 11), the amount from the
 *      shared builder (a same-day tracker entry does NOT stack —
 *      the v107 one-money-truth), the photo present, and the
 *      stored record byte-identical afterwards (read-only)
 *  (d) edit safety (dspApplyEdit): on a COMPLETED record, blank
 *      close-fact fields keep the close's values, carried values
 *      still correct them, other fields edit freely; on an open
 *      record nothing is guarded
 *  (e) the face in the real render: a completed history row
 *      offers View, not Edit; View opens the summary (not the
 *      edit form); Edit lives inside the face; Done closes it
 *  (f) both close paths stamp the record: ticket-photo close
 *      (ticket # + plan amount), manual Complete (ticket # /
 *      material mined from the ticket's own read + plan amount,
 *      stamped onto the ticket too)
 *  (g) the edit-save stomp, driven end-to-end: open the face →
 *      Edit this record → clear the close-fact fields → Save
 *      changes → the stored record still carries its close
 *      facts (and the form said so before the save)
 * Run: node tools/dispatch-completed-test.js
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
const PHOTO = 'data:image/jpeg;base64,CARD22729';
/* The owner's Oct 16 record shape: completed, the close's hours
   and pay in Revenue, the ticket on the record as the card PHOTO
   with a stored read report — and NO parsed fields anywhere. */
function oct16Record() {
  return {
    id: 'd-oct16', jobSite: 'Aecon Inf', date: '2026-10-16',
    scheduledAt: '2026-10-16T08:00', equipment: 'Tandem',
    material: '', ticketNo: '', amount: '', loads: '1', loadsSet: false,
    notes: 'Go Empty To A2-L20', driverId: '', driverName: '',
    tickets: [{
      id: 't-oct16', photo: PHOTO, ocrType: 'haul_card',
      ticketNo: null, cardNumber: null, foremanHours: '10',
      docRead: { found: ['ticket #22729', 'material Clay'], missing: ['scheduled time', 'notes'] },
      date: '2026-10-16'
    }],
    photo: null, status: 'completed', endedAt: Date.parse('2026-10-16T19:00:00')
  };
}
function oct16Entries() {
  return [
    { date: '2026-10-16', amount: '319.00', hours: '11.00', type: 'hourly', dspId: 'd-oct16',
      note: 'Dispatch: Aecon Inf · foreman 10h + travel 1h = 11h' },
    /* the same day's tracker session — the builder must NOT
       stack it on the dispatch line (the $601.75 lesson) */
    { date: '2026-10-16', amount: '282.75', hours: '9.75', type: 'hourly', auto: true,
      note: 'Auto from tracker' }
  ];
}

/* ---------------- fake DOM (module world) ---------------- */
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

function makeBody() {
  const body = new FakeEl('body');
  body._btnCache = {};
  /* data-* buttons are parsed from the CURRENT html and cached
     per paint (the dispatch-delete pattern) — the module wires
     its handlers onto the parsed rows. */
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
function flush() {
  return new Promise(function (res) {
    let n = 0;
    (function step() { if (++n > 40) return res(); setTimeout(step, 0); })();
  });
}

/* ---------------- region world ---------------- */
function makeRegionWorld() {
  const backing = makeLocal();
  const sb = { console: console, document: docStub, localStorage: backing };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(extractStore(), sb);
  sb.App = { _store: sb.store, _today: function () { return '2026-10-17'; },
    _esc: function (s) { return String(s == null ? '' : s); } };
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(extractRegion(dspSrc, 'DSP-SAVE-BEGIN', 'DSP-COMPLETED-END'), sb);
  return { sb: sb, store: sb.store };
}

/* ---------------- module world ---------------- */
function makeModuleWorld(recognize) {
  const backing = makeLocal();
  const revLog = [], alerts = [];
  const sb = {
    console: console, document: docStub, localStorage: backing,
    FileReader: FakeFileReader, Image: FakeImage, setTimeout: setTimeout,
    alert: function (m) { alerts.push(String(m)); },
    confirm: function () { return true; },
    Meticulous: { modules: {} }
  };
  sb.window = sb;
  sb.App = {
    _store: null,
    _today: function () { return '2026-10-17'; },
    _esc: function (s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    userRole: function () { return 'driver'; }
  };
  vm.createContext(sb);
  vm.runInContext(extractStore(), sb);
  sb.App._store = sb.store;
  vm.runInContext(ocrSrc, sb);
  if (recognize) sb.TicketOCR.recognizeWithRotation = recognize;
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(dspSrc, sb);
  sb.Meticulous.modules.revenue = {
    addEntry: function (e) { revLog.push(JSON.parse(JSON.stringify(e))); }
  };
  const body = makeBody();
  sb.store.set('onboarding', { payStandard: 'hourly', payRate: 29, travelBonus: 1 });
  return { sb: sb, body: body, store: sb.store, revLog: revLog, alerts: alerts,
    render: function () { sb.Meticulous.modules.dispatch.render(body); },
    btns: function (attr) { return body.querySelectorAll('[' + attr + ']'); },
    byVal: function (attr, v) {
      return body.querySelectorAll('[' + attr + ']').filter(function (b) { return b.getAttribute(attr) === v; })[0];
    } };
}

(async function main() {
  /* ================= (a) the facts miner + healing ================= */
  {
    const RW = makeRegionWorld();
    const sb = RW.sb;
    eq('a: parsed ticket fields win', sb.dspTicketFacts([
      { cardNumber: '111', material: 'Sand', docRead: { found: ['ticket #222', 'material Clay'], missing: [] } }
    ]), { ticketNo: '111', material: 'Sand' });
    eq('a: docRead mined when parsed fields are absent', sb.dspTicketFacts([
      { ticketNo: null, cardNumber: null, docRead: { found: ['ticket #22729', 'material Clay'], missing: [] } }
    ]), { ticketNo: '22729', material: 'Clay' });
    const dirty = sb.dspTicketFacts([
      { docRead: { found: ['material ONBNERREEEEARAL HH HHE', 'ticket #22729'], missing: [] } }
    ]);
    eq('a: a gibberish docRead entry is never mined as a fact', dirty, { ticketNo: '22729', material: '' });
    eq('a: no tickets → no facts', sb.dspTicketFacts([]), { ticketNo: '', material: '' });
    eq('a: close facts heal the Oct 16 shape', sb.dspCloseFactsFor(oct16Record()),
      { ticketNo: '22729', material: 'Clay', amount: '' });
    const f = sb.dspEditFieldsFor(oct16Record());
    eq('a: the edit pre-fill heals from the same facts', [f.ticketNo, f.material], ['22729', 'Clay']);
    const stored = sb.dspCloseFactsFor({ ticketNo: 'T-9', material: 'Gravel', amount: '120.50', tickets: [] });
    eq('a: stored fields always win over mined ones', stored, { ticketNo: 'T-9', material: 'Gravel', amount: '120.50' });
  }

  /* ================= (b) dspApplyCloseFacts ================= */
  {
    const RW = makeRegionWorld();
    const sb = RW.sb;
    const plan = { entry: { amount: '319.00', ticketNos: ['22729'] }, claim: null, wagePosting: null };
    const recIn = oct16Record();
    const before = JSON.stringify(recIn);
    const out = sb.dspApplyCloseFacts(recIn, plan);
    eq('b: the input record is not mutated', JSON.stringify(recIn), before);
    eq('b: ticket # stamped from the plan', out.ticketNo, '22729');
    eq('b: material stamped from the ticket read', out.material, 'Clay');
    eq('b: the plan amount stamps (the dollars Revenue got)', out.amount, '319.00');
    eq('b: the ticket itself gains its mined material', out.tickets[0].material, 'Clay');
    eq('b: lifecycle untouched by stamping', [out.status, out.endedAt], ['completed', recIn.endedAt]);
    const typed = oct16Record(); typed.ticketNo = 'TYPED-1'; typed.amount = '50.00';
    const out2 = sb.dspApplyCloseFacts(typed, plan);
    eq('b: a typed ticket # wins over the plan number (fill-only)', out2.ticketNo, 'TYPED-1');
    eq('b: the plan amount still stamps over a stale typed amount', out2.amount, '319.00');
    const noEntry = sb.dspApplyCloseFacts(oct16Record(), { entry: null });
    eq('b: no plan entry → the record amount stands, facts still stamp',
      [noEntry.amount, noEntry.ticketNo], ['', '22729']);
  }

  /* ================= (c) dspCompletedFace: the Oct 16 day, healed ================= */
  {
    const RW = makeRegionWorld();
    const sb = RW.sb, store = RW.store;
    const rec = oct16Record();
    store.set('dsp_list', [JSON.parse(JSON.stringify(rec))]);
    store.set('rev_entries', oct16Entries());
    store.set('rev_extras', []);
    store.set('onboarding', { payStandard: 'hourly', payRate: 29, travelBonus: 1 });
    const listBefore = JSON.stringify(store.get('dsp_list', []));
    const face = sb.dspCompletedFace(rec);
    eq('c: face status + close stamp', [face.status, face.endedAt], ['completed', rec.endedAt]);
    eq('c: face ticket # healed', face.ticketNo, '22729');
    eq('c: face material healed', face.material, 'Clay');
    eq('c: face hours from the tickets (foreman 10 + travel 1 = 11)',
      [face.foremanHours, face.travelHours, face.totalHours], [10, 1, 11]);
    eq('c: face amount from the shared builder — $319.00, the tracker entry does not stack',
      face.amount, 319);
    eq('c: dspDayEarned is the builder number for the day', sb.dspDayEarned('2026-10-16'), 319);
    eq('c: face carries the ticket photo', face.photos, [PHOTO]);
    eq('c: opening the face wrote NOTHING (stored record byte-identical)',
      JSON.stringify(store.get('dsp_list', [])), listBefore);
  }

  /* ================= (d) dspApplyEdit: the completed-record guard ================= */
  {
    const RW = makeRegionWorld();
    const sb = RW.sb;
    const orig = oct16Record();
    orig.ticketNo = '22729'; orig.material = 'Clay'; orig.amount = '319.00';
    const blankForm = { jobSite: 'Aecon Inf', scheduledAt: '2026-10-16T08:00', equipment: 'Tandem',
      lat: null, lng: null, material: '', ticketNo: '', amount: '', loads: '1', loadsSet: false,
      notes: 'corrected note', driverId: '', driverName: '', date: '2026-10-16' };
    const kept = sb.dspApplyEdit(orig, blankForm, orig.tickets, null);
    eq('d: blank close-fact fields keep the close values',
      [kept.ticketNo, kept.material, kept.amount], ['22729', 'Clay', '319.00']);
    eq('d: a non-close field still edits', kept.notes, 'corrected note');
    eq('d: lifecycle still pinned by an edit', [kept.id, kept.status, kept.date],
      ['d-oct16', 'completed', '2026-10-16']);
    const fixForm = JSON.parse(JSON.stringify(blankForm));
    fixForm.ticketNo = '22730'; fixForm.material = 'Gravel'; fixForm.amount = '320.00';
    const fixed = sb.dspApplyEdit(orig, fixForm, orig.tickets, null);
    eq('d: carried values still correct the close facts',
      [fixed.ticketNo, fixed.material, fixed.amount], ['22730', 'Gravel', '320.00']);
    const open = oct16Record(); open.status = 'saved'; open.ticketNo = 'X1'; open.amount = '10.00';
    const openEdit = sb.dspApplyEdit(open, blankForm, open.tickets, null);
    eq('d: an OPEN record is not guarded (blanks apply as before)',
      [openEdit.ticketNo, openEdit.amount], ['', '']);
    const healedOrig = oct16Record(); // close facts live only in the ticket's read
    const healedKept = sb.dspApplyEdit(healedOrig, blankForm, healedOrig.tickets, null);
    eq('d: the guard keeps HEALED facts too (the Oct 16 shape)',
      [healedKept.ticketNo, healedKept.material], ['22729', 'Clay']);
  }

  /* ================= (e) the face in the real render ================= */
  {
    const w = makeModuleWorld(null);
    const saved = { id: 'd-saved', jobSite: 'Maple Ridge', date: '2026-10-17',
      scheduledAt: '2026-10-17T08:00', equipment: 'Tandem', material: '', ticketNo: '',
      amount: '', loads: '1', notes: '', driverId: '', driverName: '', tickets: [], photo: null, status: 'saved' };
    w.store.set('dsp_list', [oct16Record(), saved]);
    w.store.set('dsp_active', null);
    w.store.set('rev_entries', oct16Entries());
    w.store.set('rev_extras', []);
    w.render();
    eq('e: the completed row offers View; the open row still offers Edit',
      [w.btns('data-view').length, w.btns('data-edit').length], [1, 1]);
    check('e: no face before View is tapped', w.body.innerHTML.indexOf('id="dp_completed_card"') < 0);
    const listBefore = JSON.stringify(w.store.get('dsp_list', []));
    w.byVal('data-view', '0').click();
    const html = w.body.innerHTML;
    check('e: View opens the completed face', html.indexOf('id="dp_completed_card"') >= 0);
    check('e: the face says Completed with the close time',
      html.indexOf('✅ Completed dispatch') >= 0 && html.indexOf('Completed ·') >= 0);
    check('e: the face shows the healed close facts',
      html.indexOf('Ticket #</span><b>22729</b>') >= 0 && html.indexOf('Material</span><b>Clay</b>') >= 0, html.slice(0, 400));
    check('e: the face shows the day hours (foreman / travel / total)',
      html.indexOf('Foreman hours</span><b>10.0 h</b>') >= 0 &&
      html.indexOf('Travel</span><b>1.0 h</b>') >= 0 &&
      html.indexOf('Total hours</span><b>11.0 h</b>') >= 0);
    check('e: the face shows the builder amount', html.indexOf('Amount earned</span><b>$319.00</b>') >= 0);
    check('e: the face carries the ticket photo', html.indexOf(PHOTO) >= 0);
    check('e: the face does NOT open the edit form (no Save changes anywhere)',
      html.indexOf('id="dp_saveedit"') < 0 && html.indexOf('💾 Save changes') < 0);
    check('e: Edit is a secondary action INSIDE the face',
      html.indexOf('id="dp_completed_card"') < html.indexOf('id="dp_view_edit"') &&
      html.indexOf('✏️ Edit this record') >= 0);
    eq('e: viewing wrote nothing to the store', JSON.stringify(w.store.get('dsp_list', [])), listBefore);
    w.body.querySelector('#dp_view_done').click();
    check('e: Done closes the face', w.body.innerHTML.indexOf('id="dp_completed_card"') < 0);
  }

  /* ================= (f) both close paths stamp the record ================= */
  {
    /* ticket-photo close: haul card #23177, 10 typed hours + 1 travel = $319.00 */
    const CARD_TEXT = [
      'AECON', 'DAILY TRUCK HAUL CARD', 'Project: IFTI', 'Date: Oct 17, 2026',
      'Carrier: AI Trucking', 'Truck No: 07', 'Pit: On-site',
      'START TIME 8:00 AM  FINISH TIME 5:30 PM  TOTAL HOURS 9.5',
      'PAYMENT UNIT  HOUR  TONNE  TONNE / KM', 'OPERATOR SIGNATURE', '23177'
    ].join('\n');
    const w = makeModuleWorld(function () { return Promise.resolve(CARD_TEXT); });
    const act = { id: 'd-close129', date: '2026-10-17', scheduledAt: '2026-10-17T08:00',
      jobSite: 'Aecon Infrastructure', notes: '', equipment: 'Tandem', loads: '1',
      amount: '', netWeight: '', ticketNo: '', material: '', driverId: '', driverName: '',
      tickets: [], photo: null, status: 'active', startedAt: Date.parse('2026-10-17T07:26:00') };
    w.store.set('dsp_list', [JSON.parse(JSON.stringify(act))]);
    w.store.set('dsp_active', JSON.parse(JSON.stringify(act)));
    w.render();
    w.body.querySelector('#dp_close_ticket').click();
    const flow = w.body.querySelector('#dp_closeflow');
    const input = flow.querySelector('#dp_ct_img');
    input.files = [{ name: 'haul-card.jpg' }];
    input.onchange({ target: input });
    await flush();
    check('f: the close confirm view is reached', flow.innerHTML.indexOf('id="dp_cf_confirm"') >= 0);
    const hours = flow.querySelector('#dp_cf_hours');
    hours.value = '10'; hours.fire('input');
    flow.querySelector('#dp_cf_confirm').click();
    const rec = w.store.get('dsp_list', [])[0];
    eq('f: ticket-photo close completes the record', rec.status, 'completed');
    eq('f: ticket-photo close stamps the ticket # onto the record', rec.ticketNo, '23177');
    eq('f: ticket-photo close stamps the plan amount', rec.amount, '319.00');
    eq('f: the logged Revenue amount is the stamped amount', w.revLog.length && w.revLog[0].amount, '319.00');
  }
  {
    /* manual Complete: the ticket's own read carries the facts */
    const w = makeModuleWorld(null);
    const act = { id: 'd-man129', date: '2026-10-17', scheduledAt: '2026-10-17T08:00',
      jobSite: 'Aecon Infrastructure', notes: '', equipment: 'Tandem', loads: '1',
      amount: '', netWeight: '', ticketNo: '', material: '', driverId: '', driverName: '',
      tickets: [{ id: 't-man', photo: PHOTO, ocrType: 'haul_card', ticketNo: null, cardNumber: null,
        foremanHours: '8',
        docRead: { found: ['ticket #9981', 'material Gravel'], missing: [] }, date: '2026-10-17' }],
      photo: null, status: 'active', startedAt: Date.parse('2026-10-17T07:26:00') };
    w.store.set('dsp_list', [JSON.parse(JSON.stringify(act))]);
    w.store.set('dsp_active', JSON.parse(JSON.stringify(act)));
    w.render();
    /* v143 PIN MOVE: plain Complete opens the shared confirm
       step first (owner, Oct 17 16:22 MDT — no confirmation
       before the close was the catch); the drive confirms, and
       every (f) assertion about the close itself is unchanged. */
    w.body.querySelector('#dp_complete').click();
    eq('f: the tap alone completes nothing yet (v143)', (w.store.get('dsp_list', [])[0] || {}).status, 'active');
    w.body.querySelector('#dp_closeflow').querySelector('#dp_cf_confirm').click();
    const rec = w.store.get('dsp_list', [])[0];
    eq('f: manual Complete completes the record', rec.status, 'completed');
    eq('f: manual Complete stamps the ticket # mined from the read', rec.ticketNo, '9981');
    eq('f: manual Complete stamps the material mined from the read', rec.material, 'Gravel');
    eq('f: manual Complete stamps the plan amount ((8+1) x $29)', rec.amount, '261.00');
    eq('f: the ticket itself gains its mined facts', [rec.tickets[0].ticketNo, rec.tickets[0].material], ['9981', 'Gravel']);
    eq('f: manual Complete logs the same plan amount', w.revLog.length && w.revLog[0].amount, '261.00');
  }

  /* ================= (g) the edit-save stomp, driven ================= */
  {
    const w = makeModuleWorld(null);
    const rec = oct16Record();
    rec.ticketNo = '22729'; rec.material = 'Clay'; rec.amount = '319.00';
    w.store.set('dsp_list', [rec]);
    w.store.set('dsp_active', null);
    w.store.set('rev_entries', oct16Entries());
    w.store.set('rev_extras', []);
    w.render();
    w.byVal('data-view', '0').click();
    w.body.querySelector('#dp_view_edit').click();
    const html = w.body.innerHTML;
    check('g: Edit this record opens the one edit form', html.indexOf('id="dp_saveedit"') >= 0);
    check('g: the form SAYS the close facts are protected',
      html.indexOf('clearing one will not erase what the close recorded') >= 0);
    check('g: the form pre-fills the close facts (nothing blank)',
      w.body.querySelector('#dp_ticket').value === '22729' &&
      w.body.querySelector('#dp_mat').value === 'Clay' &&
      w.body.querySelector('#dp_amt').value === '319.00',
      JSON.stringify([w.body.querySelector('#dp_ticket').value, w.body.querySelector('#dp_mat').value, w.body.querySelector('#dp_amt').value]));
    /* the stomp attempt: clear all three close-fact fields, edit
       the notes, save */
    w.body.querySelector('#dp_ticket').value = '';
    w.body.querySelector('#dp_mat').value = '';
    w.body.querySelector('#dp_amt').value = '';
    w.body.querySelector('#dp_notes').value = 'gate code 4417';
    w.body.querySelector('#dp_saveedit').click();
    const after = w.store.get('dsp_list', [])[0];
    eq('g: the save could NOT stomp the close facts',
      [after.ticketNo, after.material, after.amount], ['22729', 'Clay', '319.00']);
    eq('g: the real edit (notes) still saved', after.notes, 'gate code 4417');
    eq('g: the record is still completed, same id', [after.status, after.id], ['completed', 'd-oct16']);
  }

  /* ================= statics ================= */
  {
    check('s: completed rows route to the face (data-view), open rows keep data-edit',
      dspSrc.indexOf('data-view="') >= 0 && dspSrc.indexOf('data-edit="') >= 0);
    check('s: Edit this record lives in the face', dspSrc.indexOf('✏️ Edit this record') >= 0);
    eq('s: both close paths stamp from the one plan assembly',
      (dspSrc.match(/dspApplyCloseFacts\(doneRec, planRes\.plan\)/g) || []).length, 2);
    check('s: the face amount comes from the shared builder, named in the code',
      dspSrc.indexOf('Meticulous.shared.buildRevenueLines') >= 0);
    check('s: index.html loads dispatch.js at ?v=<webVersion>',
      idxSrc.indexOf('modules/dispatch.js?v=' + ver.webVersion) >= 0);
  }

  console.log('\ndispatch-completed test: ' + pass + '/' + (pass + fail) + ' passed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
