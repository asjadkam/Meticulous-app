#!/usr/bin/env node
/* Meticulous v55 — Invoice cycle: behavioral tests against the REAL
 * shipped code. The core store is sliced verbatim from js/app.js and
 * the INV-CYCLE region verbatim from modules/invoice.js, run in a vm
 * sandbox over a localStorage stub (with a quota-failure switch), so
 * the logic under test is the logic that ships.
 * Run: node tools/invoice-cycle-test.js
 *
 * Covers the owner's rule (Oct 14): he prints the Oct 1–15 invoice
 * himself and "the app has to be smart enough to start the cycle
 * again" — semi-monthly periods (1–15, 16–month-end), the open
 * period follows the last issued invoice, issuing is VERIFIED
 * (read-back, the v48 rule: a failed write keeps the draft and
 * prints nothing), a verified save clears the draft and advances
 * the period, and numbering never stores "(auto on save)".
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const invSrc = fs.readFileSync(path.join(ROOT, 'modules', 'invoice.js'), 'utf8');
const prefSrc = fs.readFileSync(path.join(ROOT, 'modules', 'preferences.js'), 'utf8');

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

/* A fresh "world": a new vm context (= fresh module state / reload)
 * over a SHARED backing Map (= the same localStorage). The stub's
 * setItem throws when backing.fail is set — quota simulation. */
function makeWorld(backing, today) {
  const localStorage = {
    getItem: function (k) { return backing.map.has(k) ? backing.map.get(k) : null; },
    setItem: function (k, v) {
      if (backing.fail) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      backing.map.set(k, String(v));
    },
    removeItem: function (k) { backing.map.delete(k); }
  };
  const sandbox = {
    console: console,
    localStorage: localStorage,
    App: { _today: function () { return today || '2026-10-14'; }, _esc: function (s) { return String(s == null ? '' : s); } }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractStore(appSrc), sandbox);              // real store from js/app.js
  sandbox.App._store = sandbox.store;
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sandbox); // real shipped helpers
  return sandbox;
}
function freshBacking() { return { map: new Map(), fail: false }; }

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function deepEq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* ---------------- period math ---------------- */
(function () {
  const w = makeWorld(freshBacking());
  const P = w.invCycPeriodOf;
  deepEq('period: Oct 1 in first half', P('2026-10-01'), { a: '2026-10-01', b: '2026-10-15' });
  deepEq('period: Oct 15 still first half', P('2026-10-15'), { a: '2026-10-01', b: '2026-10-15' });
  deepEq('period: Oct 16 in second half', P('2026-10-16'), { a: '2026-10-16', b: '2026-10-31' });
  deepEq('period: Oct 31 in second half', P('2026-10-31'), { a: '2026-10-16', b: '2026-10-31' });
  deepEq('period: 30-day month end', P('2026-11-16'), { a: '2026-11-16', b: '2026-11-30' });
  deepEq('period: Feb non-leap second half', P('2026-02-16'), { a: '2026-02-16', b: '2026-02-28' });
  deepEq('period: Feb leap second half', P('2028-02-16'), { a: '2028-02-16', b: '2028-02-29' });
  deepEq('period: Feb 29 itself', P('2028-02-29'), { a: '2028-02-16', b: '2028-02-29' });
  deepEq('period: Feb 2000 (leap, /400)', P('2000-02-20'), { a: '2000-02-16', b: '2000-02-29' });
  deepEq('period: Feb 2100 (not leap, /100)', P('2100-02-20'), { a: '2100-02-16', b: '2100-02-28' });
  eq('dayAfter: year rollover', w.invCycDayAfter('2026-12-31'), '2027-01-01');
  eq('dayAfter: leap Feb', w.invCycDayAfter('2028-02-28'), '2028-02-29');
  eq('dayAfter: non-leap Feb', w.invCycDayAfter('2026-02-28'), '2026-03-01');
  deepEq('next: 1-15 -> 16-end', w.invCycNextPeriod(P('2026-10-03')), { a: '2026-10-16', b: '2026-10-31' });
  deepEq('next: 16-end -> next 1-15', w.invCycNextPeriod(P('2026-10-20')), { a: '2026-11-01', b: '2026-11-15' });
  deepEq('next: Dec 16-31 -> Jan 1-15', w.invCycNextPeriod(P('2026-12-25')), { a: '2027-01-01', b: '2027-01-15' });
  eq('label: with year', w.invCycLabel({ a: '2026-10-16', b: '2026-10-31' }), 'Oct 16–31, 2026');
  eq('short: no year', w.invCycShort({ a: '2026-10-01', b: '2026-10-15' }), 'Oct 1–15');
})();

/* ---------------- open-period selection ---------------- */
(function () {
  const w = makeWorld(freshBacking());
  const O = w.invCycOpenPeriod;
  deepEq('open: no history, today in first half', O([], '2026-10-14'), { a: '2026-10-01', b: '2026-10-15' });
  deepEq('open: no history, today in second half', O([], '2026-10-20'), { a: '2026-10-16', b: '2026-10-31' });
  deepEq('open: after issuing 1-15', O([{ no: '1', pb: '2026-10-15' }], '2026-10-14'), { a: '2026-10-16', b: '2026-10-31' });
  deepEq('open: after issuing 16-31', O([{ no: '2', pb: '2026-10-31' }], '2026-10-20'), { a: '2026-11-01', b: '2026-11-15' });
  deepEq('open: Dec -> Jan rollover', O([{ no: '9', pb: '2026-12-31' }], '2026-12-20'), { a: '2027-01-01', b: '2027-01-15' });
  deepEq('open: furthest period end wins (out-of-order issues)',
    O([{ no: '3', pb: '2026-11-15' }, { no: '2', pb: '2026-10-15' }], '2026-10-14'),
    { a: '2026-11-16', b: '2026-11-30' });
  deepEq('open: legacy record without pb falls back to its date period',
    O([{ no: '1', date: '2026-10-15' }], '2026-10-14'), { a: '2026-10-16', b: '2026-10-31' });
})();

/* ---------------- numbering ---------------- */
(function () {
  const w = makeWorld(freshBacking());
  eq('number: none issued -> 1', w.invCycNextNo([]), '1');
  eq('number: after #10 -> 11', w.invCycNextNo([{ no: '10' }]), '11');
  eq('number: max wins', w.invCycNextNo([{ no: '9' }, { no: '10' }, { no: '3' }]), '11');
  eq('number: formatted INV-2026-0007 -> 8', w.invCycNextNo([{ no: 'INV-2026-0007' }]), '8');
  eq('number: non-numeric ignored', w.invCycNextNo([{ no: 'abc' }, { no: '' }]), '1');
  eq('number: the sequence is max+1, nothing hardcoded', w.invCycNextNo([{ no: '1150' }]), '1151');
  eq('collision: same number', w.invCycCollision([{ no: '10' }], '10'), true);
  eq('collision: trims whitespace', w.invCycCollision([{ no: '10' }], ' 10 '), true);
  eq('collision: different number', w.invCycCollision([{ no: '10' }], '11'), false);
  eq('collision: empty never collides', w.invCycCollision([{ no: '10' }], ''), false);
})();

/* ---------------- issue -> rollover (the owner's real shape) ---------------- */
function issueArgs(draft, pa, pb, now) {
  return {
    draft: draft,
    revLines: [{ desc: '102.5 hrs @ $29 — 2026-10-01..15', amt: 2972.50, date: '2026-10-01', src: 'entry' }],
    sub: 2972.50, tax: 0, total: 2972.50,
    pa: pa, pb: pb, today: '2026-10-14', now: now,
    company: { name: 'Meticulous Technologies', gst: '', addr: '' }, province: 'AB', country: 'Canada'
  };
}
function emptyDraft(no) {
  return { items: [], taxRate: 0, billTo: 'Ai Trucking', no: no, date: '2026-10-15', notes: '' };
}
(function () {
  const b = freshBacking();
  const w = makeWorld(b, '2026-10-14');
  const S = function (k, d) { return w.App._store.get('inv_' + k, d); };

  /* First issue: Oct 1–15, # left empty, no prior invoices -> #1. */
  w.App._store.set('inv_draft', emptyDraft(''));
  const r1 = w.invIssue(issueArgs(emptyDraft(''), '2026-10-01', '2026-10-15', 111));
  eq('issue 1: ok', r1.ok, true);
  eq('issue 1: auto number is 1 (empty list -> max+1)', r1.rec.no, '1');
  eq('issue 1: total stored', r1.rec.total, 2972.50);
  eq('issue 1: period stored on the record', r1.rec.pa + '..' + r1.rec.pb, '2026-10-01..2026-10-15');
  eq('issue 1: archived in inv_list', S('list', []).length, 1);
  eq('issue 1: draft cleared for the new cycle', S('draft', null), null);
  eq('issue 1: period advanced to Oct 16-31', S('pa', '') + '..' + S('pb', ''), '2026-10-16..2026-10-31');
  eq('issue 1: confirmation wording', S('cycmsg', ''), 'Invoice #1 saved for Oct 1–15. Next period: Oct 16–31.');

  /* Second issue: Oct 16–31 -> cycle rolls to Nov 1–15, number 2. */
  const r2 = w.invIssue(issueArgs(emptyDraft(''), '2026-10-16', '2026-10-31', 222));
  eq('issue 2: ok', r2.ok, true);
  eq('issue 2: number is 2', r2.rec.no, '2');
  eq('issue 2: period advanced to Nov 1-15', S('pa', '') + '..' + S('pb', ''), '2026-11-01..2026-11-15');
  eq('issue 2: confirmation wording', S('cycmsg', ''), 'Invoice #2 saved for Oct 16–31. Next period: Nov 1–15.');
  eq('issue 2: both invoices archived', S('list', []).length, 2);
})();

/* ---------------- numbering at issue time ---------------- */
(function () {
  const b = freshBacking();
  const w = makeWorld(b, '2026-10-14');
  const S = function (k, d) { return w.App._store.get('inv_' + k, d); };

  /* Typed number wins over the sequence. */
  const rt = w.invIssue(issueArgs(emptyDraft('10'), '2026-10-01', '2026-10-15', 333));
  eq('typed: ok', rt.ok, true);
  eq('typed: 10 stored as typed', rt.rec.no, '10');
  /* ...and the next empty save continues from it. */
  const rn = w.invIssue(issueArgs(emptyDraft(''), '2026-10-16', '2026-10-31', 444));
  eq('typed: next auto is 11', rn.rec.no, '11');

  /* A legacy draft carrying the placeholder text as a VALUE is
     treated as empty — "(auto on save)" can never be stored. */
  const rp = w.invIssue(issueArgs(emptyDraft('(auto on save)'), '2026-11-01', '2026-11-15', 555));
  eq('placeholder: ok', rp.ok, true);
  eq('placeholder: auto number assigned instead', rp.rec.no, '12');
  ok('placeholder: never stored as a number',
    S('list', []).every(function (r) { return r.no !== '(auto on save)'; }));

  /* Collision: a typed number that is already issued is refused,
     nothing is written, the draft survives. */
  w.App._store.set('inv_draft', emptyDraft('10'));
  const rc = w.invIssue(issueArgs(emptyDraft('10'), '2026-11-16', '2026-11-30', 666));
  eq('collision: refused', rc.ok, false);
  eq('collision: stage', rc.stage, 'collision');
  eq('collision: list unchanged', S('list', []).length, 3);
  deepEq('collision: draft intact', S('draft', null), emptyDraft('10'));
})();

/* ---------------- verified save: failure keeps everything ---------------- */
(function () {
  const b = freshBacking();
  const w = makeWorld(b, '2026-10-14');
  const S = function (k, d) { return w.App._store.get('inv_' + k, d); };
  const draft = emptyDraft('');
  draft.items = [{ desc: 'Gravel haul', qty: 2, rate: 150 }];
  w.App._store.set('inv_draft', draft);
  w.App._store.set('inv_pa', '2026-10-01'); w.App._store.set('inv_pb', '2026-10-15');

  b.fail = true; // storage full: every write throws
  const rf = w.invIssue(issueArgs(draft, '2026-10-01', '2026-10-15', 777));
  b.fail = false;
  eq('failure: not ok', rf.ok, false);
  eq('failure: stage is write', rf.stage, 'write');
  eq('failure: nothing archived', S('list', []).length, 0);
  deepEq('failure: draft fully intact (manual lines included)', S('draft', null), draft);
  eq('failure: period not advanced', S('pa', '') + '..' + S('pb', ''), '2026-10-01..2026-10-15');
  eq('failure: no confirmation stored (nothing to print about)', S('cycmsg', ''), '');
})();

/* ---------------- duplicate-date heads-up (stretch) ---------------- */
(function () {
  const w = makeWorld(freshBacking());
  const lines = [
    { date: '2026-10-13', src: 'dispatch' },
    { date: '2026-10-13', src: 'tracker' },
    { date: '2026-10-13', src: 'entry' },
    { date: '2026-10-12', src: 'dispatch' },
    { date: '2026-10-12', src: 'dispatch' },
    { date: '2026-10-11', src: 'tracker' },
    { date: '2026-10-10', src: 'extra' }
  ];
  deepEq('dup: dispatch+tracker same date flagged once', w.invCycDupDates(lines), ['Oct 13']);
  deepEq('dup: no lines -> no warning', w.invCycDupDates([]), []);
  deepEq('dup: single source only -> no warning',
    w.invCycDupDates([{ date: '2026-10-13', src: 'tracker' }, { date: '2026-10-13', src: 'tracker' }]), []);
})();

/* ---------------- v79: one line per day, confirmed source only ---------------- */
(function () {
  const w = makeWorld(freshBacking());
  const B = w.invCycBuildRevenueLines;
  /* The Oct 15 shape: a dispatch completion AND a tracker session
     for the same day — the completion is the day's one line. */
  const plan = B([
    { date: '2026-10-15', hours: '10.04', note: 'Auto from tracker', auto: true },
    { date: '2026-10-15', hours: '11.50', note: 'Dispatch: 12th Street · foreman 10.5h + travel 1h = 11.5h' },
    { date: '2026-10-14', hours: '9.63', note: 'Auto from tracker', auto: true }
  ], [], 29, 'hourly');
  eq('v79 lines: one line per day', plan.lines.length, 2);
  eq('v79 lines: sorted by day', plan.lines[0].date + '/' + plan.lines[1].date, '2026-10-14/2026-10-15');
  eq('v79 lines: completion wins over tracker', plan.lines[1].amt, 333.50);
  eq('v79 lines: completion source kept', plan.lines[1].src, 'dispatch');
  eq('v79 lines: tracker line excluded, not summed', plan.lines[1].desc.indexOf('10.04'), -1);
  eq('v79 lines: tracker-only day kept', plan.lines[0].amt, 279.27);
  eq('v79 lines: tracker-only day flagged unconfirmed', plan.lines[0].unconfirmed, true);
  deepEq('v79 lines: unconfirmed dates listed', plan.unconfirmedDates, ['2026-10-14']);
  deepEq('v79 lines: no blocking duplicates', plan.duplicateDates, []);

  /* Several tracker entries, no confirmed source: unresolvable. */
  const blocked = B([
    { date: '2026-10-15', hours: '5.00', note: 'Auto from tracker', auto: true },
    { date: '2026-10-15', hours: '5.04', note: 'Auto from tracker', auto: true }
  ], [], 29, 'hourly');
  eq('v79 blocked: no line emitted for the day', blocked.lines.length, 0);
  deepEq('v79 blocked: day named as duplicate', blocked.duplicateDates, ['2026-10-15']);

  /* Several completions on one day combine into the day's one line. */
  const multi = B([
    { date: '2026-10-06', hours: '5', note: 'Dispatch: Pit A' },
    { date: '2026-10-06', hours: '6.5', note: 'Dispatch: Pit B' }
  ], [], 29, 'hourly');
  eq('v79 multi: still one line', multi.lines.length, 1);
  eq('v79 multi: amounts summed', multi.lines[0].amt, 333.50);

  /* A manual entry also outranks a tracker entry for its day. */
  const manual = B([
    { date: '2026-10-03', hours: '9.63', note: 'Auto from tracker', auto: true },
    { date: '2026-10-03', hours: '9', note: 'Sheet import' }
  ], [], 29, 'hourly');
  eq('v79 manual: one line, manual wins', manual.lines.length + '/' + manual.lines[0].amt, '1/261');

  /* Extras are separate charges — they pass through untouched. */
  const withExtra = B([], [{ date: '2026-10-15', type: 'Fuel surcharge', amount: '25' }], 29, 'hourly');
  eq('v79 extras: pass through', withExtra.lines.length + '/' + withExtra.lines[0].src + '/' + withExtra.lines[0].amt, '1/extra/25');

  eq('v79 src: dispatch note', w.invCycEntrySrc({ note: 'Dispatch: X' }), 'dispatch');
  eq('v79 src: auto flag', w.invCycEntrySrc({ note: 'anything', auto: true }), 'tracker');
  eq('v79 src: tracker note', w.invCycEntrySrc({ note: 'Auto from tracker' }), 'tracker');
  eq('v79 src: plain entry', w.invCycEntrySrc({ note: 'Sheet import' }), 'entry');
})();

/* ---------------- v79: totals, tax-inclusive math, numbering helpers ---------------- */
(function () {
  const w = makeWorld(freshBacking());
  const inc = w.invCycTotals(3610.50, 5, true);
  eq('v79 tax-incl: subtotal is the lines sum', inc.sub, 3610.50);
  eq('v79 tax-incl: included GST = sub x 5/105', inc.tax, 171.93);
  eq('v79 tax-incl: total due = subtotal (nothing added)', inc.total, 3610.50);
  const add = w.invCycTotals(100, 5, false);
  eq('v79 tax add-on: unchanged behaviour', add.sub + '/' + add.tax + '/' + add.total, '100/5/105');
  eq('v79 tax-incl: zero rate -> zero tax', w.invCycTotals(200, 0, true).tax, 0);
  eq('v79 increment: plain', w.invCycIncrementNo('1151'), '1152');
  eq('v79 increment: zero-padded', w.invCycIncrementNo('009'), '010');
  eq('v79 increment: formatted keeps its prefix', w.invCycIncrementNo('INV-2026-0007'), 'INV-2026-0008');
  eq('v79 increment: no digits -> empty', w.invCycIncrementNo('abc'), '');
  eq('v79 company: empty name is missing', w.invCycCompanyMissing({ name: '  ' }), true);
  eq('v79 company: a name satisfies the check', w.invCycCompanyMissing({ name: 'Asjad Kamal' }), false);
  eq('v79 company: no company at all is missing', w.invCycCompanyMissing(null), true);
})();

/* ---------------- v79: issue — pref number, issue date, duplicate block ---------------- */
(function () {
  const b = freshBacking();
  const w = makeWorld(b, '2026-10-15');
  const S = function (k, d) { return w.App._store.get('inv_' + k, d); };
  let advancedTo = null;
  const draft = emptyDraft('');
  draft.date = '2026-10-14'; // the draft was created yesterday…
  const args = issueArgs(draft, '2026-10-01', '2026-10-15', 999);
  args.today = '2026-10-15'; // …but it is issued today
  args.prefNo = '1151';
  args.taxIncluded = true;
  const tt = w.invCycTotals(3610.50, 5, true);
  args.sub = tt.sub; args.tax = tt.tax; args.total = tt.total;
  args.setNextInvoiceNo = function (n) { advancedTo = n; };
  w.App._store.set('inv_draft', draft);
  const r = w.invIssue(args);
  eq('v79 issue: ok', r.ok, true);
  eq('v79 issue: Preferences number used', r.rec.no, '1151');
  eq('v79 issue: date is the ISSUE date, not the draft date', r.rec.date, '2026-10-15');
  eq('v79 issue: draft date kept on the record', r.rec.draftDate, '2026-10-14');
  eq('v79 issue: tax-inclusive flag stored', r.rec.taxIncluded, true);
  eq('v79 issue: totals stored', r.rec.sub + '/' + r.rec.tax + '/' + r.rec.total, '3610.5/171.93/3610.5');
  eq('v79 issue: Preferences sequence advanced by callback', advancedTo, '1152');
  eq('v79 issue: nextPrefNo returned', r.nextPrefNo, '1152');

  /* The preferred number collides once it has been issued. */
  const rc = w.invIssue(Object.assign({}, args, { prefNo: '1151', now: 1000 }));
  eq('v79 pref collision: refused', rc.ok, false);
  eq('v79 pref collision: stage', rc.stage, 'collision');
  eq('v79 pref collision: sequence not advanced again', advancedTo, '1152');

  /* A duplicate day blocks the save outright — nothing is written. */
  w.App._store.set('inv_draft', draft);
  const rd = w.invIssue(Object.assign({}, args, { prefNo: '1152', duplicateDates: ['2026-10-15'], now: 1001 }));
  eq('v79 duplicate: refused', rd.ok, false);
  eq('v79 duplicate: stage', rd.stage, 'duplicate');
  ok('v79 duplicate: message names the day', rd.message.indexOf('Oct 15') !== -1, rd.message);
  eq('v79 duplicate: nothing archived', S('list', []).length, 1);
  deepEq('v79 duplicate: draft intact', S('draft', null), draft);
})();

/* ---------------- static layout assertions on the shipped file ---------------- */
(function () {
  ok('static: # field renders an EMPTY value (placeholder only)',
    invSrc.indexOf('esc(draft.no || \'\')') !== -1 && invSrc.indexOf('draft.no || \'(auto on save)\'') === -1);
  ok('static: # field keeps the (auto on save) placeholder attribute',
    invSrc.indexOf('placeholder="(auto on save)"') !== -1);
  ok('static: open period is labelled in plain words', invSrc.indexOf('Current period:') !== -1);
  ok('static: issue path goes through the verified invIssue', invSrc.indexOf('var res = invIssue({') !== -1);
  /* v79 statics */
  ok('v79 static: draft # fills from Preferences next number', invSrc.indexOf('if (!draft.no && o.nextInvoiceNo)') !== -1);
  ok('v79 static: issue passes the Preferences number', invSrc.indexOf("prefNo: o.nextInvoiceNo || ''") !== -1);
  ok('v79 static: issue passes duplicate days to the blocker', invSrc.indexOf('duplicateDates: (revPlan && revPlan.duplicateDates) || []') !== -1);
  ok('v79 static: issue passes the tax-inclusive mode', invSrc.indexOf('taxIncluded: taxIncluded') !== -1);
  ok('v79 static: totals label the included tax', invSrc.indexOf('% GST, included in the rate') !== -1);
  ok('v79 static: tracker-only line flagged in the UI', invSrc.indexOf('from tracker — unconfirmed') !== -1);
  ok('v79 static: business check prompt copy', invSrc.indexOf('Your business name/address/GST aren') !== -1);
  ok('v79 static: business check buttons', invSrc.indexOf('id="iv_biz_prefs"') !== -1 && invSrc.indexOf('>Set them now</button>') !== -1 && invSrc.indexOf('id="iv_biz_print"') !== -1 && invSrc.indexOf('>Print anyway</button>') !== -1);
  ok('v79 static: Preferences has Next invoice number', prefSrc.indexOf('id="pf_nextinv"') !== -1 && prefSrc.indexOf('Next invoice number') !== -1);
  ok('v79 static: Preferences has the tax-inclusive toggle', prefSrc.indexOf('id="pf_taxincl"') !== -1 && prefSrc.indexOf('My rate includes tax') !== -1);
  ok('v79 static: Preferences has the tax rate (default 5)', prefSrc.indexOf('id="pf_invtax"') !== -1 && prefSrc.indexOf("? '5' : o.invoiceTaxRate") !== -1);
  ok('v79 static: Preferences saves the invoice settings', prefSrc.indexOf("o.nextInvoiceNo = g('pf_nextinv')") !== -1 && prefSrc.indexOf("o.rateIncludesTax = body.querySelector('#pf_taxincl').checked") !== -1 && prefSrc.indexOf("o.invoiceTaxRate = g('pf_invtax') || '5'") !== -1);
})();

/* ---------------- v134: a print is not an issue — the number lifecycle ----------------
   Owner evidence (Oct 17): he re-prints a period again and again
   "to see its face" and each look wore a NEW number (#1152, then
   #1153) because printing and issuing were the same button. Now:
   the would-be number is computed purely, minting happens ONLY in
   invIssue, and a reprint carries the archived record's own
   number. */
(function () {
  const b = freshBacking();
  const w = makeWorld(b, '2026-10-17');
  const S = function (k, d) { return w.App._store.get('inv_' + k, d); };

  eq('v134 would-be: Preferences sequence shows on a draft print', w.invCycWouldBeNo([], '', '1152'), '1152');
  eq('v134 would-be: a typed number wins', w.invCycWouldBeNo([], '2001', '1152'), '2001');
  eq('v134 would-be: the placeholder is not a number', w.invCycWouldBeNo([], '(auto on save)', ''), '1');
  eq('v134 would-be: no pref, no typed -> max(issued)+1', w.invCycWouldBeNo([{ no: '1151' }], '', ''), '1152');

  /* Three "test prints" of the same draft: nothing archived,
     nothing advanced, the would-be number unmoved. */
  for (let i = 0; i < 3; i++) w.invCycWouldBeNo(S('list', []), '', '1152');
  eq('v134 prints: three draft prints archive nothing', S('list', []).length, 0);
  eq('v134 prints: the would-be number is unmoved after them', w.invCycWouldBeNo(S('list', []), '', '1152'), '1152');

  /* The one real issue mints exactly once. */
  let advancedTo = null;
  const args = issueArgs(emptyDraft(''), '2026-10-16', '2026-10-31', 4242);
  args.today = '2026-10-17'; args.prefNo = '1152';
  args.setNextInvoiceNo = function (n) { advancedTo = n; };
  const r = w.invIssue(args);
  eq('v134 issue: ok', r.ok, true);
  eq('v134 issue: the minted number is the one the prints showed', r.rec.no, '1152');
  eq('v134 issue: exactly one record archived', S('list', []).length, 1);
  eq('v134 issue: the Preferences sequence advanced once, by the callback', advancedTo, '1153');
  eq('v134 reprint: the archived record carries its own number (a reprint mints nothing)',
    S('list', [])[0].no, '1152');
  eq('v134 reprint: the list is still exactly one record', S('list', []).length, 1);
})();

/* ---------------- v134: mark settled outside the app ----------------
   His Oct 1–15, 2026 was settled by hand-built invoice #1151 —
   sent by him, paid against — while the app still offered the
   period as open. The door records the fact (period + the number
   he used), advances the open period, records NO money, leaves
   the Preferences sequence alone, and removes cleanly. */
(function () {
  const b = freshBacking();
  const w = makeWorld(b, '2026-10-17');
  const S = function (k, d) { return w.App._store.get('inv_' + k, d); };
  /* His app state: the last recorded period ended Sep 30, so
     Oct 1–15 stands open. */
  w.App._store.set('inv_list', [{ id: 'inv-sep', no: '1150', date: '2026-09-30', pa: '2026-09-16', pb: '2026-09-30', total: 2871 }]);
  eq('v134 settled: before the door, Oct 1–15 is the open period',
    JSON.stringify(w.invCycOpenPeriod(S('list', []), '2026-10-17')), JSON.stringify({ a: '2026-10-01', b: '2026-10-15' }));

  const noNum = w.invCycMarkSettled({ pa: '2026-10-01', pb: '2026-10-15', externalNo: '', today: '2026-10-17', now: 900 });
  eq('v134 settled: no number -> refused', noNum.ok, false);
  eq('v134 settled: no number -> stage', noNum.stage, 'number');
  const badPer = w.invCycMarkSettled({ pa: '2026-10-15', pb: '2026-10-01', externalNo: '1151', today: '2026-10-17', now: 901 });
  eq('v134 settled: backwards period -> refused', badPer.ok, false);
  eq('v134 settled: backwards period -> stage', badPer.stage, 'period');
  eq('v134 settled: refusals recorded nothing', S('list', []).length, 1);

  const ms = w.invCycMarkSettled({ pa: '2026-10-01', pb: '2026-10-15', externalNo: '1151', today: '2026-10-17', now: 902 });
  eq('v134 settled: ok', ms.ok, true);
  eq('v134 settled: the record is flagged settled-outside', ms.rec.settledOutside, true);
  eq('v134 settled: NO money is recorded (totals stay null)', ms.rec.total === null && ms.rec.sub === null && ms.rec.tax === null, true);
  eq('v134 settled: the record carries the period + number he stated',
    ms.rec.pa + '..' + ms.rec.pb + ' #' + ms.rec.no, '2026-10-01..2026-10-15 #1151');
  eq('v134 settled: no Preferences advance is reported (his 1152 stays his)', ms.nextPrefNo, undefined);
  eq('v134 settled: open period advances to Oct 16–31',
    JSON.stringify(w.invCycOpenPeriod(S('list', []), '2026-10-17')), JSON.stringify({ a: '2026-10-16', b: '2026-10-31' }));
  eq('v134 settled: the stored period inputs advanced too', S('pa', '') + '..' + S('pb', ''), '2026-10-16..2026-10-31');
  eq('v134 settled: the next number off the records is 1152 (settled # counts once)',
    w.invCycWouldBeNo(S('list', []), '', ''), '1152');

  const dup = w.invCycMarkSettled({ pa: '2026-10-01', pb: '2026-10-15', externalNo: '1151', today: '2026-10-17', now: 903 });
  eq('v134 settled: the same number twice -> refused', dup.ok, false);
  eq('v134 settled: duplicate stage is collision', dup.stage, 'collision');
  const clash = w.invIssue(Object.assign({}, issueArgs(emptyDraft(''), '2026-10-16', '2026-10-31', 904), { prefNo: '1151', today: '2026-10-17' }));
  eq('v134 settled: issuing the settled number is refused as a collision', clash.ok, false);
  eq('v134 settled: issue collision stage', clash.stage, 'collision');

  const rmReal = w.invCycRemoveSettled('inv-sep', '2026-10-17');
  eq('v134 unsettle: a REAL issued invoice cannot be removed here', rmReal.ok, false);
  const rm = w.invCycRemoveSettled(ms.rec.id, '2026-10-17');
  eq('v134 unsettle: ok', rm.ok, true);
  eq('v134 unsettle: the period opens again (Oct 1–15)',
    JSON.stringify(w.invCycOpenPeriod(S('list', []), '2026-10-17')), JSON.stringify({ a: '2026-10-01', b: '2026-10-15' }));
  eq('v134 unsettle: only the settled record is gone', S('list', []).length, 1);
  const rmAgain = w.invCycRemoveSettled(ms.rec.id, '2026-10-17');
  eq('v134 unsettle: removing twice is refused', rmAgain.ok, false);
})();

/* ---------------- v134 statics: the preview + the door ---------------- */
(function () {
  ok('v134 static: the preview button exists and says it does not save',
    invSrc.indexOf('id="iv_preview"') !== -1 && invSrc.indexOf("Print preview — doesn\\'t save") !== -1);
  const pvA = invSrc.indexOf('var previewBtn');
  const pvB = invSrc.indexOf('the settled-outside door — two steps', pvA);
  const pvSlice = pvA !== -1 && pvB > pvA ? invSrc.slice(pvA, pvB) : '';
  ok('v134 static: the preview handler never issues, never writes the list, never advances the sequence',
    pvSlice.length > 0 && pvSlice.indexOf('invIssue(') === -1 && pvSlice.indexOf("W('list'") === -1 &&
    pvSlice.indexOf('invW(') === -1 && pvSlice.indexOf('setNextInvoiceNo') === -1,
    pvSlice.slice(0, 120));
  ok('v134 static: the preview prints through the one printInvoice, with the would-be number',
    pvSlice.indexOf('printInvoice({') !== -1 && pvSlice.indexOf('invCycWouldBeNo(invoices(), draft.no') !== -1);
  ok('v134 static: the settled door renders (quiet card + two-step confirm)',
    invSrc.indexOf('Settled outside the app?') !== -1 && invSrc.indexOf('id="iv_settle_go"') !== -1 &&
    invSrc.indexOf('id="iv_settle_yes"') !== -1 && invSrc.indexOf('invCycMarkSettled({') !== -1);
  ok('v134 static: settled records render as facts, not money, with a remove door',
    invSrc.indexOf('· settled outside the app') !== -1 && invSrc.indexOf('data-unsettle="') !== -1 &&
    invSrc.indexOf('invCycRemoveSettled(') !== -1);
})();

console.log('\ninvoice-cycle: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
