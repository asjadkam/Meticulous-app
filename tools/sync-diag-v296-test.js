#!/usr/bin/env node
/* Meticulous — SYNC-STILL-FAILING, third pass (owner verdicts,
 * Oct 31, 2026: web 293 failed in his hands 10:09; web 295
 * failed 10:53 — banner back, dot red, ghosting on Retry — and
 * failed AGAIN after a force-stop + cold start, so the failure
 * is deterministic in the push path with his real data, not a
 * session artifact).
 *
 * What two passes never did: READ the failure. The app captured
 * the actual error all along (S._keyFails) where no screen
 * showed it, and no pass ever inventoried the account's real
 * cloud document. This suite pins the v296 build's answers:
 *
 *  D1 THE GATE DEFECT (proven in code): tlSave gated the copy
 *     on JSON TEXT length vs 900,000. For number-heavy telemetry
 *     the JSON text runs ~1.8x Firestore's real byte size, so a
 *     facts copy Firestore would accept (real size under the
 *     1,048,576 limit) could be refused — honestly, by name,
 *     forever. D1 builds a value whose facts-only copy is over
 *     the old gate in JSON chars but under the real limit in
 *     Firestore bytes: v296 must LAND it, facts intact, and the
 *     recorded counterfactual (old-gate JSON size > 900,000,
 *     real size <= 1,000,000) must hold.
 *  D2/D3 THE ERROR, VERBATIM: a write-stage rejection and a
 *     read-stage rejection must land in the attempt record
 *     (status().teleDiag) with the exact error string and the
 *     right stage — and persist to mt___syncdiag.
 *  D4 THE TIMEOUT NAMES ITS STAGE: a write that never settles
 *     expires the 20 s race; the attempt record must say
 *     push-timeout and the stage it died at.
 *  D5 THE CLOUD DOC, INVENTORIED: a cloud doc carrying legacy
 *     fields (top-level + per-day) is inventoried by the pull —
 *     names, counts, real sizes — before any branch runs.
 *  D6 SYNC-FAILURE-WARNING-UNMISSABLE (owner order, Oct 31):
 *     while the truth stands at a named failure the dashboard
 *     strip (#syncWarn) is SHOWN with the plain-words text; the
 *     moment the failing key lands, it hides by itself.
 *  D7 THE SHED CLASS, CLOSED: v295 shed only object-typed bulk;
 *     a heavy STRING field rode every rung the same way. D7's
 *     day-record + shell strings must shed from the copy (and
 *     be named in the attempt record) while facts and small
 *     strings ride.
 *  D8 CHURN: one pull+flush cycle over a dense value stays
 *     within ~8x the value's own JSON size (v295 metered 10.4x;
 *     the v296 merge change-flag removes the push/pull
 *     full-value comparison serializations).
 *  D9 COLD START: a persisted attempt record from a previous
 *     session is visible via status() before any new attempt.
 *
 * The Firestore stub is the v295 suite's faithful one (real
 * byte-size accounting, undefined rejection, SDK-shaped
 * saveDoc) plus per-key failure/hang controls.
 *
 * Run: node tools/sync-diag-v296-test.js
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

/* ---------- Firestore-faithful size accounting (as v295) ---------- */
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

/* ---------- the shared "Firestore" with failure controls ---------- */
function makeServer(opts) {
  opts = opts || {};
  return {
    docs: {}, clock: 100000, rejected: [],
    failWrite: opts.failWrite || null,   // { key, err } — saveDoc rejects for this key
    failRead: opts.failRead || null,     // { key, err } — loadDoc rejects for this key
    hangWrite: opts.hangWrite || null    // key — saveDoc never settles
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
  /* a tiny element registry so the dashboard strip is observable */
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
  sb.FB = {
    ready: true,
    user: { uid: 'u1' },
    loadDocs: function () {
      return Promise.resolve(Object.keys(server.docs).map(function (id) {
        const d = server.docs[id];
        return { id: d.id, v: JSON.parse(JSON.stringify(d.v)), updatedAt: { toMillis: function () { return d.updatedAt; }, seconds: Math.floor(d.updatedAt / 1000) } };
      }));
    },
    loadDoc: function (col, id) {
      if (server.failRead && server.failRead.key === id) return Promise.reject(new Error(server.failRead.err));
      const d = server.docs[id];
      return Promise.resolve(d ? { id: d.id, v: JSON.parse(JSON.stringify(d.v)), updatedAt: { toMillis: function () { return d.updatedAt; } } } : null);
    },
    saveDoc: function (col, id, doc) {
      if (server.hangWrite === id) return new Promise(function () {});
      if (server.failWrite && server.failWrite.key === id) return Promise.reject(new Error(server.failWrite.err));
      if (hasUndefined(doc.v)) {
        server.rejected.push({ id: id, why: 'undefined' });
        return Promise.reject(new Error('Function DocumentReference.set() called with invalid data. Unsupported field value: undefined'));
      }
      const size = fsDocSize(id, doc.v);
      if (size > FIRESTORE_LIMIT) {
        server.rejected.push({ id: id, why: 'size', size: size });
        return Promise.reject(new Error('INVALID_ARGUMENT: The document exceeds the maximum allowed size of 1,048,576 bytes (' + size + ')'));
      }
      serverSet(server, id, doc.v);
      return Promise.resolve(undefined);
    },
    deleteDoc: function (col, id) { delete server.docs[id]; return Promise.resolve(undefined); }
  };
  vm.createContext(sb);
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

/* the cloud twin of a local value, frozen at 0.1 km for today —
   the merge then differs from the cloud, so a push is genuinely
   attempted (an identical cloud would seal on the pull). */
function frozenClone(v) {
  const c = JSON.parse(JSON.stringify(v));
  let best = null, bestU = -1;
  Object.keys(c.days).forEach(function (k) { if ((c.days[k].updatedAt || 0) > bestU) { bestU = c.days[k].updatedAt; best = k; } });
  if (best) c.days[best].totalM = 100;
  return c;
}
const PHONE_META = function () {
  return { uid: 'u1', globallySynced: true, teleTp: { livemiles: 1 },
    keys: { livemiles: { t: 6000, s: 5000, u: 'u1' } } };
};

(async function () {
  /* ---- D1: THE GATE DEFECT --------------------------------
     Facts the crumb ladder cannot thin: `segs` (merged counted
     intervals — a fact array) at a density whose JSON text
     alone puts even the facts-only copy over the OLD gate
     (900,000 JSON chars) while the REAL Firestore size stays
     under the cap. v295 refuses this forever; v296 must land
     it with every seg intact. ------------------------------- */
  {
    const segsFor = function (start) {
      const out = [];
      for (let i = 0; i < 2400; i++) out.push([start + i * 18000, start + i * 18000 + 9000]);
      return out;
    };
    const local = fourteenDays(60600, 60);
    const tk = local._tk; delete local._tk;
    Object.keys(local.days).forEach(function (k) {
      const st = parseInt(k.slice(1), 10);
      local.days[k].segs = segsFor(st);
    });
    const factsOnly = JSON.parse(JSON.stringify(local));
    Object.keys(factsOnly.days).forEach(function (k) { factsOnly.days[k].crumbs = []; });
    const oldGateJson = JSON.stringify(factsOnly).length;
    const realFs = fsDocSize('livemiles', factsOnly);
    console.log('D1 facts-only copy: JSON chars ' + oldGateJson + ' (old gate 900000) vs real Firestore bytes ' + realFs + ' (cap 1000000, limit 1048576)');
    ok('D1 (setup) the facts-only copy exceeds the OLD JSON-length gate', oldGateJson > 900000, String(oldGateJson));
    ok('D1 (setup) the same copy is within the REAL Firestore size cap', realFs <= 1000000, String(realFs));
    const cloudFrozen = JSON.parse(JSON.stringify(local));
    cloudFrozen.days[tk].totalM = 100;
    const server = makeServer();
    serverSet(server, 'livemiles', cloudFrozen, 5000);
    const w = makeWorld(server, { local: [['livemiles', local]], meta: PHONE_META() });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(3000);
    await w.sb.CloudSync.flush(); await settle(600);
    const cv = serverGet(server, 'livemiles');
    ok('D1: today’s 60.6 km LANDS in the cloud', !!cv && cv.days[tk].totalM === 60600, cv && String(cv.days[tk].totalM));
    ok('D1: every seg survives in the cloud copy (facts are never thinned)',
      !!cv && cv.days[tk].segs && cv.days[tk].segs.length === 2400);
    const km = (w.meta().keys || {}).livemiles || {};
    ok('D1: the key SEALS', !(km.s < km.t), JSON.stringify(km));
    const att = w.diag().attempts.livemiles;
    ok('D1: the attempt record shows the landed copy’s real size within the cap',
      !!att && att.ok === true && att.copyFsBytes > 0 && att.copyFsBytes <= 1000000, att && JSON.stringify(att));
  }

  /* ---- D2: WRITE-STAGE ERROR, VERBATIM --------------------- */
  {
    const server = makeServer({ failWrite: { key: 'livemiles', err: 'PERMISSION_DENIED: distinctive-write-error-296' } });
    const local = fourteenDays(60600, 100); const tk = local._tk; delete local._tk;
    serverSet(server, 'livemiles', frozenClone(local), 5000);
    const w = makeWorld(server, { local: [['livemiles', local]], meta: PHONE_META() });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(2500);
    /* v413 re-pin: the repeat attempt that names the failure
       is driven through flushUrgent — since SYNC-FLAPPING-
       NOV11 a failed telemetry attempt backs off for the
       60 s coalesce window, so a plain flush inside the
       window no longer retries at once (the storm this
       suite's D2 repetition predates). The law under test
       is unchanged: a REPEATED failure names itself. */
    await w.sb.CloudSync.flushUrgent(); await settle(500);
    const att = w.diag().attempts.livemiles;
    ok('D2: the failed attempt is recorded, not ok', !!att && att.ok === false, att && JSON.stringify(att));
    ok('D2: the stage is WRITE', !!att && att.stage === 'write', att && att.stage);
    ok('D2: the error is VERBATIM', !!att && /distinctive-write-error-296/.test(att.err || ''), att && att.err);
    const persisted = JSON.parse(w.data['mt___syncdiag'] || '{}');
    ok('D2: the record PERSISTS to mt___syncdiag (survives a cold start)',
      !!(persisted.attempts && persisted.attempts.livemiles && /distinctive-write-error-296/.test(persisted.attempts.livemiles.err || '')));
    const st = w.sb.CloudSync.status();
    ok('D2: the sync truth names the failure (banner state)', st.state === 'err' && st.failKey === 'livemiles', st.state + '/' + st.failKey);
  }

  /* ---- D3: READ-STAGE ERROR, VERBATIM ---------------------- */
  {
    const server = makeServer({ failRead: { key: 'livemiles', err: 'UNAVAILABLE: distinctive-read-error-296' } });
    const local = fourteenDays(60600, 100); delete local._tk;
    serverSet(server, 'livemiles', frozenClone(local), 5000);
    const w = makeWorld(server, { local: [['livemiles', local]], meta: PHONE_META() });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(2500);
    const att = w.diag().attempts.livemiles;
    ok('D3: the failed attempt is recorded at the READ stage', !!att && att.ok === false && att.stage === 'read', att && JSON.stringify(att));
    ok('D3: the error is VERBATIM', !!att && /distinctive-read-error-296/.test(att.err || ''), att && att.err);
  }

  /* ---- D5: THE CLOUD DOC, INVENTORIED ---------------------- */
  {
    const legacyStr = 'x'.repeat(20000);
    const local = fourteenDays(45000, 50);
    const tk = local._tk; delete local._tk;
    const cloudVal = JSON.parse(JSON.stringify(local));
    cloudVal.legacyNote = 'written by an old shape';
    Object.keys(cloudVal.days).forEach(function (k) { cloudVal.days[k].rawLog = legacyStr; });
    const server = makeServer();
    serverSet(server, 'livemiles', cloudVal, 5000);
    /* a fresh device (no local livemiles): the pull takes the
       cloud copy generically — the inventory must still land. */
    const w = makeWorld(server, { meta: { uid: 'u1', globallySynced: true, keys: {} } });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(2500);
    const inv = w.diag().cloudInv.livemiles;
    ok('D5: the pull inventories the cloud doc (14 day records)', !!inv && inv.days === 14, inv && String(inv.days));
    ok('D5: the top-level legacy field is named with its size',
      !!inv && inv.top.some(function (x) { return x.f === 'legacyNote'; }), inv && JSON.stringify(inv.top));
    const rl = inv && inv.dayFields.filter(function (x) { return x.f === 'rawLog'; })[0];
    ok('D5: the per-day legacy field is named, counted (×14) and sized (~20 KB each)',
      !!rl && rl.n === 14 && rl.b > 14 * 19000, rl && JSON.stringify(rl));
    const cr = inv && inv.dayFields.filter(function (x) { return x.f === 'crumbs'; })[0];
    ok('D5: real fields are inventoried too (crumbs present)', !!cr && cr.n === 14, cr && JSON.stringify(cr));
  }

  /* ---- D6: THE UNMISSABLE WARNING -------------------------- */
  {
    const server = makeServer({ failWrite: { key: 'livemiles', err: 'distinctive-strip-error' } });
    const local = fourteenDays(60600, 100); delete local._tk;
    serverSet(server, 'livemiles', frozenClone(local), 5000);
    const w = makeWorld(server, { local: [['livemiles', local]], meta: PHONE_META() });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(2500);
    /* v413 re-pin: same backoff as D2 — the repeat attempt
       and the post-heal retry are driven through the urgent
       door; on the auto cadence they would wait out the
       failed attempt's 60 s window and land inside it. */
    await w.sb.CloudSync.flushUrgent(); await settle(500);
    ok('D6: while the failure stands, the dashboard strip is SHOWN',
      w.elements.syncWarn._hidden === false, 'hidden=' + w.elements.syncWarn._hidden);
    ok('D6: the strip carries the plain words',
      /Not backing up — your work is only on this phone/.test(w.elements.syncWarn.textContent), w.elements.syncWarn.textContent);
    server.failWrite = null; // the cloud heals
    await w.sb.CloudSync.flushUrgent(); await settle(600);
    await w.sb.CloudSync.syncNow(); await settle(1200);
    ok('D6: once the failing key lands, the strip hides BY ITSELF',
      w.elements.syncWarn._hidden === true, 'hidden=' + w.elements.syncWarn._hidden);
    const att = w.diag().attempts.livemiles;
    ok('D6: and the attempt record shows the landed push', !!att && att.ok === true, att && JSON.stringify(att));
  }

  /* ---- D7: THE SHED CLASS, CLOSED (string bulk) ------------ */
  {
    const bigStr = 'y'.repeat(30000);
    const local = fourteenDays(60600, 1450, null, { traceLog: bigStr });
    const tk = local._tk; delete local._tk;
    local.shellLog = bigStr;
    Object.keys(local.days).forEach(function (k) { local.days[k].note = 'Remington'; });
    const cloudFrozen = JSON.parse(JSON.stringify(local));
    cloudFrozen.days[tk].totalM = 100;
    const server = makeServer();
    serverSet(server, 'livemiles', cloudFrozen, 5000);
    const w = makeWorld(server, { local: [['livemiles', local]], meta: PHONE_META() });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(2500);
    await w.sb.CloudSync.flush(); await settle(500);
    const cv = serverGet(server, 'livemiles');
    ok('D7: today’s miles LAND despite the string bulk', !!cv && cv.days[tk].totalM === 60600, cv && String(cv.days[tk].totalM));
    ok('D7: the cloud copy sheds BOTH string bulks (shell + per-day)',
      !!cv && !('shellLog' in cv) && !('traceLog' in cv.days[tk]));
    ok('D7: small string facts ride (the day’s note survives)', !!cv && cv.days[tk].note === 'Remington');
    const att = w.diag().attempts.livemiles;
    ok('D7: the attempt record NAMES what was shed',
      !!att && att.shed.indexOf('traceLog') >= 0 && att.shed.indexOf('shellLog') >= 0, att && JSON.stringify(att.shed));
    const lv = w.get('livemiles');
    ok('D7: the phone’s local value keeps everything', !!lv && lv.shellLog === bigStr && lv.days[tk].traceLog === bigStr);
  }

  /* ---- D9: COLD START — last session's record is visible ---- */
  {
    const server = makeServer({ failWrite: { key: 'livemiles', err: 'distinctive-cold-error' } });
    const local = fourteenDays(60600, 100); delete local._tk;
    serverSet(server, 'livemiles', frozenClone(local), 5000);
    const w1 = makeWorld(server, { local: [['livemiles', local]], meta: PHONE_META() });
    w1.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(2500);
    const savedDiag = w1.data['mt___syncdiag'];
    ok('D9 (setup) session 1 persisted its failed attempt', !!savedDiag && /distinctive-cold-error/.test(savedDiag));
    /* a brand-new page session over the same local storage */
    const w2 = makeWorld(server, { rawLocal: [['mt___syncdiag', savedDiag]], meta: PHONE_META() });
    const att = w2.diag().attempts.livemiles;
    ok('D9: the cold-started session shows the PREVIOUS attempt before any new push',
      !!att && /distinctive-cold-error/.test(att.err || ''), att && att.err);
  }

  /* ---- D8: CHURN BUDGET ------------------------------------ */
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
    await settle(3000);
    await w.sb.CloudSync.flush(); await settle(500);
    const st = w.sb.__jsonStats;
    const ratio = (st.chars / valueLen).toFixed(1);
    console.log('D8 churn: value JSON ' + valueLen + ' chars; sync engine JSON traffic ' + st.chars + ' chars = ' + ratio + 'x the value (v295 measured 10.4x)');
    ok('D8: one pull+flush cycle processes at most ~8x the value’s own JSON size', st.chars <= valueLen * 8, ratio + 'x');
    const cv = serverGet(server, 'livemiles');
    ok('D8: and the dense value still lands (60.6 km)', !!cv && cv.days[tk].totalM === 60600, cv && String(cv.days[tk].totalM));
  }

  /* ---- D4: THE TIMEOUT NAMES ITS STAGE (slow — runs last) -- */
  {
    const server = makeServer({ hangWrite: 'livemiles' });
    const local = fourteenDays(60600, 100); delete local._tk;
    serverSet(server, 'livemiles', frozenClone(local), 5000);
    const w = makeWorld(server, { local: [['livemiles', local]], meta: PHONE_META() });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(23500); // the 20 s push race expires
    const att = w.diag().attempts.livemiles;
    ok('D4: the timed-out attempt is recorded', !!att && att.ok === false, att && JSON.stringify(att));
    ok('D4: the error names the timeout', !!att && /push-timeout/.test(att.err || ''), att && att.err);
    ok('D4: and the stage it died at (write)', !!att && att.stage === 'write', att && att.stage);
  }

  console.log('\nsync-diag-v296: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
