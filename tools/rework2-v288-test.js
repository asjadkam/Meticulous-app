'use strict';
/* v288 REWORK #2 — reproduction-first suite for the owner's
 * Oct 30, 2026 14:46 MDT in-hands verdict on v62 / web 287:
 * "What on earth are you fixing? Last time you did not fix
 * anything and you ruined the miles. This time you did not fix
 * anything and you ruined the miles and the load on the widget."
 * His 14:39 screen recording: dashboard Miles (live) 0.1 km on a
 * session counting since 8:00 AM (39.3 km at 10:34, pre-install),
 * Loads today 17 (pegs fine), widget clock ticking but miles
 * 0.1 km and loads wrong. Two folded specs (Oct 30 14:48): the
 * widget must repaint EVERY SECOND while recording, and the
 * Back-press bubble float NEVER APPEARS AT ALL on v62.
 *
 * PROVEN ROOT CHAIN (code-verified, Oct 30):
 *   Miles — js/miles.js's engine adopts a stored record ONLY in
 *   startDay (begin-time). After his mid-day reinstall the fresh
 *   boot arms the day watch, sign-in reattaches the session and
 *   startDay begins the engine from the young day-watch fragment
 *   (~0.1 km); the cloud pull then heals the LOCAL STORE
 *   (mergeTelemetryDays, larger day wins) but nothing re-adopts
 *   it into the RUNNING engine, whose persist() then STOMPS the
 *   healed store record with its young snapshot, and
 *   cloudsync.pushOne — which merge-protects record-list keys
 *   (v272) but NOT telemetry keys — pushes the young snapshot UP,
 *   overwriting the cloud's full day. The total can only sit at
 *   ~0.1 km everywhere after that.
 *   Widget — the native SessionRecord is fed only by
 *   sessionSync(sessionFacts) on tracker transitions. No
 *   transition fires after the first pull heals the web side, so
 *   the record keeps its pre-pull facts (loads 0, milesM ~100)
 *   while the service tick faithfully repaints the stale record.
 *   Loads heal on the dashboard because GeoLoads.today() reads
 *   the store fresh per call; the widget reads the frozen record.
 *   Bubble — navigator.parkDrive() hard-returns false when the
 *   drive-screen/dock lookup misses (a state the module's own
 *   render code anticipates: "page rebuilt under a parked
 *   drive"). back() then falls to enterPip (true on-shell even
 *   when the shell declines) or the staircase, which DEMOTES a
 *   live drive to places and re-renders over it — Back consumed,
 *   no float anywhere. Separately, the native overlay's
 *   DISMISSAL_EPOCH stayed 60 through v62, so a dismissal
 *   recorded by older code against the still-running session
 *   silently suppresses the Home-press float all day.
 *
 * Part M models HIS EXACT SEQUENCE end-to-end with the REAL
 * js/miles.js and the REAL cloudsync merge/push code:
 *   morning record 39.3 km (local + cloud) -> local WIPE ->
 *   fresh boot day-watch counts ~0.2 km -> sign-in reattach
 *   (pre-pull race: engine begins from the young fragment) ->
 *   first pull lands (store heals) -> [the fix: engine adopts,
 *   persist cannot stomp, push cannot overwrite] -> engine,
 *   store AND cloud all keep the full day, and the widget facts
 *   (REAL sessionFacts/loadsNumber slices) carry milesM >= the
 *   day and loads === the dashboard's 17.
 * Part B drives the FULL Back chain (real SYS-BACK + shell +
 * navigator, the v287 world) with the drive-screen node MISSING
 * — the float-absent state — plus happy-path regressions.
 * Part N pins the native 1-second widget tick, the dismissal
 * epoch bump, and the ship version numbers.
 *
 * Run: node tools/rework2-v288-test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const NAT = path.resolve(ROOT, '..', 'meticulous-native');
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function readNat(p) { return fs.readFileSync(path.join(NAT, p), 'utf8'); }
function tick() { return new Promise(function (r) { setTimeout(r, 15); }); }
/* slice src from marker A to marker B (exclusive); '' when absent
   (new-code slices are missing on the pre-fix tree by design —
   the checks that need them then fail as RED, not as crashes) */
function slice(src, a, b) {
  const i = src.indexOf(a);
  if (i < 0) return '';
  const j = b ? src.indexOf(b, i + a.length) : -1;
  return src.slice(i, j < 0 ? undefined : j);
}

const appSrc = read('js/app.js');
const stSrc = read('js/shifttrack.js');
const milesSrc = read('js/miles.js');
const csSrc = read('js/cloudsync.js');
const navSrc = read('modules/navigator.js');
const navModSrc = read('modules/navigation.js');

/* ================= shared stubs ================= */
function makeLocal() {
  const mem = {};
  return {
    getItem: k => (k in mem) ? mem[k] : null,
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; },
    _mem: mem
  };
}
function makeStore(data) {
  return {
    get: function (k, d) { return data[k] !== undefined ? data[k] : d; },
    set: function (k, v) { data[k] = v; },
    del: function (k) { delete data[k]; }
  };
}

/* ================= Part M — his exact sequence ================= */
const T0 = Date.UTC(2026, 9, 30, 14, 0, 0); // 8:00 AM MDT
const SKEY = 's' + T0;
const DAY = '2026-10-30';
/* the morning's driving: 354 steps of 0.001 deg latitude
   (~111.19 m each) = ~39.36 km by 13:54 UTC, records in the
   engine's own persisted shape */
function morningRecord() {
  const crumbs = [];
  for (let i = 0; i <= 354; i++) crumbs.push({ t: T0 + i * 60000, a: 51.0 + i * 0.001, o: -114.0 });
  return {
    key: SKEY, date: DAY, totalM: 39361, hasFix: true,
    anchor: { time: T0 + 354 * 60000, latitude: 51.354, longitude: -114.0 },
    crumbs: crumbs, segs: [[T0, T0 + 354 * 60000]], joinFrom: null,
    updatedAt: T0 + 354 * 60000
  };
}

async function partM() {
  console.log('— M: REINSTALL-LIVE-KM — his exact sequence: morning 39.3 km -> wipe -> young boot -> reattach -> pull -> the day must survive —');
  /* the cloud's copy of the day (the morning's coalesced pushes
     landed — his own 10:34 reading was the app's number) */
  const cloudMorning = { days: {} };
  cloudMorning.days[SKEY] = morningRecord();

  /* ---- the wipe: fresh local store, fresh localStorage ---- */
  const storeData = {};
  let geoCb = null;
  const geo = {
    available: function () { return true; },
    start: function (cb) { geoCb = cb; return Promise.resolve(true); },
    stop: function () { geoCb = null; },
    isWatching: function () { return !!geoCb; }
  };
  const world = {
    console: console, JSON: JSON, Math: Math, Date: Date,
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval,
    localStorage: makeLocal(),
    document: { addEventListener: function () {}, hidden: false, visibilityState: 'visible' },
    navigator: {},
    App: { _store: makeStore(storeData), geo: geo, _today: function () { return DAY; } }
  };
  world.window = world;
  vm.createContext(world);
  vm.runInContext(milesSrc, world);
  const LM = world.LiveMiles;
  check('M0: LiveMiles loaded on the fresh boot', !!LM);
  /* the running engine's live total, through the engine's own
     accessor (currentKm — the same number the dashboard's Miles
     dial reads); null before any fix -> 0 here */
  function engineM() {
    const km = LM.currentKm();
    return (typeof km === 'number' && isFinite(km)) ? Math.round(km * 1000) : 0;
  }

  /* ---- fresh boot: the day watch arms before sign-in and
     counts the first young metres (~0.17 km over 3 fixes) ---- */
  LM.startDay('d' + DAY);
  await tick();
  const bootT = T0 + 5 * 3600000; // five hours into the day, harness time
  geoCb({ latitude: 51.000, longitude: -114.0, accuracy: 5, time: bootT });
  geoCb({ latitude: 51.002, longitude: -114.0, accuracy: 5, time: bootT + 30000 });
  geoCb({ latitude: 51.004, longitude: -114.0, accuracy: 5, time: bootT + 60000 });
  geoCb({ latitude: 51.006, longitude: -114.0, accuracy: 5, time: bootT + 90000 });
  await tick();
  const youngM = engineM();
  check('M1: the fresh boot counts only young metres before sign-in (0 < x < 1000 m)',
    youngM > 0 && youngM < 1000, 'young=' + youngM);

  /* ---- sign-in reattach, BEFORE the first pull lands (the
     race his install hit): the engine begins the session from
     the young fragment — the 0.1 km state in his video ---- */
  LM.startDay(SKEY, { resume: true });
  await tick();
  const atReattach = engineM();
  check('M2: at reattach the engine shows the young total (the symptom, both trees)',
    atReattach > 0 && atReattach < 1000, 'engine=' + atReattach);

  /* ---- the first pull lands: applyPull writes the merged
     telemetry value into the local store — run the REAL merge ---- */
  const teleSlice = slice(csSrc, 'function telemetryDayTotal', '/* v241');
  check('M3: the real telemetry merge code is extractable', teleSlice.length > 200);
  vm.runInContext(teleSlice + '\n;this.__merge = mergeTelemetryDays;', world);
  const localBeforePull = JSON.parse(JSON.stringify(storeData.livemiles || { days: {} }));
  const merged = world.__merge('livemiles', localBeforePull, JSON.parse(JSON.stringify(cloudMorning)));
  storeData.livemiles = merged; // applyPull's write (lsSetRaw in production)
  const storeAfterPull = (storeData.livemiles.days[SKEY] || {}).totalM || 0;
  check('M4: the pull heals the STORE (larger day wins) — true on both trees',
    storeAfterPull >= 39000, 'store=' + storeAfterPull);

  /* ---- THE FIX POINT: the app adopts the healed store into
     the running engine when a pull changes livemiles ---- */
  check('M5: LiveMiles.adoptFromStore exists (the after-pull adoption seam)',
    typeof LM.adoptFromStore === 'function');
  if (typeof LM.adoptFromStore === 'function') { LM.adoptFromStore(); await tick(); }

  /* one more real fix lands, continuous with the young
     engine's position (51.006 -> 51.008), then the day's final
     persist runs (stopDay's forced write — the stomp moment:
     whatever the engine holds is what the store becomes) */
  geoCb({ latitude: 51.008, longitude: -114.0, accuracy: 5, time: bootT + 120000 });
  await tick();
  const engineAfter = engineM();
  try { LM.stopDay(); } catch (e) {}
  await tick();
  const storeAfter = (storeData.livemiles.days[SKEY] || {}).totalM || 0;
  check('M6: the RUNNING ENGINE holds the full day after the pull (>= 39 km, not ~0.3 km)',
    engineAfter >= 39000, 'engine=' + engineAfter);
  check('M7: persist() cannot stomp the healed store record (store >= 39 km after the next persist)',
    storeAfter >= 39000, 'store=' + storeAfter);

  /* ---- the flush: the REAL pushOne over an in-memory
     Firestore — the cloud must keep the full day ---- */
  const lsMem = {};
  lsMem['livemiles'] = JSON.stringify(storeData.livemiles);
  const fbDocs = {};
  fbDocs['livemiles'] = { v: JSON.parse(JSON.stringify(cloudMorning)) };
  const kmMap = {};
  const pushWorld = {
    console: console, JSON: JSON, Math: Math, Date: Date,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    S: { uid: 'u1', stats: { pushed: 0 }, _keyFails: {}, _flushErrors: [] },
    KV_COLLECTION: 'kv',
    keyMeta: function (k) { return kmMap[k] || (kmMap[k] = {}); },
    lsGetRaw: function (k) { return (k in lsMem) ? lsMem[k] : null; },
    lsSetRaw: function (k, v) { lsMem[k] = v; },
    docIdFor: function (k) { return k; },
    fbReady: function () { return true; },
    parseJson: function (s, d) { try { return JSON.parse(s); } catch (e) { return d; } },
    MAX_DOC_BYTES: 900000,
    isTelemetryKey: function (k) { return k === 'livemiles' || k === 'geoloads'; },
    stampTelePush: function () {},
    getMeta: function () { return { keys: kmMap, uid: 'u1' }; },
    saveMeta: function () {},
    RECORD_LIST_KEYS: {},
    loadCloudDoc: function () { return Promise.resolve(null); },
    mergeRecordLists3: function (k, a) { return a; },
    recordIdList: function () { return []; },
    FB: {
      saveDoc: function (coll, id, obj) { fbDocs[id] = JSON.parse(JSON.stringify(obj)); return Promise.resolve({}); },
      deleteDoc: function (coll, id) { delete fbDocs[id]; return Promise.resolve({}); },
      loadDoc: function (coll, id) { const d = fbDocs[id]; return Promise.resolve(d ? JSON.parse(JSON.stringify(d)) : null); },
      loadDocs: function () { return Promise.resolve(Object.keys(fbDocs).map(function (id) { return { id: id, mt: id, v: fbDocs[id] && fbDocs[id].v }; })); }
    }
  };
  vm.createContext(pushWorld);
  vm.runInContext(teleSlice, pushWorld);
  const lcSlice = slice(csSrc, 'function loadCloudValue', '\n  function ');
  if (lcSlice) vm.runInContext(lcSlice, pushWorld);
  const pushSlice = slice(csSrc, 'function pushOne(key)', '/* ---------------- pull');
  check('M8: the real pushOne is extractable', pushSlice.length > 500);
  vm.runInContext(pushSlice + '\n;this.__pushOne = pushOne;', pushWorld);
  await pushWorld.__pushOne('livemiles');
  const cloudAfter = (((fbDocs['livemiles'] || {}).v || {}).days || {})[SKEY];
  check('M9: the PUSH cannot overwrite the cloud day with the young snapshot (cloud >= 39 km)',
    !!cloudAfter && cloudAfter.totalM >= 39000,
    'cloud=' + (cloudAfter && cloudAfter.totalM));

  /* ---- stale-cloud variant: the cloud holds only an OLDER
     snapshot of the same day (12 km). The restore must still
     never go below the largest surviving source. ---- */
  {
    const store2 = {};
    store2.livemiles = JSON.parse(JSON.stringify(storeData.livemiles)); // local young (post-sequence state is fine as a stand-in young store)
    const staleCloud = { days: {} };
    const rec = morningRecord(); rec.totalM = 12000; rec.updatedAt = T0 + 108 * 60000;
    staleCloud.days[SKEY] = rec;
    const m2 = world.__merge('livemiles', { days: {} }, staleCloud);
    check('M10: stale-cloud pull still yields the largest surviving source (12 km floor)',
      (m2.days[SKEY] || {}).totalM === 12000, 'merged=' + (m2.days[SKEY] || {}).totalM);
  }

  /* ---- Part W: the widget facts — REAL sessionFacts +
     loadsNumber slices over this world's healed state ---- */
  console.log('— W: WIDGET-LOADS/MILES — the record fed to the widget must carry the dashboard truth —');
  world.App.tracker = { status: 'running', startMs: T0, startTs: T0, accum: { manualLoads: 0 } };
  world.App._sessRev = 5;
  world.GeoLoads = { today: function () { return { armed: true, count: 17 }; } }; // the dashboard's own peg count (his video: 17)
  world.trkAccum = function () { return { manualLoads: 0 }; };
  world.trackerElapsedSec = function () { return 23400; };
  world.trackerSessionKeyMs = function () { return T0; };
  const lnSlice = slice(appSrc, 'function loadsNumber()', 'function loadsArmedNow');
  const laSlice = slice(appSrc, 'function loadsArmedNow()', 'function sessionFacts');
  const sfSlice = slice(appSrc, 'function sessionFacts(force)', 'function syncSessionRecord');
  check('W0: the real facts slices are extractable', lnSlice.length > 50 && sfSlice.length > 200);
  vm.runInContext(lnSlice + laSlice + sfSlice + '\n;this.__facts = sessionFacts;', world);
  const facts = world.__facts(false);
  check('W1: sessionFacts loads === the dashboard peg count (17)',
    facts && facts.loads === 17, 'loads=' + (facts && facts.loads));
  check('W2: sessionFacts milesM carries the healed day (>= 39,000 m, not ~100)',
    facts && facts.milesM >= 39000, 'milesM=' + (facts && facts.milesM));
  check('W3: the after-pull adoption + facts refresh are WIRED (cloudsync hook, app registration)',
    /onAfterPull/.test(csSrc) && /onAfterPull/.test(appSrc) && /adoptFromStore/.test(appSrc));
  const rec = readNat('android/app/src/main/java/com/meticuloustechnologies/app/SessionRecord.java');
  check('W4: SessionRecord.syncFromWeb applies loads + milesM from changed facts (regression pin)',
    /syncFromWeb[\s\S]{0,2600}loads/.test(rec) && /syncFromWeb[\s\S]{0,2600}milesM/.test(rec));
}

/* ================= Part B — BUBBLE-FLOAT-ABSENT =================
 * The v287 world (full shell chain), with one change: the drive
 * screen node can be REMOVED from the document mid-drive — the
 * state parkDrive's silent gate hits (the module's own render
 * anticipates a parked screen "gone (page rebuilt under it)").
 * On the pre-fix tree Back then produces NO float at all. */
function elStub(id) {
  const e = {
    id: id || '', children: {}, style: {}, _html: '', textContent: '', value: '', onclick: null,
    _listeners: {}, _kids: [], _parent: null,
    addEventListener: function (ev, fn) { (e._listeners[ev] = e._listeners[ev] || []).push(fn); },
    removeEventListener: function (ev, fn) {
      const l = e._listeners[ev] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
    },
    fire: function (ev, arg) { (e._listeners[ev] || []).slice().forEach(function (f) { f(arg || {}); }); },
    appendChild: function (kid) { e._kids.push(kid); kid._parent = e; return kid; },
    classList: {
      _s: new Set(),
      add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); },
      toggle: function (c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { on ? this._s.add(c) : this._s.delete(c); } },
      contains: function (c) { return this._s.has(c); }
    },
    querySelector: function (sel) { return e.children[sel] || null; },
    querySelectorAll: function () { return []; },
    getAttribute: function () { return null; },
    setAttribute: function () {}
  };
  Object.defineProperty(e, 'innerHTML', {
    configurable: true,
    get: function () { return e._html; }, set: function (v) { e._html = String(v); }
  });
  return e;
}
function resultsElB() {
  const e = elStub('nv_presults');
  e._rows = {};
  e.querySelectorAll = function (sel) {
    if (sel !== '[data-pid]') return [];
    return Object.keys(e._rows).map(function (k) { return e._rows[k]; });
  };
  Object.defineProperty(e, 'innerHTML', {
    get: function () { return e._html; },
    set: function (v) {
      e._html = String(v); e._rows = {};
      const re = /data-pid="([^"]+)"/g; let m;
      while ((m = re.exec(e._html))) {
        const pid = m[1];
        e._rows[pid] = { onclick: null, getAttribute: function (n) { return n === 'data-pid' ? pid : null; },
          click: function () { if (this.onclick) this.onclick(); } };
      }
    }
  });
  return e;
}
const fixture = JSON.parse(read('tools/navigator-fixture-tripb.json'));
const ORIGIN = [51.0955, -114.099], DEST = [51.1075, -114.0845];

function makeWorldB(opts) {
  const sessionLive = !!opts.sessionLive;
  const storeData = opts.storeData || {};
  const store = makeStore(storeData);
  const ids = ['nv_banner', 'nv_map', 'nv_mode_truck', 'nv_mode_car', 'nv_follow', 'nv_mute',
    'nv_q', 'nv_search', 'nv_results', 'nv_destnote', 'nv_route', 'nv_end', 'nv_note', 'nv_steps',
    'nv_pq', 'nv_presults', 'nv_back', 'nv_drive', 'nv_drive_screen', 'nv_drive_map',
    'nvd_dist', 'nvd_inst', 'nvd_road', 'nvd_eta_main', 'nvd_eta_sub', 'nvd_reroute', 'nvd_plane',
    'nvd_mute', 'nvd_exit', 'nvd_recenter', 'nvd_you', 'nvd_pip_line', 'nvd_speed', 'nvd_speedwrap',
    'nvd_inset', 'pipDock', 'bubbleFace', 'bubClock', 'bubStatus', 'bubLoads', 'bubPlay', 'bubPlus', 'bubMinus', 'bubStop',
    'dashView', 'modView', 'modTitle', 'sidebar'];
  const reg = {};
  ids.forEach(function (id) { reg[id] = elStub(id); });
  reg.nv_presults = resultsElB();
  reg.bubbleFace.classList.add('hidden');
  reg.nv_banner.children['.nv-banner-main'] = elStub();
  reg.nv_banner.children['.nv-banner-sub'] = elStub();
  const body = elStub('modBody');
  body.querySelector = function (sel) {
    const id = sel.slice(1);
    return reg[id] || (reg[id] = elStub(id));
  };
  body.querySelectorAll = function () { return []; };
  reg.modBody = body;
  const bodyEl = elStub('body');
  bodyEl.appendChild = function () {};

  const calls = { fetch: [], polylines: [], spoken: [], views: [], maps: [], groups: [], showDashboard: 0, opened: [], buildDashboard: 0, showView: [] };
  const mapHandlers = {};
  function makeMapStub() {
    const m = {
      _adds: 0, _removes: 0, _views: [], _panTos: [], _center: null, _zoom: 15, _invalidated: 0,
      setView: function (c, z) { m._views.push([c, z]); m._center = (c && c.lat !== undefined) ? [c.lat, c.lng] : c; if (z) m._zoom = z; return m; },
      panTo: function (c) { const cc = (c && c.lat !== undefined) ? [c.lat, c.lng] : c; m._panTos.push(cc); m._center = cc; return m; },
      setZoomAround: function () {},
      getCenter: function () { return m._center ? { lat: m._center[0], lng: m._center[1] } : null; },
      getZoom: function () { return m._zoom; },
      on: function (ev, fn) { mapHandlers[ev] = fn; },
      addLayer: function () { m._adds++; return m; },
      removeLayer: function () { m._removes++; return m; },
      remove: function () {}, fitBounds: function () {}, invalidateSize: function () { m._invalidated++; }
    };
    return m;
  }
  const L = {
    map: function () { const m = makeMapStub(); calls.maps.push(m); return m; },
    tileLayer: function () { const tl = { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return tl; }, on: function () { return tl; }, setUrl: function () {}, redraw: function () {} }; return tl; },
    marker: function () { return { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return this; }, setLatLng: function () {} }; },
    circleMarker: function () { const cm = { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return cm; }, setLatLng: function () {} }; return cm; },
    polyline: function (pts) { calls.polylines.push(pts); const pl = { addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return pl; }, setLatLngs: function () {}, getBounds: function () { return {}; } }; return pl; },
    layerGroup: function (kids) { const g = { _kids: kids, getLayers: function () { return g._kids.slice(); }, addTo: function (m) { if (m && m.addLayer) m.addLayer(this); return m; } }; calls.groups.push(g); return g; }
  };
  let geoCb = null;
  const pluginListeners = {};
  const pluginStub = {
    start: function () { return Promise.resolve({ started: true }); },
    stop: function () { return Promise.resolve({ stopped: true }); },
    status: function () { return Promise.resolve({ available: true, sessionActive: false }); },
    readCrumbs: function () { return Promise.resolve({ crumbs: [], more: false }); },
    ack: function () { return Promise.resolve({ deleted: 0 }); },
    setDriving: function () { return Promise.resolve({}); },
    setSession: function () { return Promise.resolve({}); },
    enterPip: function () { return Promise.resolve({ ok: true }); },
    addListener: function (name, fn) { (pluginListeners[name] = pluginListeners[name] || []).push(fn); return Promise.resolve({}); }
  };
  const backListeners = [];
  const world = {
    console: console, JSON: JSON, Math: Math, Date: Date, setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: setInterval, clearInterval: clearInterval,
    requestAnimationFrame: function (cb) { return setTimeout(function () { cb(Date.now()); }, 5); },
    cancelAnimationFrame: function (id) { clearTimeout(id); },
    window: null, localStorage: makeLocal(),
    history: { length: 1, back: function () {} },
    addEventListener: function () {}, scrollTo: function () {},
    document: {
      hidden: false, visibilityState: 'visible',
      addEventListener: function () {}, removeEventListener: function () {},
      createElement: function () { return { href: '', style: {}, click: function () {}, remove: function () {} }; },
      getElementById: function (id) { return reg[id] || null; },
      body: bodyEl
    },
    el: function (id) { return reg[id] || (reg[id] = elStub(id)); },
    showView: function (v) { calls.showView.push(v); },
    MODULE_META: { navigator: { title: 'Navigator' } },
    moduleTitle: function () { return 'Navigator'; },
    dotLockActive: function () { return false; },
    buildDashboard: function () { calls.buildDashboard++; },
    App: {
      _esc: function (s) { return String(s == null ? '' : s); }, _store: store,
      _today: function () { return '2026-10-30'; },
      tracker: { status: sessionLive ? 'running' : 'idle' },
      _pip: false, _authLocked: function () { return false; },
      showView: function (v) { calls.showView.push(v); world.App.currentView = (v === 'dash') ? 'main' : v; },
      currentView: 'main',
      tierAllows: function () { return true; },
      ptrNoteRepainted: function () {}
    },
    Meticulous: { modules: {} },
    L: L,
    navigator: { geolocation: { watchPosition: function (cb) { geoCb = cb; return 7; }, clearWatch: function () {} } },
    speechSynthesis: { cancel: function () {}, speak: function (u) { calls.spoken.push(u.text); } },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    fetch: function (url) {
      calls.fetch.push(url);
      if (url.indexOf('/route') >= 0) {
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(fixture); } });
      }
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); } });
    },
    sessionActive: function () { return sessionLive; },
    closeTrackerStartSheet: function () {}, closeTrackerEndSheet: function () {},
    closeOdoSheet: function () {}, closeLoadSheet: function () {},
    closeSidebar: function () {}, collectOnbInputs: function () {},
    onbPrevVisible: function () { return -1; }, renderOnbStep: function () {},
    trackerElapsedSec: function () { return 3725; },
    fmtClock: function (sec) { sec = Math.floor(sec); var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2); },
    loadsGlance: function () { return '🚛 3 loads'; }
  };
  world.window = world;
  world.window.history = world.history;
  world.Capacitor = { Plugins: { ShiftTrack: pluginStub, App: { addListener: function (name, fn) { if (name === 'backButton') backListeners.push(fn); return Promise.resolve({}); }, exitApp: function () {} } } };
  vm.createContext(world);
  vm.runInContext(stSrc, world);
  vm.runInContext(navModSrc, world);
  vm.runInContext(navSrc, world);
  const api = (world.Meticulous.modules && world.Meticulous.modules.navigator) || null;
  const bubStart = appSrc.indexOf('App._bubble = false;');
  const bubBlock = appSrc.slice(bubStart, appSrc.indexOf('/* v220 (WIDGET-CONTROLS)', bubStart));
  vm.runInContext(bubBlock, world);
  const sb0 = appSrc.indexOf('/* SYS-BACK-BEGIN');
  const sb1 = appSrc.indexOf('/* v19/v30: native-APK update banner');
  vm.runInContext(appSrc.slice(sb0, sb1), world);
  const sh0 = appSrc.indexOf('  function teardownModule()');
  const sh1 = appSrc.indexOf('/* PTR-BEGIN', sh0);
  vm.runInContext(appSrc.slice(sh0, sh1), world);
  const rawOpen = world.App.openModule;
  world.App.openModule = function (k) { calls.opened.push(k); return rawOpen(k); };
  return {
    world: world, reg: reg, body: body, calls: calls, api: api,
    backListeners: backListeners,
    firePos: function (la, lo, hd, sp) { if (geoCb) geoCb({ coords: { latitude: la, longitude: lo, heading: hd, speed: sp }, timestamp: Date.now() }); },
    pressBack: function () { backListeners.slice().forEach(function (f) { f({}); }); },
    dropDriveScreen: function () { delete reg.nv_drive_screen; }
  };
}

async function startDriveB(w) {
  w.world.App.openModule('navigator');
  w.firePos(ORIGIN[0], ORIGIN[1], 45, 8);
  await tick(); await tick();
  if (w.reg.nv_drive.onclick) w.reg.nv_drive.onclick();
  await tick();
}

async function partB() {
  console.log('— B1: BUBBLE-FLOAT-ABSENT — session live, drive screen node GONE at Back: a float must still appear —');
  {
    const w = makeWorldB({ sessionLive: true, storeData: {
      navigator: { profile: {}, muted: true, mode: 'truck' },
      nav_pending: { lat: DEST[0], lng: DEST[1], name: 'Simply Stone' }
    } });
    check('B1.0: navigator module registered + back wired', !!w.api && w.backListeners.length >= 1);
    await startDriveB(w);
    w.dropDriveScreen(); // the page-rebuild state: the node is gone
    w.pressBack();
    await tick();
    check('B1.1: the driver lands on the dashboard',
      !w.reg.dashView.classList.contains('hidden') && w.reg.modView.classList.contains('hidden'),
      'dashHidden=' + w.reg.dashView.classList.contains('hidden') + ' modHidden=' + w.reg.modView.classList.contains('hidden'));
    check('B1.2: A FLOAT EXISTS — the tracker face is up (not the nothing he reported)',
      !w.reg.bubbleFace.classList.contains('hidden'));
    check('B1.3: navigation is not torn down by the failed park (module kept alive)',
      w.api.keepAlive() === true);
    try { w.api.teardown(); } catch (e) {}
  }
  console.log('— B2: regression — session live, screen present: Back floats the tracker face (v287 3B core) —');
  {
    const w = makeWorldB({ sessionLive: true, storeData: {
      navigator: { profile: {}, muted: true, mode: 'truck' },
      nav_pending: { lat: DEST[0], lng: DEST[1], name: 'Simply Stone' }
    } });
    await startDriveB(w);
    w.pressBack();
    await tick();
    check('B2.1: dashboard lands + tracker face floated',
      !w.reg.dashView.classList.contains('hidden') && !w.reg.bubbleFace.classList.contains('hidden'));
    check('B2.2: drive screen parked hidden in the dock + module alive',
      w.reg.nv_drive_screen._parent === w.reg.pipDock &&
      w.reg.nv_drive_screen.classList.contains('hidden') &&
      w.api.keepAlive() === true);
    try { w.api.teardown(); } catch (e) {}
  }
  console.log('— B3: regression — no session: Back floats the compact mini map (v287 3A core) —');
  {
    const w = makeWorldB({ sessionLive: false, storeData: {
      navigator: { profile: {}, muted: true, mode: 'truck' },
      nav_pending: { lat: DEST[0], lng: DEST[1], name: 'Simply Stone' }
    } });
    await startDriveB(w);
    w.pressBack();
    await tick();
    check('B3.1: the drive screen floats as the mini map in the dock',
      w.reg.nv_drive_screen._parent === w.reg.pipDock &&
      w.reg.nv_drive_screen.classList.contains('nv-mini') &&
      !w.reg.nv_drive_screen.classList.contains('hidden'));
    check('B3.2: module alive + tracker face stays down (no session)',
      w.api.keepAlive() === true && w.reg.bubbleFace.classList.contains('hidden'));
    try { w.api.teardown(); } catch (e) {}
  }
  console.log('— B4: source pins — the park fallback + the native float gates —');
  const pd = slice(navSrc, 'function parkDrive()', 'function unparkMiniTap()');
  const gateAt = pd.indexOf('if (!scr || !dock)');
  const gateSeg = gateAt >= 0 ? pd.slice(gateAt, pd.indexOf('return false;', gateAt)) : '';
  check('B4.1: parkDrive\'s missing-node gate raises the docked tracker face instead of returning float-less',
    gateAt >= 0 && gateSeg.indexOf('setDriveDocked') >= 0 && gateSeg.indexOf('return true') >= 0,
    'gateSeg=' + JSON.stringify(gateSeg.slice(0, 80)));
  const bo = readNat('android/app/src/main/java/com/meticuloustechnologies/app/BubbleOverlay.java');
  const epochM = /DISMISSAL_EPOCH\s*=\s*(\d+)/.exec(bo);
  check('B4.2: the native overlay dismissal epoch is bumped past the v62 value (60) — a stale dismissal cannot suppress the float',
    !!epochM && parseInt(epochM[1], 10) > 60, 'epoch=' + (epochM && epochM[1]));
}

/* ================= Part N — widget 1s + ship versions ================= */
function partN() {
  console.log('— N: WIDGET-REFRESH-1S + ship version pins —');
  const svc = readNat('android/app/src/main/java/com/meticuloustechnologies/app/ShiftTrackingService.java');
  const tickM = /WIDGET_TICK_MS\s*=\s*(\d+)L?/.exec(svc);
  check('N1: the recording service repaints the widget EVERY SECOND while recording (owner spec, Oct 30 14:48)',
    !!tickM && parseInt(tickM[1], 10) === 1000, 'WIDGET_TICK_MS=' + (tickM && tickM[1]));
  check('N2: the 1s tick still drives the record-based repaint',
    /widgetTick[\s\S]{0,600}TrackerWidget\.refreshFromRecord/.test(svc));
  const vjson = JSON.parse(read('version.json'));
  check('N3: version.json webVersion is 288', vjson.webVersion === 288, 'webVersion=' + vjson.webVersion);
  check('N4: version.json serves the v45 APK pointer', vjson.version === 45 && /meticulous-v45\.apk$/.test(vjson.apkUrl || ''),
    JSON.stringify({ version: vjson.version, apkUrl: vjson.apkUrl }));
  check('N5: app.js APK_VERSION is 45', /var APK_VERSION = 45;/.test(appSrc));
  const gradle = readNat('android/app/build.gradle');
  check('N6: native is v63 (versionCode 38 / versionName 1.36)',
    /versionCode 38/.test(gradle) && /versionName "1\.36"/.test(gradle));
  const bundled = JSON.parse(readNat('www/version.json'));
  check('N7: the bundled www carries web 288', bundled.webVersion === 288, 'bundled webVersion=' + bundled.webVersion);
}

(async function () {
  await partM();
  await partB();
  partN();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('SUITE ERROR', e); process.exit(2); });
