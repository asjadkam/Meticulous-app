#!/usr/bin/env node
/* v324 suite — the COUNTING FAMILY (owner's law, Nov 5, 2026):
 *   COUNT-BY-DUMP-VISIT: a load counts on each VISIT to the dump
 *     site (arrival after having left); the pickup is bonus
 *     context only, never a required half of a cycle.
 *   SITE-EXTENT: a peg stands for the whole SITE, not a point —
 *     massive sites span kilometres; the site's extent is learned
 *     from where the truck works inside it.
 *   REPEG-RESETS-LOAD-COUNT: re-pegging / re-pinning mid-day
 *     NEVER resets the day's count; the count belongs to the day.
 * Drives the REAL js/geoloads.js glue (v323 rig pattern).
 * Run: node tools/counting-family-v324-test.js
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
const GT0 = new RealDate(2026, 10, 5, 6, 0, 0).getTime();
function gdstr(ts) {
  const d = new RealDate(ts);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const GTODAY = gdstr(GT0);
function goff(lat, lng, eM, nM) { return [lat + nM / 111320, lng + eM / (111320 * Math.cos(lat * Math.PI / 180))]; }
function gpt(base, eM, nM) { const ll = goff(base.lat, base.lng, eM, nM); return { lat: ll[0], lng: ll[1] }; }
const GSTILL = [[0, 0], [15, 10], [-12, 8], [10, -14], [-8, -10]];
function mkFeed(world) {
  return function (tS, ll) { return world.feed({ latitude: ll[0], longitude: ll[1], accuracy: 8, time: GT0 + tS * 1000 }); };
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
  return Object.assign({ id: 'dsp-1', jobSite: 'Aecon', dropoff: '', status: 'active', date: GTODAY, scheduledAt: GTODAY + 'T09:00:00' }, extra || {});
}
function baseData(dsp) {
  return { nav_data: { personal: [{ name: 'Home', lat: GHOME.lat, lng: GHOME.lng }], work: [], recent: [] },
    dsp_list: [dsp], dsp_active: dsp };
}
function pins(dsp, L, D) {
  dsp.lat = L.lat; dsp.lng = L.lng;
  dsp.dumpLat = D.lat; dsp.dumpLng = D.lng;
  return dsp;
}

/* ---------- T1: a LONE dump peg counts visits on its own ----------
   Nov 5 shape: dump pegged 9:40, pickup not until 11:40 — the
   morning must count from the dump peg alone. */
{
  console.log('T1 — lone dump peg arms visit counting');
  const dsp = dspRec();
  const store = mkSharedStore(baseData(dsp));
  const w = mkGeoWorld(store);
  const feed = mkFeed(w); const clock = { t: 0 };
  w.GeoLoads.startDay('s' + GT0, {});
  const D = { lat: 51.100, lng: -113.950 };
  const E = gpt(D, 5000, 0);
  park(feed, clock, D, 150);
  const rp = w.GeoLoads.setPeg('dump', { lat: D.lat, lng: D.lng, label: 'Dump peg' });
  park(feed, clock, D, 120);
  const t1 = w.GeoLoads.today();
  console.log('    after peg + dwell: count=' + t1.count + ' armed=' + t1.armed + ' src=' + t1.countSource);
  ok('T1 lone dump peg arms counting', w.GeoLoads.pegs().armed === true && t1.armed === true);
  ok('T1 sitting at the pegged dump counts the visit in hand', t1.count === 1, 'got ' + t1.count);
  ok('T1 count source is the dump-visit law', t1.countSource === 'dump-visit', 'got ' + t1.countSource);
  drive(feed, clock, D, E, 120); park(feed, clock, E, 90);
  drive(feed, clock, E, D, 120); park(feed, clock, D, 150);
  const t1b = w.GeoLoads.today().count;
  ok('T1 leave and come back = second visit counts', t1b === 2, 'got ' + t1b);
}

/* ---------- T2: dispatch pins — a dump visit counts with NO load visit;
   a return WITHOUT loading does not ---------- */
{
  console.log('T2 — dispatch pins: visit counts standalone; unloaded return does not');
  const L = { lat: 51.100, lng: -114.050 };
  const D = gpt(L, 6000, 0);
  const dsp = pins(dspRec(), L, D);
  const store = mkSharedStore(baseData(dsp));
  const w = mkGeoWorld(store);
  const feed = mkFeed(w); const clock = { t: 0 };
  w.GeoLoads.startDay('s' + GT0, {});
  park(feed, clock, GHOME, 60);
  drive(feed, clock, GHOME, D, 300); park(feed, clock, D, 180);
  const c1 = w.GeoLoads.today();
  console.log('    direct-to-dump: count=' + c1.count + ' src=' + c1.countSource);
  ok('T2 a dump visit counts with NO visit to the load site first', c1.count === 1, 'got ' + c1.count);
  ok('T2 count source is dump-visit', c1.countSource === 'dump-visit', 'got ' + c1.countSource);
  /* drive away (inside span, road speed) and straight back,
     never loading */
  const AWAY = gpt(D, 2000, 1000);
  drive(feed, clock, D, AWAY, 120); park(feed, clock, AWAY, 60);
  drive(feed, clock, AWAY, D, 120); park(feed, clock, D, 150);
  const c2 = w.GeoLoads.today().count;
  ok('T2 coming back WITHOUT loading counts nothing more', c2 === 1, 'got ' + c2);
  /* now the real loop: load, then dump */
  drive(feed, clock, D, L, 300); park(feed, clock, L, 180);
  drive(feed, clock, L, D, 300); park(feed, clock, D, 180);
  const c3 = w.GeoLoads.today().count;
  ok('T2 after loading, the next dump visit counts', c3 === 2, 'got ' + c3);
}

/* ---------- T3: SITE-EXTENT — a massive site: face A, drive 2 km INSIDE
   the site to face B, tip; the visit counts ONCE; the site LEARNS B;
   the next cycle tips at B and counts. ---------- */
{
  console.log('T3 — massive site: in-site move extends, never recounts');
  const L = { lat: 51.100, lng: -114.050 };
  const A = gpt(L, 8000, 0);
  const B = gpt(A, 2000, 0);
  const dsp = pins(dspRec(), L, A);
  const store = mkSharedStore(baseData(dsp));
  const w = mkGeoWorld(store);
  const feed = mkFeed(w); const clock = { t: 0 };
  w.GeoLoads.startDay('s' + GT0, {});
  park(feed, clock, GHOME, 60);
  drive(feed, clock, GHOME, A, 420); park(feed, clock, A, 200);
  const c1 = w.GeoLoads.today().count;
  ok('T3 arrival at face A counts 1', c1 === 1, 'got ' + c1);
  drive(feed, clock, A, B, 240);            /* 2 km at 30 km/h — site-internal */
  park(feed, clock, B, 240);
  const st = w.GeoLoads.status();
  const c2 = w.GeoLoads.today().count;
  console.log('    at face B: count=' + c2 + ' sitePoints=' + (st.counter ? st.counter.points : '?'));
  ok('T3 tipping at a face 2 km inside the same site does NOT recount', c2 === 1, 'got ' + c2);
  ok('T3 the site learned the new face', !!(st.counter && st.counter.points >= 2),
     'points=' + (st.counter && st.counter.points));
  drive(feed, clock, B, L, 600); park(feed, clock, L, 200);
  drive(feed, clock, L, B, 600); park(feed, clock, B, 200);
  const c3 = w.GeoLoads.today().count;
  ok('T3 next cycle tips at the learned face B and counts', c3 === 2, 'got ' + c3);
}

/* ---------- T4: REPEG — the dispatch's pins SWAP roles mid-session
   (Nov 5 exactly): the day's count must survive the re-pin. ---------- */
{
  console.log('T4 — dispatch role-swap mid-session banks the count');
  const L1 = { lat: 51.100, lng: -114.000 };
  const D1 = gpt(L1, 2000, 0);
  const dsp1 = pins(dspRec(), L1, D1);
  const data = baseData(dsp1);
  const store = mkSharedStore(data);
  const w = mkGeoWorld(store);
  const feed = mkFeed(w); const clock = { t: 0 };
  w.GeoLoads.startDay('s' + GT0, {});
  park(feed, clock, L1, 60);
  drive(feed, clock, L1, D1, 120); park(feed, clock, D1, 180);
  drive(feed, clock, D1, L1, 120); park(feed, clock, L1, 180);
  drive(feed, clock, L1, D1, 120); park(feed, clock, D1, 180);
  const before = w.GeoLoads.today().count;
  ok('T4 two visits banked before the swap', before === 2, 'got ' + before);
  const N = gpt(L1, 1000, -800);
  drive(feed, clock, D1, N, 90); park(feed, clock, N, 60);
  /* the sites swap roles: old dump becomes the pickup, old pickup the dump */
  const dsp2 = pins(dspRec({ id: 'dsp-2' }), D1, L1);
  data.dsp_active = dsp2; data.dsp_list = [dsp2];
  park(feed, clock, N, 90);   /* fixes trigger the stale-world reconfigure */
  const after = w.GeoLoads.today().count;
  console.log('    count before swap=' + before + ', after swap=' + after);
  ok('T4 REPEG: the swap does NOT reset the day count', after === 2, 'got ' + after);
  drive(feed, clock, N, L1, 90); park(feed, clock, L1, 180);  /* L1 is the dump now */
  const c3 = w.GeoLoads.today().count;
  ok('T4 a visit to the swapped dump counts on top', c3 === 3, 'got ' + c3);
}

/* ---------- T5: REPEG — moving the DUMP PEG mid-day banks the count ---------- */
{
  console.log('T5 — moving the dump peg banks the count');
  const dsp = dspRec();
  const store = mkSharedStore(baseData(dsp));
  const w = mkGeoWorld(store);
  const feed = mkFeed(w); const clock = { t: 0 };
  w.GeoLoads.startDay('s' + GT0, {});
  const L = { lat: 51.100, lng: -114.000 };
  const D = gpt(L, 600, 0);
  const D2 = gpt(D, 900, 0);
  /* a both-pegs day runs the peg cycle counter (v282/v284
     contract — see the scope note in configure); what the
     counting family demands of it is the REPEG law: the count
     belongs to the day, never to the pegs. */
  park(feed, clock, L, 120);
  w.GeoLoads.setPeg('load', { lat: L.lat, lng: L.lng, label: 'Pit' });
  drive(feed, clock, L, D, 60); park(feed, clock, D, 120);
  w.GeoLoads.setPeg('dump', { lat: D.lat, lng: D.lng, label: 'Dump' });
  drive(feed, clock, D, L, 60); park(feed, clock, L, 150);
  drive(feed, clock, L, D, 60); park(feed, clock, D, 150);
  const c1 = w.GeoLoads.today().count;
  ok('T5 the first pegged cycle counts', c1 === 1, 'got ' + c1);
  drive(feed, clock, D, L, 60); park(feed, clock, L, 150);
  drive(feed, clock, L, D, 60); park(feed, clock, D, 150);
  const c2 = w.GeoLoads.today().count;
  ok('T5 second cycle counts', c2 === 2, 'got ' + c2);
  drive(feed, clock, D, D2, 90); park(feed, clock, D2, 120);
  w.GeoLoads.setPeg('dump', { lat: D2.lat, lng: D2.lng, label: 'Dump moved' });
  const cAfter = w.GeoLoads.today().count;
  console.log('    count at re-peg=' + cAfter);
  ok('T5 REPEG: moving the dump peg keeps the day count', cAfter === 2, 'got ' + cAfter);
  drive(feed, clock, D2, L, 90); park(feed, clock, L, 150);
  drive(feed, clock, L, D2, 90); park(feed, clock, D2, 150);
  const c3 = w.GeoLoads.today().count;
  ok('T5 cycles count from the moved peg', c3 === 3, 'got ' + c3);
}

/* ---------- T6: ONE visit, however long and however it wanders inside
   the site, counts exactly ONE ---------- */
{
  console.log('T6 — one visit = one count, wander-proof');
  const L = { lat: 51.100, lng: -114.050 };
  const D = gpt(L, 3000, 0);
  const dsp = pins(dspRec(), L, D);
  const store = mkSharedStore(baseData(dsp));
  const w = mkGeoWorld(store);
  const feed = mkFeed(w); const clock = { t: 0 };
  w.GeoLoads.startDay('s' + GT0, {});
  park(feed, clock, GHOME, 60);
  drive(feed, clock, GHOME, D, 300); park(feed, clock, D, 1800);
  const c1 = w.GeoLoads.today().count;
  ok('T6 a 30-minute dwell counts exactly 1', c1 === 1, 'got ' + c1);
  const FWD = gpt(D, 100, 0);
  drive(feed, clock, D, FWD, 20); park(feed, clock, FWD, 300);
  const c2 = w.GeoLoads.today().count;
  ok('T6 pulling forward 100 m inside the site adds nothing', c2 === 1, 'got ' + c2);
  const SLIP = gpt(D, 700, 0);
  drive(feed, clock, FWD, SLIP, 30); park(feed, clock, SLIP, 20);
  drive(feed, clock, SLIP, D, 30); park(feed, clock, D, 150);
  const c3 = w.GeoLoads.today().count;
  ok('T6 a brief slip just past the halo and back adds nothing', c3 === 1, 'got ' + c3);
  const M = gpt(D, 2000, 500);
  drive(feed, clock, D, M, 120); park(feed, clock, M, 90);
  drive(feed, clock, M, D, 120); park(feed, clock, D, 180);
  const c4 = w.GeoLoads.today().count;
  ok('T6 out-and-back WITHOUT loading still counts nothing more', c4 === 1, 'got ' + c4);
  drive(feed, clock, D, L, 240); park(feed, clock, L, 180);
  drive(feed, clock, L, D, 240); park(feed, clock, D, 180);
  const c5 = w.GeoLoads.today().count;
  ok('T6 a loaded return counts the second visit', c5 === 2, 'got ' + c5);
}

/* ---------- T7: TEACH path — a learned dump counts under the visit law
   (load-pin-only dispatch: the dump is taught by the driving) ---------- */
{
  console.log('T7 — teach path counts visits');
  const dsp = dspRec();
  dsp.lat = 51.100; dsp.lng = -114.000;   /* load pin only */
  const store = mkSharedStore(baseData(dsp));
  const w = mkGeoWorld(store);
  const feed = mkFeed(w); const clock = { t: 0 };
  w.GeoLoads.startDay('s' + GT0, {});
  const P = { lat: 51.100, lng: -114.000 };
  const X = gpt(P, 2500, 0);
  park(feed, clock, P, 240);
  drive(feed, clock, P, X, 150); park(feed, clock, X, 300);
  const c1 = w.GeoLoads.today().count;
  console.log('    after teaching dwell: count=' + c1);
  ok('T7 the teaching cycle counts its visit', c1 === 1, 'got ' + c1);
  drive(feed, clock, X, P, 150); park(feed, clock, P, 300);
  drive(feed, clock, P, X, 150); park(feed, clock, X, 300);
  const c2 = w.GeoLoads.today().count;
  ok('T7 the next taught-site visit counts', c2 === 2, 'got ' + c2);
}

/* ---------- T8: dump-pin-ONLY dispatch (no load pin at all) ---------- */
{
  console.log('T8 — dump pin only: visits count; a tip-length road stop closes');
  const D = { lat: 51.100, lng: -113.950 };
  const dsp = dspRec();
  dsp.dumpLat = D.lat; dsp.dumpLng = D.lng;
  const store = mkSharedStore(baseData(dsp));
  const w = mkGeoWorld(store);
  const feed = mkFeed(w); const clock = { t: 0 };
  w.GeoLoads.startDay('s' + GT0, {});
  park(feed, clock, GHOME, 60);
  drive(feed, clock, GHOME, D, 300); park(feed, clock, D, 200);
  const c1 = w.GeoLoads.today();
  ok('T8 dump-pin-only day counts the visit', c1.count === 1, 'got ' + c1.count);
  ok('T8 count source is dump-visit', c1.countSource === 'dump-visit', 'got ' + c1.countSource);
  const U = gpt(D, 1500, 0);
  drive(feed, clock, D, U, 90); park(feed, clock, U, 300);   /* the "pit": tip-length stop by road */
  drive(feed, clock, U, D, 90); park(feed, clock, D, 200);
  const c2 = w.GeoLoads.today().count;
  ok('T8 after the loop\'s other end, the return visit counts', c2 === 2, 'got ' + c2);
}

/* ---------- T9: the face MOVES between cycles — the new face's tip is
   PENDING until the loop completes, then it counts ---------- */
{
  console.log('T9 — moved face: pending tip credits when the loop closes');
  const L = { lat: 51.100, lng: -114.050 };
  const D = gpt(L, 4000, 0);
  const F = gpt(D, 1200, 300);
  const dsp = pins(dspRec(), L, D);
  const store = mkSharedStore(baseData(dsp));
  const w = mkGeoWorld(store);
  const feed = mkFeed(w); const clock = { t: 0 };
  w.GeoLoads.startDay('s' + GT0, {});
  park(feed, clock, GHOME, 60);
  drive(feed, clock, GHOME, D, 300); park(feed, clock, D, 200);
  drive(feed, clock, D, L, 300); park(feed, clock, L, 200);
  const c1 = w.GeoLoads.today().count;
  ok('T9 first cycle counts at the seed face', c1 === 1, 'got ' + c1);
  drive(feed, clock, L, F, 300); park(feed, clock, F, 300);
  const cPend = w.GeoLoads.today().count;
  console.log('    at the moved face: count=' + cPend + ' (pending expected)');
  ok('T9 a first dwell at the moved face does NOT count yet (pending)', cPend === 1, 'got ' + cPend);
  drive(feed, clock, F, L, 300); park(feed, clock, L, 200);
  const c2 = w.GeoLoads.today().count;
  ok('T9 completing the loop credits the moved-face tip', c2 === 2, 'got ' + c2);
  drive(feed, clock, L, F, 300); park(feed, clock, F, 200);
  const c3 = w.GeoLoads.today().count;
  ok('T9 the proven face now counts on arrival', c3 === 3, 'got ' + c3);
}

/* ---------- T10: a rival stop on a loaded leg counts nothing; the real
   tip at the known face still counts exactly once ---------- */
{
  console.log('T10 — rival mid-leg stop: no phantom, real tip counts once');
  const L = { lat: 51.100, lng: -114.050 };
  const D = gpt(L, 4000, 0);
  const R = gpt(D, -1500, 200);
  const dsp = pins(dspRec(), L, D);
  const store = mkSharedStore(baseData(dsp));
  const w = mkGeoWorld(store);
  const feed = mkFeed(w); const clock = { t: 0 };
  w.GeoLoads.startDay('s' + GT0, {});
  park(feed, clock, GHOME, 60);
  drive(feed, clock, GHOME, D, 300); park(feed, clock, D, 200);
  drive(feed, clock, D, L, 300); park(feed, clock, L, 200);
  const c1 = w.GeoLoads.today().count;
  ok('T10 first cycle counts', c1 === 1, 'got ' + c1);
  drive(feed, clock, L, R, 240); park(feed, clock, R, 240);
  const cR = w.GeoLoads.today().count;
  ok('T10 the rival stop on the loaded leg counts nothing', cR === 1, 'got ' + cR);
  drive(feed, clock, R, D, 120); park(feed, clock, D, 200);
  const c2 = w.GeoLoads.today().count;
  ok('T10 the real tip at the known face counts exactly once', c2 === 2, 'got ' + c2);
}

console.log('\ncounting-family-v324: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
