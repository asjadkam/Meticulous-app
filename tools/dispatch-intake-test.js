#!/usr/bin/env node
/* Meticulous v107 — DISPATCH INTAKE + LOADS (Stage 2 of the
 * Oct 16 overnight program).
 *
 * Owner evidence (Oct 16, 2026 20:21 MDT, his screenshot of the
 * Oct 16 dispatch): the template reader printed the job site as
 * "ONBNERREEEEARAL HH HHE", the banner said "Couldn't find:
 * scheduled time, material, ticket #, notes", and the form's
 * Material and Ticket # sat EMPTY — while the attached ticket
 * itself read "Dispatch #22729, 10.0h". The ticket's facts never
 * flowed into the form, gibberish rendered as a value, and the
 * Loads value never persisted to anywhere that counts.
 *
 * Pins:
 *  (a) a garbled-header haul card parses AS a haul card (never
 *      falls to the dispatch parser that hallucinates sites);
 *  (b) gibberish free-text is refused as a value (looksGibberish
 *      + the toDispatchForm choke point) while real names, codes
 *      and materials pass;
 *  (c) the haul card's number lands in form.ticketNo, and its
 *      labeled start/finish/total-hours attempts are carried;
 *  (d) a close with ticket loads marks the record loadsSet, so
 *      the shared dayLoads truth may trust it — and a close
 *      without loads leaves the record unmarked;
 *  (e) statics: the form fill has no first-ticket gate, the
 *      escalation helper + both funnel call sites exist, the
 *      loadsSet marker threads form → draft → record, and the
 *      close confirm pre-fills from the learned-site count.
 * Run: node tools/dispatch-intake-test.js
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
const dspSrc = fs.readFileSync(path.join(ROOT, 'modules', 'dispatch.js'), 'utf8');

const sb = { console: console };
sb.window = sb;
vm.createContext(sb);
vm.runInContext(ocrSrc, sb);
const T = sb.TicketOCR;

function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('fn not found: ' + name);
  let depth = 0, j = src.indexOf('{', i);
  const start = j;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('fn unbalanced: ' + name);
}
vm.runInContext(extractFn(dspSrc, 'dspBuildClosed') + '\n__buildClosed = dspBuildClosed;', sb);

console.log('\n— (a) the garbled-header haul card parses as a haul card —');
{
  const text = [
    'BAILY TRUCK HAUL CARD',
    'AECON',
    'Project DFTI  Pit A2-L20',
    'Material Clay',
    'Truck 07  TANDEM TRUCK ONLY',
    'Payment Unit HOUR TONNE TONNE / KM OTHER',
    'OPERATOR 22729'
  ].join('\n');
  const p = T.parse(text);
  eq('parse() type is haul_card, not the dispatch parser', p._type, 'haul_card');
  eq('card number read from the card', p.cardNumber, '22729');
  const form = T.toDispatchForm(p);
  eq('the card number lands in form.ticketNo', form.ticketNo, '22729');
  const rep = T.describeRead(p, form);
  ok('the read report shows the ticket # as found',
    rep.found.some(function (s) { return s.indexOf('ticket #') === 0 && s.indexOf('22729') > 0; }), JSON.stringify(rep));
}

console.log('\n— (b) gibberish is refused as a value; real values pass —');
{
  eq('the Oct 16 hallucination is gibberish', T.looksGibberish('ONBNERREEEEARAL HH HHE'), true);
  eq('a vowel-starved letter string is gibberish', T.looksGibberish('BCDFGHJKLMNPQRST'), true);
  eq('a real site passes', T.looksGibberish('Aecon — A2-L20'), false);
  eq('a real company name passes', T.looksGibberish('Aecon Infrastructure'), false);
  eq('a code with digits passes', T.looksGibberish('A2-L20'), false);
  eq('a short material passes', T.looksGibberish('Clay'), false);
  eq('a longer material passes', T.looksGibberish('Granular Fill'), false);
  const badForm = T.toDispatchForm({ _type: 'dispatch', site: 'ONBNERREEEEARAL HH HHE', datetime: '2026-10-16T08:00' });
  eq('a gibberish job site never reaches the form', badForm.jobSite, undefined);
  const repB = T.describeRead({ _type: 'dispatch' }, badForm);
  ok('the refused site is honestly reported as not found', repB.missing.indexOf('job site') >= 0);
  const goodForm = T.toDispatchForm({ _type: 'dispatch', site: 'Aecon Infrastructure', datetime: '2026-10-16T08:00' });
  eq('a real job site reaches the form', goodForm.jobSite, 'Aecon Infrastructure');
}

console.log('\n— (c) labeled haul-card attempts ride the read —');
{
  const text = [
    'DAILY TRUCK HAUL CARD',
    'AECON',
    'Start Time: 8:00 AM',
    'Finish Time: 6:30 PM',
    'Total Hours: 10.0',
    'OPERATOR 22729'
  ].join('\n');
  const p = T.parse(text);
  eq('start clock carried', p.startTime, '08:00');
  eq('finish clock carried', p.finishTime, '18:30');
  eq('total hours carried', p.totalHours, '10');
  const form = T.toDispatchForm(p);
  eq('form carries the start clock for the form fill', form.startTime, '08:00');
}

console.log('\n— (d) close-record loads are marked recorded —');
{
  const orig = { id: 'd1', jobSite: 'Aecon Inf', loads: '1', status: 'active', tickets: [] };
  const closed = sb.__buildClosed(orig, { id: 't1', ocrType: 'haul_card', cardNumber: '22729', loads: '6' }, 12345);
  eq('ticket loads total onto the record', closed.loads, '6');
  eq('the record is marked loadsSet', closed.loadsSet, true);
  eq('the close still completes the record', closed.status, 'completed');
  const closed2 = sb.__buildClosed(orig, { id: 't2', ocrType: 'haul_card', cardNumber: '22729' }, 12345);
  eq('a close without ticket loads leaves the record loads as they were', closed2.loads, '1');
  eq('…and unmarked (the default can never masquerade)', closed2.loadsSet, undefined);
}

console.log('\n— (e) statics: fill gate gone, escalation wired, marker threaded —');
{
  ok('runOCR fills from every read (no first-ticket gate)',
    !/if \(pendingTickets\.length === 0\) \{\s*\n\s*if \(form\.jobSite/.test(dspSrc) &&
    dspSrc.indexOf('function fillFormFromRead(parsed, form)') >= 0);
  ok('the form fill takes the ticket # from the card number',
    dspSrc.indexOf("var ticketVal = form.ticketNo || (parsed && parsed.cardNumber) || null;") >= 0);
  ok('the shared escalation helper exists',
    dspSrc.indexOf('function escalateTicketRead(ocrUrl, onMerged)') >= 0);
  ok('both funnels escalate thin reads',
    (dspSrc.match(/readNeedsEscalation\(parsed, docRead\)/g) || []).length >= 2);
  ok('readForm returns the loadsSet marker',
    dspSrc.indexOf("loadsSet: !!(body.querySelector('#dp_loadsset')") >= 0);
  ok('the draft carries the loadsSet marker',
    dspSrc.indexOf("loadsSet: q('#dp_loadsset') === '1'") >= 0);
  ok('the close confirm pre-fills from the learned-site count',
    dspSrc.indexOf('GeoLoads.forDate') >= 0 && dspSrc.indexOf('pit &amp; dump visits today') >= 0);
  ok('the OCR layer gates job site + material at the form choke point',
    ocrSrc.indexOf('if (form.jobSite && TicketOCR.looksGibberish(form.jobSite)) delete form.jobSite;') >= 0 &&
    ocrSrc.indexOf('if (form.material && TicketOCR.looksGibberish(form.material)) delete form.material;') >= 0);
}

console.log('\ndispatch-intake: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
