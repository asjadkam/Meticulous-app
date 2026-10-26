#!/usr/bin/env node
/* Meticulous v123 — MOVEMENT ARMS, THE CLOCK DECIDES.
 *
 * The owner's rule (Oct 17, 2026, correcting his own looser phrasing
 * the same morning): the tracker session start time is ALWAYS the
 * dispatch's scheduled start time — "Has to start on at 8 AM not
 * earlier." He rolled out at 07:22 for an 08:00 dispatch; movement
 * (yardstart flipping the dispatch ACTIVE) must NEVER stamp the
 * session with the roll-out time, and the dashboard must show the
 * armed plan instead of a bare "Starts from now".
 *
 * These tests slice the REAL AUTOSTART-ENGINE region out of
 * js/app.js (same extraction as dispatch-autostart-test) and drive
 * it over a FAKE clock, so session-start equality is exact, not
 * approximate:
 *  A. movement at 07:22 (dispatch ACTIVE, 08:00) stamps NOTHING:
 *     checkAutoStart says 'not-yet', the tracker is untouched.
 *  B. at 08:00:00 exactly the session starts, stamped 08:00:00.
 *  C. app asleep until 08:37: the session starts backdated to
 *     08:00:00 exactly — never the wake time.
 *  D. v255 (owner, Sat Oct 24, 2026): no dispatch + no override
 *     -> NO plan at all. The standing setting alone is not a day
 *     of work; the tracker stays idle ('no-work-today').
 *  E. the armed-plan label (the dashboard line): dispatch plan
 *     names the dispatch; a setting-only day promises nothing;
 *     override notes itself; fired / off plans promise nothing.
 *  F. a plain manual Start with no plan still stamps the tap time.
 *  G. a closed session today -> 'done-today', never a phantom
 *     second start; a paused session is never force-resumed.
 *  H. statics: trackerPaint consults the armed label; the engine
 *     region holds no confirm(); yardstart stamps no session
 *     timestamps (it only arms).
 * Run: node tools/movement-arm-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const yardSrc = fs.readFileSync(path.join(ROOT, 'js', 'yardstart.js'), 'utf8');

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

/* ---------- fake clock ----------
   All scenario times are built from TODAY's real calendar date so
   the engine's date gates line up; the clock itself is frozen and
   only moves when a scenario moves it. */
const RealDate = Date;
function todayStrOf(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const NOW0 = new RealDate();
const Y = NOW0.getFullYear(), MO = NOW0.getMonth(), DA = NOW0.getDate();
const TODAY = todayStrOf(NOW0);
const DOW = NOW0.getDay();
function atMs(h, m) { return new RealDate(Y, MO, DA, h, m, 0, 0).getTime(); }
let fakeNow = atMs(7, 22);
class FakeDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fakeNow])); }
  static now() { return fakeNow; }
}
function setClock(h, m) { fakeNow = atMs(h, m); }

function makeWorld(opts) {
  opts = opts || {};
  const mem = {};
  mem.onboarding = opts.onboarding !== undefined ? opts.onboarding
    : { autoStart: true, autoStartTime: '08:00', autoStartDays: [0, 1, 2, 3, 4, 5, 6] };
  if ('active' in opts) mem.dsp_active = opts.active;
  if ('list' in opts) mem.dsp_list = opts.list;
  if ('override' in opts) mem.autostart_override = opts.override;
  if ('fired' in opts) mem.autostart = opts.fired;
  if ('sessions' in opts) mem.sessions = opts.sessions;
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const calls = { toggles: 0, confirms: [] };
  const sandbox = {
    console: console,
    Date: FakeDate,
    store: store,
    todayStr: todayStrOf,
    confirm: function (msg) { calls.confirms.push(msg); return false; },
    resetAccum: function () {},
    trackerSave: function () {},
    trackerPaint: function () {},
    maybePromptOdo: function () { return false; },
    App: {
      tracker: opts.tracker
        ? JSON.parse(JSON.stringify(opts.tracker))
        : { status: 'idle', startTs: 0, elapsed: 0 }
    }
  };
  sandbox.window = sandbox;
  /* the app's own session-start derivation (js/app.js
     trackerSessionStartMs), faithfully: idle -> presetStart || now;
     otherwise now minus the live elapsed. */
  sandbox.trackerSessionStartMs = function () {
    const t = sandbox.App.tracker;
    if (t.status === 'idle') return t.presetStart || FakeDate.now();
    const live = t.elapsed + (t.status === 'running' ? Math.floor((FakeDate.now() - t.startTs) / 1000) : 0);
    return FakeDate.now() - live * 1000;
  };
  /* spy with the real trackerToggle's idle-branch semantics (v28):
     presetStart counts the session from the preset time; a plain
     manual start stamps the tap time. */
  sandbox.App.trackerToggle = function () {
    calls.toggles++;
    const t = sandbox.App.tracker;
    if (t.status === 'idle') {
      t.status = 'running'; t.startTs = FakeDate.now();
      t.elapsed = t.presetStart ? Math.max(0, Math.floor((FakeDate.now() - t.presetStart) / 1000)) : 0;
      delete t.presetStart;
    } else if (t.status === 'running') { t.status = 'paused'; }
    else { t.status = 'running'; t.startTs = FakeDate.now(); }
  };
  vm.createContext(sandbox);
  vm.runInContext(region, sandbox);
  sandbox._mem = mem; sandbox._calls = calls;
  return sandbox;
}
function dsp0800Active() {
  /* the Oct 17 shape: today's Aecon dispatch, ACTIVE since the
     07:22 yard exit, scheduled 08:00 */
  return { id: 'd1', jobSite: 'Maple Ridge', scheduledAt: TODAY + 'T08:00', status: 'active' };
}

/* ================= A + B: movement arms, the clock stamps ================= */
console.log('— movement before dispatch time stamps nothing —');
{
  setClock(7, 22);
  const w = makeWorld({ active: dsp0800Active() });
  eq(w.App.checkAutoStart(), 'not-yet', 'A1 07:22 with an ACTIVE 08:00 dispatch -> not-yet');
  eq(w.App.tracker.status, 'idle', 'A2 tracker still idle after the roll-out');
  eq(w.App.tracker.startTs, 0, 'A3 movement wrote no startTs');
  eq(w.App.tracker.elapsed, 0, 'A4 movement wrote no elapsed');
  ok(!('presetStart' in w.App.tracker), 'A5 movement set no presetStart');
  ok(!w._mem.autostart, 'A6 movement did not consume the fired flag');

  /* B: the same world, clock reaches the dispatch time */
  setClock(8, 0);
  eq(w.App.checkAutoStart(), 'started', 'B1 at 08:00 the session starts');
  eq(w.trackerSessionStartMs(), atMs(8, 0), 'B2 session start is 08:00:00 exactly');
  eq(w.App.tracker.elapsed, 0, 'B3 no phantom minutes from the 07:22 roll-out');
}

/* ================= C: late wake backdates exactly ================= */
console.log('— late wake —');
{
  setClock(8, 37);
  const w = makeWorld({ active: dsp0800Active() });
  eq(w.App.checkAutoStart(), 'started', 'C1 app asleep until 08:37 -> started on open');
  eq(w.trackerSessionStartMs(), atMs(8, 0), 'C2 session start is the 08:00 dispatch time, not the 08:37 wake');
  eq(w.App.tracker.elapsed, 37 * 60, 'C3 elapsed counts from 08:00 (37m)');
  eq(w._calls.confirms.length, 0, 'C4 no prompt gates the late start');
}

/* ================= D: no dispatch -> no plan (v255) ================= */
console.log('— no dispatch: the standing time alone starts nothing —');
{
  setClock(9, 15);
  const w = makeWorld({}); // standing setting 08:00, all days, no dispatch anywhere
  eq(w.App.autostartTodayInfo().source, 'setting', 'D1 no dispatch -> setting source');
  eq(w.App.checkAutoStart(), 'no-work-today', 'D2 v255: no plan on a no-work day');
  eq(w.App.tracker.status, 'idle', 'D3 tracker stays idle — nothing runs uncommanded');
  eq(w.App.tracker.elapsed, 0, 'D4 no phantom elapsed accrues');
  ok(!w._mem.autostart, 'D5 the fired flag is not consumed by a non-start');
}

/* ================= E: the armed-plan label ================= */
console.log('— armed-plan label —');
{
  setClock(7, 22);
  let w = makeWorld({ active: dsp0800Active() });
  eq(w.App.autostartPlanLabel(w.App.autostartTodayInfo()), 'Starts 8:00 AM · Maple Ridge',
    'E1 dispatch plan: time + the dispatch named');

  w = makeWorld({});
  eq(w.App.autostartPlanLabel(w.App.autostartTodayInfo()), null,
    'E2 setting-only day: no plan is promised (v255 — the card falls back to "Starts from now")');

  w = makeWorld({ active: dsp0800Active(), override: { date: TODAY, time: '07:30' } });
  eq(w.App.autostartPlanLabel(w.App.autostartTodayInfo()), 'Starts 7:30 AM (changed for today)',
    'E3 override plan notes itself');

  w = makeWorld({ active: dsp0800Active(), fired: { [TODAY]: true } });
  eq(w.App.autostartPlanLabel(w.App.autostartTodayInfo()), null,
    'E4 a fired plan promises nothing (day underway/done)');

  w = makeWorld({ active: dsp0800Active(), onboarding: { autoStart: false, autoStartTime: '08:00', autoStartDays: [0, 1, 2, 3, 4, 5, 6] } });
  eq(w.App.autostartPlanLabel(w.App.autostartTodayInfo()), null,
    'E5 auto-start off -> no armed label');

  w = makeWorld({ active: dsp0800Active(), onboarding: { autoStart: true, autoStartTime: '08:00', autoStartDays: [(DOW + 1) % 7] } });
  eq(w.App.autostartPlanLabel(w.App.autostartTodayInfo()), null,
    'E6 a non-auto-start day -> no armed label');
}

/* ================= F: manual start with no plan stamps the tap ================= */
console.log('— manual override stays his —');
{
  setClock(7, 22);
  const w = makeWorld({ onboarding: { autoStart: false, autoStartTime: '08:00', autoStartDays: [0, 1, 2, 3, 4, 5, 6] } });
  eq(w.App.checkAutoStart(), 'off', 'F1 no plan -> engine stays out of the way');
  w.App.trackerToggle(); // his tap
  eq(w.App.tracker.status, 'running', 'F2 manual start runs');
  eq(w.trackerSessionStartMs(), atMs(7, 22), 'F3 manual start stamps the tap time (07:22)');
}

/* ================= G: done-today + paused ================= */
console.log('— once a day, and his pause is his —');
{
  setClock(9, 0);
  let w = makeWorld({ active: dsp0800Active(), sessions: [{ date: TODAY, seconds: 3600, endedAt: new RealDate(atMs(8, 30)).toISOString() }] });
  eq(w.App.checkAutoStart(), 'done-today', 'G1 a closed session today -> done-today, no phantom restart');
  eq(w.App.tracker.status, 'idle', 'G2 tracker stays idle after done-today');
  eq(w.App.checkAutoStart(), 'fired', 'G3 the day is consumed afterwards');

  w = makeWorld({ active: dsp0800Active(), tracker: { status: 'paused', startTs: atMs(8, 5), elapsed: 600 } });
  eq(w.App.checkAutoStart(), 'paused', 'G4 a paused session is never force-resumed');
  eq(w.App.tracker.status, 'paused', 'G5 still paused');
  eq(w.App.tracker.elapsed, 600, 'G6 paused elapsed untouched');
}

/* ================= I: stale sessions never eat the plan (v261) ================= */
console.log('— yesterday\'s session cannot consume today (v261) —');
{
  /* DSP-AUTOSTART-MISS-OCT26: a session that STARTED yesterday
     and was only closed this morning (its entry carries today's
     CLOSE date — stopSessionAt stamps the end day) is not
     today's work done: the 08:00 dispatch still starts. */
  setClock(9, 0);
  let w = makeWorld({
    active: dsp0800Active(),
    sessions: [{ date: TODAY, seconds: 20 * 3600, endedAt: new RealDate(atMs(7, 10)).toISOString() }]
  });
  eq(w.App.checkAutoStart(), 'started', 'I1 a session closed today but started yesterday does not consume the plan');
  eq(w.trackerSessionStartMs(), atMs(8, 0), 'I2 the dispatch start still stamps 08:00');

  /* a session still RUNNING from yesterday does not consume the
     plan either (the Oct 25 runaway test session, live at the
     morning's first check); once it ends, the plan fires on the
     next check, stamped at the dispatch time. */
  setClock(7, 30);
  w = makeWorld({
    active: dsp0800Active(),
    tracker: { status: 'running', startTs: atMs(7, 30) - 25 * 3600 * 1000, elapsed: 0 }
  });
  eq(w.App.checkAutoStart(), 'running-stale', 'I3 a running session from yesterday leaves the plan armed');
  ok(!w._mem.autostart, 'I4 the stale session did not consume the fired flag');
  w.App.tracker.status = 'idle'; w.App.tracker.startTs = 0; w.App.tracker.elapsed = 0;
  setClock(8, 5);
  eq(w.App.checkAutoStart(), 'started', 'I5 after the stale session ends, the plan fires');
  eq(w.trackerSessionStartMs(), atMs(8, 0), 'I6 and stamps the 08:00 dispatch time, not the stale session\'s end');
}

/* ================= H: statics ================= */
console.log('— statics —');
{
  ok(appSrc.indexOf('App.autostartPlanLabel(App.autostartTodayInfo())') !== -1,
    'H1 trackerPaint consults the armed label for the dashboard card');
  ok(!/confirm\(/.test(region), 'H2 the auto-start engine holds no prompt');
  ok(!/\.startTs\s*=/.test(yardSrc) && !/\.elapsed\s*=/.test(yardSrc) && !/presetStart/.test(yardSrc),
    'H3 yardstart stamps no session timestamps — it only arms');
  ok(yardSrc.indexOf('App.checkAutoStart()') !== -1,
    'H4 yardstart still nudges the engine on yard exit (the arm)');
  ok(appSrc.indexOf("armed || 'Starts from now'") !== -1,
    'H5 "Starts from now" survives only as the no-plan fallback');
}

console.log('\nmovement-arm-test: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
