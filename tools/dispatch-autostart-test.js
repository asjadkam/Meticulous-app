#!/usr/bin/env node
/* Meticulous v53 — dispatch-driven auto-start: behavioral tests against
 * the REAL shipped code. The AUTOSTART-ENGINE region of js/app.js
 * (autoStartPrefs -> pure effective-time functions -> App.checkAutoStart)
 * is sliced out verbatim and driven in a vm sandbox over an in-memory
 * store, with a spy trackerToggle that reproduces the v28 presetStart
 * semantics of the real one — so the logic under test is the logic that
 * ships. Static assertions then pin the Revenue card wiring in
 * modules/autostart.js (the "Today:" line + Change affordance).
 * Run: node tools/dispatch-autostart-test.js
 *
 * Covers Asjad's Oct 14, 2026 spec: "whatever the start time says on the
 * Dispatch... It should be automatically set as an auto starter" +
 * refinement "Can be changed but as a default dispatch time":
 *  - dispatch today 06:30 + standing 08:00 -> effective 06:30, 'dispatch'
 *  - no dispatch -> standing time, source 'setting'
 *  - dispatch tomorrow -> standing time today (no leak across days)
 *  - two dispatches today -> earliest wins (active + saved, dedup by id)
 *  - completed/cancelled dispatch -> claim cleared, fallback restored
 *  - per-day override beats the dispatch default; clearing the override
 *    restores the dispatch default; yesterday's override never leaks
 *  - auto-start OFF / wrong day -> no start regardless of dispatch
 *    (dispatch changes the WHEN, never the WHETHER)
 *  - engine fires while open: session anchored to the dispatch time
 *  - missed start (app asleep past the time): starts on next open,
 *    backdated to the dispatch time, with NO prompt (v123 — the
 *    owner's Oct 17, 2026 rule supersedes the v53 prompt: "Has to
 *    start on at 8 AM not earlier"; a start that waits for a tap is
 *    a start that may never happen)
 *  - the standing setting anchors identically (fallback equivalence)
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const asSrc = fs.readFileSync(path.join(ROOT, 'modules', 'autostart.js'), 'utf8');

function extract(s, beginMark, endMark) {
  const a = s.lastIndexOf('/*', s.indexOf(beginMark));
  const b = s.indexOf('*/', s.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return s.slice(a, b + 2);
}
const region = extract(appSrc, 'AUTOSTART-ENGINE-BEGIN', 'AUTOSTART-ENGINE-END');

/* ---------- assertions ---------- */
let pass = 0, fail = 0;
const failures = [];
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; failures.push(name); console.log('  FAIL: ' + name); }
}
function eq(got, want, name) { ok(got === want, name + ' (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')'); }

/* ---------- world ---------- */
function todayStrOf(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function hhmm(d) { return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
const NOW = new Date();
const TODAY = todayStrOf(NOW);
const TOMORROW = todayStrOf(new Date(NOW.getTime() + 24 * 3600 * 1000));
const YESTERDAY = todayStrOf(new Date(NOW.getTime() - 24 * 3600 * 1000));
const DOW = NOW.getDay();
/* a time safely inside today: `minsAgo` minutes before now, clamped so
   it never crosses midnight (keeps the suite stable at any run time) */
function minsAgoTime(minsAgo) {
  let d = new Date(NOW.getTime() - minsAgo * 60000);
  if (todayStrOf(d) !== TODAY) d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 0, 5, 0, 0);
  return d;
}
function minsAheadTime(minsAhead) {
  let d = new Date(NOW.getTime() + minsAhead * 60000);
  if (todayStrOf(d) !== TODAY) d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 23, 55, 0, 0);
  return d;
}

function makeWorld(opts) {
  opts = opts || {};
  const mem = {};
  mem.onboarding = opts.onboarding !== undefined ? opts.onboarding
    : { autoStart: true, autoStartTime: '08:00', autoStartDays: [0, 1, 2, 3, 4, 5, 6] };
  if ('active' in opts) mem.dsp_active = opts.active;
  if ('list' in opts) mem.dsp_list = opts.list;
  if ('override' in opts) mem.autostart_override = opts.override;
  if ('fired' in opts) mem.autostart = opts.fired;
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const calls = { toggles: 0, confirms: [] };
  const sandbox = {
    console: console,
    store: store,
    todayStr: todayStrOf,
    confirm: function (msg) { calls.confirms.push(msg); return !!opts.confirm; },
    resetAccum: function () {},
    trackerSave: function () {},
    trackerPaint: function () {},
    maybePromptOdo: function () { return false; },
    trackerSessionStartMs: function () { return Date.now(); },
    App: {
      tracker: { status: opts.trackerStatus || 'idle', startTs: 0, elapsed: 0 }
    }
  };
  sandbox.window = sandbox;
  /* spy with the real trackerToggle's idle-branch semantics (v28):
     presetStart counts the session from the preset time */
  sandbox.App.trackerToggle = function () {
    calls.toggles++;
    const t = sandbox.App.tracker;
    if (t.status === 'idle') {
      t.status = 'running'; t.startTs = Date.now();
      t.elapsed = t.presetStart ? Math.max(0, Math.floor((Date.now() - t.presetStart) / 1000)) : 0;
      delete t.presetStart;
    } else if (t.status === 'running') { t.status = 'paused'; }
    else { t.status = 'running'; t.startTs = Date.now(); }
  };
  vm.createContext(sandbox);
  vm.runInContext(region + '\n;this.__E = { effective: autostartEffective, plan: autostartPlan, dispatchTimeFor: autostartDispatchTimeFor, todayMs: autostartTodayMs, parseSched: autostartParseSched };', sandbox);
  sandbox._mem = mem; sandbox._calls = calls;
  return sandbox;
}
function dsp(id, date, time, status) {
  return { id: id, jobSite: 'Site ' + id, scheduledAt: date + 'T' + time, status: status || 'saved' };
}

/* ================= pure engine: precedence ================= */
console.log('— effective-time precedence —');
{
  const prefs = { enabled: true, time: '08:00', days: [0, 1, 2, 3, 4, 5, 6] };
  const w = makeWorld({});
  const E = w.__E;

  let r = E.effective(prefs, dsp('a', TODAY, '06:30'), [], null, TODAY);
  eq(r.time, '06:30', 'dispatch today 06:30 beats standing 08:00');
  eq(r.source, 'dispatch', 'source is dispatch');

  r = E.effective(prefs, null, [], null, TODAY);
  eq(r.time, '08:00', 'no dispatch -> standing time');
  eq(r.source, 'setting', 'source is setting');

  r = E.effective(prefs, null, [dsp('t', TOMORROW, '06:30')], null, TODAY);
  eq(r.time, '08:00', 'dispatch tomorrow does not affect today');
  eq(r.source, 'setting', 'tomorrow dispatch -> setting source');

  r = E.effective(prefs, dsp('a', TODAY, '09:00'), [dsp('a', TODAY, '09:00'), dsp('b', TODAY, '06:30')], null, TODAY);
  eq(r.time, '06:30', 'two dispatches today -> earliest wins (dedup by id)');

  r = E.effective(prefs, null, [dsp('b', TODAY, '06:30'), dsp('a', TODAY, '09:00')], null, TODAY);
  eq(r.time, '06:30', 'earliest wins regardless of list order');

  r = E.effective(prefs, null, [dsp('c', TODAY, '06:30', 'completed')], null, TODAY);
  eq(r.source, 'setting', 'completed dispatch has no claim');
  r = E.effective(prefs, null, [dsp('c', TODAY, '06:30', 'cancelled')], null, TODAY);
  eq(r.source, 'setting', 'cancelled dispatch has no claim');
  r = E.effective(prefs, dsp('c', TODAY, '06:30', 'completed'), [], null, TODAY);
  eq(r.source, 'setting', 'completed ACTIVE dispatch has no claim');

  r = E.effective(prefs, { id: 'x', jobSite: 'No time' }, [], null, TODAY);
  eq(r.source, 'setting', 'dispatch without scheduledAt is ignored');
  r = E.effective(prefs, null, [{ id: 'y', scheduledAt: TODAY + ' 07:45', status: 'saved' }], null, TODAY);
  eq(r.time, '07:45', 'space-separated scheduledAt parses');

  /* override: the per-day manual change beats the dispatch default */
  r = E.effective(prefs, dsp('a', TODAY, '06:30'), [], { date: TODAY, time: '07:15' }, TODAY);
  eq(r.time, '07:15', 'override beats dispatch time');
  eq(r.source, 'override', 'source is override');
  r = E.effective(prefs, dsp('a', TODAY, '06:30'), [], null, TODAY);
  eq(r.time, '06:30', 'clearing the override restores the dispatch default');
  r = E.effective(prefs, dsp('a', TODAY, '06:30'), [], { date: YESTERDAY, time: '05:00' }, TODAY);
  eq(r.time, '06:30', "yesterday's override does not leak into today");
  r = E.effective(prefs, null, [], { date: TODAY, time: '7:15' }, TODAY);
  eq(r.source, 'setting', 'malformed override time is ignored');

  /* plan: the WHETHER gate stays with the standing setting */
  let p = E.plan({ enabled: false, time: '08:00', days: [0, 1, 2, 3, 4, 5, 6] }, dsp('a', TODAY, '06:30'), [], null, TODAY, DOW);
  eq(p.willStart, false, 'auto-start OFF -> no start regardless of dispatch');
  eq(p.reason, 'off', 'off reason reported');
  p = E.plan({ enabled: true, time: '08:00', days: [(DOW + 1) % 7] }, dsp('a', TODAY, '06:30'), [], null, TODAY, DOW);
  eq(p.willStart, false, 'wrong day -> no start regardless of dispatch');
  eq(p.reason, 'wrong-day', 'wrong-day reason reported');
  p = E.plan(prefs, dsp('a', TODAY, '06:30'), [], null, TODAY, DOW);
  eq(p.willStart, true, 'enabled + right day -> will start');
  eq(p.time, '06:30', 'plan carries the dispatch time');

  /* anchor math for backdated starts */
  eq(E.todayMs(TODAY, '06:30'), new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 6, 30, 0, 0).getTime(),
    'todayMs anchors to today at the given local time');
  eq(E.parseSched('2026-10-14T08:00').date, '2026-10-14', 'parseSched date part');
  eq(E.parseSched('2026-10-14T08:00').time, '08:00', 'parseSched time part');
  eq(E.parseSched(''), null, 'parseSched empty -> null');
  eq(E.parseSched(null), null, 'parseSched null -> null');
}

/* ================= checkAutoStart behavior ================= */
console.log('— checkAutoStart behavior —');
{
  /* dispatch 30 min ago, app open (minute tick): silent start ANCHORED
     to the dispatch time — elapsed ~30 min, not ~0 */
  const t30 = minsAgoTime(30);
  let w = makeWorld({ active: dsp('a', TODAY, hhmm(t30)) });
  eq(w.App.checkAutoStart(), 'started', 'dispatch time reached while open -> started');
  eq(w.App.tracker.status, 'running', 'tracker running after dispatch auto-start');
  ok(w.App.tracker.elapsed >= 25 * 60 && w.App.tracker.elapsed <= 35 * 60,
    'session anchored to dispatch time (elapsed ~30m, got ' + w.App.tracker.elapsed + 's)');

  /* standing setting 30 min ago, no dispatch: v123 fallback
     equivalence — the no-dispatch plan anchors to its time exactly
     like a dispatch plan (before v123 it counted from the wake) */
  w = makeWorld({ onboarding: { autoStart: true, autoStartTime: hhmm(t30), autoStartDays: [0, 1, 2, 3, 4, 5, 6] } });
  eq(w.App.checkAutoStart(), 'started', 'standing time reached -> started');
  ok(w.App.tracker.elapsed >= 25 * 60 && w.App.tracker.elapsed <= 35 * 60,
    'standing-setting start anchored to the setting time (elapsed ~30m, got ' + w.App.tracker.elapsed + 's)');

  /* missed start: dispatch 3h ago, app was asleep -> on open it starts
     by itself, backdated to the dispatch time, and NO prompt is shown
     (v123: the confirm gate is gone — a start that waits for a tap is
     a start that may never happen) */
  const t3h = minsAgoTime(180);
  w = makeWorld({ active: dsp('a', TODAY, hhmm(t3h)), confirm: true });
  eq(w.App.checkAutoStart(), 'started', 'missed dispatch start -> started on open, no prompt');
  ok(w.App.tracker.elapsed >= 170 * 60 && w.App.tracker.elapsed <= 190 * 60,
    'missed start backdated to dispatch time (elapsed ~3h, got ' + w.App.tracker.elapsed + 's)');
  eq(w._calls.confirms.length, 0, 'no confirmation prompt is shown for a missed start');
  eq(w._calls.toggles, 0, 'missed start does not route through the manual toggle');

  /* same world with a "declining" confirm: the answer is never asked,
     so it cannot veto the start */
  w = makeWorld({ active: dsp('a', TODAY, hhmm(t3h)), confirm: false });
  eq(w.App.checkAutoStart(), 'started', 'missed start starts regardless of any would-be decline');
  eq(w.App.tracker.status, 'running', 'missed start leaves the tracker running, anchored');

  /* override anchors too, and beats an even-later dispatch time */
  w = makeWorld({
    active: dsp('a', TODAY, hhmm(minsAgoTime(10))),
    override: { date: TODAY, time: hhmm(t30) }
  });
  eq(w.App.checkAutoStart(), 'started', 'override time reached -> started');
  ok(w.App.tracker.elapsed >= 25 * 60 && w.App.tracker.elapsed <= 35 * 60,
    'override start anchored to the override time, not the dispatch time');

  /* gates: off / wrong day / already fired / not yet */
  w = makeWorld({ onboarding: { autoStart: false, autoStartTime: '08:00', autoStartDays: [0, 1, 2, 3, 4, 5, 6] }, active: dsp('a', TODAY, hhmm(t30)) });
  eq(w.App.checkAutoStart(), 'off', 'auto-start off -> off even with a dispatch due');
  eq(w.App.tracker.status, 'idle', 'off leaves tracker idle');

  w = makeWorld({ onboarding: { autoStart: true, autoStartTime: '08:00', autoStartDays: [(DOW + 1) % 7] }, active: dsp('a', TODAY, hhmm(t30)) });
  eq(w.App.checkAutoStart(), 'wrong-day', 'non-auto-start day -> wrong-day even with a dispatch due');

  w = makeWorld({ active: dsp('a', TODAY, hhmm(t30)), fired: { [TODAY]: true } });
  eq(w.App.checkAutoStart(), 'fired', 'already fired today -> fired');

  w = makeWorld({ active: dsp('a', TODAY, hhmm(minsAheadTime(60))), onboarding: { autoStart: true, autoStartTime: hhmm(minsAheadTime(90)), autoStartDays: [0, 1, 2, 3, 4, 5, 6] } });
  eq(w.App.checkAutoStart(), 'not-yet', 'dispatch later today -> not-yet');

  /* completing today's dispatch restores the standing fallback: the
     dispatch time (30m ago) no longer claims the start; the standing
     time (90m ahead) governs -> not-yet, no spurious start */
  w = makeWorld({
    list: [dsp('a', TODAY, hhmm(t30), 'completed')],
    onboarding: { autoStart: true, autoStartTime: hhmm(minsAheadTime(90)), autoStartDays: [0, 1, 2, 3, 4, 5, 6] }
  });
  eq(w.App.checkAutoStart(), 'not-yet', 'completed dispatch -> standing fallback restored');
  eq(w.App.tracker.status, 'idle', 'completed dispatch does not start the tracker');
}

/* ================= Revenue card wiring (static) ================= */
console.log('— Revenue card wiring —');
{
  ok(asSrc.indexOf('autostartTodayInfo') !== -1, 'card reads App.autostartTodayInfo');
  ok(asSrc.indexOf('(from Dispatch)') !== -1, 'card wording: (from Dispatch)');
  ok(asSrc.indexOf('(your setting)') !== -1, 'card wording: (your setting)');
  ok(asSrc.indexOf('no auto-start scheduled') !== -1, 'card wording: no auto-start scheduled');
  ok(asSrc.indexOf('_ovset') !== -1, 'card has a Set-for-today (Change) affordance');
  ok(asSrc.indexOf('_ovclear') !== -1, 'card has a Clear affordance for the override');
  ok(asSrc.indexOf('setAutostartOverride') !== -1, 'Change writes via App.setAutostartOverride');
  ok(asSrc.indexOf('clearAutostartOverride') !== -1, 'Clear goes via App.clearAutostartOverride');
  ok(appSrc.indexOf("store.get('autostart_override'") !== -1 || appSrc.indexOf('store.get("autostart_override"') !== -1,
    'app reads the per-day override from the synced store');
  ok(!/alert\(|confirm\(/.test(asSrc.slice(asSrc.indexOf('todayHTML') === -1 ? 0 : asSrc.indexOf('todayHTML'))),
    'no new native dialog in the card code');
}

console.log('\ndispatch-autostart-test: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
