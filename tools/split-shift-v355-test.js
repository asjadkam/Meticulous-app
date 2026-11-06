/* split-shift-v355-test.js — proof for web 355
 * (SPLIT-SHIFT-BUS-DRIVER-MARKET + addenda 1–7, owner Nov 6, 2026):
 * the two-block bus day — self-pause at the learned midday place
 * INSIDE the learned window only, block 2 on the afternoon
 * departure, the day closing back at the yard, paid time = the
 * blocks summed; brief route stops recorded BY NAME (never
 * pauses, never sites), the route sheet read into the route
 * (addendum 5), per-day skips stepped over (addendum 6), the
 * next morning's pre-trip odometer closing yesterday, one
 * pre-trip only in split mode, the five driver kinds, and
 * standard mode untouched.
 * Run:  node tools/split-shift-v355-test.js
 */
'use strict';
const fs = require('fs'), vm = require('vm');
const ROOT = __dirname + '/..';
let pass = 0, fail = 0; const fails = [];
function ok(c, m) { if (c) { pass++; } else { fail++; fails.push(m); console.log('  FAIL - ' + m); } }
function eq(a, b, m) { ok(a === b, m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function region(file, begin, end) {
  const src = fs.readFileSync(ROOT + '/' + file, 'utf8');
  const i = src.indexOf(begin), j = src.indexOf(end);
  if (i < 0 || j < 0 || j < i) throw new Error('region not found in ' + file);
  return src.slice(i, j + end.length);
}

/* ---------- pure regions ---------- */
const engBox = {};
vm.runInNewContext(
  region('js/splitshift.js', '/* SPLIT-ENGINE-BEGIN', '/* SPLIT-ENGINE-END */') +
  '\nthis.__E = ENGINE;', engBox);
const E = engBox.__E;
ok(!!E, 'split engine region extracted');

const kindBox = {};
vm.runInNewContext(
  region('js/app.js', '/* ONB-KIND-BEGIN', '/* ONB-KIND-END */') +
  '\nthis.__K = { of: driverKindOf, pattern: driverKindPattern, labels: DRIVER_KIND_LABELS };', kindBox);
const K = kindBox.__K;
ok(!!K, 'onboarding kind region extracted');

const ptiBox = {};
vm.runInNewContext(
  region('modules/pti.js', '/* PTI-SPLIT-BEGIN', '/* PTI-SPLIT-END */') +
  '\nthis.__f = ptiKindsFor;', ptiBox);
ok(typeof ptiBox.__f === 'function', 'pti split region extracted');

/* ---------- timeline helpers (fixed day: Mon Nov 2, 2026) ---------- */
const BASE = new Date(2026, 10, 2, 0, 0, 0).getTime();
const T = (min) => BASE + Math.round(min * 60000);
const YARD = { lat: 51.000, lng: -114.000 }, MID = { lat: 51.050, lng: -114.050 };
const PA = { lat: 51.006, lng: -114.006 }, PB = { lat: 51.012, lng: -114.002 },
      PC = { lat: 51.018, lng: -114.010 }, PG = { lat: 51.040, lng: -114.040 },
      PE = { lat: 51.030, lng: -114.030 }, PF = { lat: 51.020, lng: -114.045 };
function drive(mach, ctx, min0, min1, a, b, evs) {
  const steps = Math.max(1, Math.round((min1 - min0) * 4)); // a fix every 15 s
  for (let i = 0; i <= steps; i++) {
    const f = {
      lat: a.lat + (b.lat - a.lat) * i / steps,
      lng: a.lng + (b.lng - a.lng) * i / steps,
      t: T(min0 + (min1 - min0) * i / steps), acc: 10
    };
    const ev = mach.feed(f, ctx); if (ev) evs.push(ev);
  }
}
function still(mach, ctx, min0, min1, p, evs) {
  for (let min = min0; min <= min1; min += 1) {
    const ev = mach.feed({ lat: p.lat, lng: p.lng, t: T(min), acc: 10 }, ctx);
    if (ev) evs.push(ev);
  }
}

/* ---------- the window ---------- */
const WIN = E.windowFromObs([{ arriveMin: 570, departMin: 810 }]);
eq(WIN.startMin, 525, 'window opens 45 min before the earliest arrival');
eq(WIN.endMin, 855, 'window closes 45 min after the latest departure');
eq(E.windowFromObs([]), null, 'no observations, no window');
const SEED = E.seedWindowFromRuns(570, 810);
eq(SEED.startMin, 540, 'dispatch seed: 30 min before run 1 ends');
eq(SEED.endMin, 840, 'dispatch seed: 30 min after run 2 starts');
eq(E.seedWindowFromRuns(810, 570), null, 'a backwards seed is refused');
ok(E.inWindow(WIN, 570) && !E.inWindow(WIN, 450) && !E.inWindow(WIN, 900), 'inWindow honours the edges');

/* ---------- the main split day ----------
 * Geography is a believable school morning: short hops between
 * stops, then a long rural loop (W1–W3) out and back to the
 * midday place, arriving 09:25 — inside the window. Legs run
 * at road speeds (a fix every 15 s), so a moving bus crosses
 * the 100 m still-anchor in well under the 45 s stop minimum,
 * exactly as on the road. Arrival-stamped events (pause /
 * close) land at the 150 m fence entry, a few seconds before
 * the endpoint — asserted as ranges. */
const W1 = { lat: 51.000, lng: -113.940 }, W2 = { lat: 50.960, lng: -114.000 },
      W3 = { lat: 51.000, lng: -114.090 };
const CTX = { yard: YARD, midday: MID, window: WIN };
const m = E.createDayMachine(); m.begin(T(390));
const evs = [];
drive(m, CTX, 390, 392, YARD, PA, evs);          // out to stop A
still(m, CTX, 392, 395, PA, evs);                // route stop A (~3 min)
drive(m, CTX, 395, 397, PA, PB, evs);
still(m, CTX, 397, 445, PB, evs);                // a long still (48 min) — never a route stop
drive(m, CTX, 445, 447, PB, PC, evs);
drive(m, CTX, 447, 471, PC, W1, evs);             // the rural loop…
drive(m, CTX, 471, 499, W1, W2, evs);
drive(m, CTX, 499, 535, W2, W3, evs);
drive(m, CTX, 535, 564, W3, MID, evs);            // …home to the midday place
still(m, CTX, 564, 800, MID, evs);               // arrive ~09:24 (inside window) — pause; the gap
drive(m, CTX, 800, 803, MID, PG, evs);           // afternoon departure — block 2
drive(m, CTX, 803, 806, PG, PE, evs);
still(m, CTX, 806, 809, PE, evs);                // route stop E
drive(m, CTX, 809, 813, PE, PF, evs);
still(m, CTX, 813, 815, PF, evs);                // route stop F
drive(m, CTX, 815, 825, PF, YARD, evs);          // home to the yard
still(m, CTX, 825, 830, YARD, evs);              // the day closes

const types = evs.map(e => e.type);
const stops = evs.filter(e => e.type === 'route-stop');
eq(stops.length, 3, 'exactly the three brief route stops were recorded (the 48 min still refused)');
ok(Math.abs(stops[0].lat - PA.lat) < 0.0025 && Math.abs(stops[0].lng - PA.lng) < 0.0025, 'stop A recorded at A');
const pauseEv = evs.filter(e => e.type === 'pause')[0];
ok(!!pauseEv, 'block 1 auto-closed at the midday place');
ok(pauseEv && pauseEv.at >= T(562) && pauseEv.at <= T(565),
   'the pause is stamped at the ARRIVAL (fence entry), not the dwell end (got ' + (pauseEv && Math.round((pauseEv.at - BASE) / 60000)) + ' min)');
const resumeEv = evs.filter(e => e.type === 'resume')[0];
ok(!!resumeEv, 'block 2 auto-started on the afternoon departure');
ok(resumeEv && resumeEv.at >= T(800) && resumeEv.at <= T(803.5), 'the resume is stamped at the departure');
const closeEv = evs.filter(e => e.type === 'close')[0];
ok(!!closeEv, 'the day closed back at the yard');
ok(closeEv && closeEv.at >= T(824) && closeEv.at <= T(825.5), 'the close is stamped at the yard arrival');
eq(m.phase(), 'done', 'the machine ends done');
const blocks = m.blocks();
eq(blocks.length, 2, 'two blocks on the record');
eq(blocks[0].start, T(390), 'block 1 start');
eq(blocks[0].end, pauseEv && pauseEv.at, 'block 1 end = the pause stamp');
eq(blocks[1].start, resumeEv && resumeEv.at, 'block 2 start = the resume stamp');
eq(blocks[1].end, closeEv && closeEv.at, 'block 2 end = the close stamp');
const paid = m.paidSeconds();
const paidMin = paid / 60;
ok(paidMin >= 195 && paidMin <= 200,
   'paid time = the two blocks summed (~175 + ~24), the midday gap never counted (got ' + Math.round(paidMin) + ' min)');
ok(types.indexOf('pause') > -1 && types.indexOf('resume') > types.indexOf('pause') &&
   types.indexOf('close') > types.indexOf('resume'), 'events in order: pause, resume, close');

/* ---------- still-duration refusals, hand-fed (deterministic) ---------- */
const mB = E.createDayMachine(); mB.begin(T(390));
const evsB = [];
let eB = null;
eB = mB.feed({ lat: PC.lat, lng: PC.lng, t: T(500), acc: 10 }, CTX); if (eB) evsB.push(eB);
eB = mB.feed({ lat: PC.lat, lng: PC.lng, t: T(500) + 20000, acc: 10 }, CTX); if (eB) evsB.push(eB);
eB = mB.feed({ lat: PE.lat, lng: PE.lng, t: T(500) + 25000, acc: 10 }, CTX); if (eB) evsB.push(eB);
eq(evsB.filter(e => e.type === 'route-stop').length, 0, 'a 25-second still is too brief to be a route stop');
const mL = E.createDayMachine(); mL.begin(T(390));
const evsL = [];
eB = mL.feed({ lat: PC.lat, lng: PC.lng, t: T(500), acc: 10 }, CTX); if (eB) evsL.push(eB);
eB = mL.feed({ lat: PC.lat, lng: PC.lng, t: T(513), acc: 10 }, CTX); if (eB) evsL.push(eB);
eB = mL.feed({ lat: PE.lat, lng: PE.lng, t: T(513.5), acc: 10 }, CTX); if (eB) evsL.push(eB);
eq(evsL.filter(e => e.type === 'route-stop').length, 0, 'a 13.5-minute still is too long to be a route stop');

/* ---------- NO pause outside the window ---------- */
const m2 = E.createDayMachine(); m2.begin(T(390));
const evs2 = [];
drive(m2, CTX, 390, 410, YARD, MID, evs2);
still(m2, CTX, 410, 420, MID, evs2);             // 07:00 at the midday place — outside the window
eq(evs2.filter(e => e.type === 'pause').length, 0, 'a midday dwell OUTSIDE the window never pauses');
eq(m2.phase(), 'block1', 'the clock kept running through the out-of-window stop');
drive(m2, CTX, 420, 425, MID, PG, evs2);
eq(evs2.length, 0, 'no events at all from the out-of-window visit (no route stop at a place fence)');

/* ---------- the place learner ---------- */
const L = E.createLearner();
const d1 = new Date(2026, 10, 2, 8, 0).getTime(), d2 = new Date(2026, 10, 3, 8, 0).getTime();
L.observe({ lat: 51.0, lng: -114.0, t: d1, acc: 10 });
L.observe({ lat: 51.0005, lng: -114.0005, t: d1 + 300000, acc: 10 });
eq(L.place(), null, 'two points on one day do not make a place');
const gotPlace = L.observe({ lat: 51.0, lng: -114.0, t: d2, acc: 10 });
ok(!!gotPlace && Math.abs(gotPlace.lat - 51.0) < 0.001, 'three points over two days learn the place');

/* ---------- the stop book (learn-once naming) ---------- */
const SB = E.createStopBook();
const c1 = SB.add(51.006, -114.006, '2026-11-02');
eq(SB.match(51.0062, -114.0062).id, c1.id, 'a repeat stop matches the same learned stop');
const c2 = SB.add(51.03, -114.03, '2026-11-02');
ok(c2.id !== c1.id, 'a new place is a new stop');
eq(SB.autoName(c2.id, 'Oak Crescent'), true, 'an unnamed stop takes its auto-name');
eq(SB.autoName(c2.id, 'Other Name'), false, 'a named stop is not renamed by the machine');
eq(SB.rename(c1.id, 'Elm St & 4 Ave'), true, 'the driver renames once');
eq(SB.autoName(c1.id, 'Machine Name'), false, 'a driver-renamed stop never takes an auto-name again');
const SB2 = E.createStopBook(SB.snapshot());
eq(SB2.byId(c1.id).name, 'Elm St & 4 Ave', 'the learned name survives a save/load round-trip');
eq(SB2.byId(c1.id).renamed, true, 'the renamed flag survives too');

/* ---------- the route sheet (addendum 5) ---------- */
const SHEET = [
  '4 Seasons Transportation',
  'Route Detail Sheet — Route 12',
  'AM RUN',
  '7:02 AM  Elm Street & 4 Avenue',
  '7:05 AM  Oak Crescent (stop 214)',
  '7:11 AM  Pine Ridge Gate',
  '7:25 AM  St. Mary School'
].join('\n');
const parsed = E.parseRouteSheet(SHEET);
eq(parsed.length, 4, 'the sheet reads as exactly its four stops (letterhead dropped)');
eq(parsed.map(s => s.name).join('|'), 'Elm Street & 4 Avenue|Oak Crescent|Pine Ridge Gate|St. Mary School',
   'every stop named, in the sheet order');
eq(parsed.map(s => s.time).join('|'), '7:02 AM|7:05 AM|7:11 AM|7:25 AM', 'printed times kept');
eq(E.parseRouteSheet('4 Seasons Transportation\nRoute Detail Sheet').length, 0, 'a letterhead alone reads as no route');

/* ---------- driver kinds (addenda 1/3/4) ---------- */
eq(K.pattern('school-bus'), 'split', 'School bus defaults to the split pattern');
eq(K.pattern('community-bus'), null, 'Community bus leaves the pattern to the preference');
eq(K.pattern('dump'), 'standard', 'Dump truck is standard');
eq(K.pattern('longhaul'), 'standard', 'Long haul runs standard (its day shape is parked)');
eq(K.pattern('log'), 'standard', 'Log driver runs standard (its day shape is parked)');
eq(K.of({}), 'dump', 'an unanswered record is a Dump truck');
eq(K.of({ workPattern: 'split' }), 'school-bus', 'a v355 split record reads as School bus');
eq(K.of({ driverKind: 'log' }), 'log', 'a stored kind wins');
eq(K.of({ driverKind: 'bogus' }), 'dump', 'an unknown kind falls back to Dump truck');
eq(K.labels['community-bus'], 'Community bus driver', 'the kind label set is complete');

/* ---------- PTI: one pre-trip in split mode ---------- */
eq(JSON.stringify(ptiBox.__f('split')), '["pre"]', 'split mode offers the pre-trip ONLY');
eq(JSON.stringify(ptiBox.__f('standard')), '["pre","post"]', 'standard mode offers both trips');
eq(JSON.stringify(ptiBox.__f(undefined)), '["pre","post"]', 'an unknown pattern offers both trips');

/* ---------- the glue, end to end ---------- */
function dayStrOf(t) {
  const d = new Date(t);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
const NOW0 = new Date(); NOW0.setHours(0, 0, 0, 0);
const TT = (min) => NOW0.getTime() + Math.round(min * 60000);
function makeGlue(onb, sessions) {
  const data = { onboarding: onb, sessions: sessions || [] };
  const store = {
    get: (k, d) => (k in data ? data[k] : d),
    set: (k, v) => { data[k] = v; },
    del: (k) => { delete data[k]; }
  };
  const calls = [];
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.App = {
    _store: store,
    tracker: { splitDay: false, status: 'running' },
    splitAutoPause: (at) => { calls.push(['pause', at]); sandbox.App.tracker.status = 'paused'; },
    splitAutoResume: (at) => { calls.push(['resume', at]); sandbox.App.tracker.status = 'running'; },
    splitAutoClose: (at) => { calls.push(['close', at]); sandbox.App.tracker.status = 'idle'; }
  };
  let lmCb = null;
  sandbox.LiveMiles = { subscribe: (fn) => { lmCb = fn; }, getLastFix: () => null };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(ROOT + '/js/splitshift.js', 'utf8'), sandbox);
  return { SS: sandbox.SplitShift, data, calls, feed: (f) => { if (lmCb) lmCb(f); }, sandbox };
}
function gStill(g, min0, min1, p) {
  for (let min = min0; min <= min1; min += 1) g.feed({ lat: p.lat, lng: p.lng, t: TT(min), acc: 10 });
}
function gMove(g, min, p) { g.feed({ lat: p.lat, lng: p.lng, t: TT(min), acc: 10 }); }

/* gates: standard mode and non-split sessions are never claimed */
const gStd = makeGlue({ workPattern: 'standard' });
gStd.sandbox.App.tracker.splitDay = true;
eq(gStd.SS.startDay('s1'), false, 'standard mode: the split engine never claims the day');
const gGate = makeGlue({ workPattern: 'split' });
eq(gGate.SS.startDay('s1'), false, 'a session not started as a split day is never claimed');
gGate.sandbox.App.tracker.splitDay = true;
eq(gGate.SS.startDay('s' + TT(390)), true, 'a split session is claimed');
eq(gGate.SS.info().watching, true, 'the engine is watching');

/* sheet intake + named stops + skips, on a live day */
const g = makeGlue({ workPattern: 'split' });
eq(g.SS.setRouteSheet('am', SHEET), 4, 'the photographed sheet becomes the AM route');
eq(g.SS.routeSheetInfo().am, 4, 'the route is saved');
const rt0 = g.SS.routeToday();
eq(rt0.am.length, 4, 'routeToday lists the sheet stops');
eq(rt0.am[0].name, 'Elm Street & 4 Avenue', 'routeToday names them');
g.sandbox.App.tracker.splitDay = true;
eq(g.SS.startDay('s' + TT(390)), true, 'the day starts');
gStill(g, 420, 422, PA); gMove(g, 424, PB);
let ds = g.SS.dayStops();
eq(ds.length, 1, 'one stop recorded');
eq(ds[0].key, 'sheet:am:0', 'the first driven stop wears the first sheet stop');
eq(ds[0].name, 'Elm Street & 4 Avenue', '…by the sheet name');
eq(g.SS.toggleSkip('sheet:am:1'), true, 'one tap skips Oak Crescent for today');
gStill(g, 500, 501, PC); gMove(g, 503, PG);
ds = g.SS.dayStops();
const pine = ds.filter(s => s.name === 'Pine Ridge Gate')[0];
ok(!!pine && pine.key === 'sheet:am:2', 'the driven stop stepped OVER the skipped stop to the next sheet name');
const oak = ds.filter(s => s.name === 'Oak Crescent')[0];
ok(!!oak && oak.skipped === true, 'the skipped stop rides the record flagged skipped — never missed');
eq(g.SS.toggleSkip('sheet:am:1'), false, 'a second tap brings the stop back');
gStill(g, 600, 601, PE); gMove(g, 603, PF);
ds = g.SS.dayStops();
ok(ds.some(s => s.name === 'St. Mary School'), 'the walk continues down the sheet in order');
gStill(g, 700, 701, PG); gMove(g, 703, { lat: 51.048, lng: -114.038 });
ds = g.SS.dayStops();
const extra = ds.filter(s => String(s.key).indexOf('sheet:') !== 0)[0];
ok(!!extra, 'a stop the sheet does not know is recorded too');
eq(extra && extra.name, 'Unnamed stop', '…as an unnamed extra');
eq(g.SS.renameStop('sheet:am:0', 'Elm & 4th (Aisha)'), true, 'a sheet stop takes the driver rename');
eq(g.SS.routeToday().am[0].name, 'Elm & 4th (Aisha)', 'the route shows the new name');
eq(g.SS.dayStops()[0].name, 'Elm & 4th (Aisha)', 'the recorded day shows it too');
eq(g.SS.renameStop(extra.key, 'Depot Gate'), true, 'a learned stop takes the rename');
ok(g.SS.dayStops().some(s => s.name === 'Depot Gate'), 'the renamed extra reads by its new name');

/* the next morning's pre-trip odometer closes yesterday */
const Y1 = dayStrOf(Date.now() - 86400000), Y2 = dayStrOf(Date.now() - 2 * 86400000),
      TODAY = dayStrOf(Date.now()), TOMORROW = dayStrOf(Date.now() + 86400000);
const gOdo = makeGlue({ workPattern: 'split' }, [
  { id: 'a', date: Y1, split: true, startOdo: 100 },
  { id: 'b', date: Y2, split: true },
  { id: 'c', date: Y1, startOdo: 50 }
]);
eq(gOdo.SS.onPreTripFiled({ kind: 'post', date: TODAY, odometer: 999 }), false, 'a post-trip never closes a split day');
eq(gOdo.data.sessions[0].endOdo, undefined, '…and stamps nothing');
eq(gOdo.SS.onPreTripFiled({ kind: 'pre', date: TODAY, odometer: 250 }), true, 'the morning pre-trip closes yesterday');
eq(gOdo.data.sessions[0].endOdo, 250, 'yesterday ends at this morning odometer');
eq(gOdo.data.sessions[2].endOdo, undefined, 'a standard day is never touched');
eq(gOdo.SS.onPreTripFiled({ kind: 'pre', date: TOMORROW, odometer: 400 }), true, 'the next pre-trip closes the next unclosed split day');
eq(gOdo.data.sessions[1].endOdo, 400, '…the older one, in order');
eq(gOdo.SS.onPreTripFiled({ kind: 'pre', date: TOMORROW, odometer: 500 }), false, 'nothing unclosed, nothing stamped');

/* ---------- static pins ---------- */
const idx = fs.readFileSync(ROOT + '/index.html', 'utf8');
ok(idx.indexOf('js/splitshift.js?v=355') > -1, 'index.html loads js/splitshift.js?v=355');
['js/app.js?v=355', 'js/shifttrack.js?v=355', 'modules/revenue.js?v=355', 'modules/pti.js?v=355',
 'modules/manifest.js?v=355', 'modules/preferences.js?v=355'].forEach(function (pin) {
  ok(idx.indexOf(pin) > -1, 'index.html pins ' + pin);
});
const prefs = fs.readFileSync(ROOT + '/modules/preferences.js', 'utf8');
ok(prefs.indexOf('id="pf_kind"') > -1 && prefs.indexOf('id="pf_pattern"') > -1 && prefs.indexOf('id="pf_splitrate"') > -1,
   'Preferences carries the kind, pattern and split-rate fields');
ok(prefs.indexOf('pf_sheet_am') > -1 && prefs.indexOf('pf_vin') > -1, 'Preferences carries the route-sheet and VIN doors');
ok(fs.readFileSync(ROOT + '/js/app.js', 'utf8').indexOf("key: 'driverKind'") > -1, 'onboarding asks the driver-kind question');
ok(fs.readFileSync(ROOT + '/modules/manifest.js', 'utf8').indexOf('data-split-skip') > -1, 'the Manifest carries the big skip buttons');
const vj = JSON.parse(fs.readFileSync(ROOT + '/version.json', 'utf8'));
eq(vj.webVersion, 355, 'version.json is web 355');
ok(!!(vj.files && vj.files['js/splitshift.js']), 'the version files map carries js/splitshift.js');

console.log('\nSPLIT-SHIFT v355: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('FAILURES:\n - ' + fails.join('\n - ')); process.exit(1); }
