/* fuel-list-stale-v289-test.js — FUEL-LIST-STALE (owner report Oct 30,
 * 2026, 16:12 MDT: "Why is this never upto date?"). His Fuel list's
 * newest entry is 2026-10-22 (38.970 L / $86.86 / odo 170079 / Mobil),
 * then another Oct 22, then Oct 20, "56 more fill-ups" — nothing after
 * Oct 22 renders though the truck worked and fuelled since (closes
 * Oct 26 odo 170,229, Oct 29 odo 170,632).
 *
 * Suspect proven here: pushOne's oversized guard runs BEFORE the
 * record-list branch — when the fuel_fills value (59 fills, receipt
 * photos riding inside the records as data URLs) grows past
 * MAX_DOC_BYTES (900,000), every push is skipped AND the key is
 * sealed clean (km.s = km.t), so the cloud copy freezes at the last
 * state that fit while sync claims success. Fills keep saving
 * locally, but the backup never moves again — and the first local
 * loss after that (an install wiping the slot, an eviction) restores
 * the frozen cloud copy wholesale through the pull's raw===null
 * install branch: the list stops at Oct 22 on phone AND cloud, the
 * exact signature of Oct 20–22, Oct 26, and now Oct 30.
 *
 * Scenario A drives the REAL cloudsync.js in a vm (the v272 harness
 * pattern): a settled world at Oct 22 whose fuel_fills JSON exceeds
 * the byte cap, three post-Oct-22 saves through the store door the
 * module itself uses, then sync cycles, then a local wipe + restore.
 *   RED on the pre-fix tree: no cloud write for fuel_fills at all;
 *   the meta claims the key synced; after the wipe the restored
 *   list's newest date is 2026-10-22 and the count is back to 59-3.
 *   GREEN after the fix: the union is written (photo-stripped sync
 *   copy, facts complete, size inside the cap); after the wipe the
 *   restored list runs through 2026-10-29; a second sync cycle
 *   pushes nothing more (the key seals for real this time).
 * Scenario B pins the fix's safety: a fill that exists locally WITH
 * its receipt photo keeps the photo through a pull against the
 * photo-stripped cloud copy (merge completeness), and the Oct 15
 * duplicate pair (the v188 four-facts twins — same date/station/
 * amount, different litres/odo, one carrying the bogus 519,326
 * odometer) survives every merge as TWO records.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MAX_DOC_BYTES = 900000;

let pass = 0, fail = 0;
function ck(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function settle(ms) { const end = Date.now() + ms; while (Date.now() < end) await wait(60); }

/* Mirror of cloudsync's fuel_fills identity (date/time/litres/cost/
 * station/odo, undefined -> null), same as the v272 harness. */
function fuelId(rec) {
  const F = ['date', 'time', 'litres', 'cost', 'station', 'odo'];
  return 'fp:' + JSON.stringify(F.map((f) => (rec[f] === undefined ? null : rec[f])));
}
function fill(date, time, litres, cost, station, odo, photo) {
  const r = { date, time, litres, cost, station };
  if (odo !== undefined && odo !== null) r.odo = odo;
  if (photo) r.photo = photo;
  r.read = 'power';
  return r;
}
const PHOTO = 'data:image/jpeg;base64,' + 'A'.repeat(120000);

/* His book at Oct 22: 59 fills total. 53 routine fills (Jun–Oct),
 * the Oct 15 v188 duplicate pair, the Oct 20 fill and the two
 * Oct 22 fills his screenshot shows on top. Eight records carry
 * receipt photos, which is what pushes the array past the cap. */
function bookAtOct22() {
  const out = [];
  for (let i = 0; i < 54; i++) {
    const d = new Date(Date.UTC(2026, 5, 1) + i * 2.5 * 86400000);
    const ds = d.toISOString().slice(0, 10);
    out.push(fill(ds, '08:0' + (i % 10), 40 + i, 90 + i, i % 2 ? 'Petro-Canada' : 'Mobil', 160000 + i * 180,
      i % 7 === 0 ? PHOTO : null));
  }
  /* The v188 pair: Oct 15, Mobil, $193.80 twice — genuine ~170k copy
   * and the bogus odo 519,326 copy. Distinct litres/odo = distinct
   * identities; P&L counts the pair once by its own rule (untouched
   * here); the LIST must keep both. */
  out.push(fill('2026-10-15', '09:12', 85.612, 193.80, 'Mobil', 170112, PHOTO));
  out.push(fill('2026-10-15', '09:12', 86.100, 193.80, 'Mobil', 519326, PHOTO));
  out.push(fill('2026-10-20', '07:41', 104.036, 239.18, 'Petro-Canada', 169775, null));
  out.push(fill('2026-10-22', '12:47', 99.047, 239.59, 'Petro-Canada Roadking', 169999, null));
  out.push(fill('2026-10-22', '17:13', 38.970, 86.86, 'Mobil @ 1739', 170079, PHOTO));
  return out;
}
const F_OCT24 = fill('2026-10-24', '08:15', 61.204, 141.55, 'Mobil', 170301, PHOTO);
const F_OCT26 = fill('2026-10-26', '16:02', 88.410, 204.10, 'Petro-Canada', 170229, null);
const F_OCT29 = fill('2026-10-29', '07:58', 95.730, 219.87, 'Mobil', 170632, PHOTO);

function makeWorld(seedFills, cloudFills, shared) {
  const data = {};
  if (seedFills) {
    data['mt_fuel_fills'] = JSON.stringify(seedFills);
    data['mt___syncmeta'] = JSON.stringify({
      uid: 'u1', globallySynced: true,
      keys: { fuel_fills: { t: 1000, s: 1000, u: 'u1', sh: seedFills.map(fuelId) } }
    });
  }
  const cloudDocs = shared ? shared.cloudDocs
    : { fuel_fills: { id: 'fuel_fills', v: JSON.parse(JSON.stringify(cloudFills)), updatedAt: 1000, mt: 'fuel_fills' } };
  const pushes = shared ? shared.pushes : [];
  const sb = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error, parseInt, parseFloat, isNaN
  };
  sb.window = sb; sb.self = sb;
  sb.navigator = { onLine: true };
  sb.document = { visibilityState: 'visible', addEventListener() {}, createElement() { return { style: {}, classList: { add() {}, remove() {} } }; }, body: { appendChild() {} }, getElementById() { return null; } };
  sb.addEventListener = function () {};
  sb.localStorage = {
    getItem(k) { return k in data ? data[k] : null; },
    setItem(k, v) { data[k] = String(v); },
    removeItem(k) { delete data[k]; },
    key(i) { return Object.keys(data)[i]; },
    get length() { return Object.keys(data).length; }
  };
  sb.FB = {
    ready: true,
    user: { uid: 'u1' },
    currentUser: { uid: 'u1' },
    loadDocs() { return Promise.resolve(Object.keys(cloudDocs).map((k) => cloudDocs[k])); },
    loadDoc(col, id) { const d = cloudDocs[id]; return Promise.resolve(d ? JSON.parse(JSON.stringify(d)) : null); },
    saveDoc(col, id, doc) {
      pushes.push({ id, size: JSON.stringify(doc.v).length });
      cloudDocs[id] = Object.assign({}, doc, { id, updatedAt: Date.now(), mt: id });
      return Promise.resolve();
    },
    deleteDoc(col, id) { delete cloudDocs[id]; return Promise.resolve(); }
  };
  const held = {};
  const store = {
    get(k, d) { try { const v = sb.localStorage.getItem('mt_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { held[k] = v; sb.localStorage.setItem('mt_' + k, JSON.stringify(v)); },
    remove(k) { delete held[k]; sb.localStorage.removeItem('mt_' + k); }
  };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'cloudsync.js'), 'utf8'), sb, { filename: 'cloudsync.js' });
  sb.CloudSync.attach(store);
  return { sb, store, data, cloudDocs, pushes };
}
function metaOf(w) { return JSON.parse(w.data['mt___syncmeta']); }
function cloudFills(w) { return (w.cloudDocs.fuel_fills && w.cloudDocs.fuel_fills.v) || []; }
function localFills(w) { return JSON.parse(w.data['mt_fuel_fills'] || '[]'); }
function newestDate(fills) { return fills.map((f) => f.date).sort().pop(); }

(async function () {
  console.log('FUEL-LIST-STALE v289 — post-Oct-22 fills must reach the cloud and survive a restore');
  const book = bookAtOct22();
  const bookJson = JSON.stringify(book);
  ck('fixture: the Oct-22 book exceeds the one-doc byte cap (photos ride inside the records)',
    bookJson.length > MAX_DOC_BYTES, 'len=' + bookJson.length);
  ck('fixture: the Oct-22 book holds 59 fills', book.length === 59, 'n=' + book.length);

  /* ---------- Scenario A: the freeze, then the rollback ---------- */
  console.log('Scenario A — saves after Oct 22, sync, local wipe, restore');
  {
    const w = makeWorld(book, book);
    await w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(1200);
    /* He fuels three more times; each save goes through the store
     * door the Fuel module's Save fill-up handler uses. */
    const cur = JSON.parse(JSON.stringify(book));
    cur.push(F_OCT24, F_OCT26, F_OCT29);
    w.store.set('fuel_fills', cur);
    await settle(3600);
    if (typeof w.sb.CloudSync.syncNow === 'function') { w.sb.CloudSync.syncNow(); await settle(1500); }

    const cf = cloudFills(w);
    const cids = cf.map(fuelId);
    ck('A1 the cloud copy gains the Oct 24 fill after sync', cids.indexOf(fuelId(F_OCT24)) >= 0);
    ck('A2 the cloud copy gains the Oct 26 fill after sync', cids.indexOf(fuelId(F_OCT26)) >= 0);
    ck('A3 the cloud copy gains the Oct 29 fill after sync', cids.indexOf(fuelId(F_OCT29)) >= 0);
    ck('A4 the cloud copy holds all 62 fills', cf.length === 62, 'n=' + cf.length);
    const fw = w.pushes.filter((p) => p.id === 'fuel_fills');
    ck('A5 a fuel_fills write actually landed, sized inside the doc cap',
      fw.length >= 1 && fw.every((p) => p.size <= MAX_DOC_BYTES),
      'writes=' + fw.length + ' sizes=' + fw.map((p) => p.size).join(','));
    const km = metaOf(w).keys.fuel_fills;
    ck('A6 the key is sealed clean only because the write landed (s >= t, no standing failure)',
      km && km.s >= km.t && !(w.sb.CloudSync.getStandingPushFailure && w.sb.CloudSync.getStandingPushFailure()));

    /* A second full cycle pushes nothing more — the seal is real. */
    const before = w.pushes.filter((p) => p.id === 'fuel_fills').length;
    if (typeof w.sb.CloudSync.syncNow === 'function') { w.sb.CloudSync.syncNow(); await settle(1500); }
    ck('A7 a second sync cycle writes fuel_fills no further (no perpetual re-push)',
      w.pushes.filter((p) => p.id === 'fuel_fills').length === before,
      'before=' + before + ' after=' + w.pushes.filter((p) => p.id === 'fuel_fills').length);

    /* The local loss: a reinstall wipes the device — a FRESH world
     * (cold JS, empty storage) over the SAME cloud. Its first sync
     * installs the cloud copy wholesale: the list he sees after the
     * reinstall is whatever survived in the cloud. */
    const w2 = makeWorld(null, null, w);
    await w2.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(1800);
    const lf = localFills(w2);
    ck('A8 after the wipe + restore the list still holds all 62 fills', lf.length === 62, 'n=' + lf.length);
    ck('A9 the restored list newest entry is 2026-10-29, not 2026-10-22',
      newestDate(lf) === '2026-10-29', 'newest=' + newestDate(lf));
    const pair = lf.filter((f) => f.date === '2026-10-15' && f.cost === 193.80);
    ck('A10 the Oct 15 v188 duplicate pair survives as TWO records', pair.length === 2, 'n=' + pair.length);
  }

  /* ---------- Scenario B: photo-keep against a stripped cloud ---- */
  console.log('Scenario B — a local receipt photo is never stripped by a pull');
  {
    const withPhoto = fill('2026-10-29', '07:58', 95.730, 219.87, 'Mobil', 170632, PHOTO);
    const stripped = Object.assign({}, withPhoto); delete stripped.photo;
    const local = [fill('2026-10-26', '16:02', 88.410, 204.10, 'Petro-Canada', 170229, null), withPhoto];
    const cloud = [local[0], stripped];
    const w = makeWorld(local, cloud);
    await w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(1500);
    const lf = localFills(w);
    const kept = lf.filter((f) => f.date === '2026-10-29')[0];
    ck('B1 the local fill keeps its receipt photo through the pull', !!(kept && kept.photo === PHOTO));
    ck('B2 the local list keeps both fills', lf.length === 2, 'n=' + lf.length);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
