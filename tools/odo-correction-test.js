#!/usr/bin/env node
/* Meticulous v97 — MASTER ODOMETER INFLATION fix suite.
 *
 * Field evidence (owner's live account, Oct 16, 2026): Maintenance
 * showed the odometer at 519,326 km and the oil change "overdue" by
 * 343,897 km, while the dash read 168,940 km and the sticker target
 * (175,429 km) was still 6,489 km away. The screen also printed
 * "Tracked over 350,816 km (2 legs)".
 *
 * Root cause, pinned by the v80/v86 suites and the code census in
 * Part B below: 519,326 was the INVOICE NUMBER on the Oct 15 fuel
 * receipt. The pre-v86 fuel save wrote it into the master (mt_odo)
 * and onto the fill record. v86 gated every writer, but two readers
 * in modules/maintenance.js still trusted recorded readings blindly:
 * currentOdo() took the max over ALL fill/event odometers, and
 * mileageStats() summed "legs" between consecutive fill odometers —
 * so the poisoned fill (519,326 beside a 168,510 fill) printed as a
 * 350,816 km leg and held the displayed odometer hostage even after
 * a master correction. GPS leg accumulation itself has NEVER written
 * mt_odo: js/miles.js keeps its own keys (pinned in Part B).
 *
 * This suite drives the REAL shipped code:
 *  A. js/app.js ODO-MASTER region + gate block (odo-guard slicing):
 *     legs-style writes can never move the master; a dash capture
 *     lands exactly; ordinary writes cannot lower it; the armed
 *     correction decision can.
 *  B. Writer census over js/ + modules/: every mt_odo write site is
 *     a known gated capture; the leg engines never name the key.
 *  C. modules/maintenance.js whole module over the field data:
 *     the owner's screen reproduced, then the new correction flow
 *     (api._applyOdoCorrection) repairs it — master exact, audit
 *     entry in the service history, poisoned fill excluded from the
 *     odometer math, oil countdown back to the sticker truth.
 *  D. Correction-card markup/wiring statics.
 * Run: node tools/odo-correction-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function eq(name, got, want) {
  const okK = String(got) === String(want);
  if (okK) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function slice(src, from, to) {
  const a = src.indexOf(from), b = src.indexOf(to);
  if (a < 0 || b < 0 || b <= a) throw new Error('slice markers missing: ' + from + ' .. ' + to);
  return src.slice(a, b);
}

const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const mtSrc = fs.readFileSync(path.join(ROOT, 'modules', 'maintenance.js'), 'utf8');
const region = slice(appSrc, 'function parseOdometerReading', '/* ODO-MASTER-END */');
const gateBlock = slice(appSrc, 'function odoMasterNow', 'function onbWirePhoto');

/* ==================================================================
   A. app.js — legs never move the master; captures land exactly
   ================================================================== */
console.log('\n— A: master odometer vs legs and captures —');
{
  const data = {};
  const store = {
    get(k, d) { const v = data['mt_' + k]; return v === undefined ? d : JSON.parse(v); },
    set(k, v) { data['mt_' + k] = JSON.stringify(v); return true; },
    del(k) { delete data['mt_' + k]; return true; }
  };
  const sb = { console, store };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(region + '\n' + gateBlock + '\n' +
    'this.__x = { masterOdometer, bumpOdometer, odoSaveDecision, odoImplausible };', sb);
  const X = sb.__x;

  /* The truck's true reading the morning the poison was found. */
  store.set('mt_odo', '168510');
  eq('A1 master starts at the true reading', X.masterOdometer(), 168510);

  /* A dash capture later that day: +430 km, inside the gate — the
     master becomes the capture value EXACTLY. */
  const cap = X.bumpOdometer(168940);
  eq('A2 dash capture accepted', cap.raised, true);
  eq('A3 master equals the capture exactly', X.masterOdometer(), 168940);

  /* GPS legs accumulate all day in Live Miles' own store keys; the
     only way a leg total could reach the master is as a single
     reading — and a reading 350,816 km past the master is a jump,
     refused outright. The master does not move. */
  const legSum = X.bumpOdometer(168940 + 350816);
  eq('A4 leg-sum-sized write refused as a jump', legSum.refused, 'jump');
  eq('A5 master unmoved by the leg sum', X.masterOdometer(), 168940);

  /* Ordinary writes stay upward-only: a lower value can never be
     written through the normal path, armed or not — the bump only
     ever ratchets. */
  const down = X.bumpOdometer(168000);
  eq('A6 ordinary downward bump not raised', down.raised, false);
  eq('A7 master still exact after downward attempt', X.masterOdometer(), 168940);
  eq('A8 unarmed save decision keeps master on a lower value',
    X.odoSaveDecision(168000, 168940, false).action, 'keep');
  eq('A9 unarmed save decision refuses a jump',
    X.odoSaveDecision(519326, 168940, false).action, 'keep');

  /* The correction decision — armed, the supervised door — is the
     one path allowed to set a LOWER value (the poisoned-master
     case: 519,326 stored, 168,940 on the dash). */
  const corr = X.odoSaveDecision(168940, 519326, true);
  eq('A10 armed correction of a poisoned master', corr.action, 'correct');
  eq('A11 correction value is the dash value', corr.value, 168940);
}

/* ==================================================================
   B. Writer census — every mt_odo write is a gated capture
   ================================================================== */
console.log('\n— B: mt_odo writer census —');
{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const count = (src, needle) => src.split(needle).length - 1;

  /* The leg engines never even name the master key. */
  ['js/miles.js', 'js/geoloads.js', 'js/shifttrack.js', 'js/geo.js', 'js/yardstart.js']
    .forEach(function (p) {
      eq('B ' + p + ' never references mt_odo', count(read(p), 'mt_odo'), 0);
    });

  /* app.js: exactly two direct writes — bumpOdometer's body and the
     onboarding supervised-decision site. */
  eq('B app.js bump-body mt_odo write', count(appSrc, "store.set('mt_odo', String(n))"), 1);
  eq('B app.js onboarding mt_odo write', count(appSrc, "_store.set('mt_odo'"), 1);
  ok('B app.js onboarding write is the decision value',
    appSrc.indexOf("_store.set('mt_odo', String(obDec.value))") >= 0);

  /* fuel.js: exactly two writes, both behind the armed 'correct'
     mode of the supervised decision. */
  const fuelSrc = read('modules/fuel.js');
  eq('B fuel.js mt_odo writes', count(fuelSrc, "_store.set('mt_odo'"), 2);
  ok('B fuel.js writes are correct-mode only',
    count(fuelSrc, "odoPlan.mode === 'correct'") >= 2);

  /* preferences.js: one write, the decision value. */
  const pfSrc = read('modules/preferences.js');
  eq('B preferences.js mt_odo writes', count(pfSrc, "_store.set('mt_odo'"), 1);
  ok('B preferences.js write is the decision value',
    pfSrc.indexOf("_store.set('mt_odo', String(dec.value))") >= 0);

  /* maintenance.js: every W('odo', ...) write is a decision value —
     the v86 Save and the v97 correction flow, nothing else. */
  const wWrites = mtSrc.match(/W\('odo', [^)]*\)/g) || [];
  ok('B maintenance has master writes', wWrites.length >= 2, wWrites.join(' | '));
  ok('B every maintenance master write is a decision value',
    wWrites.every(function (w) { return w === "W('odo', dec.value)"; }), wWrites.join(' | '));
}

/* ==================================================================
   C. maintenance.js — the owner's screen, then the correction
   ================================================================== */
console.log('\n— C: maintenance odometer math + correction flow —');
{
  const TODAY = '2026-10-16';
  const mem = {
    /* The poisoned master, exactly as found live. */
    'mt_odo': '519326',
    /* The fills behind the screen: a true 168,510 fill, the poisoned
       Oct 15 fill (receipt invoice number saved as its odometer),
       and a true 168,759 fill. */
    'fuel_fills': [
      { date: '2026-10-14', litres: '50', cost: '100.00', odo: 168510 },
      { date: '2026-10-15', litres: '78.175', cost: '193.80', odo: 519326 },
      { date: '2026-10-15', litres: '60', cost: '120.00', odo: 168759 }
    ],
    /* The windshield sticker target the countdown must honour. */
    'mt_nextServiceOdo': 175429,
    'mt_events': []
  };
  const store = {
    get(k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set(k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del(k) { delete mem[k]; return true; }
  };
  const App = {
    _store: store,
    _today: function () { return TODAY; },
    _esc: function (s) { return String(s == null ? '' : s); }
  };
  const sb = { console, store, App };
  sb.window = sb;
  vm.createContext(sb);
  /* The REAL gate functions from app.js; in the shipped file the
     App._ exports are attached at the App assembly (app.js ~2822),
     outside the gate slice — replay those exact assignments here. */
  vm.runInContext(region + '\n' + gateBlock + '\n' +
    'App._masterOdometer = masterOdometer; App._bumpOdometer = bumpOdometer;' +
    'App._odoImplausible = odoImplausible; App._odoSaveDecision = odoSaveDecision;', sb);
  vm.runInContext(mtSrc, sb);
  const api = sb.Meticulous.modules.maintenance;

  /* The owner's screen, reproduced from the field data.
     v107 PIN MOVE (Stage 3, economy sanity): C1/C2 pinned the v97
     poisoned totals (350,816 km / 2 legs — the impossible leg
     counted). The delta guard now excludes the poisoned leg from
     the math even before any correction, so the poisoned screen
     already shows the TRUE leg (249 km / 1 leg); the poisoned
     stamp still drives the displayed odometer + overdue state
     (C3–C5), which is what the correction flow exists to fix. */
  const before = api._mileageStats();
  eq('C1 poisoned screen: tracked km (poisoned leg excluded)', Math.round(before.kmTracked), 249);
  eq('C2 poisoned screen: legs (real legs only)', before.legs, 1);
  const dueBefore = api._dueItems();
  eq('C3 poisoned screen: displayed odometer', dueBefore.odo, 519326);
  const oilBefore = dueBefore.items.filter(function (i) { return i.id === 'oil'; })[0];
  eq('C4 poisoned screen: oil overdue', oilBefore.overdue, true);
  eq('C5 poisoned screen: oil remaining', Math.round(oilBefore.remaining), -343897);

  /* The correction: owner photographs the dash — 168,940 km. */
  const res = api._applyOdoCorrection(168940, 'dash photo');
  eq('C6 correction action', res.action, 'correct');
  eq('C7 correction previous value', res.previous, 519326);
  eq('C8 master is now the dash value exactly', mem['mt_odo'], '168940');
  ok('C9 correction was audit-logged', !!res.logged);
  eq('C10 audit entry type', res.logged && res.logged.type, 'odocorr');
  eq('C11 audit entry date', res.logged && res.logged.date, TODAY);
  eq('C12 audit entry odometer is the new value', res.logged && res.logged.odo, 168940);
  ok('C13 audit notes name old and new values',
    !!res.logged && res.logged.notes.indexOf('519,326') >= 0 && res.logged.notes.indexOf('168,940') >= 0,
    res.logged && res.logged.notes);
  const corrEntries = (mem['mt_events'] || []).filter(function (e) { return e.type === 'odocorr'; });
  eq('C14 exactly one audit entry in the history', corrEntries.length, 1);

  /* After the correction the poisoned fill is 'jump' data and drops
     out of the odometer math entirely. */
  const after = api._mileageStats();
  eq('C15 fixed screen: tracked km is the true leg only', Math.round(after.kmTracked), 249);
  eq('C16 fixed screen: legs', after.legs, 1);
  eq('C17 fixed screen: current odometer', api._currentOdo(), 168940);
  const dueAfter = api._dueItems();
  eq('C18 fixed screen: displayed odometer', dueAfter.odo, 168940);
  const oilAfter = dueAfter.items.filter(function (i) { return i.id === 'oil'; })[0];
  eq('C19 fixed screen: oil no longer overdue', oilAfter.overdue, false);
  eq('C20 fixed screen: oil remaining = sticker truth', Math.round(oilAfter.remaining), 6489);

  /* The same correction again (same value) is a plain save — no
     second audit entry, master untouched. */
  const again = api._applyOdoCorrection(168940, 'dash photo');
  eq('C21 repeat correction is not logged twice', again.logged, null);
  eq('C22 master unchanged by repeat', mem['mt_odo'], '168940');
  eq('C23 still exactly one audit entry',
    (mem['mt_events'] || []).filter(function (e) { return e.type === 'odocorr'; }).length, 1);

  /* Garbage can never become a correction. */
  const bad = api._applyOdoCorrection('not-a-number', 'dash photo');
  eq('C24 garbage correction ignored', bad.action, 'ignore');
  eq('C25 master unchanged by garbage', mem['mt_odo'], '168940');

  /* A normal upward reading through the correction flow still works
     and is logged as the change it is. */
  const up = api._applyOdoCorrection(170100, 'dash photo');
  eq('C26 upward correction sets the master', mem['mt_odo'], '170100');
  eq('C27 upward change logged once more',
    (mem['mt_events'] || []).filter(function (e) { return e.type === 'odocorr'; }).length, 2);
}

/* ==================================================================
   D. Correction card statics
   ================================================================== */
console.log('\n— D: correction card markup and wiring —');
{
  ok('D1 card is clearly marked', mtSrc.indexOf('Correct odometer from dash photo') >= 0);
  ['mt_fix', 'mt_fix_save', 'mt_fix_cam', 'mt_fix_pick', 'mt_fix_cam_in', 'mt_fix_in', 'mt_fix_status']
    .forEach(function (id) {
      ok('D correction element #' + id, mtSrc.indexOf('id="' + id + '"') >= 0);
    });
  ok('D2 camera input carries capture=environment',
    /id="mt_fix_cam_in"[^>]*capture="environment"/.test(mtSrc));
  ok('D3 photo wiring is fill-only via the shared pipeline',
    mtSrc.indexOf("App._wirePhotoOCR('mt_fix', 'odometer', function () {}") >= 0);
  ok('D4 save runs applyOdoCorrection',
    mtSrc.indexOf("applyOdoCorrection(fv, 'dash photo')") >= 0);
  ok('D5 history labels the audit type',
    mtSrc.indexOf("name: 'Odometer correction'") >= 0);
  ok('D6 correction region markers present',
    mtSrc.indexOf('ODO-CORRECTION-BEGIN') >= 0 && mtSrc.indexOf('ODO-CORRECTION-END') >= 0);
}

console.log('\nodo-correction test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
