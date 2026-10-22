#!/usr/bin/env node
/* Meticulous v203 — LOADS-GPS-FIX (owner, Oct 21, 2026 10:09
 * MDT, from his live Manifest): "Counted with the +1 load
 * button while working — 13 loads." The GPS load counter
 * registered ZERO all day: his dispatch came from a boss's
 * text message — no map pin, and its text (a customer +
 * project string) names no place the app knows — so
 * configure() found no load anchor, wrote 'no-site-coords'
 * and started NOTHING: no counter, and not even the dump
 * learner (it hangs off the load fence). The day's driving
 * held the whole pattern anyway — the Manifest's own trail
 * recorded the stops.
 *
 * The fix: when an ACTIVE dispatch carries no anchor, the
 * PATTERN learner (createPatternLearner, js/geoloads.js)
 * watches the day's dwell clusters itself: home never
 * anchors (v190 rule), the first work place is the load
 * site, a second place >= 300 m away is the dump, the pair
 * arms the counter with the teaching cycle credited, a
 * third place before the cycle closes contests it all.
 *
 * This suite replays TODAY'S stop pattern over the real
 * geoloads.js: at-home dwell -> pit dwells of ~4 min
 * interleaved with dump tips of ~5 min at the Ivor East
 * Pond cluster (50.950x, -114.014x) -> the count builds
 * itself with NO +1 input anywhere.
 * Run: node tools/loads-gps-fix-v203-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'geoloads.js'), 'utf8');
const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  ok(JSON.stringify(got) === JSON.stringify(want), name,
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

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

/* T0 = today at 06:00 local, so GeoLoads.today() (which reads
   the real calendar day) speaks about this fixture's day too. */
const T0 = (function () { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 6, 0, 0).getTime(); })();
function dstr(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function off(lat, lng, eM, nM) {
  return [lat + nM / 111320, lng + eM / (111320 * Math.cos(lat * Math.PI / 180))];
}
const STILL = [[0, 0], [15, 10], [-12, 8], [10, -14], [-8, -10]];
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
function nearM(a, b) {
  if (!a || !b) return 1e9;
  const dLa = (a.lat - b.lat) * 111320, dLo = (a.lng - b.lng) * 111320 * Math.cos(a.lat * Math.PI / 180);
  return Math.sqrt(dLa * dLa + dLo * dLo);
}

/* Today's ground truth (his Oct 21 stops): home in Cornerstone,
   the dump cluster at Ivor East Pond, the pit a few km away. */
const HOME = { lat: 51.15709, lng: -113.93862 };
const DUMP = { lat: 50.9505, lng: -114.0145 };
const PIT = { lat: 50.9850, lng: -114.0520 };
const FUEL = { lat: 51.0200, lng: -113.9900 };
const DAY = dstr(T0);

function todayStore() {
  return mkStore({
    dsp_active: { id: 'dsp-x', jobSite: 'Aecon — Project A01728', dropoff: 'Ivor East Pond', status: 'active' },
    nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] }
  });
}

/* ================= the day itself ================= */
console.log('— today replayed: message dispatch, no pins, cycles counted —');
{
  const store = todayStore();
  const w = mkWorld(store);
  eq('startDay: no counter armed yet (nothing to fence)', w.GeoLoads.startDay('s' + T0), false);
  let day = w.GeoLoads.forDate(DAY);
  ok(day && day.blocked === 'learning' && day.count === 0, 'the day opens pattern-learning, not blind');

  const clock = { t: 0 };
  park(w, clock, HOME, 600);            // the morning at home — never an anchor
  drive(w, clock, HOME, PIT, 600);
  park(w, clock, PIT, 240);             // first work dwell: the pit (today: ~4 min stops)
  day = w.GeoLoads.forDate(DAY);
  ok(day && day.count === 0 && !day.sites, 'after the pit alone: anchor only, nothing counted, no fence yet');

  drive(w, clock, PIT, DUMP, 420);
  park(w, clock, DUMP, 300);            // the first tip (today: ~5 min at the pond)
  day = w.GeoLoads.forDate(DAY);
  eq('the teaching tip credits load #1 — no +1 anywhere', day && day.count, 1);
  ok(day && day.sites && nearM(day.sites.load, PIT) < 150, 'the load site is the pit cluster');
  ok(day && day.sites && nearM(day.sites.dump, DUMP) < 150, 'the dump site is the pond cluster');
  ok(day && nearM(day.sites.load, HOME) > 1000, 'home was never the anchor');
  const pairs = (store.get('geoload_pairs', {}) || {}).pairs || {};
  eq('the pair is remembered for tomorrow', Object.keys(pairs).length, 1);

  drive(w, clock, DUMP, PIT, 420);
  park(w, clock, PIT, 240);             // back at the pit: the cycle closes (locks)
  drive(w, clock, PIT, DUMP, 420);
  park(w, clock, DUMP, 300);
  eq('second cycle counted by the counter', w.GeoLoads.forDate(DAY).count, 2);
  drive(w, clock, DUMP, PIT, 420);
  park(w, clock, PIT, 180);
  drive(w, clock, PIT, DUMP, 420);
  park(w, clock, DUMP, 300);
  const fin = w.GeoLoads.forDate(DAY);
  eq('three cycles, zero hand taps', fin.count, 3);
  eq('three dump events on the day', fin.events.length, 3);
  const td = w.GeoLoads.today();
  ok(td.armed === true && td.count === 3, 'the dashboard read: armed, 3 loads');
}

/* ================= relaunch: the taught pair survives ================= */
console.log('— a mid-day relaunch re-arms from the taught pair —');
{
  const store = todayStore();
  const w = mkWorld(store);
  w.GeoLoads.startDay('s' + T0);
  const clock = { t: 0 };
  park(w, clock, HOME, 300);
  drive(w, clock, HOME, PIT, 600);
  park(w, clock, PIT, 240);
  drive(w, clock, PIT, DUMP, 420);
  park(w, clock, DUMP, 300);
  eq('morning: one load taught', w.GeoLoads.forDate(DAY).count, 1);
  w.GeoLoads.stopDay();
  /* a fresh world (new app process) over the same store, a new
     session key — the pair comes back off the day record */
  const w2 = mkWorld(store);
  eq('relaunch: the counter re-arms at once', w2.GeoLoads.startDay('s' + (T0 + 3600000)), true);
  eq('relaunch: the count survived', w2.GeoLoads.forDate(DAY).count, 1);
  const clock2 = { t: 3600 };
  drive(w2, clock2, DUMP, PIT, 420);
  park(w2, clock2, PIT, 240);
  drive(w2, clock2, PIT, DUMP, 420);
  park(w2, clock2, DUMP, 300);
  eq('relaunch: the next cycle counts on the same pair', w2.GeoLoads.forDate(DAY).count, 2);
}

/* ================= the contest ================= */
console.log('— a third place before the cycle closes retracts it all —');
{
  const store = todayStore();
  const w = mkWorld(store);
  w.GeoLoads.startDay('s' + T0);
  const clock = { t: 0 };
  park(w, clock, HOME, 300);
  drive(w, clock, HOME, PIT, 600);
  park(w, clock, PIT, 240);
  drive(w, clock, PIT, DUMP, 420);
  park(w, clock, DUMP, 300);
  eq('pair taught, load #1 stands', w.GeoLoads.forDate(DAY).count, 1);
  drive(w, clock, DUMP, FUEL, 420);
  park(w, clock, FUEL, 240);            // a long fuel stop BEFORE ever returning to the pit
  const day = w.GeoLoads.forDate(DAY);
  ok(day && day.blocked === 'ambiguous-dump', 'contested: the day is marked ambiguous');
  eq('contested: the taught count is retracted', day.count, 0);
  const pairs = (store.get('geoload_pairs', {}) || {}).pairs || {};
  eq('contested: the pair memory is forgotten', Object.keys(pairs).length, 0);
}

/* ================= no dispatch: unchanged honesty ================= */
console.log('— no active dispatch: nothing watches, nothing counted —');
{
  const w = mkWorld(mkStore({}));
  eq('startDay without a dispatch arms nothing', w.GeoLoads.startDay('s' + T0), false);
  eq('no day record is invented', w.GeoLoads.forDate(DAY), null);
}

/* statics + pins */
ok('the engine exports the pattern learner', src.includes('createPatternLearner: createPatternLearner'));
ok('configure routes anchorless dispatches to pattern mode', src.includes("learnMode = 'pattern'"));
eq('webVersion', ver.webVersion, 219);
ok('index pin agrees', idxSrc.includes('js/geoloads.js?v=' + ver.webVersion));

console.log('loads-gps-fix-v203: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
