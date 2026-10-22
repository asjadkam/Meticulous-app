#!/usr/bin/env node
/* Meticulous v220 — the batch's own fixtures. One run, 16 named
 * items; this file pins the behaviors the per-module suites do
 * not already cover:
 *   16 LOADS-TIGHT-GEOFENCE + LOADS-MISS-OCT22 — the cycle-proof
 *      pattern learner (one cycle teaches nothing; two cycles
 *      prove; a mid-leg washroom stop contests and never teaches;
 *      intra-site sub-spots prove inside one fence), and the
 *      dwell-grace that stops a creeping tip from resetting its
 *      own arrival clock (the Oct 22 miss: 5 counted, 7 real).
 *   12 LOADS-CORRECTION-BUTTONS — GeoLoads.nudge moves the count,
 *      floors at 0, and survives a restart through rec.corr.
 *   2/3/8/9/10/11/14/15 — precise source pins for the lines this
 *      run changed (their mechanics ride the per-module suites:
 *      signin-lock, cloudsync, connect-pipe, dispatch-navpin,
 *      native-bridge, shifttrack).
 * Run: node tools/batch-v220-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let passes = 0, failures = 0;
function ok(cond, label) {
  if (cond) { passes++; console.log('  PASS ' + label); }
  else { failures++; console.log('  FAIL ' + label); }
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/* ================= engine slice (item 16) ================= */
const gsrc = read('js/geoloads.js');
function extract(s, beginMark, endMark) {
  const a = s.lastIndexOf('/*', s.indexOf(beginMark));
  const b = s.indexOf('*/', s.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return s.slice(a, b + 2);
}
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(extract(gsrc, 'GEOLOADS-ENGINE-BEGIN', 'GEOLOADS-ENGINE-END'), sandbox);
const E = sandbox.ENGINE;

const T0 = 1760544000000; // 2026-10-15 ~08:00 MDT
function off(lat, lng, eM, nM) {
  return [lat + nM / 111320, lng + eM / (111320 * Math.cos(lat * Math.PI / 180))];
}
function fix(tS, ll, acc) {
  return { latitude: ll[0], longitude: ll[1], accuracy: (acc === undefined ? 8 : acc), time: T0 + tS * 1000 };
}
const PIT = off(51.05, -114.07, 0, 0);
const DUMP = off(51.05, -114.07, 600, 0);
const WASH = off(51.05, -114.07, 0, 450);
const FARP = off(51.05, -114.07, 0, -900);
/* dwell at a place for durS (10s steps), then a 60s travel fix.
   Tracks contested results across every ingest. */
function dwell(L, clock, ll, durS, acc) {
  for (let s = 0; s <= durS; s += 10) {
    clock.t += 10;
    const r = L.ingest(fix(clock.t, ll, acc));
    if (r && r.contested) clock.contested = (clock.contested || 0) + 1;
  }
}
function go(L, clock, ll) {
  clock.t += 60;
  const r = L.ingest(fix(clock.t, ll));
  if (r && r.contested) clock.contested = (clock.contested || 0) + 1;
}
function mkLearner(cfg) { const L = E.createPatternLearner(cfg || {}); L.begin(null); return L; }

console.log('— 16: cycle-proof pattern learner —');
(function () {
  /* ONE full cycle teaches NOTHING (v203 taught on one). */
  const L = mkLearner();
  const c = { t: 0 };
  dwell(L, c, PIT, 200); go(L, c, DUMP); dwell(L, c, DUMP, 200); go(L, c, PIT); dwell(L, c, PIT, 200);
  ok(!L.snapshot().pair, 'one full cycle (pit→place→pit) teaches nothing yet');
  /* the SECOND cycle proves it: pair out, credits = the 2 proven visits */
  go(L, c, DUMP); dwell(L, c, DUMP, 200); go(L, c, PIT); dwell(L, c, PIT, 200);
  const pair = L.snapshot().pair;
  ok(!!pair, 'the second identical cycle proves the pair');
  ok(pair && pair.credits === 2, 'credits = the 2 proven visits');
  ok(pair && Math.abs(pair.dump.lat - DUMP[0]) < 1e-4 && Math.abs(pair.dump.lng - DUMP[1]) < 1e-4,
    'the proven dump is the cycled place');
})();

(function () {
  /* A mid-leg washroom stop (arrive loaded, leave loaded) on the
     way to the real dump: contested — nothing is taught, the
     washroom least of all. */
  const L = mkLearner();
  const c = { t: 0 };
  for (let k = 0; k < 2; k++) {
    dwell(L, c, PIT, 200); go(L, c, WASH); dwell(L, c, WASH, 260);
    go(L, c, DUMP); dwell(L, c, DUMP, 200); go(L, c, PIT); dwell(L, c, PIT, 200);
  }
  ok((c.contested || 0) >= 1, 'a mid-leg stop before the real dump contests the day');
  ok(!L.snapshot().pair, 'the washroom is never learned as a dump site (and nothing false is)');
})();

(function () {
  /* LOADS-MISS-OCT22 — the same-place job: ONE site, the loading
     spot and the tipping spot ~80 m apart inside it. Two proven
     cycles between the sub-spots teach an INTRA pair. */
  const A = off(51.05, -114.07, 0, 0);
  const B = off(51.05, -114.07, 80, 0);
  const L = mkLearner();
  const c = { t: 0 };
  /* the first long dwell forms BOTH the site anchor and the
     first sub-spot (the loading spot, where the day starts) */
  dwell(L, c, A, 400, 10); go(L, c, B); dwell(L, c, B, 200, 10);
  ok(!L.snapshot().pair, 'intra-site: one sub-spot cycle teaches nothing');
  go(L, c, A); dwell(L, c, A, 200, 10); go(L, c, B); dwell(L, c, B, 200, 10);
  go(L, c, A); dwell(L, c, A, 200, 10);
  const pair = L.snapshot().pair;
  ok(!!pair && pair.intra === true, 'intra-site: two cycles between the sub-spots prove an intra pair');
  ok(pair && pair.credits === 2, 'intra pair credits the 2 proven tips');
  ok(E.INTRA_RADIUS_M === 30, 'intra fences are tight (30 m)');
})();

console.log('— 16: dwell grace (a creeping tip keeps its arrival) —');
(function () {
  const LOAD = { lat: PIT[0], lng: PIT[1] };
  const DMP = { lat: FARP[0], lng: FARP[1] };
  const MID = off(51.05, -114.07, 0, -450);
  const ctr = E.createGeoLoadCounter({ load: LOAD, dump: DMP });
  ctr.begin('grace', null);
  const c = { t: 0 };
  let confirmedDump = false;
  const feed = function (ll, durS) {
    for (let s = 0; s <= durS; s += 10) {
      c.t += 10;
      const r = ctr.ingest(fix(c.t, ll));
      if (r && r.confirmed === 'dump') confirmedDump = true;
    }
  };
  const move = function (ll) { c.t += 120; ctr.ingest(fix(c.t, ll)); };
  feed(PIT, 70);                        // confirmed at load
  ok(ctr.phase() === 'at-load', 'grace fixture: confirmed at the load site');
  move(FARP);                           // travel to the dump
  feed(FARP, 25);                       // 25 s of presence — NOT yet 45
  feed(MID, 15);                        // a 15 s creep out of the fence (≤ grace)
  feed(FARP, 30);                       // back in: 25 + 30 across the gap ≥ 45
  ok(confirmedDump, 'a ≤25 s excursion does not reset the arrival clock — the tip still confirms');
  move(PIT); feed(PIT, 70);
  ok(ctr.count() === 1, 'the grazed tip counts exactly 1 load');
  /* and a REAL departure (> grace) still resets, honestly */
  const ctr2 = E.createGeoLoadCounter({ load: LOAD, dump: DMP });
  ctr2.begin('grace2', null);
  const c2 = { t: 0 };
  let confirmedDump2 = false;
  const feed2 = function (ll, durS) {
    for (let s = 0; s <= durS; s += 10) {
      c2.t += 10;
      const r = ctr2.ingest(fix(c2.t, ll));
      if (r && r.confirmed === 'dump') confirmedDump2 = true;
    }
  };
  feed2(PIT, 70); c2.t += 120; ctr2.ingest(fix(c2.t, FARP));
  feed2(FARP, 25); feed2(MID, 40);      // 40 s away — past the grace
  feed2(FARP, 25);
  ok(!confirmedDump2, 'a >25 s departure still replaces the candidate (no phantom arrival)');
})();

/* ================= item 12: nudge on the real module ======== */
console.log('— 12: load correction buttons (GeoLoads.nudge) —');
(function () {
  /* the module's "today" is the real calendar day — the session
     key and the seeded record ride real now, like a live day */
  const NOW = Date.now();
  const dayStr = (function (ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  })(NOW);
  const sessKey = 's' + NOW;
  const storeData = {};
  const store = {
    get: function (k, d) { return (k in storeData) ? storeData[k] : d; },
    set: function (k, v) { storeData[k] = v; }
  };
  function loadModule() {
    const sb = {
      console: console,
      Meticulous: { store: store },
      App: {
        _today: function () { return dayStr; },
        _store: store,
        store: store,
        showToast: function () {}
      },
      LiveMiles: { available: function () { return true; }, subscribe: function () {} },
      Geo: { haversineKm: function (a, b, c2, d2) {
        const R = 6371, p = Math.PI / 180;
        const h = Math.sin((c2 - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c2 * p) * Math.sin((d2 - b) * p / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
      } },
      document: { addEventListener: function () {} },
      navigator: {},
      setTimeout: setTimeout, clearTimeout: clearTimeout,
      setInterval: setInterval, clearInterval: clearInterval
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(gsrc, sb);
    return sb.GeoLoads;
  }
  /* a day the GPS counter already counted 3 on, fences armed from
     its dispatch (GeoLoads configures against the active dispatch
     — the app's real contract), the count on the day record */
  const days = {};
  days[dayStr] = {
    /* exactly the shape persist() itself writes mid-day: the
       machine count on the record AND in the counter snapshot */
    date: dayStr, sessionKey: sessKey, count: 3, corr: 0, events: [], updatedAt: Date.now(),
    armed: true,
    sites: { load: { lat: PIT[0], lng: PIT[1] }, dump: { lat: DUMP[0], lng: DUMP[1] } },
    state: {
      sitesKey: 'gdx1@' + PIT[0].toFixed(5) + ',' + PIT[1].toFixed(5) + '>' + DUMP[0].toFixed(5) + ',' + DUMP[1].toFixed(5),
      zone: 'out', phase: 'away', armed: true, count: 3, events: [], lastT: 0
    },
    patternPair: { load: { lat: PIT[0], lng: PIT[1] }, dump: { lat: DUMP[0], lng: DUMP[1] } }
  };
  storeData.geoloads = { days: days };
  storeData.dsp_active = {
    id: 'dx1', jobSite: 'Pit', date: dayStr,
    lat: PIT[0], lng: PIT[1], dumpLat: DUMP[0], dumpLng: DUMP[1]
  };
  let G = loadModule();
  G.startDay(sessKey, { resume: true });
  ok(G.today().count === 3, 'the day restores at the machine count 3');
  G.nudge(-1);
  ok(G.today().count === 2, '−1 takes the count to 2 (machine count untouched)');
  G.nudge(-5);
  ok(G.today().count === 0, 'the count floors at 0');
  G.nudge(2);
  ok(G.today().count === 2, '+1 twice brings it to 2');
  ok(storeData.geoloads.days[dayStr].corr === -1, 'the correction persists on the day record (corr −1)');
  ok(storeData.geoloads.days[dayStr].count === 3, 'the machine count itself is never rewritten');
  G.stopDay();
  G = loadModule();
  G.startDay(sessKey, { resume: true });
  ok(G.today().count === 2, 'the corrected count survives a relaunch');
  ok(typeof G.nudge === 'function', 'GeoLoads.nudge is the buttons\u2019 one door');

  /* scenario C (the restore hole v220 closes): a session whose
     day count is a CARRIED BASE (an earlier session counted 3,
     this session's own counter snapshot says 0) must still read
     3 after a relaunch — record count minus snapshot count is
     the base, never zeroed for a same-session restore. */
  const daysC = {};
  daysC[dayStr] = {
    date: dayStr, sessionKey: sessKey, count: 3, corr: 0, events: [], updatedAt: Date.now(),
    armed: true,
    sites: { load: { lat: PIT[0], lng: PIT[1] }, dump: { lat: DUMP[0], lng: DUMP[1] } },
    state: {
      sitesKey: 'gdx1@' + PIT[0].toFixed(5) + ',' + PIT[1].toFixed(5) + '>' + DUMP[0].toFixed(5) + ',' + DUMP[1].toFixed(5),
      zone: 'out', phase: 'away', armed: true, count: 0, events: [], lastT: 0
    }
  };
  storeData.geoloads = { days: daysC };
  G = loadModule();
  G.startDay(sessKey, { resume: true });
  ok(G.today().count === 3, 'a carried-base count survives a same-session relaunch (3, not 0)');
})();

/* ================= source pins for the rest ================= */
console.log('— 2/3/8/9/10/11/14/15: source pins —');
(function () {
  const app = read('js/app.js');
  const nav = read('modules/navigator.js');
  const sht = read('js/shifttrack.js');
  const idx = read('index.html');
  const cp = read('js/connectpipe.js');
  ok(app.indexOf('if (!trackerTick._as || Date.now() - trackerTick._as > 60000)') >= 0 &&
     app.indexOf('if (sessionActive()) trackerSave();') >= 0,
    '2: a running session re-saves to the cloud on the minute gate (SESSION-CLOUD-GAP)');
  ok(app.indexOf('LiveMiles.startDay(rk2, { resume: true })') >= 0 &&
     app.indexOf('GeoLoads.startDay(rk2, { resume: true })') >= 0,
    '3: the auth-time cloud restore re-attaches LiveMiles + GeoLoads (LIVE-MILES-REINSTALL-RESET)');
  ok(app.indexOf('LiveMiles.recordKmFor(rk)') >= 0,
    '3: a close with a detached engine stamps the persisted live-km record');
  ok(nav.indexOf('ShiftTrack.enterPip()') >= 0 && nav.indexOf('if (S && S.drive)') >= 0,
    '9: Back during a live drive enters PiP posture, module untouched (PIP-BACK-BEHAVIOR; v222 pin move: back() now PARKS in-app first — PIP-LANDS-HOME — with the native enterPip kept as the fallback; the park behaviour itself is pinned in fix-batch-v222-test)');
  ok(nav.indexOf('nvd_pip_line') >= 0 && sht.indexOf('addPipListener') >= 0,
    '8: the PiP bottom line exists and pip changes are heard (PIP-REDESIGN)');
  ok(idx.indexOf('id="bubbleFace"') >= 0 && idx.indexOf('id="bubClock"') >= 0 &&
     idx.indexOf('id="bubPlay"') >= 0 && idx.indexOf('id="bubStop"') >= 0 && idx.indexOf('id="bubLoads"') >= 0,
    '10: the bubble face carries only timer + play/stop + loads (APP-BUBBLE-TRACKER)');
  ok(sht.indexOf('takeWidgetAction') >= 0 && app.indexOf('applyWidgetAction') >= 0,
    '11: widget taps are collected and performed by the tracker (WIDGET-CONTROLS)');
  ok(app.indexOf('loadsGlance()') >= 0 && app.indexOf("m.mode === 'Hourly' || m.mode === 'Miles'") >= 0,
    '11: the loads count rides beside timer + live miles on the widget');
  ok(cp.indexOf('var dateStr = CP.recordDate(d);') >= 0 && cp.indexOf('pipeDateless: dateless') >= 0,
    '14: a Connect dispatch files by its own date; a dateless one by arrival day, flagged (DSP-CONNECT-DATE-FILE)');
  ok(gsrc.indexOf('placeByName') >= 0 && read('modules/dispatch.js').indexOf('dspPlaceHit') >= 0,
    '15: a pin-less dispatch whose place is known still offers Navigate (DSP-PIN-NAVIGATE)');
  /* native pins for 8/10/11 cross the repo line — guarded */
  const nat = path.resolve(ROOT, '..', 'meticulous-native', 'android', 'app', 'src', 'main');
  if (fs.existsSync(nat)) {
    const lay = fs.readFileSync(path.join(nat, 'res', 'layout', 'widget_tracker.xml'), 'utf8');
    const tw = fs.readFileSync(path.join(nat, 'java', 'com', 'meticuloustechnologies', 'app', 'TrackerWidget.java'), 'utf8');
    const ma = fs.readFileSync(path.join(nat, 'java', 'com', 'meticuloustechnologies', 'app', 'MainActivity.java'), 'utf8');
    ok(lay.indexOf('widget_btn_start') >= 0 && lay.indexOf('widget_btn_pause') >= 0 && lay.indexOf('widget_btn_stop') >= 0,
      '11 native: the widget layout carries start/pause/stop buttons');
    ok(tw.indexOf('"start"') >= 0 && tw.indexOf('"pause"') >= 0 && tw.indexOf('"stop"') >= 0,
      '11 native: the buttons speak start/pause/stop to the app');
    ok(ma.indexOf('sessionActive') >= 0 && ma.indexOf('enterPipNow') >= 0,
      '8/10 native: PiP arms for a live drive AND a live shift (the bubble)');
  } else {
    console.log('  SKIP native pins (native repo not a sibling here)');
  }
})();

console.log('\nbatch-v220 test: ' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
