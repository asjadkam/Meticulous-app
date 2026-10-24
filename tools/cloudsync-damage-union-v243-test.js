#!/usr/bin/env node
/* Meticulous v243 — DAMAGE RECORDS JOIN THE RECORD-UNION
 * (owner, Fri Oct 23, 2026 21:15 MDT): Connect → Send doc →
 * "Damage photo" showed "No damage photos saved yet" for
 * reports he HAS saved. The picker reads the same local key
 * the Damage module writes (dmg_reports), so an empty picker
 * with saved reports means the records left the local store —
 * and dmg_reports was the one record list the v241 union
 * (FUEL-HISTORY-LOST) did not cover: at pull time it took the
 * generic whole-key rule, so a rolled-back cloud copy stamped
 * fresh (written by a stale store instance before the real
 * saves reached it) replaced the phone's list wholesale.
 * Same class, same fix: dmg_reports merges by record identity
 * at pull; neither side loses a record; the more complete
 * copy (the one carrying the photo) wins.
 *
 * Damage records carry no id and no ISO date — identity is
 * the content fingerprint (tab + description + timestamp +
 * dispatch), photo excluded, the same pattern rev_extras
 * uses for id-less records.
 *
 * Run: node tools/cloudsync-damage-union-v243-test.js
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

/* the module's real write shape (modules/damage.js) */
const D1 = { tab: 'equipment', desc: 'Cracked mirror', photo: 'data:image/jpeg;base64,DMG1', at: '2026-10-21, 4:12:00 p.m.', dispatch: '' };
const D2 = { tab: 'load', desc: 'Torn tarp strap', photo: 'data:image/jpeg;base64,DMG2', at: '2026-10-22, 5:42:03 p.m.', dispatch: 'Pit → Site' };
const D2_NOPHOTO = { tab: 'load', desc: 'Torn tarp strap', photo: '', at: '2026-10-22, 5:42:03 p.m.', dispatch: 'Pit → Site' };

(async function () {
  /* ---- D-U1: a rolled-back cloud copy can no longer eat local damage reports ---- */
  {
    const w = makeWorld({
      local: [['dmg_reports', [D1, D2]]],
      meta: { uid: 'u1', keys: { dmg_reports: { t: 1000, s: 1000, u: 'u1' } } },
      docs: [{ id: 'dmg_reports', v: [D1], updatedAt: 2000 }] /* stale content, newer stamp */
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const recs = w.get('dmg_reports');
    eq('D-U1 both damage reports survive the pull', recs && recs.length, 2);
    ok('D-U1 the newer report (the one the picker could not find) is still there',
      !!recs && recs.some(function (r) { return r.desc === 'Torn tarp strap'; }));
    const pushed = w.pushes.filter(function (p) { return p.id === 'dmg_reports'; });
    ok('D-U1 the union pushes UP (the cloud copy heals too)',
      pushed.length > 0 && pushed[pushed.length - 1].v.length === 2,
      JSON.stringify(w.pushes.map(function (p) { return p.id; })));
  }

  /* ---- D-U2: same record both sides — the copy WITH the photo wins ---- */
  {
    const w = makeWorld({
      local: [['dmg_reports', [D1, D2]]],
      meta: { uid: 'u1', keys: { dmg_reports: { t: 1000, s: 1000, u: 'u1' } } },
      docs: [{ id: 'dmg_reports', v: [D1, D2_NOPHOTO], updatedAt: 2000 }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const recs = w.get('dmg_reports');
    eq('D-U2 still exactly two reports (no duplicate from the fingerprint)', recs && recs.length, 2);
    const d2 = recs && recs.filter(function (r) { return r.desc === 'Torn tarp strap'; })[0];
    ok('D-U2 the surviving copy carries the photo', !!(d2 && d2.photo === 'data:image/jpeg;base64,DMG2'),
      JSON.stringify(d2));
  }

  /* ---- D-U3: a report that exists only in the cloud still arrives ---- */
  {
    const w = makeWorld({
      local: [['dmg_reports', [D1]]],
      meta: { uid: 'u1', keys: { dmg_reports: { t: 1000, s: 1000, u: 'u1' } } },
      docs: [{ id: 'dmg_reports', v: [D1, D2], updatedAt: 2000 }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const recs = w.get('dmg_reports');
    eq('D-U3 the cloud-only report lands locally', recs && recs.length, 2);
  }

  console.log('\ncloudsync-damage-union-v243: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
