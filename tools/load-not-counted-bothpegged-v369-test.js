#!/usr/bin/env node
/* LOAD-NOT-COUNTED-AFTER-BOTH-PEGGED-NOV7 — reproduction suite.
 * Asjad's Nov 7, 2026 day, replayed through the REAL js/geoloads.js:
 *   - dispatch carries BOTH pins (go-empty-to PL, hauling-to PD)
 *   - 08:24 he pegs PICKUP only (at PL) -> morning counts under the
 *     dump-VISIT law ("counted by GPS"): load 1 at PD, load 2 at PD
 *   - 11:18, standing at PD mid-visit, he pegs DUMP -> the day
 *     switches to the PEG CYCLE counter ("counted from your pegs")
 *   - next full cycle (PD -> PL -> PD) must count load 3
 * Variants probe where the peg cycle can lose that arrival:
 *   face offsets at the return tip, accuracy bars, dwell lengths.
 * Run: node tools/load-not-counted-bothpegged-v369-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const geoSrc = fs.readFileSync(path.join(ROOT, 'js', 'geoloads.js'), 'utf8');
const RealDate = Date;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function mkSharedStore(data) {
  data = data || {};
  return {
    get: function (k, dflt) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : dflt; },
    set: function (k, v) { data[k] = JSON.parse(JSON.stringify(v)); },
    _data: data
  };
}
function mkGeoWorld(store) {
  const sb = { console: console, Date: RealDate, Math: Math, JSON: JSON };
  sb.window = sb;
  let handler = null;
  sb.LiveMiles = { available: function () { return true; }, subscribe: function (fn) { handler = fn; } };
  sb.App = { _store: store };
  vm.createContext(sb);
  vm.runInContext(geoSrc, sb);
  if (!sb.GeoLoads) throw new Error('GeoLoads not exposed');
  return { GeoLoads: sb.GeoLoads, feed: function (fix) { return handler(fix); } };
}
const GT0 = new RealDate(2026, 10, 7, 6, 0, 0).getTime();
function gdstr(ts) {
  const d = new RealDate(ts);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const GTODAY = gdstr(GT0);
function goff(lat, lng, eM, nM) { return [lat + nM / 111320, lng + eM / (111320 * Math.cos(lat * Math.PI / 180))]; }
function gpt(base, eM, nM) { const ll = goff(base.lat, base.lng, eM, nM); return { lat: ll[0], lng: ll[1] }; }
const GSTILL = [[0, 0], [15, 10], [-12, 8], [10, -14], [-8, -10]];
let ACC = 8;
function mkFeed(world) {
  return function (tS, ll) { return world.feed({ latitude: ll[0], longitude: ll[1], accuracy: ACC, time: GT0 + tS * 1000 }); };
}
function park(feed, clock, center, durS) {
  const steps = Math.floor(durS / 10);
  for (let k = 0; k <= steps; k++) {
    const w = GSTILL[k % GSTILL.length];
    feed(clock.t, goff(center.lat, center.lng, w[0], w[1]));
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
const GHOME = { lat: 51.15709, lng: -113.93862 };
function dspRec(extra) {
  return Object.assign({ id: 'dsp-1', jobSite: 'Aecon Trans', dropoff: '', status: 'active', date: GTODAY, scheduledAt: GTODAY + 'T08:00:00' }, extra || {});
}
function baseData(dsp) {
  return { nav_data: { personal: [{ name: 'Home', lat: GHOME.lat, lng: GHOME.lng }], work: [], recent: [] },
    dsp_list: [dsp], dsp_active: dsp };
}
/* Nov 7 geometry: PL = go-empty-to (airport), PD = hauling-to, ~20 km apart */
const PL = { lat: 51.1252302, lng: -113.9828043 };
const PD = { lat: 51.3078892, lng: -114.0369748 };

/* Replay the morning up to the dump peg. Returns the world at the
   moment just after setPeg('dump') at PD (truck parked at PD). */
function morning(opts) {
  opts = opts || {};
  const dsp = dspRec();
  dsp.lat = PL.lat; dsp.lng = PL.lng; dsp.dumpLat = PD.lat; dsp.dumpLng = PD.lng;
  const store = mkSharedStore(baseData(dsp));
  const w = mkGeoWorld(store);
  const feed = mkFeed(w); const clock = { t: 0 };
  w.GeoLoads.startDay('s' + GT0, {});
  park(feed, clock, PL, 120);
  w.GeoLoads.setPeg('load');                    /* 08:24 pickup peg */
  drive(feed, clock, PL, PD, 600); park(feed, clock, PD, 300);   /* load 1 (visit) */
  drive(feed, clock, PD, PL, 600); park(feed, clock, PL, 300);   /* close + load */
  drive(feed, clock, PL, PD, 600); park(feed, clock, PD, 300);   /* load 2 (visit) */
  const pre = w.GeoLoads.today();
  w.GeoLoads.setPeg('dump');                    /* 11:18 dump peg, at PD */
  const post = w.GeoLoads.today();
  return { w: w, feed: feed, clock: clock, pre: pre, post: post };
}

/* ---------- N1: the Nov 7 day, clean geometry ---------- */
{
  console.log('N1 — Nov 7 replay: visit morning -> dump peg mid-visit -> next cycle');
  ACC = 8;
  const m = morning();
  console.log('    morning: count=' + m.pre.count + ' src=' + m.pre.countSource +
    ' | after dump peg: count=' + m.post.count + ' src=' + m.post.countSource);
  ok('N1 morning counts 2 under the visit law', m.pre.count === 2, 'got ' + m.pre.count);
  ok('N1 morning source is dump-visit', m.pre.countSource === 'dump-visit', 'got ' + m.pre.countSource);
  ok('N1 the dump peg keeps the day count (no reset)', m.post.count === 2, 'got ' + m.post.count);
  ok('N1 source switches to pegs after both pegs', m.post.countSource === 'pegs', 'got ' + m.post.countSource);
  drive(m.feed, m.clock, PD, PL, 600); park(m.feed, m.clock, PL, 300);
  drive(m.feed, m.clock, PL, PD, 600); park(m.feed, m.clock, PD, 300);
  const c3 = m.w.GeoLoads.today();
  const st = m.w.GeoLoads.status();
  console.log('    after cycle 3: count=' + c3.count + ' phase=' + (st.counter ? st.counter.phase : '?') +
    ' zone=' + (st.counter ? st.counter.zone : '?') + ' armed=' + (st.counter ? st.counter.armed : '?'));
  ok('N1 the first full cycle after both pegs counts load 3', c3.count === 3, 'got ' + c3.count);
}

/* ---------- N2: cycle-3 tip face offset from the dump seed ---------- */
[60, 100, 150].forEach(function (off) {
  console.log('N2 — cycle-3 tip face ' + off + ' m from the dump peg');
  ACC = 8;
  const m = morning();
  const F = gpt(PD, off, 0);
  drive(m.feed, m.clock, PD, PL, 600); park(m.feed, m.clock, PL, 300);
  drive(m.feed, m.clock, PL, F, 600); park(m.feed, m.clock, F, 300);
  const c = m.w.GeoLoads.today().count;
  ok('N2 tip at +' + off + ' m counts load 3', c === 3, 'got ' + c);
});
/* PROBE (not pinned): a tip face +250 m from the seed sits beyond the
   recovery band (200 m) — the centre is never walked in and the visit
   does not count under the peg cycle counter. Logged as a named open
   limit in the queue; widening the band is NOT part of this fix (a
   rival stop inside a wider band on a loaded leg could drag the
   centre — a separate, owner-visible call). */
{
  console.log('N2 PROBE — cycle-3 tip face +250 m (beyond recovery band)');
  ACC = 8;
  const m = morning();
  const F = gpt(PD, 250, 0);
  drive(m.feed, m.clock, PD, PL, 600); park(m.feed, m.clock, PL, 300);
  drive(m.feed, m.clock, PL, F, 600); park(m.feed, m.clock, F, 300);
  console.log('    probe: count=' + m.w.GeoLoads.today().count + ' (2 = the documented band limit)');
}

/* ---------- N3: cycle-3 pickup offset from the load seed ---------- */
[60, 100, 150].forEach(function (off) {
  console.log('N3 — cycle-3 pickup ' + off + ' m from the pickup peg');
  ACC = 8;
  const m = morning();
  const F = gpt(PL, off, 0);
  drive(m.feed, m.clock, PD, F, 600); park(m.feed, m.clock, F, 300);
  drive(m.feed, m.clock, F, PD, 600); park(m.feed, m.clock, PD, 300);
  const c = m.w.GeoLoads.today().count;
  ok('N3 pickup at +' + off + ' m still arms and counts load 3', c === 3, 'got ' + c);
});

/* ---------- N4: fix accuracy through the day ---------- */
[20, 35, 45].forEach(function (acc) {
  console.log('N4 — fix accuracy ' + acc + ' m all day');
  ACC = acc;
  const m = morning();
  drive(m.feed, m.clock, PD, PL, 600); park(m.feed, m.clock, PL, 300);
  drive(m.feed, m.clock, PL, PD, 600); park(m.feed, m.clock, PD, 300);
  const c = m.w.GeoLoads.today().count;
  ok('N4 accuracy ' + acc + ' m: cycle after both pegs counts load 3', c === 3, 'got ' + c + ' (morning was ' + m.pre.count + ')');
});
ACC = 8;

/* ---------- N5: short tip dwell on cycle 3 ---------- */
[75, 120].forEach(function (dwell) {
  console.log('N5 — cycle-3 tip dwell ' + dwell + ' s at the seed face');
  ACC = 8;
  const m = morning();
  drive(m.feed, m.clock, PD, PL, 600); park(m.feed, m.clock, PL, 300);
  drive(m.feed, m.clock, PL, PD, 600); park(m.feed, m.clock, PD, dwell);
  drive(m.feed, m.clock, PD, PL, 600); park(m.feed, m.clock, PL, 120);
  const c = m.w.GeoLoads.today().count;
  ok('N5 tip dwell ' + dwell + ' s counts load 3', c === 3, 'got ' + c);
});
/* PROBE (not pinned): a 45 s tip at the seed face does not land —
   the rolling centroid's lag plus the 30 s arrival dwell put the
   effective bar near a minute. Logged in the queue as a limit. */
{
  console.log('N5 PROBE — cycle-3 tip dwell 45 s at the seed face');
  ACC = 8;
  const m = morning();
  drive(m.feed, m.clock, PD, PL, 600); park(m.feed, m.clock, PL, 300);
  drive(m.feed, m.clock, PL, PD, 600); park(m.feed, m.clock, PD, 45);
  drive(m.feed, m.clock, PD, PL, 600); park(m.feed, m.clock, PL, 120);
  console.log('    probe: count=' + m.w.GeoLoads.today().count + ' (2 = the documented dwell limit)');
}

/* ---------- N6: DOUBLE-COUNT GUARD — his manual +1 for the missed
   visit, then the machine fires LATE for that same visit ---------- */
{
  console.log('N6 — manual +1 at the tip, machine confirms the same carry late');
  ACC = 8;
  const m = morning();
  drive(m.feed, m.clock, PD, PL, 600); park(m.feed, m.clock, PL, 300);
  drive(m.feed, m.clock, PL, PD, 600); park(m.feed, m.clock, PD, 20);
  /* he taps +1 at the dump BEFORE the machine's arrival dwell lands */
  m.w.GeoLoads.nudge(1);
  const afterTap = m.w.GeoLoads.today().count;
  park(m.feed, m.clock, PD, 300);   /* machine dwell now confirms the same arrival */
  const afterMachine = m.w.GeoLoads.today().count;
  console.log('    after tap=' + afterTap + ', after machine confirm=' + afterMachine);
  ok('N6 tap reads 3 at the tip', afterTap === 3, 'got ' + afterTap);
  ok('N6 the late machine count does NOT stack (still 3, not 4)', afterMachine === 3, 'got ' + afterMachine);
}

/* ---------- N6b: the same guard at a face 150 m off the centre —
   beyond the old 120 m mark gate, inside the counter's own reach.
   (Nov 7 itself: his fix sat ~125 m from the dispatch pin.) ---------- */
{
  console.log('N6b — manual +1 at a +150 m face, machine walks in and fires late');
  ACC = 8;
  const m = morning();
  const F = gpt(PD, 150, 0);
  drive(m.feed, m.clock, PD, PL, 600); park(m.feed, m.clock, PL, 300);
  drive(m.feed, m.clock, PL, F, 600); park(m.feed, m.clock, F, 20);
  m.w.GeoLoads.nudge(1);
  const afterTap = m.w.GeoLoads.today().count;
  park(m.feed, m.clock, F, 600);   /* recovery walks the centre in; the arrival lands late */
  const afterMachine = m.w.GeoLoads.today().count;
  console.log('    after tap=' + afterTap + ', after machine confirm=' + afterMachine);
  ok('N6b tap reads 3 at the offset face', afterTap === 3, 'got ' + afterTap);
  ok('N6b the late machine count does NOT stack (still 3, not 4)', afterMachine === 3, 'got ' + afterMachine);
}

/* ---------- N6c: a +1 for a visit the machine truly swallowed (the
   peg-switch presence at 11:18) must STAND — the next, different
   arrival still counts on top of it ---------- */
{
  console.log('N6c — manual +1 for the swallowed peg-switch visit stands');
  ACC = 8;
  const m = morning();
  /* the peg counter's first presence at PD (the peg moment) is its
     baseline, never a count — his +1 here is for THAT visit */
  park(m.feed, m.clock, PD, 60);
  m.w.GeoLoads.nudge(1);
  const afterTap = m.w.GeoLoads.today().count;
  drive(m.feed, m.clock, PD, PL, 600); park(m.feed, m.clock, PL, 300);
  drive(m.feed, m.clock, PL, PD, 600); park(m.feed, m.clock, PD, 300);
  const afterCycle = m.w.GeoLoads.today();
  console.log('    after tap=' + afterTap + ', after next cycle=' + afterCycle.count + ' corr=' + afterCycle.corr);
  ok('N6c tap reads 3 for the swallowed visit', afterTap === 3, 'got ' + afterTap);
  ok('N6c the next real arrival counts on top (4 = 2 auto + 1 hand + 1 auto)', afterCycle.count === 4, 'got ' + afterCycle.count);
  ok('N6c the hand correction was NOT retired by a different load', afterCycle.corr === 1, 'got ' + afterCycle.corr);
}

console.log('\nload-not-counted-bothpegged-v369: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
