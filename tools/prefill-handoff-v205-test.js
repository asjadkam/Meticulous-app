#!/usr/bin/env node
/* Meticulous v205 — PREFILL-HANDOFF-INERT (owner's "fix everything
 * fixable" pass, Oct 21, 2026): the Dispatch crew board's v132
 * "Set pay rate" hand-off wrote a prefill global for P&L's manual
 * form. The door itself was removed in v163 (settled wage design:
 * a boss never sets a connected driver's wage — the driver sets
 * his own), and the form it fed was removed in v198 (PNL-CLEAN-2).
 * What remained was a render-time consumer in P&L for a global
 * NOTHING in the app could set, landing on state nothing rendered
 * (pnlPrefill / pnlManualOpen) — a path that promised a behaviour
 * that could never happen (LOOK-TWICE law).
 *
 * The law under test:
 *  - No file in the app writes or reads the hand-off global, the
 *    prefill state, or the manual-open flag — the dead path is out.
 *  - P&L still renders exactly its two cards (picker + Monthly
 *    analysis) with the plumbing (calc + stores + crew fetch)
 *    intact, and setting the old global changes NOTHING.
 * Run: node tools/prefill-handoff-v205-test.js
 */
'use strict';
const fs = require('fs'); const vm = require('vm'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); } }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
function extractRegion(src, b, e) { const a = src.lastIndexOf('/*', src.indexOf(b)); const c = src.indexOf('*/', src.indexOf(e)); return src.slice(a, c + 2); }
function memStore(seed) { const data = JSON.parse(JSON.stringify(seed || {})); return { get: (k, d) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; return true; }, del: (k) => { delete data[k]; } }; }
const invSrc = read('modules/invoice.js'); const pnlSrc = read('modules/pnl.js');
const dspSrc = read('modules/dispatch.js'); const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

/* ---------- source pins: the dead path is out, app-wide ---------- */
{
  console.log('\n— v205: no writer, no reader, no state —');
  const appFiles = ['modules/pnl.js', 'modules/dispatch.js', 'modules/connect.js',
    'js/app.js', 'js/connectpipe.js', 'js/connectlive.js', 'index.html'];
  appFiles.forEach(function (f) {
    const s = read(f);
    ok(f + ': no hand-off global', s.indexOf('__mtPnlPrefillDriver') === -1);
    ok(f + ': no prefill state', s.indexOf('pnlPrefill') === -1);
    ok(f + ': no manual-open flag', s.indexOf('pnlManualOpen') === -1);
  });
  ok('pnl.js: the removal is on the record (v205 note)', pnlSrc.indexOf('PREFILL-HANDOFF-INERT') !== -1);
  ok('dispatch.js: still no boss-side pay door (v163 law stands)',
    dspSrc.indexOf('NO boss-side pay door') !== -1 && dspSrc.indexOf('Set his pay rate') === -1);
}

/* ---------- behaviour: render is unchanged; the old global is inert ---------- */
function makePnl(seed) {
  const store = memStore(seed);
  const sb = { window: {}, Meticulous: { modules: {} }, console: console, App: { _store: store, _esc: (s) => String(s == null ? '' : s), _today: () => '2026-10-21', userRole: () => 'both' } };
  sb.window.window = sb.window;
  vm.createContext(sb);
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
  vm.runInContext(pnlSrc, sb);
  return { pnl: sb.Meticulous.modules.pnl, sb: sb };
}
function fakeBody() {
  return { innerHTML: '', querySelector: function () { return {}; }, querySelectorAll: function () { return []; } };
}
{
  console.log('\n— v205: render drives; a stale hand-off global does nothing —');
  const seed = { onboarding: { accountType: 'Owner-Operator' } };
  const a = makePnl(seed); const bodyA = fakeBody(); a.pnl.render(bodyA);
  const b = makePnl(seed); b.sb.window.__mtPnlPrefillDriver = { uid: 'ghost', name: 'Ghost' };
  const bodyB = fakeBody(); b.pnl.render(bodyB);
  ok('render paints the P&L card', bodyA.innerHTML.indexOf('📈 Profit & Loss') !== -1);
  ok('render paints the Monthly analysis', bodyA.innerHTML.indexOf('📊 Monthly analysis') !== -1);
  eq('a set hand-off global changes NOTHING in the render', bodyB.innerHTML, bodyA.innerHTML);
  eq('the module exposes no prefill surface', typeof a.pnl._prefill, 'undefined');
  ok('plumbing intact (calc + crew fetch still wired)',
    pnlSrc.indexOf('function calc(') !== -1 && pnlSrc.indexOf('ConnectPipe.fetchCrewRange') !== -1);
}

/* ---------- ship pins ---------- */
{
  console.log('\n— v205: ship pins —');
  eq('version.json webVersion ships as 205', ver.webVersion, 234);
  ok('index.html pins modules/pnl.js at ?v=234', idxSrc.indexOf('modules/pnl.js?v=234') !== -1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
