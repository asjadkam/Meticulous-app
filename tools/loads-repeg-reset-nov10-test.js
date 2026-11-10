'use strict';
/*
 * loads-repeg-reset-nov10-test.js — LOADS-REPEG-RESET-NOV10 +
 * LOADS-CLOSE-STARVED-NOV10 (Nov 10, 2026, live field evidence).
 *
 * TWO defects from the owner's real Nov 10 day, one bench:
 *
 * (1) THE RE-PEG RESET. The day ran dispatch-pins mode (load pin =
 *     his 8:39 AM manual pickup peg, dump pin on the dispatch).
 *     GPS counted loads #1, #2; #3–#5 were his +1 taps (corr +3);
 *     the card read "Loads today: 5". At 12:20 he re-pegged the
 *     PICKUP at his current face — a spot ~126 m from the dump pin,
 *     so the resolved pair reads sites-too-close and configure()
 *     takes the PATTERN branch. That branch zeroed baseCount for a
 *     same-session day (baseCount = (!sameN && prevN) ? count : 0)
 *     and discarded the armed counter (counter = null). The day
 *     record itself kept the count (setPeg persists BEFORE the
 *     reconfigure, and persist() writes rec.count only when a
 *     counter exists), and today() reads the record — but the
 *     dashboard card falls back to raw session taps when no
 *     counter is armed (app.js: machineLoads !== null ? machine
 *     : taps), and session taps were 0 — his taps had gone to corr
 *     while armed. The card showed "Loads today: 0". The same
 *     same-session zeroing sat in the teach branch and the lone
 *     pickup-peg teach branch. Worse: had a pattern pair proved
 *     before he re-pegged the dump, armPatternPair's persist would
 *     have written rec.count = 0 + credits OVER the banked 5 —
 *     the display bug had a data-destruction path behind it.
 *     FIX: the three branches bank the day record's WHOLE count
 *     (the armed branch's own discipline; a key-matching snapshot
 *     restore still overrides via the existing savedP/savedT
 *     adjustments), and the dashboard card + glance fall back to
 *     the day record's banked count (max of taps and banked)
 *     instead of taps alone.
 *
 * (2) THE CLOSE-STARVED VISIT COUNTER. After load #2 today, GPS
 *     counting stopped for the rest of the day on a NO-re-peg
 *     stretch. Convicted here (world B): the dump-visit counter's
 *     visitCounted resets ONLY on a load-end close — a 45 s dwell
 *     within 250 m of the load-end peg — or a far exit beyond
 *     VISIT_SPAN_M (3500 m; this loop is ~2 km, so it never
 *     fires). When the loading face sits ~300 m off the morning
 *     peg (the excavator moved), the close never builds:
 *     visitCounted stays true forever and every later dump
 *     arrival is the "same visit" — loads #3, #4, #5 eaten
 *     silently. FIX: the close gains the v405 visit shadow's own
 *     recovery reach — a still dwell within VISIT_SHADOW_M
 *     (450 m) of a known other end, beyond that reach of every
 *     dump point, accumulates toward the same close through the
 *     same shadow discipline (cluster stillness + gap grace).
 *
 * (3) THE LABEL. today().count folds the driver's corrections
 *     (corr) into the total, and the card labelled the whole
 *     total "counted by GPS" — today 3 of the 5 were his taps.
 *     FIX (app.js): when corr != 0 the suffix names the split
 *     ("2 counted by GPS · +3 your taps"); corr == 0 keeps the
 *     exact legacy wording.
 *
 * Worlds (dispatch-pins day geometry = the real Nov 10 day):
 *   W1 the flip: 2 GPS loops + 3 taps = 5, re-peg pickup 126 m
 *      from the dump pin -> the count must survive on the card,
 *      in status(), and in the record; then peg the dump -> the
 *      day re-arms at 5.
 *   W2 the moved load face: load dwells ~300 m off the peg from
 *      cycle 2 -> every tip must still count.
 *   W2b same, highway-speed legs.
 *   C  controls at pristine behaviour: pin-face loops; a far
 *      (600 m) face landing at the close (the v405 G5 shape).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const geoSrc = fs.readFileSync(path.join(ROOT, 'js', 'geoloads.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const RealDate = Date;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

/* ---------- world scaffolding (the Nov 10 day, as the v405 bench) ---------- */
function mkSharedStore(data) {
  data = data || {};
  return {
    get: function (k, d) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : d; },
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
  return { GeoLoads: sb.GeoLoads, feed: function (fix) { return handler(fix); } };
}
const NOW = new RealDate();
const T0 = new RealDate(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 6, 0, 0).getTime();
const STILL = [[0, 0], [15, 10], [-12, 8], [10, -14], [-8, -10]];
function goff(lat, lng, eM, nM) { return [lat + nM / 111320, lng + eM / (111320 * Math.cos(lat * Math.PI / 180))]; }
function goffO(c, eM, nM) { const p = goff(c.lat, c.lng, eM, nM); return { lat: p[0], lng: p[1] }; }
function mkFeed(world) {
  return function (tS, ll) {
    return world.feed({ latitude: ll[0], longitude: ll[1], accuracy: 8, time: T0 + tS * 1000 });
  };
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
const DSP_LOADPIN = { lat: 51.1252222, lng: -113.9828056 };   // dispatch "Go Empty To"
const DUMP = { lat: 51.1225089, lng: -114.0122197 };          // dispatch "Hauling To"
const LOADFACE = { lat: 51.12442, lng: -113.98356 };          // his 8:39 AM pickup peg
const LOADFACE2 = goffO(LOADFACE, 300, 40);                   // the moved loading face (~303 m off the peg)
const FACE_A = goffO(DUMP, 25, 15);                           // a tip face on the pin
const FACE_FAR = goffO(DUMP, -450, 400);                      // ~602 m out (pending rail)
const REPEG = { lat: 51.122652, lng: -114.010428 };           // his 12:20 re-peg spot (~126 m from the dump pin)

function distM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLa = (b.lat - a.lat) * rad, dLn = (b.lng - a.lng) * rad;
  const h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLn / 2) * Math.sin(dLn / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}
function gdstr(ts) {
  const d = new RealDate(ts);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const TODAY = gdstr(T0);
function baseData() {
  const dsp = {
    id: 'dsp-nov10', jobSite: 'Aecon Trans', dropoff: '', status: 'active',
    date: TODAY, scheduledAt: TODAY + 'T08:30:00',
    lat: DSP_LOADPIN.lat, lng: DSP_LOADPIN.lng, dumpLat: DUMP.lat, dumpLng: DUMP.lng
  };
  return {
    nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] },
    dsp_list: [dsp], dsp_active: dsp
  };
}
function prologue(w, feed, clock, pos) {
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, HOME, 60);
  driveTo(feed, clock, pos, LOADFACE, 300);
  park(feed, clock, LOADFACE, 120);
  w.GeoLoads.setPeg('load'); // the 8:39 AM manual pickup peg, on top of the dispatch pins
  park(feed, clock, LOADFACE, 60);
}
function loop(w, feed, clock, pos, face, loadFace, driveS) {
  driveTo(feed, clock, pos, face, driveS || 240);
  park(feed, clock, face, 300);
  driveTo(feed, clock, pos, loadFace || LOADFACE, driveS || 240);
  park(feed, clock, loadFace || LOADFACE, 240);
}

/* ================= W1 — the 12:20 flip ================= */
console.log('W1 the re-peg flip (2 GPS + 3 taps = 5, re-peg 126 m from the dump pin)');
ok('W1 geometry: the re-peg spot sits inside the 250 m too-close bar of the dump pin',
  distM(REPEG, DUMP) < 250, distM(REPEG, DUMP).toFixed(0) + ' m');
{
  const store = mkSharedStore(baseData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w); const clock = { t: 0 }; const pos = { lat: HOME.lat, lng: HOME.lng };
  prologue(w, feed, clock, pos);
  loop(w, feed, clock, pos, FACE_A);
  loop(w, feed, clock, pos, FACE_A);
  ok('W1 loads #1, #2 counted by GPS', w.GeoLoads.today().count === 2, 'today=' + w.GeoLoads.today().count);
  w.GeoLoads.nudge(1); w.GeoLoads.nudge(1); w.GeoLoads.nudge(1); // #3, #4, #5 by hand
  const before = w.GeoLoads.today();
  ok('W1 card total before the flip is 5 (2 GPS + 3 taps)', before.count === 5 && before.corr === 3 && before.armed === true,
    JSON.stringify(before));
  driveTo(feed, clock, pos, REPEG, 150);
  park(feed, clock, REPEG, 20); // he taps the peg promptly — no arrival dwell first
  ok('W1 standing at the re-peg spot briefly did not itself count', w.GeoLoads.status().count === 2,
    'machine=' + w.GeoLoads.status().count);
  const r = w.GeoLoads.setPeg('load');
  ok('W1 the re-peg lands', !!(r && r.ok), JSON.stringify(r));
  const after = w.GeoLoads.today();
  /* ALSO-REPORT pins (true before and after the fix): the day
     record itself was never erased by the re-peg. */
  const fd = w.GeoLoads.forDate(TODAY);
  ok('W1 ALSO-REPORT: the day record still holds the 5 after the re-peg', fd && fd.count === 5 && fd.corr === 3,
    fd ? ('count=' + fd.count + ' corr=' + fd.corr) : 'no record');
  ok('W1 the live read still reports the day total 5', after.count === 5, 'today=' + after.count);
  ok('W1 the machine stands down in too-close mode (honest state)', after.armed === false, 'armed=' + after.armed);
  /* THE FIX: the banked base carries the day — status() (the
     Preferences readout; its count is the MACHINE count, corr
     rides separately) must not read 0 for a day whose machine
     counted 2 and whose driver tapped 3. */
  ok('W1 FIX: status carries the banked machine 2 + corr 3, not 0',
    w.GeoLoads.status().count === 2 && w.GeoLoads.status().corr === 3,
    'status=' + w.GeoLoads.status().count + ' corr=' + w.GeoLoads.status().corr);
  /* keep working in the blind window: a further tap stacks on the
     banked day, never restarts it */
  w.GeoLoads.nudge(1);
  ok('W1 a tap after the flip stacks on the banked day (6)', w.GeoLoads.today().count === 6,
    'today=' + w.GeoLoads.today().count);
  w.GeoLoads.nudge(-1);
  /* peg the dump at the real face — his next step in the field */
  driveTo(feed, clock, pos, FACE_A, 60);
  park(feed, clock, FACE_A, 20);
  const r2 = w.GeoLoads.setPeg('dump');
  const re = w.GeoLoads.today();
  ok('W1 pegging the dump re-arms the day', !!(r2 && r2.ok) && re.armed === true, JSON.stringify(r2) + ' armed=' + re.armed);
  ok('W1 the re-armed day still reads 5', re.count === 5, 'today=' + re.count);
}

/* ================= W2 — the moved load face (close starved) ================= */
console.log('W2 the load face moves ~300 m off the peg after cycle 1');
{
  const store = mkSharedStore(baseData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w); const clock = { t: 0 }; const pos = { lat: HOME.lat, lng: HOME.lng };
  prologue(w, feed, clock, pos);
  loop(w, feed, clock, pos, FACE_A, LOADFACE, 150);
  ok('W2 load #1 counted, closed at the peg', w.GeoLoads.today().count === 1, 'today=' + w.GeoLoads.today().count);
  loop(w, feed, clock, pos, FACE_A, LOADFACE2, 150);
  ok('W2 load #2 counted', w.GeoLoads.today().count === 2, 'today=' + w.GeoLoads.today().count);
  loop(w, feed, clock, pos, FACE_A, LOADFACE2, 150);
  ok('W2 FIX: load #3 counts though the load face moved (the close lands in the recovery reach)',
    w.GeoLoads.today().count === 3, 'today=' + w.GeoLoads.today().count);
  loop(w, feed, clock, pos, FACE_A, LOADFACE2, 150);
  ok('W2 FIX: load #4 counts too — counting never stalls', w.GeoLoads.today().count === 4,
    'today=' + w.GeoLoads.today().count);
}
console.log('W2b the moved load face, highway-speed legs');
{
  const store = mkSharedStore(baseData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w); const clock = { t: 0 }; const pos = { lat: HOME.lat, lng: HOME.lng };
  prologue(w, feed, clock, pos);
  loop(w, feed, clock, pos, FACE_A, LOADFACE2, 90);
  loop(w, feed, clock, pos, FACE_A, LOADFACE2, 90);
  loop(w, feed, clock, pos, FACE_A, LOADFACE2, 90);
  ok('W2b three loads counted with the load face off the peg all day', w.GeoLoads.today().count === 3,
    'today=' + w.GeoLoads.today().count);
}

/* ================= C — controls (pristine shapes) ================= */
console.log('C controls');
{
  const store = mkSharedStore(baseData());
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w); const clock = { t: 0 }; const pos = { lat: HOME.lat, lng: HOME.lng };
  prologue(w, feed, clock, pos);
  loop(w, feed, clock, pos, FACE_A);
  loop(w, feed, clock, pos, FACE_A);
  ok('C pin-face loops with peg dwells count 2', w.GeoLoads.today().count === 2, 'today=' + w.GeoLoads.today().count);
  /* the far face: the visit pends and lands at the loop's close */
  driveTo(feed, clock, pos, FACE_FAR, 240);
  park(feed, clock, FACE_FAR, 300);
  driveTo(feed, clock, pos, LOADFACE, 240);
  park(feed, clock, LOADFACE, 240);
  ok('C a 600 m face still lands its load at the close (pending rail intact)', w.GeoLoads.today().count === 3,
    'today=' + w.GeoLoads.today().count);
}

/* ================= app.js display pins ================= */
console.log('app.js display wiring');
ok('the card falls back to the banked day count, not taps alone',
  appSrc.includes('bankedLoads') && !appSrc.includes('var shownLoads = (machineLoads !== null) ? machineLoads : taps;'));
ok('the suffix names the split when the driver tapped (no GPS claim for taps)',
  appSrc.includes('your tap'));
ok('the glance agrees with the card (max of banked and taps)',
  appSrc.includes('Math.max(gt.count, taps)'));

console.log('\nloads-repeg-reset-nov10: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
