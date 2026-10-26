#!/usr/bin/env node
/* Meticulous — LOAD-COUNT-DEAD (owner, Mon Oct 26, 2026 10:30 MDT):
 * "That gps load tracking is not working at all now!" — the automatic
 * GPS load counter counted NOTHING all morning on an ACTIVE Aecon
 * dispatch day, cycling at a same-place load/dump site since ~08:00.
 *
 * This suite drives the REAL js/geoloads.js glue (store + LiveMiles
 * subscription rig, same pattern as tools/loads-gps-fix-v203-test.js)
 * through the states today could actually be in, and pins which of
 * them yield ZERO counts forever:
 *
 *   S1 baseline: no-pin dispatch, two DISTINCT sites (the Oct 21/22
 *      shape that counted) — must count.
 *   S2 same-place sub-spots 120 m apart, clean fixes — the intra-site
 *      pattern path — must count.
 *   S3 same-place, realistic accuracy wobble (every 2nd fix 45 m) —
 *      the intra cluster's starvation test.
 *   S3b same-place, milder wobble (every 4th fix 45 m).
 *   S4 BREAK-A candidate: session started BEFORE the dispatch became
 *      active (configure found no dispatch: no counter, no learner);
 *      the dispatch lands mid-session — counting must arm WITHOUT a
 *      session restart.
 *   S5 BREAK-B candidate: dispatch carries a LOAD PIN ONLY, job is
 *      same-place — teach mode's learner needs a >=300 m candidate.
 *   S6 both pins at the same place ('sites-too-close' -> seeded
 *      pattern learner) — must count like S2.
 *   S7 BREAK-H candidate: an en-route fuel stop (3 min dwell) before
 *      the pit on a no-pin day — the pattern learner's anchor lands
 *      on the fuel stop; the pit becomes the candidate; cycles never
 *      "close" at the anchor and intra is suppressed while a
 *      candidate exists.
 *   S8 phantom/relaunch: session keyed YESTERDAY (started Oct 25
 *      11:32 with no dispatch), page relaunch this morning with the
 *      dispatch now active — the day-roll must re-arm for today.
 *   S9 state fact: no session at all (GeoLoads.startDay never
 *      called — the day watch arms LiveMiles only) — fixes exist
 *      but GeoLoads is not watching: armed=false, count=0.
 *
 * Run: node tools/load-count-dead-v267-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'geoloads.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

/* A store whose backing data can be SHARED across worlds (relaunch). */
function mkSharedStore(data) {
  data = data || {};
  return {
    get: function (k, dflt) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : dflt; },
    set: function (k, v) { data[k] = JSON.parse(JSON.stringify(v)); },
    del: function (k) { delete data[k]; },
    _data: data
  };
}
function mkWorld(store) {
  const sb = { console: console, Date: Date, Math: Math, JSON: JSON };
  sb.window = sb;
  let handler = null;
  sb.LiveMiles = {
    available: function () { return true; },
    subscribe: function (fn) { handler = fn; }
  };
  sb.App = { _store: store };
  vm.createContext(sb);
  vm.runInContext(src, sb);
  if (!sb.GeoLoads) throw new Error('GeoLoads not exposed');
  return { GeoLoads: sb.GeoLoads, feed: function (fix) { return handler(fix); } };
}

const NOW = new Date();
const T0 = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 6, 0, 0).getTime(); // today 06:00
const Y0 = T0 - 86400000 + (11 * 3600 + 32 * 60) * 1000; // yesterday 11:32 (the phantom session's start)
function dstr(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const TODAY = dstr(T0);
function off(lat, lng, eM, nM) {
  return [lat + nM / 111320, lng + eM / (111320 * Math.cos(lat * Math.PI / 180))];
}
const STILL = [[0, 0], [15, 10], [-12, 8], [10, -14], [-8, -10]];

/* Fix stream with a per-scenario accuracy policy. */
function mkFeed(world, accFn) {
  let n = 0;
  return function (tS, ll) {
    const acc = accFn ? accFn(n++) : 8;
    return world.feed({ latitude: ll[0], longitude: ll[1], accuracy: acc, time: T0 + tS * 1000 });
  };
}
function park(feed, clock, center, durS) {
  const steps = Math.floor(durS / 10);
  for (let k = 0; k <= steps; k++) {
    const w = STILL[k % STILL.length];
    feed(clock.t, off(center.lat, center.lng, w[0], w[1]));
    clock.t += 10;
  }
}
function drive(feed, clock, A, B, durS) {
  const steps = Math.floor(durS / 10);
  for (let k = 1; k <= steps; k++) {
    const f = k / steps;
    feed(clock.t, [A.lat + (B.lat - A.lat) * f, A.lng + (B.lng - A.lng) * f]);
    clock.t += 10;
  }
}
/* One load->dump cycle at a same-place site: load dwell at A,
   short hop, tip dwell at B, hop back. */
function cycleSamePlace(feed, clock, A, B) {
  park(feed, clock, A, 240);
  drive(feed, clock, A, B, 60);
  park(feed, clock, B, 180);
  drive(feed, clock, B, A, 60);
}

const HOME = { lat: 51.15709, lng: -113.93862 };
/* Today's ground: the SE Calgary site area (his pings ~50.968,-114.034). */
const SITE_A = { lat: 50.9685, lng: -114.0335 };                    // load spot
const SITE_B = { lat: SITE_A.lat, lng: SITE_A.lng + 120 / (111320 * Math.cos(SITE_A.lat * Math.PI / 180)) }; // tip spot, 120 m east
const PIT_FAR = { lat: 50.9850, lng: -114.0520 };                   // distinct-sites day (S1)
const DUMP_FAR = { lat: 50.9505, lng: -114.0145 };
const FUEL = { lat: 51.0200, lng: -113.9900 };                      // en-route stop (S7)

const DSP_NOPIN = { id: 'dsp-today', jobSite: 'Aecon Inf', dropoff: '', status: 'active', date: TODAY, scheduledAt: TODAY + 'T08:00:00' };
function baseData(dsp) {
  const d = {
    nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] },
    dsp_list: dsp ? [dsp] : []
  };
  if (dsp) d.dsp_active = dsp;
  return d;
}
function dayCount(world) {
  const t = world.GeoLoads.today();
  return { count: t.count, armed: t.armed, blocked: t.blocked };
}

/* ---------------- S1: baseline distinct sites ---------------- */
console.log('S1 — no-pin dispatch, two distinct sites (the shape that counted Oct 21/22)');
{
  const store = mkSharedStore(baseData(DSP_NOPIN));
  const world = mkWorld(store);
  const feed = mkFeed(world, null);
  const clock = { t: 0 };
  world.GeoLoads.startDay('s' + T0, {});
  for (let c = 0; c < 3; c++) {
    park(feed, clock, PIT_FAR, 240);
    drive(feed, clock, PIT_FAR, DUMP_FAR, 300);
    park(feed, clock, DUMP_FAR, 300);
    drive(feed, clock, DUMP_FAR, PIT_FAR, 300);
  }
  const r = dayCount(world);
  ok(r.count >= 3, 'S1 counts build (>=3 after 3 cycles)', JSON.stringify(r));
}

/* ---------------- S2: same-place, clean fixes ---------------- */
console.log('S2 — no-pin dispatch, same-place sub-spots 120 m apart, clean accuracy');
{
  const store = mkSharedStore(baseData(DSP_NOPIN));
  const world = mkWorld(store);
  const feed = mkFeed(world, null);
  const clock = { t: 0 };
  world.GeoLoads.startDay('s' + T0, {});
  for (let c = 0; c < 3; c++) cycleSamePlace(feed, clock, SITE_A, SITE_B);
  const r = dayCount(world);
  ok(r.count >= 2, 'S2 counts build via the intra-site path (>=2 after 3 cycles)', JSON.stringify(r));
}

/* ---------------- S3: same-place, accuracy wobble ---------------- */
console.log('S3 — same-place, every 2nd fix at 45 m accuracy (intra starvation test)');
{
  const store = mkSharedStore(baseData(DSP_NOPIN));
  const world = mkWorld(store);
  const feed = mkFeed(world, function (n) { return (n % 2 === 0) ? 8 : 45; });
  const clock = { t: 0 };
  world.GeoLoads.startDay('s' + T0, {});
  for (let c = 0; c < 3; c++) cycleSamePlace(feed, clock, SITE_A, SITE_B);
  const r = dayCount(world);
  ok(r.count >= 2, 'S3 counts still build under accuracy wobble (>=2)', JSON.stringify(r));
}
console.log('S3b — same-place, every 4th fix at 45 m accuracy');
{
  const store = mkSharedStore(baseData(DSP_NOPIN));
  const world = mkWorld(store);
  const feed = mkFeed(world, function (n) { return (n % 4 === 3) ? 45 : 10; });
  const clock = { t: 0 };
  world.GeoLoads.startDay('s' + T0, {});
  for (let c = 0; c < 3; c++) cycleSamePlace(feed, clock, SITE_A, SITE_B);
  const r = dayCount(world);
  ok(r.count >= 2, 'S3b counts still build under mild wobble (>=2)', JSON.stringify(r));
}

/* ---------------- S4: dispatch lands mid-session ---------------- */
console.log('S4 — session started with NO active dispatch; dispatch lands mid-session');
{
  const data = baseData(null); // no dsp_active, empty dsp_list
  const store = mkSharedStore(data);
  const world = mkWorld(store);
  const feed = mkFeed(world, null);
  const clock = { t: 0 };
  world.GeoLoads.startDay('s' + T0, {});
  // one full cycle with nothing armed (he is already cycling)
  cycleSamePlace(feed, clock, SITE_A, SITE_B);
  // the dispatch becomes active mid-session (Connect landing / yard flip / his tap)
  data.dsp_active = JSON.parse(JSON.stringify(DSP_NOPIN));
  data.dsp_list = [JSON.parse(JSON.stringify(DSP_NOPIN))];
  for (let c = 0; c < 3; c++) cycleSamePlace(feed, clock, SITE_A, SITE_B);
  const r = dayCount(world);
  ok(r.armed || r.count > 0, 'S4 counting arms after the dispatch lands (no session restart)', JSON.stringify(r));
  ok(r.count >= 2, 'S4 counts build after the dispatch lands (>=2)', JSON.stringify(r));
}

/* ---------------- S5: load pin only, same-place ---------------- */
console.log('S5 — dispatch with a LOAD PIN ONLY, same-place job (teach mode)');
{
  const dsp = JSON.parse(JSON.stringify(DSP_NOPIN));
  dsp.lat = SITE_A.lat; dsp.lng = SITE_A.lng;
  const store = mkSharedStore(baseData(dsp));
  const world = mkWorld(store);
  const feed = mkFeed(world, null);
  const clock = { t: 0 };
  world.GeoLoads.startDay('s' + T0, {});
  for (let c = 0; c < 3; c++) cycleSamePlace(feed, clock, SITE_A, SITE_B);
  const r = dayCount(world);
  ok(r.count >= 2, 'S5 counts build on a one-pin same-place day (>=2)', JSON.stringify(r));
}

/* ---------------- S6: both pins, same place ---------------- */
console.log('S6 — dispatch pins load AND dump at the same place (sites-too-close)');
{
  const dsp = JSON.parse(JSON.stringify(DSP_NOPIN));
  dsp.lat = SITE_A.lat; dsp.lng = SITE_A.lng;
  dsp.dumpLat = SITE_A.lat; dsp.dumpLng = SITE_A.lng;
  const store = mkSharedStore(baseData(dsp));
  const world = mkWorld(store);
  const feed = mkFeed(world, null);
  const clock = { t: 0 };
  world.GeoLoads.startDay('s' + T0, {});
  for (let c = 0; c < 3; c++) cycleSamePlace(feed, clock, SITE_A, SITE_B);
  const r = dayCount(world);
  ok(r.count >= 2, 'S6 counts build on a too-close-pins day (>=2)', JSON.stringify(r));
}

/* ---------------- S7: en-route fuel stop poisons the anchor ---------------- */
console.log('S7 — no-pin day, 3-min fuel stop BEFORE the pit, then same-place cycles');
{
  const store = mkSharedStore(baseData(DSP_NOPIN));
  const world = mkWorld(store);
  const feed = mkFeed(world, null);
  const clock = { t: 0 };
  world.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, FUEL, 180);                    // the en-route stop: first "work dwell"
  drive(feed, clock, FUEL, SITE_A, 600);
  for (let c = 0; c < 5; c++) cycleSamePlace(feed, clock, SITE_A, SITE_B);
  const r = dayCount(world);
  ok(r.count >= 2, 'S7 counts build despite the en-route stop (>=2)', JSON.stringify(r));
}

/* ---------------- S8: phantom session + relaunch ---------------- */
console.log('S8 — session keyed YESTERDAY (no dispatch then); relaunch today, dispatch active');
{
  const data = baseData(null);
  const store = mkSharedStore(data);
  // Page life 1: yesterday — the session starts with no dispatch anywhere.
  const w1 = mkWorld(store);
  const feed1 = mkFeed(w1, null);
  const clock1 = { t: -86400 + (11 * 3600 + 32 * 60) - 21600 }; // yesterday ~11:32 in T0-relative seconds
  w1.GeoLoads.startDay('s' + Y0, {});
  park(feed1, clock1, HOME, 300); // test-session puttering at home
  // Overnight: the dispatch for today lands and is active.
  data.dsp_active = JSON.parse(JSON.stringify(DSP_NOPIN));
  data.dsp_list = [JSON.parse(JSON.stringify(DSP_NOPIN))];
  // Page life 2: this morning's relaunch — SAME store, SAME session key.
  const w2 = mkWorld(store);
  const feed2 = mkFeed(w2, null);
  const clock2 = { t: 5400 }; // ~07:30
  w2.GeoLoads.startDay('s' + Y0, { resume: true });
  for (let c = 0; c < 3; c++) cycleSamePlace(feed2, clock2, SITE_A, SITE_B);
  const r = dayCount(w2);
  ok(r.count >= 2, 'S8 counting re-arms for today after the relaunch roll (>=2)', JSON.stringify(r));
}

/* ---------------- S9: no session at all ---------------- */
console.log('S9 — no session (tracker idle): GeoLoads never started, fixes exist upstream');
{
  const store = mkSharedStore(baseData(DSP_NOPIN));
  const world = mkWorld(store);
  const feed = mkFeed(world, null);
  const clock = { t: 0 };
  // NOTE: no GeoLoads.startDay — the day watch (App.armDayMiles)
  // arms LiveMiles only; GeoLoads has no day-watch arming path.
  for (let c = 0; c < 2; c++) cycleSamePlace(feed, clock, SITE_A, SITE_B);
  const r = dayCount(world);
  ok(r.count === 0 && !r.armed, 'S9 documents the session binding: no session -> no counting (armed=false, count=0)', JSON.stringify(r));
}

/* ---------------- S10: pattern day, relaunch must not lose counts ---------------- */
console.log('S10 — pattern day counts, then a same-session relaunch (OTA-style) mid-day');
{
  const store = mkSharedStore(baseData(DSP_NOPIN));
  const w1 = mkWorld(store);
  const feed1 = mkFeed(w1, null);
  const clock1 = { t: 0 };
  w1.GeoLoads.startDay('s' + T0, {});
  for (let c = 0; c < 3; c++) cycleSamePlace(feed1, clock1, SITE_A, SITE_B);
  const before = dayCount(w1);
  ok(before.count >= 2, 'S10 pre-relaunch counts exist (>=2)', JSON.stringify(before));
  // relaunch: fresh page life, same store, same session key
  const w2 = mkWorld(store);
  w2.GeoLoads.startDay('s' + T0, { resume: true });
  const after = dayCount(w2);
  ok(after.count >= before.count, 'S10 counts survive the relaunch (no drop)', 'before ' + before.count + ', after ' + after.count);
  const feed2 = mkFeed(w2, null);
  const clock2 = { t: clock1.t };
  cycleSamePlace(feed2, clock2, SITE_A, SITE_B);
  const later = dayCount(w2);
  ok(later.count > after.count, 'S10 counting continues after the relaunch', JSON.stringify(later));
}

/* ---------------- S11: one-pin shadow-armed day, relaunch ---------------- */
console.log('S11 — one-pin same-place day (shadow-armed), then a relaunch');
{
  const dsp = JSON.parse(JSON.stringify(DSP_NOPIN));
  dsp.lat = SITE_A.lat; dsp.lng = SITE_A.lng;
  const store = mkSharedStore(baseData(dsp));
  const w1 = mkWorld(store);
  const feed1 = mkFeed(w1, null);
  const clock1 = { t: 0 };
  w1.GeoLoads.startDay('s' + T0, {});
  for (let c = 0; c < 3; c++) cycleSamePlace(feed1, clock1, SITE_A, SITE_B);
  const before = dayCount(w1);
  ok(before.count >= 2, 'S11 pre-relaunch counts exist (>=2)', JSON.stringify(before));
  const w2 = mkWorld(store);
  w2.GeoLoads.startDay('s' + T0, { resume: true });
  const after = dayCount(w2);
  ok(after.count >= before.count, 'S11 counts survive the relaunch (no drop)', 'before ' + before.count + ', after ' + after.count);
  const feed2 = mkFeed(w2, null);
  const clock2 = { t: clock1.t };
  cycleSamePlace(feed2, clock2, SITE_A, SITE_B);
  const later = dayCount(w2);
  ok(later.count > before.count, 'S11 counting continues after the relaunch, no double credit', JSON.stringify(later));
}

/* ---------------- S12: crumb drain while disarmed ---------------- */
console.log('S12 — native crumbs drain while GeoLoads is disarmed (dispatch landed while app dead)');
{
  const data = baseData(null);
  const store = mkSharedStore(data);
  const world = mkWorld(store);
  world.GeoLoads.startDay('s' + T0, {}); // disarmed: no dispatch at configure time
  // the dispatch lands while the app is dead; the native service
  // kept recording the morning's cycles as breadcrumbs
  data.dsp_active = JSON.parse(JSON.stringify(DSP_NOPIN));
  data.dsp_list = [JSON.parse(JSON.stringify(DSP_NOPIN))];
  const crumbs = [];
  const clock = { t: 0 };
  const push = function (tS, ll) { crumbs.push({ t: T0 + tS * 1000, a: ll[0], o: ll[1], c: 8 }); };
  for (let c = 0; c < 3; c++) {
    // one cycle's crumbs, 30 s cadence (the native throttle)
    const steps = [[SITE_A, 240], [SITE_B, 180]];
    park(push, clock, SITE_A, 240);
    drive(push, clock, SITE_A, SITE_B, 60);
    park(push, clock, SITE_B, 180);
    drive(push, clock, SITE_B, SITE_A, 60);
    void steps;
  }
  const n = world.GeoLoads.ingestNativeCrumbs(crumbs);
  const r = dayCount(world);
  ok(n > 0, 'S12 crumbs accepted after the pre-drain world check (n>0)', 'n=' + n);
  ok(r.count >= 2, 'S12 the drained cycles count (>=2)', JSON.stringify(r));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
