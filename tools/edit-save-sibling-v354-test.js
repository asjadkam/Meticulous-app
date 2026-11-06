#!/usr/bin/env node
/* Meticulous v354 — EDIT-SAVE-STILL-EATS-SIBLING + the DEDUPE
 * LAW for the restore hazard.
 *
 * Field evidence (browser repair pass, Nov 5 23:50 – Nov 6
 * 00:00, live web 353): the Oct 14/15 fills deleted by the
 * original bug were re-added through the Add form with their
 * receipt photos (Audit 60 -> 62), then the phone's local book
 * healed the ORIGINALS back alongside the re-added copies
 * (62 -> 64): duplicates — the originals carry the fuller
 * station names and Oct 15's original its odometer (519,326;
 * the re-added copy lost it to the form's odometer guard).
 * Then the photo edits for Oct 16/13/22-Mobil each survived —
 * but after the Oct 22 Mobil edit + reload, the OTHER Oct 22
 * fill vanished: Petro-Canada (Roadking, 4949 Barlow Tr SE),
 * 99.047 L, $239.59, odo 169,999 (Audit 64 -> 63). Nobody
 * touched it.
 *
 * Root cause (js/cloudsync.js, fuelSameFill): two id-less
 * copies are "the same fill" when the date matches, times do
 * not conflict, and the odometers do not conflict — and the
 * odometer conflict was forgiven on the updAt stamp ALONE.
 * The edited Mobil (odo 170,079, updAt-stamped, OCR time
 * aboard) therefore "paired" with the day's other fill (Petro,
 * odo 169,999, no time on the record to veto the pairing),
 * won its slot on updAt inside mergeRecordLists' first-match
 * sibling scan, and the Petro was discarded into the Mobil's
 * slot; the stale Mobil identity was then filtered as a
 * deliberate deletion. One fill where the day had two.
 *
 * The fix, three parts:
 *  (1) fuelSameFill: an odometer conflict is forgiven ONLY
 *      when a second anchor survives — both copies carry the
 *      SAME time (the v293 odometer-correction shape, pinned
 *      by S2). Conflicting odometers + no shared time = two
 *      fills, full stop.
 *  (2) the sibling scan takes the BEST-anchored match (equal
 *      odometer, then equal time, then dedupe-key equality),
 *      not the first in array order.
 *  (3) the DEDUPE LAW: copies agreeing on date + litres +
 *      total fold into ONE record keeping the union of their
 *      fields (photos from either, fullest station name, an
 *      odometer if either has one) — at the pairing sites when
 *      the arbitration declares them one fill, and in a
 *      post-pass for pairs fuelSameFill cannot reach (an id
 *      on one copy). mergeRecordLists3 rescues a doomed
 *      identity that has a dedupe twin locally: it is a twin,
 *      not a deletion. Records with two different real ids
 *      never fold; copies disagreeing on BOTH anchors
 *      (odometer AND time) never fold (S5a), and deleting one
 *      of those stays deleted (S5b).
 *
 * Harness: the v349 two-world pattern — the real
 * js/cloudsync.js against a stub Firestore enforcing the real
 * 1 MiB document limit.
 *
 * Run: node tools/edit-save-sibling-v354-test.js
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
function fp(rec) {
  if (rec && rec.id) return 'id:' + rec.id;
  return 'fp:' + ['date', 'time', 'litres', 'cost', 'station', 'odo'].map(function (k) {
    return k + '=' + JSON.stringify(rec[k] === undefined ? null : rec[k]);
  }).join('|');
}
function metaWithShadow(recs) {
  return { uid: 'u1', globallySynced: true, keys: { fuel_fills: { t: 4000, s: 4000, u: 'u1', sh: recs.map(fp) } } };
}
function onDate(arr, d) { return (arr || []).filter(function (f) { return f && f.date === d; }); }

const EARLIER = { date: '2026-10-13', time: '08:15', litres: '88.100', cost: '212.40', station: 'Mobil', odo: 168510, profileId: 'p1' };
/* the Oct 22 pair, shaped exactly as the incident: two id-less
   fills, one day, different odometers; the Petro carries NO
   time (harvest-era record); the Mobil's attach edit gains the
   OCR time, the photo and the updAt stamp. */
const PETRO22 = { date: '2026-10-22', litres: '99.047', cost: '239.59', station: 'Petro-Canada', odo: 169999, profileId: 'p1' };
const MOBIL22_OLD = { date: '2026-10-22', litres: '38.970', cost: '86.86', station: 'Mobil @ 1739', odo: 170079, profileId: 'p1' };
const PHOTO22 = 'data:image/jpeg;base64,RECEIPT22MOBIL';
const MOBIL22_E = { date: '2026-10-22', time: '17:13', litres: '38.970', cost: '86.86', station: 'Mobil @ 1739', odo: 170079, profileId: 'p1', photo: PHOTO22, updAt: 1792000000000 };

(async function () {
  /* ---- S1: THE INCIDENT — editing one id-less fill must not
     eat its same-day sibling ---- */
  console.log('— S1: the Oct 22 incident —');
  {
    const server = makeServer();
    serverSet(server, 'fuel_fills', [EARLIER, PETRO22, MOBIL22_OLD], 5000);
    const W = makeWorld(server, { local: [['fuel_fills', [EARLIER, PETRO22, MOBIL22_OLD]]], meta: metaWithShadow([EARLIER, PETRO22, MOBIL22_OLD]) });
    W.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    ok('S1 (setup) the untouched day holds both fills', onDate(W.get('fuel_fills'), '2026-10-22').length === 2);
    W.store.set('fuel_fills', [EARLIER, PETRO22, MOBIL22_E]); /* the attach edit */
    await settle(3600);
    const cloud = serverGet(server, 'fuel_fills');
    const c22 = onDate(cloud, '2026-10-22');
    ok('S1 the cloud still holds BOTH Oct 22 fills after the edit\'s flush', c22.length === 2,
      'cloud Oct22 count=' + c22.length + ' (the Petro was EATEN by its sibling\'s edit)');
    const petro = c22.filter(function (f) { return String(f.litres) === '99.047'; })[0] || {};
    ok('S1 the Petro survives with its own figures', String(petro.cost) === '239.59' && petro.odo === 169999, JSON.stringify(petro).slice(0, 140));
    const mobil = c22.filter(function (f) { return String(f.litres) === '38.970'; })[0] || {};
    ok('S1 the edited Mobil survives with its photo', mobil.photo === PHOTO22 && mobil.time === '17:13');
    ok('S1 the editing session\'s own book holds both fills', onDate(W.get('fuel_fills'), '2026-10-22').length === 2);
    const R = makeWorld(server, {});
    R.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    ok('S1 after reload both fills are in the list the app reads', onDate(R.get('fuel_fills'), '2026-10-22').length === 2);
  }

  /* ---- S2: control — the v293 odometer-correction edit
     (updAt stamp, SAME time on both copies, odometer moved)
     still resolves to the corrected copy ---- */
  console.log('— S2: odometer-correction control —');
  {
    const OLD20 = { date: '2026-10-20', time: '09:05', litres: '80.000', cost: '190.00', station: 'Mobil', odo: 170000, profileId: 'p1' };
    const EDIT20 = { date: '2026-10-20', time: '09:05', litres: '80.000', cost: '190.00', station: 'Mobil', odo: 170050, profileId: 'p1', updAt: 1792000000000 };
    const server = makeServer();
    serverSet(server, 'fuel_fills', [OLD20], 5000);
    const W = makeWorld(server, { local: [['fuel_fills', [OLD20]]], meta: metaWithShadow([OLD20]) });
    W.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    W.store.set('fuel_fills', [EDIT20]);
    await settle(3600);
    const c = onDate(serverGet(server, 'fuel_fills'), '2026-10-20');
    ok('S2 the correction resolves to ONE record', c.length === 1, 'count=' + c.length);
    ok('S2 the corrected odometer is the one that survives', c.length === 1 && c[0].odo === 170050, JSON.stringify(c[0] || {}).slice(0, 140));
  }

  /* ---- S3: DEDUPE — the Oct 15 shape. The cloud holds the
     healed ORIGINAL (fuller station, odometer 519,326, no
     photo); the local book holds the Add-form copy (shorter
     station, odometer discarded by the form guard, photo
     aboard). They must resolve to ONE record with the union:
     photo + fullest station + the odometer. ---- */
  console.log('— S3: dedupe, the Oct 15 restore pair —');
  {
    const ORIG15 = { date: '2026-10-15', time: '17:55', litres: '78.175', cost: '193.80', station: 'Mobil @ 1739', odo: 519326, profileId: 'p1' };
    const PHOTO15 = 'data:image/jpeg;base64,RECEIPT15';
    const COPY15 = { date: '2026-10-15', time: '17:55', litres: '78.175', cost: '193.80', station: 'Mobil', profileId: 'p1', photo: PHOTO15, updAt: 1792000000000 };
    const server = makeServer();
    serverSet(server, 'fuel_fills', [ORIG15], 5000);
    const W = makeWorld(server, { local: [['fuel_fills', [COPY15]]], meta: metaWithShadow([ORIG15]) });
    W.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    const local = onDate(W.get('fuel_fills'), '2026-10-15');
    ok('S3 the pair resolves to ONE record locally', local.length === 1, 'count=' + local.length);
    const m = local[0] || {};
    ok('S3 the survivor keeps the photo', m.photo === PHOTO15);
    ok('S3 the survivor keeps the odometer the form discarded', m.odo === 519326, 'odo=' + m.odo);
    ok('S3 the survivor keeps the fullest station name', m.station === 'Mobil @ 1739', 'station=' + m.station);
    W.store.set('fuel_fills', W.get('fuel_fills'));
    await settle(3600);
    const cloud = onDate(serverGet(server, 'fuel_fills'), '2026-10-15');
    ok('S3 the cloud also holds exactly one, the union', cloud.length === 1 && cloud[0].odo === 519326 && cloud[0].photo === PHOTO15,
      'count=' + cloud.length + ' ' + JSON.stringify(cloud[0] || {}).slice(0, 140));
  }

  /* ---- S4: DEDUPE — the Oct 14 shape, where one copy carries
     an id (the Add form's birth stamp), which bars
     fuelSameFill outright; the post-pass must still fold
     them, and the survivor keeps the id + photo. ---- */
  console.log('— S4: dedupe, the Oct 14 restore pair (id on one copy) —');
  {
    const ORIG14 = { date: '2026-10-14', litres: '94.522', cost: '234.32', station: 'Mobil – 3633 Westwinds Dr, Calgary', odo: 168751, profileId: 'p1' };
    const PHOTO14 = 'data:image/jpeg;base64,RECEIPT14';
    const COPY14 = { id: 'fuRestore14', date: '2026-10-14', time: '17:32', litres: '94.522', cost: '234.32', station: 'Mobil', odo: 168751, profileId: 'p1', photo: PHOTO14, updAt: 1792000000000 };
    const server = makeServer();
    serverSet(server, 'fuel_fills', [ORIG14], 5000);
    const W = makeWorld(server, { local: [['fuel_fills', [COPY14]]], meta: metaWithShadow([ORIG14]) });
    W.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    const local = onDate(W.get('fuel_fills'), '2026-10-14');
    ok('S4 the pair resolves to ONE record locally', local.length === 1, 'count=' + local.length);
    const m = local[0] || {};
    ok('S4 the survivor keeps the id and the photo', m.id === 'fuRestore14' && m.photo === PHOTO14, JSON.stringify(m).slice(0, 160));
    ok('S4 the survivor keeps the fullest station name', m.station === 'Mobil – 3633 Westwinds Dr, Calgary', 'station=' + m.station);
    ok('S4 the survivor keeps the odometer and the time', m.odo === 168751 && m.time === '17:32');
  }

  /* ---- S5: two fills sharing figures but disagreeing on
     BOTH anchors are two fills: they never fold (S5a), and
     deleting one of them stays deleted despite the twin
     rescue (S5b) ---- */
  console.log('— S5: identical figures, two real fills —');
  {
    const A5 = { date: '2026-10-21', time: '08:00', litres: '50.000', cost: '120.00', station: 'Mobil', odo: 170000, profileId: 'p1' };
    const B5 = { date: '2026-10-21', time: '18:00', litres: '50.000', cost: '120.00', station: 'Shell', odo: 170300, profileId: 'p1' };
    const server = makeServer();
    serverSet(server, 'fuel_fills', [A5, B5], 5000);
    const W = makeWorld(server, { local: [['fuel_fills', [A5, B5]]], meta: metaWithShadow([A5, B5]) });
    W.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    W.store.set('fuel_fills', W.get('fuel_fills'));
    await settle(3600);
    ok('S5a both fills survive the merge unfolded', onDate(serverGet(server, 'fuel_fills'), '2026-10-21').length === 2,
      'count=' + onDate(serverGet(server, 'fuel_fills'), '2026-10-21').length);
    W.store.set('fuel_fills', [B5]); /* delete A5 */
    await settle(3600);
    const left = onDate(serverGet(server, 'fuel_fills'), '2026-10-21');
    ok('S5b deleting one of the pair stays deleted', left.length === 1 && left[0].odo === 170300,
      'count=' + left.length + ' ' + JSON.stringify(left).slice(0, 140));
  }

  /* ---- S6: a true delete with no twin anywhere stays
     deleted (the shadow law the twin rescue must not bend) ---- */
  console.log('— S6: true delete, no twin —');
  {
    const OLD14 = { date: '2026-10-14', litres: '94.522', cost: '234.32', station: 'Mobil', odo: 168751, profileId: 'p1' };
    const server = makeServer();
    serverSet(server, 'fuel_fills', [EARLIER, OLD14], 5000);
    const W = makeWorld(server, { local: [['fuel_fills', [EARLIER, OLD14]]], meta: metaWithShadow([EARLIER, OLD14]) });
    W.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    W.store.set('fuel_fills', [EARLIER]);
    await settle(3600);
    ok('S6 the deleted fill stays deleted', onDate(serverGet(server, 'fuel_fills'), '2026-10-14').length === 0);
    ok('S6 the kept fill is unharmed', onDate(serverGet(server, 'fuel_fills'), '2026-10-13').length === 1);
  }

  /* ---- ship pins ---- */
  const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
  const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok('webVersion is 354', ver.webVersion === 354, 'got ' + ver.webVersion);
  ok('index.html pins cloudsync.js?v=354', idxSrc.indexOf('js/cloudsync.js?v=354') >= 0);

  console.log('\nedit-save-sibling-v354: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL suite threw: ' + (e && e.stack || e)); process.exit(1); });
