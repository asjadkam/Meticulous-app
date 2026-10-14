#!/usr/bin/env node
/* Meticulous v46 — daily odometer photos: behavioral tests against the
 * REAL shipped js/app.js. The ODO-MASTER and ODO-PROMPT regions are
 * marker-delimited and harness-extractable by design; this test slices
 * them out verbatim and runs them in a vm sandbox with an in-memory
 * store, so the logic under test is the logic that ships.
 * Run: node tools/odo-photos-test.js
 *
 * Covers Asjad's Oct 14 spec:
 *  - toggle OFF (default) -> Hourly/Weight/Trip never prompt
 *  - by-mile -> prompts regardless of the toggle (v39 behaviour kept)
 *  - toggle ON -> start reading waits on the tracker, lands on the
 *    session at stop; end reading patches the session; both bump the
 *    one master odometer (upward only)
 *  - daily km = end - start via odoDailyKm; end <= start keeps both
 *    readings but yields NO distance (never negative)
 *  - skip -> a session saves with no odo fields at all
 *  - once-per-day-per-kind prompt bookkeeping still holds
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

function extract(beginMark, endMark) {
  // markers sit inside /* ... */ comments — span the whole comment blocks
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}
const code = extract('ODO-MASTER-BEGIN', 'ODO-MASTER-END') + '\n' +
             extract('ODO-PROMPT-BEGIN', 'ODO-PROMPT-END');

/* A fresh "world": in-memory store (JSON-clone semantics like the real
 * localStorage-backed store), a stub tracker, and the real todayStr. */
function makeWorld(onboarding) {
  const mem = {};
  if (onboarding) mem.onboarding = onboarding;
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); },
    del: function (k) { delete mem[k]; }
  };
  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  const sandbox = {
    console: console,
    store: store,
    todayStr: todayStr,
    trackerSave: function () {},
    App: { tracker: { status: 'idle', startTs: 0, elapsed: 0 } }
  };
  sandbox.window = sandbox; // applyOdoReading probes window.LiveMiles (absent -> skipped)
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  sandbox._mem = mem;
  sandbox._today = todayStr(new Date());
  return sandbox;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, String(got) === String(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* 1 — default OFF: non-by-mile modes never prompt */
['Hourly', 'Weight', 'Trip'].forEach(function (std) {
  const w = makeWorld({ payStandard: std });
  eq(std + ' + toggle off: no start prompt', w.shouldPromptOdo('start'), false);
  eq(std + ' + toggle off: no end prompt', w.shouldPromptOdo('end'), false);
});

/* 2 — by-mile prompts regardless of toggle (v39 behaviour preserved) */
(function () {
  const w = makeWorld({ payStandard: 'Miles' });
  eq('Miles + toggle off: start prompt fires', w.shouldPromptOdo('start'), true);
  eq('odoDailyPhotosOn false when unset', w.odoDailyPhotosOn(), false);
})();

/* 3 — toggle ON (Hourly): full day flow */
(function () {
  const w = makeWorld({ payStandard: 'Hourly', odoDailyPhotos: true });
  const today = w._today;
  eq('toggle on: odoDailyPhotosOn true', w.odoDailyPhotosOn(), true);
  eq('toggle on: start prompt fires', w.shouldPromptOdo('start'), true);
  eq('toggle on: end prompt waits for a start reading', w.shouldPromptOdo('end'), false);

  // start reading: waits on the tracker, bumps the master odometer
  eq('applyOdoReading start accepted', w.applyOdoReading('start', 168400), true);
  eq('start reading pending on tracker', w.App.tracker.odoStart.value, 168400);
  eq('master odometer bumped to start reading', w.masterOdometer(), 168400);
  eq('start prompt does not re-fire while pending', w.shouldPromptOdo('start'), false);

  // stop: stopSessionAt moves the pending reading onto the new session
  const startVal = w.takePendingStartOdo(today);
  eq('pending start taken at stop', startVal, 168400);
  const entry = { date: today, seconds: 3600, endedAt: new Date().toISOString() };
  if (startVal) entry.startOdo = startVal;
  w.store.set('sessions', [entry]);
  eq('end prompt fires once a start reading exists', w.shouldPromptOdo('end'), true);

  // end reading: patches the session, bumps the master again
  eq('applyOdoReading end accepted', w.applyOdoReading('end', 168614), true);
  const s = w.store.get('sessions', [])[0];
  eq('session carries startOdo', s.startOdo, 168400);
  eq('session carries endOdo', s.endOdo, 168614);
  eq('daily km = end - start', w.odoDailyKm(s), 214);
  eq('master odometer bumped to end reading', w.masterOdometer(), 168614);
})();

/* 4 — once per day per kind, even when skipped */
(function () {
  const w = makeWorld({ payStandard: 'Hourly', odoDailyPhotos: true });
  w.markOdoPromptShown('start', w._today);
  eq('shown-once bookkeeping blocks a second start prompt', w.shouldPromptOdo('start'), false);
})();

/* 5 — end <= start: readings kept, NO distance, master never dragged down */
(function () {
  const w = makeWorld({ payStandard: 'Hourly', odoDailyPhotos: true });
  const today = w._today;
  w.applyOdoReading('start', 168614);
  const sv = w.takePendingStartOdo(today);
  const entry = { date: today, seconds: 1800 };
  if (sv) entry.startOdo = sv;
  w.store.set('sessions', [entry]);
  eq('lower end reading is still accepted onto the session', w.applyOdoReading('end', 168500), true);
  const s = w.store.get('sessions', [])[0];
  eq('end reading stored as given', s.endOdo, 168500);
  eq('no negative km: odoDailyKm is null', w.odoDailyKm(s), null);
  eq('master odometer not dragged down', w.masterOdometer(), 168614);
  // equal readings: also no distance
  eq('equal pair yields null', w.odoDailyKm({ startOdo: 100, endOdo: 100 }), null);
  eq('missing pair yields null', w.odoDailyKm({ startOdo: 100 }), null);
})();

/* 6 — skip: the session saves cleanly with no odo fields at all */
(function () {
  const w = makeWorld({ payStandard: 'Hourly', odoDailyPhotos: true });
  // driver tapped Skip at both prompts: applyOdoReading never ran
  const pending = w.takePendingStartOdo(w._today);
  eq('skip leaves nothing pending', pending, null);
  const entry = { date: w._today, seconds: 3600, endedAt: new Date().toISOString() };
  if (pending) entry.startOdo = pending;
  ok('skipped session has no startOdo field', !('startOdo' in entry));
  ok('skipped session has no endOdo field', !('endOdo' in entry));
  eq('skipped session has no daily km', w.odoDailyKm(entry), null);
  eq('skip leaves the master odometer untouched', w.masterOdometer(), null);
})();

console.log('\nodo-photos test: ' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
