#!/usr/bin/env node
/* Meticulous v459 — DISPATCH-INTAKE-459: behavioural tests
 * against the REAL shipped code. js/ticket-ocr.js +
 * js/dispatch-ingest.js run whole in a vm sandbox over the REAL
 * store sliced from js/app.js (the dispatch-ingest-test world).
 * Run: node tools/dispatch-intake-459-test.js
 *
 * The owner's in-hands test of v457 (Nov 15, 2026): he
 * photographed a "Routed Trip Report" (cross-border long-haul
 * format) and the card extracted only numbers — no pickup, no
 * delivery, company address empty — and the one printed PRO
 * number landed TWICE ("Pro: PRO00299219" + "PRO: 0299219").
 * His feedback named the fields this build adds, all editable
 * on the suggestion card:
 *  shipper + consignee NAME and ADDRESS as separate fields,
 *  the parties' phone numbers, commodity, customs broker,
 *  PAPS and TRP/trip as their own typed numbers, start date/
 *  time, PU date/time, DEL date/time, temperature (reefer set
 *  point), weight, quantity — plus the PRO de-duplication.
 *
 * Fixtures:
 *  R6 — a Routed Trip Report in the photographed document's
 *       shape (its header line is the owner's own OCR text,
 *       verbatim; the party blocks are constructed in the same
 *       printed layout — no real trip report text was on file).
 *  R1/R2 — the owner's real rate confirmations, read from the
 *       v457 suite file so the two suites can never drift on
 *       the same documents.
 *  DOC_A/DOC_B — the learning-loop pair for a detail label.
 *
 * Covers:
 *  (a) R6 places: shipper/consignee blocks land as pickup /
 *      delivery with names and phones;
 *  (b) R6 numbers: PAPS + TRP typed, PRO exactly once;
 *  (c) R6 details: all eleven detail fields as printed
 *       (v460: + driver1/driver2 from the header — thirteen);
 *  (d) R6 is ONE dispatch (the document's own "Shipper:" /
 *      "Consignee:" headers are structure, not senders — the
 *      batch splitter must not cut the report into fragments);
 *  (e) the suggestion carries everything: notes lines +
 *      structured keys; the card edit path persists a name
 *      and a detail correction;
 *  (f) the learning loop: a Use teaches the PAPS/TRP spellings
 *      and the detail-label spellings; an unknown detail label
 *      ("Reefer Setting") is shape-typed, taught by a Use, and
 *      then read even without its ':' marker — a fresh account
 *      reads it the old way (nothing);
 *  (g) R1/R2 keep their v457 reads and gain the details that
 *      are printed on them (temperature keeps its minus sign);
 *  (h) static pins: the card's name/detail inputs exist.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const ingestSrc = fs.readFileSync(path.join(ROOT, 'js', 'dispatch-ingest.js'), 'utf8');
const ocrSrc = fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8');
const dspSrc = fs.readFileSync(path.join(ROOT, 'modules', 'dispatch.js'), 'utf8');
const geoSrc = fs.readFileSync(path.join(ROOT, 'js', 'pinlinks.js'), 'utf8');

function extractStore(src) {
  const a = src.indexOf('var store = {');
  const b = src.indexOf('};', a);
  if (a === -1 || b === -1) throw new Error('store slice not found');
  return src.slice(a, b + 2);
}

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; failures.push(name); console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function hasNum(nums, type, value) {
  return (nums || []).some(function (n) { return n.type === type && n.value === value; });
}
function det(details, key) {
  const d = (details || []).filter(function (x) { return x.key === key; })[0];
  return d ? d.value : null;
}

function freshBacking() { return { map: new Map(), fail: false }; }
function makeWorld(backing) {
  const localStorage = {
    getItem: function (k) { return backing.map.has(k) ? backing.map.get(k) : null; },
    setItem: function (k, v) {
      if (backing.fail) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      backing.map.set(k, String(v));
    },
    removeItem: function (k) { backing.map.delete(k); },
    get length() { return backing.map.size; },
    key: function (i) { return Array.from(backing.map.keys())[i] || null; }
  };
  const sandbox = {
    console: console,
    localStorage: localStorage,
    location: { search: '', pathname: '/' },
    history: { replaceState: function () {} },
    URLSearchParams: URLSearchParams,
    App: {
      _today: function () { const d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); },
      _esc: function (s) { return String(s == null ? '' : s); }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractStore(appSrc), sandbox);
  sandbox.App._store = sandbox.store;
  vm.runInContext(ocrSrc, sandbox);
  vm.runInContext(geoSrc, sandbox);
  vm.runInContext(ingestSrc, sandbox);
  return sandbox;
}

/* ================= fixtures ================= */

/* R1/R2: the owner's real documents, lifted from the v457
   suite so both suites test the identical text */
const v457lines = fs.readFileSync(path.join(ROOT, 'tools', 'dispatch-photo-intake-v457-test.js'), 'utf8').split('\n');
function grabFixture(name) {
  const line = v457lines.filter(function (l) { return l.indexOf('const ' + name + ' = ') === 0; })[0];
  if (!line) throw new Error('fixture ' + name + ' not found in the v457 suite');
  return eval(line.slice(('const ' + name + ' = ').length).replace(/;$/, ''));
}
const R1 = grabFixture('R1');
const R2 = grabFixture('R2');

/* R6: a Routed Trip Report — the header line is the owner's
   own photographed text; the rest is the same printed layout */
const R6 = [
  'Routed Trip Report: TRP0122884 Driver 1:RaeesKhan Truck:T204 Driver 2:AdeelKhan Trailer:S1113 Start Date: 12/09/20 Start Time: 12:00 AM',
  'PO # 896270',
  'Pro: PRO00299219',
  'Order # ORD0248457',
  'Reference # 324167',
  'Appt # 40061-1482529',
  'PAPS # 88412093745',
  'Customs Broker: Thompson Ahern Intl Phone: (905) 677-8890',
  'Commodity: Auto Parts',
  'Temp: 34 F',
  'Weight: 38500 lbs',
  'Quantity: 18 Pallets',
  'Shipper:',
  'MAGNA SEATING SYSTEMS',
  '1240 INDUSTRIAL RD',
  'CAMBRIDGE, ON N1R 5G2',
  'Phone: (519) 653-2200',
  'PU Date: 12/09/20 PU Time: 06:00 AM',
  'Consignee:',
  'FCA STERLING HEIGHTS',
  '38111 VAN DYKE AVE',
  'STERLING HEIGHTS, MI 48312',
  'Phone: (586) 826-4400',
  'DEL Date: 12/09/20 DEL Time: 02:00 PM'
].join('\n');

const DOC_A = 'Tomorrow 8:00am\nTandem\nAecon Inf\nGo Empty To A2-L20\nReefer Setting: 34 F';
const DOC_B = 'Tomorrow 8:00am\nTandem\nAecon Inf\nGo Empty To A2-L20\nReefer Setting 36 F';

/* ================= (a) R6 places ================= */
console.log('(a) R6: shipper / consignee blocks land separate, named, with phones');
{
  const w = makeWorld(freshBacking());
  const T = w.TicketOCR, DI = w.DispatchIngest;
  const places = T.parseDispatchPlaces(R6);
  eq('R6 one pickup', places.pickups.length, 1);
  eq('R6 pickup is the shipper block', places.pickups[0], 'MAGNA SEATING SYSTEMS, 1240 INDUSTRIAL RD, CAMBRIDGE, ON N1R 5G2');
  eq('R6 one delivery', places.deliveries.length, 1);
  eq('R6 delivery is the consignee block', places.deliveries[0], 'FCA STERLING HEIGHTS, 38111 VAN DYKE AVE, STERLING HEIGHTS, MI 48312');
  eq('R6 shipper phone rides its block', places.pickupPhone, '(519) 653-2200');
  eq('R6 consignee phone rides its block', places.deliveryPhone, '(586) 826-4400');
  const d = DI.extractDetail(R6, T.parseDispatch(R6));
  eq('R6 shipper is a named field', d.pickupName, 'MAGNA SEATING SYSTEMS');
  eq('R6 consignee is a named field', d.deliveryName, 'FCA STERLING HEIGHTS');
}

/* ================= (b) R6 numbers ================= */
console.log('(b) R6: PAPS + TRP typed; the printed PRO lands exactly once');
{
  const w = makeWorld(freshBacking());
  const T = w.TicketOCR;
  const nums = T.extractKeyNumbers(R6);
  ok('R6 PO typed', hasNum(nums, 'po', '896270'));
  ok('R6 PRO typed whole', hasNum(nums, 'pro', 'PRO00299219'));
  eq('R6 PRO appears exactly once', nums.filter(function (n) { return n.type === 'pro'; }).length, 1);
  ok('R6 no split PRO fragment', !nums.some(function (n) { return n.value === '0299219'; }));
  ok('R6 Order typed', hasNum(nums, 'order', 'ORD0248457'));
  ok('R6 Reference typed', hasNum(nums, 'reference', '324167'));
  ok('R6 Appt typed', hasNum(nums, 'appt', '40061-1482529'));
  ok('R6 PAPS is its own typed field', hasNum(nums, 'paps', '88412093745'));
  ok('R6 TRP is its own typed field', hasNum(nums, 'trip', '0122884'));
  const bare = T.extractKeyNumbers('Pro: PRO00299219');
  eq('a lone "Pro: PRO..." line yields one number', bare.length, 1);
  eq('... and it is the whole PRO', bare[0] && bare[0].value, 'PRO00299219');
  const hashed = T.extractKeyNumbers('PRO #: PRO00299219');
  eq('"PRO #:" also yields exactly one', hashed.length, 1);
}

/* ================= (c) R6 details ================= */
console.log('(c) R6: the eleven detail fields, as printed (+ v460 drivers)');
{
  const w = makeWorld(freshBacking());
  const T = w.TicketOCR, DI = w.DispatchIngest;
  const d = DI.extractDetail(R6, T.parseDispatch(R6));
  eq('R6 start date', det(d.details, 'startDate'), '12/09/20');
  eq('R6 start time', det(d.details, 'startTime'), '12:00 AM');
  eq('R6 PU date/time joined', det(d.details, 'puDateTime'), '12/09/20 06:00 AM');
  eq('R6 DEL date/time joined', det(d.details, 'delDateTime'), '12/09/20 02:00 PM');
  eq('R6 commodity', det(d.details, 'commodity'), 'Auto Parts');
  eq('R6 temperature', det(d.details, 'temperature'), '34 F');
  eq('R6 weight', det(d.details, 'weight'), '38500 lbs');
  eq('R6 quantity', det(d.details, 'quantity'), '18 Pallets');
  ok('R6 customs broker named', String(det(d.details, 'broker') || '').indexOf('Thompson Ahern') !== -1, det(d.details, 'broker'));
  eq('R6 shipper phone', det(d.details, 'shipperPhone'), '(519) 653-2200');
  eq('R6 consignee phone', det(d.details, 'consigneePhone'), '(586) 826-4400');
  eq('R6 driver 1 from the header', det(d.details, 'driver1'), 'RaeesKhan');
  eq('R6 driver 2 from the header', det(d.details, 'driver2'), 'AdeelKhan');
  eq('R6 thirteen details, no more (11 + v460 drivers)', d.details.length, 13);
}

/* ================= (d) one dispatch, not fragments ================= */
console.log('(d) R6: one document = one suggestion');
{
  const w = makeWorld(freshBacking());
  const DI = w.DispatchIngest;
  eq('R6 is not read as a batch', DI.parseDispatchBatch(R6).isBatch, false);
  const added = DI.intakeBatch(R6, 'photo');
  eq('R6 intake adds exactly one suggestion', added.added.length, 1);
  const e = added.added[0];
  eq('the suggestion keeps the shipper name', e.fields.pickupName, 'MAGNA SEATING SYSTEMS');
  eq('the suggestion keeps the consignee name', e.fields.deliveryName, 'FCA STERLING HEIGHTS');
  eq('the suggestion keeps all thirteen details', e.fields.details.length, 13);
}

/* ================= (e) the confirmation carries it ================= */
console.log('(e) R6: notes lines + structured keys; card edits persist');
{
  const w = makeWorld(freshBacking());
  const DI = w.DispatchIngest;
  const e = DI.intake(R6, 'photo');
  ok('R6 becomes a suggestion', !!e);
  const ff = DI.formFieldsFor(e);
  ok('notes carry the pickup line', ff.notes.indexOf('Pickup: MAGNA SEATING SYSTEMS, 1240 INDUSTRIAL RD, CAMBRIDGE, ON N1R 5G2') !== -1, ff.notes);
  ok('notes carry the delivery line', ff.notes.indexOf('Delivery 1: FCA STERLING HEIGHTS, 38111 VAN DYKE AVE, STERLING HEIGHTS, MI 48312') !== -1);
  ok('notes carry PAPS', ff.notes.indexOf('PAPS: 88412093745') !== -1);
  ok('notes carry TRP', ff.notes.indexOf('TRP: 0122884') !== -1);
  ok('notes carry the commodity', ff.notes.indexOf('Commodity: Auto Parts') !== -1);
  ok('notes carry the broker', ff.notes.indexOf('Customs broker: Thompson Ahern') !== -1);
  ok('notes carry PU date/time', ff.notes.indexOf('PU date/time: 12/09/20 06:00 AM') !== -1);
  ok('notes carry DEL date/time', ff.notes.indexOf('DEL date/time: 12/09/20 02:00 PM') !== -1);
  ok('notes carry both phones', ff.notes.indexOf('Shipper phone: (519) 653-2200') !== -1 && ff.notes.indexOf('Consignee phone: (586) 826-4400') !== -1);
  ok('the name is not written twice (it heads its address)', ff.notes.indexOf('Shipper: MAGNA') === -1);
  eq('structured pickupName survives', ff.pickupName, 'MAGNA SEATING SYSTEMS');
  eq('structured deliveryName survives', ff.deliveryName, 'FCA STERLING HEIGHTS');
  eq('structured details survive whole', ff.details.length, 13);
  ok('notes carry Driver 1', ff.notes.indexOf('Driver 1: RaeesKhan') !== -1, ff.notes);
  ok('notes carry Driver 2', ff.notes.indexOf('Driver 2: AdeelKhan') !== -1);
  const upd = DI.updateSuggestionFields(e.id, {
    pickupName: 'MAGNA SEATING (CORRECTED)',
    deliveryName: 'FCA STERLING HEIGHTS PLANT',
    details: e.fields.details.map(function (x) {
      return x.key === 'temperature' ? { key: x.key, label: x.label, value: '36 F', srcLabel: x.srcLabel } : x;
    })
  });
  eq('a corrected shipper name persists', upd.fields.pickupName, 'MAGNA SEATING (CORRECTED)');
  eq('a corrected consignee name persists', upd.fields.deliveryName, 'FCA STERLING HEIGHTS PLANT');
  eq('a corrected temperature persists', det(upd.fields.details, 'temperature'), '36 F');
  eq('the other details survive the edit', upd.fields.details.length, 13);
}

/* ================= (f) the learning loop ================= */
console.log('(f) learning: number spellings + detail spellings');
{
  const w = makeWorld(freshBacking());
  const DI = w.DispatchIngest;
  const e = DI.intake(R6, 'photo');
  DI.use(e.id);
  const snap = DI.learnSnapshot();
  const types = Object.keys(snap.labels).map(function (k) { return snap.labels[k].type; });
  ok('the PAPS spelling is taught', types.indexOf('paps') !== -1, JSON.stringify(snap.labels));
  ok('the TRP spelling is taught', types.indexOf('trip') !== -1);
  eq('the broker spelling is taught as broker', snap.detailLabels['customs broker'] && snap.detailLabels['customs broker'].key, 'broker');
  eq('the commodity spelling is taught', snap.detailLabels['commodity'] && snap.detailLabels['commodity'].key, 'commodity');
  eq('the Temp spelling is taught as temperature', snap.detailLabels['temp'] && snap.detailLabels['temp'].key, 'temperature');
  eq('the Weight spelling is taught', snap.detailLabels['weight'] && snap.detailLabels['weight'].key, 'weight');
  eq('the Quantity spelling is taught', snap.detailLabels['quantity'] && snap.detailLabels['quantity'].key, 'quantity');
}
{
  const w = makeWorld(freshBacking());
  const DI = w.DispatchIngest;
  const eA = DI.intake(DOC_A, 'paste');
  ok('DOC_A still becomes a suggestion', !!eA);
  eq('an unknown label with a temperature shape lands typed', det(eA.fields.details, 'temperature'), '34 F');
  const src = (eA.fields.details.filter(function (x) { return x.key === 'temperature'; })[0] || {}).srcLabel;
  eq('... under its printed spelling', src, 'Reefer Setting');
  DI.use(eA.id);
  eq('the spelling is remembered', DI.learnSnapshot().detailLabels['reefer setting'] && DI.learnSnapshot().detailLabels['reefer setting'].key, 'temperature');
  const rB = DI.parseDispatchText(DOC_B);
  eq('the next read needs no colon marker', det(rB.fields.details, 'temperature'), '36 F');
  const wf = makeWorld(freshBacking());
  const rB0 = wf.DispatchIngest.parseDispatchText(DOC_B);
  eq('a fresh account reads the marker-less line as nothing', det(rB0.fields.details, 'temperature'), null);
}

/* ================= (g) R1/R2 details ================= */
console.log('(g) R1/R2: the printed details land; nothing is invented');
{
  const w = makeWorld(freshBacking());
  const T = w.TicketOCR, DI = w.DispatchIngest;
  const d1 = DI.extractDetail(R1, T.parseDispatch(R1));
  eq('R1 temperature', det(d1.details, 'temperature'), '31 °F');
  eq('R1 weight gains its printed unit', det(d1.details, 'weight'), '35000 lbs');
  eq('R1 PU window', det(d1.details, 'puDateTime'), '08/23/2024 17:30 - 18:00');
  eq('R1 first DEL window', det(d1.details, 'delDateTime'), '08/24/2024 11:00 - 11:30');
  ok('R1 commodity from the description column', String(det(d1.details, 'commodity') || '').indexOf('Fresh Foods') !== -1, det(d1.details, 'commodity'));
  eq('R1 no shipper phone is invented', det(d1.details, 'shipperPhone'), null);
  eq('R1 the signature-block TEL is not a consignee phone', det(d1.details, 'consigneePhone'), null);
  const d2 = DI.extractDetail(R2, T.parseDispatch(R2));
  eq('R2 commodity', det(d2.details, 'commodity'), 'Frozen bakery');
  eq('R2 temperature keeps its minus sign', det(d2.details, 'temperature'), '-10°F');
  eq('R2 weight', det(d2.details, 'weight'), '40,000 lbs');
  eq('R2 shipper phone from the pickup row', det(d2.details, 'shipperPhone'), '(000) 000-0000');
  eq('R2 consignee phone from the delivery row', det(d2.details, 'consigneePhone'), '(586) 447-3500');
  eq('R2 table date/times are not read as PU/DEL fields', det(d2.details, 'puDateTime'), null);
}

/* ================= (h) static pins ================= */
console.log('(h) static pins: the card doors for the new fields');
{
  ok('the card renders a shipper/consignee name input', dspSrc.indexOf('data-sugname') !== -1);
  ok('the card renders one input per detail field', dspSrc.indexOf('data-sugdetail') !== -1);
  ok('the ingest validates detail keys', ingestSrc.indexOf('DETAIL_KEYS') !== -1);
  ok('the OCR exposes the details reader', ocrSrc.indexOf('extractDispatchDetails') !== -1);
}

console.log('\ndispatch-intake-459: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('FAILURES: ' + failures.join(' | ')); process.exit(1); }
