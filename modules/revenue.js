/* Meticulous — Revenue module (standalone, complete)
   Pay periods (7/14/30/45/60/custom), manual earnings entries, extras,
   summary cards, canvas bar chart, Manifest export hook, tracker onSession.
   Persists via App._store (localStorage, mt_ prefix). Firebase via FB.saveDoc.
*/
(function () {
  'use strict';
  window.Meticulous = window.Meticulous || {};
  Meticulous.modules = Meticulous.modules || {};

  var S = function (k, d) { return App._store.get('rev_' + k, d); };
  var W = function (k, v) { App._store.set('rev_' + k, v); };
  var esc = function (s) { return App._esc(s); };

  var PERIOD_OPTS = [
    ['7', '7 days'], ['14', '14 days'], ['30', '30 days'],
    ['45', '45 days'], ['60', '60 days'], ['custom', 'Custom']
  ];

  function entries() { return S('entries', []); }
  function extras() { return S('extras', []); }
  function saveEntries(e) {
    W('entries', e);
    if (window.FB && FB.saveDoc) e.forEach(function (x, i) {
      try { FB.saveDoc('revenue', 'e' + i + '_' + (x.date || ''), x); } catch (err) {}
    });
  }

  /* Amount for an entry: explicit amount wins, else derive from pay standard (legacy entries). */
  function payFor(e, std, rate) {
    var amt = parseFloat(e.amount);
    if (amt > 0) return amt;
    rate = parseFloat(rate) || 0;
    if (std === 'hourly') return (parseFloat(e.hours) || 0) * rate;
    if (std === 'miles') return (parseFloat(e.miles) || 0) * rate;
    if (std === 'trip') return (parseFloat(e.trips) || 0) * rate;
    if (std === 'weight') return (parseFloat(e.tons) || 0) * rate;
    return 0;
  }

  function periodDays() {
    var p = S('period', '30');
    if (p === 'custom') {
      var a = S('customA', ''), b = S('customB', '');
      if (a && b && b >= a) {
        return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000) + 1;
      }
      return 30;
    }
    return parseInt(p, 10) || 30;
  }

  function inPeriod(dateStr) {
    if (!dateStr) return false;
    var p = S('period', '30');
    if (p === 'custom') {
      var a = S('customA', ''), b = S('customB', '');
      if (!a || !b) return true;
      return dateStr >= a && dateStr <= b;
    }
    var d = new Date(dateStr + 'T12:00:00'), now = new Date();
    return (now - d) / 86400000 <= (parseInt(p, 10) || 30);
  }

  /* ---- v38: one per-day aggregation feeds the period summary, the chart
     and the Month view, so every number on screen comes from the same math.
     Per day: base = entries priced by payFor + extras, plus the live
     tracker session (A1) described below.
     NO travel bonus is applied anywhere in Revenue (Asjad, Oct 13, 2026):
     his recorded hours — tracker start-to-end spans and hours-sheet days —
     ALREADY include travel time, so adding the bonus here would
     double-count it. onboarding.travelBonus belongs only to the
     foreman-ticket path in Dispatch/Manifest, where the base hours are the
     foreman's shorter ticket hours. That path is untouched. */

  function payCtx() {
    var o = App._store.get('onboarding', {});
    return {
      std: (o.payStandard || 'hourly').toLowerCase(),
      rate: parseFloat(o.payRate) || 0
    };
  }

  /* A1: the currently running/paused tracker session, valued live and
     attributed to today (the day it will be stopped on — stopped sessions
     are dated by their end day in app.js stopSessionAt). Seconds are
     computed exactly like the dashboard clock (app.js trackerTick).
     Read-only: nothing is written until STOP. */
  function liveSession() {
    try {
      var t = (window.App && App.tracker) || App._store.get('tracker', null);
      if (!t || !t.status || t.status === 'idle') return null;
      var sec = t.elapsed || 0;
      if (t.status === 'running') sec += Math.floor((Date.now() - (t.startTs || Date.now())) / 1000);
      if (!(sec > 0)) return null;
      return { date: App._today(), seconds: sec, hours: sec / 3600 };
    } catch (e) { return null; }
  }

  /* Map: dateStr -> { hours, base, extrasAmt, amount, hasEntry, live }
     - hours: worked hours exactly as recorded (entries' hours + live
       session hours) — they already include travel; nothing is added.
     - amount: base (entries by payFor + live session value) + extras. */
  function dayAgg() {
    var ctx = payCtx();
    var o = App._store.get('onboarding', {});
    var map = {};
    function slot(ds) {
      if (!map[ds]) map[ds] = { hours: 0, base: 0, extrasAmt: 0, amount: 0, hasEntry: false, live: false };
      return map[ds];
    }
    entries().forEach(function (e) {
      if (!e.date) return;
      var s = slot(e.date);
      s.hasEntry = true;
      s.base += payFor(e, ctx.std, o.payRate);
      s.hours += parseFloat(e.hours) || 0;
    });
    extras().forEach(function (x) {
      if (!x.date) return;
      slot(x.date).extrasAmt += parseFloat(x.amount) || 0;
    });
    var live = liveSession();
    if (live) {
      var s = slot(live.date);
      s.hasEntry = true; s.live = true;
      s.hours += live.hours;
      if (ctx.std === 'hourly') s.base += live.hours * ctx.rate;
    }
    Object.keys(map).forEach(function (ds) {
      var s = map[ds];
      s.amount = s.base + s.extrasAmt;
    });
    return map;
  }

  function summary() {
    var map = dayAgg();
    var total = 0, loads = 0, n = 0, worked = 0;
    entries().forEach(function (e) {
      if (!inPeriod(e.date)) return;
      n++;
      if ((e.type || 'load') === 'load') loads += parseInt(e.loads, 10) || 1;
    });
    Object.keys(map).forEach(function (ds) {
      if (!inPeriod(ds)) return;
      total += map[ds].amount;
      if (map[ds].hasEntry) worked++;
    });
    /* A3: average is per day actually WORKED in the period (a day with any
       counted entry / the live session), not per calendar day. */
    return { total: total, avg: worked ? total / worked : 0, loads: loads, count: n, days: periodDays(), workedDays: worked };
  }

  function dayTotal(ds) {
    var s = dayAgg()[ds];
    return s ? s.amount : 0;
  }

  /* ---- v38 (B): calendar-month aggregation ---- */
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function monthLabel(ym) {
    var p = ym.split('-');
    return (MONTH_NAMES[parseInt(p[1], 10) - 1] || '') + ' ' + p[0];
  }

  function shiftYM(ym, delta) {
    var p = ym.split('-');
    var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1 + delta, 1);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
  }

  function fmtH(h) {
    return String(Math.round((parseFloat(h) || 0) * 100) / 100);
  }

  /* Totals for one calendar month ('YYYY-MM'): hours exactly as recorded
     (they already include travel — nothing is added), earnings = those
     hours priced by the normal pay rule + extras, days worked,
     per-worked-day average, and the per-day list (newest first, worked
     days only — an extras-only day adds to the money total but is not a
     worked day). */
  function monthSummary(ym) {
    var map = dayAgg();
    var hours = 0, total = 0, worked = 0, list = [];
    Object.keys(map).forEach(function (ds) {
      if (ds.slice(0, 7) !== ym) return;
      var s = map[ds];
      total += s.amount;
      hours += s.hours;
      if (s.hasEntry) {
        worked++;
        list.push({ date: ds, hours: s.hours, amount: s.amount, live: s.live });
      }
    });
    list.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return { ym: ym, hours: hours, total: total, daysWorked: worked, avg: worked ? total / worked : 0, days: list };
  }

  /* ---- v38 (B2): paste-import of hours-sheet days ----
     Lines "YYYY-MM-DD,hours". Blank lines ignored; a header line (one that
     doesn't start with a date but mentions date/hours) is ignored. Every
     other bad line is REJECTED AND REPORTED — never silently dropped.
     Imported entries carry the hours exactly as given; the amount follows
     the normal pay rule (tracker pattern: baked at import when hourly +
     rate set, else derived by payFor). NO travel bonus is added — the
     sheet's start-to-end hours already include travel. */
  function importDays(text) {
    var lines = String(text == null ? '' : text).split(/\r?\n/);
    var added = 0, rejected = [];
    var list = entries();
    var ctx = payCtx();
    lines.forEach(function (raw, i) {
      var line = String(raw).trim();
      if (!line) return;
      var parts = line.split(',');
      var dstr = (parts[0] || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dstr)) {
        if (/date|hour/i.test(line)) return; // header line
        rejected.push({ line: i + 1, text: line, why: 'bad date (want YYYY-MM-DD)' });
        return;
      }
      var dp = dstr.split('-');
      var dd = new Date(parseInt(dp[0], 10), parseInt(dp[1], 10) - 1, parseInt(dp[2], 10));
      if (dd.getFullYear() !== parseInt(dp[0], 10) || dd.getMonth() !== parseInt(dp[1], 10) - 1 || dd.getDate() !== parseInt(dp[2], 10)) {
        rejected.push({ line: i + 1, text: line, why: 'not a real calendar date' });
        return;
      }
      var hrs = parseFloat((parts[1] || '').trim());
      if (parts.length < 2 || isNaN(hrs) || !(hrs > 0) || hrs > 24) {
        rejected.push({ line: i + 1, text: line, why: 'bad hours (want a number 0-24)' });
        return;
      }
      var e = { date: dstr, type: 'hourly', hours: hrs, note: 'Hours sheet import' };
      if (ctx.std === 'hourly' && ctx.rate > 0) e.amount = (hrs * ctx.rate).toFixed(2);
      list.push(e);
      added++;
    });
    if (added > 0) saveEntries(list);
    return { added: added, rejected: rejected };
  }

  function drawChart(cv) {
    var days = Math.min(periodDays(), 62);
    var now = new Date();
    var agg = dayAgg();
    var buckets = [], labels = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(now.getTime() - i * 86400000);
      var ds = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
      buckets.push(agg[ds] ? agg[ds].amount : 0);
      labels.push((d.getMonth() + 1) + '/' + d.getDate());
    }
    var Wd = cv.width = (cv.offsetWidth || 600) * 2, H = cv.height = 340;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, Wd, H);
    var max = Math.max.apply(null, buckets.concat([1]));
    var bw = Wd / days;
    var step = Math.max(1, Math.ceil(days / 8));
    buckets.forEach(function (v, i) {
      var h = (v / max) * (H - 70);
      ctx.fillStyle = v > 0 ? '#F26522' : '#e8ecf4';
      ctx.fillRect(i * bw + bw * 0.2, H - 44 - h, bw * 0.6, Math.max(h, 4));
      if (i % step === 0 || i === days - 1) {
        ctx.fillStyle = '#6b7690'; ctx.font = '20px sans-serif';
        ctx.fillText(labels[i], i * bw + bw * 0.15, H - 12);
      }
    });
    ctx.fillStyle = '#1F3764'; ctx.font = 'bold 24px sans-serif';
    ctx.fillText('$' + Math.round(max), 8, 28);
  }

  function manifestFeedPush(kind, summaryText) {
    try {
      var feed = App._store.get('manifest_feed', []);
      feed.push({ ts: Date.now(), date: App._today(), kind: kind, summary: summaryText });
      App._store.set('manifest_feed', feed.slice(-500));
    } catch (e) {}
  }

  var lastImport = null; // v38: result of the latest paste-import, shown after re-render

  var api = {
    status: function () {
      var s = summary();
      return s.total > 0 ? 'Last ' + s.days + 'd: $' + s.total.toFixed(0) : 'No entries yet';
    },
    /* Tracker hook — called by app.js when a work session stops. */
    onSession: function (session) {
      var o = App._store.get('onboarding', {});
      var std = (o.payStandard || 'hourly').toLowerCase();
      var hrs = (session.seconds || 0) / 3600;
      var e = { date: session.date || App._today(), type: 'hourly', hours: hrs.toFixed(2), note: 'Auto from tracker', auto: true };
      if (std === 'hourly' && parseFloat(o.payRate) > 0) {
        e.amount = (hrs * parseFloat(o.payRate)).toFixed(2);
      }
      var list = entries(); list.push(e); saveEntries(list);
      manifestFeedPush('revenue', 'Tracked session ' + hrs.toFixed(2) + 'h logged to Revenue.');
    },
    /* Cross-module: dispatch completion logs earnings here. */
    addEntry: function (e) {
      var list = entries();
      list.push({
        date: e.date || App._today(),
        amount: e.amount || 0,
        type: e.type || 'load',
        loads: e.loads || 1,
        tons: e.tons || null,   // v26: Pay by Weight — net tonnes for recalculation
        hours: e.hours || null,
        note: e.note || ''
      });
      saveEntries(list);
      return list;
    },
    /* Manifest integration hook — returns + stores a period summary. */
    exportToManifest: function () {
      var s = summary();
      var text = 'Revenue · last ' + s.days + ' days: $' + s.total.toFixed(2) +
        ' (' + s.loads + ' loads, ' + s.count + ' entries), avg $' + s.avg.toFixed(2) + '/worked day';
      manifestFeedPush('revenue', text);
      return { days: s.days, total: s.total, avg: s.avg, loads: s.loads, entries: s.count };
    },
    /* v38 (B): calendar-month totals + per-day list ('YYYY-MM'). */
    monthSummary: function (ym) { return monthSummary(ym); },
    /* v38 (B2): paste-import "YYYY-MM-DD,hours" lines into rev entries.
       Returns { added, rejected: [{line, text, why}] } — bad lines are
       reported, never silently dropped. */
    importDays: function (text) { return importDays(text); },
    render: function (body) {
      var o = App._store.get('onboarding', {});
      var period = S('period', '30');
      var view = S('view', 'period');
      var s = summary();

      var h = '<div class="card"><h3>💰 Revenue</h3>';
      /* v38 (B): view mode — the pay-period chips stay exactly as they were;
         Month is an additional mode alongside them. */
      h += '<div class="row" style="margin-bottom:10px">' +
        '<button class="btn small ' + (view === 'period' ? 'primary' : 'ghost') + '" data-view="period">Pay period</button>' +
        '<button class="btn small ' + (view === 'month' ? 'primary' : 'ghost') + '" data-view="month">📅 Month</button></div>';

      var ms = null, ym = '';
      if (view === 'month') {
        ym = S('monthCur', '');
        if (!/^\d{4}-\d{2}$/.test(ym)) {
          var nd = new Date();
          ym = nd.getFullYear() + '-' + ('0' + (nd.getMonth() + 1)).slice(-2);
        }
        ms = monthSummary(ym);
        h += '<div class="row" style="align-items:center;justify-content:space-between">' +
          '<button class="btn small ghost" data-mstep="-1">‹ Prev</button>' +
          '<div style="font-weight:800;color:var(--navy);font-size:17px">' + esc(monthLabel(ym)) + '</div>' +
          '<button class="btn small ghost" data-mstep="1">Next ›</button></div>';
      } else {
        h += '<label class="f">Pay period</label><div class="row">' +
          PERIOD_OPTS.map(function (p) {
            return '<button class="btn small ' + (period === p[0] ? 'primary' : 'ghost') + '" data-p="' + p[0] + '">' + p[1] + '</button>';
          }).join('') + '</div>';
        if (period === 'custom') {
          h += '<div class="row" style="margin-top:8px"><div><label class="f">From</label><input type="date" id="rv_ca" value="' + esc(S('customA', '')) + '"></div>' +
            '<div><label class="f">To</label><input type="date" id="rv_cb" value="' + esc(S('customB', '')) + '"></div></div>';
        }
      }
      h += '</div>';

      if (view === 'month') {
        h += '<div class="row">' +
          '<div class="card" style="flex:1"><div class="note">Hours</div><div class="center" style="font-size:24px;font-weight:800;color:var(--navy)">' + fmtH(ms.hours) + '</div></div>' +
          '<div class="card" style="flex:1"><div class="note">Earnings</div><div class="center" style="font-size:24px;font-weight:800;color:var(--navy)">$' + ms.total.toFixed(2) + '</div></div>' +
          '<div class="card" style="flex:1"><div class="note">Days worked</div><div class="center" style="font-size:24px;font-weight:800;color:var(--navy)">' + ms.daysWorked + '</div></div>' +
          '</div><div class="row">' +
          '<div class="card" style="flex:1"><div class="note">Per worked day</div><div class="center" style="font-size:24px;font-weight:800;color:var(--navy)">$' + ms.avg.toFixed(2) + '</div></div>' +
          '</div>';
      } else {
        h += '<div class="row">' +
          '<div class="card" style="flex:1"><div class="note">Earnings · ' + s.days + 'd</div><div class="center" style="font-size:24px;font-weight:800;color:var(--navy)">$' + s.total.toFixed(2) + '</div></div>' +
          '<div class="card" style="flex:1"><div class="note">Per worked day</div><div class="center" style="font-size:24px;font-weight:800;color:var(--navy)">$' + s.avg.toFixed(2) + '</div></div>' +
          '<div class="card" style="flex:1"><div class="note">Loads</div><div class="center" style="font-size:24px;font-weight:800;color:var(--navy)">' + s.loads + '</div></div>' +
          '</div>';
      }

      /* v36: tracker auto-start settings live in Revenue now (moved from
         Preferences + the old sidebar page, Asjad: "still in preferences,
         not in revenue"). The tracker feeds Revenue — onSession logs tracked
         hours as earnings — so its start-by-itself switch sits here, under
         the numbers it produces. Shared card + save from modules/autostart.js;
         storage keys unchanged (onboarding: autoStart/autoStartTime/autoStartDays). */
      h += Meticulous.modules.autostart.settingsHTML('rv');
      h += '<button class="btn primary" id="rv_as_save" style="margin-bottom:16px">Save auto-start</button>';

      if (view === 'month') {
        /* v38 (B1): per-day breakdown, newest first — date, hours, amount.
           No travel line: the recorded hours already include travel. */
        h += '<div class="card"><h3>🗓 Days in ' + esc(monthLabel(ym)) + '</h3>' +
          (ms.days.length ? ms.days.map(function (d) {
            var dl = new Date(d.date + 'T12:00:00').toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
            return '<div class="listitem"><div class="a">' + esc(dl) + ' — $' + d.amount.toFixed(2) + '</div>' +
              '<div class="b">' + fmtH(d.hours) + 'h' +
              (d.live ? ' · ● still running' : '') + '</div></div>';
          }).join('') : '<div class="empty">No days recorded this month yet. Import below or run the tracker.</div>') + '</div>';

        /* v38 (B2): paste-import from the hours sheet. */
        h += '<div class="card"><h3>📥 Import days</h3>' +
          '<div class="note">One line per day: <b>YYYY-MM-DD,hours</b> (a header line is fine). ' +
          'Hours are used exactly as written — your sheet\'s start-to-end span already includes travel, so nothing is added. Bad lines are reported, never dropped quietly.</div>' +
          '<textarea id="rv_imp_text" rows="6" style="width:100%" placeholder="2026-10-01,10.5&#10;2026-10-02,11"></textarea>' +
          '<button class="btn primary" id="rv_imp_btn">Import days</button>' +
          (lastImport ? '<div style="margin-top:8px"><div class="note">Imported ' + lastImport.added + ' day(s).</div>' +
            lastImport.rejected.map(function (r) {
              return '<div class="note" style="color:#c2410c">Line ' + r.line + ': &quot;' + esc(r.text) + '&quot; — ' + esc(r.why) + '</div>';
            }).join('') + '</div>' : '') +
          '</div>';
      } else {
        h += '<div class="card"><h3>📊 Daily earnings</h3><canvas class="chart" id="revChart"></canvas></div>';
      }

      h += '<div class="card"><h3>＋ Manual entry</h3>' +
        '<div class="row"><div><label class="f">Date</label><input type="date" id="rv_date" value="' + App._today() + '"></div>' +
        '<div><label class="f">Amount $</label><input id="rv_amt" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"></div></div>' +
        '<div class="row"><div><label class="f">Type</label><select id="rv_type"><option value="load">Load</option><option value="hourly">Hourly</option><option value="trip">Trip</option><option value="weight">Weight</option></select></div>' +
        '<div><label class="f">Loads</label><input id="rv_loads" type="number" min="1" step="1" value="1"></div></div>' +
        '<div id="rv_tonsrow" style="display:none"><label class="f">Tonnes (net weight)</label><input id="rv_tons" type="number" inputmode="decimal" min="0" step="0.01" placeholder="e.g. 12.18"></div>' +
        '<label class="f">Note</label><input id="rv_note" placeholder="e.g. Gravel haul to Site 7">' +
        '<button class="btn primary" id="rv_add">Add earnings</button></div>';

      h += '<div class="card"><h3>✨ Extras</h3>' +
        '<div class="row"><div><label class="f">Type</label><select id="rx_type"><option value="bonus">Bonus</option><option value="detention">Detention pay</option><option value="reimbursement">Reimbursement</option><option value="other">Other</option></select></div>' +
        '<div><label class="f">Amount $</label><input id="rx_amt" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"></div></div>' +
        '<label class="f">Date</label><input type="date" id="rx_date" value="' + App._today() + '">' +
        '<label class="f">Note</label><input id="rx_note" placeholder="e.g. 3h wait at pit">' +
        '<button class="btn navy" id="rx_add">Add extra</button>' +
        '<div id="rx_list">' + (extras().length ? extras().slice().reverse().map(function (x, ri) {
          return '<div class="listitem"><div class="a">' + esc(x.type) + ' — $' + esc(x.amount) + '</div><div class="b">' + esc(x.date) + (x.note ? ' · ' + esc(x.note) : '') + '</div>' +
            '<div class="row" style="margin-top:6px"><button class="btn small ghost" data-rxdel="' + (extras().length - 1 - ri) + '">Delete</button></div></div>';
        }).join('') : '<div class="empty">No extras yet.</div>') + '</div></div>';

      h += '<div class="card"><h3>📒 Entries</h3><div id="rv_list">' +
        (entries().length ? entries().slice().reverse().map(function (e, ri) {
          var std = (App._store.get('onboarding', {}).payStandard || 'hourly').toLowerCase();
          var amt = payFor(e, std, App._store.get('onboarding', {}).payRate);
          return '<div class="listitem"><div class="a">$' + amt.toFixed(2) + ' <span class="pill">' + esc(e.type || 'load') + '</span></div>' +
            '<div class="b">' + esc(e.date) + (e.note ? ' · ' + esc(e.note) : '') + (e.auto ? ' · auto' : '') + '</div>' +
            '<div class="row" style="margin-top:6px"><button class="btn small ghost" data-rvdel="' + (entries().length - 1 - ri) + '">Delete</button></div></div>';
        }).join('') : '<div class="empty">No entries yet. Add one above or run the tracker.</div>') + '</div></div>';

      h += '<button class="btn navy" id="rv_export" style="width:100%;margin-bottom:16px">📝 Send summary to Manifest</button>';

      body.innerHTML = h;
      var chartEl = body.querySelector('#revChart');
      if (chartEl) drawChart(chartEl);

      /* v36: auto-start card save (shared saver, same storage keys). */
      body.querySelector('#rv_as_save').onclick = function () {
        Meticulous.modules.autostart.saveFrom('rv', body);
        alert('Auto-start saved.');
      };

      /* v38: view mode toggle + month stepping + paste-import. */
      body.querySelectorAll('[data-view]').forEach(function (b) {
        b.onclick = function () { W('view', b.getAttribute('data-view')); api.render(body); };
      });
      body.querySelectorAll('[data-mstep]').forEach(function (b) {
        b.onclick = function () { W('monthCur', shiftYM(ym, parseInt(b.getAttribute('data-mstep'), 10) || 0)); api.render(body); };
      });
      var impBtn = body.querySelector('#rv_imp_btn');
      if (impBtn) impBtn.onclick = function () {
        var text = body.querySelector('#rv_imp_text').value;
        if (!text.trim()) { alert('Paste at least one line first: YYYY-MM-DD,hours'); return; }
        lastImport = importDays(text);
        if (lastImport.added > 0) manifestFeedPush('revenue', 'Hours sheet import: ' + lastImport.added + ' day(s) added.');
        api.render(body);
      };

      body.querySelectorAll('[data-p]').forEach(function (b) {
        b.onclick = function () { W('period', b.getAttribute('data-p')); api.render(body); };
      });
      var ca = body.querySelector('#rv_ca'), cb = body.querySelector('#rv_cb');
      if (ca) ca.onchange = function () { W('customA', ca.value); api.render(body); };
      if (cb) cb.onchange = function () { W('customB', cb.value); api.render(body); };

      /* v26: Show tonnes input when Weight type selected; auto-calc amount */
      var rvType = body.querySelector('#rv_type');
      var rvTonsRow = body.querySelector('#rv_tonsrow');
      var rvTons = body.querySelector('#rv_tons');
      var rvAmt = body.querySelector('#rv_amt');
      function syncTonsRow() {
        var isW = rvType.value === 'weight';
        rvTonsRow.style.display = isW ? '' : 'none';
        if (isW) {
          var o = App._store.get('onboarding', {});
          var rate = parseFloat(o.payRate) || 0;
          var tons = parseFloat(rvTons.value) || 0;
          if (rate > 0 && tons > 0) rvAmt.value = (tons * rate).toFixed(2);
        }
      }
      rvType.onchange = syncTonsRow;
      rvTons.oninput = syncTonsRow;
      syncTonsRow();

      body.querySelector('#rv_add').onclick = function () {
        var amt = parseFloat(body.querySelector('#rv_amt').value);
        if (!(amt > 0)) { alert('Enter an amount greater than 0.'); return; }
        var entry = {
          date: body.querySelector('#rv_date').value || App._today(),
          amount: amt.toFixed(2),
          type: body.querySelector('#rv_type').value,
          loads: body.querySelector('#rv_loads').value || 1,
          note: body.querySelector('#rv_note').value.trim()
        };
        if (entry.type === 'weight') {
          entry.tons = body.querySelector('#rv_tons').value.trim() || null;
        }
        api.addEntry(entry);
        manifestFeedPush('revenue', 'Manual entry: $' + amt.toFixed(2) + ' (' + entry.type + ')' +
          (entry.tons ? ' · ' + entry.tons + 't' : ''));
        api.render(body);
      };
      body.querySelector('#rx_add').onclick = function () {
        var amt = parseFloat(body.querySelector('#rx_amt').value);
        if (!(amt > 0)) { alert('Enter an amount greater than 0.'); return; }
        var x = extras();
        x.push({
          type: body.querySelector('#rx_type').value,
          amount: amt.toFixed(2),
          date: body.querySelector('#rx_date').value || App._today(),
          note: body.querySelector('#rx_note').value.trim()
        });
        W('extras', x);
        manifestFeedPush('revenue', 'Extra (' + body.querySelector('#rx_type').value + '): $' + amt.toFixed(2));
        api.render(body);
      };
      body.querySelectorAll('[data-rvdel]').forEach(function (b) {
        b.onclick = function () {
          if (!confirm('Delete this entry?')) return;
          var l = entries(); l.splice(+b.getAttribute('data-rvdel'), 1); saveEntries(l); api.render(body);
        };
      });
      body.querySelectorAll('[data-rxdel]').forEach(function (b) {
        b.onclick = function () {
          if (!confirm('Delete this extra?')) return;
          var l = extras(); l.splice(+b.getAttribute('data-rxdel'), 1); W('extras', l); api.render(body);
        };
      });
      body.querySelector('#rv_export').onclick = function () {
        api.exportToManifest();
        alert('Revenue summary sent to Manifest.');
      };
    }
  };

  Meticulous.modules.revenue = api;
})();
