/* Meticulous — Navigation module (standalone, complete)
   Tabs: Work (built-in places + work favorites; visits logged to
   Manifest) vs Personal (never logged).
   v91 (owner, Oct 16): the built-ins are FAMOUS PUBLIC PITS ONLY
   (see NAV-BUILTIN); the owner's own 25 places from the old
   dataset migrate once into his work favorites (NAV-MIGRATION);
   and this screen carries the one quiet Yard pick that
   js/yardstart.js watches for dispatch auto-activation.
   v130 (owner, Oct 17): the built-ins are now exactly the NINE
   industry pits from his ship list (see NAV-BUILTIN) — his
   personal places stay favorites-only, always.
   v87 (owner, Oct 15): THE CARD WALL IS GONE — "don't need 40
   different cards for each and every saved location. That should
   be all in a dropdown… 1 field to fill in the address." Places
   now live behind ONE search/select field: type to filter the
   combined list (built-ins + the tab's own favorites), pick one,
   and the single primary action is Navigate — into the app's OWN
   Navigator (the Google/Waze/CoPilot/Apple button rows are gone;
   "when I can just use my own now?"). The Add form is not the
   landing face either ("Add favourite shouldn't be in the face
   when you open it — it has to live inside the favourites
   button"): it opens from one "+ Add favorite" button and closes
   back to the list with the new place selected.
   Persists via App._store (localStorage, mt_ prefix).
   v102 (owner field complaint, Oct 16, 2026 15:57 MDT — with 48
   favorites the v87 select listbox was a cramped scroll-box with
   names truncated mid-word: "looking for one is a chore. There
   should be a search button"): THE PICKER IS SEARCH-FIRST. The
   filter field is the primary element; the <select> listbox is
   GONE. Matches render as clean full-width rows — FULL names,
   never truncated — and one tap on a row picks the place and
   arms the detail panel's Navigate. Default order puts the
   driver's own rhythm first: most recently visited, then most
   visited, then alphabetical (places never visited carry no
   visits data and fall to the alphabetical group).
   v103 (owner, Oct 16, 2026 16:44 MDT — "But why these endless
   endless lists"): the search-first picker still rendered ALL
   ~48 places under the filter by default, so the wall was what
   he saw first. THE DEFAULT VIEW IS NOW RECENTS ONLY: at most
   PICKER_RECENTS_MAX most-recently-visited places, most recent
   first; the full list renders ONLY as filter matches while he
   types. The picker is ONE shared component (pickerEntries /
   pickerRowHTML / pickerFind below) — this module's Places card
   and the Navigator's destination door both render through it.
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
  /* v87 picker state: the selected place per tab, the filter text,
     and whether the Add form is open. Module-level so a re-render
     (tab switch, post-save) keeps the user's place. */
  var selId = { work: '', personal: '' };
  var pickQ = '';
  var addOpen = false;
  /* v294 (PLACES-NO-EDIT-LOCATION): the detail's Advanced
     section stays open across repaints for the place it was
     opened on (the row-tap repaint must not slam it shut). */
  var advOpenId = '';

  /* ================= NAV-BUILTIN-BEGIN =================
     v91: BUILT-IN PLACES ARE FAMOUS PUBLIC PLACES ONLY (owner,
     Oct 16, 2026, on site, looking at this dropdown: "All these places are useful
     for me, but not useful for everyone else… I don't see a
     reason why this should ship out with these locations
     preloaded… these can't stay in the GPS"). The v84–v90
     dataset was compiled from the OWNER'S OWN 2026 dispatch
     history — his pits, his job sites, his fuel stops — and it
     no longer ships (it now migrates into HIS work favorites,
     NAV-MIGRATION below).
     v130 (owner, Oct 17, 2026): THE INDUSTRY-PIT SET IS HIS
     LIST — "each one of these pits is rather important to
     keep it safe in the directory… you should ship them with
     the app." The nine rows below are transcribed from his
     ship list (industry-pits-ship-list.json, prepared Oct 17
     from his saved-pit screenshots matched to public
     listings): name, street address AND pin per pit, from
     that list and nothing else. His PERSONAL places and his
     work-site pins are not here and never ship — they stay
     his favorites only (the reconciliation he ruled Oct
     16/17). The two v91 builder-picked listings are
     subsumed: the Spy Hill STAR pit ships under its full
     listing name from his list, and a pit that is not on
     his list does not ship, however famous — the shipped
     set is exactly his nine. Notes are kept free of the
     list's internal commentary: the alternate candidate
     pins it weighed appear nowhere in this data.
     Built-ins are not stored in nav_data: they cannot be deleted,
     do not sync, and are the same on every install. Personal
     favorites are untouched. */
  var BUILTIN_RAW = [
    ['BURNCO Indus Aggregate Pit', 50.852961, -113.841696, 'pit', 'BURNCO aggregate pit — Indus, Rocky View County', '284129 Township Rd 222, Rocky View County, AB'],
    ['BURNCO Cochrane Aggregate Pit', 51.224722, -114.580872, 'pit', 'BURNCO aggregate pit — Cochrane, Rocky View County', '262236 Range Rd 51, Rocky View County, AB'],
    ['Hillstone Aggregates', 51.263975, -114.437458, 'pit', 'Hillstone aggregate pit — Big Hill Springs Rd', '40217 Big Hill Springs Rd, Rocky View County, AB'],
    ['Stoney Trail Aggregate Resource', 51.165429, -114.213202, 'pit', 'Stoney Trail Aggregate Resource (STAR) · BLV Group pit at Spy Hill', '12411 85 St NW, Calgary, AB'],
    ['Amrize Spyhill', 51.179086, -114.190718, 'pit', 'Amrize pit — Spy Hill, NW Calgary', '13012 85 St NW, Calgary, AB'],
    ['Standard General Calgary (Colas)', 50.9664, -113.89697, 'pit', 'Standard General (Colas) — SE Calgary', '9660 Enterprise Way SE, Calgary, AB T3S 0A1'],
    ['Aecon Gravel Pit', 50.722818, -114.188562, 'pit', 'Aecon gravel pit — Foothills County', '354201 128 St W, Foothills County, AB'],
    ['Amrize Industrial', 51.008548, -114.007485, 'pit', 'Amrize industrial plant — 50 Ave SE', '2213 50 Ave SE, Calgary, AB'],
    ['Aecon Bradi Pit', 51.27206, -114.43179, 'pit', 'Aecon pickup pit — near Hillstone', '']
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

  /* ================= NAV-MIGRATION-BEGIN =================
     v91: THE OWNER'S 25, KEPT — AS HIS. This dataset is the exact
     v84/v87 built-in table (names, types, notes, pins, addresses —
     byte-for-byte), and it lives ONLY here, inside the migration,
     plus its test fixture. On the first run of v91+ an install
     that PREDATES the removal (real local data already present:
     saved places, dispatches, or finished onboarding) gets all 25
     copied into its OWN work favorites — the same store the Add
     form writes — so they show tagged "Yours", navigate, log work
     visits and delete exactly like favorites the user added by
     hand. Deduped against what is already there (same name, or
     same pin = skip). A fresh install (no local data at all)
     gets NOTHING copied — the product ships clean — and the
     versioned flag (nav_places_migrated = 91) is set either way,
     so the migration never re-runs: a migrated favorite the user
     later deletes STAYS deleted. The two pin-less Mobil rows
     migrate as address-only favorites, same as they were. */
  var MIGRATION_RAW = [
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
  var MIGRATION_VERSION = 91;
  var migrating = false;
  /* "Predates the removal" = this install already holds real
     data. Deliberately strict: synced-in LATER data must not
     conjure the 25 onto a fresh device — the owner's own phone
     (which holds data) migrates, and the migrated favorites then
     sync like any others. */
  function navHasExistingData() {
    try {
      var d = S('data', null);
      if (d && ((d.work && d.work.length) || (d.personal && d.personal.length) || (d.recent && d.recent.length))) return true;
    } catch (e) {}
    try { if ((App._store.get('dsp_list', []) || []).length) return true; } catch (e) {}
    try {
      var ob = App._store.get('onboarding', null);
      if (ob && (ob.done || ob.completed || ob.name || ob.company)) return true;
    } catch (e) {}
    return false;
  }
  function migrateLegacyPlaces() {
    if (migrating) return 0;
    var added = 0;
    try {
      if (S('places_migrated', 0)) return 0;
      migrating = true;
      if (navHasExistingData()) {
        var d = data();
        var work = d.work || (d.work = []);
        /* Dedupe is judged ONLY against the favorites the user
           already had — never against rows added by this same
           pass: the dataset itself legitimately holds two places
           on one pin (L30 CIP / the CIP dump pin). */
        var already = work.slice();
        MIGRATION_RAW.forEach(function (r) {
          var nameKey = String(r[0]).trim().toLowerCase(), dup = false, i, f;
          for (i = 0; i < already.length; i++) {
            f = already[i];
            if (!f) continue;
            if (String(f.name || '').trim().toLowerCase() === nameKey) { dup = true; break; }
            if (r[1] && r[2] && f.lat && f.lng &&
                Math.abs(+f.lat - r[1]) < 1e-6 && Math.abs(+f.lng - r[2]) < 1e-6) { dup = true; break; }
          }
          if (dup) return;
          var fav = { id: uid(), name: r[0], address: r[5] || '', type: r[3], visits: 0 };
          if (r[1] && r[2]) { fav.lat = r[1]; fav.lng = r[2]; }
          if (r[4]) fav.note = r[4];
          work.push(fav);
          added++;
        });
        if (added) saveData(d);
      }
      W('places_migrated', MIGRATION_VERSION);
    } catch (e) { /* a failed migration must never break Places */ }
    migrating = false;
    return added;
  }
  /* ================= NAV-MIGRATION-END ================= */

  function data() {
    migrateLegacyPlaces();
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
    /* v118: a pin-sourced favorite can carry coordinates for a
       name — the recent logs the RESOLVED name (see
       displayPlaceName), so "Go again" never pastes coordinates
       into the search box. */
    var rec = { id: uid(), name: displayPlaceName(fav), address: fav.address || '', kind: kind, ts: Date.now() };
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
      manifestFeedPush('navigation', 'Navigated to work site: ' + displayPlaceName(fav) + (fav.address ? ' — ' + fav.address : ''));
    }
    saveData(d);
  }

  /* v87: THE hand-off into our own Navigator. The visit is
     recorded here (manifest feed + recent, exactly as the old
     external-app buttons recorded it); the destination itself
     travels as a one-shot pending record the Navigator consumes
     on open — a pinned place hands over its PIN (a name search
     can land on the wrong gate; the coordinates are the spot the
     dispatcher actually sent), an address-only place hands over
     its address as the search text. */
  function goNavigate(fav, kind) {
    recordNav(fav, kind);
    var pend = { name: displayPlaceName(fav), ts: Date.now() };
    if (fav.lat && fav.lng) { pend.lat = fav.lat; pend.lng = fav.lng; }
    /* v183: the query is the ADDRESS ALONE — gluing the place
       name in front ("Home, 1243 Cornerstone…") made the
       geocoder find nothing and the Navigate tap loop back to
       the destination page (owner, Oct 20 17:13 MDT). The name
       travels separately in pend.name, and the Navigator checks
       its saved places by that name before geocoding at all. */
    else pend.query = fav.address ? fav.address : fav.name;
    App._store.set('nav_pending', pend);
    App.openModule('navigator');
  }

  /* v87: the combined list behind the ONE field — the tab's own
     favorites plus, on the work tab, the built-ins. Each entry
     carries its source so the picker can tag it (Built-in /
     Yours) and the detail panel knows whether Remove applies. */
  function placesFor(kind) {
    var d = data(), out = [];
    if (kind === 'work') BUILTINS.forEach(function (p) { out.push({ place: p, src: 'builtin' }); });
    (kind === 'work' ? d.work : d.personal).forEach(function (f) { out.push({ place: f, src: 'fav' }); });
    return out;
  }
  function entryMatches(e, q) {
    if (!q) return true;
    var p = e.place;
    var hay = (p.name + ' ' + (p.type || '') + ' ' + (p.note || '') + ' ' + (p.address || '')).toLowerCase();
    return hay.indexOf(q) !== -1;
  }
  function findEntry(kind, id) {
    var list = placesFor(kind);
    for (var i = 0; i < list.length; i++) if (list[i].place.id === id) return list[i];
    return null;
  }
  function optionLabel(e) {
    var p = e.place;
    return (TYPE_ICON[p.type] || '📍') + ' ' + p.name +
      (p.type ? ' — ' + p.type : '') + (e.src === 'builtin' ? ' · Built-in' : ' · Yours');
  }
  /* v102: the picker's default order — the driver's own rhythm
     first (most recently visited, then most visited), everything
     never visited after, alphabetical. Built-ins carry no visit
     data, so they land in the alphabetical group. */
  function pickerOrder(list) {
    return list.slice().sort(function (a, b) {
      var pa = a.place, pb = b.place;
      var la = pa.lastVisit || 0, lb = pb.lastVisit || 0;
      if (lb !== la) return lb - la;
      var va = pa.visits || 0, vb = pb.visits || 0;
      if (vb !== va) return vb - va;
      return String(pa.name).localeCompare(String(pb.name));
    });
  }

  /* ================= PICKER-BEGIN =================
     v103: THE search-first places picker — ONE component, two
     hosts (this module's Places card and the Navigator's
     destination door). pickerEntries(kind, q) is the whole
     policy:
       - q EMPTY → the RECENTS view: only places the driver has
         actually gone to (a lastVisit stamp, or a Recent-
         destinations entry under the same name), most recent
         first, capped at PICKER_RECENTS_MAX. Never the wall.
       - q TYPED → the FULL combined list, filter matches only,
         in pickerOrder.
     Recency rides the data the app already keeps: favorites
     carry visits/lastVisit (work tab), and data().recent logs
     every navigation by name for both tabs — a place's
     effective lastVisit is the newer of the two. Entries are
     shallow copies: the stored favorites are never mutated by
     picking. pickerRowHTML is the one row markup both hosts
     paint (full-width button, FULL name, source tag); a host
     wires [data-pid] taps itself. */
  var PICKER_RECENTS_MAX = 6;
  /* v118: the name a place ANSWERS TO. A place saved from a pin
     can carry its own coordinates AS its name ("50.9519460,
     -114.0273550") — the soak tapped the recent for the Butterfly
     dump site and the search box filled with raw coordinates
     instead of the name, breaking the v113/v107 tap rule. The
     resolver: a real name wins; a coordinates-name resolves to
     the saved place at the same pin (favorites + built-ins, both
     tabs) and borrows ITS name; a pin nobody named reads
     "Dropped pin". Raw coordinates never become the visible
     query anywhere a name is shown or filled. */
  var COORDS_NAME_RE = /^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$/;
  function nameIsCoords(nm) { return COORDS_NAME_RE.test(String(nm || '').trim()); }
  function placeByCoords(lat, lng) {
    var d = data(), all = [];
    BUILTINS.forEach(function (p) { all.push(p); });
    (d.work || []).forEach(function (p) { all.push(p); });
    (d.personal || []).forEach(function (p) { all.push(p); });
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      if (p && p.lat && p.lng &&
          Math.abs(parseFloat(p.lat) - lat) < 0.0006 &&
          Math.abs(parseFloat(p.lng) - lng) < 0.0006) return p;
    }
    return null;
  }
  function displayPlaceName(p) {
    if (!p) return '';
    var nm = String(p.name || '').trim();
    if (nm && !nameIsCoords(nm)) return nm;
    if (p.lat && p.lng) {
      var hit = placeByCoords(parseFloat(p.lat), parseFloat(p.lng));
      if (hit && String(hit.name || '').trim() && !nameIsCoords(hit.name)) return String(hit.name).trim();
      return 'Dropped pin';
    }
    return nm;
  }
  function pickerEntries(kind, q) {
    var d = data();
    var rmap = {};
    (d.recent || []).forEach(function (r) {
      /* v118: recents key by their RESOLVED name too — a recent
         logged under raw coordinates still counts as a visit to
         the place that lives at that pin. */
      var k = String((r && r.name) || '').trim().toLowerCase();
      if (k && !rmap[k]) rmap[k] = r.ts || 0; /* recent is newest-first */
      var rk = String(displayPlaceName(r) || '').trim().toLowerCase();
      if (rk && !rmap[rk]) rmap[rk] = r.ts || 0;
    });
    var all = placesFor(kind).map(function (e) {
      var p = {}, k;
      for (k in e.place) p[k] = e.place[k];
      p.name = displayPlaceName(p); /* v118: rows never show a coordinates-name */
      var rt = rmap[String(p.name || '').trim().toLowerCase()] || 0;
      if (rt > (p.lastVisit || 0)) p.lastVisit = rt;
      return { place: p, src: e.src };
    });
    all = pickerOrder(all);
    q = String(q || '').trim().toLowerCase();
    if (q) return { rows: all.filter(function (e) { return entryMatches(e, q); }), recents: false };
    return {
      rows: all.filter(function (e) { return (e.place.lastVisit || 0) > 0; }).slice(0, PICKER_RECENTS_MAX),
      recents: true
    };
  }
  function pickerRowInner(e, pickedId) {
    var p = e.place, picked = !!pickedId && p.id === pickedId;
    /* v128: the subtitle never carries a raw coordinate pair —
       a favorite can hold its own pin AS its address text (the
       owner's Butterfly: address "50.9519460, -114.0273550"),
       and the row then read "dump site · Yours · 50.9519460,
       -114.0273550" — machinery, not a place (the v118 hygiene,
       applied to the row itself). The coordinates live only in
       the expanded detail. A real address still shows. */
    var addr = (p.address && !nameIsCoords(p.address)) ? ' · ' + p.address : '';
    return '<span style="display:block">' + (picked ? '✓ ' : '') + (TYPE_ICON[p.type] || '📍') + ' <b>' + esc(p.name) + '</b></span>' +
      '<span class="b" style="display:block">' +
      esc((p.type ? p.type : '') + (e.src === 'builtin' ? ' · Built-in' : ' · Yours') + addr) +
      '</span>';
  }
  function pickerRowHTML(e, pickedId) {
    var p = e.place;
    return '<button class="btn ghost" data-pid="' + esc(p.id) + '" ' +
      'style="width:100%;text-align:left;margin-top:6px;white-space:normal;height:auto">' +
      pickerRowInner(e, pickedId) + '</button>';
  }
  function pickerFind(kind, id) { return findEntry(kind, id); }
  /* ================= PICKER-END ================= */

  var api = {
    builtinPlaces: builtinPlaces,
    migrateLegacyPlaces: migrateLegacyPlaces,
    /* v103: the shared places picker (see PICKER region) — the
       Navigator's destination door renders through these too. */
    pickerEntries: pickerEntries,
    pickerRowHTML: pickerRowHTML,
    pickerFind: pickerFind,
    displayPlaceName: displayPlaceName, /* v118: hosts resolve a place's answerable name through here */
    /* v150: THE hand-off, callable by other modules — a dispatch
       pin (owner, Oct 17, 2026 22:02 MDT: "Why does this pin take
       me to google maps still.. When our navigator is up and
       ready") enters the Navigator through the very same door a
       place picked here uses: the visit is recorded (work —
       Manifest line + the recent the load fence reads), the
       destination travels as nav_pending, the Navigator opens.
       No second path into navigation exists. */
    navigateToPin: function (name, lat, lng) {
      goNavigate({ name: name || '', lat: lat, lng: lng }, 'work');
    },
    /* v209 (NAV-2STEP): a saved place resolved from its address
       LEARNS its pin — the Navigator calls this when a place
       arriving by name (nav_pending, no coordinates) resolves
       through the geocoder. Only a MISSING pin is filled; an
       existing pin never moves. Returns true when it learned. */
    learnCoords: function (name, lat, lng) {
      var la = Number(lat), ln = Number(lng);
      var want = String(name || '').trim().toLowerCase();
      if (!want || !isFinite(la) || !isFinite(ln)) return false;
      var d = data(), hit = null;
      ['work', 'personal'].forEach(function (kind) {
        (d[kind] || []).forEach(function (p) {
          if (hit || !p) return;
          if ((p.lat && p.lng)) return;
          if (String(displayPlaceName(p) || '').trim().toLowerCase() === want) hit = p;
        });
      });
      if (!hit) return false;
      hit.lat = la; hit.lng = ln;
      saveData(d);
      return true;
    },
    /* v294 (PLACES-NO-EDIT-LOCATION, owner evidence Oct 31,
       2026): a saved place's pin can MOVE. The detail offered
       Navigate and Remove only, and the Add form takes a text
       address — when a job site itself moved, the place could
       not follow it. This is THE door for a deliberate
       location change (learnCoords above is the opposite law:
       a geocoder-learned pin never moves an existing one).
       The SAME record is updated in place — id, name, type,
       note and visit history ride through — and the write
       stamps the record's updAt, the v293 version rule: the
       newest version of a record is the one sync keeps, so a
       re-pin wins over older copies instead of being stomped
       by them. Coordinates arrive as numbers or as the typed
       strings the Advanced fields hold; blanks and junk are
       refused (Number('') === 0 would otherwise plant the
       place in the ocean off Ghana). Returns the updated
       record, or null when refused. */
    setPlaceCoords: function (kind, id, lat, lng) {
      if (kind !== 'work' && kind !== 'personal') return null;
      if (lat === null || lat === undefined || lng === null || lng === undefined) return null;
      if (typeof lat === 'string' && !lat.trim()) return null;
      if (typeof lng === 'string' && !lng.trim()) return null;
      var la = Number(lat), ln = Number(lng);
      if (!isFinite(la) || !isFinite(ln)) return null;
      if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
      var d = data(), list = (kind === 'work') ? d.work : d.personal, hit = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === id) { hit = list[i]; break; }
      }
      if (!hit) return null;
      hit.lat = la; hit.lng = ln;
      hit.updAt = Date.now();
      saveData(d);
      return hit;
    },
    /* v294: the one-tap half of the same door — the place takes
       the device's CURRENT position, through the app's usual
       fix cascade (MeticulousGeo.getCurrent: fresh cached fix,
       native watcher, one retry, coarse web fix, last-known —
       it resolves rather than rejecting, so no caller dead-ends
       on location). Resolves true when the place moved, false
       when no usable fix came back (the place is left exactly
       where it was). */
    repinPlace: function (kind, id) {
      if (typeof window === 'undefined' || !window.MeticulousGeo ||
          typeof MeticulousGeo.getCurrent !== 'function') return Promise.resolve(false);
      return MeticulousGeo.getCurrent(10000).then(function (fix) {
        if (!fix || fix.latitude === null || fix.latitude === undefined ||
            fix.longitude === null || fix.longitude === undefined) return false;
        return !!api.setPlaceCoords(kind, id, fix.latitude, fix.longitude);
      }).catch(function () { return false; });
    },
    /* v207 (CONNECT-PICK part 3): every place this driver could
       send a connection — built-ins + his work + personal
       favorites, names resolved the picker's way, duplicates
       (the same place on both tabs / a built-in twin) folded.
       The Connect destination share reads it. */
    shareablePlaces: function () {
      var out = [], seen = {};
      ['work', 'personal'].forEach(function (kind) {
        placesFor(kind).forEach(function (e) {
          var p = e.place || {};
          var nm = displayPlaceName(p);
          var key = nm.toLowerCase() + '|' + (p.lat || '') + ',' + (p.lng || '');
          if (!nm || seen[key]) return;
          seen[key] = 1;
          out.push({ name: nm, address: p.address || '', lat: p.lat ? Number(p.lat) : 0, lng: p.lng ? Number(p.lng) : 0 });
        });
      });
      return out;
    },
    status: function () {
      var d = data();
      return d.work.length ? d.work.length + ' work places' : 'No favorites yet';
    },
    render: function (body) {
      var kind = tab;

      var h = '<div class="card"><div class="row">' +
        '<button class="btn small ' + (tab === 'work' ? 'primary' : 'ghost') + '" data-tab="work" style="flex:1">⭐ Work</button>' +
        '<button class="btn small ' + (tab === 'personal' ? 'primary' : 'ghost') + '" data-tab="personal" style="flex:1">🏠 Personal</button>' +
        '</div>' +
        (tab === 'work'
          ? '<p class="note">Work favorites are logged to your Manifest automatically.</p>'
          : '<p class="note">Personal places are <b>never</b> logged anywhere.</p>') +
        '</div>';

      /* ---- v87: the places surface — ONE field, one action ---- */
      h += '<div class="card"><h3>' + (tab === 'work' ? '📍 Places' : '🏠 Personal places') + '</h3>' +
        '<input id="nv_q" placeholder="Type to find a place…" value="' + esc(pickQ) + '" style="width:100%">' +
        '<div id="nv_results" style="margin-top:8px"></div>' +
        '<div id="nv_detail" style="margin-top:10px"></div>' +
        '<button class="btn ghost" id="nv_addopen" style="margin-top:10px">＋ Add ' + (tab === 'work' ? 'favorite' : 'place') + '</button>' +
        /* the Add form lives behind that button — never the landing face */
        '<div id="nv_addwrap" style="display:' + (addOpen ? 'block' : 'none') + ';margin-top:10px">' +
        '<label class="f">Name</label><input id="nv_name" placeholder="' + (tab === 'work' ? 'e.g. North gravel pit' : 'e.g. Walmart Deerfoot') + '">' +
        '<label class="f">Address</label><input id="nv_addr" placeholder="Street address or area">';
      if (tab === 'work') {
        h += '<label class="f">Type</label><select id="nv_type">' +
          TYPE_OPTS.map(function (t) { return '<option value="' + t + '">' + (TYPE_ICON[t] || '') + ' ' + t + '</option>'; }).join('') + '</select>';
      }
      h += '<div class="row" style="margin-top:10px"><button class="btn primary" id="nv_add" style="flex:1">Add</button>' +
        '<button class="btn ghost" id="nv_addcancel" style="flex:1">Cancel</button></div></div>' +
        /* v91: the Yard — ONE quiet setting (owner, Oct 16:
           leaving the yard turns the day's saved dispatch on).
           The select lists the user's own places; "Automatic"
           means the personal place named Home. js/yardstart.js
           does the watching; this only records the pick. */
        '<div class="row" style="margin-top:12px;align-items:center">' +
        '<label class="f" style="margin:0">🏠 Yard</label>' +
        '<select id="nv_yard" style="flex:1"></select></div>' +
        '<p class="note">Leaving your yard turns on today\'s saved dispatch.</p></div>';

      /* ---- Recent destinations ---- */
      var d = data();
      h += '<div class="card"><h3>🕘 Recent destinations</h3>';
      if (!d.recent.length) {
        h += '<div class="empty">Nothing yet. Navigate somewhere and it will show here.</div>';
      } else {
        h += d.recent.slice(0, 10).map(function (r) {
          return '<div class="listitem"><div class="a">' + esc(r.name) +
            ' <span class="pill">' + (r.kind === 'work' ? 'work' : 'personal') + '</span></div>' +
            (r.address && !nameIsCoords(r.address) ? '<div class="b">' + esc(r.address) + '</div>' : '') +
            '<div class="b">' + fmtWhen(r.ts) + '</div>' +
            '<div class="row" style="margin-top:6px"><button class="btn small navy" data-rgo="' + esc(r.id) + '">Go again</button></div></div>';
        }).join('');
      }
      h += '</div>';

      body.innerHTML = h;

      /* ---- the picker (v102 search-first; v103 recents-only
         default): filter repaints ONLY the results list (the
         input keeps focus); one tap on a row picks the place and
         repaints the detail (Navigate armed). Rows come from the
         shared component (pickerEntries/pickerRowHTML): with no
         filter text the list is at most the ~6 most recently
         visited places — the full list renders ONLY as matches
         while typing. ---- */
      var resEl = body.querySelector('#nv_results');
      var detailEl = body.querySelector('#nv_detail');
      var qEl = body.querySelector('#nv_q');
      /* v107: a Recent-destinations pick that is not (or no longer)
         a saved place still gets a detail — built from the recent
         itself — so its Navigate continues the same flow. */
      var selRecent = null;
      /* v128 — THE DETAIL LIVES AT THE TAP (owner recording,
         Oct 17 10:27): the detail panel used to render at the
         BOTTOM of the whole list — he tapped a place and had to
         scroll down to find Navigate. Now the ONE panel MOVES
         directly under the tapped row (accordion-style), so
         Navigate is on screen at the tap itself. Its home slot
         (right under the results list) is remembered here:
         every list repaint first brings the panel home, so a
         repaint can never strand or destroy it inside the list
         it is about to replace. Moving the existing node — never
         re-rendering it elsewhere — keeps the v113 tap rule's
         no-flicker promise. */
      var detailHomeParent = detailEl ? (detailEl.parentNode || null) : null;
      var detailHomeNext = detailEl ? (detailEl.nextSibling || null) : null;
      function detailToHome() {
        if (!detailEl || !detailHomeParent) return;
        if (detailEl.parentNode === detailHomeParent && detailEl.nextSibling === detailHomeNext) return;
        if (typeof detailHomeParent.insertBefore === 'function') detailHomeParent.insertBefore(detailEl, detailHomeNext);
      }
      function placeDetail() {
        if (!detailEl) return;
        var rowEl = null;
        if (resEl && !selRecent && selId[kind] && typeof resEl.querySelectorAll === 'function') {
          var rows = resEl.querySelectorAll('[data-pid]');
          for (var i = 0; i < rows.length; i++) {
            if (rows[i].getAttribute && rows[i].getAttribute('data-pid') === selId[kind]) { rowEl = rows[i]; break; }
          }
        }
        if (rowEl && typeof resEl.insertBefore === 'function') {
          if (rowEl.nextSibling !== detailEl) resEl.insertBefore(detailEl, rowEl.nextSibling);
        } else {
          /* no row to sit under (a Recent-destinations pick, or
             the selected place is filtered out of this paint):
             the panel waits at its home slot under the list */
          detailToHome();
        }
      }
      function paintResults() {
        detailToHome();
        var res = pickerEntries(kind, pickQ);
        var list = res.rows;
        if (!list.length) {
          resEl.innerHTML = '<div class="empty">' +
            (pickQ.trim() ? 'No place matches that.'
              : (placesFor(kind).length ? 'Places you go to will show here — type above to find any place.' : 'No places yet.')) + '</div>';
          placeDetail();
          return list;
        }
        resEl.innerHTML = (res.recents ? '<p class="note" style="margin:2px 0 0">🕘 Recent places</p>' : '') +
          list.map(function (e) { return pickerRowHTML(e, selId[kind]); }).join('');
        resEl.querySelectorAll('[data-pid]').forEach(function (b) {
          b.onclick = function () {
            /* v107 — THE TAP RULE (owner, Oct 16 20:13): "When I
               touch any of the saved addresses it should populate
               in the search bar itself!" The tap writes the place
               into the ONE field; the detail below (Navigate)
               continues from there. And the list is NOT repainted:
               the only change is the ✓ moving, done in place on
               the affected rows — repainting re-sorted the
               recents under his finger and garbled the list
               (his Oct 16 recording). */
            var pid = b.getAttribute('data-pid');
            var picked = findEntry(kind, pid);
            if (picked && qEl) qEl.value = displayPlaceName(picked.place);
            selId[kind] = pid;
            selRecent = null;
            resEl.querySelectorAll('[data-pid]').forEach(function (rb) {
              var re = findEntry(kind, rb.getAttribute('data-pid'));
              if (re) rb.innerHTML = pickerRowInner(re, selId[kind]);
            });
            paintDetail();
          };
        });
        placeDetail();
        return list;
      }
      function paintDetail() {
        var e = selId[kind] ? findEntry(kind, selId[kind]) : null;
        if (!e && selRecent) e = { place: selRecent, src: 'recent' };
        if (!e) {
          detailEl.innerHTML = '<div class="empty">Pick a place above.</div>';
          placeDetail();
          return;
        }
        var p = e.place;
        detailEl.innerHTML =
          '<div class="a">' + (TYPE_ICON[p.type] || '📍') + ' <b>' + esc(displayPlaceName(p)) + '</b>' +
          (p.type ? ' <span class="pill">' + esc(p.type) + '</span>' : '') +
          ' <span class="pill">' + (e.src === 'builtin' ? 'Built-in' : 'Yours') + '</span></div>' +
          (p.note ? '<div class="b">' + esc(p.note) + '</div>' : '') +
          '<div class="b">' + ((p.lat && p.lng) ? esc(p.lat + ', ' + p.lng) : esc(p.address || '')) + '</div>' +
          (kind === 'work' && e.src === 'fav' && p.visits ? '<div class="b">' + p.visits + ' visits' + (p.lastVisit ? ' · last ' + fmtWhen(p.lastVisit) : '') + '</div>' : '') +
          '<button class="btn primary big" id="nv_go" style="margin-top:8px">🧭 Navigate</button>' +
          (e.src === 'fav' ?
            /* v294 (PLACES-NO-EDIT-LOCATION): the place's pin can
               move — Re-pin where the truck stands, one tap; the
               exact-coordinates fields live in Advanced, the
               plumbing spot. Built-ins and recents get neither:
               they are not the user's own record. */
            '<div class="row" style="margin-top:6px"><button class="btn small" id="nv_repin">📍 Re-pin to my location</button>' +
            '<button class="btn small ghost" id="nv_remove">Remove this place</button></div>' +
            '<div class="row" style="margin-top:6px"><button class="btn small ghost" id="nv_advtoggle">⚙️ Advanced</button></div>' +
            '<div id="nv_advwrap" style="display:' + (advOpenId === p.id ? 'block' : 'none') + ';margin-top:6px">' +
            '<label class="f">Latitude</label><input id="nv_adv_lat" inputmode="decimal" value="' + (p.lat ? esc(String(p.lat)) : '') + '">' +
            '<label class="f">Longitude</label><input id="nv_adv_lng" inputmode="decimal" value="' + (p.lng ? esc(String(p.lng)) : '') + '">' +
            '<div class="row" style="margin-top:8px"><button class="btn primary small" id="nv_adv_save">Save location</button></div>' +
            '<p class="note">Moves this place to exactly these coordinates.</p></div>' : '');
        detailEl.querySelector('#nv_go').onclick = function () { goNavigate(p, e.src === 'recent' ? (p.kind || kind) : kind); };
        var rm = detailEl.querySelector('#nv_remove');
        if (rm) rm.onclick = function () {
          if (!confirm('Remove this place?')) return;
          var dd = data();
          if (kind === 'work') dd.work = dd.work.filter(function (f) { return f.id !== p.id; });
          else dd.personal = dd.personal.filter(function (f) { return f.id !== p.id; });
          saveData(dd);
          selId[kind] = '';
          api.render(body);
        };
        var rp = detailEl.querySelector('#nv_repin');
        if (rp) rp.onclick = function () {
          api.repinPlace(kind, p.id).then(function (ok) {
            if (!ok) { alert('Could not get your location right now. Check location is on, then try again.'); return; }
            api.render(body);
          });
        };
        var advT = detailEl.querySelector('#nv_advtoggle');
        if (advT) advT.onclick = function () {
          advOpenId = (advOpenId === p.id) ? '' : p.id;
          var w = detailEl.querySelector('#nv_advwrap');
          if (w) w.style.display = (advOpenId === p.id) ? 'block' : 'none';
        };
        var advS = detailEl.querySelector('#nv_adv_save');
        if (advS) advS.onclick = function () {
          var laEl = detailEl.querySelector('#nv_adv_lat');
          var lnEl = detailEl.querySelector('#nv_adv_lng');
          var saved = api.setPlaceCoords(kind, p.id, laEl ? laEl.value : '', lnEl ? lnEl.value : '');
          if (!saved) { alert('Enter a valid latitude (−90 to 90) and longitude (−180 to 180).'); return; }
          advOpenId = '';
          api.render(body);
        };
        /* v128: the panel takes its place AT THE TAP — directly
           under the tapped row, Navigate in reach, no scrolling */
        placeDetail();
      }
      paintResults();
      paintDetail();
      qEl.addEventListener('input', function () {
        pickQ = qEl.value;
        selRecent = null;
        paintResults();
      });

      /* ---- tabs ---- */
      body.querySelectorAll('[data-tab]').forEach(function (b) {
        b.onclick = function () { tab = b.getAttribute('data-tab'); addOpen = false; pickQ = ''; api.render(body); };
      });

      /* ---- the Yard pick (v91): stored as nav_yard
         { kind, id }; "Automatic" clears it and the yard falls
         back to the personal place named Home. ---- */
      var yardSel = body.querySelector('#nv_yard');
      if (yardSel) {
        var dd2 = data();
        var curYard = S('yard', null);
        var hasHome = false;
        dd2.personal.forEach(function (f) {
          if (String(f.name || '').trim().toLowerCase() === 'home') hasHome = true;
        });
        var yopts = [{ v: '', label: hasHome ? 'Automatic — Home place' : 'Not set' }];
        dd2.work.forEach(function (f) { yopts.push({ v: 'work:' + f.id, label: f.name + ' · work' }); });
        dd2.personal.forEach(function (f) { yopts.push({ v: 'personal:' + f.id, label: f.name + ' · personal' }); });
        yardSel.innerHTML = yopts.map(function (o) {
          var sel = curYard && o.v && o.v === (curYard.kind + ':' + curYard.id);
          return '<option value="' + esc(o.v) + '"' + (sel ? ' selected' : '') + '>' + esc(o.label) + '</option>';
        }).join('');
        yardSel.addEventListener('change', function () {
          var v = yardSel.value;
          if (!v) { W('yard', null); return; }
          var i = v.indexOf(':');
          W('yard', { kind: v.slice(0, i), id: v.slice(i + 1) });
        });
      }

      /* ---- Add favorite (behind its button) ---- */
      body.querySelector('#nv_addopen').onclick = function () {
        addOpen = !addOpen;
        body.querySelector('#nv_addwrap').style.display = addOpen ? 'block' : 'none';
      };
      body.querySelector('#nv_addcancel').onclick = function () {
        addOpen = false;
        body.querySelector('#nv_addwrap').style.display = 'none';
      };
      body.querySelector('#nv_add').onclick = function () {
        var name = body.querySelector('#nv_name').value.trim();
        var addr = body.querySelector('#nv_addr').value.trim();
        if (!name) { alert('Enter a name for this place.'); return; }
        var dd = data();
        var fav = { id: uid(), name: name, address: addr };
        if (kind === 'work') {
          fav.type = body.querySelector('#nv_type').value;
          fav.visits = 0;
          dd.work.push(fav);
        } else {
          dd.personal.push(fav);
        }
        saveData(dd);
        addOpen = false;
        pickQ = '';
        selId[kind] = fav.id; /* back at the list, the new place selected */
        api.render(body);
      };

      /* ---- Recent destinations ----
         v107: Go again obeys the same tap rule as every place —
         it does NOT jump straight into the Navigator. It puts the
         destination into the search field and selects it (the
         matching saved place when there is one, the recent itself
         otherwise), so the flow continues from the populated box
         through the detail's Navigate — one pattern everywhere. */
      body.querySelectorAll('[data-rgo]').forEach(function (b) {
        b.onclick = function () {
          var dd = data(), id = b.getAttribute('data-rgo'), r = null;
          for (var i = 0; i < dd.recent.length; i++) if (dd.recent[i].id === id) { r = dd.recent[i]; break; }
          if (!r) return;
          /* v118: the box gets the RESOLVED name, never a stored
             coordinates-name (see displayPlaceName). */
          var rName = displayPlaceName(r);
          if (qEl) qEl.value = rName;
          var match = null;
          placesFor(kind).forEach(function (e) {
            if (match) return;
            if (r.lat && r.lng && e.place.lat && e.place.lng &&
                Math.abs(parseFloat(e.place.lat) - parseFloat(r.lat)) < 0.0006 &&
                Math.abs(parseFloat(e.place.lng) - parseFloat(r.lng)) < 0.0006) { match = e; return; }
            if (String(displayPlaceName(e.place) || '').trim().toLowerCase() === rName.toLowerCase()) match = e;
          });
          if (match) {
            selId[kind] = match.place.id;
            selRecent = null;
            pickQ = rName;
            paintResults();
          } else {
            selId[kind] = '';
            selRecent = { id: r.id, name: rName, address: r.address, lat: r.lat, lng: r.lng, kind: r.kind };
            resEl.querySelectorAll('[data-pid]').forEach(function (rb) {
              var re = findEntry(kind, rb.getAttribute('data-pid'));
              if (re) rb.innerHTML = pickerRowInner(re, '');
            });
          }
          paintDetail();
          try { detailEl.scrollIntoView({ block: 'nearest' }); } catch (e) {}
        };
      });
    }
  };

  Meticulous.modules.navigation = api;
})();

