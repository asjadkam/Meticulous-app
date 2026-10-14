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
    GAP_MIN_MS: GAP_MIN_MS, GAP_MIN_KM: GAP_MIN_KM
  };
  /* MILES-ENGINE-END */

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

  function onFix(fix) {
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
      var saved = recordFor(key);
      dayDate = saved && saved.date ? saved.date
        : (function () { var d = new Date(parseInt(String(key).slice(1), 10) || Date.now()); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); })();
      // A record under this key can only belong to THIS session (the key
      // is its start timestamp), so restoring it is always right — the
      // engine's join rule keeps a relaunch from double-counting.
      engine.begin(key, saved);
      watching = true;
      paint();
      g.start(onFix, onGeoError).then(function (ok) {
        if (!ok) { watching = false; broken = true; paint(); }
      }).catch(function () { watching = false; broken = true; paint(); });
      return true;
    },

    /* Session stopped: watcher off, final crumb appended, record
       persisted. Returns { liveKm, key } — liveKm is null when no fix
       was ever accepted (no data is NOT 0 miles). */
    stopDay: function () {
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
