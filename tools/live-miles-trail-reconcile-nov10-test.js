'use strict';
/*
 * live-miles-trail-reconcile-nov10-test.js — LIVE-MILES-TRAIL-RECONCILE-NOV10
 * (follow-on to LIVE-MILES-CLOUD-PERSIST-NOV10 / web 399; owner,
 * Tue Nov 10, 2026, 09:47 CST: "the kilometers are still not the
 * right one — you're saying it's over 30 kilometers in the cloud,
 * it's not on the live kilometers in the app").
 *
 * THE GAP (from the shipped code + the morning's evidence):
 *  - Web 399's cloud floor restores live miles from the tracker
 *    record's liveMilesM stamp. For a wipe that happened BEFORE
 *    any stamp existed, the floor has nothing to give: on Nov 10
 *    the cache was cleared at 09:20, the counter restarted at
 *    0.2 km, and by 09:45 it still read only ~4.9 km.
 *  - The day's true distance was never lost: it sits in the
 *    cloud as the day's GPS CRUMB TRAIL — the cloud Manifest
 *    read "GPS distance 27.2 km" from today's trail (the
 *    Manifest join in modules/manifest.js: every livemiles
 *    record's crumbs, filed under each crumb's OWN day, deduped
 *    t|a|o, chain-summed) while the phone's live counter read
 *    ~5 km. The counter never reconciles UP to the day's trail.
 *  - The miles doors that exist miss that trail exactly the way
 *    v245 (MANIFEST-GPS-EMPTY-OCT22) described for the Manifest:
 *    adoptableFragments files records by their RECORD's date
 *    stamp + hasFix flag, so a restored record whose stamp is
 *    wrong or missing hides crumbs every one of which is
 *    timestamped on the day; and reseedFromStore — the
 *    after-pull seam — never folds crumbs at all, it only
 *    compares totals. A record can therefore hold (or sit
 *    beside) the whole day's trail while the engine stands at
 *    a fraction of it.
 *
 * THE FIX (this suite's contract — js/miles.js only):
 *  At the two seams web 399 used — startDay (after the fragment
 *    adoption) and reseedFromStore/adoptFromStore (the after-
 *    pull door) — the live session's day trail is folded into
 *    the engine: dayTrailCrumbs() joins the day's crumbs with
 *    the Manifest's own filing rule (every livemiles record,
 *    each crumb under its own timestamp's day, deduped t|a|o,
 *    sorted), a chain-sum gate (the Manifest's ruler) asks
 *    whether the trail covers MORE than the counter holds,
 *    and only then does mergeCrumbs — the engine's own rebuild
 *    fold, with its counted-coverage dedupe, its filters and
 *    its bridge settlement — book the missing ground. Laws:
 *      - never lowers the counter (the gate + the fold only add);
 *      - only the live session's own day: a session key, a
 *        tracker that names THIS session live (running/paused,
 *        the v361 ±5 s pin family — the cloudFloorFor gate),
 *        crumbs filed under the session pin's own date;
 *      - never a closed day: an idle tracker presents no trail,
 *        exactly as it presents no floor;
 *      - provenance in the engine's own idiom: the folded
 *        metres are labelled trailFoldM on the day record
 *        (bridgedM / cloudFloorM are the standing marks), and
 *        any unobserved joins inside the fold book as bridges,
 *        as they always have.
 *
 * Cases:
 *  T1 the incident replay at startDay: pre-stamp wipe — tracker
 *     live with NO liveMilesM; the session's own record young
 *     (0.2 km); the morning's trail in a sibling record whose
 *     record-level date stamp is wrong (the v245 shape), so the
 *     fragment door cannot see it. startDay must stand the
 *     counter at the trail figure (the union chain).
 *  T2 the after-pull door: engine begun young with no trail in
 *     the store; the pull then lands the trail (in a correctly
 *     stamped sibling — reseed never consulted fragments);
 *     adoptFromStore raises the counter to the trail figure.
 *  T3 a counter already AHEAD of the trail is untouched.
 *  T4 a closed day (idle tracker) and another session's key
 *     reconcile nothing.
 *  T5 provenance: the raised record carries trailFoldM, and
 *     the label survives a later persist.
 *  T6 the fold is idempotent — a second adoption changes
 *     nothing (coverage dedupe + the chain gate).
 *  P1 the index pin for the changed file equals webVersion.
 *
 * Run: node tools/live-miles-trail-reconcile-nov10-test.js
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

/* ---------------- fake clocks / stores (the v399 harness) ---------------- */
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

/* ---------------- the day, the trail, the records ---------------- */
const S = new Date(2026, 10, 10, 8, 30, 0).getTime();    // Tue Nov 10, 2026 08:30 local — the session pin
const SKEY = 's' + S;
const RELAUNCH = new Date(2026, 10, 10, 9, 20, 0).getTime();
const HOME = { lat: 51.15709, lng: -113.93862 };
const T0 = new Date(2026, 10, 10, 7, 23, 0).getTime();  // the trail starts at home, 07:23 (the Manifest's own frame)

function crumb(t, lng) {
  return { t: t, a: Math.round(HOME.lat * 1e6) / 1e6, o: Math.round(lng * 1e6) / 1e6 };
}
/* The morning's trail: 40 crumbs, 2 minutes apart, ~0.01° east
   each — a clean drive the engine's filters pass in full. */
const trailCrumbs = [];
for (let i = 0; i < 40; i++) trailCrumbs.push(crumb(T0 + i * 120000, HOME.lng + i * 0.01));
/* The young post-wipe record's own ground: two crumbs just east
   of the trail's end, two minutes apart, ~0.2 km in all. */
const ownA = crumb(RELAUNCH, HOME.lng + 39 * 0.01 + 0.003);
const ownB = crumb(RELAUNCH + 120000, HOME.lng + 39 * 0.01 + 0.006);

function chainKmOf(hav, crumbs) {
  const cs = crumbs.slice().sort(function (x, y) { return x.t - y.t; });
  let m = 0;
  for (let i = 1; i < cs.length; i++) m += hav(cs[i - 1].a, cs[i - 1].o, cs[i].a, cs[i].o);
  return m / 1000;
}
function unionCrumbs() {
  const seen = {}, out = [];
  trailCrumbs.concat([ownA, ownB]).forEach(function (c) {
    const k = c.t + '|' + c.a + '|' + c.o;
    if (seen[k]) return;
    seen[k] = 1; out.push(c);
  });
  return out;
}
function ownRecord(hav) {
  return { key: SKEY, date: '2026-11-10',
    totalM: Math.round(hav(ownA.a, ownA.o, ownB.a, ownB.o)),
    anchor: { time: ownB.t, latitude: ownB.a, longitude: ownB.o }, still: null,
    crumbs: [ownA, ownB], hasFix: true,
    segs: [{ f: ownA.t, t: ownB.t }], joinFrom: null,
    bridgedM: 0, bridges: [], updatedAt: ownB.t };
}
function siblingRecord(dateStamp) {
  const last = trailCrumbs[trailCrumbs.length - 1];
  return { key: 'd2026-11-10', date: dateStamp, totalM: 27200,
    anchor: { time: last.t, latitude: last.a, longitude: last.o }, still: null,
    crumbs: trailCrumbs.slice(), hasFix: true, segs: [], joinFrom: null,
    bridgedM: 0, bridges: [], updatedAt: last.t };
}
function liveTrackerNoStamp() {
  // the pre-stamp shape: the session restored, but web 399's
  // stamp was never written (the wipe predates it) — the floor
  // has nothing to give; only the trail can heal the counter.
  return { status: 'running', sessionId: S, startTs: S, elapsed: 3000 };
}
function seedStore(w, siblingDate) {
  const hav = w.sb.LiveMiles._engine.haversineM;
  const days = {};
  days[SKEY] = ownRecord(hav);
  if (siblingDate) days['d2026-11-10'] = siblingRecord(siblingDate);
  w.store.set('livemiles', { days: days });
  const trk = liveTrackerNoStamp();
  w.App.tracker = trk;
  w.store.set('tracker', trk);
  return hav;
}

(async function () {
  console.log('LIVE-MILES-TRAIL-RECONCILE-NOV10');

  /* T1 — the incident at startDay */
  {
    const w = makeMilesWorld(RELAUNCH);
    const LM = w.sb.LiveMiles;
    const hav = seedStore(w, '2026-11-09'); // the sibling's record stamp names YESTERDAY (v245): the fragment door is blind to it
    const trailKm = chainKmOf(hav, unionCrumbs());
    LM.startDay(SKEY, { resume: true });
    const km = LM.currentKm();
    ok('T1 setup: the day trail is worth a full morning', trailKm > 25, trailKm);
    ok('T1 the wiped counter reconciles UP to the day trail at startDay', near(km, trailKm, 0.06),
      km + ' vs trail ' + trailKm);
    ok('T1 the healed total is on the day record too', near(LM.recordKmFor(SKEY), trailKm, 0.06), LM.recordKmFor(SKEY));
  }

  /* T2 — the after-pull door */
  {
    const w = makeMilesWorld(RELAUNCH);
    const LM = w.sb.LiveMiles;
    const hav = seedStore(w, null); // no trail anywhere yet
    LM.startDay(SKEY, { resume: true });
    const young = LM.currentKm();
    ok('T2 setup: the young engine stands at its post-wipe fraction', typeof young === 'number' && young < 0.4, young);
    const d = w.store.get('livemiles', { days: {} });
    d.days['d2026-11-10'] = siblingRecord('2026-11-10'); // the pull lands the trail — correctly stamped, beside the session record
    w.store.set('livemiles', d);
    LM.adoptFromStore();
    const trailKm = chainKmOf(hav, unionCrumbs());
    ok('T2 the after-pull adoption reconciles the counter to the landed trail', near(LM.currentKm(), trailKm, 0.06),
      LM.currentKm() + ' vs trail ' + trailKm);
    LM.adoptFromStore();
    ok('T6 a second adoption changes nothing (exactly-once)', near(LM.currentKm(), trailKm, 0.06), LM.currentKm());
  }

  /* T3 — ahead of the trail: untouched */
  {
    const w = makeMilesWorld(RELAUNCH);
    const LM = w.sb.LiveMiles;
    const hav = seedStore(w, '2026-11-10');
    const trailKm = chainKmOf(hav, unionCrumbs());
    const d = w.store.get('livemiles', { days: {} });
    const aheadM = Math.round(trailKm * 1000) + 5000;
    d.days[SKEY].totalM = aheadM;
    d.days[SKEY].crumbs = trailCrumbs.slice(); // its own record even holds the trail
    /* ...and, as every real snapshot does, the coverage spans
       that say the trail is already counted into its total —
       segs are the dedupe truth (v126); a total that claims
       ground its spans deny is not a shape the store produces. */
    const spans = [];
    for (let i = 1; i < trailCrumbs.length; i++) spans.push({ f: trailCrumbs[i - 1].t, t: trailCrumbs[i].t });
    spans.push({ f: ownA.t, t: ownB.t });
    d.days[SKEY].segs = spans;
    w.store.set('livemiles', d);
    LM.startDay(SKEY, { resume: true });
    ok('T3 a counter ahead of the trail is never reduced', near(LM.currentKm(), aheadM / 1000, 0.03),
      LM.currentKm() + ' vs ' + aheadM / 1000);
  }

  /* T4 — closed day / another session: nothing reconciles */
  {
    const w = makeMilesWorld(RELAUNCH);
    const LM = w.sb.LiveMiles;
    seedStore(w, '2026-11-09');
    const idle = { status: 'idle', sessionId: 0, startTs: 0, elapsed: 0 };
    w.App.tracker = idle; w.store.set('tracker', idle);
    LM.startDay(SKEY, { resume: true });
    const youngKm = LM.currentKm();
    ok('T4a an idle (closed) tracker presents no trail to reconcile', typeof youngKm === 'number' && youngKm < 0.4, youngKm);
  }
  {
    const w = makeMilesWorld(RELAUNCH);
    const LM = w.sb.LiveMiles;
    seedStore(w, '2026-11-09');
    LM.startDay('s' + (S + 86400000), {}); // tomorrow's session, today's trail in the store
    ok('T4b the trail never leaks into a different session', LM.currentKm() === null, LM.currentKm());
  }

  /* T5 — provenance */
  {
    const w = makeMilesWorld(RELAUNCH);
    const LM = w.sb.LiveMiles;
    seedStore(w, '2026-11-09');
    LM.startDay(SKEY, { resume: true });
    LM.flush();
    const rec = w.record(SKEY);
    ok('T5 the healed record carries the trailFoldM provenance label',
      !!rec && typeof rec.trailFoldM === 'number' && rec.trailFoldM > 20000, rec && rec.trailFoldM);
    const labelled = rec && rec.trailFoldM;
    w.advance(180000); // past the restored anchor (09:22), so the fix is a live join, not stale
    w.geo.deliver({ latitude: ownB.a, longitude: ownB.o + 0.004, accuracy: 5, time: w.now() });
    const rec2 = w.record(SKEY);
    ok('T5 the label survives a later persist', !!rec2 && typeof rec2.trailFoldM === 'number' && rec2.trailFoldM === labelled && labelled > 20000,
      rec2 && rec2.trailFoldM);
  }

  console.log('Pins');
  {
    const milesPin = (idxSrc.match(/js\/miles\.js\?v=(\d+)/) || [])[1];
    ok('P1 index pin for js/miles.js equals webVersion', Number(milesPin) === ver.webVersion,
      'miles ' + milesPin + ', web ' + ver.webVersion);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e && e.stack || e); process.exit(2); });
