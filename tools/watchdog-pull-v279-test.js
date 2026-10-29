#!/usr/bin/env node
/* Meticulous — WATCHDOG-PULL-READ-BURN (v279, named in v276).
 * The 30 s watchdog kicks syncNow() whenever pushable dirty
 * keys exist — and on a live shift the telemetry engines keep
 * a key dirty almost all the time — and every syncNow ran a
 * FULL pull: FB.loadDocs over the whole kv collection (~36
 * docs). With MIN_PULL_GAP_MS at 60 s that is ~36 reads a
 * minute, ~21,600 reads per driver-day, against Spark's
 * 50,000 reads/day PROJECT-WIDE. The pull is the next quota
 * wall (v276's named-not-built item).
 *
 * FIX (js/cloudsync.js): the FIRST pull for a uid is never
 * gated (cold-start restore unchanged), but a REPEAT pull —
 * one whose only job is convergence with other devices —
 * waits REPEAT_PULL_GAP_MS (10 minutes) between full reads.
 * Pushes are NOT gated: syncNow still flushes on the
 * watchdog's 30 s cadence; the gap-skipped pull resolves at
 * once and the flush proceeds. Every merge law the pull
 * carries (record union + shadow, telemetry day-merge,
 * phantom guard, onboarding field merge) is untouched — it
 * simply runs at the convergence cadence instead of every
 * minute. A cloud-side change still lands; it lands within
 * the gap, not within the minute.
 *
 * Cases: P1 a simulated 10 h shift with telemetry dirty every
 * ~10 s spends a bounded number of pull reads (pre-fix
 * ~21,600; bound <= 2,600) · P2 the first pull still restores
 * a cloud session into an empty local store at once · P3 a
 * cloud-side record written mid-shift still converges after
 * the gap (delayed, never lost) · P4 pushes still flow while
 * pulls are gap-skipped (telemetry writes keep their v276
 * cadence inside the same shift).
 *
 * Run: node tools/watchdog-pull-v279-test.js
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
function drain() { return new Promise(function (r) { realSetTimeout(r, 0); }); }

/* fake-clock world — the v276 suite's world shape, trimmed */
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
    sb: sb, data: data, pushes: [], deletes: [], reads: 0, pullReads: 0,
    cloudDocs: opts.docs || [], stampSeq: 0,
    now: function () { return now; }
  };
  sb.FB = {
    ready: true,
    user: { uid: 'u1' },
    loadDocs: function () {
      world.reads += world.cloudDocs.length;
      world.pullReads += world.cloudDocs.length;
      return Promise.resolve(world.cloudDocs.map(function (d) {
        return { id: d.id, v: d.v, updatedAt: d.updatedAt };
      }));
    },
    loadDoc: function (col, id) {
      world.reads += 1;
      const d = world.cloudDocs.find(function (x) { return x.id === id; });
      return Promise.resolve(d ? { id: d.id, v: d.v, updatedAt: d.updatedAt } : null);
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

const DAY = '2026-10-28';
function milesVal(totalM, now) {
  const rec = { key: 's1', date: DAY, totalM: totalM, crumbs: [], hasFix: true, updatedAt: now };
  const out = { days: {} }; out.days['s1'] = rec; return out;
}
const F_A = { date: '2026-10-19', litres: 90.259, cost: 206.60, station: 'Petro-Canada', odo: 169531 };
const F_NEW = { date: '2026-10-28', time: '12:05', litres: 50.0, cost: 110.0, station: 'Mobil', odo: 170500 };

function settledWorld() {
  const keys = ['onboarding', 'tracker', 'sessions', 'fuel_fills', 'rev_entries', 'rev_extras',
    'pti_reports', 'dmg_reports', 'livemiles', 'geoloads', 'dsp_today', 'dsp_history',
    'inv_settings', 'prefs', 'odo_readings', 'mt_odo', 'reminders', 'pnl',
    'nav_places', 'subscription', 'feedback', 'dayarm', 'autostart', 'con_list',
    'con_hidden', 'con_outbox', 'pipe_landed', 'pipe_seen', 'nav_shares', 'cp_hist_peers',
    'tracker_settings', 'manifest_prefs', 'fuel_settings', 'pti_draft', 'dmg_draft', 'misc_notes'];
  const vals = {
    onboarding: { name: 'Driver One', accountType: 'driver' },
    tracker: { status: 'running', startTs: 1, elapsed: 0 },
    sessions: [], fuel_fills: [F_A], rev_entries: [], rev_extras: [],
    pti_reports: [], dmg_reports: [],
    livemiles: milesVal(0, 1000), geoloads: { days: {} }
  };
  const local = [], docs = [], metaKeys = {};
  keys.forEach(function (k) {
    const v = (k in vals) ? vals[k] : { seed: k };
    local.push([k, v]);
    docs.push({ id: k, v: JSON.parse(JSON.stringify(v)), updatedAt: 500 });
    metaKeys[k] = { t: 1000, s: 1000, u: 'u1' };
  });
  return makeWorld({
    local: local, docs: docs,
    meta: { uid: 'u1', keys: metaKeys }
  });
}

(async function () {
  /* P1 + P4: the shift — telemetry persists every ~10 s of
     fake time; the 30 s watchdog does the syncing. Count the
     PULL reads over 10 simulated hours. */
  {
    const w = settledWorld();
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await w.advance(1000);
    const HOUR = 3600 * 1000;
    for (let h = 0; h < 10; h++) {
      for (let s = 0; s < 360; s++) {
        w.store.set('livemiles', milesVal((h * 360 + s) * 400, w.now()));
        await w.advance(10000);
      }
    }
    console.log('  [P1] pull reads over a 10 h shift: ' + w.pullReads +
      ' (pre-fix ~21,600)');
    ok('P1 watchdog pull reads over a 10 h shift <= 2,600', w.pullReads <= 2600,
      'got ' + w.pullReads);
    const telePushes = w.pushes.filter(function (p) { return p.id === 'livemiles'; }).length;
    console.log('  [P4] livemiles pushes over the shift: ' + telePushes);
    ok('P4 telemetry pushes still flow while pulls are gapped (>= 400)', telePushes >= 400,
      'got ' + telePushes);
    const cloudMiles = (w.cloudDocs.find(function (d) { return d.id === 'livemiles'; }) || {}).v;
    ok('P4 the cloud ends the shift holding the day total',
      !!(cloudMiles && cloudMiles.days && cloudMiles.days['s1'] && cloudMiles.days['s1'].totalM > 1000000),
      JSON.stringify(cloudMiles && cloudMiles.days && cloudMiles.days['s1'] && cloudMiles.days['s1'].totalM));
  }

  /* P2: cold-start restore — empty local store, the cloud
     holds the day; the FIRST pull applies it at once. */
  {
    const cloudSession = [{ date: DAY, seconds: 7200, endedAt: 'x' }];
    const w = makeWorld({
      local: [],
      docs: [
        { id: 'sessions', v: cloudSession, updatedAt: 500 },
        { id: 'livemiles', v: milesVal(138500, 500), updatedAt: 500 },
        { id: 'onboarding', v: { name: 'Driver One', accountType: 'driver' }, updatedAt: 500 }
      ],
      meta: { uid: null, keys: {} }
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await w.advance(1000);
    eqSessions(w);
    function eqSessions(w2) {
      const got = w2.get('sessions');
      ok('P2 first pull restores the cloud session into an empty store',
        JSON.stringify(got) === JSON.stringify(cloudSession), 'got ' + JSON.stringify(got));
      const lm = w2.get('livemiles');
      ok('P2 first pull restores the cloud live-miles day (138.5 km)',
        !!(lm && lm.days && lm.days['s1'] && lm.days['s1'].totalM === 138500),
        'got ' + JSON.stringify(lm));
    }
  }

  /* P3: convergence delayed, never lost — a record written to
     the cloud by another device mid-shift lands locally once
     the repeat-pull gap passes. */
  {
    const w = settledWorld();
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await w.advance(1000);
    /* another device saves a fill straight to the cloud */
    const doc = w.cloudDocs.find(function (d) { return d.id === 'fuel_fills'; });
    doc.v = [F_A, F_NEW];
    doc.updatedAt = w.now() + 1000;
    await w.advance(11 * 60 * 1000);
    w.sb.CloudSync.syncNow();
    await w.advance(1000);
    const fills = w.get('fuel_fills') || [];
    ok('P3 a cloud-side fill converges locally after the gap',
      fills.some(function (f) { return f.station === 'Mobil'; }),
      'local fills: ' + JSON.stringify(fills.map(function (f) { return f.station; })));
  }

  console.log('\nwatchdog-pull-v279: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
