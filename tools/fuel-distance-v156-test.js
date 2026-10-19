#!/usr/bin/env node
/* Meticulous v156 — FUEL DISTANCE TRUTH suite.
 *
 * The owner's catch, Oct 17, 2026 22:29–22:34 MDT, over his own
 * Maintenance screen: "Since May or June when I started reporting
 * fuel for this truck, I think this truck has had over 10,000
 * km's… What's leg suppose to be?" / "I asked for lifetime" /
 * "System has its lifetime km's… what does it matter if you don't
 * have Odos on [the fills]?"
 *
 * THE DEFECT: the Maintenance Lifetime block computed distance as
 * the sum of LEGS between fill-ups that both carry odometer
 * stamps. Only 2 of his 56 fill-ups (records from 2026-06-25)
 * carry stamps, so it printed "Lifetime distance 790 km" and
 * "Lifetime economy 5.0 km/L" — a fragment wearing the word
 * Lifetime, and an economy flat false for his truck (audited
 * long-run: 2.93 km/L). His law: lifetime distance comes from
 * the SYSTEM's own odometer bookends — the current master minus
 * the earliest dated reading in odo_readings — not from per-fill
 * stamps. (Per-fill stamps still matter, for the leg-by-leg
 * economy — the diesel watch — not for the lifetime figure.)
 *
 * THE SPAN RULE (stated): lifetime economy = bookend distance ÷
 * the litres of fill-ups dated ON OR AFTER the earliest reading's
 * date — the window the distance covers (a dated reading opens
 * its day). When the earliest reading predates the first fill,
 * the window is the whole record: the true lifetime economy.
 * Partial coverage is NAMED on the face (the from-date), never
 * hidden; with no dated reading at all, no lifetime number
 * prints — the honest state instead of the leg fragment.
 *
 * Pins:
 *  (a) the owner's shape: lifetime distance = 3,169 km
 *      (169,300 master − 166,131 @ 2026-10-01), NOT 790; its
 *      from-date stated on the face;
 *  (b) lifetime economy = 3,169 ÷ window litres (fills dated
 *      >= 2026-10-01), never the 5.0-from-2-legs figure; the leg
 *      figures survive ONLY on their own labelled legs line;
 *  (c) no dated readings → no lifetime number, honest state;
 *  (d) earliest reading predating the fuel window → full-window
 *      distance and the true lifetime economy;
 *  (e) a new fill saved odo-less is stamped with the master; a
 *      fill with its own (photo/typed) reading keeps it; a
 *      REFUSED jump still saves with NO reading (the v86
 *      contract); no master → no stamp invented;
 *  (f) fuel totals ($ and L) byte-identical to the old math;
 *  (g) adding an earlier past reading through the REAL
 *      App._logOdoReading extends the figure on re-render.
 *
 * Worlds drive the REAL js/app.js ODO/ECON slice + the REAL
 * modules/fuel.js + modules/maintenance.js (capture-v127 harness
 * pattern). Run: node tools/fuel-distance-v156-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const fuelSrc = fs.readFileSync(path.join(ROOT, 'modules', 'fuel.js'), 'utf8');
const mtSrc = fs.readFileSync(path.join(ROOT, 'modules', 'maintenance.js'), 'utf8');
const ocrSrc = fs.readFileSync(path.join(ROOT, 'js', 'ticket-ocr.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function near(name, got, want, eps) {
  ok(name, Math.abs(got - want) < (eps || 1e-9), 'got ' + got + ', want ~' + want);
}

/* ---------------- the app.js slice (same as capture-v127) ---------------- */
const sliceStart = appSrc.indexOf('var _onbOcrToken');
const sliceEnd = appSrc.indexOf('function collectOnbInputs');
if (sliceStart < 0 || sliceEnd < 0 || sliceEnd <= sliceStart) {
  console.log('FAIL could not slice the app.js region'); process.exit(1);
}
const appSlice = appSrc.slice(sliceStart, sliceEnd);

/* ---------------- raw store (real app semantics: JSON deep copies) ---------------- */
function makeStore(limit) {
  const mem = {};
  return {
    _mem: mem,
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) {
      const s = JSON.stringify(v);
      if (limit && s.length > limit) return false;
      mem[k] = JSON.parse(s); return true;
    },
    del: function (k) { delete mem[k]; return true; }
  };
}
const escFn = function (s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};
function FileReader() {}
FileReader.prototype.readAsDataURL = function () {
  this.result = 'data:image/jpeg;base64,RAWPHOTO';
  if (this.onload) this.onload();
};

/* ---------------- fake body (capture-v127 pattern) ---------------- */
function makeBody() {
  const stubs = {};
  function mkStub() {
    return {
      value: '', innerHTML: '', textContent: '', style: {}, checked: false,
      onclick: null, onchange: null, _attrs: {},
      setAttribute: function (k, v) { this._attrs[k] = String(v); },
      getAttribute: function (k) { return (k in this._attrs) ? this._attrs[k] : null; },
      addEventListener: function () {},
      click: function () { if (this.onclick) this.onclick({ target: this }); }
    };
  }
  function stub(sel) { return stubs[sel] || (stubs[sel] = mkStub()); }
  const body = { _html: '', _rows: [] };
  Object.defineProperty(body, 'innerHTML', {
    get: function () { return this._html; },
    set: function (v) {
      this._html = String(v);
      Object.keys(stubs).forEach(function (k) {
        const s = stubs[k];
        s.value = ''; s.innerHTML = ''; s.textContent = ''; s._attrs = {}; s.onclick = null; s.onchange = null; s.checked = false;
      });
      const tagRe = /<[^>]*\bid="([^"]+)"[^>]*>/g; let m;
      while ((m = tagRe.exec(this._html))) {
        const vm2 = /\bvalue="([^"]*)"/.exec(m[0]);
        if (vm2) stub('#' + m[1]).value = vm2[1];
      }
      this._rows = [];
      const rowRe = /data-fuedit="(\d+)"/g;
      while ((m = rowRe.exec(this._html))) {
        const idx = m[1];
        this._rows.push({ _idx: idx, onclick: null, getAttribute: function (n) { return n === 'data-fuedit' ? idx : null; } });
      }
    }
  });
  body.querySelector = function (sel) { return stub(sel); };
  body.querySelectorAll = function (sel) { return sel === '[data-fuedit]' ? body._rows : []; };
  return body;
}

function makeModuleWorld(opts) {
  opts = opts || {};
  const store = makeStore(opts.storeLimit || 0);
  (opts.seed || []).forEach(function (kv) { store.set(kv[0], kv[1]); });
  const wireCalls = [];
  const sandbox = {
    console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Promise: Promise,
    store: store,
    FileReader: FileReader,
    document: { createElement: function () { return { style: {} }; }, getElementById: function () { return null; } },
    App: {
      _store: store, _esc: escFn, _today: function () { return '2026-10-17'; },
      onb: {}, tracker: { status: 'idle', startTs: 0, elapsed: 0 },
      _wirePhotoOCR: function () { wireCalls.push([].slice.call(arguments)); }
    },
    Meticulous: { modules: {} }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(appSlice, sandbox);
  sandbox.App._logOdoReading = sandbox.logOdoReading;
  sandbox.App._seedOdoReadings = sandbox.seedOdoReadings;
  sandbox.App._masterOdometer = sandbox.masterOdometer;
  sandbox.App._bumpOdometer = sandbox.bumpOdometer;
  sandbox.App._odoSaveDecision = sandbox.odoSaveDecision;
  sandbox.App._odoImplausible = sandbox.odoImplausible;
  sandbox.App._parseOdometerReading = sandbox.parseOdometerReading;
  sandbox.App._econUnit = sandbox.econUnit;
  sandbox.App._econConvert = sandbox.econConvert;
  sandbox.App._econFormat = sandbox.econFormat;
  vm.runInContext(ocrSrc, sandbox);
  if (opts.fuel) vm.runInContext(fuelSrc, sandbox);
  if (opts.maint) vm.runInContext(mtSrc, sandbox);
  return { sandbox: sandbox, store: store, wireCalls: wireCalls, body: makeBody() };
}

/* ---------------- the owner's shape ----------------
 * 56 fill-ups, 2026-06-25 → 2026-10-17. Litres total 4,557.4,
 * cost total $10,114.52. Fills dated >= 2026-10-01 carry exactly
 * 1,157.4 L (the window the Oct 1 reading opens). Only TWO fills
 * carry odometer stamps — 168,000 (2026-09-20) and 168,790
 * (2026-10-10, 158 L) — so the OLD leg math reads 790 km and
 * 790/158 = 5.0 km/L. */
function ownerFills() {
  const fills = [];
  const day = function (y, m, d) {
    return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
  };
  /* 40 pre-October fills: Jun 25 → Sep 30, 85 L each = 3,400 L */
  let t = Date.UTC(2026, 5, 25);
  for (let i = 0; i < 40; i++) {
    const dt = new Date(t);
    fills.push({ date: day(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()), litres: 85, cost: 180, station: 'Petro-Pass' });
    t += 2 * 86400000 + 3600000; /* ~2 days apart, drifts within the window */
    if (t > Date.UTC(2026, 8, 30)) t = Date.UTC(2026, 8, 30);
  }
  /* force the pre-October span exact: first Jun 25, one stamped Sep 20 */
  fills[0].date = '2026-06-25';
  fills[39].date = '2026-09-30';
  const stampedPre = fills.filter(function (f) { return f.date === '2026-09-20'; })[0] || fills[35];
  stampedPre.date = '2026-09-20'; stampedPre.odo = 168000;
  /* 16 October fills: Oct 1 → Oct 17, litres summing to 1,157.4 */
  const octLitres = [72, 72, 72, 72, 72, 72, 72, 72, 72, 158, 72, 72, 72, 72, 31.7, 31.7];
  for (let i = 0; i < 16; i++) {
    fills.push({ date: day(2026, 10, 1 + i), litres: octLitres[i], cost: 180, station: 'Petro-Pass' });
  }
  fills[40].date = '2026-10-01';
  fills[55].date = '2026-10-17';
  const stampedOct = fills[49]; /* 2026-10-10 */
  stampedOct.date = '2026-10-10'; stampedOct.odo = 168790;
  /* cost: 55 × $180 + $214.52 on the last = $10,114.52 */
  fills[55].cost = 214.52;
  return fills;
}
const READING_OCT1 = [{ ts: new Date(2026, 9, 1, 8).getTime(), date: '2026-10-01', value: 166131, source: 'past' }];

function ownerWorld(readings) {
  const seed = [['mt_odo', '169300'], ['fuel_fills', ownerFills()]];
  if (readings) seed.push(['odo_readings', JSON.parse(JSON.stringify(readings))]);
  return makeModuleWorld({ maint: true, fuel: true, seed: seed });
}

/* ============ (a)+(b)+(f) THE OWNER'S SHAPE ============ */
console.log('\n— (a) lifetime distance = the bookends, not the leg fragment —');
{
  const w = ownerWorld(READING_OCT1);
  const M = w.sandbox.Meticulous.modules.maintenance;
  const ms = M._mileageStats();
  eq('the leg math still sees the fragment (2 stamped fills, 1 leg)', ms.legs, 1);
  eq('…790 km of legs, the old "lifetime" number', Math.round(ms.kmTracked), 790);
  near('…at the false 5.0 km/L', ms.avgKpl, 5.0, 1e-9);

  ok('the module exposes the lifetime derivation', typeof M._lifetimeStats === 'function');
  const lt = M._lifetimeStats();
  eq('lifetime is a true bookend figure', lt.ok, true);
  eq('lifetime distance = master − earliest reading (169,300 − 166,131)', Math.round(lt.distance), 3169);
  eq('the span opens at the earliest reading', lt.fromDate, '2026-10-01');
  eq('partial coverage is flagged (fuel records begin Jun 25)', lt.fullCoverage, false);
  near('(b) window litres = fills dated on/after the reading', lt.windowLitres, 1157.4, 1e-6);
  near('(b) lifetime economy = distance ÷ window litres', lt.economy, 3169 / 1157.4, 1e-9);
  ok('(b) …and never the 5.0-from-2-legs figure', Math.abs(lt.economy - 5.0) > 0.5, 'economy ' + lt.economy);

  near('(f) lifetime fuel counts EVERY fill-up', ms.totalLitres, 4557.4, 1e-6);
  near('(f) total fuel spend is untouched', ms.totalFuelCost, 10114.52, 1e-6);
  eq('(f) fill count', ms.fillCount, 56);

  M.render(w.body);
  const h = w.body._html;
  const ltAt = h.indexOf('Lifetime distance');
  ok('the face shows Lifetime distance', ltAt >= 0);
  ok('…as 3,169 km', h.slice(ltAt, ltAt + 120).indexOf('3,169 km') >= 0, h.slice(ltAt, ltAt + 120));
  ok('…never as the 790 fragment', h.slice(ltAt, ltAt + 120).indexOf('790') < 0, h.slice(ltAt, ltAt + 120));
  ok('Lifetime fuel prints every litre', h.indexOf('Lifetime fuel') >= 0 && h.indexOf('4557.4 L') >= 0);
  ok('Total fuel spend prints untouched', h.indexOf('$10,114.52') >= 0 || h.indexOf('$10114.52') >= 0);
  const leAt = h.indexOf('Lifetime economy');
  ok('Lifetime economy is the bookend economy (2.7 km/L)', leAt >= 0 && h.slice(leAt, leAt + 120).indexOf('2.7 km/L') >= 0, h.slice(leAt, leAt + 120));
  /* v163 SUPERSEDES the v156 legs-line pins: the owner ordered
     the "Between fill-ups (legs)" line DELETED outright (Oct 18,
     2026 20:56 MDT) — the leg fragment (790 km, the false 5.0)
     now appears NOWHERE on the Maintenance face. */
  ok('v163: the legs line is deleted — the 790 fragment appears nowhere',
    h.indexOf('(legs)') < 0 && h.indexOf('790 km') < 0 && h.indexOf('5.0 km/L') < 0,
    'legs at ' + h.indexOf('(legs)') + ', 790 at ' + h.indexOf('790 km'));
  ok('the footer names the partial span (readings start 2026-10-01)', h.indexOf('readings start 2026-10-01') >= 0, h.slice(h.indexOf('Lifetime —'), h.indexOf('Lifetime —') + 400));
  ok('the footer keeps the records span (2026-06-25 → 2026-10-17, 56 fill-ups)',
    h.indexOf('2026-06-25 → 2026-10-17') >= 0 && h.indexOf('56 fill-ups') >= 0);
}

/* ============ (c) NO DATED READINGS ============ */
console.log('\n— (c) no dated readings → no lifetime number —');
{
  const w = ownerWorld(null);
  const M = w.sandbox.Meticulous.modules.maintenance;
  const lt = M._lifetimeStats();
  eq('no bookend figure exists', lt.ok, false);
  M.render(w.body);
  const h = w.body._html;
  const ltAt = h.indexOf('Lifetime distance');
  ok('Lifetime distance prints no number', ltAt >= 0 && h.slice(ltAt, ltAt + 120).indexOf('790') < 0 && h.slice(ltAt, ltAt + 120).indexOf('3,169') < 0, h.slice(ltAt, ltAt + 120));
  ok('Lifetime economy does not print at all', h.indexOf('Lifetime economy') < 0);
  ok('the honest state is said out loud', h.indexOf('none are on record yet') >= 0, h.slice(h.indexOf('Lifetime —'), h.indexOf('Lifetime —') + 400));
  ok('v163: no legs line here either — deleted, not fixed', h.indexOf('(legs)') < 0 && h.indexOf('790 km') < 0);
}

/* ============ (d) READING PREDATES THE FUEL WINDOW ============ */
console.log('\n— (d) earliest reading before the first fill → the whole record —');
{
  const readings = [{ ts: new Date(2026, 5, 20, 8).getTime(), date: '2026-06-20', value: 155900, source: 'past' }];
  const w = ownerWorld(readings);
  const M = w.sandbox.Meticulous.modules.maintenance;
  const lt = M._lifetimeStats();
  eq('full coverage', lt.fullCoverage, true);
  eq('distance spans the whole record (169,300 − 155,900)', Math.round(lt.distance), 13400);
  near('window litres = EVERY fill-up', lt.windowLitres, 4557.4, 1e-6);
  near('economy = the true lifetime economy (~his audited 2.93)', lt.economy, 13400 / 4557.4, 1e-9);
  M.render(w.body);
  const h = w.body._html;
  ok('the face prints 13,400 km', h.indexOf('13,400 km') >= 0);
  ok('the footer carries no partial-coverage hedge', h.indexOf('readings start') < 0);
}

/* ============ (g) A LATER PAST READING EXTENDS THE FIGURE ============ */
console.log('\n— (g) the past-reading door extends the lifetime figure live —');
{
  const w = ownerWorld(READING_OCT1);
  const M = w.sandbox.Meticulous.modules.maintenance;
  eq('before: the Oct 1 bookend', Math.round(M._lifetimeStats().distance), 3169);
  const added = w.sandbox.App._logOdoReading(155900, 'past', new Date(2026, 5, 20, 12).getTime(), true);
  eq('the past reading lands through the audited door', added, true);
  const lt = M._lifetimeStats();
  eq('after: the figure reaches back to Jun 20', Math.round(lt.distance), 13400);
  eq('…and coverage is now full', lt.fullCoverage, true);
  const stored = w.store.get('fuel_fills', []);
  eq('no existing fill was rewritten', stored.length, 56);
  ok('…the stamped fills kept their stamps', stored.filter(function (f) { return f.odo; }).length === 2);
}

/* ============ (e) THE AUTO-STAMP ============ */
console.log('\n— (e) a new fill never lands odo-less again —');
{
  /* odo-less save, master present → stamped */
  const w = makeModuleWorld({ fuel: true, seed: [['mt_odo', '169300']] });
  const F = w.sandbox.Meticulous.modules.fuel;
  F.render(w.body);
  w.body.querySelector('#fu_l').value = '50';
  w.body.querySelector('#fu_cost').value = '120';
  w.body.querySelector('#fu_add').click();
  const saved = w.store.get('fuel_fills', []);
  eq('the fill saved', saved.length, 1);
  eq('…stamped with the current master', saved[0] && saved[0].odo, 169300);
}
{
  /* a reading of its own (the photo/typed flow) wins */
  const w = makeModuleWorld({ fuel: true, seed: [['mt_odo', '169300']] });
  const F = w.sandbox.Meticulous.modules.fuel;
  F.render(w.body);
  w.body.querySelector('#fu_l').value = '50';
  w.body.querySelector('#fu_cost').value = '120';
  w.body.querySelector('#fu_odo').value = '169211';
  w.body.querySelector('#fu_add').click();
  const saved = w.store.get('fuel_fills', []);
  eq('its own reading is kept, not the master stamp', saved[0] && saved[0].odo, 169211);
}
{
  /* the v86 refusal contract survives: a refused jump saves with NO reading */
  const w = makeModuleWorld({ fuel: true, seed: [['mt_odo', '168759']] });
  const F = w.sandbox.Meticulous.modules.fuel;
  F.render(w.body);
  w.body.querySelector('#fu_l').value = '78.175';
  w.body.querySelector('#fu_cost').value = '193.80';
  w.body.querySelector('#fu_odo').value = '519326';
  w.body.querySelector('#fu_add').click();
  const saved = w.store.get('fuel_fills', []);
  eq('the refused fill still saved', saved.length, 1);
  eq('…with NO odometer reading (not even a stamp)', saved[0] && saved[0].odo, undefined);
  eq('…and the master was not poisoned', w.store.get('mt_odo'), '168759');
}
{
  /* no master anywhere → no stamp invented */
  const w = makeModuleWorld({ fuel: true, seed: [] });
  const F = w.sandbox.Meticulous.modules.fuel;
  F.render(w.body);
  w.body.querySelector('#fu_l').value = '50';
  w.body.querySelector('#fu_cost').value = '120';
  w.body.querySelector('#fu_add').click();
  const saved = w.store.get('fuel_fills', []);
  eq('the fill saved', saved.length, 1);
  eq('…odo-less, because there is no reading to stamp', saved[0] && saved[0].odo, undefined);
}

console.log('\nfuel-distance-v156-test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
