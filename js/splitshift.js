/* Meticulous — SPLIT-SHIFT day engine (web v355,
 * SPLIT-SHIFT-BUS-DRIVER-MARKET, owner Nov 6, 2026: "Design this
 * app with Niro's bus job in mind... the app has to figure out 2
 * separate times to stop and has to figure out how to pause that
 * by itself in the middle of it. Perhaps by the home address she
 * stops or the other drivers stop at their yard." — and at 05:31:
 * "Start that work now! I am planning for her to use it").
 *
 * The mode is a driver preference (Preferences -> Pay -> "Work
 * pattern": Standard / Split shift — onboarding.workPattern). In
 * split mode the day runs as TWO work blocks — a morning run and
 * an afternoon run — and the day's paid time is the two blocks
 * added together; the midday gap is OFF the clock. The tracker
 * itself (js/app.js) keeps the seconds: its pause machinery
 * already counts running segments only, so a block is simply a
 * running segment this engine opens and closes by itself:
 *
 *   block 1 starts with the session (manual or auto-start);
 *   the bus ARRIVES at the midday place and DWELLS there, inside
 *     the learned midday window -> block 1 closes and the timer
 *     pauses itself (App.splitAutoPause);
 *   the bus LEAVES the midday place -> block 2 starts itself
 *     (App.splitAutoResume);
 *   the bus is back at the YARD and dwells -> the day closes
 *     (App.splitAutoClose, the same stopSessionAt every close
 *     uses — ONE session record carrying both blocks).
 *
 * Places are learned behind the glass, the way this app learns
 * everything (the park-place learner's clustering, js/parkplace
 * .js): the YARD from session-edge points (a session starts and
 * ends where the bus sleeps), the MIDDAY place from the long
 * midday dwells themselves. Nothing is typed, nothing is asked.
 * For Niro the midday place is home; for other drivers it is
 * their yard — the engine does not care which, it learns the
 * place the bus actually spends its midday.
 *
 * THE WINDOW GUARD: the auto-pause arms ONLY inside the learned
 * midday window — built from the driver's own observed midday
 * arrivals/departures, or seeded from a dispatch that carries
 * the day's two run times. A stop at the midday place outside
 * the window never cuts the clock.
 *
 * No load counting runs in this mode (the session start paths
 * start THIS engine instead of GeoLoads): a bus day is runs and
 * hours, not haul tickets. PTI in this mode is pre-trip once in
 * the morning and no post-trip (modules/pti.js), and the day's
 * ending odometer arrives with the NEXT morning's pre-trip —
 * the bus sits parked overnight, so that reading closes
 * yesterday (onPreTripFiled below). An odometer photo at the
 * afternoon end stays available on the End shift sheet, as for
 * every driver — optional, never required.
 *
 * ROUTE STOPS (addendum 2, owner Nov 6, 05:37–05:38): a bus day
 * is MANY small stops, and every stop after leaving the yard is
 * NAMED on the run record, in order. The day machine detects a
 * brief still (45 s – 12 min) away from the yard and the midday
 * place and reports it as a route-stop — never a site, never a
 * clock pause; only the midday dwell inside the window pauses.
 * The glue matches each stop to the learned stop book by
 * location (a repeat day finds the same stop again), names a
 * new stop from its location behind the glass (the Manifest's
 * place resolver first, then a reverse street lookup), and a
 * name the driver gives once (renameStop) sticks for the route.
 * The session record carries names only — never coordinates.
 *
 * ROUTE SHEETS (addendum 5, owner Nov 6, 05:44): the driver
 * photographs the printed route detail sheet once (Preferences
 * -> Pay, split mode — the same TicketOCR reader the haul cards
 * use); parseRouteSheet turns it into the run's route — every
 * named stop in order, AM and PM sheets separate — and daily
 * stop-matching walks the sheet in order, snapping each driven
 * stop to the sheet's next stop. A stop the sheet does not know
 * is recorded as an extra, named from its location as above.
 * PER-DAY SKIP (addendum 6, 05:45): one tap on the stop's row
 * (Manifest -> today's route) skips it for today only — the
 * record shows it by name marked skipped, the matching steps
 * over it, and the route itself is untouched for tomorrow.
 *
 * THE KNOWN ROUTE (ROUTE-SHEET-DRIVES-NAVIGATION-NOV8, owner
 * Nov 8, 2026 16:57–17:01 CST — "After it knows her route it
 * has to actually know it!" / "bus drivers don't upload a
 * dispatch daily — they run a FIXED route"): the saved sheet
 * is not a per-day upload — it is the app's STANDING knowledge
 * of her work, the bus account's standing dispatch. It carries
 * across days until a new sheet replaces it; each day opens
 * with the route already in place. The day is measured against
 * it: the Navigator's plan IS the known route (routePlan —
 * the stops in the sheet's order, the current stop the target,
 * reached stops advancing the plan behind the glass), arrivals
 * match to the known stops (the sheet walk below), a stop never
 * reached reads as not reached — never relabelled — and the
 * day's fixes are judged against the route's corridor. Stops
 * are PLACED once behind the glass (the app's geocode door,
 * cached on the route record; a new sheet or a rename retires
 * the point) and the placement SHARPENS by use: where she
 * truly stops nudges the point, and a stop the geocoder could
 * not place adopts the ground she actually stops on. The
 * sheet also names the STUDENTS at each stop — the bus count
 * is KIDS (parseRouteRoster): expected boardings and set-downs
 * come from the sheet, the day's reality is the roster minus
 * the absents she marks with one tap (toggleAbsent — that day
 * only, recorded absent, never "missed"). Bus mode has no
 * markers to set and no loads to count — the route sheet is
 * the whole machine.
 *
 * Safety: feature-detected everywhere. With the preference off,
 * or no live location, every method is inert and the app behaves
 * exactly as before. Nothing in here ever throws into the
 * tracker.
 */
(function () {
  'use strict';

  /* SPLIT-ENGINE-BEGIN — pure logic; may use only plain JS + Date.
     Fix shape in:  geo.js fix { latitude, longitude, accuracy, time }
     (also accepts { lat, lng, acc, t }). */

  var FENCE_M = 150;            // a place's fence (park-place law)
  var EXIT_M = 250;             // beyond this = really gone
                                // (150–250 m band: neutral)
  var ACC_MAX_M = 50;           // same accuracy bar as the other engines
  var DWELL_MS = 3 * 60 * 1000; // arrived + stayed this long = the
                                // stop is real ("dwelling a few minutes")
  var DEPART_MS = 2 * 60 * 1000; // outside this long = departed
  var LEARN_CLUSTER_M = 200;    // points within this are one place
  var LEARN_MIN_POINTS = 3;     // points needed to learn a place
  var LEARN_MIN_DAYS = 2;       // ...spanning at least this many days
  var TEACH_DWELL_MS = 20 * 60 * 1000; // a still stop this long
                                // teaches a midday candidate
  var TEACH_BAND_MIN = 6 * 60;  // teaching band, minutes of day:
  var TEACH_BAND_MAX = 16 * 60; // 06:00–16:00 — a scaffold only;
                                // the GUARD window is learned, below
  var STILL_M = 100;            // fixes within this of the anchor
                                // are "the bus is sitting here"
  var STOP_MIN_MS = 45 * 1000;  // a route stop: a still at least
                                // this long (a pickup/drop-off)…
  var STOP_MAX_MS = 12 * 60 * 1000; // …and at most this long —
                                // longer stills are waits, not stops
  var STOP_MATCH_M = 100;       // a stop this close to a learned
                                // stop IS that stop (repeat days)

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
  function minOfDay(t) {
    var d = new Date(t);
    return d.getHours() * 60 + d.getMinutes();
  }

  /* ---- the place learner (the park-place clustering) ----
   * Points cluster greedily (200 m); the biggest cluster with
   * >= 3 points over >= 2 distinct days IS the place. Drift and
   * bad-accuracy fixes are dropped by the counting engines' bar. */
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
      /* Returns the learned place the moment the cluster
       * qualifies, else null. */
      observe: function (rawFix) {
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
      place: function () {
        var b = bestCluster();
        if (b && b.members.length >= LEARN_MIN_POINTS && b.days >= LEARN_MIN_DAYS) {
          return { lat: b.lat, lng: b.lng, points: b.members.length, days: b.days };
        }
        return null;
      },
      snapshot: function () { return { points: points.slice() }; }
    };
  }

  /* ---- the midday window ----
   * Built from the driver's own observed midday stops:
   * obs = [{ arriveMin, departMin }] in minutes of day. The
   * window opens 45 min before the earliest arrival ever seen
   * and closes 45 min after the latest departure — her real
   * days, with slack for a day that runs early or late. The
   * auto-pause may fire only when the ARRIVAL falls inside it. */
  function windowFromObs(obs) {
    if (!obs || !obs.length) return null;
    var lo = null, hi = null;
    for (var i = 0; i < obs.length; i++) {
      var o = obs[i];
      if (!o) continue;
      if (typeof o.arriveMin === 'number') lo = (lo === null) ? o.arriveMin : Math.min(lo, o.arriveMin);
      if (typeof o.departMin === 'number') hi = (hi === null) ? o.departMin : Math.max(hi, o.departMin);
    }
    if (lo === null) return null;
    if (hi === null || hi < lo) hi = lo + 60;
    return {
      startMin: Math.max(0, lo - 45),
      endMin: Math.min(1439, hi + 45)
    };
  }
  /* A dispatch that carries the day's two run times seeds the
   * window before any day has been observed: run 1's end and
   * run 2's start (minutes of day), with 30 min of slack each
   * way. The seed stands only until the first real observation
   * replaces it (the glue owns that precedence). */
  function seedWindowFromRuns(run1EndMin, run2StartMin) {
    if (typeof run1EndMin !== 'number' || typeof run2StartMin !== 'number') return null;
    if (!(run2StartMin > run1EndMin)) return null;
    return {
      startMin: Math.max(0, run1EndMin - 30),
      endMin: Math.min(1439, run2StartMin + 30)
    };
  }
  function inWindow(win, min) {
    return !!win && typeof min === 'number' && min >= win.startMin && min <= win.endMin;
  }

  /* ---- the day machine ----
   * One machine per split day. ctx per feed:
   *   { yard: {lat,lng}|null, midday: {lat,lng}|null,
   *     window: {startMin,endMin}|null }
   * Events (at most one per feed):
   *   { type: 'pause',  at }  block 1 ended at the midday place
   *   { type: 'resume', at }  block 2 began leaving it
   *   { type: 'close',  at }  the day ended back at the yard
   *   { type: 'teach-midday', at, lat, lng }  a long midday-band
   *     stillness worth learning as a midday candidate
   * Block times are kept here for the record; the tracker in
   * js/app.js keeps the same spans on the session it books. */
  function createDayMachine(saved) {
    var st = {
      date: '', phase: 'block1',   // block1 | gap | block2 | done
      b1Start: 0, b1End: 0, b2Start: 0, b2End: 0,
      candPlace: '', candSince: 0, awaySince: 0,
      anchorLat: null, anchorLng: null, anchorSince: 0,
      stopLat: null, stopLng: null, stopSince: 0,
      taughtToday: false, lastT: 0
    };
    if (saved && typeof saved === 'object') {
      if (saved.phase === 'block1' || saved.phase === 'gap' ||
          saved.phase === 'block2' || saved.phase === 'done') st.phase = saved.phase;
      st.date = saved.date || '';
      st.b1Start = +saved.b1Start || 0; st.b1End = +saved.b1End || 0;
      st.b2Start = +saved.b2Start || 0; st.b2End = +saved.b2End || 0;
      st.candPlace = saved.candPlace || ''; st.candSince = +saved.candSince || 0;
      st.awaySince = +saved.awaySince || 0;
      st.anchorLat = (typeof saved.anchorLat === 'number') ? saved.anchorLat : null;
      st.anchorLng = (typeof saved.anchorLng === 'number') ? saved.anchorLng : null;
      st.anchorSince = +saved.anchorSince || 0;
      st.stopLat = (typeof saved.stopLat === 'number') ? saved.stopLat : null;
      st.stopLng = (typeof saved.stopLng === 'number') ? saved.stopLng : null;
      st.stopSince = +saved.stopSince || 0;
      st.taughtToday = !!saved.taughtToday;
      st.lastT = +saved.lastT || 0;
    }
    function blocks() {
      var out = [];
      if (st.b1Start) out.push({ start: st.b1Start, end: st.b1End || null });
      if (st.b2Start) out.push({ start: st.b2Start, end: st.b2End || null });
      return out;
    }
    function resetStop() { st.stopLat = null; st.stopLng = null; st.stopSince = 0; }
    /* Route-stop tracking (addendum 2): a still of STOP_MIN..
     * STOP_MAX away from BOTH place fences is a route stop,
     * reported on the fix that ends it (the bus moving again) —
     * recorded on the run record, never a site, never a pause.
     * A still at the yard or the midday place is never a route
     * stop (those places have their own meanings), and entering
     * either fence drops any half-built stop. */
    function trackStop(f, dMid, dYard) {
      if ((dMid !== null && dMid <= FENCE_M) || (dYard !== null && dYard <= FENCE_M)) {
        resetStop();
        return null;
      }
      if (st.stopLat === null ||
          haversineM(st.stopLat, st.stopLng, f.lat, f.lng) > STILL_M) {
        var ev = null;
        if (st.stopLat !== null && st.stopSince) {
          var dur = f.t - st.stopSince;
          if (dur >= STOP_MIN_MS && dur <= STOP_MAX_MS) {
            ev = { type: 'route-stop', at: st.stopSince, lat: st.stopLat, lng: st.stopLng };
          }
        }
        st.stopLat = f.lat; st.stopLng = f.lng; st.stopSince = f.t;
        return ev;
      }
      return null;
    }
    return {
      begin: function (startMs) {
        if (!st.b1Start) st.b1Start = startMs || 0;
        if (!st.date && startMs) st.date = dayStr(startMs);
        resetStop();
      },
      feed: function (rawFix, ctx) {
        var f = normFix(rawFix);
        if (!f) return null;
        if (f.acc !== null && f.acc > ACC_MAX_M) return null;
        if (f.t <= st.lastT) return null;      // stale / duplicate
        st.lastT = f.t;
        ctx = ctx || {};
        var ds = dayStr(f.t);
        if (st.date && ds !== st.date) {
          /* A new day: this machine's day is over (the glue
           * starts a fresh machine with the new session). */
          return null;
        }
        if (!st.date) st.date = ds;
        if (st.phase === 'done') return null;

        var dMid = isCoord(ctx.midday) ? haversineM(ctx.midday.lat, ctx.midday.lng, f.lat, f.lng) : null;
        var dYard = isCoord(ctx.yard) ? haversineM(ctx.yard.lat, ctx.yard.lng, f.lat, f.lng) : null;

        if (st.phase === 'block1') {
          if (dMid !== null && dMid <= FENCE_M) {
            /* At the midday place: the dwell builds. The pause
             * fires only when the ARRIVAL (the dwell's start)
             * sits inside the learned window — the guard. */
            if (st.candPlace !== 'mid') { st.candPlace = 'mid'; st.candSince = f.t; }
            if (f.t - st.candSince >= DWELL_MS && inWindow(ctx.window, minOfDay(st.candSince))) {
              var at1 = st.candSince;
              st.b1End = at1; st.phase = 'gap';
              st.candPlace = ''; st.candSince = 0; st.awaySince = 0;
              st.anchorLat = null; st.anchorLng = null; st.anchorSince = 0;
              resetStop();
              return { type: 'pause', at: at1 };
            }
            return null;
          }
          if (dMid !== null && dMid <= EXIT_M) { st.candPlace = ''; st.candSince = 0; return null; }
          st.candPlace = ''; st.candSince = 0;
          /* Route stops (addendum 2): a brief still away from the
           * places is a route stop — recorded, never a pause. The
           * midday cases returned above; the yard fence is refused
           * inside trackStop. */
          var sev = trackStop(f, dMid, dYard);
          if (sev) return sev;
          /* Teaching: midday place not confirmed yet — a long
           * stillness inside the teaching band is a candidate.
           * (Once the place IS known the branch above owns the
           * day and teaching never runs.) */
          if (!isCoord(ctx.midday) && !st.taughtToday) {
            if (st.anchorLat === null ||
                haversineM(st.anchorLat, st.anchorLng, f.lat, f.lng) > STILL_M) {
              st.anchorLat = f.lat; st.anchorLng = f.lng; st.anchorSince = f.t;
            } else if (f.t - st.anchorSince >= TEACH_DWELL_MS) {
              var m = minOfDay(st.anchorSince);
              if (m >= TEACH_BAND_MIN && m <= TEACH_BAND_MAX) {
                var ev = { type: 'teach-midday', at: st.anchorSince, lat: st.anchorLat, lng: st.anchorLng };
                st.taughtToday = true;
                st.anchorLat = null; st.anchorLng = null; st.anchorSince = 0;
                return ev;
              }
              st.taughtToday = true; // one candidate a day, in or out of band
            }
          }
          return null;
        }

        if (st.phase === 'gap') {
          if (dMid !== null && dMid <= EXIT_M) { st.awaySince = 0; return null; }
          if (dMid !== null) {
            if (!st.awaySince) st.awaySince = f.t;
            if (f.t - st.awaySince >= DEPART_MS) {
              var at2 = st.awaySince;
              st.b2Start = at2; st.phase = 'block2'; st.awaySince = 0;
              resetStop();
              return { type: 'resume', at: at2 };
            }
          }
          return null;
        }

        if (st.phase === 'block2') {
          /* The midday place is checked FIRST in block 1; here
           * only the yard can end the day — if the two places
           * are the same spot, the phases keep the meanings
           * apart (a midday return pauses, an evening return
           * closes). */
          if (dYard !== null && dYard <= FENCE_M) {
            if (st.candPlace !== 'yard') { st.candPlace = 'yard'; st.candSince = f.t; }
            if (f.t - st.candSince >= DWELL_MS) {
              var at3 = st.candSince;
              st.b2End = at3; st.phase = 'done';
              st.candPlace = ''; st.candSince = 0;
              return { type: 'close', at: at3 };
            }
            return null;
          }
          if (dYard !== null && dYard <= EXIT_M) return null;
          st.candPlace = ''; st.candSince = 0;
          /* Route stops ride the afternoon block too. */
          return trackStop(f, dMid, dYard);
        }
        return null;
      },
      blocks: blocks,
      /* The day's paid seconds: the blocks summed, the gap
       * never counted. An open block counts to `nowMs`. */
      paidSeconds: function (nowMs) {
        var s = 0, bs = blocks();
        for (var i = 0; i < bs.length; i++) {
          var e = bs[i].end || nowMs || 0;
          if (e > bs[i].start) s += Math.floor((e - bs[i].start) / 1000);
        }
        return s;
      },
      phase: function () { return st.phase; },
      snapshot: function () {
        return {
          date: st.date, phase: st.phase,
          b1Start: st.b1Start, b1End: st.b1End,
          b2Start: st.b2Start, b2End: st.b2End,
          candPlace: st.candPlace, candSince: st.candSince,
          awaySince: st.awaySince,
          anchorLat: st.anchorLat, anchorLng: st.anchorLng, anchorSince: st.anchorSince,
          stopLat: st.stopLat, stopLng: st.stopLng, stopSince: st.stopSince,
          taughtToday: st.taughtToday, lastT: st.lastT
        };
      }
    };
  }

  /* ---- the stop book (addendum 2) ----
   * The route's learned stops. A stop the bus makes lands in a
   * cluster by location (STOP_MATCH_M); a repeat day's stop at
   * the same ground matches the same cluster, so the name the
   * cluster carries — auto-named from its location, or renamed
   * once by the driver — is the name every later day reads.
   * A driver's rename is final: `renamed` clusters never take
   * an auto-name again. */
  function createStopBook(saved) {
    var clusters = [], seq = 1;
    if (saved && Array.isArray(saved.clusters)) {
      for (var i = 0; i < saved.clusters.length; i++) {
        var c = saved.clusters[i];
        if (!c || !isCoord(c) || !c.id) continue;
        clusters.push({
          id: String(c.id), lat: c.lat, lng: c.lng,
          name: String(c.name || ''), renamed: !!c.renamed,
          days: (c.days && typeof c.days === 'object') ? c.days : {}
        });
      }
      if (typeof saved.seq === 'number' && saved.seq > seq) seq = saved.seq;
    }
    function byId(id) {
      for (var i = 0; i < clusters.length; i++) if (clusters[i].id === id) return clusters[i];
      return null;
    }
    return {
      /* Nearest cluster within STOP_MATCH_M, else null. */
      match: function (lat, lng) {
        var best = null, bestD = STOP_MATCH_M;
        for (var i = 0; i < clusters.length; i++) {
          var d = haversineM(clusters[i].lat, clusters[i].lng, lat, lng);
          if (d <= bestD) { bestD = d; best = clusters[i]; }
        }
        return best;
      },
      add: function (lat, lng, day) {
        var c = { id: 'st' + (seq++), lat: lat, lng: lng, name: '', renamed: false, days: {} };
        if (day) c.days[day] = true;
        clusters.push(c);
        return c;
      },
      touch: function (c, day) { if (c && day) c.days[day] = true; },
      byId: byId,
      /* The driver's word, once: the name sticks for the route. */
      rename: function (id, name) {
        var c = byId(id);
        name = String(name || '').trim();
        if (!c || !name) return false;
        c.name = name; c.renamed = true;
        return true;
      },
      /* An auto-name lands only on a cluster nobody named yet. */
      autoName: function (id, name) {
        var c = byId(id);
        name = String(name || '').trim();
        if (!c || !name || c.name || c.renamed) return false;
        c.name = name;
        return true;
      },
      count: function () { return clusters.length; },
      snapshot: function () {
        return {
          seq: seq,
          clusters: clusters.map(function (c) {
            return { id: c.id, lat: c.lat, lng: c.lng, name: c.name, renamed: c.renamed, days: c.days };
          })
        };
      }
    };
  }

  /* ---- the route-sheet reader (addendum 5) ----
   * The OCR text of a photographed route detail sheet becomes
   * the run's stop list: one stop per readable line, in the
   * sheet's order, with its printed time when the line carries
   * one. Numbering and bullets are stripped; header lines (the
   * sheet's own furniture — "Route", "Driver", column heads)
   * and lines with no letters never become stops. Heuristic by
   * design: the sheet is the driver's paper, read the way the
   * haul-card reader reads a ticket — best effort, in order. */
  function parseRouteSheet(text) {
    var out = [];
    if (!text) return out;
    var lines = String(text).split(/\r?\n/);
    /* The letterhead block — company name, "Route Detail
       Sheet", the run's own label — sits ABOVE the first timed
       stop on a printed sheet and is never a stop: a line only
       counts once the timed stops have begun (a few sheets
       print untimed stops at the tail; those still count).
       Header words drop a time-less line anywhere. Pure: the
       sheet's text in, the named stops in order out. */
    var seenTimed = false;
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].trim();
      if (!raw) continue;
      var time = '', name = raw;
      var tm = /(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/.exec(raw);
      var validTime = false;
      if (tm) {
        var hh = +tm[1], mm = +tm[2];
        if (hh >= 1 && hh <= 12 && mm <= 59) {
          validTime = true;
          time = hh + ':' + tm[2] + (tm[3] ? ' ' + tm[3].toUpperCase() : '');
          name = raw.replace(tm[0], ' ');
        }
      }
      if (validTime) seenTimed = true;
      if (!seenTimed) continue;
      if (!validTime && /route|sheet|driver|school name|phone|page/i.test(raw)) continue;
      name = name.replace(/^\s*(stop\s*)?\d{1,3}\s*[.):\-]\s*/i, '')
        .replace(/\s*\(\s*stop\s*#?\s*\d+\)\s*/i, ' ')
        .replace(/^[\s•·\-\|]+/, '').replace(/[\s\-\|]+$/, '')
        .replace(/\s{2,}/g, ' ').trim();
      if (name.length < 3 || !/[A-Za-z]/.test(name)) continue;
      if (/^(route|driver|school|bus|page|am route|pm route|stop|time|address|phone|student|students|pick ?up|drop ?off)$/i.test(name)) continue;
      out.push({ name: name, time: time });
      if (out.length >= 80) break;
    }
    return out;
  }

  /* ---- the sheet's clock ("7:26 AM" -> minutes of day) ---- */
  function sheetTimeMin(time) {
    var m = /(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/.exec(String(time || ''));
    if (!m) return null;
    var hh = +m[1], mm = +m[2];
    if (mm > 59) return null;
    if (m[3]) { hh = hh % 12; if (/p/i.test(m[3])) hh += 12; }
    else if (hh > 23) return null;
    return hh * 60 + mm;
  }

  /* ---- the route roster (ROUTE-SHEET-DRIVES-NAVIGATION-NOV8,
   * addendum: the count is KIDS, owner Nov 8, 2026 16:59 CST) ----
   * The company's sheet names the STUDENTS at every stop: a
   * PICK-UP or DROP-OFF line under a stop names its kids (the
   * first on the marker line itself, the rest on the lines that
   * follow it, each carrying the sheet's '*' mark and a phone).
   * parseRouteRoster walks a run's OWN section text against the
   * run's parsed stops — a timed line whose cleaned name is the
   * next stop's name opens that stop; a marker line opens its
   * kid list; a line carrying a clock time, or a new marker,
   * closes the list. Care plans, equipment and direction lines
   * carry no '*' and never become kids. Returns one entry per
   * stop, aligned by index: { up: [names], down: [names] } —
   * boardings and set-downs AS THE SHEET PRINTS THEM (a morning
   * home stop prints PICK-UP, its school prints DROP-OFF; the
   * afternoon mirrors it). Text the sheet does not carry names
   * nobody: a stop with no marker lines gets two empty lists. */
  function rosterLineStopName(raw) {
    var tm = /(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/.exec(raw);
    if (!tm) return null;
    var hh = +tm[1], mm = +tm[2];
    if (!(hh >= 1 && hh <= 12 && mm <= 59)) return null;
    var name = raw.replace(tm[0], ' ');
    name = name.replace(/^\s*(stop\s*)?\d{1,3}\s*[.):\-]\s*/i, '')
      .replace(/\s*\(\s*stop\s*#?\s*\d+\)\s*/i, ' ')
      .replace(/^[\s•·\-\|]+/, '').replace(/[\s\-\|]+$/, '')
      .replace(/\s{2,}/g, ' ').trim();
    return name;
  }
  function kidNameOf(text) {
    var nm = String(text || '');
    var star = nm.indexOf('*');
    if (star >= 0) nm = nm.slice(0, star);
    nm = nm.replace(/[•·]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (nm.length < 3 || !/[A-Za-z]/.test(nm) || /\d/.test(nm)) return '';
    if (/^(meet at bus|care plan|equipment|not assigned)$/i.test(nm)) return '';
    return nm;
  }
  function parseRouteRoster(text, stops) {
    var out = [];
    stops = Array.isArray(stops) ? stops : [];
    for (var s = 0; s < stops.length; s++) out.push({ up: [], down: [] });
    if (!text || !stops.length) return out;
    var lines = String(text)
      .replace(/PICK\s*-\s*UP/gi, 'PICK-UP').replace(/DROP\s*-\s*OFF/gi, 'DROP-OFF')
      .split(/\r?\n/);
    var cur = -1, list = null;
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].trim();
      if (!raw) continue;
      var isStopLine = false;
      if (cur + 1 < stops.length) {
        var sn = rosterLineStopName(raw);
        if (sn && sn === stops[cur + 1].name) { cur++; list = null; isStopLine = true; }
      }
      if (isStopLine) continue;
      var mk = /^(PICK-UP|DROP-OFF)\b/i.exec(raw);
      if (mk) {
        if (cur >= 0) {
          list = /pick/i.test(mk[1]) ? out[cur].up : out[cur].down;
          var first = kidNameOf(raw.slice(mk[0].length));
          if (first) list.push(first);
        } else list = null;
        continue;
      }
      if (/\d{1,2}:\d{2}/.test(raw)) { list = null; continue; }  // a schedule line closes the list
      if (list && raw.indexOf('*') >= 0) {
        var kn = kidNameOf(raw);
        if (kn) list.push(kn);
      }
    }
    return out;
  }

  /* ---- the navigation walk (ROUTE-SHEET-DRIVES-NAVIGATION-
   * NOV8) ---- the known route, walked in the sheet's order:
   * stops at or after the day's cursor that are marked skipped
   * for today are stepped over; the CURRENT stop is the first
   * one left; the routing TARGET is the first current-or-later
   * stop that carries a placed point (ps === 'ok'); the stops
   * before the target that carry no placed point are PASSED —
   * named, never dropped, just not routed to. done when no
   * current stop remains. Pure: stops in, the walk out. */
  function planWalk(stops, prog, skipKeys, block) {
    stops = Array.isArray(stops) ? stops : [];
    skipKeys = skipKeys || {};
    var cur = -1, tgt = -1, passed = [];
    for (var i = Math.max(0, +prog || 0); i < stops.length; i++) {
      if (skipKeys['sheet:' + block + ':' + i]) continue;
      if (cur < 0) cur = i;
      if (stops[i] && stops[i].ps === 'ok' && isCoord(stops[i])) { tgt = i; break; }
      passed.push(i);
    }
    if (cur < 0) return { current: -1, target: -1, passed: [], done: true };
    return { current: cur, target: tgt, passed: passed, done: false };
  }

  /* Distance from a point to the chain of placed stops (the
   * route's corridor): the least distance to any segment, in
   * metres, on a local flat projection. null when the chain
   * cannot judge (no points). */
  function pointSegDistM(lat, lng, a, b) {
    var rad = Math.PI / 180, R = 6371000;
    var cosL = Math.cos(lat * rad);
    function xy(p) { return { x: (p.lng - lng) * rad * R * cosL, y: (p.lat - lat) * rad * R }; }
    var A = xy(a), B = xy(b);
    var dx = B.x - A.x, dy = B.y - A.y;
    var len2 = dx * dx + dy * dy;
    var t = len2 > 0 ? Math.max(0, Math.min(1, -(A.x * dx + A.y * dy) / len2)) : 0;
    var px = A.x + t * dx, py = A.y + t * dy;
    return Math.sqrt(px * px + py * py);
  }
  function distToChainM(lat, lng, pts) {
    if (!pts || !pts.length || !isCoord({ lat: lat, lng: lng })) return null;
    if (pts.length === 1) return haversineM(lat, lng, pts[0].lat, pts[0].lng);
    var best = Infinity;
    for (var i = 0; i + 1 < pts.length; i++) {
      var d = pointSegDistM(lat, lng, pts[i], pts[i + 1]);
      if (d < best) best = d;
    }
    return best;
  }

  var ENGINE = {
    haversineM: haversineM, isCoord: isCoord, normFix: normFix,
    dayStr: dayStr, minOfDay: minOfDay,
    createLearner: createLearner,
    windowFromObs: windowFromObs, seedWindowFromRuns: seedWindowFromRuns,
    inWindow: inWindow, createDayMachine: createDayMachine,
    createStopBook: createStopBook, parseRouteSheet: parseRouteSheet,
    parseRouteRoster: parseRouteRoster, planWalk: planWalk,
    distToChainM: distToChainM, sheetTimeMin: sheetTimeMin,
    FENCE_M: FENCE_M, EXIT_M: EXIT_M, ACC_MAX_M: ACC_MAX_M,
    DWELL_MS: DWELL_MS, DEPART_MS: DEPART_MS,
    STOP_MIN_MS: STOP_MIN_MS, STOP_MAX_MS: STOP_MAX_MS, STOP_MATCH_M: STOP_MATCH_M
  };
  /* SPLIT-ENGINE-END */

  /* ================= glue ================= */

  var STATE_KEY = 'splitshift';  // synced store record: learners,
                                 // places, window observations + seed,
                                 // and the live day machine's snapshot

  function store() {
    try { return (window.App && App._store) || null; } catch (e) { return null; }
  }
  function tracker() {
    try { return (window.App && App.tracker) || null; } catch (e) { return null; }
  }
  function enabled() {
    var s = store();
    if (!s) return false;
    try { return s.get('onboarding', {}).workPattern === 'split'; } catch (e) { return false; }
  }

  var watching = false;
  var sessionKey = null;
  var subscribed = false;
  var yardLearner = null, midLearner = null;
  var yardPlace = null, midPlace = null;
  var windowObs = [];        // [{date, arriveMin, departMin}]
  var windowSeed = null;     // {startMin, endMin} | null
  var machine = null;
  var lastFix = null;
  var taughtAnchor = null;   // {lat, lng, arriveMin, date} while a
                             // taught stop's departure is awaited
  var stopBook = null;       // ENGINE.createStopBook — the route's
                             // learned stops (addendum 2)
  var dayStops = [];         // today's stops, in order:
                             // [{key, name, at}] — names only ever
                             // leave this file (the run record)
  var dayStopsDate = '';
  var routeSheets = { am: [], pm: [] }; // the photographed route
                             // sheets' stops (addendum 5):
                             // [{name, time}] per run
  var sheetUsed = { date: '', am: 0, pm: 0 }; // how far into each
                             // sheet today's matching has walked
  var daySkips = { date: '', keys: {} }; // per-day stop skips
                             // (addendum 6): keys are stop keys —
                             // 'sheet:<block>:<idx>' or a learned
                             // stop's id; for THIS day only
  var routeRoster = { am: [], pm: [] }; // the sheet's STUDENTS
                             // per stop (addendum: the count is
                             // kids): [{up: [names], down:
                             // [names]}] aligned with routeSheets
                             // by index; replaced with the sheet
  var dayAbsent = { date: '', keys: {} }; // per-day absent kids:
                             // keys 'sheet:<block>:<idx>:<up|
                             // down>:<n>' — that day only, the
                             // roster itself never changes
  var navProg = { date: '', am: 0, pm: 0 }; // the navigation
                             // plan's cursor: stops consumed per
                             // run for the plan's day — reached,
                             // passed, or advanced by hand
  var placingNow = {};       // '<block>:<idx>' with a geocode
                             // in flight (memory only)
  var namingNow = {};        // cluster ids with a street lookup
                             // in flight (memory only)
  var restored = false;

  function persist() {
    var s = store();
    if (!s) return;
    try {
      s.set(STATE_KEY, {
        yardPts: yardLearner ? yardLearner.snapshot() : null,
        midPts: midLearner ? midLearner.snapshot() : null,
        windowObs: windowObs,
        windowSeed: windowSeed,
        machine: machine ? machine.snapshot() : null,
        machineKey: sessionKey || null,
        taughtAnchor: taughtAnchor,
        stopBook: stopBook ? stopBook.snapshot() : null,
        dayStops: dayStops,
        dayStopsDate: dayStopsDate,
        routeSheets: routeSheets,
        routeRoster: routeRoster,
        sheetUsed: sheetUsed,
        daySkips: daySkips,
        dayAbsent: dayAbsent,
        navProg: navProg
      });
    } catch (e) {}
  }
  function restore() {
    if (restored) return;
    var s = store();
    if (!s) return;   // store not up yet — retry on the next call
    restored = true;
    var rec = null;
    try { rec = s ? s.get(STATE_KEY, null) : null; } catch (e) {}
    rec = (rec && typeof rec === 'object') ? rec : {};
    yardLearner = ENGINE.createLearner(rec.yardPts || null);
    midLearner = ENGINE.createLearner(rec.midPts || null);
    yardPlace = yardLearner.place();
    midPlace = midLearner.place();
    windowObs = Array.isArray(rec.windowObs) ? rec.windowObs : [];
    windowSeed = (rec.windowSeed && typeof rec.windowSeed.startMin === 'number') ? rec.windowSeed : null;
    taughtAnchor = (rec.taughtAnchor && typeof rec.taughtAnchor === 'object') ? rec.taughtAnchor : null;
    stopBook = ENGINE.createStopBook(rec.stopBook || null);
    dayStops = [];
    if (Array.isArray(rec.dayStops)) {
      for (var di = 0; di < rec.dayStops.length; di++) {
        var dse = rec.dayStops[di];
        if (dse && dse.name) dayStops.push({ key: String(dse.key || ''), name: String(dse.name), at: +dse.at || 0 });
      }
    }
    dayStopsDate = rec.dayStopsDate || '';
    routeSheets = { am: [], pm: [] };
    if (rec.routeSheets && typeof rec.routeSheets === 'object') {
      ['am', 'pm'].forEach(function (b) {
        if (Array.isArray(rec.routeSheets[b])) {
          routeSheets[b] = rec.routeSheets[b].filter(function (x) { return x && x.name; })
            .map(function (x) {
              var o = { name: String(x.name), time: String(x.time || '') };
              /* The placed point rides the route record (a new
                 sheet parses fresh stops without one — the cache
                 invalidates itself; a rename retires it too). */
              if (ENGINE.isCoord(x)) { o.lat = x.lat; o.lng = x.lng; o.ps = 'ok'; if (x.src) o.src = String(x.src); }
              else if (x.ps === 'no') o.ps = 'no';
              return o;
            });
        }
      });
    }
    routeRoster = { am: [], pm: [] };
    if (rec.routeRoster && typeof rec.routeRoster === 'object') {
      ['am', 'pm'].forEach(function (b) {
        if (Array.isArray(rec.routeRoster[b])) {
          routeRoster[b] = rec.routeRoster[b].map(function (r) {
            function names(v) {
              return Array.isArray(v) ? v.filter(function (n) { return typeof n === 'string' && n; }).map(String) : [];
            }
            return { up: names(r && r.up), down: names(r && r.down) };
          });
        }
      });
    }
    dayAbsent = { date: '', keys: {} };
    if (rec.dayAbsent && typeof rec.dayAbsent === 'object' &&
        rec.dayAbsent.keys && typeof rec.dayAbsent.keys === 'object') {
      dayAbsent = { date: String(rec.dayAbsent.date || ''), keys: rec.dayAbsent.keys };
    }
    navProg = { date: '', am: 0, pm: 0 };
    if (rec.navProg && typeof rec.navProg === 'object') {
      navProg = {
        date: String(rec.navProg.date || ''),
        am: +rec.navProg.am || 0, pm: +rec.navProg.pm || 0
      };
    }
    sheetUsed = { date: '', am: 0, pm: 0 };
    if (rec.sheetUsed && typeof rec.sheetUsed === 'object') {
      sheetUsed = {
        date: String(rec.sheetUsed.date || ''),
        am: +rec.sheetUsed.am || 0, pm: +rec.sheetUsed.pm || 0
      };
    }
    daySkips = { date: '', keys: {} };
    if (rec.daySkips && typeof rec.daySkips === 'object' &&
        rec.daySkips.keys && typeof rec.daySkips.keys === 'object') {
      daySkips = { date: String(rec.daySkips.date || ''), keys: rec.daySkips.keys };
    }
    if (rec.machine && rec.machineKey) {
      machine = ENGINE.createDayMachine(rec.machine);
      sessionKey = rec.machineKey;
    }
  }
  function windowNow() {
    var w = ENGINE.windowFromObs(windowObs);
    return w || windowSeed;
  }

  /* ---- the known route: placement + the plan's day/block ----
   * A stop is placed ONCE, behind the glass, through the app's
   * own geocode door (MeticulousGeo.geocode — the same door the
   * yard and the haul sites use), and the point is cached on
   * the route record itself: ps 'ok' with lat/lng, or ps 'no'
   * when the geocoder found nothing (the stop stays in the
   * plan by name; navigation passes over it, named). Nothing
   * re-asks daily: the attempt stands until the sheet is
   * replaced or the stop renamed. Where she truly stops then
   * sharpens the point (recordRouteStop): an unplaced stop
   * adopts the ground, a placed point nudges halfway toward a
   * driven stop within 300 m — never dragged further. */
  var PLAN_ARRIVE_M = 75;    // a fix this close to the target
                             // stop has reached it (navigation)
  var CORRIDOR_M = 400;      // further than this from every
                             // placed segment = off the route
  var NUDGE_M = 300;         // a driven stop within this of a
                             // placed point may nudge it
  function geoDoor() {
    try {
      return (window.MeticulousGeo && typeof MeticulousGeo.geocode === 'function')
        ? MeticulousGeo : null;
    } catch (e) { return null; }
  }
  function placeStop(block, idx) {
    var stop = (routeSheets[block] || [])[idx];
    if (!stop || stop.ps) return;
    var g = geoDoor();
    if (!g) return;
    var pk = block + ':' + idx;
    if (placingNow[pk]) return;
    placingNow[pk] = true;
    var name = stop.name;
    function settle(hit) {
      delete placingNow[pk];
      var cur = (routeSheets[block] || [])[idx];
      if (!cur || cur.name !== name || cur.ps) return;  // the sheet moved on
      if (hit && isFinite(+hit.latitude) && isFinite(+hit.longitude)) {
        cur.lat = +hit.latitude; cur.lng = +hit.longitude;
        cur.ps = 'ok'; cur.src = 'geo';
      } else cur.ps = 'no';
      persist();
    }
    try {
      g.geocode(name).then(settle).catch(function () { settle(null); });
    } catch (e) { delete placingNow[pk]; }
  }
  function ensureRoutePlaced() {
    ['am', 'pm'].forEach(function (b) {
      (routeSheets[b] || []).forEach(function (st, i) {
        if (!st.ps) placeStop(b, i);
      });
    });
  }
  /* The plan's day: the live machine's day while a session
     runs, else today — a fresh morning opens on today's plan,
     never on yesterday's cursor. */
  function planDay() {
    var snap = machine ? machine.snapshot() : null;
    return (snap && snap.date) || ENGINE.dayStr(Date.now());
  }
  /* The plan's run: the split engine's own block logic — the
     machine's phase while a day runs (block 1 = morning; the
     midday gap and block 2 belong to the afternoon run, whose
     plan stands ready in the gap); before any session, the
     morning run until it is fully consumed, then the afternoon. */
  function planBlock() {
    var ph = machine ? machine.phase() : null;
    if (ph === 'block1') return 'am';
    if (ph === 'gap' || ph === 'block2' || ph === 'done') return 'pm';
    var day = planDay();
    var progAm = (navProg.date === day) ? (navProg.am || 0) : 0;
    var amLen = (routeSheets.am || []).length;
    return (amLen && progAm >= amLen && (routeSheets.pm || []).length) ? 'pm' : 'am';
  }
  function planSkipKeys() {
    var day = planDay(), today = ENGINE.dayStr(Date.now());
    return (daySkips.date === day || daySkips.date === today) ? daySkips.keys : {};
  }
  function absentKeys() {
    return (dayAbsent.date === ENGINE.dayStr(Date.now())) ? dayAbsent.keys : {};
  }
  /* One stop's kid truth: the sheet's roster for the stop with
     today's absent marks laid over it — expected, absent, and
     the day's count (expected minus absent) per direction. */
  function kidLine(block, idx) {
    var r = (routeRoster[block] || [])[idx] || { up: [], down: [] };
    var ak = absentKeys();
    var key0 = 'sheet:' + block + ':' + idx;
    function side(dir, names) {
      var kids = (names || []).map(function (nm, k) {
        var key = key0 + ':' + dir + ':' + k;
        return { key: key, name: nm, absent: !!ak[key] };
      });
      var abs = 0;
      kids.forEach(function (x) { if (x.absent) abs++; });
      return { kids: kids, exp: kids.length, abs: abs, got: kids.length - abs };
    }
    var up = side('up', r.up), down = side('down', r.down);
    return { up: up, down: down, absent: up.abs + down.abs };
  }
  function subscribe() {
    if (subscribed) return;
    var lm = null;
    try { lm = window.LiveMiles || null; } catch (e) {}
    if (!lm || typeof lm.subscribe !== 'function') return;
    subscribed = true;
    try {
      lm.subscribe(function (fix) { feedFix(fix); });
    } catch (e) { subscribed = false; }
  }

  /* The day's dispatch, when it carries the two run times,
   * seeds the window. Today's record is found the way the
   * auto-start engine finds it (scheduledAt date prefix or the
   * record's own date; completed / cancelled claim nothing).
   * Run times ride optional fields — runTimes or runs, each
   * [{start:'HH:MM', end:'HH:MM'}, ...] — because a dispatch
   * today carries ONE scheduled time; with no runs on the
   * record there is simply no seed and the learned window (or
   * the teaching days) governs. */
  function hhmmMin(v) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(v || ''));
    if (!m) return null;
    var n = (+m[1]) * 60 + (+m[2]);
    return (n >= 0 && n <= 1439) ? n : null;
  }
  function seedFromDispatch(today) {
    var s = store();
    if (!s) return;
    var recs = [];
    try {
      var a = s.get('dsp_active', null);
      if (a) recs.push(a);
      var l = s.get('dsp_list', []);
      if (Array.isArray(l)) recs = recs.concat(l);
    } catch (e) { return; }
    for (var i = 0; i < recs.length; i++) {
      var d = recs[i];
      if (!d || typeof d !== 'object') continue;
      var dDate = d.date || String(d.scheduledAt || '').slice(0, 10);
      if (dDate !== today) continue;
      var st = String(d.status || '').toLowerCase();
      if (st === 'completed' || st === 'cancelled' || st === 'canceled') continue;
      var runs = Array.isArray(d.runTimes) ? d.runTimes : (Array.isArray(d.runs) ? d.runs : null);
      if (!runs || runs.length < 2) continue;
      var e1 = hhmmMin(runs[0] && runs[0].end), s2 = hhmmMin(runs[1] && runs[1].start);
      var w = ENGINE.seedWindowFromRuns(e1, s2);
      if (w) { windowSeed = w; persist(); }
      return;
    }
  }

  function recordObs(date, arriveMin, departMin) {
    for (var i = 0; i < windowObs.length; i++) {
      if (windowObs[i] && windowObs[i].date === date) {
        if (typeof arriveMin === 'number') windowObs[i].arriveMin = arriveMin;
        if (typeof departMin === 'number') windowObs[i].departMin = departMin;
        persist();
        return;
      }
    }
    windowObs.push({ date: date, arriveMin: arriveMin, departMin: departMin });
    if (windowObs.length > 60) windowObs = windowObs.slice(windowObs.length - 60);
    persist();
  }

  /* ---- route stops: naming behind the glass (addendum 2) ----
   * A new stop's name comes from its location, never from the
   * driver: first the app's own place truth (the Manifest's
   * resolver — the driver's saved places and learned labels),
   * then a reverse street lookup on the same free Nominatim
   * service the Navigator uses. A name the driver gave once
   * outranks both forever (the stop book's `renamed` law). */
  function autoNameFor(lat, lng) {
    try {
      var mf = window.Meticulous && Meticulous.modules && Meticulous.modules.manifest;
      if (mf && typeof mf._placeNameFor === 'function') {
        var n = mf._placeNameFor(lat, lng);
        if (n) return String(n);
      }
    } catch (e) {}
    return '';
  }
  function asyncNameFor(cluster) {
    if (!cluster || cluster.name || cluster.renamed || namingNow[cluster.id]) return;
    if (typeof fetch !== 'function') return;
    namingNow[cluster.id] = true;
    var id = cluster.id, lat = cluster.lat, lng = cluster.lng;
    try {
      fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=' + lat + '&lon=' + lng)
        .then(function (r) { return r.json(); })
        .then(function (j) {
          delete namingNow[id];
          var a = (j && j.address) || {};
          var nm = a.road || a.pedestrian || a.neighbourhood || a.suburb || '';
          if (nm && stopBook && stopBook.autoName(id, nm)) {
            for (var i = 0; i < dayStops.length; i++) {
              if (dayStops[i].key === id) dayStops[i].name = nm;
            }
            persist();
          }
        })
        .catch(function () { delete namingNow[id]; });
    } catch (e) { delete namingNow[id]; }
  }
  function recordRouteStop(ev) {
    if (!stopBook) return;
    var ds = ENGINE.dayStr(ev.at);
    if (dayStopsDate !== ds) { dayStops = []; dayStopsDate = ds; }
    if (sheetUsed.date !== ds) sheetUsed = { date: ds, am: 0, pm: 0 };
    /* The sheet anchors the naming (addendum 5): the driven
     * path walks the sheet's stops in order, and a detected
     * stop takes the NEXT sheet stop's name. A stop skipped
     * for today (addendum 6) is stepped over — the GPS expects
     * no stop there, so a driven stop never wears its name and
     * passing it raises nothing. The learned stop book still
     * records the ground underneath, sheet or no sheet. */
    var block = (machine && machine.phase() === 'block2') ? 'pm' : 'am';
    var sheet = routeSheets[block] || [];
    var sheetName = '', sheetKey = '';
    while (sheetUsed[block] < sheet.length &&
           daySkips.date === ds && daySkips.keys['sheet:' + block + ':' + sheetUsed[block]]) {
      sheetUsed[block]++;
    }
    if (sheetUsed[block] < sheet.length) {
      var sIdx = sheetUsed[block]++;
      sheetName = sheet[sIdx].name;
      sheetKey = 'sheet:' + block + ':' + sIdx;
    }
    if (sheetKey) {
      /* The driven stop sharpens the known route (the plan
       * follows): an unplaced sheet stop adopts the ground she
       * actually stops on; a placed point nudges halfway toward
       * a driven stop nearby — the route learns her real stops
       * the way a seed learns a site, silently. And the
       * navigation plan has reached this stop: its cursor steps
       * past it. */
      var rst = sheet[sIdx];
      if (rst) {
        if (rst.ps !== 'ok') {
          rst.lat = ev.lat; rst.lng = ev.lng; rst.ps = 'ok'; rst.src = 'driven';
        } else {
          var nd = ENGINE.haversineM(rst.lat, rst.lng, ev.lat, ev.lng);
          if (nd > 0 && nd <= NUDGE_M) {
            rst.lat = (rst.lat + ev.lat) / 2;
            rst.lng = (rst.lng + ev.lng) / 2;
          }
        }
      }
      if (navProg.date !== ds) navProg = { date: ds, am: 0, pm: 0 };
      if (navProg[block] < sIdx + 1) navProg[block] = sIdx + 1;
    }
    var c = stopBook.match(ev.lat, ev.lng);
    if (!c) c = stopBook.add(ev.lat, ev.lng, ds);
    else stopBook.touch(c, ds);
    if (!c.name && !c.renamed) {
      var nm = autoNameFor(ev.lat, ev.lng);
      if (nm) stopBook.autoName(c.id, nm);
    }
    dayStops.push({
      key: sheetKey || c.id,
      name: sheetName || c.name || 'Unnamed stop',
      at: ev.at
    });
    if (!c.name && !sheetName) asyncNameFor(c);
    persist();
  }

  function onEvent(ev) {
    if (!ev) return;
    var t = tracker();
    if (ev.type === 'pause') {
      recordObs(ENGINE.dayStr(ev.at), ENGINE.minOfDay(ev.at), null);
      try { if (window.App && App.splitAutoPause) App.splitAutoPause(ev.at); } catch (e) {}
    } else if (ev.type === 'resume') {
      recordObs(ENGINE.dayStr(ev.at), null, ENGINE.minOfDay(ev.at));
      try { if (window.App && App.splitAutoResume) App.splitAutoResume(ev.at); } catch (e) {}
    } else if (ev.type === 'close') {
      try { if (window.App && App.splitAutoClose) App.splitAutoClose(ev.at); } catch (e) {}
    } else if (ev.type === 'route-stop') {
      recordRouteStop(ev);
    } else if (ev.type === 'teach-midday') {
      var got = null;
      try { got = midLearner.observe({ lat: ev.lat, lng: ev.lng, acc: 10, t: ev.at }); } catch (e) {}
      if (got) midPlace = got;
      taughtAnchor = { lat: ev.lat, lng: ev.lng, arriveMin: ENGINE.minOfDay(ev.at), date: ENGINE.dayStr(ev.at) };
      persist();
    }
    persist();
    void t;
  }

  function feedFix(rawFix) {
    var f = ENGINE.normFix(rawFix);
    if (!f) return null;
    if (f.acc !== null && f.acc > ENGINE.ACC_MAX_M) return null;
    lastFix = f;
    if (!watching || !machine) return null;
    var t = tracker();
    if (!t || (t.status !== 'running' && t.status !== 'paused')) {
      /* The session ended without this engine hearing about it
       * (a heal, a cloud close): stand down quietly. */
      stopDay();
      return null;
    }
    /* A taught midday stop completes its window observation when
     * the bus leaves the taught spot. */
    if (taughtAnchor && machine.phase() === 'block1') {
      if (ENGINE.haversineM(taughtAnchor.lat, taughtAnchor.lng, f.lat, f.lng) > ENGINE.EXIT_M) {
        recordObs(taughtAnchor.date, taughtAnchor.arriveMin, ENGINE.minOfDay(f.t));
        taughtAnchor = null;
        persist();
      }
    }
    var ev = null;
    try {
      ev = machine.feed(f, { yard: yardPlace, midday: midPlace, window: windowNow() });
    } catch (e) { ev = null; }
    if (ev) onEvent(ev);
    /* The plan's own arrival: a fix at the current target stop
       has reached it — the cursor steps past, no dwell needed
       (a stop with nobody to pick up may only be a pass). The
       dwell-driven sheet walk above remains the run record's
       truth; this is navigation only. Monotonic: the cursor
       never steps back. */
    if (watching) {
      try {
        var pb = planBlock();
        var pstops = routeSheets[pb] || [];
        if (pstops.length) {
          var pday = planDay();
          var pprog = (navProg.date === pday) ? (navProg[pb] || 0) : 0;
          var pw = ENGINE.planWalk(pstops, pprog, planSkipKeys(), pb);
          if (pw.target >= 0) {
            var pt = pstops[pw.target];
            if (ENGINE.haversineM(pt.lat, pt.lng, f.lat, f.lng) <= PLAN_ARRIVE_M) {
              if (navProg.date !== pday) navProg = { date: pday, am: 0, pm: 0 };
              if (navProg[pb] < pw.target + 1) { navProg[pb] = pw.target + 1; persist(); }
            }
          }
        }
      } catch (e) {}
    }
    return ev;
  }

  function oneShotEdge(kind) {
    var g = null;
    try { g = window.MeticulousGeo || null; } catch (e) {}
    if (!g || typeof g.getCurrent !== 'function') return;
    try {
      g.getCurrent(9000).then(function (fix) {
        var f = ENGINE.normFix(fix);
        if (!f) return;
        lastFix = f;
        var got = null;
        try { got = yardLearner.observe(f); } catch (e) {}
        if (got) yardPlace = got;
        persist();
        void kind;
      }).catch(function () {});
    } catch (e) {}
  }

  var SplitShift = {
    _engine: ENGINE,

    enabled: enabled,

    /* Begin (or reattach) the split day for a tracker session.
       Called from the session start paths in js/app.js INSTEAD
       of GeoLoads.startDay when the session is a split day.
       Inert unless the preference is on AND the session itself
       was started as a split day (tracker.splitDay) — a session
       begun under Standard never converts mid-day. */
    startDay: function (key, opts) {
      restore();
      if (!enabled()) return false;
      var t = tracker();
      if (!t || !t.splitDay) return false;
      if (watching && sessionKey === key) return true;
      sessionKey = key;
      watching = true;
      var today = ENGINE.dayStr(Date.now());
      var snap = machine ? machine.snapshot() : null;
      if (!snap || snap.date !== today || (opts && opts.fresh)) {
        machine = ENGINE.createDayMachine(null);
        var sid = parseInt(String(key).slice(1), 10) || Date.now();
        machine.begin(sid);
      }
      if (dayStopsDate !== today) { dayStops = []; dayStopsDate = today; }
      seedFromDispatch(today);
      ensureRoutePlaced();
      subscribe();
      if (!(opts && opts.resume)) oneShotEdge('start');
      persist();
      return true;
    },

    /* The session stopped: the last fix is the yard's end edge
       (the bus sleeps where the day ended), and the machine's
       snapshot stays on the record for the day it described. */
    stopDay: function () {
      restore();
      if (lastFix && yardLearner) {
        var got = null;
        try { got = yardLearner.observe(lastFix); } catch (e) {}
        if (got) yardPlace = got;
      }
      watching = false;
      sessionKey = null;
      persist();
    },

    /* Native-service breadcrumbs (recorded while the app was
       backgrounded) fold through the very same fix path as live
       fixes — same dwell/window rules, deduped by timestamp. */
    ingestNativeCrumbs: function (crumbs) {
      if (!watching || !crumbs || !crumbs.length) return 0;
      var list = crumbs.slice().sort(function (x, y) { return (+x.t || 0) - (+y.t || 0); });
      var n = 0;
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (!c || !isFinite(+c.t)) continue;
        var before = lastFix ? lastFix.t : 0;
        feedFix({
          latitude: +c.a, longitude: +c.o,
          accuracy: (c.c === null || c.c === undefined || +c.c < 0) ? null : +c.c,
          time: +c.t
        });
        if (lastFix && lastFix.t > before) n++;
      }
      return n;
    },

    /* Spec point 5: the NEXT morning's pre-trip odometer closes
       yesterday. A filed PRE-trip report (modules/pti.js calls
       this at filing) whose date is later than a split session's
       day stamps that session's endOdo with the reading — the
       bus sat parked overnight, so the morning reading IS where
       yesterday ended. The most recent unclosed split day only;
       a post-trip report never does this, and a standard day is
       never touched. Returns true when a session was stamped. */
    onPreTripFiled: function (rep) {
      if (!rep || rep.kind === 'post') return false;
      var odo = parseFloat(rep.odometer);
      if (!(odo > 0) || !rep.date) return false;
      var s = store();
      if (!s) return false;
      var ss = null;
      try { ss = s.get('sessions', []); } catch (e) { return false; }
      if (!Array.isArray(ss)) return false;
      var best = -1;
      for (var i = 0; i < ss.length; i++) {
        var e = ss[i];
        if (!e || !e.split || e.endOdo || !e.date) continue;
        if (e.date >= rep.date) continue;   // only an EARLIER day closes
        if (best < 0 || e.date > ss[best].date) best = i;
      }
      if (best < 0) return false;
      ss[best].endOdo = odo;
      try { if (window.LiveMiles && LiveMiles.reconcileSession) LiveMiles.reconcileSession(ss[best]); } catch (err) {}
      try { s.set('sessions', ss); } catch (err) { return false; }
      return true;
    },

    /* The live day's blocks, for the session record app.js
       books at the close (entry.splitBlocks). */
    dayBlocks: function () {
      restore();
      return machine ? machine.blocks() : [];
    },

    /* Today's named route stops, in the order the bus made
       them — [{key, name, at}]. This is ALL that ever reaches
       the run record: names, never coordinates. Stops skipped
       for today (addendum 6) ride along flagged `skipped` —
       the served ones by their key, and sheet stops that were
       never driven appended in sheet order — so the record can
       show them by name, marked skipped, never "missed". */
    dayStops: function () {
      restore();
      var today = dayStopsDate || ENGINE.dayStr(Date.now());
      /* The skip marks belong to the calendar day they were
         made (toggleSkip's stamp) and to the record's own day —
         either stamp honours them, so a day that crosses
         midnight keeps its record honest. */
      var skipKeys = (daySkips.date === today || daySkips.date === ENGINE.dayStr(Date.now()))
        ? daySkips.keys : {};
      var served = {};
      var out = dayStops.map(function (s) {
        served[s.key] = true;
        var o = { key: s.key, name: s.name, at: s.at };
        if (skipKeys[s.key]) o.skipped = true;
        /* Kids actually carried at this stop (the roster minus
           today's absents) — the run record's count, never a
           load count. Sheet stops only; a learned extra stop
           carries no roster and no count. */
        var km = /^sheet:(am|pm):(\d+)$/.exec(s.key || '');
        if (km) {
          var kl = kidLine(km[1], +km[2]);
          if (kl.up.exp || kl.down.exp || kl.absent) {
            o.kids = { up: kl.up.got, down: kl.down.got, absent: kl.absent };
          }
        }
        return o;
      });
      ['am', 'pm'].forEach(function (b) {
        (routeSheets[b] || []).forEach(function (st, i) {
          var key = 'sheet:' + b + ':' + i;
          if (skipKeys[key] && !served[key]) {
            out.push({ key: key, name: st.name, at: 0, skipped: true });
          }
        });
      });
      return out;
    },

    /* One tap (addendum 6): skip this stop for TODAY only —
       or bring it back. The stop stays on the route/sheet
       untouched for tomorrow; today's record shows it skipped
       and the GPS matching steps over it. Returns the new
       skipped state. */
    toggleSkip: function (key) {
      restore();
      if (!key) return false;
      var today = ENGINE.dayStr(Date.now());
      if (daySkips.date !== today) daySkips = { date: today, keys: {} };
      if (daySkips.keys[key]) delete daySkips.keys[key];
      else daySkips.keys[key] = true;
      persist();
      return !!daySkips.keys[key];
    },

    /* One tap per absent kid (the kid-level skip law): this
       kid is absent TODAY — the run's count for their stop
       drops by one, the record says absent, and the roster
       itself is untouched for tomorrow. Key shape:
       'sheet:<block>:<idx>:<up|down>:<n>'. Returns the new
       absent state. */
    toggleAbsent: function (key) {
      restore();
      if (!/^sheet:(am|pm):\d+:(up|down):\d+$/.test(String(key || ''))) return false;
      var today = ENGINE.dayStr(Date.now());
      if (dayAbsent.date !== today) dayAbsent = { date: today, keys: {} };
      if (dayAbsent.keys[key]) delete dayAbsent.keys[key];
      else dayAbsent.keys[key] = true;
      persist();
      return !!dayAbsent.keys[key];
    },

    /* The kid totals per run, from the sheet's roster and
       today's truth: expected (the sheet's own counts),
       absent (her marks), and carried — boarded / set down at
       the stops the bus actually served, the same served set
       the run record carries. */
    kidCounts: function () {
      restore();
      var servedMap = {};
      SplitShift.dayStops().forEach(function (s) {
        if (s && !s.skipped) servedMap[s.key] = s;
      });
      var out = {};
      ['am', 'pm'].forEach(function (b) {
        var t = { expectedUp: 0, expectedDown: 0, absent: 0, boarded: 0, alighted: 0 };
        (routeSheets[b] || []).forEach(function (st, i) {
          var kl = kidLine(b, i);
          t.expectedUp += kl.up.exp;
          t.expectedDown += kl.down.exp;
          t.absent += kl.absent;
          var sv = servedMap['sheet:' + b + ':' + i];
          if (sv && sv.kids) { t.boarded += sv.kids.up || 0; t.alighted += sv.kids.down || 0; }
        });
        out[b] = t;
      });
      return out;
    },

    /* Today's route for the skip surface (the Manifest day
       view): the sheet's stops per run, each with its state —
       done (driven at), skipped for today, or still ahead —
       plus the day's extra stops the sheet doesn't know. */
    routeToday: function () {
      restore();
      var today = ENGINE.dayStr(Date.now());
      var skipKeys = (daySkips.date === today) ? daySkips.keys : {};
      var served = {};
      dayStops.forEach(function (s) { served[s.key] = s; });
      function rows(block) {
        return (routeSheets[block] || []).map(function (st, i) {
          var key = 'sheet:' + block + ':' + i;
          var doneAt = served[key] ? served[key].at : 0;
          var sheetMin = ENGINE.sheetTimeMin(st.time);
          return {
            key: key, name: st.name, time: st.time || '', block: block,
            skipped: !!skipKeys[key],
            doneAt: doneAt,
            /* The day measured against the known route: done,
               skipped (her mark only), or ahead — a stop never
               reached stays 'ahead' on the live day and reads
               as not reached once the day closes; it is never
               relabelled. deltaMin is her real arrival against
               the sheet's printed time, when both exist. */
            state: skipKeys[key] ? 'skipped' : (doneAt ? 'done' : 'ahead'),
            deltaMin: (doneAt && sheetMin !== null)
              ? ENGINE.minOfDay(doneAt) - sheetMin : null,
            kids: kidLine(block, i)
          };
        });
      }
      return {
        am: rows('am'), pm: rows('pm'),
        extras: dayStops.filter(function (s) { return String(s.key).indexOf('sheet:') !== 0; })
          .map(function (s) {
            return { key: s.key, name: s.name, at: s.at, skipped: !!skipKeys[s.key] };
          })
      };
    },

    /* The driver's rename, once (addendum 2): the new name
       lands on the learned stop — or on the route sheet's stop,
       for a 'sheet:<block>:<idx>' key — and on every recorded
       day that carries the stop, so the name sticks for the
       route. Returns true when a stop took the name. */
    renameStop: function (key, name) {
      restore();
      name = String(name || '').trim();
      if (!key || !name) return false;
      var ok = false;
      var sm = /^sheet:(am|pm):(\d+)$/.exec(String(key));
      if (sm) {
        var blk = routeSheets[sm[1]] || [];
        var idx = +sm[2];
        if (blk[idx]) {
          blk[idx].name = name;
          /* The placed point was geocoded from the OLD name —
             a rename retires it and the stop is placed afresh
             behind the glass. */
          delete blk[idx].lat; delete blk[idx].lng;
          delete blk[idx].ps; delete blk[idx].src;
          ok = true;
        }
      } else if (stopBook) {
        ok = stopBook.rename(key, name);
      }
      if (!ok) return false;
      for (var i = 0; i < dayStops.length; i++) {
        if (dayStops[i].key === key) dayStops[i].name = name;
      }
      var s = store();
      if (s) {
        try {
          var ss = s.get('sessions', []);
          if (Array.isArray(ss)) {
            var changed = false;
            for (var j = 0; j < ss.length; j++) {
              var e = ss[j];
              if (!e || !Array.isArray(e.splitStops)) continue;
              for (var k = 0; k < e.splitStops.length; k++) {
                if (e.splitStops[k] && e.splitStops[k].key === key && e.splitStops[k].name !== name) {
                  e.splitStops[k].name = name; changed = true;
                }
              }
            }
            if (changed) s.set('sessions', ss);
          }
        } catch (e2) {}
      }
      ensureRoutePlaced();
      persist();
      return true;
    },

    /* Route-sheet intake (addendum 5): the OCR text of a
       photographed route detail sheet becomes the run's route —
       every named stop, in order (times when printed). AM and
       PM sheets are separate routes. Re-shooting a sheet
       replaces that run's route. Returns the stop count read
       (0 = nothing readable — the caller says so plainly).
       The roster (the sheet's named students) is read from
       rosterText — the run's own section of the source file —
       or from the sheet text itself when no section is passed
       (a photographed sheet IS one run's text). A new sheet
       replaces the roster with it and retires the run's placed
       points, its plan cursor and its absent marks: they all
       belonged to the old sheet. */
    setRouteSheet: function (block, text, rosterText) {
      restore();
      if (block !== 'am' && block !== 'pm') return 0;
      var stops = ENGINE.parseRouteSheet(text);
      if (!stops.length) return 0;
      routeSheets[block] = stops;
      var rtext = (rosterText === undefined) ? text : rosterText;
      routeRoster[block] = rtext
        ? ENGINE.parseRouteRoster(rtext, stops)
        : stops.map(function () { return { up: [], down: [] }; });
      var today = ENGINE.dayStr(Date.now());
      if (sheetUsed.date === today) sheetUsed[block] = 0;
      if (navProg.date === today) navProg[block] = 0;
      if (dayAbsent.date === today) {
        var pre = 'sheet:' + block + ':';
        Object.keys(dayAbsent.keys).forEach(function (k) {
          if (k.indexOf(pre) === 0) delete dayAbsent.keys[k];
        });
      }
      persist();
      ensureRoutePlaced();
      return stops.length;
    },

    /* The day's navigation plan — the known route itself
       (ROUTE-SHEET-DRIVES-NAVIGATION-NOV8): the current run's
       stops in the sheet's own order and names, the cursor the
       day has reached, the routing target (the first stop from
       the cursor that carries a placed point), the stops passed
       over for routing because they carry no point yet (named,
       never dropped), and whether the last fix stands off the
       route's corridor. null when the account is not a split
       account or no route is known — the Navigator is then
       exactly what it was. Asking for the plan also keeps the
       route's placement warm behind the glass. */
    routePlan: function () {
      restore();
      if (!enabled()) return null;
      ensureRoutePlaced();
      var block = planBlock();
      var stops = routeSheets[block] || [];
      if (!stops.length) {
        var other = (block === 'am') ? 'pm' : 'am';
        if ((routeSheets[other] || []).length) { block = other; stops = routeSheets[block]; }
        else return null;
      }
      var day = planDay();
      var prog = (navProg.date === day) ? (navProg[block] || 0) : 0;
      var sk = planSkipKeys();
      var walk = ENGINE.planWalk(stops, prog, sk, block);
      var outStops = stops.map(function (st, i) {
        return {
          key: 'sheet:' + block + ':' + i,
          name: st.name, time: st.time || '',
          state: sk['sheet:' + block + ':' + i] ? 'skipped'
            : ((walk.done || i < prog || (walk.current >= 0 && i < walk.current)) ? 'done'
              : (i === walk.current ? 'current' : 'ahead')),
          placed: st.ps === 'ok'
        };
      });
      var chain = [];
      stops.forEach(function (st) { if (st.ps === 'ok') chain.push({ lat: st.lat, lng: st.lng }); });
      var off = false;
      if (chain.length >= 2 && lastFix) {
        var cd = ENGINE.distToChainM(lastFix.lat, lastFix.lng, chain);
        off = (cd !== null && cd > CORRIDOR_M);
      }
      return {
        block: block, total: stops.length, stops: outStops,
        current: walk.current, done: walk.done,
        target: walk.target >= 0 ? {
          idx: walk.target, key: 'sheet:' + block + ':' + walk.target,
          name: stops[walk.target].name,
          lat: stops[walk.target].lat, lng: stops[walk.target].lng
        } : null,
        passedNames: walk.passed.map(function (i) { return stops[i].name; }),
        offRoute: off
      };
    },

    /* The manual door: this stop is done — step the plan to
       the next one. (Arrivals step it behind the glass; this
       is the fallback tap.) Returns the new plan. */
    navAdvance: function () {
      restore();
      if (!enabled()) return null;
      var rp = SplitShift.routePlan();
      if (!rp || rp.done || rp.current < 0) return rp;
      var day = planDay();
      if (navProg.date !== day) navProg = { date: day, am: 0, pm: 0 };
      navProg[rp.block] = rp.current + 1;
      persist();
      return SplitShift.routePlan();
    },

    /* A face that navigated to a plan stop (the Navigator's
       own arrival) reports it reached: the plan steps past —
       only while that stop is still the plan's current one, so
       two arrival paths can never double-step. */
    navConsumeKey: function (key) {
      restore();
      if (!enabled() || !key) return null;
      var rp = SplitShift.routePlan();
      if (!rp || rp.done || rp.current < 0) return rp;
      if (rp.stops[rp.current] && rp.stops[rp.current].key === key) {
        var day = planDay();
        if (navProg.date !== day) navProg = { date: day, am: 0, pm: 0 };
        navProg[rp.block] = rp.current + 1;
        persist();
        return SplitShift.routePlan();
      }
      return rp;
    },
    routeSheetInfo: function () {
      restore();
      return {
        am: (routeSheets.am || []).length,
        pm: (routeSheets.pm || []).length
      };
    },

    /* Readout for the status surfaces / harnesses. */
    info: function () {
      restore();
      return {
        enabled: enabled(),
        watching: watching,
        phase: machine ? machine.phase() : null,
        blocks: machine ? machine.blocks() : [],
        window: windowNow(),
        yardKnown: !!yardPlace,
        middayKnown: !!midPlace,
        obsDays: windowObs.length,
        stopsToday: dayStops.length,
        stopsLearned: stopBook ? stopBook.count() : 0,
        sheetAm: (routeSheets.am || []).length,
        sheetPm: (routeSheets.pm || []).length,
        placedAm: (routeSheets.am || []).filter(function (s) { return s.ps === 'ok'; }).length,
        placedPm: (routeSheets.pm || []).filter(function (s) { return s.ps === 'ok'; }).length,
        kids: (function () { try { return SplitShift.kidCounts(); } catch (e) { return null; } })()
      };
    }
  };

  window.SplitShift = SplitShift;
  try { if (window.App) window.App.splitShift = SplitShift; } catch (e) {}
  restore();
  subscribe();
})();

