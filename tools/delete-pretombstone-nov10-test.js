#!/usr/bin/env node
/* DELETE-PRETOMBSTONE-NOV10 — the gap web 404 left (owner
 * verdict Nov 10, 2026, 11:12: the Revenue tile still read
 * "Last entry: $695.98 · yesterday" and Documents "No documents
 * yet", gen 76 installed, sync settled green).
 *
 * THE CONVICTION (bench-proven by the world-E replay on the
 * shipped bytes): the $695.98 record was deleted Nov 10, 08:05
 * through the cloud WEB session running PRE-404 code — its
 * write carried no tombstone, because tombstones did not exist
 * yet. On the phone's first later pull the absence is visible
 * for exactly one instant (local ∧ agreed-shadow ∧ ¬cloud, no
 * del entry); no 404 path names it: processCloudDels reads
 * only the doc's del map (empty), pendingRecordDeletes needs
 * the id PRESENT in the cloud list (it is absent), and the
 * union's never-lose law then re-writes the record INTO the
 * cloud on the phone's own push — the deletion is silently
 * undone and the state is stable forever (verified: after 3
 * cycles the cloud holds the ghost again, the shadow still
 * names it, no conflict, no surface). World B (a rolled-back
 * cloud copy) presents the IDENTICAL stored signature — there
 * is no distinguishing signal in the stored data, so per the
 * owner's ruling (Nov 10, 10:11: "if they disagree the option
 * to delete has to be there") the resolution is the CHOICE
 * ITSELF: the disagreement surfaces on the holding device
 * (status().orphans → the Preferences sync card), nothing is
 * ever auto-deleted, Delete authors the tombstone web 404
 * would have written, Keep restores/stands the record.
 *
 * The mirror shape is the Documents case (shadow ∧ cloud ∧
 * ¬local): filed to the account Nov 9, verified in the cloud
 * book, yet the phone's vault read empty because its shadow
 * remembered them as its own pending deletion and every union
 * kept them out — and on the shipped bytes a landed push goes
 * further and tombstones them account-wide (the world-D
 * replay on 405 bytes ends with both documents deleted
 * everywhere, silently). Its fix is at the gate itself: the
 * pending-delete honor protects an IN-FLIGHT delete, which
 * is exactly a DIRTY key (every local write is stamped by
 * attach()'s store wrapper); on a SETTLED key there is no
 * delete in flight, so spent shadow ids are pruned at the
 * pull merge and the account's records land — while a fresh
 * deliberate delete (dirty by construction) executes and
 * tombstones exactly as web 404 built it (world D2).
 *
 * Worlds (two devices, ONE shared fake cloud, the real
 * js/cloudsync.js in both):
 *   E  — pre-tombstone deletion of the revenue ghost: the
 *        offer surfaces on the phone; nothing auto-deletes;
 *        DELETE removes it everywhere + authors the tombstone.
 *   E2 — same setup: KEEP stands the record everywhere and
 *        the offer does not re-fire.
 *   B  — rollback (world B of the 404 suite): never-lose is
 *        intact (kept + restored, no tombstone); the offer
 *        fires (same signature — stated honestly); KEEP
 *        settles it with no re-offer.
 *   D  — the documents exclusion: two filed documents the
 *        phone's shadow excludes; the offer surfaces on the
 *        repeat pull; KEEP lands one on the phone; DELETE
 *        tombstones the other everywhere.
 *   S  — source pins: the surface is wired in Preferences.
 * Run: node tools/delete-pretombstone-nov10-test.js
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
const FUEL_F1 = { id: 'f-1', date: '2026-11-08', time: '10:00', litres: 50, cost: 100, station: 'Mobil', odo: 171000 };
const FUEL_F2 = { id: 'f-2', date: '2026-11-09', time: '11:00', litres: 60, cost: 120, station: 'Mobil', odo: 171200 };
const DOC1 = { id: 'doc-cvsa-1', label: 'CVIP / Safety', name: 'CVSA AB318427EI p1', kind: 'image', data: 'data:image/jpeg;base64,AAA', addedAt: T_AGREE - 60000 };
const DOC2 = { id: 'doc-cvsa-2', label: 'CVIP / Safety', name: 'CVSA AB318427EI p2', kind: 'image', data: 'data:image/jpeg;base64,BBB', addedAt: T_AGREE - 30000 };

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
  const devs = Array.prototype.slice.call(arguments);
  devs.forEach(function (d) { d.FakeDate.advance(11 * 60 * 1000); });
  for (const d of devs) { d.CS.syncNow(); await sleep(300); }
}
function amounts(arr) { return (arr || []).map(function (r) { return r.amount; }); }
function docIds(arr) { return (arr || []).map(function (r) { return r.id; }); }
function orphansOf(dev) {
  try { const st = dev.CS.status(); return Array.isArray(st.orphans) ? st.orphans : null; }
  catch (e) { return null; }
}
function orphanFor(dev, key, id) {
  const o = orphansOf(dev);
  return o ? o.filter(function (x) { return x.key === key && x.id === id; })[0] || null : null;
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

/* ---------------- World E — pre-tombstone deletion ---------------- */
function worldESeed() {
  const cloud = makeCloud(baseCloud({ rev_entries: { v: [REV_KEEP, REV_GHOST] } }));
  const mk = function () {
    return {
      local: baseLocal([['rev_entries', [REV_KEEP, REV_GHOST]]]),
      meta: agreedMeta({ rev_entries: [KEEP_ID, GHOST_ID] })
    };
  };
  const a = mk(), b = mk();
  return { cloud: cloud, web: makeDevice(cloud, a), phone: makeDevice(cloud, b) };
}
async function worldE() {
  console.log('\n== World E — pre-tombstone deletion, DELETE resolution ==');
  const w = worldESeed();
  await sleep(400);
  // the Nov 10, 08:05 write, faithful: a PRE-404 client replaces
  // the cloud doc — shorter list, fresh stamp, NO del field.
  w.cloud.rev_entries = { v: [REV_KEEP], updatedAt: T_BOOT - 3600000 };
  await cycle(w.phone);
  const off = orphanFor(w.phone, 'rev_entries', GHOST_ID);
  ok('E1 the disagreement surfaces on the holding device', !!off,
     'orphans=' + JSON.stringify(orphansOf(w.phone)));
  ok('E2 the offer names the record in owner words', !!(off && /695\.98/.test(off.label || '')),
     'label=' + (off && off.label));
  ok('E3 nothing is auto-deleted: the phone still holds the record while he decides',
     JSON.stringify(amounts(w.phone.store.get('rev_entries', []))) === '[362.5,695.98]',
     'phone=' + JSON.stringify(amounts(w.phone.store.get('rev_entries', []))));
  let resolved = false;
  try { resolved = w.phone.CS.resolveOrphan('rev_entries', GHOST_ID, false) === true; } catch (e) {}
  ok('E4 resolveOrphan(delete) runs', resolved);
  ok('E5 the record leaves the phone at his word',
     JSON.stringify(amounts(w.phone.store.get('rev_entries', []))) === '[362.5]',
     'phone=' + JSON.stringify(amounts(w.phone.store.get('rev_entries', []))));
  ok('E6 the choice is cleared after resolution', !orphanFor(w.phone, 'rev_entries', GHOST_ID));
  await cycle(w.phone, w.web);
  ok('E7 the deletion reaches the cloud list and STAYS (tombstone authored)',
     JSON.stringify(amounts(w.cloud.rev_entries.v)) === '[362.5]' &&
     !!(w.cloud.rev_entries.del && w.cloud.rev_entries.del[GHOST_ID]),
     'cloud=' + JSON.stringify(amounts(w.cloud.rev_entries.v)) + ' del=' + JSON.stringify(w.cloud.rev_entries.del && Object.keys(w.cloud.rev_entries.del)));
  ok('E8 the other device drops it too',
     JSON.stringify(amounts(w.web.store.get('rev_entries', []))) === '[362.5]',
     'web=' + JSON.stringify(amounts(w.web.store.get('rev_entries', []))));
  await cycle(w.phone, w.web);
  ok('E9 no resurrection on later cycles',
     JSON.stringify(amounts(w.cloud.rev_entries.v)) === '[362.5]' &&
     JSON.stringify(amounts(w.phone.store.get('rev_entries', []))) === '[362.5]');
}
async function worldE2() {
  console.log('\n== World E2 — pre-tombstone deletion, KEEP resolution ==');
  const w = worldESeed();
  await sleep(400);
  w.cloud.rev_entries = { v: [REV_KEEP], updatedAt: T_BOOT - 3600000 };
  await cycle(w.phone);
  ok('E2.1 the offer surfaces (keep run)', !!orphanFor(w.phone, 'rev_entries', GHOST_ID),
     'orphans=' + JSON.stringify(orphansOf(w.phone)));
  let resolved = false;
  try { resolved = w.phone.CS.resolveOrphan('rev_entries', GHOST_ID, true) === true; } catch (e) {}
  ok('E2.2 resolveOrphan(keep) runs', resolved);
  await cycle(w.phone, w.web);
  ok('E2.3 keep stands the record everywhere (never-lose by his choice)',
     JSON.stringify(amounts(w.cloud.rev_entries.v)) === '[362.5,695.98]' &&
     JSON.stringify(amounts(w.web.store.get('rev_entries', []))) === '[362.5,695.98]' &&
     JSON.stringify(amounts(w.phone.store.get('rev_entries', []))) === '[362.5,695.98]',
     'cloud=' + JSON.stringify(amounts(w.cloud.rev_entries.v)));
  ok('E2.4 keep authors no tombstone', !(w.cloud.rev_entries.del && w.cloud.rev_entries.del[GHOST_ID]));
  await cycle(w.phone);
  ok('E2.5 the settled keep does not re-offer', !orphanFor(w.phone, 'rev_entries', GHOST_ID),
     'orphans=' + JSON.stringify(orphansOf(w.phone)));
}

/* ---------------- World B — rollback: same signature, asked not assumed ---------------- */
async function worldB() {
  console.log('\n== World B — rollback keeps never-lose; the choice is offered ==');
  const cloud = makeCloud(baseCloud({ fuel_fills: { v: [FUEL_F1, FUEL_F2] } }));
  const phone = makeDevice(cloud, {
    local: baseLocal([['fuel_fills', [FUEL_F1, FUEL_F2]]]),
    meta: agreedMeta({ fuel_fills: ['id:f-1', 'id:f-2'] })
  });
  await sleep(400);
  cloud.fuel_fills = { v: [FUEL_F1], updatedAt: T_BOOT + 60000 }; // rolled back, nobody deleted F2
  await cycle(phone);
  ok('B1 never-lose intact: the phone keeps both fills',
     JSON.stringify(docIds(phone.store.get('fuel_fills', []))) === '["f-1","f-2"]',
     'phone=' + JSON.stringify(docIds(phone.store.get('fuel_fills', []))));
  ok('B2 the union restores the fill to the cloud',
     JSON.stringify(docIds(cloud.fuel_fills.v)) === '["f-1","f-2"]',
     'cloud=' + JSON.stringify(docIds(cloud.fuel_fills.v)));
  ok('B3 no tombstone is authored by the machinery',
     !(cloud.fuel_fills.del && Object.keys(cloud.fuel_fills.del).length),
     'del=' + JSON.stringify(cloud.fuel_fills.del));
  ok('B4 the disagreement is OFFERED (identical stored signature — the choice is the resolution)',
     !!orphanFor(phone, 'fuel_fills', 'id:f-2'), 'orphans=' + JSON.stringify(orphansOf(phone)));
  let resolved = false;
  try { resolved = phone.CS.resolveOrphan('fuel_fills', 'id:f-2', true) === true; } catch (e) {}
  ok('B5 keep resolves it', resolved);
  await cycle(phone);
  ok('B6 the kept rollback record does not re-offer',
     !orphanFor(phone, 'fuel_fills', 'id:f-2'), 'orphans=' + JSON.stringify(orphansOf(phone)));
  ok('B7 the record still stands everywhere after the keep',
     JSON.stringify(docIds(cloud.fuel_fills.v)) === '["f-1","f-2"]' &&
     JSON.stringify(docIds(phone.store.get('fuel_fills', []))) === '["f-1","f-2"]');
}

/* ---------------- World D — the documents exclusion ----------------
 * The phone's local vault is empty and SETTLED (no local write
 * in flight), while its agreed shadow names both documents and
 * the cloud holds them. On the shipped bytes the union honors
 * the shadow as a pending deletion forever (and a landed push
 * tombstones both account-wide); the fix prunes spent shadow
 * ids on a settled key, so the account's records land. */
async function worldD() {
  console.log('\n== World D — documents held out by this phone\'s own settled shadow ==');
  const cloud = makeCloud(baseCloud({ docs_items: { v: [DOC1, DOC2] } }));
  const web = makeDevice(cloud, {
    local: baseLocal([['docs_items', [DOC1, DOC2]]]),
    meta: agreedMeta({ docs_items: ['id:doc-cvsa-1', 'id:doc-cvsa-2'] })
  });
  const phone = makeDevice(cloud, {
    local: baseLocal([['docs_items', []]]),
    meta: agreedMeta({ docs_items: ['id:doc-cvsa-1', 'id:doc-cvsa-2'] })
  });
  await sleep(400);
  await cycle(phone);
  ok('D1 the filed documents land on the phone (the settled shadow no longer holds them out)',
     JSON.stringify(docIds(phone.store.get('docs_items', []))) === '["doc-cvsa-1","doc-cvsa-2"]',
     'phone=' + JSON.stringify(docIds(phone.store.get('docs_items', []))));
  ok('D2 the cloud keeps both documents and NO tombstone is authored by anyone',
     JSON.stringify(docIds(cloud.docs_items.v)) === '["doc-cvsa-1","doc-cvsa-2"]' &&
     !(cloud.docs_items.del && Object.keys(cloud.docs_items.del).length),
     'cloud=' + JSON.stringify(docIds(cloud.docs_items.v)) + ' del=' + JSON.stringify(cloud.docs_items.del && Object.keys(cloud.docs_items.del)));
  ok('D3 no disagreement is left dangling for the landed documents',
     !orphanFor(phone, 'docs_items', 'id:doc-cvsa-1') && !orphanFor(phone, 'docs_items', 'id:doc-cvsa-2'),
     'orphans=' + JSON.stringify(orphansOf(phone)));
  await cycle(web, phone);
  ok('D4 the documents stand everywhere after further cycles',
     JSON.stringify(docIds(web.store.get('docs_items', []))) === '["doc-cvsa-1","doc-cvsa-2"]' &&
     JSON.stringify(docIds(phone.store.get('docs_items', []))) === '["doc-cvsa-1","doc-cvsa-2"]' &&
     JSON.stringify(docIds(cloud.docs_items.v)) === '["doc-cvsa-1","doc-cvsa-2"]');
}

/* ------------- World D2 — a fresh deliberate delete still executes -------------
 * The prune must never disarm the honor where it is real: a
 * delete the user just made on this device is a DIRTY key
 * (attach()'s store wrapper stamps the write), so the shadow
 * stands and the push carries the deletion + tombstone. */
async function worldD2() {
  console.log('\n== World D2 — a fresh deliberate documents delete still executes ==');
  const cloud = makeCloud(baseCloud({ docs_items: { v: [DOC1] } }));
  const phone = makeDevice(cloud, {
    local: baseLocal([['docs_items', [DOC1]]]),
    meta: agreedMeta({ docs_items: ['id:doc-cvsa-1'] })
  });
  await sleep(400);
  phone.store.set('docs_items', []); // the module delete — a local write, dirty by construction
  await cycle(phone);
  ok('D2.1 the deliberate delete removes the document from the cloud',
     (cloud.docs_items.v || []).length === 0, 'cloud=' + JSON.stringify(docIds(cloud.docs_items.v)));
  ok('D2.2 the deletion is tombstoned (web 404 behavior intact)',
     !!(cloud.docs_items.del && cloud.docs_items.del['id:doc-cvsa-1']),
     'del=' + JSON.stringify(cloud.docs_items.del && Object.keys(cloud.docs_items.del)));
  ok('D2.3 no orphan offer is raised for a deletion this device just made',
     !orphanFor(phone, 'docs_items', 'id:doc-cvsa-1'), 'orphans=' + JSON.stringify(orphansOf(phone)));
}

/* ---------------- source pins ---------------- */
function sourcePins() {
  console.log('\n== Source pins — the surface is wired ==');
  ok('S1 status() carries the orphan offers',
     csSrc.indexOf('orphans:') >= 0 && csSrc.indexOf('m.orphans') >= 0);
  ok('S2 the resolver is exported', csSrc.indexOf('S.resolveOrphan') >= 0);
  ok('S3 Preferences renders the orphan choice with both buttons',
     prefSrc.indexOf('resolveOrphan') >= 0 && prefSrc.indexOf('orphans') >= 0);
}

(async function () {
  await worldE();
  await worldE2();
  await worldB();
  await worldD();
  await worldD2();
  sourcePins();
  console.log('\ndelete-pretombstone-nov10: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('BENCH ERROR', e && e.stack || e); process.exit(2); });
