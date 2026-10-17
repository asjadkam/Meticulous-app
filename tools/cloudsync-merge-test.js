#!/usr/bin/env node
/* Meticulous v107 — PHONE/CLOUD CONVERGENCE (Stage 8 of the
 * Oct 16 overnight program).
 *
 * Oct 16's divergence: the phone sat on DEFAULTS — Revenue $0,
 * tracker auto-start OFF / 6 AM, Preferences defaults, province
 * 'Alberta' held ONLY on the phone — while the cloud held
 * everything else. Mechanism (proven from js/cloudsync.js): a
 * fresh local copy materializes default values stamped with a
 * NEWER local timestamp than the cloud's real values, so the
 * whole-key "latest wins" merge kept the defaults and the flush
 * pushed them up over the cloud.
 *
 * The fix, driven here against the REAL cloudsync.js:
 *  (A) first pull for a uid — 'onboarding' merges field-by-field:
 *      the cloud's SET company details land despite the phone's
 *      newer whole-key stamp, and the phone's SET province
 *      survives the cloud's unset one (and stays dirty, to push
 *      up). A generic key that is locally EMPTY takes the cloud
 *      value on first pull regardless of timestamps.
 *  (B) established sync, local genuinely newer (both set): the
 *      local value wins (the guard), a cloud-only field still
 *      merges in.
 *  (C) established sync, cloud genuinely newer (both set): the
 *      cloud value wins.
 * Run: node tools/cloudsync-merge-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function eq(name, got, want) {
  if (String(got) === String(want)) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}

const csSrc = fs.readFileSync(path.join(ROOT, 'js', 'cloudsync.js'), 'utf8');
const NOW = Date.now();

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
  return { sb: sb, data: data, get: function (k) { const r = localStorage.getItem('mt_' + k); return r === null ? null : JSON.parse(r); } };
}
function settle() { return new Promise(function (r) { setTimeout(r, 350); }); }

(async function () {
  console.log('\n— (A) first pull: defaults never beat data, set never loses to unset —');
  {
    const w = makeWorld({
      local: [
        ['onboarding', { accountType: 'Owner-Operator', companyName: '', gst: '', payRate: '', homeProvince: 'Alberta', userRole: 'driver' }],
        ['tracker', {}]
      ],
      meta: { uid: null, keys: {
        onboarding: { t: NOW, s: 0, u: null },       // first-run defaults, stamped NOW
        tracker: { t: NOW, s: 0, u: null }
      } },
      docs: [
        { id: 'onboarding', v: { accountType: 'Owner-Operator', companyName: 'Asjad Kamal', gst: 'SET-ON-CLOUD', payRate: '29', userRole: 'driver' }, updatedAt: NOW - 86400000 },
        { id: 'tracker', v: { autoStart: true, autoStartTime: '08:00' }, updatedAt: NOW - 86400000 }
      ]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const ob = w.get('onboarding');
    eq("the cloud's set company name lands over the phone's blank default", ob.companyName, 'Asjad Kamal');
    eq("the cloud's set pay rate lands", ob.payRate, '29');
    eq("the phone's set province survives the cloud's unset one", ob.homeProvince, 'Alberta');
    eq('fields set on both sides keep a value (account type)', ob.accountType, 'Owner-Operator');
    const tk = w.get('tracker');
    eq('an EMPTY local key takes the cloud value on first pull (auto-start ON)', tk.autoStart, true);
    eq('…with its time', tk.autoStartTime, '08:00');
    const obPush = w.sb.__pushes.filter(function (p) { return p.id === 'onboarding'; })[0];
    ok('the merged union PUSHES UP to the cloud', !!obPush);
    eq('…carrying the phone-only province with it', obPush && obPush.v.homeProvince, 'Alberta');
    eq('…and the cloud-only company name', obPush && obPush.v.companyName, 'Asjad Kamal');
  }

  console.log('\n— (B) established sync: a genuinely newer local value still wins —');
  {
    const w = makeWorld({
      local: [['onboarding', { companyName: 'New Co', homeProvince: 'Alberta' }]],
      meta: { uid: 'u1', globallySynced: true, keys: { onboarding: { t: NOW, s: NOW - 90000, u: 'u1' } } },
      docs: [{ id: 'onboarding', v: { companyName: 'Old Co', gst: 'CLOUD-GST' }, updatedAt: NOW - 10000 }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const ob = w.get('onboarding');
    eq('the newer local company name is NOT overwritten', ob.companyName, 'New Co');
    eq('a cloud-only set field still merges in', ob.gst, 'CLOUD-GST');
    eq('the local province stands', ob.homeProvince, 'Alberta');
  }

  console.log('\n— (C) established sync: a genuinely newer cloud value wins —');
  {
    const w = makeWorld({
      local: [['onboarding', { companyName: 'Phone Co', homeProvince: 'Alberta' }]],
      meta: { uid: 'u1', globallySynced: true, keys: { onboarding: { t: NOW - 50000, s: NOW - 90000, u: 'u1' } } },
      docs: [{ id: 'onboarding', v: { companyName: 'Cloud Co' }, updatedAt: NOW - 1000 }]
    });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle();
    const ob = w.get('onboarding');
    eq('the newer cloud company name wins', ob.companyName, 'Cloud Co');
    eq("…and the phone's set province still survives (cloud unset)", ob.homeProvince, 'Alberta');
  }

  console.log('\ncloudsync-merge: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
