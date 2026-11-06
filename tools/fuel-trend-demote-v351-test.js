#!/usr/bin/env node
/* Meticulous v351 — FUEL-TREND-CARD-TRIM-AND-DEMOTE (owner,
 * Nov 5, 23:23, screenshot): the Fuel & Expense page opened
 * with the Fuel trend card listing ~8 "Last 10 legs" rows.
 * His words: "I don't need 7 entries of fuel trends... I need
 * 2 or 3 at max..... And that's good to see but not essential....
 * So this shouldn't be the first thing I see on this page."
 *
 * Fix (modules/fuel.js): the legs list caps at the last 3
 * (slice(-3); the note reads "Last 3 of N legs" so the count
 * stays honest), and the trend card is appended AFTER the
 * Fill-ups card — the page opens on the fill-ups themselves
 * (Audit button, Other-expenses tab, Fuel-up form, Fill-ups,
 * then the trend). The trend math (mpgTrend) is untouched.
 *
 * Run: node tools/fuel-trend-demote-v351-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const fuelSrc = fs.readFileSync(path.join(ROOT, 'modules', 'fuel.js'), 'utf8');
const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }

function makeEl() {
  const el = {
    children: {}, style: {}, _html: '', textContent: '', value: '', checked: false, files: [], onclick: null, onchange: null, _attrs: {},
    setAttribute: function (k, v) { el._attrs[k] = v; },
    getAttribute: function (k) { return (k in el._attrs) ? el._attrs[k] : null; },
    addEventListener: function () {},
    querySelector: function () { return makeEl(); },
    querySelectorAll: function () { return []; },
    scrollIntoView: function () {}
  };
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return el._html; },
    set: function (v) { el._html = String(v); }
  });
  return el;
}

/* ten fills, nine legs — the book behind his screenshot */
const fills = [];
for (let i = 0; i < 10; i++) {
  fills.push({ date: '2026-10-' + (20 + i), litres: '90', cost: '200', station: 'Mobil', odo: 170000 + i * 250, profileId: 'p1' });
}
const data = { onboarding: { payStandard: 'Hourly', ownWageRate: 29, travelBonus: 0 }, tracker: { status: 'idle' }, fuel_fills: fills, fuel_expenses: [] };
const store = {
  get: function (k, d) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : d; },
  set: function (k, v) { data[k] = JSON.parse(JSON.stringify(v)); return true; },
  del: function (k) { delete data[k]; return true; }
};
const els = {};
const body = makeEl();
body.querySelector = function (sel) { if (!els[sel]) els[sel] = makeEl(); return els[sel]; };
const sb = {
  console: console, Date: Date, Math: Math, JSON: JSON, Promise: Promise, setTimeout: setTimeout,
  FB: { user: null },
  App: {
    _store: store,
    _today: function () { return '2026-11-05'; },
    _esc: function (s) { return String(s == null ? '' : s); },
    openModule: function () {},
    _photoDl: function () { return ''; },
    _masterOdometer: function () { return 172250; },
    _logOdoReading: function () {}
  },
  Meticulous: { modules: {} }
};
sb.window = sb;
vm.createContext(sb);
vm.runInContext(fuelSrc, sb, { filename: 'modules/fuel.js' });
sb.Meticulous.modules.fuel.render(body);

const h = body.innerHTML;
const iFillups = h.indexOf('📒 Fill-ups');
const iTrend = h.indexOf('⛽ Fuel trend');
const iForm = h.indexOf('id="fu_form_card"');
ok('the face paints all three cards', iFillups >= 0 && iTrend >= 0 && iForm >= 0);
ok('the page opens on the fill-ups side: the form and the Fill-ups list both come BEFORE the trend card',
  iForm < iTrend && iFillups < iTrend);
const trendSeg = h.slice(iTrend);
eq('the trend legs list is capped at exactly 3 rows', (trendSeg.match(/class="kv"/g) || []).length, 3);
ok('the count stays honest: "Last 3 of 9 legs"', trendSeg.indexOf('Last 3 of 9 legs') >= 0);
ok('the headline economy figure still leads the card', trendSeg.indexOf('font-size:24px') >= 0);
ok('source: the legs slice is -3 and the card is appended after the list',
  fuelSrc.indexOf('trend.slice(-3)') >= 0 && fuelSrc.indexOf('h += trendCardHtml;') > fuelSrc.indexOf('📒 Fill-ups'));
eq('webVersion is 351', ver.webVersion, 351);
ok('index.html pins fuel.js?v=351', idxSrc.indexOf('modules/fuel.js?v=351') >= 0);

console.log('\nfuel-trend-demote-v351: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
