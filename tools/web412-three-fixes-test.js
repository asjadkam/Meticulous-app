#!/usr/bin/env node
/* Web 412 — THREE FIXES bench (Nov 11, 2026):
 *
 * FIX 1 — TICKET-PHOTO-SINGLE-CLOSE + TICKET-DELETE-INERT
 *   (modules/dispatch.js, real DSP-SAVE..DSP-CLOSE regions):
 *   one close -> exactly ONE ticket carrying BOTH the foreman's
 *   hours AND the haul-card photo (the two halves the flow used to
 *   leave as a pair unify; genuinely distinct cards never merge);
 *   a ticket deleted from a saved record tombstones on the record
 *   (ticketDel — the record's del field) and no door (edit save,
 *   close, stale re-delivery) resurrects it.
 *
 * FIX 2 — LIMITED-NO-FINANCIALS (modules/manifest.js docLines +
 *   js/connectpipe.js): the Limited manifests rendering carries
 *   ZERO money figures (fuel costs, earned income) while hours /
 *   loads / places still print; the owner's own rendering is
 *   byte-identical; a stale pre-fix manifests doc is stripped at
 *   the Limited reader door (_stripMoneyLines).
 *
 * FIX 3 — ODOMETER-POWER-READ (js/powerread.js): the diagnosis —
 *   the v142 client ceilings (20 s / 12 s) sat BELOW the proxy's
 *   own 45 s per-model timeout (deploy/ai/server.js
 *   GEMINI_TIMEOUT_MS), so a slow-but-healthy proxy read was
 *   aborted client-side, misclassified 'network', queued, and
 *   every drain re-aborted it — the reading never landed. Driven
 *   here on a fake clock: a proxy answer at 30 s must LAND.
 *
 * Run: node tools/web412-three-fixes-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const dspSrc = read('modules/dispatch.js');
const manSrc = read('modules/manifest.js');
const cpSrc = read('js/connectpipe.js');
const prSrc = read('js/powerread.js');
const ocrSrc = read('js/ticket-ocr.js');

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

/* ================= FIX 1: dispatch close + delete ================= */
console.log('— FIX 1: single-close ticket + ticket tombstone —');
{
  const mem = {};
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const sb = {
    console: console, Promise: Promise, Date: Date, Math: Math, JSON: JSON,
    App: { _store: store, _today: function () { return '2026-11-10'; }, userRole: function () { return 'driver'; } },
    Meticulous: { modules: {} }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(extractRegion(dspSrc, 'DSP-SAVE-BEGIN', 'DSP-CLOSE-END'), sb);
  const PH = 'data:image/jpeg;base64,HAULCARD';
  const orig = {
    id: 'dsp1', jobSite: 'Aecon Trans', date: '2026-11-10', scheduledAt: '2026-11-10T08:00',
    status: 'active', amount: '', ticketNo: '', material: '', loads: '1',
    tickets: [{ id: 't1', photo: PH, ocrType: 'haul_card', cardNumber: '23177', foremanHours: null, paymentUnit: null }],
    photo: null
  };

  /* (1) the pair unifies: photo-half on the record + hours-half at close */
  const closing = { id: 't2', photo: null, ocrType: 'haul_card', cardNumber: null, foremanHours: '9.5', paymentUnit: 'HOUR', loads: '6', date: '2026-11-10' };
  const closed = sb.dspBuildClosed(JSON.parse(JSON.stringify(orig)), closing, 1760000000000);
  eq('1.1 one close -> exactly one ticket', closed.tickets.length, 1);
  check('1.2 the one ticket carries the photo', closed.tickets[0].photo === PH);
  check('1.3 the one ticket carries the foreman hours', String(closed.tickets[0].foremanHours) === '9.5');
  check('1.4 the one ticket keeps the card number', String(closed.tickets[0].cardNumber) === '23177');
  eq('1.5 close still completes the record', closed.status, 'completed');

  /* (2) same photo at close (form attach + close snap of the same card) */
  const closed2 = sb.dspBuildClosed(JSON.parse(JSON.stringify(orig)),
    { id: 't3', photo: PH, ocrType: 'haul_card', foremanHours: '8', date: '2026-11-10' }, 1760000000000);
  eq('2.1 same-photo close -> one ticket', closed2.tickets.length, 1);
  check('2.2 same-photo ticket carries hours + photo',
    String(closed2.tickets[0].foremanHours) === '8' && closed2.tickets[0].photo === PH);

  /* (3) genuinely distinct cards never merge */
  const twoCard = JSON.parse(JSON.stringify(orig));
  twoCard.tickets = [{ id: 'ta', photo: 'data:A', ocrType: 'haul_card', foremanHours: '5' }];
  const closed3 = sb.dspBuildClosed(twoCard,
    { id: 'tb', photo: 'data:B', ocrType: 'haul_card', foremanHours: null, date: '2026-11-10' }, 1760000000000);
  eq('3.1 a second, different card stays a second ticket', closed3.tickets.length, 2);

  /* (4) plain close (no new ticket) leaves the record's tickets alone */
  const closed4 = sb.dspBuildClosed(JSON.parse(JSON.stringify(orig)), null, 1760000000000);
  eq('4.1 plain close keeps the one ticket', closed4.tickets.length, 1);

  /* (5) delete tombstones on the record and sticks through every door */
  check('5.0 the ticket-delete door exists (dspDeleteTicket)', typeof sb.dspDeleteTicket === 'function');
  const recDel = (typeof sb.dspDeleteTicket === 'function')
    ? sb.dspDeleteTicket(JSON.parse(JSON.stringify(orig)), 't1', 1760000001000)
    : { tickets: orig.tickets, ticketDel: null };
  eq('5.1 deleted ticket leaves tickets[]', recDel.tickets.length, 0);
  eq('5.2 the tombstone rides the record (ticketDel)', recDel.ticketDel && recDel.ticketDel.t1, 1760000001000);
  const stale = JSON.parse(JSON.stringify(recDel));
  stale.tickets = [{ id: 't1', photo: PH, ocrType: 'haul_card', foremanHours: '9.5' }]; // a pre-delete copy re-delivered
  eq('5.3 dspLiveTickets filters the tombstoned ticket',
    (typeof sb.dspLiveTickets === 'function') ? sb.dspLiveTickets(stale).length : -1, 0);
  const closedStale = sb.dspBuildClosed(stale, { id: 't1', photo: PH, ocrType: 'haul_card', foremanHours: '9.5' }, 1760000002000);
  eq('5.4 a close cannot resurrect the tombstoned ticket', closedStale.tickets.length, 0);
  const edited = sb.dspApplyEdit(
    { id: 'dsp1', status: 'completed', date: '2026-11-10', scheduledAt: '2026-11-10T08:00', ticketDel: { t1: 1760000001000 }, tickets: stale.tickets },
    { jobSite: 'Aecon Trans' }, stale.tickets, null, {});
  eq('5.5 an edit save cannot resurrect it either', edited.tickets.length, 0);
  eq('5.6 the tombstone survives the edit', edited.ticketDel && edited.ticketDel.t1, 1760000001000);
  const edited2 = sb.dspApplyEdit(
    { id: 'dsp1', status: 'saved', date: '2026-11-10', scheduledAt: '2026-11-10T08:00', tickets: [{ id: 't9', photo: PH, ocrType: 'haul_card' }, { id: 't8', photo: null, ocrType: 'haul_card' }] },
    { jobSite: 'Aecon Trans' },
    [{ id: 't9', photo: PH, ocrType: 'haul_card' }, { id: 't8', photo: null, ocrType: 'haul_card' }],
    null, { t9: 1760000003000 });
  eq('5.7 a fresh deletion in this save tombstones + filters', edited2.tickets.map(function (t) { return t.id; }), ['t8']);
  eq('5.8 the fresh tombstone is stamped', edited2.ticketDel && edited2.ticketDel.t9, 1760000003000);

  /* (6) statics: the ticket editor carries number + photo fields; the
     form delete stamps the pending tombstone set */
  check('6.1 ticket editor has a ticket/card # field', dspSrc.indexOf('id="t_no"') !== -1);
  check('6.2 ticket editor has a photo field', dspSrc.indexOf('id="t_photo"') !== -1);
  check('6.3 form delete stamps pendingTicketDel', dspSrc.indexOf('pendingTicketDel[gone.id] = Date.now()') !== -1);
  check('6.4 list() read door honours ticketDel', dspSrc.indexOf('r.ticketDel[t.id]') !== -1);
}

/* ================= FIX 2: Limited sees no financials ================= */
console.log('— FIX 2: Limited manifest carries no money —');
{
  const mem = {
    onboarding: { payStandard: 'Hourly', payRate: 29, travelBonus: 0 },
    dsp_list: [{
      date: '2026-11-10', scheduledAt: '2026-11-10T08:00', jobSite: 'Aecon Trans', material: 'gravel',
      status: 'completed',
      tickets: [{ id: 't1', cardNumber: '23177', foremanHours: '9.5', paymentUnit: 'HOUR', photo: 'data:x' }]
    }],
    fuel_fills: [{ date: '2026-11-10', station: 'Mobil', cost: '123.45', litres: '60' }],
    fuel_expenses: [{ date: '2026-11-10', what: 'Scale fee', cost: '25.00' }],
    sessions: [{ date: '2026-11-10', endedAt: '2026-11-10T18:00:00', seconds: 36000, startOdo: 171000, endOdo: 171200 }],
    rev_entries: [{ date: '2026-11-10', hours: 10 }],
    rev_extras: [], dmg_reports: [], nav_log: []
  };
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const sb = {
    console: console, Promise: Promise, Date: Date, Math: Math, JSON: JSON,
    App: {
      _store: store,
      _esc: function (s) { return String(s === null || s === undefined ? '' : s); },
      _today: function () { return '2026-11-10'; }
    },
    Meticulous: { modules: {} }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(ocrSrc, sb);
  vm.runInContext(manSrc, sb);
  const M = sb.Meticulous.modules.manifest;
  const c = M._collectDay('2026-11-10');
  const t = M._toggles();
  const ownerLines = M._docLines('2026-11-10', c, t);
  const ownerText = JSON.stringify(ownerLines);
  check('B1 owner manifest DOES carry the fuel cost (fixture sanity)', ownerText.indexOf('123.45') !== -1, ownerText.slice(0, 200));
  check('B2 owner manifest DOES carry earned income (fixture sanity)', /\$/.test(ownerText) && /Earned Income/.test(ownerText));
  const limLines = M._docLines('2026-11-10', c, t, { noMoney: true });
  const limText = JSON.stringify(limLines);
  check('B3 Limited manifest: ZERO $ figures anywhere', limText.indexOf('$') === -1, limText);
  check('B4 Limited manifest: no Fuel & expenses section', !/Fuel & expenses/.test(limText));
  check('B5 Limited manifest: no earned-income line', !/Earned Income/.test(limText));
  check('B6 Limited manifest keeps the facts: ticket hours', limText.indexOf('9.5h') !== -1, limText);
  check('B7 Limited manifest keeps the day (title + dispatch)', /MANIFEST/.test(limText) && limText.indexOf('Aecon Trans') !== -1);
  eq('B8 owner rendering with empty opts is byte-identical to no opts',
    JSON.stringify(M._docLines('2026-11-10', c, t, {})), ownerText);

  /* the pipe: Limited days are built no-money at the source, and a
     stale pre-fix doc is stripped at the reader door */
  check('B9 _manifestDays builds Limited lines with noMoney', cpSrc.indexOf("_docLines(d, c, t, { noMoney: true })") !== -1);
  check('B10 fetchRecords strips a Limited manifests doc at the reader', cpSrc.indexOf('CP._stripMoneyManifests(snap.data())') !== -1);
  const sb2 = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Promise: Promise, Date: Date, Math: Math, JSON: JSON };
  sb2.window = sb2;
  sb2.App = { _store: store, _today: function () { return '2026-11-10'; } };
  sb2.Meticulous = { modules: {} };
  vm.createContext(sb2);
  vm.runInContext(cpSrc, sb2);
  const CP = sb2.ConnectPipe;
  const staleLines = [
    { k: 'title', a: 'MANIFEST — 2026-11-10' },
    { k: 'h', a: 'Fuel & expenses' },
    { k: 'kv', a: 'Fuel — Mobil', b: '$123.45' },
    { k: 'kv', a: 'Loads', b: '6' },
    { k: 'rule' },
    { k: 'kv', a: 'Total Earned Income', b: '$290.00' }
  ];
  check('B10b the strip door exists (CP._stripMoneyLines)', !!(CP && typeof CP._stripMoneyLines === 'function'));
  const stripped = (CP && typeof CP._stripMoneyLines === 'function') ? CP._stripMoneyLines(staleLines) : staleLines;
  check('B11 stale doc strip: no $ survives', JSON.stringify(stripped).indexOf('$') === -1, JSON.stringify(stripped));
  check('B12 stale doc strip: facts survive', JSON.stringify(stripped).indexOf('Loads') !== -1);
  check('B13 stale doc strip: the earned rule does not outlive its figure',
    !stripped.some(function (l) { return l.k === 'rule'; }), JSON.stringify(stripped));
}

/* ================= FIX 3: odometer power read lands ================= */
console.log('— FIX 3: a slow-but-healthy power read lands —');
{
  check('C1 first-attempt ceiling sits above the server per-model timeout (45 s)',
    /FETCH_TIMEOUT_MS = (\d+)/.exec(prSrc) && +/FETCH_TIMEOUT_MS = (\d+)/.exec(prSrc)[1] > 45000,
    (/FETCH_TIMEOUT_MS = (\d+)/.exec(prSrc) || [])[1]);
  check('C2 retry ceiling is not shorter than the server per-model timeout',
    /RETRY_TIMEOUT_MS = (\d+)/.exec(prSrc) && +/RETRY_TIMEOUT_MS = (\d+)/.exec(prSrc)[1] >= 45000,
    (/RETRY_TIMEOUT_MS = (\d+)/.exec(prSrc) || [])[1]);
  const srvPath = path.resolve(ROOT, '..', '..', 'truck-nav', 'deploy', 'ai', 'server.js');
  if (fs.existsSync(srvPath)) {
    const srv = fs.readFileSync(srvPath, 'utf8');
    const gm = /GEMINI_TIMEOUT_MS = (\d+)/.exec(srv);
    check('C3 server per-model timeout is 45 s (the number the ceilings must beat)',
      !!gm && +gm[1] === 45000, gm && gm[1]);
  }
}
(async function () {
  /* fake clock world: the proxy answers at +30 s — inside the
     server's own 45 s budget, beyond the old 20 s / 12 s ceilings */
  const data = {};
  const mockStore = {
    get: function (k, d) { const v = data['mt_' + k]; return v === undefined ? d : JSON.parse(v); },
    set: function (k, v) { data['mt_' + k] = JSON.stringify(v); return true; },
    del: function (k) { delete data['mt_' + k]; return true; }
  };
  mockStore.set('mt_odo', '171000');
  let now = 0, tid = 0;
  const timers = new Map();
  function fakeSetTimeout(fn, ms) { const id = ++tid; timers.set(id, { at: now + (ms || 0), fn: fn }); return id; }
  function fakeClearTimeout(id) { timers.delete(id); }
  async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
  async function advance(ms) {
    const target = now + ms;
    for (;;) {
      let nextId = null, nextAt = Infinity;
      timers.forEach(function (t, id) { if (t.at <= target && t.at < nextAt) { nextAt = t.at; nextId = id; } });
      if (nextId === null) break;
      const t = timers.get(nextId); timers.delete(nextId); now = t.at; t.fn();
      await flush();
    }
    now = target; await flush();
  }
  const mockFetch = function (url, init) {
    return new Promise(function (resolve, reject) {
      const id = fakeSetTimeout(function () {
        resolve({ status: 200, ok: true, json: function () { return Promise.resolve({ text: '171234' }); } });
      }, 30000);
      if (init && init.signal) {
        init.signal.addEventListener('abort', function () {
          fakeClearTimeout(id);
          const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
        });
      }
    });
  };
  const lsData = {};
  const sb = {
    console: console, Promise: Promise, Date: Date, Math: Math, JSON: JSON,
    setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout,
    AbortController: AbortController,
    navigator: { onLine: true }, fetch: mockFetch,
    localStorage: {
      getItem: function (k) { return (k in lsData) ? lsData[k] : null; },
      setItem: function (k, v) { lsData[k] = String(v); },
      removeItem: function (k) { delete lsData[k]; }
    },
    App: { _store: mockStore }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(prSrc, sb);
  const PowerRead = sb.PowerRead;
  let got = null, finalOut = null;
  const p = PowerRead.escalate({
    reader: 'odometer', image: 'data:image/jpeg;base64,/9j/DASH',
    onResult: function (r) { got = r; }
  }).then(function (o) { finalOut = o; });
  await advance(25000);
  check('C4 at 25 s the read is still in flight (not aborted, not queued)', finalOut === null && got === null,
    JSON.stringify(finalOut));
  await advance(10000); // 35 s: the +30 s answer has landed
  await p;
  check('C5 the 30 s proxy answer LANDS (status done)', !!finalOut && finalOut.status === 'done', JSON.stringify(finalOut));
  check('C6 the odometer value lands where the surface reads it (onResult fields.value)',
    !!got && got.fields && got.fields.value === '171234', JSON.stringify(got));
  check('C7 nothing was queued as a false network failure', PowerRead.queueLength() === 0);

  console.log('\nweb412-three-fixes: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL suite crashed: ' + (e && e.stack || e)); process.exit(1); });
