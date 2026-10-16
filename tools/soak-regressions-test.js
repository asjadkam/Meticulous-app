#!/usr/bin/env node
/* Meticulous v88 — SOAK REGRESSIONS (overnight campaign, Oct 16, 2026).
 *
 * Found by the overnight soak's rotated real-data driver (Pass 4):
 * the owner's real Oct 14 fuel receipt, with its lines in a different
 * order (date line last — a plausible OCR linearization of the same
 * photo), parsed its date as 2014-10-01 instead of 2026-10-14.
 *
 * Root cause: normDate's first pattern ("24-Apr-18" style) had no
 * word boundaries. In "VISA ****8001\nOct 14, 2026" the regex matched
 * the TAIL of the card number — "01" — as the day, "Oct" as the
 * month and "14" as a two-digit year: a fabricated 01-Oct-2014 that
 * BEAT the real "Oct 14, 2026" because the pattern runs first. A
 * fill-up landed on that date would vanish from its real day.
 *
 * Fix: \b anchors on both ends of the day-month-year and the
 * slash-date patterns in normDate. Legitimate shapes ("14-Oct-26",
 * "24-Apr-18", "3/26/2020") still parse — pinned below.
 *
 * Run: node tools/soak-regressions-test.js
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

const sb = { console: console };
sb.window = sb;
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8'), sb);
const T = sb.TicketOCR;

const L = ['Mobil @ 1742 Gas Stn', '300-3633 Westwinds Dr', 'Calgary AB', 'Oct 14, 2026 17:32', 'Diesel 94.522 L @ 2.479/L', 'TOTAL $234.32', 'VISA ****8001'];

console.log('\n— the Oct 14 receipt, line orders rotated —');
eq('as-is: date', T.parseFuelReceipt(L.join('\n')).date, '2026-10-14');
eq('full reverse: date', T.parseFuelReceipt(L.slice().reverse().join('\n')).date, '2026-10-14');
eq('date line LAST: date', T.parseFuelReceipt([L[0], L[1], L[2], L[4], L[5], L[6], L[3]].join('\n')).date, '2026-10-14');
eq('visa + date only: date', T.parseFuelReceipt([L[6], L[3]].join('\n')).date, '2026-10-14');
eq('date + visa only: date', T.parseFuelReceipt([L[3], L[6]].join('\n')).date, '2026-10-14');
{
  const f = T.parseFuelReceipt([L[0], L[1], L[2], L[4], L[5], L[6], L[3]].join('\n'));
  eq('date-last: litres still land', f.litres, '94.522');
  eq('date-last: cost still lands', f.cost, '234.32');
  eq('date-last: station keeps its number', f.station, 'Mobil @ 1742');
  eq('date-last: time still lands', f.time, '17:32');
}

console.log('\n— the trap shape in isolation —');
eq('"8001\\nOct 14, 2026" cannot fabricate 2014', T.parseFuelReceipt('VISA ****8001\nOct 14, 2026').date, '2026-10-14');
eq('invoice-number tail before a month name (Oct 15 receipt)', T.parseFuelReceipt('Invoice No 519326\nOct 15, 2026 17:55:41\n78.175 L\nPRICE/L 2.479\nAMOUNT $193.80').date, '2026-10-15');

console.log('\n— legitimate pattern-1 / slash dates still parse —');
eq('14-Oct-26 style', T.parseFuelReceipt('Mobil @ 1742 Gas Stn\n14-Oct-26\nDiesel 94.522 L @ 2.479/L\nTOTAL $234.32').date, '2026-10-14');
eq('24-Apr-18 style', T.parseFuelReceipt('Shell\n24-Apr-18\nDiesel 50.000 L @ 1.999/L\nTOTAL $99.95').date, '2018-04-24');
eq('slash date 10/14/2026', T.parseFuelReceipt('Mobil\n10/14/2026\nDiesel 94.522 L @ 2.479/L\nTOTAL $234.32').date, '2026-10-14');

console.log('\n— v89: the newline hop, second head (soak Pass 9) —');
/* "TOTAL $234.32" ending the line directly above "Oct 14, 2026":
   the cents "32" posed as pattern 1's day; isoDate(2014,10,32) is
   null and the old code RETURNED it, vetoing the real date below.
   With cents <= 31 ("$234.14\nOct 15, 2026") it fabricated a valid
   wrong date instead (2015-10-14). Both die with same-line-only
   separators + fall-through on invalid candidates. */
eq('total line directly above the date line', T.parseFuelReceipt([L[0], L[1], L[2], L[5], L[3], L[4], L[6]].join('\n')).date, '2026-10-14');
eq('seed-9 full order (GST first, total above date)', T.parseFuelReceipt(['GST INCLUDED IN TOTAL $9.23', 'VISA ****8001', 'Mobil @ 1742 Gas Stn', 'TOTAL $234.32', 'Oct 14, 2026 17:32', '300-3633 Westwinds Dr', 'Calgary AB', 'Diesel 94.522 L @ 2.479/L'].join('\n')).date, '2026-10-14');
eq('cents-14 trap: "$193.14" above "Oct 15, 2026"', T.parseFuelReceipt(['Mobil @ 1739 Gas Stn', 'TOTAL $193.14', 'Oct 15, 2026 17:55:41', '78.175 L', 'PRICE/L 2.479'].join('\n')).date, '2026-10-15');
eq('same-line space shape still parses (24 Apr 18)', T.parseFuelReceipt('Shell\n24 Apr 18\nDiesel 50.000 L @ 1.999/L\nTOTAL $99.95').date, '2018-04-24');

console.log('\nsoak-regressions test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
