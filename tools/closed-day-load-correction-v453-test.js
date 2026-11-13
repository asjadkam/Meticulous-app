#!/usr/bin/env node
/* CLOSED-DAY-LOAD-CORRECTION (Nov 13, 2026): web 452 gave the
 * unwatched page a correction door onto TODAY's record
 * (GeoLoads.nudge, not-watching branch) — but a CLOSED day had
 * no correction control on any surface: the tracker stands
 * idle with no count shown, the Manifest day view was
 * read-only (Print/PDF/Download only), and Revenue's day view
 * carries no loads control. Nov 13 closed at 5 loads in the
 * Manifest while the day's two signed haul cards total 4
 * (card #28888: 3 trips; card #23528: 1 load) — and there was
 * no door to make it right.
 *
 * THE FIX:
 *  - js/geoloads.js: GeoLoads.nudgeDate(date, delta) — the
 *    v452 record-write named by date. Same clamp (the day's
 *    total floors at 0; extra −1 taps bank no invisible debt),
 *    only corr and updatedAt move, persisted at once via
 *    writeDay. The day the engine is live-watching is refused
 *    (the live door owns it). No record for the date → null,
 *    nothing created; any other day's record is never touched.
 *  - modules/manifest.js: the day preview carries the same
 *    +1 / −1 in the quiet spot beside the Edit door, shown
 *    only when the day is not live and carries a counting
 *    record; a tap calls nudgeDate for the day on screen and
 *    the preview repaints from the record — the peg-day loads
 *    line IS the record's count + correction, so the printed
 *    figure moves with the tap.
 *
 * Scenarios:
 *   A  the Nov 13 closed day replayed: its record (machine 3
 *      + corr +2 = 5, peg day) sits in the store as a PAST
 *      day. forDate and the real Manifest collect both read
 *      5; one −1 through nudgeDate lands on the record; both
 *      reads move to the cards' 4 at once and survive a fresh
 *      page life (reload); +1 then −1 returns to the same
 *      number; five −1 floor the day at 0 with no banked
 *      debt; nothing else on the record moves; a second
 *      day's record is untouched throughout.
 *   B  guardrails: no record for the date → null and nothing
 *      created; a zero delta / empty date → null, record
 *      unchanged; the web 452 doors stand exactly as shipped
 *      (the unwatched today-door and the live door both
 *      re-driven here).
 *   C  the live guard: while the engine watches TODAY,
 *      nudgeDate refuses TODAY both ways and the record does
 *      not move — but a closed day's correction still lands.
 *   D  source pins for the Manifest door (family convention):
 *      the row's gate, its figure, and its wiring.
 *
 * Run: node tools/closed-day-load-correction-v453-test.js
 * On web 452 bytes the door does not exist: A fails at the
 * nudgeDate assertions (undefined), D's pins fail; B3/B4 (the
 * 452 doors) and C's live-door facts pass on both trees.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const geoSrc = fs.readFileSync(path.join(ROOT, 'js', 'geoloads.js'), 'utf8');
const manSrc = fs.readFileSync(path.join(ROOT, 'modules', 'manifest.js'), 'utf8');

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
function escStub(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
/* One page world: geoloads (+ manifest when asked) over a
   shared store. The stub's App._today() is pinned to
   2026-11-14 so 2026-11-13 stands as a closed PAST day for
   the Manifest collect, whatever the real clock says. */
function mkWorld(store, lmAvailable, withManifest) {
  const sb = { console: console, Date: RealDate, Math: Math, JSON: JSON };
  sb.window = sb;
  let handler = null;
  sb.LiveMiles = { available: function () { return !!lmAvailable; }, subscribe: function (fn) { handler = fn; } };
  sb.App = {
    _store: store,
    _esc: escStub,
    _today: function () { return '2026-11-14'; }
  };
  sb.Meticulous = { modules: {} };
  vm.createContext(sb);
  vm.runInContext(geoSrc, sb);
  if (!sb.GeoLoads) throw new Error('GeoLoads not exposed');
  if (withManifest) {
    vm.runInContext(manSrc, sb);
    if (!sb.Meticulous.modules.manifest) throw new Error('manifest module not exposed');
  }
  return { GeoLoads: sb.GeoLoads, manifest: sb.Meticulous.modules.manifest || null,
           feed: function (fix) { return handler && handler(fix); } };
}
const NOW = new RealDate();
const T0 = new RealDate(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 6, 0, 0).getTime();
function gdstr(ts) {
  const d = new RealDate(ts);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const RTODAY = gdstr(T0);                    // the real clock's today (the engine's own date)
const RYDAY = gdstr(T0 - 24 * 3600 * 1000);   // the real clock's yesterday
const NOV13 = '2026-11-13';                  // the closed day under repair

/* the Nov 13 day's geometry — the Aecon pair the phone pegged */
const LOAD = { lat: 51.12442, lng: -113.98356 };
const DUMP = { lat: 51.1225089, lng: -114.0122197 };
const DSP_LOADPIN = { lat: 51.1252222, lng: -113.9828056 };
const HOME = { lat: 51.15709, lng: -113.93862 };

/* the closed day's record as the cloud left it: machine
   counted 3 from the pegs, the driver tapped +2 by hand
   during the day, the signed cards say the day was 4 loads. */
function nov13Record(date) {
  return {
    date: date, dispatchId: 'dsp-nov13-2', sessionKey: 's' + T0,
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
  return d && d.days ? (d.days[date] || null) : null;
}
/* the door call, fail-soft: on bytes where the door does not
   exist (web 452) the suite must REPORT the failures, not die */
function nd(G, date, delta) {
  if (!G || typeof G.nudgeDate !== 'function') return '__no_door__';
  try { return G.nudgeDate(date, delta); } catch (e) { return '__threw__'; }
}

/* ---------- A: the Nov 13 closed day, replayed ---------- */
console.log('A — the closed day: one −1 through the new door must move the record and the Manifest');
{
  const data = { geoloads: { days: {} } };
  data['geoloads'].days[NOV13] = nov13Record(NOV13);
  const other = nov13Record('2026-11-11'); other.count = 6; other.corr = 7;
  data['geoloads'].days['2026-11-11'] = other;
  const otherBefore = JSON.stringify(other);
  const store = mkSharedStore(data);
  const w = mkWorld(store, false, true); // the web book: no location stream
  const G = w.GeoLoads;

  ok(typeof G.nudgeDate === 'function', 'A0 the closed-day door exists (GeoLoads.nudgeDate)');
  ok(G.forDate(NOV13).count === 5 && G.forDate(NOV13).corr === 2,
    'A1 the record read stands at the wrong 5 (+2 taps) before any tap');
  const c0 = w.manifest._collectDay(NOV13);
  ok(c0.loads === 5 && c0.loadsSrc === 'pegs' && !c0.live,
    'A1b the Manifest itself reads 5 from the pegs, and the day is not live (got loads=' + c0.loads + ' src=' + c0.loadsSrc + ')');

  ok(nd(G, NOV13, -1) === 1, 'A2 the −1 lands through the door and returns the new correction (1)');
  ok(G.forDate(NOV13).count === 4, 'A3 the record read moves to the signed cards\' 4 at once');
  ok(dayRec(store, NOV13).corr === 1, 'A3b the record in the store carries corr 1 — persisted, not page memory');
  const c1 = w.manifest._collectDay(NOV13);
  ok(c1.loads === 4, 'A3c the Manifest figure itself moves to 4 — the number that prints');

  /* his reload, replayed: a fresh page life over the same store */
  const w2 = mkWorld(mkSharedStore(data), false, true);
  ok(w2.GeoLoads.forDate(NOV13).count === 4 && w2.manifest._collectDay(NOV13).loads === 4,
    'A4 after a full reload the corrected 4 still stands in the record and the Manifest');

  /* +1 then −1 returns to the same number */
  ok(nd(G, NOV13, 1) === 2 && G.forDate(NOV13).count === 5, 'A5 +1 steps the day back up to 5');
  ok(nd(G, NOV13, -1) === 1 && G.forDate(NOV13).count === 4, 'A5b −1 returns it to exactly 4');

  /* the floor: five −1 in total from 4 — the day floors at 0,
     corr clamps at −machine, no invisible debt */
  nd(G, NOV13, -1); nd(G, NOV13, -1); nd(G, NOV13, -1); nd(G, NOV13, -1); nd(G, NOV13, -1);
  ok(G.forDate(NOV13).count === 0 && dayRec(store, NOV13).corr === -3,
    'A6 −1 taps floor the day at 0 (corr clamps at −3 = −machine, got corr=' + dayRec(store, NOV13).corr + ')');
  ok(nd(G, NOV13, 1) === -2 && G.forDate(NOV13).count === 1,
    'A6b a +1 from the floor lands at 1 at once — the extra −1 taps banked no debt');
  nd(G, NOV13, 1); nd(G, NOV13, 1); nd(G, NOV13, 1); // steer back to the cards' 4
  ok(G.forDate(NOV13).count === 4 && dayRec(store, NOV13).corr === 1,
    'A6c steering taps return the day to exactly the cards\' 4');

  const after = dayRec(store, NOV13);
  const seed = nov13Record(NOV13);
  ok(after.count === seed.count && after.countSource === seed.countSource &&
     JSON.stringify(after.sites) === JSON.stringify(seed.sites) &&
     JSON.stringify(after.pegs) === JSON.stringify(seed.pegs) &&
     JSON.stringify(after.events) === JSON.stringify(seed.events) &&
     after.dispatchId === seed.dispatchId && after.sessionKey === seed.sessionKey,
    'A7 nothing else on the record moved — count, sites, pegs, events, source all byte-identical');
  ok(JSON.stringify(dayRec(store, '2026-11-11')) === otherBefore,
    'A8 the other day\'s record is untouched, digit for digit');
}

/* ---------- B: guardrails + the 452 doors stand ---------- */
console.log('B — guardrails, and web 452\'s doors exactly as shipped');
{
  const data = { geoloads: { days: {} } };
  data['geoloads'].days[NOV13] = nov13Record(NOV13);
  const store = mkSharedStore(data);
  const w = mkWorld(store, false, false);
  const G = w.GeoLoads;

  ok(nd(G, '2026-11-09', -1) === null && !dayRec(store, '2026-11-09'),
    'B1 a date with no record returns null and creates nothing');
  const beforeB = JSON.stringify(dayRec(store, NOV13));
  ok(nd(G, NOV13, 0) === null && nd(G, '', -1) === null && nd(G, null, 1) === null &&
     JSON.stringify(dayRec(store, NOV13)) === beforeB,
    'B2 a zero delta or an empty date changes nothing');

  /* the 452 today-door, re-driven on the real today's record */
  const dataB3 = { geoloads: { days: {} } };
  const rT = nov13Record(RTODAY);
  dataB3['geoloads'].days[RTODAY] = rT;
  const storeB3 = mkSharedStore(dataB3);
  const wB3 = mkWorld(storeB3, false, false);
  ok(wB3.GeoLoads.status().watching === false && wB3.GeoLoads.nudge(-1) === 1 &&
     dayRec(storeB3, RTODAY).corr === 1,
    'B3 the v452 unwatched today-door still lands on today\'s record, as shipped');

  /* the live door, re-driven */
  const dsp = { id: 'dsp-live', jobSite: 'Aecon Trans', dropoff: '', status: 'active',
    date: RTODAY, scheduledAt: RTODAY + 'T09:00:00',
    lat: DSP_LOADPIN.lat, lng: DSP_LOADPIN.lng, dumpLat: DUMP.lat, dumpLng: DUMP.lng };
  const dataB4 = { nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] },
    dsp_list: [dsp], dsp_active: dsp };
  const storeB4 = mkSharedStore(dataB4);
  const wB4 = mkWorld(storeB4, true, false);
  const GB4 = wB4.GeoLoads;
  GB4.startDay('s' + T0, {});
  ok(GB4.status().watching === true && GB4.nudge(1) === 1 && GB4.today().corr === 1 &&
     GB4.nudge(-1) === 0 && GB4.today().count === 0,
    'B4 the live door corrects exactly as web 452 did (+1 → corr 1, −1 → 0)');
}

/* ---------- C: the live guard ---------- */
console.log('C — the watched day is refused; the closed day still corrects');
{
  const dsp = { id: 'dsp-live-c', jobSite: 'Aecon Trans', dropoff: '', status: 'active',
    date: RTODAY, scheduledAt: RTODAY + 'T09:00:00',
    lat: DSP_LOADPIN.lat, lng: DSP_LOADPIN.lng, dumpLat: DUMP.lat, dumpLng: DUMP.lng };
  const data = { nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] },
    dsp_list: [dsp], dsp_active: dsp,
    geoloads: { days: {} } };
  const yRec = nov13Record(RYDAY);
  data['geoloads'].days[RYDAY] = yRec;
  const store = mkSharedStore(data);
  const w = mkWorld(store, true, false); // the phone: location stream present
  const G = w.GeoLoads;
  G.startDay('s' + T0, {});
  ok(G.status().watching === true && G.status().date === RTODAY,
    'C0 the engine is live-watching today');
  const todayBefore = JSON.stringify(dayRec(store, RTODAY));
  ok(nd(G, RTODAY, 1) === null && nd(G, RTODAY, -1) === null &&
     JSON.stringify(dayRec(store, RTODAY)) === todayBefore,
    'C1 nudgeDate refuses the watched day both ways — the record does not move; the live door owns it');
  ok(nd(G, RYDAY, -1) === 1 && dayRec(store, RYDAY).corr === 1,
    'C2 a CLOSED day\'s correction still lands while today is being watched');
}

/* ---------- D: the Manifest door's shape (source pins) ---------- */
console.log('D — the Manifest day view carries the door, quiet and gated');
{
  ok(manSrc.indexOf('id="mn_load_minus"') !== -1 && manSrc.indexOf('id="mn_load_plus"') !== -1,
    'D1 the preview renders the −1 load / +1 load pair');
  ok(manSrc.indexOf('if (!c.live && c.geoDay && window.GeoLoads && window.GeoLoads.nudgeDate)') !== -1,
    'D2 the row is gated on the day not being live and carrying a counting record');
  ok(manSrc.indexOf('(parseInt(c.geoDay.count, 10) || 0) + (parseInt(c.geoDay.corr, 10) || 0)') !== -1,
    'D3 the row\'s figure is the record\'s count + correction — the same figure the preview prints');
  ok(manSrc.indexOf('window.GeoLoads.nudgeDate(d, -1)') !== -1 && manSrc.indexOf('window.GeoLoads.nudgeDate(d, 1)') !== -1,
    'D4 both buttons call nudgeDate for the day on screen (d), −1 and +1');
  ok(manSrc.indexOf('btn small ghost" id="mn_load_minus"') !== -1,
    'D5 the door wears the Edit door\'s quiet dress (btn small ghost), never a primary');
  ok(manSrc.indexOf('id="mn_load_minus"') < manSrc.indexOf('id="mn_print"') &&
     manSrc.indexOf('id="mn_doc"') < manSrc.indexOf('id="mn_load_minus"'),
    'D6 the row sits outside the printed document, above the Print row — Print stays the primary');
}

console.log('\nclosed-day-load-correction-v453: ' + passed + ' passed / ' + failed + ' failed');
process.exit(failed ? 1 : 0);
