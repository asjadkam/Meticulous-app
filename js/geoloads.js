/* Meticulous — geofence load counting for the Manifest (v50, stage 1).
 *
 * The owner's spec (Oct 14, 2026): the Manifest must count his loads
 * by GEOFENCING — how many times the truck has been to the OTHER
 * location (load site <-> dump site cycles). Counting is BY
 * COORDINATES, not street address. The fences are tight because loads
 * are sometimes moved WITHIN one site where the address never changes:
 * moving around inside a site must not create fake locations or fake
 * loads, and two sites that share one address must still count cycles
 * by coordinate transitions.
 *
 * How it works (stage 1):
 *  - The two fences come from the ACTIVE dispatch: the load site is
 *    the dispatch's stored map pin (lat/lng — from the rate-con pin /
 *    OCR coordinates); the dump site is the record's dumpLat/dumpLng
 *    when present, else a one-shot FREE geocode (OpenStreetMap
 *    Nominatim, via MeticulousGeo.geocode) of the dispatch's drop-off
 *    address, persisted back onto the dispatch record so it is looked
 *    up exactly once. A dispatch with only one resolvable site counts
 *    NOTHING — a cycle needs two distinct coordinates, and the day
 *    record says why (shown on the Manifest).
 *  - A pure state machine (engine, between the GEOLOADS-ENGINE
 *    markers) consumes the same live-GPS fix stream as LiveMiles
 *    (js/miles.js) while a tracker session runs:
 *      AT_LOAD -> EN_ROUTE -> AT_DUMP (load counted, event stamped)
 *      -> EN_ROUTE -> AT_LOAD (re-armed).
 *    A load counts ONLY on a load-site -> dump-site transition, with
 *    a tight 120 m fence, a 50 m GPS-accuracy filter, a 45 s arrival
 *    dwell and a 30 s departure dwell so fence-edge jitter and
 *    drive-bys cannot double-count. Movement inside one site never
 *    leaves its fence, so it produces no transitions and no counts.
 *  - Counts + timestamped events persist per date in the synced store
 *    key 'geoloads', and the Manifest shows the GPS-counted loads
 *    SEPARATELY from ticket-entered loads. Tickets stay authoritative
 *    for pay in this stage; nothing is merged or overwritten.
 *
 * Honesty rules:
 *  - Counting runs only while the tracker session / live GPS is alive
 *    (the owner's normal all-shift state) on a build that HAS live
 *    location (native shell). On web / old shells there is no fix
 *    stream, the counter never starts, and no fake numbers appear.
 *  - This is GPS-tracked counting, NOT OS-level geofencing — the
 *    phone OS does not watch these fences while the app is dead.
 *    Native-shell geofences are a later stage.
 *  - v63 (native v34): on the new shell, the native foreground
 *    service keeps recording GPS breadcrumbs while the app is
 *    backgrounded or dead; on resume they replay through the same
 *    fix path (ingestNativeCrumbs), so a load<->dump cycle completed
 *    while the app was closed still counts. Stretches with NO
 *    breadcrumb at all (phone off, service killed) stay unobserved
 *    and are never reconstructed.
 *  - v68 (learning): the two-pin assumption above rarely fires in
 *    real dump work — the dump location is almost NEVER on the
 *    dispatch, because the operator gives it verbally on site
 *    (owner, Oct 14). So when a dispatch has a load pin but no dump
 *    pin, a pure learner (createDumpLearner, in the engine below)
 *    learns the dump site from the driving itself: the first full
 *    load-visit -> departure -> ~2 min dwell >= 300 m away teaches
 *    the site, the teaching cycle is credited as load #1, and the
 *    pair is remembered in the synced key 'geoload_pairs' (keyed by
 *    the load site) so later days with the same load site start
 *    counting from the first load. Two rival candidates before the
 *    first cycle completes = an ambiguous day that teaches nothing.
 *    On a remembered-pair day, a different candidate is RECORDED
 *    on the day (altDump) but never overwrites the pair. The user
 *    is never asked for the dump location — figuring it out is the
 *    app's job, not his (invisible-complexity rule).
 *
 * v140 (Oct 17, 2026 — LOAD AUTO-COUNT): the owner did 3–4+ loads
 * before noon while the app showed none of them: the only load
 * number on his dashboard was his own +1 taps. Characterization
 * (the real pair replayed through this glue — Maple Ridge load
 * pin 50.96044,-114.03176 <-> Ivor East Pond, dispatch carrying
 * ONLY the load pin, as saved that day): counting worked in clean
 * traces with tip dwells >= ~150 s and silently recorded ZERO all
 * day below that (the day stayed 'learning'), and three
 * structural gaps sat behind it, all proven in code:
 *   (1) The dashboard never displayed this count at all — the
 *       tracker card showed manualLoads only (js/app.js), and
 *       the shared dayLoads ladder ranked the GPS count LAST,
 *       behind the driver's own taps, so even a perfect count
 *       was invisible where he looks and outranked by any tap.
 *   (2) The dump fence could only come from the dispatch's own
 *       dumpLat/dumpLng — a field nothing in the app populates
 *       for real dispatches (only this file's one-shot geocode
 *       of a street-address dropoff, which site-name dropoffs
 *       never pass) — or from a remembered pair, or from same-day
 *       teaching. Yet the app already KNEW both sites: Maple
 *       Ridge and Ivor East Pond sit in his own work favorites
 *       (v91 migration) and the 9 built-in pits exist — and this
 *       file never consulted the places data at all.
 *   (3) Teaching was fragile at real tip behaviour: a fixed
 *       first-fix cluster anchor let GPS wander restart the
 *       3-minute dwell clock mid-stop.
 * The build: dump resolution gains the NAVIGATED hand-off — a
 * work place the driver himself navigated to today (nav_data
 * recents, recorded at the Navigate tap, before arrival) that
 * forms a valid pair with the load site is adopted as the day's
 * dump (src 'navigated'), the counter arms BEFORE he arrives,
 * and the pair is remembered once a cycle is proven there. A
 * dispatch whose pin never landed can still resolve its load
 * site by NAME against the known places (unique match only —
 * a fence is never placed on a guess). Teaching stays as the
 * last resort, hardened: the cluster rides its running centroid
 * and the dwell bar is a real tip's 2 minutes. And the count
 * becomes the count of record: GeoLoads.today() feeds the
 * dashboard, the shared dayLoads ladder ranks the movement
 * count above taps (taps are the driver's correction, used
 * when the machine has nothing), and the dispatch close
 * pre-fills from it first. Tickets and deliberately recorded
 * counts still outrank it — paperwork is paperwork.
 */
(function () {
  'use strict';

  /* GEOLOADS-ENGINE-BEGIN — pure logic; may use only plain JS + Date.
     Fix shape in:  { latitude, longitude, accuracy, time } (geo.js fix).
     Site shape:    { lat, lng } in decimal degrees. */

  var RADIUS_M = 120;          // fence radius — tight on purpose (see header)
  var DWELL_MS = 45 * 1000;    // continuous presence inside a fence to
                               // register an arrival (kills drive-bys)
  var DEPART_MS = 30 * 1000;   // continuous absence from both fences to
                               // register a departure (kills edge jitter)
  var ACC_MAX_M = 50;          // drop fixes with accuracy worse than 50 m
                               // (same bar as the miles engine)
  var MAX_SPEED_KMH = 160;     // implied speed above this = bad fix, drop
  var MIN_SITE_SEP_M = 250;    // two sites must be at least this far
  var CAND_GRACE_MS = 25 * 1000; // v220: a zone candidate survives a
                                 // brief excursion (<= this long) out
                                 // of its zone — presence accumulates
                                 // across it instead of restarting
                                 // (LOADS-MISS-OCT22)
                               // apart to form a countable pair (with a
                               // 120 m fence, <240 m would overlap)

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

  /* Can these two sites form a countable load<->dump pair? Coordinates
     only — street addresses are never consulted. */
  function sitesCheck(load, dump) {
    if (!isCoord(load) || !isCoord(dump)) return { ok: false, why: 'missing', sep: 0 };
    var sep = haversineM(load.lat, load.lng, dump.lat, dump.lng);
    if (sep < MIN_SITE_SEP_M) return { ok: false, why: 'too-close', sep: sep };
    return { ok: true, why: '', sep: sep };
  }

  /* Does this free text look like a street address worth ONE free
     geocode attempt? Site names ("Aecon — Deerfoot site") return
     city-level matches that would put a fence in the wrong place, so
     they are never geocoded. */
  function looksLikeAddress(text) {
    if (!text || typeof text !== 'string') return false;
    if (!/\d/.test(text)) return false;
    if (/[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d/.test(text)) return true; // postal code
    return /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ct|court|cres|crescent|ln|lane|way|hwy|highway|trl|trail|bay|pl|place|ter|terrace|gate|rdg|ridge)\b/i.test(text) ||
      /,/.test(text);
  }

  /* The cycle counter. One instance per (session, site pair).
     Phases: 'away' -> 'at-load' -> 'to-dump' -> 'at-dump' -> 'to-load'
     -> 'at-load' ... A load is counted when the truck, having been
     confirmed AT the load site (armed), is confirmed AT the dump
     site. State survives via snapshot()/begin(key, saved). */
  function createGeoLoadCounter(cfg) {
    var LOAD = { lat: +cfg.load.lat, lng: +cfg.load.lng };
    var DUMP = { lat: +cfg.dump.lat, lng: +cfg.dump.lng };
    var radiusM = cfg.radiusM || RADIUS_M;
    var dwellMs = cfg.dwellMs || DWELL_MS;
    var departMs = cfg.departMs || DEPART_MS;
    var accMaxM = cfg.accMaxM || ACC_MAX_M;
    var S = null;

    function classify(lat, lng) {
      var dL = haversineM(lat, lng, LOAD.lat, LOAD.lng);
      var dD = haversineM(lat, lng, DUMP.lat, DUMP.lng);
      var inL = dL <= radiusM, inD = dD <= radiusM;
      if (inL && inD) return dL <= dD ? 'load' : 'dump'; // overlap: nearer site wins
      if (inL) return 'load';
      if (inD) return 'dump';
      return 'out';
    }

    function confirmZone(z, t) {
      var prev = S.zone;
      S.zone = z;
      S.cand = null;
      if (z === 'load') {
        S.phase = 'at-load';
        S.armed = true;              // picked up (or present to pick up)
      } else if (z === 'dump') {
        if (S.armed) {
          S.count++;
          S.events.push({ t: t, site: 'dump', n: S.count });
          S.counted = true;
          S.armed = false;
        }
        S.phase = 'at-dump';
      } else { // 'out'
        if (prev === 'load') S.phase = 'to-dump';
        else if (prev === 'dump') S.phase = 'to-load';
      }
    }

    return {
      /* saved: a previous snapshot() for the same session + site
         pair. On resume the confirmed zone/phase/count carry over;
         any half-built arrival candidate is dropped, so the truck
         must dwell again before the next transition registers —
         a relaunch can never invent a load. */
      begin: function (key, saved) {
        S = {
          key: key, active: true, zone: 'out', phase: 'away',
          armed: false, count: 0, events: [],
          cand: null, lastT: 0, lastLat: null, lastLng: null, counted: false
        };
        if (saved && saved.sitesKey === key) {
          if (typeof saved.count === 'number' && saved.count > 0) S.count = saved.count;
          if (saved.events && saved.events.length) S.events = saved.events.slice();
          if (saved.zone === 'load' || saved.zone === 'dump' || saved.zone === 'out') S.zone = saved.zone;
          if (typeof saved.phase === 'string') S.phase = saved.phase;
          S.armed = !!saved.armed;
          if (typeof saved.lastT === 'number') S.lastT = saved.lastT;
        }
        return S.key;
      },
      /* Feed one fix. Returns { accepted, zone (raw), confirmed,
         phase, counted, count }. Bad fixes (no/inaccurate/stale/
         teleport) are ignored ENTIRELY — they neither build nor
         break a dwell. */
      ingest: function (fix) {
        if (!S || !S.active) return { accepted: false, why: 'inactive' };
        S.counted = false;
        if (!fix || !isFinite(fix.latitude) || !isFinite(fix.longitude)) {
          return { accepted: false, why: 'bad-fix' };
        }
        if (fix.accuracy !== null && fix.accuracy !== undefined && fix.accuracy > accMaxM) {
          return { accepted: false, why: 'accuracy' };
        }
        var t = (typeof fix.time === 'number' && fix.time > 0) ? fix.time : 0;
        if (!t) return { accepted: false, why: 'no-time' };
        if (S.lastT && t <= S.lastT) return { accepted: false, why: 'stale' };
        if (S.lastLat !== null) {
          var dJump = haversineM(S.lastLat, S.lastLng, fix.latitude, fix.longitude);
          var dtH = (t - S.lastT) / 3600000;
          if (dtH > 0 && (dJump / 1000) / dtH > MAX_SPEED_KMH) {
            return { accepted: false, why: 'teleport' };
          }
        }
        S.lastT = t; S.lastLat = +fix.latitude; S.lastLng = +fix.longitude;

        var raw = classify(+fix.latitude, +fix.longitude);
        if (raw === S.zone) {
          S.cand = null;
        } else if (!S.cand) {
          S.cand = { zone: raw, since: t, gapMs: 0, awaySince: null, awayZone: null };
        } else if (raw === S.cand.zone) {
          /* v220 (LOADS-MISS-OCT22): a brief excursion out of the
             candidate zone — GPS wander at the fence edge, the
             truck creeping while it tips — no longer RESTARTS the
             confirmation clock. Presence accumulates: excursion
             time inside the grace window is subtracted, not
             fatal. Field evidence, Oct 22, 2026: same-site cycles
             counted 5 of the driver's 7 — the missed tips were
             the short, creeping ones whose 45 s of continuous
             in-fence presence kept resetting. A genuine departure
             still replaces the candidate once the excursion runs
             past the grace window, and a mid-leg stop (raw 'out'
             throughout) still counts nothing: counting still
             requires the armed load->dump alternation itself. */
          if (S.cand.awaySince) {
            S.cand.gapMs += t - S.cand.awaySince;
            S.cand.awaySince = null; S.cand.awayZone = null;
          }
          var need = (raw === 'out') ? departMs : dwellMs;
          if (t - S.cand.since - S.cand.gapMs >= need) confirmZone(raw, t);
        } else if (!S.cand.awaySince) {
          S.cand.awaySince = t; S.cand.awayZone = raw; // excursion begins; grace runs
        } else if (t - S.cand.awaySince > CAND_GRACE_MS) {
          S.cand = {
            zone: raw,
            since: (S.cand.awayZone === raw) ? S.cand.awaySince : t,
            gapMs: 0, awaySince: null, awayZone: null
          };
        }
        // else: inside the grace window — hold the candidate as-is
        return {
          accepted: true, zone: raw, confirmed: S.zone, phase: S.phase,
          counted: S.counted, count: S.count
        };
      },
      stop: function () { if (S) S.active = false; },
      snapshot: function () {
        if (!S) return null;
        return {
          sitesKey: S.key, zone: S.zone, phase: S.phase, armed: S.armed,
          count: S.count, events: S.events.slice(), lastT: S.lastT
        };
      },
      count: function () { return S ? S.count : 0; },
      events: function () { return S ? S.events.slice() : []; },
      phase: function () { return S ? S.phase : 'away'; },
      zone: function () { return S ? S.zone : 'out'; },
      isActive: function () { return !!(S && S.active); }
    };
  }

  /* ---- dump-site learning (v68) ----
     Dump work almost never puts the dump location on the dispatch —
     the operator tells the driver verbally, ON SITE (owner, Oct 14).
     So when a dispatch carries a load pin but NO dump pin, the app
     learns the dump site from the driving itself instead of asking
     the user for data he does not have (the invisible-complexity
     rule: our problem to figure out, never the user's homework).
     The learner watches the same fix stream and applies the same
     visit discipline as the counter:
       confirmed load-site visit (45 s dwell in the 120 m fence)
       -> confirmed departure (30 s out)
       -> a stationary dwell of ~2 min (LEARN_DWELL_MS) at one place
          (fixes staying within LEARN_CLUSTER_M) that is >= 300 m
          (LEARN_MIN_SEP_M) from the load site = a dump candidate.
     Modes, set by cfg.dump:
       dump == null  TEACH — the first candidate is the day's learned
         dump site (the caller arms the counter with it and credits
         the teaching cycle as load #1). If a SECOND, different
         candidate (>250 m from the first) shows up before the caller
         locks the teaching — lock() = the truck completed the cycle
         back at the load site — the teaching is CONTESTED: the day
         is ambiguous and must teach nothing.
       dump != null  OBSERVE — counting is already armed (pin or a
         remembered pair); a candidate >250 m from the known dump is
         reported ONCE as an alternate. The known site is NEVER
         overwritten from driving alone.
     After lock(), teach mode behaves like observe mode against the
     taught site. The learner never counts anything itself, and bad
     fixes (accuracy/stale/teleport) are ignored exactly as in the
     counter. */
  var LEARN_DWELL_MS = 2 * 60 * 1000; // stationary dwell that makes a candidate
                                      // (v140: was 3 min — characterization on the
                                      // owner's Oct 17 pair showed real tip stops
                                      // teach at ~150 s of clustered presence in
                                      // clean traces and never below it; the bar
                                      // is now a real tip: position + raise +
                                      // lower, with the contest rule still
                                      // guarding false teachings)
  var LEARN_MIN_SEP_M = 300;          // candidate must be this far from load
  var LEARN_CLUSTER_M = 100;          // a "place": fixes stay within this of
                                      // the cluster's running centroid (v140:
                                      // was 75 m of the FIRST fix — GPS wander
                                      // restarted the dwell clock mid-stop)
  var CONTEST_SEP_M = MIN_SITE_SEP_M; // 250 m: closer = the SAME place

  function createDumpLearner(cfg) {
    var LOAD = { lat: +cfg.load.lat, lng: +cfg.load.lng };
    var DUMP = (cfg.dump && isCoord(cfg.dump)) ? { lat: +cfg.dump.lat, lng: +cfg.dump.lng } : null;
    var radiusM = cfg.radiusM || RADIUS_M;
    var dwellMs = cfg.dwellMs || DWELL_MS;
    var departMs = cfg.departMs || DEPART_MS;
    var learnDwellMs = cfg.learnDwellMs || LEARN_DWELL_MS;
    var learnMinSepM = cfg.learnMinSepM || LEARN_MIN_SEP_M;
    var clusterM = cfg.clusterM || LEARN_CLUSTER_M;
    var accMaxM = cfg.accMaxM || ACC_MAX_M;
    var S = null;

    function knownDump() { return S.learned || DUMP; }

    function resolveCandidate(cand, res) {
      // too close to the load site: never a dump candidate at all
      if (haversineM(cand.lat, cand.lng, LOAD.lat, LOAD.lng) < learnMinSepM) return;
      var known = knownDump();
      if (!known) {
        S.learned = cand;
        res.learned = cand;
        return;
      }
      if (haversineM(cand.lat, cand.lng, known.lat, known.lng) <= CONTEST_SEP_M) {
        return; // the same place again — nothing to decide
      }
      if (!DUMP && !S.locked) {
        S.ambiguous = true;
        res.contested = { taught: S.learned, rival: cand };
      } else if (!S.altDone) {
        S.altDone = true;
        res.altCandidate = cand;
      }
    }

    return {
      /* saved: a previous snapshot() from the same day/session. The
         confirmed zone, leg, teaching and verdicts carry over; a
         half-built dwell cluster is dropped — the truck must dwell
         again, so a relaunch can never invent a dump site. */
      begin: function (saved) {
        S = {
          active: true, zone: 'out', zoneCand: null,
          atLoad: false, legArmed: false, cluster: null,
          learned: null, locked: false, ambiguous: false, altDone: false,
          lastT: 0, lastLat: null, lastLng: null
        };
        if (saved && typeof saved === 'object') {
          if (saved.zone === 'load' || saved.zone === 'out') S.zone = saved.zone;
          S.atLoad = !!saved.atLoad;
          S.legArmed = !!saved.legArmed;
          if (saved.learned && isCoord(saved.learned)) {
            S.learned = { lat: +saved.learned.lat, lng: +saved.learned.lng, t: +saved.learned.t || 0 };
          }
          S.locked = !!saved.locked;
          S.ambiguous = !!saved.ambiguous;
          S.altDone = !!saved.altDone;
          if (typeof saved.lastT === 'number') S.lastT = saved.lastT;
        }
        return true;
      },
      ingest: function (fix) {
        var res = { accepted: false };
        if (!S || !S.active) { res.why = 'inactive'; return res; }
        if (!fix || !isFinite(fix.latitude) || !isFinite(fix.longitude)) { res.why = 'bad-fix'; return res; }
        if (fix.accuracy !== null && fix.accuracy !== undefined && fix.accuracy > accMaxM) { res.why = 'accuracy'; return res; }
        var t = (typeof fix.time === 'number' && fix.time > 0) ? fix.time : 0;
        if (!t) { res.why = 'no-time'; return res; }
        if (S.lastT && t <= S.lastT) { res.why = 'stale'; return res; }
        if (S.lastLat !== null) {
          var dJump = haversineM(S.lastLat, S.lastLng, fix.latitude, fix.longitude);
          var dtH = (t - S.lastT) / 3600000;
          if (dtH > 0 && (dJump / 1000) / dtH > MAX_SPEED_KMH) { res.why = 'teleport'; return res; }
        }
        S.lastT = t; S.lastLat = +fix.latitude; S.lastLng = +fix.longitude;
        res.accepted = true;

        var raw = haversineM(+fix.latitude, +fix.longitude, LOAD.lat, LOAD.lng) <= radiusM ? 'load' : 'out';
        if (raw === S.zone) {
          S.zoneCand = null;
        } else if (!S.zoneCand) {
          S.zoneCand = { zone: raw, since: t, gapMs: 0, awaySince: null, awayZone: null };
        } else if (raw === S.zoneCand.zone) {
          /* v220: same presence accumulation as the counter
             (LOADS-MISS-OCT22) — a brief fence-edge excursion
             inside the grace window is subtracted, not fatal. */
          if (S.zoneCand.awaySince) {
            S.zoneCand.gapMs += t - S.zoneCand.awaySince;
            S.zoneCand.awaySince = null; S.zoneCand.awayZone = null;
          }
          var need = (raw === 'out') ? departMs : dwellMs;
          if (t - S.zoneCand.since - S.zoneCand.gapMs >= need) {
            S.zone = raw; S.zoneCand = null;
            if (raw === 'load') {
              S.atLoad = true; S.legArmed = false; S.cluster = null;
            } else if (S.atLoad) {
              S.atLoad = false; S.legArmed = true; S.cluster = null;
            }
          }
        } else if (!S.zoneCand.awaySince) {
          S.zoneCand.awaySince = t; S.zoneCand.awayZone = raw;
        } else if (t - S.zoneCand.awaySince > CAND_GRACE_MS) {
          S.zoneCand = {
            zone: raw,
            since: (S.zoneCand.awayZone === raw) ? S.zoneCand.awaySince : t,
            gapMs: 0, awaySince: null, awayZone: null
          };
        }
        // else: inside the grace window — hold the candidate as-is
        res.zone = S.zone;

        /* Candidate watching: only on a loaded leg (confirmed load
           visit, then confirmed departure) and only while confirmed
           OUT of the load fence. */
        if (S.legArmed && S.zone === 'out' && !S.ambiguous) {
          var cl = S.cluster;
          if (!cl) {
            S.cluster = { lat: +fix.latitude, lng: +fix.longitude, sumLat: +fix.latitude, sumLng: +fix.longitude, n: 1, since: t };
          } else if (haversineM(cl.sumLat / cl.n, cl.sumLng / cl.n, +fix.latitude, +fix.longitude) <= clusterM) {
            cl.sumLat += +fix.latitude; cl.sumLng += +fix.longitude; cl.n++;
            if (t - cl.since >= learnDwellMs) {
              var cand = { lat: cl.sumLat / cl.n, lng: cl.sumLng / cl.n, t: t };
              S.cluster = null;
              /* The leg stays armed: a SECOND, different candidate
                 on this same loaded leg (a fuel stop can precede the
                 real dump) is exactly the ambiguity the contest rule
                 exists for. The leg ends only at the load fence. */
              resolveCandidate(cand, res);
            }
          } else {
            S.cluster = { lat: +fix.latitude, lng: +fix.longitude, sumLat: +fix.latitude, sumLng: +fix.longitude, n: 1, since: t };
          }
        }
        return res;
      },
      /* The truck completed the cycle (dumped, returned, confirmed
         back at the load site): the teaching is proven for the day —
         later odd dwells become alternates, never contests. */
      lock: function () { if (S && S.learned && !S.ambiguous) S.locked = true; },
      stop: function () { if (S) S.active = false; },
      snapshot: function () {
        if (!S) return null;
        return {
          zone: S.zone, atLoad: S.atLoad, legArmed: S.legArmed,
          learned: S.learned ? { lat: S.learned.lat, lng: S.learned.lng, t: S.learned.t } : null,
          locked: S.locked, ambiguous: S.ambiguous, altDone: S.altDone, lastT: S.lastT
        };
      },
      learned: function () { return S ? S.learned : null; },
      isAmbiguous: function () { return !!(S && S.ambiguous); },
      isActive: function () { return !!(S && S.active); }
    };
  }

  /* ---- pattern learning (v203, LOADS-GPS-FIX) ----
     The dump learner above still needs ONE known site to start:
     the load fence. A real dispatch from a boss's text message
     often carries NEITHER a pin NOR a name the places can answer
     (a customer + project string) — Oct 21, 2026 the whole
     counting chain sat blind on exactly such a day while the
     truck ran clean pit<->dump cycles (the Manifest's own trail
     showed the stops; the GPS counter recorded ZERO and the
     driver tapped all 13 loads by hand — the one job the app
     swore he would never do). This learner needs NO site at
     all: it watches the day's dwell clusters and reads the
     cycle's shape out of the driving itself.
       - A place CONFIRMS the dump learner's way: fixes staying
         within LEARN_CLUSTER_M of a running centroid for
         LEARN_DWELL_MS (a real stop, never a drive-past).
       - HOME never anchors (the v190 rule: home is not a work
         stop — the session starts there, and a 40-minute
         at-home dwell is not a pit).
       - The FIRST confirmed work place is the ANCHOR (the load
         site): a dump day starts empty, leaves home, and its
         first work dwell is where the truck loads.
       - v220 SUPERSEDES the v203 emission rule below it: a
         second confirmed place is only a CANDIDATE — the pair
         is emitted when the full cycle (anchor -> candidate ->
         anchor) has completed TWICE (see the v220 note at
         createPatternLearner). A third distinct place before
         proof contests the day; two tight sub-spots inside the
         anchor's own area can prove an intra-site pair the
         same way.
     Direction honesty: even if a day's first work dwell were
     somehow the dump side, the cycle COUNT is the same — the
     counter counts completed alternations either way; only
     the load/dump labels could sit swapped. */
  /* v220 (owner, Oct 22, 2026 — LOADS-TIGHT-GEOFENCE): the proof
     bar for a learned dump site, in the owner's words: a place is
     learned as a dump site ONLY when the full loaded cycle
     (pit -> place -> pit) completes there AND REPEATS — and a
     mid-leg stop (arrive loaded, leave loaded — a washroom break,
     off site, several minutes) must NEVER be learned or counted.
     Dwell length alone does not discriminate; the completed,
     repeated cycle does. Changes against the v203 learner:
       - The second place is only a CANDIDATE. The pair is emitted
         (and the counter armed, and the pair remembered) when the
         truck has closed the cycle back at the anchor TWICE —
         two proven cycles, both credited. A third distinct place
         confirming before proof contests the day, exactly as
         before — a mid-leg stop on the way to a different real
         dump can therefore never become the teaching.
       - SAME-SITE jobs: when load and dump are the same place,
         no second place ever confirms. The learner then reads
         the pattern INSIDE the anchor's own area with TIGHT
         sub-clusters (INTRA_CLUSTER_M around a running centroid,
         only fixes accurate to INTRA_ACC_MAX_M): two sub-spots
         >= INTRA_SEP_M apart — the loading spot and the tipping
         spot — alternating through the same two proven cycles
         emit an intra-site pair, and the counter arms on the
         sub-spots with a tight INTRA_RADIUS_M fence. A third
         sub-spot abandons intra tracking for the day (the spots
         cannot be told apart); it never poisons the outer
         machine. */
  var INTRA_CLUSTER_M = 35;  // a sub-spot: fixes stay within this of its centroid
  var INTRA_SEP_M = 50;      // sub-spots must sit at least this far apart
  var INTRA_ACC_MAX_M = 30;  // only fixes this accurate may speak intra-site
  var INTRA_RADIUS_M = 30;   // the counter fence for an intra-site pair

  function createPatternLearner(cfg) {
    cfg = cfg || {};
    var HOME = (cfg.home && isCoord(cfg.home)) ? { lat: +cfg.home.lat, lng: +cfg.home.lng } : null;
    var SEED = (cfg.anchor && isCoord(cfg.anchor)) ? { lat: +cfg.anchor.lat, lng: +cfg.anchor.lng, t: +cfg.anchor.t || 0 } : null;
    var learnDwellMs = cfg.learnDwellMs || LEARN_DWELL_MS;
    var clusterM = cfg.clusterM || LEARN_CLUSTER_M;
    var accMaxM = cfg.accMaxM || ACC_MAX_M;
    var S = null;

    function isHome(lat, lng) {
      return !!HOME && haversineM(lat, lng, HOME.lat, HOME.lng) <= 250;
    }
    function placeOf(p) { return p ? { lat: +p.lat, lng: +p.lng, t: +p.t || 0 } : null; }

    /* The outer machine: anchor / candidate / proof. */
    function confirmPlace(place, res) {
      if (S.ambiguous) return;
      if (isHome(place.lat, place.lng)) return;
      if (!S.anchor) {
        S.anchor = place;
        S.lastPlace = 'anchor';
        res.anchor = place;
        return;
      }
      if (S.pair) return; // proven + locked at emission: nothing revisits it
      var dA = haversineM(place.lat, place.lng, S.anchor.lat, S.anchor.lng);
      if (dA <= CONTEST_SEP_M) {
        // back at the anchor: a return closes a cycle — if the
        // last confirmed place was the candidate, a full loaded
        // cycle (pit -> place -> pit) has completed.
        if (S.cand && S.lastPlace === 'cand') {
          S.cycles++;
          if (S.cycles >= 2) {
            S.pair = {
              load: S.anchor, dump: S.cand, t: place.t,
              credits: S.visits,
              events: S.visitTs.map(function (vt, i) { return { t: vt, site: 'dump', n: i + 1 }; })
            };
            S.locked = true;
            res.pair = S.pair;
            res.locked = true;
          }
        }
        S.lastPlace = 'anchor';
        return;
      }
      if (S.cand && haversineM(place.lat, place.lng, S.cand.lat, S.cand.lng) <= CONTEST_SEP_M) {
        // another visit to the candidate place
        if (S.lastPlace !== 'cand') { S.visits++; S.visitTs.push(place.t); }
        S.lastPlace = 'cand';
        return;
      }
      if (dA < LEARN_MIN_SEP_M) return; // too close to call a second site — no-man's land
      if (!S.cand) {
        S.cand = place;
        S.visits = 1;
        S.visitTs = [place.t];
        S.lastPlace = 'cand';
        res.candidate = place;
        return;
      }
      // a third distinct place before proof: the day cannot tell
      // its places apart — teach nothing (a mid-leg stop on the
      // way to the real dump lands exactly here).
      S.ambiguous = true;
      res.contested = { anchor: S.anchor, pair: { load: S.anchor, dump: S.cand, t: S.cand.t || 0 }, rival: place };
    }

    /* The intra-site machine: tight sub-spots inside the anchor's
       own area, same two-cycle proof. */
    function intraConfirm(place, res) {
      var I = S.intra;
      if (!I.a) { I.a = place; I.lastSub = 'a'; return; }
      if (haversineM(place.lat, place.lng, I.a.lat, I.a.lng) < INTRA_SEP_M) {
        if (I.b && I.lastSub === 'b') {
          I.cycles++;
          if (I.cycles >= 2) {
            S.pair = {
              load: I.a, dump: I.b, t: place.t, intra: true,
              credits: I.visits,
              events: I.visitTs.map(function (vt, i) { return { t: vt, site: 'dump', n: i + 1 }; })
            };
            S.locked = true;
            res.pair = S.pair;
            res.locked = true;
          }
        }
        I.lastSub = 'a';
        return;
      }
      if (!I.b) {
        I.b = place; I.visits = 1; I.visitTs = [place.t]; I.lastSub = 'b';
        return;
      }
      if (haversineM(place.lat, place.lng, I.b.lat, I.b.lng) < INTRA_SEP_M) {
        if (I.lastSub !== 'b') { I.visits++; I.visitTs.push(place.t); }
        I.lastSub = 'b';
        return;
      }
      I.dead = true; // a third sub-spot: this site's spots cannot be told apart
    }
    function intraFix(fix, res) {
      var I = S.intra;
      if (!I || I.dead || !S.anchor || S.cand || S.pair || S.ambiguous) return;
      var lat = +fix.latitude, lng = +fix.longitude;
      if (fix.accuracy === null || fix.accuracy === undefined || fix.accuracy > INTRA_ACC_MAX_M) { I.sub = null; return; }
      if (haversineM(lat, lng, S.anchor.lat, S.anchor.lng) > CONTEST_SEP_M) { I.sub = null; return; }
      var t = fix.time, sub = I.sub;
      if (!sub) {
        I.sub = { sumLat: lat, sumLng: lng, n: 1, since: t, confirmed: false };
        return;
      }
      if (haversineM(sub.sumLat / sub.n, sub.sumLng / sub.n, lat, lng) <= INTRA_CLUSTER_M) {
        sub.sumLat += lat; sub.sumLng += lng; sub.n++;
        if (!sub.confirmed && t - sub.since >= learnDwellMs) {
          sub.confirmed = true;
          intraConfirm({ lat: sub.sumLat / sub.n, lng: sub.sumLng / sub.n, t: t }, res);
        }
      } else {
        I.sub = { sumLat: lat, sumLng: lng, n: 1, since: t, confirmed: false };
      }
    }

    return {
      /* saved: a previous snapshot() from the same day. Anchor,
         candidate, proof progress, pair and verdicts carry over;
         half-built dwell clusters (outer and intra) are dropped,
         exactly as before — a relaunch can never invent a place,
         but it cannot erase a confirmed visit or a closed cycle
         either. */
      begin: function (saved) {
        S = {
          active: true, anchor: SEED, pair: null, locked: false,
          ambiguous: false, cluster: null, lastT: 0, lastLat: null, lastLng: null,
          cand: null, visits: 0, cycles: 0, lastPlace: SEED ? 'anchor' : null, visitTs: [],
          intra: { a: null, b: null, visits: 0, cycles: 0, lastSub: null, visitTs: [], dead: false, sub: null }
        };
        if (saved && typeof saved === 'object') {
          if (saved.anchor && isCoord(saved.anchor)) {
            S.anchor = placeOf(saved.anchor);
            if (S.lastPlace === null) S.lastPlace = 'anchor';
          }
          if (saved.cand && isCoord(saved.cand)) S.cand = placeOf(saved.cand);
          if (typeof saved.visits === 'number') S.visits = saved.visits;
          if (typeof saved.cycles === 'number') S.cycles = saved.cycles;
          if (saved.lastPlace === 'anchor' || saved.lastPlace === 'cand') S.lastPlace = saved.lastPlace;
          if (Array.isArray(saved.visitTs)) S.visitTs = saved.visitTs.slice();
          if (saved.intra && typeof saved.intra === 'object') {
            var si = saved.intra;
            if (si.a && isCoord(si.a)) S.intra.a = placeOf(si.a);
            if (si.b && isCoord(si.b)) S.intra.b = placeOf(si.b);
            if (typeof si.visits === 'number') S.intra.visits = si.visits;
            if (typeof si.cycles === 'number') S.intra.cycles = si.cycles;
            if (si.lastSub === 'a' || si.lastSub === 'b') S.intra.lastSub = si.lastSub;
            if (Array.isArray(si.visitTs)) S.intra.visitTs = si.visitTs.slice();
            S.intra.dead = !!si.dead;
          }
          if (saved.pair && saved.pair.load && saved.pair.dump && isCoord(saved.pair.load) && isCoord(saved.pair.dump)) {
            S.pair = {
              load: placeOf(saved.pair.load),
              dump: placeOf(saved.pair.dump),
              t: +saved.pair.t || 0,
              credits: saved.pair.credits || 0,
              intra: !!saved.pair.intra
            };
          }
          S.locked = !!saved.locked;
          S.ambiguous = !!saved.ambiguous;
          if (typeof saved.lastT === 'number') S.lastT = saved.lastT;
        }
        return true;
      },
      ingest: function (fix) {
        var res = { accepted: false };
        if (!S || !S.active) { res.why = 'inactive'; return res; }
        if (!fix || !isFinite(fix.latitude) || !isFinite(fix.longitude)) { res.why = 'bad-fix'; return res; }
        if (fix.accuracy !== null && fix.accuracy !== undefined && fix.accuracy > accMaxM) { res.why = 'accuracy'; return res; }
        var t = (typeof fix.time === 'number' && fix.time > 0) ? fix.time : 0;
        if (!t) { res.why = 'no-time'; return res; }
        if (S.lastT && t <= S.lastT) { res.why = 'stale'; return res; }
        if (S.lastLat !== null) {
          var dJump = haversineM(S.lastLat, S.lastLng, fix.latitude, fix.longitude);
          var dtH = (t - S.lastT) / 3600000;
          if (dtH > 0 && (dJump / 1000) / dtH > MAX_SPEED_KMH) { res.why = 'teleport'; return res; }
        }
        S.lastT = t; S.lastLat = +fix.latitude; S.lastLng = +fix.longitude;
        res.accepted = true;

        intraFix({ latitude: fix.latitude, longitude: fix.longitude, accuracy: (fix.accuracy === undefined ? null : fix.accuracy), time: t }, res);

        var cl = S.cluster;
        if (!cl) {
          S.cluster = { sumLat: +fix.latitude, sumLng: +fix.longitude, n: 1, since: t, confirmed: false };
        } else if (haversineM(cl.sumLat / cl.n, cl.sumLng / cl.n, +fix.latitude, +fix.longitude) <= clusterM) {
          cl.sumLat += +fix.latitude; cl.sumLng += +fix.longitude; cl.n++;
          if (!cl.confirmed && t - cl.since >= learnDwellMs) {
            cl.confirmed = true;
            confirmPlace({ lat: cl.sumLat / cl.n, lng: cl.sumLng / cl.n, t: t }, res);
          }
        } else {
          S.cluster = { sumLat: +fix.latitude, sumLng: +fix.longitude, n: 1, since: t, confirmed: false };
        }
        return res;
      },
      /* The caller proved the cycle through the counter (dumped,
         returned to the load fence): same lock the dump learner
         takes — later odd dwells can no longer contest. */
      lock: function () { if (S && S.pair && !S.ambiguous) S.locked = true; },
      stop: function () { if (S) S.active = false; },
      snapshot: function () {
        if (!S) return null;
        return {
          anchor: S.anchor ? placeOf(S.anchor) : null,
          cand: S.cand ? placeOf(S.cand) : null,
          visits: S.visits, cycles: S.cycles, lastPlace: S.lastPlace,
          visitTs: S.visitTs.slice(),
          intra: {
            a: S.intra.a ? placeOf(S.intra.a) : null,
            b: S.intra.b ? placeOf(S.intra.b) : null,
            visits: S.intra.visits, cycles: S.intra.cycles,
            lastSub: S.intra.lastSub, visitTs: S.intra.visitTs.slice(),
            dead: S.intra.dead
          },
          pair: S.pair ? {
            load: placeOf(S.pair.load),
            dump: placeOf(S.pair.dump),
            t: S.pair.t || 0,
            credits: S.pair.credits || 0,
            intra: !!S.pair.intra
          } : null,
          locked: S.locked, ambiguous: S.ambiguous, lastT: S.lastT
        };
      },
      pair: function () { return S ? S.pair : null; },
      isAmbiguous: function () { return !!(S && S.ambiguous); },
      isActive: function () { return !!(S && S.active); }
    };
  }

  var ENGINE = {
    haversineM: haversineM,
    isCoord: isCoord,
    sitesCheck: sitesCheck,
    looksLikeAddress: looksLikeAddress,
    createGeoLoadCounter: createGeoLoadCounter,
    createDumpLearner: createDumpLearner,
    createPatternLearner: createPatternLearner,
    RADIUS_M: RADIUS_M, DWELL_MS: DWELL_MS, DEPART_MS: DEPART_MS,
    ACC_MAX_M: ACC_MAX_M, MIN_SITE_SEP_M: MIN_SITE_SEP_M,
    LEARN_DWELL_MS: LEARN_DWELL_MS, LEARN_MIN_SEP_M: LEARN_MIN_SEP_M,
    LEARN_CLUSTER_M: LEARN_CLUSTER_M, CONTEST_SEP_M: CONTEST_SEP_M,
    INTRA_CLUSTER_M: INTRA_CLUSTER_M, INTRA_SEP_M: INTRA_SEP_M,
    INTRA_ACC_MAX_M: INTRA_ACC_MAX_M, INTRA_RADIUS_M: INTRA_RADIUS_M,
    CAND_GRACE_MS: CAND_GRACE_MS
  };
  /* GEOLOADS-ENGINE-END */

  /* ---------------- browser glue ----------------
     Store key 'geoloads' (mt_geoloads, synced via cloudsync):
       { days: { 'YYYY-MM-DD': { date, dispatchId, sessionKey,
                                 sites: { load: {lat,lng,label,src},
                                          dump: {lat,lng,label,src} } | null,
                                 blocked: null | 'no-dispatch' | 'no-site-coords'
                                          | 'one-site' | 'sites-too-close'
                                          | 'learning' | 'ambiguous-dump',
                                 count, events: [{t, site, n}],
                                 state: <counter snapshot>,
                                 learn: <learner snapshot>,
                                 learnedDump: { lat, lng, learnedAt,
                                                source: 'learned' } (v68),
                                 navDump: { lat, lng, t } (v140 — the
                                          dump adopted from the
                                          driver's own navigation
                                          today; see the v140 note),
                                 altDump: { lat, lng, t } (v68 — a rival
                                          candidate seen on a day whose
                                          dump site was already known;
                                          recorded, never applied),
                                 dumpContested: { taught, rival, t }
                                          (v68 — the teaching was
                                          retracted; day counts nothing
                                          learned),
                                 updatedAt } } }
     One record per date: a day's cycles belong to the day each dump
     event happened (event timestamps carry their own date). Records
     are pruned after 30 days.
     Store key 'geoload_pairs' (v68, synced): the learned load<->dump
     memory — { pairs: { '<loadKey>': { load: {lat,lng,label},
                                        dump: {lat,lng,label,learnedAt,
                                               source},
                                        updatedAt } } } — keyed by the
     load site's coordinates, matched by proximity (<= 250 m). */
  var STORE_KEY = 'geoloads';
  var PAIRS_KEY = 'geoload_pairs';
  var PERSIST_MIN_MS = 10000;
  var PRUNE_MS = 30 * 86400000;

  var counter = null;
  var watching = false;
  var sessionKey = null;
  var curDate = null;
  var curDispatchId = null;
  var curSites = null;       // { load: {...}, dump: {...} } once resolved
  var geocodeTried = {};     // dispatchId -> true (once per record per session)
  var lastPersist = 0;
  var subscribed = false;
  /* v68 learning state */
  var learner = null;            // ENGINE.createDumpLearner instance
  var learnMode = null;          // 'teach' | 'observe' | null
  var curLoad = null;            // today's load site (survives curSites resets)
  var taughtOutstanding = false; // taught today; first cycle not closed yet
  var navArmDone = false; // v140: the navigated counter's lazy arm (see onFix)
  var wasDumpSinceTeach = false; // counter confirmed the dump zone since then

  function store() {
    try { return (window.App && App._store) || null; } catch (e) { return null; }
  }
  function dateStrOf(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function loadAll() {
    var s = store();
    var d = s ? s.get(STORE_KEY, null) : null;
    if (!d || typeof d !== 'object' || !d.days) d = { days: {} };
    return d;
  }
  function recordFor(date) {
    if (!date) return null;
    var d = loadAll();
    return d.days[date] || null;
  }
  function writeDay(rec) {
    var s = store();
    if (!s || !rec || !rec.date) return;
    var d = loadAll();
    d.days[rec.date] = rec;
    var now = Date.now();
    Object.keys(d.days).forEach(function (k) {
      var r = d.days[k];
      if (!r || !r.updatedAt || now - r.updatedAt > PRUNE_MS) delete d.days[k];
    });
    try { s.set(STORE_KEY, d); } catch (e) {}
  }

  /* ----- v68: the learned load<->dump pair memory ----- */

  function loadPairs() {
    var s = store();
    var d = s ? s.get(PAIRS_KEY, null) : null;
    if (!d || typeof d !== 'object' || !d.pairs) d = { pairs: {} };
    return d;
  }
  function pairKeyFor(site) { return site.lat.toFixed(3) + ',' + site.lng.toFixed(3); }
  /* The remembered pair for this load site, if any: the stored pair
     whose load pin sits within 250 m of today's pin (one pit, one
     memory, even if the pin was dropped at the other end of it). */
  function findPair(loadSite) {
    if (!loadSite) return null;
    var d = loadPairs();
    var best = null, bestDist = 250;
    Object.keys(d.pairs).forEach(function (k) {
      var p = d.pairs[k];
      if (!p || !p.load || !p.dump || !ENGINE.isCoord(p.load) || !ENGINE.isCoord(p.dump)) return;
      var dist = ENGINE.haversineM(loadSite.lat, loadSite.lng, p.load.lat, p.load.lng);
      if (dist <= bestDist) { bestDist = dist; best = { key: k, pair: p }; }
    });
    return best;
  }
  function rememberPair(loadSite, dumpSite) {
    var s = store();
    if (!s || !loadSite || !dumpSite) return;
    var d = loadPairs();
    var found = findPair(loadSite);
    var key = found ? found.key : pairKeyFor(loadSite);
    d.pairs[key] = {
      load: { lat: loadSite.lat, lng: loadSite.lng, label: loadSite.label || '' },
      dump: {
        lat: dumpSite.lat, lng: dumpSite.lng, label: dumpSite.label || '',
        learnedAt: dumpSite.learnedAt || Date.now(), source: 'learned'
      },
      updatedAt: Date.now()
    };
    try { s.set(PAIRS_KEY, d); } catch (e) {}
  }
  /* Undo a pair written at teaching time when the SAME day contests
     it — memory keeps only teachings the day itself stood behind. */
  function forgetPair(loadSite, taughtDump) {
    var s = store();
    if (!s || !loadSite || !taughtDump) return;
    var found = findPair(loadSite);
    if (!found) return;
    if (ENGINE.haversineM(found.pair.dump.lat, found.pair.dump.lng, taughtDump.lat, taughtDump.lng) > 100) return;
    var d = loadPairs();
    delete d.pairs[found.key];
    try { s.set(PAIRS_KEY, d); } catch (e) {}
  }

  /* ----- v140: the places the app already knows -----
     Work favorites live in the store key 'nav_data' (the same
     substrate js/yardstart.js reads); the built-in pits come from
     the Navigation module's API. Until v140 this file never
     consulted either: on Oct 17 both of the day's sites were
     sitting in the owner's own favorites while the counter tried
     to re-derive the dump from driving alone. */

  function normName(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function knownPlaces() {
    var out = [];
    var s = store();
    if (s) {
      var nd = null;
      try { nd = s.get('nav_data', null); } catch (e) {}
      var work = (nd && nd.work) || [];
      for (var i = 0; i < work.length; i++) {
        var f = work[i];
        if (!f) continue;
        var c = { lat: parseFloat(f.lat), lng: parseFloat(f.lng) };
        if (ENGINE.isCoord(c)) out.push({ lat: c.lat, lng: c.lng, label: f.name || '', type: f.type || '', src: 'fav' });
      }
    }
    try {
      var nav = window.Meticulous && Meticulous.modules && Meticulous.modules.navigation;
      if (nav && typeof nav.builtinPlaces === 'function') {
        nav.builtinPlaces().forEach(function (p) {
          var c = { lat: parseFloat(p.lat), lng: parseFloat(p.lng) };
          if (ENGINE.isCoord(c)) out.push({ lat: c.lat, lng: c.lng, label: p.name || '', type: p.type || '', src: 'builtin' });
        });
      }
    } catch (e) {}
    return out;
  }
  /* v203: the saved Home place (nav_data, personal first then
     work — the manifest homePin / yardstart resolution). The
     pattern learner must never anchor on it: the session starts
     at home, and an at-home dwell is not a pit. */
  function homePlace() {
    var s = store();
    if (!s) return null;
    var nd = null;
    try { nd = s.get('nav_data', null); } catch (e) {}
    if (!nd) return null;
    var lists = [nd.personal || [], nd.work || []];
    for (var i = 0; i < lists.length; i++) {
      for (var j = 0; j < lists[i].length; j++) {
        var p = lists[i][j];
        if (p && String(p.name || '').trim().toLowerCase() === 'home') {
          var c = { lat: parseFloat(p.lat), lng: parseFloat(p.lng) };
          if (ENGINE.isCoord(c)) return c;
        }
      }
    }
    return null;
  }
  /* A dispatch whose pin never landed can still NAME its load
     site ("Go Empty To Maple Ridge"): match the name against the
     known places. Only a UNIQUE match resolves — two places
     answering to the name is a guess, and a fence is never
     placed on a guess. */
  function placeByName(text) {
    var q = normName(text);
    if (!q) return null;
    var exact = [], partial = [];
    knownPlaces().forEach(function (p) {
      var n = normName(p.label);
      if (!n) return;
      if (n === q) exact.push(p);
      else if (n.indexOf(q) >= 0 || q.indexOf(n) >= 0) partial.push(p);
    });
    var hit = exact.length ? exact : partial;
    if (hit.length !== 1) return null;
    return { lat: hit[0].lat, lng: hit[0].lng, label: hit[0].label || String(text || ''), src: 'places' };
  }

  /* ----- v140: the navigated hand-off -----
     When the driver taps Navigate to a work place, the
     Navigation module records it in nav_data.recent AT THE TAP —
     before he drives. A work place he navigated to TODAY, while
     a load site is known and no dump is resolved, that forms a
     valid pair with the load site IS the day's dump signal: he
     is driving there loaded, on purpose. Adopting it arms the
     counter before he arrives, so even a short tip counts — no
     teaching dwell needed. The pair is remembered only once a
     cycle is proven there (see persist). */
  function sessionStartMs() {
    var ms = parseInt(String(sessionKey || '').slice(1), 10);
    return isFinite(ms) ? ms : 0;
  }
  function navigatedDumpCandidate() {
    if (!curLoad || !curDate) return null;
    var s = store();
    if (!s) return null;
    var nd = null;
    try { nd = s.get('nav_data', null); } catch (e) {}
    if (!nd || !nd.recent || !nd.recent.length) return null;
    var startMs = sessionStartMs();
    var best = null;
    for (var i = 0; i < nd.recent.length; i++) {
      var r = nd.recent[i];
      if (!r || r.kind !== 'work' || !r.ts) continue;
      var c = { lat: parseFloat(r.lat), lng: parseFloat(r.lng) };
      if (!ENGINE.isCoord(c)) continue;
      if (dateStrOf(r.ts) !== curDate) continue;                 // today only — recents outlive the day
      if (startMs && r.ts < startMs - 2 * 3600000) continue;     // not hours before this session
      if (!ENGINE.sitesCheck(curLoad, c).ok) continue;           // must pair with the load site
      if (!best || r.ts > best.t) best = { lat: c.lat, lng: c.lng, label: r.name || 'Dump site', t: r.ts };
    }
    return best;
  }
  function adoptNavigatedDump(cand) {
    var dump = { lat: cand.lat, lng: cand.lng, label: cand.label || 'Dump site', src: 'navigated' };
    curSites = { load: curLoad, dump: dump };
    var key = sitesKeyFor(curDispatchId, curLoad, dump);
    counter = ENGINE.createGeoLoadCounter({ load: curLoad, dump: dump });
    /* If the learner already watched the load visit AND the
       departure, the truck is mid-loaded-leg right now: seed the
       counter armed, or the first load of the day — the one he
       is carrying — would be the one load it cannot count. (He
       navigates when he LEAVES the pit, loaded; adoption on
       that leg is the common case, not an edge.) */
    var seed = null;
    var prevLearnSnap = learner ? learner.snapshot() : null;
    if (prevLearnSnap && prevLearnSnap.legArmed) {
      seed = { sitesKey: key, zone: 'out', phase: 'to-dump', armed: true, count: 0, events: [], lastT: prevLearnSnap.lastT || 0 };
    }
    counter.begin(key, seed);
    navArmDone = !!seed;
    learnMode = 'observe';
    /* The observe learner INHERITS the teach learner's leg state
       (it watched the load visit too) — a fresh begin would
       forget the very leg the counter was just seeded from. */
    learner = ENGINE.createDumpLearner({ load: curLoad, dump: dump });
    learner.begin(prevLearnSnap);
    taughtOutstanding = false; wasDumpSinceTeach = false;
    var rec = recordFor(curDate) || blankDay(curDate);
    rec.dispatchId = curDispatchId; rec.sessionKey = sessionKey;
    rec.sites = curSites; rec.blocked = null; rec.updatedAt = Date.now();
    rec.navDump = { lat: dump.lat, lng: dump.lng, t: cand.t || Date.now() };
    if (learner) rec.learn = learner.snapshot();
    writeDay(rec);
    persist(true);
    return true;
  }
  /* Adoption is only ever a TEACH-mode event: a dump already
     resolved (pin, remembered pair, taught) is never overridden
     by a navigation. */
  function maybeAdoptNavigatedDump() {
    if (counter || learnMode !== 'teach' || !curLoad) return false;
    var cand = navigatedDumpCandidate();
    if (!cand) return false;
    return adoptNavigatedDump(cand);
  }

  function sitesKeyFor(id, load, dump) {
    return 'g' + id + '@' + load.lat.toFixed(5) + ',' + load.lng.toFixed(5) +
           '>' + dump.lat.toFixed(5) + ',' + dump.lng.toFixed(5);
  }

  /* ----- site resolution from the active dispatch ----- */

  function siteFromPin(lat, lng, label, src) {
    var c = { lat: parseFloat(lat), lng: parseFloat(lng) };
    if (!ENGINE.isCoord(c)) return null;
    return { lat: c.lat, lng: c.lng, label: label || '', src: src || 'pin' };
  }
  function activeDispatch() {
    var s = store();
    if (!s) return null;
    var a = s.get('dsp_active', null);
    return (a && a.id) ? a : null;
  }
  /* Load site: the dispatch pin. Dump site: stored dump pin, else the
     drop-off address (geocoded once, async — see maybeGeocode). */
  function sitesFromDispatch(d) {
    if (!d) return { load: null, dump: null };
    var load = siteFromPin(d.lat, d.lng, d.jobSite || d.pickup || 'Load site', 'pin');
    var dump = siteFromPin(d.dumpLat, d.dumpLng, d.dropoff || 'Dump site', 'pin');
    return { load: load, dump: dump };
  }
  function blockedWhy(d, sites) {
    if (!d) return 'no-dispatch';
    if (!sites.load && !sites.dump) return 'no-site-coords';
    if (!sites.load || !sites.dump) return 'one-site';
    var chk = ENGINE.sitesCheck(sites.load, sites.dump);
    if (!chk.ok && chk.why === 'too-close') return 'sites-too-close';
    return null;
  }

  /* Persist geocoded coordinates back onto the dispatch record (in
     dsp_active, and in dsp_list where the same id lives) so the
     lookup happens once and the coords sync like everything else. */
  function persistDispatchCoords(id, patch) {
    var s = store();
    if (!s || !id) return;
    try {
      var a = s.get('dsp_active', null);
      if (a && a.id === id) {
        for (var k in patch) a[k] = patch[k];
        s.set('dsp_active', a);
      }
      var l = s.get('dsp_list', []);
      var changed = false;
      for (var i = 0; i < l.length; i++) {
        if (l[i] && l[i].id === id) {
          for (var k2 in patch) l[i][k2] = patch[k2];
          changed = true;
        }
      }
      if (changed) s.set('dsp_list', l);
    } catch (e) {}
  }

  /* One free geocode attempt per missing site per dispatch: the pin
     covers the load site; the drop-off TEXT is the only dump source
     the record carries today. Names that are not street addresses
     are never sent (a city-level match would misplace the fence). */
  function maybeGeocode(d, sites) {
    if (!d || !d.id || geocodeTried[d.id]) return;
    var g = null;
    try { g = (window.App && App.geo) || window.MeticulousGeo || null; } catch (e) {}
    if (!g || typeof g.geocode !== 'function') return;
    var jobs = [];
    if (!sites.load) {
      var lt = d.pickup || d.jobSite || '';
      if (ENGINE.looksLikeAddress(lt)) jobs.push({ q: lt, kind: 'load' });
    }
    if (!sites.dump) {
      var dt = d.dropoff || '';
      if (ENGINE.looksLikeAddress(dt)) jobs.push({ q: dt, kind: 'dump' });
    }
    if (!jobs.length) return;
    geocodeTried[d.id] = true;
    jobs.forEach(function (job) {
      g.geocode(job.q).then(function (hit) {
        if (!hit) return;
        var patch = {};
        if (job.kind === 'load') { patch.lat = hit.latitude; patch.lng = hit.longitude; }
        else { patch.dumpLat = hit.latitude; patch.dumpLng = hit.longitude; }
        persistDispatchCoords(d.id, patch);
        // If this session is still on the same dispatch, re-resolve —
        // counting starts from the NEXT confirmed load-site visit.
        if (watching && curDispatchId === d.id) configure();
      }).catch(function () {});
    });
  }

  /* ----- day record ----- */

  function blankDay(date) {
    return {
      date: date, dispatchId: curDispatchId, sessionKey: sessionKey,
      sites: curSites, blocked: null, count: 0, events: [],
      state: null, updatedAt: Date.now()
    };
  }
  /* A day can hold more than one session/dispatch (a morning shift
     and an evening shift; a completed dispatch replaced by a new one).
     The live counter only ever holds ITS session's cycles, so counts
     from earlier sessions today are carried as a base — a new counter
     must never erase loads already counted today. */
  var baseCount = 0;
  var baseEvents = [];
  /* v220 (owner, Oct 22, 2026 — LOADS-CORRECTION-BUTTONS): the
     driver's signed correction to the MACHINE count, carried on
     the day record as `corr`, apart from the raw machine count —
     persist() never folds it into rec.count, so it can never
     double-apply across a restart: today()/forDate() always read
     max(0, machine + corr). The hero's big −1 / +1 buttons move
     it (js/app.js); while no site pair is armed the taps keep
     their older fallback role (the session's manualLoads). */
  var corrNow = 0;

  function persist(force) {
    if (!curDate) return;
    var now = Date.now();
    if (!force && now - lastPersist < PERSIST_MIN_MS) return;
    lastPersist = now;
    var rec = recordFor(curDate) || blankDay(curDate);
    rec.dispatchId = curDispatchId;
    rec.sessionKey = sessionKey;
    rec.sites = curSites;
    rec.corr = corrNow;
    rec.updatedAt = now;
    if (counter) {
      rec.count = baseCount + counter.count();
      rec.events = baseEvents.concat(counter.events());
      rec.state = counter.snapshot();
      rec.blocked = null;
      /* v140: a navigated dump earns its pair memory only once a
         cycle is PROVEN there (a counted dump arrival) — the
         same standard teaching is held to, never at adoption. */
      if (curSites && curSites.dump && curSites.dump.src === 'navigated' && counter.count() > 0 && curLoad) {
        var havePair = findPair(curLoad);
        if (!havePair || ENGINE.haversineM(havePair.pair.dump.lat, havePair.pair.dump.lng, curSites.dump.lat, curSites.dump.lng) > 100) {
          rememberPair(curLoad, { lat: curSites.dump.lat, lng: curSites.dump.lng, label: curSites.dump.label || '', learnedAt: Date.now() });
        }
      }
    }
    if (learner) {
      /* v203: the pattern learner's state rides its own field —
         its snapshot shape is not the dump learner's. */
      if (learnMode === 'pattern') rec.pattern = learner.snapshot();
      else rec.learn = learner.snapshot();
    }
    writeDay(rec);
  }

  /* (Re)build the counter from the active dispatch's sites. Called on
     session start and again if a geocode lands mid-shift. */
  function configure() {
    var d = activeDispatch();
    curDispatchId = d ? d.id : null;
    learner = null; learnMode = null; curLoad = null;
    taughtOutstanding = false; wasDumpSinceTeach = false;
    if (!d) { counter = null; curSites = null; return false; }
    var sites = sitesFromDispatch(d);
    /* v140: no pin on the record is not the end — the dispatch
       still NAMES its site, and the app already knows its places.
       A unique name match supplies the load fence. */
    if (!sites.load) {
      var named = placeByName(d.jobSite) || placeByName(d.pickup);
      if (named) sites.load = named;
    }
    curLoad = sites.load || null;
    var why = blockedWhy(d, sites);

    /* v68: a load pin with NO dump pin is the normal dump-work case —
       the dump location is given verbally on site and never written
       on the dispatch. The dump site then comes from today's own
       teaching, from the remembered pairs, or from learning — never
       from asking the user for data he does not have. */
    if (why === 'one-site' && sites.load && !sites.dump) {
      var prevDay = recordFor(curDate);
      if (prevDay && prevDay.blocked === 'ambiguous-dump') {
        // This day already proved it cannot tell its dump places
        // apart — it teaches nothing more, whichever session asks.
        counter = null; curSites = null;
        return false;
      }
      var resolvedDump = null;
      // (1) taught earlier today (say, before an app relaunch)
      if (prevDay && prevDay.learnedDump && ENGINE.isCoord(prevDay.learnedDump) &&
          prevDay.sites && prevDay.sites.load &&
          ENGINE.haversineM(prevDay.sites.load.lat, prevDay.sites.load.lng, sites.load.lat, sites.load.lng) <= 250 &&
          ENGINE.sitesCheck(sites.load, prevDay.learnedDump).ok) {
        resolvedDump = { lat: +prevDay.learnedDump.lat, lng: +prevDay.learnedDump.lng, label: 'Dump site', src: 'learned' };
      }
      // (2) remembered pair from an earlier day at this load site
      if (!resolvedDump) {
        var found = findPair(sites.load);
        if (found) {
          var pc = { lat: +found.pair.dump.lat, lng: +found.pair.dump.lng };
          if (ENGINE.isCoord(pc) && ENGINE.sitesCheck(sites.load, pc).ok) {
            resolvedDump = { lat: pc.lat, lng: pc.lng, label: found.pair.dump.label || 'Dump site', src: 'remembered' };
          }
        }
      }
      if (resolvedDump) { sites.dump = resolvedDump; why = null; learnMode = 'observe'; }
      else learnMode = 'teach';
    }

    if (why) {
      counter = null;
      /* v203 (LOADS-GPS-FIX): the dispatch is REAL but carries no
         anchor at all — no pin, and its text names no place the
         app knows (a boss's message: customer + project, not a
         pit name). Until now the day went blind here ('no-site-
         coords', no learner, zero counts while the truck ran
         clean cycles — Oct 21, 2026: 13 loads tapped by hand).
         Now the PATTERN learner watches the driving itself: the
         day's own dwell clusters are the two sites (see the
         engine). A day already proven ambiguous stays unteachable. */
      /* v220 (LOADS-TIGHT-GEOFENCE): 'sites-too-close' — the
         dispatch's own pins name ONE place for load and dump (the
         standard on-site job) — joins the pattern path too, with
         the learner SEEDED on the known place as its anchor: the
         day is no longer blind; the learner reads the tip pattern
         INSIDE the one place (tight sub-spots, two proven cycles)
         or an outer candidate if the truck really runs to a
         second site. */
      if ((why === 'no-site-coords' || why === 'sites-too-close') && !(recordFor(curDate) && recordFor(curDate).blocked === 'ambiguous-dump')) {
        learnMode = 'pattern';
        curSites = null;
        learner = ENGINE.createPatternLearner({
          home: homePlace(),
          anchor: (why === 'sites-too-close' && sites.load) ? { lat: sites.load.lat, lng: sites.load.lng } : null
        });
        var prevN = recordFor(curDate);
        var sameN = !!(prevN && prevN.sessionKey === sessionKey);
        baseCount = (!sameN && prevN) ? (prevN.count || 0) : 0;
        baseEvents = (!sameN && prevN && prevN.events) ? prevN.events.slice() : [];
        corrNow = prevN ? (prevN.corr || 0) : 0; // v220
        /* a pair taught earlier today arms the counter again at
           once — its count rides the base. The teaching wrote it
           on the day record (patternPair) precisely so a NEW
           session finds it; within the same session the
           learner's own snapshot carries it. */
        var restoredPair = null;
        if (prevN && prevN.patternPair && prevN.patternPair.load && prevN.patternPair.dump) {
          restoredPair = { load: prevN.patternPair.load, dump: prevN.patternPair.dump, t: prevN.patternPair.t || 0, intra: !!prevN.patternPair.intra };
        } else if (sameN && prevN.pattern && prevN.pattern.pair) {
          restoredPair = prevN.pattern.pair;
        }
        if (restoredPair) {
          learner.begin({ anchor: restoredPair.load, pair: restoredPair });
          armPatternPair(restoredPair, false);
          return true;
        }
        learner.begin(sameN ? prevN.pattern : null);
        var recN = prevN || blankDay(curDate);
        recN.dispatchId = d.id; recN.sessionKey = sessionKey;
        recN.sites = null; recN.blocked = 'learning'; recN.updatedAt = Date.now();
        recN.pattern = learner.snapshot();
        writeDay(recN);
        maybeGeocode(d, sites);
        return false;
      }
      if (learnMode === 'teach') {
        /* No counter yet — but the learner watches the driving from
           the first fix, and the day record honestly says counting
           is still learning rather than failed. */
        curSites = null;
        learner = ENGINE.createDumpLearner({ load: sites.load, dump: null });
        var prevT = recordFor(curDate);
        var sameT = !!(prevT && prevT.sessionKey === sessionKey);
        learner.begin(sameT ? prevT.learn : null);
        baseCount = (!sameT && prevT) ? (prevT.count || 0) : 0;
        baseEvents = (!sameT && prevT && prevT.events) ? prevT.events.slice() : [];
        corrNow = prevT ? (prevT.corr || 0) : 0; // v220
        /* v140: he may ALREADY have navigated to today's dump
           (the tap is recorded before the drive) — adopt it now
           and the day counts from the first load, no teaching. */
        if (maybeAdoptNavigatedDump()) return true;
        var recT = prevT || blankDay(curDate);
        recT.dispatchId = d.id; recT.sessionKey = sessionKey;
        recT.sites = null; recT.blocked = 'learning'; recT.updatedAt = Date.now();
        recT.learn = learner.snapshot();
        // an earlier session's count for the day stays untouched —
        // counted loads are never erased by a reconfigure
        writeDay(recT);
        maybeGeocode(d, sites);
        return false;
      }
      curSites = null;
      var rec = recordFor(curDate) || blankDay(curDate);
      rec.dispatchId = d.id; rec.sessionKey = sessionKey;
      rec.sites = null; rec.blocked = why; rec.updatedAt = Date.now();
      // an earlier session's count for the day stays untouched here —
      // counted loads are never erased by a reconfigure
      writeDay(rec);
      maybeGeocode(d, sites);
      return false;
    }
    curSites = sites;
    var key = sitesKeyFor(d.id, sites.load, sites.dump);
    var prev = recordFor(curDate);
    var sameSession = !!(prev && prev.sessionKey === sessionKey);
    var saved = (sameSession && prev.state) ? prev.state : null;
    /* v220: the day count = the restored counter's own count +
       whatever part of the record's count is NOT inside it. The
       old same-session zeroing lost the carried part: a session
       whose count included an earlier session's base read 0
       after a relaunch (record 3, snapshot 0, base zeroed). */
    var savedCount = (saved && typeof saved.count === 'number') ? saved.count : 0;
    baseCount = prev ? Math.max(0, (prev.count || 0) - savedCount) : 0;
    baseEvents = (!sameSession && prev && prev.events) ? prev.events.slice() : [];
    corrNow = prev ? (prev.corr || 0) : 0; // v220: the day's correction survives restarts
    counter = ENGINE.createGeoLoadCounter({ load: sites.load, dump: sites.dump });
    counter.begin(key, saved);
    if (learnMode === 'observe') {
      // Counting is armed from memory; the learner only watches for
      // a rival candidate to note on the day — never to apply.
      learner = ENGINE.createDumpLearner({ load: sites.load, dump: sites.dump });
      learner.begin(sameSession ? prev.learn : null);
    }
    persist(true);
    return true;
  }

  /* The learner's first full load->dump trip taught the dump site:
     arm the counter with it and credit the teaching cycle as load
     #1 — the truck demonstrably picked up at the load site, left,
     and then sat at the dump place for minutes. The pair is written
     to memory now (and retracted again if the day contests it). */
  function onLearned(cand) {
    if (!curLoad || !cand) return;
    var dump = { lat: cand.lat, lng: cand.lng, label: 'Dump site', src: 'learned' };
    curSites = { load: curLoad, dump: dump };
    var taught = { lat: cand.lat, lng: cand.lng, learnedAt: cand.t, source: 'learned' };
    /* v220 (LOADS-TIGHT-GEOFENCE): the pair MEMORY is NOT written
       here. A first dwell — even a long one — is not proof: a
       mid-leg stop (arrive loaded, leave loaded) dwells exactly
       like a tip. The teaching arms the counter for TODAY only;
       rememberPair waits until the truck closes the full cycle
       back at the load site (the lock in feedFix). */
    var key = sitesKeyFor(curDispatchId, curLoad, dump);
    counter = ENGINE.createGeoLoadCounter({ load: curLoad, dump: dump });
    counter.begin(key, {
      sitesKey: key, zone: 'dump', phase: 'at-dump', armed: false,
      count: 1, events: [{ t: cand.t, site: 'dump', n: 1 }], lastT: cand.t
    });
    taughtOutstanding = true;
    wasDumpSinceTeach = true;
    var rec = recordFor(curDate) || blankDay(curDate);
    rec.dispatchId = curDispatchId; rec.sessionKey = sessionKey;
    rec.sites = curSites; rec.blocked = null; rec.updatedAt = Date.now();
    rec.learnedDump = taught;
    if (learner) rec.learn = learner.snapshot();
    writeDay(rec);
    persist(true);
  }

  /* v203: the pattern learner read the day's pair out of the
     driving (or restored it from this morning's teaching on a
     new session). Arm the counter on it. A FRESH teaching
     credits the cycle that taught it as load #1 and remembers
     the pair (keyed by the load site, like every learned pair);
     a RESTORED pair credits nothing again — the day's earlier
     count rides baseCount. The pattern learner stays alive
     after arming: until the cycle closes back at the anchor,
     a third place can still contest the teaching. */
  function armPatternPair(pair, credit) {
    var load = { lat: +pair.load.lat, lng: +pair.load.lng, label: 'Load site', src: 'pattern' };
    var dump = { lat: +pair.dump.lat, lng: +pair.dump.lng, label: 'Dump site', src: 'pattern' };
    curLoad = load;
    curSites = { load: load, dump: dump };
    /* v220: a fresh pattern pair arrives PROVEN (two completed
       cycles — see the learner). It is remembered at once (an
       intra-site pair is the exception: sub-spot coordinates
       would collide with the site-level pair memory's 250 m
       matching, so intra pairs live on the day record only).
       The counter seeds at the anchor with BOTH proven cycles
       credited — the truck is standing at the load spot as the
       second cycle closes. Nothing is "outstanding": the pair
       was locked by the learner at emission. */
    if (credit && !pair.intra) {
      rememberPair(load, { lat: dump.lat, lng: dump.lng, label: '', learnedAt: Date.now() });
    }
    var key = sitesKeyFor(curDispatchId, load, dump);
    counter = ENGINE.createGeoLoadCounter({
      load: load, dump: dump,
      radiusM: pair.intra ? ENGINE.INTRA_RADIUS_M : undefined
    });
    if (credit) {
      var credits = pair.credits || 1;
      var evts = (pair.events && pair.events.length) ? pair.events
        : [{ t: pair.t || Date.now(), site: 'dump', n: 1 }];
      counter.begin(key, {
        sitesKey: key, zone: 'load', phase: 'at-load', armed: true,
        count: credits, events: evts, lastT: pair.t || 0
      });
      taughtOutstanding = false;
      wasDumpSinceTeach = false;
    } else {
      counter.begin(key, null);
    }
    var rec = recordFor(curDate) || blankDay(curDate);
    rec.dispatchId = curDispatchId; rec.sessionKey = sessionKey;
    rec.sites = curSites; rec.blocked = null; rec.updatedAt = Date.now();
    if (credit) rec.patternPair = { load: { lat: load.lat, lng: load.lng }, dump: { lat: dump.lat, lng: dump.lng }, t: pair.t || Date.now(), intra: !!pair.intra };
    if (learner) rec.pattern = learner.snapshot();
    writeDay(rec);
    persist(true);
    return true;
  }
  function onPatternPair(pair) { return armPatternPair(pair, true); }

  /* v203: a third place contested the pattern pair before the
     first cycle closed — retract in full, the onContested
     discipline: counter stopped, taught count and pair memory
     withdrawn, the day marked ambiguous and left unteachable. */
  function onPatternContested(info) {
    if (info && info.pair) forgetPair(info.pair.load, info.pair.dump);
    if (counter) counter.stop();
    counter = null;
    taughtOutstanding = false; wasDumpSinceTeach = false;
    learnMode = null;
    curSites = null;
    curLoad = null;
    if (learner) learner.stop();
    var rec = recordFor(curDate) || blankDay(curDate);
    rec.dispatchId = curDispatchId; rec.sessionKey = sessionKey;
    rec.sites = null; rec.blocked = 'ambiguous-dump'; rec.updatedAt = Date.now();
    rec.count = baseCount;
    rec.events = baseEvents.slice();
    rec.state = null;
    delete rec.patternPair;
    rec.dumpContested = {
      taught: (info && info.pair && info.pair.dump) ? { lat: info.pair.dump.lat, lng: info.pair.dump.lng, t: info.pair.t || 0 } : null,
      rival: (info && info.rival) ? { lat: info.rival.lat, lng: info.rival.lng, t: info.rival.t || 0 } : null,
      t: (info && info.rival && info.rival.t) || Date.now()
    };
    if (learner) rec.pattern = learner.snapshot();
    writeDay(rec);
  }

  /* Two different places both looked like the dump before the first
     cycle completed — the day cannot tell them apart, so the
     teaching is retracted in full: no learned site, no learned
     count (any non-learned count from an earlier session stands),
     and the pair written at teaching time is forgotten. */
  function onContested(info) {
    if (curLoad && info && info.taught) forgetPair(curLoad, info.taught);
    if (counter) counter.stop();
    counter = null;
    taughtOutstanding = false; wasDumpSinceTeach = false;
    learnMode = null;
    curSites = null;
    var rec = recordFor(curDate) || blankDay(curDate);
    rec.dispatchId = curDispatchId; rec.sessionKey = sessionKey;
    rec.sites = null; rec.blocked = 'ambiguous-dump'; rec.updatedAt = Date.now();
    rec.count = baseCount;
    rec.events = baseEvents.slice();
    rec.state = null;
    delete rec.learnedDump;
    rec.dumpContested = {
      taught: (info && info.taught) ? { lat: info.taught.lat, lng: info.taught.lng, t: info.taught.t } : null,
      rival: (info && info.rival) ? { lat: info.rival.lat, lng: info.rival.lng, t: info.rival.t } : null,
      t: (info && info.rival && info.rival.t) || Date.now()
    };
    if (learner) rec.learn = learner.snapshot();
    writeDay(rec);
  }

  /* A different place looked like a dump stop on a day whose dump
     site is already known (pin or remembered pair). It is recorded
     on the day — the Manifest can mention it — but the known site
     and the pair memory are never changed by driving alone. */
  function onAltCandidate(cand) {
    if (!cand) return;
    var rec = recordFor(curDate) || blankDay(curDate);
    if (rec.altDump) return;
    rec.altDump = { lat: cand.lat, lng: cand.lng, t: cand.t };
    rec.updatedAt = Date.now();
    writeDay(rec);
  }

  /* Feed one fix to whatever is running — the counter (when a site
     pair is armed) and/or the learner (while it watches) — and act
     on the learner's verdicts. Returns the counter's ingest result
     when there is a counter, else the learner's. */
  function feedFix(fix) {
    var r = null;
    if (counter) {
      r = counter.ingest(fix);
      if (r.accepted && taughtOutstanding && learner) {
        if (counter.zone() === 'dump') wasDumpSinceTeach = true;
        else if (wasDumpSinceTeach && counter.zone() === 'load') {
          // dumped, and now confirmed back at the load site: the
          // first cycle is complete — the teaching is proven.
          learner.lock();
          taughtOutstanding = false;
          wasDumpSinceTeach = false;
          /* v220: only NOW is a taught dump written to the pair
             memory (onLearned deliberately withheld it) — the
             full loaded cycle (pit -> place -> pit) completed,
             so the place earned the memory. */
          if (curLoad && curSites && curSites.dump && curSites.dump.src === 'learned') {
            var lrec = recordFor(curDate);
            rememberPair(curLoad, {
              lat: curSites.dump.lat, lng: curSites.dump.lng, label: '',
              learnedAt: (lrec && lrec.learnedDump && lrec.learnedDump.learnedAt) || Date.now()
            });
          }
        }
      }
    }
    if (learner) {
      var lr = learner.ingest(fix);
      if (lr && learnMode === 'pattern' && lr.pair) onPatternPair(lr.pair);
      else if (lr && learnMode === 'pattern' && lr.contested) onPatternContested(lr.contested);
      else if (lr && lr.learned) onLearned(lr.learned);
      else if (lr && lr.contested) onContested(lr.contested);
      else if (lr && lr.altCandidate) onAltCandidate(lr.altCandidate);
      if (!r) r = lr;
    }
    return r;
  }

  function onFix(fix) {
    if (!watching || (!counter && !learner)) return null;
    /* v140: while the day is still in teach mode, watch for the
       navigated hand-off (throttled — the recents log changes
       rarely): he taps Navigate at the pit, loaded, and the
       counter must be armed before he reaches the dump. */
    if (!counter && learner && learnMode === 'teach') {
      var ft = (fix && typeof fix.time === 'number') ? fix.time : Date.now();
      if (!onFix._navT || ft - onFix._navT > 15000) {
        onFix._navT = ft;
        maybeAdoptNavigatedDump();
      }
    }
    var r = feedFix(fix);
    /* v140: adoption can land in the window between the truck
       leaving the load fence and the learner confirming the
       departure (45 s) — too early to know the leg was loaded.
       So the arm is re-checked here, lazily: the first time the
       learner's leg stands confirmed while the navigated
       counter is still untouched (never armed, no zone of its
       own), the counter is re-seeded armed with its own
       snapshot — the load he is carrying counts. */
    if (counter && !navArmDone && curSites && curSites.dump && curSites.dump.src === 'navigated') {
      var csA = counter.snapshot();
      if (csA && (csA.armed || csA.count > 0 || csA.phase !== 'away')) {
        navArmDone = true;
      } else if (csA && csA.zone === 'out' && learner) {
        var lsA = learner.snapshot();
        if (lsA && lsA.legArmed) {
          csA.armed = true; csA.phase = 'to-dump';
          counter.begin(csA.sitesKey, csA);
          navArmDone = true;
        }
      }
    }
    // A dump event belongs to the date it happened on (overnight
    // shifts): if midnight passed, roll the day record forward.
    var fd = dateStrOf(fix.time || Date.now());
    if (fd !== curDate) {
      persist(true);
      curDate = fd;
      configure();
      if (counter || learner) r = feedFix(fix);
    }
    if (r && r.counted) persist(true); else persist(false);
    return r;
  }

  function subscribe() {
    if (subscribed) return;
    try {
      if (window.LiveMiles && typeof LiveMiles.subscribe === 'function') {
        LiveMiles.subscribe(onFix);
        subscribed = true;
      }
    } catch (e) {}
  }

  var GeoLoads = {
    _engine: ENGINE,

    /* Begin (or reattach) counting for a tracker session. Rides the
       LiveMiles fix stream — with no live location there is no
       stream, the counter stays inert and nothing is displayed.
       Returns true when a countable site pair is armed. */
    startDay: function (key, opts) {
      subscribe();
      var lm = null;
      try { lm = window.LiveMiles || null; } catch (e) {}
      if (!lm || !lm.available || !lm.available()) return false; // inert — no watcher, no data
      if (watching && sessionKey === key) { return !!counter; }
      sessionKey = key;
      curDate = dateStrOf(parseInt(String(key).slice(1), 10) || Date.now());
      watching = true;
      return configure();
    },

    stopDay: function () {
      if (sessionKey) persist(true);
      if (counter) counter.stop();
      if (learner) learner.stop();
      watching = false;
      sessionKey = null;
      counter = null;
      learner = null;
      learnMode = null;
      curSites = null;
      curLoad = null;
      taughtOutstanding = false;
      wasDumpSinceTeach = false;
      navArmDone = false;
      baseCount = 0;
      baseEvents = [];
      corrNow = 0;
    },

    flush: function () { if (sessionKey) persist(true); },

    /* v63 (native v34): feed NATIVE-SERVICE breadcrumbs (recorded
       while the app was backgrounded or dead) through the very same
       fix path as live fixes — same dwell/depart rules, same midnight
       roll-over. The counter ignores fixes at or before the last one
       it saw, so crumbs that overlap the live stream can never
       double-count a cycle. Returns how many fixes were accepted. */
    ingestNativeCrumbs: function (crumbs) {
      if (!watching || (!counter && !learner) || !crumbs || !crumbs.length) return 0;
      var list = crumbs.slice().sort(function (x, y) { return (+x.t || 0) - (+y.t || 0); });
      var n = 0;
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (!c || !isFinite(+c.t)) continue;
        var r = onFix({
          latitude: +c.a, longitude: +c.o,
          accuracy: (c.c === null || c.c === undefined || +c.c < 0) ? null : +c.c,
          time: +c.t
        });
        if (r && r.accepted) n++;
      }
      if (sessionKey) persist(true);
      return n;
    },

    /* The day's record for the Manifest: { count, events, sites,
       blocked } or null when counting never ran that day. */
    forDate: function (date) {
      var rec = recordFor(date);
      if (!rec) return null;
      return {
        count: Math.max(0, (rec.count || 0) + (rec.corr || 0)), // v220: the driver's correction rides the day's count
        corr: rec.corr || 0,
        events: rec.events || [],
        sites: rec.sites || null,
        blocked: rec.blocked || null,
        dispatchId: rec.dispatchId || null,
        learnedDump: rec.learnedDump || null,
        altDump: rec.altDump || null,
        dumpContested: rec.dumpContested || null,
        navDump: rec.navDump || null
      };
    },

    /* v140: the dashboard's read of today — the machine count and
       whether a site pair is actually fenced (armed). While a
       session is watching, live state wins; otherwise the
       persisted day record speaks. armed=false means counting
       has no pair yet (still learning, or never ran): the caller
       falls back to the driver's corrections, honestly. */
    today: function () {
      var date = dateStrOf(Date.now());
      var rec = recordFor(date);
      var out = {
        date: date,
        count: rec ? Math.max(0, (rec.count || 0) + (rec.corr || 0)) : 0,
        corr: rec ? (rec.corr || 0) : 0,
        blocked: rec ? (rec.blocked || null) : null,
        sites: rec ? (rec.sites || null) : null,
        armed: !!(rec && rec.sites)
      };
      if (watching && curDate === date) {
        out.armed = !!counter;
        if (counter) {
          out.count = Math.max(0, baseCount + counter.count() + corrNow);
          out.corr = corrNow;
          out.sites = curSites || out.sites;
          out.blocked = null;
        }
      }
      return out;
    },

    /* v220: the hero's correction buttons — move the day's signed
       correction by delta (+1 / −1) and persist it at once. Only
       meaningful while a day is being watched; returns the new
       correction, or null when no day is active (the caller then
       falls back to the session's tap count). */
    nudge: function (delta) {
      if (!curDate || !watching) return null;
      corrNow += (parseInt(delta, 10) || 0);
      /* the buttons move the DISPLAYED count: it floors at 0, so
         the clamp lives in the correction itself — extra −1 taps
         at zero bank no invisible debt for +1 to repay first. */
      var machine = baseCount + (counter ? counter.count() : 0);
      if (machine + corrNow < 0) corrNow = -machine;
      persist(true);
      return corrNow;
    },

    sitesCheck: ENGINE.sitesCheck,
    /* v220 (DSP-PIN-NAVIGATE): the unique known-place lookup, shared
       with the Dispatch module so a dispatch naming a known place
       can offer Navigate even when it carries no pin. */
    placeByName: placeByName,
    phase: function () { return counter ? counter.phase() : 'away'; }
  };

  window.GeoLoads = GeoLoads;
  try { if (window.App) window.App.geoLoads = GeoLoads; } catch (e) {}
  subscribe();
})();
