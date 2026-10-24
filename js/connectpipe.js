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
 *    WAGES (out):   (foreman + travel) x the DRIVER'S OWN wage
 *      rate. v163 (the owner's settled design, Oct 18, 2026):
 *      the driver sets his wage on his own side; it travels in
 *      his records doc and prices his days on the boss's books
 *      as an expense at HIS rate — the boss never sets driver
 *      wages. (The v132 boss-set P&L entry survives only as the
 *      fallback for a driver whose own wage has not crossed
 *      yet.) The travel hour is part of the driver's pay — the
 *      haul-card model: 10.0 foreman + 1 travel = 11.0 h x rate.
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
 *  v146 — THE SHARED RECORDS (owner, Oct 17 21:25–21:33 MDT:
 *  "The most important thing is that he sees my fuel... My
 *  maintenance record, and my pay goes as an expense in his pnl"
 *  + "Make sure he gets my fuel receipts, my pay invoices and my
 *  expenses" + "He also gets my manifests..."): a connected payer
 *  now sees more than the day —
 *    sharedrecords/{driverUid}: my FUEL entries (date, time,
 *      station, litres, amount, $/L, odometer — the full receipt
 *      DATA), my other Fuel & Expense entries, and my MAINTENANCE
 *      record (odometer, next-service targets, the due list, the
 *      annual-inspection expiry, recent services). Named viewers
 *      only, same posture as shareddays.
 *    sharedphotos/{driverUid}_{fillKey}: a downscaled rendition
 *      of ONE fuel receipt photo — the photo itself crosses here,
 *      one doc per fill, so the facts record stays small.
 *    sharedbilling/{driverUid}_{viewerUid}: my ISSUED pay
 *      invoices for periods billed to THAT payer only (bill-to
 *      matched against his known names on MY side before anything
 *      is written), with the full document payload (the payer
 *      renders/prints the invoice with the Invoice module's own
 *      composer), plus the period MANIFESTS that pair with those
 *      invoices (the manifest's own printed lines per day).
 *  The priced WAGE leg additionally lands in the payer's P&L
 *  expense totals — derived there from the cached shared days
 *  (modules/pnl.js), never stamped, so it can never double-post.
 *
 *  Rules for both collections ship in firestore.rules and deploy
 *  with the app (deploy.yml: hosting,firestore:rules): a shared
 *  day is readable only by its driver and the peers named in its
 *  viewers list (his accepted connections at publish time) and
 *  writable only by the driver; a pipe dispatch is readable by
 *  its two parties, creatable only by its sender as 'sent', and
 *  only the recipient may advance its receipt marks.
 *
 *  v148 — CONNECTION KINDS (owner, Oct 17, 2026 21:35–21:36 MDT):
 *  the kind on a connection (js/connectlive.js) governs what
 *  crosses to that peer:
 *    ALL (and every pre-v148 pair — the grandfather read): the
 *      full v132/v146 share, byte-identical to before.
 *    LIMITED (a dispatcher's kind): ONLY the dispatch pipe
 *      (untouched, both ways) and his MANIFESTS cross — a new
 *      per-viewer doc sharedmanifests/{driver}_{viewer} carrying
 *      the manifest lines for exactly the days that viewer
 *      dispatched to the driver (his dsp_list records with
 *      pipeFrom = that viewer). The day/records/photos viewers
 *      lists are built from sharePeers() — connected peers
 *      MINUS limited ones — no billing doc is ever written for
 *      a limited peer (a stale one is emptied by the standing
 *      clearing pass), and the readers gate on the same kind:
 *      fetchCrew/fetchCrewRange drop a limited driver's days
 *      even when a stale day doc still names the viewer, and
 *      fetchRecords hands a limited peer his manifests doc and
 *      nothing else. The rules deny the withheld dirs to a
 *      limited viewer outright (firestore.rules pairLimited).
 *    ONE-TIME: All scope while it lives; when it ends itself
 *      (connectlive's sweep), status leaves 'connected', so
 *      connectedPeers() stops naming him and the next publish
 *      cycle prunes him everywhere — ended peers are pruned
 *      from a day doc's viewers even when he was its last viewer
 *      (publishDay's write-once-with-empty-viewers, the records
 *      doc's v146 discipline carried to days).
 *
 *  v162 — THE SHARED PTI (owner, Oct 18, 2026): the driver's
 *  filed Pre-Trip Inspections (modules/pti.js) ride THIS doc as
 *  `pti` — newest 14, facts only (date, unit, plate, odometer,
 *  location, result, defects with severity + note; photo bytes
 *  never cross). Same viewers, same kind gates, same rules as
 *  every other field here — a Limited peer is never named, so
 *  no PTI ever reaches him. The boss's side paints them inside
 *  his connected-driver records block (modules/pnl.js), majors
 *  in red.
 */
(function () {
  'use strict';

  var CP = {
    _pubCache: {},      // dayDocId -> JSON last published this session
    _pulling: false,
    _lastPullAt: 0,
    _crewCache: null,   // {date, days} — last fetchCrew result (status line)
    _recCache: {},      // v146: records/billing docId -> JSON last published (or 'CLEARED')
    _billedKnown: null, // v146: viewerUids with a live billing doc (seeded from the cloud once)
    _billedSession: {}, // v146: viewerUids billed by this session's publishes
    _mfKnown: null,     // v148: viewerUids with a live sharedmanifests doc (seeded with the billing seed)
    _mfSession: {},     // v148: viewerUids given a manifests doc by this session's publishes
    _photoCache: {},    // v146: fillKey -> publish guard for receipt renditions
    _peerCache: null    // v146: last fetchRecords result {records, billing}
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

  /* v148: the kind on MY con_list entry for a peer — the same
     grandfather read as ConnectLive.kindOf (absent/invalid =
     'all'), restated here so the pipe never depends on the
     handshake engine being loaded first. */
  CP.kindFor = function (uid) {
    var st = store();
    if (!st || !uid) return 'all';
    var out = 'all';
    (st.get('con_list', []) || []).forEach(function (c) {
      if (c && c.uid === uid && (c.kind === 'limited' || c.kind === 'once')) out = c.kind;
    });
    return out;
  };

  /* v176 (L1, owner Oct 20, 2026): the ticked module list on MY
     con_list entry for a peer — the pipe's mirror of
     ConnectLive.modulesOf. 'all'/'once' -> null (no restriction
     beyond the kind itself); 'limited' -> the ticked list, or
     the legacy preset ['dispatch','manifest'] when none was ever
     ticked (every pre-v176 pair). */
  CP.MODULE_KEYS = ['dispatch', 'manifest', 'fuel', 'expenses', 'navigation', 'maintenance', 'pti', 'invoices', 'pnl'];
  CP.RECORD_MODULES = ['fuel', 'expenses', 'maintenance', 'pti', 'invoices', 'pnl'];
  CP.modulesFor = function (uid) {
    var st = store();
    if (!st || !uid) return null;
    var entry = null;
    (st.get('con_list', []) || []).forEach(function (c) { if (c && c.uid === uid) entry = c; });
    if (!entry || CP.kindFor(uid) !== 'limited') return null;
    var out = [];
    if (Array.isArray(entry.modules)) {
      entry.modules.forEach(function (k) {
        if (CP.MODULE_KEYS.indexOf(k) !== -1 && out.indexOf(k) === -1) out.push(k);
      });
    }
    return out.length ? out : ['dispatch', 'manifest'];
  };
  CP.allowsModule = function (uid, key) {
    var m = CP.modulesFor(uid);
    return m === null || m.indexOf(key) !== -1;
  };
  /* A limited peer whose ticks reach into the records doc
     (fuel/expenses/maintenance/pti/invoices/pnl) IS named as a
     records viewer; the reader strips every unticked section, so
     what he can actually see is exactly what was ticked. */
  CP.limitedNeedsRecords = function (uid) {
    var m = CP.modulesFor(uid);
    if (!m) return false;
    return CP.RECORD_MODULES.some(function (k) { return m.indexOf(k) !== -1; });
  };

  /* v148: the peers my SHARED FACTS publish to — every connected
     peer except LIMITED ones. A limited peer gets the dispatch
     pipe and his manifests doc, never a seat in a viewers list.
     One-time peers ride while connected, exactly like All.
     v176 (L1): a limited peer whose approver ticked records
     modules joins the viewers list for the records doc only —
     the reader-side section strip + the rules' modules check
     keep unticked modules shut. */
  CP.sharePeers = function () {
    return CP.connectedPeers().filter(function (c) {
      if (CP.kindFor(c.uid) !== 'limited') return true;
      return CP.limitedNeedsRecords(c.uid);
    });
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

  /* Where a revenue entry came from — the Invoice module's own
     classification (Meticulous.shared.revenueEntrySource when the
     module is loaded; the identical rule restated otherwise). */
  CP.entrySource = function (e) {
    try {
      if (window.Meticulous && Meticulous.shared && Meticulous.shared.revenueEntrySource) {
        return Meticulous.shared.revenueEntrySource(e);
      }
    } catch (err) {}
    if (!e) return 'entry';
    if (e.auto) return 'tracker';
    var n = e.note || '';
    if (n.indexOf('Dispatch:') === 0) return 'dispatch';
    if (n === 'Auto from tracker') return 'tracker';
    return 'entry';
  };

  /* THE DAY'S CLOSE FACTS (v146 priority fix — owner, Oct 17
     21:41 MDT, over the payer's own screenshot): a day closed
     through the TRACKER (End Shift — the normal driver close)
     published session hours but foreman 0 / travel 0 / no close
     split, because the facts were read off the dispatch tickets
     only — so the payer's board could never price the day
     (0 × any rate) no matter what rates he set. The truth the
     driver's own books print (Revenue, the manifest, the
     invoice) converges on the day's REVENUE entries under the
     standing one-line-per-day precedence — a dispatch completion
     beats hand entries, which beat the tracker's auto entry —
     so the close facts are read from the WINNING group, exactly
     as Meticulous.shared.buildRevenueLines chooses it:
       foreman = the group's foremanHours where the entries
         carry the split, else their hours (a tracker entry's
         hours ARE the close's hours);
       travel / bonus = the split fields where present;
       material + ticket # = the day's close record (its
         dispatch), when the day has one.
     With no entries at all, a stopped session is itself the
     close record. Null when the books hold nothing for the day. */
  CP.buildCloseFacts = function (dateStr, sessionHours) {
    var st = store();
    if (!st) return null;
    var groups = { dispatch: [], entry: [], tracker: [] };
    (st.get('rev_entries', []) || []).forEach(function (e) {
      if (!e || e.date !== dateStr) return;
      var s = CP.entrySource(e);
      (groups[s] || groups.entry).push(e);
    });
    var win = null, src = '';
    if (groups.dispatch.length) { win = groups.dispatch; src = 'dispatch'; }
    else if (groups.entry.length) { win = groups.entry; src = 'entry'; }
    else if (groups.tracker.length === 1) { win = groups.tracker; src = 'tracker'; }
    var material = '', ticketNo = '';
    (st.get('dsp_list', []) || []).forEach(function (d) {
      if (!d || CP.recordDate(d) !== dateStr || d.status === 'cancelled') return;
      if (!material && d.material) material = String(d.material).trim();
      if (!ticketNo) {
        ticketNo = String(d.ticketNo || '').trim();
        if (!ticketNo) {
          (d.tickets || []).forEach(function (t) {
            if (!ticketNo && t && (t.cardNumber || t.ticketNo)) ticketNo = String(t.cardNumber || t.ticketNo);
          });
        }
      }
    });
    if (!win) {
      if (sessionHours > 0) {
        return { source: 'session', foremanHours: r2(sessionHours), travelHours: 0, bonusHours: 0, loads: 0, material: material, ticketNo: ticketNo };
      }
      return null;
    }
    var foreman = 0, travel = 0, bonus = 0, loads = 0;
    win.forEach(function (e) {
      var fh = parseFloat(e.foremanHours);
      if (!isFinite(fh)) fh = parseFloat(e.hours) || 0;
      foreman += fh;
      travel += parseFloat(e.travelHours) || 0;
      bonus += parseFloat(e.bonusHours) || 0;
      loads += parseFloat(e.loads) || 0;
    });
    return {
      source: src,
      foremanHours: r2(foreman), travelHours: r2(travel), bonusHours: r2(bonus),
      loads: r2(loads), material: material, ticketNo: ticketNo
    };
  };

  /* v242 (WORK-PROFILES — the CONNECT FENCE): a day worked
     under a non-main profile must NEVER publish to his main
     carrier's connections (Umar / the boss at Ai Trucking see
     Ai days only). The day's own stamped records say which
     profile it belongs to; ANY non-Profile-1 stamp on the date
     fences the whole day — a leak fence errs toward silence.
     Unstamped legacy records read as Profile 1, as everywhere. */
  function wpIdOfRec(rec) {
    try { if (window.App && App.workProfiles) return App.workProfiles.idOf(rec); } catch (e) {}
    return (rec && rec.profileId) ? String(rec.profileId) : 'p1';
  }
  CP._dayFenced = function (dateStr) {
    var st = store();
    if (!st || !dateStr) return false;
    var fenced = false;
    function scan(list, dateOf) {
      (list || []).forEach(function (r) {
        if (!fenced && r && dateOf(r) === dateStr && wpIdOfRec(r) !== 'p1') fenced = true;
      });
    }
    try {
      scan(st.get('dsp_list', []), function (d) { return CP.recordDate(d); });
      var act = st.get('dsp_active', null);
      if (act && CP.recordDate(act) === dateStr && wpIdOfRec(act) !== 'p1') fenced = true;
      scan(st.get('sessions', []), function (s) { return s && s.date; });
      scan(st.get('rev_entries', []), function (e) { return e && e.date; });
    } catch (e) { return false; }
    return fenced;
  };

  /* Assemble MY shared day record for a date — facts only. Null
     when there is nothing to share (no dispatches, no session). */
  CP.buildDay = function (dateStr) {
    var f = fb(), st = store();
    if (!f || !st || !dateStr) return null;
    var o = st.get('onboarding', {}) || {};
    var travelBonus = parseFloat(o.travelBonus) || 0;
    var dispatches = [];
    (st.get('dsp_list', []) || []).forEach(function (d) {
      /* v228 (UMAR-CONNECT-VIABILITY S3): a CANCELLED dispatch
         rides the record too, marked cancelled — the partner's
         board must show the day as no-work, never keep showing
         the job as open after the driver cancelled it, and
         never lose the day entirely. The day's facts stay
         clean: buildCloseFacts already skips cancelled
         records, and the loads counter below skips them too. */
      if (d && CP.recordDate(d) === dateStr) {
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
    /* v146: the day's close facts ride the record (see
       buildCloseFacts) — whichever record actually closed the
       day carries the split the payer prices. */
    var close = CP.buildCloseFacts(dateStr, session.hours);
    if (!dispatches.length && !(session.hours > 0) && !session.active && !close) return null;
    var idn = { name: '', business: '' };
    try { if (window.ConnectLive) idn = ConnectLive.identity(); } catch (e) {}
    var loads = 0, ticketsClosed = 0;
    dispatches.forEach(function (x) {
      if (x.status === 'cancelled') return;   /* v228: no phantom loads */
      loads += x.loads || 0;
      if (x.status === 'completed') ticketsClosed += x.tickets.length;
    });
    return {
      driver: f.user.uid,
      date: dateStr,
      driverName: idn.name || '',
      driverBusiness: idn.business || '',
      viewers: CP.sharePeers().map(function (c) { return c.uid; }),
      session: session,
      dispatches: dispatches,
      close: close,
      loads: r2(loads),
      ticketsClosed: ticketsClosed,
      updatedAt: Date.now()
    };
  };

  CP.dayDocId = function (driverUid, dateStr) { return driverUid + '_' + dateStr; };

  /* v226 (UMAR-CONNECT-BLANK, owner Oct 22, 2026 21:05 MDT): a
     publish must never move a partner's record BACKWARD. Tonight
     the driver closed his day in the app — dispatch completed,
     haul card #22864, foreman 10.0h — yet his Full-access partner
     saw nothing: the evening's cold starts (two installs) pulled
     cloud copies that predated the close over the just-closed
     local records, and every later publish from that rolled-back
     store cheerfully rewrote the shared day from the weaker
     state — session-only hours in place of the foreman close, the
     completed dispatch back to active — the same stamp-war
     fingerprint as the close being re-posted from raw tracker
     elapsed on his own books. The discipline here: close facts
     and completed dispatches, once published, are PRESERVED.
     Before a write, the existing day doc is read; when it holds
     a real close (foreman hours from the dispatch/entry record —
     not a session-derived stand-in) and the freshly built doc
     does not, the published close rides the new doc; a completed
     dispatch the new build lost or un-completed is restored
     whole, matched by ticket/id. A fresh real close (a corrected
     card, a re-completion) is itself strong and wins as before.
     Reproduced RED in tools/umar-connect-blank-test.js (V5/V7)
     before this fix; the exact sequences are the ship gate. */
  function strongClose(c) {
    return !!(c && (parseFloat(c.foremanHours) > 0) && c.source !== 'session');
  }
  CP._preserveClose = function (f, id, doc) {
    return f.db.collection('shareddays').doc(id).get().then(function (snap) {
      if (!snap || !snap.exists) return doc;
      var old = snap.data() || {};
      var out = clone(doc);
      if (strongClose(old.close) && !strongClose(out.close)) out.close = old.close;
      var olds = (old.dispatches || []).filter(function (d) { return d && d.status === 'completed'; });
      var merged = false;
      olds.forEach(function (od) {
        var hit = -1;
        (out.dispatches || []).forEach(function (nd, i) {
          if (hit < 0 && nd && ((od.ticketNo && nd.ticketNo === od.ticketNo) || (od.id && nd.id === od.id))) hit = i;
        });
        if (hit >= 0) {
          if (out.dispatches[hit].status !== 'completed') { out.dispatches[hit] = od; merged = true; }
        } else { out.dispatches.push(od); merged = true; }
      });
      if (merged || (old.close && out.close === old.close)) {
        var loads = 0, ticketsClosed = 0;
        out.dispatches.forEach(function (x) {
          loads += x.loads || 0;
          if (x.status === 'completed') ticketsClosed += (x.tickets || []).length;
        });
        out.loads = r2(loads);
        out.ticketsClosed = ticketsClosed;
      }
      return out;
    }).catch(function () { return doc; });
  };

  /* v228 (UMAR-CONNECT-VIABILITY S8, owner Oct 23, 2026 06:57
     MDT: "make sure a million times that umars connection is
     viable and he sees everything that is going on daily"): the
     v226 preserve discipline extends to the OTHER shared docs.
     The day doc was fixed in v226, but the records doc, the
     per-peer billing docs and the limited peers' manifests docs
     could still be rewritten BACKWARD by a rolled-back store —
     and the clearing passes then mistook "the rolled-back build
     matched nothing" for "the peer is gone" and EMPTIED live
     docs (Umar's invoice doc, Maria's manifests doc). The rules
     here mirror _preserveClose: published facts are preserved
     by UNION (fresh values win per record); a record may leave
     the published doc only when the driver's CURRENT books
     still hold it and deliberately exclude it (an invoice
     settled outside, retargeted to another bill-to); and the
     clearing passes fire only when the peer is no longer
     ENTITLED (removed, or their kind/modules no longer cover
     the doc) — never merely because a build came back empty.
     ACCESS IS NEVER PRESERVED: viewers always come from the
     fresh doc, so a revoke still prunes exactly as before.
     Reproduced RED in tools/umar-connect-viability-test.js
     (S8/S8b/S10) before this fix. */
  CP._preserveRecords = function (fresh, existing) {
    if (!existing || typeof existing !== 'object') return fresh;
    var out = clone(fresh) || {};
    function unionBy(freshArr, oldArr, keyFn, cap, cmp) {
      var map = {}, order = [];
      (oldArr || []).forEach(function (x) {
        if (!x) return;
        var k = keyFn(x);
        if (!(k in map)) order.push(k);
        map[k] = x;
      });
      (freshArr || []).forEach(function (x) {
        if (!x) return;
        var k = keyFn(x);
        if (!(k in map)) order.push(k);
        map[k] = x;   /* the fresh build wins per record */
      });
      var arr = order.map(function (k) { return map[k]; });
      if (cmp) arr.sort(cmp);
      return cap ? arr.slice(0, cap) : arr;
    }
    out.fuel = unionBy(out.fuel, existing.fuel,
      function (f) { return CP.fillKey(f); }, 600, byDateDesc);
    out.expenses = unionBy(out.expenses, existing.expenses,
      function (e) { return [e && e.date, e && e.what, e && e.cost].join('|'); },
      300, byDateDesc);
    out.pti = unionBy(out.pti, existing.pti,
      function (p) { return [p && p.date, p && p.filedAt, p && p.kind].join('|'); },
      14, function (a, b) { return (parseFloat(b && b.filedAt) || 0) - (parseFloat(a && a.filedAt) || 0); });
    /* maintenance: the block follows the HIGHER odometer
       reading; whichever block loses still fills the fields
       the winner lacks, and services union by their facts */
    var em = existing.maintenance, om = out.maintenance;
    if (em && !om) {
      out.maintenance = em;
    } else if (em && om) {
      var win = (parseFloat(em.odometer) || 0) > (parseFloat(om.odometer) || 0) ? em : om;
      var other = win === em ? om : em;
      var merged = {};
      Object.keys(other || {}).forEach(function (k) { merged[k] = other[k]; });
      Object.keys(win || {}).forEach(function (k) { merged[k] = win[k]; });
      merged.services = unionBy(win.services, other.services,
        function (s) { return [s && s.date, s && s.type, s && s.odo, s && s.cost].join('|'); },
        40, function (a, b) { return String((b && b.date) || '').localeCompare(String((a && a.date) || '')); });
      out.maintenance = merged;
    }
    if (!out.driverWage && existing.driverWage) out.driverWage = existing.driverWage;
    return out;
  };

  /* A peer's billing doc under the same discipline: invoices
     union by id — an invoice leaves only when the current
     books still hold its id (settled outside / retargeted:
     a deliberate exclusion); an id ABSENT from the books is
     the rollback signature and the published copy is kept.
     Manifest day lines union by date inside the period. */
  CP._preserveBilling = function (fresh, existing, localInvoices) {
    if (!existing || typeof existing !== 'object') return fresh;
    var out = clone(fresh) || { invoices: [], manifests: [] };
    var localById = {};
    (localInvoices || []).forEach(function (inv) {
      if (inv && inv.id != null) localById[String(inv.id)] = true;
    });
    var byId = {}, order = [];
    (existing.invoices || []).forEach(function (inv) {
      if (!inv || inv.id == null) return;
      var k = String(inv.id);
      if (!(k in byId)) order.push(k);
      byId[k] = inv;
    });
    (out.invoices || []).forEach(function (inv) {
      if (!inv || inv.id == null) return;
      var k = String(inv.id);
      if (!(k in byId)) order.push(k);
      byId[k] = inv;
    });
    var freshIds = {};
    (out.invoices || []).forEach(function (inv) {
      if (inv && inv.id != null) freshIds[String(inv.id)] = true;
    });
    out.invoices = order.map(function (k) { return byId[k]; }).filter(function (inv) {
      if (!inv || inv.id == null) return false;
      var k = String(inv.id);
      if (freshIds[k]) return true;   /* in the fresh build for this peer */
      /* published before, absent from the fresh build: drop it
         ONLY when the current books still hold the id (settled
         outside / retargeted — a deliberate exclusion). An id
         the books no longer hold at all is the rollback
         signature — the published copy stays. */
      return !localById[k];
    });
    var man = (out.manifests && out.manifests[0]) || null;
    var eman = (existing.manifests && existing.manifests[0]) || null;
    if (!man && eman) {
      out.manifests = existing.manifests;
    } else if (man && eman) {
      var seen = {};
      (man.days || []).forEach(function (d) { if (d) seen[String(d.date)] = true; });
      var days = (man.days || []).slice();
      (eman.days || []).forEach(function (d) {
        if (d && !seen[String(d.date)]) { seen[String(d.date)] = true; days.push(d); }
      });
      days.sort(function (a, b) { return String((a && a.date) || '').localeCompare(String((b && b.date) || '')); });
      man.days = days;
    }
    return out;
  };

  /* A limited peer's manifests doc: the same day-line union —
     a dispatched day once published is never unpublished by a
     weaker rebuild. */
  CP._preserveManifests = function (fresh, existing) {
    if (!existing || typeof existing !== 'object') return fresh;
    var out = clone(fresh) || { manifests: [] };
    var man = (out.manifests && out.manifests[0]) || null;
    var eman = (existing.manifests && existing.manifests[0]) || null;
    if (!man && eman) { out.manifests = existing.manifests; return out; }
    if (man && eman) {
      var seen = {};
      (man.days || []).forEach(function (d) { if (d) seen[String(d.date)] = true; });
      var days = (man.days || []).slice();
      (eman.days || []).forEach(function (d) {
        if (d && !seen[String(d.date)]) { seen[String(d.date)] = true; days.push(d); }
      });
      days.sort(function (a, b) { return String((a && a.date) || '').localeCompare(String((b && b.date) || '')); });
      man.days = days;
    }
    return out;
  };

  /* Publish one of MY days to my connected peers. Content-guarded
     per session: the same facts are never written twice in a row.
     Resolves true when a write happened. */
  CP.publishDay = function (dateStr) {
    var f = fb();
    if (!f) return Promise.resolve(false);
    /* v242 fence: a non-main-profile day never crosses — not
       today, not in history, not on a records change. */
    try { if (CP._dayFenced(dateStr)) return Promise.resolve(false); } catch (e) {}
    var built = CP.buildDay(dateStr);
    if (!built) return Promise.resolve(false);
    var id = CP.dayDocId(f.user.uid, dateStr);
    if (!built.viewers.length) return CP._publishDayDoc(f, id, built);
    return CP._preserveClose(f, id, built).then(function (doc) {
      return CP._publishDayDoc(f, id, doc);
    });
  };

  CP._publishDayDoc = function (f, id, doc) {
    /* the write guard compares FACTS, not the stamp: updatedAt
       changes on every publish by design, so it is excluded from
       the key — unchanged facts are never written twice in a row */
    var keyDoc = clone(doc); delete keyDoc.updatedAt;
    var key = JSON.stringify(keyDoc);
    if (CP._pubCache[id] === key) return Promise.resolve(false);
    if (!doc.viewers.length) {
      /* v148: when the LAST shareable viewer goes away — a kind
         flip to limited, a one-time end, a removal — the day is
         written ONCE more with the empty viewers list (access
         actually revoked, the records doc's v146 discipline),
         then stays silent. Only when THIS session published the
         day with viewers before: a day that never had any has
         nothing to revoke (a cross-session remainder is covered
         by the reader gates + the rules' pair checks). */
      var prev = CP._pubCache[id];
      CP._pubCache[id] = key;
      if (!prev) return Promise.resolve(false);
      var prevViewers = [];
      try { prevViewers = JSON.parse(prev).viewers || []; } catch (e) {}
      if (!prevViewers.length) return Promise.resolve(false);
      return f.db.collection('shareddays').doc(id).set(doc)
        .then(function () { return true; })
        .catch(function () { CP._pubCache[id] = ''; return false; });
    }
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

  /* v233 (DSP-REVOCATION-GATE, owner Oct 23, 2026 — the physical
     proof run): a connection REMOVED between compose and send
     must fail honestly, by name, not land silently. Removal in
     this app is local by design (v131: the entry leaves con_list
     and the uid is remembered in con_hidden; the pair's request
     doc is never touched) — so the gates live on the two clients
     it can actually govern: the sender never writes to a man he
     removed, and the receiver never lands a doc from a man HE
     removed (pullInbox below). _pairLive answers whether a pair
     may carry a send right now: never to a hidden (removed) uid;
     yes when my con_list holds the peer as connected; otherwise
     the pair's own request doc decides — accepted and not ended
     (a one-time pair whose end is already stamped is over; a
     fresh request re-opens it, per the kind law). A pair with
     NO record at all keeps the shipped share posture (the v207
     destination-share contract): no screen offers a send to a
     non-connection, so an unmodelled pair is the share sheet's
     own context, never a revoked one. */
  CP._pairLive = function (peerUid) {
    var f = fb();
    if (!f || !peerUid) return Promise.resolve(false);
    var st = store();
    var hasEntry = false;
    if (st) {
      var hidden = st.get('con_hidden', []) || [];
      if (hidden.indexOf(peerUid) !== -1) return Promise.resolve(false);
      var entryLive = false;
      (st.get('con_list', []) || []).forEach(function (c) {
        if (c && c.uid === peerUid) { hasEntry = true; if (c.status === 'connected') entryLive = true; }
      });
      if (entryLive) return Promise.resolve(true);
    }
    function liveDoc(snap) {
      if (!snap || !snap.exists) return false;
      var v = snap.data() || {};
      return v.status === 'accepted' && !((v.endedAt || 0) > 0);
    }
    return f.db.collection('requests').doc(f.user.uid + '_' + peerUid).get()
      .then(function (s1) {
        if (liveDoc(s1)) return true;
        return f.db.collection('requests').doc(peerUid + '_' + f.user.uid).get()
          .then(function (s2) {
            if (liveDoc(s2)) return true;
            /* Positive evidence of a dead pair — a request doc
               that exists but is declined/ended, or a con_list
               entry that never reached connected — refuses. NO
               pair record at all keeps the shipped share posture
               (the v207 destination-share contract): no screen in
               the app offers a send to a non-connection, so an
               unmodelled pair is the share sheet's own context,
               not a stranger. */
            if ((s1 && s1.exists) || (s2 && s2.exists) || hasEntry) return false;
            return true;
          });
      })
      .catch(function () { return false; });
  };

  /* Send a dispatch to a connected driver. The doc IS the
     delivery: status starts 'sent' (one tick); the driver's app
     advances it to delivered, then seen. Resolves 'sent'|'error'.
     v233: the write goes out only over a LIVE pair (above) — a
     peer removed since the card was composed resolves 'error',
     so the fan-out names him in its failed list instead of
     claiming a send that should never have happened. */
  CP.sendDispatch = function (peerUid, fields) {
    var f = fb();
    if (!f || !peerUid || peerUid === f.user.uid || !fields) return Promise.resolve('error');
    return CP._pairLive(peerUid).then(function (live) {
      if (!live) return 'error';
      return CP._sendDispatchDoc(peerUid, fields);
    });
  };
  CP._sendDispatchDoc = function (peerUid, fields) {
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
      /* v220 (DSP-PIN-NAVIGATE): the job's pin rides the pipe too —
         a dispatch that carries a pin on the sender's side must
         still carry it when it lands (it was dropped here and at
         the landing, so a received dispatch could never offer
         Navigate and GeoLoads never saw its sites). Facts only,
         like everything on the pipe — never rates. */
      lat: Number(fields.lat) || 0, lng: Number(fields.lng) || 0,
      dumpLat: Number(fields.dumpLat) || 0, dumpLng: Number(fields.dumpLng) || 0,
      pickup: String(fields.pickup || ''), dropoff: String(fields.dropoff || ''),
      /* v207: a DESTINATION share (sendDestination) rides this
         same doc, flagged — never a job: navShare + the pin. */
      navShare: !!fields.navShare,
      navLat: Number(fields.navLat) || 0, navLng: Number(fields.navLng) || 0,
      status: 'sent', sentAt: Date.now(), deliveredAt: 0, seenAt: 0
    };
    return f.db.collection('pipedispatches').doc(id).set(doc)
      .then(function () {
        /* v148: a dispatch sent over a ONE-TIME connection
           re-stamps the pair's day to the job's day — the
           connection rides in with this dispatch. */
        try {
          if (window.ConnectLive && ConnectLive.stampOnceDate && doc.date) {
            ConnectLive.stampOnceDate(peerUid, doc.date);
          }
        } catch (e) {}
        return 'sent';
      })
      .catch(function () { return 'error'; });
  };

  /* v230 (DSP-MULTI-SEND, owner Oct 22, 2026 21:13 MDT):
     send the SAME dispatch to several connected drivers at
     once. Each ticked driver gets his OWN pipe doc through the
     untouched sendDispatch above — one send per driver, the
     exact record a single send lands; his copy is his alone
     from the moment it is written. Resolves a PER-DRIVER
     verdict { sent: [uids], failed: [uids] } in the caller's
     tick order — never a blanket verdict: a driver whose write
     failed is named in failed so the sender can retry just him.
     Duplicate ticks collapse; an empty list is an honest no-op. */
  CP.sendDispatchToMany = function (peerUids, fields) {
    var uids = [];
    (peerUids || []).forEach(function (u) {
      u = String(u || '');
      if (u && uids.indexOf(u) === -1) uids.push(u);
    });
    if (!uids.length) return Promise.resolve({ sent: [], failed: [] });
    if (!fields) return Promise.resolve({ sent: [], failed: uids.slice() });
    var sent = [], failed = [];
    var chain = Promise.resolve();
    uids.forEach(function (uid) {
      chain = chain.then(function () {
        return CP.sendDispatch(uid, fields).then(function (r) {
          if (r === 'sent') sent.push(uid); else failed.push(uid);
        });
      });
    });
    return chain.then(function () { return { sent: sent, failed: failed }; });
  };

  /* v207 (CONNECT-PICK part 3): send a DESTINATION to a connected
     party — "I can share directions on where to go" (owner,
     Oct 21, 2026 13:19 MDT). The destination rides the dispatch
     channel as a flagged doc (same collection, same rules, same
     delivery ticks); pullInbox lands it in the receiver's
     nav_shares inbox — NOT his dispatch list — and only when
     the pair allows the 'navigation' module. The place name is
     the jobSite, the address rides notes, the pin rides
     navLat/navLng (0/0 when the place carries only an address —
     the receiver's Navigator resolves it like any saved place). */
  CP.sendDestination = function (peerUid, place) {
    if (!place || !(place.name || place.address)) return Promise.resolve('error');
    var today = '';
    try { today = App._today(); } catch (e) {}
    return CP.sendDispatch(peerUid, {
      jobSite: String(place.name || ''), date: today,
      scheduledAt: '', equipment: '', material: '',
      notes: String(place.address || ''),
      navShare: true, navLat: Number(place.lat) || 0, navLng: Number(place.lng) || 0
    });
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
      var landedCount = 0;
      /* v233: senders I removed (con_hidden) never land on my
         screen — my removal governs my side even though removal
         is local by design (v131). The doc is not marked landed
         and never materializes here. */
      var hiddenFrom = st.get('con_hidden', []) || [];
      fresh.forEach(function (d) {
        if (hiddenFrom.indexOf(d.from) !== -1) return;
        /* v207: a DESTINATION share lands in the nav_shares
           inbox — never the dispatch list — and only when the
           pair allows 'navigation'. Not allowed: NOT landed, so
           a later kind change can still deliver it (the same
           posture as the reader gates). */
        if (d.navShare) {
          if (!CP.allowsModule(d.from, 'navigation')) return;
          var shares = st.get('nav_shares', []) || [];
          shares.unshift({
            pipeId: d.id, name: d.jobSite || 'Destination', address: d.notes || '',
            lat: Number(d.navLat) || 0, lng: Number(d.navLng) || 0,
            fromName: d.fromName || '', fromUid: d.from, sentAt: d.sentAt || 0, at: Date.now()
          });
          st.set('nav_shares', shares.slice(0, 20));
          landed[d.id] = 'nav';
          landedCount++;
          try {
            f.db.collection('pipedispatches').doc(d.id)
              .update({ status: 'delivered', deliveredAt: Date.now() }).catch(function () {});
          } catch (e) {}
          return;
        }
        /* v220 (DSP-CONNECT-DATE-FILE): the record files by the
           date THE DISPATCH ITSELF states (recordDate: the
           scheduledAt's date, else the date field) — never by
           hand, never defaulted to tomorrow. A doc that states
           NO date files under the day it ARRIVED, flagged
           pipeDateless so the guess is never silent. */
        var dateStr = CP.recordDate(d);
        var dateless = !dateStr;
        if (dateless) { try { dateStr = App._today() || ''; } catch (e) { dateStr = ''; } }
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
          pipeConflict: conflict || undefined,
          pipeDateless: dateless || undefined
        };
        /* v220 (DSP-PIN-NAVIGATE): the pin lands with the record —
           load pin, dump pin, and the pickup/dropoff text — so
           the received dispatch offers Navigate and GeoLoads can
           resolve its sites exactly like a local one. */
        if (isFinite(+d.lat) && isFinite(+d.lng) && (+d.lat !== 0 || +d.lng !== 0)) { rec.lat = +d.lat; rec.lng = +d.lng; }
        if (isFinite(+d.dumpLat) && isFinite(+d.dumpLng) && (+d.dumpLat !== 0 || +d.dumpLng !== 0)) { rec.dumpLat = +d.dumpLat; rec.dumpLng = +d.dumpLng; }
        if (d.pickup) rec.pickup = String(d.pickup);
        if (d.dropoff) rec.dropoff = String(d.dropoff);
        list.push(rec);
        landed[d.id] = rec.id;
        landedCount++;
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
      /* v207: the count is what actually LANDED — a destination
         held back by the navigation gate is not a landing. */
      return landedCount;
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
        /* v148 READER GATE: a LIMITED driver's days never render
           on my board — even when a stale day doc (published
           before the kind, or before a flip) still names me in
           its viewers. The kind on MY con_list entry governs
           what my surfaces may show. */
        var days = a.filter(function (d) {
          /* v176 (L1): the board is the Dispatch surface — a
             limited driver's days render only when Dispatch was
             ticked for him. */
          return d && d.date === dateStr &&
            (CP.kindFor(d.driver) !== 'limited' || CP.allowsModule(d.driver, 'dispatch'));
        });
        CP._crewCache = { date: dateStr, days: days };
        return days;
      });
  };
  CP.fetchCrewRange = function (fromDate, toDate) {
    var f = fb();
    if (!f) return Promise.resolve([]);
    return job(f.db.collection('shareddays').where('viewers', 'array-contains', f.user.uid).get())
      .then(function (a) {
        return a.filter(function (d) {
          return d && d.date >= fromDate && d.date <= toDate &&
            (CP.kindFor(d.driver) !== 'limited' || CP.allowsModule(d.driver, 'dispatch'));
        });
      });
  };

  /* v163: MY OWN WAGE, as I publish it (owner's settled wage
     design, Oct 18, 2026 20:40 MDT: "each DRIVER fills in his
     OWN wage rate on his own side; it travels via Connect and
     posts in the boss's app as an expense at the driver's own
     rate — the boss NEVER sets driver wages"). My wage lives in
     MY Preferences Pay card (ownWageRate, with the v137 payRate
     fallback) under MY pay standard; this is the one wage fact
     about me that crosses — so a boss's books can price my days
     as an expense at MY rate. Null while I have set no wage. */
  CP.sharedWage = function () {
    var st = store();
    if (!st) return null;
    var o = st.get('onboarding', {}) || {};
    var rate = parseFloat(o.ownWageRate) || parseFloat(o.payRate) || 0;
    if (!(rate > 0)) return null;
    var std = String(o.payStandard || 'hourly').toLowerCase();
    var payType = std === 'miles' ? 'permile' : (std === 'trip' ? 'perload' : 'hourly');
    return { payType: payType, rate: rate };
  };

  /* My prices for one driver's shared facts — read from MY OWN
     books only: my client rate (my stored billingRate — the
     company rate on file, kept as the fallback default behind
     the job's own rate, v173) and the driver's wage. The v137
     chain's wage fallbacks (ownWageRate, then payRate) came OUT
     of the client rate (PNL-REVENUE-RATE, owner Oct 21, 2026
     15:33 MDT: "This revenue is not 93 x by my hours" — his
     analysis priced revenue at his WAGE because the chain fell
     back to it): a wage value never prices revenue, so with no
     company rate on file the crew revenue leg is honestly
     unpriced instead of wage-priced. v163 SUPERSEDES the v132 wage source
     for connected drivers (the settled Oct 18 design above):
     the wage is the DRIVER'S OWN, received via Connect (his
     records doc's driverWage, cached locally by the P&L crew
     fetch under '__peer_wages') — never a rate the boss typed
     for him. The pnl_drivers entry carrying his uid remains
     ONLY as the fallback for a driver whose own wage has not
     crossed yet (a pair formed before v163 whose records have
     not re-published), and for hand-added local drivers, who
     have no account to publish from. Either may be unset —
     pricing then says so honestly instead of inventing a
     number. */
  CP.pricingFor = function (driverUid) {
    var st = store();
    var out = { clientRate: 0, wage: null, entryId: '', wageSource: '' };
    if (!st) return out;
    var o = st.get('onboarding', {}) || {};
    out.clientRate = parseFloat(o.billingRate) || 0;
    var peer = null;
    try { peer = (st.get('__peer_wages', {}) || {})[driverUid] || null; } catch (e) { peer = null; }
    if (peer && parseFloat(peer.rate) > 0) {
      out.wage = { payType: peer.payType || 'hourly', rate: parseFloat(peer.rate) || 0 };
      out.wageSource = 'driver';
      return out;
    }
    (st.get('pnl_drivers', []) || []).forEach(function (d) {
      if (d && d.uid && d.uid === driverUid && !out.wage) {
        out.wage = { payType: d.payType || 'hourly', rate: parseFloat(d.rate) || 0 };
        out.entryId = d.id || '';
        out.wageSource = 'local';
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
    /* v146: THE CLOSE-FACTS LEG. When no dispatch on the record
       carries close hours of its own (the day closed through the
       tracker, or a ticketless plain close), the day's CLOSE
       facts price instead — the same split the driver's books
       hold, read at publish time by buildCloseFacts. Revenue =
       foreman × the client rate (travel and bonus are the
       payer's wage cost, never billed onward — the standing
       ticket law); wages = (foreman + travel + bonus) × his pay
       rate, per-load off the day's loads. A dispatch that DOES
       carry its hours always wins — the two legs never stack. */
    var dispatchFacts = (day.dispatches || []).some(function (sd) {
      return sd && sd.status === 'completed' &&
        ((parseFloat(sd.foremanHours) || 0) > 0 || (parseFloat(sd.travelHours) || 0) > 0);
    });
    var close = day.close || null;
    var closeHours = close
      ? (parseFloat(close.foremanHours) || 0) + (parseFloat(close.travelHours) || 0) + (parseFloat(close.bonusHours) || 0)
      : 0;
    if (!dispatchFacts && close && closeHours > 0) {
      var cf = parseFloat(close.foremanHours) || 0;
      var ct = parseFloat(close.travelHours) || 0;
      var cb = parseFloat(close.bonusHours) || 0;
      var cRev = null, cWage = null;
      if (pricing && pricing.clientRate > 0) cRev = r2(cf * pricing.clientRate);
      if (pricing && pricing.wage && pricing.wage.rate > 0) {
        if (pricing.wage.payType === 'hourly') cWage = r2((cf + ct + cb) * pricing.wage.rate);
        else if (pricing.wage.payType === 'perload') {
          var cl = parseFloat(day.loads) > 0 ? parseFloat(day.loads) : (parseFloat(close.loads) || 0);
          if (cl > 0) cWage = r2(cl * pricing.wage.rate);
        }
      }
      if (cRev !== null) { tRev += cRev; anyRev = true; }
      if (cWage !== null) { tWage += cWage; anyWage = true; }
      rows.push({ dispatch: null, close: close, price: {
        billableHours: r2(cf), paidHours: r2(cf + ct + cb), revenue: cRev, wage: cWage
      } });
    }
    /* per-mile wage prices off the day's session distance —
       only once the day has a closed ticket (the money event) */
    var anyClosed = (day.dispatches || []).some(function (sd) { return sd && sd.status === 'completed'; }) ||
      (!dispatchFacts && close && closeHours > 0);
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

  /* ---------------- v146: the shared records ---------------- */

  function byDateDesc(a, b) {
    var x = String((a && a.date) || ''), y = String((b && b.date) || '');
    return x < y ? 1 : (x > y ? -1 : 0);
  }
  function escHtml(s) {
    try { if (window.App && App._esc) return App._esc(s); } catch (e) {}
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* Bill-to matching (v146): an invoice crosses to a peer only
     when the name its Bill-to carries is one of the names that
     peer is known by on MY side — his connection entry plus the
     identity snapshots riding our requests (the directory's
     name/business pair). Normalization is the bill-to heal's
     tolerance: case, punctuation and spacing never block a match,
     and either side containing the other counts (a Bill-to of
     "AI Trucking, 1506 16 St NE…" matches the peer "AI Trucking"). */
  CP.normName = function (s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  };
  CP.billToName = function (billTo) {
    return CP.normName(String(billTo || '').split(',')[0]);
  };
  CP.peerNames = function (uid) {
    var out = [];
    var st = store();
    if (st) {
      (st.get('con_list', []) || []).forEach(function (c) {
        if (c && c.uid === uid) {
          if (c.name) out.push(c.name);
          /* v147: the entry's business is one of the peer's names
             too — since the person may now headline the entry, an
             invoice billed to his COMPANY must still match him. */
          if (c.business) out.push(c.business);
        }
      });
    }
    try {
      var rq = (window.ConnectLive && ConnectLive._reqs) || null;
      if (rq) {
        (rq.incoming || []).forEach(function (q) {
          if (q && q.from === uid) { if (q.fromName) out.push(q.fromName); if (q.fromBusiness) out.push(q.fromBusiness); }
        });
        (rq.outgoing || []).forEach(function (q) {
          if (q && q.to === uid) { if (q.toName) out.push(q.toName); if (q.toBusiness) out.push(q.toBusiness); }
        });
      }
    } catch (e) {}
    return out;
  };
  CP.peerMatchesBillTo = function (uid, billTo) {
    var bt = CP.billToName(billTo);
    if (!bt || bt.length < 3) return false;
    return CP.peerNames(uid).some(function (n) {
      var pn = CP.normName(n);
      if (!pn || pn.length < 3) return false;
      return pn === bt || pn.indexOf(bt) !== -1 || bt.indexOf(pn) !== -1;
    });
  };

  /* One fuel fill as shared facts — the whole receipt the entry
     holds: date + time, station, litres, total, the $/L the two
     imply, the odometer, and the photo's REFERENCE (the photo
     itself crosses in sharedphotos, never inside this record). */
  CP.fillKey = function (f) {
    if (!f) return '';
    return [f.date || '', f.odo || '', f.litres || '', f.cost || '']
      .join('_').replace(/[^a-zA-Z0-9]+/g, '-');
  };
  CP.sharedFill = function (f) {
    var litres = parseFloat(f && f.litres) || 0;
    var cost = parseFloat(f && f.cost) || 0;
    return {
      date: (f && f.date) || '',
      time: (f && f.time) || '',
      station: String((f && f.station) || ''),
      litres: litres,
      cost: cost,
      pricePerLitre: (litres > 0 && cost > 0) ? Math.round(cost / litres * 1000) / 1000 : null,
      odo: (f && parseFloat(f.odo) > 0) ? parseFloat(f.odo) : null,
      photoRef: !!(f && f.photo),
      photoKey: (f && f.photo) ? CP.fillKey(f) : null
    };
  };

  /* My maintenance record as shared facts: the current odometer,
     the next-service targets, the module's own due list (its
     computation, not a re-derivation), the annual-inspection
     expiry, and the recent service history. */
  CP.sharedMaintenance = function () {
    var st = store();
    if (!st) return null;
    var odo = parseFloat(st.get('mt_odo', '')) || 0;
    var nsOdo = parseFloat(st.get('mt_nextServiceOdo', '')) || 0;
    var nsDate = st.get('mt_nextServiceDate', '') || '';
    var annual = st.get('mt_annualDate', '') || '';
    var services = (st.get('mt_events', []) || []).filter(Boolean).slice(-60).reverse().map(function (e) {
      return {
        date: e.date || '', type: String(e.type || ''),
        odo: parseFloat(e.odo) || 0, cost: parseFloat(e.cost) || 0,
        notes: String(e.notes || '')
      };
    });
    var due = [];
    try {
      var M = window.Meticulous && Meticulous.modules && Meticulous.modules.maintenance;
      if (M && M._dueItems) {
        (M._dueItems().items || []).forEach(function (i) {
          due.push({
            name: i.name || i.id || '', dateBased: !!i.dateBased,
            dueAtKm: i.dateBased ? null : (parseFloat(i.dueAt) || 0),
            remainingKm: i.dateBased ? null : Math.round(parseFloat(i.remaining) || 0),
            annualDate: i.annualDate || '',
            days: i.dateBased ? (i.days != null ? i.days : null) : null,
            overdue: !!i.overdue
          });
        });
      }
    } catch (e) { due = []; }
    if (!odo && !nsOdo && !nsDate && !annual && !services.length && !due.length) return null;
    return {
      odometer: odo > 0 ? odo : null,
      nextServiceOdo: nsOdo > 0 ? nsOdo : null,
      nextServiceDate: nsDate || '',
      annualExpiry: annual || '',
      due: due,
      services: services
    };
  };

  /* v162: my PRE-TRIP INSPECTIONS as shared facts (owner, Oct 18,
     2026: connected owners/dispatchers must SEE the driver's PTI).
     Rides inside sharedrecords, so it inherits that doc's exact
     posture: named viewers only (sharePeers — Limited peers never
     named), the readers' kind gate in fetchRecords, and the
     rules' viewers door. FACTS ONLY — the report's fields and its
     defects (item, severity, note); a defect's photo bytes never
     cross, the same posture as the shared days' ticket photos.
     Newest first, latest 14. */
  CP.sharedPti = function () {
    var st = store();
    if (!st) return [];
    /* v242 fence: a PTI filed under another profile (another
       truck, another plate) never rides the records doc. */
    return (st.get('pti_reports', []) || []).filter(Boolean)
      .filter(function (r) { return wpIdOfRec(r) === 'p1'; }).slice()
      .sort(function (a, b) { return (parseFloat(b.filedAt) || 0) - (parseFloat(a.filedAt) || 0); })
      .slice(0, 14)
      .map(function (r) {
        return {
          date: r.date || '',
          filedAt: parseFloat(r.filedAt) || 0,
          kind: r.kind === 'post' ? 'post' : 'pre',
          signed: !!r.signed,
          unit: String(r.unit || ''),
          plate: String(r.plate || ''),
          odometer: parseFloat(r.odometer) || 0,
          location: String(r.location || ''),
          result: (r.result === 'major' || r.result === 'minor') ? r.result : 'pass',
          driverName: String(r.driverName || ''),
          defects: (Array.isArray(r.defects) ? r.defects : []).map(function (d) {
            return {
              item: String((d && d.item) || ''),
              severity: (d && d.severity === 'major') ? 'major' : 'minor',
              note: String((d && d.note) || '')
            };
          })
        };
      });
  };

  /* An issued invoice's paid total — the Invoice module's own
     rule (payments list + the paidAmount/paid fields), restated
     here so the shared summary never invents a status. */
  CP.invoicePaid = function (rec) {
    if (!rec) return 0;
    var paid = 0;
    if (Array.isArray(rec.payments)) {
      rec.payments.forEach(function (p) {
        paid += parseFloat(p && (p.amount !== undefined ? p.amount : p.amt)) || 0;
      });
    }
    if (parseFloat(rec.paidAmount) > 0) paid += parseFloat(rec.paidAmount);
    else if (parseFloat(rec.paid) > 0) paid += parseFloat(rec.paid);
    return r2(paid);
  };
  CP.invoiceStatus = function (rec) {
    var total = parseFloat(rec && rec.total) || 0;
    var paid = CP.invoicePaid(rec);
    if (total > 0 && paid >= total) return 'Paid';
    if (paid > 0) return 'Part paid';
    return 'Issued';
  };

  /* One issued invoice as it crosses: the summary the payer's
     lists show (number, period, hours, amount, status) + the
     FULL document payload — the payer renders and prints the
     invoice with the Invoice module's own composer
     (Meticulous.shared.invoiceDocHtml / printInvoiceDoc) from
     exactly these fields, so his copy is the driver's document,
     not a lookalike. */
  CP.sharedInvoice = function (rec) {
    var hours = 0, hasHours = false;
    if (rec.dayHours) {
      Object.keys(rec.dayHours).forEach(function (d) {
        var v = parseFloat(rec.dayHours[d]);
        if (isFinite(v)) { hours += v; hasHours = true; }
      });
    }
    var total = parseFloat(rec.total) || 0;
    var paid = CP.invoicePaid(rec);
    return {
      id: rec.id || '', no: String(rec.no || ''), date: rec.date || '',
      billTo: rec.billTo || '', pa: rec.pa || '', pb: rec.pb || '',
      hours: hasHours ? r2(hours) : null,
      sub: rec.sub != null ? rec.sub : null,
      tax: rec.tax != null ? rec.tax : null,
      total: total, paid: paid, balance: r2(total - paid),
      status: CP.invoiceStatus(rec),
      doc: {
        no: rec.no, date: rec.date, billTo: rec.billTo, pa: rec.pa, pb: rec.pb,
        revLines: clone(rec.revLines || []), items: clone(rec.items || []),
        taxRate: rec.taxRate || 0, taxIncluded: !!rec.taxIncluded,
        sub: rec.sub, tax: rec.tax, total: rec.total,
        dayHours: clone(rec.dayHours || null), cardDays: clone(rec.cardDays || null),
        rate: rec.rate || 0, truckNo: rec.truckNo || '', notes: rec.notes || '',
        company: clone(rec.company || null),
        province: rec.province || '', country: rec.country || '',
        payments: clone(rec.payments || null),
        paidAmount: rec.paidAmount != null ? rec.paidAmount : null,
        paid: rec.paid != null ? rec.paid : null
      }
    };
  };

  /* The manifest document for one billed period: for every day
     in the period that has anything in it, the manifest's OWN
     printed lines (modules/manifest.js docLines over collect —
     the same lines its PDF prints), under the driver's own
     section toggles. The payer re-renders and re-prints them
     with the same PDF engine; the lines ARE the document. */
  CP.sharedManifest = function (pa, pb) {
    var M = null;
    try { M = window.Meticulous && Meticulous.modules && Meticulous.modules.manifest; } catch (e) {}
    if (!M || !M._collectDay || !M._docLines || !pa || !pb || pb < pa) return null;
    var t = {};
    try { t = M._toggles ? M._toggles() : {}; } catch (e) { t = {}; }
    var days = [], d = pa, guard = 0;
    while (d <= pb && guard++ < 62) {
      /* v242 fence: a fenced (non-main-profile) date inside the
         period contributes NO manifest lines to a peer's doc. */
      if (CP._dayFenced(d)) { d = dateShift(d, 1); continue; }
      var c = null, lines = null;
      try { c = M._collectDay(d); } catch (e) { c = null; }
      if (c && (c.dispatches.length || c.sessions.length || c.fills.length ||
                c.expenses.length || c.incidents.length)) {
        try { lines = M._docLines(d, c, t); } catch (e) { lines = null; }
        if (lines && lines.length) days.push({ date: d, lines: lines });
      }
      d = dateShift(d, 1);
    }
    if (!days.length) return null;
    return { pa: pa, pb: pb, days: days };
  };

  /* v148: the manifest days for an explicit list of dates — the
     manifest's OWN printed lines per day (the same internals
     sharedManifest walks for a billed period), for exactly the
     days named and no others. */
  CP._manifestDays = function (dates) {
    var M = null;
    try { M = window.Meticulous && Meticulous.modules && Meticulous.modules.manifest; } catch (e) {}
    if (!M || !M._collectDay || !M._docLines) return [];
    var t = {};
    try { t = M._toggles ? M._toggles() : {}; } catch (e) { t = {}; }
    var days = [];
    (dates || []).forEach(function (d) {
      if (CP._dayFenced(d)) return; // v242 fence: see sharedManifest
      var c = null, lines = null;
      try { c = M._collectDay(d); } catch (e) { c = null; }
      if (c && (c.dispatches.length || c.sessions.length || c.fills.length ||
                c.expenses.length || c.incidents.length)) {
        try { lines = M._docLines(d, c, t); } catch (e) { lines = null; }
        if (lines && lines.length) days.push({ date: d, lines: lines });
      }
    });
    return days;
  };

  /* v148: MY manifests doc for ONE LIMITED viewer — the manifest
     lines for exactly the days HE dispatched to me (my dispatch
     records carrying pipeFrom = him, any live status), newest
     31 days. This is the whole of what crosses to a limited
     peer besides the dispatch pipe itself: no fuel, no
     expenses, no maintenance, no invoices, no money picture —
     and no other day's manifest, not even a neighbouring one.
     Null when he never dispatched a day I still hold. */
  CP.buildManifestsFor = function (viewerUid) {
    var f = fb(), st = store();
    if (!f || !st || !viewerUid) return null;
    var dates = [];
    (st.get('dsp_list', []) || []).forEach(function (d) {
      if (!d || d.pipeFrom !== viewerUid || d.status === 'cancelled') return;
      var dt = CP.recordDate(d);
      if (dt && dates.indexOf(dt) === -1) dates.push(dt);
    });
    if (!dates.length) return null;
    dates.sort();
    dates = dates.slice(-31);
    var days = CP._manifestDays(dates);
    if (!days.length) return null;
    var idn = { name: '', business: '' };
    try { if (window.ConnectLive) idn = ConnectLive.identity(); } catch (e) {}
    return {
      driver: f.user.uid,
      viewer: viewerUid,
      driverName: idn.name || '',
      driverBusiness: idn.business || '',
      manifests: [{ pa: dates[0], pb: dates[dates.length - 1], days: days }],
      updatedAt: Date.now()
    };
  };

  /* MY shared records doc — fuel + expenses + maintenance for
     ALL my connected peers (the bill-to split lives in the
     per-peer billing docs below, never in here). */
  CP.buildRecords = function () {
    var f = fb(), st = store();
    if (!f || !st) return null;
    var idn = { name: '', business: '' };
    try { if (window.ConnectLive) idn = ConnectLive.identity(); } catch (e) {}
    /* v168: the caps are COMPLETE-HISTORY ceilings now (owner,
       Oct 18, 2026 13:47 MDT: Full access shows everything, past
       and present) — set far above any real book (600 fills ≈
       years of fuel; 300 expense lines) while still bounding the
       doc; the old 40/60 slices silently amputated older history
       from a Full peer's view. */
    /* v242 fence: fills stamped with another profile (another
       truck's fuel) never ride the records doc. */
    var fuel = (st.get('fuel_fills', []) || []).filter(Boolean)
      .filter(function (x) { return wpIdOfRec(x) === 'p1'; }).slice()
      .sort(byDateDesc).slice(0, 600).map(CP.sharedFill);
    var expenses = (st.get('fuel_expenses', []) || []).filter(Boolean).slice()
      .sort(byDateDesc).slice(0, 300).map(function (x) {
        return { date: x.date || '', what: String(x.what || ''), cost: parseFloat(x.cost) || 0 };
      });
    return {
      driver: f.user.uid,
      driverName: idn.name || '',
      driverBusiness: idn.business || '',
      viewers: CP.sharePeers().map(function (c) { return c.uid; }),
      fuel: fuel,
      expenses: expenses,
      maintenance: CP.sharedMaintenance(),
      pti: CP.sharedPti(),
      /* v163: my own wage rides the records doc (see sharedWage) —
         the boss's books price my days at MY rate, never his */
      driverWage: CP.sharedWage(),
      updatedAt: Date.now()
    };
  };

  /* MY billing doc for ONE peer — only the issued invoices whose
     Bill-to is HIM, and the manifests pairing with their periods.
     Nothing addressed to anyone else is ever written here.
     Null when nothing of his crosses. */
  CP.buildBilling = function (viewerUid) {
    var f = fb(), st = store();
    if (!f || !st || !viewerUid) return null;
    var invs = (st.get('inv_list', []) || []).filter(function (r) {
      /* v242 fence: another profile's invoice never crosses to
         this peer, whatever its bill-to says. */
      return r && wpIdOfRec(r) === 'p1' && !r.settledOutside && r.total != null &&
        CP.peerMatchesBillTo(viewerUid, r.billTo);
    });
    if (!invs.length) return null;
    var idn = { name: '', business: '' };
    try { if (window.ConnectLive) idn = ConnectLive.identity(); } catch (e) {}
    var manifests = [];
    invs.forEach(function (r) {
      var man = CP.sharedManifest(r.pa, r.pb);
      if (man) manifests.push(man);
    });
    return {
      driver: f.user.uid,
      viewer: viewerUid,
      driverName: idn.name || '',
      driverBusiness: idn.business || '',
      invoices: invs.map(CP.sharedInvoice),
      manifests: manifests,
      updatedAt: Date.now()
    };
  };

  function guardedSet(col, id, doc) {
    var f = fb();
    var keyDoc = clone(doc); delete keyDoc.updatedAt;
    var key = JSON.stringify(keyDoc);
    if (CP._recCache[id] === key) return null;
    CP._recCache[id] = key;
    return f.db.collection(col).doc(id).set(doc)
      .then(function () { return true; })
      .catch(function () { CP._recCache[id] = ''; return false; });
  }

  /* v148: the guarded write for a limited peer's manifests doc.
     Its guard key is namespaced ('sharedmanifests:' + docId):
     the billing clearing pass uses the bare docId key for its
     own 'CLEARED' mark, and the two docs share the id shape —
     a bare key would let one doc's guard eat the other's
     write. */
  CP._setManifestsDoc = function (viewerUid, doc) {
    var f = fb();
    if (!f || !doc) return null;
    var id = f.user.uid + '_' + viewerUid;
    var key = 'sharedmanifests:' + id;
    var keyDoc = clone(doc); delete keyDoc.updatedAt;
    var k = JSON.stringify(keyDoc);
    if (CP._recCache[key] === k) return null;
    CP._recCache[key] = k;
    return f.db.collection('sharedmanifests').doc(id).set(doc)
      .then(function () { return true; })
      .catch(function () { CP._recCache[key] = ''; return false; });
  };

  /* Publish my records + billing (+ receipt photos behind them).
     Same discipline as publishDay: content-guarded per session,
     viewers named from my CURRENT connections — a peer who goes
     away is pruned from the records doc on the next publish, and
     his billing doc is emptied once (seeded from the cloud on the
     first publish of a session, so a disconnect that happened
     while the app was closed is still revoked). */
  CP.publishRecords = function () {
    var f = fb();
    if (!f) return Promise.resolve(false);
    var doc = CP.buildRecords();
    if (!doc) return Promise.resolve(false);
    var me = f.user.uid;
    var seed = CP._billedKnown ? Promise.resolve()
      : Promise.all([
          f.db.collection('sharedbilling').where('driver', '==', me).get()
            .catch(function () { return null; }),
          f.db.collection('sharedrecords').doc(me).get()
            .catch(function () { return null; }),
          f.db.collection('sharedmanifests').where('driver', '==', me).get()
            .catch(function () { return null; })
        ]).then(function (r) {
          CP._billedKnown = {};
          if (r[0]) {
            r[0].forEach(function (d) {
              var v = d.data() || {};
              if (v.viewer && ((v.invoices || []).length || (v.manifests || []).length)) {
                CP._billedKnown[v.viewer] = true;
              }
            });
          }
          /* v148: which limited viewers already hold a manifests
             doc (the clearing pass below empties a stale one) */
          CP._mfKnown = {};
          if (r[2]) {
            r[2].forEach(function (d) {
              var v = d.data() || {};
              if (v.viewer && (v.manifests || []).length) CP._mfKnown[v.viewer] = true;
            });
          }
          /* an existing records doc primes the write guard with a
             sentinel, so a viewers list that changed while the app
             was closed is re-published (pruned) on this pass */
          if (r[1] && r[1].exists && !CP._recCache[me]) CP._recCache[me] = '__seed__';
        })
        .catch(function () { CP._billedKnown = CP._billedKnown || {}; CP._mfKnown = CP._mfKnown || {}; });
    return seed.then(function () {
      var jobs = [];
      /* the records doc — written while I have peers; when the
         last peer goes away it is written ONCE more with an empty
         viewers list (access actually revoked), then stays silent */
      if (doc.viewers.length || CP._recCache[me]) {
        /* v228: read-merge-write — a rolled-back store must
           not shrink what my peers already see (S8) */
        var j = f.db.collection('sharedrecords').doc(me).get()
          .then(function (snap) {
            var ex = null;
            try { ex = snap && snap.exists ? snap.data() : null; } catch (e) { ex = null; }
            if (ex) doc = CP._preserveRecords(doc, ex);
            return guardedSet('sharedrecords', me, doc);
          })
          .catch(function () { return guardedSet('sharedrecords', me, doc); });
        jobs.push(j);
      }
      var matched = {};
      CP.connectedPeers().forEach(function (peer) {
        /* v148: a LIMITED peer never gets a billing doc — his
           only share doc is his manifests (below); a stale
           billing doc of his is emptied by the clearing pass
           since he never enters `matched`.
           v176 (L1): unless the approver ticked Invoices or P&L
           for him — then the billing doc is exactly what was
           ticked, and he enters `matched` like any peer. */
        if (CP.kindFor(peer.uid) === 'limited' &&
            !CP.allowsModule(peer.uid, 'invoices') && !CP.allowsModule(peer.uid, 'pnl')) return;
        var bill = CP.buildBilling(peer.uid);
        if (!bill) return;
        matched[peer.uid] = true;
        /* v228: read-merge-write (S8) — published invoices and
           manifest lines survive a rolled-back rebuild */
        var stB = store();
        var localInvs = stB ? stB.get('inv_list', []) : [];
        var j2 = f.db.collection('sharedbilling').doc(me + '_' + peer.uid).get()
          .then(function (snap) {
            var ex = null;
            try { ex = snap && snap.exists ? snap.data() : null; } catch (e) { ex = null; }
            if (ex) bill = CP._preserveBilling(bill, ex, localInvs);
            return guardedSet('sharedbilling', me + '_' + peer.uid, bill);
          })
          .catch(function () { return guardedSet('sharedbilling', me + '_' + peer.uid, bill); });
        jobs.push(j2);
      });
      /* v148: the limited peers' manifests docs.
         v176 (L1): written only when Manifest was ticked. */
      var mfMatched = {};
      CP.connectedPeers().forEach(function (peer) {
        if (CP.kindFor(peer.uid) !== 'limited') return;
        if (!CP.allowsModule(peer.uid, 'manifest')) return;
        var mdoc = CP.buildManifestsFor(peer.uid);
        if (!mdoc) return;
        mfMatched[peer.uid] = true;
        /* v228: read-merge-write (S8b) — her dispatched days
           survive a rolled-back rebuild */
        var j3 = f.db.collection('sharedmanifests').doc(me + '_' + peer.uid).get()
          .then(function (snap) {
            var ex = null;
            try { ex = snap && snap.exists ? snap.data() : null; } catch (e) { ex = null; }
            if (ex) mdoc = CP._preserveManifests(mdoc, ex);
            return CP._setManifestsDoc(peer.uid, mdoc);
          })
          .catch(function () { return CP._setManifestsDoc(peer.uid, mdoc); });
        jobs.push(j3);
      });
      /* peers who had a billing doc and no longer match: empty it */
      var known = {};
      Object.keys(CP._billedKnown || {}).forEach(function (u) { known[u] = true; });
      Object.keys(CP._billedSession || {}).forEach(function (u) { known[u] = true; });
      /* v228: who is connected RIGHT NOW — the clearing passes
         below may only fire on a peer who is gone or no longer
         entitled, never on a live peer whose build came back
         empty (the S8 misfire) */
      var peerNow = {};
      CP.connectedPeers().forEach(function (p) { if (p && p.uid) peerNow[p.uid] = true; });
      Object.keys(known).forEach(function (uid) {
        if (matched[uid] || CP._recCache[me + '_' + uid] === 'CLEARED') return;
        if (peerNow[uid] && (CP.kindFor(uid) !== 'limited' ||
            CP.allowsModule(uid, 'invoices') || CP.allowsModule(uid, 'pnl'))) return;
        CP._recCache[me + '_' + uid] = 'CLEARED';
        var empty = {
          driver: me, viewer: uid,
          driverName: doc.driverName, driverBusiness: doc.driverBusiness,
          invoices: [], manifests: [], updatedAt: Date.now()
        };
        jobs.push(f.db.collection('sharedbilling').doc(me + '_' + uid).set(empty)
          .then(function () { return true; })
          .catch(function () { CP._recCache[me + '_' + uid] = ''; return false; }));
      });
      CP._billedSession = matched;
      /* v148: peers who had a manifests doc and are no longer
         limited-connected (kind changed to All, a one-time end,
         a removal): empty it once, the billing discipline */
      var mfKnown = {};
      Object.keys(CP._mfKnown || {}).forEach(function (u) { mfKnown[u] = true; });
      Object.keys(CP._mfSession || {}).forEach(function (u) { mfKnown[u] = true; });
      Object.keys(mfKnown).forEach(function (uid) {
        var mfKey = 'sharedmanifests:' + me + '_' + uid;
        if (mfMatched[uid] || CP._recCache[mfKey] === 'CLEARED') return;
        /* v228: a still-entitled limited peer keeps her doc —
           an empty build is not a revocation (S8b) */
        if (peerNow[uid] && CP.kindFor(uid) === 'limited' && CP.allowsModule(uid, 'manifest')) return;
        CP._recCache[mfKey] = 'CLEARED';
        var mfEmpty = {
          driver: me, viewer: uid,
          driverName: doc.driverName, driverBusiness: doc.driverBusiness,
          manifests: [], updatedAt: Date.now()
        };
        jobs.push(f.db.collection('sharedmanifests').doc(me + '_' + uid).set(mfEmpty)
          .then(function () { return true; })
          .catch(function () { CP._recCache[mfKey] = ''; return false; }));
      });
      CP._mfSession = mfMatched;
      return Promise.all(jobs).then(function (rs) {
        /* v228: "wrote" means a write actually landed — the
           read-merge chains resolve with their guarded write's
           own result (null/false when the facts were unchanged),
           so a republish of unchanged facts still reports no
           write, exactly as the pre-merge discipline did */
        var wroteAny = (rs || []).some(function (r) { return !!r; });
        return (doc.viewers.length ? CP.publishPhotos(doc) : CP.clearPhotoViewers())
          .then(function (ph) { return wroteAny || !!ph; });
      });
    });
  };

  /* The receipt PHOTOS. A stored receipt is a 1600px rendition —
     far too heavy to ride the facts record — so each crosses in
     its own doc at a share size (max 900px, the app's thumbnail
     convention), newest 24 fills with photos. Superseded
     renditions (a fill edited or deleted) are pruned by their
     owner on the same pass. Best-effort throughout: the receipt
     DATA always crosses in the records doc even when a photo
     cannot be rendered (no canvas, offline, a failed write). */
  CP._rendition = function (dataUrl) {
    return new Promise(function (resolve) {
      try {
        var img = new Image();
        img.onload = function () {
          try {
            var max = 900, w = img.width, h = img.height;
            if (w > max || h > max) {
              var sc = Math.min(max / w, max / h);
              w = Math.round(w * sc); h = Math.round(h * sc);
            }
            var c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(c.toDataURL('image/jpeg', 0.72));
          } catch (e) { resolve(null); }
        };
        img.onerror = function () { resolve(null); };
        img.src = dataUrl;
      } catch (e) { resolve(null); }
    });
  };
  CP.publishPhotos = function (recDoc) {
    var f = fb(), st = store();
    if (!f || !st || !recDoc || !recDoc.viewers.length) return Promise.resolve(false);
    var photoFills = (st.get('fuel_fills', []) || []).filter(function (x) { return x && x.photo; });
    var currentKeys = {};
    photoFills.forEach(function (fl) { currentKeys[CP.fillKey(fl)] = true; });
    /* v228: fills preserved into the records doc by the S8
       merge keep their renditions too — the prune follows the
       PUBLISHED records, not only the (possibly rolled-back)
       local store, or a preserved fill loses its photo */
    (recDoc.fuel || []).forEach(function (fl) {
      if (fl && fl.photoKey) currentKeys[fl.photoKey] = true;
    });
    var viewersKey = recDoc.viewers.slice().sort().join(',');
    var jobs = photoFills.slice().sort(byDateDesc).slice(0, 120).map(function (fl) {
      var key = CP.fillKey(fl);
      var guard = key + '|' + viewersKey + '|' + String(fl.photo).length +
        '|' + String(fl.photo).slice(-24);
      if (CP._photoCache[key] === guard) return null;
      CP._photoCache[key] = guard;
      return CP._rendition(fl.photo).then(function (url) {
        if (!url) { CP._photoCache[key] = ''; return false; }
        var doc = {
          driver: f.user.uid, viewers: recDoc.viewers.slice(),
          fillKey: key, date: fl.date || '', photo: url, updatedAt: Date.now()
        };
        return f.db.collection('sharedphotos').doc(f.user.uid + '_' + key).set(doc)
          .then(function () { return true; })
          .catch(function () { CP._photoCache[key] = ''; return false; });
      });
    }).filter(Boolean);
    /* prune renditions whose fill no longer carries that photo —
       and forget their publish guards, so a photo restored later
       in the same session publishes again */
    var photoWrites = jobs.length;
    jobs.push(f.db.collection('sharedphotos').where('driver', '==', f.user.uid).get()
      .then(function (snap) {
        var dels = [];
        snap.forEach(function (d) {
          var v = d.data() || {};
          if (v.fillKey && !currentKeys[v.fillKey]) {
            delete CP._photoCache[v.fillKey];
            dels.push(f.db.collection('sharedphotos').doc(d.id).delete().catch(function () {}));
          }
        });
        return Promise.all(dels);
      })
      .catch(function () {}));
    return Promise.all(jobs).then(function () { return photoWrites > 0; });
  };

  /* When my LAST peer goes away, my receipt renditions must not
     keep naming viewers who can no longer see the records doc:
     empty their viewers lists too (the docs themselves stay —
     they are unreachable facts without a records doc pointing at
     their keys, and the driver may re-share them later). */
  CP.clearPhotoViewers = function () {
    var f = fb();
    if (!f) return Promise.resolve(false);
    return f.db.collection('sharedphotos').where('driver', '==', f.user.uid).get()
      .then(function (snap) {
        var jobs = [];
        snap.forEach(function (d) {
          var v = d.data() || {};
          if ((v.viewers || []).length) {
            jobs.push(f.db.collection('sharedphotos').doc(d.id).update({ viewers: [] })
              .catch(function () {}));
          }
        });
        return Promise.all(jobs).then(function () { return jobs.length > 0; });
      })
      .catch(function () { return false; });
  };

  /* Every connected peer's records + billing, keyed by his uid —
     the payer-side read both crew surfaces paint from. Read by
     doc id (my connections name the drivers; the rules enforce
     the viewers/viewer door on every doc). */
  CP.fetchRecords = function () {
    var f = fb();
    if (!f) return Promise.resolve({ records: {}, billing: {}, manifests: {} });
    var out = { records: {}, billing: {}, manifests: {} };
    var jobs = CP.connectedPeers().map(function (p) {
      /* v148 READER GATE: for a LIMITED peer my side reads ONLY
         his manifests doc — the records and billing dirs are
         not his at all (the rules deny those reads outright;
         the client never even asks). His result lands under
         manifests, never records/billing. */
      if (CP.kindFor(p.uid) === 'limited') {
        /* v176 (L1): manifests cross only when Manifest was
           ticked; the records doc crosses only when a records
           module was ticked, and every unticked section is
           stripped HERE, at the reader, before any surface can
           paint it. Billing (invoices) crosses only when
           Invoices or P&L was ticked. */
        var jobs = [];
        if (CP.allowsModule(p.uid, 'manifest')) {
          jobs.push(f.db.collection('sharedmanifests').doc(p.uid + '_' + f.user.uid).get()
            .then(function (snap) {
              if (snap && snap.exists) out.manifests[p.uid] = snap.data();
            })
            .catch(function () {}));
        }
        if (CP.limitedNeedsRecords(p.uid)) {
          jobs.push(f.db.collection('sharedrecords').doc(p.uid).get()
            .then(function (snap) {
              if (snap && snap.exists) {
                var rec = snap.data() || {};
                if (!CP.allowsModule(p.uid, 'fuel')) delete rec.fuel;
                if (!CP.allowsModule(p.uid, 'expenses')) delete rec.expenses;
                if (!CP.allowsModule(p.uid, 'maintenance')) delete rec.maintenance;
                if (!CP.allowsModule(p.uid, 'pti')) delete rec.pti;
                if (!CP.allowsModule(p.uid, 'pnl')) delete rec.driverWage;
                out.records[p.uid] = rec;
              }
            })
            .catch(function () {}));
          if (CP.allowsModule(p.uid, 'invoices') || CP.allowsModule(p.uid, 'pnl')) {
            jobs.push(f.db.collection('sharedbilling').doc(p.uid + '_' + f.user.uid).get()
              .then(function (snap) {
                if (snap && snap.exists) out.billing[p.uid] = snap.data();
              })
              .catch(function () {}));
          }
        }
        return Promise.all(jobs);
      }
      return Promise.all([
        f.db.collection('sharedrecords').doc(p.uid).get().catch(function () { return null; }),
        f.db.collection('sharedbilling').doc(p.uid + '_' + f.user.uid).get().catch(function () { return null; })
      ]).then(function (r) {
        if (r[0] && r[0].exists) out.records[p.uid] = r[0].data();
        if (r[1] && r[1].exists) out.billing[p.uid] = r[1].data();
      });
    });
    return Promise.all(jobs).then(function () { CP._peerCache = out; return out; });
  };

  /* One receipt photo for one of a peer's fills — the photo doc
     behind the records doc's photoRef/photoKey pair. */
  CP.fetchPhoto = function (driverUid, photoKey) {
    var f = fb();
    if (!f || !driverUid || !photoKey) return Promise.resolve(null);
    return f.db.collection('sharedphotos').doc(driverUid + '_' + photoKey).get()
      .then(function (snap) {
        if (!snap.exists) return null;
        var v = snap.data() || {};
        return v.photo || null;
      })
      .catch(function () { return null; });
  };

  /* A shared manifest's lines as on-screen HTML — the same typed
     lines the manifest PDF prints (title / heading / kv / note /
     rule), rendered the plain way for the payer's view. */
  CP.manifestLinesHtml = function (lines) {
    return (lines || []).map(function (l) {
      if (!l) return '';
      if (l.k === 'title') return '<div style="font-weight:800;margin:8px 0 4px">' + escHtml(l.a) + '</div>';
      if (l.k === 'h') return '<div style="font-weight:700;margin:10px 0 2px">' + escHtml(l.a) + '</div>';
      if (l.k === 'kv') return '<div class="kv"><span>' + escHtml(l.a) + '</span><b>' + escHtml(l.b || '') + '</b></div>';
      if (l.k === 'rule') return '<hr style="border:none;border-top:2px solid #333;margin:8px 0">';
      return '<div class="note" style="margin:2px 0">' + escHtml(l.a) + '</div>';
    }).join('');
  };

  /* Print a shared manifest with the app's own PDF engine (the
     same savePdf the driver's own Manifest print uses); in a
     plain browser, a print window over the same lines. */
  CP.printManifestDoc = function (title, lines) {
    try {
      if (window.MetPdf && typeof MetPdf.savePdf === 'function') {
        return MetPdf.savePdf({ title: title, lines: lines },
          String(title || 'manifest').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '.pdf');
      }
    } catch (e) {}
    try {
      var w = window.open('', '_blank', 'width=800,height=900');
      if (!w) return Promise.resolve(false);
      w.document.write('<!DOCTYPE html><html><head><title>' + escHtml(title) + '</title></head>' +
        '<body style="font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:24px auto;padding:0 16px">' +
        CP.manifestLinesHtml(lines) + '</body></html>');
      w.document.close(); w.focus();
      setTimeout(function () { try { w.print(); } catch (e) {} }, 400);
    } catch (e) {}
    return Promise.resolve(true);
  };

  /* ---------------- v168: COMPLETE HISTORY for a new Full peer --
     (owner, Oct 18, 2026 13:47 MDT: "It should show everything!
     Past and present! That's the full access.") Until now a pair
     only ever carried what closed AFTER it formed (publishRecent
     = today + yesterday; days before the pair existed never
     crossed, and the records slices quietly capped fuel at the
     latest 40). Now: when a peer is NEW to my share list — a pair
     just formed, a kind raised to Full, a viewer added — the
     next publishAll runs ONE complete-history sweep: every date
     with data on this device publishes its day doc, and the
     records/billing set (already whole-history by construction
     after the cap lifts above) republishes with him named. The
     known set persists in the store (cp_hist_peers), so the
     sweep runs once per peer, not per launch; the day docs'
     own content guards keep every later publish cheap. A peer
     whose kind drops to Limited leaves sharePeers — if he ever
     returns to Full he is new again and history re-runs, which
     is correct: while limited he was revoked. */

  /* Every date this device holds work for: my dispatches (list +
     active), my sessions, my revenue entries. */
  CP.historyDates = function () {
    var st = store();
    if (!st) return [];
    var set = {};
    function add(d) { if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) set[d] = true; }
    (st.get('dsp_list', []) || []).forEach(function (d) { if (d) add(CP.recordDate(d)); });
    var act = st.get('dsp_active', null);
    if (act) add(CP.recordDate(act));
    (st.get('sessions', []) || []).forEach(function (s) { if (s) add(s.date); });
    (st.get('rev_entries', []) || []).forEach(function (e) { if (e) add(e.date); });
    return Object.keys(set).sort();
  };

  /* Publish EVERY day with data, oldest first (the day docs are
     content-guarded: an unchanged day is never rewritten). */
  CP.publishHistory = function () {
    var chain = Promise.resolve(true);
    CP.historyDates().forEach(function (ds) {
      chain = chain.then(function () { return CP.publishDay(ds); });
    });
    return chain;
  };

  /* The trigger: any share peer not in the persisted known set
     runs the sweep once, then joins the set. The FIRST pass
     after this ships treats every current peer as new — a pair
     formed before the fix (his own first pair included) gets
     its missing history on the next launch. */
  CP.publishHistoryIfNewPeers = function () {
    var f = fb(), st = store();
    if (!f || !st) return Promise.resolve(false);
    var now = CP.sharePeers().map(function (c) { return c.uid; }).sort();
    if (!now.length) return Promise.resolve(false);
    var known = st.get('cp_hist_peers', null);
    var fresh = !Array.isArray(known)
      ? now.slice()
      : now.filter(function (u) { return known.indexOf(u) === -1; });
    if (!fresh.length) return Promise.resolve(false);
    return CP.publishHistory().then(function () {
      try { st.set('cp_hist_peers', now); } catch (e) {}
      return true;
    }).catch(function () { return false; });
  };

  /* Publish everything of mine that crosses: recent days, then
     the records/billing/photos set, then — for a peer who is new
     to Full — the complete-history sweep. The one call the
     lifecycle and the Connect screen make on entry. */
  CP.publishAll = function () {
    return CP.publishRecent()
      .then(function () { return CP.publishRecords(); })
      .then(function () { return CP.publishHistoryIfNewPeers(); })
      .catch(function () { return false; });
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
      try { CP.publishAll(); } catch (e) {}
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
