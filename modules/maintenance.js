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
    /* v97: odometer-correction audit entries (see ODO-CORRECTION
       region) are history-only — never a loggable service type, so
       they stay out of TYPES (no dropdown row, no interval row). */
    if (id === 'odocorr') return { id: id, name: 'Odometer correction', km: 0 };
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

  /* NEXT-SERVICE-BEGIN (v49) — optional "next service" target for the oil
     change countdown. From the owner's windshield sticker: an explicit
     target (odometer and/or date) he can log instead of relying on the
     interval alone. Both fields are OPTIONAL — empty is valid, and saving
     anything else in this module never requires them.
     Keys: mt_nextServiceOdo (number, or '' when unset),
           mt_nextServiceDate ('YYYY-MM-DD', or '' when unset). */
  function nextService() {
    return {
      odo: parseFloat(S('nextServiceOdo', '')) || 0,
      date: S('nextServiceDate', '') || ''
    };
  }

  function clearNextService() {
    W('nextServiceOdo', '');
    W('nextServiceDate', '');
  }

  /* Pure oil-change countdown state. ivOilKm = oil interval, odo =
     current odometer, lastOil = last oil event (or null), ns =
     nextService(), today = 'YYYY-MM-DD'. When a target odometer is set
     it REPLACES the interval math; a target date then makes the item due
     at whichever comes first (km reached OR date reached). A date on its
     own (no target odometer) does not drive the countdown — interval
     model, unchanged. */
  function oilDueState(ivOilKm, odo, lastOil, ns, today) {
    var lastOdo = lastOil ? (parseFloat(lastOil.odo) || 0) : 0;
    var lastDate = lastOil ? (lastOil.date || '') : '';
    if (ns && ns.odo > 0) {
      var remaining = ns.odo - odo;
      var dueByDate = !!(ns.date && today >= ns.date);
      return {
        mode: 'target', dueAt: ns.odo, remaining: remaining,
        overdue: (remaining <= 0) || dueByDate,
        dueByKm: remaining <= 0, dueByDate: dueByDate,
        nextDate: ns.date || '', lastOdo: lastOdo, lastDate: lastDate
      };
    }
    var dueAt = lastOil ? lastOdo + ivOilKm : odo + ivOilKm;
    return {
      mode: 'interval', dueAt: dueAt, remaining: dueAt - odo,
      overdue: (dueAt - odo) <= 0, dueByKm: (dueAt - odo) <= 0,
      dueByDate: false, nextDate: '', lastOdo: lastOdo, lastDate: lastDate
    };
  }

  /* One-time data fix (v49): on Oct 14, 2026 the oil interval was set to
     6,911 through the UI as a workaround, so the countdown landed on the
     sticker's next-service target (175,429 km) from the then-current
     odometer (168,518 km). This moves that target into the proper
     next-service field and restores the real interval (8,000 km). It
     fires ONLY when the saved oil interval is exactly the workaround
     value AND no next-service target is set yet; the synced
     mt_nsMigrated flag stamps it done so it can never re-fire (e.g. if
     the interval is hand-set to 6,911 again later). Invoked from
     dueItems(), i.e. on-device during normal app use; the writes go
     through App._store, so they cloud-sync like any other mt_ key. */
  function migrateNextService() {
    if (S('nsMigrated', 0)) return false;
    var fired = false;
    var saved = S('intervals', {});
    if ((parseInt(saved.oil, 10) || 0) === 6911 && !(nextService().odo > 0)) {
      saved.oil = 8000;
      W('intervals', saved);
      W('nextServiceOdo', 175429);
      fired = true;
    }
    W('nsMigrated', 1);
    return fired;
  }
  /* NEXT-SERVICE-END */

  /* ---- Fuel mileage (same math as Fuel module trend) ---- */
  function fills() { return App._store.get('fuel_fills', []) || []; }

  /* v97: is a recorded reading usable as odometer evidence? A fill or
     service reading that sits impossibly far past the master (the
     two-sided gate's 'jump' — more than ODO_MAX_JUMP_KM above it) is
     bad data, e.g. the Oct 15 fuel receipt whose invoice number
     (519,326) was saved as the fill-up's odometer against a 168,759
     master. Such readings are ignored by the odometer math below:
     before v97 they drove currentOdo() (Maintenance showed the
     poisoned 519,326 and called the oil 343,897 km overdue) and
     mileageStats() (the same poisoned fill printed as a 350,816 km
     "leg"). With no master there is nothing to judge against and
     every reading passes, exactly as before. NOTE: leg distances
     themselves never write the master — Live Miles (js/miles.js)
     keeps its own keys; this gate is about recorded readings only. */
  function plausibleReading(o) {
    if (!(o > 0)) return false;
    try {
      if (window.App && App._odoImplausible) return App._odoImplausible(o) !== 'jump';
    } catch (e) {}
    return true;
  }

  function mileageStats() {
    var f = fills().filter(function (x) { return x.odo && parseFloat(x.litres) > 0 && plausibleReading(parseFloat(x.odo)); })
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
    /* v97: 'jump'-implausible readings (see plausibleReading) no
       longer count — a poisoned fill/event must not be able to hold
       the displayed odometer (and every due countdown) hostage after
       the master itself has been corrected. */
    fills().forEach(function (x) { var o = parseFloat(x.odo) || 0; if (o > max && plausibleReading(o)) max = o; });
    events().forEach(function (x) { var o = parseFloat(x.odo) || 0; if (o > max && plausibleReading(o)) max = o; });
    if (manual > 0) return Math.max(manual, max);
    return max;
  }

  /* ODO-CORRECTION-BEGIN (v97) — the verified correction path.
     The master odometer (mt_odo) moves ONLY through the two-sided
     supervised decision (App._odoSaveDecision / bumpOdometer):
     ordinary writes are upward-only and jump-refused, and GPS leg
     accumulation never touches it at all. The ONE door that may move
     it DOWN (or past the jump gate) is an explicit correction — the
     owner photographs the dash, checks the read, and confirms here.
     applyOdoCorrection runs that decision ARMED, writes the master,
     and appends an audit entry to the service history (date, old
     value, new value) so every correction can be checked later.
     Self-contained on S/W + App._today/_masterOdometer/
     _odoSaveDecision so the test suite can extract and drive it. */
  function logOdoCorrection(oldV, newV, source) {
    var ev = S('events', []);
    var rec = {
      date: App._today(),
      odo: newV,
      type: 'odocorr',
      cost: '0.00',
      notes: 'Odometer corrected from ' + Math.round(oldV).toLocaleString('en-CA') + ' km to ' +
        Math.round(newV).toLocaleString('en-CA') + ' km' + (source ? ' (' + source + ')' : '')
    };
    ev.push(rec);
    W('events', ev);
    if (window.FB && FB.saveDoc) { try { FB.saveDoc('maintenance', 'm' + Date.now(), rec); } catch (e) {} }
    return rec;
  }

  function applyOdoCorrection(v, source) {
    var n = parseFloat(v);
    if (!(n > 0)) return { action: 'ignore', value: null, previous: null, logged: null };
    var master = null;
    try { if (window.App && App._masterOdometer) master = App._masterOdometer(); } catch (e) {}
    if (master === null || master === undefined) { var m0 = parseFloat(S('odo', '')); master = (m0 > 0) ? m0 : null; }
    var dec = (window.App && App._odoSaveDecision)
      ? App._odoSaveDecision(n, master, true)
      : { action: 'set', value: n };
    if (dec.action === 'ignore' || dec.action === 'keep') {
      return { action: dec.action, value: master, previous: master, logged: null };
    }
    W('odo', dec.value);
    var logged = null;
    if (master !== null && master !== undefined && dec.value !== master) {
      logged = logOdoCorrection(master, dec.value, source);
    }
    return { action: dec.action, value: dec.value, previous: master, logged: logged };
  }
  /* ODO-CORRECTION-END */

  /* ---- Due-item computation ---- */
  function dueItems() {
    migrateNextService();
    var iv = intervals(), odo = currentOdo(), ev = events();
    var lastByType = {};
    ev.forEach(function (x) {
      if (!x.type) return;
      var o = parseFloat(x.odo) || 0;
      if (!lastByType[x.type] || o > (parseFloat(lastByType[x.type].odo) || 0)) lastByType[x.type] = x;
    });
    var out = [];
    var todayStr = App._today();
    TYPES.forEach(function (t) {
      if (t.dateBased) return; /* handled separately */
      var km = parseInt(iv[t.id], 10) || 0;
      var last = lastByType[t.id];
      if (t.id === 'oil') {
        /* v49: an explicit next-service target (when set) drives the oil
           countdown instead of the interval math — and shows even if the
           interval itself is 0/off. Cleared target -> interval model. */
        var st = oilDueState(km, odo, last, nextService(), todayStr);
        if (st.mode !== 'target' && km <= 0) return;
        out.push({
          id: t.id, name: t.name, km: km, mode: st.mode,
          lastOdo: st.lastOdo, lastDate: st.lastDate,
          dueAt: st.dueAt,
          remaining: st.remaining,
          overdue: st.overdue,
          dueByDate: st.dueByDate, dueByKm: st.dueByKm, nextDate: st.nextDate
        });
        return;
      }
      if (km <= 0) return;
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
    /* Overdue items first (same pattern as the annual re-sort below);
       relative order of everything else is unchanged. */
    out.sort(function (a, b) {
      return ((a.overdue ? -1e12 : 0) + a.remaining) - ((b.overdue ? -1e12 : 0) + b.remaining);
    });
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
    _currentOdo: currentOdo,
    _applyOdoCorrection: applyOdoCorrection,
    _logOdoCorrection: logOdoCorrection,
    _nextService: nextService,
    _oilDueState: oilDueState,
    _migrateNextService: migrateNextService,

    status: function () {
      try {
        var d = dueItems();
        var next = d.items.filter(function (i) { return !i.dateBased; })[0];
        if (next && next.dueByDate) return next.name + ' due (date)';
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
        '<div><label class="f">&nbsp;</label><button class="btn navy" id="mt_odo_save">Save</button></div></div>' +
        /* v86: the correction door for THIS card — the same one
           Preferences and Fuel have. Hidden until the typed reading
           trips the two-sided gate against the master; the Save
           below refuses an unarmed gated value (see its handler). */
        '<div id="mt_odo_fixrow" style="display:none;margin-top:6px;">' +
        '<p class="note" id="mt_odo_fixnote" style="color:#c2410c;font-weight:600"></p>' +
        '<label class="chk"><input type="checkbox" id="mt_odo_fix"> This corrects a wrong odometer reading</label></div>' +
        /* v61: snap the dash instead of typing — two small quiet
           buttons (camera / file, owner's standing two-button rule)
           wired to the shared odometer photo pipeline below. The
           field id doubles as the pipeline prefix: mt_odo_cam /
           mt_odo_pick / mt_odo_cam_in / mt_odo_in / mt_odo_status. */
        '<input type="file" id="mt_odo_cam_in" accept="image/*" capture="environment" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<input type="file" id="mt_odo_in" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<div class="row"><button type="button" class="btn small ghost" id="mt_odo_cam" style="flex:1;">📷 Take photo</button>' +
        '<button type="button" class="btn small ghost" id="mt_odo_pick" style="flex:1;">📁 Choose file</button></div>' +
        '<div id="mt_odo_prev"></div><div id="mt_odo_status" class="note"></div>' +
        '</div>';

      /* v97: the verified correction card — clearly separate from the
         everyday Update odometer above. This is the one place the
         odometer can move DOWN: snap the dash, check the read, save
         the correction; it is written into the service history. The
         field id doubles as the photo-pipeline prefix (mt_fix_cam /
         mt_fix_pick / mt_fix_cam_in / mt_fix_in / mt_fix_status),
         wired fill-only below exactly like the v61 card. */
      h += '<div class="card"><h3>🛠️ Correct odometer from dash photo</h3>' +
        '<p class="note">Only for when the odometer saved in the app is itself wrong — a bad photo read, or a number that was never an odometer (a receipt\'s invoice number, say). Snap the dash, check the reading, then save the correction. Every correction is written into the service history below, with the old and new readings, so it can always be checked.</p>' +
        '<div class="row"><div><label class="f">Correct odometer (km)</label><input id="mt_fix" type="number" inputmode="decimal" placeholder="e.g. 168940"></div>' +
        '<div><label class="f">&nbsp;</label><button class="btn navy" id="mt_fix_save">Save correction</button></div></div>' +
        '<input type="file" id="mt_fix_cam_in" accept="image/*" capture="environment" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<input type="file" id="mt_fix_in" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<div class="row"><button type="button" class="btn small ghost" id="mt_fix_cam" style="flex:1;">📷 Take photo</button>' +
        '<button type="button" class="btn small ghost" id="mt_fix_pick" style="flex:1;">📁 Choose file</button></div>' +
        '<div id="mt_fix_prev"></div><div id="mt_fix_status" class="note"></div>' +
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
          } else if (i.mode === 'target') {
            var rt = Math.abs(Math.round(i.remaining));
            badge = i.dueByDate
              ? '<span style="color:#c0392b;font-weight:800">⚠️ Due (date)</span>'
              : (i.overdue
                ? '<span style="color:#c0392b;font-weight:800">⚠️ OVERDUE by ' + rt.toLocaleString('en-CA') + ' km</span>'
                : (i.remaining <= 1000 ? '<span style="color:#b7791f;font-weight:800">Due in ' + rt.toLocaleString('en-CA') + ' km</span>'
                                       : '<span>Due in ' + rt.toLocaleString('en-CA') + ' km</span>'));
            line = 'Next service at ' + kmStr(i.dueAt) +
              (i.nextDate ? ' or by ' + esc(i.nextDate) : '') +
              (i.lastDate ? ' · last done ' + esc(i.lastDate) + ' @ ' + kmStr(i.lastOdo) : ' · not logged yet');
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

      /* --- Next service (optional, v49) --- */
      var nsNow = nextService();
      h += '<div class="card"><h3>🎯 Next service <small style="font-weight:400;color:#666">(optional)</small></h3>' +
        '<p class="note">Got a service sticker? Put the next service from the sticker here and I\'ll count down to it — odometer or date, whichever comes first. Both fields are optional; leave them empty and I use the service interval below instead. Logging an oil change clears these. Or snap the sticker below — the photo fills these boxes; check the read, then Save.</p>' +
        '<div class="row"><div><label class="f">Next service odometer (km)</label><input id="mt_ns_odo" type="number" inputmode="numeric" min="0" placeholder="e.g. 175429" value="' + (nsNow.odo > 0 ? Math.round(nsNow.odo) : '') + '"></div>' +
        '<div><label class="f">Next service date</label><input type="date" id="mt_ns_date" value="' + esc(nsNow.date) + '"></div></div>' +
        '<label class="f">📷 Sticker photo</label>' +
        '<input type="file" id="mt_ns_cam_in" accept="image/*" capture="environment" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<input type="file" id="mt_ns_in" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<div class="row"><button type="button" class="btn secondary" id="mt_ns_cam" style="flex:1;">📷 Take photo</button>' +
        '<button type="button" class="btn secondary" id="mt_ns_pick" style="flex:1;">📁 Choose file</button></div>' +
        '<div id="mt_ns_read"></div>' +
        '<div class="row"><button class="btn navy" id="mt_ns_save">Save next service</button>' +
        ((nsNow.odo > 0 || nsNow.date) ? '<button class="btn ghost" id="mt_ns_clear">Clear</button>' : '') +
        '</div></div>';

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

      var nsSaveBtn = body.querySelector('#mt_ns_save');
      if (nsSaveBtn) nsSaveBtn.onclick = function () {
        var o = parseFloat(body.querySelector('#mt_ns_odo').value);
        W('nextServiceOdo', o > 0 ? Math.round(o) : '');
        W('nextServiceDate', body.querySelector('#mt_ns_date').value || '');
        /* v59: this Save confirms whatever is in the fields — if a
           power-read result was waiting, it is now consumed. */
        try { if (window.PowerRead && PowerRead.takeResult) PowerRead.takeResult('sticker'); } catch (e) {}
        api.render(body);
      };
      var nsClearBtn = body.querySelector('#mt_ns_clear');
      if (nsClearBtn) nsClearBtn.onclick = function () {
        clearNextService();
        api.render(body);
      };

      /* v51: sticker photo → OCR (same engine as Fuel/Dispatch: 1600px
         rendition + 180° rotation retry) → PREFILL the next-service
         fields. NEVER saves: the read lands in the two inputs and the
         driver checks it and taps "Save next service" himself.
         Stickers are usually handwritten, and OCR reads handwriting
         unreliably (proven on the haul card, Oct 13) — the
         check-before-save step is the safeguard, so there is
         deliberately no auto-save here. Nothing found = a plain
         in-page message, never silent, no native dialogs. */
      var nsCamInput = body.querySelector('#mt_ns_cam_in');
      var nsPickInput = body.querySelector('#mt_ns_in');
      var nsCamBtn = body.querySelector('#mt_ns_cam');
      var nsPickBtn = body.querySelector('#mt_ns_pick');
      if (nsCamBtn) nsCamBtn.onclick = function () { nsCamInput.click(); };
      if (nsPickBtn) nsPickBtn.onclick = function () { nsPickInput.click(); };
      var nsOcrToken = 0;
      function nsSetRead(html) { var d = body.querySelector('#mt_ns_read'); if (d) d.innerHTML = html; }
      function nsHandlePhoto(ev) {
        var file = ev.target.files && ev.target.files[0]; if (!file) return;
        var token = ++nsOcrToken;
        if (!window.TicketOCR || !TicketOCR.fileToOCRImage || !TicketOCR.parseServiceSticker) {
          nsSetRead('<span style="color:#e67e22">Photo reader isn\'t ready — type the sticker values in.</span>');
          return;
        }
        nsSetRead('📖 Reading sticker…');
        TicketOCR.fileToOCRImage(file, function (ocrUrl) {
          if (token !== nsOcrToken) return;
          if (!ocrUrl) { nsSetRead('<span style="color:#e67e22">Couldn\'t read that sticker — type it in.</span>'); return; }
          TicketOCR.recognizeWithRotation(ocrUrl, function (p) {
            if (token !== nsOcrToken) return;
            try { nsSetRead('📖 Reading sticker… ' + Math.round(p * 100) + '%'); } catch (e) {}
          }).then(function (text) {
            if (token !== nsOcrToken) return;
            var parsed = TicketOCR.parseServiceSticker(text);
            var rep = TicketOCR.describeStickerRead(parsed);
            if (!rep.found.length) {
              nsSetRead('<span style="color:#e67e22">Couldn\'t read that sticker — type it in.</span>');
            } else {
              if (parsed.odo) body.querySelector('#mt_ns_odo').value = parsed.odo;
              if (parsed.date) body.querySelector('#mt_ns_date').value = parsed.date;
              nsSetRead('📸 Read from sticker: <b>' + esc(rep.found.join(' · ')) + '</b> — check before saving.' +
                (rep.missing.length ? '<br><span style="color:#e67e22">Couldn\'t find: ' + esc(rep.missing.join(', ')) + '</span>' : ''));
            }
            /* v58 (Round 2 Lane B): background candidate hunt — pooled
               extra reads mine ranked miles/date candidates and offer
               them as tap-to-pick chips. Chips only FILL the inputs;
               the card's Save stays the confirm, nothing auto-saves. */
            nsHunt(ocrUrl, token, text);
            /* v59: local read found NEITHER miles nor date → power-read
               escalation. The cloud answer only FILLS the inputs
               (labelled); this card's Save stays the confirm. Silent
               when power read is off or no key is set. */
            if (!rep.found.length) nsPowerRead(ocrUrl, token);
          }).catch(function () {
            if (token !== nsOcrToken) return;
            nsSetRead('<span style="color:#e67e22">Couldn\'t read that sticker — type it in.</span>');
          });
        });
      }
      if (nsCamInput) nsCamInput.onchange = nsHandlePhoto;
      if (nsPickInput) nsPickInput.onchange = nsHandlePhoto;

      /* v59: power-read escalation for the sticker photo. Fill-only,
         exactly like the local read and the hunt chips — the card's
         Save is the one and only confirm. */
      function nsPowerRead(ocrUrl, token) {
        if (!window.PowerRead || !PowerRead.escalate) return;
        PowerRead.escalate({
          reader: 'sticker', image: ocrUrl, origin: { module: 'maintenance', label: 'Maintenance' },
          onStatus: function (s) {
            if (token !== nsOcrToken) return;
            if (s.state === 'working') nsSetRead('⚡ Asking the power read…');
            else if (s.state === 'waiting') nsSetRead('⚡ Power read waiting for signal — the photo is saved and will be read when you\'re back online. You can still type the values in.');
            /* v63: a skip (off / no key on this device) used to be
               total silence — the Oct 14 live test failed exactly
               here, invisibly. Say why, in the same line. */
            else if (s.state === 'unavailable') nsSetRead('<span style="color:#e67e22">' + esc(s.message) + ' You can still type the values in.</span>');
            else if (s.state === 'error') nsSetRead('<span style="color:#e67e22">' + esc(s.message) + '</span>');
          },
          onResult: function (res) {
            if (token !== nsOcrToken) return;
            var f = (res && res.fields) || {};
            if (!f.odo && !f.date) { nsSetRead('<span style="color:#e67e22">⚡ Power read couldn\'t read that sticker either — type it in.</span>'); return; }
            if (f.odo) body.querySelector('#mt_ns_odo').value = f.odo;
            if (f.date) body.querySelector('#mt_ns_date').value = f.date;
            nsSetRead('⚡ <b>Power read — check before saving:</b> ' + esc(describeStickerPower(f)) + ' filled in above.');
          }
        });
      }
      function describeStickerPower(f) {
        var parts = [];
        if (f.odo) parts.push('next service ' + Number(f.odo).toLocaleString('en-CA') + ' km');
        if (f.date) parts.push('due date ' + f.date);
        return parts.join(' · ');
      }

      /* v59: a power read queued from an earlier sticker photo may
         have finished since — PEEK (not take): prefill the inputs and
         label them; it is consumed only when Save next service is
         tapped, so wandering off loses nothing. */
      try {
        if (window.PowerRead && PowerRead.peekResult) {
          var prSticker = PowerRead.peekResult('sticker');
          if (prSticker && prSticker.fields && (prSticker.fields.odo || prSticker.fields.date)) {
            if (prSticker.fields.odo) body.querySelector('#mt_ns_odo').value = prSticker.fields.odo;
            if (prSticker.fields.date) body.querySelector('#mt_ns_date').value = prSticker.fields.date;
            nsSetRead('⚡ <b>Power read — check before saving:</b> ' + esc(describeStickerPower(prSticker.fields)) + ' from your earlier sticker photo, filled in above.');
          }
        }
      } catch (e) {}

      /* v58: sticker candidate hunt (see nsHandlePhoto). Renders chips
         under the read line: miles candidates fill #mt_ns_odo, date
         candidates fill #mt_ns_date. Fill-only — Save confirms. */
      function nsHunt(ocrUrl, token, seedText) {
        if (!window.TicketOCR || !TicketOCR.huntCandidates) return;
        var readEl = body.querySelector('#mt_ns_read');
        if (!readEl || !readEl.parentNode) return;
        var box = body.querySelector('#mt_ns_chips');
        if (!box) {
          box = document.createElement('div');
          box.id = 'mt_ns_chips';
          readEl.parentNode.insertBefore(box, readEl.nextSibling);
        }
        box.innerHTML = '';
        var master = parseFloat(S('odo', 0)) || null;
        TicketOCR.huntCandidates(ocrUrl, {
          kind: 'sticker',
          master: master,
          seedTexts: seedText ? [{ text: seedText, whitelist: false }] : [],
          onUpdate: function (res) {
            if (token !== nsOcrToken) return;
            box.innerHTML = '';
            var odoEl = body.querySelector('#mt_ns_odo');
            var dateEl = body.querySelector('#mt_ns_date');
            function chipGroup(label, items, render, apply) {
              var cur = render.cur();
              var list = items.filter(function (c) { return render.val(c) !== cur; }).slice(0, 4);
              if (!list.length) return;
              var lbl = document.createElement('div');
              lbl.style.cssText = 'font-size:13px;color:#555;margin:4px 0 2px';
              lbl.textContent = label;
              box.appendChild(lbl);
              list.forEach(function (c) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'btn small ghost';
                b.style.margin = '2px 4px 2px 0';
                b.textContent = render.text(c);
                b.onclick = function () {
                  apply(c);
                  nsSetRead('📸 Filled from your tap — check before saving.');
                };
                box.appendChild(b);
              });
            }
            chipGroup('Miles — tap the right one:', res.miles || [],
              { cur: function () { return odoEl ? String(odoEl.value || '').replace(/[^\d]/g, '') : ''; },
                val: function (c) { return String(c.value); },
                text: function (c) { return Number(c.value).toLocaleString('en-CA') + ' km'; } },
              function (c) { if (odoEl) odoEl.value = c.value; });
            chipGroup('Date — tap the right one:', res.dates || [],
              { cur: function () { return dateEl ? String(dateEl.value || '') : ''; },
                val: function (c) { return c.date; },
                text: function (c) { return c.date; } },
              function (c) { if (dateEl) dateEl.value = c.date; });
          }
        }).catch(function () {});
      }

      /* v61 (owner, Oct 14, from his phone screenshot): "This update
         button should also have a lil camera button to just snap a
         picture" — the Update odometer field gets the SAME photo
         pipeline as onboarding/Preferences (App._wirePhotoOCR:
         local read → v58 tap-to-pick hunt chips → v59 power-read
         escalation on a local miss), with origin 'maintenance'.
         One deliberate difference from the other hosts: the persist
         callback is a NO-OP. Every read path only FILLS #mt_odo —
         nothing writes mt_odo until the card's own Save below is
         tapped, so the master-odometer save path and its rules
         (upward-only via the normal confirmed save) are untouched. */
      try {
        if (App._wirePhotoOCR) {
          App._wirePhotoOCR('mt_odo', 'odometer', function () {}, { origin: { module: 'maintenance', label: 'Maintenance' } });
        }
      } catch (e) {}
      /* v61: a power read queued from an earlier dash photo snapped
         HERE may have finished since — offer it in the status line
         as a tap-to-use button (peek, not take). The tap only FILLS
         the field; Save still confirms. Scoped to origin
         'maintenance' so Preferences keeps offering its own. */
      try {
        if (window.PowerRead && PowerRead.peekResult) {
          var prMtOdo = PowerRead.peekResult('odometer', 'maintenance');
          if (prMtOdo && prMtOdo.fields && prMtOdo.fields.value) {
            var mtOdoSt = body.querySelector('#mt_odo_status');
            if (mtOdoSt) {
              mtOdoSt.innerHTML = '⚡ <b>Power read — check before saving:</b> from your earlier dash photo: ';
              var mtOdoBtn = document.createElement('button');
              mtOdoBtn.type = 'button';
              mtOdoBtn.className = 'btn small';
              mtOdoBtn.textContent = 'Use ' + Number(prMtOdo.fields.value).toLocaleString('en-CA') + ' km';
              mtOdoBtn.onclick = function () {
                var inp = body.querySelector('#mt_odo');
                if (inp) inp.value = prMtOdo.fields.value;
                try { PowerRead.takeResult('odometer', 'maintenance'); } catch (e) {}
                mtOdoSt.innerHTML = '⚡ Power read: <b>' + Number(prMtOdo.fields.value).toLocaleString('en-CA') + ' km</b> filled in — tap Save to keep it.';
              };
              mtOdoSt.appendChild(mtOdoBtn);
            }
          }
        }
      } catch (e) {}

      /* v86: paint the correction door live — shown only while the
         typed reading trips the two-sided gate against the master
         (App._odoImplausible), worded per direction. */
      (function () {
        var odoEl = body.querySelector('#mt_odo');
        var row = body.querySelector('#mt_odo_fixrow');
        var note = body.querySelector('#mt_odo_fixnote');
        if (!odoEl || !row) return;
        function paintFix() {
          var master = (window.App && App._masterOdometer) ? App._masterOdometer() : null;
          var v = parseFloat(odoEl.value);
          var why = (v > 0 && master !== null && window.App && App._odoImplausible) ? App._odoImplausible(v) : null;
          if (why === 'jump') {
            row.style.display = '';
            if (note) note.textContent = 'That\'s way past the odometer now (' + kmStr(master) + ') — it can\'t be right; it\'s likely another number (a receipt\'s invoice number, say). Saving keeps ' + kmStr(master) + ' unless you tick the box to say the saved reading is wrong.';
          } else if (why === 'below') {
            row.style.display = '';
            if (note) note.textContent = 'That\'s lower than the odometer now (' + kmStr(master) + '). Odometers only move up — saving keeps ' + kmStr(master) + ' unless you tick the box to say the saved reading is wrong.';
          } else {
            row.style.display = 'none';
          }
        }
        odoEl.addEventListener('input', paintFix);
        paintFix();
      })();

      body.querySelector('#mt_odo_save').onclick = function () {
        var v = parseFloat(body.querySelector('#mt_odo').value);
        if (!(v > 0)) { alert('Enter a valid odometer reading.'); return; }
        /* v86: this Save writes the ONE master odometer (mt_odo) —
           it now goes through the same two-sided supervised
           decision as Preferences and Fuel. Before v86 it wrote
           the typed number straight over the master — any value,
           either direction, not even upward-only. */
        var master = (window.App && App._masterOdometer) ? App._masterOdometer() : null;
        var fixEl = body.querySelector('#mt_odo_fix');
        var dec = (window.App && App._odoSaveDecision)
          ? App._odoSaveDecision(v, master, !!(fixEl && fixEl.checked))
          : { action: 'set', value: v };
        if (dec.action === 'keep') {
          var why = (window.App && App._odoImplausible) ? App._odoImplausible(v) : null;
          alert(why === 'jump'
            ? 'Odometer kept at ' + kmStr(master) + ' — ' + kmStr(v) + ' is way past it, so it can\'t be right (it\'s likely another number, like a receipt\'s invoice number). If the saved reading itself is wrong, tick “This corrects a wrong odometer reading” and tap Save again.'
            : 'Odometer kept at ' + kmStr(master) + ' — odometers only move up. If the saved reading itself is wrong, tick “This corrects a wrong odometer reading” and tap Save again.');
          return;
        }
        if (dec.action === 'ignore') { alert('Enter a valid odometer reading.'); return; }
        W('odo', dec.value);
        /* v97: a correction through this door is audited too — same
           service-history entry the dash-photo flow writes. */
        if (dec.action === 'correct' && master !== null && master !== undefined && dec.value !== master) {
          try { logOdoCorrection(master, dec.value, 'typed reading'); } catch (e) {}
        }
        api.render(body);
        if (dec.action === 'correct') alert('Odometer corrected to ' + kmStr(dec.value) + '.');
      };

      /* v97: the dash-photo correction card. The photo pipeline is
         wired FILL-ONLY (no-op persist, same as the v61 card): every
         read path only fills #mt_fix — nothing writes the master
         until Save correction is tapped, and that save runs the
         armed supervised decision via applyOdoCorrection, which
         also writes the audit entry. */
      try {
        if (App._wirePhotoOCR) {
          App._wirePhotoOCR('mt_fix', 'odometer', function () {}, { origin: { module: 'maintenance', label: 'Maintenance' } });
        }
      } catch (e) {}
      var fixSaveBtn = body.querySelector('#mt_fix_save');
      if (fixSaveBtn) fixSaveBtn.onclick = function () {
        var fv = parseFloat(body.querySelector('#mt_fix').value);
        if (!(fv > 0)) { alert('Snap the dash or type the real odometer reading first.'); return; }
        var res = applyOdoCorrection(fv, 'dash photo');
        if (res.action === 'ignore' || res.action === 'keep') { alert('Enter a valid odometer reading.'); return; }
        api.render(body);
        alert(res.logged
          ? 'Odometer corrected to ' + kmStr(res.value) + ' — the correction is written into the service history below.'
          : 'Odometer saved at ' + kmStr(res.value) + '.');
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
        if (type === 'oil') {
          /* v49: the sticker target described THIS service — clear it so a
             stale target can't keep showing as due. The countdown falls
             back to last-service + interval from the service just logged. */
          clearNextService();
        }
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

