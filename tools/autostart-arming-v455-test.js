#!/usr/bin/env node
/* Meticulous v455 — AUTOSTART-ARMING (Nov 14, 2026).
 *
 * The defect, from Asjad's own screen recording (Sat Nov 14, 2026,
 * ~08:31 MST): the Revenue auto-start card shows his saved setting —
 * "Start the tracker by itself" CHECKED, 07:00 a.m., Mon–Sat checked
 * (Sun unchecked) — yet the same card's Today line reads "no
 * auto-start scheduled", and the dashboard at 08:31 shows the timer
 * at 00:00:00 / "Starts from now": no session started, nothing
 * backdated to 07:00. There is NO dispatch for Nov 14, so the saved
 * setting governs (standing law: a dispatch governs only when one
 * exists for today, at its edited time; otherwise the saved
 * days/time govern). The card's own note promises: "if the app was
 * closed, it starts counting from this time when you open it."
 *
 * Root cause pinned by this bench: autostartPlan's v255 gate —
 * a day whose effective source is the standing SETTING (no dispatch,
 * no override) returns willStart:false / 'no-work-today', so the
 * engine returns before its (intact) backdated-start code, the card
 * reads the same plan and reports "no auto-start scheduled", the
 * native arm disarms, and the dashboard label stays null. The v255
 * rule (Oct 24, 2026) made the standing time "only a fallback FOR a
 * dispatch day"; the owner's Nov 14, 2026 word supersedes it — a
 * checked day with the setting on IS a scheduled day.
 *
 * The fix this bench pins:
 *  A. plan/info: a checked day, setting on, no dispatch -> willStart,
 *     source 'setting', the saved time; the REAL card renders
 *     "Today: starts 7:00 AM (your setting)".
 *  B. engine: opening at/after the saved time starts the session
 *     BACKDATED to the saved time (elapsed = now - saved time,
 *     sessionId = the saved-time anchor) — never "from now".
 *     Before the time: 'not-yet', tracker idle.
 *  C. an UNCHECKED day never starts (the Sunday-phantom law), with
 *     or without a dispatch — the days gate is the WHETHER.
 *  D. a dispatch for today still governs at its (edited) time over
 *     the saved time; the card says "(from Dispatch)".
 *  E. a CLOSED day stays closed: a session started+stopped today
 *     (done-today), a completed dispatch with no session entry (the
 *     v411 idle-surface close), and the v440 echo shape (record
 *     rolled back open, completion Revenue line standing) all refuse
 *     the start — 'closed-today', tracker idle, card willStart false.
 *     A completed MORNING dispatch does not close the day against a
 *     still-open dispatch for today.
 *  F. the native-arm selection (App.autostartNextInfo, the same
 *     today-then-tomorrow choice App.armNativeDay arms by) offers
 *     the setting day's start, and never offers a closed today.
 *  G. the per-day override (v447) still makes its plan and anchors.
 *
 * Method: the AUTOSTART-ENGINE region of js/app.js is sliced out
 * verbatim and driven in a vm sandbox over an in-memory store with
 * a frozen clock (the movement-arm pattern), plus the REAL
 * modules/autostart.js card rendered in jsdom over the engine's own
 * autostartTodayInfo. Run: node tools/autostart-arming-v455-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
let JSDOM;
try { JSDOM = require('jsdom').JSDOM; }
catch (e) { JSDOM = require('/home/hatch/workspace/ship-work/autostart447/node_modules/jsdom').JSDOM; }

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

/* ---------- frozen clock over TODAY's real calendar date ---------- */
const RealDate = Date;
function todayStrOf(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const NOW0 = new RealDate();
const Y = NOW0.getFullYear(), MO = NOW0.getMonth(), DA = NOW0.getDate();
const TODAY = todayStrOf(NOW0);
const TOMORROW = todayStrOf(new RealDate(Y, MO, DA + 1));
const DOW = NOW0.getDay();
function atMs(h, m) { return new RealDate(Y, MO, DA, h, m, 0, 0).getTime(); }
let fakeNow = atMs(8, 31);
class FakeDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fakeNow])); }
  static now() { return fakeNow; }
}
function setClock(h, m) { fakeNow = atMs(h, m); }

/* his saved setting from the recording: on, 07:00, every day but one
   (Mon–Sat in the recording; here: today checked, another day out) */
const CHECKED_DAYS = [0, 1, 2, 3, 4, 5, 6].filter(function (d) { return d !== (DOW + 3) % 7; });
const UNCHECKED_DAYS = [0, 1, 2, 3, 4, 5, 6].filter(function (d) { return d !== DOW; });
function settingOnb(days) { return { autoStart: true, autoStartTime: '07:00', autoStartDays: days || CHECKED_DAYS }; }

function makeWorld(opts) {
  opts = opts || {};
  const mem = {};
  mem.onboarding = opts.onboarding !== undefined ? opts.onboarding : settingOnb();
  if ('active' in opts) mem.dsp_active = opts.active;
  if ('list' in opts) mem.dsp_list = opts.list;
  if ('override' in opts) mem.autostart_override = opts.override;
  if ('fired' in opts) mem.autostart = opts.fired;
  if ('sessions' in opts) mem.sessions = opts.sessions;
  if ('rev' in opts) mem.rev_entries = opts.rev;
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const sandbox = {
    console: console,
    Date: FakeDate,
    store: store,
    todayStr: todayStrOf,
    resetAccum: function () {},
    trackerSave: function () {},
    trackerPaint: function () {},
    maybePromptOdo: function () { return false; },
    pinSplitDay: function () {}, // the real one lives at js/app.js pinSplitDay (v355), outside the region
    dayEngineStart: function () {},
    App: { tracker: { status: opts.trackerStatus || 'idle', startTs: 0, elapsed: 0 } }
  };
  sandbox.window = sandbox;
  sandbox.trackerSessionStartMs = function () {
    const t = sandbox.App.tracker;
    if (t.status === 'idle') return t.presetStart || FakeDate.now();
    const live = t.elapsed + (t.status === 'running' ? Math.floor((FakeDate.now() - t.startTs) / 1000) : 0);
    return FakeDate.now() - live * 1000;
  };
  vm.createContext(sandbox);
  vm.runInContext(region + '\n;this.__E = { plan: autostartPlan, dayClosed: (typeof autostartDayClosed === "function") ? autostartDayClosed : null };', sandbox);
  sandbox._mem = mem;
  return sandbox;
}
function dsp(id, time, status, extra) {
  const d = { id: id, jobSite: 'Site ' + id, scheduledAt: TODAY + 'T' + time, status: status || 'saved' };
  if (extra) for (const k in extra) d[k] = extra[k];
  return d;
}

/* the REAL Revenue card (modules/autostart.js) over an engine world */
function cardHTML(world) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://localhost/', runScripts: 'dangerously' });
  const w = dom.window;
  const info = world.App.autostartTodayInfo();
  w.App = {
    _esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); },
    _store: { get: function (k, d) { return world._mem[k] !== undefined ? world._mem[k] : d; } },
    autostartTodayInfo: function () { return info; }
  };
  w.Meticulous = { modules: {} };
  w.eval(asSrc);
  return w.Meticulous.modules.autostart.settingsHTML('rv');
}

/* ================= A — the Nov 14 read-back ================= */
console.log('— A: Sat-with-7AM-setting read-back (no dispatch today) —');
{
  setClock(8, 31);
  const w = makeWorld({ active: null, list: [] });
  const info = w.App.autostartTodayInfo();
  eq(info.enabled, true, 'A1 setting is on');
  eq(info.dayOk, true, 'A2 today is a checked day');
  eq(info.willStart, true, 'A3 the plan WILL start on the saved setting alone');
  eq(info.source, 'setting', 'A4 source is the setting (no dispatch, no override)');
  eq(info.time, '07:00', 'A5 the plan time is the saved 07:00');
  eq(info.label, '7:00 AM', 'A6 the plan label reads 7:00 AM');
  eq(info.reason, 'ok', 'A7 reason ok (not no-work-today)');
  const html = cardHTML(w);
  ok(html.indexOf('Today:</b> starts 7:00 AM (your setting)') !== -1, 'A8 the card reads "Today: starts 7:00 AM (your setting)"');
  ok(html.indexOf('no auto-start scheduled') === -1, 'A9 the card does NOT read "no auto-start scheduled"');
  eq(w.App.autostartPlanLabel(info), 'Starts 7:00 AM', 'A10 the dashboard armed label promises the 7:00 AM start');
}

/* ================= B — open after the time: backdated start ================= */
console.log('— B: open-after-time backdated start —');
{
  setClock(8, 31);
  const w = makeWorld({ active: null, list: [] });
  eq(w.App.checkAutoStart(), 'started', 'B1 opening at 08:31 starts the tracker');
  eq(w.App.tracker.status, 'running', 'B2 tracker running');
  eq(w.App.tracker.elapsed, 5460, 'B3 elapsed counts from 07:00, not from now (91 min = 5460 s)');
  eq(w.App.tracker.sessionId, atMs(7, 0), 'B4 the session is pinned to the 07:00 anchor');
  eq(w.App.checkAutoStart(), 'fired', 'B5 a second check the same morning does not start twice');

  setClock(6, 30);
  const w2 = makeWorld({ active: null, list: [] });
  eq(w2.App.checkAutoStart(), 'not-yet', 'B6 before 07:00 the plan stands but does not start');
  eq(w2.App.tracker.status, 'idle', 'B7 tracker idle before the saved time');
  setClock(8, 31);
}

/* ================= C — unscheduled day: no start, ever ================= */
console.log('— C: unscheduled day = no start (Sunday-phantom law) —');
{
  setClock(8, 31);
  const w = makeWorld({ onboarding: settingOnb(UNCHECKED_DAYS), active: null, list: [] });
  eq(w.App.checkAutoStart(), 'wrong-day', 'C1 an unchecked day starts nothing');
  eq(w.App.tracker.status, 'idle', 'C2 tracker idle on the unchecked day');
  eq(w.App.autostartTodayInfo().willStart, false, 'C3 no plan on the unchecked day');

  const w2 = makeWorld({ onboarding: settingOnb(UNCHECKED_DAYS), active: dsp('a', '07:30'), list: [] });
  eq(w2.App.checkAutoStart(), 'wrong-day', 'C4 even a dispatch cannot start an unchecked day (WHEN, never WHETHER)');
  eq(w2.App.tracker.status, 'idle', 'C5 tracker still idle');

  const w3 = makeWorld({ onboarding: { autoStart: false, autoStartTime: '07:00', autoStartDays: CHECKED_DAYS }, active: null, list: [] });
  eq(w3.App.checkAutoStart(), 'off', 'C6 setting off starts nothing');
}

/* ================= D — a dispatch today governs, at its edited time ================= */
console.log('— D: dispatch-today overrides the saved time —');
{
  setClock(8, 31);
  const w = makeWorld({ active: null, list: [dsp('a', '08:00')] });
  const info = w.App.autostartTodayInfo();
  eq(info.source, 'dispatch', 'D1 source is the dispatch');
  eq(info.time, '08:00', 'D2 the plan time is the dispatch time, not the saved 07:00');
  eq(w.App.checkAutoStart(), 'started', 'D3 the dispatch start fires');
  eq(w.App.tracker.elapsed, 1860, 'D4 elapsed counts from the 08:00 dispatch time (31 min)');
  eq(w.App.tracker.sessionId, atMs(8, 0), 'D5 the session is pinned to the dispatch anchor');
  const html = cardHTML(makeWorld({ active: null, list: [dsp('a', '08:00')] }));
  ok(html.indexOf('Today:</b> starts 8:00 AM (from Dispatch)') !== -1, 'D6 the card reads "starts 8:00 AM (from Dispatch)"');

  /* the dispatch as EDITED governs — a 07:45 edit moves the anchor */
  const w2 = makeWorld({ active: null, list: [dsp('a', '07:45')] });
  eq(w2.App.checkAutoStart(), 'started', 'D7 the edited dispatch start fires');
  eq(w2.App.tracker.elapsed, 2760, 'D8 elapsed counts from the edited 07:45 (46 min)');
  eq(w2.App.tracker.sessionId, atMs(7, 45), 'D9 the session is pinned to the edited anchor');
}

/* ================= E — a closed day stays closed ================= */
console.log('— E: closed day stays closed —');
{
  setClock(8, 31);
  /* E1: a session started and stopped today already (done-today) */
  const sess = [{
    date: TODAY, seconds: 3600,
    endedAt: new RealDate(Y, MO, DA, 8, 0, 0, 0).toISOString()
  }];
  const w1 = makeWorld({ active: null, list: [], sessions: sess });
  eq(w1.App.checkAutoStart(), 'done-today', 'E1 a day with a finished session today does not start again');
  eq(w1.App.tracker.status, 'idle', 'E2 tracker idle');

  /* E2: the v411 shape — the day was closed by completing its only
     dispatch on a surface whose tracker was idle: NO sessions entry,
     fired flag unset. The completed record is the close. */
  const w2 = makeWorld({ active: null, list: [dsp('a', '07:30', 'completed')] });
  eq(w2.App.checkAutoStart(), 'closed-today', 'E3 a completed dispatch closes the day (no session entry needed)');
  eq(w2.App.tracker.status, 'idle', 'E4 the closed day does not resurrect a session');
  eq(w2.App.autostartTodayInfo().willStart, false, 'E5 the card promises nothing on a closed day');

  /* E3: the v440 echo shape — the completion's Revenue line stands
     (dspId -> today's dispatch) while the record itself reads open
     again. The booked completion is the close (closedDayProof411
     prong 3), so the start is refused even though the record
     claims the day. */
  const w3 = makeWorld({
    active: null,
    list: [dsp('a', '07:30', 'saved')],
    rev: [{ dspId: 'a', date: TODAY, amount: 116 }]
  });
  eq(w3.App.checkAutoStart(), 'closed-today', 'E6 a standing completion Revenue line closes the day (echo shape)');
  eq(w3.App.tracker.status, 'idle', 'E7 tracker idle on the echo-closed day');

  /* E4: a completed morning dispatch + a still-open dispatch for
     today — the day is NOT closed against the open dispatch */
  const w4 = makeWorld({
    active: null,
    list: [dsp('a', '07:00', 'completed'), dsp('b', '08:00', 'saved')],
    rev: [{ dspId: 'a', date: TODAY, amount: 116 }]
  });
  eq(w4.App.checkAutoStart(), 'started', 'E8 an open dispatch still starts after another dispatch completed');
  eq(w4.App.tracker.sessionId, atMs(8, 0), 'E9 the start anchors to the open dispatch');

  /* E5: a cancelled dispatch is not a close — the saved setting
     governs the day as usual */
  const w5 = makeWorld({ active: null, list: [dsp('a', '07:30', 'cancelled')] });
  eq(w5.App.checkAutoStart(), 'started', 'E10 a cancelled dispatch does not close the day; the setting starts it');
  eq(w5.App.tracker.elapsed, 5460, 'E11 elapsed counts from the saved 07:00');
}

/* ================= F — the native-arm selection ================= */
console.log('— F: native-arm selection (autostartNextInfo) —');
{
  setClock(6, 30);
  const w = makeWorld({ active: null, list: [] });
  const nx = w.App.autostartNextInfo();
  ok(!!nx, 'F1 a next start exists on a setting day');
  eq(nx && nx.today, true, 'F2 the next start is TODAY (not tomorrow)');
  eq(nx && nx.time, '07:00', 'F3 the next start is the saved 07:00');
  eq(nx && nx.startMs, atMs(7, 0), 'F4 the arm anchor is today 07:00 (armNativeDay hands this to the native side)');
  setClock(8, 31);

  const w2 = makeWorld({ active: null, list: [dsp('a', '07:30', 'completed')] });
  const nx2 = w2.App.autostartNextInfo();
  ok(!nx2 || nx2.date !== TODAY, 'F5 a closed today is never offered to the native arm');
  eq(nx2 && nx2.date, TOMORROW, 'F6 the arm falls through to tomorrow on a closed day');

  const src = appSrc.slice(appSrc.indexOf('App.armNativeDay = function'), appSrc.indexOf('App.armNativeDay = function') + 2600);
  ok(src.indexOf('autostartDayClosed') !== -1, 'F7 armNativeDay itself consults the closed-day gate');
}

/* ================= G — the per-day override still rules its day ================= */
console.log('— G: override (v447) unchanged —');
{
  setClock(8, 31);
  const w = makeWorld({ active: null, list: [], override: { date: TODAY, time: '07:15' } });
  const info = w.App.autostartTodayInfo();
  eq(info.source, 'override', 'G1 source is the override');
  eq(w.App.checkAutoStart(), 'started', 'G2 the override start fires');
  eq(w.App.tracker.elapsed, 4560, 'G3 elapsed counts from the 07:15 override (76 min)');
}

console.log('\nautostart-arming-v455-test: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
