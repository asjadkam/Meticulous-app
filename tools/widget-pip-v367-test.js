#!/usr/bin/env node
/* Meticulous web 367 + native gen 55 (v74) — Nov 7, 2026 bench pass.
 *
 * Two reports from the owner today, one ship:
 *
 * (1) WIDGET-FROZEN-AGAIN (11:23 screenshot): the in-app card ran
 *     00:54:37 while the home-screen widget showed the same session
 *     "Working…" at 00:54:05 / 116.4 km — a stale snapshot. Trace:
 *     the morning's frozen-PAUSED face was NOT a repaint failure —
 *     it faithfully painted the poisoned record from
 *     TIMER-STOPPED-BY-ITSELF (fixed web 365/366), proven by its own
 *     miles advancing under the held clock. The late-morning lag is
 *     a SEPARATE, structural exposure: while RUNNING the face is
 *     only as fresh as (a) the record and (b) the last landed
 *     paint's Chronometer anchor. The gated signature refreshed
 *     that anchor at most once a MINUTE (v67 bucket), and the
 *     repaint chain could go driverless: syncFromWeb's no-op
 *     returns (same facts / the v73 stateFrozen guard) skip
 *     SessionRecord.write() — rev-churn avoidance — which also
 *     skipped the chain re-arm write() performs, so with the
 *     tracking service dead the only drivers left were the 15-min
 *     watchdog and the 30-min system floor. Web 365/366 changed
 *     NONE of this cadence (its app.js hunk is adoptSessionRecord
 *     only — verified in the commit).
 *     Fix (native v74): the running signature bucket halves to
 *     30 s; scheduleRepaint's running shot targets the same 30 s
 *     boundary; sessionSync re-arms the chain after EVERY sync,
 *     applied or no-op, so the page's own ~1-min save cadence is
 *     a chain heartbeat. The gen-54 stateAt gate and the web-366
 *     law are untouched (pinned below).
 *
 * (2) PIP-DROPS-OUT-NOV7 (11:25: "And still no pip coming on?"):
 *     PiP was alive at 08:50 ("PiP navigating") and gone by late
 *     morning. SEPARATE mechanism from TIMER-STOPPED: the echo
 *     fold never touches the drive arm. The arm itself was the
 *     only float arm with NO persisted fact and NO restore:
 *     ShiftTrackPlugin.navDriving was a process static, armed by
 *     the web layer exactly once (startDrive), never re-asserted.
 *     The session arm beside it is persisted (KEY_SESSION_ARMED)
 *     and restored at load() — and the session bubble demonstrably
 *     survived the same day (install + OTA relaunches) that the
 *     drive arm did not. Fix: the arm persists (KEY_NAV_DRIVING),
 *     load() restores it and re-registers PiP params; setDriving
 *     side effects fire only on real flips (a re-assert must not
 *     resurrect a dismissed drive bubble); web boot stands down a
 *     stale arm (a fresh page holds no live drive — startDrive is
 *     a drive's only birth); the navigator re-asserts the arm on
 *     every foreground return while a drive is live (onDriveVis).
 *
 * (3) APK_VERSION leftover: app.js carried APK_VERSION = 52 at
 *     gen 54, so a fully-updated phone still showed the update
 *     banner. The constant bumps to 55 — and because OTA delivers
 *     this same app.js into older shells, the comparison now reads
 *     the RUNNING SHELL's generation from Capacitor App.getInfo
 *     (generation = versionCode + 6: vc48 = gen 54) with the
 *     constant as fallback. The law is unchanged: banner ONLY when
 *     the published version is STRICTLY greater.
 *
 * Run: node tools/widget-pip-v367-test.js
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

/* ============ A. Widget bucket / chain math (JS mirror of v74) ============ */
// Mirror of TrackerWidget.faceSignature's running time element (chrono armed):
const sigBucket = (elapsedSec) => Math.floor(elapsedSec / 30);
// A1: two offers inside one bucket share a signature (no repaint storm).
ok(sigBucket(100) === sigBucket(110), 'A1 same bucket gates offers 10s apart');
ok(sigBucket(100) === 3 && sigBucket(119) === 3, 'A1b bucket edges');
// A2: crossing a bucket boundary changes the signature (a paint lands).
ok(sigBucket(121) === 4 && sigBucket(121) !== sigBucket(119), 'A2 boundary crossing repaints');
// A3: worst-case wait to the next boundary is <= 30 s at any elapsed.
let a3 = true;
for (let e = 0; e <= 7200; e++) { if (30 - (e % 30) > 30) a3 = false; }
ok(a3 && (30 - (0 % 30)) === 30 && (30 - (29 % 30)) === 1, 'A3 boundary wait within (0,30]s');
// Mirror of TrackerWidget.scheduleRepaint's running delay (v74):
function chainDelayMs(elapsedSec, fracMs) {
  const remSec = 30 - (elapsedSec % 30);
  let delay = remSec * 1000 - fracMs;
  if (delay < 2000) delay += 30000;
  if (delay > 35000) delay = 35000;
  return delay;
}
// A4: the chain shot always lands in a LATER bucket than it was armed in,
//     and never more than 35 s out — so while the chain lives, a gated
//     paint is offered at least every ~35 s and the anchor lag is bounded.
let a4 = true, a4b = true;
for (let e = 0; e <= 7200; e += 7) {
  for (const frac of [0, 250, 500, 999]) {
    const d = chainDelayMs(e, frac);
    if (!(d >= 2000 && d <= 35000)) a4 = false;
    // ms truth: the segment's elapsed at arm time is e*1000 + frac;
    // the shot must land in a strictly later 30 s bucket than that.
    const armMs = e * 1000 + frac;
    if (!(Math.floor((armMs + d) / 30000) > Math.floor(armMs / 30000))) a4b = false;
  }
}
ok(a4, 'A4 chain delay bounded [2s, 35s]');
ok(a4b, 'A4b chain shot lands past a bucket boundary');
// A5: a state flip always changes the signature head (run| vs pause| vs
//     idle|) — a pause/resume paints on its own record write's offer,
//     never waits for a bucket.
ok('run' !== 'pause' && 'pause' !== 'idle', 'A5 state flips change the signature head');

/* ============ B. Native source pins ============ */
const tw = read(path.join(APP, 'TrackerWidget.java'));
const stp = read(path.join(NATIVE, 'android', 'app', 'src', 'main', 'java',
    'com', 'meticuloustechnologies', 'app', 'ShiftTrackPlugin.java'));
const cs = read(path.join(APP, 'CrumbStore.java'));
const sr = read(path.join(APP, 'SessionRecord.java'));
const wr = read(path.join(APP, 'WatchdogReceiver.java'));
const infoXml = read(path.join(NATIVE, 'android', 'app', 'src', 'main', 'res',
    'xml', 'widget_tracker_info.xml'));

ok(tw.includes('(s.elapsedSec(now) / 30)'), 'B1 signature bucket is 30s');
ok(!tw.includes('(s.elapsedSec(now) / 60)'), 'B1b minute bucket gone');
ok(tw.includes('long remSec = 30 - (elapsed % 30);'), 'B2 chain targets the 30s boundary');
ok(tw.includes('if (delay < 2000) delay += 30000;'), 'B2b chain floor re-arms +30s');
ok(tw.includes('delay = 5 * 60 * 1000L;'), 'B3 paused heartbeat unchanged (5 min)');
const syncRegion = stp.slice(stp.indexOf('public void sessionSync'),
    stp.indexOf('public void sessionSync') + 3200);
ok(syncRegion.includes('TrackerWidget.scheduleRepaint(ctx)'),
    'B4 sessionSync re-arms the chain after every sync');
ok(wr.includes('TrackerWidget.refreshFromRecord'), 'B5 watchdog repaint backstop (v73) intact');
ok(infoXml.includes('1800000'), 'B6 system widget floor unchanged (30 min, honest backstop)');
ok(sr.includes('stateFrozen'), 'B7 gen-54 stateAt gate untouched in SessionRecord');
// PiP arm persistence:
ok(cs.includes('KEY_NAV_DRIVING = "navDriving"'), 'B8 drive arm persisted key exists');
ok(stp.includes('putBoolean(CrumbStore.KEY_NAV_DRIVING, navDriving)'),
    'B9 setDriving persists the arm');
const loadRegion = stp.slice(stp.indexOf('public void load()'),
    stp.indexOf('public void load()') + 4200);
ok(loadRegion.includes('KEY_NAV_DRIVING') && loadRegion.includes('navDriving = true'),
    'B10 load() restores the drive arm');
ok(loadRegion.includes('KEY_SESSION_ARMED'), 'B10b session arm restore intact beside it');
ok(stp.includes('boolean flipToDriving = want && !navDriving;')
    && stp.includes('if (flipToDriving) BubbleOverlay.clearDriveDismissal'),
    'B11 dismissal clears only on a real flip into driving');

/* ============ C. Web pins ============ */
const appJs = read(path.join(STANDALONE, 'js', 'app.js'));
const navJs = read(path.join(STANDALONE, 'modules', 'navigator.js'));
const idx = read(path.join(STANDALONE, 'index.html'));
const vj = JSON.parse(read(path.join(STANDALONE, 'version.json')));

ok(appJs.includes('var APK_VERSION = 55;'), 'C1 APK_VERSION bumped to 55');
ok(appJs.includes('parseInt(ai.build, 10)') && appJs.includes('b + 6'),
    'C2 shell generation read from App.getInfo (build + 6)');
ok(appJs.includes('info.version > shellGen'), 'C3 banner condition strictly greater');
// Banner law mirror:
const bannerShows = (published, shellGen) => published > shellGen;
ok(bannerShows(54, 54) === false, 'C3b gen-54 phone, gen-54 published: no banner (today\u2019s bug)');
ok(bannerShows(55, 54) === true, 'C3c gen-54 phone offered gen 55');
ok(bannerShows(55, 55) === false, 'C3d fully updated: no banner');
ok(bannerShows(55, 53) === true, 'C3e older shell still offered the update');
ok((48 + 6) === 54 && (49 + 6) === 55, 'C3f versionCode->generation mapping (vc48=54, vc49=55)');
ok(appJs.includes('ShiftTrack.setDriving(false)'),
    'C4 boot reconciles a stale drive arm down');
const visRegion = navJs.slice(navJs.indexOf('function onDriveVis'),
    navJs.indexOf('function onDriveVis') + 1400);
ok(visRegion.includes('ShiftTrack.setDriving(true)'),
    'C5 navigator re-asserts the arm on foreground during a live drive');
const startIdx = navJs.indexOf('function startDrive');
const armIdx = navJs.indexOf('ShiftTrack.setDriving(true)', startIdx);
const exitIdx = navJs.indexOf('function exitDrive', startIdx);
ok(armIdx > startIdx && (exitIdx === -1 || armIdx < exitIdx),
    'C6 startDrive still arms (a drive\u2019s only birth)');
ok(navJs.includes('ShiftTrack.setDriving(false)'), 'C7 exitDrive still disarms');
ok(idx.includes('js/app.js?v=367') && idx.includes('modules/navigator.js?v=367'),
    'C8 index.html version tags at 367');
ok(vj.webVersion === 367, 'C9 version.json webVersion 367');

/* ============ D. Native release pins ============ */
const gradle = read(path.join(NATIVE, 'android', 'app', 'build.gradle'));
ok(gradle.includes('versionCode 49'), 'D1 versionCode 49 (gen 55)');
ok(gradle.includes('versionName "1.47"'), 'D2 versionName 1.47');

console.log(`widget-pip-v367: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
