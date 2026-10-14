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

/* ---------------- static layout assertions on the shipped file ---------------- */
(function () {
  ok('static: # field renders an EMPTY value (placeholder only)',
    invSrc.indexOf('esc(draft.no || \'\')') !== -1 && invSrc.indexOf('draft.no || \'(auto on save)\'') === -1);
  ok('static: # field keeps the (auto on save) placeholder attribute',
    invSrc.indexOf('placeholder="(auto on save)"') !== -1);
  ok('static: open period is labelled in plain words', invSrc.indexOf('Current period:') !== -1);
  ok('static: issue path goes through the verified invIssue', invSrc.indexOf('var res = invIssue({') !== -1);
})();

console.log('\ninvoice-cycle: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
