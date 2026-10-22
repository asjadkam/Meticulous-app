#!/usr/bin/env node
/* Meticulous v63 (native v34) — native background tracking: behavioral
 * tests against the REAL shipped engines. The MILES-ENGINE region of
 * js/miles.js and the GEOLOADS-ENGINE region of js/geoloads.js are
 * sliced out verbatim and driven with simulated fix streams +
 * native-service breadcrumb runs (Calgary-area coordinates).
 * Run: node tools/native-track-test.js
 *
 * Covers the owner's Oct 14 order (drivers paid BY THE MILE):
 *  (a) live-stream behavior unchanged: same drive, same total
 *  (b) plain relaunch with NO crumbs still counts NO join segment
 *  (c) crumbs the service observed while the app was "dead" fold in
 *      fully — the background stretch counts, exactly once
 *  (d) a TRUE gap (service silent > OBS_GAP_MAX, then recording far
 *      away) is never counted; the later observed run still counts
 *  (e) overlap dedupe: fixes seen live AND as crumbs count once;
 *      re-feeding the same crumb run is a no-op (idempotent merge)
 *  (f) out-of-order crumbs merge the same as ordered ones
 *  (g) bad crumbs (accuracy > 50 m, corrupt fields) are dropped;
 *      unknown accuracy (-1) is accepted, like the live stream
 *  (h) crumbs fed to an inactive engine change nothing
 *  (i) a background load->dump cycle (geofence) counts exactly one
 *      load; crumbs already seen live never double-count it
 *  (j) static glue checks: shifttrack.js feature-detects the plugin
 *      and stays inert without it, app.js hooks exist, Preferences
 *      carries the status block, index.html loads the bridge
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.log('  NOT OK -', name); }
}

function extract(file, beginMark, endMark) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found in ' + file);
  return src.slice(a, b + 2);
}

const milesCode = extract('js/miles.js', 'MILES-ENGINE-BEGIN', 'MILES-ENGINE-END');
const msb = {};
vm.createContext(msb);
vm.runInContext(milesCode, msb);
const M = msb.ENGINE;
if (!M || typeof M.createMilesTracker !== 'function') throw new Error('miles engine not extracted');
if (typeof M.createMilesTracker().mergeCrumbs !== 'function') throw new Error('mergeCrumbs missing');

const geoCode = extract('js/geoloads.js', 'GEOLOADS-ENGINE-BEGIN', 'GEOLOADS-ENGINE-END');
const gsb = {};
vm.createContext(gsb);
vm.runInContext(geoCode, gsb);
const G = gsb.ENGINE;
if (!G || typeof G.createGeoLoadCounter !== 'function') throw new Error('geoloads engine not extracted');

/* ---------- trace helpers ---------- */
const T0 = 1760455200000; // fixed epoch (2026-10-14 ~08:00 MDT)
const LAT = 51.05, LNG = -114.07;
function off(lat, lng, eM, nM) {
  return [lat + nM / 111320, lng + eM / (111320 * Math.cos(lat * Math.PI / 180))];
}
function fixAt(tSec, ll, acc) {
  return { latitude: ll[0], longitude: ll[1], accuracy: (acc === undefined ? 8 : acc), time: T0 + tSec * 1000 };
}
function crumbAt(tSec, ll, acc) {
  return { t: T0 + tSec * 1000, a: ll[0], o: ll[1], c: (acc === undefined ? 8 : acc) };
}
/* A straight drive east: points every stepSec, stepM apart. */
function drive(from, stepM, steps, stepSec) {
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push(off(from[0], from[1], stepM * i, 0));
  return pts;
}
const TOT = function (tr) { return Math.round(tr.totalM()); }; // total in whole meters
/* off() places points with a flat 111320 m/deg yardstick while the engine's
   haversine uses a spherical earth — expect agreement within 0.5%. */
const NEAR = function (tr, meters) { return Math.abs(TOT(tr) - meters) <= meters * 0.005 + 1; };

console.log('miles engine: mergeCrumbs');

/* (a) live-only baseline: 20 x 100 m steps = 2000 m */
{
  const tr = M.createMilesTracker();
  tr.begin('s1', null);
  const pts = drive([LAT, LNG], 100, 20, 30);
  pts.forEach((p, i) => tr.ingest(fixAt(i * 30, p)));
  ok(NEAR(tr, 2000), '(a) live stream alone counts the full 2.00 km drive (got ' + TOT(tr) + ' m)');
}

/* (b) plain relaunch, NO crumbs: join never counted (pre-v63 rule) */
{
  const tr = M.createMilesTracker();
  tr.begin('s1', null);
  const pts = drive([LAT, LNG], 100, 5, 30);
  pts.forEach((p, i) => tr.ingest(fixAt(i * 30, p)));           // 500 m observed
  const snap = tr.snapshot();
  const tr2 = M.createMilesTracker();
  tr2.begin('s1', snap);                                          // relaunch (joinZero set)
  const r = tr2.ingest(fixAt(3600, pts[5]));                      // first fix 1 h later, same spot chain continues below
  ok(r.joined === true && NEAR(tr2, 500), '(b) relaunch without crumbs counts no join segment');
}

/* (c) crumbs observed while dead fold in fully */
{
  const tr = M.createMilesTracker();
  tr.begin('s1', null);
  const pts = drive([LAT, LNG], 100, 20, 60);                     // 2 km, one fix/crumb per minute
  for (let i = 0; i <= 5; i++) tr.ingest(fixAt(i * 60, pts[i]));  // live: first 500 m
  const snap = tr.snapshot();                                     // "app dies" at t=300
  const tr2 = M.createMilesTracker();
  tr2.begin('s1', snap);
  const crumbs = [];
  for (let i = 6; i <= 20; i++) crumbs.push(crumbAt(i * 60, pts[i])); // service kept recording
  const res = tr2.mergeCrumbs(crumbs);
  ok(res.gapJoins === 0, '(c) observed run bridges the join (no gap join)');
  ok(NEAR(tr2, 2000), '(c) background stretch counts in full: total 2.00 km (got ' + TOT(tr2) + ' m)');
  // live stream resumes from the last crumb: one more 100 m step counts 100 m, not the whole leg again
  tr2.ingest(fixAt(21 * 60, off(LAT, LNG, 2100, 0)));
  ok(NEAR(tr2, 2100), '(c) live fix after merge continues from the crumb anchor (got ' + TOT(tr2) + ' m)');
  // (e) idempotent: re-feeding the same run changes nothing
  const res2 = tr2.mergeCrumbs(crumbs);
  ok(res2.accepted === 0 && NEAR(tr2, 2100), '(e) re-feeding the same crumbs is a no-op');
}

/* (d) TRUE gap: crumbs resume > OBS_GAP_MAX after the anchor, 5 km away */
{
  const tr = M.createMilesTracker();
  tr.begin('s1', null);
  const pts = drive([LAT, LNG], 100, 5, 60);
  pts.forEach((p, i) => tr.ingest(fixAt(i * 60, p)));             // 500 m, anchor at t=300
  const snap = tr.snapshot();
  const tr2 = M.createMilesTracker();
  tr2.begin('s1', snap);
  const gapSec = (M.OBS_GAP_MAX_MS / 1000) + 1800;                // silence: OBS max + 30 min
  const far = drive(off(LAT, LNG, 5000, 0), 100, 10, 60);         // observed run 5 km east
  const crumbs = far.map((p, i) => crumbAt(300 + gapSec + i * 60, p));
  const res = tr2.mergeCrumbs(crumbs);
  ok(res.gapJoins === 1, '(d) unobserved join is reported as a gap join, not counted');
  ok(NEAR(tr2, 1500), '(d) total = 0.5 km live + 1.0 km observed run, gap NOT counted (got ' + TOT(tr2) + ' m)');
}

/* (e) overlap dedupe: same stretch via stream and crumbs counts once */
{
  const tr = M.createMilesTracker();
  tr.begin('s1', null);
  const pts = drive([LAT, LNG], 100, 10, 60);
  pts.forEach((p, i) => tr.ingest(fixAt(i * 60, p)));             // all 1 km live
  const crumbs = pts.map((p, i) => crumbAt(i * 60, p));           // same points as crumbs
  const res = tr.mergeCrumbs(crumbs);
  ok(res.accepted === 0 && NEAR(tr, 1000), '(e) crumbs duplicating the live stream add nothing (got ' + TOT(tr) + ' m)');
}

/* (f) out-of-order crumbs */
{
  const mk = function () {
    const tr = M.createMilesTracker();
    tr.begin('s1', null);
    const pts = drive([LAT, LNG], 100, 5, 60);
    pts.forEach((p, i) => tr.ingest(fixAt(i * 60, p)));
    return { tr: M.createMilesTracker(), snap: tr.snapshot(), pts: pts };
  };
  const a = mk(); a.tr.begin('s1', a.snap);
  const ordered = [];
  for (let i = 6; i <= 15; i++) ordered.push(crumbAt(i * 60, off(LAT, LNG, 100 * i, 0)));
  a.tr.mergeCrumbs(ordered);
  const b = mk(); b.tr.begin('s1', b.snap);
  b.tr.mergeCrumbs(ordered.slice().reverse());
  ok(TOT(a.tr) === TOT(b.tr) && NEAR(a.tr, 1500),
    '(f) shuffled crumbs merge identically to ordered ones (got ' + TOT(b.tr) + ' m)');
}

/* (g) bad crumbs dropped, unknown accuracy accepted */
{
  const tr = M.createMilesTracker();
  tr.begin('s1', null);
  tr.ingest(fixAt(0, [LAT, LNG]));
  const res = tr.mergeCrumbs([
    crumbAt(60, off(LAT, LNG, 100, 0), 250),        // accuracy 250 m: drop
    crumbAt(120, off(LAT, LNG, 200, 0), -1),        // unknown accuracy: accept (100 m counted from anchor)
    { t: 'junk', a: LAT, o: LNG, c: 8 },            // corrupt: drop
    { t: T0 + 180000, a: NaN, o: LNG, c: 8 }        // corrupt: drop
  ]);
  ok(TOT(tr) === 200, '(g) only the valid unknown-accuracy crumb counts (got ' + TOT(tr) + ' m)');
  ok(res.skipped >= 2, '(g) corrupt crumbs are counted as skipped');
}

/* (h) inactive engine ignores crumbs */
{
  const tr = M.createMilesTracker();
  const res = tr.mergeCrumbs([crumbAt(0, [LAT, LNG]), crumbAt(60, off(LAT, LNG, 100, 0))]);
  ok(res.accepted === 0 && tr.totalM() === 0, '(h) crumbs before begin() change nothing');
}

/* (h2) v69: snapshot -> begin restores the total exactly — the
   primitive both the plain relaunch restore and the glue's orphan
   adoption (Oct 14 force-close bug) stand on */
{
  const tr = M.createMilesTracker();
  tr.begin('s1', null);
  const pts = drive([LAT, LNG], 100, 7, 30);
  pts.forEach((p, i) => tr.ingest(fixAt(i * 30, p)));
  const snap = tr.snapshot();
  const tr2 = M.createMilesTracker();
  tr2.begin('s1', snap);
  ok(TOT(tr2) === TOT(tr) && tr2.crumbs().length === tr.crumbs().length,
    '(h2) snapshot round-trip restores total + crumbs exactly');
}

console.log('geoloads engine: background cycle via crumbs');

/* (i) full load->dump cycle completed "while dead" counts once */
{
  const load = { lat: LAT, lng: LNG };
  const dumpLL = off(LAT, LNG, 3000, 0);
  const dump = { lat: dumpLL[0], lng: dumpLL[1] };
  const c = G.createGeoLoadCounter({ load: load, dump: dump });
  c.begin('g1', null);
  // Dwell at load site for 60 s (crumbs every 20 s), drive 3 km, dwell at dump 60 s.
  const feed = function (tSec, ll) {
    return c.ingest({ latitude: ll[0], longitude: ll[1], accuracy: 8, time: T0 + tSec * 1000 });
  };
  [0, 20, 40, 60].forEach(t => feed(t, [LAT, LNG]));
  ok(c.phase() === 'at-load', '(i) load-site dwell from crumbs arms the counter');
  feed(300, off(LAT, LNG, 1500, 0));
  [600, 620, 640, 660].forEach(t => feed(t, dumpLL));
  ok(c.count() === 1, '(i) background load->dump cycle counts exactly 1 load');
  // Re-feeding the same crumbs (already seen) must not double-count.
  [0, 20, 40, 60].forEach(t => feed(t, [LAT, LNG]));
  [600, 620, 640, 660].forEach(t => feed(t, dumpLL));
  ok(c.count() === 1, '(i) replayed/stale crumbs never double-count');
}

console.log('glue: static checks');
{
  const st = fs.readFileSync(path.join(ROOT, 'js', 'shifttrack.js'), 'utf8');
  ok(/Capacitor\.Plugins\.ShiftTrack/.test(st) && /typeof p\.start === 'function'/.test(st),
    '(j) shifttrack.js feature-detects the ShiftTrack plugin');
  ok(!/[^.]alert\(/.test(st), '(j) shifttrack.js adds no alert()');
  ok(/mergeNativeCrumbs/.test(st) && /ingestNativeCrumbs/.test(st) && /\.ack\(/.test(st),
    '(j) drain folds into both engines and acks');
  const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  ok((app.match(/ShiftTrack\.sessionStarted/g) || []).length === 2, '(j) app.js starts native tracking on manual + auto session start');
  ok(/ShiftTrack\.sessionStopped/.test(app) && /ShiftTrack\.syncOnBoot/.test(app) && /ShiftTrack\.drainNow/.test(app),
    '(j) app.js wires stop / boot-sync / end-sheet drain');
  ok(/var APK_VERSION = 38/.test(app), '(j) APK_VERSION bumped to 38 (v38 release, Oct 22 2026)');
  const miles = fs.readFileSync(path.join(ROOT, 'js', 'miles.js'), 'utf8');
  ok(/mergeNativeCrumbs: function/.test(miles) && /recordKmFor: function/.test(miles),
    '(j) LiveMiles exposes the native merge + record lookup');
  const gl = fs.readFileSync(path.join(ROOT, 'js', 'geoloads.js'), 'utf8');
  ok(/ingestNativeCrumbs: function/.test(gl), '(j) GeoLoads exposes the native crumb path');
  const pref = fs.readFileSync(path.join(ROOT, 'modules', 'preferences.js'), 'utf8');
  /* v107 PIN MOVE (Stage 6, owner: Advanced shows no skeleton):
     the background-tracking STATUS BLOCK left Preferences
     entirely. The actionable surface that remains is the tracker
     ask banner (trkBgAsk, pinned just below) plus the native
     machinery itself, which the rest of this section pins. */
  ok(!/pf_bgtrack|pf_bgallow|pf_bgbatt/.test(pref),
    '(j) v107: Preferences no longer carries the background-tracking status block (removed per the Advanced slimming spec)');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok(parseInt((html.match(/js\/shifttrack\.js\?v=(\d+)/) || [])[1] || '0', 10) >= 69 && /id="trkBgAsk"/.test(html),
    '(j) index.html loads shifttrack.js and hosts the ask banner');
  ok(parseInt((html.match(/js\/miles\.js\?v=(\d+)/) || [])[1] || '0', 10) >= 69,
    '(j) index.html loads the v69 miles glue');
  ok(app.includes('function trackerSessionKeyMs()') && app.includes('sessionId = trackerSessionStartMs()') &&
     (app.match(/LiveMiles\.startDay\('s' \+ trackerSessionKeyMs\(\)/g) || []).length === 3,
    '(j) v69: app.js pins the session record key and all start paths use it');
  const mjs = fs.readFileSync(path.join(ROOT, 'js', 'miles.js'), 'utf8');
  ok(/dayKey: function/.test(mjs) && /adoptableFragments/.test(mjs),
    '(j) v69: LiveMiles exposes dayKey() and the orphan adoption');
  ok(/LiveMiles\.dayKey/.test(st), '(j) v69: the drain ack gate consults LiveMiles.dayKey()');
}

console.log('shifttrack glue: the v69 ack gate (real js/shifttrack.js, fake plugin)');

/* (k) A drain must never ack crumbs the live engine is not yet
   there to fold (the old ack-before-fold hole): while LiveMiles
   has no day begun, the drain leaves the crumbs in the native
   file; once the engine is up, the next drain folds them and only
   then acks, up to the newest crumb folded. */
const glueSection = (async function () {
  const stSrc = fs.readFileSync(path.join(ROOT, 'js', 'shifttrack.js'), 'utf8');
  const KEY = 's' + T0;
  let pluginCrumbs = [
    { t: T0 + 60000, a: LAT, o: LNG, c: 8 },
    { t: T0 + 120000, a: LAT + 0.01, o: LNG, c: 8 }
  ];
  const acked = [];
  const fakePlugin = {
    start: function () { return Promise.resolve({}); },
    stop: function () { return Promise.resolve({}); },
    status: function () {
      return Promise.resolve({ sessionActive: true, sessionKey: KEY, fineLocation: true, backgroundLocation: true });
    },
    readCrumbs: function () { return Promise.resolve({ crumbs: pluginCrumbs.slice(), more: false }); },
    ack: function (o) {
      acked.push(o);
      pluginCrumbs = pluginCrumbs.filter(function (c) { return c.t > o.upTo; });
      return Promise.resolve({});
    },
    requestBackground: function () { return Promise.resolve({}); },
    openAppSettings: function () {},
    openBatterySettings: function () {}
  };
  const liveState = { key: null, merged: [] };
  const storeData = {};
  const sb = {
    console: console, Promise: Promise, setInterval: setInterval, clearInterval: clearInterval,
    JSON: JSON, Math: Math, Date: Date,
    document: {
      addEventListener: function () {},
      getElementById: function () { return null; },
      visibilityState: 'visible'
    },
    Capacitor: { Plugins: { ShiftTrack: fakePlugin } },
    App: {
      _store: {
        get: function (k, d) { return storeData[k] === undefined ? d : storeData[k]; },
        set: function (k, v) { storeData[k] = v; }
      },
      tracker: { status: 'running' }
    },
    LiveMiles: {
      dayKey: function () { return liveState.key; },
      mergeNativeCrumbs: function (c) { liveState.merged.push(c); return { accepted: c.length, addedM: 0 }; },
      _engine: null,
      recordKmFor: function () { return null; },
      reconcileSession: function () { return false; }
    },
    GeoLoads: { ingestNativeCrumbs: function () {} }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(stSrc, sb);
  const ST = sb.ShiftTrack;
  ok(!!ST && typeof ST.syncOnBoot === 'function' && typeof ST.drainNow === 'function',
    '(k) shifttrack glue loads against the fake plugin');

  async function settle() { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); }

  ST.syncOnBoot();           // boot reconcile -> drain with the engine NOT yet begun
  await settle();
  ok(acked.length === 0 && pluginCrumbs.length === 2,
    '(k) no ack while LiveMiles has no day begun — crumbs stay in the native file');

  liveState.key = KEY;       // the boot-time startDay lands; engine is up
  ST.drainNow();
  await settle();
  ok(liveState.merged.length === 1 && liveState.merged[0].length === 2,
    '(k) once begun, the next drain folds the retained crumbs');
  ok(acked.length === 1 && acked[0].upTo === T0 + 120000 && pluginCrumbs.length === 0,
    '(k) the ack follows the fold, up to the newest crumb folded');
})();

glueSection.then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  console.log('  NOT OK - (k) glue section error: ' + (e && e.stack || e));
  console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed');
  process.exit(1);
});
