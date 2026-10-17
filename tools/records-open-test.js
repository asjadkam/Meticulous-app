#!/usr/bin/env node
/* Meticulous v75 — RECORDS YOU CAN OPEN (owner field reports, Oct 14).
 *
 * Three "records you can't open" defects, one family:
 *  (1) REVENUE: the period chart and the main Entries/Extras lists
 *      gave no way to open ONE day, and no entry could be EDITED
 *      anywhere (v47 Day Details were view + delete only). Owner:
 *      "make sure revenue entries are clickable as well." Now: chart
 *      bars, day rows, and the main list rows open Day Details;
 *      entries and extras edit there through applyEntryEdit /
 *      applyExtraEdit and save VERIFIED the v48 way.
 *  (2) FUEL: Fill-ups history rows were inert. Now a tap opens the
 *      entry in the form in EDIT mode (applyFillEdit: same entry,
 *      no duplicate, verified) — and fillGuard blocks the save the
 *      owner's phone proves happened: litres AND cost both empty
 *      (the blank "L — $ · 2026-10-13 · odo 168510" entry).
 *  (3) DISPATCH: Edit on a History item loaded the form at the top
 *      of the module but never scrolled to it. dspScrollToForm now
 *      scrolls to the form card immediately, next frame, and once
 *      more after late layout; the History item itself is marked
 *      "you're editing this one" at the tap point.
 *  (4) MANIFEST (display-hardening): collect() computed the session
 *      start as endedAt - seconds on an ISO STRING (app.js stores
 *      endedAt via toISOString) → NaN → the literal text
 *      "Invalid Date" on the owner's phone. stampMs/fmtStamp/
 *      fmtStartOf parse first; unparseable renders '—'. The existing
 *      manifest suites fixture NUMERIC endedAt — which is why the
 *      bug survived them; the fixtures below use the real ISO form.
 *
 * Run: node tools/records-open-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const revSrc = fs.readFileSync(path.join(ROOT, 'modules', 'revenue.js'), 'utf8');
const fuelSrc = fs.readFileSync(path.join(ROOT, 'modules', 'fuel.js'), 'utf8');
const dspSrc = fs.readFileSync(path.join(ROOT, 'modules', 'dispatch.js'), 'utf8');
const manSrc = fs.readFileSync(path.join(ROOT, 'modules', 'manifest.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* In-memory store with the v48 semantics (set returns bool) and a
   silent-failure switch: failWrites makes set() drop the write and
   return false WITHOUT raising — the exact failure verified saves
   exist to catch. */
function makeStore() {
  const mem = {};
  const store = {
    _fail: false,
    get: function (k, d) {
      return Object.prototype.hasOwnProperty.call(mem, k) ? JSON.parse(JSON.stringify(mem[k])) : d;
    },
    set: function (k, v) {
      if (store._fail) return false;
      mem[k] = JSON.parse(JSON.stringify(v));
      return true;
    },
    del: function (k) { delete mem[k]; return true; },
    _mem: mem
  };
  return store;
}

/* ================================================================
 * A. MANIFEST — ISO-string session stamps (the real storage form)
 * ================================================================ */
console.log('A. manifest stamp hardening');
{
  const a0 = manSrc.indexOf('function stampMs');
  const a1 = manSrc.indexOf('function collect');
  ok('a: stamp helpers sit before collect()', a0 > 0 && a1 > a0);
  const slice = manSrc.slice(a0, a1);
  const sb = { Date: Date, parseFloat: parseFloat, isFinite: isFinite };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(slice + '\nthis.__h = { stampMs: stampMs, fmtStamp: fmtStamp, fmtStartOf: fmtStartOf };', sb);
  const H = sb.__h;

  const endISO = '2026-10-14T17:38:00.000Z';
  const secs = 9.5 * 3600; // the Oct 14 shift: 8:00 start, 17:38 end
  const wantStart = new Date(Date.parse(endISO) - secs * 1000).toLocaleTimeString();
  const wantEnd = new Date(Date.parse(endISO)).toLocaleTimeString();
  eq('a: ISO endedAt start renders the real start (not "Invalid Date")',
    H.fmtStartOf({ endedAt: endISO, seconds: secs }), wantStart);
  ok('a: start is never the literal "Invalid Date"',
    H.fmtStartOf({ endedAt: endISO, seconds: secs }) !== 'Invalid Date');
  eq('a: ISO endedAt end renders the real end', H.fmtStamp(endISO), wantEnd);
  eq('a: numeric endedAt (older fixtures) renders identically',
    H.fmtStartOf({ endedAt: Date.parse(endISO), seconds: secs }), wantStart);
  eq('a: garbage endedAt start renders —', H.fmtStartOf({ endedAt: 'not a date', seconds: 60 }), '—');
  eq('a: garbage endedAt renders —', H.fmtStamp('not a date'), '—');
  eq('a: missing stamp renders —', H.fmtStamp(undefined), '—');
  eq('a: zero stamp renders —', H.fmtStamp(0), '—');
  eq('a: session with no seconds still starts at its end',
    H.fmtStartOf({ endedAt: endISO }), wantEnd);
  eq('a: stampMs passes numbers through', H.stampMs(1760000000000), 1760000000000);
  eq('a: stampMs parses ISO strings', H.stampMs(endISO), Date.parse(endISO));

  ok('a: collect() starts from fmtStartOf (parsed), not raw arithmetic',
    manSrc.includes('fmtStartOf(sessions[0])') &&
    !manSrc.includes('sessions[0].endedAt - sessions[0].seconds'));
  ok('a: no raw new Date().toLocaleTimeString() left on stored stamps',
    !manSrc.includes('new Date(x.at)') && !manSrc.includes('new Date(ev.t)') &&
    !manSrc.includes('new Date(live.startMs)'));
}

/* ================================================================
 * B. FUEL — the guard, the same-entry edit, the verified save
 * ================================================================ */
console.log('B. fuel open/edit');
{
  const b0 = fuelSrc.indexOf('var S = function');
  const b1 = fuelSrc.indexOf('/* FUEL-OPEN-END */');
  ok('b: FUEL-OPEN region markers present', b0 >= 0 && b1 > b0);
  const slice = fuelSrc.slice(b0, fuelSrc.indexOf('\n', b1) + 1);
  const store = makeStore();
  const sb = {
    App: {
      _store: store,
      _esc: function (s) { return String(s === null || s === undefined ? '' : s); },
      _today: function () { return '2026-10-14'; }
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(slice +
    '\nthis.__h = { fillGuard: fillGuard, applyFillEdit: applyFillEdit, saveFillsVerified: saveFillsVerified, fills: fills };', sb);
  const H = sb.__h;

  /* the guard — the blank phone entry must be impossible now */
  ok('b: guard blocks litres AND cost both empty', typeof H.fillGuard('', '') === 'string');
  ok('b: guard blocks both zero', typeof H.fillGuard('0', '0') === 'string');
  ok('b: guard blocks non-numeric noise', typeof H.fillGuard('abc', '') === 'string');
  eq('b: guard passes litres only', H.fillGuard('94.522', ''), null);
  eq('b: guard passes cost only', H.fillGuard('', '234.32'), null);
  eq('b: guard passes both', H.fillGuard('94.522', '234.32'), null);
  ok('b: guard message is plain (names both fields)',
    /litres/.test(H.fillGuard('', '')) && /cost/.test(H.fillGuard('', '')));

  /* the same-entry edit — the Oct 13 blank entry, filled in at last */
  const blank = { date: '2026-10-13', litres: '', cost: '', odo: 168510, station: '', photo: 'data:image/jpeg;base64,XX', card: 'fleet' };
  const edited = H.applyFillEdit(blank, {
    date: '2026-10-13', litres: '83.965', cost: '191.36', station: 'Mobil Westwinds', odo: '168510'
  });
  eq('b: edit fills the blank entry in place (litres)', edited.litres, '83.965');
  eq('b: edit fills the blank entry in place (cost)', edited.cost, '191.36');
  eq('b: edit keeps the odometer as a number', edited.odo, 168510);
  eq('b: edit keeps fields the form does not know (photo)', edited.photo, 'data:image/jpeg;base64,XX');
  eq('b: edit keeps fields the form does not know (card)', edited.card, 'fleet');
  const odoCleared = H.applyFillEdit(blank, {
    date: '2026-10-13', litres: '10', cost: '25', station: '', odo: ''
  });
  ok('b: clearing the odometer REMOVES the field (v44 no-odo convention)',
    !Object.prototype.hasOwnProperty.call(odoCleared, 'odo'));

  /* verified save — write, read back, compare */
  const list = [blank, { date: '2026-10-14', litres: '94.522', cost: '234.32', station: 'Mobil' }];
  eq('b: verified save reports success', H.saveFillsVerified(list), true);
  eq('b: the store holds exactly the saved list', store.get('fuel_fills', null), list);
  const before = JSON.stringify(store.get('fuel_fills', null));
  store._fail = true;
  eq('b: a silently-failed write is CAUGHT by the read-back', H.saveFillsVerified([edited]), false);
  eq('b: ...and the stored list is untouched', JSON.stringify(store.get('fuel_fills', null)), before);
  store._fail = false;

  /* edit round-trip through the store: same length, same slot */
  const cur = H.fills();
  cur[0] = H.applyFillEdit(cur[0], { date: '2026-10-13', litres: '83.965', cost: '191.36', station: 'Mobil Westwinds', odo: '168510' });
  eq('b: round-trip save verifies', H.saveFillsVerified(cur), true);
  eq('b: round-trip made NO duplicate', H.fills().length, 2);
  eq('b: round-trip updated slot 0', H.fills()[0].cost, '191.36');
  eq('b: round-trip left slot 1 alone', H.fills()[1].cost, '234.32');

  /* statics — the render wiring is the shipped behavior */
  ok('b: history rows are tappable (data-fuedit + handler)',
    fuelSrc.includes('data-fuedit="') && fuelSrc.includes("querySelectorAll('[data-fuedit]')"));
  ok('b: rows carry the global index (reversed list maps back)',
    fuelSrc.includes('var i = flAll.length - 1 - ri'));
  ok('b: form card has an id and an edit title',
    fuelSrc.includes('id="fu_form_card"') && fuelSrc.includes('✏️ Edit fill-up'));
  ok('b: edit mode says Save changes; a Cancel edit exists',
    fuelSrc.includes('💾 Save changes') && fuelSrc.includes('id="fu_cancel_edit"'));
  ok('b: edit prefill marks fields touched (OCR cannot rewrite them)',
    fuelSrc.includes("setAttribute('data-touched', '1')"));
  const guardAt = fuelSrc.indexOf('fillGuard(litresV, costV)');
  ok('b: save handler runs the guard before any write',
    guardAt > fuelSrc.indexOf("querySelector('#fu_add').onclick") &&
    guardAt < fuelSrc.indexOf('saveFillsVerified(f)', guardAt));
  ok('b: edit save goes through applyFillEdit + saveFillsVerified',
    fuelSrc.includes('applyFillEdit(f[editFillIdx], formVals)'));
  ok('b: a blocked save shows the error in the form (fu_err), no dialog',
    fuelSrc.includes('id="fu_err"') && !fuelSrc.includes('alert(') && !fuelSrc.includes('confirm('));
  ok('b: tapping a row scrolls the form into view',
    fuelSrc.includes("card.scrollIntoView({ block: 'start' })"));
}

/* ================================================================
 * C. REVENUE — day opening + entry/extra editing, verified
 * ================================================================ */
console.log('C. revenue open/edit');
{
  /* the day-detail suite's own extractors, verbatim */
  function revHelpers(src) {
    const start = src.indexOf('var S = function');
    const end = src.lastIndexOf('/*', src.indexOf('v38 (B2): paste-import'));
    if (start === -1 || end === -1 || end <= start) throw new Error('revenue helper slice not found');
    return src.slice(start, end);
  }
  function revRegion(src) {
    const a = src.lastIndexOf('/*', src.indexOf('DAY-DETAIL-BEGIN'));
    const b = src.indexOf('*/', src.indexOf('DAY-DETAIL-END'));
    if (a === -1 || b === -1 || b <= a) throw new Error('DAY-DETAIL markers not found');
    return src.slice(a, b + 2);
  }
  const store = makeStore();
  store.set('rev_entries', [
    { date: '2026-10-01', type: 'hourly', hours: 9.5, amount: '275.50', miles: 210, note: 'sheet' },
    { date: '2026-10-01', type: 'load', loads: 4, amount: '480.00' },
    { date: '2026-10-02', type: 'hourly', hours: 10, amount: '290.00', auto: true }
  ]);
  store.set('rev_extras', [
    { date: '2026-10-01', type: 'bonus', amount: '50.00', note: 'early' }
  ]);
  store.set('onboarding', { payStandard: 'hourly', payRate: 29 });
  const sb = {
    App: {
      _store: store,
      _esc: function (s) {
        return String(s === null || s === undefined ? '' : s)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      },
      _today: function () { return '2026-10-14'; }
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(revHelpers(revSrc) + '\n' + revRegion(revSrc) +
    '\nthis.__h = { dayDetailData: dayDetailData, applyEntryEdit: applyEntryEdit,' +
    ' applyExtraEdit: applyExtraEdit, saveEntriesVerified: saveEntriesVerified,' +
    ' saveExtrasVerified: saveExtrasVerified, entries: entries, extras: extras };', sb);
  const H = sb.__h;

  /* applyEntryEdit — pure, preserves, clears ghosts */
  const orig = { date: '2026-10-01', type: 'hourly', hours: 9.5, amount: '275.50', miles: 210, note: 'sheet', auto: true };
  const ed = H.applyEntryEdit(orig, {
    type: 'hourly', amount: '304.50', loads: '', hours: '10.5', miles: '', tons: '', trips: '', note: 'corrected'
  });
  eq('c: edit writes the new amount as a 2dp string', ed.amount, '304.50');
  eq('c: edit writes the new hours', ed.hours, 10.5);
  ok('c: a blanked quantity is REMOVED (no ghost miles)', !Object.prototype.hasOwnProperty.call(ed, 'miles'));
  eq('c: the original date survives', ed.date, '2026-10-01');
  eq('c: fields the form does not own survive (auto)', ed.auto, true);
  eq('c: loads defaults to 1 when blank', ed.loads, 1);
  eq('c: the original record object is not mutated', orig.amount, '275.50');

  const xed = H.applyExtraEdit(
    { date: '2026-10-01', type: 'bonus', amount: '50.00', note: 'early' },
    { type: 'detention', amount: '75', note: 'waited' });
  eq('c: extra edit retypes', xed.type, 'detention');
  eq('c: extra edit re-amounts (2dp string)', xed.amount, '75.00');
  eq('c: extra edit keeps its date', xed.date, '2026-10-01');

  /* verified saves drive the day detail itself */
  const list = H.entries();
  list[0] = H.applyEntryEdit(list[0], {
    type: 'hourly', amount: '304.50', loads: '1', hours: '10.5', miles: '', tons: '', trips: '', note: 'sheet'
  });
  eq('c: verified entry save reports success', H.saveEntriesVerified(list), true);
  const d1 = H.dayDetailData('2026-10-01');
  eq('c: the day detail shows the EDITED entry amount', d1.entries[0].amount, 304.50);
  eq('c: the day total follows the edit', d1.amount, 304.50 + 480 + 50);

  /* failure path: the attempted list must DIFFER from the stored
     one — a read-back cannot (and need not) distinguish a dropped
     write of identical bytes; every real edit changes content. */
  const before = JSON.stringify(store.get('rev_entries', null));
  const attempt = JSON.parse(before);
  attempt[1] = H.applyEntryEdit(attempt[1], {
    type: 'load', amount: '500.00', loads: '4', hours: '', miles: '', tons: '', trips: '', note: ''
  });
  store._fail = true;
  eq('c: a silently-failed entry save is CAUGHT', H.saveEntriesVerified(attempt), false);
  eq('c: ...and the stored entries are untouched', JSON.stringify(store.get('rev_entries', null)), before);
  store._fail = false;

  const xl = H.extras();
  xl[0] = H.applyExtraEdit(xl[0], { type: 'bonus', amount: '60', note: 'early' });
  eq('c: verified extra save reports success', H.saveExtrasVerified(xl), true);
  eq('c: the day extras total follows', H.dayDetailData('2026-10-01').extrasAmt, 60);
  const xAttempt = JSON.parse(JSON.stringify(store.get('rev_extras', null)));
  xAttempt[0] = H.applyExtraEdit(xAttempt[0], { type: 'bonus', amount: '61', note: 'early' });
  store._fail = true;
  eq('c: a silently-failed extra save is CAUGHT', H.saveExtrasVerified(xAttempt), false);
  store._fail = false;

  /* statics — opening + wiring */
  ok('c: chart stashes its bucket dates', revSrc.includes('cv._dayDates = dates'));
  /* v116 supersedes the v75 single-tap: the chart is TWO-TAP now
     (owner's restored pattern) — a tap routes through graphTap;
     only a second tap on the selected day sets dayDetailDate from
     the tap (gt.open). The state machine itself is pinned in
     money-truth-test. */
  ok('c: chart canvas tap routes through the two-tap decision',
    revSrc.includes('chartEl.onclick') && revSrc.includes('graphTap(graphSel, dates[i])') &&
    revSrc.includes('dayDetailDate = gt.open'));
  ok('c: chart card teaches the two-tap', revSrc.includes('Tap a bar to preview the day'));
  ok('c: main Entries rows open their day (data-day-link)',
    (revSrc.match(/data-day-link/g) || []).length >= 2);
  ok('c: day-link taps never fire from the row Delete button',
    revSrc.includes("closest('[data-rvdel],[data-rxdel]')"));
  ok('c: day detail renders Edit buttons for entries AND extras',
    revSrc.includes('data-rvedit="') && revSrc.includes('data-rxedit="'));
  ok('c: the editor has one primary Save changes',
    revSrc.includes('id="rv_ed_save"') && revSrc.includes('💾 Save changes'));
  ok('c: editor cancels quietly', revSrc.includes('id="rv_ed_cancel"'));
  ok('c: day-detail saves go through the verified savers',
    revSrc.includes('l[dayEdit.index] = applyEntryEdit') &&
    revSrc.includes('xl[dayEdit.index] = applyExtraEdit'));
  ok('c: day-detail deletes are verified too',
    revSrc.includes('if (!saveEntriesVerified(l))') && revSrc.includes('if (!saveExtrasVerified(l))'));
  ok('c: a failed save keeps the typed edit (dayEditDraft prefill)',
    revSrc.includes('dayEditDraft') && revSrc.includes('Your edit is still in the form'));
  ok('c: while an edit is open, other rows lose Delete (indexes cannot shift)',
    revSrc.includes("(dayEdit ? '' : '<button class=\"btn small ghost\" data-rvdel="));
  ok('c: the row being edited says so at the tap point',
    revSrc.includes('editing this one — the form is at the top of this page'));
}

/* ================================================================
 * D. DISPATCH — the edit form comes to the user
 * ================================================================ */
console.log('D. dispatch edit scroll');
{
  const d0 = dspSrc.indexOf('/* DSP-SCROLL-BEGIN');
  const d1 = dspSrc.indexOf('/* DSP-SCROLL-END */');
  ok('d: DSP-SCROLL region markers present', d0 >= 0 && d1 > d0);
  const slice = dspSrc.slice(d0, dspSrc.indexOf('\n', d1) + 1);

  const timers = [];
  const sb = {
    setTimeout: function (fn) { timers.push(fn); return timers.length; },
    window: { requestAnimationFrame: function (fn) { fn(); } }
  };
  vm.createContext(sb);
  vm.runInContext(slice + '\nthis.__f = dspScrollToForm;', sb);

  let scrolls = 0;
  const card = { scrollIntoView: function () { scrolls++; } };
  const askedFor = [];
  const body = {
    querySelector: function (sel) { askedFor.push(sel); return sel === '#dp_form_card' ? card : null; }
  };
  sb.__f(body);
  eq('d: scrolls immediately + next frame (2 before timers)', scrolls, 2);
  timers.forEach(function (fn) { fn(); });
  eq('d: ...and once more after late layout settles', scrolls, 3);
  eq('d: the target is the FORM CARD first', askedFor[0], '#dp_form_card');

  /* fallback: no form card (older paint) → the site input */
  let fbScrolls = 0;
  const body2 = {
    querySelector: function (sel) { return sel === '#dp_site' ? { scrollIntoView: function () { fbScrolls++; } } : null; }
  };
  sb.__f(body2);
  ok('d: falls back to #dp_site when the card is missing', fbScrolls >= 1);
  /* never throws on a bare element */
  let threw = false;
  try { sb.__f({ querySelector: function () { return {}; } }); } catch (e) { threw = true; }
  eq('d: an element without scrollIntoView cannot break it', threw, false);

  /* statics — startEdit + the tap-point marker */
  const seStart = dspSrc.indexOf('function startEdit');
  const seEnd = dspSrc.indexOf('\n      function ', seStart + 20);
  const se = dspSrc.slice(seStart, seEnd === -1 ? seStart + 3000 : seEnd);
  ok('d: startEdit scrolls via dspScrollToForm', se.includes('dspScrollToForm(body)'));
  ok('d: the old one-shot scroll is gone from startEdit', !se.includes('siteEl.scrollIntoView'));
  ok('d: the form card carries the scroll target id', dspSrc.includes('<div class="card" id="dp_form_card">'));
  ok('d: the History item being edited is marked at the tap point',
    dspSrc.includes('editing this one — the form is at the top of this page') &&
    dspSrc.includes('✏️ Editing ↑'));
  ok('d: marker keys off the render editingId', dspSrc.includes('var isEditing = !!(editingId && d.id === editingId)'));
}

console.log('');
console.log('records-open test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
