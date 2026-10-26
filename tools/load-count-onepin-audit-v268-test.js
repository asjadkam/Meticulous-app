#!/usr/bin/env node
/* Meticulous — LOAD-COUNT-ONEPIN-AUDIT (defect round 3, owner,
 * Mon Oct 26, 2026 ~12:49 MDT): he is ON v267 (Advanced read
 * "You are up to date (web v267)"), his session is RUNNING, and he
 * dumped 4 loads after the v267 restart with ZERO automatic reads.
 * Cloud read (web UI, 12:48-12:51): Loads 7, ALL manual (+1 taps);
 * dispatch "Aecon Inf" Active; Navigator recents "Simply Stone"
 * x2 today; GPS ~50.969,-114.034 most of the day with excursions
 * to ~50.983,-114.040 (~1.5 km). The v267 fixes are in — so which
 * dispatch SHAPES can never produce a count no matter how many
 * cycles he drives?
 *
 * This suite drives the REAL js/geoloads.js glue (same rig as
 * tools/load-count-dead-v267-test.js) through HIS geometry:
 *   S_END 50.969,-114.034  (the end he sat at most of the day)
 *   N_END 50.983,-114.040  (~1.5 km away — the other end)
 *   MID   ~50.976,-114.037 (a mid-leg stop: scale / queue / coffee)
 *   A/B   same-place sub-spots 120 m apart at S_END
 *
 *   A1  no-pin, two-site clean               -> must COUNT
 *   A2  no-pin, two-site, 75 s tip dwells    -> ZERO: the tip place
 *        never confirms (wall: the 2-minute place dwell — a
 *        threshold decision, asserted as the documented wall)
 *   A3  no-pin, two-site, mid-leg stop on leg 1 -> ZERO forever +
 *        'ambiguous-dump' (wall: contest permanence, pinned spec)
 *   A4  load-pin only, two-site clean        -> must COUNT (teach)
 *   A5  load-pin only + mid-leg stop leg 1   -> ZERO forever +
 *        'ambiguous-dump' (wall: contest permanence, teach flavor)
 *   A6  DUMP-PIN ONLY, two-site              -> the audit's code
 *        gap: NO learner ever runs ('one-site' is written and
 *        the day is blind). POST-FIX: must COUNT (seeded pattern).
 *   A7  both pins too-close + two-site driving -> must COUNT
 *   A8  load-pin only, same-place            -> must COUNT (shadow)
 *   A9  no-pin, same-place                   -> must COUNT (intra)
 *   A10 DUMP-PIN ONLY, same-place            -> POST-FIX must
 *        COUNT (seeded pattern, intra proof around the seed)
 *   A11 pin at the FAR end (teach, labels swapped) -> must COUNT
 *   A12 readout: GeoLoads.status() exposes the live learner state
 *        (mode, anchor, candidate, cycles, dwell, last accuracy)
 *
 * Run: node tools/load-count-onepin-audit-v268-test.js
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

function mkSharedStore(data) {
  data = data || {};
  return {
    get: function (k, dflt) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : dflt; },
    set: function (k, v) { data[k] = JSON.parse(JSON.stringify(v)); },
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
const T0 = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 6, 0, 0).getTime();
function dstr(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const TODAY = dstr(T0);
function off(lat, lng, eM, nM) {
  return [lat + nM / 111320, lng + eM / (111320 * Math.cos(lat * Math.PI / 180))];
}
const STILL = [[0, 0], [15, 10], [-12, 8], [10, -14], [-8, -10]];

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
/* One full two-site cycle: load dwell at L, haul, tip dwell at D, return. */
function cycle2(feed, clock, L, D, tipS) {
  park(feed, clock, L, 240);
  drive(feed, clock, L, D, 300);
  park(feed, clock, D, tipS || 240);
  drive(feed, clock, D, L, 300);
}
function cycleSamePlace(feed, clock, A, B) {
  park(feed, clock, A, 240);
  drive(feed, clock, A, B, 60);
  park(feed, clock, B, 180);
  drive(feed, clock, B, A, 60);
}

const HOME = { lat: 51.15709, lng: -113.93862 };
const S_END = { lat: 50.969, lng: -114.034 };
const N_END = { lat: 50.983, lng: -114.040 };
const MID = { lat: 50.976, lng: -114.037 };
const A_SP = { lat: 50.969, lng: -114.034 };
const B_SP = { lat: A_SP.lat, lng: A_SP.lng + 120 / (111320 * Math.cos(A_SP.lat * Math.PI / 180)) };

const DSP_NOPIN = { id: 'dsp-aecon', jobSite: 'Aecon Inf', dropoff: '', status: 'active', date: TODAY, scheduledAt: TODAY + 'T08:00:00' };
function baseData(dsp) {
  const d = {
    nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] },
    dsp_list: dsp ? [dsp] : []
  };
  if (dsp) d.dsp_active = dsp;
  return d;
}
function day(world) {
  const t = world.GeoLoads.today();
  const rec = world.GeoLoads.forDate(TODAY);
  return { count: t.count, armed: t.armed, blocked: t.blocked, recBlocked: rec ? rec.blocked : undefined };
}

/* ---------------- A1: no-pin two-site clean ---------------- */
console.log('A1 — no-pin dispatch, two-site cycles (his ends, 1.5 km apart)');
{
  const store = mkSharedStore(baseData(DSP_NOPIN));
  const w = mkWorld(store);
  const feed = mkFeed(w, null);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  for (let c = 0; c < 4; c++) cycle2(feed, clock, S_END, N_END);
  const r = day(w);
  ok(r.count >= 3, 'A1 counts build (>=3 after 4 cycles)', JSON.stringify(r));
}

/* ---------------- A2: no-pin, 75 s tip dwells ---------------- */
console.log('A2 — no-pin, two-site, QUICK tips (75 s tip dwell — a real raise/dump/lower)');
{
  const store = mkSharedStore(baseData(DSP_NOPIN));
  const w = mkWorld(store);
  const feed = mkFeed(w, null);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  for (let c = 0; c < 4; c++) cycle2(feed, clock, S_END, N_END, 75);
  const r = day(w);
  ok(r.count === 0, 'A2 WALL (2-min place dwell): quick tips never confirm a place — zero', JSON.stringify(r));
}

/* ---------------- A3: no-pin + mid-leg stop on leg 1 ---------------- */
console.log('A3 — no-pin, two-site, 150 s mid-leg stop (queue/scale) on the FIRST loaded leg');
{
  const store = mkSharedStore(baseData(DSP_NOPIN));
  const w = mkWorld(store);
  const feed = mkFeed(w, null);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, S_END, 240);                    // anchor dwell
  drive(feed, clock, S_END, MID, 150);
  park(feed, clock, MID, 150);                      // the stop confirms as a place
  drive(feed, clock, MID, N_END, 150);
  park(feed, clock, N_END, 240);                    // the real tip = third place
  drive(feed, clock, N_END, S_END, 300);
  for (let c = 0; c < 3; c++) cycle2(feed, clock, S_END, N_END); // clean cycles after
  const r = day(w);
  ok(r.count === 0 && r.recBlocked === 'ambiguous-dump',
    'A3 WALL (contest permanence): one mid-leg stop before proof blocks the day forever', JSON.stringify(r));
}

/* ---------------- A4: load pin only, clean ---------------- */
console.log('A4 — load pin only (at S_END), two-site clean');
{
  const dsp = JSON.parse(JSON.stringify(DSP_NOPIN));
  dsp.lat = S_END.lat; dsp.lng = S_END.lng;
  const store = mkSharedStore(baseData(dsp));
  const w = mkWorld(store);
  const feed = mkFeed(w, null);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  for (let c = 0; c < 3; c++) {
    park(feed, clock, S_END, 70);
    drive(feed, clock, S_END, N_END, 300);
    park(feed, clock, N_END, 200);
    drive(feed, clock, N_END, S_END, 300);
  }
  const r = day(w);
  ok(r.count >= 2, 'A4 counts build via teaching (>=2)', JSON.stringify(r));
}

/* ---------------- A5: load pin only + mid-leg stop ---------------- */
console.log('A5 — load pin only, mid-leg stop on leg 1 teaches the stop; the real tip contests');
{
  const dsp = JSON.parse(JSON.stringify(DSP_NOPIN));
  dsp.lat = S_END.lat; dsp.lng = S_END.lng;
  const store = mkSharedStore(baseData(dsp));
  const w = mkWorld(store);
  const feed = mkFeed(w, null);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, S_END, 70);
  drive(feed, clock, S_END, MID, 150);
  park(feed, clock, MID, 200);                      // teaches MID
  drive(feed, clock, MID, N_END, 150);
  park(feed, clock, N_END, 200);                    // rival on the same leg -> contest
  drive(feed, clock, N_END, S_END, 300);
  for (let c = 0; c < 2; c++) {
    park(feed, clock, S_END, 70);
    drive(feed, clock, S_END, N_END, 300);
    park(feed, clock, N_END, 200);
    drive(feed, clock, N_END, S_END, 300);
  }
  const r = day(w);
  ok(r.count === 0 && r.recBlocked === 'ambiguous-dump',
    'A5 WALL (contest permanence, teach flavor): the day is retracted and unteachable', JSON.stringify(r));
}

/* ---------------- A6: DUMP PIN ONLY, two-site ---------------- */
console.log('A6 — dispatch carries ONLY a dump pin (N_END); load end unpinned');
{
  const dsp = JSON.parse(JSON.stringify(DSP_NOPIN));
  dsp.dumpLat = N_END.lat; dsp.dumpLng = N_END.lng;
  const store = mkSharedStore(baseData(dsp));
  const w = mkWorld(store);
  const feed = mkFeed(w, null);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  for (let c = 0; c < 4; c++) cycle2(feed, clock, S_END, N_END);
  const r = day(w);
  ok(r.count >= 3, 'A6 counts build on a dump-pin-only day (seeded pattern) (>=3)', JSON.stringify(r));
}

/* ---------------- A7: too-close pins + two-site driving ---------------- */
console.log('A7 — both pins at S_END (too close), but the truck runs two-site cycles');
{
  const dsp = JSON.parse(JSON.stringify(DSP_NOPIN));
  dsp.lat = S_END.lat; dsp.lng = S_END.lng;
  dsp.dumpLat = S_END.lat; dsp.dumpLng = S_END.lng;
  const store = mkSharedStore(baseData(dsp));
  const w = mkWorld(store);
  const feed = mkFeed(w, null);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  for (let c = 0; c < 4; c++) cycle2(feed, clock, S_END, N_END);
  const r = day(w);
  ok(r.count >= 3, 'A7 counts build via the seeded pattern learner (>=3)', JSON.stringify(r));
}

/* ---------------- A8: load pin only, same-place ---------------- */
console.log('A8 — load pin only, same-place sub-spots (shadow path)');
{
  const dsp = JSON.parse(JSON.stringify(DSP_NOPIN));
  dsp.lat = A_SP.lat; dsp.lng = A_SP.lng;
  const store = mkSharedStore(baseData(dsp));
  const w = mkWorld(store);
  const feed = mkFeed(w, null);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  for (let c = 0; c < 3; c++) cycleSamePlace(feed, clock, A_SP, B_SP);
  const r = day(w);
  ok(r.count >= 2, 'A8 counts build via the shadow intra pair (>=2)', JSON.stringify(r));
}

/* ---------------- A9: no-pin, same-place ---------------- */
console.log('A9 — no-pin, same-place sub-spots (pattern intra)');
{
  const store = mkSharedStore(baseData(DSP_NOPIN));
  const w = mkWorld(store);
  const feed = mkFeed(w, null);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  for (let c = 0; c < 3; c++) cycleSamePlace(feed, clock, A_SP, B_SP);
  const r = day(w);
  ok(r.count >= 2, 'A9 counts build via the intra-site path (>=2)', JSON.stringify(r));
}

/* ---------------- A10: DUMP PIN ONLY, same-place ---------------- */
console.log('A10 — dispatch carries ONLY a dump pin at A_SP; same-place cycling around it');
{
  const dsp = JSON.parse(JSON.stringify(DSP_NOPIN));
  dsp.dumpLat = A_SP.lat; dsp.dumpLng = A_SP.lng;
  const store = mkSharedStore(baseData(dsp));
  const w = mkWorld(store);
  const feed = mkFeed(w, null);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  for (let c = 0; c < 3; c++) cycleSamePlace(feed, clock, A_SP, B_SP);
  const r = day(w);
  ok(r.count >= 2, 'A10 counts build on a dump-pin-only same-place day (>=2)', JSON.stringify(r));
}

/* ---------------- A11: pin at the far end ---------------- */
console.log('A11 — load pin sits at N_END (the tip end); loads at S_END (direction honesty)');
{
  const dsp = JSON.parse(JSON.stringify(DSP_NOPIN));
  dsp.lat = N_END.lat; dsp.lng = N_END.lng;
  const store = mkSharedStore(baseData(dsp));
  const w = mkWorld(store);
  const feed = mkFeed(w, null);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  for (let c = 0; c < 3; c++) {
    park(feed, clock, S_END, 240);
    drive(feed, clock, S_END, N_END, 300);
    park(feed, clock, N_END, 70);
    drive(feed, clock, N_END, S_END, 300);
  }
  const r = day(w);
  ok(r.count >= 2, 'A11 counts build (labels swapped, count true) (>=2)', JSON.stringify(r));
}

/* ---------------- A12: the learner readout ---------------- */
console.log('A12 — GeoLoads.status(): the Advanced readout reads live engine state');
{
  const store = mkSharedStore(baseData(DSP_NOPIN));
  const w = mkWorld(store);
  const feed = mkFeed(w, function () { return 17; });
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, S_END, 240);                    // anchor dwell
  let st = (typeof w.GeoLoads.status === 'function') ? w.GeoLoads.status() : null;
  ok(!!st, 'A12 status() exists', typeof w.GeoLoads.status);
  if (st) {
    ok(st.watching === true && st.mode === 'pattern', 'A12 status names the mode (pattern)', JSON.stringify({ mode: st.mode }));
    ok(st.anchor && Math.abs(st.anchor.lat - S_END.lat) < 0.002, 'A12 status shows the learned anchor', st.anchor && st.anchor.lat);
    ok(st.lastFixAccuracy === 17, 'A12 status shows the last fix accuracy', st.lastFixAccuracy);
    drive(feed, clock, S_END, N_END, 300);
    park(feed, clock, N_END, 60);                   // a stop building at the far end
    st = w.GeoLoads.status();
    /* The readout must show the stop's progress one way or the
       other: either the dwell is visibly building toward the
       2-min bar, or the place has already confirmed and sits as
       the candidate (a slow approach creeps into the cluster, so
       confirmation can land before 2 min of parked time). */
    const candAtN = st.cand && Math.abs(st.cand.lat - N_END.lat) < 0.002;
    ok((typeof st.dwellMs === 'number' && st.dwellMs >= 40000) || candAtN,
      'A12 status shows the far stop building (dwell) or confirmed (candidate)', JSON.stringify({ dwellMs: st.dwellMs, cand: st.cand }));
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
