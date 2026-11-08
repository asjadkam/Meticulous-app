#!/usr/bin/env node
/* Meticulous v382 — ROUTE-SHEET-DRIVES-NAVIGATION-NOV8.
 *
 * Four owner rulings, Nov 8, 2026:
 *  (1) 16:57 CST — "And this dispatch should make the morning
 *      navigation exactly as per plan": once the route sheet is
 *      in Dispatch (v381), the day's NAVIGATION follows the
 *      sheet exactly — the Navigator drives her stop-to-stop in
 *      the sheet's own order, by the sheet's own names.
 *  (2) 16:58 CST — "After it knows her route it has to actually
 *      know it!": the route is not a per-day upload. Once
 *      learned it is the app's standing knowledge of her work —
 *      persistent across days, the day's reference (arrivals
 *      matched to the known stops, the plan IS the known route,
 *      a stop never reached reads as not reached, never
 *      relabelled, leaving the corridor is noticed against the
 *      known route), and it SHARPENS by use behind the glass:
 *      her real stopping places refine each stop's placed point.
 *  (3) 16:59 CST — bus drivers don't set markers of any kind,
 *      and the bus system is not counting loads — it is counting
 *      KIDS. The real sample sheet (tools/fixtures/
 *      route-CBE-0574.pdf) NAMES the students at every stop, so
 *      the roster IS the expected count per stop; the day's
 *      reality is the roster minus the absents — one tap per
 *      absent kid, that day only, recorded absent, never
 *      "missed". No per-stop data entry as the price of a count.
 *  (4) 17:01 CST — the fixed-route law from the dispatch side:
 *      bus drivers don't upload a dispatch daily; the known
 *      route IS the standing dispatch — each day opens in
 *      Dispatch with her route already in place, no empty
 *      "no dispatch today" state once a route is known.
 *
 * THE BUILD:
 *  - js/splitshift.js — placement (the app's geocode door, once
 *    per stop, cached on the route record; a new sheet or a
 *    rename retires the point), the plan (routePlan /
 *    navAdvance / navConsumeKey over the pure planWalk),
 *    proximity + dwell advance behind the glass, the corridor
 *    check (distToChainM), the roster (parseRouteRoster over
 *    the run's own sheet section), absent marks (toggleAbsent),
 *    kid counts on the run record (dayStops / kidCounts /
 *    routeToday state + deltaMin), and the seed-and-nudge
 *    sharpening in recordRouteStop.
 *  - modules/navigator.js — the plan card on the map face
 *    (present only when a plan exists), the plan driving the
 *    destination while it owns it, a driver-set destination
 *    releasing the hold, the Next stop door, the arrival
 *    consume.
 *  - modules/dispatch.js — the file door hands each run's own
 *    section to the engine (the roster's source), and the
 *    standing-dispatch line: a bus account with a known route
 *    and no dispatch record opens on "Your route is today's
 *    dispatch", never on an empty day.
 *  - modules/manifest.js — today's route rows carry the sheet's
 *    kids per stop, one absent tap per kid, the arrival delta
 *    against the printed time; the run record carries the kid
 *    counts ("Kids carried — N on · M off · K absent").
 *
 * LAYERS: (P) the pure engine over the REAL sample (bench
 * PDF.js + the real RouteSheetFile text path): the roster reads
 * the sheet's own students per stop; planWalk / distToChainM /
 * sheetTimeMin units. (G) the real glue in vm worlds with a
 * stubbed geocoder (no live calls): placement + pass-over,
 * persistence across a fresh day with zero uploads, a driven
 * day (dwell arrivals, delta, adopt + nudge, proximity advance,
 * corridor, skip, absent, kid counts), the PM flip. (D) the
 * real Dispatch render: the standing dispatch stands for a bus
 * account with a known route; standard accounts and route-less
 * bus accounts see no such card. (N) Navigator + Manifest
 * source pins, and the scope fence: no marker machinery in the
 * bus files, the dump-truck counting file untouched.
 * Run: node tools/route-sheet-drives-navigation-nov8-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const splitSrc = read('js/splitshift.js');
const dspSrc = read('modules/dispatch.js');
const navSrc = read('modules/navigator.js');
const maniSrc = read('modules/manifest.js');
const geoSrc = read('js/geoloads.js');
const appSrc = read('js/app.js');
const ocrSrc = read('js/ticket-ocr.js');
const invSrc = read('modules/invoice.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function flush(n) {
  return new Promise(function (res) {
    let i = 0;
    (function step() { if (++i > (n || 60)) return res(); setTimeout(step, 0); })();
  });
}
function region(src, begin, end) {
  const i = src.indexOf(begin), j = src.indexOf(end);
  if (i < 0 || j < 0 || j < i) throw new Error('region not found: ' + begin);
  return src.slice(i, j + end.length);
}

const AM_NAMES = [
  '321 21 Ave SW, Calgary, AB T2S 0G7, Canada',
  '1005 Cameron Ave SW, Calgary, AB T2T 0K2, Canada',
  'WB 17 Av SW @ 27 St SW, Calgary, AB T3E 6K8, Canada',
  '3380 Spruce Dr SW, Calgary, AB T3C 3A2, Canada',
  '19 Hemlock Crescent SW, Calgary, AB T3C 2Z2, Canada',
  'Wildwood School • 120 45 St SW, Calgary, AB T3C 2B3, Canada',
  '2702 43 St SW, Calgary, AB T3E 3N5, Canada',
  'Glendale School • 2415 Kelwood Dr SW, Calgary, AB T3E 3Z8, Canada'
];
const PM_NAMES = [
  'Wildwood School • 120 45 St SW, Calgary, AB T3C 2B3, Canada',
  '3380 Spruce Dr SW, Calgary, AB T3C 3A2, Canada',
  '19 Hemlock Crescent SW, Calgary, AB T3C 2Z2, Canada',
  '1005 Cameron Ave SW, Calgary, AB T2T 0K2, Canada',
  '321 21 Ave SW, Calgary, AB T2S 0G7, Canada',
  'WB 17 Av SW @ 26 St SW, Calgary, AB T3C 1K7, Canada',
  'Glendale School • 2415 Kelwood Dr SW, Calgary, AB T3E 3Z8, Canada',
  '2702 43 St SW, Calgary, AB T3E 3N5, Canada'
];

/* ================= shared fake DOM (v186/v378 pattern) ================= */
function FakeEl(sel) {
  this._sel = sel || '';
  this._kids = {};
  this._html = '';
  this.value = '';
  this.textContent = '';
  this.style = {};
  this.files = [];
  this.onclick = null;
  this.onchange = null;
  this._listeners = {};
  this.options = [{ text: '' }];
  this.selectedIndex = 0;
}
Object.defineProperty(FakeEl.prototype, 'innerHTML', {
  get: function () { return this._html; },
  set: function (v) { this._html = String(v); this._kids = {}; }
});
FakeEl.prototype.querySelector = function (sel) {
  return this._kids[sel] || (this._kids[sel] = new FakeEl(sel));
};
FakeEl.prototype.querySelectorAll = function () { return []; };
FakeEl.prototype.addEventListener = function (type, fn) {
  (this._listeners[type] = this._listeners[type] || []).push(fn);
};
FakeEl.prototype.scrollIntoView = function () {};
FakeEl.prototype.setAttribute = function () {};
FakeEl.prototype.getAttribute = function () { return null; };
FakeEl.prototype.click = function () {};
function FakeFileReader() {}
FakeFileReader.prototype.readAsDataURL = function () {
  const self = this;
  self.result = 'data:image/jpeg;base64,RAWDATA';
  queueMicrotask(function () { if (self.onload) self.onload(); });
};
function FakeImage() {}
Object.defineProperty(FakeImage.prototype, 'src', {
  get: function () { return ''; },
  set: function () {
    const self = this;
    self.width = 800; self.height = 600;
    queueMicrotask(function () { if (self.onload) self.onload(); });
  }
});
const docStub = {
  createElement: function (tag) {
    if (tag === 'canvas') {
      return { width: 0, height: 0,
        getContext: function () { return { drawImage: function () {} }; },
        toDataURL: function () { return 'data:image/jpeg;base64,THUMB'; } };
    }
    return new FakeEl(tag);
  },
  querySelector: function () { return null; },
  addEventListener: function () {}
};
function makeLocal() {
  const backing = { mem: {}, fail: false };
  return {
    backing: backing,
    getItem: function (k) { return (k in backing.mem) ? backing.mem[k] : null; },
    setItem: function (k, v) { backing.mem[k] = String(v); },
    removeItem: function (k) { delete backing.mem[k]; }
  };
}
function extractStore() {
  const i = appSrc.indexOf('var store = {');
  if (i === -1) throw new Error('store not found in js/app.js');
  let depth = 0, j = i;
  for (; j < appSrc.length; j++) {
    if (appSrc[j] === '{') depth++;
    else if (appSrc[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return appSrc.slice(i, j) + ';';
}
function extractRegion(src, beginMark, endMark) {
  const bi = src.indexOf(beginMark), ei = src.indexOf(endMark);
  if (bi === -1 || ei === -1) throw new Error('region markers missing: ' + beginMark);
  return src.slice(src.lastIndexOf('/*', bi), src.indexOf('*/', ei) + 2);
}
function makePipeStub() {
  return {
    connectedPeers: function () { return []; },
    dateShift: function (d) { return d; },
    pullInbox: function () { return Promise.resolve(0); },
    markSeen: function () {},
    fetchCrew: function () { return Promise.resolve([]); },
    fetchRecords: function () { return Promise.resolve({ records: {}, billing: {} }); },
    listSent: function () { return Promise.resolve([]); },
    sendDispatchToMany: function () { return Promise.resolve({ sent: [], failed: [] }); }
  };
}

/* ================= (N) source pins + the scope fence ================= */
console.log('(N) Navigator / Manifest pins + scope fences');
(function () {
  check('the plan card stands in the Navigator markup only behind the plan gate (rp0)',
    navSrc.indexOf("(rp0 ? '<div id=\"nv_routeplan\"") > -1 &&
    navSrc.indexOf("rp0 = (window.SplitShift && SplitShift.routePlan) ? SplitShift.routePlan() : null") > -1);
  check('the plan card carries the Next stop door',
    navSrc.indexOf('id="nv_rp_next"') > -1 && navSrc.indexOf('Next stop ▸') > -1);
  check('paintRoutePlan reads the plan fresh and speaks Stop N of M in the sheet\'s names',
    navSrc.indexOf('function paintRoutePlan()') > -1 &&
    navSrc.indexOf("'Stop ' + (rp.current + 1) + ' of ' + rp.total") > -1 &&
    navSrc.indexOf('🚌 Next stop: ') > -1);
  check('onPos repaints the plan on every fix',
    navSrc.indexOf('if (S.drive) driveTick();\n        paintRoutePlan();') > -1);
  check('a destination that is not the plan\'s own releases the plan\'s hold',
    navSrc.indexOf('if (S.planOwns && key !== S.planDestKey)') > -1);
  check('an arrival at the plan\'s target consumes it through navConsumeKey',
    navSrc.indexOf('SplitShift.navConsumeKey(S.planStopKey)') > -1);
  check('the Next door advances through navAdvance and repaints',
    navSrc.indexOf("body.querySelector('#nv_rp_next')") > -1 &&
    navSrc.indexOf('SplitShift.navAdvance()') > -1);
  check('Manifest: the absent door rides today\'s route rows',
    maniSrc.indexOf('data-split-absent') > -1 && maniSrc.indexOf('SplitShift.toggleAbsent') > -1);
  check('Manifest: the run record carries the kid counts in words',
    maniSrc.indexOf('Kids carried') > -1 && maniSrc.indexOf("' on · '") > -1);
  check('Manifest: the arrival delta against the printed time is shown',
    maniSrc.indexOf('min late') > -1 && maniSrc.indexOf('min early') > -1);
  check('Dispatch: the file door hands each run its own section (the roster source)',
    dspSrc.indexOf("RouteSheetFile.sliceShift(text || '', rc[0])") > -1 &&
    dspSrc.indexOf('SplitShift.setRouteSheet(rc[0], runs[rc[0]], sec382)') > -1);
  check('Dispatch: the standing dispatch line stands for a bus account with a known route',
    dspSrc.indexOf('Your route is today’s dispatch') > -1 &&
    dspSrc.indexOf('id="dp_today_card"') > -1 &&
    dspSrc.indexOf('it stands until a new sheet replaces it') > -1);
  check('SCOPE FENCE: no marker machinery anywhere in the bus engine or the Navigator',
    !/peg/i.test(splitSrc) && !/peg/i.test(navSrc));
  check('SCOPE FENCE: the dump-truck counting machinery stands untouched in its own file',
    /peg/i.test(geoSrc) && splitSrc.indexOf('window.GeoLoads') === -1 &&
    splitSrc.indexOf('GeoLoads.setPeg') === -1);
  check('SCOPE FENCE: bus mode counts kids, never loads — the split engine has no load counter',
    splitSrc.indexOf('loadCount') === -1 && splitSrc.indexOf('countLoad') === -1);
})();

/* ================= async layers over the REAL sample ================= */
(async function () {
  const rsfBox = {};
  vm.runInNewContext(region(dspSrc, '/* ROUTE-SHEET-FILE-BEGIN', '/* ROUTE-SHEET-FILE-END */') +
    '\nthis.__R = RouteSheetFile;', rsfBox);
  const R = rsfBox.__R;
  const engBox = {};
  vm.runInNewContext(region(splitSrc, '/* SPLIT-ENGINE-BEGIN', '/* SPLIT-ENGINE-END */') +
    '\nthis.__E = ENGINE;', engBox);
  const E = engBox.__E;
  check('(P) the pure engine + reader extract', !!E && !!R &&
    typeof E.parseRouteRoster === 'function' && typeof E.planWalk === 'function');

  const pdfjsLib = require(path.join(ROOT, 'tools', 'bench-env', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.js'));
  const data = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tools', 'fixtures', 'route-CBE-0574.pdf')));
  const doc = await pdfjsLib.getDocument({ data: data }).promise;
  const pagesItems = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pagesItems.push(tc.items.map(function (it) {
      return { str: it.str, transform: it.transform.slice(), width: it.width, height: it.height };
    }));
  }
  const pdfText = pagesItems.map(function (items) { return R.linesFromItems(items).join('\n'); }).join('\n');
  const runs = R.runsFromText(pdfText);
  const stopsAm = E.parseRouteSheet(runs.am);
  const stopsPm = E.parseRouteSheet(runs.pm);
  eq('the sample still parses to the sheet\'s 8 + 8 stops', [stopsAm.length, stopsPm.length], [8, 8]);

  /* ---------- (P) the roster: the sheet names its students ---------- */
  console.log('(P) the roster over the real sample');
  const secAm = R.sliceShift(pdfText, 'am');
  const secPm = R.sliceShift(pdfText, 'pm');
  check('the file carries its own AM and PM sections', typeof secAm === 'string' && secAm.length > 0 &&
    typeof secPm === 'string' && secPm.length > 0);
  const rosterAm = E.parseRouteRoster(secAm, stopsAm);
  const rosterPm = E.parseRouteRoster(secPm, stopsPm);
  eq('AM roster aligns stop for stop', rosterAm.length, 8);
  eq('AM: each home stop boards exactly the one kid the sheet names there',
    rosterAm.slice(0, 5).map(function (r) { return r.up.length; }), [1, 1, 1, 1, 1]);
  eq('AM: the home stops set nobody down', rosterAm.slice(0, 5).map(function (r) { return r.down.length; }), [0, 0, 0, 0, 0]);
  eq('AM: Wildwood School sets down the five kids its DROP-OFF list names', rosterAm[5].down.length, 5);
  eq('AM: Glendale School sets down its one kid', rosterAm[7].down.length, 1);
  eq('AM: the second pickup boards its one kid', rosterAm[6].up.length, 1);
  eq('AM totals: 6 boardings, 6 set-downs expected',
    [rosterAm.reduce(function (a, r) { return a + r.up.length; }, 0),
     rosterAm.reduce(function (a, r) { return a + r.down.length; }, 0)], [6, 6]);
  check('AM: the names are the sheet\'s own students (first pickup, school list)',
    /Sabuktigin/.test(rosterAm[0].up[0] || '') &&
    rosterAm[5].down.some(function (n) { return /Fatima/.test(n); }) &&
    rosterAm[5].down.some(function (n) { return /Ethan/.test(n); }));
  eq('PM: Wildwood School boards the five kids its PICK-UP list names', rosterPm[0].up.length, 5);
  eq('PM: Glendale School boards its one kid', rosterPm[6].up.length, 1);
  eq('PM: each home stop sets down its one kid',
    [1, 2, 3, 4, 5, 7].map(function (i) { return rosterPm[i].down.length; }), [1, 1, 1, 1, 1, 1]);
  eq('PM totals: 6 boardings, 6 set-downs expected',
    [rosterPm.reduce(function (a, r) { return a + r.up.length; }, 0),
     rosterPm.reduce(function (a, r) { return a + r.down.length; }, 0)], [6, 6]);
  eq('a sheet with no student lines rosters nobody (stops only — counts rest on the day)',
    E.parseRouteRoster('7:26 AM 321 21 Ave SW\n7:33 AM 1005 Cameron Ave SW', stopsAm.slice(0, 2))
      .map(function (r) { return r.up.length + r.down.length; }), [0, 0]);

  /* ---------- (P) planWalk / corridor / sheet clock units ---------- */
  console.log('(P) planWalk + corridor + sheet clock');
  const mkStops = function (pss) {
    return pss.map(function (ps, i) {
      return { name: 'S' + i, ps: ps, lat: 51 + i * 0.01, lng: -114 - i * 0.01 };
    });
  };
  eq('walk: first stop is current and target when placed',
    E.planWalk(mkStops(['ok', 'ok']), 0, {}, 'am'), { current: 0, target: 0, passed: [], done: false });
  eq('walk: a skipped stop is stepped over; an unplaced stop is current but passed for routing',
    E.planWalk(mkStops(['ok', 'no', 'ok']), 0, { 'sheet:am:0': true }, 'am'),
    { current: 1, target: 2, passed: [1], done: false });
  eq('walk: nothing placed — the current stop stands, every remaining stop passed by name',
    E.planWalk(mkStops(['no', 'no']), 0, {}, 'am'), { current: 0, target: -1, passed: [0, 1], done: false });
  eq('walk: all remaining stops skipped — the run is done',
    E.planWalk(mkStops(['ok', 'ok']), 0, { 'sheet:am:0': true, 'sheet:am:1': true }, 'am'),
    { current: -1, target: -1, passed: [], done: true });
  eq('walk: the cursor never steps back (prog holds mid-list)',
    E.planWalk(mkStops(['ok', 'ok', 'ok']), 2, {}, 'am').current, 2);
  const chain = [{ lat: 51.0, lng: -114.0 }, { lat: 51.0, lng: -113.99 }];
  check('corridor: a point on the chain reads ~0 m',
    E.distToChainM(51.0, -113.995, chain) < 1);
  check('corridor: a point ~550 m off the chain reads ~550 m',
    Math.abs(E.distToChainM(51.005, -113.995, chain) - 556) < 30);
  eq('corridor: no chain, no judgement', E.distToChainM(51.0, -114.0, []), null);
  eq('sheet clock: 7:26 AM / 2:35 PM / 12:05 PM / none',
    [E.sheetTimeMin('7:26 AM'), E.sheetTimeMin('2:35 PM'), E.sheetTimeMin('12:05 PM'), E.sheetTimeMin('')],
    [446, 875, 725, null]);

  /* ---------- (G) the glue worlds ---------- */
  function makeGlue(data2, geoBook) {
    const store = {
      get: function (k, d) { return (k in data2 ? data2[k] : d); },
      set: function (k, v) { data2[k] = v; },
      del: function (k) { delete data2[k]; }
    };
    const sandbox = {};
    sandbox.window = sandbox;
    sandbox.App = { _store: store, tracker: { splitDay: true, status: 'running' } };
    let lmCb = null;
    sandbox.LiveMiles = { subscribe: function (cb) { lmCb = cb; }, getLastFix: function () { return null; } };
    sandbox.MeticulousGeo = {
      geocode: function (name) {
        return Promise.resolve(Object.prototype.hasOwnProperty.call(geoBook, name) ? geoBook[name] : null);
      }
    };
    vm.createContext(sandbox);
    vm.runInContext(splitSrc, sandbox);
    return { SS: sandbox.SplitShift, data: data2,
      feed: function (f) { if (lmCb) lmCb(f); } };
  }
  /* true stop ground for the driven day: a loose grid */
  const TRUE = {};
  AM_NAMES.forEach(function (n, i) { TRUE[n] = { latitude: 51.090 + i * 0.004, longitude: -114.120 + i * 0.006 }; });
  const bookAll = {};
  AM_NAMES.concat(PM_NAMES).forEach(function (n) {
    const i = (AM_NAMES.indexOf(n) >= 0 ? AM_NAMES.indexOf(n) : PM_NAMES.indexOf(n));
    bookAll[n] = { latitude: 51.090 + i * 0.004, longitude: -114.120 + i * 0.006 };
  });

  console.log('(G) world 1 — placement, pass-over, roster, persistence');
  const data1 = { onboarding: { workPattern: 'split' }, sessions: [] };
  const book1 = Object.assign({}, bookAll);
  book1[AM_NAMES[1]] = null;                      // the geocoder cannot place Cameron Ave
  const g1 = makeGlue(data1, book1);
  eq('one upload fills both routes', [g1.SS.setRouteSheet('am', runs.am, secAm), g1.SS.setRouteSheet('pm', runs.pm, secPm)], [8, 8]);
  await flush(80);
  let rp = g1.SS.routePlan();
  check('the plan stands on the morning run, in the sheet\'s order and names',
    !!rp && rp.block === 'am' && rp.total === 8 &&
    rp.stops.map(function (s) { return s.name; }).join('|') === AM_NAMES.join('|'));
  eq('the first stop is current and the routing target (it placed)',
    [rp.current, rp.target && rp.target.idx], [0, 0]);
  eq('the target carries the geocoded point', [rp.target.lat, rp.target.lng],
    [bookAll[AM_NAMES[0]].latitude, bookAll[AM_NAMES[0]].longitude]);
  let adv = g1.SS.navAdvance();
  eq('Next stop by hand: the unplaced stop becomes current, named as passed for routing',
    [adv.current, adv.target && adv.target.idx, adv.passedNames], [1, 2, [AM_NAMES[1]]]);
  eq('the unplaced stop stays IN the plan, by name, marked not placed',
    [adv.stops[1].name, adv.stops[1].placed, adv.stops[1].state], [AM_NAMES[1], false, 'current']);
  const rt1 = g1.SS.routeToday();
  eq('today\'s route: every stop ahead, none served, none skipped, no delta yet',
    [rt1.am.every(function (r) { return r.state === 'ahead'; }), rt1.am[0].deltaMin], [true, null]);
  eq('today\'s route carries the roster: stop 1 boards 1, Wildwood sets down 5, Glendale 1',
    [rt1.am[0].kids.up.exp, rt1.am[5].kids.down.exp, rt1.am[7].kids.down.exp], [1, 5, 1]);
  eq('PM rows carry the mirror roster: Wildwood boards 5, Glendale boards 1, home stops set down 1',
    [rt1.pm[0].kids.up.exp, rt1.pm[6].kids.up.exp, rt1.pm[1].kids.down.exp], [5, 1, 1]);
  eq('kidCounts: the sheet expects 6 on and 6 off per run; nothing carried yet',
    [g1.SS.kidCounts().am.expectedUp, g1.SS.kidCounts().am.expectedDown,
     g1.SS.kidCounts().pm.expectedUp, g1.SS.kidCounts().am.boarded], [6, 6, 6, 0]);
  /* absent is a day mark on the roster, never a roster edit */
  eq('one tap marks the kid absent', g1.SS.toggleAbsent('sheet:am:0:up:0'), true);
  eq('…the row now reads 1 absent and the day\'s count for the stop drops to 0',
    [g1.SS.routeToday().am[0].kids.absent, g1.SS.routeToday().am[0].kids.up.got], [1, 0]);
  eq('…and the roster itself is untouched (expected still 1)',
    g1.SS.routeToday().am[0].kids.up.exp, 1);
  eq('a malformed absent key is refused', g1.SS.toggleAbsent('sheet:am:0'), false);
  /* a new sheet retires the run's absent marks and placed points */
  g1.SS.setRouteSheet('am', runs.am, secAm);
  eq('a replacement sheet clears the old sheet\'s absent marks',
    g1.SS.routeToday().am[0].kids.absent, 0);
  await flush(80);
  rp = g1.SS.routePlan();
  eq('…and the replacement sheet\'s stops are placed afresh (Cameron still honestly unplaced)',
    [rp.stops[0].placed, rp.stops[1].placed], [true, false]);

  console.log('(G) world 2 — a fresh day: the route stands with zero uploads');
  const g2 = makeGlue(data1, book1);
  eq('the known route survived the night, whole', g2.SS.routeSheetInfo(), { am: 8, pm: 8 });
  rp = g2.SS.routePlan();
  check('the fresh day opens on the plan — no upload, no intake, the route is simply known',
    !!rp && rp.total === 8 && rp.stops[0].name === AM_NAMES[0]);
  eq('the roster survived with it', g2.SS.routeToday().am[5].kids.down.exp, 5);
  /* the absent mark is the DAY's: hand the stored mark yesterday's date and it lifts */
  data1.splitshift.dayAbsent = { date: '2000-01-01', keys: { 'sheet:am:0:up:0': true } };
  const g2b = makeGlue(data1, book1);
  eq('yesterday\'s absent mark does not follow the kid into a new day',
    g2b.SS.routeToday().am[0].kids.absent, 0);

  console.log('(G) world 3 — the driven day');
  const BASE = new Date(2026, 10, 2, 0, 0, 0).getTime();
  const T = function (min) { return BASE + Math.round(min * 60000); };
  const data3 = { onboarding: { workPattern: 'split' }, sessions: [] };
  const book3 = Object.assign({}, bookAll);
  book3[AM_NAMES[1]] = null;                                   // Cameron: geocoder miss
  book3[AM_NAMES[2]] = { latitude: TRUE[AM_NAMES[2]].latitude, // WB 17 Av: placed 200 m east of truth
    longitude: TRUE[AM_NAMES[2]].longitude + 0.0028 };
  const g3 = makeGlue(data3, book3);
  g3.SS.setRouteSheet('am', runs.am, secAm);
  g3.SS.setRouteSheet('pm', runs.pm, secPm);
  await flush(80);
  const distTo = function (a, b) { return E.haversineM(a.lat, a.lng, b.lat, b.lng); };
  const placedOf = function (idx) {
    const st = data3.splitshift.routeSheets.am[idx];
    return { lat: st.lat, lng: st.lng, ps: st.ps };
  };
  check('before the day: Cameron unplaced, WB 17 Av placed at the geocoder\'s (off) point',
    placedOf(1).ps === 'no' && placedOf(2).ps === 'ok' &&
    distTo(placedOf(2), { lat: TRUE[AM_NAMES[2]].latitude, lng: TRUE[AM_NAMES[2]].longitude }) > 150);
  eq('her first kid is marked absent before the run', g3.SS.toggleAbsent('sheet:am:0:up:0'), true);
  eq('the split day starts', g3.SS.startDay('s' + T(0), {}), true);
  const feed = function (lat, lng, t) { g3.feed({ latitude: lat, longitude: lng, accuracy: 10, time: t }); };
  const drive = function (t0, t1, a, b) {
    const steps = Math.max(1, Math.round((t1 - t0) / 0.25));
    for (let i = 0; i <= steps; i++) {
      feed(a.lat + (b.lat - a.lat) * i / steps, a.lng + (b.lng - a.lng) * i / steps, T(t0 + (t1 - t0) * i / steps));
    }
  };
  const still = function (t0, t1, p) { for (let m = t0; m <= t1; m += 1) feed(p.lat, p.lng, T(m)); };
  const P = function (n) { return { lat: TRUE[n].latitude, lng: TRUE[n].longitude }; };
  const HOME = { lat: P(AM_NAMES[0]).lat - 0.01, lng: P(AM_NAMES[0]).lng - 0.01 };
  feed(HOME.lat, HOME.lng, T(445));
  drive(445, 451, HOME, P(AM_NAMES[0]));            // arrive stop 1 at 7:31 — five minutes after the sheet's 7:26
  still(451, 454, P(AM_NAMES[0]));
  drive(454, 457, P(AM_NAMES[0]), P(AM_NAMES[1]));  // the departure fires stop 1's arrival
  still(457, 460, P(AM_NAMES[1]));
  drive(460, 463, P(AM_NAMES[1]), P(AM_NAMES[2]));
  still(463, 466, P(AM_NAMES[2]));
  /* Leaving stop 3 fires its arrival (the engine reports a stop
     when the bus moves on) — drive away briskly ~250 m toward
     stop 4 and end there: far enough to fire stop 3's arrival,
     short enough (and quick enough) that the leg itself reads
     as travel, not another stop, and stop 4's placed point
     stays out of the plan's 75 m reach until the pass below. */
  const SHORT3 = {
    lat: P(AM_NAMES[2]).lat + (P(AM_NAMES[3]).lat - P(AM_NAMES[2]).lat) * 0.38,
    lng: P(AM_NAMES[2]).lng + (P(AM_NAMES[3]).lng - P(AM_NAMES[2]).lng) * 0.38
  };
  const wbBefore = distTo(placedOf(2), P(AM_NAMES[2]));
  drive(466, 466.75, P(AM_NAMES[2]), SHORT3);
  const wbAfter = distTo(placedOf(2), P(AM_NAMES[2]));
  let rows3 = g3.SS.routeToday().am;
  eq('arrivals matched to the known stops, in order',
    g3.SS.dayStops().slice(0, 3).map(function (s) { return s.name; }), AM_NAMES.slice(0, 3));
  eq('her arrival stands against the sheet\'s clock: 5 min late at stop 1',
    [rows3[0].state, rows3[0].deltaMin], ['done', 5]);
  eq('the run record carries the kid truth at stop 1: roster 1, absent 1, carried 0',
    g3.SS.dayStops()[0].kids, { up: 0, down: 0, absent: 1 });
  check('the unplaced stop ADOPTED the ground she actually stops on',
    placedOf(1).ps === 'ok' && Math.abs(placedOf(1).lat - P(AM_NAMES[1]).lat) < 1e-9 &&
    Math.abs(placedOf(1).lng - P(AM_NAMES[1]).lng) < 1e-9);
  check('the placed point NUDGED toward where she truly stops (was ~' + Math.round(wbBefore) + ' m off)',
    wbAfter < wbBefore && wbAfter > 40 && wbAfter < 160, 'after=' + Math.round(wbAfter));
  rp = g3.SS.routePlan();
  eq('the plan walked with the day: three stops consumed, stop 4 is current and target',
    [rp.current, rp.target && rp.target.idx], [3, 3]);
  feed(P(AM_NAMES[3]).lat + 0.0003, P(AM_NAMES[3]).lng, T(470));  // a pass within 75 m — no dwell
  eq('a pass at the target advances the plan without any dwell or tap',
    g3.SS.routePlan().current, 4);
  feed(P(AM_NAMES[3]).lat + 0.015, P(AM_NAMES[3]).lng, T(471));   // ~1.6 km off the chain
  eq('leaving the corridor is noticed against the known route', g3.SS.routePlan().offRoute, true);
  feed(P(AM_NAMES[4]).lat, P(AM_NAMES[4]).lng, T(471.33));        // a pass off-route, not a stop (20 s)
  eq('back on the route, the corridor reads clear again', g3.SS.routePlan().offRoute, false);
  eq('kidCounts after the morning so far: expected 6 on, absent 1, boarded 4 (every served stop\'s kid but stop 1\'s — the positional sheet walk also counted the two pauses around the corridor excursion, as it counts any stop she makes)',
    (function () { const k = g3.SS.kidCounts().am; return [k.expectedUp, k.absent, k.boarded, k.alighted]; })(),
    [6, 1, 4, 0]);
  eq('a stop can be skipped for today', g3.SS.toggleSkip('sheet:am:6'), true);
  rows3 = g3.SS.routeToday().am;
  eq('the skipped stop reads skipped; the unreached one reads ahead — never relabelled',
    [rows3[6].state, rows3[7].state], ['skipped', 'ahead']);
  check('the day record carries the skipped stop flagged, by name',
    g3.SS.dayStops().some(function (s) { return s.key === 'sheet:am:6' && s.skipped === true && s.at === 0; }));
  eq('the plan steps over the skipped stop by name', g3.SS.routePlan().stops[6].state, 'skipped');

  console.log('(G) world 4 — the afternoon serves the PM sheet');
  const data4 = { onboarding: { workPattern: 'split' }, sessions: [] };
  const g4 = makeGlue(data4, bookAll);
  g4.SS.setRouteSheet('am', runs.am, secAm);
  g4.SS.setRouteSheet('pm', runs.pm, secPm);
  await flush(80);
  let rp4 = g4.SS.routePlan();
  eq('the morning opens on the AM sheet', [rp4.block, rp4.stops[0].name], ['am', AM_NAMES[0]]);
  for (let i = 0; i < 8; i++) g4.SS.navAdvance();
  rp4 = g4.SS.routePlan();
  eq('with the morning consumed, the plan serves the PM sheet, verbatim and in order',
    [rp4.block, rp4.current, rp4.stops.map(function (s) { return s.name; }).join('|')],
    ['pm', 0, PM_NAMES.join('|')]);
  for (let i = 0; i < 8; i++) g4.SS.navAdvance();
  eq('the whole day consumed, the plan reads done', g4.SS.routePlan().done, true);

  console.log('(G) world 5 — no route, no plan; standard account, no plan');
  const data5 = { onboarding: { workPattern: 'split' }, sessions: [] };
  const g5 = makeGlue(data5, bookAll);
  eq('a bus account with NO known route gets no plan (Navigator exactly as today)',
    g5.SS.routePlan(), null);
  const data6 = { onboarding: { workPattern: 'standard' }, sessions: [] };
  const g6 = makeGlue(data6, bookAll);
  g6.SS.setRouteSheet('am', runs.am, secAm);
  eq('a standard account gets no plan even with a sheet in the store',
    g6.SS.routePlan(), null);

  /* ---------- (D) Dispatch render: the standing dispatch ---------- */
  console.log('(D) Dispatch render — the fixed-route law on the face');
  function makeWorld(opts) {
    const local = makeLocal();
    const sb = {
      console: console, document: docStub, localStorage: local,
      FileReader: FakeFileReader, Image: FakeImage, setTimeout: setTimeout,
      alert: function () {},
      confirm: function () { return true; },
      Meticulous: { modules: {} }
    };
    sb.window = sb;
    sb.App = {
      _store: null,
      _today: function () { return '2026-11-08'; },
      _esc: function (s) { return String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
      userRole: function () { return opts.role || 'driver'; },
      openModule: function () {},
      tracker: { splitDay: false, status: 'idle' }
    };
    sb.LiveMiles = { subscribe: function () {}, getLastFix: function () { return null; } };
    sb.ConnectPipe = makePipeStub();
    vm.createContext(sb);
    vm.runInContext(extractStore(), sb);
    sb.App._store = sb.store;
    vm.runInContext(ocrSrc, sb);
    vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
    vm.runInContext(splitSrc, sb);
    vm.runInContext(dspSrc, sb);
    const onb = { userRole: opts.role || 'driver', firstName: 'Nirojini', lastName: 'K' };
    if (opts.accountType !== undefined) onb.accountType = opts.accountType;
    if (opts.workPattern !== undefined) onb.workPattern = opts.workPattern;
    sb.store.set('onboarding', onb);
    sb.store.set('dsp_list', []);
    sb.store.set('dsp_active', null);
    const body = new FakeEl('body');
    return { sb: sb, body: body,
      render: function () { sb.Meticulous.modules.dispatch.render(body); } };
  }
  const bus = makeWorld({ accountType: 'Driver', role: 'driver', workPattern: 'split' });
  bus.sb.SplitShift.setRouteSheet('am', runs.am, secAm);
  bus.sb.SplitShift.setRouteSheet('pm', runs.pm, secPm);
  bus.render();
  check('bus + known route + no dispatch record: the day opens on the standing dispatch',
    bus.body._html.indexOf('id="dp_today_card"') > -1 &&
    bus.body._html.indexOf('Your route is today’s dispatch') > -1 &&
    bus.body._html.indexOf('Morning run — 8 stops') > -1 &&
    bus.body._html.indexOf('Afternoon run — 8 stops') > -1 &&
    bus.body._html.indexOf('it stands until a new sheet replaces it') > -1);
  const busNoRoute = makeWorld({ accountType: 'Driver', role: 'driver', workPattern: 'split' });
  busNoRoute.render();
  check('bus + NO known route yet: no standing card is invented',
    busNoRoute.body._html.indexOf('Your route is today’s dispatch') === -1 &&
    busNoRoute.body._html.indexOf('id="dp_today_card"') === -1);
  const std = makeWorld({ accountType: 'Driver', role: 'driver', workPattern: 'standard' });
  std.render();
  check('standard account: no standing dispatch, no route card — Dispatch exactly as before',
    std.body._html.indexOf('Your route is today’s dispatch') === -1 &&
    std.body._html.indexOf('id="dp_today_card"') === -1);

  console.log('\nROUTE-SHEET-DRIVES-NAVIGATION NOV8: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
})().catch(function (e) { console.error('SUITE ERROR', e); process.exit(2); });
