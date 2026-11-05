#!/usr/bin/env node
/* Meticulous v328 — PTI-HISTORY-UNDER-FORM tests.
 *
 * Owner (Nov 5, 2026 ~14:52, over a screenshot of the live PTI
 * screen): "This history should be underneath the inspection
 * form… just like always — 3 under recent history and full list
 * of requested."
 *
 * The PTI screen must open on the FORM. Everything that is
 * history — the "Today's inspection filed" card, the unsigned
 * prompt, and the Past inspections list — sits UNDERNEATH it.
 * The list keeps his standing pattern: newest 3 shown, the
 * full list only behind "Show more".
 *
 * Runs the REAL modules/pti.js in a vm sandbox over an
 * in-memory store with a frozen clock (Thu Nov 5, 2026) and a
 * minimal fake DOM, asserting the painted order.
 * Run: node tools/pti-history-under-form-v328-test.js
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

const RealDate = Date;
const FROZEN_MS = new RealDate(2026, 10, 5, 12, 0, 0).getTime();
function FrozenDate(...args) {
  return args.length ? new RealDate(...args) : new RealDate(FROZEN_MS);
}
FrozenDate.now = () => FROZEN_MS;
FrozenDate.parse = RealDate.parse;
FrozenDate.UTC = RealDate.UTC;
FrozenDate.prototype = RealDate.prototype;
function dayStr(ms) {
  const d = new RealDate(ms);
  const z = (n) => ('0' + n).slice(-2);
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}

function makeStore(seed) {
  const data = Object.assign({}, seed || {});
  return { get(k, d) { return (k in data) ? data[k] : d; }, set(k, v) { data[k] = v; }, _data: data };
}
function makeBody() {
  const registry = new Map();
  function el() {
    return {
      onclick: null, value: '', textContent: '', innerHTML: '', style: {}, disabled: false,
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {}, removeEventListener() {},
      getContext: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 660, height: 220 }),
      setAttribute() {}, getAttribute: () => null,
      querySelector: () => null, querySelectorAll: () => []
    };
  }
  return {
    _html: '',
    set innerHTML(h) { this._html = String(h); registry.clear(); },
    get innerHTML() { return this._html; },
    querySelector(sel) {
      if (sel.charAt(0) !== '#') return null;
      if (this._html.indexOf('id="' + sel.slice(1) + '"') < 0) return null;
      if (!registry.has(sel)) registry.set(sel, el());
      return registry.get(sel);
    },
    querySelectorAll() { return []; }
  };
}

function rep(id, filedAt, kind, signed) {
  return {
    id, date: dayStr(filedAt), filedAt, kind, odometer: 171000,
    result: 'pass', defects: [], signed: !!signed,
    unit: '07', plate: '04 R209', carrier: 'AI Trucking', driverName: 'Asjad Kamal', items: {}
  };
}
/* 5 reports: today's pre-trip (signed), Nov 4 post (UNSIGNED),
   Nov 3 pre, Nov 2 pre, Nov 1 pre — so both history cards and a
   5-deep Past inspections list all exist at once. */
const fixture = [
  rep('r1', new RealDate(2026, 10, 5, 8, 18).getTime(), 'pre', true),
  rep('r2', new RealDate(2026, 10, 4, 17, 2).getTime(), 'post', false),
  rep('r3', new RealDate(2026, 10, 3, 7, 5).getTime(), 'pre', true),
  rep('r4', new RealDate(2026, 10, 2, 6, 58).getTime(), 'pre', true),
  rep('r5', new RealDate(2026, 10, 1, 7, 11).getTime(), 'pre', true)
];
const store = makeStore({
  onboarding: { firstName: 'Asjad', lastName: 'Kamal', contractingCo: 'AI Trucking', companyName: 'Asjad Kamal', truckNo: '07' },
  pti_reports: fixture
});
const sb = {
  console, Date: FrozenDate, Meticulous: { modules: {} },
  App: {
    _store: store,
    _esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    _today: () => '2026-11-05',
    userRole: () => 'driver'
  },
  window: {}
};
sb.window = sb;
vm.createContext(sb);
vm.runInContext(read('modules/pti.js'), sb);
const PTI = sb.Meticulous.modules.pti;
ok('pti module registers', !!PTI);

const body = makeBody();
PTI.render(body);
const html = body.innerHTML;
const at = (s) => html.indexOf(s);

ok('the form paints', at('🚛 Inspection — Schedule 1') >= 0);
ok('the whole form paints (Sign & file card)', at('✍️ Sign &amp; file') >= 0 && at('id="pti_file"') >= 0);
ok('today-filed card paints', at('✅ Today’s inspection') >= 0);
ok('unsigned card paints', at('not signed yet') >= 0);
ok('past inspections paint', at('📁 Past inspections') >= 0);

/* THE ORDER: form first — every history surface underneath it. */
ok('form opens the screen (before today-filed)', at('🚛 Inspection — Schedule 1') < at('✅ Today’s inspection'));
ok('form opens the screen (before unsigned)', at('🚛 Inspection — Schedule 1') < at('not signed yet'));
ok('the whole form precedes today-filed', at('id="pti_file"') < at('✅ Today’s inspection'));
ok('the whole form precedes unsigned', at('id="pti_file"') < at('not signed yet'));
ok('the whole form precedes Past inspections', at('id="pti_file"') < at('📁 Past inspections'));
ok('history cards precede the Past inspections list',
  at('✅ Today’s inspection') < at('📁 Past inspections') && at('not signed yet') < at('📁 Past inspections'));

/* Recent history = newest 3; the full list only on request. */
const histSection = html.slice(at('📁 Past inspections'));
const rows = (histSection.match(/data-pti-open=/g) || []).length;
ok('recent history shows exactly 3', rows === 3, 'rows=' + rows);
ok('the rest wait behind Show more', histSection.indexOf('Show more — 2 more inspections') >= 0);
ok('newest first in recent history', histSection.indexOf('2026-11-05') < histSection.indexOf('2026-11-03'));

/* Nothing was lost in the move: the cards still work. */
ok('View the latest report still offered', html.indexOf('id="pti_view_today"') >= 0);
ok('unsigned rows still open their report', html.indexOf('Tap to open and sign it.') >= 0);
ok('Inspection Mode door still on the screen', html.indexOf('id="pti_dot_enter"') >= 0);

console.log('\npti-history-under-form-v328: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
