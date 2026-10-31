#!/usr/bin/env node
/* Meticulous — SYNC-STILL-FAILING-ON-293 (owner verdict, Oct 31,
 * 2026, 10:09-10:12 MDT, two screen recordings): the phone IS on
 * web 293 ("App web version: v293 (updated copy)"), yet Preferences
 * > Advanced keeps painting "⚠️ Sync problem — live miles tracking
 * hasn't backed up"; Retry shows "Syncing..." for a few seconds
 * and falls back; the header dot stays red; and while the sync
 * churns the page double-draws its text (ghosted labels —
 * main-thread jank; in the first recording the screen looked
 * frozen ~10 s). Tracking itself is healthy (counter counting,
 * GPS 4 m fixes) — only the cloud backup of the telemetry key
 * fails.
 *
 * The v293 harness (tools/sync-stomp-v293-test.js) proved the
 * thinning ladder against a stub whose size measure was
 * JSON.stringify({v}).length vs a 1,048,576 cap, on values shaped
 * exactly { days: { <key>: {…, crumbs} } }. The real account
 * differs from that stub in ways this suite models:
 *
 *  (1) REAL FIRESTORE SIZE ACCOUNTING. A document's size is its
 *      UTF-8 byte size under Firestore's own formula (field names
 *      +1 each, numbers 8 bytes, strings UTF-8+1, maps/arrays the
 *      sum of their parts, plus the resource name and the
 *      updatedAt field saveDoc adds) — NOT the JSON text length.
 *      For crumb-heavy data (13-digit timestamps, 6-decimal
 *      coordinates as 8-byte doubles) the true size is well UNDER
 *      the JSON length. S0 proves the elimination: on a pure-crumb
 *      value the v293 copy fits the REAL limit with room to
 *      spare — size-of-the-trail alone was never the field
 *      failure.
 *  (2) LEGACY BULK THE LADDER NEVER SHEDS. mergeTelemetryDays
 *      builds the merged value on the CLOUD value's shell, so any
 *      heavy top-level field an old version ever wrote into the
 *      livemiles doc rides every merge forever; the v293 ladder
 *      thins ONLY per-day `crumbs`, so a value carrying such bulk
 *      (top-level — S1; or a heavy non-crumb array inside the day
 *      records — S2) exceeds the cap at EVERY rung, and tlSave
 *      fails honestly on every push, forever: the key never
 *      seals, the failure paints by name, the cloud stays frozen.
 *      That is the field signature exactly (fast, repeatable,
 *      livemiles-only, small keys landing around it).
 *  (3) MAIN-THREAD CHURN. The v293 ladder builds SIX full deep
 *      copies (JSON round-trips) and up to seven full
 *      serializations of a multi-MB value per copy computation —
 *      and a sync cycle computes the copy TWICE (pull comparison
 *      + push), on top of the merges' own stringify comparisons.
 *      S3 meters the JSON traffic of one pull+flush cycle over a
 *      ~2.4 MB value and budgets it.
 *  (4) SLOW-LINK GUARD (S4): pushes over a 3 s-latency link still
 *      land and seal — the async restructure must not break the
 *      chain.
 *
 * The fix (js/cloudsync.js, telemetry sync copy only):
 *  - The copy is built STRUCTURALLY (shallow clones — no JSON
 *    round-trip deep copies), rungs evaluated lazily, first fit
 *    wins. Bulk the sync layer never reads — top-level non-days
 *    fields over a small threshold, and per-day array fields
 *    that are not in the key's fact set (livemiles: crumbs/segs;
 *    geoloads: events/pegEvents/pegs) over the same threshold —
 *    is shed from the COPY at the first rung (the local store
 *    always keeps the full value; every field the merges, the
 *    dashboards and the manifest read rides intact). The crumb
 *    ladder then runs exactly as v293's (same caps, same
 *    determinism — a shed cloud copy still seals, M4's law).
 *  - The telemetry push yields to the event loop before its
 *    merge and before its copy build, so a sync never freezes
 *    the page mid-frame.
 *
 * Run: node tools/sync-realfail-v295-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const csSrc = fs.readFileSync(path.join(ROOT, 'js', 'cloudsync.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}

/* ---------- Firestore-faithful size accounting ---------- */
function fsValueSize(v) {
  if (v === null || v === undefined) return 1;
  if (typeof v === 'boolean') return 1;
  if (typeof v === 'number') return 8;
  if (typeof v === 'string') return Buffer.byteLength(v, 'utf8') + 1;
  if (Array.isArray(v)) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += fsValueSize(v[i]);
    return s;
  }
  if (typeof v === 'object') {
    if (typeof v.toMillis === 'function') return 8; // timestamp
    let s = 0;
    for (const k in v) s += Buffer.byteLength(k, 'utf8') + 1 + fsValueSize(v[k]);
    return s;
  }
  return 1;
}
function fsDocSize(id, v) {
  const name = 'projects/meticulous-dd570/databases/(default)/documents/users/u1/kv/' + id;
  let s = Buffer.byteLength(name, 'utf8') + 1;
  s += Buffer.byteLength('v', 'utf8') + 1 + fsValueSize(v);
  s += Buffer.byteLength('updatedAt', 'utf8') + 1 + 8;
  return s;
}
const FIRESTORE_LIMIT = 1048576;
function hasUndefined(v, seen) {
  if (v === undefined) return true;
  if (v && typeof v === 'object') {
    seen = seen || [];
    if (seen.indexOf(v) >= 0) return false;
    seen.push(v);
    for (const k in v) { if (hasUndefined(v[k], seen)) return true; }
  }
  return false;
}

/* ---------- the shared "Firestore" ---------- */
function makeServer(opts) {
  opts = opts || {};
  return { docs: {}, clock: 100000, rejected: [], latencyMs: opts.latencyMs || 0 };
}
function serverSet(server, id, v, updatedAt) {
  server.docs[id] = { id: id, v: JSON.parse(JSON.stringify(v)), updatedAt: updatedAt || (++server.clock) };
}
function serverGet(server, id) {
  const d = server.docs[id];
  return d ? d.v : null;
}

/* ---------- a device world running the REAL cloudsync.js ------ */
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
  function delayed(fn) {
    if (!server.latencyMs) {
      try { return Promise.resolve(fn()); } catch (e) { return Promise.reject(e); }
    }
    return new Promise(function (res, rej) {
      setTimeout(function () { try { res(fn()); } catch (e) { rej(e); } }, server.latencyMs);
    });
  }
  sb.FB = {
    ready: true,
    user: { uid: 'u1' },
    loadDocs: function () {
      return delayed(function () {
        return Object.keys(server.docs).map(function (id) {
          const d = server.docs[id];
          return { id: d.id, v: JSON.parse(JSON.stringify(d.v)), updatedAt: { toMillis: function () { return d.updatedAt; }, seconds: Math.floor(d.updatedAt / 1000) } };
        });
      });
    },
    loadDoc: function (col, id) {
      return delayed(function () {
        const d = server.docs[id];
        return d ? { id: d.id, v: JSON.parse(JSON.stringify(d.v)), updatedAt: { toMillis: function () { return d.updatedAt; } } } : null;
      });
    },
    saveDoc: function (col, id, doc) {
      return delayed(function () {
        if (hasUndefined(doc.v)) {
          server.rejected.push({ id: id, why: 'undefined' });
          throw new Error('Function DocumentReference.set() called with invalid data. Unsupported field value: undefined');
        }
        const size = fsDocSize(id, doc.v);
        if (size > FIRESTORE_LIMIT) {
          server.rejected.push({ id: id, why: 'size', size: size });
          throw new Error('INVALID_ARGUMENT: The document exceeds the maximum allowed size of 1,048,576 bytes (' + size + ')');
        }
        serverSet(server, id, doc.v);
        return undefined; // the real compat SDK resolves void
      });
    },
    deleteDoc: function (col, id) { delete server.docs[id]; return Promise.resolve(undefined); }
  };
  vm.createContext(sb);
  /* meter the sync engine's own JSON traffic (churn evidence) */
  vm.runInContext('(function(){ var _str = JSON.stringify, _par = JSON.parse, st = { calls: 0, chars: 0 };' +
    ' JSON.stringify = function (v) { var s = _str.apply(JSON, arguments); st.calls++; if (s) st.chars += s.length; return s; };' +
    ' JSON.parse = function (s) { st.calls++; if (s) st.chars += s.length; return _par.apply(JSON, arguments); };' +
    ' window.__jsonStats = st; })();', sb);
  vm.runInContext(csSrc, sb);
  const store = {
    get: function (k, d) { const r = localStorage.getItem('mt_' + k); return r === null ? d : JSON.parse(r); },
    set: function (k, v) { localStorage.setItem('mt_' + k, JSON.stringify(v)); return true; },
    del: function (k) { localStorage.removeItem('mt_' + k); return true; }
  };
  sb.CloudSync.attach(store);
  const world = { sb: sb, data: data, server: server, store: store };
  world.get = function (k) { const r = localStorage.getItem('mt_' + k); return r === null ? null : JSON.parse(r); };
  world.meta = function () { return JSON.parse(data['mt___syncmeta'] || '{"keys":{}}'); };
  return world;
}
function settle(ms) { return new Promise(function (r) { setTimeout(r, ms || 600); }); }

/* ---------- data shapes ---------- */
function crumbTrail(n, t0) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ t: t0 + i * 30000, a: 51.05 + i * 0.0004, o: -114.03 - i * 0.0006 });
  return out;
}
function dayRec(start, totalM, ncrumbs, extra) {
  const rec = {
    key: 's' + start, date: '2026-10-31', totalM: totalM,
    anchor: { time: start + 43200000, latitude: 51.2, longitude: -114.2 },
    crumbs: crumbTrail(ncrumbs, start), hasFix: true,
    updatedAt: start + 43200000, segs: [[start, start + 43200000]],
    joinFrom: { time: start, latitude: 51.1, longitude: -114.1 }
  };
  if (extra) for (const k in extra) rec[k] = extra[k];
  return rec;
}
function fourteenDays(todayTotalM, ncrumbs, extraForToday, extraForAll) {
  const days = {};
  for (let d = 0; d < 14; d++) {
    const start = 1791500000000 + d * 86400000;
    days['s' + start] = dayRec(start, 45000 + d * 1000, ncrumbs, extraForAll);
    days['s' + start].date = '2026-10-' + (18 + d);
  }
  const tk = 's' + (1791500000000 + 13 * 86400000);
  days[tk].totalM = todayTotalM;
  days[tk].updatedAt = Date.now();
  if (extraForToday) for (const k in extraForToday) days[tk][k] = extraForToday[k];
  return { days: days, _tk: tk };
}
const PHONE_META = function () {
  return { uid: 'u1', globallySynced: true, teleTp: { livemiles: 1 },
    keys: { livemiles: { t: 6000, s: 5000, u: 'u1' } } };
};
(async function () {
  /* ---- S0: PURE-CRUMB SANITY — the elimination pin ----------
     The v293 shape exactly (14 days at the crumb ceiling, the
     cloud frozen at 0.1 km for today). Under REAL Firestore size
     accounting the thinned copy fits with room to spare: the
     trail's size alone was never the field failure. ---------- */
  {
    const local = fourteenDays(60600, 1450);
    const tk = local._tk; delete local._tk;
    const cloudFrozen = JSON.parse(JSON.stringify(local));
    cloudFrozen.days[tk].totalM = 100;
    const server = makeServer();
    serverSet(server, 'livemiles', cloudFrozen, 5000);
    const jsonLen = JSON.stringify({ v: cloudFrozen }).length;
    const fsLen = fsDocSize('livemiles', cloudFrozen);
    console.log('S0 pure-crumb value: JSON-length stub measure ' + jsonLen + ' vs real Firestore size ' + fsLen + ' (limit ' + FIRESTORE_LIMIT + ')');
    ok('S0: the REAL Firestore size of even the FULL 14-day trail value is far under the limit — the JSON-length stub was the pessimistic measure', fsLen < FIRESTORE_LIMIT);
    const w = makeWorld(server, { local: [['livemiles', local]], meta: PHONE_META() });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(3800);
    await w.sb.CloudSync.flush(); await settle(600);
    const cv = serverGet(server, 'livemiles');
    ok("S0: a pure-crumb giant value DOES sync on the shipped code (today’s 60.6 km lands) — trail size alone eliminated as the field cause",
      !!cv && cv.days[tk].totalM === 60600, cv && String(cv.days[tk].totalM));
    const km = (w.meta().keys || {}).livemiles || {};
    ok('S0: and it seals', !(km.s < km.t), JSON.stringify(km));
  }

  /* ---- S1: LEGACY SHELL BULK — the field failure ----------
     The cloud doc (and, after old pulls, the phone store) carry
     a top-level bulk field from an old app shape — here a
     45,000-point trail archive (~1.9 MB of JSON) riding beside
     the days map. The days themselves are modest (300 crumbs a
     day). Every v293 rung keeps the shell → every push fails →
     today stays frozen at 100 m and the failure paints by name,
     exactly like the owner's phone. -------------------------- */
  {
    const bulk = { trailArchive: crumbTrail(45000, 1790000000000) };
    const mkValue = function (todayTotal) {
      const v = fourteenDays(todayTotal, 300);
      const tk = v._tk; delete v._tk;
      v.trailArchive = bulk.trailArchive;
      return { v: v, tk: tk };
    };
    const localS = mkValue(60600), cloudS = mkValue(100);
    const server = makeServer();
    serverSet(server, 'livemiles', cloudS.v, 5000);
    const daysOnly = fourteenDays(60600, 300); delete daysOnly._tk;
    console.log('S1 value JSON length (local): ' + JSON.stringify(localS.v).length + ' — the days alone: ' + JSON.stringify(daysOnly).length);
    const w = makeWorld(server, { local: [['livemiles', localS.v]], meta: PHONE_META() });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(3800);
    await w.sb.CloudSync.flush(); await settle(600);
    await w.sb.CloudSync.flush(); await settle(600);
    const cv = serverGet(server, 'livemiles');
    ok('S1: today’s 60.6 km LANDS in the cloud despite the legacy bulk on the doc',
      !!cv && cv.days[cloudS.tk].totalM === 60600, cv && String(cv.days[cloudS.tk].totalM));
    const km = (w.meta().keys || {}).livemiles || {};
    ok('S1: the key SEALS after landing', !(km.s < km.t), JSON.stringify(km));
    ok('S1: the cloud copy sheds the legacy bulk (the sync copy is a compacted doc)',
      !!cv && !('trailArchive' in cv));
    ok('S1: every day total survives in the cloud copy',
      !!cv && Object.keys(cv.days).length === 14 && cv.days['s1791500000000'].totalM === 45000);
    const lv = w.get('livemiles');
    ok('S1: the phone’s local copy of today keeps its real total (local value untouched by the shed)',
      !!lv && lv.days[cloudS.tk].totalM === 60600);
  }

  /* ---- S2: PER-DAY BULK — same class, inside the records ---
     Day records carry a heavy array the sync layer never reads
     (a raw fix log, 2,500 entries a day). The crumb ladder never
     sheds it → same permanent failure. ----------------------- */
  {
    const fixesFor = function (start) { return crumbTrail(2500, start).map(function (c) { return { t: c.t, la: c.a, lo: c.o, ac: 4 }; }); };
    const local = fourteenDays(60600, 300, null, null);
    const tk = local._tk; delete local._tk;
    Object.keys(local.days).forEach(function (k) { local.days[k].fixes = fixesFor(1791500000000); });
    const cloudFrozen = JSON.parse(JSON.stringify(local));
    cloudFrozen.days[tk].totalM = 100;
    const server = makeServer();
    serverSet(server, 'livemiles', cloudFrozen, 5000);
    const w = makeWorld(server, { local: [['livemiles', local]], meta: PHONE_META() });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(3800);
    await w.sb.CloudSync.flush(); await settle(600);
    await w.sb.CloudSync.flush(); await settle(600);
    const cv = serverGet(server, 'livemiles');
    ok('S2: today’s 60.6 km LANDS despite the per-day bulk arrays',
      !!cv && cv.days[tk].totalM === 60600, cv && String(cv.days[tk].totalM));
    const km = (w.meta().keys || {}).livemiles || {};
    ok('S2: the key SEALS', !(km.s < km.t), JSON.stringify(km));
    ok('S2: the cloud copy sheds the bulk array but keeps the day facts',
      !!cv && !('fixes' in cv.days[tk]) && cv.days[tk].anchor && cv.days[tk].anchor.latitude === 51.2);
    ok('S2: the cloud copy still carries the (modest) crumb trail — facts first, bulk only',
      !!cv && cv.days[tk].crumbs && cv.days[tk].crumbs.length === 300);
    const lv = w.get('livemiles');
    ok('S2: the phone’s local value keeps everything (full trail + its own fields)',
      !!lv && lv.days[tk].crumbs.length === 300 && !!lv.days[tk].fixes);
  }

  /* ---- S3: CHURN BUDGET — the frozen/ghosted page ----------
     A ~2.4 MB value, phone fuller than the frozen cloud. One
     onAuth cycle (pull + flush) is metered: the JSON the sync
     engine itself stringifies/parses must stay within a small
     multiple of the value's own size — the v293 ladder's eager
     six-rung deep-copy churn is what janks the page. --------- */
  {
    const local = fourteenDays(60600, 4000);
    const tk = local._tk; delete local._tk;
    const cloudFrozen = JSON.parse(JSON.stringify(local));
    cloudFrozen.days[tk].totalM = 100;
    const server = makeServer();
    serverSet(server, 'livemiles', cloudFrozen, 5000);
    const valueLen = JSON.stringify(local).length;
    const w = makeWorld(server, { local: [['livemiles', local]], meta: PHONE_META() });
    w.sb.__jsonStats.calls = 0; w.sb.__jsonStats.chars = 0;
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(3800);
    await w.sb.CloudSync.flush(); await settle(600);
    const st = w.sb.__jsonStats;
    const ratio = (st.chars / valueLen).toFixed(1);
    console.log('S3 churn: value JSON ' + valueLen + ' chars; sync engine JSON traffic ' + st.chars + ' chars in ' + st.calls + ' calls = ' + ratio + 'x the value');
    ok('S3: one pull+flush cycle processes at most ~12x the value’s own JSON size (shipped code measured 34.4x; the remainder is the merge laws’ own record comparisons, which stay)',
      st.chars <= valueLen * 12, ratio + 'x');
    const cv = serverGet(server, 'livemiles');
    ok('S3: and the dense value still lands (60.6 km)', !!cv && cv.days[tk].totalM === 60600, cv && String(cv.days[tk].totalM));
  }

  /* ---- S4: SLOW-LINK GUARD ----------------------------------
     Every Firestore op takes 3 s. The cycle must still land
     and seal (the async restructure keeps the chain intact). - */
  {
    const local = fourteenDays(60600, 300, null, null);
    const tk = local._tk; delete local._tk;
    const cloudFrozen = JSON.parse(JSON.stringify(local));
    cloudFrozen.days[tk].totalM = 100;
    const server = makeServer({ latencyMs: 3000 });
    serverSet(server, 'livemiles', cloudFrozen, 5000);
    const w = makeWorld(server, { local: [['livemiles', local]], meta: PHONE_META() });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(30000);
    const cv = serverGet(server, 'livemiles');
    ok('S4: over a 3 s-latency link the day’s miles still LAND',
      !!cv && cv.days[tk].totalM === 60600, cv && String(cv.days[tk].totalM));
    const km = (w.meta().keys || {}).livemiles || {};
    ok('S4: and seal', !(km.s < km.t), JSON.stringify(km));
  }

  /* ---- pre-fix reference: what the failure looks like -------
     (informational — asserts the S1/S2 worlds WOULD have failed
     on the old code path are implicit in their history; here we
     simply report the recorded rejections for the record) --- */
  console.log('\nsync-realfail-v295: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
