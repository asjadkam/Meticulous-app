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

  function summary() {
    var o = App._store.get('onboarding', {});
    var std = (o.payStandard || 'hourly').toLowerCase(), rate = o.payRate;
    var total = 0, loads = 0, n = 0;
    entries().forEach(function (e) {
      if (!inPeriod(e.date)) return;
      total += payFor(e, std, rate); n++;
      if ((e.type || 'load') === 'load') loads += parseInt(e.loads, 10) || 1;
    });
    extras().forEach(function (x) { if (inPeriod(x.date)) total += parseFloat(x.amount) || 0; });
    var days = periodDays();
    return { total: total, avg: days ? total / days : 0, loads: loads, count: n, days: days };
  }

  function dayTotal(ds) {
    var o = App._store.get('onboarding', {});
    var std = (o.payStandard || 'hourly').toLowerCase(), rate = o.payRate;
    var t = 0;
    entries().forEach(function (e) { if (e.date === ds) t += payFor(e, std, rate); });
    extras().forEach(function (x) { if (x.date === ds) t += parseFloat(x.amount) || 0; });
    return t;
  }

  function drawChart(cv) {
    var days = Math.min(periodDays(), 62);
    var now = new Date();
    var buckets = [], labels = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(now.getTime() - i * 86400000);
      var ds = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
      buckets.push(dayTotal(ds));
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
        ' (' + s.loads + ' loads, ' + s.count + ' entries), avg $' + s.avg.toFixed(2) + '/day';
      manifestFeedPush('revenue', text);
      return { days: s.days, total: s.total, avg: s.avg, loads: s.loads, entries: s.count };
    },
    render: function (body) {
      var o = App._store.get('onboarding', {});
      var period = S('period', '30');
      var s = summary();

      var h = '<div class="card"><h3>💰 Revenue</h3>';
      h += '<label class="f">Pay period</label><div class="row">' +
        PERIOD_OPTS.map(function (p) {
          return '<button class="btn small ' + (period === p[0] ? 'primary' : 'ghost') + '" data-p="' + p[0] + '">' + p[1] + '</button>';
        }).join('') + '</div>';
      if (period === 'custom') {
        h += '<div class="row" style="margin-top:8px"><div><label class="f">From</label><input type="date" id="rv_ca" value="' + esc(S('customA', '')) + '"></div>' +
          '<div><label class="f">To</label><input type="date" id="rv_cb" value="' + esc(S('customB', '')) + '"></div></div>';
      }
      h += '</div>';

      h += '<div class="row">' +
        '<div class="card" style="flex:1"><div class="note">Earnings · ' + s.days + 'd</div><div class="center" style="font-size:24px;font-weight:800;color:var(--navy)">$' + s.total.toFixed(2) + '</div></div>' +
        '<div class="card" style="flex:1"><div class="note">Per-day avg</div><div class="center" style="font-size:24px;font-weight:800;color:var(--navy)">$' + s.avg.toFixed(2) + '</div></div>' +
        '<div class="card" style="flex:1"><div class="note">Loads</div><div class="center" style="font-size:24px;font-weight:800;color:var(--navy)">' + s.loads + '</div></div>' +
        '</div>';

      h += '<div class="card"><h3>📊 Daily earnings</h3><canvas class="chart" id="revChart"></canvas></div>';

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
      drawChart(body.querySelector('#revChart'));

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
