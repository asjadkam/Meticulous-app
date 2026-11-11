#!/usr/bin/env node
/* COUNTING-REPEG-FAIL-NOV11 (Nov 11, 2026) — the owner's live test
 * of webs 410/416 FAILED, in his own design: loads 1-2 counted from
 * his pegs in the morning; at 12:28 PM he re-pegged the PICKUP at a
 * new site B (the count held — banking works); the load he then
 * hauled B -> dump and TIPPED did not count by itself; the dump peg
 * was freshened at 12:49 PM, at the dump, mid-visit; the card at
 * 13:27 read "Loads today: 3 — 2 counted from your pegs · +1 your
 * tap" and he hand-tapped the missed load. His words: "It did not
 * count the load by itself even though it had a pickup peg and
 * dump peg after I changed that."
 *
 * CONVICTION (this bench, failing-first on web 420): the peg
 * counter's SITE FRAME is a circle on the pair's midpoint with
 * radius = half the seed separation + 100 m. A tip face PAST the
 * dump peg — the normal case on a working fill site, where the
 * face advances past the morning's peg — sits outside that circle
 * once it is ~100-300 m past the seed, and the wrapper discards
 * EVERY fix there as 'off-site' before the zone machine ever sees
 * it: no dwell builds, no shadow clock runs, no recovery cluster
 * forms; the visit is invisible (probe on 420 bytes: faces at the
 * peg and +100 m count; +150 m and beyond never count at the tip).
 * Worse, a shadow candidate born on the drive-in freezes mid-clock
 * (its away-time is never witnessed) and can confirm LATE on a
 * later drive-past — the count, when it lands at all, lands wrong.
 * And when the driver answers the silence by re-pegging the dump
 * AT the face (12:49), the v392 declaration seed is born "at-dump,
 * unarmed" — the carry the outgoing machine had already proven is
 * discarded with the rebuild, so that visit is baseline too.
 *
 * THE LAW IT VIOLATES (the owner's, Nov 10): pegs are SEEDS NOT
 * FENCES; counting is dynamic — distance, dwell and what a stop
 * means, judged together, with each site's scale learned fast
 * (the v409 profile: work ground runs 1200 m). A frame that ends
 * 100 m past the seed is a fence, and a re-peg that eats a proven
 * carry is a reset by another name.
 *
 * FIX (js/geoloads.js, counting path only):
 *  (1) The peg counter's site frame reaches as far past the seeds
 *      as the dump site's own scale (the v409 profile's effective
 *      scale — land-use prior or learned, whichever is larger;
 *      the glue passes it as cfg.profileScaleM). A counter built
 *      with no profile keeps the v284 frame byte-for-byte.
 *  (2) The fence-recovery cluster may now build anywhere within
 *      that scale of the centre the cycle is waiting for; a
 *      cluster that holds a full declared-place dwell BEYOND the
 *      recovery band ADOPTS its face in one step (the v409
 *      proveFace chain: a proven face teaches the site's reach
 *      immediately) — the centre moves onto the still cluster and
 *      the ordinary fence/shadow discipline confirms the arrival
 *      from there. Inside the band the v300 nudge walk is
 *      unchanged, and adoption never counts by itself.
 *  (3) A rebuild that finds the outgoing cycle counter ARMED and
 *      the truck standing at the (re-)pegged dump is born still
 *      carrying (zone 'out', phase 'to-dump', armed) instead of
 *      "at-dump, unarmed": the visit in progress must still prove
 *      itself by dwell, but a re-peg can no longer eat a proven
 *      carry. A declaration with no proven carry behind it keeps
 *      the v392/v369 baseline exactly.
 *
 * Geometry = the real day: A (51.1225089,-114.0122197) the
 * morning pickup, D (51.3078889,-114.0369722) the dump peg,
 * B (51.124305,-113.983135) the 12:28 re-pegged pickup, and
 * F = the afternoon tip face, 400 m past the dump peg.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const geoSrc = fs.readFileSync(path.join(ROOT, 'js', 'geoloads.js'), 'utf8');

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}

const RealDate = Date;
function mkSharedStore(data) {
  data = data || {};
  return {
    get: function (k, dflt) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : dflt; },
    set: function (k, v) { data[k] = JSON.parse(JSON.stringify(v)); },
    _data: data
  };
}
function mkGeoWorld(store, src) {
  const sb = { console: console, Date: RealDate, Math: Math, JSON: JSON };
  sb.window = sb;
  let handler = null;
  sb.LiveMiles = { available: function () { return true; }, subscribe: function (fn) { handler = fn; } };
  sb.App = { _store: store };
  vm.createContext(sb);
  vm.runInContext(src, sb);
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
function goff(lat, lng, eM, nM) { return [lat + nM / 111320, lng + eM / (111320 * Math.cos(lat * Math.PI / 180))]; }
function mkFeed(world) {
  return function (tS, ll) { return world.feed({ latitude: ll[0], longitude: ll[1], accuracy: 8, time: T0 + tS * 1000 }); };
}
function park(feed, clock, center, durS) {
  const steps = Math.floor(durS / 10);
  for (let k = 0; k <= steps; k++) {
    const w = STILL[k % STILL.length];
    feed(clock.t, goff(center.lat, center.lng, w[0], w[1]));
    clock.t += 10;
  }
}
function driveTo(feed, clock, pos, dest, durS) {
  const A0 = { lat: pos.lat, lng: pos.lng };
  const steps = Math.max(1, Math.floor(durS / 10));
  for (let k = 1; k <= steps; k++) {
    const f = k / steps;
    feed(clock.t, [A0.lat + (dest.lat - A0.lat) * f, A0.lng + (dest.lng - A0.lng) * f]);
    clock.t += 10;
  }
  pos.lat = dest.lat; pos.lng = dest.lng;
}

const A = { lat: 51.1225089, lng: -114.0122197 };  // morning pickup peg
const D = { lat: 51.3078889, lng: -114.0369722 };  // dump peg (09:35)
const B = { lat: 51.124305, lng: -113.983135 };    // re-pegged pickup (12:28)
const F = { lat: D.lat + 400 / 111320, lng: D.lng }; // afternoon face, 400 m past the peg
const FAR = { lat: 51.20, lng: -113.90 };          // an off-corridor stop ~5 km east

function baseData() {
  /* a dispatch with no pins anywhere: the pegs are the day's only
     sites, exactly the configuration his re-peg test ran on */
  const dsp = { id: 'dsp-nov11', jobSite: 'Aecon Trans', dropoff: '', status: 'active',
    date: TODAY, scheduledAt: TODAY + 'T08:00:00', notes: '' };
  return { nav_data: { personal: [], work: [], recent: [] },
    dsp_list: [dsp], dsp_active: dsp };
}
function mach(w) { return w.GeoLoads.status().count; }

/* the shared morning: both pegs planted, two cycles counted */
function morning(w, feed, clock, pos) {
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, A, 120);
  w.GeoLoads.setPeg('load');
  park(feed, clock, A, 60);
  driveTo(feed, clock, pos, D, 600); park(feed, clock, D, 60);
  w.GeoLoads.setPeg('dump');
  park(feed, clock, D, 120);
  for (let i = 0; i < 2; i++) {
    driveTo(feed, clock, pos, A, 600); park(feed, clock, A, 300);
    driveTo(feed, clock, pos, D, 600); park(feed, clock, D, 300);
  }
}
function freshWorld() {
  const store = mkSharedStore(baseData());
  const w = mkGeoWorld(store, geoSrc);
  return { store: store, w: w, feed: mkFeed(w), clock: { t: 0 },
    pos: { lat: A.lat, lng: A.lng } };
}
/* the 12:28 move: drive to the new pickup, load, re-peg there */
function repegToB(x) {
  driveTo(x.feed, x.clock, x.pos, B, 600); park(x.feed, x.clock, B, 240);
  x.w.GeoLoads.setPeg('load');
  park(x.feed, x.clock, B, 120);
}

console.log('S1 — control: re-peg pickup, tips AT the dump peg');
(function () {
  const x = freshWorld();
  morning(x.w, x.feed, x.clock, x.pos);
  ok(mach(x.w) === 2, 'S1 morning counts exactly 2 from the pegs — got ' + mach(x.w));
  repegToB(x);
  ok(mach(x.w) === 2, 'S1 the re-peg preserves the count — got ' + mach(x.w));
  driveTo(x.feed, x.clock, x.pos, D, 600); park(x.feed, x.clock, D, 240);
  ok(mach(x.w) === 3, 'S1 the first post-re-peg tip counts at the peg — got ' + mach(x.w));
  driveTo(x.feed, x.clock, x.pos, B, 600); park(x.feed, x.clock, B, 300);
  driveTo(x.feed, x.clock, x.pos, D, 600); park(x.feed, x.clock, D, 300);
  ok(mach(x.w) === 4, 'S1 the second post-re-peg tip counts — got ' + mach(x.w));
})();

console.log('S2 — the day as lived: re-peg pickup, tips at the face 400 m past the peg');
(function () {
  const x = freshWorld();
  morning(x.w, x.feed, x.clock, x.pos);
  ok(mach(x.w) === 2, 'S2 morning counts exactly 2 from the pegs — got ' + mach(x.w));
  repegToB(x);
  driveTo(x.feed, x.clock, x.pos, F, 600);
  park(x.feed, x.clock, F, 240);
  ok(mach(x.w) === 3, 'S2 the first post-re-peg tip COUNTS at the face (420: stays 2 — the visit is off-site) — got ' + mach(x.w));
  driveTo(x.feed, x.clock, x.pos, B, 600); park(x.feed, x.clock, B, 300);
  driveTo(x.feed, x.clock, x.pos, F, 600);
  park(x.feed, x.clock, F, 300);
  ok(mach(x.w) === 4, 'S2 the second tip at the face counts too — got ' + mach(x.w));
})();

console.log('S3 — the 12:49 freshen: dump re-pegged at the face, mid-visit');
(function () {
  const x = freshWorld();
  morning(x.w, x.feed, x.clock, x.pos);
  repegToB(x);
  driveTo(x.feed, x.clock, x.pos, F, 600);
  park(x.feed, x.clock, F, 60);
  x.w.GeoLoads.setPeg('dump');               /* the freshen, at the face */
  park(x.feed, x.clock, F, 240);
  ok(mach(x.w) === 3, 'S3 the carry survives the mid-visit freshen and the tip counts (420: stays 2) — got ' + mach(x.w));
  driveTo(x.feed, x.clock, x.pos, B, 600); park(x.feed, x.clock, B, 300);
  driveTo(x.feed, x.clock, x.pos, F, 600); park(x.feed, x.clock, F, 300);
  ok(mach(x.w) === 4, 'S3 the next cycle counts — got ' + mach(x.w));
})();

console.log('S4 — no re-peg at all: the face moves for load 3');
(function () {
  const x = freshWorld();
  morning(x.w, x.feed, x.clock, x.pos);
  driveTo(x.feed, x.clock, x.pos, A, 600); park(x.feed, x.clock, A, 300);
  driveTo(x.feed, x.clock, x.pos, F, 600);
  park(x.feed, x.clock, F, 300);
  ok(mach(x.w) === 3, 'S4 a tip at the moved face counts on an untouched day (420: stays 2) — got ' + mach(x.w));
})();

console.log('G — guards');
(function () {
  const x = freshWorld();
  morning(x.w, x.feed, x.clock, x.pos);
  repegToB(x);
  /* G1: an armed drive PAST the face, no stop — counts nothing */
  driveTo(x.feed, x.clock, x.pos, F, 600);
  driveTo(x.feed, x.clock, x.pos, FAR, 300);
  driveTo(x.feed, x.clock, x.pos, B, 300);
  ok(mach(x.w) === 2, 'G1 an armed pass by the face counts nothing — got ' + mach(x.w));
  /* G4: a long armed stop far off the corridor — counts nothing,
     and the real tip after it still counts exactly once */
  park(x.feed, x.clock, B, 120);
  driveTo(x.feed, x.clock, x.pos, FAR, 600); park(x.feed, x.clock, FAR, 300);
  ok(mach(x.w) === 2, 'G4 a 5-minute armed stop 5 km off the corridor counts nothing — got ' + mach(x.w));
  driveTo(x.feed, x.clock, x.pos, B, 600); park(x.feed, x.clock, B, 60);
  driveTo(x.feed, x.clock, x.pos, F, 600); park(x.feed, x.clock, F, 300);
  ok(mach(x.w) === 3, 'G4 the real tip after the far stop counts exactly once — got ' + mach(x.w));
  /* G3: lingering at the face after the tip — no double count;
     the washroom stop beside the face, unarmed, counts nothing */
  park(x.feed, x.clock, F, 180);
  ok(mach(x.w) === 3, 'G3 lingering at the face after the tip counts nothing more — got ' + mach(x.w));
  driveTo(x.feed, x.clock, x.pos, B, 600); park(x.feed, x.clock, B, 300);
  driveTo(x.feed, x.clock, x.pos, F, 600); park(x.feed, x.clock, F, 300);
  ok(mach(x.w) === 4, 'G3 the next real cycle counts exactly once — got ' + mach(x.w));
})();
(function () {
  /* G2: an UNARMED long stop at the face (arrived empty) */
  const x = freshWorld();
  morning(x.w, x.feed, x.clock, x.pos);
  driveTo(x.feed, x.clock, x.pos, F, 600);
  park(x.feed, x.clock, F, 300);
  ok(mach(x.w) === 2, 'G2 five unarmed minutes at the face count nothing — got ' + mach(x.w));
})();

console.log('\ncounting-repeg-fail-nov11: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
