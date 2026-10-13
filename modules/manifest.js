/* Manifest / Daily Log — aggregates the day (Meticulous.modules convention) */
(function () {
  'use strict';
  var esc = function (s) { return App._esc(s); };
  var G = function (k, d) { return App._store.get(k, d); };

  var SECTIONS = [
    ['dispatch', 'Dispatch list'], ['nav', 'Navigation list'], ['expense', 'Expense list'],
    ['incident', 'Incident list'], ['start', 'Start Time'], ['end', 'End Time'],
    ['odoStart', 'Start Odometer'], ['odoEnd', 'End Odometer'], ['earned', 'Total Earned Income']
  ];

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
    return { dispatches: dispatches, navLog: navLog, fills: fills, expenses: expenses, incidents: incidents, sessions: sessions, earned: earned, startT: startT, endT: endT };
  }

  function toggles() {
    var t = G('mani_toggles', null);
    if (!t) { t = {}; SECTIONS.forEach(function (s) { t[s[0]] = true; }); }
    return t;
  }

  Meticulous.modules.manifest = {
    status: function () { return 'Daily log · ' + dayStr(); },
    render: function (body) {
      var d = dayStr(), c = collect(d), t = toggles();
      var h = '<div class="card"><h3>📝 Manifest — <input type="date" id="mn_date" value="' + d + '" style="width:auto"></h3>';
      h += '<div class="note">Toggle sections on/off for this manifest.</div>';
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
          var tt = toggles(); tt[cb.getAttribute('data-tg')] = cb.checked;
          App._store.set('mani_toggles', tt); Meticulous.modules.manifest.render(body);
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
