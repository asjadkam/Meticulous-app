#!/usr/bin/env node
/* Meticulous — SYNC-STILL-FAILING, fourth pass (web 297).
 *
 * The cause is PROVEN, read off the owner's own phone
 * (Oct 31, 2026, 11:53 MDT, web 296, Preferences > Advanced):
 *   "Error: push livemiles: Function … called with invalid
 *    data. N… (found in document users/72kLjT1dbCOLdWo…)"
 * at sizes of 32 KB local / 56 KB cloud / 72 KB backup copy.
 * The refused value: the miles engine persisted a day record's
 * counted-coverage spans (`segs`) as [t0, t1] PAIRS — a list
 * inside a list, the one shape Firestore rejects outright
 * ("Nested arrays are not supported"). Every day carrying a
 * counted span poisoned every livemiles backup, on every
 * build, through every cold start — while three passes of
 * harnesses "proved" fixes against Firestore doubles that
 * never enforced the nested-list rule (their own fixture
 * records carried the same pairs and landed).
 *
 * This suite's double enforces the FULL invalid-value rules
 * with the real service's error shapes — undefined, NaN,
 * Infinity, Date / custom objects, functions, and nested
 * arrays — and can serve LIVE cloud objects (a JSON round
 * trip would launder exactly the poisons under test).
 *
 *  E0 STUB FIDELITY: a raw write of each poison class is
 *     REJECTED with the invalid-data error — the failure the
 *     app itself used to hit.
 *  E1 THE PHONE'S BUG: local day records with pair-shaped
 *     segs (the shape on his phone today) against a cloud doc
 *     whose records carry none: the push must LAND, today's
 *     total must land, the spans must arrive as { f, t } maps
 *     with both numbers intact, the key must seal, and the
 *     attempt record must NAME the first refused value
 *     (…segs[0], a nested array) and the cleaning.
 *  E2–E5 THE OTHER POISON CLASSES, one per case, arriving on
 *     cloud-only day records as live objects: a NaN total, an
 *     undefined anchor field, a Date updatedAt, an undefined
 *     value inside a crumb. Each push must land with the facts
 *     intact, the written value deep-clean, and the attempt
 *     record naming the exact path.
 *  E6 INFINITY VIA THE LOCAL RAW: a stored "1e999" total
 *     parses to Infinity on the phone's own side; the direct
 *     (no-cloud) push must land with the total written blank.
 *  E7 THE STUB NEVER OVERRIDES THE PHONE (the 0.1 km loose
 *     end): the cloud's today is a 100 m stub with a NEWER
 *     stamp than the phone's real 91.2 km today — totals law
 *     must still give the day to the phone, the union must
 *     keep a cloud-only older day, and the local learn must
 *     keep the phone's figure.
 *  E8 GEOLOADS RIDES THE SAME BOUNDARY: an event carrying an
 *     undefined field lands cleaned, count intact.
 *
 * Run: node tools/sync-invalid-v297-test.js
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

/* ---------- Firestore-faithful size accounting (as v295/v296) ---------- */
function fsValueSize(v) {
  if (v === null || v === undefined) return 1;
  if (typeof v === 'boolean') return 1;
  if (typeof v === 'number') return 8;
  if (typeof v === 'string') return Buffer.byteLength(v, 'utf8') + 1;
  if (Array.isArray(v)) { let s = 0; for (let i = 0; i < v.length; i++) s += fsValueSize(v[i]); return s; }
  if (typeof v === 'object') {
    if (typeof v.toMillis === 'function') return 8;
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

/* ---------- the FULL invalid-value rules, real error shapes ---------- */
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
  for (const k in v) {
    const r = findInvalid(v[k], p ? p + '.' + k : k);
    if (r) return r;
  }
  return null;
}
function invalidErr(id, why) {
  return new Error('Function DocumentReference.set() called with invalid data. ' + why +
    ' (found in document users/u1/kv/' + id + ')');
}
/* deep scan used on WRITTEN docs: nothing the store refuses */
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
    docs: {}, liveDocs: {}, clock: 100000, rejected: [],
    failWrite: opts.failWrite || null,
    failRead: opts.failRead || null,
    hangWrite: opts.hangWrite || null
  };
}
function serverSet(server, id, v, updatedAt) {
  server.docs[id] = { id: id, v: JSON.parse(JSON.stringify(v)), updatedAt: updatedAt || (++server.clock) };
}
function serverGet(server, id) {
  const d = server.docs[id];
  return d ? d.v : null;
}

/* ---------- a device world running the REAL cloudsync.js ---------- */
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
  const sb = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, Promise: Promise };
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
  sb.FB = {
    ready: true,
    user: { uid: 'u1' },
    loadDocs: function () {
      return Promise.resolve(Object.keys(server.docs).map(function (id) {
        if (server.liveDocs[id] !== undefined) return docShape(id, server.liveDocs[id], server.docs[id].updatedAt);
        const d = server.docs[id];
        return docShape(id, JSON.parse(JSON.stringify(d.v)), d.updatedAt);
      }));
    },
    loadDoc: function (col, id) {
      if (server.failRead && server.failRead.key === id) return Promise.reject(new Error(server.failRead.err));
      if (server.liveDocs[id] !== undefined) {
        const d0 = server.docs[id];
        return Promise.resolve(docShape(id, server.liveDocs[id], d0 ? d0.updatedAt : 5000));
      }
      const d = server.docs[id];
      return Promise.resolve(d ? docShape(id, JSON.parse(JSON.stringify(d.v)), d.updatedAt) : null);
    },
    saveDoc: function (col, id, doc) {
      if (server.hangWrite === id) return new Promise(function () {});
      if (server.failWrite && server.failWrite.key === id) return Promise.reject(new Error(server.failWrite.err));
      const bad = findInvalid(doc.v, '');
      if (bad) {
        server.rejected.push({ id: id, why: bad });
        return Promise.reject(invalidErr(id, bad));
      }
      const size = fsDocSize(id, doc.v);
      if (size > FIRESTORE_LIMIT) {
        server.rejected.push({ id: id, why: 'size', size: size });
        return Promise.reject(new Error('INVALID_ARGUMENT: The document exceeds the maximum allowed size of 1,048,576 bytes (' + size + ')'));
      }
      serverSet(server, id, doc.v);
      return Promise.resolve(undefined);
    },
    deleteDoc: function (col, id) { delete server.docs[id]; delete server.liveDocs[id]; return Promise.resolve(undefined); }
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
  world.diag = function () { return sb.CloudSync.status().teleDiag; };
  return world;
}
function settle(ms) { return new Promise(function (r) { setTimeout(r, ms || 600); }); }

/* ---------- data shapes (the real engine's record shape) ---------- */
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
function fourteenDays(todayTotalM, ncrumbs) {
  const days = {};
  for (let d = 0; d < 14; d++) {
    const start = 1791500000000 + d * 86400000;
    days['s' + start] = dayRec(start, 45000 + d * 1000, ncrumbs);
    days['s' + start].date = '2026-10-' + (18 + d);
  }
  const tk = 's' + (1791500000000 + 13 * 86400000);
  days[tk].totalM = todayTotalM;
  days[tk].updatedAt = Date.now();
  return { days: days, _tk: tk };
}
/* the real cloud doc's shape: records an older build wrote —
   no segs, no joinFrom — with today frozen at 0.1 km */
function cloudShape(localVal, todayTotalM) {
  const c = JSON.parse(JSON.stringify(localVal));
  Object.keys(c.days).forEach(function (k) { delete c.days[k].segs; delete c.days[k].joinFrom; });
  let best = null, bestU = -1;
  Object.keys(c.days).forEach(function (k) { if ((c.days[k].updatedAt || 0) > bestU) { bestU = c.days[k].updatedAt; best = k; } });
  if (best) c.days[best].totalM = todayTotalM;
  return c;
}
const PHONE_META = function () {
  return { uid: 'u1', globallySynced: true, teleTp: { livemiles: 1 },
    keys: { livemiles: { t: 6000, s: 5000, u: 'u1' } } };
};

(async function () {
  /* ---- E0: STUB FIDELITY — the raw write is refused -------- */
  {
    const server = makeServer();
    const w = makeWorld(server, { meta: PHONE_META() });
    const poisons = {
      'undefined': { days: { s1: dayRec(1791500000000, 100, 1, { note: undefined }) } },
      'NaN': { days: { s1: dayRec(1791500000000, NaN, 1) } },
      'a Date': { days: { s1: dayRec(1791500000000, 100, 1, { updatedAt: new Date(1791500000000) }) } },
      'a nested array': { days: { s1: dayRec(1791500000000, 100, 1) } },
      'a function': { days: { s1: dayRec(1791500000000, 100, 1, { note: function () {} }) } }
    };
    for (const name of Object.keys(poisons)) {
      let err = null;
      try { await w.sb.FB.saveDoc('kv', 'livemiles', { v: poisons[name] }); }
      catch (e) { err = e; }
      ok('E0: a raw write carrying ' + name + ' is REJECTED with the invalid-data error',
        !!err && /called with invalid data/.test(err.message), err && err.message);
    }
  }

  /* ---- E1: THE PHONE'S BUG --------------------------------- */
  {
    const local = fourteenDays(60600, 100);
    const tk = local._tk; delete local._tk;
    const server = makeServer();
    serverSet(server, 'livemiles', cloudShape(local, 100), 5000);
    const w = makeWorld(server, { local: [['livemiles', local]], meta: PHONE_META() });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(2500);
    await w.sb.CloudSync.flush(); await settle(600);
    const cv = serverGet(server, 'livemiles');
    ok('E1: the push LANDS despite pair-shaped segs on every day', !!cv, 'no cloud doc');
    ok('E1: today’s 60.6 km lands', !!cv && cv.days[tk].totalM === 60600, cv && String(cv.days[tk].totalM));
    const seg = cv && cv.days[tk].segs && cv.days[tk].segs[0];
    ok('E1: the counted span arrives as an { f, t } map with both numbers intact',
      !!seg && !Array.isArray(seg) && seg.f === 1791500000000 + 13 * 86400000 && seg.t === seg.f + 43200000,
      seg && JSON.stringify(seg));
    ok('E1: the written document is deep-clean (nothing the store refuses)',
      !!cv && deepClean(cv, false));
    const km = (w.meta().keys || {}).livemiles || {};
    ok('E1: the key SEALS', !(km.s < km.t), JSON.stringify(km));
    const att = w.diag().attempts.livemiles;
    ok('E1: the attempt record NAMES the first refused value (…segs[0])',
      !!att && /\.segs\[0\]$/.test(att.invalidPath || ''), att && att.invalidPath);
    ok('E1: …and its kind (a nested array)', !!att && att.invalidKind === 'a nested array', att && att.invalidKind);
    ok('E1: …and the cleaning that let it land', !!att && (att.cleaned || []).some(function (c) { return /coverage spans/.test(c); }),
      att && JSON.stringify(att.cleaned));
    ok('E1: the attempt shows the landed push', !!att && att.ok === true, att && JSON.stringify(att.ok));
    const lv = w.get('livemiles');
    ok('E1: the phone’s local value keeps its pair-shaped spans (the copy is cleaned, not the store)',
      !!lv && Array.isArray(lv.days[tk].segs[0]));
  }

  /* ---- E2–E5: the other poison classes, via live cloud days --
     Pattern per case: the poisoned day exists ONLY in the cloud
     (as a live object — a JSON round trip would launder it).
     After the first settle, the local value is reset to the
     clean set (store.set re-stamps the key dirty) and the live
     doc re-seeded, so the push's own merge — not the pull's —
     carries the poisoned record into the write. ------------- */
  async function poisonCase(name, poisonDay, expectPath, expectKind, assertFn) {
    const local = fourteenDays(45000, 40);
    delete local._tk;
    const cleanLocal = JSON.parse(JSON.stringify(local));
    /* the clean set must be truly clean: pair-shaped spans are
       themselves the E1 poison, and the merged value's FIRST
       invalid must be this case's intended one. */
    Object.keys(cleanLocal.days).forEach(function (k) { cleanLocal.days[k].segs = []; });
    const server = makeServer();
    serverSet(server, 'livemiles', cloudShape(local, 100), 5000);
    const w = makeWorld(server, { local: [['livemiles', cleanLocal]], meta: PHONE_META() });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(2200);
    const cloudVal = cloudShape(local, 100);
    cloudVal.days[poisonDay.key] = poisonDay;
    server.liveDocs.livemiles = cloudVal;
    w.store.set('livemiles', cleanLocal);
    await settle(300);
    /* flushUrgent: the v276 60 s telemetry coalesce would
       otherwise hold this second push past the case's window —
       urgent is the tracker's own "rides NOW" door. */
    await w.sb.CloudSync.flushUrgent(); await settle(700);
    const cv = serverGet(server, 'livemiles');
    const att = w.diag().attempts.livemiles;
    assertFn(cv, att, w);
    ok(name + ': the attempt record names the exact path',
      !!att && att.invalidPath === expectPath, att && att.invalidPath);
    ok(name + ': …and the kind (' + expectKind + ')',
      !!att && att.invalidKind === expectKind, att && att.invalidKind);
    ok(name + ': the written document is deep-clean', !!cv && deepClean(cv, false));
    ok(name + ': the attempt shows the landed push', !!att && att.ok === true, att && JSON.stringify(att && att.ok));
  }

  /* E2: a NaN total */
  {
    const pd = dayRec(1792600000000, NaN, 30);
    pd.date = '2026-10-30';
    await poisonCase('E2', pd, 'days.' + pd.key + '.totalM', 'NaN', function (cv) {
      ok('E2: the push lands and the NaN day rides, its total written blank',
        !!cv && !!cv.days[pd.key] && cv.days[pd.key].totalM === null,
        cv && cv.days[pd.key] && String(cv.days[pd.key].totalM));
      ok('E2: the day’s other facts survive (crumbs intact)',
        !!cv && !!cv.days[pd.key] && cv.days[pd.key].crumbs.length === 30);
    });
  }

  /* E3: an undefined anchor field */
  {
    const pd = dayRec(1792600000000, 42000, 30);
    pd.date = '2026-10-30';
    pd.anchor = { time: 1792643200000, latitude: undefined, longitude: -114.2 };
    await poisonCase('E3', pd, 'days.' + pd.key + '.anchor.latitude', 'undefined', function (cv) {
      const a = cv && cv.days[pd.key] && cv.days[pd.key].anchor;
      ok('E3: the push lands; the anchor keeps its real fields (time, longitude)',
        !!a && a.time === 1792643200000 && a.longitude === -114.2, a && JSON.stringify(a));
      ok('E3: the day’s total survives', !!cv && cv.days[pd.key].totalM === 42000);
    });
  }

  /* E4: a Date where the stamp belongs */
  {
    const pd = dayRec(1792600000000, 42000, 30);
    pd.date = '2026-10-30';
    pd.updatedAt = new Date(1792643200000);
    await poisonCase('E4', pd, 'days.' + pd.key + '.updatedAt', 'a Date', function (cv) {
      ok('E4: the push lands; the Date arrives as its time number',
        !!cv && cv.days[pd.key] && cv.days[pd.key].updatedAt === 1792643200000,
        cv && cv.days[pd.key] && String(cv.days[pd.key].updatedAt));
    });
  }

  /* E5: an undefined value inside a crumb */
  {
    const pd = dayRec(1792600000000, 42000, 30);
    pd.date = '2026-10-30';
    pd.crumbs[3] = { t: pd.crumbs[3].t, a: undefined, o: pd.crumbs[3].o };
    await poisonCase('E5', pd, 'days.' + pd.key + '.crumbs[3].a', 'undefined', function (cv) {
      const c = cv && cv.days[pd.key] && cv.days[pd.key].crumbs[3];
      ok('E5: the push lands; the crumb keeps its real fields (t, o)',
        !!c && typeof c.t === 'number' && typeof c.o === 'number' && !('a' in c), c && JSON.stringify(c));
      ok('E5: the rest of the trail survives', !!cv && cv.days[pd.key].crumbs.length === 30);
    });
  }

  /* ---- E6: INFINITY VIA THE LOCAL RAW ----------------------- */
  {
    const raw = '{"days":{"s1791500000000":{"key":"s1791500000000","date":"2026-10-31",' +
      '"totalM":1e999,"anchor":{"time":1791543200000,"latitude":51.2,"longitude":-114.2},' +
      '"crumbs":[],"hasFix":true,"updatedAt":1791543200000,"segs":[]}}}';
    const server = makeServer();
    const w = makeWorld(server, { rawLocal: [['mt_livemiles', raw]], meta: PHONE_META() });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(2200);
    await w.sb.CloudSync.flush(); await settle(600);
    const cv = serverGet(server, 'livemiles');
    const rec = cv && cv.days.s1791500000000;
    ok('E6: the direct push lands', !!rec, 'no cloud record');
    ok('E6: the infinite total is written blank, never as a fake number',
      !!rec && rec.totalM === null, rec && String(rec.totalM));
    const att = w.diag().attempts.livemiles;
    ok('E6: the attempt names the path + kind',
      !!att && att.invalidPath === 'days.s1791500000000.totalM' && att.invalidKind === 'Infinity',
      att && (att.invalidPath + '/' + att.invalidKind));
  }

  /* ---- E7: THE STUB NEVER OVERRIDES THE PHONE --------------- */
  {
    const local = fourteenDays(91200, 60);
    const tk = local._tk; delete local._tk;
    for (let d = 0; d < 3; d++) {
      const start = 1791500000000 - (d + 1) * 86400000;
      local.days['s' + start] = dayRec(start, 30000 + d * 1000, 60);
      local.days['s' + start].date = '2026-10-' + (14 - d);
    }
    const cloudVal = cloudShape(local, 100);
    cloudVal.days[tk].updatedAt = Date.now() + 100000; // the stub is NEWER-stamped…
    const onlyStart = 1791200000000;
    cloudVal.days['s' + onlyStart] = dayRec(onlyStart, 5000, 10);
    delete cloudVal.days['s' + onlyStart].segs;
    cloudVal.days['s' + onlyStart].date = '2026-10-13';
    const server = makeServer();
    serverSet(server, 'livemiles', cloudVal, 5000);
    const w = makeWorld(server, { local: [['livemiles', local]], meta: PHONE_META() });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(2500);
    await w.sb.CloudSync.flush(); await settle(600);
    const cv = serverGet(server, 'livemiles');
    ok('E7: the cloud’s today becomes the phone’s real 91.2 km (totals law gives the day to the phone)',
      !!cv && cv.days[tk].totalM === 91200, cv && String(cv.days[tk].totalM));
    ok('E7: the cloud-only older day survives the union',
      !!cv && cv.days['s' + onlyStart] && cv.days['s' + onlyStart].totalM === 5000);
    const lv = w.get('livemiles');
    ok('E7: the local learn keeps the phone’s figure (the stub never re-teaches the phone)',
      !!lv && lv.days[tk].totalM === 91200, lv && String(lv.days[tk].totalM));
    const km = (w.meta().keys || {}).livemiles || {};
    ok('E7: the key seals', !(km.s < km.t), JSON.stringify(km));
  }

  /* ---- E8: GEOLOADS RIDES THE SAME BOUNDARY ----------------- */
  {
    const gLocal = { days: { g1: {
      key: 'g1', date: '2026-10-31', count: 7, corr: 1,
      events: [{ t: 1000, site: 'load', n: 1 }], pegEvents: [],
      pegs: { load: { lat: 51.1, lng: -114.1, t: 500 }, dump: null },
      updatedAt: 2000
    } } };
    const gPoisonDay = {
      key: 'g2', date: '2026-10-30', count: 3, corr: 0,
      events: [{ t: 2000, site: 'dump', n: 1, note: undefined }], pegEvents: [],
      pegs: { load: null, dump: null },
      updatedAt: 3000
    };
    const meta = { uid: 'u1', globallySynced: true, teleTp: { geoloads: 1 },
      keys: { geoloads: { t: 6000, s: 5000, u: 'u1' } } };
    const server = makeServer();
    serverSet(server, 'geoloads', JSON.parse(JSON.stringify(gLocal)), 5000);
    const w = makeWorld(server, { local: [['geoloads', gLocal]], meta: meta });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(2200);
    server.liveDocs.geoloads = { days: { g1: JSON.parse(JSON.stringify(gLocal.days.g1)), g2: gPoisonDay } };
    w.store.set('geoloads', gLocal);
    await settle(300);
    await w.sb.CloudSync.flushUrgent(); await settle(700);
    const cv = serverGet(server, 'geoloads');
    const g2 = cv && cv.days.g2;
    ok('E8: the geoloads push lands with the poisoned day aboard', !!g2, 'g2 missing');
    ok('E8: the count survives', !!g2 && g2.count === 3, g2 && String(g2.count));
    ok('E8: the event keeps its facts, minus the un-storable field',
      !!g2 && g2.events.length === 1 && g2.events[0].site === 'dump' && !('note' in g2.events[0]),
      g2 && JSON.stringify(g2.events));
    const att = w.diag().attempts.geoloads;
    ok('E8: the attempt names the path',
      !!att && att.invalidPath === 'days.g2.events[0].note', att && att.invalidPath);
    ok('E8: the written document is deep-clean', !!cv && deepClean(cv, false));
  }

  console.log('\nsync-invalid-v297: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
