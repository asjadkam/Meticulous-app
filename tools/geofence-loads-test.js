#!/usr/bin/env node
/* Meticulous v50 — geofence load counting: behavioral tests against
 * the REAL shipped engine. The GEOLOADS-ENGINE region of
 * js/geoloads.js is sliced out verbatim and driven with simulated
 * GPS traces (Calgary-area coordinates, fixes in the geo.js shape).
 * Run: node tools/geofence-loads-test.js
 *
 * Covers the owner's Oct 14 spec:
 *  (a) 3 clean load->dump cycles = 3 loads, events timestamped
 *  (b) 20 minutes of movement WITHIN the load site = 0 loads
 *      (intra-site moves create no fake locations/loads); wild
 *      bad-accuracy fixes near the dump site are ignored outright
 *  (c) two sites 300 m apart sharing one street address still count
 *      cycles by COORDINATES (the engine never sees an address);
 *      the midpoint between them is genuinely "out"
 *  (d) fence-edge jitter (in/out every 5 s) registers no arrival and
 *      no departure — no double count
 *  (e) a dump arrival with no prior load-site visit = 0 loads
 *  (f) snapshot/restore mid-cycle (app relaunch): the armed state and
 *      count survive; the restored counter still counts the dump
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'geoloads.js'), 'utf8');

function extract(s, beginMark, endMark) {
  const a = s.lastIndexOf('/*', s.indexOf(beginMark));
  const b = s.indexOf('*/', s.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return s.slice(a, b + 2);
}
const code = extract(src, 'GEOLOADS-ENGINE-BEGIN', 'GEOLOADS-ENGINE-END');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const E = sandbox.ENGINE;
if (!E || typeof E.createGeoLoadCounter !== 'function') throw new Error('engine not extracted');

/* ---------- trace helpers ---------- */
const T0 = 1760455200000; // fixed epoch (2026-10-14 ~08:00 MDT)
function off(lat, lng, eM, nM) {
  return [lat + nM / 111320, lng + eM / (111320 * Math.cos(lat * Math.PI / 180))];
}
function mkFix(tS, ll, acc) {
  return { latitude: ll[0], longitude: ll[1], accuracy: (acc === undefined ? 8 : acc), time: T0 + tS * 1000 };
}
function site(eM, nM) { const ll = off(51.05, -114.07, eM, nM); return { lat: ll[0], lng: ll[1] }; }
function llOf(s) { return [s.lat, s.lng]; }

/* feed fixes while parked at center for durS seconds (step stepS),
   wandering by the given meter-offsets (intra-site movement) */
const WANDER = [[0, 0], [30, 20], [-40, 10], [60, -30], [-20, -50], [80, 40], [10, -15], [-70, -25]];
function stay(c, clock, center, durS, stepS) {
  const steps = Math.floor(durS / stepS);
  for (let k = 0; k <= steps; k++) {
    const w = WANDER[k % WANDER.length];
    const ll = off(center[0], center[1], w[0], w[1]);
    c.ingest(mkFix(clock.t, ll));
    clock.t += stepS;
  }
}
/* feed fixes while driving straight from A to B over durS seconds */
function drive(c, clock, A, B, durS, stepS) {
  const steps = Math.floor(durS / stepS);
  let lastZone = null;
  for (let k = 1; k <= steps; k++) {
    const f = k / steps;
    const ll = [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f];
    const r = c.ingest(mkFix(clock.t, ll));
    lastZone = r.zone;
    clock.t += stepS;
  }
  return lastZone;
}
/* jitter: alternate between two points every stepS seconds */
function jitter(c, clock, P, Q, durS, stepS) {
  const steps = Math.floor(durS / stepS);
  for (let k = 0; k <= steps; k++) {
    c.ingest(mkFix(clock.t, k % 2 ? Q : P));
    clock.t += stepS;
  }
}

/* ---------- assertions ---------- */
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok - ' + name); }
  else { fail++; console.log('  FAIL - ' + name); }
}

/* ================= (a) 3 clean cycles ================= */
console.log('(a) 3 clean load->dump cycles');
{
  const LOAD = site(0, 0), DUMP = site(2200, 800);
  const c = E.createGeoLoadCounter({ load: LOAD, dump: DUMP });
  c.begin('test-a', null);
  const clock = { t: 0 };
  for (let cyc = 1; cyc <= 3; cyc++) {
    stay(c, clock, llOf(LOAD), 70, 10);
    ok(c.phase() === 'at-load', 'cycle ' + cyc + ': confirmed at load site');
    drive(c, clock, llOf(LOAD), llOf(DUMP), 240, 10);
    stay(c, clock, llOf(DUMP), 70, 10);
    ok(c.count() === cyc, 'cycle ' + cyc + ': count = ' + cyc);
    if (cyc < 3) {
      drive(c, clock, llOf(DUMP), llOf(LOAD), 240, 10);
    }
  }
  const evs = c.events();
  ok(evs.length === 3, '3 dump events recorded');
  ok(evs.every(function (e, i) { return e.site === 'dump' && e.n === i + 1; }), 'events numbered 1..3 at the dump site');
  ok(evs[0].t < evs[1].t && evs[1].t < evs[2].t, 'event timestamps increase');
  ok(evs.every(function (e) { return e.t > T0; }), 'event timestamps are real fix times');
}

/* ================= (b) 20 min inside the load site ================= */
console.log('(b) intra-site movement = 0 loads');
{
  const LOAD = site(0, 0), DUMP = site(2200, 800);
  const c = E.createGeoLoadCounter({ load: LOAD, dump: DUMP });
  c.begin('test-b', null);
  const clock = { t: 0 };
  // 20 minutes wandering inside the pit (<= ~110 m from the pin)
  const WIDE = [[0, 0], [100, 45], [-95, 60], [60, -90], [-110, -20], [40, 100], [-30, -105], [105, -55]];
  for (let k = 0; k <= 80; k++) {
    const w = WIDE[k % WIDE.length];
    const ll = off(LOAD.lat, LOAD.lng, w[0], w[1]);
    c.ingest(mkFix(clock.t, ll));
    clock.t += 15;
    // three wild bad-accuracy "fixes" apparently at the dump site —
    // accuracy 300 m: the engine must ignore them entirely
    if (k === 20 || k === 45 || k === 70) {
      const r = c.ingest(mkFix(clock.t, llOf(DUMP), 300));
      ok(r.accepted === false && r.why === 'accuracy', 'bad-accuracy dump fix ignored (k=' + k + ')');
    }
  }
  ok(c.count() === 0, 'no loads counted for intra-site movement');
  ok(c.zone() === 'load' && c.phase() === 'at-load', 'still confirmed at the load site');
}

/* ================= (c) sites 300 m apart, one address ================= */
console.log('(c) two sites 300 m apart, same street address');
{
  const LOAD = site(0, 0), DUMP = site(300, 0);
  const chk = E.sitesCheck(LOAD, DUMP);
  ok(chk.ok === true, 'sitesCheck passes for a 300 m pair');
  ok(Math.abs(chk.sep - 300) < 5, 'separation measured by coordinates (~300 m), got ' + Math.round(chk.sep));
  ok(E.sitesCheck(LOAD, site(150, 0)).ok === false, 'a 150 m pair is rejected as too close');
  const c = E.createGeoLoadCounter({ load: LOAD, dump: DUMP });
  c.begin('test-c', null);
  const clock = { t: 0 };
  let sawOutMidway = false;
  for (let cyc = 1; cyc <= 2; cyc++) {
    stay(c, clock, llOf(LOAD), 70, 5);
    // short hop: 25 m steps, 5 s apart — the "out" gap between the
    // fences lasts only ~15 s, under the 30 s departure dwell
    for (let x = 25; x <= 300; x += 25) {
      const ll = off(LOAD.lat, LOAD.lng, x, 0);
      const r = c.ingest(mkFix(clock.t, ll));
      if (x === 150) { sawOutMidway = sawOutMidway || (r.zone === 'out'); }
      clock.t += 5;
    }
    ok(sawOutMidway, 'cycle ' + cyc + ': midpoint fix is genuinely OUT of both fences');
    stay(c, clock, llOf(DUMP), 70, 5);
    ok(c.count() === cyc, 'cycle ' + cyc + ': counted despite the short hop');
    if (cyc < 2) {
      for (let x = 275; x >= 0; x -= 25) {
        const ll = off(LOAD.lat, LOAD.lng, x, 0);
        c.ingest(mkFix(clock.t, ll));
        clock.t += 5;
      }
    }
  }
  ok(c.count() === 2, 'two cycles counted by coordinates alone');
}

/* ================= (d) fence-edge jitter ================= */
console.log('(d) fence-edge jitter = no arrival, no departure, no double count');
{
  const LOAD = site(0, 0), DUMP = site(2200, 800);
  const c = E.createGeoLoadCounter({ load: LOAD, dump: DUMP });
  c.begin('test-d', null);
  const clock = { t: 0 };
  const inL = off(LOAD.lat, LOAD.lng, 60, 0);    // 60 m inside the load fence
  const outL = off(LOAD.lat, LOAD.lng, 160, 0); // 160 m out, same ray
  jitter(c, clock, inL, outL, 60, 5);
  ok(c.phase() === 'away' && c.zone() === 'out', 'edge jitter never registers a load-site arrival');
  stay(c, clock, llOf(LOAD), 70, 10);
  ok(c.phase() === 'at-load', 'stable presence registers the arrival');
  drive(c, clock, llOf(LOAD), llOf(DUMP), 240, 10);
  const inD = off(DUMP.lat, DUMP.lng, 100, 0);
  const outD = off(DUMP.lat, DUMP.lng, 170, 0);
  jitter(c, clock, inD, outD, 40, 5);
  ok(c.count() === 0, 'edge jitter at the dump site counts nothing');
  stay(c, clock, llOf(DUMP), 70, 10);
  ok(c.count() === 1, 'stable dump presence counts exactly one load');
  jitter(c, clock, inD, outD, 30, 5);
  ok(c.count() === 1 && c.zone() === 'dump', 'post-count edge jitter: no departure, no double count');
}

/* ================= (e) dump first, no load visit ================= */
console.log('(e) dump arrival without a prior load-site visit = 0');
{
  const LOAD = site(0, 0), DUMP = site(2200, 800);
  const c = E.createGeoLoadCounter({ load: LOAD, dump: DUMP });
  c.begin('test-e', null);
  const clock = { t: 0 };
  stay(c, clock, llOf(DUMP), 70, 10);
  ok(c.phase() === 'at-dump' && c.count() === 0, 'at the dump site, unarmed: 0 loads');
  const AWAY = off(LOAD.lat, LOAD.lng, -1500, -1500);
  drive(c, clock, llOf(DUMP), AWAY, 180, 10); // off somewhere else entirely
  drive(c, clock, AWAY, llOf(DUMP), 180, 10);
  stay(c, clock, llOf(DUMP), 70, 10);
  ok(c.count() === 0, 'returning to the dump still counts nothing (never loaded)');
  // sanity: the same counter counts once it has genuinely loaded
  drive(c, clock, llOf(DUMP), llOf(LOAD), 240, 10);
  stay(c, clock, llOf(LOAD), 70, 10);
  drive(c, clock, llOf(LOAD), llOf(DUMP), 240, 10);
  stay(c, clock, llOf(DUMP), 70, 10);
  ok(c.count() === 1, 'after a real load-site visit, the next dump counts');
}

/* ================= (f) snapshot / restore ================= */
console.log('(f) relaunch restore');
{
  const LOAD = site(0, 0), DUMP = site(2200, 800);
  const c1 = E.createGeoLoadCounter({ load: LOAD, dump: DUMP });
  c1.begin('test-f', null);
  const clock = { t: 0 };
  stay(c1, clock, llOf(LOAD), 70, 10);
  const MID = [(LOAD.lat + DUMP.lat) / 2, (LOAD.lng + DUMP.lng) / 2];
  drive(c1, clock, llOf(LOAD), MID, 120, 10); // halfway there, then "killed"
  const snap = c1.snapshot();
  const c2 = E.createGeoLoadCounter({ load: LOAD, dump: DUMP });
  c2.begin('test-f', snap);
  ok(c2.phase() === 'to-dump', 'restored counter keeps the en-route phase');
  drive(c2, clock, MID, llOf(DUMP), 120, 10);
  stay(c2, clock, llOf(DUMP), 70, 10);
  ok(c2.count() === 1, 'restored counter counts the dump arrival');
  // a snapshot from a DIFFERENT site pair must not restore
  const c3 = E.createGeoLoadCounter({ load: LOAD, dump: DUMP });
  c3.begin('other-sites', snap);
  ok(c3.count() === 0 && c3.phase() === 'away', 'foreign snapshot is ignored');
}

console.log('\ngeofence-loads: ' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
