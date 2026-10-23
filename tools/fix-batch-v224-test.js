#!/usr/bin/env node
/* Meticulous v224 — the four v38 IN-HANDS failures (Oct 22 afternoon),
 * REPRODUCTION-FIRST by order: every part builds the failing FIELD
 * sequence and must go RED on the shipped code before any fix counts.
 *   1 LIVE-MILES-RESTORE-V38-FAIL — v37/v38 installs reset the hero
 *      to ~0.3 km over a 138.5 km cloud day. Part A runs the REAL
 *      js/miles.js + js/geoloads.js + js/cloudsync.js in one world
 *      over an empty/partial local store with the cloud record
 *      served by a stub FB, driving app.js's OWN boot + onAuth
 *      re-attach sequence (copied verbatim). The v222 suite modeled
 *      the pull as a raw store overwrite — the real pull MERGE (with
 *      its timestamp conflict rule) is the seam under test here.
 *   2 WIDGET-ADD-FAIL-OCT22 — the launcher refuses the v38 widget
 *      ("Couldn't add widget"). Part B validates the widget the way
 *      a launcher does: every layout class must be in Android's
 *      RemoteViews whitelist, every referenced resource must exist,
 *      and the provider/receiver declarations must agree.
 *   3 NAV-NO-MOVEMENT-V38 — Part C: the field sequence (drive opened
 *      from a dispatch Navigate, the module watch delivering real
 *      timestamped fixes then dying, the app stream live) plus the
 *      clock-skew layer (app-stream fix times behind the watermark
 *      the watch fixes stamped — device clock vs fix clock).
 *   4 BUBBLE-FACE-WRONG-OCT22 — Part D: the PiP seam end to end:
 *      manifest configChanges (PiP contract), the native pre-entry
 *      swap order, and the web face itself (extracted live from
 *      js/app.js) showing ONLY the spec elements.
 * Run: node tools/fix-batch-v224-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NROOT = path.resolve(ROOT, '..', 'meticulous-native');
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function readN(p) { return fs.readFileSync(path.join(NROOT, p), 'utf8'); }
function flush(ms) { return new Promise(function (r) { setTimeout(r, ms || 5); }); }

/* ==================================================================
 * Part A — LIVE-MILES-RESTORE-V38-FAIL (item 1)
 * One vm world: real miles + geoloads + cloudsync, a localStorage
 * shim, the app.js store shape, a stub FB serving the cloud fixture,
 * and a mini-App whose init/onAuth bodies are app.js's own lines.
 * ================================================================== */
console.log('— Part A: miles restore through the REAL pull merge (item 1) —');
const milesSrc = read('js/miles.js');
const geoloadsSrc = read('js/geoloads.js');
const cloudsyncSrc = read('js/cloudsync.js');

function mkSyncWorld(opts) {
  // opts: { local: {fullKey: rawString}, cloudDocs: [{id, v, ts}], now }
  let fakeNow = opts.now;
  class FakeDate extends Date {
    constructor() { super(fakeNow); }
    static now() { return fakeNow; }
  }
  const backing = {};
  Object.keys(opts.local || {}).forEach(function (k) { backing[k] = opts.local[k]; });
  const localStorage = {
    getItem: function (k) { return backing[k] === undefined ? null : backing[k]; },
    setItem: function (k, v) { backing[k] = String(v); },
    removeItem: function (k) { delete backing[k]; },
    key: function (i) { return Object.keys(backing)[i] || null; },
    get length() { return Object.keys(backing).length; }
  };
  /* the app.js store, same semantics (non-family keys pass through) */
  const store = {
    physKey: function (k) { return k; },
    get: function (k, d) {
      try { const v = localStorage.getItem('mt_' + k); return v === null ? d : JSON.parse(v); }
      catch (e) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem('mt_' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem('mt_' + k); return true; } catch (e) { return false; } }
  };
  const els = {};
  function fakeEl(id) {
    if (!els[id]) {
      const classes = new Set(['hidden']);
      els[id] = { id: id, textContent: '', innerHTML: '',
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
    last: function () { return geo._last || null; },
    deliver: function (fix) { geo._last = fix; if (geo._cb) geo._cb(fix); } };
  const pushed = {};   // docId -> last {v} the stub FB received
  const FB = { ready: true, user: { uid: 'u-test', email: 'driver@test' },
    loadDocs: function () {
      return Promise.resolve((opts.cloudDocs || []).map(function (d) {
        return { id: d.id, v: d.v, updatedAt: { toMillis: function () { return d.ts; } } };
      }));
    },
    saveDoc: function (col, id, data) { pushed[id] = data; return Promise.resolve({}); },
    deleteDoc: function () { return Promise.resolve(); } };
  const App = { _store: store, geo: geo, user: null,
    tracker: { status: 'idle', startTs: 0, elapsed: 0 },
    _authLocked: function () { return false; } };
  const sb = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: setInterval, clearInterval: clearInterval,
    Promise: Promise, JSON: JSON, Math: Math, Date: FakeDate,
    navigator: { onLine: true }, localStorage: localStorage,
    document: { visibilityState: 'visible', hidden: false,
      getElementById: function (id) { return id === 'syncDot' ? null : fakeEl(id); },
      addEventListener: function () {} },
    addEventListener: function () {},
    FB: FB, App: App };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(milesSrc, sb);
  vm.runInContext(geoloadsSrc, sb);
  vm.runInContext(cloudsyncSrc, sb);
  App.geo = geo;

  /* ---- app.js's own tracker-session helpers (verbatim) ---- */
  function trackerSave() { store.set('tracker', App.tracker); }
  function trackerSessionStartMs() {
    var t = App.tracker, now = Date.now();
    if (t.status === 'idle') return t.presetStart || now;
    var live = t.elapsed + (t.status === 'running' ? Math.floor((now - t.startTs) / 1000) : 0);
    return now - live * 1000;
  }
  function trackerSessionKeyMs() {
    var t = App.tracker;
    if (!t || t.status === 'idle') return trackerSessionStartMs();
    if (!t.sessionId) { t.sessionId = trackerSessionStartMs(); trackerSave(); }
    return t.sessionId;
  }
  /* ---- app.js init()'s reattach block (verbatim) ---- */
  function appInit() {
    App.tracker = store.get('tracker', { status: 'idle', startTs: 0, elapsed: 0 });
    if (App.tracker.status === 'running') {
      App.tracker.elapsed += Math.floor((Date.now() - App.tracker.startTs) / 1000);
      App.tracker.startTs = Date.now();
      trackerSave();
    }
    if (App.tracker.status === 'running' || App.tracker.status === 'paused') {
      try { if (sb.LiveMiles) sb.LiveMiles.startDay('s' + trackerSessionKeyMs(), { resume: true }); } catch (e) {}
      try { if (sb.GeoLoads) sb.GeoLoads.startDay('s' + trackerSessionKeyMs(), { resume: true }); } catch (e) {}
    }
  }
  /* ---- app.js App.onAuth's reattach block (verbatim lines) ---- */
  function appOnAuth(user) {
    App.user = user;
    try {
      App.tracker = store.get('tracker', App.tracker);
      if (App.tracker && (App.tracker.status === 'running' || App.tracker.status === 'paused')) {
        var rk2 = 's' + trackerSessionKeyMs();
        if (sb.LiveMiles && sb.LiveMiles.dayKey && sb.LiveMiles.dayKey() !== rk2) sb.LiveMiles.startDay(rk2, { resume: true });
        if (sb.GeoLoads && sb.GeoLoads.startDay) sb.GeoLoads.startDay(rk2, { resume: true });
        try { if (sb.LiveMiles && sb.LiveMiles.reseedFromStore) sb.LiveMiles.reseedFromStore(); } catch (e2) {}
        try { if (sb.GeoLoads && sb.GeoLoads.reseedFromStore) sb.GeoLoads.reseedFromStore(); } catch (e2) {}
        try {
          if (sb.CloudSync && sb.CloudSync.whenFirstPullDone) {
            sb.CloudSync.whenFirstPullDone(12000).then(function () {
              try {
                App.tracker = store.get('tracker', App.tracker);
                if (App.tracker && (App.tracker.status === 'running' || App.tracker.status === 'paused')) {
                  if (sb.LiveMiles && sb.LiveMiles.reseedFromStore) sb.LiveMiles.reseedFromStore();
                  if (sb.GeoLoads && sb.GeoLoads.reseedFromStore) sb.GeoLoads.reseedFromStore();
                }
              } catch (e3) {}
            }, function () {});
          }
        } catch (e2) {}
      }
    } catch (e) {}
    try { if (sb.CloudSync) sb.CloudSync.onAuth(user); } catch (e) {}
  }
  App.onAuth = appOnAuth; // app.js defines App.onAuth — the pull's re-drive calls it
  sb.CloudSync.attach(store);
  return { sb: sb, App: App, store: store, backing: backing, geo: geo, els: els,
    pushed: pushed, appInit: appInit, appOnAuth: appOnAuth,
    setNow: function (ms) { fakeNow = ms; }, now: function () { return fakeNow; } };
}
function mfix(lat, lng, t) { return { latitude: lat, longitude: lng, accuracy: 8, time: t }; }

let MORNING = null; // { livemilesRaw, totalM, T0, key }
async function buildMorning() {
  const T0 = 1792212000000; // session start (morning)
  const w = mkSyncWorld({ local: {}, cloudDocs: [], now: T0 });
  const KEY = 's' + T0;
  w.App.tracker = { status: 'running', startTs: T0, elapsed: 0, sessionId: T0 };
  w.store.set('tracker', w.App.tracker);
  ok(w.sb.LiveMiles.startDay(KEY, { resume: true }) === true, 'A0: the morning session engine starts');
  /* ~138.5 km: 1246 fixes x ~111.19 m (0.001 deg lat), 21.6 s apart */
  let lat = 51.0;
  for (let i = 0; i <= 1246; i++) {
    const t = T0 + i * 21600;
    w.setNow(t);
    w.geo.deliver(mfix(lat + i * 0.001, -114.07, t));
  }
  await flush();
  w.sb.LiveMiles.flush();
  const rec = JSON.parse(w.backing['mt_livemiles']);
  const day = rec.days[KEY];
  ok(day && day.totalM > 137000 && day.totalM < 140000, 'A0b: the morning record holds ~138.5 km', day && day.totalM);
  MORNING = { raw: w.backing['mt_livemiles'], totalM: day.totalM, T0: T0, key: KEY,
    tracker: { status: 'running', startTs: T0 + 27000000, elapsed: 27000, sessionId: T0 } };
}

async function partA1() {
  /* SEQ 1 — the mandated reproduction: FRESH/EMPTY local store;
   * the cloud holds the running tracker + the 138.5 km record.
   * Boot (nothing local) -> sign-in -> pull -> the hero must paint
   * 138.5 and keep counting from there; nothing may clobber. */
  const T0 = MORNING.T0, KEY = MORNING.key;
  const bootT = T0 + 8 * 3600000; // 16:00 — the reinstall moment
  const cloudDocs = [
    { id: 'tracker', v: MORNING.tracker, ts: T0 + 7.5 * 3600000 },
    { id: 'livemiles', v: JSON.parse(MORNING.raw), ts: T0 + 7.5 * 3600000 },
    { id: 'onboarding', v: { accountType: 'Driver' }, ts: T0 + 7 * 3600000 }
  ];
  const w = mkSyncWorld({ local: {}, cloudDocs: cloudDocs, now: bootT });
  w.appInit(); // local store empty -> tracker idle -> engines never start
  ok(!w.sb.LiveMiles.currentKm(), 'A1: fresh boot has no miles before sign-in (the field state)');
  w.appOnAuth({ uid: 'u-test', email: 'driver@test' });
  await flush(300); // pull + the pull's own App.onAuth re-drive + waiter reseeds
  const km = w.sb.LiveMiles.currentKm();
  ok(typeof km === 'number' && Math.abs(km * 1000 - MORNING.totalM) < 1500,
    'A2: after sign-in + pull the engine holds the cloud day (138.5 km)', km);
  w.sb.LiveMiles.paint();
  const pm = /([\d.]+) km/.exec(w.els.trkMiles.textContent || '');
  ok(pm && parseFloat(pm[1]) > 137, 'A3: the hero paints 138.5 km, not 0.3', w.els.trkMiles.textContent);
  /* the day continues FROM the restored total */
  for (let i = 1; i <= 5; i++) {
    w.setNow(bootT + i * 21600);
    w.geo.deliver(mfix(51.0 + 1246 * 0.001 + i * 0.001, -114.07, bootT + i * 21600));
  }
  await flush();
  const km2 = w.sb.LiveMiles.currentKm();
  ok(typeof km2 === 'number' && km2 * 1000 > MORNING.totalM + 400,
    'A4: post-restore fixes keep counting from the restored total', km2);
  /* NO CLOBBER: force the engine persist + the sync flush; the doc
   * that reaches the cloud must still carry the whole day. */
  w.sb.LiveMiles.flush();
  await flush(2700); // cloudsync's 2.5 s flush debounce
  const sent = w.pushed['livemiles'];
  ok(sent && sent.v && sent.v.days[KEY] && sent.v.days[KEY].totalM >= MORNING.totalM,
    'A5: the cloud record is never clobbered by the new install', sent && sent.v.days[KEY] && sent.v.days[KEY].totalM);
  const local = JSON.parse(w.backing['mt_livemiles']);
  ok(local.days[KEY] && local.days[KEY].totalM >= MORNING.totalM,
    'A6: the local record keeps the whole day too', local.days[KEY] && local.days[KEY].totalM);
}

async function partA2() {
  /* SEQ 2 — the stamp war (the v107 class, on the telemetry keys):
   * the tracker is already local (boot reattaches the engines
   * against an EMPTY livemiles store), the young engine persists a
   * 0.4 km snapshot stamped NOW, and only THEN does the first pull
   * land with the cloud's 138.5 km record stamped an hour older.
   * The merge must not let the young snapshot win, the reseed must
   * adopt the cloud day, and the flush must never push the young
   * record up over the cloud. */
  const T0 = MORNING.T0, KEY = MORNING.key;
  const bootT = T0 + 8 * 3600000;
  const cloudDocs = [
    { id: 'tracker', v: MORNING.tracker, ts: T0 + 7.5 * 3600000 },
    { id: 'livemiles', v: JSON.parse(MORNING.raw), ts: T0 + 7.5 * 3600000 },
    { id: 'geoloads', v: { days: { '2026-10-22': { date: '2026-10-22', count: 8, corr: 0, events: [], updatedAt: T0 + 7.5 * 3600000 } } }, ts: T0 + 7.5 * 3600000 },
    { id: 'onboarding', v: { accountType: 'Driver' }, ts: T0 + 7 * 3600000 }
  ];
  const local = { 'mt_tracker': JSON.stringify(MORNING.tracker),
    'mt_geoloads': JSON.stringify({ days: { '2026-10-22': { date: '2026-10-22', count: 0, corr: 0, events: [], updatedAt: bootT } } }),
    /* the young geoloads record was persisted through the real
       store during the boot (a startDay persist), which is exactly
       the meta stamp the attached store leaves behind: t = NOW. */
    'mt___syncmeta': JSON.stringify({ uid: null, keys: { geoloads: { t: bootT, s: 0, u: 'u-test' } } }) };
  const w = mkSyncWorld({ local: local, cloudDocs: cloudDocs, now: bootT });
  w.appInit(); // tracker local+running -> engines begin against the empty/young store
  for (let i = 1; i <= 4; i++) { // ~0.4 km of post-boot driving
    w.setNow(bootT + i * 10000);
    w.geo.deliver(mfix(51.05 + i * 0.001, -114.07, bootT + i * 10000));
  }
  await flush();
  w.sb.LiveMiles.flush(); // the young snapshot persists, stamped NOW
  const young = JSON.parse(w.backing['mt_livemiles']);
  ok(young.days[KEY] && young.days[KEY].totalM < 1000, 'A7: pre-pull the local record is the young 0.4 km snapshot', young.days[KEY] && young.days[KEY].totalM);
  w.appOnAuth({ uid: 'u-test', email: 'driver@test' });
  await flush(300);
  const km = w.sb.LiveMiles.currentKm();
  ok(typeof km === 'number' && km * 1000 >= MORNING.totalM - 1500,
    'A8: the pull does not lose the cloud day to the young snapshot — engine adopts 138.5 km', km);
  w.sb.LiveMiles.paint();
  const pm = /([\d.]+) km/.exec(w.els.trkMiles.textContent || '');
  ok(pm && parseFloat(pm[1]) > 137, 'A9: the hero paints the restored day after the stamp war', w.els.trkMiles.textContent);
  const geoRec = JSON.parse(w.backing['mt_geoloads']);
  ok(geoRec.days['2026-10-22'] && (geoRec.days['2026-10-22'].count + (geoRec.days['2026-10-22'].corr || 0)) >= 8,
    'A10: the load count survives the same stamp war (cloud 8 beats local young 0)', geoRec.days['2026-10-22'] && geoRec.days['2026-10-22'].count);
  w.sb.LiveMiles.flush();
  await flush(2700);
  const sent = w.pushed['livemiles'];
  ok(sent && sent.v && sent.v.days[KEY] && sent.v.days[KEY].totalM >= MORNING.totalM,
    'A11: the flush after the war pushes the FULL day up, never the young snapshot', sent && sent.v.days[KEY] && sent.v.days[KEY].totalM);
}

/* ==================================================================
 * Part B — WIDGET-ADD-FAIL-OCT22 (item 2): the launcher's checks.
 * Android inflates a widget's RemoteViews at ADD time; a layout
 * class outside the RemoteViews whitelist throws and the launcher
 * answers "Couldn't add widget". Validate the real files.
 * ================================================================== */
console.log('— Part B: widget add-path validation (item 2) —');
function partB() {
  const REMOTE_VIEWS_OK = {
    'LinearLayout': 1, 'RelativeLayout': 1, 'FrameLayout': 1, 'GridLayout': 1,
    'TextView': 1, 'Button': 1, 'ImageButton': 1, 'ImageView': 1, 'ProgressBar': 1,
    'Chronometer': 1, 'AnalogClock': 1, 'TextClock': 1, 'ViewFlipper': 1,
    'ListView': 1, 'GridView': 1, 'StackView': 1, 'AdapterViewFlipper': 1
  };
  const layoutRaw = readN('android/app/src/main/res/layout/widget_tracker.xml');
  const layout = layoutRaw.replace(/<!--[\s\S]*?-->/g, ''); // a real XML parser ignores comments; so does this scan
  const tags = [];
  const tagRe = /<([A-Za-z][A-Za-z0-9._]*)/g;
  let tm;
  while ((tm = tagRe.exec(layout)) !== null) { if (tm[1] !== 'layout') tags.push(tm[1]); }
  const bad = tags.filter(function (t) { return !REMOTE_VIEWS_OK[t]; });
  ok(tags.length >= 5, 'B1: the widget layout parsed (' + tags.length + ' views)');
  ok(bad.length === 0, 'B2: every layout class is RemoteViews-inflatable (a launcher can add it)', bad.join(','));
  /* every @drawable the layout names must exist */
  const drawRefs = [];
  const drRe = /@drawable\/([a-z0-9_]+)/g;
  let dm;
  while ((dm = drRe.exec(layout)) !== null) drawRefs.push(dm[1]);
  const missing = drawRefs.filter(function (d) {
    return !fs.existsSync(path.join(NROOT, 'android/app/src/main/res/drawable', d + '.xml')) &&
           !fs.existsSync(path.join(NROOT, 'android/app/src/main/res/drawable', d + '.png'));
  });
  ok(drawRefs.length >= 4 && missing.length === 0, 'B3: all layout drawables exist', missing.join(','));
  const info = readN('android/app/src/main/res/xml/widget_tracker_info.xml');
  ok(/android:initialLayout="@layout\/widget_tracker"/.test(info), 'B4: the provider declares the initial layout');
  ok(/android:targetCellWidth="2"/.test(info) && /android:targetCellHeight="2"/.test(info), 'B5: the default tile is a tight 2x2');
  ok(/android:resizeMode="horizontal\|vertical"/.test(info), 'B6: the owner can resize it both ways');
  const mw = /android:minWidth="(\d+)dp"/.exec(info), mh = /android:minHeight="(\d+)dp"/.exec(info);
  /* v227 (WIDGET-COMPACT-SIZES — supersedes the v38 floor this
     pin asserted): the owner's Oct 22 17:38 ask is that the
     widget LIVE at 1x1 and 2x1, so the floor is one cell now;
     the 2x2 default home above (B5) is unchanged. The compact
     faces themselves are pinned in drive-surface-v227-test.js. */
  ok(mw && mh && +mw[1] <= 80 && +mh[1] <= 80,
    'B7: min sizes reach the 1x1 floor (v227 compact sizes; the 2x2 sits in targetCell, B5)', info.replace(/\s+/g, ' ').slice(0, 120));
  const man = readN('android/app/src/main/AndroidManifest.xml');
  ok(/<receiver[^>]*\.TrackerWidget/.test(man) && /APPWIDGET_UPDATE/.test(man) &&
     /android\.appwidget\.provider/.test(man) && /widget_tracker_info/.test(man),
    'B8: the manifest receiver + provider meta-data agree');
  const prov = readN('android/app/src/main/java/com/meticuloustechnologies/app/TrackerWidget.java');
  ok(/extends AppWidgetProvider/.test(prov) && /RemoteViews/.test(prov), 'B9: the provider class builds RemoteViews');
}

/* ==================================================================
 * Part C — NAV-NO-MOVEMENT-V38 (item 3): the FIELD sequence.
 * The drive is opened from a dispatch Navigate (nav_pending), the
 * module seeds from the app stream's last fix, its own watch
 * delivers real timestamped fixes while foregrounded and then dies
 * silently (backgrounding), and the app stream (LiveMiles) keeps
 * flowing. Layer 2 adds the named clock hazard: the app stream's
 * fix times run BEHIND the timestamps the watch stamped (fix clock
 * vs device clock) — the rendered position must still advance.
 * ================================================================== */
console.log('— Part C: Navigator, the field sequence (item 3) —');
const navSrc = read('modules/navigator.js');
const navFixture = JSON.parse(read('tools/navigator-fixture-tripb.json'));
const C_ORIGIN = [51.0955, -114.099], C_DEST = [51.1075, -114.0845];
function cEl() {
  const e = { children: {}, style: {}, _html: '', _htmlSets: 0, value: '', onclick: null,
    _text: '', _attrs: {}, _listeners: {}, _kids: [], _parent: null,
    addEventListener: function (ev, fn) { (e._listeners[ev] = e._listeners[ev] || []).push(fn); },
    appendChild: function (c) { e._kids.push(c); c._parent = e; return c; },
    classList: { _s: new Set(),
      add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); },
      toggle: function (c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { on ? this._s.add(c) : this._s.delete(c); } },
      contains: function (c) { return this._s.has(c); } },
    querySelector: function (sel) { return e.children[sel] || null; },
    querySelectorAll: function () { return []; },
    getAttribute: function () { return null; },
    setAttribute: function (n, v) { e._attrs[n] = String(v); } };
  Object.defineProperty(e, 'textContent', { configurable: true,
    get: function () { return e._text; }, set: function (v) { e._text = String(v); } });
  Object.defineProperty(e, 'innerHTML', { configurable: true,
    get: function () { return e._html; }, set: function (v) { e._htmlSets++; e._html = String(v); } });
  return e;
}
function mkNavWorld2() {
  let fakeNow = 1792300000000;
  class FakeDate extends Date {
    constructor() { super(fakeNow); }
    static now() { return fakeNow; }
  }
  const storeData = { navigator: { serverUrl: 'http://nav.test', profile: {}, muted: false, mode: 'truck' },
    nav_pending: { lat: C_DEST[0], lng: C_DEST[1], name: '12th Street' } };
  const store = { get: function (k, d) { return storeData[k] !== undefined ? storeData[k] : d; },
    set: function (k, v) { storeData[k] = v; }, del: function (k) { delete storeData[k]; } };
  const ids = ['nv_banner', 'nv_map', 'nv_mode_truck', 'nv_mode_car', 'nv_follow', 'nv_mute',
    'nv_q', 'nv_search', 'nv_results', 'nv_destnote', 'nv_route', 'nv_end', 'nv_note', 'nv_steps',
    'nv_pq', 'nv_presults', 'nv_back', 'nv_drive', 'nv_drive_screen', 'nv_drive_map',
    'nvd_dist', 'nvd_inst', 'nvd_road', 'nvd_eta_main', 'nvd_eta_sub', 'nvd_reroute', 'nvd_plane',
    'nvd_pip_line', 'nvd_mute', 'nvd_exit', 'nvd_you', 'nvd_avatar_picker'];
  const reg = {};
  ids.forEach(function (id) { reg[id] = cEl(); });
  reg.nv_banner.children['.nv-banner-main'] = cEl();
  reg.nv_banner.children['.nv-banner-sub'] = cEl();
  const dock = cEl(); dock.id = 'pipDock';
  const body = cEl();
  body.querySelector = function (sel) { return reg[sel.slice(1)] || null; };
  const calls = { spoken: [], markerSets: [], youSets: [], panTos: [], views: [], dashboards: 0, opens: [] };
  const mapHandlers = {};
  function makeMapStub() {
    const m = { _center: null, _zoom: 15,
      setView: function (c, z) { calls.views.push([c, z]); m._center = c; if (z) m._zoom = z; return m; },
      panTo: function (c) { calls.panTos.push(c); m._center = c; return m; },
      getCenter: function () { return m._center ? { lat: m._center[0], lng: m._center[1] } : null; },
      getZoom: function () { return m._zoom; },
      on: function (ev, fn) { mapHandlers[ev] = fn; },
      addLayer: function () { return m; }, removeLayer: function () { return m; },
      remove: function () {}, fitBounds: function () {}, invalidateSize: function () {} };
    return m;
  }
  const L = {
    map: function () { return makeMapStub(); },
    tileLayer: function () { return { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return this; }, on: function () {} }; },
    marker: function (ll) { const mk = { _ll: ll, addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return mk; },
      setLatLng: function (nll) { mk._ll = nll; calls.markerSets.push(nll); } }; return mk; },
    circleMarker: function () { const cm = { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return cm; }, setLatLng: function (nll) { calls.youSets.push(nll); } }; return cm; },
    polyline: function () { const pl = { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return pl; }, setLatLngs: function () {}, getBounds: function () { return {}; } }; return pl; },
    layerGroup: function (kids) { const g = { _kids: kids, getLayers: function () { return g._kids.slice(); }, addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return g; } }; return g; }
  };
  const watchCbs = []; let watchSeq = 0;
  const intervals = {}; let intSeq = 0;
  let milesFn = null; let geoLast = null;
  const world = {
    console: console, JSON: JSON, Math: Math, Date: FakeDate, setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: function (fn) { const id = ++intSeq; intervals[id] = fn; return id; },
    clearInterval: function (id) { delete intervals[id]; },
    window: null,
    document: { hidden: false,
      addEventListener: function () {}, removeEventListener: function () {},
      createElement: function () { return { href: '', style: {}, click: function () {}, remove: function () {} }; },
      body: { appendChild: function () {}, classList: { add: function () {}, remove: function () {} } },
      getElementById: function (id) { return id === 'pipDock' ? dock : (reg[id] || null); } },
    open: function () {},
    App: { _esc: function (s) { return String(s == null ? '' : s); }, _store: store,
      _today: function () { return '2026-10-22'; },
      openModule: function (k) { calls.opens.push(k); },
      showDashboard: function () { calls.dashboards++; } },
    Meticulous: {}, L: L,
    LiveMiles: { available: function () { return true; },
      subscribe: function (fn) { milesFn = fn; return function () {}; } },
    MeticulousGeo: { last: function () { return geoLast; } },
    navigator: { geolocation: {
      watchPosition: function (cb) { watchCbs.push(cb); return ++watchSeq; },
      clearWatch: function () {} } },
    speechSynthesis: { cancel: function () {}, speak: function (u) { calls.spoken.push(u.text); } },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    fetch: function (url) {
      if (url.indexOf('/route') >= 0) return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(navFixture); } });
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); } });
    }
  };
  world.window = world;
  vm.createContext(world);
  vm.runInContext(navSrc, world);
  return { api: world.Meticulous.modules.navigator, reg: reg, body: body, dock: dock, calls: calls,
    mapHandlers: mapHandlers, watchCbs: watchCbs, intervals: intervals,
    fireWatch: function (la, lo, hd, sp, ts) { const cb = watchCbs[watchCbs.length - 1];
      if (cb) cb({ coords: { latitude: la, longitude: lo, heading: hd, speed: sp }, timestamp: ts }); },
    feedMiles: function (fix) { geoLast = fix; if (milesFn) milesFn(fix); },
    setGeoLast: function (f) { geoLast = f; },
    advance: function (ms) { fakeNow += ms; },
    now: function () { return fakeNow; },
    pumpIntervals: function () { Object.keys(intervals).forEach(function (id) { try { intervals[id](); } catch (e) {} }); } };
}
function ctick() { return new Promise(function (r) { setTimeout(r, 15); }); }
function lastPan(w) { return w.calls.panTos[w.calls.panTos.length - 1]; }
function near(pos, la, lo) { return pos && Math.abs(pos[0] - la) < 1e-9 && Math.abs(pos[1] - lo) < 1e-9; }

async function partC() {
  /* ---- Layer 1: the field sequence, one clock ---- */
  const w = mkNavWorld2();
  const T0 = w.now();
  w.setGeoLast({ latitude: C_ORIGIN[0], longitude: C_ORIGIN[1], bearing: 40, speed: 0, time: T0 - 60000 });
  w.api.render(w.body);
  await ctick(); await ctick(); await ctick();
  ok(!w.reg.nv_drive_screen.classList.contains('hidden'),
    'C1: the drive opens BY ITSELF from a dispatch Navigate (nav_pending go-now)');
  ok(w.watchCbs.length >= 1, 'C2: the drive registers its GPS watch');
  /* the watch works while foregrounded — real timestamped fixes */
  w.fireWatch(51.0975, -114.0965, 40, 8, T0 + 5000);
  w.fireWatch(51.0985, -114.0955, 40, 8, T0 + 10000);
  ok(near(lastPan(w), 51.0985, -114.0955), 'C3: foregrounded, the module watch moves the drive view');
  /* the watch dies silently (backgrounding). The app stream lives. */
  const pansAtDeath = w.calls.panTos.length;
  w.feedMiles({ latitude: 51.1000, longitude: -114.0920, accuracy: 8, speed: 8, bearing: 40, time: T0 + 15000 });
  w.feedMiles({ latitude: 51.1015, longitude: -114.0900, accuracy: 8, speed: 8, bearing: 40, time: T0 + 20000 });
  ok(w.calls.panTos.length > pansAtDeath && near(lastPan(w), 51.1015, -114.0900),
    'C4: watch dead + app stream live -> the rendered position ADVANCES on the stream');
  const pansAfterC4 = w.calls.panTos.length;
  w.feedMiles({ latitude: 51.1015, longitude: -114.0900, accuracy: 8, speed: 8, bearing: 40, time: T0 + 20000 });
  ok(w.calls.panTos.length === pansAfterC4, 'C5: the same stream fix twice is not fed twice');
  w.feedMiles({ latitude: 51.0955, longitude: -114.0990, accuracy: 8, speed: 8, bearing: 40, time: T0 + 12000 });
  ok(w.calls.panTos.length === pansAfterC4, 'C6: a stale stream fix never drags the position back');

  /* ---- Layer 2: the clock hazard — the app stream's fix clock
   * runs 90 s behind the device clock the watch stamped. ---- */
  const w2 = mkNavWorld2();
  const U0 = w2.now();
  w2.setGeoLast({ latitude: C_ORIGIN[0], longitude: C_ORIGIN[1], bearing: 40, speed: 0, time: U0 - 150000 });
  w2.api.render(w2.body);
  await ctick(); await ctick(); await ctick();
  ok(!w2.reg.nv_drive_screen.classList.contains('hidden'), 'C7: (skew world) the drive opens from the Navigate');
  w2.fireWatch(51.0975, -114.0965, 40, 8, U0 + 5000);   // device-clock stamps
  w2.fireWatch(51.0985, -114.0955, 40, 8, U0 + 10000);
  ok(near(lastPan(w2), 51.0985, -114.0955), 'C8: (skew world) the watch moves the view while alive');
  /* watch dies; the app stream's fixes carry GPS-clock stamps,
   * 90 s behind every stamp the watch left behind */
  const SKEW = 90000;
  w2.feedMiles({ latitude: 51.1000, longitude: -114.0920, accuracy: 8, speed: 8, bearing: 40, time: U0 + 15000 - SKEW });
  w2.feedMiles({ latitude: 51.1015, longitude: -114.0900, accuracy: 8, speed: 8, bearing: 40, time: U0 + 20000 - SKEW });
  ok(near(lastPan(w2), 51.1015, -114.0900),
    'C9: SKEWED CLOCKS: stream fixes behind the watch watermark still ADVANCE the drive');
  /* the watchdog bridge reads the same skewed last fix — it must
   * be able to feed it too */
  w2.advance(13000);
  w2.pumpIntervals();
  w2.feedMiles({ latitude: 51.1030, longitude: -114.0880, accuracy: 8, speed: 8, bearing: 40, time: U0 + 25000 - SKEW });
  ok(near(lastPan(w2), 51.1030, -114.0880),
    'C10: after the watchdog stirs, the skewed stream still owns the position');
}

/* ==================================================================
 * Part D — BUBBLE-FACE-WRONG-OCT22 (item 4): the PiP seam.
 * The float showed the WHOLE app (header + beta banner). Android
 * recreates an activity on PiP entry unless the manifest declares
 * the PiP configChanges — recreation reloads the web app inside
 * the tiny window and the pipChanged event fires before the new
 * page can hear it. Plus the face must swap BEFORE entry, and the
 * face itself must carry ONLY his spec (timer, loads, +/-, start/
 * stop). Native statics + a functional run of the real face code
 * extracted from js/app.js.
 * ================================================================== */
console.log('— Part D: the bubble face at the PiP seam (item 4) —');
function partD() {
  const man = readN('android/app/src/main/AndroidManifest.xml');
  const ma = /<activity[^>]*\.MainActivity[^>]*>/.exec(man);
  const maTag = ma ? ma[0] : '';
  const cc = /android:configChanges="([^"]*)"/.exec(maTag);
  const ccSet = cc ? cc[1].split('|') : [];
  ok(ccSet.indexOf('screenSize') >= 0 && ccSet.indexOf('smallestScreenSize') >= 0 &&
     ccSet.indexOf('screenLayout') >= 0 && ccSet.indexOf('orientation') >= 0,
    'D1: MainActivity declares the PiP configChanges (no recreation on PiP entry)', maTag.slice(0, 160));
  const mainAct = readN('android/app/src/main/java/com/meticuloustechnologies/app/MainActivity.java');
  const leaveBody = /onUserLeaveHint\(\)\s*\{([\s\S]*?)\n    \}/.exec(mainAct);
  const lb = leaveBody ? leaveBody[1] : '';
  const swapIdx = lb.search(/pipWillEnter|willEnterPip|prePip|notifyPip/i);
  const enterIdx = lb.indexOf('enterPipNow()');
  ok(swapIdx >= 0 && enterIdx > swapIdx,
    'D2: onUserLeaveHint tells the web layer to swap the face BEFORE entering PiP');
  const plug = readN('android/app/src/main/java/com/meticuloustechnologies/app/ShiftTrackPlugin.java');
  ok(/notifyListeners\("pipWillEnter"/.test(plug) || /"pipWillEnter"/.test(plug),
    'D3: the plugin carries a pipWillEnter event to the web layer');
  /* the web side: the event is heard, and the face swaps on it */
  const appJs = read('js/app.js');
  const stJs = read('js/shifttrack.js');
  ok(/pipWillEnter/.test(appJs) && /addPipListener|addEventListener\('pip|onPipWillEnter/.test(appJs + stJs),
    'D4: the web layer hears pipWillEnter and swaps the face on it');
  ok(/bubPlus/.test(appJs) && /bubMinus/.test(appJs) && /trackerAddLoadTap|trackerCutLoadTap|AddLoad|CutLoad/.test(appJs),
    'D5: the bubble +/- buttons are wired to the load correction actions');
  /* the face markup: ONLY the spec elements */
  const idx = read('index.html');
  const bfBlock = /<div id="bubbleFace"[\s\S]*?<\/div>\s*<!--/.exec(idx);
  const bf = bfBlock ? bfBlock[0] : '';
  ['bubClock', 'bubLoads', 'bubPlus', 'bubMinus', 'bubPlay', 'bubStop'].forEach(function (id) {
    ok(bf.indexOf('id="' + id + '"') >= 0, 'D6: the bubble face carries #' + id);
  });
  ok(!/trialBar|sbName|appHeader|beta/i.test(bf), 'D7: no app chrome inside the bubble face');

  /* functional: the REAL refreshBubbleFace/paintBubble, extracted
   * from js/app.js, over a fake DOM. With a live session + the PiP
   * flag raised (the pre-entry swap), the face shows timer + loads;
   * on expand it hides again; while driving it stays down (the
   * drive owns PiP then). */
  const start = appJs.indexOf('App._bubble = false;');
  const pbStart = appJs.indexOf('function paintBubble(sec)');
  ok(start >= 0 && pbStart > start, 'D8: the bubble block located in js/app.js');
  let depth = 0, end = -1;
  for (let i = appJs.indexOf('{', pbStart); i < appJs.length; i++) {
    if (appJs[i] === '{') depth++;
    else if (appJs[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const block = appJs.slice(start, end);
  const elsD = {};
  function dEl(id) {
    if (!elsD[id]) {
      const classes = new Set(id === 'bubbleFace' ? ['hidden'] : []);
      elsD[id] = { id: id, textContent: '',
        classList: { toggle: function (c, f) { if (f === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (f) classes.add(c); else classes.delete(c); },
          add: function (c) { classes.add(c); }, remove: function (c) { classes.delete(c); },
          contains: function (c) { return classes.has(c); } } };
    }
    return elsD[id];
  }
  const sbD = { console: console, JSON: JSON, Math: Math,
    document: { getElementById: dEl },
    App: { tracker: { status: 'running' }, _pip: false, _bubble: false,
      _authLocked: function () { return false; } },
    ShiftTrack: { _driving: false },
    sessionActive: function () { return true; },
    loadsGlance: function () { return '8 loads'; },
    fmtClock: function (s) { return '01:02:05'; },
    trackerElapsedSec: function () { return 3725; } };
  sbD.window = sbD;
  vm.createContext(sbD);
  vm.runInContext(block + '\n;this.__refresh = refreshBubbleFace; this.__paint = paintBubble;', sbD);
  sbD.App._pip = true; // the pre-entry swap raises the flag
  sbD.__refresh();
  ok(!dEl('bubbleFace').classList.contains('hidden'), 'D9: with the swap raised, the bubble face is the visible face');
  ok(dEl('bubClock').textContent === '01:02:05' && dEl('bubLoads').textContent === '8 loads',
    'D10: the face paints the timer and the load count', dEl('bubClock').textContent + ' / ' + dEl('bubLoads').textContent);
  sbD.App._pip = false; // expand
  sbD.__refresh();
  ok(dEl('bubbleFace').classList.contains('hidden'), 'D11: on expand the app face returns (bubble hides)');
  sbD.App._pip = true; sbD.ShiftTrack._driving = true;
  sbD.__refresh();
  ok(dEl('bubbleFace').classList.contains('hidden'), 'D12: while driving, the bubble stays down (the drive owns the float)');
}

/* ---------------- runner ---------------- */
(async function main() {
  await buildMorning();
  await partA1();
  await partA2();
  partB();
  await partC();
  partD();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR', e); process.exit(2); });
