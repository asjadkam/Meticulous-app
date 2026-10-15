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
    var buckets = [], labels = [], dates = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(now.getTime() - i * 86400000);
      var ds = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
      buckets.push(agg[ds] ? agg[ds].amount : 0);
      labels.push((d.getMonth() + 1) + '/' + d.getDate());
      dates.push(ds);
    }
    /* v75: each bar IS its day — render wires a canvas tap to the
       bucket under it via this list ("make sure revenue entries
       are clickable as well", owner, Oct 14). */
    cv._dayDates = dates;
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
    var agg = dayAgg()[ds] || { hours: 0, base: 0, extrasAmt: 0, amount: 0, hasEntry: false, live: false };
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
        amount: payFor(e, ctx.std, o.payRate),
        note: e.note || '', auto: !!e.auto
      });
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
      if (!d || d.date !== ds) return;
      dispatches.push({ jobSite: d.jobSite || d.pickup || 'Dispatch', status: d.status || '', ticketNo: d.ticketNo || '' });
    });
    return {
      date: ds, hours: agg.hours, amount: agg.amount, extrasAmt: agg.extrasAmt, live: !!agg.live,
      entries: ents, extras: xtras, sessions: sessions, fuel: fuel, dispatches: dispatches
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
  function applyEntryEdit(orig, form) {
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
     (Asjad, Oct 14: "Why can I not click on a specific day and see the
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
    var d = dayDetailData(ds);
    /* v75: an edit target that no longer exists (deleted elsewhere)
       closes the edit quietly — never edit a ghost. */
    if (dayEdit) {
      var tgt = dayEdit.kind === 'entry' ? entries()[dayEdit.index] : extras()[dayEdit.index];
      if (!tgt) { dayEdit = null; dayEditErr = ''; }
    }
    var title = new Date(ds + 'T12:00:00').toLocaleDateString('en',
      { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    var h = '<button class="btn small ghost" id="rv_day_back" style="margin-bottom:10px">‹ Back</button>';
    h += '<div class="card"><h3>🗓 ' + esc(title) + '</h3>' +
      '<div class="kv"><span>Hours</span><b>' + fmtH(d.hours) + '</b></div>' +
      '<div class="kv"><span>Earnings</span><b>$' + d.amount.toFixed(2) + '</b></div>' +
      (d.extrasAmt > 0 ? '<div class="note" style="margin-top:6px">Earnings include $' + d.extrasAmt.toFixed(2) + ' in extras (listed below).</div>' : '') +
      (d.live ? '<div class="note" style="margin-top:6px">● Tracker still running — this day is counted live; the finished session lands here when you stop.</div>' : '') +
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
        h += '<div class="row"><div><label class="f">Type</label><select id="rv_ed_type">' + typeOpts + '</select></div>' +
          '<div><label class="f">Amount $</label><input id="rv_ed_amt" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(fv('amount', rec.amount)) + '"></div></div>' +
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
        if (e.auto) parts.push('auto');
        var editingThis = dayEdit && dayEdit.kind === 'entry' && dayEdit.index === e.index;
        return '<div class="listitem"><div class="a">$' + e.amount.toFixed(2) + ' <span class="pill">' + esc(e.type) + '</span></div>' +
          (parts.length ? '<div class="b">' + esc(parts.join(' · ')) + '</div>' : '') +
          (editingThis ? '<div class="b" style="color:var(--orange);font-weight:700">✏️ You\'re editing this one — the form is at the top of this page ↑</div>' :
            '<div class="row" style="margin-top:6px"><button class="btn small ghost" data-rvedit="' + e.index + '">✏️ Edit</button>' +
            (dayEdit ? '' : '<button class="btn small ghost" data-rvdel="' + e.index + '">Delete</button>') + '</div>') + '</div>';
      }).join('') + '</div>';
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
    if (!d.entries.length && !d.extras.length && !d.sessions.length && !d.fuel.length && !d.dispatches.length) {
      h += '<div class="card"><div class="empty">Nothing recorded for this day.</div></div>';
    }
    body.innerHTML = h;
    body.querySelector('#rv_day_back').onclick = function () {
      dayDetailDate = null; dayEdit = null; dayEditErr = ''; dayErr = ''; dayEditDraft = null;
      api.render(body);
    };
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
        dayEditErr = ''; dayErr = ''; dayEditDraft = null;
        api.render(body);
        var top = body.querySelector('#rv_day_back');
        if (top && top.scrollIntoView) { try { top.scrollIntoView({ block: 'start' }); } catch (e) {} }
      };
    });
    body.querySelectorAll('[data-rxedit]').forEach(function (b) {
      b.onclick = function () {
        dayEdit = { kind: 'extra', index: +b.getAttribute('data-rxedit') };
        dayEditErr = ''; dayErr = ''; dayEditDraft = null;
        api.render(body);
        var top = body.querySelector('#rv_day_back');
        if (top && top.scrollIntoView) { try { top.scrollIntoView({ block: 'start' }); } catch (e) {} }
      };
    });
    var edCancel = body.querySelector('#rv_ed_cancel');
    if (edCancel) edCancel.onclick = function () { dayEdit = null; dayEditErr = ''; dayEditDraft = null; api.render(body); };
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
        dayEditDraft = { kind: 'entry', index: dayEdit.index, form: form };
        var amt = parseFloat(form.amount);
        if (!(amt >= 0) || isNaN(amt)) {
          dayEditErr = 'Enter the amount (0 or more) — nothing was saved.';
          api.render(body); return;
        }
        var l = entries();
        if (!l[dayEdit.index]) { dayEdit = null; dayEditDraft = null; api.render(body); return; }
        l[dayEdit.index] = applyEntryEdit(l[dayEdit.index], form);
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
      dayEdit = null; dayEditErr = ''; dayErr = ''; dayEditDraft = null;
      api.render(body);
    };
  }

  var lastImport = null; // v38: result of the latest paste-import, shown after re-render
  var dayDetailDate = null; // v47: date whose Day Details are showing, or null for the normal Revenue view
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

  var api = {
    status: function () {
      var s = summary();
      return s.total > 0 ? 'Last ' + s.days + 'd: $' + s.total.toFixed(0) : 'No entries yet';
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
      var rate = parseFloat(o.payRate) || 0;
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
      /* v47: a tapped Month day shows its Day Details instead of the
         normal Revenue view (Back clears dayDetailDate). */
      if (dayDetailDate) { renderDayDetail(body); return; }
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
           No travel line: the recorded hours already include travel.
           v47: rows are tappable — a tap opens the Day Details view for
           that date (renderDayDetail below); the › + "tap for details"
           is the only visual change. */
        h += '<div class="card"><h3>🗓 Days in ' + esc(monthLabel(ym)) + '</h3>' +
          (ms.days.length ? ms.days.map(function (d) {
            var dl = new Date(d.date + 'T12:00:00').toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
            return '<div class="listitem" data-day="' + d.date + '" style="cursor:pointer"><div class="a">' + esc(dl) + ' — $' + d.amount.toFixed(2) +
              '<span style="float:right;color:var(--muted);font-weight:400">›</span></div>' +
              '<div class="b">' + fmtH(d.hours) + 'h' +
              (d.live ? ' · ● still running' : '') + ' · tap for details</div></div>';
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
        h += '<div class="card"><h3>📊 Daily earnings</h3><canvas class="chart" id="revChart"></canvas>' +
          '<div class="note" style="margin-top:6px">Tap a bar to open that day.</div></div>';
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
          return '<div class="listitem" data-day-link="' + esc(x.date) + '" style="cursor:pointer"><div class="a">' + esc(x.type) + ' — $' + esc(x.amount) + '</div><div class="b">' + esc(x.date) + (x.note ? ' · ' + esc(x.note) : '') + ' · tap to open the day</div>' +
            '<div class="row" style="margin-top:6px"><button class="btn small ghost" data-rxdel="' + (extras().length - 1 - ri) + '">Delete</button></div></div>';
        }).join('') : '<div class="empty">No extras yet.</div>') + '</div></div>';

      h += '<div class="card"><h3>📒 Entries</h3><div id="rv_list">' +
        (entries().length ? entries().slice().reverse().map(function (e, ri) {
          var std = (App._store.get('onboarding', {}).payStandard || 'hourly').toLowerCase();
          var amt = payFor(e, std, App._store.get('onboarding', {}).payRate);
          var odoKm = e.auto ? odoKmForDate(e.date) : null; // v46: tracker days with an odo pair show the day's km
          return '<div class="listitem" data-day-link="' + esc(e.date) + '" style="cursor:pointer"><div class="a">$' + amt.toFixed(2) + ' <span class="pill">' + esc(e.type || 'load') + '</span></div>' +
            '<div class="b">' + esc(e.date) + (e.note ? ' · ' + esc(e.note) : '') + (e.auto ? ' · auto' : '') + (odoKm !== null ? ' · 🛣 ' + (+odoKm.toFixed(1)) + ' km (odo)' : '') + ' · tap to open the day</div>' +
            '<div class="row" style="margin-top:6px"><button class="btn small ghost" data-rvdel="' + (entries().length - 1 - ri) + '">Delete</button></div></div>';
        }).join('') : '<div class="empty">No entries yet. Add one above or run the tracker.</div>') + '</div></div>';

      h += '<button class="btn navy" id="rv_export" style="width:100%;margin-bottom:16px">📝 Send summary to Manifest</button>';

      body.innerHTML = h;
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
          dayDetailDate = dates[i];
          api.render(body);
        };
      }

      /* v36: auto-start card save (shared saver, same storage keys). */
      body.querySelector('#rv_as_save').onclick = function () {
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
      /* v47: tapping a Month day row opens its Day Details view. */
      body.querySelectorAll('[data-day]').forEach(function (b) {
        b.onclick = function () { dayDetailDate = b.getAttribute('data-day'); api.render(body); };
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
      /* v43: two-tap in-app delete confirm — see bindTwoTapDelete at
         module scope (moved out in v47 so Day Details reuses it). */
      bindTwoTapDelete(body, '[data-rvdel]', function (b) {
        var l = entries(); l.splice(+b.getAttribute('data-rvdel'), 1); saveEntries(l); api.render(body);
      });
      bindTwoTapDelete(body, '[data-rxdel]', function (b) {
        var l = extras(); l.splice(+b.getAttribute('data-rxdel'), 1); W('extras', l); api.render(body);
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
    }
  };

  Meticulous.modules.revenue = api;
})();
