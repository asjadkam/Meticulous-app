/* Meticulous — live miles tracking + odometer reconciliation (v40).
 *
 * The owner's design (Oct 13, 2026): LIVE miles are the primary tracking —
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
 *  - v126: THE WAKE REBUILD. The v63 dedupe watermark was the live
 *    anchor's TIMESTAMP: any crumb at or before it counted as
 *    "already observed". But the first live fix after a relaunch
 *    takes the join path — it re-anchors WITHOUT counting — so the
 *    anchor TELEPORTS past every stretch the web stream never
 *    counted, and the native run that genuinely observed those
 *    stretches was then skipped wholesale (and acked away by the
 *    drain). That is the owner's Oct 14–17 pattern exactly: app
 *    opened in bursts at stops, dead while driving; dashboard
 *    showed a foreground fragment (Oct 17: 13.3 km against 45
 *    odometer km). The engine now tracks WHAT WAS ACTUALLY
 *    COUNTED — `segs`, the merged time-intervals folded into the
 *    total — and dedupes merges against them, never against the
 *    anchor. A join re-anchor preserves its origin point
 *    (`joinFrom`) so a later crumb run can connect through it
 *    under the same OBS_GAP honesty gate as before. Unobserved
 *    stretches are still never counted: the gate, the filters and
 *    the gap finder are unchanged. Pre-v126 records carry no
 *    `segs`; begin() seeds coverage from the record's own crumb
 *    span (its counted trail) so pre-upgrade ground cannot be
 *    counted twice — that span can over-claim at most the one
 *    join segment the old join path once skipped inside it.
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

  /* v126: counted-coverage intervals. `segs` is the merged, sorted
     list of [t0, t1] time spans already folded into totalM. It —
     never the anchor's timestamp — is the dedupe truth: the anchor
     can teleport across uncounted ground on a join re-anchor, but
     a span is in this list only if a real segment was counted over
     it. Counting is chronological, so inserts almost always land
     at the end; merges that fill an older hole insert mid-list. */
  function segAdd(segs, t0, t1) {
    if (!(t1 > t0)) return;
    var out = [], placed = false;
    for (var i = 0; i < segs.length; i++) {
      var a = segs[i][0], b = segs[i][1];
      if (b < t0) { out.push(segs[i]); continue; }          // entirely before, no touch
      if (a > t1) {                                          // entirely after
        if (!placed) { out.push([t0, t1]); placed = true; }
        out.push(segs[i]); continue;
      }
      if (a < t0) t0 = a;                                    // overlap/touch: absorb
      if (b > t1) t1 = b;
    }
    if (!placed) out.push([t0, t1]);
    segs.length = 0;
    for (var j = 0; j < out.length; j++) segs.push(out[j]);
  }
  function segOverlaps(segs, t0, t1) {
    for (var i = 0; i < segs.length; i++) {
      if (segs[i][0] < t1 && t0 < segs[i][1]) return true;
    }
    return false;
  }
  function segCoversPoint(segs, t) {
    for (var i = 0; i < segs.length; i++) {
      if (segs[i][0] <= t && t <= segs[i][1]) return true;
    }
    return false;
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
          crumbs: [], hasFix: false, joinZero: false,
          segs: [], joinFrom: null
        };
        if (saved) {
          S.totalM = (typeof saved.totalM === 'number' && saved.totalM > 0) ? saved.totalM : 0;
          if (saved.crumbs && saved.crumbs.length) S.crumbs = saved.crumbs.slice();
          S.hasFix = !!saved.hasFix;
          if (saved.segs && saved.segs.length) {
            for (var si = 0; si < saved.segs.length; si++) {
              var sp = saved.segs[si];
              if (sp && isFinite(+sp[0]) && isFinite(+sp[1]) && +sp[1] > +sp[0]) {
                S.segs.push([+sp[0], +sp[1]]);
              }
            }
          }
          if (saved.joinFrom && isFinite(saved.joinFrom.latitude) && isFinite(saved.joinFrom.longitude)) {
            S.joinFrom = {
              time: saved.joinFrom.time,
              latitude: saved.joinFrom.latitude,
              longitude: saved.joinFrom.longitude
            };
          }
          if (saved.anchor && isFinite(saved.anchor.latitude) && isFinite(saved.anchor.longitude)) {
            S.anchor = {
              time: saved.anchor.time,
              latitude: saved.anchor.latitude,
              longitude: saved.anchor.longitude
            };
            S.joinZero = true;
            // v126: the restored anchor IS a join origin until a
            // crumb run proves (or disproves) coverage across it —
            // remember it as such even after the first live fix
            // re-anchors past it.
            if (!S.joinFrom) {
              S.joinFrom = {
                time: S.anchor.time,
                latitude: S.anchor.latitude,
                longitude: S.anchor.longitude
              };
            }
            if (!S.segs.length && S.totalM > 0) {
              // Pre-v126 record (no coverage list): seed coverage
              // with the record's own crumb span — the trail its
              // total was counted over — so a post-upgrade drain
              // cannot count that ground a second time.
              var firstT = S.anchor.time;
              for (var ci = 0; ci < S.crumbs.length; ci++) {
                var ct = S.crumbs[ci] && S.crumbs[ci].t;
                if (typeof ct === 'number' && ct > 0 && ct < firstT) firstT = ct;
              }
              if (S.anchor.time > firstT) S.segs.push([firstT, S.anchor.time]);
            }
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
          // v126: the origin point is PRESERVED as joinFrom — the
          // anchor teleports, but a native crumb run drained later
          // can still connect through the origin and count the
          // stretch the service genuinely observed (mergeCrumbs).
          // The earliest unconsumed origin wins: a second relaunch
          // must not orphan an older unfilled join.
          if (!S.joinFrom) {
            S.joinFrom = {
              time: S.anchor.time,
              latitude: S.anchor.latitude,
              longitude: S.anchor.longitude
            };
          }
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
        segAdd(S.segs, S.anchor.time, f.time);
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
          - crumbs are normalized to fixes and sorted by time, then
            walked as one chain in time order;
          - v126: a candidate segment counts only when its time span
            is NOT already covered by `segs` (the intervals actually
            folded into the total). The old rule — "at or before the
            anchor = already observed" — was the Oct 14–17 hole: a
            post-relaunch live fix teleports the anchor past ground
            nobody counted, and the whole observed run behind it was
            skipped. Coverage, not the anchor, is the watermark now;
          - the chain seeds from the join origin (joinFrom) when a
            relaunch join is unconsumed, else from the live anchor.
            The seed segment is the JOIN: it counts only when the
            run proves the service observed across the kill — the
            first crumb lands within OBS_GAP_MAX_MS of the seed.
            Otherwise the join is reported (gapJoins), the first
            crumb becomes the chain start, and only the observed
            run behind it counts — the stretch itself stays
            uncounted, never bridged, never invented;
          - every later segment goes through the SAME filters as a
            live fix (accuracy, jitter, teleport), so a hole inside
            the service's own run is treated exactly like a hole in
            the live stream (counted only if speed-plausible; the
            gap finder still reports it).
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
        var joinOutstanding = !!S.joinZero || !!S.joinFrom;
        var seed = null;
        if (S.joinFrom) {
          seed = { time: S.joinFrom.time, latitude: S.joinFrom.latitude, longitude: S.joinFrom.longitude };
        } else if (S.anchor) {
          seed = { time: S.anchor.time, latitude: S.anchor.latitude, longitude: S.anchor.longitude };
        }
        var chain = null;          // the point the next segment counts FROM
        var seedPair = false;      // the next pair is the seed (join) pair
        if (seed && list.length && list[0].time > seed.time) {
          chain = seed;
          seedPair = true;
        }
        for (var j = 0; j < list.length; j++) {
          var f = list[j];
          if (f.accuracy !== null && f.accuracy !== undefined && f.accuracy > ACC_MAX_M) {
            res.skipped++; // bad fix: never a chain point (mirrors ingest)
            continue;
          }
          if (!chain) {
            // First usable point of the walk: it becomes the chain
            // start without counting anything into it. Adopted as
            // "accepted" only when it advances the live anchor
            // (a first-ever point, or the far side of a refused
            // join handled below); a point at/behind the anchor is
            // simply where the walk starts measuring from.
            chain = f;
            if (!S.anchor || f.time > S.anchor.time) res.accepted++;
            else res.skipped++;
            continue;
          }
          if (f.time <= chain.time) { res.skipped++; continue; } // stale / duplicate stamp
          if (segOverlaps(S.segs, chain.time, f.time)) {
            // Already folded into the total by whichever stream
            // observed it first — advance the chain, count nothing.
            res.skipped++;
            chain = f;
            seedPair = false;
            continue;
          }
          if (seedPair && joinOutstanding && f.time - chain.time > OBS_GAP_MAX_MS) {
            // The join stretch was observed by NOBODY: report it,
            // start the chain at this crumb, count nothing for it.
            res.gapJoins++;
            seedPair = false;
            chain = f;
            res.accepted++; // adopted as the chain start (like ingest's join)
            continue;
          }
          seedPair = false;
          var d = haversineM(chain.latitude, chain.longitude, f.latitude, f.longitude);
          if (d < MIN_STEP_M) { res.skipped++; continue; } // jitter: chain stays (accumulates)
          var dtH = (f.time - chain.time) / 3600000;
          if ((d / 1000) / dtH > MAX_SPEED_KMH) { res.skipped++; continue; } // teleport: point dropped
          S.totalM += d;
          segAdd(S.segs, chain.time, f.time);
          res.accepted++;
          res.addedM += d;
          chain = f;
          // A counted segment also lands the point in the day's
          // breadcrumb record when the live stream never saw it,
          // so the gap finder works from one complete trail.
          maybeCrumb({ time: f.time, latitude: f.latitude, longitude: f.longitude });
        }
        // The walk may have counted past the live anchor (the
        // common wake case: the fold reconstructs ground the live
        // stream teleported over). Adopt its end as the anchor so
        // the next live fix continues the same chain.
        if (chain && (!S.anchor || chain.time > S.anchor.time)) {
          S.anchor = { time: chain.time, latitude: chain.latitude, longitude: chain.longitude };
          S.hasFix = true;
          S.joinZero = false;
        }
        // A join origin the counted coverage now spans is consumed:
        // the chain is whole again and the origin must not seed a
        // second, stale connection later.
        if (S.joinFrom && segCoversPoint(S.segs, S.joinFrom.time) &&
            S.anchor && segCoversPoint(S.segs, S.anchor.time)) {
          S.joinFrom = null;
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
          hasFix: S.hasFix,
          // v126: the counted-coverage intervals + the unconsumed
          // join origin — the rebuild state must survive the same
          // kills the total does, or the next wake dedupes blind.
          segs: S.segs.map(function (p) { return [p[0], p[1]]; }),
          joinFrom: S.joinFrom ? { time: S.joinFrom.time, latitude: S.joinFrom.latitude, longitude: S.joinFrom.longitude } : null
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

  /* Reconciliation (the owner's rule): live miles are the tracking; the
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
      /* v174: the day's OWN pre-session watch record (the date
         key — armed by the app itself because a plan exists for
         this day, see App.checkAutoStart) is adopted WHOLE,
         however early the roll-out began: the slack windows
         exist to keep OTHER records from leaking into a session,
         and this record is this day's own driving by
         construction. Native/crumb fragments and other sessions'
         records keep the windows exactly as before. */
      if (k === 'd' + dateStr) { out.push({ key: k, rec: rec, totalM: total, lastT: lastT }); return; }
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
    if (r.accepted) {
      /* v279: counted movement is the post-close heartbeat —
         the stillness clock runs from the last real ground. */
      if (postClose && r.addedM > 0) postLastMoveAt = Date.now();
      persist(false); paint();
    }
  }
  function onGeoError() {
    // Permission denied / plugin error: stop pretending. Accumulated
    // miles so far stay stored; the dashboard line hides (no fake data).
    broken = true;
    watching = false;
    paint();
  }

  /* v279 (MILES-HOME-LEG-AFTER-CLOSE): POST-CLOSE ACCRUAL.
     The shift close (app.js stopSessionAt) asks stopDay for
     { trailHome: true }: the session entry keeps the at-close
     total and the day stays closed, but the watcher and the
     engine stay alive in this mode, so the drive home keeps
     adding crumbs + total to the CLOSED day's persisted
     livemiles record — the record the Manifest joins for its
     route (v275), which is where the owner asked for the home
     leg to land. The dashboard miles line stays hidden in
     this mode (paint() below): the tracker face is NOT
     reopened, and sessionRunning() is false, so no wake hold
     is wanted. STOP CONDITION (named): accrual ends after
     POST_CLOSE_STILL_MS with no counted movement — the truck
     is parked for the night — or when a new session's
     startDay supersedes it, or on a plain stopDay(),
     whichever comes first. Loads are NOT accrued here:
     GeoLoads stops at the close as before. */
  var POST_CLOSE_STILL_MS = 30 * 60 * 1000;
  var postClose = false;
  var postLastMoveAt = 0;
  var postTimer = null;
  function endPostClose() {
    if (!postClose) return;
    postClose = false;
    if (postTimer) { try { clearInterval(postTimer); } catch (e) {} postTimer = null; }
    try { engine.flushCrumb(); } catch (e) {}
    persist(true);
    if (watching) {
      watching = false;
      var g = geoApi();
      if (g) { try { g.stop(); } catch (e) {} }
    }
    engine.stop();
    dayKey = null;
    paint();
  }
  function postCloseTick() {
    if (!postClose) return;
    if (Date.now() - postLastMoveAt >= POST_CLOSE_STILL_MS) endPostClose();
  }

  function paint() {
    paintWake(); // v70: reconcile the wake chip from live state on every paint
    /* v216 (DATA-BEHIND-SIGNIN): while signed out the tracker lines
       stay blank — the day's miles are the user's data, and data is
       behind the sign-in door (js/app.js); paintWake included, so
       the chip it just reconciled is blanked again below. The
       engine keeps counting underneath; painting resumes on
       sign-in. Inert wherever the shell's lock is absent (older
       pages, suites). */
    if (typeof window !== 'undefined' && window.App && App._authLocked && App._authLocked()) {
      try {
        var lm = document.getElementById('trkMiles');
        if (lm) { lm.textContent = ''; lm.classList.add('hidden'); }
        var wk = document.getElementById('trkWake');
        if (wk) { wk.textContent = ''; wk.classList.add('hidden'); }
      } catch (e) {}
      lastPaint = '';
      return;
    }
    var elm = null;
    try { elm = document.getElementById('trkMiles'); } catch (e) {}
    if (!elm) return;
    /* v279: post-close accrual never repaints the miles line —
       the day is closed; the trail grows in the record only. */
    var show = watching && !broken && !postClose;
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
      /* v279: a new session supersedes post-close accrual. A
         startDay for the SAME key (a reattach of the day that
         just closed is not a session start — the close stands)
         simply disarms the mode and falls through; a different
         key seals the closed day first. */
      if (postClose) {
        if (key === dayKey) {
          postClose = false;
          if (postTimer) { try { clearInterval(postTimer); } catch (e) {} postTimer = null; }
        } else {
          endPostClose();
        }
      }
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
        /* v174: flush the OUTGOING record fresh before the switch
           — the adoption below reads the persisted snapshot, and
           the throttled persist can lag the live engine by
           minutes (the day watch's whole total sat in memory
           while its stored snapshot still read zero). */
        persist(true);
        try { g.stop(); } catch (e) {}
        watching = false;
      }
      dayKey = key;
      broken = false;
      var keyMs = parseInt(String(key).slice(1), 10) || Date.now();
      var saved = recordFor(key);
      dayDate = (function () { var d = new Date(keyMs); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); })();
      /* v174: a DATE-keyed record (the pre-session day watch,
         'dYYYY-MM-DD') names its own day — the numeric parse of
         its key would land in 1970 and orphan the record. */
      var dKeyM = /^d(\d{4}-\d{2}-\d{2})$/.exec(String(key));
      if (dKeyM) dayDate = dKeyM[1];
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
      var foldFrags = [];
      var savedFromFrag = false;
      var frags = adoptableFragments(dayDate, keyMs, key);
      if (!saved) {
        if (frags.length) {
          frags.sort(function (x, y) { return (y.totalM - x.totalM) || (y.lastT - x.lastT); });
          saved = frags[0].rec;
          savedFromFrag = true;
          adoptedFrom = frags;
          foldFrags = frags.slice(1);
        }
      } else if (frags.length) {
        /* v287 (REINSTALL-LIVE-KM / D3, owner Oct 30 13:31 MDT):
           the fold used to run ONLY when no saved record existed.
           On a reinstall the cloud-restored session record DOES
           exist — so miles the fresh boot counted into the
           day-watch fragment before sign-in (App.armDayMiles arms
           it at every boot) were orphaned for the whole shift.
           The fragments now fold into the restored session too:
           mergeCrumbs' timestamp dedupe + segs coverage keep the
           fold exactly-once, and only fragments whose crumbs
           actually folded are retired. */
        adoptedFrom = frags;
        foldFrags = frags;
      }
      if (saved && saved.date) dayDate = saved.date;
      // A record under this key can only belong to THIS session (the key
      // is its pinned start identity), so restoring it is always right —
      // the engine's join rule keeps a relaunch from double-counting.
      engine.begin(key, saved);
      watching = true;
      paint();
      if (adoptedFrom.length) {
        var foldedKeys = [];
        /* the no-saved path: frags[0] became the record itself —
           its key retires with the fold like the original code. */
        if (savedFromFrag) foldedKeys.push(adoptedFrom[0].key);
        for (var fi = 0; fi < foldFrags.length; fi++) {
          var frec = foldFrags[fi].rec;
          if (frec.crumbs && frec.crumbs.length) {
            try { engine.mergeCrumbs(frec.crumbs); } catch (e) {}
            foldedKeys.push(foldFrags[fi].key);
          }
        }
        if (foldedKeys.length) {
          persist(true);
          dropRecords(foldedKeys);
          paint();
        }
      }
      g.start(onFix, onGeoError).then(function (ok) {
        if (!ok) { watching = false; broken = true; paint(); }
        else { watchBornAt = Date.now(); }
      }).catch(function () { watching = false; broken = true; paint(); });
      return true;
    },

    /* Session stopped: watcher off, final crumb appended, record
       persisted. Returns { liveKm, key } — liveKm is null when no fix
       was ever accepted (no data is NOT 0 miles).
       v279: opts.trailHome (the shift close's ask — see the
       post-close note above) keeps the watcher + engine alive
       accruing to the closed day's record when the day has a
       fix-backed total; the returned liveKm is still the
       at-close total the session entry carries. A plain
       stopDay() while post-close is armed seals the accrual. */
    stopDay: function (opts) {
      if (postClose && !(opts && opts.trailHome)) {
        var pk = dayKey;
        endPostClose();
        return { liveKm: LiveMiles.recordKmFor(pk), key: pk };
      }
      wakeHold.unwant(); // v62: the session is over — the screen may sleep
      var out = { liveKm: null, key: dayKey };
      if (dayKey) {
        try { engine.flushCrumb(); } catch (e) {}
        persist(true);
        if (engine.hasFix()) out.liveKm = Math.round(engine.totalM() / 10) / 100;
      }
      if (opts && opts.trailHome && dayKey && out.liveKm !== null && watching) {
        postClose = true;
        postLastMoveAt = Date.now();
        if (postTimer) { try { clearInterval(postTimer); } catch (e) {} }
        postTimer = setInterval(postCloseTick, 60000);
        paint();
        return out;
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

    /* v279: post-close accrual state (see the note above). */
    postCloseActive: function () { return postClose; },

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

    /* v222 (LIVE-MILES-DISPLAY-RESET-OCT22): re-seed the RUNNING
       engine from the persisted record for its own day key. The
       reinstall trap this closes: on a fresh install the boot path
       starts the engine BEFORE the first cloud pull lands — the
       local store is empty, so the engine begins at zero — and the
       sign-in reattach then skips startDay because the key already
       matches, so the pulled record (the day's real total, e.g.
       131 km) never enters the engine and the hero counts up from
       ~0 while later persists overwrite the restored record with
       the young engine's numbers. Call this once the store may
       hold more than the engine does (after the first pull, on
       sign-in): when the persisted total EXCEEDS the engine's, the
       engine re-begins from the persisted snapshot and the live
       engine's own crumbs fold back through mergeCrumbs — its
       counted-coverage dedupe keeps every stretch exactly-once,
       so ground counted since boot survives the adoption and
       ground the record already counted is never counted twice.
       When the engine is already ahead, this is a no-op. */
    reseedFromStore: function () {
      if (!dayKey) return false;
      var saved = recordFor(dayKey);
      if (!saved || typeof saved.totalM !== 'number') return false;
      var live = engine.snapshot();
      var liveTotal = live ? (live.totalM || 0) : 0;
      if (!(saved.totalM > liveTotal)) return false;
      var liveCrumbs = live ? live.crumbs : [];
      engine.begin(dayKey, saved);
      if (liveCrumbs && liveCrumbs.length) {
        try { engine.mergeCrumbs(liveCrumbs); } catch (e) {}
      }
      persist(true);
      paint();
      return true;
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
