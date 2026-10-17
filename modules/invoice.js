/* Invoice / Pay Stub module (Meticulous.modules convention)
   Contractor: period-based lines from revenue + manual items, province-based
   tax (editable), invoice numbering, print. Payroll: manual deductions only —
   nothing auto-calculated, never defaults to US rules; country/province
   required from Preferences before use. */
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
       3. the day's +1 load taps (sessions + the live taps the
          caller hands in);
       4. a Weight day's counted loads (session loadCount);
       5. the learned-site count (geo) — the movement-derived
          count, last resort, always overridable by any source
          above it on a later close.
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
      var taps = parseInt(src.liveTaps, 10) || 0;
      (src.sessions || []).forEach(function (s) { taps += parseInt(s && s.manualLoads, 10) || 0; });
      if (taps > 0) { loads = taps; source = 'taps'; }
    }
    if (!loads) {
      var w = 0;
      (src.sessions || []).forEach(function (s) { w += parseInt(s && s.loadCount, 10) || 0; });
      if (w > 0) { loads = w; source = 'weight'; }
    }
    if (!loads) {
      var g = parseInt(src.geoLoads, 10) || 0;
      if (g > 0) { loads = g; source = 'sites'; }
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

  /* The line plan for a period: the grouped lines plus the days
     that block issuing and the tracker-only days to flag. The
     grouping/source rules live in invCycBuildRevenueLines
     (INV-CYCLE region, suite-tested). */
  function revenueLinePlan(a, b) {
    var o = onb();
    var entries = App._store.get('rev_entries', []).filter(function (e) { return e.date >= a && e.date <= b; });
    var extras = App._store.get('rev_extras', []).filter(function (x) { return x.date >= a && x.date <= b; });
    return invCycBuildRevenueLines(entries, extras, o.payRate, o.payStandard);
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
      '</style></head><body>' + bodyHtml + '</body></html>');
    w.document.close(); w.focus();
    setTimeout(function () { w.print(); }, 400);
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
       edited himself is never rewritten. */
    if (o.contractingCo && o.contractingAddr && draft.billTo === o.contractingCo) {
      draft.billTo = o.contractingCo + ', ' + o.contractingAddr;
    }
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
      h += issuedHtml();
      body.innerHTML = h;
      wireInvoice(body, draft, revLines, t, saveDraft, draw, revPlan);
    }

    function issuedHtml() {
      var list = invoices();
      var h = '<div class="card"><h3>📁 Issued invoices</h3>';
      if (!list.length) return h + '<div class="empty">No invoices yet.</div></div>';
      list.slice().reverse().slice(0, 10).forEach(function (r) {
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
          rate: parseFloat(o.payRate) || 0,
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
      var rows = '';
      (rec.revLines || []).forEach(function (l) {
        /* v105: day lines print in the hour-sheet shape the owner
           sends ("Oct 16: 11h"); extras and records without stored
           day hours keep their stored descriptions. */
        var label = l.src === 'extra' ? (l.desc || '') : (invCycLineLabel(l, rec.dayHours) || l.desc || '');
        rows += '<tr><td>' + esc(label) + '</td><td class="tot">$' + (Number(l.amt) || 0).toFixed(2) + '</td></tr>';
      });
      (rec.items || []).forEach(function (it) {
        rows += '<tr><td>' + esc(it.desc) + ' × ' + esc(it.qty) + ' @ $' + Number(it.rate).toFixed(2) + '</td>' +
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
      printDoc('Invoice ' + rec.no,
        '<h1>' + esc((rec.company && rec.company.name) || 'Invoice') + '</h1>' +
        '<p class="muted">' + esc((rec.company && rec.company.addr) || '').replace(/\n/g, '<br>') +
        (rec.company && rec.company.gst ? '<br>GST/HST: ' + esc(rec.company.gst) : '') + '</p>' +
        '<h2>INVOICE #' + esc(rec.no) + '</h2>' +
        '<div class="row"><span><b>Bill to:</b> ' + esc(rec.billTo || '—') + '</span><span><b>Date:</b> ' + esc(rec.date) + '</span></div>' +
        '<table><tr><th>Description</th><th style="text-align:right">Amount</th></tr>' + rows + '</table>' +
        '<div class="row"><span>Subtotal</span><span>$' + rec.sub.toFixed(2) + '</span></div>' +
        '<div class="row"><span>' + (rec.taxIncluded
          ? 'Tax (' + esc(rec.taxRate) + '% GST, included in the rate)'
          : 'Tax (' + esc(rec.taxRate) + '%)') + '</span><span>$' + rec.tax.toFixed(2) + '</span></div>' +
        '<div class="row" style="font-size:18px"><span><b>Total due</b></span><span><b>$' + rec.total.toFixed(2) + '</b></span></div>' +
        (noteText ? '<p class="muted">' + esc(noteText) + '</p>' : '') +
        '<p class="muted">Invoice ' + esc(rec.no) + '</p>');
    }

    draw();
  }

  /* ---------------- payroll pay stub (manual deductions) ---------------- */
  function renderPayroll(body) {
    var o = onb();
    var h = jurisdictionBanner();
    h += '<div class="card"><h3>💵 New pay stub</h3>' +
      '<p class="note">Jurisdiction: <b>' + esc(o.country || 'not set') + ' / ' + esc(o.province || 'not set') + '</b><br>' +
      'Enter deductions yourself — the app does not calculate tax for you.</p>' +
      '<div class="row"><div><label class="f">Period from</label><input type="date" id="ps_a" value="' + esc(App._today()) + '"></div>' +
      '<div><label class="f">Period to</label><input type="date" id="ps_b" value="' + esc(App._today()) + '"></div></div>' +
      '<label class="f">Gross earnings $</label><input id="ps_gross" type="number" step="0.01" placeholder="0.00">' +
      '<label class="f">EI deducted $</label><input id="ps_ei" type="number" step="0.01" placeholder="0.00">' +
      '<label class="f">CPP deducted $</label><input id="ps_cpp" type="number" step="0.01" placeholder="0.00">' +
      '<label class="f">Income tax deducted $</label><input id="ps_tax" type="number" step="0.01" placeholder="0.00">' +
      '<label class="f">Other deductions $</label><input id="ps_other" type="number" step="0.01" placeholder="0.00">' +
      '<label class="f">Other deduction note</label><input id="ps_onote" placeholder="e.g. benefits, union dues">' +
      '<div class="kv" style="font-size:17px;margin-top:10px"><span><b>Net pay</b></span><b id="ps_net">$0.00</b></div></div>' +
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

    function calc() {
      var g = Number(body.querySelector('#ps_gross').value) || 0;
      var d = ['ps_ei', 'ps_cpp', 'ps_tax', 'ps_other'].reduce(function (s, id) {
        return s + (Number(body.querySelector('#' + id).value) || 0);
      }, 0);
      return { gross: g, net: g - d };
    }
    ['ps_gross', 'ps_ei', 'ps_cpp', 'ps_tax', 'ps_other'].forEach(function (id) {
      body.querySelector('#' + id).addEventListener('input', function () {
        body.querySelector('#ps_net').textContent = '$' + calc().net.toFixed(2);
      });
    });
    body.querySelector('#ps_save').onclick = function () {
      var n = calc();
      if (!(n.gross > 0)) { alert('Enter gross earnings first.'); return; }
      var rec = {
        id: 'ps' + Date.now(),
        a: body.querySelector('#ps_a').value, b: body.querySelector('#ps_b').value,
        gross: n.gross, ei: Number(body.querySelector('#ps_ei').value) || 0,
        cpp: Number(body.querySelector('#ps_cpp').value) || 0,
        tax: Number(body.querySelector('#ps_tax').value) || 0,
        other: Number(body.querySelector('#ps_other').value) || 0,
        otherNote: body.querySelector('#ps_onote').value.trim(),
        net: n.net, country: o.country, province: o.province,
        employer: o.contractingCo || o.companyName || ''
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
    printDoc('Pay stub ' + rec.a,
      '<h1>Pay Stub</h1>' +
      '<p class="muted">' + esc(rec.employer) + '<br>Pay period: ' + esc(rec.a) + ' to ' + esc(rec.b) +
      '<br>Jurisdiction: ' + esc(rec.country || '') + ' / ' + esc(rec.province || '') + '</p>' +
      '<table><tr><th>Description</th><th style="text-align:right">Amount</th></tr>' +
      '<tr><td>Gross earnings</td><td class="tot">$' + rec.gross.toFixed(2) + '</td></tr>' +
      '<tr><td>EI</td><td class="tot">−$' + rec.ei.toFixed(2) + '</td></tr>' +
      '<tr><td>CPP</td><td class="tot">−$' + rec.cpp.toFixed(2) + '</td></tr>' +
      '<tr><td>Income tax</td><td class="tot">−$' + rec.tax.toFixed(2) + '</td></tr>' +
      '<tr><td>Other' + (rec.otherNote ? ' (' + esc(rec.otherNote) + ')' : '') + '</td><td class="tot">−$' + rec.other.toFixed(2) + '</td></tr></table>' +
      '<div class="row" style="font-size:18px"><span><b>Net pay</b></span><span><b>$' + rec.net.toFixed(2) + '</b></span></div>' +
      '<p class="muted">Deductions entered manually. This stub is a record, not tax advice.</p>');
  }

  /* ---------------- main ---------------- */
  Meticulous.modules.invoice = {
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
