#!/usr/bin/env node
/* v325 regression suite — WIDGET-FROZEN-AGAIN (Nov 5, 2026).
 * The widget painted 00:38:19 at 13:05 on a 09:00 session while
 * its loads and miles kept advancing: the native session record
 * (the widget's only clock source — TrackerWidget derives every
 * paint from SessionRecord.elapsedSec) had been re-anchored to a
 * 12:26 segment with nothing banked before it.
 *
 * The contract under test, two halves:
 *  - NATIVE (SessionRecord.syncFromWeb, v71): the re-anchor gate
 *    — a same-session, both-live sync whose base is <= 60 s yet
 *    whose derivation trails the record's by > 300 s is REFUSED
 *    (applied=false), force exempt. The bridge below mirrors the
 *    Java, gate included.
 *  - WEB (js/app.js adoptSessionRecord, v325): the convergence
 *    step now also sees a RUNNING pair whose record counts from
 *    a LATER start — src 'native' + newer stamp = a face tap
 *    folded and resumed between collects, so the web ADOPTS the
 *    record's clock; anything else = the record missed the web's
 *    clock, so it heals by re-sync.
 * Drives the REAL app.js (sliced like the v323 rig) against the
 * mirrored bridge. Run: node tools/widget-frozen-v325-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

const RealDate = Date;
let fakeNow = 0;
function msOf(dateStr, hhmmss) {
  const dp = dateStr.split('-'), tp = hhmmss.split(':');
  return new RealDate(+dp[0], +dp[1] - 1, +dp[2], +tp[0], +tp[1], +(tp[2] || 0), 0).getTime();
}
class FakeDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fakeNow])); }
  static now() { return fakeNow; }
}
async function pump() { for (let i = 0; i < 12; i++) await new Promise(function (r) { setImmediate(r); }); }

function sliceBetween(s, startMark, endMark, endIncl) {
  const a = s.indexOf(startMark);
  const b = s.indexOf(endMark);
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + startMark + ' .. ' + endMark);
  return s.slice(a, endIncl ? b + endMark.length : b);
}
const regionA = sliceBetween(appSrc, 'function trackerSave() {', 'App.collectSessionRecord = collectSessionRecord;', true);
const regionB = sliceBetween(appSrc, '/* ---------------- v28: backdate', 'App.trackerToggle = function', false);
const regionC = sliceBetween(appSrc, 'function payMode() {', '/* v82 (item 3b)', false);
const regionCode = regionA + '\n' + regionB + '\n' + regionC;

/* The bridge: SessionRecord.java + ShiftTrackPlugin.sessionSync,
   semantics mirrored from the v323 rig, PLUS the v71 gate. */
function makeBridge() {
  const rec = { status: 'idle', elapsedBase: 0, segStartMs: 0, loads: 0, loadsManual: 0,
    loadsArmed: false, loadsCorr: 0, rev: 0, updatedAt: 0, src: '', sessionKey: '' };
  function elapsedSec(now) {
    let s = rec.elapsedBase;
    if (rec.status === 'running' && rec.segStartMs > 0) s += Math.max(0, Math.floor((now - rec.segStartMs) / 1000));
    return Math.max(0, s);
  }
  function snap() {
    return { status: rec.status, elapsedBase: rec.elapsedBase, segStartMs: rec.segStartMs,
      elapsedSec: elapsedSec(fakeNow), loads: rec.loads, loadsManual: rec.loadsManual,
      loadsArmed: rec.loadsArmed, loadsCorr: rec.loadsCorr, rev: rec.rev,
      updatedAt: rec.updatedAt, src: rec.src, sessionKey: rec.sessionKey };
  }
  return {
    rec: rec, snap: snap,
    sessionSync: function (facts) {
      if (!facts.force && facts.baseRev !== rec.rev) {
        const d = snap(); d.applied = false; return Promise.resolve(d);
      }
      let status = facts.status;
      if (status !== 'running' && status !== 'paused' && status !== 'idle') status = 'idle';
      /* v71 gate (SessionRecord.syncFromWeb, mirrored) */
      if (!facts.force
          && rec.sessionKey.length > 0 && rec.sessionKey === (facts.sessionKey || '')
          && (rec.status === 'running' || rec.status === 'paused')
          && (status === 'running' || status === 'paused')
          && (facts.elapsed || 0) <= 60
          && (facts.startTs || 0) > rec.segStartMs) {
        let incoming = facts.elapsed || 0;
        if (status === 'running' && (facts.startTs || 0) > 0) {
          incoming += Math.max(0, Math.floor((fakeNow - facts.startTs) / 1000));
        }
        if (elapsedSec(fakeNow) > incoming + 300) {
          const d = snap(); d.applied = false; return Promise.resolve(d);
        }
      }
      const same = status === rec.status && facts.elapsed === rec.elapsedBase &&
        (facts.startTs || 0) === rec.segStartMs && facts.loads === rec.loads &&
        facts.loadsManual === rec.loadsManual && facts.loadsArmed === rec.loadsArmed &&
        (facts.sessionKey || '') === rec.sessionKey && rec.loadsCorr === 0;
      if (same && !facts.force) { const d = snap(); d.applied = true; return Promise.resolve(d); }
      rec.status = status; rec.elapsedBase = facts.elapsed; rec.segStartMs = facts.startTs || 0;
      rec.loads = facts.loads; rec.loadsManual = facts.loadsManual; rec.loadsArmed = facts.loadsArmed;
      rec.loadsCorr = 0; rec.rev += 1; rec.updatedAt = fakeNow; rec.src = 'web';
      rec.sessionKey = facts.sessionKey || '';
      const d = snap(); d.applied = true; return Promise.resolve(d);
    },
    sessionRecord: function () { return Promise.resolve(snap()); },
    sessionStopped: function () {},
    /* FaceActions/nativeToggle, SessionRecord.java verbatim shape */
    nativePause: function () {
      if (rec.status !== 'running') return;
      rec.elapsedBase = elapsedSec(fakeNow);
      rec.status = 'paused'; rec.segStartMs = 0; rec.rev += 1; rec.updatedAt = fakeNow; rec.src = 'native';
    },
    nativeResume: function () {
      if (rec.status !== 'paused') return;
      rec.status = 'running'; rec.segStartMs = fakeNow; rec.rev += 1; rec.updatedAt = fakeNow; rec.src = 'native';
    }
  };
}
function makeStore() {
  const data = {};
  return {
    data: data,
    get: function (k, d) { const r = data['mt_' + k]; return r === undefined ? d : JSON.parse(r); },
    set: function (k, v) { data['mt_' + k] = JSON.stringify(v); return true; },
    del: function (k) { delete data['mt_' + k]; return true; }
  };
}
function makeWorld(store, bridge) {
  const genericEl = { value: '', textContent: '', innerHTML: '',
    classList: { add: function () {}, remove: function () {}, contains: function () { return false; } }, onclick: null };
  const sb = {
    console: console, Promise: Promise, Date: FakeDate, JSON: JSON, Math: Math,
    setTimeout: function () { return 0; }, clearTimeout: function () {},
    confirm: function () { return true; }, closeSidebar: function () {},
    fmtClock: function (s) { return String(s); },
    todayStr: function (d) {
      d = d || new FakeDate();
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    },
    el: function () { return genericEl; },
    store: store, App: { tracker: null },
    trackerPaint: function () {}, paintHero: function () {}, paintBubble: function () {},
    pushWidgetState: function () {}, lastBubbleFacts: function () { return {}; },
    ShiftTrack: bridge
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(regionCode, sb);
  return sb;
}

const DAY = '2026-11-05';
const START = msOf(DAY, '09:00:00');
function webDerivation(w) {
  const t = w.App.tracker;
  return (t.elapsed || 0) + (t.status === 'running' ? Math.floor((fakeNow - t.startTs) / 1000) : 0);
}
function freshWorld() {
  const store = makeStore();
  const bridge = makeBridge();
  const w = makeWorld(store, bridge);
  w.App.tracker = { status: 'running', startTs: START, elapsed: 0, sessionId: START, accum: { manualLoads: 0 } };
  w.App._sessRev = 0; w.App._lastStateAt = 0; w.App._lastLoadsAt = 0;
  return { store: store, bridge: bridge, w: w };
}

(async function main() {
  console.log('Part 1 — the Nov 5 replay: a re-anchored record heals from the web');
  {
    const { bridge, w } = freshWorld();
    fakeNow = msOf(DAY, '10:00:00'); w.trackerSave(); await pump();
    fakeNow = msOf(DAY, '11:40:00'); w.trackerSave(); await pump();
    ok('T1 morning syncs leave the record counting from 09:00',
      bridge.snap().elapsedSec === 9600, 'record reads ' + bridge.snap().elapsedSec);

    /* the re-anchor lands through a writer the gate cannot see
       (direct record corruption, the shape the widget showed) */
    fakeNow = msOf(DAY, '12:26:41');
    bridge.rec.elapsedBase = 0;
    bridge.rec.segStartMs = fakeNow;
    bridge.rec.rev += 1; bridge.rec.updatedAt = fakeNow; bridge.rec.src = 'web';
    fakeNow = msOf(DAY, '13:05:00');
    ok('T2 the corrupted record derives the frozen face (2299s = 00:38:19)',
      bridge.snap().elapsedSec === 2299, 'record reads ' + bridge.snap().elapsedSec);

    await w.App.collectSessionRecord(); await pump();
    ok('T3 one collect heals the record back to the day (14700s = 04:05:00)',
      bridge.snap().elapsedSec === 14700, 'record reads ' + bridge.snap().elapsedSec);
    ok('T4 the web tracker never left the true start',
      webDerivation(w) === 14700, 'web derives ' + webDerivation(w));
  }

  console.log('Part 2 — a native fold between collects: the web adopts the record clock');
  {
    const { bridge, w } = freshWorld();
    fakeNow = msOf(DAY, '10:00:00'); w.trackerSave(); await pump();
    w.App._lastStateAt = msOf(DAY, '10:00:00'); // the web's last own change
    fakeNow = msOf(DAY, '12:00:00'); bridge.nativePause();
    fakeNow = msOf(DAY, '12:30:00'); bridge.nativeResume();
    fakeNow = msOf(DAY, '13:05:00');
    await w.App.collectSessionRecord(); await pump();
    const t = w.App.tracker;
    ok('T5 the web adopts the folded base (10800s) and the resume segment',
      t.elapsed === 10800 && t.startTs === msOf(DAY, '12:30:00'),
      'elapsed=' + t.elapsed + ' startTs=' + t.startTs);
    ok('T6 web and record agree at 12900s (the paused half hour is NOT handed back)',
      webDerivation(w) === 12900 && bridge.snap().elapsedSec === 12900,
      'web=' + webDerivation(w) + ' rec=' + bridge.snap().elapsedSec);
    ok('T7 the adoption did not overwrite the record (src still native, base still the fold)',
      bridge.rec.src === 'native' && bridge.rec.elapsedBase === 10800,
      'src=' + bridge.rec.src + ' base=' + bridge.rec.elapsedBase);
  }

  console.log('Part 3 — the native gate: a re-anchoring sync is refused at the bridge');
  {
    const { bridge, w } = freshWorld();
    fakeNow = msOf(DAY, '10:00:00'); w.trackerSave(); await pump();
    /* the day banks a real base through a pause fold the web performs */
    fakeNow = msOf(DAY, '12:00:00');
    w.App.tracker.elapsed = 10800; w.App.tracker.startTs = fakeNow;
    w.trackerSave(); await pump();
    ok('T8 the banked record derives the full morning at noon (10800s)',
      bridge.snap().elapsedSec === 10800, 'record reads ' + bridge.snap().elapsedSec);

    /* a reborn lifetime restates the day from its own birth,
       baseRev CURRENT (the refusal path refreshed it) */
    fakeNow = msOf(DAY, '13:05:00');
    const stale = { status: 'running', elapsed: 0, startTs: msOf(DAY, '12:26:41'),
      loads: 0, loadsManual: 0, loadsArmed: false, sessionKey: 's' + START,
      baseRev: bridge.rec.rev, force: false, milesM: -1 };
    const r1 = await bridge.sessionSync(stale);
    ok('T9 the re-anchoring sync is REFUSED (applied=false)',
      r1.applied === false, 'applied=' + r1.applied);
    ok('T10 the record still derives the day (14700s) after the refused sync',
      bridge.snap().elapsedSec === 14700, 'record reads ' + bridge.snap().elapsedSec);

    const forced = Object.assign({}, stale, { force: true });
    const r2 = await bridge.sessionSync(forced);
    ok('T11 a FORCE sync stays exempt (the deliberate overwrites keep their road)',
      r2.applied === true, 'applied=' + r2.applied);
  }

  console.log('Part 4 — regressions: the v265 directions still converge');
  {
    /* record AHEAD (uncollapsed shape): heals by re-sync, as before */
    const { bridge, w } = freshWorld();
    fakeNow = msOf(DAY, '10:00:00'); w.trackerSave(); await pump();
    bridge.rec.elapsedBase = 600; bridge.rec.rev += 1;
    bridge.rec.updatedAt = fakeNow; bridge.rec.src = 'web';
    fakeNow = msOf(DAY, '11:00:00');
    await w.App.collectSessionRecord(); await pump();
    ok('T12 a record counting AHEAD still heals to the web clock (7200s)',
      bridge.snap().elapsedSec === 7200 && webDerivation(w) === 7200,
      'rec=' + bridge.snap().elapsedSec + ' web=' + webDerivation(w));
  }
  {
    /* paused pair divergence: heals by re-sync, as before */
    const { bridge, w } = freshWorld();
    w.App.tracker = { status: 'paused', startTs: 0, elapsed: 5000, sessionId: START, accum: { manualLoads: 0 } };
    bridge.rec.status = 'paused'; bridge.rec.elapsedBase = 5200; bridge.rec.segStartMs = 0;
    bridge.rec.sessionKey = 's' + START; bridge.rec.rev = 3; bridge.rec.src = 'web';
    bridge.rec.updatedAt = fakeNow; w.App._sessRev = 3;
    fakeNow = msOf(DAY, '13:05:00');
    await w.App.collectSessionRecord(); await pump();
    ok('T13 a paused pair still converges on the web total (5000s)',
      bridge.snap().elapsedSec === 5000, 'record reads ' + bridge.snap().elapsedSec);
  }
  {
    /* honest first-segment restatement is NOT gated */
    const { bridge, w } = freshWorld();
    fakeNow = msOf(DAY, '09:05:00'); w.trackerSave(); await pump();
    fakeNow = msOf(DAY, '09:30:00'); w.trackerSave(); await pump();
    ok('T14 a first-segment restatement syncs clean (1800s, no refusal churn)',
      bridge.snap().elapsedSec === 1800 && bridge.rec.src === 'web',
      'record reads ' + bridge.snap().elapsedSec);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERROR', e && e.stack || e); process.exit(1); });
