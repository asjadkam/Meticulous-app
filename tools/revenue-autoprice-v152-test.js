#!/usr/bin/env node
/* Meticulous v152 — EDIT ENTRY AUTO-PRICE suite.
 *
 * Owner evidence (Oct 17, 2026 22:12 MDT, over his own Revenue
 * screenshot of the Oct 17 day): "Why is this edit asking me for
 * amount it should know by it self." The Day Details Edit entry
 * form rendered Amount as a FREE typed field even for an HOURLY
 * entry — he had to type his own pay ($203.35 -> the figure he
 * wanted) to correct a day, the exact data entry this app exists
 * to remove. And because payFor's rule is "an explicit amount
 * over 0 wins", a stale typed amount kept pricing the day after
 * the hours were fixed.
 *
 * v152: for an HOURLY entry the amount IS hours x the driver's
 * own wage rate — the chain the books already trust,
 * ownRate(onboarding) = ownWageRate || payRate (the same rate
 * payCtx/payFor price with). The form renders it computed and
 * read-only, it follows Hours edits live, and saving stores the
 * consistent pair. ONE deliberate door remains: "Type a different
 * amount" unlocks typing for THIS edit only. Non-hourly types
 * keep the typed Amount exactly as before; with no wage rate on
 * file the form cannot know the figure and keeps today's typed
 * field too.
 *
 * Behavioral tests against the REAL shipped code: the module's
 * own helper slice + the contiguous bindTwoTapDelete..renderDayDetail
 * slice + the day-detail state vars, extracted verbatim from
 * modules/revenue.js (the day-detail / revenue-grouped harness
 * pattern), driven over a stub DOM (the dispatch FakeEl pattern).
 * The invoice INV-CYCLE region publishes the shared builder the
 * day totals price through.
 *  (a) an hourly edit renders Amount = hours x rate, read-only
 *  (b) the amount follows Hours edits live (and never goes negative)
 *  (c) saving stores the consistent pair — the save-time recompute
 *      beats a stale amount field, hours say 10 AND dollars say 290
 *  (d) the override door needs its deliberate tap, preserves what
 *      was already typed, then stores the typed figure for THIS
 *      entry only (the next day's hourly edit still auto-prices)
 *  (e) a non-hourly edit keeps the typed Amount; an extra's edit
 *      is untouched; switching the Type away from hourly unlocks
 *  (f) no wage rate on file: the hourly amount stays a typed
 *      field prefilled with the stored figure (today's behaviour)
 * Run: node tools/revenue-autoprice-v152-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const revSrc = fs.readFileSync(path.join(ROOT, 'modules', 'revenue.js'), 'utf8');
const invSrc = fs.readFileSync(path.join(ROOT, 'modules', 'invoice.js'), 'utf8');
const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* ---------------- verbatim slices of the REAL module ---------------- */
function extractCommentRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('region not found: ' + beginMark);
  return src.slice(a, b + 2);
}
function revHelpers() {
  const start = revSrc.indexOf('var S = function');
  const end = revSrc.lastIndexOf('/*', revSrc.indexOf('v38 (B2): paste-import'));
  if (start === -1 || end === -1 || end <= start) throw new Error('revenue helper slice not found');
  return revSrc.slice(start, end);
}
function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('fn not found: ' + name);
  let depth = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('fn unterminated: ' + name);
}
function dayDetailSlice() {
  /* bindTwoTapDelete .. end of renderDayDetail — one contiguous
     span carrying the DAY-DETAIL region, fmtClockTime and the
     whole edit form + its wiring. */
  const start = revSrc.indexOf('function bindTwoTapDelete(');
  if (start === -1) throw new Error('day-detail slice start not found');
  const fn = extractFn(revSrc, 'renderDayDetail');
  const end = revSrc.indexOf(fn) + fn.length;
  return revSrc.slice(start, end);
}
function stateSlice() {
  const a = revSrc.indexOf('var dayDetailDate = null');
  const mark = 'var lastBody = null;';
  const b = revSrc.indexOf(mark);
  if (a === -1 || b === -1 || b <= a) throw new Error('state slice not found');
  return revSrc.slice(a, b + mark.length);
}

/* ---------------- fake DOM (dispatch harness pattern) ---------------- */
function FakeEl(sel) {
  this._sel = sel || '';
  this._kids = {};
  this._html = '';
  this.value = '';
  this.textContent = '';
  this.style = {};
  this.onclick = null;
  this.oninput = null;
  this.onchange = null;
  this._listeners = {};
}
Object.defineProperty(FakeEl.prototype, 'innerHTML', {
  get: function () { return this._html; },
  set: function (v) { this._html = String(v); this._kids = {}; }
});
FakeEl.prototype.querySelector = function (sel) {
  return this._kids[sel] || (this._kids[sel] = new FakeEl(sel));
};
FakeEl.prototype.querySelectorAll = function () { return []; };
FakeEl.prototype.addEventListener = function (type, fn) {
  (this._listeners[type] = this._listeners[type] || []).push(fn);
};
FakeEl.prototype.click = function () { if (this.onclick) this.onclick({ target: this }); };
FakeEl.prototype.scrollIntoView = function () {};
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };

function makeBody() {
  const body = new FakeEl('body');
  body._btnCache = {};
  /* A real DOM seeds a field's .value from the markup the render
     just painted (the value attribute / the selected option).
     Mirror that: the first time a #id field is queried after a
     render, seed its value from the current HTML. */
  const rawQS = body.querySelector.bind(body);
  body.querySelector = function (sel) {
    const el = rawQS(sel);
    if (!el._seeded && sel.charAt(0) === '#') {
      el._seeded = true;
      const id = sel.slice(1);
      const tagM = new RegExp('<(?:input|select) id="' + id + '"[^>]*>').exec(body._html);
      if (tagM) {
        if (/^<select/.test(tagM[0])) {
          const selM = new RegExp('<select id="' + id + '"[^>]*>([\\s\\S]*?)</select>').exec(body._html);
          const optM = selM && /<option value="([^"]*)" selected>/.exec(selM[1]);
          el.value = optM ? optM[1] : '';
        } else {
          const vM = /value="([^"]*)"/.exec(tagM[0]);
          el.value = vM ? vM[1] : '';
        }
      }
    }
    return el;
  };
  body.querySelectorAll = function (sel) {
    const m = /^\[(data-[a-z]+)\]$/.exec(sel);
    if (!m) return [];
    const attr = m[1];
    const c = body._btnCache[attr];
    if (c && c.html === body._html) return c.btns;
    const out = [];
    const re = new RegExp(attr + '="([^"]*)"', 'g');
    let mm;
    while ((mm = re.exec(body._html))) {
      const v = mm[1];
      out.push({ onclick: null, textContent: '', style: {},
        getAttribute: function (n) { return n === attr ? v : (this._attrs ? this._attrs[n] : null); },
        setAttribute: function (n, val) { (this._attrs = this._attrs || {})[n] = val; },
        removeAttribute: function () {},
        click: function () { if (this.onclick) this.onclick(); } });
    }
    body._btnCache[attr] = { html: body._html, btns: out };
    return out;
  };
  return body;
}

/* ---------------- world ---------------- */
const DAY = '2026-10-17', DAY2 = '2026-10-16';
function makeWorld(onboarding, entries, extras) {
  const mem = {
    onboarding: onboarding,
    rev_entries: JSON.parse(JSON.stringify(entries)),
    rev_extras: JSON.parse(JSON.stringify(extras || [])),
    sessions: [], fuel_fills: [], dsp_list: []
  };
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); },
    del: function (k) { delete mem[k]; }
  };
  const sandbox = {
    console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
    document: { body: { contains: function () { return false; } } },
    App: {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s); },
      _today: function () { return DAY; },
      _odoDailyKm: null, tracker: null
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractCommentRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sandbox);
  vm.runInContext('var Meticulous = window.Meticulous;', sandbox);
  vm.runInContext(revHelpers(), sandbox);
  vm.runInContext(dayDetailSlice(), sandbox);
  vm.runInContext(stateSlice(), sandbox);
  vm.runInContext(
    'var api = { render: function (body) { renderDayDetail(body); } };' +
    'this.__x = {' +
    '  openDay: function (ds) { dayDetailDate = ds; dayEdit = null; dayEditErr = ""; dayErr = ""; dayEditDraft = null; dayEditAmtCustom = false; },' +
    '  state: function () { return { editing: !!dayEdit, custom: !!dayEditAmtCustom, err: dayEditErr }; },' +
    '  stored: function () { return App._store.get("rev_entries", []); },' +
    '  payFor: payFor, dayDetailData: dayDetailData };', sandbox);
  return { x: sandbox.__x, sb: sandbox, mem: mem };
}

function tagOf(html, id) {
  const m = new RegExp('<input id="' + id + '"[^>]*>').exec(html);
  return m ? m[0] : '';
}
function valOf(tag) {
  const m = /value="([^"]*)"/.exec(tag);
  return m ? m[1] : null;
}
function clickEdit(body, attr, idx) {
  const btns = body.querySelectorAll('[' + attr + ']');
  for (const b of btns) { if (b.getAttribute(attr) === String(idx)) { b.click(); return true; } }
  return false;
}

/* The owner's real Oct 17 record: 7.01 tracker hours whose stored
   amount ($203.35) was priced off the unrounded session — alone
   on its day (so it is the day's money entry, not evidence),
   beside it an extra; the day before is a plain hourly entry,
   the day before that a miles entry. Wage rate $29 (payRate). */
const DAY3 = '2026-10-15';
const ENTRIES = [
  { date: DAY, type: 'hourly', hours: 7.01, amount: '203.35', loads: 1, note: 'Auto from tracker', auto: true },
  { date: DAY2, type: 'hourly', hours: 5, amount: '145.00', loads: 1, note: 'yard day' },
  { date: DAY3, type: 'miles', miles: 120, amount: '250.00', loads: 1, note: 'miles run' }
];
const EXTRAS = [{ date: DAY, type: 'bonus', amount: '25.00', note: 'wash bonus' }];

console.log('\n— v152 auto-price: hourly edit (rate $29 on file) —');
{
  const w = makeWorld({ payStandard: 'Hourly', payRate: 29 }, ENTRIES, EXTRAS);
  const body = makeBody();
  w.x.openDay(DAY);
  w.sb.api.render(body);

  /* (a) render: computed + read-only */
  ok('edit opens from the entry row', clickEdit(body, 'data-rvedit', 0));
  let html = body._html;
  let amtTag = tagOf(html, 'rv_ed_amt');
  ok('(a) hourly Amount renders read-only (not a free type-in)', /readonly/.test(amtTag), amtTag);
  eq('(a) hourly Amount renders hours x rate (7.01 x $29)', valOf(amtTag), '203.29');
  ok('(a) the label names the math (hours x $29.00/hr)', html.indexOf('hours × $29.00/hr') !== -1);
  ok('(a) the deliberate override door is offered', html.indexOf('id="rv_ed_amt_unlock"') !== -1);

  /* (b) live follow */
  const hrs = body.querySelector('#rv_ed_hours');
  const amt = body.querySelector('#rv_ed_amt');
  hrs.value = '10';
  if (hrs.oninput) hrs.oninput({ target: hrs });
  eq('(b) Amount follows Hours edits live (10 x $29)', amt.value, '290.00');
  hrs.value = '';
  if (hrs.oninput) hrs.oninput({ target: hrs });
  eq('(b) blank hours price $0.00, never negative', amt.value, '0.00');

  /* (c) save stores the consistent pair — the field is left STALE
     on purpose (no live event): the save itself must recompute */
  hrs.value = '10';
  amt.value = '203.35';
  body.querySelector('#rv_ed_type').value = 'hourly';
  body.querySelector('#rv_ed_save').click();
  let stored = w.x.stored();
  eq('(c) saved hours are the edited 10', stored[0].hours, 10);
  eq('(c) saved amount is the computed $290.00, not the stale field', stored[0].amount, '290.00');
  eq('(c) the books price the saved pair at $290', w.x.payFor(stored[0], 'hourly', 29), 290);
  eq('(c) the edit closed after the save', w.x.state().editing, false);

  /* (d) override: deliberate tap, typed work preserved, this entry only */
  w.x.openDay(DAY); w.sb.api.render(body);
  ok('(d) edit reopens for the override walk', clickEdit(body, 'data-rvedit', 0));
  const hrs2 = body.querySelector('#rv_ed_hours');
  const amt2 = body.querySelector('#rv_ed_amt');
  hrs2.value = '9';
  if (hrs2.oninput) hrs2.oninput({ target: hrs2 });
  eq('(d) before the unlock the amount still follows hours (9 x $29)', amt2.value, '261.00');
  amt2.value = '261.00'; /* the real field holds what the render showed */
  body.querySelector('#rv_ed_amt_unlock').click();
  html = body._html;
  ok('(d) after the unlock the amount is typeable', !/readonly/.test(tagOf(html, 'rv_ed_amt')), tagOf(html, 'rv_ed_amt'));
  eq('(d) the unlock starts from the computed figure', valOf(tagOf(html, 'rv_ed_amt')), '261.00');
  eq('(d) hours typed before the unlock survive it', valOf(tagOf(html, 'rv_ed_hours')), '9');
  body.querySelector('#rv_ed_amt').value = '275.50';
  body.querySelector('#rv_ed_type').value = 'hourly';
  body.querySelector('#rv_ed_save').click();
  stored = w.x.stored();
  eq('(d) the override saves the typed figure', stored[0].amount, '275.50');
  eq('(d) the override keeps the edited hours', stored[0].hours, 9);

  w.x.openDay(DAY2); w.sb.api.render(body);
  ok('(d) the next day edit opens', clickEdit(body, 'data-rvedit', 1));
  const amt3 = tagOf(body._html, 'rv_ed_amt');
  ok('(d) the override did NOT leak: the other day still auto-prices', /readonly/.test(amt3), amt3);
  eq('(d) the other day computes from its own hours (5 x $29)', valOf(amt3), '145.00');

  /* (e) type switch unlocks; non-hourly + extra stay typed */
  const typeSel = body.querySelector('#rv_ed_type');
  typeSel.value = 'load';
  if (typeSel.onchange) typeSel.onchange({ target: typeSel });
  ok('(e) switching Type away from hourly unlocks the amount', !/readonly/.test(tagOf(body._html, 'rv_ed_amt')), tagOf(body._html, 'rv_ed_amt'));

  w.x.openDay(DAY3); w.sb.api.render(body);
  ok('(e) the miles edit opens', clickEdit(body, 'data-rvedit', 2));
  const mTag = tagOf(body._html, 'rv_ed_amt');
  ok('(e) a non-hourly Amount is a typed field (no readonly)', !/readonly/.test(mTag), mTag);
  eq('(e) a non-hourly Amount is the stored figure', valOf(mTag), '250.00');
  body.querySelector('#rv_ed_amt').value = '260.00';
  body.querySelector('#rv_ed_type').value = 'miles';
  body.querySelector('#rv_ed_save').click();
  stored = w.x.stored();
  eq('(e) the non-hourly save stores the typed amount', stored[2].amount, '260.00');
  eq('(e) the non-hourly save keeps its miles', stored[2].miles, 120);

  w.x.openDay(DAY); w.sb.api.render(body);
  ok('(e) the extra edit opens', clickEdit(body, 'data-rxedit', 0));
  const xTag = tagOf(body._html, 'rv_ed_xamt');
  ok('(e) an extra Amount stays a typed field', xTag !== '' && !/readonly/.test(xTag), xTag);
  eq('(e) an extra Amount is its stored figure', valOf(xTag), '25.00');
}

console.log('\n— v152 auto-price: no wage rate on file —');
{
  const w = makeWorld({ payStandard: 'Hourly' }, ENTRIES, EXTRAS);
  const body = makeBody();
  w.x.openDay(DAY);
  w.sb.api.render(body);
  ok('edit opens with no rate on file', clickEdit(body, 'data-rvedit', 0));
  const amtTag = tagOf(body._html, 'rv_ed_amt');
  ok('(f) no rate: the hourly Amount stays typeable', !/readonly/.test(amtTag), amtTag);
  eq('(f) no rate: the Amount is the stored figure', valOf(amtTag), '203.35');
  ok('(f) no rate: no override door is needed or shown', body._html.indexOf('id="rv_ed_amt_unlock"') === -1);
}

console.log('\n— v152 ship pins —');
/* v154 pin move (the standing convention): 153 -> 154.
   v155 pin move: 154 -> 155, same convention. */
eq('ships as webVersion 188', ver.webVersion, 237);
ok('index loads revenue at the 199 pin', idxSrc.indexOf('modules/revenue.js?v=237') !== -1);

console.log('\nrevenue-autoprice-v152-test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
