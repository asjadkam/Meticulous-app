#!/usr/bin/env node
/* Meticulous v143 — CLOSE FLOW: PHOTO DOOR + CONFIRMATION
 * (owner, Oct 17 16:22 MDT: "I think I closed the shift wrong,
 * I didn't upload my ticket, because there was no way to choose
 * a picture! And there was no confirmation before it actually
 * closed the shift!").
 *
 * The audit found three driver closes; two finalized on one
 * tap with no summary and no ticket-photo door:
 *   (1) dispatch plain Complete — one tap wrote everything;
 *   (2) the tracker End shift sheet — "Stop & save" wrote the
 *       session straight from the form;
 * and one that already confirmed:
 *   (3) dispatch Close with ticket photo — capture → confirm →
 *       verified write (kept; it gained a photo-replace door in
 *       its confirm step).
 *
 * Driven here against the REAL shipped code:
 *   A. plain Complete (dispatch module world, like
 *      dispatch-close-test): the tap writes NOTHING — the
 *      shared confirm step opens with the summary (date, plan
 *      amount + hours-split note, loads) and the photo state:
 *      an existing photo is shown; NO photo means the absence
 *      stated plainly WITH the photo door (Take photo / Choose
 *      file / type it instead). Cancel writes nothing. Confirm
 *      writes exactly once, and the logged entry deep-equals
 *      the one plan assembly for the closed record.
 *   B. the plain confirm's photo door: picking a photo runs the
 *      shared reader and lands on the ticket confirm (photo
 *      shown, replace door present); Confirm closes with the
 *      photo stored ONCE on the record.
 *   C. the ticket confirm's replace door: back to capture,
 *      nothing written.
 *   D. the tracker (app.js extractions): stopSessionAt stamps
 *      a handed-in ticket photo on the session entry and
 *      consumes it (a second stop carries none); the review's
 *      summary builder prices the close EXACTLY as Revenue's
 *      real onSession prices the same session.
 *   E. statics: the End shift sheet carries the form/review
 *      steps, the ticket door and the Review primary;
 *      trackerSaveEnd itself contains no stop call — the stop
 *      lives behind App.trackerConfirmEnd.
 * Run: node tools/close-confirm-v143-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const dspSrc = fs.readFileSync(path.join(ROOT, 'modules', 'dispatch.js'), 'utf8');
const ocrSrc = fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8');
const revSrc = fs.readFileSync(path.join(ROOT, 'modules', 'revenue.js'), 'utf8');
const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

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
function extractFn(src, marker) {
  const i = src.indexOf(marker);
  if (i === -1) throw new Error('marker not found: ' + marker);
  let depth = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { k++; break; } }
  }
  return src.slice(i, k);
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

/* ---------------- fake DOM (dispatch-close-test pattern) ---------------- */
function FakeEl(sel) {
  this._sel = sel || ''; this._kids = {}; this._html = '';
  this.value = ''; this.textContent = ''; this.style = {}; this.files = [];
  this.onclick = null; this._listeners = {};
  this.options = [{ text: '' }]; this.selectedIndex = 0;
}
Object.defineProperty(FakeEl.prototype, 'innerHTML', {
  get: function () { return this._html; },
  set: function (v) { this._html = String(v); this._kids = {}; }
});
FakeEl.prototype.querySelector = function (sel) { return this._kids[sel] || (this._kids[sel] = new FakeEl(sel)); };
FakeEl.prototype.querySelectorAll = function () { return []; };
FakeEl.prototype.addEventListener = function (type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); };
FakeEl.prototype.fire = function (type) { const s = this; (this._listeners[type] || []).slice().forEach(function (fn) { fn({ target: s }); }); };
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
function makeLocal() {
  const mem = {};
  return { mem: mem,
    getItem: function (k) { return (k in mem) ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; } };
}
function flush() {
  return new Promise(function (res) {
    let n = 0;
    (function step() { if (++n > 40) return res(); setTimeout(step, 0); })();
  });
}
function makeModuleWorld(recognize) {
  const backing = makeLocal();
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
  if (recognize) sb.TicketOCR.recognizeWithRotation = recognize;
  vm.runInContext(dspSrc, sb);
  sb.Meticulous.modules.revenue = {
    addEntry: function (e) { revLog.push(JSON.parse(JSON.stringify(e))); }
  };
  const body = new FakeEl('body');
  const store = sb.store;
  store.set('onboarding', { payStandard: 'hourly', payRate: 29, travelBonus: 1 });
  return {
    sb: sb, body: body, store: store, revLog: revLog, alerts: alerts,
    render: function () { sb.Meticulous.modules.dispatch.render(body); },
    flow: function () { return body.querySelector('#dp_closeflow'); },
    seedActive: function (d) {
      store.set('dsp_list', [JSON.parse(JSON.stringify(d))]);
      store.set('dsp_active', JSON.parse(JSON.stringify(d)));
    }
  };
}
function makeRegionWorld() {
  const backing = makeLocal();
  const sb = { console: console, document: docStub, localStorage: backing };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(extractStore(), sb);
  sb.App = { _store: sb.store, _today: function () { return TODAY; } };
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(extractRegion(dspSrc, 'DSP-SAVE-BEGIN', 'DSP-CLOSE-END'), sb);
  return { sb: sb, store: sb.store };
}
function expectedEntry(regionWorld, closedRec) {
  var e = regionWorld.sb.dspCompletionFor(JSON.parse(JSON.stringify(closedRec)), SETT).plan.entry;
  if (e) e.dspId = closedRec.id;
  return e;
}

(async function main() {
  const RW = makeRegionWorld();

  /* ============ A. plain Complete: summary first, Confirm writes ============ */
  console.log('\n— A: plain Complete lands on the confirm step —');
  {
    const w = makeModuleWorld(function () { return Promise.resolve(CARD_TEXT); });
    const d = activeDispatch();
    d.tickets = [{ id: 't0', photo: THUMB, ocrType: 'haul_card', cardNumber: '23177',
      foremanHours: '9.5', paymentUnit: 'HOUR', netWeight: null, date: TODAY }];
    w.seedActive(d);
    w.render();
    const listBefore = JSON.stringify(w.store.get('dsp_list', []));
    w.body.querySelector('#dp_complete').click();
    const flow = w.flow();
    check('A: the tap opens the confirm step', flow.innerHTML.indexOf('Check the close') >= 0 && flow.innerHTML.indexOf('id="dp_cf_confirm"') >= 0);
    check('A: NOTHING written by the tap (list byte-identical)', JSON.stringify(w.store.get('dsp_list', [])) === listBefore);
    eq('A: dispatch still active', (w.store.get('dsp_active', null) || {}).status, 'active');
    eq('A: no revenue before Confirm', w.revLog.length, 0);
    check('A: the existing ticket photo is SHOWN on the confirm',
      flow.innerHTML.indexOf(THUMB) >= 0 && flow.innerHTML.indexOf('Ticket photo already on this dispatch') >= 0);
    const plan = flow.querySelector('#dp_cf_plan').innerHTML;
    check('A: summary shows the date', plan.indexOf(TODAY) >= 0, plan.slice(0, 120));
    check('A: summary shows the computed amount ($304.50)', plan.indexOf('$304.50') >= 0, plan.slice(0, 200));
    check('A: summary shows the hours split (foreman + travel)', plan.indexOf('foreman 9.5h + travel 1h') >= 0);
    /* Cancel writes nothing */
    flow.querySelector('#dp_cf_back').click();
    check('A: Cancel clears the confirm step', w.flow().innerHTML === '');
    check('A: Cancel wrote nothing', JSON.stringify(w.store.get('dsp_list', [])) === listBefore && w.revLog.length === 0);
    /* reopen and Confirm — writes exactly once */
    w.body.querySelector('#dp_complete').click();
    const confirmBtn = w.flow().querySelector('#dp_cf_confirm');
    confirmBtn.click();
    const rec = w.store.get('dsp_list', [])[0];
    eq('A: Confirm completes the dispatch', rec.status, 'completed');
    eq('A: Confirm clears active', w.store.get('dsp_active', null), null);
    eq('A: existing ticket kept as-is', rec.tickets.length, 1);
    eq('A: photo still stored exactly once in the record', JSON.stringify(rec).split(THUMB).length - 1, 1);
    eq('A: exactly one Revenue entry', w.revLog.length, 1);
    eq('A: entry deep-equals the one plan assembly', w.revLog[0], expectedEntry(RW, rec));
    eq('A: entry amount', w.revLog[0].amount, '304.50');
    /* a second tap on the (now stale) Confirm writes nothing more */
    confirmBtn.click();
    eq('A: Confirm writes exactly once (double-tap safe)', w.revLog.length, 1);
    eq('A: still one record after the double-tap', w.store.get('dsp_list', []).length, 1);
  }

  /* ============ B. plain confirm photo door (no photo yet) ============ */
  console.log('\n— B: no photo yet — the door is right there —');
  {
    const w = makeModuleWorld(function () { return Promise.resolve(CARD_TEXT); });
    w.seedActive(activeDispatch());
    w.render();
    w.body.querySelector('#dp_complete').click();
    const flow = w.flow();
    check('B: absence stated plainly', flow.innerHTML.indexOf('No ticket photo on this dispatch yet.') >= 0);
    check('B: photo door = Take photo + Choose file',
      flow.innerHTML.indexOf('id="dp_pl_cam"') >= 0 && flow.innerHTML.indexOf('id="dp_pl_pick"') >= 0);
    check('B: summary is up before any photo', flow.querySelector('#dp_cf_plan').innerHTML.indexOf(TODAY) >= 0);
    const input = flow.querySelector('#dp_pl_img');
    input.files = [{ name: 'haul-card.jpg' }];
    input.onchange({ target: input });
    await flush();
    check('B: picking the photo lands on the ticket confirm',
      flow.innerHTML.indexOf('id="dp_cf_hours"') >= 0 && flow.innerHTML.indexOf('id="dp_cf_confirm"') >= 0);
    check('B: the picked photo is shown on the confirm', flow.innerHTML.indexOf(THUMB) >= 0);
    check('B: replace door present before Confirm', flow.innerHTML.indexOf('id="dp_cf_replace"') >= 0);
    eq('B: still nothing written', (w.store.get('dsp_list', [])[0] || {}).status, 'active');
    const hours = flow.querySelector('#dp_cf_hours');
    hours.value = '9.5'; hours.fire('input');
    check('B: preview shows the amount the photo close will log',
      flow.querySelector('#dp_cf_plan').innerHTML.indexOf('$304.50') >= 0);
    flow.querySelector('#dp_cf_confirm').click();
    const rec = w.store.get('dsp_list', [])[0];
    eq('B: Confirm completes the dispatch', rec.status, 'completed');
    eq('B: the photo became the closing ticket (one ticket)', rec.tickets.length, 1);
    eq('B: photo stored ONCE in the whole record', JSON.stringify(rec).split(THUMB).length - 1, 1);
    eq('B: top-level photo cleared (photo lives in tickets[])', rec.photo, null);
    eq('B: entry deep-equals the one plan assembly', w.revLog[0], expectedEntry(RW, rec));
    eq('B: entry amount', w.revLog[0].amount, '304.50');
  }

  /* ============ C. ticket confirm: replace door ============ */
  console.log('\n— C: replace the photo from the ticket confirm —');
  {
    const w = makeModuleWorld(function () { return Promise.resolve(CARD_TEXT); });
    w.seedActive(activeDispatch());
    w.render();
    w.body.querySelector('#dp_close_ticket').click();
    const flow = w.flow();
    const input = flow.querySelector('#dp_ct_img');
    input.files = [{ name: 'haul-card.jpg' }];
    input.onchange({ target: input });
    await flush();
    check('C: ticket confirm reached with the photo', flow.innerHTML.indexOf('id="dp_cf_replace"') >= 0);
    flow.querySelector('#dp_cf_replace').click();
    check('C: replace returns to the capture step',
      flow.innerHTML.indexOf('id="dp_ct_cam"') >= 0 && flow.innerHTML.indexOf('id="dp_ct_pick"') >= 0);
    eq('C: nothing written by the replace', (w.store.get('dsp_list', [])[0] || {}).status, 'active');
    eq('C: no revenue from the replace', w.revLog.length, 0);
  }

  /* ============ D. tracker: photo hand-in + summary pricing ============ */
  console.log('\n— D: tracker stop stamps the photo; summary = onSession pricing —');
  {
    const backing = makeLocal();
    const sb = { console: console, document: docStub, localStorage: backing, Meticulous: { modules: {} } };
    sb.window = sb;
    sb.alert = function () {};
    vm.createContext(sb);
    vm.runInContext(extractStore(), sb);
    sb.App = {
      _store: sb.store, _today: function () { return TODAY; },
      _esc: function (s) { return String(s == null ? '' : s); },
      tracker: { status: 'idle', startTs: 0, elapsed: 0, accum: { weightKg: 0, loadCount: 0, tripCount: 0, manualLoads: 0 } }
    };
    vm.runInContext('var trackerSave = function () {}; var trackerPaint = function () {};', sb);
    const declBlock = appSrc.slice(appSrc.indexOf('var _stopViaDispatch = false;'),
      appSrc.indexOf('function stopSessionAt'));
    const fns = ['function todayStr', 'function trackedSecondsAt', 'function trackerSessionStartMs', 'function trkAccum',
      'function takeSessionAccum', 'function ptiStartOdoFor', 'function takePendingStartOdo', 'function applyEndOdoToEntry',
      'function liveKmNow', 'function endCloseSummary', 'function stopSessionAt'];
    vm.runInContext(declBlock + '\n' + fns.map(function (m) { return extractFn(appSrc, m); }).join('\n') +
      '\n' + extractRegion(appSrc, 'ODO-MASTER-BEGIN', 'ODO-MASTER-END'), sb);
    const sessLog = [];
    sb.Meticulous.modules.revenue = { onSession: function (s) { sessLog.push(JSON.parse(JSON.stringify(s))); } };
    sb.store.set('onboarding', { payStandard: 'hourly', payRate: 29, travelBonus: 1 });

    /* a 2-hour paused session with 3 tapped loads */
    sb.App.tracker = { status: 'paused', startTs: Date.now() - 7200000, elapsed: 7200,
      accum: { weightKg: 0, loadCount: 0, tripCount: 0, manualLoads: 3 } };
    const sum = sb.endCloseSummary(Date.now());
    eq('D: summary hours from the tracker count', sum.secs, 7200);
    eq('D: summary loads = tapped loads', sum.loads, 3);
    eq('D: summary amount (hourly 2h x $29)', sum.amount, 58);

    /* the REAL revenue.onSession prices the same session entry */
    vm.runInContext(revSrc, sb);
    sb.Meticulous.modules.revenue.onSession({ date: TODAY, seconds: 7200 });
    const revEntries = sb.store.get('rev_entries', []);
    eq('D: onSession logged one entry', revEntries.length, 1);
    eq('D: summary amount == onSession amount (no drift)', String(sum.amount.toFixed(2)), String(revEntries[0].amount));

    /* the photo hand-in: set _endTicketPhoto, stop, it lands + is consumed */
    vm.runInContext("_endTicketPhoto = 'data:image/jpeg;base64,TICKET';", sb);
    sb.stopSessionAt(Date.now());
    const sessions1 = sb.store.get('sessions', []);
    eq('D: one session landed', sessions1.length, 1);
    eq('D: session carries the confirmed ticket photo', sessions1[0].ticketPhoto, 'data:image/jpeg;base64,TICKET');
    sb.App.tracker = { status: 'paused', startTs: Date.now() - 3600000, elapsed: 3600,
      accum: { weightKg: 0, loadCount: 0, tripCount: 0, manualLoads: 0 } };
    sb.stopSessionAt(Date.now());
    const sessions2 = sb.store.get('sessions', []);
    eq('D: second session landed', sessions2.length, 2);
    eq('D: the photo was consumed — second close carries none', sessions2[1].ticketPhoto, undefined);
  }

  /* ============ E. statics ============ */
  console.log('\n— E: statics —');
  {
    const sheetA = idxSrc.indexOf('id="trkEndSheet"'), sheetB = idxSrc.indexOf('id="odoSheet"');
    const sheet = (sheetA !== -1 && sheetB > sheetA) ? idxSrc.slice(sheetA, sheetB) : '';
    check('E: end sheet has the form step + review step containers',
      sheet.indexOf('id="trkEndForm"') >= 0 && sheet.indexOf('id="trkEndReview"') >= 0);
    check('E: end sheet ticket door = Take photo + Choose file',
      sheet.indexOf('id="trkEndTicketCam"') >= 0 && sheet.indexOf('id="trkEndTicketPick"') >= 0 &&
      sheet.indexOf('id="trkEndTicketCamIn"') >= 0 && sheet.indexOf('id="trkEndTicketIn"') >= 0);
    check('E: end sheet primary is the Review step, not a direct save',
      sheet.indexOf('id="trkEndSave">Review the close') >= 0 && sheet.indexOf('Stop &amp; save') === -1);
    const seAt = appSrc.indexOf('App.trackerSaveEnd = function');
    const seBody = seAt !== -1 ? appSrc.slice(seAt, appSrc.indexOf('/* v143: the close review', seAt)) : '';
    check('E: trackerSaveEnd validates + paints the review', seBody.indexOf('paintEndReview') >= 0);
    check('E: trackerSaveEnd itself stops NOTHING (no stopSessionAt call inside)',
      seBody.indexOf('stopSessionAt(') === -1, seBody.slice(0, 80));
    check('E: the stop lives behind the review Confirm',
      appSrc.indexOf('App.trackerConfirmEnd = function') >= 0 &&
      appSrc.indexOf('App.trackerBackEnd = function') >= 0);
    check('E: stop stamps the handed-in photo on the session entry',
      appSrc.indexOf('entry.ticketPhoto = ticketPhoto') >= 0);
    check('E: app wires the ticket door buttons',
      appSrc.indexOf("el('trkEndTicketCam').onclick") >= 0 && appSrc.indexOf("el('trkEndTicketPick').onclick") >= 0);
    check('E: dispatch plain Complete opens the confirm in plain mode',
      dspSrc.indexOf("mode: 'plain'") >= 0 && dspSrc.indexOf('function paintPlainConfirm') >= 0);
    check('E: the plain confirm carries the photo door + replace door',
      dspSrc.indexOf('id="dp_pl_cam"') >= 0 && dspSrc.indexOf('id="dp_cf_replace"') >= 0);
    check('E: no NEW native dialogs in dispatch.js (still 3)',
      (dspSrc.match(/(alert|confirm)\(/g) || []).length, 3);
    check('E: index.html loads dispatch.js at ?v=<webVersion>',
      idxSrc.indexOf('modules/dispatch.js?v=' + JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).webVersion) >= 0);
  }

  console.log('\nclose-confirm-v143 test: ' + pass + '/' + (pass + fail) + ' passed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
