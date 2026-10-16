/* Meticulous — Navigation module (standalone, complete)
   Tabs: Work favorites (logged to Manifest) vs Personal (never logged).
   Favorites have name, address, type (pit / job site / dump site).
   Route cards offer Google Maps, Waze, CoPilot Truck GPS, Apple Maps.
   Recent destinations list. Work visits feed the Manifest; personal never does.
   Persists via App._store (localStorage, mt_ prefix).
*/
(function () {
  'use strict';
  window.Meticulous = window.Meticulous || {};
  Meticulous.modules = Meticulous.modules || {};

  var S = function (k, d) { return App._store.get('nav_' + k, d); };
  var W = function (k, v) { App._store.set('nav_' + k, v); };
  var esc = function (s) { return App._esc(s); };

  var TYPE_OPTS = ['pit', 'job site', 'dump site'];
  var TYPE_ICON = { 'pit': '⛏️', 'job site': '🏗️', 'dump site': '🚧', 'fuel': '⛽' };
  var tab = 'work'; // active tab: 'work' | 'personal'

  /* ================= NAV-BUILTIN-BEGIN =================
     v84: BUILT-IN PLACES (owner, Oct 15: the Work favorites were
     EMPTY and "how do I even input a address?" — nobody thumb-types
     41 places; the addresses lived in Muse-side files, never in
     the app). These are compiled from the owner's own 2026 dispatch
     history (job-sites directory + confirmed pits list, Oct 15,
     2026): every entry carries the RESOLVED pin from his messages —
     nothing guessed, nothing looked up. Only CONFIRMED places with
     coordinates are seeded (the unconfirmed pits — Star Pit,
     Black Diamond, South plant — are NOT here; Aecon Scale Star
     Pit's pin could not be proven to mark the pit rather than the
     haul-to, so it waits for a proven pin). The two fuel entries
     carry street addresses from his receipts (no pin was ever
     shared for them; navigation falls back to the address query).
     Built-ins are not stored in nav_data: they cannot be deleted,
     do not sync, and are the same on every install. Personal
     favorites are untouched. */
  var BUILTIN_RAW = [
    ['12th Street', 51.000861, -114.033528, 'pit', 'Clay loading · one pin covers both sides — confirm North/South before rolling', ''],
    ['Aecon Bradi Pit', 51.2720600, -114.4317900, 'pit', 'Loads 80mm · near Cochrane', ''],
    ['Simply Stone', 50.96851, -114.0334, 'pit', 'Stone yard', ''],
    ['L5', 50.96657, -114.03564, 'pit', 'Aecon Inf load point', ''],
    ['Pier 3', 50.95537, -114.02769, 'job site', 'Enter through Remington', ''],
    ['North Plant', 51.1832681, -114.0366215, 'job site', '', ''],
    ['Southland Under Bridge', 50.967364, -114.033821, 'job site', 'Under the bridge, Southland', ''],
    ['Greenline', 51.00779, -114.02766, 'job site', 'Load point — also used as a dump spot', ''],
    ['Twins East', 50.9552222, -114.0249722, 'job site', 'Aecon Inf', ''],
    ['A2-L20', 50.96649, -114.03178, 'job site', 'Possibly the same pond complex as L20 Pond', ''],
    ['L20 Pond', 50.96602, -114.03211, 'job site', '', ''],
    ['L30 CIP', 50.9794722, -114.0388056, 'job site', 'The CIP dump pin is this same spot', ''],
    ['CIP (dump pin)', 50.9794722, -114.0388056, 'dump site', 'Dump for 12th Street clay · same spot as L30 CIP', ''],
    ['Ivor East Pond', 50.95134, -114.01563, 'job site', '', ''],
    ['Remington', 50.9605833, -114.0300000, 'job site', 'Also the entrance for Pier 3', ''],
    ['Remington — bridge spot', 50.95300, -114.02235, 'job site', 'The bridge in Remington', ''],
    ['Deerfoot / Bow Bottom exit', 50.9510199, -114.0257907, 'job site', 'Northbound Deerfoot exit from Bow Bottom Trail — right side of the ramp', ''],
    ['Maple Ridge', 50.96044, -114.03176, 'job site', '', ''],
    ['Amrize', 50.9942951, -114.0334216, 'dump site', 'Hauling-to site · several gates/piles in this area — confirm the pin for the day', ''],
    ['Burco Blvd (dump spot)', 50.9943056, -114.0334167, 'dump site', 'The "dump here" pin from the Burco Blvd 40mm drain run', ''],
    ['P Hauling yard (Ryan King)', 50.8785371, -114.0116239, 'job site', 'Ryan King / P Hauling address pin', ''],
    ['Volker — Cochrane job', 51.1770806, -114.4612953, 'job site', 'Via Hwy 22 to Griffin — avoid the no-truck route', ''],
    ['Lillydale Chicken', 51.0339417, -114.0380928, 'job site', 'Pin sent with a "Go Empty To" dispatch', '12059 44 St SE, Calgary'],
    ['Mobil — Westwinds', null, null, 'fuel', 'His main diesel stop', '300-3633 Westwinds Dr NE, Calgary'],
    ['Mobil — Heritage Meadows', null, null, 'fuel', '', '100-20 Heritage Meadows Way SE, Calgary']
  ];
  var BUILTINS = BUILTIN_RAW.map(function (r) {
    return {
      id: 'bi-' + r[0].toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: r[0], lat: r[1], lng: r[2], type: r[3], note: r[4],
      address: r[5] || '', builtin: true
    };
  });
  function builtinPlaces() { return BUILTINS.slice(); }
  function findBuiltin(id) {
    for (var i = 0; i < BUILTINS.length; i++) if (BUILTINS[i].id === id) return BUILTINS[i];
    return null;
  }
  /* ================= NAV-BUILTIN-END ================= */

  function data() {
    return S('data', { work: [], personal: [], recent: [] });
  }
  function saveData(d) { W('data', d); }
  function uid() { return 'n' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  function manifestFeedPush(kind, summaryText) {
    try {
      var feed = App._store.get('manifest_feed', []);
      feed.push({ ts: Date.now(), date: App._today(), kind: kind, summary: summaryText });
      App._store.set('manifest_feed', feed.slice(-500));
    } catch (e) {}
  }

  /* External navigation URLs for each supported app. */
  function navUrl(app, query) {
    var e = encodeURIComponent(query);
    if (app === 'waze') return 'https://waze.com/ul?q=' + e + '&navigate=yes';
    if (app === 'apple') return 'https://maps.apple.com/?daddr=' + e;
    if (app === 'copilot') return 'geo:0,0?q=' + e; // Android: opens app chooser incl. CoPilot
    return 'https://www.google.com/maps/dir/?api=1&destination=' + e;
  }
  var APP_LABEL = { google: 'Google Maps', waze: 'Waze', copilot: 'CoPilot', apple: 'Apple Maps' };

  function fmtWhen(ts) {
    try {
      var d = new Date(ts), now = new Date();
      var sameDay = d.toDateString() === now.toDateString();
      var t = d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
      return sameDay ? 'Today ' + t : d.toLocaleDateString('en', { month: 'short', day: 'numeric' }) + ' ' + t;
    } catch (e) { return ''; }
  }

  /* Record a navigation. Work visits are logged to Manifest; personal never. */
  function recordNav(fav, kind) {
    var d = data();
    var rec = { id: uid(), name: fav.name, address: fav.address || '', kind: kind, ts: Date.now() };
    /* v84: a place's pin rides the recent entry, so "Go again"
       navigates to the same pin, not a name search. */
    if (fav.lat && fav.lng) { rec.lat = fav.lat; rec.lng = fav.lng; }
    d.recent.unshift(rec);
    d.recent = d.recent.slice(0, 20);
    if (kind === 'work') {
      for (var i = 0; i < d.work.length; i++) {
        if (d.work[i].id === fav.id) {
          d.work[i].visits = (d.work[i].visits || 0) + 1;
          d.work[i].lastVisit = Date.now();
          break;
        }
      }
      manifestFeedPush('navigation', 'Navigated to work site: ' + fav.name + (fav.address ? ' — ' + fav.address : ''));
    }
    saveData(d);
  }

  function openNav(app, fav, kind) {
    recordNav(fav, kind);
    /* v84: a place with a pin navigates to the PIN — a name search
       can land on the wrong gate; the coordinates are the spot the
       dispatcher actually sent. */
    var q = (fav.lat && fav.lng) ? (fav.lat + ',' + fav.lng)
      : (fav.address ? fav.name + ', ' + fav.address : fav.name);
    window.open(navUrl(app, q), '_blank', 'noopener');
  }

  function navButtons(fav, kind) {
    return '<div class="row">' +
      ['google', 'waze', 'copilot', 'apple'].map(function (a) {
        return '<button class="btn small ' + (a === 'google' ? 'navy' : 'ghost') + '" data-navapp="' + a +
          '" data-navid="' + esc(fav.id) + '" data-navkind="' + kind + '">' + APP_LABEL[a] + '</button>';
      }).join('') + '</div>';
  }

  var api = {
    builtinPlaces: builtinPlaces,
    status: function () {
      var d = data();
      return d.work.length ? d.work.length + ' work places' : 'No favorites yet';
    },
    render: function (body) {
      var d = data();
      var defApp = S('defApp', 'google');

      var h = '<div class="card"><div class="row">' +
        '<button class="btn small ' + (tab === 'work' ? 'primary' : 'ghost') + '" data-tab="work" style="flex:1">⭐ Work</button>' +
        '<button class="btn small ' + (tab === 'personal' ? 'primary' : 'ghost') + '" data-tab="personal" style="flex:1">🏠 Personal</button>' +
        '</div>' +
        (tab === 'work'
          ? '<p class="note">Work favorites are logged to your Manifest automatically.</p>'
          : '<p class="note">Personal places are <b>never</b> logged anywhere.</p>') +
        '</div>';

      /* ---- Add favorite form ---- */
      h += '<div class="card"><h3>＋ Add ' + (tab === 'work' ? 'work favorite' : 'personal place') + '</h3>' +
        '<label class="f">Name</label><input id="nv_name" placeholder="' + (tab === 'work' ? 'e.g. Burnco Shepard pit' : 'e.g. Walmart Deerfoot') + '">' +
        '<label class="f">Address</label><input id="nv_addr" placeholder="Street address or area">';
      if (tab === 'work') {
        h += '<label class="f">Type</label><select id="nv_type">' +
          TYPE_OPTS.map(function (t) { return '<option value="' + t + '">' + (TYPE_ICON[t] || '') + ' ' + t + '</option>'; }).join('') + '</select>';
      }
      h += '<button class="btn primary" id="nv_add" style="margin-top:10px">Add</button></div>';

      /* ---- Favorite cards ---- */
      var items = tab === 'work' ? d.work : d.personal;
      h += '<div class="card"><h3>' + (tab === 'work' ? '⭐ Work favorites' : '🏠 Personal places') + '</h3>';
      if (!items.length) {
        h += '<div class="empty">' + (tab === 'work' ? 'No work places yet. Add your pits and job sites above.' : 'No personal places yet.') + '</div>';
      }
      items.forEach(function (f) {
        h += '<div class="listitem"><div class="a">' +
          (tab === 'work' ? (TYPE_ICON[f.type] || '📍') + ' ' : '📍 ') + esc(f.name) +
          (tab === 'work' ? ' <span class="pill">' + esc(f.type || 'site') + '</span>' : '') +
          '</div>' +
          (f.address ? '<div class="b">' + esc(f.address) + '</div>' : '') +
          (tab === 'work' && f.visits ? '<div class="b">' + f.visits + ' visits' + (f.lastVisit ? ' · last ' + fmtWhen(f.lastVisit) : '') + '</div>' : '') +
          '<div style="margin-top:8px">' + navButtons(f, tab) + '</div>' +
          '<div class="row" style="margin-top:6px"><button class="btn small ghost" data-del="' + esc(f.id) + '">Remove</button></div></div>';
      });
      h += '</div>';

      /* ---- v84: built-in places (work tab) ---- */
      if (tab === 'work') {
        h += '<div class="card"><h3>📍 Built-in places <span class="pill">' + BUILTINS.length + '</span></h3>' +
          '<p class="note">Your pits, job sites and fuel stops from this season\'s dispatches — already here, nothing to type. Tap a place to navigate to its pin.</p>' +
          '<input id="nv_bi_q" placeholder="Search places — try “Bradi” or “CIP”" style="width:100%">' +
          '<div id="nv_bi_list" style="margin-top:8px"></div></div>';
      }

      /* ---- Recent destinations ---- */
      h += '<div class="card"><h3>🕘 Recent destinations</h3>';
      if (!d.recent.length) {
        h += '<div class="empty">Nothing yet. Navigate somewhere and it will show here.</div>';
      } else {
        h += d.recent.slice(0, 10).map(function (r) {
          return '<div class="listitem"><div class="a">' + esc(r.name) +
            ' <span class="pill">' + (r.kind === 'work' ? 'work' : 'personal') + '</span></div>' +
            (r.address ? '<div class="b">' + esc(r.address) + '</div>' : '') +
            '<div class="b">' + fmtWhen(r.ts) + '</div>' +
            '<div class="row" style="margin-top:6px"><button class="btn small navy" data-rgo="' + esc(r.id) + '">Go again</button></div></div>';
        }).join('');
      }
      h += '</div>';

      body.innerHTML = h;

      /* ---- Wire events ---- */
      body.querySelectorAll('[data-tab]').forEach(function (b) {
        b.onclick = function () { tab = b.getAttribute('data-tab'); api.render(body); };
      });

      body.querySelector('#nv_add').onclick = function () {
        var name = body.querySelector('#nv_name').value.trim();
        var addr = body.querySelector('#nv_addr').value.trim();
        if (!name) { alert('Enter a name for this place.'); return; }
        var dd = data();
        var fav = { id: uid(), name: name, address: addr };
        if (tab === 'work') {
          fav.type = body.querySelector('#nv_type').value;
          fav.visits = 0;
          dd.work.push(fav);
        } else {
          dd.personal.push(fav);
        }
        saveData(dd);
        api.render(body);
      };

      function findFav(id, kind) {
        var dd = data();
        var arr = kind === 'work' ? dd.work : dd.personal;
        for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
        if (kind === 'work') { var bi = findBuiltin(id); if (bi) return bi; }
        return null;
      }
      body.querySelectorAll('[data-navapp]').forEach(function (b) {
        b.onclick = function () {
          var fav = findFav(b.getAttribute('data-navid'), b.getAttribute('data-navkind'));
          if (fav) openNav(b.getAttribute('data-navapp'), fav, b.getAttribute('data-navkind'));
        };
      });
      body.querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = function () {
          if (!confirm('Remove this place?')) return;
          var dd = data(), id = b.getAttribute('data-del');
          if (tab === 'work') dd.work = dd.work.filter(function (f) { return f.id !== id; });
          else dd.personal = dd.personal.filter(function (f) { return f.id !== id; });
          saveData(dd); api.render(body);
        };
      });
      body.querySelectorAll('[data-rgo]').forEach(function (b) {
        b.onclick = function () {
          var dd = data(), id = b.getAttribute('data-rgo'), r = null;
          for (var i = 0; i < dd.recent.length; i++) if (dd.recent[i].id === id) { r = dd.recent[i]; break; }
          if (!r) return;
          /* Re-navigate: reuses favorite record if it still exists so visits keep counting. */
          var fav = findFav(id, r.kind) || { id: r.id, name: r.name, address: r.address, lat: r.lat, lng: r.lng };
          openNav(defApp, fav, r.kind);
          api.render(body);
        };
      });

      /* ---- v84: built-in places list + search ---- */
      var biList = body.querySelector('#nv_bi_list');
      function paintBuiltins() {
        if (!biList) return;
        var qEl = body.querySelector('#nv_bi_q');
        var q = (qEl && qEl.value || '').trim().toLowerCase();
        var hits = BUILTINS.filter(function (p) {
          return !q || p.name.toLowerCase().indexOf(q) !== -1 ||
            (p.note || '').toLowerCase().indexOf(q) !== -1 || p.type.indexOf(q) !== -1;
        });
        biList.innerHTML = hits.length ? hits.map(function (f) {
          return '<div class="listitem"><div class="a">' + (TYPE_ICON[f.type] || '📍') + ' ' + esc(f.name) +
            ' <span class="pill">' + esc(f.type) + '</span></div>' +
            (f.note ? '<div class="b">' + esc(f.note) + '</div>' : '') +
            '<div class="b">' + ((f.lat && f.lng) ? esc(f.lat + ', ' + f.lng) : esc(f.address)) + '</div>' +
            '<div style="margin-top:8px">' + navButtons(f, 'work') + '</div></div>';
        }).join('') : '<div class="empty">No built-in place matches that — try a shorter word.</div>';
        biList.querySelectorAll('[data-navapp]').forEach(function (b) {
          b.onclick = function () {
            var fav = findBuiltin(b.getAttribute('data-navid'));
            if (fav) openNav(b.getAttribute('data-navapp'), fav, 'work');
          };
        });
      }
      var biQ = body.querySelector('#nv_bi_q');
      if (biQ) { biQ.addEventListener('input', paintBuiltins); paintBuiltins(); }
    }
  };

  Meticulous.modules.navigation = api;
})();
