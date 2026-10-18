#!/usr/bin/env node
/* Meticulous v160 — ENTRY ORIGIN TRUTH suite.
 *
 * Owner evidence (Oct 17, 2026, evening — his own repair of the
 * Oct 17 day): he hand-edited the tracker-created Revenue entry
 * (changed its hours through the Day Details edit door), and after
 * his save the entry still wore the origin label "Auto from
 * tracker" — "9h · Auto from tracker · auto" — as if the tracker
 * had produced those numbers untouched. A hand-corrected entry
 * must not keep claiming it is purely the tracker's.
 *
 * v160, the smallest truthful change:
 *  - applyEntryEdit stamps `handEdited: true` on the saved record
 *    when the ORIGINAL was auto-created (orig.auto) AND the edit
 *    changed its numbers: the type, any quantity (hours / miles /
 *    tons / trips / loads), or the amount — EXCEPT an amount change
 *    the edit door itself produced by auto-pricing unchanged hours
 *    (the v152 recompute: the door's math, not the man's hand; the
 *    save handler passes that fact in). A save that changes nothing
 *    stamps nothing.
 *  - The creation facts stay in the record untouched: `auto` and
 *    the note ("Auto from tracker") are NOT rewritten — the source
 *    classifiers that key on them (revenue / invoice / connectpipe)
 *    keep reading the day's provenance exactly as before.
 *  - The PRESENTED origin stops claiming pure-auto: the three
 *    render sites (Day Details entries, Day Details "Also
 *    recorded", the flat Revenue list) print
 *    "auto · edited by hand" for a stamped entry, "auto" exactly
 *    as before for one never hand-edited.
 *
 * Behavioral tests against the REAL shipped code (the v152
 * harness pattern: verbatim helper + day-detail slices of
 * modules/revenue.js over a stub DOM, the REAL edit door driven
 * end to end). The owner's real Oct 17 record is the fixture.
 *  (a) before any edit: the line is the old line, no marker
 *  (b) THE OWNER'S CASE: hours edited through the door -> the
 *      stored record keeps auto + note and gains handEdited; the
 *      re-rendered line says "edited by hand"
 *  (c) a no-op save stamps nothing (incl. the v152 auto-price
 *      artefact: stored 203.35 -> door 203.29 on unchanged hours)
 *  (d) a deliberate typed amount (the unlock door) on unchanged
 *      hours DOES stamp — that change was the man's hand
 *  (e) a note-only edit stamps nothing (his words replace the
 *      note display themselves; the numbers are still the
 *      tracker's)
 *  (f) a hand entry edited in numbers: no marker, never claimed
 *      auto, line unchanged in shape
 *  (g) the marker survives a later no-op save (history is not
 *      un-written)
 *  (h) statics: the three render sites carry the conditional;
 *      the classifiers' keys (auto flag, the note string) are
 *      untouched by the edit path
 * Run: node tools/entry-origin-v160-test.js
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
    '  applyEntryEdit: applyEntryEdit };', sandbox);
  return { x: sandbox.__x, sb: sandbox, mem: mem };
}

function clickEdit(body, idx) {
  const btns = body.querySelectorAll('[data-rvedit]');
  for (const b of btns) { if (b.getAttribute('data-rvedit') === String(idx)) { b.click(); return true; } }
  return false;
}
function entryLine(html, needle) {
  const lines = html.split('<div class="b">');
  for (let i = 1; i < lines.length; i++) {
    const seg = lines[i].split('</div>')[0];
    if (seg.indexOf(needle) !== -1) return seg;
  }
  return null;
}

/* The owner's real Oct 17 record: 7.01 tracker hours whose stored
   amount ($203.35) was priced off the unrounded session, alone on
   its day; beside it a plain hand entry on the day before. */
const ENTRIES = [
  { date: DAY, type: 'hourly', hours: 7.01, amount: '203.35', loads: 1, note: 'Auto from tracker', auto: true },
  { date: DAY2, type: 'hourly', hours: 5, amount: '145.00', loads: 1, note: 'yard day' }
];

console.log('\n— v160 entry origin: the tracker entry, before and after his hand —');
{
  const w = makeWorld({ payStandard: 'Hourly', payRate: 29 }, ENTRIES, []);
  const body = makeBody();
  w.x.openDay(DAY);
  w.sb.api.render(body);

  /* (a) before any edit: the old line, byte for byte, no marker */
  const lineA = entryLine(body._html, 'Auto from tracker');
  eq('(a) the unedited line is the old line', lineA, '7.01h · Auto from tracker · auto');
  ok('(a) no hand-edit marker anywhere pre-edit', body._html.indexOf('edited by hand') === -1);

  /* (b) THE OWNER'S CASE: hours 7.01 -> 9 through the real door */
  ok('(b) edit opens from the entry row', clickEdit(body, 0));
  body.querySelector('#rv_ed_hours').value = '9';
  body.querySelector('#rv_ed_save').click();
  const st = w.x.stored()[0];
  eq('(b) saved hours are the edited 9', st.hours, 9);
  eq('(b) saved amount follows (v152: 9 x $29)', st.amount, '261.00');
  eq('(b) the creation fact stays: auto is still true', st.auto, true);
  eq('(b) the creation fact stays: the note is untouched', st.note, 'Auto from tracker');
  eq('(b) the record is stamped hand-edited', st.handEdited, true);
  const lineB = entryLine(body._html, 'Auto from tracker');
  eq('(b) the presented origin stops claiming pure-auto', lineB, '9h · Auto from tracker · auto · edited by hand');

  /* (g) a later no-op save does not un-write the history */
  ok('(g) edit reopens on the stamped entry', clickEdit(body, 0));
  body.querySelector('#rv_ed_save').click();
  eq('(g) the marker survives a later no-op save', w.x.stored()[0].handEdited, true);
}

console.log('\n— v160 entry origin: saves that must NOT stamp —');
{
  /* (c) no-op save on a fresh tracker entry: nothing the man
     changed -> no stamp, even though the v152 recompute rewrites
     the amount 203.35 -> 203.29 off the UNCHANGED hours (the
     door's own math is not his hand). */
  const w = makeWorld({ payStandard: 'Hourly', payRate: 29 }, ENTRIES, []);
  const body = makeBody();
  w.x.openDay(DAY);
  w.sb.api.render(body);
  ok('(c) edit opens', clickEdit(body, 0));
  body.querySelector('#rv_ed_save').click();
  const st = w.x.stored()[0];
  eq('(c) the door still recomputes the amount (v152 stands)', st.amount, '203.29');
  ok('(c) ...but no hand-edit stamp lands', !('handEdited' in st), JSON.stringify(st));
  const lineC = entryLine(body._html, 'Auto from tracker');
  eq('(c) the line still reads pure tracker', lineC, '7.01h · Auto from tracker · auto');

  /* (e) note-only edit: his words stand as the note; the numbers
     are still the tracker's, so no stamp */
  const w2 = makeWorld({ payStandard: 'Hourly', payRate: 29 }, ENTRIES, []);
  const body2 = makeBody();
  w2.x.openDay(DAY);
  w2.sb.api.render(body2);
  ok('(e) edit opens', clickEdit(body2, 0));
  body2.querySelector('#rv_ed_note').value = 'Bonus hour for truck wash';
  body2.querySelector('#rv_ed_save').click();
  const st2 = w2.x.stored()[0];
  eq('(e) his note is what saved', st2.note, 'Bonus hour for truck wash');
  ok('(e) no hand-edit stamp for a note-only edit', !('handEdited' in st2), JSON.stringify(st2));
}

console.log('\n— v160 entry origin: the deliberate amount door + hand entries —');
{
  /* (d) unlock + type a different amount on UNCHANGED hours:
     that change is the man's hand and must stamp */
  const w = makeWorld({ payStandard: 'Hourly', payRate: 29 }, ENTRIES, []);
  const body = makeBody();
  w.x.openDay(DAY);
  w.sb.api.render(body);
  ok('(d) edit opens', clickEdit(body, 0));
  ok('(d) the unlock door exists', body._html.indexOf('id="rv_ed_amt_unlock"') !== -1);
  body.querySelector('#rv_ed_amt_unlock').click();
  body.querySelector('#rv_ed_amt').value = '250.00';
  body.querySelector('#rv_ed_save').click();
  const st = w.x.stored()[0];
  eq('(d) the typed amount is what saved', st.amount, '250.00');
  eq('(d) hours untouched', st.hours, 7.01);
  eq('(d) a hand-typed amount stamps the record', st.handEdited, true);

  /* (f) a hand entry edited in numbers: never auto, never stamped */
  const w2 = makeWorld({ payStandard: 'Hourly', payRate: 29 }, ENTRIES, []);
  const body2 = makeBody();
  w2.x.openDay(DAY2);
  w2.sb.api.render(body2);
  ok('(f) edit opens on the hand entry', clickEdit(body2, 1));
  body2.querySelector('#rv_ed_hours').value = '6';
  body2.querySelector('#rv_ed_save').click();
  const st2 = w2.x.stored()[1];
  eq('(f) the hand entry saved its new hours', st2.hours, 6);
  ok('(f) no stamp, no auto claim appears', !('handEdited' in st2) && !('auto' in st2), JSON.stringify(st2));
  const lineF = entryLine(body2._html, 'yard day');
  eq('(f) its line keeps its old shape', lineF, '6h · yard day');
}

console.log('\n— v160 entry origin: pure-function + statics —');
{
  /* the pure seam, driven directly (records-open pattern): a
     quantity change stamps; the auto-priced amount artefact does
     not; a typed amount on unchanged quantities does */
  const w = makeWorld({ payStandard: 'Hourly', payRate: 29 }, ENTRIES, []);
  const A = w.x.applyEntryEdit;
  const orig = { date: DAY, type: 'hourly', hours: 7.01, amount: '203.35', loads: 1, note: 'Auto from tracker', auto: true };
  const form = function (o) { return Object.assign({ type: 'hourly', amount: '203.35', loads: '1', hours: '7.01', miles: '', tons: '', trips: '', note: 'Auto from tracker' }, o || {}); };
  eq('pure: quantity change stamps', A(orig, form({ hours: '9', amount: '261.00' }), false).handEdited, true);
  eq('pure: the auto-price artefact alone does not stamp', A(orig, form({ amount: '203.29' }), true).handEdited, undefined);
  eq('pure: a typed amount change stamps', A(orig, form({ amount: '250.00' }), false).handEdited, true);
  eq('pure: an untouched form stamps nothing', A(orig, form({}), true).handEdited, undefined);
  eq('pure: a non-auto original never stamps', A({ date: DAY, type: 'hourly', hours: 5, amount: '145.00', loads: 1, note: 'yard day' }, form({ hours: '6', amount: '174.00' }), false).handEdited, undefined);
  eq('pure: the original object is not mutated', orig.handEdited, undefined);

  /* (h) statics */
  const sites = (revSrc.match(/edited by hand/g) || []).length;
  ok('(h) the marker renders at exactly the three origin sites', sites === 3, 'found ' + sites);
  ok('(h) the save door passes the auto-price fact into the edit', /applyEntryEdit\(l\[dayEdit\.index\], form, [A-Za-z_$]/.test(revSrc));
  ok('(h) the classifiers keys stand: revenue still reads e.auto / the note', revSrc.indexOf("if (n === 'Auto from tracker') return 'tracker';") !== -1);
}

console.log('\nentry-origin-v160 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
