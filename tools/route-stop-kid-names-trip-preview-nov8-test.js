#!/usr/bin/env node
/* Meticulous — ROUTE-STOP-KID-NAMES-TRIP-PREVIEW-NOV8.
 *
 * THE RULINGS (Nov 8, 2026, 20:16–20:18 CST), Asjad on
 * Nirojini's bus route, on top of the shipped route chain
 * (webs 381/382/384/385):
 *
 *  (1) "Kid count and name with the stop" — wherever a stop
 *      shows its kid count, the kids' NAMES ride with it: the
 *      upload confirmation card (each stop line gains its
 *      kids by name), the Navigator plan card (the stop she
 *      is heading to shows who gets on/off there, by name).
 *      Manifest's run rows already carry per-kid absent chips
 *      — aligned, not duplicated (no Manifest change).
 *  (2) "Preview the entire trip with her" — a whole-trip
 *      preview: every stop of the run pinned IN ORDER on the
 *      map + the ordered stop list (names, times, kids),
 *      reachable from the confirmation card BEFORE Save and
 *      any time from the saved standing route in Dispatch.
 *      A view only: it moves no save earlier, writes nothing.
 *      Unplaced stops stand in the list by name and are
 *      passed over on the map — never dropped.
 *  (3) "Save the entire route by name on her map" — the saved
 *      route stands in the Navigator as a NAMED route (the
 *      sheet's own id — the sample sheet heads itself
 *      "Route Details + CBE-0574"), its stops on the map as
 *      that route, its name on the Dispatch standing face.
 *      A sheet that names no route falls back to the plain
 *      Morning / Evening words (NAMED CHOICE, owner's veto).
 *  (4) THE EVENING WORDING (Nov 8, 20:17 CST — "Morning and
 *      evening is daily"): the daily pair is the MORNING run
 *      and the EVENING run (the sheet's AM + PM); "afternoon"
 *      in this house names the midday NOON run, which is NOT
 *      daily and keeps NO home in the app. The faces this
 *      bench touches (confirmation card, preview,
 *      standing-dispatch face, Dispatch route card) call the
 *      second run the Evening run.
 *  (5) THE COVERING-ROUTE DELETE (Nov 8, 20:18 CST — "she is
 *      covering this load! This is not a permanent trip...
 *      there has to be a way to delete the route! So it
 *      doesn't keep counting it after she stops"): a DELETE
 *      door where she manages the route (the Dispatch Route
 *      sheets card), per-run and whole-route, fenced off and
 *      quiet below the card's real work, confirming first
 *      with wording that says what happens. After a delete:
 *      no standing dispatch for the run, no plan walks for
 *      it, no kid counting against it, the named route comes
 *      off her map. History is NOT rewritten — days already
 *      recorded under the route stand exactly as recorded.
 *      And loading a different route afterwards works
 *      exactly as before.
 *
 * THE BUILD: js/splitshift.js — the record carries routeName
 * (the bare id, set only by the FILE door's save via
 * setRouteSheet's new 4th argument; the photograph doors
 * leave it untouched); routePlan stops carry up/down kid-name
 * lists and the plan carries routeName; a read-only
 * routePreview(block) serves the whole trip; deleteRoute
 * ('am'|'pm'|'all') unwinds a run; routeSheetInfo speaks the
 * display name. modules/dispatch.js — RouteSheetFile.
 * routeNameOf reads the id off the sheet; the confirmation
 * paints per-stop kid names + the route name + a per-run
 * "Preview the trip on the map" door (the hand-off parks the
 * staged read so the return re-stages the same confirmation,
 * once); the standing face + route card speak Evening and
 * carry the name; the route card gains the preview doors and
 * the fenced delete doors with their staged confirm.
 * modules/navigator.js — nav_route_preview is consumed like
 * nav_open_settings; the preview panel lists the run in
 * order; drawRouteOnMap pins placed stops numbered, in
 * order, chained; the plan paints its run's chain under the
 * route's name and its card names the current stop's kids.
 *
 * LAYERS: (S) source pins. (P) pure name reading over the
 * real fixture. (G) glue worlds: the name persists, the
 * plan + preview carry the sheet's kids by name, the absent
 * overlay holds, the preview writes nothing, per-run and
 * whole-route deletes unwind clean, history stands, a fresh
 * route loads after a delete. (D) real Dispatch renders:
 * the confirmation's names + preview hand-off + restage,
 * Save under the name, the standing faces, the delete doors
 * end to end (stage, keep, delete one run, delete all),
 * re-upload after delete, and the nameless-sheet fallback.
 * Run: node tools/route-stop-kid-names-trip-preview-nov8-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const dspSrc = read('modules/dispatch.js');
const navSrc = read('modules/navigator.js');
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
function makeWorld(opts) {
  const local = makeLocal();
  const net = opts.net || { allow: function () { return false; }, lib: function () { return null; }, srcs: [] };
  const doc = {
    createElement: function (tag) {
      if (tag === 'canvas') {
        return { width: 0, height: 0,
          getContext: function () { return { drawImage: function () {} }; },
          toDataURL: function () { return 'data:image/jpeg;base64,THUMB'; } };
      }
      return new FakeEl(tag);
    },
    head: { appendChild: function (s) {
      net.srcs.push(s.src);
      setTimeout(function () {
        if (net.allow(s.src)) { sb.pdfjsLib = net.lib(); if (s.onload) s.onload(); }
        else if (s.onerror) s.onerror();
      }, 0);
    } },
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
  sb.store.set('onboarding', { userRole: 'driver', firstName: 'Nirojini', lastName: 'K',
    accountType: 'Driver', workPattern: 'split' });
  sb.store.set('dsp_list', []);
  sb.store.set('dsp_active', null);
  const body = new FakeEl('body');
  const opened = [];
  sb.App.openModule = function (name) { opened.push(name); };
  return { sb: sb, body: body, net: net, opened: opened,
    render: function () { sb.Meticulous.modules.dispatch.render(body); } };
}
function fakeFile(name, type, bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return {
    name: name, type: type,
    arrayBuffer: function () { return Promise.resolve(u8.slice().buffer); },
    slice: function (a, b) {
      const sub = u8.slice(a, b);
      return { arrayBuffer: function () { return Promise.resolve(sub.slice().buffer); } };
    }
  };
}
function fakePdfLib(pagesItems) {
  return {
    GlobalWorkerOptions: {},
    getDocument: function () {
      return { promise: Promise.resolve({
        numPages: pagesItems.length,
        getPage: function (pn) {
          return Promise.resolve({
            getTextContent: function () { return Promise.resolve({ items: pagesItems[pn - 1] }); }
          });
        }
      }) };
    }
  };
}

/* ================= (S) source pins ================= */
console.log('(S) the build’s shape, pinned in the source');
(function () {
  check('the engine record carries the route name (persist + restore)',
    splitSrc.indexOf('routeName: routeName,') > -1 &&
    splitSrc.indexOf('rec.routeName') > -1);
  check('the name enters only through setRouteSheet’s file-door argument',
    splitSrc.indexOf('setRouteSheet: function (block, text, rosterText, nameMark)') > -1 &&
    splitSrc.indexOf("routeName = String(nameMark || '').trim()") > -1);
  check('the plan’s stops carry their kids by name, and the plan carries the route name',
    splitSrc.indexOf('up: kd.up, down: kd.down') > -1 &&
    splitSrc.indexOf('routeName: displayRouteName()') > -1);
  check('routePreview exists and is a pure view — no placement pass, no persist',
    (function () {
      const body = region(splitSrc, 'routePreview: function (block)', 'deleteRoute: function');
      return body.indexOf('ensureRoutePlaced') === -1 && body.indexOf('persist(') === -1 &&
        body.indexOf('stopKids(block, i)') > -1;
    })());
  check('deleteRoute unwinds runs + roster + cursors, and the name only when both runs are gone',
    splitSrc.indexOf('deleteRoute: function (which)') > -1 &&
    splitSrc.indexOf('routeSheets[b] = [];') > -1 &&
    splitSrc.indexOf('routeRoster[b] = [];') > -1 &&
    splitSrc.indexOf("routeName = '';") > -1);
  check('routeSheetInfo speaks the display name',
    splitSrc.indexOf('name: displayRouteName()') > -1);
  check('RouteSheetFile.routeNameOf reads the sheet’s own header',
    dspSrc.indexOf('routeNameOf: function (text)') > -1 &&
    dspSrc.indexOf('Route\\s+Details') > -1);
  check('the confirmation paints each stop’s kids by name (On / Off)',
    dspSrc.indexOf("bits.push('On: '") > -1 && dspSrc.indexOf("bits.push('Off: '") > -1 &&
    dspSrc.indexOf('pv.roster') > -1);
  check('the confirmation carries the route name and a per-run map-preview door',
    dspSrc.indexOf('dpPendingSheet.routeName') > -1 &&
    dspSrc.indexOf('id="dp_sheet_preview_') > -1 &&
    dspSrc.indexOf('Preview the ') > -1);
  check('the preview hand-off parks the staged read for one restage (and clears it on read)',
    dspSrc.indexOf("App._store.set('dp_pending_sheet'") > -1 &&
    dspSrc.indexOf("App._store.get('dp_pending_sheet', null)") > -1 &&
    dspSrc.indexOf("App._store.set('nav_route_preview'") > -1);
  check('Save hands the sheet’s name to the engine',
    dspSrc.indexOf('sec382, pend.routeName)') > -1);
  check('the route card carries preview doors and the fenced delete doors',
    dspSrc.indexOf('id="dp_route_preview_am"') > -1 &&
    dspSrc.indexOf('id="dp_route_del_am"') > -1 &&
    dspSrc.indexOf('id="dp_route_del_pm"') > -1 &&
    dspSrc.indexOf('id="dp_route_del_all"') > -1 &&
    dspSrc.indexOf('SplitShift.deleteRoute') > -1 &&
    dspSrc.indexOf('id="dp_del_keep"') > -1 && dspSrc.indexOf('id="dp_del_yes"') > -1);
  check('the touched Dispatch faces speak Evening, never Afternoon',
    dspSrc.indexOf('Evening run — ') > -1 &&
    dspSrc.indexOf('Evening route sheet') > -1 &&
    dspSrc.indexOf("['pm', 'Evening', '#dp_sheet_pm_note']") > -1 &&
    dspSrc.indexOf('Afternoon run') === -1 && dspSrc.indexOf('Afternoon route') === -1);
  check('the Navigator consumes the preview hand-off like the settings flag',
    navSrc.indexOf("App._store.get('nav_route_preview', null)") > -1 &&
    navSrc.indexOf('routePreviewSpec = rpvFlag') > -1);
  check('the Navigator preview panel + numbered in-order pins + chain stand in the source',
    navSrc.indexOf('id="nv_rpv"') > -1 && navSrc.indexOf('id="nv_rpv_list"') > -1 &&
    navSrc.indexOf('id="nv_rp_preview"') > -1 &&
    navSrc.indexOf('function drawRouteOnMap') > -1 &&
    navSrc.indexOf('L.divIcon') > -1 && navSrc.indexOf('L.polyline') > -1 &&
    navSrc.indexOf('function openRoutePreview') > -1);
  check('the plan card names the route, the evening run, and the current stop’s kids',
    navSrc.indexOf("'Evening run'") > -1 &&
    navSrc.indexOf('rp.routeName') > -1 &&
    navSrc.indexOf('curBits') > -1 &&
    navSrc.indexOf('paintRouteChain(rp)') > -1);
  check('the staged preview geocodes for the view only — the Navigator never writes the route',
    navSrc.indexOf('SplitShift.setRouteSheet') === -1 &&
    navSrc.indexOf('SplitShift.deleteRoute') === -1);
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

  /* ---------- (P) the sheet names its route ---------- */
  console.log('(P) the route’s name, read off the sheet itself');
  eq('the fixture’s header names the route', R.routeNameOf(fullText), 'CBE-0574');
  eq('a sheet with no route id names nothing (the plain-words fallback)',
    R.routeNameOf('AM Shift\n07:00 AM Alpha Place, Calgary\n07:10 AM Beta Place, Calgary'), '');
  eq('no text, no name', R.routeNameOf(''), '');

  /* ---------- (G) glue worlds ---------- */
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
  const AM_NAMES = stopsAm.map(function (s) { return s.name; });
  const PM_NAMES = stopsPm.map(function (s) { return s.name; });
  const bookAll = {};
  AM_NAMES.concat(PM_NAMES).forEach(function (n, i) {
    bookAll[n] = { latitude: 51.090 + i * 0.004, longitude: -114.120 + i * 0.006 };
  });

  console.log('(G) world 1 — the name, the kids by name, the preview, the deletes');
  const data1 = { onboarding: { workPattern: 'split' }, sessions: [] };
  const book1 = Object.assign({}, bookAll);
  book1[AM_NAMES[1]] = null;                      // the geocoder cannot place Cameron Ave
  const g1 = makeGlue(data1, book1);
  eq('the file door’s save fills both routes', [
    g1.SS.setRouteSheet('am', runs.am, secAm, R.routeNameOf(fullText)),
    g1.SS.setRouteSheet('pm', runs.pm, secPm, R.routeNameOf(fullText))], [8, 8]);
  await flush(80);
  eq('the route stands under its sheet name',
    g1.SS.routeSheetInfo(), { am: 8, pm: 8, name: 'Route CBE-0574' });
  const rp1 = g1.SS.routePlan();
  eq('the plan carries the route name', rp1.routeName, 'Route CBE-0574');
  eq('the plan’s stops carry the sheet’s kids by name, stop for stop',
    rp1.stops.map(function (s) { return { up: s.up, down: s.down }; }),
    rosterAm.map(function (r) { return { up: r.up, down: r.down }; }));
  check('the first pickup’s kid is the sheet’s own first student',
    /Sabuktigin/.test(rp1.stops[0].up[0] || ''));

  const pv1 = g1.SS.routePreview('am');
  eq('the preview stands under the route’s name', [pv1.block, pv1.name], ['am', 'Route CBE-0574']);
  eq('the preview lists all 8 AM stops in sheet order',
    pv1.stops.map(function (s) { return s.name; }), AM_NAMES);
  check('every preview stop carries its sheet time',
    pv1.stops.every(function (s) { return !!s.time; }));
  eq('the preview’s kids match the roster, stop for stop',
    pv1.stops.map(function (s) { return { up: s.up, down: s.down }; }),
    rosterAm.map(function (r) { return { up: r.up, down: r.down }; }));
  eq('the preview pins the placed stops and passes the unplaced one by name',
    pv1.stops.map(function (s) { return s.placed; }),
    [true, false, true, true, true, true, true, true]);
  eq('a placed preview stop carries its point',
    [pv1.stops[0].lat, pv1.stops[0].lng], [bookAll[AM_NAMES[0]].latitude, bookAll[AM_NAMES[0]].longitude]);
  const pvPm = g1.SS.routePreview('pm');
  eq('the evening preview lists its 8 stops in sheet order, kids riding',
    [pvPm.stops.length, pvPm.stops[0].up.length, pvPm.stops[6].up.length], [8, 5, 1]);

  const snapBeforePreview = JSON.stringify(data1);
  g1.SS.routePreview('am'); g1.SS.routePreview('pm'); g1.SS.routePreview('am');
  eq('the preview performs ZERO writes', JSON.stringify(data1), snapBeforePreview);

  /* the absent overlay: a kid marked absent today leaves the
     names the plan + preview speak (Manifest owns the marks) */
  check('an absent mark lands', g1.SS.toggleAbsent('sheet:am:0:up:0') === true);
  eq('the absent kid leaves the plan’s first-stop names',
    g1.SS.routePlan().stops[0].up, []);
  eq('the absent kid leaves the preview’s first-stop names',
    g1.SS.routePreview('am').stops[0].up, []);
  g1.SS.toggleAbsent('sheet:am:0:up:0');

  /* persistence: a fresh world over the same store */
  const g1b = makeGlue(data1, book1);
  eq('the name survives a relaunch, whole',
    g1b.SS.routeSheetInfo(), { am: 8, pm: 8, name: 'Route CBE-0574' });

  /* per-run delete: the evening run goes, the morning stands */
  eq('deleting the evening run reports what stood', g1.SS.deleteRoute('pm'), { am: 0, pm: 8 });
  eq('after the evening delete: the morning stands, still under the route’s name',
    g1.SS.routeSheetInfo(), { am: 8, pm: 0, name: 'Route CBE-0574' });
  eq('no evening preview stands any more', g1.SS.routePreview('pm'), null);
  eq('no kid counting stands against the deleted run',
    g1.SS.kidCounts().pm, { expectedUp: 0, expectedDown: 0, absent: 0, boarded: 0, alighted: 0 });
  check('the plan still walks the morning run', !!g1.SS.routePlan() && g1.SS.routePlan().block === 'am');

  /* whole-route delete: the day opens clean */
  g1.SS.deleteRoute('all');
  eq('after the whole delete: nothing stands, no name',
    g1.SS.routeSheetInfo(), { am: 0, pm: 0, name: '' });
  eq('no plan walks', g1.SS.routePlan(), null);
  eq('no preview stands', g1.SS.routePreview('am'), null);
  eq('no kid counting stands at all', g1.SS.kidCounts(),
    { am: { expectedUp: 0, expectedDown: 0, absent: 0, boarded: 0, alighted: 0 },
      pm: { expectedUp: 0, expectedDown: 0, absent: 0, boarded: 0, alighted: 0 } });

  /* the cover case: next week she covers another route */
  eq('a fresh route loads after the delete, exactly as before', [
    g1.SS.setRouteSheet('am', runs.am, secAm, R.routeNameOf(fullText)),
    g1.SS.setRouteSheet('pm', runs.pm, secPm, R.routeNameOf(fullText))], [8, 8]);
  await flush(80);
  eq('the fresh route stands under its name',
    g1.SS.routeSheetInfo(), { am: 8, pm: 8, name: 'Route CBE-0574' });

  /* a nameless sheet: the name stays empty, the runs stand */
  const dataN = { onboarding: { workPattern: 'split' }, sessions: [] };
  const gN = makeGlue(dataN, bookAll);
  gN.SS.setRouteSheet('am', runs.am, secAm, '');
  eq('a nameless save leaves the name empty (plain-words fallback)',
    gN.SS.routeSheetInfo().name, '');
  eq('the nameless preview carries no name', gN.SS.routePreview('am').name, '');

  /* ---------- (G) world 2 — history is not rewritten ---------- */
  console.log('(G) world 2 — deleting the route never touches the days already run');
  const nowD = new Date();
  const todayStr = nowD.getFullYear() + '-' + ('0' + (nowD.getMonth() + 1)).slice(-2) +
    '-' + ('0' + nowD.getDate()).slice(-2);
  const closedSession = { id: 's-yesterday', state: 'closed', date: '2026-11-07',
    splitStops: [{ key: 'sheet:am:5', name: AM_NAMES[5], at: 1762431000000, kids: { up: 0, down: 5, absent: 0 } }] };
  const data2 = { onboarding: { workPattern: 'split' }, sessions: [closedSession] };
  const g2 = makeGlue(data2, bookAll);
  g2.SS.setRouteSheet('am', runs.am, secAm, 'CBE-0574');
  await flush(60);
  /* seed today's own recorded stop into the record the way a
     driven morning would have left it */
  data2.splitshift.dayStops = [{ key: 'sheet:am:0', name: AM_NAMES[0], at: 1762525200000,
    up: 1, down: 0, absent: 0, eta: -3, split: 'am' }];
  data2.splitshift.dayStopsDate = todayStr;
  const sessionsBefore = JSON.stringify(data2.sessions);
  const g2b = makeGlue(data2, bookAll);
  eq('setup: today’s recorded stop stands in the day record', g2b.SS.dayStops().length, 1);
  g2b.SS.deleteRoute('all');
  eq('the closed session record is byte-identical after the delete',
    JSON.stringify(data2.sessions), sessionsBefore);
  eq('today’s recorded stop still stands in the day record', g2b.SS.dayStops().length, 1);
  eq('and the route itself is gone', g2b.SS.routeSheetInfo(), { am: 0, pm: 0, name: '' });
  check('the day record still names the stop she actually ran, at its recorded time',
    g2b.SS.dayStops().some(function (r) { return r.name === AM_NAMES[0] && r.at === 1762525200000; }));

  /* ---------- (D) real Dispatch renders ---------- */
  console.log('(D) Dispatch — confirmation names, preview hand-off, standing faces, delete doors');
  const bundledNet = function () {
    return { srcs: [], allow: function (u) { return u.indexOf('js/vendor/') > -1; },
      lib: function () { return fakePdfLib(pagesItems); } };
  };
  function upload(w, file) {
    const inp = w.body.querySelector('#dp_sheet_file_in');
    inp.files = [file];
    inp.onchange();
    return flush(140);
  }
  function fixtureFile() {
    return fakeFile('route-CBE-0574_261108_162530_13_2dof.pdf', 'application/pdf', pdfBytes);
  }
  function card(w) { return w.body.querySelector('#dp_sheet_card'); }

  const w = makeWorld({ net: bundledNet() });
  w.render();
  await upload(w, fixtureFile());
  const hCard = card(w)._html;
  check('the confirmation carries the route’s name', hCard.indexOf('Check this route sheet — Route CBE-0574') > -1);
  check('the runs are labelled Morning and Evening, with stops and kids',
    hCard.indexOf('Morning route — 8 stops · 6 kids') > -1 &&
    hCard.indexOf('Evening route — 8 stops · 6 kids') > -1);
  check('the first stop names its kid', hCard.indexOf('🧒 On: ' + rosterAm[0].up.join(', ')) > -1);
  check('Wildwood names the five kids it sets down', hCard.indexOf('🧒 Off: ' + rosterAm[5].down.join(', ')) > -1);
  check('the evening Wildwood names the five kids it boards', hCard.indexOf('🧒 On: ' + rosterPm[0].up.join(', ')) > -1);
  check('no “Afternoon” stands anywhere on the card', hCard.indexOf('Afternoon') === -1);
  check('each run offers its whole-trip preview before Save',
    hCard.indexOf('id="dp_sheet_preview_am"') > -1 && hCard.indexOf('id="dp_sheet_preview_pm"') > -1);

  /* the preview hand-off from the confirmation */
  card(w).querySelector('#dp_sheet_preview_am').onclick();
  const hand = w.sb.store.get('nav_route_preview', null);
  check('the hand-off opens the Navigator', w.opened.indexOf('navigator') > -1);
  eq('the hand-off carries the staged morning run, by name',
    [hand && hand.block, hand && hand.staged && hand.staged.name], ['am', 'Route CBE-0574']);
  eq('the staged preview lists all 8 stops in sheet order',
    (hand.staged.stops || []).map(function (s) { return s.name; }), AM_NAMES);
  eq('the staged preview carries the roster’s kids',
    (hand.staged.kids || []).map(function (k) { return { up: k.up, down: k.down }; }),
    rosterAm.map(function (r) { return { up: r.up, down: r.down }; }));
  check('the staged read is parked for the return', !!w.sb.store.get('dp_pending_sheet', null));
  eq('and STILL nothing is saved', w.sb.SplitShift.routeSheetInfo(), { am: 0, pm: 0, name: '' });

  /* the return: the same confirmation re-stages, once */
  w.render();
  await flush(40);
  check('the return re-stages the same confirmation', card(w)._html.indexOf('Check this route sheet') > -1);
  eq('the park was consumed', w.sb.store.get('dp_pending_sheet', null), null);
  w.render();
  await flush(40);
  check('a second plain repaint does not resurrect it (the web-385 lifetime law stands)',
    w.body._html.indexOf('Check this route sheet') === -1);

  /* stage once more and Save — the route lands under its name */
  await upload(w, fixtureFile());
  card(w).querySelector('#dp_sheet_confirm').onclick();
  await flush(140);
  eq('after Save: both routes stand under the sheet’s name',
    w.sb.SplitShift.routeSheetInfo(), { am: 8, pm: 8, name: 'Route CBE-0574' });
  eq('the file note speaks the evening words',
    w.body.querySelector('#dp_sheet_file_note').textContent,
    'Both routes saved — Morning 8 stops, evening 8 stops, in order. The day’s route follows this sheet.');

  /* the standing faces */
  w.render();
  await flush(40);
  const hBody = w.body._html;
  check('the standing dispatch speaks the route’s name and both runs',
    hBody.indexOf('Your route is today’s dispatch') > -1 &&
    hBody.indexOf('Route CBE-0574 · Morning run — 8 stops · Evening run — 8 stops') > -1);
  check('the standing face never says Afternoon', hBody.indexOf('Afternoon') === -1);
  check('the route card names the route on file and offers both previews',
    hBody.indexOf('The route on file — Route CBE-0574') > -1 &&
    hBody.indexOf('id="dp_route_preview_am"') > -1 && hBody.indexOf('id="dp_route_preview_pm"') > -1);
  check('the delete doors stand fenced below, one per run and one for the whole route',
    hBody.indexOf('Delete the route') > -1 &&
    hBody.indexOf('id="dp_route_del_am"') > -1 && hBody.indexOf('id="dp_route_del_pm"') > -1 &&
    hBody.indexOf('id="dp_route_del_all"') > -1 &&
    hBody.indexOf('id="dp_route_del_all"') > hBody.indexOf('id="dp_route_preview_am"'));

  /* the saved-route preview door */
  w.body.querySelector('#dp_route_preview_pm').onclick();
  eq('the saved-route preview hands the Navigator the evening run',
    w.sb.store.get('nav_route_preview', null), { block: 'pm' });

  /* delete, staged: the tap alone deletes nothing */
  w.body.querySelector('#dp_route_del_pm').onclick();
  await flush(20);
  const hDel = card(w)._html;
  check('the delete asks first, and says what happens',
    hDel.indexOf('Delete the evening route?') > -1 &&
    hDel.indexOf('stops standing as your dispatch') > -1 &&
    hDel.indexOf('stay in your records') > -1);
  eq('the tap alone deleted nothing', w.sb.SplitShift.routeSheetInfo(), { am: 8, pm: 8, name: 'Route CBE-0574' });
  card(w).querySelector('#dp_del_keep').onclick();
  await flush(20);
  eq('Keep it: the route stands untouched', w.sb.SplitShift.routeSheetInfo(), { am: 8, pm: 8, name: 'Route CBE-0574' });
  eq('Keep it: the note says so', w.body.querySelector('#dp_sheet_file_note').textContent,
    'Nothing was changed — the route still stands.');

  /* delete the evening run for real */
  w.body.querySelector('#dp_route_del_pm').onclick();
  await flush(20);
  card(w).querySelector('#dp_del_yes').onclick();
  await flush(20);
  eq('the evening run is deleted; the morning stands under the name',
    w.sb.SplitShift.routeSheetInfo(), { am: 8, pm: 0, name: 'Route CBE-0574' });
  eq('the note speaks the delete', w.body.querySelector('#dp_sheet_file_note').textContent,
    'Evening route deleted. It no longer stands as your dispatch.');
  check('the standing dispatch now names the morning run only',
    w.body._html.indexOf('Morning run — 8 stops') > -1 && w.body._html.indexOf('Evening run') === -1);

  /* delete the last standing run (only the per-run door remains) */
  w.body.querySelector('#dp_route_del_am').onclick();
  await flush(20);
  card(w).querySelector('#dp_del_yes').onclick();
  await flush(20);
  eq('the last run’s delete clears the route and its name',
    w.sb.SplitShift.routeSheetInfo(), { am: 0, pm: 0, name: '' });
  check('no standing dispatch stands any more', w.body._html.indexOf('Your route is today’s dispatch') === -1);
  check('no route-on-file doors stand any more', w.body._html.indexOf('dp_route_del_am') === -1);

  /* and a different route loads afterwards, exactly as before */
  await upload(w, fixtureFile());
  card(w).querySelector('#dp_sheet_confirm').onclick();
  await flush(140);
  eq('after the delete, a fresh upload saves whole again',
    w.sb.SplitShift.routeSheetInfo(), { am: 8, pm: 8, name: 'Route CBE-0574' });

  /* the whole-route door itself */
  w.render();
  await flush(40);
  w.body.querySelector('#dp_route_del_all').onclick();
  await flush(20);
  check('the whole-route confirm names both runs',
    card(w)._html.indexOf('Delete the whole route?') > -1 &&
    card(w)._html.indexOf('Morning 8 stops · Evening 8 stops') > -1);
  card(w).querySelector('#dp_del_yes').onclick();
  await flush(20);
  eq('the whole route is deleted at once', w.sb.SplitShift.routeSheetInfo(), { am: 0, pm: 0, name: '' });
  eq('the note speaks the whole delete', w.body.querySelector('#dp_sheet_file_note').textContent,
    'The route was deleted. It no longer stands as your dispatch.');

  /* the nameless sheet: plain words, no invented name */
  console.log('(D) the nameless sheet falls back to the plain words');
  const wN = makeWorld({ net: bundledNet() });
  wN.sb.pdfjsLib = fakePdfLib(pagesItems);
  wN.sb.TicketOCR.recognizeWithRotation = function () {
    return Promise.resolve('AM Shift\n07:00 AM Alpha Place, Calgary\n07:10 AM Beta Place, Calgary\nPM Shift\n02:00 PM Beta Place, Calgary\n02:10 PM Alpha Place, Calgary');
  };
  wN.render();
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4, 5, 6, 7, 8]);
  await upload(wN, fakeFile('sheet.png', 'image/png', pngBytes));
  const hN = card(wN)._html;
  check('the nameless confirmation invents no route name',
    hN.indexOf('Check this route sheet') > -1 && hN.indexOf('Route CBE') === -1 && hN.indexOf('— Route ') === -1);
  check('its runs stand under the plain words',
    hN.indexOf('Morning route — 2 stops') > -1 && hN.indexOf('Evening route — 2 stops') > -1);
  card(wN).querySelector('#dp_sheet_confirm').onclick();
  await flush(140);
  eq('the nameless route saves with no name', wN.sb.SplitShift.routeSheetInfo(), { am: 2, pm: 2, name: '' });
  wN.render();
  await flush(40);
  check('its standing dispatch carries no route name',
    wN.body._html.indexOf('Morning run — 2 stops · Evening run — 2 stops') > -1);

  console.log('\nROUTE-STOP-KID-NAMES-TRIP-PREVIEW NOV8: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
})().catch(function (e) { console.error('SUITE ERROR', e); process.exit(2); });
