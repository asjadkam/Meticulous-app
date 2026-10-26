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
 *  J. MILES-DISPATCH-GATE (v263, owner, Mon Oct 26, 2026 08:25
 *     MDT — "If the Dispatch is active only then is it suppose
 *     to catch my inactive miles... Not if I am personally
 *     moving about"): App.armDayMiles (same region slice) arms
 *     the passive day watch ONLY while a dispatch claims today
 *     (the engine's own resolution: scheduledAt date or `date`
 *     field; completed/cancelled claim nothing; untimed still
 *     claims). No dispatch -> never armed; a mid-day cancel
 *     stands capture down but the captured day record stays;
 *     a dispatch landing mid-day arms from that point; a
 *     session's own miles are never gated.
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
  /* v263: a fake LiveMiles with the real one's contract —
     startDay begins (or reattaches) the watch under a key;
     stopDay stops the watch and PERSISTS the record (the record
     stays in `records` — standing down never erases). */
  if (opts.liveMiles) {
    const lm = {
      starts: [], stops: 0, records: {}, _key: opts.liveKey || null,
      startDay: function (k) { lm.starts.push(k); lm._key = k; if (!lm.records[k]) lm.records[k] = { key: k }; return true; },
      stopDay: function () { lm.stops++; const k = lm._key; lm._key = null; return { liveKm: null, key: k }; },
      dayKey: function () { return lm._key; }
    };
    if (lm._key && !lm.records[lm._key]) lm.records[lm._key] = { key: lm._key };
    sandbox.LiveMiles = lm;
    sandbox._lm = lm;
  }
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

/* ================= J: miles catch only on a dispatch day (v263) ================= */
console.log('— MILES-DISPATCH-GATE: passive miles need an active dispatch —');
{
  const YDAY = todayStrOf(new RealDate(Y, MO, DA - 1));
  const TMRO = todayStrOf(new RealDate(Y, MO, DA + 1));

  /* no dispatch anywhere: boot + resume + watchdog never arm */
  setClock(9, 0);
  let w = makeWorld({ liveMiles: true });
  eq(w.App.armDayMiles(), 'no-dispatch', 'J1a no dispatch today -> the day watch never arms');
  eq(w.App.armDayMiles(), 'no-dispatch', 'J1b a later re-check (watchdog/resume) changes nothing');
  eq(w._lm.starts.length, 0, 'J1c LiveMiles.startDay was never called');
  eq(w._lm.dayKey(), null, 'J1d no watch is live — personal movement records nothing');
  eq(w.App.checkAutoStart(), 'no-work-today', 'J1e the start plan is untouched by the gate (v255 holds)');

  /* a dispatch for TOMORROW does not arm today */
  w = makeWorld({ liveMiles: true, list: [{ id: 'dT', jobSite: 'Future', scheduledAt: TMRO + 'T08:00', status: 'active' }] });
  eq(w.App.armDayMiles(), 'no-dispatch', 'J2 tomorrow\'s dispatch does not arm today');

  /* a dispatch day arms — once */
  w = makeWorld({ liveMiles: true, active: dsp0800Active() });
  eq(w.App.armDayMiles(), 'armed', 'J3a an active dispatch for today arms the day watch');
  eq(w._lm.starts.join(','), 'd' + TODAY, 'J3b armed under today\'s date key');
  eq(w.App.armDayMiles(), 'armed', 'J3c a repeat call is a no-op (already armed)');
  eq(w._lm.starts.length, 1, 'J3d startDay ran exactly once');

  /* untimed shapes claim the day too (the v261 resolution):
     a `date`-field record, and a date-only scheduledAt */
  w = makeWorld({ liveMiles: true, list: [{ id: 'dC', jobSite: 'Connect', scheduledAt: '', date: TODAY, status: 'active' }] });
  eq(w.App.armDayMiles(), 'armed', 'J4a a Connect-shaped record (date field, no time) arms the watch');
  w = makeWorld({ liveMiles: true, list: [{ id: 'dD', jobSite: 'DateOnly', scheduledAt: TODAY, status: 'active' }] });
  eq(w.App.armDayMiles(), 'armed', 'J4b a date-only scheduledAt arms the watch');

  /* completed / cancelled claim nothing */
  w = makeWorld({ liveMiles: true, active: Object.assign(dsp0800Active(), { status: 'completed' }) });
  eq(w.App.armDayMiles(), 'no-dispatch', 'J5a a completed dispatch does not arm');
  w = makeWorld({ liveMiles: true, active: Object.assign(dsp0800Active(), { status: 'cancelled' }) });
  eq(w.App.armDayMiles(), 'no-dispatch', 'J5b a cancelled dispatch does not arm');

  /* cancelled mid-day: capture stands down, the morning's
     kilometres stay on the day, and a fresh dispatch re-arms
     the SAME day record */
  w = makeWorld({ liveMiles: true, active: dsp0800Active() });
  eq(w.App.armDayMiles(), 'armed', 'J6a armed under the morning dispatch');
  w._mem.dsp_active = Object.assign(dsp0800Active(), { status: 'cancelled' });
  eq(w.App.armDayMiles(), 'stood-down', 'J6b cancelling the dispatch stands the watch down');
  eq(w._lm.stops, 1, 'J6c stopDay ran once (it persists — it does not erase)');
  ok(w._lm.records['d' + TODAY], 'J6d the day record captured under the dispatch is retained');
  eq(w._lm.dayKey(), null, 'J6e no watch is live after the stand-down');
  w._mem.dsp_active = { id: 'd2', jobSite: 'Afternoon', scheduledAt: TODAY + 'T13:00', status: 'active' };
  eq(w.App.armDayMiles(), 'armed', 'J6f a dispatch landing mid-day arms capture from that point');
  eq(w._lm.starts.length, 2, 'J6g re-armed under the same day key');
  ok(w._lm.records['d' + TODAY], 'J6h still the one day record');

  /* a session owns its miles — the gate never touches it,
     dispatch or not (a manual start is his explicit act) */
  w = makeWorld({ liveMiles: true, tracker: { status: 'running', startTs: atMs(9, 0), elapsed: 120 } });
  eq(w.App.armDayMiles(), 'session', 'J7a a running session owns the miles (no dispatch needed)');
  eq(w._lm.starts.length + w._lm.stops, 0, 'J7b the gate made no LiveMiles calls');
  w = makeWorld({ liveMiles: true, tracker: { status: 'paused', startTs: atMs(9, 0), elapsed: 120 } });
  eq(w.App.armDayMiles(), 'session', 'J7c a paused session owns the miles too');

  /* office never drives */
  w = makeWorld({ liveMiles: true, active: dsp0800Active() });
  w.App.userRole = function () { return 'office'; };
  eq(w.App.armDayMiles(), 'office', 'J8a office role: no watch, dispatch or not');
  eq(w._lm.starts.length, 0, 'J8b nothing armed for office');

  /* midnight rollover: yesterday's watch stands down when
     today has no dispatch — and yesterday's record stays */
  w = makeWorld({ liveMiles: true, liveKey: 'd' + YDAY });
  eq(w.App.armDayMiles(), 'stood-down', 'J9a yesterday\'s passive watch stands down on a dispatch-less today');
  ok(w._lm.records['d' + YDAY], 'J9b yesterday\'s record is retained');

  /* a SESSION-keyed watch is never the gate's to stand down */
  w = makeWorld({ liveMiles: true, liveKey: 's' + atMs(8, 0) });
  eq(w.App.armDayMiles(), 'no-dispatch', 'J10a no dispatch: the gate still does not arm');
  eq(w._lm.stops, 0, 'J10b a session-keyed watch is left alone');
  eq(w._lm.dayKey(), 's' + atMs(8, 0), 'J10c the session watch is untouched');
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
