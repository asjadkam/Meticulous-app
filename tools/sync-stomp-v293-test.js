#!/usr/bin/env node
/* Meticulous — SYNC-STOMP (owner evidence, Oct 31, 2026):
 * FUEL-EDIT-STOMPED + SYNC-LIVE-MILES-NOT-PUSHING.
 *
 * The field evidence (account asjadkamal482, read-only cloud-side
 * checks run from a browser against the account's own cloud tree):
 *   08:51 — a browser session edits the Oct 30 fuel entry in the
 *     app UI: $250.00 / no litres / "Petro-Canada" -> $235.82 /
 *     93.6 L / "Petro-Canada (Barlow)" / odo 170,749. In-session
 *     verification: Fuel list top entry + Oct 30 manifest both
 *     show the corrected values.
 *   09:41 — a fresh read-only check shows the newest fuel entry
 *     AGAIN at $250.00, no litres, "Petro-Canada", PLUS a second
 *     separate Oct 30 entry below it. And today's live day in the
 *     cloud: Miles (live) 0.1 km while the phone shows 60.6 km;
 *     session EVENTS land (timer, loads, pegs, PTI) — the
 *     live-miles telemetry does not. The phone's sync light is
 *     red. Oct 30's cloud manifest disagrees with the phone's
 *     closed day: loads "20 on site" (phone closed at 17 = the
 *     record's 19 with the owner's -2 correction) and live miles
 *     1.8 vs the phone's 1.7.
 *
 * The mechanisms, in js/cloudsync.js as shipped (web 292):
 *   (1) FUEL IDENTITY INSTABILITY. recordIdentity('fuel_fills')
 *       is a fingerprint of [date, time, litres, cost, station,
 *       odo] — the very fields the edit form rewrites. An edit
 *       therefore gives the record a NEW identity, and the
 *       union merge (v241/v272) can no longer tell the edited
 *       copy from a second fill: both survive, forever. The one
 *       mechanism that could connect them — the per-device
 *       shadow (km.sh) treating the vanished old identity as a
 *       pending delete — silently no-ops on any participant
 *       whose shadow is empty, and a FRESH-profile session never
 *       acquires one: its first pull finds raw === null locally
 *       and takes the cloud copy through the GENERIC branch,
 *       which sets clean stamps but never km.sh. (The Oct 31
 *       edit was made from exactly such a session.) Result:
 *       the cloud holds both copies; ordering puts the stale
 *       $250 back on top; P&L's v188 four-fact rule (date +
 *       station + amount + litres) also sees two different
 *       fills and counts both.
 *   (2) TELEMETRY OVERSIZED FREEZE. The telemetry push branch
 *       (v288) read-merge-writes livemiles / geoloads with NO
 *       size handling: the one document carries a rolling 14
 *       days of day records, each with its full breadcrumb
 *       trail (the engine's own throttle ceiling: a crumb every
 *       30 s of driving). At that ceiling the document crosses
 *       Firestore's ~1 MiB document limit; saveDoc then rejects
 *       EVERY push, the key never seals, the failure paints
 *       (the red light), and the cloud copy freezes wherever it
 *       last fit — small keys (sessions, PTI, dispatches) keep
 *       landing around it, which is exactly the 09:41 picture.
 *       Fuel got a sync copy in v289; telemetry never did.
 *   (3) CORRECTION STOMP (geoloads). mergeTelemetryDays picks
 *       the larger count+corr total per day, unconditionally.
 *       A driver's correction legitimately moves a day's total
 *       DOWN (Oct 30: 19 counted, corr -2 -> 17; an earlier
 *       snapshot with corr +1 read 20). Once the higher total
 *       reaches the cloud, every later merge — pull and push —
 *       keeps it and re-teaches it to the phone: the corrected
 *       final can never land. Same-count records (a correction
 *       changes corr, not the machine count) must arbitrate by
 *       updatedAt, with the fragment protection (a young
 *       engine's smaller count must never beat the full day)
 *       kept intact.
 *
 * The fix (js/cloudsync.js + the fuel save path):
 *   - Fuel fills are born with a stable id (the save handler
 *     stamps rec.id, and applyFillEdit preserves it — it copies
 *     the original's fields) and every save/edit stamps
 *     rec.updAt. recordIdentity prefers the id. In the union
 *     merge, two id-less copies of one fill (same date, and —
 *     for unversioned copies — the same odometer; a versioned
 *     copy may also have moved the odometer in a correction
 *     edit) collapse to ONE record: the newer updAt wins, then
 *     the more complete copy, then the local one. A stale
 *     full-book push can no longer resurrect old field values,
 *     and the current duplicate heals on the next merge.
 *   - Telemetry pushes write a SYNC COPY when the merged value
 *     exceeds MAX_DOC_BYTES: per-day breadcrumb trails are
 *     thinned evenly (totals, anchors, segs, pegs, events —
 *     every fact a merge or a dashboard reads — ride intact),
 *     oldest days shed first; a copy still over the limit fails
 *     honestly, exactly like v289. The local store always keeps
 *     the full trail. The pull compares sync copies (the v289
 *     A7 lesson), and a totals tie prefers the crumb-richer
 *     record, so a shed cloud copy seals and never strips the
 *     phone's trail.
 *   - mergeTelemetryDays for geoloads: when both records carry
 *     the same machine count (or the same event trail), the
 *     later-updatedAt record wins — corrections land. Counts
 *     that differ keep the v224 larger-total law.
 *
 * Cases: F1 the incident replayed (fresh-profile edit, no
 * shadow) · F2 a stale phone append-push after a clean edit ·
 * F3 a pending delete stays deleted (v272 R3 pin) · M1 the
 * oversized livemiles push (Firestore limit enforced by the
 * stub) · M2 the geoloads correction convergence · M3 the
 * young-fragment protection (v224/v288 pin) · M4 a totals tie
 * must not strip the phone's breadcrumb trail.
 *
 * Run: node tools/sync-stomp-v293-test.js
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

/* The shared "Firestore": one server, many device worlds.
   saveDoc enforces the real Firestore document limit.       */
const FIRESTORE_LIMIT = 1048576;
function makeServer() {
  return { docs: {}, clock: 100000, rejected: [] };
}
function serverSet(server, id, v, updatedAt) {
  server.docs[id] = { id: id, v: v, updatedAt: updatedAt || (++server.clock) };
}
function serverGet(server, id) {
  const d = server.docs[id];
  return d ? d.v : null;
}

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
    ready: true,
    user: { uid: 'u1' },
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
    saveDoc: function (col, id, doc) {
      const size = JSON.stringify({ v: doc.v }).length;
      if (size > FIRESTORE_LIMIT) {
        server.rejected.push({ id: id, size: size });
        return Promise.reject(new Error('Firestore: document too large (' + size + ' bytes)'));
      }
      serverSet(server, id, doc.v);
      return Promise.resolve({});
    },
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
  world.meta = function () { return JSON.parse(data['mt___syncmeta'] || '{"keys":{}}'); };
  return world;
}
function settle(ms) { return new Promise(function (r) { setTimeout(r, ms || 600); }); }

/* the Oct 30 fill, as filed (wrong) and as corrected */
const OLD30 = { date: '2026-10-30', cost: '250', station: 'Petro-Canada', odo: 170749, profileId: 'p1' };
const EDIT30 = { date: '2026-10-30', litres: '93.6', cost: '235.82', station: 'Petro-Canada (Barlow)', odo: 170749, profileId: 'p1' };
const F_EARLIER = { date: '2026-10-22', litres: '99.047', cost: '239.59', station: 'Petro-Canada Roadking', odo: 169999, profileId: 'p1' };
const NEWFILL = { date: '2026-10-31', litres: '50.5', cost: '120.00', station: 'Mobil', odo: 170800, profileId: 'p1' };

function oct30s(arr) {
  return (arr || []).filter(function (f) { return f && f.date === '2026-10-30'; });
}

/* a day record with a breadcrumb trail at the engine's own
   throttle ceiling (a crumb every 30 s over a 12 h day) */
function crumbTrail(n, t0) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ t: t0 + i * 30000, a: 51.05 + i * 0.0004, o: -114.03 - i * 0.0006 });
  return out;
}
function bigLivemiles(todayTotalM) {
  const days = {};
  for (let d = 0; d < 14; d++) {
    const start = 1791500000000 + d * 86400000;
    days['s' + start] = {
      key: 's' + start, date: '2026-10-' + (18 + d), totalM: 45000 + d * 1000,
      anchor: { time: start + 43200000, latitude: 51.2, longitude: -114.2 },
      crumbs: crumbTrail(1450, start), hasFix: true, updatedAt: start + 43200000, segs: [[start, start + 43200000]]
    };
  }
  const todayKey = 's' + (1791500000000 + 13 * 86400000);
  days[todayKey].totalM = todayTotalM;
  days[todayKey].updatedAt = Date.now();
  return { days: days, _todayKey: todayKey };
}

(async function () {
  /* ---- F1: THE INCIDENT — a fresh-profile session (no shadow
         on record, ever) edits the fill; the phone then syncs.
         The cloud must end with ONE Oct 30 record: the edit. -- */
  {
    const server = makeServer();
    serverSet(server, 'fuel_fills', [F_EARLIER, OLD30], 5000);
    /* the browser session: empty local store, no sync meta */
    const B = makeWorld(server, {});
    B.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    const bMeta = B.meta().keys.fuel_fills || {};
    ok('F1 (setup) the fresh session pulled the book but holds NO shadow',
      Array.isArray(B.get('fuel_fills')) && !bMeta.sh,
      'sh=' + JSON.stringify(bMeta.sh));
    /* the edit, as the app saves it: the array with the record
       replaced in place (fuel.js applyFillEdit + saveFillsVerified) */
    B.store.set('fuel_fills', [F_EARLIER, EDIT30]);
    await settle(3600); /* debounced flush */
    /* the phone: holds the old book, its own shadow from history */
    const P = makeWorld(server, {
      local: [['fuel_fills', [F_EARLIER, OLD30]]],
      meta: { uid: 'u1', globallySynced: true, keys: { fuel_fills: { t: 4000, s: 4000, u: 'u1', sh: ['fp:date="2026-10-22"|time=null|litres="99.047"|cost="239.59"|station="Petro-Canada Roadking"|odo=169999', 'fp:date="2026-10-30"|time=null|litres=null|cost="250"|station="Petro-Canada"|odo=170749'] } } }
    });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(3600);
    const cloud = serverGet(server, 'fuel_fills');
    eq1: {
      ok('F1 the cloud holds exactly ONE Oct 30 fill', oct30s(cloud).length === 1,
        'cloud Oct30 count=' + oct30s(cloud).length);
      const one = oct30s(cloud)[0] || {};
      ok('F1 the surviving fill is the EDIT ($235.82 / 93.6 L / Barlow)',
        String(one.cost) === '235.82' && String(one.litres) === '93.6' && one.station === 'Petro-Canada (Barlow)',
        JSON.stringify(one));
      ok('F1 the phone converges to the same single edited fill',
        oct30s(P.get('fuel_fills')).length === 1 && String((oct30s(P.get('fuel_fills'))[0] || {}).cost) === '235.82',
        JSON.stringify(oct30s(P.get('fuel_fills'))));
    }
  }

  /* ---- F2: a stale phone append-push after a clean edit ----
     The edit already landed in the cloud. The phone — which has
     not pulled since — appends an unrelated fill and its flush
     pushes its stale book. The edit must survive the push.    */
  {
    const server = makeServer();
    serverSet(server, 'fuel_fills', [F_EARLIER, OLD30], 5000);
    const P = makeWorld(server, {
      local: [['fuel_fills', [F_EARLIER, OLD30]]],
      meta: { uid: 'u1', globallySynced: true, keys: { fuel_fills: { t: 4000, s: 4000, u: 'u1' } } }
    });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900); /* its pull lands; shadow now on record */
    /* the browser edit lands in the cloud behind its back */
    serverSet(server, 'fuel_fills', [F_EARLIER, EDIT30], 9000);
    /* the phone appends a new fill to its STALE book and flushes
       (no pull intervenes — the repeat-pull gap is 10 min) */
    P.store.set('fuel_fills', [F_EARLIER, OLD30, NEWFILL]);
    await settle(3600);
    const cloud = serverGet(server, 'fuel_fills');
    ok('F2 the cloud still holds exactly ONE Oct 30 fill after the stale push',
      oct30s(cloud).length === 1, 'cloud Oct30 count=' + oct30s(cloud).length);
    ok('F2 the surviving Oct 30 fill is the EDIT, not the stale $250',
      String((oct30s(cloud)[0] || {}).cost) === '235.82',
      JSON.stringify(oct30s(cloud)[0]));
    ok('F2 the phone\u2019s new fill landed too',
      (cloud || []).some(function (f) { return f.date === '2026-10-31'; }));
  }

  /* ---- F3: A PENDING DELETE STAYS DELETED (v272 R3 pin) ---- */
  {
    const F19 = { date: '2026-10-19', litres: 90.259, cost: 206.60, station: 'Petro-Canada', odo: 169531 };
    const F20 = { date: '2026-10-20', litres: 104.036, cost: 239.18, station: 'Petro-Canada', odo: 169775 };
    function fid(rec) {
      const fields = ['date', 'time', 'litres', 'cost', 'station', 'odo'];
      return 'fp:' + fields.map(function (k) { return k + '=' + JSON.stringify(rec[k] === undefined ? null : rec[k]); }).join('|');
    }
    const server = makeServer();
    serverSet(server, 'fuel_fills', [F19, F20], 2000);
    const W = makeWorld(server, {
      local: [['fuel_fills', [F19]]],
      meta: { uid: 'u1', globallySynced: true, keys: { fuel_fills: { t: 3000, s: 1000, u: 'u1', sh: [fid(F19), fid(F20)] } } }
    });
    W.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(3600);
    eq2: {
      ok('F3 the deleted fill is NOT resurrected locally', (W.get('fuel_fills') || []).length === 1);
      const cloud = serverGet(server, 'fuel_fills');
      ok('F3 the delete propagates UP', Array.isArray(cloud) && cloud.length === 1 && cloud[0].cost === 206.60,
        JSON.stringify(cloud && cloud.length));
    }
  }

  /* ---- M1: THE OVERSIZED TELEMETRY PUSH ----
     The livemiles document at the engine's own crumb ceiling
     crosses the Firestore limit: today's miles must still land,
     the key must seal, and the phone keeps its full trail.    */
  {
    const local = bigLivemiles(60600);
    const todayKey = local._todayKey; delete local._todayKey;
    const cloudFrozen = JSON.parse(JSON.stringify(local));
    cloudFrozen.days[todayKey].totalM = 100; /* the frozen 0.1 km */
    cloudFrozen.days[todayKey].crumbs = cloudFrozen.days[todayKey].crumbs.slice(0, 3);
    const server = makeServer();
    serverSet(server, 'livemiles', cloudFrozen, 5000);
    const localBytes = JSON.stringify({ v: local }).length;
    ok('M1 (setup) the local livemiles value exceeds the app\u2019s MAX_DOC_BYTES guard (900,000)',
      localBytes > 900000, 'bytes=' + localBytes);
    const W = makeWorld(server, {
      local: [['livemiles', local]],
      meta: { uid: 'u1', globallySynced: true, teleTp: { livemiles: 1 },
        keys: { livemiles: { t: 6000, s: 5000, u: 'u1' } } }
    });
    W.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(1500);
    W.sb.CloudSync.flush(); /* a second cycle: retries must converge, not spin */
    await settle(1500);
    const cloud = serverGet(server, 'livemiles');
    ok('M1 today\u2019s live miles LAND in the cloud (60.6 km, not the frozen 0.1)',
      !!(cloud && cloud.days && cloud.days[todayKey] && cloud.days[todayKey].totalM === 60600),
      'cloud today totalM=' + (cloud && cloud.days && cloud.days[todayKey] && cloud.days[todayKey].totalM));
    ok('M1 every day\u2019s total survives in the cloud copy',
      !!cloud && Object.keys(local.days).every(function (k) { return cloud.days[k] && cloud.days[k].totalM === local.days[k].totalM; }));
    const km = W.meta().keys.livemiles || {};
    ok('M1 the livemiles key SEALS (no longer dirty after the pushes)',
      (km.s || 0) >= (km.t || 0), 't=' + km.t + ' s=' + km.s);
    ok('M1 the local store keeps the FULL breadcrumb trail',
      W.get('livemiles').days[todayKey].crumbs.length === local.days[todayKey].crumbs.length,
      'local crumbs=' + W.get('livemiles').days[todayKey].crumbs.length);
  }

  /* ---- M2: THE GEOLOADS CORRECTION ----
     Same machine count, the correction moved: the later record
     (corr -2, total 17) must replace the earlier (corr +1,
     total 20) in the cloud AND on the phone.                 */
  {
    const dayK = 'd2026-10-30';
    const cloudRec = { key: dayK, date: '2026-10-30', count: 19, corr: 1, updatedAt: 1000, pegs: [] };
    const localRec = { key: dayK, date: '2026-10-30', count: 19, corr: -2, updatedAt: 2000, pegs: [] };
    const server = makeServer();
    serverSet(server, 'geoloads', { days: {} }, 5000);
    server.docs['geoloads'].v = { days: {} };
    server.docs['geoloads'].v.days[dayK] = cloudRec;
    const W = makeWorld(server, {
      local: [['geoloads', { days: {} }]],
      meta: { uid: 'u1', globallySynced: true, teleTp: { geoloads: 1 },
        keys: { geoloads: { t: 6000, s: 5000, u: 'u1' } } }
    });
    W.data['mt_geoloads'] = JSON.stringify({ days: { } });
    const gd = { days: {} }; gd.days[dayK] = localRec;
    W.data['mt_geoloads'] = JSON.stringify(gd);
    W.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(3600);
    const cloud = serverGet(server, 'geo' + 'loads');
    const cloudDay = cloud && cloud.days && cloud.days[dayK];
    ok('M2 the corrected day total (17) lands in the cloud',
      !!cloudDay && (cloudDay.count + cloudDay.corr) === 17 && cloudDay.corr === -2,
      'cloud day=' + JSON.stringify(cloudDay));
    const localDay = (W.get('geoloads') || { days: {} }).days[dayK];
    ok('M2 the phone is NOT re-taught the stale total (stays 17)',
      !!localDay && (localDay.count + localDay.corr) === 17 && localDay.corr === -2,
      'local day=' + JSON.stringify(localDay));
  }

  /* ---- M3: YOUNG-FRAGMENT PROTECTION (v224/v288 pin) ----
     A fresh engine's young snapshot (tiny total, newest stamp)
     must never beat the cloud's full day, on pull or push.    */
  {
    const dayK = 's1793000000000';
    const server = makeServer();
    const cloudDays = {}; cloudDays[dayK] = { key: dayK, date: '2026-10-31', totalM: 39361, crumbs: [{ t: 1, a: 51, o: -114 }], hasFix: true, updatedAt: 1000 };
    serverSet(server, 'livemiles', { days: cloudDays }, 5000);
    const localDays = {}; localDays[dayK] = { key: dayK, date: '2026-10-31', totalM: 667, crumbs: [{ t: 2, a: 51, o: -114 }], hasFix: true, updatedAt: 9999999 };
    const W = makeWorld(server, {
      local: [['livemiles', { days: localDays }]],
      meta: { uid: 'u1', globallySynced: true, teleTp: { livemiles: 1 },
        keys: { livemiles: { t: 6000, s: 5000, u: 'u1' } } }
    });
    W.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(3600);
    const cloud = serverGet(server, 'livemiles');
    ok('M3 the cloud keeps the full day (39,361 m)',
      !!(cloud && cloud.days[dayK] && cloud.days[dayK].totalM === 39361),
      'cloud=' + (cloud && cloud.days[dayK] && cloud.days[dayK].totalM));
    const local = W.get('livemiles');
    ok('M3 the local store heals UP to the full day',
      !!(local && local.days[dayK] && local.days[dayK].totalM === 39361),
      'local=' + (local && local.days[dayK] && local.days[dayK].totalM));
  }

  /* ---- M4: A TOTALS TIE MUST NOT STRIP THE TRAIL ----
     The cloud copy (thinned by the sync copy) ties the phone's
     total with a later stamp: the phone's richer trail wins.  */
  {
    const dayK = 's1793100000000';
    const full = crumbTrail(300, 1793100000000);
    const thin = crumbTrail(24, 1793100000000);
    const server = makeServer();
    const cloudDays = {}; cloudDays[dayK] = { key: dayK, date: '2026-10-31', totalM: 50000, crumbs: thin, hasFix: true, updatedAt: 2000 };
    serverSet(server, 'livemiles', { days: cloudDays }, 5000);
    const localDays = {}; localDays[dayK] = { key: dayK, date: '2026-10-31', totalM: 50000, crumbs: full, hasFix: true, updatedAt: 1000 };
    const W = makeWorld(server, {
      local: [['livemiles', { days: localDays }]],
      meta: { uid: 'u1', globallySynced: true, teleTp: { livemiles: 1 },
        keys: { livemiles: { t: 6000, s: 5000, u: 'u1' } } }
    });
    W.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(1200);
    const local = W.get('livemiles');
    ok('M4 the phone keeps its full 300-crumb trail after the pull',
      !!(local && local.days[dayK] && local.days[dayK].crumbs.length === 300),
      'crumbs=' + (local && local.days[dayK] && local.days[dayK].crumbs.length));
  }

  console.log('\nsync-stomp-v293 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
