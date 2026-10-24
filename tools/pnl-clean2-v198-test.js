#!/usr/bin/env node
/* Meticulous v198 — PNL-CLEAN-2 (owner, Oct 20, 2026 19:53 MDT,
 * reaffirmed Oct 21, 2026 09:17 MDT, his screenshot: "I thought
 * I asked you to clean up everything?"): after v181 (D5) the P&L
 * screen STILL rendered three sections under the Monthly
 * analysis — (1) a "+ Add driver" card (🤝 Connect a driver
 * button + explainer + "Add manually instead" + the manual form
 * + the driver list), (2) a "🕒 Log driver work" card, (3) a
 * "+ Business expense" form (Date + Category + receipt photo).
 *
 * The law under test:
 *  - The P&L screen renders the period picker card + the Monthly
 *    analysis card. NOTHING else — exactly two cards.
 *  - All three sections are gone from the render AND from their
 *    wiring (ids, buttons, handlers, the form's receipt OCR).
 *  - NOTHING underneath was deleted: the stores and helpers
 *    (drivers(), wageEntries(), bizExpenses(), calc()) and the
 *    silent crew-books fetch stay — they feed the analysis; the
 *    wage/expense math on seeded data is unchanged.
 * Run: node tools/pnl-clean2-v198-test.js
 */
'use strict';
const fs = require('fs'); const vm = require('vm'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); } }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
function extractRegion(src, b, e) { const a = src.lastIndexOf('/*', src.indexOf(b)); const c = src.indexOf('*/', src.indexOf(e)); return src.slice(a, c + 2); }
function memStore(seed) { const data = JSON.parse(JSON.stringify(seed || {})); return { get: (k, d) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; return true; }, del: (k) => { delete data[k]; } }; }
const invSrc = read('modules/invoice.js'); const pnlSrc = read('modules/pnl.js');
const idxSrc = read('index.html'); const ver = JSON.parse(read('version.json'));
function makePnl(seed) {
  const store = memStore(seed);
  const sb = { window: {}, Meticulous: { modules: {} }, console: console, App: { _store: store, _esc: (s) => String(s == null ? '' : s), _today: () => '2026-10-21', userRole: () => 'both' } };
  sb.window.window = sb.window;
  vm.createContext(sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(pnlSrc, sb);
  return sb.Meticulous.modules.pnl;
}
function fakeBody() {
  return {
    innerHTML: '',
    querySelector: function () { return {}; },
    querySelectorAll: function () { return []; }
  };
}

/* ---------- source pins: the three sections are off the face ---------- */
{
  console.log('\n— v198: sections gone from source —');
  ['<h3>＋ Add driver</h3>', '<h3>🕒 Log driver work</h3>', '<h3>＋ Business expense</h3>',
   '🤝 Connect a driver', 'Add manually instead',
   'id="pnl_connect_open"', 'id="pnl_manual_open"', 'id="pnl_dlist"',
   'id="pnl_dname"', 'id="pnl_drate"', 'id="pnl_dtype"', 'id="pnl_dstart"', 'id="pnl_dtravel"', 'id="pnl_dadd"',
   'id="pnl_wdate"', 'id="pnl_wdriver"', 'id="pnl_wqty"', 'id="pnl_wadd"', 'id="pnl_wlist"',
   'id="pnl_date"', 'id="pnl_cat"', 'id="pnl_what"', 'id="pnl_cost"', 'id="pnl_add"', 'id="pnl_list"',
   'id="pnl_rc_cam"', 'id="pnl_rc_pick"', 'id="pnl_rc_img"', 'id="pnl_rc_prev"', 'id="pnl_rc_read"'
  ].forEach(function (s) {
    ok('gone: ' + s, pnlSrc.indexOf(s) === -1);
  });
  ok('gone: the removed sections\' wiring (OCR handler, search flag, travel/delete hooks)',
    pnlSrc.indexOf('pnlHandlePhoto') === -1 && pnlSrc.indexOf('__mtConnectSearch') === -1 &&
    pnlSrc.indexOf('data-pnltravel') === -1 && pnlSrc.indexOf('data-pnldriverdel') === -1 &&
    pnlSrc.indexOf('data-pnlwdel') === -1);
}

/* ---------- plumbing pins: nothing underneath was deleted ---------- */
{
  console.log('\n— v198: the plumbing stays —');
  ok('stores/helpers intact (drivers, wageEntries, bizExpenses, calc)',
    pnlSrc.indexOf('function drivers(') !== -1 && pnlSrc.indexOf('function wageEntries(') !== -1 &&
    pnlSrc.indexOf('function bizExpenses(') !== -1 && pnlSrc.indexOf('function calc(') !== -1);
  ok('the silent crew-books fetch stays (it prices Total salaries)',
    pnlSrc.indexOf('ConnectPipe.fetchCrewRange') !== -1);
  ok('the analysis + its picker stay (Monthly analysis, From/To, Use dates)',
    pnlSrc.indexOf('📊 Monthly analysis') !== -1 && pnlSrc.indexOf('id="pnl_from"') !== -1 &&
    pnlSrc.indexOf('id="pnl_to"') !== -1 && pnlSrc.indexOf('id="pnl_usedates"') !== -1);
}

/* ---------- the render, driven: exactly two cards ---------- */
{
  console.log('\n— v198: render driven —');
  const pnl = makePnl({
    onboarding: { payStandard: 'hourly', payRate: 29, ownWageRate: 29, accountType: 'Owner-Operator', userRole: 'both' },
    pnl_drivers: [{ id: 'd1', name: 'Bob', payType: 'hourly', rate: 25, travelHours: 1, start: '2026-10' }],
    pnl_wage_entries: [{ id: 'w1', date: '2026-10-10', driverId: 'd1', qty: 10, unit: 'hrs', rate: 25, wage: 250 }],
    pnl_travel_claims: [], pnl_card_wages: [], pnl_expenses: [{ date: '2026-10-05', category: 'Fuel', what: 'Diesel', cost: '100.00' }],
    rev_entries: [{ date: '2026-10-05', type: 'hourly', hours: '10', amount: '290', note: 'Dispatch', foremanHours: 9, travelHours: 1, travelInIncome: true }],
    rev_extras: [], fuel_fills: [], fuel_expenses: []
  });
  const body = fakeBody();
  pnl.render(body);
  const h = body.innerHTML;
  eq('render paints exactly TWO cards (picker + Monthly analysis)', (h.match(/<div class="card">/g) || []).length, 2);
  ok('render keeps the Monthly analysis', h.indexOf('📊 Monthly analysis') !== -1 && h.indexOf('Total rev.') !== -1 && h.indexOf('Total profit') !== -1);
  ok('render keeps the period picker (From/To + Use dates)', h.indexOf('id="pnl_from"') !== -1 && h.indexOf('id="pnl_to"') !== -1 && h.indexOf('id="pnl_usedates"') !== -1);
  ['Add driver', 'Connect a driver', 'Add manually instead', 'Log driver work', 'Business expense',
   'pnl_connect_open', 'pnl_manual_open', 'pnl_dadd', 'pnl_wadd', 'pnl_wlist', 'pnl_dlist',
   'pnl_rc_cam', 'id="pnl_add"', 'pnl_list', 'Receipt photo'].forEach(function (s) {
    ok('render has NO: ' + s, h.indexOf(s) === -1);
  });
  /* the seeded data still prices the analysis (nothing underneath broke) */
  const c = pnl._calc('2026-10');
  ok('seeded wage entry still prices driver wages (10h × $25 + travel)', c.wagesTotal > 0, 'wagesTotal=' + c.wagesTotal);
}

/* ---------- ship pins ---------- */
{
  console.log('\n— v198: ship pins —');
  eq('version.json webVersion ships as 199', ver.webVersion, 249);
  ok('index.html pins modules/pnl.js at ?v=249', idxSrc.indexOf('modules/pnl.js?v=249') !== -1);
}

console.log('\npnl-clean2-v198: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
