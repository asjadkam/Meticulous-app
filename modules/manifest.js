/* Manifest / Daily Log — aggregates the day (Meticulous.modules convention) */
(function () {
  'use strict';
  var esc = function (s) { return App._esc(s); };
  var G = function (k, d) { return App._store.get(k, d); };
  /* v242 trap 1: the dated odometer log a manifest day reads is
     THAT DAY's truck's log (its own profile's chain) — never
     another truck's readings. No pid → the active profile's. */
  function wpOdoLogKey(pid) {
    try { if (window.App && App.workProfiles) return App.workProfiles.keyFor('odo_readings', pid || undefined); } catch (e) {}
    return 'odo_readings';
  }

  var SECTIONS = [
    ['dispatch', 'Dispatch list'], ['nav', 'Navigation list'], ['expense', 'Expense list'],
    ['incident', 'Incident list'], ['pti', 'PTI (inspections)'], ['start', 'Start Time'], ['end', 'End Time'],
    ['odo', 'Odometer'], ['loads', 'Loads hauled'],
    ['earned', 'Total Earned Income']
  ];
  /* v291 (MANIFEST-LOADS-SUMMARY): the 'geoloads' section is
     GONE — the GPS-count block it toggled no longer exists on
     the manifest at all (see docLines). A stored mft_sections
     set still carrying the key is simply never read again. */

  /* v87: the "why GPS load counting could not run" notes are GONE
     from the manifest (owner, Oct 15: "I told you yesterday that
     dump coordinates are usually not available on dispatch… They
     are verbally relayed to us on site!"). The old texts stated a
     wrong premise as if it were the driver's gap — in dump work
     the coordinates are NEVER on the dispatch; they are given out
     loud on site, so an excuse premised on dispatch paperwork
     blames the user for an app design gap. Silence over blame:
     a day GPS counting could not cover prints no loads excuse at
     all. The engine still records its reason on the geoloads day
     record (js/geoloads.js) — that is internal data for the
     future learned-site counter, not user-facing text. */

  /* v319 (MANIFEST-DATE-0001): a stored manifest date is only
     trusted when it is a real, sane calendar date. The owner's
     phone held "0001-11-02" in mani_date (the native date picker
     can hand back a mangled value, and the old dayStr trusted
     the store forever), so the Manifest opened on year-1 days
     and showed no work. A value is valid only as YYYY-MM-DD, a
     date that actually exists, with a year from 2020 through
     next year. A stored NON-EMPTY value that fails falls back
     to today AND is overwritten with today (self-heal), so one
     bad pick can never stick. Absent or empty keeps the
     caller's default and is left as-is — for the range ends,
     empty is the deliberate "no dates picked" state (v211's
     honest empty note), not corruption. */
  function maniDateOk(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    var p = v.split('-'), y = +p[0], m = +p[1], dd = +p[2];
    if (y < 2020 || y > new Date().getFullYear() + 1) return false;
    if (m < 1 || m > 12 || dd < 1 || dd > 31) return false;
    var dt = new Date(y, m - 1, dd);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === dd;
  }
  function maniDate(key, unsetFallback) {
    var v = G(key, null);
    if (maniDateOk(v)) return v;
    if (v) {
      var t = App._today();
      try { App._store.set(key, t); } catch (e) {}
      return t;
    }
    return unsetFallback;
  }
  function dayStr() { return maniDate('mani_date', App._today()); }

  /* v75: session stamps are stored as ISO STRINGS (app.js
     stopSessionAt writes endedAt via toISOString), but collect()
     did arithmetic on the raw value — endedAt - seconds * 1000 is
     NaN on a string, and new Date(NaN).toLocaleTimeString() renders
     literally "Invalid Date" (owner's phone, Oct 14: Start Time
     "Invalid Date" on a day whose start existed three ways). Parse
     every stamp to ms first (numbers pass through, strings go via
     Date.parse); anything unparseable renders '—', never
     "Invalid Date". Display only — what the times MEAN is unchanged:
     start is still endedAt − seconds, end is still endedAt. */
  function stampMs(v) {
    var n = (typeof v === 'number') ? v : Date.parse(v);
    return (typeof n === 'number' && isFinite(n) && n > 0) ? n : null;
  }
  function fmtStamp(v) {
    var ms = stampMs(v);
    return ms === null ? '—' : new Date(ms).toLocaleTimeString();
  }
  function fmtStartOf(s) {
    var e = stampMs(s && s.endedAt);
    if (e === null) return '—';
    var start = e - (parseFloat(s.seconds) || 0) * 1000;
    return start > 0 ? new Date(start).toLocaleTimeString() : '—';
  }
  /* v83: confirmed times print the way the foreman card reads —
     "8:00 AM", "6:30 PM", no seconds (the seconds were the tell
     that the app was printing its own session stamps). */
  function fmtClock(ms) {
    return (ms === null || ms === undefined || !isFinite(ms)) ? '—'
      : new Date(ms).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
  }
  /* v83: a handwritten clock from a ticket ("8:30 AM") placed on
     the manifest's date. Null when the text carries no clock. */
  function clockOnDate(d, text) {
    var m = /(\d{1,2}):(\d{2})\s*([aApP])[mM]/.exec(String(text || ''));
    if (!m) return null;
    var h = parseInt(m[1], 10) % 12;
    if (/p/i.test(m[3])) h += 12;
    var p = String(d).split('-');
    if (p.length !== 3) return null;
    return new Date(+p[0], +p[1] - 1, +p[2], h, parseInt(m[2], 10)).getTime();
  }

  /* v184 (M-route, owner Oct 20 19:55 MDT): WHERE THE TRUCK
     ACTUALLY WENT — from the session GPS trail itself (the
     livemiles breadcrumb record), whether or not the driver ever
     navigated. Crumbs drop only when the truck has moved ≥50 m
     (js/miles.js), so a stop reads as a long, slow segment: two
     consecutive crumbs ≥4 minutes apart and ≤400 m apart mean
     the truck was stopped (or crawling at a site) between them.
     trailStops returns those stops in time order —
     [{t, lat, lng, mins}] — pure, so the suite drives it. */
  /* v191 (MANIFEST-EDIT): apply one day's saved edit (see
     collect's top layer) to the day's {odoEnd, milesIssues} —
     pure, so the suite drives it. No edit → the state back
     untouched with an empty note. */
  function applyDayEdit(state, dayEdit) {
    var out = { odoEnd: state.odoEnd, milesIssues: state.milesIssues, dayNote: '' };
    if (!dayEdit) return out;
    var editEnd = parseFloat(dayEdit.endOdo);
    if (editEnd > 0) {
      out.odoEnd = editEnd;
      out.milesIssues = (state.milesIssues || []).filter(function (s) {
        var se = parseFloat(s && s.endOdo) || 0;
        return se >= editEnd;
      });
    }
    if (typeof dayEdit.note === 'string' && dayEdit.note.trim()) out.dayNote = dayEdit.note.trim();
    return out;
  }

  function trailDistM(a1, o1, a2, o2) {
    var R = 6371000, dLa = (a2 - a1) * Math.PI / 180, dLo = (o2 - o1) * Math.PI / 180;
    var s = Math.sin(dLa / 2) * Math.sin(dLa / 2) +
      Math.cos(a1 * Math.PI / 180) * Math.cos(a2 * Math.PI / 180) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function trailStops(crumbs) {
    if (!crumbs || crumbs.length < 2) return [];
    var cs = crumbs.filter(function (c) { return c && isFinite(c.a) && isFinite(c.o) && c.t > 0; })
      .slice().sort(function (x, y) { return x.t - y.t; });
    var out = [];
    for (var i = 0; i + 1 < cs.length; i++) {
      var dt = cs[i + 1].t - cs[i].t;
      if (dt < 240000) continue;
      var dist = trailDistM(cs[i].a, cs[i].o, cs[i + 1].a, cs[i + 1].o);
      if (dist > 400) continue;
      var last = out[out.length - 1];
      if (last && cs[i].t - last.t <= last.mins * 60000 + 120000 &&
          trailDistM(last.lat, last.lng, cs[i].a, cs[i].o) <= 400) {
        last.mins += Math.round(dt / 60000);
      } else {
        out.push({ t: cs[i].t, lat: cs[i].a, lng: cs[i].o, mins: Math.round(dt / 60000) });
      }
    }
    return out;
  }

  /* v299 (MANIFEST-JARGON-BLOCK, owner, Oct 31, 2026 14:22
     MDT, the essay circled in red on his printed Oct 31
     manifest): "So much of this technical jargon is not
     needed." The v275 day miles accounting — headline,
     untracked stretches, before/after-shift bounds, the
     closing reconciliation — is REMOVED from the manifest
     entirely: collect no longer computes it, neither
     renderer prints it, and no replacement wording takes
     its place. The Day summary keeps the clean facts only:
     the Odometer line, the Miles (live) figure, and the
     GPS distance in the route section. (dayGaps and
     dayMilesAccounting are deleted with it; the stored
     per-session verdicts still ride the record as data,
     unprinted.) */

  /* v190 (M-route home-stops, owner, Oct 21, 2026 07:23 MDT):
     the day's stops start when the truck LEAVES home. His Oct 21
     preview listed two stops AT HOME (51.15710, −113.93860 —
     6:06 AM · 42 min; 6:52 AM · 17 min) as day stops: pre-
     departure at-home time wearing a work stop's clothes. A stop
     within 250 m of the saved Home place is not a work stop:
     dropHomeStops takes such stops out of the route collect()
     returns, so they leave BOTH the on-screen list and the PDF
     (both render collect's routeStops). trailStops itself stays
     pure and untouched — the filter rides collect() only. The
     Home place is the user's own saved favorite named "Home"
     (personal first, then work — the yardstart resolution). No
     Home pin saved → no filtering, nothing invented. */
  function homePin() {
    try {
      var nd = G('nav_data', null) || {};
      var lists = [nd.personal || [], nd.work || []];
      /* v204: the exact name 'home' wins; a place whose name
         carries 'home' as a word ("My Home", "Home" with an
         emoji in the name) is the fallback — v190's exact-only
         read missed such pins entirely, and a missed pin means
         NO filtering: the at-home stops survive onto the list
         (his Oct 21, 2026 10:09 screenshot still showed them). */
      var exact = null, wordy = null;
      for (var i = 0; i < lists.length; i++) {
        for (var j = 0; j < lists[i].length; j++) {
          var p = lists[i][j];
          if (!p || !isFinite(parseFloat(p.lat)) || !isFinite(parseFloat(p.lng))) continue;
          var nm = String(p.name || '').trim().toLowerCase();
          if (nm === 'home' && !exact) exact = { lat: parseFloat(p.lat), lng: parseFloat(p.lng) };
          else if (!wordy && nm.split(/[^a-z0-9]+/).indexOf('home') >= 0) wordy = { lat: parseFloat(p.lat), lng: parseFloat(p.lng) };
        }
      }
      return exact || wordy;
    } catch (e) {}
    return null;
  }
  function dropHomeStops(stops, home) {
    if (!home || !stops || !stops.length) return stops || [];
    return stops.filter(function (s) {
      return !(isFinite(s.lat) && isFinite(s.lng)) ||
        trailDistM(s.lat, s.lng, home.lat, home.lng) > 250;
    });
  }

  /* v204 (MANIFEST-NAMES, owner, Oct 21, 2026 10:09 MDT — the
     same screenshot: "Stop — 51.15710, -113.93860"): a stop at a
     place the app KNOWS shows that place's NAME, not raw
     coordinates. Candidates — the nearest within 250 m wins:
     his saved places (nav_data personal + work), the built-in
     pits (the Navigation module's list), and the dump sites of
     learned load<->dump pairs (geoload_pairs) that carry a
     label. A place the app has never seen resolves to '' and
     the renderers keep the coordinates (honest) — and a worked
     place stops being unseen: the day's own machinery learns
     its sites as pairs (v203), and a named save is one tap in
     the Navigator. Screen list and PDF both render collect's
     routeStops labels, so one resolution serves both. */
  /* v299 (MANIFEST-WRONG-PLACE-NAME, owner, Oct 31, 2026
     14:24–14:26 MDT): the v204 pool was ONE nearest-wins race
     across every source — so on Oct 31 a built-in pit pin
     ("Maple Ridge", a few hundred metres off the site) named
     his Remington arrival stop, and a learned pair label
     ("Nitestar") named the Petro at Road King fuel stop,
     even though HIS saved names covered both grounds. His
     law: names on the manifest are the DRIVER'S OWN names.
     The pool is now TIERED — tier 1 is his own saved places
     (nav_data personal + work); only when none of his sits
     within 250 m do the built-in pits and the learned pair
     labels get a say (nearest within 250 m, as before). */
  function placeNameFor(lat, lng) {
    if (!isFinite(lat) || !isFinite(lng)) return '';
    function nearest(consider) {
      var best = '', bestD = 250;
      consider(function (name, la, lo) {
        if (!name || !isFinite(la) || !isFinite(lo)) return;
        var d = trailDistM(lat, lng, la, lo);
        if (d <= bestD) { bestD = d; best = String(name); }
      });
      return best;
    }
    var mine = nearest(function (consider) {
      try {
        var nd = G('nav_data', null) || {};
        [nd.personal || [], nd.work || []].forEach(function (list) {
          list.forEach(function (p) { if (p) consider(p.name, parseFloat(p.lat), parseFloat(p.lng)); });
        });
      } catch (e) {}
    });
    if (mine) return mine;
    return nearest(function (consider) {
      try {
        var nav = window.Meticulous && Meticulous.modules && Meticulous.modules.navigation;
        if (nav && typeof nav.builtinPlaces === 'function') {
          nav.builtinPlaces().forEach(function (p) { if (p) consider(p.name, parseFloat(p.lat), parseFloat(p.lng)); });
        }
      } catch (e) {}
      try {
        var pairs = (G('geoload_pairs', {}) || {}).pairs || {};
        Object.keys(pairs).forEach(function (k) {
          var pr = pairs[k];
          if (pr && pr.dump) consider(pr.dump.label, parseFloat(pr.dump.lat), parseFloat(pr.dump.lng));
        });
      } catch (e) {}
    });
  }

  /* v299 (MANIFEST-WRONG-PLACE-NAME, the navigation half,
     owner, Oct 31, 2026 14:26 MDT): "I use my GPS to go to
     it in the morning" — when he NAVIGATED to a place that
     day, the app already knows that ground's name from his
     own hand: the Navigator records every Navigate tap in
     nav_data.recent with the destination's name and pin
     (the same record the peg counter reads for its dump
     candidate). The day's destinations are the strongest
     name truth there is — a stop at one takes the
     DESTINATION's name, ahead of saved-place proximity and
     every learned label. Nearest of today's destinations
     within radiusM wins (the door that names a stop uses a
     wider radius than the door that names a peg: a stop's
     cluster centroid can sit a few hundred metres from the
     pin he drove to). */
  function navRecentName(lat, lng, dayStr, radiusM) {
    if (!isFinite(lat) || !isFinite(lng) || !dayStr) return '';
    var best = '', bestD = radiusM || 250;
    try {
      var nd = G('nav_data', null) || {};
      (nd.recent || []).forEach(function (r) {
        if (!r || !r.name || !isFinite(+r.ts)) return;
        var la = parseFloat(r.lat), lo = parseFloat(r.lng);
        if (!isFinite(la) || !isFinite(lo)) return;
        var dt = new Date(+r.ts);
        var ds = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
        if (ds !== dayStr) return;
        var d = trailDistM(lat, lng, la, lo);
        if (d <= bestD) { bestD = d; best = String(r.name); }
      });
    } catch (e) {}
    return best;
  }

  /* v299 (PEG-IS-THE-DAYS-TRUTH, owner, Oct 31, 2026
     14:28 MDT): "App should have been able to tell that
     was my dump site for the day." A peg's place resolves
     with navigation truth FIRST — this morning he pegged
     the dump at the place he calls Dog Park, a place he
     had navigated to; the peg sits a few metres from that
     destination pin, and the destination's name is the
     peg's name. Only a peg he never navigated to falls
     back to the (now tiered) place pool. */
  function pegNameFor(lat, lng, dayStr) {
    return navRecentName(lat, lng, dayStr, 250) || placeNameFor(lat, lng);
  }

  /* v283 (MANIFEST-PEG-PLACES, owner, Oct 29, 2026 14:26 MDT:
     "make sure these peg pickups and peg dumps are gonna go on
     the manifest — as where it's being loaded and where it's
     being dumped"). A peg day (v282) knows exactly where the
     truck loaded and dumped — the driver declared both spots —
     and the manifest now SAYS them. Each role's pegged places
     resolve through placeNameFor (the same resolver the route
     stops use); a peg at a place the app has never seen prints
     its peg TIME instead ("Pegged pickup — 2:14 PM"). A peg's
     coordinates NEVER print. Mid-day re-pegs: every DISTINCT
     place per role, in the order pegged — a place is itself
     again by name, and an unnamed place is itself again within
     the peg counter's own 30 m (a stopped truck re-tapped on
     the same ground is one place, however the scatter moved).
     Peg moves logged before v283 carry no position; those days
     resolve from the day's final pegs — no place is invented
     for a move whose spot was never recorded. Days without
     pegs: null, and both renderers print exactly what they
     printed before.
     v284 (PEGS-SEEDS-NOT-FENCES): the pegs are seeds and the
     spots drift, so the day's COUNTED events (geoDay.pegEvents —
     every confirmed pickup and counted dump, with where it
     happened) ride the same per-role sequence, merged by time:
     the seed's place first, then each distinctly-named place
     the work actually moved into, in order. An event at a place
     the app has never seen prints its event time ("Loaded —
     3:05 PM"); same distinctness rules as the pegs (by name,
     or within 30 m unnamed). Days recorded before v284 carry
     no pegEvents and render exactly as v283 left them. */
  function pegPlaceLabels(geoDay, dayStr) {
    if (!geoDay || !geoDay.pegs) return null;
    var cur = geoDay.pegs;
    var log = Array.isArray(geoDay.pegLog) ? geoDay.pegLog : [];
    function sequence(kind, word) {
      var pos = [];
      log.forEach(function (e) {
        if (e && e.kind === kind && isFinite(e.lat) && isFinite(e.lng)) {
          pos.push({ lat: +e.lat, lng: +e.lng, t: +e.t || 0, fb: 'Pegged ' + word });
        }
      });
      /* v284: the day's counted events ride the same sequence —
         where this role's work actually happened as its centre
         drifted from the seed. */
      var evs = Array.isArray(geoDay.pegEvents) ? geoDay.pegEvents : [];
      evs.forEach(function (e) {
        if (e && e.kind === kind && isFinite(e.lat) && isFinite(e.lng)) {
          pos.push({ lat: +e.lat, lng: +e.lng, t: +e.t || 0, fb: kind === 'load' ? 'Loaded' : 'Dumped' });
        }
      });
      var c = cur[kind];
      if (c && isFinite(c.lat) && isFinite(c.lng)) {
        var ct = +c.t || 0, seen = false;
        for (var i = 0; i < pos.length; i++) {
          if (pos[i].t === ct &&
              trailDistM(pos[i].lat, pos[i].lng, +c.lat, +c.lng) <= 1) { seen = true; break; }
        }
        if (!seen) pos.push({ lat: +c.lat, lng: +c.lng, t: ct, fb: 'Pegged ' + word });
      }
      pos.sort(function (a, b) { return a.t - b.t; });
      return pos;
    }
    function labels(kind, word) {
      var named = [], unnamed = [], out = [];
      sequence(kind, word).forEach(function (p) {
        /* v299: a peg resolves navigation-first (pegNameFor) —
           the destination he drove to that morning outranks
           the place pool for the ground he pegged. */
        var name = pegNameFor(p.lat, p.lng, dayStr);
        if (name) {
          if (named.indexOf(name) !== -1) return;
          named.push(name); out.push(name);
          return;
        }
        for (var i = 0; i < unnamed.length; i++) {
          if (trailDistM(unnamed[i].lat, unnamed[i].lng, p.lat, p.lng) <= 30) return;
        }
        unnamed.push(p);
        out.push(p.fb + ' — ' + fmtClock(p.t > 0 ? p.t : null));
      });
      return out;
    }
    var load = labels('load', 'pickup'), dump = labels('dump', 'dump');
    if (!load.length && !dump.length) return null;
    return { load: load, dump: dump };
  }

  /* v87: ONE Odometer line for the day (owner, Oct 15: there were
     "no Odos on the manifest either… even though I gave you the
     starting and ending" — his own sheet carries the pair every
     day). Start → end with the day's km between them:
     "168,759 → 168,926 km (167 km)". An end that was never
     captured is SAID ("end not recorded"), never invented.
     v122: no captures at all → this TEXT is null, and both
     renderers print "no readings captured" in its place when
     the section is ON — the line is never silently omitted
     again. Replaces the separate Start/End Odometer lines. */
  function odoLineText(c) {
    if (!c || (c.odoStart === null && c.odoEnd === null)) return null;
    var fmt = function (v) { return Number(v).toLocaleString('en-CA'); };
    if (c.odoStart !== null && c.odoEnd !== null) {
      var km = Math.round((c.odoEnd - c.odoStart) * 10) / 10;
      return fmt(c.odoStart) + ' → ' + fmt(c.odoEnd) + ' km' + (km >= 0 ? ' (' + km + ' km)' : '');
    }
    if (c.odoStart !== null) return fmt(c.odoStart) + ' km → end not recorded';
    return 'start not recorded → ' + fmt(c.odoEnd) + ' km';
  }

  function collect(d) {
    /* v153: the printed set files a dispatch the way dayDsp
       below (v83) already does — scheduledAt's date wins over
       the raw stored date. collect used to filter on the raw
       date alone, so one manifest could carry a dispatch in
       its times (dayDsp) yet miss it in its printed lines. */
    var dispatches = (G('dsp_list', [])).filter(function (x) {
      if (!x) return false;
      var sd = '';
      if (typeof x.scheduledAt === 'string') {
        var mm = /^(\d{4}-\d{2}-\d{2})/.exec(x.scheduledAt);
        if (mm) sd = mm[1];
      }
      return (sd || x.date) === d;
    });
    var navLog = (G('nav_log', [])).filter(function (x) { return x.at.slice(0, 10) === d; });
    var fills = (G('fuel_fills', [])).filter(function (x) { return x.date === d; });
    var expenses = (G('fuel_expenses', [])).filter(function (x) { return x.date === d; });
    var incidents = (G('dmg_reports', [])).filter(function (x) { return x.at.slice(0, 10) === d; });
    var sessions = (G('sessions', [])).filter(function (x) { return x.date === d; });
    /* v355 (SPLIT-SHIFT): the day's named route stops, carried on
       its split sessions (app.js stopSessionAt) in the order
       driven — NAMES ONLY (never coordinates); a stop skipped for
       the day rides flagged so the record can show it as skipped,
       in the driver's word, never "missed". */
    var splitStops = [], splitBlocks = [];
    sessions.forEach(function (s) {
      if (!s || !s.split) return;
      (s.splitStops || []).forEach(function (st) {
        if (st && st.name) splitStops.push({ key: st.key || '', name: String(st.name), at: st.at || 0, skipped: !!st.skipped });
      });
      (s.splitBlocks || []).forEach(function (b) { if (b) splitBlocks.push(b); });
    });
    var revEntries = (G('rev_entries', [])).filter(function (x) { return x.date === d; });
    var extras = (G('rev_extras', [])).filter(function (x) { return x.date === d; });
    var o = G('onboarding', {});
    /* v242 (WORK-PROFILES): the day prices at the rate of the
       profile the day belongs to — the day's own stamped records
       (its dispatch first, then its session, then its revenue
       entry) say which. A day with no stamped record prices at
       the wage chain, exactly as before. */
    var dayPid = null;
    [dispatches, sessions, revEntries].forEach(function (arr) {
      (arr || []).forEach(function (r) { if (!dayPid && r && r.profileId) dayPid = String(r.profileId); });
    });
    var wpDayRate = 0;
    try { if (dayPid && window.App && App.workProfiles) wpDayRate = App.workProfiles.rateOf(dayPid); } catch (e) {}
    var rate = wpDayRate > 0 ? wpDayRate : (parseFloat(o.ownWageRate) || parseFloat(o.payRate) || 0), earned = 0; // v137: the user's own wage chain
    /* v107 — ONE MONEY TRUTH: the day's earned is priced by the
       SAME shared per-day builder the invoice and Revenue use
       (Meticulous.shared.buildRevenueLines), computed below once
       the day's records are assembled. The raw sum that stood here
       priced every entry at qty × rate and stacked Oct 16's
       tracker session ($282.75) on top of its closed dispatch
       ($319.00), printing $601.75 for a $319.00 day. */
    var startT = sessions.length ? fmtStartOf(sessions[0]) : '—';
    var endT = sessions.length ? fmtStamp(sessions[sessions.length - 1].endedAt) : '—';
    /* v40: the day's odometer readings live on the session entries
       (by-mile day photos, v39), and so do live miles + the miles
       reconciliation verdict (js/miles.js). First start reading and
       last end reading of the day win; live miles sum across sessions. */
    /* v50: GPS/geofence load counting for the day (js/geoloads.js) —
       count + dump events + the site pair used, or the reason counting
       could not run. v291: the record itself no longer prints as a
       block on the manifest — it feeds the ONE loads line (through
       the ladder, and as the peg count of record on a peg day) and
       the day's place names. */
    var geoDay = ((G('geoloads', { days: {} }).days) || {})[d] || null;
    /* v283 (MANIFEST-PEG-PLACES): the day's pegged loading /
       dumping places, by name — see pegPlaceLabels. Null on
       days the driver never pegged. */
    var pegPlaces = pegPlaceLabels(geoDay, d);
    var odoStart = null, odoEnd = null, liveKm = 0, liveKmAny = false, milesIssues = [];
    /* v206 (P1-odo-prompt-photo): the dash photos that came WITH
       the readings ride the same sessions (startPhoto / endPhoto)
       — the preview hangs their download doors on the Odometer
       line. A photo follows ITS reading: start photo from the
       session that gave the start reading, end photo from the
       one that gave the (last) end reading. */
    var odoStartPhoto = null, odoEndPhoto = null;
    /* v299 (MANIFEST-ODO-START-DAY, owner, Oct 31, 2026 14:22
       MDT): Oct 31's Odometer line opened at 170,664 — Oct 30's
       PRE-trip reading — while the day's own driving session
       started at 170,749 (its pre-trip PTI) and the true span
       was 202 km, not the printed 287. Proven chain: the loop
       below took the first session entry carrying a startOdo,
       and a non-driving FRAGMENT session ahead of the real one
       in the stored array carried a stale snapshot of the
       tracker odometer (written before the morning's PTI
       refreshed it) — the v275 accounting's own bounds math
       convicts it (boundsBefore = driveStart − odoStart printed
       as 85.x km = exactly 170,749 − 170,664). A day's odometer
       span now opens at the earliest startOdo among the day's
       DRIVING sessions (liveKm ≥ 1 km — the v275 "real driving
       session" test, so yard crawls and tracker restarts never
       pose as the day's drive); the first-session rule remains
       only as the fallback for a day nothing drove. The end
       reading is unchanged: the last endOdo of the day. */
    var driveStartCand = null, driveStartPhoto = null;
    sessions.forEach(function (s) {
      if (odoStart === null && s.startOdo) { odoStart = s.startOdo; if (s.startPhoto) odoStartPhoto = s.startPhoto; }
      if (s.endOdo) { odoEnd = s.endOdo; if (s.endPhoto) odoEndPhoto = s.endPhoto; }
      if (typeof s.liveKm === 'number') { liveKm += s.liveKm; liveKmAny = true; }
      if (s.milesStatus === 'discrepancy' && s.milesReport) milesIssues.push(s);
      if (typeof s.liveKm === 'number' && s.liveKm >= 1 && s.startOdo > 0 &&
          (driveStartCand === null || s.startOdo < driveStartCand)) {
        driveStartCand = s.startOdo;
        driveStartPhoto = s.startPhoto || null;
      }
    });
    if (driveStartCand !== null) { odoStart = driveStartCand; odoStartPhoto = driveStartPhoto; }
    /* v69: a session still RUNNING (or paused) has NO saved entry —
       entries are only written at STOP (app.js stopSessionAt) — so a
       manifest read from saved entries alone shows Start Time "—"
       all day while the truck is working (owner, Oct 14: "end time
       missing is fine mid-day, but why no start time?"). Consult the
       live tracker the same way Revenue's liveSession() does: the
       running session's start is now − its live seconds (identical
       math to how the saved entry's start is later derived as
       endedAt − seconds, so the mid-day preview and the stopped
       record agree). End stays honestly open; a by-mile start
       odometer captured at session start is still pending on the
       tracker (app.js odoStart) and belongs in the preview too. */
    var live = null;
    try {
      var trk = (window.App && App.tracker) || G('tracker', null);
      if (d === App._today() && trk && (trk.status === 'running' || trk.status === 'paused')) {
        var lsec = trk.elapsed || 0;
        if (trk.status === 'running') lsec += Math.floor((Date.now() - (trk.startTs || Date.now())) / 1000);
        if (lsec > 0) {
          var lStartMs = Date.now() - lsec * 1000;
          var lStart = new Date(lStartMs);
          var lDateStr = lStart.getFullYear() + '-' + ('0' + (lStart.getMonth() + 1)).slice(-2) + '-' + ('0' + lStart.getDate()).slice(-2);
          live = { status: trk.status, startMs: lStartMs, startOdo: null };
          if (trk.odoStart && trk.odoStart.date === lDateStr &&
              trk.odoStart.value !== null && trk.odoStart.value !== undefined && trk.odoStart.value !== '') {
            live.startOdo = trk.odoStart.value;
            live.startPhoto = trk.odoStart.photo || null;
          }
        }
      }
    } catch (e) { live = null; }
    if (live) {
      if (!sessions.length) startT = fmtStamp(live.startMs);
      endT = (live.status === 'running') ? 'Still working' : 'Paused';
      if (odoStart === null && live.startOdo !== null) { odoStart = live.startOdo; if (live.startPhoto) odoStartPhoto = live.startPhoto; }
      live.hours = lsec / 3600;
    }
    /* v87: with no session start reading, the day's earliest
       odo-bearing record stands in for the start (a fuel fill's
       reading is the usual one — the driver typed the dash at the
       pump). Odometer readings only move up, so the day's
       smallest fill reading is its earliest capture. A mid-day
       fill NEVER becomes the day's END: the end is the closing
       reading (a session endOdo above) or it is honestly absent
       and the line says "end not recorded". */
    if (odoStart === null) {
      var fillOdos = [];
      fills.forEach(function (x) { var v = parseFloat(x && x.odo); if (v > 0) fillOdos.push(v); });
      if (fillOdos.length) odoStart = Math.min.apply(null, fillOdos);
    }
    /* v83: the day's dispatch records, matched the way the rest of
       the app files a dispatch — scheduledAt's date wins (a
       dispatch saved the evening before FOR today is today's,
       whatever its raw date field says). */
    var dayDsp = (G('dsp_list', [])).filter(function (x) {
      if (!x) return false;
      var sd = '';
      if (typeof x.scheduledAt === 'string') {
        var mm = /^(\d{4}-\d{2}-\d{2})/.exec(x.scheduledAt);
        if (mm) sd = mm[1];
      }
      return (sd || x.date) === d;
    });
    /* v83: START / END ARE HIS TIMES, NOT THE APP'S (owner, Oct 15:
       the manifest printed the tracker session's 8:00:01 AM /
       6:02:43 PM while his foreman card #21314 said start 8:00,
       finish 6:30 PM — "Should be what my actual close time and
       start time was! Not what the app thought!"). The session
       figures computed above survive ONLY as a fallback, and the
       renderers label them as tracker times whenever they are
       what shows (startSrc / endSrc). Confirmed priority —
       START: a ticket's own start clock, then the dispatch's
       scheduled start, then its started stamp.
       END (once a dispatch for the day is completed): a ticket's
       finish clock, then the card finish DERIVED as the scheduled
       start + the tickets' foreman hours (the card's handwritten
       finish is never OCR-read — start + hours is the same fact:
       8:00 + 10.5h = 6:30 PM), then the record's endedAt, the
       moment he himself tapped Close. */
    var startSrc = (sessions.length || live) ? 'tracker' : '', endSrc = sessions.length ? 'tracker' : '';
    var dspStartMs = null, dspEndMs = null, cardEndMs = null, tkStartMs = null, tkEndMs = null, anyCompleted = false;
    dayDsp.forEach(function (x) {
      var schMs = (typeof x.scheduledAt === 'string') ? Date.parse(x.scheduledAt) : NaN;
      var stMs = stampMs(x.startedAt);
      var cand = isFinite(schMs) ? schMs : stMs;
      if (cand !== null && isFinite(cand) && (dspStartMs === null || cand < dspStartMs)) dspStartMs = cand;
      if (x.status === 'completed') {
        anyCompleted = true;
        var eMs = stampMs(x.endedAt);
        if (eMs !== null && (dspEndMs === null || eMs > dspEndMs)) dspEndMs = eMs;
      }
      (x.tickets || []).forEach(function (tk) {
        if (!tk) return;
        var s2 = clockOnDate(d, tk.startTime);
        if (s2 !== null && (tkStartMs === null || s2 < tkStartMs)) tkStartMs = s2;
        var f2 = clockOnDate(d, tk.finishTime);
        if (f2 !== null && (tkEndMs === null || f2 > tkEndMs)) tkEndMs = f2;
      });
    });
    if (tkStartMs !== null) { startT = fmtClock(tkStartMs); startSrc = 'card'; }
    else if (dspStartMs !== null) { startT = fmtClock(dspStartMs); startSrc = 'dispatch'; }
    /* a live session means the day has not ended — the live block's
       "Still working" stands; confirmed ends apply to closed days */
    if (!live) {
      /* v118: the CARD's finish — a ticket's read finish clock OR
         the finish derived from start + foreman hours, whichever
         the card itself supports (the later of the two; they are
         the same fact stated two ways) — competes with the
         SESSION's real end, and the LATER one is the day's end.
         v107 ran that competition only for the DERIVED finish;
         a ticket carrying a READ finishTime short-circuited it,
         which is why the owner's real Oct 16 still printed the
         card's 6:00 PM while his fixture (no finishTime on its
         tickets) passed: his real card's finish WAS read, and his
         session ran to 7:00 PM at home. Oct 15 stays the card's
         6:30 PM — its session ended 6:02 PM, earlier. The dispatch
         record's endedAt (the close tap) remains only the fallback
         for a completed day with neither a card end nor a session
         end (Oct 15's 7:04 PM close stamp must never compete). */
      var sessEndMs = null;
      sessions.forEach(function (s) {
        var m2 = stampMs(s.endedAt);
        if (m2 !== null && (sessEndMs === null || m2 > sessEndMs)) sessEndMs = m2;
      });
      var derivedEndMs = null;
      if (anyCompleted && dspStartMs !== null && window.TicketOCR && TicketOCR.summarizeTickets) {
        var fh = 0;
        dayDsp.forEach(function (x) {
          if (x.status === 'completed') fh += TicketOCR.summarizeTickets(x.tickets || [], 0).totalForemanHours || 0;
        });
        if (fh > 0) derivedEndMs = dspStartMs + fh * 3600000;
      }
      var cardEndMs2 = tkEndMs;
      if (derivedEndMs !== null && (cardEndMs2 === null || derivedEndMs > cardEndMs2)) cardEndMs2 = derivedEndMs;
      if (cardEndMs2 !== null) {
        if (sessEndMs !== null && sessEndMs > cardEndMs2) {
          endT = fmtClock(sessEndMs); endSrc = 'tracker';
        } else {
          cardEndMs = cardEndMs2; endT = fmtClock(cardEndMs); endSrc = 'card';
        }
      } else if (dspEndMs !== null) {
        /* no card end to compete: his own close tap is the most
           deliberate end stamp the day has, ahead of a bare
           session end (v83 priority, pinned by manifest-times). */
        endT = fmtClock(dspEndMs); endSrc = 'dispatch';
      }
      /* else: the session end already sits in endT/endSrc. */
    }

    /* v122: THE DATED READINGS LOG fills the boundaries the
       session entries never got. The owner's real flow closes the
       day by completing the dispatch and saves the dash reading
       at night on the Maintenance card — neither writes a session
       startOdo/endOdo, so before v122 the Odometer line silently
       vanished even with the section ON (Oct 17 root cause).
       Every master-odometer write now appends to odo_readings
       (js/app.js logOdoReading); here the log only FILLS what
       the session/fill logic above left missing:
         start(D) = the LAST reading at or before the day's work
           start (ticket start, else dispatch start, else session
           start, else the day's first moment);
         end(D) = a reading inside the day's closing window
           (v246: the last reading stamped on day D at/after an
           hour before the day's end — session end, else the
           dispatch close; never another day's reading).
       A mid-day reading sits strictly between the anchors and
       qualifies for NEITHER — it is never promoted to the day's
       end (the v87 honesty rule stands). */
    (function () {
      if (odoStart !== null && odoEnd !== null) return;
      var rl = G(wpOdoLogKey(dayPid), []);
      if (!Array.isArray(rl) || !rl.length) return;
      var readings = [];
      rl.forEach(function (r) {
        var v = parseFloat(r && r.value);
        var ts = (r && typeof r.ts === 'number') ? r.ts : Date.parse(r && r.ts);
        if (v > 0 && typeof ts === 'number' && isFinite(ts)) readings.push({ ts: ts, value: v });
      });
      if (!readings.length) return;
      readings.sort(function (a, b) { return a.ts - b.ts; });
      var dp = String(d).split('-');
      var dayStartMs = (dp.length === 3) ? new Date(+dp[0], +dp[1] - 1, +dp[2]).getTime() : null;
      var sessStartMs = null, sessEndMs2 = null;
      sessions.forEach(function (s) {
        var e2 = stampMs(s.endedAt);
        if (e2 !== null) {
          var st2 = e2 - (parseFloat(s.seconds) || 0) * 1000;
          if (sessStartMs === null || st2 < sessStartMs) sessStartMs = st2;
          if (sessEndMs2 === null || e2 > sessEndMs2) sessEndMs2 = e2;
        }
      });
      if (odoStart === null) {
        var startAnchor = (tkStartMs !== null) ? tkStartMs
          : (dspStartMs !== null) ? dspStartMs
          : (sessStartMs !== null) ? sessStartMs
          : (live ? live.startMs : dayStartMs);
        if (startAnchor !== null && startAnchor !== undefined) {
          for (var i = readings.length - 1; i >= 0; i--) {
            if (readings[i].ts <= startAnchor) { odoStart = readings[i].value; break; }
          }
        }
      }
      if (odoEnd === null && !live) {
        var endAnchor = (sessEndMs2 !== null) ? sessEndMs2 : dspEndMs;
        /* v246 (MANIFEST-ODO-END-WRONG): the end fill reads the
           day's OWN readings only, inside the day's closing
           window. The old window reached two days forward, so
           Oct 22 — whose last session fragment ended 17:30 —
           printed 170,117, the NEXT MORNING's reading, over
           the day's actual close (170,079, the 17:21 post-trip
           PTI). The closing captures (the post-trip inspection,
           the night dash save) land in the day's last hour; the
           administrative closes that anchor the window (the
           tracker stop, the dispatch close tap) trail them by
           minutes, never hours. A reading hours before the
           end stays what v122/v87 made it: mid-day evidence,
           never the close (manifest-odo case i). The LAST
           reading inside the window is the closing master
           reading — the master chain's end-of-day value. */
        if (endAnchor !== null) {
          var winStart = endAnchor - 3600000;
          for (var j = 0; j < readings.length; j++) {
            if (readings[j].ts < winStart) continue;
            var rdJ = new Date(readings[j].ts);
            var rsJ = rdJ.getFullYear() + '-' + ('0' + (rdJ.getMonth() + 1)).slice(-2) + '-' + ('0' + rdJ.getDate()).slice(-2);
            if (rsJ !== d) continue;
            if (odoStart !== null && readings[j].value < odoStart) continue;
            odoEnd = readings[j].value;
          }
        }
      }
    })();

    /* v177 (D2, owner Oct 20, 2026): ONE ODOMETER FACT, APP-WIDE.
       A verified reading captured anywhere on the day (a fuel
       receipt read, a PTI, a dash photo in the readings log) is
       the day's truth — it outranks a stale boundary the session
       closed with. Oct 19: the fill carried 169,531 (17:15) yet
       the Preview read 169,300 → 169,300 (0 km) because the
       session's endOdo held the morning's stale 169,300 and the
       v122 log pass only fills MISSING boundaries. Here: the
       day's highest verified reading becomes the day's end when
       it beats the standing end, and a stored miles-discrepancy
       verdict computed against that stale end is dropped — the
       warning must never indict a day the readings clear. */
    (function () {
      var dayMax = null;
      fills.forEach(function (x) {
        var v = parseFloat(x && x.odo);
        if (v > 0 && (dayMax === null || v > dayMax)) dayMax = v;
      });
      try {
        (G(wpOdoLogKey(dayPid), []) || []).forEach(function (r) {
          var v = parseFloat(r && r.value);
          var ts = (r && typeof r.ts === 'number') ? r.ts : Date.parse(r && r.ts);
          if (!(v > 0) || !isFinite(ts)) return;
          var rd = new Date(ts);
          var rs = rd.getFullYear() + '-' + ('0' + (rd.getMonth() + 1)).slice(-2) + '-' + ('0' + rd.getDate()).slice(-2);
          if (rs === d && (dayMax === null || v > dayMax)) dayMax = v;
        });
      } catch (e) {}
      /* The v87 honesty rule stands untouched: a MISSING end
         stays missing ("end not recorded") — this pass only
         corrects an end that EXISTS but is stale (at or below
         the day's start while a higher verified reading from
         the same day sits in the records). */
      if (dayMax !== null && odoStart !== null && odoEnd !== null &&
          dayMax > odoEnd && dayMax > odoStart) {
        odoEnd = dayMax;
        milesIssues = milesIssues.filter(function (s) {
          var se = parseFloat(s && s.endOdo) || 0;
          return se >= dayMax;
        });
      }
    })();

    /* v107: earned, from the shared builder (see the note at the
       top of collect). The live session mirrors Revenue's rule
       exactly: it adds only on a day no confirmed line speaks
       for, and never on a duplicate-flagged day. Without the
       builder (a partial load), fall back to the legacy raw sum. */
    (function () {
      var built = null;
      try {
        if (window.Meticulous && Meticulous.shared && Meticulous.shared.buildRevenueLines) {
          built = Meticulous.shared.buildRevenueLines(revEntries, extras, rate, String(o.payStandard || '').toLowerCase(), G('pnl_card_wages', []) || []);
        }
      } catch (e) { built = null; }
      if (built) {
        var confirmedDay = false;
        built.lines.forEach(function (l) {
          earned += Number(l.amt) || 0;
          if (l.src === 'dispatch' || l.src === 'entry') confirmedDay = true;
        });
        var dupDay = (built.duplicateDates || []).indexOf(d) >= 0;
        if (live && !confirmedDay && !dupDay && String(o.payStandard || '').toLowerCase() === 'hourly') {
          earned += (live.hours || 0) * rate;
        }
        earned = Math.round(earned * 100) / 100;
      } else {
        revEntries.forEach(function (e) {
          if (o.payStandard === 'Hourly') earned += (parseFloat(e.hours) || 0) * rate;
          else if (o.payStandard === 'Miles') earned += (parseFloat(e.miles) || 0) * rate;
          else if (o.payStandard === 'Trip') earned += (parseFloat(e.trips) || 0) * rate;
          else if (o.payStandard === 'Weight') earned += (parseFloat(e.tons) || 0) * rate;
        });
        extras.forEach(function (x) { earned += parseFloat(x.amount) || 0; });
      }
    })();

    /* v82 (item 3b): the day's LOADS — the count the driver himself
       confirmed, which the manifest never had (its only loads line
       was the GPS cross-check, and the GPS counter cannot run when
       the dump site is given out loud on site — so a full day of
       hauling printed Loads 0).
       v107: the priority itself now lives in ONE shared place —
       Meticulous.shared.dayLoads (modules/invoice.js) — so the
       manifest and Revenue can never disagree about a day's
       loads: tickets → deliberately recorded dispatch loads
       (loadsSet; the form's untouched default '1' still cannot
       prove a count) → +1 taps (saved + live) → Weight count →
       learned-site count. The v82 inline ladder remains as the
       fallback for a build where the shared helper didn't load. */
    var loads = 0, loadsSrc = '';
    var liveTapLoads = 0;
    try {
      var trk2 = (window.App && App.tracker) || G('tracker', null);
      if (d === App._today() && trk2 && trk2.accum && (trk2.status === 'running' || trk2.status === 'paused')) {
        liveTapLoads = parseInt(trk2.accum.manualLoads, 10) || 0;
      }
    } catch (e) {}
    if (window.Meticulous && Meticulous.shared && Meticulous.shared.dayLoads) {
      var dl = Meticulous.shared.dayLoads(d, {
        dispatches: dayDsp, sessions: sessions, liveTaps: liveTapLoads,
        geoLoads: geoDay ? geoDay.count : 0
      });
      loads = dl.loads; loadsSrc = dl.source;
    } else {
      var tkLoads = 0;
      dayDsp.forEach(function (x) {
        (x.tickets || []).forEach(function (tk) {
          var v = parseFloat(tk && tk.loads);
          if (v > 0) tkLoads += v;
        });
      });
      if (tkLoads > 0) { loads = tkLoads; loadsSrc = 'tickets'; }
      if (!loads && geoDay && geoDay.count > 0) { loads = geoDay.count; loadsSrc = 'sites'; } /* v140: same ladder as the shared helper — movement count above taps */
      if (!loads) {
        var tapLoads = liveTapLoads;
        sessions.forEach(function (s) { tapLoads += parseInt(s.manualLoads, 10) || 0; });
        if (tapLoads > 0) { loads = tapLoads; loadsSrc = 'taps'; }
      }
      if (!loads) {
        var wLoads = 0;
        sessions.forEach(function (s) { wLoads += parseInt(s.loadCount, 10) || 0; });
        if (wLoads > 0) { loads = wLoads; loadsSrc = 'weight'; }
      }
    }
    /* v291 (MANIFEST-LOADS-SUMMARY, owner Oct 30, 2026 17:28
       MDT): on a PEG day the manifest's loads figure IS the
       peg count — the count of record the dashboard showed
       all day ("Loads today: 17 counted from your pegs") =
       the geoloads record's count + the driver's correction,
       the same figure GeoLoads.forDate()/today() carry. His
       Oct 30 manifest instead printed the ladder's 20 (a
       ticket rung) over a separate GPS block's raw 19, while
       his day was 17. Presentation only: the counting
       engines and the shared dayLoads ladder (invoice /
       Revenue) are untouched — this collect feeds the
       manifest alone (and the documents Connect ships from
       it, which are the driver's own manifest by law). */
    if (geoDay && geoDay.countSource === 'pegs') {
      var pegCount = Math.max(0, (parseInt(geoDay.count, 10) || 0) + (parseInt(geoDay.corr, 10) || 0));
      if (pegCount > 0) { loads = pegCount; loadsSrc = 'pegs'; }
    }
    /* v291: the ONE site name the loads line may carry — the
       day's work place BY NAME, never coordinates, never a
       generic placeholder: a peg day names its dump peg's
       place (its load peg's when the dump peg sits somewhere
       unnamed); any other counted day names the counted
       pair's dump place when the record carries a real name
       for it. No name on record → the line carries the
       count alone; nothing is invented. */
    var loadsSite = '';
    if (geoDay && geoDay.pegs) {
      if (geoDay.pegs.dump) loadsSite = placeNameFor(geoDay.pegs.dump.lat, geoDay.pegs.dump.lng) || '';
      if (!loadsSite && geoDay.pegs.load) loadsSite = placeNameFor(geoDay.pegs.load.lat, geoDay.pegs.load.lng) || '';
    }
    if (!loadsSite && geoDay && geoDay.sites && geoDay.sites.dump) {
      var dspLabel = geoDay.sites.dump.label || '';
      if (dspLabel && ['Load site', 'Dump site', 'Load peg', 'Dump peg', 'Pickup peg'].indexOf(dspLabel) === -1) loadsSite = dspLabel;
    }
    /* v184 (M-route): the day's actual travel from the session
       GPS trail (livemiles crumbs for this date — navigation is
       NOT the gate; the trail exists from driving itself). Stop
       names come only from facts on record: the day's GPS site
       pair (within 200 m) or a navigation entry at that time;
       anything else prints as its coordinates — never a guessed
       name. */
    /* v275: ONE label chain for every point of the day's trail
       — a stop, the route's start, the route's end.
       v299 (MANIFEST-WRONG-PLACE-NAME + MANIFEST-PEG-NAMES +
       PEG-IS-THE-DAYS-TRUTH, owner, Oct 31, 2026 14:24–14:28
       MDT): the chain is re-ordered around the day's OWN
       truths, because Oct 31's chain named his Remington
       arrival "Maple Ridge" (a built-in pit in the place
       pool) and his fuel stop "Nitestar" (a learned label),
       and named every peg stop with the bare words "Pickup
       peg" / "Dump peg". The doors now run:
         1. the day's PEGS (within 200 m) — a stop at a peg IS
            that peg's site, named by the peg's own place
            (navigation-first: pegNameFor);
         2. the day's counted SITES carrying a REAL label —
            a generic label ('Load site', 'Dump site', the
            peg words) is not a name and never prints; the
            ground resolves by name through the doors below;
         3. today's NAVIGATION destinations (within 300 m) —
            where he drove to this morning outranks every
            proximity match;
         4. the tiered place pool (v204, tiered by v299: his
            saved places first, built-ins and learned labels
            only when he has nothing there);
         5. a navigation-log entry at that time (legacy). */
    var labelTrailPoint = function (lat, lng, tMs) {
      var label = '';
      if (geoDay && geoDay.pegs) {
        [['load', geoDay.pegs.load], ['dump', geoDay.pegs.dump]].forEach(function (pair) {
          var pg = pair[1];
          if (!label && pg && isFinite(pg.lat) && isFinite(pg.lng) &&
              trailDistM(lat, lng, Number(pg.lat), Number(pg.lng)) <= 200) {
            label = pegNameFor(Number(pg.lat), Number(pg.lng), d);
          }
        });
      }
      if (!label && geoDay && geoDay.sites) {
        [['load', geoDay.sites.load], ['dump', geoDay.sites.dump]].forEach(function (pair) {
          var site = pair[1];
          if (!label && site && isFinite(site.lat) && isFinite(site.lng) &&
              trailDistM(lat, lng, Number(site.lat), Number(site.lng)) <= 200) {
            var sl = site.label || '';
            if (sl && ['Load site', 'Dump site', 'Load peg', 'Dump peg', 'Pickup peg'].indexOf(sl) === -1) label = sl;
          }
        });
      }
      if (!label) label = navRecentName(lat, lng, d, 300);
      if (!label) label = placeNameFor(lat, lng);
      if (!label) {
        for (var ni = 0; ni < navLog.length; ni++) {
          var nt = stampMs(navLog[ni].at);
          if (nt !== null && Math.abs(nt - tMs) <= 15 * 60000 && navLog[ni].name) { label = navLog[ni].name; break; }
        }
      }
      return label;
    };
    var routeStops = [];
    var gpsTrail = false;
    try {
      var lmDays = (G('livemiles', { days: {} }) || {}).days || {};
      /* v245 (MANIFEST-GPS-EMPTY-OCT22): the day's crumbs join
         by their OWN timestamps, not by the record's date
         stamp. Oct 22's tracking was shattered by two mid-shift
         installs; a fragment whose record lost its date stamp —
         or carries the reinstall day's — was invisible here
         even though every crumb in it is timestamped on the
         day, and a mis-stamped record leaked its crumbs into
         the wrong day's route. A crumb files under its own
         day; identical crumbs folded into two surviving
         records count once. */
      var allCrumbs = [];
      var seenCrumb = {};
      Object.keys(lmDays).forEach(function (k) {
        var rec = lmDays[k];
        if (!rec || !rec.crumbs) return;
        rec.crumbs.forEach(function (cr) {
          if (!cr) return;
          var ct = +cr.t;
          if (!isFinite(ct) || ct <= 0) return;
          var cd = new Date(ct);
          var cs = cd.getFullYear() + '-' + ('0' + (cd.getMonth() + 1)).slice(-2) + '-' + ('0' + cd.getDate()).slice(-2);
          if (cs !== d) return;
          var ckey = ct + '|' + cr.a + '|' + cr.o;
          if (seenCrumb[ckey]) return;
          seenCrumb[ckey] = 1;
          allCrumbs.push(cr);
        });
      });
      gpsTrail = allCrumbs.length > 0;
      routeStops = trailStops(allCrumbs).map(function (s) {
        return { at: new Date(s.t).toISOString(), label: labelTrailPoint(s.lat, s.lng, s.t), lat: s.lat, lng: s.lng, mins: s.mins };
      });
    } catch (e) { routeStops = []; }
    /* v190: home is not a work stop (see homePin/dropHomeStops). */
    routeStops = dropHomeStops(routeStops, homePin());
    /* v299 (MANIFEST-HAUL-SUMMARY-LINE + MANIFEST-PEG-NAMES,
       owner, Oct 31, 2026 14:24 MDT): "I don't want it
       counting every step of the way." On a peg day the route
       section no longer lists the haul cycles stop by stop —
       the dwells at the day's two pegs come OUT of the stop
       list, and the cycles print as ONE summary line per
       pickup–dump pairing in the route section, in his
       format: "Remington – Dog Park · N loads". The pairings
       are counted from the peg counter's own event log
       (counted load → the next counted dump), names resolved
       per event through pegNameFor (navigation truth first).
       A load whose dump the counter never logged still ran —
       it folds into the day's dump place of record, so the
       lines count the cycles the driver RAN; the day's Loads
       line stays the count of record and the two agree
       whenever the counter saw every dump. A peg day whose
       events name no complete pairing falls back to the
       day's pegged places with the count of record. Genuine
       stops (the site wait, the fuel stop, home) are
       untouched — only the peg dwells collapse. */
    var haulLines = [];
    if (geoDay && geoDay.pegs && (geoDay.pegs.load || geoDay.pegs.dump)) {
      var pegPts299 = [];
      ['load', 'dump'].forEach(function (kind) {
        var pg = geoDay.pegs[kind];
        if (pg && isFinite(pg.lat) && isFinite(pg.lng)) pegPts299.push({ lat: +pg.lat, lng: +pg.lng });
      });
      if (pegPts299.length) {
        routeStops = routeStops.filter(function (s) {
          if (!s || !isFinite(s.lat) || !isFinite(s.lng)) return true;
          return !pegPts299.some(function (p) { return trailDistM(s.lat, s.lng, p.lat, p.lng) <= 200; });
        });
        var dumpNameOfRecord = function () {
          return (pegPlaces && pegPlaces.dump && pegPlaces.dump.length)
            ? pegPlaces.dump[pegPlaces.dump.length - 1] : '';
        };
        var addPair299 = function (from, to, at) {
          if (!from || !to) return;
          for (var i = 0; i < haulLines.length; i++) {
            if (haulLines[i].from === from && haulLines[i].to === to) { haulLines[i].n++; return; }
          }
          haulLines.push({ from: from, to: to, n: 1, at: at || 0 });
        };
        var evs299 = (Array.isArray(geoDay.pegEvents) ? geoDay.pegEvents : [])
          .filter(function (e) { return e && (e.kind === 'load' || e.kind === 'dump') && isFinite(e.lat) && isFinite(e.lng); })
          .slice().sort(function (a, b) { return (+a.t || 0) - (+b.t || 0); });
        var openLoad299 = null;
        evs299.forEach(function (e) {
          if (e.kind === 'load') {
            if (openLoad299) addPair299(pegNameFor(+openLoad299.lat, +openLoad299.lng, d), dumpNameOfRecord(), +openLoad299.t || 0);
            openLoad299 = e;
          } else if (openLoad299) {
            addPair299(pegNameFor(+openLoad299.lat, +openLoad299.lng, d), pegNameFor(+e.lat, +e.lng, d), +openLoad299.t || 0);
            openLoad299 = null;
          }
        });
        if (openLoad299) addPair299(pegNameFor(+openLoad299.lat, +openLoad299.lng, d), dumpNameOfRecord(), +openLoad299.t || 0);
        if (!haulLines.length && pegPlaces && pegPlaces.load && pegPlaces.load.length &&
            pegPlaces.dump && pegPlaces.dump.length && loads > 0) {
          haulLines.push({ from: pegPlaces.load[0], to: pegPlaces.dump[pegPlaces.dump.length - 1],
            n: loads, at: evs299.length ? (+evs299[0].t || 0) : 0 });
        }
      }
    }
    /* v275 (MANIFEST-NO-GPS-DATA): the route's own frame — the
       day's FIRST and LAST trail points, named by the same
       chain as the stops, plus the day's GPS distance (the
       live-miles total; the crumb chain itself when no total
       was recorded). Before this ship the route section was
       the stops alone: a day whose stops were all short —
       Oct 26, where a tip takes ~75 seconds against the
       4-minute stop rule — printed NO route at all while its
       own footer claimed "GPS trail on file". The frame
       prints whenever a trail exists, stops or no stops.
       Start/End are the trail's bounds, not work stops, so
       the v190 home filter does not touch them: the route
       honestly begins and ends where the truck was. */
    var routeInfo = null;
    try {
      if (typeof allCrumbs !== 'undefined' && allCrumbs && allCrumbs.length) {
        var rcSorted = allCrumbs.filter(function (cr) { return cr && isFinite(cr.a) && isFinite(cr.o) && +cr.t > 0; })
          .slice().sort(function (x, y) { return x.t - y.t; });
        if (rcSorted.length) {
          var fc = rcSorted[0], lc2 = rcSorted[rcSorted.length - 1];
          var chainKm = 0;
          for (var ci = 0; ci + 1 < rcSorted.length; ci++) {
            chainKm += trailDistM(rcSorted[ci].a, rcSorted[ci].o, rcSorted[ci + 1].a, rcSorted[ci + 1].o) / 1000;
          }
          routeInfo = {
            start: { at: new Date(+fc.t).toISOString(), label: labelTrailPoint(fc.a, fc.o, +fc.t), lat: fc.a, lng: fc.o },
            end: { at: new Date(+lc2.t).toISOString(), label: labelTrailPoint(lc2.a, lc2.o, +lc2.t), lat: lc2.a, lng: lc2.o },
            km: Math.round((liveKmAny ? liveKm : chainKm) * 10) / 10
          };
        }
      }
    } catch (e) { routeInfo = null; }
    /* v191 (MANIFEST-EDIT, owner, Oct 21, 2026 06:15 MDT): the
       day's own corrections, applied LAST — the top layer over
       every derivation above. He forgot last night's end-of-day
       odometer photo and had NO way to fix the day after the
       fact. A past day's preview now carries a quiet Edit door
       (see render) that writes mft_day_edits[date] = {endOdo,
       note, editedAt} plus a dated odo_readings entry (source
       'manifest-edit') at the day's end, so the corrected end
       also chains into the NEXT day's start the way his sheet
       chains. Here: an edited end replaces the day's end
       outright (the driver's own word outranks every inference),
       a stored miles verdict computed against a lower end is
       dropped (the v177 pattern), and the day's note rides the
       record so the preview and the PDF both print it. */
    var dayEdit = null;
    try { dayEdit = (G('mft_day_edits', {}) || {})[d] || null; } catch (e) { dayEdit = null; }
    var edited = applyDayEdit({ odoEnd: odoEnd, milesIssues: milesIssues }, dayEdit);
    odoEnd = edited.odoEnd; milesIssues = edited.milesIssues;
    var dayNote = edited.dayNote;
    /* v299: the v275 day miles accounting that stood here is
       REMOVED (MANIFEST-JARGON-BLOCK — see the note at the top
       of this module's trail section). Nothing replaces the
       computation: the record carries no milesNote anymore.
       The stored per-session verdicts in milesIssues still
       ride the record as data; they are not printed. */
    /* v247 (MANIFEST-PTI, owner Oct 22, 2026 20:04 MDT + Oct 23):
       the day's inspections ride the manifest — pre + post, each
       with its time, odometer reading, defects result and
       filed/signed status — and completeness is a fact of the
       record: a manifest is COMPLETE only when the PTI pair AND
       the GPS trail are both on file. The latest filing of each
       kind is the day's operative inspection; another work
       profile's reports never fill this day (the v242 fence,
       stamped the app's own way — App's wpStampOf: a record
       with no stamp belongs to 'p1', and the day's profile is
       dayPid or 'p1' when nothing on it is stamped). */
    var ptiPre = null, ptiPost = null;
    var dayPidEff = dayPid || 'p1';
    (G('pti_reports', []) || []).forEach(function (r) {
      if (!r || r.date !== d) return;
      if (String(r.profileId || 'p1') !== dayPidEff) return;
      var s = ptiSummary(r);
      if (r.kind === 'pre') { if (!ptiPre || s.at >= ptiPre.at) ptiPre = s; }
      else if (r.kind === 'post') { if (!ptiPost || s.at >= ptiPost.at) ptiPost = s; }
    });
    var pti = { pre: ptiPre, post: ptiPost };
    var missing = [];
    if (!ptiPre) missing.push('pre-trip PTI');
    if (!ptiPost) missing.push('post-trip PTI');
    if (!gpsTrail) missing.push('GPS trail');
    var complete = missing.length === 0;
    return { dispatches: dispatches, navLog: navLog, routeStops: routeStops, splitStops: splitStops, splitBlocks: splitBlocks, haulLines: haulLines, routeInfo: routeInfo, fills: fills, expenses: expenses, incidents: incidents, sessions: sessions, revEntries: revEntries, earned: earned, startT: startT, endT: endT, startSrc: startSrc, endSrc: endSrc, odoStart: odoStart, odoEnd: odoEnd, odoStartPhoto: odoStartPhoto, odoEndPhoto: odoEndPhoto, liveKm: liveKm, liveKmAny: liveKmAny, milesIssues: milesIssues, geoDay: geoDay, pegPlaces: pegPlaces, live: live, loads: loads, loadsSrc: loadsSrc, loadsSite: loadsSite, dayNote: dayNote, dayEdit: dayEdit, pti: pti, gpsTrail: gpsTrail, complete: complete, missing: missing };
  }

  /* v247: one filed PTI report as the manifest prints it —
     time, odometer, defects result, filed/signed status. */
  function ptiSummary(r) {
    var n = (r.defects || []).length;
    return {
      at: stampMs(r.filedAt) || 0,
      time: fmtClock(stampMs(r.filedAt)),
      odometer: (typeof r.odometer === 'number' && isFinite(r.odometer)) ? r.odometer : null,
      result: r.result || null,
      defects: n,
      defectsText: n === 0 ? 'No defects' : n + (n === 1 ? ' defect' : ' defects') + ' — ' + (r.result || '—'),
      signed: !!r.signed
    };
  }
  function ptiRowText(s) {
    return s.time + ' · ' + (s.odometer !== null ? Number(s.odometer).toLocaleString('en-CA') + ' km' : 'odometer not recorded') +
      ' · ' + s.defectsText + ' · ' + (s.signed ? 'Signed' : 'Filed — not signed');
  }

  /* v67 — THE REMEMBERED-TOGGLES RULE (owner, Oct 14: "no user wants to
     turn it on every single day or off every single day"): the section
     toggles are ONE global set in the SYNCED store (mft_sections) — set
     once, remembered on every day, every launch, every device. They are
     never per-date: the date picker only chooses which day's data is
     shown. Pre-v67 the set lived under mani_toggles; that most recent
     set migrates into mft_sections on first read and the old key is
     removed, so there is exactly one source of truth. */
  var SECTIONS_KEY = 'mft_sections';
  var LEGACY_TOGGLES_KEY = 'mani_toggles';

  function toggles() {
    var t = G(SECTIONS_KEY, null);
    if (!t || typeof t !== 'object') {
      var legacy = G(LEGACY_TOGGLES_KEY, null);
      t = (legacy && typeof legacy === 'object') ? legacy : {};
      App._store.set(SECTIONS_KEY, t);
      if (legacy) App._store.del(LEGACY_TOGGLES_KEY);
    }
    // sections added after a user's toggles were saved default ON
    var out = {};
    SECTIONS.forEach(function (s) { out[s[0]] = (t[s[0]] === undefined) ? true : !!t[s[0]]; });
    /* v87: the two odometer lines merged into one 'odo' section —
       a pre-v87 set that had deliberately turned EITHER odometer
       line off keeps the merged line off (a remembered choice is
       never silently reversed by a rename). */
    if (t.odo === undefined && (t.odoStart === false || t.odoEnd === false)) out.odo = false;
    return out;
  }

  function setToggle(key, on) {
    var t = toggles();
    t[key] = !!on;
    App._store.set(SECTIONS_KEY, t);
  }

  /* v69: the manifest as typed PDF lines (js/pdfexport.js) — built
     from the SAME collect() result and the SAME toggle set as the
     on-screen preview, under the same conditions, so the PDF can
     never disagree with what the driver sees. */
  /* v211 (MANIFEST-MULTIDAY): the period totals — ONE reducer
     (sumCollected) under both faces: the screen preview sums the
     collects it already made for the day blocks; the printed
     document sums through rangeTotals. Same math, so the screen
     and the PDF can never disagree. Hours = the day's REVENUE
     hours (v345 — see daySummaryOf; the v211 session-span basis
     was the wrong source and is retired). Miles keep the v184
     basis (live km, days that have it). */
  /* v331 (MULTI-DAY-MANIFEST-SUMMARY, owner Nov 5, 2026 ~12:39):
     ONE day as its summary — the only four facts a multi-day
     manifest may carry per day: total km, total hours, loads,
     fuel filled (litres). No odometer readings, no start/end
     times, no GPS marks, no pay — the amendment's exact list.
     km keeps the v211 basis (live km on days that have it);
     fuel is the day's fills' litres summed. sumCollected below
     reads through this, so the reducer's math lives in exactly
     one place.
     v345 (MANIFEST-HOURS-WRONG-SOURCE, owner Nov 5, 2026 22:47 —
     "There are noooo run away days! My actual hours are in my
     revenue.. Or my invoices."): the summary's HOURS are the
     day's REVENUE hours — the sum of the day's revenue entries'
     recorded hours (foreman ticket hours + travel, the same
     hours his invoices bill). Tracker-session seconds and live
     tracker hours NEVER enter this summary: a day with revenue
     hours but no session shows those hours; a day with sessions
     but no revenue hours shows 0.0 h here. (The v331–v344
     session-span basis printed impossible days — 88.9 h on a
     single October day, 351 h for the month — because it summed
     the tracker's clock, not his recorded hours.) collect()
     returns the day's revEntries for exactly this. */
  function daySummaryOf(rc) {
    if (!rc) return { km: 0, hours: 0, loads: 0, fuelL: 0 };
    var revH = 0;
    (rc.revEntries || []).forEach(function (e) { revH += parseFloat(e && e.hours) || 0; });
    var fuelL = 0;
    (rc.fills || []).forEach(function (x) { fuelL += parseFloat(x && x.litres) || 0; });
    return {
      km: rc.liveKmAny ? (rc.liveKm || 0) : 0,
      hours: revH,
      loads: rc.loads || 0,
      fuelL: fuelL
    };
  }
  function sumCollected(list) {
    var earned = 0, loads = 0, km = 0, hours = 0, fuelL = 0;
    (list || []).forEach(function (rc) {
      if (!rc) return;
      earned += rc.earned || 0;
      var s = daySummaryOf(rc);
      loads += s.loads;
      km += s.km;
      hours += s.hours;
      fuelL += s.fuelL;
    });
    return { earned: earned, loads: loads, km: km, hours: hours, fuelL: fuelL };
  }
  /* The summary's own formatting — one decimal, the house style
     of the v211 period line. */
  function fmtKm1(km) { return (Math.round((km || 0) * 10) / 10).toFixed(1) + ' km'; }
  function fmtH1(hours) { return (Math.round((hours || 0) * 10) / 10).toFixed(1) + ' h'; }
  function fmtL1(litres) { return (Math.round((litres || 0) * 10) / 10).toFixed(1) + ' L'; }
  /* v344 (MULTI-DAY-MANIFEST-COLUMNS): the bare one-decimal
     figure for a table cell — the column heading carries the
     unit, so the cell is the number alone and every figure in
     the column lines up digit-for-digit. */
  function fmtN1(v) { return (Math.round((v || 0) * 10) / 10).toFixed(1); }
  function fmtDayLabel(ds) {
    var p = String(ds || '').split('-');
    if (p.length !== 3) return String(ds || '');
    var dt = new Date(+p[0], +p[1] - 1, +p[2]);
    try { return dt.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }); }
    catch (e) { return String(ds); }
  }
  function daySummaryText(s) {
    return fmtKm1(s.km) + ' · ' + fmtH1(s.hours) + ' · ' + s.loads + (s.loads === 1 ? ' load' : ' loads') + ' · ' + fmtL1(s.fuelL) + ' fuel';
  }
  function rangeTotals(days) {
    return sumCollected((days || []).map(function (rd) { return collect(rd); }));
  }

  /* v353 (MANIFEST-NO-RAW-GPS-STOPS + MANIFEST-CLUMP-50M,
     owner Nov 5, 2026 23:30–23:32 MDT, over the Nov 5
     manifest): "Manifest doesnt have to write every gps tag
     where it stops... Just so many dumps in this locations."
     The route section no longer lists stops one by one — the
     day's genuine stops CLUMP: stops within ~50 m of each
     other are ONE place, printed as a single summary line
     carrying the place's name and how many stops clumped
     there. A cluster takes its name from a member stop's
     resolved label (the driver's own names win there, per the
     tiered naming law); a cluster no stop could name gets one
     more chance at its centre through placeNameFor, and only
     then prints as "Unnamed stop" — RAW COORDINATES NEVER
     PRINT on the manifest, here or in the Start/End frame
     (their old coordinate fallback is gone the same way).
     The haul pairing lines (v299) are untouched and merge
     with the clusters in time order. */
  function stopClusters353(stops) {
    var clusters = [];
    (stops || []).forEach(function (s) {
      if (!s || !isFinite(s.lat) || !isFinite(s.lng)) return;
      var hit = null;
      for (var i = 0; i < clusters.length && !hit; i++) {
        for (var j = 0; j < clusters[i].pts.length; j++) {
          if (trailDistM(s.lat, s.lng, clusters[i].pts[j].lat, clusters[i].pts[j].lng) <= 50) { hit = clusters[i]; break; }
        }
      }
      if (!hit) { hit = { pts: [], label: '', at: 0, n: 0 }; clusters.push(hit); }
      hit.pts.push(s);
      hit.n++;
      if (!hit.label && s.label) hit.label = s.label;
      var at = Date.parse(s.at) || 0;
      if (at && (!hit.at || at < hit.at)) hit.at = at;
    });
    clusters.forEach(function (cl) {
      if (!cl.label) {
        var la = 0, lo = 0;
        cl.pts.forEach(function (p) { la += p.lat; lo += p.lng; });
        cl.label = placeNameFor(la / cl.pts.length, lo / cl.pts.length) || 'Unnamed stop';
      }
      delete cl.pts;
    });
    return clusters;
  }
  /* The frame name for a trail endpoint: its resolved label,
     else the place pool at the point, else NOTHING — the bare
     word prints (Start / End), never coordinates. */
  function frameName353(pt) {
    if (!pt) return '';
    return pt.label || placeNameFor(pt.lat, pt.lng) || '';
  }

  function docLines(d, c, t) {
    var L = [{ k: 'title', a: 'MANIFEST — ' + d }];
    if (c.live) L.push({ k: 'note', a: 'Shift still in progress — the end time and final numbers land when the shift is stopped.' });
    if (t.dispatch && c.dispatches.length) {
      L.push({ k: 'h', a: 'Dispatches' });
      c.dispatches.forEach(function (x) {
        L.push({ k: 'kv', a: x.jobSite || x.pickup || 'Dispatch', b: x.material || '' });
        if (x.tickets && x.tickets.length) {
          var o = {};
          try { o = App._store.get('onboarding', {}); } catch (e) {}
          var tb = parseFloat(o.travelBonus) || 0;
          x.tickets.forEach(function (tk, ti) {
            var lbl = tk.cardNumber ? 'Card #' + tk.cardNumber :
                      tk.ticketNo ? 'Ticket #' + tk.ticketNo : 'Ticket ' + (ti + 1);
            var det = [];
            if (tk.foremanHours) det.push(tk.foremanHours + 'h');
            if (tk.paymentUnit) det.push(tk.paymentUnit);
            if (tk.netWeight) det.push(tk.netWeight + 't');
            L.push({ k: 'p', a: '  • ' + lbl + (det.length ? ' — ' + det.join(' · ') : '') });
          });
          if (window.TicketOCR) {
            var s = TicketOCR.summarizeTickets(x.tickets, tb);
            L.push({ k: 'p', a: '  Foreman total: ' + s.totalForemanHours + 'h' +
              (tb > 0 ? ' + travel ' + tb + 'h = ' + s.totalPaidHours + 'h paid' : '') });
            if (s.totalNetWeight > 0) L.push({ k: 'p', a: '  Total weight: ' + s.totalNetWeight + 't' });
          }
        }
      });
    }
    if (t.nav && c.navLog.length) {
      L.push({ k: 'h', a: 'Work travel' });
      c.navLog.forEach(function (x) {
        L.push({ k: 'kv', a: x.name, b: fmtStamp(x.at) });
      });
    }
    /* v184 (M-route): the trail's own record — printed whenever
       the truck drove, navigated or not.
       v275 (MANIFEST-NO-GPS-DATA): the section is the ROUTE,
       not only its long stops — Start and End (the trail's
       first and last points, named) frame the stops, and the
       GPS distance closes it. The section prints whenever a
       trail exists (c.routeInfo), even on a day whose stops
       were all too short to list (Oct 26). */
    /* v299: the section also prints when the day carries haul
       lines but no trail frame (a peg day whose trail is gone
       keeps its summary). */
    if (t.nav && (c.routeInfo || (c.routeStops && c.routeStops.length) || (c.haulLines && c.haulLines.length))) {
      L.push({ k: 'h', a: 'Where the truck went (from its GPS trail)' });
      if (c.routeInfo) {
        var startName353 = frameName353(c.routeInfo.start);
        L.push({ k: 'kv', a: startName353 ? 'Start — ' + startName353 : 'Start',
          b: fmtStamp(c.routeInfo.start.at) });
      }
      /* v299 (MANIFEST-HAUL-SUMMARY-LINE): the day's haul
         cycles print as ONE line per pickup–dump pairing,
         merged with the genuine stops in time order — the
         cycles never list stop by stop again.
         v353: the genuine stops no longer list stop by stop
         either — they arrive CLUMPED (stopClusters353): one
         summary line per place, its name and its stop count. */
      var routeRows299 = stopClusters353(c.routeStops).map(function (cl) { return { cluster: cl, at: cl.at || 0 }; })
        .concat((c.haulLines || []).map(function (hl) { return { haul: hl, at: +hl.at || 0 }; }));
      routeRows299.sort(function (x, y) { return x.at - y.at; });
      routeRows299.forEach(function (r) {
        if (r.haul) {
          L.push({ k: 'kv', a: r.haul.from + ' – ' + r.haul.to, b: r.haul.n + (r.haul.n === 1 ? ' load' : ' loads') });
        } else {
          L.push({ k: 'kv', a: r.cluster.label, b: r.cluster.n + (r.cluster.n === 1 ? ' stop' : ' stops') });
        }
      });
      if (c.routeInfo) {
        var endName353 = frameName353(c.routeInfo.end);
        L.push({ k: 'kv', a: endName353 ? 'End — ' + endName353 : 'End',
          b: fmtStamp(c.routeInfo.end.at) });
        if (typeof c.routeInfo.km === 'number' && isFinite(c.routeInfo.km)) {
          L.push({ k: 'kv', a: 'GPS distance', b: c.routeInfo.km.toFixed(1) + ' km' });
        }
      }
    }
    /* v355 (SPLIT-SHIFT): the split day's run record — its named
       route stops in the order driven, and the day's skips named
       as skipped (the driver's word — never "missed"). Names
       only; a stop's coordinates never print. */
    if (c.splitStops && c.splitStops.length) {
      var served355 = c.splitStops.filter(function (s) { return !s.skipped; });
      var skipped355 = c.splitStops.filter(function (s) { return s.skipped; });
      L.push({ k: 'h', a: 'Route stops' });
      if (served355.length) {
        L.push({ k: 'kv', a: 'Route — ' + served355.length + (served355.length === 1 ? ' stop' : ' stops'),
          b: served355.map(function (s) { return s.name; }).join(' · ') });
      }
      if (skipped355.length) {
        L.push({ k: 'kv', a: 'Skipped', b: skipped355.map(function (s) { return s.name; }).join(' · ') });
      }
    }
    if (t.expense && (c.fills.length || c.expenses.length)) {
      L.push({ k: 'h', a: 'Fuel & expenses' });
      c.fills.forEach(function (x) { L.push({ k: 'kv', a: 'Fuel — ' + (x.station || ''), b: '$' + x.cost }); });
      c.expenses.forEach(function (x) { L.push({ k: 'kv', a: x.what, b: '$' + x.cost }); });
    }
    if (t.incident && c.incidents.length) {
      L.push({ k: 'h', a: 'Incidents' });
      c.incidents.forEach(function (x) { L.push({ k: 'kv', a: x.tab, b: String(x.desc || '').slice(0, 40) }); });
    }
    /* v247 (MANIFEST-PTI): the day's inspections print with the
       rest of the day record — both rows always, a side that was
       never filed says so (see dayBodyHtml for the screen twin). */
    if (t.pti && c.pti && (c.pti.pre || c.pti.post)) {
      L.push({ k: 'h', a: 'PTI — inspections' });
      L.push({ k: 'kv', a: 'Pre-trip', b: c.pti.pre ? ptiRowText(c.pti.pre) : 'Not filed' });
      L.push({ k: 'kv', a: 'Post-trip', b: c.pti.post ? ptiRowText(c.pti.post) : 'Not filed' });
    }
    /* v134 (owner, Oct 17: "Same clean up on manifest"): the day's
       figures get their OWN section, the way the invoice's totals
       stand apart — a "Day summary" heading over the start/end /
       odometer / loads / earned lines below, printed only when at
       least one of those lines will print, and the earned figure
       closes the section behind a rule (its totals row). The lines
       themselves — words, order, toggles, the v127 live/closed
       label — are unchanged. */
    var anyFig = t.start || t.end || t.odo || t.earned ||
      (t.loads && c.loads > 0) ||
      !!c.pegPlaces; /* v283: a peg day's places open the section on their own */
    if (anyFig) L.push({ k: 'h', a: 'Day summary' });
    if (t.start) L.push({ k: 'kv', a: 'Start Time', b: c.startT });
    if (t.end) L.push({ k: 'kv', a: 'End Time', b: c.endT });
    /* v83: when a shown time is the tracker's (no confirmed
       dispatch/card time for it), the manifest SAYS so — session
       times never again wear the day's clothes unlabelled. */
    var trkParts = [];
    if (c.startSrc === 'tracker' && c.startT !== '—') trkParts.push('Start');
    if (c.endSrc === 'tracker' && c.endT !== '—') trkParts.push('End');
    if (trkParts.length) {
      L.push({ k: 'note', a: trkParts.join(' and ') + (trkParts.length > 1 ? ' times are' : ' time is') + ' from the tracker — no confirmed dispatch time for this day.' });
    }
    /* v87: one Odometer line — start → end with the day's km
       (see odoLineText). v122: with the section ON but no
       boundary data at all, the line now SAYS so ("no readings
       captured") instead of vanishing silently — a vanished line
       is indistinguishable from the toggle being ignored, which
       is exactly what the owner reported on Oct 17. */
    if (t.odo) { var ol = odoLineText(c); L.push({ k: 'kv', a: 'Odometer', b: (ol !== null) ? ol : 'no readings captured' }); }
    if (t.odo && c.liveKmAny) L.push({ k: 'kv', a: 'Miles (live)', b: (Math.round(c.liveKm * 10) / 10).toFixed(1) + ' km' });
    /* v299 (MANIFEST-JARGON-BLOCK): nothing prints under
       Miles (live) anymore — the v275 accounting block that
       stood here was the jargon he circled. The Odometer
       line and the Miles (live) figure above are the whole
       miles story on this document. */
    /* v291 (MANIFEST-LOADS-SUMMARY, owner Oct 30, 2026 17:28
       MDT: "Manifest doesn't have to give details of every
       single load...... It can say just 17 loads on site!"):
       the day's loads print as ONE line — the count of
       record (collect: the peg count on a peg day, else the
       shared ladder's figure) plus the site by name when
       the day has one. The v50 GPS-count block that stood
       here — its own competing figure, its explainer, the
       learned/remembered/alt-dump notes and a row for every
       load — is GONE from the manifest entirely, and so are
       the v82/v86 source annotations: two counts on one
       document was the defect, and the one line now carries
       the count itself. The Loaded at / Dumped at lines
       below still name the day's places. */
    if (t.loads && c.loads > 0) {
      L.push({ k: 'kv', a: 'Loads', b: String(c.loads) + (c.loadsSite ? ' on site — ' + c.loadsSite : '') });
    }
    /* v283 (MANIFEST-PEG-PLACES): where the day loaded and
       where it dumped, from the driver's own pegs (v282) — the
       places print BY NAME (collect's pegPlaces; a place the
       app has never seen prints its peg time). The lines ride
       no section toggle: the pegs are the driver's own declared
       facts, the same standing as the day note (v191). A role
       never pegged prints no line. */
    if (c.pegPlaces) {
      if (c.pegPlaces.load.length) L.push({ k: 'kv', a: 'Loaded at', b: c.pegPlaces.load.join(' → ') });
      if (c.pegPlaces.dump.length) L.push({ k: 'kv', a: 'Dumped at', b: c.pegPlaces.dump.join(' → ') });
    }
    /* v87: no blocked-reason note here anymore — see the v87 note
       where GEOLOAD_BLOCKED used to live. Silence over blame. */
    /* v127 (owner, Oct 17 09:56 MDT): while the shift is still
       OPEN the figure is a running total, and the row must say
       so — "Income earned today so far". "Total Earned Income"
       is earned only once the day is closed. collect() already
       knows the live session (c.live). v134: the figure is the
       Day summary's totals row — a rule sets it apart, the line
       itself (kind, label, value) is unchanged. */
    if (t.earned) {
      L.push({ k: 'rule' });
      L.push({ k: 'kv', a: c.live ? 'Income earned today so far' : 'Total Earned Income', b: '$' + c.earned.toFixed(2) });
    }
    /* v191 (MANIFEST-EDIT): the day's own note, written through
       the Edit door — an explicit driver note always prints,
       behind no section toggle. */
    if (c.dayNote) L.push({ k: 'note', a: 'Day note: ' + c.dayNote });
    /* v247: the completeness fact closes the document — a
       manifest is complete only with PTI (pre + post) AND the
       GPS trail on file (owner, Oct 23); what is missing is
       named, the way the record stands. A day still in progress
       makes no completeness claim (its live note above already
       says the numbers land when the tracker stops). */
    if (t.pti && !c.live) {
      if (c.complete) L.push({ k: 'note', a: 'Manifest complete — PTI (pre + post) and GPS trail on file.' });
      else L.push({ k: 'note', a: 'Manifest incomplete — missing: ' + (c.missing || []).join(' · ') + '.' });
    }
    return L;
  }

  function saveManifestPdf(body, d, c, t) {
    saveManifestLines(body, 'Manifest — ' + d, docLines(d, c, t), 'manifest-' + d + '.pdf');
  }
  function saveManifestLines(body, title, lines, filename) {
    var msgEl = null;
    try { msgEl = body.querySelector('#mn_msg'); } catch (e) {}
    function say(txt) { if (msgEl) msgEl.textContent = txt; }
    if (window.MetPdf && typeof MetPdf.savePdf === 'function') {
      say('Making your PDF…');
      MetPdf.savePdf({ title: title, lines: lines }, filename).then(
        function (r) { say(r.message); },
        function () { say('The PDF could not be saved. Try again.'); });
    } else {
      say('PDF tools are still loading — close and reopen the app, then try again.');
    }
  }
  /* v184: every date in a From→To range, inclusive, local days,
     capped at 62 — the same honest bound a pay period needs. */
  function eachDayInRange(from, to) {
    var out = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) return out;
    if (from > to) { var tmp = from; from = to; to = tmp; }
    var p = from.split('-'), cur = new Date(+p[0], +p[1] - 1, +p[2]);
    for (var i = 0; i < 62; i++) {
      var ds = cur.getFullYear() + '-' + ('0' + (cur.getMonth() + 1)).slice(-2) + '-' + ('0' + cur.getDate()).slice(-2);
      if (ds > to) break;
      out.push(ds);
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  var maniAudit = false; /* v340 AUDIT-BUTTON-EVERY-MODULE: the complete-history view is open */
  var maniBody = null;

  /* v340 (AUDIT-BUTTON-EVERY-MODULE, owner Nov 5, 2026 17:16
     MST): the Audit view — EVERY day carrying records, newest
     first, one summary line per day (the v331 multi-day line:
     total km, total hours, loads, fuel — the same facts a
     tax-season pass goes through). A tap opens that day's
     manifest itself. The day set = the union of the stores
     the manifest reads: sessions, dispatches, revenue
     entries, fuel fills. */
  function renderAuditDays(body) {
    maniBody = body;
    var dateSet = {};
    function add(ds) { if (ds && /^\d{4}-\d{2}-\d{2}$/.test(ds)) dateSet[ds] = 1; }
    (G('sessions', []) || []).forEach(function (s) { if (s) add(s.date); });
    (G('fuel_fills', []) || []).forEach(function (f) { if (f) add(f.date); });
    (G('rev_entries', []) || []).forEach(function (r) { if (r) add(r.date); });
    (G('dsp_list', []) || []).forEach(function (r) {
      if (!r) return;
      var raw = r.scheduledAt || r.date || '';
      add(String(raw).slice(0, 10));
    });
    var dates = Object.keys(dateSet).sort().reverse();
    function hrs(v) {
      var n = parseFloat(v) || 0, hh = Math.floor(n), mm = Math.round((n - hh) * 60);
      if (mm === 60) { hh += 1; mm = 0; }
      return (hh ? hh + ' h ' : '') + mm + ' m';
    }
    var h = '<button class="btn small ghost" id="mn_audit_back" style="margin-bottom:10px">‹ Back</button>' +
      '<div class="card"><h3 style="margin-top:0">🔎 Audit — Manifest days</h3>' +
      '<p class="note" style="margin-top:0">Every day with records, newest first — ' + dates.length + ' day' + (dates.length === 1 ? '' : 's') + '. Tap a day to open its manifest.</p>' +
      (dates.length ? dates.map(function (ds) {
        var s = {};
        try { s = daySummaryOf(collect(ds)) || {}; } catch (e) { s = {}; }
        var parts = [];
        parts.push((parseFloat(s.km) || 0).toFixed(1) + ' km');
        parts.push(hrs(s.hours));
        parts.push((s.loads || 0) + ' load' + (s.loads === 1 ? '' : 's'));
        parts.push((parseFloat(s.fuelL) || 0).toFixed(1) + ' L fuel');
        return '<div class="listitem" data-mn-day="' + ds + '" style="cursor:pointer">' +
          '<div class="a">' + esc(ds) + '<span style="float:right;color:var(--muted);font-weight:400">›</span></div>' +
          '<div class="b">' + esc(parts.join(' · ')) + '</div></div>';
      }).join('') : '<div class="empty">No days with records yet.</div>') + '</div>';
    body.innerHTML = h;
    body.querySelector('#mn_audit_back').onclick = function () {
      maniAudit = false;
      Meticulous.modules.manifest.render(body);
    };
    body.querySelectorAll('[data-mn-day]').forEach(function (el) {
      el.onclick = function () {
        var ds = el.getAttribute('data-mn-day');
        App._store.set('mani_date', ds);
        App._store.set('mani_mode', 'day');
        maniAudit = false;
        Meticulous.modules.manifest.render(body);
      };
    });
  }

  Meticulous.modules.manifest = {
    _auditOn: function () { return maniAudit; }, /* v340: exported for the audit suite */
    back: function () {
      if (maniAudit) {
        maniAudit = false;
        if (maniBody) Meticulous.modules.manifest.render(maniBody);
        return true;
      }
      return false;
    },
    resetView: function () { maniAudit = false; },
    /* v146: the pipe's doors — Connect ships a connected payer the
       manifest DOCUMENT for the periods billed to him as these
       very lines (collect + docLines under the driver's own
       toggles), so his view/print is the driver's own manifest,
       never a rebuild from the payer's stores. */
    _collectDay: collect,
    _docLines: docLines,
    _daySummaryOf: daySummaryOf, /* v331: the multi-day summary's per-day facts, exported for the suite */
    _rangeTotals: rangeTotals, /* v331: the same reducer the range faces total with */
    _trailStops: trailStops,
    _dropHomeStops: dropHomeStops, /* v190: the home-stop filter, exported for the suite */
    _placeNameFor: placeNameFor, /* v204: the stop-name resolver, exported for the suite */
    _pegPlaceLabels: pegPlaceLabels, /* v283: the day's pegged places, exported for the suite */
    _applyDayEdit: applyDayEdit, /* v191: the manifest-edit layer, exported for the suite */
    /* v299: _dayMiles is GONE with the accounting it exported
       (MANIFEST-JARGON-BLOCK) — nothing computes it anymore. */
    _toggles: toggles,
    /* v78: the card preview — TODAY's worked time so far. This is
       the tracker COMPLEMENT, not a repeat: the hero card counts
       the RUNNING session; this line totals the whole day (saved
       sessions + the live one, the same split collect() makes).
       Office faces never see tracker facts — for them the card
       keeps the plain log line. */
    status: function () {
      var role = '';
      try { role = App.userRole ? App.userRole() : ''; } catch (e) {}
      if (role !== 'office') {
        try {
          var today = App._today(), secs = 0;
          (G('sessions', []) || []).forEach(function (s) {
            if (s && s.date === today) secs += parseFloat(s.seconds) || 0;
          });
          var trk = (window.App && App.tracker) || G('tracker', null);
          var live = 0, liveState = '';
          if (trk && (trk.status === 'running' || trk.status === 'paused')) {
            live = parseFloat(trk.elapsed) || 0;
            if (trk.status === 'running') live += Math.floor((Date.now() - (trk.startTs || Date.now())) / 1000);
            liveState = trk.status;
          }
          /* v118: the preview quotes the BUILDER's day, never the
             raw session span, when a priced record speaks for
             today — Oct 16's card read "9 h 45 m worked" (the
             tracker session's own span, the same session behind
             its $282.85 tracker math) while the day's worked
             truth was the closed dispatch's 11 h (foreman 10 +
             travel 1), which is what the Manifest itself shows.
             A tracker-only day keeps the session span: there the
             session IS the day's truth. */
          var pricedH = null;
          try {
            var sh = (window.Meticulous && Meticulous.shared) || {};
            if (typeof sh.buildRevenueLines === 'function') {
              var built = sh.buildRevenueLines(G('rev_entries', []) || [], G('rev_extras', []) || [], G('dsp_list', []) || [], G('sessions', []) || [], G('pnl_card_wages', []) || []);
              (built.lines || []).forEach(function (l) {
                if (l && l.date === today && (l.src === 'dispatch' || l.src === 'entry')) {
                  var bh = parseFloat((built.dayHours || {})[today]);
                  if (isFinite(bh) && bh > 0) pricedH = bh;
                }
              });
            }
          } catch (e) { pricedH = null; }
          if (pricedH !== null) {
            var ph = Math.floor(pricedH), pm = Math.round((pricedH - ph) * 60);
            if (pm === 60) { ph += 1; pm = 0; }
            return 'Today: ' + (ph ? ph + ' h ' : '') + pm + ' m worked' +
              (liveState === 'running' ? ' · still working' : '');
          }
          var total = secs + live;
          if (total > 60) {
            var h = Math.floor(total / 3600), m = Math.round((total % 3600) / 60);
            if (m === 60) { h += 1; m = 0; }
            return 'Today: ' + (h ? h + ' h ' : '') + m + ' m worked' +
              (liveState === 'running' ? ' · still working' : '');
          }
          if (liveState) return liveState === 'running' ? 'Shift running' : 'Shift paused';
        } catch (e) {}
      }
      return 'Daily log · ' + dayStr();
    },
    render: function (body) {
      maniBody = body;
      /* v340: the Audit view (every recorded day) stands
         above the day/range faces. */
      if (maniAudit) { renderAuditDays(body); return; }
      var d = dayStr(), c = collect(d), t = toggles();
      /* v184: the custom period — the Manifest gains the From/To
         range the Revenue and P&L screens already carry (the
         confirmed gap, owner Oct 20). Day stays the default; a
         range shows every day in it and prints them as one
         document. The choice is remembered like the toggles. */
      var mnMode = G('mani_mode', 'day') === 'range' ? 'range' : 'day';
      var mnFrom = maniDate('mani_from', ''), mnTo = maniDate('mani_to', '');
      var rangeDays = mnMode === 'range' ? eachDayInRange(mnFrom, mnTo) : [];
      /* v340: the Audit button at the very top of the module. */
      var h = '<button class="btn small ghost" id="mn_audit" style="margin-bottom:10px">🔎 Audit</button>' +
        '<div class="card"><h3>📝 Manifest — <input type="date" id="mn_date" value="' + d + '" style="width:auto"></h3>';
      h += '<div class="row" style="gap:6px;margin:4px 0">' +
        '<button class="btn small ' + (mnMode === 'day' ? 'navy' : 'ghost') + '" id="mn_mode_day" style="flex:1">One day</button>' +
        '<button class="btn small ' + (mnMode === 'range' ? 'navy' : 'ghost') + '" id="mn_mode_range" style="flex:1">Date range</button></div>';
      if (mnMode === 'range') {
        h += '<div class="row"><div><label class="f">From</label><input type="date" id="mn_from" value="' + esc(mnFrom) + '"></div>' +
          '<div><label class="f">To</label><input type="date" id="mn_to" value="' + esc(mnTo) + '"></div></div>' +
          '<div class="note">The manifest covers every day from From to To — on screen and in the PDF.</div>';
      }
      h += '<div class="note">Choose what shows on your manifest — the app remembers your choice.</div>';
      SECTIONS.forEach(function (s) {
        h += '<div class="toggle"><span>' + s[1] + '</span><label class="switch"><input type="checkbox" data-tg="' + s[0] + '"' + (t[s[0]] ? ' checked' : '') + '><span class="knob"></span></label></div>';
      });
      h += '</div>';

      /* v211 (MANIFEST-MULTIDAY): ONE builder for a day's
         preview body. The single-day preview and every per-day
         block of a date-range preview are this same chain, so a
         range day shows exactly the facts the single-day
         manifest shows — dispatches, work travel, route stops,
         fuel & expenses, incidents, times, odometer (+ its P1
         photo doors), miles, loads, GPS loads, earnings, the
         day's note. The v191 Edit door is NOT part of it; it
         stays single-day only, below the call. */
      function dayBodyHtml(dd, cc, tt) {
        var d = dd, c = cc, t = tt, h = '';
      /* v355 (SPLIT-SHIFT): the split day's live facts — is this
         TODAY, and is the split engine on for this account. */
      var isToday355 = false, splitOn355 = false;
      try { isToday355 = (dd === App._today()); } catch (e) {}
      try { splitOn355 = !!(window.SplitShift && SplitShift.enabled && SplitShift.enabled()); } catch (e) {}
      if (t.dispatch && c.dispatches.length) {
        h += '<h3>Dispatches</h3>' + c.dispatches.map(function (x) {
          var dh = '<div class="kv"><span>' + esc(x.jobSite || x.pickup || 'Dispatch') + '</span><b>' + esc(x.material || '') + '</b></div>';
          /* v26: per-ticket breakdown */
          if (x.tickets && x.tickets.length) {
            var o = {};
            try { o = App._store.get('onboarding', {}); } catch (e) {}
            var tb = parseFloat(o.travelBonus) || 0;
            dh += '<div style="margin:4px 0 8px 12px;font-size:13px">';
            x.tickets.forEach(function (tk, ti) {
              var lbl = tk.cardNumber ? 'Card #' + esc(tk.cardNumber) :
                        tk.ticketNo ? 'Ticket #' + esc(tk.ticketNo) : 'Ticket ' + (ti + 1);
              var det = [];
              if (tk.foremanHours) det.push(esc(tk.foremanHours) + 'h');
              if (tk.paymentUnit) det.push(esc(tk.paymentUnit));
              if (tk.netWeight) det.push(esc(tk.netWeight) + 't');
              dh += '<div>• ' + lbl + (det.length ? ' — ' + det.join(' · ') : '') + '</div>';
            });
            if (window.TicketOCR) {
              var s = TicketOCR.summarizeTickets(x.tickets, tb);
              dh += '<div style="font-weight:700;margin-top:4px">Foreman total: ' + s.totalForemanHours + 'h' +
                (tb > 0 ? ' + travel ' + tb + 'h = ' + s.totalPaidHours + 'h paid' : '') + '</div>';
              if (s.totalNetWeight > 0) dh += '<div>Total weight: ' + s.totalNetWeight + 't</div>';
            }
            dh += '</div>';
          }
          return dh;
        }).join('');
      }
      if (t.nav && c.navLog.length) {
        h += '<h3>Work travel</h3>' + c.navLog.map(function (x) {
          return '<div class="kv"><span>' + esc(x.name) + '</span><b>' + esc(fmtStamp(x.at)) + '</b></div>';
        }).join('');
      }
      /* v355 (addendum 6): TODAY's route, live — the sheet's
         stops for both runs with the day's state: done, coming,
         or skipped. One BIG button per row: skip for today (the
         stop stays on the route for tomorrow, untouched) or
         bring it back. No menus, no forms — the driver is
         sitting at a stop when she uses it. */
      if (isToday355 && splitOn355) {
        var rt355 = null;
        try { rt355 = (window.SplitShift && SplitShift.routeToday) ? SplitShift.routeToday() : null; } catch (e) {}
        if (rt355 && ((rt355.am && rt355.am.length) || (rt355.pm && rt355.pm.length))) {
          h += '<h3>🚌 Today’s route</h3>';
          ['am', 'pm'].forEach(function (blk) {
            var rows = rt355[blk] || [];
            if (!rows.length) return;
            h += '<p class="note" style="margin:8px 0 4px;font-weight:700">' + (blk === 'am' ? 'Morning run' : 'Afternoon run') + '</p>';
            rows.forEach(function (r) {
              h += '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #26314d">' +
                '<div style="flex:1;min-width:0"><b>' + esc(r.name) + '</b>' +
                (r.time ? ' <span class="note">' + esc(r.time) + '</span>' : '') +
                (r.skipped ? ' <span class="note" style="color:#f0b35e">skipped today</span>' : (r.doneAt ? ' <span class="note" style="color:#7dd87d">✓ done</span>' : '')) +
                '</div>' +
                '<button type="button" class="btn ' + (r.skipped ? 'ghost' : 'primary') + '" data-split-skip="' + esc(r.key) + '" style="min-width:132px;padding:12px 10px;font-size:15px">' + (r.skipped ? '↩ Bring back' : '⏭ Skip today') + '</button></div>';
            });
          });
          h += '<p class="note">Skip is for today only — the stop stays on the route for tomorrow.</p>';
        }
      }
      /* v355 (SPLIT-SHIFT): the day's recorded route stops — BY
         NAME, in the order driven (tap a name to fix it once;
         the fixed name sticks for that stop — the wiring below).
         The day's skips stand apart, named as skipped — never
         "missed". */
      if (cc.splitStops && cc.splitStops.length) {
        var servedH = cc.splitStops.filter(function (s) { return !s.skipped; });
        var skippedH = cc.splitStops.filter(function (s) { return s.skipped; });
        h += '<h3>🚌 Route stops — ' + servedH.length + '</h3>';
        if (servedH.length) {
          h += '<p class="note" style="margin:2px 0 6px">' + servedH.map(function (s) {
            return '<span data-split-stop="' + esc(s.key || '') + '" style="text-decoration:underline dotted;cursor:pointer">' + esc(s.name) + '</span>';
          }).join(' · ') + '</p><p class="note" style="margin:0 0 6px">Tap a stop’s name to fix it — the fixed name sticks for that stop.</p>';
        }
        if (skippedH.length) h += '<div class="kv"><span>Skipped</span><b>' + skippedH.map(function (s) { return esc(s.name); }).join(' · ') + '</b></div>';
      }
      /* v184 (M-route): where the truck actually went — the GPS
         trail's stops for the day, shown whether or not the
         driver navigated anywhere.
         v275 (MANIFEST-NO-GPS-DATA): the screen twin of the
         printed route (see docLines) — Start and End frame
         the stops and the GPS distance closes the section,
         whenever a trail exists, stops or no stops. */
      if (t.nav && (c.routeInfo || (c.routeStops && c.routeStops.length) || (c.haulLines && c.haulLines.length))) {
        h += '<h3>🗺️ Where the truck went</h3>';
        if (c.routeInfo) {
          var startNameS353 = frameName353(c.routeInfo.start);
          h += '<div class="kv"><span>' + esc(startNameS353 ? 'Start — ' + startNameS353 : 'Start') + '</span><b>' +
            esc(fmtStamp(c.routeInfo.start.at)) + '</b></div>';
        }
        /* v299: the screen twin of the printed haul summary —
           one line per pairing, merged with the stops in
           time order.
           v353: the stops arrive CLUMPED, exactly as printed
           (stopClusters353) — one line per place with its
           stop count; no coordinates on screen either. */
        var routeRowsS299 = stopClusters353(c.routeStops).map(function (cl) { return { cluster: cl, at: cl.at || 0 }; })
          .concat((c.haulLines || []).map(function (hl) { return { haul: hl, at: +hl.at || 0 }; }));
        routeRowsS299.sort(function (x, y) { return x.at - y.at; });
        h += routeRowsS299.map(function (r) {
          if (r.haul) {
            return '<div class="kv"><span>' + esc(r.haul.from + ' – ' + r.haul.to) + '</span><b>' +
              r.haul.n + (r.haul.n === 1 ? ' load' : ' loads') + '</b></div>';
          }
          return '<div class="kv"><span>' + esc(r.cluster.label) + '</span><b>' +
            r.cluster.n + (r.cluster.n === 1 ? ' stop' : ' stops') + '</b></div>';
        }).join('');
        if (c.routeInfo) {
          var endNameS353 = frameName353(c.routeInfo.end);
          h += '<div class="kv"><span>' + esc(endNameS353 ? 'End — ' + endNameS353 : 'End') + '</span><b>' +
            esc(fmtStamp(c.routeInfo.end.at)) + '</b></div>';
          if (typeof c.routeInfo.km === 'number' && isFinite(c.routeInfo.km)) {
            h += '<div class="kv"><span>GPS distance</span><b>' + c.routeInfo.km.toFixed(1) + ' km</b></div>';
          }
        }
        h += '<div class="note" style="margin:2px 0 6px">From the truck\'s GPS trail today.</div>';
      }
      if (t.expense && (c.fills.length || c.expenses.length)) {
        h += '<h3>Fuel & expenses</h3>' + c.fills.map(function (x) {
          return '<div class="kv"><span>Fuel — ' + esc(x.station || '') + '</span><b>$' + esc(x.cost) + '</b></div>';
        }).join('') + c.expenses.map(function (x) {
          return '<div class="kv"><span>' + esc(x.what) + '</span><b>$' + esc(x.cost) + '</b></div>';
        }).join('');
      }
      if (t.incident && c.incidents.length) {
        h += '<h3>Incidents</h3>' + c.incidents.map(function (x) {
          return '<div class="kv"><span>' + esc(x.tab) + '</span><b>' + esc(x.desc.slice(0, 40)) + '</b></div>';
        }).join('');
      }
      /* v247 (MANIFEST-PTI): the screen twin of the printed PTI
         section — same rows, same words (the v69 law). */
      if (t.pti && c.pti && (c.pti.pre || c.pti.post)) {
        h += '<h3>PTI — inspections</h3>' +
          '<div class="kv"><span>Pre-trip</span><b>' + esc(c.pti.pre ? ptiRowText(c.pti.pre) : 'Not filed') + '</b></div>' +
          '<div class="kv"><span>Post-trip</span><b>' + esc(c.pti.post ? ptiRowText(c.pti.post) : 'Not filed') + '</b></div>';
      }
      if (t.start) h += '<div class="kv"><span>Start Time</span><b>' + esc(c.startT) + '</b></div>';
      if (t.end) h += '<div class="kv"><span>End Time</span><b>' + esc(c.endT) + '</b></div>';
      /* v83: tracker-sourced times are labelled as such (see docLines) */
      var trkParts2 = [];
      if (c.startSrc === 'tracker' && c.startT !== '—') trkParts2.push('Start');
      if (c.endSrc === 'tracker' && c.endT !== '—') trkParts2.push('End');
      if (trkParts2.length) {
        h += '<div class="note" style="margin:2px 0 6px">' + trkParts2.join(' and ') + (trkParts2.length > 1 ? ' times are' : ' time is') + ' from the tracker — no confirmed dispatch time for this day.</div>';
      }
      /* v40: odometer readings + live miles ride together — the live
         number is the tracking, the odometer only confirms it.
         v87: the readings print as ONE Odometer line — start → end
         with the day's km (see odoLineText). */
      if (t.odo) { var ol2 = odoLineText(c); h += '<div class="kv"><span>Odometer</span><b>' + esc(ol2 !== null ? ol2 : 'no readings captured') + '</b></div>'; }
      /* v206 (P1): the start/end dash photos keep their download
         doors here, on the day's record — the same App._photoDl
         door every record view uses. Screen preview only; the
         printed document stays text, like every P1 door. */
      if (t.odo && (c.odoStartPhoto || c.odoEndPhoto) && window.App && App._photoDl) {
        if (c.odoStartPhoto) h += '<div style="margin:2px 0">📸 Starting dash photo ' + App._photoDl(c.odoStartPhoto, 'odometer-start-' + d) + '</div>';
        if (c.odoEndPhoto) h += '<div style="margin:2px 0">📸 Ending dash photo ' + App._photoDl(c.odoEndPhoto, 'odometer-end-' + d) + '</div>';
      }
      if (t.odo && c.liveKmAny) h += '<div class="kv"><span>Miles (live)</span><b>' + (Math.round(c.liveKm * 10) / 10).toFixed(1) + ' km</b></div>';
      /* v299 (MANIFEST-JARGON-BLOCK): the screen twin of the
         printed removal — no discrepancy details block under
         Miles (live); the figure stands alone. */
      /* v291 (MANIFEST-LOADS-SUMMARY): the screen twin of the
         printed ONE loads line (see docLines) — the count of
         record plus the site by name. The GPS-count block and
         the source annotations that stood here are gone with
         their printed twins. */
      if (t.loads && c.loads > 0) {
        h += '<div class="kv"><span>🚛 Loads</span><b>' + c.loads + (c.loadsSite ? ' on site — ' + esc(c.loadsSite) : '') + '</b></div>';
      }
      /* v283 (MANIFEST-PEG-PLACES): the screen twin of the
         printed Loaded at / Dumped at lines (see docLines) —
         the day's pegged places, by name. */
      if (c.pegPlaces) {
        if (c.pegPlaces.load.length) h += '<div class="kv"><span>📍 Loaded at</span><b>' + esc(c.pegPlaces.load.join(' → ')) + '</b></div>';
        if (c.pegPlaces.dump.length) h += '<div class="kv"><span>📍 Dumped at</span><b>' + esc(c.pegPlaces.dump.join(' → ')) + '</b></div>';
      }
      /* v87: no blocked-reason note here anymore — silence over
         blame (see the v87 note where GEOLOAD_BLOCKED used to be). */
      if (t.earned) h += '<div class="kv"><span>' + (c.live ? 'Income earned today so far' : 'Total Earned Income') + '</span><b>$' + c.earned.toFixed(2) + '</b></div>';
      /* v191 (MANIFEST-EDIT): the day's own note, when the Edit
         door wrote one, shows on the face of the day. */
      if (c.dayNote) h += '<div class="note" style="margin-top:6px">📝 ' + esc(c.dayNote) + '</div>';
      /* v247: the completeness fact, same words as the printed
         document (see docLines). */
      if (t.pti && !c.live) {
        h += c.complete
          ? '<div class="note" style="margin-top:6px">✅ Manifest complete — PTI (pre + post) and GPS trail on file.</div>'
          : '<div class="note" style="margin-top:6px">Manifest incomplete — missing: ' + esc((c.missing || []).join(' · ')) + '.</div>';
      }
        return h;
      }

      if (mnMode === 'range') {
        h += '<div class="card" id="mn_preview"><h3>Preview — ' + esc(mnFrom) + ' → ' + esc(mnTo) + '</h3><div id="mn_doc">';
        if (!rangeDays.length) h += '<div class="empty">Pick a From and a To date above.</div>';
        var rcs = [];
        /* v344 (MULTI-DAY-MANIFEST-COLUMNS): the preview is the
           SAME table the PDF prints — Date · km · Hours · Loads
           · Fuel, one row per day, every figure in its own
           straight right-aligned column (the v331 loose kv lines
           are retired on the owner's Nov 5, 2026 22:41 word).
           Nothing else rides a row: no odometer, no start/end
           times, no GPS, no pay. */
        if (rangeDays.length) {
          h += '<table class="mn-sumtab"><tr><th>Date</th><th class="r">km</th><th class="r">Hours</th><th class="r">Loads</th><th class="r">Fuel</th></tr>';
        }
        rangeDays.forEach(function (rd) {
          var rc = collect(rd);
          rcs.push(rc);
          var s = daySummaryOf(rc);
          h += '<tr><td>' + esc(fmtDayLabel(rd)) + '</td>' +
            '<td class="r">' + fmtN1(s.km) + '</td>' +
            '<td class="r">' + fmtN1(s.hours) + '</td>' +
            '<td class="r">' + (s.loads || 0) + '</td>' +
            '<td class="r">' + fmtN1(s.fuelL) + '</td></tr>';
        });
        if (rangeDays.length) h += '</table>';
        if (rangeDays.length) {
          var rtS = sumCollected(rcs);
          /* Page 2's totals, previewed the same way: total
             hours, total fuel, total loads — NO km (the owner
             did not ask for a range km total; it is left off,
             named, not silently added) and NO pay. */
          h += '<h3>Period total</h3>' +
            '<div class="kv"><span>Total hours</span><b>' + fmtH1(rtS.hours) + '</b></div>' +
            '<div class="kv"><span>Total fuel</span><b>' + fmtL1(rtS.fuelL) + '</b></div>' +
            '<div class="kv"><span>Total loads</span><b>' + rtS.loads + '</b></div>';
        }
        h += '</div>';
      } else {
      h += '<div class="card" id="mn_preview"><h3>Preview — ' + esc(d) + '</h3><div id="mn_doc">';
      h += dayBodyHtml(d, c, t);

      /* v191: the Edit door — PAST days only, and quiet by the
         LOOK-TWICE rule: one small ghost button under the day,
         the form behind the tap. Print stays the primary. */
      if (d < App._today()) {
        h += '<div class="row" style="margin-top:8px"><button class="btn small ghost" id="mn_edit_btn" style="flex:1">✏️ Edit this day</button></div>' +
          '<div id="mn_edit_wrap" style="display:none;margin-top:8px">' +
          '<label class="f">End odometer (km)</label>' +
          '<input id="mn_edit_odo" type="number" inputmode="decimal" min="0" step="1" value="' + (c.odoEnd !== null && c.odoEnd !== undefined ? esc(c.odoEnd) : '') + '">' +
          '<label class="f">Day note</label>' +
          '<textarea id="mn_edit_note" rows="2" style="width:100%">' + esc(c.dayNote || '') + '</textarea>' +
          '<button class="btn navy" id="mn_edit_save" style="width:100%;margin-top:6px">Save the day\'s fix</button>' +
          '<div class="note" style="margin-top:6px">Fixes this day after the fact. The end reading also becomes the next morning\'s starting point, the way your sheet chains.</div>' +
          '</div>';
      }
      h += '</div>';
      } /* v184: end of the one-day preview (range drew its own above) */
      h += '<div class="row"><button class="btn navy" id="mn_print">🖨️ Print / PDF</button>' +
        '<button class="btn ghost" id="mn_dl">⬇️ Download</button></div>' +
        '<div class="note" id="mn_msg"></div></div>';

      body.innerHTML = h;
      /* v355 (addendum 6): the big skip / bring-back buttons —
         one tap, for today only, then the page repaints with
         the stop's new state. */
      body.querySelectorAll('[data-split-skip]').forEach(function (b) {
        b.onclick = function () {
          try { if (window.SplitShift && SplitShift.toggleSkip) SplitShift.toggleSkip(b.getAttribute('data-split-skip')); } catch (e) {}
          Meticulous.modules.manifest.render(body);
        };
      });
      /* v355 (addendum 2): tap a recorded stop's name to fix it
         once — the editor opens in place of the name; the fixed
         name sticks for that stop (SplitShift.renameStop). */
      body.querySelectorAll('[data-split-stop]').forEach(function (sp) {
        sp.onclick = function () {
          if (sp.getAttribute('data-editing')) return;
          sp.setAttribute('data-editing', '1');
          var key = sp.getAttribute('data-split-stop');
          var cur = sp.textContent;
          sp.innerHTML = '';
          var inp = document.createElement('input');
          inp.value = cur;
          inp.style.cssText = 'width:170px;padding:6px;font-size:14px';
          var sv = document.createElement('button');
          sv.type = 'button'; sv.className = 'btn primary'; sv.textContent = 'Save name';
          sv.style.cssText = 'margin-left:6px;padding:6px 12px';
          sv.onclick = function (ev) {
            ev.stopPropagation();
            try { if (window.SplitShift && SplitShift.renameStop) SplitShift.renameStop(key, inp.value); } catch (e) {}
            Meticulous.modules.manifest.render(body);
          };
          sp.appendChild(inp); sp.appendChild(sv);
          try { inp.focus(); inp.select(); } catch (e) {}
        };
      });
      var mnAuditB = body.querySelector('#mn_audit');
      if (mnAuditB) mnAuditB.onclick = function () { maniAudit = true; Meticulous.modules.manifest.render(body); };
      body.querySelector('#mn_date').onchange = function (e) {
        /* v319: never store a date that fails maniDateOk — a
           mangled picker value becomes today instead of sticking. */
        App._store.set('mani_date', maniDateOk(e.target.value) ? e.target.value : App._today()); Meticulous.modules.manifest.render(body);
      };
      body.querySelectorAll('[data-tg]').forEach(function (cb) {
        cb.onchange = function () {
          setToggle(cb.getAttribute('data-tg'), cb.checked);
          Meticulous.modules.manifest.render(body);
        };
      });
      /* v69: window.print() is a silent no-op inside the Android
         shell (bare WebView, no print bridge) and the old blob-.txt
         download click is ignored there too (no DownloadListener) —
         in the shell BOTH buttons now make a real PDF and save it to
         the device Documents folder via js/pdfexport.js. In a plain
         browser, Print keeps the system print dialog exactly as
         before and Download saves the same PDF as a file. */
      /* v184: mode + range wiring. */
      var modeDayBtn = body.querySelector('#mn_mode_day');
      if (modeDayBtn) modeDayBtn.onclick = function () { App._store.set('mani_mode', 'day'); Meticulous.modules.manifest.render(body); };
      var modeRangeBtn = body.querySelector('#mn_mode_range');
      if (modeRangeBtn) modeRangeBtn.onclick = function () {
        App._store.set('mani_mode', 'range');
        if (!G('mani_from', '')) App._store.set('mani_from', d);
        if (!G('mani_to', '')) App._store.set('mani_to', d);
        Meticulous.modules.manifest.render(body);
      };
      /* v191 (MANIFEST-EDIT): the Edit door's wiring — toggle the
         form, and on save write the day's record through the
         same stores collect() reads: mft_day_edits (the top
         layer) + a dated odo_readings entry at the day's end
         (source 'manifest-edit') so the corrected end chains
         into the next day's start. Re-saving replaces the day's
         earlier manifest-edit reading; clearing both fields
         removes the day's edit entirely. */
      var editBtn = body.querySelector('#mn_edit_btn');
      if (editBtn) {
        var editWrap = body.querySelector('#mn_edit_wrap');
        editBtn.onclick = function () {
          if (editWrap) editWrap.style.display = (editWrap.style.display === 'none') ? '' : 'none';
        };
        body.querySelector('#mn_edit_save').onclick = function () {
          var msgEl2 = body.querySelector('#mn_msg');
          var odoRaw = String((body.querySelector('#mn_edit_odo') || {}).value || '').trim();
          var noteRaw = String((body.querySelector('#mn_edit_note') || {}).value || '').trim();
          var endOdo = (odoRaw === '') ? null : parseFloat(odoRaw);
          if (endOdo !== null && !(endOdo > 0)) {
            if (msgEl2) msgEl2.textContent = 'That end odometer is not a number — nothing saved.';
            return;
          }
          var edits = G('mft_day_edits', {}) || {};
          if (endOdo === null && !noteRaw) delete edits[d];
          else edits[d] = { endOdo: endOdo, note: noteRaw, editedAt: Date.now() };
          App._store.set('mft_day_edits', edits);
          if (endOdo !== null) {
            /* v242 trap 1: a manifest-edit reading lands in the
               ACTIVE profile's log (the day is edited while it is
               on screen, under its own profile). */
            var rl2 = G(wpOdoLogKey(), []) || [];
            var dp2 = String(d).split('-');
            var ts2 = new Date(+dp2[0], +dp2[1] - 1, +dp2[2], 23, 59, 59).getTime();
            rl2 = rl2.filter(function (r) { return !(r && r.source === 'manifest-edit' && r.date === d); });
            rl2.push({ ts: ts2, date: d, value: endOdo, source: 'manifest-edit' });
            App._store.set(wpOdoLogKey(), rl2);
          }
          Meticulous.modules.manifest.render(body);
          var msgEl3 = body.querySelector('#mn_msg');
          if (msgEl3) msgEl3.textContent = 'Saved — this day now carries your fix.';
        };
      }
      var fromEl = body.querySelector('#mn_from');
      if (fromEl) fromEl.onchange = function (e) { App._store.set('mani_from', maniDateOk(e.target.value) ? e.target.value : App._today()); Meticulous.modules.manifest.render(body); };
      var toEl = body.querySelector('#mn_to');
      if (toEl) toEl.onchange = function (e) { App._store.set('mani_to', maniDateOk(e.target.value) ? e.target.value : App._today()); Meticulous.modules.manifest.render(body); };
      function rangeLines() {
        /* v331 (MULTI-DAY-MANIFEST-SUMMARY): the printed range
           document IS the summary — page 1: the title + one line
           per day (date · km · hours · loads · fuel litres);
           page 2 (a real break, MetPdf 'pb'): the range totals —
           total hours, total fuel, total loads ONLY. Total km
           for the range is NOT on it (not specified by the
           owner — left off, named in the queue log), and no pay
           figure appears anywhere. The single-day document
           (docLines) is untouched. Totals come from rangeTotals,
           the same reducer the preview totals with. */
        var lines = [{ k: 'title', a: 'MANIFEST — ' + mnFrom + ' → ' + mnTo }];
        if (!rangeDays.length) {
          lines.push({ k: 'note', a: 'No days in this range.' });
          return lines;
        }
        /* v344 (MULTI-DAY-MANIFEST-COLUMNS, owner Nov 5, 2026
           22:41 — screenshot of the Oct 1–31 PDF): the per-day
           lines are a REAL TABLE now (MetPdf 'cols'), not loose
           right-aligned text: Date in its own column, and every
           day's km / hours / loads / fuel in ONE straight column
           under its plain heading, rows aligned. The figures are
           the same daySummaryOf facts as before — only the shape
           changed. Page 2 is unchanged. */
        lines.push({ k: 'cols', head: true, compact: true, cells: [{ t: 'Date' }, { t: 'km', r: 1 }, { t: 'Hours', r: 1 }, { t: 'Loads', r: 1 }, { t: 'Fuel', r: 1 }] });
        rangeDays.forEach(function (rd) {
          var s = daySummaryOf(collect(rd));
          lines.push({ k: 'cols', compact: true, cells: [{ t: fmtDayLabel(rd) }, { t: fmtN1(s.km), r: 1 }, { t: fmtN1(s.hours), r: 1 }, { t: '' + (s.loads || 0), r: 1 }, { t: fmtN1(s.fuelL), r: 1 }] });
        });
        var rtP = rangeTotals(rangeDays);
        lines.push({ k: 'pb' });
        lines.push({ k: 'h', a: 'PERIOD TOTAL' });
        lines.push({ k: 'kv', a: 'Total hours', b: fmtH1(rtP.hours) });
        lines.push({ k: 'kv', a: 'Total fuel', b: fmtL1(rtP.fuelL) });
        lines.push({ k: 'kv', a: 'Total loads', b: '' + rtP.loads });
        return lines;
      }
      body.querySelector('#mn_print').onclick = function () {
        if (mnMode === 'range') {
          if (window.MetPdf && MetPdf.isNativeShell()) saveManifestLines(body, 'Manifest — ' + mnFrom + ' to ' + mnTo, rangeLines(), 'manifest-' + mnFrom + '-to-' + mnTo + '.pdf');
          else window.print();
          return;
        }
        if (window.MetPdf && MetPdf.isNativeShell()) saveManifestPdf(body, d, c, t);
        else window.print();
      };
      body.querySelector('#mn_dl').onclick = function () {
        if (mnMode === 'range') { saveManifestLines(body, 'Manifest — ' + mnFrom + ' to ' + mnTo, rangeLines(), 'manifest-' + mnFrom + '-to-' + mnTo + '.pdf'); return; }
        saveManifestPdf(body, d, c, t);
      };
    }
  };
})();
