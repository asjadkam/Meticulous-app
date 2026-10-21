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

  /* v177 (D9, owner Oct 20, 2026): EVERY interval follows the PM
     service (A/B) interval by default. An item the owner sets to
     a different number becomes INDEPENDENT (recorded in
     mt_follow as id -> false) and keeps his number until he
     resets it to "follow PM". The Annual safety inspection is
     date-based and NEVER follows PM — it keeps its own date. */
  function followMap() {
    var f = S('follow', {});
    return (f && typeof f === 'object') ? f : {};
  }
  function intervals() {
    var d = {};
    TYPES.forEach(function (t) { d[t.id] = t.km; });
    var saved = S('intervals', {});
    Object.keys(saved).forEach(function (k) { d[k] = parseInt(saved[k], 10) || 0; });
    var pm = d.pm;
    var fol = followMap();
    TYPES.forEach(function (t) {
      if (t.id === 'pm' || t.dateBased || !(t.km > 0)) return;
      /* A SAVED number is the owner's own (it was set, by him or
         by an older build's save) — independent. No saved number
         and no independent marker: the item follows PM. */
      if (fol[t.id] === false) return;
      if (Object.prototype.hasOwnProperty.call(saved, t.id)) return;
      d[t.id] = pm;
    });
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
    var km = 0, litres = 0, cost = 0, legs = 0;
    for (var i = 1; i < f.length; i++) {
      var dist = f[i].odo - f[i - 1].odo, l = parseFloat(f[i].litres);
      /* v107 — ECONOMY SANITY (Stage 3), the same rule as Fuel's
         trend (modules/fuel.js econLegOk): a leg counts only when
         its distance is possible between fill-ups (<= 50,000 km)
         and its implied economy is possible for a truck
         (0.5–20 km/L). The plausibleReading filter above already
         drops a stamp that is impossible against the master; this
         delta guard stands even when no master judgement exists,
         so one poisoned stamp (519,326 among 168k readings) can
         never bend the average or the leg count. Data untouched. */
      if (dist > 0 && dist <= 50000 && l > 0) {
        var kpl = dist / l;
        if (kpl >= 0.5 && kpl <= 20) { km += dist; litres += l; cost += parseFloat(f[i].cost) || 0; legs++; }
      }
    }
    /* Add cost of the very first leg too (approximation: count all fill costs) */
    var totalFuelCost = 0;
    fills().forEach(function (x) { totalFuelCost += parseFloat(x.cost) || 0; });
    /* v127: LIFETIME inputs — every fill-up's litres (the fuel
       bought over the records' life) and the span the records
       cover (first → last fill date + the fill count), so the
       summary can label its lifetime figures honestly. */
    var totalLitres = 0, firstFillDate = '', lastFillDate = '';
    fills().forEach(function (x) {
      totalLitres += parseFloat(x.litres) || 0;
      var d = String(x.date || '');
      if (d) {
        if (!firstFillDate || d < firstFillDate) firstFillDate = d;
        if (!lastFillDate || d > lastFillDate) lastFillDate = d;
      }
    });
    return {
      legs: legs,
      avgKpl: litres > 0 ? (km / litres) : 0,
      costPerKm: km > 0 ? (cost / km) : 0,
      totalFuelCost: totalFuelCost,
      kmTracked: km,
      legLitres: litres,
      totalLitres: totalLitres,
      fillCount: fills().length,
      firstFillDate: firstFillDate,
      lastFillDate: lastFillDate
    };
  }

  /* v156 — LIFETIME DISTANCE TRUTH (owner, Oct 17, 2026 22:29–22:34
     MDT: "Since May or June when I started reporting fuel for this
     truck, I think this truck has had over 10,000 km's… What's leg
     suppose to be?" / "I asked for lifetime" / "System has its
     lifetime km's… what does it matter if you don't have Odos on
     [the fills]?"). He is right: a lifetime distance is the
     distance between the system's OWN odometer bookends — the
     current master minus the EARLIEST dated reading in the log
     (odo_readings) — never the sum of the legs between the few
     fills that happen to carry stamps. Before v156 the Lifetime
     block below printed that leg fragment (his real screen: 790 km
     from 2 of 56 fills) and called the leg average (5.0 km/L) the
     lifetime economy; both were fragments wearing the word
     Lifetime.
     SPAN RULE (stated): the economy divides the bookend distance
     by the litres of the fill-ups dated ON OR AFTER the earliest
     reading's date — the window the distance actually covers (a
     dated reading is a day boundary: it opens its day, so that
     day's fills belong to its window). When the earliest reading
     predates the first fill, the window is the whole record and
     the economy is the true lifetime economy. Partial coverage is
     named on the face (see lifetimeNote); with NO dated reading
     at all (or a master below the earliest), no lifetime figure
     exists and the face prints the honest state instead of a
     number. Reads the log LIVE: a past reading added later
     through the Add-a-past-reading door extends the figure on
     the next render — no migration, nothing rewritten. */
  /* v185 (ODO-BACKFILL): parse a pasted list of dated readings —
     one per line, "2026-05-04, 132450" (comma, tab, or spaces;
     the number may carry thousands commas inside quotes-free
     text only when it is the LAST field). Header lines and
     anything without a real date + a plausible odometer
     (1,000–2,000,000) are counted as unread, never guessed at.
     Pure: returns { readings: [{date, value}], bad: n }. */
  function parseOdoImportText(text) {
    var out = [], bad = 0;
    String(text || '').split(/[\r\n]+/).forEach(function (line) {
      var s = line.trim();
      if (!s) return;
      var dm = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
      if (!dm) {
        var alt = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
        if (alt) dm = [alt[0], alt[3], ('0' + alt[1]).slice(-2), ('0' + alt[2]).slice(-2)];
      }
      if (!dm) { bad++; return; }
      var date = dm[1] + '-' + dm[2] + '-' + dm[3];
      var rest = s.replace(dm[0], ' ');
      var nums = rest.match(/\d[\d,]*(?:\.\d+)?/g) || [];
      var v = nums.length ? parseFloat(nums[nums.length - 1].replace(/,/g, '')) : NaN;
      if (!(v >= 1000 && v <= 2000000)) { bad++; return; }
      out.push({ date: date, value: Math.round(v) });
    });
    out.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : a.value - b.value); });
    return { readings: out, bad: bad };
  }

  function lifetimeStats(ms) {
    ms = ms || mileageStats();
    var log = [];
    try { log = App._store.get('odo_readings', []) || []; } catch (e) {}
    var master = null;
    try { if (window.App && App._masterOdometer) master = App._masterOdometer(); } catch (e) {}
    if (!(master > 0)) { var co = currentOdo(); master = co > 0 ? co : null; }
    /* v163 HARDENING (the Oct 18 regression: the face printed a
       790 km fragment again with the note claiming readings
       "start 2026-10-13", over a log whose honest bookends give
       thousands): the earliest pick now applies the SAME poison
       discipline as every other odometer reader — a reading the
       app's gate calls a 'jump' past the master (a receipt
       invoice number wearing an odometer's clothes) is not
       evidence, and neither is any reading ABOVE the master.
       The bookend rule itself is unchanged: current master
       minus the earliest surviving dated reading. */
    var earliest = null;
    (Array.isArray(log) ? log : []).forEach(function (r) {
      if (!r || !r.date || !(parseFloat(r.value) > 0)) return;
      var v = parseFloat(r.value);
      if (master !== null && v > master) return;
      try {
        if (window.App && App._odoImplausible && App._odoImplausible(v) === 'jump') return;
      } catch (e) {}
      var cand = { date: String(r.date), value: v, ts: parseFloat(r.ts) || 0 };
      if (!earliest || cand.date < earliest.date ||
          (cand.date === earliest.date && cand.ts < earliest.ts)) earliest = cand;
    });
    if (!earliest || master === null || master < earliest.value) {
      return {
        ok: false, earliest: earliest, master: master, distance: 0,
        fromDate: earliest ? earliest.date : '', windowLitres: 0,
        economy: 0, fullCoverage: false
      };
    }
    var windowLitres = 0;
    fills().forEach(function (x) {
      var d = String((x && x.date) || '');
      if (d && d >= earliest.date) windowLitres += parseFloat(x.litres) || 0;
    });
    var distance = master - earliest.value;
    return {
      ok: true, earliest: earliest, master: master, distance: distance,
      fromDate: earliest.date, windowLitres: windowLitres,
      economy: windowLitres > 0 ? distance / windowLitres : 0,
      fullCoverage: !ms.firstFillDate || earliest.date <= ms.firstFillDate
    };
  }

  /* v156: the Lifetime footer's words — the span said out loud in
     each of the three states (full window / partial window named
     by its from-date / no readings yet). */
  function lifetimeNote(ms, lt) {
    var span = (ms.firstFillDate ? ', ' + esc(ms.firstFillDate) + ' → ' + esc(ms.lastFillDate) : '') +
      ' (' + ms.fillCount + ' fill-up' + (ms.fillCount === 1 ? '' : 's') + ')';
    if (lt.ok && lt.fullCoverage) {
      return 'Lifetime — from your fill-up records' + span + '. Distance runs from your earliest odometer reading (' +
        esc(lt.fromDate) + ') to today\'s odometer; fuel counts every fill-up.';
    }
    if (lt.ok) {
      return 'Lifetime — fuel counts every fill-up in your records' + span + ', but your dated odometer readings start ' +
        esc(lt.fromDate) + ' — so distance and economy cover ' + esc(lt.fromDate) +
        ' → today. Add an earlier reading above and the lifetime figures reach back with it.';
    }
    return 'Lifetime — fuel counts every fill-up in your records' + span + '. Distance and economy come from your dated odometer readings, and none are on record yet — no figure is printed rather than a wrong one.';
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
    /* v122: an applied master write joins the dated readings log
       (a correction may legitimately sit below the old master —
       it is the supervised door, so it logs as one). */
    try { if (window.App && App._logOdoReading) App._logOdoReading(dec.value, 'maintenance', null, true); } catch (e) {}
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
  /* v127: economy figures print in the driver's chosen unit
     (App._econFormat — Preferences → "Fuel economy shown as").
     Falls back to km/L when the helper is absent (partial load). */
  function econDisp(kpl) {
    var f = null;
    try { if (window.App && App._econFormat) f = App._econFormat(parseFloat(kpl)); } catch (e) {}
    return f || { value: (parseFloat(kpl) || 0).toFixed(1), unit: 'km/L' };
  }

  var api = {
    /* Account-type gate: REMOVED (Oct 13, 2026) — the owner is a Driver and
       needs access to everything. Everyone sees Maintenance. Kept for API compat. */
    _allowed: function () { return true; },
    _dueItems: dueItems,
    _mileageStats: mileageStats,
    _lifetimeStats: lifetimeStats, /* v156: the bookend lifetime derivation */
    _parseOdoImportText: parseOdoImportText, /* v185: the bulk-import parser */
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
      var msEcon = econDisp(ms.avgKpl); /* v127: the summary economy, in the chosen unit */
      /* v156: the LIFETIME figures (bookends) — the headline
         economy is the lifetime economy whenever a true bookend
         figure exists; the leg average remains only as the
         fallback for a face with no dated readings yet. */
      var lt = lifetimeStats(ms);
      var ltEcon = econDisp(lt.economy);
      var headEcon = (lt.ok && lt.economy > 0) ? ltEcon : msEcon;
      var headEconShow = (lt.ok && lt.economy > 0) || ms.legs > 0;
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
        (headEconShow ? headEcon.value + ' <small style="font-size:12px">' + headEcon.unit + '</small>' : '—') + '</div></div>' +
        '<div class="card" style="flex:1;margin:0"><div class="note">Maint. spend (all)</div>' +
        '<div class="center" style="font-size:20px;font-weight:800;color:var(--navy)">' + money(totalMaint) + '</div></div>' +
        '</div>' +
        '<div class="kv"><span>Fuel cost per km</span><b>' + (ms.kmTracked > 0 ? '$' + ms.costPerKm.toFixed(3) : '—') + '</b></div>' +
        '<div class="kv"><span>Total fuel spend</span><b>' + money(ms.totalFuelCost) + '</b></div>' +
        /* v127 (owner, Oct 17 09:39 MDT: "It should tell over the
           life time how many km's and how many liters of fuel and
           how much kmpl"): the LIFETIME block — distance + fuel +
           economy over every record the app holds, with the span
           the records cover said out loud.
           v156 (owner, Oct 17 22:29–22:34 MDT): the distance and
           economy are the BOOKEND figures now (lifetimeStats —
           master minus the earliest dated reading, over the
           window that reading opens); the leg figures live on
           ONLY as their own labelled line — the diesel watch's
           instrument — and never again AS the Lifetime rows. */
        (ms.fillCount > 0
          ? (lt.ok
              ? '<div class="kv"><span>Lifetime distance</span><b>' + kmStr(lt.distance) + '</b></div>'
              : '<div class="kv"><span>Lifetime distance</span><b>—</b></div>') +
            '<div class="kv"><span>Lifetime fuel</span><b>' + ms.totalLitres.toFixed(1) + ' L</b></div>' +
            (lt.ok && lt.windowLitres > 0 ? '<div class="kv"><span>Lifetime economy</span><b>' + ltEcon.value + ' ' + ltEcon.unit + '</b></div>' : '') +
            /* v163: the "Between fill-ups (legs)" line is DELETED
               (owner, Oct 18, 2026 20:56 MDT) — not fixed, gone.
               The leg math still runs inside mileageStats (the
               fuel trend reads it); it simply has no row here. */
            '<p class="note">' + lifetimeNote(ms, lt) + '</p>'
          : '') +
        '<p class="note">Fuel figures come from your Fuel &amp; Expense fill-ups. Add fill-ups there to sharpen these numbers.</p>' +
        '<div class="row"><div><label class="f">Update odometer (km)</label><input id="mt_odo" type="number" inputmode="decimal" placeholder="' + (d.odo > 0 ? Math.round(d.odo) : '') + '"></div>' +
        '<div><label class="f">&nbsp;</label><button class="btn navy" id="mt_odo_save">Save</button></div></div>' +
        /* v86: the correction door for THIS card. v107 (Stage 4):
           the door is no longer a checkbox — when a Save trips the
           two-sided gate, this row asks ONCE, right here, whether
           the SAVED value is the wrong one (see the Save handler);
           the correction button runs the audited correction path.
           Hidden while the typed reading is an ordinary one. */
        '<div id="mt_odo_fixrow" style="display:none;margin-top:6px;">' +
        '<p class="note" id="mt_odo_fixnote" style="color:#c2410c;font-weight:600"></p>' +
        '<div id="mt_odo_ask" class="row" style="display:none;margin-top:6px;">' +
        '<button type="button" class="btn navy" id="mt_odo_correct" style="flex:1;">Save as correction</button>' +
        '<button type="button" class="btn ghost" id="mt_odo_keep" style="flex:1;">Keep the saved one</button></div></div>' +
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
        /* v127: the past-reading door — a quiet secondary in this
           card (wiring below): a reading from before the app, or
           one that was missed, recorded with its true date so
           that day's manifest gets its real start and end. */
        '<button type="button" class="btn small ghost" id="mt_past_toggle" style="margin-top:6px;">＋ Add a past reading</button>' +
        '<div id="mt_past_box" style="display:none;margin-top:8px;">' +
        '<p class="note">Recorded with the date you pick — it never moves today\'s odometer.</p>' +
        '<div class="row"><div><label class="f">Date</label><input type="date" id="mt_past_date" value="' + App._today() + '"></div>' +
        '<div><label class="f">Time</label><input type="time" id="mt_past_time"></div></div>' +
        '<div class="row"><div><label class="f">Odometer (km)</label><input id="mt_past_val" type="number" inputmode="decimal" placeholder="e.g. 169166"></div>' +
        '<div><label class="f">&nbsp;</label><button class="btn navy" id="mt_past_save">Save past reading</button></div></div>' +
        '<div id="mt_past_note" class="note"></div>' +
        /* v185 (ODO-BACKFILL): the BULK door — a whole list from
           his monthly sheets at once. Paste → Review (the parsed
           list is shown back) → Confirm import. Nothing is
           written before the Confirm tap, ever. */
        '<div style="margin-top:10px;border-top:1px solid #ddd;padding-top:8px">' +
        '<label class="f">…or bring in a whole list at once (from a sheet)</label>' +
        '<p class="note" style="margin:2px 0 6px">One reading per line: the date, then the odometer — like <b>2026-05-04, 132450</b>. Copy the lines from the file Muse made from your sheets and paste them here.</p>' +
        '<textarea id="mt_past_bulk" rows="5" placeholder="2026-05-04, 132450" style="width:100%"></textarea>' +
        '<div class="row" style="margin-top:6px"><button type="button" class="btn secondary" id="mt_past_review" style="flex:1">Review the list</button>' +
        '<button type="button" class="btn primary hidden" id="mt_past_confirm" style="flex:1">Confirm import</button></div>' +
        '<div id="mt_past_bulk_note" class="note" style="margin-top:6px"></div></div>' +
        '</div>' +
        '</div>';

      /* v107 (Stage 4): the separate v97 "Correct odometer from
         dash photo" card is GONE — the owner's rule (Oct 16 19:29)
         is ONE odometer card: one field, one photo pair, one Save,
         and the correction question asked inside this same card
         (the mt_odo_fixrow ask above). Two cards doing one job
         made him look twice. */

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
        (S('ns_sticker_photo', '') ? '<img src="' + esc(S('ns_sticker_photo', '')) + '" style="width:100%;border-radius:10px;margin-top:8px" alt="Service sticker photo">' +
          (App._photoDl ? App._photoDl(S('ns_sticker_photo', ''), 'service-sticker') : '') : '') +
        '<div class="row"><button class="btn navy" id="mt_ns_save">Save next service</button>' +
        ((nsNow.odo > 0 || nsNow.date) ? '<button class="btn ghost" id="mt_ns_clear">Clear</button>' : '') +
        '</div></div>';

      /* --- Annual safety inspection sticker (v127) ---
         Owner, Oct 17 09:32 MDT: "maintenance should have section
         to take a picture of the annual safety sticker." Until now
         the date lived only in Preferences (Maintenance merely
         DISPLAYED it in Upcoming, and the intervals card below
         holds a bare date input). This card is the capture home:
         snap the sticker → the shared photo pipeline reads the
         expiry (local read, month/year steppers on a miss, power
         read behind that) → the read lands in the date box →
         Save expiry confirms. Fill-only reads, exactly like this
         module's odometer card (v61): nothing is written by a
         read; Save writes BOTH stores of the fact (mt_annualDate
         + the onboarding mirror, the v118 two-store rule). */
      var sfNow = S('annualDate', '');
      var sfLine = 'No expiry saved yet.';
      if (sfNow) {
        var sfDays = Math.round((new Date(sfNow + 'T12:00:00') - new Date(App._today() + 'T12:00:00')) / 86400000);
        sfLine = 'Expires <b>' + esc(sfNow) + '</b> — ' + (sfDays < 0
          ? '<span style="color:#c0392b;font-weight:800">⚠️ OVERDUE by ' + Math.abs(sfDays) + ' day' + (Math.abs(sfDays) === 1 ? '' : 's') + '</span>'
          : 'due in ' + sfDays + ' day' + (sfDays === 1 ? '' : 's'));
      }
      h += '<div class="card"><h3>🛡️ Annual safety inspection</h3>' +
        '<p class="note" style="margin-top:0">' + sfLine + '</p>' +
        '<p class="note">Snap the sticker on the windshield — the read lands in the box below; check it, then Save. A punched sticker expires on the last day of the punched month; if the punches won\'t read, you tap the month and year instead.</p>' +
        '<label class="f">📷 Safety sticker photo</label>' +
        '<input type="file" id="mt_safety_cam_in" accept="image/*" capture="environment" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<input type="file" id="mt_safety_in" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<div class="row"><button type="button" class="btn secondary" id="mt_safety_cam" style="flex:1;">📷 Take photo</button>' +
        '<button type="button" class="btn secondary" id="mt_safety_pick" style="flex:1;">📁 Choose file</button></div>' +
        '<div id="mt_safety_prev"></div><div id="mt_safety_status" class="note"></div>' +
        (App._store.get('mt_safety_photo', '') ? '<img src="' + esc(App._store.get('mt_safety_photo', '')) + '" style="width:100%;border-radius:10px;margin-top:8px" alt="Safety sticker photo">' +
          (App._photoDl ? App._photoDl(App._store.get('mt_safety_photo', ''), 'safety-sticker') : '') : '') +
        '<label class="f">Expiry date</label><input id="mt_safety" type="date" value="' + esc(sfNow) + '">' +
        '<div class="row" style="margin-top:8px"><button class="btn navy" id="mt_safety_save">Save expiry</button></div></div>';

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
      var folNow = followMap();
      h += '<div class="card"><h3>⚙️ Service intervals</h3>' +
        '<p class="note">How many km between services. Every item follows the PM service interval — change one and it keeps your number instead; tap “Follow PM” to go back. Set 0 to turn a reminder off. The annual inspection keeps its own date below — it never follows PM.</p>';
      var savedNow = S('intervals', {});
      TYPES.forEach(function (t) {
        if (t.dateBased) return;
        var follows = t.id !== 'pm' && t.km > 0 && folNow[t.id] !== false &&
          !Object.prototype.hasOwnProperty.call(savedNow, t.id);
        h += '<div class="kv"><span>' + t.name + (t.id === 'pm' ? '' : (follows ? ' <span class="note">· follows PM</span>' : ' <span class="note">· your own number</span>')) + '</span>' +
          '<span><input type="number" inputmode="numeric" min="0" step="100" data-mtint="' + t.id + '" value="' + (iv[t.id] || 0) + '" style="width:110px"> km' +
          ((t.id !== 'pm' && t.km > 0 && !follows) ? ' <button class="btn small ghost" data-mtfollow="' + t.id + '">Follow PM</button>' : '') +
          '</span></div>';
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
      /* v142: per-photo race record for the sticker read. */
      var nsRace = null;
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
          /* v182 (P1): the sticker photo is KEPT on the record —
             a downloadable copy lives with the next-service fact. */
          try { W('ns_sticker_photo', ocrUrl); } catch (e) {}
          /* v142: the cloud read starts NOW, in parallel with the
             local read, on its own smaller rendition. */
          var race = { odo: null, date: null, delivered: false, prImg: null };
          nsRace = race;
          var startCloud = function (prImg) {
            if (token !== nsOcrToken) return;
            race.prImg = prImg || ocrUrl;
            if (window.PowerRead && PowerRead.beginEarly) {
              var h = PowerRead.beginEarly({ reader: 'sticker', image: race.prImg, origin: { module: 'maintenance', label: 'Maintenance' } });
              if (h) h.onSettled(function (out) { nsCloudSettled(token, race, out); });
            }
          };
          if (TicketOCR.urlToReadImage) TicketOCR.urlToReadImage(ocrUrl, 'sticker', startCloud);
          else startCloud(ocrUrl);
          TicketOCR.recognizeWithRotation(ocrUrl, function (p) {
            if (token !== nsOcrToken) return;
            try { nsSetRead('📖 Reading sticker… ' + Math.round(p * 100) + '%'); } catch (e) {}
          }).then(function (text) {
            if (token !== nsOcrToken) return;
            var parsed = TicketOCR.parseServiceSticker(text);
            race.odo = parsed.odo || null;
            race.date = parsed.date || null;
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
            if (!rep.found.length) nsPowerRead(race.prImg || ocrUrl, token, race);
          }).catch(function () {
            if (token !== nsOcrToken) return;
            nsSetRead('<span style="color:#e67e22">Couldn\'t read that sticker — type it in.</span>');
          });
        });
      }
      /* v142: the sticker's cloud read settles. Per field: fill an
         empty input, correct an input still holding exactly the
         local read's value, never displace a value the driver
         typed. The card's Save stays the confirm. */
      function nsCloudSettled(token, race, out) {
        if (token !== nsOcrToken || race !== nsRace) return;
        if (!out || out.status !== 'done') return;
        var f = out.fields || {};
        if (!f.odo && !f.date) return;
        if (race.delivered) return;
        race.delivered = true;
        var notes = [], corrected = false, agreed = false;
        function apply(sel, cloudVal, localVal, label) {
          if (!cloudVal) return;
          var e = body.querySelector(sel);
          if (!e) return;
          if (!localVal) { if (!e.value) { e.value = cloudVal; notes.push(label); } return; }
          if (String(cloudVal) === String(localVal)) { agreed = true; return; }
          if (String(e.value) === String(localVal)) { e.value = cloudVal; corrected = true; notes.push(label); }
        }
        apply('#mt_ns_odo', f.odo, race.odo, 'next service ' + (f.odo ? Number(f.odo).toLocaleString('en-CA') + ' km' : ''));
        apply('#mt_ns_date', f.date, race.date, 'due date ' + (f.date || ''));
        if (corrected) nsSetRead('⚡ <b>Power read corrected:</b> ' + esc(notes.join(' · ')) + ' — check before saving.');
        else if (notes.length) nsSetRead('⚡ <b>Power read — check before saving:</b> ' + esc(notes.join(' · ')) + ' filled in above.');
        else if (agreed) nsSetRead('✓ Power read agrees with the sticker read — check before saving.');
        else nsSetRead('⚡ Power read read the sticker differently — your values stay in the fields; its read: ' + esc(describeStickerPower(f)) + '.');
      }
      if (nsCamInput) nsCamInput.onchange = nsHandlePhoto;
      if (nsPickInput) nsPickInput.onchange = nsHandlePhoto;

      /* v59: power-read escalation for the sticker photo. Fill-only,
         exactly like the local read and the hunt chips — the card's
         Save is the one and only confirm. */
      function nsPowerRead(ocrUrl, token, race) {
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
            /* v142: no double-paint when the settle callback
               already delivered this read. */
            if (race) {
              if (race.delivered) return;
              race.delivered = true;
            }
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
      /* v127: the safety sticker card wires to the SAME pipeline
         with the same fill-only contract (no-op persist — reads
         land in #mt_safety only). Its Save is the confirm: it
         writes mt_annualDate AND mirrors onboarding.safetyExpiry,
         the two-store rule (v118) the intervals Save below and
         the Preferences save both follow, so no later save from
         any screen can resurrect a stale date. */
      try {
        if (App._wirePhotoOCR) {
          App._wirePhotoOCR('mt_safety', 'safety', function () {}, { origin: { module: 'maintenance', label: 'Maintenance' }, keepKey: 'mt_safety_photo' });
        }
      } catch (e) {}
      var sfSaveBtn = body.querySelector('#mt_safety_save');
      if (sfSaveBtn) sfSaveBtn.onclick = function () {
        var v = body.querySelector('#mt_safety').value || '';
        W('annualDate', v);
        try {
          var obSf = App._store.get('onboarding', {}) || {};
          if (String(obSf.safetyExpiry || '') !== v) { obSf.safetyExpiry = v; App._store.set('onboarding', obSf); }
        } catch (e) {}
        api.render(body);
      };
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
         (App._odoImplausible), worded per direction.
         v107: no checkbox any more — the note just says what Save
         will do: ask. The ask itself lives in the Save handler. */
      (function () {
        var odoEl = body.querySelector('#mt_odo');
        var row = body.querySelector('#mt_odo_fixrow');
        var note = body.querySelector('#mt_odo_fixnote');
        if (!odoEl || !row) return;
        function paintFix() {
          var master = (window.App && App._masterOdometer) ? App._masterOdometer() : null;
          var v = parseFloat(odoEl.value);
          var why = (v > 0 && master !== null && window.App && App._odoImplausible) ? App._odoImplausible(v) : null;
          var ask = body.querySelector('#mt_odo_ask');
          if (why === 'jump') {
            row.style.display = '';
            if (note) note.textContent = 'That\'s way past the odometer now (' + kmStr(master) + ') — it can\'t be right; it\'s likely another number (a receipt\'s invoice number, say). Tap Save and the card will ask before anything changes.';
          } else if (why === 'below') {
            row.style.display = '';
            if (note) note.textContent = 'That\'s lower than the odometer now (' + kmStr(master) + '). Odometers only move up — tap Save and the card will ask before anything changes.';
          } else {
            row.style.display = 'none';
            if (ask) ask.style.display = 'none';
          }
        }
        odoEl.addEventListener('input', paintFix);
        paintFix();
      })();

      body.querySelector('#mt_odo_save').onclick = function () {
        var v = parseFloat(body.querySelector('#mt_odo').value);
        if (!(v > 0)) { alert('Enter a valid odometer reading.'); return; }
        /* The Save writes the ONE master odometer (mt_odo) through
           the two-sided supervised decision, UNARMED: an ordinary
           reading sets it; a gated one (below the master, or past
           the jump gate) is NOT written and NOT silently refused —
           v107 asks ONCE, in this card, in the owner's framing:
           the saved number is the suspect, the new one is the
           candidate correction. Confirming runs the audited
           correction path (applyOdoCorrection: armed decision +
           master write + service-history entry); declining keeps
           the saved value, untouched. */
        var master = (window.App && App._masterOdometer) ? App._masterOdometer() : null;
        var dec = (window.App && App._odoSaveDecision)
          ? App._odoSaveDecision(v, master, false)
          : { action: 'set', value: v };
        if (dec.action === 'ignore') { alert('Enter a valid odometer reading.'); return; }
        if (dec.action === 'set') {
          W('odo', dec.value);
          /* v122: the night's dash save is THE reading the
             manifest's day boundaries are drawn from — it joins
             the dated readings log like every master write. */
          try { if (window.App && App._logOdoReading) App._logOdoReading(dec.value, 'maintenance'); } catch (e) {}
          api.render(body);
          return;
        }
        /* dec.action === 'keep' — gated and unarmed: ask. */
        var row = body.querySelector('#mt_odo_fixrow');
        var note = body.querySelector('#mt_odo_fixnote');
        var ask = body.querySelector('#mt_odo_ask');
        var corrBtn = body.querySelector('#mt_odo_correct');
        var keepBtn = body.querySelector('#mt_odo_keep');
        if (!row || !ask || !corrBtn || !keepBtn) { alert('Odometer kept at ' + kmStr(master) + '.'); return; }
        row.style.display = '';
        ask.style.display = '';
        if (note) note.textContent = 'The saved odometer (' + kmStr(master) + ') looks wrong — save ' + kmStr(v) + ' as a correction? The correction is written into the service history.';
        corrBtn.textContent = 'Save ' + kmStr(v) + ' as a correction';
        corrBtn.onclick = function () {
          var res = applyOdoCorrection(v, 'odometer card');
          if (res.action === 'ignore' || res.action === 'keep') { alert('Enter a valid odometer reading.'); return; }
          api.render(body);
          alert(res.logged
            ? 'Odometer corrected to ' + kmStr(res.value) + ' — the correction is written into the service history below.'
            : 'Odometer saved at ' + kmStr(res.value) + '.');
        };
        keepBtn.onclick = function () {
          ask.style.display = 'none';
          if (note) note.textContent = 'Kept ' + kmStr(master) + ' — nothing was changed.';
        };
      };

      /* v127: the past-reading door's wiring. The write goes
         through the audited correction path — App._logOdoReading
         with isCorrection: a past reading sits BELOW today's
         master by nature, and this door's whole point is history,
         so the supervised flag is what lets it land; the master
         itself is never touched by the log. The box stays open
         after a save, so several missed readings can go in one
         after another (the owner's backfill is three). */
      (function () {
        var tgl = body.querySelector('#mt_past_toggle');
        var box = body.querySelector('#mt_past_box');
        var save = body.querySelector('#mt_past_save');
        var note = body.querySelector('#mt_past_note');
        if (!tgl || !box || !save) return;
        tgl.onclick = function () { box.style.display = (box.style.display === 'none') ? '' : 'none'; };
        save.onclick = function () {
          var dEl = body.querySelector('#mt_past_date');
          var tEl = body.querySelector('#mt_past_time');
          var vEl = body.querySelector('#mt_past_val');
          var v = vEl ? parseFloat(vEl.value) : NaN;
          var dv = dEl ? dEl.value : '';
          if (!(v > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(dv || '')) {
            if (note) note.innerHTML = '<span style="color:#c2410c;font-weight:600">Enter the reading and its date.</span>';
            return;
          }
          var p = dv.split('-');
          var tp = /^(\d{1,2}):(\d{2})/.exec((tEl && tEl.value) || '');
          var ts = new Date(+p[0], +p[1] - 1, +p[2], tp ? +tp[1] : 12, tp ? +tp[2] : 0).getTime();
          var added = false;
          try { if (window.App && App._logOdoReading) added = !!App._logOdoReading(v, 'past', ts, true); } catch (e) {}
          if (!added) {
            /* the log's only refusal at a chosen past stamp is
               its same-value collapse — say whether this exact
               reading is already recorded for that day. */
            var already = false;
            try {
              var rl = App._store.get('odo_readings', []) || [];
              already = rl.some(function (r) { return r && parseFloat(r.value) === v && r.date === dv; });
            } catch (e) {}
            if (note) note.innerHTML = already
              ? 'That reading is already recorded for ' + esc(dv) + ' — nothing added.'
              : '<span style="color:#c2410c;font-weight:600">Couldn\'t record that reading.</span>';
            return;
          }
          if (vEl) vEl.value = '';
          if (note) note.innerHTML = '✓ Recorded <b>' + Math.round(v).toLocaleString('en-CA') + ' km</b> for ' + esc(dv) + '. Add another, or keep going.';
        };
        /* v185: the bulk door's wiring — Review parses and shows
           the list back; Confirm is the ONLY write, through
           App._importOdoReadings (seed-discipline merge). */
        var bulkTa = body.querySelector('#mt_past_bulk');
        var bulkReview = body.querySelector('#mt_past_review');
        var bulkConfirm = body.querySelector('#mt_past_confirm');
        var bulkNote = body.querySelector('#mt_past_bulk_note');
        var bulkParsed = null;
        if (bulkReview && bulkTa) bulkReview.onclick = function () {
          bulkParsed = parseOdoImportText(bulkTa.value);
          if (!bulkParsed.readings.length) {
            if (bulkNote) bulkNote.innerHTML = '<span style="color:#c2410c;font-weight:600">No readings could be read from that list.</span> Each line needs a date like 2026-05-04 and the odometer number.';
            if (bulkConfirm) bulkConfirm.classList.add('hidden');
            return;
          }
          var f = bulkParsed.readings[0], l = bulkParsed.readings[bulkParsed.readings.length - 1];
          if (bulkNote) bulkNote.innerHTML = 'Ready to import <b>' + bulkParsed.readings.length + ' readings</b>: ' +
            esc(f.date) + ' — ' + Math.round(f.value).toLocaleString('en-CA') + ' km → ' +
            esc(l.date) + ' — ' + Math.round(l.value).toLocaleString('en-CA') + ' km.' +
            (bulkParsed.bad ? ' (' + bulkParsed.bad + ' line' + (bulkParsed.bad === 1 ? '' : 's') + ' could not be read and will be left out.)' : '') +
            ' Check the dates and numbers, then tap Confirm import.';
          if (bulkConfirm) bulkConfirm.classList.remove('hidden');
        };
        if (bulkConfirm) bulkConfirm.onclick = function () {
          if (!bulkParsed || !bulkParsed.readings.length) return;
          var res = { added: 0, skipped: 0 };
          try { if (window.App && App._importOdoReadings) res = App._importOdoReadings(bulkParsed.readings, 'sheet-import'); } catch (e) {}
          if (bulkNote) bulkNote.innerHTML = '✓ Imported <b>' + res.added + ' readings</b>' +
            (res.skipped ? ' — ' + res.skipped + ' were already recorded or did not fit the record in order, and were left out.' : '.') +
            ' Your lifetime distance now starts from the earliest of them.';
          bulkConfirm.classList.add('hidden');
          bulkParsed = null;
        };
      })();

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

      /* v177 (D9): "Follow PM" resets — the item drops its
         independent marker AND its saved number, and reads at
         the PM interval again. */
      body.querySelectorAll('[data-mtfollow]').forEach(function (b) {
        b.onclick = function () {
          var id = b.getAttribute('data-mtfollow');
          var f = followMap();
          delete f[id];
          W('follow', f);
          var sv = S('intervals', {});
          if (sv && Object.prototype.hasOwnProperty.call(sv, id)) { delete sv[id]; W('intervals', sv); }
          api.render(body);
        };
      });
      body.querySelector('#mt_save_int').onclick = function () {
        var nv = {};
        body.querySelectorAll('[data-mtint]').forEach(function (inp) {
          nv[inp.getAttribute('data-mtint')] = parseInt(inp.value, 10) || 0;
        });
        W('intervals', nv);
        /* v177 (D9): an item saved AT the PM number follows PM;
           an item saved at any other number is the owner's own
           and stays independent until reset. */
        var folSave = followMap();
        TYPES.forEach(function (t) {
          if (t.id === 'pm' || t.dateBased || !(t.km > 0)) return;
          if ((nv[t.id] || 0) === (nv.pm || 0)) delete folSave[t.id];
          else folSave[t.id] = false;
        });
        W('follow', folSave);
        var annualV = body.querySelector('#mt_annual').value || '';
        W('annualDate', annualV);
        /* v118: keep the two stores of this one fact in step at
           the write point — a Maintenance save also lands in
           onboarding.safetyExpiry, so a later Preferences save
           has nothing stale left to resurrect (the mirror that
           reverted the owner's sticker to May 1 ran the other
           way, from the form; see preferences.js pfSafetyWinner). */
        try {
          var ob = App._store.get('onboarding', {}) || {};
          if (String(ob.safetyExpiry || '') !== annualV) { ob.safetyExpiry = annualV; App._store.set('onboarding', ob); }
        } catch (e) {}
        api.render(body);
      };
      /* v146: my shared records republish on this module's own
         lifecycle — a service logged, an odometer saved, a due
         date changed here lands in my connected payers' hands on
         the same pass this screen repaints (content-guarded in
         the pipe: unchanged facts are never written twice). */
      try { if (window.ConnectPipe) ConnectPipe.publishRecords(); } catch (e) {}
    }
  };

  Meticulous.modules.maintenance = api;
})();

