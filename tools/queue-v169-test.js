#!/usr/bin/env node
/* Meticulous v169 — "PTI LOCATION — COULDN'T GET A FIX" suite.
 *
 * The owner's report, Oct 19, 2026 06:52 MDT, from his first
 * real PTI filing: the form's "Use my location" failed indoors
 * at home and fell back to typing — while his phone itself held
 * a good position. The geo layer (js/geo.js getCurrent) was
 * native-plugin-only and rejected on the first error. It is now
 * layered (fresh cache → plugin → one retry → coarse browser
 * geolocation → last-known marked stale) and RESOLVES
 * (fix | stale | null) instead of dead-ending — every one-tap
 * location in the app (PTI, Where I park, yard start) rides it,
 * and location never blocks the work it decorates.
 *
 * Run: node tools/queue-v169-test.js
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

const HOME = { latitude: 51.15709, longitude: -113.93862, accuracy: 12, time: Date.now() };

function makeWorld(opts) {
  opts = opts || {};
  const storage = {};
  if (opts.lastFix) storage['mt_geo_last'] = JSON.stringify(opts.lastFix);
  const calls = { addWatcher: 0, removeWatcher: 0, w3c: 0 };
  const sb = {
    console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Promise: Promise,
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; }
    },
    navigator: {}
  };
  sb.window = sb;
  if (opts.plugin !== 'absent') {
    let attempt = 0;
    sb.Capacitor = { Plugins: { BackgroundGeolocation: {
      addWatcher: function (o, cb) {
        calls.addWatcher++;
        attempt++;
        const my = attempt;
        setTimeout(() => {
          if (opts.plugin === 'error-then-fix' && my === 1) cb(null, new Error('cold radio'));
          else if (opts.plugin === 'always-error') cb(null, new Error('no fix'));
          else cb({ latitude: HOME.latitude, longitude: HOME.longitude, accuracy: 8, time: Date.now() }, null);
        }, 5);
        return Promise.resolve('w' + my);
      },
      removeWatcher: function () { calls.removeWatcher++; return Promise.resolve(); }
    } } };
    sb.window.Capacitor = sb.Capacitor;
  }
  if (opts.w3c === 'fix') {
    sb.navigator.geolocation = { getCurrentPosition: function (good) {
      calls.w3c++;
      setTimeout(() => good({ coords: { latitude: HOME.latitude, longitude: HOME.longitude, accuracy: 900, altitude: null, speed: null, heading: null }, timestamp: Date.now() }), 5);
    } };
  } else if (opts.w3c === 'error') {
    sb.navigator.geolocation = { getCurrentPosition: function (good, bad) {
      calls.w3c++;
      setTimeout(() => bad(new Error('denied')), 5);
    } };
  }
  vm.createContext(sb);
  vm.runInContext(read('js/geo.js'), sb);
  return { geo: sb.MeticulousGeo, calls: calls };
}

(async function () {
  {
    const w = makeWorld({ plugin: 'error-then-fix', w3c: 'error' });
    const fix = await w.geo.getCurrent(2000);
    ok('A1 a first plugin error is retried, not fatal', !!fix && Math.abs(fix.latitude - HOME.latitude) < 1e-9);
    eq('A2 the retry used a second watcher', w.calls.addWatcher, 2);
  }
  {
    const w = makeWorld({ plugin: 'absent', w3c: 'fix' });
    const fix = await w.geo.getCurrent(2000);
    ok('A3 the web copy (no plugin) gets the coarse browser fix',
      !!fix && Math.abs(fix.latitude - HOME.latitude) < 1e-9 && fix.accuracy === 900);
    eq('A4 the coarse door was actually used', w.calls.w3c, 1);
  }
  {
    const old = { latitude: HOME.latitude, longitude: HOME.longitude, accuracy: 20, time: Date.now() - 3600e3 };
    const w = makeWorld({ plugin: 'always-error', w3c: 'error', lastFix: old });
    const fix = await w.geo.getCurrent(300);
    ok('A5 when every live door fails, the last-known fix answers — marked stale',
      !!fix && fix.stale === true && Math.abs(fix.latitude - HOME.latitude) < 1e-9);
  }
  {
    const w = makeWorld({ plugin: 'absent', w3c: 'error' });
    let rejected = false;
    const fix = await w.geo.getCurrent(300).catch(() => { rejected = true; return 'X'; });
    eq('A6 with nothing anywhere it RESOLVES null (never rejects, never blocks)', [fix, rejected], [null, false]);
  }
  {
    const freshFix = { latitude: HOME.latitude, longitude: HOME.longitude, accuracy: 10, time: Date.now() - 60e3 };
    const w = makeWorld({ plugin: 'always-error', w3c: 'error', lastFix: freshFix });
    const fix = await w.geo.getCurrent(300);
    ok('A7 a fresh cached fix answers instantly, marked fresh',
      !!fix && !fix.stale && Math.abs(fix.latitude - HOME.latitude) < 1e-9);
    eq('A8 and no watcher was even opened', w.calls.addWatcher, 0);
  }
  {
    const w = makeWorld({ plugin: 'fix' });
    const fix = await w.geo.getCurrent(2000);
    ok('A9 the happy path still lands the plugin fix', !!fix && Math.abs(fix.longitude - HOME.longitude) < 1e-9);
    ok('A10 the one-shot watcher is removed after the fix', w.calls.removeWatcher >= 1);
  }
  const ptiSrc = read('modules/pti.js');
  ok('A11 the PTI form labels a last-known fix as one',
    ptiSrc.indexOf('Last known position: ') !== -1);
  ok('A12 filing never waits on location (the form validates the odometer + checklist only)',
    ptiSrc.indexOf('function validateDraft') !== -1 &&
    ptiSrc.slice(ptiSrc.indexOf('function validateDraft'), ptiSrc.indexOf('function validateDraft') + 900).indexOf('lat') === -1);

  console.log('\nqueue-v169 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR: ' + (e && e.stack || e)); process.exit(1); });
