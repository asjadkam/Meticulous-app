#!/usr/bin/env node
/* Meticulous v419 — PHANTOM-ROOT-NOV11 suite.
 *
 * Owner evidence (Nov 11, 2026): web 418's invoice fix did NOT
 * kill the Sunday Nov 1 phantom in his hands — he deleted the
 * entry manually, and testified: for Sunday Nov 1 he did NOT
 * start a session himself, and auto-start was NOT set for that
 * Sunday either. Yet the day carried a 14.78h / $428.71 tracker
 * record.
 *
 * Root, proven in the 418 code: stopSessionAt (js/app.js) is the
 * ONLY writer of session records, and it booked whatever the
 * tracker claimed at stop time — the record's date from the STOP
 * day, its seconds from the tracker's current elapsed/startTs
 * claim — with no check that a start ever occurred on the day
 * being booked, and no agreement check between the claimed start
 * and the session's pin (sessionId), which is what every guard
 * (stale heal, closed-day proof, adoption) judges by. The heals
 * bury a stale shell only on the dashboard tick / visibility
 * cadence: a stop that landed first minted the shell's whole
 * span onto the stop day (the Oct 25 phantom booked $136.21
 * exactly this way, per the v303 note in app.js). And web 418's
 * builder vouched a whole DAY from any one genuinely-started
 * record — while Revenue's onSession REPLACES the day's tracker
 * entry at every stop — so a shell stopping later in a day
 * became the day's entry behind a small genuine record's vouch.
 *
 * The fix, at the two choke points:
 *  A — stopSessionAt's booking gate: judged by the pin first,
 *      a cross-day session books only as a genuine overnight
 *      carry (pin and derived start naming the same day, the
 *      day right before the stop day, span under 24 h, start
 *      day not already closed) and then books onto its
 *      ORIGINAL start day; any other cross-day stop buries the
 *      session like healStaleTracker does — nothing is written.
 *  B — the shared builder (modules/invoice.js): a tracker
 *      entry whose own session hours match a shell record's
 *      hours for its date, and no genuine record's hours, is
 *      the shell's booking and never becomes a line.
 *
 * Part A drives the REAL stopSessionAt + closedDayProof411
 * brace-extracted from js/app.js (the v411 harness pattern)
 * over fake clocks. Part B drives the REAL INV-CYCLE region
 * (the 418 harness pattern).
 *
 * On pristine web 418 bytes the v419 assertions fail:
 * A1 A2 A4 (date) A5 A6 A8, B1 B4.
 * Run: node tools/phantom-root-nov11-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const invSrc = fs.readFileSync(path.join(ROOT, 'modules', 'invoice.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
function section(s) { console.log('\n— ' + s + ' —'); }

const RealDate = Date;
let fakeNow = 0;
class FakeDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fakeNow])); }
  static now() { return fakeNow; }
}
function todayStrOf(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function msOf(y, mo, d, hh, mm, ss) { return new RealDate(y, mo - 1, d, hh, mm || 0, ss || 0, 0).getTime(); }

function extractFn(src, marker) {
  const i = src.indexOf(marker);
  if (i === -1) throw new Error('marker not found: ' + marker);
  const open = src.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced: ' + marker);
}

/* =================================================================
 * A — the real stopSessionAt over a stubbed world (v411 pattern)
 * ================================================================= */
const PIN_OCT31 = msOf(2026, 10, 31, 8, 0);       // Saturday Oct 31, 08:00
const NOV1_2247 = msOf(2026, 11, 1, 22, 47);      // Sunday Nov 1, 22:47
const SHELL_SECS = 53208;                          // 14.78 h

function makeStopWorld(opts) {
  const mem = {
    sessions: opts.sessions || [],
    onboarding: {},
    dsp_active: opts.dspActive || null,
    dsp_list: opts.dspList || [],
    tracker: null
  };
  const store = {
    get: function (k, d) { return (k in mem && mem[k] !== null && mem[k] !== undefined) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const calls = { onSession: [], saveDoc: 0, nativeStopped: [], milesStops: 0, engineStops: 0 };
  const sb = {
    console: console, Promise: Promise, Date: FakeDate, Math: Math, JSON: JSON,
    store: store, todayStr: todayStrOf,
    window: null,
    App: {
      tracker: JSON.parse(JSON.stringify(opts.tracker)),
      armNativeDay: function () {},
      workProfiles: { activeId: function () { return 'p1'; }, keyFor: function (k) { return k; } }
    },
    Meticulous: { modules: { revenue: { onSession: function (e) { calls.onSession.push(JSON.parse(JSON.stringify(e))); } } } },
    FB: { saveDoc: function () { calls.saveDoc++; } },
    ShiftTrack: { sessionStopped: function (k) { calls.nativeStopped.push(k); } },
    LiveMiles: {
      stopDay: function () { calls.milesStops++; return null; },
      reconcileSession: function () { return false; }
    },
    _stopViaDispatch: false, _endTicketPhoto: null,
    trackerSave: function () { mem.tracker = JSON.parse(JSON.stringify(sb.App.tracker)); },
    trackerPaint: function () {},
    trackerSessionStartMs: function () {
      const t = sb.App.tracker, now = FakeDate.now();
      if (!t || t.status === 'idle') return now;
      const live = (t.elapsed || 0) + (t.status === 'running' ? Math.floor((now - t.startTs) / 1000) : 0);
      return now - live * 1000;
    },
    trackerSessionKeyMs: function () {
      const t = sb.App.tracker;
      return (t && t.sessionId) ? Number(t.sessionId) : sb.trackerSessionStartMs();
    },
    takePendingStartOdo: function () { return null; },
    takePendingStartOdoPhoto: function () { return null; },
    applyEndOdoToEntry: function () {},
    takeSessionAccum: function () {},
    maybePromptOdo: function () {},
    dayEngineStop: function () { calls.engineStops++; },
    autostartDispatchFor: function () { return null; }
  };
  sb.window = sb;
  sb.App._store = store;
  const code = extractFn(appSrc, 'function trackedSecondsAt(endMs)') + '\n' +
    extractFn(appSrc, 'function closeTravelFor(dayStr)') + '\n' +
    extractFn(appSrc, 'function closedDayProof411(startMs)') + '\n' +
    extractFn(appSrc, 'function stopSessionAt(endMs, endOdoVal)');
  vm.createContext(sb);
  vm.runInContext(code + '\n;this.__stop = stopSessionAt;', sb);
  return { sb: sb, mem: mem, calls: calls, stop: sb.__stop };
}

section('A1 — the Nov 1 shape: a paused Oct 31 shell stopped on Nov 1 books NOTHING');
{
  /* The fingerprint, reproduced: banked 14.78h on a session
     pinned Oct 31 — at the stop its DERIVED start (now − elapsed)
     lands Nov 1 08:00, which is exactly what let the minted
     record vouch for itself under web 418. The pin tells the
     truth, and the pin/derived disagreement is itself the
     phantom fingerprint: no carry, a burial. */
  fakeNow = NOV1_2247;
  const w = makeStopWorld({ tracker: { status: 'paused', sessionId: PIN_OCT31, startTs: 0, elapsed: SHELL_SECS, profileId: 'p1' } });
  eq('A1 derived start lands on Nov 1 (the fingerprint)', todayStrOf(new RealDate(w.sb.trackerSessionStartMs())), '2026-11-01');
  w.stop(NOV1_2247);
  eq('A1 no session entry written', w.mem.sessions.length, 0);
  eq('A1 Revenue never called', w.calls.onSession.length, 0);
  eq('A1 no cloud doc saved', w.calls.saveDoc, 0);
  eq('A1 tracker idle after the stop', w.sb.App.tracker.status, 'idle');
  eq('A1 discard marker names the shell pin', w.sb.App.tracker.discardedSid, PIN_OCT31);
  eq('A1 native session stood down by key', JSON.stringify(w.calls.nativeStopped), JSON.stringify(['s' + PIN_OCT31]));
  ok('A1 engines stood down', w.calls.engineStops > 0 && w.calls.milesStops > 0);
}

section('A2 — a running Oct 31 shell stopped the next afternoon books NOTHING');
{
  fakeNow = msOf(2026, 11, 1, 15, 0);
  const w = makeStopWorld({ tracker: { status: 'running', sessionId: PIN_OCT31, startTs: PIN_OCT31, elapsed: 0, profileId: 'p1' } });
  w.stop(fakeNow); // a 31 h span: no one shift, whatever its start day
  eq('A2 no session entry written', w.mem.sessions.length, 0);
  eq('A2 Revenue never called', w.calls.onSession.length, 0);
  eq('A2 discard marker set', w.sb.App.tracker.discardedSid, PIN_OCT31);
}

section('A3 — a genuine same-day session books exactly as before (regression)');
{
  const start = msOf(2026, 11, 10, 8, 0), end = msOf(2026, 11, 10, 18, 0);
  fakeNow = end;
  const w = makeStopWorld({ tracker: { status: 'running', sessionId: start, startTs: start, elapsed: 0, profileId: 'p1' } });
  w.stop(end);
  eq('A3 one session booked', w.mem.sessions.length, 1);
  eq('A3 dated on its own day', w.mem.sessions[0] && w.mem.sessions[0].date, '2026-11-10');
  eq('A3 seconds are the span', w.mem.sessions[0] && w.mem.sessions[0].seconds, 36000);
  eq('A3 Revenue called once', w.calls.onSession.length, 1);
  eq('A3 no discard marker', w.sb.App.tracker.discardedSid, undefined);
}

section('A4 — a genuine overnight carry books onto its ORIGINAL start day');
{
  const start = msOf(2026, 10, 31, 22, 0), end = msOf(2026, 11, 1, 1, 0);
  fakeNow = end;
  const w = makeStopWorld({ tracker: { status: 'running', sessionId: start, startTs: start, elapsed: 0, profileId: 'p1' } });
  w.stop(end);
  eq('A4 one session booked', w.mem.sessions.length, 1);
  eq('A4 dated Oct 31 — never re-dated to the stop day', w.mem.sessions[0] && w.mem.sessions[0].date, '2026-10-31');
  eq('A4 seconds are the real 3 h span', w.mem.sessions[0] && w.mem.sessions[0].seconds, 10800);
  eq('A4 endedAt is the true end', w.mem.sessions[0] && w.mem.sessions[0].endedAt, new RealDate(end).toISOString());
  eq('A4 Revenue called once, on the start day', w.calls.onSession.length === 1 && w.calls.onSession[0].date, '2026-10-31');
}

section('A5 — a carry over an already-closed day is a resurrection: buried, not booked');
{
  const start = msOf(2026, 10, 31, 22, 0), end = msOf(2026, 11, 1, 1, 0);
  fakeNow = end;
  const done = { id: 'd1', status: 'completed', scheduledAt: '2026-10-31T08:00', date: '2026-10-31', jobSite: 'Aecon Trans' };
  const w = makeStopWorld({
    tracker: { status: 'running', sessionId: start, startTs: start, elapsed: 0, profileId: 'p1' },
    dspList: [done]
  });
  w.stop(end);
  eq('A5 no session entry written', w.mem.sessions.length, 0);
  eq('A5 Revenue never called', w.calls.onSession.length, 0);
  eq('A5 discard marker set', w.sb.App.tracker.discardedSid, start);
}

section('A6 — the edited-clock fingerprint: pin Oct 31, claimed start Nov 1 08:00, stopped Nov 1');
{
  fakeNow = NOV1_2247;
  const w = makeStopWorld({ tracker: { status: 'running', sessionId: PIN_OCT31, startTs: NOV1_2247, elapsed: SHELL_SECS, profileId: 'p1' } });
  w.stop(NOV1_2247); // web 418 minted date Nov 1, 14.78h, own-start Nov 1 from exactly this claim
  eq('A6 no session entry written', w.mem.sessions.length, 0);
  eq('A6 Revenue never called', w.calls.onSession.length, 0);
  eq('A6 discard marker names the pin', w.sb.App.tracker.discardedSid, PIN_OCT31);
}

section('A7 — a late close-out whose END is on the start day still books (regression)');
{
  /* The dispatch-completion shape: the session ran Oct 31, the
     close lands the next morning with the end stamped Oct 31
     18:00. Start day == end day, so the gate does not stir and
     the booking is the one 418 made. */
  fakeNow = msOf(2026, 11, 1, 9, 0);
  const w = makeStopWorld({ tracker: { status: 'paused', sessionId: PIN_OCT31, startTs: 0, elapsed: 36000, profileId: 'p1' } });
  w.stop(msOf(2026, 10, 31, 18, 0));
  eq('A7 one session booked', w.mem.sessions.length, 1);
  eq('A7 dated Oct 31', w.mem.sessions[0] && w.mem.sessions[0].date, '2026-10-31');
  eq('A7 seconds are the banked 10 h', w.mem.sessions[0] && w.mem.sessions[0].seconds, 36000);
}

section('A8 — a pin-less legacy shell stopped the next day books NOTHING');
{
  fakeNow = msOf(2026, 11, 1, 15, 0);
  const w = makeStopWorld({ tracker: { status: 'running', startTs: PIN_OCT31, elapsed: 0, profileId: 'p1' } });
  w.stop(fakeNow);
  eq('A8 no session entry written', w.mem.sessions.length, 0);
  eq('A8 Revenue never called', w.calls.onSession.length, 0);
  ok('A8 discard marker set from the derived start', w.sb.App.tracker.discardedSid > 0);
}

section('A9 — an idle stop is untouched by the gate');
{
  fakeNow = msOf(2026, 11, 11, 9, 0);
  const w = makeStopWorld({ tracker: { status: 'idle', startTs: 0, elapsed: 0 } });
  w.stop(fakeNow);
  eq('A9 no session entry written', w.mem.sessions.length, 0);
  eq('A9 tracker stays idle', w.sb.App.tracker.status, 'idle');
}

/* =================================================================
 * B — the real builder over a mixed day (418 harness pattern)
 * ================================================================= */
function extractStore(src) {
  const a = src.indexOf('var store = {');
  const b = src.indexOf('};', a);
  if (a === -1 || b === -1) throw new Error('store slice not found');
  return src.slice(a, b + 2);
}
function extractRegion(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}
function makeBuilderWorld() {
  const backing = { map: new Map(), fail: false };
  const localStorage = {
    getItem: function (k) { return backing.map.has(k) ? backing.map.get(k) : null; },
    setItem: function (k, v) { backing.map.set(k, String(v)); },
    removeItem: function (k) { backing.map.delete(k); }
  };
  const sandbox = {
    console: console,
    localStorage: localStorage,
    App: { _today: function () { return '2026-11-11'; }, _esc: function (s) { return String(s == null ? '' : s); } }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractStore(appSrc), sandbox);
  sandbox.App._store = sandbox.store;
  vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sandbox);
  return sandbox;
}
function trackerEntry(date, hours, amount, extra) {
  const e = { date: date, type: 'hourly', hours: String(hours), amount: String(amount), note: 'Auto from tracker', auto: true, loads: 0 };
  if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
  return e;
}
function sessRec(date, endLocal, seconds) {
  const end = new RealDate(endLocal[0], endLocal[1] - 1, endLocal[2], endLocal[3], endLocal[4], 0);
  return { date: date, seconds: seconds, endedAt: end.toISOString() };
}
function lineFor(built, date) {
  return (built.lines || []).filter(function (l) { return l.date === date; })[0] || null;
}

const bw = makeBuilderWorld();
const B = bw.invCycBuildRevenueLines;
const RATE = 29, STD = 'hourly';
/* Nov 1's mixed evidence: a small GENUINE record (09:00–10:00,
   own start Nov 1) and the SHELL (dated Nov 1, started Oct 31
   19:13, 14.78h, stopped Nov 1 10:00 — the record web 418's
   investigation described), whose stop REPLACED the day's
   tracker entry with its own span. */
const MIXED_SESSIONS = [
  sessRec('2026-11-01', [2026, 11, 1, 10, 0], 3600),
  sessRec('2026-11-01', [2026, 11, 1, 10, 0], SHELL_SECS)
];

section('B1 — the shell\u2019s entry on a vouched day is no longer a line');
{
  const built = B([trackerEntry('2026-11-01', 14.78, 428.71)], [], RATE, STD, [], MIXED_SESSIONS);
  eq('B1 no line for Nov 1', lineFor(built, '2026-11-01'), null);
  eq('B1 no lines at all', built.lines.length, 0);
}

section('B2 — the genuine record\u2019s own entry on the same mixed day still lines');
{
  const built = B([trackerEntry('2026-11-01', 1, 29.00)], [], RATE, STD, [], MIXED_SESSIONS);
  const l = lineFor(built, '2026-11-01');
  eq('B2 line stands at $29.00', l && l.amt, 29);
}

section('B3 — an entry matching neither record (his Day Details edit) is left alone');
{
  const built = B([trackerEntry('2026-11-01', 5.25, 152.25)], [], RATE, STD, [], MIXED_SESSIONS);
  const l = lineFor(built, '2026-11-01');
  eq('B3 edited line stands', l && l.amt, 152.25);
}

section('B4 — a travel-composed shell entry is judged by its foreman (session) hours');
{
  const e = trackerEntry('2026-11-01', 15.78, 457.62, { foremanHours: 14.78, travelHours: 1, travelInIncome: true });
  const built = B([e], [], RATE, STD, [], MIXED_SESSIONS);
  eq('B4 no line for Nov 1', lineFor(built, '2026-11-01'), null);
}

section('B5 — a shell-only day stays dead under the v418 day rule (regression)');
{
  const built = B([trackerEntry('2026-11-01', 14.78, 428.71)], [], RATE, STD, [],
    [sessRec('2026-11-01', [2026, 11, 1, 10, 0], SHELL_SECS)]);
  eq('B5 no line for Nov 1', lineFor(built, '2026-11-01'), null);
}

section('B6 — a two-session genuine day: the latest session\u2019s entry lines (regression)');
{
  const sessions = [
    sessRec('2026-11-03', [2026, 11, 3, 12, 0], 7200),   // 10:00–12:00
    sessRec('2026-11-03', [2026, 11, 3, 18, 0], 10800)   // 15:00–18:00 — the stop that wrote the entry
  ];
  const built = B([trackerEntry('2026-11-03', 3, 87.00)], [], RATE, STD, [], sessions);
  const l = lineFor(built, '2026-11-03');
  eq('B6 line stands at $87.00', l && l.amt, 87);
}

section('wiring');
{
  ok('app.js carries the v419 booking gate', appSrc.includes('PHANTOM-ROOT-NOV11') && appSrc.includes('bookDate419'));
  ok('invoice.js carries the v419 entry-level vouch', invSrc.includes('shellHours419') && invSrc.includes('hoursMatch419'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
