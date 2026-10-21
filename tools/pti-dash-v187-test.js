#!/usr/bin/env node
/* Meticulous v187 — PTI-DASH (owner, Oct 21, 2026 07:19 MDT,
 * video evidence): the PTI was filed (06:51, 169,800 km, no
 * defects) and the PTI dashboard CARD read "Today: filed, no
 * defects" — yet the tracker banner still read "⚠ No PTI filed
 * today — tap to file". Two readers, two answers.
 *
 * Root cause, two halves: (1) the banner's filed check was its
 * own loop in the shell while the card derived from the PTI
 * module's reports — parallel derivations of one fact; (2) the
 * banner only repainted inside trackerPaint (init + tracker
 * actions), never on a dashboard paint or at the filing moment,
 * so a filed PTI could not clear it while the card beside it
 * (repainted on dashboard paints) already read filed.
 *
 * The fix: ONE source — Meticulous.modules.pti.filedFor(date),
 * the module's own derivation, which status() itself now uses;
 * the shell's ptiFiledFor delegates to it (local loop kept only
 * as a pre-module-load fallback). And the flag repaints on every
 * surface that shows it: trackerPaint (as before), EVERY
 * buildDashboard paint (incl. the cloud-sync repaint), and the
 * filing call itself (App.paintPtiFlag).
 * Run: node tools/pti-dash-v187-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');
const ptiSrc = read('modules/pti.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) { ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
function extractRegion(src, b, e) {
  const a = src.lastIndexOf('/*', src.indexOf(b));
  const c = src.indexOf('*/', src.indexOf(e));
  return src.slice(a, c + 2);
}

/* ---------------- the PTI module, whole ---------------- */
function makeStore(seed) {
  const data = Object.assign({}, seed || {});
  return {
    get(k, d) { return (k in data) ? data[k] : d; },
    set(k, v) { data[k] = v; },
    _data: data
  };
}
function loadPti(store) {
  const sb = { console, Meticulous: { modules: {} }, window: {},
    App: {
      _store: store,
      _esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      _today: () => '2026-10-21'
    } };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(ptiSrc, sb);
  return sb.Meticulous.modules.pti;
}
function filedReport(PTI, kind, dateStr) {
  const ts = Date.parse(dateStr + 'T06:51:00');
  const r = PTI._buildReport({ items: {}, odo: '169800', kind: kind, sig: '', carrier: 'AI Trucking', carrierAddr: '', unit: '07', plate: '', loc: '', lat: null, lng: null, driverNameEffective: 'Asjad Kamal' }, ts);
  return r;
}

/* ---- filedFor: the one source ---- */
{
  const store = makeStore({ onboarding: { firstName: 'Asjad', lastName: 'Kamal' } });
  const PTI = loadPti(store);
  const rep = filedReport(PTI, 'pre', '2026-10-21');
  store.set('pti_reports', [rep]);
  const got = PTI.filedFor('2026-10-21');
  ok('filedFor returns the filed pre-trip report', !!got && got.id === rep.id);
  eq('filedFor: another date is not filed', PTI.filedFor('2026-10-20'), null);
  ok('status() reads filed from the same source', PTI.status().indexOf('Today: filed') === 0, PTI.status());
}
{
  const store = makeStore({ onboarding: {} });
  const PTI = loadPti(store);
  store.set('pti_reports', [filedReport(PTI, 'post', '2026-10-21')]);
  eq('a post-trip alone is NOT a filed pre-trip', PTI.filedFor('2026-10-21'), null);
  ok('status agrees: not filed yet', PTI.status().indexOf('Today: not filed yet') === 0, PTI.status());
}
{
  const store = makeStore({ onboarding: {} });
  const PTI = loadPti(store);
  eq('no reports: filedFor is null', PTI.filedFor('2026-10-21'), null);
}

/* ---- the shell check delegates to the module ---- */
function loadNudge(store, ptiModule) {
  const sb = { console, store: store,
    App: { userRole: () => 'driver', tracker: { status: 'running' } },
    todayStr: (d) => { d = d || new Date('2026-10-21T08:00:00'); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); },
    window: {} };
  sb.window = sb;
  if (ptiModule) sb.Meticulous = { modules: { pti: ptiModule } };
  vm.createContext(sb);
  vm.runInContext(extractRegion(appSrc, 'PTI-NUDGE-BEGIN', 'PTI-NUDGE-END') +
    '\nthis.__x = { ptiFiledFor: ptiFiledFor, ptiFlagVisible: ptiFlagVisible };', sb);
  return sb.__x;
}
{
  const store = makeStore({ onboarding: { firstName: 'Asjad', lastName: 'Kamal' } });
  const PTI = loadPti(store);
  const rep = filedReport(PTI, 'pre', '2026-10-21');
  store.set('pti_reports', [rep]);
  const nx = loadNudge(store, PTI);
  eq('shell ptiFiledFor (via the module) is true once filed', nx.ptiFiledFor('2026-10-21'), true);
  eq('the flag hides once filed', nx.ptiFlagVisible(), false);
}
{
  /* the module absent (a paint before it loads): the fallback
     loop must answer the same way off the same store */
  const store = makeStore({ onboarding: {} });
  const PTIm = loadPti(store);
  store.set('pti_reports', [filedReport(PTIm, 'pre', '2026-10-21')]);
  const nx = loadNudge(store, null);
  eq('shell ptiFiledFor (fallback loop) agrees', nx.ptiFiledFor('2026-10-21'), true);
  const empty = loadNudge(makeStore({}), null);
  eq('nothing filed: shell check is false', empty.ptiFiledFor('2026-10-21'), false);
  eq('nothing filed + session running: the flag shows', empty.ptiFlagVisible(), true);
}

/* ---- repaint surfaces (source pins) ---- */
ok('shell exposes App.paintPtiFlag', appSrc.indexOf('App.paintPtiFlag = paintPtiFlag') !== -1);
{
  const bd = appSrc.slice(appSrc.indexOf('function buildDashboard()'), appSrc.indexOf('NAME-CARD-BEGIN'));
  ok('every buildDashboard paint repaints the flag', bd.indexOf('paintPtiFlag()') !== -1);
}
ok('the filing call repaints the flag', ptiSrc.indexOf('App.paintPtiFlag()') !== -1);
ok('status() derives from filedFor (one source)', ptiSrc.indexOf('var t = todayStr(), filed = filedFor(t);') !== -1);
eq('ships as webVersion 188', ver.webVersion, 202);
ok('index loads pti + app at the 199 pin',
  idxSrc.indexOf('modules/pti.js?v=202') !== -1 && idxSrc.indexOf('js/app.js?v=202') !== -1);

console.log('\npti-dash v187: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
