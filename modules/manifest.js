/* Manifest / Daily Log — aggregates the day (Meticulous.modules convention) */
(function () {
  'use strict';
  var esc = function (s) { return App._esc(s); };
  var G = function (k, d) { return App._store.get(k, d); };

  var SECTIONS = [
    ['dispatch', 'Dispatch list'], ['nav', 'Navigation list'], ['expense', 'Expense list'],
    ['incident', 'Incident list'], ['start', 'Start Time'], ['end', 'End Time'],
    ['odoStart', 'Start Odometer'], ['odoEnd', 'End Odometer'], ['geoloads', 'GPS-counted loads'],
    ['earned', 'Total Earned Income']
  ];

  /* v50: why GPS load counting could not run for a day (stored on the
     geoloads day record by js/geoloads.js). Plain words, shown once. */
  var GEOLOAD_BLOCKED = {
    'no-site-coords': 'GPS load counting needs site coordinates on the dispatch — none were set, so no loads were GPS-counted this day.',
    'one-site': 'GPS load counting needs BOTH site pins on the dispatch (load site and dump site) — this dispatch has only one, so no loads were GPS-counted this day.',
    'sites-too-close': 'The load-site and dump-site pins on this dispatch are too close together to tell apart, so no loads were GPS-counted this day.',
    /* v68: the dispatch had a load pin but no dump pin (the normal
       dump-work case — the dump is given verbally on site), so the
       app set out to learn the dump site from the driving itself
       and no complete load-and-dump trip was seen. */
    'learning': 'GPS load counting is still learning where this run dumps — the dump site is given out loud on site, so the app learns it from the driving, and no complete load-and-dump trip was seen yet this day, so no loads were GPS-counted.',
    /* v68: two different places both looked like the dump site
       before the first round trip was finished. */
    'ambiguous-dump': 'GPS load counting found two different places that both looked like the dump site this day and could not tell which one was right, so it counted nothing and learned nothing — ticket loads stay the record for pay.'
  };

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
    return { dispatches: dispatches, navLog: navLog, fills: fills, expenses: expenses, incidents: incidents, sessions: sessions, earned: earned, startT: startT, endT: endT, odoStart: odoStart, odoEnd: odoEnd, liveKm: liveKm, liveKmAny: liveKmAny, milesIssues: milesIssues, geoDay: geoDay, live: live };
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
    if (t.odoStart && c.odoStart !== null) L.push({ k: 'kv', a: 'Start Odometer', b: Number(c.odoStart).toLocaleString('en-CA') + ' km' });
    if (t.odoEnd && c.odoEnd !== null) L.push({ k: 'kv', a: 'End Odometer', b: Number(c.odoEnd).toLocaleString('en-CA') + ' km' });
    if (t.odoEnd && c.liveKmAny) L.push({ k: 'kv', a: 'Miles (live)', b: (Math.round(c.liveKm * 10) / 10).toFixed(1) + ' km' });
    if (t.odoEnd && c.milesIssues.length && window.LiveMiles) {
      c.milesIssues.forEach(function (s) {
        LiveMiles.reportLines(s.milesReport).forEach(function (ln) {
          L.push({ k: 'note', a: ln });
        });
      });
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
    } else if (t.geoloads && c.geoDay && c.geoDay.blocked && GEOLOAD_BLOCKED[c.geoDay.blocked]) {
      L.push({ k: 'note', a: GEOLOAD_BLOCKED[c.geoDay.blocked] });
    }
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
      /* v40: odometer readings + live miles ride together — the live
         number is the tracking, the odometer only confirms it. */
      if (t.odoStart && c.odoStart !== null) h += '<div class="kv"><span>Start Odometer</span><b>' + Number(c.odoStart).toLocaleString('en-CA') + ' km</b></div>';
      if (t.odoEnd && c.odoEnd !== null) h += '<div class="kv"><span>End Odometer</span><b>' + Number(c.odoEnd).toLocaleString('en-CA') + ' km</b></div>';
      if (t.odoEnd && c.liveKmAny) h += '<div class="kv"><span>Miles (live)</span><b>' + (Math.round(c.liveKm * 10) / 10).toFixed(1) + ' km</b></div>';
      if (t.odoEnd && c.milesIssues.length && window.LiveMiles) {
        c.milesIssues.forEach(function (s) {
          var lines = LiveMiles.reportLines(s.milesReport);
          h += '<details style="margin:8px 0"><summary style="color:#c2410c;font-weight:700;cursor:pointer">⚠️ Miles discrepancy — tap for details</summary>' +
            '<div style="font-size:13px;margin:6px 0 0 4px">' +
            lines.map(function (ln) { return '<div style="margin:3px 0">' + esc(ln) + '</div>'; }).join('') +
            '</div></details>';
        });
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
      } else if (t.geoloads && c.geoDay && c.geoDay.blocked && GEOLOAD_BLOCKED[c.geoDay.blocked]) {
        h += '<div class="note" style="margin:6px 0">🚛 ' + esc(GEOLOAD_BLOCKED[c.geoDay.blocked]) + '</div>';
      }
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
