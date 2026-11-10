'use strict';
/*
 * live-miles-repin-restore-nov10-test.js — LIVE-MILES-REPIN-NOV10
 * (follow-on to webs 399/401; owner verdict Nov 10, 2026, 11:12:
 * after the gen-76 install relaunch, Miles (live) read 18.1 km
 * against a day trail that already measured 27.2 km at 09:41 —
 * neither the tracker-stamp floor nor the trail fold raised it).
 *
 * THE CONVICTION (code + the day's own record):
 *  Both restore doors — cloudFloorFor (web 399) and foldDayTrail
 *  (web 401) — identify the session by the tracker record's
 *  pinned sessionId within the v361 ±5 s jitter family
 *  (FLOOR_PIN_SLACK_MS). That family assumes ONE client minting
 *  ONE pin. Nov 10 ran the account on several faces whose pins
 *  for the same day's session demonstrably diverged: the
 *  dispatch card read "started 8:03 AM", the app counted from
 *  the 8:30 dispatch pin, the native glance face read an 8:49
 *  anchor at 10:08 — and the owner reported (11:27) extra
 *  tracker Sessions in the day details he never started or
 *  stopped, i.e. sessions re-mint/re-anchor in the field.
 *  Whenever the tracker the seams read carries a re-anchored
 *  pin while the miles engine stands on the record born under
 *  the original pin, |sid − keyMs| is minutes, not jitter:
 *  the floor returns null and the fold returns 0 at EVERY
 *  seam (reseedFromStore never re-keys), so the counter stands
 *  at whatever the surviving record accrued while the day's
 *  crumb trail sits in the store unreconciled. Pin-free paths
 *  (the timer face, the loads, the total-compare reseed) all
 *  worked — only the two pin-gated doors were dead.
 *
 * THE FIX (js/miles.js): the restore doors take a second,
 * day-lineage identity tier — when the exact pin misses, a
 * LIVE tracker whose sessionId falls on the same LOCAL
 * calendar day as the day key is the same day's session (the
 * trail is filed by crumb date; the floor stamp is day-bound).
 * A different day's session and an idle tracker stay refused
 * exactly as before (the v399 R3 / v401 T4 standings).
 *
 * Cases:
 *  P1 the incident at the after-pull seam: the engine stands
 *     on the morning record (13.7 km counted, coverage spans
 *     to match); the full day trail then stands in the store
 *     under the same key while the tracker the seam reads has
 *     been re-anchored +19 min (the measured 8:30 → 8:49 face
 *     divergence). adoptFromStore must reconcile the counter
 *     UP to the trail chain.
 *  P2 the floor door under a re-pinned tracker: the day record
 *     is young (0.2 km, no crumbs — the stamp is the only
 *     source) and the stamp names the re-anchored pin.
 *     adoptFromStore must raise the counter to the stamp.
 *  P3 control: a TOMORROW sessionId reconciles nothing.
 *  P4 control: an idle tracker reconciles nothing.
 *  P5 pins: index pin for js/miles.js equals webVersion.
 *
 * Run: node tools/live-miles-repin-restore-nov10-test.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const milesSrc = read('js/miles.js');
const idxSrc = read('index.html');
const ver = JSON.parse(read('version.json'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function near(a, b, tol) { return typeof a === 'number' && isFinite(a) && Math.abs(a - b) <= tol; }

/* ---------------- fake clocks / stores (the v399/v401 harness) ---------------- */
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
function makeMilesWorld(startMs) {
  let now = startMs;
  let timerSeq = 0;
  const timers = [];
  function fakeSetTimeout(fn, ms) { const id = ++timerSeq; timers.push({ id: id, at: now + (ms || 0), fn: fn, interval: 0 }); return id; }
  function fakeSetInterval(fn, ms) { const id = ++timerSeq; timers.push({ id: id, at: now + (ms || 0), fn: fn, interval: Math.max(1, ms || 0) }); return id; }
  function fakeClear(id) { const i = timers.findIndex(function (t) { return t.id === id; }); if (i >= 0) timers.splice(i, 1); }
  const clock = makeClock(startMs);
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
    record: function (key) {
      const d = this.store.get('livemiles', { days: {} });
      return (d.days || {})[key] || null;
    }
  };
}

/* ---------------- the day ---------------- */
const S = new Date(2026, 10, 10, 8, 30, 0).getTime();       // the session pin the miles record was born under
const SKEY = 's' + S;
const REPIN = S + 19 * 60000;                               // the re-anchored pin (8:49 — the measured face divergence)
const T0 = new Date(2026, 10, 10, 7, 23, 0).getTime();      // the trail starts at home, 07:23
const LATE = new Date(2026, 10, 10, 11, 12, 0).getTime();   // the verdict moment
const HOME = { lat: 51.15709, lng: -113.93862 };

function crumb(t, lng) {
  return { t: t, a: Math.round(HOME.lat * 1e6) / 1e6, o: Math.round(lng * 1e6) / 1e6 };
}
const trailCrumbs = [];
for (let i = 0; i < 40; i++) trailCrumbs.push(crumb(T0 + i * 120000, HOME.lng + i * 0.01));
function chainKmOf(hav, crumbs) {
  const cs = crumbs.slice().sort(function (x, y) { return x.t - y.t; });
  let m = 0;
  for (let i = 1; i < cs.length; i++) m += hav(cs[i - 1].a, cs[i - 1].o, cs[i].a, cs[i].o);
  return m / 1000;
}
/* The morning record as the counter itself left it: totalM =
   the chain of the first 20 crumbs (~13.7 km — the field
   figure at 09:00), coverage spans over exactly that ground,
   but the WHOLE day trail for crumbs (the store's copy is
   crumb-complete even where the counter under-counted). */
function morningRecord(hav, withFullTrail) {
  const counted = trailCrumbs.slice(0, 20);
  const segs = [];
  for (let i = 1; i < counted.length; i++) segs.push({ f: counted[i - 1].t, t: counted[i].t });
  const last = counted[counted.length - 1];
  return { key: SKEY, date: '2026-11-10',
    totalM: Math.round(chainKmOf(hav, counted) * 1000),
    anchor: { time: last.t, latitude: last.a, longitude: last.o }, still: null,
    crumbs: (withFullTrail ? trailCrumbs : counted).slice(), hasFix: true,
    segs: segs, joinFrom: null, bridgedM: 0, bridges: [], updatedAt: last.t };
}

(async function () {
  console.log('LIVE-MILES-REPIN-NOV10');

  /* P1 — the incident at the after-pull seam */
  {
    const w = makeMilesWorld(LATE);
    const LM = w.sb.LiveMiles;
    const hav = LM._engine.haversineM;
    const trailKm = chainKmOf(hav, trailCrumbs);
    const morningKm = chainKmOf(hav, trailCrumbs.slice(0, 20));
    // boot: the tracker names the original pin; the engine begins
    const trk0 = { status: 'running', sessionId: S, startTs: S, elapsed: 3600 };
    w.App.tracker = trk0; w.store.set('tracker', trk0);
    LM.startDay(SKEY, { resume: true });
    // the first landing: the morning record (counted ground only)
    let d = w.store.get('livemiles', { days: {} });
    d.days[SKEY] = morningRecord(hav, false);
    w.store.set('livemiles', d);
    LM.adoptFromStore();
    ok('P1 setup: the counter stands at the morning record', near(LM.currentKm(), morningKm, 0.06),
      LM.currentKm() + ' vs ' + morningKm);
    // the day's later shape: the full trail stands in the store,
    // and the tracker the seams read has been re-anchored +19 min
    d = w.store.get('livemiles', { days: {} });
    d.days[SKEY] = morningRecord(hav, true);
    w.store.set('livemiles', d);
    const trkR = { status: 'running', sessionId: REPIN, startTs: REPIN, elapsed: 3600,
      liveMilesM: Math.round(morningKm * 1000), liveMilesAt: LATE - 60000, liveMilesSid: REPIN };
    w.App.tracker = trkR; w.store.set('tracker', trkR);
    LM.adoptFromStore();
    ok('P1 the re-pinned tracker no longer blocks the trail reconcile', near(LM.currentKm(), trailKm, 0.06),
      LM.currentKm() + ' vs trail ' + trailKm);
    ok('P1 the healed total is on the day record', near(LM.recordKmFor(SKEY), trailKm, 0.06), LM.recordKmFor(SKEY));
  }

  /* P2 — the floor door under a re-pinned tracker */
  {
    const w = makeMilesWorld(LATE);
    const LM = w.sb.LiveMiles;
    const hav = LM._engine.haversineM;
    const morningKm = chainKmOf(hav, trailCrumbs.slice(0, 20));
    const trk0 = { status: 'running', sessionId: S, startTs: S, elapsed: 3600 };
    w.App.tracker = trk0; w.store.set('tracker', trk0);
    LM.startDay(SKEY, { resume: true });
    // the young post-wipe record: 0.2 km, no crumbs to fold
    const young = { key: SKEY, date: '2026-11-10', totalM: 200,
      anchor: { time: LATE - 3600000, latitude: HOME.lat, longitude: HOME.lng }, still: null,
      crumbs: [], hasFix: true, segs: [], joinFrom: null, bridgedM: 0, bridges: [], updatedAt: LATE - 3600000 };
    const d = w.store.get('livemiles', { days: {} });
    d.days[SKEY] = young;
    w.store.set('livemiles', d);
    LM.adoptFromStore();
    ok('P2 setup: the young engine stands at its 0.2 km', near(LM.currentKm(), 0.2, 0.03), LM.currentKm());
    // the tracker lands re-anchored, its stamp naming the new pin
    const trkR = { status: 'running', sessionId: REPIN, startTs: REPIN, elapsed: 7200,
      liveMilesM: Math.round(morningKm * 1000), liveMilesAt: LATE - 60000, liveMilesSid: REPIN };
    w.App.tracker = trkR; w.store.set('tracker', trkR);
    LM.adoptFromStore();
    ok('P2 the floor fires under the re-anchored pin', near(LM.currentKm(), morningKm, 0.06),
      LM.currentKm() + ' vs floor ' + morningKm);
  }

  /* P3 — control: tomorrow's session reconciles nothing */
  {
    const w = makeMilesWorld(LATE);
    const LM = w.sb.LiveMiles;
    const hav = LM._engine.haversineM;
    const trk0 = { status: 'running', sessionId: S, startTs: S, elapsed: 3600 };
    w.App.tracker = trk0; w.store.set('tracker', trk0);
    LM.startDay(SKEY, { resume: true });
    const d = w.store.get('livemiles', { days: {} });
    d.days[SKEY] = morningRecord(hav, true);
    w.store.set('livemiles', d);
    LM.adoptFromStore(); // the engine first settles on the record under its own pin
    const settled = LM.currentKm();
    const trkT = { status: 'running', sessionId: S + 86400000, startTs: S + 86400000, elapsed: 60,
      liveMilesM: 999000, liveMilesAt: LATE - 60000, liveMilesSid: S + 86400000 };
    w.App.tracker = trkT; w.store.set('tracker', trkT);
    LM.adoptFromStore();
    const km = LM.currentKm();
    ok('P3 a different DAY\'s session still reconciles nothing', near(km, settled, 0.06) && km < 100,
      km + ' vs settled ' + settled + ' (no 999 km floor, no new fold)');
  }

  /* P4 — control: an idle tracker reconciles nothing */
  {
    const w = makeMilesWorld(LATE);
    const LM = w.sb.LiveMiles;
    const hav = LM._engine.haversineM;
    const trk0 = { status: 'running', sessionId: S, startTs: S, elapsed: 3600 };
    w.App.tracker = trk0; w.store.set('tracker', trk0);
    LM.startDay(SKEY, { resume: true });
    const d = w.store.get('livemiles', { days: {} });
    d.days[SKEY] = morningRecord(hav, true);
    w.store.set('livemiles', d);
    LM.adoptFromStore(); // the engine first settles on the record under its own pin
    const settled = LM.currentKm();
    const idle = { status: 'idle', sessionId: 0, startTs: 0, elapsed: 0,
      liveMilesM: 999000, liveMilesAt: LATE - 60000, liveMilesSid: REPIN };
    w.App.tracker = idle; w.store.set('tracker', idle);
    LM.adoptFromStore();
    const km = LM.currentKm();
    ok('P4 an idle (closed) tracker still presents no floor and no trail', near(km, settled, 0.06) && km < 100,
      km + ' vs settled ' + settled + ' (no 999 km floor, no new fold)');
  }

  console.log('Pins');
  {
    const milesPin = (idxSrc.match(/js\/miles\.js\?v=(\d+)/) || [])[1];
    ok('P5 index pin for js/miles.js equals webVersion', Number(milesPin) === ver.webVersion,
      'miles ' + milesPin + ', web ' + ver.webVersion);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e && e.stack || e); process.exit(2); });
