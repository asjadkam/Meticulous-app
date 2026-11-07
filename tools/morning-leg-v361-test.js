#!/usr/bin/env node
/* Meticulous v361 — MORNING-LEG / LIVE-MILES SESSION RESTART
 * (owner Nov 7, 2026 08:50–08:54: phone paused at the pickup peg
 * painting "Counting from 8:24 AM" on an 8:00 AM session; the
 * account copy ticking on RUNNING; the day's GPS trail beginning
 * 8:16:11 at the yard; the range preview showing the live day as
 * 0.0 km — "that means it's screwed up again. Fix it.").
 *
 * What the investigation proved (code, not guesses):
 *  - No peg handler, heal, or merge re-anchors a session. The
 *    phone's face was the SAME 8:00 session, paused at 8:24:47
 *    with 00:24:47 banked (16:47 auto-start bank + 8:00 run —
 *    exact to the second). "Counting from" was trackerPaint's
 *    re-derived display value (now − elapsed), which creeps
 *    forward through every pause and merely READS as a
 *    re-anchor. The session's pinned identity (sessionId, v69)
 *    never moved.
 *  - The account copy was a SECOND client's own auto-started
 *    copy of the same 8:00 plan (pins jitter a few hundred ms
 *    apart). Same-session copies arbitrated by save stamp —
 *    and a running copy re-stamps itself every minute (v220) —
 *    so a deliberate pause could be out-stamped forever.
 *  - The trail began at the yard because nothing recorded
 *    before the app woke at ~8:16: the native day-arm (the only
 *    pre-wake recorder) is placed by the web layer on a settled
 *    store; the plan landed from another client the evening
 *    before and the phone's app never ran the arming pass after
 *    it. That layer is NATIVE-side: this web build cannot
 *    manufacture ground no recorder observed. What the web
 *    build proves here is the fold path itself — when the arm
 *    HAS recorded, its crumbs fold whole into the session's
 *    record (mergeCrumbs below), pre-start times included.
 *
 * The fixes proven here:
 *  (1) THE FACE NAMES THE PINNED START — trackerPaint paints
 *      startLabelMs (pinned at the start; moved only by his
 *      start-time Edit) instead of the creeping derivation.
 *  (2) ONE SESSION, ONE PAUSE STATE — tracker copies carry
 *      stateAt (the last deliberate transition, set only at
 *      transition sites; the tick re-save never touches it);
 *      cloudsync arbitrates same-session copies (pins within
 *      the ±5000 ms jitter family) by stateAt before pin order
 *      and before stamps.
 *  (3) THE LIVE DAY COUNTS IN THE SUMMARY — the multi-day
 *      manifest folds the live session's persisted miles record
 *      into its km (hours stay revenue-only, the v345 law).
 *
 * Run: node tools/morning-leg-v361-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const csSrc = read('js/cloudsync.js');
const milesSrc = read('js/miles.js');
const appSrc = read('js/app.js');
const geoSrc = read('js/geoloads.js');
const manSrc = read('modules/manifest.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ': ' + extra : '')); }
}
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }

/* Nov 7, 2026, America/Edmonton (UTC-6, no DST) */
const T0 = Date.parse('2026-11-07T08:00:00-06:00');        // the dispatch anchor
const SID = T0 + 412;                                       // the phone's pin (anchor + jitter)
const SID_B = T0 + 699;                                     // a second client's pin of the SAME plan
const SEG = Date.parse('2026-11-07T08:16:47-06:00');        // the late auto-start fire at the yard
const TPAUSE = Date.parse('2026-11-07T08:24:47-06:00');     // his pause at the pickup peg
const TRESUME = Date.parse('2026-11-07T09:05:00-06:00');
const PHOTO = Date.parse('2026-11-07T08:49:47-06:00');      // the screenshot moment
const BANKED = 1487;                                        // 00:24:47 = 16:47 bank + 8:00 run

const PHONE_PAUSED = { status: 'paused', sessionId: SID, startTs: SEG, elapsed: BANKED, stateAt: TPAUSE, startLabelMs: SID };
const ECHO_RUNNING = { status: 'running', sessionId: SID_B, startTs: T0 + 5000, elapsed: 540, stateAt: T0 + 9000, startLabelMs: SID_B };

/* ---------- cloudsync worlds (the sync-stomp pattern) ---------- */
function makeServer() { return { docs: {}, clock: 100000, rejected: [] }; }
function serverSet(server, id, v, updatedAt) { server.docs[id] = { id: id, v: v, updatedAt: updatedAt || (++server.clock) }; }
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
    ready: true, user: { uid: 'u1' },
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
    saveDoc: function (col, id, doc) { serverSet(server, id, doc.v); return Promise.resolve({}); },
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
  world.meta = function () { const r = localStorage.getItem('mt___syncmeta'); return r === null ? null : JSON.parse(r); };
  return world;
}
function settle(ms) { return new Promise(function (r) { setTimeout(r, ms || 600); }); }
const CLEANMETA = { uid: 'u1', globallySynced: true, keys: { tracker: { t: 4000, s: 4000, u: 'u1' } } };

(async function () {
  console.log('— S: one session, one pause state (cloudsync) —');
  /* S1: the incident — the phone's deliberate pause (stateAt
     08:24:47) against a running echo whose DOC STAMP is the
     newest thing in the world. The old stamp game installed
     the echo; the pause must stand and be marked to push up. */
  {
    const server = makeServer();
    serverSet(server, 'tracker', ECHO_RUNNING, 999999);
    const P = makeWorld(server, { local: [['tracker', PHONE_PAUSED]], meta: JSON.parse(JSON.stringify(CLEANMETA)) });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    const t = P.get('tracker') || {};
    eq('S1 the phone keeps its own deliberate pause', t.status, 'paused');
    eq('S1 elapsed is the day\u2019s banked 24:47, untouched', t.elapsed, BANKED);
    eq('S1 the anchor is still the 8:00 pin', t.sessionId, SID);
    const s1meta = ((P.meta() || {}).keys || {}).tracker || {};
    ok('S1 the pause is marked to push UP (tombstone idiom: local stamp re-stamped at pull time)',
      s1meta.t > 4000 && typeof s1meta.s === 'number',
      JSON.stringify((P.meta() || {}).keys));
  }
  /* S2: SUPERSEDED BY v365 (TIMER-STOPPED-BY-ITSELF, owner
     Nov 7, 2026 10:49: "No, I never press stop or pause. It
     stop by itself."). This block used to assert that a
     running client CONVERGES onto a cloud pause whose stamp
     outranks its own start — the v361 law. The owner's word
     killed that law for the running direction: the stamp is
     not proof of a tap (adoption could mint it — js/app.js
     v365), so a running session NEVER yields to a non-running
     cloud copy now, genuine-looking stamp or not. The cost is
     stated plainly: a REAL pause tapped on one client no
     longer pauses the same session's still-running copy on
     another client via sync — the pause lives where it was
     tapped, and the running copy's truth wins the account.
     That is the owner's invariant: running yields only to the
     driver's own tap on the device that is running. The full
     v365 proof lives in tools/timer-stopped-by-itself-v365-
     test.js (A1–A5); this block now pins the new law. */
  {
    const server = makeServer();
    serverSet(server, 'tracker', PHONE_PAUSED, 6000);
    const B = makeWorld(server, { local: [['tracker', ECHO_RUNNING]], meta: JSON.parse(JSON.stringify(CLEANMETA)) });
    B.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    const t = B.get('tracker') || {};
    eq('S2 (v365) the running client NEVER yields to a cloud pause', t.status, 'running');
    eq('S2 (v365) the running face keeps its own anchor', t.sessionId, SID_B);
    eq('S2 (v365) the running face keeps its own transition stamp', t.stateAt, ECHO_RUNNING.stateAt);
  }
  /* S3: a later deliberate RESUME wins the same way, in the
     other direction. */
  {
    const server = makeServer();
    serverSet(server, 'tracker', { status: 'running', sessionId: SID, startTs: TRESUME, elapsed: BANKED, stateAt: TRESUME, startLabelMs: SID }, 7000);
    const P = makeWorld(server, { local: [['tracker', PHONE_PAUSED]], meta: JSON.parse(JSON.stringify(CLEANMETA)) });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    const t = P.get('tracker') || {};
    eq('S3 the later resume installs over the pause', t.status, 'running');
    eq('S3 the resume keeps the day\u2019s banked elapsed', t.elapsed, BANKED);
  }
  /* S4: a genuinely NEWER session (tomorrow's pin) is NOT
     blocked by the rule even when its stateAt is older — pin
     order (v265) still decides different sessions. */
  {
    const server = makeServer();
    serverSet(server, 'tracker', { status: 'running', sessionId: SID + 86400000, startTs: SID + 86400000, elapsed: 60, stateAt: T0 + 9000 }, 8000);
    const P = makeWorld(server, { local: [['tracker', PHONE_PAUSED]], meta: JSON.parse(JSON.stringify(CLEANMETA)) });
    P.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    eq('S4 the later session still wins by pin order', (P.get('tracker') || {}).sessionId, SID + 86400000);
  }
  /* S5: a legacy copy without stateAt arbitrates exactly as
     before (the rule needs both stamps). */
  {
    const server = makeServer();
    serverSet(server, 'tracker', PHONE_PAUSED, 5000);
    const legacy = { status: 'running', sessionId: SID, startTs: SEG, elapsed: 900 };
    const L = makeWorld(server, { local: [['tracker', legacy]], meta: JSON.parse(JSON.stringify(CLEANMETA)) });
    L.sb.CloudSync.onAuth({ uid: 'u1' });
    await settle(900);
    eq('S5 a stateAt-less local falls through to the old game (clean meta -> cloud installs)', (L.get('tracker') || {}).status, 'paused');
  }

  console.log('— F: the face names the pinned start —');
  {
    /* The paint's choice, on today's stored phone tracker at
       the screenshot moment: pinned start vs the old derivation. */
    const chosen = PHONE_PAUSED.startLabelMs || PHONE_PAUSED.sessionId || (PHOTO - PHONE_PAUSED.elapsed * 1000);
    eq('F1 the label instant is the 8:00 anchor', chosen, SID);
    const derived = PHOTO - PHONE_PAUSED.elapsed * 1000;
    ok('F2 the old derivation at the screenshot reads 8:25 (the false re-anchor)', derived > TPAUSE && derived < TPAUSE + 60000,
      'derived=' + new Date(derived).toISOString());
    ok('F3 the paint source reads the pinned start first',
      /st\.textContent = 'Counting from ' \+ fmtTimeAMPM\(t\.startLabelMs \|\| t\.sessionId \|\| trackerSessionStartMs\(\)\)/.test(appSrc));
    ok('F4 both start paths pin the label (manual + auto)',
      /t\.startLabelMs = t\.sessionId/.test(appSrc) && /App\.tracker\.startLabelMs = App\.tracker\.sessionId/.test(appSrc));
    ok('F5 only his start-time Edit moves the label',
      /t\.startLabelMs = target\.getTime\(\)/.test(appSrc));
    ok('F6 peg handlers never touch the tracker (pegs are events inside the day)',
      !/App\.tracker\s*=[^=]/.test(geoSrc) && geoSrc.indexOf('trackerSave') < 0 && geoSrc.indexOf('stateAt') < 0);
  }

  console.log('— A: transition stamps (app.js source pins) —');
  {
    const stamps = (appSrc.match(/stateAt = App\._lastStateAt/g) || []).length;
    ok('A1 toggle / edit / split pause / split resume all stamp stateAt', stamps >= 4, 'count=' + stamps);
    ok('A2 the auto-start stamps its start as a transition', /App\.tracker\.stateAt = Date\.now\(\)/.test(appSrc));
    const tsFn = appSrc.slice(appSrc.indexOf('function trackerSave()'), appSrc.indexOf('function trackerSave()') + 200);
    ok('A3 trackerSave (and so the minute tick) never touches stateAt', tsFn.indexOf('stateAt') < 0, tsFn);
    ok('A4 adoption floors its stamp test on the persisted stateAt',
      /Math\.max\(App\._lastStateAt \|\| 0, t\.stateAt \|\| 0\)/.test(appSrc));
    ok('A5 stop paths stamp the fresh idle tracker', (appSrc.match(/status: 'idle', startTs: 0, elapsed: 0, stateAt: Date\.now\(\)/g) || []).length >= 2);
    ok('A6 cloudsync carries the same-session stateAt rule', /sa361C > sa361L/.test(csSrc) && /MORNING-LEG/.test(csSrc));
  }

  console.log('— M: the fold path — arm crumbs land whole in the session record —');
  {
    const sb2 = { console: console, Date: Date, Math: Math, JSON: JSON, Promise: Promise, setTimeout: setTimeout };
    sb2.window = sb2;
    vm.createContext(sb2);
    vm.runInContext(milesSrc, sb2);
    const ENGINE = sb2.LiveMiles._engine;
    /* The arm's crumbs for a morning like today's: home 7:38,
       rolling by 7:46, the yard 7:57, the first site 8:12 — all
       BEFORE the session's 8:16 wake. Folded into the session
       tracker (the drain's live path), the trail must include
       the whole leg. */
    const tr = ENGINE.createMilesTracker();
    tr.begin('s' + SID, null);
    const crumbs = [
      { t: Date.parse('2026-11-07T07:38:00-06:00'), a: 51.15709, o: -113.93862, c: 12 },
      { t: Date.parse('2026-11-07T07:46:00-06:00'), a: 51.14800, o: -113.95200, c: 14 },
      { t: Date.parse('2026-11-07T07:52:00-06:00'), a: 51.13600, o: -113.96800, c: 11 },
      { t: Date.parse('2026-11-07T07:57:00-06:00'), a: 51.12523, o: -113.98280, c: 10 },
      { t: Date.parse('2026-11-07T08:12:00-06:00'), a: 51.13100, o: -114.00100, c: 13 }
    ];
    const res = tr.mergeCrumbs(crumbs);
    const snap = tr.snapshot();
    const trail = tr.crumbs();
    ok('M1 the pre-wake leg folds in (added metres > 0)', res.addedM > 3000, 'addedM=' + res.addedM);
    /* The first crumb is the chain's origin: the counted-coverage
       segment opens at it (the crumbs list proper starts at the
       second fix — the engine's long-standing shape). */
    eq('M2 the counted coverage starts at the first home fix, not the yard', snap.segs.length && snap.segs[0].f, crumbs[0].t);
    eq('M3 the counted coverage ends at the last fix', snap.segs.length && snap.segs[snap.segs.length - 1].t, crumbs[4].t);
    ok('M4 the folded span is the whole home->site leg (~5 km)', snap.totalM > 4000 && snap.totalM < 7000, 'totalM=' + snap.totalM);
  }

  console.log('— R: the range summary counts the live day —');
  {
    function makeEl() {
      return {
        innerHTML: '', textContent: '', value: '', onclick: null, onchange: null, style: {},
        classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
        setAttribute: function () {}, getAttribute: function () { return null; },
        querySelector: function () { return null; }, querySelectorAll: function () { return []; },
        addEventListener: function () {}
      };
    }
    function makeManWorld(liveTracker, liveRec) {
      const data = {
        onboarding: { payStandard: 'Hourly', ownWageRate: 29, travelBonus: 0 },
        rev_entries: [], sessions: [], fuel_fills: [], fuel_expenses: [],
        dsp_list: [], nav_log: [], dmg_reports: [], geoloads: {},
        livemiles: {}, tracker: liveTracker
      };
      if (liveRec) data.livemiles['s' + SID] = liveRec;
      const store = {
        get: function (k, d) { return (k in data) ? data[k] : d; },
        set: function (k, v) { data[k] = v; return true; },
        del: function (k) { delete data[k]; return true; }
      };
      const sb = {
        console: console, Date: Date, Math: Math, JSON: JSON,
        App: {
          _store: store,
          _today: function () { return '2026-11-07'; },
          _esc: function (s) { return String(s == null ? '' : s); },
          openModule: function () {},
          _photoDl: function () { return ''; },
          tracker: liveTracker
        },
        Meticulous: { modules: {} },
        MetPdf: { savePdf: function () { return Promise.resolve({ message: 'saved' }); }, isNativeShell: function () { return false; } }
      };
      sb.window = sb;
      vm.createContext(sb);
      vm.runInContext(manSrc, sb, { filename: 'modules/manifest.js' });
      return sb.Meticulous.modules.manifest;
    }
    const liveTrk = { status: 'running', sessionId: SID, startTs: SEG, elapsed: 3200, stateAt: T0 + 9000, startLabelMs: SID };
    const api = makeManWorld(liveTrk, { date: '2026-11-07', km: 18.5, firstTs: Date.parse('2026-11-07T08:16:11-06:00'), lastTs: PHOTO, updatedAt: PHOTO });
    const s = api._daySummaryOf(api._collectDay('2026-11-07'));
    eq('R1 the live day\u2019s km enter the range summary', s.km, 18.5);
    eq('R2 the live day\u2019s hours stay 0.0 until its ticket books (v345 law)', s.hours, 0);
    const apiIdle = makeManWorld({ status: 'idle' }, { date: '2026-11-07', km: 18.5, updatedAt: PHOTO });
    const s2 = apiIdle._daySummaryOf(apiIdle._collectDay('2026-11-07'));
    eq('R3 no live session -> no fold (an idle face cannot invent km)', s2.km, 0);
  }

  console.log('— ship pins —');
  eq('webVersion is 361', ver.webVersion, 361);
  ok('index.html pins app.js?v=361, cloudsync.js?v=361, manifest.js?v=361',
    idxSrc.indexOf('js/app.js?v=361') >= 0 && idxSrc.indexOf('js/cloudsync.js?v=361') >= 0 && idxSrc.indexOf('modules/manifest.js?v=361') >= 0);

  console.log('\nmorning-leg-v361: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL suite threw: ' + (e && e.stack || e)); process.exit(1); });
