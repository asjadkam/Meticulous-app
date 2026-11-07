#!/usr/bin/env node
/* Meticulous native gen 57 (v76) — Nov 7, 2026 bench pass.
 *
 * WIDGET-FROZEN-AGAIN, ROUND 3. His words (Nov 7, 12:44): "every
 * second should go up — why is the second not going up, it's not
 * live." The Round-3 trace (feedback queue, WIDGET-FROZEN-AGAIN
 * ROUND 3) convicted the GATE, not a driver: TrackerWidget's
 * build_chrono recorded only that a build CONSTRUCTED a
 * Chronometer-armed RemoteViews. The face signature then dropped
 * to the 30-s bucket and every per-second offer was gated away —
 * so ONE setChronometer update coalesced/dropped by his
 * launcher (the failure the codebase's own v66 comment names on
 * his phone) stranded the previous TEXT face indefinitely, the
 * gate certain a Chronometer was live. Gens 52–56 all shipped
 * variations of the repaint plumbing around that gate, which is
 * why every generation "fixed" the widget and the seconds never
 * moved.
 *
 * THE FIX (native v76, delivery contract only — no layout
 * change; the Chronometer, its base math (the record's own
 * elapsed derivation) and the chronoFormat ladder are exactly
 * the shipped v66 machinery):
 *   1  While the record reads RUNNING, the face signature
 *      ALWAYS carries the second — faceSignature no longer
 *      takes the build_chrono flag at all, and the per-second
 *      offers from the existing drivers (the service's 1-s
 *      wall-aligned tick, the 30-s chain) are never gated away.
 *      A coalesced/dropped arm costs at most the gap to the
 *      next offer, whose buildViews re-arms the Chronometer.
 *      Delivery stops being a single point of failure.
 *   2  Any SessionRecord.write whose RUNNING derivation jumps
 *      by more than 2 s against the last applied RUNNING
 *      derivation (pause fold, resume, adoption restatement —
 *      while the face's last DELIVERED paint predates the
 *      write's own wall second) forces the UNGATED repaintAll
 *      path, so an armed Chronometer's anchor can never sit
 *      stale after a mid-day restatement. Steady running never
 *      trips it.
 *   3  Paused / idle faces stay TEXT (frozen text is correct
 *      there — a stopped Chronometer creeps on re-apply);
 *      armed-not-yet-started stays text until its segment
 *      start, then the next offer arms it.
 *
 * PRESERVED, pinned below: the gen-54 stateAt gate, the web-366
 * timer law (no web arbitration touched by this pass), the
 * elapsed DERIVATION itself (the banked-pause deficit is the
 * separate timer story — the derivation is not touched), the
 * paused 5-min heartbeat, WATCHDOG_MS, and the whole gen-56
 * W1/W2/W3 driver set (the v75 suite still runs as a neighbour).
 *
 * Run: node tools/widget-seconds-v76-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const STANDALONE = path.join(__dirname, '..');
const NATIVE = path.join(STANDALONE, '..', 'meticulous-native');
const APP = path.join(NATIVE, 'android', 'app', 'src', 'main', 'java',
    'com', 'meticuloustechnologies', 'app');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; /* console.log('  ok', name); */ }
  else { fail++; console.log('  FAIL', name); }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

const tw = read(path.join(APP, 'TrackerWidget.java'));
const sr = read(path.join(APP, 'SessionRecord.java'));
const svc = read(path.join(APP, 'ShiftTrackingService.java'));
const ds = read(path.join(APP, 'DayScheduler.java'));
const gradle = read(path.join(NATIVE, 'android', 'app', 'build.gradle'));
const appJs = read(path.join(STANDALONE, 'js', 'app.js'));

/* ============ A. The gate contract (mirror of v76 faceSignature) ============ */
// Mirror of the shipped derivation (SessionRecord.Snap.elapsedSec):
// base + live segment, floored at 0.
function elapsedSec(rec, now) {
  let s = rec.elapsedBase;
  if (rec.status === 'running' && rec.segStartMs > 0) {
    s += Math.max(0, Math.floor((now - rec.segStartMs) / 1000));
  }
  return Math.max(0, s);
}
// Mirror of the v76 RUNNING signature: the second ALWAYS rides,
// independent of any build flag (the mirror has no flag input at all).
function sigRunningV76(rec, status, secondary, now) {
  if (rec.segStartMs > now) return 'armed|' + status + '|' + secondary;
  return 'runsec|' + elapsedSec(rec, now) + '|' + status + '|' + secondary;
}
// Mirror of the RETIRED v74 gate: armed Chronometer (build_chrono
// true) drops the signature to the 30-s bucket.
function sigRunningV74(rec, status, secondary, now, chronoArmed) {
  if (rec.segStartMs > now) return 'armed|' + status + '|' + secondary;
  if (!chronoArmed) {
    return 'runsec|' + elapsedSec(rec, now) + '|' + status + '|' + secondary;
  }
  return 'run|' + Math.floor(elapsedSec(rec, now) / 30) + '|' + status + '|' + secondary;
}

const T0 = 1762000000000;
const rec = { status: 'running', elapsedBase: 600, segStartMs: T0 };

// A1: under v76 the signature changes EVERY second while running —
//     a per-second offer can never be signature-gated away.
{
  let all = true;
  for (let k = 0; k < 90; k++) {
    const a = sigRunningV76(rec, 'Working…', 'x', T0 + k * 1000 + 10);
    const b = sigRunningV76(rec, 'Working…', 'x', T0 + (k + 1) * 1000 + 10);
    if (a === b) all = false;
  }
  ok(all, 'A1 v76 RUNNING signature changes every second (90 s sweep)');
}
// A2: the retired v74 gate, armed — the signature is IDENTICAL for
//     29 consecutive seconds inside a bucket: the strand, reproduced.
{
  let frozen = true;
  const s0 = sigRunningV74(rec, 'Working…', 'x', T0 + 1000, true);
  for (let k = 2; k <= 29; k++) {
    if (sigRunningV74(rec, 'Working…', 'x', T0 + k * 1000, true) !== s0) frozen = false;
  }
  ok(frozen, 'A2 v74 armed-bucket signature frozen 29 s (the Round-3 strand)');
}
// A3: the dropped-arm scenario, end to end. The arm's update is
//     coalesced at wall second 100. v74-armed: the next offer that
//     survives the gate is the bucket boundary — the text face sits
//     up to ~29 s stale EVEN WITH the 1-s driver alive, and if the
//     boundary build is dropped too, indefinitely. v76: the very
//     next second's offer repaints (and re-arms).
{
  const dropAt = T0 + 100 * 1000;
  const v74next = (() => {
    const sDrop = sigRunningV74(rec, 'Working…', 'x', dropAt, true);
    for (let k = 1; k <= 60; k++) {
      if (sigRunningV74(rec, 'Working…', 'x', dropAt + k * 1000, true) !== sDrop) return k;
    }
    return Infinity;
  })();
  const v76next = (() => {
    const sDrop = sigRunningV76(rec, 'Working…', 'x', dropAt);
    for (let k = 1; k <= 60; k++) {
      if (sigRunningV76(rec, 'Working…', 'x', dropAt + k * 1000) !== sDrop) return k;
    }
    return Infinity;
  })();
  ok(v74next > 1 && v76next === 1,
    'A3 dropped arm: v74 waits for the bucket, v76 repaints next second');
}
// A4: paused stays TEXT — the paused signature is the frozen clock
//     string and does not move with wall time (no per-second churn
//     for a state whose face must not move).
{
  const p = { status: 'paused', elapsedBase: 1500, segStartMs: 0 };
  const clock = (r) => {
    const s = elapsedSec(r, 0);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    const p2 = (n) => String(n).padStart(2, '0');
    return p2(h) + ':' + p2(m) + ':' + p2(ss);
  };
  ok(elapsedSec(p, T0) === elapsedSec(p, T0 + 3600000)
      && ('pause|' + clock(p)) === 'pause|00:25:00',
    'A4 PAUSED derivation is wall-independent — frozen text is correct');
}
// A5: armed-not-yet-started stays text: the signature carries no
//     second while the segment start is still ahead.
{
  const future = { status: 'running', elapsedBase: 0, segStartMs: T0 + 60000 };
  ok(sigRunningV76(future, 'Working…', 'x', T0) === 'armed|Working…|x'
      && sigRunningV76(future, 'Working…', 'x', T0 + 30000) === 'armed|Working…|x',
    'A5 armed-not-yet-started signature carries no second (text until start)');
}

/* ============ B. The restatement rule (mirror of SessionRecord.write v76) ============ */
// state: { lastApplied } in seconds, -1 = none yet this process.
// paintSec: the face's last DELIVERED paint wall-second (-1 = none).
// Returns true when the write forces the ungated rebuild.
function restated76(state, status, derivedSec, paintSec, writeWallSec) {
  if (status === 'running') {
    const prev = state.lastApplied;
    state.lastApplied = derivedSec;
    if (prev >= 0 && Math.abs(derivedSec - prev) > 2) {
      return paintSec < 0 || paintSec !== writeWallSec;
    }
    return false;
  }
  state.lastApplied = -1;
  return false;
}
// B1: steady running — consecutive writes sampled 0–3 s apart never
//     trip the rule (the jump is measured between the writes' own
//     sampled derivations, so the threshold sits above the gap).
{
  const st = { lastApplied: -1 };
  let tripped = false;
  let derived = 3600;
  // first write arms the yardstick
  restated76(st, 'running', derived, 1000, 1000);
  for (let k = 0; k < 200; k++) {
    derived += 2; // writes 2 s apart, worst steady case
    if (restated76(st, 'running', derived, 1000 + derived, 1000 + derived)) tripped = true;
  }
  ok(!tripped, 'B1 steady running never trips the restatement rule');
}
// B2: the Nov 7 shape — resume restates the day forward by ~2.5 h
//     against the held derivation: the rule fires.
{
  const st = { lastApplied: -1 };
  restated76(st, 'running', 1487, 5000, 5000); // held at 00:24:47
  ok(restated76(st, 'running', 1487 + 9060, 5000, 14060) === true,
    'B2 resume restatement (+9060 s) forces the rebuild');
}
// B3: a BACKWARD jump (adoption restating the day down) fires too —
//     the anchor is stale in either direction.
{
  const st = { lastApplied: -1 };
  restated76(st, 'running', 10000, 5000, 5000);
  ok(restated76(st, 'running', 4000, 5000, 9000) === true,
    'B3 backward restatement (−6000 s) forces the rebuild');
}
// B4: the same-wall-second exclusion — a jump whose write arrives
//     in the very second the face last painted delivered is the
//     write's own echo (its paint is already in flight / landed);
//     no second rebuild is forced.
{
  const st = { lastApplied: -1 };
  restated76(st, 'running', 100, 7000, 6990);
  ok(restated76(st, 'running', 5000, 7000, 7000) === false,
    'B4 jump delivered in the face\u2019s own paint second does not double-force');
}
// B5: a pause resets the yardstick — the first RUNNING write after
//     a pause is a fresh arm, not a "jump" from the pre-pause value.
{
  const st = { lastApplied: -1 };
  restated76(st, 'running', 3000, 5000, 5000);
  restated76(st, 'paused', 3000, 5001, 5001);
  ok(restated76(st, 'running', 3005, 5002, 5002) === false,
    'B5 pause resets the yardstick (resume re-arms silently)');
}
// B6: boundary — a jump of exactly 2 s does not fire; 3 s does.
{
  const st = { lastApplied: -1 };
  restated76(st, 'running', 1000, 5000, 5000);
  const at2 = restated76(st, 'running', 1002, 5000, 5002);
  const st2 = { lastApplied: -1 };
  restated76(st2, 'running', 1000, 5000, 5000);
  const at3 = restated76(st2, 'running', 1003, 5000, 5003);
  ok(at2 === false && at3 === true, 'B6 threshold is strictly > 2 s');
}

/* ============ C. Source pins — the gate contract as shipped ============ */
const sigIdx = tw.indexOf('private static String faceSignature');
const sigHead = sigIdx >= 0 ? tw.slice(sigIdx, sigIdx + 700) : '';
ok(sigIdx >= 0 && !sigHead.includes('boolean'),
  'C1 faceSignature takes NO build_chrono flag (the gate input is gone)');
const runBranch = sigIdx >= 0 ? tw.slice(sigIdx, sigIdx + 9000) : '';
ok(runBranch.includes('return "runsec|" + s.elapsedSec(now)'),
  'C2 the RUNNING signature is the per-second runsec form');
ok(!tw.includes('(s.elapsedSec(now) / 30)'),
  'C3 the 30-s bucket signature form is retired from the code');
ok(!tw.includes('getBoolean("build_chrono", false)'),
  'C4 nothing reads build_chrono as a gate anymore');
ok(tw.includes('putLong("last_repaint_sec", now / 1000L)'),
  'C5 every landed paint stamps the delivery second');
ok(tw.includes('sp.getString("face_sig", "")'),
  'C6 the signature gate itself still stands (unchanged faces cost one read)');
ok(tw.includes('setChronometer(R.id.widget_chrono, base,'),
  'C7 the Chronometer arm is the shipped v66 machinery, untouched');
ok(tw.includes('long base = SystemClock.elapsedRealtime() - elapsedMsOf(cs, nowC);'),
  'C8 the Chronometer base is still the record derivation at build time');
ok(tw.includes('return "pause|" + s.clock(now)'),
  'C9 the PAUSED signature is still the frozen text clock');
ok(runBranch.includes('if (s.segStartMs > now) return "armed|"'),
  'C10 armed-not-yet-started still builds the text face');

/* ============ D. Source pins — the restatement rule as shipped ============ */
ok(sr.includes('lastAppliedRunningSec76'),
  'D1 SessionRecord carries the applied-derivation yardstick');
ok(sr.includes('Math.abs(derived76 - prev76) > 2'),
  'D2 the jump threshold is > 2 s against the previous snapshot');
ok(sr.includes('TrackerWidget.repaintAll(ctx); } catch (Throwable ignored) {}')
    && sr.includes('restated76'),
  'D3 a restatement forces the UNGATED repaintAll path');
ok(sr.includes('last_repaint_sec') && sr.includes('paintSec76 != nowW / 1000L'),
  'D4 the force is suppressed only for the face\u2019s own paint second');
ok(sr.includes('lastAppliedRunningSec76 = -1;'),
  'D5 a non-RUNNING write resets the yardstick');
// The derivation itself is untouched: elapsedSec is the shipped sum.
ok(sr.includes('public long elapsedSec(long now) {')
    && sr.includes('s += Math.max(0, (now - segStartMs) / 1000);'),
  'D6 the elapsed derivation is byte-identical to the shipped law');

/* ============ E. Preserved laws (must not move) ============ */
ok(sr.includes('stateFrozen'), 'E1 gen-54 stateAt gate intact in SessionRecord');
ok(tw.includes('delay = 5 * 60 * 1000L'), 'E2 paused 5-minute heartbeat unchanged');
ok(ds.includes('WATCHDOG_MS = 15 * 60 * 1000L'), 'E3 watchdog period unchanged');
ok(svc.includes('WIDGET_DRIVER_MS = 30000L')
    && svc.includes('TrackerWidget.refreshFromRecord'),
  'E4 gen-56 W1 service drivers intact (1-s tick + 30-s driver tick)');
ok(tw.includes('public void onEnabled(Context context)'),
  'E5 gen-56 W3 onEnabled revival intact');
ok(tw.includes('30 - (elapsed % 30)'),
  'E6 the chain shot still targets the 30-s bucket boundary (v74, schedule only)');

/* ============ F. Release pins ============ */
ok(gradle.includes('versionCode 51'), 'F1 versionCode 51 (gen 57)');
ok(gradle.includes('versionName "1.49"'), 'F2 versionName 1.49');
ok(appJs.includes('var APK_VERSION = 57;'), 'F3 app.js APK_VERSION bumped to 57');

console.log(`widget-seconds-v76: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
