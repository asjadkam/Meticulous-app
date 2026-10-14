#!/usr/bin/env node
/* Meticulous OCR harness — parser-level tests against the REAL shipped
 * js/ticket-ocr.js (no copies). Run: node tools/ocr-harness.js
 *
 * Covers: fuel receipt parser (v39, real Mobil receipt values),
 * expense receipt parser (v42), and smoke regressions for the older
 * parsers so a shared-file edit can't silently break Dispatch/Dispatch
 * document reading. UI wiring (buttons → OCR → fill) follows the exact
 * fuel pattern and is syntax-checked by CI-less `node --check` runs;
 * the on-device Tesseract read itself is only testable on the phone. */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8');
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const TicketOCR = sandbox.TicketOCR;
if (!TicketOCR) { console.error('FAIL: TicketOCR did not load'); process.exit(1); }

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = String(got) === String(want);
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}

/* ---------- Fixtures ---------- */

/* Real Mobil receipt, Asjad, 2026-10-13 (values read from his photo):
   Mobil 1742 Gas Stn, 300-3633 Westwinds Dr, Calgary AB T3K 5K3,
   2026-10-13 18:18:47, Pump 8 BIODE, 83.965 L @ $2.279/L = $191.36,
   GST included $9.11, Visa ****8684. */
const MOBIL = [
  'Mobil 1742 Gas Stn',
  '300-3633 Westwinds Dr',
  'Calgary, AB T3K 5K3',
  '2026-10-13 18:18:47',
  'Pump 8',
  'BIODE',
  '83.965 (L)  2.279 ($/L)  191.36 ($)',
  'TOTAL CAD $ 191.36',
  'GST included in total $9.11',
  'VISA ****8684',
  'THANK YOU'
].join('\n');

/* Parts store: SUBTOTAL + HST + TOTAL — total must be the 95.49, not
   the subtotal (84.50) or the HST line (10.99). 84.50 + 10.99 = 95.49. */
const NAPA = [
  'NAPA Auto Parts',
  '1234 32 Ave NE',
  'Calgary, AB T2E 6R6',
  '403-555-0182',
  '10/05/2026 09:41',
  'OIL FILTER        18.50',
  'DRAIN PLUG         6.00',
  'SHOP SUPPLIES     60.00',
  'SUBTOTAL          84.50',
  'HST 13%           10.99',
  'TOTAL             95.49',
  'VISA              95.49',
  'CHANGE             0.00',
  'THANK YOU'
].join('\n');

/* Restaurant receipt, month-name date. 17.85 + 0.90 GST = 18.75. */
const TIMS = [
  'Tim Hortons #3421',
  '888 4 Ave SW',
  'Calgary, AB',
  'Oct 8, 2026 07:15',
  '1 LG COFFEE        2.30',
  '1 BREAKFAST WRAP  15.55',
  'SUBTOTAL          17.85',
  'GST                0.90',
  'TOTAL            $18.75',
  'DEBIT             18.75',
  'CHANGE             0.00'
].join('\n');

/* AMOUNT DUE wording (phone bill style). */
const TELUS = [
  'TELUS',
  'Your monthly bill',
  'Date: Oct 2, 2026',
  'Account 1234 5678',
  'Previous balance       0.00',
  'New charges           67.20',
  'AMOUNT DUE          $67.20',
  'Please pay by Oct 27, 2026'
].join('\n');

/* ---------- Fuel parser (v39 regression) ---------- */
console.log('\nFuel receipt parser — Mobil fixture:');
const f = TicketOCR.parseFuelReceipt(MOBIL);
eq('fuel litres', f.litres, '83.965');
eq('fuel cost (TOTAL, not the $9.11 GST line)', f.cost, '191.36');
eq('fuel pricePerLitre', f.pricePerLitre, '2.279');
eq('fuel station', f.station, 'Mobil');
eq('fuel date', f.date, '2026-10-13');
const frep = TicketOCR.describeFuelRead(f);
eq('fuel read line has no missing fields', frep.missing.length, 0);

/* ---------- Expense parser (v42) ---------- */
console.log('\nExpense receipt parser — Mobil text as a generic receipt:');
const e0 = TicketOCR.parseExpenseReceipt(MOBIL);
eq('expense total (TOTAL CAD wins over the GST-included line)', e0.total, '191.36');
eq('expense vendor', e0.vendor, 'Mobil');
eq('expense date', e0.date, '2026-10-13');
eq('expense category left unset', e0.category, undefined);

console.log('\nExpense receipt parser — NAPA parts receipt:');
const e1 = TicketOCR.parseExpenseReceipt(NAPA);
eq('expense total = subtotal + HST (not subtotal, not tax)', e1.total, '95.49');
eq('expense vendor', e1.vendor, 'NAPA Auto Parts');
eq('expense date (M/D/Y)', e1.date, '2026-10-05');
eq('expense category hint', e1.category, 'Maintenance');

console.log('\nExpense receipt parser — Tim Hortons restaurant receipt:');
const e2 = TicketOCR.parseExpenseReceipt(TIMS);
eq('expense total', e2.total, '18.75');
eq('expense vendor', e2.vendor, 'Tim Hortons');
eq('expense date (month name)', e2.date, '2026-10-08');
eq('expense category left unset (food is the user\'s call)', e2.category, undefined);

console.log('\nExpense receipt parser — TELUS amount-due receipt:');
const e3 = TicketOCR.parseExpenseReceipt(TELUS);
eq('expense total from AMOUNT DUE', e3.total, '67.20');
eq('expense vendor', e3.vendor, 'TELUS');
eq('expense date', e3.date, '2026-10-02');
eq('expense category hint', e3.category, 'Phone');

const erep = TicketOCR.describeExpenseRead(e1);
ok('expense read line carries $total/vendor/date/category',
  erep.found.join(' ').indexOf('$95.49') >= 0 &&
  erep.found.join(' ').indexOf('NAPA Auto Parts') >= 0 &&
  erep.found.join(' ').indexOf('2026-10-05') >= 0 &&
  erep.found.join(' ').indexOf('Maintenance') >= 0,
  JSON.stringify(erep));
eq('expense read line has no missing fields for NAPA', erep.missing.length, 0);

/* Garbage input must find nothing (the forms then show the plain
   "couldn't read anything" message and leave fields untouched). */
const e9 = TicketOCR.parseExpenseReceipt('blurry photo no numbers at all');
eq('garbage: no total', e9.total, undefined);
eq('garbage: no date', e9.date, undefined);
eq('garbage: no category', e9.category, undefined);

/* ---------- Older parsers: smoke regressions ---------- */
console.log('\nOlder parsers — smoke:');
const haul = TicketOCR.parseHaulCard('AECON\nDAILY TRUCK HAUL CARD\n23141\nOPERATOR:');
eq('haul card detected', haul.isHaulCard, true);
eq('haul card flags handwritten hours for review', (haul.needsReview || []).indexOf('totalHours') >= 0, true);
const doc = TicketOCR.parseDocument('RATE CONFIRMATION\nCompany Name: Rock Solid Provisions\nTOTAL $1,200.00\nPickup Date: 24-Apr-18');
ok('document parser still reads a rate con', !!doc, 'parseDocument returned null');
if (doc) eq('document amount', doc.amount, '1200.00');
const anyParsed = TicketOCR.parse(MOBIL);
ok('auto-detect parse does not crash on a fuel receipt', !!anyParsed);

console.log('\nOCR harness: ' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
