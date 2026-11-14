#!/usr/bin/env node
/* Meticulous v456 — MANUAL-START-STALE-PRESET (owner, Sat Nov 14, 2026,
 * ~14:16 CST, his screenshot).
 *
 * He started the shift MANUALLY and the timer read 54:44:23 and
 * climbing, "Counting from 7:30 AM", at 2:14 PM — 54h44m before
 * Nov 14 14:14 is Nov 12 07:30. The minutes/seconds are right for
 * a 7:30 AM start; the hours carry two whole extra days.
 *
 * Root family: the start-time Edit, while idle, stores a
 * presetStart ("I actually started at …") on the tracker. v342
 * taught the dashboard FACE that a preset is a SAME-DAY word — a
 * preset from an earlier day no longer shows ("Will count from …"
 * falls through to the plan / "Starts from now") — but the start
 * door itself, App.trackerToggle, still applied ANY presetStart
 * blind: elapsed = now − presetStart, and the session pinned to
 * it. A preset left over from Nov 12 (set that morning, never
 * consumed — the day's session was started by another door) sat
 * invisible on the face behind the "Starts from now" promise and
 * detonated at his next manual tap, two days later.
 *
 * The law (unchanged): a manual start begins at the tap; his own
 * preset wins ONLY as the same-day word v342 already says it is.
 *
 * Drives the REAL shipped code: the AUTOSTART-ENGINE region and
 * the tracker slice (trackerSessionStartMs / trackerElapsedSec /
 * trackerToggle / the stale + closed healers) over a fake clock
 * pinned to Sat Nov 14, 2026.
 * Run: node tools/manual-start-stale-preset-v456-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

function extractRegion(s, beginMark, endMark) {
  const a = s.lastIndexOf('/*', s.indexOf(beginMark));
  const b = s.indexOf('*/', s.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return s.slice(a, b + 2);
}
const engine = extractRegion(appSrc, 'AUTOSTART-ENGINE-BEGIN', 'AUTOSTART-ENGINE-END');
const trackerSlice = (() => {
  const a = appSrc.indexOf('function trackerSessionStartMs()');
  const b = appSrc.indexOf('/* v34: stop with an explicit end time', a);
  if (a === -1 || b === -1) throw new Error('tracker slice not found');
  return appSrc.slice(a, b);
})();

/* ---------- assertions ---------- */
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL: ' + name); }
}
function eq(got, want, name) { ok(got === want, name + ' (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')'); }

/* ---------- fake clock ---------- */
const RealDate = Date;
let fakeNow = 0;
class FakeDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fakeNow])); }
  static now() { return fakeNow; }
}
function ms(y, mo, d, h, mi, s) { return new RealDate(y, mo, d, h, mi, s || 0, 0).getTime(); }
function todayStrOf(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const NOV12_0730 = ms(2026, 10, 12, 7, 30, 0);   // the stale preset / stale session anchor
const NOV13_0730 = ms(2026, 10, 13, 7, 30, 0);   // yesterday's preset
const NOV14_0730 = ms(2026, 10, 14, 7, 30, 0);   // today's preset
const NOV14_0900 = ms(2026, 10, 14, 9, 0, 0);
const NOV14_1414_23 = ms(2026, 10, 14, 14, 14, 23); // the screenshot's clock
eq(Math.floor((NOV14_1414_23 - NOV12_0730) / 1000), 54 * 3600 + 44 * 60 + 23,
  'fixture: Nov 12 07:30 -> Nov 14 14:14:23 is exactly 54:44:23 (the screenshot)');

function makeWorld(opts) {
  opts = opts || {};
  const mem = {
    onboarding: { autoStart: true, autoStartTime: '07:00', autoStartDays: [1, 2, 3, 4, 5, 6] },
    dsp_active: opts.active || null,
    dsp_list: opts.list || [],
    sessions: opts.sessions || []
  };
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const lmKeys = [], stKeys = [];
  const sb = {
    console: console, Date: FakeDate,
    store: store, todayStr: todayStrOf,
    confirm: function () { return false; },
    resetAccum: function () {}, trackerSave: function () {}, trackerPaint: function () {},
    maybePromptOdo: function () { return false; },
    el: function () { return { classList: { add: function () {}, remove: function () {} }, value: '' }; },
    LiveMiles: { startDay: function (k) { lmKeys.push(k); return true; }, syncWake: function () {}, stopDay: function () { return null; } },
    GeoLoads: { startDay: function () {}, stopDay: function () {}, today: function () { return null; } },
    ShiftTrack: {
      sessionStarted: function (k) { stKeys.push(k); },
      sessionStopped: function () {}
    },
    App: { tracker: opts.tracker || { status: 'idle', startTs: 0, elapsed: 0 }, userRole: function () { return 'driver'; } }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(engine + '\n' + trackerSlice, sb);
  return { sb: sb, App: sb.App, lmKeys: lmKeys, stKeys: stKeys, mem: mem };
}

/* ============ A: THE REPRO — idle + a preset from two days ago ============ */
console.log('— A: manual tap with a Nov 12 preset still on the tracker —');
{
  fakeNow = NOV14_1414_23;
  const w = makeWorld({ tracker: { status: 'idle', startTs: 0, elapsed: 0, presetStart: NOV12_0730 } });
  w.App.trackerToggle();
  eq(w.App.tracker.status, 'running', 'A1 the tap starts the shift');
  eq(w.App.tracker.elapsed, 0, 'A2 elapsed is ZERO at the tap — not 54:44:23 (197063 s) from the stale preset');
  eq(w.App.tracker.startTs, NOV14_1414_23, 'A3 startTs is the tap');
  eq(w.App.tracker.sessionId, NOV14_1414_23, 'A4 the session identity is TODAY\u2019s tap, never the stale anchor');
  eq(w.App.tracker.startLabelMs, NOV14_1414_23, 'A5 "Counting from" pins to the tap');
  eq(w.sb.trackerElapsedSec(), 0, 'A6 the one derivation reads 0 at the tap');
  eq(w.sb.trackerSessionStartMs(), NOV14_1414_23, 'A7 the derived start is the tap');
  ok(!('presetStart' in w.App.tracker), 'A8 the stale preset is consumed/cleared by the start');
  eq(JSON.stringify(w.lmKeys), JSON.stringify(['s' + NOV14_1414_23]), 'A9 miles key off TODAY\u2019s session');
  fakeNow = NOV14_1414_23 + 600000;
  eq(w.sb.trackerElapsedSec(), 600, 'A10 ten minutes later the clock reads 10:00 — single-digit, once');
}

/* ============ B: his own preset TODAY still wins (the v255/v342 law) ============ */
console.log('— B: a preset set for today still counts from his stated time —');
{
  fakeNow = NOV14_1414_23;
  const w = makeWorld({ tracker: { status: 'idle', startTs: 0, elapsed: 0, presetStart: NOV14_0730 } });
  w.App.trackerToggle();
  eq(w.App.tracker.elapsed, 6 * 3600 + 44 * 60 + 23, 'B1 today\u2019s 7:30 preset counts 6:44:23 at 14:14:23');
  eq(w.App.tracker.sessionId, NOV14_0730, 'B2 the session pins to his stated start today');
  eq(w.sb.trackerSessionStartMs(), NOV14_0730, 'B3 "Counting from 7:30 AM" — today\u2019s 7:30');
}

/* ============ C: yesterday's preset is refused the same way ============ */
console.log('— C: manual tap with yesterday\u2019s preset —');
{
  fakeNow = NOV14_0900;
  const w = makeWorld({ tracker: { status: 'idle', startTs: 0, elapsed: 0, presetStart: NOV13_0730 } });
  w.App.trackerToggle();
  eq(w.App.tracker.elapsed, 0, 'C1 elapsed zero at the tap — not 25:30:00 from yesterday\u2019s preset');
  eq(w.App.tracker.sessionId, NOV14_0900, 'C2 session identity is the tap');
}

/* ============ D: a future preset for later today behaves as before ============ */
console.log('— D: future preset today —');
{
  fakeNow = NOV14_1414_23;
  const FUTURE = ms(2026, 10, 14, 15, 0, 0);
  const w = makeWorld({ tracker: { status: 'idle', startTs: 0, elapsed: 0, presetStart: FUTURE } });
  w.App.trackerToggle();
  eq(w.App.tracker.elapsed, 0, 'D1 elapsed never goes negative / never counts a future span');
  eq(w.App.tracker.status, 'running', 'D2 the tap still starts the shift');
}

/* ============ E: stale OPEN sessions are still buried, never resumed ============ */
console.log('— E: the stale-session healers stand (existing law, re-pinned) —');
{
  fakeNow = NOV14_1414_23;
  const w1 = makeWorld({ tracker: { status: 'running', startTs: NOV12_0730, elapsed: 0, sessionId: NOV12_0730 } });
  eq(w1.sb.healStaleTracker(), true, 'E1 a running session anchored Nov 12 is discarded, not carried');
  eq(w1.App.tracker.status, 'idle', 'E2 the tracker stands idle after the burial');
  eq(w1.App.tracker.discardedSid, NOV12_0730, 'E3 the burial is by the ghost\u2019s identity');
  const w2 = makeWorld({ tracker: { status: 'paused', startTs: NOV13_0730, elapsed: 3600, sessionId: NOV13_0730 } });
  eq(w2.sb.healStaleTracker(), true, 'E4 a paused session anchored yesterday is discarded too');
  const w3 = makeWorld({ tracker: { status: 'running', startTs: NOV14_0730, elapsed: 0, sessionId: NOV14_0730 } });
  eq(w3.sb.healStaleTracker(), false, 'E5 today\u2019s live session is untouched');
  eq(w3.App.tracker.status, 'running', 'E6 today\u2019s session keeps running');
}

/* ============ F: a closed day stays closed at the start door ============ */
console.log('— F: closed-day law intact —');
{
  fakeNow = NOV14_1414_23;
  /* today's dispatch completed + its finished session entry: the
     engine's own closed proof must still refuse an auto-start. */
  const done = { id: 'd-done', jobSite: 'Aecon', scheduledAt: '2026-11-14T07:30', status: 'completed' };
  const fin = { endedAt: new RealDate(2026, 10, 14, 13, 30, 0).toISOString(), seconds: 6 * 3600 };
  const w = makeWorld({ active: null, list: [done], sessions: [fin] });
  eq(typeof w.sb.autostartDayClosed, 'function', 'F1 the v455 closed proof is in the sliced engine');
  eq(w.sb.autostartDayClosed(null, [done], '2026-11-14'), true, 'F2 a completed dispatch closes its day');
  const r = w.App.checkAutoStart();
  ok(r === 'closed-today' || r === 'done-today', 'F3 checkAutoStart refuses the closed day (got ' + JSON.stringify(r) + ')');
  eq(w.App.tracker.status, 'idle', 'F4 nothing started on the closed day');
}

/* ============ G: statics — the start door carries the same-day rule ============ */
console.log('— G: statics —');
{
  const toggleBody = appSrc.slice(appSrc.indexOf('App.trackerToggle = function'), appSrc.indexOf('/* v270 (TRAVEL-MISSING-ON-TRACKER-CLOSE'));
  ok(/presetStart/.test(toggleBody) && /todayStr\(new Date\(t\.presetStart\)\)/.test(toggleBody),
    'G1 trackerToggle tests the preset against TODAY before applying it');
  const ssmBody = appSrc.slice(appSrc.indexOf('function trackerSessionStartMs()'), appSrc.indexOf('function trackerElapsedSec()'));
  ok(/todayStr\(new Date\(t\.presetStart\)\)/.test(ssmBody),
    'G2 trackerSessionStartMs applies the same same-day rule to the idle preset');
}

console.log('\nmanual-start-stale-preset-v456-test: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
