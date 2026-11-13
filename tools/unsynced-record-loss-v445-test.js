#!/usr/bin/env node
/* Meticulous v445 — UNSYNCED-RECORD-LOSS-NOV12.
 *
 * Owner evidence (Nov 12, 2026, evening): a browser session
 * created today's fuel entry (Mobil Westwinds, 63.370 L,
 * $133.65, odo 172,903) on the owner's account and verified it
 * in the Fuel list. The entry had never backed up — Advanced
 * showed "Sync problem — a fuel entry hasn't backed up" (local
 * book larger than the cloud's). "Retry sync now" then
 * reported "All synced", and after a reload the entry was
 * GONE: Dashboard and Fuel showed only the previous day's
 * fill, and the list + Fuel Audit held the cloud's records
 * only. The un-backed-up local record was discarded somewhere
 * in the sync/reload cycle instead of merging UP.
 *
 * THE LAW (owner's standing data law, the revenue-union
 * family): a record created on any surface that has not
 * backed up yet must NEVER be discarded by a sync, pull,
 * reload or store migration. Unsynced local records merge UP
 * by union; if a record genuinely cannot be pushed, the app
 * keeps it locally, keeps retrying, and says so — "All
 * synced" only when no local record is waiting.
 *
 * This suite replays the night exactly, for every record-list
 * book that shares the store/sync path:
 *   A  fuel_fills (id-born entry — tonight's shape): pushed
 *      transport dead -> entry survives pulls -> retry lands
 *      it in the cloud -> reload + fresh device keep it.
 *   B  fuel_fills (id-less entry, fingerprint identity).
 *   C  fuel_expenses: unsynced local expense vs a cloud doc
 *      another device re-stamped NEWER — pull must union,
 *      never replace; push must read-merge-write, never
 *      blind-overwrite the other device's record away.
 *   D  dsp_list: an unsynced local dispatch vs a newer cloud
 *      stamp — same union law.
 *   E  inv_list: an unsynced local invoice — same law.
 *   F  No-duplicate guard: the same record on both sides
 *      stays exactly one record.
 *   G  Deliberate deletes still die (shadow law) on every
 *      unioned key — the union must not resurrect them.
 *   H  Honesty: while a record waits unbacked-up through
 *      repeated failed pushes, the status never reads ok.
 *
 * Run: node tools/unsynced-record-loss-v445-test.js
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
function settle(ms) { return new Promise(function (r) { setTimeout(r, ms || 350); }); }

/* ---------------- a stateful fake cloud + reloadable sessions ---------------- */
function makeCloud() {
  return { docs: {} }; // key -> { v, del, updatedAt }
}
function cloudSet(cloud, key, v, updatedAt, del) {
  cloud.docs[key] = { v: JSON.parse(JSON.stringify(v)), del: del || {}, updatedAt: updatedAt };
}
function cloudGet(cloud, key) {
  const d = cloud.docs[key];
  return d ? JSON.parse(JSON.stringify(d.v)) : null;
}

function makeSession(data, cloud, transport) {
  const localStorage = {
    getItem: function (k) { return (k in data) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    removeItem: function (k) { delete data[k]; },
    key: function (i) { return Object.keys(data)[i] || null; },
    get length() { return Object.keys(data).length; }
  };
  const sb = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, Promise: Promise };
  sb.window = sb;
  sb.localStorage = localStorage;
  sb.navigator = { onLine: true };
  sb.document = { getElementById: function () { return null; }, addEventListener: function () {} };
  sb.addEventListener = function () {};
  sb.FB = {
    ready: true,
    user: { uid: 'u1' },
    loadDocs: function () {
      if (transport.failPull) return Promise.reject(new Error('pull transport down'));
      return Promise.resolve(Object.keys(cloud.docs).map(function (k) {
        const d = cloud.docs[k];
        return { id: k, mt: k, v: JSON.parse(JSON.stringify(d.v)), del: JSON.parse(JSON.stringify(d.del || {})), updatedAt: d.updatedAt };
      }));
    },
    loadDoc: function (col, id) {
      if (transport.failPull) return Promise.reject(new Error('pull transport down'));
      const d = cloud.docs[id];
      if (!d) return Promise.resolve(null);
      return Promise.resolve({ id: id, mt: id, v: JSON.parse(JSON.stringify(d.v)), del: JSON.parse(JSON.stringify(d.del || {})), updatedAt: d.updatedAt });
    },
    saveDoc: function (col, id, payload) {
      if (transport.failPush) return Promise.reject(new Error('push transport down'));
      cloud.docs[id] = {
        v: JSON.parse(JSON.stringify(payload.v)),
        del: payload.del ? JSON.parse(JSON.stringify(payload.del)) : (cloud.docs[id] ? cloud.docs[id].del : {}),
        updatedAt: Date.now()
      };
      return Promise.resolve({});
    },
    deleteDoc: function (col, id) {
      if (transport.failPush) return Promise.reject(new Error('push transport down'));
      delete cloud.docs[id];
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
  return {
    sb: sb, CS: sb.CloudSync, store: store,
    get: function (k) { const r = localStorage.getItem('mt_' + k); return r === null ? null : JSON.parse(r); },
    signIn: function () { sb.CloudSync.onAuth({ uid: 'u1' }); }
  };
}
function hasRec(arr, pred) { return (arr || []).some(pred); }
/* cloudsync spaces repeat pulls out (60 s / 10 min gaps); a
   bench that must force the next cycle zeroes the clock —
   the same state a fresh page session starts from. */
function forcePull(s) { s.CS.lastPullAt = 0; return s.CS.pull(); }
function forceSync(s) { s.CS.lastPullAt = 0; return s.CS.syncNow(); }
function countRec(arr, pred) { return (arr || []).filter(pred).length; }

/* his real-shaped records */
const F1 = { id: 'fuA1', date: '2026-11-10', time: '08:12', litres: 95.5, cost: 201.40, station: 'Shell', odo: 172400, updAt: 100 };
const F2 = { id: 'fuA2', date: '2026-11-11', time: '17:02', litres: 110.292, cost: 239.22, station: 'Shell', odo: 172726, updAt: 200 };
const F_NEW = { id: 'fuNEW', date: '2026-11-12', time: '17:08', litres: 63.370, cost: 133.65, station: 'Mobil Westwinds (3633 Westwinds Dr NE, Calgary)', odo: 172903, updAt: 300 };
const F_NEW_NOID = { date: '2026-11-12', time: '17:08', litres: 63.370, cost: 133.65, station: 'Mobil Westwinds', odo: 172903, updAt: 300 };
const X1 = { date: '2026-11-10', what: 'Mud flaps', cost: 84.00 };
const X2 = { date: '2026-11-11', what: 'Washer fluid', cost: 12.50 };
const X_NEW = { date: '2026-11-12', what: 'Diesel additive', cost: 21.99 };
const D1 = { id: 'dsp1', date: '2026-11-12', client: 'Aecon Trans', status: 'completed' };
const D2 = { id: 'dsp2', date: '2026-11-13', client: 'Aecon Trans', status: 'open' };
const I1 = { id: 'inv1', no: 41, date: '2026-11-01', total: 2102.50 };
const I_NEW = { id: 'inv2', no: 42, date: '2026-11-12', total: 261.00 };

(async function () {
  /* ================= A: fuel_fills, tonight's replay ================= */
  console.log('A — fuel_fills: unbacked entry vs dead transport, retry, reload');
  {
    const data = {}, cloud = makeCloud(), transport = { failPush: false, failPull: false };
    data['mt_fuel_fills'] = JSON.stringify([F1, F2]);
    cloudSet(cloud, 'fuel_fills', [F1, F2], Date.now() - 60000);
    const s = makeSession(data, cloud, transport);
    s.signIn(); await settle(600);
    ok('A0 settled world: status ok', s.CS.status().state === 'ok', s.CS.status().state);

    /* the pump save, with the push transport dead */
    transport.failPush = true;
    s.store.set('fuel_fills', [F1, F2, F_NEW]);
    s.CS.flush(); await settle();
    s.CS.flush(); await settle();
    ok('A1 entry is in the local list', hasRec(s.get('fuel_fills'), function (r) { return r.id === 'fuNEW'; }));
    ok('A2 status is NOT ok while the entry waits (honesty)', s.CS.status().state === 'err', s.CS.status().state);

    /* a pull/reload cycle while it still cannot back up */
    await forceSync(s); await settle();
    ok('A3 entry survives a pull while unbacked-up', hasRec(s.get('fuel_fills'), function (r) { return r.id === 'fuNEW'; }),
      JSON.stringify(s.get('fuel_fills')));

    /* Retry sync now — transport healed */
    transport.failPush = false;
    await forceSync(s); await settle();
    ok('A4 entry landed in the cloud copy', hasRec(cloudGet(cloud, 'fuel_fills'), function (r) { return r.id === 'fuNEW'; }),
      JSON.stringify(cloudGet(cloud, 'fuel_fills')));
    ok('A5 entry still in the local list after the retry', hasRec(s.get('fuel_fills'), function (r) { return r.id === 'fuNEW'; }));
    ok('A6 status ok only now', s.CS.status().state === 'ok', s.CS.status().state);

    /* reload: a fresh page session over the same store */
    const s2 = makeSession(data, cloud, transport);
    s2.signIn(); await settle(600);
    ok('A7 entry survives the reload', hasRec(s2.get('fuel_fills'), function (r) { return r.id === 'fuNEW'; }));
    ok('A8 exactly one copy after reload', countRec(s2.get('fuel_fills'), function (r) { return r.id === 'fuNEW'; }) === 1);

    /* fresh device: empty store, same cloud */
    const data3 = {};
    const s3 = makeSession(data3, cloud, transport);
    s3.signIn(); await settle(600);
    ok('A9 fresh device pulls the entry down', hasRec(s3.get('fuel_fills'), function (r) { return r.id === 'fuNEW'; }),
      JSON.stringify(s3.get('fuel_fills')));
  }

  /* ================= B: fuel_fills, id-less entry ================= */
  console.log('B — fuel_fills: id-less (fingerprint) entry');
  {
    const data = {}, cloud = makeCloud(), transport = { failPush: false, failPull: false };
    data['mt_fuel_fills'] = JSON.stringify([F1, F2]);
    cloudSet(cloud, 'fuel_fills', [F1, F2], Date.now() - 60000);
    const s = makeSession(data, cloud, transport);
    s.signIn(); await settle(600);
    transport.failPush = true;
    s.store.set('fuel_fills', [F1, F2, F_NEW_NOID]);
    await forceSync(s); await settle();
    ok('B1 id-less entry survives a pull while unbacked-up',
      hasRec(s.get('fuel_fills'), function (r) { return r.date === '2026-11-12' && r.odo === 172903; }),
      JSON.stringify(s.get('fuel_fills')));
    transport.failPush = false;
    await forceSync(s); await settle();
    ok('B2 id-less entry landed in the cloud',
      hasRec(cloudGet(cloud, 'fuel_fills'), function (r) { return r.date === '2026-11-12' && r.odo === 172903; }));
    ok('B3 exactly one copy in the cloud',
      countRec(cloudGet(cloud, 'fuel_fills'), function (r) { return r.date === '2026-11-12' && r.odo === 172903; }) === 1);
  }

  /* ================= C: fuel_expenses ================= */
  console.log('C — fuel_expenses: unsynced local record vs newer cloud stamp');
  {
    const data = {}, cloud = makeCloud(), transport = { failPush: false, failPull: false };
    data['mt_fuel_expenses'] = JSON.stringify([X1]);
    cloudSet(cloud, 'fuel_expenses', [X1], Date.now() - 60000);
    const s = makeSession(data, cloud, transport);
    s.signIn(); await settle(600);
    /* the phone adds X2 and re-stamps the cloud doc NEWER than any local stamp */
    cloudSet(cloud, 'fuel_expenses', [X1, X2], Date.now() + 3600000);
    /* this device adds X_NEW, unsynced */
    s.store.set('fuel_expenses', [X1, X_NEW]);
    await forcePull(s); await settle();
    const loc = s.get('fuel_expenses');
    ok('C1 pull unions: local record survives', hasRec(loc, function (r) { return r.what === 'Diesel additive'; }), JSON.stringify(loc));
    ok('C2 pull unions: the other device record lands', hasRec(loc, function (r) { return r.what === 'Washer fluid'; }), JSON.stringify(loc));
    await forceSync(s); await settle();
    const cl = cloudGet(cloud, 'fuel_expenses');
    ok('C3 push merges up: cloud holds all three',
      hasRec(cl, function (r) { return r.what === 'Diesel additive'; }) &&
      hasRec(cl, function (r) { return r.what === 'Washer fluid'; }) &&
      hasRec(cl, function (r) { return r.what === 'Mud flaps'; }), JSON.stringify(cl));
    ok('C4 no duplicates in the cloud', (cl || []).length === 3, JSON.stringify(cl));
  }
  console.log('C2 — fuel_expenses: stale device flush must not roll the cloud back');
  {
    const data = {}, cloud = makeCloud(), transport = { failPush: false, failPull: false };
    data['mt_fuel_expenses'] = JSON.stringify([X1]);
    cloudSet(cloud, 'fuel_expenses', [X1], Date.now() - 60000);
    const s = makeSession(data, cloud, transport);
    s.signIn(); await settle(600);
    cloudSet(cloud, 'fuel_expenses', [X1, X2], Date.now() + 3600000);
    s.store.set('fuel_expenses', [X1, X_NEW]);
    s.CS.flush(); await settle(); // flush WITHOUT a pull first
    const cl = cloudGet(cloud, 'fuel_expenses');
    ok('C5 read-merge-write: cloud keeps the phone record',
      hasRec(cl, function (r) { return r.what === 'Washer fluid'; }), JSON.stringify(cl));
    ok('C6 read-merge-write: cloud gains the local record',
      hasRec(cl, function (r) { return r.what === 'Diesel additive'; }), JSON.stringify(cl));
    ok('C7 local store learned the union too',
      hasRec(s.get('fuel_expenses'), function (r) { return r.what === 'Washer fluid'; }));
  }

  /* ================= D: dsp_list ================= */
  console.log('D — dsp_list: unsynced local dispatch vs newer cloud stamp');
  {
    const data = {}, cloud = makeCloud(), transport = { failPush: false, failPull: false };
    data['mt_dsp_list'] = JSON.stringify([D1]);
    cloudSet(cloud, 'dsp_list', [D1], Date.now() - 60000);
    const s = makeSession(data, cloud, transport);
    s.signIn(); await settle(600);
    cloudSet(cloud, 'dsp_list', [D1], Date.now() + 3600000);
    s.store.set('dsp_list', [D1, D2]);
    await forcePull(s); await settle();
    ok('D1 unsynced dispatch survives the pull', hasRec(s.get('dsp_list'), function (r) { return r.id === 'dsp2'; }),
      JSON.stringify(s.get('dsp_list')));
    await forceSync(s); await settle();
    ok('D2 dispatch landed in the cloud', hasRec(cloudGet(cloud, 'dsp_list'), function (r) { return r.id === 'dsp2'; }));
    ok('D3 the completed dispatch is untouched',
      hasRec(s.get('dsp_list'), function (r) { return r.id === 'dsp1' && r.status === 'completed'; }));
  }

  /* ================= E: inv_list ================= */
  console.log('E — inv_list: unsynced local invoice vs newer cloud stamp');
  {
    const data = {}, cloud = makeCloud(), transport = { failPush: false, failPull: false };
    data['mt_inv_list'] = JSON.stringify([I1]);
    cloudSet(cloud, 'inv_list', [I1], Date.now() - 60000);
    const s = makeSession(data, cloud, transport);
    s.signIn(); await settle(600);
    cloudSet(cloud, 'inv_list', [I1], Date.now() + 3600000);
    s.store.set('inv_list', [I1, I_NEW]);
    await forcePull(s); await settle();
    ok('E1 unsynced invoice survives the pull', hasRec(s.get('inv_list'), function (r) { return r.id === 'inv2'; }),
      JSON.stringify(s.get('inv_list')));
    await forceSync(s); await settle();
    ok('E2 invoice landed in the cloud', hasRec(cloudGet(cloud, 'inv_list'), function (r) { return r.id === 'inv2'; }));
  }

  /* ================= F: no-duplicate guard ================= */
  console.log('F — the same record on both sides stays one record');
  {
    const data = {}, cloud = makeCloud(), transport = { failPush: false, failPull: false };
    data['mt_fuel_fills'] = JSON.stringify([F1, F2, F_NEW]);
    cloudSet(cloud, 'fuel_fills', [F1, F2, F_NEW], Date.now() - 60000);
    const s = makeSession(data, cloud, transport);
    s.signIn(); await settle(600);
    ok('F1 id record not duplicated by the pull',
      countRec(s.get('fuel_fills'), function (r) { return r.id === 'fuNEW'; }) === 1,
      JSON.stringify(s.get('fuel_fills')));
    const data2 = {}, cloud2 = makeCloud();
    data2['mt_fuel_fills'] = JSON.stringify([F1, F_NEW_NOID]);
    cloudSet(cloud2, 'fuel_fills', [F1, F_NEW_NOID], Date.now() - 60000);
    const s2 = makeSession(data2, cloud2, transport);
    s2.signIn(); await settle(600);
    ok('F2 id-less record not duplicated by the pull',
      countRec(s2.get('fuel_fills'), function (r) { return r.date === '2026-11-12' && r.odo === 172903; }) === 1,
      JSON.stringify(s2.get('fuel_fills')));
  }

  /* ================= S: the skew seal (tonight's mechanism) ================= */
  console.log('S — fuel_fills: cloud stamp AHEAD of this device clock');
  {
    const data = {}, cloud = makeCloud(), transport = { failPush: false, failPull: false };
    data['mt_fuel_fills'] = JSON.stringify([F1, F2]);
    cloudSet(cloud, 'fuel_fills', [F1, F2], Date.now() - 60000);
    const s = makeSession(data, cloud, transport);
    s.signIn(); await settle(600);
    /* the cloud doc gets re-stamped by the server/another
       device at a stamp this device's clock has not reached */
    cloudSet(cloud, 'fuel_fills', [F1, F2], Date.now() + 3600000);
    /* this device creates the entry, unsynced */
    s.store.set('fuel_fills', [F1, F2, F_NEW]);
    await forcePull(s); await settle();
    ok('S1 entry survives the skewed pull', hasRec(s.get('fuel_fills'), function (r) { return r.id === 'fuNEW'; }),
      JSON.stringify(s.get('fuel_fills')));
    await forceSync(s); await settle();
    ok('S2 the union still pushes UP under skew (no seal)',
      hasRec(cloudGet(cloud, 'fuel_fills'), function (r) { return r.id === 'fuNEW'; }),
      JSON.stringify(cloudGet(cloud, 'fuel_fills')));
    await settle(900);
    ok('S3 status ok only because the entry truly landed', s.CS.status().state === 'ok',
      s.CS.status().state + ' dirty=' + JSON.stringify(s.CS.status().durableDirty || []));
  }

  /* ================= G: deliberate deletes still die ================= */
  console.log('G — deliberate deletes stay deleted on every unioned key');
  async function deleteCase(key, base, victimPred, label) {
    const data = {}, cloud = makeCloud(), transport = { failPush: false, failPull: false };
    data['mt_' + key] = JSON.stringify(base);
    cloudSet(cloud, key, base, Date.now() - 60000);
    const s = makeSession(data, cloud, transport);
    s.signIn(); await settle(600);
    s.store.set(key, base.filter(function (r) { return !victimPred(r); }));
    await forceSync(s); await settle();
    ok(label + ': delete reached the cloud', !hasRec(cloudGet(cloud, key), victimPred), JSON.stringify(cloudGet(cloud, key)));
    const data2 = {};
    const s2 = makeSession(data2, cloud, transport);
    s2.signIn(); await settle(600);
    ok(label + ': fresh device does not resurrect it', !hasRec(s2.get(key), victimPred), JSON.stringify(s2.get(key)));
  }
  await deleteCase('fuel_fills', [F1, F2], function (r) { return r.id === 'fuA2'; }, 'G1 fuel_fills');
  await deleteCase('fuel_expenses', [X1, X2], function (r) { return r.what === 'Washer fluid'; }, 'G2 fuel_expenses');
  await deleteCase('dsp_list', [D1, D2], function (r) { return r.id === 'dsp2'; }, 'G3 dsp_list');
  await deleteCase('inv_list', [I1, I_NEW], function (r) { return r.id === 'inv2'; }, 'G4 inv_list');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('SUITE ERROR', e); process.exit(2); });
