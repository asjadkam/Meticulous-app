#!/usr/bin/env node
/* Meticulous — LOADS-SITE-PEGS (owner, Thu Oct 29, 2026 14:07 MDT):
 * "this GPS load counter as smart as it is it can never be accurate
 * where I'm picking up where I'm dumping — its system is only
 * calculating based on times, how long I spent on either side.
 * Instead… user should have somewhere to peg the pickup site and
 * their dump sites, and they should be able to adjust that as the
 * day goes on, because we don't know when the job is changing."
 *
 * The build: two one-tap pegs on the tracker — PEG PICKUP /
 * PEG DUMP — each plants a peg at the phone's current GPS position
 * (the counter's own live fix stream; no coordinate display or
 * entry anywhere). Pegs live on the DAY record; re-pegging
 * overwrites (that IS the mid-day adjustment) and every peg move
 * is logged on the day. When both pegs exist the counter keys off
 * the pegs FIRST — a dedicated peg counter (engine: rolling-centroid
 * fixes + the standard armed alternation + a 30 m fence, the
 * engine's intra-site grade) — and every earlier inference path
 * (dispatch pins, teaching, pattern learning) remains the fallback
 * for days with no pegs. Peg-based counts are marked on the day
 * record: countSource 'pegs'.
 *
 * This suite drives the REAL js/geoloads.js glue (same rig as
 * tools/load-count-onepin-audit-v268-test.js):
 *   (a)  pegs set at two sites 1.5 km apart -> cycles count from
 *        the pegs from the FIRST cycle (inference would still be
 *        learning), day marked countSource 'pegs'
 *   (a2) peg API surface: one peg only -> pegs() shows it, counting
 *        NOT armed by pegs yet; a peg tap with no live fix yet is
 *        refused honestly ('no-fix')
 *   (b)  SAME-PLACE pegs ~15 m apart -> pickup/dump still separate
 *        by peg identity + visit sequence; cycles count
 *   (c)  mid-day RE-PEG of the pickup (the job changed) -> the
 *        day's earlier count stands, the peg move is logged on
 *        the day record, and later cycles count from the NEW peg
 *   (d)  no pegs at all -> the existing inference behaviour is
 *        unchanged (teach path counts; no 'pegs' marking)
 *
 * Run: node tools/loads-site-pegs-v282-test.js
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
/* The wide stopped-truck wander the older suites use (fine against
 * 120 m fences), and the tight scatter for the peg cases — a stopped
 * truck's real fix cloud at the ~8 m accuracy these feeds carry. */
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
/* One full cycle between two places: load dwell, haul, tip dwell, return. */
function cycle(feed, clock, L, D, loadS, tipS, still) {
  park(feed, clock, L, loadS, still);
  drive(feed, clock, L, D, Math.max(60, Math.round(driveSecs(L, D))));
  park(feed, clock, D, tipS, still);
  drive(feed, clock, D, L, Math.max(60, Math.round(driveSecs(L, D))));
}
function driveSecs(A, B) {
  const dLat = (B.lat - A.lat) * 111320;
  const dLng = (B.lng - A.lng) * 111320 * Math.cos(A.lat * Math.PI / 180);
  const d = Math.sqrt(dLat * dLat + dLng * dLng);
  return Math.min(300, Math.max(30, d / 12)); // ~12 m/s haul roads
}

const HOME = { lat: 51.15709, lng: -113.93862 };
const S_END = { lat: 50.969, lng: -114.034 };            // the day's pit end
const N_END = { lat: 50.983, lng: -114.040 };            // ~1.5 km away
const L2 = { lat: 50.975, lng: -114.018 };               // the job-change pickup
const B15 = { lat: S_END.lat, lng: S_END.lng + 15 / (111320 * Math.cos(S_END.lat * Math.PI / 180)) }; // 15 m east

const DSP_NOPIN = { id: 'dsp-aecon', jobSite: 'Aecon Inf', dropoff: '', status: 'active', date: TODAY, scheduledAt: TODAY + 'T08:00:00' };
function baseData(dsp) {
  const d = {
    nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] },
    dsp_list: dsp ? [dsp] : []
  };
  if (dsp) d.dsp_active = dsp;
  return d;
}

/* ---------------- (a2) peg API surface ---------------- */
console.log('(a2) — peg API: no fix yet refuses; one peg shows, pair not armed');
{
  const store = mkSharedStore(baseData(DSP_NOPIN));
  const w = mkWorld(store);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  ok(typeof w.GeoLoads.setPeg === 'function' && typeof w.GeoLoads.pegs === 'function',
    'a2 GeoLoads exposes setPeg + pegs');
  w.GeoLoads.startDay('s' + T0, {});
  const r0 = w.GeoLoads.setPeg('load');
  ok(r0 && r0.ok === false && r0.why === 'no-fix', 'a2 peg tap before any live fix is refused (no-fix)', JSON.stringify(r0));
  park(feed, clock, S_END, 60);
  const r1 = w.GeoLoads.setPeg('load');
  ok(r1 && r1.ok === true && r1.armed === false, 'a2 first peg lands, pair not armed yet', JSON.stringify(r1));
  const p = w.GeoLoads.pegs();
  ok(p && p.load && typeof p.load.t === 'number' && !p.dump, 'a2 pegs() shows the pickup peg time, dump unpegged', JSON.stringify(p));
  const fd = w.GeoLoads.forDate(TODAY);
  ok(fd && fd.pegs && fd.pegs.load && !fd.pegs.dump && fd.countSource !== 'pegs',
    'a2 day record carries the lone peg; countSource not yet pegs', JSON.stringify(fd && { cs: fd.countSource }));
  ok(w.GeoLoads.today().armed === false, 'a2 one peg does not arm peg counting', JSON.stringify(w.GeoLoads.today()));
}

/* ---------------- (a) two-site pegs ---------------- */
console.log('(a) — pegs at two sites 1.5 km apart: cycles count from the pegs');
{
  const store = mkSharedStore(baseData(DSP_NOPIN));
  const w = mkWorld(store);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, S_END, 120);                       // arrive at the pit
  const rp = w.GeoLoads.setPeg('load');
  drive(feed, clock, S_END, N_END, 300);
  park(feed, clock, N_END, 120);                       // arrive at the dump
  const rd = w.GeoLoads.setPeg('dump');
  ok(rp && rp.ok && rd && rd.ok && rd.armed === true, 'a both pegs land and the pair arms', JSON.stringify(rd));
  /* Back to the pit and run two full cycles — inference alone
   * would still be proving itself; the pegs must count at once. */
  drive(feed, clock, N_END, S_END, 300);
  cycle(feed, clock, S_END, N_END, 240, 240);
  cycle(feed, clock, S_END, N_END, 240, 240);
  const t = w.GeoLoads.today();
  const fd = w.GeoLoads.forDate(TODAY);
  ok(t.armed === true && t.count === 2, 'a two peg cycles counted (2)', JSON.stringify(t));
  ok(fd && fd.count === 2 && fd.events.length === 2, 'a day record holds 2 peg-counted events', JSON.stringify(fd && { n: fd.count, ev: fd.events.length }));
  ok(fd && fd.countSource === 'pegs', 'a day record marked countSource pegs', JSON.stringify(fd && fd.countSource));
  ok(fd && fd.sites && fd.sites.load.src === 'peg' && fd.sites.dump.src === 'peg',
    'a day sites are the pegs (src peg)', JSON.stringify(fd && fd.sites && { l: fd.sites.load.src, d: fd.sites.dump.src }));
  ok(fd && Array.isArray(fd.pegLog) && fd.pegLog.length === 2 &&
     fd.pegLog[0].kind === 'load' && fd.pegLog[1].kind === 'dump',
    'a both peg moves logged on the day record', JSON.stringify(fd && fd.pegLog));
}

/* ---------------- (b) same-place pegs, ~15 m apart ---------------- */
console.log('(b) — SAME-PLACE pegs ~15 m apart: identity + sequence separate them');
{
  const store = mkSharedStore(baseData(DSP_NOPIN));
  const w = mkWorld(store);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, S_END, 120, STILL_TIGHT);
  w.GeoLoads.setPeg('load');
  drive(feed, clock, S_END, B15, 60);
  park(feed, clock, B15, 120, STILL_TIGHT);
  const rd = w.GeoLoads.setPeg('dump');
  ok(rd && rd.ok && rd.armed === true, 'b the 15 m pair arms', JSON.stringify(rd));
  const fd0 = w.GeoLoads.forDate(TODAY);
  const sep = (fd0 && fd0.pegs) ? w.GeoLoads._engine.haversineM(
    fd0.pegs.load.lat, fd0.pegs.load.lng, fd0.pegs.dump.lat, fd0.pegs.dump.lng) : -1;
  ok(sep > 5 && sep < 40, 'b pegs really are ~15 m apart (not a wide pair)', 'sep=' + Math.round(sep));
  drive(feed, clock, B15, S_END, 60);
  for (let c = 0; c < 3; c++) {
    park(feed, clock, S_END, 240, STILL_TIGHT);
    drive(feed, clock, S_END, B15, 60);
    park(feed, clock, B15, 180, STILL_TIGHT);
    drive(feed, clock, B15, S_END, 60);
  }
  const t = w.GeoLoads.today();
  const fd = w.GeoLoads.forDate(TODAY);
  ok(t.count === 3, 'b three same-place cycles counted from the pegs (3)', JSON.stringify(t));
  ok(fd && fd.countSource === 'pegs' && fd.events.length === 3,
    'b day marked pegs with 3 events', JSON.stringify(fd && { cs: fd.countSource, ev: fd.events.length }));
}

/* ---------------- (c) mid-day re-peg ---------------- */
console.log('(c) — mid-day RE-PEG: the job changes, the pickup moves');
{
  const store = mkSharedStore(baseData(DSP_NOPIN));
  const w = mkWorld(store);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, S_END, 120);
  w.GeoLoads.setPeg('load');
  drive(feed, clock, S_END, N_END, 300);
  park(feed, clock, N_END, 120);
  w.GeoLoads.setPeg('dump');
  drive(feed, clock, N_END, S_END, 300);
  cycle(feed, clock, S_END, N_END, 240, 240);          // one load banked
  ok(w.GeoLoads.today().count === 1, 'c one load counted before the job change', JSON.stringify(w.GeoLoads.today()));
  /* The job changes: new pickup across town. He drives there and
   * re-pegs the pickup — the dump peg stays. */
  drive(feed, clock, S_END, L2, 300);
  park(feed, clock, L2, 120);
  const rr = w.GeoLoads.setPeg('load');
  ok(rr && rr.ok === true && rr.armed === true, 'c re-peg lands; the pair re-arms on the new pickup', JSON.stringify(rr));
  ok(w.GeoLoads.today().count === 1, 'c the banked load survives the re-peg (no reset)', JSON.stringify(w.GeoLoads.today()));
  cycle(feed, clock, L2, N_END, 240, 240);             // a cycle from the NEW peg
  const t = w.GeoLoads.today();
  const fd = w.GeoLoads.forDate(TODAY);
  ok(t.count === 2, 'c cycles now count from the new pickup peg (2 total)', JSON.stringify(t));
  ok(fd && Array.isArray(fd.pegLog) && fd.pegLog.length === 3 &&
     fd.pegLog[2].kind === 'load',
    'c the re-peg is logged on the day record (3 moves)', JSON.stringify(fd && fd.pegLog));
  const dNew = (fd && fd.pegs) ? w.GeoLoads._engine.haversineM(
    fd.pegs.load.lat, fd.pegs.load.lng, L2.lat, L2.lng) : 1e9;
  ok(dNew < 60, 'c the day pickup peg now sits at the new site', 'dist=' + Math.round(dNew));
  ok(fd && fd.countSource === 'pegs', 'c day still marked pegs', JSON.stringify(fd && fd.countSource));
}

/* ---------------- (d) no pegs — inference untouched ---------------- */
console.log('(d) — no pegs: existing inference behaviour unchanged');
{
  const dsp = JSON.parse(JSON.stringify(DSP_NOPIN));
  dsp.lat = S_END.lat; dsp.lng = S_END.lng;            // load pin only -> teach path
  const store = mkSharedStore(baseData(dsp));
  const w = mkWorld(store);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  for (let c = 0; c < 3; c++) {
    park(feed, clock, S_END, 70);
    drive(feed, clock, S_END, N_END, 300);
    park(feed, clock, N_END, 200);
    drive(feed, clock, N_END, S_END, 300);
  }
  const t = w.GeoLoads.today();
  const fd = w.GeoLoads.forDate(TODAY);
  ok(t.count >= 2, 'd teach path still counts without pegs (>=2)', JSON.stringify(t));
  ok(!fd || fd.countSource !== 'pegs', 'd no pegs marking on an inference day', JSON.stringify(fd && fd.countSource));
  const p = w.GeoLoads.pegs();
  ok(p && !p.load && !p.dump, 'd pegs() honestly empty on a no-peg day', JSON.stringify(p));
}

console.log('\nLOADS-SITE-PEGS v282: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
