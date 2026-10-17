/* Meticulous Connect — THE PIPE (v132, Connect Phase 2 slice 2).
 *
 * The handshake (v131, js/connectlive.js) made accounts FINDABLE and
 * LINKED. This engine moves the WORK across a live link:
 *
 *  UP — THE SHARED DAY RECORD (shareddays/{driverUid}_{date}):
 *  with an accepted connection, the driver's day reaches his
 *  connected peers BY ITSELF. One doc per driver per day holding
 *  FACTS ONLY — the day's dispatches (driver-declared AND
 *  boss-sent, each with its origin), every dispatch's tickets with
 *  their close facts (ticket #, material, loads, foreman hours,
 *  the fixed travel hour, net weight, a photo REFERENCE — the
 *  photo bytes never cross; they stay in the driver's own tree),
 *  the session's hours, the day's loads. NO rates, NO amounts, NO
 *  money of any kind ever enters the record: it is the ONE record
 *  both books price from, each side with its OWN rates, on its
 *  OWN side (one ticket, two books — the Oct 14 law).
 *
 *  THE BOSS'S TWO PRICED VIEWS (priceDay / priceDispatch, pure):
 *  the SAME ticket prices twice on the boss's side —
 *    REVENUE (in):  billable hours x the boss's client rate.
 *      Billable = foreman hours; the travel hour joins ONLY when
 *      the ticket's travelBillable flag says the customer agreed
 *      to pay it (default NO — the Oct 14 travel rule).
 *    WAGES (out):   (foreman + travel) x the pay rate THE BOSS
 *      sets for that driver (his own P&L driver entry). The travel
 *      hour is part of the driver's pay — the haul-card model:
 *      10.0 foreman + 1 travel = 11.0 h x his rate.
 *  The driver's rates never leave his account; the boss's client
 *  rate never reaches the driver. Nothing priced is ever written
 *  back into the shared record.
 *
 *  DOWN — BOSS-SENT DISPATCHES (pipedispatches/{id}): the boss
 *  composes on his side; the doc lands in the driver's app as his
 *  dispatch for that day — SCHEDULED, in his list, never made
 *  active and never disturbing an active same-day dispatch; a
 *  same-day clash is flagged on the record for the DRIVER's pick,
 *  never auto-decided (the owner's cadence law). Receipt marks
 *  ride the doc (the Oct 14 WhatsApp-tick decision): sent (the
 *  doc exists) -> delivered (the driver's app materialized it)
 *  -> seen (the driver opened his Dispatch screen with it there).
 *  A sent dispatch is SEALED: the sender cannot edit it after
 *  sending (the rules enforce the same shape).
 *
 *  NOT in this build: invoice + manifest SHARING between accounts
 *  (the UI says "arrives next" for exactly those, nowhere else).
 *
 *  Rules for both collections ship in firestore.rules and deploy
 *  with the app (deploy.yml: hosting,firestore:rules): a shared
 *  day is readable only by its driver and the peers named in its
 *  viewers list (his accepted connections at publish time) and
 *  writable only by the driver; a pipe dispatch is readable by
 *  its two parties, creatable only by its sender as 'sent', and
 *  only the recipient may advance its receipt marks.
 */
(function () {
  'use strict';

  var CP = {
    _pubCache: {},      // dayDocId -> JSON last published this session
    _pulling: false,
    _lastPullAt: 0,
    _crewCache: null    // {date, days} — last fetchCrew result (status line)
  };
  window.ConnectPipe = CP;

  function fb() {
    try { return (window.FB && FB.ready && FB.user && FB.db) ? FB : null; }
    catch (e) { return null; }
  }
  function store() {
    try { return (window.App && App._store) ? App._store : null; } catch (e) { return null; }
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  /* The date a dispatch record belongs to — the app's own rule
     (manifest v83): scheduledAt's date wins over the raw field. */
  CP.recordDate = function (d) {
    if (!d) return '';
    if (typeof d.scheduledAt === 'string') {
      var m = /^(\d{4}-\d{2}-\d{2})/.exec(d.scheduledAt);
      if (m) return m[1];
    }
    return d.date || '';
  };

  function dateShift(dateStr, days) {
    var p = String(dateStr || '').split('-');
    if (p.length !== 3) return dateStr;
    var d = new Date(+p[0], +p[1] - 1, +p[2] + days);
    function z(n) { return ('0' + n).slice(-2); }
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }
  CP.dateShift = dateShift;

  /* ---------------- who may see my day ---------------- */

  /* My accepted connections (the v131 con_list link shape). Only
     status 'connected' peers are viewers — a pending request
     shares nothing. */
  CP.connectedPeers = function () {
    var st = store();
    if (!st) return [];
    var out = [];
    (st.get('con_list', []) || []).forEach(function (c) {
      if (c && c.uid && c.status === 'connected') out.push(c);
    });
    return out;
  };

  /* ---------------- the shared day record ---------------- */

  /* One dispatch, as facts. Mirrors the rungs the app itself
     trusts: hours from the ticket summary (TicketOCR.
     summarizeTickets — the close's own assembly, travel = the
     day's fixed travel hour, applied once, only on a completed
     dispatch whose tickets carry foreman hours); loads from the
     ticket counts, else the record's deliberately-set count;
     ticket # from the record, else its first ticket's number. */
  CP.sharedDispatch = function (d, travelBonus) {
    var tickets = (d.tickets || []).filter(Boolean);
    var sum = null;
    try {
      if (window.TicketOCR && TicketOCR.summarizeTickets) {
        sum = TicketOCR.summarizeTickets(tickets, travelBonus);
      }
    } catch (e) { sum = null; }
    var foreman = sum ? (sum.totalForemanHours || 0) : 0;
    if (!sum) {
      tickets.forEach(function (t) { foreman += parseFloat(t && t.foremanHours) || 0; });
      foreman = r2(foreman);
    }
    var travel = (d.status === 'completed' && tickets.length && foreman > 0)
      ? (parseFloat(travelBonus) || 0) : 0;
    var tkLoads = 0, tkWeight = 0, anyLoads = false;
    tickets.forEach(function (t) {
      var v = parseFloat(t && t.loads);
      if (v > 0) { tkLoads += v; anyLoads = true; }
      var w = parseFloat(t && t.netWeight);
      if (w > 0) tkWeight += w;
    });
    var loads = anyLoads ? tkLoads
      : (d.loadsSet ? (parseFloat(d.loads) || 0) : 0);
    var ticketNo = String(d.ticketNo || '').trim();
    if (!ticketNo) {
      for (var i = 0; i < tickets.length; i++) {
        var n = tickets[i] && (tickets[i].cardNumber || tickets[i].ticketNo);
        if (n) { ticketNo = String(n); break; }
      }
    }
    return {
      id: d.id || '',
      origin: d.pipeFrom ? 'boss' : 'driver',
      sentBy: d.pipeFrom || '',
      pipeId: d.pipeId || '',
      sourceLabel: d.pipeFrom ? '' : String(d.source || d.via || d.senderLabel || ''),
      jobSite: d.jobSite || d.pickup || '',
      date: CP.recordDate(d),
      scheduledAt: d.scheduledAt || '',
      equipment: d.equipment || '',
      material: String(d.material || '').trim(),
      ticketNo: ticketNo,
      notes: d.notes || '',
      status: d.status || 'saved',
      startedAt: d.startedAt || null,
      closedAt: d.endedAt || null,
      foremanHours: foreman,
      travelHours: travel,
      travelBillable: !!d.travelBillable,
      loads: loads,
      netWeight: tkWeight > 0 ? r2(tkWeight) : (parseFloat(d.netWeight) || 0),
      tickets: tickets.map(function (t) {
        return {
          no: String((t && (t.cardNumber || t.ticketNo)) || ''),
          material: String((t && t.material) || ''),
          loads: parseFloat(t && t.loads) || 0,
          foremanHours: parseFloat(t && t.foremanHours) || 0,
          netWeight: parseFloat(t && t.netWeight) || 0,
          /* a REFERENCE, never the image: the photo itself stays
             in the driver's own tree (his kv copy of dsp_list) */
          photoRef: !!(t && t.photo)
        };
      }),
      photoRef: !!(d.photo || tickets.some(function (t) { return !!(t && t.photo); }))
    };
  };

  /* The day's session picture, the manifest's way: saved sessions
     (start derived as endedAt - seconds) plus the live tracker
     when today is still running. */
  function sessionFor(dateStr, today) {
    var st = store();
    if (!st) return { hours: 0, active: false, startedAt: null, endedAt: null, km: null };
    var hours = 0, startedAt = null, endedAt = null, km = 0, kmAny = false;
    (st.get('sessions', []) || []).forEach(function (s) {
      if (!s || s.date !== dateStr) return;
      var sec = parseFloat(s.seconds) || 0;
      hours += sec / 3600;
      var endMs = Date.parse(s.endedAt || '');
      if (isFinite(endMs)) {
        if (endedAt === null || endMs > endedAt) endedAt = endMs;
        var startMs = endMs - sec * 1000;
        if (startedAt === null || startMs < startedAt) startedAt = startMs;
      }
      if (typeof s.liveKm === 'number') { km += s.liveKm; kmAny = true; }
    });
    var active = false;
    try {
      var trk = (window.App && App.tracker) || st.get('tracker', null);
      if (dateStr === today && trk && (trk.status === 'running' || trk.status === 'paused')) {
        var lsec = trk.elapsed || 0;
        if (trk.status === 'running') lsec += Math.floor((Date.now() - (trk.startTs || Date.now())) / 1000);
        if (lsec > 0) {
          active = true;
          hours += lsec / 3600;
          var lStart = Date.now() - lsec * 1000;
          if (startedAt === null || lStart < startedAt) startedAt = lStart;
        }
      }
    } catch (e) {}
    return {
      hours: r2(hours), active: active,
      startedAt: startedAt, endedAt: active ? null : endedAt,
      km: kmAny ? r2(km) : null
    };
  }

  /* Assemble MY shared day record for a date — facts only. Null
     when there is nothing to share (no dispatches, no session). */
  CP.buildDay = function (dateStr) {
    var f = fb(), st = store();
    if (!f || !st || !dateStr) return null;
    var o = st.get('onboarding', {}) || {};
    var travelBonus = parseFloat(o.travelBonus) || 0;
    var dispatches = [];
    (st.get('dsp_list', []) || []).forEach(function (d) {
      if (d && CP.recordDate(d) === dateStr && d.status !== 'cancelled') {
        dispatches.push(CP.sharedDispatch(d, travelBonus));
      }
    });
    var act = st.get('dsp_active', null);
    if (act && CP.recordDate(act) === dateStr && act.status !== 'cancelled' &&
        !dispatches.some(function (x) { return x.id === act.id; })) {
      dispatches.push(CP.sharedDispatch(act, travelBonus));
    }
    var today = '';
    try { today = App._today(); } catch (e) {}
    var session = sessionFor(dateStr, today);
    if (!dispatches.length && !(session.hours > 0) && !session.active) return null;
    var idn = { name: '', business: '' };
    try { if (window.ConnectLive) idn = ConnectLive.identity(); } catch (e) {}
    var loads = 0, ticketsClosed = 0;
    dispatches.forEach(function (x) {
      loads += x.loads || 0;
      if (x.status === 'completed') ticketsClosed += x.tickets.length;
    });
    return {
      driver: f.user.uid,
      date: dateStr,
      driverName: idn.name || '',
      driverBusiness: idn.business || '',
      viewers: CP.connectedPeers().map(function (c) { return c.uid; }),
      session: session,
      dispatches: dispatches,
      loads: r2(loads),
      ticketsClosed: ticketsClosed,
      updatedAt: Date.now()
    };
  };

  CP.dayDocId = function (driverUid, dateStr) { return driverUid + '_' + dateStr; };

  /* Publish one of MY days to my connected peers. Content-guarded
     per session: the same facts are never written twice in a row.
     Resolves true when a write happened. */
  CP.publishDay = function (dateStr) {
    var f = fb();
    if (!f) return Promise.resolve(false);
    var doc = CP.buildDay(dateStr);
    if (!doc) return Promise.resolve(false);
    if (!doc.viewers.length) return Promise.resolve(false);
    var id = CP.dayDocId(f.user.uid, dateStr);
    /* the write guard compares FACTS, not the stamp: updatedAt
       changes on every publish by design, so it is excluded from
       the key — unchanged facts are never written twice in a row */
    var keyDoc = clone(doc); delete keyDoc.updatedAt;
    var key = JSON.stringify(keyDoc);
    if (CP._pubCache[id] === key) return Promise.resolve(false);
    CP._pubCache[id] = key;
    return f.db.collection('shareddays').doc(id).set(doc)
      .then(function () { return true; })
      .catch(function () { CP._pubCache[id] = ''; return false; });
  };

  /* Today + yesterday: yesterday is published too so a day closed
     after midnight (or first opened next morning) still lands. */
  CP.publishRecent = function () {
    var today = '';
    try { today = App._today(); } catch (e) {}
    if (!today) return Promise.resolve(false);
    return CP.publishDay(today).then(function () {
      return CP.publishDay(dateShift(today, -1));
    });
  };

  /* ---------------- down: boss-sent dispatches ---------------- */

  /* Send a dispatch to a connected driver. The doc IS the
     delivery: status starts 'sent' (one tick); the driver's app
     advances it to delivered, then seen. Resolves 'sent'|'error'. */
  CP.sendDispatch = function (peerUid, fields) {
    var f = fb();
    if (!f || !peerUid || peerUid === f.user.uid || !fields) return Promise.resolve('error');
    var me = { name: '', business: '' };
    try { if (window.ConnectLive) me = ConnectLive.identity(); } catch (e) {}
    var id = 'pd' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    var doc = {
      from: f.user.uid, to: peerUid,
      fromName: me.name || '', fromBusiness: me.business || '',
      jobSite: String(fields.jobSite || ''), date: String(fields.date || ''),
      scheduledAt: String(fields.scheduledAt || ''),
      equipment: String(fields.equipment || ''), material: String(fields.material || ''),
      notes: String(fields.notes || ''),
      status: 'sent', sentAt: Date.now(), deliveredAt: 0, seenAt: 0
    };
    return f.db.collection('pipedispatches').doc(id).set(doc)
      .then(function () { return 'sent'; })
      .catch(function () { return 'error'; });
  };

  function rowsOf(snap) {
    var a = [];
    snap.forEach(function (d) { var v = d.data() || {}; v.id = d.id; a.push(v); });
    return a;
  }
  function job(p) { return p.then(rowsOf).catch(function () { return []; }); }

  /* Dispatches sent TO me (my inbox) and BY me (my sent box). */
  CP.listInbox = function () {
    var f = fb();
    if (!f) return Promise.resolve([]);
    return job(f.db.collection('pipedispatches').where('to', '==', f.user.uid).get());
  };
  CP.listSent = function () {
    var f = fb();
    if (!f) return Promise.resolve([]);
    return job(f.db.collection('pipedispatches').where('from', '==', f.user.uid).get())
      .then(function (a) {
        a.sort(function (x, y) { return (y.sentAt || 0) - (x.sentAt || 0); });
        return a;
      });
  };

  /* Materialize my inbox into my dispatch list. Each delivery
     becomes a SCHEDULED record for its own day (status 'saved';
     dsp_active is never touched — the cadence law). When another
     open dispatch already holds that date the record is flagged
     pipeConflict for MY pick. Idempotent: a delivery lands once,
     keyed by its pipe id in pipe_landed. Resolves the number of
     NEW records landed. */
  CP.pullInbox = function () {
    var f = fb(), st = store();
    if (!f || !st || CP._pulling) return Promise.resolve(0);
    if (Date.now() - CP._lastPullAt < 15000) return Promise.resolve(0);
    CP._pulling = true;
    CP._lastPullAt = Date.now();
    return CP.listInbox().then(function (docs) {
      var landed = st.get('pipe_landed', {}) || {};
      var fresh = docs.filter(function (d) { return d && d.id && !landed[d.id]; });
      if (!fresh.length) { CP._pulling = false; return 0; }
      var list = st.get('dsp_list', []) || [];
      var changedDates = {};
      fresh.forEach(function (d) {
        var dateStr = CP.recordDate(d);
        var conflict = list.some(function (x) {
          return x && CP.recordDate(x) === dateStr && x.status !== 'completed' && x.status !== 'cancelled';
        }) || !!(st.get('dsp_active', null) && CP.recordDate(st.get('dsp_active', null)) === dateStr);
        var rec = {
          id: 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36) + list.length,
          jobSite: d.jobSite || '', date: dateStr, scheduledAt: d.scheduledAt || '',
          equipment: d.equipment || '', material: d.material || '', notes: d.notes || '',
          ticketNo: '', tickets: [], photo: null, status: 'saved',
          pipeId: d.id, pipeFrom: d.from, pipeFromName: d.fromName || '',
          source: 'Connect — ' + (d.fromName || 'your connection'),
          pipeConflict: conflict || undefined
        };
        list.push(rec);
        landed[d.id] = rec.id;
        changedDates[dateStr] = true;
        /* two ticks: it has landed in my app */
        try {
          f.db.collection('pipedispatches').doc(d.id)
            .update({ status: 'delivered', deliveredAt: Date.now() }).catch(function () {});
        } catch (e) {}
      });
      st.set('dsp_list', list);
      st.set('pipe_landed', landed);
      CP._pulling = false;
      /* my day now includes the boss-sent job — it flows back up
         with its origin on it, so his board expects the ticket */
      Object.keys(changedDates).forEach(function (ds) { try { CP.publishDay(ds); } catch (e) {} });
      return fresh.length;
    }).catch(function () { CP._pulling = false; return 0; });
  };

  /* Blue ticks: my Dispatch screen showed these records. One
     write per delivery, ever (pipe_seen persists the fact). */
  CP.markSeen = function (records) {
    var f = fb(), st = store();
    if (!f || !st) return;
    var seen = st.get('pipe_seen', {}) || {};
    var dirty = false;
    (records || []).forEach(function (r) {
      if (!r || !r.pipeId || seen[r.pipeId]) return;
      seen[r.pipeId] = 1; dirty = true;
      try {
        f.db.collection('pipedispatches').doc(r.pipeId)
          .update({ status: 'seen', seenAt: Date.now() }).catch(function () {});
      } catch (e) {}
    });
    if (dirty) st.set('pipe_seen', seen);
  };

  /* ---------------- the boss's board ---------------- */

  /* Every shared day a connected peer has published TO me for a
     date — the self-aggregating board feed. The viewers list on
     each doc is the only door (the rules enforce the same). */
  CP.fetchCrew = function (dateStr) {
    var f = fb();
    if (!f) return Promise.resolve([]);
    return job(f.db.collection('shareddays').where('viewers', 'array-contains', f.user.uid).get())
      .then(function (a) {
        var days = a.filter(function (d) { return d && d.date === dateStr; });
        CP._crewCache = { date: dateStr, days: days };
        return days;
      });
  };
  CP.fetchCrewRange = function (fromDate, toDate) {
    var f = fb();
    if (!f) return Promise.resolve([]);
    return job(f.db.collection('shareddays').where('viewers', 'array-contains', f.user.uid).get())
      .then(function (a) {
        return a.filter(function (d) { return d && d.date >= fromDate && d.date <= toDate; });
      });
  };

  /* My prices for one driver's shared facts — read from MY OWN
     books only: my client rate (Preferences: billingRate, the
     plain rate as its standing fallback) and the pay terms I set
     for this driver in P&L (the pnl_drivers entry carrying his
     uid). Either may be unset — pricing then says so honestly
     instead of inventing a number. */
  CP.pricingFor = function (driverUid) {
    var st = store();
    var out = { clientRate: 0, wage: null, entryId: '' };
    if (!st) return out;
    var o = st.get('onboarding', {}) || {};
    out.clientRate = parseFloat(o.billingRate) || parseFloat(o.payRate) || 0;
    (st.get('pnl_drivers', []) || []).forEach(function (d) {
      if (d && d.uid && d.uid === driverUid && !out.wage) {
        out.wage = { payType: d.payType || 'hourly', rate: parseFloat(d.rate) || 0 };
        out.entryId = d.id || '';
      }
    });
    return out;
  };

  /* Price ONE shared dispatch from the boss's side — the ticket's
     double duty (owner refinement, Oct 17 11:29): revenue at his
     client rate on the BILLABLE hours (foreman, + travel only
     when the customer agreed), wages at (foreman + travel) x his
     pay rate for the driver. Pure: facts in, priced view out;
     nothing is written anywhere. */
  CP.priceDispatch = function (sd, pricing) {
    var p = pricing || {};
    var foreman = parseFloat(sd && sd.foremanHours) || 0;
    var travel = parseFloat(sd && sd.travelHours) || 0;
    var billable = foreman + (sd && sd.travelBillable ? travel : 0);
    var rev = null, wage = null;
    /* money exists only once the ticket CLOSES — an open dispatch
       prices nothing yet, on either leg (never a fake $0). */
    if (sd && sd.status === 'completed') {
      if (p.clientRate > 0) rev = r2(billable * p.clientRate);
      if (p.wage && p.wage.rate > 0) {
        if (p.wage.payType === 'hourly') wage = r2((foreman + travel) * p.wage.rate);
        else if (p.wage.payType === 'perload') wage = r2((parseFloat(sd.loads) || 0) * p.wage.rate);
        /* permile prices at the DAY level (session km); salary is
           monthly — neither prices per ticket, honestly */
      }
    }
    return {
      billableHours: r2(billable), paidHours: r2(foreman + travel),
      revenue: rev, wage: wage
    };
  };

  /* Price a whole shared day: per-dispatch rows + day totals. */
  CP.priceDay = function (day, pricing) {
    var rows = [], tRev = 0, tWage = 0, anyRev = false, anyWage = false;
    (day.dispatches || []).forEach(function (sd) {
      var pr = CP.priceDispatch(sd, pricing);
      rows.push({ dispatch: sd, price: pr });
      if (pr.revenue !== null) { tRev += pr.revenue; anyRev = true; }
      if (pr.wage !== null) { tWage += pr.wage; anyWage = true; }
    });
    /* per-mile wage prices off the day's session distance —
       only once the day has a closed ticket (the money event) */
    var anyClosed = (day.dispatches || []).some(function (sd) { return sd && sd.status === 'completed'; });
    if (anyClosed && pricing && pricing.wage && pricing.wage.payType === 'permile' &&
        pricing.wage.rate > 0 && day.session && day.session.km > 0) {
      tWage += r2(day.session.km * pricing.wage.rate);
      anyWage = true;
    }
    return {
      rows: rows,
      revenue: anyRev ? r2(tRev) : null,
      wage: anyWage ? r2(tWage) : null,
      margin: (anyRev && anyWage) ? r2(tRev - tWage) : null
    };
  };

  /* ---------------- lifecycle ---------------- */

  /* Called from App.onAuth beside ConnectLive.onAuth. Waits for
     CloudSync's first pull (so a pre-pull con_list / dsp_list can
     never publish or land over the cloud copies), then: my inbox
     lands, my recent days publish to my peers, and — for an
     office/both face — the crew cache warms for the status line. */
  CP.onAuth = function (user) {
    if (!user) return;
    var kick = function () {
      try { CP.pullInbox(); } catch (e) {}
      try { CP.publishRecent(); } catch (e) {}
      try {
        var role = (window.App && App.userRole) ? App.userRole() : 'driver';
        if (role !== 'driver') {
          var t = '';
          try { t = App._today(); } catch (e) {}
          if (t) CP.fetchCrew(t);
        }
      } catch (e) {}
    };
    try {
      if (window.CloudSync && CloudSync.whenFirstPullDone) {
        CloudSync.whenFirstPullDone(9000).then(kick);
        return;
      }
    } catch (e) {}
    kick();
  };
})();
