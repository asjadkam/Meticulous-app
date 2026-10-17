#!/usr/bin/env node
/* Meticulous v136 — SYNC TRUTH ACCOUNTING.
 *
 * Owner evidence (Oct 17, 12:20–12:24 MDT): "this sync is not turning
 * green anymore" — his header dot sat amber all day and the Preferences
 * card read "Still syncing — give it a moment." Characterization of
 * the v135 engine (working-day replay, measured BEFORE this fix): with
 * the live writers running, the dot was green in 2 of 149 samples —
 * the settle rule "no pushable key dirty when the dot repaints" is
 * unreachable by construction, because livemiles (miles engine) and
 * geoloads (load counter) rewrite themselves every <=10s all shift.
 * And when pushes could not run at all (Firebase auth object gone),
 * the flusher early-returned silently: amber forever, lastError null.
 *
 * This suite drives the REAL js/cloudsync.js and proves the new
 * accounting:
 *  (1) a quiet device settles green, and the settle moment is
 *      remembered ("All synced · 12:41 PM");
 *  (2) THE WORKING DAY: telemetry writers running continuously +
 *      durable edits interleaved (dispatch, sessions, con_list — the
 *      v131/v132 keys) — the dot REACHES green during the day, the
 *      settle stamp advances, durable edits land in the cloud, and
 *      telemetry keeps syncing too (separation is accounting, never
 *      suppression);
 *  (3) telemetry alone behind never holds green hostage
 *      (telemetryBehind reports it instead);
 *  (4) a POISONED store becomes a NAMED failure (plain words, the
 *      key identified), other stores still settle, a healthy PULL
 *      does not clear the push failure, and a retry after healing
 *      recovers to green;
 *  (5) dead transport (auth object gone) with work waiting surfaces
 *      as a named failure after the grace window — not eternal
 *      amber — and recovers when transport returns;
 *  (6) offline surfaces at once as its own named state;
 *  (7) the Preferences card + tap-dot alert are faces of the same
 *      truth (source pins: both read CloudSync.status()).
 * Run: node tools/cloudsync-v136-test.js
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
const prefSrc = fs.readFileSync(path.join(ROOT, 'modules', 'preferences.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

/* A controllable clock: the engine's settle stamps, pull gap and
   blocked-grace read Date.now(); timers stay real. Base = today 12:41
   local so the settle label has a known wall-clock reading. */
const REAL_DATE = Date;
function makeFakeDate() {
  const base = new REAL_DATE();
  base.setHours(12, 41, 0, 0);
  let now = base.getTime();
  function FakeDate(ms) { this._ms = (ms === undefined) ? now : ms; }
  FakeDate.now = function () { return now; };
  FakeDate.advance = function (ms) { now += ms; };
  FakeDate.prototype.getHours = function () { return new REAL_DATE(this._ms).getHours(); };
  FakeDate.prototype.getMinutes = function () { return new REAL_DATE(this._ms).getMinutes(); };
  return FakeDate;
}

function makeWorld(opts) {
  opts = opts || {};
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
  const FakeDate = makeFakeDate();
  const sb = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, Promise: Promise, Date: FakeDate };
  sb.window = sb;
  sb.localStorage = localStorage;
  sb.navigator = { onLine: true };
  sb.document = { getElementById: function (id) { return id === 'syncDot' ? dotEl : null; }, addEventListener: function () {} };
  sb.addEventListener = function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); };
  const latency = opts.latency != null ? opts.latency : 40;
  const failKeys = {}; // docId -> error message; tests mutate via world.failKeys
  const pushes = [], deletes = [];
  sb.FB = {
    ready: true,
    user: { uid: 'u1' },
    loadDocs: function () { return new Promise(function (r) { setTimeout(function () { r(opts.docs || []); }, latency); }); },
    saveDoc: function (col, id, doc) {
      return new Promise(function (res, rej) {
        setTimeout(function () {
          if (failKeys[id]) rej(new Error(failKeys[id]));
          else { pushes.push({ id: id, v: doc.v }); res({}); }
        }, latency);
      });
    },
    deleteDoc: function (col, id) { return new Promise(function (r) { setTimeout(function () { deletes.push(id); r({}); }, latency); }); }
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
    sb: sb, store: store, dotEl: dotEl, failKeys: failKeys, pushes: pushes, deletes: deletes,
    FakeDate: FakeDate,
    fire: function (ev) { (listeners[ev] || []).forEach(function (fn) { fn(); }); },
    st: function () { return sb.CloudSync.status(); }
  };
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function () {
  console.log('\n— (1) quiet device: settles green, and the settle moment is remembered —');
  {
    const w = makeWorld({});
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await sleep(1200);
    let st = w.st();
    eq('signed in + nothing waiting -> state ok', st.state, 'ok');
    eq('the dot element agrees (synced class)', /synced/.test(w.dotEl.className), true);
    eq('settle stamp was recorded at 12:41', st.lastSettledLabel, '12:41 PM');
    eq('the dot title carries the settle time', w.dotEl.title, 'All synced · 12:41 PM');
    w.FakeDate.advance(5 * 60000);
    w.store.set('inv_list', [{ n: 1151 }]);
    st = w.st();
    eq('a durable edit paints syncing at once', st.state, 'syncing');
    await sleep(4200);
    st = w.st();
    eq('…and settles green once it is in the cloud', st.state, 'ok');
    eq('the settle stamp ADVANCED with the edit', st.lastSettledLabel, '12:46 PM');
    ok('the edit really reached the cloud', w.pushes.some(function (p) { return p.id === 'inv_list'; }));
  }

  console.log('\n— (2) THE WORKING DAY: telemetry churn + durable edits — green stays reachable —');
  {
    const w = makeWorld({ latency: 60 });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await sleep(1200);
    eq('day starts settled', w.st().state, 'ok');
    const stamps = {};
    stamps[w.st().lastSettledLabel] = 1;
    let tick = 0, editN = 0;
    const durableKeys = ['dsp_list', 'sessions', 'con_list', 'fuel_list'];
    const writer = setInterval(function () {
      tick++;
      w.store.set(tick % 2 ? 'livemiles' : 'geoloads', { snap: tick, at: tick });
    }, 250);
    const editor = setInterval(function () {
      editN++;
      const k = durableKeys[(editN - 1) % durableKeys.length];
      w.store.set(k, [{ edit: editN }]);
      w.FakeDate.advance(60000); // the day moves on a minute per edit
    }, 6000);
    const samples = { ok: 0, syncing: 0, err: 0, off: 0 };
    const sampler = setInterval(function () {
      const s = w.st();
      samples[s.state] = (samples[s.state] || 0) + 1;
      if (s.lastSettledLabel) stamps[s.lastSettledLabel] = 1;
    }, 200);
    await sleep(20000);
    clearInterval(writer); clearInterval(editor); clearInterval(sampler);
    console.log('    samples: ' + JSON.stringify(samples));
    ok('green is REACHED during the working day (>=30% of samples)', samples.ok >= 30,
      'ok=' + samples.ok + ' of ' + (samples.ok + samples.syncing + samples.err + samples.off));
    eq('never a false failure during honest work', samples.err, 0);
    ok('the settle stamp advanced during the day', Object.keys(stamps).length >= 2, Object.keys(stamps).join(','));
    ok('durable edits landed in the cloud MID-day (the 6s + 12s edits, flushed while writers ran)',
      ['dsp_list', 'sessions'].every(function (k) {
        return w.pushes.some(function (p) { return p.id === k; });
      }));
    ok('telemetry kept syncing too (accounting separation, not suppression)',
      w.pushes.some(function (p) { return p.id === 'livemiles'; }) && w.pushes.some(function (p) { return p.id === 'geoloads'; }));
    await sleep(5000);
    eq('once the truck stops, it settles green', w.st().state, 'ok');
    ok('…and the last durable edit (con_list, written at the window edge) is in the cloud too',
      w.pushes.some(function (p) { return p.id === 'con_list'; }));
  }

  console.log('\n— (3) telemetry alone behind: green holds, telemetryBehind tells the truth —');
  {
    const w = makeWorld({ latency: 60 });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await sleep(1200);
    w.store.set('livemiles', { snap: 1 });
    const st = w.st();
    eq('a live-miles snapshot in its debounce does NOT block green', st.state, 'ok');
    eq('…but status says tracking is behind', st.telemetryBehind, true);
    eq('…and names it in the telemetry list', st.telemetryDirtyKeys.join(','), 'livemiles');
    eq('the durable list is empty', st.durableDirtyKeys.length, 0);
    await sleep(4200);
    eq('telemetry catches up and clears', w.st().telemetryBehind, false);
  }

  console.log('\n— (4) poisoned store: NAMED failure, pull cannot clear it, retry recovers —');
  {
    const w = makeWorld({ latency: 40 });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await sleep(1200);
    w.failKeys['fuel_list'] = 'permission-denied: rules reject this doc';
    w.store.set('fuel_list', [{ L: 88.1 }]);
    w.store.set('inv_list', [{ n: 1152 }]);
    // his phone re-arms flushes constantly via the live writers; so does this replay
    const nudger = setInterval(function () { w.store.set('livemiles', { snap: Date.now() % 1000 }); }, 1000);
    await sleep(9000);
    let st = w.st();
    eq('a repeatedly failing store paints the failure state', st.state, 'err');
    eq('…naming the failing key', st.failKey, 'fuel_list');
    eq('…in plain words', st.failPlain, 'a fuel entry');
    eq('the dot element agrees (syncerr class)', /syncerr/.test(w.dotEl.className), true);
    ok('healthy stores still backed up meanwhile', w.pushes.some(function (p) { return p.id === 'inv_list'; }));
    // a healthy PULL must not clear a PUSH failure (v135 wart)
    w.FakeDate.advance(61000); // past the pull gap so the pull really runs
    await w.sb.CloudSync.pull();
    await sleep(300);
    st = w.st();
    eq('after a healthy pull the failure STILL stands', st.state, 'err');
    eq('…still naming the same store', st.failKey, 'fuel_list');
    // heal + retry -> recovery
    delete w.failKeys['fuel_list'];
    w.sb.CloudSync.syncNow();
    await sleep(5000);
    clearInterval(nudger);
    st = w.st();
    eq('after healing + retry, green returns', st.state, 'ok');
    eq('the failure record is gone', st.failKey, null);
    ok('the once-poisoned store is in the cloud now', w.pushes.some(function (p) { return p.id === 'fuel_list'; }));
  }

  console.log('\n— (5) dead transport: named failure after the grace window, never eternal amber —');
  {
    const w = makeWorld({ latency: 40 });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await sleep(1200);
    eq('settled before the transport dies', w.st().state, 'ok');
    w.sb.CloudSync._BLOCKED_GRACE_MS = 500;
    w.sb.FB.user = null; // Firebase auth object gone; CloudSync still holds the uid
    w.store.set('inv_list', [{ n: 2001 }]);
    await sleep(600);
    eq('inside the grace window it still reads as working (auth may be restoring)', w.st().state, 'syncing');
    w.FakeDate.advance(5000); // grace (500ms) long past
    const st = w.st();
    eq('past grace, dead transport is a NAMED failure', st.state, 'err');
    eq('…of the blocked kind', st.failKind, 'blocked');
    eq('…with no store blamed', st.failKey, null);
    w.sb.FB.user = { uid: 'u1' };
    w.sb.CloudSync.syncNow();
    await sleep(4500);
    eq('transport restored + retry -> green', w.st().state, 'ok');
    ok('the waiting edit landed', w.pushes.some(function (p) { return p.id === 'inv_list' && p.v && p.v[0] && p.v[0].n === 2001; }));
  }

  console.log('\n— (6) offline: its own named state, at once —');
  {
    const w = makeWorld({ latency: 40 });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await sleep(1200);
    w.fire('offline');
    w.store.set('dsp_list', [{ id: 'today' }]);
    const st = w.st();
    eq('offline with work waiting paints the failure state immediately', st.state, 'err');
    eq('…named as offline', st.failKind, 'offline');
    w.fire('online'); // the app's own handler kicks a sync
    await sleep(4500);
    eq('back online -> settles green', w.st().state, 'ok');
  }

  console.log('\n— (7) v131/v132 keys are durable ledger: con_list write + con_hidden tombstone settle —');
  {
    const w = makeWorld({ latency: 40 });
    w.sb.CloudSync.onAuth({ uid: 'u1' });
    await sleep(1200);
    w.store.set('con_list', [{ uid: 'boss1', status: 'connected' }]);
    eq('a Connect link write paints syncing (it is durable, not telemetry)', w.st().state, 'syncing');
    await sleep(4200);
    eq('…and settles once pushed', w.st().state, 'ok');
    w.store.set('con_hidden', ['peer9']);
    await sleep(4200);
    w.store.del('con_hidden');
    await sleep(4200);
    ok('the tombstone delete reached the cloud', w.deletes.indexOf('con_hidden') >= 0);
    eq('…and the ledger settles after it', w.st().state, 'ok');
  }

  console.log('\n— (8) two faces, one truth: the card + alert read the same status —');
  {
    ok('Preferences card paints "All synced" from CloudSync.status()',
      prefSrc.indexOf('All synced') > 0 && prefSrc.indexOf('CloudSync.status()') > 0);
    ok('Preferences card names a failing store in plain words',
      prefSrc.indexOf('failPlain') > 0 && prefSrc.indexOf("hasn't backed up") > 0);
    ok('Preferences card repaints on status changes (listener, not just the retry tap)',
      prefSrc.indexOf('addStatusListener') > 0);
    ok('the old eternal-amber wording is gone from the card',
      prefSrc.indexOf('Still syncing — give it a moment.') === -1);
    ok('the tap-dot alert shows the last full settle time',
      appSrc.indexOf('Last fully backed up') > 0);
    ok('the tap-dot alert names live-tracking catch-up honestly',
      appSrc.indexOf('telemetryBehind') > 0);
  }

  console.log('\ncloudsync-v136: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
