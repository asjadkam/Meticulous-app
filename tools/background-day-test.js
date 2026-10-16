#!/usr/bin/env node
/* Meticulous v92 (native v35) — BACKGROUND KILOMETRES.
 *
 * The owner's standing hard requirement (Oct 14), restated as a
 * demand Oct 16, 2026 after three straight days of live-miles
 * undercount (Oct 14: 13.7 counted of ~100 driven; Oct 15: 62.4 of
 * 177 by odometer; Oct 16: the counter "only came alive with the
 * 8:00 session"): the day's kilometres must be counted FROM THE
 * BACKGROUND — screen off, app closed, phone in his pocket.
 *
 * What this file proves, against the REAL shipped code:
 *  A. The miles ENGINE, fed ONLY a native-service breadcrumb stream
 *     (the screen is never opened; no live fix ever arrives) counts
 *     a full synthetic workday — including the pre-session drive
 *     from home, a 14-minute observer gap with endpoints observed,
 *     and a rationed stretch — within tolerance of the ground-truth
 *     route. Re-feeding the run is a no-op (exactly-once).
 *  B. A TRUE observer hole (nobody recorded a curving 20 km stretch)
 *     is counted only at its straight-line floor and is REPORTED
 *     by the gap finder — never guessed up to the road distance.
 *  C. The shifttrack GLUE in a vm with a fake v35 plugin: the armed
 *     day's crumbs (recorded before the session's start) fold into
 *     a day record that did not exist; pre-window leftovers are
 *     cleared but never folded; an UNARMED day behaves exactly like
 *     v91 (pre-session crumbs stay excluded); the drain never acks
 *     crumbs the live engine wasn't ready to fold; the battery
 *     line appears once, in plain words, with its one-tap fix.
 *  D. The ARM PLAN math (real AUTOSTART-ENGINE + App.armNativeDay
 *     extracted from js/app.js, driven over a fake clock): a
 *     tomorrow dispatch arms tomorrow at dispatch-time minus the
 *     60-minute lead under the same key the anchored session will
 *     pin; no plan / office role disarms.
 *  E. Statics: native sources carry the arm (plugin methods,
 *     receivers, permissions, watchdog), versions agree (web 92,
 *     native 35 / versionCode 10 / 1.8), pins bumped.
 * Run: node tools/background-day-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NATIVE = path.resolve(ROOT, '..', 'meticulous-native');
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.log('  NOT OK -', name); }
}

function extractFrom(src, beginMark, endMark) {
  const a = src.lastIndexOf('/*', src.indexOf(beginMark));
  const b = src.indexOf('*/', src.indexOf(endMark));
  if (a === -1 || b === -1 || b <= a) throw new Error('markers not found: ' + beginMark);
  return src.slice(a, b + 2);
}

const milesSrc = fs.readFileSync(path.join(ROOT, 'js', 'miles.js'), 'utf8');
const engineCode = extractFrom(milesSrc, 'MILES-ENGINE-BEGIN', 'MILES-ENGINE-END');
const msb = {};
vm.createContext(msb);
vm.runInContext(engineCode, msb);
const M = msb.ENGINE;
if (!M || typeof M.createMilesTracker !== 'function') throw new Error('miles engine not extracted');
const HAV = M.haversineM;

/* ---------- route synthesis ----------
   A dense ground-truth polyline in a local tangent plane around
   home (51.15709, -113.93862 — his real geometry), stepped ~25 m
   at a time with per-leg speed and gentle heading curves. */
const HOME = [51.15709, -113.93862];
function stepPt(p, headingDeg, distM) {
  const rad = Math.PI / 180;
  const dLat = (distM * Math.cos(headingDeg * rad)) / 111320;
  const dLng = (distM * Math.sin(headingDeg * rad)) / (111320 * Math.cos(p[0] * rad));
  return [p[0] + dLat, p[1] + dLng];
}
/* legs: { km, kmh, curveDegPerKm (signed), crumbEverySec (0 = endpoints only) } */
function buildDay(legs) {
  const dense = [{ ll: HOME, t: 0 }];
  let p = HOME, heading = 140, t = 0; // heading SE-ish, toward the site belt
  for (const leg of legs) {
    const steps = Math.round(leg.km * 1000 / 25);
    const dt = 25 / (leg.kmh * 1000 / 3600);
    for (let i = 0; i < steps; i++) {
      heading += (leg.curve || 0) * 0.025;
      p = stepPt(p, heading, 25);
      t += dt;
      dense.push({ ll: p, t: t });
    }
  }
  let truthM = 0;
  for (let i = 1; i < dense.length; i++) {
    truthM += HAV(dense[i - 1].ll[0], dense[i - 1].ll[1], dense[i].ll[0], dense[i].ll[1]);
  }
  /* crumbs: sample the dense timeline; legs choose their cadence */
  const crumbs = [];
  let legStartT = 0, legIdx = 0, legEndT = 0;
  {
    let acc = 0;
    const ends = legs.map(l => { acc += l.km * 1000 / (l.kmh * 1000 / 3600); return acc; });
    let nextCrumbT = 0;
    for (const d of dense) {
      while (legIdx < legs.length - 1 && d.t > ends[legIdx]) legIdx++;
      const cad = legs[legIdx].crumbEverySec;
      if (cad === 0) continue;                    // observer-dark leg
      if (d.t >= nextCrumbT) {
        crumbs.push({ t: Math.round(d.t * 1000), a: d.ll[0], o: d.ll[1], c: 8 });
        nextCrumbT = d.t + cad;
      }
    }
    // every leg's endpoint is a crumb (the service sees the stops)
    let acc2 = 0;
    for (let li = 0; li < legs.length; li++) {
      acc2 += legs[li].km * 1000 / (legs[li].kmh * 1000 / 3600);
      let best = dense[0];
      for (const d of dense) if (Math.abs(d.t - acc2) < Math.abs(best.t - acc2)) best = d;
      crumbs.push({ t: Math.round(best.t * 1000), a: best.ll[0], o: best.ll[1], c: 8 });
    }
    crumbs.sort((x, y) => x.t - y.t);
    // dedupe near-identical timestamps (endpoint may coincide with a sample)
    for (let i = crumbs.length - 1; i > 0; i--) {
      if (crumbs[i].t - crumbs[i - 1].t < 1000) crumbs.splice(i, 1);
    }
    legEndT = acc2; legStartT = legEndT;
  }
  return { dense, truthM, crumbs, durationSec: t };
}

console.log('A — a full day counted from native crumbs alone (screen never opened)');
{
  const day = buildDay([
    { km: 6, kmh: 50, curve: 2, crumbEverySec: 30 },   // pre-session: home -> highway (07:0x)
    { km: 8, kmh: 90, curve: -3, crumbEverySec: 35 },  // session leg 1
    { km: 12, kmh: 65, curve: 0, crumbEverySec: 0 },   // observer gap w/ endpoints (~11 min dark stretch)
    { km: 10, kmh: 70, curve: 4, crumbEverySec: 180 }, // rationed: a crumb every 3 min
    { km: 12, kmh: 60, curve: -2, crumbEverySec: 40 }  // the run home
  ]);
  // two garbage crumbs mid-stream: terrible accuracy, off-path — must drop
  const mid = day.crumbs[Math.floor(day.crumbs.length / 2)];
  const stream = day.crumbs.concat([
    { t: mid.t + 5000, a: mid.a + 0.01, o: mid.o + 0.01, c: 120 },
    { t: mid.t + 9000, a: mid.a - 0.01, o: mid.o, c: -1 } // unknown accuracy: accepted like the live stream
  ]).sort((x, y) => x.t - y.t);

  const tr = M.createMilesTracker();
  tr.begin('s-day', null); // begun fresh: NO saved record, NO live fix ever
  const r1 = tr.mergeCrumbs(stream);
  const got = tr.totalM();
  const ratio = got / day.truthM;
  console.log('    truth ' + (day.truthM / 1000).toFixed(2) + ' km · counted ' +
    (got / 1000).toFixed(2) + ' km · ratio ' + ratio.toFixed(4) +
    ' · crumbs used ' + r1.accepted + '/' + stream.length);
  ok(ratio >= 0.97 && ratio <= 1.005,
    'A1 day total within tolerance of ground truth (>=97%, no inflation) — got ' + (ratio * 100).toFixed(1) + '%');
  const r2 = tr.mergeCrumbs(stream);
  ok(r2.addedM === 0 && Math.abs(tr.totalM() - got) < 0.01,
    'A2 re-feeding the same crumb run adds nothing (exactly-once)');
  const gaps = M.analyzeGaps(tr.crumbs());
  ok(gaps.length >= 1 && gaps[0].approxKm >= 3,
    'A3 the observer gap inside the run is still REPORTED by the gap finder (approxKm ' +
    (gaps.length ? gaps[0].approxKm : 'none') + ')');
}

console.log('B — a true observer hole: floor counted, hole reported, never guessed up');
{
  const day = buildDay([
    { km: 5, kmh: 60, curve: 1, crumbEverySec: 30 },
    { km: 20, kmh: 80, curve: 7.5, crumbEverySec: 0 }, // nobody watching: a hard-bend 20 km detour
    { km: 3, kmh: 50, curve: 0, crumbEverySec: 30 }
  ]);
  const tr = M.createMilesTracker();
  tr.begin('s-hole', null);
  tr.mergeCrumbs(day.crumbs);
  const got = tr.totalM();
  console.log('    truth ' + (day.truthM / 1000).toFixed(2) + ' km · counted ' + (got / 1000).toFixed(2) + ' km');
  ok(got < day.truthM * 0.88,
    'B1 the unobserved curve is NOT guessed up to road distance (counted < 88% of truth)');
  ok(got > day.truthM * 0.55,
    'B2 but its straight-line floor IS counted — endpoints were observed (counted > 55%)');
  const gaps = M.analyzeGaps(tr.crumbs());
  ok(gaps.length >= 1 && gaps[0].approxKm > 8,
    'B3 the hole is named by the gap finder (approxKm ' + (gaps.length ? gaps[0].approxKm : 'none') + ')');
}

/* ---------- C: the glue in a vm ---------- */
const shiftSrc = fs.readFileSync(path.join(ROOT, 'js', 'shifttrack.js'), 'utf8');

function memStore() {
  const m = new Map();
  return {
    get(k, d) { return m.has(k) ? JSON.parse(m.get(k)) : (d === undefined ? null : d); },
    set(k, v) { m.set(k, JSON.stringify(v)); return true; },
    del(k) { m.delete(k); return true; },
    _map: m
  };
}
function elStub() {
  const classes = new Set(['hidden']);
  const el = {
    children: [], textContent: '', _html: '',
    classList: {
      add: c => classes.add(c), remove: c => classes.delete(c),
      toggle: (c, on) => { if (on === undefined) on = !classes.has(c); on ? classes.add(c) : classes.delete(c); },
      contains: c => classes.has(c)
    },
    appendChild(c) { el.children.push(c); return c; },
    set innerHTML(v) { el._html = v; if (v === '') el.children = []; },
    get innerHTML() { return el._html; }
  };
  return el;
}
function makeGlueWorld(opts) {
  const store = memStore();
  const banner = elStub();
  const pluginState = {
    crumbs: (opts.crumbs || []).slice(),
    calls: [],
    status: opts.status
  };
  const plugin = {
    start(o) { pluginState.calls.push(['start', o && o.sessionKey]); return Promise.resolve({ started: true }); },
    stop() { pluginState.calls.push(['stop']); return Promise.resolve({ stopped: true }); },
    status() { return Promise.resolve(pluginState.status); },
    readCrumbs(o) {
      const since = (o && o.since) || 0;
      return Promise.resolve({ crumbs: pluginState.crumbs.filter(c => c.t > since), more: false });
    },
    ack(o) {
      pluginState.calls.push(['ack', o && o.upTo]);
      pluginState.crumbs = pluginState.crumbs.filter(c => c.t > o.upTo);
      return Promise.resolve({ deleted: 0 });
    },
    requestBackground() { return Promise.resolve({ granted: false }); },
    openBatterySettings() { pluginState.calls.push(['openBatterySettings']); return Promise.resolve({ opened: true }); },
    openAppSettings() { return Promise.resolve({ opened: true }); }
  };
  if (opts.armCapable !== false) {
    plugin.armDay = function (o) { pluginState.calls.push(['armDay', o]); return Promise.resolve({ armed: true }); };
    plugin.disarmDay = function () { pluginState.calls.push(['disarmDay']); return Promise.resolve({ disarmed: true }); };
  }
  const LiveMilesStub = {
    _engine: M,
    dayKey: () => opts.liveDayKey || null,
    recordKmFor: (key) => {
      const d = store.get('livemiles', null);
      const rec = d && d.days && d.days[key];
      if (!rec || !rec.hasFix || typeof rec.totalM !== 'number') return null;
      return Math.round(rec.totalM / 10) / 100;
    }
  };
  const sandbox = {
    console, Promise, Date, Math, JSON, Object, Array, String, Number, isFinite, parseInt,
    setInterval: () => 1, clearInterval: () => {},
    document: {
      getElementById: id => (id === 'trkBgAsk' ? banner : null),
      createElement: () => elStub(),
      createTextNode: t => ({ textContent: t }),
      addEventListener: () => {}
    }
  };
  sandbox.window = sandbox;
  sandbox.App = { _store: store, tracker: { status: opts.trackerStatus || 'idle' } };
  sandbox.Capacitor = { Plugins: { ShiftTrack: plugin } };
  sandbox.LiveMiles = LiveMilesStub;
  vm.createContext(sandbox);
  vm.runInContext(shiftSrc, sandbox);
  return { ST: sandbox.ShiftTrack, store, banner, pluginState, sandbox };
}
async function flush(n) { for (let i = 0; i < (n || 24); i++) await new Promise(r => setTimeout(r, 5)); }

/* Shared geometry for C: session start 08:00, arm fire 07:00. A crumb
   line running east every 5 min / 500 m from 07:15 to 09:55 (10 km of
   driving inside the armed window), plus a yesterday leftover. */
const C_T0 = 1760500000000;
const C_START = C_T0 + 8 * 3600 * 1000;
const C_FIRE = C_START - 60 * 60 * 1000;
const C_KEY = 's' + C_START;
function cCrumb(t, eastM, acc) {
  const ll = [HOME[0], HOME[1] + eastM / (111320 * Math.cos(HOME[0] * Math.PI / 180))];
  return { t: t, a: ll[0], o: ll[1], c: acc === undefined ? 8 : acc };
}
function cStream() {
  const out = [{ t: C_START - 26 * 3600 * 1000, a: 50.1, o: -113.1, c: 8 }]; // yesterday leftover
  for (let i = 0; i <= 20; i++) out.push(cCrumb(C_FIRE + 15 * 60000 + i * 5 * 60000, i * 500));
  return out;
}
function cStatus(extra) {
  return Object.assign({
    available: true, sessionActive: true, sessionKey: C_KEY, startedAt: C_FIRE,
    crumbCount: 99, lastCrumbT: C_START, lastError: '',
    fineLocation: true, backgroundLocation: true, notifications: true, batteryExempt: true,
    armed: true, armSessionKey: C_KEY, armFireMs: C_FIRE, armStartMs: C_START,
    armDate: '2026-10-15', armStarted: true, alarmTier: 'exact', watchdogRefusals: 0
  }, extra || {});
}

(async function () {
  console.log('C — shifttrack glue: armed-day drain, cutoff, banner');
  {
    // C1: the armed morning, app dead until after the session "ran":
    // boot with the tracker idle -> foldIntoRecord must CREATE the
    // record and fold the pre-session crumbs; the leftover is
    // cleared by the ack but contributes nothing.
    const w = makeGlueWorld({ crumbs: cStream(), status: cStatus(), trackerStatus: 'idle' });
    w.ST.syncOnBoot();
    await flush();
    const d = w.store.get('livemiles', null);
    const rec = d && d.days && d.days[C_KEY];
    ok(!!rec, 'C1a a record was CREATED for the natively-recorded day (none existed)');
    ok(rec && rec.hasFix && Math.abs(rec.totalM - 10000) <= 100,
      'C1b the full window counts — 10.00 km incl. the pre-session drive (got ' +
      (rec ? (rec.totalM / 1000).toFixed(2) : 'none') + ' km)');
    const ack = w.pluginState.calls.find(c => c[0] === 'ack');
    ok(!!ack && ack[1] === C_FIRE + 15 * 60000 + 20 * 5 * 60000,
      'C1c crumbs acked up to the newest crumb read (leftovers cleared, not kept)');
    ok(w.pluginState.calls.some(c => c[0] === 'stop'),
      'C1d boot with an idle tracker stops the orphaned native recording after the fold');
  }
  {
    // C2: the SAME morning with NO arm (old-shell behavior): the
    // drain cutoff stays at the session start — pre-session crumbs
    // are excluded exactly as in v91.
    const w = makeGlueWorld({ crumbs: cStream(), status: cStatus({ armed: false, armStarted: false, armFireMs: 0, startedAt: C_START }), trackerStatus: 'idle' });
    w.ST.syncOnBoot();
    await flush();
    const d = w.store.get('livemiles', null);
    const rec = d && d.days && d.days[C_KEY];
    // crumbs at/after start-60s: i where C_FIRE+15m+i*5m >= C_START-60s -> i >= 8 (08:00 crumb at i=9; cutoff 07:59)
    ok(rec && rec.totalM > 4000 && rec.totalM < 6500,
      'C2 unarmed day keeps the v91 cutoff — only the post-start stretch counts (got ' +
      (rec ? (rec.totalM / 1000).toFixed(2) : 'none') + ' km of 10)');
  }
  {
    // C3: live tracker, engine not ready: the drain must NOT ack
    // (the v69 hole stays closed) even with an arm widening the window.
    const w = makeGlueWorld({ crumbs: cStream(), status: cStatus(), trackerStatus: 'running', liveDayKey: null });
    w.ST.armDay({ key: C_KEY, fireMs: C_FIRE, startMs: C_START, date: '2026-10-15' });
    await flush(4);
    w.ST.drainNow();
    await flush();
    ok(!w.pluginState.calls.some(c => c[0] === 'ack'),
      'C3 no ack while the live engine is not ready — crumbs survive for the next drain');
  }
  {
    // C4: the battery line — once, plain words, one-tap fix.
    const w = makeGlueWorld({
      crumbs: [], trackerStatus: 'running', liveDayKey: C_KEY,
      status: cStatus({ batteryExempt: false })
    });
    w.ST.sessionStarted(C_KEY);
    await flush();
    const texts = w.banner.children.map(c => c.textContent || '');
    ok(!w.banner.classList.contains('hidden') && texts.some(t => t.indexOf('Unrestricted') !== -1),
      'C4a restricted battery -> one plain line in the tracker area naming the fix');
    const battBtn = w.banner.children.find(c => c.textContent === 'Open battery settings');
    ok(!!battBtn, 'C4b the line carries its one-tap fix (Open battery settings)');
    if (battBtn) { battBtn.onclick(); await flush(4); }
    ok(w.pluginState.calls.some(c => c[0] === 'openBatterySettings'),
      'C4c the tap opens the system battery settings');
    ok(w.banner.classList.contains('hidden'),
      'C4d and the ask is settled for the session — it does not come back');
  }
  {
    // C5: a refused service is the same one line, not a new nag.
    const w = makeGlueWorld({
      crumbs: [], trackerStatus: 'running', liveDayKey: C_KEY,
      status: cStatus({ batteryExempt: true, lastError: 'watchdog-restart-refused' })
    });
    w.ST.sessionStarted(C_KEY);
    await flush();
    const texts = w.banner.children.map(c => c.textContent || '');
    ok(texts.some(t => t.indexOf('stopped background counting') !== -1),
      'C5 a phone-refused service surfaces once as the same battery line');
  }
  {
    // C6: arm wrappers — stored window + plugin call; old shell inert.
    const w = makeGlueWorld({ crumbs: [], status: cStatus() });
    await w.ST.armDay({ key: C_KEY, fireMs: C_FIRE, startMs: C_START, date: '2026-10-15' });
    const stored = w.store.get('dayarm', null);
    ok(stored && stored.key === C_KEY && stored.fireMs === C_FIRE,
      'C6a armDay remembers the day window in the web store');
    const armCall = w.pluginState.calls.find(c => c[0] === 'armDay');
    ok(armCall && armCall[1].sessionKey === C_KEY && armCall[1].fireMs === C_FIRE,
      'C6b armDay hands the native side the key + fire time');
    await w.ST.disarmDay();
    ok(!w.store.get('dayarm', null) && w.pluginState.calls.some(c => c[0] === 'disarmDay'),
      'C6c disarmDay forgets the window and cancels natively');
    const old = makeGlueWorld({ crumbs: [], status: cStatus(), armCapable: false });
    const r = await old.ST.armDay({ key: C_KEY, fireMs: C_FIRE, startMs: C_START, date: '2026-10-15' });
    ok(r === null && !old.store.get('dayarm', null),
      'C6d a pre-v35 shell: arming is inert — no stored window, no throw');
  }

  console.log('D — arm plan math (real engine + armNativeDay, fake clock)');
  {
    const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
    const region = extractFrom(appSrc, 'AUTOSTART-ENGINE-BEGIN', 'AUTOSTART-ENGINE-END');
    const armStart = appSrc.indexOf('var ARM_LEAD_MS');
    const armEnd = appSrc.indexOf('\n  };', armStart);
    if (armStart === -1 || armEnd === -1) throw new Error('armNativeDay not found in app.js');
    const armCode = appSrc.slice(armStart, armEnd + 5);

    const RealDate = Date;
    const FIXED = new RealDate(2026, 9, 14, 15, 0, 0, 0).getTime(); // Wed Oct 14 2026, 15:00 local
    class FakeDate extends RealDate {
      constructor(...a) { super(...(a.length ? a : [FIXED])); }
      static now() { return FIXED; }
    }
    function todayStrOf(d) {
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }
    function world(opts) {
      const store = memStore();
      store.set('onboarding', { autoStart: opts.autoStart !== false, autoStartTime: '08:00', autoStartDays: [0, 1, 2, 3, 4, 5, 6] });
      store.set('dsp_list', opts.dspList || []);
      store.set('dsp_active', null);
      store.set('autostart_override', null);
      store.set('autostart', opts.fired ? { '2026-10-14': true } : {});
      const calls = [];
      const sb = {
        console, Math, JSON, Object, Array, String, Number, isFinite, parseInt, Date: FakeDate,
        store, todayStr: todayStrOf,
        confirm: () => false,
        resetAccum: () => {}, trackerSave: () => {}, trackerPaint: () => {},
        maybePromptOdo: () => {}, trackerSessionStartMs: () => FIXED
      };
      sb.window = { ShiftTrack: {
        armDay: a => { calls.push(['armDay', a]); return Promise.resolve(null); },
        disarmDay: () => { calls.push(['disarmDay']); return Promise.resolve(null); }
      } };
      sb.App = { tracker: { status: opts.trackerStatus || 'idle' }, userRole: () => opts.role || 'driver' };
      vm.createContext(sb);
      vm.runInContext(region + '\n' + armCode, sb);
      return { App: sb.App, calls };
    }
    const msOf = (dateStr, hhmm) => {
      const dp = dateStr.split('-'), tp = hhmm.split(':');
      return new RealDate(+dp[0], +dp[1] - 1, +dp[2], +tp[0], +tp[1], 0, 0).getTime();
    };
    // D1: tomorrow carries a 07:30 dispatch; today already fired.
    {
      const w = world({ fired: true, dspList: [{ id: 'd1', status: 'scheduled', scheduledAt: '2026-10-15T07:30' }] });
      w.App.armNativeDay();
      const arm = w.calls.find(c => c[0] === 'armDay');
      const wantMs = msOf('2026-10-15', '07:30');
      ok(!!arm, 'D1a a tomorrow dispatch produces an arm');
      ok(arm && arm[1].key === 's' + wantMs && arm[1].startMs === wantMs,
        'D1b the arm key/start = the anchored session identity (s<dispatch start>)');
      ok(arm && arm[1].fireMs === wantMs - 3600000 && arm[1].date === '2026-10-15',
        'D1c fire time = start minus the 60-minute lead');
    }
    // D2: no dispatch anywhere, today fired -> tomorrow at the standing time.
    {
      const w = world({ fired: true });
      w.App.armNativeDay();
      const arm = w.calls.find(c => c[0] === 'armDay');
      ok(arm && arm[1].startMs === msOf('2026-10-15', '08:00'),
        'D2 no dispatch: tomorrow arms at the standing 08:00 setting');
    }
    // D3: a session is running -> today is skipped, tomorrow armed.
    {
      const w = world({ trackerStatus: 'running', dspList: [{ id: 'd2', status: 'scheduled', scheduledAt: '2026-10-15T06:45' }] });
      w.App.armNativeDay();
      const arm = w.calls.find(c => c[0] === 'armDay');
      ok(arm && arm[1].startMs === msOf('2026-10-15', '06:45'),
        'D3 mid-session: the arm belongs to tomorrow, never today');
    }
    // D4/D5: no plan (auto-start off) and office role both disarm.
    {
      const w = world({ autoStart: false });
      w.App.armNativeDay();
      ok(w.calls.some(c => c[0] === 'disarmDay') && !w.calls.some(c => c[0] === 'armDay'),
        'D4 auto-start off -> disarm, no arm');
      const w2 = world({ role: 'office' });
      w2.App.armNativeDay();
      ok(w2.calls.some(c => c[0] === 'disarmDay'), 'D5 office role -> disarm');
    }
  }

  console.log('E — statics: native arm, versions, pins');
  {
    const plugin = fs.readFileSync(path.join(NATIVE, 'android/app/src/main/java/com/meticuloustechnologies/app/ShiftTrackPlugin.java'), 'utf8');
    const manifest = fs.readFileSync(path.join(NATIVE, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
    const gradle = fs.readFileSync(path.join(NATIVE, 'android/app/build.gradle'), 'utf8');
    const sched = fs.readFileSync(path.join(NATIVE, 'android/app/src/main/java/com/meticuloustechnologies/app/DayScheduler.java'), 'utf8');
    const service = fs.readFileSync(path.join(NATIVE, 'android/app/src/main/java/com/meticuloustechnologies/app/ShiftTrackingService.java'), 'utf8');
    const boot = fs.readFileSync(path.join(NATIVE, 'android/app/src/main/java/com/meticuloustechnologies/app/BootReceiver.java'), 'utf8');
    ok(/public void armDay\(PluginCall/.test(plugin) && /public void disarmDay\(PluginCall/.test(plugin),
      'E1 the plugin carries armDay + disarmDay');
    ok(manifest.includes('.DayAlarmReceiver') && manifest.includes('.WatchdogReceiver'),
      'E2 both receivers are in the manifest');
    ok(manifest.includes('SCHEDULE_EXACT_ALARM') && manifest.includes('USE_EXACT_ALARM') &&
       manifest.includes('REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'),
      'E3 exact-alarm + battery-dialog permissions declared');
    ok(sched.includes('setAlarmClock') && sched.includes('canScheduleExactAlarms') && sched.includes('tryStartFromArm'),
      'E4 DayScheduler: exact tier, alarm-clock tier, guarded arm start');
    ok(service.includes('DayScheduler.scheduleWatchdog') && service.includes('onTaskRemoved'),
      'E5 the service keeps the watchdog chain and pokes it on task removal');
    ok(boot.includes('armPending') && boot.includes('scheduleDayAlarm'),
      'E6 a reboot restores a pending arm');
    ok(/versionCode 10/.test(gradle) && /versionName "1\.8"/.test(gradle),
      'E7 native version bumped (code 10 / name 1.8)');
    const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
    /* v98: webVersion moved to 98 (Navigator ships with the routing-server default; native unchanged) */
    ok(vj.webVersion === 98 && vj.version === 35, 'E8 version.json: web 98, native 35');
    const appSrc2 = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
    ok(/var APK_VERSION = 35;/.test(appSrc2), 'E9 app.js APK_VERSION = 35');
    const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    ok(!idx.includes('?v=95') && idx.includes('?v=96'), 'E10 index.html pins moved to ?v=96 (v96 bump)');
    const lead = /var ARM_LEAD_MS = (\d+) \* 60 \* 1000/.exec(appSrc2);
    const slack = /ADOPT_FIRST_SLACK_MS = (\d+) \* 60 \* 1000/.exec(milesSrc);
    ok(lead && slack && +lead[1] === +slack[1],
      'E11 the arm lead equals the miles engine adoption slack (one window, two names)');
  }

  console.log('\nbackground-day-test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
