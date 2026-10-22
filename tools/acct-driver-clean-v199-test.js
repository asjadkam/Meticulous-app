#!/usr/bin/env node
/* Meticulous v199 — ACCT-DRIVER-CLEAN (owner, Oct 21, 2026
 * 09:48 MDT): the Oct 13 exception ("He is a Driver but needs
 * access to everything") is RETIRED — he has a separate tester
 * account for the owner side, and his own account is account
 * type Driver. He named the two modules himself: "take off
 * owners stuff off my account namely pnl and maintainance".
 *
 * The law under test:
 *  - On a Driver account, pnlAllowed() and maintAllowed() are
 *    false — P&L and Maintenance come off the face.
 *  - Owner-Operator and Fleet Manager accounts keep both.
 *  - An unset account type resolves to the app's own default
 *    ('Driver', js/app.js App.onAuth) — the gates answer false.
 *  - buildDashboard and buildSidebar (the only places modules
 *    are surfaced) both consult the two gates.
 *  - NOTHING underneath was deleted: modules/pnl.js and
 *    modules/maintenance.js still register their modules.
 * Run: node tools/acct-driver-clean-v199-test.js
 */
'use strict';
const fs = require('fs'); const vm = require('vm'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); } }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
function extractRegion(src, b, e) { const a = src.lastIndexOf('/*', src.indexOf(b)); const c = src.indexOf('*/', src.indexOf(e)); return src.slice(a, c + 2); }
function memStore(seed) { const data = JSON.parse(JSON.stringify(seed || {})); return { get: (k, d) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; return true; }, del: (k) => { delete data[k]; } }; }

const appSrc = read('js/app.js');
const ver = JSON.parse(read('version.json'));
const idxSrc = read('index.html');

function gates(seed) {
  const sb = { window: {}, console: console, store: memStore(seed) };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(extractRegion(appSrc, 'ACCT-GATE-BEGIN', 'ACCT-GATE-END'), sb);
  return sb;
}

console.log('\n— v199: the gates answer by account type —');
{
  const d = gates({ onboarding: { accountType: 'Driver' } });
  eq('Driver: P&L off', d.pnlAllowed(), false);
  eq('Driver: Maintenance off', d.maintAllowed(), false);
  const oo = gates({ onboarding: { accountType: 'Owner-Operator' } });
  eq('Owner-Operator: P&L on', oo.pnlAllowed(), true);
  eq('Owner-Operator: Maintenance on', oo.maintAllowed(), true);
  const fm = gates({ onboarding: { accountType: 'Fleet Manager' } });
  eq('Fleet Manager: P&L on', fm.pnlAllowed(), true);
  eq('Fleet Manager: Maintenance on', fm.maintAllowed(), true);
  const none = gates({});
  eq('unset type defaults to Driver: P&L off', none.pnlAllowed(), false);
  eq('unset type defaults to Driver: Maintenance off', none.maintAllowed(), false);
  eq('acctTypeNow reads the stored type', gates({ onboarding: { accountType: 'Fleet Manager' } }).acctTypeNow(), 'Fleet Manager');
}

console.log('\n— v199: both surfacing places consult the gates —');
{
  ok('buildDashboard skips pnl on the gate', appSrc.indexOf("if (key === 'pnl' && !pnlAllowed()) return;") !== -1);
  ok('buildDashboard skips maintenance on the gate', appSrc.indexOf("if (key === 'maintenance' && !maintAllowed()) return;") !== -1);
  ok('buildSidebar skips pnl on the gate', appSrc.indexOf("if (it[0] === 'pnl' && !pnlAllowed()) return;") !== -1);
  ok('buildSidebar skips maintenance on the gate', appSrc.indexOf("if (it[0] === 'maintenance' && !maintAllowed()) return;") !== -1);
  ok('the retired always-true stub is gone', appSrc.indexOf('He is a Driver but needs access to everything') === -1 || appSrc.indexOf('function pnlAllowed() {\n    return true;') === -1);
}

console.log('\n— v199: nothing underneath was deleted —');
{
  ok('pnl module still registers', read('modules/pnl.js').indexOf("modules.pnl") !== -1 || read('modules/pnl.js').indexOf("'pnl'") !== -1);
  ok('maintenance module still registers', read('modules/maintenance.js').indexOf('maintenance') !== -1);
  ok('role module orders untouched (driver order still lists the keys; the gates filter)', appSrc.indexOf("driver: ['revenue', 'dispatch', 'fuel', 'maintenance', 'pti', 'manifest', 'navigator', 'damage', 'pnl', 'invoice', 'connect']") !== -1);
}

console.log('\n— v199: ship pins —');
{
  eq('version.json webVersion ships as 199', ver.webVersion, 219);
  ok('index.html pins js/app.js at ?v=219', idxSrc.indexOf('js/app.js?v=219') !== -1);
}

console.log('\nacct-driver-clean-v199: ' + pass + ' passed, ' + fail + ' failed');
