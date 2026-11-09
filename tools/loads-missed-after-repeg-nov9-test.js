#!/usr/bin/env node
/* LOADS-MISSED-AFTER-REPEG-NOV9 — reproduction suite.
 * Asjad's Nov 9, 2026 day, replayed through the REAL js/geoloads.js:
 *   - dispatch carries BOTH pins (go-empty-to X, hauling-to D)
 *   - morning: dump pegged 9:47 (mid-tip at D), pickup pegged
 *     10:44 (at X) -> the day runs the PEG CYCLE counter and
 *     counts cycles on the pair (X load, D dump)
 *   - mid-day the job CHANGES: the pickup site X becomes the
 *     DUMP site, and the pickup moves to a wholly different
 *     site Y. He re-pegs the dump at X (15:02, while standing
 *     at X tipping) and the pickup at Y (16:18, while loading)
 *   - his report (16:31): "the app did skip a beat, its not
 *     counting, I am having to manually count them!" — the 6
 *     on the card was right only because he tapped +1 himself.
 * Scenarios:
 *   S1 the first full cycle on the re-pegged pair (Y -> X)
 *   S2 a dump visit inside the swap window (after the dump
 *      re-peg, before the pickup re-peg)
 *   S3 the pickup peg planted peg-and-go (20 s before he rolls)
 *   G4 a genuine same-site morning pair still cycle-counts
 * Date-proof: the replay day is the host's real today (the
 * family convention — GeoLoads.today() reads the wall clock).
 * Run: node tools/loads-missed-after-repeg-nov9-test.js
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
const NOW = new RealDate();
const T0 = new RealDate(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 6, 0, 0).getTime();
function gdstr(ts) {
  const d = new RealDate(ts);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const TODAY = gdstr(T0);
const STILL = [[0, 0], [15, 10], [-12, 8], [10, -14], [-8, -10]];
let ACC = 8;
function goff(lat, lng, eM, nM) { return [lat + nM / 111320, lng + eM / (111320 * Math.cos(lat * Math.PI / 180))]; }
function mkFeed(world) {
  return function (tS, ll) { return world.feed({ latitude: ll[0], longitude: ll[1], accuracy: ACC, time: T0 + tS * 1000 }); };
}
function park(feed, clock, center, durS) {
  const steps = Math.floor(durS / 10);
  for (let k = 0; k <= steps; k++) {
    const w = STILL[k % STILL.length];
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
const HOME = { lat: 51.15709, lng: -113.93862 };
/* Nov 9 geometry: X = go-empty-to (morning pickup, afternoon
   dump), D = hauling-to (morning dump), Y = the wholly
   different afternoon pickup. */
const X = { lat: 51.1225089, lng: -114.0122197 };
const D = { lat: 51.3078889, lng: -114.0369722 };
const Y = { lat: 51.2010000, lng: -113.9500000 };

function dspRec() {
  return {
    id: 'dsp-1', jobSite: 'Aecon Trans', dropoff: '', status: 'active',
    date: TODAY, scheduledAt: TODAY + 'T08:30:00',
    lat: X.lat, lng: X.lng, dumpLat: D.lat, dumpLng: D.lng
  };
}
function baseData() {
  const dsp = dspRec();
  return { nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] },
    dsp_list: [dsp], dsp_active: dsp };
}
function machine(w) { const st = w.GeoLoads.status(); return st.count; }

/* The morning, replayed to the moment just after the second
   counted cycle on the pair (X load, D dump). Returns the world
   parked at D, with the peg cycle counter running. */
function morning() {
  const store = mkSharedStore(baseData());
  const w = mkGeoWorld(store);
  const feed = mkFeed(w); const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, X, 120);                                   /* at the pickup */
  drive(feed, clock, X, D, 600); park(feed, clock, D, 60);
  w.GeoLoads.setPeg('dump');                                   /* 9:47 — pegged mid-tip */
  park(feed, clock, D, 240);
  const afterTip1 = machine(w);
  drive(feed, clock, D, X, 600); park(feed, clock, X, 60);
  w.GeoLoads.setPeg('load');                                   /* 10:44 — pickup pegged at X */
  park(feed, clock, X, 240);
  const banked = w.GeoLoads.today().count;
  drive(feed, clock, X, D, 600); park(feed, clock, D, 300);    /* cycle 1 */
  const c1 = machine(w);
  drive(feed, clock, D, X, 600); park(feed, clock, X, 300);
  drive(feed, clock, X, D, 600); park(feed, clock, D, 300);    /* cycle 2 */
  const c2 = machine(w);
  return { w: w, feed: feed, clock: clock, afterTip1: afterTip1, banked: banked, c1: c1, c2: c2 };
}

/* The swap: sites change roles, the dump is re-pegged at X.
   Ends parked at Y after loading there, the dump peg live. */
function swapped(m) {
  drive(m.feed, m.clock, D, Y, 600); park(m.feed, m.clock, Y, 300);   /* load at the new pickup */
  drive(m.feed, m.clock, Y, X, 600); park(m.feed, m.clock, X, 300);   /* tip at the new dump (old pair reads 'load') */
  const prePeg = m.w.GeoLoads.today().count;
  m.w.GeoLoads.setPeg('dump');                                        /* 15:02 — dump re-pegged at X */
  const postPeg = m.w.GeoLoads.today().count;
  park(m.feed, m.clock, X, 120);
  drive(m.feed, m.clock, X, Y, 600); park(m.feed, m.clock, Y, 60);    /* back to the new pickup, loading */
  return { prePeg: prePeg, postPeg: postPeg };
}

/* ---------- S1: the first full cycle on the re-pegged pair ---------- */
{
  console.log('S1 — morning cycles -> swap -> both re-pegs -> first cycle on the new pair');
  ACC = 8;
  const m = morning();
  console.log('    morning: tip1=' + m.afterTip1 + ' banked at pickup peg=' + m.banked +
    ' cycle1=' + m.c1 + ' cycle2=' + m.c2 + ' src=' + m.w.GeoLoads.today().countSource);
  ok('S1 morning cycles count on the peg pair', m.c1 === m.banked + 1 && m.c2 === m.banked + 2,
    'banked=' + m.banked + ' c1=' + m.c1 + ' c2=' + m.c2);
  const sw = swapped(m);
  ok('S1 the tip in progress at the dump re-peg is NOT retro-counted', sw.postPeg === sw.prePeg,
    'pre=' + sw.prePeg + ' post=' + sw.postPeg);
  ok('S1 the dump re-peg never drops the day count', sw.postPeg >= m.c2, 'post=' + sw.postPeg + ' c2=' + m.c2);
  park(m.feed, m.clock, Y, 0);
  m.w.GeoLoads.setPeg('load');                                   /* 16:18 — pickup re-pegged at Y */
  const afterLoadPeg = m.w.GeoLoads.today().count;
  ok('S1 the pickup re-peg never drops the day count', afterLoadPeg >= sw.postPeg,
    'after=' + afterLoadPeg + ' post=' + sw.postPeg);
  park(m.feed, m.clock, Y, 240);                                 /* finish loading */
  drive(m.feed, m.clock, Y, X, 600); park(m.feed, m.clock, X, 300);   /* the cycle's tip */
  const afterCycle = machine(m.w);
  console.log('    after first new-pair cycle: machine=' + afterCycle + ' (was ' + m.c2 + ')');
  ok('S1 the first full cycle on the re-pegged pair counts', afterCycle === m.c2 + 1,
    'got ' + afterCycle + ', want ' + (m.c2 + 1));
  drive(m.feed, m.clock, X, Y, 600); park(m.feed, m.clock, Y, 300);
  drive(m.feed, m.clock, Y, X, 600); park(m.feed, m.clock, X, 300);
  const afterCycle2 = machine(m.w);
  ok('S1 the second cycle on the new pair counts too (no one-off)', afterCycle2 === m.c2 + 2,
    'got ' + afterCycle2 + ', want ' + (m.c2 + 2));
}

/* ---------- S2: a dump visit inside the swap window ---------- */
{
  console.log('S2 — dump visits after the dump re-peg, before the pickup re-peg');
  ACC = 8;
  const m = morning();
  const sw = swapped(m);
  const base = machine(m.w);
  console.log('    window opens: machine=' + base + ' today=' + m.w.GeoLoads.today().count +
    ' src=' + m.w.GeoLoads.today().countSource);
  park(m.feed, m.clock, Y, 240);                                 /* finish loading at Y */
  drive(m.feed, m.clock, Y, X, 600); park(m.feed, m.clock, X, 300);   /* window tip 1 */
  const w1 = machine(m.w);
  ok('S2 a dump visit inside the swap window counts', w1 === base + 1,
    'got ' + w1 + ', want ' + (base + 1));
  park(m.feed, m.clock, X, 300);                                 /* still at the dump: same visit */
  const w1b = machine(m.w);
  ok('S2 the same visit never counts twice', w1b === w1, 'got ' + w1b);
  drive(m.feed, m.clock, X, Y, 600); park(m.feed, m.clock, Y, 300);
  drive(m.feed, m.clock, Y, X, 600); park(m.feed, m.clock, X, 300);   /* window tip 2 */
  const w2 = machine(m.w);
  ok('S2 the next separated dump visit counts too', w2 === base + 2,
    'got ' + w2 + ', want ' + (base + 2));
  /* the pickup re-peg ends the window: pair counting resumes */
  drive(m.feed, m.clock, X, Y, 600); park(m.feed, m.clock, Y, 60);
  m.w.GeoLoads.setPeg('load');
  park(m.feed, m.clock, Y, 240);
  drive(m.feed, m.clock, Y, X, 600); park(m.feed, m.clock, X, 300);
  const w3 = machine(m.w);
  ok('S2 after the pickup re-peg the pair cycle counts on top (banked, not reset)',
    w3 === base + 3, 'got ' + w3 + ', want ' + (base + 3));
}

/* ---------- S3: the pickup peg planted peg-and-go ---------- */
{
  console.log('S3 — pickup re-pegged 20 s before he rolls (the arm must ride the declaration)');
  ACC = 8;
  const m = morning();
  const sw = swapped(m);
  park(m.feed, m.clock, Y, 220);                                 /* loading, nearly done */
  m.w.GeoLoads.setPeg('load');                                   /* peg-and-go */
  park(m.feed, m.clock, Y, 20);
  drive(m.feed, m.clock, Y, X, 600); park(m.feed, m.clock, X, 300);   /* the tip */
  const c = machine(m.w);
  console.log('    after the peg-and-go cycle: machine=' + c + ' (morning c2=' + m.c2 + ')');
  ok('S3 the cycle after a peg-and-go pickup peg counts', c === m.c2 + 1,
    'got ' + c + ', want ' + (m.c2 + 1));
  park(m.feed, m.clock, X, 300);                                 /* lingering at the dump */
  const c2nd = machine(m.w);
  ok('S3 lingering at the dump adds nothing', c2nd === c, 'got ' + c2nd);
}

/* ---------- S3b: the pickup peg planted as he rolls ---------- */
{
  console.log('S3b — pickup re-pegged and he rolls at once ("re-pegged and kept moving")');
  ACC = 8;
  const m = morning();
  const sw = swapped(m);
  park(m.feed, m.clock, Y, 240);                                 /* loaded, ready to roll */
  m.w.GeoLoads.setPeg('load');                                   /* the tap, then gone */
  drive(m.feed, m.clock, Y, X, 600); park(m.feed, m.clock, X, 300);   /* the tip */
  const c = machine(m.w);
  console.log('    after the roll-out cycle: machine=' + c + ' (morning c2=' + m.c2 + ')');
  ok('S3b the cycle after a roll-out pickup peg counts', c === m.c2 + 1,
    'got ' + c + ', want ' + (m.c2 + 1));
}

/* ---------- G4: a genuine same-site morning pair still cycle-counts ---------- */
{
  console.log('G4 — same-site pair (40 m apart), pegged fresh in the morning');
  ACC = 8;
  const store = mkSharedStore({ nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] } });
  const w = mkGeoWorld(store);
  const feed = mkFeed(w); const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  const A = { lat: 51.1225089, lng: -114.0122197 };
  const Bl = goff(A.lat, A.lng, 40, 0); const B = { lat: Bl[0], lng: Bl[1] };
  park(feed, clock, A, 120);
  w.GeoLoads.setPeg('load');
  drive(feed, clock, A, B, 30); park(feed, clock, B, 120);
  w.GeoLoads.setPeg('dump');
  park(feed, clock, B, 120);
  drive(feed, clock, B, A, 30); park(feed, clock, A, 300);
  drive(feed, clock, A, B, 30); park(feed, clock, B, 300);
  const g1 = machine(w);
  drive(feed, clock, B, A, 30); park(feed, clock, A, 300);
  drive(feed, clock, A, B, 30); park(feed, clock, B, 300);
  const g2 = machine(w);
  const src = w.GeoLoads.today().countSource;
  console.log('    same-site: after cycle1=' + g1 + ' after cycle2=' + g2 + ' src=' + src);
  ok('G4 same-site pair counts its cycles', g1 >= 1 && g2 === g1 + 1, 'g1=' + g1 + ' g2=' + g2);
  ok('G4 same-site day stays on the peg cycle law', src === 'pegs', 'got ' + src);
}

console.log('\nloads-missed-after-repeg-nov9: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
