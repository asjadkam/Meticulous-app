#!/usr/bin/env node
/* Meticulous — ROUTE-EDIT-AND-DAILY-SKIP-NOV8.
 *
 * THE RULINGS (Nov 8, 2026, 20:41 CST), Asjad on Nirojini's
 * bus route, on top of ROUTE-STOP-KID-NAMES-TRIP-PREVIEW-
 * NOV8 (the named route, the whole-trip preview, the
 * covering-route delete — benched in the same tree):
 *
 *  "Make sure she can edit any portion of the route
 *   herself... And she needs to be able to adjust stops
 *   daily... So if one of her kids are not coming, she can
 *   just skip a stop and adjust the entire day trip."
 *
 * THE BUILD:
 *  (1) EDIT THE SAVED ROUTE HERSELF — js/splitshift.js
 *      gains routeEditData(block) (a pure read of a standing
 *      run: stops with times, placed flags, sheet kids, the
 *      route's bare name) and editRoute(block, rows,
 *      nameMark): ONE deliberate save of the edited list.
 *      A row keeps its origin stop's roster and placed point
 *      (the `from` index) through a rename / reorder / time
 *      fix; a removed stop's roster goes with it; an added
 *      stop starts kid-less; a row carrying its own point
 *      (the editor's Place tap) wins; a renamed stop with no
 *      fresh point retires its point and is re-placed behind
 *      the glass. The route NAME is editable text on the
 *      same Save (NAMED CHOICE: the name field edits the
 *      bare id; it stands at the top of either run's
 *      editor, since the name belongs to the route, not a
 *      run). An edit retires the run's index-keyed TODAY
 *      marks (plan cursor, sheet walk, absent + skip marks
 *      — the setRouteSheet precedent); the other run's
 *      marks stand; recorded days are never touched. A save
 *      with no named stop is refused — emptying a route is
 *      the Delete door's job (NAMED CHOICE).
 *      modules/dispatch.js: "✏️ Edit the morning/evening
 *      route" doors stand with the preview doors in the
 *      Route sheets card; the editor stages in the card
 *      (the staged-face pattern): name field, per-stop name
 *      + time fields, ↑/↓ move, 📍 Place it / Fix its spot
 *      (geocodes the row's current name, holds the point on
 *      the staged row until Save), ✕ Take off, ＋ Add a
 *      stop, quiet Cancel, ONE primary "💾 Save the route".
 *      Nothing is written before Save; Cancel writes
 *      nothing.
 *  (2) DAILY STOP SKIP — today only. The direct skip
 *      (SplitShift.toggleSkip, Manifest's day view) already
 *      stood; this bench adds the kid-level truth her words
 *      describe: absentNamesToday resolves the day's
 *      positional absent marks to kid NAMES, and a stop
 *      whose sheet kids are ALL absent today auto-drops
 *      from today's walk on BOTH runs (autoSkipKeys) — the
 *      plan (planSkipKeys), the Navigator chain and the
 *      preview all step over it; routeToday says it plainly
 *      (state 'skipped', skipWhy 'absent'); dayStops rides
 *      an unserved auto-dropped stop into the record
 *      flagged skipped + absentSkip, so the Manifest record
 *      names it — never silently vanished; a served stop
 *      keeps its served entry (the record is what
 *      happened). NAMED CHOICE: the GPS sheet-matching
 *      (recordRouteStop) does NOT read the auto set — if she
 *      drives a dropped stop anyway, the record names it
 *      served with its kids absent, carried 0 (the
 *      drives-navigation world-3 truth, held). Bring-back
 *      for an auto drop is SplitShift.unabsentStop(key):
 *      it clears the day's absent marks for that stop's
 *      kids, by name, both runs. Faces: Manifest's live
 *      rows label the drop "skipped today — kids absent"
 *      and give it the unabsent Bring back; the closed
 *      record's Skipped line suffixes "(kids absent)"; the
 *      Navigator plan card gains "⏭ Skip this stop today"
 *      for the current stop and speaks the day's skipped
 *      count; the preview list carries per-stop skip /
 *      bring-back taps on saved runs.
 *  (3) THE PREVIEW IS TODAY'S TRIP WHEN TODAY ADJUSTED IT —
 *      routePreview stops carry skip ('' | 'marked' |
 *      'absent') and the preview carries adjustedToday;
 *      the Navigator labels the panel "today's trip,
 *      adjusted" vs "the standing route", draws today's
 *      chain around skipped stops (skipped stops stand in
 *      the list, dimmed, named with their reason), and the
 *      plan's own chain signature rides the skip state.
 *
 * LAYERS: (S) source pins for every surface + the fences.
 * (G) glue worlds over the real fixture: the edit end to
 * end (rename / retime / reorder / remove / add, roster +
 * point inheritance, name edit, marks retirement,
 * refusals); the absent auto-drop on both runs, partial
 * absence holding the stop, all-absent dropping the school,
 * unabsent bring-back, direct skip purity + tomorrow's
 * wholeness. (D) real Dispatch renders: the editor end to
 * end (open, type, move, remove, add, place, save, cancel,
 * the empty-route refusal).
 * Run: node tools/route-edit-and-daily-skip-nov8-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const dspSrc = read('modules/dispatch.js');
const navSrc = read('modules/navigator.js');
const manSrc = read('modules/manifest.js');
const appSrc = read('js/app.js');
const splitSrc = read('js/splitshift.js');
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
    (function step() { if (++i > (n || 80)) return res(); setTimeout(step, 0); })();
  });
}
function region(src, begin, end) {
  const i = src.indexOf(begin), j = src.indexOf(end);
  if (i < 0 || j < 0 || j < i) throw new Error('region not found: ' + begin);
  return src.slice(i, j + end.length);
}

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
  this.onload = null;
  this.onerror = null;
  this.src = '';
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

/* ================= (S) source pins ================= */
console.log('(S) the build’s shape, pinned in the source');
(function () {
  check('the engine gains the editor doors: routeEditData + editRoute',
    splitSrc.indexOf('routeEditData: function (block)') > -1 &&
    splitSrc.indexOf('editRoute: function (block, rows, nameMark)') > -1);
  check('editRoute: a row keeps its origin roster + point; a fresh point on the row wins; an empty save refuses',
    splitSrc.indexOf('usedFrom') > -1 &&
    splitSrc.indexOf('ENGINE.isCoord(rw)') > -1 &&
    splitSrc.indexOf('if (!stops.length) return 0;') > -1 &&
    splitSrc.indexOf("if (nameMark !== undefined) routeName = String(nameMark || '').trim();") > -1);
  check('editRoute retires the run’s index-keyed today marks (cursor, walk, absent, skip) — and only that run’s',
    (function () {
      const body = region(splitSrc, 'editRoute: function (block, rows, nameMark)', 'unabsentStop: function');
      return body.indexOf('navProg[block] = 0') > -1 && body.indexOf('sheetUsed[block] = 0') > -1 &&
        body.indexOf('dayAbsent.keys') > -1 && body.indexOf('daySkips.keys') > -1 &&
        body.indexOf("var pre = 'sheet:' + block + ':';") > -1;
    })());
  check('the absent truth is resolved BY NAME, and the auto-drop needs every kid absent',
    splitSrc.indexOf('function absentNamesToday()') > -1 &&
    splitSrc.indexOf('function stopAllAbsent(block, idx, names)') > -1 &&
    splitSrc.indexOf('function autoSkipKeys()') > -1 &&
    splitSrc.indexOf('if (!kids.length) return false;') > -1);
  check('the plan’s skip truth is direct PLUS auto (the walk steps over both)',
    (function () {
      const body = region(splitSrc, 'function planSkipKeys()', 'function absentKeys()');
      return body.indexOf('autoSkipKeys()') > -1 && body.indexOf('daySkips.keys') > -1;
    })());
  check('FENCE: the GPS sheet-matching never reads the auto set (the record stays positional truth)',
    (function () {
      const body = region(splitSrc, 'function recordRouteStop(ev)', 'function onEvent(ev)');
      return body.indexOf('autoSkipKeys') === -1 && body.indexOf('daySkips.keys') > -1;
    })());
  check('routeToday rows carry the reason: autoSkipped + skipWhy, done still outranks an auto drop',
    splitSrc.indexOf('autoSkipped: !!autoKeys[key]') > -1 &&
    splitSrc.indexOf('skipWhy: skipWhy(key, skipKeys, autoKeys)') > -1 &&
    splitSrc.indexOf("doneAt ? 'done' : (autoKeys[key] ? 'skipped' : 'ahead')") > -1);
  check('the day record rides an unserved auto drop in, flagged with its reason',
    splitSrc.indexOf('o2.absentSkip = true') > -1 &&
    splitSrc.indexOf('if (effKeys[key] && !served[key])') > -1);
  check('unabsentStop clears the stop’s kids’ marks by name and reports the count',
    splitSrc.indexOf('unabsentStop: function (key)') > -1 &&
    splitSrc.indexOf('if (nm && names[nm]) { delete dayAbsent.keys[k]; cleared++; }') > -1);
  check('routePreview carries the day’s adjustments: per-stop skip + adjustedToday — and stays a pure view',
    (function () {
      const body = region(splitSrc, 'routePreview: function (block)', 'deleteRoute: function');
      return body.indexOf('skip: why') > -1 && body.indexOf('adjustedToday: adjusted') > -1 &&
        body.indexOf('ensureRoutePlaced') === -1 && body.indexOf('persist(') === -1;
    })());
  check('Dispatch: the Edit doors stand with the preview doors in the route card',
    dspSrc.indexOf('id="dp_route_edit_am"') > -1 && dspSrc.indexOf('id="dp_route_edit_pm"') > -1 &&
    dspSrc.indexOf('Edit the morning route') > -1 && dspSrc.indexOf('Edit the evening route') > -1);
  check('Dispatch: the editor stages in the card — read-back before every repaint, one primary Save, Cancel writes nothing',
    dspSrc.indexOf('var dpEditRoute = null;') > -1 &&
    dspSrc.indexOf('function dpEditReadBack()') > -1 &&
    dspSrc.indexOf('function dpPaintRouteEdit(note)') > -1 &&
    dspSrc.indexOf('id="dp_edit_save"') > -1 && dspSrc.indexOf('💾 Save the route') > -1 &&
    dspSrc.indexOf('SplitShift.editRoute') > -1 &&
    dspSrc.indexOf('SplitShift.routeEditData') > -1 &&
    dspSrc.indexOf('Nothing was changed — your route stands as it was.') > -1);
  check('Dispatch: the editor’s Place tap geocodes the row’s current name and holds the point on the staged row',
    dspSrc.indexOf('function dpEditPlace(i)') > -1 &&
    dspSrc.indexOf('g.geocode(nm)') > -1 &&
    dspSrc.indexOf('r2.lat = +hit.latitude; r2.lng = +hit.longitude; r2.placed = true;') > -1 &&
    dspSrc.indexOf('id="dp_edit_place_') > -1 && dspSrc.indexOf('id="dp_edit_add"') > -1 &&
    dspSrc.indexOf('id="dp_edit_off_') > -1 && dspSrc.indexOf('id="dp_edit_up_') > -1);
  check('Dispatch: the editor speaks Evening, never Afternoon (the standing wording law)',
    dspSrc.indexOf('Afternoon route') === -1 && dspSrc.indexOf('Afternoon run') === -1);
  check('Manifest: the live row names the absent drop and brings it back on the absent marks; the record suffixes the reason',
    manSrc.indexOf('skipped today — kids absent') > -1 &&
    manSrc.indexOf('data-split-unabsent') > -1 &&
    manSrc.indexOf('SplitShift.unabsentStop') > -1 &&
    manSrc.indexOf("s.absentSkip ? ' (kids absent)' : ''") > -1);
  check('Navigator: the plan card gains its skip door, wired to the plan’s current stop, and speaks the skipped count',
    navSrc.indexOf('id="nv_rp_skip"') > -1 &&
    navSrc.indexOf('SplitShift.toggleSkip(rpNow2.stops[rpNow2.current].key)') > -1 &&
    navSrc.indexOf("' skipped today.'") > -1);
  check('Navigator: the preview labels today’s adjusted trip vs the standing route',
    navSrc.indexOf('today’s trip, adjusted') > -1 &&
    navSrc.indexOf('the standing route') > -1 &&
    navSrc.indexOf('data.adjustedToday === false') > -1);
  check('Navigator: today’s chain runs around skipped stops, the list names them with reasons and carries their taps',
    (function () {
      const body = region(navSrc, 'function drawRouteOnMap(stops, fit)', 'function paintRouteChain(rp)');
      return body.indexOf('if (!st || st.skip) return;') > -1;
    })() &&
    navSrc.indexOf('⏭ skipped today — kids absent') > -1 &&
    navSrc.indexOf('data-nv-skip') > -1 && navSrc.indexOf('data-nv-unabsent') > -1 &&
    navSrc.indexOf('SplitShift.unabsentStop') > -1);
  check('Navigator: skip taps exist only on a SAVED run’s preview (canSkip), never on a staged read',
    navSrc.indexOf('saved.canSkip = true;') > -1 &&
    navSrc.indexOf('data.canSkip && st.key') > -1 &&
    navSrc.indexOf("(st.skip ? ';opacity:.62' : '')") > -1);
  check('Navigator: the plan chain’s signature rides the skip state, so a tap repaints the chain',
    navSrc.indexOf("(st.skip ? 's' : '')") > -1);
})();

/* ================= async layers ================= */
(async function () {
  const rsfBox = {};
  vm.runInNewContext(region(dspSrc, '/* ROUTE-SHEET-FILE-BEGIN', '/* ROUTE-SHEET-FILE-END */') +
    '\nthis.__R = RouteSheetFile;', rsfBox);
  const R = rsfBox.__R;
  const engBox = {};
  vm.runInNewContext(region(splitSrc, '/* SPLIT-ENGINE-BEGIN', '/* SPLIT-ENGINE-END */') +
    '\nthis.__E = ENGINE;', engBox);
  const E = engBox.__E;
  const pdfjsLibNode = require(path.join(ROOT, 'tools', 'bench-env', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.js'));
  const pdfBytes = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tools', 'fixtures', 'route-CBE-0574.pdf')));
  const doc = await pdfjsLibNode.getDocument({ data: pdfBytes }).promise;
  const pagesItems = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pagesItems.push(tc.items.map(function (it) {
      return { str: it.str, transform: it.transform.slice(), width: it.width, height: it.height };
    }));
  }
  const fullText = pagesItems.map(function (items) { return R.linesFromItems(items).join('\n'); }).join('\n');
  const runs = R.runsFromText(fullText);
  const secAm = R.sliceShift(fullText, 'am'), secPm = R.sliceShift(fullText, 'pm');
  const stopsAm = E.parseRouteSheet(runs.am), stopsPm = E.parseRouteSheet(runs.pm);
  const rosterAm = E.parseRouteRoster(secAm, stopsAm), rosterPm = E.parseRouteRoster(secPm, stopsPm);
  const AM_NAMES = stopsAm.map(function (s) { return s.name; });
  const PM_NAMES = stopsPm.map(function (s) { return s.name; });
  const bookAll = {};
  AM_NAMES.concat(PM_NAMES).forEach(function (n, i) {
    bookAll[n] = { latitude: 51.090 + i * 0.004, longitude: -114.120 + i * 0.006 };
  });

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
  function saveBoth(g) {
    g.SS.setRouteSheet('am', runs.am, secAm, R.routeNameOf(fullText));
    g.SS.setRouteSheet('pm', runs.pm, secPm, R.routeNameOf(fullText));
  }

  /* ---------- (G) world E1 — the edit, end to end ---------- */
  console.log('(G) world E1 — edit the saved route: rename, retime, reorder, remove, add');
  const dataE1 = { onboarding: { workPattern: 'split' }, sessions: [] };
  const bookE1 = Object.assign({}, bookAll);
  const NEWNAME = '1005 Cameron Ave SW, Calgary — the blue house';
  bookE1[NEWNAME] = { latitude: 51.5, longitude: -114.5 };
  const gE1 = makeGlue(dataE1, bookE1);
  saveBoth(gE1);
  await flush(80);
  const ed1 = gE1.SS.routeEditData('am');
  eq('the editor reads the standing morning run whole',
    [ed1.stops.length, ed1.name, ed1.stops[0].up, ed1.stops[1].placed],
    [8, 'CBE-0574', ['Sabuktigin Mian'], true]);
  eq('the editor reads the evening run too', gE1.SS.routeEditData('pm').stops.map(function (s) { return s.name; }), PM_NAMES);
  eq('no route, no editor data', gE1.SS.routeEditData('xx'), null);
  const wbBefore = gE1.SS.routePreview('am').stops[2];
  eq('the untouched stop’s point before the edit', [wbBefore.lat, wbBefore.lng],
    [bookAll[AM_NAMES[2]].latitude, bookAll[AM_NAMES[2]].longitude]);
  /* the geocoder’s answer for the untouched stop CHANGES
     after the save — if the edit re-geocoded it, its point
     would move; inheritance must hold it where it was */
  bookE1[AM_NAMES[2]] = { latitude: 52.9, longitude: -115.9 };
  const rowsE1 = [
    { name: ed1.stops[0].name, time: ed1.stops[0].time, from: 0 },
    { name: ed1.stops[2].name, time: '7:45 AM', from: 2 },
    { name: NEWNAME, time: ed1.stops[1].time, from: 1 },
    { name: ed1.stops[3].name, time: ed1.stops[3].time, from: 3 },
    { name: ed1.stops[4].name, time: ed1.stops[4].time, from: 4 },
    { name: ed1.stops[5].name, time: ed1.stops[5].time, from: 5 },
    { name: ed1.stops[7].name, time: ed1.stops[7].time, from: 7 },
    { name: 'Depot Gate', time: '8:40 AM', from: -1 }
  ];
  eq('the edit saves', gE1.SS.editRoute('am', rowsE1, 'XYZ-0001'), 8);
  await flush(80);
  eq('the route stands under its edited name', gE1.SS.routeSheetInfo(), { am: 8, pm: 8, name: 'Route XYZ-0001' });
  const rtE1 = gE1.SS.routeToday().am;
  eq('the day’s route follows the edited order, names and the retimed stop',
    rtE1.map(function (r) { return r.name; }),
    [AM_NAMES[0], AM_NAMES[2], NEWNAME, AM_NAMES[3], AM_NAMES[4], AM_NAMES[5], AM_NAMES[7], 'Depot Gate']);
  eq('the retimed stop carries its new time', rtE1[1].time, '7:45 AM');
  eq('the renamed stop kept its kid (the roster rides the row)',
    [rtE1[2].kids.up.exp, rtE1[2].kids.up.kids[0].name], [1, 'Jabbar Adeleke']);
  eq('the moved school kept all five of its kids',
    gE1.SS.routeToday().am[5].kids.down.exp, 5);
  eq('the moved drop-off kept its kid', gE1.SS.routeToday().am[6].kids.down.exp, 1);
  eq('the added stop carries no kids (no sheet named any)', 
    [rtE1[7].kids.up.exp, rtE1[7].kids.down.exp], [0, 0]);
  eq('the removed stop’s pickup is gone from the count; the drop-off kid still rides',
    [gE1.SS.kidCounts().am.expectedUp, gE1.SS.kidCounts().am.expectedDown], [5, 6]);
  const pvE1 = gE1.SS.routePreview('am');
  eq('the untouched stop kept its placed point through the edit (inheritance, not re-geocode)',
    [pvE1.stops[1].lat, pvE1.stops[1].lng],
    [bookAll[AM_NAMES[2]].latitude, bookAll[AM_NAMES[2]].longitude]);
  eq('the renamed stop retired its old point and was placed by its new name',
    [pvE1.stops[2].placed, pvE1.stops[2].lat, pvE1.stops[2].lng], [true, 51.5, -114.5]);
  eq('the plan follows the edited route from the next build',
    gE1.SS.routePlan().stops.map(function (s) { return s.name; }),
    [AM_NAMES[0], AM_NAMES[2], NEWNAME, AM_NAMES[3], AM_NAMES[4], AM_NAMES[5], AM_NAMES[7], 'Depot Gate']);
  eq('the evening run is untouched by the morning edit',
    gE1.SS.routeEditData('pm').stops.map(function (s) { return s.name; }), PM_NAMES);
  /* a row carrying its own point (the editor’s Place tap)
     wins even over a rename */
  const rowsE1b = gE1.SS.routeEditData('am').stops.map(function (st, i) {
    return { name: st.name, time: st.time, from: i };
  });
  rowsE1b[0] = { name: '321 21 Ave SW — moved pin', time: rowsE1b[0].time, from: 0, lat: 51.111, lng: -114.111 };
  eq('a second edit saves', gE1.SS.editRoute('am', rowsE1b, undefined), 8);
  eq('the row’s own placed point wins', 
    [gE1.SS.routePreview('am').stops[0].lat, gE1.SS.routePreview('am').stops[0].lng], [51.111, -114.111]);
  eq('an undefined nameMark leaves the edited name standing', gE1.SS.routeSheetInfo().name, 'Route XYZ-0001');

  /* ---------- (G) world E2 — refusals + the day’s marks ---------- */
  console.log('(G) world E2 — the edit retires the run’s today marks; the other run’s stand; empty saves refuse');
  const dataE2 = { onboarding: { workPattern: 'split' }, sessions: [] };
  const gE2 = makeGlue(dataE2, Object.assign({}, bookAll));
  saveBoth(gE2);
  await flush(80);
  gE2.SS.toggleAbsent('sheet:am:0:up:0');
  gE2.SS.toggleSkip('sheet:am:6');
  gE2.SS.toggleSkip('sheet:pm:2');
  gE2.SS.navAdvance(); gE2.SS.navAdvance();
  eq('before the edit: the plan has walked (absent drop + two advances)',
    gE2.SS.routePlan().current, 3);
  eq('before the edit: the marks stand', 
    [gE2.SS.routeToday().am[0].kids.absent, gE2.SS.routeToday().am[6].skipped], [1, true]);
  const rowsE2 = gE2.SS.routeEditData('am').stops.map(function (st, i) {
    return { name: st.name, time: st.time, from: i };
  });
  rowsE2[3] = { name: '3380 Spruce Dr SW — fixed name', time: rowsE2[3].time, from: 3 };
  eq('the edit saves', gE2.SS.editRoute('am', rowsE2, ''), 8);
  eq('the name field’s blank clears the route name (plain words stand)',
    gE2.SS.routeSheetInfo().name, '');
  eq('after the edit: the morning plan opens whole again (cursor + absent retired)',
    gE2.SS.routePlan().current, 0);
  eq('after the edit: the morning’s absent + skip marks are retired',
    [gE2.SS.routeToday().am[0].kids.absent, gE2.SS.routeToday().am[6].skipped], [0, false]);
  eq('after the edit: the evening’s skip mark stands untouched',
    gE2.SS.routeToday().pm[2].skipped, true);
  const snapE2 = JSON.stringify(dataE2);
  eq('a save with no named stop refuses', gE2.SS.editRoute('am', [{ name: '  ', time: '', from: -1 }], undefined), 0);
  eq('a save with no rows refuses', gE2.SS.editRoute('am', [], undefined), 0);
  eq('a save for no run refuses', gE2.SS.editRoute('xx', rowsE2, undefined), 0);
  eq('the refusals changed nothing', JSON.stringify(dataE2), snapE2);

  /* ---------- (G) world S1 — the absent auto-drop ---------- */
  console.log('(G) world S1 — one absent tap drops the kid’s home stop on BOTH runs');
  const dataS1 = { onboarding: { workPattern: 'split' }, sessions: [] };
  const gS1 = makeGlue(dataS1, Object.assign({}, bookAll));
  saveBoth(gS1);
  await flush(80);
  eq('baseline: the whole route stands in the preview, nothing adjusted',
    [gS1.SS.routePreview('am').adjustedToday, gS1.SS.routePreview('am').stops.every(function (s) { return s.skip === ''; })],
    [false, true]);
  eq('baseline: the plan opens at the first stop', gS1.SS.routePlan().current, 0);
  check('Sabuktigin’s absent mark lands', gS1.SS.toggleAbsent('sheet:am:0:up:0') === true);
  const rpS1 = gS1.SS.routePlan();
  eq('the morning walk steps over his home stop', [rpS1.stops[0].state, rpS1.current], ['skipped', 1]);
  eq('the plan’s target is the next stop', rpS1.target && rpS1.target.idx, 1);
  eq('the morning preview marks the drop with its reason',
    [gS1.SS.routePreview('am').stops[0].skip, gS1.SS.routePreview('am').adjustedToday], ['absent', true]);
  eq('the EVENING preview drops his home drop-off too (both runs, one tap)',
    [gS1.SS.routePreview('pm').stops[4].skip, gS1.SS.routePreview('pm').adjustedToday], ['absent', true]);
  const rtS1 = gS1.SS.routeToday();
  eq('the day surface says it plainly, both runs',
    [rtS1.am[0].autoSkipped, rtS1.am[0].skipWhy, rtS1.am[0].state, rtS1.pm[4].skipWhy, rtS1.pm[4].state],
    [true, 'absent', 'skipped', 'absent', 'skipped']);
  const dsS1 = gS1.SS.dayStops();
  check('the day record names the dropped morning stop, flagged with its reason',
    dsS1.some(function (s) { return s.key === 'sheet:am:0' && s.skipped === true && s.absentSkip === true && s.at === 0; }));
  check('the day record names the dropped evening stop too',
    dsS1.some(function (s) { return s.key === 'sheet:pm:4' && s.skipped === true && s.absentSkip === true; }));
  eq('the count: expected stands (the sheet’s truth), absent 1, carried 0 at his stop',
    [gS1.SS.kidCounts().am.expectedUp, gS1.SS.kidCounts().am.absent, gS1.SS.kidCounts().pm.absent], [6, 1, 1]);
  const snapS1 = JSON.stringify(dataS1);
  gS1.SS.routePreview('am'); gS1.SS.routePreview('pm');
  eq('the adjusted preview still performs ZERO writes', JSON.stringify(dataS1), snapS1);
  /* partial absence: one of Wildwood’s five does NOT drop the school */
  check('one Wildwood kid absent lands', gS1.SS.toggleAbsent('sheet:am:5:down:0') === true);
  eq('the school stop does NOT drop while four of its kids still ride',
    [gS1.SS.routePreview('am').stops[5].skip, gS1.SS.routePreview('pm').stops[0].skip], ['', '']);
  ['sheet:am:5:down:1', 'sheet:am:5:down:2', 'sheet:am:5:down:3', 'sheet:am:5:down:4'].forEach(function (k) {
    gS1.SS.toggleAbsent(k);
  });
  eq('with all five absent, the school drops on both runs',
    [gS1.SS.routePreview('am').stops[5].skip, gS1.SS.routePreview('pm').stops[0].skip], ['absent', 'absent']);
  /* Almurtada — NOT one of Wildwood’s five — is absent too:
     his stops drop, and the school’s bring-back must not
     reach him (the clearing is scoped to the stop’s names) */
  check('Almurtada’s absent mark lands', gS1.SS.toggleAbsent('sheet:am:6:up:0') === true);
  eq('his pickup stop drops with him', gS1.SS.routePreview('am').stops[6].skip, 'absent');
  eq('bring back on the school clears every mark its five kids carry — six, Sabuktigin’s home mark among them',
    gS1.SS.unabsentStop('sheet:am:5'), 6);
  eq('the school stands again on both runs',
    [gS1.SS.routePreview('am').stops[5].skip, gS1.SS.routePreview('pm').stops[0].skip], ['', '']);
  eq('and Sabuktigin’s home stop stands again with the school (he is one of the five — by name, he is simply not absent)',
    gS1.SS.routePreview('am').stops[0].skip, '');
  eq('Almurtada’s drop stands untouched by the school’s bring-back (names, not stops)',
    gS1.SS.routePreview('am').stops[6].skip, 'absent');
  eq('unabsent on a stop with no marks clears nothing', gS1.SS.unabsentStop('sheet:am:3'), 0);
  check('the absent tap itself brings Almurtada back', gS1.SS.toggleAbsent('sheet:am:6:up:0') === false);
  eq('the whole route walks again', [gS1.SS.routePlan().current, gS1.SS.routePreview('am').adjustedToday], [0, false]);

  /* ---------- (G) world S2 — a shared stop + direct skip purity + tomorrow ---------- */
  console.log('(G) world S2 — a two-kid stop drops only when BOTH are absent; direct skips never touch the route; yesterday’s marks are not today’s');
  const dataS2 = { onboarding: { workPattern: 'split' }, sessions: [] };
  const gS2 = makeGlue(dataS2, Object.assign({}, bookAll));
  /* the stops text and the roster section are different
     slices of a sheet (the fixture’s own shape): the stops
     text carries the timed lines, the section carries the
     named students under them */
  const synthStops = '8:00 AM Alpha Home, Calgary, AB\n8:10 AM Beta School, Calgary, AB';
  const synthSec = '8:00 AM Alpha Home, Calgary, AB\n' +
    'PICK-UP Kid One * 403-555-0101\nKid Two * 403-555-0102\n' +
    '8:10 AM Beta School, Calgary, AB\n' +
    'DROP-OFF Kid One * 403-555-0101\nKid Two * 403-555-0102';
  eq('the synthetic sheet saves', gS2.SS.setRouteSheet('am', synthStops, synthSec), 2);
  await flush(40);
  eq('the synthetic roster reads both kids at both stops',
    [gS2.SS.routeToday().am[0].kids.up.exp, gS2.SS.routeToday().am[1].kids.down.exp], [2, 2]);
  gS2.SS.toggleAbsent('sheet:am:0:up:0');
  eq('one of two absent: the stop stays in the walk',
    [gS2.SS.routePreview('am').stops[0].skip, gS2.SS.routePlan().current], ['', 0]);
  gS2.SS.toggleAbsent('sheet:am:0:up:1');
  eq('both absent: the home stop AND the school drop; the walk is done',
    [gS2.SS.routePreview('am').stops[0].skip, gS2.SS.routePreview('am').stops[1].skip, gS2.SS.routePlan().done],
    ['absent', 'absent', true]);
  gS2.SS.toggleAbsent('sheet:am:0:up:1');
  eq('one back: both stops stand again', gS2.SS.routePreview('am').adjustedToday, false);

  const dataS3 = { onboarding: { workPattern: 'split' }, sessions: [] };
  const gS3 = makeGlue(dataS3, Object.assign({}, bookAll));
  saveBoth(gS3);
  await flush(80);
  const routeSnapS3 = JSON.stringify(dataS3.splitshift.routeSheets);
  check('a direct skip lands', gS3.SS.toggleSkip('sheet:am:6') === true);
  eq('the preview marks a direct skip as marked, not absent',
    [gS3.SS.routePreview('am').stops[6].skip, gS3.SS.routePreview('am').adjustedToday], ['marked', true]);
  eq('the plan steps over the directly skipped stop', gS3.SS.routePlan().stops[6].state, 'skipped');
  check('the day record names the direct skip without the absent reason',
    gS3.SS.dayStops().some(function (s) { return s.key === 'sheet:am:6' && s.skipped === true && !s.absentSkip; }));
  eq('the standing route is byte-identical under a skip', JSON.stringify(dataS3.splitshift.routeSheets), routeSnapS3);
  check('un-skip lands', gS3.SS.toggleSkip('sheet:am:6') === false);
  eq('the standing route is byte-identical after the un-skip', JSON.stringify(dataS3.splitshift.routeSheets), routeSnapS3);
  eq('the editor still reads the whole route, in order',
    gS3.SS.routeEditData('am').stops.map(function (s) { return s.name; }), AM_NAMES);
  /* tomorrow: the same marks stamped yesterday are not today’s */
  dataS3.splitshift.daySkips = { date: '2000-01-01', keys: { 'sheet:am:6': true } };
  dataS3.splitshift.dayAbsent = { date: '2000-01-01', keys: { 'sheet:am:0:up:0': true } };
  const gS3b = makeGlue(dataS3, Object.assign({}, bookAll));
  eq('yesterday’s marks do not hold today: the whole route walks',
    [gS3b.SS.routePlan().current, gS3b.SS.routePlan().stops[6].state, gS3b.SS.routePreview('am').adjustedToday],
    [0, 'ahead', false]);

  /* ---------- (D) Dispatch renders — the editor end to end ---------- */
  console.log('(D) Dispatch renders — open the editor, type, move, remove, add, place, save; cancel; the refusal');
  function makeWorld(geoBook) {
    const local = makeLocal();
    const net = { allow: function () { return false; }, lib: function () { return null; }, srcs: [] };
    const doc = {
      createElement: function (tag) {
        if (tag === 'canvas') {
          return { width: 0, height: 0,
            getContext: function () { return { drawImage: function () {} }; },
            toDataURL: function () { return 'data:image/jpeg;base64,THUMB'; } };
        }
        return new FakeEl(tag);
      },
      head: { appendChild: function (s) { net.srcs.push(s.src); setTimeout(function () { if (s.onerror) s.onerror(); }, 0); } },
      querySelector: function () { return null; },
      addEventListener: function () {}
    };
    const sb = {
      console: console, document: doc, localStorage: local,
      FileReader: FakeFileReader, Image: FakeImage, setTimeout: setTimeout,
      alert: function () {},
      confirm: function () { return true; },
      URL: { createObjectURL: function () { return 'blob:fake'; }, revokeObjectURL: function () {} },
      Meticulous: { modules: {} }
    };
    sb.window = sb;
    sb.App = {
      _store: null,
      _today: function () { return '2026-11-08'; },
      _esc: function (s) { return String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
      userRole: function () { return 'driver'; },
      openModule: function () {},
      tracker: { splitDay: false, status: 'idle' }
    };
    sb.LiveMiles = { subscribe: function () {}, getLastFix: function () { return null; } };
    sb.ConnectPipe = makePipeStub();
    sb.MeticulousGeo = {
      geocode: function (name) {
        return Promise.resolve(Object.prototype.hasOwnProperty.call(geoBook, name) ? geoBook[name] : null);
      }
    };
    vm.createContext(sb);
    vm.runInContext(extractStore(), sb);
    sb.App._store = sb.store;
    vm.runInContext(ocrSrc, sb);
    vm.runInContext(extractRegion(invSrc, 'INV-CYCLE-BEGIN', 'INV-CYCLE-END'), sb);
    vm.runInContext(splitSrc, sb);
    vm.runInContext(dspSrc, sb);
    sb.store.set('onboarding', { userRole: 'driver', firstName: 'Nirojini', lastName: 'K',
      accountType: 'Driver', workPattern: 'split' });
    sb.store.set('dsp_list', []);
    sb.store.set('dsp_active', null);
    const body = new FakeEl('body');
    return { sb: sb, body: body,
      render: function () { sb.Meticulous.modules.dispatch.render(body); } };
  }
  function card(w) { return w.body.querySelector('#dp_sheet_card'); }
  /* the browser would hold each painted input’s value as a
     property; the fake DOM holds it only in the painted
     HTML — sync the stubs from the paint before tapping on */
  function syncInputs(w) {
    const html = card(w)._html;
    const re = /id="(dp_edit_(?:sname|stime)_\d+|dp_edit_name)" value="([^"]*)"/g;
    let m;
    while ((m = re.exec(html))) card(w).querySelector('#' + m[1]).value = m[2];
  }
  const bookD = Object.assign({}, bookAll);
  bookD[AM_NAMES[1]] = null;                       // Cameron never places behind the glass
  bookD['Blue House Corner'] = { latitude: 51.31, longitude: -114.31 };
  const wD = makeWorld(bookD);
  wD.sb.SplitShift.setRouteSheet('am', runs.am, secAm, R.routeNameOf(fullText));
  wD.sb.SplitShift.setRouteSheet('pm', runs.pm, secPm, R.routeNameOf(fullText));
  await flush(80);
  wD.render();
  check('the route card carries both Edit doors',
    wD.body._html.indexOf('id="dp_route_edit_am"') > -1 && wD.body._html.indexOf('id="dp_route_edit_pm"') > -1);
  wD.body.querySelector('#dp_route_edit_am').onclick();
  let hD = card(wD)._html;
  check('the editor opens on the morning run, the name field carrying the sheet’s id',
    hD.indexOf('✏️ Edit the morning route') > -1 && hD.indexOf('id="dp_edit_name" value="CBE-0574"') > -1);
  check('the editor lists every stop with its name, time and kids',
    hD.indexOf('value="' + AM_NAMES[0] + '"') > -1 && hD.indexOf('value="7:26 AM"') > -1 &&
    hD.indexOf('Sabuktigin Mian') > -1 && hD.indexOf('id="dp_edit_sname_7"') > -1);
  check('the unplaced stop says so in the editor', hD.indexOf('Not on the map yet') > -1);
  syncInputs(wD);
  /* type: rename stop 3 (index 2), retime stop 2 (index 1) */
  card(wD).querySelector('#dp_edit_sname_2').value = 'Renamed Corner';
  card(wD).querySelector('#dp_edit_stime_1').value = '7:40 AM';
  /* move the first stop down one — typed words must survive the repaint */
  card(wD).querySelector('#dp_edit_down_0').onclick();
  hD = card(wD)._html;
  check('the move repaints with the typed rename + retime intact, order swapped',
    hD.indexOf('value="Renamed Corner"') > -1 && hD.indexOf('value="7:40 AM"') > -1 &&
    hD.indexOf('value="' + AM_NAMES[1] + '"') < hD.indexOf('value="' + AM_NAMES[0] + '"'));
  syncInputs(wD);
  /* take the last stop off, then add a fresh one */
  card(wD).querySelector('#dp_edit_off_7').onclick();
  hD = card(wD)._html;
  check('the take-off repaints with seven rows', hD.indexOf('id="dp_edit_sname_7"') === -1 && hD.indexOf('id="dp_edit_sname_6"') > -1);
  syncInputs(wD);
  card(wD).querySelector('#dp_edit_add').onclick();
  syncInputs(wD);
  card(wD).querySelector('#dp_edit_sname_7').value = 'Depot Gate';
  card(wD).querySelector('#dp_edit_stime_7').value = '8:40 AM';
  /* place Cameron (row 0 after the swap): rename it to a name
     the book knows, then tap Place */
  card(wD).querySelector('#dp_edit_sname_0').value = 'Blue House Corner';
  card(wD).querySelector('#dp_edit_place_0').onclick();
  await flush(30);
  hD = card(wD)._html;
  check('the Place tap lands the spot on the staged row', hD.indexOf('📍 On the map') > -1);
  syncInputs(wD);
  card(wD).querySelector('#dp_edit_name').value = 'XYZ-0001';
  const snapBeforeSaveD = JSON.stringify(wD.sb.store.get('splitshift', {}));
  check('nothing was written before Save (the whole edit was staged)',
    JSON.stringify(wD.sb.store.get('splitshift', {})) === snapBeforeSaveD &&
    wD.sb.SplitShift.routeSheetInfo().name === 'Route CBE-0574');
  card(wD).querySelector('#dp_edit_save').onclick();
  eq('after Save: the route stands edited, under its new name',
    wD.sb.SplitShift.routeSheetInfo(), { am: 8, pm: 8, name: 'Route XYZ-0001' });
  eq('after Save: the day’s route is the edited route, in order',
    wD.sb.SplitShift.routeToday().am.map(function (r) { return r.name; }),
    ['Blue House Corner', AM_NAMES[0], 'Renamed Corner', AM_NAMES[3], AM_NAMES[4], AM_NAMES[5], AM_NAMES[6], 'Depot Gate']);
  eq('after Save: the retime stands', wD.sb.SplitShift.routeToday().am[0].time, '7:40 AM');
  eq('after Save: the placed spot stands on the route',
    [wD.sb.SplitShift.routePreview('am').stops[0].placed, wD.sb.SplitShift.routePreview('am').stops[0].lat],
    [true, 51.31]);
  eq('after Save: the renamed stop kept its kid, the taken-off stop’s kid is gone from the run',
    [wD.sb.SplitShift.routeToday().am[2].kids.up.kids[0].name, wD.sb.SplitShift.kidCounts().am.expectedDown], ['Fatima Khawajazada', 5]);
  eq('the save note speaks on the run’s own note',
    wD.body.querySelector('#dp_sheet_am_note').textContent,
    'Morning route updated — 8 stops, in order. The day’s route follows your edits.');
  /* cancel: open, change, cancel — nothing moves */
  const snapCancelD = JSON.stringify(wD.sb.store.get('splitshift', {}));
  wD.body.querySelector('#dp_route_edit_pm').onclick();
  syncInputs(wD);
  card(wD).querySelector('#dp_edit_sname_0').value = 'Should Never Land';
  card(wD).querySelector('#dp_edit_cancel').onclick();
  eq('Cancel writes nothing — the store is byte-identical',
    JSON.stringify(wD.sb.store.get('splitshift', {})), snapCancelD);
  eq('the cancel note stands', wD.body.querySelector('#dp_sheet_file_note').textContent,
    'Nothing was changed — your route stands as it was.');
  /* the empty-route refusal: take every stop off, Save — the
     editor stays open with the refusal, the route stands */
  wD.body.querySelector('#dp_route_edit_pm').onclick();
  for (let i = 0; i < 8; i++) {
    syncInputs(wD);
    card(wD).querySelector('#dp_edit_off_0').onclick();
  }
  card(wD).querySelector('#dp_edit_save').onclick();
  hD = card(wD)._html;
  check('the empty save is refused in the editor, with the Delete door named',
    hD.indexOf('A route needs at least one named stop') > -1 && hD.indexOf('Delete the route') > -1);
  eq('the route still stands after the refusal', wD.sb.SplitShift.routeSheetInfo().pm, 8);

  console.log('ROUTE-EDIT-AND-DAILY-SKIP NOV8: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exitCode = 1;
})().catch(function (e) { console.log('SUITE ERROR', e && e.stack || e); process.exitCode = 1; });
