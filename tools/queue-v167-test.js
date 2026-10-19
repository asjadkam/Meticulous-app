#!/usr/bin/env node
/* Meticulous v167 — OFFICE FACE suite (owner, Oct 18, 2026
 * 21:50 MDT): an office-only user sees ONLY Connect, Dispatch,
 * Invoice, P&L and Manifest — the driver modules (Maintenance,
 * Fuel & Expense, Revenue, tracker/odometer cards) are off his
 * face, dashboard AND sidebar. And the boss's Preferences shows
 * each connected driver's OWN wage with that driver, read-only
 * (v163's wage law: the driver sets it; it arrives via Connect).
 *
 * Run: node tools/queue-v167-test.js
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
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function memStore(seed) {
  const data = JSON.parse(JSON.stringify(seed || {}));
  return {
    _data: data,
    get: function (k, d) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : d; },
    set: function (k, v) { data[k] = v; return true; },
    del: function (k) { delete data[k]; }
  };
}
function extractRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('region not found: ' + beginMark);
  return src.slice(a, b + 2);
}

/* ---- A: the role orders (the ROLE region, verbatim) ---- */
const appSrc = read('js/app.js');
function roleWorld() {
  const sb = { window: {}, console: console, App: {} };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext('var store = { get: function () { return {}; }, set: function () {} };', sb);
  vm.runInContext(extractRegion(appSrc, 'ROLE-BEGIN', 'ROLE-END'), sb);
  return sb;
}
{
  const sb = roleWorld();
  eq('A1 the office face is ONLY the five tools, Connect first',
    sb.roleModuleOrder('office'), ['connect', 'dispatch', 'invoice', 'pnl', 'manifest']);
  const items = ['dashboard', 'revenue', 'dispatch', 'navigator', 'fuel', 'pnl', 'maintenance', 'pti',
    'damage', 'manifest', 'invoice', 'connect', 'reminders', 'preferences', 'subscription', 'account', 'feedback', 'logout']
    .map(function (k) { return [k, '', k]; });
  const off = sb.roleSidebarOrder('office', items).map(function (i) { return i[0]; });
  eq('A2 the office sidebar leads with the five after the dashboard',
    off.slice(0, 6), ['dashboard', 'connect', 'dispatch', 'invoice', 'pnl', 'manifest']);
  eq('A3 no driver module survives on the office face',
    off.filter(function (k) { return ['revenue', 'fuel', 'maintenance', 'pti', 'navigator', 'damage'].indexOf(k) >= 0; }), []);
  eq('A4 the office sidebar keeps the account utilities',
    ['preferences', 'reminders', 'subscription', 'account', 'feedback', 'logout'].every(function (k) { return off.indexOf(k) >= 0; }), true);
  const drv = sb.roleSidebarOrder('driver', items).map(function (i) { return i[0]; });
  eq('A5 the driver face is untouched (every item kept)', drv.length, items.length);
  eq('A6 office gets no tracker (the standing roleShowsTracker rule)', sb.roleShowsTracker('office'), false);
}

/* ---- B: the boss's Preferences — drivers' wages, read-only ---- */
function FakeEl(sel) {
  this._sel = sel || ''; this._kids = {}; this._html = '';
  this.value = ''; this.textContent = ''; this.style = {}; this.files = [];
  this.onclick = null; this._listeners = {}; this.options = [{ text: '' }]; this.selectedIndex = 0;
  this.classList = { add: function () {}, remove: function () {}, toggle: function () {} };
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
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };

{
  const store = memStore({
    onboarding: { accountType: 'Fleet Manager', userRole: 'office', firstName: 'Boss', lastName: 'Man', payStandard: 'Hourly', billingRate: 93 },
    __peer_wages: { 'uid-driver-1': { payType: 'hourly', rate: 29 }, 'uid-driver-2': { payType: 'permile', rate: 1.85 } },
    con_list: [
      { uid: 'uid-driver-1', name: 'Driver One', business: 'One Trucking' },
      { uid: 'uid-driver-2', name: 'Driver Two', business: '' }
    ]
  });
  const sb = {
    window: {}, Meticulous: { modules: {} }, console: console,
    App: {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s); },
      _today: function () { return '2026-10-19'; },
      userRole: function () { return 'office'; }
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(read('js/connectpipe.js'), sb);
  sb.ConnectPipe = sb.window.ConnectPipe;
  vm.runInContext(read('modules/preferences.js'), sb);
  const body = new FakeEl('body');
  let renderErr = null;
  try { sb.Meticulous.modules.preferences.render(body); } catch (e) { renderErr = e; }
  ok('B1 the office Preferences render without error', !renderErr, renderErr && renderErr.message);
  const html = body._html || '';
  ok('B2 the Drivers\u2019 wages card paints', html.indexOf('Drivers\u2019 wages — set by each driver') !== -1);
  ok('B3 each driver shows WITH his own wage',
    html.indexOf('Driver One') !== -1 && html.indexOf('$29.00/hour') !== -1 &&
    html.indexOf('Driver Two') !== -1 && html.indexOf('$1.85/mile') !== -1);
  const cardStart = html.indexOf('Drivers\u2019 wages');
  const cardEnd = html.indexOf('</div>', html.indexOf('arrives here by itself'));
  const card = cardStart === -1 ? '' : html.slice(cardStart, cardEnd === -1 ? undefined : cardEnd);
  ok('B4 the card is read-only (no inputs, nothing to edit)', card.indexOf('<input') === -1 && card.indexOf('<button') === -1);
  ok('B5 the copy says the wage is never set on this side', html.indexOf('prices his days in your P&L') !== -1);
  /* and with no connected drivers cached, no empty card */
  const store2 = memStore({ onboarding: { accountType: 'Fleet Manager', userRole: 'office', payStandard: 'Hourly' } });
  const sb2 = {
    window: {}, Meticulous: { modules: {} }, console: console,
    App: { _store: store2, _esc: sb.App._esc, _today: sb.App._today, userRole: function () { return 'office'; } }
  };
  sb2.window = sb2;
  vm.createContext(sb2);
  vm.runInContext(read('modules/preferences.js'), sb2);
  const body2 = new FakeEl('body');
  try { sb2.Meticulous.modules.preferences.render(body2); } catch (e) {}
  ok('B6 no cached driver wages → no card (nothing invented)',
    (body2._html || '').indexOf('Drivers\u2019 wages — set by each driver') === -1);
}

console.log('\nqueue-v167 test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
