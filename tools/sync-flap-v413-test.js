#!/usr/bin/env node
/* Meticulous v413 — SYNC-FLAPPING-NOV11 (owner evidence Nov 11,
 * 2026 00:56–00:59 CST, his screen recording + his words: "Sync is
 * having a hard time maintaining connection" / "it only turns
 * green only when I pressed sync in advanced").
 *
 * THE FIELD SHAPE (from the recording): app idle at 12:56 AM, no
 * shift running, the Advanced card cycles "Syncing…" → "✓ All
 * synced · 12:56 AM" → "Syncing…" on a few-second cadence, and the
 * Live miles backup line rolls attempt after attempt inside one
 * minute — "FAILED at the read step", "FAILED at the write step",
 * occasionally "landed ✓". A manual press of "Retry sync now"
 * settles it green.
 *
 * THE MECHANISM (convicted below, in the real js/cloudsync.js):
 *  1. THE STORM. The day-miles watch (App.armDayMiles) is armed
 *     all night before a dispatch day, so the miles engine keeps
 *     persisting 'livemiles' while the tracker sits IDLE. Every
 *     such store stamp re-arms CloudSync's urgent flag (the v301
 *     telemetry-stamp block in the wrapped store.set: "a
 *     telemetry stamp that lands while the tracker sits idle or
 *     paused re-arms the urgent flag"), so flush() carries the
 *     telemetry keys on the 2.5 s debounce — the 60 s coalesce
 *     (v276, the Spark-quota law) never applies. Every persist
 *     becomes a full read-merge-write of the ~240 KB tracking
 *     document.
 *  2. NO BACKOFF. A failed telemetry attempt leaves the key
 *     dirty and stamps NOTHING on the coalesce clock (the clock
 *     stamps only landed writes), so the next persist / flush /
 *     watchdog tick fires the next attempt immediately. On the
 *     owner's link the big doc's read+write outruns the flush's
 *     20 s push race, so attempts are abandoned mid-flight and
 *     recorded FAILED at whichever stage they had reached —
 *     read one time, write the next — while the writes
 *     themselves land late underneath the following attempts.
 *  3. WHY ONLY THE BUTTON SETTLES IT. flush() can clean a
 *     telemetry key only through a push that lands inside the
 *     race; the PULL can clean it by comparison (the cloud
 *     already holds the copy a timed-out write landed late).
 *     The auto path pulls at most once per 10 min
 *     (REPEAT_PULL_GAP_MS) and re-dirties the key with every
 *     persist in between, so it never sits settled; by the time
 *     the owner opens Advanced and presses the button, a pull
 *     is due — the press runs it, the comparison seals the key,
 *     the drain finishes, green.
 *
 * THE FIX (js/cloudsync.js only — the sync/backup path):
 *  F1. A telemetry stamp no longer re-arms the urgent flag.
 *      Telemetry rides its 60 s coalesce; urgency still comes
 *      from the tracker TRANSITION stamp itself (pause / stop —
 *      the close's own stamp, unchanged) and from the
 *      hide / beforeunload / pagehide flushes. The post-close
 *      accrual stamps v301 was protecting ride the coalesce
 *      (≤60 s) or the hide flush, exactly like every other
 *      telemetry stamp on a running day.
 *  F2. A failed telemetry attempt stamps the coalesce clock
 *      too (the clock becomes "last attempt"): a key whose
 *      backup just failed waits out the same 60 s quiet as one
 *      whose backup landed, instead of hot-looping on every
 *      persist and watchdog tick.
 *
 * Proof (this suite, the real cloudsync.js in a v411-style
 * two-world harness; sandbox timers run at 1/20 scale so the
 * 20 s push race, 2.5 s debounce, 30 s watchdog and 60 s
 * coalesce keep their ratios; the FB double deep-copies like
 * Firestore and applies writes when their latency completes —
 * a race-abandoned write still lands late, as on device):
 *  A — idle day-watch persists every 10 s (field) for 3 min
 *      against a slow link (read 5 s + write 18 s field — a
 *      round trip over the 20 s race budget):
 *      S0 boot converges clean, zero pushes (invariant);
 *      S1 telemetry attempts stay coalesced (≤6 in 3 min);
 *      S2 attempts never overlap (max concurrent = 1 —
 *      invariant; the flush chain serializes attempts even
 *      in the storm, the storm's cost is the RATE);
 *      S3 once the persists stop, the AUTO path (watchdog
 *      only — no manual syncNow) settles to "All synced" and
 *      stays there with no further attempts (invariant).
 *  B — the same persist rain against a link whose writes
 *      REJECT ('unavailable'):
 *      S4 attempts back off (≤5 in 3 min);
 *      S5 the key honestly stays dirty — no false green while
 *      the backup genuinely cannot land (invariant).
 *  C — the close still rides out promptly:
 *      S6 a tracker stop stamp carries a telemetry write at
 *      once, inside a fresh coalesce window (invariant —
 *      the v276/v301 close guarantee, kept).
 *
 * On pristine web 412 bytes (measured): S1 fails — 17
 * attempts in 3 field-minutes; S4 fails — 22 attempts
 * against rejecting writes in the same window. In scenario
 * A every one of those attempts outruns the 20 s push race
 * (5 s read + 18 s write of the big doc), so each is
 * abandoned mid-flight and recorded at its stage — the
 * read/write alternation in the owner's recording. S0/S2/
 * S3/S5/S6 hold on 412 too — they are the invariants the
 * fix must not break.
 *
 * Run: node tools/sync-flap-v413-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const csSrc = fs.readFileSync(path.join(ROOT, 'js/cloudsync.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function section(s) { console.log('\n— ' + s + ' —'); }

const SCALE = 20; // sandbox ms -> field ms
const RealDate = Date;
const T0 = new RealDate(2026, 10, 11, 0, 56, 0, 0).getTime(); // Nov 11 2026, 12:56 AM local

/* ---------------- fixtures ---------------- */
function dayRec(key, totalM, updatedAt, crumbN) {
  const crumbs = [];
  const base = updatedAt - 8 * 3600 * 1000;
  for (let i = 0; i < crumbN; i++) crumbs.push({ t: base + i * 97000, a: 51.123456 + i * 0.0001, o: -114.012345 - i * 0.0001 });
  const segs = [];
  for (let i = 0; i < 6; i++) segs.push({ f: base + i * 3600000, t: base + (i + 1) * 3600000 - 60000 });
  return {
    key: key, totalM: totalM,
    anchor: { time: base + (crumbN - 1) * 97000, latitude: 51.13, longitude: -114.02 },
    still: null, crumbs: crumbs, segs: segs, joinFrom: null,
    bridgedM: 0, bridges: [], date: '2026-11-10', updatedAt: updatedAt
  };
}
function livemilesFixture(now) {
  const days = {};
  for (let d = 0; d < 16; d++) {
    const start = now - (16 - d) * 24 * 3600 * 1000;
    days['s' + start] = dayRec('s' + start, 30000 + d * 7331, start + 9 * 3600 * 1000, 240);
  }
  days['d2026-11-11'] = dayRec('d2026-11-11', 1200, now - 3600000, 240);
  return { days: days };
}
function geoloadsFixture(now) {
  const days = {};
  for (let d = 0; d < 3; d++) {
    const start = now - (3 - d) * 24 * 3600 * 1000;
    const ev = [];
    for (let i = 0; i < 6; i++) ev.push({ t: start + i * 1800000, a: 51.2, o: -114.03, k: 'dump' });
    days['s' + start] = { count: 5 + d, corr: 0, events: ev, pegEvents: [], updatedAt: start + 9 * 3600 * 1000 };
  }
  return { days: days };
}
function deep(v) { return JSON.parse(JSON.stringify(v)); }

/* ---------------- world ---------------- */
function makeWorld(opts) {
  const nowRef = { now: opts.now };
  class FakeDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [nowRef.now])); }
    static now() { return nowRef.now; }
  }
  const timerIds = [];
  function scaledSetTimeout(fn, ms) {
    const id = setTimeout(fn, Math.max(0, Math.round((ms || 0) / SCALE)));
    return id;
  }
  function scaledSetInterval(fn, ms) {
    const id = setInterval(fn, Math.max(1, Math.round((ms || 0) / SCALE)));
    timerIds.push(id);
    return id;
  }
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

  const server = { docs: {} };
  (opts.cloud || []).forEach(function (kv) {
    server.docs[kv[0]] = { id: kv[0], v: deep(kv[1]), updatedAt: opts.cloudTs };
  });
  const fbStats = { loadDoc: {}, loadDocs: 0, saveDoc: {}, deleteDoc: 0, openTele: 0, maxOpenTele: 0 };
  function later(ms, fn) { return new Promise(function (res) { scaledSetTimeout(function () { res(fn()); }, ms); }); }
  const FB = {
    ready: true, user: { uid: 'u1' },
    loadDocs: function () {
      fbStats.loadDocs++;
      return later(opts.lat.loadDocs, function () {
        return Object.keys(server.docs).map(function (id) {
          const d = server.docs[id];
          return { id: d.id, v: deep(d.v), updatedAt: d.updatedAt };
        });
      });
    },
    loadDoc: function (col, id) {
      fbStats.loadDoc[id] = (fbStats.loadDoc[id] || 0) + 1;
      const isTele = (id === 'livemiles');
      if (isTele) { fbStats.openTele++; if (fbStats.openTele > fbStats.maxOpenTele) fbStats.maxOpenTele = fbStats.openTele; }
      return later(opts.lat.loadDoc, function () {
        const d = server.docs[id];
        if (isTele && opts.failRead) { fbStats.openTele--; throw new Error('unavailable: read failed'); }
        return d ? { id: d.id, v: deep(d.v), updatedAt: d.updatedAt } : null;
      });
    },
    saveDoc: function (col, id, doc) {
      fbStats.saveDoc[id] = (fbStats.saveDoc[id] || 0) + 1;
      const isTele = (id === 'livemiles');
      const lat = (opts.lat.saveDocByKey && opts.lat.saveDocByKey[id]) || opts.lat.saveDoc;
      return new Promise(function (resolve, reject) {
        scaledSetTimeout(function () {
          if (isTele) fbStats.openTele--;
          if (opts.failWrite && isTele) { reject(new Error('unavailable: write failed')); return; }
          if (opts.failWriteAll) { reject(new Error('unavailable: write failed')); return; }
          server.docs[id] = { id: id, v: deep(doc.v), updatedAt: nowRef.now };
          resolve({});
        }, Math.max(0, Math.round(lat / SCALE)));
      });
    },
    deleteDoc: function (col, id) {
      fbStats.deleteDoc++;
      return later(opts.lat.saveDoc, function () { delete server.docs[id]; return {}; });
    }
  };

  const sb = {
    console: console, Promise: Promise, Date: FakeDate, Math: Math, JSON: JSON,
    setTimeout: scaledSetTimeout, clearTimeout: clearTimeout,
    setInterval: scaledSetInterval, clearInterval: clearInterval
  };
  sb.window = sb;
  sb.localStorage = localStorage;
  sb.navigator = { onLine: true };
  sb.document = { getElementById: function () { return null; }, addEventListener: function () {}, visibilityState: 'visible' };
  sb.addEventListener = function () {};
  sb.FB = FB;
  vm.createContext(sb);
  vm.runInContext(csSrc, sb);
  const store = {
    get: function (k, d) { const r = localStorage.getItem('mt_' + k); return r === null ? d : JSON.parse(r); },
    set: function (k, v) { localStorage.setItem('mt_' + k, JSON.stringify(v)); return true; },
    del: function (k) { localStorage.removeItem('mt_' + k); return true; }
  };
  sb.CloudSync.attach(store);
  return {
    sb: sb, store: store, server: server, fbStats: fbStats, nowRef: nowRef,
    status: function () { return sb.CloudSync.status(); },
    meta: function () { const r = localStorage.getItem('mt___syncmeta'); return r === null ? null : JSON.parse(r); },
    close: function () { timerIds.forEach(function (id) { clearInterval(id); }); }
  };
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function baseFixture(now) {
  const lm = livemilesFixture(now);
  const gl = geoloadsFixture(now);
  const tracker = { status: 'idle', startTs: 0, elapsed: 0 };
  const sessions = [
    { date: '2026-11-09', seconds: 36000, endedAt: new RealDate(now - 2 * 24 * 3600 * 1000).toISOString() },
    { date: '2026-11-10', seconds: 23400, endedAt: new RealDate(now - 16 * 3600 * 1000).toISOString() }
  ];
  const onboarding = { firstName: 'Asjad', accountType: 'driver', drives: 'yes' };
  const fuel = [{ id: 'f1', date: '2026-11-10', time: '18:02', litres: 71.97, cost: 156.10, station: 'Shell', odo: 172414 }];
  const keys = ['livemiles', 'geoloads', 'tracker', 'sessions', 'onboarding', 'fuel_fills'];
  const metaKeys = {};
  keys.forEach(function (k) { metaKeys[k] = { t: now - 1800000, s: now - 1800000, u: 'u1' }; });
  return {
    local: [['livemiles', lm], ['geoloads', gl], ['tracker', tracker], ['sessions', sessions], ['onboarding', onboarding], ['fuel_fills', fuel]],
    cloud: [['livemiles', lm], ['geoloads', gl], ['tracker', tracker], ['sessions', sessions], ['onboarding', onboarding], ['fuel_fills', fuel]],
    meta: { uid: 'u1', globallySynced: true, _backfilled: true, keys: metaKeys },
    lm: lm
  };
}

/* The engine persist rain: every 500 real ms (= 10 s field) the
 * day-watch engine re-stamps today's record (updatedAt moves,
 * nothing else changes — the shape a stationary phone produces). */
function startPersistRain(world, fixture) {
  const iv = setInterval(function () {
    world.nowRef.now += 10000;
    const v = deep(fixture.lm);
    v.days['d2026-11-11'].updatedAt = world.nowRef.now;
    world.store.set('livemiles', v);
  }, 500);
  return function () { clearInterval(iv); };
}

(async function main() {
  /* ============ A — idle persist rain, slow link ============ */
  section('A — idle day-watch persist rain, slow link (read 5 s + write 18 s field)');
  {
    const fx = baseFixture(T0);
    const w = makeWorld({
      now: T0, local: fx.local, cloud: fx.cloud, meta: fx.meta, cloudTs: T0 - 3600000,
      lat: { loadDocs: 250, loadDoc: 250, saveDoc: 60, saveDocByKey: { livemiles: 900 } }
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await wait(1800);
    const st0 = w.status();
    ok('S0 boot converges clean with zero pushes', st0.state === 'ok' && !st0.dirtyKeys.length &&
      Object.keys(w.fbStats.saveDoc).length === 0,
      'state=' + st0.state + ' dirty=' + JSON.stringify(st0.dirtyKeys) + ' writes=' + JSON.stringify(w.fbStats.saveDoc));

    const readsBefore = w.fbStats.loadDoc['livemiles'] || 0;
    const stopRain = startPersistRain(w, fx);
    const seenStates = {};
    let timeoutErrSeen = false;
    const sampler = setInterval(function () {
      const s = w.status();
      seenStates[s.state] = true;
      if (s.lastError && String(s.lastError).indexOf('push-timeout') >= 0) timeoutErrSeen = true;
    }, 200);
    await wait(9000); // 3 field-minutes of persist rain
    stopRain(); clearInterval(sampler);
    const attempts = (w.fbStats.loadDoc['livemiles'] || 0) - readsBefore;
    console.log('    [diag] livemiles attempts in 3 field-min: ' + attempts +
      ', max concurrent: ' + w.fbStats.maxOpenTele + ', states seen: ' + Object.keys(seenStates).join(',') +
      ', push-timeout abandonment observed: ' + timeoutErrSeen);
    ok('S1 telemetry attempts stay coalesced under a persist rain (<=6 in 3 field-min)', attempts <= 6, 'attempts=' + attempts);
    ok('S2 telemetry attempts never overlap (max concurrent = 1)', w.fbStats.maxOpenTele <= 1, 'maxOpen=' + w.fbStats.maxOpenTele);

    // Phase 2: persists stopped. Advance the field clock past the
    // repeat-pull gap and let ONLY the watchdog drive — no manual
    // syncNow. The auto path must settle and stay settled.
    w.nowRef.now += 11 * 60 * 1000;
    await wait(2200);
    const attemptsMid = w.fbStats.loadDoc['livemiles'] || 0;
    await wait(3200);
    const stEnd = w.status();
    const attemptsEnd = w.fbStats.loadDoc['livemiles'] || 0;
    ok('S3 auto path settles to All synced and stays (no manual press)',
      stEnd.state === 'ok' && !stEnd.dirtyKeys.length && attemptsEnd === attemptsMid,
      'state=' + stEnd.state + ' dirty=' + JSON.stringify(stEnd.dirtyKeys) +
      ' attemptsAfterSettle=' + (attemptsEnd - attemptsMid));
    w.close();
  }

  /* ============ B — persist rain, writes reject ============ */
  section('B — idle persist rain, cloud writes reject (unavailable)');
  {
    const fx = baseFixture(T0);
    const w = makeWorld({
      now: T0, local: fx.local, cloud: fx.cloud, meta: fx.meta, cloudTs: T0 - 3600000,
      lat: { loadDocs: 100, loadDoc: 100, saveDoc: 100 }, failWrite: true
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await wait(1500);
    const readsBefore = w.fbStats.loadDoc['livemiles'] || 0;
    const stopRain = startPersistRain(w, fx);
    await wait(9000);
    stopRain();
    const attempts = (w.fbStats.loadDoc['livemiles'] || 0) - readsBefore;
    console.log('    [diag] livemiles attempts against rejecting writes in 3 field-min: ' + attempts);
    ok('S4 failed telemetry attempts back off (<=5 in 3 field-min)', attempts <= 5, 'attempts=' + attempts);
    const stB = w.status();
    ok('S5 a genuinely failing backup stays honestly dirty (no false green)',
      stB.telemetryDirtyKeys.indexOf('livemiles') >= 0,
      'telemetryDirty=' + JSON.stringify(stB.telemetryDirtyKeys));
    w.close();
  }

  /* ============ C — the close still rides out at once ============ */
  section('C — tracker stop stamp carries telemetry inside a fresh coalesce window');
  {
    const fx = baseFixture(T0);
    fx.meta.teleTp = { livemiles: T0 - 5000 }; // a landed push 5 field-s ago: coalesce would gate
    const w = makeWorld({
      now: T0, local: fx.local, cloud: fx.cloud, meta: fx.meta, cloudTs: T0 - 3600000,
      lat: { loadDocs: 40, loadDoc: 40, saveDoc: 40 }
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await wait(1200);
    const writesBefore = w.fbStats.saveDoc['livemiles'] || 0;
    const v = deep(fx.lm); v.days['d2026-11-11'].updatedAt = T0 + 1000;
    w.store.set('livemiles', v);                                   // the engines' final snapshot
    w.store.set('tracker', { status: 'idle', startTs: 0, elapsed: 0, stateAt: T0 + 1000 }); // the stop stamp
    await wait(900);
    const writes = (w.fbStats.saveDoc['livemiles'] || 0) - writesBefore;
    ok('S6 the close pushes telemetry promptly despite the coalesce window', writes >= 1, 'writes=' + writes);
    w.close();
  }

  console.log('\n' + pass + ' pass / ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
