/* Manifest / Daily Log — aggregates the day (Meticulous.modules convention) */
(function () {
  'use strict';
  var esc = function (s) { return App._esc(s); };
  var G = function (k, d) { return App._store.get(k, d); };

  var SECTIONS = [
    ['dispatch', 'Dispatch list'], ['nav', 'Navigation list'], ['expense', 'Expense list'],
    ['incident', 'Incident list'], ['start', 'Start Time'], ['end', 'End Time'],
    ['odo', 'Odometer'], ['loads', 'Loads hauled'],
    ['geoloads', 'GPS-counted loads'],
    ['earned', 'Total Earned Income']
  ];

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

  function dayStr() { return G('mani_date', App._today()); }

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

  /* v87: ONE Odometer line for the day (owner, Oct 15: there were
     "no Odos on the manifest either… even though I gave you the
     starting and ending" — his own sheet carries the pair every
     day). Start → end with the day's km between them:
     "168,759 → 168,926 km (167 km)". An end that was never
     captured is SAID ("end not recorded"), never invented; no
     captures at all → no line (null). Replaces the separate
     Start/End Odometer lines. */
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
    var dispatches = (G('dsp_list', [])).filter(function (x) { return x.date === d; });
    var navLog = (G('nav_log', [])).filter(function (x) { return x.at.slice(0, 10) === d; });
    var fills = (G('fuel_fills', [])).filter(function (x) { return x.date === d; });
    var expenses = (G('fuel_expenses', [])).filter(function (x) { return x.date === d; });
    var incidents = (G('dmg_reports', [])).filter(function (x) { return x.at.slice(0, 10) === d; });
    var sessions = (G('sessions', [])).filter(function (x) { return x.date === d; });
    var revEntries = (G('rev_entries', [])).filter(function (x) { return x.date === d; });
    var extras = (G('rev_extras', [])).filter(function (x) { return x.date === d; });
    var o = G('onboarding', {});
    var rate = parseFloat(o.payRate) || 0, earned = 0;
    revEntries.forEach(function (e) {
      if (o.payStandard === 'Hourly') earned += (parseFloat(e.hours) || 0) * rate;
      else if (o.payStandard === 'Miles') earned += (parseFloat(e.miles) || 0) * rate;
      else if (o.payStandard === 'Trip') earned += (parseFloat(e.trips) || 0) * rate;
      else if (o.payStandard === 'Weight') earned += (parseFloat(e.tons) || 0) * rate;
    });
    extras.forEach(function (x) { earned += parseFloat(x.amount) || 0; });
    var startT = sessions.length ? fmtStartOf(sessions[0]) : '—';
    var endT = sessions.length ? fmtStamp(sessions[sessions.length - 1].endedAt) : '—';
    /* v40: the day's odometer readings live on the session entries
       (by-mile day photos, v39), and so do live miles + the miles
       reconciliation verdict (js/miles.js). First start reading and
       last end reading of the day win; live miles sum across sessions. */
    /* v50: GPS/geofence load counting for the day (js/geoloads.js) —
       count + dump events + the site pair used, or the reason counting
       could not run. Shown separately; ticket loads stay the pay record. */
    var geoDay = ((G('geoloads', { days: {} }).days) || {})[d] || null;
    var odoStart = null, odoEnd = null, liveKm = 0, liveKmAny = false, milesIssues = [];
    sessions.forEach(function (s) {
      if (odoStart === null && s.startOdo) odoStart = s.startOdo;
      if (s.endOdo) odoEnd = s.endOdo;
      if (typeof s.liveKm === 'number') { liveKm += s.liveKm; liveKmAny = true; }
      if (s.milesStatus === 'discrepancy' && s.milesReport) milesIssues.push(s);
    });
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
          }
        }
      }
    } catch (e) { live = null; }
    if (live) {
      if (!sessions.length) startT = fmtStamp(live.startMs);
      endT = (live.status === 'running') ? 'Still working' : 'Paused';
      if (odoStart === null && live.startOdo !== null) odoStart = live.startOdo;
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
      if (tkEndMs !== null) { endT = fmtClock(tkEndMs); endSrc = 'card'; }
      else if (anyCompleted && dspStartMs !== null && window.TicketOCR && TicketOCR.summarizeTickets) {
        var fh = 0;
        dayDsp.forEach(function (x) {
          if (x.status === 'completed') fh += TicketOCR.summarizeTickets(x.tickets || [], 0).totalForemanHours || 0;
        });
        if (fh > 0) { cardEndMs = dspStartMs + fh * 3600000; endT = fmtClock(cardEndMs); endSrc = 'card'; }
      }
      if (endSrc === 'tracker' && dspEndMs !== null) { endT = fmtClock(dspEndMs); endSrc = 'dispatch'; }
    }

    /* v82 (item 3b): the day's LOADS — the count the driver himself
       confirmed, which the manifest never had (its only loads line
       was the GPS cross-check, and the GPS counter cannot run when
       the dump site is given out loud on site — so a full day of
       hauling printed Loads 0). Priority, never a sum — the sources
       are overlapping records of the SAME loads:
         1. counts carried on the day's tickets (confirmed in the
            close flow — the haul card itself carries no count);
         2. the session's +1 load taps (app.js manualLoads), plus
            a still-running day's live taps;
         3. a Weight day's counted loads (session loadCount).
       The dispatch record's own loads field is NOT a source: the
       form defaults it to '1', so it cannot prove a count. */
    var loads = 0, loadsSrc = '';
    var tkLoads = 0;
    dayDsp.forEach(function (x) {
      (x.tickets || []).forEach(function (tk) {
        var v = parseFloat(tk && tk.loads);
        if (v > 0) tkLoads += v;
      });
    });
    if (tkLoads > 0) { loads = tkLoads; loadsSrc = 'tickets'; }
    if (!loads) {
      var tapLoads = 0;
      sessions.forEach(function (s) { tapLoads += parseInt(s.manualLoads, 10) || 0; });
      try {
        var trk2 = (window.App && App.tracker) || G('tracker', null);
        if (d === App._today() && trk2 && trk2.accum && (trk2.status === 'running' || trk2.status === 'paused')) {
          tapLoads += parseInt(trk2.accum.manualLoads, 10) || 0;
        }
      } catch (e) {}
      if (tapLoads > 0) { loads = tapLoads; loadsSrc = 'taps'; }
    }
    if (!loads) {
      var wLoads = 0;
      sessions.forEach(function (s) { wLoads += parseInt(s.loadCount, 10) || 0; });
      if (wLoads > 0) { loads = wLoads; loadsSrc = 'weight'; }
    }
    return { dispatches: dispatches, navLog: navLog, fills: fills, expenses: expenses, incidents: incidents, sessions: sessions, earned: earned, startT: startT, endT: endT, startSrc: startSrc, endSrc: endSrc, odoStart: odoStart, odoEnd: odoEnd, liveKm: liveKm, liveKmAny: liveKmAny, milesIssues: milesIssues, geoDay: geoDay, live: live, loads: loads, loadsSrc: loadsSrc };
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
    if (t.expense && (c.fills.length || c.expenses.length)) {
      L.push({ k: 'h', a: 'Fuel & expenses' });
      c.fills.forEach(function (x) { L.push({ k: 'kv', a: 'Fuel — ' + (x.station || ''), b: '$' + x.cost }); });
      c.expenses.forEach(function (x) { L.push({ k: 'kv', a: x.what, b: '$' + x.cost }); });
    }
    if (t.incident && c.incidents.length) {
      L.push({ k: 'h', a: 'Incidents' });
      c.incidents.forEach(function (x) { L.push({ k: 'kv', a: x.tab, b: String(x.desc || '').slice(0, 40) }); });
    }
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
       (see odoLineText); absent captures omit it entirely. */
    if (t.odo) { var ol = odoLineText(c); if (ol !== null) L.push({ k: 'kv', a: 'Odometer', b: ol }); }
    if (t.odo && c.liveKmAny) L.push({ k: 'kv', a: 'Miles (live)', b: (Math.round(c.liveKm * 10) / 10).toFixed(1) + ' km' });
    if (t.odo && c.milesIssues.length && window.LiveMiles) {
      c.milesIssues.forEach(function (s) {
        LiveMiles.reportLines(s.milesReport).forEach(function (ln) {
          L.push({ k: 'note', a: ln });
        });
      });
    }
    /* v82 (item 3b): the driver's own confirmed load count for the
       day (see collect) — printed as plain "Loads"; the GPS line
       below stays a separate cross-check. */
    if (t.loads && c.loads > 0) {
      L.push({ k: 'kv', a: 'Loads', b: String(c.loads) });
      /* v86: the note CARRIES the count — on Oct 15 a live drive
         read this annotation as the loads content and reported the
         number missing; the count now appears in the note itself
         as well as on the Loads line, so the two can never be seen
         apart. */
      if (c.loadsSrc === 'taps') L.push({ k: 'note', a: 'Counted with the +1 load button while working — ' + c.loads + (c.loads === 1 ? ' load.' : ' loads.') });
    }
    if (t.geoloads && c.geoDay && c.geoDay.sites) {
      L.push({ k: 'kv', a: 'Loads counted by GPS', b: String(c.geoDay.count || 0) });
      L.push({ k: 'note', a: 'Counted between the load site (' +
        ((c.geoDay.sites.load && c.geoDay.sites.load.label) || 'load site') + ') and the dump site (' +
        ((c.geoDay.sites.dump && c.geoDay.sites.dump.label) || 'dump site') +
        ') while the tracker was running. Ticket loads above stay the record for pay.' });
      if (c.geoDay.learnedDump) {
        L.push({ k: 'note', a: 'The dump site was not on the dispatch — the app learned it from today’s driving (' +
          Number(c.geoDay.learnedDump.lat).toFixed(5) + ', ' + Number(c.geoDay.learnedDump.lng).toFixed(5) +
          ') and will remember it for this load site. Learned counts are a cross-check only; ticket loads stay the record for pay.' });
      } else if (c.geoDay.sites.dump && c.geoDay.sites.dump.src === 'remembered') {
        L.push({ k: 'note', a: 'The dump site was remembered from an earlier day’s driving to this load site — the app learned it from the truck’s trips; nobody had to type it in.' });
      }
      if (c.geoDay.altDump) {
        L.push({ k: 'note', a: 'Another place also looked like a dump stop this day (' +
          Number(c.geoDay.altDump.lat).toFixed(5) + ', ' + Number(c.geoDay.altDump.lng).toFixed(5) +
          '). The dump site already on record was kept.' });
      }
      (c.geoDay.events || []).forEach(function (ev, i) {
        L.push({ k: 'kv', a: 'Load ' + (i + 1) + ' — dumped', b: fmtStamp(ev.t) });
      });
    }
    /* v87: no blocked-reason note here anymore — see the v87 note
       where GEOLOAD_BLOCKED used to live. Silence over blame. */
    if (t.earned) L.push({ k: 'kv', a: 'Total Earned Income', b: '$' + c.earned.toFixed(2) });
    return L;
  }

  function saveManifestPdf(body, d, c, t) {
    var msgEl = null;
    try { msgEl = body.querySelector('#mn_msg'); } catch (e) {}
    function say(txt) { if (msgEl) msgEl.textContent = txt; }
    if (window.MetPdf && typeof MetPdf.savePdf === 'function') {
      say('Making your PDF…');
      MetPdf.savePdf({ title: 'Manifest — ' + d, lines: docLines(d, c, t) }, 'manifest-' + d + '.pdf').then(
        function (r) { say(r.message); },
        function () { say('The PDF could not be saved. Try again.'); });
    } else {
      say('PDF tools are still loading — close and reopen the app, then try again.');
    }
  }

  Meticulous.modules.manifest = {
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
      var d = dayStr(), c = collect(d), t = toggles();
      var h = '<div class="card"><h3>📝 Manifest — <input type="date" id="mn_date" value="' + d + '" style="width:auto"></h3>';
      h += '<div class="note">Choose what shows on your manifest — the app remembers your choice.</div>';
      SECTIONS.forEach(function (s) {
        h += '<div class="toggle"><span>' + s[1] + '</span><label class="switch"><input type="checkbox" data-tg="' + s[0] + '"' + (t[s[0]] ? ' checked' : '') + '><span class="knob"></span></label></div>';
      });
      h += '</div>';

      h += '<div class="card" id="mn_preview"><h3>Preview — ' + esc(d) + '</h3><div id="mn_doc">';
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
      if (t.odo) { var ol2 = odoLineText(c); if (ol2 !== null) h += '<div class="kv"><span>Odometer</span><b>' + esc(ol2) + '</b></div>'; }
      if (t.odo && c.liveKmAny) h += '<div class="kv"><span>Miles (live)</span><b>' + (Math.round(c.liveKm * 10) / 10).toFixed(1) + ' km</b></div>';
      if (t.odo && c.milesIssues.length && window.LiveMiles) {
        c.milesIssues.forEach(function (s) {
          var lines = LiveMiles.reportLines(s.milesReport);
          h += '<details style="margin:8px 0"><summary style="color:#c2410c;font-weight:700;cursor:pointer">⚠️ Miles discrepancy — tap for details</summary>' +
            '<div style="font-size:13px;margin:6px 0 0 4px">' +
            lines.map(function (ln) { return '<div style="margin:3px 0">' + esc(ln) + '</div>'; }).join('') +
            '</div></details>';
        });
      }
      /* v82 (item 3b): the driver's own confirmed load count (see
         collect) — the plain Loads line; GPS below stays separate. */
      if (t.loads && c.loads > 0) {
        h += '<div class="kv"><span>🚛 Loads</span><b>' + c.loads + '</b></div>';
        if (c.loadsSrc === 'taps') h += '<div class="note" style="margin:2px 0 6px">Counted with the +1 load button while working — ' + c.loads + (c.loads === 1 ? ' load.' : ' loads.') + '</div>';
      }
      /* v50: GPS-counted loads — counted from the truck's GPS cycling
         between the active dispatch's load-site and dump-site pins
         while the tracker ran. Deliberately separate from the ticket
         loads in the dispatch entries above: tickets stay the record
         for pay; this is the location proof alongside them. */
      if (t.geoloads && c.geoDay && c.geoDay.sites) {
        h += '<div class="kv"><span>🚛 Loads counted by GPS</span><b>' + (c.geoDay.count || 0) + '</b></div>';
        h += '<div class="note" style="margin:2px 0 6px">Counted between the load site (' +
          esc((c.geoDay.sites.load && c.geoDay.sites.load.label) || 'load site') + ') and the dump site (' +
          esc((c.geoDay.sites.dump && c.geoDay.sites.dump.label) || 'dump site') +
          ') while the tracker was running. Ticket loads above stay the record for pay.</div>';
        /* v68: honesty about WHERE the dump site came from — a site
           the app learned or remembered from driving is a cross-check
           aid, never as certain as a pin the office put on the
           dispatch, and the Manifest says which kind it was. */
        if (c.geoDay.learnedDump) {
          h += '<div class="note" style="margin:2px 0 6px">📍 The dump site was not on the dispatch — the app learned it from today’s driving (' +
            Number(c.geoDay.learnedDump.lat).toFixed(5) + ', ' + Number(c.geoDay.learnedDump.lng).toFixed(5) +
            ') and will remember it for this load site. Learned counts are a cross-check only; ticket loads stay the record for pay.</div>';
        } else if (c.geoDay.sites.dump && c.geoDay.sites.dump.src === 'remembered') {
          h += '<div class="note" style="margin:2px 0 6px">📍 The dump site was remembered from an earlier day’s driving to this load site — the app learned it from the truck’s trips; nobody had to type it in.</div>';
        }
        if (c.geoDay.altDump) {
          h += '<div class="note" style="margin:2px 0 6px">📍 Another place also looked like a dump stop this day (' +
            Number(c.geoDay.altDump.lat).toFixed(5) + ', ' + Number(c.geoDay.altDump.lng).toFixed(5) +
            '). The dump site already on record was kept.</div>';
        }
        (c.geoDay.events || []).forEach(function (ev, i) {
          h += '<div class="kv"><span>Load ' + (i + 1) + ' — dumped</span><b>' +
            esc(fmtStamp(ev.t)) + '</b></div>';
        });
      }
      /* v87: no blocked-reason note here anymore — silence over
         blame (see the v87 note where GEOLOAD_BLOCKED used to be). */
      if (t.earned) h += '<div class="kv"><span>Total Earned Income</span><b>$' + c.earned.toFixed(2) + '</b></div>';
      h += '</div>';
      h += '<div class="row"><button class="btn navy" id="mn_print">🖨️ Print / PDF</button>' +
        '<button class="btn ghost" id="mn_dl">⬇️ Download</button></div>' +
        '<div class="note" id="mn_msg"></div></div>';

      body.innerHTML = h;
      body.querySelector('#mn_date').onchange = function (e) {
        App._store.set('mani_date', e.target.value); Meticulous.modules.manifest.render(body);
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
      body.querySelector('#mn_print').onclick = function () {
        if (window.MetPdf && MetPdf.isNativeShell()) saveManifestPdf(body, d, c, t);
        else window.print();
      };
      body.querySelector('#mn_dl').onclick = function () { saveManifestPdf(body, d, c, t); };
    }
  };
})();
