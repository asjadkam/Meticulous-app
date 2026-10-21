/* P&L (Profit & Loss) module — Meticulous standalone
   Owner-Operator and Fleet Manager ONLY. Never shown to Driver accounts.
   Income: pulled from Revenue module (rev_entries + rev_extras).
   Expenses: pulled from Fuel module (fuel_fills + fuel_expenses) plus
   manual business expenses entered here (pnl_expenses).
   Persists via App._store (localStorage, mt_ prefix). Firebase via FB.saveDoc.
*/
(function () {
  'use strict';
  window.Meticulous = window.Meticulous || {};
  Meticulous.modules = Meticulous.modules || {};

  var S = function (k, d) { return App._store.get('pnl_' + k, d); };
  var W = function (k, v) { App._store.set('pnl_' + k, v); };
  var esc = function (s) { return App._esc(s); };

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var BIZ_CATS = ['Insurance', 'Truck payment', 'Maintenance', 'Tires', 'Permits & Licenses', 'Phone', 'Other'];

  /* Workers' comp name + ballpark default rate (%) by province.
     Alberta = WCB, Ontario = WSIB, BC = WorkSafeBC, Quebec = CNESST, etc.
     Rates vary by industry class and year — every default is editable in the UI. */
  var WC_BY_PROVINCE = {
    'Alberta': { label: 'WCB', defRate: 2.75 },
    'British Columbia': { label: 'WorkSafeBC', defRate: 2.50 },
    'Manitoba': { label: 'WCB', defRate: 3.00 },
    'New Brunswick': { label: 'WorkSafeNB', defRate: 2.50 },
    'Newfoundland and Labrador': { label: 'WorkplaceNL', defRate: 2.75 },
    'Nova Scotia': { label: 'WCB', defRate: 2.50 },
    'Ontario': { label: 'WSIB', defRate: 4.88 },
    'Prince Edward Island': { label: 'WCB', defRate: 2.50 },
    'Quebec': { label: 'CNESST', defRate: 3.20 },
    'Saskatchewan': { label: 'WCB', defRate: 2.50 },
    'Northwest Territories': { label: 'WSCC', defRate: 2.25 },
    'Nunavut': { label: 'WSCC', defRate: 2.25 },
    'Yukon': { label: 'WCB', defRate: 2.25 }
  };

  /* Home province from Preferences (onboarding store). Used for the
     workers' comp label. Returns '' when the user never set one. */
  function homeProvince() {
    try { return String((App._store.get('onboarding', {}).homeProvince || '')).trim(); } catch (e) { return ''; }
  }

  /* { label, defRate } for the workers' comp line. No province set →
     generic "Workers' comp" (editable label via Preferences). */
  function wcInfo() {
    var w = WC_BY_PROVINCE[homeProvince()];
    if (w) return { label: w.label, defRate: w.defRate };
    return { label: "Workers' comp", defRate: 4.88 };
  }

  /* Detailed expense categories — matches the owner's "monthly analysis" spreadsheet.
     auto: 'pct_rev' = % of revenue, 'pct_wages' = % of driver wages,
           'maintenance' = auto from Maintenance module, null = manual entry.
     The 'wsib' row (key kept for storage compat) takes its label and default
     rate from wcInfo() so it reads WCB in Alberta, WSIB in Ontario, etc. */
  var DETAIL_CATS = [
    { key: 'brokerage', label: 'Brokerage fees', auto: 'pct_rev', defRate: 10 },
    { key: 'trailer', label: 'Trailer', auto: null },
    { key: 'wsib', wc: true, auto: 'pct_wages', sub: '% of employee pay' },
    { key: 'irp', label: 'IRP escrow', auto: null },
    { key: 'parking', label: 'Parking', auto: null },
    { key: 'repair', label: 'Repair', auto: null },
    /* v163: the NATL line is DELETED (owner, Oct 18, 2026 21:06
       MDT) — NATL is one specific benefits package, not a
       generic expense line, so it never belonged on the
       standard list. A saved 'natl' amount in pnl_detail is
       simply no longer read: the row is gone from the face and
       from every total. */
    { key: 'maintenance', label: 'Maintenance', auto: 'maintenance' },
    { key: 'misc', label: 'Misc.', auto: null },
    { key: 'elog', label: 'Elog', auto: null },
    { key: 'insurance', label: 'Truck insurance', auto: null }
  ];

  /* v163: CUSTOM expense lines (owner, Oct 18, 2026 21:06 MDT:
     a "+" at the end of the line items for any generic expense
     not pre-listed). The user's own lines live in
     pnl_custom_cats ([{key, label}]); their amounts ride the
     same pnl_detail store as the standard lines, so a custom
     line behaves exactly like a built-in manual line — typed
     amount per month, counted in the detail total. */
  function customCats() {
    var l = S('custom_cats', []);
    return (Array.isArray(l) ? l : []).filter(function (c) { return c && c.key && c.label; })
      .map(function (c) { return { key: c.key, label: c.label, auto: null, custom: true }; });
  }
  function allDetailCats() { return DETAIL_CATS.concat(customCats()); }

  function detailStore() { return S('detail', {}); }
  function detailRates() { return S('detail_rates', {}); }

  /* Manual/auto amounts for the detailed categories for a month.
     Returns { key: { amount, auto, rate } }. */
  function detailAmounts(m, income, wages) {
    var saved = detailStore()[m] || {};
    var rates = detailRates();
    var maintTotal = 0;
    (App._store.get('mt_events', []) || []).forEach(function (e) {
      if (!inMonth(e.date, m)) return;
      maintTotal += parseFloat(e.cost) || 0;
    });
    var out = {};
    var wc = wcInfo(); /* dynamic workers' comp label + default rate */
    allDetailCats().forEach(function (c) {
      var sv = saved[c.key] || {};
      var amount = 0, auto = !!c.auto, rate = null;
      var defRate = c.wc ? wc.defRate : c.defRate;
      var label = c.wc ? wc.label : c.label;
      if (c.auto === 'pct_rev') {
        rate = (sv.rate != null ? sv.rate : (rates[c.key] != null ? rates[c.key] : defRate));
        amount = income * (parseFloat(rate) || 0) / 100;
        if (sv.amount != null) { amount = parseFloat(sv.amount) || 0; auto = false; }
      } else if (c.auto === 'pct_wages') {
        rate = (sv.rate != null ? sv.rate : (rates[c.key] != null ? rates[c.key] : defRate));
        amount = wages * (parseFloat(rate) || 0) / 100;
        if (sv.amount != null) { amount = parseFloat(sv.amount) || 0; auto = false; }
      } else if (c.auto === 'maintenance') {
        amount = maintTotal;
        if (sv.amount != null) { amount = parseFloat(sv.amount) || 0; auto = false; }
      } else {
        amount = parseFloat(sv.amount) || 0;
        auto = false;
      }
      out[c.key] = { amount: amount, auto: auto, rate: rate, label: label, sub: c.sub, custom: !!c.custom };
    });
    return out;
  }

  function saveDetail(m, key, amount, rate) {
    var all = detailStore();
    all[m] = all[m] || {};
    all[m][key] = all[m][key] || {};
    if (amount != null) all[m][key].amount = amount;
    if (rate != null) {
      all[m][key].rate = rate;
      var r = detailRates(); r[key] = rate; W('detail_rates', r);
    }
    W('detail', all);
  }

  /* Total miles for a month — v163: FROM THE ODOMETER ONLY
     (owner, Oct 18, 2026 18:26 + 21:06 MDT: the card read "241
     miles" off fill stamps while the truck had driven the
     month; and "Miles are NOT a text box — trucks are driving,
     miles are moving, no ifs and buts"). The month's miles are
     the truck's own bookends for the month, read off the dated
     odometer log (odo_readings — the same log Maintenance's
     lifetime figure reads): the latest reading on or before the
     month's end, minus the latest reading on or before the
     month's start (the earliest in-month reading when nothing
     precedes the month). NO manual override exists any more —
     the pnl_miles input and the 'miles_<month>' store are gone
     from this path — and NO fallback to typed revenue miles:
     miles are a fixed fact from the truck, never typed.
     Poison discipline is the v118 lesson kept: a reading the
     app's own gate calls a 'jump' past the master (the 519,326
     receipt invoice number) is not evidence and never counts.
     No usable readings → 0, stated as no figure on the face. */
  function totalMiles(m) {
    var log = [];
    try { log = App._store.get('odo_readings', []) || []; } catch (e) { log = []; }
    var master = null;
    try { if (window.App && App._masterOdometer) master = App._masterOdometer(); } catch (e) {}
    var startBound = m + '-01', endBound = m + '-31';
    var before = null, atEnd = null, firstIn = null;
    (Array.isArray(log) ? log : []).forEach(function (r) {
      if (!r || !r.date) return;
      var v = parseFloat(r.value);
      if (!(v > 0)) return;
      try {
        if (window.App && App._odoImplausible && App._odoImplausible(v) === 'jump') return;
      } catch (e) {}
      var d = String(r.date), ts = parseFloat(r.ts) || 0;
      var cand = { d: d, v: v, ts: ts };
      function newerThan(inc) { return !inc || cand.d > inc.d || (cand.d === inc.d && cand.ts >= inc.ts); }
      if (d < startBound && newerThan(before)) before = cand;
      if (d <= endBound && newerThan(atEnd)) atEnd = cand;
      if (d >= startBound && d <= endBound &&
          (!firstIn || cand.d < firstIn.d || (cand.d === firstIn.d && cand.ts <= firstIn.ts))) firstIn = cand;
    });
    if (!atEnd) return 0;
    var startVal = before ? before.v : (firstIn ? firstIn.v : null);
    if (startVal === null) return 0;
    var miles = atEnd.v - startVal;
    return miles > 0 ? Math.round(miles * 100) / 100 : 0;
  }

  function monthLabel(m) {
    var p = (m || '').split('-');
    if (p.length !== 2) return m || '';
    var mi = parseInt(p[1], 10) - 1;
    return (MONTHS[mi] || p[1]) + ' ' + p[0];
  }

  function shiftMonth(m, dir) {
    var p = m.split('-'), y = parseInt(p[0], 10), mo = parseInt(p[1], 10) - 1 + dir;
    y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
    return y + '-' + ('0' + (mo + 1)).slice(-2);
  }

  function curMonth() { return S('month', App._today().slice(0, 7)); }

  /* Amount for a revenue entry: explicit amount wins, else derive from pay standard. */
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

  /* Hours the way the owner writes them: 11, 10.5. */
  function fmtH(x) {
    var n = Math.round((parseFloat(x) || 0) * 100) / 100;
    return (n % 1 === 0) ? String(Math.round(n)) : String(n);
  }

  function inMonth(ds, m) { return !!ds && ds.indexOf(m) === 0; }

  function bizExpenses() { return S('expenses', []); }

  /* --- Driver wages ----------------------------------------------------- */
  var PAY_TYPES = [['hourly', 'Hourly ($/hour)'], ['permile', 'Per mile ($/mile)'], ['perload', 'Per load ($/load)'], ['salary', 'Salary ($/month)']];
  var PAY_LABEL = { hourly: 'Hourly', permile: 'Per mile', perload: 'Per load', salary: 'Salary' };
  /* v120: the Add-driver doors (this session only, never
     persisted) + the Connect invite's ONE honest status line.
     v131 SUPERSEDES the v120 honesty gate: finding and connecting
     people in Connect is LIVE (directory search + requests +
     accept, js/connectlive.js). The P&L door no longer collects an
     email/phone "invite" that went nowhere — the button routes to
     the Connect screen's live search. Drivers saved under v120
     keep their pending line below; its wording now points at the
     live Connect screen instead of a future update. Pay setup
     stays here and stays private: what YOU pay a driver is set in
     P&L and never crosses the connection. */
  var pnlManualOpen = false;
  var PNL_INVITE_NOTE = 'Connections are live now — find them in Connect, tap Connect, and when they accept you are connected.';
  function pnlInviteLine(d) {
    if (!d || !d.viaConnect || d.inviteStatus !== 'pending') return '';
    return '<div class="b" style="color:var(--navy);font-weight:600">🤝 Invite saved — waiting for them to accept. ' + PNL_INVITE_NOTE + '</div>';
  }
  /* v132: the "Set his pay rate" prefill — {uid, name} of the
     connected driver whose pay entry is being created, set by the
     Dispatch crew board, the crew card below, or the door in
     window.__mtPnlPrefillDriver. Consumed by the next render; the
     uid stamps the saved entry, and that stamp is what lets
     ConnectPipe.pricingFor price his shared days on these books.
     Session-only — never persisted as its own key. */
  var pnlPrefill = null;
  /* The connected-crew books view (v132): a month of shared day
     records grouped per driver, priced with THIS side's rates by
     the pipe's pure pricer (revenue at the client rate; wages at
     (foreman + travel) x the pay rate set for that driver — the
     ticket's double duty). v146: the priced wage is ALSO an
     expense in the month's totals (crewWagesFor, derived from
     the cache this card's fetch leaves) — it still stamps nothing
     into the wage log, so it can never double-post there. */
  /* v146: one connected driver's shared-records block (fuel /
     expenses / maintenance / his invoices + manifests billed to
     this payer) — painted inside the crew card per driver. */
  function pnlDriverRecordsHtml(uid, recs, bills, month) {
    var h = '';
  /* v146: the driver's shared RECORDS (owner, Oct 17 21:25 MDT:
     "he sees my fuel... my maintenance record") — his fuel
     entries with their receipt data (the receipt photo itself
     one tap away), his other expenses, and his maintenance
     record, read-only, from his sharedrecords doc. */
  var rec = recs && recs[uid];
  if (rec) {
    /* v163: his OWN wage, as it crossed in his records — shown
       read-only with him (the office Preferences door shows the
       same); it prices his days in these books as an expense. */
    if (rec.driverWage && parseFloat(rec.driverWage.rate) > 0) {
      var wu = rec.driverWage.payType === 'permile' ? '/mile' : (rec.driverWage.payType === 'perload' ? '/load' : (rec.driverWage.payType === 'salary' ? '/month' : '/hour'));
      h += '<div class="kv"><span style="padding-left:14px">His wage — set by him</span><b>' + money(parseFloat(rec.driverWage.rate)) + wu + '</b></div>';
    }
    var mfuel = (rec.fuel || []).filter(function (x) { return inMonth(x.date, month); });
    if (mfuel.length) {
      h += '<div style="margin:8px 0 2px;font-weight:700">⛽ His fuel — ' + esc(monthLabel(month)) + '</div>';
      mfuel.forEach(function (x) {
        h += '<div class="kv"><span style="padding-left:14px">' + esc(x.date) +
          (x.time ? ' ' + esc(x.time) : '') + (x.station ? ' · ' + esc(x.station) : '') +
          (x.pricePerLitre ? ' · $' + Number(x.pricePerLitre).toFixed(3) + '/L' : '') +
          (x.odo ? ' · odo ' + Number(x.odo).toLocaleString('en-CA') : '') +
          '</span><b>' + (x.litres ? Number(x.litres) + ' L · ' : '') + money(x.cost || 0) + '</b></div>' +
          (x.photoRef && x.photoKey
            ? '<div style="margin:2px 0 4px"><button class="btn small ghost" data-pnlphoto="' + esc(uid) + ':' + esc(x.photoKey) + '">🧾 Receipt photo</button></div>' +
              '<div id="pnl_photo_' + esc(uid) + '_' + esc(x.photoKey) + '"></div>'
            : '');
      });
      var ft = 0, fl = 0;
      mfuel.forEach(function (x) { ft += x.cost || 0; fl += x.litres || 0; });
      h += '<div class="kv"><span style="padding-left:14px"><b>Fuel total</b></span><b>' + (fl ? Number(fl) + ' L · ' : '') + money(ft) + '</b></div>';
    }
    var mexp = (rec.expenses || []).filter(function (x) { return inMonth(x.date, month); });
    if (mexp.length) {
      h += '<div style="margin:8px 0 2px;font-weight:700">🧾 His expenses — ' + esc(monthLabel(month)) + '</div>';
      mexp.forEach(function (x) {
        h += '<div class="kv"><span style="padding-left:14px">' + esc(x.date) + ' · ' + esc(x.what) + '</span><b>' + money(x.cost || 0) + '</b></div>';
      });
      var et = 0;
      mexp.forEach(function (x) { et += x.cost || 0; });
      h += '<div class="kv"><span style="padding-left:14px"><b>Expenses total</b></span><b>' + money(et) + '</b></div>';
    }
    var mt = rec.maintenance;
    if (mt) {
      h += '<div style="margin:8px 0 2px;font-weight:700">🔧 His truck — maintenance record</div>';
      if (mt.odometer) h += '<div class="kv"><span style="padding-left:14px">Odometer</span><b>' + Number(mt.odometer).toLocaleString('en-CA') + ' km</b></div>';
      if (mt.nextServiceOdo || mt.nextServiceDate) {
        h += '<div class="kv"><span style="padding-left:14px">Next service</span><b>' +
          (mt.nextServiceOdo ? Number(mt.nextServiceOdo).toLocaleString('en-CA') + ' km' : '') +
          (mt.nextServiceOdo && mt.nextServiceDate ? ' · ' : '') + esc(mt.nextServiceDate || '') + '</b></div>';
      }
      if (mt.annualExpiry) h += '<div class="kv"><span style="padding-left:14px">Annual inspection expires</span><b>' + esc(mt.annualExpiry) + '</b></div>';
      (mt.due || []).slice(0, 3).forEach(function (du) {
        h += '<div class="kv"><span style="padding-left:14px">' + esc(du.name) + '</span><b>' +
          (du.dateBased ? esc(du.annualDate || '')
            : (du.overdue ? '⚠️ overdue' : 'due in ' + Number(du.remainingKm || 0).toLocaleString('en-CA') + ' km')) +
          '</b></div>';
      });
      (mt.services || []).slice(0, 3).forEach(function (sv) {
        h += '<div class="kv"><span style="padding-left:14px">Service — ' + esc(sv.date) + '</span><b>' + esc(sv.type) +
          (sv.odo ? ' · ' + Number(sv.odo).toLocaleString('en-CA') + ' km' : '') +
          (sv.cost ? ' · ' + money(sv.cost) : '') + '</b></div>';
      });
    }
    /* v162: his PRE-TRIP INSPECTIONS (owner, Oct 18, 2026:
       connected owners/dispatchers must SEE the driver's PTI) —
       from the same sharedrecords doc (rec.pti, published by
       CP.sharedPti), newest first. A MAJOR defect is painted so
       it cannot be missed: the truck must not roll until it is
       repaired, and the boss has to know the moment he looks. */
    var ptiList = (rec.pti || []).filter(Boolean);
    if (ptiList.length) {
      h += '<div style="margin:8px 0 2px;font-weight:700">🔍 His PTIs</div>';
      ptiList.slice(0, 5).forEach(function (r) {
        var isMajor = r.result === 'major';
        h += '<div class="kv"><span style="padding-left:14px">' + esc(r.date) +
          (r.unit ? ' · Unit ' + esc(r.unit) : '') +
          (r.odometer ? ' · odo ' + Number(r.odometer).toLocaleString('en-CA') + ' km' : '') +
          '</span><b>' + (isMajor
            ? '<span style="color:#b91c1c">🚨 MAJOR DEFECT</span>'
            : (r.result === 'minor' ? '<span style="color:#92400e">⚠ Minor defect(s)</span>' : '✓ No defects')) + '</b></div>';
        (r.defects || []).forEach(function (df) {
          var maj = df.severity === 'major';
          h += '<div style="padding-left:26px;margin:1px 0;' + (maj ? 'color:#b91c1c;font-weight:700' : 'color:#555') + '">' +
            (maj ? '⛔ MAJOR — ' : '⚠ Minor — ') + esc(df.item) + (df.note ? ': ' + esc(df.note) : '') + '</div>';
        });
      });
    }
  }
  /* v146: his PAY INVOICES billed to THIS payer (owner, Oct 17
     21:30 MDT) + the period manifests pairing with them
     (21:33 MDT) — from his sharedbilling doc, which carries
     only this payer's periods. View/print composes the
     driver's own documents (Invoice module composer; the
     manifest's own printed lines). */
  var bill = bills && bills[uid];
  if (bill && bill.invoices && bill.invoices.length) {
    h += '<div style="margin:8px 0 2px;font-weight:700">🧾 His pay invoices to you</div>';
    bill.invoices.forEach(function (iv) {
      var man = null;
      (bill.manifests || []).forEach(function (mn) {
        if (mn.pa === iv.pa && mn.pb === iv.pb) man = mn;
      });
      h += '<div class="kv"><span style="padding-left:14px">Invoice #' + esc(iv.no) + ' · ' + esc(iv.pa) + ' → ' + esc(iv.pb) +
        (iv.hours != null ? ' · ' + iv.hours + ' h' : '') + '</span><b>' + money(iv.total || 0) + ' · ' + esc(iv.status) + '</b></div>' +
        '<div style="margin:2px 0 6px"><button class="btn small navy" data-pnlinv="' + esc(uid) + ':' + esc(iv.id) + '">View / print invoice</button>' +
        (man ? ' <button class="btn small ghost" data-pnlman="' + esc(uid) + ':' + esc(iv.pa) + '_' + esc(iv.pb) + '">📋 Manifest</button>' : '') +
        '</div>' +
        '<div id="pnl_ivdoc_' + esc(uid) + '_' + esc(iv.id) + '"></div>' +
        (man ? '<div id="pnl_mandoc_' + esc(uid) + '_' + esc(iv.pa) + '_' + esc(iv.pb) + '"></div>' : '');
    });
  }
    return h;
  }
  /* v148: a LIMITED driver's block on the crew card — his
     MANIFESTS for the days this side dispatched him, and
     nothing else: no money lines, no fuel, no expenses, no
     maintenance, no invoices (the money picture does not cross
     on Limited — fetchRecords never even hands them over). */
  function pnlLimitedManifestsHtml(uid, mdoc) {
    var h = '<div style="margin:8px 0 2px;font-weight:700">📋 His manifests — days you dispatched him</div>';
    var mans = (mdoc && mdoc.manifests) || [];
    if (!mans.length) {
      return h + '<div class="empty">No manifests shared yet.</div>';
    }
    mans.forEach(function (mn) {
      var nd = (mn.days || []).length;
      h += '<div class="kv"><span style="padding-left:14px">Manifest · ' + esc(mn.pa) + ' → ' + esc(mn.pb) + '</span><b>' + nd + ' day' + (nd === 1 ? '' : 's') + '</b></div>' +
        '<div style="margin:2px 0 6px"><button class="btn small ghost" data-pnlmanl="' + esc(uid) + ':' + esc(mn.pa) + '_' + esc(mn.pb) + '">📋 View manifest</button></div>' +
        '<div id="pnl_manldoc_' + esc(uid) + '_' + esc(mn.pa) + '_' + esc(mn.pb) + '"></div>';
    });
    return h;
  }
  function pnlCrewHtml(days, recs, bills, mans, month) {
    var hasRecs = !!((recs && Object.keys(recs).length) || (bills && Object.keys(bills).length) ||
      (mans && Object.keys(mans).length));
    if (!days.length && !hasRecs) return '<div class="empty">No shared days yet this month. When a connected driver works, his day lands here by itself.</div>';
    var byDriver = {}, order = [];
    days.forEach(function (day) {
      if (!byDriver[day.driver]) { byDriver[day.driver] = { name: day.driverName || 'Driver', days: [] }; order.push(day.driver); }
      byDriver[day.driver].days.push(day);
    });
    var h = '', tRev = 0, tWage = 0, anyRev = false, anyWage = false;
    order.forEach(function (uid) {
      var g = byDriver[uid];
      var pricing = ConnectPipe.pricingFor(uid);
      var rev = 0, wage = 0, hrs = 0, loads = 0, nRev = false, nWage = false;
      g.days.forEach(function (day) {
        var p = ConnectPipe.priceDay(day, pricing);
        if (p.revenue !== null) { rev += p.revenue; nRev = true; }
        if (p.wage !== null) { wage += p.wage; nWage = true; }
        hrs += (day.session && day.session.hours) || 0;
        loads += day.loads || 0;
      });
      if (nRev) { tRev += rev; anyRev = true; }
      if (nWage) { tWage += wage; anyWage = true; }
      /* v163: wages price at the DRIVER'S OWN rate (settled
         design, Oct 18, 2026) — the "Set his pay rate" door is
         GONE: the boss never sets a connected driver's wage.
         His wage state shows read-only, exactly as it crossed. */
      var wageUnit = pricing.wage ? (pricing.wage.payType === 'permile' ? '/mile' : (pricing.wage.payType === 'perload' ? '/load' : (pricing.wage.payType === 'salary' ? '/month' : '/hour'))) : '';
      var wageLine = pricing.wage
        ? '<div class="kv"><span style="padding-left:14px">His wage — set by him</span><b>' + money(pricing.wage.rate) + wageUnit + '</b></div>'
        : '<div class="kv"><span style="padding-left:14px">His wage — not set on his side yet</span><b>—</b></div>';
      h += '<div class="kv"><span>' + esc(g.name) + ' — ' + g.days.length + ' day' + (g.days.length === 1 ? '' : 's') +
        ' · ' + (Math.round(hrs * 10) / 10) + ' h' + (loads > 0 ? ' · ' + loads + ' loads' : '') + '</span><b></b></div>' +
        '<div class="kv"><span style="padding-left:14px">Revenue (your client rate)</span><b>' + (nRev ? money(rev) : '—') + '</b></div>' +
        '<div class="kv"><span style="padding-left:14px">Wages (foreman + travel, his own rate)</span><b>' + (nWage ? money(wage) : '—') + '</b></div>' +
        wageLine +
        (nRev && nWage ? '<div class="kv"><span style="padding-left:14px">Margin</span><b>' + money(rev - wage) + '</b></div>' : '');
      h += pnlDriverRecordsHtml(uid, recs, bills, month);
    });
    if (days.length) {
      h += '<div class="kv"><span><b>Crew revenue</b></span><b>' + (anyRev ? money(tRev) : '—') + '</b></div>' +
        '<div class="kv"><span><b>Crew wages</b></span><b>' + (anyWage ? money(tWage) : '—') + '</b></div>' +
        (anyRev && anyWage ? '<div class="kv"><span><b>Crew margin</b></span><b>' + money(tRev - tWage) + '</b></div>' : '');
    }
    /* v146: a driver can share records (fuel, maintenance,
       invoices) in a month where he closed no days here — his
       records still show, under his name. */
    var seenRec = {};
    order.forEach(function (u) { seenRec[u] = true; });
    var extraUids = {};
    Object.keys(recs || {}).forEach(function (u) { extraUids[u] = true; });
    Object.keys(bills || {}).forEach(function (u) { extraUids[u] = true; });
    Object.keys(mans || {}).forEach(function (u) { extraUids[u] = true; });
    Object.keys(extraUids).forEach(function (uid) {
      if (seenRec[uid]) return;
      var mdoc = mans && mans[uid];
      var nm = (recs && recs[uid] && (recs[uid].driverName || recs[uid].driverBusiness)) ||
        (bills && bills[uid] && (bills[uid].driverName || bills[uid].driverBusiness)) ||
        (mdoc && (mdoc.driverName || mdoc.driverBusiness)) || 'Driver';
      h += '<div class="kv" style="margin-top:8px"><span>' + esc(nm) + '</span><b></b></div>';
      /* v148: a uid that arrived ONLY with a manifests doc is a
         LIMITED driver — his block is manifests, never the
         records/invoice surfaces. */
      if (mdoc && !(recs && recs[uid]) && !(bills && bills[uid])) {
        h += pnlLimitedManifestsHtml(uid, mdoc);
      } else {
        h += pnlDriverRecordsHtml(uid, recs, bills, month);
      }
    });
    return h;
  }
  /* v146: CONNECTED CREW WAGES IN THE TOTALS (owner, Oct 17
     21:25 MDT: "my pay goes as an expense in his pnl"). The crew
     card has priced connected drivers' shared days read-only
     since v132; now the priced wage ALSO lands in the month's
     expense totals — DERIVED, never stamped: when the crew card
     fetches a month's shared days they are cached locally (a
     '__'-prefixed key CloudSync never carries — another driver's
     facts are not this account's data to sync), and calc() prices
     the cache with the pipe's own pricer. Derived means:
     idempotent per day by construction (one shared record per
     driver per day — re-pricing can never double-post), a
     corrected day re-prices itself on the next fetch, an unset
     pay rate contributes $0/unpriced exactly as the board shows,
     and an account with no connections never has a cache, so its
     figures are byte-identical to before. The local wage log
     (pnl_wage_entries) is untouched — the same work must not be
     hand-logged as well, or it would count twice. */
  var CREW_CACHE_KEY = '__crew_days';
  function crewCache() {
    try { return App._store.get(CREW_CACHE_KEY, {}) || {}; } catch (e) { return {}; }
  }
  function cacheCrewDays(month, days) {
    try {
      var all = crewCache();
      all[month] = days || [];
      var keys = Object.keys(all).sort();
      while (keys.length > 6) { delete all[keys.shift()]; }
      App._store.set(CREW_CACHE_KEY, all);
    } catch (e) {}
  }
  /* v148: a LIMITED connection (the dispatcher's kind) books NO
     P&L legs for that driver — the money picture does not cross
     on Limited, so his days never price into my totals, even
     when a stale crew cache still holds them. The kind is read
     off MY con_list entry (absent = All, the grandfather read). */
  function crewKindLimited(uid) {
    try {
      var list = App._store.get('con_list', []) || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].uid === uid) return list[i].kind === 'limited';
      }
    } catch (e) {}
    return false;
  }
  function crewWagesFor(m) {
    var out = { total: 0, byDriver: {} };
    var days = [];
    try { days = crewCache()[m] || []; } catch (e) { days = []; }
    if (!days.length || !window.ConnectPipe) return out;
    var byUid = {};
    days.forEach(function (day) {
      if (!day || !day.driver) return;
      if (!byUid[day.driver]) byUid[day.driver] = { name: day.driverName || 'Driver', days: [] };
      byUid[day.driver].days.push(day);
    });
    Object.keys(byUid).forEach(function (uid) {
      if (crewKindLimited(uid)) return; // v148: no legs on Limited
      var g = byUid[uid];
      var pricing = ConnectPipe.pricingFor(uid);
      var wage = 0, priced = false;
      g.days.forEach(function (day) {
        var p = ConnectPipe.priceDay(day, pricing);
        if (p.wage !== null) { wage += p.wage; priced = true; }
      });
      wage = Math.round(wage * 100) / 100;
      out.byDriver[uid] = { name: g.name, wage: wage, priced: priced, days: g.days.length };
      if (priced) out.total += wage;
    });
    out.total = Math.round(out.total * 100) / 100;
    return out;
  }
  var UNIT = { hourly: 'hrs', permile: 'mi', perload: 'loads' };
  var QTY_LABEL = { hourly: 'Hours', permile: 'Miles', perload: 'Loads' };

  function drivers() { return S('drivers', []); }
  function wageEntries() { return S('wage_entries', []); }
  /* v52: travel-wage claims routed from Dispatch — when an office user
     completes a dispatch, the travel hours that may NOT enter Revenue
     as income land here against the identified driver (owner's rule:
     the bonus is paid TO the driver, so payer-side books owe it). */
  function travelClaims() { return S('travel_claims', []); }

  /* Driver wages for a month — per-driver breakdown + cumulative total.
     Hourly/per-mile/per-load wages come from logged work entries (the wage
     is snapshotted at log time so later rate changes don't rewrite history).
     Salary drivers earn their fixed monthly rate for every month on/after
     their start month. */
  function driverWages(m) {
    var ds = drivers(), es = wageEntries(), cs = travelClaims();
    /* v105: CARD WAGE POSTINGS (pnl_card_wages) — a closed haul
       card posts the driver's FULL pay (foreman + travel) into
       these books from the single completion record ("one ticket,
       two books"). A v52 travel CLAIM whose dispatch now carries
       a posting is superseded: the travel hour is inside the
       posting, and counting the claim too would pay it twice.
       Days a posting covers are likewise excluded from the
       computed-travel component below. */
    var cws = S('card_wages', []);
    var cardDsp = {};
    cws.forEach(function (p) { if (p && p.dspId) cardDsp[p.dspId] = true; });
    cs = cs.filter(function (c) { return !(c && c.dispatchId && cardDsp[c.dispatchId]); });
    var cardDays = {};
    cws.forEach(function (p) { if (p && p.driverId && p.date) cardDays[p.driverId + '|' + p.date] = true; });
    var per = {}, total = 0;
    ds.forEach(function (d) {
      var w = 0, detail = '';
      var daysSeen = {};
      if (d.payType === 'salary') {
        if (!d.start || d.start <= m) {
          w = parseFloat(d.rate) || 0;
          detail = money(w) + '/mo';
        }
      } else {
        var qty = 0;
        es.forEach(function (e) {
          if (e.driverId !== d.id || !inMonth(e.date, m)) return;
          qty += parseFloat(e.qty) || 0;
          w += parseFloat(e.wage) || 0;
          if (e.date) daysSeen[e.date] = true;
        });
        if (qty > 0 || w > 0) detail = qty + ' ' + (UNIT[d.payType] || '') + ' × ' + money(parseFloat(d.rate) || 0);
      }
      /* v52: TRAVEL component — itemized, on top of the base wage.
         Two sources, never double-paid for the same day:
         (a) computed: the driver's per-day travelHours × the distinct
             days they have logged work in the month × their rate —
             EXCLUDING any day a dispatch claim already covers;
         (b) claims: travel routed from office-completed dispatches
             (pnl_travel_claims), each carrying its own snapshotted wage.
         The owner's rule (Oct 14): owners/fleets PAY the travel bonus;
         before v52 it existed nowhere on this side of the ledger. */
      var dRate = parseFloat(d.rate) || 0;
      var claimWage = 0, claimHours = 0, claimDays = {};
      cs.forEach(function (c) {
        if (c.driverId !== d.id || !inMonth(c.date, m)) return;
        claimWage += parseFloat(c.wage) || 0;
        claimHours += parseFloat(c.hours) || 0;
        if (c.date) claimDays[c.date] = true;
      });
      var th = parseFloat(d.travelHours) || 0, compDays = 0;
      if (d.payType !== 'salary' && th > 0) {
        Object.keys(daysSeen).forEach(function (dt) { if (!claimDays[dt] && !cardDays[d.id + '|' + dt]) compDays++; });
      }
      var compWage = th * compDays * dRate;
      var travelWage = Math.round((claimWage + compWage) * 100) / 100;
      var travelDetail = '';
      if (travelWage > 0) {
        var parts = [];
        if (compWage > 0) parts.push('travel ' + th + 'h × ' + compDays + ' day' + (compDays === 1 ? '' : 's') + ' = ' + money(compWage));
        if (claimWage > 0) parts.push('dispatch travel ' + claimHours + 'h = ' + money(claimWage));
        travelDetail = parts.join(' · ');
      }
      w = Math.round((w + travelWage) * 100) / 100;
      per[d.id] = { name: d.name, payType: d.payType, wage: w, detail: detail, travelWage: travelWage, travelDetail: travelDetail, cardWage: 0, cardDetail: '', viaConnect: !!d.viaConnect, inviteStatus: d.inviteStatus || '', contact: d.contact || '' };
      total += w;
    });
    /* v105: the card postings join the month's wages — attributed
       to their driver (the owner-operator's own land under 'self',
       named on the posting). Postings are keyed by dispatch at
       write time (dspMergeCardWages), so one card can never put
       two pay lines on the same day's books. */
    cws.forEach(function (p) {
      if (!p || !inMonth(p.date, m)) return;
      var key = p.driverId || 'self';
      if (!per[key]) {
        per[key] = { name: p.driverName || (key === 'self' ? 'You (owner-operator)' : 'Driver'), payType: 'hourly', wage: 0, detail: '', travelWage: 0, travelDetail: '', cardWage: 0, cardDetail: '' };
      }
      var w = Math.round((parseFloat(p.wage) || 0) * 100) / 100;
      per[key].wage = Math.round((per[key].wage + w) * 100) / 100;
      per[key].cardWage = Math.round(((per[key].cardWage || 0) + w) * 100) / 100;
      var seg = 'card pay ' + fmtH(p.hours) + 'h (foreman ' + fmtH(p.foremanHours) + 'h + travel ' + fmtH(p.travelHours) + 'h) = ' + money(w);
      per[key].cardDetail = per[key].cardDetail ? per[key].cardDetail + ' · ' + seg : seg;
      total = Math.round((total + w) * 100) / 100;
    });
    return { per: per, total: total };
  }

  /* Core calculation — pure logic over the three stores. Exposed as _calc for tests. */
  function calc(m) {
    var o = App._store.get('onboarding', {});
    var std = (o.payStandard || 'hourly').toLowerCase(), rate = o.ownWageRate || o.payRate; // v137: the user's own wage chain (fallback raw-sum path only)

    /* v105: income is priced by the SHARED per-day builder — the
       same function the invoice prints from and Revenue totals
       with. One line per day: a confirmed completion beats the
       day's tracker entries, so a tracker session can NEVER stack
       money on top of a closed dispatch in these books (the Oct 16
       field defect: the raw sums on other screens showed $601.75 /
       $608.87 for a $319.00 day). The raw payFor sum below remains
       only as the fallback for a world where the shared builder
       failed to load. */
    var entAll = App._store.get('rev_entries', []) || [];
    var extAll = App._store.get('rev_extras', []) || [];
    var income = 0, incomeByType = {}, extras = 0;
    extAll.forEach(function (x) { if (inMonth(x.date, m)) extras += parseFloat(x.amount) || 0; });
    var grouped = null;
    try {
      if (typeof Meticulous !== 'undefined' && Meticulous.shared && typeof Meticulous.shared.buildRevenueLines === 'function') {
        grouped = Meticulous.shared.buildRevenueLines(
          entAll.filter(function (e) { return inMonth(e.date, m); }),
          extAll.filter(function (x) { return inMonth(x.date, m); }),
          parseFloat(rate) || 0, std, App._store.get('pnl_card_wages', []) || []);
      }
    } catch (e) { grouped = null; }
    if (grouped) {
      grouped.lines.forEach(function (l) { income += l.amt; });
      income = Math.round(income * 100) / 100;
      incomeByType = grouped.typeTotals || {};
    } else {
      entAll.forEach(function (e) {
        if (!inMonth(e.date, m)) return;
        var a = payFor(e, std, rate);
        income += a;
        var t = e.type || 'load';
        incomeByType[t] = (incomeByType[t] || 0) + a;
      });
      income += extras;
    }

    var fuel = 0;
    (App._store.get('fuel_fills', []) || []).forEach(function (f) {
      if (!inMonth(f.date, m)) return;
      fuel += parseFloat(f.cost) || 0;
    });
    var fuelOther = 0;
    (App._store.get('fuel_expenses', []) || []).forEach(function (x) {
      if (!inMonth(x.date, m)) return;
      fuelOther += parseFloat(x.cost) || 0;
    });

    var biz = 0, bizByCat = {};
    bizExpenses().forEach(function (x) {
      if (!inMonth(x.date, m)) return;
      var a = parseFloat(x.cost) || 0;
      biz += a;
      var c = x.category || 'Other';
      bizByCat[c] = (bizByCat[c] || 0) + a;
    });

    var dw = driverWages(m);

    /* v146: the connected crew's priced wages — an expense on
       these books in their own right, attributed per driver
       (crewWagesByDriver), derived from the cached shared days. */
    var cw = crewWagesFor(m);

    /* Detailed expense categories (the owner's spreadsheet format) */
    var miles = totalMiles(m);
    var det = detailAmounts(m, income, dw.total);
    var detTotal = 0;
    var detRows = [];
    allDetailCats().forEach(function (c) {
      var d = det[c.key];
      var amt = d.amount || 0;
      detTotal += amt;
      detRows.push({
        key: c.key, label: d.label, sub: c.sub, custom: !!c.custom,
        amount: amt, auto: d.auto, rate: d.rate,
        perMile: miles > 0 ? amt / miles : 0,
        pct: income > 0 ? amt / income * 100 : 0
      });
    });

    var expenses = fuel + fuelOther + biz + dw.total + detTotal + cw.total;
    return {
      month: m, income: income, incomeByType: incomeByType, extras: extras,
      fuel: fuel, fuelOther: fuelOther, biz: biz, bizByCat: bizByCat,
      wages: dw.total, wagesByDriver: dw.per,
      crewWages: cw.total, crewWagesByDriver: cw.byDriver,
      /* v163: ONE wages figure for the fixed Driver wages line —
         local drivers + connected crew (at their OWN rates) */
      wagesTotal: Math.round((dw.total + cw.total) * 100) / 100,
      wagesTotalPerMile: miles > 0 ? (dw.total + cw.total) / miles : 0,
      wagesTotalPct: income > 0 ? (dw.total + cw.total) / income * 100 : 0,
      miles: miles,
      detail: detRows, detailTotal: detTotal,
      fuelPerMile: miles > 0 ? fuel / miles : 0,
      fuelPct: income > 0 ? fuel / income * 100 : 0,
      wagesPerMile: miles > 0 ? dw.total / miles : 0,
      wagesPct: income > 0 ? dw.total / income * 100 : 0,
      expenses: expenses, net: income - expenses,
      expPerMile: miles > 0 ? expenses / miles : 0,
      expPct: income > 0 ? expenses / income * 100 : 0,
      netPerMile: miles > 0 ? (income - expenses) / miles : 0,
      netPct: income > 0 ? (income - expenses) / income * 100 : 0
    };
  }

  function money(v) { return '$' + v.toFixed(2); }

  var api = {
    /* Account-type gate REMOVED (owner, Oct 13): Driver needs full access. */
    _allowed: function () {
      return true;
    },
    _calc: calc,
    _driverWages: driverWages,
    _totalMiles: totalMiles,
    _detailAmounts: detailAmounts,
    _DETAIL_CATS: DETAIL_CATS,
    _customCats: customCats, /* v163 */
    _allDetailCats: allDetailCats, /* v163 */

    status: function () {
      try {
        if (!api._allowed()) return '';
        var c = calc(App._today().slice(0, 7));
        if (!c.income && !c.expenses) return 'No data yet';
        var sign = c.net < 0 ? '-' : '+';
        return monthLabel(c.month) + ': ' + sign + '$' + Math.abs(c.net).toFixed(0);
      } catch (e) { return ''; }
    },

    render: function (body) {
      var m = curMonth();
      var c = calc(m);
      /* v132: consume a "Set his pay rate" prefill (the Dispatch
         crew board sets window.__mtPnlPrefillDriver) — the manual
         form opens with the driver's name in it, and his uid rides
         pnlPrefill to the save below. */
      try {
        if (window.__mtPnlPrefillDriver) {
          pnlPrefill = window.__mtPnlPrefillDriver;
          window.__mtPnlPrefillDriver = null;
          pnlManualOpen = true;
        }
      } catch (e) {}
      var netColor = c.net < 0 ? '#c0392b' : '#1e8e3e';

      var h = '<div class="card"><h3>📈 Profit & Loss</h3>' +
        '<div class="row" style="align-items:center">' +
        '<button class="btn small ghost" id="pnl_prev">← Prev</button>' +
        '<div class="center" style="flex:1;font-size:18px;font-weight:800;color:var(--navy)">' + esc(monthLabel(m)) + '</div>' +
        '<button class="btn small ghost" id="pnl_next">Next →</button>' +
        '</div></div>';

      h += '<div class="row">' +
        '<div class="card" style="flex:1"><div class="note">Gross income</div>' +
        '<div class="center" style="font-size:22px;font-weight:800;color:var(--navy)">' + money(c.income) + '</div></div>' +
        '<div class="card" style="flex:1"><div class="note">Total expenses</div>' +
        '<div class="center" style="font-size:22px;font-weight:800;color:var(--navy)">' + money(c.expenses) + '</div></div>' +
        '<div class="card" style="flex:1"><div class="note">Net ' + (c.net < 0 ? 'loss' : 'profit') + '</div>' +
        '<div class="center" style="font-size:22px;font-weight:800;color:' + netColor + '">' + money(c.net) + '</div></div>' +
        '</div>';

      /* Income breakdown */
      h += '<div class="card"><h3>💰 Income breakdown</h3>';
      var types = Object.keys(c.incomeByType);
      if (!types.length && !c.extras) h += '<div class="empty">No income this month. Add entries in Revenue.</div>';
      types.forEach(function (t) {
        h += '<div class="kv"><span style="text-transform:capitalize">' + esc(t) + '</span><b>' + money(c.incomeByType[t]) + '</b></div>';
      });
      if (c.extras > 0) h += '<div class="kv"><span>Extras (bonus, detention…)</span><b>' + money(c.extras) + '</b></div>';
      h += '<div class="kv"><span><b>Total income</b></span><b>' + money(c.income) + '</b></div></div>';

      /* Expense breakdown */
      h += '<div class="card"><h3>🧾 Expense breakdown</h3>';
      if (!c.expenses) h += '<div class="empty">No expenses this month.</div>';
      if (c.fuel > 0) h += '<div class="kv"><span>⛽ Fuel</span><b>' + money(c.fuel) + '</b></div>';
      if (c.fuelOther > 0) h += '<div class="kv"><span>Other (from Fuel module)</span><b>' + money(c.fuelOther) + '</b></div>';
      Object.keys(c.bizByCat).forEach(function (k) {
        h += '<div class="kv"><span>' + esc(k) + '</span><b>' + money(c.bizByCat[k]) + '</b></div>';
      });
      /* v163: DRIVER WAGES — A FIXED LINE, like fuel (owner,
         Oct 18, 2026 18:26 + 21:06 MDT: the P&L showed NO wages
         line while an unexplained $84.19 sat inside the expense
         total — that was the priced crew wage, in the total
         with no line of its own). The line is ALWAYS here,
         auto-computed, and never hand-editable: local drivers'
         wages + connected drivers' wages at EACH DRIVER'S OWN
         rate (his rate, set on his side, received via Connect —
         the boss never sets it), each named on its own sub-line,
         so every dollar inside Total expenses has a line. */
      h += '<div class="kv"><span>👥 Driver wages</span><b>' + money(c.wagesTotal) + '</b></div>';
      Object.keys(c.wagesByDriver || {}).forEach(function (id) {
        var d = c.wagesByDriver[id];
        if (d && d.wage > 0) {
          h += '<div class="kv"><span style="padding-left:14px">↳ ' + esc(d.name) + '</span><b>' + money(d.wage) + '</b></div>';
        }
      });
      Object.keys(c.crewWagesByDriver || {}).forEach(function (uid) {
        var g = c.crewWagesByDriver[uid];
        if (g && g.wage > 0) {
          h += '<div class="kv"><span style="padding-left:14px">↳ ' + esc(g.name) + ' (Connect — his own rate)</span><b>' + money(g.wage) + '</b></div>';
        }
      });
      h += '<div class="kv"><span><b>Total expenses</b></span><b>' + money(c.expenses) + '</b></div>';
      h += '<p class="note">Fuel costs pull automatically from Fuel &amp; Expense. Add other business costs below.</p></div>';

      /* Detailed monthly analysis — the owner's spreadsheet format:
         each line shows amount, $/mile, and % of revenue */
      h += '<div class="card"><h3>📊 Monthly analysis</h3>';
      /* v163: miles are a FACT, not a field (owner, Oct 18, 2026:
         "Miles are NOT a text box") — the total is read off the
         truck's dated odometer log and printed as a value; there
         is no input here any more, and nothing to override. */
      h += '<div class="kv"><span>Total miles (from the odometer)</span><b>' +
        (c.miles > 0 ? c.miles.toLocaleString('en-CA') + ' km' : 'No odometer readings this month') + '</b></div>';
      h += '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px">' +
        '<tr style="color:#888;border-bottom:1px solid #eee"><td></td>' +
        '<td style="text-align:right"><b>Totals</b></td>' +
        '<td style="text-align:right"><b>$/mile</b></td>' +
        '<td style="text-align:right"><b>%</b></td></tr>';
      h += '<tr><td>Total rev.</td><td style="text-align:right"><b>' + money(c.income) + '</b></td><td></td><td style="text-align:right">100</td></tr>';
      h += '<tr><td colspan="4" style="height:6px"></td></tr>';
      if (c.miles > 0) h += '<tr><td>Total miles</td><td style="text-align:right">' + c.miles.toFixed(2) + '</td><td style="text-align:right">' + (c.income / c.miles).toFixed(5) + '</td><td></td></tr>';
      /* Fuel line */
      if (c.fuel > 0 || c.miles > 0) {
        h += '<tr><td>Total fuel</td><td style="text-align:right">' + money(c.fuel) + '</td>' +
          '<td style="text-align:right">' + c.fuelPerMile.toFixed(5) + '</td>' +
          '<td style="text-align:right">' + c.fuelPct.toFixed(2) + '</td></tr>';
      }
      /* Salaries — v163: the SAME fixed Driver wages figure as
         the breakdown card (local + connected crew at their own
         rates), always printed, never an input. */
      h += '<tr><td>Total salaries (driver wages)</td><td style="text-align:right">' + money(c.wagesTotal) + '</td>' +
        '<td style="text-align:right">' + c.wagesTotalPerMile.toFixed(5) + '</td>' +
        '<td style="text-align:right">' + c.wagesTotalPct.toFixed(2) + '</td></tr>';
      /* Detailed categories */
      c.detail.forEach(function (r) {
        h += '<tr data-pnldetrow="' + r.key + '"><td>' + esc(r.label) +
          (r.sub ? ' <span class="note">(' + esc(r.sub) + ')</span>' : '') +
          (r.auto && r.rate != null ?
            ' <span class="note">(<input data-pnlrate="' + r.key + '" type="number" inputmode="decimal" min="0" step="0.01" ' +
            'value="' + r.rate + '" title="Change the auto % rate" ' +
            'style="width:52px;text-align:right;border:1px solid #ddd;border-radius:6px;padding:2px 4px">%)</span>' : '') +
          (r.custom ? ' <button class="btn small ghost" data-pnldelcat="' + r.key + '" title="Remove this line">✕</button>' : '') +
          '</td>' +
          '<td style="text-align:right"><input data-pnldet="' + r.key + '" type="number" inputmode="decimal" min="0" step="0.01" ' +
          'value="' + (r.amount ? r.amount.toFixed(2) : '') + '" placeholder="0.00" ' +
          'style="width:90px;text-align:right;border:1px solid #ddd;border-radius:6px;padding:4px"></td>' +
          '<td style="text-align:right">' + r.perMile.toFixed(5).replace(/\.?0+$/, '') + '</td>' +
          '<td style="text-align:right">' + r.pct.toFixed(2) + '</td></tr>';
      });
      /* v163: the "+" — add a custom expense line of your own
         (owner, Oct 18, 2026 21:06 MDT) */
      h += '<tr><td colspan="4"><div class="row" style="align-items:flex-end;margin-top:6px">' +
        '<div style="flex:1"><label class="f">＋ Add an expense line</label>' +
        '<input id="pnl_newcat" placeholder="e.g. Truck wash"></div>' +
        '<button class="btn small navy" id="pnl_addcat">Add line</button></div></td></tr>';
      h += '<tr><td colspan="4" style="height:6px"></td></tr>';
      h += '<tr style="border-top:2px solid #333"><td><b>Total expenses</b></td>' +
        '<td style="text-align:right"><b>' + money(c.expenses) + '</b></td>' +
        '<td style="text-align:right"><b>' + c.expPerMile.toFixed(5).replace(/\.?0+$/, '') + '</b></td>' +
        '<td style="text-align:right"><b>' + c.expPct.toFixed(2) + '</b></td></tr>';
      h += '<tr><td><b>Total profit</b></td>' +
        '<td style="text-align:right"><b style="color:' + netColor + '">' + money(c.net) + '</b></td>' +
        '<td style="text-align:right"><b style="color:' + netColor + '">' + c.netPerMile.toFixed(5).replace(/\.?0+$/, '') + '</b></td>' +
        '<td style="text-align:right"><b style="color:' + netColor + '">' + c.netPct.toFixed(2) + '</b></td></tr>';
      h += '</table>';
      (function () {
        var wcN = wcInfo();
        var br = null, wr = null;
        c.detail.forEach(function (r) {
          if (r.key === 'brokerage') br = r.rate;
          if (r.key === 'wsib') wr = r.rate;
        });
        h += '<p class="note">Brokerage auto = ' + (br != null ? br : 10) + '% of revenue · ' +
          esc(wcN.label) + ' auto = ' + (wr != null ? wr : wcN.defRate) + '% of salaries · ' +
          'Maintenance auto from Maintenance module. Type an amount to override any auto value; tap a % to change the rate.</p></div>';
      })();

      /* Driver wages breakdown — per-driver wages + cumulative total */
      h += '<div class="card"><h3>👥 Driver wages — ' + esc(monthLabel(m)) + '</h3>';
      var dids = Object.keys(c.wagesByDriver);
      if (!dids.length) {
        h += '<div class="empty">No drivers yet. Add your drivers below — each driver\u2019s wages are tracked separately, and the total comes off your revenue as an expense.</div>';
      } else {
        var anyW = false;
        dids.forEach(function (id) {
          var d = c.wagesByDriver[id];
          if (d.wage > 0) anyW = true;
          h += '<div class="kv"><span>' + esc(d.name) + (d.detail ? ' <span class="note">(' + esc(d.detail) + ')</span>' : '') + '</span><b>' + money(d.wage) + '</b></div>';
          /* v52: travel pay is its own line — the driver was owed it on
             top of the ticket/logged hours, and it shows. */
          if (d.travelWage > 0) {
            h += '<div class="kv"><span style="padding-left:14px">↳ Travel pay <span class="note">(' + esc(d.travelDetail) + ')</span></span><b>' + money(d.travelWage) + '</b></div>';
          }
          /* v120: a Connect-invited driver shows the pending
             state right in the wages list — never a fake
             "connected". */
          if (d.viaConnect && d.inviteStatus === 'pending') {
            h += '<div class="kv"><span style="padding-left:14px">↳ 🤝 Invite pending <span class="note">(' + esc(PNL_INVITE_NOTE) + ')</span></span><span></span></div>';
          }
          /* v105: pay posted by closed haul cards is its own line —
             the expense half of "one ticket, two books", visible
             right under the driver's wage. */
          if (d.cardWage > 0) {
            h += '<div class="kv"><span style="padding-left:14px">↳ Haul-card pay <span class="note">(' + esc(d.cardDetail) + ')</span></span><b>' + money(d.cardWage) + '</b></div>';
          }
        });
        if (!anyW) h += '<div class="empty">No wages logged for this month yet.</div>';
        h += '<div class="kv"><span><b>Total driver wages</b></span><b>' + money(c.wages) + '</b></div>';
      }
      h += '<p class="note">Driver wages are deducted from revenue as a business expense.</p></div>';

      /* v132: CONNECTED CREW — the pipe's books (office/both faces
         only; a pure driver's P&L never grows an owner surface).
         Live from the records connected drivers publish to this
         account, priced with THIS side's rates by the pipe's
         pricer. v146: the card is the connected-driver detail
         surface (his fuel, expenses, maintenance, pay invoices +
         manifests) and the priced wages are an expense in the
         totals above (derived — nothing is stamped into the wage
         log; hand-logging the same work WOULD count it twice, and
         the note below says so). Painted async into #pnl_crew. */
      if ((App.userRole ? App.userRole() : 'driver') !== 'driver' && window.ConnectPipe) {
        h += '<div class="card"><h3>🤝 Connected crew — ' + esc(monthLabel(m)) + '</h3>' +
          '<div id="pnl_crew"><p class="note">Loading your crew\u2019s shared days…</p></div>' +
          '<p class="note">From your drivers\u2019 own records. Revenue is priced at your client rate; wages are priced at each driver\u2019s own rate — the wage he set on his own side, which is the one rate of his that crosses to you. Your client rate never crosses to them. Their priced wages are counted in your Total expenses above — don\u2019t log the same work by hand.</p></div>';
      }

      /* Add driver — v120 (owner, Oct 16 22:00 MDT: "Adding
         drivers should have an option of connecting via
         'connect'."), v131: TWO doors. PRIMARY: Connect a driver —
         routes to the Connect screen's LIVE people search (find
         them by name, tap Connect, they accept). SECONDARY
         (quiet): the manual form, unchanged — for drivers not on
         the app, and for setting what YOU pay a connected driver
         (pay terms are set here, privately, and never cross the
         connection). The v120 email/phone invite form is GONE: it
         saved a pending driver + a local-only connection and
         delivered nothing. v120 pending entries still render their
         status line (PNL_INVITE_NOTE, reworded for the live era). */
      h += '<div class="card"><h3>＋ Add driver</h3>' +
        '<button class="btn primary big" id="pnl_connect_open" style="width:100%">🤝 Connect a driver</button>' +
        '<p class="note">For a driver who uses Meticulous — Connect finds them by name, and their identity comes from their own account, not from typing. When they accept, you are connected. A connected driver\u2019s wage is set by the driver himself, on his own side — it crosses to your books as an expense at his rate, and there is nothing here for you to set. The manual form below is for drivers who are not on the app.</p>' +
        '<button class="btn ghost" id="pnl_manual_open" style="margin-top:10px">Add manually instead</button>' +
        '<div id="pnl_manual_wrap" style="display:' + (pnlManualOpen ? 'block' : 'none') + ';margin-top:8px">' +
        (pnlPrefill ? '<p class="note" style="color:var(--navy);font-weight:600">Setting the pay rate for ' + esc(pnlPrefill.name || 'your driver') + ' — it prices his shared days on your books, and it never crosses to him.</p>' : '') +
        '<div class="row"><div><label class="f">Driver name</label><input id="pnl_dname" placeholder="e.g. Driver 1" value="' + esc(pnlPrefill ? (pnlPrefill.name || '') : '') + '"></div>' +
        '<div><label class="f">Pay type</label><select id="pnl_dtype">' +
        PAY_TYPES.map(function (p) { return '<option value="' + p[0] + '">' + p[1] + '</option>'; }).join('') +
        '</select></div></div>' +
        '<div class="row"><div><label class="f">Rate $</label><input id="pnl_drate" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"></div>' +
        '<div><label class="f">Start month</label><input id="pnl_dstart" type="month" value="' + esc(m) + '"><div class="note">Salary drivers earn their rate every month from this month on.</div></div></div>' +
        '<div class="row"><div><label class="f">Travel time (hours/day)</label><input id="pnl_dtravel" type="number" inputmode="decimal" min="0" step="0.25" placeholder="0"><div class="note">Travel pay you owe this driver for each day they work — on top of their ticket/logged hours (e.g. 1, some drivers 1.5).</div></div></div>' +
        '<button class="btn primary" id="pnl_dadd">Add driver</button>' +
        '</div>' +
        '<div id="pnl_dlist">' + drivers().map(function (d) {
          return '<div class="listitem"><div class="a">' + esc(d.name) + ' — ' + esc(PAY_LABEL[d.payType] || d.payType) + ' ' + money(parseFloat(d.rate) || 0) + '</div>' +
            '<div class="b">' + (d.payType === 'salary' ? 'from ' + esc(d.start || '') : 'log work below') + '</div>' +
            pnlInviteLine(d) +
            (d.uid ? '<div class="b" style="color:#2e7d32;font-weight:600">🤝 Connected — his days price at his own wage once it crosses; this rate is only the fallback until then</div>' : '') +
            '<div class="row" style="margin-top:6px;align-items:flex-end"><div style="flex:1"><label class="f">Travel hrs/day owed</label><input type="number" inputmode="decimal" min="0" step="0.25" data-pnltravel="' + esc(d.id) + '" value="' + (parseFloat(d.travelHours) || 0) + '"></div>' +
            '<button class="btn small ghost" data-pnldriverdel="' + esc(d.id) + '">Remove</button></div></div>';
        }).join('') + '</div></div>';

      /* Log driver work */
      var allDs = drivers();
      var workable = allDs.filter(function (d) { return d.payType !== 'salary'; });
      h += '<div class="card"><h3>🕒 Log driver work</h3>';
      if (!workable.length) {
        h += '<div class="empty">Add an hourly, per-mile, or per-load driver above to log work. Salary drivers are paid automatically each month — no work log needed.</div>';
      } else {
        h += '<div class="row"><div><label class="f">Date</label><input type="date" id="pnl_wdate" value="' + App._today() + '"></div>' +
          '<div><label class="f">Driver</label><select id="pnl_wdriver">' +
          workable.map(function (d) { return '<option value="' + esc(d.id) + '">' + esc(d.name) + ' (' + esc(PAY_LABEL[d.payType]) + ' ' + money(parseFloat(d.rate) || 0) + ')</option>'; }).join('') +
          '</select></div></div>' +
          '<div class="row"><div><label class="f" id="pnl_wqtylabel">Hours</label><input id="pnl_wqty" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0"></div></div>' +
          '<button class="btn primary" id="pnl_wadd">Log work</button>';
        h += '<div id="pnl_wlist">' + wageEntries().slice().reverse().slice(0, 30).map(function (e) {
          var dd = null;
          allDs.forEach(function (x) { if (x.id === e.driverId) dd = x; });
          return '<div class="listitem"><div class="a">' + esc(dd ? dd.name : '(removed driver)') + ' — ' + esc(e.qty) + ' ' + esc(e.unit) + ' = ' + money(parseFloat(e.wage) || 0) + '</div>' +
            '<div class="b">' + esc(e.date) + '</div>' +
            '<div class="row" style="margin-top:6px"><button class="btn small ghost" data-pnlwdel="' + esc(e.id) + '">Delete</button></div></div>';
        }).join('') + '</div>';
      }
      h += '</div>';

      /* Manual business expense entry */
      h += '<div class="card"><h3>＋ Business expense</h3>' +
        '<div class="row"><div><label class="f">Date</label><input type="date" id="pnl_date" value="' + App._today() + '"></div>' +
        '<div><label class="f">Category</label><select id="pnl_cat">' +
        BIZ_CATS.map(function (x) { return '<option>' + x + '</option>'; }).join('') + '</select></div></div>' +
        '<div class="row"><div><label class="f">What</label><input id="pnl_what" placeholder="e.g. Oil change"></div>' +
        '<div><label class="f">Cost $</label><input id="pnl_cost" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"></div></div>' +
        '<label class="f">📷 Receipt photo</label>' +
        '<div style="display:flex;gap:10px;margin-bottom:8px;">' +
        '<button type="button" class="btn secondary" id="pnl_rc_cam" style="flex:1;">📷 Take photo</button>' +
        '<button type="button" class="btn secondary" id="pnl_rc_pick" style="flex:1;">📁 Choose file</button>' +
        '</div>' +
        '<input type="file" id="pnl_rc_img_cam" accept="image/*" capture="environment" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<input type="file" id="pnl_rc_img" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<div id="pnl_rc_prev"></div>' +
        '<div id="pnl_rc_read" style="font-size:14px;margin-top:8px;"></div>' +
        '<button class="btn primary" id="pnl_add">Add expense</button>' +
        '<div id="pnl_list">' + bizExpenses().slice().reverse().map(function (x, ri) {
          return '<div class="listitem"><div class="a">' + esc(x.what || x.category) + ' — $' + esc(x.cost) + '</div>' +
            '<div class="b">' + esc(x.date) + ' · ' + esc(x.category || 'Other') + '</div>' +
            '<div class="row" style="margin-top:6px"><button class="btn small ghost" data-pnldel="' + (bizExpenses().length - 1 - ri) + '">Delete</button></div></div>';
        }).join('') + '</div></div>';

      body.innerHTML = h;

      body.querySelector('#pnl_prev').onclick = function () { W('month', shiftMonth(m, -1)); api.render(body); };
      body.querySelector('#pnl_next').onclick = function () { W('month', shiftMonth(m, 1)); api.render(body); };

      /* v163: custom expense lines — the "+" adds one, ✕ removes
         one. (The old #pnl_miles override handler is GONE with
         its input: miles come from the odometer only.) */
      var addCatBtn = body.querySelector('#pnl_addcat');
      if (addCatBtn) addCatBtn.onclick = function () {
        var inp = body.querySelector('#pnl_newcat');
        var label = inp ? inp.value.trim() : '';
        if (!label) { if (inp) inp.focus(); return; }
        var l = customCats().map(function (c) { return { key: c.key, label: c.label }; });
        l.push({ key: 'c' + Date.now().toString(36), label: label });
        W('custom_cats', l);
        api.render(body);
      };
      body.querySelectorAll('[data-pnldelcat]').forEach(function (b) {
        b.onclick = function () {
          if (!confirm('Remove this expense line? Its typed amounts stay saved but the line leaves the list.')) return;
          var key = b.getAttribute('data-pnldelcat');
          W('custom_cats', customCats().filter(function (c) { return c.key !== key; })
            .map(function (c) { return { key: c.key, label: c.label }; }));
          api.render(body);
        };
      });

      /* Monthly analysis: detailed category amounts (type to override auto) */
      body.querySelectorAll('[data-pnldet]').forEach(function (inp) {
        inp.onchange = function () {
          var key = inp.getAttribute('data-pnldet');
          var v = parseFloat(inp.value);
          saveDetail(m, key, isNaN(v) ? 0 : v, null);
          api.render(body);
        };
      });

      /* Monthly analysis: auto % rates (e.g. workers' comp) — editable per province default */
      body.querySelectorAll('[data-pnlrate]').forEach(function (inp) {
        inp.onchange = function () {
          var key = inp.getAttribute('data-pnlrate');
          var v = parseFloat(inp.value);
          if (isNaN(v) || v < 0) { api.render(body); return; }
          saveDetail(m, key, null, v);
          api.render(body);
        };
      });

      /* v42: receipt photo → OCR on the Business expense form — same
         shared pipeline as Fuel (TicketOCR.fileToOCRImage 1600px +
         recognizeWithRotation), fields the user typed in are never
         overwritten, and the read is always reported. Never silent. */
      ['#pnl_date', '#pnl_what', '#pnl_cost'].forEach(function (id) {
        var e = body.querySelector(id);
        if (e) e.addEventListener('input', function () { e.setAttribute('data-touched', '1'); });
      });
      var pnlCat = body.querySelector('#pnl_cat');
      if (pnlCat) pnlCat.addEventListener('change', function () { pnlCat.setAttribute('data-touched', '1'); });
      function pnlFillField(id, v) {
        var e = body.querySelector(id);
        if (!e || !v) return;
        if (e.getAttribute('data-touched')) return;
        if (e.value && id !== '#pnl_date') return;
        e.value = v;
      }
      var pnlRcCamInput = body.querySelector('#pnl_rc_img_cam');
      var pnlRcPickInput = body.querySelector('#pnl_rc_img');
      body.querySelector('#pnl_rc_cam').onclick = function () { pnlRcCamInput.click(); };
      body.querySelector('#pnl_rc_pick').onclick = function () { pnlRcPickInput.click(); };
      var pnlOcrToken = 0;
      function pnlSetRead(html) { var d = body.querySelector('#pnl_rc_read'); if (d) d.innerHTML = html; }
      function pnlHandlePhoto(ev) {
        var file = ev.target.files && ev.target.files[0]; if (!file) return;
        var token = ++pnlOcrToken;
        var r = new FileReader();
        r.onload = function () { body.querySelector('#pnl_rc_prev').innerHTML = '<img src="' + r.result + '" style="width:100%;border-radius:10px;margin-top:10px">'; };
        r.readAsDataURL(file);
        if (!window.TicketOCR || !TicketOCR.fileToOCRImage || !TicketOCR.parseExpenseReceipt) {
          pnlSetRead('<span style="color:#e67e22">Photo added — the reader isn\'t ready, fill the form by hand.</span>');
          return;
        }
        pnlSetRead('📖 Reading receipt…');
        TicketOCR.fileToOCRImage(file, function (ocrUrl) {
          if (token !== pnlOcrToken) return;
          if (!ocrUrl) { pnlSetRead('<span style="color:#e67e22">Couldn\'t read that photo — fill the form by hand.</span>'); return; }
          TicketOCR.recognizeWithRotation(ocrUrl, function (p) {
            if (token !== pnlOcrToken) return;
            try { pnlSetRead('📖 Reading receipt… ' + Math.round(p * 100) + '%'); } catch (e) {}
          }).then(function (text) {
            if (token !== pnlOcrToken) return;
            var parsed = TicketOCR.parseExpenseReceipt(text);
            var rep = TicketOCR.describeExpenseRead(parsed);
            pnlFillField('#pnl_cost', parsed.total);
            pnlFillField('#pnl_what', parsed.vendor);
            pnlFillField('#pnl_date', parsed.date);
            if (parsed.category && pnlCat && !pnlCat.getAttribute('data-touched')) {
              for (var oi = 0; oi < pnlCat.options.length; oi++) {
                if (pnlCat.options[oi].value === parsed.category || pnlCat.options[oi].text === parsed.category) {
                  pnlCat.selectedIndex = oi; break;
                }
              }
            }
            if (rep.found.length) {
              pnlSetRead('🧾 Read: ' + esc(rep.found.join(' · ')) +
                (rep.missing.length ? '<br><span style="color:#e67e22">Couldn\'t find: ' + esc(rep.missing.join(', ')) + '</span>' : ''));
            } else {
              pnlSetRead('<span style="color:#e67e22">Couldn\'t read anything from that receipt — fill the form by hand.</span>');
            }
          }).catch(function () {
            if (token !== pnlOcrToken) return;
            pnlSetRead('<span style="color:#e67e22">Couldn\'t read that receipt — fill the form by hand.</span>');
          });
        });
      }
      pnlRcCamInput.onchange = pnlHandlePhoto;
      pnlRcPickInput.onchange = pnlHandlePhoto;

      body.querySelector('#pnl_add').onclick = function () {
        var what = body.querySelector('#pnl_what').value.trim();
        var cost = parseFloat(body.querySelector('#pnl_cost').value);
        if (!what || !(cost > 0)) { alert('Enter what it was and a cost greater than 0.'); return; }
        var rec = {
          date: body.querySelector('#pnl_date').value || App._today(),
          category: body.querySelector('#pnl_cat').value,
          what: what,
          cost: cost.toFixed(2)
        };
        var l = bizExpenses(); l.push(rec); W('expenses', l);
        if (window.FB && FB.saveDoc) { try { FB.saveDoc('pnl', 'x' + Date.now(), rec); } catch (e) {} }
        api.render(body);
      };
      body.querySelectorAll('[data-pnldel]').forEach(function (b) {
        b.onclick = function () {
          if (!confirm('Delete this expense?')) return;
          var l = bizExpenses(); l.splice(+b.getAttribute('data-pnldel'), 1); W('expenses', l);
          api.render(body);
        };
      });

      /* Driver wages: add driver — v120: the two doors.
         v131: the Connect door ROUTES to the Connect screen's live
         people search (the flag lands the user on its search box);
         it no longer opens a form. The v120 email/phone invite
         handler is removed with its form — it saved a local-only
         pending driver + connection and delivered nothing. */
      /* v132: connected-crew books — fetch the month's shared days
         and paint them priced; the card's own Set-pay door reopens
         the manual form prefilled for that driver. v146: the
         peers' shared RECORDS ride the same fetch; the days are
         cached locally for calc() so the priced crew wages sit in
         the expense totals — and when this fetch changes them,
         the module repaints once so the totals catch up. */
      var crewEl = body.querySelector('#pnl_crew');
      if (crewEl && window.ConnectPipe) {
        Promise.all([
          ConnectPipe.fetchCrewRange(m + '-01', m + '-31').catch(function () { return []; }),
          ConnectPipe.fetchRecords ? ConnectPipe.fetchRecords().catch(function () { return { records: {}, billing: {} }; })
            : Promise.resolve({ records: {}, billing: {} })
        ]).then(function (r) {
          var days = r[0] || [];
          var recs = (r[1] && r[1].records) || {};
          var bills = (r[1] && r[1].billing) || {};
          var mans = (r[1] && r[1].manifests) || {};
          cacheCrewDays(m, days);
          /* v163: cache each connected driver's OWN wage (from
             his records doc) where ConnectPipe.pricingFor reads
             it — his days then price at HIS rate on these books */
          try {
            var pw = {};
            Object.keys(recs).forEach(function (uid) {
              var w = recs[uid] && recs[uid].driverWage;
              if (w && parseFloat(w.rate) > 0) pw[uid] = { payType: w.payType || 'hourly', rate: parseFloat(w.rate) || 0 };
            });
            App._store.set('__peer_wages', pw);
          } catch (e) {}
          crewEl.innerHTML = pnlCrewHtml(days, recs, bills, mans, m);
          /* v146: the shared documents + receipt photos */
          crewEl.querySelectorAll('[data-pnlinv]').forEach(function (b) {
            b.onclick = function () {
              var parts = (b.getAttribute('data-pnlinv') || '').split(':');
              var bill = bills[parts[0]], iv = null;
              if (bill) (bill.invoices || []).forEach(function (x) { if (x.id === parts[1]) iv = x; });
              if (!iv) return;
              if (window.Meticulous && Meticulous.shared && Meticulous.shared.printInvoiceDoc) {
                Meticulous.shared.printInvoiceDoc(iv.doc);
              } else if (window.Meticulous && Meticulous.shared && Meticulous.shared.invoiceDocHtml) {
                var slot = crewEl.querySelector('#pnl_ivdoc_' + parts[0] + '_' + parts[1]);
                if (slot) slot.innerHTML = '<div class="card" style="margin:6px 0">' + Meticulous.shared.invoiceDocHtml(iv.doc) + '</div>';
              }
            };
          });
          crewEl.querySelectorAll('[data-pnlman]').forEach(function (b) {
            b.onclick = function () {
              var parts = (b.getAttribute('data-pnlman') || '').split(':');
              var bill = bills[parts[0]], man = null;
              if (bill) (bill.manifests || []).forEach(function (x) { if (x.pa + '_' + x.pb === parts[1]) man = x; });
              if (!man) return;
              var slot = crewEl.querySelector('#pnl_mandoc_' + parts[0] + '_' + man.pa + '_' + man.pb);
              if (!slot) return;
              if (slot.innerHTML) { slot.innerHTML = ''; return; }
              var lines = [];
              man.days.forEach(function (dy) { (dy.lines || []).forEach(function (l) { lines.push(l); }); });
              slot.innerHTML = '<div class="card" style="margin:6px 0">' +
                ConnectPipe.manifestLinesHtml(lines) +
                '<div style="margin-top:8px"><button class="btn small navy" id="pnl_manprint_' + parts[0] + '_' + man.pa + '_' + man.pb + '">Print manifest</button></div></div>';
              var pb2 = slot.querySelector('#pnl_manprint_' + parts[0] + '_' + man.pa + '_' + man.pb);
              if (pb2) pb2.onclick = function () {
                ConnectPipe.printManifestDoc('Manifest — ' + man.pa + ' to ' + man.pb, lines);
              };
            };
          });
          /* v148: a LIMITED driver's manifests — the same
             view/print door over his manifests doc */
          crewEl.querySelectorAll('[data-pnlmanl]').forEach(function (b) {
            b.onclick = function () {
              var parts = (b.getAttribute('data-pnlmanl') || '').split(':');
              var mdoc = mans[parts[0]], man = null;
              if (mdoc) (mdoc.manifests || []).forEach(function (x) { if (x.pa + '_' + x.pb === parts[1]) man = x; });
              if (!man) return;
              var slot = crewEl.querySelector('#pnl_manldoc_' + parts[0] + '_' + man.pa + '_' + man.pb);
              if (!slot) return;
              if (slot.innerHTML) { slot.innerHTML = ''; return; }
              var lines = [];
              man.days.forEach(function (dy) { (dy.lines || []).forEach(function (l) { lines.push(l); }); });
              slot.innerHTML = '<div class="card" style="margin:6px 0">' +
                ConnectPipe.manifestLinesHtml(lines) +
                '<div style="margin-top:8px"><button class="btn small navy" id="pnl_manlprint_' + parts[0] + '_' + man.pa + '_' + man.pb + '">Print manifest</button></div></div>';
              var pb3 = slot.querySelector('#pnl_manlprint_' + parts[0] + '_' + man.pa + '_' + man.pb);
              if (pb3) pb3.onclick = function () {
                ConnectPipe.printManifestDoc('Manifest — ' + man.pa + ' to ' + man.pb, lines);
              };
            };
          });
          crewEl.querySelectorAll('[data-pnlphoto]').forEach(function (b) {
            b.onclick = function () {
              var parts = (b.getAttribute('data-pnlphoto') || '').split(':');
              var slot = crewEl.querySelector('#pnl_photo_' + parts[0] + '_' + parts[1]);
              if (!slot) return;
              if (slot.innerHTML) { slot.innerHTML = ''; return; }
              slot.innerHTML = '<p class="note">Loading the receipt…</p>';
              ConnectPipe.fetchPhoto(parts[0], parts[1]).then(function (url) {
                slot.innerHTML = url
                  ? '<img src="' + url + '" alt="Fuel receipt" style="max-width:100%;border-radius:8px;margin:4px 0">'
                  : '<p class="note">The receipt photo could not be loaded.</p>';
              });
            };
          });
          var nc = calc(m);
          if (nc.crewWages !== c.crewWages) api.render(body);
        }).catch(function () {
          crewEl.innerHTML = '<p class="note">Crew is unreachable right now.</p>';
        });
      }
      var cOpen = body.querySelector('#pnl_connect_open');
      if (cOpen) cOpen.onclick = function () {
        try { window.__mtConnectSearch = true; } catch (e) {}
        if (window.App && App.openModule) App.openModule('connect');
      };
      var mOpen = body.querySelector('#pnl_manual_open');
      if (mOpen) mOpen.onclick = function () { pnlManualOpen = true; api.render(body); };
      /* Driver wages: add driver (manual door — unchanged) */
      var dadd = body.querySelector('#pnl_dadd');
      if (dadd) dadd.onclick = function () {
        var name = body.querySelector('#pnl_dname').value.trim();
        var rate = parseFloat(body.querySelector('#pnl_drate').value);
        if (!name || !(rate > 0)) { alert('Enter a driver name and a rate greater than 0.'); return; }
        var rec = {
          id: 'd' + Date.now(),
          name: name,
          payType: body.querySelector('#pnl_dtype').value,
          rate: rate,
          travelHours: parseFloat(body.querySelector('#pnl_dtravel').value) || 0, // v52
          start: body.querySelector('#pnl_dstart').value || App._today().slice(0, 7)
        };
        /* v132: a prefilled save is FOR a connected driver — his
           account uid stamps the entry, and that stamp is what
           prices his shared days on these books from now on. */
        if (pnlPrefill && pnlPrefill.uid) {
          rec.uid = pnlPrefill.uid; rec.viaConnect = true; pnlPrefill = null;
        }
        var l = drivers(); l.push(rec); W('drivers', l);
        if (window.FB && FB.saveDoc) { try { FB.saveDoc('pnl_drivers', rec.id, rec); } catch (e) {} }
        api.render(body);
      };
      /* v52: per-driver travel hrs/day — editable in place; saves on change */
      body.querySelectorAll('[data-pnltravel]').forEach(function (inp) {
        inp.onchange = function () {
          var id = inp.getAttribute('data-pnltravel');
          var v = parseFloat(inp.value);
          if (isNaN(v) || v < 0) v = 0;
          var l = drivers(), rec = null;
          l.forEach(function (d) { if (d.id === id) { d.travelHours = v; rec = d; } });
          W('drivers', l);
          if (rec && window.FB && FB.saveDoc) { try { FB.saveDoc('pnl_drivers', rec.id, rec); } catch (e) {} }
          api.render(body);
        };
      });
      body.querySelectorAll('[data-pnldriverdel]').forEach(function (b) {
        b.onclick = function () {
          if (!confirm('Remove this driver? Their logged work entries will be removed too.')) return;
          var id = b.getAttribute('data-pnldriverdel');
          W('drivers', drivers().filter(function (d) { return d.id !== id; }));
          W('wage_entries', wageEntries().filter(function (e) { return e.driverId !== id; }));
          W('travel_claims', travelClaims().filter(function (c) { return c.driverId !== id; })); // v52
          api.render(body);
        };
      });

      /* Driver wages: log work */
      var wadd = body.querySelector('#pnl_wadd');
      if (wadd) {
        var wdriver = body.querySelector('#pnl_wdriver');
        var updQty = function () {
          var dd = null;
          drivers().forEach(function (x) { if (x.id === wdriver.value) dd = x; });
          var lbl = body.querySelector('#pnl_wqtylabel');
          if (lbl && dd) lbl.textContent = QTY_LABEL[dd.payType] || 'Amount';
        };
        wdriver.onchange = updQty; updQty();
        wadd.onclick = function () {
          var dd = null;
          drivers().forEach(function (x) { if (x.id === wdriver.value) dd = x; });
          if (!dd) { alert('Pick a driver.'); return; }
          var qty = parseFloat(body.querySelector('#pnl_wqty').value);
          if (!(qty > 0)) { alert('Enter the ' + (QTY_LABEL[dd.payType] || 'amount').toLowerCase() + ' worked.'); return; }
          var rate = parseFloat(dd.rate) || 0;
          var rec = {
            id: 'w' + Date.now(),
            date: body.querySelector('#pnl_wdate').value || App._today(),
            driverId: dd.id,
            qty: qty,
            unit: UNIT[dd.payType] || '',
            rate: rate,
            wage: qty * rate
          };
          var l = wageEntries(); l.push(rec); W('wage_entries', l);
          if (window.FB && FB.saveDoc) { try { FB.saveDoc('pnl_wage_entries', rec.id, rec); } catch (e) {} }
          api.render(body);
        };
        body.querySelectorAll('[data-pnlwdel]').forEach(function (b) {
          b.onclick = function () {
            if (!confirm('Delete this work entry?')) return;
            var id = b.getAttribute('data-pnlwdel');
            W('wage_entries', wageEntries().filter(function (e) { return e.id !== id; }));
            api.render(body);
          };
        });
      }
    }
  };

  Meticulous.modules.pnl = api;
})();
