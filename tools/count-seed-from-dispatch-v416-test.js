#!/usr/bin/env node
/* COUNT-SEED-FROM-DISPATCH (Nov 11, 2026 — web 416): the load
 * counter failed in the owner's hands this morning. His Nov 11
 * Aecon Trans dispatch was saved BEFORE web 415 shipped (09:25),
 * so its stored pin fields (lat/lng, dumpLat/dumpLng) are empty;
 * its pins live only in its notes — "Go Empty To:
 * (51.1225089, -114.0122197)" and "Hauling To: (51.3078889,
 * -114.0369722)", each with its Maps link. He started the shift
 * from that dispatch, the tracker card read "Pickup not pegged
 * · Dump not pegged", he drove to the Hauling To site and tipped
 * at ~09:33 — the counter did NOT count it; the card still
 * showed Loads today: 0.
 *
 * CONVICTION (code, web 415 bytes): the counter resolves its
 * sites in js/geoloads.js sitesFromDispatch(), which reads ONLY
 * the record's stored pin fields. Web 414 taught the NAVIGATOR
 * to read the notes pins (dspRecordPin) and web 415 fills the
 * stored fields at save/edit — but a dispatch saved before 415
 * and never re-saved keeps empty fields, and the running counter
 * never looked at the dispatch's notes at all. With both sites
 * null, configure() marks the day 'no-site-coords' and drops it
 * into pattern discovery, which cannot count a first tip at an
 * unproven site: a full working day reads zero.
 *
 * FIX (js/geoloads.js, the seeding path only):
 *   - sitesFromDispatch() fills each site the stored fields
 *     leave empty from the pins the dispatch's own notes label
 *     for it ("Go Empty To" -> load, "Hauling To" -> dump; the
 *     pair itself or the Maps ?q= link after the label; never a
 *     pair from past the other label — the parser is a verbatim
 *     copy of modules/dispatch.js dspNotesSitePins, the same
 *     copy discipline dspNotesGoPin set at v414). A stored pin
 *     always wins. The seeded sites flow through every existing
 *     consumer unchanged: the visit counter arms on them, the
 *     v409 per-site profile seeds from the dump pin's cell, the
 *     day record carries them as its sites.
 *   - Seeding re-runs whenever configure() runs (session start,
 *     day roll, world check). The world check (worldStale) also
 *     fires when the SAME dispatch's resolvable pins change
 *     under a running session — an edit saved, a Connect arrival
 *     replacing the record — via a pin signature captured at
 *     configure time, so a mid-session seeding lands without
 *     ever resetting or lowering the day's count (configure's
 *     banking discipline is untouched).
 *   - Manual pegs are untouched and keep precedence: every peg
 *     branch in configure() runs before dispatch resolution, and
 *     the lone-pickup-peg override still outranks the pin.
 *   Nothing else changes: dwell bars, profile learning, the
 *   +1/-1 corrections and every screen are exactly as web 415.
 *
 * Run: node tools/count-seed-from-dispatch-v416-test.js
 * On web 415 bytes the S1/S2/S3/S7 seeding assertions FAIL (the
 * defect reproduced). On the fix: all pass.
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

/* Nov 11's own geometry and the dispatch's own words. */
const HOME = { lat: 51.09412, lng: -114.01064 };
const GO = { lat: 51.1225089, lng: -114.0122197 };    // "Go Empty To" pin
const HAUL = { lat: 51.3078889, lng: -114.0369722 };  // "Hauling To" pin
const NOTES =
  'Foreman: Chad\n' +
  'Go Empty To: (51.1225089, -114.0122197) https://maps.google.com/?q=51.1225089,-114.0122197\n' +
  'Hauling To: (51.3078889, -114.0369722) https://maps.google.com/?q=51.3078889,-114.0369722';
const NOTES_REVERSED =
  'Hauling To: (51.3078889, -114.0369722) https://maps.google.com/?q=51.3078889,-114.0369722\n' +
  'Go Empty To: (51.1225089, -114.0122197) https://maps.google.com/?q=51.1225089,-114.0122197\n' +
  'Foreman: Chad';

function notesDispatch(notes) {
  /* the record exactly as a pre-415 save left it: NO pin fields
     at all — the pins exist only as text in the notes. */
  return { id: 'dsp-nov11', jobSite: 'Aecon Trans', pickup: '', dropoff: '',
    status: 'active', date: TODAY, scheduledAt: TODAY + 'T08:00:00',
    notes: notes };
}
function baseData(dsp) {
  const data = { nav_data: { personal: [{ name: 'Home', lat: HOME.lat, lng: HOME.lng }], work: [], recent: [] },
    dsp_list: dsp ? [dsp] : [], dsp_active: dsp || null };
  return data;
}
function mach(w) { return w.GeoLoads.status().count; }
function near(a, b) { return a && Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6; }

/* one full loop on the seeded pair: load dwell at GO, tip at
   HAUL, and (optionally) the closing dwell back at GO. */
function loop(feed, clock, pos, closeIt) {
  driveTo(feed, clock, pos, GO, 300);
  park(feed, clock, GO, 240);
  driveTo(feed, clock, pos, HAUL, 300);
  park(feed, clock, HAUL, 300);
  if (closeIt) {
    driveTo(feed, clock, pos, GO, 300);
    park(feed, clock, GO, 240);
  }
}

console.log('geometry — Nov 11\'s own distances');
ok(havM(GO, HAUL) > 15000, 'the two ends are ~20 km apart — ' + Math.round(havM(GO, HAUL)) + ' m');

/* ---------- S1: the Nov 11 morning, replayed ---------- */
console.log('S1 — notes-only dispatch at session start seeds both sites; tips count');
(function () {
  const store = mkSharedStore(baseData(notesDispatch(NOTES)));
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, HOME, 60);
  const st = w.GeoLoads.status();
  ok(st.armed === true && st.sites && near(st.sites.load, GO) && near(st.sites.dump, HAUL),
    'S1a both sites seed from the dispatch\'s notes pins — load=' +
    (st.sites && st.sites.load ? st.sites.load.lat + ',' + st.sites.load.lng : 'null') +
    ' dump=' + (st.sites && st.sites.dump ? st.sites.dump.lat + ',' + st.sites.dump.lng : 'null'));
  ok(st.mode === 'armed' && st.counter && st.counter.mode === 'dump-visit',
    'S1b the day arms the DUMP-VISIT counter (mode=' + st.mode + ')');
  const td = w.GeoLoads.today();
  ok(td.armed === true && td.blocked === null && td.sites && near(td.sites.dump, HAUL),
    'S1c today() reads armed with the seeded sites (the card\'s unpegged-for-counting state is gone)');
  const rec = store._data.geoloads && store._data.geoloads.days[TODAY];
  ok(!!rec && rec.sites && near(rec.sites.load, GO) && near(rec.sites.dump, HAUL) && rec.blocked === null,
    'S1d the day record carries the seeded sites');
  loop(feed, clock, pos, false);
  ok(mach(w) === 1, 'S1e tip #1 at the Hauling To pin COUNTS — got ' + mach(w) +
    ' (on web 415 this is the morning\'s miss: 0)');
  park(feed, clock, HAUL, 120);
  ok(mach(w) === 1, 'S1f the same visit never counts twice — got ' + mach(w));
  driveTo(feed, clock, pos, GO, 300);
  park(feed, clock, GO, 240);
  ok(mach(w) === 1, 'S1g the closing load dwell adds nothing — got ' + mach(w));
  driveTo(feed, clock, pos, HAUL, 300);
  park(feed, clock, HAUL, 300);
  ok(mach(w) === 2, 'S1h tip #2 counts — got ' + mach(w));
  ok(w.GeoLoads.today().count === 2, 'S1i the day record agrees — today=' + w.GeoLoads.today().count);
})();

/* ---------- S2: the dispatch lands after the timer started ---------- */
console.log('S2 — session first, dispatch becomes active mid-session');
(function () {
  const store = mkSharedStore(baseData(null));
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, HOME, 120);
  ok(w.GeoLoads.status().armed === false, 'S2a no dispatch yet: nothing armed');
  store.set('dsp_active', notesDispatch(NOTES));
  store.set('dsp_list', [notesDispatch(NOTES)]);
  park(feed, clock, HOME, 120); // fixes flow past the world check
  const st = w.GeoLoads.status();
  ok(st.armed === true && st.sites && near(st.sites.load, GO) && near(st.sites.dump, HAUL),
    'S2b the landed dispatch seeds the running session (dispatchId=' + st.dispatchId + ')');
  loop(feed, clock, pos, false);
  ok(mach(w) === 1, 'S2c the first tip after the landing counts — got ' + mach(w));
})();

/* ---------- S3: an edit saved mid-session (same id, pins arrive) ---------- */
console.log('S3 — same dispatch, edit lands the pins mid-session');
(function () {
  const bare = notesDispatch('Foreman: Chad');
  const store = mkSharedStore(baseData(bare));
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, HOME, 120);
  const before = w.GeoLoads.status();
  ok(before.armed === false && !before.sites,
    'S3a a pin-less dispatch arms nothing (mode=' + before.mode + ')');
  store.set('dsp_active', notesDispatch(NOTES)); // same id, notes now carry the pins
  park(feed, clock, HOME, 120);
  const st = w.GeoLoads.status();
  ok(st.armed === true && st.sites && near(st.sites.load, GO) && near(st.sites.dump, HAUL),
    'S3b the edit re-seeds the SAME dispatch in the running session');
  loop(feed, clock, pos, false);
  ok(mach(w) === 1, 'S3c the first tip after the edit counts — got ' + mach(w));
})();

/* ---------- S4: seeding never lowers a counted day ---------- */
console.log('S4 — a relaunch over a counted day banks it whole');
(function () {
  const data = baseData(notesDispatch(NOTES));
  data.geoloads = { days: {} };
  data.geoloads.days[TODAY] = {
    date: TODAY, dispatchId: 'dsp-nov11', sessionKey: 'earlier-session',
    sites: null, blocked: 'learning', count: 2,
    events: [{ t: T0 + 3600000, site: 'dump', n: 1 }, { t: T0 + 7200000, site: 'dump', n: 2 }],
    corr: 0, state: null, updatedAt: T0
  };
  const store = mkSharedStore(data);
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const pos = { lat: HOME.lat, lng: HOME.lng };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, HOME, 60);
  ok(w.GeoLoads.today().count === 2, 'S4a the banked 2 survive the seeding — today=' + w.GeoLoads.today().count);
  const st = w.GeoLoads.status();
  ok(st.armed === true && st.sites && near(st.sites.dump, HAUL),
    'S4b the new session still seeds from the dispatch');
  loop(feed, clock, pos, false);
  ok(w.GeoLoads.today().count === 3, 'S4c the next tip lands ON the bank — today=' + w.GeoLoads.today().count);
})();

/* ---------- S5: stored pins always win over notes ---------- */
console.log('S5 — a stored pin is never overwritten by notes text');
(function () {
  const dsp = notesDispatch(NOTES);
  dsp.lat = 51.1252222; dsp.lng = -113.9828056;         // stored load pin (Nov 10's pit)
  dsp.dumpLat = 51.1225089; dsp.dumpLng = -114.0122197; // stored dump pin
  const store = mkSharedStore(baseData(dsp));
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, HOME, 30);
  const st = w.GeoLoads.status();
  ok(st.sites && Math.abs(st.sites.load.lat - 51.1252222) < 1e-6 &&
     Math.abs(st.sites.dump.lat - 51.1225089) < 1e-6 && !near(st.sites.dump, HAUL),
    'S5a the counter runs on the STORED pair, not the notes pair');
})();

/* ---------- S6: manual pegs keep precedence ---------- */
console.log('S6 — a pegged day is the pegs\' day, dispatch pins or not');
(function () {
  const store = mkSharedStore(baseData(notesDispatch(NOTES)));
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  const PEGLOAD = (function () { const p = goff(GO.lat, GO.lng, 600, 0); return { lat: p[0], lng: p[1] }; })();
  const PEGDUMP = (function () { const p = goff(HAUL.lat, HAUL.lng, 600, 0); return { lat: p[0], lng: p[1] }; })();
  const pos = { lat: HOME.lat, lng: HOME.lng };
  w.GeoLoads.startDay('s' + T0, {});
  driveTo(feed, clock, pos, PEGLOAD, 240);
  park(feed, clock, PEGLOAD, 60);
  const r1 = w.GeoLoads.setPeg('load');
  ok(r1 && r1.ok, 'S6a the pickup peg plants');
  driveTo(feed, clock, pos, PEGDUMP, 300);
  park(feed, clock, PEGDUMP, 60);
  const r2 = w.GeoLoads.setPeg('dump');
  ok(r2 && r2.ok && r2.armed, 'S6b the dump peg plants and the pair arms');
  const st = w.GeoLoads.status();
  /* a peg plants at the last live fix, wobble and all — the
     sites are the pegs' ground, not the park centres exactly. */
  ok(st.sites && havM(st.sites.load, PEGLOAD) < 30 && havM(st.sites.dump, PEGDUMP) < 30 &&
     w.GeoLoads.today().countSource === 'pegs',
    'S6c the counter keys off the PEGS (countSource=' + w.GeoLoads.today().countSource + ')');
  driveTo(feed, clock, pos, PEGLOAD, 300);
  park(feed, clock, PEGLOAD, 240);
  driveTo(feed, clock, pos, PEGDUMP, 300);
  park(feed, clock, PEGDUMP, 300);
  ok(mach(w) === 1, 'S6d the peg cycle counts its tip — got ' + mach(w));
})();

/* ---------- S7: the labels rule — reversed and unlabelled notes ---------- */
console.log('S7 — notes parsing keeps the 414/415 label discipline');
(function () {
  const store = mkSharedStore(baseData(notesDispatch(NOTES_REVERSED)));
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, HOME, 30);
  const st = w.GeoLoads.status();
  ok(st.sites && near(st.sites.load, GO) && near(st.sites.dump, HAUL),
    'S7a reversed notes still land each pin on its own role');
})();
(function () {
  const store = mkSharedStore(baseData(notesDispatch('Yard at (51.2000000, -114.0500000) all day')));
  const w = mkGeoWorld(store, geoSrc);
  const feed = mkFeed(w);
  const clock = { t: 0 };
  w.GeoLoads.startDay('s' + T0, {});
  park(feed, clock, HOME, 30);
  const st = w.GeoLoads.status();
  ok(!st.sites, 'S7b an UNLABELLED pair in the notes seeds nothing (mode=' + st.mode + ')');
})();

console.log('\n' + passed + ' passed / ' + failed + ' failed');
process.exit(failed ? 1 : 0);
