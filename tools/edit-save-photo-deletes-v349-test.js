#!/usr/bin/env node
/* Meticulous v349 — EDIT-SAVE-PHOTO-DELETES-ENTRY (found Nov 5,
 * 23:23, during the receipt attach pass; TOP FUEL PRIORITY).
 *
 * Field evidence (the web app, account asjadkamal482): editing a
 * fill-up, attaching its receipt photo and saving REMOVED the
 * entry from the synced dataset — twice: Oct 14 (Mobil, 94.522 L,
 * $234.32, odo 168,751) and Oct 15 (Mobil, 78.175 L, $193.80, odo
 * 519,326). Each was present immediately after Save, then gone
 * from the Fuel list AND the Audit after the sync cycle / reload
 * (Audit 61 -> 60). The pass was stopped; Oct 13/16/22 untouched.
 *
 * Mechanism (js/cloudsync.js, traced): the lost records are
 * ID-LESS (recovery-era), so their sync identity is a fingerprint
 * of [date, time, litres, cost, station, odo]. The attach edit
 * let the receipt OCR supply the fill's TIME (fuReadTime) — a
 * fingerprint field the record did not carry — so the edited
 * copy bears a NEW identity while the old identity sits in the
 * editing session's shadow (km.sh: the last verified cloud
 * state). pendingRecordDeletes therefore names the old identity
 * a deliberate deletion. Inside mergeRecordLists the stale cloud
 * copy is offered first and the edited local copy pairs with it
 * via fuelSameFill; fuelCopyWins is then asked to arbitrate with
 * doomed = {oldId}. Its own comment states the law: "rec wins
 * exactly when cur is the doomed one" — but the code returns
 * `rd` (whether the CANDIDATE is doomed) instead of `cd`
 * (whether the INCUMBENT is). With cur = the doomed stale copy
 * and rec = the clean edit, it returns false: the stale copy
 * keeps the slot, still carrying the doomed identity — and
 * mergeRecordLists3's final filter then removes it as a
 * deliberate deletion. The union comes out WITHOUT the fill at
 * all; the push carries the loss up and the local store learns
 * it back. One inverted return, and an edit + attach deletes
 * the record on the first merge after the save.
 *
 * The fix is that return: `return cd;` — the doomed copy yields
 * to its same-fill sibling exactly as both v293 comments (in
 * fuelCopyWins and in mergeRecordLists3) already describe. A
 * TRUE delete carries no sibling: the cloud copy is offered,
 * never paired, and the filter still removes it (case E2 pins
 * this). Edits that keep their fingerprint (E3) and id-born
 * fills (E4) never reach the branch and are pinned as controls.
 *
 * Harness: the sync-stomp-v293 two-world pattern — the real
 * js/cloudsync.js against a stub Firestore that enforces the
 * real 1 MiB document limit. The editing session is modelled
 * WITH its shadow on record (Asjad's long-lived web profile —
 * not the fresh-profile case F1 of the v293 suite).
 *
 * Run: node tools/edit-save-photo-deletes-v349-test.js
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
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}

const FIRESTORE_LIMIT = 1048576;
function makeServer() { return { docs: {}, clock: 100000, rejected: [] }; }
function serverSet(server, id, v, updatedAt) { server.docs[id] = { id: id, v: v, updatedAt: updatedAt || (++server.clock) }; }
function serverGet(server, id) { const d = server.docs[id]; return d ? d.v : null; }

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
      if (size > FIRESTORE_LIMIT) { server.rejected.push({ id: id, size: size }); return Promise.reject(new Error('Firestore: document too large')); }
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

/* recordIdentity('fuel_fills', rec) for an id-less fill, built
   exactly as the engine builds it (fields in order, JSON values,
   missing -> null) so the preset shadows name the real ids. */
function fp(rec) {
  return 'fp:' + ['date', 'time', 'litres', 'cost', 'station', 'odo'].map(function (k) {
    return k + '=' + JSON.stringify(rec[k] === undefined ? null : rec[k]);
  }).join('|');
}
function metaWithShadow(recs) {
  return { uid: 'u1', globallySynced: true, keys: { fuel_fills: { t: 4000, s: 4000, u: 'u1', sh: recs.map(fp) } } };
}

/* the book: an earlier fill + the two lost records, as recovered
   (id-less; Oct 14 carries NO time — the fact the OCR supplied) */
const EARLIER = { date: '2026-10-13', time: '08:15', litres: '88.100', cost: '212.40', station: 'Mobil', odo: 168510, profileId: 'p1' };
const OLD14 = { date: '2026-10-14', litres: '94.522', cost: '234.32', station: 'Mobil', odo: 168751, profileId: 'p1' };
const OLD15 = { date: '2026-10-15', time: '11:03', litres: '78.175', cost: '193.80', station: 'Mobil', odo: 519326, profileId: 'p1' };
const PHOTO = 'data:image/jpeg;base64,RECEIPT14';
/* the Oct 14 edit as fuel.js saves it: applyFillEdit copies the
   record, the OCR read stamps its time (+ price/address ride
   along — not fingerprint fields), the fresh photo attaches,
   updAt versions it. */
const EDIT14 = { date: '2026-10-14', litres: '94.522', cost: '234.32', station: 'Mobil', odo: 168751, profileId: 'p1', time: '17:32', pricePerLitre: '2.479', address: '3633 Westwinds Dr NE', photo: PHOTO, updAt: 1792000000000 };

function onDate(arr, d) { return (arr || []).filter(function (f) { return f && f.date === d; }); }

(async function () {
  /* ---- E1: THE INCIDENT — a shadow-holding session edits an
     id-less fill; the OCR-supplied time moves its fingerprint.
     The fill must survive its own save's sync cycle, in the
     cloud, in the editing session, and on a fresh reload. ---- */
  console.log('— E1: the incident (edit + attach on a shadow-holding session) —');
  {
    const server = makeServer();
    serverSet(server, 'fuel_fills', [EARLIER, OLD14, OLD15], 5000);
    const W = makeWorld(server, { local: [['fuel_fills', [EARLIER, OLD14, OLD15]]], meta: metaWithShadow([EARLIER, OLD14, OLD15]) });
    W.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    ok('E1 (setup) the session holds its shadow and the untouched book',
      (W.meta().keys.fuel_fills || {}).sh !== undefined && onDate(W.get('fuel_fills'), '2026-10-14').length === 1);
    W.store.set('fuel_fills', [EARLIER, EDIT14, OLD15]);
    await settle(3600); /* the debounced flush: read-merge-write */
    const cloud = serverGet(server, 'fuel_fills');
    ok('E1 the cloud still holds the Oct 14 fill after the edit\'s flush', onDate(cloud, '2026-10-14').length === 1,
      'cloud Oct14 count=' + onDate(cloud, '2026-10-14').length + ' (the record was DELETED by its own save)');
    const c14 = onDate(cloud, '2026-10-14')[0] || {};
    ok('E1 the surviving cloud copy is the EDIT (OCR time + receipt photo aboard)',
      c14.time === '17:32' && c14.photo === PHOTO, JSON.stringify(c14).slice(0, 160));
    ok('E1 the editing session\'s own book keeps the edited fill',
      onDate(W.get('fuel_fills'), '2026-10-14').length === 1 && (onDate(W.get('fuel_fills'), '2026-10-14')[0] || {}).photo === PHOTO);
    ok('E1 the untouched fills are untouched', onDate(cloud, '2026-10-13').length === 1 && onDate(cloud, '2026-10-15').length === 1);
    /* reload: a fresh session reads the cloud book */
    const R = makeWorld(server, {});
    R.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    ok('E1 after reload the fill is in the list the app reads',
      onDate(R.get('fuel_fills'), '2026-10-14').length === 1 && (onDate(R.get('fuel_fills'), '2026-10-14')[0] || {}).time === '17:32');
  }

  /* ---- E2: a TRUE delete (no sibling edit) stays deleted ---- */
  console.log('— E2: the deliberate delete the shadow exists for —');
  {
    const server = makeServer();
    serverSet(server, 'fuel_fills', [EARLIER, OLD14], 5000);
    const W = makeWorld(server, { local: [['fuel_fills', [EARLIER, OLD14]]], meta: metaWithShadow([EARLIER, OLD14]) });
    W.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    W.store.set('fuel_fills', [EARLIER]); /* the delete */
    await settle(3600);
    ok('E2 the deleted fill stays deleted in the cloud', onDate(serverGet(server, 'fuel_fills'), '2026-10-14').length === 0);
    ok('E2 the kept fill is unharmed', onDate(serverGet(server, 'fuel_fills'), '2026-10-13').length === 1);
  }

  /* ---- E3: control — an edit that keeps its fingerprint
     (photo only; the time was already on the record) ---- */
  console.log('— E3: control, fingerprint-stable edit —');
  {
    const server = makeServer();
    serverSet(server, 'fuel_fills', [EARLIER, OLD15], 5000);
    const W = makeWorld(server, { local: [['fuel_fills', [EARLIER, OLD15]]], meta: metaWithShadow([EARLIER, OLD15]) });
    W.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    const EDIT15 = { date: '2026-10-15', time: '11:03', litres: '78.175', cost: '193.80', station: 'Mobil', odo: 519326, profileId: 'p1', photo: PHOTO, updAt: 1792000000000 };
    W.store.set('fuel_fills', [EARLIER, EDIT15]);
    await settle(3600);
    const c15 = onDate(serverGet(server, 'fuel_fills'), '2026-10-15');
    ok('E3 the photo-only edit survives as one copy, photo aboard', c15.length === 1 && c15[0].photo === PHOTO);
  }

  /* ---- E4: control — an id-born fill edited across fields ---- */
  console.log('— E4: control, id-born fill —');
  {
    const server = makeServer();
    const IDFILL = { id: 'fuabc123', date: '2026-10-16', time: '09:41', litres: '50.000', cost: '120.00', station: 'Shell', odo: 169000, profileId: 'p1', updAt: 1000 };
    serverSet(server, 'fuel_fills', [EARLIER, IDFILL], 5000);
    const W = makeWorld(server, { local: [['fuel_fills', [EARLIER, IDFILL]]], meta: metaWithShadow([EARLIER]) });
    W.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    const IDEDIT = { id: 'fuabc123', date: '2026-10-16', time: '09:41', litres: '51.250', cost: '123.00', station: 'Shell', odo: 169000, profileId: 'p1', photo: PHOTO, updAt: 1792000000000 };
    W.store.set('fuel_fills', [EARLIER, IDEDIT]);
    await settle(3600);
    const c16 = onDate(serverGet(server, 'fuel_fills'), '2026-10-16');
    ok('E4 the id-born edit survives as one copy with the new figures', c16.length === 1 && String(c16[0].litres) === '51.250' && c16[0].photo === PHOTO);
  }

  /* ---- ship pins ---- */
  const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
  const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok('webVersion is 349', ver.webVersion === 349, 'got ' + ver.webVersion);
  ok('index.html pins cloudsync.js?v=349', idxSrc.indexOf('js/cloudsync.js?v=349') >= 0);

  console.log('\nedit-save-photo-deletes-v349: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL suite threw: ' + (e && e.stack || e)); process.exit(1); });
