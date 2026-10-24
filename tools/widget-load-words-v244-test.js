#!/usr/bin/env node
/* Meticulous v244 — WIDGET-LOAD-WORDS (owner queue, Oct 24,
 * 2026): native v43's home-screen widget grew load +/− buttons
 * whose taps ride the widgetAction channel as the words
 * loadPlus / loadMinus. The PiP face's handler (applyPipAction)
 * already performs those words; the widget handler
 * (applyWidgetAction) performed only start/pause/stop, so a
 * widget load tap arrived and did nothing. This suite extracts
 * the REAL handler region from js/app.js and performs the words
 * against instrumented stubs: a widget loadPlus must do exactly
 * what a PiP loadPlus does — the same code path, no new
 * behaviour — and start/pause/stop must not change.
 *
 * Run: node tools/widget-load-words-v244-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}

const begin = appSrc.indexOf('function applyWidgetAction(a) {');
const end = appSrc.indexOf('var _heroSig');
if (begin === -1 || end === -1 || end <= begin) {
  console.log('  FAIL handler region markers found in js/app.js');
  console.log('\n0 passed, 1 failed');
  process.exit(1);
}
const region = appSrc.slice(begin, end);

function makeWorld() {
  const calls = [];
  const sb = {
    console: console,
    __x: {},
    App: {
      tracker: { status: 'idle' },
      trackerToggle: function () { calls.push('toggle'); },
      showDashboard: function () { calls.push('dashboard'); },
      trackerStopPrompt: function () { calls.push('stopPrompt'); }
    },
    sessionActive: function () { return sb.__session; },
    __session: false,
    trackerAddLoadTap: function () { calls.push('addLoad'); },
    trackerCutLoadTap: function () { calls.push('cutLoad'); },
    trackerPaint: function () { calls.push('paint'); },
    paintBubble: function () { calls.push('bubble'); },
    trackerElapsedSec: function () { return 0; },
    window: { ShiftTrack: null }
  };
  sb.window.App = sb.App;
  vm.createContext(sb);
  vm.runInContext(region + '\n__x.applyWidgetAction = applyWidgetAction; __x.applyPipAction = applyPipAction;', sb);
  return { sb: sb, calls: calls, applyWidgetAction: sb.__x.applyWidgetAction, applyPipAction: sb.__x.applyPipAction };
}

console.log('— the widget words —');
{
  const w = makeWorld();
  w.applyWidgetAction('loadPlus');
  ok('widget loadPlus performs the load add (addLoad + paint + bubble)',
    w.calls.join(',') === 'addLoad,paint,bubble', w.calls.join(','));
}
{
  const w = makeWorld();
  w.applyWidgetAction('loadMinus');
  ok('widget loadMinus performs the load cut (cutLoad + paint + bubble)',
    w.calls.join(',') === 'cutLoad,paint,bubble', w.calls.join(','));
}
{
  const wp = makeWorld(); wp.applyPipAction('loadPlus');
  const ww = makeWorld(); ww.applyWidgetAction('loadPlus');
  ok('widget loadPlus === PiP loadPlus, call for call', wp.calls.join(',') === ww.calls.join(','), wp.calls.join(',') + ' vs ' + ww.calls.join(','));
  const wp2 = makeWorld(); wp2.applyPipAction('loadMinus');
  const ww2 = makeWorld(); ww2.applyWidgetAction('loadMinus');
  ok('widget loadMinus === PiP loadMinus, call for call', wp2.calls.join(',') === ww2.calls.join(','), wp2.calls.join(',') + ' vs ' + ww2.calls.join(','));
}

console.log('— the existing words, unchanged —');
{
  const w = makeWorld();
  w.applyWidgetAction('start');
  ok('start toggles an idle tracker on', w.calls.join(',') === 'toggle', w.calls.join(','));
}
{
  const w = makeWorld(); w.sb.App.tracker.status = 'running';
  w.applyWidgetAction('pause');
  ok('pause toggles a running tracker', w.calls.join(',') === 'toggle', w.calls.join(','));
}
{
  const w = makeWorld(); w.sb.__session = true;
  w.applyWidgetAction('stop');
  ok('stop opens the dashboard stop flow on a live session', w.calls.join(',') === 'dashboard,stopPrompt', w.calls.join(','));
}
{
  const w = makeWorld();
  w.applyWidgetAction('bogus'); w.applyWidgetAction(''); w.applyWidgetAction(null);
  ok('unknown/empty words do nothing', w.calls.length === 0, w.calls.join(','));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
