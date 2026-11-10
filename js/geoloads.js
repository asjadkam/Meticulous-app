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
 *
 * v267 (Oct 26, 2026 — LOAD-COUNT-DEAD): the owner, mid-shift on
 * an ACTIVE dispatch at a same-place site: "That gps load
 * tracking is not working at all now!" — zero automatic counts
 * all morning. The whole pipeline was audited as shipped and
 * four distinct zero-forever states were PROVEN in the harness
 * (tools/load-count-dead-v267-test.js, which drives this file's
 * real glue), and fixed:
 *   (A) STALE CONFIGURATION: counting was configured once, at
 *       session start, and nothing re-ran configure() when the
 *       world changed under the session — the dispatch landing
 *       mid-shift (Connect / message / his tap / yard flip)
 *       armed nothing, and onFix's armed guard returned before
 *       the day roll, so even the roll could not heal it. Now:
 *       the roll runs before the feed, and a throttled world
 *       check (the store's dsp_active vs the configured
 *       dispatch — the same record the dashboard shows) re-runs
 *       configure() whenever the configuration is disarmed or
 *       the active dispatch changed; startDay's same-key
 *       reattach runs the same check.
 *   (C) INTRA ACCURACY STARVATION: the pattern learner's
 *       intra-site machine RESET its sub-cluster on any fix
 *       rougher than 30 m (or with no accuracy at all). Every
 *       other machine in this engine ignores bad fixes
 *       entirely; intra let one spike zero a 2-minute dwell
 *       build, so under any realistic fix wobble a same-place
 *       sub-spot could never confirm — zero all day while
 *       'learning'. Rough fixes are now ignored for intra,
 *       never fatal; the distance rule still restarts a cluster
 *       when a good fix lands away from its centroid.
 *   (B) ONE-PIN SAME-PLACE BLINDNESS: a dispatch with a load
 *       pin only enters teach mode, whose dump candidate must
 *       sit >= 300 m from the pin — a same-place tip never
 *       qualifies, so the day could never count. Teach mode now
 *       also runs a shadow pattern learner seeded on the pin
 *       that may arm the counter with an INTRA-site pair only
 *       (never an outer pair, never a contest), and only while
 *       the dump learner has no loaded leg outstanding.
 *   (H) MIS-ANCHORED PATTERN DAY: the pattern learner anchored
 *       on the day's first dwell — an en-route fuel/coffee stop
 *       became the "load site", the pit became the candidate,
 *       cycles could never close (they close only at the
 *       anchor) and intra stayed suppressed while a candidate
 *       existed: zero forever. A candidate confirmed three
 *       times with no cycle ever closed is the day's real hub:
 *       a LEARNED anchor is reassigned to it (a seeded anchor —
 *       the dispatch's own pin — never is), the two-cycle proof
 *       itself unchanged.
 *
 * v268 (Oct 26, 2026 — LOAD-COUNT-ONEPIN-AUDIT): round 3. He was
 * ON v267 with a RUNNING session and still got zero automatic
 * reads on 4 dumped loads. The audit (real glue, HIS geometry —
 * two ends ~1.5 km apart, tools/load-count-onepin-audit-v268-
 * test.js) walked every dispatch shape:
 *   - COUNTS FINE: no-pin two-site clean; load-pin-only clean
 *     (teach); pin at the far end (labels swapped, count true);
 *     too-close pins with two-site driving (seeded pattern);
 *     load-pin same-place (teach + shadow); no-pin same-place
 *     (pattern intra).
 *   - PROVABLY DEAD, FIXED HERE: the DUMP-PIN-ONLY dispatch —
 *     a record carrying only dumpLat/dumpLng (a Connect sender
 *     pinning the drop; an OCR ticket with the dump's coords).
 *     sitesFromDispatch gives load=null, blockedWhy says
 *     'one-site', and the teach branch requires the LOAD pin —
 *     so no learner of any kind ever ran and the day sat blind
 *     at 'one-site' forever. It now joins the pattern path
 *     seeded on the known place (like 'sites-too-close' seeds
 *     on its pin); the proven pair's labels may sit swapped and
 *     it is kept OUT of the cross-day pair memory (keyed by
 *     load site — a dump site must not be filed as one).
 *   - WALLS, NOT BUGS (the owner's own bars — reported, not
 *     moved): quick tips (~75 s) never confirm a place anywhere
 *     in the no-pin/teach chains because a place is a 2-minute
 *     dwell (LEARN_DWELL_MS; v220 chose the completed-cycle
 *     proof precisely because dwell length cannot tell a tip
 *     from a washroom stop); and ONE mid-leg stop of 2+ minutes
 *     before the two-cycle proof completes contests the day —
 *     pattern and teach alike — and a contested day stays
 *     unteachable ('ambiguous-dump', pinned spec since v68:
 *     geoloads-learning (c)). Both are his decisions to move.
 *   - Also shipped: the LEARNER READOUT — GeoLoads.status()
 *     exposes the live engine state (mode, anchor, candidate,
 *     cycles closed, contested, the stop currently building,
 *     last fix accuracy) and Preferences -> Advanced shows it
 *     as "Load counter — status". The learner's state was
 *     previously invisible in the UI, which is why three
 *     rounds of this defect were diagnosed blind.
 *
 * v282 (Oct 29, 2026 — LOADS-SITE-PEGS): the owner's answer to
 * the whole inference problem: "this GPS load counter as smart
 * as it is it can never be accurate where I'm picking up where
 * I'm dumping — its system is only calculating based on times,
 * how long I spent on either side. Instead… user should have
 * somewhere to peg the pickup site and their dump sites, and
 * they should be able to adjust that as the day goes on,
 * because we don't know when the job is changing." So: two big
 * one-tap controls on the tracker (js/app.js) — PEG PICKUP and
 * PEG DUMP — each plants a peg at the phone's current position
 * (GeoLoads.setPeg reads the counter's own last live fix; no
 * coordinate display or entry exists anywhere — pegs show by
 * TIME, "Pickup pegged 2:14 PM"). Pegs live on the day record;
 * re-pegging overwrites (that IS the mid-day adjustment) and
 * every move lands in the day's pegLog. When both pegs exist,
 * configure() arms the PEG counter (engine createPegCounter)
 * ahead of every inference source and no learner runs: the
 * pegs are the driver's declared ground truth. The peg counter
 * is the standard armed alternation at intra-site grade (30 m
 * fence / 30 m accuracy bar / 30 s declared-place dwell) fed a
 * rolling-centroid fix stream, so two pegs ~15 m apart inside
 * one site still separate by peg identity + visit sequence —
 * the case no fence geometry could ever solve. A peg-keyed
 * day is marked countSource 'pegs' on the record (surfaced via
 * forDate/today); past days are never rewritten. Days without
 * pegs run the inference stack exactly as before.
 *
 * v284 (Oct 29, 2026 — PEGS-SEEDS-NOT-FENCES): the owner's own
 * correction to v282 (14:38 MDT): the tight fixed peg circles
 * are "a double edged sword" — on same-site jobs the pickup and
 * dump spots MOVE around the site load to load, so a tight fence
 * works some days and not others, and re-pegging every load
 * means touching the screen again and again — "tiresome… it's
 * dangerous as well." His approved shape (14:55 MDT): the pegs
 * are SEEDS, not fences. Each role's centre starts at its seed
 * and DRIFTS with the work face (every counted event nudges it
 * toward where the event happened, a bounded step off the
 * smoothed fix); the fence is a generous 70 m because identity
 * comes from the load->dump->load CYCLE, not the pinpoint; one
 * wide SITE frame (the seeds' midpoint, covering both plus a
 * buffer) rules every fix — a stop outside it counts nothing,
 * whatever its length (place, not duration). No screen touches
 * after the morning's two pegs; a re-peg is a re-seed for a job
 * that truly changed (v282 banking, preserved). The day's
 * counted events (pegEvents, with positions) and current
 * centres (pegCentres) ride the record so the Manifest names
 * where loading and dumping actually happened (v283 + v284).
 *
 * v405 (Nov 10, 2026 — LOADS-MISSED, ROUND 3): web 393 in the
 * owner's hands on a DISPATCH-PIN day (no re-peg; the morning's
 * pickup peg + the dispatch's dump pin): loads #1 and #2 counted
 * by themselves, load #3 did not, and his 09:53 Advanced card
 * read the machine clean (phase away, the loop closed after #2)
 * — the third VISIT itself produced nothing. Conviction: this
 * day runs the DUMP-VISIT counter (createDumpVisitCounter), and
 * round 2's VISIT SHADOW was wired only into the PEG cycle
 * counter — this machine kept two arrival fragilities of its
 * own. (1) Presence is judged within 250 m of the pin POINT,
 * and the one door that can adopt a moved work face (the
 * virgin-face pending branch) is gated to stops MORE than
 * 500 m out: a tip face in between — the spots move around the
 * site load to load (v284) — is witnessed by the stop-cluster
 * and ignored by every branch. (2) The arrival candidate dies
 * on any witnessed absence chunk past the 25 s grace, with no
 * wider recovery reach: presence fragmented across the 250 m
 * line (queue creep, a throttled stream) restarts the 45 s bar
 * forever — round 2's disease, unfixed here. The fix, inside
 * createDumpVisitCounter only: the VISIT SHADOW in this
 * machine's own discipline (recovery reach = presence + 200 m,
 * stillness-gated by the stop-cluster rule, armed only once the
 * day's loop has demonstrably moved), and a cluster branch
 * that counts a tip-grade stop in the dead band (250–500 m) as
 * the visit, adopting its face. Beyond 500 m the pending rail
 * is untouched. Bench: tools/loads-missed-dispatchpin-nov10-
 * test.js — live-404 bytes fail exactly the two convicted
 * shapes (20 passed / 6 failed); the fix passes all.
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
    /* v393 (LOADS-MISSED-AFTER-REPEG-NOV9, round 2): the peg
       wrapper may ask for the VISIT SHADOW (see ingest): an
       armed carry may also be confirmed by visit-grade presence
       at the dump, because the fence dwell alone starves on a
       fragmented fix stream. The standard counter (dispatch
       pairs) never passes it and is unchanged. */
    var shadowR = (cfg.visitShadow && typeof cfg.shadowRadiusM === 'number' && cfg.shadowRadiusM > 0)
      ? cfg.shadowRadiusM : 0;
    var S = null;

    function classify(lat, lng) {
      var dL = haversineM(lat, lng, LOAD.lat, LOAD.lng);
      var dD = haversineM(lat, lng, DUMP.lat, DUMP.lng);
      var inL = dL <= radiusM, inD = dD <= radiusM;
      if (inL && inD) {
        /* v284: a caller may break a GENUINE tie by EXPECTATION
           — cfg.tieRole(dL, dD) returns the role the cycle is
           waiting for, or null to let geometry speak (the peg
           counter returns its expectation only inside its
           coin-flip band). Otherwise nearer site wins, as
           always: a truck parked ON a centre is nearer it by
           the full separation, and expectation must never
           override that — a stationary truck in a full overlap
           would otherwise alternate the cycle by itself. */
        if (typeof cfg.tieRole === 'function') {
          var tb = cfg.tieRole(dL, dD);
          if (tb === 'load' || tb === 'dump') return tb;
        }
        return dL <= dD ? 'load' : 'dump'; // overlap: nearer site wins
      }
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

    /* v393: the accumulated-dwell candidate discipline (the
       visit counter's candStep, in miniature) for the visit
       shadow: presence accumulates toward the bar; a brief
       excursion (<= CAND_GRACE_MS) is subtracted, never fatal;
       a longer one restarts the build. */
    function shadowStep(c, inNow, t, barMs) {
      if (inNow) {
        if (!c) return { since: t, gapMs: 0, awaySince: null };
        if (c.awaySince) { c.gapMs += t - c.awaySince; c.awaySince = null; }
        if (t - c.since - c.gapMs >= barMs) return 'confirm';
        return c;
      }
      if (!c) return null;
      if (!c.awaySince) c.awaySince = t;
      else if (t - c.awaySince > CAND_GRACE_MS) return null;
      return c;
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
          cand: null, visitCand: null, lastT: 0, lastLat: null, lastLng: null, counted: false
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

        /* v393 VISIT SHADOW (peg days only — the wrapper passes
           cfg.visitShadow; the standard counter never does).
           Conviction, Nov 9, 2026 round 2: after the 18:04 cold
           start the post-swap pair counted cycle #10 by itself
           and silently swallowed #11 — same pair, same driver,
           adjacent cycles. The fence verdict above demands a
           continuous fix-witnessed 30 s dwell inside a 70 m
           fence on a smoothed stream; a tip whose witnessed
           presence fragments — the fix stream goes dark mid-tip
           (his phone's location went dark ~25 min that same
           morning), a short creeping tip, a face at the fence's
           edge — never confirms, the armed carry never lands,
           and nothing notices. The dump-VISIT counter next door
           has counted this shape reliably since v324 precisely
           because it judges presence wider. So: while the
           machine is ARMED, sustained presence within the dump's
           own reach (the wrapper passes fence + recovery band —
           the reach v300 already trusts for a carrying truck)
           and outside the load's reach, accumulated under the
           visit counter's candidate discipline at the visit
           arrival bar (DWELL_MS), confirms the arrival through
           confirmZone itself — the same count, the same event,
           the same disarm. The fence path stays primary (it is
           checked first, and a fence count disarms before the
           shadow is consulted, so a visit can never count
           twice); the shadow only catches what fragmented
           presence starved. Unarmed presence counts nothing,
           exactly as before; the candidate is runtime-only and
           never persisted. */
        if (shadowR > 0) {
          if (S.armed && S.zone !== 'dump' && !S.counted) {
            var shD = haversineM(+fix.latitude, +fix.longitude, DUMP.lat, DUMP.lng);
            var shL = haversineM(+fix.latitude, +fix.longitude, LOAD.lat, LOAD.lng);
            var shStep = shadowStep(S.visitCand, shD <= shadowR && shL > shadowR, t, DWELL_MS);
            if (shStep === 'confirm') {
              S.visitCand = null;
              confirmZone('dump', t);
            } else {
              S.visitCand = shStep;
            }
          } else if (S.visitCand) {
            S.visitCand = null;
          }
        }
        return {
          accepted: true, zone: raw, confirmed: S.zone, phase: S.phase,
          counted: S.counted, count: S.count
        };
      },
      stop: function () { if (S) S.active = false; },
      /* v284: move the fences in place (the peg counter's
         drifting centres). Zone/phase/count/armed are untouched
         — only the ground the NEXT fixes are judged against
         moves. Other counters never call it. */
      moveSites: function (load, dump) {
        if (isCoord(load)) { LOAD.lat = +load.lat; LOAD.lng = +load.lng; }
        if (isCoord(dump)) { DUMP.lat = +dump.lat; DUMP.lng = +dump.lng; }
      },
      /* v268: read-only live state for the Advanced readout
         (GeoLoads.status) — the same S the engine counts from,
         no parallel bookkeeping. candSince is when the current
         zone candidate started building toward its dwell bar. */
      debug: function () {
        if (!S) return null;
        return {
          zone: S.zone, phase: S.phase, armed: S.armed, count: S.count,
          candZone: S.cand ? S.cand.zone : null,
          candSince: S.cand ? S.cand.since : null,
          lastT: S.lastT
        };
      },
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

  /* ---- site pegs (v282 — LOADS-SITE-PEGS; v284 — SEEDS) ----
     A peg is a place the DRIVER declared: he stood there and
     tapped PEG PICKUP / PEG DUMP, and the peg is the phone's
     position at that tap. Pegs can sit metres apart — pickup
     pile and tip face inside ONE site — where fence separation
     can never tell the two places apart (the standard counter
     needs >= 250 m between sites; the pattern learner's
     sub-spots need 50 m). What separates two pegs is IDENTITY
     plus VISIT SEQUENCE: the armed alternation of the standard
     counter (confirmed at pickup -> confirmed at dump counts).
     Two v282 adaptations carry over:
       - Fixes are SMOOTHED through a short rolling centroid
         (PEG_WINDOW accepted fixes) before the zone machine
         sees them, so a stopped truck's scatter cannot
         accumulate dwell on the wrong peg.
       - The arrival dwell is PEG_DWELL_MS (30 s), shorter than
         the learned-place bars — a peg is declared ground
         truth, not a guess that must out-dwell a washroom stop.
     v284 (PEGS-SEEDS-NOT-FENCES) changes what a peg IS. The
     owner: on same-site jobs the two spots MOVE load to load;
     tight fixed circles (v282: 30 m) are right in the morning
     and wrong by lunch, and re-pegging every load is screen
     touching a driver must never do. So:
       - Each role keeps a living CENTRE that starts at its
         seed peg. Every COUNTED event of that role — a
         confirmed pickup (the arm), a counted dump — nudges
         the centre toward the event's smoothed position by at
         most DRIFT_STEP_M: the face can wander all day with
         zero touches, and one bad fix can never teleport a
         centre. The wrapper delegates verdicts to the standard
         counter and moves its fences via moveSites().
       - The fence is PEG_FENCE_M (70 m — the owner's 60–80 m
         band), generous because identity comes from the CYCLE.
         THE AMBIGUITY RULE, exactly: a dwell inside only one
         fence belongs to that fence's role (the unexpected
         role alone = a visit — no count, no arm change; the
         standard machine's law, unchanged). A dwell inside
         BOTH fences belongs to the NEARER centre — with one
         exception: when the truck is at least TIE_MIN_DIST_M
         (20 m) from BOTH centres (it is sitting on neither)
         AND the two distances are within TIE_BAND_M (10 m)
         of each other, geometry is a coin flip and the role
         the load->dump->load alternation is waiting for wins
         (tieRole). The 20 m floor is load-bearing: a truck
         parked ON a centre is nearer it by the whole
         separation (15 m on the closest same-site pair), so
         expectation can never override a parked truck — a
         stationary truck in a full overlap cannot alternate
         the cycle by itself. The same honesty gates the
         DRIFT: an event only pulls its centre when the event
         spot is nearer that centre than the other (within
         the band) — a spot nearer the other face is no
         evidence about this one.
       - One wide SITE frame, derived from the seeds alone:
         midpoint of the pair, radius max(SITE_MIN_M, half the
         seed separation + SITE_BUFFER_M); a lone seed frames
         itself at SITE_ONE_SEED_M. A smoothed fix outside the
         frame never reaches the zone machine — an off-site
         stop counts nothing, whatever its length (place, not
         duration) — and the drift clamp keeps every centre
         inside the frame.
       - A re-peg RE-SEEDS: the glue rebuilds the counter on
         the new seeds with the day's count banked (v282).
     Centres + counted-event positions ride the snapshot
     (pegCentres / pegEvents) so a relaunch resumes the drift
     and the Manifest can name where the work actually happened. */
  var PEG_WINDOW = 4;           // accepted fixes in the rolling centroid
  var PEG_DWELL_MS = 30 * 1000; // presence at a peg that confirms arrival
  var PEG_FENCE_M = 70;         // v284: the seeds fence (owner's 60–80 m band)
  var DRIFT_STEP_M = 25;        // v284: most a centre moves per counted event
  var SITE_BUFFER_M = 100;      // v284: site frame reaches this past the seeds
  var SITE_MIN_M = 200;         // v284: site frame floor (close-pair days)
  var SITE_ONE_SEED_M = 250;    // v284: site frame around a lone seed
  var TIE_BAND_M = 10;          // v284: |dLoad - dDump| inside both fences
                                // at or under this = a coin flip the
                                // cycle's expected role decides
  var TIE_MIN_DIST_M = 20;      // v284: ...but only when the truck is at
                                // least this far from BOTH centres (it is
                                // sitting on neither); a parked truck's
                                // geometry always speaks for itself
  /* v300 (LOADS-FENCE-RECOVERY, owner Oct 31): the drift above
     moves a centre ONLY on a counted event — so one missed dump
     at a MOVING tip face strands every later dump: the face
     walks away from a centre no miss can pull back (Oct 31:
     dumps counted at 9:36 and 10:38, then the face moved and
     the 12:27 cycle's dump never registered; the strict cycle
     masked the fourth load entirely). The recovery: while the
     truck is CARRYING (the cycle waits for a dump), a sustained
     stop-cluster NEAR but OUTSIDE the dump fence — within
     RECOVERY_BAND_M of the dump centre, nearer it than the load
     centre (the onEvent honesty gate), its fixes holding within
     RECOVERY_CLUSTER_M of their own centroid for a full arrival
     dwell — nudges the dump centre toward the cluster by the
     same bounded DRIFT_STEP_M a counted event would, once per
     dwell of continued presence. A nudge never counts a dump:
     counting stays the zone machine's verdict, which can now
     judge the truck inside the fence it drifted to. A fixed
     face (Oct 30, 17/17) never triggers any of this — the truck
     is inside the fence, where recovery stands down. */
  var RECOVERY_BAND_M = 200;    // v300: cluster centroid must be within
                                // this of the dump centre to nudge it
  var RECOVERY_CLUSTER_M = 35;  // v300: a "stopped here" cluster's
                                // fixes hold within this of its centroid

  function createPegCounter(cfg) {
    /* v369 (LOAD-NOT-COUNTED-AFTER-BOTH-PEGGED-NOV7): the accuracy
       bar is the ENGINE STANDARD 50 m (ACC_MAX_M), not the intra-
       site learner's 30 m. The 30 m bar belongs to sub-cluster
       work that must separate spots metres apart; a declared peg
       is judged through a rolling centroid that already smooths
       scatter. The borrowed 30 m bar starved the peg counter in
       exactly the conditions the day had already counted in: on
       Nov 7 the morning's VISIT counter (50 m bar) counted 2,
       he pegged the dump at 11:18, and at 35-45 m fix accuracy
       the peg counter dropped EVERY fix and counted nothing
       again (proven in tools/load-not-counted-bothpegged-v369-
       test.js N4: acc 35/45 -> morning 2, post-peg cycle 0). */
    var accBar = cfg.accMaxM || ACC_MAX_M;
    var seedLoad = isCoord(cfg.load) ? { lat: +cfg.load.lat, lng: +cfg.load.lng } : null;
    var seedDump = isCoord(cfg.dump) ? { lat: +cfg.dump.lat, lng: +cfg.dump.lng } : null;
    /* v392 (LOADS-MISSED-AFTER-REPEG-NOV9) DECLARATION SEEDING:
       cfg.presence / cfg.presenceT carry where the truck physically
       was when the glue (re)built this counter — the peg tap's own
       fix. A FRESH begin (moved peg, key mismatch) used to discard
       that evidence and start zone 'out' / armed=false, so a driver
       who pegged the pickup and rolled at once never armed the
       machine and the cycle's tip was swallowed (Nov 9: pickup
       re-pegged 16:18, "re-pegged and kept moving", the load had to
       be hand-tapped +1). Seeded instead: the counter begins with
       the posture the declaration + position prove — standing at
       the pickup = at-load and armed; standing at the dump =
       at-dump, unarmed. Only a fresh begin seeds; a real saved
       state always wins, and callers passing no presence (the
       engine suites) are unchanged. */
    var cfgPresence = isCoord(cfg.presence) ? { lat: +cfg.presence.lat, lng: +cfg.presence.lng } : null;
    var cfgPresenceT = (typeof cfg.presenceT === 'number') ? cfg.presenceT : 0;
    /* the day's site frame, from the seeds alone */
    var site = null;
    if (seedLoad && seedDump) {
      var sepM = haversineM(seedLoad.lat, seedLoad.lng, seedDump.lat, seedDump.lng);
      site = {
        lat: (seedLoad.lat + seedDump.lat) / 2,
        lng: (seedLoad.lng + seedDump.lng) / 2,
        radiusM: Math.max(SITE_MIN_M, sepM / 2 + SITE_BUFFER_M)
      };
    } else if (seedLoad || seedDump) {
      var only = seedLoad || seedDump;
      site = { lat: only.lat, lng: only.lng, radiusM: SITE_ONE_SEED_M };
    }
    var cen = {
      load: seedLoad ? { lat: seedLoad.lat, lng: seedLoad.lng } : null,
      dump: seedDump ? { lat: seedDump.lat, lng: seedDump.lng } : null
    };
    var evLog = [];            // counted events, with where they happened
    var expectRole = 'load';   // the cycle's waiting role (tie-break input)
    var inner = null;
    if (seedLoad && seedDump) {
      inner = createGeoLoadCounter({
        load: seedLoad, dump: seedDump,
        radiusM: cfg.radiusM || PEG_FENCE_M,
        dwellMs: cfg.dwellMs || PEG_DWELL_MS,
        departMs: cfg.departMs || DEPART_MS,
        accMaxM: accBar,
        /* v393: the visit shadow judges presence at the dump's
           own reach for a carrying truck — the fence plus the
           v300 recovery band */
        visitShadow: true,
        shadowRadiusM: PEG_FENCE_M + RECOVERY_BAND_M,
        tieRole: function (dL, dD) {
          if (Math.min(dL, dD) < TIE_MIN_DIST_M) return null;
          return Math.abs(dL - dD) <= TIE_BAND_M ? expectRole : null;
        }
      });
    }
    var win = [];
    /* v300: the fence-recovery cluster (see RECOVERY_BAND_M) —
       {lat, lng, since, lastNudge} while a candidate stop builds,
       and the day's nudge count (rides the snapshot). */
    var rec = null;
    var recCount = 0;

    /* One counted event pulls its role's centre toward where the
       event happened — a bounded step, then the site clamp. The
       event is logged either way (it counted); the PULL is gated:
       a spot nearer the OTHER centre (beyond the tie band) is no
       evidence about this face and moves nothing. */
    function onEvent(kind, t, pos) {
      evLog.push({ kind: kind, t: t, lat: pos.lat, lng: pos.lng });
      var c = cen[kind];
      if (!c || !inner) return;
      var other = cen[kind === 'load' ? 'dump' : 'load'];
      if (other &&
          haversineM(pos.lat, pos.lng, c.lat, c.lng) >
          haversineM(pos.lat, pos.lng, other.lat, other.lng) + TIE_BAND_M) return;
      var d = haversineM(c.lat, c.lng, pos.lat, pos.lng);
      if (d > 0) {
        var f = Math.min(DRIFT_STEP_M, d) / d;
        c.lat += (pos.lat - c.lat) * f;
        c.lng += (pos.lng - c.lng) * f;
      }
      if (site) {
        var ds = haversineM(site.lat, site.lng, c.lat, c.lng);
        if (ds > site.radiusM) {
          var g = site.radiusM / ds;
          c.lat = site.lat + (c.lat - site.lat) * g;
          c.lng = site.lng + (c.lng - site.lng) * g;
        }
      }
      if (inner.moveSites) inner.moveSites(cen.load, cen.dump);
    }

    return {
      begin: function (key, saved) {
        win = [];
        evLog = [];
        rec = null;
        recCount = (saved && saved.sitesKey === key && saved.pegRecovery) ? (saved.pegRecovery | 0) : 0;
        cen = {
          load: seedLoad ? { lat: seedLoad.lat, lng: seedLoad.lng } : null,
          dump: seedDump ? { lat: seedDump.lat, lng: seedDump.lng } : null
        };
        expectRole = 'load';
        if (!inner) return null;
        /* v392 declaration seeding: on a FRESH begin (no saved
           state for this key) with the truck's position supplied,
           the counter is born with the posture that position
           proves against the seed fences — the peg tap itself is
           the dwell evidence. Presence inside BOTH fences (a
           same-place pair) reads as the nearer centre; inside
           neither, the counter begins as before. */
        var effSaved = saved;
        if (!(saved && saved.sitesKey === key) && cfgPresence) {
          var pFence = (typeof cfg.radiusM === 'number' && cfg.radiusM > 0) ? cfg.radiusM : PEG_FENCE_M;
          var pdL = cen.load ? haversineM(cfgPresence.lat, cfgPresence.lng, cen.load.lat, cen.load.lng) : Infinity;
          var pdD = cen.dump ? haversineM(cfgPresence.lat, cfgPresence.lng, cen.dump.lat, cen.dump.lng) : Infinity;
          var pz = null;
          if (pdL <= pFence && pdD <= pFence) pz = (pdL <= pdD) ? 'load' : 'dump';
          else if (pdL <= pFence) pz = 'load';
          else if (pdD <= pFence) pz = 'dump';
          if (pz) {
            effSaved = {
              sitesKey: key, count: 0, events: [],
              zone: pz, phase: (pz === 'load') ? 'at-load' : 'at-dump',
              armed: (pz === 'load'), lastT: cfgPresenceT
            };
          }
        }
        var k = inner.begin(key, effSaved);
        /* resume the drift itself: centres + the event trail
           ride the snapshot, keyed like the counter's own state */
        if (saved && saved.sitesKey === key) {
          if (saved.pegCentres) {
            if (isCoord(saved.pegCentres.load)) cen.load = { lat: +saved.pegCentres.load.lat, lng: +saved.pegCentres.load.lng };
            if (isCoord(saved.pegCentres.dump)) cen.dump = { lat: +saved.pegCentres.dump.lat, lng: +saved.pegCentres.dump.lng };
          }
          if (Array.isArray(saved.pegEvents)) {
            evLog = saved.pegEvents.filter(function (e) {
              return e && (e.kind === 'load' || e.kind === 'dump') && isCoord(e);
            }).map(function (e) {
              return { kind: e.kind, t: +e.t || 0, lat: +e.lat, lng: +e.lng };
            });
          }
          if (inner.moveSites) inner.moveSites(cen.load, cen.dump);
          var dbg = inner.debug ? inner.debug() : null;
          expectRole = (dbg && dbg.armed) ? 'dump' : 'load';
        }
        if (effSaved && effSaved !== saved) {
          /* v392: the seeded posture waits on the other end */
          expectRole = effSaved.armed ? 'dump' : 'load';
          /* the declaration IS the pickup confirmation — log it,
             or the event trail (the manifest's place names) loses
             the pickup the counter was born carrying */
          if (effSaved.zone === 'load' && cfgPresence) {
            onEvent('load', cfgPresenceT, cfgPresence);
          }
        }
        return k;
      },
      ingest: function (fix) {
        if (!inner) return { accepted: false, why: 'inactive' };
        if (!fix || !isFinite(fix.latitude) || !isFinite(fix.longitude)) {
          return { accepted: false, why: 'bad-fix' };
        }
        if (fix.accuracy !== null && fix.accuracy !== undefined && fix.accuracy > accBar) {
          return { accepted: false, why: 'accuracy' };
        }
        var entry = { lat: +fix.latitude, lng: +fix.longitude };
        win.push(entry);
        if (win.length > PEG_WINDOW) win.shift();
        var sl = 0, sg = 0, i;
        for (i = 0; i < win.length; i++) { sl += win[i].lat; sg += win[i].lng; }
        var sm = { lat: sl / win.length, lng: sg / win.length };
        /* the SITE frame: a smoothed fix outside it is not site
           data — it never reaches the zone machine, builds no
           dwell and drifts no centre (place, not duration). */
        if (site && haversineM(sm.lat, sm.lng, site.lat, site.lng) > site.radiusM) {
          var jx = win.indexOf(entry);
          if (jx >= 0) win.splice(jx, 1);
          return { accepted: false, why: 'off-site' };
        }
        var before = inner.debug ? inner.debug() : null;
        expectRole = (before && before.armed) ? 'dump' : 'load';
        /* v300 (LOADS-FENCE-RECOVERY): while carrying, watch for
           the sustained stop-cluster near-but-outside the dump
           fence and nudge the centre (see the RECOVERY_BAND_M
           note). Runs BEFORE the zone machine judges this fix,
           so a fence that recovers onto the truck judges this
           very fix inside it. */
        var fixT = (typeof fix.time === 'number' && fix.time > 0) ? fix.time : Date.now();
        /* v323 (LOADS-DOUBLE-COUNTING / LOADS-SECOND-CYCLE-NOT-
           COUNTING, Nov 4, 2026): the recovery is now symmetric —
           it serves whichever role the cycle is WAITING for. The
           v300 original served only the dump side (while carrying);
           the load side had no recovery at all, so a pickup face
           that moved outside the load fence starved the arm for
           the rest of the day (proven in
           tools/defects-nov4-v323-test.js S3: loading 95 m from
           the load peg never armed, the cycle never counted —
           Asjad's Nov 4 morning, cycles 2 and 3). The gates are
           the v300 honesty gates, mirrored: the cluster must sit
           nearer the WAITING role's centre than the other centre
           (beyond the tie band), so a stop at the dump can never
           drag the load centre, nor the reverse. */
        var recRole = (before && before.armed) ? 'dump' : 'load';
        var recCen = cen[recRole];
        var recOther = cen[recRole === 'dump' ? 'load' : 'dump'];
        if (rec && rec.role !== recRole) rec = null;
        if (before && recCen) {
          var dTgtC = haversineM(sm.lat, sm.lng, recCen.lat, recCen.lng);
          var dOthC = recOther ? haversineM(sm.lat, sm.lng, recOther.lat, recOther.lng) : Infinity;
          var recCandidate = dTgtC > PEG_FENCE_M && dTgtC <= RECOVERY_BAND_M &&
            dTgtC <= dOthC + TIE_BAND_M;
          if (recCandidate) {
            if (!rec) {
              rec = { lat: sm.lat, lng: sm.lng, since: fixT, lastNudge: 0, role: recRole };
            } else if (haversineM(sm.lat, sm.lng, rec.lat, rec.lng) > RECOVERY_CLUSTER_M) {
              rec = { lat: sm.lat, lng: sm.lng, since: fixT, lastNudge: rec.lastNudge, role: recRole };
            } else {
              rec.lat += (sm.lat - rec.lat) * 0.35;
              rec.lng += (sm.lng - rec.lng) * 0.35;
            }
            if (rec && (fixT - rec.since) >= PEG_DWELL_MS &&
                (fixT - (rec.lastNudge || rec.since)) >= PEG_DWELL_MS &&
                haversineM(rec.lat, rec.lng, recCen.lat, recCen.lng) <=
                  (recOther ? haversineM(rec.lat, rec.lng, recOther.lat, recOther.lng) : Infinity) + TIE_BAND_M) {
              var rd = haversineM(recCen.lat, recCen.lng, rec.lat, rec.lng);
              if (rd > 0) {
                var rf = Math.min(DRIFT_STEP_M, rd) / rd;
                recCen.lat += (rec.lat - recCen.lat) * rf;
                recCen.lng += (rec.lng - recCen.lng) * rf;
                if (site) {
                  var rds = haversineM(site.lat, site.lng, recCen.lat, recCen.lng);
                  if (rds > site.radiusM) {
                    var rg = site.radiusM / rds;
                    recCen.lat = site.lat + (recCen.lat - site.lat) * rg;
                    recCen.lng = site.lng + (recCen.lng - site.lng) * rg;
                  }
                }
                if (inner.moveSites) inner.moveSites(cen.load, cen.dump);
                recCount++;
                rec.lastNudge = fixT;
              }
            }
          } else if (dTgtC <= PEG_FENCE_M) {
            rec = null; /* inside the fence: recovery stands down */
          }
        } else {
          rec = null; /* no waiting centre: no cluster may build */
        }
        var r = inner.ingest({
          latitude: sm.lat, longitude: sm.lng,
          accuracy: (fix.accuracy === undefined ? null : fix.accuracy),
          time: fix.time
        });
        if (!r.accepted) {
          /* the zone machine refused this fix (stale / teleport /
             inactive) — it must not linger in the centroid either */
          var ix = win.indexOf(entry);
          if (ix >= 0) win.splice(ix, 1);
          return r;
        }
        var after = inner.debug ? inner.debug() : null;
        var t = (typeof fix.time === 'number' && fix.time > 0) ? fix.time : 0;
        /* a confirmed pickup = the arm flipping on at the load
           fence; a counted dump rides the verdict itself */
        if (before && after && !before.armed && after.armed && after.zone === 'load') {
          onEvent('load', t, sm);
        }
        if (r.counted) { onEvent('dump', t, sm); rec = null; }
        return r;
      },
      stop: function () { if (inner) inner.stop(); },
      snapshot: function () {
        var s = inner ? inner.snapshot() : null;
        if (s) {
          s.pegCentres = {
            load: cen.load ? { lat: cen.load.lat, lng: cen.load.lng } : null,
            dump: cen.dump ? { lat: cen.dump.lat, lng: cen.dump.lng } : null
          };
          s.pegEvents = evLog.slice();
          s.pegRecovery = recCount; /* v300: the day's fence-recovery nudges */
        }
        return s;
      },
      count: function () { return inner ? inner.count() : 0; },
      events: function () { return inner ? inner.events() : []; },
      phase: function () { return inner ? inner.phase() : 'away'; },
      zone: function () { return inner ? inner.zone() : 'out'; },
      isActive: function () { return !!(inner && inner.isActive()); },
      debug: function () { return inner && inner.debug ? inner.debug() : null; },
      /* v284: the drift, read by the glue's persist + the suite */
      centres: function () {
        return {
          load: cen.load ? { lat: cen.load.lat, lng: cen.load.lng } : null,
          dump: cen.dump ? { lat: cen.dump.lat, lng: cen.dump.lng } : null
        };
      },
      pegEvents: function () { return evLog.slice(); },
      site: function () {
        return site ? { lat: site.lat, lng: site.lng, radiusM: site.radiusM } : null;
      }
    };
  }

  /* ---- dump-VISIT counting (v324 — COUNT-BY-DUMP-VISIT +
     SITE-EXTENT + REPEG, owner Nov 5, 2026) ----
     The owner's new counting law, stated plainly on his Nov 5
     drive: "Every time the truck visits the DUMP site, 1 load
     should be counted. Why does it matter where the load is
     being picked up from? Pickup site is just a bonus for the
     system to know the entire loop." So this counter needs NO
     load site at all: a confirmed ARRIVAL at the dump site —
     after the previous visit has closed — counts one load. The
     pickup site, when known, is passed as an "other": a dwell
     there CLOSES the visit (he went and loaded; the next dump
     arrival is a new load). A visit also closes when the truck
     leaves the site's world entirely (a fix farther than
     VISIT_SPAN_M from every site point) and — only when NO other
     site is known — when he dwells at a foreign place reached
     by road (the pit he loaded at is otherwise undiscoverable).
     SITE-EXTENT (his amendment, same day): some dump sites are
     MASSIVE — one tip face can be kilometres from another on
     the same ground, so a tight fixed radius around one peg is
     the wrong shape. The site here is a SET OF POINTS: the seed
     plus every face the truck itself proves by stopping on the
     site. Presence is VISIT_PRESENCE_M around any point. While
     a visit stands counted, a stop-cluster at a NEW face within
     VISIT_SPAN_M of the site extends the point set WITHOUT
     counting again (one visit tips once — the box is empty
     after the first tip), provided the path since leaving
     presence stayed at site speeds (VISIT_SITE_SPEED_KMH) or
     the stop is a full tip-grade dwell (LEARN_DWELL_MS): that
     continuity is how the machine knows he never left the
     ground. The same gates let a virgin face count as an
     arrival on a later visit when a load site is known (the
     pit is excluded by the others, so a long stop within span
     can only be the site's own new face). Points ride the
     snapshot, so the learned extent survives relaunches and
     re-seeds exactly like the count does.
     Discipline mirrors the house rules: bad fixes (accuracy,
     stale, teleport) are ignored ENTIRELY — never fatal, never
     building, never breaking; arrival needs a 45 s dwell with
     the standard candidate grace, so drive-bys and fence-edge
     jitter cannot count; one visit can never count twice.
     API mirrors the other counters (begin/ingest/snapshot/
     count/events/phase/zone/debug) so the glue, the persist
     and the Advanced readout treat it identically. phase():
     'at-dump' while present, 'to-load' while a counted visit
     stands open, 'away' otherwise. */
  var VISIT_PRESENCE_M = 250;   // presence radius around a site point
  var VISIT_HALO_M = 100;       // beyond presence+halo the departure
                                // clock runs; inside the halo the
                                // state simply holds (edge jitter)
  var VISIT_DEPART_MS = 60 * 1000; // sustained absence beyond the
                                // halo = he has left the face
  var VISIT_SPAN_M = 3500;      // a site point's reach: extent and
                                // arrivals chain point-to-point, so
                                // a site can grow kilometres long;
                                // a fix beyond span of EVERY point
                                // = he left the site's world
  var VISIT_CLUSTER_M = 100;    // a "stop": fixes hold within this
                                // of the cluster's running centroid
  var VISIT_CLUSTER_DWELL_MS = 60 * 1000; // a stop that speaks
  var VISIT_SITE_SPEED_KMH = 50; // the path between faces stayed at
                                // site speeds = he never left the
                                // ground (continuity of presence)
  var VISIT_FACE_MIN_M = 500;   // a foreign dwell must sit at least
                                // this far from every site point to
                                // close a visit (fringe is the site)
  var VISIT_SHADOW_M = VISIT_PRESENCE_M + 200; // v405 (LOADS-
                                // MISSED, round 3): the visit
                                // counter's recovery reach — the
                                // v393 shadow's band, in this
                                // machine's own terms (presence
                                // + the 200 m recovery band the
                                // peg side already trusts)

  function createDumpVisitCounter(cfg) {
    var SEED = { lat: +cfg.dump.lat, lng: +cfg.dump.lng };
    var OTHERS = [];
    var CFG_LEARNED = (cfg && Array.isArray(cfg.learnedOthers))
      ? cfg.learnedOthers.filter(isCoord).map(function (o) { return { lat: +o.lat, lng: +o.lng }; }) : [];
    (cfg.others || []).forEach(function (o) {
      if (isCoord(o)) OTHERS.push({ lat: +o.lat, lng: +o.lng });
    });
    var accMaxM = cfg.accMaxM || ACC_MAX_M;
    var dwellMs = cfg.dwellMs || DWELL_MS;
    var S = null;

    function nearest(list, lat, lng) {
      var best = Infinity;
      for (var i = 0; i < list.length; i++) {
        var d = haversineM(lat, lng, list[i].lat, list[i].lng);
        if (d < best) best = d;
      }
      return best;
    }
    function phaseOf() {
      if (!S) return 'away';
      return S.present ? 'at-dump' : (S.visitCounted ? 'to-load' : 'away');
    }
    /* The accumulated-dwell candidate discipline of the standard
       counter, in miniature: presence accumulates toward the bar;
       a brief excursion (<= CAND_GRACE_MS) is subtracted, never
       fatal; a longer one restarts the build. `inNow` is whether
       THIS fix is inside the candidate's zone. Returns true on
       the fix that crosses the bar. */
    function candStep(c, inNow, t, barMs) {
      if (inNow) {
        if (!c) return { since: t, gapMs: 0, awaySince: null };
        if (c.awaySince) { c.gapMs += t - c.awaySince; c.awaySince = null; }
        if (t - c.since - c.gapMs >= barMs) return 'confirm';
        return c;
      }
      if (!c) return null;
      if (!c.awaySince) c.awaySince = t;
      else if (t - c.awaySince > CAND_GRACE_MS) return null;
      return c;
    }

    /* v405: the VISIT SHADOW's accumulation — candStep's gap
       discipline plus the stop-cluster's stillness discipline.
       Presence inside the recovery reach accumulates toward the
       arrival bar, but only while the fixes hold within
       VISIT_CLUSTER_M of the candidate's running centroid: a
       queue creep at the face (the Nov 10 shape — witnessed
       presence split across the presence line by a throttled
       stream) accumulates; a drive-through's marching fixes
       restart the candidate at every step and can never build
       it. A witnessed absence chunk past the grace kills it,
       exactly as candStep's does. */
    function shadowStep(c, inNow, lat, lng, t, barMs) {
      if (inNow) {
        if (!c) return { since: t, gapMs: 0, awaySince: null, lat: lat, lng: lng, n: 1 };
        if (c.awaySince) { c.gapMs += t - c.awaySince; c.awaySince = null; }
        if (haversineM(lat, lng, c.lat, c.lng) > VISIT_CLUSTER_M) {
          return { since: t, gapMs: 0, awaySince: null, lat: lat, lng: lng, n: 1 };
        }
        c.n++; c.lat += (lat - c.lat) / c.n; c.lng += (lng - c.lng) / c.n;
        if (t - c.since - c.gapMs >= barMs) return 'confirm';
        return c;
      }
      if (!c) return null;
      if (!c.awaySince) c.awaySince = t;
      else if (t - c.awaySince > CAND_GRACE_MS) return null;
      return c;
    }

    return {
      /* marker the glue's correction logic duck-types on */
      visitMode: true,
      begin: function (key, saved) {
        S = {
          key: key, active: true, count: 0, events: [],
          points: [{ lat: SEED.lat, lng: SEED.lng }],
          auxPoints: [], othersLearned: CFG_LEARNED.slice(), pending: null,
          present: false, visitCounted: false, closes: 0, everPresent: false,
          cand: null, shCand: null, otherShCand: null, otherSeen: false, depSince: null, otherCand: null,
          cluster: null, clusterStage: 0, excMaxKmh: 0,
          lastT: 0, lastLat: null, lastLng: null,
          lastNearM: Infinity, counted: false
        };
        if (saved && saved.sitesKey === key) {
          if (typeof saved.count === 'number' && saved.count > 0) S.count = saved.count;
          if (saved.events && saved.events.length) S.events = saved.events.slice();
          if (Array.isArray(saved.points)) {
            var pts = saved.points.filter(isCoord).map(function (p) {
              return { lat: +p.lat, lng: +p.lng };
            });
            if (pts.length) S.points = pts;
          }
          if (Array.isArray(saved.auxPoints)) {
            S.auxPoints = saved.auxPoints.filter(isCoord).map(function (p) {
              return { lat: +p.lat, lng: +p.lng, aux: true };
            });
          }
          if (Array.isArray(saved.othersLearned)) {
            S.othersLearned = saved.othersLearned.filter(isCoord).map(function (p) {
              return { lat: +p.lat, lng: +p.lng };
            });
          }
          if (saved.pendingVisit && isCoord(saved.pendingVisit)) {
            S.pending = { lat: +saved.pendingVisit.lat, lng: +saved.pendingVisit.lng, t: +saved.pendingVisit.t || 0 };
            S.points.push({ lat: S.pending.lat, lng: S.pending.lng, pend: true });
          }
          S.present = !!saved.present;
          S.everPresent = !!(saved.everPresent || saved.present);
          S.visitCounted = !!saved.visitCounted;
          S.otherSeen = !!saved.otherSeen;
          if (typeof saved.closes === 'number') S.closes = saved.closes;
          if (typeof saved.lastT === 'number') S.lastT = saved.lastT;
        }
        return S.key;
      },
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
        var spdKmh = 0;
        if (S.lastLat !== null) {
          var dJump = haversineM(S.lastLat, S.lastLng, fix.latitude, fix.longitude);
          var dtH = (t - S.lastT) / 3600000;
          if (dtH > 0) {
            spdKmh = (dJump / 1000) / dtH;
            if (spdKmh > MAX_SPEED_KMH) return { accepted: false, why: 'teleport' };
          }
        }
        var lat = +fix.latitude, lng = +fix.longitude;
        S.lastT = t; S.lastLat = lat; S.lastLng = lng;
        var nearM = nearest(S.points, lat, lng);
        var otherM = Math.min(nearest(OTHERS, lat, lng), nearest(S.othersLearned, lat, lng));
        S.lastNearM = nearM;
        var inSite = nearM <= VISIT_PRESENCE_M;
        var atOther = otherM <= VISIT_PRESENCE_M;
        /* excursion speed: accumulates whenever the truck is
           OUTSIDE presence (not only after departure confirms —
           on a fast drive the confirm lands on arrival and the
           road-speed evidence would be lost, making every
           road-reached stop look site-internal). */
        if (!inSite && spdKmh > S.excMaxKmh) S.excMaxKmh = spdKmh;

        /* far exit: beyond span of every site point — the visit
           (counted or not) is over and the next arrival counts. */
        if (nearM > VISIT_SPAN_M && S.visitCounted) {
          S.visitCounted = false; S.closes++;
        }

        /* the stop-cluster: extent learning, virgin-face
           arrivals, foreign-dwell closes. A cluster holds while
           fixes stay within VISIT_CLUSTER_M of its running
           centroid; leaving the circle starts a new one. */
        var cl = S.cluster;
        if (!cl) {
          cl = S.cluster = { lat: lat, lng: lng, n: 1, since: t };
          S.clusterStage = 0;
        } else if (haversineM(lat, lng, cl.lat, cl.lng) <= VISIT_CLUSTER_M) {
          cl.n++; cl.lat += (lat - cl.lat) / cl.n; cl.lng += (lng - cl.lng) / cl.n;
        } else {
          cl = S.cluster = { lat: lat, lng: lng, n: 1, since: t };
          S.clusterStage = 0;
        }
        var clAge = t - cl.since;
        /* two-stage decision: at the cluster dwell (60 s) the
           site-internal (slow-path) cases resolve; at the LEARN
           dwell (120 s — a tip's length) the road-reached cases
           resolve. Under a steady fix stream the first look
           always lands near 60 s, so a single look would never
           see tip length. */
        var clDue = (S.clusterStage === 0 && clAge >= VISIT_CLUSTER_DWELL_MS) ||
                    (S.clusterStage === 1 && clAge >= LEARN_DWELL_MS);
        if (S.clusterStage < 2 && clDue) {
          var clNearM = nearest(S.points, cl.lat, cl.lng);
          var clOtherM = Math.min(nearest(OTHERS, cl.lat, cl.lng), nearest(S.othersLearned, cl.lat, cl.lng));
          var slowPath = S.excMaxKmh <= VISIT_SITE_SPEED_KMH;
          var tipGrade = clAge >= LEARN_DWELL_MS;
          var clFired = false;
          if (clNearM > VISIT_PRESENCE_M && clOtherM > VISIT_PRESENCE_M) {
            if (S.visitCounted && tipGrade && !OTHERS.length && !S.othersLearned.length &&
                clNearM > VISIT_FACE_MIN_M) {
              /* no load end is known and he stopped at tip
                 length far off, by any road: that stop was the
                 other end of the loop — the visit closes, and
                 the place is LEARNED as an other end (later
                 loadings there close by plain dwell). Judged
                 BEFORE the extension below: a tip-length stop
                 kilometres out is a loading, not site ground,
                 however slowly he drove to it. */
              S.visitCounted = false; S.closes++;
              S.othersLearned.push({ lat: cl.lat, lng: cl.lng });
              clFired = true;
            } else if (S.visitCounted && clNearM <= VISIT_SPAN_M && slowPath && clOtherM > VISIT_SHADOW_M) {
              /* a new face of the SAME site, reached without
                 leaving the ground: the site grows; the visit
                 does NOT count again (one visit tips once).
                 v407: a stop within the other end's own shadow
                 reach is the other end, never this site's face —
                 adopting it would zero the departure geometry
                 (see the pending branch's note). */
              S.points.push({ lat: cl.lat, lng: cl.lng });
              S.present = true; S.depSince = null; S.cand = null;
              nearM = nearest(S.points, lat, lng); S.lastNearM = nearM;
              inSite = nearM <= VISIT_PRESENCE_M;
              clFired = true;
            } else if (S.visitCounted && !slowPath && tipGrade &&
                       clNearM > VISIT_FACE_MIN_M && clNearM <= VISIT_SPAN_M &&
                       clOtherM > VISIT_SHADOW_M) {
              {
                /* a tip-length road stop mid-visit (a fuel
                   stop fits this shape as well as a face can):
                   record the spot as a STANDBY point only. It
                   proves nothing about this visit, but if a
                   later visit ARRIVES there, it counts then —
                   the face may have moved; the fuel station
                   will simply never be arrived at loaded-first
                   in the loop's rhythm. */
                S.auxPoints.push({ lat: cl.lat, lng: cl.lng, aux: true });
              }
              clFired = true;
            } else if (!S.visitCounted && !S.present && OTHERS.length &&
                       (S.closes > 0 || S.everPresent || S.otherSeen) &&
                       tipGrade && clNearM <= VISIT_FACE_MIN_M) {
              /* v405 (LOADS-MISSED round 3): a TIP-GRADE stop in
                 the dead band — beyond the pin's presence circle
                 (the block's own entry condition) but within
                 VISIT_FACE_MIN_M of it. Until now this stop was
                 witnessed by the cluster and ignored by every
                 branch: too far for presence, too near for the
                 pending rail below (whose 500 m floor guards the
                 v220 first-dwell law out on the fringe). On a
                 declared-pair day whose loop has demonstrably
                 moved, a stop of a tip's length on the declared
                 site's own ground IS the visit — the spots move
                 around the site load to load (the owner's v284
                 law), and the pin is a point, not the ground.
                 The face is adopted as a site point and the load
                 counts now, during the tip — the same landing
                 the presence arrival makes, so departure and
                 close discipline run from it unchanged. Beyond
                 VISIT_FACE_MIN_M the pending rail below keeps
                 its deferred judgment exactly as before. */
              S.points.push({ lat: cl.lat, lng: cl.lng });
              S.count++; S.visitCounted = true; S.counted = true;
              S.events.push({ t: t, site: 'dump', n: S.count });
              S.present = true; S.depSince = null; S.cand = null; S.shCand = null;
              S.excMaxKmh = 0;
              S.everPresent = true;
              nearM = nearest(S.points, lat, lng); S.lastNearM = nearM;
              inSite = nearM <= VISIT_PRESENCE_M;
              clFired = true;
            } else if (!S.visitCounted && !S.present && OTHERS.length &&
                       (S.closes > 0 || S.everPresent) &&
                       clNearM > VISIT_FACE_MIN_M && clNearM <= VISIT_SPAN_M &&
                       clOtherM > VISIT_SHADOW_M &&
                       (slowPath || tipGrade)) {
              /* a virgin face of a DECLARED site on a fresh
                 visit: the pit is excluded by the others, so a
                 qualifying stop within span can only be the
                 site's own new face. But a first dwell is not
                 proof (the v220 law): a mid-leg rival stop has
                 this exact shape. The stop becomes a PENDING
                 visit — the point joins the site on probation,
                 presence runs from it, and the count lands only
                 when the loop COMPLETES (the close at the load
                 end), credited at the stop's own time. If he
                 instead tips at a known face, the pending stop
                 was a scout and evaporates. Gated on the
                 counter having SEEN the loop move today (a
                 counted close or a presence at a known face): a
                 stop already in progress when the counter armed
                 — he was parked somewhere arbitrary when a
                 dispatch re-pinned mid-day (Nov 5's swap) — must
                 never read as an arrival. v408 (LOADS-CLOSE-
                 STARVED-NOV10): the stop must also sit beyond
                 the OTHER end's shadow reach (clOtherM) — a
                 loading dwell at the load face itself is ~2 km
                 from the dump and otherwise qualified here,
                 planting a probationary dump point ON the load
                 end; presence then read ~0 m at the load end
                 and the next leg's above-halo span fell under
                 the 60 s departure bar, strangling that
                 departure and every arrival after it. */
              if (!S.pending) {
                S.points.push({ lat: cl.lat, lng: cl.lng, pend: true });
                S.pending = { lat: cl.lat, lng: cl.lng, t: t };
              }
              S.present = true; S.depSince = null; S.cand = null;
              S.everPresent = true;
              nearM = nearest(S.points, lat, lng); S.lastNearM = nearM;
              inSite = nearM <= VISIT_PRESENCE_M;
              clFired = true;
            }
          }
          S.clusterStage = clFired ? 2 : S.clusterStage + 1;
        }

        /* arrival: sustained presence at a known face while the
           visit stands open counts the load. A standby (aux)
           point counts as a face for ARRIVAL only while the
           visit stands open — arriving there loaded promotes
           it to a full site point. */
        var atAux = !S.visitCounted &&
          nearest(S.auxPoints, lat, lng) <= VISIT_PRESENCE_M;
        /* v405 VISIT SHADOW: while the visit stands open and
           the day's loop has demonstrably moved (the same
           evidence the face-learning branches trust — a counted
           close, a dump presence, or a witnessed load-end
           dwell), presence within the recovery reach
           (VISIT_SHADOW_M) of a site point, and beyond that
           reach of the other end, accumulates toward the same
           arrival bar in parallel with the presence candidate.
           The v393 shadow healed exactly this starvation on the
           peg cycle machine; the dispatch-pin day's machine
           never got it, so a tip whose witnessed presence
           fragmented across the presence line (queue creep, a
           throttled stream) restarted the 45 s bar forever.
           Whichever candidate confirms first lands the arrival
           through the one landing path below — a visit can
           never count twice. */
        var shConfirm = false;
        if (!S.present && !S.visitCounted &&
            (S.closes > 0 || S.everPresent || S.otherSeen)) {
          var shIn = nearM <= VISIT_SHADOW_M && otherM > VISIT_SHADOW_M;
          var shStep = shadowStep(S.shCand, shIn, lat, lng, t, dwellMs);
          if (shStep === 'confirm') { shConfirm = true; S.shCand = null; }
          else S.shCand = shStep;
        } else if (S.shCand) {
          S.shCand = null;
        }
        if (!S.present) {
          var step = candStep(S.cand, (inSite || atAux) && !atOther, t, dwellMs);
          if (step === 'confirm' || shConfirm) {
            S.cand = null; S.shCand = null;
            if (!inSite && atAux) {
              var bi = -1, bd = Infinity;
              for (var ai = 0; ai < S.auxPoints.length; ai++) {
                var ad = haversineM(lat, lng, S.auxPoints[ai].lat, S.auxPoints[ai].lng);
                if (ad < bd) { bd = ad; bi = ai; }
              }
              if (bi >= 0) {
                var promoted = S.auxPoints.splice(bi, 1)[0];
                S.points.push({ lat: promoted.lat, lng: promoted.lng });
                nearM = nearest(S.points, lat, lng); S.lastNearM = nearM;
                inSite = nearM <= VISIT_PRESENCE_M;
              }
            }
            S.present = true; S.depSince = null; S.excMaxKmh = 0;
            S.everPresent = true;
            if (S.pending) {
              /* an arrival settles the pending stop: AT the
                 pending face it confirms it (the point stays,
                 proven); at a KNOWN face the pending stop was a
                 scout — its point comes back off the site. */
              var atPend = haversineM(lat, lng, S.pending.lat, S.pending.lng) <= VISIT_PRESENCE_M;
              for (var ppi = S.points.length - 1; ppi >= 0; ppi--) {
                if (!S.points[ppi].pend) continue;
                if (atPend) delete S.points[ppi].pend;
                else S.points.splice(ppi, 1);
              }
              S.pending = null;
            }
            if (!S.visitCounted) {
              S.count++; S.visitCounted = true; S.counted = true;
              S.events.push({ t: t, site: 'dump', n: S.count });
            }
          } else {
            S.cand = step;
          }
        } else if (inSite) {
          S.cand = null;
        }

        /* departure: sustained absence beyond the halo. Fixes in
           the halo band hold the state (edge jitter at big
           yards is normal). */
        if (S.present) {
          if (nearM > VISIT_PRESENCE_M + VISIT_HALO_M) {
            if (!S.depSince) S.depSince = t;
            else if (t - S.depSince >= VISIT_DEPART_MS) {
              /* excMaxKmh is NOT reset here: the excursion's
                 road speed is the evidence the cluster decision
                 judges by (resetting it on departure-confirm
                 made every road-reached stop look site-internal).
                 It resets when presence is regained. */
              S.present = false; S.depSince = null;
            }
          } else {
            S.depSince = null;
          }
        }

        /* the other end of the loop: a dwell at a known other
           site closes the visit (he loaded; the next dump
           arrival is a new load). */
        /* v408 (LOADS-CLOSE-STARVED-NOV10): the close gains the
           arrival shadow's recovery reach. The plain close below
           judges only presence within 250 m of the other end;
           when the loading face sits a few hundred metres off
           the peg (the excavator moved along the cut), the close
           never built, visitCounted never cleared, and every
           later dump arrival read as the same visit — Nov 10's
           GPS counting stopped dead after load #2 and never
           resumed. A still dwell within VISIT_SHADOW_M of a
           known other end, beyond that reach of every site
           point, now accumulates toward the same close under
           the shadow's own discipline (fixes holding one stop
           cluster, absence chunks forgiven to the grace). The
           far exit cannot substitute: VISIT_SPAN_M (3500 m)
           exceeds a whole loop. An early close can only re-arm
           — under the visit law the next genuine arrival IS a
           new load — so the wide reach is safe here exactly as
           it was for arrivals in v405. */
        var oshConfirm = false;
        if (!S.present) {
          var oshStep = shadowStep(S.otherShCand,
            otherM <= VISIT_SHADOW_M && nearM > VISIT_SHADOW_M, lat, lng, t, dwellMs);
          if (oshStep === 'confirm') { oshConfirm = true; S.otherShCand = null; }
          else S.otherShCand = oshStep;
        } else if (S.otherShCand) {
          S.otherShCand = null;
        }
        var oStep = candStep(S.otherCand, atOther && !inSite, t, dwellMs);
        if (oStep === 'confirm' || oshConfirm) {
          S.otherCand = null;
          S.otherSeen = true; /* v405: a witnessed load-end dwell
             is the loop moving — the wide-reach judgments (the
             visit shadow, the dead-band face) trust it as such
             even when no visit stood open to close. */
          if (S.pending) {
            /* the loop completed: the pending stop WAS a tip
               at the site's new face — it counts now, at its
               own time, and its point is a proven face. */
            S.count++;
            S.events.push({ t: S.pending.t, site: 'dump', n: S.count });
            S.counted = true;
            for (var cpi = 0; cpi < S.points.length; cpi++) {
              if (S.points[cpi].pend) delete S.points[cpi].pend;
            }
            S.pending = null;
            S.closes++;
          }
          if (S.visitCounted) { S.visitCounted = false; S.closes++; }
        } else {
          S.otherCand = oStep;
        }

        return {
          accepted: true, zone: inSite ? 'dump' : 'out',
          confirmed: S.present ? 'dump' : 'out', phase: phaseOf(),
          counted: S.counted, count: S.count
        };
      },
      stop: function () { if (S) S.active = false; },
      snapshot: function () {
        if (!S) return null;
        return {
          sitesKey: S.key, count: S.count, events: S.events.slice(),
          points: S.points.filter(function (p) { return !p.pend; }).map(function (p) { return { lat: p.lat, lng: p.lng }; }),
          auxPoints: S.auxPoints.map(function (p) { return { lat: p.lat, lng: p.lng, aux: true }; }),
          othersLearned: S.othersLearned.map(function (p) { return { lat: p.lat, lng: p.lng }; }),
          pendingVisit: S.pending ? { lat: S.pending.lat, lng: S.pending.lng, t: S.pending.t } : null,
          present: S.present, visitCounted: S.visitCounted,
          closes: S.closes, everPresent: S.everPresent, otherSeen: S.otherSeen, lastT: S.lastT,
          zone: S.present ? 'dump' : 'out', phase: phaseOf()
        };
      },
      count: function () { return S ? S.count : 0; },
      events: function () { return S ? S.events.slice() : []; },
      phase: phaseOf,
      zone: function () { return S && S.present ? 'dump' : 'out'; },
      isActive: function () { return !!(S && S.active); },
      /* the peg counter's duck-typed read (nudge/setPeg paths):
         the dump centre is the seed; the load centre is the
         first known other, when there is one. */
      centres: function () {
        return {
          load: OTHERS.length ? { lat: OTHERS[0].lat, lng: OTHERS[0].lng } : null,
          dump: { lat: SEED.lat, lng: SEED.lng }
        };
      },
      debug: function () {
        if (!S) return null;
        return {
          mode: 'dump-visit', zone: S.present ? 'dump' : 'out',
          phase: phaseOf(), count: S.count,
          points: S.points.length, present: S.present,
          visitCounted: S.visitCounted, closes: S.closes,
          nearestM: (S.lastNearM === Infinity) ? null : Math.round(S.lastNearM),
          candSince: S.cand ? S.cand.since : null, lastT: S.lastT
        };
      }
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
      /* v268: read-only live state for the Advanced readout —
         the snapshot fields plus the half-built dwell cluster a
         snapshot deliberately drops (the readout's "current stop
         building" line needs its start time). */
      debug: function () {
        if (!S) return null;
        return {
          zone: S.zone, atLoad: S.atLoad, legArmed: S.legArmed,
          learned: S.learned ? { lat: S.learned.lat, lng: S.learned.lng, t: S.learned.t } : null,
          locked: S.locked, ambiguous: S.ambiguous, altDone: S.altDone, lastT: S.lastT,
          clusterSince: S.cluster ? S.cluster.since : null,
          clusterLat: S.cluster ? S.cluster.sumLat / S.cluster.n : null,
          clusterLng: S.cluster ? S.cluster.sumLng / S.cluster.n : null,
          zoneCandZone: S.zoneCand ? S.zoneCand.zone : null
        };
      },
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
    function freshIntra() {
      return { a: null, b: null, visits: 0, cycles: 0, lastSub: null, visitTs: [], dead: false, sub: null };
    }

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
        S.candVisits = 0; // v267: an anchor return breaks any hub signature
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
        S.candVisits++;
        if (S.lastPlace !== 'cand') { S.visits++; S.visitTs.push(place.t); }
        S.lastPlace = 'cand';
        /* v267 (LOAD-COUNT-DEAD): the candidate has become the
           day's HUB — it has now been confirmed three times while
           NO cycle has ever closed back at the anchor. That is
           the signature of a mis-anchored day: the "anchor" was
           an en-route stop (fuel, coffee — a real 2-minute dwell
           before the pit), the candidate is the pit itself, and
           the truck's whole cycle plays out inside the
           candidate's own area. With the anchor left where it
           was, cycles could never close (they close only AT the
           anchor), intra stayed suppressed (it never runs while
           a candidate exists), and the day counted ZERO forever.
           A LEARNED anchor that the driving itself refutes is
           reassigned to the hub; the day then proceeds exactly
           like a day anchored at the pit — the two-cycle proof
           itself is untouched, and a SEEDED anchor (the
           dispatch's own pin: the app's knowledge, not a guess)
           is never reassigned. A normal two-site day can never
           reach this: its candidate is confirmed at most once
           per cycle and every return to the pit resets the
           signature. */
        if (!S.anchorSeeded && S.cycles === 0 && S.candVisits >= 3) {
          S.anchor = S.cand;
          S.cand = null;
          S.visits = 0;
          S.visitTs = [];
          S.candVisits = 0;
          S.lastPlace = 'anchor';
          S.intra = freshIntra();
          res.reassigned = S.anchor;
        }
        return;
      }
      if (dA < LEARN_MIN_SEP_M) return; // too close to call a second site — no-man's land
      if (!S.cand) {
        S.cand = place;
        S.visits = 1;
        S.visitTs = [place.t];
        S.candVisits = 1; // v267: the setting confirmation is the hub signature's first count
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
      /* v267 (LOAD-COUNT-DEAD): a fix too rough for intra work is
         IGNORED — it neither builds nor breaks the sub-cluster.
         The old code RESET the cluster on any such fix, so one
         accuracy spike (45 m in the cab, a null-accuracy fix)
         zeroed a 2-minute dwell build; under any realistic fix
         wobble a sub-spot could never confirm and same-place days
         counted ZERO all day while 'learning' (Oct 26, 2026).
         This is the discipline the rest of the engine already
         states for bad fixes (the counter: ignored ENTIRELY).
         Movement is still caught: the next GOOD fix landing away
         from the centroid restarts the cluster by distance. */
      if (fix.accuracy === null || fix.accuracy === undefined || fix.accuracy > INTRA_ACC_MAX_M) { return; }
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
          candVisits: 0, anchorSeeded: !!SEED,
          intra: freshIntra()
        };
        if (saved && typeof saved === 'object') {
          if (saved.anchor && isCoord(saved.anchor)) {
            S.anchor = placeOf(saved.anchor);
            if (S.lastPlace === null) S.lastPlace = 'anchor';
          }
          if (saved.cand && isCoord(saved.cand)) S.cand = placeOf(saved.cand);
          if (typeof saved.visits === 'number') S.visits = saved.visits;
          if (typeof saved.cycles === 'number') S.cycles = saved.cycles;
          if (typeof saved.candVisits === 'number') S.candVisits = saved.candVisits;
          if (typeof saved.anchorSeeded === 'boolean') S.anchorSeeded = saved.anchorSeeded;
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
      /* v268: read-only live state for the Advanced readout —
         the snapshot fields plus the half-built clusters a
         snapshot deliberately drops (outer dwell + intra
         sub-spot), whose start times are the readout's "current
         stop building" progress. */
      debug: function () {
        if (!S) return null;
        return {
          anchor: S.anchor ? placeOf(S.anchor) : null,
          cand: S.cand ? placeOf(S.cand) : null,
          visits: S.visits, cycles: S.cycles, lastPlace: S.lastPlace,
          candVisits: S.candVisits, anchorSeeded: S.anchorSeeded,
          intraA: S.intra.a ? placeOf(S.intra.a) : null,
          intraB: S.intra.b ? placeOf(S.intra.b) : null,
          intraVisits: S.intra.visits, intraCycles: S.intra.cycles,
          intraDead: S.intra.dead,
          pair: S.pair ? { load: placeOf(S.pair.load), dump: placeOf(S.pair.dump), intra: !!S.pair.intra } : null,
          locked: S.locked, ambiguous: S.ambiguous, lastT: S.lastT,
          clusterSince: S.cluster ? S.cluster.since : null,
          clusterConfirmed: !!(S.cluster && S.cluster.confirmed),
          intraSubSince: (S.intra && S.intra.sub) ? S.intra.sub.since : null,
          intraSubConfirmed: !!(S.intra && S.intra.sub && S.intra.sub.confirmed)
        };
      },
      snapshot: function () {
        if (!S) return null;
        return {
          anchor: S.anchor ? placeOf(S.anchor) : null,
          cand: S.cand ? placeOf(S.cand) : null,
          visits: S.visits, cycles: S.cycles, lastPlace: S.lastPlace,
          candVisits: S.candVisits, anchorSeeded: S.anchorSeeded,
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
    createPegCounter: createPegCounter,
    createDumpVisitCounter: createDumpVisitCounter,
    createDumpLearner: createDumpLearner,
    createPatternLearner: createPatternLearner,
    RADIUS_M: RADIUS_M, DWELL_MS: DWELL_MS, DEPART_MS: DEPART_MS,
    ACC_MAX_M: ACC_MAX_M, MIN_SITE_SEP_M: MIN_SITE_SEP_M,
    LEARN_DWELL_MS: LEARN_DWELL_MS, LEARN_MIN_SEP_M: LEARN_MIN_SEP_M,
    LEARN_CLUSTER_M: LEARN_CLUSTER_M, CONTEST_SEP_M: CONTEST_SEP_M,
    INTRA_CLUSTER_M: INTRA_CLUSTER_M, INTRA_SEP_M: INTRA_SEP_M,
    INTRA_ACC_MAX_M: INTRA_ACC_MAX_M, INTRA_RADIUS_M: INTRA_RADIUS_M,
    PEG_WINDOW: PEG_WINDOW, PEG_DWELL_MS: PEG_DWELL_MS,
    PEG_FENCE_M: PEG_FENCE_M, DRIFT_STEP_M: DRIFT_STEP_M,
    VISIT_PRESENCE_M: VISIT_PRESENCE_M, VISIT_HALO_M: VISIT_HALO_M,
    VISIT_DEPART_MS: VISIT_DEPART_MS, VISIT_SPAN_M: VISIT_SPAN_M,
    VISIT_CLUSTER_M: VISIT_CLUSTER_M,
    VISIT_CLUSTER_DWELL_MS: VISIT_CLUSTER_DWELL_MS,
    VISIT_SITE_SPEED_KMH: VISIT_SITE_SPEED_KMH,
    VISIT_FACE_MIN_M: VISIT_FACE_MIN_M,
    TIE_BAND_M: TIE_BAND_M, TIE_MIN_DIST_M: TIE_MIN_DIST_M,
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
                                 pegs: { load: {lat,lng,t} | null,
                                         dump: {lat,lng,t} | null }
                                          (v282 — LOADS-SITE-PEGS:
                                          the driver's own declared
                                          sites for the day),
                                 pegLog: [{ kind, t, lat, lng }]
                                          (v282 — every peg set /
                                          re-peg, in order — the
                                          day's peg moves; v283 —
                                          lat/lng ride each move so
                                          the Manifest can name every
                                          pegged place; entries logged
                                          before v283 carry kind + t
                                          only),
                                 pegEvents: [{ kind, t, lat, lng }]
                                          (v284 — every COUNTED peg
                                          event with where it happened:
                                          the centres' drift trail,
                                          read by the Manifest),
                                 pegCentres: { load: {lat,lng} | null,
                                               dump: {lat,lng} | null }
                                          (v284 — the roles' current
                                          drifted centres; the seeds
                                          themselves stay in pegs),
                                 countSource: 'pegs' (v282 — set
                                          while the day's counter is
                                          peg-keyed; absent on
                                          inference days),
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
  /* v268: the pattern learner was seeded on a DUMP pin (the
     dump-pin-only dispatch — see configure). The pair it proves
     carries the seed as its "load" end (labels swapped, count
     true), so it must never be written to the cross-day pair
     memory, which is keyed by load site. */
  var patternSeedWasDump = false;
  /* v268: the last fix the glue fed (any path) — the Advanced
     readout's "last GPS accuracy" line reads this, nothing else
     keeps it. */
  var lastFixSeen = null;
  /* v267 (LOAD-COUNT-DEAD): teach mode's shadow — a pattern
     learner seeded on the load pin, watching ONLY for an
     intra-site pair (the one-pin same-place day the dump
     learner can never teach: its candidate must sit >= 300 m
     away, and a same-place tip never does — proven zero all
     day, Oct 26, 2026). The shadow never contests the day and
     its outer pairs are ignored: two-site days belong to the
     dump learner's teaching. */
  var shadowLearner = null;
  var curLoad = null;            // today's load site (survives curSites resets)
  var taughtOutstanding = false; // taught today; first cycle not closed yet
  var navArmDone = false; // v140: the navigated counter's lazy arm (see onFix)
  var wasDumpSinceTeach = false; // counter confirmed the dump zone since then

  /* v282 (LOADS-SITE-PEGS): the driver's own pegs for the CURRENT
     day — { load: {lat,lng,t} | null, dump: {lat,lng,t} | null }.
     The day record (rec.pegs) is the source of truth; this is its
     live mirror, reloaded by every configure() so a relaunch, a
     day roll or a reconfigure can never strand a peg the record
     holds. pegArmed: the live counter is the peg counter. */
  var pegsNow = { load: null, dump: null };
  /* v392: a pickup re-pegged at least this far from the swap
     window's dump peg is a genuinely declared pair again — the
     role-swap window closes and the cycle law resumes. Below it
     the "pair" is still one place, and no counter could separate
     its ends anyway. */
  var SWAP_PAIR_MIN_M = 20;
  var pegArmed = false;

  function normalizePegs(p) {
    var out = { load: null, dump: null };
    if (!p || typeof p !== 'object') return out;
    ['load', 'dump'].forEach(function (k) {
      var g = p[k];
      if (g && ENGINE.isCoord(g)) out[k] = { lat: +g.lat, lng: +g.lng, t: +g.t || 0 };
    });
    return out;
  }

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
    /* v324 (COUNT-BY-DUMP-VISIT): the navigated dump arms the
       VISIT counter. The old cycle counter needed an "armed"
       seed when the learner had already watched the loaded leg
       (else the carried load could not count); the visit law
       counts the ARRIVAL itself, leg or no leg, so the counter
       simply begins open — his arrival at the place he himself
       navigated to is the count. */
    var prevLearnSnap = learner ? learner.snapshot() : null;
    counter = ENGINE.createDumpVisitCounter({ dump: dump, others: [curLoad], learnedOthers: savedLearnedOthers() });
    counter.begin(key, {
      sitesKey: key, count: 0, events: [],
      points: [{ lat: dump.lat, lng: dump.lng }],
      present: false, visitCounted: false, closes: 0,
      lastT: (prevLearnSnap && prevLearnSnap.lastT) || 0
    });
    visitSource = true;
    navArmDone = true;
    learnMode = 'observe';
    /* The observe learner INHERITS the teach learner's leg state
       (it watched the load visit too) — a fresh begin would
       forget the very leg the counter was just seeded from. */
    learner = ENGINE.createDumpLearner({ load: curLoad, dump: dump });
    learner.begin(prevLearnSnap);
    /* v267: a navigated adoption ends teach mode — the shadow
       goes with it. */
    if (shadowLearner) { try { shadowLearner.stop(); } catch (e) {} shadowLearner = null; }
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
  /* v284: the same carry for the day's counted peg events — a
     re-seed or a new session starts a fresh counter, and its
     pegEvents must EXTEND the day's trail, never erase it. */
  var basePegEvents = [];
  /* v220 (owner, Oct 22, 2026 — LOADS-CORRECTION-BUTTONS): the
     driver's signed correction to the MACHINE count, carried on
     the day record as `corr`, apart from the raw machine count —
     persist() never folds it into rec.count, so it can never
     double-apply across a restart: today()/forDate() always read
     max(0, machine + corr). The hero's big −1 / +1 buttons move
     it (js/app.js); while no site pair is armed the taps keep
     their older fallback role (the session's manualLoads). */
  var corrNow = 0;
  /* v222: set by nudge() — a correction the driver made THIS page
     life is newer than any pulled record's corr and survives a
     reseed (see GeoLoads.reseedFromStore). */
  var nudgedLive = false;
  /* v323 (LOADS-DOUBLE-COUNTING, Nov 4, 2026): a +1 the driver
     taps AT the tip, while the machine is carrying (armed) and
     the truck is at the dump, marks the pending carry as
     hand-counted. If the machine then confirms THAT SAME carry
     (the dwell finally lands), the correction is retired as the
     count lands — one physical load reads once, never twice
     (proven in tools/defects-nov4-v323-test.js S6). If the truck
     instead confirms back at the LOAD face first, the mark
     clears and the tap stands as the count for the missed tip.
     The flag rides the day record (rec.handCarry) so a mid-stop
     app reload cannot resurrect the double. */
  var handCarry = false;
  var lastFeedZone = null;
  /* v324 (COUNT-BY-DUMP-VISIT): the live counter is the dump-
     visit counter (ENGINE.createDumpVisitCounter) — the day
     counts dump-site visits, not load->dump cycles. Set by
     every branch that arms it; read by persist()/today() for
     the record's countSource. taughtCloseBase is the visit
     counter's closes count at the moment a teaching armed it —
     the teaching locks when a close lands after it (the truck
     completed the loop back at the load end). */
  var visitSource = false; // v324: the day counts under the visit law (count-source label)
  var taughtCloseBase = 0;

  /* v324: places the visit counter LEARNED as the loop's other
     end today (a tip-length foreign stop on a day with no known
     load end) ride the day record, so a reconfigure re-arms with
     them instead of relearning from zero. */
  function savedLearnedOthers() {
    var r = recordFor(curDate);
    return (r && Array.isArray(r.visitOthers)) ? r.visitOthers : [];
  }

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
    rec.handCarry = handCarry ? 1 : 0; /* v323: see handCarry */
    /* v282: the day's pegs ride every persist (their source of
       truth), and a peg-keyed day is marked as one — the Manifest
       reads peg counts as the driver's declared sites, never as
       an inference the app made up. */
    rec.pegs = pegsNow;
    /* v324: a visit-counted day says so — unless the visits are
       counted off the driver's own pegs, which keep their v282
       marking (the peg is still the authority for the site). */
    if (visitSource) rec.countSource = 'dump-visit';
    else if (pegArmed) rec.countSource = 'pegs';
    rec.updatedAt = now;
    if (counter) {
      rec.count = baseCount + counter.count();
      rec.events = baseEvents.concat(counter.events());
      rec.state = counter.snapshot();
      if (rec.state && Array.isArray(rec.state.othersLearned) && rec.state.othersLearned.length) {
        rec.visitOthers = rec.state.othersLearned;
      }
      /* v284: on a peg day, the counted-event trail + the
         drifted centres ride the record too — the Manifest
         names where loading/dumping actually happened from
         them, and the trail survives re-seeds via basePegEvents. */
      if (pegArmed && counter.pegEvents) {
        rec.pegEvents = basePegEvents.concat(counter.pegEvents());
        rec.pegCentres = counter.centres ? counter.centres() : null;
      }
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
    /* v267: teach mode's shadow keeps its proof progress across
       relaunches and reconfigures, like every other learner. */
    if (shadowLearner) rec.patternShadow = shadowLearner.snapshot();
    writeDay(rec);
  }

  /* (Re)build the counter from the active dispatch's sites. Called on
     session start and again if a geocode lands mid-shift. */
  function configure() {
    var d = activeDispatch();
    curDispatchId = d ? d.id : null;
    learner = null; learnMode = null; curLoad = null;
    handCarry = false; /* v323: branches that restore corr re-read it */
    basePegEvents = [];
    visitSource = false; /* v324 */
    taughtCloseBase = 0; /* v324 */
    patternSeedWasDump = false;
    shadowLearner = null;
    taughtOutstanding = false; wasDumpSinceTeach = false;
    /* v282 (LOADS-SITE-PEGS): the driver's own pegs outrank EVERY
       inference source. When both pegs exist for the day, the
       counter keys off them and no learner runs — the pegs are
       declared ground truth, not a guess to be second-guessed,
       and they hold even on a day with no dispatch at all (the
       tap is the authority). The restore discipline is the
       armed branch's own: same key -> the counter resumes from
       its snapshot with the base carried as record − snapshot;
       a MOVED peg (new key) starts the counter fresh at zero
       with the day's whole count in the base — loads already
       counted today are never erased or recounted, and cycles
       from the new peg count from the next pickup. */
    var prevPegDay = recordFor(curDate);
    pegsNow = normalizePegs(prevPegDay && prevPegDay.pegs);
    pegArmed = false;
    /* v392 (LOADS-MISSED-AFTER-REPEG-NOV9) ROLE-SWAP WINDOW: the
       day's sites swapped roles mid-day — the pickup place became
       the dump (Nov 9: dump re-pegged 15:02 ON the standing load
       peg's ground; the pickup re-peg did not land until 16:18).
       setPeg marked the swap (pegRoleSwap) from the outgoing
       counter's own confirmed 'load' zone at that place. While
       the record pair still names that one place as BOTH ends,
       the cycle machine is the wrong tool: twin fences on one
       spot classify by jitter, and its 200 m site frame starves
       the zone machine for the whole inter-site leg, so visits
       freeze mid-candidate and dump visits vanish (two full tips
       in the Nov 9 window counted zero). The dump peg IS a
       declared dump site — the v324 VISIT law counts its visits
       until the pickup is re-pegged somewhere genuinely else
       (>= SWAP_PAIR_MIN_M away), when the cycle branch below
       takes over with the day's count banked as usual. The tip
       in progress at the swap peg itself stays the baseline
       (the v369-pinned peg-moment rule): the window counter
       begins mid-visit with that presence already spent. */
    var swapWin = false;
    if (pegsNow.load && pegsNow.dump && prevPegDay && prevPegDay.pegRoleSwap &&
        prevPegDay.pegRoleSwap.dumpT === pegsNow.dump.t) {
      var swapT = prevPegDay.pegRoleSwap.t || 0;
      var loadDeclared = (pegsNow.load.t || 0) > swapT &&
        ENGINE.haversineM(pegsNow.load.lat, pegsNow.load.lng,
          pegsNow.dump.lat, pegsNow.dump.lng) >= SWAP_PAIR_MIN_M;
      if (!loadDeclared) swapWin = true;
    }
    if (swapWin) {
      curSites = {
        load: null,
        dump: { lat: pegsNow.dump.lat, lng: pegsNow.dump.lng, label: 'Dump peg', src: 'peg' }
      };
      curLoad = null;
      var swapKey = sitesKeyFor('pegswap', curSites.dump, curSites.dump);
      var sameSwap = !!(prevPegDay && prevPegDay.sessionKey === sessionKey);
      var savedSwap = (sameSwap && prevPegDay.state && prevPegDay.state.sitesKey === swapKey) ? prevPegDay.state : null;
      var savedSwapCount = (savedSwap && typeof savedSwap.count === 'number') ? savedSwap.count : 0;
      baseCount = prevPegDay ? Math.max(0, (prevPegDay.count || 0) - savedSwapCount) : 0;
      baseEvents = (prevPegDay && prevPegDay.events && (!sameSwap || !savedSwap)) ? prevPegDay.events.slice() : [];
      corrNow = prevPegDay ? (prevPegDay.corr || 0) : 0;
      handCarry = !!(prevPegDay && prevPegDay.handCarry);
      counter = ENGINE.createDumpVisitCounter({
        dump: curSites.dump, others: [], learnedOthers: savedLearnedOthers()
      });
      var swapSaved = savedSwap;
      if (!swapSaved && lastFixSeen &&
          ENGINE.haversineM(lastFixSeen.lat, lastFixSeen.lng, curSites.dump.lat, curSites.dump.lng) <= VISIT_PRESENCE_M) {
        swapSaved = {
          sitesKey: swapKey, count: 0, events: [],
          points: [{ lat: curSites.dump.lat, lng: curSites.dump.lng }],
          present: true, visitCounted: true,
          lastT: lastFixSeen.t || 0
        };
      }
      counter.begin(swapKey, swapSaved);
      visitSource = true;
      pegArmed = true;
      persist(true);
      return true;
    }
    if (pegsNow.load && pegsNow.dump) {
      curSites = {
        load: { lat: pegsNow.load.lat, lng: pegsNow.load.lng, label: 'Pickup peg', src: 'peg' },
        dump: { lat: pegsNow.dump.lat, lng: pegsNow.dump.lng, label: 'Dump peg', src: 'peg' }
      };
      curLoad = curSites.load;
      var pegKey = sitesKeyFor('peg', curSites.load, curSites.dump);
      var samePegSession = !!(prevPegDay && prevPegDay.sessionKey === sessionKey);
      var savedPeg = (samePegSession && prevPegDay.state && prevPegDay.state.sitesKey === pegKey) ? prevPegDay.state : null;
      var savedPegCount = (savedPeg && typeof savedPeg.count === 'number') ? savedPeg.count : 0;
      baseCount = prevPegDay ? Math.max(0, (prevPegDay.count || 0) - savedPegCount) : 0;
      baseEvents = (!samePegSession && prevPegDay && prevPegDay.events) ? prevPegDay.events.slice() : [];
      /* v324 (REPEG-RESETS-LOAD-COUNT): a MOVED peg within the
         same session starts the counter fresh (its snapshot is
         keyed to the old spots), so the day's event trail folds
         into the base whole — a re-seed extends the day's story
         and count, it never restarts either. */
      if (samePegSession && !savedPeg && prevPegDay && prevPegDay.events) {
        baseEvents = prevPegDay.events.slice();
      }
      /* v284: when the counter will NOT restore the event trail
         from a snapshot (moved peg, new session), the day's
         trail so far becomes the base — a re-seed extends the
         Manifest's story, it never restarts it. */
      basePegEvents = (!savedPeg && prevPegDay && Array.isArray(prevPegDay.pegEvents)) ? prevPegDay.pegEvents.slice() : [];
      corrNow = prevPegDay ? (prevPegDay.corr || 0) : 0;
      handCarry = !!(prevPegDay && prevPegDay.handCarry); /* v323 */
      /* v324 (COUNT-BY-DUMP-VISIT — scope note): a BOTH-PEGS day
         keeps the peg cycle counter. Its contract is the owner's
         own law from v282/v284 — seeds-not-fences centres that
         follow the faces, the pegEvents trail the manifest's
         place names ride on, same-site sub-spot identity — and
         its banking already satisfies REPEG for pegs (the fold
         above). The VISIT law governs every shape where the
         cycle machine was the wrong tool: dispatch pins, a lone
         peg of either kind, taught/learned dumps, proven pattern
         pairs and navigated dumps. */
      counter = ENGINE.createPegCounter({
        load: curSites.load, dump: curSites.dump,
        /* v392: the truck's position at this (re)build — a fresh
           counter seeds its posture from it (see createPegCounter) */
        presence: lastFixSeen ? { lat: lastFixSeen.lat, lng: lastFixSeen.lng } : null,
        presenceT: lastFixSeen ? (lastFixSeen.t || 0) : 0
      });
      counter.begin(pegKey, savedPeg);
      pegArmed = true;
      persist(true);
      return true;
    }
    /* v324 (COUNT-BY-DUMP-VISIT): a LONE dump peg is a declared
       dump site — counting arms on it alone (the pickup peg is
       a bonus, never a requirement; Nov 5 his dump was pegged
       at 9:40 and the pickup not until 11:40, and the morning
       could not count). The dispatch's load pin, when there is
       one, rides as the known other end. Restore discipline is
       the peg branch's own: same key resumes, a moved peg banks
       the day's whole count in the base. */
    if (pegsNow.dump && !pegsNow.load) {
      var loneDumpSites = d ? sitesFromDispatch(d) : { load: null, dump: null };
      var loneLoad = loneDumpSites.load || null;
      curSites = {
        load: loneLoad ? { lat: loneLoad.lat, lng: loneLoad.lng, label: loneLoad.label || 'Load site', src: loneLoad.src || 'pin' } : null,
        dump: { lat: pegsNow.dump.lat, lng: pegsNow.dump.lng, label: 'Dump peg', src: 'peg' }
      };
      curLoad = curSites.load;
      var loneKey = sitesKeyFor('pegdump', curSites.load || curSites.dump, curSites.dump);
      var prevLone = prevPegDay;
      var sameLone = !!(prevLone && prevLone.sessionKey === sessionKey);
      var savedLone = (sameLone && prevLone.state && prevLone.state.sitesKey === loneKey) ? prevLone.state : null;
      var savedLoneCount = (savedLone && typeof savedLone.count === 'number') ? savedLone.count : 0;
      baseCount = prevLone ? Math.max(0, (prevLone.count || 0) - savedLoneCount) : 0;
      baseEvents = (prevLone && prevLone.events && (!sameLone || !savedLone)) ? prevLone.events.slice() : [];
      corrNow = prevLone ? (prevLone.corr || 0) : 0;
      handCarry = !!(prevLone && prevLone.handCarry); /* v323 */
      counter = ENGINE.createDumpVisitCounter({
        dump: curSites.dump,
        others: curSites.load ? [curSites.load] : [],
        learnedOthers: savedLearnedOthers()
      });
      counter.begin(loneKey, savedLone);
      visitSource = true;
      pegArmed = true;
      persist(true);
      return true;
    }
    /* v324: a LONE pickup peg with no dispatch to resolve a
       dump from — the peg is the load site and the dump is
       learned from the driving, exactly as a load-pin dispatch
       teaches (onLearned arms the visit counter). With a
       dispatch, the peg simply outranks its load pin below. */
    if (pegsNow.load && !pegsNow.dump && !d) {
      if (prevPegDay && prevPegDay.blocked === 'ambiguous-dump') {
        counter = null; curSites = null;
        return false;
      }
      curLoad = { lat: pegsNow.load.lat, lng: pegsNow.load.lng, label: 'Pickup peg', src: 'peg' };
      learnMode = 'teach';
      curSites = null;
      learner = ENGINE.createDumpLearner({ load: curLoad, dump: null });
      var prevLP = recordFor(curDate);
      var sameLP = !!(prevLP && prevLP.sessionKey === sessionKey);
      learner.begin(sameLP ? prevLP.learn : null);
      shadowLearner = ENGINE.createPatternLearner({ home: homePlace(), anchor: { lat: curLoad.lat, lng: curLoad.lng } });
      shadowLearner.begin(sameLP ? prevLP.patternShadow : null);
      /* v408 (LOADS-REPEG-RESET-NOV10): bank the day's whole
         count — a same-session fall into lone-pickup teaching
         must not zero a counted day. */
      baseCount = prevLP ? (prevLP.count || 0) : 0;
      baseEvents = (!sameLP && prevLP && prevLP.events) ? prevLP.events.slice() : [];
      corrNow = prevLP ? (prevLP.corr || 0) : 0;
      var recLP = prevLP || blankDay(curDate);
      recLP.dispatchId = null; recLP.sessionKey = sessionKey;
      recLP.sites = null; recLP.blocked = 'learning'; recLP.updatedAt = Date.now();
      recLP.learn = learner.snapshot();
      if (shadowLearner) recLP.patternShadow = shadowLearner.snapshot();
      writeDay(recLP);
      return false;
    }
    if (!d) { counter = null; curSites = null; return false; }
    var sites = sitesFromDispatch(d);
    /* v140: no pin on the record is not the end — the dispatch
       still NAMES its site, and the app already knows its places.
       A unique name match supplies the load fence. */
    if (!sites.load) {
      var named = placeByName(d.jobSite) || placeByName(d.pickup);
      if (named) sites.load = named;
    }
    /* v324: a lone pickup peg outranks the dispatch's own load
       pin (the v282 law — the driver's tap is the authority);
       the dump resolution below proceeds as usual. */
    if (pegsNow.load && !pegsNow.dump) {
      sites.load = { lat: pegsNow.load.lat, lng: pegsNow.load.lng, label: 'Pickup peg', src: 'peg' };
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

    if (why === 'one-site' && !sites.load && sites.dump &&
        !(recordFor(curDate) && recordFor(curDate).blocked === 'ambiguous-dump') &&
        !(recordFor(curDate) && recordFor(curDate).patternPair)) {
      /* v324 (COUNT-BY-DUMP-VISIT): a dispatch carrying only the
         DUMP pin DECLARES the dump site — visit counting arms on
         it alone. (v268 sent this shape to the pattern learner
         because the cycle machine needed two sites; the visit
         law does not. The labels cannot sit swapped here: the
         record's own dump fields are the declaration.) No load
         site is known, so the counter's foreign-dwell close is
         the loop's other end. An already-ambiguous day stays
         blocked, as everywhere else. A day that already PROVED
         a pattern pair (the same-place shape, whose sub-spots
         presence geometry cannot separate) is not this branch's:
         it falls through to the pattern path's restore below. */
      curSites = { load: null, dump: sites.dump };
      curLoad = null;
      var vKey = sitesKeyFor(d.id, sites.dump, sites.dump);
      var prevV = recordFor(curDate);
      var sameV = !!(prevV && prevV.sessionKey === sessionKey);
      var savedV = (sameV && prevV.state && prevV.state.sitesKey === vKey) ? prevV.state : null;
      var savedVCount = (savedV && typeof savedV.count === 'number') ? savedV.count : 0;
      baseCount = prevV ? Math.max(0, (prevV.count || 0) - savedVCount) : 0;
      baseEvents = (prevV && prevV.events && (!sameV || !savedV)) ? prevV.events.slice() : [];
      corrNow = prevV ? (prevV.corr || 0) : 0;
      handCarry = !!(prevV && prevV.handCarry); /* v323 */
      counter = ENGINE.createDumpVisitCounter({ dump: sites.dump, others: [], learnedOthers: savedLearnedOthers() });
      counter.begin(vKey, savedV);
      visitSource = true;
      /* v324: the pattern learner still watches, seeded on the
         dump pin exactly as the pattern path seeds it — if the
         day proves to be a SAME-PLACE job (load and tip inside
         one place), its proven pair takes over through
         armPatternPair (which keeps the cycle counter for a
         dump-seeded pair: presence geometry cannot separate
         sub-spots, the pair proof can). On a two-site day the
         visit counter simply counts first and the pair, when it
         proves, agrees with it. */
      patternSeedWasDump = true;
      learnMode = 'pattern';
      learner = ENGINE.createPatternLearner({
        home: homePlace(),
        anchor: { lat: sites.dump.lat, lng: sites.dump.lng }
      });
      learner.begin(sameV && prevV ? prevV.pattern : null);
      persist(true);
      return true;
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
        /* v268 (LOAD-COUNT-ONEPIN-AUDIT): the one-site case that
           used to join here was the DUMP-PIN-ONLY dispatch — as
           of v324 it arms the dump-VISIT counter directly (see
           the branch above configure's pattern path): the record
           declares the dump, and the visit law needs nothing
           else. What remains here is discovery for days with no
           declared dump at all. (The v268 seed-provenance flag
           below is kept for the pair memory's protection on any
           legacy record that still restores through this path.)
           one). The day still restores same-day from its own
           patternPair, like every pattern day. */
        learnMode = 'pattern';
        curSites = null;
        patternSeedWasDump = (why === 'one-site' && !sites.load && !!sites.dump);
        learner = ENGINE.createPatternLearner({
          home: homePlace(),
          anchor: (why === 'sites-too-close' && sites.load) ? { lat: sites.load.lat, lng: sites.load.lng }
            : (patternSeedWasDump ? { lat: sites.dump.lat, lng: sites.dump.lng } : null)
        });
        var prevN = recordFor(curDate);
        var sameN = !!(prevN && prevN.sessionKey === sessionKey);
        /* v408 (LOADS-REPEG-RESET-NOV10): the day's count banks
           WHOLE here too — the armed branch's own discipline. The
           old same-session zero assumed the learner's state always
           carries the day, but when a counted day falls INTO
           pattern mode mid-session (Nov 10: a pickup re-peg 126 m
           from the dump pin made the resolved pair read too-close
           and the armed visit counter was discarded), the record
           is the only place the count lives: base 0 left status()
           reading 0 for a day holding 5, and a pair proving before
           the next re-peg would have persisted 0 + credits OVER
           the banked count. A key-matching snapshot restore (the
           restoredPair path below) still overrides with
           record − snapshot, exactly as before. */
        baseCount = prevN ? (prevN.count || 0) : 0;
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
          /* v267: same-session restore hands the counter its own
             snapshot and carries the base as record − snapshot —
             the armed branch's formula — so a relaunch (his phone
             crossed five this morning) can no longer zero a
             counted day. A different session's snapshot is never
             adopted: its count rides the base whole. */
          var savedP = (sameN && prevN.state && prevN.state.sitesKey === sitesKeyFor(curDispatchId, restoredPair.load, restoredPair.dump)) ? prevN.state : null;
          if (savedP) baseCount = Math.max(0, (prevN.count || 0) - ((typeof savedP.count === 'number') ? savedP.count : 0));
          armPatternPair(restoredPair, false, savedP);
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
        /* v267 (LOAD-COUNT-DEAD): the shadow pattern learner,
           seeded on the pin, watches for the intra-site pair —
           the same-place shape teach mode otherwise cannot see
           (see the state note at shadowLearner's declaration).
           It resumes from its own persisted snapshot exactly as
           the dump learner does. */
        shadowLearner = ENGINE.createPatternLearner({ home: homePlace(), anchor: { lat: sites.load.lat, lng: sites.load.lng } });
        shadowLearner.begin(sameT ? prevT.patternShadow : null);
        /* v408 (LOADS-REPEG-RESET-NOV10): bank the day's whole
           count, as the pattern branch now does — a same-session
           fall into teach mode must not zero a counted day; the
           savedT restore below still overrides when a snapshot
           resumes the counter. */
        baseCount = prevT ? (prevT.count || 0) : 0;
        baseEvents = (!sameT && prevT && prevT.events) ? prevT.events.slice() : [];
        corrNow = prevT ? (prevT.corr || 0) : 0; // v220
        /* v267: a shadow-proven intra pair from earlier TODAY
           (the day record carries it) restores as the day's pair
           right here — the day never re-enters teach mode, the
           counter re-arms from its own snapshot, and the base
           carries record − snapshot, exactly as the pattern
           branch's restore does. Without this, a relaunch after
           a shadow arm re-taught the day from a stale shadow
           snapshot and stranded the count behind 'learning'. */
        if (prevT && prevT.patternPair && prevT.patternPair.intra &&
            prevT.patternPair.load && prevT.patternPair.dump &&
            ENGINE.isCoord(prevT.patternPair.load) && ENGINE.isCoord(prevT.patternPair.dump) &&
            ENGINE.haversineM(prevT.patternPair.load.lat, prevT.patternPair.load.lng, sites.load.lat, sites.load.lng) <= 250) {
          var rpS = { load: prevT.patternPair.load, dump: prevT.patternPair.dump, t: prevT.patternPair.t || 0, intra: true };
          if (learner) { try { learner.stop(); } catch (e) {} }
          if (shadowLearner) { try { shadowLearner.stop(); } catch (e) {} shadowLearner = null; }
          learner = ENGINE.createPatternLearner({ home: homePlace(), anchor: { lat: rpS.load.lat, lng: rpS.load.lng } });
          learnMode = 'pattern';
          learner.begin({ anchor: rpS.load, pair: rpS });
          var savedT = (sameT && prevT.state && prevT.state.sitesKey === sitesKeyFor(curDispatchId, rpS.load, rpS.dump)) ? prevT.state : null;
          if (savedT) baseCount = Math.max(0, (prevT.count || 0) - ((typeof savedT.count === 'number') ? savedT.count : 0));
          armPatternPair(rpS, false, savedT);
          return true;
        }
        /* v140: he may ALREADY have navigated to today's dump
           (the tap is recorded before the drive) — adopt it now
           and the day counts from the first load, no teaching. */
        if (maybeAdoptNavigatedDump()) return true;
        var recT = prevT || blankDay(curDate);
        recT.dispatchId = d.id; recT.sessionKey = sessionKey;
        recT.sites = null; recT.blocked = 'learning'; recT.updatedAt = Date.now();
        recT.learn = learner.snapshot();
        if (shadowLearner) recT.patternShadow = shadowLearner.snapshot();
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
       after a relaunch (record 3, snapshot 0, base zeroed).
       v324 (REPEG-RESETS-LOAD-COUNT): the subtraction is now
       gated on the snapshot's KEY matching the sites being
       armed. begin() restores a snapshot only when its key
       matches — so when the sites MOVED mid-session (his
       Nov 5 role swap: the dispatch's pins changed under a
       running session), the old code subtracted the snapshot's
       count from the base AND the fresh counter started at
       zero: the loads the session itself had counted vanished
       from the day (his recording: 5 -> 0, then a climb as new
       cycles landed). A key mismatch now banks the record's
       WHOLE count in the base and folds the day's event trail
       in with it — the count belongs to the day, not the pegs. */
    var savedKeyMatch = !!(saved && saved.sitesKey === key);
    var savedCount = (savedKeyMatch && typeof saved.count === 'number') ? saved.count : 0;
    baseCount = prev ? Math.max(0, (prev.count || 0) - savedCount) : 0;
    baseEvents = (!sameSession && prev && prev.events) ? prev.events.slice() : [];
    if (sameSession && !savedKeyMatch && prev && prev.events) {
      baseEvents = prev.events.slice();
    }
    corrNow = prev ? (prev.corr || 0) : 0; // v220: the day's correction survives restarts
    handCarry = !!(prev && prev.handCarry); /* v323 */
    /* v324 (COUNT-BY-DUMP-VISIT): with both sites resolved, the
       day counts DUMP VISITS — the load site rides as the known
       other end (a dwell there closes the visit), never as a
       required half of a cycle. */
    counter = ENGINE.createDumpVisitCounter({ dump: sites.dump, others: [sites.load], learnedOthers: savedLearnedOthers() });
    counter.begin(key, saved);
    visitSource = true;
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
    /* v267: the dump learner taught — teach mode's shadow has
       no more say in the day. */
    if (shadowLearner) { try { shadowLearner.stop(); } catch (e) {} shadowLearner = null; }
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
    /* v324 (COUNT-BY-DUMP-VISIT): the teaching cycle IS a dump
       visit — the visit counter begins with it counted, the
       truck present at the taught face, and the visit standing
       open until it closes (the load-end dwell in feedFix,
       which is also the v220 lock that earns the pair memory).
       taughtCloseBase pins the closes count at this moment so
       feedFix can tell the FIRST close after teaching. */
    counter = ENGINE.createDumpVisitCounter({ dump: dump, others: [curLoad], learnedOthers: savedLearnedOthers() });
    counter.begin(key, {
      sitesKey: key, count: 1,
      events: [{ t: cand.t, site: 'dump', n: 1 }],
      points: [{ lat: dump.lat, lng: dump.lng }],
      present: true, visitCounted: true, closes: 0, lastT: cand.t
    });
    visitSource = true;
    taughtCloseBase = 0;
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
  function armPatternPair(pair, credit, savedState) {
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
    if (credit && !pair.intra && !patternSeedWasDump) {
      rememberPair(load, { lat: dump.lat, lng: dump.lng, label: '', learnedAt: Date.now() });
    }
    var key = sitesKeyFor(curDispatchId, load, dump);
    /* v324 (COUNT-BY-DUMP-VISIT): a proven OUTER pair continues
       the day under the visit law — the pair's dump is the
       visit counter's seed, its load the known other end, and
       the proven cycles ride in as the counter's own count
       (the truck stands at the load anchor as the second cycle
       closes, so the visit stands open). Two shapes keep the
       cycle counter, unchanged: INTRA pairs (sub-spots metres
       apart inside one site — presence geometry cannot tell
       them apart) and pairs whose seed was the DUMP pin (the
       labels may sit swapped there; the cycle closes at the
       seed either way, a visit counter would count the wrong
       place's arrivals). */
    var visitShape = !pair.intra && !patternSeedWasDump;
    if (visitShape) {
      counter = ENGINE.createDumpVisitCounter({ dump: dump, others: [load], learnedOthers: savedLearnedOthers() });
      visitSource = true;
    } else {
      counter = ENGINE.createGeoLoadCounter({
        load: load, dump: dump,
        radiusM: pair.intra ? ENGINE.INTRA_RADIUS_M : undefined
      });
    }
    if (credit) {
      var credits = pair.credits || 1;
      var evts = (pair.events && pair.events.length) ? pair.events
        : [{ t: pair.t || Date.now(), site: 'dump', n: 1 }];
      if (visitShape) {
        counter.begin(key, {
          sitesKey: key, count: credits, events: evts,
          points: [{ lat: dump.lat, lng: dump.lng }],
          present: false, visitCounted: false, closes: 0,
          lastT: pair.t || 0
        });
      } else {
        counter.begin(key, {
          sitesKey: key, zone: 'load', phase: 'at-load', armed: true,
          count: credits, events: evts, lastT: pair.t || 0
        });
      }
      taughtOutstanding = false;
      wasDumpSinceTeach = false;
    } else {
      /* v267 (LOAD-COUNT-DEAD): a RESTORED pair re-arms the
         counter from the day record's own counter snapshot when
         the caller hands one over — the armed branch's long-
         standing restore discipline (base = record − snapshot).
         Beginning fresh here read the day as ZERO on every
         same-session relaunch and the next persist overwrote
         the record's real count: loads the driver watched the
         app count in the morning were gone by the afternoon
         (proven in tools/load-count-dead-v267-test.js S10). */
      counter.begin(key, savedState || null);
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
    if (shadowLearner) { try { shadowLearner.stop(); } catch (e) {} shadowLearner = null; }
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
    if (shadowLearner) { try { shadowLearner.stop(); } catch (e) {} shadowLearner = null; }
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
  /* v220: the teaching is proven — lock the learner and only
     NOW write the taught dump to the pair memory (onLearned
     deliberately withholds it: a first dwell is not proof, the
     completed loop back to the load end is). */
  function lockTeaching() {
    if (learner) learner.lock();
    taughtOutstanding = false;
    wasDumpSinceTeach = false;
    if (curLoad && curSites && curSites.dump && curSites.dump.src === 'learned') {
      var lrec = recordFor(curDate);
      rememberPair(curLoad, {
        lat: curSites.dump.lat, lng: curSites.dump.lng, label: '',
        learnedAt: (lrec && lrec.learnedDump && lrec.learnedDump.learnedAt) || Date.now()
      });
    }
  }

  function feedFix(fix) {
    var r = null;
    if (counter) {
      r = counter.ingest(fix);
      if (r.accepted && taughtOutstanding && learner) {
        if (counter.visitMode) {
          /* v324: under the visit law there is no 'load' zone to
             come back to — the proof is the visit's first CLOSE
             after the teaching (the load-end dwell inside the
             counter, a far exit, or the foreign dwell): the
             truck left the taught place and the loop stands
             completed. */
          var csT = counter.snapshot();
          if (csT && csT.closes > taughtCloseBase) lockTeaching();
        }
        else if (counter.zone() === 'dump') wasDumpSinceTeach = true;
        else if (wasDumpSinceTeach && counter.zone() === 'load') {
          // dumped, and now confirmed back at the load site: the
          // first cycle is complete — the teaching is proven.
          lockTeaching();
        }
      }
    }
    /* v323 (LOADS-DOUBLE-COUNTING): settle a hand-counted carry
       against the machine's verdict for the SAME carry. The
       machine confirming the carry retires the driver's +1 as
       the count lands (corrNow -= 1: the load reads once). The
       truck confirming back at the LOAD face first means the
       tipped load was the machine's miss — the mark clears and
       the tap stands. */
    if (r && counter) {
      if (handCarry) {
        if (r.counted) { corrNow -= 1; handCarry = false; }
        else if (r.zone === 'load' && lastFeedZone !== 'load') handCarry = false;
      }
      if (r.zone) lastFeedZone = r.zone;
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
    /* v267 (LOAD-COUNT-DEAD): teach mode's shadow (see configure).
       It is fed the same fix and may arm the counter ONLY with an
       INTRA-site pair, only while no counter exists, and only
       while the dump learner has no loaded leg outstanding — a
       truck away on a loaded leg is a two-site day until its own
       teaching says otherwise, and the shadow's proof (which by
       then predates the leg) can be picked up on a later fix via
       pair() once the leg resolves. Its outer pairs are ignored
       by design, and its contests merely silence it — the day is
       the dump learner's to judge. */
    if (shadowLearner) {
      if (counter) {
        try { shadowLearner.stop(); } catch (e) {}
        shadowLearner = null;
      } else {
        var sr = null;
        try { sr = shadowLearner.ingest(fix); } catch (e) {}
        var sp = (sr && sr.pair) || (shadowLearner.pair ? shadowLearner.pair() : null);
        if (sp && sp.intra) {
          var lSnap = null;
          try { lSnap = learner ? learner.snapshot() : null; } catch (e) {}
          if (!lSnap || !lSnap.legArmed) {
            var sh = shadowLearner;
            shadowLearner = null;
            if (learner) { try { learner.stop(); } catch (e) {} }
            learner = sh;
            learnMode = 'pattern';
            /* v267: if this pair was already credited today (the
               day record carries it — a relaunch re-entered teach
               mode and the shadow resumed with its pair), this is
               a RE-arm: restore the counter from its own snapshot
               with the base carried as record − snapshot, never
               a second credit. */
            var recNow = recordFor(curDate);
            var keyNow = sitesKeyFor(curDispatchId, sp.load, sp.dump);
            var savedSh = (recNow && recNow.patternPair && recNow.state && recNow.state.sitesKey === keyNow) ? recNow.state : null;
            if (savedSh) {
              baseCount = Math.max(0, (recNow.count || 0) - ((typeof savedSh.count === 'number') ? savedSh.count : 0));
              armPatternPair(sp, false, savedSh);
            } else {
              onPatternPair(sp);
            }
          }
        } else if ((sr && sr.contested) || shadowLearner.isAmbiguous()) {
          try { shadowLearner.stop(); } catch (e) {}
          shadowLearner = null;
        }
      }
    }
    return r;
  }

  /* v267 (LOAD-COUNT-DEAD): is the live configuration stale
     against the world as the store now shows it? Counting was
     configured once, at session start — but the world moves
     under a running session: the dispatch lands mid-shift
     (Connect, a message, his own tap — yard movement flips it
     active), is replaced, or completes. Until v267 NOTHING
     re-ran configure() on any of that, and onFix's armed guard
     returned before the day roll could run, so a session that
     started before today's dispatch existed sat disarmed for
     the whole day — fixes flowing, an active dispatch on the
     dashboard, ZERO loads, no recovery short of restarting the
     session (Oct 26, 2026). The stale check is the app's own
     source of truth: the ACTIVE dispatch (dsp_active), the same
     record configure() itself resolves and the dashboard shows. */
  var lastWorldCheckT = 0;
  function worldStale() {
    if (!counter && !learner) return true;
    var d = activeDispatch();
    return (d ? d.id : null) !== curDispatchId;
  }

  function onFix(fix) {
    if (!watching) return null;
    /* v268: the readout's last-fix line (accuracy + time). */
    if (fix && isFinite(fix.latitude) && isFinite(fix.longitude)) {
      lastFixSeen = {
        lat: +fix.latitude, lng: +fix.longitude,
        accuracy: (fix.accuracy === null || fix.accuracy === undefined) ? null : +fix.accuracy,
        t: (typeof fix.time === 'number' && fix.time > 0) ? fix.time : Date.now()
      };
    }
    var ft0 = (fix && typeof fix.time === 'number' && fix.time > 0) ? fix.time : Date.now();
    /* v267: the day roll and the world check run BEFORE the
       armed guard. A dump event belongs to the date it happened
       on, so a fix is fed to ITS day's machines: the roll comes
       first, then the feed. A disarmed watcher still rolls (a
       session that crossed midnight — or a stale session whose
       key names yesterday — re-arms on the new day's dispatch
       instead of guarding itself out forever). */
    var fd = dateStrOf(ft0);
    if (fd !== curDate) {
      persist(true);
      curDate = fd;
      configure();
    } else if (worldStale() && ft0 - lastWorldCheckT > 15000) {
      lastWorldCheckT = ft0;
      configure();
    }
    if (!counter && !learner) return null;
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
    /* v267: the midnight roll used to live here, after the feed —
       it now runs at the top of onFix, before the feed, so the
       fix is counted by its own day's machines (see above). */
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
      if (watching && sessionKey === key) {
        /* v267 (LOAD-COUNT-DEAD): a same-key reattach (sign-in,
           first-pull settle) is also a world check — if the
           dispatch landed while this session was already running
           (or the boot configure read a store the pull had not
           settled yet), re-resolve NOW instead of leaving the
           day disarmed until a fix happens to drive the onFix
           check. worldStale reads the same dsp_active the
           dashboard shows. */
        if (worldStale()) configure();
        return !!counter;
      }
      sessionKey = key;
      curDate = dateStrOf(parseInt(String(key).slice(1), 10) || Date.now());
      watching = true;
      return configure();
    },

    stopDay: function () {
      if (sessionKey) persist(true);
      if (counter) counter.stop();
      if (learner) learner.stop();
      if (shadowLearner) { try { shadowLearner.stop(); } catch (e) {} }
      watching = false;
      sessionKey = null;
      counter = null;
      learner = null;
      shadowLearner = null;
      learnMode = null;
      patternSeedWasDump = false;
      curSites = null;
      curLoad = null;
      pegsNow = { load: null, dump: null };
      pegArmed = false;
      visitSource = false; /* v324 */
      taughtCloseBase = 0; /* v324 */
      taughtOutstanding = false;
      wasDumpSinceTeach = false;
      navArmDone = false;
      baseCount = 0;
      baseEvents = [];
      corrNow = 0;
      handCarry = false; /* v323 */
      lastFeedZone = null;
      nudgedLive = false;
    },

    flush: function () { if (sessionKey) persist(true); },

    /* v63 (native v34): feed NATIVE-SERVICE breadcrumbs (recorded
       while the app was backgrounded or dead) through the very same
       fix path as live fixes — same dwell/depart rules, same midnight
       roll-over. The counter ignores fixes at or before the last one
       it saw, so crumbs that overlap the live stream can never
       double-count a cycle. Returns how many fixes were accepted. */
    ingestNativeCrumbs: function (crumbs) {
      if (!watching || !crumbs || !crumbs.length) return 0;
      /* v267 (LOAD-COUNT-DEAD): crumbs must never be acked away
         unfolded just because counting is momentarily disarmed —
         the drain (js/shifttrack.js) deletes them from the
         native file either way. Run the same roll/world check
         onFix runs, once, up front: a dispatch that landed
         while the app was dead arms counting BEFORE the replay,
         so the cycles the native service watched in the dark
         still count. (When disarmed there is no old-day machine
         state to flush, so configure() can run directly.) */
      if (!counter && !learner) {
        var t0c = +crumbs[0].t || Date.now();
        if (dateStrOf(t0c) !== curDate) { curDate = dateStrOf(t0c); configure(); }
        else if (worldStale()) configure();
        if (!counter && !learner) return 0;
      }
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
        navDump: rec.navDump || null,
        /* v282: the peg facts ride the Manifest's read — the pegs
           themselves and every peg move, plus the countSource
           marking ('pegs' on a peg-counted day). */
        pegs: rec.pegs ? normalizePegs(rec.pegs) : null,
        pegLog: rec.pegLog || null,
        /* v284: the counted-event trail + drifted centres ride
           the same read (the Manifest reads the record directly;
           this keeps the data layer's surface complete). */
        pegEvents: rec.pegEvents || null,
        pegCentres: rec.pegCentres || null,
        countSource: rec.countSource || null
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
        armed: !!(rec && rec.sites),
        countSource: rec ? (rec.countSource || null) : null
      };
      if (watching && curDate === date) {
        out.armed = !!counter;
        if (counter) {
          out.count = Math.max(0, baseCount + counter.count() + corrNow);
          out.corr = corrNow;
          out.sites = curSites || out.sites;
          out.blocked = null;
          if (visitSource) out.countSource = 'dump-visit'; // v324
          else if (pegArmed) out.countSource = 'pegs'; // v282
        }
      }
      return out;
    },

    /* v268 (LOAD-COUNT-ONEPIN-AUDIT): the live learner readout
       behind Preferences -> Advanced, "Load counter — status".
       It reads the SAME objects the engine counts from — the
       counter, the learner, the teach-mode shadow, the day
       record — no parallel bookkeeping. Until now the learner's
       state (anchor, candidate, cycles closed, a contest, the
       stop currently building) existed only inside the engine
       and the persisted snapshots; the UI showed none of it, so
       a blind day was undiagnosable from the phone. One
       screenshot of this block names the state. */
    status: function () {
      var rec = curDate ? recordFor(curDate) : null;
      var out = {
        watching: watching,
        date: curDate,
        dispatchId: curDispatchId,
        mode: learnMode || (counter ? 'armed' : null),
        armed: !!counter,
        blocked: rec ? (rec.blocked || null) : null,
        seedWasDump: patternSeedWasDump,
        sites: curSites ? {
          load: curSites.load ? { lat: curSites.load.lat, lng: curSites.load.lng, src: curSites.load.src || '' } : null,
          dump: curSites.dump ? { lat: curSites.dump.lat, lng: curSites.dump.lng, src: curSites.dump.src || '' } : null
        } : null,
        count: baseCount + (counter ? counter.count() : 0),
        corr: corrNow,
        counter: (counter && counter.debug) ? counter.debug() : null,
        learn: (learner && learner.debug) ? learner.debug() : null,
        shadow: (shadowLearner && shadowLearner.debug) ? shadowLearner.debug() : null,
        contested: (rec && rec.dumpContested) ? rec.dumpContested : null,
        anchor: null, cand: null, cycles: null, visits: null,
        dwellMs: null, dwellKind: null,
        lastFixAccuracy: lastFixSeen ? lastFixSeen.accuracy : null,
        lastFixT: lastFixSeen ? lastFixSeen.t : null
      };
      /* Pattern state (the live learner in pattern mode, else
         teach mode's shadow) promoted to the top level — the
         readout's anchor / candidate / proof lines. */
      var P = null;
      if (out.learn && typeof out.learn.cycles === 'number') P = out.learn;
      else if (out.shadow && typeof out.shadow.cycles === 'number') P = out.shadow;
      if (P) {
        out.anchor = P.anchor || null;
        out.cand = P.cand || null;
        out.cycles = P.cycles;
        out.visits = P.visits;
      }
      /* Dwell progress: the longest-running unconfirmed build —
         a counter zone candidate (45 s bar), a learner place
         cluster (2 min bar), an intra sub-spot (2 min bar). */
      if (lastFixSeen) {
        var dw = [];
        if (out.counter && out.counter.candSince) dw.push({ kind: 'zone', ms: lastFixSeen.t - out.counter.candSince });
        [out.learn, out.shadow].forEach(function (L) {
          if (!L) return;
          if (L.clusterSince && !L.clusterConfirmed) dw.push({ kind: 'place', ms: lastFixSeen.t - L.clusterSince });
          if (L.intraSubSince && !L.intraSubConfirmed) dw.push({ kind: 'sub-spot', ms: lastFixSeen.t - L.intraSubSince });
        });
        dw.sort(function (a, b) { return b.ms - a.ms; });
        if (dw.length && dw[0].ms >= 0) { out.dwellMs = dw[0].ms; out.dwellKind = dw[0].kind; }
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
      nudgedLive = true; // v222: a live correction outranks a pulled record's older corr on reseed
      corrNow += (parseInt(delta, 10) || 0);
      /* v323: a +1 tapped while carrying, with the truck at the
         dump (within 120 m of the dump centre), marks the pending
         carry hand-counted — see the handCarry note above. */
      if ((parseInt(delta, 10) || 0) > 0 && counter && lastFixSeen &&
          typeof counter.phase === 'function' && counter.phase() === 'to-dump') {
        var hcCen = null;
        try { var hcAll = counter.centres ? counter.centres() : null; hcCen = hcAll && hcAll.dump; } catch (e) {}
        var hcPt = hcCen || (curSites && curSites.dump);
        /* v369 (LOAD-NOT-COUNTED-AFTER-BOTH-PEGGED-NOV7): the mark
           gate is the counter's own REACH at this dump. A peg
           counter judges arrivals out to its fence plus the
           recovery band (a face 70-200 m off the centre is still
           this dump, walked in by recovery) — a +1 tapped at such
           a face IS a tap for the pending carry, and the old flat
           120 m gate left it unmarked, so the machine firing late
           for that same visit would STACK on the driver's tap
           (his Nov 7 load 3 was exactly such a hand count). The
           standard counter's reach is its 120 m fence, unchanged. */
        var hcGate = hcCen ? (PEG_FENCE_M + RECOVERY_BAND_M) : 120;
        if (hcPt && ENGINE.haversineM(lastFixSeen.lat, lastFixSeen.lng, hcPt.lat, hcPt.lng) <= hcGate) handCarry = true;
      }
      /* v324: the same race under the visit law — a +1 tapped at
         the tip while the visit counter is standing AT the dump
         with the visit not yet counted (its arrival dwell has
         not landed) marks the pending visit hand-counted; the
         machine confirming that same arrival retires the
         correction as the count lands (feedFix, v323 path). A
         visit that already counted is not marked: a tap then is
         a genuine correction for a different, missed load and
         must stand. */
      if ((parseInt(delta, 10) || 0) > 0 && counter && counter.visitMode && lastFixSeen &&
          typeof counter.debug === 'function') {
        var vDbg = null;
        try { vDbg = counter.debug(); } catch (e) {}
        if (vDbg && !vDbg.visitCounted && vDbg.nearestM !== null &&
            vDbg.nearestM <= VISIT_PRESENCE_M) handCarry = true;
      }
      /* the buttons move the DISPLAYED count: it floors at 0, so
         the clamp lives in the correction itself — extra −1 taps
         at zero bank no invisible debt for +1 to repay first. */
      var machine = baseCount + (counter ? counter.count() : 0);
      if (machine + corrNow < 0) corrNow = -machine;
      persist(true);
      return corrNow;
    },

    /* v282 (LOADS-SITE-PEGS): plant (or move) a peg — 'load' for
       PEG PICKUP, 'dump' for PEG DUMP. The peg is HERE: the most
       recent live fix the counter's own stream produced (the
       readout's lastFixSeen), gated by the same 50 m accuracy bar
       the counter eats by — a rougher fix would plant a fence in
       the wrong place, so the tap is refused honestly ('no-fix' /
       'rough-fix') and the driver simply taps again. On success:
       the old configuration's counts are flushed into the day
       record FIRST (counted loads are never lost to a re-peg),
       the peg + the move are written on the day record, and
       configure() re-resolves — the pair arms the peg counter
       the moment both pegs exist, and a moved peg re-arms on the
       new spot with the day's banked count carried as the base.
       Only meaningful on the live day (the tracker's session);
       returns { ok, kind, t, armed } or { ok:false, why }. */
    setPeg: function (kind) {
      kind = (kind === 'dump') ? 'dump' : 'load';
      if (!watching || !curDate) return { ok: false, why: 'no-day' };
      var f = lastFixSeen;
      if (!f || !isFinite(f.lat) || !isFinite(f.lng)) return { ok: false, why: 'no-fix' };
      if (f.accuracy !== null && f.accuracy !== undefined && f.accuracy > ENGINE.ACC_MAX_M) {
        return { ok: false, why: 'rough-fix' };
      }
      persist(true);
      var rec = recordFor(curDate) || blankDay(curDate);
      var pegs = normalizePegs(rec.pegs);
      var t = (typeof f.t === 'number' && f.t > 0) ? f.t : Date.now();
      /* v392 (LOADS-MISSED-AFTER-REPEG-NOV9): ROLE-SWAP evidence.
         A dump peg planted on the standing LOAD peg's ground,
         while the machine's own books say he is AT the load place
         (confirmed zone, or a load candidate building), is a role
         swap: that place stops being the pickup and becomes the
         dump. configure() reads the mark and runs the dump-VISIT
         law there until the pickup is re-pegged somewhere else.
         A dump peg planted anywhere else — or at a place the
         machine never confirmed as the load end — marks nothing:
         a genuine same-place pair keeps the cycle law. */
      var roleSwap = false;
      if (kind === 'dump' && pegs.load && counter) {
        var oz = null, oc = null;
        try { oz = counter.zone ? counter.zone() : null; } catch (e) { oz = null; }
        try { var odbg = counter.debug ? counter.debug() : null; oc = odbg ? odbg.candZone : null; } catch (e) { oc = null; }
        if ((oz === 'load' || oc === 'load') &&
            ENGINE.haversineM(f.lat, f.lng, pegs.load.lat, pegs.load.lng) <= PEG_FENCE_M) {
          roleSwap = true;
        }
      }
      pegs[kind] = { lat: f.lat, lng: f.lng, t: t };
      rec.pegs = pegs;
      if (roleSwap) rec.pegRoleSwap = { t: t, dumpT: t };
      rec.pegLog = (Array.isArray(rec.pegLog) ? rec.pegLog : []).concat([{ kind: kind, t: t, lat: f.lat, lng: f.lng }]);
      rec.updatedAt = Date.now();
      writeDay(rec);
      pegsNow = pegs;
      configure();
      return { ok: true, kind: kind, t: t, armed: !!(pegs.load && pegs.dump) };
    },

    /* v282: the peg state for the tracker card — TIMES ONLY.
       Coordinates never leave the data layer: the card shows
       "Pickup pegged 2:14 PM" / "Dump not pegged", never a
       number pair (the owner's standing places-by-name law). */
    pegs: function () {
      var p = null;
      if (watching && curDate) {
        p = pegsNow;
      } else {
        var rec = recordFor(dateStrOf(Date.now()));
        p = normalizePegs(rec && rec.pegs);
      }
      return {
        load: p.load ? { t: p.load.t } : null,
        dump: p.dump ? { t: p.dump.t } : null,
        armed: !!pegArmed
      };
    },

    /* v222 (LOADS-RESTORE-FAIL-OCT22): re-seed the RUNNING counter
       from the persisted day record. The same reinstall trap as
       live miles: startDay at boot configures from an EMPTY store
       (fresh install, first pull not yet landed), and startDay
       thereafter no-ops for the same session key — so when the
       pull lands the day's real record (machine count + the signed
       correction), the live counter keeps showing its young zeros
       and its next persist would overwrite the restored record.
       When the record's machine count EXCEEDS the live one, adopt
       the record wholesale by re-running configure() against it —
       configure() rebuilds the counter from the record's own
       snapshot, carries the base as record-minus-snapshot, and
       restores corr from the record. A correction nudged THIS
       page life is newer than the record and is kept (then
       re-persisted). When the live count is already ahead, or no
       record exists, this is a no-op. */
    reseedFromStore: function () {
      if (!watching || !sessionKey || !curDate) return false;
      var rec = recordFor(curDate);
      if (!rec) return false;
      var liveMachine = baseCount + (counter ? counter.count() : 0);
      if (!((rec.count || 0) > liveMachine)) return false;
      var keepCorr = nudgedLive ? corrNow : null;
      configure();
      if (keepCorr !== null && corrNow !== keepCorr) {
        corrNow = keepCorr;
        persist(true);
      }
      return true;
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
