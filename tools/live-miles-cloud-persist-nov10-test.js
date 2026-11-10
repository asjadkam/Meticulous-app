'use strict';
/*
 * live-miles-cloud-persist-nov10-test.js — LIVE-MILES-CLOUD-PERSIST-NOV10
 * (owner, Tue Nov 10, 2026, 09:22 CST, in his hands: he cleared the
 * app cache + force-stopped; on relaunch the dashboard read
 * "Miles (live): 0.2 km" — the morning's accrued miles (13.7 km at
 * 09:00, more since) were gone, while the session timer and the
 * day's counted load restored. His order, verbatim in substance:
 * live miles must be stored in the cloud and must never go back to
 * zero when the cache is cleared).
 *
 * THE CONVICTION (from the shipped code):
 *  - The running total accrues in the miles engine (js/miles.js)
 *    and persists ONLY into the local store: persist() ->
 *    App._store.set('livemiles') -> localStorage 'mt_livemiles',
 *    throttled at 10 s. The engine's day record is the only place
 *    the total lives on the device.
 *  - The one cloud copy is cloudsync's TELEMETRY document — a
 *    separate, shed, best-effort backup whose restore rides the
 *    pull-merge + adoption seams. On Nov 10 it demonstrably did
 *    not save the morning: the pull DID run (the tracker session
 *    and the geoloads count restored), yet the miles came back
 *    0.2 km.
 *  - The record that DOES restore every time — the tracker, the
 *    session's cloud face, re-saved on a 1-minute cadence while a
 *    session runs (v220 SESSION-CLOUD-GAP) and stamp-arbitrated
 *    in the pull — carried NO miles at all. sessionFacts reads
 *    miles only from the local livemiles record / live engine;
 *    nothing ever wrote the running total into the synced
 *    session record. The miles lived and died with the local
 *    store plus a telemetry side-channel.
 *
 * THE FIX (this suite's contract):
 *  WRITE — js/app.js: trackerSave() stamps the session's live
 *    miles onto the tracker record itself (liveMilesM /
 *    liveMilesAt / liveMilesSid), from the same sources
 *    sessionFacts reads (recordKmFor first, the live engine's
 *    currentKm as the v389 fallback), monotonic within the
 *    session, replaced when the session changes, and REMOVED
 *    when the tracker is idle — a closed day presents no floor.
 *    The stamp rides the session's existing save cadence
 *    (transitions + the v220 minute re-save) and its debounced
 *    push: no new write path, no write storm.
 *  RESTORE — js/miles.js: applyCloudFloor(key), called at the
 *    head of startDay and inside reseedFromStore (the after-pull
 *    adoption seam), reads the tracker from the store and, when
 *    it names a LIVE session (running/paused) whose pinned
 *    sessionId matches this key (the v361 ±5 s pin family) with
 *    a stamp from that session's own day, raises the local day
 *    record to at least the stamped metres — creating the record
 *    (labelled cloudFloorM, its counted-coverage span seeded
 *    [session start, stamp] so a later crumb fold dedupes
 *    instead of double-counting) when none survives. It only
 *    ever RAISES: a local record already ahead stands. An idle
 *    tracker, another session, or another day presents no floor.
 *  SEAM — js/app.js: the after-pull adoption now also fires on a
 *    'tracker' change, so a pull that lands the session record
 *    (with its floor) after the engines began still reseeds.
 *
 * Cases:
 *  W1-W6 the write side, driving the REAL trackerSave sliced out
 *     of js/app.js (the v389 slicing pattern) against stub
 *     LiveMiles shapes.
 *  R1 the incident replay: accrue -> wipe the whole local store
 *     -> only the cloud tracker face returns -> startDay restores
 *     the miles; driving on accrues new ground only; the original
 *     crumbs folded over the floored span count nothing twice.
 *  R2 a closed day (idle tracker, stale stamp fields) resurrects
 *     nothing. R3 another session / another day presents no
 *     floor. R4 a local record ahead of the floor is never
 *     reduced. R5 the after-pull door: engine begun young, the
 *     pull lands the tracker, adoptFromStore raises it. R6 a
 *     paused session's floor restores. R7 the date-keyed day
 *     watch takes no floor.
 *  P1/P2 source + version pins.
 *
 * Run: node tools/live-miles-cloud-persist-nov10-test.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');
const milesSrc = read('js/miles.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function near(a, b, tol) { return typeof a === 'number' && isFinite(a) && Math.abs(a - b) <= tol; }

/* Brace-matching slicer for one top-level function declaration. */
function sliceFn(src, name) {
  const sig = 'function ' + name + '(';
  const at = src.indexOf(sig);
  if (at === -1) return '';
  let i = src.indexOf('{', at), depth = 0, j = i;
  let str = null, lineC = false, blockC = false;
  for (; j < src.length; j++) {
    const c = src[j], n = src[j + 1];
    if (lineC) { if (c === '\n') lineC = false; continue; }
    if (blockC) { if (c === '*' && n === '/') { blockC = false; j++; } continue; }
    if (str) { if (c === '\\') { j++; continue; } if (c === str) str = null; continue; }
    if (c === '/' && n === '/') { lineC = true; continue; }
    if (c === '/' && n === '*') { blockC = true; continue; }
    if (c === "'" || c === '"' || c === '`') { str = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(at, j + 1); }
  }
  return '';
}

/* ---------------- fake clocks / stores ---------------- */
function makeClock(startMs) {
  let now = startMs;
  const RealDate = Date;
  function FakeDate(a, b, c, d, e, f, g) {
    if (a === undefined) return new RealDate(now);
    if (b === undefined) return new RealDate(a);
    return new RealDate(a, b, c || 0, d || 0, e || 0, f || 0, g || 0);
  }
  FakeDate.now = function () { return now; };
  FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC;
  return { Date: FakeDate, now: function () { return now; }, set: function (v) { now = v; } };
}
function makeStore() {
  const backing = {};
  const localStorage = {
    getItem: function (k) { return backing[k] === undefined ? null : backing[k]; },
    setItem: function (k, v) { backing[k] = String(v); },
    removeItem: function (k) { delete backing[k]; },
    key: function (i) { return Object.keys(backing)[i] || null; },
    get length() { return Object.keys(backing).length; }
  };
  const store = {
    get: function (k, d) { try { const v = localStorage.getItem('mt_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('mt_' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem('mt_' + k); return true; } catch (e) { return false; } }
  };
  return { localStorage: localStorage, store: store };
}

const S = new Date(2026, 10, 10, 8, 30, 0).getTime();   // Tue Nov 10, 2026 08:30 local — the session pin
const SKEY = 's' + S;
const HOME = { lat: 51.15709, lng: -113.93862 };        // his home corner, Calgary NE

/* ================= Part W — the write side (js/app.js) ================= */
function makeWriteWorld() {
  const clock = makeClock(S + 30 * 60000);
  const st = makeStore();
  const LiveMilesStub = {
    _rkm: null, _ckm: null,
    recordKmFor: function () { return this._rkm; },
    currentKm: function () { return this._ckm; }
  };
  const App = { tracker: { status: 'running', sessionId: S, startTs: S, elapsed: 1800 } };
  const sb = {
    console: console, JSON: JSON, Math: Math, Date: clock.Date,
    store: st.store, App: App, LiveMiles: LiveMilesStub,
    syncSessionRecord: function () {},
    setTimeout: function () { return 0; }, clearTimeout: function () {},
    setInterval: function () { return 0; }, clearInterval: function () {}
  };
  sb.window = sb;
  vm.createContext(sb);
  const code = [
    sliceFn(appSrc, 'trackerSessionStartMs'),
    sliceFn(appSrc, 'trackerSessionKeyMs'),
    sliceFn(appSrc, 'stampLiveMilesOnTracker'),
    sliceFn(appSrc, 'trackerSave'),
    ';this.__save = (typeof trackerSave === "function") ? trackerSave : null;'
  ].join('\n');
  vm.runInContext(code, sb);
  return { sb: sb, App: App, store: st.store, LM: LiveMilesStub, clock: clock };
}

console.log('Part W — the tracker record carries the running miles (js/app.js)');
{
  const w = makeWriteWorld();
  ok('W0 trackerSave sliced out of js/app.js', typeof w.sb.__save === 'function');
  w.LM._rkm = 13.7;
  w.sb.__save();
  const t = w.store.get('tracker', {});
  ok('W1 the save stamps the persisted total onto the tracker', t.liveMilesM === 13700, JSON.stringify(t.liveMilesM));
  ok('W1 the stamp names its session and its moment', t.liveMilesSid === S && t.liveMilesAt === S + 30 * 60000,
    (t.liveMilesSid || '') + '/' + (t.liveMilesAt || ''));
}
{
  const w = makeWriteWorld();
  w.LM._rkm = 13.7; w.sb.__save();
  w.LM._rkm = 9.0;                       // a young engine / stale record must not stamp backwards
  w.sb.__save();
  const t = w.store.get('tracker', {});
  ok('W2 the stamp is monotonic within the session', t.liveMilesM === 13700, JSON.stringify(t.liveMilesM));
}
{
  const w = makeWriteWorld();
  w.LM._rkm = 13.7; w.sb.__save();
  const S2 = S + 3600000;                // a NEW session an hour later
  w.App.tracker.sessionId = S2; w.App.tracker.startTs = S2; w.App.tracker.elapsed = 0;
  w.LM._rkm = null; w.LM._ckm = 2.5;     // the v389 fallback: the live engine's total
  w.sb.__save();
  const t = w.store.get('tracker', {});
  ok('W3 a new session replaces the stamp (engine fallback source)', t.liveMilesM === 2500 && t.liveMilesSid === S2,
    JSON.stringify(t.liveMilesM) + '/' + JSON.stringify(t.liveMilesSid));
}
{
  const w = makeWriteWorld();
  w.LM._rkm = null; w.LM._ckm = null;    // no fix-backed total anywhere
  w.sb.__save();
  const t = w.store.get('tracker', {});
  ok('W4 no fix, no stamp — no number is invented', t.liveMilesM === undefined, JSON.stringify(t.liveMilesM));
}
{
  const w = makeWriteWorld();
  w.App.tracker = { status: 'idle', sessionId: 0, startTs: 0, elapsed: 0, liveMilesM: 13700, liveMilesAt: S, liveMilesSid: S };
  w.LM._rkm = 13.7;
  w.sb.__save();
  const t = w.store.get('tracker', {});
  ok('W5 an idle (closed) tracker presents no floor — the stamp is removed', t.liveMilesM === undefined && t.liveMilesSid === undefined,
    JSON.stringify(t.liveMilesM));
}
{
  const w = makeWriteWorld();
  w.App.tracker.status = 'paused';
  w.LM._rkm = 3.2;
  w.sb.__save();
  const t = w.store.get('tracker', {});
  ok('W6 a paused session still stamps (it is a live session)', t.liveMilesM === 3200, JSON.stringify(t.liveMilesM));
}

/* ================= Part R — the restore side (js/miles.js) ================= */
function makeMilesWorld(startMs) {
  let now = startMs;
  let timerSeq = 0;
  const timers = [];
  function fakeSetTimeout(fn, ms) { const id = ++timerSeq; timers.push({ id: id, at: now + (ms || 0), fn: fn, interval: 0 }); return id; }
  function fakeSetInterval(fn, ms) { const id = ++timerSeq; timers.push({ id: id, at: now + (ms || 0), fn: fn, interval: Math.max(1, ms || 0) }); return id; }
  function fakeClear(id) { const i = timers.findIndex(function (t) { return t.id === id; }); if (i >= 0) timers.splice(i, 1); }
  const clock = makeClock(startMs);
  // drive the fake clock from the same `now`
  const FakeDate = clock.Date;
  const st = makeStore();
  const els = {};
  function fakeEl(id) {
    if (!els[id]) {
      const classes = new Set(['hidden']);
      els[id] = { id: id, textContent: '',
        classList: { toggle: function (c, f) { if (f === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (f) classes.add(c); else classes.delete(c); },
          add: function (c) { classes.add(c); }, remove: function (c) { classes.delete(c); },
          contains: function (c) { return classes.has(c); } } };
    }
    return els[id];
  }
  const geo = { _watching: false, _cb: null,
    available: function () { return true; }, isWatching: function () { return geo._watching; },
    start: function (cb) { geo._cb = cb; geo._watching = true; return Promise.resolve(true); },
    stop: function () { geo._watching = false; geo._cb = null; return Promise.resolve(); },
    deliver: function (fix) { if (geo._cb) geo._cb(fix); } };
  const App = { _store: st.store, geo: geo, tracker: { status: 'idle', startTs: 0, elapsed: 0 },
    _authLocked: function () { return false; } };
  const sb = { console: console, Promise: Promise, JSON: JSON, Math: Math,
    setTimeout: fakeSetTimeout, clearTimeout: fakeClear,
    setInterval: fakeSetInterval, clearInterval: fakeClear, Date: FakeDate,
    navigator: {}, localStorage: st.localStorage,
    document: { visibilityState: 'visible', hidden: false,
      getElementById: function (id) { return fakeEl(id); },
      addEventListener: function () {} },
    addEventListener: function () {}, App: App };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(milesSrc, sb);
  return {
    sb: sb, App: App, store: st.store, geo: geo,
    now: function () { return now; },
    advance: function (ms) {
      const end = now + ms;
      for (;;) {
        timers.sort(function (a, b) { return a.at - b.at; });
        const t = timers[0];
        if (!t || t.at > end) break;
        timers.shift();
        now = t.at; clock.set(now);
        if (t.interval) { t.at = now + t.interval; timers.push(t); }
        try { t.fn(); } catch (e) {}
      }
      now = end; clock.set(now);
    },
    drive: function (minutes, startLat, startLng) {
      const steps = Math.round(minutes * 2);
      for (let i = 1; i <= steps; i++) {
        this.advance(30000);
        geo.deliver({ latitude: startLat, longitude: startLng + i * 0.001, accuracy: 5, time: now });
      }
    },
    record: function (key) {
      const d = this.store.get('livemiles', { days: {} });
      return (d.days || {})[key] || null;
    }
  };
}

(async function () {
  console.log('Part R — the restore (js/miles.js)');
  /* R1: the incident, replayed */
  let kmA = 0, stampAt = 0;
  {
    const w = makeMilesWorld(S);
    const LM = w.sb.LiveMiles;
    w.App.tracker = { status: 'running', sessionId: S, startTs: S, elapsed: 0 };
    w.store.set('tracker', w.App.tracker);
    LM.startDay(SKEY, {});
    w.drive(30, HOME.lat, HOME.lng);                       // ~4.2 km of the morning
    LM.flush();
    kmA = LM.recordKmFor(SKEY);
    stampAt = w.now();
    ok('R1 setup: the morning accrues on the session record', typeof kmA === 'number' && kmA > 3, kmA);
  }
  const cloudTracker = { status: 'running', sessionId: S, startTs: S, elapsed: 1800,
    liveMilesM: Math.round(kmA * 1000), liveMilesAt: stampAt, liveMilesSid: S };
  {
    const w = makeMilesWorld(stampAt);                     // relaunch after the wipe
    const LM = w.sb.LiveMiles;
    w.App.tracker = JSON.parse(JSON.stringify(cloudTracker));
    w.store.set('tracker', w.App.tracker);                 // the pull installs the session record — and NO livemiles
    LM.startDay(SKEY, { resume: true });
    const km = LM.currentKm();
    ok('R1 the wiped phone restores the morning miles from the session record', near(km, kmA, 0.03), km + ' vs ' + kmA);
    ok('R1 the restored total is on the day record too', near(LM.recordKmFor(SKEY), kmA, 0.03), LM.recordKmFor(SKEY));
    const before = LM.currentKm();
    w.drive(10, HOME.lat, HOME.lng + 60 * 0.001);          // driving on from the restore point
    const after = LM.currentKm();
    ok('R1 new ground still accrues on top of the floor', typeof after === 'number' && after > before + 0.8,
      before + ' -> ' + after);
    const crumbs = [];
    for (let i = 1; i <= 60; i++) crumbs.push({ t: S + i * 30000, a: HOME.lat, o: Math.round((HOME.lng + i * 0.001) * 1e6) / 1e6 });
    const t0 = LM.currentKm();
    LM.mergeNativeCrumbs(crumbs);                          // the original trail folds over the floored span
    const t1 = LM.currentKm();
    ok('R1 the original crumbs never count the floored ground twice', near(t1, t0, 0.06), t0 + ' -> ' + t1);
  }
  /* R2: a closed day presents no floor */
  {
    const w = makeMilesWorld(stampAt);
    const LM = w.sb.LiveMiles;
    const idle = { status: 'idle', sessionId: 0, startTs: 0, elapsed: 0,
      liveMilesM: Math.round(kmA * 1000), liveMilesAt: stampAt, liveMilesSid: S };
    w.App.tracker = idle; w.store.set('tracker', idle);
    LM.startDay(SKEY, { resume: true });
    ok('R2 an idle tracker resurrects nothing, stamp fields or not', LM.currentKm() === null, LM.currentKm());
  }
  /* R3: another session / another day */
  {
    const w = makeMilesWorld(stampAt);
    const LM = w.sb.LiveMiles;
    w.App.tracker = JSON.parse(JSON.stringify(cloudTracker));
    w.store.set('tracker', w.App.tracker);
    LM.startDay('s' + (S + 86400000), {});                 // tomorrow's session key
    ok('R3a the floor never leaks into a different session', LM.currentKm() === null, LM.currentKm());
  }
  {
    const w = makeMilesWorld(stampAt);
    const LM = w.sb.LiveMiles;
    const yday = { status: 'running', sessionId: S - 86400000, startTs: S - 86400000, elapsed: 1800,
      liveMilesM: 13700, liveMilesAt: S - 86400000 + 1800000, liveMilesSid: S - 86400000 };
    w.App.tracker = yday; w.store.set('tracker', yday);
    LM.startDay(SKEY, {});
    ok('R3b yesterday\'s session floor never restores into today', LM.currentKm() === null, LM.currentKm());
  }
  /* R4: never reduces a local record that is ahead */
  {
    const w = makeMilesWorld(stampAt);
    const LM = w.sb.LiveMiles;
    w.App.tracker = JSON.parse(JSON.stringify(cloudTracker));
    w.store.set('tracker', w.App.tracker);
    w.store.set('livemiles', { days: {} });
    const d = w.store.get('livemiles', { days: {} });
    d.days[SKEY] = { key: SKEY, date: '2026-11-10', totalM: 20000, hasFix: true, crumbs: [], segs: [], anchor: null, joinFrom: null, bridgedM: 0, bridges: [], updatedAt: stampAt };
    w.store.set('livemiles', d);
    LM.startDay(SKEY, {});
    ok('R4 a local record ahead of the floor stands untouched', near(LM.currentKm(), 20, 0.03), LM.currentKm());
  }
  /* R5: the after-pull door — engine begun young, tracker lands later */
  {
    const w = makeMilesWorld(stampAt);
    const LM = w.sb.LiveMiles;
    const bare = { status: 'running', sessionId: S, startTs: S, elapsed: 1800 };
    w.App.tracker = bare; w.store.set('tracker', bare);
    w.store.set('livemiles', { days: {} });
    const d = w.store.get('livemiles', { days: {} });
    d.days[SKEY] = { key: SKEY, date: '2026-11-10', totalM: 200, hasFix: true, crumbs: [], segs: [], anchor: null, joinFrom: null, bridgedM: 0, bridges: [], updatedAt: stampAt };
    w.store.set('livemiles', d);
    LM.startDay(SKEY, {});
    ok('R5 setup: the young engine stands at its 0.2 km', near(LM.currentKm(), 0.2, 0.03), LM.currentKm());
    w.App.tracker = JSON.parse(JSON.stringify(cloudTracker));
    w.store.set('tracker', w.App.tracker);                // the pull lands the session record
    LM.adoptFromStore();
    ok('R5 the after-pull adoption raises the young engine to the floor', near(LM.currentKm(), kmA, 0.03), LM.currentKm());
  }
  /* R6: a paused session restores */
  {
    const w = makeMilesWorld(stampAt);
    const LM = w.sb.LiveMiles;
    const paused = JSON.parse(JSON.stringify(cloudTracker)); paused.status = 'paused';
    w.App.tracker = paused; w.store.set('tracker', paused);
    LM.startDay(SKEY, { resume: true });
    ok('R6 a paused (live) session\'s floor restores', near(LM.currentKm(), kmA, 0.03), LM.currentKm());
  }
  /* R7: the date-keyed day watch takes no floor */
  {
    const w = makeMilesWorld(stampAt);
    const LM = w.sb.LiveMiles;
    w.App.tracker = JSON.parse(JSON.stringify(cloudTracker));
    w.store.set('tracker', w.App.tracker);
    LM.startDay('d2026-11-10', {});
    const rec = w.record('d2026-11-10');
    ok('R7 the pre-session day watch is not floored', !rec || !rec.totalM, rec && rec.totalM);
  }

  console.log('Pins');
  {
    const at = appSrc.indexOf('CloudSync.onAfterPull(function (keys)');
    const block = at === -1 ? '' : appSrc.slice(at, at + 1400);
    const adoptAt = block.indexOf('LiveMiles.adoptFromStore');
    ok('P1 the after-pull adoption fires on a tracker change too',
      at !== -1 && adoptAt > 0 && block.slice(0, adoptAt).indexOf("indexOf('tracker')") !== -1);
    const milesPin = (idxSrc.match(/js\/miles\.js\?v=(\d+)/) || [])[1];
    const appPin = (idxSrc.match(/js\/app\.js\?v=(\d+)/) || [])[1];
    ok('P2 index pins for the changed files equal webVersion',
      Number(milesPin) === ver.webVersion && Number(appPin) === ver.webVersion,
      'miles ' + milesPin + ', app ' + appPin + ', web ' + ver.webVersion);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e && e.stack || e); process.exit(2); });
