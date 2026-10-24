#!/usr/bin/env node
/* Meticulous v243 — PROFILE1-LABEL-WRONG (owner, Fri Oct 23,
 * 2026 21:24 MDT, screen recording of his REAL account on live
 * v242): Preferences → Work profiles showed Profile 1 as
 * "Tester · Truck 07 · $29 — Working under this one", and the
 * dashboard tracker chip read "Tester · Truck 07". His words:
 * "I thought my primary profile was supposed to be the AI
 * Trucking and the tester was supposed to be the other."
 *
 * The label is App.workProfiles.label() = the profile record's
 * company (+ truck). Profile 1's company is seeded by the
 * derive-on-read migration from onboarding.contractingCo and
 * then PERSISTED verbatim by the first mutation — but unlike
 * the onboarding slot itself (owned per account by the v216
 * profile gate) and the Connect keys (namespaced per account
 * in v219), the work_profiles key carried NO account owner:
 * a state seeded while another account's working copy was in
 * the slot — the tester account on the same phone — became
 * his real account's Profile 1, company and all.
 *
 * The fix (the v242 seam, js/app.js): the persisted state is
 * stamped with its account owner (the store's own _conOwner)
 * at every persist; load() treats a state stamped by a
 * DIFFERENT account as absent and derives fresh from the
 * current account's onboarding; and a lone Profile 1 whose
 * company disagrees with the account's own contracting
 * company (the working copy IS that profile, by the seam's
 * model) is healed to the working copy's company on read.
 * Both surfaces (Preferences card + dashboard chip) render
 * label() off load(), so both are fixed at the one source.
 *
 * Run: node tools/work-profiles-label-v243-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
const clone = (v) => JSON.parse(JSON.stringify(v));

function extractRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('region not found: ' + beginMark);
  return src.slice(a, b + 2);
}
function memStore(seed) {
  const data = clone(seed || {});
  return {
    get: function (k, d) { return (k in data) ? clone(data[k]) : d; },
    set: function (k, v) { data[k] = clone(v); return true; },
    del: function (k) { delete data[k]; },
    _data: data
  };
}

const ONB = {
  firstName: 'Asjad', lastName: 'Kamal', companyName: 'Asjad Kamal',
  contractingCo: 'AI Trucking', contractingAddr: '1506 16 St NE',
  truckNo: '07', plate: '04 R209', ownWageRate: '29', payRate: '29',
  rateIncludesTax: true, invoiceTaxRate: '5', nextInvoiceNo: '1152'
};

function makeWorld(seed, uid) {
  const store = memStore(seed);
  const sb = {
    window: {}, Meticulous: { modules: {}, shared: {} }, console: console,
    App: {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s); },
      _today: function () { return '2026-10-23'; },
      user: uid ? { uid: uid } : null
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(extractRegion(appSrc, 'WORK-PROFILES-BEGIN', 'WORK-PROFILES-END'), sb);
  return { sb: sb, store: store, WP: sb.App.workProfiles };
}

/* the v242.0 persisted shape: no owner stamp anywhere */
const P1_TESTER = { id: 'p1', company: 'Tester', truckNo: '07', plate: '04 R209', rate: '29', rateIncludesTax: true, taxRate: '5', nextInvoiceNo: '1152', safetyExpiry: '', odometerBaseline: '' };

console.log('— L1: his exact shape — a lone Profile 1 labelled "Tester" —');
{
  const w = makeWorld({ onboarding: clone(ONB), work_profiles: { list: [clone(P1_TESTER)], activeId: 'p1' } }, 'uid-real');
  eq('L1 the Preferences card + dashboard chip label reads the company he charges',
    w.WP.label('p1'), 'AI Trucking · Truck 07');
  eq('L1 the active profile label agrees', w.WP.label(w.WP.activeId()), 'AI Trucking · Truck 07');
  const p1 = w.WP.of('p1');
  ok('L1 the rest of the record is untouched (truck, plate, rate)',
    p1.truckNo === '07' && p1.plate === '04 R209' && p1.rate === '29', JSON.stringify(p1));
}

console.log('— L2: a state stamped by the tester account never labels his —');
{
  const w = makeWorld({
    onboarding: clone(ONB),
    work_profiles: { owner: 'uid-tester', list: [clone(P1_TESTER)], activeId: 'p1' }
  }, 'uid-real');
  eq('L2 the foreign state is not adopted — Profile 1 derives from HIS onboarding',
    w.WP.label('p1'), 'AI Trucking · Truck 07');
  eq('L2 exactly one profile exists for his account', w.WP.load().list.length, 1);
}

console.log('— L3: multi-profile states are NOT healed (deliberate books stand) —');
{
  const p2 = { id: 'p2', company: 'Other Carrier Ltd', truckNo: '12', plate: 'XYZ 999', rate: '35', rateIncludesTax: false, taxRate: '5', nextInvoiceNo: '1', safetyExpiry: '', odometerBaseline: '' };
  const p1 = Object.assign(clone(P1_TESTER), { company: 'AI Trucking' });
  const onb2 = Object.assign(clone(ONB), { contractingCo: 'Other Carrier Ltd', truckNo: '12', plate: 'XYZ 999', ownWageRate: '35', nextInvoiceNo: '1' });
  const w = makeWorld({ onboarding: onb2, work_profiles: { list: [p1, p2], activeId: 'p2' } }, 'uid-real');
  eq('L3 Profile 1 keeps its own company', w.WP.label('p1'), 'AI Trucking · Truck 07');
  eq('L3 Profile 2 keeps its own company', w.WP.label('p2'), 'Other Carrier Ltd · Truck 12');
}

console.log('— L4: a deliberate rename still flows through the working copy —');
{
  const w = makeWorld({ onboarding: clone(ONB) }, 'uid-real');
  eq('L4 derived label starts as his company', w.WP.label('p1'), 'AI Trucking · Truck 07');
  w.WP.saveProfile('p1', { company: 'Renamed Co' });
  eq('L4 after the rename the label follows', w.WP.label('p1'), 'Renamed Co · Truck 07');
  eq('L4 and the working copy carries it (mirror intact)', w.store.get('onboarding', {}).contractingCo, 'Renamed Co');
  eq('L4 a fresh load still reads the rename (no false heal)',
    makeWorld(w.store._data, 'uid-real').WP.label('p1'), 'Renamed Co · Truck 07');
}

console.log('— L5: persists carry the account owner from now on —');
{
  const w = makeWorld({ onboarding: clone(ONB) }, 'uid-real');
  w.WP.add({ company: 'Other Carrier Ltd', truckNo: '12' });
  const stored = w.store.get('work_profiles', null);
  ok('L5 the persisted state is stamped with the account that wrote it',
    !!(stored && stored.owner === 'uid-real'), JSON.stringify(stored && stored.owner));
}

console.log('\nwork-profiles-label-v243: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
