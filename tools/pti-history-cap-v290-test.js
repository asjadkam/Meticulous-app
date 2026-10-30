#!/usr/bin/env node
/* Meticulous v290 — PTI-HISTORY-LONG-LIST (owner, Oct 30, 2026
 * 17:25 MDT, screen recording): after filing today's post-trip
 * he scrolled the PTI module's "Past inspections" list and it
 * ran on and on — the renderer painted the newest 30 filed
 * inspections as one unbroken scroll. His words: "I understand
 * the many things on the pti that has to be checked but why the
 * long list of history!" A direct hit on the NO-LONG-LISTS
 * baked-in law (Oct 30, 09:11 MDT): no endless lists anywhere;
 * lists are capped and deduplicated.
 *
 * The fix follows the house pattern (Fuel Fill-ups v177 D6,
 * Revenue Entries — newest few + a deliberate "Show more"
 * expansion): the Past inspections card shows the newest 3 by
 * default, older inspections sit behind a "Show more — N more
 * inspections" button, "Show less" folds it back. Doubled
 * entries (same id, or an exact factual clone — same date,
 * kind, filed second and odometer under a second id) render
 * once. The checklist, Sign & file, DOT Inspection Mode,
 * "View the latest report" and the 14-day warning are
 * untouched; today's filed inspections stay at the top.
 *
 * This harness drives the REAL modules/pti.js render into a
 * fake body with a 44-record fixture (his real Oct 30 /
 * Oct 29 / Oct 28 filings at the head, generated days behind),
 * plus a same-id duplicate and an exact factual clone.
 * Run: node tools/pti-history-cap-v290-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const ptiSrc = read('modules/pti.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) { ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }

function makeStore(seed) {
  const data = Object.assign({}, seed || {});
  return {
    get(k, d) { return (k in data) ? data[k] : d; },
    set(k, v) { data[k] = v; },
    _data: data
  };
}
function makeBody() {
  const stubs = {};
  function stub(sel) {
    if (!stubs[sel]) {
      stubs[sel] = {
        value: '', textContent: '', innerHTML: '', style: {}, onclick: null,
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        addEventListener() {}, removeEventListener() {},
        setAttribute() {}, getAttribute() { return null; },
        scrollIntoView() {}, focus() {}
      };
    }
    return stubs[sel];
  }
  return {
    innerHTML: '',
    _stubs: stubs,
    querySelector(sel) { return stub(sel); },
    querySelectorAll() { return []; }
  };
}
function loadPti(store) {
  const sb = {
    console, Meticulous: { modules: {} }, window: {},
    App: {
      _store: store,
      _esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      _today: () => '2026-10-30'
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(ptiSrc, sb);
  return sb.Meticulous.modules.pti;
}
function rep(id, date, kind, time, odo) {
  return {
    id: id, date: date, kind: kind,
    filedAt: Date.parse(date + 'T' + time),
    unit: '07', odometer: odo, signed: true, defects: [], result: 'pass',
    carrier: 'Ai Trucking', driverName: 'Asjad Kamal'
  };
}
function fixture() {
  const out = [
    rep('r1030post', '2026-10-30', 'post', '17:23:31', 170749),
    rep('r1030pre', '2026-10-30', 'pre', '07:21:02', 170664),
    rep('r1029pre', '2026-10-29', 'pre', '07:08:25', 170337),
    rep('r1028post', '2026-10-28', 'post', '12:14:18', 170337),
    rep('r1028pre', '2026-10-28', 'pre', '06:44:50', 170262),
    rep('r1026post', '2026-10-26', 'post', '18:26:54', 170261)
  ];
  /* generated days behind: Oct 25 down, pre+post each, to 42 */
  let odo = 170200, day = 25;
  while (out.length < 42 && day > 1) {
    const ds = '2026-10-' + ('0' + day).slice(-2);
    out.push(rep('g' + ds + 'post', ds, 'post', '17:30:00', odo));
    out.push(rep('g' + ds + 'pre', ds, 'pre', '07:00:00', odo - 60));
    odo -= 190; day -= 1;
  }
  /* the doubles: the same record under the same id twice, and
     an exact factual clone of the Oct 29 pre-trip under a
     second id (same date, kind, filed second, odometer) */
  out.push(rep('r1029pre', '2026-10-29', 'pre', '07:08:25', 170337));
  out.push(rep('r1029clone', '2026-10-29', 'pre', '07:08:25', 170337));
  return out;
}
function historySlice(html) {
  const i = html.indexOf('Past inspections');
  return i === -1 ? '' : html.slice(i);
}
function rowCount(html) {
  return (historySlice(html).match(/data-pti-open=/g) || []).length;
}

/* ---------- A: the capped default ---------- */
{
  const fx = fixture();
  const store = makeStore({ onboarding: { firstName: 'Asjad', lastName: 'Kamal' }, pti_reports: fx });
  const PTI = loadPti(store);
  const body = makeBody();
  PTI.render(body);
  const html = body.innerHTML;
  const slice = historySlice(html);

  ok('A1 Past inspections card renders', slice.length > 0);
  eq('A2 default render is capped at the newest 3 rows', rowCount(html), 3);
  ok('A3 today\'s post-trip (odo 170,749) is the first history row',
    slice.indexOf('170,749') !== -1 && slice.indexOf('170,749') < slice.indexOf('170,664'));
  ok('A4 today\'s pre-trip (odo 170,664) is the second history row', slice.indexOf('170,664') !== -1);
  ok('A5 the newest-30 wall is gone (no 4th row before the toggle)',
    slice.indexOf('data-pti-open="r1028post"') === -1);
  const more = body._stubs['#pti_hist_more'];
  ok('A6 a Show more toggle is wired', !!(more && typeof more.onclick === 'function'));
  ok('A7 the toggle names how many more inspections sit behind it',
    /Show more — \d+ more inspection/.test(html));
  /* 44 fixture records − 2 doubles = 42 unique; 42 − 3 shown = 39 behind */
  const mLabel = html.match(/Show more — [^<]*/);
  ok('A8 the count behind the toggle is the deduped count (39 more)',
    html.indexOf('Show more — 39 more inspections') !== -1,
    mLabel ? mLabel[0] : 'no Show more label found');
  ok('A9 the old "Showing the newest 30" note is gone', html.indexOf('Showing the newest 30') === -1);

  /* ---------- B: the deliberate expansion ---------- */
  if (more && typeof more.onclick === 'function') {
    more.onclick();
    const html2 = body.innerHTML;
    eq('B1 expanded render shows every unique inspection once', rowCount(html2), 42);
    eq('B2 the same-id double renders exactly once',
      (html2.match(/data-pti-open="r1029pre"/g) || []).length, 1);
    ok('B3 the factual clone renders no second row',
      html2.indexOf('data-pti-open="r1029clone"') === -1);
    ok('B4 expanded toggle reads Show less', html2.indexOf('Show less') !== -1);
    const less = body._stubs['#pti_hist_more'];
    ok('B5 the expanded toggle is wired', !!(less && typeof less.onclick === 'function'));
    if (less && typeof less.onclick === 'function') {
      less.onclick();
      eq('B6 Show less folds the list back to the newest 3', rowCount(body.innerHTML), 3);
    }
  } else {
    ok('B1-B6 expansion checks (toggle missing — skipped as failures)', false);
  }
}

/* ---------- C: small and empty books stay whole ---------- */
{
  const store = makeStore({
    onboarding: { firstName: 'Asjad', lastName: 'Kamal' },
    pti_reports: [rep('x1', '2026-10-30', 'post', '17:23:31', 170749), rep('x2', '2026-10-30', 'pre', '07:21:02', 170664)]
  });
  const PTI = loadPti(store);
  const body = makeBody();
  PTI.render(body);
  eq('C1 a 2-inspection book renders both rows', rowCount(body.innerHTML), 2);
  ok('C2 no toggle is offered when nothing sits behind it', body.innerHTML.indexOf('pti_hist_more') === -1);
}
{
  const store = makeStore({ onboarding: { firstName: 'Asjad', lastName: 'Kamal' }, pti_reports: [] });
  const PTI = loadPti(store);
  const body = makeBody();
  PTI.render(body);
  ok('C3 an empty book still says so', body.innerHTML.indexOf('No inspections filed yet.') !== -1);
}

/* ---------- D: the surfaces the item must NOT touch ---------- */
{
  const store = makeStore({ onboarding: { firstName: 'Asjad', lastName: 'Kamal' }, pti_reports: fixture() });
  const PTI = loadPti(store);
  const body = makeBody();
  PTI.render(body);
  const html = body.innerHTML;
  ok('D1 the Schedule 1 checklist still renders all 23 items',
    (html.match(/data-pti-ok=/g) || []).length >= 23 || html.indexOf('of 23 checked') !== -1);
  ok('D2 Sign & file is intact', html.indexOf('Sign &amp; file inspection') !== -1);
  ok('D3 DOT Inspection Mode card is intact', html.indexOf('DOT Inspection Mode') !== -1);
  ok('D4 View the latest report is intact', html.indexOf('View the latest report') !== -1);
  ok('D5 the 14-day warning still computes', html.indexOf('in the last 14 had no pre-trip inspection on file') !== -1);
}

/* ---------- E: the ship pins ---------- */
eq('E1 index.html pins modules/pti.js at the live web version',
  (idxSrc.match(/modules\/pti\.js\?v=(\d+)/) || [])[1], String(ver.webVersion));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
