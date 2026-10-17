#!/usr/bin/env node
/* Meticulous v85 — FUEL: THE RECEIPT FILLS THE FORM IN ONE PASS.
 *
 * Owner evidence (Oct 15, 2026): his real Mobil receipt photo
 * landed NOTHING in the fuel form. v80 rescued the parser (the
 * numbers); this suite pins the rest of the one confirm-first
 * pass against texts modelled on his two real receipts:
 * litres + cost + station (WITH its number — "Mobil @ 1742" and
 * "Mobil @ 1739" are different stations in his records) +
 * date + time, all from the REAL js/ticket-ocr.js, plus the
 * fuel.js wiring that carries the read time onto the saved
 * record (shown in the read line first; Save is the confirm;
 * a hand-changed date detaches it).
 * Run: node tools/fuel-fill-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function eq(name, got, want) {
  if (String(got) === String(want)) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}

const ocrSrc = fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8');
const fuelSrc = fs.readFileSync(path.join(ROOT, 'modules', 'fuel.js'), 'utf8');
const sb = { console: console };
sb.window = sb;
vm.createContext(sb);
vm.runInContext(ocrSrc, sb);
const T = sb.TicketOCR;

const OCT15 = [
  'Mobil @ 1739 Gas Stn',
  '200-20 Heritage Meadow',
  'Calgary AB T2H 3C1',
  '2026-10-15 17:55:41',
  'Pump 8  DIESEL',
  '78.175 L',
  'PRICE/L  2.479',
  'AMOUNT  $193.80',
  'GST INCLUDED IN TOTAL $9.23',
  'VISA ****8001',
  'Invoice No 519326'
].join('\n');

const OCT14 = [
  'Mobil @ 1742 Gas Stn',
  '300-3633 Westwinds Dr',
  'Calgary AB',
  'Oct 14, 2026 17:32',
  'Diesel 94.522 L @ 2.479/L',
  'TOTAL $234.32',
  'VISA ****8001'
].join('\n');

console.log('\n— the Oct 15 receipt: one pass, everything landed —');
{
  const f = T.parseFuelReceipt(OCT15);
  eq('litres', f.litres, '78.175');
  eq('cost (the amount, not the GST line)', f.cost, '193.8');
  eq('station WITH its number', f.station, 'Mobil @ 1739');
  eq('date', f.date, '2026-10-15');
  eq('time (24h)', f.time, '17:55');
  const rep = T.describeFuelRead(f);
  eq('nothing missing', JSON.stringify(rep.missing), '[]');
  ok('read line shows the station number', rep.found.indexOf('Mobil @ 1739') !== -1, rep.found.join(' · '));
  ok('read line shows the time in display form', rep.found.indexOf('5:55 PM') !== -1, rep.found.join(' · '));
}

console.log('\n— the Oct 14 receipt —');
{
  const f = T.parseFuelReceipt(OCT14);
  eq('station WITH its number', f.station, 'Mobil @ 1742');
  eq('time', f.time, '17:32');
  eq('date', f.date, '2026-10-14');
  eq('litres', f.litres, '94.522');
  eq('cost', f.cost, '234.32');
}

console.log('\n— edges —');
{
  const shell = T.parseFuelReceipt('Shell\n2026-10-10\n40.000 L\nTOTAL $99.00');
  eq('a brand with no number stays plain', shell.station, 'Shell');
  eq('no clock on the receipt → no time invented', shell.time, undefined);
  const ampm = T.parseFuelReceipt('Petro-Canada\nOct 9, 2026 5:55 PM\n50.000 L\nTOTAL $120.00');
  eq('AM/PM time converts to 24h', ampm.time, '17:55');
  eq('station keeps its hyphenated brand', ampm.station, 'Petro-Canada');
  const night = T.parseFuelReceipt('Esso\n2026-10-08 12:05 AM\n10.000 L\nTOTAL $25.00');
  eq('12:05 AM is 00:05', night.time, '00:05');
}

console.log('\n— fuel.js wiring —');
ok('the read time is held from the local read', fuelSrc.includes('if (parsed.time) fuReadTime = parsed.time;'));
/* v142: count moved 2 → 3 ON PURPOSE — the capture-time settle
   path (fuCloudSettled) is a third fill route and carries the time
   too (guarded: it never replaces a time the local read found). */
ok('the power-read fill carries the time too', (fuelSrc.match(/fuReadTime = parsed\.time/g) || []).length === 3);
ok('the saved record gains the time', fuelSrc.includes('if (fuReadTime) rec.time = fuReadTime;'));
ok('an edited record gains the time on a fresh read', fuelSrc.includes('if (fuReadTime) updated.time = fuReadTime;'));
ok('a hand-changed date detaches the time', fuelSrc.includes("if (id === '#fu_date') fuReadTime = '';"));
ok('the form fills all four fields from a read (one pass)',
  ["fillField('#fu_l', fuRoundL(parsed.litres))", "fillField('#fu_cost', fuRoundC(parsed.cost))",
   "fillField('#fu_stn', parsed.station)", "fillField('#fu_date', parsed.date)"]
    .every(s => fuelSrc.includes(s))); // v118: litres/cost fill at receipt precision
ok('nothing auto-saves (the form Save is the only write)', !/fuHandlePhoto[\s\S]{0,400}saveFillsVerified/.test(fuelSrc));

console.log('\nfuel-fill test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
