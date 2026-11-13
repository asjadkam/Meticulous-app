/* Meticulous — NAV-ML-LEARNING, stage 1 (owner, Nov 10, 2026:
   "the Navigator … should embed ML and be dynamic rather than
   static: it should learn each trucker's own route choices —
   routes taken because a road is too small, traffic builds up,
   or the trucker simply finds a route easier by gut feel —
   instead of always spitting out the same routes").

   Stage 1 is the honest first slice of that job, in four parts:
     1. ROUTE CAPTURE — while a drive runs, the path actually
        driven is recorded (thinned), automatically, no taps.
     2. DEVIATION LEARNING — when the driven path differs
        materially from the route the Navigator suggested for
        the same origin→destination pair, the driven path is
        stored as the LEARNED ROUTE for that pair, with a drive
        count. One drive plants it; repeat drives strengthen it.
     3. LEARNED ROUTE OFFERED — navigating the same pair again
        adopts the learned route FIRST (the Navigator module
        consults NavLearn.lookup before asking the server).
        Leaving it behaves exactly like leaving any route: the
        off-route re-route goes to the standard router, and the
        learned route is never re-offered inside that drive.
     4. PER-USER — the store key 'navlearn_routes' rides the
        ordinary App._store → Firestore mirror, so the learning
        is this account's own, from this driver's own driving.
        A fresh account simply has no learned routes and gets
        standard routing, exactly as before this file existed.

   v433 (NAV-TRUCK-ROUTING, owner Nov 12, 2026 — the truck
   GPS must assume the truck is LOADED, and must never learn
   that a weight-restricted street is fine): the Navigator
   screens every finished drive's trace against Calgary's
   truck network + the driver-reported restricted streets and
   hands finishTrip a screenFlag:
     - 'flagged' — the trace ran a real stretch over a
       restricted / off-network / reported street. Such a
       drive NEVER plants or refreshes a learned route (a
       driver may lawfully run such a street EMPTY; the
       learner must not promote that path for a loaded truck),
       and when the drive RODE a learned route, that record is
       TAINTED: lookup returns null for it from then on, so it
       can never be offered again.
     - 'unknown' — the screen could not run. Unverified is
       not clean: the drive teaches nothing.
     - 'clean', or no flag at all (outside Calgary, car mode,
       older callers) — the stage-1 rules below run exactly as
       written; every stage-1 bench pin still holds.
   The Navigator also calls markTainted directly when a
   learned route it was about to adopt screens flagged.

   Pairs are keyed by ~150 m cells, the same keying the load
   counter's site profiles use (js/geoloads.js cellKeyFor):
   0.0014° of latitude, 0.0022° of longitude.

   Deliberately NOT in stage 1: traffic-aware learning, learning
   road-size facts from OTHER drivers, named-road turn guidance
   along a learned line (the learned plan carries the line, the
   distance and his own typical time; the voice names the route
   as his usual one). Those are later stages, after this one
   proves itself in his hands. */
(function () {
  'use strict';

  /* ================= NAVLEARN-BEGIN =================
     Pure logic — no DOM, no App, no store. The node harness
     (tools/nav-ml-learning-stage1-test.js) extracts this region
     and drives it against simulated traces. Coordinates are
     [lat, lon] everywhere. */

  var NL_CELL_LAT = 0.0014, NL_CELL_LNG = 0.0022;   /* ~150 m cells (as geoloads) */
  var NL_THIN_M = 25;          /* min spacing between kept trace points */
  var NL_TRACE_MAX = 400;      /* most points a stored line may carry */
  var NL_OFF_M = 75;           /* a trace point farther than this from the
                                  suggested line counts as OFF that route */
  var NL_DEVIATE_FRAC = 0.25;  /* share of off-line points that makes the
                                  drive a material deviation */
  var NL_COMPLETE_DEST_M = 400;/* the trace must end within this of the
                                  destination for the drive to teach.
                                  v448: 250 -> 400 — a big yard's gate
                                  sits hundreds of metres from its pin
                                  (his Nov 4 tape: parked AT the site
                                  with 140 m of route still left); at
                                  250 m his completed drives to work
                                  judged "incomplete" and taught
                                  nothing, however often he drove
                                  his own way. The end-of-trace test
                                  still bars pass-bys: the drive must
                                  END here, after a real drive. */
  var NL_MATCH_M = 350;        /* v448: a stored pair matches a asked
                                  pair when BOTH endpoints sit within
                                  this — the ~150 m cell key alone
                                  made the same home->work pair a
                                  different pair whenever a drive
                                  started a street over or the pin
                                  moved a yard gate's width. */
  var NL_COMPLETE_MIN_M = 400; /* shortest driven length that can teach */
  var NL_COMPLETE_MIN_PTS = 8; /* fewest trace points that can teach */
  var NL_MAX_PAIRS = 60;       /* learned pairs kept (oldest-driven evicted) */
  var NL_FALLBACK_KMH = 38;    /* ETA pace when a pair has no timed drives */

  function nlHavM(a, b) {
    if (!a || !b) return Infinity;
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a[0] * rad) * Math.cos(b[0] * rad) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /* a ~150 m cell key — the same formula as geoloads.cellKeyFor,
     so a learned pair and a learned site speak the same grid. */
  function nlCellKey(lat, lng) {
    return Math.round(lat / NL_CELL_LAT) + ':' + Math.round(lng / NL_CELL_LNG);
  }
  function nlCellKeyOf(pt) { return nlCellKey(pt[0], pt[1]); }

  /* the pair a drive belongs to: origin cell → destination cell. */
  function nlPairKey(origin, dest) {
    if (!origin || !dest) return null;
    return nlCellKeyOf(origin) + '>' + nlCellKeyOf(dest);
  }

  function nlLineLengthM(line) {
    if (!line || line.length < 2) return 0;
    var m = 0, i;
    for (i = 0; i + 1 < line.length; i++) m += nlHavM(line[i], line[i + 1]);
    return m;
  }

  /* distance from point p to segment a-b, metres (equirectangular
     local plane — the same approximation the Navigator's own
     pointSegM uses). */
  function nlPointSegM(p, a, b) {
    var rad = Math.PI / 180;
    var kx = 111320 * Math.cos(p[0] * rad), ky = 110540;
    var px = p[1] * kx, py = p[0] * ky;
    var ax = a[1] * kx, ay = a[0] * ky;
    var bx = b[1] * kx, by = b[0] * ky;
    var dx = bx - ax, dy = by - ay;
    var L2 = dx * dx + dy * dy;
    var t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var cx = ax + t * dx, cy = ay + t * dy;
    return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
  }

  function nlDistToLineM(p, line) {
    if (!line || !line.length) return Infinity;
    if (line.length === 1) return nlHavM(p, line[0]);
    var best = Infinity, i;
    for (i = 0; i + 1 < line.length; i++) {
      var d = nlPointSegM(p, line[i], line[i + 1]);
      if (d < best) best = d;
    }
    return best;
  }

  /* thin a raw trace: first point, then any point at least
     minM from the last kept one; the final point always kept.
     Output capped at NL_TRACE_MAX by widening the spacing. */
  function nlThinTrace(points, minM) {
    if (!points || !points.length) return [];
    var spacing = minM || NL_THIN_M;
    var out = thinPass(points, spacing);
    while (out.length > NL_TRACE_MAX) {
      spacing *= 1.6;
      out = thinPass(points, spacing);
    }
    return out;
  }
  function thinPass(points, spacing) {
    var out = [points[0]], i;
    for (i = 1; i < points.length; i++) {
      if (nlHavM(out[out.length - 1], points[i]) >= spacing) out.push(points[i]);
    }
    var last = points[points.length - 1];
    if (out[out.length - 1] !== last) out.push(last);
    return out;
  }

  function nlRoundLine(line) {
    return (line || []).map(function (p) {
      return [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];
    });
  }

  /* Judge one finished drive.
     trace     — the points actually driven (already thinned).
     suggested — the line the Navigator suggested for this pair
                 when the drive began (the plan in force at drive
                 start; mid-drive re-routes do not rewrite it).
     dest      — the destination the drive was for.
     A drive teaches only when it COMPLETED: it ended at the
     destination's door after a real drive. It is a DEVIATION
     when a material share of its points ran off the suggested
     line — the driver chose his own way for a real stretch,
     not a parking-lot wiggle at either end. */
  function nlAssessDrive(trace, suggested, dest) {
    var out = { completed: false, deviated: false, fracOff: 0, lengthM: 0, endDistM: Infinity, points: 0 };
    if (!trace || !dest) return out;
    out.points = trace.length;
    out.lengthM = nlLineLengthM(trace);
    if (trace.length) out.endDistM = nlHavM(trace[trace.length - 1], dest);
    out.completed = out.endDistM <= NL_COMPLETE_DEST_M &&
      out.lengthM >= NL_COMPLETE_MIN_M && trace.length >= NL_COMPLETE_MIN_PTS;
    if (suggested && suggested.length >= 2 && trace.length) {
      var off = 0, i;
      for (i = 0; i < trace.length; i++) {
        if (nlDistToLineM(trace[i], suggested) > NL_OFF_M) off++;
      }
      out.fracOff = off / trace.length;
    }
    out.deviated = out.completed && out.fracOff > NL_DEVIATE_FRAC;
    return out;
  }

  function nlEmptyData() { return { routes: {} }; }
  function nlNormData(d) {
    if (!d || typeof d !== 'object' || !d.routes || typeof d.routes !== 'object') return nlEmptyData();
    return d;
  }

  /* Fold one finished drive into the learned-routes data.
     drive = { pairKey, origin, dest, destLabel, trace,
               durationSec, onLearned, now, assessment }
     (assessment from nlAssessDrive). Returns {data, changed, why}.
     Rules, exactly the stage-1 contract:
       - an incomplete drive teaches nothing;
       - a drive that FOLLOWED the suggested route teaches
         nothing (the router already gives that way);
       - a completed DEVIATION plants or refreshes the pair's
         learned route — the newest driven way is his current
         way — and adds one to its count;
       - a completed drive ON the learned route (it was the
         suggestion this time) strengthens it: count + 1, the
         stored line kept (stability beats chasing GPS noise).
     v448: two contract repairs. (1) The record a drive belongs
     to is found by endpoint match (nlFindRecord), not only by
     the drive's own cell key — a refresh lands on the record
     the driver was actually offered, never a duplicate under a
     neighbouring cell. (2) A completed drive that STARTED on
     the learned route but then materially DEVIATED from it is
     a deviation like any other: the way he actually drove is
     the newest plant/refresh for the pair. Before v448 the
     Navigator nulled such a trip's reference line, the
     assessment read it as "followed", and the drive taught
     nothing at all — leaving a learned route even once made
     the whole drive invisible to the learner. */
  function nlApplyDrive(data, drive) {
    data = nlNormData(data);
    if (!drive || !drive.pairKey || !drive.assessment) return { data: data, changed: false, why: 'nodrive' };
    var a = drive.assessment;
    if (!a.completed) return { data: data, changed: false, why: 'incomplete' };
    var now = drive.now || Date.now();
    var found = nlFindRecord(data, drive.origin, drive.dest);
    var recKey = found ? found.key : drive.pairKey;
    var rec = found ? found.rec : (data.routes[drive.pairKey] || null);
    var dur = (typeof drive.durationSec === 'number' && drive.durationSec > 0) ? drive.durationSec : 0;
    /* v433 (NAV-TRUCK-ROUTING): the truck-legality guard runs
       BEFORE every stage-1 rule. A flagged drive teaches
       nothing — never planted, never refreshed, never
       strengthened — and a flagged drive ON a learned route
       taints that record so it is never offered again. An
       unscreened ('unknown') drive teaches nothing either.
       Absent flag -> the stage-1 rules below, unchanged. */
    if (drive.screenFlag === 'flagged') {
      if (drive.onLearned && rec) {
        rec.tainted = { why: 'trucknet', at: now };
        return { data: data, changed: true, why: 'tainted' };
      }
      return { data: data, changed: false, why: 'restricted' };
    }
    if (drive.screenFlag === 'unknown') return { data: data, changed: false, why: 'unverified' };
    if (drive.onLearned && !a.deviated) {
      if (!rec) return { data: data, changed: false, why: 'learned-gone' };
      rec.count = (rec.count || 0) + 1;
      rec.totalDurSec = (rec.totalDurSec || 0) + dur;
      rec.lastAt = now;
      return { data: data, changed: true, why: 'strengthened' };
    }
    if (!a.deviated) return { data: data, changed: false, why: 'followed' };
    var line = nlRoundLine(nlThinTrace(drive.trace || [], NL_THIN_M));
    if (line.length < 2) return { data: data, changed: false, why: 'short' };
    if (rec) {
      rec.line = line;
      rec.count = (rec.count || 0) + 1;
      rec.totalDurSec = (rec.totalDurSec || 0) + dur;
      rec.lastAt = now;
      if (drive.destLabel) rec.destLabel = drive.destLabel;
    } else {
      rec = {
        line: line, count: 1, totalDurSec: dur,
        createdAt: now, lastAt: now,
        origin: nlRoundLine([drive.origin])[0], dest: nlRoundLine([drive.dest])[0],
        destLabel: drive.destLabel || ''
      };
      data.routes[recKey] = rec;
    }
    var keys = Object.keys(data.routes);
    if (keys.length > NL_MAX_PAIRS) {
      keys.sort(function (x, y) { return (data.routes[x].lastAt || 0) - (data.routes[y].lastAt || 0); });
      while (keys.length > NL_MAX_PAIRS) { delete data.routes[keys.shift()]; }
    }
    return { data: data, changed: true, why: rec.count === 1 ? 'planted' : 'refreshed' };
  }

  /* v448: the stored record (if any) that belongs to an
     origin->dest pair — matched on the pair's ACTUAL endpoints,
     not only its cell key. A record matches when both its
     endpoints sit within NL_MATCH_M of the asked ones; the
     nearest match wins and an exact cell hit scores ~0, so
     yesterday's behaviour is preserved wherever it worked.
     Records planted before endpoints were stored fall back to
     their line's own ends. Returns {key, rec} or null. */
  function nlFindRecord(data, origin, dest) {
    if (!origin || !dest) return null;
    var best = null, bestScore = Infinity;
    var keys = Object.keys(data.routes || {});
    for (var i = 0; i < keys.length; i++) {
      var rec = data.routes[keys[i]];
      if (!rec || !rec.line || rec.line.length < 2) continue;
      var ro = rec.origin || rec.line[0];
      var rd = rec.dest || rec.line[rec.line.length - 1];
      if (!ro || !rd) continue;
      var dO = nlHavM(origin, ro), dD = nlHavM(dest, rd);
      if (dO <= NL_MATCH_M && dD <= NL_MATCH_M) {
        var score = dO + dD;
        if (score < bestScore) { bestScore = score; best = { key: keys[i], rec: rec }; }
      }
    }
    return best;
  }

  /* The learned record for a pair, or null — the fresh-account
     answer is null for every pair, which IS standard routing. */
  function nlLookupIn(data, origin, dest) {
    data = nlNormData(data);
    var found = nlFindRecord(data, origin, dest);
    if (!found) return null;
    /* v433: a tainted record (its line runs a truck-illegal
       stretch — see nlApplyDrive / markTainted) is never
       offered, exactly as if it had never been learned. */
    if (found.rec.tainted) return null;
    /* v448: remember WHICH key matched — the caller taints by
       this key, not by a re-derived cell key that may name a
       different (empty) cell. The mark rides the in-memory
       object only; a store round-trip never carries it. */
    found.rec.__foundKey = found.key;
    return found.rec;
  }

  /* Build the route the Navigator adopts for a learned pair:
     his own driven line, a two-maneuver plan in the exact shape
     maneuverPlan produces (the drive machinery reads nothing
     else), totalMin from HIS OWN average time over this pair's
     drives when he has timed ones, else a plain pace estimate.
     The first maneuver's words name it as his usual route — the
     same words the banner, the steps list and the voice carry. */
  function nlBuildPlan(line, rec, destLabel) {
    if (!line || line.length < 2) return null;
    var totalKm = nlLineLengthM(line) / 1000;
    var totalMin;
    if (rec && rec.count > 0 && rec.totalDurSec > 0) totalMin = (rec.totalDurSec / rec.count) / 60;
    else totalMin = totalKm / NL_FALLBACK_KMH * 60;
    var label = destLabel || (rec && rec.destLabel) || 'your destination';
    var head = 'Your usual route to ' + label;
    var maneuvers = [
      { instruction: head, verbalPre: head, verbalPost: '', streets: [], sign: null, lengthKm: totalKm, cumStartKm: 0, cumEndKm: totalKm, type: 1 },
      { instruction: 'You have arrived', verbalPre: '', verbalPost: 'You have arrived.', streets: [], sign: null, lengthKm: 0, cumStartKm: totalKm, cumEndKm: totalKm, type: 4 }
    ];
    return { maneuvers: maneuvers, totalKm: totalKm, totalMin: totalMin };
  }

  /* ================= NAVLEARN-END ================= */

  /* ---------- store IO + trip runtime ----------
     The store is the ordinary App._store (localStorage mt_
     prefix, mirrored to this account's Firestore by
     js/cloudsync.js like every other key) — the same substrate
     the load counter's 'geoload_site_profiles' rides. Every
     seam is guarded: with no store (benches, a broken boot)
     learning is simply inert and routing is untouched. */
  var NL_KEY = 'navlearn_routes';

  function nlStore() {
    try { return (typeof window !== 'undefined' && window.App && App._store) ? App._store : null; }
    catch (e) { return null; }
  }
  /* v448: the session's own truth, held only while the store
     REFUSES a write. The store has reported failure since v48
     and the owner's phone sits at the storage wall (the v446 /
     v447 family) — the pre-v448 nlSave swallowed the refusal
     whole, so a route learned in the morning could be gone by
     the next lookup and nobody ever knew. Now a save counts
     only when it READS BACK (the v447 verified-write law); a
     refused save keeps the data here, nlLoad merges it over
     the stale store copy, and the next successful save clears
     it — learning survives the session and heals to disk the
     first time the store takes a write again. */
  var nlMem = null;
  function nlLoad() {
    var s = nlStore();
    var d = null;
    try { d = s ? s.get(NL_KEY, null) : null; } catch (e) { d = null; }
    d = nlNormData(d);
    if (nlMem) {
      var merged = nlEmptyData();
      Object.keys(d.routes).forEach(function (k) { merged.routes[k] = d.routes[k]; });
      Object.keys(nlMem.routes).forEach(function (k) { merged.routes[k] = nlMem.routes[k]; });
      return merged;
    }
    return d;
  }
  function nlSave(d) {
    var s = nlStore();
    var ok = false;
    try { if (s) ok = !!s.set(NL_KEY, d); } catch (e) { ok = false; }
    if (ok) {
      try {
        var back = s.get(NL_KEY, null);
        ok = !!(back && back.routes &&
          Object.keys(back.routes).length === Object.keys((d && d.routes) || {}).length);
      } catch (e) { ok = false; }
    }
    nlMem = ok ? null : d;
    return ok;
  }

  var NavLearn = {
    /* pure core, re-exported for the module + the bench */
    cellKeyOf: nlCellKeyOf, pairKeyFor: nlPairKey, thinTrace: nlThinTrace,
    lineLengthM: nlLineLengthM, assessDrive: nlAssessDrive,
    applyDrive: nlApplyDrive, lookupIn: nlLookupIn, buildPlan: nlBuildPlan,
    findRecord: nlFindRecord,
    emptyData: nlEmptyData,

    /* the destination's cell — the Navigator's suppression key
       when a learned route is left mid-drive. */
    destCellOf: function (dest) { return dest ? nlCellKeyOf(dest) : ''; },

    /* the learned record for navigating origin → dest now. */
    lookup: function (origin, dest) {
      return nlLookupIn(nlLoad(), origin, dest);
    },

    /* the adoptable route for a learned record: {line, plan,
       count, key} in the shapes finalizeRoute consumes. v448:
       key is the record's own store key (the endpoint match
       that found it), so a taint lands on the record that was
       actually offered. */
    planFor: function (rec, destLabel) {
      if (!rec || !rec.line || rec.line.length < 2) return null;
      var plan = nlBuildPlan(rec.line, rec, destLabel);
      if (!plan) return null;
      return { line: rec.line.slice(), plan: plan, count: rec.count || 1, key: rec.__foundKey || null };
    },

    /* v433: taint a learned record by pair key — its line
       runs a truck-illegal stretch, so lookup never offers it
       again. Called by the Navigator when a learned route it
       was about to adopt screens flagged, before the driver
       ever rides it. */
    markTainted: function (pairKey, why) {
      if (!pairKey) return;
      var d = nlLoad();
      var rec = d.routes[pairKey];
      if (!rec || rec.tainted) return;
      rec.tainted = { why: why || 'trucknet', at: Date.now() };
      nlSave(d);
    },

    /* Begin capturing a drive. suggested = the line in force at
       drive start (the pair's reference suggestion — a learned
       line when the drive rides one, the server's otherwise). */
    beginTrip: function (origin, dest, destLabel, suggested, onLearned) {
      if (!origin || !dest) return null;
      return {
        pairKey: nlPairKey(origin, dest),
        origin: [origin[0], origin[1]], dest: [dest[0], dest[1]],
        destLabel: destLabel || '',
        suggested: (suggested && suggested.length >= 2) ? suggested.slice() : null,
        onLearned: !!onLearned,
        trace: [[origin[0], origin[1]]],
        startedAt: Date.now()
      };
    },

    /* One fix for the running trip — thinned as it lands, so a
       whole day of driving costs a few hundred points at most. */
    pushFix: function (trip, pos) {
      if (!trip || !pos || !trip.trace.length) return;
      var last = trip.trace[trip.trace.length - 1];
      if (nlHavM(last, pos) >= NL_THIN_M) trip.trace.push([pos[0], pos[1]]);
    },

    /* The drive ended (arrival, End tap, route cleared — the
       Navigator's exitDrive funnels all three here). Judged and
       folded into the store; anything short of a completed drive
       at the destination teaches nothing. */
    finishTrip: function (trip, lastPos, screenFlag) {
      if (!trip) return null;
      if (lastPos) NavLearn.pushFix(trip, lastPos);
      /* the destination door is judged on the trace's true end:
         guarantee the final resting point is in the trace even
         when it sits within the thinning spacing of the last
         kept point. */
      if (lastPos && trip.trace.length) trip.trace[trip.trace.length - 1] = [lastPos[0], lastPos[1]];
      var assessment = nlAssessDrive(trip.trace, trip.suggested, trip.dest);
      var res = nlApplyDrive(nlLoad(), {
        pairKey: trip.pairKey, origin: trip.origin, dest: trip.dest,
        destLabel: trip.destLabel, trace: trip.trace,
        durationSec: Math.max(0, (Date.now() - trip.startedAt) / 1000),
        onLearned: trip.onLearned, now: Date.now(), assessment: assessment,
        screenFlag: screenFlag
      });
      if (res.changed) nlSave(res.data);
      return res;
    }
  };

  if (typeof window !== 'undefined') window.NavLearn = NavLearn;
})();
