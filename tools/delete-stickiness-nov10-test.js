#!/usr/bin/env node
/* DELETE-STICKINESS-NOV10 — the owner's ruling (Nov 10, 2026,
 * 10:11 CST): "Do what you have to — no deletes if the cloud and
 * app both agree... If they disagree the option to delete has to
 * be there!"
 *
 *   1. Agreement = hands off (nothing deleted, no machinery).
 *   2. A DELIBERATE delete wins everywhere: tombstoned, it
 *      propagates to every device, and no still-holding device
 *      can resurrect the record into the cloud. The tombstone
 *      binds only an id both sides once agreed in the cloud
 *      (the shadow rule) — a local-only record is never
 *      tombstoned away.
 *   3. Disagreement the tombstone can't settle (deleted on one
 *      side, EDITED on the other after the delete) surfaces the
 *      user's choice: status().delConflicts + the Preferences
 *      sync card (source-pinned below); both choices honoured.
 *   4. Never-lose (v241/v272 union vs rolled-back cloud copies)
 *      stays intact for records nobody deleted.
 *
 * Worlds (two devices, ONE shared fake cloud, the real
 * js/cloudsync.js in both):
 *   A — the field case: web deletes the $695.98 auto revenue
 *       entry; the phone still holds it. After the phone's
 *       pull+push cycles the record is gone from the phone AND
 *       stays gone from the cloud.
 *   B — rollback: the cloud copy loses a fuel fill nobody
 *       deleted; the union restores it; no tombstone authored.
 *   C — delete vs later edit: PTI report edited on the phone,
 *       deleted on the web. The conflict surfaces on the phone,
 *       the record is held back from the cloud while the user
 *       decides; DELETE resolution drops it everywhere.
 *   C2 — same setup; KEEP resolution restores the edited record
 *       to the cloud, revokes the tombstone, and the deleting
 *       device takes the record back without re-deleting it.
 *   D — a local-only, never-agreed fuel fill beside a foreign
 *       tombstone: untouched, pushes up normally, gains no
 *       tombstone of its own.
 * Run: node tools/delete-stickiness-nov10-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const csSrc = fs.readFileSync(path.join(ROOT, 'js', 'cloudsync.js'), 'utf8');
const prefSrc = fs.readFileSync(path.join(ROOT, 'modules', 'preferences.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function note(s) { console.log('  .. ' + s); }

const REAL_DATE = Date;
function makeFakeDate(startMs) {
  let now = startMs;
  function FakeDate(ms) { this._ms = (ms === undefined) ? now : (typeof ms === 'number' ? ms : new REAL_DATE(ms).getTime()); }
  FakeDate.now = function () { return now; };
  FakeDate.advance = function (ms) { now += ms; };
  FakeDate.parse = function (s) { return REAL_DATE.parse(s); };
  FakeDate.prototype.getHours = function () { return new REAL_DATE(this._ms).getHours(); };
  FakeDate.prototype.getMinutes = function () { return new REAL_DATE(this._ms).getMinutes(); };
  FakeDate.prototype.getFullYear = function () { return new REAL_DATE(this._ms).getFullYear(); };
  FakeDate.prototype.getMonth = function () { return new REAL_DATE(this._ms).getMonth(); };
  FakeDate.prototype.getDate = function () { return new REAL_DATE(this._ms).getDate(); };
  FakeDate.prototype.getTime = function () { return this._ms; };
  return FakeDate;
}

const T_AGREE = new REAL_DATE('2026-11-09T20:00:00').getTime();
const T_BOOT = new REAL_DATE('2026-11-10T09:45:00').getTime();

const REV_KEEP = { dspId: 'dsp-nov9', date: '2026-11-09', amount: 362.50, note: 'Card #10525' };
const REV_GHOST = { date: '2026-11-09', amount: 695.98, note: 'Auto from tracker', auto: true };
const REV_NEW = { dspId: 'dsp-nov10', date: '2026-11-10', amount: 290.00, note: 'Card #10530' };
const PTI_R1 = { id: 'pti-1', date: '2026-11-09', plate: '04 R209', defects: 'none', signed: true };
const PTI_R1_EDITED = { id: 'pti-1', date: '2026-11-09', plate: '04 R209', defects: 'cracked light', signed: true };
const FUEL_F1 = { id: 'f-1', date: '2026-11-08', time: '10:00', litres: 50, cost: 100, station: 'Mobil', odo: 171000 };
const FUEL_F2 = { id: 'f-2', date: '2026-11-09', time: '11:00', litres: 60, cost: 120, station: 'Mobil', odo: 171200 };
const FUEL_LOCAL = { id: 'f-local', date: '2026-11-10', time: '09:00', litres: 40, cost: 80, station: 'Petro', odo: 171400 };

/* recordIdentity is internal to cloudsync; the shadow seeds and
 * the tombstone key checks below name identities the same way
 * (rev_entries without dspId = whole-record fingerprint). */
function revFingerprint(rec) {
  const ks = Object.keys(rec).filter(function (k) { return k !== 'photo'; }).sort();
  return 'fp:' + ks.map(function (k) { return k + '=' + JSON.stringify(rec[k]); }).join('|');
}
const GHOST_ID = revFingerprint(REV_GHOST);
const KEEP_ID = 'dsp:dsp-nov9';

function makeCloud(seed) {
  const cloud = {};
  Object.keys(seed).forEach(function (k) {
    cloud[k] = { v: seed[k].v, del: seed[k].del || undefined, updatedAt: seed[k].updatedAt || T_AGREE };
  });
  return cloud;
}

function makeDevice(cloud, opts) {
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
  const dotEl = { className: '', title: '' };
  const listeners = {};
  const FakeDate = makeFakeDate(T_BOOT);
  const sb = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, Promise: Promise, Date: FakeDate };
  sb.window = sb;
  sb.localStorage = localStorage;
  sb.navigator = { onLine: true };
  sb.document = { getElementById: function (id) { return id === 'syncDot' ? dotEl : null; }, addEventListener: function () {}, contains: function () { return false; } };
  sb.addEventListener = function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); };
  const latency = 5;
  sb.FB = {
    ready: true,
    user: { uid: 'u1' },
    loadDocs: function () {
      return new Promise(function (r) { setTimeout(function () {
        const out = Object.keys(cloud).sort().map(function (id) {
          const d = { id: id, v: cloud[id].v, updatedAt: cloud[id].updatedAt };
          if (cloud[id].del) d.del = cloud[id].del;
          return d;
        });
        r(out);
      }, latency); });
    },
    loadDoc: function (col, id) {
      return new Promise(function (r) { setTimeout(function () {
        if (!cloud[id]) { r(null); return; }
        const d = { id: id, v: cloud[id].v, updatedAt: cloud[id].updatedAt };
        if (cloud[id].del) d.del = cloud[id].del;
        r(d);
      }, latency); });
    },
    saveDoc: function (col, id, doc) {
      return new Promise(function (res) { setTimeout(function () {
        const prev = cloud[id] || {};
        cloud[id] = {
          v: doc.v,
          del: ('del' in doc) ? doc.del : prev.del,
          updatedAt: FakeDate.now()
        };
        res({});
      }, latency); });
    },
    deleteDoc: function (col, id) { return new Promise(function (r) { setTimeout(function () { delete cloud[id]; r({}); }, latency); }); }
  };
  vm.createContext(sb);
  vm.runInContext(csSrc, sb);
  const store = {
    get: function (k, d) { const r = localStorage.getItem('mt_' + k); return r === null ? d : JSON.parse(r); },
    set: function (k, v) { localStorage.setItem('mt_' + k, JSON.stringify(v)); return true; },
    del: function (k) { localStorage.removeItem('mt_' + k); return true; }
  };
  sb.CloudSync.attach(store);
  sb.CloudSync.onAuth({ uid: 'u1' });
  return { sb: sb, CS: sb.CloudSync, store: store, data: data, FakeDate: FakeDate };
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function cycle() {
  // one convergence cycle for every device in play: advance all
  // fake clocks past the repeat-pull gap, then syncNow + settle.
  const devs = Array.prototype.slice.call(arguments);
  devs.forEach(function (d) { d.FakeDate.advance(11 * 60 * 1000); });
  for (const d of devs) { d.CS.syncNow(); await sleep(300); }
}
function amounts(arr) { return (arr || []).map(function (r) { return r.amount; }); }
function ids(arr) { return (arr || []).map(function (r) { return r.id; }); }
function conflictsOf(dev) {
  try { const st = dev.CS.status(); return Array.isArray(st.delConflicts) ? st.delConflicts : null; }
  catch (e) { return null; }
}

function agreedMeta(shadows) {
  const keys = {
    onboarding: { t: T_AGREE, s: T_AGREE, u: 'u1' },
    tracker: { t: T_AGREE, s: T_AGREE, u: 'u1' }
  };
  Object.keys(shadows).forEach(function (k) {
    keys[k] = { t: T_AGREE, s: T_AGREE, u: 'u1', sh: shadows[k].slice() };
  });
  return { uid: 'u1', globallySynced: true, keys: keys };
}
function baseLocal(extra) {
  return [['onboarding', { firstName: 'Asjad', lastName: 'Kamal', accountType: 'driver', province: 'Alberta' }],
          ['tracker', { status: 'idle' }]].concat(extra || []);
}
function baseCloud(extra) {
  const c = {
    onboarding: { v: { firstName: 'Asjad', lastName: 'Kamal', accountType: 'driver', province: 'Alberta' } },
    tracker: { v: { status: 'idle' } }
  };
  Object.keys(extra || {}).forEach(function (k) { c[k] = extra[k]; });
  return c;
}

/* ---------------- World A — the field case ---------------- */
async function worldA() {
  console.log('\n== World A — web deletes, phone still holds ==');
  const cloud = makeCloud(baseCloud({ rev_entries: { v: [REV_KEEP, REV_GHOST] } }));
  const seedLocal = function () { return baseLocal([['rev_entries', [REV_KEEP, REV_GHOST]]]); };
  const seedMeta = function () { return agreedMeta({ rev_entries: [KEEP_ID, GHOST_ID] }); };
  const web = makeDevice(cloud, { local: seedLocal(), meta: seedMeta() });
  const phone = makeDevice(cloud, { local: seedLocal(), meta: seedMeta() });
  await sleep(400);

  web.store.set('rev_entries', [REV_KEEP]); // the UI delete (Nov 10, 08:05)
  await cycle(web, phone);
  ok('A1 web push removes the record from the cloud list',
     JSON.stringify(amounts(cloud.rev_entries.v)) === '[362.5]', 'cloud=' + JSON.stringify(amounts(cloud.rev_entries.v)));
  ok('A2 the delete is tombstoned in the cloud doc',
     !!(cloud.rev_entries.del && cloud.rev_entries.del[GHOST_ID]),
     'del=' + JSON.stringify(cloud.rev_entries.del && Object.keys(cloud.rev_entries.del)));
  ok('A3 the phone drops the record on its next cycle',
     JSON.stringify(amounts(phone.store.get('rev_entries', []))) === '[362.5]',
     'phone=' + JSON.stringify(amounts(phone.store.get('rev_entries', []))));

  phone.store.set('rev_entries', [REV_KEEP, REV_NEW]); // the phone keeps working
  await cycle(phone, web);
  await cycle(web, phone);
  ok('A4 the phone cannot resurrect it into the cloud',
     JSON.stringify(amounts(cloud.rev_entries.v)) === '[362.5,290]',
     'cloud=' + JSON.stringify(amounts(cloud.rev_entries.v)));
  ok('A5 the tombstone survives the cycles (no early GC)',
     !!(cloud.rev_entries.del && cloud.rev_entries.del[GHOST_ID]));
  ok('A6 the web list gains the new entry but never the ghost',
     JSON.stringify(amounts(web.store.get('rev_entries', []))) === '[362.5,290]',
     'web=' + JSON.stringify(amounts(web.store.get('rev_entries', []))));
}

/* ---------------- World B — rollback, never-lose ---------------- */
async function worldB() {
  console.log('\n== World B — cloud rolls back, nobody deleted ==');
  const cloud = makeCloud(baseCloud({ fuel_fills: { v: [FUEL_F1, FUEL_F2] } }));
  const phone = makeDevice(cloud, {
    local: baseLocal([['fuel_fills', [FUEL_F1, FUEL_F2]]]),
    meta: agreedMeta({ fuel_fills: ['id:f-1', 'id:f-2'] })
  });
  await sleep(400);
  // the Oct accident shape: the cloud doc is replaced by an older,
  // shorter copy with a NEWER stamp. Nobody deleted F2.
  cloud.fuel_fills = { v: [FUEL_F1], updatedAt: T_BOOT + 60000 };
  await cycle(phone);
  ok('B1 the phone keeps both fills', JSON.stringify(ids(phone.store.get('fuel_fills', []))) === '["f-1","f-2"]',
     'phone=' + JSON.stringify(ids(phone.store.get('fuel_fills', []))));
  ok('B2 the union restores the fill to the cloud', JSON.stringify(ids(cloud.fuel_fills.v)) === '["f-1","f-2"]',
     'cloud=' + JSON.stringify(ids(cloud.fuel_fills.v)));
  ok('B3 no tombstone is authored for a record nobody deleted',
     !(cloud.fuel_fills.del && Object.keys(cloud.fuel_fills.del).length),
     'del=' + JSON.stringify(cloud.fuel_fills.del));
}

/* ---------------- World C — delete vs later edit ---------------- */
function worldCSeed() {
  const cloud = makeCloud(baseCloud({ pti_reports: { v: [PTI_R1] } }));
  const mk = function () {
    return {
      local: baseLocal([['pti_reports', [PTI_R1]]]),
      meta: agreedMeta({ pti_reports: ['id:pti-1'] })
    };
  };
  const s1 = mk(), s2 = mk();
  const web = makeDevice(cloud, s1);
  const phone = makeDevice(cloud, s2);
  return { cloud: cloud, web: web, phone: phone };
}
async function worldC() {
  console.log('\n== World C — delete vs later edit: DELETE resolution ==');
  const w = worldCSeed();
  await sleep(400);
  w.phone.store.set('pti_reports', [PTI_R1_EDITED]); // edited here after the delete there
  w.web.store.set('pti_reports', []);                // deleted on the web
  await cycle(w.web);
  ok('C1 web delete lands: cloud list empty, tombstone written',
     (w.cloud.pti_reports.v || []).length === 0 && !!(w.cloud.pti_reports.del && w.cloud.pti_reports.del['id:pti-1']),
     'v=' + JSON.stringify(w.cloud.pti_reports.v) + ' del=' + JSON.stringify(w.cloud.pti_reports.del && Object.keys(w.cloud.pti_reports.del)));
  await cycle(w.phone);
  const conf = conflictsOf(w.phone);
  ok('C2 the disagreement surfaces as a delete choice on the phone',
     !!(conf && conf.some(function (c) { return c.key === 'pti_reports' && c.id === 'id:pti-1'; })),
     'delConflicts=' + JSON.stringify(conf));
  const held = w.phone.store.get('pti_reports', []);
  ok('C3 the edited copy is NOT silently dropped while the user decides',
     held.length === 1 && held[0].defects === 'cracked light', 'local=' + JSON.stringify(held));
  await cycle(w.phone); // a second undecided cycle: the hold must be a law, not a timing fluke
  ok('C4 the edited copy is held back from the cloud while undecided',
     (w.cloud.pti_reports.v || []).length === 0, 'cloud=' + JSON.stringify(w.cloud.pti_reports.v));
  let resolved = false;
  try { resolved = w.phone.CS.resolveDelConflict('pti_reports', 'id:pti-1', false) === true; } catch (e) {}
  ok('C5 resolveDelConflict(delete) runs', resolved);
  ok('C6 the record is gone from the phone after the user chooses delete',
     (w.phone.store.get('pti_reports', []) || []).length === 0);
  ok('C7 the choice is cleared after resolution',
     (conflictsOf(w.phone) || []).length === 0, 'delConflicts=' + JSON.stringify(conflictsOf(w.phone)));
  await cycle(w.phone, w.web);
  ok('C8 the cloud stays deleted after further cycles',
     (w.cloud.pti_reports.v || []).length === 0 && !!(w.cloud.pti_reports.del && w.cloud.pti_reports.del['id:pti-1']));
}
async function worldC2() {
  console.log('\n== World C2 — delete vs later edit: KEEP resolution ==');
  const w = worldCSeed();
  await sleep(400);
  w.phone.store.set('pti_reports', [PTI_R1_EDITED]);
  w.web.store.set('pti_reports', []);
  await cycle(w.web);
  await cycle(w.phone);
  const conf = conflictsOf(w.phone);
  ok('C2.1 the conflict surfaces (keep run)', !!(conf && conf.length === 1), 'delConflicts=' + JSON.stringify(conf));
  let resolved = false;
  try { resolved = w.phone.CS.resolveDelConflict('pti_reports', 'id:pti-1', true) === true; } catch (e) {}
  ok('C2.2 resolveDelConflict(keep) runs', resolved);
  const held = w.phone.store.get('pti_reports', []);
  ok('C2.3 the phone keeps its edited copy', held.length === 1 && held[0].defects === 'cracked light');
  await cycle(w.phone);
  const cv = w.cloud.pti_reports.v || [];
  ok('C2.4 keep restores the record to the cloud', cv.length === 1 && cv[0].defects === 'cracked light',
     'cloud=' + JSON.stringify(cv));
  ok('C2.5 keep revokes the tombstone in the cloud doc',
     !(w.cloud.pti_reports.del && w.cloud.pti_reports.del['id:pti-1']),
     'del=' + JSON.stringify(w.cloud.pti_reports.del && Object.keys(w.cloud.pti_reports.del)));
  await cycle(w.web);
  const wl = w.web.store.get('pti_reports', []);
  ok('C2.6 the deleting device takes the kept record back', wl.length === 1 && wl[0].defects === 'cracked light',
     'web=' + JSON.stringify(wl));
  await cycle(w.web, w.phone);
  ok('C2.7 no re-delete oscillation: the record stands everywhere',
     (w.cloud.pti_reports.v || []).length === 1 &&
     (w.web.store.get('pti_reports', []) || []).length === 1 &&
     (w.phone.store.get('pti_reports', []) || []).length === 1);
}

/* ---------------- World D — local-only record ---------------- */
async function worldD() {
  console.log('\n== World D — local-only record beside a foreign tombstone ==');
  const cloud = makeCloud(baseCloud({
    fuel_fills: { v: [FUEL_F1], del: { 'id:f-other': { t: T_AGREE, fp: 'cfp:foreign' } } }
  }));
  const phone = makeDevice(cloud, {
    local: baseLocal([['fuel_fills', [FUEL_F1, FUEL_LOCAL]]]),
    meta: agreedMeta({ fuel_fills: ['id:f-1'] })
  });
  await sleep(400);
  await cycle(phone);
  const local = phone.store.get('fuel_fills', []);
  ok('D1 the never-agreed local record is untouched by the foreign tombstone',
     JSON.stringify(ids(local)) === '["f-1","f-local"]', 'local=' + JSON.stringify(ids(local)));
  await cycle(phone);
  ok('D2 the local-only record pushes up normally',
     JSON.stringify(ids(cloud.fuel_fills.v)) === '["f-1","f-local"]', 'cloud=' + JSON.stringify(ids(cloud.fuel_fills.v)));
  ok('D3 it gains no tombstone of its own; the foreign one is preserved',
     !!(cloud.fuel_fills.del && cloud.fuel_fills.del['id:f-other'] && !cloud.fuel_fills.del['id:f-local']),
     'del=' + JSON.stringify(cloud.fuel_fills.del && Object.keys(cloud.fuel_fills.del)));
}

/* ---------------- source pins: the visible surface ---------------- */
function sourcePins() {
  console.log('\n== Source pins — the disagreement surface is wired ==');
  ok('S1 Preferences sync card carries the choice container',
     prefSrc.indexOf('pf_delconf') >= 0 && prefSrc.indexOf('resolveDelConflict') >= 0);
  ok('S2 the surface offers both choices in plain words',
     prefSrc.indexOf('Delete it') >= 0 && prefSrc.indexOf('Keep my copy') >= 0);
}

(async function () {
  await worldA();
  await worldB();
  await worldC();
  await worldC2();
  await worldD();
  sourcePins();
  console.log('\ndelete-stickiness-nov10: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('BENCH ERROR', e && e.stack || e); process.exit(2); });
