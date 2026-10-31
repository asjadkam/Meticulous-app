#!/usr/bin/env node
/* Meticulous v298 — INVOICE-BILLTO-BLANK + INVOICE-NOTES-VERBOSE
 * (owner, Oct 31, 2026 13:49 MDT, on his own print of invoice
 * #1154 for Oct 16–31):
 *
 *   "Where is the bill to company name and address.... And notes
 *    Dont have to be soooo detailed... Details are left for multi
 *    day manifest.... And fix this invoice right now and give it
 *    back to me!"
 *
 * Defect 1 — the #1154 PDF's Bill-to block printed "—" and
 * "Truck #07": the saved Contracting company (AI Trucking) and
 * its address never reached the document. The chain froze the
 * blank at every door: the draft default fills Bill-to from
 * Preferences ONLY when a draft is first created; invBillToHeal
 * heals only a NON-blank value; invIssue stamps the draft's
 * value verbatim; the composer prints the record verbatim. The
 * fix: the builder resolves Bill-to from the saved Contracting
 * company + address whenever the invoice's own bill-to is
 * blank — at issue time (the record carries it), in the draft
 * heal, and at the issuer's print door (so an ALREADY-ISSUED
 * blank record — #1154 itself — re-prints corrected under its
 * own number). A hand-typed Bill-to is never overridden. The
 * payer's shared door passes no fallback: his copy still uses
 * only what the record carries.
 *
 * Defect 2 — the generated closing note enumerated every day's
 * haul card + foreman/travel split. The owner's new law: the
 * note is SHORT — the rate line plus "Total hours: <n>." and
 * nothing else. Per-day detail belongs to the multi-day
 * manifest (MANIFEST-MULTIDAY, still owed).
 *
 * The math does not move: #1154's own figures re-proven here —
 * 12 day lines, 112.2 hours, subtotal/total $3,253.71, included
 * GST $154.94, net $3,098.77 (the v285 inclusive-GST audit).
 *
 * Runs the REAL INV-CYCLE region of modules/invoice.js in a vm
 * over the real store slice, plus source pins for the glue
 * (renderInvoice / printInvoice), the house pattern.
 * Run: node tools/invoice-billto-notes-v298-test.js
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

const appSrc = read('js/app.js');
const invSrc = read('modules/invoice.js');

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
  /* the module-scope esc the INV-CYCLE region's composer uses
     (in the app it is App._esc, bound at the module's top) */
  sandbox.esc = function (s) { return String(s == null ? '' : s); };
  vm.createContext(sandbox);
  vm.runInContext(extractStore(appSrc), sandbox);
  sandbox.App._store = sandbox.store;
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sandbox);
  return sandbox;
}

const PREFS = { contractingCo: 'AI Trucking', contractingAddr: '1506 16 St NE, Calgary, AB T2E 4T2' };
const FULL_BT = 'AI Trucking, 1506 16 St NE, Calgary, AB T2E 4T2';
const CO_BIZ = { name: 'Meticulous technologies', gst: '765662010 RT0001', addr: '1243 Cornerstone blvd, Calgary, AB' };

function baseRec(over) {
  const rec = {
    id: 'invX', no: '1154', date: '2026-10-31', billTo: '',
    pa: '2026-10-16', pb: '2026-10-31',
    revLines: [], items: [], taxRate: 5, taxIncluded: true,
    sub: 3253.71, tax: 154.94, total: 3253.71,
    dayHours: null, cardDays: null, rate: 29, truckNo: '07',
    notes: '', company: CO_BIZ, province: 'AB', country: 'Canada'
  };
  Object.keys(over || {}).forEach(function (k) { rec[k] = over[k]; });
  return rec;
}

/* ============ the prefs composition ============ */
(function () {
  console.log('\n— Bill-to fallback composition —');
  const w = makeWorld();
  eq('prefs: company + address compose the fallback', w.invCycBillToFromPrefs(PREFS), FULL_BT);
  eq('prefs: company alone when no address is saved', w.invCycBillToFromPrefs({ contractingCo: 'AI Trucking' }), 'AI Trucking');
  eq('prefs: no company saved -> empty fallback', w.invCycBillToFromPrefs({}), '');
  eq('prefs: null prefs -> empty fallback', w.invCycBillToFromPrefs(null), '');
})();

/* ============ composer resolution (the #1154 reprint) ============ */
(function () {
  console.log('\n— Composer: blank record bill-to resolves at print —');
  const w = makeWorld();
  const html = w.invSharedDocHtml(baseRec({}), '07', false, FULL_BT);
  ok('reprint: Bill-to name is the contracting company', html.indexOf('<b>AI Trucking</b>') !== -1, html.slice(html.indexOf('billto'), html.indexOf('billto') + 200));
  ok('reprint: Bill-to address rides under the name', html.indexOf('1506 16 St NE, Calgary, AB T2E 4T2') !== -1);
  ok('reprint: no em-dash placeholder in the Bill-to block',
    html.indexOf('<b>—</b>') === -1);
  ok('reprint: truck still rides its own line', html.indexOf('Truck #07') !== -1);

  const ws = w.invSharedDocHtml(baseRec({ billTo: '   ' }), '07', false, FULL_BT);
  ok('reprint: a whitespace-only bill-to is blank too', ws.indexOf('<b>AI Trucking</b>') !== -1);

  const typed = w.invSharedDocHtml(baseRec({ billTo: 'Some Other Co, 1 Other Way' }), '07', false, FULL_BT);
  ok('reprint: a hand-typed bill-to is NEVER overridden by the fallback',
    typed.indexOf('<b>Some Other Co</b>') !== -1 && typed.indexOf('AI Trucking') === -1);

  const payer = w.invSharedDocHtml(baseRec({}), '07', false);
  ok('payer door: no fallback passed -> the record alone speaks (blank stays blank)',
    payer.indexOf('<b>—</b>') !== -1);
})();

/* ============ issue time: the record carries the resolution ============ */
(function () {
  console.log('\n— invIssue: blank draft bill-to resolves onto the record —');
  const w = makeWorld('2026-10-31');
  function issue(draftBillTo, fallback) {
    return w.invIssue({
      draft: { items: [], taxRate: 5, billTo: draftBillTo, no: '', date: '2026-10-31', notes: '' },
      revLines: [{ desc: '11 hrs @ $29 — 2026-10-16', amt: 319, date: '2026-10-16', src: 'dispatch' }],
      sub: 319, tax: 15.19, total: 319,
      pa: '2026-10-16', pb: '2026-10-31', today: '2026-10-31', now: 4242,
      prefNo: '', taxIncluded: true, duplicateDates: [],
      dayHours: { '2026-10-16': 11 }, cardDays: null, rate: 29, truckNo: '07',
      billToFallback: fallback,
      company: CO_BIZ, province: 'AB', country: 'Canada'
    });
  }
  const r1 = issue('', FULL_BT);
  eq('issue: verified ok', r1.ok, true);
  eq('issue: blank draft bill-to -> the record carries the saved company + address', r1.rec.billTo, FULL_BT);
  const r2 = issue('Hand Typed Co', FULL_BT);
  eq('issue: a hand-typed bill-to is stamped verbatim, fallback untouched', r2.rec.billTo, 'Hand Typed Co');
  const w2 = makeWorld('2026-10-31');
  const r3 = (function () {
    return w2.invIssue({
      draft: { items: [], taxRate: 5, billTo: '', no: '', date: '2026-10-31', notes: '' },
      revLines: [{ desc: 'x', amt: 10, date: '2026-10-16', src: 'entry' }],
      sub: 10, tax: 0.48, total: 10,
      pa: '2026-10-16', pb: '2026-10-31', today: '2026-10-31', now: 99,
      prefNo: '', taxIncluded: true, duplicateDates: [],
      company: CO_BIZ, province: 'AB', country: 'Canada'
    });
  })();
  eq('issue: blank + NO fallback anywhere -> still blank (nothing invented)', r3.rec.billTo, '');
})();

/* ============ the draft heal covers the blank case too ============ */
(function () {
  console.log('\n— invBillToHeal: a blank draft picks up the saved company —');
  const a = invSrc.indexOf('function invBillToHeal');
  const b = invSrc.indexOf('/* ---------------- contractor invoice', a);
  ok('heal: extracted from the shipped file', a !== -1 && b > a);
  const heal = new Function(invSrc.slice(a, b) + '\nreturn invBillToHeal;')();
  eq('heal: blank draft -> saved company + address', heal({ billTo: '' }, PREFS).billTo, FULL_BT);
  eq('heal: whitespace draft -> saved company + address', heal({ billTo: '  ' }, PREFS).billTo, FULL_BT);
  eq('heal: a hand-typed bill-to is still never rewritten', heal({ billTo: 'Some Other Co' }, PREFS).billTo, 'Some Other Co');
  eq('heal: no company saved -> blank stays blank', heal({ billTo: '' }, {}).billTo, '');
})();

/* ============ the note is SHORT now ============ */
(function () {
  console.log('\n— invCycDocNote: rate line + total hours, nothing else —');
  const w = makeWorld();
  function completion(date, hours, amount) {
    return { date: date, type: 'hourly', hours: hours, amount: String(amount), note: 'Dispatch: Aecon · foreman + travel = ' + hours + 'h', loads: 0 };
  }
  const entries = [
    completion('2026-10-01', 10.5, 304.50), completion('2026-10-14', 10.5, 304.50), completion('2026-10-15', 11.5, 333.50)
  ];
  const plan = w.invCycBuildRevenueLines(entries, [], 29, 'hourly');
  const cards = {
    '2026-10-14': { tickets: [{ num: '23177', foreman: 9.5 }], foreman: 9.5, travel: 1 },
    '2026-10-15': { tickets: [{ num: '21314', foreman: 10.5 }], foreman: 10.5, travel: 1 }
  };
  const note = w.invCycDocNote(plan.lines, plan.dayHours, cards, { rate: 29, taxRate: 5, taxIncluded: true });
  eq('note: EXACTLY the rate line + total hours', note,
    'Rate $29.00/hour, tax included (net rate $27.62/hour + 5% GST of $1.38/hour). Total hours: 32.5.');
  ok('note: no haul-card enumeration', note.indexOf('haul card') === -1);
  ok('note: no card numbers', note.indexOf('23177') === -1 && note.indexOf('21314') === -1);
  ok('note: no foreman/travel split wording', note.indexOf('foreman') === -1 && note.indexOf('travel per day') === -1);
  const bare = w.invCycDocNote([], {}, null, { rate: 29, taxRate: 5, taxIncluded: true });
  eq('note: no hours on record -> the rate line alone (no "Total hours: 0")', bare,
    'Rate $29.00/hour, tax included (net rate $27.62/hour + 5% GST of $1.38/hour).');
})();

/* ============ invoice #1154 itself, re-composed ============ */
(function () {
  console.log('\n— #1154 reprint: the owner\'s own figures, corrected face —');
  const w = makeWorld();
  const DAYS = [
    ['2026-10-16', 11, 319.00, '22729'], ['2026-10-17', 10, 290.00, ''],
    ['2026-10-19', 10.5, 304.50, '18961'], ['2026-10-20', 11, 319.00, '16780'],
    ['2026-10-21', 10.5, 304.50, '21625'], ['2026-10-22', 11, 319.00, '22864'],
    ['2026-10-25', 4.7, 136.21, ''], ['2026-10-26', 11, 319.00, '18960'],
    ['2026-10-28', 5, 145.00, '29868'], ['2026-10-29', 10.5, 304.50, '2338'],
    ['2026-10-30', 10, 290.00, '18959'], ['2026-10-31', 7, 203.00, '16231']
  ];
  const revLines = [], dayHours = {}, cardDays = {};
  DAYS.forEach(function (d) {
    revLines.push({ desc: d[1] + ' hrs @ $29 — ' + d[0], amt: d[2], date: d[0], src: 'dispatch' });
    dayHours[d[0]] = d[1];
    if (d[3]) cardDays[d[0]] = { tickets: [{ num: d[3], foreman: d[1] - 1 }], foreman: d[1] - 1, travel: 1 };
  });
  const t = w.invCycTotals(3253.71, 5, true);
  eq('1154 math (v285 audit): sub / included GST / total', t.sub + '/' + t.tax + '/' + t.total, '3253.71/154.94/3253.71');
  const rec = baseRec({ revLines: revLines, dayHours: dayHours, cardDays: cardDays, sub: t.sub, tax: t.tax, total: t.total });
  const html = w.invSharedDocHtml(rec, '07', false, w.invCycBillToFromPrefs(PREFS));
  ok('1154: Bill-to is AI Trucking', html.indexOf('<b>AI Trucking</b>') !== -1);
  ok('1154: Bill-to address present', html.indexOf('1506 16 St NE, Calgary, AB T2E 4T2') !== -1);
  eq('1154: twelve day rows in the hours table', (html.match(/<tr><td>/g) || []).length, 12);
  ok('1154: first + last day rows read in hour-sheet shape',
    html.indexOf('Oct 16') !== -1 && html.indexOf('Oct 31') !== -1 && html.indexOf('$203.00') !== -1);
  ok('1154: Net subtotal $3,098.77', html.indexOf('$3098.77') !== -1);
  ok('1154: GST line $154.94 with his GST number', html.indexOf('$154.94') !== -1 && html.indexOf('765662010 RT0001') !== -1);
  ok('1154: Total due $3,253.71', html.indexOf('$3253.71') !== -1);
  ok('1154: the printed note is the short one', html.indexOf('Total hours: 112.2.') !== -1);
  ok('1154: no haul-card text anywhere on the document',
    html.indexOf('haul card') === -1 && html.indexOf('22729') === -1 && html.indexOf('16231') === -1);
  ok('1154: invoice number unchanged', html.indexOf('INVOICE #1154') !== -1);
})();

/* ============ glue pins ============ */
(function () {
  console.log('\n— Glue: the doors are wired —');
  ok('glue: invIssue stamps the resolved bill-to',
    invSrc.indexOf('x.billToFallback') !== -1);
  ok('glue: the issue door passes the Preferences fallback',
    invSrc.indexOf('billToFallback: invCycBillToFromPrefs(o)') !== -1);
  ok('glue: printInvoice resolves a blank record bill-to from Preferences',
    invSrc.indexOf('invSharedDocHtml(rec, rec.truckNo || o.truckNo || \'\', true, invCycBillToFromPrefs(o))') !== -1);
  ok('glue: the payer shared door still passes NO fallback (record only)',
    invSrc.indexOf('return invSharedDocHtml(rec, (rec && rec.truckNo) || \'\', false);') !== -1);
})();

console.log('\ninvoice-billto-notes-v298: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
