#!/usr/bin/env node
/* Meticulous v107 — FUEL TREND SANITY (Stage 3 of the Oct 16
 * overnight program).
 *
 * Owner evidence (Oct 16): the Fuel trend printed 4,484.5 km/L.
 * One fill's odometer stamp was poisoned — the Oct 15 receipt's
 * INVOICE NUMBER (519326) was read as the odometer — so the leg
 * into that fill "drove" ~350,000 km on a single tank. The fix
 * excludes impossible legs from every economy computation (Fuel's
 * trend AND Maintenance's mileage stats): a leg must span
 * 0 < km <= 50,000 and imply a truck-plausible 0.5–20 km/L. The
 * poisoned DATA stays in the history, untouched and editable.
 *
 * The dataset mirrors his real October: legs of ~2.4–2.6 km/L
 * class plus the poisoned stamp.
 * Run: node tools/fuel-trend-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

const FILLS = [
  { date: '2026-10-13', odo: 168510, litres: 94.522, cost: 234.32, station: 'Mobil — Westwinds' },
  { date: '2026-10-14', odo: 168759, litres: 100.0, cost: 247.90, station: 'Mobil — Heritage Meadows' },
  { date: '2026-10-15', odo: 168936, litres: 72.0, cost: 178.49, station: 'Mobil' },
  { date: '2026-10-15', odo: 519326, litres: 78.175, cost: 193.80, station: 'Mobil (poisoned stamp)' },
  { date: '2026-10-16', odo: 169166, litres: 88.106, cost: 199.91, station: 'Petro-Canada — Barlow Tr' }
];

function makeWorld(withOdoGate) {
  const store = {};
  const sb = { console: console };
  sb.window = sb;
  sb.Meticulous = { modules: {} };
  sb.App = {
    _store: {
      get: function (k, d) { return (k in store) ? store[k] : d; },
      set: function (k, v) { store[k] = v; return true; }
    },
    _esc: function (s) { return String(s == null ? '' : s); },
    _today: function () { return '2026-10-16'; },
    _onb: function () { return {}; },
    _odoImplausible: withOdoGate ? function (v) {
      return (v - 169166 > 1000) ? 'jump' : null;
    } : null
  };
  if (!withOdoGate) delete sb.App._odoImplausible;
  vm.createContext(sb);
  store['fuel_fills'] = JSON.parse(JSON.stringify(FILLS));
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'modules', 'fuel.js'), 'utf8'), sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'modules', 'maintenance.js'), 'utf8'), sb);
  return sb;
}

console.log('\n— the trend: the poisoned leg is excluded, the data is not —');
for (const gate of [true, false]) {
  const sb = makeWorld(gate);
  const F = sb.Meticulous.modules.fuel, M = sb.Meticulous.modules.maintenance;
  const trend = F._mpgTrend();
  eq('trend has exactly the 3 real legs (gate ' + (gate ? 'on' : 'off') + ')', trend.length, 3);
  ok('every trend value is truck-class (2–3 km/L)',
    trend.every(function (p) { const v = parseFloat(p.mpg); return v >= 2 && v <= 3; }), JSON.stringify(trend));
  ok('no trend value is anywhere near 4,484.5',
    trend.every(function (p) { return parseFloat(p.mpg) < 100; }));
  const stats = M._mileageStats();
  eq('maintenance counts exactly the 3 real legs (gate ' + (gate ? 'on' : 'off') + ')', stats.legs, 3);
  ok('maintenance average is truck-class', stats.avgKpl >= 2 && stats.avgKpl <= 3, 'avgKpl ' + stats.avgKpl);
  eq('tracked km is the real legs only', Math.round(stats.kmTracked), 249 + 177 + 230);
  const stored = sb.App._store.get('fuel_fills', []);
  eq('the poisoned fill is still in the history (data intact)', stored.length, 5);
  eq('…with its stamp untouched', stored[3].odo, 519326);
}

console.log('\n— the leg rule itself —');
{
  const sb = makeWorld(true);
  const okLeg = sb.Meticulous.modules.fuel._econLegOk;
  eq('a normal leg passes (230 km / 88.1 L)', okLeg(230, 88.106), true);
  eq('the poisoned leg fails (350,160 km)', okLeg(350160, 78.175), false);
  eq('a zero-distance leg fails', okLeg(0, 50), false);
  eq('a backwards leg fails', okLeg(-120, 50), false);
  eq('an economy past 20 km/L fails', okLeg(900, 30), false);
  eq('an economy under 0.5 km/L fails', okLeg(40, 100), false);
  eq('a long-but-plausible leg passes (900 km / 320 L)', okLeg(900, 320), true);
}

console.log('\nfuel-trend: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
