/* Meticulous — Navigator module (v77; v101 adds the drive screen)
   Turn-by-turn truck navigation on Calgary's designated truck network.
   v101: a server route can be DRIVEN in-app — a dedicated full-screen
   drive mode (3D-tilted, heading-up) with far/near spoken prompts
   through this module's existing speak()/Sound toggle.
   v103 (owner ruling, Oct 16, 2026 16:45 MDT — NO LEAVING THE APP):
   the v93 external maps handoff is DELETED (button, link builder,
   timed cascade — all of it). Turn-by-turn means OUR Drive screen:
   pick a destination and the route is requested on its own (no
   separate Route tap to reach Drive); Drive is the one big primary
   action; Truck/Car + Follow + Sound sit in one small quiet row;
   the built-in-places <select> is replaced by the Navigation
   module's shared search-first picker (recents-only by default).
   v104 (owner verdict, Oct 16, 2026 17:19 MDT — "That's not turn
   by turn"): a route that computes is not yet navigation. (1) On
   a go-now arm — a destination handed over via nav_pending (the
   Navigation→Navigate hand-off, incl. its address-search path) —
   or whenever the truck is already moving (GPS speed ≥ 2 m/s),
   a successful route ENTERS the Drive screen by itself; parked
   manual planning stays in the plan view. The entry fires once
   per destination arm: exiting Drive spends it, and no later
   re-route for the same destination can pull the driver back
   in. (2) The ▶ Drive primary is pinned at the TOP of the sheet,
   above the Destination card, so an active route's next action
   is never below the fold. (3) Route failures say what actually
   happened (server silent / server error + HTTP status / no
   route exists) — the v93-era banner that guessed at the server
   URL is gone. (4) The opening-paint balloon (a giant blue disc
   over the map in the owner's Oct 16 videos — the user-position
   circleMarker rendered during the un-settled first paint) is
   fixed by gating the first position paint on the map-settle
   pass and making that first view jump without animation.
   Routes come from a self-hosted Valhalla service whose map carries the
   City of Calgary truck-route rules (see the truck-nav build, steps 1–4):
   the truck is kept on legal streets by costing, never by hard bans —
   a Restricted street stays reachable when it is the only way in.

   The module is honest about its one dependency: the routing service.
   v98: the app shipped with the Meticulous routing server as the
   DEFAULT (NAV_DEFAULT_SERVER_URL below), so a user who had never
   saved an address routed through it out of the box.
   v137 (owner, Oct 17 12:25-12:26 MDT: the server text box in
   Preferences "is plumbing", and "if that is altered app.."): the
   address is now a BAKED-IN CONSTANT, full stop. The Preferences
   text box is gone, loadSettings ALWAYS returns the constant, and
   a serverUrl value saved by an older build (or cleared to '') is
   ignored — nothing a user can type, clear, or corrupt can steer
   or break routing anymore.

   Persists via App._store (localStorage, mt_ prefix), key 'navigator':
   { profile: {height,width,length,weight,axleLoad,axles,hazmat},
     muted: false, mode: 'truck', avatar: 'dump' }.
*/
(function () {
  'use strict';
  window.Meticulous = window.Meticulous || {};
  Meticulous.modules = Meticulous.modules || {};

  var esc = function (s) { return App._esc(s); };

  /* ================= NAVPURE-BEGIN =================
     Pure logic — no DOM, no App, no Leaflet. The node harness
     (tools/navigator-test.js) extracts this region and drives it
     against the real service fixtures. Coordinates are [lat, lon]
     everywhere except buildRouteRequest, which emits Valhalla's
     {lat, lon} location objects. */
  var NAV_DEFAULT_PROFILE = { height: 3.9, width: 2.6, length: 9.0, weight: 24, axleLoad: 10, axles: 3, hazmat: false };

  function navProfile(p) {
    var d = NAV_DEFAULT_PROFILE, o = {}, k;
    for (k in d) o[k] = d[k];
    if (p) for (k in d) {
      if (p[k] === undefined || p[k] === null || p[k] === '') continue;
      o[k] = (k === 'hazmat') ? !!p[k] : Number(p[k]);
      if (k !== 'hazmat' && !(o[k] > 0)) o[k] = d[k];
    }
    return o;
  }

  /* The exact request the service proved against in steps 3–4:
     truck costing hugs the designated network (use_truck_route 1.0)
     and prices no-access (Restricted) edges at a heavy FINITE penalty
     (100000), so a destination on such a street stays reachable. */
  function buildRouteRequest(origin, dest, profile, mode, opts) {
    var req = {
      locations: [
        { lon: origin[1], lat: origin[0], type: 'break' },
        { lon: dest[1], lat: dest[0], type: 'break' }
      ],
      costing: mode === 'car' ? 'car' : 'truck',
      directions_options: { units: 'kilometers' }
    };
    if (req.costing === 'truck') {
      var p = navProfile(profile);
      req.costing_options = {
        truck: {
          use_truck_route: 1.0,
          hgv_no_access_penalty: 100000,
          height: p.height,
          width: p.width,
          length: p.length,
          weight: p.weight,
          axle_load: p.axleLoad,
          axle_count: p.axles,
          hazmat: !!p.hazmat
        }
      };
    }
    /* v177 (F4): the route preference from the Navigator's own
       settings menu. 'fastest' (the default) adds NOTHING — the
       request stays byte-identical to the proven step-3/4 shape.
       'economical' asks Valhalla for the shortest path instead
       (its per-costing `shortest` switch: fewer kilometres,
       less fuel, possibly slower) — an honest engine-level
       preference, not a relabelled fastest route. */
    if (opts && opts.routePref === 'economical') {
      if (!req.costing_options) req.costing_options = {};
      if (!req.costing_options[req.costing]) req.costing_options[req.costing] = {};
      req.costing_options[req.costing].shortest = true;
    }
    /* v260 (NAV-NO-UTURN): two opt-in request shapes for the
       forward re-route in doRoute — absent by default, so the
       proven request above stays byte-identical unless the
       caller asks. opts.heading (degrees, finite) rides the
       ORIGIN location: Valhalla's own location heading biases
       the origin snap toward the edge direction the truck is
       already travelling, so a route can begin by continuing
       forward. opts.via ([lat,lon]) inserts a 'through'
       location between origin and destination: the trip then
       starts at the truck, passes the via point, and only
       then heads for the destination — one continuous line
       whose first leg runs forward along the current road. */
    if (opts && isFinite(opts.heading)) {
      req.locations[0].heading = Math.round(((Number(opts.heading) % 360) + 360) % 360);
    }
    if (opts && opts.via && isFinite(opts.via[0]) && isFinite(opts.via[1])) {
      req.locations.splice(1, 0, { lon: opts.via[1], lat: opts.via[0], type: 'through' });
    }
    return req;
  }

  /* v260 (NAV-NO-UTURN): the point `distM` metres from `pos`
     along bearing `headingDeg` — spherical destination point
     on the same earth radius haversineM uses. doRoute uses
     it to place the forward via point on the road ahead of
     the truck when the engine answers a truck route with a
     turn-around at the start. */
  function forwardOrigin(pos, headingDeg, distM) {
    if (!pos || !isFinite(pos[0]) || !isFinite(pos[1]) || !isFinite(headingDeg) || !(distM > 0)) return null;
    var R = 6371000, rad = Math.PI / 180;
    var d = distM / R, brg = headingDeg * rad;
    var lat1 = pos[0] * rad, lon1 = pos[1] * rad;
    var sinLat2 = Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg);
    var lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
    var lon2 = lon1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return [lat2 / rad, lon2 / rad];
  }

  /* v177 (A4/F4): the drive view mode — '3d' (the v175 chase
     perspective) or '2d' (flat heading-up). A driver OPTION in
     the Navigator settings menu, never a compulsion. Kept as a
     NAVPURE variable so planeTransform — whose call site and
     3D string are pinned by the v139 suite — stays a one-arg
     pure function of the heading; loadSettings sets this from
     the stored choice on every render. */
  var navViewMode = '3d';
  function setNavViewMode(m) { navViewMode = (m === '2d') ? '2d' : '3d'; }
  function getNavViewMode() { return navViewMode; }

  /* Valhalla shapes are precision-6 polylines. Returns [[lat,lon],…]. */
  function decodeShape(shape, precision) {
    var factor = Math.pow(10, precision || 6);
    var coords = [], lat = 0, lon = 0, i = 0, shift, val, b, delta;
    while (i < shape.length) {
      shift = 0; val = 0;
      do { b = shape.charCodeAt(i++) - 63; val |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      delta = (val & 1) ? ~(val >> 1) : (val >> 1); lat += delta;
      shift = 0; val = 0;
      do { b = shape.charCodeAt(i++) - 63; val |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      delta = (val & 1) ? ~(val >> 1) : (val >> 1); lon += delta;
      coords.push([lat / factor, lon / factor]);
    }
    return coords;
  }

  function haversineM(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /* Distance from point p to segment a–b, and how far along the
     segment the closest point sits (metres). Local planar approx —
     plenty accurate at street scale. */
  function pointSegM(p, a, b) {
    var kx = 111320 * Math.cos(p[0] * Math.PI / 180), ky = 110540;
    var px = p[1] * kx, py = p[0] * ky;
    var ax = a[1] * kx, ay = a[0] * ky, bx = b[1] * kx, by = b[0] * ky;
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    var t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    var cx = ax + t * dx, cy = ay + t * dy;
    return { dist: Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy)), along: t * Math.sqrt(len2) };
  }

  /* Closest approach of p to a whole route line: {dist, along} in
     metres from the route start. Drives both the banner countdown
     and the off-route check. */
  function distToRouteM(p, line) {
    var best = { dist: Infinity, along: 0 }, cum = 0, i, seg;
    for (i = 0; i + 1 < line.length; i++) {
      seg = pointSegM(p, line[i], line[i + 1]);
      if (seg.dist < best.dist) best = { dist: seg.dist, along: cum + seg.along };
      cum += haversineM(line[i], line[i + 1]);
    }
    return best;
  }

  /* v125: the DRIVE basemap spec. The v124 drive map drew the
     standard OSM Carto raster under a contrast(1.16) /
     saturate(1.42) CSS lift; OSM Carto colours motorways salmon
     pink natively, and the lift pushed them to the garish HOT
     PINK of the owner's Oct 17 recording (parallel carriageways
     rendered as wide pink dashed bands). The drive map now uses
     the Esri World Street Map raster — a calm, muted
     navigation-style basemap (cream land, white/grey-cased
     roads, soft park green; arterials a pale tan, never pink) —
     drawn with NO CSS filter at all. First pick was CARTO
     Voyager, but CARTO's public basemap CDN now answers every
     tile with an "API KEY REQUIRED" placeholder (verified
     against the live CDN while building this — the Fastly
     mirror serves the same placeholder), and this app ships
     keyless. Esri's tile service is keyless with attribution.
     NOTE the Esri template order: {z}/{y}/{x}. The planning
     map keeps the OSM source + its gentler lift.
     v239 (NAV-MAP-COLORS-3D, owner, Oct 23, 2026 11:36 MDT:
     "the colours on our map are abysmal"): re-measured on the
     fixed (z15) build — no keyless source beats this one
     (OSM standard measures LESS saturated on the same tiles,
     Esri World Topo is near-greyscale at z15 here; CARTO
     still demands a key). The source stays; the DRIVE tiles
     get a measured colour lift via the nv-tile-street class
     (see the layer creation in startDrive + style.css):
     home tile mean saturation 0.150 -> 0.202 simulated, the
     blank-map coverage contract untouched.
     v260 (NAV-PIXELATED-ROADS + NAV-VIBRANT-COLORS, owner,
     Oct 26, 2026 07:41 MDT, driving Peigan Trail SE: "The
     images of the road are extremely pixelated and not even
     clear" + "You have to change the colors. Something more
     vibrant"): BOTH complaints traced to this spec on live
     tile probes (Oct 26, fetched from the CDNs themselves).
     PIXELATION: the drive view runs at zoom 18 (v178) but the
     street layer was capped maxNativeZoom 15, so Leaflet
     upscaled z15 tiles 8x — the blur WAS the upscale. The z15
     cap existed (v232/v235) because Esri serves BLANK tiles
     at z17-18 over fringe areas; re-probed tile by tile:
     Esri z18 over the owner's home block = 0/9 detailed tiles,
     z17 = 3/9 — still blank-prone. OpenStreetMap standard at
     the same blocks: z18 = 9/9 detailed at home, 8/9 on
     Peigan Trail; z17 = 9/9 both. So the street source goes
     BACK to OSM standard (the v124 source) — but this time at
     NATIVE z18 (spec.maxNative below; paintDriveLayers reads
     it), so nothing is upscaled on the street layer at all.
     VIBRANCY: OSM raw measures pale (mean saturation 0.052 on
     his suburb tiles, 0.111 over Deerfoot/Bow), so the street
     layer's CSS lift is re-tuned for THIS source in style.css
     (.nv-tile-street): saturate(2.3) hue-rotate(11deg)
     contrast(1.16), simulated in PIL on the live tiles —
     suburb mean saturation 0.052 -> 0.110, Deerfoot 0.111 ->
     0.206; water #a7c6e4 -> #98d1ff (rich blue), trunk ->
     #ffbe40 (bold orange), primary -> #ffe749 (bold yellow),
     motorway #e88ea0 -> #ff767e (bold coral-red; the +11deg
     rotation is what keeps it out of the v124 hot-pink band
     without washing the water violet the way +22deg did).
     Hillshade keeps native 15 (soft relief under the same
     upscale as before — outside both complaints). The
     resilient layer's error fallback still swaps to Esri
     streets (driveTileUrl) when OSM itself fails — an
     offline-grade degradation, never the normal path. */
  function driveTileSpec() {
    return {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      subdomains: '',
      cls: 'nv-tile-street',
      maxNative: 18,
      attribution: '© OpenStreetMap contributors'
    };
  }

  /* v240 (NAV-LAYERS-BUTTON): the satellite layer spec — Esri
     World Imagery, keyless like the street source, same
     {z}/{y}/{x} template; probed live at z15 over the owner's
     suburb before shipping (real aerial tiles answer). Its
     class carries NO colour lift (v239): aerial photos are
     already true colour. */
  function satelliteTileSpec() {
    return {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      cls: 'nv-tile-sat',
      /* v260: Esri World Imagery re-probed at z17/z18 over
         Peigan Trail (Oct 26): 20,695 / 18,767 unique colours
         per tile — real aerial detail, NOT the blank tiles
         the street service serves at those zooms — so the
         satellite layer also renders native at the z18 view
         instead of upscaling z15. */
      maxNative: 18
    };
  }
  /* v240: the elevation overlay — Esri's World Hillshade
     (Elevation service), probed live at z15; paintDriveLayers
     lays it over the street layer at 45% so the relief reads
     without hiding the roads. */
  var HILLSHADE_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}';

  /* v220 (NAV-FREEZE): a tile layer that can DIE silently is how
     a drive ends up with a route arc and a dot on a blank field
     (Oct 22, ~09:34: tiles stopped loading mid-drive and never
     came back — Leaflet keeps a failed tile as a permanent hole
     and nothing in the old layer ever asked again). The drive
     layer now heals itself, in order:
       1. a failed tile is re-requested once, quietly, in place;
       2. a streak of failures swaps the layer to the fallback
          provider (OpenStreetMap standard) — different infra,
          same map — rather than leaving a dead one up;
       3. a watchdog: while failures continue with no successful
          tile for 30 s, the layer redraws (fresh requests for
          the whole viewport) every 30 s until tiles land again.
     The layer NEVER just stops: worst case it keeps retrying
     under the route line for the rest of the drive. */
  function resilientTileLayer(url, opts) {
    var layer = L.tileLayer(url, opts || {});
    var st = { errs: 0, lastOk: Date.now(), swapped: false, watch: null };
    layer.on('tileload', function () { st.errs = 0; st.lastOk = Date.now(); });
    layer.on('tileerror', function (e) {
      st.errs++;
      try {
        var img = e && e.tile;
        if (img && !img._nvRetried) {
          img._nvRetried = 1;
          var src = img.src;
          setTimeout(function () { try { img.src = src; } catch (x) {} }, 1200);
        }
      } catch (x) {}
      if (!st.swapped && st.errs >= 8) {
        st.swapped = true;
        try { layer.setUrl('https://tile.openstreetmap.org/{z}/{x}/{y}.png'); } catch (x) {}
      }
      if (!st.watch) {
        st.watch = setInterval(function () {
          try {
            if (Date.now() - st.lastOk > 30000) { layer.redraw(); st.lastOk = Date.now(); }
            else if (st.errs === 0) { clearInterval(st.watch); st.watch = null; }
          } catch (x) { try { clearInterval(st.watch); } catch (y) {} st.watch = null; }
        }, 5000);
      }
    });
    return layer;
  }

  /* v125 (owner spec, Oct 17): the direction line RETRACTS as
     travelled — only the route AHEAD of the truck stays drawn.
     Returns the not-yet-travelled part of `line` from the point
     nearest `pos`: { points, seg, along, dist }. points[0] is
     the projected position on the line; the last point is the
     route's end. A fully-travelled line collapses to the final
     point (padded so a polyline can still draw it). */
  function routeRemainder(line, pos) {
    if (!line || line.length < 2 || !pos) return null;
    var best = { dist: Infinity, seg: 0, t: 0, along: 0 }, cum = 0, i, seg, segLen, t;
    for (i = 0; i + 1 < line.length; i++) {
      seg = pointSegM(pos, line[i], line[i + 1]);
      if (seg.dist < best.dist) {
        segLen = haversineM(line[i], line[i + 1]);
        t = segLen ? Math.max(0, Math.min(1, seg.along / segLen)) : 0;
        best = { dist: seg.dist, seg: i, t: t, along: cum + seg.along };
      }
      cum += haversineM(line[i], line[i + 1]);
    }
    var a = line[best.seg], b = line[best.seg + 1];
    var pts = [[a[0] + (b[0] - a[0]) * best.t, a[1] + (b[1] - a[1]) * best.t]];
    for (i = best.seg + 1; i < line.length; i++) pts.push(line[i]);
    if (pts.length < 2) pts.push(line[line.length - 1]);
    return { points: pts, seg: best.seg, along: best.along, dist: best.dist };
  }

  /* v264 (NAV-LANE-INSET-EMPTY): the sign block of a maneuver —
     Valhalla's `sign` object (exit number / the road the exit
     leads to / the destinations it points toward), reduced to
     plain texts. Probed live against the owner's server
     (Oct 26, 2026): 17 of 58 maneuvers across his SE-Calgary
     corridors carry one (exits 258, 68, 88, 246-245, 234B…),
     and pre-v264 maneuverPlan dropped the whole object, so the
     turn card could never show any of it. Adjacent duplicate
     texts collapse (Valhalla repeats a branch text when its
     consecutive_count spans signs). */
  function signPartTexts(elements) {
    var out = [];
    (elements || []).forEach(function (e) {
      var t = (e && e.text !== undefined && e.text !== null) ? String(e.text).trim() : '';
      if (t && out[out.length - 1] !== t) out.push(t);
    });
    return out;
  }
  function maneuverSign(sign) {
    if (!sign) return null;
    var exit = signPartTexts(sign.exit_number_elements).join(' ');
    var branch = signPartTexts(sign.exit_branch_elements);
    var toward = signPartTexts(sign.exit_toward_elements);
    if (!exit && !branch.length && !toward.length) return null;
    return { exit: exit, branch: branch, toward: toward };
  }
  /* The inset's sign lines, as data (the paint escapes):
     the road the maneuver takes, and where it points. */
  function insetSignOf(m) {
    if (!m || !m.sign) return null;
    return {
      exit: m.sign.exit || '',
      branchText: (m.sign.branch || []).join(' · '),
      towardText: (m.sign.toward || []).join(' · ')
    };
  }

  /* Flatten a Valhalla trip into a banner-ready plan: every maneuver
     with cumulative start/end distances (km) and its spoken lines. */
  function maneuverPlan(trip) {
    var out = [], cum = 0, totalKm = 0, totalMin = 0;
    (trip.legs || []).forEach(function (leg) {
      (leg.maneuvers || []).forEach(function (m) {
        var len = Number(m.length) || 0;
        out.push({
          instruction: m.instruction || '',
          verbalPre: m.verbal_pre_transition_instruction || '',
          verbalPost: m.verbal_post_transition_instruction || '',
          streets: (m.street_names || []).slice(),
          sign: maneuverSign(m.sign),
          lengthKm: len, cumStartKm: cum, cumEndKm: cum + len, type: m.type
        });
        cum += len;
      });
    });
    if (trip.summary) { totalKm = Number(trip.summary.length) || cum; totalMin = (Number(trip.summary.time) || 0) / 60; }
    return { maneuvers: out, totalKm: totalKm, totalMin: totalMin };
  }

  /* v135: TRUCK TRUTH — a U-turn is not a truck maneuver (owner,
     Oct 17, 2026 12:05 MDT, from his recorded Ivor East Pond
     trip: "This gps is for trucks! This [GPS] should be smart
     enough to know that big trucks like ours can not make a
     uturn on a dime like that! It suggested me to make a uturn
     perhaps 5 times.. I knew what I was doing! Or else this
     could be troublesome!"). Valhalla maneuver types 12/13 are
     uturn_right / uturn_left; the text check is belt-and-braces
     for engines/fixtures that phrase it instead of typing it.
     Truck COSTING alone does not suppress these — Valhalla
     happily issues U-turns to trucks — so the app treats them
     in two layers (see doRoute + sanitizeTruckPlan below):
     re-request around them, and never PRESENT one. */
  var UTURN_RE = /u[\s\-]?turn/i;
  function isUturnManeuver(m) {
    if (!m) return false;
    if (m.type === 12 || m.type === 13) return true;
    return UTURN_RE.test(m.instruction || '') ||
      UTURN_RE.test(m.verbalPre || '') || UTURN_RE.test(m.verbalPost || '');
  }
  function planUturns(plan) {
    var out = [];
    if (!plan || !plan.maneuvers) return out;
    plan.maneuvers.forEach(function (m, i) { if (isUturnManeuver(m)) out.push(i); });
    return out;
  }

  /* The point on a route line `m` metres from its start
     (interpolated on the segment that crosses the mark). The
     U-turn re-request excludes exactly these points — the spots
     where the engine wanted the truck to turn around — so the
     next answer has to loop the block instead. */
  function pointAlongLine(line, m) {
    if (!line || !line.length) return null;
    if (!(m > 0)) return line[0].slice();
    var cum = 0, i, seg;
    for (i = 0; i + 1 < line.length; i++) {
      seg = haversineM(line[i], line[i + 1]);
      if (cum + seg >= m) {
        var t = seg ? (m - cum) / seg : 0;
        return [line[i][0] + (line[i + 1][0] - line[i][0]) * t,
                line[i][1] + (line[i + 1][1] - line[i][1]) * t];
      }
      cum += seg;
    }
    return line[line.length - 1].slice();
  }

  /* v192 (NAV-UTURN, owner, Oct 21, 2026 07:38 MDT, live drive
     to Ivor East Pond on 17 Ave SE / HWY-1A): the route DOUBLED
     BACK on itself — out on one carriageway, back on the
     parallel one — and the next-step inset drew a turn-around
     arrow over the words "Continue on 17 Avenue SE". No
     type-12/13 maneuver anywhere: the engine's second way of
     telling a truck to turn around is pure GEOMETRY, and the
     v135 layers only read the words. A crossover does not
     reverse at a point — it reverses over ~200 m of travel
     (across the median link), so the measure is SUSTAINED: the
     bearing of travel over the stretch ending 120 m before a
     maneuver boundary (from 260 m out) against the stretch
     starting 120 m past it (to 260 m out); |delta| ≥ 150°
     means the road there points the truck back at itself.
     planReversals returns the indexes of the maneuvers that
     START at such a boundary — the same indexing planUturns
     uses — so doRoute feeds them into the very same exclusion
     re-request (layer 1): the next answer must loop the block
     or take the next legal forward turn, exactly as for a
     typed U-turn. Within ~120 m of the line's ends there is
     not enough road to judge, and the measure honestly says 0. */
  function reversalDeltaDeg(plan, line, i) {
    if (!plan || !plan.maneuvers || !plan.maneuvers[i] || !line || line.length < 2) return 0;
    var total = 0, k;
    for (k = 0; k + 1 < line.length; k++) total += haversineM(line[k], line[k + 1]);
    var b = plan.maneuvers[i].cumEndKm * 1000;
    var lo = Math.max(0, b - 260), li = Math.max(0, b - 120);
    var ro = Math.min(total, b + 120), ri = Math.min(total, b + 260);
    if (li - lo < 60 || ri - ro < 60) return 0;
    var a1 = pointAlongLine(line, lo), a2 = pointAlongLine(line, li);
    var b1 = pointAlongLine(line, ro), b2 = pointAlongLine(line, ri);
    if (!a1 || !a2 || !b1 || !b2) return 0;
    var din = bearingDeg(a1, a2), dout = bearingDeg(b1, b2);
    return ((dout - din + 540) % 360) - 180;
  }
  function planReversals(plan, line) {
    var out = [];
    if (!plan || !plan.maneuvers || !line || line.length < 2) return out;
    for (var i = 0; i + 1 < plan.maneuvers.length; i++) {
      if (Math.abs(reversalDeltaDeg(plan, line, i)) >= 150) out.push(i + 1);
    }
    return out;
  }

  /* v195 (NAV-POPUP, owner, Oct 21, 2026 08:09 MDT, live drive
     video): "no turn pop-up appears as a maneuver approaches."
     The v178 mini inset existed, but it was small, late (last
     400 m only — ~14 s at highway speed) and, until v193, parked
     at the top where he was not looking. The junction view is
     the enlarged pop-up the standing requirement always meant
     (Rand McNally-style): an SVG of the route's own geometry
     around the upcoming turn — 160 m in, 220 m out — drawn with
     the route highlighted (white casing, orange core), a ring
     on the turn point, and the road ahead pointing UP (the
     window is rotated by the incoming bearing, so it reads the
     way the driver sees the junction). Pure: the suite drives
     it off fixture geometry. Empty string when there is not
     enough line to draw honestly. */
  function junctionViewSvg(plan, line, idx) {
    if (!plan || !plan.maneuvers || !plan.maneuvers[idx] || !line || line.length < 2) return '';
    var total = 0, k;
    for (k = 0; k + 1 < line.length; k++) total += haversineM(line[k], line[k + 1]);
    var turnM = plan.maneuvers[idx].cumEndKm * 1000;
    var from = Math.max(0, turnM - 160), to = Math.min(total, turnM + 220);
    if (to - from < 60) return '';
    var inA = pointAlongLine(line, Math.max(0, turnM - 110));
    var inB = pointAlongLine(line, Math.max(0, turnM - 30));
    if (!inA || !inB) return '';
    var b = bearingDeg(inA, inB) * Math.PI / 180;
    var lat0 = (inA[0] + inB[0]) / 2 * Math.PI / 180;
    var pts = [], m;
    for (m = from; m <= to; m += 8) { var p = pointAlongLine(line, m); if (p) pts.push(p); }
    var lastP = pointAlongLine(line, to);
    if (lastP && pts.length && (pts[pts.length - 1][0] !== lastP[0] || pts[pts.length - 1][1] !== lastP[1])) pts.push(lastP);
    if (pts.length < 2) return '';
    var cosB = Math.cos(b), sinB = Math.sin(b);
    var xy = pts.map(function (p) {
      var ex = (p[1] - inA[1]) * 111320 * Math.cos(lat0);
      var ny = (p[0] - inA[0]) * 111320;
      return [ex * cosB - ny * sinB, ex * sinB + ny * cosB];
    });
    var tp = pointAlongLine(line, turnM);
    var tex = (tp[1] - inA[1]) * 111320 * Math.cos(lat0);
    var tny = (tp[0] - inA[0]) * 111320;
    var txy = [tex * cosB - tny * sinB, tex * sinB + tny * cosB];
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    xy.forEach(function (q) {
      if (q[0] < minX) minX = q[0]; if (q[0] > maxX) maxX = q[0];
      if (q[1] < minY) minY = q[1]; if (q[1] > maxY) maxY = q[1];
    });
    var W = 220, H = 170, PAD = 16;
    var sc = Math.min((W - 2 * PAD) / Math.max(1, maxX - minX), (H - 2 * PAD) / Math.max(1, maxY - minY));
    function sx(q) { return (PAD + (q[0] - minX) * sc).toFixed(1); }
    function sy(q) { return (H - PAD - (q[1] - minY) * sc).toFixed(1); }
    var linePts = xy.map(function (q) { return sx(q) + ',' + sy(q); }).join(' ');
    var endQ = xy[xy.length - 1], prevQ = xy[xy.length - 2];
    var ea = Math.atan2(-(endQ[1] - prevQ[1]), endQ[0] - prevQ[0]);
    var ax = parseFloat(sx(endQ)), ay = parseFloat(sy(endQ));
    var ah = [0, 1, 2].map(function (i) {
      var ang = ea + (i === 0 ? 0 : (i === 1 ? 2.6 : -2.6));
      var rr = i === 0 ? 2 : 13;
      return (ax + rr * Math.cos(ang)).toFixed(1) + ',' + (ay - rr * Math.sin(ang)).toFixed(1);
    }).join(' ');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Junction view">' +
      '<polyline points="' + linePts + '" fill="none" stroke="#ffffff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>' +
      '<polyline points="' + linePts + '" fill="none" stroke="#e67e00" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + sx(txy) + '" cy="' + sy(txy) + '" r="7" fill="#1F3764" stroke="#ffffff" stroke-width="3"/>' +
      '<polygon points="' + ah + '" fill="#ffffff"/></svg>';
  }

  /* v196 (NAV-LANES, owner, Oct 21, 2026 08:09 MDT, same drive
     video: "the drive view shows NO lane guidance"). The route
     response itself carries NO lane data — verified against the
     live server the same morning (13 maneuvers, zero lane
     fields; BUGS.md's standing data gap). What honestly exists
     is OpenStreetMap's `lanes` tag on the approach road. Two
     pure pieces:
       pickLaneCount(elements, streetName) — chooses the lane
       count from an Overpass answer for the ways at the turn
       point: a way whose name matches the approach street wins;
       otherwise a single distinct candidate value wins;
       ambiguity or junk ("2|3", 0, 9+) answers NOTHING — the
       strip is absent rather than invented (v178's rule).
       laneStripHtml(count, deltaDeg) — the strip itself: one
       cell per OSM lane; the ROUTE lane (from the turn's own
       geometry: right turn -> rightmost lane, left -> leftmost,
       straight on -> every lane continues) burns bright with
       the turn's arrow; the rest sit dim and straight. */
  function pickLaneCount(elements, streetName) {
    if (!elements || !elements.length) return 0;
    var want = String(streetName || '').trim().toLowerCase();
    var named = 0, values = {};
    elements.forEach(function (el) {
      var t = (el && el.tags) || {};
      var raw = t.lanes !== undefined ? t.lanes : t['lanes:forward'];
      var n = parseInt(raw, 10);
      if (!(n >= 1 && n <= 6) || String(raw).trim() !== String(n)) return;
      values[n] = true;
      if (want && String(t.name || '').trim().toLowerCase() === want) named = n;
    });
    if (named) return named;
    var keys = Object.keys(values);
    return keys.length === 1 ? parseInt(keys[0], 10) : 0;
  }
  function laneStripHtml(count, deltaDeg) {
    count = parseInt(count, 10);
    if (!(count >= 1 && count <= 6)) return '';
    var d = Number(deltaDeg) || 0;
    var straight = Math.abs(d) < 8;
    var cells = '';
    for (var i = 0; i < count; i++) {
      var on = straight || (d >= 8 && i === count - 1) || (d <= -8 && i === 0);
      var rot = on ? (d >= 8 ? 90 : (d <= -8 ? -90 : 0)) : 0;
      cells += '<span class="nv-lane' + (on ? ' on' : '') + '">' +
        '<svg viewBox="0 0 48 48" width="30" height="30" aria-hidden="true"><g transform="rotate(' + rot + ' 24 24)">' +
        '<path d="M24 5 L33 21 L27.5 21 L27.5 43 L20.5 43 L20.5 21 L15 21 Z" fill="' + (on ? '#ffffff' : '#8fa3c8') + '"/></g></svg></span>';
    }
    return '<div class="nv-inset-lanes">' + cells + '</div>';
  }

  /* v238 (NAV-LANE-INFO-REAL, owner, Fri Oct 23, 2026 11:36
     MDT, drive video + Rand McNally screenshots: the pop-up
     "shows NO lane information" — it must show REAL lane
     guidance, arrows over the actual lanes). Beyond the v196
     lane COUNT, OpenStreetMap carries `turn:lanes` — the
     marked movement(s) of EACH lane on the approach road.
     That is the real data, and this is its reader:
       parseTurnLanes(raw) — "left|through;right" -> per-lane
         movement-token arrays, or null on ANY junk (unknown
         token, empty slot, implausible count): the value is
         trusted whole or not at all.
       pickTurnLanes(elements, streetName) — chooses the strip
         from an Overpass answer with pickLaneCount's honesty
         discipline (name match wins; a single distinct value
         wins; ambiguity answers nothing), PLUS the orientation
         rule: `turn:lanes:forward` is read wherever it stands
         (the suffix names the forward lanes by definition),
         and plain `turn:lanes` is read on a ONE-WAY way (or a
         motorway, one-way by construction), where every lane
         is a forward lane in travel order — the v264 widening,
         see pickTurnLanes itself. A matching lane count that
         contradicts the strip distrusts it.
       laneArrowsHtml(turnLanes, deltaDeg) — one cell per REAL
         lane, each showing the arrow(s) that lane actually
         allows; the lanes whose movements serve the maneuver
         (from its own geometry) burn bright. If no lane serves
         it, none is lit — the tagging is shown, never faked.
       laneGuidanceHtml(data, deltaDeg) — the pop-up's one
         door: real turn lanes when they exist, else the v196
         count strip, else nothing. A bare number (the
         pre-v238 cache shape) still reads as a count. */
  var LANE_MOVE_ROT = {
    left: -90, slight_left: -45, through: 0, none: 0,
    slight_right: 45, right: 90, merge_to_left: -45,
    merge_to_right: 45, reverse: 180
  };
  function parseTurnLanes(raw) {
    var parts = String(raw === undefined || raw === null ? '' : raw).split('|');
    if (parts.length < 1 || parts.length > 6) return null;
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var toks = parts[i].split(';').map(function (s) { return s.trim().toLowerCase(); })
        .filter(function (s) { return !!s; });
      if (!toks.length) return null;
      for (var j = 0; j < toks.length; j++) {
        if (LANE_MOVE_ROT[toks[j]] === undefined) return null;
      }
      out.push(toks);
    }
    return out.length ? out : null;
  }
  function pickTurnLanes(elements, streetName) {
    if (!elements || !elements.length) return null;
    var want = String(streetName || '').trim().toLowerCase();
    var named = null, values = {}, order = [];
    elements.forEach(function (el) {
      var t = (el && el.tags) || {};
      var oneway = String(t.oneway || '').trim().toLowerCase();
      var hw = String(t.highway || '').trim().toLowerCase();
      var oneWayWay = (oneway === 'yes' || oneway === 'true' || oneway === '1' ||
          hw === 'motorway' || hw === 'motorway_link');
      /* v264 (NAV-LANE-INSET-EMPTY): the v238 gate read ONLY
         turn:lanes:forward and ONLY on one-way ways. Two honest
         readings were thrown away with it. (1) The :forward
         suffix is direction-specific BY DEFINITION — on any
         way it names the forward lanes in travel order, so it
         is read wherever it stands. (2) Plain turn:lanes on a
         ONE-WAY way (a freeway carriageway, a ramp) names every
         lane of that way, and every lane there is a forward
         lane in travel order — the form Calgary's divided
         highways are actually tagged in. Plain turn:lanes on a
         two-way way stays unread: it spans both directions and
         cannot be split without inventing. */
      var raw = t['turn:lanes:forward'];
      var cnt = parseInt(t['lanes:forward'], 10);
      if (raw === undefined && oneWayWay) {
        raw = t['turn:lanes'];
        cnt = parseInt(t['lanes'], 10);
      }
      var parsed = parseTurnLanes(raw);
      if (!parsed) return;
      if (cnt >= 1 && cnt !== parsed.length) return;
      var key = JSON.stringify(parsed);
      if (!values[key]) { values[key] = parsed; order.push(key); }
      if (want && String(t.name || '').trim().toLowerCase() === want) named = parsed;
    });
    if (named) return named;
    return order.length === 1 ? values[order[0]] : null;
  }
  function laneServes(tokens, d) {
    function has(a, b) { return tokens.indexOf(a) >= 0 || (b !== undefined && tokens.indexOf(b) >= 0); }
    if (d <= -8) return has('left', 'slight_left');
    if (d >= 8) return has('right', 'slight_right');
    return has('through', 'none');
  }
  function laneArrowsHtml(turnLanes, deltaDeg, valid) {
    if (!turnLanes || !turnLanes.length || turnLanes.length > 6) return '';
    var d = Number(deltaDeg) || 0;
    var cells = '';
    turnLanes.forEach(function (tokens, li) {
      /* v264: when the data source says outright which lanes
         serve the maneuver (the server's own valid flags),
         that word wins over the geometry guess. */
      var on = valid ? !!valid[li] : laneServes(tokens, d);
      var size = tokens.length > 1 ? 14 : 21;
      var arrows = '';
      tokens.slice(0, 3).forEach(function (tk) {
        var rot = LANE_MOVE_ROT[tk];
        if (rot === undefined) rot = 0;
        arrows += '<svg viewBox="0 0 48 48" width="' + size + '" height="' + size + '" aria-hidden="true"><g transform="rotate(' + rot + ' 24 24)">' +
          '<path d="M24 5 L33 21 L27.5 21 L27.5 43 L20.5 43 L20.5 21 L15 21 Z" fill="' + (on ? '#ffffff' : '#8fa3c8') + '"/></g></svg>';
      });
      cells += '<span class="nv-lane' + (on ? ' on' : '') + ' nv-lane-arrows">' + arrows + '</span>';
    });
    return '<div class="nv-inset-lanes wrap">' + cells + '</div>';
  }
  function laneGuidanceHtml(data, deltaDeg) {
    if (data === null || data === undefined) return '';
    if (typeof data === 'number') return laneStripHtml(data, deltaDeg);
    if (data.turn && data.turn.length) return laneArrowsHtml(data.turn, deltaDeg, data.valid);
    return laneStripHtml(data.count || 0, deltaDeg);
  }

  /* v264 (NAV-LANE-INSET-EMPTY): lanes from the owner's OWN
     route server. Diagnosis (Oct 26, 2026, live probes of the
     deployed Valhalla 3.9.1): the native response carries NO
     lane data at any level and no config turns it on — but the
     SAME server, asked for the SAME route with "format":"osrm",
     answers with intersections whose `lanes` carry each lane's
     real indications and which lanes are VALID for the route's
     maneuver (the graph's OSM turn:lanes, read by the engine
     itself — 79 such intersections across the four corridors
     probed: Deerfoot, Stoney, 16 Ave, Glenmore, Peigan).
       osrmLaneData(osrmJson) — every laned intersection in the
         answer, as {lat, lng, turn, valid}: per-lane movement
         tokens in THIS app's vocabulary, and the server's own
         valid flag per lane. A lane whose indications map to
         nothing known is dropped whole; an intersection left
         with no usable lane is dropped too.
       matchServerLanes(laned, line, plan) — pins each laned
         intersection to the maneuver it belongs to: the one
         whose END (the turn point the pop-up serves) lies
         within 75 m. Returns {maneuverIndex: {turn, valid}} —
         the same pair shape the Overpass cache stores, plus
         the valid flags. No match, no entry: absence stays
         honest, the Overpass fallback still gets its say. */
  var OSRM_LANE_TOKEN = {
    'straight': 'through', 'through': 'through', 'none': 'none',
    'left': 'left', 'right': 'right',
    'slight left': 'slight_left', 'slight right': 'slight_right',
    'sharp left': 'left', 'sharp right': 'right',
    'uturn': 'reverse', 'merge': 'through'
  };
  function osrmLaneData(osrmJson) {
    var out = [];
    var routes = (osrmJson && osrmJson.routes) || [];
    if (!routes.length || !routes[0].legs) return out;
    routes[0].legs.forEach(function (leg) {
      (leg.steps || []).forEach(function (step) {
        (step.intersections || []).forEach(function (inter) {
          if (!inter || !inter.lanes || !inter.lanes.length || !inter.location) return;
          var turn = [], valid = [];
          inter.lanes.forEach(function (ln) {
            var toks = [];
            ((ln && ln.indications) || []).forEach(function (ind) {
              var tk = OSRM_LANE_TOKEN[String(ind || '').trim().toLowerCase()];
              if (tk && toks.indexOf(tk) === -1) toks.push(tk);
            });
            if (!toks.length) return;
            turn.push(toks);
            valid.push(!!(ln && ln.valid));
          });
          if (!turn.length || turn.length > 6) return;
          out.push({ lat: Number(inter.location[1]), lng: Number(inter.location[0]), turn: turn, valid: valid });
        });
      });
    });
    return out;
  }
  function matchServerLanes(laned, line, plan) {
    var out = {};
    if (!laned || !laned.length || !line || !plan || !plan.maneuvers) return out;
    for (var idx = 0; idx + 1 < plan.maneuvers.length; idx++) {
      var tp = pointAlongLine(line, plan.maneuvers[idx].cumEndKm * 1000);
      if (!tp) continue;
      var best = null, bestD = 75;
      laned.forEach(function (L) {
        var d = haversineM(tp, [L.lat, L.lng]);
        if (d <= bestD) { bestD = d; best = L; }
      });
      if (best) out[idx] = { turn: best.turn, valid: best.valid };
    }
    return out;
  }

  /* v135 layer 2 — the presentation guarantee. If every
     U-turn-free re-request failed and a plan STILL carries a
     U-turn, the maneuver is rewritten before anything can show
     or speak it: its instruction becomes the plain continuation
     onto the road it was turning onto, its spoken lines lose
     every U-turn phrase, and its type becomes "continue" (8).
     Distances are untouched — the plan's geometry stays the
     engine's; only the words change. The banner, the steps list
     and every spoken line read the plan, so this one pass
     covers all three. Car mode never comes through here:
     a car CAN turn around, and its plan stays the engine's own. */
  function sanitizeTruckPlan(plan) {
    if (!plan || !plan.maneuvers) return plan;
    var removed = 0;
    var mans = plan.maneuvers.map(function (m) {
      var c = {
        instruction: m.instruction, verbalPre: m.verbalPre, verbalPost: m.verbalPost,
        streets: (m.streets || []).slice(), sign: m.sign || null, lengthKm: m.lengthKm,
        cumStartKm: m.cumStartKm, cumEndKm: m.cumEndKm, type: m.type
      };
      if (isUturnManeuver(m)) {
        removed++;
        var st = (m.streets && m.streets[0]) || '';
        c.instruction = st ? 'Continue on ' + st : 'Continue ahead';
        if (UTURN_RE.test(c.verbalPre || '')) c.verbalPre = '';
        if (UTURN_RE.test(c.verbalPost || '')) c.verbalPost = '';
        c.type = 8;
      } else {
        if (UTURN_RE.test(c.verbalPre || '')) c.verbalPre = '';
        if (UTURN_RE.test(c.verbalPost || '')) c.verbalPost = '';
      }
      return c;
    });
    return { maneuvers: mans, totalKm: plan.totalKm, totalMin: plan.totalMin, uturnsRemoved: removed };
  }

  /* Which maneuver the driver is in, given metres travelled along
     the route line: the first whose end is still ahead. */
  function currentManeuverIndex(plan, alongM) {
    var km = alongM / 1000, i;
    for (i = 0; i < plan.maneuvers.length; i++) {
      if (km < plan.maneuvers[i].cumEndKm - 0.005) return i;
    }
    return plan.maneuvers.length - 1;
  }

  /* v101 DRIVE SCREEN engine (pure). The drive view shows the road
     being travelled (the current maneuver's street names — Valhalla
     names the road each maneuver travels), the distance to the NEXT
     maneuver's turn, what is left of the trip, and a proportional
     ETA share of the trip's total minutes. */
  function currentRoadName(plan, idx) {
    if (!plan || !plan.maneuvers || !plan.maneuvers.length) return '';
    var i = Math.min(Math.max(idx || 0, 0), plan.maneuvers.length - 1);
    for (; i >= 0; i--) {
      var st = plan.maneuvers[i].streets;
      if (st && st.length) return st.join(' / ');
    }
    return '';
  }

  function driveProgress(plan, alongM) {
    var idx = currentManeuverIndex(plan, alongM);
    var cur = plan.maneuvers[idx] || null;
    var toTurnM = Math.max(0, (cur ? cur.cumEndKm : plan.totalKm) * 1000 - alongM);
    var leftM = Math.max(0, plan.totalKm * 1000 - alongM);
    var etaMin = plan.totalKm > 0 ? plan.totalMin * (leftM / (plan.totalKm * 1000)) : plan.totalMin;
    return {
      idx: idx, current: cur, next: plan.maneuvers[idx + 1] || null,
      toTurnM: toTurnM, leftM: leftM, etaMin: etaMin,
      road: currentRoadName(plan, idx)
    };
  }

  /* v124: the arrival answer, as data — the Drive bar's main line
     is a CLOCK time ("8:02 AM", big and bare so it fits beside
     the buttons at a glance), not only a duration. The
     owner asked "What's the arrival time?" at 07:17 with the old
     bar showing nothing at all (see the bar CSS note in style.css
     — the ETA element was crushed to 0 px wide); even had it
     rendered, "24 min left" never answered his question. */
  function fmtClock(d) {
    var h = d.getHours(), m = d.getMinutes();
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + ('0' + m).slice(-2) + ' ' + ap;
  }

  function driveEtaInfo(plan, alongM, nowMs) {
    var dp = driveProgress(plan, alongM);
    return {
      arriveAt: new Date(nowMs + dp.etaMin * 60000),
      etaMin: dp.etaMin, leftM: dp.leftM
    };
  }

  /* v124: compass bearing from fix A to fix B (degrees, 0 = N).
     The fallback heading when the GPS stream reports no heading
     of its own — some devices leave coords.heading null at any
     speed, and without a heading the drive map never spins
     heading-up (one half of why the owner's Drive looked like a
     flat north-up map). Movement IS a heading; derive it. */
  function bearingDeg(a, b) {
    var rad = Math.PI / 180;
    var dLon = (b[1] - a[1]) * rad;
    var y = Math.sin(dLon) * Math.cos(b[0] * rad);
    var x = Math.cos(a[0] * rad) * Math.sin(b[0] * rad) -
      Math.sin(a[0] * rad) * Math.cos(b[0] * rad) * Math.cos(dLon);
    return (Math.atan2(y, x) / rad + 360) % 360;
  }

  /* v128: the smallest absolute difference between two headings,
     in degrees (0–180). The drive screen's heading deadband reads
     it: GPS heading at speed jitters degree-by-degree between
     fixes, and every transform write on the plane restarts
     its rasterization — below 2° of real turn, nothing may move. */
  function angDeltaDeg(a, b) {
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  /* Spoken advance prompts for drive mode: each upcoming maneuver
     is announced ONCE far out (its verbal pre-transition line) and
     ONCE close in (its crisp instruction). `said` is a caller-owned
     flag bag ('far:<i>' / 'near:<i>') so the logic stays pure and
     the caller resets it per route. The final (arrival) maneuver
     gets no far prompt — only the close-in line. */
  var DRIVE_FAR_M = 600, DRIVE_NEAR_M = 200;
  function drivePrompt(plan, idx, toTurnM, said) {
    if (!plan || !plan.maneuvers || !said) return null;
    var u = idx + 1;
    if (u >= plan.maneuvers.length) return null;
    var next = plan.maneuvers[u];
    var isFinal = u === plan.maneuvers.length - 1;
    if (toTurnM <= DRIVE_NEAR_M) {
      if (said['near:' + u]) return null;
      said['near:' + u] = 1; said['far:' + u] = 1;
      return isFinal ? (next.verbalPre || next.instruction) : (next.instruction || next.verbalPre);
    }
    if (!isFinal && toTurnM <= DRIVE_FAR_M && !said['far:' + u]) {
      said['far:' + u] = 1;
      return next.verbalPre || next.instruction;
    }
    return null;
  }

  /* v179 (F5, owner Oct 19: Garmin-style grade warnings):
     GRADE EVENTS from elevation samples. samples = [{m, ele}]
     along the route (metres along, metres elevation — fetched
     from the free Open-Meteo elevation service at route time;
     see fetchGradeEvents in the render). For each sample, the
     grade over the next ~150 m is (eleAhead − ele) / run; a
     sustained |grade| ≥ 4% opens an event {atM, gradePct} —
     gradePct signed (positive = climb). Consecutive firing
     samples merge into ONE event (its steepest grade), so a
     long hill announces once, at its start. Grades are computed
     from real elevation data only — if the fetch fails there
     are no events and no announcements, never invented numbers. */
  function gradeEvents(samples) {
    var out = [];
    if (!samples || samples.length < 3) return out;
    var open = null;
    for (var i = 0; i < samples.length; i++) {
      var j = i + 1;
      while (j < samples.length && samples[j].m - samples[i].m < 150) j++;
      if (j >= samples.length) break;
      var run = samples[j].m - samples[i].m;
      if (!(run > 0)) continue;
      var g = (samples[j].ele - samples[i].ele) / run * 100;
      if (Math.abs(g) >= 4) {
        if (!open) open = { atM: samples[i].m, gradePct: g };
        else if (Math.abs(g) > Math.abs(open.gradePct)) open.gradePct = g;
      } else if (open) { out.push(open); open = null; }
    }
    if (open) out.push(open);
    return out;
  }

  /* v183 (N-limit, owner Oct 20 19:50 MDT — no speed limit was
     displayed on his drive): Valhalla carries no maxspeed (see
     BUGS.md), so the limit comes from OpenStreetMap's own
     maxspeed tag on the road under the truck, fetched live from
     the free Overpass service (see fetchSpeedLimit in render).
     parseMaxspeed turns a raw tag ("50", "50 mph", "CA:urban")
     into km/h, or null when the tag carries no honest number —
     the badge shows only a number this returns. */
  function parseMaxspeed(tag) {
    if (tag === null || tag === undefined) return null;
    var m = String(tag).match(/(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh)?/i);
    if (!m) return null;
    var v = parseFloat(m[1]);
    if (!(v > 0)) return null;
    if (m[2] && /^mph$/i.test(m[2])) v = v * 1.609344;
    return Math.round(v);
  }

  /* v183 (Navigator search + Navigate loop, owner Oct 20 17:10–
     17:13 MDT): a typed search must match his SAVED places
     before any outside geocoder is asked — "Home, 1243
     Cornerstone Boulevard" failed because the geocoder was
     handed the place NAME glued to the address. matchSavedPlaces
     (pure) returns the saved places a query means: a place whose
     name appears in the query (his "Home"), or whose name/address
     contains every query word. Order: name-in-query first. */
  function matchSavedPlaces(places, q) {
    var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); };
    var nq = norm(q);
    if (!nq || !places || !places.length) return [];
    var words = nq.split(' ').filter(function (w) { return w.length >= 2; });
    var named = [], worded = [];
    for (var i = 0; i < places.length; i++) {
      var p = places[i];
      var nn = norm(p.name), hay = norm((p.name || '') + ' ' + (p.address || ''));
      if (nn && nn.length >= 3 && nq.indexOf(nn) !== -1) { named.push(p); continue; }
      if (words.length && words.every(function (w) { return hay.indexOf(w) !== -1; })) worded.push(p);
    }
    return named.concat(worded);
  }

  /* v176 (F1, owner Oct 19 drive): EVERY TURN ANNOUNCED, NONE
     SKIPPED. On his Oct 19 drive the guidance jumped from the
     Beddington Trail exit straight to the next turn — a short
     intermediate maneuver (an exit ramp + immediate merge) was
     crossed between two GPS fixes, the maneuver index jumped
     past it, and its instruction was never spoken: drivePrompt
     only ever looks at idx+1, and trackProgress spoke only the
     landing maneuver's line. skippedLines is the catch-up half
     of the guarantee: given an index jump fromIdx -> toIdx, it
     returns the instruction lines of every maneuver STRICTLY
     BETWEEN them (the landing maneuver keeps its own existing
     announcement path), in route order, so the caller can speak
     them as one combined line — no turn on the route is ever
     passed in silence. */
  function skippedLines(plan, fromIdx, toIdx) {
    var out = [];
    if (!plan || !plan.maneuvers) return out;
    for (var j = fromIdx + 1; j < toIdx; j++) {
      var m = plan.maneuvers[j];
      if (m && (m.instruction || m.verbalPre)) out.push(m.instruction || m.verbalPre);
    }
    return out;
  }

  function fmtDist(m) {
    if (m === null || m === undefined || !isFinite(m)) return '';
    if (m < 1000) return Math.round(m / 10) * 10 + ' m';
    return (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km';
  }
  function fmtMin(min) {
    if (min < 1) return '<1 min';
    if (min < 60) return Math.round(min) + ' min';
    return Math.floor(min / 60) + ' h ' + Math.round(min % 60) + ' min';
  }

  /* v101 (field fix): pull a "lat, lng" pair out of free text — a
     whole string ("50.951946, -114.027355") or a name carrying one
     ("Butterfly, 50.9519460, -114.0273550"). Three-plus decimals on
     both numbers are required, so street text ("12th Street",
     "Highway 2, 5 km") can never false-match; ranges are validated.
     Returns [lat, lng] or null. */
  function parseLatLngText(text) {
    if (!text) return null;
    var m = String(text).match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
    if (!m) return null;
    var lat = Number(m[1]), lng = Number(m[2]);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return [lat, lng];
  }

  /* v103: the v93 turn-by-turn HANDOFF (its link builder + the
     timed cascade) is DELETED outright — owner ruling, Oct 16,
     2026: navigation never leaves the app. There is deliberately
     NO external-link builder in this region any more. */

  /* v210 (NAV-GESTURES, owner Oct 21, 2026 13:14 MDT — "no 2
     fingers to rotate and change orientation or 2 fingers to
     change the angle like with other gps's"): the two-finger
     gesture math for the drive view — pure, so the thresholds
     are provable. A two-pointer gesture is described by the
     vector between its pointers: angle (deg, screen coords,
     y down), distance (px), and the midpoint's Y. */
  function gestureVec(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    return {
      angle: Math.atan2(dy, dx) * 180 / Math.PI,
      dist: Math.sqrt(dx * dx + dy * dy),
      midY: (a.y + b.y) / 2
    };
  }
  function gestureAngDelta(from, to) {
    return ((to - from + 540) % 360) - 180;
  }
  /* Which channel a gesture belongs to, judged start→now.
     PINCH is judged first and on its own threshold: a pinch
     must never read as a rotate (the owner's stated fear when
     asking for this). Below pinch, rotate and tilt compete by
     DOMINANCE (each signal against its own threshold — a real
     twist is >=12°, a real vertical slide >=28 px), so the
     small cross-talk of a real gesture (a tilt's few degrees
     of skew, a twist's few px of midY drift) never steals the
     channel. Anything under both thresholds is nothing yet.
     v215 (NAV-GESTURE-PLANE, owner's video Oct 21, 2026 15:22
     MDT — his pinch SPUN the sheet): the channel LOCKS on the
     first threshold crossed, and a natural pinch skews fast —
     the fingers can twist 12–20° while the spread is still
     small — so a plain dominance race let a pinch lock as
     ROTATE mid-gesture, and the plane spun while Leaflet
     zoomed. Two guards now sit between the pinch threshold
     and the dominance race: a committed vertical slide
     (tilt's own threshold, little twist) is a tilt even if
     the fingers breathed apart on the way; and a DEVELOPING
     pinch — spread >=14 px, at least 60% of the twist's arc
     travel at the fingers, no committed slide under way —
     is a pinch before the twist can reach its own lock. Only
     an extreme twist (>=30°) with a small spread outranks a
     developing pinch, via the dominance race below. */
  function gestureClass(start, cur) {
    var dDist = cur.dist - start.dist;
    var dAng = Math.abs(gestureAngDelta(start.angle, cur.angle));
    var dMidY = Math.abs(cur.midY - start.midY);
    if (Math.abs(dDist) >= 40) return 'pinch';
    if (dMidY >= 28 && dAng < 12) return 'tilt';
    var arcPx = dAng * Math.PI / 180 * (start.dist || 0);
    if (Math.abs(dDist) >= 14 && dMidY < 20 && Math.abs(dDist) >= 0.6 * arcPx) return 'pinch';
    var rot = dAng / 12;
    var tilt = dMidY / 28;
    if (rot < 1 && tilt < 1) return null;
    return rot >= tilt ? 'rotate' : 'tilt';
  }
  /* v215: the pinch's camera zoom — a pinch drives the map
     CAMERA (Leaflet setZoomAround on the truck), never a
     sheet scale. Doubling the finger spread is one zoom level,
     the map's own arithmetic. The band is the drive view's
     sane range: the view opens at 18, the tile layer tops at
     18 (one overzoom level reads closer), and 14 is as far
     out as a chase view stays useful. */
  function pinchZoomFrom(baseZoom, startDist, curDist) {
    if (!(startDist > 0) || !(curDist > 0) || !isFinite(baseZoom)) return baseZoom;
    var z = baseZoom + Math.log(curDist / startDist) / Math.LN2;
    return Math.max(14, Math.min(19, Math.round(z * 100) / 100));
  }
  /* Fingers slide UP (midY falls) → the view pitches UP toward
     the horizon; slide DOWN → it flattens toward top-down.
     0.25° per px, clamped to the sane band. */
  function tiltPitchFrom(basePitch, dMidY) {
    var p = basePitch - dMidY * 0.25;
    return Math.max(0, Math.min(65, Math.round(p * 10) / 10));
  }
  /* Fingers twist clockwise (screen angle grows) → the map
     turns clockwise with them. The plane's CSS rotate is
     -(heading + offset), so the offset moves AGAINST the
     twist for the map to follow the fingers. */
  function gestureRotOffset(baseOffset, startAngle, curAngle) {
    return baseOffset - gestureAngDelta(startAngle, curAngle);
  }
  /* v262 (NAV-LIVE-TRAFFIC-CITYFEED, owner Oct 26, 2026 08:14
     MDT — "Yes build it!"): the City of Calgary's FREE open-data
     feed of CURRENT traffic incidents (data.calgary.ca, Socrata
     dataset 4jah-h97u — verified live the morning of the build:
     rows updated minutes before the check, newest incident
     ~13 min old, "Continuous" updates / 10-minute resolution,
     City of Calgary Open Data Terms). parseCityIncidents
     normalises a SODA answer into {id, lat, lng, info, desc};
     rows without honest coordinates are dropped — never placed
     by guess. The id mirrors the feed's own composite (start
     time + position), so one incident keeps one identity across
     refreshes and is warned about once per route. */
  function parseCityIncidents(rows) {
    var out = [];
    if (!rows || !rows.length) return out;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || {};
      var lat = Number(r.latitude), lng = Number(r.longitude);
      if (!isFinite(lat) || !isFinite(lng)) continue;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
      out.push({
        id: String(r.start_dt_utc || '') + '|' + lat.toFixed(5) + '|' + lng.toFixed(5),
        lat: lat, lng: lng,
        info: String(r.incident_info || ''),
        desc: String(r.description || '')
      });
    }
    return out;
  }

  /* v262: which incidents sit ON the route ahead of the truck.
     Each incident is projected onto the route line
     (routeRemainder does the projection); one counts when it
     lies within offMaxM of the line and its along-route point
     is ahead of the truck (the truck's own along) by at most
     aheadMaxM. Returns them in approach order:
     [{inc, aheadM, offM}]. Incidents behind the truck or off
     the route are excluded here — they stay map markers only. */
  function trafficOnRoute(line, truckAlong, incidents, offMaxM, aheadMaxM) {
    var out = [];
    if (!line || line.length < 2 || !incidents || !incidents.length) return out;
    for (var i = 0; i < incidents.length; i++) {
      var inc = incidents[i];
      if (!inc) continue;
      var pr = routeRemainder(line, [inc.lat, inc.lng]);
      if (!pr) continue;
      var ahead = pr.along - truckAlong;
      if (pr.dist <= offMaxM && ahead > 0 && ahead <= aheadMaxM) {
        out.push({ inc: inc, aheadM: ahead, offM: pr.dist });
      }
    }
    out.sort(function (a, b) { return a.aheadM - b.aheadM; });
    return out;
  }

  /* v273 (NAV-TOP-CUTOFF-STILL — owner verdict, Oct 26, 2026
     17:46 MDT: on v270 the drive view "is still cutting off"
     at the top): the v260 lift was a FLAT 0.49 x viewport
     height, derived at 768x1024 — a screen the owner does not
     have. The Oct 26 recordings are 1080x2520 (Fold7 cover
     display, DPR 2.625) -> the real drive viewport is 411x960
     CSS px, where the flat rule's projected far reach runs
     out at side headings (~593px against ~614px needed) and
     even at 768x1024 it runs out in the corners at diagonal
     headings — the viewport's sky gradient (navy) shows as a
     band at the top and the map reads "cut off". There is no
     honest flat fraction: the needed lift is a function of
     BOTH viewport dimensions through the exact composition
     (plane 260%x300% centred on the 50%/64% anchor,
     perspective(1100px) rotateX(50deg) — the constants below
     are a matched pair with planeTransform + .nv-drive-plane;
     change them together). So the lift is DERIVED per
     viewport: the smallest translate whose inverse
     homography keeps the viewport's whole top strip inside
     the plane at EVERY heading, plus a small safety margin.
     Memoised per size — paintPlane calls this on every
     repaint. Pure arithmetic, no DOM.
     v277 (NAV-SCREEN-STILL-CUTTING, owner Oct 28, 2026
     07:27 MDT, drive video): the top strip was the wrong
     sample — it is all the v273 check ever looked at, and
     the owner's complaint moved DOWN the glass: at side
     and diagonal headings the pre-image of the LOWER
     two-thirds of his 411x960 screen walks off the SIDES
     of the 260%-wide plane (63% of the viewport uncovered
     at heading 90; the truck, at the 64% anchor, floats on
     the viewport's bare gradient below a thin map strip).
     Two matched moves: the plane widens to 460% (see
     .nv-drive-plane — the constants below follow it), and
     _covCovers now samples the WHOLE viewport, top to
     bottom, so the derived lift guarantees the entire
     screen at every heading — nothing left unexamined
     below the strip again. */
  var _covLiftMemo = {};
  function _covMul(A, B) {
    var C = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
      var s = 0; for (var k = 0; k < 4; k++) s += A[r * 4 + k] * B[k * 4 + c];
      C[r * 4 + c] = s;
    }
    return C;
  }
  function _covCovers(W, H, lift, deg) {
    var pw = 4.6 * W, ph = 3.0 * H, x0 = -1.80 * W, y0 = -0.86 * H;
    var ox = x0 + pw / 2, oy = y0 + ph / 2;
    var t = deg * Math.PI / 180, cp = Math.cos(t), sp = Math.sin(t);
    var P = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1 / 1100, 1];
    var T = [1, 0, 0, 0, 0, 1, 0, -lift, 0, 0, 1, 0, 0, 0, 0, 1];
    var c50 = Math.cos(50 * Math.PI / 180), s50 = Math.sin(50 * Math.PI / 180);
    var RX = [1, 0, 0, 0, 0, c50, -s50, 0, 0, s50, c50, 0, 0, 0, 0, 1];
    var RZ = [cp, sp, 0, 0, -sp, cp, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; /* rotate(-deg) */
    var M = _covMul([1, 0, 0, ox, 0, 1, 0, oy, 0, 0, 1, 0, 0, 0, 0, 1],
      _covMul(_covMul(P, _covMul(T, _covMul(RX, RZ))),
        [1, 0, 0, -ox, 0, 1, 0, -oy, 0, 0, 1, 0, 0, 0, 0, 1]));
    var a = M[0], b = M[1], c = M[3], d = M[4], e = M[5], f = M[7], g = M[12], h = M[13], i = M[15];
    var A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    var det = a * A + b * B + c * C;
    if (!det) return false;
    var inv = [A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
               B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
               C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
    for (var ry = 0; ry <= 20; ry++) {
      var sy = H * ry / 20;
      for (var rx = 0; rx <= 12; rx++) {
        var sx = W * rx / 12;
        var X = inv[0] * sx + inv[1] * sy + inv[2];
        var Y = inv[3] * sx + inv[4] * sy + inv[5];
        var Wd = inv[6] * sx + inv[7] * sy + inv[8];
        if (!Wd) return false;
        var px = X / Wd, py = Y / Wd;
        var wf = M[12] * px + M[13] * py + M[15];
        if (!(wf > 0 && px >= x0 - 0.5 && px <= x0 + pw + 0.5 && py >= y0 - 0.5 && py <= y0 + ph + 0.5)) return false;
      }
    }
    return true;
  }
  function coverageLiftPx(w, h) {
    if (!(w > 0) || !(h > 0)) return 0;
    var key = w + 'x' + h;
    if (_covLiftMemo[key] !== undefined) return _covLiftMemo[key];
    function coversAll(lift) {
      for (var deg = 0; deg < 360; deg += 3) if (!_covCovers(w, h, lift, deg)) return false;
      return true;
    }
    /* Coverage in the lift is a WINDOW, not a threshold: too
       little and the far edge falls short of the top; too
       much and the translate drags the far field across the
       perspective eye plane (the viewport's far pre-image
       slides down-plane ~1.6-2x the lift and out the near
       side). So scan UP from zero for the FIRST covering
       lift, then take only a small margin over it — and keep
       the un-margined value if the margin ever steps out of
       the window. */
    var out = 0;
    if (!coversAll(0)) {
      var first = -1;
      for (var L = 4; L <= h; L += 4) { if (coversAll(L)) { first = L; break; } }
      if (first < 0) out = Math.round(h * 0.49); /* no covering lift found — the old posture, best effort */
      else {
        var cand = Math.ceil(first * 1.02) + 2;
        out = coversAll(cand) ? cand : first;
      }
    }
    _covLiftMemo[key] = out;
    return out;
  }

  /* ================= NAVPURE-END ================= */

  /* v135: THE AVATAR — a truck, not a puny arrow (owner, Oct 17,
     2026 12:05 MDT: "this is a truck gps! An arrow as you! That's
     more like something puny! The moving avatar should be
     something bigger, a truck which you should be able to click
     and change!"). Top-down vehicle markers, drawn pointing UP —
     the drive plane spins heading-up under the fixed anchor, so
     up on the glass is always the direction of travel. The glyph
     is painted once per render and swapped only on the driver's
     own tap in the chooser — the drive tick never touches it
     (the v133 mutate-only guarantee is untouched). 'arrow' keeps
     the classic chevron for drivers who prefer it.
     v139 redrew the glyphs as detailed dimensional inline SVG —
     and the owner rejected the art a second time (Oct 17, 13:35
     MDT, with a live Drive screenshot): "Still horrendous! When
     I said 3d! That what came to mind? When I said realistic is
     this it?" — the SVG still read as a flat cartoon on his
     glass.
     v141: THE ART IS A RENDER NOW, NOT A DRAWING. Each vehicle
     kind is a photorealistic top-down 3D render shipped as a PNG
     asset (assets/avatar-<kind>.png): a glossy navy cab with sky
     reflected in the glass, a steel dump box carrying a real
     gravel load (dump), a corrugated trailer (semi), an open bed
     (pickup) — treaded tyres, mirrors, chrome tanks, and a soft
     ground shadow baked into the raster. Produced from generated
     renders (chroma-keyed off their green ground, shadow
     composited in, sized at 3x the marker box) and raster-proofed
     at exact marker size in the build: at marker scale they read
     as little real trucks, not clip-art. The renders carry true
     vehicle proportions (aspect ~2.4–4.8); AVATAR_BOX compresses
     the length the way every navigation marker does. 'arrow'
     keeps its v139 chevron — a symbol, never the complaint.
     AVATAR_BOX is each kind's element box in px — the marker is
     centred on the anchor by negative margins from this table
     (paintYou + the render), never by a transform.
     v175 (owner, Oct 19, 2026 08:20 MDT, over his live Drive
     screenshot): "I do like this truck but instead of it being
     2d image... It would look allot better if this same truck
     was 3d and the image of it was on a tilt angle from the
     back on perhaps a 45 degree angle from the rear" — and the
     top-down view gives him "a lot of GTA 1 vibe". THE ART IS
     A CHASE RENDER NOW: the same trucks (navy cab, steel box +
     gravel, corrugated semi, open-bed pickup), re-rendered in
     3D from BEHIND and ABOVE — a rear chase camera looking
     down the truck's length at ~45°: rear gate / trailer doors
     / tailgate large at the bottom of the frame, the load /
     roof running away up-frame. Same production as v141
     (generated renders on chroma green, keyed + despilled,
     ground shadow baked in), plus two build steps the new
     angle needs: each render was STRAIGHTENED to vertical
     (its long axis measured off the alpha mask) and COMPOSED
     so the truck's ground-centre — the midpoint of its
     projected footprint — sits exactly on the canvas centre,
     so the half-box margin centring keeps the truck's road
     position true, the anchor contract unchanged. ONE render
     per kind is geometrically exact here, not a shortcut: the
     drive face is heading-up — the plane spins the WORLD
     under a fixed marker — so the chase camera's angle to the
     truck never changes, at any heading. (A heading-stepped
     sprite set would have nothing to attach to: the marker
     carries no transform, by the v139 rule.) The boxes grew
     wider than tall-ish for the chase silhouette; the mild
     length compression is the same house trade as v141. */
  var AVATAR_KINDS = ['dump', 'semi', 'pickup', 'arrow'];
  var AVATAR_LABELS = { dump: 'Dump truck', semi: 'Semi', pickup: 'Pickup', arrow: 'Arrow' };
  var AVATAR_BOX = { dump: [92, 132], semi: [92, 144], pickup: [92, 118], arrow: [54, 72] };
  var AVATAR_ASSET = { dump: 'assets/avatar-dump.png', semi: 'assets/avatar-semi.png', pickup: 'assets/avatar-pickup.png' };
  function avatarBoxStyle(kind) {
    var b = AVATAR_BOX[kind] || AVATAR_BOX.dump;
    return 'width:' + b[0] + 'px;height:' + b[1] + 'px;margin-left:' + (-b[0] / 2) + 'px;margin-top:' + (-b[1] / 2) + 'px';
  }
  function avatarGlyph(kind, slot) {
    /* v141: the vehicle kinds are rendered raster assets (see the
       note above); one <img> serves the marker and the chooser —
       CSS sizes it to each stage (.nv-drive-you img /
       .nv-avatar-opt img in style.css). */
    if (AVATAR_ASSET[kind]) {
      return '<img class="nv-avatar-img" src="' + AVATAR_ASSET[kind] + '" alt="" draggable="false">';
    }
    /* arrow — the v139 chevron, unchanged. */
    var u = 'arrow' + (slot === 'p' ? 'p' : 'm');
    return '<svg viewBox="0 0 54 72" aria-hidden="true"><defs>' +
      '<linearGradient id="ar' + u + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#4a7ec2"/><stop offset="1" stop-color="#1F3764"/></linearGradient></defs>' +
      '<ellipse cx="27" cy="38" rx="17" ry="31" fill="#0a1220" opacity=".20"/>' +
      '<polygon points="27,4 46,62 27,48 8,62" fill="url(#ar' + u + ')" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/>' +
      '<polygon points="27,13 38.5,53 27,43.5 15.5,53" fill="#ffffff" opacity=".16"/></svg>';
  }

  /* ---- shared settings (Preferences reads/writes the same store) ---- */
  /* v98: the routing server the app ships with.
     v137: it is now the ONLY address the app will ever use — a
     baked-in constant, not a default. loadSettings returns it
     unconditionally; any serverUrl an older build persisted is
     ignored, and saveSettings refuses to persist one. (The
     nav.meticuloustechnologies.com name replaces this IP literal
     once its DNS lands — a code change, never a user setting.) */
  var NAV_DEFAULT_SERVER_URL = 'https://2.31.47.19';

  function loadSettings() {
    var s = {};
    try { s = App._store.get('navigator', {}) || {}; } catch (e) {}
    var out = {
      profile: navProfile(s.profile),
      serverUrl: NAV_DEFAULT_SERVER_URL,
      muted: !!s.muted,
      mode: s.mode === 'car' ? 'car' : 'truck',
      /* v135: the drive avatar (see avatarGlyph) — the stored
         choice, defaulting to the dump truck. */
      avatar: AVATAR_KINDS.indexOf(s.avatar) >= 0 ? s.avatar : 'dump',
      /* v177 (F4): the Navigator's OWN settings (its gear menu):
         route preference, the 3D/2D view option (A4), and the
         speedometer / speed-limit overlay toggles. One settings
         object in the one 'navigator' store — the Preferences
         door and the in-Navigator gear open the SAME menu over
         this same object, never a copy. Defaults: fastest,
         3D chase, both overlays on. */
      routePref: s.routePref === 'economical' ? 'economical' : 'fastest',
      /* v179 (F5): grade/slope announcements, on by default. */
      gradeAlerts: s.gradeAlerts === undefined ? true : !!s.gradeAlerts,
      viewMode: s.viewMode === '2d' ? '2d' : '3d',
      showSpeed: s.showSpeed === undefined ? true : !!s.showSpeed,
      showSpeedLimit: s.showSpeedLimit === undefined ? true : !!s.showSpeedLimit,
      /* v240 (NAV-LAYERS-BUTTON): the drive map's base layer —
         standard / satellite / elevation. Traffic is NOT a
         base-layer value — it is an overlay, so it keeps its
         own switch beside the base choice. */
      driveLayer: (s.driveLayer === 'satellite' || s.driveLayer === 'elevation') ? s.driveLayer : 'standard',
      /* v262 (NAV-LIVE-TRAFFIC-CITYFEED): the live-traffic
         overlay (City of Calgary current incidents) — on by
         default, toggled from the layers panel. */
      trafficOn: s.trafficOn === undefined ? true : !!s.trafficOn,
      /* v280 (NAV-VOICE-SELECTION-PREF, owner Oct 29, 2026): the
         guidance voice he picked in Navigator settings, by its
         speechSynthesis voiceURI ('' = phone default). The pick
         IS the personality fix (NAV-VOICE-PERSONALITY): a real
         device voice replaces the generic robot default — no
         text tricks. The native bridge carries no voice
         parameter, so a pick routes speak() through the WebView
         voice below; no pick keeps the native-first order. */
      voiceURI: s.voiceURI ? String(s.voiceURI) : ''
    };
    setNavViewMode(out.viewMode);
    return out;
  }
  function saveSettings(patch) {
    var s = {};
    try { s = App._store.get('navigator', {}) || {}; } catch (e) {}
    for (var k in patch) { if (k === 'serverUrl') continue; s[k] = patch[k]; } // v137: the address is baked in — never user-persisted
    try { App._store.set('navigator', s); } catch (e) {}
    return loadSettings();
  }
  /* Exposed for Preferences (same defaults, same store key). */
  window.MeticulousNav = {
    DEFAULT_PROFILE: NAV_DEFAULT_PROFILE,
    DEFAULT_SERVER_URL: NAV_DEFAULT_SERVER_URL,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    profile: navProfile
  };

  /* ---- live session state (one navigation at a time) ---- */
  var S = null; // built fresh on every render; torn down on exit
  /* v222 (NAV-STUCK-OCT22): the drive view froze solid on
     Deerfoot Trl — route + position static for the whole of the
     owner's recording while the truck moved. The drive consumes
     ONLY its own watchPosition stream, and a WebView geolocation
     watch can die SILENTLY (backgrounding, PiP round-trips,
     permission churn) — with the watch dead, no fix ever reaches
     onPos and the whole face stands still while the phone clock
     advances. Two nets now guard the stream: (1) the module also
     rides the app's own fix stream (LiveMiles.subscribe — the
     stream js/geo.js maintains with its own revive logic), routed
     through currentOnPos with timestamp dedupe; (2) a watchdog
     restarts the module's watch when fixes stop arriving. The
     subscription is wired ONCE per module lifetime (LiveMiles has
     no unsubscribe) and always routes to the CURRENT render. */
  var fixSubWired = false;
  var currentOnPos = null;
  function navFixFromMiles(fix) {
    if (!fix || !currentOnPos) return;
    if (typeof fix.latitude !== 'number' || typeof fix.longitude !== 'number') return;
    try {
      currentOnPos(fix.latitude, fix.longitude,
        (fix.bearing !== null && fix.bearing !== undefined) ? fix.bearing : fix.heading,
        fix.speed, fix.time);
    } catch (e) {}
  }
  /* v227 (NAV-NO-MOVEMENT-V39 — the DIFFERENT approach, owner
     Oct 22 evening: "Map is stuck"): nets 1 and 2 both ride
     WebView-fed streams, and BOTH can die the same silent death
     — the watch and js/geo.js's watcher live in the same WebView
     geolocation pipeline. The one GPS consumer that provably
     kept working in his worst incidents is the SHELL's own
     native listener (it is what kept the shift's miles counting
     while the faces froze). So the drive now takes a third
     intake fed by the shell itself: ShiftTrackPlugin pushes a
     'navFix' bridge event for every native fix while driving is
     armed (setDriving), over the Capacitor bridge — no WebView
     geolocation anywhere in the path. Wired ONCE per module
     lifetime like the LiveMiles net and always routed to the
     CURRENT render's native intake (currentNavOnPos), which
     dedupes on the native stream's OWN watermark (S.navFixT) —
     the v224 rule: streams never silence each other. On web /
     old shells the wrapper is absent and nets 1+2 carry on
     exactly as before. */
  var navFeedWired = false;
  var currentNavOnPos = null;
  function navFixFromNative(fix) {
    if (!fix || !currentNavOnPos) return;
    var la = Number(fix.latitude), lo = Number(fix.longitude);
    if (!isFinite(la) || !isFinite(lo)) return;
    try {
      currentNavOnPos(la, lo,
        (fix.bearing !== null && fix.bearing !== undefined) ? Number(fix.bearing) : null,
        (fix.speed !== null && fix.speed !== undefined) ? Number(fix.speed) : null,
        Number(fix.time) || 0);
    } catch (e) {}
  }
  function wireNavFeed() {
    if (navFeedWired) return;
    navFeedWired = true;
    try {
      if (window.ShiftTrack && typeof ShiftTrack.addNavFixListener === 'function') {
        ShiftTrack.addNavFixListener(navFixFromNative);
      }
    } catch (e) {}
  }
  /* v119: THE MERGE (owner, Oct 16 22:00 MDT: "Why are there 2
     modules? Navigation and navigator?") — this module is the
     ONE door. Its front face ('places') is the old Navigation
     face, rendered by that module as a component (tabs, picker,
     favorites, built-ins, Yard pick — storage keys untouched);
     its 'drive' face is this module's own plan/Drive screen.
     Picking a place there arms the big Navigate action, whose
     hand-off (nav_pending + openModule('navigator')) now lands
     INSIDE this module: render sees the pending destination and
     opens the drive face — the v104 auto-enter rules inside the
     drive face are unchanged. */
  var nvFace = 'places';
  var nvBody = null;

  /* v220 (PIP-REDESIGN, owner spec verbatim): in picture-in-
     picture the drive screen is NOT a miniature clone of the big
     map. (1) NO big truck avatar hiding the "now" — a POINTED
     ARROW marks the position. (2) NO directions bar on top — the
     next direction appears in SMALL WORDS AT THE BOTTOM
     (#nvd_pip_line, fed by the drive tick). (3) Integrated: the
     face is this same drive screen wearing .nv-pip, swapped on
     the shell's pipChanged event and restored on exit — one
     drive, two postures, no second screen to drift. */
  var pipWired = false;
  /* v222: document-level lookup, feature-detected (the parked
     drive screen lives outside the module body; partial DOMs
     without getElementById simply miss, as the body lookup did). */
  function docEl(id) {
    try { return (document && typeof document.getElementById === 'function') ? document.getElementById(id) : null; }
    catch (e) { return null; }
  }
  /* v273 (NAV-SMALL-SCREEN-BLUE — owner verdict, Oct 26, 2026
     17:46 MDT: minimised, the map is "basically turning
     blue"): the drive map is a Leaflet map sized ONCE, at
     drive start, for the full screen (plane 260%x300% of
     411x960 = ~1069x2880 px). When the window changes size —
     system PiP, fold/unfold, rotation — CSS shrinks the plane
     but Leaflet keeps its stale pixel size: the map centre
     sits at (534,1440) in container px, far outside the
     visible PiP plane (~575x417), so the window shows a
     stale-offset slice of map and, where the slice runs off
     the plane, the viewport's SKY GRADIENT (navy -> blue).
     Nothing re-fit the map on a size change: no invalidateSize
     on PiP enter/exit and no resize handler anywhere. The
     refit is the exact pair the parked-restore path already
     trusts (invalidateSize + a drive tick, which re-centres
     on followTarget and repaints the plane at the new size);
     the drive closure registers it as S._refitDrive when the
     map is created, because the tick lives in that closure.
     The bare invalidateSize below is the fallback for a drive
     whose hook is somehow absent. */
  function refitDriveMap() {
    try {
      if (!S || !S.drive) return;
      if (typeof S._refitDrive === 'function') { S._refitDrive(); return; }
      if (S.driveMap && S.driveMap.invalidateSize) S.driveMap.invalidateSize();
    } catch (e) {}
  }
  /* v273: the same stale-size defect on plain window resizes
     (this phone FOLDS — unfolding mid-drive changes the window
     with no PiP event at all). Debounced; a no-op unless a
     drive is live. */
  var driveResizeTimer = null;
  try {
    if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', function () {
        try {
          if (driveResizeTimer) clearTimeout(driveResizeTimer);
          driveResizeTimer = setTimeout(function () { driveResizeTimer = null; refitDriveMap(); }, 160);
        } catch (e) {}
      });
    }
  } catch (e) {}

  function applyPipFace(inPip) {
    try {
      if (S) S._inPip = !!inPip;
      /* v222: the drive screen may live in the shell dock (parked,
         in-app screen-in-screen) instead of the module body — the
         ids are unique in the document, so look them up globally
         (the body-scoped lookup silently missed the parked face). */
      var scr = docEl('nv_drive_screen') ||
        (nvBody ? nvBody.querySelector('#nv_drive_screen') : null);
      if (scr) scr.classList.toggle('nv-pip', !!inPip);
      /* v280 (NAV-PIP-NO-MIC-BUTTON): the PiP posture raises a
         body class the chat-FAB CSS keys off — in PiP the mic
         is display:none (his standing PiP law: no mic button
         on the PiP map face). Full-screen restore removes it. */
      try { if (document && document.body && document.body.classList) document.body.classList.toggle('mt-pip', !!inPip); } catch (e) {}
      var you = docEl('nvd_you') ||
        (nvBody ? nvBody.querySelector('#nvd_you') : null);
      if (you) {
        var kind = inPip ? 'arrow' : ((S && S.settings && S.settings.avatar) || 'dump');
        you.innerHTML = avatarGlyph(kind, 'm');
        /* the marker's whole inline style IS its box (the class
           carries position) — the same contract paintYou keeps */
        you.style.cssText = avatarBoxStyle(kind);
      }
      var line = docEl('nvd_pip_line') ||
        (nvBody ? nvBody.querySelector('#nvd_pip_line') : null);
      if (line) line.classList.toggle('hidden', !inPip);
      /* v273: the window just changed size (PiP in OR out) —
         re-fit the map to the size it actually has now. */
      refitDriveMap();
    } catch (e) {}
  }

  /* v222 (PIP-LANDS-HOME-OCT22, owner spec): Back on the map page
     sends the map into screen-in-screen AND OPENS THE MAIN
     DASHBOARD — the driver lands on his dashboard with the drive
     floated over it, never on the phone's home screen.
     v227 (BUBBLE-FACE-V39-FAIL — owner law restated Oct 22
     evening, in his hands): what FLOATS over the dashboard is
     the TRACKER FACE (the App bubble: timer, load count with
     big +/-, start/pause/stop colours, small words at the
     bottom) — NOT a miniature of the map. v222 floated the
     drive SCREEN itself wearing .nv-mini, and in his hands
     that was "the whole map miniaturized" — the exact face he
     rejected. So the drive screen now only SURVIVES in the
     dock, parked hidden (.nv-parked): the live drive (map,
     state, tick) stays intact underneath for the tap-back
     restore, while App.setDriveDocked raises the tracker face.
     A tap on the face reopens the Navigator full-screen (App
     wires the face); only End-drive or the map's X ends the
     drive. TRUE system PiP remains only for genuinely leaving
     the app (Home), via the native arm. */
  function parkDrive() {
    if (!S || !S.drive || S.parked) return false;
    var scr = docEl('nv_drive_screen');
    var dock = docEl('pipDock');
    if (!scr || !dock) return false;
    S.parked = true;
    scr.classList.remove('nv-mini');
    scr.classList.add('nv-parked');
    scr.classList.add('hidden');
    dock.appendChild(scr);
    try { if (window.App && App.setDriveDocked) App.setDriveDocked(true); } catch (e) {}
    try { if (window.App && App.showDashboard) App.showDashboard(); } catch (e) {}
    return true;
  }

  /* v78: the last destination a route was actually built for in
     this app session — the dashboard card's preview fact. It lives
     OUTSIDE S on purpose: teardown nulls S when the module closes,
     but the card should still say where the Navigator last went. */
  var lastNavDest = '';

  function teardown() {
    if (!S) return;
    /* v222 (PIP-LANDS-HOME): a PARKED live drive is not torn down —
       the drive is the thing the driver floated on purpose. The
       shell already skips teardown via keepAlive(); this guard is
       the same law inside the module (render's own teardown call
       included). */
    if (S.drive && S.parked) return;
    currentOnPos = null;
    currentNavOnPos = null;
    try { if (S.watchdogId) clearInterval(S.watchdogId); } catch (e) {}
    try { if (S.watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(S.watchId); } catch (e) {}
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}
    try { if (S.map) S.map.remove(); } catch (e) {}
    /* v101: the drive screen's map + arrival timer live on S too,
       so leaving the module mid-drive cleans them up as well. */
    try { if (S.driveTimer) clearTimeout(S.driveTimer); } catch (e) {}
    try { if (S.driveMap) S.driveMap.remove(); } catch (e) {}
    /* v135: leaving the module mid-drive also ends the drive
       state honestly — release the wake lock + its listener and
       the mt-driving body class (the FAB dock keys off it). */
    try {
      if (S.wakeSentinel && typeof S.wakeSentinel.release === 'function') S.wakeSentinel.release().catch(function () {});
      if (S.wakeVis) document.removeEventListener('visibilitychange', S.wakeVis);
      if (S.drive) document.body.classList.remove('mt-driving');
    } catch (e) {}
    S = null;
  }

  /* v183 (N-voice, owner Oct 20 19:50 MDT — in his hands the
     voice was SILENT all drive, and the mute button read broken):
     the v101 speak() lost utterances three ways in the Android
     WebView/Capacitor shell. (1) cancel() in the same tick as
     speak() drops the new utterance on WebView — now a busy
     synth is cancelled and the line is spoken ~70 ms later,
     while an idle synth speaks at once. (2) An utterance held
     only by a local variable can be garbage-collected mid-line
     in Chromium (the classic silent-cutoff bug) — voiceKeep
     holds it until it ends. (3) A paused synth (Chrome parks
     speechSynthesis) never starts — resume() is called first,
     and a voice is picked explicitly once voices load (an
     unvoiced utterance on some TTS engines says nothing).
     Unmuting now SPEAKS its confirmation, and the settings menu
     carries a Test voice button, so the driver can prove the
     voice with his own ears parked — machine proof is not the
     verdict, his hearing it is. The robust native path
     (a Capacitor text-to-speech plugin) needs a new APK and is
     parked BY NAME for the native pass in BUGS.md. */
  var voiceKeep = null;
  function speak(text) {
    if (!text || !S || S.settings.muted) return;
    /* v212 (NATIVE TTS — Stage E): in the Android shell the
       NATIVE speech engine says the line (ShiftTrack.speakText).
       It is not bound by the WebView speechSynthesis failure
       modes the v183 post-mortem catalogued (same-tick cancel
       drops, GC'd utterances, a parked synth), and it keeps
       talking with the app backgrounded or in PiP. The shim
       returns true only when the native side took the line;
       everywhere else — browser, iPhone, old shells, a dead
       engine — the WebView voice below runs exactly as before. */
    /* v280 (NAV-VOICE-SELECTION-PREF): a picked voice bypasses
       the native engine — speakText takes no voice, so the
       native default would erase his choice. The WebView path
       below picks the voice by voiceURI. */
    var pickedURI = (S.settings && S.settings.voiceURI) ? String(S.settings.voiceURI) : '';
    if (!pickedURI) {
      try {
        if (window.ShiftTrack && ShiftTrack.speakNative && ShiftTrack.speakNative(text)) {
          if (S) S.voiceSpokeAt = Date.now();
          return;
        }
      } catch (e) {}
    }
    try {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { S.voiceMissing = true; return; }
      var synth = window.speechSynthesis;
      try { synth.resume(); } catch (e) {}
      var voices = [];
      try { voices = synth.getVoices() || []; } catch (e) {}
      var doSpeak = function () {
        try {
          var u = new SpeechSynthesisUtterance(text);
          u.rate = 1.02; u.volume = 1; u.lang = 'en-CA';
          for (var i = 0; i < voices.length; i++) {
            if (pickedURI && voices[i].voiceURI === pickedURI) { u.voice = voices[i]; break; }
            if (!pickedURI && /^en/i.test(voices[i].lang || '')) { u.voice = voices[i]; break; }
          }
          voiceKeep = u;
          u.onend = u.onerror = function () { if (voiceKeep === u) voiceKeep = null; };
          synth.speak(u);
          if (S) S.voiceSpokeAt = Date.now();
        } catch (e) {}
      };
      if (synth.speaking || synth.pending) {
        try { synth.cancel(); } catch (e) {}
        setTimeout(doSpeak, 70);
      } else doSpeak();
    } catch (e) {}
  }

  var api = {
    /* v78: the card preview — where the Navigator last routed this
       session; before any route, the server/profile state. A
       cleared server always wins over a stale destination.
       v244 (NAV-GLANCE-LAST-DEST, owner Oct 23 15:10): the last
       place navigated to must SURVIVE the session — finalizeRoute
       persists the destination NAME in the navigator settings
       record (lastDest), and this glance reads it back, the way
       Revenue's glance reads its last entry from the store. The
       glance names places, never coordinates: a coordinate string
       (the label-less legacy fallback) is not a place name and
       never reaches the card.
       v254 (NAV-GLANCE-WRONG, owner Oct 24 17:56 MDT, his own
       screenshot): the card still showed "Truck · 24 t · Calgary
       truck ro…" — the v244 FALLBACK, not a destination. Root
       cause: lastDest is only ever written by a route finalizing
       on a v244+ build (v244 shipped the morning of Oct 24), so a
       store whose navigation history predates the field holds NO
       lastDest and the glance fell through to the truck profile
       line — truck specs were standing in for a place. His call:
       with no destination recorded the line reads "No trips yet";
       truck/routing data never stands in for a place. A recorded
       name is also shortened here to fit the card's one nowrap
       line (28 chars incl. the arrow, cut at a word boundary)
       instead of being cut mid-word by the card's ellipsis. */
    status: function () {
      var st = loadSettings();
      if (!st.serverUrl) return 'Server not set — routing off';
      var last = lastNavDest;
      if (last && /^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+/.test(last)) last = '';
      if (!last) {
        try {
          var stored = (App._store.get('navigator', {}) || {}).lastDest || '';
          if (stored && !/^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+/.test(stored)) last = stored;
        } catch (e) {}
      }
      if (last) {
        var line = '→ ' + last;
        if (line.length > 28) {
          var cut = last.slice(0, 25), sp = cut.lastIndexOf(' ');
          if (sp >= 10) cut = cut.slice(0, sp);
          line = '→ ' + cut.replace(/[\s,·-]+$/, '') + '…';
        }
        return line;
      }
      return 'No trips yet';
    },

    teardown: teardown,

    /* v116: shell back contract — the Drive screen is this
       module's sub-view, reached through the hook render installs
       on S. v119: the merged module's staircase is Drive → plan →
       PLACES (the front face) → home: Back in Drive exits to
       plan (S.backFn), Back at the plan root returns to the
       places face, Back on the places face exits the module.
       resetView lands fresh entry on the front face — unless a
       pending destination is waiting, which render promotes to
       the drive face (the in-module hand-off). */
    /* v222 (PIP-LANDS-HOME): the shell asks before tearing this
       module down — a parked live drive holds the module open
       (its state + the floated drive screen are the driver's
       live navigation; killing them was never the ask). */
    keepAlive: function () { return !!(S && S.drive && S.parked); },

    back: function () {
      if (nvFace === 'drive') {
        /* v222 (PIP-LANDS-HOME-OCT22, owner spec — supersedes the
           v220 system-PiP behaviour): while a DRIVE is live, Back
           on the map page sends the map into screen-in-screen
           AND opens the main dashboard beneath it (parkDrive) —
           Back NEVER kills navigation (it ends only via End
           Drive or the drive screen's own exit), and the driver
           never lands on the phone's home screen. Only where the
           in-app park is impossible (no shell dock — a partial
           page) does the old request fall to the system PiP
           bridge, and where that too is absent the v116
           staircase applies as before. */
        if (S && S.drive) {
          try { if (parkDrive()) return true; } catch (e) {}
          var pipSent = false;
          try { pipSent = !!(window.ShiftTrack && ShiftTrack.enterPip && ShiftTrack.enterPip()); } catch (e) {}
          if (pipSent) return true;
        }
        if (S && S.drive && typeof S.backFn === 'function' && S.backFn()) return true;
        nvFace = 'places';
        if (nvBody) api.render(nvBody);
        return true;
      }
      return false;
    },
    resetView: function () { nvFace = 'places'; },

    render: function (body) {
      nvBody = body;
      /* v220: hear the shell's PiP changes (once) — applyPipFace
         swaps this screen's PiP posture. Inert off-shell. */
      if (!pipWired) {
        pipWired = true;
        try { if (window.ShiftTrack && ShiftTrack.addPipListener) ShiftTrack.addPipListener(applyPipFace); } catch (e) {}
      }
      /* v222 (PIP-LANDS-HOME): reopening the Navigator with a
         drive PARKED in the shell dock restores the drive full-
         screen — the same drive, the same state bag, the drive
         screen re-homed into this body. The module is NOT
         re-initialised (a fresh render would rebuild S and kill
         the live drive — the exact tear-down the park exists to
         avoid). _restoredParked tells exitDrive to rebuild the
         module fresh when this drive finally ends, since the
         plan face was never rebuilt under it. */
      if (S && S.drive && S.parked) {
        var dockScr = docEl('nv_drive_screen');
        if (dockScr) {
          S.parked = false;
          S._restoredParked = true;
          nvFace = 'drive';
          body.innerHTML = '';
          body.appendChild(dockScr);
          dockScr.classList.remove('nv-mini');
          dockScr.classList.remove('nv-parked');
          dockScr.classList.remove('hidden');
          applyPipFace(false);
          /* v227: the tracker face stands down — the drive is
             full-screen again. */
          try { if (window.App && App.setDriveDocked) App.setDriveDocked(false); } catch (e) {}
          try { if (S.driveMap && S.driveMap.invalidateSize) S.driveMap.invalidateSize(); } catch (e) {}
          try { driveTick(); } catch (e) {}
          return;
        }
        /* the parked screen is gone (page rebuilt under it):
           fall through to a fresh render rather than a ghost. */
        S.parked = false;
      }
      var hasPending = false;
      try { hasPending = !!App._store.get('nav_pending', null); } catch (e) {}
      if (hasPending) nvFace = 'drive';
      if (nvFace === 'places') {
        teardown();
        var navMod = (window.Meticulous && Meticulous.modules.navigation) || null;
        if (navMod && typeof navMod.render === 'function') { navMod.render(body); return; }
        /* places component missing (partial load): fall through
           to the drive face rather than a dead screen. */
        nvFace = 'drive';
      }
      teardown();
      var settings = loadSettings();
      S = {
        settings: settings, map: null, userMarker: null, destMarker: null,
        routeLine: null, line: null, plan: null, dest: null, destLabel: '',
        pos: null, follow: true, watchId: null, manIdx: -1,
        /* v222 (NAV-STUCK): fix-stream health — the wall-clock of
           the last fix onPos accepted, the fix's own timestamp
           (the dedupe watermark for the fallback stream), and the
           watchdog that restarts a silently-dead watch. parked:
           the drive floated in the shell dock (PIP-LANDS-HOME). */
        lastFixAt: 0, lastFixT: 0, streamFixT: 0, navFixT: 0, watchdogId: null, parked: false,
        offSince: 0, rerouting: false, arrived: false, searching: false,
        /* v103: the auto-route latch — setDest arms it for the NEW
           destination only (autoKey), maybeAutoRoute consumes it
           once a position exists. Ending a route never re-arms
           it: re-routing after End is the driver's own tap. */
        autoKey: '', autoWanted: false,
        /* v104: the auto-Drive arm. goNowKey = the destination key
           when it arrived as a go-now hand-off (nav_pending) — a
           successful route to it enters Drive by itself. Any
           destination also enters Drive on route-ready while the
           truck is moving (speed, from the same watch). Fires
           once per arm: driveAutoSpent is set by the entry itself
           and by any Drive exit, and reset by a NEW destination. */
        goNowKey: '', pendGoNow: false, driveAutoSpent: false,
        /* v210: the driver's manual drive-view adjustments —
           two-finger rotate (deg offset) + tilt (pitch deg,
           null = the posture default). Both zero on snap-back. */
        viewRot: 0, viewPitch: null,
        speed: null,
        /* v104: position paints on the planning map wait for the
           settle pass (mapSettled) — see the map init below. */
        mapSettled: false, viewPainted: false,
        /* v101 drive mode: state bag + its own Leaflet instance and
           arrival timer (kept on S so teardown reaches them). */
        drive: null, driveMap: null, driveLine: null, driveMarker: null,
        driveTimer: null, heading: null,
        /* v262: live traffic — the fetched incident list, the
           last fetch attempt (the refresh gate), the ids already
           warned about on THIS route, and the marker groups for
           the planning map and the drive map. */
        trafficList: [], trafficAt: 0, trafficSaid: {}, trafficGroup: null, driveTrafficGroup: null,
        /* v280 (NAV-TRAFFIC-LIVE-ETA): live-ETA state — the
           pace window (rolling GPS distance/time samples from
           onPos), the licensed-provider traffic probe/poll
           state (the server endpoint answers only when the
           provider key is configured server-side — none is on
           the box yet), and the faster-route offer's one-shot
           arm + the ETA it must beat. */
        paceWin: [], paceCum: 0, paceLastV: 0, paceLastAt: 0, paceLastCum: 0,
        providerChecked: false, providerLive: false, providerEta: null, providerAt: 0,
        providerName: '', offerFor: '', offerEta: 0, liveEtaMin: 0,
        /* v135: the drive wake lock's sentinel + visibility
           handler (see driveWake in the drive section). */
        wakeSentinel: null, wakeVis: null
      };

      /* v101: the Navigator is a FULL-SCREEN view (owner, Oct 16:
         the small map card inside the scrolling page is rejected).
         A fixed shell fills the screen: slim header with the way
         back, the map filling everything between, and the three
         destination doors (favorites, typed address, tap-the-map
         pin) plus the route actions in a bottom sheet OVER the
         shell — the map itself stays visible above it. The drive
         screen (below) layers over this shell. */
      var h = '<div class="nv-shell">' +
        '<div class="nv-shell-head"><button class="btn ghost small" id="nv_back">← Back</button>' +
        '<span class="nv-shell-title">🧭 Navigator</span>' +
        /* v177 (F4): THE GEAR — the Navigator's own settings menu
           lives inside the module now (see nvSettingsHTML below).
           The same menu is reachable from Preferences through a
           door that sets nav_open_settings and lands here — one
           menu, two doors, one settings object. */
        '<button class="btn ghost small" id="nv_gear" style="margin-left:auto" aria-label="Navigator settings">⚙️ Settings</button></div>' +
        '<div id="nv_settings" class="nv-settings hidden"></div>' +
        '<div class="nv-mapzone">' +
        '<div id="nv_map" class="nv-map"></div>' +
        '<div id="nv_banner" class="nv-banner nv-banner-overlay"><div class="nv-banner-main">Where to?</div>' +
        '<div class="nv-banner-sub">Search for a place, or tap the map to drop a pin.</div></div>' +
        /* v103: Truck/Car + Follow + Sound demoted to ONE small
           quiet row — same controls, same ids, but no loud
           primary styling: they are settings, not steps on the
           way to navigating. The active mode reads navy; the
           rest are ghost. */
        '<div class="row nv-maprow">' +
        '<button class="btn small ' + (settings.mode === 'truck' ? 'navy' : 'ghost') + '" id="nv_mode_truck" style="flex:1">🚛 Truck</button>' +
        '<button class="btn small ' + (settings.mode === 'car' ? 'navy' : 'ghost') + '" id="nv_mode_car" style="flex:1">🚗 Car</button>' +
        '<button class="btn small ghost" id="nv_follow" style="flex:1">🎯 Follow: on</button>' +
        '<button class="btn small ghost" id="nv_mute" style="flex:1">' + (settings.muted ? '🔇 Sound: off' : '🔊 Sound: on') + '</button>' +
        '</div></div>';

      h += '<div class="nv-sheet">';
      /* v104: ▶ Drive is pinned at the TOP of the sheet — the
         first thing in it, above the Destination card and its
         recents. Owner's Oct 16 video: the route computed, but
         Drive sat below the Destination card's place list, out
         of the viewport — an active route's one next action can
         never hide under a scroll fold. Hidden until a server
         route is ACTIVE (doRoute reveals it; clearRoute hides
         it again) — the id and classes are unchanged, only the
         slot moved. */
      h += '<button class="btn primary big hidden" id="nv_drive" style="margin-bottom:8px">▶ Drive</button>';
      if (!settings.serverUrl) {
        h += '<div class="card" style="border:2px solid #f5a623;background:#fff8e6">' +
          '<b>Navigator server not set — routing unavailable.</b><br>' +
          '<span style="color:#555">Set the Navigator server URL in Preferences → Advanced. The map and your position still work below.</span></div>';
      }
      h += '<div class="card"><h3>📍 Destination</h3>' +
        '<label class="f">Address or place</label>' +
        '<div class="row"><input id="nv_q" placeholder="e.g. Foothills Industrial Park, Calgary" style="flex:1">' +
        '<button class="btn navy" id="nv_search">Search</button></div>' +
        '<div id="nv_results"></div>' +
        /* v103 door 1: the SAME search-first picker as Navigation
           (the Navigation module's shared component — recents-only
           by default, the full list only as filter matches). The
           v84–v102 built-ins <select> is gone. One tap on a row
           sets the destination — and setDest auto-routes. */
        '<label class="f">Your pits & job sites</label>' +
        '<input id="nv_pq" placeholder="Type to find a place…" style="width:100%">' +
        '<div id="nv_presults" style="margin-top:4px"></div>' +
        '<p class="note" id="nv_destnote">No destination yet. Search above, tap the map, or pick a place below.</p>' +
        /* v103: ONE action path — destination → route (automatic
           when a server is set) → Drive. Route stays as the
           manual/re-plan affordance: primary only until a route
           is active, when Drive takes the slot and Route demotes
           to a quiet ghost (doRoute/clearRoute paint that). The
           v93 external handoff button is DELETED (owner ruling:
           navigation never leaves the app).
           v104: the Drive button itself no longer lives here —
           it is pinned at the TOP of the sheet (see above), so
           revealing it never leaves it below this card's fold. */
        '<button class="btn primary big" id="nv_route" style="margin-top:8px">🧭 Route</button>' +
        '<button class="btn ghost hidden" id="nv_end" style="margin-top:8px">End route</button>' +
        '<p class="note" id="nv_note"></p></div>';

      h += '<div class="card"><h3>🪜 Directions</h3><div id="nv_steps"><div class="empty">No route yet.</div></div></div></div>';

      /* v101 DRIVE SCREEN — a dedicated full-screen mode (fixed
         overlay; rendered hidden with the module so teardown is the
         ordinary innerHTML replacement). The map inside is a SECOND
         Leaflet instance on its own container, created on Drive and
         removed on exit; position comes from this module's ONE
         existing watchPosition stream (see onPos) — drive mode adds
         no GPS consumer of its own.
         v139: the 3D stack is ONE element now — .nv-drive-plane,
         a 190% plane centred on the driver anchor (50% / 64%),
         carrying the map; the tick writes its single composed
         transform (see planeTransform + style.css). EVERYTHING
         else on the face — banner, marker, chooser, reroute pill,
         bar — is a direct child of .nv-drive, outside the plane
         and outside the viewport box, in a plain untransformed
         context (the v135 tree kept the marker/chooser/pill
         inside the perspective viewport; the banner/bar were
         promoted layers beside it — all of them broke on glass). */
      h += '<div id="nv_drive_screen" class="nv-drive hidden">' +
        '<div class="nv-drive-top">' +
        '<div class="nv-drive-dist" id="nvd_dist"></div>' +
        '<div class="nv-drive-toptext">' +
        '<div class="nv-drive-inst" id="nvd_inst"></div>' +
        '<div class="nv-drive-road" id="nvd_road"></div></div></div>' +
        /* v178 (F2): the turn inset — a Rand McNally style pop-up
           that appears as a turn approaches: a big arrow bent by
           the route's own geometry at that turn (see
           turnDeltaDeg) over the distance + instruction. Lane
           data is NOT in the routing response (see BUGS.md), so
           the inset shows the turn, never invented lanes. */
        '<div class="nv-drive-inset hidden" id="nvd_inset"></div>' +
        '<div class="nv-drive-viewport">' +
        '<div class="nv-drive-plane" id="nvd_plane"><div id="nv_drive_map" class="nv-drive-map"></div></div>' +
        '</div>' +
        /* v220 (PIP-REDESIGN): the PiP face's only words — the
           next direction in SMALL TEXT AT THE BOTTOM, like
           Google's PiP. Hidden unless the drive screen is in
           picture-in-picture (the .nv-pip class, driven by the
           shell's pipChanged event). */
        '<div class="nv-drive-pip-line hidden" id="nvd_pip_line"></div>' +
        /* v135: the avatar is a TRUCK now (see avatarGlyph), and
           it is TAPPABLE — a tap opens the chooser docked above
           the bar; the choice persists in the navigator settings
           and applies at the tap. The chooser lists the kinds in
           AVATAR_KINDS order with the current one marked.
           v139: the marker is sized + margin-centred inline from
           AVATAR_BOX (paintYou keeps it so on a change). */
        '<div class="nv-drive-you" id="nvd_you" title="Your truck — tap to change" style="' + avatarBoxStyle(settings.avatar) + '">' + avatarGlyph(settings.avatar, 'm') + '</div>' +
        '<div class="nv-avatar-picker hidden" id="nvd_avatar_picker">' +
        AVATAR_KINDS.map(function (k) {
          return '<button class="nv-avatar-opt' + (k === settings.avatar ? ' on' : '') + '" data-avatar="' + k + '">' +
            avatarGlyph(k, 'p') + '<span>' + AVATAR_LABELS[k] + '</span></button>';
        }).join('') +
        '</div>' +
        '<div class="nv-drive-reroute hidden" id="nvd_reroute">Rerouting…</div>' +
        /* v262: the traffic-ahead chip — same state-gated pill
           pattern as the reroute line above it; the tick shows
           it while an incident sits on the route ahead. */
        '<div class="nv-drive-traffic hidden" id="nvd_traffic"></div>' +
        /* v280 (NAV-TRAFFIC-LIVE-ETA): the faster-route offer
           pill — same transient pill family as the traffic chip,
           one stack line above it; it exists only while an offer
           is live (traffic is measurably slowing the drive) and
           its tap re-checks the route. Never a card, never over
           the road centre (C6 chrome budget). */
        '<button class="nv-drive-offer hidden" id="nvd_offer"></button>' +
        /* v183 (pinch-to-zoom): appears only while the driver is
           in free-look (he pinched or dragged the drive map);
           one tap puts the map back on the truck. */
        '<button class="btn navy hidden" id="nvd_recenter" style="position:absolute;left:50%;transform:translateX(-50%);bottom:84px;z-index:6">🎯 Back to my truck</button>' +
        /* v177 (F4): the on-screen speedometer + speed-limit
           badge — overlays the settings toggles show/hide. The
           speed is the GPS stream's own speed; the limit badge
           only ever shows a limit the route data actually
           carries (none today — see BUGS.md: the Valhalla
           response carries no per-edge maxspeed, so the badge
           stays hidden rather than inventing a number). */
        '<div class="nv-drive-speed" id="nvd_speedwrap">' +
        '<div class="nv-drive-speedo" id="nvd_speed">–</div>' +
        '<div class="nv-drive-limit hidden" id="nvd_limit"></div></div>' +
        /* v240 (NAV-LAYERS-BUTTON): the Google-style layers
           control — a corner button docked bottom-right on the
           speedometer's line (the dock v237 vacated), opening
           a small panel: Standard / Satellite / Traffic /
           Elevation. Traffic's entry began as the button ahead
           of the data (v240, owner's order); v262 wires it for
           real — it is the live-traffic overlay's on/off switch
           (City of Calgary current incidents), not a base layer,
           so it toggles independently of the base choice. */
        '<button class="nv-layers-btn" id="nvd_layers" aria-label="Map layers" title="Map layers">' +
        '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 3 L22 8.5 L12 14 L2 8.5 Z" fill="#ffffff"/><path d="M3.5 12.5 L12 17 L20.5 12.5" fill="none" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/><path d="M3.5 16.5 L12 21 L20.5 16.5" fill="none" stroke="#9db8e8" stroke-width="2" stroke-linejoin="round"/></svg></button>' +
        '<div class="nv-layers-panel hidden" id="nvd_layers_panel">' +
        '<div class="nv-layers-title">Map layers</div>' +
        '<button class="nv-layer-opt" id="nvd_layer_standard">🗺️ Standard</button>' +
        '<button class="nv-layer-opt" id="nvd_layer_satellite">🛰️ Satellite</button>' +
        '<button class="nv-layer-opt" id="nvd_layer_traffic">🚦 Traffic</button>' +
        '<button class="nv-layer-opt" id="nvd_layer_elevation">⛰️ Elevation</button>' +
        '<div class="nv-layers-note hidden" id="nvd_layers_note"></div>' +
        '</div>' +
        '<div class="nv-drive-bar">' +
        /* v125: the ETA stack is NEVER blank — it renders with a
           visible placeholder from the moment Drive opens, and
           the first drive tick (which runs synchronously in
           startDrive) replaces it with the live arrival clock.
           A bar whose arrival stack only exists after a
           successful tick is a bar that can show nothing. */
        '<div class="nv-drive-eta"><div class="nv-drive-eta-main" id="nvd_eta_main">--:--</div>' +
        '<div class="nv-drive-eta-sub" id="nvd_eta_sub">Getting your arrival time…</div></div>' +
        '<button class="btn ghost nv-mute' + (settings.muted ? ' muted' : '') + '" id="nvd_mute" aria-pressed="' + (settings.muted ? 'true' : 'false') + '" aria-label="' + (settings.muted ? 'Unmute voice guidance' : 'Mute voice guidance') + '" title="' + (settings.muted ? 'Unmute voice guidance' : 'Mute voice guidance') + '">' + muteIcon(settings.muted) + '</button>' +
        '<button class="btn ghost" id="nvd_gear" aria-label="Navigator settings">⚙️</button>' +
        '<button class="btn primary" id="nvd_exit">End drive</button>' +
        '</div></div></div>';
      body.innerHTML = h;

      var note = function (t) { var n = body.querySelector('#nv_note'); if (n) n.textContent = t || ''; };
      var banner = function (main, sub) {
        var b = body.querySelector('#nv_banner'); if (!b) return;
        b.querySelector('.nv-banner-main').textContent = main;
        b.querySelector('.nv-banner-sub').textContent = sub || '';
      };

      /* ---------- map ---------- */
      var mapEl = body.querySelector('#nv_map');
      if (window.L && mapEl) {
        S.map = L.map('nv_map', { zoomControl: true }).setView([51.05, -114.06], 11);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
        }).addTo(S.map);
        S.map.on('click', function (e) {
          pinTap([e.latlng.lat, e.latlng.lng]);
        });
        S.map.on('dragstart', function () {
          if (S.follow) { S.follow = false; paintFollow(); }
        });
        /* v104: the settle pass. The owner's Oct 16 videos show a
           giant blue disc ballooning over the map for a frame or
           two as the Navigator opens — the user-position
           circleMarker (fill #3f7de0, ring #1F3764 — the disc's
           exact colours) painted, and the view animated, while
           the shell was still settling and Leaflet's size/zoom
           state was bogus. So the first position paint WAITS for
           this pass: invalidateSize lands, the gate opens, and
           any position that already arrived paints then (its
           first view jumps without animation — see paintPos).
           The disc cannot form, and later fixes paint live as
           before. */
        setTimeout(function () {
          try {
            if (!S || !S.map) return;
            S.map.invalidateSize();
            S.mapSettled = true;
            paintPos();
          } catch (e) {}
        }, 250);
      } else if (mapEl) {
        mapEl.innerHTML = '<div class="empty" style="padding:18px">The map library could not load — it needs internet once. Routing controls below still work.</div>';
      }
      function paintFollow() {
        var b = body.querySelector('#nv_follow');
        if (b) b.textContent = S.follow ? '🎯 Follow: on' : '🎯 Follow: off';
      }

      /* ---------- destination ---------- */
      /* v103: the destination line — one writer, so every door
         (search, picker, pin, pending) words it the same way.
         With a server set there is no "tap Route" instruction:
         picking the destination IS the instruction (auto-route
         below). Without one, the line says plainly why no route
         will come. */
      function paintDestNote(text) {
        var dn = body.querySelector('#nv_destnote');
        if (dn) dn.textContent = text + (S.settings.serverUrl ? '' :
          ' — routing needs the Navigator server (Preferences → Advanced).');
      }
      function setDest(latlng, label, goNow) {
        S.dest = latlng; S.destLabel = label || '';
        S.arrived = false;
        if (S.map) {
          if (S.destMarker) S.destMarker.setLatLng(latlng);
          else S.destMarker = L.marker(latlng).addTo(S.map);
        }
        paintDestNote('Destination: ' + (label || (latlng[0].toFixed(5) + ', ' + latlng[1].toFixed(5))));
        banner('Destination set', S.settings.serverUrl
          ? (S.pos ? 'Getting your ' + (S.settings.mode === 'car' ? 'car' : 'truck') + ' route…'
                   : 'Your route starts as soon as your location lands.')
          : 'Routing is off — the Navigator server is not set.');
        /* v103: a NEW destination arms the auto-route latch —
           the same destination re-set (a reverse-geocode rename,
           a re-tap of the same pin) does not re-fire it. */
        var key = latlng[0].toFixed(6) + ',' + latlng[1].toFixed(6);
        if (key !== S.autoKey) {
          S.autoKey = key; S.autoWanted = true;
          /* v104: a new destination is a new arm for auto-Drive
             too — entry gets its one shot again, and the arm is
             a go-now arm only when this setDest carries the
             hand-off's intent (goNow), or a pending hand-off is
             still being carried through the search door — an
             intent the FIRST destination set consumes, so a
             later parked pick in the same session stays a
             planning pick. */
          S.driveAutoSpent = false;
          S.goNowKey = (goNow || S.pendGoNow) ? key : '';
          S.pendGoNow = false;
        } else if (goNow) {
          S.goNowKey = key;
        }
        maybeAutoRoute();
      }

      /* v103: AUTO-ROUTE — arriving with a destination armed
         (the nav_pending hand-off, or any in-Navigator pick)
         requests the route on its own when a server URL is set:
         no separate Route tap stands between the driver and
         Drive. Fires once per new destination, only when there
         is a position to route FROM and no route is up yet; if
         the position is still coming, onPos fires it on the
         first fix. Route remains as the manual re-plan tap. */
      function maybeAutoRoute() {
        if (!S.autoWanted || !S.settings.serverUrl || !S.dest || !S.pos) return;
        if (S.plan || S.rerouting) return;
        S.autoWanted = false;
        doRoute();
      }

      /* v101 door 3: tap-the-map pin (owner, Oct 16: anyone not
         choosing from favorites needs this door). A single tap
         drops — or moves — the destination pin, and the
         destination line shows the point itself (its coordinates),
         so what will be routed to is never a guess. A best-effort
         reverse lookup on the SAME free Nominatim service the
         address search already uses adds the road/place name when
         it answers — no new service, no key; offline, the line
         simply stays "Dropped pin (coords)". */
      function pinTap(latlng) {
        setDest(latlng, 'Dropped pin');
        var coords = latlng[0].toFixed(5) + ', ' + latlng[1].toFixed(5);
        paintDestNote('Destination: Dropped pin (' + coords + ')');
        if (typeof fetch !== 'function') return;
        fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=' + latlng[0] + '&lon=' + latlng[1])
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (!j || !S.dest || S.dest[0] !== latlng[0] || S.dest[1] !== latlng[1]) return;
            var nm = (j.address && (j.address.road || j.address.neighbourhood || j.address.suburb)) || j.name || '';
            if (!nm && j.display_name) nm = String(j.display_name).split(',')[0];
            if (!nm) return;
            S.destLabel = nm;
            paintDestNote('Destination: ' + nm + ' (' + coords + ')');
          })
          .catch(function () {});
      }

      var searchBtn = body.querySelector('#nv_search');
      /* v183: ALL saved places (work + personal), read through
         the Navigation module's shared picker data — the search
         consults this list BEFORE any geocoder (see the handler
         below). Entries arrive as {place, src}; flattened here. */
      function savedPlacesAll() {
        var out = [];
        try {
          var navMod2 = window.Meticulous && Meticulous.modules.navigation;
          if (navMod2 && navMod2.pickerEntries) {
            ['work', 'personal'].forEach(function (kind) {
              var res = navMod2.pickerEntries(kind, '');
              /* pickerEntries with an empty query returns recents
                 only; a per-word probe below covers the rest, so
                 ALSO pull the query-filtered rows for the text. */
              if (res && res.rows) res.rows.forEach(function (e) { if (e.place) out.push(e.place); });
            });
          }
        } catch (e) {}
        return out;
      }
      function savedMatchesFor(q) {
        var pool = savedPlacesAll();
        try {
          var navMod3 = window.Meticulous && Meticulous.modules.navigation;
          if (navMod3 && navMod3.pickerEntries) {
            ['work', 'personal'].forEach(function (kind) {
              var res = navMod3.pickerEntries(kind, q);
              if (res && res.rows) res.rows.forEach(function (e) {
                if (e.place && pool.indexOf(e.place) === -1) pool.push(e.place);
              });
            });
          }
        } catch (e) {}
        return matchSavedPlaces(pool, q);
      }
      searchBtn.onclick = function () {
        var q = body.querySelector('#nv_q').value.trim();
        var box = body.querySelector('#nv_results');
        if (!q) { note('Type an address or place name first.'); return; }
        if (S.searching) return;
        /* v183: SAVED PLACES WIN THE SEARCH. A match with a pin
           IS the destination (no geocoder involved); a match
           with only an address re-searches by the ADDRESS ALONE
           (never name+address — the glued query is what made
           "Home, 1243 Cornerstone…" unfindable). Only when no
           saved place matches does the typed text go to the
           geocoder, and even then a leading saved-place name is
           stripped from a retry (see below). */
        var saved = savedMatchesFor(q);
        if (saved.length) {
          var pin = null, addrOnly = null, i2;
          for (i2 = 0; i2 < saved.length; i2++) {
            if (saved[i2].lat && saved[i2].lng) { pin = saved[i2]; break; }
            if (!addrOnly && saved[i2].address) addrOnly = saved[i2];
          }
          if (pin) {
            box.innerHTML = '';
            var pn = (navPicker && navPicker.displayPlaceName) ? navPicker.displayPlaceName(pin) : pin.name;
            var qEl2 = body.querySelector('#nv_q'); if (qEl2) qEl2.value = pn || q;
            setDest([Number(pin.lat), Number(pin.lng)], pn || pin.name || 'Saved place', true);
            if (S.map) S.map.setView(S.dest, 14);
            note('Found your saved place: ' + (pn || pin.name || '') + '.');
            return;
          }
          if (addrOnly) {
            var qEl3 = body.querySelector('#nv_q'); if (qEl3) qEl3.value = addrOnly.address;
            q = addrOnly.address;
          }
        }
        S.searching = true; box.innerHTML = '<p class="note">Searching…</p>';
        fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=ca&q=' + encodeURIComponent(q))
          .then(function (r) { return r.json(); })
          .then(function (rows) {
            S.searching = false;
            if (!rows || !rows.length) {
              /* v183: one honest retry — a query like "Home, 1243
                 Cornerstone Boulevard" fails whole; the address
                 after the first comma often resolves. Retry once
                 with the name segment dropped, never in a loop. */
              var comma = q.indexOf(',');
              if (comma > 0 && !S._geoRetried) {
                S._geoRetried = true;
                var q2 = q.slice(comma + 1).trim();
                var qEl4 = body.querySelector('#nv_q'); if (qEl4) qEl4.value = q2;
                if (q2) { searchBtn.onclick(); return; }
              }
              S._geoRetried = false;
              /* v209: a pending arrival that resolves to nothing
                 spends its go-now intent here — a later manual
                 search must never inherit it and auto-pick. */
              S.pendGoNow = false;
              S.pendName = '';
              box.innerHTML = '<p class="note">No places found for “' + esc(q) + '”. If it is one of your saved places, pick it from Your pits & job sites below.</p>'; return;
            }
            S._geoRetried = false;
            /* v209 (NAV-2STEP, owner Oct 21, 2026 12:58 MDT —
               "This should be a 2 step process"): this search IS
               a saved place arriving through nav_pending (the
               driver's two steps — tap the place, tap Navigate —
               are already spent). Take the top result as the
               destination outright: no results list, no "Use
               this" tap stands between him and Routing… The
               place LEARNS the pin (Navigation.learnCoords), so
               every later trip hands the coordinates over
               directly and never searches at all. A manual search
               (pendGoNow false) keeps the list + confirm below —
               that form is for NEW places. */
            if (S.pendGoNow) {
              var topRow = rows[0];
              S.pendGoNow = false;
              box.innerHTML = '';
              setDest([Number(topRow.lat), Number(topRow.lon)], topRow.display_name.split(',').slice(0, 2).join(','), true);
              if (S.map) S.map.setView(S.dest, 14);
              try {
                var navLearn = window.Meticulous && Meticulous.modules.navigation;
                if (navLearn && navLearn.learnCoords && S.pendName) {
                  navLearn.learnCoords(S.pendName, Number(topRow.lat), Number(topRow.lon));
                }
              } catch (e) {}
              S.pendName = '';
              return;
            }
            box.innerHTML = rows.map(function (r, i) {
              return '<div class="listitem"><div class="a">' + esc(r.display_name.split(',').slice(0, 2).join(',')) + '</div>' +
                '<div class="b">' + esc(r.display_name) + '</div>' +
                '<div class="row" style="margin-top:6px"><button class="btn small navy" data-nvhit="' + i + '">Use this</button></div></div>';
            }).join('');
            box.querySelectorAll('[data-nvhit]').forEach(function (b) {
              b.onclick = function () {
                var r = rows[Number(b.getAttribute('data-nvhit'))];
                setDest([Number(r.lat), Number(r.lon)], r.display_name.split(',').slice(0, 2).join(','));
                box.innerHTML = '';
                if (S.map) S.map.setView(S.dest, 14);
              };
            });
          })
          .catch(function () { S.searching = false; box.innerHTML = '<p class="note">Search could not run — check your connection.</p>'; });
      };

      /* v103 door 1: the places picker — the Navigation module's
         shared search-first component (pickerEntries /
         pickerRowHTML / pickerFind), so this door behaves
         EXACTLY like the Places card: recents-only by default
         (at most ~6 most recently visited), the full list only
         as filter matches while typing, FULL names, one tap
         picks. A pinned place sets the destination on the pin
         itself (setDest auto-routes); an address-only place
         hands its address to the search above — the same path
         an address-only pending destination takes. The module
         is read lazily so load order never matters; without it
         the door simply stays empty. */
      var navPicker = null;
      try {
        if (window.Meticulous && Meticulous.modules.navigation &&
            Meticulous.modules.navigation.pickerEntries) navPicker = Meticulous.modules.navigation;
      } catch (e) { navPicker = null; }
      var nvPickQ = '';
      function paintNvPlaces() {
        var box = body.querySelector('#nv_presults');
        if (!box || !navPicker) return;
        var res = navPicker.pickerEntries('work', nvPickQ);
        if (!res.rows.length) {
          box.innerHTML = '<div class="empty">' +
            (nvPickQ.trim() ? 'No place matches that.' : 'Places you go to will show here — type to find any place.') + '</div>';
          return;
        }
        box.innerHTML = (res.recents ? '<p class="note" style="margin:2px 0 0">🕘 Recent places</p>' : '') +
          res.rows.map(function (e) { return navPicker.pickerRowHTML(e, ''); }).join('');
        box.querySelectorAll('[data-pid]').forEach(function (b) {
          b.onclick = function () {
            var e = navPicker.pickerFind('work', b.getAttribute('data-pid'));
            if (!e) return;
            var p = e.place;
            /* v107 — THE TAP RULE (owner, Oct 16 20:13): "When I
               touch any of the saved addresses it should populate
               in the search bar itself!" EVERY tap writes the place
               into the destination search box first; the route flow
               continues from the populated box — a pinned place
               also sets the destination from its pin (as before),
               an address-only place runs the search (as before). */
            var q = body.querySelector('#nv_q');
            /* v118: the box + the destination label get the
               RESOLVED name — a pin-saved place whose stored name
               is its own coordinates shows its real name here
               (navPicker.displayPlaceName), never the raw pair. */
            var pName = (navPicker.displayPlaceName ? navPicker.displayPlaceName(p) : p.name);
            if (p.lat && p.lng) {
              if (q) q.value = pName;
              setDest([p.lat, p.lng], pName);
              if (S.map) S.map.setView(S.dest, 14);
            } else if (p.address) {
              if (q && searchBtn) { q.value = p.address; searchBtn.onclick(); }
            }
          };
        });
      }
      var pqEl = body.querySelector('#nv_pq');
      if (pqEl && typeof pqEl.addEventListener === 'function') {
        pqEl.addEventListener('input', function () { nvPickQ = pqEl.value; paintNvPlaces(); });
      }
      paintNvPlaces();

      /* v87: a place picked in Navigation arrives as a one-shot
         pending destination (owner: places live in ONE field there
         now, and the one action is Navigate — into THIS navigator,
         not a row of other apps' buttons). It lands through the
         same setDest the picker above uses, so everything
         downstream is identical whichever door the driver came
         through: a pin sets the destination outright; an
         address-only place fills the search box and runs the very
         search a manual tap would. Consumed once, then cleared. */
      try {
        var pend = (window.App && App._store) ? App._store.get('nav_pending', null) : null;
        if (pend) {
          App._store.del('nav_pending');
          /* v101 (field fix, Oct 16): a destination that ARRIVES
             with coordinates is set from those coordinates — never
             geocoded. Three arrival shapes, in order: explicit
             lat/lng fields; a coordinate pair inside the query or
             address text (a favorite whose pin was saved as its
             address text lands here — geocoding that text matched
             a children's playground kilometres away instead of the
             favorite's own pin); only then, a plain text search.
             Geocoding is for text the user typed themselves. */
          var pendCoords = null;
          if (pend.lat && pend.lng) {
            var pla = Number(pend.lat), plng = Number(pend.lng);
            if (isFinite(pla) && isFinite(plng)) pendCoords = [pla, plng];
          }
          if (!pendCoords) {
            pendCoords = parseLatLngText(pend.query) || parseLatLngText(pend.address) ||
              parseLatLngText(pend.name);
          }
          if (pendCoords) {
            var pendName = String(pend.name || '');
            if (parseLatLngText(pendName)) {
              pendName = pendName.replace(/,?\s*-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}\s*$/, '').trim();
            }
            /* v104: the hand-off IS the go-now intent — when this
               route lands, Drive opens by itself (maybeAutoEnter-
               Drive). */
            setDest(pendCoords, pendName || 'Dropped pin', true);
            if (S.map) S.map.setView(S.dest, 14);
          } else if (pend.query) {
            /* v104: the address path keeps the intent on file —
               the setDest that lands from this search (the row
               the driver taps) inherits it (see setDest).
               v183: FIRST check the saved places by the pending
               NAME — a saved place with a pin (e.g. Home) must
               land as a destination outright, never as a geocoder
               query; this was the Navigate loop: the tap set the
               pending, the search failed on the glued query, and
               the driver was back on the destination page. */
            S.pendGoNow = true;
            /* v209: the arriving place's name rides along — when
               the search below resolves it, the place learns its
               pin under this name (Navigation.learnCoords). */
            S.pendName = String(pend.name || '');
            var pendSaved = savedMatchesFor(pend.name || '');
            var pendPin = null;
            for (var psi = 0; psi < pendSaved.length; psi++) {
              if (pendSaved[psi].lat && pendSaved[psi].lng) { pendPin = pendSaved[psi]; break; }
            }
            if (pendPin) {
              S.pendGoNow = false;
              setDest([Number(pendPin.lat), Number(pendPin.lng)], pend.name || pendPin.name || 'Saved place', true);
              if (S.map) S.map.setView(S.dest, 14);
            } else {
              var pq = body.querySelector('#nv_q');
              if (pq && searchBtn) { pq.value = pend.query; searchBtn.onclick(); }
            }
          }
        }
      } catch (e) {}

      /* ---------- GPS follow ---------- */
      /* v101: heading rides the SAME single watch — drive mode
         consumes this stream and nothing else. GPS heading is null
         when stationary; the last real heading is kept so the
         drive map never spins while the truck is stopped.
         v104: speed rides it too (the already-moving signal for
         auto-Drive) — same treatment, the last real value kept. */
      /* v104: the ONLY writer of the position paint on the
         planning map (marker + follow view), called from onPos
         once the map has settled and from the settle pass itself
         for a position that arrived earlier. The first PAINTED
         view jumps straight to navigation zoom without animation
         — an animated zoom over an unsettled size is what blew
         the marker up into the opening disc (see the map init). */
      function paintPos() {
        if (!S.map || !S.pos) return;
        if (S.userMarker) S.userMarker.setLatLng(S.pos);
        else S.userMarker = L.circleMarker(S.pos, { radius: 8, color: '#1F3764', weight: 2, fillColor: '#3f7de0', fillOpacity: 0.9 }).addTo(S.map);
        if (S.follow) {
          if (!S.viewPainted) { S.viewPainted = true; S.map.setView(S.pos, 15, { animate: false }); }
          else S.map.setView(S.pos, S.map.getZoom());
        }
      }
      /* v280 (NAV-TRAFFIC-LIVE-ETA): the LIVE PACE window —
         rolling GPS samples (wall time + cumulative metres)
         kept for the last 180 s. The observed pace over the
         window is the honest congestion signal the app owns:
         when traffic slows the truck, the pace drops and the
         ETA extends — no invented delay figures anywhere. */
      function paceSample(prevPos, newPos) {
        if (!prevPos || !newPos) return;
        var d = haversineM(prevPos, newPos);
        if (!(d >= 3)) return; /* jitter is not travel */
        S.paceCum = (S.paceCum || 0) + d;
        S.paceWin = S.paceWin || [];
        S.paceWin.push({ at: Date.now(), cum: S.paceCum });
        var cut = Date.now() - 180000;
        while (S.paceWin.length > 1 && S.paceWin[0].at < cut) S.paceWin.shift();
      }
      function paceSpeed() {
        var w = S.paceWin || [];
        if (w.length >= 2) {
          var first = w[0], last = w[w.length - 1];
          var dt = (last.at - first.at) / 1000, dd = last.cum - first.cum;
          if (dt >= 45 && dd >= 150) { /* enough road to judge */
            var v = dd / dt;
            if (v >= 1 && v <= 45) {
              S.paceLastV = v; S.paceLastAt = Date.now(); S.paceLastCum = S.paceCum;
              return v;
            }
          }
        }
        /* Standing in the jam IS the congestion signal: when the
           window can no longer prove a pace because the truck has
           barely moved since the last proven one (under 25 m in
           under 10 minutes), the last proven pace stands — a
           stopped truck must not snap the ETA back to the
           free-flow plan figure. */
        if (S.paceLastV > 0 && (Date.now() - S.paceLastAt) < 600000 &&
            Math.abs((S.paceCum || 0) - S.paceLastCum) < 25) {
          /* Re-anchor while the fallback is in use: each tick
             that still finds the truck barely moved re-proves
             the jam, so a long crawl never ages the pace out.
             Real movement rebuilds the window and the measured
             branch above takes over again. */
          S.paceLastAt = Date.now(); S.paceLastCum = S.paceCum;
          return S.paceLastV;
        }
        return 0;
      }
      function onPos(lat, lon, heading, speed, fixT) {
        /* v222 (NAV-STUCK): stamp the stream's health on EVERY
           accepted fix — the watchdog below reads lastFixAt.
           v224: lastFixT is now only a record of the newest fix
           stamp seen; the fallback stream's dedupe runs on its
           OWN watermark (streamFixT, see currentOnPos) so the
           two streams' clocks can never silence each other. */
        S.lastFixAt = Date.now();
        if (typeof fixT === 'number' && fixT > 0) S.lastFixT = Math.max(S.lastFixT || 0, fixT);
        var first = !S.pos;
        var prevPos = S.pos;
        S.pos = [lat, lon];
        paceSample(prevPos, S.pos); /* v280: live pace window */
        if (heading !== null && heading !== undefined && isFinite(heading)) S.heading = heading;
        /* v124: no heading from the GPS stream (some devices never
           send one) — derive it from the movement itself once the
           fix has travelled ≥10 m, so heading-up still engages.
           A shorter hop is jitter, not a direction: keep the last
           real heading, exactly as the stationary rule does. */
        else if (prevPos && haversineM(prevPos, S.pos) >= 10) S.heading = bearingDeg(prevPos, S.pos);
        if (speed !== null && speed !== undefined && isFinite(speed)) S.speed = speed;
        /* v104: before the settle pass, the position is recorded
           but NOT painted (the gate in the map init paints it
           the moment the map's size is real). */
        if (S.map && S.mapSettled) paintPos();
        if (first && !S.plan) banner('You are here', 'Search for a place, or tap the map to drop a pin.');
        /* v103: a destination armed before the first fix (the
           usual nav_pending arrival) routes the moment the
           position lands — maybeAutoRoute is latched, so later
           fixes never re-fire it. */
        if (!S.plan) maybeAutoRoute();
        if (S.plan) trackProgress();
        if (S.drive) driveTick();
      }
      /* Seed from the native geo wrapper's last fix when present,
         then follow the browser watcher (works in every build).
         v222 (NAV-STUCK): the watcher registration lives in
         startWatch() because the watchdog restarts it — a WebView
         watch can die without ever calling its error callback. */
      function startWatch() {
        if (!navigator.geolocation) return;
        try {
          if (S.watchId !== null) { try { navigator.geolocation.clearWatch(S.watchId); } catch (e) {} S.watchId = null; }
          S.watchId = navigator.geolocation.watchPosition(
            function (p) { onPos(p.coords.latitude, p.coords.longitude, p.coords.heading, p.coords.speed, p.timestamp); },
            function () { if (!S.pos) note('Location is unavailable — allow location for Meticulous to navigate.'); },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
          );
        } catch (e) {}
      }
      try {
        var lastFix = (window.MeticulousGeo && MeticulousGeo.last && MeticulousGeo.last()) ||
          (window.App && App.geo && App.geo.last && App.geo.last());
        if (lastFix && lastFix.latitude) onPos(lastFix.latitude, lastFix.longitude, lastFix.bearing, lastFix.speed, lastFix.time);
      } catch (e) {}
      if (navigator.geolocation) {
        startWatch();
      } else {
        note('This device has no location service — routing from your position is unavailable.');
      }
      /* v222 (NAV-STUCK): net 1 — ride the app's own fix stream.
         LiveMiles' stream is fed by js/geo.js, which maintains
         its watcher with revive-on-visible logic this module
         never had; fixes arrive through navFixFromMiles with the
         fix's own timestamp, and onPos's watermark (lastFixT)
         keeps the two streams from double-feeding one fix. */
      currentOnPos = function (lat, lon, heading, speed, fixT) {
        if (!S) return;
        /* v224 (NAV-NO-MOVEMENT-V38): the dedupe watermark is the
           STREAM'S OWN last fix, never a mark the module watch set.
           The two feeds keep different clocks — the watch stamps
           fixes with the device clock, the app stream carries the
           GPS fix clock — and on the owner's phone the stream's
           stamps ran behind the watch's marks, so the shared
           watermark ate EVERY stream fix: with the watch dead
           (backgrounded WebView) the drive view froze solid while
           the miles engine, fed by the same stream, kept counting.
           Each stream now dedupes only against itself: a repeated
           or stale fix FROM THIS STREAM is still refused, and a
           fix from the other stream can never be silenced by it. */
        if (typeof fixT === 'number' && fixT > 0 && S.streamFixT && fixT <= S.streamFixT) return;
        if (typeof fixT === 'number' && fixT > 0) S.streamFixT = Math.max(S.streamFixT || 0, fixT);
        onPos(lat, lon, heading, speed, fixT);
      };
      if (!fixSubWired) {
        fixSubWired = true;
        try { if (window.LiveMiles && typeof LiveMiles.subscribe === 'function') LiveMiles.subscribe(navFixFromMiles); } catch (e) {}
      }
      /* v227 (NAV-NO-MOVEMENT-V39): net 3 — the native feed. Its
         intake dedupes on the NATIVE stream's own watermark
         (S.navFixT), the v224 rule applied to a third stream:
         the watch and the app stream may both be dead or skewed;
         a native fix is refused only if THIS stream already
         delivered it (or a newer one). */
      currentNavOnPos = function (lat, lon, heading, speed, fixT) {
        if (!S) return;
        if (typeof fixT === 'number' && fixT > 0 && S.navFixT && fixT <= S.navFixT) return;
        if (typeof fixT === 'number' && fixT > 0) S.navFixT = Math.max(S.navFixT || 0, fixT);
        onPos(lat, lon, heading, speed, fixT);
      };
      wireNavFeed();
      /* seed from the shell's last native fix — the freshest
         position the phone holds when the module opens. */
      try {
        if (window.ShiftTrack && typeof ShiftTrack.navLastFix === 'function') {
          ShiftTrack.navLastFix().then(function (f) { if (f) navFixFromNative(f); }, function () {});
        }
      } catch (e) {}
      /* v222 (NAV-STUCK): net 2 — the watchdog. While this module
         lives, a stream silent for >12 s is restarted: clearWatch
         + a fresh watchPosition, and the geo wrapper's last fix
         bridges the gap when it is newer than what we hold. A
         frozen drive view (his Deerfoot recording: clock
         advancing, map still) is exactly a silent stream, and it
         now heals itself instead of standing still all drive. */
      try {
        if (S.watchdogId) clearInterval(S.watchdogId);
        S.watchdogId = setInterval(function () {
          if (!S) return;
          if (!S.lastFixAt) { S.lastFixAt = Date.now(); return; } // the silence clock starts at first check, not at epoch
          if (Date.now() - (S.lastFixAt || 0) <= 12000) return;
          startWatch();
          try {
            var lf = (window.MeticulousGeo && MeticulousGeo.last && MeticulousGeo.last()) || null;
            /* v224: the bridge feeds through the same stream rule
               as the subscription (the stream's own watermark) —
               the geo wrapper's last fix IS an app-stream fix, and
               the old shared-watermark test starved it under the
               same clock skew that froze the drive. */
            if (lf && lf.latitude && (!S.streamFixT || (lf.time || 0) > S.streamFixT)) {
              currentOnPos(lf.latitude, lf.longitude, lf.bearing, lf.speed, lf.time);
            }
          } catch (e) {}
        }, 2500);
      } catch (e) {}

      /* ---------- routing ---------- */
      function clearRoute() {
        if (S.drive) exitDrive();
        /* v103: ending a route also spends the auto-route latch —
           the destination stays set, but it never re-routes on
           its own; Route is the driver's deliberate tap now. */
        S.autoWanted = false;
        S.plan = null; S.line = null; S.manIdx = -1; S.offSince = 0; S.arrived = false;
        if (S.routeLine && S.map) { S.map.removeLayer(S.routeLine); S.routeLine = null; }
        var st = body.querySelector('#nv_steps'); if (st) st.innerHTML = '<div class="empty">No route yet.</div>';
        var end = body.querySelector('#nv_end'); if (end) end.classList.add('hidden');
        /* v101: no active route → Drive goes away and Route takes
           the primary slot back. */
        var db = body.querySelector('#nv_drive'); if (db) db.classList.add('hidden');
        var rb = body.querySelector('#nv_route'); if (rb) rb.className = 'btn primary big';
        try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}
      }

      /* v104: AUTO-ENTER DRIVE — a computed route is not yet
         turn-by-turn (owner, Oct 16, 2026: "That's not turn by
         turn" over a live plan view). When a route lands, Drive
         opens BY ITSELF when this was a go-now flow — the
         destination arrived via nav_pending (goNowKey matches
         the armed destination) — or when the truck is already
         moving (last GPS speed ≥ 2 m/s). Parked manual planning
         (a place picked in here, truck still) keeps the plan
         view and its now-unmissable Drive button. Once per arm:
         the entry — and any later Drive exit — spends the arm,
         so an off-route or mode-change re-route for the same
         destination never drags the driver back in. */
      function maybeAutoEnterDrive() {
        if (!S || S.drive || S.driveAutoSpent || !S.plan) return;
        var goNow = !!S.autoKey && S.goNowKey === S.autoKey;
        var moving = S.speed !== null && S.speed !== undefined && isFinite(S.speed) && S.speed >= 2;
        if (!goNow && !moving) return;
        S.driveAutoSpent = true;
        startDrive();
      }

      /* v135: TRUCK TRUTH, layer 1 — if the engine hands a TRUCK
         a U-turn anyway (truck costing does NOT suppress them),
         the route is re-requested with the turn-around points
         EXCLUDED (Valhalla exclude_locations), so the new answer
         has to loop the block like a truck actually drives.
         Bounded at two exclusion rounds; a failed round falls
         back to the route already in hand. Layer 2
         (sanitizeTruckPlan, NAVPURE) then guarantees that what
         reaches the banner, the steps and the voice contains no
         U-turn even if every round failed. The reroute path
         (trackProgress → doRoute) rides this same function, so
         a missed turn re-plans around the block too, never
         "turn around". Car mode is untouched throughout: a car
         can make a U-turn, and its plan stays the engine's own. */
      function doRoute() {
        if (!S.settings.serverUrl) {
          banner('Navigator server not set — routing unavailable.', 'Set the Navigator server URL in Preferences → Advanced.');
          note('Routing needs the Navigator server URL (Preferences → Advanced).');
          return;
        }
        if (!S.dest) { note('Pick a destination first — search above or tap the map.'); return; }
        if (!S.pos) { note('Waiting for your location… allow location for Meticulous, then tap Route again.'); return; }
        if (S.rerouting) return;
        S.rerouting = true;
        banner('Routing…', '');
        var url = S.settings.serverUrl.replace(/\/+$/, '') + '/route';
        var truckMode = S.settings.mode !== 'car';
        var attempt = 0;
        var lastGood = null;

        /* v179 (F5): fetch elevations for ~200 m samples along
           the new route from the free Open-Meteo elevation
           service (no key, no spend) and compute grade events.
           Fully guarded: any failure leaves S.gradeEvents empty
           and guidance exactly as before — silence, never an
           invented grade. Runs off the route's critical path:
           the route is usable the moment it lands; events fill
           in when the answer arrives. */


        function fetchGradeEvents(line) {
          S.gradeEvents = [];
          S.gradeSaid = {};
          if (typeof fetch !== 'function' || !line || line.length < 2) return;
          try {
            var totalM = 0, i;
            for (i = 0; i + 1 < line.length; i++) totalM += haversineM(line[i], line[i + 1]);
            var pts = [], step = Math.max(100, totalM / 60), m;
            for (m = 0; m <= totalM; m += step) { var p = pointAlongLine(line, m); if (p) pts.push({ m: m, p: p }); }
            if (pts.length < 3) return;
            var lat = pts.map(function (q) { return q.p[0].toFixed(6); }).join(',');
            var lon = pts.map(function (q) { return q.p[1].toFixed(6); }).join(',');
            fetch('https://api.open-meteo.com/v1/elevation?latitude=' + lat + '&longitude=' + lon)
              .then(function (r) { return r.json(); })
              .then(function (j) {
                if (!j || !j.elevation || !S || S.line !== line) return;
                var samples = pts.map(function (q, k) { return { m: q.m, ele: Number(j.elevation[k]) || 0 }; });
                S.gradeEvents = gradeEvents(samples);
              })
              .catch(function () {});
          } catch (e) {}
        }

        /* v264 (NAV-LANE-INSET-EMPTY): lane data from the
           owner's OWN route server. The native response the
           app routes on carries no lanes (probed Oct 26: every
           maneuver key enumerated, none) — but the same server
           returns real per-lane indications in its OSRM format,
           so the ADOPTED request is replayed once with
           format:'osrm' and the answer's laned intersections
           are pinned to this route's maneuvers (matchServerLanes).
           Fully guarded like the grade fetch: any failure
           leaves S.serverLanes empty and the Overpass lookup
           remains the fallback — silence, never invented lanes.
           The replay carries the adopted body whole (exclusion
           points / forward via included), so the lane answer
           describes the route actually being driven; where it
           still diverges, the 75 m pinning fails safe. */
        function fetchServerLanes(reqBody, line, plan) {
          S.serverLanes = {};
          if (!reqBody || typeof fetch !== 'function') return;
          try {
            var body2 = {};
            for (var k in reqBody) body2[k] = reqBody[k];
            body2.format = 'osrm';
            fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body2) })
              .then(function (r) { if (!r.ok) throw new Error('osrm ' + r.status); return r.json(); })
              .then(function (j) {
                if (!S || S.line !== line || S.plan !== plan) return;
                var laned = osrmLaneData(j);
                if (!laned.length) return;
                S.serverLanes = matchServerLanes(laned, line, plan);
                /* if the pop-up is already showing a turn this
                   answer covers, clear its key so the strip
                   paints on the next fix (the v196 nudge). */
                if (S.drive && S.drive.insetKey &&
                    S.serverLanes[S.drive.insetKey.split(':')[0]]) S.drive.insetKey = '';
              })
              .catch(function () {});
          } catch (e) {}
        }

        function finalizeRoute(line, plan, reqBody) {
          S.rerouting = false;
          S.line = line;
          S.plan = plan;
          fetchGradeEvents(line);
          /* v264 (NAV-LANE-INSET-EMPTY): the same adopted
             request, replayed once against the owner's own
             server in OSRM format for its lane data (see
             fetchServerLanes). Off the critical path like the
             grade fetch — the route is usable the moment it
             lands; lanes fill in when the answer arrives. */
          fetchServerLanes(reqBody, line, plan);
          /* v262: a new route re-arms the traffic warnings —
             each incident may be warned about once per route —
             and refreshes the incident list against the new line. */
          S.trafficSaid = {};
          fetchTraffic(true);
          /* v196 (NAV-LANES): lane lookups belong to THIS
             route's maneuvers — a new route starts with an
             empty cache. */
          S.laneByTurn = {}; S.laneFetch = {};
          /* v264: the server-lane set belongs to this route
             too (fetchServerLanes repopulates it). */
          S.serverLanes = {};
          S.manIdx = 0; S.offSince = 0; S.arrived = false;
          /* v78: remember the destination for the dashboard card
             (search name when there is one, else the pin coords —
             the same words the destination note shows). */
          lastNavDest = S.destLabel || (S.dest ? S.dest[0].toFixed(5) + ', ' + S.dest[1].toFixed(5) : '');
          /* v244 (NAV-GLANCE-LAST-DEST): persist the destination
             NAME with the settings record so the card still names
             the last place after an app restart. Names only — a
             label-less pin persists nothing (the card falls back
             rather than ever showing coordinates). */
          if (S.destLabel) { try { saveSettings({ lastDest: S.destLabel }); } catch (e) {} }
          if (S.map) {
            if (S.routeLine) S.map.removeLayer(S.routeLine);
            S.routeLine = L.polyline(line, { color: S.settings.mode === 'car' ? '#888' : '#e67e00', weight: 8, opacity: 0.9 }).addTo(S.map);
            S.map.fitBounds(S.routeLine.getBounds(), { padding: [30, 30] });
          }
          var st = body.querySelector('#nv_steps');
          if (st) {
            st.innerHTML = '<p class="note" style="margin-top:0">' + fmtDist(S.plan.totalKm * 1000) + ' · ' + fmtMin(S.plan.totalMin) +
              ' · ' + (S.settings.mode === 'car' ? 'Car route' : 'Truck route — Calgary truck network') + '</p>' +
              S.plan.maneuvers.map(function (m, i) {
                return '<div class="listitem" data-nvstep="' + i + '"><div class="a">' + esc(m.instruction) + '</div>' +
                  '<div class="b">' + fmtDist(m.lengthKm * 1000) + '</div></div>';
              }).join('');
          }
          var end = body.querySelector('#nv_end'); if (end) end.classList.remove('hidden');
          /* v101: a route is ACTIVE — Drive appears and takes
             the one primary slot; Route demotes to a quiet
             re-route. A re-route landing mid-drive re-arms the
             drive screen on the new plan.
             v104: Drive now sits at the TOP of the sheet (see
             the sheet markup) — revealing it there puts the one
             next action in the driver's first glance. */
          var db = body.querySelector('#nv_drive'); if (db) db.classList.remove('hidden');
          var rb = body.querySelector('#nv_route'); if (rb) rb.className = 'btn ghost big';
          if (S.drive) driveOnRoute();
          /* v104: …and on a go-now arm (or already rolling)
             nobody has to tap it at all — Drive opens itself. */
          else maybeAutoEnterDrive();
          paintStep();
          /* mid-drive, the drive screen's own prompts own the
             speech; the planning screen keeps its first-line
             announcement exactly as before. */
          if (!S.drive) speak(S.plan.maneuvers[0].verbalPre || S.plan.maneuvers[0].instruction);
          /* v280 (NAV-TRAFFIC-LIVE-ETA): the offer's verdict —
             the re-plan this route came from was the driver's
             tap on the traffic offer; its remaining time
             (totalMin, routed from here) is judged against the
             live ETA he was shown when he tapped. */
          if (S.offerEta) {
            var tapEta = S.offerEta; S.offerEta = 0;
            if (S.drive) {
              if (S.plan.totalMin <= tapEta - 2) speak('Faster route found — saves about ' + Math.round(tapEta - S.plan.totalMin) + ' minutes.');
              else speak('This is still the fastest way.');
            }
          }
          note('');
        }

        /* v260 (NAV-NO-UTURN): the truck's live heading, when
           one is honestly known — the applied drive heading
           mid-drive, else the last GPS heading. null when
           parked with no heading yet: the forward re-request
           below needs a direction of travel to project along,
           and never invents one. */
        function truckHeading() {
          var h = (S.drive && S.drive.headingApplied !== null && S.drive.headingApplied !== undefined)
            ? S.drive.headingApplied : S.heading;
          return (h !== null && h !== undefined && isFinite(h)) ? h : null;
        }
        var fwdAttempt = 0, viaInFlight = false, plainRetried = false;
        function requestRoute(excludePts, viaPt) {
          viaInFlight = !!viaPt;
          var reqOpts = { routePref: S.settings.routePref };
          if (viaPt) {
            /* v260: the forward re-request — the origin stays
               the truck, a 'through' point 500 m (then 1200 m)
               ahead along its heading joins the request, and
               the origin carries the heading itself, so the
               engine's answer begins by continuing forward
               along the current road instead of turning the
               truck around (see the truck block in the .then). */
            reqOpts.via = viaPt;
            var th = truckHeading();
            if (th !== null) reqOpts.heading = th;
          }
          var reqBody = buildRouteRequest(S.pos, S.dest, S.settings.profile, S.settings.mode, reqOpts);
          if (excludePts && excludePts.length) {
            reqBody.exclude_locations = excludePts.map(function (p) { return { lat: p[0], lon: p[1] }; });
          }
          /* v104: the HTTP status rides along so the failure line
             below can name what ACTUALLY happened (see the catch). */
          var httpStatus = 0;
          fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody) })
            .then(function (r) { httpStatus = r.status || 0; if (!r.ok) throw new Error('http'); return r.json(); })
            .then(function (data) {
              if (!data || !data.trip || !data.trip.legs || !data.trip.legs.length) throw new Error('empty');
              var line = [];
              data.trip.legs.forEach(function (leg) { line = line.concat(decodeShape(leg.shape)); });
              var plan = maneuverPlan(data.trip);
              if (truckMode) {
                var uts = planUturns(plan);
                /* v192 (NAV-UTURN): geometry reversals join the
                   typed U-turns in the SAME exclusion re-request —
                   a route that doubles back on a divided highway
                   is re-planned around the block, never presented
                   as a turn-around. */
                planReversals(plan, line).forEach(function (ri) {
                  if (uts.indexOf(ri) === -1) uts.push(ri);
                });
                if (uts.length && attempt < 2) {
                  var pts = [];
                  uts.forEach(function (i) {
                    var p = pointAlongLine(line, plan.maneuvers[i].cumStartKm * 1000);
                    if (p) pts.push(p);
                  });
                  if (pts.length) {
                    attempt++;
                    lastGood = { line: line, plan: plan };
                    requestRoute(pts);
                    return;
                  }
                }
                /* v260 (NAV-NO-UTURN — owner, Oct 26, 2026
                   07:43 MDT, driving: "Why on earth is it so
                   difficult for you to tell this GPS never to
                   tell me to U-turn"): the v135/v192 layers had
                   a structural hole at the START of a route.
                   When the turn-around sits in the first
                   maneuvers (the truck pulled out pointing away
                   from the destination, or a missed turn left
                   it heading off), excluding its point just
                   moves the turn-around to the next intersection
                   — or excludes the origin itself — and once
                   the two rounds above are spent the app adopts
                   the sanitized plan: the WORDS are gone but the
                   line still doubles back and the guidance still
                   walks the truck around. So when the exclusion
                   rounds are spent (or produced no points) and
                   an offending maneuver STILL begins within the
                   first 1 km, one more layer fires before
                   sanitize: a FORWARD re-request — the route
                   re-asked with a 'through' point projected
                   ahead of the truck along its own heading
                   (500 m, then 1200 m) plus the heading on the
                   origin — whose answer starts by continuing
                   forward along the current road to proper
                   streets. Mid-route reversals (the v192
                   divided-highway crossover) are the exclusion
                   rounds' job and never reach here cured or
                   not; sanitizeTruckPlan remains the last line,
                   so no U-turn is ever spoken or shown as an
                   instruction whatever the engine returns. */
                if (uts.length && fwdAttempt < 2) {
                  var early = false;
                  for (var ui = 0; ui < uts.length; ui++) {
                    if (plan.maneuvers[uts[ui]] && plan.maneuvers[uts[ui]].cumStartKm < 1.0) { early = true; break; }
                  }
                  var fwdHdg = truckHeading();
                  if (early && fwdHdg !== null) {
                    var via = forwardOrigin(S.pos, fwdHdg, fwdAttempt === 0 ? 500 : 1200);
                    if (via) {
                      fwdAttempt++;
                      lastGood = { line: line, plan: plan };
                      requestRoute(null, via);
                      return;
                    }
                  }
                }
                plan = sanitizeTruckPlan(plan);
              }
              finalizeRoute(line, plan, reqBody);
            })
            .catch(function (err) {
              /* v260 (NAV-NO-UTURN): a failed FORWARD (via)
                 request — the engine could not use the through
                 point — retries ONCE as a plain request before
                 any fallback: the fresh answer re-enters the
                 U-turn layers above, so one unsnappable point
                 never costs the driver the forward route.
                 Bounded by plainRetried; the lastGood fallback
                 below still bounds the whole chain. */
              if (viaInFlight && !plainRetried) {
                plainRetried = true;
                requestRoute(null);
                return;
              }
              /* v135: an exclusion round failed AFTER a route was
                 already in hand — the driver keeps guidance: the
                 in-hand route, sanitized, is worth more than an
                 error banner. A first-request failure keeps the
                 v104 honest-error behaviour below. */
              if (lastGood) {
                var lg = lastGood;
                lastGood = null;
                finalizeRoute(lg.line, sanitizeTruckPlan(lg.plan), null);
                return;
              }
              S.rerouting = false;
              /* v104: the failure line says what ACTUALLY happened,
                 in one short line — never the old guess ("Check the
                 Navigator server URL…"), which blamed the settings
                 for what was really a dead address, a CORS wall, or
                 a silent server (the Oct 16 field hunt). Three
                 classes: no answer at all (the fetch itself threw),
                 an answer with an error status, and an answer with
                 no buildable route in it. */
              var msg;
              if (err && err.message === 'empty') msg = 'No route could be built between here and there.';
              else if (httpStatus) msg = 'The route server answered with an error (HTTP ' + httpStatus + ').';
              else msg = "The route server didn't answer — check your connection and try again.";
              banner('Could not get a route.', '');
              note(msg);
            });
        }
        requestRoute(null);
      }

      function paintStep() {
        if (!S.plan || S.manIdx < 0) return;
        var m = S.plan.maneuvers[S.manIdx];
        var sub = '';
        if (S.line && S.pos) {
          var pr = distToRouteM(S.pos, S.line);
          var toTurnM = Math.max(0, m.cumEndKm * 1000 - pr.along);
          var leftM = Math.max(0, S.plan.totalKm * 1000 - pr.along);
          sub = 'In ' + fmtDist(toTurnM) + ' · ' + fmtDist(leftM) + ' to destination';
        }
        banner(m.instruction, sub);
        body.querySelectorAll('[data-nvstep]').forEach(function (el) {
          var i = Number(el.getAttribute('data-nvstep'));
          el.style.opacity = i < S.manIdx ? '0.45' : '1';
          el.style.borderLeft = i === S.manIdx ? '4px solid #e67e00' : '';
        });
      }

      function trackProgress() {
        if (!S.plan || !S.line || !S.pos) return;
        var pr = distToRouteM(S.pos, S.line);
        /* Off-route: >60 m off the line, held for a few seconds so a
           parking-lot wiggle never triggers a re-route. */
        if (pr.dist > 60) {
          if (!S.offSince) S.offSince = Date.now();
          else if (Date.now() - S.offSince > 4000 && !S.rerouting) {
            S.offSince = 0;
            banner('Off route — re-routing…', '');
            doRoute();
          }
          return;
        }
        S.offSince = 0;
        if (S.arrived) return;
        var idx = currentManeuverIndex(S.plan, pr.along);
        if (idx !== S.manIdx) {
          var prev = S.plan.maneuvers[S.manIdx];
          var oldIdx = S.manIdx;
          S.manIdx = idx;
          /* v176 (F1): an index JUMP (oldIdx -> idx, more than one
             step) crossed whole maneuvers between two fixes —
             their turns were never announced. Speak the skipped
             lines FIRST, combined with the landing line, as one
             utterance (speak() cancels, so separate calls would
             eat each other), and mark the skipped maneuvers said
             in the drive flag bag so drivePrompt never fires them
             late, out of sequence. */
          var skipped = (idx > oldIdx + 1) ? skippedLines(S.plan, oldIdx, idx) : [];
          if (skipped.length) {
            if (S.drive && S.drive.said) {
              for (var sj = oldIdx + 1; sj < idx; sj++) {
                S.drive.said['far:' + sj] = 1; S.drive.said['near:' + sj] = 1;
              }
            }
            var landCur = S.plan.maneuvers[idx];
            var landLine = (prev && prev.verbalPost) ? '' :
              (landCur ? (landCur.verbalPre || landCur.instruction || '') : '');
            speak(skipped.join(' Then ') + (landLine ? ' Then ' + landLine : ''));
          } else if (prev && prev.verbalPost) speak(prev.verbalPost);
          else {
            var cur = S.plan.maneuvers[idx];
            /* v101: in drive mode the far/near prompts (drivePrompt)
               own advance speech — if this maneuver was already
               announced on approach, don't repeat its line here. */
            var announced = !!(S.drive && S.drive.said &&
              (S.drive.said['far:' + idx] || S.drive.said['near:' + idx]));
            if (cur && !announced) speak(cur.verbalPre || cur.instruction);
          }
        }
        paintStep();
        /* v135: ARRIVAL IS AN ALONG-ROUTE FACT, never a
           straight-line one. The shipped trigger fired on
           haversine-to-pin < 40 m ALONE — and on the owner's
           Oct 17 Ivor East Pond drive that fired ~2.4 km early:
           the pond pin sits just off Deerfoot Trail, so passing
           it on the highway put the puck inside 40 m of the pin
           as the crow flies while 2.4 km of route remained (the
           recording's bar read "2.4 km left" seconds before
           "You have arrived"). Arrival now requires the
           along-route remaining to be at the door, judged two
           ways: ON the line and at its end (≤60 m off the line,
           ≤30 m of route left), or AT the pin (<40 m) while in
           the route's final stretch (≤250 m of route left — the
           yard-at-the-end-of-the-road case, where the pin sits
           off the drawn line's end but the drive is genuinely
           done). Straight-line proximity by itself can no longer
           end a drive. */
        var dDest = haversineM(S.pos, S.dest);
        var leftAlongM = S.plan.totalKm * 1000 - pr.along;
        var atDoor = pr.dist <= 60 && leftAlongM <= 30;
        var atPin = dDest < 40 && leftAlongM <= 250;
        if (atDoor || atPin) {
          S.arrived = true;
          var last = S.plan.maneuvers[S.plan.maneuvers.length - 1];
          banner('You have arrived', S.destLabel || '');
          speak((last && last.verbalPost) || 'You have arrived.');
          if (S.drive) driveArrived();
        }
      }

      /* v139: THE plane's one transform — pitch and heading
         composed on a single element (see .nv-drive-plane in
         style.css for the architecture). The composition order
         reproduces the old nested tilt∘spin geometry exactly:
         the in-plane rotate applies first, the rotateX pitches
         the result around the screen-horizontal axis through the
         anchor (the plane's centre), and the perspective term
         projects with its vanishing point AT the anchor. One
         element, one raster, one writer (the drive tick, ≥2°
         deadband). */
      function planeTransform(headingDeg) {
        /* v259 (NAV-CHASE-ANGLE-STEEPER — owner, Oct 26, 2026,
           driving: "chase angle has to be a little bit more
           steep, I want to be able to see the road ahead a
           little bit more"): the posture pitch rises 45° → 50°
           (the higher rotateX pitches the view up toward the
           horizon, so more of the road ahead shows; lower
           flattens toward top-down). The gesture base default
           follows (50°), so a two-finger tilt still starts
           from the posture with no snap. Nothing else about
           the composition changes. */
        /* v177 (A4): 2D is a flat heading-up view — same spin,
           no pitch, no perspective. 3D (default) is the v139
           composed chase transform, byte-identical to before. */
        /* v210 (NAV-GESTURES): a manual two-finger rotate adds
           S.viewRot to the bearing; a two-finger tilt overrides
           the composed pitch with S.viewPitch (null = the
           posture default). AT REST (no adjustment in play) the
           function returns the v139/v177 literals above
           verbatim — the driving view IS that composition; only
           while an adjustment is active does it compose from
           parts. */
        var off = (S && S.viewRot) || 0;
        var hasPitch = !!(S && S.viewPitch !== null && S.viewPitch !== undefined);
        /* v260 (NAV-TOP-CUTOFF — owner, Oct 26, 2026 07:41 MDT,
           driving: "It's still cutting off"): the plane's far
           edge never reached the top of his 768x1024 drive
           screen — homography of THIS composition (plane
           230%x300% at left -65%/top -86%, origin 50% 50%,
           anchor at 50%/64%): at the 50° posture the far edge
           projects only ~477px above the anchor against the
           ~655px the screen needs, so the top ~15% showed the
           viewport's sky gradient at EVERY heading (the wide
           dark band under the banner in his recording). The
           v139/v220 coverage math was done on a 360x640
           reference screen. Growing the plane alone cannot fix
           side headings (reach is bounded by halfW*cos(pitch)
           even at infinite perspective), so the posture keeps
           its exact 50° and gains a translate compensation:
           translateY(-lift) between perspective and rotateX
           slides the whole projection up until the far edge
           covers the top — lift = 0.49 x viewport height, set
           by paintPlane from the live viewport (S.driveLiftPx;
           0/absent = the pre-v260 strings byte-identical). The
           plane also widens 230% -> 260% (style.css) for the
           raster the wider reach samples. The follow camera
           compensates the same shift (see followTarget), so
           the truck stays glued to its anchor. 2D is flat —
           no translate, exactly as before. */
        var lift = (S && S.driveLiftPx > 0) ? Math.round(S.driveLiftPx) : 0;
        var liftStr = lift ? ' translateY(' + (-lift) + 'px)' : '';
        if (!off && !hasPitch) {
          if (getNavViewMode() === '2d') return 'rotate(' + (-headingDeg) + 'deg)';
          return 'perspective(1100px)' + liftStr + ' rotateX(50deg) rotate(' + (-headingDeg) + 'deg)';
        }
        if (getNavViewMode() === '2d') return 'rotate(' + (-(headingDeg + off)) + 'deg)';
        var pitch = hasPitch ? S.viewPitch : 50;
        return 'perspective(1100px)' + liftStr + ' rotateX(' + pitch + 'deg) rotate(' + (-(headingDeg + off)) + 'deg)';
      }

      /* v178 (F2): how sharply the route bends at maneuver
         idx+1's turn, in degrees (negative = left, positive =
         right), measured off the route line's own geometry —
         the bearing in (60→25 m before the turn point) against
         the bearing out (25→60 m past it). Honest geometry: the
         inset arrow bends exactly as the road does. */
      function turnDeltaDeg(plan, line, idx) {
        if (!plan || !line || !plan.maneuvers[idx]) return 0;
        var m = plan.maneuvers[idx].cumEndKm * 1000;
        var a1 = pointAlongLine(line, Math.max(0, m - 60)), a2 = pointAlongLine(line, Math.max(0, m - 25));
        var b1 = pointAlongLine(line, m + 25), b2 = pointAlongLine(line, m + 60);
        if (!a1 || !a2 || !b1 || !b2) return 0;
        var din = bearingDeg(a1, a2), dout = bearingDeg(b1, b2);
        return ((dout - din + 540) % 360) - 180;
      }

      /* v178 (F2): chevron icons for the arrows ON the route
         line, cached by 15° bearing bucket — an SVG polygon
         rotated by a transform ATTRIBUTE (never a CSS transform,
         never a .style write: the v139 layer budget is untouched).
         The glyph points along the route in map space; the plane
         carries it to screen orientation like everything else on
         the map. */
      var arrowIconCache = {};
      function arrowIcon(bearing) {
        var bucket = ((Math.round(bearing / 15) * 15) % 360 + 360) % 360;
        if (arrowIconCache[bucket]) return arrowIconCache[bucket];
        var ic = L.divIcon({
          className: 'nv-route-arrow', iconSize: [34, 34], iconAnchor: [17, 17],
          html: '<svg viewBox="0 0 34 34" width="34" height="34"><g transform="rotate(' + bucket + ' 17 17)">' +
            '<polygon points="17,3 27,29 17,22 7,29" fill="#ffffff" stroke="#1a56db" stroke-width="2.5" stroke-linejoin="round"/></g></svg>'
        });
        arrowIconCache[bucket] = ic;
        return ic;
      }

      /* v124: the route line is the DOMINANT element on the drive
         map — a white casing under a heavy coloured core, so the
         road ahead reads at a glance against any tile. Before, a
         lone 6px line (grey in car mode) washed into the map.
         v125 (owner spec, Oct 17): the core is a deep BLUE —
         a colour no basemap road uses, so the direction line can
         never be mistaken for a road (the v124 orange core sat
         one shade from the basemap's own road colours). */
      function makeDriveLine() {
        return L.layerGroup([
          L.polyline(S.line, { color: '#ffffff', weight: 24, opacity: 0.9 }),
          L.polyline(S.line, { color: '#1a56db', weight: 18, opacity: 1 })
        ]);
      }

      /* v135: FADING — the drive wake lock. The audit (see
         BUGS.md) found NO app-controlled opacity fade anywhere in
         the Drive face: the chrome has no opacity transition or
         animation (v139: the plane carries no transition at all),
         and the drive tile layer has run fadeAnimation:false
         since v125.
         What DOES fade a navigation screen mid-drive is the OS
         display timeout dimming the whole glass — and the app
         held no wake lock for the Drive screen (the tracker's
         lock in js/miles.js belongs to the shift, not to Drive).
         While Drive is open the screen now holds a wake lock,
         re-requested when the app returns to the foreground
         (sentinels auto-release on hide), released on exit.
         Every step is guarded — no wakeLock API, no lock, and
         Drive behaves exactly as before. */
      function driveWake(on) {
        try {
          if (on) {
            if (!navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') return;
            var p = navigator.wakeLock.request('screen');
            if (p && typeof p.then === 'function') {
              p.then(function (s) { if (S) S.wakeSentinel = s; }).catch(function () {});
            }
          } else if (S && S.wakeSentinel) {
            var s = S.wakeSentinel; S.wakeSentinel = null;
            if (s && typeof s.release === 'function') s.release().catch(function () {});
          }
        } catch (e) {}
      }
      function onDriveVis() {
        try { if (S && S.drive && !document.hidden) driveWake(true); } catch (e) {}
      }

      /* ---------- v101 drive screen ---------- */
      /* v183: FREE-LOOK (pinch-to-zoom / drag on the drive map).
         The drive map used to be locked (touchZoom/dragging off),
         so a pinch did nothing (owner, Oct 20 17:12 MDT). The map
         now takes touch zoom + drag; the first user gesture flips
         driveFree on, the follow recentering (tick + animator)
         stands down, and the Re-center pill shows. The pill — or
         15 quiet seconds — hands the map back to the truck. */
      function setDriveFree(on) {
        if (!S) return;
        S.driveFree = !!on;
        var pill = body.querySelector('#nvd_recenter');
        if (pill) pill.classList.toggle('hidden', !on);
        if (S.driveFreeTimer) { try { clearTimeout(S.driveFreeTimer); } catch (e) {} S.driveFreeTimer = null; }
        if (on) {
          S.driveFreeTimer = setTimeout(function () { setDriveFree(false); }, 15000);
        } else {
          /* v210: snap-back restores the DRIVING VIEW too — a
             manual two-finger rotate/tilt zeroes out and the
             pure heading-up chase composition returns, the way
             other GPS apps hand the view back. */
          if (S.viewRot || (S.viewPitch !== null && S.viewPitch !== undefined)) {
            S.viewRot = 0; S.viewPitch = null;
            if (S.drive) paintPlane((S.drive.headingApplied !== null && S.drive.headingApplied !== undefined) ? S.drive.headingApplied : (S.heading || 0));
          }
          if (S.driveMap && S.pos) {
            /* v260: snap-back aims at the follow target — with
               the adjustments zeroed just above, a repaint has
               restored the lift, so the target is the ahead
               point that keeps the truck on its anchor (and
               followTarget falls back to the truck itself when
               no lift applies). */
            try { if (S.drive) driveGesturePaint(); } catch (e) {}
            try { S.driveMap.panTo(followTarget() || S.pos, { animate: false }); } catch (e) {}
          }
        }
      }

      /* v210 (NAV-GESTURES): two-finger rotate + tilt on the
         drive view. Pointer events are OBSERVED only (passive,
         never prevented); the NAVPURE gestureClass decides
         the channel with pinch judged first, so a pinch never
         reads as a rotate. Engaging rotate/tilt enters
         free-look like any other manual look (setDriveFree
         above); the view state composes into the plane's ONE
         transform via planeTransform, repaints go through
         paintPlane (the one writer), and the Re-center
         snap-back zeroes both adjustments.
         v215 (NAV-GESTURE-PLANE, owner's video Oct 21, 2026
         15:22 MDT — "Why is my truck moving with the zoom?"):
         the gestures now drive the map CAMERA about the
         truck, never a sheet about wherever it happens to
         sit. (1) PINCH is ours: Leaflet's touchZoom zoomed
         about the finger centroid and walked the truck's
         ground point off the avatar on every pinch; the
         observer instead calls setZoomAround on the truck's
         own latlng — the zoom changes, the truck's screen
         point does not move, and the follow camera keeps
         the truck (no free-look). (2) TWIST + TILT pivot on
         the plane's centre, which is the truck ONLY while
         the camera sits on the truck — so at the moment a
         gesture first classifies (any channel), the camera
         re-anchors on the truck (gestureAnchor below) and
         the rotation/pitch is then truly about the truck's
         GPS point, the avatar's fixed anchor. The avatar
         itself never transforms: it is a sibling overlay
         outside the plane (the v139 architecture), and with
         the camera pinned to the truck it stays over its
         GPS point through every gesture. */
      function driveGesturePaint() {
        if (S && S.drive) paintPlane((S.drive.headingApplied !== null && S.drive.headingApplied !== undefined) ? S.drive.headingApplied : (S.heading || 0));
      }
      /* v215: put the camera back on the truck before a
         two-finger gesture acts, so the gesture's pivot IS
         the truck's GPS position. A no-op when the follow
         camera already sits there (the ordinary case). */
      function gestureAnchor() {
        if (!S || !S.driveMap || !S.pos) return;
        try {
          var ctr = S.driveMap.getCenter ? S.driveMap.getCenter() : null;
          if (ctr && haversineM([ctr.lat, ctr.lng], S.pos) > 1) {
            S.driveMap.panTo(S.pos, { animate: false });
          }
        } catch (e) {}
      }
      /* v215: the pinch, applied to the camera. The zoom
         pivot is the truck's own latlng, so its container
         point — the plane centre, the avatar anchor — is
         exactly preserved by Leaflet's own zoom arithmetic.
         _pinchZooming marks the write as ours so the map's
         zoomstart hook never reads it as a free-look. */
      function gesturePinchZoom(cur) {
        if (!S || !S.driveMap || !S._gestStart) return;
        var base = S._gestBaseZoom;
        if (base === null || base === undefined) {
          try { base = S.driveMap.getZoom(); } catch (e) { base = null; }
        }
        if (base === null || base === undefined) return;
        var z = pinchZoomFrom(base, S._gestStart.dist, cur.dist);
        if (!isFinite(z)) return;
        S._pinchZooming = true;
        try {
          var pivot = S.pos || (S.driveMap.getCenter ? S.driveMap.getCenter() : null);
          if (pivot && S.driveMap.setZoomAround) S.driveMap.setZoomAround(pivot, z, { animate: false });
        } catch (e) {}
        S._pinchZooming = false;
      }
      function attachDriveGestures() {
        var mapEl = body.querySelector('#nv_drive_map');
        if (!mapEl || !mapEl.addEventListener) return;
        if (S._gestEl === mapEl) return;
        detachDriveGestures();
        S._gestEl = mapEl;
        S._pointers = {};
        S._gestStart = null; S._gestLock = null;
        S._gestBaseRot = 0; S._gestBasePitch = 50;
        S._gestBaseZoom = null; S._gestAnchored = false;
        var ptrs = function () {
          return Object.keys(S._pointers).map(function (k) { return S._pointers[k]; });
        };
        S._gDown = function (ev) {
          if (!ev || ev.pointerId === undefined || ev.pointerId === null) return;
          S._pointers[ev.pointerId] = { x: ev.clientX || 0, y: ev.clientY || 0 };
          if (ptrs().length === 2) {
            var ps = ptrs();
            S._gestStart = gestureVec(ps[0], ps[1]);
            S._gestLock = null;
            S._gestAnchored = false;
            S._gestBaseRot = S.viewRot || 0;
            S._gestBasePitch = (S.viewPitch !== null && S.viewPitch !== undefined) ? S.viewPitch : 50;
            S._gestBaseZoom = null;
            if (S.driveMap) { try { S._gestBaseZoom = S.driveMap.getZoom(); } catch (e) {} }
          }
        };
        S._gMove = function (ev) {
          if (!ev || ev.pointerId === undefined || ev.pointerId === null) return;
          if (!S._pointers[ev.pointerId]) return;
          S._pointers[ev.pointerId] = { x: ev.clientX || 0, y: ev.clientY || 0 };
          var ps = ptrs();
          if (ps.length !== 2 || !S._gestStart) return;
          var cur = gestureVec(ps[0], ps[1]);
          if (!S._gestLock) S._gestLock = gestureClass(S._gestStart, cur);
          if (S._gestLock && !S._gestAnchored) {
            /* v215: the gesture acts about the truck — put
               the camera on the truck once, at lock-in,
               before the channel's first write.
               v260: pinch is excused from the anchor pan —
               its zoom-around-the-truck (gesturePinchZoom)
               preserves the truck's screen point by Leaflet's
               own arithmetic, and the follow camera now sits
               AHEAD of the truck (followTarget, the cutoff
               compensation): panning it back onto the truck
               for a pinch would fight the follow the moment
               the fingers lift. Rotate/tilt keep the anchor —
               their pivot contract needs the camera on the
               truck, and the lift suspends while they own the
               view (see paintPlane). */
            S._gestAnchored = true;
            if (S._gestLock !== 'pinch') gestureAnchor();
          }
          if (S._gestLock === 'rotate') {
            S.viewRot = gestureRotOffset(S._gestBaseRot, S._gestStart.angle, cur.angle);
            if (!S.driveFree) setDriveFree(true);
            driveGesturePaint();
          } else if (S._gestLock === 'tilt') {
            S.viewPitch = tiltPitchFrom(S._gestBasePitch, cur.midY - S._gestStart.midY);
            if (!S.driveFree) setDriveFree(true);
            driveGesturePaint();
          } else if (S._gestLock === 'pinch') {
            /* v215: the pinch drives the CAMERA about the
               truck (Leaflet's own touchZoom is off — it
               zoomed about the fingers and walked the truck
               off its anchor). No plane write, no free-look:
               the follow camera keeps the truck at the new
               zoom. */
            gesturePinchZoom(cur);
          }
        };
        S._gUp = function (ev) {
          if (!ev || ev.pointerId === undefined || ev.pointerId === null) return;
          delete S._pointers[ev.pointerId];
          if (ptrs().length < 2) { S._gestStart = null; S._gestLock = null; S._gestAnchored = false; }
        };
        mapEl.addEventListener('pointerdown', S._gDown, { passive: true });
        mapEl.addEventListener('pointermove', S._gMove, { passive: true });
        mapEl.addEventListener('pointerup', S._gUp, { passive: true });
        mapEl.addEventListener('pointercancel', S._gUp, { passive: true });
      }
      function detachDriveGestures() {
        var mapEl = S && S._gestEl;
        if (mapEl && mapEl.removeEventListener) {
          try {
            mapEl.removeEventListener('pointerdown', S._gDown);
            mapEl.removeEventListener('pointermove', S._gMove);
            mapEl.removeEventListener('pointerup', S._gUp);
            mapEl.removeEventListener('pointercancel', S._gUp);
          } catch (e) {}
        }
        if (S) { S._gestEl = null; S._pointers = {}; S._gestStart = null; S._gestLock = null; }
      }

      /* v183 (N-limit): THE SPEED LIMIT under the truck, from
         OpenStreetMap's maxspeed tag via the free Overpass
         service — no key, no spend. Throttled: at most one query
         per 30 s and only after the truck has moved 150 m from
         the last query point. Any failure, or a road with no
         maxspeed tag, leaves the last honest state (badge hides
         when no number is known) — never an invented limit. */
      function maybeFetchSpeedLimit() {
        if (!S || !S.drive || !S.pos || !S.settings.showSpeedLimit) return;
        if (typeof fetch !== 'function') return;
        var now = Date.now();
        if (S.limitFetchedAt && now - S.limitFetchedAt < 30000) return;
        if (S.limitPos && haversineM(S.limitPos, S.pos) < 150) return;
        S.limitFetchedAt = now; S.limitPos = S.pos;
        var lat = S.pos[0], lon = S.pos[1];
        var q = '[out:json][timeout:8];way(around:25,' + lat + ',' + lon + ')["maxspeed"];out tags 1;';
        fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q) })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (!S) return;
            var v = null;
            if (j && j.elements) {
              for (var i = 0; i < j.elements.length; i++) {
                var t = j.elements[i].tags && j.elements[i].tags.maxspeed;
                var parsed = parseMaxspeed(t);
                if (parsed) { v = parsed; break; }
              }
            }
            S.limitKmh = v;
            paintSpeedOverlay();
          })
          .catch(function () {});
      }

      function startDrive() {
        if (!S.plan || !S.line) { note('Get a route first — Drive opens on an active route.'); return; }
        if (S.drive) return;
        S.drive = { said: {}, headingApplied: null, remSeg: -1, remAlong: 0, rrShown: null, animId: null, insetKey: '', arrows: null, trayKey: '' };
        /* v212: arm the shell's drive bridges — PiP on leave,
           tray readout updates from the tick. Inert off-shell. */
        try { if (window.ShiftTrack && ShiftTrack.setDriving) ShiftTrack.setDriving(true); } catch (e) {}
        /* v135: hold the screen awake for the drive (see
           driveWake) and re-hold it after any foreground return.
           The handler rides on S so teardown can remove it too. */
        driveWake(true);
        S.wakeVis = onDriveVis;
        try { document.addEventListener('visibilitychange', onDriveVis); } catch (e) {}
        /* v125 claimed this class hid the shell's chat FAB while
           Drive is open; v135 (owner, Oct 17 12:05: "that mic…
           should be on the side!") corrects the record: the only
           mt-driving CSS rule ever written targeted #fbFab — the
           FEEDBACK button — so the chat FAB (#chatFab, the 🎤)
           was never governed by it and floated mid-map in his
           recordings. The class now drives the chat FAB's SIDE
           DOCK (css/style.css + js/chatbot.js): while Drive is
           open the road hand sits docked at the screen's side
           edge, reachable and off the map's middle. */
        try { document.body.classList.add('mt-driving'); } catch (e) {}
        var scr = body.querySelector('#nv_drive_screen');
        if (scr) scr.classList.remove('hidden');
        if (window.L && body.querySelector('#nv_drive_map')) {
          try {
            S.driveMap = L.map('nv_drive_map', {
              zoomControl: false, attributionControl: false,
              /* v183: dragging ON (free-look pan).
                 v215: Leaflet pinch (touchZoom) OFF — it
                 zoomed about the fingers, not the truck;
                 the observer drives pinch instead (see
                 attachDriveGestures). Other zooms off. */
              dragging: true,
              scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false,
              keyboard: false, touchZoom: false,
              /* v125 flicker fix (owner's headline defect): no
                 tile fade-in on the drive map — Leaflet's fade
                 re-paints every fresh tile from opacity 0 on
                 every recenter, which over a continuous drive
                 reads as constant flicker. Tiles now land whole. */
              fadeAnimation: false
            }).setView(S.pos || S.line[0], 18); /* v178 (A3): one zoom closer — road names read bigger at a glance */
            /* v232/v235 (NAV-MAP-BLANK-V40): maxNativeZoom 15 —
               Esri serves BLANK single-colour tiles at zooms
               17-18 for newer/fringe areas it hasn't detailed,
               and the hole over the owner's own home block
               reaches down through zoom 16 (verified tile by
               tile against the live CDN at 51.15709,-113.93862:
               z18/z17 one flat colour, the z16 tile over his
               crescent empty too — the z15 tile is the deepest
               level that carries his street network; his work
               areas are rich at every level). v232 first capped
               at 16, which healed other areas but not his
               block; 15 is the level that always has the roads.
               The drive view stays at zoom 18 (v178 framing);
               Leaflet scales the z15 tiles up to it.
               v240 (NAV-LAYERS-BUTTON): the base stack is
               painted by paintDriveLayers (below) — the same
               painter the layers button re-runs on a switch,
               so the drive never opens on a different stack
               than a switch would build, and EVERY layer in
               the stack fetches at native 15 under the z18
               view: the coverage contract holds on all of
               them. */
            paintDriveLayers();
            /* v260 (NAV-TOP-CUTOFF): open already compensated —
               size the lift from the viewport and centre the
               camera on the follow target, so the first frame
               the driver sees has the truck on its anchor with
               the road ahead filling the screen, not a
               truck-centred frame the first tick has to fix. */
            try {
              var vpl = body.querySelector('.nv-drive-viewport');
              if (vpl && vpl.clientHeight) S.driveLiftPx = Math.round(vpl.clientHeight * 0.49);
              var ftI = followTarget();
              if (ftI && S.pos) S.driveMap.panTo(ftI, { animate: false });
            } catch (e) {}
            /* v183: a user drag enters free-look. Leaflet fires
               dragstart only for real gestures (programmatic
               panTo does not), so the follow camera never
               fights the driver.
               v215: zoomstart no longer means free-look on its
               own — the only zooms left on this map are the
               gesture observer's own camera pinches (applied
               under _pinchZooming / the 'pinch' lock), and a
               pinch about the truck must NOT stand the follow
               camera down: the truck stays followed at the
               new zoom. The guard keeps the hook honest for
               any other zoom source. */
            try {
              S.driveMap.on('dragstart', function () { setDriveFree(true); });
              S.driveMap.on('zoomstart', function () {
                if (S._pinchZooming || S._gestLock === 'pinch') return;
                setDriveFree(true);
              });
            } catch (e) {}
            /* v210: two-finger observers (passive). v215: they
               now also carry the pinch — see the touchZoom note
               at the map's creation and attachDriveGestures. */
            try { attachDriveGestures(); } catch (e) {}
            S.driveLine = makeDriveLine().addTo(S.driveMap);
            /* v178 (F2): the route-arrow pool — ten chevron
               markers created ONCE here and only ever MUTATED
               (setLatLng / setIcon / setOpacity) by the tick's
               remainder redraw, on that redraw's existing ~10 m
               cadence. No per-tick layer traffic (v128 rule). */
            try {
              if (L.marker && L.divIcon && S.drive) {
                S.drive.arrows = [];
                for (var ai = 0; ai < 10; ai++) {
                  S.drive.arrows.push(L.marker(S.line[0], { icon: arrowIcon(0), interactive: false, opacity: 0, keyboard: false }).addTo(S.driveMap));
                }
              }
            } catch (e) {}
            /* v104: the position marker joins the settle pass
               below, not this first paint — the same un-settled-
               size balloon the planning map grew (see the map
               init) must never form on this map either. driveTick
               keeps it glued to the truck once it exists. */
            setTimeout(function () {
              try {
                if (!S || !S.driveMap) return;
                S.driveMap.invalidateSize();
                if (S.drive && S.pos && !S.driveMarker) {
                  /* v280 (NAV-GPS-FLICKER, owner Oct 29, 2026):
                     NO circleMarker on the drive map any more.
                     The blue dot was a SECOND position render
                     riding the plane under the truck overlay —
                     as the follow camera eased and panned, the
                     two separated and alternated on his glass
                     ("flipping between the truck icon and the
                     plain dot"). One drive, ONE marker: the
                     truck overlay (#nvd_you) at the anchor, fed
                     by the one onPos stream. S.driveMarker stays
                     null; its tick/exit guards already no-op. */
                }
              } catch (e) {}
            }, 120);
            /* v107: a SECOND settle pass — on slower phones the
               first pass can still race the layout, and a map sized
               before the drive screen finished opening leaves the
               far edge short of the viewport (the dead band). One
               more invalidateSize once everything has settled. */
            setTimeout(function () {
              try { if (S && S.driveMap) S.driveMap.invalidateSize(); } catch (e) {}
            }, 650);
          } catch (e) { S.driveMap = null; }
        }
        /* v273 (NAV-SMALL-SCREEN-BLUE): register the size refit
           the module-level PiP/resize seams call — the tick
           lives in THIS closure, so the hook is born with the
           map. Same pair the parked-restore path uses:
           invalidateSize, then a tick (re-centres on the
           follow target, repaints the plane at the new size).
           exitDrive/teardown clear it with the drive's state. */
        if (S.driveMap) {
          S._refitDrive = function () {
            try {
              if (!S || !S.driveMap) return;
              S.driveMap.invalidateSize();
              driveTick();
            } catch (e) {}
          };
        }
        /* v215 (NAV-GESTURE-PLANE): a NEW drive always opens
           on the pure chase view — the manual two-finger
           adjustments (viewRot/viewPitch) are zeroed HERE, at
           entry, not only on the previous drive's exit, so no
           residual lean or pitch can ever greet a fresh drive
           (owner, Oct 21, 2026 15:24 MDT: "tilt towards the
           right of the truck is still there" on a view nobody
           had adjusted that drive). */
        S.viewRot = 0; S.viewPitch = null;
        /* v208 (VOICE-ON-AT-DRIVE-START, owner Oct 21, 2026):
           a NEW drive always starts with the voice ON. The mute
           used to persist invisibly in the settings store — a
           tap from an earlier drive carried into this one, and
           the owner drove with no audio while nothing at drive
           start reset it or announced it. The reset is written
           back to the same store, so the planning face (painted
           below) agrees with the drive bar; muting mid-drive
           still works — for THIS drive only. */
        if (S.settings.muted) {
          S.settings.muted = false;
          saveSettings({ muted: false });
        }
        paintMute();
        /* v262: the drive map exists now — hang the incident
           markers on it and refresh the list for the drive. */
        fetchTraffic(false);
        paintTrafficMarkers();
        pollTrafficEta(true); /* v280: one traffic-ETA probe per drive */
        /* v266 (NAV-MAP-BLANK): the opening tick is guarded —
           a fault anywhere in the paint path must not abort
           drive-open itself (pre-v266 an unguarded lane-query
           throw escaped here and the drive opened with the
           plane never painted). saidNow semantics unchanged:
           null when the tick said nothing (or could not run),
           and the fallback announcement below still fires. */
        var saidNow = null;
        try { saidNow = driveTick(); } catch (e) {}
        if (!saidNow) {
          var cur = S.plan.maneuvers[S.manIdx] || S.plan.maneuvers[0];
          if (cur) speak(cur.verbalPre || cur.instruction);
        }
      }

      function exitDrive() {
        if (!S || !S.drive) return;
        /* v212: the shell's drive bridges stand down with the
           drive — PiP disarmed, tray readout cleared, any native
           line in flight stopped. Inert off-shell. */
        try { if (window.ShiftTrack && ShiftTrack.setDriving) ShiftTrack.setDriving(false); } catch (e) {}
        try { if (window.ShiftTrack && ShiftTrack.navNotifyClear) ShiftTrack.navNotifyClear(); } catch (e) {}
        try { if (window.ShiftTrack && ShiftTrack.stopNativeSpeak) ShiftTrack.stopNativeSpeak(); } catch (e) {}
        /* v227: the docked tracker face stands down with the
           drive — End-drive is one of the two ways the map (and
           its float) shuts off. */
        if (S.parked) { S.parked = false; try { if (window.App && App.setDriveDocked) App.setDriveDocked(false); } catch (e) {} }
        /* v183: free-look state dies with the drive. */
        if (S.driveFreeTimer) { try { clearTimeout(S.driveFreeTimer); } catch (e) {} S.driveFreeTimer = null; }
        S.driveFree = false;
        /* v210: gesture observers + the manual view die too —
           the next drive opens on the pure chase view. */
        try { detachDriveGestures(); } catch (e) {}
        S.viewRot = 0; S.viewPitch = null;
        S.driveLiftPx = 0; /* v260: the cutoff lift dies with the drive */
        /* v104: leaving Drive — by the driver's tap or by the
           arrival hand-back — spends the arm: no re-route for
           this destination will auto-enter again. */
        S.driveAutoSpent = true;
        /* v178 (A2): the smoothing loop dies with the drive. */
        try { if (S.drive.animId !== null && S.drive.animId !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(S.drive.animId); } catch (e) {}
        S.drive = null;
        /* v135: the drive wake lock ends with the drive. */
        driveWake(false);
        S.wakeVis = null;
        try { document.removeEventListener('visibilitychange', onDriveVis); } catch (e) {}
        try { document.body.classList.remove('mt-driving'); } catch (e) {}
        try { document.body.classList.remove('mt-pip'); } catch (e) {}
        if (S.driveTimer) { try { clearTimeout(S.driveTimer); } catch (e) {} S.driveTimer = null; }
        try { if (S.driveMap) S.driveMap.remove(); } catch (e) {}
        S.driveMap = null; S.driveLine = null; S.driveMarker = null; S.driveTrafficGroup = null;
        var scr = body.querySelector('#nv_drive_screen');
        if (scr) scr.classList.add('hidden');
        /* v222: a drive that was restored from the park has no
           plan face rebuilt beneath it — rebuild the module fresh
           now that the drive is over, so End Drive lands on the
           module's real face, never a blank body. */
        if (S._restoredParked) {
          S._restoredParked = false;
          try { api.render(nvBody); } catch (e) {}
        }
      }

      /* v116: the shell's back hook for this render — Back while
         driving exits Drive back to the plan view (api.back calls
         this); it never leaves the module mid-drive. */
      S.backFn = function () {
        if (S && S.drive) { exitDrive(); return true; }
        return false;
      };

      /* A re-route landed while driving: fresh plan, fresh prompt
         flags, fresh line on the drive map. */
      function driveOnRoute() {
        if (!S.drive) return;
        S.drive.said = {};
        S.drive.headingApplied = null;
        S.drive.remSeg = -1; S.drive.remAlong = 0;
        S.drive.rrShown = null;
        if (S.driveMap && S.line) {
          try {
            if (S.driveLine) S.driveMap.removeLayer(S.driveLine);
            S.driveLine = makeDriveLine().addTo(S.driveMap);
          } catch (e) {}
        }
        /* v266 (NAV-MAP-BLANK): guarded like startDrive's
           opening tick — a re-route's first paint must not
           throw back into the routing chain. */
        try { driveTick(); } catch (e) {}
      }

      /* v133: THE BLANKING FIX — one cached writer for ALL of the
         drive chrome's text. Owner evidence (Oct 17, 11:39 MDT,
         39 s recording): the banner and bar TEXT vanished for
         seconds at a time on the v128 code — navy boxes painted,
         content empty — while the guidance data stayed alive.
         v128's instrumented pins (zero layer churn, zero innerHTML)
         were all true and all beside the point: the meter nobody
         had run is textContent. The old driveTick assigned
         textContent on ALL FIVE text nodes on EVERY GPS fix —
         measured by tools/navigator-v133-test.js on the real
         module: 20 standstill re-fires = 100 assignments, every
         one of them byte-identical to what was already there;
         60 approach fixes = 300 assignments, 183 of them
         same-value. EVERY assignment replaces the text node and
         invalidates that element's paint; under the 340%
         transformed plane the Android WebView compositor starves
         exactly those re-rasters, so the (rarely invalidated)
         navy boxes stay and their (constantly invalidated) text
         empties. And one vector needed no compositor at all:
         when the next maneuver's instruction string is empty,
         the old tick wrote '' over a good instruction — measured
         13 literal blank writes in the same 60 fixes.
         The writer below makes blanking structurally impossible
         from the DOM side: a value is assigned ONLY when it
         changes (an unchanged node is never touched, its paint
         never invalidated), and the guidance nodes go through
         driveTextKeep — a momentarily empty computed value never
         erases the last good text mid-drive; it simply isn't
         written. The values are cached per render (S is the
         render's state bag, the DOM is rebuilt with it), so the
         cache can never disagree with the glass. */
      function driveText(el, key, value) {
        if (!el) return;
        if (!S.driveTextCache) S.driveTextCache = {};
        if (S.driveTextCache[key] === value) return;
        S.driveTextCache[key] = value;
        el.textContent = value;
      }
      function driveTextKeep(el, key, value) {
        if (value === '' || value === null || value === undefined) return;
        driveText(el, key, value);
      }

      /* One drive paint per GPS fix, off the module's one watch.
         Returns the text spoken (if any) so startDrive can avoid
         double-announcing. */
      /* v240 (NAV-LAYERS-BUTTON): the drive map's base stack —
         painted at Drive-open and re-painted by the layers
         button on a switch. Standard = the street layer (v260:
         OSM standard with its retuned lift class — see
         driveTileSpec); Satellite = Esri World Imagery (real
         aerial tiles, probed live); Elevation = the street
         layer PLUS the World Hillshade at 45% — real shaded
         relief over the streets, roads still readable. Traffic
         is not a base layer — it rides over any base as
         incident markers (the v262 block below paintDriveLayers).
         A switched-away resilient layer's self-heal watchdog
         keeps its own (now detached) layer — a no-op off-map,
         the shipped v220 posture.
         v260: the native zoom now rides the SPEC
         (spec.maxNative): street and satellite render at
         native z18 under the z18 view — no upscaling, which
         was the pixelation the owner reported. The hillshade
         overlay keeps native 15: relief is soft by nature and
         sits under the same upscale it always had. */
      function paintDriveLayers() {
        if (!S || !S.driveMap) return;
        var kind = (S.settings && S.settings.driveLayer) || 'standard';
        if (S.driveBaseLayer) { try { S.driveMap.removeLayer(S.driveBaseLayer); } catch (e) {} S.driveBaseLayer = null; }
        if (S.driveHillLayer) { try { S.driveMap.removeLayer(S.driveHillLayer); } catch (e) {} S.driveHillLayer = null; }
        var spec = kind === 'satellite' ? satelliteTileSpec() : driveTileSpec();
        S.driveBaseLayer = resilientTileLayer(spec.url, { maxZoom: 18, maxNativeZoom: spec.maxNative || 15, keepBuffer: 4, className: spec.cls }).addTo(S.driveMap);
        if (kind === 'elevation') {
          S.driveHillLayer = L.tileLayer(HILLSHADE_TILE_URL, { maxZoom: 18, maxNativeZoom: 15, opacity: 0.45, className: 'nv-tile-hill' }).addTo(S.driveMap);
        }
      }

      /* v262 (NAV-LIVE-TRAFFIC-CITYFEED): the City of Calgary
         CURRENT traffic incidents feed, fetched straight from
         the city's Socrata endpoint (CORS-open, no key) on the
         v179 lazy-fetch pattern: at render, at route time, at
         Drive-open, then on a 2-minute cadence gated inside the
         drive tick — no extra timer to leak. The upstream feed
         itself republishes continuously (10-minute resolution),
         so 2 minutes is well inside its freshness. A failed
         fetch keeps the last good list and says nothing — the
         layer never fakes freshness it does not have. */
      var TRAFFIC_FEED_URL = 'https://data.calgary.ca/resource/4jah-h97u.json?$limit=100&$order=start_dt_utc%20DESC';
      var TRAFFIC_REFRESH_MS = 120000;
      var TRAFFIC_RADIUS_M = 40000; /* markers: within 40 km of the truck / map centre */
      var TRAFFIC_OFF_M = 75;       /* an incident counts as ON the route within 75 m of its line */
      var TRAFFIC_AHEAD_M = 3000;   /* warnings + chip cover the 3 km ahead */

      function trafficIcon() {
        return L.divIcon({ className: 'nv-traffic-pin-wrap', html: '<div class="nv-traffic-pin">⚠</div>', iconSize: [30, 30], iconAnchor: [15, 15] });
      }

      /* Rebuild both marker groups from S.trafficList. Runs on
         the refresh cadence only — never per tick (the v128
         mutate-don't-rebuild rule governs the tick; a rebuild
         every 2 minutes of a handful of markers is the lane /
         grade fetch pattern, off the critical path). */
      function paintTrafficMarkers() {
        if (!window.L || !S || typeof L.layerGroup !== 'function' || typeof L.marker !== 'function') return;
        var centre = S.pos || null;
        if (!centre && S.map) { try { var c = S.map.getCenter(); if (c) centre = [c.lat, c.lng]; } catch (e) {} }
        var near = (S.trafficList || []).filter(function (inc) {
          return !centre || haversineM(centre, [inc.lat, inc.lng]) <= TRAFFIC_RADIUS_M;
        });
        function build(interactive) {
          var kids = near.map(function (inc) {
            var mk = L.marker([inc.lat, inc.lng], { icon: trafficIcon(), interactive: interactive, keyboard: false });
            if (interactive && mk.bindPopup) {
              mk.bindPopup('<b>⚠ ' + esc(inc.info || 'Traffic incident') + '</b>' +
                (inc.desc ? '<br>' + esc(inc.desc) : '') +
                '<br><span style="color:#666">City of Calgary — live traffic incidents</span>');
            }
            return mk;
          });
          return L.layerGroup(kids);
        }
        var on = !!(S.settings && S.settings.trafficOn);
        if (S.map) {
          if (S.trafficGroup) { try { S.map.removeLayer(S.trafficGroup); } catch (e) {} S.trafficGroup = null; }
          S.trafficGroup = build(true);
          if (on) S.trafficGroup.addTo(S.map);
        }
        if (S.driveMap) {
          if (S.driveTrafficGroup) { try { S.driveMap.removeLayer(S.driveTrafficGroup); } catch (e) {} S.driveTrafficGroup = null; }
          S.driveTrafficGroup = build(false);
          if (on) S.driveTrafficGroup.addTo(S.driveMap);
        }
      }

      function applyTrafficVisibility() {
        if (!S) return;
        var on = !!(S.settings && S.settings.trafficOn);
        if (!on) {
          try {
            if (S.trafficGroup && S.map) S.map.removeLayer(S.trafficGroup);
            if (S.driveTrafficGroup && S.driveMap) S.driveMap.removeLayer(S.driveTrafficGroup);
          } catch (e) {}
          return;
        }
        paintTrafficMarkers();
        fetchTraffic(false);
      }

      /* v280 (NAV-TRAFFIC-LIVE-ETA — the licensed-duration half):
         the owner's design (Oct 29, 2026, decision 13:37 MDT) —
         our own nav server asks a LICENSED traffic provider for
         the live duration of the remaining route, and the app
         shows the answer as NUMBERS on its own drive view.
         Provider chosen: TOMTOM Routing (summary only). Two
         reasons, both named: (1) Google's own Routes service
         terms forbid Routes content "in conjunction with a
         non-Google map", so Google durations are NOT displayed
         over this OSM map; TomTom's API is licensed for
         integration into third-party applications. (2) TomTom's
         freemium allowance (2,500 non-tile transactions/day, no
         credit card) honestly covers the poll: ONE call per
         180 s = 20/active hour = ~160 per 8-hour driving day
         (480 even if a drive ran 24 h). The server requests
         routeRepresentation=summaryOnly — no geometry is ever
         fetched, returned, cached or stored; the driven route
         stays the truck-legal Valhalla route. The endpoint only
         answers when TOMTOM_API_KEY is configured SERVER-side;
         no key exists on the box yet, so the probe below hears
         traffic_not_configured once per drive and the live
         Socrata + measured-pace ETA carries the drive. Adding
         the free-tier key server-side flips this half on with
         no app change. */
      var PROVIDER_ETA_POLL_MS = 180000;
      function pollTrafficEta(force) {
        if (!S || !S.drive || !S.pos || !S.dest || !S.settings.trafficOn) return;
        if (typeof fetch !== 'function' || !S.settings.serverUrl) return;
        var now = Date.now();
        if (!force && S.providerChecked && !S.providerLive) return; /* probed: not configured — never re-burn */
        if (!force && S.providerAt && now - S.providerAt < PROVIDER_ETA_POLL_MS) return;
        S.providerAt = now; S.providerChecked = true;
        var hdrs = { 'Content-Type': 'application/json' };
        try { if (window.PowerRead && PowerRead.APP_TOKEN) hdrs['X-Meticulous-App'] = PowerRead.APP_TOKEN; } catch (e) {}
        try {
          fetch(S.settings.serverUrl.replace(/\/+$/, '') + '/ai/traffic-eta', {
            method: 'POST', headers: hdrs, cache: 'no-store',
            body: JSON.stringify({ origin: [S.pos[0], S.pos[1]], dest: [S.dest[0], S.dest[1]] })
          })
            .then(function (r) { return r.json(); })
            .then(function (j) {
              if (!S) return;
              var dur = j ? Number(j.durationSec) : NaN;
              if (isFinite(dur) && dur > 0) {
                S.providerLive = true;
                S.providerName = (j && j.source === 'tomtom-routing') ? 'TomTom' : 'Traffic provider';
                S.providerEta = { at: Date.now(), durSec: dur, staticSec: isFinite(Number(j.staticDurationSec)) ? Number(j.staticDurationSec) : dur };
              } else { S.providerLive = false; S.providerEta = null; }
            })
            .catch(function () { S.providerLive = false; });
        } catch (e) {}
      }

      function fetchTraffic(force) {
        if (!S || !S.settings || !S.settings.trafficOn) return;
        if (typeof fetch !== 'function') return;
        var now = Date.now();
        if (!force && S.trafficAt && now - S.trafficAt < TRAFFIC_REFRESH_MS) return;
        /* the attempt is stamped up front, so a dead feed can
           never hot-loop the tick — same cooldown spirit as the
           v238 lane lookup. */
        S.trafficAt = now;
        try {
          fetch(TRAFFIC_FEED_URL)
            .then(function (r) { return r.json(); })
            .then(function (rows) {
              if (!S) return;
              S.trafficList = parseCityIncidents(rows);
              paintTrafficMarkers();
            })
            .catch(function () {});
        } catch (e) {}
      }

      /* v227 (NAV-LANE-WARMUP-SCOPE — found on the F1 path):
         fetchLaneCount was declared INSIDE the map-init block
         above, where strict-mode block scoping hides it from
         driveTick — every tick within 3 km of a turn threw a
         ReferenceError BEFORE the tick's final driveAnimKick(),
         so the camera animator was never kicked in exactly the
         stretch where turns approach. The declaration now lives
         at render-body level, where its caller is. Pure move —
         the body is byte-identical. */
      /* v196 (NAV-LANES): the lane count for the approach
         road of maneuver `idx`, read lazily from
         OpenStreetMap (Overpass) — the route response
         carries no lane data (verified live, Oct 21).
         Fires once per maneuver per route; the answer (or
         a tried-and-none 0) lands in S.laneByTurn, and if
         the pop-up is showing that maneuver the inset key
         clears so the strip paints on the next fix. Any
         failure leaves NO strip — honest absence, never
         an invented lane (v178's rule).
         v238 (NAV-LANE-INFO-REAL): the same lookup now also
         reads OSM turn:lanes (see pickTurnLanes) — the answer
         cached per maneuver is the pair {count, turn}. */
      function fetchLaneCount(idx) {
        /* v266 (NAV-MAP-BLANK): self-guarded wrapper. This
           warm-up rides the drive tick's paint path under a
           silent-on-any-failure contract — but pre-v266 its
           query build threw (see fetchLaneCountRun) and the
           throw escaped the tick before the plane paint, at
           drive-open even escaping startDrive. Nothing this
           lookup does may ever throw back into the tick; the
           real work runs in fetchLaneCountRun below. */
        try { fetchLaneCountRun(idx); } catch (e) {}
      }
      function fetchLaneCountRun(idx) {
        S.laneByTurn = S.laneByTurn || {}; S.laneFetch = S.laneFetch || {};
        if (S.laneByTurn[idx] !== undefined || !S.plan || !S.line) return;
        var m = S.plan.maneuvers[idx]; if (!m) return;
        /* v220 (NAV-LANES-INHANDS-FAIL): two systematic killers
           of the v196 lookup, both fixed here.
           (1) THE QUERY POINT: v196 asked about ways around the
           TURN POINT — the middle of the junction, where the
           CROSS street's ways (with their own lanes tags) sit
           inside the same 30 m circle and make the answer
           ambiguous, which pickLaneCount honestly reads as
           "no strip". The question is about the APPROACH road:
           ask around a point ~40 m BEFORE the turn instead.
           (2) THE POISONED CACHE: one transient Overpass
           failure (the public endpoint rate-limits and stalls
           routinely) used to be cached as a tried-and-none 0
           for the whole drive — every strip absent, all day.
           A failure now falls back once to the kumi.systems
           mirror, and a total failure caches NOTHING: the
           lookup retries on the tick's later calls after a
           20 s cooldown. Only a successful-but-empty answer
           earns the honest 0. */
        var lastTry = S.laneFetch[idx] || 0;
        if (lastTry && Date.now() - lastTry < 20000) return;
        S.laneFetch[idx] = Date.now();
        var tp = pointAlongLine(S.line, Math.max(0, m.cumEndKm * 1000 - 40));
        var street = (m.streets && m.streets[0]) || '';
        /* v238 (NAV-LANE-INFO-REAL): the query also asks for
           ways carrying turn:lanes tagging — the REAL per-lane
           movements — alongside the v196 count ways.
           v266 (NAV-MAP-BLANK): pointAlongLine returns a
           [lat, lng] ARRAY — every other caller indexes it —
           but this query read tp.lat / tp.lng off it, so
           building the query threw a TypeError on the FIRST
           tick within 3 km of any turn (and again at every
           maneuver boundary and 20 s cooldown lapse). The
           throw escaped driveTick BEFORE the inset paint,
           the traffic chip, the follow pan, the PLANE PAINT
           and the animator kick — and at drive-open inside
           3 km it escaped startDrive itself, so the chase
           transform was never painted (owner's Oct 26
           recordings: guidance alive on a flat, unpitched
           map for the whole approach). The lookup has in
           fact never completed since v196; the suites only
           ever tested the pure pickers. Index the array. */
        var q = '[out:json][timeout:8];(way(around:25,' + tp[0].toFixed(6) + ',' + tp[1].toFixed(6) + ')["highway"]["lanes"];' +
          'way(around:25,' + tp[0].toFixed(6) + ',' + tp[1].toFixed(6) + ')["highway"][~"^turn:lanes"~"."];);out tags 24;';
        var endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
        var attempt = function (k) {
          return fetch(endpoints[k], { method: 'POST', body: 'data=' + encodeURIComponent(q) })
            .then(function (r) {
              if (!r.ok) throw new Error('overpass ' + r.status);
              return r.json();
            });
        };
        attempt(0).catch(function () { return attempt(1); })
          .then(function (j) {
            /* v238: the cached answer is the pair — the v196
               count AND the real per-lane movements (or null).
               A successful-but-empty answer still earns the
               honest empty pair, never a cached failure. */
            var els = j && j.elements ? j.elements : null;
            S.laneByTurn[idx] = {
              count: els ? pickLaneCount(els, street) : 0,
              turn: els ? pickTurnLanes(els, street) : null
            };
            if (S.drive && S.drive.insetKey && S.drive.insetKey.split(':')[0] === String(idx)) S.drive.insetKey = '';
          })
          .catch(function () { /* total failure: cache nothing — a later tick retries */ });
      }

      function driveTick() {
        if (!S.drive || !S.plan || !S.line || !S.pos || S.arrived) return null;
        var pr = distToRouteM(S.pos, S.line);
        var dp = driveProgress(S.plan, pr.along);
        var showNext = !!dp.next;
        /* v133: every write below goes through the cached writer
           (see driveText) — on change only, and the guidance four
           keep their last good value over a momentary empty. */
        var distEl = body.querySelector('#nvd_dist');
        driveTextKeep(distEl, 'dist', fmtDist(showNext ? dp.toTurnM : dp.leftM));
        var instEl = body.querySelector('#nvd_inst');
        driveTextKeep(instEl, 'inst', showNext ? dp.next.instruction : (dp.current ? dp.current.instruction : ''));
        var roadEl = body.querySelector('#nvd_road');
        driveText(roadEl, 'road', dp.road ? 'On ' + dp.road : '');
        /* v280 (NAV-TRAFFIC-LIVE-ETA): the LIVE ETA. The plan's
           own remaining time (dp.etaMin) is a snapshot from
           route time; the live figure recomputes EVERY tick
           from (a) the truck's measured pace over the last
           180 s of GPS (paceSpeed — congestion slows the pace
           and the ETA honestly extends; no delay figure is
           ever invented), blended half-and-half with the plan
           pace so one red light cannot swing it, and (b) when
           the server's Google traffic endpoint is configured
           the server's licensed traffic endpoint is configured
           (pollTrafficEta — no provider key on the box yet),
           its live duration for the remaining route, with the
           traffic delay it reports shown by name. The ETA line
           also carries the visible congestion STATE every tick
           (Slow traffic / Traffic flowing / provider delay), so
           what his eyes see is a live picture, not a toggle. */
        var liveEtaMin = dp.etaMin;
        var paceV = paceSpeed();
        if (paceV > 0 && S.plan.totalKm > 0 && S.plan.totalMin > 0 && dp.leftM > 0) {
          var planV = (S.plan.totalKm * 1000) / (S.plan.totalMin * 60);
          var blendV = (planV + paceV) / 2;
          if (blendV > 0) liveEtaMin = (dp.leftM / blendV) / 60;
        }
        var trafficStateTxt = '';
        if (S.providerLive && S.providerEta && (Date.now() - S.providerEta.at) < 300000) {
          var pRemainSec = Math.max(0, S.providerEta.durSec - (Date.now() - S.providerEta.at) / 1000);
          liveEtaMin = pRemainSec / 60;
          var pDelayMin = Math.round((S.providerEta.durSec - S.providerEta.staticSec) / 60);
          trafficStateTxt = (pDelayMin >= 2)
            ? ' · traffic +' + pDelayMin + ' min · ' + (S.providerName || 'Traffic provider')
            : ' · Traffic flowing · ' + (S.providerName || 'Traffic provider');
        } else if (paceV > 0) {
          trafficStateTxt = (liveEtaMin - dp.etaMin >= 2) ? ' · Slow traffic' : ' · Traffic flowing';
        }
        S.liveEtaMin = liveEtaMin;
        var etaMain = body.querySelector('#nvd_eta_main');
        driveTextKeep(etaMain, 'etaMain', fmtClock(new Date(Date.now() + liveEtaMin * 60000)));
        var etaSub = body.querySelector('#nvd_eta_sub');
        /* v177 (F4): the speedometer overlay reads the GPS
           stream's own speed (m/s -> km/h), through the cached
           writer like every other drive-chrome text. */
        var spdEl = body.querySelector('#nvd_speed');
        if (spdEl && S.settings.showSpeed) driveText(spdEl, 'speed', (S.speed !== null && S.speed !== undefined && isFinite(S.speed)) ? String(Math.max(0, Math.round(S.speed * 3.6))) : '–');
        driveTextKeep(etaSub, 'etaSub', 'Arrive · ' + fmtMin(liveEtaMin) + ' · ' + fmtDist(dp.leftM) + ' left' + trafficStateTxt +
          /* v107: the bar shows the destination's first segment
             only — a full address would crowd the line (the CSS
             ellipsizes the sub-line; the main line never wraps). */
          (S.destLabel ? ' · to ' + S.destLabel.split(',')[0] : ''));
        /* v212 (TRAY READOUT — Stage E): the same next-turn
           facts, mirrored to the notification tray through the
           shell bridge, so they stay readable while the app is
           minimized. Change-gated on the composed line — the
           bridge hears about a new instruction or distance, not
           a per-tick stream. Inert off-shell. */
        try {
          if (window.ShiftTrack && ShiftTrack.navNotify) {
            var trayInst = showNext ? dp.next.instruction : (dp.current ? dp.current.instruction : '');
            var trayDist = fmtDist(showNext ? dp.toTurnM : dp.leftM);
            var trayKey = trayInst + '|' + trayDist;
            if (trayInst && S.drive.trayKey !== trayKey) {
              S.drive.trayKey = trayKey;
              ShiftTrack.navNotify(trayInst, trayDist + (dp.road ? ' · On ' + dp.road : '') + ' · ' + fmtDist(dp.leftM) + ' left');
            }
          }
        } catch (e) {}
        var rrEl = body.querySelector('#nvd_reroute');
        if (rrEl) {
          var showRr = S.rerouting || pr.dist > 60;
          /* v128: the pill is STATE, not a per-tick write — its
             class and text are touched only when the shown state
             actually flips (hidden / off-route / rerouting). */
          var rrKey = showRr ? (S.rerouting ? 'rerouting' : 'offroute') : 'hidden';
          if (S.drive.rrShown !== rrKey) {
            S.drive.rrShown = rrKey;
            rrEl.classList.toggle('hidden', !showRr);
            rrEl.textContent = S.rerouting ? 'Rerouting…' : 'Off route';
          }
        }
        /* v178 (F2): the turn inset — appears for the last
           400 m before a turn, repainted only when the maneuver
           or the 50 m distance bucket changes (the v133
           write-on-change discipline; the arrow is an SVG
           transform attribute, not a style write). */
        var insetEl = body.querySelector('#nvd_inset');
        if (insetEl) {
          /* v195 (NAV-POPUP): the window doubles to 800 m — at
             highway speed the old 400 m gave the driver ~14 s
             with a card the size of a postage stamp, and in his
             Oct 21 08:09 drive video no pop-up registered at
             all. The pop-up is now the junction view: an enlarged
             drawing of the turn itself (junctionViewSvg) over
             the v178 header (bent arrow + distance + words).
             v237 (NAV-INSET-SMALL-TOPRIGHT): the card itself is
             now SMALL and docked top-right under the banner
             (CSS only — this paint is unchanged apart from the
             compact 38px header arrow). */
          /* v196 (NAV-LANES): warm the OSM lane lookup for
             the upcoming turn while it is still 3 km out, so
             the strip is ready when the pop-up shows. Lazy,
             once per maneuver per route, off the critical
             path (the v179 pattern); silent on any failure.
             v266 (NAV-MAP-BLANK): the fetcher is SELF-GUARDED
             for the same reason (see fetchLaneCount) — an
             unguarded throw here aborted the whole tick
             before the plane paint (the v227 blast radius,
             proven again on the render harness). */
          if (dp.next && dp.toTurnM <= 3000) fetchLaneCount(dp.idx);
          var showInset = !!dp.next && dp.toTurnM <= 800;
          /* v192 (NAV-UTURN): a turn-around arrow IS a U-turn
             instruction. If the route the engine finally gave
             still doubles back at this maneuver (every exclusion
             round spent), the inset does not draw it — the banner
             keeps the plain continuation words and no arrow ever
             points the truck back at itself. */
          var dDeg = showInset ? Math.round(turnDeltaDeg(S.plan, S.line, dp.idx)) : 0;
          if (showInset && (Math.abs(dDeg) >= 150 ||
              Math.abs(reversalDeltaDeg(S.plan, S.line, dp.idx)) >= 150)) showInset = false;
          /* v280: the lane gate — no lane data for this
             maneuver, no card (the banner already says the
             turn; an instruction-only card is the duplicate
             the owner banned). laneData/laneHtml are computed
             here so the gate and the paint read one value. */
          var laneData = null, laneHtml = '';
          if (showInset) {
            laneData = (S.serverLanes && S.serverLanes[dp.idx]) ||
              (S.laneByTurn ? S.laneByTurn[dp.idx] : null);
            laneHtml = laneGuidanceHtml(laneData, dDeg);
            showInset = showInset && !!laneHtml;
          }
          /* v280: the not-showing key is distinct ('x'+idx) —
             the lane fetchers clear insetKey when data lands,
             and that clear must differ from the not-showing
             state or the strip would wait for the next 50 m
             bucket to appear. */
          var insetKey = showInset ? (dp.idx + ':' + Math.round(dp.toTurnM / 50)) : ('x' + dp.idx);
          if (S.drive.insetKey !== insetKey) {
            S.drive.insetKey = insetKey;
            insetEl.classList.toggle('hidden', !showInset);
            if (showInset) {
              /* v264 (NAV-LANE-INSET-EMPTY): the lane strip's
                 first source is now the route server's own lane
                 answer for this route (S.serverLanes, with its
                 valid flags); the Overpass cache stays the
                 fallback for turns the server answer didn't
                 cover. And under the header, the maneuver's
                 SIGN block (exit number / road taken / where it
                 points — maneuverSign rode the plan since this
                 version) so the card carries usable information
                 even where no lane data exists anywhere. */
              /* v280 (NAV-LANE-CARD-NO-USEFUL-INFO +
                 NAV-DEMO-DUP-INSTRUCTION, owner Oct 28-29,
                 2026): this card is the LANE inset — it exists
                 ONLY for lane directions. The v264 paint stacked
                 a junction drawing, the lane strip, a header
                 REPEATING the banner's turn instruction, and a
                 sign block: four things, the lanes buried in
                 them, and his verdict was "no useful lane
                 information". The paint is now the lane strip
                 and nothing else, and the card shows only when
                 lane guidance actually exists for this maneuver
                 (laneHtml non-empty — see the showInset gate
                 below, which reads the same laneHtml). The turn
                 itself is the big banner's job, said once. */
              insetEl.innerHTML = laneHtml;
              /* v277 (NAV-SCREEN-STILL-CUTTING): dock the card
                 AWAY from the bend it describes — a right bend
                 (positive delta) rides the LEFT edge, so the
                 card never covers the ramp it announces; left
                 bends and straight maneuvers keep the owner's
                 top-right dock. */
              insetEl.classList.toggle('nv-inset-left', dDeg >= 12);
            } else {
              insetEl.classList.remove('nv-inset-left');
            }
          }
          /* v277 (NAV-SCREEN-STILL-CUTTING): the distance line
             must never lag the banner. The rebuild above is
             keyed on a 50 m bucket (the junction art does not
             change faster), which left the inset's <b> frozen
             at the bucket's entry value while the banner ticked
             on its 10 m cadence — his Oct 28 frame: banner
             380 m, inset 420 m. Refresh just the <b> text on
             the banner's own write-on-change cadence; the SVG
             and lanes still rebuild only on the coarse key. */
          if (showInset) {
            var insetDistEl = insetEl.querySelector('.nv-inset-text b');
            if (insetDistEl) {
              var insetDistTxt = fmtDist(dp.toTurnM);
              if (insetDistEl.textContent !== insetDistTxt) insetDistEl.textContent = insetDistTxt;
            }
          }
        }
        /* v220 (PIP-REDESIGN): the PiP face's bottom line — the
           next direction in small words, kept current by the same
           tick that paints the big banner (write-on-change). */
        var pipLineEl = body.querySelector('#nvd_pip_line') || docEl('nvd_pip_line');
        if (pipLineEl && S._inPip) {
          var pipTxt = dp.next ? (fmtDist(dp.toTurnM) + ' · ' + (dp.next.instruction || '')) : 'Arrived';
          if (pipLineEl.textContent !== pipTxt) pipLineEl.textContent = pipTxt;
        }
        /* v227: while the drive is DOCKED, the floating piece is
           the tracker face — its small-words bottom line is this
           same next direction, fed through the face's own line
           field (paintBubble renders App._pipLine). */
        if (S.parked) {
          var dockTxt = dp.next ? (fmtDist(dp.toTurnM) + ' · ' + (dp.next.instruction || '')) : 'Arrived';
          try { if (window.App) App._pipLine = dockTxt; } catch (e) {}
        }
        /* v262 (NAV-LIVE-TRAFFIC-CITYFEED): keep the incident
           list fresh on the drive's own cadence — fetchTraffic
           self-gates to one attempt per 2 minutes, checked
           here on the fix stream (no extra timer). The
           on-route set for THIS fix is computed once and
           shared by the spoken warning and the chip below. */
        if (S.settings.trafficOn) fetchTraffic(false);
        pollTrafficEta(false); /* v280: licensed-provider traffic poll (no-op while unconfigured) */
        if (!S.trafficSaid) S.trafficSaid = {};
        /* v266 (NAV-MAP-BLANK): guarded like the lane warm-up
           above — the traffic overlay is a display aid riding
           the paint path, never a reason for the tick (and
           with it the plane paint) to die. A bad incident row
           costs the chip for one tick, never the map. */
        var trafficHits = [];
        if (S.settings.trafficOn && S.trafficList && S.trafficList.length) {
          try { trafficHits = trafficOnRoute(S.line, pr.along, S.trafficList, TRAFFIC_OFF_M, TRAFFIC_AHEAD_M); } catch (e) { trafficHits = []; }
        }

        var say = drivePrompt(S.plan, dp.idx, dp.toTurnM, S.drive.said);
        if (say) speak(say);
        /* v179 (F5): grade warnings — 500 m before a sustained
           ≥4% slope the guidance says so once, with the grade
           the elevation data supports ("Steep climb ahead,
           6 percent grade" / "Downhill ahead, 5 percent
           grade"). Only when no turn prompt spoke on this very
           fix — speak() cancels, and a turn always outranks a
           hill. */
        var gradeSpoke = false;
        if (!say && S.settings.gradeAlerts && S.gradeEvents && S.gradeEvents.length) {
          for (var gi = 0; gi < S.gradeEvents.length; gi++) {
            var ev = S.gradeEvents[gi];
            if (S.gradeSaid['g' + gi]) continue;
            if (pr.along >= ev.atM - 500 && pr.along < ev.atM) {
              S.gradeSaid['g' + gi] = 1;
              gradeSpoke = true;
              var pct = Math.abs(Math.round(ev.gradePct));
              speak(ev.gradePct > 0
                ? 'Steep climb ahead — ' + pct + ' percent grade.'
                : 'Downhill ahead — ' + pct + ' percent grade. Watch your speed and brakes.');
              break;
            }
          }
        }
        /* v262 (NAV-LIVE-TRAFFIC-CITYFEED): traffic ahead —
           spoken ONCE per incident per route (S.trafficSaid,
           re-armed by finalizeRoute) when it first comes
           within 3 km on the route ahead, and only on a fix
           where nothing higher-priority spoke: a turn outranks
           a hill, a hill outranks traffic — speak() cancels
           the channel, so the order IS the guarantee. The chip
           keeps the warning on screen for the whole approach,
           said or not. Display + voice only — the route is
           never altered by traffic in this build. */
        if (!say && !gradeSpoke && trafficHits.length) {
          for (var ti = 0; ti < trafficHits.length; ti++) {
            var hit = trafficHits[ti];
            if (S.trafficSaid[hit.inc.id]) continue;
            S.trafficSaid[hit.inc.id] = 1;
            speak('Traffic ahead — ' + (hit.inc.desc || 'Incident reported.') +
              (hit.inc.info ? ' ' + hit.inc.info + '.' : '') +
              ' In ' + fmtDist(hit.aheadM) + '.');
            break;
          }
        }
        var tEl = body.querySelector('#nvd_traffic');
        if (tEl) {
          var tShow = trafficHits.length > 0;
          if (S.drive.trafficShown !== tShow) {
            S.drive.trafficShown = tShow;
            tEl.classList.toggle('hidden', !tShow);
          }
          if (tShow) driveText(tEl, 'traffic', '⚠ Traffic ahead · ' + fmtDist(trafficHits[0].aheadM) +
            (trafficHits[0].inc.desc ? ' — ' + trafficHits[0].inc.desc : ''));
        }
        /* v280 (NAV-TRAFFIC-LIVE-ETA): the FASTER-ROUTE OFFER.
           It appears only when BOTH are true on this tick: a
           refreshed incident sits on the route ahead (the live
           feed's own word), and the live ETA has stretched at
           least 4 minutes past the plan's snapshot ETA (the
           truck's own measured pace — congestion made visible).
           One offer per incident; its tap re-plans through the
           ordinary doRoute (truck-legal costing) and
           finalizeRoute speaks the verdict against the ETA the
           driver was shown. A transient pill in the existing
           stack — never a card over the road (C6 law). */
        var oEl = body.querySelector('#nvd_offer');
        if (oEl) {
          var hit0 = trafficHits.length ? trafficHits[0] : null;
          if (!hit0) S.offerFor = '';
          var showOffer = !!(hit0 && (liveEtaMin - dp.etaMin) >= 4 && S.offerFor !== hit0.inc.id);
          if (showOffer) S.offerHitId = hit0.inc.id;
          if (S.drive.offerShown !== showOffer) {
            S.drive.offerShown = showOffer;
            oEl.classList.toggle('hidden', !showOffer);
          }
          if (showOffer) driveText(oEl, 'offer', '🚦 Traffic slowing you · tap to re-check route');
        }

        maybeFetchSpeedLimit();
        if (S.driveMap) {
          try {
            /* v128: MUTATE, never rebuild — the recenter is a
               deadbanded instant panTo, never the per-tick
               setView this replaces. The old line restarted
               Leaflet's animated pan on EVERY GPS fix (~1 Hz):
               each restart re-projects the SVG overlay (route
               line + puck) inside the 340% 3D-transformed plane,
               and frames caught mid-repaint are exactly the
               owner's Oct 17 10:25 recording — line, puck dot
               and bar text gone for a frame, the banner clipped.
               panTo with animate:false moves the layers that
               already exist, once, in place; the 3 m deadband
               means standstill jitter recenters nothing at all.
               The marker and the line below likewise only ever
               mutate (setLatLng / setLatLngs) — nothing is added
               to or removed from the drive map per tick. */
            var ctr = S.driveMap.getCenter ? S.driveMap.getCenter() : null;
            /* v183: free-look stands the follow camera down —
               the marker still tracks the truck, the view stays
               where the driver put it.
               v260: the deadband and the pan both aim at the
               follow TARGET (followTarget) — the ahead point
               the cutoff compensation centres on. Comparing
               against the raw truck point here would re-fire
               the pan on every tick and park the camera on the
               truck, undoing the compensation. */
            var ft = followTarget() || S.pos;
            if (!S.driveFree && (!ctr || haversineM(ft, [ctr.lat, ctr.lng]) > 3)) {
              S.driveMap.panTo(ft, { animate: false });
            }
            if (S.driveMarker) S.driveMarker.setLatLng(S.pos);
          } catch (e) {}
        }
        /* v125: retract the route line as travelled (owner spec)
           — casing + core are redrawn from the truck's projected
           position forward, so only the road AHEAD stays drawn.
           Redraws at most every ~10 m of progress or on a segment
           change, not on every fix. */
        if (S.driveMap && S.driveLine && S.line) {
          try {
            var rem = routeRemainder(S.line, S.pos);
            if (rem && (S.drive.remSeg !== rem.seg || Math.abs(rem.along - (S.drive.remAlong || 0)) >= 10)) {
              S.drive.remSeg = rem.seg; S.drive.remAlong = rem.along;
              var layers = S.driveLine.getLayers();
              for (var li = 0; li < layers.length; li++) layers[li].setLatLngs(rem.points);
              /* v178 (F2): lay the chevrons along the road ahead —
                 one every ~120 m of remainder, pointing along
                 their segment's bearing; unused pool markers fade
                 out. Mutations only, on this redraw's cadence. */
              if (S.drive.arrows && rem.points.length > 1) {
                var placed = 0, acc = 0;
                for (var pi = 0; pi + 1 < rem.points.length && placed < S.drive.arrows.length; pi++) {
                  var segLen = haversineM(rem.points[pi], rem.points[pi + 1]);
                  if (acc + segLen >= 120) {
                    var mk2 = S.drive.arrows[placed++];
                    mk2.setLatLng(rem.points[pi + 1]);
                    mk2.setIcon(arrowIcon(bearingDeg(rem.points[pi], rem.points[pi + 1])));
                    mk2.setOpacity(1);
                    acc = 0;
                  } else acc += segLen;
                }
                for (var pj = placed; pj < S.drive.arrows.length; pj++) S.drive.arrows[pj].setOpacity(0);
              }
            }
          } catch (e) {}
        }
        /* Heading-up: the plane rotates by −heading around the
           driver anchor (its own centre). Stationary fixes carry
           no heading and S.heading keeps the last real one.
           v128: a ≥2° deadband gates the write — GPS heading at
           speed jitters degree-by-degree, and every transform
           assignment re-projects the plane (constant re-raster =
           torn frames). A real turn clears 2° in a single fix;
           jitter never reaches it.
           v139: the write is the plane's ONE composed transform
           (planeTransform) — the v135 tree wrote a bare rotate()
           on a nested spin layer inside a static tilt inside a
           perspective parent, three 3D contexts deep. And where
           v135 wrote nothing until a heading existed (a flat,
           untilted map at drive open), the plane is now painted
           from the first tick: with no heading yet it composes
           at the last applied heading, or north-up — a nav view
           from the first frame, never a flat map. */
        var plane = body.querySelector('#nvd_plane') || docEl('nvd_plane');
        if (plane && (S.drive.headingApplied === null || S.drive.headingApplied === undefined ||
            (S.heading !== null && S.heading !== undefined &&
             angDeltaDeg(S.heading, S.drive.headingApplied) >= 2))) {
          var hdg = (S.heading !== null && S.heading !== undefined)
            ? S.heading : (S.drive.headingApplied || 0);
          S.drive.headingApplied = hdg;
          paintPlane(hdg);
        }
        driveAnimKick();
        return say;
      }

      /* v178 (A2): THE PLANE'S ONE WRITER + THE SMOOTHING LOOP.
         paintPlane holds the single .style.transform assignment
         in this module (the v139 pin) — the tick's gated write
         and the animator both come through here, so the layer
         contract is unchanged: one element, one writer.
         driveAnim is the fluency the owner asked for (Oct 19:
         the map "steps/jumps like an early-2000s GPS"): between
         GPS fixes (~1 Hz) a requestAnimationFrame loop eases the
         applied heading toward the real heading along the
         shortest arc (never a 350° sweep the long way round) and
         eases the map centre toward the latest fix, so rotation
         and travel flow instead of stepping fix-to-fix. It writes
         only while something is actually moving (a settled view
         costs no frames), it is bounded per frame (heading step
         ≤3°, centre closes at most half the gap), and it dies
         with the drive (exitDrive cancels it; every frame
         re-checks S.drive). Where rAF does not exist (test
         harnesses, old WebViews) Drive behaves exactly as before. */
      function paintPlane(hdg) {
        /* v222: while the drive is parked in the shell dock the
           screen is outside this body — fall back to the document
           lookup so the mini map keeps rotating with the truck. */
        var plane = body.querySelector('#nvd_plane') || docEl('nvd_plane');
        if (plane) {
          /* v260 (NAV-TOP-CUTOFF): the transform's translate
             compensation is sized from the LIVE viewport (the
             plane's parent) every paint, so rotation/resizing
             re-derives it and no stale lift can outlive the
             drive screen that set it.
             v273 (NAV-TOP-CUTOFF-STILL): the SIZE of the lift
             is no longer the v260 flat 0.49 of height — that
             fraction was tuned at 768x1024 and runs out on
             the owner's real 411x960 cover screen (and in the
             corners even at 768x1024). coverageLiftPx
             (NAVPURE) derives the smallest lift whose
             homography covers the top at every heading for
             THIS viewport's actual width and height. */
          var vpEl = plane.parentElement;
          /* The lift belongs to the pure follow posture only:
             while a two-finger rotate/tilt owns the view (or
             its adjustment is still in play) the gesture pivot
             contract (v215 — gestures act about the truck,
             camera on the truck) rules, and the translate
             suspends; snap-back zeroes the adjustments and
             the lift returns with the chase view. */
          var gestPivot = S._gestLock === 'rotate' || S._gestLock === 'tilt' ||
            !!(S.viewRot || (S.viewPitch !== null && S.viewPitch !== undefined));
          S.driveLiftPx = (vpEl && vpEl.clientHeight && !gestPivot) ? coverageLiftPx(vpEl.clientWidth, vpEl.clientHeight) : 0;
          plane.style.transform = planeTransform(hdg);
        }
      }
      /* v260 (NAV-TOP-CUTOFF): the follow camera's target. The
         planeTransform translate slides the whole projection
         up by the lift, which would carry the truck marker the
         same distance up off its anchor — so the camera centres
         not on the truck but on the point AHEAD of it whose
         ground, after the lift, lands the truck exactly on the
         anchor: ahead by lift/cos(pitch) projected pixels along
         the applied heading (the rotateX foreshortening undone).
         Flat 2D (no translate) and no-lift cases centre on the
         truck exactly as before. Every follow writer — the tick
         pan, the animator, the gesture snap-back — aims here,
         so the deadbands compare against the same point the
         camera is steered to. */
      function followTarget() {
        if (!S || !S.pos) return null;
        if (!S.driveMap || !S.driveLiftPx || getNavViewMode() === '2d') return S.pos;
        var pitch = (S.viewPitch !== null && S.viewPitch !== undefined) ? S.viewPitch : 50;
        var s = S.driveLiftPx / Math.max(0.2, Math.cos(pitch * Math.PI / 180));
        var hdg = (S.drive && S.drive.headingApplied !== null && S.drive.headingApplied !== undefined)
          ? S.drive.headingApplied : (S.heading || 0);
        var rad = hdg * Math.PI / 180;
        var z = S.driveMap.getZoom ? S.driveMap.getZoom() : 18;
        var p = S.driveMap.project(S.pos, z);
        p.x += Math.sin(rad) * s; p.y -= Math.cos(rad) * s;
        var ll = S.driveMap.unproject(p, z);
        return [ll.lat, ll.lng];
      }
      function driveAnim() {
        if (!S || !S.drive) return;
        S.drive.animId = null;
        var moving = false;
        try {
          if (S.heading !== null && S.heading !== undefined &&
              S.drive.headingApplied !== null && S.drive.headingApplied !== undefined) {
            var dh = ((S.heading - S.drive.headingApplied + 540) % 360) - 180;
            if (Math.abs(dh) > 0.3) {
              var step = Math.max(-3, Math.min(3, dh * 0.22));
              S.drive.headingApplied = (S.drive.headingApplied + step + 360) % 360;
              paintPlane(S.drive.headingApplied);
              moving = true;
            }
          }
          if (S.driveMap && S.pos && S.driveMap.getCenter && !S.driveFree) {
            var ctr = S.driveMap.getCenter();
            /* v260: the animator eases toward the follow
               TARGET (followTarget), not the raw truck point —
               with the cutoff compensation in the transform,
               centring on the truck itself would walk the
               marker up off its anchor between ticks. */
            var tgt = followTarget() || S.pos;
            if (ctr) {
              var gap = haversineM([ctr.lat, ctr.lng], tgt);
              if (gap > 0.5) {
                var f = gap > 8 ? 0.5 : 0.3;
                S.driveMap.panTo([ctr.lat + (tgt[0] - ctr.lat) * f,
                                  ctr.lng + (tgt[1] - ctr.lng) * f], { animate: false });
                moving = true;
              }
            }
          }
        } catch (e) {}
        if (moving && typeof requestAnimationFrame === 'function') {
          S.drive.animId = requestAnimationFrame(driveAnim);
        }
      }
      function driveAnimKick() {
        if (!S || !S.drive) return;
        if (S.drive.animId !== null && S.drive.animId !== undefined) return;
        if (typeof requestAnimationFrame !== 'function') return;
        S.drive.animId = requestAnimationFrame(driveAnim);
      }

      /* Arrival owns the drive screen briefly, then drive mode
         ends itself back to the Navigator (the route stays up on
         the planning screen until the driver ends it). */
      function driveArrived() {
        if (!S.drive) return;
        /* v133: arrival paints through the same cached writer —
           these are real changes, written once; the distance
           clearing is the arrival state's own deliberate paint
           (driveText, not the keep-last guard). */
        var instEl = body.querySelector('#nvd_inst'); driveText(instEl, 'inst', 'You have arrived');
        var distEl = body.querySelector('#nvd_dist'); driveText(distEl, 'dist', '');
        var roadEl = body.querySelector('#nvd_road'); driveText(roadEl, 'road', S.destLabel || '');
        var etaMain = body.querySelector('#nvd_eta_main'); driveText(etaMain, 'etaMain', 'Arrived');
        var etaSub = body.querySelector('#nvd_eta_sub'); driveText(etaSub, 'etaSub', S.destLabel || '');
        var rrEl = body.querySelector('#nvd_reroute'); if (rrEl) rrEl.classList.add('hidden');
        if (S.driveTimer) { try { clearTimeout(S.driveTimer); } catch (e) {} }
        S.driveTimer = setTimeout(function () { exitDrive(); }, 3000);
      }

      /* ---------- controls ---------- */
      var backBtn = body.querySelector('#nv_back');
      if (backBtn) backBtn.onclick = function () {
        /* v116: while driving, the Navigator's own Back exits
           Drive first — the same rule as the shell back. */
        try { if (window.App && App.moduleBack && App.moduleBack()) return; } catch (e) {}
        try { if (window.App && App.showDashboard) App.showDashboard(); } catch (e) {}
      };
      body.querySelector('#nv_route').onclick = doRoute;
      var driveBtn = body.querySelector('#nv_drive');
      if (driveBtn) driveBtn.onclick = startDrive;
      var dExit = body.querySelector('#nvd_exit');
      if (dExit) dExit.onclick = function () { exitDrive(); };
      var dRecenter = body.querySelector('#nvd_recenter');
      if (dRecenter) dRecenter.onclick = function () { setDriveFree(false); };
      /* v280 (NAV-TRAFFIC-LIVE-ETA): the offer's tap — remember
         the incident (no second offer for it) and the live ETA
         on screen, hide the pill, and re-plan through the one
         routing door. finalizeRoute delivers the verdict. */
      var offerBtn = body.querySelector('#nvd_offer');
      if (offerBtn) offerBtn.onclick = function () {
        S.offerFor = S.offerHitId || 'tapped';
        S.offerEta = S.liveEtaMin || 0;
        offerBtn.classList.add('hidden');
        if (S.drive) S.drive.offerShown = false;
        speak('Re-checking for a faster route.');
        doRoute();
      };

      /* v240 (NAV-LAYERS-BUTTON): the layers control's wiring.
         Standard / Satellite / Elevation switch the base
         stack through paintDriveLayers and persist in the
         navigator settings; the panel closes on a switch.
         Traffic is wired to WORDS ONLY — its tap paints the
         plain not-live-yet note in the panel and touches
         nothing on the map (see the markup note). */
      var layersBtn = body.querySelector('#nvd_layers');
      var layersPanel = body.querySelector('#nvd_layers_panel');
      var layersNote = body.querySelector('#nvd_layers_note');
      function paintLayerOpts() {
        /* v262: the three base choices light by driveLayer;
           Traffic's lamp is its own overlay switch. */
        ['standard', 'satellite', 'elevation'].forEach(function (k) {
          var b = body.querySelector('#nvd_layer_' + k);
          if (b) b.classList.toggle('on', S.settings.driveLayer === k);
        });
        var tb = body.querySelector('#nvd_layer_traffic');
        if (tb) tb.classList.toggle('on', !!S.settings.trafficOn);
      }
      /* v280 (NAV-DEMO-FLOATING-CONTROLS-OVER-MAP): the layers
         button no longer FLOATS over the map's right side — it
         moves INTO the drive bar (before End drive), a bar
         button like mute/gear. Its panel still floats above
         the bar, as before. Guarded: a partial DOM without the
         bar keeps the old docked button. */
      try {
        var driveBar = body.querySelector('.nv-drive-bar');
        if (driveBar && layersBtn && typeof driveBar.insertBefore === 'function') {
          driveBar.insertBefore(layersBtn, body.querySelector('#nvd_exit') || null);
          layersBtn.classList.add('inbar');
        }
      } catch (e) {}
      if (layersBtn) layersBtn.onclick = function () {
        if (layersPanel) { layersPanel.classList.toggle('hidden'); paintLayerOpts(); }
      };
      ['standard', 'satellite', 'elevation'].forEach(function (k) {
        var b = body.querySelector('#nvd_layer_' + k);
        if (b) b.onclick = function () {
          if (S.settings.driveLayer !== k) {
            S.settings.driveLayer = k;
            saveSettings({ driveLayer: k });
            paintDriveLayers();
          }
          if (layersNote) layersNote.classList.add('hidden');
          paintLayerOpts();
          if (layersPanel) layersPanel.classList.add('hidden');
        };
      });
      /* v262 (NAV-LIVE-TRAFFIC-CITYFEED): the Traffic entry is
         now the live overlay's switch — it flips the persisted
         trafficOn setting, repaints the lamps, and shows or
         clears the incident markers on both maps. It never
         touches the base-layer choice, and the panel stays
         open (it is a toggle, not a layer pick). */
      var trafficOpt = body.querySelector('#nvd_layer_traffic');
      if (trafficOpt) trafficOpt.onclick = function () {
        var on = !(S.settings && S.settings.trafficOn);
        saveSettings({ trafficOn: on });
        paintLayerOpts();
        if (layersNote) {
          layersNote.textContent = on
            ? 'Traffic on \u2014 live incidents from the City of Calgary, marked on the map.'
            : 'Traffic off.';
          layersNote.classList.remove('hidden');
        }
        applyTrafficVisibility();
      };

      /* v262: the module's first pull of the incident list —
         markers land on the planning map as soon as it answers. */
      fetchTraffic(true);

      /* v135: the avatar tap — opens/closes the chooser; a choice
         applies AT THE TAP (glyph swapped, 'on' marker moved) and
         persists through the same settings store as mode/muted.
         Nothing here runs per tick: the drive tick never touches
         #nvd_you, so the v133 guarantees stand. */
      var youEl = body.querySelector('#nvd_you');
      var avPicker = body.querySelector('#nvd_avatar_picker');
      function paintYou() {
        if (youEl) {
          youEl.innerHTML = avatarGlyph(S.settings.avatar, 'm');
          /* v139: the marker's box + anchor-centring margins
             follow the chosen kind (AVATAR_BOX) — set as plain
             styles on the tap, never per tick, never a
             transform. */
          var b = AVATAR_BOX[S.settings.avatar] || AVATAR_BOX.dump;
          youEl.style.width = b[0] + 'px';
          youEl.style.height = b[1] + 'px';
          youEl.style.marginLeft = (-b[0] / 2) + 'px';
          youEl.style.marginTop = (-b[1] / 2) + 'px';
        }
        if (avPicker) avPicker.querySelectorAll('[data-avatar]').forEach(function (b2) {
          b2.classList.toggle('on', b2.getAttribute('data-avatar') === S.settings.avatar);
        });
      }
      if (youEl) youEl.onclick = function () { if (avPicker) avPicker.classList.toggle('hidden'); };
      if (avPicker) avPicker.querySelectorAll('[data-avatar]').forEach(function (b) {
        b.onclick = function () {
          var k = b.getAttribute('data-avatar');
          if (k && AVATAR_KINDS.indexOf(k) >= 0 && k !== S.settings.avatar) {
            S.settings.avatar = k;
            saveSettings({ avatar: k });
            paintYou();
          }
          avPicker.classList.add('hidden');
        };
      });

      /* v103: the v93 turn-by-turn handoff handler is DELETED
         with the rest of the handoff — there is no button, no
         link chain, no leaving the app. Turn-by-turn is the
         in-app Drive screen (nv_drive → startDrive). */
      var endBtn = body.querySelector('#nv_end');
      if (endBtn) endBtn.onclick = function () { clearRoute(); banner('Where to?', 'Search for a place, or tap the map to drop a pin.'); };
      var followBtn = body.querySelector('#nv_follow');
      if (followBtn) followBtn.onclick = function () {
        S.follow = !S.follow; paintFollow();
        if (S.follow && S.pos && S.map) S.map.setView(S.pos, S.map.getZoom());
      };
      /* v139 (owner, Oct 17 12:42 MDT): the drive bar's sound
         control is a MUTE BUTTON, not a "Sound: on/off" text
         toggle — a speaker glyph; muted adds the × and a bold
         orange slash, and the button takes the .muted tint (see
         style.css), so the state reads at a glance. Voice
         guidance speaks unless the driver mutes it; the state is
         the same settings.muted as ever — it persisted across
         drives before and persists now; only the control's form
         changed. The planning card keeps its text toggle (a
         settings row, read parked) on the same setting. */
      function muteIcon(muted) {
        var spk = '<path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" stroke="none"/>';
        if (muted) {
          return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + spk +
            '<line x1="16" y1="9.5" x2="20.5" y2="14.5"/><line x1="20.5" y1="9.5" x2="16" y2="14.5"/>' +
            '<line x1="4" y1="4" x2="20" y2="20" stroke="#f26522" stroke-width="2.4"/></svg>';
        }
        return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + spk +
          '<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.2 6a8.8 8.8 0 0 1 0 12"/></svg>';
      }
      /* v101: ONE sound toggle, two faces (planning card + drive
         bar) — same settings.muted, same speak() gate. */
      function paintMute() {
        var label = S.settings.muted ? '🔇 Sound: off' : '🔊 Sound: on';
        /* v133: the planning label is chrome text too — through
           the cached writer like everything else on the face. */
        driveText(body.querySelector('#nv_mute'), 'mutePlan', label);
        /* v139: the DRIVE face is the icon button — innerHTML by
           design (it is markup, not text), written only when the
           painted state actually changes (S.mutePainted), the
           same write-on-change discipline as driveText. It is
           never called per tick: paintMute runs at startDrive
           and on the toggle itself. */
        var dBtn = body.querySelector('#nvd_mute');
        if (dBtn && S.mutePainted !== S.settings.muted) {
          S.mutePainted = S.settings.muted;
          dBtn.innerHTML = muteIcon(S.settings.muted);
          dBtn.classList.toggle('muted', S.settings.muted);
          dBtn.setAttribute('aria-pressed', S.settings.muted ? 'true' : 'false');
          dBtn.setAttribute('aria-label', S.settings.muted ? 'Unmute voice guidance' : 'Mute voice guidance');
          dBtn.setAttribute('title', S.settings.muted ? 'Unmute voice guidance' : 'Mute voice guidance');
        }
      }
      function toggleMute() {
        S.settings.muted = !S.settings.muted;
        saveSettings({ muted: S.settings.muted });
        paintMute();
        if (S.settings.muted) {
          try { speechSynthesis.cancel(); } catch (e) {}
          /* v280 (N-voice mute audit): muting used to cancel
             only the WebView synth — a line the NATIVE engine
             was already saying kept talking after the mute tap.
             Mute now stops both engines. */
          try { if (window.ShiftTrack && ShiftTrack.stopNativeSpeak) ShiftTrack.stopNativeSpeak(); } catch (e) {}
        }
        /* v183: unmuting SPEAKS — the driver hears the voice is
           back in the same tap, instead of trusting a label. */
        else speak('Voice guidance on.');
      }
      var muteBtn = body.querySelector('#nv_mute');
      if (muteBtn) muteBtn.onclick = toggleMute;
      var dMute = body.querySelector('#nvd_mute');
      if (dMute) dMute.onclick = toggleMute;
      /* ---------- v177 (F4): THE NAVIGATOR SETTINGS MENU ----------
         One menu, two doors: the ⚙️ here (plan face + drive face)
         and the door in Preferences (which sets nav_open_settings
         and lands on this face — render consumes it below). The
         menu edits the ONE settings object (loadSettings /
         saveSettings over the 'navigator' store); truck dimensions
         LIVE HERE now (moved from Preferences — the same profile
         object routing already reads). Every control applies at
         the change: route preference re-routes an active route,
         view mode repaints the plane on the next tick, overlay
         toggles show/hide at once. */
      function nvSettingsHTML() {
        var st = S.settings, p = st.profile;
        function seg(id, val, opts) {
          return '<div class="row" id="' + id + '" style="gap:6px">' + opts.map(function (o) {
            return '<button class="btn small ' + (val === o[0] ? 'navy' : 'ghost') + '" data-seg="' + o[0] + '" style="flex:1">' + o[1] + '</button>';
          }).join('') + '</div>';
        }
        return '<div class="card" style="margin:10px">' +
          '<div class="row"><h3 style="flex:1;margin:0">⚙️ Navigator settings</h3>' +
          '<button class="btn ghost small" id="nvs_close">✕ Close</button></div>' +
          '<label class="f">Map view</label>' + seg('nvs_view', st.viewMode, [['3d', '🏔️ 3D chase'], ['2d', '🗺️ 2D flat']]) +
          '<label class="f">Route preference</label>' + seg('nvs_route', st.routePref, [['fastest', '⚡ Fastest'], ['economical', '⛽ Most economical']]) +
          '<label class="chk" style="display:block;margin-top:12px"><input type="checkbox" id="nvs_speed"' + (st.showSpeed ? ' checked' : '') + '> Speedometer on screen</label>' +
          '<label class="chk" style="display:block;margin-top:6px"><input type="checkbox" id="nvs_limit"' + (st.showSpeedLimit ? ' checked' : '') + '> Speed limit on screen (read live from map data for the road you are on; roads with no posted limit in the map show none)</label>' +
          '<label class="chk" style="display:block;margin-top:6px"><input type="checkbox" id="nvs_mute"' + (st.muted ? ' checked' : '') + '> Voice guidance muted</label>' +
          '<label class="f">Guidance voice</label>' +
          '<select id="nvs_voice" style="width:100%"></select>' +
          '<p class="note" style="margin-top:4px">The voices your phone offers. Pick one and it becomes the voice that talks you through every turn.</p>' +
          '<button class="btn navy" id="nvs_testvoice" style="margin-top:8px">🔊 Test my voice</button>' +
          '<p class="note" id="nvs_voicenote" style="margin-top:4px">Tap Test my voice — you should hear the guidance speak out loud.</p>' +
          '<label class="chk" style="display:block;margin-top:6px"><input type="checkbox" id="nvs_grades"' + (st.gradeAlerts ? ' checked' : '') + '> Announce hills and steep grades ahead</label>' +
          '<h3 style="margin:16px 0 4px">🚛 Your truck</h3>' +
          '<p class="note" style="margin-top:0">Routes keep you legal for a truck of this size and weight.</p>' +
          '<label class="f">Height (m)</label><input id="nvs_height" type="number" inputmode="decimal" step="0.1" min="0" value="' + esc(p.height) + '">' +
          '<label class="f">Width (m)</label><input id="nvs_width" type="number" inputmode="decimal" step="0.1" min="0" value="' + esc(p.width) + '">' +
          '<label class="f">Length (m)</label><input id="nvs_length" type="number" inputmode="decimal" step="0.1" min="0" value="' + esc(p.length) + '">' +
          '<label class="f">Weight (tonnes)</label><input id="nvs_weight" type="number" inputmode="decimal" step="0.5" min="0" value="' + esc(p.weight) + '">' +
          '<label class="f">Axle load (tonnes)</label><input id="nvs_axleload" type="number" inputmode="decimal" step="0.5" min="0" value="' + esc(p.axleLoad) + '">' +
          '<label class="f">Axles</label><input id="nvs_axles" type="number" inputmode="numeric" step="1" min="1" value="' + esc(p.axles) + '">' +
          '<label class="chk" style="display:block;margin-top:10px"><input type="checkbox" id="nvs_hazmat"' + (p.hazmat ? ' checked' : '') + '> ☣️ I haul hazardous goods (placarded)</label>' +
          '<p class="note" id="nvs_note">Saves as you change it.</p></div>';
      }
      function paintSpeedOverlay() {
        var w = body.querySelector('#nvd_speedwrap');
        if (w) w.style.display = S.settings.showSpeed ? '' : 'none';
        var lim = body.querySelector('#nvd_limit');
        if (lim) {
          var v = (S.settings.showSpeedLimit && S.limitKmh) ? String(S.limitKmh) : '';
          lim.textContent = v;
          lim.classList.toggle('hidden', !v);
        }
      }
      function openNavSettings(inDrive) {
        var panel = body.querySelector('#nv_settings');
        if (!panel) return;
        /* one node, moved to whichever face opened it — the
           drive face paints above the shell, so the panel rides
           into the drive screen when opened from there. */
        var host = inDrive ? body.querySelector('#nv_drive_screen') : body.querySelector('.nv-shell');
        if (host && panel.parentNode !== host) host.appendChild(panel);
        panel.innerHTML = nvSettingsHTML();
        panel.classList.remove('hidden');
        wireNavSettings(panel);
        var c = panel.querySelector('#nvs_close');
        if (c) c.onclick = function () { panel.classList.add('hidden'); };
      }
      function wireNavSettings(panel) {
        function segWire(id, apply) {
          var seg = panel.querySelector('#' + id);
          if (!seg) return;
          seg.querySelectorAll('[data-seg]').forEach(function (b) {
            b.onclick = function () {
              apply(b.getAttribute('data-seg'));
              seg.querySelectorAll('[data-seg]').forEach(function (b2) {
                b2.className = 'btn small ' + (b2.getAttribute('data-seg') === b.getAttribute('data-seg') ? 'navy' : 'ghost');
                b2.style.flex = '1';
              });
            };
          });
        }
        segWire('nvs_view', function (v) {
          S.settings.viewMode = v; setNavViewMode(v);
          saveSettings({ viewMode: v });
          if (S.drive) S.drive.headingApplied = null; /* next tick repaints the plane in the new mode */
        });
        segWire('nvs_route', function (v) {
          S.settings.routePref = v;
          saveSettings({ routePref: v });
          if (S.dest && S.plan) doRoute();
          else if (S.dest && S.settings.serverUrl) { S.autoWanted = true; maybeAutoRoute(); }
        });
        var sp = panel.querySelector('#nvs_speed');
        if (sp) sp.onchange = function () { S.settings.showSpeed = !!sp.checked; saveSettings({ showSpeed: S.settings.showSpeed }); paintSpeedOverlay(); };
        var li = panel.querySelector('#nvs_limit');
        if (li) li.onchange = function () { S.settings.showSpeedLimit = !!li.checked; saveSettings({ showSpeedLimit: S.settings.showSpeedLimit }); paintSpeedOverlay(); };
        var mu = panel.querySelector('#nvs_mute');
        if (mu) mu.onchange = function () { if (mu.checked !== S.settings.muted) toggleMute(); };
        /* v183: the in-hand voice proof — speaks a real guidance
           line at full volume through the same speak() the drive
           uses; if the phone has no speech engine at all, it says
           so in words instead of failing silently. */
        var tv = panel.querySelector('#nvs_testvoice');
        if (tv) tv.onclick = function () {
          var vn = panel.querySelector('#nvs_voicenote');
          if (S.settings.muted) { if (vn) vn.textContent = 'Voice is muted — untick "Voice guidance muted" above, then test again.'; return; }
          S.voiceMissing = false;
          speak('Voice guidance is on. In 300 metres, turn right.');
          setTimeout(function () {
            if (!vn) return;
            vn.textContent = S.voiceMissing
              ? 'This phone is not offering a speech voice to the app — voice guidance needs the native speech engine (parked for the native app update).'
              : 'Played just now. If you heard nothing, check the phone media volume, then test again.';
          }, 350);
        };
        /* v280 (NAV-VOICE-SELECTION-PREF): fill the voice
           picker from the device TTS list itself — the voices
           actually offered on THIS phone, never a hardcoded
           list. getVoices() can answer empty until the engine
           warms up, so a voiceschanged nudge refills it once. */
        var vsel = panel.querySelector('#nvs_voice');
        if (vsel) {
          var fillVoices = function () {
            var vs = [];
            try { vs = (window.speechSynthesis && speechSynthesis.getVoices()) || []; } catch (e) {}
            var cur = S.settings.voiceURI || '';
            var html = '<option value="">Phone default voice</option>';
            vs.forEach(function (v) {
              var uri = String(v.voiceURI || '');
              if (!uri) return;
              html += '<option value="' + esc(uri) + '"' + (uri === cur ? ' selected' : '') + '>' +
                esc(v.name || uri) + (v.lang ? ' (' + esc(v.lang) + ')' : '') + '</option>';
            });
            vsel.innerHTML = html;
            vsel.value = cur;
          };
          fillVoices();
          try { if (window.speechSynthesis && speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', fillVoices); } catch (e) {}
          vsel.onchange = function () {
            S.settings.voiceURI = vsel.value ? String(vsel.value) : '';
            saveSettings({ voiceURI: S.settings.voiceURI });
            var vn2 = panel.querySelector('#nvs_voicenote');
            if (vn2) vn2.textContent = S.settings.voiceURI
              ? 'Voice saved — tap Test my voice to hear it.'
              : 'Phone default voice saved.';
          };
        }
        var gr = panel.querySelector('#nvs_grades');
        if (gr) gr.onchange = function () { S.settings.gradeAlerts = !!gr.checked; saveSettings({ gradeAlerts: S.settings.gradeAlerts }); };
        var profIds = { height: 'nvs_height', width: 'nvs_width', length: 'nvs_length', weight: 'nvs_weight', axleLoad: 'nvs_axleload', axles: 'nvs_axles' };
        function saveProfile() {
          var cur = S.settings.profile, p = {}, k, el;
          for (k in profIds) {
            el = panel.querySelector('#' + profIds[k]);
            if (el && el.value !== '') p[k] = Number(el.value);
            else if (cur[k] !== undefined) p[k] = cur[k];
          }
          var hz = panel.querySelector('#nvs_hazmat');
          p.hazmat = hz ? !!hz.checked : !!cur.hazmat;
          S.settings.profile = navProfile(p);
          saveSettings({ profile: S.settings.profile });
          var n = panel.querySelector('#nvs_note');
          if (n) n.textContent = '✓ Saved — routes now use this truck.';
          if (S.dest && S.plan) doRoute();
        }
        Object.keys(profIds).forEach(function (k) {
          var el = panel.querySelector('#' + profIds[k]);
          if (el) el.onchange = saveProfile;
        });
        var hzEl = panel.querySelector('#nvs_hazmat');
        if (hzEl) hzEl.onchange = saveProfile;
      }
      var gearBtn = body.querySelector('#nv_gear');
      if (gearBtn) gearBtn.onclick = function () { openNavSettings(false); };
      var dGear = body.querySelector('#nvd_gear');
      if (dGear) dGear.onclick = function () { openNavSettings(true); };
      /* the Preferences door: it set nav_open_settings before
         landing here — open the same menu, then clear the flag
         so a later plain entry does not reopen it. */
      try {
        if (App._store.get('nav_open_settings', null)) {
          App._store.set('nav_open_settings', null);
          openNavSettings(false);
        }
      } catch (e) {}
      paintSpeedOverlay();

      /* v103: the mode pair lives in the quiet row — the active
         mode paints navy, never the loud primary orange. */
      function paintMode() {
        var t = body.querySelector('#nv_mode_truck'), c = body.querySelector('#nv_mode_car');
        if (t) t.className = 'btn small ' + (S.settings.mode === 'truck' ? 'navy' : 'ghost');
        if (c) c.className = 'btn small ' + (S.settings.mode === 'car' ? 'navy' : 'ghost');
        if (t) t.style.flex = '1'; if (c) c.style.flex = '1';
      }
      function setMode(m) {
        if (S.settings.mode === m) return;
        S.settings.mode = m;
        saveSettings({ mode: m });
        paintMode();
        if (S.dest && S.plan) doRoute();
        /* v103: a destination armed but not yet routed (its
           auto-route is still waiting on a position) re-arms
           under the new mode instead of waiting for a Route tap. */
        else if (S.dest && S.settings.serverUrl) { S.autoWanted = true; maybeAutoRoute(); }
        else banner('Mode: ' + (m === 'car' ? 'Car' : 'Truck'), 'Pick a destination when ready.');
      }
      var mt = body.querySelector('#nv_mode_truck'), mc = body.querySelector('#nv_mode_car');
      if (mt) mt.onclick = function () { setMode('truck'); };
      if (mc) mc.onclick = function () { setMode('car'); };
    }
  };

  Meticulous.modules.navigator = api;
})();
