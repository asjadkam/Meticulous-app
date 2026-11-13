#!/usr/bin/env node
/* Meticulous v454 — CLOSED-DAY-CORRECTION-DURABILITY-NOV13.
 *
 * Owner evidence (Nov 13, 2026, on the live web 453 build, in
 * the real cloud-backed book): the Manifest for 2026-11-13
 * showed Loads 5; one tap on the new closed-day "−1 load"
 * (GeoLoads.nudgeDate, web 453) repainted "Loads hauled — 4";
 * after a page reload the Manifest read Loads 5 again (GPS
 * section also 5). The local write landed — the repaint read
 * the corrected record — but the correction did not survive
 * the reload: somewhere in the cloud round-trip the edited
 * day record either never reached the cloud, or a pull/merge
 * handed the day back to the stale cloud copy.
 *
 * THE LAW (the standing sync law, webs 445/446/449/451): a
 * local record change must merge UP and never be discarded
 * by a pull/reload; a locally edited record must not be
 * reverted by an older cloud copy.
 *
 * This suite replays the night as TWO PAGE LIVES over one
 * store and one cloud, with the real js/geoloads.js driving
 * the tap and the real js/cloudsync.js running every pull,
 * push and merge:
 *   A  the push leg: tap -> sync gets its full chance -> the
 *      cloud carries the correction -> reload still reads 4.
 *   B  the pull leg: tap with the push transport dead ->
 *      reload's boot pull must not discard the correction ->
 *      once the link heals, the correction pushes UP.
 *   C1 the re-persisted twin: after the tap, another surface
 *      re-persists its UNCORRECTED copy of the same day with
 *      a NEWER updatedAt (its facts are older, its stamp is
 *      fresher — an evening engine/state re-persist). The
 *      twin carries the day's own correction stamp (the +2
 *      hand taps), older than the evening tap's. Reload +
 *      push must still converge on the corrected 4.
 *   C2 the same re-persist, but the twin's lineage never
 *      carried a correction stamp at all (pre-v454 taps):
 *      its corr is exactly the value the evening tap
 *      replaced. The correction must still win.
 *   D  the standing laws the fix must not break: D1 the
 *      v224 young-fragment protection (counts differ ->
 *      totals law); D2 the v293 honest-stamp correction
 *      (same count, later stamp wins, no stamps fields);
 *      D3 a LATER genuine correction from a second surface
 *      still wins over an earlier one; D4 the livemiles
 *      totals law is untouched.
 *
 * On web 453 bytes the doors stamp nothing and the merge
 * arbitrates same-lineage days by raw updatedAt alone:
 * C1 and C2 fail (the stale twin's fresher stamp re-teaches
 * corr +2 on the reload pull, and the push seals it), while
 * A, B and D pass — the honest paths were never broken.
 *
 * Run: node tools/closed-day-correction-durability-v454-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const csSrc = fs.readFileSync(path.join(ROOT, 'js', 'cloudsync.js'), 'utf8');
const geoSrc = fs.readFileSync(path.join(ROOT, 'js', 'geoloads.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function settle(ms) { return new Promise(function (r) { setTimeout(r, ms || 600); }); }
function deep(v) { return JSON.parse(JSON.stringify(v)); }

/* ---------------- one fake cloud, many page lives ---------------- */
function makeServer() { return { docs: {}, failPush: false, failPull: false }; }
function serverSet(server, key, v, updatedAt) {
  server.docs[key] = { id: key, mt: key, v: deep(v), del: {}, updatedAt: updatedAt };
}
function serverGet(server, key) {
  const d = server.docs[key];
  return d ? deep(d.v) : null;
}
function escStub(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function makeWorld(server, data) {
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
      if (server.failPull) return Promise.reject(new Error('pull transport down'));
      return Promise.resolve(Object.keys(server.docs).map(function (k) {
        const d = server.docs[k];
        return { id: d.id, mt: d.mt, v: deep(d.v), del: deep(d.del || {}), updatedAt: d.updatedAt };
      }));
    },
    loadDoc: function (col, id) {
      if (server.failPull) return Promise.reject(new Error('pull transport down'));
      const d = server.docs[id];
      if (!d) return Promise.resolve(null);
      return Promise.resolve({ id: d.id, mt: d.mt, v: deep(d.v), del: deep(d.del || {}), updatedAt: d.updatedAt });
    },
    saveDoc: function (col, id, payload) {
      if (server.failPush) return Promise.reject(new Error('push transport down'));
      server.docs[id] = {
        id: id, mt: id,
        v: deep(payload.v),
        del: payload.del ? deep(payload.del) : (server.docs[id] ? server.docs[id].del : {}),
        updatedAt: Date.now()
      };
      return Promise.resolve({});
    },
    deleteDoc: function (col, id) {
      if (server.failPush) return Promise.reject(new Error('push transport down'));
      delete server.docs[id];
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
  /* the web book: no location stream, today pinned past the
     closed day — the v453 bench's world, plus the sync engine */
  sb.LiveMiles = { available: function () { return false; }, subscribe: function () {} };
  sb.App = { _store: store, _esc: escStub, _today: function () { return '2026-11-14'; } };
  sb.Meticulous = { modules: {} };
  vm.runInContext(geoSrc, sb);
  return {
    sb: sb, CS: sb.CloudSync, GeoLoads: sb.GeoLoads, store: store,
    get: function (k) { const r = localStorage.getItem('mt_' + k); return r === null ? null : JSON.parse(r); },
    signIn: function () { sb.CloudSync.onAuth({ uid: 'u1' }); }
  };
}
function forceSync(s) { s.CS.lastPullAt = 0; return s.CS.syncNow(); }

/* ---------------- the Nov 13 day, as the cloud left it ---------------- */
const DAY = '2026-11-13';
const NOW = Date.now();
const T_DAY = NOW - 3 * 3600000;        // the day's last engine write, that afternoon
const T_TAPS = T_DAY - 3600000;         // the driver's +2 hand taps, stamped during the day
const LOAD = { lat: 51.12442, lng: -113.98356 };
const DUMP = { lat: 51.1225089, lng: -114.0122197 };

function dayRecord(corr, updatedAt, corrAt) {
  const rec = {
    date: DAY, dispatchId: 'dsp-nov13-2', sessionKey: 's-nov13',
    count: 3, corr: corr, handCarry: 0,
    sites: { load: { lat: LOAD.lat, lng: LOAD.lng, src: 'peg' }, dump: { lat: DUMP.lat, lng: DUMP.lng, src: 'peg' } },
    pegs: { load: { lat: LOAD.lat, lng: LOAD.lng, at: T_DAY - 7200000 }, dump: { lat: DUMP.lat, lng: DUMP.lng, at: T_DAY - 3600000 } },
    countSource: 'pegs',
    events: [{ site: 'dump', t: T_DAY - 5400000 }, { site: 'dump', t: T_DAY - 3600000 }, { site: 'dump', t: T_DAY - 1800000 }],
    updatedAt: updatedAt
  };
  if (corrAt !== undefined && corrAt !== null) rec.corrAt = corrAt;
  return rec;
}
function seedBook(server, data, rec) {
  const val = { days: {} };
  val.days[DAY] = rec;
  const other = dayRecord(0, T_DAY); other.date = '2026-11-11'; other.count = 6; other.corr = 7;
  val.days['2026-11-11'] = other;
  data['mt_geoloads'] = JSON.stringify(val);
  serverSet(server, 'geoloads', val, rec.updatedAt);
  data['mt___syncmeta'] = JSON.stringify({
    uid: 'u1', globallySynced: true, teleTp: { geoloads: 1 },
    keys: { geoloads: { t: rec.updatedAt, s: rec.updatedAt, u: 'u1' } }
  });
}
function localRec(w, date) {
  const v = w.get('geoloads');
  return (v && v.days && v.days[date || DAY]) || null;
}
function cloudRec(server, date) {
  const v = serverGet(server, 'geoloads');
  return (v && v.days && v.days[date || DAY]) || null;
}

(async function () {
  /* ================= A: the push leg ================= */
  console.log('A — tap, sync gets its chance, reload: the correction must be in the cloud and stay read');
  {
    const server = makeServer(); const data = {};
    seedBook(server, data, dayRecord(2, T_DAY, null)); // pre-v454 lineage: no correction stamp anywhere
    const w1 = makeWorld(server, data);
    w1.signIn(); await settle(900);
    ok('A1 the settled book reads the wrong 5 before the tap',
      w1.GeoLoads.forDate(DAY).count === 5, 'got ' + w1.GeoLoads.forDate(DAY).count);
    ok('A2 the −1 lands through the closed-day door', w1.GeoLoads.nudgeDate(DAY, -1) === 1);
    ok('A3 the local record carries corr 1 at once', (localRec(w1) || {}).corr === 1,
      'corr=' + (localRec(w1) || {}).corr);
    w1.CS.flushUrgent(); await settle(900);
    ok('A4 the push carries the correction UP (cloud corr 1, total 4)',
      (cloudRec(server) || {}).corr === 1 && ((cloudRec(server) || {}).count + (cloudRec(server) || {}).corr) === 4,
      'cloud=' + JSON.stringify(cloudRec(server)));
    const w2 = makeWorld(server, data);
    w2.signIn(); await settle(900);
    ok('A5 after a reload the day still reads the corrected 4',
      w2.GeoLoads.forDate(DAY).count === 4, 'got ' + w2.GeoLoads.forDate(DAY).count);
    ok('A6 the other day\'s record is untouched in the cloud',
      (cloudRec(server, '2026-11-11') || {}).count === 6 && (cloudRec(server, '2026-11-11') || {}).corr === 7);
  }

  /* ================= B: the pull leg, transport dead ================= */
  console.log('B — tap with pushes failing: the reload pull must not discard the correction');
  {
    const server = makeServer(); const data = {};
    seedBook(server, data, dayRecord(2, T_DAY, null));
    server.failPush = true;
    const w1 = makeWorld(server, data);
    w1.signIn(); await settle(900);
    ok('B1 the −1 lands locally despite the dead link', w1.GeoLoads.nudgeDate(DAY, -1) === 1 &&
      (localRec(w1) || {}).corr === 1);
    /* immediate reload — no push ever landed */
    const w2 = makeWorld(server, data);
    w2.signIn(); await settle(900);
    ok('B2 the boot pull does NOT discard the un-backed-up correction (local corr still 1)',
      (localRec(w2) || {}).corr === 1, 'corr=' + (localRec(w2) || {}).corr);
    ok('B3 the reloaded book reads the corrected 4', w2.GeoLoads.forDate(DAY).count === 4,
      'got ' + w2.GeoLoads.forDate(DAY).count);
    server.failPush = false;
    w2.CS.flushUrgent(); await settle(900);
    await forceSync(w2); await settle(900);
    ok('B4 once the link heals the correction pushes UP (cloud corr 1)',
      (cloudRec(server) || {}).corr === 1, 'cloud=' + JSON.stringify(cloudRec(server)));
  }

  /* ================= C1: the re-persisted twin, stamped lineage ================= */
  console.log('C1 — a stale twin re-persisted with a fresher stamp (carrying the day\'s older correction stamp)');
  {
    const server = makeServer(); const data = {};
    seedBook(server, data, dayRecord(2, T_DAY, T_TAPS)); // the day's +2 taps were door-stamped during the day
    const w1 = makeWorld(server, data);
    w1.signIn(); await settle(900);
    ok('C1a the −1 lands', w1.GeoLoads.nudgeDate(DAY, -1) === 1 && (localRec(w1) || {}).corr === 1);
    const tapStamp = (localRec(w1) || {}).updatedAt || NOW;
    /* the other surface re-persists its uncorrected copy an
       hour later: same facts, corr still +2, updatedAt fresher
       than the tap, correction stamp still the day's */
    const twin = dayRecord(2, tapStamp + 3600000, T_TAPS);
    const val = { days: {} }; val.days[DAY] = twin; val.days['2026-11-11'] = (serverGet(server, 'geoloads') || { days: {} }).days['2026-11-11'];
    serverSet(server, 'geoloads', val, tapStamp + 3600000);
    const w2 = makeWorld(server, data);
    w2.signIn(); await settle(900);
    ok('C1b the reload pull does NOT hand the day back to the stale twin (local corr stays 1)',
      (localRec(w2) || {}).corr === 1, 'corr=' + (localRec(w2) || {}).corr);
    ok('C1c the reloaded book reads the corrected 4', w2.GeoLoads.forDate(DAY).count === 4,
      'got ' + w2.GeoLoads.forDate(DAY).count);
    w2.CS.flushUrgent(); await settle(900);
    await forceSync(w2); await settle(900);
    ok('C1d the push converges the cloud UP to the correction (cloud corr 1)',
      (cloudRec(server) || {}).corr === 1, 'cloud=' + JSON.stringify(cloudRec(server)));
  }

  /* ================= C2: the re-persisted twin, unstamped lineage ================= */
  console.log('C2 — the same re-persist, from a lineage that never carried a correction stamp');
  {
    const server = makeServer(); const data = {};
    seedBook(server, data, dayRecord(2, T_DAY, null)); // pre-v454: no corrAt anywhere (the real Nov 13 shape)
    const w1 = makeWorld(server, data);
    w1.signIn(); await settle(900);
    ok('C2a the −1 lands', w1.GeoLoads.nudgeDate(DAY, -1) === 1 && (localRec(w1) || {}).corr === 1);
    const tapStamp = (localRec(w1) || {}).updatedAt || NOW;
    const twin = dayRecord(2, tapStamp + 3600000, null);
    const val = { days: {} }; val.days[DAY] = twin; val.days['2026-11-11'] = (serverGet(server, 'geoloads') || { days: {} }).days['2026-11-11'];
    serverSet(server, 'geoloads', val, tapStamp + 3600000);
    const w2 = makeWorld(server, data);
    w2.signIn(); await settle(900);
    ok('C2b the reload pull does NOT hand the day back to the stale twin (local corr stays 1)',
      (localRec(w2) || {}).corr === 1, 'corr=' + (localRec(w2) || {}).corr);
    ok('C2c the reloaded book reads the corrected 4', w2.GeoLoads.forDate(DAY).count === 4,
      'got ' + w2.GeoLoads.forDate(DAY).count);
    w2.CS.flushUrgent(); await settle(900);
    await forceSync(w2); await settle(900);
    ok('C2d the push converges the cloud UP to the correction (cloud corr 1)',
      (cloudRec(server) || {}).corr === 1, 'cloud=' + JSON.stringify(cloudRec(server)));
  }

  /* ================= D1: young-fragment protection ================= */
  console.log('D1 — counts differ: the v224 totals law still guards the full day');
  {
    const server = makeServer(); const data = {};
    const full = dayRecord(-2, T_DAY, null); full.count = 19;
    const frag = dayRecord(0, NOW, null); frag.count = 2; frag.events = [];
    const valC = { days: {} }; valC.days[DAY] = full;
    serverSet(server, 'geoloads', valC, T_DAY);
    const valL = { days: {} }; valL.days[DAY] = frag;
    data['mt_geoloads'] = JSON.stringify(valL);
    data['mt___syncmeta'] = JSON.stringify({
      uid: 'u1', globallySynced: true, teleTp: { geoloads: 1 },
      keys: { geoloads: { t: NOW, s: T_DAY, u: 'u1' } }
    });
    const w = makeWorld(server, data);
    w.signIn(); await settle(900);
    await forceSync(w); await settle(900);
    ok('D1a the full day (19 − 2 = 17) wins locally over the young fragment',
      (localRec(w) || {}).count === 19 && (localRec(w) || {}).corr === -2,
      'local=' + JSON.stringify(localRec(w)));
    ok('D1b the cloud keeps the full day too',
      (cloudRec(server) || {}).count === 19 && (cloudRec(server) || {}).corr === -2);
  }

  /* ================= D2: the v293 honest-stamp correction ================= */
  console.log('D2 — same count, no stamp fields: the later honest stamp still wins (v293)');
  {
    const server = makeServer(); const data = {};
    const cloudR = dayRecord(1, T_DAY - 3600000, null); cloudR.count = 19;
    const localR = dayRecord(-2, T_DAY, null); localR.count = 19;
    const valC = { days: {} }; valC.days[DAY] = cloudR;
    serverSet(server, 'geoloads', valC, T_DAY - 3600000);
    const valL = { days: {} }; valL.days[DAY] = localR;
    data['mt_geoloads'] = JSON.stringify(valL);
    data['mt___syncmeta'] = JSON.stringify({
      uid: 'u1', globallySynced: true, teleTp: { geoloads: 1 },
      keys: { geoloads: { t: T_DAY, s: T_DAY - 3600000, u: 'u1' } }
    });
    const w = makeWorld(server, data);
    w.signIn(); await settle(900);
    await forceSync(w); await settle(900);
    ok('D2a the corrected day (19 − 2 = 17) lands in the cloud',
      (cloudRec(server) || {}).corr === -2, 'cloud=' + JSON.stringify(cloudRec(server)));
    ok('D2b the local book is not re-taught the stale +1',
      (localRec(w) || {}).corr === -2, 'local=' + JSON.stringify(localRec(w)));
  }

  /* ================= D3: a later genuine correction wins ================= */
  console.log('D3 — two surfaces correct the same closed day in turn: the later correction is the truth');
  {
    const server = makeServer(); const dataB = {}; const dataP = {};
    seedBook(server, dataB, dayRecord(2, T_DAY, null));
    const wb = makeWorld(server, dataB);
    wb.signIn(); await settle(900);
    ok('D3a surface one corrects 5 -> 4', wb.GeoLoads.nudgeDate(DAY, -1) === 1);
    wb.CS.flushUrgent(); await settle(900);
    ok('D3b the first correction reaches the cloud', (cloudRec(server) || {}).corr === 1);
    /* the second surface: fresh store, pulls the corrected
       book, then corrects the same day once more (−1) */
    dataP['mt___syncmeta'] = JSON.stringify({ uid: 'u1', globallySynced: true, teleTp: { geoloads: 1 }, keys: {} });
    const wp = makeWorld(server, dataP);
    wp.signIn(); await settle(900);
    ok('D3c the second surface pulls the corrected day (corr 1)',
      (localRec(wp) || {}).corr === 1, 'corr=' + (localRec(wp) || {}).corr);
    ok('D3d the second surface corrects again (4 -> 3)', wp.GeoLoads.nudgeDate(DAY, -1) === 0 &&
      (localRec(wp) || {}).corr === 0, 'corr=' + (localRec(wp) || {}).corr);
    wp.CS.flushUrgent(); await settle(900);
    ok('D3e the later correction wins in the cloud (corr 0, total 3)',
      (cloudRec(server) || {}).corr === 0 && ((cloudRec(server) || {}).count + (cloudRec(server) || {}).corr) === 3,
      'cloud=' + JSON.stringify(cloudRec(server)));
    const wb2 = makeWorld(server, dataB);
    wb2.signIn(); await settle(900);
    ok('D3f the first surface converges to the later correction on reload (reads 3)',
      wb2.GeoLoads.forDate(DAY).count === 3, 'got ' + wb2.GeoLoads.forDate(DAY).count);
  }

  /* ================= D4: livemiles untouched ================= */
  console.log('D4 — livemiles: the totals law is exactly as it was');
  {
    const server = makeServer(); const data = {};
    const dayK = 's' + (NOW - 86400000);
    const cloudDays = {}; cloudDays[dayK] = { key: dayK, date: DAY, totalM: 39361, crumbs: [{ t: 1, a: 51, o: -114 }], hasFix: true, updatedAt: T_DAY };
    serverSet(server, 'livemiles', { days: cloudDays }, T_DAY);
    const localDays = {}; localDays[dayK] = { key: dayK, date: DAY, totalM: 667, crumbs: [{ t: 2, a: 51, o: -114 }], hasFix: true, updatedAt: NOW };
    data['mt_livemiles'] = JSON.stringify({ days: localDays });
    data['mt___syncmeta'] = JSON.stringify({
      uid: 'u1', globallySynced: true, teleTp: { livemiles: 1 },
      keys: { livemiles: { t: NOW, s: T_DAY, u: 'u1' } }
    });
    const w = makeWorld(server, data);
    w.signIn(); await settle(900);
    const loc = w.get('livemiles');
    ok('D4 the cloud\'s full miles day heals the young local snapshot (39,361 m)',
      !!(loc && loc.days[dayK] && loc.days[dayK].totalM === 39361),
      'local=' + (loc && loc.days[dayK] && loc.days[dayK].totalM));
  }

  console.log('\nclosed-day-correction-durability-v454: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('SUITE ERROR', e); process.exit(2); });
