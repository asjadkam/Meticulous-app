/* Meticulous — live miles tracking + odometer reconciliation (v40).
 *
 * Asjad's design (Oct 13, 2026): LIVE miles are the primary tracking —
 * GPS accumulating during the shift. The odometer subtraction
 * (end − start, from the by-mile day photos) is only the CONFIRMATION.
 * If the margin between the two is reasonable, ignore it. If the
 * difference is too big, the app must find out WHERE the discrepancy
 * is (which segment/time the miles went missing, or a bad odometer
 * read) and show it.
 *
 * Engine (between the MILES-ENGINE markers) is pure JS — no DOM, no
 * store — so the harness can extract and drive it with synthetic fix
 * streams. The browser glue below it wires the engine to App.geo
 * (the free background-geolocation wrapper in js/geo.js), the synced
 * store, the tracker lifecycle (via hooks in js/app.js) and the
 * dashboard's "Miles (live)" line.
 *
 * Honesty rules:
 *  - No geo (old shell / web / permission denied) -> the engine never
 *    starts, the dashboard shows nothing, and a stopped session gets
 *    NO liveKm field at all — never a fake zero.
 *  - Reconciliation runs only when a session has BOTH sources: a real
 *    liveKm AND both odometer readings.
 *  - v63 (native v34): breadcrumbs the native foreground service
 *    OBSERVED while the app was backgrounded/dead are merged back in
 *    (mergeCrumbs) — that is the one exception to "the join segment
 *    is never counted", and only when the service's own record proves
 *    it was running across the kill. True gaps (no observer at all)
 *    are still never guessed.
 *  - v69: the session key is PINNED at session start (app.js
 *    trackerSessionKeyMs). Before that, the key was re-derived from
 *    the tracker's whole-second elapsed on every call, so it
 *    jittered between the start tap and any later relaunch: the
 *    relaunched app found no record under the re-derived key and
 *    "Miles (live)" restarted from 0.0 km while the timer restored
 *    fine (field bug, Oct 14). The glue now also ADOPTS record
 *    fragments the old derivation orphaned under drifted keys —
 *    same day, activity window belonging to this session — folding
 *    them under the live key exactly once (see adoptableFragments).
 */
(function () {
  'use strict';

  /* MILES-ENGINE-BEGIN — pure logic; may use only plain JS + Date.
     Fix shape in:  { latitude, longitude, accuracy, time } (geo.js fix).
     Crumb shape:   { t: <ms>, a: <lat>, o: <lng> } (compact for storage). */

  var ACC_MAX_M = 50;            // drop fixes with accuracy worse than 50 m
  var MIN_STEP_M = 10;           // ignore movement under 10 m (GPS jitter)
  var MAX_SPEED_KMH = 160;       // implied speed above this = bad fix, drop it
  var CRUMB_MIN_MS = 30 * 1000;  // breadcrumb throttle: at least 30 s …
  var CRUMB_MIN_M = 50;          // … AND at least 50 m from the last crumb,
                                 //    whichever comes later
  var GAP_MIN_MS = 10 * 60 * 1000; // a coverage hole longer than 10 minutes …
  var GAP_MIN_KM = 1;              // … spanning >= 1 km counts as a gap
  var OBS_GAP_MAX_MS = 10 * 60 * 1000; // v63: a native-service breadcrumb
                                 // run bridges the relaunch join ONLY when
                                 // its first crumb lands within this of the
                                 // last web-observed fix — proof the service
                                 // was already recording when the app died.
                                 // A later first crumb means the stretch
                                 // before it was NOT observed: never counted.
  var TOL_MIN_KM = 2;              // reconciliation tolerance:
  var TOL_PCT = 0.03;              //   max(2 km, 3% of odometer miles)

  function round2(n) { return Math.round(n * 100) / 100; }

  function haversineM(lat1, lon1, lat2, lon2) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /* The accumulator. One instance lives in the glue; the harness makes
     its own. State survives via snapshot()/begin(key, saved). */
  function createMilesTracker() {
    var S = null;

    function crumbOf(f) {
      return { t: f.time, a: Math.round(f.latitude * 1e6) / 1e6, o: Math.round(f.longitude * 1e6) / 1e6 };
    }
    function maybeCrumb(f) {
      var last = S.crumbs.length ? S.crumbs[S.crumbs.length - 1] : null;
      if (!last) { S.crumbs.push(crumbOf(f)); return true; }
      if (f.time - last.t >= CRUMB_MIN_MS &&
          haversineM(last.a, last.o, f.latitude, f.longitude) >= CRUMB_MIN_M) {
        S.crumbs.push(crumbOf(f));
        return true;
      }
      return false;
    }

    return {
      /* saved: a previous snapshot() for the same session key (relaunch
         resume). On resume the saved anchor is kept but the JOIN segment
         (last fix before the kill -> first fix after) is never counted:
         that stretch was not observed, and it belongs to the gap finder,
         not to the live total. */
      begin: function (key, saved) {
        S = {
          key: key, active: true, totalM: 0, anchor: null,
          crumbs: [], hasFix: false, joinZero: false
        };
        if (saved) {
          S.totalM = (typeof saved.totalM === 'number' && saved.totalM > 0) ? saved.totalM : 0;
          if (saved.crumbs && saved.crumbs.length) S.crumbs = saved.crumbs.slice();
          S.hasFix = !!saved.hasFix;
          if (saved.anchor && isFinite(saved.anchor.latitude) && isFinite(saved.anchor.longitude)) {
            S.anchor = {
              time: saved.anchor.time,
              latitude: saved.anchor.latitude,
              longitude: saved.anchor.longitude
            };
            S.joinZero = true;
          }
        }
        return S.key;
      },
      /* Feed one fix. Returns { accepted, addedM, why? }. */
      ingest: function (fix) {
        if (!S || !S.active) return { accepted: false, why: 'inactive' };
        if (!fix || !isFinite(fix.latitude) || !isFinite(fix.longitude)) {
          return { accepted: false, why: 'bad-fix' };
        }
        if (fix.accuracy !== null && fix.accuracy !== undefined && fix.accuracy > ACC_MAX_M) {
          return { accepted: false, why: 'accuracy' };
        }
        var t = (typeof fix.time === 'number' && fix.time > 0) ? fix.time : 0;
        if (!t) return { accepted: false, why: 'no-time' };
        var f = { time: t, latitude: +fix.latitude, longitude: +fix.longitude };
        if (!S.anchor) {
          S.anchor = f;
          S.hasFix = true;
          maybeCrumb(f);
          return { accepted: true, addedM: 0, first: true };
        }
        if (f.time <= S.anchor.time) return { accepted: false, why: 'stale' };
        var d = haversineM(S.anchor.latitude, S.anchor.longitude, f.latitude, f.longitude);
        if (S.joinZero) {
          // First fix after a relaunch: re-anchor WITHOUT counting the
          // unobserved join segment (no double-count, no invented miles).
          S.anchor = f;
          S.joinZero = false;
          S.hasFix = true;
          maybeCrumb(f);
          return { accepted: true, addedM: 0, joined: true };
        }
        if (d < MIN_STEP_M) return { accepted: false, why: 'jitter' }; // anchor stays put
        var dtH = (f.time - S.anchor.time) / 3600000;
        if ((d / 1000) / dtH > MAX_SPEED_KMH) return { accepted: false, why: 'teleport' };
        S.totalM += d;
        S.anchor = f;
        S.hasFix = true;
        maybeCrumb(f);
        return { accepted: true, addedM: d };
      },
      /* v63: fold a run of NATIVE-SERVICE breadcrumbs into the total.
         The Android foreground service (native v34) records timestamped
         fixes { t, a, o, c } to app-local storage while the session
         runs — including while the WebView is dead. On resume the glue
         hands the unprocessed run here.
         Merge rules (idempotent — safe to re-feed the same run):
          - crumbs are normalized to fixes and sorted by time;
          - a crumb at or before the current anchor's time was already
            observed (by the live stream or an earlier merge): skipped.
            Segments are always counted anchor -> next point in time
            order, so two streams can never double-count a stretch;
          - the relaunch JOIN (joinZero, set by begin() on a saved
            record) is counted ONLY when the run proves the service
            observed it: the first newer crumb lands within
            OBS_GAP_MAX_MS of the anchor. Otherwise ingest's own join
            rule applies — re-anchor, count nothing for the join;
          - every later segment goes through the SAME filters as a
            live fix (accuracy, jitter, teleport), so a hole inside
            the service's own run is treated exactly like a hole in
            the live stream (counted only if speed-plausible; the gap
            finder still reports it).
         Returns { accepted, addedM, skipped, gapJoins }. */
      mergeCrumbs: function (crumbsIn) {
        var res = { accepted: 0, addedM: 0, skipped: 0, gapJoins: 0 };
        if (!crumbsIn || !crumbsIn.length) return res;
        if (!S || !S.active) { res.skipped = crumbsIn.length; return res; }
        var list = [];
        for (var i = 0; i < crumbsIn.length; i++) {
          var c = crumbsIn[i];
          if (!c || !isFinite(+c.t) || !(+c.t > 0) || !isFinite(+c.a) || !isFinite(+c.o)) {
            res.skipped++; continue;
          }
          var acc = (c.c === null || c.c === undefined || +c.c < 0) ? null : +c.c;
          list.push({ time: +c.t, latitude: +c.a, longitude: +c.o, accuracy: acc });
        }
        list.sort(function (x, y) { return x.time - y.time; });
        var joinPending = !!S.joinZero;
        for (var j = 0; j < list.length; j++) {
          var f = list[j];
          if (S.anchor && isFinite(f.time) && f.time <= S.anchor.time) {
            res.skipped++; // already observed — dedupe by timestamp
            continue;
          }
          if (joinPending) {
            joinPending = false;
            if (S.anchor && f.time - S.anchor.time <= OBS_GAP_MAX_MS) {
              // The service was recording across the kill: the join
              // segment was genuinely observed. Clear the join flag so
              // ingest counts it like any other observed segment.
              S.joinZero = false;
            } else {
              res.gapJoins++; // unobserved stretch: ingest re-anchors free
            }
          }
          var r = this.ingest(f);
          if (r.accepted) { res.accepted++; res.addedM += r.addedM || 0; }
          else res.skipped++;
        }
        return res;
      },
      /* Append the final position as a crumb so the gap finder has an
         end point for the day. */
      flushCrumb: function () {
        if (!S || !S.anchor) return false;
        var last = S.crumbs.length ? S.crumbs[S.crumbs.length - 1] : null;
        if (last && last.t === S.anchor.time) return false;
        S.crumbs.push(crumbOf(S.anchor));
        return true;
      },
      stop: function () { if (S) S.active = false; },
      snapshot: function () {
        if (!S) return null;
        return {
          key: S.key,
          totalM: S.totalM,
          anchor: S.anchor ? { time: S.anchor.time, latitude: S.anchor.latitude, longitude: S.anchor.longitude } : null,
          crumbs: S.crumbs.slice(),
          hasFix: S.hasFix
        };
      },
      totalM: function () { return S ? S.totalM : 0; },
      hasFix: function () { return !!(S && S.hasFix); },
      isActive: function () { return !!(S && S.active); },
      key: function () { return S ? S.key : null; },
      crumbs: function () { return S ? S.crumbs.slice() : []; }
    };
  }

  /* Coverage gaps in a day's breadcrumbs: consecutive crumbs separated
     by more than GAP_MIN_MS whose straight-line span is significant.
     Biggest first. approxKm is the straight-line distance between the
     gap's endpoints — a floor for the road miles that went untracked. */
  function analyzeGaps(crumbs) {
    var gaps = [];
    if (!crumbs || crumbs.length < 2) return gaps;
    for (var i = 1; i < crumbs.length; i++) {
      var a = crumbs[i - 1], b = crumbs[i];
      if (b.t - a.t > GAP_MIN_MS) {
        var dKm = haversineM(a.a, a.o, b.a, b.o) / 1000;
        if (dKm >= GAP_MIN_KM) {
          gaps.push({
            fromTs: a.t, toTs: b.t, approxKm: round2(dKm),
            fromLat: a.a, fromLng: a.o, toLat: b.a, toLng: b.o
          });
        }
      }
    }
    gaps.sort(function (x, y) { return y.approxKm - x.approxKm; });
    return gaps;
  }

  /* Reconciliation (Asjad's rule): live miles are the tracking; the
     odometer difference only confirms. Small margin -> "confirmed"
     (stored, shown nowhere). Big difference -> "discrepancy" with the
     gap list and an odometer-suspicion verdict.
     input: { liveKm, startOdo, endOdo, crumbs } -> report | null */
  function reconcileMiles(input) {
    if (!input) return null;
    var s = parseFloat(input.startOdo), e = parseFloat(input.endOdo);
    if (!(s > 0) || !(e > 0)) return null;
    var liveKm = round2(Math.max(0, parseFloat(input.liveKm) || 0));
    var odoKm = round2(e - s);
    var gaps = analyzeGaps(input.crumbs || []);
    var gapKm = round2(gaps.reduce(function (sum, g) { return sum + g.approxKm; }, 0));
    var rep = {
      liveKm: liveKm, odoKm: odoKm, gaps: gaps, gapKm: gapKm,
      diffKm: round2(liveKm - odoKm), toleranceKm: 0,
      odometerSuspect: false, suspectReason: null, status: null
    };
    if (e <= s) {
      rep.status = 'discrepancy';
      rep.odometerSuspect = true;
      rep.suspectReason = 'end-not-after-start';
      return rep;
    }
    var tol = Math.max(TOL_MIN_KM, TOL_PCT * odoKm);
    rep.toleranceKm = round2(tol);
    if (Math.abs(rep.diffKm) <= tol) {
      rep.status = 'confirmed';
      return rep;
    }
    rep.status = 'discrepancy';
    if (rep.diffKm < 0) {
      var missing = -rep.diffKm;
      // The gaps explain the hole when their straight-line span covers
      // at least half of what's missing. When they can't, the odometer
      // side is the suspect (e.g. a reading taken off the trip meter).
      if (missing - gapKm > Math.max(10, missing * 0.5)) {
        rep.odometerSuspect = true;
        rep.suspectReason = 'gaps-cannot-explain';
      } else {
        rep.suspectReason = 'tracking-gap';
      }
    } else {
      // Live tracking counted MORE than the odometer shows — the truck
      // can't out-drive its own odometer; a reading is the likely error.
      rep.odometerSuspect = true;
      rep.suspectReason = 'live-exceeds-odometer';
    }
    return rep;
  }

  function fmtTimeOfDay(ts) {
    var d = new Date(ts), h = d.getHours(), m = d.getMinutes();
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + ('0' + m).slice(-2) + ' ' + ap;
  }
  function fmtKm(n) { return String(Math.round((+n || 0) * 10) / 10); }

  /* Plain-language explanation lines for the discrepancy UI. */
  function reportLines(rep) {
    if (!rep) return [];
    var lines = [];
    lines.push('Live tracking counted ' + fmtKm(rep.liveKm) + ' km · odometer shows ' +
      fmtKm(rep.odoKm) + ' km · difference ' + (rep.diffKm > 0 ? '+' : '') + fmtKm(rep.diffKm) + ' km.');
    (rep.gaps || []).forEach(function (g) {
      lines.push('≈' + fmtKm(g.approxKm) + ' km untracked between ' +
        fmtTimeOfDay(g.fromTs) + ' and ' + fmtTimeOfDay(g.toTs) + '.');
    });
    if (rep.odometerSuspect) {
      if (rep.suspectReason === 'end-not-after-start') {
        lines.push('The ending odometer reading is not higher than the starting one — one of the readings was likely photographed or typed wrong.');
      } else if (rep.suspectReason === 'live-exceeds-odometer') {
        lines.push('Live tracking counted more than the odometer shows — an odometer reading may have been read wrong (for example, the trip meter instead of the total).');
      } else {
        lines.push('The untracked stretches above can\'t explain a difference this big — an odometer reading may be wrong.');
      }
    } else if (rep.gaps && rep.gaps.length) {
      lines.push('The untracked stretch above most likely explains the difference.');
    }
    return lines;
  }

  var ENGINE = {
    haversineM: haversineM,
    createMilesTracker: createMilesTracker,
    analyzeGaps: analyzeGaps,
    reconcileMiles: reconcileMiles,
    fmtTimeOfDay: fmtTimeOfDay,
    reportLines: reportLines,
    ACC_MAX_M: ACC_MAX_M, MIN_STEP_M: MIN_STEP_M, MAX_SPEED_KMH: MAX_SPEED_KMH,
    CRUMB_MIN_MS: CRUMB_MIN_MS, CRUMB_MIN_M: CRUMB_MIN_M,
    GAP_MIN_MS: GAP_MIN_MS, GAP_MIN_KM: GAP_MIN_KM,
    OBS_GAP_MAX_MS: OBS_GAP_MAX_MS
  };
  /* MILES-ENGINE-END */

  /* WAKE-HOLD-BEGIN — session screen wake lock (v62) + geo-watch
     liveness verdict. Pure logic; the environment is injected so the
     harness can drive it:
       env.supported()  -> bool   (Screen Wake Lock API present)
       env.request()    -> Promise<sentinel>  (wakeLock.request('screen'))
       env.isVisible()  -> bool   (document currently visible)
       env.now()        -> ms     (optional; defaults to Date.now)
       env.onState()    -> void   (optional paint hook)
     sentinel shape: { released, release(), addEventListener? }.
     Rules:
      - The lock is wanted ONLY while a work session is running —
        holding the screen of a dash-mounted phone is what keeps the
        app (and its GPS watch) alive for by-the-mile drivers.
      - The OS drops the lock whenever the document hides, and may
        drop it while still visible (battery saver): the release
        event clears our handle, and a still-wanted, still-visible
        session takes it back (rate-limited so a flapping sentinel
        cannot spin). A hidden document is re-acquired on return
        via visible().
      - A refused or unsupported request is silent — never an
        exception, never a fake "held" state (old browsers and
        iPhone/Safari simply have no lock; everything else works). */
  var WAKE_REACQUIRE_MIN_MS = 1000;   // release-driven re-acquire throttle
  var WATCH_QUIET_MS = 5 * 60 * 1000; // a fix stream silent this long is "quiet"

  function createWakeHold(env) {
    var wanted = false;
    var sentinel = null;
    var lastTry = 0;

    function nowMs() { return (env && typeof env.now === 'function') ? env.now() : Date.now(); }
    function notify() { if (env && typeof env.onState === 'function') { try { env.onState(); } catch (e) {} } }
    function held() { return !!(wanted && sentinel && !sentinel.released); }

    function onRelease() {
      sentinel = null;
      notify();
      if (wanted && env.isVisible()) acquire(true);
    }
    function acquire(fromRelease) {
      if (!wanted) return;
      if (sentinel && !sentinel.released) return;
      sentinel = null;
      if (!env.supported()) return;
      if (!env.isVisible()) return; // the OS refuses hidden requests anyway
      var t = nowMs();
      if (fromRelease && t - lastTry < WAKE_REACQUIRE_MIN_MS) return;
      lastTry = t;
      var p;
      try { p = env.request(); } catch (e) { return; }
      if (!p || typeof p.then !== 'function') return;
      p.then(function (s) {
        if (!s) { notify(); return; }
        if (!wanted) {
          // The session ended while the request was in flight: hand
          // the lock straight back instead of holding the screen.
          try { var r = s.release(); if (r && typeof r.catch === 'function') r.catch(function () {}); } catch (e) {}
          notify();
          return;
        }
        sentinel = s;
        if (typeof s.addEventListener === 'function') {
          try { s.addEventListener('release', onRelease); } catch (e) {}
        } else if ('onrelease' in s) {
          try { s.onrelease = onRelease; } catch (e) {}
        }
        notify();
      }).catch(function () { notify(); }); // refused: stay unheld, no noise
    }

    return {
      /* A session is running: hold the screen. */
      want: function () { wanted = true; acquire(false); notify(); },
      /* Session paused / stopped / gone: let the screen sleep. */
      unwant: function () {
        wanted = false;
        var s = sentinel; sentinel = null;
        if (s) {
          try { var r = s.release(); if (r && typeof r.catch === 'function') r.catch(function () {}); } catch (e) {}
        }
        notify();
      },
      /* The document is visible again: the OS will have dropped the
         lock while we were hidden — take it back if still wanted. */
      visible: function () { if (wanted) acquire(false); },
      held: held,
      wanted: function () { return wanted; },
      state: function () {
        var sup = false;
        try { sup = !!env.supported(); } catch (e) {}
        return { wanted: wanted, held: held(), supported: sup };
      }
    };
  }

  /* Watch-liveness verdict for a live session's geo stream, from
     readings the glue supplies. Dead when our own flag says the
     watcher stopped (or errored), when the geo layer reports no
     watcher beneath us, or when no fix has arrived for WATCH_QUIET_MS
     since the later of (stream start, last fix). A null geoWatching
     (the geo layer can't say) never convicts on its own. */
  function watchLooksDead(r) {
    if (!r || !r.dayActive) return false;
    if (!r.watching || r.broken) return true;
    if (r.geoWatching === false) return true;
    var ref = Math.max(r.lastFixAt || 0, r.watchBornAt || 0);
    if (ref > 0 && r.now - ref > WATCH_QUIET_MS) return true;
    return false;
  }

  var WAKEHOLD = {
    createWakeHold: createWakeHold,
    watchLooksDead: watchLooksDead,
    WAKE_REACQUIRE_MIN_MS: WAKE_REACQUIRE_MIN_MS,
    WATCH_QUIET_MS: WATCH_QUIET_MS
  };
  /* WAKE-HOLD-END */

  /* ---------------- browser glue ----------------
     Store key 'livemiles' (mt_livemiles, synced via cloudsync):
       { days: { 's<sessionStartMs>': { key, date, totalM, anchor,
                                        crumbs, hasFix, updatedAt } } }
     Keyed by the session's start timestamp, so two shifts in one day
     never mix, and a relaunch finds the same record via
     trackerSessionStartMs(). Records are pruned after 14 days. */
  var STORE_KEY = 'livemiles';
  var PERSIST_MIN_MS = 10000;
  var PRUNE_MS = 14 * 86400000;

  var engine = createMilesTracker();
  var watching = false;
  var broken = false;      // geo errored (e.g. permission) — stay honest, show nothing
  var dayKey = null;
  var dayDate = null;
  var lastPersist = 0;
  var lastPaint = '';
  var lastFixAt = 0;       // v62: arrival time of the last watcher fix
  var watchBornAt = 0;     // v62: when the current watch (re)started

  /* v62: the session wake lock (see WAKE-HOLD above). The lock belongs
     to the SESSION, not the watcher: while a session runs, the screen
     stays lit so a dash-mounted phone does not sleep the app — and
     with it the GPS watch — away mid-shift. Geo availability does NOT
     gate it; where the API does not exist (older browsers, iPhone
     Safari) the hold is a clean no-op and everything else is unchanged. */
  var wakeHold = createWakeHold({
    supported: function () {
      try { return !!('wakeLock' in navigator && navigator.wakeLock && typeof navigator.wakeLock.request === 'function'); }
      catch (e) { return false; }
    },
    request: function () { return navigator.wakeLock.request('screen'); },
    isVisible: function () {
      try { return document.visibilityState === 'visible'; } catch (e) { return true; }
    },
    onState: function () { paintWake(); }
  });
  /* v70: the wake chip is DYNAMIC, not a snapshot. It is re-derived
     from the wake hold's LIVE state on every paint — the onState
     notify above for instant response to acquire/release, and
     LiveMiles.paint() (driven by app.js's 1s tracker tick and by
     every incoming fix) for continuous reconciliation while the
     dashboard sits open. Before v70 the chip was only repainted on
     discrete events, so a state change no event announced (the
     anti-flap throttle swallowing a release-driven re-acquire, a
     refused request, any drift at all) left it frozen at whatever
     it last said — a label that never changes teaches the driver
     to ignore it. Three truthful states now:
       held -> "🔒 Screen held" (paints the moment the hold lands)
       wanted + supported + NOT held, persisting past the v62
         re-acquire grace (WAKE_REACQUIRE_MIN_MS — the same
         anti-flap window, so a release already being re-taken
         never strobes a warning) ->
         "🔓 Screen not held — the app may sleep"
       anything else (no session, lock API unsupported — the v62
         clean no-op — or inside the grace window) -> nothing.
     The chip never claims "held" for a lock that is not held. */
  var lastWakePaint = '';
  var wakeUnheldSince = 0;
  function paintWake() {
    var elm = null;
    try { elm = document.getElementById('trkWake'); } catch (e) {}
    if (!elm) return;
    var st = wakeHold.state();
    var mode = '', txt = '';
    if (st.wanted && st.held) {
      wakeUnheldSince = 0;
      mode = 'held'; txt = '🔒 Screen held';
    } else if (st.wanted && st.supported) {
      if (!wakeUnheldSince) wakeUnheldSince = Date.now();
      if (Date.now() - wakeUnheldSince >= WAKE_REACQUIRE_MIN_MS) {
        mode = 'unheld'; txt = '🔓 Screen not held — the app may sleep';
      }
    } else {
      wakeUnheldSince = 0;
    }
    var sig = mode + '|' + txt;
    if (sig === lastWakePaint) return;
    lastWakePaint = sig;
    elm.textContent = txt;
    elm.classList.toggle('hidden', !mode);
  }
  function sessionRunning() {
    try { var t = window.App && App.tracker; return !!(t && t.status === 'running'); } catch (e) { return false; }
  }

  function store() {
    try { return (window.App && App._store) || null; } catch (e) { return null; }
  }
  function geoApi() {
    try { return (window.App && App.geo) || window.MeticulousGeo || null; } catch (e) { return null; }
  }
  function loadAll() {
    var s = store();
    var d = s ? s.get(STORE_KEY, null) : null;
    if (!d || typeof d !== 'object' || !d.days) d = { days: {} };
    return d;
  }
  function recordFor(key) {
    if (!key) return null;
    var d = loadAll();
    return d.days[key] || null;
  }

  /* v69: orphan adoption (see the header note). A record fragment is
     adoptable when ALL of these hold:
       - it is not the live key's own record;
       - it belongs to the SAME day (its stored date matches);
       - it holds real observed distance (a fix-backed total or
         breadcrumbs);
       - its activity window belongs to THIS session: the last
         activity is at/after the session's start (10 min slack),
         and the first activity is not long before it (1 h slack —
         a driver may have begun shortly before the backdated start
         an Edit produced). An earlier, already-finished session's
         record therefore never leaks into a later one.
     Returns [{ key, rec, totalM, lastT }] — possibly empty. */
  var ADOPT_LAST_SLACK_MS = 10 * 60 * 1000;
  var ADOPT_FIRST_SLACK_MS = 60 * 60 * 1000;
  function adoptableFragments(dateStr, sessionStartMs, ownKey) {
    var d = loadAll();
    var out = [];
    Object.keys(d.days).forEach(function (k) {
      if (k === ownKey) return;
      var rec = d.days[k];
      if (!rec || rec.date !== dateStr || !rec.hasFix) return;
      var total = (typeof rec.totalM === 'number' && rec.totalM > 0) ? rec.totalM : 0;
      var crumbs = (rec.crumbs && rec.crumbs.length) ? rec.crumbs : [];
      if (!total && !crumbs.length) return;
      var firstT = Infinity, lastT = 0;
      for (var i = 0; i < crumbs.length; i++) {
        var ct = crumbs[i] && crumbs[i].t;
        if (typeof ct === 'number' && ct > 0) {
          if (ct < firstT) firstT = ct;
          if (ct > lastT) lastT = ct;
        }
      }
      if (rec.anchor && typeof rec.anchor.time === 'number' && rec.anchor.time > 0) {
        if (rec.anchor.time < firstT) firstT = rec.anchor.time;
        if (rec.anchor.time > lastT) lastT = rec.anchor.time;
      }
      if (!lastT) return;
      if (!isFinite(firstT)) firstT = lastT;
      if (lastT < sessionStartMs - ADOPT_LAST_SLACK_MS) return;
      if (firstT < sessionStartMs - ADOPT_FIRST_SLACK_MS) return;
      out.push({ key: k, rec: rec, totalM: total, lastT: lastT });
    });
    return out;
  }
  function dropRecords(keys) {
    var s = store();
    if (!s || !keys || !keys.length) return;
    var d = loadAll(), moved = false;
    keys.forEach(function (k) { if (d.days[k]) { delete d.days[k]; moved = true; } });
    if (moved) { try { s.set(STORE_KEY, d); } catch (e) {} }
  }
  function persist(force) {
    var s = store();
    if (!s || !dayKey) return;
    var now = Date.now();
    if (!force && now - lastPersist < PERSIST_MIN_MS) return;
    lastPersist = now;
    var snap = engine.snapshot();
    if (!snap) return;
    snap.date = dayDate;
    snap.updatedAt = now;
    var d = loadAll();
    d.days[dayKey] = snap;
    // prune old session records
    Object.keys(d.days).forEach(function (k) {
      var rec = d.days[k];
      if (!rec || !rec.updatedAt || now - rec.updatedAt > PRUNE_MS) delete d.days[k];
    });
    try { s.set(STORE_KEY, d); } catch (e) {}
  }

  /* v50: raw-fix subscribers (geofence load counting, js/geoloads.js).
     Subscribers receive EVERY watcher fix BEFORE the miles engine's
     own filtering — the miles engine drops sub-10 m "jitter" fixes,
     which would starve a dwell timer parked at a site. Each consumer
     applies its own accuracy/stale rules (the geoloads engine does).
     A throwing subscriber must never break miles tracking. */
  var fixSubs = [];
  function notifySubs(fix) {
    for (var i = 0; i < fixSubs.length; i++) {
      try { fixSubs[i](fix); } catch (e) {}
    }
  }

  function onFix(fix) {
    lastFixAt = Date.now(); // v62: the stream is alive — remember when
    notifySubs(fix);
    var r = engine.ingest(fix);
    if (r.accepted) { persist(false); paint(); }
  }
  function onGeoError() {
    // Permission denied / plugin error: stop pretending. Accumulated
    // miles so far stay stored; the dashboard line hides (no fake data).
    broken = true;
    watching = false;
    paint();
  }

  function paint() {
    paintWake(); // v70: reconcile the wake chip from live state on every paint
    var elm = null;
    try { elm = document.getElementById('trkMiles'); } catch (e) {}
    if (!elm) return;
    var show = watching && !broken;
    var txt = show ? '🛣 Miles (live): ' + (Math.round(engine.totalM() / 100) / 10).toFixed(1) + ' km' : '';
    var sig = (show ? '1' : '0') + '|' + txt;
    if (sig === lastPaint) return;
    lastPaint = sig;
    elm.textContent = txt;
    elm.classList.toggle('hidden', !show);
  }

  var LiveMiles = {
    _engine: ENGINE,

    available: function () {
      var g = geoApi();
      return !!(g && g.available());
    },

    /* Begin (or reattach) live tracking for a session.
       key: 's<sessionStartMs>'; opts.resume: restore the persisted
       record — the join segment is not counted (see engine.begin). */
    startDay: function (key, opts) {
      if (!key) return false;
      // v62: the screen hold follows the SESSION (see the glue note
      // above), so it is wanted here — before the geo checks — and a
      // build without live location still keeps a running shift's
      // screen lit. sessionRunning() is the only gate.
      if (sessionRunning()) wakeHold.want();
      if (watching && dayKey === key && !broken) { paint(); return true; }
      var g = geoApi();
      if (!g || !g.available()) return false; // inert — no watcher, no display
      if (watching && dayKey !== key) {
        // A different session is somehow live: close it out first.
        try { g.stop(); } catch (e) {}
        watching = false;
      }
      dayKey = key;
      broken = false;
      var keyMs = parseInt(String(key).slice(1), 10) || Date.now();
      var saved = recordFor(key);
      dayDate = (function () { var d = new Date(keyMs); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); })();
      // v69: no record under this session's (pinned) key — the old
      // drifting key derivation may have orphaned this session's
      // record under a start-tap key earlier today. Adopt those
      // fragments (adoptableFragments): the largest supplies the
      // saved snapshot; the rest contribute only breadcrumbs through
      // mergeCrumbs, whose timestamp dedupe keeps the fold
      // exactly-once. The healed record is then persisted under the
      // live key and the fragment keys retired, so no later relaunch
      // can fold the same miles twice.
      var adoptedFrom = [];
      if (!saved) {
        var frags = adoptableFragments(dayDate, keyMs, key);
        if (frags.length) {
          frags.sort(function (x, y) { return (y.totalM - x.totalM) || (y.lastT - x.lastT); });
          saved = frags[0].rec;
          adoptedFrom = frags;
        }
      }
      if (saved && saved.date) dayDate = saved.date;
      // A record under this key can only belong to THIS session (the key
      // is its pinned start identity), so restoring it is always right —
      // the engine's join rule keeps a relaunch from double-counting.
      engine.begin(key, saved);
      watching = true;
      paint();
      if (adoptedFrom.length) {
        for (var fi = 1; fi < adoptedFrom.length; fi++) {
          var frec = adoptedFrom[fi].rec;
          if (frec.crumbs && frec.crumbs.length) {
            try { engine.mergeCrumbs(frec.crumbs); } catch (e) {}
          }
        }
        persist(true);
        dropRecords(adoptedFrom.map(function (f) { return f.key; }));
        paint();
      }
      g.start(onFix, onGeoError).then(function (ok) {
        if (!ok) { watching = false; broken = true; paint(); }
        else { watchBornAt = Date.now(); }
      }).catch(function () { watching = false; broken = true; paint(); });
      return true;
    },

    /* Session stopped: watcher off, final crumb appended, record
       persisted. Returns { liveKm, key } — liveKm is null when no fix
       was ever accepted (no data is NOT 0 miles). */
    stopDay: function () {
      wakeHold.unwant(); // v62: the session is over — the screen may sleep
      var out = { liveKm: null, key: dayKey };
      if (dayKey) {
        try { engine.flushCrumb(); } catch (e) {}
        persist(true);
        if (engine.hasFix()) out.liveKm = Math.round(engine.totalM() / 10) / 100;
      }
      if (watching) {
        watching = false;
        var g = geoApi();
        if (g) { try { g.stop(); } catch (e) {} }
      }
      engine.stop();
      dayKey = null;
      paint();
      return out;
    },

    flush: function () { persist(true); },
    paint: paint,

    /* v69: the live session's record key, or null when no day has
       been begun in this page life. js/shifttrack.js checks it
       before acking native breadcrumbs: a drain that wins the race
       against the boot-time startDay must not delete crumbs the
       live engine is not yet there to fold. */
    dayKey: function () { return dayKey; },

    /* v62: app.js calls this after every tracker transition so the
       screen hold tracks the session exactly: running holds it,
       paused / idle releases it. startDay/stopDay already want/unwant
       at the ends of a shift; this covers pause and resume. */
    syncWake: function () {
      if (sessionRunning()) wakeHold.want();
      else wakeHold.unwant();
      paintWake();
    },

    /* v62: the app returned to the foreground (app.js's
       visibilitychange handler calls this). Two revivals for a
       RUNNING session:
        1. The wake lock — the OS dropped it while we were hidden;
           wakeHold.visible() takes it back.
        2. The geo watch — if it died underneath us or its fix stream
           went quiet while we were away, restart it through the
           ordinary reattach path. State is persisted first, and the
           restart goes through engine.begin(), so the join segment
           across the restart is NOT counted: unobserved distance is
           never guessed, exactly as a relaunch is treated. */
    onVisible: function () {
      wakeHold.visible();
      paintWake();
      if (!dayKey || !sessionRunning()) return;
      var g = geoApi();
      var dead = watchLooksDead({
        dayActive: true,
        watching: watching, broken: broken,
        geoWatching: (g && typeof g.isWatching === 'function') ? !!g.isWatching() : null,
        lastFixAt: lastFixAt, watchBornAt: watchBornAt, now: Date.now()
      });
      if (!dead) return;
      persist(true); // freshest snapshot for the reattach to restore
      watching = false;
      broken = false;
      if (g) { try { g.stop(); } catch (e) {} }
      LiveMiles.startDay(dayKey, { resume: true });
    },

    /* Harness handle (mirrors LiveMiles._engine): the wake-hold state
       machine this build is actually running. */
    _wakeHold: wakeHold,

    /* v50: subscribe to the raw watcher fix stream (see notifySubs).
       Fires only while a session watcher is live — the same window
       LiveMiles itself tracks in. */
    subscribe: function (fn) {
      if (typeof fn === 'function' && fixSubs.indexOf(fn) === -1) fixSubs.push(fn);
    },

    /* v41: the live total for the dynamic tracker's Miles dial.
       Returns km (2dp) once at least one fix has been accepted; null
       before that — no data is NOT 0 miles, and the dial shows '—'
       (odometer-anchored) instead of a fake zero. */
    currentKm: function () {
      if (!engine.hasFix()) return null;
      return Math.round(engine.totalM() / 10) / 100;
    },
    flowing: function () { return watching && !broken && engine.hasFix(); },

    crumbsFor: function (key) {
      var rec = recordFor(key);
      return rec && rec.crumbs ? rec.crumbs : [];
    },

    /* v63 (native v34): fold native-service breadcrumbs for the LIVE
       session into the engine. Only meaningful while this session's
       day is active — the native run belongs to the session the
       service is recording, and the glue (js/shifttrack.js) drains it
       for exactly that key. Persists + repaints when anything landed.
       Returns the engine's merge result, or null when inert. */
    mergeNativeCrumbs: function (crumbs) {
      if (!dayKey || !crumbs || !crumbs.length) return null;
      var r = engine.mergeCrumbs(crumbs);
      if (r.accepted > 0) { persist(true); paint(); }
      return r;
    },

    /* v63: the persisted live-km total for a session key (2dp), from
       the stored record — used by the stop-time patch in
       js/shifttrack.js when a final drain lands after the session
       entry was already written. null when no record / no fix. */
    recordKmFor: function (key) {
      var rec = recordFor(key);
      if (!rec || !rec.hasFix || typeof rec.totalM !== 'number') return null;
      return Math.round(rec.totalM / 10) / 100;
    },

    /* Run the reconciliation on a session entry (mutates it: sets
       milesStatus + milesReport). Only with BOTH sources present:
       a real liveKm AND both odometer readings. Returns true when a
       verdict was stored. */
    reconcileSession: function (session) {
      if (!session) return false;
      if (typeof session.liveKm !== 'number') return false;
      if (!(parseFloat(session.startOdo) > 0) || !(parseFloat(session.endOdo) > 0)) return false;
      var rep = ENGINE.reconcileMiles({
        liveKm: session.liveKm,
        startOdo: session.startOdo,
        endOdo: session.endOdo,
        crumbs: session.milesKey ? LiveMiles.crumbsFor(session.milesKey) : []
      });
      if (!rep) return false;
      session.milesStatus = rep.status;
      session.milesReport = rep;
      return true;
    },

    reportLines: ENGINE.reportLines
  };

  window.LiveMiles = LiveMiles;
  try { if (window.App) window.App.liveMiles = LiveMiles; } catch (e) {}
})();
