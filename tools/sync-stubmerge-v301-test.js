#!/usr/bin/env node
/* Meticulous — SYNC-STUB-MERGE + SYNC-RETRY-RESIDUAL +
 * SYNC-PUSH-TRIGGERS (web 301).
 *
 * Owner evidence, Sat Oct 31, 2026 (all MDT):
 *  - 16:44: on web 300 the live-miles push LANDS for the first
 *    time all week ("Last backup try: 4:44 PM — landed ✓",
 *    cloud diag "✓ All synced · 4:50 PM", "Trail kept in the
 *    backup copy: whole") — yet the cloud's Oct 31 manifest
 *    still reads the stale stub: Miles (live) 0.1 km, GPS
 *    distance 0.1 km, odometer "170,664 km → end not
 *    recorded", while his phone's day holds GPS 151.8 km and
 *    the true span 170,749 → 170,951.
 *  - 16:54 (second screen recording): the phone's dot is
 *    still RED; every Retry syncs ~7 s and falls back to
 *    "⚠️ Sync problem — your shift records hasn't backed
 *    up" — a NAMED failure stands while livemiles lands.
 *  - 16:58 (his own diagnosis): "But it only pushes once
 *    when I start the app.... Its not pushing live! And
 *    that the gap... Usually it needs to push when I am
 *    closing it! But no one knows when I am closing it!"
 *
 * The mechanism, proven in code (js/cloudsync.js,
 * modules/manifest.js):
 *  - The manifest does NOT read Miles (live) / GPS distance
 *    / the Odometer line from the livemiles doc's totals:
 *    they are the day's `sessions` entries (liveKm sum,
 *    start/end readings; the crumb chain is only the
 *    fallback when no session carries liveKm). The
 *    telemetry totals law (v224/v288, suite E7) guards a
 *    doc the manifest barely reads for these figures.
 *  - The phone's `sessions` push fails the record-list
 *    byte gate: entries carry startPhoto / endPhoto dash
 *    photos (data URLs, ~290 KB JPEGs in the field), and
 *    recordSyncCopy sheds photos ONLY for fuel_fills — so
 *    once the book crossed MAX_DOC_BYTES (900,000 chars)
 *    every sessions push failed honestly in rlSave ("the
 *    record list exceeds the cloud document size limit
 *    even without receipt photos") and stayed dirty. The
 *    only sessions writer that lands is a second, small,
 *    photo-less instance (the signed-in browser), whose
 *    book holds the Oct 31 fragment (stale tracker
 *    snapshot 170,664, liveKm 0.1, no end reading). The
 *    cloud therefore renders the stub while livemiles
 *    lands — and the standing failure's plain name is
 *    exactly "your shift records" (sessions), repainted
 *    on every Retry.
 *  - Push triggers: every store.set stamps dirty +
 *    scheduleFlush (2.5 s debounce); tracker pause/idle
 *    stamps arm the urgent flag (v276); hidden /
 *    beforeunload flush urgent; a 30 s watchdog kicks
 *    syncNow; telemetry is coalesce-gated to one push a
 *    minute (v276). Three field breaks: (1) NO first-pull
 *    gate — a boot-time debounced flush can push generic
 *    keys (blind {v:val} overwrites) BEFORE the first
 *    pull/restore settles; (2) the close's final engine
 *    snapshots can land AFTER the single-shot urgent flag
 *    was spent, and then sit behind the 60 s coalesce —
 *    in the field a watchdog push lands <60 s before
 *    almost every close, so the final totals wait for the
 *    next boot ("it only pushes once when I start the
 *    app"); (3) returning to the app (visibility visible)
 *    kicks nothing until the watchdog happens by.
 *
 *  A STUB-MERGE, two writers, one cloud: writer A (the
 *     browser) holds the Oct 31 fragment (newer stamps,
 *     0.1 km, stale odometer snapshot); writer B (the
 *     phone) holds the real day (older stamps, liveKm
 *     151.7, span 170,749 → 170,951, photo-bearing book).
 *     B pushes, A pushes, a fresh reader pulls — the
 *     manifest figures must be B's.
 *  B RESIDUAL: the photo book lands with facts intact
 *     (photos shed from the COPY only — they also live in
 *     the per-session cloud docs the stop writes); a
 *     same-identity session copy arbitrates by liveKm
 *     (the larger is strictly later knowledge), never by
 *     locality; a poisoned GENERIC key (nested arrays)
 *     lands cleaned through the write boundary.
 *  C TRIGGERS (manual clock): a close in stopSessionAt's
 *     own stamp order pushes the FINAL day state with no
 *     restart and no manual flush, even when a telemetry
 *     push landed seconds before the close; a boot push
 *     cannot precede the first pull's settle (slow-pull
 *     fixture); the live cadence pushes telemetry about
 *     once a minute while a shift runs.
 *  D SEAL: a landed push seals — the phone does not judge
 *     its own landed push incomplete (the 131 KB vs
 *     79 KB rulers never enter the seal math).
 *
 * Run: node tools/sync-stubmerge-v301-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const csSrc = fs.readFileSync(path.join(ROOT, 'js', 'cloudsync.js'), 'utf8');
const manSrc = fs.readFileSync(path.join(ROOT, 'modules', 'manifest.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* ---------- Firestore invalid-value rules (as v297) ---------- */
function findInvalid(v, p) {
  if (v === undefined) return 'Unsupported field value: undefined';
  const tv = typeof v;
  if (tv === 'function' || tv === 'symbol') return 'Unsupported field value: a function';
  if (tv === 'number') {
    if (Number.isNaN(v)) return 'Unsupported field value: NaN';
    if (!Number.isFinite(v)) return 'Unsupported field value: Infinity';
    return null;
  }
  if (v === null || tv === 'string' || tv === 'boolean') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return 'Unsupported field value: a custom Date object';
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (Array.isArray(v[i])) return 'Nested arrays are not supported';
      const r = findInvalid(v[i], p + '[' + i + ']');
      if (r) return r;
    }
    return null;
  }
  if (typeof v.toMillis === 'function') return null;
  const proto = Object.getPrototypeOf(v);
  if (!(proto === null || Object.getPrototypeOf(proto) === null)) return 'Unsupported field value: a custom object';
  for (const k in v) { const r = findInvalid(v[k], p ? p + '.' + k : k); if (r) return r; }
  return null;
}
function deepClean(v, inArr) {
  if (v === undefined) return false;
  const tv = typeof v;
  if (tv === 'function' || tv === 'symbol') return false;
  if (tv === 'number') return Number.isFinite(v);
  if (v === null || tv === 'string' || tv === 'boolean') return true;
  if (Object.prototype.toString.call(v) === '[object Date]') return false;
  if (Array.isArray(v)) {
    if (inArr) return false;
    for (let i = 0; i < v.length; i++) if (!deepClean(v[i], true)) return false;
    return true;
  }
  if (typeof v.toMillis === 'function') return false;
  const proto = Object.getPrototypeOf(v);
  if (!(proto === null || Object.getPrototypeOf(proto) === null)) return false;
  for (const k in v) if (!deepClean(v[k], false)) return false;
  return true;
}

/* ---------- the shared "Firestore" ---------- */
function makeServer(opts) {
  opts = opts || {};
  return {
    docs: {}, clock: 100000, rejected: [], writes: [],
    delayReadMs: opts.delayReadMs || 0, timers: null, pullDoneAt: null
  };
}
function serverSet(server, id, v, updatedAt) {
  server.docs[id] = { id: id, v: JSON.parse(JSON.stringify(v)), updatedAt: updatedAt || (++server.clock) };
}
function serverGet(server, id) {
  const d = server.docs[id];
  return d ? d.v : null;
}

/* ---------- a device world running the REAL cloudsync.js ----------
 * opts.timers: 'real' (default) or a manual clock object
 * { now, setTimeout, setInterval, clearTimeout, clearInterval, advance }
 * built by makeClock(). opts.DateNow: follow the manual clock. */
function makeClock() {
  const clock = { t: 0, seq: 1, timers: {} };
  clock.setTimeout = function (fn, ms) {
    const id = clock.seq++;
    clock.timers[id] = { fn: fn, at: clock.t + (ms || 0), every: 0 };
    return id;
  };
  clock.setInterval = function (fn, ms) {
    const id = clock.seq++;
    clock.timers[id] = { fn: fn, at: clock.t + (ms || 0), every: ms || 0 };
    return id;
  };
  clock.clearTimeout = function (id) { delete clock.timers[id]; };
  clock.clearInterval = function (id) { delete clock.timers[id]; };
  clock.advance = function (ms) {
    const end = clock.t + ms;
    for (;;) {
      let bestId = null, bestAt = Infinity;
      for (const id in clock.timers) {
        if (clock.timers[id].at <= end && clock.timers[id].at < bestAt) { bestAt = clock.timers[id].at; bestId = id; }
      }
      if (bestId === null) break;
      const tm = clock.timers[bestId];
      clock.t = tm.at;
      if (tm.every) tm.at = clock.t + tm.every; else delete clock.timers[bestId];
      tm.fn();
    }
    clock.t = end;
  };
  return clock;
}
function makeWorld(server, opts) {
  opts = opts || {};
  const data = {};
  const localStorage = {
    getItem: function (k) { return (k in data) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    removeItem: function (k) { delete data[k]; },
    key: function (i) { return Object.keys(data)[i] || null; },
    get length() { return Object.keys(data).length; }
  };
  (opts.local || []).forEach(function (kv) { data['mt_' + kv[0]] = JSON.stringify(kv[1]); });
  (opts.rawLocal || []).forEach(function (kv) { data[kv[0]] = kv[1]; });
  if (opts.meta) data['mt___syncmeta'] = JSON.stringify(opts.meta);
  const elements = {};
  function makeEl(id) {
    const el = { id: id, textContent: '', _hidden: id === 'syncWarn',
      classList: { toggle: function (cls, force) { if (cls === 'hidden') el._hidden = !!force; } } };
    return el;
  }
  elements.syncWarn = makeEl('syncWarn');
  const clock = opts.clock || null;
  const sb = { console: console, Promise: Promise };
  if (clock) {
    sb.setTimeout = clock.setTimeout; sb.clearTimeout = clock.clearTimeout;
    sb.setInterval = clock.setInterval; sb.clearInterval = clock.clearInterval;
    const RealDate = Date;
    const FakeDate = function () {
      const a = Array.prototype.slice.call(arguments);
      return a.length ? new RealDate(a[0], a[1], a[2], a[3], a[4], a[5], a[6]) : new RealDate(clock.t0 + clock.t);
    };
    FakeDate.now = function () { return clock.t0 + clock.t; };
    FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC;
    sb.Date = FakeDate;
  } else {
    sb.setTimeout = setTimeout; sb.clearTimeout = clearTimeout;
    sb.setInterval = setInterval; sb.clearInterval = clearInterval;
  }
  sb.window = sb;
  sb.localStorage = localStorage;
  sb.navigator = { onLine: true };
  sb.document = {
    getElementById: function (id) { return elements[id] || null; },
    addEventListener: function () {}
  };
  sb.addEventListener = function () {};
  function docShape(id, v, updatedAt) {
    return { id: id, v: v, updatedAt: { toMillis: function () { return updatedAt; }, seconds: Math.floor(updatedAt / 1000) } };
  }
  function readDelay() {
    if (!server.delayReadMs) return Promise.resolve();
    const st = clock ? clock.setTimeout : setTimeout;
    return new Promise(function (res) { st(res, server.delayReadMs); });
  }
  sb.FB = {
    ready: true,
    user: { uid: 'u1' },
    loadDocs: function () {
      return readDelay().then(function () {
        if (clock) server.pullDoneAt = clock.t0 + clock.t;
        return Object.keys(server.docs).map(function (id) {
          const d = server.docs[id];
          return docShape(id, JSON.parse(JSON.stringify(d.v)), d.updatedAt);
        });
      });
    },
    loadDoc: function (col, id) {
      const d = server.docs[id];
      return Promise.resolve(d ? docShape(id, JSON.parse(JSON.stringify(d.v)), d.updatedAt) : null);
    },
    saveDoc: function (col, id, doc) {
      const bad = findInvalid(doc.v, '');
      if (bad) {
        server.rejected.push({ id: id, why: bad });
        return Promise.reject(new Error('Function DocumentReference.set() called with invalid data. ' + bad +
          ' (found in document users/u1/kv/' + id + ')'));
      }
      server.writes.push({ id: id, at: clock ? (clock.t0 + clock.t) : Date.now() });
      serverSet(server, id, doc.v);
      return Promise.resolve(undefined);
    },
    deleteDoc: function (col, id) { delete server.docs[id]; return Promise.resolve(undefined); }
  };
  vm.createContext(sb);
  vm.runInContext(csSrc, sb);
  const store = {
    get: function (k, d) { const r = localStorage.getItem('mt_' + k); return r === null ? d : JSON.parse(r); },
    set: function (k, v) { localStorage.setItem('mt_' + k, JSON.stringify(v)); return true; },
    del: function (k) { localStorage.removeItem('mt_' + k); return true; }
  };
  sb.CloudSync.attach(store);
  const world = { sb: sb, data: data, server: server, store: store, elements: elements };
  world.get = function (k) { const r = localStorage.getItem('mt_' + k); return r === null ? null : JSON.parse(r); };
  world.meta = function () { return JSON.parse(data['mt___syncmeta'] || '{"keys":{}}'); };
  return world;
}
function settle(ms) { return new Promise(function (r) { setTimeout(r, ms || 600); }); }
/* flush microtask chains after a manual-clock advance */
function drain() { return new Promise(function (r) { setImmediate(r); }); }
async function pump(n) { for (let i = 0; i < (n || 12); i++) await drain(); }
/* manual-clock worlds: advance in small steps with microtask
 * drains between, so promise chains that schedule 0 ms yields
 * (the telemetry push path) progress inside the window instead
 * of stalling past their own timeout races */
async function tick(clock, ms) {
  let left = ms;
  while (left > 0) {
    const step = Math.min(250, left);
    clock.advance(step);
    await pump(4);
    left -= step;
  }
  await pump(10);
}

/* ---------- the manifest world (v299 pattern) ---------- */
function extract(file, beginMark, endMark) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found in ' + file);
  return src.slice(a, b + 2);
}
const msb = {};
vm.createContext(msb);
vm.runInContext(extract('js/miles.js', 'MILES-ENGINE-BEGIN', 'MILES-ENGINE-END'), msb);
const ENGINE = msb.ENGINE;
function makeManifest(mem) {
  const store = {
    get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
    set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    del: function (k) { delete mem[k]; return true; }
  };
  const sandbox = {
    console: console, setTimeout: setTimeout, Promise: Promise,
    App: {
      _store: store,
      _esc: function (s) { return String(s == null ? '' : s); },
      _today: function () { return mem.mani_date; },
      tracker: mem.tracker, userRole: function () { return 'both'; }
    },
    LiveMiles: { reportLines: ENGINE.reportLines, _engine: ENGINE },
    Meticulous: { modules: { navigation: { builtinPlaces: function () { return []; } } } }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(manSrc, sandbox, { filename: 'modules/manifest.js' });
  return sandbox.Meticulous.modules.manifest;
}

/* ---------- fixtures: his Oct 31, shaped ---------- */
const DAY = '2026-10-31';
const T_OLD = Date.parse('2026-10-31T06:54:00.000Z');   // the phone's stamps: older
const T_NEW = Date.parse('2026-10-31T15:54:00.000Z');   // the browser's stamps: newer
const PHOTO = 'data:image/jpeg;base64,' + 'A'.repeat(280000);
/* the browser-born fragment: a young tracker snapshot —
 * stale odometer (Oct 30's pre-trip), 0.1 km, no end reading */
const FRAGMENT = { date: DAY, seconds: 240, endedAt: '2026-10-31T13:12:00.000Z',
  startOdo: 170664, liveKm: 0.1 };
/* the phone's real Oct 31 session entry, as stopSessionAt
 * writes it (photos riding on the entry) */
const REAL = { date: DAY, seconds: 26520, endedAt: '2026-10-31T20:16:00.000Z',
  startOdo: 170749, endOdo: 170951, liveKm: 151.7, milesKey: 'sB',
  startPhoto: PHOTO, endPhoto: PHOTO };
function phoneSessions() {
  const out = [JSON.parse(JSON.stringify(REAL))];
  /* two earlier photo-bearing days + plain older days: the
   * working book that crossed the byte gate in the field */
  const mk = function (date, secs, ended, so, eo, km, photos) {
    const e = { date: date, seconds: secs, endedAt: ended, startOdo: so, endOdo: eo, liveKm: km };
    if (photos) { e.startPhoto = PHOTO; e.endPhoto = PHOTO; }
    return e;
  };
  out.push(mk('2026-10-30', 32400, '2026-10-30T23:23:00.000Z', 170664, 170749, 84.6, true));
  out.push(mk('2026-10-29', 37800, '2026-10-30T01:00:00.000Z', 170262, 170632, 104.5, true));
  out.push(mk('2026-10-28', 18000, '2026-10-28T18:14:00.000Z', 170262, 170337, 32.2, false));
  out.push(mk('2026-10-26', 39600, '2026-10-27T00:26:00.000Z', 170149, 170261, 70.6, false));
  out.push(mk('2026-10-22', 35500, '2026-10-23T01:17:00.000Z', 169888, 170117, 11.0, false));
  return out;
}
function crumbTrail(t0, n, stepMs) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(t0 + i * stepMs);
    out.push({ t: d.getTime(), a: 51.157 + i * 0.0009, o: -113.939 - i * 0.0011 });
  }
  return out;
}
function phoneLivemiles() {
  const t0 = new Date(2026, 9, 31, 6, 54).getTime(); // local Oct 31 06:54
  return { days: { sB: {
    key: 'sB', date: DAY, totalM: 151800, hasFix: true,
    anchor: { time: t0 + 26520000, latitude: 51.157, longitude: -113.939 },
    crumbs: crumbTrail(t0, 265, 100000),
    segs: [{ f: t0, t: t0 + 26520000 }],
    joinFrom: { time: t0, latitude: 51.157, longitude: -113.939 },
    updatedAt: T_OLD
  } } };
}
function browserLivemiles() {
  const t0 = new Date(2026, 9, 31, 8, 0).getTime();
  return { days: { sA: {
    key: 'sA', date: DAY, totalM: 100, hasFix: true,
    anchor: { time: t0 + 240000, latitude: 51.157, longitude: -113.939 },
    crumbs: crumbTrail(t0, 3, 60000), segs: [],
    joinFrom: null, updatedAt: T_NEW
  } } };
}
function phoneGeoloads() {
  return { days: { '2026-10-31': { count: 3, corr: 0, updatedAt: T_OLD,
    events: [], pegEvents: [
      { kind: 'load', t: T_OLD + 7800000, lat: 50.95595, lng: -114.02548 },
      { kind: 'dump', t: T_OLD + 9660000, lat: 51.01965, lng: -114.00539 }
    ], pegs: {} } } };
}
const META_DIRTY = function (keys) {
  const ks = {};
  keys.forEach(function (k) { ks[k] = { t: 6000, s: 5000, u: 'u1' }; });
  return { uid: 'u1', globallySynced: true, teleTp: { livemiles: 1, geoloads: 1 }, keys: ks };
};

(async function () {

  /* ================= A. STUB-MERGE: two writers ================= */
  console.log('— A. STUB-MERGE: the phone’s real day vs the browser’s stub —');
  {
    const server = makeServer();
    /* writer B — the phone */
    const B = makeWorld(server, {
      local: [['sessions', phoneSessions()], ['livemiles', phoneLivemiles()], ['geoloads', phoneGeoloads()]],
      meta: META_DIRTY(['sessions', 'livemiles', 'geoloads'])
    });
    B.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(2200);
    await B.sb.CloudSync.flush(); await settle(700);
    await B.sb.CloudSync.flush(); await settle(700); // a second cycle: failures paint at n>=2
    const cloudSessions = serverGet(server, 'sessions');
    ok('A1: the phone’s sessions book LANDS (photo-bearing book and all)',
      Array.isArray(cloudSessions) && cloudSessions.length >= 6,
      cloudSessions ? cloudSessions.length + ' records' : 'no cloud doc');
    const cloudReal = (cloudSessions || []).filter(function (r) { return r && r.date === DAY && r.seconds === 26520; })[0];
    ok('A2: the real Oct 31 entry lands with its facts (liveKm, both readings)',
      !!cloudReal && cloudReal.liveKm === 151.7 && cloudReal.startOdo === 170749 && cloudReal.endOdo === 170951,
      cloudReal && JSON.stringify({ km: cloudReal.liveKm, so: cloudReal.startOdo, eo: cloudReal.endOdo }));
    ok('A3: the cloud copy sheds the dash photos (they live in the per-session docs)',
      !!cloudReal && !cloudReal.startPhoto && !cloudReal.endPhoto);
    const bLocalReal = (B.get('sessions') || []).filter(function (r) { return r && r.date === DAY && r.seconds === 26520; })[0];
    ok('A4: the phone’s LOCAL entry keeps its photos (the copy is shed, not the store)',
      !!bLocalReal && !!bLocalReal.startPhoto && !!bLocalReal.endPhoto);
    const bst = B.sb.CloudSync.status();
    ok('A5: no standing failure on the phone after its pushes (the residual clears)',
      bst.failPlain === null && bst.state !== 'err', 'failPlain=' + bst.failPlain + ' state=' + bst.state);
    const cloudLm = serverGet(server, 'livemiles');
    ok('A6: the phone’s livemiles lands (151.8 km day)',
      !!cloudLm && cloudLm.days && cloudLm.days.sB && cloudLm.days.sB.totalM === 151800);

    /* writer A — the browser, arriving after, stamps newer */
    const A = makeWorld(server, {
      local: [['sessions', [JSON.parse(JSON.stringify(FRAGMENT))]], ['livemiles', browserLivemiles()]],
      meta: META_DIRTY(['sessions', 'livemiles'])
    });
    A.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(2200);
    await A.sb.CloudSync.flush(); await settle(700);
    const after = serverGet(server, 'sessions');
    const stillReal = (after || []).filter(function (r) { return r && r.date === DAY && r.seconds === 26520; })[0];
    ok('A7: after the stub writer pushes, the real entry SURVIVES in the cloud union',
      !!stillReal && stillReal.liveKm === 151.7);
    const fragKept = (after || []).filter(function (r) { return r && r.date === DAY && r.seconds === 240; })[0];
    ok('A8: the fragment is kept too (union — the manifest, not the sync, weighs it)',
      !!fragKept);

    /* a fresh reader pulls and renders the day */
    const C = makeWorld(server, { meta: { uid: 'u1', keys: {} } });
    C.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(2200);
    const mem = {
      mani_date: DAY,
      onboarding: { payStandard: 'Hourly', payRate: 29, ownWageRate: 29, travelBonus: 1 },
      nav_data: { personal: [], work: [] },
      dsp_list: [], nav_log: [], fuel_fills: [], fuel_expenses: [], dmg_reports: [],
      rev_entries: [], rev_extras: [], odo_readings: [], pti_reports: [],
      tracker: { status: 'idle', startTs: 0, elapsed: 0 },
      sessions: C.get('sessions') || [],
      livemiles: C.get('livemiles') || { days: {} },
      geoloads: C.get('geoloads') || { days: {} }
    };
    const M = makeManifest(mem);
    const c = M._collectDay(DAY);
    eq('A9: Miles (live) is the phone’s day — 151.8 km, not the 0.1 km stub',
      Math.round((c.liveKm || 0) * 10) / 10, 151.8);
    eq('A10: the odometer span is the day’s own — 170,749', c.odoStart, 170749);
    eq('A11: the odometer span closes — 170,951', c.odoEnd, 170951);
    ok('A12: GPS distance follows the same truth', !!c.routeInfo && Math.abs(c.routeInfo.km - 151.8) < 0.05,
      c.routeInfo && c.routeInfo.km);
    eq('A13: loads are the phone’s count of record', c.loads, 3);
  }

  /* ================= B. RESIDUAL: arbitration + the generic door ================= */
  console.log('— B. RESIDUAL: same-session arbitration + the generic write door —');
  {
    /* B1: a same-identity copy with a YOUNG liveKm must never
     * outrank the real entry — on EITHER device. Field sets are
     * identical (a completeness tie), so only the liveKm law
     * can decide. */
    const young = { date: DAY, seconds: 26520, endedAt: '2026-10-31T20:16:00.000Z',
      startOdo: 170749, endOdo: 170951, liveKm: 0.1, milesKey: 'sB' };
    const full = { date: DAY, seconds: 26520, endedAt: '2026-10-31T20:16:00.000Z',
      startOdo: 170749, endOdo: 170951, liveKm: 151.7, milesKey: 'sB' };
    {
      const server = makeServer();
      serverSet(server, 'sessions', [JSON.parse(JSON.stringify(full))], 5000);
      const w = makeWorld(server, {
        local: [['sessions', [JSON.parse(JSON.stringify(young))]]],
        meta: META_DIRTY(['sessions'])
      });
      w.sb.CloudSync.onAuth({ uid: 'u1' });
      await settle(2200);
      const got = (w.get('sessions') || [])[0];
      ok('B1a: a device holding the young copy LEARNS the real one on pull',
        !!got && got.liveKm === 151.7, got && got.liveKm);
    }
    {
      const server = makeServer();
      serverSet(server, 'sessions', [JSON.parse(JSON.stringify(young))], 5000);
      const w = makeWorld(server, {
        local: [['sessions', [JSON.parse(JSON.stringify(full))]]],
        meta: META_DIRTY(['sessions'])
      });
      w.sb.CloudSync.onAuth({ uid: 'u1' });
      await settle(2200);
      const got = (w.get('sessions') || [])[0];
      ok('B1b: the device holding the real entry KEEPS it against the young cloud copy',
        !!got && got.liveKm === 151.7, got && got.liveKm);
      await w.sb.CloudSync.flush(); await settle(700);
      const pushed = (serverGet(server, 'sessions') || [])[0];
      ok('B1c: and its push heals the cloud copy upward',
        !!pushed && pushed.liveKm === 151.7, pushed && pushed.liveKm);
    }
    /* B2: the generic write door — a key no special branch
     * claims, carrying a nested array, must land cleaned
     * instead of standing as a named failure forever. */
    {
      const server = makeServer();
      const w = makeWorld(server, {
        local: [['zz_probe', { spans: [[1, 2], [3, 4]], note: 'probe' }]],
        meta: META_DIRTY(['zz_probe'])
      });
      w.sb.CloudSync.onAuth({ uid: 'u1' });
      await settle(2200);
      await w.sb.CloudSync.flush(); await settle(700);
      const doc = serverGet(server, 'zz_probe');
      ok('B2a: a poisoned generic key LANDS (sanitized at the write boundary)',
        !!doc && doc.note === 'probe', doc && JSON.stringify(doc));
      ok('B2b: the written value is deep-clean (nothing the store refuses)',
        !!doc && deepClean(doc, false));
      const km = (w.meta().keys || {}).zz_probe || {};
      ok('B2c: the key seals', !(km.s < km.t), JSON.stringify(km));
    }
  }

  /* ================= C. TRIGGERS (manual clock) ================= */
  console.log('— C. TRIGGERS: close pushes, boot order, live cadence —');
  {
    /* C1: the boot push cannot precede restore. The cloud
     * pull is SLOW (4 s) and the boot debounce is 2.5 s: on
     * unguarded code the debounced flush writes the young
     * pre-restore values first. */
    const clock = makeClock();
    clock.t0 = Date.parse('2026-11-02T13:00:00.000Z');
    const server = makeServer({ delayReadMs: 4000 });
    serverSet(server, 'onboarding', { companyName: 'Ai Trucking', payRate: 29 }, 5000);
    server.timers = true;
    const w = makeWorld(server, {
      clock: clock,
      local: [],
      meta: { uid: 'u1', teleTp: {}, keys: {} }
    });
    server.delayReadMs = 4000;
    /* boot-time write, exactly what an engine persist / state
     * rebuild does in the first seconds: a young, sparse
     * record (unset fields are ABSENT in this app, not 0) */
    w.store.set('onboarding', { accountType: 'Driver', companyName: '' });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await tick(clock, 2600);                    // the debounce fires at 2.5 s
    const writesBeforePull = server.writes.filter(function (wr) {
      return server.pullDoneAt === null || wr.at < server.pullDoneAt;
    });
    eq('C1a: NO push lands before the first pull settles', writesBeforePull.length, 0);
    await tick(clock, 5500);                    // pull settles (~4 s), gated flush follows
    const ob = serverGet(server, 'onboarding');
    ok('C1b: after restore, the cloud keeps the restored profile (never stomped by boot defaults)',
      !!ob && ob.companyName === 'Ai Trucking' && ob.payRate === 29,
      ob && JSON.stringify(ob));
    const localOb = w.get('onboarding');
    ok('C1c: and the device adopted the restored profile',
      !!localOb && localOb.companyName === 'Ai Trucking', localOb && JSON.stringify(localOb));
  }
  {
    /* C2: a close in stopSessionAt's own stamp order — the
     * engines' final snapshot, the session save, the tracker
     * idle stamp — pushes the FINAL day state on the debounce
     * alone, even though a telemetry push landed SECONDS
     * before the close (the field's common case: the 60 s
     * coalesce would otherwise hold the final totals until
     * the next boot). */
    const clock = makeClock();
    clock.t0 = Date.parse('2026-11-02T20:00:00.000Z');
    const server = makeServer();
    const t0 = clock.t0;
    const lmRun = { days: { sB: { key: 'sB', date: DAY, totalM: 50000, hasFix: true,
      anchor: { time: t0, latitude: 51.1, longitude: -114 }, crumbs: [], segs: [], joinFrom: null, updatedAt: t0 } } };
    const lmFinal = JSON.parse(JSON.stringify(lmRun));
    lmFinal.days.sB.totalM = 151800;
    const w = makeWorld(server, {
      clock: clock,
      local: [['tracker', { status: 'running', sessionId: 7, startTs: t0 - 26520000 }],
        ['livemiles', lmRun], ['sessions', []], ['geoloads', { days: {} }]],
      meta: { uid: 'u1', teleTp: { livemiles: t0 - 1000, geoloads: t0 - 1000 },
        keys: { tracker: { t: t0 - 1000, s: t0 - 1000, u: 'u1' } } }
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await tick(clock, 1600);                     // pull + boot flush settle (the close comes later in the day, not the same instant)
    /* stopSessionAt's order (js/app.js 2889 → 2995): engines
     * finalize, the session lands, the tracker goes idle */
    w.store.set('livemiles', lmFinal);
    w.store.set('sessions', [{ date: DAY, seconds: 26520, endedAt: '2026-10-31T20:16:00.000Z',
      startOdo: 170749, endOdo: 170951, liveKm: 151.7, milesKey: 'sB' }]);
    w.store.set('tracker', { status: 'idle', startTs: 0, elapsed: 0 });
    await tick(clock, 3100);                     // the debounce flush
    const lmDoc = serverGet(server, 'livemiles');
    ok('C2a: the close pushes the FINAL totals on the debounce — no restart, no Retry',
      !!lmDoc && lmDoc.days && lmDoc.days.sB && lmDoc.days.sB.totalM === 151800,
      lmDoc && lmDoc.days && lmDoc.days.sB && lmDoc.days.sB.totalM);
    const ssDoc = serverGet(server, 'sessions');
    if (process.env.C2DEBUG) {
      console.log('    [dbg] docs:', Object.keys(server.docs).join(','));
      console.log('    [dbg] sessions doc:', JSON.stringify(ssDoc));
      console.log('    [dbg] meta:', JSON.stringify(w.meta().keys));
      console.log('    [dbg] status:', JSON.stringify(w.sb.CloudSync.status()));
    }
    ok('C2b: the closed session record lands in the same push',
      Array.isArray(ssDoc) && ssDoc.length === 1 && ssDoc[0].liveKm === 151.7);
    /* the post-close leg: the engine keeps accruing the drive
     * home after the close (v279) and stamps again while the
     * tracker is already idle. v301 let that stamp ride out
     * on the debounce like the close itself; v413
     * (SYNC-FLAPPING-NOV11) narrowed it: the same
     * telemetry-stamp-while-idle urgency fired on EVERY
     * day-watch persist all night and stormed the backup
     * (see tools/sync-flap-v413-test.js). The close itself
     * still rides the debounce (C2a — the tracker transition
     * stamp carries it); a later accrual stamp rides the
     * 60 s coalesce instead — out within the minute, and a
     * page hide would flush it urgently — never the next
     * boot. */
    const lmHome = JSON.parse(JSON.stringify(lmFinal));
    lmHome.days.sB.totalM = 175000;
    w.store.set('livemiles', lmHome);
    await tick(clock, 3100);
    const lmDoc2 = serverGet(server, 'livemiles');
    ok('C2c: the post-close accrual no longer rides the debounce (v413 anti-storm law)',
      !!lmDoc2 && lmDoc2.days && lmDoc2.days.sB && lmDoc2.days.sB.totalM === 151800,
      lmDoc2 && lmDoc2.days && lmDoc2.days.sB && lmDoc2.days.sB.totalM);
    await tick(clock, 85000);                    // the coalesce window passes; the next watchdog carries it
    const lmDoc3 = serverGet(server, 'livemiles');
    ok('C2d: the post-close accrual lands by the coalesce — inside the minute, not the next boot',
      !!lmDoc3 && lmDoc3.days && lmDoc3.days.sB && lmDoc3.days.sB.totalM === 175000,
      lmDoc3 && lmDoc3.days && lmDoc3.days.sB && lmDoc3.days.sB.totalM);
  }
  {
    /* C3: the live cadence — while a shift runs, telemetry
     * reaches the cloud about once a minute (the watchdog
     * kicks, the coalesce spaces the writes, battery law
     * untouched). */
    const clock = makeClock();
    clock.t0 = Date.parse('2026-11-02T14:00:00.000Z');
    const server = makeServer();
    const t0 = clock.t0;
    const mk = function (m) { return { days: { sB: { key: 'sB', date: DAY, totalM: m, hasFix: true,
      anchor: { time: t0, latitude: 51.1, longitude: -114 }, crumbs: [], segs: [], joinFrom: null, updatedAt: t0 } } }; };
    serverSet(server, 'livemiles', mk(40000), 4000);
    const w = makeWorld(server, {
      clock: clock,
      local: [['tracker', { status: 'running', sessionId: 9, startTs: t0 }],
        ['livemiles', mk(50000)], ['geoloads', { days: {} }]],
      meta: { uid: 'u1', teleTp: { livemiles: 1, geoloads: 1 },
        keys: { livemiles: { t: t0 + 1000, s: 4000, u: 'u1' }, tracker: { t: t0, s: t0, u: 'u1' } } }
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await tick(clock, 31000);                    // boot push + watchdog tick at 30 s
    let lmDoc = serverGet(server, 'livemiles');
    ok('C3a: within the first watchdog minute the live total reaches the cloud',
      !!lmDoc && lmDoc.days.sB.totalM === 50000, lmDoc && lmDoc.days.sB.totalM);
    w.store.set('livemiles', mk(60000));
    await tick(clock, 31000);                    // ~31 s after the last push: coalesce holds
    lmDoc = serverGet(server, 'livemiles');
    ok('C3b: the coalesce still spaces writes (no write 31 s after the last)',
      !!lmDoc && lmDoc.days.sB.totalM === 50000, lmDoc && lmDoc.days.sB.totalM);
    await tick(clock, 31000);                    // ~62 s: the next watchdog push lands it
    lmDoc = serverGet(server, 'livemiles');
    ok('C3c: by the next minute the newer total is up',
      !!lmDoc && lmDoc.days.sB.totalM === 60000, lmDoc && lmDoc.days.sB.totalM);
  }

  /* ================= D. SEAL ================= */
  console.log('— D. SEAL: a landed push is final —');
  {
    const server = makeServer();
    const nowR = Date.now();
    const metaD = { uid: 'u1', globallySynced: true, teleTp: { livemiles: 1, geoloads: 1 }, keys: {
      livemiles: { t: nowR - 1000, s: nowR - 2000, u: 'u1' },
      geoloads: { t: nowR - 1000, s: nowR - 2000, u: 'u1' } } };
    const w = makeWorld(server, {
      local: [['livemiles', phoneLivemiles()], ['geoloads', phoneGeoloads()]],
      meta: metaD
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(2200);
    await w.sb.CloudSync.flushUrgent(); await settle(700);
    const km = (w.meta().keys || {}).livemiles || {};
    ok('D1: the telemetry push seals (no longer dirty after pull-back)', !(km.s < km.t), JSON.stringify(km));
    const stamp = server.docs['livemiles'].updatedAt;
    await w.sb.CloudSync.flush(); await settle(700);
    ok('D2: a second flush writes nothing (the seal holds)',
      server.docs['livemiles'].updatedAt === stamp);
  }

  console.log('\nsync-stubmerge-v301: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
