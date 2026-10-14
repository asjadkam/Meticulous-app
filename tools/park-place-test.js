#!/usr/bin/env node
/* Meticulous v74 — park-place nudges: tests.
 * Part A: the pure PARK-ENGINE (learner + detector) extracted from
 *   js/parkplace.js — overnight/session-edge clustering learns a
 *   place; drift + bad-accuracy fixes never teach or trigger; a
 *   morning arrival yields exactly one ask; a running session
 *   suppresses the morning ask; an evening return with the session
 *   running yields the close ask once; a new day re-arms; stale
 *   (breadcrumb-replay) arrivals stay silent.
 * Part B: the REAL glue in a vm — manual set, in-app card, real
 *   LocalNotifications scheduling on the shell path, dismissal,
 *   session-edge learning, crumb-replay silence, no-plugin world.
 * Part C: statics (DOM anchors, pins, prefs block, drain hook, spec).
 * Run: node tools/park-place-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'parkplace.js'), 'utf8');
const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok - ' + name); }
  else { fail++; console.log('  FAIL - ' + name); }
}

/* Local-time scripted clock — deterministic in any host timezone. */
function D(day, h, m, s) { return new Date(2026, 9, day, h, m || 0, s || 0).getTime(); }
const P = { lat: 51.05, lng: -114.07 };               // the park place
function off(lat, lng, eM, nM) {
  return [lat + nM / 111320, lng + eM / (111320 * Math.cos(lat * Math.PI / 180))];
}
function fxAt(ll, t, acc) { return { latitude: ll[0], longitude: ll[1], accuracy: acc == null ? 8 : acc, time: t }; }
function fxP(t, acc) { return fxAt([P.lat, P.lng], t, acc); }

/* ================= Part A: the pure engine ================= */
console.log('Part A — PARK-ENGINE (learner + detector)');
const engSrc = src.match(/\/\* PARK-ENGINE-BEGIN[\s\S]*?\*\/([\s\S]*?)\/\* PARK-ENGINE-END/)[1];
const engBox = { Date: Date, Math: Math, JSON: JSON, Object: Object, isFinite: isFinite };
engBox.window = engBox;
vm.createContext(engBox);
const ENGINE = vm.runInContext(engSrc + '\n;ENGINE;', engBox);
ok(!!ENGINE && typeof ENGINE.createLearner === 'function' && typeof ENGINE.createDetector === 'function', 'engine extracted with learner + detector');

/* learner: 3 edge points over 2 days qualify; fewer do not */
(function () {
  const L = ENGINE.createLearner(null);
  ok(L.observe('start', fxP(D(14, 7, 0))) === null, 'learner: 1 point — no place yet');
  ok(L.observe('end', fxP(D(14, 19, 0))) === null, 'learner: 2 points, 1 day — no place yet');
  const near = off(P.lat, P.lng, 30, 20);
  const got = L.observe('start', fxAt(near, D(15, 7, 5)));
  ok(!!got && got.days === 2 && got.points === 3, 'learner: 3rd point on day 2 qualifies (days=2, points=3)');
  ok(ENGINE.haversineM(got.lat, got.lng, P.lat, P.lng) < 60, 'learner: centroid sits on the cluster (<60 m)');
})();
/* learner: a far drift cluster never hijacks or qualifies early */
(function () {
  const L = ENGINE.createLearner(null);
  L.observe('start', fxP(D(14, 7, 0)));
  L.observe('end', fxP(D(14, 19, 0)));
  const far = off(P.lat, P.lng, 3000, 0);
  ok(L.observe('start', fxAt(far, D(15, 7, 0))) === null, 'learner: far point forms its own 1-point cluster — no place');
  const got = L.observe('end', fxP(D(15, 19, 0)));
  ok(!!got && ENGINE.haversineM(got.lat, got.lng, P.lat, P.lng) < 60, 'learner: qualifies on the home cluster, centroid unmoved by the far point');
})();
/* learner: bad-accuracy points are dropped */
(function () {
  const L = ENGINE.createLearner(null);
  L.observe('start', fxP(D(14, 7, 0)));
  L.observe('end', fxP(D(14, 19, 0)));
  ok(L.observe('start', fxP(D(15, 7, 0), 90)) === null, 'learner: accuracy 90 m point ignored — still no place');
  ok(!!L.observe('start', fxP(D(15, 7, 2))), 'learner: a good 3rd point then qualifies');
})();
/* detector: morning arrival — exactly one ask, dwell-gated */
(function () {
  const det = ENGINE.createDetector(P, null);
  const ctx = { sessionActive: false, nowMs: D(14, 7, 31, 10) };
  ok(det.feed(fxP(D(14, 7, 30, 0)), ctx) === null, 'detector: first inside fix only starts the dwell');
  const ev = det.feed(fxP(D(14, 7, 31, 10)), ctx);
  ok(!!ev && ev.type === 'morning', 'detector: 70 s inside → the morning ask');
  ok(det.feed(fxP(D(14, 7, 32, 0)), ctx) === null, 'detector: still inside — no second ask');
  ok(det.phase() === 'in', 'detector: phase is in');
})();
/* detector: a running session suppresses the morning ask */
(function () {
  const det = ENGINE.createDetector(P, null);
  const ctx = { sessionActive: true, nowMs: D(14, 7, 31, 10) };
  det.feed(fxP(D(14, 7, 30, 0)), ctx);
  ok(det.feed(fxP(D(14, 7, 31, 10)), ctx) === null, 'detector: session already running — no morning ask');
})();
/* detector: evening return with the session running — one close ask */
(function () {
  const det = ENGINE.createDetector(P, null);
  const away = off(P.lat, P.lng, 5000, 0);
  det.feed(fxAt(away, D(14, 17, 0, 0)), { sessionActive: true, nowMs: D(14, 17, 0, 0) });
  ok(det.phase() === 'out', 'detector: away fixes put the phase out');
  det.feed(fxP(D(14, 18, 0, 0)), { sessionActive: true, nowMs: D(14, 18, 0, 0) });
  const ev = det.feed(fxP(D(14, 18, 1, 10)), { sessionActive: true, nowMs: D(14, 18, 1, 10) });
  ok(!!ev && ev.type === 'evening', 'detector: evening return, session running → the close ask');
  ok(det.feed(fxP(D(14, 18, 2, 0)), { sessionActive: true, nowMs: D(14, 18, 2, 0) }) === null, 'detector: no second close ask');
})();
/* detector: evening return with NO session — nothing to close, no ask */
(function () {
  const det = ENGINE.createDetector(P, null);
  det.feed(fxP(D(14, 18, 0, 0)), { sessionActive: false, nowMs: D(14, 18, 0, 0) });
  ok(det.feed(fxP(D(14, 18, 1, 10)), { sessionActive: false, nowMs: D(14, 18, 1, 10) }) === null, 'detector: no session running — no evening ask');
})();
/* detector: bad fixes and the neutral band never move the state */
(function () {
  const det = ENGINE.createDetector(P, null);
  const ctx = { sessionActive: false, nowMs: D(14, 7, 31, 0) };
  ok(det.feed(fxP(D(14, 7, 30, 0), 90), ctx) === null && det.phase() === 'unknown', 'detector: accuracy 90 m fix ignored entirely');
  const band = off(P.lat, P.lng, 200, 0);
  det.feed(fxAt(band, D(14, 7, 30, 30)), ctx);
  ok(det.phase() === 'unknown', 'detector: 200 m neutral-band fix changes nothing');
  det.feed(fxP(D(14, 7, 30, 40)), ctx);
  ok(det.phase() === 'unknown', 'detector: dwell restarts after the band — not yet arrived');
  const ev = det.feed(fxP(D(14, 7, 31, 50)), ctx);
  ok(!!ev && ev.type === 'morning', 'detector: full 70 s dwell after clean fixes → morning ask');
})();
/* detector: departure needs a sustained absence; next day re-arms */
(function () {
  const det = ENGINE.createDetector(P, null);
  det.feed(fxP(D(14, 18, 0, 0)), { sessionActive: true, nowMs: D(14, 18, 0, 0) });
  det.feed(fxP(D(14, 18, 1, 10)), { sessionActive: true, nowMs: D(14, 18, 1, 10) }); // evening ask used
  const away = off(P.lat, P.lng, 900, 0);
  det.feed(fxAt(away, D(14, 18, 5, 0)), { sessionActive: true, nowMs: D(14, 18, 5, 0) });
  ok(det.phase() === 'in', 'detector: 0 s outside — still in (departure dwell)');
  det.feed(fxAt(away, D(14, 18, 7, 10)), { sessionActive: true, nowMs: D(14, 18, 7, 10) });
  ok(det.phase() === 'out', 'detector: 130 s outside — departed');
  const ev = det.feed(fxP(D(15, 7, 0, 0)), { sessionActive: false, nowMs: D(15, 7, 0, 0) });
  ok(ev === null && det.phase() === 'out', 'detector: next-day first fix starts a fresh dwell');
  const ev2 = det.feed(fxP(D(15, 7, 1, 10)), { sessionActive: false, nowMs: D(15, 7, 1, 10) });
  ok(!!ev2 && ev2.type === 'morning', 'detector: next day re-arms — the morning ask fires again');
})();
/* detector: already-in on the first fix of a new day still owes the morning ask */
(function () {
  const det = ENGINE.createDetector(P, null);
  det.feed(fxP(D(14, 18, 0, 0)), { sessionActive: true, nowMs: D(14, 18, 0, 0) });
  det.feed(fxP(D(14, 18, 1, 10)), { sessionActive: true, nowMs: D(14, 18, 1, 10) }); // slept 'in'
  const ev = det.feed(fxP(D(15, 7, 15, 0)), { sessionActive: false, nowMs: D(15, 7, 15, 0) });
  ok(!!ev && ev.type === 'morning', 'detector: first contact of a new day inside the fence → morning ask');
})();
/* detector: stale replays update state silently; out-of-order fixes die */
(function () {
  const det = ENGINE.createDetector(P, null);
  det.feed(fxP(D(14, 7, 30, 0)), { sessionActive: false, nowMs: D(14, 9, 0, 0) });
  const ev = det.feed(fxP(D(14, 7, 31, 10)), { sessionActive: false, nowMs: D(14, 9, 0, 0) });
  ok(ev === null && det.phase() === 'in', 'detector: 90-min-old replayed arrival — phase updates, NO nudge');
  ok(det.feed(fxP(D(14, 7, 31, 5)), { sessionActive: false, nowMs: D(14, 9, 0, 0) }) === null, 'detector: out-of-order fix ignored');
})();

/* ================= Part B: the real glue ================= */
console.log('Part B — glue (vm, fake store / LiveMiles / geo / LocalNotifications)');
function mkStore(seed) {
  const data = {};
  Object.keys(seed || {}).forEach(function (k) { data[k] = JSON.parse(JSON.stringify(seed[k])); });
  return {
    get: function (k, dflt) { return (k in data) ? JSON.parse(JSON.stringify(data[k])) : dflt; },
    set: function (k, v) { data[k] = JSON.parse(JSON.stringify(v)); },
    del: function (k) { delete data[k]; },
    _data: data
  };
}
function mkEl() {
  const el = { children: [], _cls: new Set(['hidden']), textContent: '', className: '', onclick: null, _html: '' };
  el.classList = {
    add: function (c) { el._cls.add(c); }, remove: function (c) { el._cls.delete(c); },
    toggle: function (c, f) { if (f) el._cls.add(c); else el._cls.delete(c); },
    contains: function (c) { return el._cls.has(c); }
  };
  el.appendChild = function (c) { el.children.push(c); return c; };
  el.scrollIntoView = function () {};
  Object.defineProperty(el, 'innerHTML', {
    set: function (v) { el._html = v; if (v === '') el.children = []; },
    get: function () { return el._html; }
  });
  return el;
}
function mkWorld(opts) {
  opts = opts || {};
  let fakeNow = opts.now || D(14, 6, 0, 0);
  const RealDate = Date;
  function FakeDate() {
    if (arguments.length) return new (Function.prototype.bind.apply(RealDate, [null].concat(Array.prototype.slice.call(arguments))))();
    return new RealDate(fakeNow);
  }
  FakeDate.now = function () { return fakeNow; };
  FakeDate.prototype = RealDate.prototype;
  const store = mkStore(opts.seed);
  const parkCard = mkEl();
  const intervals = [];
  const scheduled = [];
  const lnStub = {
    schedule: function (req) { scheduled.push(req); return Promise.resolve(); },
    checkPermissions: function () { return Promise.resolve({ display: 'granted' }); },
    requestPermissions: function () { return Promise.resolve({ display: 'granted' }); },
    registerActionTypes: function () { return Promise.resolve(); },
    addListener: function () { return Promise.resolve(); }
  };
  let fixHandler = null;
  const sb = {
    console: console, Math: Math, JSON: JSON, Object: Object, isFinite: isFinite,
    Promise: Promise, Date: FakeDate,
    setInterval: function (fn) { intervals.push(fn); return intervals.length; },
    clearInterval: function () {},
    setTimeout: function () { return 0; }
  };
  sb.window = sb;
  sb.App = {
    _store: store,
    tracker: { status: 'idle', startTs: 0, elapsed: 0 },
    trackerToggle: function () { sb.__toggled = (sb.__toggled || 0) + 1; },
    trackerStopPrompt: function () { sb.__stopPrompted = (sb.__stopPrompted || 0) + 1; }
  };
  sb.LiveMiles = { subscribe: function (fn) { fixHandler = fn; }, available: function () { return true; } };
  sb.MeticulousGeo = {
    available: function () { return true; },
    getCurrent: function () { return Promise.resolve(fxP(fakeNow)); }
  };
  sb.document = {
    readyState: 'complete', visibilityState: 'visible',
    getElementById: function (id) { return id === 'parkCard' ? parkCard : null; },
    createElement: function () { return mkEl(); },
    addEventListener: function () {}
  };
  if (!opts.noPlugin) sb.Capacitor = { Plugins: { LocalNotifications: lnStub } };
  vm.createContext(sb);
  vm.runInContext(src, sb);
  return {
    sb: sb, store: store, parkCard: parkCard, scheduled: scheduled, intervals: intervals,
    PP: sb.ParkPlace,
    setNow: function (t) { fakeNow = t; },
    feed: function (fix) { if (fixHandler) fixHandler(fix); },
    poll: function () { intervals.forEach(function (fn) { fn(); }); }
  };
}
function flush() { return new Promise(function (r) { setTimeout(r, 10); }); }

(async function () {
  /* B1: manual set → morning arrival posts ONE real notification + the card; dismiss quiets the day */
  {
    const w = mkWorld({ now: D(14, 6, 0, 0) });
    await flush();
    ok(w.PP && w.PP.info().notificationsAvailable === true, 'B1: LocalNotifications detected on the shell path');
    await w.PP.setPlaceHere();
    const pl = w.store.get('park_place', null);
    ok(!!pl && pl.source === 'manual' && Math.abs(pl.lat - P.lat) < 1e-9, 'B1: manual "set where I park" saved park_place (manual)');
    w.setNow(D(14, 7, 30, 0)); w.feed(fxP(D(14, 7, 30, 0)));
    ok(w.scheduled.length === 0, 'B1: first inside fix — nothing posted yet (dwell)');
    w.setNow(D(14, 7, 31, 10)); w.feed(fxP(D(14, 7, 31, 10)));
    await flush();
    ok(w.scheduled.length === 1 && w.scheduled[0].notifications[0].id === 7401, 'B1: morning arrival → ONE local notification (id 7401)');
    ok(w.scheduled[0].notifications[0].actionTypeId === 'park-morning', 'B1: notification carries the morning action type (Start shift / Not now)');
    ok(!w.parkCard._cls.has('hidden') && w.parkCard.children.length >= 2, 'B1: the in-app card shows too');
    ok(w.parkCard.children[0].textContent.indexOf('Start your shift?') >= 0, 'B1: card asks "Start your shift?"');
    w.feed(fxP(D(14, 7, 32, 0))); await flush();
    ok(w.scheduled.length === 1, 'B1: no second notification');
    w.PP.dismiss('morning');
    ok(w.parkCard._cls.has('hidden'), 'B1: Not now hides the card');
    ok(w.store.get('park_state', {}).card === null, 'B1: dismissal persisted in park_state');
  }
  /* B2: evening return with the session running → the close ask, card + notification */
  {
    const w = mkWorld({ now: D(14, 17, 55, 0), seed: { park_place: { lat: P.lat, lng: P.lng, learnedAt: D(13, 8, 0), source: 'learned', points: 4, days: 2 } } });
    await flush();
    w.sb.App.tracker.status = 'running';
    const away = off(P.lat, P.lng, 5000, 0);
    w.feed(fxAt(away, D(14, 17, 55, 0)));
    w.setNow(D(14, 18, 0, 30)); w.feed(fxP(D(14, 18, 0, 0)));
    w.setNow(D(14, 18, 1, 40)); w.feed(fxP(D(14, 18, 1, 10)));
    await flush();
    ok(w.scheduled.length === 1 && w.scheduled[0].notifications[0].id === 7402, 'B2: evening return, session running → ONE close notification (id 7402)');
    ok(w.parkCard.children.length >= 2 && w.parkCard.children[0].textContent.indexOf('Close your day?') >= 0, 'B2: card asks "Close your day?"');
  }
  /* B3: crumb replays (hours old) never nudge */
  {
    const w = mkWorld({ now: D(14, 12, 0, 0), seed: { park_place: { lat: P.lat, lng: P.lng, learnedAt: D(13, 8, 0), source: 'manual', points: 0, days: 0 } } });
    await flush();
    w.PP.ingestCrumbs([
      { t: D(14, 7, 30, 0), lat: P.lat, lng: P.lng, acc: 8 },
      { t: D(14, 7, 31, 10), lat: P.lat, lng: P.lng, acc: 8 }
    ]);
    await flush();
    ok(w.scheduled.length === 0 && w.parkCard._cls.has('hidden'), 'B3: replayed morning crumbs — silent, no card, no notification');
  }
  /* B4: session edges teach the place across two days */
  {
    const w = mkWorld({ now: D(14, 6, 55, 0) });
    await flush();
    w.poll(); // baseline: idle
    w.sb.App.tracker.status = 'running'; w.poll();           // start edge armed
    w.setNow(D(14, 7, 0, 0)); w.feed(fxP(D(14, 7, 0, 0)));    // start point, day 1
    w.sb.App.tracker.status = 'idle'; w.setNow(D(14, 7, 5, 0)); w.poll(); // end edge (same fix)
    ok(w.store.get('park_place', null) === null, 'B4: day 1 edges alone — no place yet');
    w.sb.App.tracker.status = 'running'; w.poll();
    w.setNow(D(15, 7, 0, 0)); w.feed(fxP(D(15, 7, 0, 0)));   // start point, day 2 = 3rd point
    const pl = w.store.get('park_place', null);
    ok(!!pl && pl.source === 'learned' && pl.days === 2, 'B4: day-2 start point teaches the place (learned, 2 days)');
    w.PP.forgetPlace();
    ok(w.store.get('park_place', null) === null && w.PP.info().place === null, 'B4: forget clears the place');
  }
  /* B5: no plugin (browser / iPhone web) — card only, nothing throws */
  {
    const w = mkWorld({ now: D(14, 6, 0, 0), noPlugin: true, seed: { park_place: { lat: P.lat, lng: P.lng, learnedAt: D(13, 8, 0), source: 'manual', points: 0, days: 0 } } });
    await flush();
    ok(w.PP.info().notificationsAvailable === false, 'B5: no LocalNotifications here — reported honestly');
    w.setNow(D(14, 7, 30, 0)); w.feed(fxP(D(14, 7, 30, 0)));
    w.setNow(D(14, 7, 31, 10)); w.feed(fxP(D(14, 7, 31, 10)));
    await flush();
    ok(w.scheduled.length === 0 && !w.parkCard._cls.has('hidden'), 'B5: the ask still lands — as the in-app card only');
  }

  /* ================= Part C: statics ================= */
  console.log('Part C — statics');
  ok(idx.indexOf('id="parkCard"') >= 0, 'C: index.html carries the #parkCard anchor under the tracker');
  const pinM = idx.match(/parkplace\.js\?v=(\d+)/);
  ok(!!pinM, 'C: index.html loads js/parkplace.js with a version pin');
  const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
  ok(!!pinM && +pinM[1] === vj.webVersion, 'C: parkplace pin == version.json webVersion (' + vj.webVersion + ')');
  const prefs = fs.readFileSync(path.join(ROOT, 'modules', 'preferences.js'), 'utf8');
  ok(prefs.indexOf('pf_parknote') >= 0 && prefs.indexOf('pf_parkset') >= 0 && prefs.indexOf('pf_parkforget') >= 0, 'C: Preferences → Advanced carries the park-place block');
  ok(prefs.indexOf('never starts or stops anything by itself') >= 0, 'C: prefs copy states the ask-only law');
  const shift = fs.readFileSync(path.join(ROOT, 'js', 'shifttrack.js'), 'utf8');
  ok(shift.indexOf('ParkPlace.ingestCrumbs') >= 0, 'C: the native drain feeds ParkPlace beside GeoLoads');
  const cs = fs.readFileSync(path.join(ROOT, 'js', 'cloudsync.js'), 'utf8');
  ok(/key\.indexOf\('__'\) !== 0/.test(cs) && src.indexOf("'park_place'") >= 0 && src.indexOf("'park_state'") >= 0, 'C: park_place / park_state are ordinary syncable keys');
  ok(fs.existsSync(path.join(ROOT, '..', 'goals', 'dump-truck-haul-ticket-app', 'hidden_files', 'park-nudges-native-spec.md')), 'C: the native-stage spec doc exists (dead-app fence watch)');
  ok(src.indexOf('LocalNotifications') >= 0 && src.indexOf('isPluginAvailable') < 0, 'C: plugin reached via the feature-detected bridge pattern');

  console.log('\npark-place-test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('  FAIL - harness error: ' + (e && e.stack || e)); process.exit(1); });
