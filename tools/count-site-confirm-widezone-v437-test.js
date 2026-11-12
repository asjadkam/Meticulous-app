#!/usr/bin/env node
/* COUNT-SITE-CONFIRM-WIDEZONE (Nov 12, 2026): the owner's order,
 * in his words on the Nov 12 drive: "The app should know if the
 * user is not working on site... The GPS peg for the dump site
 * should be big enough to accommodate any missteps automatically.
 * The tricky part is for the app to know if the user is working
 * on site.... But I think that can be confirmed if the pegs are
 * both close by."
 *
 * THE FIX (js/geoloads.js):
 *   - SITE CONFIRMATION BY PAIR PROXIMITY: when the day's pickup
 *     point and dump point are CLOSE to each other, the site is
 *     CONFIRMED working ground for the day. "Close by" = the two
 *     ends fit inside the site's own believed scale — the pair
 *     separation is no more than the profile scale for the dump
 *     seed's ground (land-use prior or learned scale, whichever
 *     runs further: work 1200 m / unknown 450 m / residential
 *     300 m at first arm). Sources: the pegged pegs, the
 *     dispatch-given pair, or the learned pair. Re-evaluated on
 *     every re-arm (a re-peg / dispatch change); the count is
 *     never reset by it.
 *   - GENEROUS ZONE FROM THE START, on a confirmed site only:
 *     the counting reach around the known dump seed/cluster
 *     starts at the site-scale the profile already believes
 *     (max of the profile scale and the house 450 m shadow
 *     reach) — not only after proven faces grow it. A tip at a
 *     face moved tens to a few hundred metres counts by GPS
 *     from the first tip of the day, with no +1 needed.
 *   - SEPARATION BY SEQUENCE inside the one site: within the
 *     wide zone, which end a stop belongs to is decided by
 *     decisive proximity (nearer that end by more than the 10 m
 *     tie band) — a tie belongs to neither end. The visit
 *     counts at a dump-side stop and closes at a load-side
 *     stop; dwell + stop-cluster stillness + visit open/close
 *     + departure discipline stay the false-count guards.
 *   - NOT confirmed (pegs far apart, cross-town job): behaviour
 *     is exactly web 436 — learned reach, +1 teaching, profile
 *     growth. No widening.
 *   - The 436 +1 teaching, the GPS/tap split, and the same-
 *     place handling are untouched.
 *
 * Scenarios replay at the glue level (the 436 harness shape):
 *   A  same-site dispatch pair, 300 m apart (confirmed): the
 *      FIRST tip at a face 320 m off the dump pin counts by GPS
 *      from a short 80 s tip; a second moved face counts too.
 *   A2 work ground (1200 m scale): a face 700 m off the pin
 *      counts from the first tip.
 *   B  confirmed site: tip, then a washroom-length stop
 *      elsewhere on the site -> no extra count; return to the
 *      same face -> still no phantom; load, tip again -> counts.
 *   C  confirmed site: a drive-through at road speed counts
 *      nothing, even across the dump pin itself.
 *   D  far-apart pair (Aecon, ~2.1 km): NOT confirmed — the
 *      moved face still needs the first +1 teach, then counts
 *      (web 436 behaviour, pinned).
 *   E  mid-day re-peg from a far pair to a close pair: the
 *      confirmation turns on, the count is banked, and the
 *      first tip at a face 120 m off the new dump peg counts
 *      by GPS (peg counter, confirmed-site adoption).
 *   F  no-pair day (dump pin only): unchanged from 436.
 *
 * Run: node tools/count-site-confirm-widezone-v437-test.js
 * On web 436 bytes A/A2/E fail at the confirmation assertions
 * (no confirmed flag, moved faces miss or need the teach).
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
function havM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
function mkFeed(world, acc) {
  return function (tS, ll) { return world.feed({ latitude: ll[0], longitude: ll[1], accuracy: acc || 8, time: T0 + tS * 1000 }); };
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

/* the same-site job: load and dump pins 300 m apart */
const HOME = { lat: 51.15709, lng: -113.93862 };
const S_LOAD = { lat: 51.130000, lng: -114.000000 };
const S_DUMP = (function () { const p = goff(S_LOAD.lat, S_LOAD.lng, 300, 0); return { lat: p[0], lng: p[1] }; })();
const FACE_FAR = (function () { const p = goff(S_DUMP.lat, S_DUMP.lng, 0, 320); return { lat: p[0], lng: p[1] }; })();
const FACE_TOWARD = (function () { const p = goff(S_DUMP.lat, S_DUMP.lng, -120, 0); return { lat: p[0], lng: p[1] }; })();
const FACE_700 = (function () { const p = goff(S_DUMP.lat, S_DUMP.lng, 0, 700); return { lat: p[0], lng: p[1] }; })();
const WASH = (function () { const p = goff(S_DUMP.lat, S_DUMP.lng, 290, 290); return { lat: p[0], lng: p[1] }; })();
/* the far pair (the Nov 12 Aecon dispatch) */
const DSP_LOADPIN = { lat: 51.1252222, lng: -113.9828056 };
const DUMP = { lat: 51.1225089, lng: -114.0122197 };
const LOADFACE = { lat: 51.12442, lng: -113.98356 };
const FACE_A = (function () { const p = goff(DUMP.lat, DUMP.lng, 25, 15); return { lat: p[0], lng: p[1] }; })();
const M1 = (function () { const p = goff(DUMP.lat, DUMP.lng, 0, -300); return { lat: p[0], lng: p[1] }; })();
const M2 = (function () { const p = goff(DUMP.lat, DUMP.lng, 150, -300); return { lat: p[0], lng: p[1] }; })();
function cellKeyFor(lat, lng) { return Math.round(lat / 0.0014) + ':' + Math.round(lng / 0.0022); }

function closePairData(extraStore) {
  const dsp = { id: 'dsp-closesite', jobSite: 'Same-site job', dropoff: '', status: 'active',
    date: TODAY, scheduledAt: TODAY + 'T07:00:00',
    lat: S_LOAD.lat, lng: S_LOAD.lng, dumpLat: S_DUMP.lat, dumpLng: S_DUMP.lng };
  const d = { nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] },
    dsp_list: [dsp], dsp_active: dsp };
  if (extraStore) Object.keys(extraStore).forEach(function (k) { d[k] = extraStore[k]; });
  return d;
}
function aeconData() {
  const dsp = { id: 'dsp-nov12', jobSite: 'Aecon Trans', dropoff: '', status: 'active',
    date: TODAY, scheduledAt: TODAY + 'T09:00:00',
    lat: DSP_LOADPIN.lat, lng: DSP_LOADPIN.lng, dumpLat: DUMP.lat, dumpLng: DUMP.lng };
  return { nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] },
    dsp_list: [dsp], dsp_active: dsp };
}
function teachData() {
  const dsp = { id: 'dsp-nov12-teach', jobSite: 'Aecon Trans', dropoff: '', status: 'active',
    date: TODAY, scheduledAt: TODAY + 'T09:00:00',
    lat: DSP_LOADPIN.lat, lng: DSP_LOADPIN.lng };
  return { nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] },
    dsp_list: [dsp], dsp_active: dsp };
}
function dumpOnlyData() {
  const dsp = { id: 'dsp-dumponly', jobSite: 'Dump pin only', dropoff: '', status: 'active',
    date: TODAY, scheduledAt: TODAY + 'T07:00:00',
    dumpLat: DUMP.lat, dumpLng: DUMP.lng };
  return { nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] },
    dsp_list: [dsp], dsp_active: dsp };
}
function mach(w) { return w.GeoLoads.status().count; }
function ctr(w) { return w.GeoLoads.status().counter; }
function dayRec(store) {
  const d = store._data['geoloads'];
  return d && d.days ? d.days[TODAY] : null;
}
function dayPoints(store) {
  const r = dayRec(store);
  return (r && r.state && Array.isArray(r.state.points)) ? r.state.points : [];
}
function nearPoint(pts, p) {
  let best = Infinity;
  pts.forEach(function (q) { const d = havM(q, p); if (d < best) best = d; });
  return best;
}
function loadClose(feed, clock, pos) {
  driveTo(feed, clock, pos, S_LOAD, 60);
  park(feed, clock, S_LOAD, 240); /* the loading dwell closes the visit */
}
function creepTip(feed, clock, pos) {
  for (let k = 0; k < 12; k++) {
    feed(clock.t, [M1.lat, M1.lng]); clock.t += 10;
    feed(clock.t, [M2.lat, M2.lng]); clock.t += 10;
  }
  park(feed, clock, M2, 30);
  pos.lat = M2.lat; pos.lng = M2.lng;
}

console.log('geometry — the site and its faces');
ok(Math.abs(havM(S_LOAD, S_DUMP) - 300) < 3, 'the close pair sits 300 m apart — ' + Math.round(havM(S_LOAD, S_DUMP)) + ' m');
ok(Math.abs(havM(S_DUMP, FACE_FAR) - 320) < 3, 'the moved face is 320 m off the dump pin — ' + Math.round(havM(S_DUMP, FACE_FAR)) + ' m');
ok(Math.abs(havM(DSP_LOADPIN, DUMP) - 2076) < 20, 'the Aecon pair is ~2.1 km apart — ' + Math.round(havM(DSP_LOADPIN, DUMP)) + ' m');
ok(Math.abs(havM(S_DUMP, WASH) - 410) < 10 && havM(S_LOAD, WASH) > havM(S_DUMP, WASH) + 100,
  'the washroom stop sits off the dump end, on the site — ' + Math.round(havM(S_DUMP, WASH)) + ' m from the dump, ' + Math.round(havM(S_LOAD, WASH)) + ' m from the load');

/* ---------- A: the confirmed site, first tip at a moved face ---------- */
console.log('A — same-site pair: the first tip at a moved face counts by GPS');
(function () {
  const store = mkSharedStore(closePairData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, HOME, 60);
  const c0 = ctr(w);
  ok(c0 && c0.siteConfirmed === true, 'A0 the close pair is a CONFIRMED site at arm — ' + JSON.stringify(c0 && { siteConfirmed: c0.siteConfirmed, pairSepM: c0.pairSepM, zoneReachM: c0.zoneReachM }));
  ok(c0 && c0.pairSepM === 300, 'A0b the shipped "close by" reads the pair separation — pairSepM=' + (c0 && c0.pairSepM));
  driveTo(feed, clock, pos, S_LOAD, 240);
  park(feed, clock, S_LOAD, 240); /* load first: the loop is moving */
  driveTo(feed, clock, pos, FACE_FAR, 60);
  park(feed, clock, FACE_FAR, 80); /* a short tip at the moved face */
  ok(mach(w) === 1, 'A1 the FIRST tip at the moved face counts by GPS — machine=' + mach(w));
  ok(w.GeoLoads.today().count === 1 && w.GeoLoads.today().corr === 0,
    'A1b no tap was needed — today=' + w.GeoLoads.today().count + ', corr=' + w.GeoLoads.today().corr);
  loadClose(feed, clock, pos);
  driveTo(feed, clock, pos, FACE_TOWARD, 60);
  park(feed, clock, FACE_TOWARD, 150);
  ok(mach(w) === 2, 'A2 a second moved face counts too — machine=' + mach(w));
  loadClose(feed, clock, pos);
  driveTo(feed, clock, pos, S_DUMP, 60);
  park(feed, clock, S_DUMP, 150);
  ok(mach(w) === 3, 'A3 the pin face itself still counts — machine=' + mach(w));
  ok(w.GeoLoads.today().corr === 0, 'A3b the whole day is GPS-counted — corr=' + w.GeoLoads.today().corr);
})();

/* ---------- A2: work ground, 1200 m scale ---------- */
console.log('A2 — work ground: a face 700 m off the pin counts from the first tip');
(function () {
  const cells = {};
  cells[cellKeyFor(S_DUMP.lat, S_DUMP.lng)] = { use: 'work', t: Date.now() };
  const store = mkSharedStore(closePairData({ landuse_cells: { cells: cells } }));
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, HOME, 60);
  const c0 = ctr(w);
  ok(c0 && c0.siteConfirmed === true && c0.zoneReachM >= 1200,
    'A2-0 the work-ground site starts wide — zoneReachM=' + (c0 && c0.zoneReachM));
  driveTo(feed, clock, pos, S_LOAD, 240);
  park(feed, clock, S_LOAD, 240);
  driveTo(feed, clock, pos, FACE_700, 120);
  park(feed, clock, FACE_700, 80);
  ok(mach(w) === 1, 'A2-1 the first tip 700 m off the pin counts by GPS — machine=' + mach(w));
  ok(w.GeoLoads.today().corr === 0, 'A2-2 no tap — corr=' + w.GeoLoads.today().corr);
})();

/* ---------- B: washroom stop on a confirmed site ---------- */
console.log('B — tip, washroom stop on the site, back to the same face, tip again');
(function () {
  const store = mkSharedStore(closePairData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, HOME, 60);
  driveTo(feed, clock, pos, S_LOAD, 240);
  park(feed, clock, S_LOAD, 240);
  driveTo(feed, clock, pos, FACE_FAR, 60);
  park(feed, clock, FACE_FAR, 150);
  ok(mach(w) === 1, 'B1 the tip counts — machine=' + mach(w));
  driveTo(feed, clock, pos, WASH, 60);
  park(feed, clock, WASH, 180); /* a washroom-length stop elsewhere on the site */
  ok(mach(w) === 1, 'B2 the washroom stop adds NO count — machine=' + mach(w));
  driveTo(feed, clock, pos, FACE_FAR, 60);
  park(feed, clock, FACE_FAR, 150); /* back to the same face, still carrying the same visit */
  ok(mach(w) === 1, 'B3 returning to the same face is the SAME visit — no phantom — machine=' + mach(w));
  loadClose(feed, clock, pos);
  ok(mach(w) === 1, 'B4 loading closes the visit, counts nothing — machine=' + mach(w));
  driveTo(feed, clock, pos, FACE_FAR, 60);
  park(feed, clock, FACE_FAR, 150);
  ok(mach(w) === 2, 'B5 leave and return loaded: the next tip counts — machine=' + mach(w));
})();

/* ---------- C: drive-through at road speed ---------- */
console.log('C — a drive-through of the site counts nothing');
(function () {
  const store = mkSharedStore(closePairData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, HOME, 60);
  const west = (function () { const p = goff(S_DUMP.lat, S_DUMP.lng, -700, 150); return { lat: p[0], lng: p[1] }; })();
  const east = (function () { const p = goff(S_DUMP.lat, S_DUMP.lng, 700, 150); return { lat: p[0], lng: p[1] }; })();
  driveTo(feed, clock, pos, west, 240);
  driveTo(feed, clock, pos, east, 90); /* straight across the site, over the dump pin itself */
  park(feed, clock, east, 60);
  ok(mach(w) === 0, 'C1 the drive-through counts nothing — machine=' + mach(w));
  ok(w.GeoLoads.today().count === 0, 'C1b the card reads zero — today=' + w.GeoLoads.today().count);
})();

/* ---------- D: the far pair stays web 436 ---------- */
console.log('D — far pair: NOT confirmed; the moved face still needs the first +1');
(function () {
  const store = mkSharedStore(aeconData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, HOME, 60);
  const c0 = ctr(w);
  ok(!c0 || c0.siteConfirmed !== true, 'D0 the Aecon pair is NOT a confirmed site — ' + JSON.stringify(c0 && { siteConfirmed: c0.siteConfirmed, pairSepM: c0.pairSepM }));
  driveTo(feed, clock, pos, LOADFACE, 300);
  park(feed, clock, LOADFACE, 120);
  w.GeoLoads.setPeg('load');
  park(feed, clock, LOADFACE, 60);
  driveTo(feed, clock, pos, FACE_A, 240);
  park(feed, clock, FACE_A, 300);
  ok(mach(w) === 1, 'D1 the first tip at the pin face counts by GPS — machine=' + mach(w));
  driveTo(feed, clock, pos, LOADFACE, 240);
  park(feed, clock, LOADFACE, 240);
  driveTo(feed, clock, pos, M1, 240);
  creepTip(feed, clock, pos);
  ok(mach(w) === 1, 'D2 the tip at the moved face is MISSED, as on 436 — machine=' + mach(w));
  w.GeoLoads.nudge(1); /* his +1 at the moved face */
  ok(w.GeoLoads.today().count === 2 && w.GeoLoads.today().corr === 1,
    'D3 the +1 counts it and teaches it — today=' + w.GeoLoads.today().count + ', corr=' + w.GeoLoads.today().corr);
  ok(nearPoint(dayPoints(store), M2) <= 25, 'D3b the face is taught — nearest ' + Math.round(nearPoint(dayPoints(store), M2)) + ' m');
  driveTo(feed, clock, pos, LOADFACE, 240);
  park(feed, clock, LOADFACE, 240);
  driveTo(feed, clock, pos, M2, 240);
  park(feed, clock, M2, 300);
  ok(mach(w) === 2, 'D4 the next tip there counts by GPS — machine=' + mach(w));
  ok(w.GeoLoads.today().count === 3 && w.GeoLoads.today().corr === 1,
    'D4b the split stays honest — today=' + w.GeoLoads.today().count + ', corr=' + w.GeoLoads.today().corr);
})();

/* ---------- E: mid-day re-peg far -> close ---------- */
console.log('E — re-peg from a far pair to a close pair: confirmation turns on, count banked');
(function () {
  const store = mkSharedStore(aeconData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, HOME, 60);
  driveTo(feed, clock, pos, LOADFACE, 300);
  park(feed, clock, LOADFACE, 120);
  w.GeoLoads.setPeg('load');
  park(feed, clock, LOADFACE, 60);
  driveTo(feed, clock, pos, FACE_A, 240);
  park(feed, clock, FACE_A, 300);
  ok(mach(w) === 1, 'E1 the far-pair tip counts — machine=' + mach(w));
  /* the job changes: the new site is one ground, load and dump
     300 m apart — he pegs both ends there. */
  driveTo(feed, clock, pos, S_LOAD, 300);
  park(feed, clock, S_LOAD, 60);
  const rp1 = w.GeoLoads.setPeg('load');
  ok(rp1 && rp1.ok, 'E2 the load re-peg lands — ' + JSON.stringify(rp1));
  ok(w.GeoLoads.today().count === 1, 'E2b the count is banked through the re-peg — today=' + w.GeoLoads.today().count);
  driveTo(feed, clock, pos, S_DUMP, 60);
  park(feed, clock, S_DUMP, 60);
  const rp2 = w.GeoLoads.setPeg('dump');
  ok(rp2 && rp2.ok, 'E3 the dump re-peg lands — ' + JSON.stringify(rp2));
  ok(w.GeoLoads.today().count === 1, 'E3b still banked — today=' + w.GeoLoads.today().count);
  ok(w.GeoLoads.today().countSource === 'pegs', 'E3c the close pair runs the peg counter — source=' + w.GeoLoads.today().countSource);
  const cE = ctr(w);
  ok(cE && cE.siteConfirmed === true, 'E3d the re-pegged pair is CONFIRMED — ' + JSON.stringify(cE && { siteConfirmed: cE.siteConfirmed, pairSepM: cE.pairSepM }));
  driveTo(feed, clock, pos, S_LOAD, 60);
  park(feed, clock, S_LOAD, 150); /* the pickup arms the cycle */
  /* the face 120 m off the new dump peg TOWARD the load peg:
     on 436 the inner shadow refuses this ground (it sits inside
     the load's shadow reach) and the recovery walk spends the
     whole short tip catching up — the tip dies uncountered. */
  const facePeg = (function () { const p = goff(S_DUMP.lat, S_DUMP.lng, -120, 0); return { lat: p[0], lng: p[1] }; })();
  driveTo(feed, clock, pos, facePeg, 60);
  park(feed, clock, facePeg, 75); /* one short tip at a face 120 m off the new dump peg */
  ok(mach(w) === 2, 'E4 the first tip at the moved face counts by GPS — machine=' + mach(w));
  ok(w.GeoLoads.today().corr === 0, 'E4b no tap anywhere on this day — corr=' + w.GeoLoads.today().corr);
  const cen = dayRec(store) && dayRec(store).pegCentres && dayRec(store).pegCentres.dump;
  ok(cen && havM(cen, facePeg) <= 40, 'E4c the dump centre sits ON the face it adopted — ' + (cen ? Math.round(havM(cen, facePeg)) : -1) + ' m off');
})();

/* ---------- F: no-pair day, unchanged from 436 ---------- */
console.log('F — a lone dump peg, no pair at all: no confirmation, 436 behaviour');
(function () {
  /* a day with NO dispatch and ONE peg (the dump, planted where
     he tips): the visit counter arms on the peg alone. There is
     no pair, so there is nothing to confirm — the day must run
     exactly as web 436 ran it (verified byte-for-byte against
     the 436 tree: every step below reads identically there). */
  const store = mkSharedStore({ nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] } });
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, HOME, 60);
  driveTo(feed, clock, pos, DUMP, 300);
  park(feed, clock, DUMP, 60);
  const pr = w.GeoLoads.setPeg('dump');
  ok(pr && pr.ok, 'F0 the lone dump peg plants — ' + JSON.stringify(pr));
  const c0 = ctr(w);
  ok(c0 && c0.siteConfirmed !== true, 'F0b no pair, no confirmation — ' + JSON.stringify(c0 && { siteConfirmed: c0.siteConfirmed }));
  park(feed, clock, DUMP, 240);
  ok(mach(w) === 1, 'F1 the tip at the peg counts — machine=' + mach(w));
  /* the cross-town legs run at road speed (120 s for ~2 km):
     the foreign-dwell close judges a road-reached stop, as the
     house law writes it */
  driveTo(feed, clock, pos, LOADFACE, 120);
  park(feed, clock, LOADFACE, 240);
  driveTo(feed, clock, pos, M1, 120);
  creepTip(feed, clock, pos);
  ok(mach(w) === 1, 'F2 the moved face still misses without a pair — machine=' + mach(w));
  w.GeoLoads.nudge(1);
  ok(w.GeoLoads.today().count === 2 && w.GeoLoads.today().corr === 1,
    'F3 the +1 teaches it — today=' + w.GeoLoads.today().count + ', corr=' + w.GeoLoads.today().corr);
  ok(nearPoint(dayPoints(store), M2) <= 25, 'F3b the face is taught — nearest ' + Math.round(nearPoint(dayPoints(store), M2)) + ' m');
  driveTo(feed, clock, pos, LOADFACE, 120);
  park(feed, clock, LOADFACE, 240);
  driveTo(feed, clock, pos, M2, 120);
  park(feed, clock, M2, 300);
  ok(mach(w) === 2, 'F4 the next tip there counts by GPS — machine=' + mach(w));
  ok(w.GeoLoads.today().count === 3 && w.GeoLoads.today().corr === 1,
    'F4b the split stays honest — today=' + w.GeoLoads.today().count + ', corr=' + w.GeoLoads.today().corr);
})();

console.log('\n' + passed + ' passed / ' + failed + ' failed');
process.exit(failed ? 1 : 0);
