#!/usr/bin/env node
/* Meticulous v176 — L1/L2 suite (owner, Oct 20, 2026 14:24 MDT).
 * L1: Limited Access = the APPROVER ticks exactly which modules
 * the connecter gets — not the fixed dispatch+manifest preset.
 * L2: a One-Time request shows the item list it covers.
 *
 * Runs the REAL shipped code — js/connectlive.js and
 * js/connectpipe.js loaded whole over a fake store — plus static
 * checks over modules/connect.js (the tick UI) and
 * firestore.rules (the modules gates).
 * Run: node tools/connect-modules-v176-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const clSrc = read('js/connectlive.js');
const cpSrc = read('js/connectpipe.js');
const conSrc = read('modules/connect.js');
const rulesSrc = read('firestore.rules');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
const clone = (v) => JSON.parse(JSON.stringify(v));

function makeStore(seed) {
  const m = new Map(Object.entries(clone(seed || {})));
  return {
    get: (k, d) => (m.has(k) ? clone(m.get(k)) : d),
    set: (k, v) => { m.set(k, clone(v)); return true; },
    del: (k) => { m.delete(k); return true; }
  };
}

function loadWorld(seed) {
  const store = makeStore(seed);
  const win = {};
  win.window = win;
  win.App = { _store: store, _today: () => '2026-10-20', _esc: (s) => String(s == null ? '' : s) };
  win.console = console;
  vm.createContext(win);
  vm.runInContext(clSrc, win, { filename: 'connectlive.js' });
  vm.runInContext(cpSrc, win, { filename: 'connectpipe.js' });
  return { win, store, CL: win.ConnectLive, CP: win.ConnectPipe };
}

/* ---- (a) the module vocabulary + sanitizer ---- */
{
  const { CL } = loadWorld({});
  eq('a: module keys', CL.MODULE_KEYS,
    /* v207: 'navigation' joined the vocabulary (CONNECT-PICK
       part 3 — destinations are shareable over Connect). */
    ['dispatch', 'manifest', 'fuel', 'expenses', 'navigation', 'maintenance', 'pti', 'invoices', 'pnl']);
  eq('a: sanitize drops junk + dupes', CL.sanitizeModules(['fuel', 'bogus', 'fuel', 'pnl']), ['fuel', 'pnl']);
  eq('a: sanitize non-array', CL.sanitizeModules('fuel'), null);
  eq('a: sanitize empty array stays empty list', CL.sanitizeModules([]), []);
}

/* ---- (b) modulesOf / allowsModule semantics ---- */
{
  const { CL } = loadWorld({});
  eq('b: all pair = unrestricted (null)', CL.modulesOf({ kind: 'all', modules: ['fuel'] }), null);
  eq('b: no-kind pair = unrestricted', CL.modulesOf({}), null);
  eq('b: limited with ticks reads the ticks', CL.modulesOf({ kind: 'limited', modules: ['fuel', 'pnl'] }), ['fuel', 'pnl']);
  eq('b: limited without ticks = legacy preset', CL.modulesOf({ kind: 'limited' }), ['dispatch', 'manifest']);
  eq('b: once with item list reads it', CL.modulesOf({ kind: 'once', modules: ['dispatch'] }), ['dispatch']);
  check('b: allowsModule all', CL.allowsModule({ kind: 'all' }, 'fuel') === true);
  check('b: allowsModule ticked', CL.allowsModule({ kind: 'limited', modules: ['fuel'] }, 'fuel') === true);
  check('b: allowsModule unticked shut', CL.allowsModule({ kind: 'limited', modules: ['fuel'] }, 'pnl') === false);
  check('b: legacy limited allows manifest', CL.allowsModule({ kind: 'limited' }, 'manifest') === true);
  check('b: legacy limited shuts fuel', CL.allowsModule({ kind: 'limited' }, 'fuel') === false);
}

/* ---- (c) upsertConn carries the ticked list ---- */
{
  const { CL, store } = loadWorld({ con_list: [], con_hidden: [] });
  CL.upsertConn({ uid: 'u1', name: 'Peer', kind: 'limited', modules: ['dispatch', 'fuel'] }, 'connected');
  let list = store.get('con_list', []);
  eq('c: entry carries modules', list[0].modules, ['dispatch', 'fuel']);
  CL.upsertConn({ uid: 'u1', name: 'Peer', kind: 'limited', modules: ['pnl'] }, 'connected');
  list = store.get('con_list', []);
  eq('c: refresh re-stamps modules', list[0].modules, ['pnl']);
  CL.upsertConn({ uid: 'u2', name: 'Full', kind: 'all' }, 'connected');
  list = store.get('con_list', []);
  const u2 = list.filter((c) => c.uid === 'u2')[0];
  check('c: all pair gains no modules key', !('modules' in u2));
}

/* ---- (d) pipe gates follow the ticks ---- */
{
  const seed = {
    con_list: [
      { uid: 'legacy', status: 'connected', kind: 'limited' },
      { uid: 'fuelonly', status: 'connected', kind: 'limited', modules: ['fuel'] },
      { uid: 'disp', status: 'connected', kind: 'limited', modules: ['dispatch'] },
      { uid: 'full', status: 'connected', kind: 'all' }
    ],
    con_hidden: []
  };
  const { CP } = loadWorld(seed);
  eq('d: modulesFor legacy = preset', CP.modulesFor('legacy'), ['dispatch', 'manifest']);
  eq('d: modulesFor fuel-only', CP.modulesFor('fuelonly'), ['fuel']);
  eq('d: modulesFor full = null', CP.modulesFor('full'), null);
  check('d: fuel-only needs records', CP.limitedNeedsRecords('fuelonly') === true);
  check('d: dispatch-only needs no records', CP.limitedNeedsRecords('disp') === false);
  check('d: legacy needs no records', CP.limitedNeedsRecords('legacy') === false);
  const shareUids = CP.sharePeers().map((c) => c.uid).sort();
  eq('d: sharePeers = full + records-ticked limited only', shareUids, ['fuelonly', 'full']);
  check('d: allowsModule fuel for fuelonly', CP.allowsModule('fuelonly', 'fuel') === true);
  check('d: allowsModule pnl shut for fuelonly', CP.allowsModule('fuelonly', 'pnl') === false);
}

/* ---- (e) Connect screen statics: ticks exist where they must ---- */
{
  check('e: picker paints module ticks', conSrc.indexOf('data-cn-modpick') !== -1);
  check('e: accept row paints module ticks', conSrc.indexOf('data-cn-modacc') !== -1);
  check('e: one-time request shows its item list', conSrc.indexOf('Asking for:') !== -1);
  check('e: connection row shows what crosses', conSrc.indexOf('Can see:') !== -1);
  check('e: send carries the ticks', conSrc.indexOf('undefined, mods)') !== -1);
  check('e: accept carries the approver ticks', conSrc.indexOf('undefined, amods)') !== -1);
  check('e: limited line no longer promises the fixed preset',
    conSrc.indexOf('Only dispatches and manifests cross') === -1);
}

/* ---- (f) rules statics: modules ride the kind governance ---- */
{
  check('f: kind-governance update may move modules',
    rulesSrc.indexOf("'kind', 'onceDate', 'modules', 'endedAt', 'updatedAt'") !== -1);
  check('f: pairAllows reads the ticked list', rulesSrc.indexOf('function pairAllows') !== -1);
  check('f: records door uses the records gate', rulesSrc.indexOf('pairLimitedNoRecords') !== -1);
  check('f: billing door uses the billing gate', rulesSrc.indexOf('pairLimitedNoBilling') !== -1);
  check('f: days door opens for a dispatch tick',
    rulesSrc.indexOf("pairAllows(resource.data.driver, request.auth.uid, 'dispatch')") !== -1);
}

/* ---- (g) ship pins ---- */
{
  const idxSrc = read('index.html');
  check('g: index loads connectlive at the shipped version',
    idxSrc.indexOf('js/connectlive.js?v=' + ver.webVersion) !== -1);
  check('g: index loads connectpipe at the shipped version',
    idxSrc.indexOf('js/connectpipe.js?v=' + ver.webVersion) !== -1);
}

console.log('connect-modules-v176: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
