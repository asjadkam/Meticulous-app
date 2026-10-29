#!/usr/bin/env node
/* Meticulous — PEGS-SEEDS-NOT-FENCES (owner, Thu Oct 29, 2026
 * 14:38 MDT; approved 14:55 MDT: "Build it — pegs as seeds
 * that drift"):
 * "Keeping these pegs in a very tight circle is a double edged
 * sword… we are told to pick up and dump on the same site in
 * different places… unless the user is pegging their dump site
 * and pick up sites every time they pick up a load or dump it…
 * it might work and it might not… And touching the screen again
 * and again is not only tiresome! It's dangerous as well."
 *
 * THE LAW after this ship (v282's pegs, re-founded):
 *  - The two morning pegs are SEEDS. Each role keeps a living
 *    centre that starts at its seed; every COUNTED event (a
 *    confirmed pickup, a counted dump) nudges the centre toward
 *    where the event actually happened — at most 25 m per event
 *    off the smoothed fix, so one bad fix can never teleport a
 *    centre, and the work face can wander all day with ZERO
 *    screen touches.
 *  - The fence around each centre is 70 m (his 60–80 m band).
 *    Identity comes from the load->dump->load CYCLE, not the
 *    pinpoint. The ambiguity rule, exactly: a dwell in only one
 *    fence belongs to that fence's role (the unexpected role
 *    alone = a visit; no count, no arm change); a dwell in BOTH
 *    fences belongs to the nearer centre — except when the
 *    truck is >= 20 m from BOTH centres and the two distances
 *    are within 10 m, where geometry is a coin flip and the
 *    role the cycle is waiting for wins. A truck parked ON a
 *    centre is nearer it by the whole separation, so a
 *    stationary truck in a full overlap can never alternate
 *    the cycle by itself.
 *  - One wide SITE frame, from the seeds alone (midpoint;
 *    radius max(200 m, half the seed separation + 100 m); a
 *    lone seed frames itself at 250 m). A stop outside it
 *    counts nothing, whatever its length — place, not
 *    duration (the washroom rule) — and no centre drifts out.
 *  - A re-peg RE-SEEDS (the job truly changed): v282 banking —
 *    the count stands, the day's event trail extends.
 *  - The Manifest (v283) stays true under drift: Loaded at /
 *    Dumped at follow the day's counted events — the seed's
 *    place, then each distinctly-named place the work moved
 *    into, in order. Never coordinates.
 *
 * This suite drives the REAL js/geoloads.js glue (same rig as
 * tools/loads-site-pegs-v282-test.js) plus the real manifest:
 *   (a)  the spots DRIFT ~60 m across the day in steps -> every
 *        load counts with NO re-peg; centres follow the faces
 *   (b)  alternating cycles stay separated as the faces (and
 *        centres) CONVERGE to ~100 m apart: exact count, no
 *        phantom loads
 *   (c)  an OFF-SITE stop (400 m out, 5 minutes, mid-cycle)
 *        never counts, never arms/disarms, drifts nothing —
 *        and the interrupted cycle still completes after
 *   (d)  a mid-day RE-SEED banks the count and EXTENDS the
 *        day's event trail (both jobs stay on the record)
 *   (e)  engine frames: the site-circle formula (wide pair,
 *        close pair, lone seed)
 *   (m)  the manifest under drift: seed place -> drifted-into
 *        place, in order, in the printed document; unnamed
 *        event places fall back to their event time
 *
 * Run: node tools/pegs-seeds-v284-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'geoloads.js'), 'utf8');
const manSrc = fs.readFileSync(path.join(ROOT, 'modules', 'manifest.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

/* ---------------- the v282 glue rig, verbatim pattern ---------------- */
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
  return { GeoLoads: sb.GeoLoads, feed: function (fix) { return handler(fix); }, sb: sb };
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
function pt(base, eM, nM) { const ll = off(base.lat, base.lng, eM, nM); return { lat: ll[0], lng: ll[1] }; }
const STILL = [[0, 0], [15, 10], [-12, 8], [10, -14], [-8, -10]];
const STILL_TIGHT = [[0, 0], [4, 3], [-3, 2], [2, -4], [-4, -3]];

function mkFeed(world) {
  return function (tS, ll) {
    return world.feed({ latitude: ll[0], longitude: ll[1], accuracy: 8, time: T0 + tS * 1000 });
  };
}
function park(feed, clock, center, durS, still) {
  const steps = Math.floor(durS / 10);
  const pat = still || STILL;
  for (let k = 0; k <= steps; k++) {
    const w = pat[k % pat.length];
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
function dist(w, A, B) { return w.GeoLoads._engine.haversineM(A.lat, A.lng, B.lat, B.lng); }

const HOME = { lat: 51.15709, lng: -113.93862 };
const DSP_NOPIN = { id: 'dsp-aecon', jobSite: 'Aecon Inf', dropoff: '', status: 'active', date: TODAY, scheduledAt: TODAY + 'T08:00:00' };
function baseData(dsp) {
  const d = {
    nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] },
    dsp_list: dsp ? [dsp] : []
  };
  if (dsp) d.dsp_active = dsp;
  return d;
}
/* plant both seeds: park at L, peg pickup; drive to D, park, peg dump */
function seedPair(w, feed, clock, L, D) {
  park(feed, clock, L, 120);
  const rp = w.GeoLoads.setPeg('load');
  drive(feed, clock, L, D, 120);
  park(feed, clock, D, 120);
  const rd = w.GeoLoads.setPeg('dump');
  return rp && rp.ok && rd && rd.ok && rd.armed === true;
}

/* ---------------- (a) the spots drift ~60 m across the day ---------------- */
console.log('(a) — DRIFT: faces wander ~60 m in steps, NO re-peg, every load counts');
{
  const store = mkSharedStore(baseData(DSP_NOPIN));
  const w = mkWorld(store);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  const L0 = { lat: 50.969, lng: -114.034 };
  const D0 = pt(L0, 300, 0);
  ok(seedPair(w, feed, clock, L0, D0), 'a both seeds land and the pair arms');
  /* 4 cycles: the pile steps +20 m east each load, the tip face
     steps +15 m north each dump — the driver touches NOTHING */
  let cur = D0;
  for (let k = 0; k < 4; k++) {
    const Lk = pt(L0, 20 * k, 0), Dk = pt(D0, 0, 15 * k);
    drive(feed, clock, cur, Lk, 90);
    park(feed, clock, Lk, 150);
    drive(feed, clock, Lk, Dk, 90);
    park(feed, clock, Dk, 150);
    cur = Dk;
  }
  const t = w.GeoLoads.today();
  const fd = w.GeoLoads.forDate(TODAY);
  ok(t.count === 4, 'a all 4 drifted cycles counted with no re-peg (4)', JSON.stringify({ count: t.count }));
  ok(fd && fd.countSource === 'pegs' && Array.isArray(fd.pegEvents) && fd.pegEvents.length === 8,
    'a day record carries 8 counted peg events (4 pickups + 4 dumps)',
    JSON.stringify(fd && { ev: fd.pegEvents && fd.pegEvents.length }));
  ok(fd && fd.pegEvents.filter(e => e.kind === 'load').length === 4 &&
     fd.pegEvents.filter(e => e.kind === 'dump').length === 4,
    'a event trail splits 4 load / 4 dump');
  const cen = fd && fd.pegCentres;
  const L3 = pt(L0, 60, 0), D3 = pt(D0, 0, 45);
  ok(cen && dist(w, cen.load, L3) <= 45, 'a pickup centre followed the pile east (~60 m)',
    cen && Math.round(dist(w, cen.load, L3)) + ' m from the final face');
  ok(cen && dist(w, cen.load, L0) >= 35, 'a pickup centre really moved off its seed',
    cen && Math.round(dist(w, cen.load, L0)) + ' m from the seed');
  ok(cen && dist(w, cen.dump, D3) <= 45, 'a dump centre followed the tip face north (~45 m)',
    cen && Math.round(dist(w, cen.dump, D3)) + ' m from the final face');
}

/* ---------------- (b) convergence: faces close to ~100 m ---------------- */
console.log('(b) — CONVERGENCE: faces close from 300 m to ~100 m, cycles stay separated');
{
  const store = mkSharedStore(baseData(DSP_NOPIN));
  const w = mkWorld(store);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  const L0 = { lat: 50.969, lng: -114.034 };
  const D0 = pt(L0, 300, 0);
  ok(seedPair(w, feed, clock, L0, D0), 'b both seeds land and the pair arms');
  /* 5 cycles: each face steps 25 m toward the other per cycle —
     pile east, tip face west — ending ~100 m apart */
  let cur = D0;
  for (let k = 0; k < 5; k++) {
    const Lk = pt(L0, 25 * k, 0), Dk = pt(D0, -25 * k, 0);
    drive(feed, clock, cur, Lk, 90);
    park(feed, clock, Lk, 150);
    drive(feed, clock, Lk, Dk, 90);
    park(feed, clock, Dk, 150);
    cur = Dk;
  }
  const t = w.GeoLoads.today();
  const fd = w.GeoLoads.forDate(TODAY);
  ok(t.count === 5, 'b exactly 5 converged cycles counted — no phantoms (5)', JSON.stringify({ count: t.count }));
  const cen = fd && fd.pegCentres;
  const sep = cen ? dist(w, cen.load, cen.dump) : -1;
  ok(sep >= 70 && sep <= 140, 'b centres converged to ~100 m apart and stayed distinct', 'sep=' + Math.round(sep));
  ok(cen && dist(w, cen.load, pt(L0, 100, 0)) <= 45, 'b pickup centre tracked its face to +100 m',
    cen && Math.round(dist(w, cen.load, pt(L0, 100, 0))) + ' m');
  ok(cen && dist(w, cen.dump, pt(D0, -100, 0)) <= 45, 'b dump centre tracked its face to -100 m',
    cen && Math.round(dist(w, cen.dump, pt(D0, -100, 0))) + ' m');
}

/* ---------------- (c) the off-site stop ---------------- */
console.log('(c) — OFF-SITE: a 5-minute stop 400 m out, mid-cycle, counts nothing');
{
  const store = mkSharedStore(baseData(DSP_NOPIN));
  const w = mkWorld(store);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  const L0 = { lat: 50.969, lng: -114.034 };
  const D0 = pt(L0, 300, 0);
  ok(seedPair(w, feed, clock, L0, D0), 'c both seeds land and the pair arms');
  /* one clean cycle */
  drive(feed, clock, D0, L0, 90);
  park(feed, clock, L0, 150);
  drive(feed, clock, L0, D0, 90);
  park(feed, clock, D0, 150);
  /* load up again, then stop OFF SITE on the way to the dump */
  drive(feed, clock, D0, L0, 90);
  park(feed, clock, L0, 150);
  const before = w.GeoLoads.forDate(TODAY);
  const stBefore = w.GeoLoads.status();
  ok(w.GeoLoads.today().count === 1 && stBefore.counter && stBefore.counter.armed === true,
    'c mid-cycle: 1 load counted, truck armed (loaded)', JSON.stringify({ count: w.GeoLoads.today().count }));
  const OFF = pt(L0, 150, 400);   // 400 m north of the site midpoint — outside the frame
  drive(feed, clock, L0, OFF, 120);
  park(feed, clock, OFF, 300);    // the washroom stop: 5 full minutes
  const after = w.GeoLoads.forDate(TODAY);
  const stAfter = w.GeoLoads.status();
  ok(w.GeoLoads.today().count === 1, 'c the off-site stop counted nothing (still 1)',
    JSON.stringify({ count: w.GeoLoads.today().count }));
  ok(stAfter.counter && stAfter.counter.armed === true, 'c the truck is still armed after the stop');
  ok(before && after && before.pegEvents.length === after.pegEvents.length,
    'c no peg event was recorded off site',
    JSON.stringify({ b: before && before.pegEvents.length, a: after && after.pegEvents.length }));
  ok(before && after && dist(w, before.pegCentres.load, after.pegCentres.load) < 1 &&
     dist(w, before.pegCentres.dump, after.pegCentres.dump) < 1,
    'c neither centre drifted toward the off-site stop');
  /* the interrupted cycle still completes at the real dump */
  drive(feed, clock, OFF, D0, 120);
  park(feed, clock, D0, 150);
  ok(w.GeoLoads.today().count === 2, 'c the load still counts when it reaches the dump (2)',
    JSON.stringify({ count: w.GeoLoads.today().count }));
}

/* ---------------- (d) re-seed banks the count, extends the trail ---------------- */
console.log('(d) — RE-SEED: the job changes, count banks, the trail keeps both jobs');
{
  const store = mkSharedStore(baseData(DSP_NOPIN));
  const w = mkWorld(store);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  const L0 = { lat: 50.969, lng: -114.034 };
  const D0 = pt(L0, 300, 0);
  ok(seedPair(w, feed, clock, L0, D0), 'd both seeds land and the pair arms');
  let cur = D0;
  for (let k = 0; k < 2; k++) {
    drive(feed, clock, cur, L0, 90);
    park(feed, clock, L0, 150);
    drive(feed, clock, L0, D0, 90);
    park(feed, clock, D0, 150);
    cur = D0;
  }
  ok(w.GeoLoads.today().count === 2, 'd two cycles banked before the move', JSON.stringify({ count: w.GeoLoads.today().count }));
  /* the job changes: a new pickup 600 m south — the driver re-pegs */
  const L2 = pt(L0, 0, -600);
  drive(feed, clock, D0, L2, 180);
  park(feed, clock, L2, 120);
  const rp = w.GeoLoads.setPeg('load');
  ok(rp && rp.ok && rp.armed === true, 'd re-peg re-seeds the pair on the new job', JSON.stringify(rp));
  park(feed, clock, L2, 150);
  drive(feed, clock, L2, D0, 180);
  park(feed, clock, D0, 150);
  const t = w.GeoLoads.today();
  const fd = w.GeoLoads.forDate(TODAY);
  ok(t.count === 3, 'd the banked 2 stand and the new job adds its cycle (3)', JSON.stringify({ count: t.count }));
  ok(fd && Array.isArray(fd.pegLog) && fd.pegLog.length === 3, 'd all three peg moves are on the record',
    JSON.stringify(fd && fd.pegLog && fd.pegLog.length));
  const evL = (fd && fd.pegEvents || []).filter(e => e.kind === 'load');
  ok(evL.some(e => dist(w, e, L0) <= 60) && evL.some(e => dist(w, e, L2) <= 60),
    'd the event trail spans BOTH jobs (old pickup and re-seeded pickup)',
    JSON.stringify(evL.map(e => [Math.round(dist(w, e, L0)), Math.round(dist(w, e, L2))])));
}

/* ---------------- (e) engine frames ---------------- */
console.log('(e) — SITE FRAME: the formula, from the seeds alone');
{
  const sb = {};
  vm.createContext(sb);
  const a = src.lastIndexOf('/*', src.indexOf('GEOLOADS-ENGINE-BEGIN'));
  const b = src.indexOf('*/', src.indexOf('GEOLOADS-ENGINE-END'));
  vm.runInContext(src.slice(a, b + 2), sb);
  const E = sb.ENGINE;
  const L0 = { lat: 50.969, lng: -114.034 };
  const wide = E.createPegCounter({ load: L0, dump: pt(L0, 1500, 0) });
  const wideDump = pt(L0, 1500, 0);
  const sepW = E.haversineM(L0.lat, L0.lng, wideDump.lat, wideDump.lng);
  ok(wide.site() && Math.abs(wide.site().radiusM - (sepW / 2 + 100)) < 1,
    'e 1.5 km pair: radius = half-separation + 100 (~850)',
    JSON.stringify({ radius: wide.site() && Math.round(wide.site().radiusM), sep: Math.round(sepW) }));
  const close = E.createPegCounter({ load: L0, dump: pt(L0, 15, 0) });
  ok(close.site() && close.site().radiusM === 200, 'e 15 m pair: the 200 m floor rules',
    JSON.stringify(close.site()));
  const lone = E.createPegCounter({ load: L0 });
  ok(lone.site() && lone.site().radiusM === 250 && lone.count() === 0 && lone.isActive() === false,
    'e a lone seed still gets its frame (250 m) and counting stays unarmed',
    JSON.stringify(lone.site()));
  ok(E.PEG_FENCE_M === 70 && E.DRIFT_STEP_M === 25, 'e the shipped constants: 70 m fence, 25 m drift step');
}

/* ---------------- (m) the manifest under drift ---------------- */
console.log('(m) — MANIFEST: Loaded at / Dumped at follow the drift');
{
  function extract(file, beginMark, endMark) {
    const s = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const a2 = s.lastIndexOf('/*', s.indexOf(beginMark));
    const b2 = s.indexOf('*/', s.indexOf(endMark));
    if (a2 === -1 || b2 === -1 || b2 <= a2) throw new Error('markers not found in ' + file);
    return s.slice(a2, b2 + 2);
  }
  const msb = {};
  vm.createContext(msb);
  vm.runInContext(extract('js/miles.js', 'MILES-ENGINE-BEGIN', 'MILES-ENGINE-END'), msb);
  const MENG = msb.ENGINE;
  const DAY = '2026-10-29';
  const T = (s) => Date.parse(DAY + 'T' + s + ':00');
  const HOMEp = [51.15710, -113.93862];
  const PIT_A = [51.00874, -114.02517];   /* 'Stoney Trail Aggregate' */
  const DUMP_A = [50.96850, -114.03340];  /* 'Simply Stone' */
  const PIT_B = [50.72282, -114.18856];   /* 'Aecon Gravel Pit' */
  const FAR1 = [51.23456, -113.76543];    /* never seen */
  const FAR3 = [51.23906, -113.76543];    /* ~500 m from FAR1 — a new place */
  function baseMem(geoDay) {
    return {
      mani_date: DAY,
      onboarding: { payStandard: 'Hourly', payRate: 29, ownWageRate: 29, travelBonus: 1 },
      nav_data: {
        personal: [{ name: 'Home', lat: HOMEp[0], lng: HOMEp[1] }],
        work: [
          { name: 'Stoney Trail Aggregate', lat: PIT_A[0], lng: PIT_A[1] },
          { name: 'Simply Stone', lat: DUMP_A[0], lng: DUMP_A[1] },
          { name: 'Aecon Gravel Pit', lat: PIT_B[0], lng: PIT_B[1] }
        ]
      },
      dsp_list: [], nav_log: [], fuel_fills: [], fuel_expenses: [], dmg_reports: [],
      sessions: [], rev_entries: [], rev_extras: [], odo_readings: [], pti_reports: [],
      tracker: { status: 'idle', startTs: 0, elapsed: 0 },
      livemiles: { days: {} },
      geoloads: { days: { '2026-10-29': geoDay } }
    };
  }
  function makeWorld(mem) {
    const store = {
      get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
      set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
      del: function (k) { delete mem[k]; return true; }
    };
    const sandbox = {
      console: console, setTimeout: setTimeout, Promise: Promise,
      App: {
        _store: store,
        _esc: function (s) { return String(s == null ? '' : s); },
        _today: function () { return DAY; },
        tracker: mem.tracker, userRole: function () { return 'both'; }
      },
      LiveMiles: { reportLines: MENG.reportLines, _engine: MENG },
      Meticulous: { modules: {} }
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(manSrc, sandbox, { filename: 'modules/manifest.js' });
    return sandbox.Meticulous.modules.manifest;
  }
  const flat = (lines) => lines.map(l => (l.k === 'kv' ? l.a + '|' + l.b : l.a || '')).join('\n');

  /* drift day: seeded at Stoney Trail, the work moved into the
     Aecon pit by mid-morning; dumps stayed at Simply Stone */
  const geoDay = {
    date: DAY, count: 2, corr: 0, blocked: null, sites: null, events: [],
    pegs: {
      load: { lat: PIT_A[0], lng: PIT_A[1], t: T('08:00') },
      dump: { lat: DUMP_A[0], lng: DUMP_A[1], t: T('08:05') }
    },
    pegLog: [
      { kind: 'load', t: T('08:00'), lat: PIT_A[0], lng: PIT_A[1] },
      { kind: 'dump', t: T('08:05'), lat: DUMP_A[0], lng: DUMP_A[1] }
    ],
    pegEvents: [
      { kind: 'load', t: T('08:10'), lat: PIT_A[0], lng: PIT_A[1] },
      { kind: 'dump', t: T('08:40'), lat: DUMP_A[0], lng: DUMP_A[1] },
      { kind: 'load', t: T('09:00'), lat: PIT_B[0], lng: PIT_B[1] },
      { kind: 'dump', t: T('09:20'), lat: DUMP_A[0], lng: DUMP_A[1] }
    ],
    countSource: 'pegs'
  };
  const M = makeWorld(baseMem(geoDay));
  const pp = M._pegPlaceLabels(geoDay);
  ok(pp && JSON.stringify(pp.load) === JSON.stringify(['Stoney Trail Aggregate', 'Aecon Gravel Pit']),
    'm Loaded at follows the drift: seed place -> drifted-into place, in order', JSON.stringify(pp && pp.load));
  ok(pp && JSON.stringify(pp.dump) === JSON.stringify(['Simply Stone']),
    'm Dumped at stays the one place (repeat events shown once)', JSON.stringify(pp && pp.dump));
  const c = M._collectDay(DAY);
  const doc = flat(M._docLines(DAY, c, M._toggles()));
  ok(/Loaded at\|Stoney Trail Aggregate → Aecon Gravel Pit/.test(doc),
    'm the printed document carries the drifted Loaded at line');
  ok(!/\d{2}\.\d{3,}/.test(doc.split('\n').filter(l => /Loaded at|Dumped at/.test(l)).join('\n')),
    'm no coordinate ever prints on the peg lines');

  /* unnamed drift: pegged at one unseen place, work moved ~500 m
     to another unseen place — both print as times, peg vs event */
  const geoDay2 = {
    date: DAY, count: 1, corr: 0, blocked: null, sites: null, events: [],
    pegs: { load: { lat: FAR1[0], lng: FAR1[1], t: T('08:00') }, dump: null },
    pegLog: [{ kind: 'load', t: T('08:00'), lat: FAR1[0], lng: FAR1[1] }],
    pegEvents: [{ kind: 'load', t: T('09:30'), lat: FAR3[0], lng: FAR3[1] }],
    countSource: 'pegs'
  };
  const M2 = makeWorld(baseMem(geoDay2));
  const pp2 = M2._pegPlaceLabels(geoDay2);
  ok(pp2 && pp2.load.length === 2 && /^Pegged pickup — /.test(pp2.load[0]) && /^Loaded — /.test(pp2.load[1]),
    'm unnamed places fall back to times: the peg time, then the event time',
    JSON.stringify(pp2 && pp2.load));
}

console.log('\nPEGS-SEEDS-NOT-FENCES v284: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
