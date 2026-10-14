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
 *    load-visit -> departure -> ~3 min dwell >= 300 m away teaches
 *    the site, the teaching cycle is credited as load #1, and the
 *    pair is remembered in the synced key 'geoload_pairs' (keyed by
 *    the load site) so later days with the same load site start
 *    counting from the first load. Two rival candidates before the
 *    first cycle completes = an ambiguous day that teaches nothing.
 *    On a remembered-pair day, a different candidate is RECORDED
 *    on the day (altDump) but never overwrites the pair. The user
 *    is never asked for the dump location — figuring it out is the
 *    app's job, not his (invisible-complexity rule).
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
        } else {
          if (!S.cand || S.cand.zone !== raw) S.cand = { zone: raw, since: t };
          var need = (raw === 'out') ? departMs : dwellMs;
          if (t - S.cand.since >= need) confirmZone(raw, t);
        }
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
       -> a stationary dwell of ~3 min (LEARN_DWELL_MS) at one place
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
  var LEARN_DWELL_MS = 3 * 60 * 1000; // stationary dwell that makes a candidate
  var LEARN_MIN_SEP_M = 300;          // candidate must be this far from load
  var LEARN_CLUSTER_M = 75;           // a "place": fixes stay within this
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
        } else {
          if (!S.zoneCand || S.zoneCand.zone !== raw) S.zoneCand = { zone: raw, since: t };
          var need = (raw === 'out') ? departMs : dwellMs;
          if (t - S.zoneCand.since >= need) {
            S.zone = raw; S.zoneCand = null;
            if (raw === 'load') {
              S.atLoad = true; S.legArmed = false; S.cluster = null;
            } else if (S.atLoad) {
              S.atLoad = false; S.legArmed = true; S.cluster = null;
            }
          }
        }
        res.zone = S.zone;

        /* Candidate watching: only on a loaded leg (confirmed load
           visit, then confirmed departure) and only while confirmed
           OUT of the load fence. */
        if (S.legArmed && S.zone === 'out' && !S.ambiguous) {
          var cl = S.cluster;
          if (!cl) {
            S.cluster = { lat: +fix.latitude, lng: +fix.longitude, sumLat: +fix.latitude, sumLng: +fix.longitude, n: 1, since: t };
          } else if (haversineM(cl.lat, cl.lng, +fix.latitude, +fix.longitude) <= clusterM) {
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

  var ENGINE = {
    haversineM: haversineM,
    isCoord: isCoord,
    sitesCheck: sitesCheck,
    looksLikeAddress: looksLikeAddress,
    createGeoLoadCounter: createGeoLoadCounter,
    createDumpLearner: createDumpLearner,
    RADIUS_M: RADIUS_M, DWELL_MS: DWELL_MS, DEPART_MS: DEPART_MS,
    ACC_MAX_M: ACC_MAX_M, MIN_SITE_SEP_M: MIN_SITE_SEP_M,
    LEARN_DWELL_MS: LEARN_DWELL_MS, LEARN_MIN_SEP_M: LEARN_MIN_SEP_M,
    LEARN_CLUSTER_M: LEARN_CLUSTER_M, CONTEST_SEP_M: CONTEST_SEP_M
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

  function persist(force) {
    if (!curDate) return;
    var now = Date.now();
    if (!force && now - lastPersist < PERSIST_MIN_MS) return;
    lastPersist = now;
    var rec = recordFor(curDate) || blankDay(curDate);
    rec.dispatchId = curDispatchId;
    rec.sessionKey = sessionKey;
    rec.sites = curSites;
    rec.updatedAt = now;
    if (counter) {
      rec.count = baseCount + counter.count();
      rec.events = baseEvents.concat(counter.events());
      rec.state = counter.snapshot();
      rec.blocked = null;
    }
    if (learner) rec.learn = learner.snapshot();
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
    baseCount = (!sameSession && prev) ? (prev.count || 0) : 0;
    baseEvents = (!sameSession && prev && prev.events) ? prev.events.slice() : [];
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
    rememberPair(curLoad, taught);
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
        }
      }
    }
    if (learner) {
      var lr = learner.ingest(fix);
      if (lr && lr.learned) onLearned(lr.learned);
      else if (lr && lr.contested) onContested(lr.contested);
      else if (lr && lr.altCandidate) onAltCandidate(lr.altCandidate);
      if (!r) r = lr;
    }
    return r;
  }

  function onFix(fix) {
    if (!watching || (!counter && !learner)) return null;
    var r = feedFix(fix);
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
      baseCount = 0;
      baseEvents = [];
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
        count: rec.count || 0,
        events: rec.events || [],
        sites: rec.sites || null,
        blocked: rec.blocked || null,
        dispatchId: rec.dispatchId || null,
        learnedDump: rec.learnedDump || null,
        altDump: rec.altDump || null,
        dumpContested: rec.dumpContested || null
      };
    },

    sitesCheck: ENGINE.sitesCheck,
    phase: function () { return counter ? counter.phase() : 'away'; }
  };

  window.GeoLoads = GeoLoads;
  try { if (window.App) window.App.geoLoads = GeoLoads; } catch (e) {}
  subscribe();
})();
