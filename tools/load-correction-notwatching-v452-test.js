#!/usr/bin/env node
/* LOAD-CORRECTION-DEAD-WHEN-NOT-WATCHING (Nov 13, 2026): the
 * Nov 13 close-out ran in the desktop web book, signed in as
 * the driver. The day's count stood at 5; the signed cards say
 * 4. The −1 correction was tapped five times (including by its
 * on-screen label, and once after a full reload) and +1 once:
 * the count never moved from 5, the card kept reading "+2 your
 * taps", and the wrong 5 persisted into the Manifest after the
 * day closed.
 *
 * THE GAP (proven in the shipped code, web 451):
 * GeoLoads.startDay is inert when there is no location stream
 * ("no watcher, no data") — a desktop browser never arms the
 * counting engine, so the engine is NOT watching the day in
 * that page. But GeoLoads.today() reads the day ARMED from its
 * saved record alone (armed = the record carries sites), so
 * js/app.js routes the hero taps to GeoLoads.nudge — and nudge
 * refused outright unless the engine was live-watching
 * (!curDate || !watching → null). The tap fell back to the
 * session tap count, which neither the armed day's card (it
 * reads the record's count + corr) nor the Manifest
 * (GeoLoads.forDate: rec.count + rec.corr) ever reads. The one
 * door that could fix a wrong count by hand was dead in
 * exactly the page where close-out happens.
 *
 * THE FIX (js/geoloads.js, nudge only): when the engine is not
 * watching, a page holds no live state to protect — the tap is
 * the driver's signed correction to TODAY's record, so write
 * it straight onto that record with the live door's own clamp
 * (the displayed total floors at 0; extra −1 taps bank no
 * invisible debt) and persist it at once via writeDay. Only
 * corr and updatedAt move on the record. No record for today
 * → null, and the caller's session-tap fallback stands exactly
 * as before. The live (watching) path is byte-identical.
 *
 * Scenarios:
 *   A  the Nov 13 close-out replayed at the glue level: the
 *      phone's day record (machine 3 + corr +2 = 5, peg sites
 *      on file) sits in the store; the page has NO location
 *      stream (LiveMiles unavailable, startDay inert). The
 *      app-glue tap sequence — −1 five times, +1 once, then
 *      steering taps — must move the RECORD's correction, the
 *      card read (today) and the Manifest read (forDate) at
 *      once, floor at zero with no banked debt, leave every
 *      other record field untouched, and survive a full page
 *      reload over the same store.
 *   B  guardrails: no record for today → nudge returns null
 *      (the session-tap fallback stands); a record for
 *      YESTERDAY only → null, and that record is untouched;
 *      a today record without sites → the correction still
 *      lands on corr alone (count/sites/events unmoved).
 *   C  the live door unchanged: with a location stream the
 *      engine watches and arms from the dispatch pins, and
 *      nudge moves the live correction exactly as web 451 did.
 *
 * Run: node tools/load-correction-notwatching-v452-test.js
 * On web 451 bytes A fails at the nudge assertions (the door
 * returns null; the record never moves); B/C pass on both.
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
function mkGeoWorld(store, src, lmAvailable) {
  const sb = { console: console, Date: RealDate, Math: Math, JSON: JSON };
  sb.window = sb;
  let handler = null;
  sb.LiveMiles = { available: function () { return !!lmAvailable; }, subscribe: function (fn) { handler = fn; } };
  sb.App = { _store: store };
  vm.createContext(sb);
  vm.runInContext(src, sb);
  if (!sb.GeoLoads) throw new Error('GeoLoads not exposed');
  return { GeoLoads: sb.GeoLoads, feed: function (fix) { return handler && handler(fix); } };
}
const NOW = new RealDate();
const T0 = new RealDate(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 6, 0, 0).getTime();
function gdstr(ts) {
  const d = new RealDate(ts);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const TODAY = gdstr(T0);
const YDAY = gdstr(T0 - 24 * 3600 * 1000);

/* the Nov 13 day's geometry — the Aecon pair the phone pegged */
const LOAD = { lat: 51.12442, lng: -113.98356 };
const DUMP = { lat: 51.1225089, lng: -114.0122197 };
const DSP_LOADPIN = { lat: 51.1252222, lng: -113.9828056 };
const HOME = { lat: 51.15709, lng: -113.93862 };

/* the phone's day record as the cloud left it in the web book:
   machine counted 3 from the pegs, the driver tapped +2 by
   hand during the day, the cards say the day was 4 loads. */
function nov13Record() {
  return {
    date: TODAY, dispatchId: 'dsp-nov13-2', sessionKey: 's' + T0,
    count: 3, corr: 2, handCarry: 0,
    sites: { load: { lat: LOAD.lat, lng: LOAD.lng, src: 'peg' }, dump: { lat: DUMP.lat, lng: DUMP.lng, src: 'peg' } },
    pegs: { load: { lat: LOAD.lat, lng: LOAD.lng, at: T0 + 3600000 }, dump: { lat: DUMP.lat, lng: DUMP.lng, at: T0 + 5040000 } },
    countSource: 'pegs',
    events: [{ site: 'dump', t: T0 + 7200000 }, { site: 'dump', t: T0 + 10800000 }, { site: 'dump', t: T0 + 14400000 }],
    updatedAt: Date.now()
  };
}
function dayRec(store, date) {
  const d = store._data['geoloads'];
  return d && d.days ? (d.days[date || TODAY] || null) : null;
}

/* the app.js hero-tap glue, mirrored line for line from
   trackerAddLoadTap / trackerCutLoadTap (js/app.js): armed →
   GeoLoads.nudge consumes (non-null); anything else falls back
   to the session tap count. Returns 'nudge' or 'fallback'. */
function mkGlue(GeoLoads, session) {
  function tap(delta) {
    let t = null;
    try { t = GeoLoads.today(); } catch (e) {}
    if (t && t.armed && GeoLoads.nudge) {
      if (GeoLoads.nudge(delta) !== null) return 'nudge';
    }
    if (delta > 0) session.manualLoads += 1;
    else session.manualLoads = Math.max(0, session.manualLoads - 1);
    return 'fallback';
  }
  return { add: function () { return tap(1); }, cut: function () { return tap(-1); } };
}

/* ---------- A: the Nov 13 close-out, replayed ---------- */
console.log('A — close-out in a page with no location stream: the correction must land on the record');
{
  const data = {};
  data['geoloads'] = { days: {} };
  data['geoloads'].days[TODAY] = nov13Record();
  const before = JSON.stringify(dayRec(mkSharedStore(data)));
  const store = mkSharedStore(data);
  const w = mkGeoWorld(store, geoSrc, false); // desktop browser: no LiveMiles stream
  const G = w.GeoLoads;

  const started = G.startDay('s' + T0, {});
  ok(started === false && G.status().watching === false,
    'A0 the engine is NOT watching in this page (startDay inert without a location stream)');
  const t0 = G.today();
  ok(t0.armed === true && t0.count === 5 && t0.corr === 2,
    'A1 the card reads the record as he saw it: armed, 5 loads, +2 your taps (got armed=' + t0.armed + ' count=' + t0.count + ' corr=' + t0.corr + ')');
  ok(G.forDate(TODAY).count === 5, 'A1b the Manifest read (forDate) stands at the wrong 5 before any tap');

  const session = { manualLoads: 2 }; // his session taps from the phone day
  const glue = mkGlue(G, session);

  ok(glue.cut() === 'nudge', 'A2 the first −1 is consumed by the correction door, not the fallback');
  const t1 = G.today();
  ok(t1.count === 4 && t1.corr === 1, 'A3 the card moves at once: 4 loads, +1 your taps (got ' + t1.count + '/+' + t1.corr + ')');
  ok(G.forDate(TODAY).count === 4, 'A3b the Manifest read moves with it: 4 — the signed cards\' number');
  ok(session.manualLoads === 2, 'A3c the session tap count is untouched — the correction rode the record');

  glue.cut(); glue.cut(); glue.cut(); glue.cut(); // his five −1 in total
  const t2 = G.today();
  ok(t2.count === 0 && t2.corr === -3, 'A4 five −1 in total floor the day at 0 (corr clamps at −machine, got count=' + t2.count + ' corr=' + t2.corr + ')');
  ok(glue.add() === 'nudge' && G.today().count === 1 && G.today().corr === -2,
    'A5 his +1 lands at once (1 load) — the extra −1 taps banked no invisible debt');
  glue.add(); glue.add(); glue.add(); // steering back to the cards' number
  const t3 = G.today();
  ok(t3.count === 4 && t3.corr === 1, 'A6 the correction steers back to exactly the cards\' 4 (got ' + t3.count + '/+' + t3.corr + ')');
  ok(dayRec(store).corr === 1, 'A6b the record in the store carries corr 1 — persisted, not page memory');

  const after = dayRec(store);
  const b4 = JSON.parse(before);
  ok(after.count === b4.count && after.countSource === b4.countSource &&
     JSON.stringify(after.sites) === JSON.stringify(b4.sites) &&
     JSON.stringify(after.pegs) === JSON.stringify(b4.pegs) &&
     JSON.stringify(after.events) === JSON.stringify(b4.events) &&
     after.dispatchId === b4.dispatchId && after.sessionKey === b4.sessionKey,
    'A7 nothing else on the record moved — count, sites, pegs, events, source all byte-identical');

  /* his full reload, replayed: a fresh page life over the same store */
  const w2 = mkGeoWorld(mkSharedStore(data), geoSrc, false);
  const rt = w2.GeoLoads.today();
  ok(rt.count === 4 && rt.corr === 1 && w2.GeoLoads.forDate(TODAY).count === 4,
    'A8 after a full reload the corrected 4 still stands (got ' + rt.count + '/+' + rt.corr + ')');
}

/* ---------- B: guardrails ---------- */
console.log('B — the fallback and other days stand exactly as before');
{
  /* no record at all: the machine has nothing, taps are the count */
  const storeB1 = mkSharedStore({});
  const wB1 = mkGeoWorld(storeB1, geoSrc, false);
  ok(wB1.GeoLoads.today().armed === false, 'B1 no record reads unarmed');
  ok(wB1.GeoLoads.nudge(1) === null && wB1.GeoLoads.nudge(-1) === null,
    'B1b with no day record the door returns null — the caller\'s session-tap fallback stands');
  const sB1 = { manualLoads: 0 };
  ok(mkGlue(wB1.GeoLoads, sB1).add() === 'fallback' && sB1.manualLoads === 1,
    'B1c the glue falls back to the session tap count, as web 451 did');

  /* only yesterday has a record: a tap today must not touch it */
  const dataB2 = { geoloads: { days: {} } };
  const yRec = nov13Record(); yRec.date = YDAY; yRec.count = 2; yRec.corr = 1;
  dataB2['geoloads'].days[YDAY] = yRec;
  const storeB2 = mkSharedStore(dataB2);
  const wB2 = mkGeoWorld(storeB2, geoSrc, false);
  ok(wB2.GeoLoads.nudge(-1) === null, 'B2 a −1 with no record for TODAY returns null');
  ok(dayRec(storeB2, YDAY).corr === 1 && dayRec(storeB2, YDAY).count === 2,
    'B2b yesterday\'s record is untouched, digit for digit');

  /* a today record with no sites: correction lands on corr alone */
  const dataB3 = { geoloads: { days: {} } };
  const rB3 = nov13Record(); rB3.sites = null; rB3.pegs = { load: null, dump: null };
  dataB3['geoloads'].days[TODAY] = rB3;
  const storeB3 = mkSharedStore(dataB3);
  const wB3 = mkGeoWorld(storeB3, geoSrc, false);
  ok(wB3.GeoLoads.nudge(-1) === 1 && dayRec(storeB3).corr === 1 && dayRec(storeB3).count === 3 && dayRec(storeB3).sites === null,
    'B3 a siteless record still takes its correction on corr alone (count and sites unmoved)');
}

/* ---------- C: the live door, unchanged ---------- */
console.log('C — a watching page corrects exactly as web 451 did');
{
  const dsp = { id: 'dsp-nov13-live', jobSite: 'Aecon Trans', dropoff: '', status: 'active',
    date: TODAY, scheduledAt: TODAY + 'T09:00:00',
    lat: DSP_LOADPIN.lat, lng: DSP_LOADPIN.lng, dumpLat: DUMP.lat, dumpLng: DUMP.lng };
  const dataC = { nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] },
    dsp_list: [dsp], dsp_active: dsp };
  const storeC = mkSharedStore(dataC);
  const wC = mkGeoWorld(storeC, geoSrc, true); // the phone: location stream present
  const GC = wC.GeoLoads;
  GC.startDay('s' + T0, {});
  ok(GC.status().watching === true && GC.today().armed === true,
    'C1 the engine watches and arms from the dispatch pins');
  ok(GC.nudge(1) === 1 && GC.today().count === 1 && GC.today().corr === 1,
    'C2 live +1 moves the live correction (got corr=' + GC.today().corr + ' count=' + GC.today().count + ')');
  ok(GC.nudge(-1) === 0 && GC.today().count === 0, 'C3 live −1 steps it back to zero');
  ok(GC.nudge(-1) === 0 && GC.today().count === 0, 'C4 live −1 at zero clamps — no banked debt on the live door either');
  const recC = dayRec(storeC);
  ok(recC && recC.corr === 0, 'C5 the live door persisted corr 0 to the record, as web 451 did');
}

console.log('\nload-correction-notwatching-v452: ' + passed + ' passed / ' + failed + ' failed');
process.exit(failed ? 1 : 0);
