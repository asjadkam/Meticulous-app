#!/usr/bin/env node
/* Meticulous v255 — MANUAL-START-BACKDATED + BUBBLE-TIMER-MISMATCH
 * (owner, Sat Oct 24, 2026, 18:19–18:34 MDT, his screenshots).
 *
 * Saturday was a NO-WORK day (no dispatch). He pressed START
 * himself at ~18:14; the dashboard then read "Working… 10:19:14 ·
 * Counting from 8:00 AM" and the Manifest card "Today: 33 h 58 m
 * worked", while the native bubble climbed at ~2× from an epoch
 * the previous evening. Two defects, one root family:
 *
 *  1. App.trackerToggle's v174 block anchored a MANUAL start to
 *     the day's plan time whenever a plan existed — and with his
 *     Mon–Sat standing setting at 8:00 AM, autostartPlan treated
 *     the standing time as a plan even with NO dispatch, so the
 *     tap was silently backdated to 8:00. Worse, it encoded the
 *     anchor span TWICE (elapsed = tap − anchor AND startTs =
 *     anchor), so every consumer adding (now − startTs) to
 *     elapsed counted the span twice.
 *  2. The bubble is fed from the same tick sum, and its push was
 *     gated on already being in PiP — so the shell kept painting
 *     a stale previous-session clock until pushes resumed, then
 *     showed the double-counted number. One session state must
 *     produce ONE number, on every face.
 *
 * The law after v255 (the owner's words): a manual start begins
 * at the tap ("Starts from now" is the promise on the button
 * screen); the scheduled-time start applies ONLY to
 * dispatch-driven auto-start on a dispatch day (a dispatch, or a
 * per-day override he set himself). The standing setting alone
 * never starts anything and never arms anything.
 *
 * Drives the REAL shipped code: the AUTOSTART-ENGINE region, the
 * tracker slice (trackerSessionStartMs / trackerElapsedSec /
 * trackerToggle), fmtClock, loadsGlance and pushBubbleFace, over
 * a fake clock pinned to the real Sat Oct 24, 2026.
 * Run: node tools/manual-start-law-test.js
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
function sliceFn(s, beginNeedle, endNeedle) {
  const a = s.indexOf(beginNeedle);
  if (a === -1) throw new Error('not found: ' + beginNeedle);
  const b = s.indexOf(endNeedle, a);
  if (b === -1) throw new Error('end not found: ' + endNeedle);
  return s.slice(a, b);
}
const engine = extractRegion(appSrc, 'AUTOSTART-ENGINE-BEGIN', 'AUTOSTART-ENGINE-END');
const trackerSlice = (() => {
  const a = appSrc.indexOf('function trackerSessionStartMs()');
  const b = appSrc.indexOf('/* v34: stop with an explicit end time', a);
  if (a === -1 || b === -1) throw new Error('tracker slice not found');
  return appSrc.slice(a, b);
})();
const fmtClockCode = sliceFn(appSrc, 'function fmtClock(sec)', '\n  }\n') + '\n  }\n';
const loadsCode = sliceFn(appSrc, 'function loadsGlance()', 'function pushWidgetState');
const bubbleCode = 'var _bubbleSig = "";\n' + sliceFn(appSrc, 'function pushBubbleFace(sec)', 'function paintBubble');

/* ---------- assertions ---------- */
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL: ' + name); }
}
function eq(got, want, name) { ok(got === want, name + ' (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')'); }

/* ---------- fake clock: Sat Oct 24, 2026 ---------- */
const RealDate = Date;
let fakeNow = 0;
class FakeDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fakeNow])); }
  static now() { return fakeNow; }
}
function msOf(h, m, s) { return new RealDate(2026, 9, 24, h, m, s || 0, 0).getTime(); }
function setClock(h, m, s) { fakeNow = msOf(h, m, s); }
function todayStrOf(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
eq(new RealDate(2026, 9, 24).getDay(), 6, 'fixture: Oct 24 2026 is a Saturday');

function makeWorld(opts) {
  opts = opts || {};
  const mem = {
    onboarding: { autoStart: true, autoStartTime: '08:00', autoStartDays: [1, 2, 3, 4, 5, 6] },
    dsp_active: opts.active || null,
    dsp_list: opts.list || [],
    sessions: []
  };
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const pushes = [], lmKeys = [], stKeys = [];
  const sb = {
    console: console, Date: FakeDate,
    store: store, todayStr: todayStrOf,
    confirm: function () { return false; },
    resetAccum: function () {}, trackerSave: function () {}, trackerPaint: function () {},
    maybePromptOdo: function () { return false; },
    el: function () { return { classList: { add: function () {}, remove: function () {} }, value: '' }; },
    LiveMiles: { startDay: function (k) { lmKeys.push(k); return true; }, syncWake: function () {} },
    GeoLoads: { startDay: function () {}, today: function () { return null; } },
    ShiftTrack: {
      sessionStarted: function (k) { stKeys.push(k); },
      pushBubbleState: function (s) { pushes.push(s); }
    },
    App: { tracker: { status: 'idle', startTs: 0, elapsed: 0 }, userRole: function () { return 'driver'; } }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(engine + '\n' + fmtClockCode + '\n' + loadsCode + '\n' + trackerSlice + '\n' + bubbleCode, sb);
  return { sb: sb, App: sb.App, pushes: pushes, lmKeys: lmKeys, stKeys: stKeys, mem: mem };
}
const DSP_SAT_0800 = { id: 'd-sat', jobSite: 'Aecon Inf', scheduledAt: '2026-10-24T08:00', status: 'active' };

/* ============ 1: no dispatch + fresh day => tracker NOT counting ============ */
console.log('— 1: Saturday, no dispatch — nothing runs uncommanded —');
{
  setClock(18, 14, 0);
  const w = makeWorld({});
  eq(w.App.checkAutoStart(), 'no-work-today', '1a the engine starts nothing on a no-work day');
  eq(w.App.tracker.status, 'idle', '1b tracker idle');
  eq(w.App.tracker.elapsed, 0, '1c no elapsed');
  eq(w.stKeys.length, 0, '1d no native session was started');
}

/* ============ 2: manual start, no dispatch => counts from the tap ============ */
console.log('— 2: his tap at 18:14 starts at the tap —');
{
  setClock(18, 14, 0);
  const w = makeWorld({});
  const tap = fakeNow;
  w.App.trackerToggle();
  eq(w.App.tracker.status, 'running', '2a manual start runs');
  eq(w.App.tracker.elapsed, 0, '2b elapsed is zero at the tap — NOT backdated to 8:00');
  eq(w.App.tracker.startTs, tap, '2c startTs is the tap');
  eq(w.App.tracker.sessionId, tap, '2d session identity is the tap');
  eq(w.sb.trackerElapsedSec(), 0, '2e the one derivation reads 0 at the tap');
  eq(w.sb.trackerSessionStartMs(), tap, '2f "Counting from" = the tap time');
  eq(JSON.stringify(w.lmKeys), JSON.stringify(['s' + tap]), '2g miles key off the tapped session');
  setClock(18, 24, 0);
  eq(w.sb.trackerElapsedSec(), 600, '2h ten minutes later the clock reads 10:00, once');
  /* the bubble push for the same moment carries the same number */
  w.sb.pushBubbleFace(w.sb.trackerElapsedSec());
  eq(w.pushes[w.pushes.length - 1].primary, '00:10:00', '2i bubble clock == web clock for the same session');
  eq(w.pushes[w.pushes.length - 1].primary, w.sb.fmtClock(w.sb.trackerElapsedSec()), '2j bubble == fmtClock(the one derivation)');
}

/* ============ 3: dispatch day auto-start => starts at dispatch time ============ */
console.log('— 3: dispatch day — auto-start still anchors to the dispatch —');
{
  setClock(8, 37, 0);
  const w = makeWorld({ active: DSP_SAT_0800, list: [DSP_SAT_0800] });
  eq(w.App.checkAutoStart(), 'started', '3a dispatch auto-start fires');
  eq(w.App.tracker.elapsed, 37 * 60, '3b elapsed counts from the 08:00 dispatch time');
  ok(Math.abs(w.App.tracker.startTs - fakeNow) < 1000, '3c startTs is the wake (single-encoded — the span lives in elapsed only)');
  eq(w.App.tracker.sessionId, msOf(8, 0, 0), '3d session identity = the dispatch time');
  eq(w.sb.trackerElapsedSec(), 37 * 60, '3e the one derivation reads 37:00 — NOT 74:00 (no double count)');
  eq(w.sb.trackerSessionStartMs(), msOf(8, 0, 0), '3f "Counting from 8:00 AM"');
  setClock(8, 47, 0);
  w.sb.pushBubbleFace(w.sb.trackerElapsedSec());
  eq(w.pushes[w.pushes.length - 1].primary, '00:47:00', '3g bubble == web for the auto-started session too');
}

/* ============ 4: manual start on a dispatch day => still the tap ============ */
console.log('— 4: manual tap beats the schedule — the schedule is auto-start\u2019s alone —');
{
  setClock(7, 22, 0);
  const w = makeWorld({ active: DSP_SAT_0800, list: [DSP_SAT_0800] });
  w.App.trackerToggle();
  eq(w.App.tracker.sessionId, fakeNow, '4a a 07:22 tap for an 08:00 dispatch starts at 07:22');
  eq(w.App.tracker.elapsed, 0, '4b elapsed zero at the tap');
  eq(w.sb.trackerSessionStartMs(), fakeNow, '4c counting from the tap');
}

/* ============ 5: his preset still wins ============ */
console.log('— 5: preset ("I actually started at…") —');
{
  setClock(18, 14, 0);
  const w = makeWorld({});
  w.App.tracker.presetStart = msOf(17, 52, 0);
  w.App.trackerToggle();
  eq(w.App.tracker.elapsed, 22 * 60, '5a preset start counts from his stated time');
  eq(w.sb.trackerSessionStartMs(), msOf(17, 52, 0), '5b counting from the preset');
}

/* ============ 6: statics — the seams the field bug lived in ============ */
console.log('— 6: statics —');
{
  ok(appSrc.indexOf('anchorPin') === -1, '6a the v174 manual-start anchor block is gone');
  ok((appSrc.match(/function trackerElapsedSec\(\)/g) || []).length === 1, '6b trackerElapsedSec is defined exactly once');
  const tickBody = sliceFn(appSrc, 'function trackerTick()', 'function trackerPaint()');
  ok(tickBody.indexOf('trackerElapsedSec()') !== -1, '6c the dashboard tick reads the one derivation');
  const pushBody = sliceFn(appSrc, 'function pushBubbleFace(sec)', 'function paintBubble');
  ok(pushBody.indexOf('if (!App._pip) return') === -1, '6d the bubble push is NOT gated on already being in PiP (no stale face)');
  const stopBody = sliceFn(appSrc, 'function stopSessionAt(', 'App.trackerStop = function');
  ok(stopBody.indexOf('trackerPaint()') !== -1, '6e stop repaints (and so re-pushes the cleared face: Ready to work · 00:00:00)');
  const planBody = sliceFn(appSrc, 'function autostartPlan(', 'function autostartTodayMs');
  ok(planBody.indexOf("'no-work-today'") !== -1, '6f the plan gate for setting-only days is in the shipped engine');
}

console.log('\nmanual-start-law-test: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
