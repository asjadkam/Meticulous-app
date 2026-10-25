#!/usr/bin/env node
/* Meticulous v174 — "KMS COUNT FROM FIRST MOVEMENT, NOT SHIFT
 * START" suite (owner, Oct 19, 2026 06:57 MDT; live evidence
 * 07:26 MDT: driving to the pit with today's 8:00 dispatch
 * armed, the home face read "Ready to work · 00:00:00" and no
 * distance counted). The law that does NOT move: the session
 * (pay) starts at the dispatch's scheduled time. What changes:
 * DISTANCE is separate —
 *   A. App.checkAutoStart arms a date-keyed DAY WATCH while a
 *      plan for today stands and the start is still ahead, so
 *      the miles engine records from the day's first movement
 *      and the face's live-miles line counts it while the clock
 *      still waits; no plan → the watch stands down.
 *   B. When the session starts, it adopts the day record WHOLE
 *      (js/miles.js: the date key bypasses the adoption slack
 *      windows — an 06:45 roll-out for an 08:00 start counts in
 *      full). Other records keep the slack windows: nothing
 *      leaks in from another day or session.
 *   C. A MANUAL Start stamps the TAP (v255 — the v174 plan-anchor
 *      law was superseded by the owner's Oct 24, 2026 correction:
 *      the scheduled start belongs to dispatch-driven auto-start
 *      only; a manual start counts from the tap; his own preset
 *      start still wins).
 *
 * Run: node tools/queue-v174-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');
const milesSrc = read('js/miles.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function near(name, got, want, tol) {
  ok(name, typeof got === 'number' && Math.abs(got - want) <= tol,
    'got ' + got + ', want ~' + want + ' ±' + tol);
}
function extractRegion(src, beginMark, endMark) {
  const bi = src.indexOf(beginMark), ei = src.indexOf(endMark);
  if (bi === -1 || ei === -1) throw new Error('region markers missing: ' + beginMark);
  return src.slice(src.lastIndexOf('/*', bi), src.indexOf('*/', ei) + 2);
}
function extractStore() {
  const i = appSrc.indexOf('var store = {');
  let depth = 0, j = i;
  for (; j < appSrc.length; j++) {
    if (appSrc[j] === '{') depth++;
    else if (appSrc[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return appSrc.slice(i, j) + ';';
}
function makeLocal() {
  const mem = {};
  return { mem: mem,
    getItem: function (k) { return (k in mem) ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; } };
}
function todayStrOf(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function FakeDateFactory(fixedMs) {
  function FD(a, b, c, d, e, f, g) {
    if (arguments.length === 0) return new Date(fixedMs);
    return new Date(a, b || 0, c === undefined ? 1 : c, d || 0, e || 0, f || 0, g || 0);
  }
  FD.now = function () { return fixedMs; };
  FD.parse = Date.parse;
  FD.UTC = Date.UTC;
  FD.prototype = Date.prototype;
  return FD;
}
function flush() {
  return new Promise(function (res) {
    let n = 0;
    (function step() { if (++n > 30) return res(); setTimeout(step, 0); })();
  });
}

/* ================= A: the miles glue ================= */
function milesWorld() {
  const backing = makeLocal();
  const geo = {
    _cb: null,
    available: function () { return true; },
    start: function (cb) { geo._cb = cb; return Promise.resolve(true); },
    stop: function () { geo._cb = null; }
  };
  const docStub = { getElementById: function () { return null; }, addEventListener: function () {} };
  const sb = {
    console: console, localStorage: backing, document: docStub,
    navigator: {}, setTimeout: setTimeout,
    App: { _store: null, geo: geo, tracker: { status: 'idle' }, userRole: function () { return 'driver'; } }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(extractStore(), sb);
  sb.App._store = sb.store;
  vm.runInContext(milesSrc, sb);
  return { sb: sb, store: sb.store, geo: geo, LM: sb.LiveMiles };
}

(async function main() {
  /* The scenario timeline: anchor (the 8:00 session start) is a
     fixed instant; the roll-out begins 75 minutes BEFORE it —
     outside the old 60-minute adoption slack. */
  const anchorMs = new Date(2026, 9, 19, 12, 0, 0).getTime(); // local noon — date-stable
  const dateStr = todayStrOf(new Date(anchorMs));
  {
    const w = milesWorld();
    ok('A0 the day watch starts on the date key', w.LM.startDay('d' + dateStr) === true);
    eq('A1 the live key is the date key', w.LM.dayKey(), 'd' + dateStr);
    /* drive east ~280 m per fix, 41 fixes from anchor-75m to anchor-5m */
    let fed = 0;
    for (let i = 0; i <= 40; i++) {
      w.geo._cb({ latitude: 51.0, longitude: -114.0 + i * 0.004, accuracy: 8, time: anchorMs - 75 * 60000 + i * 105000 });
      fed++;
    }
    await flush();
    const dayKm = w.LM.currentKm();
    near('A2 the day watch counts the roll-out while no session exists (~11.2 km)', dayKm, 11.2, 1.2);
    /* the session starts at the anchor: it must adopt the day WHOLE */
    ok('A3 the session day starts', w.LM.startDay('s' + anchorMs) === true);
    await flush();
    near('A4 the session opens with the WHOLE pre-session distance (no 60-min cut, no reset)',
      w.LM.currentKm(), dayKm, 0.05);
    eq('A5 the day record was consumed (adopted exactly once)',
      w.LM.recordKmFor('d' + dateStr), null);
    for (let i = 41; i <= 45; i++) {
      w.geo._cb({ latitude: 51.0, longitude: -114.0 + i * 0.004, accuracy: 8, time: anchorMs + (i - 40) * 105000 });
    }
    await flush();
    near('A6 driving after the start keeps counting from the adopted total',
      w.LM.currentKm(), dayKm + 1.4, 0.4);
  }
  {
    /* control: a FOREIGN record (another session's key) whose
       window sits outside the slack stays excluded — the bypass
       belongs to the date key only. */
    const w = milesWorld();
    const days = { days: {} };
    days.days['s' + (anchorMs - 86400000)] = {
      date: dateStr, hasFix: true, totalM: 5000,
      crumbs: [{ t: anchorMs - 75 * 60000, a: 51.0, o: -114.0, c: 8 }, { t: anchorMs - 70 * 60000, a: 51.0, o: -113.99, c: 8 }],
      anchor: { time: anchorMs - 75 * 60000, lat: 51.0, lng: -114.0 }
    };
    w.store.set('livemiles', days);
    w.LM.startDay('s' + anchorMs);
    await flush();
    const km = w.LM.currentKm();
    ok('A7 a foreign record outside the slack windows still cannot leak in',
      km === null || km === 0, 'km=' + km);
  }

  /* ================= B: checkAutoStart arms the day watch ================= */
  {
    const region = extractRegion(appSrc, 'AUTOSTART-ENGINE-BEGIN', 'AUTOSTART-ENGINE-END');
    const fixedMs = new Date(2026, 9, 19, 7, 26, 0).getTime(); // Mon Oct 19 2026, 07:26
    const mem = {
      onboarding: { autoStart: true, autoStartTime: '06:00', autoStartDays: [1] },
      dsp_list: [{ id: 'd1', jobSite: 'Aecon Inf', scheduledAt: '2026-10-19T08:00', status: 'saved', date: '2026-10-19' }],
      dsp_active: null, sessions: []
    };
    const store = {
      get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
      set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
      del: function (k) { delete mem[k]; return true; }
    };
    const lmCalls = [], lmState = { key: null, stops: 0 };
    const sb = {
      console: console, store: store, todayStr: todayStrOf, Date: FakeDateFactory(fixedMs),
      resetAccum: function () {}, trackerSave: function () {}, trackerPaint: function () {},
      maybePromptOdo: function () { return false; },
      trackerSessionStartMs: function () { return fixedMs; },
      LiveMiles: {
        startDay: function (k) { lmCalls.push(k); lmState.key = k; return true; },
        dayKey: function () { return lmState.key; },
        stopDay: function () { lmState.stops++; lmState.key = null; return { liveKm: null }; }
      },
      GeoLoads: { startDay: function () {} },
      ShiftTrack: { armDay: function () {}, disarmDay: function () {}, sessionStarted: function () {} },
      App: { tracker: { status: 'idle', startTs: 0, elapsed: 0 }, userRole: function () { return 'driver'; } }
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(region, sb);
    const r1 = sb.App.checkAutoStart();
    eq('B1 before the plan time the check still says not-yet', r1, 'not-yet');
    eq('B2 and the DAY WATCH is armed on today\u2019s date key', lmCalls, ['d2026-10-19']);
    eq('B3 the tracker itself has NOT started (pay law intact)', sb.App.tracker.status, 'idle');
    /* the dispatch is cancelled → no plan → the watch stands down */
    mem.dsp_list = [];
    mem.onboarding = { autoStart: true, autoStartTime: '06:00', autoStartDays: [] };
    sb.App.checkAutoStart();
    eq('B4 with no plan for today the armed day watch stands down', lmState.stops, 1);
  }

  /* ================= C: a manual Start stamps the tap (v255) ================= */
  {
    const region = extractRegion(appSrc, 'AUTOSTART-ENGINE-BEGIN', 'AUTOSTART-ENGINE-END');
    const tglStart = appSrc.indexOf('function trackerSessionStartMs()');
    const tglEnd = appSrc.indexOf('/* v34: stop with an explicit end time', tglStart);
    const tglCode = appSrc.slice(tglStart, tglEnd);
    const fixedMs = new Date(2026, 9, 19, 7, 26, 0).getTime();
    const anchorMs = new Date(2026, 9, 19, 8, 0, 0).getTime();
    function toggleWorld(withDispatch, preset) {
      const mem = {
        onboarding: { autoStart: true, autoStartTime: '06:00', autoStartDays: [1] },
        dsp_list: withDispatch ? [{ id: 'd1', jobSite: 'Aecon Inf', scheduledAt: '2026-10-19T08:00', status: 'saved', date: '2026-10-19' }] : [],
        dsp_active: null, sessions: []
      };
      const store = {
        get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
        set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
        del: function (k) { delete mem[k]; return true; }
      };
      const lmKeys = [];
      const sb = {
        console: console, store: store, todayStr: todayStrOf, Date: FakeDateFactory(fixedMs),
        resetAccum: function () {}, trackerSave: function () {}, trackerPaint: function () {},
        maybePromptOdo: function () { return false; },
        el: function () { return { classList: { add: function () {}, remove: function () {} } }; },
        LiveMiles: { startDay: function (k) { lmKeys.push(k); return true; }, syncWake: function () {} },
        GeoLoads: { startDay: function () {} },
        ShiftTrack: { sessionStarted: function () {} },
        App: { tracker: { status: 'idle', startTs: 0, elapsed: 0 }, userRole: function () { return 'driver'; },
          armNativeDay: function () {} }
      };
      sb.window = sb;
      if (preset) sb.App.tracker.presetStart = preset;
      vm.createContext(sb);
      vm.runInContext(region, sb);
      vm.runInContext(tglCode, sb);
      return { sb: sb, lmKeys: lmKeys };
    }
    const w1 = toggleWorld(true, 0);
    w1.sb.App.trackerToggle();
    eq('C1 a manual Start at 07:26 runs the session', w1.sb.App.tracker.status, 'running');
    eq('C2 v255: its identity is the TAP, not the 8:00 dispatch anchor', w1.sb.App.tracker.sessionId, fixedMs);
    eq('C3 v255: its start stamp is the tap', w1.sb.App.tracker.startTs, fixedMs);
    eq('C4 its elapsed starts at zero at the tap', w1.sb.App.tracker.elapsed, 0);
    eq('C5 miles key off the tapped session', w1.lmKeys, ['s' + fixedMs]);
    const w2 = toggleWorld(false, 0);
    w2.sb.App.trackerToggle();
    eq('C6 v255: with no dispatch a manual Start also stamps the tap (no standing-plan anchor)',
      w2.sb.App.tracker.sessionId, fixedMs);
    const w3 = toggleWorld(true, fixedMs - 3600000);
    w3.sb.App.trackerToggle();
    eq('C7 his own preset start still wins over everything', w3.sb.App.tracker.sessionId, fixedMs - 3600000);
  }

  /* ================= D: the PTI reading is the day's start reading ================= */
  {
    const code = extractRegion(appSrc, 'ODO-MASTER-BEGIN', 'ODO-MASTER-END') + '\n' +
      extractRegion(appSrc, 'ODO-PROMPT-BEGIN', 'ODO-PROMPT-END');
    function odoWorld(seed) {
      const mem = JSON.parse(JSON.stringify(seed || {}));
      const store = {
        get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
        set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); },
        del: function (k) { delete mem[k]; }
      };
      const sb = {
        console: console, store: store, todayStr: todayStrOf,
        trackerSave: function () {},
        App: { tracker: { status: 'idle', startTs: 0, elapsed: 0 } }
      };
      sb.window = sb;
      vm.createContext(sb);
      vm.runInContext(code, sb);
      sb._mem = mem;
      return sb;
    }
    const today = todayStrOf(new Date());
    /* his morning exactly: PTI filed with the dash photo (the
       readings log carries it, source 'pti'), Daily-odometer-
       photos ON, no session yet, no sheet reading taken */
    const w = odoWorld({
      onboarding: { payStandard: 'Hourly', odoDailyPhotos: true },
      odo_readings: [{ ts: Date.now() - 2700000, date: today, value: 169434, source: 'pti' }],
      sessions: []
    });
    eq('D1 a PTI reading for today suppresses the shift-start photo prompt',
      w.shouldPromptOdo('start'), false);
    eq('D2 and it IS the pending start reading the session will carry',
      w.takePendingStartOdo(today), 169434);
    const w2 = odoWorld({
      onboarding: { payStandard: 'Hourly', odoDailyPhotos: true },
      odo_readings: [],
      pti_reports: [{ id: 'p1', date: today, kind: 'pre', odometer: 169434, filedAt: Date.now() - 2700000 }],
      sessions: []
    });
    eq('D3 the filed pre-trip report itself is the fallback evidence',
      w2.takePendingStartOdo(today), 169434);
    const w3 = odoWorld({
      onboarding: { payStandard: 'Hourly', odoDailyPhotos: true },
      odo_readings: [{ ts: Date.now() - 2700000, date: today, value: 169434, source: 'session' }],
      sessions: []
    });
    eq('D4 a non-PTI reading does NOT suppress the prompt (only the PTI commits the day)',
      w3.shouldPromptOdo('start'), true);
    const w4 = odoWorld({
      onboarding: { payStandard: 'Miles' },
      odo_readings: [{ ts: Date.now() - 2700000, date: '1999-01-01', value: 169434, source: 'pti' }],
      sessions: []
    });
    eq('D5 yesterday\u2019s PTI reading changes nothing for today',
      w4.shouldPromptOdo('start'), true);
  }

  /* ================= E: the PTI nudge ================= */
  {
    const code = extractRegion(appSrc, 'PTI-NUDGE-BEGIN', 'PTI-NUDGE-END') + '\n' +
      extractRegion(appSrc, 'AUTOSTART-ENGINE-BEGIN', 'AUTOSTART-ENGINE-END');
    function nudgeWorld(seed, role) {
      const mem = JSON.parse(JSON.stringify(seed || {}));
      const store = {
        get: function (k, d) { return (k in mem) ? JSON.parse(JSON.stringify(mem[k])) : d; },
        set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
        del: function (k) { delete mem[k]; return true; }
      };
      const sb = {
        console: console, store: store, todayStr: todayStrOf,
        resetAccum: function () {}, trackerSave: function () {}, trackerPaint: function () {},
        maybePromptOdo: function () { return false; },
        trackerSessionStartMs: function () { return Date.now(); },
        App: { tracker: { status: 'idle', startTs: 0, elapsed: 0 }, userRole: function () { return role || 'driver'; } }
      };
      sb.window = sb;
      vm.createContext(sb);
      vm.runInContext(code, sb);
      sb._mem = mem;
      return sb;
    }
    const today = todayStrOf(new Date());
    const planSeed = {
      onboarding: { autoStart: true, autoStartTime: '08:00', autoStartDays: [0, 1, 2, 3, 4, 5, 6] },
      dsp_list: [{ id: 'd1', jobSite: 'Aecon Inf', scheduledAt: today + 'T08:00', status: 'saved', date: today }],
      dsp_active: null, pti_reports: []
    };
    const w = nudgeWorld(planSeed);
    eq('E1 no PTI + a driving day ahead → the nudge is due', w.shouldNudgePti(), true);
    eq('E2 and the standing flag shows before the start', w.ptiFlagVisible(), true);
    w._mem.pti_reports = [{ id: 'p1', date: today, kind: 'pre', odometer: 169434 }];
    eq('E3 filing the PTI clears both the nudge and the flag',
      [w.shouldNudgePti(), w.ptiFlagVisible()], [false, false]);
    const w2 = nudgeWorld(planSeed);
    w2._mem.pti_nudge = { date: today, ts: Date.now() };
    eq('E4 once shown, never again that day (no nagging)', w2.shouldNudgePti(), false);
    eq('E5 but the flag STAYS until he files', w2.ptiFlagVisible(), true);
    const w3 = nudgeWorld(planSeed, 'office');
    eq('E6 an office face never gets a driving nudge', [w3.shouldNudgePti(), w3.ptiFlagVisible()], [false, false]);
    const w4 = nudgeWorld({ onboarding: { autoStart: false, autoStartDays: [] }, dsp_list: [], dsp_active: null, pti_reports: [] });
    eq('E7 no plan and no session → no flag on a quiet day', w4.ptiFlagVisible(), false);
    w4.App.tracker.status = 'running';
    eq('E8 a running session with no PTI is flagged', w4.ptiFlagVisible(), true);
    const w5 = nudgeWorld(planSeed);
    w5._mem.pti_reports = [{ id: 'p2', date: today, kind: 'post', odometer: 169500 }];
    eq('E9 a post-trip alone does not satisfy the morning (pre-trip is the legal one)',
      w5.shouldNudgePti(), true);
  }

  console.log('\nqueue-v174 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
