#!/usr/bin/env node
/* Meticulous v300 — LOADS FENCE RECOVERY (owner, Oct 31, 2026).
 * The peg engine's centres drifted ONLY on counted events, so one
 * missed dump at a moving tip face stranded every later dump
 * (Oct 31: dumps counted 9:36 + 10:38, the face moved, the 12:27
 * cycle's dump never registered, the strict cycle masked load 4).
 * The recovery: while CARRYING, a sustained stop-cluster near-but-
 * outside the dump fence nudges the centre (bounded, gated) —
 * counting itself stays the zone machine's verdict.
 * Fixtures drive the REAL engine (GeoLoads._engine.createPegCounter)
 * plus one full-glue day at a FIXED face (Oct 30's shape):
 *   (r1) the Oct 31 shape: face jumps +85 m after 2 counted dumps
 *        -> recovery nudges fire, all 4 cycles count
 *   (r2) guards: not-carrying park near the fence moves nothing;
 *        a carrying park nearer the LOAD centre / beyond the band
 *        moves nothing; a drive-past builds no cluster
 *   (r3) the recovery count rides the snapshot and a re-begin
 *        restores it (the drift survives a relaunch)
 *   (r4) glue day at a fixed face, 17 cycles: 17 counted and
 *        ZERO recovery nudges (Oct 30 behaviour untouched)
 * Run: node tools/geoloads-recovery-v300-test.js */
'use strict';
const fs = require('fs'); const vm = require('vm'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'geoloads.js'), 'utf8');
let pass = 0, fail = 0;
function ok(cond, name, extra) { if (cond) { pass++; console.log('  ok - ' + name); } else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? ' — ' + extra : '')); } }

function mkWorld(storeData) {
  const data = storeData || {};
  const store = {
    get: function (k, d) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : d; },
    set: function (k, v) { data[k] = JSON.parse(JSON.stringify(v)); },
    _data: data
  };
  const sb = { console: console, Date: Date, Math: Math, JSON: JSON };
  sb.window = sb;
  let handler = null;
  sb.LiveMiles = { available: function () { return true; }, subscribe: function (fn) { handler = fn; } };
  sb.App = { _store: store };
  vm.createContext(sb);
  vm.runInContext(src, sb);
  return { GeoLoads: sb.GeoLoads, feed: function (fix) { return handler(fix); }, store: store };
}
function off(lat, lng, eM, nM) { return [lat + nM / 111320, lng + eM / (111320 * Math.cos(lat * Math.PI / 180))]; }
function pt(base, eM, nM) { const ll = off(base.lat, base.lng, eM, nM); return { lat: ll[0], lng: ll[1] }; }
const STILL = [[0, 0], [6, 4], [-5, 3], [3, -6], [-4, -4]];
/* a counter rig: fixes every 5 s */
function rig(load, dump) {
  const w = mkWorld({});
  const c = w.GeoLoads._engine.createPegCounter({ load: load, dump: dump });
  c.begin('sess', null);
  const clock = { t: 1700000000000 };
  function feed(ll) { c.ingest({ latitude: ll[0], longitude: ll[1], accuracy: 8, time: clock.t }); clock.t += 5000; }
  function park(center, durS) {
    const steps = Math.floor(durS / 5);
    for (let k = 0; k <= steps; k++) { const s = STILL[k % STILL.length]; feed(off(center.lat, center.lng, s[0], s[1])); }
  }
  function drive(A, B, durS) {
    const steps = Math.floor(durS / 5);
    for (let k = 1; k <= steps; k++) { const f = k / steps; feed([A.lat + (B.lat - A.lat) * f, A.lng + (B.lng - A.lng) * f]); }
  }
  return { c: c, park: park, drive: drive, w: w };
}
const L0 = { lat: 50.969, lng: -114.034 };
const D0 = pt(L0, 300, 0);
function cycle(r, Lk, Dk, from) {
  r.drive(from, Lk, 60); r.park(Lk, 90);
  r.drive(Lk, Dk, 60); r.park(Dk, 120);
  return Dk;
}

console.log('(r1) — OCT 31 SHAPE: the tip face jumps +85 m after two counted dumps');
{
  const r = rig(L0, D0);
  let cur = cycle(r, L0, D0, L0);
  cur = cycle(r, L0, D0, cur);
  ok(r.c.count() === 2, 'r1 the two fixed-face cycles count', 'count=' + r.c.count());
  const D2 = pt(D0, 0, 85); /* the face moves 85 m north — outside the 70 m fence */
  cur = cycle(r, L0, D2, cur);
  cur = cycle(r, L0, D2, cur);
  ok(r.c.count() === 4, 'r1 all 4 cycles count after the face moves (recovery)', 'count=' + r.c.count());
  const snap = r.c.snapshot();
  ok(snap && snap.pegRecovery >= 1, 'r1 recovery nudges fired and ride the snapshot', 'pegRecovery=' + (snap && snap.pegRecovery));
  const cen = r.c.centres();
  const dEnd = r.w.GeoLoads._engine.haversineM(cen.dump.lat, cen.dump.lng, D2.lat, D2.lng);
  ok(dEnd <= 70, 'r1 the dump centre ends within its own fence of the moved face', 'dist=' + Math.round(dEnd));
}

console.log('(r2) — GUARDS: no free drift');
{
  /* not carrying: park 120 s at 120 m from the dump centre */
  const r = rig(L0, D0);
  const before = r.c.centres().dump;
  r.park(pt(D0, 0, 120), 120);
  const after = r.c.centres().dump;
  ok(r.w.GeoLoads._engine.haversineM(before.lat, before.lng, after.lat, after.lng) < 1,
    'r2 a park while NOT carrying moves the dump centre by nothing');
  ok(r.c.snapshot().pegRecovery === 0, 'r2 no nudges while not carrying');
}
{
  /* carrying, but the stop is nearer the LOAD centre (back at the
     pit without dumping): the honesty gate must refuse the nudge */
  const r = rig(L0, D0);
  r.park(L0, 90);                       /* arm at the pile */
  r.drive(L0, pt(L0, -60, 0), 30);      /* roll 60 m past the pile, away from the dump */
  const before = r.c.centres().dump;
  r.park(pt(L0, -60, 0), 120);
  const after = r.c.centres().dump;
  ok(r.w.GeoLoads._engine.haversineM(before.lat, before.lng, after.lat, after.lng) < 1,
    'r2 a carrying stop nearer the load centre never drags the dump centre');
  ok(r.c.snapshot().pegRecovery === 0, 'r2 no nudges from the wrong face');
}
{
  /* carrying drive-past: pass 100 m from the dump centre and
     keep rolling back to the pile — no stop, no cluster */
  const r = rig(L0, D0);
  r.park(L0, 90);
  const before = r.c.centres().dump;
  r.drive(L0, pt(D0, 0, 100), 60);
  r.drive(pt(D0, 0, 100), L0, 60);
  r.park(L0, 60);
  const after = r.c.centres().dump;
  ok(r.w.GeoLoads._engine.haversineM(before.lat, before.lng, after.lat, after.lng) < 1,
    'r2 a drive-past at 100 m builds no cluster and moves nothing');
  ok(r.c.snapshot().pegRecovery === 0, 'r2 no nudges from a drive-past');
}

console.log('(r3) — SNAPSHOT: the recovery count survives a re-begin');
{
  const r = rig(L0, D0);
  let cur = cycle(r, L0, D0, L0);
  cur = cycle(r, L0, pt(D0, 0, 85), cur);
  const snap = r.c.snapshot();
  const w2 = mkWorld({});
  const c2 = w2.GeoLoads._engine.createPegCounter({ load: L0, dump: D0 });
  snap.sitesKey = 'sess';
  c2.begin('sess', snap);
  ok(c2.snapshot().pegRecovery === snap.pegRecovery && snap.pegRecovery >= 1,
    'r3 pegRecovery restores through begin()', 'before=' + snap.pegRecovery + ' after=' + c2.snapshot().pegRecovery);
}

console.log('(r4) — GLUE DAY, FIXED FACE (Oct 30 shape): 17 cycles');
{
  const NOW = new Date();
  const T0 = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 6, 0, 0).getTime();
  const dstr = function (ts) { const d = new Date(ts); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
  const TODAY = dstr(T0);
  const HOME = { lat: 51.15709, lng: -113.93862 };
  const dsp = { id: 'dsp-aecon', jobSite: 'Aecon Inf', dropoff: '', status: 'active', date: TODAY, scheduledAt: TODAY + 'T08:00:00' };
  const data = { nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] }, dsp_list: [dsp], dsp_active: dsp };
  const w = mkWorld(data);
  const clock = { t: 0 };
  function feed(ll) { w.feed({ latitude: ll[0], longitude: ll[1], accuracy: 8, time: T0 + clock.t * 1000 }); }
  function park(center, durS) { const steps = Math.floor(durS / 10); for (let k = 0; k <= steps; k++) { const s = STILL[k % STILL.length]; feed(off(center.lat, center.lng, s[0], s[1])); clock.t += 10; } }
  function drive(A, B, durS) { const steps = Math.floor(durS / 10); for (let k = 1; k <= steps; k++) { const f = k / steps; feed([A.lat + (B.lat - A.lat) * f, A.lng + (B.lng - A.lng) * f]); clock.t += 10; } }
  w.GeoLoads.startDay('s' + T0, {});
  park(L0, 120); const rp = w.GeoLoads.setPeg('load');
  drive(L0, D0, 120); park(D0, 120); const rd = w.GeoLoads.setPeg('dump');
  ok(rp && rp.ok && rd && rd.ok, 'r4 seeds land');
  let cur = D0;
  for (let k = 0; k < 17; k++) {
    drive(cur, L0, 90); park(L0, 150);
    drive(L0, D0, 90); park(D0, 150);
    cur = D0;
  }
  const t = w.GeoLoads.today();
  ok(t.count === 17, 'r4 fixed face still counts 17/17', 'count=' + t.count);
  const fd = w.GeoLoads.forDate(TODAY);
  const recN = (fd && fd.state && fd.state.pegRecovery) || 0;
  ok(recN === 0, 'r4 zero recovery nudges on a fixed-face day', 'pegRecovery=' + recN);
}

console.log('\ngeoloads-recovery-v300: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
