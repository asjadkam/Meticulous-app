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
   Routes come from a self-hosted Valhalla service whose map carries the
   City of Calgary truck-route rules (see the truck-nav build, steps 1–4):
   the truck is kept on legal streets by costing, never by hard bans —
   a Restricted street stays reachable when it is the only way in.

   The module is honest about its one dependency: the routing service
   URL lives in Preferences (Navigator card + Advanced > Navigator
   server URL). v98: the app ships with the Meticulous routing server
   as the DEFAULT (NAV_DEFAULT_SERVER_URL below), so a user who has
   never saved an address routes through it out of the box. A saved
   address always wins, and a deliberately cleared one ('' saved on
   purpose) keeps routing off — the module still says so in plain
   words rather than silently falling back to the default.

   Persists via App._store (localStorage, mt_ prefix), key 'navigator':
   { profile: {height,width,length,weight,axleLoad,axles,hazmat},
     serverUrl: <absent until the user sets or clears it>, muted: false,
     mode: 'truck' }.
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
  function buildRouteRequest(origin, dest, profile, mode) {
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
    return req;
  }

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
          lengthKm: len, cumStartKm: cum, cumEndKm: cum + len, type: m.type
        });
        cum += len;
      });
    });
    if (trip.summary) { totalKm = Number(trip.summary.length) || cum; totalMin = (Number(trip.summary.time) || 0) / 60; }
    return { maneuvers: out, totalKm: totalKm, totalMin: totalMin };
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
  /* ================= NAVPURE-END ================= */

  /* ---- shared settings (Preferences reads/writes the same store) ---- */
  /* v98: the routing server the app ships with. It applies ONLY when
     the user has never saved an address (no serverUrl key in the
     store): a saved address always wins, and a deliberately cleared
     '' stays cleared — loadSettings never resurrects the default over
     a saved value. (The nav.meticuloustechnologies.com name replaces
     this IP literal once its DNS lands.) */
  var NAV_DEFAULT_SERVER_URL = 'https://2.31.47.19';

  function loadSettings() {
    var s = {};
    try { s = App._store.get('navigator', {}) || {}; } catch (e) {}
    return {
      profile: navProfile(s.profile),
      serverUrl: (s.serverUrl === undefined || s.serverUrl === null)
        ? NAV_DEFAULT_SERVER_URL : String(s.serverUrl),
      muted: !!s.muted,
      mode: s.mode === 'car' ? 'car' : 'truck'
    };
  }
  function saveSettings(patch) {
    var s = {};
    try { s = App._store.get('navigator', {}) || {}; } catch (e) {}
    for (var k in patch) s[k] = patch[k];
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

  /* v78: the last destination a route was actually built for in
     this app session — the dashboard card's preview fact. It lives
     OUTSIDE S on purpose: teardown nulls S when the module closes,
     but the card should still say where the Navigator last went. */
  var lastNavDest = '';

  function teardown() {
    if (!S) return;
    try { if (S.watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(S.watchId); } catch (e) {}
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}
    try { if (S.map) S.map.remove(); } catch (e) {}
    /* v101: the drive screen's map + arrival timer live on S too,
       so leaving the module mid-drive cleans them up as well. */
    try { if (S.driveTimer) clearTimeout(S.driveTimer); } catch (e) {}
    try { if (S.driveMap) S.driveMap.remove(); } catch (e) {}
    S = null;
  }

  function speak(text) {
    if (!text || !S || S.settings.muted) return;
    try {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  var api = {
    /* v78: the card preview — where the Navigator last routed this
       session; before any route, the server/profile state. A
       cleared server always wins over a stale destination. */
    status: function () {
      var st = loadSettings();
      if (!st.serverUrl) return 'Server not set — routing off';
      if (lastNavDest) return '→ ' + lastNavDest;
      return (st.mode === 'car' ? 'Car' : 'Truck') + ' · ' + st.profile.weight + ' t · Calgary truck routes';
    },

    teardown: teardown,

    render: function (body) {
      teardown();
      var settings = loadSettings();
      S = {
        settings: settings, map: null, userMarker: null, destMarker: null,
        routeLine: null, line: null, plan: null, dest: null, destLabel: '',
        pos: null, follow: true, watchId: null, manIdx: -1,
        offSince: 0, rerouting: false, arrived: false, searching: false,
        /* v103: the auto-route latch — setDest arms it for the NEW
           destination only (autoKey), maybeAutoRoute consumes it
           once a position exists. Ending a route never re-arms
           it: re-routing after End is the driver's own tap. */
        autoKey: '', autoWanted: false,
        /* v101 drive mode: state bag + its own Leaflet instance and
           arrival timer (kept on S so teardown reaches them). */
        drive: null, driveMap: null, driveLine: null, driveMarker: null,
        driveTimer: null, heading: null
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
        '<span class="nv-shell-title">🧭 Navigator</span></div>' +
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
           navigation never leaves the app). */
        '<button class="btn primary big" id="nv_route" style="margin-top:8px">🧭 Route</button>' +
        /* v101: the in-app drive screen. Hidden until a server route
           is ACTIVE (doRoute reveals it and takes the primary slot;
           Route demotes to a quiet re-route). Needs a route by
           construction, so the no-server layout never shows it. */
        '<button class="btn primary big hidden" id="nv_drive" style="margin-top:8px">▶ Drive</button>' +
        '<button class="btn ghost hidden" id="nv_end" style="margin-top:8px">End route</button>' +
        '<p class="note" id="nv_note"></p></div>';

      h += '<div class="card"><h3>🪜 Directions</h3><div id="nv_steps"><div class="empty">No route yet.</div></div></div></div>';

      /* v101 DRIVE SCREEN — a dedicated full-screen mode (fixed
         overlay; rendered hidden with the module so teardown is the
         ordinary innerHTML replacement). The map inside is a SECOND
         Leaflet instance on its own container, created on Drive and
         removed on exit; position comes from this module's ONE
         existing watchPosition stream (see onPos) — drive mode adds
         no GPS consumer of its own. Heading-up + the 3D tilt are
         CSS transforms wrapped around the map (see style.css):
         .nv-drive-tilt pitches the plane, .nv-drive-spin rotates
         it by −heading around the driver anchor (50% / 64%), and
         the map box is oversized so the corners never show. */
      h += '<div id="nv_drive_screen" class="nv-drive hidden">' +
        '<div class="nv-drive-top">' +
        '<div class="nv-drive-dist" id="nvd_dist"></div>' +
        '<div class="nv-drive-inst" id="nvd_inst"></div>' +
        '<div class="nv-drive-road" id="nvd_road"></div></div>' +
        '<div class="nv-drive-viewport">' +
        '<div class="nv-drive-tilt"><div class="nv-drive-spin" id="nvd_spin">' +
        '<div class="nv-drive-mapbox"><div id="nv_drive_map" class="nv-drive-map"></div></div>' +
        '</div></div>' +
        '<div class="nv-drive-you">▲</div>' +
        '<div class="nv-drive-reroute hidden" id="nvd_reroute">Rerouting…</div></div>' +
        '<div class="nv-drive-bar">' +
        '<div class="nv-drive-eta" id="nvd_eta"></div>' +
        '<button class="btn ghost" id="nvd_mute">🔊 Sound: on</button>' +
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
        setTimeout(function () { try { S.map.invalidateSize(); } catch (e) {} }, 250);
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
      function setDest(latlng, label) {
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
        if (key !== S.autoKey) { S.autoKey = key; S.autoWanted = true; }
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
      searchBtn.onclick = function () {
        var q = body.querySelector('#nv_q').value.trim();
        var box = body.querySelector('#nv_results');
        if (!q) { note('Type an address or place name first.'); return; }
        if (S.searching) return;
        S.searching = true; box.innerHTML = '<p class="note">Searching…</p>';
        fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=ca&q=' + encodeURIComponent(q))
          .then(function (r) { return r.json(); })
          .then(function (rows) {
            S.searching = false;
            if (!rows || !rows.length) { box.innerHTML = '<p class="note">No places found for “' + esc(q) + '”.</p>'; return; }
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
            if (p.lat && p.lng) {
              setDest([p.lat, p.lng], p.name);
              if (S.map) S.map.setView(S.dest, 14);
            } else if (p.address) {
              var q = body.querySelector('#nv_q');
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
            setDest(pendCoords, pendName || 'Dropped pin');
            if (S.map) S.map.setView(S.dest, 14);
          } else if (pend.query) {
            var pq = body.querySelector('#nv_q');
            if (pq && searchBtn) { pq.value = pend.query; searchBtn.onclick(); }
          }
        }
      } catch (e) {}

      /* ---------- GPS follow ---------- */
      /* v101: heading rides the SAME single watch — drive mode
         consumes this stream and nothing else. GPS heading is null
         when stationary; the last real heading is kept so the
         drive map never spins while the truck is stopped. */
      function onPos(lat, lon, heading) {
        var first = !S.pos;
        S.pos = [lat, lon];
        if (heading !== null && heading !== undefined && isFinite(heading)) S.heading = heading;
        if (S.map) {
          if (S.userMarker) S.userMarker.setLatLng(S.pos);
          else S.userMarker = L.circleMarker(S.pos, { radius: 8, color: '#1F3764', weight: 2, fillColor: '#3f7de0', fillOpacity: 0.9 }).addTo(S.map);
          if (S.follow) S.map.setView(S.pos, first ? 15 : S.map.getZoom());
        }
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
         then follow the browser watcher (works in every build). */
      try {
        var lastFix = (window.MeticulousGeo && MeticulousGeo.last && MeticulousGeo.last()) ||
          (window.App && App.geo && App.geo.last && App.geo.last());
        if (lastFix && lastFix.latitude) onPos(lastFix.latitude, lastFix.longitude, lastFix.bearing);
      } catch (e) {}
      if (navigator.geolocation) {
        try {
          S.watchId = navigator.geolocation.watchPosition(
            function (p) { onPos(p.coords.latitude, p.coords.longitude, p.coords.heading); },
            function () { if (!S.pos) note('Location is unavailable — allow location for Meticulous to navigate.'); },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
          );
        } catch (e) {}
      } else {
        note('This device has no location service — routing from your position is unavailable.');
      }

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
        var reqBody = buildRouteRequest(S.pos, S.dest, S.settings.profile, S.settings.mode);
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody) })
          .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
          .then(function (data) {
            S.rerouting = false;
            if (!data || !data.trip || !data.trip.legs || !data.trip.legs.length) throw new Error('empty');
            var line = [];
            data.trip.legs.forEach(function (leg) { line = line.concat(decodeShape(leg.shape)); });
            S.line = line;
            S.plan = maneuverPlan(data.trip);
            S.manIdx = 0; S.offSince = 0; S.arrived = false;
            /* v78: remember the destination for the dashboard card
               (search name when there is one, else the pin coords —
               the same words the destination note shows). */
            lastNavDest = S.destLabel || (S.dest ? S.dest[0].toFixed(5) + ', ' + S.dest[1].toFixed(5) : '');
            if (S.map) {
              if (S.routeLine) S.map.removeLayer(S.routeLine);
              S.routeLine = L.polyline(line, { color: S.settings.mode === 'car' ? '#888' : '#e67e00', weight: 5, opacity: 0.9 }).addTo(S.map);
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
               drive screen on the new plan. */
            var db = body.querySelector('#nv_drive'); if (db) db.classList.remove('hidden');
            var rb = body.querySelector('#nv_route'); if (rb) rb.className = 'btn ghost big';
            if (S.drive) driveOnRoute();
            paintStep();
            /* mid-drive, the drive screen's own prompts own the
               speech; the planning screen keeps its first-line
               announcement exactly as before. */
            if (!S.drive) speak(S.plan.maneuvers[0].verbalPre || S.plan.maneuvers[0].instruction);
            note('');
          })
          .catch(function () {
            S.rerouting = false;
            banner('Could not get a route.', 'Check the Navigator server URL in Preferences → Advanced and your connection.');
          });
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
          S.manIdx = idx;
          if (prev && prev.verbalPost) speak(prev.verbalPost);
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
        var dDest = haversineM(S.pos, S.dest);
        if (dDest < 40 || pr.along >= S.plan.totalKm * 1000 - 30) {
          S.arrived = true;
          var last = S.plan.maneuvers[S.plan.maneuvers.length - 1];
          banner('You have arrived', S.destLabel || '');
          speak((last && last.verbalPost) || 'You have arrived.');
          if (S.drive) driveArrived();
        }
      }

      /* ---------- v101 drive screen ---------- */
      function startDrive() {
        if (!S.plan || !S.line) { note('Get a route first — Drive opens on an active route.'); return; }
        if (S.drive) return;
        S.drive = { said: {}, headingApplied: null };
        var scr = body.querySelector('#nv_drive_screen');
        if (scr) scr.classList.remove('hidden');
        if (window.L && body.querySelector('#nv_drive_map')) {
          try {
            S.driveMap = L.map('nv_drive_map', {
              zoomControl: false, attributionControl: false, dragging: false,
              scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false,
              keyboard: false, touchZoom: false
            }).setView(S.pos || S.line[0], 17);
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(S.driveMap);
            S.driveLine = L.polyline(S.line, {
              color: S.settings.mode === 'car' ? '#888' : '#e67e00', weight: 6, opacity: 0.95
            }).addTo(S.driveMap);
            if (S.pos) {
              S.driveMarker = L.circleMarker(S.pos, { radius: 9, color: '#1F3764', weight: 2, fillColor: '#3f7de0', fillOpacity: 0.95 }).addTo(S.driveMap);
            }
            setTimeout(function () { try { if (S && S.driveMap) S.driveMap.invalidateSize(); } catch (e) {} }, 120);
          } catch (e) { S.driveMap = null; }
        }
        paintMute();
        var saidNow = driveTick();
        if (!saidNow) {
          var cur = S.plan.maneuvers[S.manIdx] || S.plan.maneuvers[0];
          if (cur) speak(cur.verbalPre || cur.instruction);
        }
      }

      function exitDrive() {
        if (!S || !S.drive) return;
        S.drive = null;
        if (S.driveTimer) { try { clearTimeout(S.driveTimer); } catch (e) {} S.driveTimer = null; }
        try { if (S.driveMap) S.driveMap.remove(); } catch (e) {}
        S.driveMap = null; S.driveLine = null; S.driveMarker = null;
        var scr = body.querySelector('#nv_drive_screen');
        if (scr) scr.classList.add('hidden');
      }

      /* A re-route landed while driving: fresh plan, fresh prompt
         flags, fresh line on the drive map. */
      function driveOnRoute() {
        if (!S.drive) return;
        S.drive.said = {};
        S.drive.headingApplied = null;
        if (S.driveMap && S.line) {
          try {
            if (S.driveLine) S.driveMap.removeLayer(S.driveLine);
            S.driveLine = L.polyline(S.line, {
              color: S.settings.mode === 'car' ? '#888' : '#e67e00', weight: 6, opacity: 0.95
            }).addTo(S.driveMap);
          } catch (e) {}
        }
        driveTick();
      }

      /* One drive paint per GPS fix, off the module's one watch.
         Returns the text spoken (if any) so startDrive can avoid
         double-announcing. */
      function driveTick() {
        if (!S.drive || !S.plan || !S.line || !S.pos || S.arrived) return null;
        var pr = distToRouteM(S.pos, S.line);
        var dp = driveProgress(S.plan, pr.along);
        var showNext = !!dp.next;
        var distEl = body.querySelector('#nvd_dist');
        if (distEl) distEl.textContent = fmtDist(showNext ? dp.toTurnM : dp.leftM);
        var instEl = body.querySelector('#nvd_inst');
        if (instEl) instEl.textContent = showNext ? dp.next.instruction : (dp.current ? dp.current.instruction : '');
        var roadEl = body.querySelector('#nvd_road');
        if (roadEl) roadEl.textContent = dp.road ? 'On ' + dp.road : '';
        var etaEl = body.querySelector('#nvd_eta');
        if (etaEl) etaEl.textContent = fmtDist(dp.leftM) + ' · ' + fmtMin(dp.etaMin) + ' left' +
          (S.destLabel ? ' · to ' + S.destLabel : '');
        var rrEl = body.querySelector('#nvd_reroute');
        if (rrEl) {
          var showRr = S.rerouting || pr.dist > 60;
          rrEl.classList.toggle('hidden', !showRr);
          rrEl.textContent = S.rerouting ? 'Rerouting…' : 'Off route';
        }
        var say = drivePrompt(S.plan, dp.idx, dp.toTurnM, S.drive.said);
        if (say) speak(say);
        if (S.driveMap) {
          try {
            S.driveMap.setView(S.pos, 17);
            if (S.driveMarker) S.driveMarker.setLatLng(S.pos);
          } catch (e) {}
        }
        /* Heading-up: the spin wrapper rotates by −heading around
           the driver anchor; stationary fixes carry no heading and
           S.heading keeps the last real one. */
        var spin = body.querySelector('#nvd_spin');
        if (spin && S.heading !== null && S.heading !== undefined && S.drive.headingApplied !== S.heading) {
          S.drive.headingApplied = S.heading;
          spin.style.transform = 'rotate(' + (-S.heading) + 'deg)';
        }
        return say;
      }

      /* Arrival owns the drive screen briefly, then drive mode
         ends itself back to the Navigator (the route stays up on
         the planning screen until the driver ends it). */
      function driveArrived() {
        if (!S.drive) return;
        var instEl = body.querySelector('#nvd_inst'); if (instEl) instEl.textContent = 'You have arrived';
        var distEl = body.querySelector('#nvd_dist'); if (distEl) distEl.textContent = '';
        var roadEl = body.querySelector('#nvd_road'); if (roadEl) roadEl.textContent = S.destLabel || '';
        var etaEl = body.querySelector('#nvd_eta'); if (etaEl) etaEl.textContent = 'Trip complete';
        var rrEl = body.querySelector('#nvd_reroute'); if (rrEl) rrEl.classList.add('hidden');
        if (S.driveTimer) { try { clearTimeout(S.driveTimer); } catch (e) {} }
        S.driveTimer = setTimeout(function () { exitDrive(); }, 3000);
      }

      /* ---------- controls ---------- */
      var backBtn = body.querySelector('#nv_back');
      if (backBtn) backBtn.onclick = function () {
        try { if (window.App && App.showDashboard) App.showDashboard(); } catch (e) {}
      };
      body.querySelector('#nv_route').onclick = doRoute;
      var driveBtn = body.querySelector('#nv_drive');
      if (driveBtn) driveBtn.onclick = startDrive;
      var dExit = body.querySelector('#nvd_exit');
      if (dExit) dExit.onclick = function () { exitDrive(); };

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
      /* v101: ONE sound toggle, two faces (planning card + drive
         bar) — same settings.muted, same speak() gate. */
      function paintMute() {
        var label = S.settings.muted ? '🔇 Sound: off' : '🔊 Sound: on';
        var b1 = body.querySelector('#nv_mute'); if (b1) b1.textContent = label;
        var b2 = body.querySelector('#nvd_mute'); if (b2) b2.textContent = label;
      }
      function toggleMute() {
        S.settings.muted = !S.settings.muted;
        saveSettings({ muted: S.settings.muted });
        paintMute();
        if (S.settings.muted) { try { speechSynthesis.cancel(); } catch (e) {} }
      }
      var muteBtn = body.querySelector('#nv_mute');
      if (muteBtn) muteBtn.onclick = toggleMute;
      var dMute = body.querySelector('#nvd_mute');
      if (dMute) dMute.onclick = toggleMute;
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
