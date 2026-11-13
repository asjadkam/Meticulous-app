#!/usr/bin/env node
/* PEG-DUMP-COUNTS (Fri Nov 13, 2026) — the owner's ruling, in his
 * words on the Aecon Inf job that morning: "you will notice there
 * I pegged my dump... And it didn't count a load for me! System
 * should know a new pegging dump site means automatically that I
 * just tipped."
 *
 * His screen recording shows the shape exactly: "Pickup pegged
 * 10:46 AM · Dump pegged 11:10 AM" and "Loads today: 3 — 2 counted
 * from your pegs · +1 your tap". The day was already counting
 * (the morning's Aecon Trans job, counted by GPS); on the second
 * job he pegged his pickup at the pin, loaded, drove to a NEW
 * dump site, tipped, and pressed PEG DUMP — and the count did
 * not move. The peg only re-pointed the counter; the tip he had
 * just performed was invisible to every machine (teach mode had
 * no counter armed, the tip dwell was short, no visit landed).
 *
 * THE RULE (his design law, added Nov 13): on a day that is
 * already counting, planting the dump peg on ground that is NEW
 * for the day — with a loaded leg standing proven under the
 * current load end — IS the tip declaration: one load counts at
 * the peg, on the machine side of the split (his "+1 your tap"
 * stays his). "New" = not within a stop's width (VISIT_CLUSTER_M)
 * of any dump ground the day already knows (the standing dump
 * peg, the live sites' dump end, the outgoing counter's centre /
 * site points / counted dump events, a taught or learned dump).
 *
 * The gates come from the family's own pinned law, and the
 * regression family enforces them: a FIRST plant of the day
 * declares the day's sites and never counts (v282/v284/v421 —
 * "plant both seeds, cycles count from there"), and a plant
 * that merely completes a freshly declared pair has no loaded
 * leg under it (v437's job change) and counts nothing. The
 * peg-count marks the tip counted, so the machines that arm on
 * the new peg must not count the same tip twice — neither the
 * visit counter's standing presence (lone dump peg, counted
 * seed) nor the armed carry a mid-carry dump re-peg hands over
 * under v421 (both-pegs pair, carry suppressed). A genuine
 * VISIT to a known dump site still counts as before; planting
 * the dump peg ON known ground (the dispatch pin, a taught
 * face) counts nothing at the peg; the pickup peg never counts;
 * a dump plant on the pickup peg's own ground (the role-swap
 * shape) never counts; a re-peg never resets the day.
 *
 * Failing-first on web 450 at A3, C7, E4: on 450 the count does
 * not move at the peg in any of them.
 *
 * Run: node tools/peg-dump-counts-v451-test.js
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
function pt(lat, lng, eM, nM) { const o = off(lat, lng, eM || 0, nM || 0); return { lat: o[0], lng: o[1] }; }
const STILL = [[0, 0], [15, 10], [-12, 8], [10, -14], [-8, -10]];

const D1L = { lat: 51.1252222, lng: -113.9828056 };   // Aecon Trans go-empty
const D1D = { lat: 51.1225089, lng: -114.0122197 };   // Aecon Trans hauling-to
const D2L = { lat: 50.990692, lng: -114.030301 };     // Aecon Inf go-empty (only pin)
const D2D = { lat: 50.982000, lng: -114.020000 };     // the Inf dump face, ~1.3 km on
const DC = { lat: 50.971000, lng: -114.028000 };      // a second new dump, ~1.3 km past D2D

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
function mach(store) { const r = dayRec(store); return r ? (r.count || 0) : 0; }

/* The full Nov 13 day up to the Inf tip: the morning job (Aecon
 * Trans, both pins) counts 2 by GPS; dispatch #2 (Aecon Inf, one
 * pin) takes over; he pegs the pickup at its pin, finishes
 * loading under the peg, drives to the Inf dump and tips. The
 * next thing he does is press PEG DUMP. (His real card also
 * carried the morning's +1 tap, reading 3; the bench keeps the
 * split clean and models the machine loads only.) */
function nov13Prologue() {
  const store = mkSharedStore({});
  store.set('dsp_active', dsp1());
  const world = mkWorld(store, null);
  const G = world.GeoLoads;
  const drv = mkDriver(world, T0);
  G.startDay('s' + T0, {});
  for (let i = 0; i < 2; i++) {
    drv.park(D1L, 300); drv.drive(D1L, D1D, 600); drv.park(D1D, 300); drv.drive(D1D, D1L, 600);
  }
  const morning = G.today().count;
  store.set('dsp_active', dsp2());
  drv.drive(D1L, D2L, 300);
  drv.park(D2L, 120);
  const rp = G.setPeg('load');
  drv.park(D2L, 120);                          // loading finishes under the peg
  drv.drive(D2L, D2D, 240);
  drv.park(D2D, 60);                           // the tip — short, no machine proof
  return { store: store, world: world, G: G, drv: drv, rp: rp, morning: morning };
}

/* ---------- A: today's exact shape — the NEW dump peg counts
 * the tip at the peg ---------- */
(function () {
  console.log('A — Nov 13: morning counted 2, peg pickup 10:46, peg dump at the new site 11:10');
  const x = nov13Prologue();
  const G = x.G, drv = x.drv, store = x.store;
  ok(x.morning === 2, 'A0 the morning job counted 2 by GPS', 'morning=' + x.morning);
  ok(x.rp && x.rp.ok === true, 'A1 PEG PICKUP sets at the Inf pin', JSON.stringify(x.rp));
  ok(G.today().count === 2, 'A2 before the peg, no machine counted the Inf tip', 'today=' + G.today().count);
  const r2 = G.setPeg('dump');
  ok(r2 && r2.ok === true && r2.armed === true, 'A3a PEG DUMP sets and the pair arms', JSON.stringify(r2));
  ok(mach(store) === 3 && G.today().count === 3,
     'A3 the NEW dump peg counts the tip at the peg — machine side',
     'rec.count=' + mach(store) + ' today=' + G.today().count);
  ok(G.today().corr === 0, 'A3b the peg-count is not his tap (corr stays 0)', 'corr=' + G.today().corr);
  ok(G.today().countSource === 'pegs', 'A3c the day reads counted from pegs', G.today().countSource);
  drv.park(D2D, 180);                          // he lingers at the dump after pegging
  ok(G.today().count === 3, 'A4 the same visit never counts twice (dwell after the peg)',
     'today=' + G.today().count);
  drv.drive(D2D, D2L, 240); drv.park(D2L, 240);
  drv.drive(D2L, D2D, 240); drv.park(D2D, 180);
  ok(G.today().count === 4, 'A5 the next full cycle counts by the pegs — today=' + G.today().count);
  drv.drive(D2D, D2L, 240); drv.park(D2L, 240);
  drv.drive(D2L, D2D, 240); drv.park(D2D, 180);
  ok(G.today().count === 5, 'A6 cycles keep counting — today=' + G.today().count);
})();

/* ---------- B: re-pegging the SAME dump spot counts nothing and
 * never resets the day ---------- */
(function () {
  console.log('B — same-spot dump re-peg');
  const x = nov13Prologue();
  const G = x.G, drv = x.drv, store = x.store;
  G.setPeg('dump');
  ok(mach(store) === 3, 'B0 setup: the new-site peg counted (2 morning + 1)', 'rec.count=' + mach(store));
  const nearD = pt(D2D.lat, D2D.lng, 15, 0);
  drv.park(nearD, 30);
  const r = G.setPeg('dump');                  // re-peg, 15 m over — the same spot
  ok(r && r.ok === true, 'B1 the re-peg itself still sets', JSON.stringify(r));
  drv.park(nearD, 60);
  ok(mach(store) === 3 && G.today().count === 3,
     'B2 the same-spot re-peg counts nothing and the day does not reset',
     'rec.count=' + mach(store) + ' today=' + G.today().count);
  drv.drive(nearD, D2L, 240); drv.park(D2L, 120);
  const rp = G.setPeg('load');                 // pickup re-peg at the same pickup
  ok(rp && rp.ok === true && G.today().count === 3,
     'B3 a pickup re-peg never counts either', 'today=' + G.today().count);
})();

/* ---------- C: a LONE dump peg — the first plant of the day
 * declares (no count), visits count by the visit law, and a
 * later plant at a NEW lone site, on a counting day after a
 * working leg, counts the tip ---------- */
(function () {
  console.log('C — lone dump peg: declaration, visits, then a new-site plant');
  const store = mkSharedStore({});
  const world = mkWorld(store, null);
  const G = world.GeoLoads;
  const drv = mkDriver(world, T0);
  const D = { lat: 51.050000, lng: -114.060000 };
  const D2 = { lat: 51.065000, lng: -114.045000 };
  const L = { lat: 51.080000, lng: -114.100000 };
  G.startDay('s' + T0, {});
  drv.park(D, 60);                             // tipped, nothing armed
  ok(G.today().count === 0, 'C1 nothing counts before the peg', 'today=' + G.today().count);
  const r = G.setPeg('dump');
  ok(r && r.ok === true, 'C2a the lone dump peg sets', JSON.stringify(r));
  ok(mach(store) === 0 && G.today().count === 0,
     'C2 the FIRST plant of the day declares the site — it does not count',
     'rec.count=' + mach(store) + ' today=' + G.today().count);
  drv.park(D, 240);                            // the standing visit, counted by the visit law
  ok(G.today().count === 1, 'C3 the visit counts by dwell, as before', 'today=' + G.today().count);
  drv.drive(D, L, 300); drv.park(L, 180);      // away — the visit closes
  drv.drive(L, D, 300); drv.park(D, 240);      // a genuine second visit
  ok(G.today().count === 2, 'C4 the next genuine visit counts — today=' + G.today().count);
  const r2 = G.setPeg('dump');                 // re-peg the same spot mid-visit
  ok(r2 && r2.ok === true && G.today().count === 2,
     'C5 the re-peg itself counts nothing and resets nothing', 'today=' + G.today().count);
  drv.drive(D, L, 300); drv.park(L, 120);      // straight off — the visit closes
  ok(G.today().count === 2, 'C5b the day stands after the re-peg', 'today=' + G.today().count);
  drv.drive(L, D, 300); drv.park(D, 240);
  ok(G.today().count === 3, 'C5c visits keep counting after a re-peg', 'today=' + G.today().count);
  drv.drive(D, L, 300); drv.park(L, 180);      // loaded again at the far end
  drv.drive(L, D2, 300); drv.park(D2, 60);     // a tip at a NEW dump, unproven
  ok(G.today().count === 3, 'C6 the new-site tip alone proves nothing yet', 'today=' + G.today().count);
  const r3 = G.setPeg('dump');                 // he pegs the new dump
  ok(r3 && r3.ok === true, 'C7a the new lone peg sets', JSON.stringify(r3));
  ok(mach(store) === 4 && G.today().count === 4,
     'C7 on a counting day, the NEW lone dump peg counts the tip',
     'rec.count=' + mach(store) + ' today=' + G.today().count);
  drv.park(D2, 240);                           // lingering at the new dump after the peg
  ok(G.today().count === 4, 'C8 the armed visit counter does not recount the same visit',
     'today=' + G.today().count);
  drv.drive(D2, L, 300); drv.park(L, 180);
  drv.drive(L, D2, 300); drv.park(D2, 240);
  ok(G.today().count === 5, 'C9 the next genuine visit at the new site counts', 'today=' + G.today().count);
})();

/* ---------- D: PEG DUMP planted ON the dispatch dump pin —
 * known ground: nothing at the peg, the visit counts by dwell
 * exactly as web 450 ---------- */
(function () {
  console.log('D — dump peg on the dispatch pin');
  const store = mkSharedStore({});
  store.set('dsp_active', dsp1());
  const world = mkWorld(store, null);
  const G = world.GeoLoads;
  const drv = mkDriver(world, T0);
  G.startDay('s' + T0, {});
  drv.park(D1L, 240);
  drv.drive(D1L, D1D, 600);
  drv.park(D1D, 240);                          // the visit lands by dwell
  ok(G.today().count === 1, 'D1 the visit counts by dwell', 'today=' + G.today().count);
  const r = G.setPeg('dump');                  // he pegs the dump — standing on the pin
  ok(r && r.ok === true, 'D2 the peg sets on the pin', JSON.stringify(r));
  ok(G.today().count === 1, 'D3 known ground: the peg counts nothing', 'today=' + G.today().count);
  drv.drive(D1D, D1L, 600); drv.park(D1L, 240);
  drv.drive(D1L, D1D, 600); drv.park(D1D, 240);
  /* On web 450 this exact sequence reads 3: the mid-visit re-arm
     lands the standing presence at the load-end close, then the
     return visit counts — pre-existing re-arm behaviour on a
     path where the peg-count rule does not fire. The rule must
     leave no-fire paths byte-for-byte alone, so the number is
     asserted exactly. */
  ok(G.today().count === 3, 'D4 the no-fire path is untouched (450 reads 3 here too)',
     'today=' + G.today().count);
})();

/* ---------- E: mid-carry dump re-peg to a NEW site — the peg
 * counts the tip, and the v421 armed carry must not count the
 * same tip again on the dwell that follows ---------- */
(function () {
  console.log('E — armed carry, dump peg moved to a new site');
  const x = nov13Prologue();
  const G = x.G, drv = x.drv, store = x.store;
  G.setPeg('dump');
  ok(mach(store) === 3, 'E1 setup: the Inf peg counted (2 morning + 1)', 'rec.count=' + mach(store));
  drv.drive(D2D, D2L, 240); drv.park(D2L, 240);   // loaded again — the pair is armed
  drv.drive(D2L, DC, 240);
  drv.park(DC, 20);                                // a fast tip at the new site
  ok(G.today().count === 3, 'E2 the fast tip alone proves nothing to the machines',
     'today=' + G.today().count);
  const r = G.setPeg('dump');                      // the dump peg MOVES to the new site
  ok(r && r.ok === true, 'E3 the moved peg sets', JSON.stringify(r));
  ok(mach(store) === 4 && G.today().count === 4,
     'E4 the moved peg counts the tip at the peg', 'rec.count=' + mach(store) + ' today=' + G.today().count);
  drv.park(DC, 240);                               // he stays at the new dump a while
  ok(G.today().count === 4, 'E5 the handed-over carry does not count the same tip twice',
     'today=' + G.today().count);
  drv.drive(DC, D2L, 240); drv.park(D2L, 240);
  drv.drive(D2L, DC, 240); drv.park(DC, 180);
  ok(G.today().count === 5, 'E6 cycles count on the new pair', 'today=' + G.today().count);
})();

/* ---------- F: a dump plant on the pickup peg's own ground is
 * the role declaration, never a tip ---------- */
(function () {
  console.log('F — dump peg planted on the pickup ground');
  const store = mkSharedStore({});
  store.set('dsp_active', dsp2());
  const world = mkWorld(store, null);
  const G = world.GeoLoads;
  const drv = mkDriver(world, T0);
  G.startDay('s' + T0, {});
  drv.park(D2L, 300);
  G.setPeg('load');
  const r = G.setPeg('dump');                  // standing at the pickup, pegging "dump"
  const rec = dayRec(store);
  ok(r && r.ok === true && !!(rec && rec.pegs && rec.pegs.dump),
     'F1 the plant itself still lands (the swap shape)', JSON.stringify(r));
  ok(mach(store) === 0 && G.today().count === 0,
     'F2 a dump plant on the pickup ground counts nothing', 'today=' + G.today().count);
})();

/* ---------- G: a dump peg planted on a TAUGHT face (his +1
 * already counted that tip and taught the spot) counts nothing
 * at the peg — the spot is known ground. The moved-face tip is
 * the 436 creep: the truck works back and forth across the face
 * while it tips, so no stop-cluster ages and no presence builds
 * — the machine genuinely misses it. ---------- */
(function () {
  console.log('G — dump peg on the +1-taught face');
  const store = mkSharedStore({});
  store.set('dsp_active', dsp1());
  const world = mkWorld(store, null);
  const G = world.GeoLoads;
  const drv = mkDriver(world, T0);
  const M1 = pt(D1D.lat, D1D.lng, 0, -300);    // the moved face, ~300 m south of the pin
  const M2 = pt(D1D.lat, D1D.lng, 150, -300);  // its second working spot, 150 m east
  G.startDay('s' + T0, {});
  drv.park(D1L, 300); drv.drive(D1L, D1D, 600); drv.park(D1D, 300);
  ok(mach(store) === 1, 'G1 the pin-face tip counts by GPS', 'rec.count=' + mach(store));
  drv.drive(D1D, D1L, 600); drv.park(D1L, 240);
  drv.drive(D1L, M1, 600);
  for (let k = 0; k < 12; k++) {               // the creep tip: back and forth, no cluster ages
    drv.feed(drv.clock.t, [M1.lat, M1.lng]); drv.clock.t += 10;
    drv.feed(drv.clock.t, [M2.lat, M2.lng]); drv.clock.t += 10;
  }
  drv.park(M2, 30);                            // settle on M2 — the tap's fix is here
  ok(G.today().count === 1, 'G2 the moved-face tip is missed by the machine', 'today=' + G.today().count);
  G.nudge(1);                                  // his +1 teaches the face
  ok(G.today().count === 2 && G.today().corr === 1,
     'G3 his tap counts it and teaches the spot', 'today=' + G.today().count + ' corr=' + G.today().corr);
  const r = G.setPeg('dump');                  // now he pegs the dump — on the taught face
  ok(r && r.ok === true, 'G4 the peg sets on the taught face', JSON.stringify(r));
  ok(mach(store) === 1 && G.today().count === 2,
     'G5 known ground: the peg adds nothing (no double count with his tap)',
     'rec.count=' + mach(store) + ' today=' + G.today().count);
  drv.drive(M2, D1L, 600); drv.park(D1L, 240);
  ok(G.today().count === 2, 'G6 the load-end close changes nothing — the tap stands',
     'today=' + G.today().count);
  drv.drive(D1L, M2, 600); drv.park(M2, 300);
  /* On web 450 this exact sequence also reads mach=3, corr=0:
     the peg's mid-visit re-arm lands the standing presence at
     the load-end close (retiring the tap), then the return visit
     counts — pre-existing re-arm behaviour on a path where the
     peg-count rule does not fire. The day total is the same 3,
     each load read once; the rule must leave no-fire paths
     exactly as they were, so the numbers are asserted exactly. */
  ok(mach(store) === 3 && G.today().count === 3 && G.today().corr === 0,
     'G7 the no-fire path is untouched (450 reads the same 3 here)',
     'mach=' + mach(store) + ' today=' + G.today().count + ' corr=' + G.today().corr);
})();

console.log('\nPEG-DUMP-COUNTS-V451: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
