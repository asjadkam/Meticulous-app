#!/usr/bin/env node
/* Meticulous — FUEL-HISTORY-LOST-RECURRENCE (the v241 fix did
 * not hold; owner, Mon Oct 26, 2026 17:37 MDT, his screenshot:
 * the Fill-ups list stops at 2026-10-19 AGAIN — the Oct 20 fill
 * (104.036 L · $239.18, in the app on Oct 20 itself, his 19:51
 * screenshot that evening) and both Oct 22 fills are gone from
 * the phone AND from the account's cloud copy).
 *
 * The mechanism, in js/cloudsync.js as shipped (v241–v270):
 *   (1) THE DIRTY-CYCLE HOLE (pull side). The v241 record-union
 *       branch runs only while the local key is SETTLED
 *       (!localDirty). A record-list key is dirty from the moment
 *       a record is saved until its push is confirmed — seconds
 *       on a good connection, indefinitely when flushes fail on
 *       fringe signal (the v136 header documents pushes failing
 *       repeatedly through his working days). In every dirty
 *       cycle the key falls through to the generic whole-key
 *       stamp war, and when the cloud stamp is newer the local
 *       list is REPLACED wholesale and the meta sealed clean:
 *       every record the cloud copy lacks is deleted from the
 *       device and can never come back.
 *   (2) THE BLIND OVERWRITE (push side). pushOne writes the
 *       local array over the cloud doc unconditionally — no
 *       read, no merge. Any store instance holding an older
 *       array (the same account on the web origin is a second
 *       store instance over the same cloud tree, with its own
 *       localStorage and sync meta) that pushes after the real
 *       saves stamps the doc NEWER while rolling its content
 *       BACK. That rolled-back-but-fresher copy is precisely
 *       what (1) then installs over the phone's fuller list.
 *   The v241 suite preset settled metas in every case, so the
 *   union always fired there; in the field the two halves meet.
 *
 * The fix: record-list keys merge on BOTH sides of the sync.
 *   - The pull union runs in dirty cycles too. Deliberate local
 *     deletions stay deleted via a per-key SHADOW (km.sh): the
 *     record identities of the last cloud state this device
 *     verified. An identity in the shadow, absent locally, still
 *     present in the cloud = deleted here on purpose — it is
 *     filtered out of the union and out of the next push.
 *   - pushOne for a record-list key is READ-MERGE-WRITE: it
 *     reads the cloud doc, unions it with the local array
 *     (same shadow rule), writes the union, and learns any
 *     cloud-only records into the local store. If the read
 *     fails the push fails honestly (key stays dirty, retried)
 *     — an append-only list is never blind-overwritten.
 *   - With no shadow on record (first cycle after this build),
 *     the merge is the plain v241 union: appends can never be
 *     lost; a delete made in that first cycle may need one
 *     repeat — visible and recoverable, never silent loss.
 *
 * Cases: R1 the incident replayed (dirty saves + rolled-back
 * fresher cloud) · R2 the blind-overwrite push · R3 a pending
 * delete must stay deleted (this case is GREEN on the old code
 * by stamp luck and RED under a naive guard-drop — it pins the
 * shadow law) · R4 dirty append vs a genuinely newer cloud
 * record · R5 first cycle after upgrade (no shadow) · R6 a
 * signed PTI beats its bare cloud twin in a dirty cycle.
 *
 * Run: node tools/fuel-history-recurrence-v272-test.js
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
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}

/* record identities, mirroring recordIdentity() in cloudsync.js */
function fuelId(rec) {
  const fields = ['date', 'time', 'litres', 'cost', 'station', 'odo'];
  return 'fp:' + fields.map(function (k) {
    return k + '=' + JSON.stringify(rec[k] === undefined ? null : rec[k]);
  }).join('|');
}

function makeWorld(opts) {
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
  const world = { sb: sb, data: data, pushes: [], cloudDocs: opts.docs || [], serverClock: 9000 };
  sb.FB = {
    ready: true,
    user: { uid: 'u1' },
    loadDocs: function () { return Promise.resolve(world.cloudDocs.map(function (d) { return { id: d.id, v: d.v, updatedAt: d.updatedAt }; })); },
    saveDoc: function (col, id, doc) {
      world.pushes.push({ id: id, v: doc.v });
      /* the write lands on the "server": later reads see it */
      const stamp = ++world.serverClock * 1000;
      let found = false;
      world.cloudDocs = world.cloudDocs.map(function (d) {
        if (d.id === id) { found = true; return { id: id, v: doc.v, updatedAt: stamp }; }
        return d;
      });
      if (!found) world.cloudDocs.push({ id: id, v: doc.v, updatedAt: stamp });
      return Promise.resolve({});
    },
    deleteDoc: function () { return Promise.resolve({}); }
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
  world.lastPush = function (id) {
    const ps = world.pushes.filter(function (p) { return p.id === id; });
    return ps.length ? ps[ps.length - 1].v : null;
  };
  return world;
}
function settle(ms) { return new Promise(function (r) { setTimeout(r, ms || 600); }); }

/* his real fills (day records) */
const F_OCT19 = { date: '2026-10-19', litres: 90.259, cost: 206.60, station: 'Petro-Canada', odo: 169531 };
const F_OCT20 = { date: '2026-10-20', litres: 104.036, cost: 239.18, station: 'Petro-Canada', odo: 169775 };
const F_OCT22A = { date: '2026-10-22', time: '12:47', litres: 99.047, cost: 239.59, station: 'Petro-Canada Roadking', odo: 169999 };
const F_OCT22B = { date: '2026-10-22', time: '17:13', litres: 38.970, cost: 86.86, station: 'Mobil @ 1739', odo: 170079 };

(async function () {
  /* ---- R1: THE INCIDENT — unflushed saves meet a rolled-back,
         fresher-stamped cloud copy at pull time ---- */
  {
    const w = makeWorld({
      local: [['fuel_fills', [F_OCT19, F_OCT20, F_OCT22A, F_OCT22B]]],
      meta: { uid: 'u1', keys: { fuel_fills: { t: 2000, s: 1000, u: 'u1', sh: [fuelId(F_OCT19)] } } },
      docs: [{ id: 'fuel_fills', v: [F_OCT19], updatedAt: 3000 }] /* rolled back, newer stamp */
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const fills = w.get('fuel_fills') || [];
    eq('R1 all four fills survive the pull', fills.length, 4);
    ok('R1 the Oct 20 fill is still there', fills.some(function (f) { return f.cost === 239.18; }));
    ok('R1 both Oct 22 fills are still there',
      fills.some(function (f) { return f.cost === 239.59; }) && fills.some(function (f) { return f.cost === 86.86; }));
    const pushed = w.lastPush('fuel_fills');
    ok('R1 the union pushes UP (the cloud copy heals too)',
      Array.isArray(pushed) && pushed.length === 4, JSON.stringify(pushed && pushed.length));
  }

  /* ---- R2: THE BLIND OVERWRITE — a push must not roll the
         cloud back over records another instance added ---- */
  {
    const w = makeWorld({
      local: [['fuel_fills', [F_OCT19]]],
      meta: { uid: 'u1', keys: { fuel_fills: { t: 1000, s: 1000, u: 'u1', sh: [fuelId(F_OCT19)] } } },
      docs: [{ id: 'fuel_fills', v: [F_OCT19], updatedAt: 1000 }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    /* another store instance adds the Oct 22 Mobil fill to the
       cloud after this device's pull (its next pull is a minute
       away — MIN_PULL_GAP — but the user saves a fill NOW) */
    w.cloudDocs = [{ id: 'fuel_fills', v: [F_OCT19, F_OCT22B], updatedAt: 5000 }];
    w.store.set('fuel_fills', [F_OCT19, F_OCT20]); /* his save; the debounced flush pushes it */
    await settle(3600);
    const pushed = w.lastPush('fuel_fills');
    ok('R2 the pushed doc keeps the other instance\u2019s fill',
      Array.isArray(pushed) && pushed.some(function (f) { return f.cost === 86.86; }),
      JSON.stringify(pushed));
    ok('R2 the pushed doc carries his new fill too',
      Array.isArray(pushed) && pushed.some(function (f) { return f.cost === 239.18; }));
    const fills = w.get('fuel_fills') || [];
    eq('R2 the local store learns the cloud-only fill at push time', fills.length, 3);
  }

  /* ---- R3: A PENDING DELETE STAYS DELETED — the shadow law.
         (Green on the old code by stamp luck; red under a naive
         union-everything fix. Pins what the fix must preserve.) ---- */
  {
    const w = makeWorld({
      local: [['fuel_fills', [F_OCT19]]], /* F_OCT20 deleted here, not yet flushed */
      meta: { uid: 'u1', keys: { fuel_fills: { t: 3000, s: 1000, u: 'u1', sh: [fuelId(F_OCT19), fuelId(F_OCT20)] } } },
      docs: [{ id: 'fuel_fills', v: [F_OCT19, F_OCT20], updatedAt: 2000 }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    eq('R3 the deleted fill is NOT resurrected by the pull', (w.get('fuel_fills') || []).length, 1);
    const pushed = w.lastPush('fuel_fills');
    ok('R3 the delete propagates UP (the pushed doc lacks it too)',
      Array.isArray(pushed) && pushed.length === 1 && pushed[0].cost === 206.60,
      JSON.stringify(pushed));
  }

  /* ---- R4: DIRTY APPEND vs A GENUINELY NEWER CLOUD RECORD —
         both sides keep everything ---- */
  {
    const w = makeWorld({
      local: [['fuel_fills', [F_OCT19, F_OCT20]]],
      meta: { uid: 'u1', keys: { fuel_fills: { t: 2000, s: 1000, u: 'u1', sh: [fuelId(F_OCT19)] } } },
      docs: [{ id: 'fuel_fills', v: [F_OCT19, F_OCT22B], updatedAt: 3000 }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const fills = w.get('fuel_fills') || [];
    eq('R4 the union holds all three fills', fills.length, 3);
    ok('R4 his unflushed fill survives', fills.some(function (f) { return f.cost === 239.18; }));
    ok('R4 the cloud\u2019s newer fill comes down', fills.some(function (f) { return f.cost === 86.86; }));
  }

  /* ---- R5: FIRST CYCLE AFTER UPGRADE — no shadow on record;
         appends still cannot be lost ---- */
  {
    const w = makeWorld({
      local: [['fuel_fills', [F_OCT19, F_OCT20, F_OCT22A, F_OCT22B]]],
      meta: { uid: 'u1', keys: { fuel_fills: { t: 2000, s: 1000, u: 'u1' } } },
      docs: [{ id: 'fuel_fills', v: [F_OCT19], updatedAt: 3000 }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    eq('R5 all four fills survive with no shadow recorded', (w.get('fuel_fills') || []).length, 4);
  }

  /* ---- R6: PTI — the signed copy beats the bare cloud twin in
         a dirty cycle too ---- */
  {
    const signed = { id: 'pti1', date: '2026-10-22', signed: true, signedName: 'Asjad Kamal',
      signature: 'data:image/jpeg;base64,SIG', plate: '04 R209', odometer: 170079 };
    const bare = { id: 'pti1', date: '2026-10-22', signed: true, signedName: 'Asjad Kamal',
      signature: '', plate: '', odometer: 170079 };
    const w = makeWorld({
      local: [['pti_reports', [signed]]],
      meta: { uid: 'u1', keys: { pti_reports: { t: 2000, s: 1000, u: 'u1', sh: ['id:pti1'] } } },
      docs: [{ id: 'pti_reports', v: [bare], updatedAt: 3000 }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const reps = w.get('pti_reports') || [];
    eq('R6 the report survives', reps.length, 1);
    eq('R6 the surviving copy carries the signature', reps[0] && reps[0].signature, 'data:image/jpeg;base64,SIG');
    eq('R6 the surviving copy carries the plate', reps[0] && reps[0].plate, '04 R209');
  }

  console.log('\nfuel-history-recurrence test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
