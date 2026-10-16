/* Meticulous — yard-departure dispatch activation (js/yardstart.js)

   v91 (owner, Oct 16, 2026 07:15 MDT, then 07:58 on site at
   A2-L20 expecting it live): "Every time a user leaves their
   yard, the Dispatch saved in their dispatch module should be
   turned on automatically."

   What it does, and ONLY what it does: on a day that has a SAVED
   dispatch, the first trustworthy fix that puts the phone more
   than 250 m from the yard flips that dispatch ACTIVE — through
   the dispatch module's own activation path, producing exactly
   the state the Start button produces (status, startedAt,
   dsp_active, cloud mirror, notification). The existing
   dispatch-driven tracker plan (dispatch time, 8:00 Mon–Sat
   fallback, backdate-on-wake) then reads dsp_active as it always
   has; App.checkAutoStart() is nudged once so the plan
   re-evaluates right away.

   THE OWNER'S BOUNDARIES, kept:
   - Activation is NOT pay. Pay stays ticket-based; this file
     writes no revenue record and starts no session.
   - It never stops anything. Re-entering the yard does nothing;
     a session ends only when the driver stops it.
   - No saved dispatch that day → nothing. No phantom days.
   - Once per day per dispatch, remembered across restarts.
   - No yard (no pick, and no personal place named "Home") →
     nothing, no errors.
   - Office-role users never drive — the watcher stays inert.

   THE YARD: the favorite picked in Navigation ("🏠 Yard"), or,
   when nothing is picked, the personal place named "Home" (the
   owner parks his truck at home — so do most owner-operators).
   A favorite with a pin uses the pin. An address-only favorite
   (the Add form takes no pin — the owner's Home is one) gets its
   pin from ONE geocode of its address, persisted in yard_geo so
   each address is looked up exactly once (the js/geo.js rule);
   the favorite itself is never edited behind the user's back.

   NO NEW BACKGROUND SERVICE: this listens only where fixes
   already arrive — LiveMiles' raw watcher stream (while a
   session watcher is live), the native breadcrumb drain in
   js/shifttrack.js (the seat GeoLoads and ParkPlace already
   ride), the persisted last fix, and a throttled one-shot on app
   open / foreground. If no fix arrives, nothing happens — the
   same honesty as the rest of the app's location machinery. */
(function () {
  'use strict';

  /* YARD-ENGINE-BEGIN — pure logic; may use only plain JS + Date.
     No DOM, no store, no clock reads except fix timestamps.
     Extracted verbatim by tools/yard-start-test.js. Fix shapes
     accepted: {latitude, longitude, accuracy, time} (geo plugin
     / LiveMiles) or {lat, lng, acc, t} (breadcrumb / persisted) —
     the same normalization ParkPlace runs. */
  var ENGINE = (function () {
    var EXIT_M = 250;     /* the owner's radius: beyond this, he has left the yard */
    var ACC_MAX_M = 100;  /* sloppier than this and the fix proves nothing */

    function haversineM(lat1, lng1, lat2, lng2) {
      var R = 6371000, rad = Math.PI / 180;
      var dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
      var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
    }
    function isCoord(lat, lng) {
      return typeof lat === 'number' && typeof lng === 'number' &&
        isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    }
    function normFix(raw) {
      if (!raw || typeof raw !== 'object') return null;
      var lat = (typeof raw.lat === 'number') ? raw.lat : raw.latitude;
      var lng = (typeof raw.lng === 'number') ? raw.lng : raw.longitude;
      if (!isCoord(lat, lng)) return null;
      var t = (typeof raw.t === 'number') ? raw.t :
        (typeof raw.time === 'number') ? raw.time :
        (typeof raw.timestamp === 'number') ? raw.timestamp : 0;
      if (!t) return null;
      var acc = (typeof raw.acc === 'number') ? raw.acc :
        (typeof raw.accuracy === 'number') ? raw.accuracy : null;
      return { lat: lat, lng: lng, t: t, acc: acc };
    }
    function dayStr(ms) {
      var d = new Date(ms);
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }

    function findFavorite(navData, kind, id) {
      if (!navData || !id) return null;
      var lists = kind === 'personal' ? [navData.personal] :
        kind === 'work' ? [navData.work] : [navData.work, navData.personal];
      for (var i = 0; i < lists.length; i++) {
        var arr = lists[i] || [];
        for (var j = 0; j < arr.length; j++) if (arr[j] && arr[j].id === id) return arr[j];
      }
      return null;
    }
    /* The favorite that IS the yard (picked, else "Home"),
       whether or not it carries a pin yet — the glue geocodes
       this one's address when it has none. */
    function yardCandidate(navData, yardSetting) {
      if (!navData) return null;
      if (yardSetting && yardSetting.id) {
        var picked = findFavorite(navData, yardSetting.kind, yardSetting.id);
        if (picked) return picked;
      }
      var personal = navData.personal || [];
      for (var i = 0; i < personal.length; i++) {
        if (personal[i] && String(personal[i].name || '').trim().toLowerCase() === 'home') return personal[i];
      }
      return null;
    }
    /* The yard as coordinates, or null when there is no yard or
       its pin is not known yet. An address-only favorite resolves
       through geoCache — an entry the glue persisted after ONE
       geocode of that exact address (an address edit retires the
       cached pin, since it no longer matches). */
    function resolveYard(navData, yardSetting, geoCache) {
      var fav = yardCandidate(navData, yardSetting);
      if (!fav) return null;
      if (isCoord(fav.lat, fav.lng)) {
        return { lat: +fav.lat, lng: +fav.lng, name: fav.name || 'Yard', favId: fav.id || '' };
      }
      var g = (geoCache && fav.id) ? geoCache[fav.id] : null;
      if (g && fav.address && g.address === fav.address && isCoord(g.lat, g.lng)) {
        return { lat: +g.lat, lng: +g.lng, name: fav.name || 'Yard', favId: fav.id || '' };
      }
      return null;
    }

    /* The dispatch-record day, the dispatch module's own rule
       (dspRecordDate): the date on scheduledAt, else the record's
       date field. */
    function recordDate(rec) {
      var s = rec && rec.scheduledAt;
      if (typeof s === 'string') {
        var m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
        if (m) return m[1];
      }
      return (rec && typeof rec.date === 'string') ? rec.date : '';
    }
    function schedMinutes(rec) {
      var m = /T(\d{1,2}):(\d{2})/.exec((rec && rec.scheduledAt) || '');
      return m ? (+m[1]) * 60 + (+m[2]) : 0;
    }
    /* Today's dispatch to activate: a record for today that is
       not finished and not already active — the same eligibility
       the autostart engine reads (completed / cancelled never
       qualify). Earliest scheduled time wins when a day somehow
       holds more than one. When a dispatch is already live for
       today there is nothing to activate. */
    function pickTodaysDispatch(list, active, today) {
      if (active && recordDate(active) === today) return null;
      var best = null;
      var arr = list || [];
      for (var i = 0; i < arr.length; i++) {
        var d = arr[i];
        if (!d || !d.id) continue;
        if (d.status === 'completed' || d.status === 'cancelled' || d.status === 'active') continue;
        if (active && active.id === d.id) continue;
        if (recordDate(d) !== today) continue;
        if (!best || schedMinutes(d) < schedMinutes(best)) best = d;
      }
      return best;
    }

    /* The departure gate: one decision per fix, state small
       enough to persist whole. ctx = { yard, dispatchId,
       activeLive, today }. Returns { type:'activate', ... } at
       most once per day per dispatch; returning to the yard is
       not an event and never will be. Fixes from another day,
       stale fixes (t not advancing), and fixes too sloppy to
       trust are all ignored. The FIRST good fix of the day can
       fire: a phone whose app only wakes at the job site has
       still left the yard — that is the morning this exists for. */
    function createGate(saved) {
      var st = { date: '', dispatchId: '', lastT: 0 };
      if (saved && typeof saved === 'object') {
        if (typeof saved.date === 'string') st.date = saved.date;
        if (typeof saved.dispatchId === 'string') st.dispatchId = saved.dispatchId;
        if (typeof saved.lastT === 'number' && isFinite(saved.lastT)) st.lastT = saved.lastT;
      }
      return {
        feed: function (rawFix, ctx) {
          var f = normFix(rawFix);
          if (!f || !ctx) return null;
          if (f.acc !== null && f.acc > ACC_MAX_M) return null;
          var fday = dayStr(f.t);
          if (ctx.today && fday !== ctx.today) return null;
          if (st.date !== fday) { st.date = fday; st.dispatchId = ''; }
          if (f.t <= st.lastT) return null;
          st.lastT = f.t;
          if (!ctx.yard || !ctx.dispatchId) return null;
          if (ctx.activeLive) return null;
          if (st.dispatchId === ctx.dispatchId) return null;
          var dist = haversineM(f.lat, f.lng, ctx.yard.lat, ctx.yard.lng);
          if (dist <= EXIT_M) return null;
          st.dispatchId = ctx.dispatchId;
          return { type: 'activate', dispatchId: ctx.dispatchId, distM: Math.round(dist) };
        },
        state: function () { return { date: st.date, dispatchId: st.dispatchId, lastT: st.lastT }; }
      };
    }

    return {
      EXIT_M: EXIT_M, ACC_MAX_M: ACC_MAX_M,
      haversineM: haversineM, normFix: normFix, dayStr: dayStr,
      yardCandidate: yardCandidate, resolveYard: resolveYard,
      recordDate: recordDate, pickTodaysDispatch: pickTodaysDispatch,
      createGate: createGate
    };
  })();
  /* YARD-ENGINE-END */

  /* ---------- glue ---------- */

  var STATE_KEY = 'yard_state';
  var GEO_KEY = 'yard_geo';
  var gate = null;
  var lastRawFix = null;
  var geoTried = {};   /* per page-load: one geocode attempt per favorite */

  function store() {
    try { return (window.App && App._store) || null; } catch (e) { return null; }
  }
  function todayStr() {
    try { if (window.App && App._today) return App._today(); } catch (e) {}
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function isOffice() {
    try { return !!(window.App && App.userRole && App.userRole() === 'office'); } catch (e) { return false; }
  }
  function loadGate() {
    if (gate) return gate;
    var s = store(), saved = null;
    try { saved = s ? s.get(STATE_KEY, null) : null; } catch (e) {}
    gate = ENGINE.createGate(saved);
    return gate;
  }
  function persist() {
    var s = store();
    if (!s || !gate) return;
    try { s.set(STATE_KEY, gate.state()); } catch (e) {}
  }
  function navData() {
    var s = store();
    try { return s ? (s.get('nav_data', null) || { work: [], personal: [], recent: [] }) : null; }
    catch (e) { return null; }
  }
  function yardSetting() {
    var s = store();
    try { return s ? s.get('nav_yard', null) : null; } catch (e) { return null; }
  }
  function geoCache() {
    var s = store();
    try { return (s && s.get(GEO_KEY, null)) || {}; } catch (e) { return {}; }
  }
  function currentYard() {
    var nd = navData();
    if (!nd) return null;
    return ENGINE.resolveYard(nd, yardSetting(), geoCache());
  }

  /* An address-only yard favorite gets ONE geocode per page
     load; a hit is persisted (address-stamped) and the last fix
     is re-evaluated, because the departure may already have
     happened while the pin was unknown. A miss caches nothing —
     the next app open tries again. */
  function maybeGeocodeYard() {
    var nd = navData();
    if (!nd) return;
    if (ENGINE.resolveYard(nd, yardSetting(), geoCache())) return;
    var fav = ENGINE.yardCandidate(nd, yardSetting());
    if (!fav || !fav.id || !fav.address) return;
    if (geoTried[fav.id]) return;
    if (!(window.MeticulousGeo && MeticulousGeo.geocode)) return;
    geoTried[fav.id] = true;
    try {
      MeticulousGeo.geocode(fav.address).then(function (hit) {
        if (hit && typeof hit.lat === 'number' && typeof hit.lng === 'number') {
          var s = store();
          if (s) {
            var c = geoCache();
            c[fav.id] = { lat: +hit.lat, lng: +hit.lng, address: fav.address };
            try { s.set(GEO_KEY, c); } catch (e) {}
          }
          if (lastRawFix) evaluate(lastRawFix);
        }
      }).catch(function () {});
    } catch (e) {}
  }

  function evaluate(rawFix) {
    if (isOffice()) return;
    var s = store();
    if (!s) return;
    var yard = currentYard();
    if (!yard) { maybeGeocodeYard(); return; }
    var list = [], active = null;
    try { list = s.get('dsp_list', []) || []; active = s.get('dsp_active', null); } catch (e) {}
    var today = todayStr();
    var pick = ENGINE.pickTodaysDispatch(list, active, today);
    var ctx = {
      yard: yard,
      dispatchId: pick ? pick.id : '',
      activeLive: !!(active && ENGINE.recordDate(active) === today),
      today: today
    };
    var ev = null;
    try { ev = loadGate().feed(rawFix, ctx); } catch (e) {}
    persist();
    if (!ev) return;
    var done = false;
    try {
      var dm = window.Meticulous && Meticulous.modules && Meticulous.modules.dispatch;
      if (dm && typeof dm.activateById === 'function') done = !!dm.activateById(ev.dispatchId);
    } catch (e) {}
    if (done) {
      /* Arm the existing plan: the autostart engine re-reads
         dsp_active and takes it from here — dispatch time,
         fallback, backdate rules all unchanged. */
      try { if (window.App && App.checkAutoStart) App.checkAutoStart(); } catch (e) {}
    }
  }

  function feedFix(rawFix) {
    if (!rawFix) return;
    lastRawFix = rawFix;
    evaluate(rawFix);
  }

  /* ---------- wiring (the ParkPlace pattern) ---------- */

  var subscribed = false;
  function subscribe() {
    if (subscribed) return;
    try {
      if (window.LiveMiles && typeof LiveMiles.subscribe === 'function') {
        LiveMiles.subscribe(function (fix) { feedFix(fix); });
        subscribed = true;
      }
    } catch (e) {}
  }

  /* The persisted last fix: the native watcher's most recent
     word, readable the moment the app opens — the departure may
     have happened before the WebView woke. */
  function feedLastFix() {
    try {
      if (window.MeticulousGeo && MeticulousGeo.last) {
        var f = MeticulousGeo.last();
        if (f) feedFix(f);
      }
    } catch (e) {}
  }

  var lastOneShot = 0;
  function oneShot() {
    var now = Date.now();
    if (now - lastOneShot < 60 * 1000) return;
    lastOneShot = now;
    try {
      if (window.MeticulousGeo && MeticulousGeo.available && MeticulousGeo.available()) {
        MeticulousGeo.getCurrent(9000).then(function (fix) { if (fix) feedFix(fix); }).catch(function () {});
      }
    } catch (e) {}
  }

  var YardStart = {
    _engine: ENGINE,

    /* Every fix source the app already has funnels here. */
    feedFix: feedFix,

    /* js/shifttrack.js drain hook (same seat as GeoLoads' and
       ParkPlace's): native breadcrumbs replayed for the live
       session are real fixes with real timestamps. */
    ingestCrumbs: function (crumbs) {
      if (!crumbs || !crumbs.length) return;
      for (var i = 0; i < crumbs.length; i++) {
        var c = crumbs[i];
        if (!c) continue;
        feedFix({ latitude: c.lat, longitude: c.lng, accuracy: c.acc, time: c.t });
      }
    },

    /* The resolved yard right now (null = no yard / pin unknown). */
    yard: function () { return currentYard(); }
  };

  window.YardStart = YardStart;
  try { if (window.App) App.yardStart = YardStart; } catch (e) {}

  subscribe();
  try {
    var bootTries = 0;
    var bootTimer = setInterval(function () {
      bootTries++;
      subscribe();
      feedLastFix();
      if (subscribed || bootTries > 20) clearInterval(bootTimer);
    }, 500);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { subscribe(); feedLastFix(); oneShot(); }
    });
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { feedLastFix(); oneShot(); });
    } else { feedLastFix(); oneShot(); }
  } catch (e) {}
})();
