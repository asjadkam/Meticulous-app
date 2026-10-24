'use strict';
/* POWER-READ-FUEL-FIELDS (queue; his report Oct 22, 2026 17:26,
 * the Mobil 1739 receipt in the Fuel form): Power Read filled
 * odometer/litres/cost/station but did NOT read the rate per
 * litre ($2.229/L), the date (2026-10-22), or the address
 * (200-20 Heritage Meadow, Calgary) — all printed on the
 * receipt. Fuel Power Read must extract rate/L, date/time and
 * the station address too, and what it reads must LAND: the
 * rate and the address ride the saved fill record the way the
 * sale time already does (v85's fuReadTime pattern).
 *
 * Drives the REAL js/ticket-ocr.js parser over the Oct 22
 * receipt in the station's own layout (the fuel-fill-test
 * OCT15 fixture is the same station, same layout), plus
 * source pins on the modules/fuel.js landing wiring. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function eq(name, got, want) {
  if (got === want) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
const ocrSrc = fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8');
const fuelSrc = fs.readFileSync(path.join(ROOT, 'modules', 'fuel.js'), 'utf8');
const sb = { console };
sb.window = sb;
vm.createContext(sb);
vm.runInContext(ocrSrc, sb);
const T = sb.TicketOCR;

const OCT22 = [
  'Mobil @ 1739 Gas Stn',
  '200-20 Heritage Meadow',
  'Calgary AB T2H 3C1',
  '2026-10-22 17:13:41',
  'Pump 4  DIESEL',
  '38.970 L',
  'PRICE/L  2.229',
  'AMOUNT  $86.86',
  'GST INCLUDED IN TOTAL $4.14',
  'VISA ****8001',
  'Invoice No 519410'
].join('\n');

console.log('— the Oct 22 Mobil receipt: every named field reads —');
{
  const f = T.parseFuelReceipt(OCT22);
  eq('litres', f.litres, '38.97');
  eq('cost', f.cost, '86.86');
  eq('station WITH its number', f.station, 'Mobil @ 1739');
  eq('rate per litre', f.pricePerLitre, '2.229');
  eq('transaction date', f.date, '2026-10-22');
  eq('transaction time (24h)', f.time, '17:13');
  eq('station address', f.address, '200-20 Heritage Meadow, Calgary AB T2H 3C1');
  const rep = T.describeFuelRead(f);
  ok('read line shows the rate', rep.found.indexOf('@ 2.229/L') !== -1, rep.found.join(' · '));
  ok('read line shows the date', rep.found.indexOf('2026-10-22') !== -1, rep.found.join(' · '));
  ok('read line shows the address', rep.found.indexOf('200-20 Heritage Meadow, Calgary AB T2H 3C1') !== -1, rep.found.join(' · '));
}
console.log('— the address rule is generic, and never invents —');
{
  const petro = T.parseFuelReceipt([
    'Petro-Canada', '4949 Barlow Tr SE', 'Calgary AB T2C 2P9',
    '2026-10-22 12:47:03', 'Pump 2  DIESEL', '99.047 L',
    'PRICE/L  2.419', 'AMOUNT  $239.59', 'VISA ****8001'
  ].join('\n'));
  eq('Petro address reads too', petro.address, '4949 Barlow Tr SE, Calgary AB T2C 2P9');
  eq('Petro rate reads too', petro.pricePerLitre, '2.419');
  const bare = T.parseFuelReceipt('Shell\n2026-10-10\n40.000 L\nTOTAL $99.00');
  eq('no address on the receipt → none invented', bare.address, undefined);
  const brandOnly = T.parseFuelReceipt(OCT22.split('\n').slice(0, 1).concat(['2026-10-22', '38.970 L', 'TOTAL $86.86']).join('\n'));
  eq('the brand line alone is never an address', brandOnly.address, undefined);
}
console.log('— the landing: rate + address ride the saved record (the v85 time pattern) —');
{
  ok('the read price is held from a fill', fuelSrc.includes('fuReadPrice = parsed.pricePerLitre'));
  ok('the read address is held from a fill', fuelSrc.includes('fuReadAddr = parsed.address'));
  ok('the local read holds them too', fuelSrc.includes('if (parsed.pricePerLitre) fuReadPrice = parsed.pricePerLitre;'));
  ok('the saved record gains the rate', fuelSrc.includes('if (fuReadPrice) rec.pricePerLitre = fuReadPrice;'));
  ok('the saved record gains the address', fuelSrc.includes('if (fuReadAddr) rec.address = fuReadAddr;'));
  ok('an edited record gains the rate on a fresh read', fuelSrc.includes('if (fuReadPrice) updated.pricePerLitre = fuReadPrice;'));
  ok('an edited record gains the address on a fresh read', fuelSrc.includes('if (fuReadAddr) updated.address = fuReadAddr;'));
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
