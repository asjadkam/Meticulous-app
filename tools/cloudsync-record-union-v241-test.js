#!/usr/bin/env node
/* Meticulous v241 — RECORD-UNION PULL (FUEL-HISTORY-LOST-
 * OCT20-22 + the sync half of SHIFT-CLOSE-DUP-ENTRY and
 * PTI-SIGNATURE-SAVE).
 *
 * The defect (owner, Oct 23, 15:09 MDT, his screenshot): Fuel
 * history on his phone stops at 2026-10-19 (90.259 L ·
 * $206.60) — the Oct 20 fill ($239.18) and Oct 22's TWO fills
 * (Petro $239.59 · Mobil $86.86), saved in the app that day,
 * are gone from the phone, and the dashboard Fuel glance
 * agrees. Same stamp-war family that wiped live miles Oct 22
 * and degraded the Connect day (v226): the pull's generic rule
 * replaces a whole key with the cloud copy whenever the cloud
 * stamp is newer and the local key is settled — even when that
 * cloud copy is a ROLLED-BACK one (written by a stale store
 * instance before the real saves ever reached it). For
 * append-only record lists that rule is wrong in the same way
 * v224 proved it wrong for livemiles/geoloads day maps: a pull
 * must never DELETE or roll back a record the device holds.
 *
 * The fix (js/cloudsync.js): the record-list keys —
 * fuel_fills, rev_entries, rev_extras, pti_reports, sessions —
 * merge at pull time by record identity (union; neither side
 * loses a record; when both sides hold the same record, the
 * MORE COMPLETE copy wins, so a signed PTI beats its bare
 * copy). The merged value stays dirty when it holds anything
 * the cloud lacks, so the union pushes UP and heals the cloud
 * copy too. Two guards keep the old semantics where they
 * matter: a locally DIRTY key (an edit/delete not yet flushed)
 * is left to the generic stamp rules for that cycle, and a key
 * whose recorded owner is a DIFFERENT account (shared phone)
 * is never unioned into this account's tree.
 *
 * v272 RE-PIN (FUEL-HISTORY-LOST-RECURRENCE): the DIRTY-key
 * guard above is RETIRED — it is the hole the loss recurred
 * through (a key is dirty from every save until its push
 * confirms; in that window the stamp war deleted the Oct 20 +
 * Oct 22 fills a second time). The union now runs in dirty
 * cycles too, and deliberate deletions are carried by the
 * per-key shadow (km.sh) instead: U5 below is re-pinned to
 * the new law — U5a (shadow on record: the delete is honored
 * in the dirty cycle, locally and in the push) and U5b (no
 * shadow on record — the first cycle after the v272 build:
 * the union keeps both records, because an absence it cannot
 * attribute must never be treated as a deletion; the delete
 * may need one repeat that cycle). The different-account
 * guard (U6) stands unchanged. The recurrence suite is
 * tools/fuel-history-recurrence-v272-test.js.
 *
 * Run: node tools/cloudsync-record-union-v241-test.js
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
  const pushes = [];
  sb.FB = {
    ready: true,
    user: { uid: 'u1' },
    loadDocs: function () { return Promise.resolve(opts.docs || []); },
    saveDoc: function (col, id, doc) { pushes.push({ id: id, v: doc.v }); return Promise.resolve({}); },
    deleteDoc: function () { return Promise.resolve({}); }
  };
  sb.__pushes = pushes;
  vm.createContext(sb);
  vm.runInContext(csSrc, sb);
  const store = {
    get: function (k, d) { const r = localStorage.getItem('mt_' + k); return r === null ? d : JSON.parse(r); },
    set: function (k, v) { localStorage.setItem('mt_' + k, JSON.stringify(v)); return true; },
    del: function (k) { localStorage.removeItem('mt_' + k); return true; }
  };
  sb.CloudSync.attach(store);
  return { sb: sb, data: data, pushes: pushes,
    get: function (k) { const r = localStorage.getItem('mt_' + k); return r === null ? null : JSON.parse(r); } };
}
function settle() { return new Promise(function (r) { setTimeout(r, 400); }); }

/* his real fills (day records, Oct 14-23 log) */
const F_OCT19 = { date: '2026-10-19', litres: 90.259, cost: 206.60, station: 'Petro-Canada', odo: 169200 };
const F_OCT20 = { date: '2026-10-20', litres: 99.0, cost: 239.18, station: 'Petro-Canada', odo: 169500 };
const F_OCT22A = { date: '2026-10-22', time: '12:47', litres: 99.047, cost: 239.59, station: 'Petro-Canada Roadking', odo: 169999 };
const F_OCT22B = { date: '2026-10-22', time: '17:13', litres: 38.970, cost: 86.86, station: 'Mobil @ 1739', odo: 170079 };

(async function () {
  /* ---- U1: FUEL — a rolled-back cloud copy can no longer eat local fills ---- */
  {
    const w = makeWorld({
      local: [['fuel_fills', [F_OCT19, F_OCT20, F_OCT22A, F_OCT22B]]],
      meta: { uid: 'u1', keys: { fuel_fills: { t: 1000, s: 1000, u: 'u1' } } },
      docs: [{ id: 'fuel_fills', v: [F_OCT19], updatedAt: 2000 }] /* stale content, newer stamp */
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const fills = w.get('fuel_fills');
    eq('U1 all four fills survive the pull', fills && fills.length, 4);
    ok('U1 the Oct 22 Mobil fill is still there',
      !!fills && fills.some(function (f) { return f.cost === 86.86; }));
    const pushed = w.pushes.filter(function (p) { return p.id === 'fuel_fills'; });
    ok('U1 the union pushes UP (the cloud copy heals too)',
      pushed.length > 0 && pushed[pushed.length - 1].v.length === 4,
      JSON.stringify(w.pushes.map(function (p) { return p.id; })));
  }

  /* ---- U2: PTI — the signed copy of a report beats the bare copy ---- */
  {
    const signed = { id: 'pti1', date: '2026-10-22', signed: true, signedName: 'Asjad Kamal',
      signature: 'data:image/jpeg;base64,SIG', plate: '04 R209', odometer: 170079 };
    const bare = { id: 'pti1', date: '2026-10-22', signed: true, signedName: 'Asjad Kamal',
      signature: '', plate: '', odometer: 170079 };
    const second = { id: 'pti2', date: '2026-10-22', signed: true, signature: 'data:image/jpeg;base64,SIG2', plate: '04 R209' };
    const w = makeWorld({
      local: [['pti_reports', [signed, second]]],
      meta: { uid: 'u1', keys: { pti_reports: { t: 1000, s: 1000, u: 'u1' } } },
      docs: [{ id: 'pti_reports', v: [bare], updatedAt: 2000 }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const reps = w.get('pti_reports');
    eq('U2 both reports survive', reps && reps.length, 2);
    const r1 = reps && reps.filter(function (r) { return r.id === 'pti1'; })[0];
    eq('U2 the surviving copy carries the signature', r1 && r1.signature, 'data:image/jpeg;base64,SIG');
    eq('U2 the surviving copy carries the plate', r1 && r1.plate, '04 R209');
  }

  /* ---- U3: REVENUE — the completion entry survives a rolled-back pull ---- */
  {
    const completion = { date: '2026-10-22', amount: '319.00', type: 'hourly', hours: '11.00', dspId: 'd-oct22', note: 'Dispatch: Aecon Inf' };
    const auto = { date: '2026-10-22', amount: '270.51', type: 'hourly', hours: '9.33', auto: true, note: 'Auto from tracker' };
    const w = makeWorld({
      local: [['rev_entries', [completion, auto]]],
      meta: { uid: 'u1', keys: { rev_entries: { t: 1000, s: 1000, u: 'u1' } } },
      docs: [{ id: 'rev_entries', v: [auto], updatedAt: 2000 }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const ents = w.get('rev_entries');
    eq('U3 both entries survive the pull', ents && ents.length, 2);
    ok('U3 the completion entry is among them',
      !!ents && ents.some(function (e) { return e.dspId === 'd-oct22'; }));
  }

  /* ---- U4: SESSIONS — a day session the cloud lacks survives ---- */
  {
    const s1 = { date: '2026-10-21', seconds: 37800, endedAt: '2026-10-21T23:15:00.000Z' };
    const s2 = { date: '2026-10-22', seconds: 33580, endedAt: '2026-10-22T23:19:00.000Z' };
    const w = makeWorld({
      local: [['sessions', [s1, s2]]],
      meta: { uid: 'u1', keys: { sessions: { t: 1000, s: 1000, u: 'u1' } } },
      docs: [{ id: 'sessions', v: [s1], updatedAt: 2000 }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    eq('U4 both sessions survive', (w.get('sessions') || []).length, 2);
  }

  /* ---- U5: GUARD, RE-PINNED v272 — a pending delete is honored
         through the shadow, in the dirty cycle itself ---- */
  {
    /* record identities, mirroring recordIdentity() for fuel_fills */
    const fuelId = function (rec) {
      const fields = ['date', 'time', 'litres', 'cost', 'station', 'odo'];
      return 'fp:' + fields.map(function (k) {
        return k + '=' + JSON.stringify(rec[k] === undefined ? null : rec[k]);
      }).join('|');
    };
    const w = makeWorld({
      local: [['fuel_fills', [F_OCT19]]], /* F_OCT20 just deleted here, not yet flushed */
      meta: { uid: 'u1', keys: { fuel_fills: { t: 3000, s: 1000, u: 'u1', sh: [fuelId(F_OCT19), fuelId(F_OCT20)] } } },
      docs: [{ id: 'fuel_fills', v: [F_OCT19, F_OCT20], updatedAt: 2000 }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    eq('U5a the deleted fill stays deleted in the dirty cycle (shadow law)',
      (w.get('fuel_fills') || []).length, 1);
    const pushed = w.pushes.filter(function (p) { return p.id === 'fuel_fills'; });
    ok('U5a the delete propagates UP (the pushed doc lacks it too)',
      pushed.length > 0 && pushed[pushed.length - 1].v.length === 1);
  }

  /* ---- U5b: NO SHADOW ON RECORD (first cycle after the v272
         build) — an unattributable absence is never treated as
         a deletion; the union keeps both records ---- */
  {
    const w = makeWorld({
      local: [['fuel_fills', [F_OCT19]]],
      meta: { uid: 'u1', keys: { fuel_fills: { t: 3000, s: 1000, u: 'u1' } } },
      docs: [{ id: 'fuel_fills', v: [F_OCT19, F_OCT20], updatedAt: 2000 }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    eq('U5b with no shadow recorded, the union keeps both fills (a delete that cycle may need one repeat)',
      (w.get('fuel_fills') || []).length, 2);
  }

  /* ---- U6: GUARD — another account's local records never union in ---- */
  {
    const w = makeWorld({
      local: [['fuel_fills', [F_OCT19, F_OCT20]]],
      meta: { uid: 'u1', keys: { fuel_fills: { t: 1000, s: 1000, u: 'someone-else' } } },
      docs: [{ id: 'fuel_fills', v: [F_OCT22A], updatedAt: 2000 }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    eq('U6 a foreign-owned local key seeds from this account\u2019s cloud copy instead',
      w.get('fuel_fills'), [F_OCT22A]);
  }

  /* ---- U7: GUARD — cloud-only records still come DOWN ---- */
  {
    const w = makeWorld({
      local: [['fuel_fills', [F_OCT19]]],
      meta: { uid: 'u1', keys: { fuel_fills: { t: 1000, s: 1000, u: 'u1' } } },
      docs: [{ id: 'fuel_fills', v: [F_OCT19, F_OCT20], updatedAt: 2000 }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    eq('U7 a fill only the cloud holds is restored to the phone',
      (w.get('fuel_fills') || []).length, 2);
  }

  console.log('\ncloudsync-record-union-v241 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
