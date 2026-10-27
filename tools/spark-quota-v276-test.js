#!/usr/bin/env node
/* Meticulous — SPARK-QUOTA (v276). The stress test (Oct 27,
 * hidden_files/stress-test-25k-oct27.md) proved the app itself
 * holds under load but the FREE Spark plan breaks first:
 * 20,000 Firestore writes/day for the whole project, and the
 * two telemetry keys (livemiles, geoloads — rewritten by their
 * engines at most every ~10 s all shift) were pushed on nearly
 * every flush: ~3,000–7,000 writes per driver-day, the whole
 * quota gone after ~4–6 active drivers. The owner's rule
 * (Oct 27): no paid plan until the first paying user exists —
 * so the code, not the billing, carries the app until then.
 *
 * FIX 1 (this suite, W1–W3, W6) — TELEMETRY COALESCING in
 * js/cloudsync.js: a telemetry key pushes at most once per
 * TELEMETRY_PUSH_MIN_MS (60 s) per key, however often the
 * engines persist it. The flush turns URGENT — telemetry rides
 * immediately — on the events that matter: a tracker pause or
 * stop landing in the store (every stop funnels through
 * stopSessionAt, which stamps tracker 'paused' / 'idle'), the
 * page hiding, and beforeunload. A telemetry tombstone is
 * never gated. Durable keys are never gated. The day-total
 * merge on pull (v224), the miles-dispatch gate (v263), the
 * phantom identity guard + tombstone (v271) and the record
 * union/shadow law (v272) are untouched.
 *
 * FIX 2 (W4, W5) — TARGETED RECORD-SAVE READS: pushOne for a
 * record-list key used to read the WHOLE kv collection
 * (~36 docs) to find the one doc it merges. It now reads that
 * one doc (FB.loadDoc, js/firebase.js). When loadDoc is absent
 * (a half-updated bundle mid-OTA), it falls back to the old
 * whole-collection read — identical merge, more reads.
 *
 * The worlds run on a FAKE CLOCK (the engines' 10 s persist
 * cadence over a simulated 10-hour shift would take 10 real
 * hours otherwise): store.set calls model the engines'
 * documented contract (persist at most every 10 s per key,
 * day-map values with growing totals).
 *
 * Cases: W1 the shift — telemetry write counts over 10 h ·
 * W2 the 60 s cadence + urgent pause flush · W3 cold-start
 * restore reads back the final totals · W4 a record save reads
 * 1 doc, not 36, and the union still lands · W5 the no-loadDoc
 * fallback keeps the union · W6 a telemetry tombstone inside
 * the gate window still deletes at once.
 *
 * Run: node tools/spark-quota-v276-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const csSrc = fs.readFileSync(path.join(ROOT, 'js', 'cloudsync.js'), 'utf8');

const realSetTimeout = setTimeout;
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function drain() { return new Promise(function (r) { realSetTimeout(r, 0); }); }

/* ---------------- fake-clock world ---------------- */
function makeWorld(opts) {
  opts = opts || {};
  let now = opts.startAt || 1800000000000;
  let timerSeq = 0;
  const timers = [];
  function fakeSetTimeout(fn, ms) {
    const id = ++timerSeq;
    timers.push({ id: id, at: now + Math.max(0, ms || 0), fn: fn, interval: 0 });
    return id;
  }
  function fakeSetInterval(fn, ms) {
    const id = ++timerSeq;
    timers.push({ id: id, at: now + Math.max(0, ms || 0), fn: fn, interval: Math.max(1, ms || 0) });
    return id;
  }
  function fakeClear(id) {
    const i = timers.findIndex(function (t) { return t.id === id; });
    if (i >= 0) timers.splice(i, 1);
  }
  const RealDate = Date;
  function FakeDate(a, b, c, d, e, f, g) {
    if (a === undefined) return new RealDate(now);
    if (b === undefined) return new RealDate(a);
    return new RealDate(a, b, c || 0, d || 0, e || 0, f || 0, g || 0);
  }
  FakeDate.now = function () { return now; };
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;

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

  const docListeners = {}, winListeners = {};
  const documentStub = {
    visibilityState: 'visible',
    getElementById: function () { return null; },
    addEventListener: function (ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); }
  };
  const sb = {
    console: console, Promise: Promise, JSON: JSON, Math: Math,
    setTimeout: fakeSetTimeout, clearTimeout: fakeClear,
    setInterval: fakeSetInterval, clearInterval: fakeClear,
    Date: FakeDate
  };
  sb.window = sb;
  sb.localStorage = localStorage;
  sb.navigator = { onLine: true };
  sb.document = documentStub;
  sb.addEventListener = function (ev, fn) { (winListeners[ev] = winListeners[ev] || []).push(fn); };

  const world = {
    sb: sb, data: data, pushes: [], deletes: [], reads: 0,
    cloudDocs: opts.docs || [], stampSeq: 0,
    now: function () { return now; }
  };
  sb.FB = {
    ready: true,
    user: { uid: 'u1' },
    loadDocs: function () {
      world.reads += world.cloudDocs.length;
      return Promise.resolve(world.cloudDocs.map(function (d) {
        return { id: d.id, v: d.v, updatedAt: d.updatedAt };
      }));
    },
    saveDoc: function (col, id, doc) {
      world.pushes.push({ id: id, v: doc.v, at: now });
      const stamp = now + (++world.stampSeq);
      let found = false;
      world.cloudDocs = world.cloudDocs.map(function (d) {
        if (d.id === id) { found = true; return { id: id, v: doc.v, updatedAt: stamp }; }
        return d;
      });
      if (!found) world.cloudDocs.push({ id: id, v: doc.v, updatedAt: stamp });
      return Promise.resolve({});
    },
    deleteDoc: function (col, id) {
      world.deletes.push({ id: id, at: now });
      world.cloudDocs = world.cloudDocs.filter(function (d) { return d.id !== id; });
      return Promise.resolve({});
    }
  };
  if (!opts.noLoadDoc) {
    sb.FB.loadDoc = function (col, id) {
      world.reads += 1;
      const d = world.cloudDocs.find(function (x) { return x.id === id; });
      return Promise.resolve(d ? { id: d.id, v: d.v, updatedAt: d.updatedAt } : null);
    };
  }
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
  world.fireDoc = function (ev) { (docListeners[ev] || []).forEach(function (fn) { fn(); }); };
  world.fireWin = function (ev) { (winListeners[ev] || []).forEach(function (fn) { fn(); }); };
  world.setVisibility = function (v) { documentStub.visibilityState = v; };
  world.pushesFor = function (id, since) {
    return world.pushes.filter(function (p) { return p.id === id && (since === undefined || p.at >= since); });
  };
  /* advance the fake clock, firing timers in order and draining
     promise chains (real macrotask turns) between them */
  world.advance = async function (ms) {
    const end = now + ms;
    await drain();
    for (;;) {
      timers.sort(function (a, b) { return a.at - b.at; });
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      now = t.at;
      if (t.interval) { t.at = now + t.interval; timers.push(t); }
      try { t.fn(); } catch (e) {}
      await drain();
    }
    now = end;
    await drain(); await drain();
  };
  return world;
}

/* ---------------- fixtures ---------------- */
const DAY = '2026-10-28';
function milesVal(totalM, now) {
  const rec = { key: 's1', date: DAY, totalM: totalM, crumbs: Math.floor(totalM / 40), hasFix: true, updatedAt: now };
  const out = { days: {} }; out.days['s1'] = rec; return out;
}
function loadsVal(count, now) {
  const rec = { date: DAY, count: count, corr: 0, events: [], state: { tick: count * 7 }, updatedAt: now };
  const out = { days: {} }; out.days[DAY] = rec; return out;
}
const F_A = { date: '2026-10-19', litres: 90.259, cost: 206.60, station: 'Petro-Canada', odo: 169531 };
const F_B = { date: '2026-10-20', litres: 104.036, cost: 239.18, station: 'Petro-Canada', odo: 169775 };
const F_C = { date: '2026-10-22', time: '17:13', litres: 38.970, cost: 86.86, station: 'Mobil @ 1739', odo: 170079 };

/* a settled, signed-in world over a realistic 36-doc tree:
   local == cloud for every key, meta stamps old and clean */
function settledWorld(extra) {
  const keys = ['onboarding', 'tracker', 'sessions', 'fuel_fills', 'rev_entries', 'rev_extras',
    'pti_reports', 'dmg_reports', 'livemiles', 'geoloads', 'dsp_today', 'dsp_history',
    'inv_settings', 'prefs', 'odo_readings', 'mt_odo', 'reminders', 'pnl',
    'nav_places', 'subscription', 'feedback', 'dayarm', 'autostart', 'con_list',
    'con_hidden', 'con_outbox', 'pipe_landed', 'pipe_seen', 'nav_shares', 'cp_hist_peers',
    'tracker_settings', 'manifest_prefs', 'fuel_settings', 'pti_draft', 'dmg_draft', 'misc_notes'];
  const vals = {
    onboarding: { name: 'Driver One', accountType: 'driver' },
    tracker: { status: 'idle', startTs: 0, elapsed: 0 },
    sessions: [], fuel_fills: [F_A], rev_entries: [], rev_extras: [],
    pti_reports: [], dmg_reports: [],
    livemiles: milesVal(0, 1000), geoloads: loadsVal(0, 1000)
  };
  const local = [], docs = [], metaKeys = {};
  keys.forEach(function (k) {
    const v = (k in vals) ? vals[k] : { seed: k };
    local.push([k, v]);
    docs.push({ id: k, v: JSON.parse(JSON.stringify(v)), updatedAt: 500 });
    metaKeys[k] = { t: 1000, s: 1000, u: 'u1' };
  });
  const opts = {
    local: local, docs: docs,
    meta: { uid: 'u1', globallySynced: true, keys: metaKeys }
  };
  if (extra) Object.assign(opts, extra);
  return makeWorld(opts);
}

(async function () {
  /* ================= W1: THE SHIFT — write counts ================= */
  {
    const w = settledWorld();
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await w.advance(5000);
    const w0 = w.pushes.length;
    const t0 = w.now();

    /* shift start */
    w.store.set('tracker', { status: 'running', sessionId: 111, startTs: t0 });
    let totalM = 0, loads = 0, fuelPushAt = -1;
    const SHIFT_S = 36000, PAUSE_AT = 10800, PAUSE_LEN = 900, HIDE_AT = 18000, FUEL_AT = 21600;
    for (let s = 10; s <= SHIFT_S; s += 10) {
      const t = t0 + s * 1000;
      const paused = s >= PAUSE_AT && s < PAUSE_AT + PAUSE_LEN;
      if (s === PAUSE_AT) w.store.set('tracker', { status: 'paused', sessionId: 111, startTs: t0 });
      if (s === PAUSE_AT + PAUSE_LEN) w.store.set('tracker', { status: 'running', sessionId: 111, startTs: t0 });
      if (s === HIDE_AT) { w.setVisibility('hidden'); w.fireDoc('visibilitychange'); w.setVisibility('visible'); }
      if (!paused) {
        totalM += 137; /* ~49 km/h of driving per 10 s tick */
        if (s % 540 === 0) loads += 1; /* a counted load every ~9 min */
        w.store.set('livemiles', milesVal(totalM, t));
        w.store.set('geoloads', loadsVal(loads, t));
      }
      if (s === FUEL_AT) {
        fuelPushAt = w.now();
        w.store.set('fuel_fills', [F_A, F_B]); /* a durable save mid-shift */
      }
      await w.advance(10000);
    }
    /* shift stop — stopSessionAt's writes: the closed session,
       the final engine snapshots, the tracker back to idle */
    const stopT = w.now();
    w.store.set('livemiles', milesVal(totalM, stopT));
    w.store.set('geoloads', loadsVal(loads, stopT));
    w.store.set('sessions', [{ date: DAY, seconds: 36000, endedAt: '2026-10-28T18:00:00' }]);
    w.store.set('tracker', { status: 'idle', startTs: 0, elapsed: 0 });
    await w.advance(5000);

    const tele = w.pushesFor('livemiles', t0).length + w.pushesFor('geoloads', t0).length;
    console.log('  [W1] telemetry pushes over the 10 h shift: ' + tele +
      ' (pre-fix pattern: ~7,200)');
    ok('W1 telemetry writes over a 10 h shift are coalesced (<= 1250)', tele <= 1250, 'got ' + tele);
    ok('W1 telemetry still flows all shift (>= 900 pushes — not starved)', tele >= 900, 'got ' + tele);
    const fuelPushes = w.pushesFor('fuel_fills', fuelPushAt);
    ok('W1 a durable save mid-shift pushes at once (not gated)',
      fuelPushes.length >= 1 && fuelPushes[0].at - fuelPushAt <= 3000,
      JSON.stringify(fuelPushes.map(function (p) { return p.at - fuelPushAt; })));
    const cloudMiles = (w.cloudDocs.find(function (d) { return d.id === 'livemiles'; }) || {}).v;
    const cloudLoads = (w.cloudDocs.find(function (d) { return d.id === 'geoloads'; }) || {}).v;
    eq('W1 the cloud holds the FINAL miles total after the stop',
      cloudMiles && cloudMiles.days['s1'].totalM, totalM);
    eq('W1 the cloud holds the FINAL load count after the stop',
      cloudLoads && cloudLoads.days[DAY].count, loads);
    const lastTele = Math.max.apply(null, w.pushes.filter(function (p) {
      return p.id === 'livemiles' || p.id === 'geoloads';
    }).map(function (p) { return p.at; }));
    ok('W1 the stop flushed telemetry immediately (last push at the stop, not a minute later)',
      lastTele >= stopT && lastTele - stopT <= 3000, 'last push offset ' + (lastTele - stopT));

    /* ---- W3: cold-start restore from W1's cloud ---- */
    const w3 = makeWorld({ docs: w.cloudDocs.map(function (d) {
      return { id: d.id, v: JSON.parse(JSON.stringify(d.v)), updatedAt: d.updatedAt };
    }) });
    w3.sb.CloudSync.onAuth({ uid: 'u1' });
    await w3.advance(5000);
    const restoredMiles = w3.get('livemiles');
    const restoredLoads = w3.get('geoloads');
    eq('W3 a cold start restores the final miles from the cloud',
      restoredMiles && restoredMiles.days['s1'].totalM, totalM);
    eq('W3 a cold start restores the final load count from the cloud',
      restoredLoads && restoredLoads.days[DAY].count, loads);
  }

  /* ================= W2: CADENCE + URGENT PAUSE ================= */
  {
    const w = settledWorld();
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await w.advance(5000);
    const t0 = w.now();
    w.store.set('tracker', { status: 'running', sessionId: 222, startTs: t0 });
    let totalM = 0;
    for (let s = 10; s <= 600; s += 10) {
      totalM += 137;
      w.store.set('livemiles', milesVal(totalM, t0 + s * 1000));
      w.store.set('geoloads', loadsVal(0, t0 + s * 1000));
      await w.advance(10000);
    }
    const stamps = w.pushesFor('livemiles', t0).map(function (p) { return p.at; });
    const gaps = [];
    for (let i = 1; i < stamps.length; i++) gaps.push((stamps[i] - stamps[i - 1]) / 1000);
    console.log('  [W2] livemiles push gaps (s): ' + gaps.join(', '));
    ok('W2 no two telemetry pushes land closer than ~55 s while running',
      gaps.length >= 3 && gaps.every(function (g) { return g >= 55; }),
      'gaps ' + JSON.stringify(gaps));
    /* pause mid-window: total jumps, tracker pauses — the flush
       must carry the new total NOW, not at the next minute mark */
    totalM += 5000;
    w.store.set('livemiles', milesVal(totalM, w.now()));
    const pauseT = w.now();
    w.store.set('tracker', { status: 'paused', sessionId: 222, startTs: t0 });
    await w.advance(4000);
    const after = w.pushesFor('livemiles', pauseT);
    ok('W2 the pause flushed telemetry immediately inside the gate window',
      after.length >= 1 && after[0].at - pauseT <= 3000 &&
      after[0].v.days['s1'].totalM === totalM,
      JSON.stringify(after.map(function (p) { return p.at - pauseT; })));
  }

  /* ================= W4: RECORD SAVE READS (loadDoc) ================= */
  {
    const w = settledWorld();
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await w.advance(5000);
    /* another store instance adds F_C to the cloud behind our back */
    w.cloudDocs = w.cloudDocs.map(function (d) {
      return d.id === 'fuel_fills' ? { id: d.id, v: [F_A, F_C], updatedAt: w.now() } : d;
    });
    const r0 = w.reads;
    w.store.set('fuel_fills', [F_A, F_B]); /* his save */
    await w.advance(4000);
    const delta = w.reads - r0;
    console.log('  [W4] Firestore reads spent by one record save: ' + delta +
      ' (pre-fix pattern: 36)');
    ok('W4 a record save reads only its own doc (<= 2 reads)', delta <= 2, 'got ' + delta);
    const pushed = (w.cloudDocs.find(function (d) { return d.id === 'fuel_fills'; }) || {}).v || [];
    eq('W4 the pushed union carries all three fills', pushed.length, 3);
    eq('W4 the local store learned the cloud-only fill at push time',
      (w.get('fuel_fills') || []).length, 3);
  }

  /* ================= W5: FALLBACK without loadDoc ================= */
  {
    const w = settledWorld({ noLoadDoc: true });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await w.advance(5000);
    w.cloudDocs = w.cloudDocs.map(function (d) {
      return d.id === 'fuel_fills' ? { id: d.id, v: [F_A, F_C], updatedAt: w.now() } : d;
    });
    w.store.set('fuel_fills', [F_A, F_B]);
    await w.advance(4000);
    const pushed = (w.cloudDocs.find(function (d) { return d.id === 'fuel_fills'; }) || {}).v || [];
    eq('W5 without loadDoc the fallback still lands the union', pushed.length, 3);
    eq('W5 the local store still learns the cloud-only fill',
      (w.get('fuel_fills') || []).length, 3);
  }

  /* ================= W6: TOMBSTONE INSIDE THE GATE ================= */
  {
    const w = settledWorld();
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await w.advance(5000);
    const t0 = w.now();
    w.store.set('tracker', { status: 'running', sessionId: 333, startTs: t0 });
    w.store.set('livemiles', milesVal(1370, t0));
    await w.advance(15000); /* first push lands; the gate is now shut */
    const delT = w.now();
    w.store.del('livemiles');
    await w.advance(4000);
    ok('W6 a telemetry tombstone deletes at once, gate or no gate',
      w.deletes.some(function (d) { return d.id === 'livemiles' && d.at - delT <= 3000; }),
      JSON.stringify(w.deletes));
  }

  console.log('\nspark-quota-v276: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e && e.stack || e); process.exit(2); });
