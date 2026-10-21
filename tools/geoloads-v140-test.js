/*
 * geoloads-v140-test.js — v140 LOAD AUTO-COUNT (Oct 17, 2026).
 *
 * The owner's law: load counts are NEVER the driver's job. On
 * Oct 17 he did 3–4+ loads before noon while the app recorded
 * none automatically — the dashboard's only load number was his
 * own +1 taps. Characterization (this glue, the day's real pair,
 * a load-pin-only dispatch) proved counting worked in clean
 * traces with tip dwells >= ~150 s and recorded ZERO all day
 * below that, behind three structural gaps: the dashboard never
 * displayed the GPS count; the shared dayLoads ladder ranked it
 * below the driver's taps; and the dump fence could only come
 * from a dispatch field nothing populates, a remembered pair,
 * or same-day teaching — while both of the day's sites already
 * sat in his own favorites, which this file never consulted.
 *
 * This suite drives the REAL glue (js/geoloads.js) in fake
 * worlds shaped like his Oct 17:
 *   (A) the Oct 17 replay WITH his navigation (he navigates to
 *       the pit, then pit -> pond): the pond is adopted from his
 *       own Navigate tap, the counter arms before he arrives,
 *       and SHORT 90-second tips count — exactly 4 loads in 4
 *       cycles; the pair is remembered once proven; the
 *       dashboard read (today) and the manifest channel
 *       (forDate / the store record) agree.
 *   (B) no navigation: teaching works at a normal tip (90 s
 *       parked — presence at the place, approach crawl
 *       included, crosses the 2-minute bar on the first cycle)
 *       and stays honest at a 25 s drive-through (count 0, the
 *       day record says 'learning' — nothing invented).
 *       Sensitivity measured in this geometry: 25 s no,
 *       45 s yes.
 *   (C) a dispatch whose pin never landed resolves its load
 *       site BY NAME from his favorites; an ambiguous name
 *       resolves nothing.
 *   (D) a 40-minute fix blackout invents nothing: the count is
 *       exactly the observed cycles.
 *   (E) statics: the ladder order (invoice), the dashboard face
 *       (app.js), the close pre-fill order (dispatch), the
 *       manifest fallback order.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const geoSrc = fs.readFileSync(path.join(ROOT, 'js', 'geoloads.js'), 'utf8');
const navSrc = fs.readFileSync(path.join(ROOT, 'modules', 'navigation.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok - ' + name); }
  else { fail++; console.log('  FAIL - ' + name); }
}
function eq(got, want, name) {
  ok(got === want, name + ' (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')');
}

/* The day's real pair (Oct 17): Aecon Maple Ridge (load) and
   Ivor East Pond (dump) — the dispatch pin and his own migrated
   favorite, ~85 m apart as coordinate sources. */
const LOAD = { lat: 50.96044, lng: -114.03176 };
const POND_FAV = { lat: 50.95134, lng: -114.01563 };
const T0 = Date.UTC(2026, 9, 17, 14, 0, 0); // 08:00 MDT
const TODAY = (() => { const d = new Date(T0); const p = (n) => ('0' + n).slice(-2); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })();

/* The real built-in pits, extracted from modules/navigation.js
   so this suite tests against shipped data, not a copy. */
function builtinRaw() {
  const a = navSrc.indexOf('var BUILTIN_RAW = ');
  const b = navSrc.indexOf('];', a);
  if (a < 0 || b < 0) throw new Error('BUILTIN_RAW not found');
  const sb = {};
  vm.createContext(sb);
  vm.runInContext('BUILTINS = ' + navSrc.slice(a + 'var BUILTIN_RAW = '.length, b + 1), sb);
  return sb.BUILTINS;
}

function makeWorld(opts) {
  opts = opts || {};
  let now = T0;
  function D() {
    const d = arguments.length ? new Date(...arguments) : new Date(now);
    return d;
  }
  D.now = () => now;
  D.UTC = Date.UTC;
  D.parse = Date.parse;

  const data = new Map();
  const storeObj = {
    get(k, fb) { return data.has(k) ? JSON.parse(data.get(k)) : (fb === undefined ? null : fb); },
    set(k, v) { data.set(k, JSON.stringify(v)); },
    remove(k) { data.delete(k); },
    del(k) { data.delete(k); }
  };
  const favorites = [
    { id: 'fav-mr', name: 'Maple Ridge', type: 'pit', lat: LOAD.lat, lng: LOAD.lng },
    { id: 'fav-iv', name: 'Ivor East Pond', type: 'dump', lat: POND_FAV.lat, lng: POND_FAV.lng }
  ];
  data.set('nav_data', JSON.stringify({ work: favorites, recent: [] }));
  if (opts.dispatch) data.set('dsp_active', JSON.stringify(opts.dispatch));

  let fixHandler = null;
  const builtins = builtinRaw().map(p => ({ name: p[0], type: p[1], lat: p[2], lng: p[3] }));
  const sb = {
    console, JSON, Math, Object, Array, Promise, setTimeout, clearTimeout,
    parseFloat, parseInt, isFinite, isNaN, String, Number, Boolean, Date: D,
    addEventListener: function () {},
    Meticulous: { modules: { navigation: { builtinPlaces: () => builtins } } },
    App: { _store: storeObj, _today: () => TODAY },
    LiveMiles: { available: () => true, subscribe: (fn) => { fixHandler = fn; } }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(geoSrc, sb);
  if (!sb.GeoLoads) throw new Error('GeoLoads did not load');

  /* deterministic small jitter, ±12 m */
  let jn = 0;
  const JIT = [[0, 0], [8, 5], [-9, 4], [5, -8], [-6, -7], [10, -3]];
  function jit(lat, lng) {
    const j = JIT[jn++ % JIT.length];
    return [lat + j[1] / 111320, lng + j[0] / (111320 * Math.cos(lat * Math.PI / 180))];
  }
  const W = {
    sb, store: storeObj, data,
    GeoLoads: sb.GeoLoads,
    now: () => now,
    advance(ms) { now += ms; },
    feed(lat, lng, t) {
      if (!fixHandler) throw new Error('GeoLoads never subscribed');
      fixHandler({ latitude: lat, longitude: lng, accuracy: 8, time: t === undefined ? now : t });
    },
    parkAt(site, durS, stepS) {
      stepS = stepS || 10;
      for (let s = 0; s <= durS; s += stepS) {
        const p = jit(site.lat, site.lng);
        W.feed(p[0], p[1]);
        now += stepS * 1000;
      }
    },
    driveTo(from, to, durS, stepS) {
      W.drivePart(from, to, 0, 1, durS, stepS);
    },
    drivePart(from, to, f0, f1, durS, stepS) {
      stepS = stepS || 10;
      const steps = Math.max(1, Math.round(durS / stepS));
      for (let k = 1; k <= steps; k++) {
        const f = f0 + (f1 - f0) * (k / steps);
        W.feed(from.lat + (to.lat - from.lat) * f, from.lng + (to.lng - from.lng) * f);
        now += stepS * 1000;
      }
    },
    navigateTo(place, kind) {
      const nd = storeObj.get('nav_data', { work: [], recent: [] });
      nd.recent = nd.recent || [];
      nd.recent.unshift({ id: 'r' + now, name: place.name, kind: kind || 'work', ts: now, lat: place.lat, lng: place.lng });
      nd.recent = nd.recent.slice(0, 20);
      storeObj.set('nav_data', nd);
    },
    dayRec() {
      const g = storeObj.get('geoloads', { days: {} });
      return (g.days || {})[TODAY] || null;
    },
    start() {
      return sb.GeoLoads.startDay('s' + T0);
    },
    cycle(tipS) {
      W.parkAt(LOAD, 360);            // load visit (dwell confirms)
      W.driveTo(LOAD, POND_FAV, 600); // loaded leg
      W.parkAt(POND_FAV, tipS);       // the tip
      W.driveTo(POND_FAV, LOAD, 600); // empty return
    }
  };
  return W;
}

function pinnedDispatch() {
  return { id: 'dspA', date: TODAY, jobSite: 'Aecon Inf', pickup: 'Maple Ridge', lat: LOAD.lat, lng: LOAD.lng, notes: 'Go Empty To Maple Ridge' };
}

/* ============ (A) Oct 17 replay, with his navigation ============ */
console.log('\n— (A) load-pin-only dispatch + navigation to the pond: short tips count —');
{
  const W = makeWorld({ dispatch: pinnedDispatch() });
  W.start();
  eq(W.GeoLoads.today().armed, false, 'no pair yet — nothing armed');
  /* his morning shape: he navigated to the PIT first */
  W.navigateTo({ name: 'Maple Ridge', lat: LOAD.lat, lng: LOAD.lng });
  W.parkAt(LOAD, 360);
  eq(W.GeoLoads.today().armed, false, 'navigating to the LOAD site adopts nothing');
  /* loaded, he taps Navigate to the pond and drives */
  W.navigateTo({ name: 'Ivor East Pond', lat: POND_FAV.lat, lng: POND_FAV.lng });
  W.drivePart(LOAD, POND_FAV, 0, 0.25, 150);
  eq(W.GeoLoads.today().armed, true, 'the counter arms BEFORE he reaches the dump');
  const recA = W.dayRec();
  ok(recA && recA.sites && recA.sites.dump && recA.sites.dump.src === 'navigated', 'the dump was adopted from his navigation (src navigated)');
  ok(recA && recA.navDump && Math.abs(recA.navDump.lat - POND_FAV.lat) < 0.001, 'the day record names the navigated dump');
  W.drivePart(LOAD, POND_FAV, 0.25, 1, 450);
  W.parkAt(POND_FAV, 90);              // a SHORT tip — unteachable pre-v140
  W.driveTo(POND_FAV, LOAD, 600);
  eq(W.GeoLoads.today().count, 1, 'the short first tip counted');
  const pairs = Object.values(W.store.get('geoload_pairs', { pairs: {} }).pairs || {});
  eq(pairs.length, 1, 'the pair is remembered once a cycle is proven there');
  ok(pairs.length && Math.abs(pairs[0].dump.lat - POND_FAV.lat) < 0.001, 'the remembered pair is the pond');
  for (let i = 0; i < 3; i++) W.cycle(90);
  const fin = W.GeoLoads.forDate(TODAY);
  eq(fin.count, 4, 'four cycles, four loads — exactly');
  eq(fin.events.length, 4, 'four dump events on the record');
  eq(W.GeoLoads.today().count, 4, 'the dashboard read agrees');
  eq(W.dayRec().count, 4, 'the stored day record (manifest channel) agrees');
  eq(fin.blocked, null, 'no blocked reason on a counted day');
}

/* ============ (B) no navigation: teaching, honest at a drive-through ============ */
console.log('\n— (B) no navigation: teaching at a normal tip; honest zero at a 25 s drive-through —');
{
  const W = makeWorld({ dispatch: pinnedDispatch() });
  W.start();
  for (let i = 0; i < 3; i++) W.cycle(90);
  const fin = W.GeoLoads.forDate(TODAY);
  eq(fin.count, 3, 'three 90 s-tip cycles count via teaching');
  ok(fin.learnedDump && Math.abs(fin.learnedDump.lat - POND_FAV.lat) < 0.002, 'the dump was learned from the driving');
  eq(fin.sites.dump.src, 'learned', 'the learned source is named');
}
{
  const W = makeWorld({ dispatch: pinnedDispatch() });
  W.start();
  for (let i = 0; i < 3; i++) W.cycle(25);
  const fin = W.GeoLoads.forDate(TODAY);
  eq(fin.count, 0, 'three 25 s drive-throughs: nothing counted, nothing invented');
  eq(fin.blocked, 'learning', "the day record says 'learning' — the honest reason");
  eq(W.GeoLoads.today().armed, false, 'dashboard not armed on an untaught day');
}

/* ============ (C) pinless dispatch: the load site by name ============ */
console.log('\n— (C) a dispatch with no pin resolves its load site by name —');
{
  const dsp = { id: 'dspC', date: TODAY, jobSite: 'Maple Ridge' };
  const W = makeWorld({ dispatch: dsp });
  W.start();
  W.navigateTo({ name: 'Ivor East Pond', lat: POND_FAV.lat, lng: POND_FAV.lng });
  W.cycle(90);
  W.cycle(90);
  const fin = W.GeoLoads.forDate(TODAY);
  eq(fin.count, 2, 'two cycles counted on a pinless dispatch');
  eq(fin.sites.load.src, 'places', 'the load fence came from his places, by name');
  eq(fin.sites.dump.src, 'navigated', 'the dump came from his navigation');
}
{
  const dsp = { id: 'dspC2', date: TODAY, jobSite: 'Aecon' }; // two builtins answer to it
  const W = makeWorld({ dispatch: dsp });
  W.start();
  const fin = W.GeoLoads.forDate(TODAY);
  eq(fin.count, 0, 'an ambiguous name counts nothing');
  /* v203 SUPERSEDES the blocked value only: the name still
     resolves NOTHING (no fence on a guess — the point of this
     check stands); the anchorless day now falls to pattern
     learning instead of blindness, so its state reads
     'learning' while it watches its own driving. */
  eq(fin.blocked, 'learning', 'an ambiguous name resolves nothing — no fence on a guess; the day pattern-learns');
}

/* ============ (D) missing fixes stay honest ============ */
console.log('\n— (D) a 40-minute fix blackout invents nothing —');
{
  const W = makeWorld({ dispatch: pinnedDispatch() });
  W.start();
  W.navigateTo({ name: 'Ivor East Pond', lat: POND_FAV.lat, lng: POND_FAV.lng });
  W.cycle(90);
  W.cycle(90);
  eq(W.GeoLoads.today().count, 2, 'two observed cycles counted');
  W.advance(40 * 60 * 1000);           // GPS dies for 40 minutes
  eq(W.GeoLoads.today().count, 2, 'the blackout adds nothing');
  W.cycle(90);
  eq(W.GeoLoads.forDate(TODAY).count, 3, 'after the blackout, only the observed cycle joins');
}

/* ============ (E) statics: ladder + faces ============ */
console.log('\n— (E) the count of record: ladder, dashboard, close —');
{
  const inv = fs.readFileSync(path.join(ROOT, 'modules', 'invoice.js'), 'utf8');
  const fnA = inv.indexOf('function invCycDayLoads');
  const body = inv.slice(fnA, inv.indexOf('/* v81', fnA));
  ok(body.indexOf("source = 'sites'") > -1 && body.indexOf("source = 'sites'") < body.indexOf("source = 'taps'"),
    'dayLoads: the movement count ranks above taps');
  ok(body.indexOf("source = 'tickets'") < body.indexOf("source = 'sites'") &&
     body.indexOf("source = 'recorded'") < body.indexOf("source = 'sites'"),
    'dayLoads: tickets and deliberate records still outrank the machine');

  const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  ok(app.includes('trkLoadCount') && app.includes('counted by GPS'), 'the dashboard shows the machine count as the count');
  ok(app.includes('GeoLoads.today'), 'the dashboard reads GeoLoads.today()');
  ok(app.includes('id="trkLoadTapBtn">+1 load correction</button>'), 'the tap button is demoted to a correction');
  ok(!app.includes('🚛 +1 load'), 'the old counter-of-record button face is gone');

  const dsp = fs.readFileSync(path.join(ROOT, 'modules', 'dispatch.js'), 'utf8');
  ok(dsp.includes('geoNow > 0 ? String(geoNow) : (tapsNow > 0 ? String(tapsNow)'),
    'the close pre-fills from the machine count first, taps second');

  const man = fs.readFileSync(path.join(ROOT, 'modules', 'manifest.js'), 'utf8');
  const fb = man.indexOf("loadsSrc = 'sites'");
  ok(fb > -1 && man.indexOf("loadsSrc = 'taps'", fb) > fb,
    'the manifest fallback ladder ranks sites above taps');

  ok(geoSrc.includes('today: function'), 'GeoLoads.today() exists');
  ok(geoSrc.includes("src: 'navigated'"), 'the navigated source exists in the glue');
  ok(geoSrc.includes('placeByName'), 'the by-name load resolution exists');
}

console.log('\ngeoloads-v140: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
