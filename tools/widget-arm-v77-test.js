#!/usr/bin/env node
/* Meticulous native gen 58 (v77) — Nov 7, 2026 bench pass.
 *
 * WIDGET-FROZEN-AGAIN, ROUND 5. The decisive read Asjad supplied
 * (Nov 7, 15:04 CST, Preferences → Advanced, session RUNNING, app
 * just opened): "layout widget_tracker_v67 · chronometer off ·
 * built 3:04 PM · face runsec|14529|0%s|Working...|🚛 4 loads ·
 * 266.8 km" — and the Battery screen beside it: Version 1.49
 * (gen 57 confirmed), battery Unrestricted SELECTED.
 *
 * THE CONVICTION (feedback queue, ROUND 5 section): the fresh
 * 15:04 build proves status == RUNNING and rev > 0 at signature
 * time (the "runsec|" form is unreachable otherwise), yet
 * build_chrono is FALSE — and the face's runsec (14529) is
 * bit-identical to the 14:33 video's, ≥31 min earlier, while
 * the page's own elapsed read 16590 at 15:07. A RUNNING record
 * derives a constant elapsed only with segStartMs == 0: the
 * record is { RUNNING, elapsedBase 14529, segStartMs 0 }, and
 * the pre-v77 arm gate (segStartMs > 0 && segStartMs <= now)
 * refuses exactly that record. The derivation and the arm share
 * the one fragile input, so both froze together. Round 3's
 * "the arm cannot fail on a genuinely-running record" is
 * refuted by his live record.
 *
 * THE FIX (native v77, widget arm + telemetry ONLY — the
 * SessionRecord derivation, the sync/stateAt law (gen 54) and
 * the web tree are untouched):
 *   1  buildViews arms the Chronometer for EVERY RUNNING
 *      record — base = elapsedRealtime − elapsedMsOf, and
 *      elapsedMsOf already reduces to the bank alone when the
 *      segment is missing or future-dated — EXCEPT the one
 *      designed shape: armed-not-yet-started (segStartMs > now
 *      AND elapsedBase == 0, seedArmed's seed), which keeps the
 *      honest static 00:00:00 text face.
 *   2  TELEMETRY: the service's 1-s and 30-s widget ticks
 *      stamp tick_at (throttled ≥10 s) and every SessionRecord
 *      write stamps it unthrottled; status().widget surfaces
 *      tickAt + lastRepaintSec + the record's own facts
 *      (recStatus / recSegStartMs / recElapsedBase / recStateAt
 *      / recSrc), so the next verdict read is decisive in one
 *      glance.
 *
 * Run: node tools/widget-arm-v77-test.js
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
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL', name); }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

const tw = read(path.join(APP, 'TrackerWidget.java'));
const sr = read(path.join(APP, 'SessionRecord.java'));
const svc = read(path.join(APP, 'ShiftTrackingService.java'));
const plugin = read(path.join(APP, 'ShiftTrackPlugin.java'));
const gradle = read(path.join(NATIVE, 'android', 'app', 'build.gradle'));
const appJs = read(path.join(STANDALONE, 'js', 'app.js'));

/* ============ Mirrors (transcribed from the shipped code) ============ */
// SessionRecord.Snap.elapsedSec — THE derivation. The fix does
// not touch it; the mirror is asserted byte-equivalent in
// behaviour against the v76 suite's mirror across every shape.
function elapsedSec(rec, now) {
  let s = rec.elapsedBase;
  if (rec.status === 'running' && rec.segStartMs > 0) {
    s += Math.max(0, Math.floor((now - rec.segStartMs) / 1000));
  }
  return Math.max(0, s);
}
// TrackerWidget.elapsedMsOf — millisecond twin of the above.
function elapsedMsOf(rec, now) {
  let ms = rec.elapsedBase * 1000;
  if (rec.status === 'running' && rec.segStartMs > 0) {
    ms += Math.max(0, now - rec.segStartMs);
  }
  return Math.max(0, ms);
}
// The PRE-v77 arm decision (buildViews, gens 52–57).
function armV76(rec, now) {
  return rec.rev > 0 && rec.status === 'running'
      && rec.segStartMs > 0 && rec.segStartMs <= now;
}
// The v77 arm decision (this fix).
function armV77(rec, now) {
  const armedNotStarted = rec.segStartMs > now && rec.elapsedBase === 0;
  return rec.rev > 0 && rec.status === 'running' && !armedNotStarted;
}
// Chronometer base each arm sets (elapsedRealtime − elapsedMsOf),
// expressed here as the elapsed the face shows at arm time.
function faceElapsedAtArm(rec, now) { return elapsedMsOf(rec, now); }

const T0 = 1762000000000; // arbitrary wall epoch for the spine

/* ============ A. The Nov 7 spine shapes ============ */
// A1: a healthy running record (valid past segment): both arms
// fire, and the base is the full derivation in both.
{
  const rec = { rev: 7, status: 'running', elapsedBase: 600, segStartMs: T0 };
  const now = T0 + 3600 * 1000;
  ok(armV76(rec, now) === true && armV77(rec, now) === true,
     'A1 valid segment: arm fires pre- and post-fix');
  ok(faceElapsedAtArm(rec, now) === (600 + 3600) * 1000,
     'A1 base = bank + live segment');
}
// A2: HIS CONVICTED RECORD — RUNNING, bank 14529, segStartMs 0.
// The derivation is constant across the 14:33 → 15:04 window
// (the frozen face), the pre-fix arm refuses it at BOTH builds
// (build_chrono false on the fresh 15:04 build — the
// screenshot), and the v77 arm fires, from the bank.
{
  const rec = { rev: 41, status: 'running', elapsedBase: 14529, segStartMs: 0 };
  const t1433 = T0 + 31 * 60 * 1000, t1504 = T0 + 62 * 60 * 1000;
  ok(elapsedSec(rec, t1433) === 14529 && elapsedSec(rec, t1504) === 14529,
     'A2 convicted record: derivation constant 14529 across 31 min (frozen face reproduced)');
  ok(armV76(rec, t1433) === false && armV76(rec, t1504) === false,
     'A2 pre-fix arm refuses his record at both builds (chronometer off reproduced)');
  ok(armV77(rec, t1504) === true,
     'A2 v77 arm fires on his record');
  ok(faceElapsedAtArm(rec, t1504) === 14529 * 1000,
     'A2 v77 base = the bank alone (14529 s) — a ticking clock at the banked value');
}
// A3: RUNNING with a FUTURE segment but a real bank (a segment
// restated ahead by a bad sync): pre-fix refuses; v77 arms
// from the bank.
{
  const rec = { rev: 9, status: 'running', elapsedBase: 900, segStartMs: T0 + 3600 * 1000 };
  ok(armV76(rec, T0) === false && armV77(rec, T0) === true
     && faceElapsedAtArm(rec, T0) === 900 * 1000,
     'A3 future segment + bank: v77 arms from the bank, pre-fix refused');
}
// A4: THE DESIGNED SHAPE — armed-not-yet-started (seedArmed:
// future segment, NOTHING banked). Its honest face is the
// static 00:00:00 text; v77 must NOT arm it.
{
  const rec = { rev: 3, status: 'running', elapsedBase: 0, segStartMs: T0 + 3600 * 1000 };
  ok(armV77(rec, T0) === false,
     'A4 armed-not-yet-started (future seg, zero bank): v77 keeps the text face');
  ok(armV77(rec, T0 + 3600 * 1000 + 1000) === true,
     'A4 once its segment start passes, the next build arms it');
}
// A5/A6/A7: non-running and unread records never arm, either
// generation.
{
  const paused = { rev: 5, status: 'paused', elapsedBase: 14529, segStartMs: 0 };
  const idle = { rev: 5, status: 'idle', elapsedBase: 0, segStartMs: 0 };
  const none = { rev: 0, status: 'running', elapsedBase: 10, segStartMs: T0 };
  ok(!armV76(paused, T0) && !armV77(paused, T0), 'A5 paused never arms');
  ok(!armV76(idle, T0) && !armV77(idle, T0), 'A6 idle never arms');
  ok(!armV76(none, T0) && !armV77(none, T0), 'A7 rev 0 (no record) never arms');
}
// A8: derivation parity — elapsedMsOf is the derivation at ms
// precision on every shape (the fix changes NO derived value;
// the banked total is the separate timer story).
{
  const shapes = [
    { status: 'running', elapsedBase: 600, segStartMs: T0 },
    { status: 'running', elapsedBase: 14529, segStartMs: 0 },
    { status: 'running', elapsedBase: 900, segStartMs: T0 + 3600 * 1000 },
    { status: 'running', elapsedBase: 0, segStartMs: T0 + 3600 * 1000 },
    { status: 'paused', elapsedBase: 14529, segStartMs: 0 },
    { status: 'idle', elapsedBase: 0, segStartMs: 0 },
  ];
  let all = true;
  for (const rec of shapes) {
    for (const dt of [0, 999, 61000, 1800000]) {
      const now = T0 + dt;
      if (Math.floor(elapsedMsOf(rec, now) / 1000) !== elapsedSec(rec, now)) all = false;
    }
  }
  ok(all, 'A8 elapsedMsOf == elapsedSec (floored) on every shape — derivation untouched');
}
// A9: the full-day spine — 8:00 start, echo-pause fold, resume,
// the bad-shape install, the 15:04 build, then a healing write.
// Pre-fix the 15:04 build cannot arm; post-fix it arms from the
// bank, and the healing write re-anchors seamlessly (the armed
// face and the healed derivation agree at the heal instant).
{
  const start = { rev: 1, status: 'running', elapsedBase: 0, segStartMs: T0 };
  ok(armV77(start, T0 + 1000) === true, 'A9 08:00 start arms');
  const folded = { rev: 2, status: 'paused', elapsedBase: 1487, segStartMs: 0 };
  ok(armV77(folded, T0 + 1500000) === false, 'A9 echo-pause fold: paused face stays text');
  const resumed = { rev: 3, status: 'running', elapsedBase: 1487, segStartMs: T0 + 1560000 };
  ok(armV77(resumed, T0 + 1600000) === true, 'A9 resume arms on its fresh segment');
  const bad = { rev: 41, status: 'running', elapsedBase: 14529, segStartMs: 0 };
  const t1504 = T0 + 62 * 60 * 1000;
  ok(armV76(bad, t1504) === false && armV77(bad, t1504) === true,
     'A9 15:04 build: pre-fix chrono off, v77 arms (the fix, on the day\'s own spine)');
  const healed = { rev: 42, status: 'running', elapsedBase: 14529, segStartMs: t1504 };
  ok(elapsedMsOf(healed, t1504) === faceElapsedAtArm(bad, t1504),
     'A9 healing write re-anchors with no jump at the heal instant');
  ok(elapsedMsOf(healed, t1504 + 60000) === 14529 * 1000 + 60000,
     'A9 after the heal the derivation runs live again');
}

/* ============ B. Source pins (the shipped code IS the fix) ============ */
ok(tw.includes('boolean armedNotStarted = cs.segStartMs > nowC && cs.elapsedBase == 0;')
   && tw.includes('&& !armedNotStarted) {'),
   'B1 buildViews carries the v77 arm (armed-not-started exception only)');
ok(!tw.includes('cs.segStartMs > 0 && cs.segStartMs <= nowC'),
   'B2 the pre-v77 segStartMs arm gate is GONE from TrackerWidget');
ok(tw.includes('long base = SystemClock.elapsedRealtime() - elapsedMsOf(cs, nowC);'),
   'B3 the Chronometer base is still elapsedRealtime − elapsedMsOf (v66 machinery)');
ok(tw.includes('static void stampTick(Context ctx, boolean throttle)')
   && tw.includes('putLong("tick_at", now)'),
   'B4 TrackerWidget.stampTick writes tick_at (throttled form present)');
ok((svc.match(/TrackerWidget\.stampTick\(ShiftTrackingService\.this, true\)/g) || []).length === 2,
   'B5 both service ticks (1-s widgetTick + 30-s widgetDriverTick) stamp the heartbeat');
ok(sr.includes('TrackerWidget.stampTick(ctx, false)'),
   'B6 SessionRecord.write stamps the heartbeat unthrottled');
ok(plugin.includes('widget.put("tickAt", wp.getLong("tick_at", 0));')
   && plugin.includes('widget.put("lastRepaintSec", wp.getLong("last_repaint_sec", 0));'),
   'B7 status().widget surfaces tickAt + lastRepaintSec');
ok(plugin.includes('widget.put("recStatus", rs.status == null ? "" : rs.status);')
   && plugin.includes('widget.put("recSegStartMs", rs.segStartMs);')
   && plugin.includes('widget.put("recElapsedBase", rs.elapsedBase);')
   && plugin.includes('widget.put("recStateAt", rs.stateAt);')
   && plugin.includes('widget.put("recSrc", rs.src == null ? "" : rs.src);'),
   'B8 status().widget surfaces the record facts (recStatus/recSegStartMs/recElapsedBase/recStateAt/recSrc)');
ok(plugin.includes('does NOT prove the record read as not-running'),
   'B9 the wrong v67 status() gloss is corrected in place');

/* ============ C. Preserved law (pins) ============ */
ok(sr.includes('public long elapsedSec(long now)')
   && sr.includes('if (RUNNING.equals(status) && segStartMs > 0)'),
   'C1 the elapsed DERIVATION is byte-identical in shape (untouched by this pass)');
ok(sr.includes('boolean stateFrozen73 = false;') && sr.includes('stateFrozen73 = true;'),
   'C2 the gen-54 stateAt gate (stateFrozen73) stands — sync law untouched');
ok(tw.includes('if (SessionRecord.RUNNING.equals(s.status) && s.segStartMs > 0)'),
   'C3 elapsedMsOf itself is unchanged (the tolerance was already there; only the gate was brittle)');
ok(plugin.includes('openAppLinkSettings'),
   'C4 Job A\'s uncommitted ShiftTrackPlugin work is intact in the tree (not eaten by this pass)');

/* ============ D. Release pins (gen 58 / v77) ============ */
ok(/versionCode 52/.test(gradle) && /versionName "1\.50"/.test(gradle),
   'D1 gradle carries versionCode 52 / versionName 1.50 (gen 58)');
ok(/var APK_VERSION = 58;/.test(appJs),
   'D2 js/app.js APK_VERSION = 58 (release prep)');

console.log(`widget-arm-v77: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
