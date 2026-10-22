#!/usr/bin/env node
/* Meticulous v68 — geofence load-count LEARNING: behavioral tests
 * against the REAL shipped js/geoloads.js glue (whole file in a vm,
 * JSON-round-trip store, fake LiveMiles fix stream).
 * Run: node tools/geoloads-learning-test.js
 *
 * The owner's correction (Oct 14): the dump location is almost
 * never on the dispatch — the operator gives it verbally on site.
 * So a dispatch with a load pin but no dump pin must LEARN its dump
 * site from the driving, remember the pair, and never ask the user.
 *
 *  (a) single-pin day: first load->dump trip teaches the site,
 *      credits load #1, writes the pair memory; later cycles count
 *  (b) day 2, same load site: the remembered pair pre-arms counting
 *      from the first load (no 3-minute teaching dwell needed); a
 *      rival dwell that day is RECORDED (altDump), never applied,
 *      and the pair memory is untouched
 *  (c) two rival candidates before the first cycle closes = an
 *      ambiguous day: teaching retracted, count zeroed, pair
 *      forgotten — and the day stays unteachable on a later session
 *  (d) no pins at all / no session: nothing counted, honest reason
 *  (e) the same teaching works off replayed native breadcrumbs
 *      (the v64 crumb path), not only the live stream
 *  (f) two-pin dispatches behave exactly as v50 (no learning
 *      artifacts, pair memory untouched)
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'geoloads.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok - ' + name); }
  else { fail++; console.log('  FAIL - ' + name); }
}

/* ---------- fake environment ---------- */
function mkStore(seed) {
  const data = {};
  Object.keys(seed || {}).forEach(function (k) { data[k] = JSON.parse(JSON.stringify(seed[k])); });
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

/* ---------- trace helpers (Calgary-area, geo.js fix shape) ---------- */
const T0 = 1760455200000; // fixed epoch (matches geofence-loads-test)
function dstr(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function off(lat, lng, eM, nM) {
  return [lat + nM / 111320, lng + eM / (111320 * Math.cos(lat * Math.PI / 180))];
}
const STILL = [[0, 0], [15, 10], [-12, 8], [10, -14], [-8, -10]];
function site(eM, nM) { const ll = off(51.05, -114.07, eM, nM); return { lat: ll[0], lng: ll[1] }; }
function fx(tS, ll) { return { latitude: ll[0], longitude: ll[1], accuracy: 8, time: T0 + tS * 1000 }; }
function park(world, clock, center, durS) {
  const steps = Math.floor(durS / 10);
  for (let k = 0; k <= steps; k++) {
    const w = STILL[k % STILL.length];
    world.feed(fx(clock.t, off(center.lat, center.lng, w[0], w[1])));
    clock.t += 10;
  }
}
function drive(world, clock, A, B, durS) {
  const steps = Math.floor(durS / 10);
  for (let k = 1; k <= steps; k++) {
    const f = k / steps;
    world.feed(fx(clock.t, [A.lat + (B.lat - A.lat) * f, A.lng + (B.lng - A.lng) * f]));
    clock.t += 10;
  }
}
function near(a, b, tolDeg) { return a && b && Math.abs(a.lat - b.lat) < tolDeg && Math.abs(a.lng - b.lng) < tolDeg; }

const LOAD = site(0, 0), DUMP = site(2200, 800);

/* ================= (a) single-pin day: teaching ================= */
console.log('(a) single-pin day — the first trip teaches, the day counts on');
const storeA = mkStore({ dsp_active: { id: 'dsp-a', jobSite: 'Pit A', lat: LOAD.lat, lng: LOAD.lng } });
{
  const w = mkWorld(storeA);
  const DAY = dstr(T0);
  const armed = w.GeoLoads.startDay('s' + T0);
  ok(armed === false, 'no counter armed yet — the day starts in learning mode');
  let day = w.GeoLoads.forDate(DAY);
  ok(day && day.blocked === 'learning' && day.count === 0, 'day record honestly says: still learning');
  const clock = { t: 0 };
  park(w, clock, LOAD, 70);
  drive(w, clock, LOAD, DUMP, 240);
  park(w, clock, DUMP, 200);                       // the teaching dwell
  day = w.GeoLoads.forDate(DAY);
  ok(day && day.count === 1, 'teaching cycle credited as load #1');
  ok(day.blocked === null, 'no longer blocked once taught');
  ok(day.sites && day.sites.dump && day.sites.dump.src === 'learned', 'dump site marked as learned');
  ok(near(day.learnedDump, DUMP, 0.0005), 'learnedDump is the dwell place');
  /* v220 (LOADS-TIGHT-GEOFENCE) supersedes the v68 pin here: a
     first dwell — even a 200 s one — is NOT proof (a mid-leg stop
     dwells exactly like a tip), so the pair memory is NOT written
     at teach time any more. It is written when the truck closes
     the full cycle back at the load site (the drive + park right
     below), and this test asserts both halves. */
  let pairs = storeA.get('geoload_pairs', { pairs: {} }).pairs;
  ok(Object.keys(pairs).length === 0, 'v220: pair memory NOT written at teach time — a dwell alone is not proof');
  drive(w, clock, DUMP, LOAD, 240);
  park(w, clock, LOAD, 70);
  pairs = storeA.get('geoload_pairs', { pairs: {} }).pairs;
  const pkeys = Object.keys(pairs);
  ok(pkeys.length === 1 && near(pairs[pkeys[0]].dump, DUMP, 0.0005), 'pair memory written once the cycle closed, keyed by the load site');
  drive(w, clock, LOAD, DUMP, 240);
  park(w, clock, DUMP, 70);
  day = w.GeoLoads.forDate(DAY);
  ok(day.count === 2 && day.events.length === 2, 'cycles after teaching count normally');
  w.GeoLoads.stopDay();
}

/* ================= (b) day 2: remembered pair pre-arms ================= */
console.log('(b) day 2 — remembered pair pre-arms; a rival is recorded, never applied');
{
  storeA.set('dsp_active', { id: 'dsp-b', jobSite: 'Pit A', lat: LOAD.lat, lng: LOAD.lng });
  const w = mkWorld(storeA);
  const T1 = T0 + 86400000, DAY2 = dstr(T1);
  const armed = w.GeoLoads.startDay('s' + T1);
  ok(armed === true, 'counting armed from the remembered pair');
  const clock = { t: 86400 };
  park(w, clock, LOAD, 70);
  drive(w, clock, LOAD, DUMP, 240);
  park(w, clock, DUMP, 70);                        // no 3-min dwell needed
  let day = w.GeoLoads.forDate(DAY2);
  ok(day.count === 1, 'first load of day 2 counts straight away');
  ok(day.sites.dump.src === 'remembered', 'dump site marked as remembered');
  ok(!day.learnedDump, 'nothing was taught today');
  const OTHER = site(4000, -1200);
  drive(w, clock, DUMP, LOAD, 240);
  park(w, clock, LOAD, 70);
  drive(w, clock, LOAD, OTHER, 240);
  park(w, clock, OTHER, 200);                      // rival dwell on a loaded leg
  day = w.GeoLoads.forDate(DAY2);
  ok(day.count === 1, 'the rival dwell counted nothing');
  ok(near(day.altDump, OTHER, 0.0005), 'the rival is recorded on the day (altDump)');
  const pairs = storeA.get('geoload_pairs', { pairs: {} }).pairs;
  const pkeys = Object.keys(pairs);
  ok(pkeys.length === 1 && near(pairs[pkeys[0]].dump, DUMP, 0.0005), 'pair memory NOT overwritten by the rival');
  w.GeoLoads.stopDay();
}

/* ================= (c) ambiguity retracts everything ================= */
console.log('(c) two rivals before the cycle closes — ambiguous day');
{
  const FUEL = site(2600, -400), REAL = site(4200, 900);
  const store = mkStore({ dsp_active: { id: 'dsp-c', jobSite: 'Pit A', lat: LOAD.lat, lng: LOAD.lng } });
  const w = mkWorld(store);
  const DAY = dstr(T0);
  w.GeoLoads.startDay('s' + T0);
  const clock = { t: 0 };
  park(w, clock, LOAD, 70);
  drive(w, clock, LOAD, FUEL, 240);
  park(w, clock, FUEL, 200);                       // teaches the fuel stop
  let day = w.GeoLoads.forDate(DAY);
  ok(day.count === 1 && day.learnedDump, 'first dwell taught (count 1, pair written)');
  drive(w, clock, FUEL, REAL, 240);
  park(w, clock, REAL, 200);                       // rival before returning to load
  day = w.GeoLoads.forDate(DAY);
  ok(day.blocked === 'ambiguous-dump', 'day marked ambiguous');
  ok(day.count === 0, 'learned count retracted to zero');
  ok(!day.learnedDump && day.dumpContested && near(day.dumpContested.rival, REAL, 0.0005), 'contest recorded with the rival');
  ok(Object.keys(store.get('geoload_pairs', { pairs: {} }).pairs).length === 0, 'pair memory forgotten');
  w.GeoLoads.stopDay();
  // a later session the same day must not re-teach
  const w2 = mkWorld(store);
  const armed2 = w2.GeoLoads.startDay('s' + (T0 + 3600000));
  ok(armed2 === false, 'later session: still not armed');
  const clock2 = { t: 3600 };
  park(w2, clock2, LOAD, 70);
  drive(w2, clock2, LOAD, REAL, 240);
  park(w2, clock2, REAL, 200);
  day = w2.GeoLoads.forDate(DAY);
  ok(day.blocked === 'ambiguous-dump' && day.count === 0, 'the ambiguous day teaches nothing more');
  w2.GeoLoads.stopDay();
}

/* ================= (d) no pins / no session ================= */
console.log('(d) no load pin, and no session at all');
{
  const store = mkStore({ dsp_active: { id: 'dsp-d', jobSite: 'Text-only dispatch' } });
  const w = mkWorld(store);
  const DAY = dstr(T0);
  w.GeoLoads.startDay('s' + T0);
  const clock = { t: 0 };
  park(w, clock, LOAD, 70);
  drive(w, clock, LOAD, DUMP, 240);
  park(w, clock, DUMP, 200);
  const day = w.GeoLoads.forDate(DAY);
  /* v203 SUPERSEDES the 'no-site-coords' pin: a pin-less ACTIVE
     dispatch no longer goes blind — the pattern learner watches
     the day's own dwell clusters for a pit<->dump cycle. This
     trace (70 s at the load place, under the 2-minute anchor
     dwell) teaches nothing, so still nothing is counted — the
     honest reason is now 'learning', the state it is in. */
  ok(day && day.count === 0 && day.blocked === 'learning', 'no pins: nothing counted, the day is pattern-learning');
  const fresh = mkWorld(mkStore({}));
  ok(fresh.GeoLoads.forDate(DAY) === null, 'no session ever: no record, no fake numbers');
  ok(fresh.GeoLoads.ingestNativeCrumbs([{ t: T0, a: LOAD.lat, o: LOAD.lng, c: 8 }]) === 0, 'crumbs without a session change nothing');
}

/* ================= (e) teaching from native breadcrumbs ================= */
console.log('(e) the v64 crumb path teaches too (background learning)');
{
  const store = mkStore({ dsp_active: { id: 'dsp-e', jobSite: 'Pit A', lat: LOAD.lat, lng: LOAD.lng } });
  const w = mkWorld(store);
  const DAY = dstr(T0);
  w.GeoLoads.startDay('s' + T0);
  const crumbs = [];
  const clock = { t: 0 };
  function crumbPark(center, durS) {
    const steps = Math.floor(durS / 10);
    for (let k = 0; k <= steps; k++) {
      const ww = STILL[k % STILL.length];
      const ll = off(center.lat, center.lng, ww[0], ww[1]);
      crumbs.push({ t: T0 + clock.t * 1000, a: ll[0], o: ll[1], c: 8 });
      clock.t += 10;
    }
  }
  function crumbDrive(A, B, durS) {
    const steps = Math.floor(durS / 10);
    for (let k = 1; k <= steps; k++) {
      const f = k / steps;
      crumbs.push({ t: T0 + clock.t * 1000, a: A.lat + (B.lat - A.lat) * f, o: A.lng + (B.lng - A.lng) * f, c: 8 });
      clock.t += 10;
    }
  }
  crumbPark(LOAD, 70);
  crumbDrive(LOAD, DUMP, 240);
  crumbPark(DUMP, 200);
  const n = w.GeoLoads.ingestNativeCrumbs(crumbs);
  ok(n > 0, 'crumbs accepted into the fix path (' + n + ')');
  const day = w.GeoLoads.forDate(DAY);
  ok(day && day.count === 1 && day.learnedDump, 'a cycle completed while the app was dead still teaches + counts');
  w.GeoLoads.stopDay();
}

/* ================= (f) two-pin regression ================= */
console.log('(f) two-pin dispatch — exactly the v50 behaviour');
{
  const store = mkStore({
    dsp_active: { id: 'dsp-f', jobSite: 'Pit A', lat: LOAD.lat, lng: LOAD.lng, dumpLat: DUMP.lat, dumpLng: DUMP.lng, dropoff: 'Dump site' }
  });
  const w = mkWorld(store);
  const DAY = dstr(T0);
  const armed = w.GeoLoads.startDay('s' + T0);
  ok(armed === true, 'armed immediately from the two pins');
  const clock = { t: 0 };
  park(w, clock, LOAD, 70);
  drive(w, clock, LOAD, DUMP, 240);
  park(w, clock, DUMP, 70);
  const day = w.GeoLoads.forDate(DAY);
  ok(day.count === 1 && day.sites.dump.src === 'pin', 'counts from the pins');
  ok(!day.learnedDump && !day.altDump, 'no learning artifacts on a pin day');
  ok(store.get('geoload_pairs', null) === null, 'pair memory never touched');
  w.GeoLoads.stopDay();
}

console.log('\ngeoloads-learning: ' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
