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
      if (a && b && b >= a) return dateStr >= a && dateStr <= b;
      /* v107: Custom with missing/invalid bounds used to return
         TRUE for every date ever recorded — an all-time sum wearing
         a "30 days" label (owner's phone, Oct 16: 62 "days" inside
         a 30-day window). Fall through to the rolling window that
         periodDays() already falls back to, so the label and the
         sum can never disagree again. */
    }
    var d = new Date(dateStr + 'T12:00:00'), now = new Date();
    return (now - d) / 86400000 <= (p === 'custom' ? periodDays() : (parseInt(p, 10) || 30));
  }

  /* ---- v38: one per-day aggregation feeds the period summary, the chart
     and the Month view, so every number on screen comes from the same math.
     Per day: base = entries priced by payFor + extras, plus the live
     tracker session (A1) described below.
     NO travel bonus is applied anywhere in Revenue (owner, Oct 13, 2026):
     his recorded hours — tracker start-to-end spans and hours-sheet days —
     ALREADY include travel time, so adding the bonus here would
     double-count it. onboarding.travelBonus belongs only to the
     foreman-ticket path in Dispatch/Manifest, where the base hours are the
     foreman's shorter ticket hours. That path is untouched. */

  /* v137: THE rate for the user's own books — his own wage chain
     (ownWageRate || payRate). The universal Preferences "Rate"
     field is gone; crew rates live in P&L entries, never here. */
  function ownRate(o) { return parseFloat(o.ownWageRate) || parseFloat(o.payRate) || 0; }

  function payCtx() {
    var o = App._store.get('onboarding', {});
    return {
      std: (o.payStandard || 'hourly').toLowerCase(),
      rate: ownRate(o)
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

  /* Map: dateStr -> { hours, base, extrasAmt, amount, hasEntry, live,
     unconfirmed, duplicate }
     - hours: the CONFIRMED source's hours for the day (see below) +
       the live session's — they already include travel; nothing is
       added.
     - amount: base (grouped entries + live session value) + extras.
     v81: ONE GROUPED TRUTH. Day money comes from the SAME builder
     the invoice prints from (Meticulous.shared.buildRevenueLines,
     modules/invoice.js): per day, a dispatch completion wins, a
     manual entry is next, a lone tracker entry counts but is
     flagged unconfirmed, and several tracker entries with no
     confirmed source count NOTHING and are flagged duplicate —
     the day is never summed twice. (Pre-v81 this summed the raw
     entries: Oct 15's completion $333.50 AND its tracker double
     $291.16 both landed, and the screen called the poisoned sum
     "Earnings".) The raw-sum path remains only as a fallback for a
     build where the shared builder somehow didn't load. */
  function dayAgg() {
    var ctx = payCtx();
    var o = App._store.get('onboarding', {});
    var map = {};
    function slot(ds) {
      if (!map[ds]) map[ds] = { hours: 0, base: 0, extrasAmt: 0, amount: 0, hasEntry: false, live: false, unconfirmed: false, duplicate: false };
      return map[ds];
    }
    var built = null;
    try {
      if (window.Meticulous && Meticulous.shared && Meticulous.shared.buildRevenueLines) {
        built = Meticulous.shared.buildRevenueLines(entries(), extras(), ctx.rate, ctx.std, App._store.get('pnl_card_wages', []) || []);
      }
    } catch (e) { built = null; }
    /* v107: which dates a CONFIRMED line (dispatch completion or
       manual entry) already speaks for — the live session below
       must never stack on top of one (see the live block). */
    var confirmedDay = {}, dupDay = {};
    if (built) {
      built.lines.forEach(function (l) {
        if (!l.date) return;
        var s = slot(l.date);
        if (l.src === 'extra') { s.extrasAmt += Number(l.amt) || 0; return; }
        s.base += Number(l.amt) || 0;
        s.hasEntry = true;
        if (l.unconfirmed) s.unconfirmed = true;
        if (l.src === 'dispatch' || l.src === 'entry') confirmedDay[l.date] = true;
      });
      (built.duplicateDates || []).forEach(function (ds) {
        var s = slot(ds);
        s.hasEntry = true;
        s.duplicate = true;
        dupDay[ds] = true;
      });
      var dh = built.dayHours || {};
      Object.keys(dh).forEach(function (ds) { slot(ds).hours += dh[ds] || 0; });
    } else {
      entries().forEach(function (e) {
        if (!e.date) return;
        var s = slot(e.date);
        s.hasEntry = true;
        s.base += payFor(e, ctx.std, ownRate(o));
        s.hours += parseFloat(e.hours) || 0;
      });
      extras().forEach(function (x) {
        if (!x.date) return;
        slot(x.date).extrasAmt += parseFloat(x.amount) || 0;
      });
    }
    var live = liveSession();
    if (live) {
      var s = slot(live.date);
      s.live = true;
      /* v107 — ONE MONEY TRUTH: a closed dispatch (or a confirmed
         manual entry) IS the day's truth; the still-running
         session's hours and value are NEVER added on top of it
         (Oct 16: the day's $319.00 dispatch plus its own tracker
         session stacked into $601.75 on the manifest and inflated
         every Revenue window the same way). The live session only
         counts on a day no confirmed line speaks for — and never
         on a duplicate-flagged day, which counts nothing until
         the driver resolves it. Its flag still paints, so the
         screen keeps showing the day is in progress. */
      if (!confirmedDay[live.date] && !dupDay[live.date]) {
        s.hasEntry = true;
        s.hours += live.hours;
        if (ctx.std === 'hourly') s.base += live.hours * ctx.rate;
      }
    }
    Object.keys(map).forEach(function (ds) {
      var s = map[ds];
      s.amount = s.base + s.extrasAmt;
    });
    return map;
  }

  /* v116 (owner, Oct 16 2026, screenshot of TODAY): the flat
     📒 Entries list led with "$282.85 · Auto from tracker" — the
     session's own math — and put the day's real record second
     ("$319.00 · Dispatch: Aecon Inf … Ticket #22729"). Same
     disease as the day detail: every raw record dressed as money.
     entryMoneyFlags applies the builder's ladder to the stored
     list: per day, only the entries of the source the shared
     builder priced are money; a tracker entry is money ONLY when
     it is the day's priced source; a sub-0.1h tracker drip is
     never money. Non-money records do not render in the flat
     list at all — they live in the day's detail (Also recorded /
     Tracker sessions), one tap from the day's money row. With no
     builder (never in the app) everything stays money — the same
     fallback dayAgg makes. */
  function entryMoneyFlags() {
    var ctx = payCtx();
    var o = App._store.get('onboarding', {});
    var list = entries();
    var winSrc = {}, haveBuilt = false;
    try {
      if (window.Meticulous && Meticulous.shared && Meticulous.shared.buildRevenueLines) {
        var builtF = Meticulous.shared.buildRevenueLines(list, extras(), ctx.rate, ctx.std, App._store.get('pnl_card_wages', []) || []);
        haveBuilt = true;
        (builtF.lines || []).forEach(function (l) {
          if (l && l.date && l.src !== 'extra') winSrc[l.date] = l.src;
        });
      }
    } catch (e) { haveBuilt = false; winSrc = {}; }
    var srcFn = null;
    try {
      if (window.Meticulous && Meticulous.shared && Meticulous.shared.revenueEntrySource) srcFn = Meticulous.shared.revenueEntrySource;
    } catch (e2) { srcFn = null; }
    return list.map(function (e) {
      var src = null;
      if (srcFn) { try { src = srcFn(e); } catch (err) { src = null; } }
      if (!src) {
        if (!e) src = 'entry';
        else if (e.auto) src = 'tracker';
        else if ((e.note || '').indexOf('Dispatch:') === 0) src = 'dispatch';
        else if (e.note === 'Auto from tracker') src = 'tracker';
        else src = 'entry';
      }
      var q = ctx.std === 'miles' ? (parseFloat(e && e.miles) || 0)
        : ctx.std === 'trip' ? (parseFloat(e && e.trips) || 0)
        : ctx.std === 'weight' ? (parseFloat(e && e.tons) || 0)
        : (parseFloat(e && e.hours) || 0);
      var drip = (src === 'tracker' && q < 0.1);
      var money = !haveBuilt ? true
        : (!drip && !!winSrc[e.date] && src === winSrc[e.date] && payFor(e, ctx.std, ownRate(o)) > 0);
      return { src: src, drip: drip, money: money };
    });
  }

  function summary() {
    var map = dayAgg();
    var total = 0, loads = 0, n = 0, worked = 0;
    entries().forEach(function (e) {
      if (!inPeriod(e.date)) return;
      n++;
    });
    Object.keys(map).forEach(function (ds) {
      if (!inPeriod(ds)) return;
      total += map[ds].amount;
      if (map[ds].hasEntry) worked++;
    });
    /* v107: the Loads total comes from the SHARED per-day loads
       truth (Meticulous.shared.dayLoads — tickets → recorded
       dispatch loads → taps → weight count → learned-site count),
       summed over the days in the window. The old loop counted
       only raw entries of type 'load' — dispatch completions are
       'hourly', so Loads read 0 against a month of recorded work
       (owner's phone, Oct 16). Day sources are grouped once,
       filed the way the rest of the app files a dispatch
       (scheduledAt's date wins). */
    try {
      var dayLoadsFn = (window.Meticulous && Meticulous.shared && Meticulous.shared.dayLoads) || null;
      if (dayLoadsFn) {
        var dspByDate = {}, sessByDate = {}, geoDays = {}, seenDates = {};
        (App._store.get('dsp_list', []) || []).forEach(function (x) {
          if (!x) return;
          var sd = '';
          if (typeof x.scheduledAt === 'string') {
            var mm = /^(\d{4}-\d{2}-\d{2})/.exec(x.scheduledAt);
            if (mm) sd = mm[1];
          }
          var dsx = sd || x.date;
          if (dsx) { (dspByDate[dsx] = dspByDate[dsx] || []).push(x); seenDates[dsx] = true; }
        });
        (App._store.get('sessions', []) || []).forEach(function (s2) {
          if (s2 && s2.date) { (sessByDate[s2.date] = sessByDate[s2.date] || []).push(s2); seenDates[s2.date] = true; }
        });
        try { geoDays = (App._store.get('geoloads', { days: {} }).days) || {}; } catch (e2) { geoDays = {}; }
        Object.keys(map).forEach(function (ds) { seenDates[ds] = true; });
        var liveTaps = 0;
        try {
          var trkL = (window.App && App.tracker) || App._store.get('tracker', null);
          if (trkL && trkL.accum && (trkL.status === 'running' || trkL.status === 'paused')) {
            liveTaps = parseInt(trkL.accum.manualLoads, 10) || 0;
          }
        } catch (e3) { liveTaps = 0; }
        Object.keys(seenDates).forEach(function (ds) {
          if (!inPeriod(ds)) return;
          loads += dayLoadsFn(ds, {
            dispatches: dspByDate[ds] || [],
            sessions: sessByDate[ds] || [],
            liveTaps: ds === App._today() ? liveTaps : 0,
            geoLoads: geoDays[ds] ? geoDays[ds].count : 0
          }).loads;
        });
      }
    } catch (e) { loads = 0; }
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
    var hours = 0, total = 0, worked = 0, list = [], loads = 0;
    Object.keys(map).forEach(function (ds) {
      if (ds.slice(0, 7) !== ym) return;
      var s = map[ds];
      total += s.amount;
      hours += s.hours;
      /* v118: the month's loads ride the same shared dayLoads
         ladder as the period view — the Month view's Loads metric
         rendered NOTHING at all in the soak (the card did not
         exist and the summary never computed the number). */
      try { loads += dayLoadsFor(ds) || 0; } catch (e) {}
      if (s.hasEntry) {
        worked++;
        list.push({ date: ds, hours: s.hours, amount: s.amount, live: s.live, unconfirmed: !!s.unconfirmed, duplicate: !!s.duplicate });
      }
    });
    list.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return { ym: ym, hours: hours, total: total, daysWorked: worked, avg: worked ? total / worked : 0, days: list, loads: loads };
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

  /* v151 (owner, Oct 17 2026: "These dates are mushed up"):
     the horizontal stride rule that stood here chose WHICH bars
     carried a date — and choosing meant SKIPPING: his Oct 21,
     2026 screenshot (09:55 MDT) showed every OTHER day labelled
     (10/16, 10/18, 10/20…) and the final label clipped at the
     card edge ("10/:").
     v201 CHART-DATES (owner, Oct 21, 2026 09:55 MDT: "the dates
     on that chart are still not clean"): EVERY day of the period
     is labelled — the labels stand VERTICAL under their bars
     (drawChart), so a label's sideways footprint is only its
     font thickness, which drawChart sizes to the bar slot: no
     skipping, no crowding, and a label can never run off the
     card edge. This rule now simply returns every index; it
     stays a named pure function so the drawing and its suite
     keep one source for "which bars carry a date": all of them. */
  function chartLabelIdx(days, Wd, labels) {
    var out = [];
    for (var i = 0; i < days; i++) out.push(i);
    return out;
  }

  /* v164: THE CHART'S DATES — ONE SOURCE, CALENDAR-TRUE (owner,
     Oct 18, 2026 20:36 MDT, REPEAT of the Oct 17 report: "These
     dates are still not fixed!"). Two defects fed it: (1) the
     bars were built by subtracting raw 86400000-ms chunks from
     "now" — the one place in this module not built calendar-
     first like every other date here — so a bar's date could
     drift off the calendar day it claimed; (2) WORSE, the window
     was always "the last N days ending today" while the totals
     beside it use the SELECTED period (inPeriod): with his
     Oct 16–31 period chosen (16 days), the chart drew Oct 3→18
     and the bars named days his period never covered. Now the
     buckets are exactly the period's own dates: walk back by
     CALENDAR days from the period's end (customB for a custom
     period, else today) while inPeriod() — the totals' own
     rule — says the day belongs, cap 62. Every bar's date is the
     date string itself, so a bar, its label, its tap target and
     the preview all name the same day by construction.
     v189 CHART-ALL (owner, Oct 21, 2026 07:21 MDT, his Revenue
     screenshot: period Oct 16–31 chosen, the card drew only the
     ~6 days up to today): "show ALL the days." The v164 future-
     tail pop is REVERSED — the card now enumerates the WHOLE
     selected period, future days included as empty bars, so the
     period on the card is the period the totals beside it use.
     The default mark/preview stays on the latest day that is
     today or earlier (chartMarkDate) — the future is drawn, it
     is just never the day the readout opens on. */
  function chartDates() {
    function fmt(d) {
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }
    var n = new Date();
    var todayS = fmt(n);
    var endD;
    if (S('period', '30') === 'custom' && S('customB', '')) {
      endD = new Date(S('customB', '') + 'T12:00:00');
    } else {
      endD = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12);
    }
    var out = [], d = endD, guard = 0;
    while (guard++ < 62) {
      var ds = fmt(d);
      if (!inPeriod(ds)) break;
      out.unshift(ds);
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12);
    }
    return out;
  }

  /* v189 CHART-ALL: the day the chart marks (and the preview
     readout opens on) when nothing is tapped — the latest chart
     date that is today or earlier; if the whole period is still
     ahead, the period's first day. */
  function chartMarkDate(dates) {
    if (!dates || !dates.length) return null;
    var n = new Date();
    var todayS = n.getFullYear() + '-' + ('0' + (n.getMonth() + 1)).slice(-2) + '-' + ('0' + n.getDate()).slice(-2);
    var mark = null;
    for (var i = 0; i < dates.length; i++) { if (dates[i] <= todayS) mark = dates[i]; }
    return mark || dates[0];
  }

  function drawChart(cv) {
    var agg = dayAgg();
    var dates = chartDates();
    var days = dates.length;
    if (!days) { cv._dayDates = []; return; }
    var buckets = [], labels = [];
    dates.forEach(function (ds) {
      buckets.push(agg[ds] ? agg[ds].amount : 0);
      labels.push((+ds.slice(5, 7)) + '/' + (+ds.slice(8, 10)));
    });
    /* v75: each bar IS its day — render wires a canvas tap to the
       bucket under it via this list ("make sure revenue entries
       are clickable as well", owner, Oct 14). */
    cv._dayDates = dates;
    var Wd = cv.width = (cv.offsetWidth || 600) * 2, H = cv.height = 340;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, Wd, H);
    var max = Math.max.apply(null, buckets.concat([1]));
    var bw = Wd / days;
    /* v201 CHART-DATES: every bar carries its date, standing
       VERTICAL in the reserved band under the bars. A vertical
       label's sideways footprint is its font thickness, sized to
       the bar slot (never wider than the slot, never under 11px),
       so labels cannot crowd or clip at any day count — the band
       is 80 tall (was 44) to hold a 5-char date standing up. */
    var baseY = H - 80;
    var fontPx = Math.max(11, Math.min(20, Math.floor(bw * 0.92)));
    /* v151: the MARKED bar — the day the preview readout under
       the chart names. The two-tap selection when there is one;
       until a tap (or after a stale selection falls away) the
       most recent day, so the chart never sits unmarked with an
       empty readout. */
    var mark = (graphSel && dates.indexOf(graphSel) >= 0) ? graphSel : chartMarkDate(dates);
    buckets.forEach(function (v, i) {
      var h = (v / max) * (H - 106);
      /* v116: the two-tap SELECTED day paints navy — the same navy
         as the preview card under the chart. */
      ctx.fillStyle = (dates[i] === graphSel || dates[i] === mark) ? '#1F3764' : (v > 0 ? '#F26522' : '#e8ecf4');
      ctx.fillRect(i * bw + bw * 0.2, baseY - h, bw * 0.6, Math.max(h, 4));
      ctx.save();
      ctx.translate(i * bw + bw / 2, H - 8);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = '#6b7690'; ctx.font = fontPx + 'px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(labels[i], 0, 0);
      ctx.restore();
    });
    ctx.fillStyle = '#1F3764'; ctx.font = 'bold 24px sans-serif';
    ctx.fillText('$' + Math.round(max), 8, 28);
  }

  /* v116 (owner, Oct 16 2026): the graph's TWO-TAP pattern — the
     one he loved in the old design. First tap on a bar (or a Month
     day row) SELECTS the day: the bar paints navy and a preview
     card shows the day's label, hours, earnings and loads, all
     priced by the same shared builder/dayAgg the lists use, so
     the preview can never disagree with the detail it leads to.
     Second tap on the SAME day opens its detail. Tapping a
     different day just moves the selection. Pure decision: */
  function graphTap(sel, tapped) {
    if (tapped && sel === tapped) return { sel: null, open: tapped };
    return { sel: tapped || null, open: null };
  }
  /* One day's loads from the shared ladder — the same per-day
     call summary() makes, for the preview card. */
  function dayLoadsFor(ds) {
    try {
      var fn = (window.Meticulous && Meticulous.shared && Meticulous.shared.dayLoads) || null;
      if (!fn) return 0;
      var dsp = (App._store.get('dsp_list', []) || []).filter(function (x) {
        if (!x) return false;
        var sd = '';
        if (typeof x.scheduledAt === 'string') { var mm = /^(\d{4}-\d{2}-\d{2})/.exec(x.scheduledAt); if (mm) sd = mm[1]; }
        return (sd || x.date) === ds;
      });
      var sess = (App._store.get('sessions', []) || []).filter(function (s2) { return s2 && s2.date === ds; });
      var geo = 0;
      try { var gd = (App._store.get('geoloads', { days: {} }).days) || {}; if (gd[ds]) geo = gd[ds].count || 0; } catch (e) {}
      var taps = 0;
      try {
        var trk = (window.App && App.tracker) || App._store.get('tracker', null);
        if (ds === App._today() && trk && trk.accum && (trk.status === 'running' || trk.status === 'paused')) taps = parseInt(trk.accum.manualLoads, 10) || 0;
      } catch (e2) {}
      return fn(ds, { dispatches: dsp, sessions: sess, liveTaps: taps, geoLoads: geo }).loads || 0;
    } catch (e3) { return 0; }
  }
  /* Paint (or clear) the preview card in the #rv_gprev host the
     render placed under the chart / the Month day list. */
  function paintGraphPreview(body) {
    var host = (body && body.querySelector) ? body.querySelector('#rv_gprev') : null;
    if (!host) return;
    /* v151: the readout is ALWAYS present in the period view —
       the two-tap selection when there is one, otherwise the
       chart's most recent day (the same day drawChart marks), so
       a driver can name a day's date and dollars at a glance
       instead of tapping around. The Month view has no chart on
       the page, so no default appears there. */
    var sel = graphSel;
    if (!sel) {
      var cv = body.querySelector('#revChart');
      if (cv && cv._dayDates && cv._dayDates.length) sel = chartMarkDate(cv._dayDates);
    }
    if (!sel) { host.innerHTML = ''; return; }
    var a = dayAgg()[sel] || { hours: 0, amount: 0, duplicate: false };
    var lbl = new Date(sel + 'T12:00:00').toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
    host.innerHTML = '<div class="card" style="border:2px solid var(--navy)"><h3>📊 ' + esc(lbl) + ' — $' + (a.amount || 0).toFixed(2) + '</h3>' +
      '<div class="kv"><span>Hours</span><b>' + fmtH(a.hours) + '</b></div>' +
      '<div class="kv"><span>Earnings</span><b>$' + (a.amount || 0).toFixed(2) + '</b></div>' +
      '<div class="kv"><span>Loads</span><b>' + dayLoadsFor(sel) + '</b></div>' +
      (a.duplicate ? '<div class="note" style="margin-top:6px;color:#c2410c;font-weight:600">⚠️ Recorded more than once — not counted yet. Open the day to fix it.</div>' : '') +
      '<div class="note" style="margin-top:6px">Tap the same day again to open it.</div></div>';
  }

  function manifestFeedPush(kind, summaryText) {
    try {
      var feed = App._store.get('manifest_feed', []);
      feed.push({ ts: Date.now(), date: App._today(), kind: kind, summary: summaryText });
      App._store.set('manifest_feed', feed.slice(-500));
    } catch (e) {}
  }

  /* v46: the day's odometer kilometres, derived at render time from
     the day's session records. Readings live on sessions (startOdo /
     endOdo), and the END reading lands after this module's entry for
     the day was already created at stop — deriving here, via the same
     App._odoDailyKm rule the tracker uses, keeps the display from
     ever drifting from the session record. Sums every session that
     day with a valid pair (end > start); a bad pair contributes
     nothing but its readings stay on the session. */
  function odoKmForDate(ds) {
    if (!(window.App && App._odoDailyKm)) return null;
    var ss = App._store.get('sessions', []) || [];
    var km = 0, any = false;
    for (var i = 0; i < ss.length; i++) {
      if (!ss[i] || ss[i].date !== ds) continue;
      var d = App._odoDailyKm(ss[i]);
      if (d !== null && d !== undefined) { km += d; any = true; }
    }
    return any ? Math.round(km * 100) / 100 : null;
  }

  /* v43: two-tap in-app delete confirm — the native confirm dialog
     freezes the page renderer in automated Chromium (the Oct 13 data
     load died twice on exactly that click) and is clunky on mobile.
     First tap ARMS the button for ~3.5s ("Sure? Tap again to delete",
     app-red); a second tap while armed runs the delete. Arm state
     lives on the button element itself, so a fresh render (new DOM)
     always starts every button unarmed.
     v47: moved to module scope (was a render-local helper) so the Day
     Details view binds its entry/extra deletes identically. */
  function bindTwoTapDelete(body, sel, del) {
    body.querySelectorAll(sel).forEach(function (b) {
      b.onclick = function () {
        if (b.getAttribute('data-armed') === '1') {
          if (b._armT) clearTimeout(b._armT);
          del(b);
          return;
        }
        var label = b.textContent;
        b.setAttribute('data-armed', '1');
        b.textContent = 'Sure? Tap again to delete';
        b.style.background = '#e74c3c';
        b.style.color = '#fff';
        b._armT = setTimeout(function () {
          if (!document.body.contains(b)) return;
          b.removeAttribute('data-armed');
          b.textContent = label;
          b.style.background = '';
          b.style.color = '';
        }, 3500);
      };
    });
  }

  /* DAY-DETAIL-BEGIN — v47: everything the Day Details view shows
     for one date, assembled from the existing stores only — no new
     data model. Day totals come from dayAgg() itself, so the detail
     page can never disagree with the Month row that led to it; entry
     amounts are priced with the same payCtx and payFor pair dayAgg
     uses. Sessions return raw millisecond stamps (start derived as
     endedAt minus seconds — the only start the record supports) and
     the renderer formats them; fields the record does not carry come
     back null and are omitted at render, never shown blank.
     Harness-extractable: may use entries, extras, dayAgg, payCtx,
     payFor, App._store and App._odoDailyKm. */
  function dayDetailData(ds) {
    var agg = dayAgg()[ds] || { hours: 0, base: 0, extrasAmt: 0, amount: 0, hasEntry: false, live: false, unconfirmed: false, duplicate: false };
    var ctx = payCtx();
    var o = App._store.get('onboarding', {});
    var ents = [];
    entries().forEach(function (e, i) {
      if (!e || e.date !== ds) return;
      ents.push({
        index: i, type: e.type || 'load',
        hours: parseFloat(e.hours) || 0, miles: parseFloat(e.miles) || 0,
        tons: parseFloat(e.tons) || 0, trips: parseFloat(e.trips) || 0,
        loads: parseInt(e.loads, 10) || 0,
        amount: payFor(e, ctx.std, ownRate(o)),
        note: e.note || '', auto: !!e.auto, handEdited: !!e.handEdited /* v160: the origin truth rides the projection */
      });
    });
    /* v116 (owner, Oct 16 2026, screenshot of Thu Oct 15): the
       header above this list prices the day ONCE through the shared
       per-day builder ($333.50 / 11.5h) while the list showed every
       raw record as money — the sheet import, the dispatch
       completion AND two 0.01h tracker drips, $667.47 of rows
       against a $333.50 header. The list must tell the header's
       truth: the day's MONEY entries are exactly the records of
       the source the builder's ladder chose for this date (for
       Oct 15 the dispatch record); every other record is EVIDENCE
       and returns separately, to be shown with NO dollar amounts.
       A tracker drip (an auto entry under 0.1 of the pay unit) is
       never a money entry. When the builder is somehow absent the
       legacy all-entries list stands — the same fallback dayAgg
       itself makes. */
    var winSrc = null, haveBuilt = false;
    try {
      if (window.Meticulous && Meticulous.shared && Meticulous.shared.buildRevenueLines) {
        var builtD = Meticulous.shared.buildRevenueLines(entries(), extras(), ctx.rate, ctx.std, App._store.get('pnl_card_wages', []) || []);
        haveBuilt = true;
        (builtD.lines || []).forEach(function (l) {
          if (l && l.date === ds && l.src !== 'extra') winSrc = l.src;
        });
      }
    } catch (e2) { haveBuilt = false; winSrc = null; }
    var srcFn = null;
    try {
      if (window.Meticulous && Meticulous.shared && Meticulous.shared.revenueEntrySource) srcFn = Meticulous.shared.revenueEntrySource;
    } catch (e3) { srcFn = null; }
    function srcOf(e) {
      if (srcFn) { try { return srcFn(e); } catch (err) {} }
      if (!e) return 'entry';
      if (e.auto) return 'tracker';
      var n = e.note || '';
      if (n.indexOf('Dispatch:') === 0) return 'dispatch';
      if (n === 'Auto from tracker') return 'tracker';
      return 'entry';
    }
    var moneyEnts = [], evidence = [];
    ents.forEach(function (r) {
      r.src = srcOf(entries()[r.index]);
      var q = ctx.std === 'miles' ? r.miles : ctx.std === 'trip' ? r.trips : ctx.std === 'weight' ? r.tons : r.hours;
      r.drip = (r.src === 'tracker' && q < 0.1);
      if (!haveBuilt) { moneyEnts.push(r); return; }
      if (!r.drip && winSrc && r.src === winSrc && r.amount > 0) moneyEnts.push(r);
      else evidence.push(r);
    });
    var xtras = [];
    extras().forEach(function (x, i) {
      if (!x || x.date !== ds) return;
      xtras.push({ index: i, type: x.type || 'other', amount: parseFloat(x.amount) || 0, note: x.note || '' });
    });
    var sessions = [];
    (App._store.get('sessions', []) || []).forEach(function (s) {
      if (!s || s.date !== ds) return;
      var endMs = s.endedAt ? Date.parse(s.endedAt) : null;
      if (!(endMs > 0)) endMs = null;
      var sec = parseFloat(s.seconds) || 0;
      sessions.push({
        startMs: (endMs !== null && sec > 0) ? endMs - sec * 1000 : null,
        endMs: endMs, seconds: sec,
        startOdo: parseFloat(s.startOdo) > 0 ? parseFloat(s.startOdo) : null,
        endOdo: parseFloat(s.endOdo) > 0 ? parseFloat(s.endOdo) : null,
        odoKm: (window.App && App._odoDailyKm) ? App._odoDailyKm(s) : null,
        liveKm: (typeof s.liveKm === 'number') ? s.liveKm : null,
        milesStatus: s.milesStatus || null
      });
    });
    var fuel = [];
    (App._store.get('fuel_fills', []) || []).forEach(function (f) {
      if (!f || f.date !== ds) return;
      fuel.push({
        litres: parseFloat(f.litres) || 0, cost: parseFloat(f.cost) || 0,
        station: f.station || '', odo: parseFloat(f.odo) > 0 ? parseFloat(f.odo) : null
      });
    });
    var dispatches = [];
    (App._store.get('dsp_list', []) || []).forEach(function (d) {
      if (!d) return;
      /* v153: filed by the record's date truth — scheduledAt's
         date wins, the same derivation summary() and
         dayLoadsFor() above already use; the raw stored date
         alone filed a disagreeing record under the wrong day. */
      var sd = '';
      if (typeof d.scheduledAt === 'string') { var mm = /^(\d{4}-\d{2}-\d{2})/.exec(d.scheduledAt); if (mm) sd = mm[1]; }
      if ((sd || d.date) !== ds) return;
      dispatches.push({ jobSite: d.jobSite || d.pickup || 'Dispatch', status: d.status || '', ticketNo: d.ticketNo || '' });
    });
    return {
      date: ds, hours: agg.hours, amount: agg.amount, extrasAmt: agg.extrasAmt, live: !!agg.live,
      unconfirmed: !!agg.unconfirmed, duplicate: !!agg.duplicate,
      entries: moneyEnts, evidence: evidence, extras: xtras, sessions: sessions, fuel: fuel, dispatches: dispatches
    };
  }

  /* v75: entry/extra EDITING for Day Details (owner, Oct 14:
     "make sure revenue entries are clickable as well" — v47 made a
     day's entries visible and deletable, but there was still no way
     to VIEW one day from the period chart or the main lists, and no
     way to EDIT an entry anywhere). applyEntryEdit / applyExtraEdit
     are pure: the original record's other fields (date, auto, any
     keys the form doesn't know) survive, the form's fields win, and
     a quantity the form leaves blank is REMOVED so payFor can never
     price a ghost. saveEntriesVerified / saveExtrasVerified are the
     v48 rule — write, read back, byte-compare; false means the
     stored list is unchanged and the caller keeps the edit form
     open with a plain in-page error. */
  function applyEntryEdit(orig, form, amtAutoPriced) {
    var e = {};
    for (var k in orig) { if (Object.prototype.hasOwnProperty.call(orig, k)) e[k] = orig[k]; }
    e.type = form.type || e.type || 'load';
    e.amount = (parseFloat(form.amount) || 0).toFixed(2);
    e.loads = parseInt(form.loads, 10) || 1;
    e.note = form.note || '';
    ['hours', 'miles', 'tons', 'trips'].forEach(function (name) {
      var v = parseFloat(form[name]);
      if (v > 0) e[name] = v; else delete e[name];
    });
    /* v160 (owner, Oct 17, 2026, evening — his own repair of the
       Oct 17 day): he hand-edited the tracker-created entry's
       hours through this door, saved, and the entry still wore
       "Auto from tracker" — a pure-auto origin claim over numbers
       his hand had set. ENTRY ORIGIN TRUTH: when an auto-created
       entry's NUMBERS change through this door, the saved record
       is stamped handEdited. The creation facts are NOT rewritten
       (auto stays, the note stays — the source classifiers that
       key on them keep the day's provenance); only the PRESENTED
       origin changes (the render sites print "auto · edited by
       hand" for a stamped entry). What counts as his hand: the
       type, any quantity (hours / miles / tons / trips / loads),
       or the amount — EXCEPT an amount change amtAutoPriced
       names as the door's own v152 recompute over UNCHANGED
       quantities (the door's math is not his hand, so a save that
       changes nothing of his stamps nothing). A note-only edit
       stamps nothing: his words replace the note themselves,
       and the numbers remain the tracker's. Once stamped, the
       mark stays (the copy above carries it) — a later no-op
       save never un-writes the history. */
    if (orig && orig.auto && !e.handEdited) {
      var num = function (v) { var n = parseFloat(v); return isFinite(n) ? n : 0; };
      var qtyChanged = num(e.hours) !== num(orig.hours) || num(e.miles) !== num(orig.miles) ||
        num(e.tons) !== num(orig.tons) || num(e.trips) !== num(orig.trips) ||
        (parseInt(e.loads, 10) || 1) !== (parseInt(orig.loads, 10) || 1);
      var amtChanged = num(e.amount).toFixed(2) !== num(orig.amount).toFixed(2);
      if (e.type !== (orig.type || 'load') || qtyChanged || (amtChanged && !amtAutoPriced)) e.handEdited = true;
    }
    return e;
  }
  function applyExtraEdit(orig, form) {
    var x = {};
    for (var k in orig) { if (Object.prototype.hasOwnProperty.call(orig, k)) x[k] = orig[k]; }
    x.type = form.type || x.type || 'other';
    x.amount = (parseFloat(form.amount) || 0).toFixed(2);
    x.note = form.note || '';
    return x;
  }
  function saveEntriesVerified(list) {
    W('entries', list);
    var back = S('entries', null);
    if (JSON.stringify(back) !== JSON.stringify(list)) return false;
    /* the cloud mirror saveEntries performs, once the local write
       is proven — mirrors never precede the verified local save. */
    if (window.FB && FB.saveDoc) list.forEach(function (x, i) {
      try { FB.saveDoc('revenue', 'e' + i + '_' + (x.date || ''), x); } catch (err) {}
    });
    return true;
  }
  function saveExtrasVerified(list) {
    W('extras', list);
    var back = S('extras', null);
    return JSON.stringify(back) === JSON.stringify(list);
  }
  /* DAY-DETAIL-END */

  /* v47: Day Details — opened by tapping a day row in the Month view
     (owner, Oct 14: "Why can I not click on a specific day and see the
     details of that day?"). Renders into the same module body; Back
     clears dayDetailDate and re-renders Revenue, and because view and
     month live in the store (rev_view, rev_monthCur), the driver
     lands on the same Month view and month they left. Entry and extra
     deletes wire the SAME two-tap confirm the main lists use — there
     is no entry edit UI anywhere in Revenue (entries are add/delete
     only), so deletes are the wiring there is to reuse. */
  function fmtClockTime(ms) {
    return new Date(ms).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
  }
  function renderDayDetail(body) {
    var ds = dayDetailDate;
    /* v152: the wage rate when THIS paint's hourly amount is
       computed (0 = the amount is a typed field on this paint);
       the wiring at the bottom reads it for the live follow. */
    var edLiveRate = 0;
    /* v152: snapshot the entry form's current field values into
       dayEditDraft, so the re-renders the amount door performs
       (unlock / back-to-auto / a Type flip) never lose what the
       man already typed — the same draft the failed-save path
       reopens with. */
    function snapshotEntryForm(b) {
      if (!dayEdit || dayEdit.kind !== 'entry') return;
      var g = function (id) { var el = b.querySelector(id); return el ? el.value : ''; };
      dayEditDraft = { kind: 'entry', index: dayEdit.index, form: {
        type: g('#rv_ed_type'), amount: g('#rv_ed_amt'), loads: g('#rv_ed_loads'),
        hours: g('#rv_ed_hours'), miles: g('#rv_ed_miles'), tons: g('#rv_ed_tons'),
        trips: g('#rv_ed_trips'), note: g('#rv_ed_note').trim()
      } };
    }
    var d = dayDetailData(ds);
    /* v116: the evidence card's open state belongs to ONE day —
       arriving on a new day starts it collapsed, EXCEPT a
       duplicate day, which starts it open (the evidence is the
       fix-it path the header banner points at). After arrival the
       owner can open/close it freely. */
    if (dayEvidenceDate !== ds) { dayEvidenceDate = ds; dayEvidenceOpen = !!d.duplicate; }
    /* v75: an edit target that no longer exists (deleted elsewhere)
       closes the edit quietly — never edit a ghost. */
    if (dayEdit) {
      var tgt = dayEdit.kind === 'entry' ? entries()[dayEdit.index] : extras()[dayEdit.index];
      if (!tgt) { dayEdit = null; dayEditErr = ''; dayEditAmtCustom = false; }
    }
    var title = new Date(ds + 'T12:00:00').toLocaleDateString('en',
      { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    var h = '<button class="btn small ghost" id="rv_day_back" style="margin-bottom:10px">‹ Back</button>';
    h += '<div class="card"><h3>🗓 ' + esc(title) + '</h3>' +
      '<div class="kv"><span>Hours</span><b>' + fmtH(d.hours) + '</b></div>' +
      '<div class="kv"><span>Earnings</span><b>$' + d.amount.toFixed(2) + '</b></div>' +
      (d.extrasAmt > 0 ? '<div class="note" style="margin-top:6px">Earnings include $' + d.extrasAmt.toFixed(2) + ' in extras (listed below).</div>' : '') +
      (d.live ? '<div class="note" style="margin-top:6px">● Tracker still running — this day is counted live; the finished session lands here when you stop.</div>' : '') +
      /* v81: the day's provenance, in plain words — the totals above
         follow the invoice's rule (one confirmed source per day). */
      (d.duplicate ? '<div class="note" style="margin-top:6px;color:#c2410c;font-weight:600">⚠️ This day has more than one tracker entry and no dispatch completion to confirm it, so it is NOT counted in your totals. Fix it below — keep the right entry and delete the other.</div>' : '') +
      (d.unconfirmed ? '<div class="note" style="margin-top:6px">This day\'s total comes from the tracker only — unconfirmed. Complete the day\'s dispatch (or check the entry below) to confirm it.</div>' : '') +
      '</div>';
    if (dayErr) {
      h += '<div class="card"><div style="color:#c2410c;font-weight:600">⚠️ ' + esc(dayErr) + '</div></div>';
    }
    /* v75: THE EDIT FORM — one card, right under the day's totals,
       prefilled with the record's own values. Amount is the number
       that prices the entry (payFor's rule: an amount over 0 wins);
       the quantity fields are there for the records that carry them
       (hours-sheet and tracker days) — blanking one removes it.
       After a FAILED save the form reopens with dayEditDraft's
       values, so what he typed is genuinely still there. */
    if (dayEdit) {
      var rec = dayEdit.kind === 'entry' ? entries()[dayEdit.index] : extras()[dayEdit.index];
      var draft = (dayEditDraft && dayEditDraft.kind === dayEdit.kind && dayEditDraft.index === dayEdit.index) ? dayEditDraft.form : null;
      function fv(name, raw) {
        if (draft && draft[name] !== undefined) return draft[name];
        return (raw === undefined || raw === null) ? '' : raw;
      }
      h += '<div class="card" style="border:2px solid var(--orange)"><h3>✏️ Edit ' + (dayEdit.kind === 'entry' ? 'entry' : 'extra') + '</h3>' +
        (dayEditErr ? '<div style="color:#c2410c;font-weight:600;margin-bottom:8px">⚠️ ' + esc(dayEditErr) + '</div>' : '');
      if (dayEdit.kind === 'entry') {
        var typeOpts = ['load', 'hourly', 'miles', 'trip', 'weight'].map(function (t) {
          return '<option value="' + t + '"' + (fv('type', rec.type || 'load') === t ? ' selected' : '') + '>' + t + '</option>';
        }).join('');
        /* v152 (owner, Oct 17 22:12: "Why is this edit asking me
           for amount it should know by it self"): an HOURLY
           entry's amount IS hours x his wage rate — the chain the
           books price with (ownRate: ownWageRate || payRate). It
           renders computed and read-only, follows the Hours field
           live (wiring below), and the save recomputes it, so an
           hourly pair can never store hours that say one thing
           and dollars that say another. The one deliberate door:
           "Type a different amount" (dayEditAmtCustom) unlocks
           typing for THIS edit only, starting from the computed
           figure. Non-hourly types — and any entry when no wage
           rate is on file — keep the typed field exactly as
           before: the app only prices what it actually knows. */
        var edRate = ownRate(App._store.get('onboarding', {}));
        var edIsHourly = fv('type', rec.type || 'load') === 'hourly';
        var edAutoAmt = edIsHourly && edRate > 0 && !dayEditAmtCustom;
        var edAutoVal = (Math.max(0, parseFloat(fv('hours', rec.hours)) || 0) * edRate).toFixed(2);
        var edAmtCell;
        if (edAutoAmt) {
          edLiveRate = edRate;
          edAmtCell = '<div><label class="f">Amount $ — hours × $' + edRate.toFixed(2) + '/hr</label>' +
            '<input id="rv_ed_amt" type="number" inputmode="decimal" min="0" step="0.01" value="' + edAutoVal + '" readonly>' +
            '<div class="note" style="margin-top:4px">Priced from your hours — it follows when the hours change.</div>' +
            '<button class="btn small ghost" id="rv_ed_amt_unlock" type="button" style="margin-top:6px">Type a different amount</button></div>';
        } else if (edIsHourly && edRate > 0) {
          edAmtCell = '<div><label class="f">Amount $</label>' +
            '<input id="rv_ed_amt" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(fv('amount', rec.amount)) + '">' +
            '<button class="btn small ghost" id="rv_ed_amt_auto" type="button" style="margin-top:6px">Use hours × rate ($' + edAutoVal + ')</button></div>';
        } else {
          edAmtCell = '<div><label class="f">Amount $</label><input id="rv_ed_amt" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(fv('amount', rec.amount)) + '"></div>';
        }
        h += '<div class="row"><div><label class="f">Type</label><select id="rv_ed_type">' + typeOpts + '</select></div>' +
          edAmtCell + '</div>' +
          '<div class="row"><div><label class="f">Hours</label><input id="rv_ed_hours" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(fv('hours', rec.hours)) + '"></div>' +
          '<div><label class="f">Loads</label><input id="rv_ed_loads" type="number" min="1" step="1" value="' + esc(fv('loads', rec.loads || 1)) + '"></div></div>' +
          '<div class="row"><div><label class="f">Miles (km)</label><input id="rv_ed_miles" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(fv('miles', rec.miles)) + '"></div>' +
          '<div><label class="f">Tonnes</label><input id="rv_ed_tons" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(fv('tons', rec.tons)) + '"></div></div>' +
          '<div class="row"><div><label class="f">Trips</label><input id="rv_ed_trips" type="number" inputmode="decimal" min="0" step="1" value="' + esc(fv('trips', rec.trips)) + '"></div></div>' +
          '<label class="f">Note</label><input id="rv_ed_note" value="' + esc(fv('note', rec.note)) + '">';
      } else {
        var xOpts = ['bonus', 'detention', 'reimbursement', 'other'].map(function (t) {
          return '<option value="' + t + '"' + (fv('type', rec.type || 'other') === t ? ' selected' : '') + '>' + t + '</option>';
        }).join('');
        h += '<div class="row"><div><label class="f">Type</label><select id="rv_ed_xtype">' + xOpts + '</select></div>' +
          '<div><label class="f">Amount $</label><input id="rv_ed_xamt" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(fv('amount', rec.amount)) + '"></div></div>' +
          '<label class="f">Note</label><input id="rv_ed_xnote" value="' + esc(fv('note', rec.note)) + '">';
      }
      h += '<div class="row" style="margin-top:10px"><button class="btn primary" id="rv_ed_save">💾 Save changes</button>' +
        '<button class="btn ghost" id="rv_ed_cancel">Cancel</button></div></div>';
    }
    if (d.entries.length) {
      h += '<div class="card"><h3>📒 Entries</h3>' + d.entries.map(function (e) {
        var parts = [];
        if (e.hours > 0) parts.push(fmtH(e.hours) + 'h');
        if (e.miles > 0) parts.push(e.miles + ' km');
        if (e.tons > 0) parts.push(e.tons + 't');
        if (e.trips > 0) parts.push(e.trips + ' trip' + (e.trips === 1 ? '' : 's'));
        if (e.type === 'load' && e.loads > 0) parts.push(e.loads + ' load' + (e.loads === 1 ? '' : 's'));
        if (e.note) parts.push(e.note);
        if (e.auto) parts.push(e.handEdited ? 'auto · edited by hand' : 'auto');
        var editingThis = dayEdit && dayEdit.kind === 'entry' && dayEdit.index === e.index;
        return '<div class="listitem"><div class="a">$' + e.amount.toFixed(2) + ' <span class="pill">' + esc(e.type) + '</span></div>' +
          (parts.length ? '<div class="b">' + esc(parts.join(' · ')) + '</div>' : '') +
          (editingThis ? '<div class="b" style="color:var(--orange);font-weight:700">✏️ You\'re editing this one — the form is at the top of this page ↑</div>' :
            '<div class="row" style="margin-top:6px"><button class="btn small ghost" data-rvedit="' + e.index + '">✏️ Edit</button>' +
            (dayEdit ? '' : '<button class="btn small ghost" data-rvdel="' + e.index + '">Delete</button>') + '</div>') + '</div>';
      }).join('') + '</div>';
    }
    /* v116: ALSO RECORDED — the day's other records (a duplicate
       sheet import, a second recording, tracker drips). They are
       EVIDENCE, not earnings: no dollar amount is ever shown for
       them, so this list can never disagree with the header. The
       card starts collapsed; a duplicate day opens it (the header
       banner's "fix it below" points here, and the rows keep their
       Edit/Delete so the fix stays possible). */
    if (d.evidence && d.evidence.length) {
      var evOpen = dayEvidenceOpen;
      h += '<div class="card"><h3>🗂 Also recorded <span style="font-weight:400;color:var(--muted);font-size:13px">— not counted in this day\'s totals</span></h3>' +
        '<button class="btn small ghost" id="rv_ev_toggle">' + (evOpen ? 'Hide' : 'Show') + ' (' + d.evidence.length + ')</button>';
      if (evOpen) {
        h += d.evidence.map(function (e) {
          var parts = [];
          if (e.hours > 0) parts.push(fmtH(e.hours) + 'h');
          if (e.miles > 0) parts.push(e.miles + ' km');
          if (e.tons > 0) parts.push(e.tons + 't');
          if (e.trips > 0) parts.push(e.trips + ' trip' + (e.trips === 1 ? '' : 's'));
          if (e.type === 'load' && e.loads > 0) parts.push(e.loads + ' load' + (e.loads === 1 ? '' : 's'));
          if (e.note) parts.push(e.note);
          if (e.auto) parts.push(e.handEdited ? 'auto · edited by hand' : 'auto');
          if (e.drip) parts.push('tracker drip — under 0.1h, never counted');
          var editingThisE = dayEdit && dayEdit.kind === 'entry' && dayEdit.index === e.index;
          return '<div class="listitem"><div class="a"><span class="pill">' + esc(e.type) + '</span></div>' +
            (parts.length ? '<div class="b">' + esc(parts.join(' · ')) + '</div>' : '') +
            (editingThisE ? '<div class="b" style="color:var(--orange);font-weight:700">✏️ You\'re editing this one — the form is at the top of this page ↑</div>' :
              '<div class="row" style="margin-top:6px">' + (e.drip ? '' : '<button class="btn small ghost" data-rvedit="' + e.index + '">✏️ Edit</button>') +
              (dayEdit ? '' : '<button class="btn small ghost" data-rvdel="' + e.index + '">Delete</button>') + '</div>') + '</div>';
        }).join('');
      }
      h += '</div>';
    }
    if (d.extras.length) {
      h += '<div class="card"><h3>✨ Extras</h3>' + d.extras.map(function (x) {
        var editingThisX = dayEdit && dayEdit.kind === 'extra' && dayEdit.index === x.index;
        return '<div class="listitem"><div class="a">' + esc(x.type) + ' — $' + x.amount.toFixed(2) + '</div>' +
          (x.note ? '<div class="b">' + esc(x.note) + '</div>' : '') +
          (editingThisX ? '<div class="b" style="color:var(--orange);font-weight:700">✏️ You\'re editing this one — the form is at the top of this page ↑</div>' :
            '<div class="row" style="margin-top:6px"><button class="btn small ghost" data-rxedit="' + x.index + '">✏️ Edit</button>' +
            (dayEdit ? '' : '<button class="btn small ghost" data-rxdel="' + x.index + '">Delete</button>') + '</div>') + '</div>';
      }).join('') + '</div>';
    }
    if (d.sessions.length) {
      h += '<div class="card"><h3>⏱ Tracker session' + (d.sessions.length > 1 ? 's' : '') + '</h3>' +
        d.sessions.map(function (s, si) {
          var rows = '';
          if (d.sessions.length > 1) rows += '<div class="note" style="margin:8px 0 2px">Session ' + (si + 1) + '</div>';
          if (s.startMs !== null) rows += '<div class="kv"><span>Started</span><b>' + fmtClockTime(s.startMs) + '</b></div>';
          if (s.endMs !== null) rows += '<div class="kv"><span>Ended</span><b>' + fmtClockTime(s.endMs) + '</b></div>';
          if (s.seconds > 0) rows += '<div class="kv"><span>Duration</span><b>' + fmtH(s.seconds / 3600) + 'h</b></div>';
          if (s.startOdo !== null) rows += '<div class="kv"><span>Start odometer</span><b>' + s.startOdo + ' km</b></div>';
          if (s.endOdo !== null) rows += '<div class="kv"><span>End odometer</span><b>' + s.endOdo + ' km</b></div>';
          if (s.odoKm !== null && s.odoKm !== undefined) rows += '<div class="kv"><span>Odometer distance</span><b>🛣 ' + (+s.odoKm.toFixed(1)) + ' km</b></div>';
          if (s.liveKm !== null) rows += '<div class="kv"><span>Live GPS distance</span><b>' + (+s.liveKm.toFixed(1)) + ' km</b></div>';
          if (s.milesStatus) rows += '<div class="kv"><span>Miles check</span><b>' + (s.milesStatus === 'confirmed' ? '✓ Matches odometer' : '⚠️ Differs from odometer') + '</b></div>';
          return rows;
        }).join('') + '</div>';
    }
    if (d.fuel.length) {
      h += '<div class="card"><h3>⛽ Fuel</h3>' + d.fuel.map(function (f) {
        var b = [];
        if (f.litres > 0) b.push(f.litres + ' L');
        if (f.odo !== null) b.push('odo ' + f.odo);
        return '<div class="listitem"><div class="a">' + esc(f.station || 'Fill-up') + ' — $' + f.cost.toFixed(2) + '</div>' +
          (b.length ? '<div class="b">' + esc(b.join(' · ')) + '</div>' : '') + '</div>';
      }).join('') + '</div>';
    }
    if (d.dispatches.length) {
      h += '<div class="card"><h3>🚚 Dispatches (' + d.dispatches.length + ')</h3>' + d.dispatches.map(function (x) {
        var b = [];
        if (x.status) b.push(x.status);
        if (x.ticketNo) b.push('ticket #' + x.ticketNo);
        return '<div class="listitem"><div class="a">' + esc(x.jobSite) + '</div>' +
          (b.length ? '<div class="b">' + esc(b.join(' · ')) + '</div>' : '') + '</div>';
      }).join('') + '</div>';
    }
    if (!d.entries.length && !(d.evidence && d.evidence.length) && !d.extras.length && !d.sessions.length && !d.fuel.length && !d.dispatches.length) {
      h += '<div class="card"><div class="empty">Nothing recorded for this day.</div></div>';
    }
    body.innerHTML = h;
    body.querySelector('#rv_day_back').onclick = function () {
      dayDetailDate = null; dayEdit = null; dayEditErr = ''; dayErr = ''; dayEditDraft = null; dayEditAmtCustom = false;
      api.render(body);
    };
    /* v116: the evidence card's show/hide. */
    var evTgl = body.querySelector('#rv_ev_toggle');
    if (evTgl) evTgl.onclick = function () { dayEvidenceOpen = !dayEvidenceOpen; api.render(body); };
    /* v75: deletes from Day Details are verified too — a failed
       write leaves the record in place and says so on the page. */
    bindTwoTapDelete(body, '[data-rvdel]', function (b) {
      var l = entries(); l.splice(+b.getAttribute('data-rvdel'), 1);
      if (!saveEntriesVerified(l)) {
        dayErr = 'That delete did NOT go through — the app storage on your phone looks full, or the write failed, so nothing was removed.';
      } else { dayErr = ''; }
      api.render(body);
    });
    bindTwoTapDelete(body, '[data-rxdel]', function (b) {
      var l = extras(); l.splice(+b.getAttribute('data-rxdel'), 1);
      if (!saveExtrasVerified(l)) {
        dayErr = 'That delete did NOT go through — the app storage on your phone looks full, or the write failed, so nothing was removed.';
      } else { dayErr = ''; }
      api.render(body);
    });
    /* v75: open an editor (the form renders at the top of the
       detail, and opening one re-renders — the row it came from
       says "you're editing this one" so the tap's effect is visible
       where he tapped too). */
    body.querySelectorAll('[data-rvedit]').forEach(function (b) {
      b.onclick = function () {
        dayEdit = { kind: 'entry', index: +b.getAttribute('data-rvedit') };
        dayEditErr = ''; dayErr = ''; dayEditDraft = null; dayEditAmtCustom = false;
        api.render(body);
        var top = body.querySelector('#rv_day_back');
        if (top && top.scrollIntoView) { try { top.scrollIntoView({ block: 'start' }); } catch (e) {} }
      };
    });
    body.querySelectorAll('[data-rxedit]').forEach(function (b) {
      b.onclick = function () {
        dayEdit = { kind: 'extra', index: +b.getAttribute('data-rxedit') };
        dayEditErr = ''; dayErr = ''; dayEditDraft = null; dayEditAmtCustom = false;
        api.render(body);
        var top = body.querySelector('#rv_day_back');
        if (top && top.scrollIntoView) { try { top.scrollIntoView({ block: 'start' }); } catch (e) {} }
      };
    });
    var edCancel = body.querySelector('#rv_ed_cancel');
    if (edCancel) edCancel.onclick = function () { dayEdit = null; dayEditErr = ''; dayEditDraft = null; dayEditAmtCustom = false; api.render(body); };
    var edSave = body.querySelector('#rv_ed_save');
    if (edSave) edSave.onclick = function () {
      if (!dayEdit) return;
      if (dayEdit.kind === 'entry') {
        var form = {
          type: body.querySelector('#rv_ed_type').value,
          amount: body.querySelector('#rv_ed_amt').value,
          loads: body.querySelector('#rv_ed_loads').value,
          hours: body.querySelector('#rv_ed_hours').value,
          miles: body.querySelector('#rv_ed_miles').value,
          tons: body.querySelector('#rv_ed_tons').value,
          trips: body.querySelector('#rv_ed_trips').value,
          note: body.querySelector('#rv_ed_note').value.trim()
        };
        /* v152: an hourly entry saved WITHOUT the deliberate
           override stores the computed amount — hours x the wage
           rate (ownRate, the chain the books price with) — never
           whatever the field happened to hold, so the stored
           pair always agrees. With no rate on file the typed
           amount stands, exactly as before. */
        var amtAutoPriced = false;
        if (form.type === 'hourly' && !dayEditAmtCustom) {
          var svRate = ownRate(App._store.get('onboarding', {}));
          if (svRate > 0) {
            amtAutoPriced = true; /* v160: the amount below is the door's own math, not the man's typing */
            var svHrs = parseFloat(form.hours);
            form.amount = (svHrs > 0 ? svHrs * svRate : 0).toFixed(2);
          }
        }
        dayEditDraft = { kind: 'entry', index: dayEdit.index, form: form };
        var amt = parseFloat(form.amount);
        if (!(amt >= 0) || isNaN(amt)) {
          dayEditErr = 'Enter the amount (0 or more) — nothing was saved.';
          api.render(body); return;
        }
        var l = entries();
        if (!l[dayEdit.index]) { dayEdit = null; dayEditDraft = null; api.render(body); return; }
        l[dayEdit.index] = applyEntryEdit(l[dayEdit.index], form, amtAutoPriced);
        if (!saveEntriesVerified(l)) {
          dayEditErr = 'Those changes did NOT go through — the app storage on your phone looks full, or the write failed, so the entry is unchanged. Your edit is still in the form — free up some phone space and tap “Save changes” again.';
          api.render(body); return;
        }
      } else {
        var xform = {
          type: body.querySelector('#rv_ed_xtype').value,
          amount: body.querySelector('#rv_ed_xamt').value,
          note: body.querySelector('#rv_ed_xnote').value.trim()
        };
        dayEditDraft = { kind: 'extra', index: dayEdit.index, form: xform };
        var xamt = parseFloat(xform.amount);
        if (!(xamt >= 0) || isNaN(xamt)) {
          dayEditErr = 'Enter the amount (0 or more) — nothing was saved.';
          api.render(body); return;
        }
        var xl = extras();
        if (!xl[dayEdit.index]) { dayEdit = null; dayEditDraft = null; api.render(body); return; }
        xl[dayEdit.index] = applyExtraEdit(xl[dayEdit.index], xform);
        if (!saveExtrasVerified(xl)) {
          dayEditErr = 'Those changes did NOT go through — the app storage on your phone looks full, or the write failed, so the extra is unchanged. Your edit is still in the form — free up some phone space and tap “Save changes” again.';
          api.render(body); return;
        }
      }
      dayEdit = null; dayEditErr = ''; dayErr = ''; dayEditDraft = null; dayEditAmtCustom = false;
      api.render(body);
    };
    /* v152: the auto-price door's wiring. A Type flip re-renders
       (the amount's mode follows the type — hourly locks to the
       computed figure, anything else is a typed field); the
       unlock / back-to-auto buttons flip dayEditAmtCustom for
       THIS edit; Hours edits repaint the computed amount live.
       Every flip snapshots the form first (snapshotEntryForm),
       so what the man already typed survives the re-render. */
    var edTypeSel = body.querySelector('#rv_ed_type');
    if (edTypeSel) edTypeSel.onchange = function () { snapshotEntryForm(body); api.render(body); };
    var edUnlock = body.querySelector('#rv_ed_amt_unlock');
    if (edUnlock) edUnlock.onclick = function () { snapshotEntryForm(body); dayEditAmtCustom = true; api.render(body); };
    var edAutoBtn = body.querySelector('#rv_ed_amt_auto');
    if (edAutoBtn) edAutoBtn.onclick = function () { snapshotEntryForm(body); dayEditAmtCustom = false; api.render(body); };
    var edHrsIn = body.querySelector('#rv_ed_hours');
    var edAmtIn = body.querySelector('#rv_ed_amt');
    if (edHrsIn && edAmtIn && edLiveRate > 0) {
      edHrsIn.oninput = function () {
        var hv = parseFloat(edHrsIn.value) || 0;
        edAmtIn.value = (Math.max(0, hv) * edLiveRate).toFixed(2);
      };
    }
  }

  var lastImport = null; // v38: result of the latest paste-import, shown after re-render
  var dayDetailDate = null; // v47: date whose Day Details are showing, or null for the normal Revenue view
  var formView = null; // v201 REV-CLEAN: 'manual' | 'extras' — the form opened from the top tabs, or null for the Revenue face
  var asOpen = false; // v201 REV-CLEAN: the auto-start menu panel on the Revenue face (collapsed until its button is tapped)
  /* v75: the entry/extra being edited inside Day Details
     ({kind:'entry'|'extra', index} into the FULL stored list), the
     message a failed verified save/delete leaves on the detail view,
     and the standalone delete-failure line. While an edit is open
     the lists' Delete buttons are not rendered at all — deleting a
     different row would shift the indexes the edit points at. */
  var dayEdit = null;
  var dayEditErr = '';
  var dayErr = '';
  var dayEditDraft = null; // v75: form values of a FAILED save, so the reopened editor still holds them
  /* v152: while an HOURLY entry is edited, its amount is computed
     (hours x wage rate) and read-only; this flag is the ONE
     deliberate exception — the man tapped "Type a different
     amount" for THIS edit. It resets whenever an edit opens,
     cancels, saves, or the view resets, so an override can never
     leak into another edit. */
  var dayEditAmtCustom = false;
  /* v116: the graph's two-tap selection (a date string) — first
     tap selects + previews, second tap on the same day opens its
     detail. See graphTap / paintGraphPreview below. */
  var graphSel = null;
  var rvShowAll = false; /* v164: the Entries list shows the latest 3 until asked for more */
  /* v116: the day detail's "Also recorded" evidence card —
     collapsed unless the owner opens it (or the day is a duplicate,
     where the evidence IS the fix-it path, so it starts open).
     Scoped to a date so switching days re-collapses it. */
  var dayEvidenceOpen = false;
  var dayEvidenceDate = '';
  /* v116: the last body render() painted into — the shell's back
     contract (api.back) re-renders through it. */
  var lastBody = null;

  /* v201 REV-CLEAN (owner, Oct 21, 2026 09:50–09:53 MDT): the
     Manual entry and Extras forms on their OWN views, opened from
     the two small tabs at the top of the Revenue face — the older,
     cleaner design he asked back ("Manual entry and Extras live
     at the TOP as tappable entries that OPEN a separate page; the
     forms never sit on the Revenue face"). Both forms are the
     pre-v201 face cards VERBATIM — same fields, same ids, same
     save behavior (api.addEntry / the extras store write, same
     manifest feed lines); a save returns to the face, where the
     new money shows in the chart and the Entries list. The
     extras LIST rides with its form (it is the extras history —
     history belongs behind the tap, per the NO-SCROLL rule). */
  function renderFormView(body) {
    lastBody = body;
    var h = '<button class="btn small ghost" id="rv_form_back" style="margin-bottom:10px">‹ Back</button>';
    if (formView === 'manual') {
      h += '<div class="card"><h3>＋ Manual entry</h3>' +
        '<div class="row"><div><label class="f">Date</label><input type="date" id="rv_date" value="' + App._today() + '"></div>' +
        '<div><label class="f">Amount $</label><input id="rv_amt" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"></div></div>' +
        '<div class="row"><div><label class="f">Type</label><select id="rv_type"><option value="load">Load</option><option value="hourly">Hourly</option><option value="trip">Trip</option><option value="weight">Weight</option></select></div>' +
        '<div><label class="f">Loads</label><input id="rv_loads" type="number" min="1" step="1" value="1"></div></div>' +
        '<div id="rv_tonsrow" style="display:none"><label class="f">Tonnes (net weight)</label><input id="rv_tons" type="number" inputmode="decimal" min="0" step="0.01" placeholder="e.g. 12.18"></div>' +
        '<label class="f">Note</label><input id="rv_note" placeholder="e.g. Gravel haul to Site 7">' +
        '<button class="btn primary" id="rv_add">Add earnings</button></div>';
    } else {
      h += '<div class="card"><h3>✨ Extras</h3>' +
        '<div class="row"><div><label class="f">Type</label><select id="rx_type"><option value="bonus">Bonus</option><option value="detention">Detention pay</option><option value="reimbursement">Reimbursement</option><option value="other">Other</option></select></div>' +
        '<div><label class="f">Amount $</label><input id="rx_amt" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"></div></div>' +
        '<label class="f">Date</label><input type="date" id="rx_date" value="' + App._today() + '">' +
        '<label class="f">Note</label><input id="rx_note" placeholder="e.g. 3h wait at pit">' +
        '<button class="btn navy" id="rx_add">Add extra</button>' +
        '<div id="rx_list">' + (extras().length ? extras().slice().reverse().map(function (x, ri) {
          return '<div class="listitem" data-day-link="' + esc(x.date) + '" style="cursor:pointer"><div class="a">' + esc(x.type) + ' — $' + esc(x.amount) + '</div><div class="b">' + esc(x.date) + (x.note ? ' · ' + esc(x.note) : '') + ' · tap to open the day</div>' +
            '<div class="row" style="margin-top:6px"><button class="btn small ghost" data-rxdel="' + (extras().length - 1 - ri) + '">Delete</button></div></div>';
        }).join('') : '<div class="empty">No extras yet.</div>') + '</div></div>';
    }
    body.innerHTML = h;
    body.querySelector('#rv_form_back').onclick = function () { formView = null; api.render(body); };
    if (formView === 'manual') {
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
          var rate = ownRate(o);
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
        formView = null;
        api.render(body);
      };
    } else {
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
        formView = null;
        api.render(body);
      };
      bindTwoTapDelete(body, '[data-rxdel]', function (b) {
        var l = extras(); l.splice(+b.getAttribute('data-rxdel'), 1); W('extras', l); api.render(body);
      });
      body.querySelectorAll('[data-day-link]').forEach(function (el) {
        el.onclick = function (ev) {
          if (ev && ev.target && ev.target.closest &&
              ev.target.closest('[data-rxdel]')) return;
          dayDetailDate = el.getAttribute('data-day-link');
          api.render(body);
        };
      });
    }
  }

  var api = {
    /* v124: the dashboard card quotes the SAME period the owner
       selected inside Revenue — his catch, Oct 17 07:45: "why is
       it not showing me what I have selected inside as my
       period". The v118 fixed "Last 30d" below was a repair that
       outlived its day: it stopped the number changing its mind
       by ignoring his selection altogether. Now the card reads
       summary() — the module's own aggregation over inPeriod(),
       no second math path — and NAMES the selected window, so
       the number can never wear the wrong label. The default
       (30 days) reads exactly as it did under v118. */
    status: function () {
      var s = summary();
      if (!s.count) return 'No entries yet';
      var p = S('period', '30');
      if (p === 'custom') {
        var a = S('customA', ''), b = S('customB', '');
        if (a && b && b >= a) {
          var f = function (ds) {
            return new Date(ds + 'T12:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' });
          };
          return f(a) + ' – ' + f(b) + ': $' + s.total.toFixed(0);
        }
        /* invalid custom bounds: inPeriod()/periodDays() fall back
           to the rolling 30 days, and so does the label. */
      }
      return 'Last ' + s.days + 'd: $' + s.total.toFixed(0);
    },
    /* Tracker hook — called by app.js when a work session stops.
       v41: the session entry carries the dynamic tracker's tracked
       quantity for the pay standard, and the amount is priced from THAT
       quantity (never from hours for non-hourly modes):
         Miles  -> session.liveKm (fallback: endOdo - startOdo) x rate
         Weight -> session.totalWeightKg (stored as tonnes) x rate
         Trip   -> session.tripCount x rate
         Hourly -> hours x rate (unchanged behaviour).
       The quantity field is always set alongside the amount so payFor
       can re-derive it if the rate is edited later. */
    onSession: function (session) {
      var o = App._store.get('onboarding', {});
      var std = (o.payStandard || 'hourly').toLowerCase();
      var rate = ownRate(o);
      var hrs = (session.seconds || 0) / 3600;
      var e = { date: session.date || App._today(), type: 'hourly', hours: hrs.toFixed(2), note: 'Auto from tracker', auto: true };
      var feed = 'Tracked session ' + hrs.toFixed(2) + 'h logged to Revenue.';
      if (std === 'miles') {
        e.type = 'miles';
        var km = (typeof session.liveKm === 'number') ? session.liveKm : null;
        if (km === null && parseFloat(session.startOdo) > 0 && parseFloat(session.endOdo) > parseFloat(session.startOdo)) {
          km = Math.round((parseFloat(session.endOdo) - parseFloat(session.startOdo)) * 100) / 100;
        }
        if (km !== null && km > 0) {
          e.miles = String(km);
          if (rate > 0) e.amount = (km * rate).toFixed(2);
          feed = 'Tracked session: ' + km + ' km logged to Revenue.';
        }
      } else if (std === 'weight') {
        e.type = 'weight';
        var kg = parseFloat(session.totalWeightKg) || 0;
        if (kg > 0) {
          var tons = Math.round(kg / 10) / 100; // kg -> tonnes at 2dp, the unit payFor prices
          e.tons = String(tons);
          if (rate > 0) e.amount = (tons * rate).toFixed(2);
          feed = 'Tracked session: ' + tons + 't logged to Revenue.';
        }
      } else if (std === 'trip') {
        e.type = 'trip';
        var trips = parseInt(session.tripCount, 10) || 0;
        if (trips > 0) {
          e.trips = String(trips);
          if (rate > 0) e.amount = (trips * rate).toFixed(2);
          feed = 'Tracked session: ' + trips + ' trip' + (trips === 1 ? '' : 's') + ' logged to Revenue.';
        }
      } else if (rate > 0) {
        e.amount = (hrs * rate).toFixed(2);
      }
      var list = entries(); list.push(e); saveEntries(list);
      manifestFeedPush('revenue', feed);
    },
    /* Cross-module: dispatch completion logs earnings here. */
    addEntry: function (e) {
      var list = entries();
      /* v105: a completion entry keyed by its dispatch REPLACES any
         earlier entry for the same dispatch — re-completing or
         correcting a card updates the day's money, never doubles it
         (the never-twice rule). The completion's split fields —
         foreman/travel hours, whether travel is inside the income,
         the day's card numbers — ride along on the stored entry:
         P&L and the invoice read them from here. */
      if (e.dspId) list = list.filter(function (x) { return !x || x.dspId !== e.dspId; });
      var entry = {
        date: e.date || App._today(),
        amount: e.amount || 0,
        type: e.type || 'load',
        loads: e.loads || 1,
        tons: e.tons || null,   // v26: Pay by Weight — net tonnes for recalculation
        hours: e.hours || null,
        note: e.note || ''
      };
      if (e.dspId) entry.dspId = e.dspId;
      if (e.foremanHours != null) entry.foremanHours = e.foremanHours;
      if (e.travelHours != null) entry.travelHours = e.travelHours;
      if (e.travelInIncome != null) entry.travelInIncome = e.travelInIncome;
      if (e.ticketNos && e.ticketNos.length) entry.ticketNos = e.ticketNos.slice();
      list.push(entry);
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
    /* v116: the shell's back contract (owner recording, Oct 16
       2026: Back from a day detail kicked him OUT of Revenue, and
       re-entering landed back on the stale detail). back() unwinds
       ONE layer — an open edit first, then the day detail — back
       to Revenue's main list, and returns true so the shell stays
       in the module. resetView() is the fresh-entry rule:
       openModule calls it before every render, so entering
       Revenue always lands on the main list. (The view mode and
       period live in the store — those are the main view's own
       settings, not a sub-view, and stay.) */
    back: function () {
      if (!dayDetailDate && !dayEdit) return false;
      dayEdit = null; dayEditErr = ''; dayErr = ''; dayEditDraft = null; dayEditAmtCustom = false;
      dayDetailDate = null;
      if (lastBody) api.render(lastBody);
      return true;
    },
    resetView: function () {
      dayDetailDate = null; dayEdit = null; dayEditErr = ''; dayErr = ''; dayEditDraft = null; dayEditAmtCustom = false;
    },
    render: function (body) {
      lastBody = body;
      /* v47: a tapped Month day shows its Day Details instead of the
         normal Revenue view (Back clears dayDetailDate). */
      if (dayDetailDate) { renderDayDetail(body); return; }
      /* v201 REV-CLEAN: a form opened from the top tabs shows on
         its own view instead of the face (Back clears formView). */
      if (formView) { renderFormView(body); return; }
      var o = App._store.get('onboarding', {});
      var period = S('period', '30');
      var view = S('view', 'period');
      var s = summary();

      /* v201 REV-CLEAN layout: headHtml = the Revenue header card
         (view + period controls) and the stats row. It now sits
         UNDER the chart (period view): the chart is the page's
         highlight and first content card, the two small form tabs
         ride a strip at the very top, and auto-start lives behind
         its own menu button on that strip (see the assembly). */
      var headHtml = '<div class="card"><h3>💰 Revenue</h3>';
      /* v38 (B): view mode — the pay-period chips stay exactly as they were;
         Month is an additional mode alongside them. */
      headHtml += '<div class="row" style="margin-bottom:10px">' +
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
        headHtml += '<div class="row" style="align-items:center;justify-content:space-between">' +
          '<button class="btn small ghost" data-mstep="-1">‹ Prev</button>' +
          '<div style="font-weight:800;color:var(--navy);font-size:17px">' + esc(monthLabel(ym)) + '</div>' +
          '<button class="btn small ghost" data-mstep="1">Next ›</button></div>';
      } else {
        /* v116 (owner, Oct 16 2026): the chips row WRAPS (.rvchips)
           — in a plain .row the six chips overflowed a phone-width
           screen and "Custom" sat half cut off at the right edge.
           Two rows of three now; every chip fully on screen. */
        headHtml += '<label class="f">Pay period</label><div class="row rvchips">' +
          PERIOD_OPTS.map(function (p) {
            return '<button class="btn small ' + (period === p[0] ? 'primary' : 'ghost') + '" data-p="' + p[0] + '">' + p[1] + '</button>';
          }).join('') + '</div>';
        if (period === 'custom') {
          headHtml += '<div class="row" style="margin-top:8px"><div><label class="f">From</label><input type="date" id="rv_ca" value="' + esc(S('customA', '')) + '"></div>' +
            '<div><label class="f">To</label><input type="date" id="rv_cb" value="' + esc(S('customB', '')) + '"></div></div>';
        }
      }
      headHtml += '</div>';

      if (view === 'month') {
        headHtml += '<div class="row">' +
          '<div class="card" style="flex:1"><div class="note">Hours</div><div class="center" style="font-size:24px;font-weight:800;color:var(--navy)">' + fmtH(ms.hours) + '</div></div>' +
          '<div class="card" style="flex:1"><div class="note">Earnings</div><div class="center" style="font-size:24px;font-weight:800;color:var(--navy)">$' + ms.total.toFixed(2) + '</div></div>' +
          '<div class="card" style="flex:1"><div class="note">Days worked</div><div class="center" style="font-size:24px;font-weight:800;color:var(--navy)">' + ms.daysWorked + '</div></div>' +
          '</div><div class="row">' +
          '<div class="card" style="flex:1"><div class="note">Per worked day</div><div class="center" style="font-size:24px;font-weight:800;color:var(--navy)">$' + ms.avg.toFixed(2) + '</div></div>' +
          '<div class="card" style="flex:1"><div class="note">Loads</div><div class="center" style="font-size:24px;font-weight:800;color:var(--navy)">' + ms.loads + '</div></div>' +
          '</div>';
      } else {
        headHtml += '<div class="row">' +
          '<div class="card" style="flex:1"><div class="note">Earnings · ' + s.days + 'd</div><div class="center" style="font-size:24px;font-weight:800;color:var(--navy)">$' + s.total.toFixed(2) + '</div></div>' +
          '<div class="card" style="flex:1"><div class="note">Per worked day</div><div class="center" style="font-size:24px;font-weight:800;color:var(--navy)">$' + s.avg.toFixed(2) + '</div></div>' +
          '<div class="card" style="flex:1"><div class="note">Loads</div><div class="center" style="font-size:24px;font-weight:800;color:var(--navy)">' + s.loads + '</div></div>' +
          '</div>';
      }

      /* v36: tracker auto-start settings live in Revenue now (moved from
         Preferences + the old sidebar page, the owner: "still in preferences,
         not in revenue"). The tracker feeds Revenue — onSession logs tracked
         hours as earnings — so its start-by-itself switch sits here, under
         the numbers it produces. Shared card + save from modules/autostart.js;
         storage keys unchanged (onboarding: autoStart/autoStartTime/autoStartDays).
         v76 (F5, boss QA Oct 14): hidden for OFFICE users — the engine
         hard-returns 'office' and can never fire for them, so the card
         was an inert promise of a tracker they do not have. */
      var rvIsOffice = (App.userRole ? App.userRole() : 'driver') === 'office';
      /* v201 REV-CLEAN: auto-start's panel — the shared settings
         card + save, built only while its own menu button has it
         open, and never for office users (v76 F5 stands). */
      var asPanelHtml = '';
      if (!rvIsOffice) {
        if (asOpen) {
          asPanelHtml = Meticulous.modules.autostart.settingsHTML('rv') +
            '<button class="btn primary" id="rv_as_save" style="margin-bottom:16px">Save auto-start</button>';
        }
      }
      /* v201 REV-CLEAN: the face's top strip — the two small form
         tabs and auto-start's own menu button. The forms live on
         their own views now (renderFormView); only their place
         changed — same fields, same saves, same storage keys. */
      var tabsHtml = '<div class="row" style="margin-bottom:10px;align-items:center">' +
        '<button class="btn small ghost" data-rvtab="manual">＋ Add rev. manually</button>' +
        '<button class="btn small ghost" data-rvtab="extras">✨ Add extras</button>' +
        (rvIsOffice ? '' : '<button class="btn small ghost" id="rv_as_btn" style="margin-left:auto">⏰ Auto-start ' + (asOpen ? '▴' : '▾') + '</button>') +
        '</div>';

      var blockHtml = '';
      if (view === 'month') {
        /* v38 (B1): per-day breakdown, newest first — date, hours, amount.
           No travel line: the recorded hours already include travel.
           v47: rows are tappable — a tap opens the Day Details view for
           that date (renderDayDetail below); the › + "tap for details"
           is the only visual change. */
        blockHtml += '<div class="card"><h3>🗓 Days in ' + esc(monthLabel(ym)) + '</h3>' +
          (ms.days.length ? ms.days.map(function (d) {
            var dl = new Date(d.date + 'T12:00:00').toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
            return '<div class="listitem" data-day="' + d.date + '" style="cursor:pointer' + (d.date === graphSel ? ';background:#eef2fa;border:1px solid var(--navy)' : '') + '"><div class="a">' + esc(dl) + ' — $' + d.amount.toFixed(2) +
              '<span style="float:right;color:var(--muted);font-weight:400">›</span></div>' +
              '<div class="b">' + fmtH(d.hours) + 'h' +
              (d.live ? ' · ● still running' : '') +
              (d.duplicate ? ' · ⚠️ not counted — check this day' : (d.unconfirmed ? ' · from tracker — unconfirmed' : '')) +
              ' · tap to preview, tap again for details</div></div>';
          }).join('') : '<div class="empty">No days recorded this month yet. Import below or run the tracker.</div>') + '</div>' +
          '<div id="rv_gprev"></div>';

        /* v38 (B2): paste-import from the hours sheet. */
        blockHtml += '<div class="card"><h3>📥 Import days</h3>' +
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
        blockHtml += '<div class="card"><h3>📊 Daily earnings</h3><canvas class="chart" id="revChart"></canvas>' +
          '<div class="note" style="margin-top:6px">Tap a bar to preview the day — tap the same bar again to open it.</div></div>' +
          '<div id="rv_gprev"></div>';
      }
      /* v201 REV-CLEAN: the Manual entry and Extras FORMS no
         longer sit on the face — they live on their own views
         behind the top tabs (renderFormView holds them verbatim).
         The Entries list below is the face's history: it scrolls,
         as history may (NO-SCROLL rule, Oct 21 09:59 MDT). */

      /* v116: the flat list renders MONEY entries only — per day,
         the record(s) the shared builder priced (entryMoneyFlags).
         A tracker session stacked on a closed dispatch, a duplicate
         sheet import, a 0.01h drip: none of them render here; they
         live in the day's detail under Also recorded. Rows group by
         day, newest day first, so a day's money always leads. */
      var rvFlags = entryMoneyFlags();
      var rvRows = [];
      entries().forEach(function (e, i) { if (e && rvFlags[i] && rvFlags[i].money) rvRows.push({ e: e, index: i }); });
      rvRows.sort(function (a, b) {
        if (a.e.date !== b.e.date) return a.e.date < b.e.date ? 1 : -1;
        return b.index - a.index;
      });
      /* v164 (owner, Oct 18, 2026 20:54 MDT): the Entries list
         scrolls endlessly — show the LATEST 3, the rest behind
         one Show-more tap (and fold back with Show less). */
      var rvShown = rvShowAll ? rvRows : rvRows.slice(0, 3);
      var tailHtml = '<div class="card"><h3>📒 Entries</h3><div id="rv_list">' +
        (rvRows.length ? rvShown.map(function (r) {
          var e = r.e;
          var std = (App._store.get('onboarding', {}).payStandard || 'hourly').toLowerCase();
          var amt = payFor(e, std, ownRate(App._store.get('onboarding', {})));
          var odoKm = e.auto ? odoKmForDate(e.date) : null; // v46: tracker days with an odo pair show the day's km
          return '<div class="listitem" data-day-link="' + esc(e.date) + '" style="cursor:pointer"><div class="a">$' + amt.toFixed(2) + ' <span class="pill">' + esc(e.type || 'load') + '</span></div>' +
            '<div class="b">' + esc(e.date) + (e.note ? ' · ' + esc(e.note) : '') + (e.auto ? (e.handEdited ? ' · auto · edited by hand' : ' · auto') : '') + (odoKm !== null ? ' · 🛣 ' + (+odoKm.toFixed(1)) + ' km (odo)' : '') + ' · tap to open the day</div>' +
            '<div class="row" style="margin-top:6px"><button class="btn small ghost" data-rvdel="' + r.index + '">Delete</button></div></div>';
        }).join('') : (entries().length
          ? '<div class="empty">Nothing counted right now — some days are recorded more than once. Open the day from the Month view to fix it.</div>'
          : '<div class="empty">No entries yet. Add one from the tab at the top or run the tracker.</div>')) + '</div>' +
        (rvRows.length > 3
          ? '<button class="btn ghost" id="rv_more" style="width:100%;margin-top:8px">' +
            (rvShowAll ? 'Show less' : 'Show more — ' + (rvRows.length - 3) + ' more entr' + (rvRows.length - 3 === 1 ? 'y' : 'ies')) + '</button>'
          : '') + '</div>';

      tailHtml += '<button class="btn navy" id="rv_export" style="width:100%;margin-bottom:16px">📝 Send summary to Manifest</button>';

      /* v201 REV-CLEAN assembly: tabs strip first, then the
         auto-start panel (only while its menu is open), then the
         CHART — the highlight, the first content card of the
         period view — then the header card + stats, the month
         blocks in the month view, and the Entries history last:
         the working face up top, the scrollable history below. */
      body.innerHTML = tabsHtml + asPanelHtml +
        (view === 'period' ? blockHtml : '') + headHtml +
        (view === 'month' ? blockHtml : '') + tailHtml;
      var chartEl = body.querySelector('#revChart');
      if (chartEl) {
        drawChart(chartEl);
        /* v75: tap a bar → that day's detail (the bucket under the
           tap, from the date list drawChart stashed on the canvas). */
        chartEl.style.cursor = 'pointer';
        chartEl.onclick = function (ev) {
          var dates = chartEl._dayDates;
          if (!dates || !dates.length) return;
          var w = chartEl.offsetWidth || chartEl.getBoundingClientRect().width || 0;
          if (!w) return;
          var x = (ev && typeof ev.offsetX === 'number') ? ev.offsetX
            : (ev.clientX - chartEl.getBoundingClientRect().left);
          var i = Math.floor(x / (w / dates.length));
          if (i < 0) i = 0;
          if (i >= dates.length) i = dates.length - 1;
          /* v116: TWO-TAP — first tap selects the bar's day and
             previews it; a second tap on the SAME bar opens the
             day's detail; a tap on a different bar just moves the
             selection (graphTap). */
          var gt = graphTap(graphSel, dates[i]);
          if (gt.open) {
            graphSel = null;
            dayDetailDate = gt.open;
            api.render(body);
          } else {
            graphSel = gt.sel;
            drawChart(chartEl);
            paintGraphPreview(body);
          }
        };
      }

      /* v36: auto-start card save (shared saver, same storage keys).
         v76 (F5): the button only exists for non-office renders. */
      var rvAsSave = body.querySelector('#rv_as_save');
      if (rvAsSave) rvAsSave.onclick = function () {
        Meticulous.modules.autostart.saveFrom('rv', body);
        alert('Auto-start saved.');
      };

      /* v53: wire the card's "Today:" line — the Change-for-today
         override controls (dispatch-driven auto-start). */
      try { Meticulous.modules.autostart.wireToday(body, 'rv'); } catch (e) {}

      /* v38: view mode toggle + month stepping + paste-import. */
      body.querySelectorAll('[data-view]').forEach(function (b) {
        b.onclick = function () { W('view', b.getAttribute('data-view')); api.render(body); };
      });
      body.querySelectorAll('[data-mstep]').forEach(function (b) {
        b.onclick = function () { W('monthCur', shiftYM(ym, parseInt(b.getAttribute('data-mstep'), 10) || 0)); api.render(body); };
      });
      /* v47: tapping a Month day row opens its Day Details view.
         v116: TWO-TAP, same as the chart — first tap selects the
         day and previews it under the list; a second tap on the
         SAME row opens the detail; a different row just moves
         the selection. */
      body.querySelectorAll('[data-day]').forEach(function (b) {
        b.onclick = function () {
          var gt = graphTap(graphSel, b.getAttribute('data-day'));
          if (gt.open) {
            graphSel = null;
            dayDetailDate = gt.open;
            api.render(body);
            return;
          }
          graphSel = gt.sel;
          body.querySelectorAll('[data-day]').forEach(function (r) {
            var on = r.getAttribute('data-day') === graphSel;
            r.style.background = on ? '#eef2fa' : '';
            r.style.border = on ? '1px solid var(--navy)' : '';
          });
          paintGraphPreview(body);
        };
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
      /* v164: Entries Show more / Show less */
      var rvMore = body.querySelector('#rv_more');
      if (rvMore) rvMore.onclick = function () { rvShowAll = !rvShowAll; api.render(body); };
      var ca = body.querySelector('#rv_ca'), cb = body.querySelector('#rv_cb');
      if (ca) ca.onchange = function () { W('customA', ca.value); api.render(body); };
      if (cb) cb.onchange = function () { W('customB', cb.value); api.render(body); };

      /* v201 REV-CLEAN: the top tabs open their form views; the
         auto-start button unfolds its panel right here (the
         panel's own save wiring sits above, where it always was —
         it simply only has elements to bind while the panel is
         open). The forms' own wiring lives in renderFormView. */
      body.querySelectorAll('[data-rvtab]').forEach(function (b) {
        b.onclick = function () { formView = b.getAttribute('data-rvtab'); api.render(body); };
      });
      var rvAsBtn = body.querySelector('#rv_as_btn');
      if (rvAsBtn) rvAsBtn.onclick = function () { asOpen = !asOpen; api.render(body); };

      /* v43: two-tap in-app delete confirm — see bindTwoTapDelete at
         module scope (moved out in v47 so Day Details reuses it). */
      bindTwoTapDelete(body, '[data-rvdel]', function (b) {
        var l = entries(); l.splice(+b.getAttribute('data-rvdel'), 1); saveEntries(l); api.render(body);
      });
      /* v75: the main Entries/Extras rows open their day's detail
         (owner: "make sure revenue entries are clickable as well").
         A tap on the row's own Delete button must NOT navigate —
         the button keeps its two-tap delete, guarded here by the
         tap landing inside it. */
      body.querySelectorAll('[data-day-link]').forEach(function (el) {
        el.onclick = function (ev) {
          if (ev && ev.target && ev.target.closest &&
              ev.target.closest('[data-rvdel],[data-rxdel]')) return;
          dayDetailDate = el.getAttribute('data-day-link');
          api.render(body);
        };
      });
      body.querySelector('#rv_export').onclick = function () {
        api.exportToManifest();
        alert('Revenue summary sent to Manifest.');
      };
      /* v116: restore the two-tap selection's preview when the
         selected day is still part of what's on screen; a window
         or month change quietly drops a selection that no longer
         belongs to the view. */
      if (graphSel) {
        var inChart = !!(chartEl && chartEl._dayDates && chartEl._dayDates.indexOf(graphSel) >= 0);
        var inMonth = (view === 'month' && graphSel.slice(0, 7) === ym);
        if (!inChart && !inMonth) graphSel = null;
      }
      paintGraphPreview(body);
    }
  };

  Meticulous.modules.revenue = api;
})();
