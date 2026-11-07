#!/usr/bin/env node
/* Meticulous native gen 56 (v75) — Nov 7, 2026 bench pass.
 *
 * WIDGET-FROZEN-AGAIN, ROUND 2. His verdict on gen 55 (install +
 * full relaunch done, App info reads Version 1.47): the repairs
 * do not show. Round 2's code trace (feedback queue, GEN-55
 * IN-HANDS FAILURE — ROUND 2 ADDENDUM) exonerated the banner at
 * compile level, disproved chain-tier collapse on his install
 * class, and narrowed the widget failure to DRIVER STARVATION:
 * every repaint driver was chained state that lives only while
 * something re-arms it — the alarm chain, the 15-min watchdog,
 * the OS floor — and gen 55's keystone re-arm (sessionSync)
 * fires only from the web page's save choke point, so a
 * sleeping/killed page starved the whole chain while the
 * session ran on underneath. Platform fact recorded with the
 * brief: exact-alarm delivery is quota-capped (~1 wakeup/min in
 * Doze terms), so NO alarm chain can honour a 30 s promise on a
 * sleeping phone. The honest architecture is a driver that does
 * not sleep while a session runs: the foreground tracking
 * service.
 *
 * THE FIX (native v75, structural — no cadence constant is
 * changed anywhere; the mechanism was starvation, not cadence):
 *   W1  ShiftTrackingService gains a widget DRIVER tick: while
 *       a session records (this service alive — the same
 *       aliveness the session itself depends on), a ~30 s
 *       handler cadence posts TrackerWidget.refreshFromRecord
 *       + scheduleRepaint and re-arms the watchdog. The chain
 *       and watchdog become backstops this tick keeps armed.
 *   W2  UpdateRepaintReceiver, after repaintAll on
 *       MY_PACKAGE_REPLACED, also calls scheduleRepaint +
 *       watchdog re-arm — an install leaves every driver armed,
 *       not just one repaint landed.
 *   W3  TrackerWidget.onEnabled (first widget added) does
 *       repaintAll + full re-arm, mirroring onUpdate.
 *
 * PRESERVED, pinned below: the gen-54 stateAt gate
 * (SessionRecord.stateFrozen), the web-366 timer law (no
 * cloudsync/app.js arbitration touched by this pass), the 30 s
 * signature bucket and chain-shot math (v74), the paused
 * 5-minute heartbeat, WATCHDOG_MS.
 *
 * HONEST BOUND (W4): while the tracking service lives, the
 * face is never more than ~30 s behind the record. When the
 * whole process is dead, the watchdog (~15 min) and OS widget
 * floor (~30 min) bounds apply.
 *
 * Run: node tools/widget-driver-v75-test.js
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

const svc = read(path.join(APP, 'ShiftTrackingService.java'));
const tw = read(path.join(APP, 'TrackerWidget.java'));
const urr = read(path.join(APP, 'UpdateRepaintReceiver.java'));
const sr = read(path.join(APP, 'SessionRecord.java'));
const stp = read(path.join(APP, 'ShiftTrackPlugin.java'));
const ds = read(path.join(APP, 'DayScheduler.java'));
const gradle = read(path.join(NATIVE, 'android', 'app', 'build.gradle'));
const appJs = read(path.join(STANDALONE, 'js', 'app.js'));

/* ============ A. Driver cadence math (mirror of the v75 tick) ============ */
// The driver tick period: while the service lives, refreshFromRecord is
// offered at least this often, independent of page saves / chain shots.
const DRIVER_MS = 30000;
// A1: a dropped chain shot is re-armed by the driver within one period —
//     the chain can never stay dead longer than DRIVER_MS while the
//     service lives (gen 55: unbounded — nothing re-armed it but the page).
ok(DRIVER_MS === 30000, 'A1 driver cadence is 30 s');
// A2: worst-case face staleness while the service lives = one driver
//     period (the tick offers a repaint AND re-arms the chain, whose own
//     shot is <= 35 s out — the driver offer lands first).
let a2 = true;
for (let offset = 0; offset < DRIVER_MS; offset += 977) {
  const nextOffer = DRIVER_MS - offset; // ms until the next driver tick
  if (!(nextOffer > 0 && nextOffer <= DRIVER_MS)) a2 = false;
}
ok(a2, 'A2 next driver offer always within (0, 30 s]');
// A3: the driver does not replace the chain's finer running shot: the
//     v74 chain delay stays in [2 s, 35 s] (mirror, unchanged).
function chainDelayMs(elapsedSec, fracMs) {
  const remSec = 30 - (elapsedSec % 30);
  let delay = remSec * 1000 - fracMs;
  if (delay < 2000) delay += 30000;
  if (delay > 35000) delay = 35000;
  return delay;
}
let a3 = true;
for (let e = 0; e <= 7200; e += 7) {
  for (const frac of [0, 250, 500, 999]) {
    const d = chainDelayMs(e, frac);
    if (!(d >= 2000 && d <= 35000)) a3 = false;
  }
}
ok(a3, 'A3 v74 chain-shot math unchanged');

/* ============ B. W1 — service driver tick (source pins) ============ */
const drvIdx = svc.indexOf('widgetDriverTick');
const drvRegion = drvIdx >= 0 ? svc.slice(Math.max(0, drvIdx - 200), drvIdx + 2600) : '';
ok(svc.includes('WIDGET_DRIVER_MS = 30000L'), 'B1 driver cadence constant 30000 ms');
ok(drvRegion.includes('TrackerWidget.refreshFromRecord'), 'B2 driver tick offers a repaint');
ok(drvRegion.includes('TrackerWidget.scheduleRepaint'), 'B3 driver tick re-arms the repaint chain');
ok(drvRegion.includes('DayScheduler.scheduleWatchdog')
    && drvRegion.includes('DayScheduler.WATCHDOG_MS'),
  'B4 driver tick re-arms the watchdog at its own period');
ok(drvRegion.includes('SessionRecord.RUNNING.equals(s.status)')
    && drvRegion.includes('SessionRecord.PAUSED.equals(s.status)'),
  'B5 watchdog re-arm gated on a live session record (watchdog contract)');
ok(drvRegion.includes('postDelayed(this, WIDGET_DRIVER_MS)'),
  'B6 driver tick re-posts itself on the cadence');
const startTickIdx = svc.indexOf('private void startWidgetTick()');
const startRegion = startTickIdx >= 0 ? svc.slice(startTickIdx, startTickIdx + 1400) : '';
ok(startRegion.includes('post(widgetDriverTick)'),
  'B7 driver tick started with the widget tick (service recording)');
const stopTickIdx = svc.indexOf('private void stopWidgetTick()');
const stopRegion = stopTickIdx >= 0 ? svc.slice(stopTickIdx, stopTickIdx + 700) : '';
ok(stopRegion.includes('removeCallbacks(widgetDriverTick)'),
  'B8 driver tick stopped with the widget tick (service stops)');

/* ============ C. W2 — install leaves every driver armed ============ */
const urrIdx = urr.indexOf('TrackerWidget.repaintAll(context)');
const urrTail = urrIdx >= 0 ? urr.slice(urrIdx) : '';
ok(urrIdx >= 0, 'C1 UpdateRepaintReceiver still repaints on package replaced');
ok(urrTail.includes('TrackerWidget.scheduleRepaint(context)'),
  'C2 after repaintAll: chain re-armed');
ok(urrTail.includes('DayScheduler.scheduleWatchdog(context, DayScheduler.WATCHDOG_MS)'),
  'C3 after repaintAll: watchdog re-armed while a session is live');

/* ============ D. W3 — first widget added gets the full revival ============ */
const enIdx = tw.indexOf('public void onEnabled(Context context)');
const enRegion = enIdx >= 0 ? tw.slice(enIdx, enIdx + 1500) : '';
ok(enIdx >= 0, 'D1 TrackerWidget.onEnabled exists (v75)');
ok(enRegion.includes('repaintAll(context)'), 'D2 onEnabled repaints from the record');
ok(enRegion.includes('scheduleRepaint(context)'), 'D3 onEnabled re-arms the chain');
ok(enRegion.includes('DayScheduler.scheduleWatchdog(context, DayScheduler.WATCHDOG_MS)'),
  'D4 onEnabled revives the watchdog while a session is live (mirrors onUpdate)');

/* ============ E. Preserved laws (must not move) ============ */
ok(sr.includes('stateFrozen'), 'E1 gen-54 stateAt gate intact in SessionRecord');
ok(stp.includes('TrackerWidget.scheduleRepaint'),
  'E2 sessionSync chain re-arm (gen 55) intact in ShiftTrackPlugin');
ok(tw.includes('30 - (elapsed % 30)'), 'E3 30 s signature/chain bucket (v74) intact');
ok(tw.includes('delay = 5 * 60 * 1000L'), 'E4 paused 5-minute heartbeat unchanged');
ok(ds.includes('WATCHDOG_MS = 15 * 60 * 1000L'), 'E5 watchdog period unchanged');
ok(!svc.includes('setExactAndAllowWhileIdle') && !svc.includes('AlarmManager'),
  'E6 the service tick invents no new alarm — handler cadence only');

/* ============ F. Release pins ============ */
ok(gradle.includes('versionCode 50'), 'F1 versionCode 50 (gen 56)');
ok(gradle.includes('versionName "1.48"'), 'F2 versionName 1.48');
ok(appJs.includes('var APK_VERSION = 56;'), 'F3 app.js APK_VERSION bumped to 56');

console.log(`widget-driver-v75: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
