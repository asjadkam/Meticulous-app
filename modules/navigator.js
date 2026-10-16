/* Meticulous — Navigator module (v77)
   Turn-by-turn truck navigation on Calgary's designated truck network.
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

  /* v93: the turn-by-turn HANDOFF link set. The phone's own maps
     app does the spoken driving TODAY; Meticulous's own 3D drive
     screen still waits on the routing server (owner, Oct 16,
     2026: turn-by-turn must not wait for the server). Pure: dest
     is [lat, lng]. The chain, first to last resort: the Google
     Maps navigation intent (its browser_fallback_url carries the
     web directions if Maps is absent) → a geo: URI (any maps
     app) → Waze → Google Maps web directions. */
  function ttnLinks(dest, label) {
    if (!dest) return null;
    var lat = Number(dest[0]), lng = Number(dest[1]);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    var q = lat.toFixed(6) + ',' + lng.toFixed(6);
    var name = String(label || '');
    var web = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(q) + '&travelmode=driving';
    var intent = 'intent://navigate?q=' + encodeURIComponent(q) +
      '#Intent;scheme=google.navigation;package=com.google.android.apps.maps;' +
      'S.browser_fallback_url=' + encodeURIComponent(web) + ';end';
    var geo = 'geo:' + q + '?q=' + encodeURIComponent(q + (name ? ' (' + name + ')' : ''));
    var waze = 'https://waze.com/ul?ll=' + q + '&navigate=yes';
    return { intent: intent, geo: geo, waze: waze, web: web };
  }
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
    profile: navProfile,
    ttnLinks: ttnLinks
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
        offSince: 0, rerouting: false, arrived: false, searching: false
      };

      var h = '';
      if (!settings.serverUrl) {
        h += '<div class="card" style="border:2px solid #f5a623;background:#fff8e6">' +
          '<b>Navigator server not set — routing unavailable.</b><br>' +
          '<span style="color:#555">Set the Navigator server URL in Preferences → Advanced. The map and your position still work below.</span></div>';
      }
      h += '<div class="card" style="padding:10px">' +
        '<div id="nv_banner" class="nv-banner"><div class="nv-banner-main">Where to?</div>' +
        '<div class="nv-banner-sub">Search for a place, or tap the map to drop a pin.</div></div>' +
        '<div id="nv_map" class="nv-map"></div>' +
        '<div class="row" style="margin-top:8px">' +
        '<button class="btn small ' + (settings.mode === 'truck' ? 'primary' : 'ghost') + '" id="nv_mode_truck" style="flex:1">🚛 Truck</button>' +
        '<button class="btn small ' + (settings.mode === 'car' ? 'primary' : 'ghost') + '" id="nv_mode_car" style="flex:1">🚗 Car</button>' +
        '<button class="btn small ghost" id="nv_follow" style="flex:1">🎯 Follow: on</button>' +
        '<button class="btn small ghost" id="nv_mute" style="flex:1">' + (settings.muted ? '🔇 Sound: off' : '🔊 Sound: on') + '</button>' +
        '</div></div>';

      /* v84: the built-in pits & job sites (owned by the Navigation
         module, read lazily so load order never matters) — one tap
         sets the destination on the pin itself. Address-only
         built-ins (fuel) are not offered here: they have no pin. */
      var biPlaces = [];
      try {
        if (window.Meticulous && Meticulous.modules.navigation && Meticulous.modules.navigation.builtinPlaces) {
          biPlaces = Meticulous.modules.navigation.builtinPlaces().filter(function (p) { return p.lat && p.lng; });
        }
      } catch (e) { biPlaces = []; }

      h += '<div class="card"><h3>📍 Destination</h3>' +
        '<label class="f">Address or place</label>' +
        '<div class="row"><input id="nv_q" placeholder="e.g. Foothills Industrial Park, Calgary" style="flex:1">' +
        '<button class="btn navy" id="nv_search">Search</button></div>' +
        '<div id="nv_results"></div>' +
        (biPlaces.length ?
          '<label class="f">Your pits & job sites</label>' +
          '<select id="nv_places" style="width:100%"><option value="">Choose a place…</option>' +
          biPlaces.map(function (p, i) {
            return '<option value="' + i + '">' + esc(p.name) + '</option>';
          }).join('') + '</select>' : '') +
        '<p class="note" id="nv_destnote">No destination yet. Search above, tap the map, or pick a saved place in Navigation.</p>' +
        /* v93: ONE primary action per server state. No server:
           the turn-by-turn handoff leads (the in-app Route button
           keeps its exact server-not-set behaviour below it).
           Server set: Route leads and the handoff sits under it
           as the quiet secondary. The handoff button + its honest
           label stay hidden until a destination exists. */
        (settings.serverUrl
          ? '<button class="btn primary big" id="nv_route" style="margin-top:8px">🧭 Route</button>' +
            '<button class="btn ghost hidden" id="nv_ttn" style="margin-top:8px">▶ Turn-by-turn</button>' +
            '<p class="note hidden" id="nv_ttn_note">Opens Google Maps for spoken directions. Meticulous\'s own drive screen is coming.</p>'
          : '<button class="btn primary big hidden" id="nv_ttn" style="margin-top:8px">▶ Turn-by-turn</button>' +
            '<p class="note hidden" id="nv_ttn_note">Opens Google Maps for spoken directions. Meticulous\'s own drive screen is coming.</p>' +
            '<button class="btn primary big" id="nv_route" style="margin-top:8px">🧭 Route</button>') +
        '<button class="btn ghost hidden" id="nv_end" style="margin-top:8px">End route</button>' +
        '<p class="note" id="nv_note"></p></div>';

      h += '<div class="card"><h3>🪜 Directions</h3><div id="nv_steps"><div class="empty">No route yet.</div></div></div>';
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
          setDest([e.latlng.lat, e.latlng.lng], 'Dropped pin');
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
      function setDest(latlng, label) {
        S.dest = latlng; S.destLabel = label || '';
        S.arrived = false;
        if (S.map) {
          if (S.destMarker) S.destMarker.setLatLng(latlng);
          else S.destMarker = L.marker(latlng).addTo(S.map);
        }
        var dn = body.querySelector('#nv_destnote');
        if (dn) dn.textContent = 'Destination: ' + (label || (latlng[0].toFixed(5) + ', ' + latlng[1].toFixed(5))) + ' — tap ' + (S.settings.serverUrl ? 'Route.' : 'Turn-by-turn.');
        var tb = body.querySelector('#nv_ttn'); if (tb) tb.classList.remove('hidden');
        var tn = body.querySelector('#nv_ttn_note'); if (tn) tn.classList.remove('hidden');
        banner('Destination set', S.settings.serverUrl
          ? 'Tap Route to get ' + (S.settings.mode === 'car' ? 'car' : 'truck') + ' directions.'
          : 'Tap Turn-by-turn for spoken directions in your maps app.');
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

      /* v84: built-in place picker — one tap sets the destination */
      var placeSel = body.querySelector('#nv_places');
      if (placeSel) placeSel.onchange = function () {
        if (placeSel.value === '') return;
        var p = biPlaces[Number(placeSel.value)];
        placeSel.value = '';
        if (!p) return;
        setDest([p.lat, p.lng], p.name);
        if (S.map) S.map.setView(S.dest, 14);
      };

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
          if (pend.lat && pend.lng) {
            setDest([Number(pend.lat), Number(pend.lng)], pend.name || '');
            if (S.map) S.map.setView(S.dest, 14);
          } else if (pend.query) {
            var pq = body.querySelector('#nv_q');
            if (pq && searchBtn) { pq.value = pend.query; searchBtn.onclick(); }
          }
        }
      } catch (e) {}

      /* ---------- GPS follow ---------- */
      function onPos(lat, lon) {
        var first = !S.pos;
        S.pos = [lat, lon];
        if (S.map) {
          if (S.userMarker) S.userMarker.setLatLng(S.pos);
          else S.userMarker = L.circleMarker(S.pos, { radius: 8, color: '#1F3764', weight: 2, fillColor: '#3f7de0', fillOpacity: 0.9 }).addTo(S.map);
          if (S.follow) S.map.setView(S.pos, first ? 15 : S.map.getZoom());
        }
        if (first && !S.plan) banner('You are here', 'Search for a place, or tap the map to drop a pin.');
        if (S.plan) trackProgress();
      }
      /* Seed from the native geo wrapper's last fix when present,
         then follow the browser watcher (works in every build). */
      try {
        var lastFix = (window.MeticulousGeo && MeticulousGeo.last && MeticulousGeo.last()) ||
          (window.App && App.geo && App.geo.last && App.geo.last());
        if (lastFix && lastFix.latitude) onPos(lastFix.latitude, lastFix.longitude);
      } catch (e) {}
      if (navigator.geolocation) {
        try {
          S.watchId = navigator.geolocation.watchPosition(
            function (p) { onPos(p.coords.latitude, p.coords.longitude); },
            function () { if (!S.pos) note('Location is unavailable — allow location for Meticulous to navigate.'); },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
          );
        } catch (e) {}
      } else {
        note('This device has no location service — routing from your position is unavailable.');
      }

      /* ---------- routing ---------- */
      function clearRoute() {
        S.plan = null; S.line = null; S.manIdx = -1; S.offSince = 0; S.arrived = false;
        if (S.routeLine && S.map) { S.map.removeLayer(S.routeLine); S.routeLine = null; }
        var st = body.querySelector('#nv_steps'); if (st) st.innerHTML = '<div class="empty">No route yet.</div>';
        var end = body.querySelector('#nv_end'); if (end) end.classList.add('hidden');
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
            paintStep();
            speak(S.plan.maneuvers[0].verbalPre || S.plan.maneuvers[0].instruction);
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
          else { var cur = S.plan.maneuvers[idx]; if (cur) speak(cur.verbalPre || cur.instruction); }
        }
        paintStep();
        var dDest = haversineM(S.pos, S.dest);
        if (dDest < 40 || pr.along >= S.plan.totalKm * 1000 - 30) {
          S.arrived = true;
          var last = S.plan.maneuvers[S.plan.maneuvers.length - 1];
          banner('You have arrived', S.destLabel || '');
          speak((last && last.verbalPost) || 'You have arrived.');
        }
      }

      /* ---------- controls ---------- */
      body.querySelector('#nv_route').onclick = doRoute;

      /* v93: the turn-by-turn handoff. Walks the ttnLinks chain
         with pauses: if a maps app takes over, the page hides and
         the later fallbacks never fire; if we're still here, the
         next resort tries. The destination it uses is the one
         setDest set — the same pin every other door lands on. */
      var ttnBtn = body.querySelector('#nv_ttn');
      if (ttnBtn) ttnBtn.onclick = function () {
        var links = ttnLinks(S.dest, S.destLabel);
        if (!links) { note('Pick a destination first — search above or tap the map.'); return; }
        var left = false;
        var onHide = function () { left = true; };
        try {
          document.addEventListener('visibilitychange', onHide);
          window.addEventListener('pagehide', onHide);
        } catch (e) {}
        function attempt(href, blank) {
          try {
            if (blank) { window.open(href, '_blank'); return; }
            var a = document.createElement('a');
            a.href = href; a.style.display = 'none';
            document.body.appendChild(a); a.click();
            setTimeout(function () { try { a.remove(); } catch (e) {} }, 100);
          } catch (e) {}
        }
        function stillHere() { return !left && !document.hidden; }
        attempt(links.intent, false);
        setTimeout(function () { if (stillHere()) attempt(links.geo, false); }, 900);
        setTimeout(function () { if (stillHere()) attempt(links.waze, true); }, 2000);
        setTimeout(function () { if (stillHere()) attempt(links.web, true); }, 3100);
        setTimeout(function () {
          try {
            document.removeEventListener('visibilitychange', onHide);
            window.removeEventListener('pagehide', onHide);
          } catch (e) {}
        }, 4200);
        note('Opening turn-by-turn in your maps app…');
      };
      var endBtn = body.querySelector('#nv_end');
      if (endBtn) endBtn.onclick = function () { clearRoute(); banner('Where to?', 'Search for a place, or tap the map to drop a pin.'); };
      var followBtn = body.querySelector('#nv_follow');
      if (followBtn) followBtn.onclick = function () {
        S.follow = !S.follow; paintFollow();
        if (S.follow && S.pos && S.map) S.map.setView(S.pos, S.map.getZoom());
      };
      var muteBtn = body.querySelector('#nv_mute');
      if (muteBtn) muteBtn.onclick = function () {
        S.settings.muted = !S.settings.muted;
        saveSettings({ muted: S.settings.muted });
        muteBtn.textContent = S.settings.muted ? '🔇 Sound: off' : '🔊 Sound: on';
        if (S.settings.muted) { try { speechSynthesis.cancel(); } catch (e) {} }
      };
      function paintMode() {
        var t = body.querySelector('#nv_mode_truck'), c = body.querySelector('#nv_mode_car');
        if (t) t.className = 'btn small ' + (S.settings.mode === 'truck' ? 'primary' : 'ghost');
        if (c) c.className = 'btn small ' + (S.settings.mode === 'car' ? 'primary' : 'ghost');
        if (t) t.style.flex = '1'; if (c) c.style.flex = '1';
      }
      function setMode(m) {
        if (S.settings.mode === m) return;
        S.settings.mode = m;
        saveSettings({ mode: m });
        paintMode();
        if (S.dest && S.plan) doRoute();
        else banner('Mode: ' + (m === 'car' ? 'Car' : 'Truck'), 'Tap Route when ready.');
      }
      var mt = body.querySelector('#nv_mode_truck'), mc = body.querySelector('#nv_mode_car');
      if (mt) mt.onclick = function () { setMode('truck'); };
      if (mc) mc.onclick = function () { setMode('car'); };
    }
  };

  Meticulous.modules.navigator = api;
})();
