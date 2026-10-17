#!/usr/bin/env node
/* Meticulous v121 — THE SIDEWAYS PAN, KILLED AT THE ROOT.
 *
 * Owner evidence (Oct 17, 2026, his screen recording of the Fuel
 * screen): while scrolling, the ENTIRE panel drags sideways and
 * sits crooked — "Why is this acting like a website? Why is the
 * entire panel not straight?" The page carried NO horizontal
 * lock anywhere, so any element that sized even a few px past
 * the phone viewport made the whole page horizontally pannable.
 *
 * Measured on the v120 tree in a real engine at 360px (his data):
 * the dashboard module grid had a ~449px hard minimum (nowrap
 * card subtitles are grid items' min-content), P&L's three stat
 * cards summed to 422px, Invoice's period-to date input forced
 * 408px, Dispatch's start-time input 376px, a Revenue stat card
 * crossed at 370px. One mechanism everywhere: flex/grid children
 * whose floor is their content's min-content (an input's
 * intrinsic width, an unbreakable string) summing past the
 * screen. Worst on big-text handsets, where every floor grows.
 *
 * The fix is CSS-only, three layers, all pinned here:
 *  1. THE LOCK: html, body and #app carry overflow-x (clip where
 *     supported — it creates no scroll container, so the sticky
 *     topbar/module heads keep sticking — hidden as fallback).
 *     The page can never be dragged sideways again, whatever any
 *     future element does.
 *  2. THE GUARDS: flex/grid children (.row, .kv, .modgrid,
 *     .optgrid, .hero-btns) and form controls may shrink below
 *     min-content, so a row wraps/shrinks inside its own box
 *     instead of sizing the page.
 *  3. THE STRINGS: list-row text and .kv values wrap anywhere;
 *     images cap at their container.
 * Plus a source scan: no inline style or stylesheet rule may
 * size anything past a phone viewport ever again.
 *
 * The live-engine sweep that verified the fix (headless Chrome,
 * owner's data, every module at 360px and 412px, zero elements
 * past the edge, sticky bars / drawer / sheets intact) is
 * recorded in BUGS.md under v121.
 * Run: node tools/overflow-lock-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}

console.log('\n— layer 1: the global horizontal lock is in the CSS —');
const css = read('css/style.css');
ok('html,body lock: overflow-x hidden fallback + clip', /html,body\{overflow-x:hidden;overflow-x:clip;\}/.test(css));
ok('#app lock: overflow-x clip', /#app\{overflow-x:clip;\}/.test(css));
ok('no overflow-x lock is ever REMOVED by a later visible default', !/html,body\{[^}]*overflow-x:visible/.test(css));

console.log('\n— layer 2: flex/grid children and controls may shrink —');
ok('row/kv/grid children min-width:0', /\.row>\*,\.kv>\*,\.modgrid>\*,\.optgrid>\*,\.hero-btns>\*\{min-width:0;\}/.test(css));
ok('form controls min-width:0', /input,select,textarea\{min-width:0;\}/.test(css));

console.log('\n— layer 3: strings wrap, images cap —');
ok('list row text wraps anywhere', /\.listitem \.a,\.listitem \.b\{overflow-wrap:anywhere;\}/.test(css));
ok('kv values wrap anywhere', /\.kv b\{overflow-wrap:anywhere;\}/.test(css));
ok('images cap at container', /(^|\n)img\{max-width:100%;\}/.test(css));

console.log('\n— source scan: nothing may be sized past a phone viewport —');
function scanWidths(file, src, limit) {
  const bad = [];
  const re = /["';{]\s*(width|min-width)\s*:\s*(\d+)px/g;
  let m;
  while ((m = re.exec(src))) {
    if (+m[2] > limit) bad.push(m[1] + ':' + m[2] + 'px @' + src.slice(0, m.index).split('\n').length);
  }
  ok(file + ': no width/min-width over ' + limit + 'px', bad.length === 0, bad.join('; '));
}
fs.readdirSync(path.join(ROOT, 'modules')).filter(f => f.endsWith('.js')).forEach(f => scanWidths('modules/' + f, read('modules/' + f), 360));
fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).forEach(f => scanWidths('js/' + f, read('js/' + f), 360));
scanWidths('index.html', read('index.html'), 360);
scanWidths('css/style.css', css, 480);

console.log('\n— the Fuel screen (his evidence) renders inside the rules —');
function makeStore(mem) {
  return {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); },
    del: function (k) { delete mem[k]; }
  };
}
function stubEl() {
  return {
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    addEventListener: function () {}, setAttribute: function () {},
    getAttribute: function () { return null; },
    querySelector: function () { return stubEl(); },
    querySelectorAll: function () { return []; },
    click: function () {}, focus: function () {}
  };
}
const MONSTER = 'Petro-Canada-Superpass-Location-4949-Barlow-Trail-Southeast-Calgary-Alberta-Canada';
const mem = {
  fuel_fills: [
    { date: '2026-10-16', litres: 88.106, cost: 199.91, odo: 169166, station: MONSTER },
    { date: '2026-10-15', litres: 78.175, cost: 193.80, odo: 519326, station: 'Mobil @ 1739' },
    { date: '2026-10-14', litres: 94.522, cost: 234.32, odo: 168751, station: 'Mobil – 3633 Westwinds Dr, Calgary, AB' }
  ],
  fuel_expenses: [{ what: 'DEF (Petro-Canada Langdon) — bulk DEF fluid refill for the winter season', cost: 31.69, date: '2026-10-13' }]
};
const sb = { console: console, Math: Math, Date: Date, JSON: JSON, setTimeout: setTimeout };
sb.window = sb;
sb.Meticulous = { modules: {} };
sb.App = {
  _store: makeStore(mem),
  _today: function () { return '2026-10-17'; },
  _esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
  userRole: function () { return 'both'; },
  tracker: null
};
vm.createContext(sb);
vm.runInContext(read('modules/fuel.js'), sb, { filename: 'modules/fuel.js' });
const body = {
  _html: '',
  set innerHTML(v) { this._html = String(v); },
  get innerHTML() { return this._html; },
  querySelector: function () { return stubEl(); },
  querySelectorAll: function () { return []; }
};
let renderErr = null;
try { sb.Meticulous.modules.fuel.render(body); } catch (e) { renderErr = e; }
ok('fuel renders without error', !renderErr, renderErr && renderErr.message);
const html = body.innerHTML;
ok('fill-ups list rendered', html.indexOf('Fill-ups') >= 0);
ok('the monster unbroken station string flowed into the row', html.indexOf(MONSTER) >= 0);
ok('other-expenses row rendered', html.indexOf('DEF (Petro-Canada Langdon)') >= 0);
(function () {
  const bad = [];
  const re = /style="[^"]*?(?:^|[;"\s])(width|min-width)\s*:\s*(\d+)px/g;
  let m;
  while ((m = re.exec(html))) { if (+m[2] > 360) bad.push(m[1] + ':' + m[2] + 'px'); }
  ok('rendered fuel HTML: no inline width/min-width over 360px', bad.length === 0, bad.join('; '));
})();

console.log('\noverflow-lock-test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
