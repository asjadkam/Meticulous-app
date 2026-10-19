#!/usr/bin/env node
/* Meticulous v166 — PULL-TO-REFRESH BRINGS THE VERSION suite.
 *
 * The owner's catch, Oct 18, 2026 18:55 MDT: he pulled to
 * refresh and the app repainted its data but stayed on the old
 * code — v162's PTI card only arrived after a full restart
 * ("just got it after restart"). The pull now runs a VERSION
 * LEG after the data settle (js/app.js, PTR region):
 *   - the installed app: OTA.checkNow() downloads a newer
 *     bundle and OTA.restart() steps into it;
 *   - the web/PWA copy: the service worker is asked for an
 *     update and a waiting worker is activated + reloaded into;
 *   - never over unsaved typing (the v145 PTR contract): a
 *     downloaded update that can't apply yet lands next launch.
 * This suite drives the REAL PTR region extracted from js/app.js
 * (the pull-refresh-v145 harness pattern) with fake OTA / SW.
 *
 * Run: node tools/queue-v166-test.js
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function extractRegion(src, beginMark, endMark) {
  const bi = src.indexOf(beginMark), ei = src.indexOf(endMark);
  if (bi === -1 || ei === -1) throw new Error('region markers missing: ' + beginMark);
  return src.slice(src.lastIndexOf('/*', bi), src.indexOf('*/', ei) + 2);
}
function fakeEl(id) {
  const e = {
    id: id || '', children: [], style: {}, textContent: '', innerHTML: '',
    _cls: new Set(),
    appendChild(c) { this.children.push(c); return c; }
  };
  e.classList = {
    add: (c) => e._cls.add(c),
    remove: (c) => e._cls.delete(c),
    contains: (c) => e._cls.has(c),
    toggle: (c, f) => { if (f === undefined) f = !e._cls.has(c); f ? e._cls.add(c) : e._cls.delete(c); }
  };
  return e;
}

function makeWorld(opts) {
  opts = opts || {};
  const els = {};
  const listeners = {};
  const doc = {
    body: fakeEl('body'),
    activeElement: null, _nvShell: null,
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    createElement() { return fakeEl(''); },
    querySelector(sel) { return sel === '.nv-shell' ? this._nvShell : null; },
    getElementById(id) { return els[id] || null; }
  };
  const win = { scrollY: 0 };
  const sync = {
    calls: 0, _state: 'ok',
    syncNow() { this.calls++; this._state = 'syncing'; setTimeout(() => { this._state = 'ok'; }, 100); },
    status() { return { state: this._state }; }
  };
  win.CloudSync = sync;
  const calls = { openModule: [], buildDashboard: 0, trackerTick: 0, restart: 0, reload: 0, skipWaiting: 0 };
  win.location = { reload() { calls.reload++; } };
  const App = {
    currentView: 'main', _modKey: null,
    openModule(k) { calls.openModule.push(k); }
  };
  els['modView'] = fakeEl('modView'); els['modView']._cls.add('hidden');
  els['dashView'] = fakeEl('dashView');
  els['sidebar'] = fakeEl('sidebar');
  const sb = {
    console, setTimeout, clearTimeout, Promise,
    window: win, document: doc, App, CloudSync: sync,
    Meticulous: { modules: {} },
    el: (id) => els[id] || null,
    buildDashboard() { calls.buildDashboard++; },
    trackerTick() { calls.trackerTick++; }
  };
  if (opts.ota) { win.OTA = opts.ota; sb.OTA = opts.ota; }
  if (opts.navigator) sb.navigator = opts.navigator;
  sb.window.document = doc;
  vm.createContext(sb);
  vm.runInContext(extractRegion(appSrc, '/* PTR-BEGIN', '/* PTR-END */'), sb);
  return { sb, App, calls, doc };
}

(async function () {
  /* A: native — a newer bundle was downloaded → restart into it */
  {
    const ota = {
      checkNow: () => Promise.resolve({ updated: true, version: 166, reason: '' }),
      restart: function () {}
    };
    const w = makeWorld({ ota });
    ota.restart = () => { w.calls.restart++; };
    const r = await w.App.ptrRefreshNow();
    eq('A1 the pull resolves done', r, true);
    eq('A2 a downloaded update restarts the app into the new version', w.calls.restart, 1);
    eq('A3 no repaint into a page that is going away', w.calls.buildDashboard, 0);
    const pill = w.doc.body.children.filter((c) => c.id === 'ptrPill')[0];
    ok('A4 the pill says a new version is restarting', !!pill && /New version ready/.test(pill.textContent), pill && pill.textContent);
  }
  /* B: native — up to date → the ordinary data repaint */
  {
    const ota = {
      checkNow: () => Promise.resolve({ updated: false, version: 165, reason: '' }),
      restart: () => { throw new Error('must not restart'); }
    };
    const w = makeWorld({ ota });
    const r = await w.App.ptrRefreshNow();
    eq('B1 the pull resolves done', r, true);
    eq('B2 the dashboard repaints as before', w.calls.buildDashboard, 1);
  }
  /* C: native — update downloaded but the user is typing → no restart, no data loss */
  {
    const ota = {
      checkNow: () => Promise.resolve({ updated: true, version: 166, reason: '' }),
      restart: function () {}
    };
    const w = makeWorld({ ota });
    ota.restart = () => { w.calls.restart++; };
    w.doc.activeElement = { tagName: 'INPUT' };
    const r = await w.App.ptrRefreshNow();
    eq('C1 the pull still resolves done', r, true);
    eq('C2 typing is never blown away by an update restart', w.calls.restart, 0);
  }
  /* D: web — OTA declines (not native), a SW update is waiting → activate + reload */
  {
    const ota = {
      checkNow: () => Promise.resolve({ updated: false, version: 0, reason: 'OTA works inside the installed app.' }),
      restart: () => { throw new Error('must not restart via OTA on web'); }
    };
    const w = makeWorld({ ota });
    const worker = { state: 'installed', postMessage: () => { w.calls.skipWaiting++; }, addEventListener: () => {} };
    const reg = {
      waiting: worker, installing: null,
      update: () => Promise.resolve(),
      addEventListener: () => {}
    };
    w.sb.navigator = {
      serviceWorker: {
        getRegistration: () => Promise.resolve(reg),
        addEventListener: () => {}
      }
    };
    const r = await w.App.ptrRefreshNow();
    eq('D1 the pull resolves done', r, true);
    eq('D2 the waiting worker is told to take over', w.calls.skipWaiting, 1);
    await sleep(1700); // the no-controllerchange fallback timer reloads
    ok('D3 the page reloads into the new copy', w.calls.reload >= 1, 'reloads ' + w.calls.reload);
    eq('D4 no dashboard repaint into the dying page', w.calls.buildDashboard, 0);
  }
  /* E: nothing anywhere → ordinary refresh, version leg resolves false */
  {
    const w = makeWorld({});
    const leg = await w.App._ptrVersionLeg();
    eq('E1 with no OTA and no SW the leg is a quiet no', leg, false);
    const r = await w.App.ptrRefreshNow();
    eq('E2 and the pull repaints as before', [r, w.calls.buildDashboard], [true, 1]);
  }
  ok('E3 the version leg lives inside the PTR region (one gesture, both legs)',
    extractRegion(appSrc, '/* PTR-BEGIN', '/* PTR-END */').indexOf('ptrVersionLeg') !== -1);

  console.log('\nqueue-v166 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('SUITE ERROR: ' + (e && e.stack || e)); process.exit(1); });
