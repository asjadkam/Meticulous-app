#!/usr/bin/env node
/* PEG-PU-FAIL-NOV13 (Fri Nov 13, 2026) — at the Aecon Inf site
 * (dispatch #2 of the day, one pin only, started at the site after
 * the morning's Aecon Trans dispatch had already run), the owner
 * tried to peg his pickup and the peg would not set: "I am trying
 * to peg my pu again right now! It's not working."
 *
 * CONVICTION (this bench, failing-first on web 449): the peg-set
 * path (App.trackerPegSite -> GeoLoads.setPeg) sources the peg
 * EXCLUSIVELY from the counter stream's lastFixSeen, and that
 * variable is the wrong evidence in the field conditions of the
 * report:
 *  (1) It is NULL in a fresh page life until the watcher delivers
 *      a fix into THIS page life. The phone's own geo layer
 *      (js/geo.js) persists the last fix across page lives for
 *      exactly this reason (mt_geo_last -> MeticulousGeo.last())
 *      and every other "where is the phone" consumer reads it
 *      (navigator, yardstart, chatbot) — the peg path is the one
 *      consumer that ignores it. A driver who opens the app and
 *      taps PEG at once (his phone had just spent ~25 minutes
 *      backgrounded under a remote session) is refused 'no-fix'
 *      while the phone demonstrably knows where it is.
 *  (2) It is overwritten by EVERY raw watcher fix before any
 *      accuracy filtering (js/miles.js fixSubs contract: raw subs
 *      see every fix; each consumer applies its own rules — the
 *      glue's lastFixSeen assignment applies none). One rough fix
 *      — the normal first fix while GPS re-acquires after a
 *      watcher restart — poisons the tap into a 'rough-fix'
 *      refusal even when a peg-grade fix arrived seconds earlier
 *      in the same stream.
 *
 * FIX (js/geoloads.js only): the glue now also tracks the stream's
 * most recent PEG-GRADE fix (accuracy within the engine's own
 * ACC_MAX_M bar — the same evidence a manual peg has always been
 * planted from). setPeg sources, in order: the stream's peg-grade
 * fix (fresh against the stream's own newest fix, 5 min — the
 * geo layer's freshness standard), else the geo layer's persisted
 * last fix (MeticulousGeo.last(), bar + 5-min wall-clock freshness,
 * the getCurrent layer-1 rule). Refusals keep their honest whys:
 * 'rough-fix' when position evidence exists but none is peg-grade,
 * 'no-fix' when there is none. Counting is untouched: the peg is
 * written on the day record and configure() re-resolves exactly
 * as before, so a re-peg banks the day's count as always.
 *
 * Run: node tools/peg-pu-fix-v450-test.js
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
function mkWorld(store, geoLast) {
  const sb = { console: console, Date: Date, Math: Math, JSON: JSON };
  sb.window = sb;
  let handler = null;
  sb.LiveMiles = {
    available: function () { return true; },
    subscribe: function (fn) { handler = fn; }
  };
  sb.App = { _store: store };
  if (geoLast !== undefined) {
    sb.MeticulousGeo = { last: function () { return geoLast; } };
  }
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

const D1L = { lat: 51.1252222, lng: -113.9828056 };   // Aecon Trans go-empty
const D1D = { lat: 51.1225089, lng: -114.0122197 };   // Aecon Trans hauling-to
const D2L = { lat: 50.990692, lng: -114.030301 };     // Aecon Inf go-empty (only pin)
const D2D = { lat: 50.982000, lng: -114.020000 };     // a dump face ~1.3 km on

function dsp1() {
  return {
    id: 'd1', status: 'active', date: TODAY,
    lat: D1L.lat, lng: D1L.lng, dumpLat: D1D.lat, dumpLng: D1D.lng,
    jobSite: 'Aecon Trans', dropoff: 'Aecon Trans dump',
    notes: 'Go Empty To: 51.1252222,-113.9828056 Hauling To: 51.1225089,-114.0122197'
  };
}
function dsp2() {
  return {
    id: 'd2', status: 'active', date: TODAY,
    lat: D2L.lat, lng: D2L.lng,
    jobSite: 'Aecon Inf', notes: 'Foreman: Alex Go Empty To: 50.990692,-114.030301'
  };
}
function mkDriver(world, t0) {
  const clock = { t: 0 };
  function feed(tS, ll, acc) {
    return world.feed({ latitude: ll[0], longitude: ll[1], accuracy: (acc === undefined ? 8 : acc), time: t0 + tS * 1000 });
  }
  function park(center, durS, acc) {
    const steps = Math.floor(durS / 10);
    for (let k = 0; k <= steps; k++) {
      const w = STILL[k % STILL.length];
      feed(clock.t, off(center.lat, center.lng, w[0], w[1]), acc);
      clock.t += 10;
    }
  }
  function drive(A, B, durS) {
    const steps = Math.floor(durS / 10);
    for (let k = 1; k <= steps; k++) {
      const f = k / steps;
      feed(clock.t, [A.lat + (B.lat - A.lat) * f, A.lng + (B.lng - A.lng) * f]);
      clock.t += 10;
    }
  }
  return { clock: clock, feed: feed, park: park, drive: drive };
}
function dayRec(store) {
  const d = store._data.geoloads;
  return d && d.days ? d.days[TODAY] : null;
}
function near(a, b, m) {
  const dLa = (a.lat - b.lat) * 111320;
  const dLn = (a.lng - b.lng) * 111320 * Math.cos(b.lat * Math.PI / 180);
  return Math.sqrt(dLa * dLa + dLn * dLn) <= m;
}

/* ---------- A: fresh page life at site 2 — the Nov 13 shape ----------
 * The morning ran on dispatch #1 in an earlier page life. The page
 * life that reaches site 2 is FRESH (the phone spent the drive
 * backgrounded): GeoLoads has seen no watcher fix yet, but the geo
 * layer holds a fresh, peg-grade fix at the pin (persisted across
 * page lives exactly for this). The peg must set from it. */
(function () {
  console.log('A — fresh page life, peg from the geo layer\'s persisted fix');
  const store = mkSharedStore({});
  store.set('dsp_active', dsp2());
  const geoFix = { latitude: D2L.lat, longitude: D2L.lng, accuracy: 12, time: Date.now() - 60 * 1000 };
  const world = mkWorld(store, geoFix);
  const G = world.GeoLoads;
  G.startDay('s' + T0, {});
  const r = G.setPeg('load');
  ok(r && r.ok === true, 'A1 peg sets in a fresh page life', JSON.stringify(r));
  const p = G.pegs();
  ok(!!(p && p.load), 'A2 pegs() shows the pickup peg');
  const rec = dayRec(store);
  ok(!!(rec && rec.pegs && rec.pegs.load), 'A3 the day record carries the peg');
  ok(rec && rec.pegs && rec.pegs.load && near(rec.pegs.load, D2L, 30),
     'A4 the peg sits on the site pin (<=30 m)', rec && rec.pegs && JSON.stringify(rec.pegs.load));
})();

/* ---------- B: one rough raw fix must not poison the tap ----------
 * A peg-grade fix lands at the pin; the stream's NEXT raw fix is a
 * rough re-acquisition fix (accuracy 400 m) a few metres over. The
 * tap must plant from the peg-grade fix, not refuse — and never
 * plant at the rough fix's position. */
(function () {
  console.log('B — rough raw fix after a peg-grade fix');
  const store = mkSharedStore({});
  store.set('dsp_active', dsp2());
  const world = mkWorld(store, null);
  const G = world.GeoLoads;
  const drv = mkDriver(world, T0);
  G.startDay('s' + T0, {});
  drv.park(D2L, 60, 8);                       // peg-grade fixes at the pin
  const roughPt = off(D2L.lat, D2L.lng, 120, 0);
  drv.feed(drv.clock.t, roughPt, 400);        // one rough raw fix, 120 m east
  const r = G.setPeg('load');
  ok(r && r.ok === true, 'B1 peg sets despite the rough last raw fix', JSON.stringify(r));
  const rec = dayRec(store);
  ok(rec && rec.pegs && rec.pegs.load && near(rec.pegs.load, D2L, 60),
     'B2 the peg plants at the peg-grade position, not the rough fix',
     rec && rec.pegs && JSON.stringify(rec.pegs.load));
})();

/* ---------- C: the honest refusals survive ----------
 * No position evidence at all -> 'no-fix'. Only rough evidence ->
 * 'rough-fix'. A STALE geo fix (>5 min) is not a position -> the
 * tap still refuses. A ROUGH geo fix is not peg-grade either. */
(function () {
  console.log('C — honest refusals');
  let store = mkSharedStore({}); store.set('dsp_active', dsp2());
  let world = mkWorld(store, null);
  world.GeoLoads.startDay('s' + T0, {});
  let r = world.GeoLoads.setPeg('load');
  ok(r && !r.ok && r.why === 'no-fix', 'C1 no evidence at all -> no-fix', JSON.stringify(r));

  store = mkSharedStore({}); store.set('dsp_active', dsp2());
  world = mkWorld(store, null);
  const drv = mkDriver(world, T0);
  world.GeoLoads.startDay('s' + T0, {});
  drv.feed(0, [D2L.lat, D2L.lng], 400);
  r = world.GeoLoads.setPeg('load');
  ok(r && !r.ok && r.why === 'rough-fix', 'C2 only a rough fix -> rough-fix', JSON.stringify(r));

  store = mkSharedStore({}); store.set('dsp_active', dsp2());
  world = mkWorld(store, { latitude: D2L.lat, longitude: D2L.lng, accuracy: 10, time: Date.now() - 20 * 60 * 1000 });
  world.GeoLoads.startDay('s' + T0, {});
  r = world.GeoLoads.setPeg('load');
  ok(r && !r.ok, 'C3 a stale geo fix (20 min old) does not plant a peg', JSON.stringify(r));

  store = mkSharedStore({}); store.set('dsp_active', dsp2());
  world = mkWorld(store, { latitude: D2L.lat, longitude: D2L.lng, accuracy: 300, time: Date.now() - 30 * 1000 });
  world.GeoLoads.startDay('s' + T0, {});
  r = world.GeoLoads.setPeg('load');
  ok(r && !r.ok, 'C4 a rough geo fix does not plant a peg', JSON.stringify(r));
})();

/* ---------- D: the Nov 13 day end to end — pegs set on the fresh
 * page life, counting runs from them, a re-peg banks the count --- */
(function () {
  console.log('D — the day: morning dispatch, fresh page life at site 2, pegs, cycles, re-peg');
  const store = mkSharedStore({});
  store.set('dsp_active', dsp1());
  /* page life 1: the morning at Aecon Trans — two cycles count */
  let world = mkWorld(store, null);
  let drv = mkDriver(world, T0);
  world.GeoLoads.startDay('s' + T0, {});
  for (let i = 0; i < 2; i++) {
    drv.park(D1L, 300); drv.drive(D1L, D1D, 600); drv.park(D1D, 180); drv.drive(D1D, D1L, 600);
  }
  const morning = dayRec(store);
  ok(morning && morning.count === 2, 'D1 the morning counted 2 on dispatch #1', morning && ('count=' + morning.count));
  world.GeoLoads.stopDay();
  /* dispatch #2 activated; the page life that reaches site 2 is
     fresh — the geo layer holds the truck at the Aecon Inf pin */
  store.set('dsp_active', dsp2());
  world = mkWorld(store, { latitude: D2L.lat, longitude: D2L.lng, accuracy: 12, time: Date.now() - 45 * 1000 });
  drv = mkDriver(world, T0 + 4 * 3600);
  const G = world.GeoLoads;
  G.startDay('s' + T0, {});
  const r1 = G.setPeg('load');
  ok(r1 && r1.ok === true, 'D2 PEG PICKUP sets at site 2 (the reported failure)', JSON.stringify(r1));
  /* the watcher wakes: fixes flow at the pin, he drives to the
     dump face and pegs it there from the live stream */
  drv.park(D2L, 120);
  drv.drive(D2L, D2D, 240);
  drv.park(D2D, 120);
  const r2 = G.setPeg('dump');
  ok(r2 && r2.ok === true && r2.armed === true, 'D3 PEG DUMP sets and the pair arms', JSON.stringify(r2));
  /* run cycles off the pegs */
  drv.drive(D2D, D2L, 240);
  for (let i = 0; i < 2; i++) {
    drv.park(D2L, 240); drv.drive(D2L, D2D, 240); drv.park(D2D, 150); drv.drive(D2D, D2L, 240);
  }
  drv.park(D2L, 120);
  const after = dayRec(store);
  ok(after && after.count >= 3, 'D4 cycles count from the pegs (morning 2 banked + >=1 new)',
     after && ('count=' + after.count));
  ok(after && after.countSource === 'pegs', 'D5 the day is marked counted from pegs',
     after && after.countSource);
  /* a mid-day re-peg of the pickup never resets the count */
  const before = after.count;
  const r3 = G.setPeg('load');
  ok(r3 && r3.ok === true, 'D6 the re-peg sets', JSON.stringify(r3));
  drv.park(D2L, 60);
  const banked = dayRec(store);
  ok(banked && banked.count >= before, 'D7 the re-peg banks the day count (never resets)',
     banked && ('count=' + banked.count + ' vs ' + before));
})();

/* ---------- E: the live stream outranks the geo fallback ----------
 * When the stream holds a peg-grade fix of its own, the peg plants
 * THERE — the geo layer is only the fresh-page-life fallback. */
(function () {
  console.log('E — stream peg-grade fix preferred over the geo fallback');
  const store = mkSharedStore({});
  store.set('dsp_active', dsp2());
  const elsewhere = off(D2L.lat, D2L.lng, 800, 0);
  const world = mkWorld(store, { latitude: elsewhere[0], longitude: elsewhere[1], accuracy: 10, time: Date.now() - 30 * 1000 });
  const G = world.GeoLoads;
  const drv = mkDriver(world, T0);
  G.startDay('s' + T0, {});
  drv.park(D2L, 60, 8);
  const r = G.setPeg('load');
  const rec = dayRec(store);
  ok(r && r.ok === true && rec && rec.pegs && rec.pegs.load && near(rec.pegs.load, D2L, 60),
     'E1 the peg plants at the stream fix, not the geo fallback',
     rec && rec.pegs && JSON.stringify(rec.pegs.load));
})();

console.log('\nPEG-PU-FIX-V450: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
