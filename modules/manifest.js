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
    'sites-too-close': 'The load-site and dump-site pins on this dispatch are too close together to tell apart, so no loads were GPS-counted this day.'
  };

  function dayStr() { return G('mani_date', App._today()); }

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
    var startT = sessions.length ? new Date(sessions[0].endedAt - sessions[0].seconds * 1000).toLocaleTimeString() : '—';
    var endT = sessions.length ? new Date(sessions[sessions.length - 1].endedAt).toLocaleTimeString() : '—';
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
    return { dispatches: dispatches, navLog: navLog, fills: fills, expenses: expenses, incidents: incidents, sessions: sessions, earned: earned, startT: startT, endT: endT, odoStart: odoStart, odoEnd: odoEnd, liveKm: liveKm, liveKmAny: liveKmAny, milesIssues: milesIssues, geoDay: geoDay };
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

  Meticulous.modules.manifest = {
    status: function () { return 'Daily log · ' + dayStr(); },
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
          return '<div class="kv"><span>' + esc(x.name) + '</span><b>' + esc(new Date(x.at).toLocaleTimeString()) + '</b></div>';
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
        (c.geoDay.events || []).forEach(function (ev, i) {
          h += '<div class="kv"><span>Load ' + (i + 1) + ' — dumped</span><b>' +
            esc(new Date(ev.t).toLocaleTimeString()) + '</b></div>';
        });
      } else if (t.geoloads && c.geoDay && c.geoDay.blocked && GEOLOAD_BLOCKED[c.geoDay.blocked]) {
        h += '<div class="note" style="margin:6px 0">🚛 ' + esc(GEOLOAD_BLOCKED[c.geoDay.blocked]) + '</div>';
      }
      if (t.earned) h += '<div class="kv"><span>Total Earned Income</span><b>$' + c.earned.toFixed(2) + '</b></div>';
      h += '</div>';
      h += '<div class="row"><button class="btn navy" id="mn_print">🖨️ Print / PDF</button>' +
        '<button class="btn ghost" id="mn_dl">⬇️ Download</button></div></div>';

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
      body.querySelector('#mn_print').onclick = function () { window.print(); };
      body.querySelector('#mn_dl').onclick = function () {
        var txt = 'MANIFEST — ' + d + '\n\n' + body.querySelector('#mn_doc').innerText;
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
        a.download = 'manifest-' + d + '.txt'; a.click();
      };
    }
  };
})();
