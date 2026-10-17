#!/usr/bin/env node
/* Meticulous v105 — INVOICE EXACTLY AS SENT suite (owner build
 * order, Oct 16, 2026: "the invoice is exactly how I sent it").
 *
 * The reference document is the invoice the owner actually sent
 * his boss: #1151 for Oct 1–15, 2026 (PDF extracted and spec'd
 * Oct 16). Its non-negotiables:
 *   From: Asjad Kamal, 1243 Cornerstone Blvd NE, Calgary, AB T3N 2A6
 *   Bill to: AI Trucking, 1506 16 St NE, Calgary, AB T2E 4T2
 *   Day lines in hour-sheet shape: "Oct 1: 10.5h" … "Oct 15: 11.5h"
 *   Subtotal $3,610.50 · Tax (5% GST, included in rate) $171.93 ·
 *   Total due $3,610.50
 *   Closing note, verbatim: "Rate $29.00/hour, tax included (net
 *   rate $27.62/hour + 5% GST of $1.38/hour). Hours are the foreman
 *   ticket hours for each day plus 1 hour of travel per day
 *   worked. Oct 14: haul card #23177 (foreman 9.5h + 1h travel).
 *   Oct 15: haul card #21314 (foreman 10.5h + 1h travel). Total
 *   hours: 124.5."
 *   Page footer: "Invoice 1151"
 *
 * This suite runs the REAL INV-CYCLE region of modules/invoice.js
 * in a vm over the real store slice from js/app.js, feeds it the
 * owner's real October entry shapes, and pins the builder output,
 * the day-line labels, the generated note (byte-for-byte), the
 * verified-issue record's stored print facts, and the Oct 16–31
 * draft (exactly one line: Oct 16, 11h, card #22729, $319.00).
 * The render glue (printInvoice / draw) is pinned by source
 * assertions, the house pattern for glue code.
 * Run: node tools/invoice-format-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) { ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
function deepEq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }

const appSrc = read('js/app.js');
const invSrc = read('modules/invoice.js');
const prefSrc = read('modules/preferences.js');
const pdfSrc = read('js/pdfexport.js');

function extractStore(src) {
  const a = src.indexOf('var store = {');
  const b = src.indexOf('};', a);
  if (a === -1 || b === -1) throw new Error('store slice not found');
  return src.slice(a, b + 2);
}
function extractRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}
function makeWorld(today) {
  const backing = new Map();
  const localStorage = {
    getItem: function (k) { return backing.has(k) ? backing.get(k) : null; },
    setItem: function (k, v) { backing.set(k, String(v)); },
    removeItem: function (k) { backing.delete(k); }
  };
  const sandbox = {
    console: console, localStorage: localStorage,
    App: { _today: function () { return today || '2026-10-31'; }, _esc: function (s) { return String(s == null ? '' : s); } }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractStore(appSrc), sandbox);
  sandbox.App._store = sandbox.store;
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sandbox);
  return sandbox;
}

/* The owner's stored entry shapes (as on his phone). */
function completion(date, hours, amount) {
  return { date: date, type: 'hourly', hours: hours, amount: String(amount), note: 'Dispatch: Aecon · foreman + travel = ' + hours + 'h', loads: 0 };
}
const OCT_1_15 = [
  completion('2026-10-01', 10.5, 304.50), completion('2026-10-02', 11, 319.00),
  completion('2026-10-03', 9, 261.00), completion('2026-10-05', 10.5, 304.50),
  completion('2026-10-06', 11.5, 333.50), completion('2026-10-07', 11.5, 333.50),
  completion('2026-10-08', 12.5, 362.50), completion('2026-10-09', 14.5, 420.50),
  completion('2026-10-13', 11.5, 333.50), completion('2026-10-14', 10.5, 304.50),
  completion('2026-10-15', 11.5, 333.50)
];
const DSP_1_15 = [
  { id: 'dsp-1014', date: '2026-10-14', status: 'completed', jobSite: 'Aecon', tickets: [{ ticketNo: '23177', foremanHours: 9.5 }] },
  { id: 'dsp-1015', date: '2026-10-15', status: 'completed', jobSite: 'Aecon', tickets: [{ ticketNo: '21314', foremanHours: 10.5 }] }
];
const REF_NOTE_1151 = 'Rate $29.00/hour, tax included (net rate $27.62/hour + 5% GST of $1.38/hour). ' +
  'Hours are the foreman ticket hours for each day plus 1 hour of travel per day worked. ' +
  'Oct 14: haul card #23177 (foreman 9.5h + 1h travel). ' +
  'Oct 15: haul card #21314 (foreman 10.5h + 1h travel). Total hours: 124.5.';

/* ================= Oct 1–15 — reproduce #1151 ================= */
(function () {
  console.log('\n— Oct 1–15: the sent invoice, reproduced —');
  const w = makeWorld('2026-10-15');
  const plan = w.invCycBuildRevenueLines(OCT_1_15, [], 29, 'hourly');
  eq('1151: eleven day lines', plan.lines.length, 11);
  eq('1151: lines total $3,610.50', Math.round(plan.lines.reduce(function (s, l) { return s + l.amt; }, 0) * 100) / 100, 3610.50);
  deepEq('1151: day lines in hour-sheet shape',
    plan.lines.map(function (l) { return w.invCycLineLabel(l, plan.dayHours); }),
    ['Oct 1: 10.5h', 'Oct 2: 11h', 'Oct 3: 9h', 'Oct 5: 10.5h', 'Oct 6: 11.5h', 'Oct 7: 11.5h',
     'Oct 8: 12.5h', 'Oct 9: 14.5h', 'Oct 13: 11.5h', 'Oct 14: 10.5h', 'Oct 15: 11.5h']);
  const cards = w.invCycCardDays(OCT_1_15, DSP_1_15, plan.dayHours, '2026-10-01', '2026-10-15');
  deepEq('1151: cards found only for the two card days', Object.keys(cards).sort(), ['2026-10-14', '2026-10-15']);
  eq('1151: Oct 14 travel derived = 1h (10.5 paid − 9.5 foreman)', cards['2026-10-14'].travel, 1);
  const note = w.invCycDocNote(plan.lines, plan.dayHours, cards, { rate: 29, taxRate: 5, taxIncluded: true });
  eq('1151: closing note is BYTE-FOR-BYTE the sent note', note, REF_NOTE_1151);
  const t = w.invCycTotals(3610.50, 5, true);
  eq('1151: subtotal / included GST / total due', t.sub + '/' + t.tax + '/' + t.total, '3610.5/171.93/3610.5');
})();

/* ================= Oct 16–31 — the live draft ================= */
(function () {
  console.log('\n— Oct 16–31: the draft against the real day —');
  const w = makeWorld('2026-10-31');
  const entries = [
    { date: '2026-10-16', type: 'hourly', hours: 11, amount: '319.00', loads: 1,
      note: 'Dispatch: Aecon Inf · foreman 10h + travel 1h = 11h (Ticket #22729: 10h)',
      dspId: 'dsp-oct16', foremanHours: 10, travelHours: 1, travelInIncome: true, ticketNos: ['22729'] },
    { date: '2026-10-16', type: 'hourly', hours: 9.75, amount: '282.75', note: 'Auto from tracker', auto: true, loads: 0 }
  ];
  const dspList = [
    { id: 'dsp-oct16', date: '2026-10-16', status: 'completed', jobSite: 'Aecon Inf', tickets: [{ ticketNo: '22729', foremanHours: 10 }] }
  ];
  const plan = w.invCycBuildRevenueLines(entries, [], 29, 'hourly');
  eq('Oct 16–31: exactly ONE line (tracker shadow excluded)', plan.lines.length, 1);
  eq('Oct 16–31: the line totals $319.00', plan.lines[0].amt, 319);
  eq('Oct 16–31: the line reads "Oct 16: 11h"', w.invCycLineLabel(plan.lines[0], plan.dayHours), 'Oct 16: 11h');
  const cards = w.invCycCardDays(entries, dspList, plan.dayHours, '2026-10-16', '2026-10-31');
  eq('Oct 16–31: card #22729 on the day', cards['2026-10-16'].tickets[0].num, '22729');
  const note = w.invCycDocNote(plan.lines, plan.dayHours, cards, { rate: 29, taxRate: 5, taxIncluded: true });
  eq('Oct 16–31: closing note in the sent shape', note,
    'Rate $29.00/hour, tax included (net rate $27.62/hour + 5% GST of $1.38/hour). ' +
    'Hours are the foreman ticket hours for each day plus 1 hour of travel per day worked. ' +
    'Oct 16: haul card #22729 (foreman 10h + 1h travel). Total hours: 11.');
  const t = w.invCycTotals(319, 5, true);
  eq('Oct 16–31: totals — subtotal $319.00, GST inside $15.19, total due $319.00', t.sub + '/' + t.tax + '/' + t.total, '319/15.19/319');

  /* Verified issue stores the print facts ON the record, so a
     reprint reproduces the document from the record alone. */
  const S = function (k, d) { return w.App._store.get('inv_' + k, d); };
  w.App._store.set('inv_draft', { items: [], taxRate: 5, billTo: 'AI Trucking, 1506 16 St NE, Calgary, AB T2E 4T2', no: '', date: '2026-10-31', notes: '' });
  const res = w.invIssue({
    draft: { items: [], taxRate: 5, billTo: 'AI Trucking, 1506 16 St NE, Calgary, AB T2E 4T2', no: '', date: '2026-10-31', notes: '' },
    revLines: plan.lines, sub: t.sub, tax: t.tax, total: t.total,
    pa: '2026-10-16', pb: '2026-10-31', today: '2026-10-31', now: 777,
    prefNo: '1152', taxIncluded: true, duplicateDates: [],
    dayHours: plan.dayHours, cardDays: cards, rate: 29,
    company: { name: 'Asjad Kamal', gst: '', addr: '1243 Cornerstone Blvd NE, Calgary, AB T3N 2A6' },
    province: 'AB', country: 'Canada'
  });
  eq('issue: verified ok', res.ok, true);
  eq('issue: number from the Preferences sequence (1152)', res.rec.no, '1152');
  eq('issue: date is the issue day', res.rec.date, '2026-10-31');
  eq('issue: record carries the day hours', res.rec.dayHours['2026-10-16'], 11);
  eq('issue: record carries the card facts', res.rec.cardDays['2026-10-16'].tickets[0].num, '22729');
  eq('issue: record carries the rate in force', res.rec.rate, 29);
  eq('issue: archived in inv_list', S('list', []).length, 1);
  eq('issue: draft cleared, next period opened (Nov 1–15)', S('pa', '') + '..' + S('pb', ''), '2026-11-01..2026-11-15');
  const reNote = w.invCycDocNote(res.rec.revLines, res.rec.dayHours, res.rec.cardDays,
    { rate: res.rec.rate, taxRate: res.rec.taxRate, taxIncluded: res.rec.taxIncluded });
  eq('reprint: the note regenerates from the record alone', reNote, note);
})();

/* ============ Render glue + the Oct 14 blockers, re-proven ============ */
(function () {
  console.log('\n— Glue + Oct 14 audit blockers —');
  ok('print: day rows use the hour-sheet label', invSrc.indexOf('invCycLineLabel(l, rec.dayHours)') !== -1);
  ok('print: the closing note is generated from the record', invSrc.indexOf('invCycDocNote(rec.revLines') !== -1);
  /* v122 (owner spec, Oct 17 — the STRUCTURE of his old #1150):
     the footer is now "Prepared by <business> · Invoice N ·
     Page 1" and the totals block's tax row is a GST row that
     prints the GST number. These two pins move DELIBERATELY
     with that spec; the byte-for-byte closing NOTE above — the
     part that was law — is untouched and still pinned. The
     full v122 structure is pinned in paystub-auto-test.js. */
  ok('print: page footer is the v122 Prepared-by line (name + number + page)',
    invSrc.indexOf("'<p class=\"muted foot\">Prepared by '") !== -1 &&
    invSrc.indexOf("' · Invoice ' + esc(rec.no) + ' · Page 1</p>'") !== -1);
  ok('print: GST row label carries the rate + included wording (v122 totals block)',
    invSrc.indexOf("'GST (' + esc(rec.taxRate) + '%' + (rec.taxIncluded ? ', included in the rate' : '') + ')'") !== -1);
  ok('screen: draft lines use the hour-sheet label too', invSrc.indexOf('invCycLineLabel(l, revPlan.dayHours)') !== -1);
  ok('issue: day hours + cards + rate are archived with the record',
    invSrc.indexOf('dayHours: (revPlan && revPlan.dayHours) || null') !== -1 &&
    invSrc.indexOf('cardDays: invCycCardDays(') !== -1 &&
    invSrc.indexOf('rate: parseFloat(o.payRate) || 0') !== -1);
  /* Blocker 1 — Invoice # field: empty value, Preferences fills it. */
  ok('blocker 1: # field renders EMPTY (placeholder only)', invSrc.indexOf("esc(draft.no || '')") !== -1);
  ok('blocker 1: empty draft # fills from Preferences', invSrc.indexOf('if (!draft.no && o.nextInvoiceNo)') !== -1);
  /* Blocker 2 — GST prefill: tax-inclusive mode forces the
     Preferences rate (default 5) onto the draft; the jurisdiction
     banner exists only when country/province are truly unset. */
  ok('blocker 2: GST rate forced from Preferences in tax-inclusive mode',
    invSrc.indexOf('if (isFinite(prefTaxRate) && taxIncluded) draft.taxRate = prefTaxRate;') !== -1 &&
    invSrc.indexOf('else if (taxIncluded) draft.taxRate = 5;') !== -1);
  ok('blocker 2: jurisdiction banner only when location unset',
    invSrc.indexOf('if (o.country && o.province) return \'\';') !== -1);
  /* Bill-to: the full name + address comes from Preferences
     (contracting company + its address), never typed twice. */
  ok('bill-to: Preferences carries the contracting company address field', prefSrc.indexOf('id="pf_contaddr"') !== -1);
  ok('bill-to: Preferences saves it', prefSrc.indexOf("o.contractingAddr = g('pf_contaddr')") !== -1);
  ok('bill-to: the draft default composes name + address', invSrc.indexOf("o.contractingCo + (o.contractingAddr ? ', ' + o.contractingAddr : '')") !== -1);
  /* Owner-operator two-books rates live in Preferences too. */
  ok('rates: billing + wage rate fields exist and save',
    prefSrc.indexOf('id="pf_billrate"') !== -1 && prefSrc.indexOf('id="pf_wagerate"') !== -1 &&
    prefSrc.indexOf("o.billingRate = g('pf_billrate'); o.ownWageRate = g('pf_wagerate');") !== -1);

  /* ---------- v118: Bill-to prints the SAVED value verbatim ----------
     The soak's invoice billed "Ai trucking" while Preferences
     holds "AI Trucking": a draft frozen with the case-variant
     never matched the v105 exact-equality heal, so the wrong
     casing printed forever. invBillToHeal treats any casing of
     the saved company (with or without the saved address) as
     untouched and replaces it with the saved value verbatim; a
     genuinely different hand-typed Bill-to is never rewritten. */
  const healSrc = (() => {
    const a = invSrc.indexOf('function invBillToHeal');
    const b = invSrc.indexOf('/* ---------------- contractor invoice', a);
    if (a === -1 || b === -1 || b <= a) throw new Error('invBillToHeal not found');
    return invSrc.slice(a, b);
  })();
  const invBillToHeal = new Function(healSrc + '\nreturn invBillToHeal;')();
  const CO = { contractingCo: 'AI Trucking', contractingAddr: '1506 16 St NE, Calgary, AB T2E 4T2' };
  ok('v118 bill-to: renderInvoice heals through invBillToHeal', invSrc.indexOf('invBillToHeal(draft, o);') !== -1);
  eq('v118 bill-to: case-variant name heals to the saved value + address, verbatim',
    invBillToHeal({ billTo: 'Ai trucking' }, CO).billTo, 'AI Trucking, 1506 16 St NE, Calgary, AB T2E 4T2');
  eq('v118 bill-to: case-variant name+address heals to the saved value verbatim',
    invBillToHeal({ billTo: 'Ai trucking, 1506 16 st ne, calgary, ab t2e 4t2' }, CO).billTo, 'AI Trucking, 1506 16 St NE, Calgary, AB T2E 4T2');
  eq('v118 bill-to: the exact saved name still heals (v105 rule intact)',
    invBillToHeal({ billTo: 'AI Trucking' }, CO).billTo, 'AI Trucking, 1506 16 St NE, Calgary, AB T2E 4T2');
  eq('v118 bill-to: an already-verbatim name+address is left exactly as saved',
    invBillToHeal({ billTo: 'AI Trucking, 1506 16 St NE, Calgary, AB T2E 4T2' }, CO).billTo, 'AI Trucking, 1506 16 St NE, Calgary, AB T2E 4T2');
  eq('v118 bill-to: a genuinely different hand-typed Bill-to is never rewritten',
    invBillToHeal({ billTo: 'Some Other Co' }, CO).billTo, 'Some Other Co');
})();

/* ============ v134: the RENDERED structure (the #1153 lesson) ============
   v122 pinned the print STRUCTURE as source; the owner's phone
   still rendered invoice-1153.pdf collapsed into running text,
   because the native pipeline (printDoc -> MetPdf.htmlToLines ->
   the line layout) had no h3 headings and flattened 4-cell rows
   into wrapped paragraphs ("Truck #07Hours"). This section runs
   the REAL printInvoice for the #1151 record, the REAL
   htmlToLines and the REAL buildPdf, and pins what the page
   actually carries: separate bill-to lines, h3 sections, a real
   4-column table with computed geometry, ruled rows, the totals
   behind their own rule, and the stream-level column positions. */
(function () {
  console.log('\n— v134: rendered structure — the real print, line by line —');
  const w = makeWorld('2026-10-15');
  /* the real PDF engine in the same world */
  vm.runInContext(pdfSrc, w);
  const M = w.window.MetPdf;
  ok('v134 render: MetPdf loaded beside the module world', !!M && typeof M.htmlToLines === 'function');
  /* deps printInvoice names directly (module-scope in the app):
     esc, onb + a capturing printDoc */
  w.esc = function (s) { return w.App._esc(s); };
  w.onb = function () { return {}; };
  let capTitle = null, capHtml = null;
  w.printDoc = function (title, html) { capTitle = title; capHtml = html; };
  const piA = invSrc.indexOf('function printInvoice(rec) {');
  const piB = invSrc.indexOf('\n    draw();', piA);
  ok('v134 render: printInvoice extracted from the shipped file', piA !== -1 && piB > piA);
  vm.runInContext(invSrc.slice(piA, piB), w);

  const plan = w.invCycBuildRevenueLines(OCT_1_15, [], 29, 'hourly');
  const cards = w.invCycCardDays(OCT_1_15, DSP_1_15, plan.dayHours, '2026-10-01', '2026-10-15');
  const t = w.invCycTotals(3610.50, 5, true);
  const res = w.invIssue({
    draft: { items: [], taxRate: 5, billTo: 'AI Trucking, 1506 16 St NE, Calgary, AB T2E 4T2', no: '', date: '2026-10-15', notes: '' },
    revLines: plan.lines, sub: t.sub, tax: t.tax, total: t.total,
    pa: '2026-10-01', pb: '2026-10-15', today: '2026-10-15', now: 1151,
    prefNo: '1151', taxIncluded: true, duplicateDates: [],
    dayHours: plan.dayHours, cardDays: cards, rate: 29, truckNo: '07',
    company: { name: 'Asjad Kamal', gst: '765662010 RT0001', addr: '1243 Cornerstone Blvd NE, Calgary, AB T3N 2A6' },
    province: 'AB', country: 'Canada'
  });
  eq('v134 render: the #1151 record issued in-world', res.ok && res.rec.no, '1151');
  w.printInvoice(res.rec);
  eq('v134 render: printDoc got the document', capTitle, 'Invoice 1151');

  const L = M.htmlToLines(capHtml);
  const texts = L.map(function (l) { return l.a || (l.cells ? l.cells.map(function (c) { return c.t; }).join('|') : ''); });
  eq('v134 render: business name is the title', L[0].k + ':' + L[0].a, 'title:Asjad Kamal');
  ok('v134 render: "Bill to" is a real section heading', L.some(function (l) { return l.k === 'h' && l.a === 'Bill to'; }));
  ok('v134 render: "Hours" is a real section heading', L.some(function (l) { return l.k === 'h' && l.a === 'Hours'; }));
  ok('v134 render: the pay-period line rides the date row',
    L.some(function (l) { return l.k === 'kv' && l.b.indexOf('Pay period: Oct 1–15, 2026') !== -1; }));
  /* the bill-to block: three lines of its own — nothing welded */
  ok('v134 render: Bill-to name stands alone', texts.indexOf('AI Trucking') !== -1);
  ok('v134 render: Bill-to address stands alone', texts.indexOf('1506 16 St NE, Calgary, AB T2E 4T2') !== -1);
  ok('v134 render: Truck # stands alone on its own line', texts.indexOf('Truck #07') !== -1);
  ok('v134 render: NOTHING is welded to its neighbour (no "Truck #07Hours")',
    !texts.some(function (x) { return /Truck #\S+Hours/.test(x) || /Hours$/.test(x) && /Truck/.test(x); }));

  /* the hours table: one head row + eleven day rows, real cells */
  const cols = L.filter(function (l) { return l.k === 'cols'; });
  eq('v134 render: the hours are a table (1 head + 11 day rows)', cols.length, 12);
  deepEq('v134 render: the header cells are the four columns',
    cols[0].cells.map(function (c) { return c.t; }), ['Description', 'Rate', 'Hours', 'Amount']);
  eq('v134 render: the header is flagged as the header', cols[0].head, true);
  deepEq('v134 render: the first day row, cell by cell',
    cols[1].cells.map(function (c) { return c.t; }), ['Oct 1', '$29.00 tax incl.', '10.5', '$304.50']);
  deepEq('v134 render: only the Amount column is right-aligned',
    cols[1].cells.map(function (c) { return c.r; }), [0, 0, 0, 1]);
  deepEq('v134 render: the last day row',
    cols[11].cells.map(function (c) { return c.t; }), ['Oct 15', '$29.00 tax incl.', '11.5', '$333.50']);

  /* the totals stand in their own section, behind a rule */
  const ruleIdx = L.findIndex(function (l) { return l.k === 'rule'; });
  const netIdx = L.findIndex(function (l) { return l.k === 'kv' && l.a === 'Net subtotal'; });
  ok('v134 render: a rule separates the totals block', ruleIdx !== -1 && netIdx !== -1 && ruleIdx < netIdx);
  const kvOf = function (a) { return L.filter(function (l) { return l.k === 'kv' && l.a === a; })[0]; };
  eq('v134 render: Net subtotal (GST backed out)', kvOf('Net subtotal') && kvOf('Net subtotal').b, '$3438.57');
  const gstRow = L.filter(function (l) { return l.k === 'kv' && l.a.indexOf('GST/HST 765662010 RT0001') !== -1; })[0];
  eq('v134 render: the GST row prints the number + the included GST', gstRow && gstRow.b, '$171.93');
  eq('v134 render: Total due = hours x rate exactly', kvOf('Total due') && kvOf('Total due').b, '$3610.50');
  eq('v134 render: Paid amount honest $0.00', kvOf('Paid amount') && kvOf('Paid amount').b, '$0.00');
  eq('v134 render: Balance owing = Total due', kvOf('Balance owing') && kvOf('Balance owing').b, '$3610.50');
  ok('v134 render: the byte-for-byte note survives the pipeline',
    texts.some(function (x) { return x.indexOf('Oct 15: haul card #21314 (foreman 10.5h + 1h travel). Total hours: 124.5.') !== -1; }));

  /* the built PDF: one table, pinned geometry, pinned stream x's */
  const pdf = M.buildPdf({ title: capTitle, lines: L });
  eq('v134 pdf: exactly one table in the built PDF', pdf.tables.length, 1);
  const tb = pdf.tables[0];
  eq('v134 pdf: the table has 4 columns and 12 rows', tb.cols + '/' + tb.rows, '4/12');
  eq('v134 pdf: the first column starts at the left margin', tb.xs[0], 46);
  ok('v134 pdf: columns march strictly right', tb.xs[0] < tb.xs[1] && tb.xs[1] < tb.xs[2] && tb.xs[2] < tb.xs[3],
    JSON.stringify(tb.xs));
  ok('v134 pdf: the last column ends at the right margin (549)',
    Math.abs(tb.xs[3] + tb.widths[3] - 549) < 0.2, (tb.xs[3] + tb.widths[3]).toFixed(1));
  const stream = Buffer.from(pdf.bytes).toString('latin1');
  const opX = function (txt) {
    const m = stream.match(new RegExp('1 0 0 1 ([\\d.]+) [\\d.]+ Tm \\(' + txt.replace(/[.$]/g, '\\$&') + '\\)'));
    return m ? parseFloat(m[1]) : null;
  };
  const descX = opX('Oct 1');
  ok('v134 pdf: day rows paint at the Description column x', descX !== null && Math.abs(descX - (tb.xs[0] + 6)) < 0.2,
    'x=' + descX + ' want ' + (tb.xs[0] + 6));
  const amtX = opX('$304.50');
  ok('v134 pdf: amounts right-align to the Amount column edge',
    amtX !== null && Math.abs(amtX + M._textWidth('$304.50', 10) - (tb.xs[3] + tb.widths[3] - 6)) < 0.6,
    'x=' + amtX);
  ok('v134 pdf: ruled rows — the stream carries the table rules (navy + row rules)',
    (stream.match(/ RG /g) || []).length >= 13, 'rules=' + (stream.match(/ RG /g) || []).length);
  ok('v134 pdf: header text paints bold (F2)', stream.indexOf('/F2 10 Tf') !== -1 && stream.indexOf('(Description)') !== -1);

  /* the 2-cell world is untouched: stub-shaped tables stay kv */
  const L2 = M.htmlToLines('<table><tr><th>Description</th><th>Amount</th></tr>' +
    '<tr><td>EI</td><td class="tot">-$32.00</td></tr></table>');
  ok('v134 render: 2-cell rows still become kv (no cols)', L2.some(function (l) { return l.k === 'kv' && l.a === 'EI'; }) &&
    !L2.some(function (l) { return l.k === 'cols'; }));
})();

console.log('\ninvoice-format: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
