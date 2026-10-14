#!/usr/bin/env node
/* Meticulous v51 — service-sticker reader (Maintenance "Next service"):
 * parser-level tests against the REAL shipped js/ticket-ocr.js (no
 * copies), same harness style as tools/ocr-harness.js.
 * Run: node tools/service-sticker-test.js
 *
 * Covers Asjad's Oct 14, 2026 direction ("Even the next service should
 * be able to recognise from the picture like I sent you!"):
 *  (a) the owner's actual sticker ("NEXT SERVICE DUE / DATE 28 Sept
 *      2026 / MILES 175 429") incl. realistic OCR noise variants
 *  (b) printed-sticker formats ("Service due: 03/15/2027 · 182,000 km",
 *      ISO dates, D/M/Y slash dates like "28/09/26")
 *  (c) the oil-grade trap: "10W30" present but no due values -> nothing
 *  (d) unrelated receipt text -> nothing at all
 * NOTE: these fixtures are OCR-TEXT fixtures. Stickers are usually
 * handwritten and Tesseract reads handwriting unreliably — that is why
 * the app prefills and the driver confirms before saving; these tests
 * prove the parser, not handwriting accuracy.
 */
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
if (!TicketOCR || !TicketOCR.parseServiceSticker) {
  console.error('FAIL: TicketOCR.parseServiceSticker did not load');
  process.exit(1);
}

let pass = 0, fail = 0;
function eq(name, got, want) {
  const okk = String(got) === String(want);
  if (okk) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}

/* ---------- (a) The owner's actual sticker ---------- */
console.log('\nOwner sticker (clean read):');
const OWNER = [
  'NEXT SERVICE DUE',
  'DATE 28 Sept 2026',
  'MILES 175 429'
].join('\n');
let p = TicketOCR.parseServiceSticker(OWNER);
eq('owner: odometer', p.odo, '175429');
eq('owner: date', p.date, '2026-09-28');
eq('owner: confidence counts both fields', p._confidence, 2);

console.log('\nOwner sticker (single-line OCR linearization):');
p = TicketOCR.parseServiceSticker('NEXT SERVICE DUE DATE 28 Sept 2026 MILES 175 429');
eq('owner 1-line: odometer', p.odo, '175429');
eq('owner 1-line: date', p.date, '2026-09-28');

console.log('\nOwner sticker (OCR noise: month digit-confusion, comma odo):');
p = TicketOCR.parseServiceSticker('NEXT SERVICE DUE\nDATE 28 5ept 2026\nMILES 175,429');
eq('noise 5ept: odometer', p.odo, '175429');
eq('noise 5ept: date', p.date, '2026-09-28');

console.log('\nOwner sticker (OCR noise: month one-edit + lowercase):');
p = TicketOCR.parseServiceSticker('next service due date 28 sepf 2026 miles 175429');
eq('noise sepf: odometer', p.odo, '175429');
eq('noise sepf: date', p.date, '2026-09-28');

/* ---------- (b) Printed-sticker variants ---------- */
console.log('\nPrinted sticker (M/D/Y slash date, comma odo with km):');
p = TicketOCR.parseServiceSticker('Kal Tire\nService due: 03/15/2027 · 182,000 km');
eq('printed: odometer', p.odo, '182000');
eq('printed: date (M/D/Y)', p.date, '2027-03-15');

console.log('\nPrinted sticker (month-name first, no comma):');
p = TicketOCR.parseServiceSticker('NEXT SERVICE DUE\nDate: March 3, 2027\nOdometer: 182000 km');
eq('month-first: odometer', p.odo, '182000');
eq('month-first: date', p.date, '2027-03-03');

console.log('\nPrinted sticker (ISO date):');
p = TicketOCR.parseServiceSticker('NEXT SERVICE DUE 2027-03-15 MILES 182000');
eq('iso: odometer', p.odo, '182000');
eq('iso: date', p.date, '2027-03-15');

console.log('\nPrinted sticker (D/M/Y slash date, 2-digit year):');
p = TicketOCR.parseServiceSticker('NEXT SERVICE DUE DATE 28/09/26 MILES 175429');
eq('dmy: odometer', p.odo, '175429');
eq('dmy: date (28 cannot be a month)', p.date, '2026-09-28');

console.log('\nPrinted sticker (odo value before the unit label):');
p = TicketOCR.parseServiceSticker('SERVICE DUE AT 190250 KM ON 15 Oct 2026');
eq('value-first: odometer', p.odo, '190250');
eq('value-first: date', p.date, '2026-10-15');

/* ---------- (c) Oil-grade trap ---------- */
console.log('\nOil-grade trap (sticker header + 10W30, no due values):');
p = TicketOCR.parseServiceSticker('NEXT SERVICE DUE\nOIL 10W30\nFILTER CHANGED\nSEE YOU NEXT TIME');
eq('trap: no odometer from 10W30', p.odo, undefined);
eq('trap: no date invented', p.date, undefined);
eq('trap: confidence 0', p._confidence, 0);

console.log('\nOil-grade alongside real values (10W30 must not win):');
p = TicketOCR.parseServiceSticker('NEXT SERVICE DUE DATE 28 Sept 2026 MILES 175 429 OIL 10W30');
eq('trap+real: odometer is the sticker value', p.odo, '175429');
eq('trap+real: date', p.date, '2026-09-28');

/* ---------- (d) Unrelated documents -> nothing ---------- */
console.log('\nUnrelated receipt (fuel receipt text):');
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
p = TicketOCR.parseServiceSticker(MOBIL);
eq('receipt: no odometer', p.odo, undefined);
eq('receipt: no date', p.date, undefined);

console.log('\nUnrelated text (phone bill, has a spaced account number):');
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
p = TicketOCR.parseServiceSticker(TELUS);
eq('bill: no odometer from account number', p.odo, undefined);

/* Garbage: the form then shows "Couldn't read that sticker". */
p = TicketOCR.parseServiceSticker('blurry photo no numbers at all');
eq('garbage: no odometer', p.odo, undefined);
eq('garbage: no date', p.date, undefined);

/* ---------- describeStickerRead (the read-back line) ---------- */
console.log('\ndescribeStickerRead:');
const rep = TicketOCR.describeStickerRead(TicketOCR.parseServiceSticker(OWNER));
eq('read line: found has odo in display form', rep.found.join(' ').indexOf('175,429 km') >= 0, true);
eq('read line: found has date', rep.found.join(' ').indexOf('2026-09-28') >= 0, true);
eq('read line: nothing missing on owner sticker', rep.missing.length, 0);
const rep2 = TicketOCR.describeStickerRead(TicketOCR.parseServiceSticker('blurry photo no numbers at all'));
eq('read line: both missing on garbage', rep2.missing.length, 2);

console.log('\nservice-sticker-test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
