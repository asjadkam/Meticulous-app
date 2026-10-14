/* Meticulous — park-place nudges (web v74).
 *
 * The owner's engagement ask (Oct 14, 2026): "the notifications that
 * pop up in the morning when you get to the yard or wherever your
 * truck is parked, and the notifications when you come back — that's
 * how we can increase our involvement and usability." The app learns
 * where the truck sleeps and ASKS, once each way:
 *   morning, at the park place, no shift running → "Start your shift?"
 *   evening, back at the park place, shift still running → "Close
 *   your day?"
 *
 * Settled law honoured throughout:
 *  - Location only ever ASKS. A nudge never starts or stops a
 *    session — pay is ticket/timer-based (owner, Oct 13–14). The
 *    driver taps; the tap is the act.
 *  - At most one morning + one evening nudge per day, per driver.
 *  - The place is learned, never demanded (invisible-complexity
 *    rule): session START points (the tracker starts where the
 *    truck is) and session END points (it stops where the truck
 *    parks) cluster across days into the park place. A manual
 *    "set where I park" in Preferences → Advanced is the fallback.
 *
 * Feasibility (verified Oct 14 against the shipped v34 APK):
 * @capacitor/local-notifications IS registered in the shell
 * (capacitor.plugins.json) and present in the APK's dex, so on the
 * shell the nudges post as REAL local notifications with action
 * buttons, via the same feature-detected bridge pattern as
 * js/shifttrack.js. Everywhere else (browser, the boss's iPhone web
 * install, old shells) the same detection drives the in-app card
 * only — nothing pretends to be a notification that isn't.
 *
 * Honest limits of this web ship (stated in Preferences too):
 * detection runs while the app is open or a shift's fix stream /
 * breadcrumb drain is alive. A phone with the app fully closed
 * cannot be fence-watched from the web layer — that needs the
 * native stage (OS geofence watched by the shell; spec in the
 * goal's hidden_files, park-nudges-native-spec.md). Stale
 * transitions (breadcrumb replays older than 30 min) update the
 * state silently and never fire a late nudge.
 */
(function () {
  'use strict';

  /* PARK-ENGINE-BEGIN — pure logic; may use only plain JS + Date.
     Fix shape in:  geo.js fix { latitude, longitude, accuracy, time }
     (the learner/detector also accept { lat, lng, acc, t }). */

  var FENCE_M = 150;           // park-place fence (owner: ~150 m)
  var EXIT_M = 250;            // must be beyond this to count as gone
                               // (hysteresis band 150–250 m: neutral)
  var ACC_MAX_M = 50;          // same accuracy bar as geoloads/miles
  var ENTER_DWELL_MS = 60 * 1000;   // inside this long = arrived
  var EXIT_DWELL_MS = 120 * 1000;   // outside this long = departed
  var FRESH_MS = 30 * 60 * 1000;    // a transition older than this
                               // (breadcrumb replay) never nudges
  var LEARN_CLUSTER_M = 200;   // session-edge points within this of
                               // each other are the same place
  var LEARN_MIN_POINTS = 3;    // start/end points needed to learn
  var LEARN_MIN_DAYS = 2;      // ...spanning at least this many days
  var MORNING_FROM = 4, MORNING_TO = 12;   // local hours [4,12)
  var EVENING_FROM = 15;                   // local hours [15,24)

  function haversineM(lat1, lon1, lat2, lon2) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function isCoord(c) {
    return !!c && isFinite(c.lat) && isFinite(c.lng) &&
      Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180;
  }

  /* Normalize either fix shape to { lat, lng, acc, t } or null. */
  function normFix(f) {
    if (!f) return null;
    var lat = (typeof f.latitude === 'number') ? f.latitude : f.lat;
    var lng = (typeof f.longitude === 'number') ? f.longitude : f.lng;
    var acc = (typeof f.accuracy === 'number') ? f.accuracy
      : (typeof f.acc === 'number' ? f.acc : null);
    var t = (typeof f.time === 'number') ? f.time
      : (typeof f.t === 'number' ? f.t : 0);
    if (!isCoord({ lat: lat, lng: lng }) || !t) return null;
    return { lat: lat, lng: lng, acc: acc, t: t };
  }

  function dayStr(t) {
    var d = new Date(t);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) +
      '-' + ('0' + d.getDate()).slice(-2);
  }
  function hourOf(t) { return new Date(t).getHours(); }

  /* ---- the learner: session-edge points -> a park place ----
   * Every session contributes up to two points (its first good fix
   * and its last), and those points are where the truck sleeps far
   * more often than anywhere else: the tracker starts where the
   * truck is parked and stops where it parks for the night. Points
   * cluster greedily (200 m); the biggest cluster with >= 3 points
   * over >= 2 distinct days IS the park place. Drift/bad fixes are
   * dropped by the same accuracy bar as the counting engines. */
  function createLearner(saved) {
    var points = [];
    if (saved && saved.points) {
      for (var i = 0; i < saved.points.length; i++) {
        var p = saved.points[i];
        if (p && isCoord(p) && p.day) points.push({ lat: p.lat, lng: p.lng, day: p.day });
      }
    }
    function bestCluster() {
      var best = null;
      for (var i = 0; i < points.length; i++) {
        var members = [], days = {}, clat = 0, clng = 0;
        for (var j = 0; j < points.length; j++) {
          if (haversineM(points[i].lat, points[i].lng, points[j].lat, points[j].lng) <= LEARN_CLUSTER_M) {
            members.push(points[j]); days[points[j].day] = true;
            clat += points[j].lat; clng += points[j].lng;
          }
        }
        var nd = Object.keys(days).length;
        if (!best || members.length > best.members.length ||
            (members.length === best.members.length && nd > best.days)) {
          best = { members: members, days: nd, lat: clat / members.length, lng: clng / members.length };
        }
      }
      return best;
    }
    return {
      /* kind: 'start' | 'end' (kept for the record; both are edges
       * of the same sleeping place). Returns the learned place the
       * moment the cluster qualifies, else null. */
      observe: function (kind, rawFix) {
        var f = normFix(rawFix);
        if (!f) return null;
        if (f.acc !== null && f.acc > ACC_MAX_M) return null;
        points.push({ lat: f.lat, lng: f.lng, day: dayStr(f.t) });
        if (points.length > 90) points = points.slice(points.length - 90);
        var b = bestCluster();
        if (b && b.members.length >= LEARN_MIN_POINTS && b.days >= LEARN_MIN_DAYS) {
          return { lat: b.lat, lng: b.lng, points: b.members.length, days: b.days };
        }
        return null;
      },
      snapshot: function () { return { points: points.slice() }; }
    };
  }

  /* ---- the detector: fixes + a place -> at most two asks a day ----
   * ctx per feed: { sessionActive: bool, nowMs: number }. A nudge
   * event is { type: 'morning' | 'evening', at: fixTime }. */
  function createDetector(place, saved) {
    var st = {
      phase: 'unknown',        // 'in' | 'out' | 'unknown'
      enterSince: 0, exitSince: 0, lastT: 0,
      date: '', morningNudged: false, eveningNudged: false
    };
    if (saved) {
      if (saved.phase === 'in' || saved.phase === 'out') st.phase = saved.phase;
      st.enterSince = +saved.enterSince || 0;
      st.exitSince = +saved.exitSince || 0;
      st.lastT = +saved.lastT || 0;
      st.date = saved.date || '';
      st.morningNudged = !!saved.morningNudged;
      st.eveningNudged = !!saved.eveningNudged;
    }
    function arrivalEval(f, ctx) {
      if (ctx.nowMs && (ctx.nowMs - f.t) > FRESH_MS) return null; // replay: silent
      var h = hourOf(f.t);
      if (h >= MORNING_FROM && h < MORNING_TO && !ctx.sessionActive && !st.morningNudged) {
        st.morningNudged = true;
        return { type: 'morning', at: f.t };
      }
      if (h >= EVENING_FROM && ctx.sessionActive && !st.eveningNudged) {
        st.eveningNudged = true;
        return { type: 'evening', at: f.t };
      }
      return null;
    }
    return {
      feed: function (rawFix, ctx) {
        var f = normFix(rawFix);
        if (!f || !isCoord(place)) return null;
        if (f.acc !== null && f.acc > ACC_MAX_M) return null;
        if (f.t <= st.lastT) return null;      // stale / duplicate
        st.lastT = f.t;
        ctx = ctx || {};
        var ds = dayStr(f.t);
        var dayReset = false;
        if (st.date !== ds) {                  // a new day: the two
          st.date = ds;                        // daily asks re-arm
          st.morningNudged = false;
          st.eveningNudged = false;
          dayReset = true;
        }
        var dist = haversineM(place.lat, place.lng, f.lat, f.lng);
        var ev = null;
        if (dist <= FENCE_M) {
          st.exitSince = 0;
          if (st.phase !== 'in') {
            if (!st.enterSince) st.enterSince = f.t;
            if (f.t - st.enterSince >= ENTER_DWELL_MS) {
              st.phase = 'in'; st.enterSince = 0;
              ev = arrivalEval(f, ctx);
            }
          } else if (dayReset) {
            /* First contact of a new day, already inside (the
             * truck slept here; the driver walks up in the
             * morning): the morning ask is still owed. */
            ev = arrivalEval(f, ctx);
          }
        } else if (dist > EXIT_M) {
          st.enterSince = 0;
          if (st.phase === 'in') {
            if (!st.exitSince) st.exitSince = f.t;
            if (f.t - st.exitSince >= EXIT_DWELL_MS) { st.phase = 'out'; st.exitSince = 0; }
          } else { st.phase = 'out'; }
        }
        /* 150–250 m band: neutral — no candidacy starts or dies. */
        return ev;
      },
      phase: function () { return st.phase; },
      snapshot: function () {
        return {
          phase: st.phase, enterSince: st.enterSince, exitSince: st.exitSince,
          lastT: st.lastT, date: st.date,
          morningNudged: st.morningNudged, eveningNudged: st.eveningNudged
        };
      }
    };
  }

  var ENGINE = {
    haversineM: haversineM, isCoord: isCoord, normFix: normFix,
    dayStr: dayStr, createLearner: createLearner, createDetector: createDetector,
    FENCE_M: FENCE_M, ACC_MAX_M: ACC_MAX_M, FRESH_MS: FRESH_MS
  };
  /* PARK-ENGINE-END */

  /* ================= glue ================= */

  var PLACE_KEY = 'park_place';   // synced: {lat,lng,learnedAt,source,points,days}
  var STATE_KEY = 'park_state';   // synced: {learner, det, card, dis}

  function store() {
    try { return (window.App && App._store) || null; } catch (e) { return null; }
  }
  function trackerActive() {
    try {
      var t = window.App && App.tracker;
      return !!(t && (t.status === 'running' || t.status === 'paused'));
    } catch (e) { return false; }
  }
  function lnPlugin() {
    try {
      var p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
      if (p && typeof p.schedule === 'function' && typeof p.checkPermissions === 'function') return p;
    } catch (e) {}
    return null;
  }

  var place = null;          // current park place or null
  var learner = ENGINE.createLearner(null);
  var detector = null;       // created when a place exists
  var card = null;           // 'morning' | 'evening' | null (UI state)
  var dis = { date: '', morning: false, evening: false };
  var lastRawFix = null;     // most recent fix, any source (end edge)
  var pendingStart = false;  // next fix is a session-start edge
  var lastTracker = null;    // last observed tracker status (edges)
  var lastSnapStr = '';
  var lnPermitted = null;    // null = unknown
  var lnWired = false;
  var placeListeners = [];

  function todayStr() { return ENGINE.dayStr(Date.now()); }

  function persist() {
    var s = store(); if (!s) return;
    var snap = {
      learner: learner.snapshot(),
      det: detector ? detector.snapshot() : null,
      card: card, dis: dis
    };
    var str = '';
    try { str = JSON.stringify(snap); } catch (e) {}
    if (str && str !== lastSnapStr) {
      lastSnapStr = str;
      try { s.set(STATE_KEY, snap); } catch (e) {}
    }
  }
  var restored = false;
  function restore() {
    var s = store(); if (!s) return false;
    try {
      var st = s.get(STATE_KEY, null);
      if (st) {
        learner = ENGINE.createLearner(st.learner || null);
        card = (st.card === 'morning' || st.card === 'evening') ? st.card : null;
        if (st.dis && st.dis.date === todayStr()) dis = st.dis;
        var pl = s.get(PLACE_KEY, null);
        if (pl && ENGINE.isCoord(pl)) {
          place = pl;
          detector = ENGINE.createDetector(place, st.det || null);
        }
        lastSnapStr = JSON.stringify({ learner: learner.snapshot(), det: detector ? detector.snapshot() : null, card: card, dis: dis });
      } else {
        var pl2 = s.get(PLACE_KEY, null);
        if (pl2 && ENGINE.isCoord(pl2)) { place = pl2; detector = ENGINE.createDetector(place, null); }
      }
      restored = true;
    } catch (e) {}
    return restored;
  }

  function setPlace(p, source) {
    place = { lat: p.lat, lng: p.lng, learnedAt: Date.now(), source: source, points: p.points || 0, days: p.days || 0 };
    var s = store();
    if (s) { try { s.set(PLACE_KEY, place); } catch (e) {} }
    detector = ENGINE.createDetector(place, detector ? detector.snapshot() : null);
    for (var i = 0; i < placeListeners.length; i++) { try { placeListeners[i](); } catch (e) {} }
    persist(); paint();
  }

  /* ---------- notifications (shell only; feature-detected) ---------- */

  function wireNotifications() {
    var p = lnPlugin();
    if (!p || lnWired) return;
    lnWired = true;
    try {
      if (typeof p.registerActionTypes === 'function') {
        p.registerActionTypes({ types: [
          { id: 'park-morning', actions: [
            { id: 'start-shift', title: '▶ Start shift', foreground: true },
            { id: 'not-now', title: 'Not now', foreground: false } ] },
          { id: 'park-evening', actions: [
            { id: 'end-shift', title: '⏹ Close the day', foreground: true },
            { id: 'not-now', title: 'Not now', foreground: false } ] }
        ] }).catch(function () {});
      }
      if (typeof p.addListener === 'function') {
        p.addListener('localNotificationActionPerformed', function (e) {
          try {
            var kind = (e && e.notification && e.notification.extra && e.notification.extra.kind) || '';
            var act = (e && e.actionId) || 'tap';
            if (act === 'start-shift') {
              dismissCard();
              try { if (window.App && App.tracker && App.tracker.status === 'idle' && App.trackerToggle) App.trackerToggle(); } catch (err) {}
              scrollToCard();
            } else if (act === 'end-shift') {
              dismissCard();
              try { if (window.App && App.trackerStopPrompt) App.trackerStopPrompt(); } catch (err) {}
            } else if (act === 'not-now') {
              dismissKind(kind);
            } else { scrollToCard(); }
          } catch (err) {}
        });
      }
    } catch (e) {}
    refreshPerms();
  }
  function refreshPerms() {
    var p = lnPlugin(); if (!p) { lnPermitted = false; return Promise.resolve(false); }
    return p.checkPermissions().then(function (r) {
      lnPermitted = !!(r && r.display === 'granted');
      return lnPermitted;
    }).catch(function () { return lnPermitted; });
  }
  function postNudge(ev) {
    var p = lnPlugin(); if (!p) return;
    refreshPerms().then(function (ok) {
      if (!ok) return;   // no permission: the in-app card still shows
      var morning = ev.type === 'morning';
      try {
        p.schedule({ notifications: [{
          id: morning ? 7401 : 7402,
          title: morning ? '📍 You\'re where the truck is parked' : '🏠 You\'re back where you park',
          body: morning ? 'Start your shift?' : 'Close your day?',
          actionTypeId: morning ? 'park-morning' : 'park-evening',
          extra: { kind: ev.type }
        }] }).catch(function () {});
      } catch (e) {}
    }).catch(function () {});
  }

  /* ---------- the in-app card (every build) ---------- */

  function cardEl() { try { return document.getElementById('parkCard'); } catch (e) { return null; } }
  function scrollToCard() {
    var el = cardEl();
    if (el) { try { el.scrollIntoView({ block: 'center' }); } catch (e) {} }
  }
  function paint() {
    var el = cardEl(); if (!el) return;
    if (!card || !place) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    var morning = card === 'morning';
    el.innerHTML = '';
    var txt = document.createElement('div');
    txt.className = 'parkTxt';
    txt.textContent = morning
      ? '📍 You\'re where the truck is parked. Start your shift?'
      : '🏠 You\'re back where you park. Close your day?';
    var row = document.createElement('div');
    row.className = 'parkRow';
    var yes = document.createElement('button');
    yes.className = 'btn primary';
    yes.textContent = morning ? '▶ Start shift' : '⏹ Close the day';
    yes.onclick = function () {
      dismissCard();
      try {
        if (morning) { if (window.App && App.trackerToggle) App.trackerToggle(); }
        else if (window.App && App.trackerStopPrompt) App.trackerStopPrompt();
      } catch (e) {}
    };
    var no = document.createElement('button');
    no.className = 'btn ghost';
    no.textContent = 'Not now';
    no.onclick = function () { dismissKind(card); };
    row.appendChild(yes); row.appendChild(no);
    el.appendChild(txt); el.appendChild(row);
    el.classList.remove('hidden');
  }
  function dismissCard() { card = null; persist(); paint(); }
  function dismissKind(kind) {
    if (kind === 'morning' || kind === 'evening') {
      if (dis.date !== todayStr()) dis = { date: todayStr(), morning: false, evening: false };
      dis[kind] = true;
      if (card === kind) card = null;
    } else { card = null; }
    persist(); paint();
  }

  /* ---------- detection feed ---------- */

  function onNudge(ev) {
    if (!(dis.date === todayStr() && dis[ev.type])) {
      card = ev.type;
    }
    postNudge(ev);
    persist(); paint();
  }

  function feedFix(rawFix) {
    var f = ENGINE.normFix(rawFix);
    if (!f) return;
    lastRawFix = rawFix;
    if (pendingStart) {
      pendingStart = false;
      var learned = null;
      try { learned = learner.observe('start', rawFix); } catch (e) {}
      if (learned && !place) setPlace(learned, 'learned');
    }
    if (detector) {
      var ev = null;
      try { ev = detector.feed(rawFix, { sessionActive: trackerActive(), nowMs: Date.now() }); } catch (e) {}
      if (ev) onNudge(ev);
    }
    persist();
  }

  /* Session edges, seen by watching the tracker status (the same
   * fact ShiftTrack keys off). A start edge's first fix and a stop
   * edge's last fix are the learner's points. */
  function pollTracker() {
    var cur = null;
    try { cur = window.App && App.tracker ? App.tracker.status : null; } catch (e) {}
    if (cur === null || cur === undefined) return;
    var active = (cur === 'running' || cur === 'paused');
    var wasActive = (lastTracker === 'running' || lastTracker === 'paused');
    if (lastTracker !== null) {
      if (active && !wasActive) {
        pendingStart = true;
        if (card === 'morning') dismissCard();   // he started: the ask is answered
      } else if (!active && wasActive) {
        if (lastRawFix && (Date.now() - (ENGINE.normFix(lastRawFix) || { t: 0 }).t) < 15 * 60 * 1000) {
          var learned = null;
          try { learned = learner.observe('end', lastRawFix); } catch (e) {}
          if (learned && !place) setPlace(learned, 'learned');
        }
        if (card === 'evening') dismissCard();   // he closed: the ask is answered
        persist();
      }
    }
    lastTracker = cur;
  }

  /* One-shot morning check: opening the app at the park place is
   * the one moment the web layer can see him before a shift. */
  var lastOneShot = 0;
  function oneShot() {
    if (!place) return;
    var now = Date.now();
    if (now - lastOneShot < 60 * 1000) return;
    lastOneShot = now;
    try {
      if (window.MeticulousGeo && MeticulousGeo.available()) {
        MeticulousGeo.getCurrent(9000).then(function (fix) { if (fix) feedFix(fix); }).catch(function () {});
      }
    } catch (e) {}
  }

  /* ---------- wiring ---------- */

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

  var ParkPlace = {
    _engine: ENGINE,

    /* js/shifttrack.js drain hook (same seat as GeoLoads'): native
       breadcrumbs replayed for the live session also feed the
       detector — replayed transitions older than 30 min update the
       state silently and never nudge (engine FRESH_MS). */
    ingestCrumbs: function (crumbs) {
      if (!crumbs || !crumbs.length) return;
      for (var i = 0; i < crumbs.length; i++) {
        var c = crumbs[i];
        if (!c) continue;
        feedFix({ latitude: c.lat, longitude: c.lng, accuracy: c.acc, time: c.t });
      }
    },

    info: function () {
      return {
        place: place,
        notificationsAvailable: !!lnPlugin(),
        notificationsGranted: lnPermitted
      };
    },
    refreshNotifications: function () { wireNotifications(); return refreshPerms(); },
    requestNotifications: function () {
      var p = lnPlugin();
      if (!p) return Promise.resolve(false);
      wireNotifications();
      if (typeof p.requestPermissions !== 'function') return refreshPerms();
      return p.requestPermissions().then(function (r) {
        lnPermitted = !!(r && r.display === 'granted');
        return lnPermitted;
      }).catch(function () { return refreshPerms(); });
    },
    /* Manual fallback: "set where I park" from the current fix. */
    setPlaceHere: function () {
      return new Promise(function (resolve, reject) {
        try {
          if (!window.MeticulousGeo || !MeticulousGeo.available()) { reject(new Error('no-geo')); return; }
          MeticulousGeo.getCurrent(10000).then(function (fix) {
            var f = ENGINE.normFix(fix);
            if (!f) { reject(new Error('no-fix')); return; }
            setPlace({ lat: f.lat, lng: f.lng, points: 0, days: 0 }, 'manual');
            resolve(place);
          }).catch(function () { reject(new Error('no-fix')); });
        } catch (e) { reject(e); }
      });
    },
    forgetPlace: function () {
      place = null; detector = null; card = null;
      learner = ENGINE.createLearner(null);
      var s = store();
      if (s) { try { s.del(PLACE_KEY); } catch (e) {} }
      for (var i = 0; i < placeListeners.length; i++) { try { placeListeners[i](); } catch (e) {} }
      lastSnapStr = '';
      persist(); paint();
    },
    onPlaceChange: function (fn) { if (typeof fn === 'function') placeListeners.push(fn); },
    dismiss: dismissKind,
    paint: paint
  };

  window.ParkPlace = ParkPlace;
  try { if (window.App) window.App.parkPlace = ParkPlace; } catch (e) {}

  restore();
  subscribe();
  wireNotifications();
  try {
    var bootTries = 0;
    var bootTimer = setInterval(function () {
      bootTries++;
      if (!restored && restore()) paint();
      subscribe();
      if ((subscribed && restored) || bootTries > 20) clearInterval(bootTimer);
    }, 500);
    setInterval(pollTracker, 4000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { subscribe(); pollTracker(); oneShot(); paint(); }
    });
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { paint(); oneShot(); });
    } else { paint(); oneShot(); }
  } catch (e) {}
})();
