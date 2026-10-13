/* Maintenance module — Meticulous standalone
   Owner-Operator and Fleet Manager ONLY. Never shown to Driver accounts.
   Covers:
     - Fuel mileage: reuses Fuel module fill-ups (fuel_fills) for km/L,
       fuel cost per km, total fuel spend.
     - Truck maintenance: service events log (date, odometer, type, cost, notes)
       with per-type km intervals; "due in X km" / overdue tracking.
     - Annual safety inspection: date-based due tracking.
   Persists via App._store (localStorage, mt_ prefix). Firebase via FB.saveDoc.
*/
(function () {
  'use strict';
  window.Meticulous = window.Meticulous || {};
  Meticulous.modules = Meticulous.modules || {};

  var S = function (k, d) { return App._store.get('mt_' + k, d); };
  var W = function (k, v) { App._store.set('mt_' + k, v); };
  var esc = function (s) { return App._esc(s); };

  /* Service types with default km intervals (0 = no km schedule). */
  var TYPES = [
    { id: 'oil',      name: 'Oil change',            km: 8000,  def: true },
    { id: 'pm',       name: 'PM service (A/B)',      km: 16000, def: true },
    { id: 'grease',   name: 'Grease / chassis lube', km: 8000,  def: false },
    { id: 'air',      name: 'Air filter',            km: 24000, def: false },
    { id: 'fuelflt',  name: 'Fuel filter',           km: 24000, def: false },
    { id: 'brakes',   name: 'Brakes',                km: 16000, def: false },
    { id: 'tires',    name: 'Tires',                 km: 16000, def: false },
    { id: 'annual',   name: 'Annual safety inspection', km: 0,  def: false, dateBased: true },
    { id: 'repair',   name: 'Repair',                km: 0,     def: false },
    { id: 'other',    name: 'Other',                 km: 0,     def: false }
  ];

  function typeById(id) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i];
    return { id: id, name: id, km: 0 };
  }

  function intervals() {
    var d = {};
    TYPES.forEach(function (t) { d[t.id] = t.km; });
    var saved = S('intervals', {});
    Object.keys(saved).forEach(function (k) { d[k] = parseInt(saved[k], 10) || 0; });
    return d;
  }

  function events() { return S('events', []); }

  /* ---- Fuel mileage (same math as Fuel module trend) ---- */
  function fills() { return App._store.get('fuel_fills', []) || []; }

  function mileageStats() {
    var f = fills().filter(function (x) { return x.odo && parseFloat(x.litres) > 0; })
      .sort(function (a, b) { return a.odo - b.odo; });
    var km = 0, litres = 0, cost = 0;
    for (var i = 1; i < f.length; i++) {
      var dist = f[i].odo - f[i - 1].odo, l = parseFloat(f[i].litres);
      if (dist > 0 && l > 0) { km += dist; litres += l; cost += parseFloat(f[i].cost) || 0; }
    }
    /* Add cost of the very first leg too (approximation: count all fill costs) */
    var totalFuelCost = 0;
    fills().forEach(function (x) { totalFuelCost += parseFloat(x.cost) || 0; });
    return {
      legs: f.length - 1,
      avgKpl: litres > 0 ? (km / litres) : 0,
      costPerKm: km > 0 ? (cost / km) : 0,
      totalFuelCost: totalFuelCost,
      kmTracked: km
    };
  }

  /* ---- Odometer: max seen across fills + events, or manual override ---- */
  function currentOdo() {
    var manual = parseFloat(S('odo', ''));
    var max = 0;
    fills().forEach(function (x) { var o = parseFloat(x.odo) || 0; if (o > max) max = o; });
    events().forEach(function (x) { var o = parseFloat(x.odo) || 0; if (o > max) max = o; });
    if (manual > 0) return Math.max(manual, max);
    return max;
  }

  /* ---- Due-item computation ---- */
  function dueItems() {
    var iv = intervals(), odo = currentOdo(), ev = events();
    var lastByType = {};
    ev.forEach(function (x) {
      if (!x.type) return;
      var o = parseFloat(x.odo) || 0;
      if (!lastByType[x.type] || o > (parseFloat(lastByType[x.type].odo) || 0)) lastByType[x.type] = x;
    });
    var out = [];
    TYPES.forEach(function (t) {
      if (t.dateBased) return; /* handled separately */
      var km = parseInt(iv[t.id], 10) || 0;
      if (km <= 0) return;
      var last = lastByType[t.id];
      var dueAt = last ? (parseFloat(last.odo) || 0) + km : odo + km;
      out.push({
        id: t.id, name: t.name, km: km,
        lastOdo: last ? (parseFloat(last.odo) || 0) : 0,
        lastDate: last ? last.date : '',
        dueAt: dueAt,
        remaining: dueAt - odo,
        overdue: (dueAt - odo) <= 0
      });
    });
    out.sort(function (a, b) { return a.remaining - b.remaining; });
    /* Annual safety inspection (date-based) */
    var annualDate = S('annualDate', '');
    if (annualDate) {
      var today = App._today();
      var due = new Date(annualDate + 'T12:00:00'), now = new Date(today + 'T12:00:00');
      var days = Math.round((due - now) / 86400000);
      out.push({ id: 'annual', name: 'Annual safety inspection', dateBased: true,
        annualDate: annualDate, days: days, overdue: days < 0, remaining: days });
      out.sort(function (a, b) { return (a.overdue ? -1e12 : a.remaining) - (b.overdue ? -1e12 : b.remaining); });
    }
    return { items: out, odo: odo };
  }

  function money(v) { return '$' + (parseFloat(v) || 0).toFixed(2); }
  function kmStr(v) { return Math.round(v).toLocaleString('en-CA') + ' km'; }

  var api = {
    /* Account-type gate: REMOVED (Oct 13, 2026) — Asjad is a Driver and
       needs access to everything. Everyone sees Maintenance. Kept for API compat. */
    _allowed: function () { return true; },
    _dueItems: dueItems,
    _mileageStats: mileageStats,

    status: function () {
      try {
        var d = dueItems();
        var next = d.items.filter(function (i) { return !i.dateBased; })[0];
        if (next && next.overdue) return '⚠️ ' + next.name + ' overdue';
        if (next) return next.name + ' in ' + Math.round(next.remaining).toLocaleString('en-CA') + ' km';
        return events().length + ' services logged';
      } catch (e) { return ''; }
    },

    render: function (body) {
      /* Gate removed Oct 13, 2026 — everyone (including Drivers) gets access. */
      var ms = mileageStats();
      var d = dueItems();
      var ev = events();
      var totalMaint = 0;
      ev.forEach(function (x) { totalMaint += parseFloat(x.cost) || 0; });

      /* --- Dashboard --- */
      var h = '<div class="card"><h3>🔧 Truck maintenance</h3>' +
        '<div class="row">' +
        '<div class="card" style="flex:1;margin:0"><div class="note">Odometer</div>' +
        '<div class="center" style="font-size:20px;font-weight:800;color:var(--navy)">' +
        (d.odo > 0 ? kmStr(d.odo) : '—') + '</div></div>' +
        '<div class="card" style="flex:1;margin:0"><div class="note">Fuel efficiency</div>' +
        '<div class="center" style="font-size:20px;font-weight:800;color:var(--navy)">' +
        (ms.legs > 0 ? ms.avgKpl.toFixed(1) + ' <small style="font-size:12px">km/L</small>' : '—') + '</div></div>' +
        '<div class="card" style="flex:1;margin:0"><div class="note">Maint. spend (all)</div>' +
        '<div class="center" style="font-size:20px;font-weight:800;color:var(--navy)">' + money(totalMaint) + '</div></div>' +
        '</div>' +
        '<div class="kv"><span>Fuel cost per km</span><b>' + (ms.kmTracked > 0 ? '$' + ms.costPerKm.toFixed(3) : '—') + '</b></div>' +
        '<div class="kv"><span>Total fuel spend</span><b>' + money(ms.totalFuelCost) + '</b></div>' +
        (ms.legs > 0 ? '<div class="kv"><span>Tracked over</span><b>' + kmStr(ms.kmTracked) + ' (' + ms.legs + ' legs)</b></div>' : '') +
        '<p class="note">Fuel figures come from your Fuel &amp; Expense fill-ups. Add fill-ups there to sharpen these numbers.</p>' +
        '<div class="row"><div><label class="f">Update odometer (km)</label><input id="mt_odo" type="number" inputmode="decimal" placeholder="' + (d.odo > 0 ? Math.round(d.odo) : '') + '"></div>' +
        '<div><label class="f">&nbsp;</label><button class="btn secondary" id="mt_odo_save">Save</button></div></div>' +
        '</div>';

      /* --- Upcoming --- */
      h += '<div class="card"><h3>⏰ Upcoming service</h3>';
      if (!d.items.length) {
        h += '<div class="empty">No service schedules yet. Log a service below and I\'ll count down from your interval.</div>';
      } else {
        d.items.slice(0, 6).forEach(function (i) {
          var badge, line;
          if (i.dateBased) {
            var ad = Math.abs(i.days);
            badge = i.overdue
              ? '<span style="color:#c0392b;font-weight:800">⚠️ OVERDUE by ' + ad + ' day' + (ad === 1 ? '' : 's') + '</span>'
              : (i.days <= 30 ? '<span style="color:#b7791f;font-weight:800">Due in ' + i.days + ' days</span>'
                              : '<span>Due in ' + i.days + ' days</span>');
            line = i.annualDate;
          } else {
            var r = Math.abs(Math.round(i.remaining));
            badge = i.overdue
              ? '<span style="color:#c0392b;font-weight:800">⚠️ OVERDUE by ' + r.toLocaleString('en-CA') + ' km</span>'
              : (i.remaining <= 1000 ? '<span style="color:#b7791f;font-weight:800">Due in ' + r.toLocaleString('en-CA') + ' km</span>'
                                     : '<span>Due in ' + r.toLocaleString('en-CA') + ' km</span>');
            line = 'Every ' + i.km.toLocaleString('en-CA') + ' km' +
              (i.lastDate ? ' · last done ' + esc(i.lastDate) + ' @ ' + kmStr(i.lastOdo) : ' · not logged yet');
          }
          h += '<div class="kv"><span><b>' + esc(i.name) + '</b><br><small style="color:#666">' + line + '</small></span><span>' + badge + '</span></div>';
        });
      }
      h += '</div>';

      /* --- Log a service --- */
      h += '<div class="card"><h3>＋ Log service</h3>' +
        '<div class="row"><div><label class="f">Date</label><input type="date" id="mt_date" value="' + App._today() + '"></div>' +
        '<div><label class="f">Odometer (km)</label><input id="mt_sodo" type="number" inputmode="decimal" value="' + (d.odo > 0 ? Math.round(d.odo) : '') + '"></div></div>' +
        '<div class="row"><div><label class="f">Type</label><select id="mt_type">' +
        TYPES.map(function (t) { return '<option value="' + t.id + '">' + t.name + '</option>'; }).join('') +
        '</select></div>' +
        '<div><label class="f">Cost $</label><input id="mt_cost" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"></div></div>' +
        '<label class="f">Notes</label><input id="mt_notes" placeholder="e.g. Rotella T6, done at Kal Tire">' +
        '<button class="btn primary" id="mt_add">Save service</button></div>';

      /* --- Service history --- */
      h += '<div class="card"><h3>📒 Service history</h3>' +
        (ev.length ? ev.slice().reverse().map(function (x, ri) {
          return '<div class="listitem"><div class="a">' + esc(typeById(x.type).name) + ' — ' + money(x.cost) + '</div>' +
            '<div class="b">' + esc(x.date) + ' · odo ' + esc(x.odo) + (x.notes ? ' · ' + esc(x.notes) : '') + '</div>' +
            '<div class="row" style="margin-top:6px"><button class="btn small ghost" data-mtdel="' + (ev.length - 1 - ri) + '">Delete</button></div></div>';
        }).join('') : '<div class="empty">No services logged yet.</div>') + '</div>';

      /* --- Intervals --- */
      var iv = intervals();
      h += '<div class="card"><h3>⚙️ Service intervals</h3>' +
        '<p class="note">How many km between services. Set 0 to turn a reminder off.</p>';
      TYPES.forEach(function (t) {
        if (t.dateBased) return;
        h += '<div class="kv"><span>' + t.name + '</span>' +
          '<span><input type="number" inputmode="numeric" min="0" step="100" data-mtint="' + t.id + '" value="' + (iv[t.id] || 0) + '" style="width:110px"> km</span></div>';
      });
      h += '<div class="kv"><span>Annual safety inspection due</span>' +
        '<span><input type="date" id="mt_annual" value="' + esc(S('annualDate', '')) + '"></span></div>' +
        '<button class="btn navy" id="mt_save_int">Save intervals</button></div>';

      body.innerHTML = h;

      body.querySelector('#mt_odo_save').onclick = function () {
        var v = parseFloat(body.querySelector('#mt_odo').value);
        if (!(v > 0)) { alert('Enter a valid odometer reading.'); return; }
        W('odo', v);
        api.render(body);
      };

      body.querySelector('#mt_add').onclick = function () {
        var odo = parseFloat(body.querySelector('#mt_sodo').value);
        var type = body.querySelector('#mt_type').value;
        if (!(odo > 0)) { alert('Enter the odometer reading.'); return; }
        var rec = {
          date: body.querySelector('#mt_date').value || App._today(),
          odo: odo,
          type: type,
          cost: (parseFloat(body.querySelector('#mt_cost').value) || 0).toFixed(2),
          notes: body.querySelector('#mt_notes').value.trim()
        };
        var l = events(); l.push(rec); W('events', l);
        if (window.FB && FB.saveDoc) { try { FB.saveDoc('maintenance', 'm' + Date.now(), rec); } catch (e) {} }
        api.render(body);
      };

      body.querySelectorAll('[data-mtdel]').forEach(function (b) {
        b.onclick = function () {
          if (!confirm('Delete this service record?')) return;
          var l = events(); l.splice(+b.getAttribute('data-mtdel'), 1); W('events', l);
          api.render(body);
        };
      });

      body.querySelector('#mt_save_int').onclick = function () {
        var nv = {};
        body.querySelectorAll('[data-mtint]').forEach(function (inp) {
          nv[inp.getAttribute('data-mtint')] = parseInt(inp.value, 10) || 0;
        });
        W('intervals', nv);
        W('annualDate', body.querySelector('#mt_annual').value || '');
        api.render(body);
      };
    }
  };

  Meticulous.modules.maintenance = api;
})();

