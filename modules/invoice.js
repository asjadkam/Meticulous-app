/* Invoice / Pay Stub module (Meticulous.modules convention)
   Contractor: period-based lines from revenue + manual items, province-based
   tax (editable), invoice numbering, print. Payroll (v122): the stub builds
   itself — gross pre-filled from the period's completed work at the driver's
   own wage rate, CPP/CPP2 + EI + federal/provincial income tax auto-calculated
   with the CRA T4127 formulas (PAYROLL-CALC region), every auto field
   overridable; never defaults to US rules; country/province required from
   Preferences before use. */
(function () {
  'use strict';
  var S = function (k, d) { return App._store.get('inv_' + k, d); };
  var W = function (k, v) { return App._store.set('inv_' + k, v); }; // v55: returns write result
  var esc = function (s) { return App._esc(s); };

  /* Canadian GST/HST by province — prefill only, always editable */
  var CA_TAX = { AB: 5, BC: 5, MB: 5, NB: 15, NL: 15, NS: 15, NT: 5, NU: 5, ON: 13, PE: 15, QC: 5, SK: 5, YT: 5 };
  var CA_NAME2CODE = { 'Alberta': 'AB', 'British Columbia': 'BC', 'Manitoba': 'MB', 'New Brunswick': 'NB',
    'Newfoundland and Labrador': 'NL', 'Nova Scotia': 'NS', 'Northwest Territories': 'NT', 'Nunavut': 'NU',
    'Ontario': 'ON', 'Prince Edward Island': 'PE', 'Quebec': 'QC', 'Saskatchewan': 'SK', 'Yukon': 'YT' };

  /* v76 (F8, boss QA Oct 14): read-time location bridge. Since v76,
     onboarding's company step collects country + province (codes) for
     every role. Records written before that may carry ONLY the
     Preferences "Home province" (a full name) — that IS a location
     answer, so derive country/province from it here instead of
     greeting the user with the red "Set your location first" banner
     for a fact he already gave. The stored record is never mutated. */
  function onb() {
    var o = App._store.get('onboarding', {});
    if ((!o.country || !o.province) && o.homeProvince && CA_NAME2CODE[o.homeProvince]) {
      var c = {};
      for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) c[k] = o[k]; }
      if (!c.country) c.country = 'Canada';
      if (!c.province) c.province = CA_NAME2CODE[o.homeProvince];
      return c;
    }
    return o;
  }
  function invoices() { return S('list', []); }
  function paystubs() { return S('stubs', []); }

  function defaultTaxRate(o) {
    if (o.country === 'Canada' && o.province && CA_TAX[o.province]) return CA_TAX[o.province];
    return 0;
  }

  function nextInvNo() {
    var o = onb();
    return String(o.nextInvoiceNo || '').trim() || invCycNextNo(invoices());
  }

  /* ================= INV-CYCLE-BEGIN =================
     v55: the invoice CYCLE — semi-monthly periods, verified issuing,
     automatic rollover. Pure date/numbering helpers plus one
     store-mediated issue function; harness-extractable
     (tools/invoice-cycle-test.js runs this region verbatim).

     Periods: 1st–15th and 16th–last day of the month. The OPEN period
     is the period after the most recently issued invoice's period end
     (records carry pa/pb from this version on; for an older record
     without pb, fall back to the period containing its date). With no
     issued invoices, the open period is the one containing today.

     Issuing is VERIFIED (the v48 rule): the inv_list write must read
     back before anything else happens. On failure the draft stays
     exactly as it was and nothing prints. Only a verified save starts
     the new cycle: the draft is cleared, the period inputs advance to
     the new open period, and a one-shot confirmation is stored for
     the next render.

     Numbering: a typed number wins; otherwise the user's own
     Preferences "Next invoice number" is used; only when neither
     exists does it fall back to max(numeric issued #) + 1, or 1 when
     no issued number is numeric. A successful issue reports the next
     Preferences number (issued # + 1) so the sequence the user sees
     is the sequence that advances — no silent counter. A typed or
     preferred number that collides with an issued one is refused.
     "(auto on save)" is a placeholder, never a value — a legacy draft
     still carrying it as a value is treated as empty.

     Dates: the issued record's date is the ISSUE date (today), never
     the draft's creation date; the draft date survives on the record
     as draftDate.

     Lines (v79): revenue entries are grouped to ONE line per day.
     A dispatch-completion entry is the day's confirmed source and
     wins over tracker/session entries for that day; a day with only
     ONE tracker entry keeps it, flagged unconfirmed; a day with
     several tracker entries and no confirmed source cannot be
     resolved and BLOCKS issuing (stage 'duplicate'). */
  var INV_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var invBody = null; // v116: last render target, for the module's back() re-render
  function invS(k, d) { return App._store.get('inv_' + k, d); }
  function invW(k, v) { return App._store.set('inv_' + k, v); }

  function invCycDim(y, m) {
    var t = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (m === 2 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) return 29;
    return t[m - 1];
  }
  function invCycParse(s) {
    if (typeof s !== 'string') return null;
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > invCycDim(y, mo)) return null;
    return { y: y, m: mo, d: d };
  }
  function invCycFmt(y, m, d) { return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2); }
  function invCycDayAfter(s) {
    var p = invCycParse(s); if (!p) return null;
    var dt = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
    return invCycFmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  /* The semi-monthly period containing a date: {a, b} as ISO dates. */
  function invCycPeriodOf(s) {
    var p = invCycParse(s); if (!p) return null;
    if (p.d <= 15) return { a: invCycFmt(p.y, p.m, 1), b: invCycFmt(p.y, p.m, 15) };
    return { a: invCycFmt(p.y, p.m, 16), b: invCycFmt(p.y, p.m, invCycDim(p.y, p.m)) };
  }
  function invCycNextPeriod(p) { return invCycPeriodOf(invCycDayAfter(p.b)); }
  function invCycOpenPeriod(list, today) {
    var maxB = null;
    (list || []).forEach(function (r) {
      if (!r) return;
      var end = invCycParse(r.pb) ? r.pb : (invCycParse(r.date) ? r.date : (invCycParse(r.at) ? r.at : null));
      if (!end) return;
      var per = invCycPeriodOf(end);
      if (per && (!maxB || per.b > maxB)) maxB = per.b;
    });
    if (maxB) return invCycPeriodOf(invCycDayAfter(maxB));
    return invCycPeriodOf(today);
  }
  function invCycShort(p) {
    var a = invCycParse(p && p.a), b = invCycParse(p && p.b);
    if (!a || !b) return '';
    return INV_MON[a.m - 1] + ' ' + a.d + '–' + b.d;
  }
  function invCycLabel(p) {
    var a = invCycParse(p && p.a), s = invCycShort(p);
    return a && s ? s + ', ' + a.y : s;
  }
  function invCycDateShort(s) {
    var p = invCycParse(s);
    return p ? INV_MON[p.m - 1] + ' ' + p.d : String(s || '');
  }
  /* Numeric value of an issued invoice number: the number itself for
     plain numbers ("10" -> 10), the trailing group for formatted ones
     ("INV-2026-0007" -> 7); null when it carries no digits. */
  function invCycNoValue(no) {
    if (no === null || no === undefined) return null;
    var s = String(no).trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    var m = s.match(/(\d+)\s*$/);
    return m ? parseInt(m[1], 10) : null;
  }
  function invCycNextNo(list) {
    var max = 0;
    (list || []).forEach(function (r) {
      var v = invCycNoValue(r && r.no);
      if (v !== null && v > max) max = v;
    });
    return String(max + 1);
  }
  function invCycCollision(list, no) {
    var t = String(no || '').trim().toLowerCase();
    if (!t) return false;
    return (list || []).some(function (r) {
      return !!r && String(r.no || '').trim().toLowerCase() === t;
    });
  }
  /* The number AFTER an issued one, in the user's own format: plain
     numbers step by 1 ("1151" -> "1152", keeping zero padding), and
     formatted numbers step their trailing group ("INV-2026-0007" ->
     "INV-2026-0008"). '' when the number carries no digits. */
  function invCycIncrementNo(no) {
    var s = String(no || '').trim();
    var m = s.match(/(\d+)\s*$/);
    if (!m) return '';
    var next = String(parseInt(m[1], 10) + 1);
    while (next.length < m[1].length) next = '0' + next;
    return s.slice(0, s.length - m[1].length) + next;
  }
  function invCycRound2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  /* Invoice totals. Tax-INCLUSIVE mode (v79): the amounts already
     carry the tax — subtotal is the total due, and the tax figure is
     the part of it that is tax: sub x rate/(100+rate). Add-on mode is
     the original behaviour: tax = sub x rate/100, added on top. */
  function invCycTotals(sub, taxRate, taxIncluded) {
    var s = invCycRound2(sub);
    var r = Number(taxRate) || 0;
    var tax = taxIncluded ? invCycRound2(s * r / (100 + r)) : invCycRound2(s * r / 100);
    return { sub: s, tax: tax, total: taxIncluded ? s : invCycRound2(s + tax) };
  }
  /* v122: what has actually been PAID against an invoice record,
     from the payment facts the record itself carries (a payments
     list of {amount} entries, or a paid / paidAmount figure).
     The app holds no separate payments ledger today, so for any
     record without payment facts this is honestly 0 — the print
     then shows Paid $0.00 and Balance = Total due, and a record
     that ever gains payment facts prints them without a code
     change. */
  function invCycPaidTotal(rec) {
    if (!rec) return 0;
    var paid = 0;
    if (Array.isArray(rec.payments)) {
      rec.payments.forEach(function (p) {
        paid += parseFloat(p && (p.amount !== undefined ? p.amount : p.amt)) || 0;
      });
    }
    if (parseFloat(rec.paidAmount) > 0) paid += parseFloat(rec.paidAmount);
    else if (parseFloat(rec.paid) > 0) paid += parseFloat(rec.paid);
    return invCycRound2(paid);
  }
  function invCycCompanyMissing(company) {
    return !String((company && company.name) || '').trim();
  }
  /* Where a stored revenue entry came from — dispatch completions
     keep their "Dispatch: …" note through revenue.addEntry, tracker
     sessions carry auto/'Auto from tracker'. */
  function invCycEntrySrc(e) {
    if (!e) return 'entry';
    if (e.auto) return 'tracker';
    var n = e.note || '';
    if (n.indexOf('Dispatch:') === 0) return 'dispatch';
    if (n === 'Auto from tracker') return 'tracker';
    return 'entry';
  }
  function invCycCloneLine(l) {
    var c = {};
    for (var k in l) { if (Object.prototype.hasOwnProperty.call(l, k)) c[k] = l[k]; }
    return c;
  }
  function invCycCombinedLine(group, src) {
    var amt = 0;
    group.forEach(function (l) { amt += Number(l.amt) || 0; });
    return {
      desc: (src === 'dispatch' ? 'Dispatch completions' : 'Revenue entries') +
        ' (' + group.length + ' entries) — ' + group[0].date,
      amt: invCycRound2(amt), date: group[0].date, src: src, combined: true
    };
  }
  /* Build the invoice's revenue lines from period entries + extras.
     Returns {lines, duplicateDates, unconfirmedDates}: ONE line per
     day (see the region header for the source rules); extras are
     separate charges and pass through untouched. */
  function invCycBuildRevenueLines(entries, extras, rate, std) {
    rate = parseFloat(rate) || 0;
    std = String(std || '').toLowerCase();
    var raw = [];
    /* v81: hours accumulate in a SIDE map (never on the line
       objects — their shape is the invoice's contract) so Revenue
       can show the chosen source's hours beside the chosen money:
       dayHours[date] = the hours of whichever group won the day. */
    var hoursByDateSrc = {};
    /* v105: priced contributions per day/source/type in a SIDE map
       (same discipline as dayHours) so P&L can break the grouped
       income down by type without re-pricing anything itself. */
    var typeByDateSrc = {};
    (entries || []).forEach(function (e) {
      /* v105 pricing: an explicit amount on the entry WINS — it is
         the number that was true when the entry was logged or last
         edited in Day Details (the payFor rule: an amount over 0
         prices the entry). Quantity × current rate is only the
         fallback for amount-less entries (imports, legacy rows), so
         a later rate change can never rewrite money already agreed. */
      var amt = parseFloat(e.amount) || 0, desc = '', qty = 0;
      if (std === 'hourly') { qty = parseFloat(e.hours) || 0; desc = (e.hours || 0) + ' hrs @ $' + rate; }
      else if (std === 'miles') { qty = parseFloat(e.miles) || 0; desc = (e.miles || 0) + ' mi @ $' + rate; }
      else if (std === 'trip') { qty = parseFloat(e.trips) || 0; desc = (e.trips || 0) + ' trips @ $' + rate; }
      else if (std === 'weight') { qty = parseFloat(e.tons) || 0; desc = (e.tons || 0) + ' tons @ $' + rate; }
      else { desc = e.note || e.date; }
      if (!(amt > 0)) amt = qty * rate;
      if (amt > 0 && qty <= 0 && std && e.note) desc = e.note;
      if (amt > 0) {
        var src = invCycEntrySrc(e);
        raw.push({ desc: desc + ' — ' + e.date, amt: invCycRound2(amt), date: e.date, src: src });
        var hd = hoursByDateSrc[e.date] || (hoursByDateSrc[e.date] = {});
        hd[src] = (hd[src] || 0) + (parseFloat(e.hours) || 0);
        var td = typeByDateSrc[e.date] || (typeByDateSrc[e.date] = {});
        var tt = td[src] || (td[src] = {});
        var et = e.type || (std === 'weight' ? 'weight' : std === 'trip' ? 'load' : 'hourly');
        tt[et] = (tt[et] || 0) + amt;
      }
    });
    var byDate = {};
    raw.forEach(function (l) {
      var g = byDate[l.date] || (byDate[l.date] = { dispatch: [], tracker: [], entry: [] });
      if (g[l.src]) g[l.src].push(l); else g.entry.push(l);
    });
    var lines = [], duplicateDates = [], unconfirmedDates = [], dayHours = {}, typeTotals = {};
    Object.keys(byDate).sort().forEach(function (date) {
      var g = byDate[date], chosen = null, chosenSrc = null;
      if (g.dispatch.length) {
        chosen = g.dispatch.length === 1 ? invCycCloneLine(g.dispatch[0]) : invCycCombinedLine(g.dispatch, 'dispatch');
        chosenSrc = 'dispatch';
      } else if (g.entry.length) {
        chosen = g.entry.length === 1 ? invCycCloneLine(g.entry[0]) : invCycCombinedLine(g.entry, 'entry');
        chosenSrc = 'entry';
      } else if (g.tracker.length === 1) {
        chosen = invCycCloneLine(g.tracker[0]);
        chosen.unconfirmed = true;
        unconfirmedDates.push(date);
        chosenSrc = 'tracker';
      } else if (g.tracker.length > 1) {
        duplicateDates.push(date);
      }
      if (chosen) {
        lines.push(chosen);
        var hd2 = hoursByDateSrc[date] || {};
        dayHours[date] = hd2[chosenSrc] || 0;
        var tt2 = (typeByDateSrc[date] || {})[chosenSrc] || {};
        Object.keys(tt2).forEach(function (t) { typeTotals[t] = invCycRound2((typeTotals[t] || 0) + tt2[t]); });
      }
    });
    (extras || []).forEach(function (x) {
      var v = parseFloat(x.amount) || 0;
      if (v !== 0) {
        lines.push({ desc: (x.type || 'Extra') + ' — ' + x.date, amt: v, date: x.date, src: 'extra' });
        typeTotals[x.type || 'Extra'] = invCycRound2((typeTotals[x.type || 'Extra'] || 0) + v);
      }
    });
    return { lines: lines, duplicateDates: duplicateDates, unconfirmedDates: unconfirmedDates, dayHours: dayHours, typeTotals: typeTotals };
  }
  /* v107 (Stage 2 foundation): ONE loads truth, shared the same
     way. A day's load count comes from the FIRST source that
     actually knows it — the sources are overlapping records of
     the SAME loads, so they are never summed:
       1. loads carried on the day's tickets (confirmed at close);
       2. the dispatch record's own loads, when deliberately
          recorded (loadsSet — the untouched form default '1' is
          NOT a recording and never counts);
       3. the movement count (geo, v140) — the geofence engine's
          day record: the count the app made itself from the
          truck's load<->dump cycles. Load counts are never the
          driver's job; this is the count of record whenever
          the machine could run;
       4. the day's +1 load taps (sessions + the live taps the
          caller hands in) — the driver's CORRECTION, the number
          used when counting genuinely could not run;
       5. a Weight day's counted loads (session loadCount).
     (v140 moved the movement count from last resort to above
     the taps: through Oct 17 it ranked LAST, so one tap
     silently outranked a full day of machine counting — and
     the dashboard never showed the machine count at all.
     Tickets and deliberate records still outrank it:
     paperwork is paperwork.)
     Pure: the caller passes the day's records in. */
  function invCycDayLoads(dateStr, src) {
    src = src || {};
    var loads = 0, source = '';
    var tk = 0;
    (src.dispatches || []).forEach(function (x) {
      ((x && x.tickets) || []).forEach(function (t) {
        var v = parseFloat(t && t.loads);
        if (v > 0) tk += v;
      });
    });
    if (tk > 0) { loads = Math.round(tk); source = 'tickets'; }
    if (!loads) {
      var rec = 0;
      (src.dispatches || []).forEach(function (x) {
        if (x && x.loadsSet) { var v = parseFloat(x.loads); if (v > 0) rec += v; }
      });
      if (rec > 0) { loads = Math.round(rec); source = 'recorded'; }
    }
    if (!loads) {
      var g = parseInt(src.geoLoads, 10) || 0;
      if (g > 0) { loads = g; source = 'sites'; }
    }
    if (!loads) {
      var taps = parseInt(src.liveTaps, 10) || 0;
      (src.sessions || []).forEach(function (s) { taps += parseInt(s && s.manualLoads, 10) || 0; });
      if (taps > 0) { loads = taps; source = 'taps'; }
    }
    if (!loads) {
      var w = 0;
      (src.sessions || []).forEach(function (s) { w += parseInt(s && s.loadCount, 10) || 0; });
      if (w > 0) { loads = w; source = 'weight'; }
    }
    return { loads: loads, source: source };
  }
  /* v81: the grouped per-day truth is shared — Revenue's screens
     and totals consume the SAME builder the invoice prints from, so
     a day can never total one way in Revenue and another on the
     invoice (Oct 15: Revenue's raw sum said $3,572.16 while the
     confirmed days totalled $3,306.00). */
  try {
    window.Meticulous = window.Meticulous || {};
    Meticulous.shared = Meticulous.shared || {};
    Meticulous.shared.buildRevenueLines = invCycBuildRevenueLines;
    Meticulous.shared.revenueEntrySource = invCycEntrySrc;
    Meticulous.shared.dayLoads = invCycDayLoads;
  } catch (e) {}
  /* Dates whose invoice lines come from BOTH a dispatch completion
     and the tracker — the classic double count. Lines carry
     {date, src} (see revenueLines). Returns short labels, sorted. */
  function invCycDupDates(lines) {
    var byDate = {};
    (lines || []).forEach(function (l) {
      if (!l || !l.date) return;
      if (l.src !== 'dispatch' && l.src !== 'tracker') return;
      var m = byDate[l.date] || (byDate[l.date] = {});
      m[l.src] = true;
    });
    var out = [];
    Object.keys(byDate).sort().forEach(function (d) {
      if (byDate[d].dispatch && byDate[d].tracker) out.push(invCycDateShort(d));
    });
    return out;
  }
  function invVerifyIssued(id) {
    var l = invS('list', []);
    for (var i = 0; i < l.length; i++) { if (l[i] && l[i].id === id) return true; }
    return false;
  }
  /* Verified issue + cycle rollover. x: {draft, revLines, sub, tax,
     total, pa, pb, today, now?, company, province, country, prefNo?,
     taxIncluded?, duplicateDates?, setNextInvoiceNo?}.
     Returns {ok:true, rec, next, nextPrefNo} or
     {ok:false, stage, message}.
     On failure NOTHING is written that matters: the list is only
     replaced by a verified write, and the draft is left untouched. */
  function invIssue(x) {
    var draft = x.draft || {};
    var dupDates = x.duplicateDates || [];
    if (dupDates.length) {
      return {
        ok: false, stage: 'duplicate',
        message: 'Saving is blocked: ' + dupDates.map(invCycDateShort).join(', ') +
          (dupDates.length === 1 ? ' still has' : ' still have') +
          ' more than one tracker entry and no dispatch completion to confirm the day. ' +
          'Fix that day in Revenue, then try again — nothing was saved and your draft is unchanged.'
      };
    }
    var list = invS('list', []);
    var typed = String(draft.no || '').trim();
    if (typed === '(auto on save)') typed = '';
    var pref = String(x.prefNo || '').trim();
    if (pref === '(auto on save)') pref = '';
    var no;
    if (typed || pref) {
      no = typed || pref;
      if (invCycCollision(list, no)) {
        return {
          ok: false, stage: 'collision',
          message: 'Invoice #' + no + ' has already been issued. Type a different number — nothing was saved and your draft is unchanged.'
        };
      }
    } else {
      no = invCycNextNo(list);
    }
    var rec = {
      id: 'inv' + (x.now || Date.now()), no: no, date: x.today, draftDate: draft.date, billTo: draft.billTo,
      pa: x.pa, pb: x.pb,
      revLines: x.revLines, items: (draft.items || []).slice(),
      taxRate: Number(draft.taxRate) || 0, taxIncluded: !!x.taxIncluded,
      sub: x.sub, tax: x.tax, total: x.total,
      /* v105: everything the printed document needs to reproduce
         the owner's hour-sheet format later — the winning hours per
         day, the haul-card facts per day, and the rate in force —
         stored ON the record so a reprint never depends on whatever
         the live stores hold by then. */
      dayHours: x.dayHours || null, cardDays: x.cardDays || null,
      rate: parseFloat(x.rate) || 0,
      /* v122: the truck number in force, archived like the rate —
         the printed Bill-to block carries it (his old #1150
         structure) and a reprint must not depend on whatever
         Preferences hold by then. */
      truckNo: x.truckNo || '',
      notes: draft.notes, company: x.company,
      province: x.province, country: x.country, at: x.today
    };
    var newList = list.slice(); newList.push(rec);
    if (invW('list', newList) === false || !invVerifyIssued(rec.id)) {
      return {
        ok: false, stage: 'write',
        message: 'Invoice #' + no + ' could not be saved — nothing was printed and your draft is unchanged. Check storage or connection, then try again.'
      };
    }
    /* The user's own sequence advances — visibly, in Preferences.
       The callback writes it only now that the issue is verified;
       nextPrefNo is also returned for callers without a callback. */
    var nextPrefNo = invCycIncrementNo(no);
    if (nextPrefNo && typeof x.setNextInvoiceNo === 'function') {
      try { x.setNextInvoiceNo(nextPrefNo); } catch (e) {}
    }
    /* Verified — the invoice is archived. Start the new cycle: clear
       the whole draft and advance the period to the new open period. */
    invW('draft', null);
    var next = invCycOpenPeriod(newList, x.today);
    if (next) { invW('pa', next.a); invW('pb', next.b); }
    invW('cycmsg', 'Invoice #' + no + ' saved for ' + invCycShort({ a: x.pa, b: x.pb }) +
      '. Next period: ' + invCycShort(next) + '.');
    return { ok: true, rec: rec, next: next, nextPrefNo: nextPrefNo };
  }
  /* v134: the number a print of the CURRENT draft would carry —
     a typed number wins, then the Preferences sequence, then
     max(issued)+1. PURE: reads nothing, writes nothing. The owner
     re-prints a draft again and again to judge the document's
     face (his words, Oct 17: "I am printing that period again
     and again to see its face!") — a look must cost nothing: the
     number is only ever MINTED by invIssue above, and a draft
     print archives nothing, advances nothing, clears nothing. */
  function invCycWouldBeNo(list, typed, pref) {
    var t = String(typed || '').trim();
    if (t === '(auto on save)') t = '';
    var p = String(pref || '').trim();
    if (p === '(auto on save)') p = '';
    return t || p || invCycNextNo(list);
  }
  /* v134: MARK SETTLED OUTSIDE THE APP. The owner's Oct 1–15,
     2026 period was settled OUTSIDE the app — invoice #1151 was
     built by hand, sent by him, and paid against — so the app
     still treated the period as open and every test print of it
     wore a fresh number (#1152, then #1153). This records the
     fact the owner states — a period plus the invoice number he
     used — as an archived record in the same list, so the open
     period advances past it (his becomes Oct 16–31) and the used
     number can never be issued twice. NO money figures are
     recorded: sub/tax/total stay null, the record prints
     nothing, and it invents no amounts. The next Preferences
     number is NOT touched (his stays 1152). Verified the v48/v55
     way, like invIssue: write, read back, only then advance.
     Removal (invCycRemoveSettled) re-opens the period. */
  function invCycMarkSettled(x) {
    var pa = x.pa, pb = x.pb;
    var no = String(x.externalNo || '').trim();
    if (no === '(auto on save)') no = '';
    if (!invCycParse(pa) || !invCycParse(pb) || pb < pa) {
      return { ok: false, stage: 'period', message: 'Pick the settled period first — nothing was recorded.' };
    }
    if (!no) {
      return { ok: false, stage: 'number', message: 'Enter the invoice number you used outside the app — nothing was recorded.' };
    }
    var list = invS('list', []);
    if (invCycCollision(list, no)) {
      return { ok: false, stage: 'collision', message: 'Invoice #' + no + ' is already on record — nothing was changed.' };
    }
    var rec = {
      id: 'inv' + (x.now || Date.now()), no: no, date: x.today, draftDate: null, billTo: '',
      pa: pa, pb: pb, settledOutside: true,
      revLines: [], items: [], taxRate: 0, taxIncluded: false,
      sub: null, tax: null, total: null,
      dayHours: null, cardDays: null, rate: 0, truckNo: '',
      notes: '', company: x.company || null,
      province: x.province, country: x.country, at: x.today
    };
    var newList = list.slice(); newList.push(rec);
    if (invW('list', newList) === false || !invVerifyIssued(rec.id)) {
      return {
        ok: false, stage: 'write',
        message: 'The settled record could not be saved — nothing was changed. Check storage or connection, then try again.'
      };
    }
    var next = invCycOpenPeriod(newList, x.today);
    if (next) { invW('pa', next.a); invW('pb', next.b); }
    invW('cycmsg', 'Recorded: ' + invCycLabel({ a: pa, b: pb }) + ' was settled outside the app (invoice #' + no + ').' +
      (next ? ' Open period: ' + invCycShort(next) + '.' : ''));
    return { ok: true, rec: rec, next: next };
  }
  /* v134: undo a settled-outside record — the period it covered
     opens again. Only settledOutside records can be removed this
     way; a real issued invoice is never deleted here. Verified:
     the write must read back WITHOUT the record before the open
     period is re-stamped. */
  function invCycRemoveSettled(id, today) {
    var list = invS('list', []);
    var rec = null;
    list.forEach(function (r) { if (r && r.id === id) rec = r; });
    if (!rec || !rec.settledOutside) {
      return { ok: false, stage: 'notfound', message: 'That is not a settled-outside record — nothing was removed.' };
    }
    var newList = list.filter(function (r) { return !r || r.id !== id; });
    if (invW('list', newList) === false || invVerifyIssued(id)) {
      return { ok: false, stage: 'write', message: 'The record could not be removed — nothing was changed.' };
    }
    var next = invCycOpenPeriod(newList, today);
    if (next) { invW('pa', next.a); invW('pb', next.b); }
    invW('cycmsg', 'Settled record for invoice #' + rec.no + ' removed — ' +
      invCycLabel({ a: rec.pa, b: rec.pb }) + ' is open again.');
    return { ok: true, rec: rec, next: next };
  }
  /* ================= v105: THE SENT FORMAT =================
     The printed invoice must read like the owner's own hour sheet —
     the document he actually sent his boss (invoice #1151, Oct 15,
     2026): one line per day as "Oct 16: 11h", and a closing note
     that spells out the tax-inclusive rate, the foreman+travel
     doctrine, each day's haul card, and the period's total hours.
     Pure helpers; harness-pinned in tools/invoice-format-test.js. */
  /* Hours the way his sheet writes them: 11, 10.5, 124.5. */
  function invCycFmtH(x) {
    var n = invCycRound2(parseFloat(x) || 0);
    return (n % 1 === 0) ? String(Math.round(n)) : String(n);
  }
  /* The day line in hour-sheet shape: "Oct 16: 11h". Falls back to
     the builder's own description when the day's hours are unknown
     (extras, legacy records). */
  function invCycLineLabel(line, dayHours) {
    if (!line || !line.date || !dayHours) return '';
    var h = parseFloat(dayHours[line.date]);
    if (!isFinite(h) || !(h > 0)) return '';
    return invCycDateShort(line.date) + ': ' + invCycFmtH(h) + 'h';
  }
  /* Haul-card facts per day, from the completed dispatch records:
     { 'YYYY-MM-DD': {tickets: [{num, foreman}], foreman, travel} }.
     Travel is what the day's PAID hours exceed the cards' foreman
     hours by (driver-side books); on office books the paid hours
     ARE the foreman hours, so travel stays 0 and no travel wording
     is generated. Only days a dispatch entry actually won are
     included — a card that never posted revenue is not invoiced. */
  function invCycCardDays(entries, dspList, dayHours, pa, pb) {
    var dspDates = {};
    (entries || []).forEach(function (e) {
      if (e && e.date && e.date >= pa && e.date <= pb && invCycEntrySrc(e) === 'dispatch') dspDates[e.date] = true;
    });
    var cards = {};
    (dspList || []).forEach(function (rec) {
      if (!rec || rec.status !== 'completed') return;
      var d = (typeof rec.date === 'string' && rec.date) ? rec.date : String(rec.scheduledAt || '').slice(0, 10);
      if (!d || !dspDates[d]) return;
      var tk = rec.tickets || [];
      if (!tk.length) return;
      var c = cards[d] || (cards[d] = { tickets: [], foreman: 0, travel: 0 });
      tk.forEach(function (t) {
        var fh = parseFloat(t && t.foremanHours) || 0;
        c.foreman = invCycRound2(c.foreman + fh);
        c.tickets.push({ num: String((t && (t.cardNumber || t.ticketNo)) || ''), foreman: fh });
      });
    });
    Object.keys(cards).forEach(function (d) {
      var total = dayHours ? parseFloat(dayHours[d]) : NaN;
      if (isFinite(total) && total > cards[d].foreman) cards[d].travel = invCycRound2(total - cards[d].foreman);
    });
    return cards;
  }
  /* The closing note, word-for-word in the shape of the sent #1151:
     "Rate $29.00/hour, tax included (net rate $27.62/hour + 5% GST
     of $1.38/hour). Hours are the foreman ticket hours for each day
     plus 1 hour of travel per day worked. Oct 14: haul card #23177
     (foreman 9.5h + 1h travel). … Total hours: 124.5."
     Tax-inclusive invoices only; anything the facts don't support
     (no rate, no travel, no cards) is simply not claimed. */
  function invCycDocNote(lines, dayHours, cards, opt) {
    opt = opt || {};
    if (!opt.taxIncluded) return '';
    var parts = [];
    var rate = parseFloat(opt.rate) || 0, tr = parseFloat(opt.taxRate) || 0;
    if (rate > 0 && tr > 0) {
      var net = invCycRound2(rate / (1 + tr / 100));
      var gst = invCycRound2(rate - net);
      parts.push('Rate $' + rate.toFixed(2) + '/hour, tax included (net rate $' + net.toFixed(2) +
        '/hour + ' + invCycFmtH(tr) + '% GST of $' + gst.toFixed(2) + '/hour).');
    }
    cards = cards || {};
    var tv = null, uniform = true, anyTravel = false;
    Object.keys(cards).forEach(function (d) {
      var t = parseFloat(cards[d].travel) || 0;
      if (t > 0) {
        anyTravel = true;
        if (tv === null) tv = t; else if (tv !== t) uniform = false;
      }
    });
    if (anyTravel) {
      parts.push('Hours are the foreman ticket hours for each day plus ' +
        (uniform ? invCycFmtH(tv) + (tv === 1 ? ' hour' : ' hours') : 'the travel hours shown') +
        ' of travel per day worked.');
    }
    (lines || []).forEach(function (l) {
      var c = cards[l.date];
      if (!c || l.src !== 'dispatch' || !c.tickets.length) return;
      if (c.tickets.length === 1) {
        var t1 = c.tickets[0];
        if (!t1.num) return;
        parts.push(invCycDateShort(l.date) + ': haul card #' + t1.num + ' (foreman ' +
          invCycFmtH(t1.foreman) + 'h' + (c.travel > 0 ? ' + ' + invCycFmtH(c.travel) + 'h travel' : '') + ').');
      } else {
        var seg = [];
        c.tickets.forEach(function (t) { if (t.num) seg.push('haul card #' + t.num + ' (foreman ' + invCycFmtH(t.foreman) + 'h)'); });
        if (seg.length) parts.push(invCycDateShort(l.date) + ': ' + seg.join(', ') + (c.travel > 0 ? ' + ' + invCycFmtH(c.travel) + 'h travel.' : '.'));
      }
    });
    var th = 0;
    Object.keys(dayHours || {}).forEach(function (d) { th += parseFloat(dayHours[d]) || 0; });
    if (th > 0) parts.push('Total hours: ' + invCycFmtH(th) + '.');
    return parts.join(' ');
  }
  /* ================= INV-CYCLE-END ================= */

  /* ================= PAYROLL-CALC-BEGIN =================
     v122: the pay stub CALCULATES (owner, Oct 17: "It should do
     the deduction based on the tax code of the locality as well.
     That's the whole magic!"). The engine is CRA's own formula
     method — Guide T4127, Payroll Deductions Formulas, 122nd
     edition (effective Jan 1, 2026), Option 1 — for a REGULAR
     pay period, TD1 claim code 1 (basic amounts only), no
     year-to-date balances: the stub is an estimate built from
     this period's gross, and the honesty label printed on it
     says exactly that. Semi-monthly = P 24 (the app's cycle).
     Parameters are PER YEAR so a future year slots in as data;
     a year or province the table does not cover returns null
     and the form stays manual there — never a guessed number.

     2026 (canada.ca: T4127 Jan 2026 + T4032AB Jan 2026; the
     July 2026 T4127 edition confirms no federal/CPP/EI/Alberta
     change for Jul–Dec 2026):
       CPP  5.95% over (YMPE $74,600 − basic exemption $3,500),
            max $4,230.45; per-period exemption $145.83 at P=24
            (TRUNCATED $3,500/24, per T4127 Table 6.1).
       CPP2 4.00% on the band $74,600–$85,000 (YAMPE), max $416.
       EI   1.63%, MIE $68,900, max premium $1,123.07.
       Federal brackets + K constants; BPA $16,452 phasing out
            to $14,829 between $181,440 and $258,482; CEA $1,501.
       Alberta brackets + KP constants; BPA $22,769; NO Alberta
            CEA; K5P supplemental credit when K1P+K2P passes
            $4,896 (0.08 × the $61,200 first-bracket top).
     The CPP split, per T4127 Ch.4: the ENHANCED slice
     (1.00/5.95 of C, plus ALL of C2) is a DEDUCTION from income
     (F5, before annualizing); only the BASE slice (4.95/5.95
     of C) plus EI earns the K2 non-refundable credit, at the
     lowest rate of each jurisdiction. No double counting.
     Cross-checked to the cent against CRA's published T4032AB
     worked Examples B and C in tools/paystub-auto-test.js.
     Harness-extractable: pure JS, no store, no DOM. */
  var PS_YEARS = {
    2026: {
      cppRate: 0.0595, cppBaseRatio: 0.0495 / 0.0595, cppEnhRatio: 0.0100 / 0.0595,
      ympe: 74600, cppExemptYr: 3500, cppMax: 4230.45, cppBaseMax: 3519.45,
      cpp2Rate: 0.04, cpp2Max: 416,
      eiRate: 0.0163, eiMax: 1123.07,
      fedLow: 0.14,
      fedBrackets: [
        { to: 58523, r: 0.14, k: 0 }, { to: 117045, r: 0.205, k: 3804 },
        { to: 181440, r: 0.26, k: 10241 }, { to: 258482, r: 0.29, k: 15685 },
        { to: Infinity, r: 0.33, k: 26024 }
      ],
      bpaMax: 16452, bpaMin: 14829, bpaPhaseFrom: 181440, bpaPhaseTo: 258482,
      cea: 1501,
      prov: {
        AB: {
          low: 0.08,
          brackets: [
            { to: 61200, r: 0.08, k: 0 }, { to: 154259, r: 0.10, k: 1224 },
            { to: 185111, r: 0.12, k: 4309 }, { to: 246813, r: 0.13, k: 6160 },
            { to: 370220, r: 0.14, k: 8628 }, { to: Infinity, r: 0.15, k: 12331 }
          ],
          bpa: 22769, suppThreshold: 4896, suppRate: 0.25
        }
      }
    }
  };
  function psR2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function psBracket(brackets, A) {
    for (var i = 0; i < brackets.length; i++) { if (A <= brackets[i].to) return brackets[i]; }
    return brackets[brackets.length - 1];
  }
  /* psCalcDeductions(gross, opts) — one regular period.
     opts: { year, province (code), periods (default 24),
       f (per-period RPP/RRSP-type deductions at source),
       ytdCpp, ytdCpp2, ytdEi, ytdPensionable,
       tcFed, tcProv (TD1 total claims; default = the basic
       amounts, with the federal BPA phase-out applied) }.
     Returns { cpp, cpp2, ei, fedTax, provTax, tax, A, f5,
       fedAnnual, provAnnual, provSupported } — provTax null
     when the province is not covered — or null when the YEAR
     is not covered at all. fedAnnual/provAnnual are the T1/T2
     annual figures before the /P division (the values CRA's
     published worked examples state). */
  function psCalcDeductions(gross, opts) {
    opts = opts || {};
    var Y = PS_YEARS[opts.year || 2026];
    if (!Y) return null;
    var P = opts.periods || 24;
    var PV = Y.prov[String(opts.province || 'AB').toUpperCase()] || null;
    var I = parseFloat(gross) || 0;
    var zero = { cpp: 0, cpp2: 0, ei: 0, fedTax: 0, provTax: PV ? 0 : null, tax: 0, A: 0, f5: 0, fedAnnual: 0, provAnnual: PV ? 0 : null, provSupported: !!PV };
    if (!(I > 0)) return zero;
    var D = parseFloat(opts.ytdCpp) || 0, D2 = parseFloat(opts.ytdCpp2) || 0;
    var D1 = parseFloat(opts.ytdEi) || 0, PIYTD = parseFloat(opts.ytdPensionable) || 0;
    var F = parseFloat(opts.f) || 0;
    /* CPP (T4127 Ch.6): C = min(annual max − YTD, rate ×
       (PI − exemption/P)); the per-period exemption is the
       annual $3,500 / P TRUNCATED to cents (Table 6.1). */
    var exempt = Math.floor(Y.cppExemptYr / P * 100) / 100;
    var C = psR2(Math.max(0, Math.min(Y.cppMax - D, Y.cppRate * (I - exempt))));
    /* CPP2 (Ch.6): 4% of cumulative pensionable earnings over
       the YMPE — W = max(PIYTD, YMPE) — capped at the CPP2 max. */
    var W = Math.max(PIYTD, Y.ympe);
    var C2 = psR2(Math.max(0, Math.min(Y.cpp2Max - D2, (PIYTD + I - W) * Y.cpp2Rate)));
    /* EI (Ch.7): rate × insurable earnings, capped at the max. */
    var EI = psR2(Math.max(0, Math.min(Y.eiMax - D1, Y.eiRate * I)));
    /* F5: the enhanced CPP slice is deducted from income BEFORE
       annualizing (Ch.4 Step 1). A = P × (I − F − F5). */
    var enhSlice = psR2(C * Y.cppEnhRatio);
    var F5 = psR2(enhSlice + C2);
    var A = psR2(P * (I - F - F5));
    if (A < 0) A = 0;
    /* The K2 credit base: the BASE CPP slice only. CRA's own
       step-by-step arithmetic (T4032AB Example B) takes the base
       as C − enhanced slice, annualized; once the annual max is
       reached the maximum itself is substituted (Example C) —
       hence the max of the annualized and the YTD-based figure,
       capped at the base maximum. Same shape for EI. */
    var basePer = psR2(C - enhSlice);
    var baseAnnual = Math.min(Y.cppBaseMax, Math.max(P * basePer, (D + C) * Y.cppBaseRatio));
    var eiAnnual = Math.min(Y.eiMax, Math.max(P * EI, D1 + EI));
    /* Federal (Ch.4): T3 = R×A − K − K1 − K2 − K4, floored at 0.
       TC defaults to the BPA WITH its phase-out on NI (= A). */
    var bpaf = Y.bpaMax;
    if (A > Y.bpaPhaseFrom && A < Y.bpaPhaseTo) {
      bpaf = psR2(Y.bpaMax - (A - Y.bpaPhaseFrom) * ((Y.bpaMax - Y.bpaMin) / (Y.bpaPhaseTo - Y.bpaPhaseFrom)));
    } else if (A >= Y.bpaPhaseTo) bpaf = Y.bpaMin;
    var TC = (opts.tcFed === undefined || opts.tcFed === null) ? bpaf : (parseFloat(opts.tcFed) || 0);
    var fb = psBracket(Y.fedBrackets, A);
    var K1 = Y.fedLow * TC;
    var K2 = Y.fedLow * (baseAnnual + eiAnnual);
    var K4 = Math.min(Y.fedLow * (P * I), Y.fedLow * Y.cea);
    var T3 = Math.max(0, fb.r * A - fb.k - K1 - K2 - K4);
    var fedTax = psR2(T3 / P);
    /* Provincial: T4 mirrors T3 with the province's own rates,
       constants, BPA and lowest rate; Alberta adds the K5P
       supplemental credit and has NO CEA (K4P = 0). */
    var provTax = null, T4 = null;
    if (PV) {
      var TCP = (opts.tcProv === undefined || opts.tcProv === null) ? PV.bpa : (parseFloat(opts.tcProv) || 0);
      var pb = psBracket(PV.brackets, A);
      var K1P = PV.low * TCP;
      var K2P = PV.low * (baseAnnual + eiAnnual);
      var K5P = Math.max(0, (K1P + K2P - PV.suppThreshold) * PV.suppRate);
      T4 = Math.max(0, pb.r * A - pb.k - K1P - K2P - K5P);
      provTax = psR2(T4 / P);
    }
    return {
      cpp: C, cpp2: C2, ei: EI,
      fedTax: fedTax, provTax: provTax,
      tax: psR2(fedTax + (provTax || 0)),
      A: A, f5: F5,
      fedAnnual: psR2(T3), provAnnual: (T4 === null ? null : psR2(T4)),
      provSupported: !!PV
    };
  }
  /* ================= PAYROLL-CALC-END ================= */

  /* The line plan for a period: the grouped lines plus the days
     that block issuing and the tracker-only days to flag. The
     grouping/source rules live in invCycBuildRevenueLines
     (INV-CYCLE region, suite-tested). */
  function revenueLinePlan(a, b) {
    var o = onb();
    var entries = App._store.get('rev_entries', []).filter(function (e) { return e.date >= a && e.date <= b; });
    var extras = App._store.get('rev_extras', []).filter(function (x) { return x.date >= a && x.date <= b; });
    /* v137: priced at the user's OWN wage rate (ownWageRate ||
       payRate — the same chain the pay stub uses), never a
       universal Preferences "Rate": that field is gone, and each
       driver's rates live in their own books / P&L entry. For a
       setup that never split the rates this is the same number
       as before, byte for byte. */
    return invCycBuildRevenueLines(entries, extras, psWageRate(o), o.payStandard);
  }

  /* lines from revenue entries + extras inside a period, using pay standard */
  function revenueLines(a, b) { return revenueLinePlan(a, b).lines; }

  /* v107 fold-in (invoice fact-check, Oct 16): the banner's job is
     to stop the app GUESSING at tax. When saved Preferences already
     determine the tax treatment outright — the rate-includes-tax
     switch is ON and a tax rate is set — the invoice's tax is not
     a guess, and demanding a location for it is a false warning
     that can never clear (the owner's province sat unset in the
     cloud while his invoice correctly carried 5% inside $319.00).
     The invoice form passes forInvoice=true and is excused in that
     case; payroll keeps the strict rule (pay rules genuinely do
     depend on jurisdiction). */
  function taxDeterminedByPrefs(o) {
    return !!(o && o.rateIncludesTax && parseFloat(o.invoiceTaxRate) > 0);
  }
  function jurisdictionBanner(forInvoice) {
    var o = onb();
    if (o.country && o.province) return '';
    if (forInvoice && taxDeterminedByPrefs(o)) return '';
    return '<div class="card" style="border-left:4px solid #d23b3b">' +
      '<h3>⚠️ Set your location first</h3>' +
      '<p class="note">Tax and payroll rules depend on your country and province/state. ' +
      'Add them in Preferences before creating invoices or pay stubs — the app will not guess for you.</p>' +
      '<button class="btn navy small" id="iv_goprefs">Open Preferences</button></div>';
  }

  function printDoc(title, bodyHtml) {
    /* v69: in the Android shell this popup path is doubly dead —
       window.open('_blank') goes nowhere in the bare Capacitor
       WebView and w.print() is a silent no-op there (no print
       bridge) — the same flaw that killed the Manifest buttons.
       In the shell, build a real PDF from the same document and
       save it to the device Documents folder instead (js/pdfexport.js);
       the browser path below is unchanged. Covers invoices AND pay
       stubs, which share this function. */
    if (window.MetPdf && MetPdf.isNativeShell()) {
      var fname = String(title || 'document').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '.pdf';
      MetPdf.savePdf({ title: title, lines: MetPdf.htmlToLines(bodyHtml) }, fname).then(function (r) {
        alert(r.message);
      }, function () {
        alert('The PDF could not be saved. Try again.');
      });
      return;
    }
    var w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { alert('Pop-up blocked — allow pop-ups to print.'); return; }
    w.document.write('<!DOCTYPE html><html><head><title>' + esc(title) + '</title><style>' +
      'body{font-family:Arial,Helvetica,sans-serif;color:#1a2340;max-width:720px;margin:24px auto;padding:0 16px;}' +
      'h1{color:#1F3764;margin:0 0 4px;}h2{color:#1F3764;border-bottom:3px solid #F26522;padding-bottom:6px;}' +
      'table{width:100%;border-collapse:collapse;margin:14px 0;}' +
      'th{background:#1F3764;color:#fff;text-align:left;padding:8px;}td{padding:8px;border-bottom:1px solid #dfe4f2;}' +
      '.tot{text-align:right;font-weight:700;}.muted{color:#6b7690;font-size:13px;}' +
      '.row{display:flex;justify-content:space-between;margin:4px 0;}' +
      /* v122: the printed structure the owner asked for (his old
         invoice #1150's STRUCTURE — header band, ruled sections,
         a totals block, a prepared-by footer). */
      '.band{background:#1F3764;color:#fff;padding:14px 18px;border-radius:4px;margin-bottom:14px;}' +
      '.band h1{color:#fff;margin:0 0 2px;}.band p{margin:2px 0;color:#c9d4ee;font-size:13px;}' +
      '.sec{color:#1F3764;border-bottom:2px solid #F26522;padding-bottom:4px;margin:20px 0 8px;font-size:16px;}' +
      '.billto{margin:4px 0 6px;line-height:1.55;}' +
      '.totblock{margin-top:16px;border-top:3px solid #1F3764;padding-top:8px;}' +
      '.foot{margin-top:26px;border-top:1px solid #dfe4f2;padding-top:8px;}' +
      '</style></head><body>' + bodyHtml + '</body></html>');
    w.document.close(); w.focus();
    setTimeout(function () { w.print(); }, 400);
  }

  /* v118 (extracted from renderInvoice; the v105 heal grew the
     case-variant rule): an UNTOUCHED draft Bill-to — the saved
     contracting company exactly, or the same words in any casing,
     with or without the saved address after them — is replaced
     by the saved name + address VERBATIM ("AI Trucking", never
     "Ai trucking"). A genuinely different hand-typed Bill-to is
     never rewritten. */
  function invBillToHeal(draft, o) {
    if (!draft || !o || !o.contractingCo || !draft.billTo) return draft;
    if (draft.billTo === o.contractingCo) {
      if (o.contractingAddr) draft.billTo = o.contractingCo + ', ' + o.contractingAddr;
      return draft;
    }
    var coLow = String(o.contractingCo).trim().toLowerCase();
    var btLow = String(draft.billTo).trim().toLowerCase();
    var coAddrLow = coLow + ', ' + String(o.contractingAddr || '').trim().toLowerCase();
    if (btLow === coLow || (o.contractingAddr && btLow === coAddrLow)) {
      draft.billTo = o.contractingCo + (o.contractingAddr ? ', ' + o.contractingAddr : '');
    }
    return draft;
  }

  /* ---------------- contractor invoice ---------------- */
  function renderInvoice(body) {
    var o = onb();
    var draft = S('draft', null) || {
      items: [], taxRate: defaultTaxRate(o),
      billTo: o.contractingCo ? (o.contractingCo + (o.contractingAddr ? ', ' + o.contractingAddr : '')) : '',
      no: null, date: App._today(), notes: ''
    };
    /* v105: a draft still carrying the untouched default Bill-to
       (just the contracting company's name) picks up the company's
       address from Preferences, so the printed invoice bills the
       full name + address the way the owner sends it. A Bill-to he
       edited himself is never rewritten. v118: the heal lives in
       invBillToHeal (below) — "untouched" also covers a
       CASE-VARIANT of the saved company ("Ai trucking" frozen in
       a draft by an early keyboard), which the exact-equality
       rule never healed, so the printed invoice billed the wrong
       casing forever while Preferences holds "AI Trucking". */
    invBillToHeal(draft, o);
    /* Legacy drafts (pre-v55) could hold the placeholder text as the
       # value — it is not a number; treat it as empty. */
    if (draft.no === '(auto on save)') draft.no = null;
    /* v79: the form's # is the user's own sequence — the Preferences
       "Next invoice number" fills an empty draft number. */
    if (!draft.no && o.nextInvoiceNo) draft.no = String(o.nextInvoiceNo);
    /* v79: tax settings come from Preferences (Company card). In
       tax-inclusive mode the rate defaults to 5% when Preferences
       carries no rate; add-on mode keeps the draft's own rate. */
    var taxIncluded = !!o.rateIncludesTax;
    var prefTaxRate = parseFloat(o.invoiceTaxRate);
    if (isFinite(prefTaxRate) && taxIncluded) draft.taxRate = prefTaxRate;
    else if (taxIncluded) draft.taxRate = 5;
    var bizPromptVisible = false;
    /* v134: the settled-outside door's two-step state (the house
       two-tap pattern — no native confirm in the WebView) and the
       issued list's remove-confirm target. Closure state, like
       bizPromptVisible: it lives for this render of the module. */
    var settleConfirm = false, settleVals = null, unsettleId = null;
    function saveDraft() { W('draft', draft); }
    /* A stable draft id, so the business-details check (below) nags
       at most once per invoice, never once per render. */
    if (!draft.id) { draft.id = 'draft' + Date.now(); saveDraft(); }

    function totals(lines) {
      var sub = 0;
      lines.forEach(function (l) { sub += l.amt; });
      draft.items.forEach(function (it) { sub += (Number(it.qty) || 0) * (Number(it.rate) || 0); });
      return invCycTotals(sub, draft.taxRate, taxIncluded);
    }

    function draw() {
      var openP = invCycOpenPeriod(invoices(), App._today());
      var pa = S('pa', null), pb = S('pb', null);
      if (!pa || !pb) { pa = openP.a; pb = openP.b; }
      var revPlan = revenueLinePlan(pa, pb);
      var revLines = revPlan.lines;
      var t = totals(revLines);
      var h = jurisdictionBanner(true);
      var cycMsg = S('cycmsg', ''); if (cycMsg) W('cycmsg', '');
      var errMsg = S('err', ''); if (errMsg) W('err', '');
      if (cycMsg) h += '<div class="card" style="border-left:4px solid #2e9e5b"><p class="note" style="margin:0">✅ ' + esc(cycMsg) + '</p></div>';
      if (errMsg) h += '<div class="card" style="border-left:4px solid #d23b3b"><p class="note" style="margin:0">⚠️ ' + esc(errMsg) + '</p></div>';
      h += '<div class="card"><h3>🧾 New invoice</h3>' +
        '<p class="note">Current period: <b>' + esc(invCycLabel(openP)) + '</b></p>' +
        '<div class="row"><div><label class="f">Period from</label><input type="date" id="iv_a" value="' + esc(pa) + '"></div>' +
        '<div><label class="f">Period to</label><input type="date" id="iv_b" value="' + esc(pb) + '"></div></div>' +
        '<div class="row"><div><label class="f">Invoice #</label><input id="iv_no" value="' + esc(draft.no || '') + '" placeholder="(auto on save)"></div>' +
        '<div><label class="f">Date</label><input type="date" id="iv_date" value="' + esc(draft.date) + '"></div></div>' +
        '<label class="f">Bill to</label><input id="iv_billto" value="' + esc(draft.billTo) + '" placeholder="Contracting company">' +
        (taxIncluded
          ? '<p class="note">Your rate already includes tax: <b>' + esc(draft.taxRate) + '% GST</b>. ' +
            'The tax part is shown on the invoice — it is not added on top. Change this in Preferences → Company.</p></div>'
          : '<label class="f">Tax rate % (GST/HST)</label><input id="iv_tax" type="number" step="0.01" min="0" value="' + esc(draft.taxRate) + '">' +
            '<p class="note">Prefilled from your province. Change it if your situation differs.</p></div>');

      h += '<div class="card"><h3>Line items</h3>';
      if (revLines.length) {
        h += '<p class="note">From revenue (' + esc(pa) + ' → ' + esc(pb) + '):</p>';
        revLines.forEach(function (l) {
          /* v105: revenue day lines read in the owner's hour-sheet
             shape ("Oct 16: 11h") — the same words the printed
             invoice carries. Extras keep their own descriptions. */
          var lbl = l.src === 'extra' ? l.desc : (invCycLineLabel(l, revPlan.dayHours) || l.desc);
          h += '<div class="kv"><span>' + esc(lbl) +
            (l.unconfirmed ? ' <span style="color:#b97a0f">— from tracker — unconfirmed</span>' : '') +
            '</span><b>$' + l.amt.toFixed(2) + '</b></div>';
        });
      } else if (!revPlan.duplicateDates.length) {
        h += '<p class="note">No revenue entries in this period. Add items manually:</p>';
      }
      if (revPlan.duplicateDates.length) {
        h += '<p class="note" style="color:#c0392b">⛔ Saving is blocked: ' +
          revPlan.duplicateDates.map(function (d) { return esc(invCycDateShort(d)); }).join(', ') +
          (revPlan.duplicateDates.length === 1 ? ' still has' : ' still have') +
          ' more than one tracker entry and no dispatch completion to confirm the day. Fix that day in Revenue first.</p>';
      }
      draft.items.forEach(function (it, i) {
        h += '<div class="kv"><span>' + esc(it.desc) + ' × ' + esc(it.qty) + ' @ $' + Number(it.rate).toFixed(2) + '</span>' +
          '<span><b>$' + ((Number(it.qty) || 0) * (Number(it.rate) || 0)).toFixed(2) + '</b> ' +
          '<a href="#" data-mdel="' + i + '" style="color:#d23b3b">✕</a></span></div>';
      });
      h += '<div class="row"><div><label class="f">Description</label><input id="iv_idesc" placeholder="e.g. Gravel haul"></div></div>' +
        '<div class="row"><div><label class="f">Qty</label><input id="iv_iqty" type="number" step="any" value="1"></div>' +
        '<div><label class="f">Rate $</label><input id="iv_irate" type="number" step="0.01" placeholder="0.00"></div></div>' +
        '<button class="btn navy small" id="iv_additem">Add line item</button>' +
        '<label class="f">Notes</label><textarea id="iv_notes" placeholder="Payment terms...">' + esc(draft.notes) + '</textarea></div>';

      h += '<div class="card"><h3>Totals</h3>' +
        '<div class="kv"><span>Subtotal</span><b>$' + t.sub.toFixed(2) + '</b></div>' +
        '<div class="kv"><span>' + (taxIncluded
          ? 'Tax (' + esc(draft.taxRate) + '% GST, included in the rate)'
          : 'Tax (' + esc(draft.taxRate) + '%)') + '</span><b>$' + t.tax.toFixed(2) + '</b></div>' +
        (taxIncluded ? '<p class="note">That tax amount is already inside the subtotal — it is not added again.</p>' : '') +
        '<div class="kv" style="font-size:17px"><span><b>Total due</b></span><b>$' + t.total.toFixed(2) + '</b></div></div>';

      if (bizPromptVisible) {
        h += '<div class="card" style="border-left:4px solid #b97a0f"><h3>One check before printing</h3>' +
          '<p class="note">Your business name/address/GST aren\'t set — the printed invoice will miss them. ' +
          'Set them in Preferences → Your business.</p>' +
          '<div class="row"><button class="btn navy" id="iv_biz_prefs" style="margin:0">Set them now</button>' +
          '<button class="btn ghost" id="iv_biz_print" style="margin:0">Print anyway</button></div></div>';
      }

      h += '<button class="btn primary" id="iv_issue">Save &amp; print invoice</button>';
      /* v134: a LOOK costs nothing — preview prints the draft
         with its would-be number and touches no record, no
         counter, no draft (see invCycWouldBeNo). */
      h += '<button class="btn ghost" id="iv_preview" style="margin-top:8px">🖨 Print preview — doesn\'t save</button>';
      h += issuedHtml();
      h += settleHtml();
      body.innerHTML = h;
      wireInvoice(body, draft, revLines, t, saveDraft, draw, revPlan);
    }

    /* v134: the MARK-SETTLED door — quiet, under the issued list.
       For a period the owner settled OUTSIDE the app (his Oct
       1–15, 2026: hand-built invoice #1151, sent by him): record
       the period + the number he used, and the app stops offering
       that period as open. Confirm-first (two-step, in-page); the
       amounts are never asked — the door records no money. */
    function settleHtml() {
      var openP = invCycOpenPeriod(invoices(), App._today());
      var sv = settleVals || { a: openP.a, b: openP.b, no: '' };
      var h = '<div class="card"><h3>Settled outside the app?</h3>' +
        '<p class="note">If you already invoiced a period another way — a sheet you made yourself, for example — ' +
        'record it here so the app stops offering that period. Just the period and the invoice number you used; ' +
        'no amounts are recorded. You can remove the record later and the period opens again.</p>';
      if (!settleConfirm) {
        h += '<div class="row"><div><label class="f">Period from</label><input type="date" id="iv_settle_a" value="' + esc(sv.a || '') + '"></div>' +
          '<div><label class="f">Period to</label><input type="date" id="iv_settle_b" value="' + esc(sv.b || '') + '"></div></div>' +
          '<label class="f">Invoice # used outside the app</label><input id="iv_settle_no" value="' + esc(sv.no || '') + '" placeholder="e.g. 1151">' +
          '<button class="btn navy small" id="iv_settle_go" style="margin-top:8px">Record as settled</button>';
      } else {
        h += '<p class="note" style="color:#c0392b">Record <b>' + esc(invCycLabel({ a: sv.a, b: sv.b })) + '</b> as settled with invoice <b>#' +
          esc(sv.no) + '</b>? The period stops being offered as open. No amounts are recorded, and you can undo this.</p>' +
          '<div class="row"><button class="btn primary" id="iv_settle_yes" style="margin:0">Yes, record it</button>' +
          '<button class="btn ghost" id="iv_settle_no_btn" style="margin:0">Cancel</button></div>';
      }
      return h + '</div>';
    }

    function issuedHtml() {
      var list = invoices();
      var h = '<div class="card"><h3>📁 Issued invoices</h3>';
      if (!list.length) return h + '<div class="empty">No invoices yet.</div></div>';
      list.slice().reverse().slice(0, 10).forEach(function (r) {
        /* v134: a settled-outside record carries NO money (its
           totals are null by design) — it renders as the fact it
           is, with a remove door instead of a print door. */
        if (r.settledOutside) {
          h += '<div class="kv"><span>#' + esc(r.no) + ' <span class="note">' +
            esc(invCycLabel({ a: r.pa, b: r.pb })) + ' · settled outside the app</span></span>' +
            '<span><a href="#" data-unsettle="' + r.id + '" style="color:#d23b3b">remove</a></span></div>';
          if (unsettleId === r.id) {
            h += '<div class="note" style="color:#c0392b;margin:2px 0 8px">Remove this record? ' +
              esc(invCycLabel({ a: r.pa, b: r.pb })) + ' will open again. ' +
              '<a href="#" data-unsettle-yes="' + r.id + '" style="color:#d23b3b"><b>Yes, remove it</b></a> · ' +
              '<a href="#" data-unsettle-no="">keep it</a></div>';
          }
          return;
        }
        h += '<div class="kv"><span>#' + esc(r.no) + ' <span class="note">' + esc(r.date) + '</span></span>' +
          '<span><b>$' + r.total.toFixed(2) + '</b> <a href="#" data-reprint="' + r.id + '" style="color:var(--navy)">print</a></span></div>';
      });
      return h + '</div>';
    }

    function wireInvoice(body, draft, revLines, t, saveDraft, draw, revPlan) {
      var gp = body.querySelector('#iv_goprefs');
      if (gp) gp.onclick = function () { App.openModule('preferences'); };
      function sync() {
        draft.no = body.querySelector('#iv_no').value.trim();
        draft.date = body.querySelector('#iv_date').value;
        draft.billTo = body.querySelector('#iv_billto').value.trim();
        var taxNode = body.querySelector('#iv_tax');
        if (taxNode) draft.taxRate = taxNode.value;
        draft.notes = body.querySelector('#iv_notes').value;
        W('pa', body.querySelector('#iv_a').value); W('pb', body.querySelector('#iv_b').value);
        saveDraft();
      }
      ['iv_no', 'iv_date', 'iv_billto', 'iv_tax', 'iv_notes', 'iv_a', 'iv_b'].forEach(function (id) {
        var n = body.querySelector('#' + id);
        if (n) n.addEventListener('change', function () { sync(); draw(); });
      });
      body.querySelector('#iv_additem').onclick = function () {
        var d = body.querySelector('#iv_idesc').value.trim();
        var q = Number(body.querySelector('#iv_iqty').value) || 0;
        var r = Number(body.querySelector('#iv_irate').value) || 0;
        if (!d || !(q > 0) || !(r > 0)) { alert('Enter a description, quantity and rate.'); return; }
        draft.items.push({ desc: d, qty: q, rate: r });
        sync(); saveDraft(); draw();
      };
      body.querySelectorAll('[data-mdel]').forEach(function (a) {
        a.onclick = function (e) { e.preventDefault(); draft.items.splice(+a.getAttribute('data-mdel'), 1); saveDraft(); draw(); };
      });
      function bizWarnedForThisDraft() {
        var seen = S('bizwarn', {});
        return !!(draft.id && seen && seen[draft.id]);
      }
      function markBizWarned() {
        if (!draft.id) return;
        var seen = S('bizwarn', {}) || {};
        seen[draft.id] = true;
        W('bizwarn', seen);
      }
      function attemptIssue(fromPrompt) {
        sync();
        if (t.sub <= 0) { alert('Add at least one line item first.'); return; }
        /* v79: business-details check — one plain prompt per draft
           when the company name is empty. "Print anyway" proceeds and
           never nags again for THIS invoice; it never blocks forever. */
        if (!fromPrompt && invCycCompanyMissing({ name: o.companyName }) && !bizWarnedForThisDraft()) {
          bizPromptVisible = true;
          draw();
          return;
        }
        /* v55: verified issue + rollover lives in invIssue (INV-CYCLE
           region). A failed or refused save keeps the draft exactly as
           it is and prints nothing; only a verified save archives the
           invoice, clears the draft, advances the period, and prints. */
        var paV = body.querySelector('#iv_a').value, pbV = body.querySelector('#iv_b').value;
        var res = invIssue({
          draft: draft, revLines: revLines, sub: t.sub, tax: t.tax, total: t.total,
          pa: paV, pb: pbV,
          today: App._today(),
          prefNo: o.nextInvoiceNo || '', taxIncluded: taxIncluded,
          duplicateDates: (revPlan && revPlan.duplicateDates) || [],
          /* v105: the facts the printed document is built from —
             winning hours per day, the period's haul cards, and
             the rate in force — archived on the record itself. */
          dayHours: (revPlan && revPlan.dayHours) || null,
          cardDays: invCycCardDays(App._store.get('rev_entries', []), App._store.get('dsp_list', []),
            (revPlan && revPlan.dayHours) || {}, paV, pbV),
          rate: psWageRate(o), // v137: the rate in force = the user's own wage chain
          truckNo: o.truckNo || '',
          setNextInvoiceNo: function (next) {
            try {
              var oo = App._store.get('onboarding', {});
              oo.nextInvoiceNo = next;
              App._store.set('onboarding', oo);
            } catch (e) {}
          },
          company: { name: o.companyName, gst: o.gst, addr: o.companyAddr },
          province: o.province, country: o.country
        });
        if (!res.ok) {
          W('err', res.message);
          Meticulous.modules.invoice.render(body);
          return;
        }
        if (window.FB && FB.saveDoc) FB.saveDoc('invoices', res.rec.no, { no: res.rec.no, date: res.rec.date, total: res.rec.total });
        printInvoice(res.rec);
        Meticulous.modules.invoice.render(body);
      }
      body.querySelector('#iv_issue').onclick = function () { attemptIssue(false); };
      /* v134: PREVIEW — print the draft's face without issuing.
         Builds the same record shape printInvoice consumes from
         the draft's current facts, carrying the WOULD-BE number
         only. It never calls invIssue, never writes the list,
         never advances onboarding.nextInvoiceNo, and leaves the
         draft exactly as sync() saved it. Re-printing an ISSUED
         invoice (data-reprint below) already reprints the archived
         record with its own number — unchanged. */
      var previewBtn = body.querySelector('#iv_preview');
      if (previewBtn) previewBtn.onclick = function () {
        sync();
        var paV = body.querySelector('#iv_a').value, pbV = body.querySelector('#iv_b').value;
        printInvoice({
          id: null,
          no: invCycWouldBeNo(invoices(), draft.no, o.nextInvoiceNo || ''),
          date: draft.date, billTo: draft.billTo, pa: paV, pb: pbV,
          revLines: revLines, items: (draft.items || []).slice(),
          taxRate: Number(draft.taxRate) || 0, taxIncluded: taxIncluded,
          sub: t.sub, tax: t.tax, total: t.total,
          dayHours: (revPlan && revPlan.dayHours) || null,
          cardDays: invCycCardDays(App._store.get('rev_entries', []), App._store.get('dsp_list', []),
            (revPlan && revPlan.dayHours) || {}, paV, pbV),
          rate: psWageRate(o), // v137: same wage chain as the issued record
          truckNo: o.truckNo || '',
          notes: draft.notes,
          company: { name: o.companyName, gst: o.gst, addr: o.companyAddr },
          province: o.province, country: o.country
        });
      };
      /* v134: the settled-outside door — two steps, in-page. */
      var settleGo = body.querySelector('#iv_settle_go');
      if (settleGo) settleGo.onclick = function () {
        settleVals = {
          a: body.querySelector('#iv_settle_a').value,
          b: body.querySelector('#iv_settle_b').value,
          no: body.querySelector('#iv_settle_no').value.trim()
        };
        settleConfirm = true;
        draw();
      };
      var settleYes = body.querySelector('#iv_settle_yes');
      if (settleYes) settleYes.onclick = function () {
        var res = invCycMarkSettled({
          pa: settleVals.a, pb: settleVals.b, externalNo: settleVals.no,
          today: App._today(),
          company: { name: o.companyName, gst: o.gst, addr: o.companyAddr },
          province: o.province, country: o.country
        });
        settleConfirm = false; settleVals = null;
        if (!res.ok) W('err', res.message);
        Meticulous.modules.invoice.render(body);
      };
      var settleNoBtn = body.querySelector('#iv_settle_no_btn');
      if (settleNoBtn) settleNoBtn.onclick = function () { settleConfirm = false; draw(); };
      body.querySelectorAll('[data-unsettle]').forEach(function (a) {
        a.onclick = function (e) { e.preventDefault(); unsettleId = a.getAttribute('data-unsettle'); draw(); };
      });
      body.querySelectorAll('[data-unsettle-yes]').forEach(function (a) {
        a.onclick = function (e) {
          e.preventDefault();
          var res = invCycRemoveSettled(a.getAttribute('data-unsettle-yes'), App._today());
          unsettleId = null;
          if (!res.ok) W('err', res.message);
          Meticulous.modules.invoice.render(body);
        };
      });
      body.querySelectorAll('[data-unsettle-no]').forEach(function (a) {
        a.onclick = function (e) { e.preventDefault(); unsettleId = null; draw(); };
      });
      var bizPrefsBtn = body.querySelector('#iv_biz_prefs');
      if (bizPrefsBtn) bizPrefsBtn.onclick = function () { App.openModule('preferences'); };
      var bizPrintBtn = body.querySelector('#iv_biz_print');
      if (bizPrintBtn) bizPrintBtn.onclick = function () {
        markBizWarned();
        bizPromptVisible = false;
        attemptIssue(true);
      };
      body.querySelectorAll('[data-reprint]').forEach(function (a) {
        a.onclick = function (e) {
          e.preventDefault();
          var id = a.getAttribute('data-reprint');
          invoices().forEach(function (r) { if (r.id === id) printInvoice(r); });
        };
      });
    }

    function printInvoice(rec) {
      /* v122: the STRUCTURE the owner specified (Oct 17, modeled
         on his old invoice #1150 — structure, not its look):
         header band (business name + address); invoice # + date;
         a pay-period line; the Bill-to block (name, address,
         truck number when known) with clear space after it; the
         hours as their OWN section — a ruled table Description |
         Rate | Hours | Amount with one row per day; the notes as
         a separate section; a totals block — Net subtotal | GST
         (GST number printed) | Total due | Paid amount | Balance
         owing; and a "Prepared by" footer with the invoice
         number + page. Tax-INCLUSIVE law stands: Total due is
         hours × rate exactly; the Net subtotal is the total with
         the included GST backed out, and the GST line is that
         included portion — nothing is added on top. */
      var o = onb();
      var bizName = (rec.company && rec.company.name) || '';
      var truckNo = rec.truckNo || o.truckNo || '';
      var rows = '';
      (rec.revLines || []).forEach(function (l) {
        var hrs = (rec.dayHours && l.date) ? parseFloat(rec.dayHours[l.date]) : NaN;
        var isDay = l.src !== 'extra' && isFinite(hrs) && hrs > 0;
        /* Day rows read "Oct 1" in the Description column (the
           owner's #1150 shape); extras and hour-less lines keep
           their stored descriptions (the v105 hour-sheet label
           remains the fallback). */
        var label = l.src === 'extra' ? (l.desc || '')
          : isDay ? invCycDateShort(l.date)
          : (invCycLineLabel(l, rec.dayHours) || l.desc || '');
        var rateTxt = isDay && rec.rate ? '$' + Number(rec.rate).toFixed(2) + (rec.taxIncluded ? ' tax incl.' : '') : '—';
        rows += '<tr><td>' + esc(label) + '</td><td>' + esc(rateTxt) + '</td>' +
          '<td>' + (isDay ? invCycFmtH(hrs) : '—') + '</td>' +
          '<td class="tot">$' + (Number(l.amt) || 0).toFixed(2) + '</td></tr>';
      });
      (rec.items || []).forEach(function (it) {
        rows += '<tr><td>' + esc(it.desc) + ' × ' + esc(it.qty) + ' @ $' + Number(it.rate).toFixed(2) + '</td>' +
          '<td>—</td><td>—</td>' +
          '<td class="tot">$' + ((Number(it.qty) || 0) * (Number(it.rate) || 0)).toFixed(2) + '</td></tr>';
      });
      /* v105: the closing note is GENERATED from the record's own
         facts (rate, tax mode, haul cards, total hours) in the
         exact shape of the invoice the owner sent (#1151). Records
         issued before v105 carry no cardDays — rebuild them from
         the live stores on a best-effort basis. His own typed
         notes, when he wrote any, follow the generated note. */
      var cardDays = rec.cardDays;
      if (!cardDays && rec.dayHours) {
        try {
          cardDays = invCycCardDays(App._store.get('rev_entries', []), App._store.get('dsp_list', []), rec.dayHours, rec.pa, rec.pb);
        } catch (e) { cardDays = null; }
      }
      var genNote = invCycDocNote(rec.revLines || [], rec.dayHours, cardDays,
        { rate: rec.rate, taxRate: rec.taxRate, taxIncluded: rec.taxIncluded });
      var noteText = [genNote, String(rec.notes || '').trim()].filter(Boolean).join(' ');
      /* The Bill-to block: name on its own line, address under it,
         truck number when known — the stored Bill-to is the saved
         "Name, Address" string, split on its first comma. */
      var btParts = String(rec.billTo || '').split(',');
      var btName = (btParts.shift() || '').trim();
      var btAddr = btParts.join(',').trim();
      var netSub = rec.taxIncluded ? invCycRound2((Number(rec.sub) || 0) - (Number(rec.tax) || 0)) : (Number(rec.sub) || 0);
      var gstLabel = 'GST (' + esc(rec.taxRate) + '%' + (rec.taxIncluded ? ', included in the rate' : '') + ')' +
        ((rec.company && rec.company.gst) ? ' — GST/HST ' + esc(rec.company.gst) : '');
      var paid = invCycPaidTotal(rec);
      var balance = invCycRound2((Number(rec.total) || 0) - paid);
      printDoc('Invoice ' + rec.no,
        '<div class="band"><h1>' + esc(bizName || 'Invoice') + '</h1>' +
        '<p>' + esc((rec.company && rec.company.addr) || '').replace(/\n/g, '<br>') + '</p></div>' +
        '<h2>INVOICE #' + esc(rec.no) + '</h2>' +
        '<div class="row"><span><b>Date:</b> ' + esc(rec.date) + '</span>' +
        ((rec.pa && rec.pb) ? '<span><b>Pay period:</b> ' + esc(invCycLabel({ a: rec.pa, b: rec.pb })) + '</span>' : '') + '</div>' +
        '<h3 class="sec">Bill to</h3>' +
        '<div class="billto"><b>' + esc(btName || '—') + '</b>' +
        (btAddr ? '<br>' + esc(btAddr) : '') +
        (truckNo ? '<br>Truck #' + esc(truckNo) : '') + '</div>' +
        '<h3 class="sec">Hours</h3>' +
        '<table><tr><th>Description</th><th>Rate</th><th>Hours</th><th style="text-align:right">Amount</th></tr>' + rows + '</table>' +
        (noteText ? '<h3 class="sec">Notes</h3><p class="muted">' + esc(noteText) + '</p>' : '') +
        '<div class="totblock">' +
        '<div class="row"><span>Net subtotal</span><span>$' + netSub.toFixed(2) + '</span></div>' +
        '<div class="row"><span>' + gstLabel + '</span><span>$' + (Number(rec.tax) || 0).toFixed(2) + '</span></div>' +
        '<div class="row" style="font-size:18px"><span><b>Total due</b></span><span><b>$' + (Number(rec.total) || 0).toFixed(2) + '</b></span></div>' +
        '<div class="row"><span>Paid amount</span><span>$' + paid.toFixed(2) + '</span></div>' +
        '<div class="row"><span><b>Balance owing</b></span><span><b>$' + balance.toFixed(2) + '</b></span></div>' +
        '</div>' +
        '<p class="muted foot">Prepared by ' + esc(bizName || '—') + ' · Invoice ' + esc(rec.no) + ' · Page 1</p>');
    }

    draw();
  }

  /* ---------------- payroll pay stub ----------------
     v122: THE STUB BUILDS ITSELF (owner, Oct 17: "That's the
     whole magic!"). The period opens on the current open
     semi-monthly cycle; the gross is PRE-FILLED from the
     period's completed work through the SAME per-day builder
     Revenue/P&L/invoice use — priced at the driver's OWN wage
     rate (Preferences "My wage rate", falling back to the
     general rate) — with the hours shown; CPP/CPP2, EI and
     federal + provincial income tax are AUTO-CALCULATED by the
     CRA formula engine (PAYROLL-CALC region) for the period's
     year and the driver's home province; net is computed live.
     Every auto field stays editable: an edited field is marked
     as overridden and stops auto-updating for that stub (the
     employer's real stub can differ — TD1 credits beyond the
     basic amounts are the usual reason, and the printed stub's
     honesty label says so). 'Other deductions' stays manual. */
  var PS_PROV_NAMES = {};
  Object.keys(CA_NAME2CODE).forEach(function (nm) { PS_PROV_NAMES[CA_NAME2CODE[nm]] = nm; });
  function psWageRate(o) { return parseFloat(o.ownWageRate) || parseFloat(o.payRate) || 0; }
  /* The period's gross + hours from the shared per-day builder:
     the winning day lines only (dispatch-confirmed days win, the
     v79/v105 rules), extras excluded — extras are billing
     charges, not wages. Hourly: gross = hours × the wage rate
     (the spec's own arithmetic: 124.5 h × $29 = $3,610.50). */
  function psPeriodGross(o, a, b) {
    var entries = App._store.get('rev_entries', []).filter(function (e) { return e && e.date >= a && e.date <= b; });
    var rate = psWageRate(o);
    var built = invCycBuildRevenueLines(entries, [], rate, o.payStandard);
    var hours = 0;
    Object.keys(built.dayHours || {}).forEach(function (d) { hours += parseFloat(built.dayHours[d]) || 0; });
    hours = invCycRound2(hours);
    var gross;
    if (String(o.payStandard || '').toLowerCase() === 'hourly' && rate > 0) {
      gross = invCycRound2(hours * rate);
    } else {
      gross = 0;
      built.lines.forEach(function (l) { gross += Number(l.amt) || 0; });
      gross = invCycRound2(gross);
    }
    return { gross: gross, hours: hours, days: built.lines.length };
  }

  function renderPayroll(body) {
    var o = onb();
    var provName = PS_PROV_NAMES[o.province] || o.province || '';
    /* (a) the period opens on the current open semi-monthly
       cycle — the period after the latest saved stub's period,
       else the period containing today (invCycOpenPeriod reads
       pb/date/at; a stub's period end rides as pb). */
    var openP = invCycOpenPeriod(paystubs().map(function (r) { return { pb: r.b }; }), App._today());
    var h = jurisdictionBanner();
    h += '<div class="card"><h3>💵 New pay stub</h3>' +
      '<p class="note">Jurisdiction: <b>' + esc(o.country || 'not set') + ' / ' + esc(o.province || 'not set') + '</b></p>' +
      '<div class="row"><div><label class="f">Period from</label><input type="date" id="ps_a" value="' + esc(openP.a) + '"></div>' +
      '<div><label class="f">Period to</label><input type="date" id="ps_b" value="' + esc(openP.b) + '"></div></div>' +
      '<label class="f">Gross earnings $</label><input id="ps_gross" type="number" step="0.01" placeholder="0.00">' +
      '<p class="note" id="ps_gross_note" style="margin:2px 0 8px"></p>' +
      '<label class="f">CPP deducted $</label><input id="ps_cpp" type="number" step="0.01" placeholder="0.00">' +
      '<p class="note" id="ps_cpp2_note" style="margin:2px 0 8px;display:none"></p>' +
      '<label class="f">EI deducted $</label><input id="ps_ei" type="number" step="0.01" placeholder="0.00">' +
      '<label class="f">Income tax — federal $</label><input id="ps_ftax" type="number" step="0.01" placeholder="0.00">' +
      '<label class="f">Income tax — ' + esc(provName || 'provincial') + ' $</label><input id="ps_ptax" type="number" step="0.01" placeholder="0.00">' +
      '<p class="note" id="ps_calc_note" style="margin:2px 0 8px"></p>' +
      '<p class="note" id="ps_over_note" style="margin:2px 0 8px;display:none;color:#b97a0f;font-weight:600"></p>' +
      '<label class="f">Other deductions $</label><input id="ps_other" type="number" step="0.01" placeholder="0.00">' +
      '<label class="f">Other deduction note</label><input id="ps_onote" placeholder="e.g. benefits, union dues">' +
      '<div class="kv" style="font-size:17px;margin-top:10px"><span><b>Net pay</b></span><b id="ps_net">$0.00</b></div>' +
      '<p class="note" style="margin-top:8px">Calculated with the federal' + (provName ? ' + ' + esc(provName) : '') +
      ' basic amounts (CRA formulas). Your employer\'s figures may differ if your TD1 claims more than the basic amounts.</p>' +
      '<button class="btn ghost small" id="ps_recalc" style="margin:0">↺ Recalculate all fields</button></div>' +
      '<button class="btn primary" id="ps_save">Save &amp; print pay stub</button>';

    var stubs = paystubs();
    if (stubs.length) {
      h += '<div class="card"><h3>📁 Saved pay stubs</h3>';
      stubs.slice().reverse().slice(0, 10).forEach(function (r) {
        h += '<div class="kv"><span>' + esc(r.a) + ' → ' + esc(r.b) + '</span>' +
          '<span><b>$' + r.net.toFixed(2) + '</b> <a href="#" data-psprint="' + r.id + '" style="color:var(--navy)">print</a></span></div>';
      });
      h += '</div>';
    }
    body.innerHTML = h;

    var gp = body.querySelector('#iv_goprefs');
    if (gp) gp.onclick = function () { App.openModule('preferences'); };

    var FIELDS = { gross: '#ps_gross', cpp: '#ps_cpp', ei: '#ps_ei', ftax: '#ps_ftax', ptax: '#ps_ptax' };
    var LABELS = { gross: 'Gross', cpp: 'CPP', ei: 'EI', ftax: 'Federal tax', ptax: (provName || 'Provincial') + ' tax' };
    var psOver = {};      /* field -> true once hand-edited */
    var psFilling = false; /* true while recompute() writes */
    var psAuto = { gross: 0, hours: 0, days: 0 };
    var psCalc = null;
    function el(id) { return body.querySelector(id); }
    function setField(key, v) {
      var n = el(FIELDS[key]);
      if (n) n.value = (v === null || v === undefined) ? '' : Number(v).toFixed(2);
    }
    function fieldVal(key) { var n = el(FIELDS[key]); return n ? (Number(n.value) || 0) : 0; }
    function paintOver() {
      var names = Object.keys(psOver).map(function (k) { return LABELS[k]; });
      var note = el('#ps_over_note');
      if (note) {
        note.style.display = names.length ? '' : 'none';
        note.textContent = names.length
          ? '✏️ Hand-edited: ' + names.join(', ') + ' — ' + (names.length === 1 ? 'it' : 'these') + ' won\'t auto-update for this stub. "Recalculate all" restores the calculated figures.'
          : '';
      }
      var gn = el('#ps_gross_note');
      if (gn) {
        if (psOver.gross) {
          gn.innerHTML = '✏️ Gross edited by hand. The period\'s completed work adds up to <b>$' + psAuto.gross.toFixed(2) + '</b>' +
            (psAuto.hours > 0 ? ' (' + invCycFmtH(psAuto.hours) + ' hrs)' : '') + '.';
        } else if (psAuto.days > 0) {
          gn.innerHTML = 'From your completed days in this period: <b>' + invCycFmtH(psAuto.hours) + ' hrs</b>' +
            (psWageRate(o) > 0 && String(o.payStandard || '').toLowerCase() === 'hourly' ? ' × $' + psWageRate(o).toFixed(2) : '') +
            ' = <b>$' + psAuto.gross.toFixed(2) + '</b>. Edit it if your employer\'s stub says different.';
        } else {
          gn.textContent = 'No completed work found in this period yet — enter the gross from your employer\'s stub.';
        }
      }
    }
    function paintNet() {
      var net = fieldVal('gross') - fieldVal('cpp') - fieldVal('ei') - fieldVal('ftax') - fieldVal('ptax') - (Number(el('#ps_other').value) || 0);
      el('#ps_net').textContent = '$' + net.toFixed(2);
      return net;
    }
    function recompute() {
      var a = el('#ps_a').value, b = el('#ps_b').value;
      psAuto = psPeriodGross(o, a, b);
      psFilling = true;
      if (!psOver.gross) setField('gross', psAuto.gross);
      var year = parseInt(String(b || a || '').slice(0, 4), 10) || (new Date()).getFullYear();
      psCalc = psCalcDeductions(fieldVal('gross'), { year: year, province: o.province, periods: 24 });
      var cn = el('#ps_calc_note');
      if (psCalc) {
        if (!psOver.cpp) setField('cpp', psR2(psCalc.cpp + psCalc.cpp2));
        if (!psOver.ei) setField('ei', psCalc.ei);
        if (!psOver.ftax) setField('ftax', psCalc.fedTax);
        if (!psOver.ptax && psCalc.provTax !== null) setField('ptax', psCalc.provTax);
        var c2 = el('#ps_cpp2_note');
        if (c2) {
          c2.style.display = psCalc.cpp2 > 0 ? '' : 'none';
          c2.textContent = psCalc.cpp2 > 0 ? 'CPP above includes CPP2 of $' + psCalc.cpp2.toFixed(2) + ' (the second additional CPP on earnings over the year\'s maximum pensionable earnings).' : '';
        }
        if (cn) cn.textContent = psCalc.provSupported
          ? 'CPP, EI and income tax calculated from the ' + year + ' CRA formulas (semi-monthly, basic amounts).'
          : 'CPP, EI and federal tax calculated from the ' + year + ' CRA formulas. Provincial tax for ' + (provName || o.province || 'your province') + ' isn\'t auto-calculated yet — enter it from your employer\'s stub.';
      } else {
        if (cn) cn.textContent = 'Auto-calculation covers ' + Object.keys(PS_YEARS).join(', ') + ' periods — enter the deductions from your employer\'s stub for this period.';
      }
      psFilling = false;
      paintOver();
      paintNet();
    }
    Object.keys(FIELDS).forEach(function (key) {
      el(FIELDS[key]).addEventListener('input', function () {
        if (!psFilling) {
          if (!psOver[key]) { psOver[key] = true; }
          /* A hand-changed gross re-derives the deductions from
             the NEW gross (the overridden deductions, if any,
             still hold); a hand-changed deduction just re-nets. */
          if (key === 'gross') { recompute(); return; }
          paintOver();
        }
        paintNet();
      });
    });
    el('#ps_other').addEventListener('input', paintNet);
    el('#ps_a').addEventListener('change', recompute);
    el('#ps_b').addEventListener('change', recompute);
    el('#ps_recalc').onclick = function () { psOver = {}; recompute(); };
    recompute();

    body.querySelector('#ps_save').onclick = function () {
      var gross = fieldVal('gross');
      if (!(gross > 0)) { alert('Enter gross earnings first.'); return; }
      var fed = fieldVal('ftax'), prov = fieldVal('ptax');
      var rec = {
        id: 'ps' + Date.now(),
        a: el('#ps_a').value, b: el('#ps_b').value,
        hours: psAuto.hours, gross: gross,
        ei: fieldVal('ei'),
        cpp: fieldVal('cpp'), cpp2: psCalc ? psCalc.cpp2 : 0,
        fedTax: fed, provTax: prov, tax: psR2(fed + prov),
        other: Number(el('#ps_other').value) || 0,
        otherNote: el('#ps_onote').value.trim(),
        net: paintNet(), country: o.country, province: o.province,
        employer: o.contractingCo || o.companyName || '',
        /* v122: the stub remembers HOW it was built — calculated
           vs hand-entered, and which fields were overridden — so
           the print carries the right honesty label. */
        autoCalc: !!psCalc, overFields: Object.keys(psOver)
      };
      var l = paystubs(); l.push(rec); W('stubs', l);
      printPayStub(rec);
      Meticulous.modules.invoice.render(body);
    };
    body.querySelectorAll('[data-psprint]').forEach(function (a) {
      a.onclick = function (e) {
        e.preventDefault();
        var id = a.getAttribute('data-psprint');
        paystubs().forEach(function (r) { if (r.id === id) printPayStub(r); });
      };
    });
  }

  function printPayStub(rec) {
    /* v122: the same structural cleanliness as the invoice —
       header band, a pay-period line, ruled Earnings and
       Deductions sections, a totals block, and an honest
       footer. Stubs saved before v122 (no fedTax split) print
       their single Income tax row as recorded. */
    var provName = PS_PROV_NAMES[rec.province] || rec.province || '';
    var dedRows =
      '<tr><td>CPP' + (rec.cpp2 > 0 ? ' (includes CPP2 $' + Number(rec.cpp2).toFixed(2) + ')' : '') + '</td><td class="tot">−$' + Number(rec.cpp || 0).toFixed(2) + '</td></tr>' +
      '<tr><td>EI</td><td class="tot">−$' + Number(rec.ei || 0).toFixed(2) + '</td></tr>' +
      (rec.fedTax !== undefined && rec.fedTax !== null
        ? '<tr><td>Income tax — federal</td><td class="tot">−$' + Number(rec.fedTax || 0).toFixed(2) + '</td></tr>' +
          '<tr><td>Income tax — ' + esc(provName || 'provincial') + '</td><td class="tot">−$' + Number(rec.provTax || 0).toFixed(2) + '</td></tr>'
        : '<tr><td>Income tax</td><td class="tot">−$' + Number(rec.tax || 0).toFixed(2) + '</td></tr>') +
      '<tr><td>Other' + (rec.otherNote ? ' (' + esc(rec.otherNote) + ')' : '') + '</td><td class="tot">−$' + Number(rec.other || 0).toFixed(2) + '</td></tr>';
    printDoc('Pay stub ' + rec.a,
      '<div class="band"><h1>Pay Stub</h1>' +
      '<p>' + esc(rec.employer || '') + '</p></div>' +
      '<div class="row"><span><b>Pay period:</b> ' + esc(rec.a) + ' to ' + esc(rec.b) +
      ((invCycPeriodOf(rec.a) || {}).b === rec.b ? ' (' + esc(invCycLabel({ a: rec.a, b: rec.b })) + ')' : '') + '</span>' +
      '<span><b>Jurisdiction:</b> ' + esc(rec.country || '') + ' / ' + esc(rec.province || '') + '</span></div>' +
      '<h3 class="sec">Earnings</h3>' +
      '<table><tr><th>Description</th><th style="text-align:right">Amount</th></tr>' +
      (rec.hours > 0 ? '<tr><td>Hours worked</td><td class="tot">' + invCycFmtH(rec.hours) + ' hrs</td></tr>' : '') +
      '<tr><td>Gross earnings</td><td class="tot">$' + Number(rec.gross || 0).toFixed(2) + '</td></tr></table>' +
      '<h3 class="sec">Deductions</h3>' +
      '<table><tr><th>Description</th><th style="text-align:right">Amount</th></tr>' + dedRows + '</table>' +
      '<div class="totblock">' +
      '<div class="row" style="font-size:18px"><span><b>Net pay</b></span><span><b>$' + Number(rec.net || 0).toFixed(2) + '</b></span></div>' +
      '</div>' +
      '<p class="muted foot">' + (rec.autoCalc
        ? 'Calculated with the federal' + (provName ? ' + ' + esc(provName) : '') + ' basic amounts using CRA payroll formulas. Your employer\'s figures may differ if your TD1 claims more than the basic amounts. This stub is a record, not tax advice.'
        : 'Deductions entered manually. This stub is a record, not tax advice.') + '</p>');
  }

  /* ---------------- main ---------------- */
  Meticulous.modules.invoice = {
    /* v116: shell back contract — the module's home mode is
       Invoice (Pay Stub for a payroll employee); the other mode
       is a sub-view. Fresh entry returns to the home mode, and
       Back from the non-home mode returns there first instead of
       leaving the module. */
    resetView: function () { W('mode', onb().employment === 'Payroll' ? 'paystub' : 'invoice'); },
    back: function () {
      var home = onb().employment === 'Payroll' ? 'paystub' : 'invoice';
      if (S('mode', home) === home) return false;
      W('mode', home);
      if (invBody) Meticulous.modules.invoice.render(invBody);
      return true;
    },
    /* v78: the card preview — the OPEN period and its running total
       (the period's revenue lines; a draft's manual items join when
       the invoice itself is built). Falls back to the issued count
       if the period cannot be read. */
    status: function () {
      try {
        var p = invCycOpenPeriod(invoices(), App._today());
        if (p) {
          var tot = 0;
          revenueLines(p.a, p.b).forEach(function (l) { tot += l.amt || 0; });
          return invCycShort(p) + (tot > 0 ? ': $' + tot.toFixed(2) : ' · no entries yet');
        }
      } catch (e) {}
      return invoices().length + ' issued';
    },
    render: function (body) {
      invBody = body;
      var o = onb();
      var mode = S('mode', o.employment === 'Payroll' ? 'paystub' : 'invoice');
      var h = '<div class="card"><div class="row">' +
        '<button class="btn small ' + (mode === 'invoice' ? 'primary' : 'ghost') + '" data-m="invoice" style="margin:0">🧾 Invoice</button>' +
        '<button class="btn small ' + (mode === 'paystub' ? 'primary' : 'ghost') + '" data-m="paystub" style="margin:0">💵 Pay Stub</button>' +
        '</div></div><div id="iv_body"></div>';
      body.innerHTML = h;
      body.querySelectorAll('[data-m]').forEach(function (b) {
        b.onclick = function () { W('mode', b.getAttribute('data-m')); Meticulous.modules.invoice.render(body); };
      });
      var inner = body.querySelector('#iv_body');
      if (mode === 'invoice') renderInvoice(inner); else renderPayroll(inner);
    }
  };
})();
