#!/usr/bin/env node
/* Meticulous v352 — PHONE-TIMER-RUNS-AFTER-WEB-CLOSE +
 * LIVE-MILES-OVERCOUNT-DRIFT + LIVE-MILES-START-STOP-WITH-DAY
 * (owner Nov 5, 20:02 screenshot + 23:34: "Start and stop?" /
 * "How can the live miles be more then ptis?").
 *
 * The Nov 5 shape: the day closed from the WEB session (9:00 AM–
 * 6:00 PM on the books), while the PHONE's tracker ran on —
 * 11:02:52 and counting at 20:02, Miles (live) 259.3 km against
 * the PTI odometer span 171,261 -> 171,497 = 236 km. Live miles
 * start when the day starts and stop when HE stops the day;
 * they must never count parked, and never out-run the odometer.
 *
 * Three fixes:
 *  (1) THE CLOSE REACHES THE PHONE. Every pull rule for the
 *      tracker key guarded an idle local or a live cloud copy;
 *      a LIVE local whose session the account had already
 *      booked as finished fell to the stamp game, where its own
 *      ticking re-stamps made it unbeatable. Now: (a) cloudsync's
 *      pull installs the cloud's idle copy when the local
 *      sessions list holds the finished twin of the local live
 *      session (the v271 identity test, mirrored); (b) app.js
 *      healClosedTracker runs the same test on the tracker tick
 *      and stands everything down WITHOUT booking (the closing
 *      session already wrote the entry) — LiveMiles.stopDay
 *      with trailHome (the drive home still accrues into the
 *      closed day's trail, per the standing close law),
 *      GeoLoads stop, the native session stop, tracker idle.
 *  (2) STILLNESS (js/miles.js): a fix landing within 45 m of
 *      the anchor names a stillness centre; fixes inside the
 *      radius count nothing and never move the anchor; the
 *      first fix beyond it counts in full from the anchor.
 *      Parked GPS wander — the drift that inflated the total —
 *      books zero, in ingest and in mergeCrumbs alike.
 *  (3) THE ODOMETER CAP (js/app.js stopSessionAt): when a
 *      finished entry carries both odometer readings, their
 *      span caps the liveKm the entry books.
 *
 * Proof: T1–T3 drive the real cloudsync pull (the sync-stomp
 * two-world harness); D1–D2 drive the real miles engine; the
 * app.js pieces are pinned by source (app.js's heal is a
 * closure on the tracker tick — its twin test is byte-for-byte
 * the one T1 proves at the sync layer).
 *
 * Run: node tools/tracker-close-elsewhere-v352-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const csSrc = read('js/cloudsync.js');
const milesSrc = read('js/miles.js');
const appSrc = read('js/app.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }

/* ---------- cloudsync worlds (the sync-stomp pattern) ---------- */
function makeServer() { return { docs: {}, clock: 100000, rejected: [] }; }
function serverSet(server, id, v, updatedAt) { server.docs[id] = { id: id, v: v, updatedAt: updatedAt || (++server.clock) }; }
function makeWorld(server, opts) {
  const data = {};
  const localStorage = {
    getItem: function (k) { return (k in data) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    removeItem: function (k) { delete data[k]; },
    key: function (i) { return Object.keys(data)[i] || null; },
    get length() { return Object.keys(data).length; }
  };
  (opts.local || []).forEach(function (kv) { data['mt_' + kv[0]] = JSON.stringify(kv[1]); });
  if (opts.meta) data['mt___syncmeta'] = JSON.stringify(opts.meta);
  const sb = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, Promise: Promise };
  sb.window = sb;
  sb.localStorage = localStorage;
  sb.navigator = { onLine: true };
  sb.document = { getElementById: function () { return null; }, addEventListener: function () {} };
  sb.addEventListener = function () {};
  const world = { sb: sb, data: data, server: server };
  sb.FB = {
    ready: true, user: { uid: 'u1' },
    loadDocs: function () {
      return Promise.resolve(Object.keys(server.docs).map(function (id) {
        const d = server.docs[id];
        return { id: d.id, v: d.v, updatedAt: d.updatedAt };
      }));
    },
    loadDoc: function (col, id) {
      const d = server.docs[id];
      return Promise.resolve(d ? { id: d.id, v: d.v, updatedAt: d.updatedAt } : null);
    },
    saveDoc: function (col, id, doc) { serverSet(server, id, doc.v); return Promise.resolve({}); },
    deleteDoc: function (col, id) { delete server.docs[id]; return Promise.resolve({}); }
  };
  vm.createContext(sb);
  vm.runInContext(csSrc, sb);
  const store = {
    get: function (k, d) { const r = localStorage.getItem('mt_' + k); return r === null ? d : JSON.parse(r); },
    set: function (k, v) { localStorage.setItem('mt_' + k, JSON.stringify(v)); return true; },
    del: function (k) { localStorage.removeItem('mt_' + k); return true; }
  };
  sb.CloudSync.attach(store);
  world.store = store;
  world.get = function (k) { const r = localStorage.getItem('mt_' + k); return r === null ? null : JSON.parse(r); };
  return world;
}
function settle(ms) { return new Promise(function (r) { setTimeout(r, ms || 600); }); }

const START = 1762434000000;               // the day's 9:00 AM session start (ms)
const SECONDS = 32400;                     // 9 h
const ENTRY = { date: '2026-11-05', seconds: SECONDS, endedAt: new Date(START + SECONDS * 1000).toISOString(), liveKm: 221.4 };
const RUNNING = { status: 'running', sessionId: START, startTs: START, elapsed: SECONDS };
const IDLE = { status: 'idle', startTs: 0, elapsed: 0 };

(async function () {
  console.log('— T: the close reaches the phone (cloudsync pull) —');
  /* T1: the incident — phone live + twin booked + cloud idle.
     The phone's meta stamp is the NEWEST (its ticks re-stamp):
     the old stamp game kept it running forever. */
  {
    const server = makeServer();
    serverSet(server, 'tracker', IDLE, 5000);
    serverSet(server, 'sessions', [ENTRY], 5000);
    const P = makeWorld(server, {
      local: [['tracker', RUNNING], ['sessions', [ENTRY]]],
      meta: { uid: 'u1', globallySynced: true, keys: { tracker: { t: 9999999999999, s: 4000, u: 'u1' }, sessions: { t: 4000, s: 4000, u: 'u1' } } }
    });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    eq('T1 the phone-side tracker is ENDED by the pull (the web close lands)', (P.get('tracker') || {}).status, 'idle');
  }
  /* T2: no booked twin anywhere — a live day must NOT be killed
     by a stray idle cloud copy. */
  {
    const server = makeServer();
    serverSet(server, 'tracker', IDLE, 5000);
    serverSet(server, 'sessions', [], 5000);
    const P = makeWorld(server, {
      local: [['tracker', RUNNING], ['sessions', []]],
      meta: { uid: 'u1', globallySynced: true, keys: { tracker: { t: 9999999999999, s: 4000, u: 'u1' }, sessions: { t: 4000, s: 4000, u: 'u1' } } }
    });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    eq('T2 with no finished twin, the live tracker keeps running', (P.get('tracker') || {}).status, 'running');
  }
  /* T3: a NEWER cloud session still wins (the v265 law stands;
     the new rule fires only for a closed cloud copy). */
  {
    const LATER = { status: 'running', sessionId: START + 86400000, startTs: START + 86400000, elapsed: 60 };
    const server = makeServer();
    serverSet(server, 'tracker', LATER, 5000);
    serverSet(server, 'sessions', [ENTRY], 5000);
    const P = makeWorld(server, {
      local: [['tracker', RUNNING], ['sessions', [ENTRY]]],
      meta: { uid: 'u1', globallySynced: true, keys: { tracker: { t: 4000, s: 4000, u: 'u1' }, sessions: { t: 4000, s: 4000, u: 'u1' } } }
    });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    eq('T3 the later cloud session installs as before', (P.get('tracker') || {}).sessionId, START + 86400000);
  }

  console.log('— D: stillness in the live-miles engine —');
  const sb2 = { console: console, Date: Date, Math: Math, JSON: JSON, Promise: Promise, setTimeout: setTimeout };
  sb2.window = sb2;
  vm.createContext(sb2);
  vm.runInContext(milesSrc, sb2);
  const ENGINE = sb2.LiveMiles._engine;
  function fix(lat, lng, t) { return { latitude: lat, longitude: lng, accuracy: 10, time: t }; }
  {
    const tr = ENGINE.createMilesTracker();
    tr.begin('s1', null);
    let t = START;
    /* drive 1 km north in ten 100 m steps, 30 s apart */
    tr.ingest(fix(51.0, -114.0, t));
    for (let i = 1; i <= 10; i++) { t += 30000; tr.ingest(fix(51.0 + i * 0.0009, -114.0, t)); }
    const afterDrive = tr.snapshot().totalM;
    ok('D1 the drive books ~1 km', afterDrive > 900 && afterDrive < 1100, 'totalM=' + afterDrive);
    /* park for 40 minutes: fixes wander ±~25 m around the spot,
       a fix a minute — the random walk that used to inflate */
    const parkLat = 51.0 + 10 * 0.0009;
    for (let j = 1; j <= 40; j++) {
      t += 60000;
      const wob = ((j % 4) - 1.5) * 0.00018;   // ±~20-30 m hops
      const wob2 = (((j * 7) % 5) - 2) * 0.00012;
      tr.ingest(fix(parkLat + wob, -114.0 + wob2, t));
    }
    const afterPark = tr.snapshot().totalM;
    ok('D1 40 parked minutes add (almost) nothing', afterPark - afterDrive < 60, 'grew ' + (afterPark - afterDrive) + ' m');
    /* leave: one fix ~300 m north, 5 minutes later */
    t += 300000;
    tr.ingest(fix(parkLat + 0.0027, -114.0, t));
    const afterExit = tr.snapshot().totalM;
    ok('D1 leaving the lot books the exit leg once', afterExit - afterPark > 200 && afterExit - afterPark < 420, 'exit grew ' + (afterExit - afterPark) + ' m');
    /* the native-crumb path obeys the same law */
    const tr2 = ENGINE.createMilesTracker();
    tr2.begin('s2', null);
    let t2 = START;
    tr2.ingest(fix(51.0, -114.0, t2));
    t2 += 30000; tr2.ingest(fix(51.0009, -114.0, t2));
    const crumbs = [];
    for (let k = 1; k <= 30; k++) {
      crumbs.push({ t: t2 + k * 60000, a: 51.0009 + (((k % 4) - 1.5) * 0.00018), o: -114.0 + (((k * 7) % 5) - 2) * 0.00012, c: 10 });
    }
    const before2 = tr2.snapshot().totalM;
    const res = tr2.mergeCrumbs(crumbs);
    const after2 = tr2.snapshot().totalM;
    ok('D2 a parked native-crumb run adds (almost) nothing', after2 - before2 < 60, 'grew ' + (after2 - before2) + ' m, addedM=' + res.addedM);
  }

  console.log('— app.js: the heal + the cap (source pins) —');
  ok('healClosedTracker exists and runs the finished-twin test',
    /function healClosedTracker\(\) \{[\s\S]{0,1500}Date\.parse\(e\.endedAt\) - Number\(e\.seconds\) \* 1000/.test(appSrc));
  ok('the heal stands the day down in close posture (trailHome stopDay, GeoLoads, native stop, idle, no booking)',
    /healClosedTracker[\s\S]{0,2500}LiveMiles\.stopDay\(\{ trailHome: true \}\)/.test(appSrc) &&
    /healClosedTracker[\s\S]{0,2500}ShiftTrack\.sessionStopped/.test(appSrc) &&
    appSrc.indexOf('healClosedTracker') > 0 && !/function healClosedTracker\(\) \{[\s\S]{0,2600}stopSessionAt/.test(appSrc));
  ok('the periodic wrapper runs the closed-heal beside the stale-heal',
    /healed = healStaleTracker\(\); \} catch \(e\) \{\}\s*if \(!healed\) \{ try \{ healed = healClosedTracker\(\);/.test(appSrc));
  ok('stopSessionAt caps the booked liveKm at the odometer span',
    /entry\.liveKm > odoSpanKm352\) entry\.liveKm = odoSpanKm352/.test(appSrc) &&
    appSrc.indexOf('odoSpanKm352', appSrc.indexOf('function stopSessionAt')) > appSrc.indexOf('entry.liveKm = milesFin.liveKm') &&
    appSrc.indexOf('odoSpanKm352', appSrc.indexOf('function stopSessionAt')) < appSrc.indexOf('takeSessionAccum(entry);', appSrc.indexOf('function stopSessionAt')));
  ok('cloudsync carries the mirror rule (a closed cloud copy + a booked twin ends the local live tracker)',
    /ct352CloudLive/.test(csSrc) && /PHONE-TIMER-RUNS-AFTER-WEB-CLOSE/.test(csSrc));
  eq('webVersion is 352', ver.webVersion, 352);
  ok('index.html pins app.js?v=352, cloudsync.js?v=352, miles.js?v=352',
    idxSrc.indexOf('js/app.js?v=352') >= 0 && idxSrc.indexOf('js/cloudsync.js?v=352') >= 0 && idxSrc.indexOf('js/miles.js?v=352') >= 0);

  console.log('\ntracker-close-elsewhere-v352: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL suite threw: ' + (e && e.stack || e)); process.exit(1); });
