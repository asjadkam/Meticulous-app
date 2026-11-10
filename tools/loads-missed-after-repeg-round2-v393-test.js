#!/usr/bin/env node
/* LOADS-MISSED-AFTER-REPEG-NOV9 — ROUND 2 (v393)
 * Owner, Nov 9, 2026 evening (after web 392 went live on his
 * 18:04 cold start): load #10 counted BY ITSELF on the post-swap
 * pair (pickup pegged 4:18 PM, dump pegged 4:27 PM), but load
 * #11 — the very next cycle — did NOT count; he hand-tapped +1.
 * His standard, verbatim: "This erratic behavior sometimes it
 * does count, sometimes it does not. Does not work. Has to be
 * consistent every single time."
 *
 * CONVICTION (failing-first on shipped web 392): the peg cycle
 * machine confirms a dump only on a continuous fix-witnessed
 * 30 s dwell inside a 70 m fence, judged on a smoothed stream.
 * A tip whose witnessed presence fragments — here the fix
 * stream goes DARK across the end of the tip (20 s of witnessed
 * fixes, silence while he finishes and rolls, the resumed
 * stream already on the road) — never confirms: the armed
 * carry never lands and nothing notices. The dark-stream
 * ingredient is proven in his own days (Nov 9's location went
 * dark ~25 min that morning). Section E replays the evening
 * two-world (pre-392 day -> flush -> 392+ cold start): on
 * shipped 392, E3 fails — cycle 11 is swallowed between two
 * counting cycles, the exact erratic split from his hands.
 *
 * FIX (js/geoloads.js only): the v393 VISIT SHADOW. While the
 * peg machine is ARMED, sustained presence within the dump's
 * own reach (fence + recovery band = 270 m — the reach v300
 * already trusts for a carrying truck) and outside the load's
 * reach, accumulated under the dump-VISIT counter's candidate
 * discipline at the visit arrival bar (45 s), confirms the
 * arrival through confirmZone itself. The fence path stays
 * primary; a fence count disarms first, so a visit can never
 * count twice. Unarmed presence still counts nothing (G1), a
 * drive-through still counts nothing (G2), and an armed stop
 * inside BOTH ends' reach counts nothing — the shadow's
 * not-at-load guard (G3). The arm side is
 * unchanged: it was not the convicted side (cycle 11's arm
 * landed cleanly in life and in E), and widening it would let
 * a mere pass near the pickup arm the machine.
 *
 * Run: node tools/loads-missed-after-repeg-round2-v393-test.js
 * On shipped web 392 this suite FAILS at E3 (expected — that
 * is the failing-first proof). On the fixed file: all pass.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const geoSrc = fs.readFileSync(path.join(ROOT, 'js', 'geoloads.js'), 'utf8');
/* the pre-392 day ran the code live that morning: the parent
   commit of the web-392 ship. Read it from git so the two-world
   replay stays honest; if git is unavailable, fall back to the
   current source for phase A too (the evening posture is then
   built by the current code — E still exercises the restore). */
let preSrc = geoSrc;
try {
  preSrc = require('child_process').execSync(
    'git -C ' + JSON.stringify(ROOT) + ' show 235dca0:js/geoloads.js',
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
} catch (e) { /* fall back to current source */ }

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
  const A = { lat: pos.lat, lng: pos.lng };
  const steps = Math.max(1, Math.floor(durS / 10));
  for (let k = 1; k <= steps; k++) {
    const f = k / steps;
    feed(clock.t, [A.lat + (dest.lat - A.lat) * f, A.lng + (dest.lng - A.lng) * f]);
    clock.t += 10;
  }
  pos.lat = dest.lat; pos.lng = dest.lng;
}
const HOME = { lat: 51.15709, lng: -113.93862 };
const X = { lat: 51.1225089, lng: -114.0122197 };   // the day's dump (evening pair)
const D = { lat: 51.3078889, lng: -114.0369722 };   // the morning dump peg
const Y = { lat: 51.2010000, lng: -113.9500000 };   // the evening pickup
function baseData() {
  const dsp = { id: 'dsp-1', jobSite: 'Aecon Trans', dropoff: '', status: 'active',
    date: TODAY, scheduledAt: TODAY + 'T08:30:00', lat: X.lat, lng: X.lng, dumpLat: D.lat, dumpLng: D.lng };
  return { nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] },
    dsp_list: [dsp], dsp_active: dsp };
}
function mach(w) { return w.GeoLoads.status().count; }

/* ---------- Phase A: the pre-392 day, ending in the 18:02
   visit whose arm never landed (its load dwell went through a
   dark stream), the truck sitting at the dump unarmed ---------- */
function phaseA() {
  const store = mkSharedStore(baseData());
  const w = mkGeoWorld(store, preSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: X.lat, lng: X.lng };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, X, 120);
  driveTo(feed, clock, pos, D, 600); park(feed, clock, D, 60);
  w.GeoLoads.setPeg('dump');
  park(feed, clock, D, 240);
  driveTo(feed, clock, pos, X, 600); park(feed, clock, X, 60);
  w.GeoLoads.setPeg('load');
  park(feed, clock, X, 240);
  const cyc = function () {
    driveTo(feed, clock, pos, D, 600); park(feed, clock, D, 300);
    driveTo(feed, clock, pos, X, 600); park(feed, clock, X, 300);
  };
  cyc(); cyc();
  driveTo(feed, clock, pos, Y, 600); park(feed, clock, Y, 300);
  driveTo(feed, clock, pos, X, 600); park(feed, clock, X, 300);
  w.GeoLoads.setPeg('dump');
  park(feed, clock, X, 120);
  driveTo(feed, clock, pos, Y, 600); park(feed, clock, Y, 60);
  w.GeoLoads.setPeg('load');
  park(feed, clock, Y, 240);
  driveTo(feed, clock, pos, X, 600); park(feed, clock, X, 300);
  w.GeoLoads.setPeg('dump');
  park(feed, clock, X, 120);
  const cyc2 = function () {
    driveTo(feed, clock, pos, Y, 600); park(feed, clock, Y, 300);
    driveTo(feed, clock, pos, X, 600); park(feed, clock, X, 300);
  };
  cyc2(); cyc2();
  driveTo(feed, clock, pos, Y, 600);
  park(feed, clock, Y, 20); clock.t += 420;            /* dark load dwell */
  driveTo(feed, clock, pos, X, 600); park(feed, clock, X, 120);
  w.GeoLoads.flush();
  const rec = store._data['geoloads'].days[TODAY];
  return { data: JSON.parse(JSON.stringify(store._data)), clockT: clock.t,
    arm: rec.state.armed, zone: rec.state.zone };
}

/* ---------- Phase B: the cold start + evening cycles ---------- */
function phaseB(a, variant) {
  const store = mkSharedStore(JSON.parse(JSON.stringify(a.data)));
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: a.clockT };
  const pos = { lat: X.lat, lng: X.lng };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, X, 300);                            /* 18:04 -> 18:09 sit */
  const out = { restored: mach(w) };
  w.GeoLoads.nudge(1);                                  /* his 18:09 hand tap */
  out.afterTap = w.GeoLoads.today().count;
  function cycle(mode) {
    const b = mach(w);
    driveTo(feed, clock, pos, Y, 600); park(feed, clock, Y, 300);
    const armed = w.GeoLoads.status().counter.armed;
    driveTo(feed, clock, pos, X, 600);
    if (mode === 'gap-depart') {
      park(feed, clock, X, 20);                         /* witnessed tip fixes */
      clock.t += 200;                                   /* dark: finishes + rolls */
      driveTo(feed, clock, pos, Y, 120);                /* resumed: on the road */
      const landed = mach(w) > b;
      driveTo(feed, clock, pos, X, 120); park(feed, clock, X, 60);
      return { counted: landed, armed: armed };
    }
    park(feed, clock, X, 300);
    return { counted: mach(w) > b, armed: armed };
  }
  out.c10 = cycle('normal');
  out.c11 = cycle(variant);
  out.c12 = cycle('normal');
  out.final = mach(w);
  out.todayFinal = w.GeoLoads.today().count;
  return out;
}

console.log('E — the Nov 9 evening, two-world replay');
const a = phaseA();
ok(a.arm === false && a.zone === 'dump', 'E0 phase A ends in the unbanked visit (at-dump, unarmed) — got arm=' + a.arm + ' zone=' + a.zone);
const ctrl = phaseB(a, 'normal');
const fix = phaseB(a, 'gap-depart');
ok(fix.restored === ctrl.restored, 'E1 the cold start restores the day count untouched — got ' + fix.restored);
ok(fix.c10.counted === true, 'E2 cycle #10 counts by itself (as in life)');
ok(fix.c11.armed === true, 'E3a cycle #11 arms cleanly at the pickup (the arm was never the problem)');
ok(fix.c11.counted === true, 'E3 cycle #11 COUNTS despite the dark stream across its tip (on shipped 392 this FAILS — the #11 miss)');
ok(fix.c12.counted === true, 'E4 cycle #12 counts');
ok(fix.final === ctrl.final, 'E5 no double count: the gapped evening ends at the same machine total as the clean evening — got ' + fix.final + ' vs ' + ctrl.final);
ok(fix.todayFinal === fix.final + 1, 'E6 the day total is the machine count plus his one hand tap — got today=' + fix.todayFinal);

/* ---------- Guards ---------- */
console.log('G — guards');
(function () {
  /* G1: unarmed presence at the dump counts nothing — a full
     counted cycle first (baseline), then the truck returns to
     the dump WITHOUT loading again and sits five minutes */
  const store = mkSharedStore(baseData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: Y.lat, lng: Y.lng };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, Y, 120);
  w.GeoLoads.setPeg('load');
  park(feed, clock, Y, 120);
  driveTo(feed, clock, pos, X, 600); park(feed, clock, X, 30);
  w.GeoLoads.setPeg('dump');
  park(feed, clock, X, 60);
  driveTo(feed, clock, pos, Y, 600); park(feed, clock, Y, 300);
  driveTo(feed, clock, pos, X, 600); park(feed, clock, X, 300);
  const base = mach(w);
  ok(base === 1, 'G1 setup: the first full cycle counts 1 — got ' + base);
  const MID = { lat: (X.lat + Y.lat) / 2, lng: (X.lng + Y.lng) / 2 };
  driveTo(feed, clock, pos, MID, 300); park(feed, clock, MID, 60);
  driveTo(feed, clock, pos, X, 300); park(feed, clock, X, 300);
  ok(mach(w) === base, 'G1 five unarmed minutes back at the dump count nothing — got ' + mach(w));
})();
(function () {
  /* G2: an armed drive-through past the dump counts nothing */
  const store = mkSharedStore(baseData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: X.lat, lng: X.lng };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, X, 120);
  driveTo(feed, clock, pos, D, 600); park(feed, clock, D, 60);
  w.GeoLoads.setPeg('dump');
  park(feed, clock, D, 240);
  driveTo(feed, clock, pos, Y, 600); park(feed, clock, Y, 60);
  w.GeoLoads.setPeg('load');
  park(feed, clock, Y, 240);
  driveTo(feed, clock, pos, X, 600); park(feed, clock, X, 300);   /* one real cycle */
  const base = mach(w);
  driveTo(feed, clock, pos, Y, 600); park(feed, clock, Y, 300);   /* arm again */
  const PAST = { lat: X.lat + 100 / 111320, lng: X.lng };          /* 100 m off the dump centre */
  driveTo(feed, clock, pos, PAST, 300);                            /* fast pass, no stop */
  driveTo(feed, clock, pos, Y, 300);
  ok(mach(w) === base, 'G2 an armed pass 100 m from the dump centre, no stop, counts nothing — got ' + mach(w) + ' vs ' + base);
})();
(function () {
  /* G3: the shadow's not-at-load guard — a pair 300 m apart:
     an armed stop at the MIDPOINT (inside the dump's reach
     AND the load's reach) must not shadow-count; the real tip
     at the face still counts exactly once. (Same-site pairs
     proper are covered by the v282/v284 suites; the shadow is
     inert there by construction — anywhere near the dump is
     near the load.) */
  const store = mkSharedStore(baseData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const PILE = { lat: Y.lat, lng: Y.lng };
  const FACE = { lat: Y.lat + 300 / 111320, lng: Y.lng };
  const MID = { lat: Y.lat + 150 / 111320, lng: Y.lng };
  const pos = { lat: PILE.lat, lng: PILE.lng };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, PILE, 120);
  w.GeoLoads.setPeg('load');
  park(feed, clock, PILE, 120);
  driveTo(feed, clock, pos, FACE, 60); park(feed, clock, FACE, 30);
  w.GeoLoads.setPeg('dump');           /* the pair: 300 m apart */
  park(feed, clock, FACE, 60);
  driveTo(feed, clock, pos, PILE, 60); park(feed, clock, PILE, 300);   /* arm */
  const base = mach(w);
  /* 60 s at the midpoint: too short for v300 recovery to walk
     the fence in (one nudge still leaves it out of reach), but
     past the shadow's 45 s bar — only the not-at-load guard
     stands between this stop and a count */
  driveTo(feed, clock, pos, MID, 60); park(feed, clock, MID, 60);      /* armed midpoint stop */
  ok(mach(w) === base, 'G3 an armed stop inside BOTH reaches counts nothing — got ' + mach(w) + ' vs ' + base);
  driveTo(feed, clock, pos, FACE, 60); park(feed, clock, FACE, 300);   /* the real tip */
  ok(mach(w) === base + 1, 'G3 the real tip at the face counts exactly once — got ' + mach(w) + ' vs ' + (base + 1));
})();

console.log('\nloads-missed-after-repeg-round2-v393: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
