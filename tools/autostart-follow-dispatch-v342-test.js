#!/usr/bin/env node
/* Meticulous v342 — AUTO-START-MUST-FOLLOW-DISPATCH-TIME (owner,
 * Nov 5, 2026 21:49, restating his standing law with a screenshot):
 * the tracker auto-start must follow the day's DISPATCH time as
 * currently saved/edited — tomorrow (Fri Nov 6) carries a 10:00 AM
 * dispatch, so tomorrow's start is 10:00, not the fixed saved
 * 9:00 AM. The fixed saved time remains only as a fallback for a
 * dispatch day that carries no time of its own (and, per v255, is
 * never a day of work by itself). Added face (21:50): the home
 * tracker card's "Will count from …" line must show that same
 * dispatch-derived time for the day.
 *
 * Behavioural proof against the REAL shipped code: the
 * AUTOSTART-ENGINE region of js/app.js is sliced out verbatim and
 * driven over an in-memory store (same harness style as
 * tools/dispatch-autostart-test.js):
 *  - setting 09:00 + tomorrow dispatch 10:00 -> next plan 10:00,
 *    source 'dispatch', label '10:00 AM', startMs = tomorrow 10:00
 *    (the exact anchor App.armNativeDay hands the native side);
 *  - EDITING the dispatch (same id, scheduledAt recomposed to
 *    08:30, exactly what dspApplyEdit stores) moves the resolved
 *    start to 08:30 on the very next read — no locked copy;
 *  - a date-only dispatch (claims the day, carries no time) falls
 *    back to the saved 09:00 WITH source 'dispatch' (fallback ON a
 *    dispatch day);
 *  - no dispatch at all -> no next plan (the fixed time alone
 *    arms nothing, v255);
 *  - today's still-pending dispatch plan is the next plan while
 *    today is unstarted (arm selection parity).
 * Static pins then hold the wiring: trackerPaint's v342 label
 * branch + preset guard, and the dispatch-write nudges
 * (dspSet / W in modules/dispatch.js, Connect landing in
 * js/connectpipe.js) that re-point the engine + native arm the
 * moment a dispatch changes.
 * Run: node tools/autostart-follow-dispatch-v342-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const dspSrc = fs.readFileSync(path.join(ROOT, 'modules', 'dispatch.js'), 'utf8');
const pipeSrc = fs.readFileSync(path.join(ROOT, 'js', 'connectpipe.js'), 'utf8');

function extract(s, beginMark, endMark) {
  const a = s.lastIndexOf('/*', s.indexOf(beginMark));
  const b = s.indexOf('*/', s.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return s.slice(a, b + 2);
}
const region = extract(appSrc, 'AUTOSTART-ENGINE-BEGIN', 'AUTOSTART-ENGINE-END');

/* ---------- assertions ---------- */
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}
function eq(got, want, name) { ok(got === want, name + ' (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')'); }
function section(name) { console.log('\n— ' + name + ' —'); }

/* ---------- world ---------- */
function todayStrOf(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const NOW = new Date();
const TODAY = todayStrOf(NOW);
const TMDT = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1);
const TOMORROW = todayStrOf(TMDT);

function makeWorld(opts) {
  opts = opts || {};
  const mem = {};
  mem.onboarding = opts.onboarding !== undefined ? opts.onboarding
    : { autoStart: true, autoStartTime: '09:00', autoStartDays: [0, 1, 2, 3, 4, 5, 6] };
  if ('active' in opts) mem.dsp_active = opts.active;
  if ('list' in opts) mem.dsp_list = opts.list;
  if ('override' in opts) mem.autostart_override = opts.override;
  if ('fired' in opts) mem.autostart = opts.fired;
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const sandbox = {
    console: console,
    store: store,
    todayStr: todayStrOf,
    confirm: function () { return false; },
    resetAccum: function () {},
    trackerSave: function () {},
    trackerPaint: function () {},
    maybePromptOdo: function () { return false; },
    trackerSessionStartMs: function () { return Date.now(); },
    App: { tracker: { status: opts.trackerStatus || 'idle', startTs: 0, elapsed: 0 } }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(region + '\n;this.__E = { plan: autostartPlan, effective: autostartEffective, todayMs: autostartTodayMs };', sandbox);
  sandbox._mem = mem;
  return sandbox;
}
function dsp(id, date, time, status) {
  return { id: id, jobSite: 'Aecon Trans', scheduledAt: time ? (date + 'T' + time) : date, date: date, status: status || 'saved' };
}

/* ================= the concrete case: tomorrow 10:00 ================= */
section('tomorrow’s dispatch drives tomorrow’s start');
{
  const fired = {}; fired[TODAY] = true; // today already ran its course
  const w = makeWorld({ fired: fired, list: [dsp('n6', TOMORROW, '10:00')] });
  const info = w.App.autostartNextInfo();
  ok(!!info, 'a next plan exists');
  eq(info.date, TOMORROW, 'the next plan is tomorrow');
  eq(info.today, false, 'not today (today already fired)');
  eq(info.time, '10:00', 'auto-start resolves to the dispatch time 10:00, not the saved 09:00');
  eq(info.source, 'dispatch', 'source is the dispatch');
  eq(info.label, '10:00 AM', 'label reads 10:00 AM');
  eq('Will count from ' + info.label, 'Will count from 10:00 AM', 'dashboard line composes exactly as the owner asked');
  eq(info.startMs, new Date(TMDT.getFullYear(), TMDT.getMonth(), TMDT.getDate(), 10, 0, 0, 0).getTime(),
    'startMs anchors at tomorrow 10:00 local — the anchor the native arm fires on');
  eq(info.startMs, w.__E.todayMs(TOMORROW, '10:00'), 'startMs matches the engine anchor math armNativeDay uses');
}

/* ================= an edit moves the start with it ================= */
section('editing the dispatch moves the auto-start');
{
  const fired = {}; fired[TODAY] = true;
  const w = makeWorld({ fired: fired, list: [dsp('n6', TOMORROW, '10:00')] });
  eq(w.App.autostartNextInfo().time, '10:00', 'before the edit: 10:00');
  /* the edit exactly as dspApplyEdit stores it: same id, the
     scheduledAt recomposed from the form's date + new time */
  w._mem.dsp_list[0].scheduledAt = TOMORROW + 'T08:30';
  const after = w.App.autostartNextInfo();
  eq(after.time, '08:30', 'after the edit: the start follows to 08:30 on the next read');
  eq(after.startMs, w.__E.todayMs(TOMORROW, '08:30'), 'the arm anchor moved with the edit');
  const p = w.__E.plan({ enabled: true, time: '09:00', days: [0, 1, 2, 3, 4, 5, 6] }, null, w._mem.dsp_list, null, TOMORROW, TMDT.getDay());
  eq(p.time, '08:30', 'plan-level: the edited dispatch time is the plan time');
  eq(p.source, 'dispatch', 'plan-level: source stays dispatch');
}

/* ================= fallback law ================= */
section('the fixed saved time is only a fallback');
{
  const fired = {}; fired[TODAY] = true;
  const w = makeWorld({ fired: fired, list: [dsp('n6', TOMORROW, null)] }); // date-only record
  const info = w.App.autostartNextInfo();
  ok(!!info, 'a date-only dispatch still makes tomorrow a work day');
  eq(info.time, '09:00', 'no time on the dispatch -> the saved 09:00 is the fallback');
  eq(info.source, 'dispatch', '…on a dispatch day (source stays dispatch)');

  const w2 = makeWorld({ fired: fired, list: [] });
  eq(w2.App.autostartNextInfo(), null, 'no dispatch anywhere -> no next plan: the fixed time alone arms nothing');
}

/* ================= today still pending ================= */
section('today pending: the next plan is today’s dispatch');
{
  const w = makeWorld({ list: [dsp('t1', TODAY, '23:59')] });
  const info = w.App.autostartNextInfo();
  ok(!!info && info.today === true, 'today’s unstarted plan is next');
  eq(info.time, '23:59', 'today resolves to its dispatch time');
  eq(info.date, TODAY, 'date is today');
}

/* ================= wiring pins ================= */
section('wiring: dashboard label + dispatch-write nudges');
{
  ok(appSrc.indexOf('App.autostartNextInfo = function ()') >= 0, 'engine exports App.autostartNextInfo');
  ok(appSrc.indexOf("if (nx && !nx.today) armed = 'Will count from ' + nx.label;") >= 0,
    'trackerPaint promises the next day as “Will count from …”');
  ok(appSrc.indexOf('todayStr(new Date(t.presetStart)) === todayStr(new Date()) && !autoStartFired(todayStr(new Date()))') >= 0,
    'a leftover preset shows only while its own day is still unstarted');
  ok(dspSrc.indexOf('function dspNudgeAutostart()') >= 0, 'dispatch module carries the re-arm nudge');
  ok(dspSrc.indexOf("if (k === 'list' || k === 'active') dspNudgeAutostart();") >= 0,
    'record writes through dspSet re-point the engine + arm');
  ok(dspSrc.indexOf("if (k === 'list' || k === 'active') { try { dspNudgeAutostart(); } catch (e) {} }") >= 0,
    'record writes through W re-point the engine + arm');
  ok(dspSrc.indexOf('if (App.armNativeDay) App.armNativeDay();') >= 0, 'the nudge re-arms the native day');
  ok(pipeSrc.indexOf('if (landedCount > 0)') >= 0 && pipeSrc.indexOf('App.armNativeDay) App.armNativeDay();') >= 0,
    'a Connect-landed dispatch re-points the engine + arm on landing');
}

console.log('\nautostart-follow-dispatch-v342: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
