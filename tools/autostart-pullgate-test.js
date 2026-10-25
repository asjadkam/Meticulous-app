#!/usr/bin/env node
/* Meticulous v229 — AUTOSTART-FIRED-ON-UNSELECTED-DAY (owner, Fri
 * Oct 23, 2026 ~10:15 MDT, from his screen recording).
 *
 * His job was CANCELLED. Before falling asleep he deleted today's
 * dispatch and confirmed the Auto-start card: enabled, 8:00 AM,
 * Sun OFF / Mon–Thu ON / Fri OFF / Sat ON, and the card's own line:
 * "Today: no auto-start scheduled". On waking he found the tracker
 * RUNNING — "Working… 02:15:30, Counting from 8:00 AM", loads 0 —
 * on a day with no dispatch and Friday not selected.
 *
 * The mechanism these tests pin: the start decision at boot/resume
 * is taken on the device's LOCAL store BEFORE the boot's first
 * cloud pull settles. His edits were saved to the ACCOUNT (cloud);
 * this phone's local copy still held the pre-edit state (Friday
 * selected, the dispatch still in it), so the boot check started a
 * session from the stale read — anchored 8:00, exactly as designed
 * — and seconds later the pull settled the store to the state the
 * card displays ("no auto-start scheduled") with nothing able to
 * un-start the session. The native arm is placed from the same
 * first read, so it carries the same hazard.
 *
 * The law after the fix: while a signed-in pull for this boot is
 * outstanding, the START and the ARM decision wait for it (the
 * waiter settles on pull success, pull failure, or its own
 * timeout — offline the local copy is the only truth the phone
 * has, and the start proceeds on it, backdated as always). Local
 * mode never waits. The settled re-check then judges the day on
 * the settled store — the same store the card reads.
 *
 * Drives the REAL AUTOSTART-ENGINE region + App.armNativeDay out
 * of js/app.js (same slicing as tools/background-day-test.js D)
 * over a fake clock pinned to the real calendar days Thu Oct 22 /
 * Fri Oct 23 / Sat Oct 24, 2026, with a fake native shell whose
 * arm state survives across "WebView worlds" the way the real
 * SharedPreferences arm survives the app being killed.
 *
 * Run: node tools/autostart-pullgate-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

function extractFrom(s, beginMark, endMark) {
  const a = s.lastIndexOf('/*', s.indexOf(beginMark));
  const b = s.indexOf('*/', s.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return s.slice(a, b + 2);
}
const region = extractFrom(appSrc, 'AUTOSTART-ENGINE-BEGIN', 'AUTOSTART-ENGINE-END');
const armStart = appSrc.indexOf('var ARM_LEAD_MS');
const armEnd = appSrc.indexOf('\n  };', armStart);
if (armStart === -1 || armEnd === -1) throw new Error('armNativeDay not found in app.js');
const armCode = appSrc.slice(armStart, armEnd + 5);

/* ---------- assertions ---------- */
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL: ' + name); }
}
function eq(got, want, name) { ok(got === want, name + ' (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')'); }

/* ---------- fake clock (pinned to the real Oct 2026 days) ---------- */
const RealDate = Date;
let fakeNow = 0;
class FakeDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fakeNow])); }
  static now() { return fakeNow; }
}
function msOf(dateStr, hhmm) {
  const dp = dateStr.split('-'), tp = hhmm.split(':');
  return new RealDate(+dp[0], +dp[1] - 1, +dp[2], +tp[0], +tp[1], 0, 0).getTime();
}
function setClock(dateStr, hhmm) { fakeNow = msOf(dateStr, hhmm); }
function todayStrOf(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const tick = () => new Promise(r => setImmediate(r));
async function flush() { await tick(); await tick(); await tick(); }

/* fixture sanity: the calendar days are the days the owner lived */
eq(new RealDate(2026, 9, 22).getDay(), 4, 'fixture: Oct 22 2026 is a Thursday');
eq(new RealDate(2026, 9, 23).getDay(), 5, 'fixture: Oct 23 2026 is a Friday');
eq(new RealDate(2026, 9, 24).getDay(), 6, 'fixture: Oct 24 2026 is a Saturday');

/* ---------- the fake native shell (survives across worlds) ---------- */
function makeNative() {
  return {
    arm: null,
    calls: [],
    armDay: function (a) { this.arm = { key: a.key, fireMs: a.fireMs, startMs: a.startMs, date: a.date }; this.calls.push(['armDay', a.date, a.startMs]); return Promise.resolve({ armed: true }); },
    disarmDay: function () { this.arm = null; this.calls.push(['disarmDay']); return Promise.resolve({ disarmed: true }); }
  };
}

/* ---------- a WebView world ---------- */
function makeWorld(opts) {
  const mem = {};
  const seed = opts.store || {};
  for (const k in seed) mem[k] = JSON.parse(JSON.stringify(seed[k]));
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const cs = opts.cloudSync; // undefined = local mode (no CloudSync global)
  const sb = {
    console, Math, JSON, Object, Array, String, Number, isFinite, parseInt, Date: FakeDate,
    store, todayStr: todayStrOf,
    confirm: () => false,
    resetAccum: () => {}, trackerSave: () => {}, trackerPaint: () => {},
    maybePromptOdo: () => false,
    trackerSessionStartMs: function () {
      const t = sb.App.tracker;
      return (t.startTs || 0) - (t.elapsed || 0) * 1000;
    }
  };
  sb.window = sb;
  if (cs) sb.CloudSync = cs;
  if (opts.native) sb.ShiftTrack = opts.native;
  sb.App = { tracker: { status: 'idle', startTs: 0, elapsed: 0 }, userRole: () => 'driver' };
  vm.createContext(sb);
  vm.runInContext(region + '\n' + armCode, sb);
  return { App: sb.App, store, sb };
}
function pendingCloudSync() {
  const waiters = [];
  return {
    whenFirstPullDone: function () { return new Promise(res => waiters.push(res)); },
    settle: function (v) { waiters.splice(0).forEach(r => r(v)); },
    waiterCount: function () { return waiters.length; }
  };
}
const settledCloudSync = { whenFirstPullDone: () => Promise.resolve(true) };

/* the incident's fixtures */
const DSP_FRI = { id: 'dsp-fri', status: 'active', scheduledAt: '2026-10-23T08:00', jobSite: 'Aecon Inf' };
const STALE_STORE = { // this phone's local copy on Friday morning (pre-edit)
  onboarding: { autoStart: true, autoStartTime: '08:00', autoStartDays: [1, 2, 3, 4, 5, 6] },
  dsp_active: DSP_FRI, dsp_list: [DSP_FRI],
  autostart: { '2026-10-22': true }, sessions: []
};
const SETTLED_STORE = { // the account's truth his card showed (post-edit)
  onboarding: { autoStart: true, autoStartTime: '08:00', autoStartDays: [1, 2, 3, 4, 6] },
  dsp_active: null, dsp_list: [],
  autostart: { '2026-10-22': true }, sessions: []
};

(async function main() {
  const native = makeNative();

  /* ---- A (Thu evening, pull settled): Friday arms legitimately ---- */
  console.log('A — Thursday evening: the arm for Friday is placed on settled state');
  {
    setClock('2026-10-22', '21:14');
    const w = makeWorld({ store: STALE_STORE, cloudSync: settledCloudSync, native });
    await flush(); // a settled boot: the gate's waiter resolves at once
    w.App.armNativeDay();
    await flush();
    ok(native.arm && native.arm.date === '2026-10-23', 'A1 Friday is the armed day');
    eq(native.arm && native.arm.startMs, msOf('2026-10-23', '08:00'), 'A2 arm start = the dispatch 8:00 AM');
    eq(native.arm && native.arm.fireMs, msOf('2026-10-23', '08:00') - 3600000, 'A3 fire = start minus the 60-minute lead');
  }

  /* ---- B (THE INCIDENT): Friday cold open on the stale store ---- */
  console.log('B — Friday Oct 23: cold open, stale local store, pull outstanding');
  {
    const cs = pendingCloudSync();
    const w = makeWorld({ store: STALE_STORE, cloudSync: cs, native });
    const callsBefore = native.calls.length;

    setClock('2026-10-23', '08:00');
    const r1 = w.App.checkAutoStart();
    eq(r1, 'deferred-pull', 'B1 at 8:00 the start waits for the pull — it does not fire on the stale read');
    eq(w.App.tracker.status, 'idle', 'B2 tracker still idle at 8:00');
    w.App.armNativeDay();
    eq(native.calls.length, callsBefore, 'B3 the arm decision also waits — no Friday arm is (re)placed pre-pull');

    setClock('2026-10-23', '10:15');
    const r2 = w.App.checkAutoStart();
    eq(r2, 'deferred-pull', 'B4 the 10:15 open still waits — no backdated start from the stale read');
    eq(w.App.tracker.status, 'idle', 'B5 tracker still idle at 10:15 (his recording showed it running)');

    /* the pull settles with HIS edits — the state his card showed */
    w.store.set('onboarding', SETTLED_STORE.onboarding);
    w.store.set('dsp_active', null);
    w.store.set('dsp_list', []);
    cs.settle(true);
    await flush();

    eq(w.App.tracker.status, 'idle', 'B6 after the pull the tracker is STILL idle — nothing started, ever');
    const r3 = w.App.checkAutoStart();
    eq(r3, 'wrong-day', 'B7 the settled verdict is wrong-day (Friday not selected)');
    const info = w.App.autostartTodayInfo();
    eq(info.dayOk, false, 'B8 the card agrees: today was never a selected day');
    eq(info.willStart, false, 'B9 the card agrees: no auto-start scheduled');
    const fired = w.store.get('autostart', {});
    ok(!fired['2026-10-23'], 'B10 the fired flag was never consumed by a phantom start');
    ok(!native.arm, 'B11 after the settle the native arm is DOWN — Saturday is selected but has no dispatch, and v255 arms nothing for a setting-only day');
    eq(native.calls.filter(function (c) { return c[0] === 'disarmDay'; }).length >= 1, true, 'B12 the settled re-check actively disarmed the day');
  }

  /* ---- C (control): a real Friday workday still starts, anchored ---- */
  console.log('C — control: a genuine Friday workday, pull settles with the plan intact');
  {
    const native2 = makeNative();
    const cs = pendingCloudSync();
    const w = makeWorld({ store: STALE_STORE, cloudSync: cs, native: native2 });
    setClock('2026-10-23', '10:15');
    const r1 = w.App.checkAutoStart();
    eq(r1, 'deferred-pull', 'C1 the start waits for the pull on a workday too');
    cs.settle(true); // cloud agrees with the local copy — nothing changes
    await flush();
    eq(w.App.tracker.status, 'running', 'C2 once settled, the session starts');
    eq(w.App.tracker.elapsed, Math.floor((msOf('2026-10-23', '10:15') - msOf('2026-10-23', '08:00')) / 1000),
      'C3 anchored to 8:00 AM exactly — elapsed counts from the plan time, not the wake');
    eq(w.App.tracker.sessionId, msOf('2026-10-23', '08:00'), 'C4 session identity = s<8:00 AM>');
    const fired = w.store.get('autostart', {});
    eq(fired['2026-10-23'], true, 'C5 the fired flag is consumed by the real start');
  }

  /* ---- D (control): local mode — no sync, no waiting, as before ---- */
  console.log('D — control: local mode (no CloudSync) behaves exactly as before');
  {
    const wOff = makeWorld({ store: SETTLED_STORE, native: makeNative() });
    setClock('2026-10-23', '10:15');
    eq(wOff.App.checkAutoStart(), 'wrong-day', 'D1 cancelled Friday: wrong-day at once');
    const wOn = makeWorld({ store: STALE_STORE, native: makeNative() });
    eq(wOn.App.checkAutoStart(), 'started', 'D2 work Friday: starts at once');
    eq(wOn.App.tracker.status, 'running', 'D3 and the tracker runs');
  }

  /* ---- E (control): offline — the waiter gives up, local truth rules ---- */
  console.log('E — control: pull never lands (offline) — the local copy decides');
  {
    const cs = pendingCloudSync();
    const w = makeWorld({ store: STALE_STORE, cloudSync: cs, native: makeNative() });
    setClock('2026-10-23', '10:15');
    eq(w.App.checkAutoStart(), 'deferred-pull', 'E1 the start waits while a pull is outstanding');
    cs.settle(false); // the waiter settles false: pull failed / timed out
    await flush();
    eq(w.App.tracker.status, 'running', 'E2 offline, the start proceeds on the only truth the phone has');
    eq(w.App.tracker.sessionId, msOf('2026-10-23', '08:00'), 'E3 still anchored to 8:00 AM');
  }

  /* ---- statics ---- */
  console.log('statics');
  ok(region.indexOf("return 'deferred-pull'") !== -1, 'S1 the engine start path carries the pull gate');
  ok(armCode.indexOf('autostartPullSettled') !== -1, 'S2 armNativeDay consults the same gate');

  console.log('\nautostart-pullgate-test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
