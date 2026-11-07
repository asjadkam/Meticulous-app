/* Meticulous v358 — CONNECT-ALL DASHBOARD MIRROR (owner, Nov 7,
 * 2026 08:12 MDT: "doesn't Umar have a permanent seat since he is
 * a Connect All? So shouldn't he just be able to look at my
 * dispatches, my revenue — everything — just on his dashboard,
 * exactly how I intend to do it." — refined 08:24 MDT: "He should
 * be able to see everything I am seeing! Just not the timer...
 * In fact the navigator too.")
 *
 * THE GAP THIS CLOSES (investigation Nov 7, UMAR-SEES-NOTHING):
 * a connected payer's own modules read only HIS local store;
 * Connect data surfaced only on Dispatch's Crew board and P&L's
 * Connected crew card — so a payer opening Revenue / Manifest /
 * Fuel on his dashboard saw an empty book (his own) and read it
 * as the driver's. There was no view-as-driver anywhere.
 *
 * THE MIRROR: a payer with at least one Connect All (or live
 * One-Time) connection gets ONE picker on his dashboard — whose
 * book is on screen, "Mine" by default. Pick a driver and the
 * covered modules (Revenue, Dispatch, Fuel & Expense,
 * Maintenance, PTI, Damage & Incident, Manifest, Navigator,
 * Documents) open on THAT DRIVER'S published book, in the same
 * module shapes, READ-ONLY. The mirror's scope is EVERYTHING
 * the driver sees — with ONE exclusion, the owner's own line:
 * the live work TIMER (the tracker face: start / pause / stop,
 * counting-from, live session controls) is a control surface,
 * not a record, and never appears in the mirror. Historical
 * days, hours and manifests still show — hours from Revenue,
 * as everywhere.
 *
 * DATA LAW: the mirror reads ONLY the existing published docs —
 * shareddays (CP.fetchCrew / CP.fetchCrewRange), sharedrecords +
 * sharedbilling (CP.fetchRecords), sharedphotos (CP.fetchPhoto).
 * No new publish format; nothing is back-filled. v358 adds ONE
 * section inside the existing records doc (CP.sharedNav: the
 * trip log's destination names + the last destination — names
 * only, coordinates never ride) so the Navigator face has the
 * driver's trips; his saved places and route pins do NOT cross
 * in any published doc (named gap NAV-PLACES-NOT-PUBLISHED) and
 * his documents do not cross either (named gap
 * DOCS-NOT-PUBLISHED — the Documents face states it plainly
 * instead of ever showing the payer's own files under the
 * driver's name). What never crossed as records (his
 * rev_entries list as such, his ticket photo bytes) is not
 * invented here — the Revenue face is his days priced at his
 * own wage (the priced wage leg) plus the invoices billed to
 * this payer, which is what the published docs carry. The
 * driver's P&L does not exist to mirror (Driver accounts never
 * surface P&L — v199) and Connect is the payer's own tool, so
 * neither is a mirror face.
 *
 * SAFETY LAW (the Nov 7 zeros were a whose-book confusion):
 *  - a persistent banner names the driver on EVERY screen while
 *    mirroring, and every mirrored module opens with the same
 *    read-only header;
 *  - the mirror renders its own HTML — no add / edit / delete /
 *    start / stop control exists in it (the only buttons switch
 *    the view back to Mine or fetch a receipt photo, a read);
 *  - mirror browsing writes NO book data anywhere: the single
 *    store write is the payer's own picker memory (mirror_view =
 *    {uid}), the app's standing pick-persistence pattern;
 *  - scope: ONLY kind 'all' peers, plus 'once' peers while the
 *    pair lives (connectedPeers already drops ended pairs).
 *    LIMITED peers never appear in the picker and keep exactly
 *    today's surfaces (sharedmanifests + the dispatch pipe) —
 *    and the pipe's own reader gates (fetchCrewRange /
 *    fetchRecords strip limited drivers) stay underneath.
 *  - manifest hours in the mirror follow the standing manifest
 *    law: hours come from the day's REVENUE-record facts (the
 *    ticket close / day close the driver published), NEVER the
 *    tracker session's hours; places are named, never coords.
 */
(function () {
  'use strict';

  var M = { _uid: undefined, _name: '' };
  window.Mirror = M;

  var COVERS = { revenue: 1, dispatch: 1, fuel: 1, maintenance: 1, pti: 1, damage: 1, manifest: 1, navigator: 1, documents: 1 };

  function store() {
    try { return (window.App && App._store) ? App._store : null; } catch (e) { return null; }
  }
  function CP() { return window.ConnectPipe || null; }
  function esc(s) {
    try { if (window.App && App._esc) return App._esc(s); } catch (e) {}
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function money(n) {
    return '$' + (Math.round((Number(n) || 0) * 100) / 100)
      .toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function num(n, dp) {
    var v = Number(n) || 0;
    return v.toLocaleString('en-CA', { minimumFractionDigits: dp || 0, maximumFractionDigits: dp == null ? 1 : dp });
  }
  function today() {
    try { if (window.App && App._today) return App._today(); } catch (e) {}
    var d = new Date();
    function z(x) { return ('0' + x).slice(-2); }
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }
  function el(id) { try { return document.getElementById(id); } catch (e) { return null; } }

  /* ---------------- whose book ---------------- */

  /* The pickable drivers: my connected peers at Connect All
     scope. Kind is read live on every call (CP.kindFor), so a
     pair flipped to Limited — or a one-time pair that ended —
     falls out of the mirror the moment it happens. */
  M.drivers = function () {
    var cp = CP();
    if (!cp || !cp.connectedPeers) return [];
    return cp.connectedPeers().filter(function (c) {
      var k = cp.kindFor(c.uid);
      return k === 'all' || k === 'once';
    }).map(function (c) {
      return { uid: c.uid, name: String(c.name || c.business || 'Connected driver'), kind: cp.kindFor(c.uid) };
    });
  };

  function curUid() {
    if (M._uid === undefined) {
      M._uid = null;
      try {
        var st = store(), v = st && st.get('mirror_view', null);
        if (v && v.uid) M._uid = String(v.uid);
      } catch (e) {}
    }
    return M._uid;
  }

  M.active = function () {
    var u = curUid();
    if (!u) return false;
    return M.drivers().some(function (d) { return d.uid === u; });
  };

  M.name = function () {
    var u = curUid(), ds = M.drivers();
    for (var i = 0; i < ds.length; i++) if (ds[i].uid === u) return ds[i].name;
    return '';
  };

  M.covers = function (key) { return !!COVERS[key]; };

  /* v358 (ROLE GATE, owner corrected Nov 7, 2026 08:24 MDT):
     should THIS account's own dashboard carry the live work
     TIMER at all? Office-only accounts (owners / fleet managers
     / office staff who do NOT drive) never get the timer /
     tracker face or the odometer prompts tied to driving their
     own truck — the timer is the one driver tool that would
     "bother an office staff only". The Navigator is NOT gated:
     it is a seeing tool and stays on the office face (the
     office module order carries it). The dashboard paint reads
     App.userRole(); the bubble, park card and odometer prompt
     have no paint of their own to gate, so they ask here. An
     office pick stored in Preferences / onboarding is honored
     verbatim (App.userRole's provisional resolution); an
     unanswered account keeps the safe office face for a Fleet
     Manager / the driver face for a Driver, as before. */
  M.officeOnly = function () {
    try { if (window.App && App.userRole) return App.userRole() === 'office'; } catch (e) {}
    return false;
  };

  /* Switch whose book is on screen. A uid that is not a live
     Connect All / One-Time peer is refused (falls back to Mine)
     — the picker can never point at a Limited peer. */
  M.setView = function (uid) {
    if (uid) {
      var ok = M.drivers().some(function (d) { return d.uid === uid; });
      if (!ok) uid = null;
    }
    M._uid = uid ? String(uid) : null;
    try {
      var st = store();
      if (st) st.set('mirror_view', M._uid ? { uid: M._uid } : null);
    } catch (e) {}
    M.paintBanner();
    try { if (window.App && App.showDashboard) App.showDashboard(); } catch (e) {}
  };

  /* ---------------- the chrome: picker + banner ---------------- */

  /* The dashboard picker: ONE control above the module cards.
     No Connect All peer -> no picker at all (the dashboard is
     byte-identical to before for everyone else). */
  M.paintBar = function () {
    var bar = el('mirrorBar');
    if (!bar) return;
    var ds = M.drivers();
    if (!ds.length) {
      bar.classList.add('hidden');
      if (bar.innerHTML) bar.innerHTML = '';
      return;
    }
    var cur = M.active() ? curUid() : '';
    bar.classList.remove('hidden');
    bar.innerHTML =
      '<label class="f" for="mr_pick" style="margin:0">👁 Whose book is on screen</label>' +
      '<select id="mr_pick" class="mr-pick">' +
      '<option value="">Mine</option>' +
      ds.map(function (d) {
        return '<option value="' + esc(d.uid) + '"' + (d.uid === cur ? ' selected' : '') + '>' + esc(d.name) + '</option>';
      }).join('') +
      '</select>' +
      (cur ? '<p class="note" style="margin:6px 0 0">You are viewing <b>' + esc(M.name()) +
        '</b> — his modules open read-only.</p>' : '');
    var sel = bar.querySelector('#mr_pick');
    if (sel) sel.onchange = function () { M.setView(sel.value || null); };
  };

  M.hideBar = function () {
    var bar = el('mirrorBar');
    if (bar) { bar.classList.add('hidden'); if (bar.innerHTML) bar.innerHTML = ''; }
  };

  /* The persistent banner: rides #main under the topbar, so it
     is on screen on the dashboard AND inside every module while
     a driver's book is being viewed. */
  M.paintBanner = function () {
    var b = el('mirrorBanner');
    if (!b) return;
    if (!M.active()) {
      b.classList.add('hidden');
      if (b.innerHTML) b.innerHTML = '';
      return;
    }
    b.classList.remove('hidden');
    b.innerHTML =
      '<span>👁 <b>Viewing: ' + esc(M.name()) + '</b> — read-only. This is his book, not yours.</span>' +
      '<button type="button" class="btn small ghost" id="mr_backmine">Back to mine</button>';
    var btn = b.querySelector('#mr_backmine');
    if (btn) btn.onclick = function () { M.setView(null); };
  };

  /* ---------------- pure day facts (the manifest law) -------- */

  /* One shared day's summary, the manifest's way: HOURS from the
     day's revenue-record facts — a completed ticket's foreman +
     travel hours, else the day close's foreman + travel + bonus
     (CP.priceDay's own precedence: the two legs never stack) —
     NEVER the tracker session's hours. km is the session's
     distance fact; loads the day's published count. */
  M.dayFacts = function (day) {
    if (!day) return { date: '', hours: 0, km: null, loads: 0 };
    var fh = 0, th = 0, anyFacts = false;
    (day.dispatches || []).forEach(function (sd) {
      if (sd && sd.status === 'completed' &&
          ((parseFloat(sd.foremanHours) || 0) > 0 || (parseFloat(sd.travelHours) || 0) > 0)) {
        anyFacts = true;
        fh += parseFloat(sd.foremanHours) || 0;
        th += parseFloat(sd.travelHours) || 0;
      }
    });
    var hours;
    if (anyFacts) hours = fh + th;
    else if (day.close) {
      hours = (parseFloat(day.close.foremanHours) || 0) +
        (parseFloat(day.close.travelHours) || 0) +
        (parseFloat(day.close.bonusHours) || 0);
    } else hours = 0;
    var km = (day.session && typeof day.session.km === 'number') ? day.session.km : null;
    return { date: day.date || '', hours: r2(hours), km: km, loads: parseFloat(day.loads) || 0 };
  };

  /* ---------------- shared paint helpers --------------------- */

  function headHtml(name) {
    return '<div class="card" style="border:2px solid #b45309;background:#fff8e6">' +
      '<b>👁 Viewing: ' + esc(name) + ' — read-only</b>' +
      '<div class="note" style="margin-top:2px">His published book. Nothing here can be added, edited or deleted.</div></div>';
  }
  function loadingHtml(name) {
    return headHtml(name) + '<div class="card"><p class="note">Loading his book…</p></div>';
  }
  function stillMine(uid) { return M.active() && curUid() === uid; }

  function wirePhotos(body, uid) {
    if (!body || !body.querySelectorAll) return;
    Array.prototype.forEach.call(body.querySelectorAll('.mr-photo'), function (btn) {
      btn.onclick = function () {
        var key = btn.getAttribute('data-mrphoto');
        var wrap = btn.parentNode;
        var slot = wrap && wrap.querySelector ? wrap.querySelector('.mr-slot') : null;
        if (!slot || !key) return;
        slot.innerHTML = '<p class="note">Loading photo…</p>';
        var cp = CP();
        if (!cp || !cp.fetchPhoto) { slot.innerHTML = '<p class="note">Photo not available.</p>'; return; }
        cp.fetchPhoto(uid, key).then(function (img) {
          if (!img) { slot.innerHTML = '<p class="note">Photo not available.</p>'; return; }
          slot.innerHTML = '<img alt="Receipt photo" style="max-width:100%;border-radius:10px;margin-top:8px" src="' + img + '">';
        });
      };
    });
  }
  function photoBtn(key) {
    return '<div class="mr-photowrap"><button type="button" class="btn small ghost mr-photo" data-mrphoto="' +
      esc(key) + '">📷 Receipt photo</button><div class="mr-slot"></div></div>';
  }

  function statusText(sd) {
    if (!sd) return '';
    if (sd.status === 'completed') return '✓ Closed';
    if (sd.status === 'cancelled') return 'Cancelled';
    if (sd.status === 'active') return 'Working now';
    return 'Scheduled';
  }
  function timeText(iso) {
    var m = /T(\d{2}):(\d{2})/.exec(String(iso || ''));
    return m ? (m[1] + ':' + m[2]) : '';
  }

  /* ---------------- the module faces ------------------------- */

  function renderDispatch(body, uid, name) {
    var cp = CP(), t = today();
    var from = cp && cp.dateShift ? cp.dateShift(t, -13) : t;
    return cp.fetchCrewRange(from, t).then(function (days) {
      if (!stillMine(uid)) return false;
      days = (days || []).filter(function (d) { return d && d.driver === uid; })
        .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      var h = headHtml(name);
      if (!days.length) {
        body.innerHTML = h + '<div class="card"><h3>📋 His dispatches</h3>' +
          '<div class="empty">No days shared yet. When he works, his days appear here on their own.</div></div>';
        return true;
      }
      h += '<div class="card"><h3>📋 His dispatches — last 14 days</h3>';
      days.forEach(function (day) {
        var f = M.dayFacts(day);
        h += '<div style="margin:12px 0 2px;font-weight:700">' + esc(day.date) + '</div>';
        (day.dispatches || []).forEach(function (sd) {
          h += '<div class="kv"><span>' + esc(sd.jobSite || 'Dispatch') +
            (sd.equipment ? ' · ' + esc(sd.equipment) : '') +
            (timeText(sd.scheduledAt) ? ' · ' + esc(timeText(sd.scheduledAt)) : '') +
            '</span><b>' + esc(statusText(sd)) + '</b></div>';
          var bits = [];
          if (sd.material) bits.push('Material: ' + esc(sd.material));
          if (sd.ticketNo) bits.push('Ticket #' + esc(sd.ticketNo));
          if (sd.status === 'completed') {
            bits.push('Foreman ' + num(sd.foremanHours) + ' h');
            if (parseFloat(sd.travelHours) > 0) bits.push('Travel ' + num(sd.travelHours) + ' h');
            if (parseFloat(sd.loads) > 0) bits.push(num(sd.loads, 0) + ' loads');
          }
          if (sd.notes) bits.push(esc(sd.notes));
          if (bits.length) h += '<div style="padding-left:14px;color:#555;font-size:13px;margin:1px 0 4px">' + bits.join(' · ') + '</div>';
        });
        if (!(day.dispatches || []).length) {
          h += '<div class="kv"><span style="padding-left:14px">Day record</span><b>' +
            (day.session && day.session.active ? 'Working now' : 'Closed') + '</b></div>';
        }
        if (day.close && day.close.ticketNo) {
          h += '<div style="padding-left:14px;color:#555;font-size:13px;margin:1px 0 4px">Ticket #' +
            esc(day.close.ticketNo) + (day.close.material ? ' · ' + esc(day.close.material) : '') + '</div>';
        }
        h += '<div class="kv"><span style="padding-left:14px"><b>Day total</b></span><b>' +
          num(f.loads, 0) + ' loads · ' + num(f.hours) + ' h</b></div>';
      });
      body.innerHTML = h + '</div>';
      return true;
    });
  }

  function renderRevenue(body, uid, name) {
    var cp = CP(), t = today(), ms = t.slice(0, 7) + '-01';
    return Promise.all([cp.fetchCrewRange(ms, t), cp.fetchRecords()]).then(function (res) {
      if (!stillMine(uid)) return false;
      var days = (res[0] || []).filter(function (d) { return d && d.driver === uid; })
        .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      var out = res[1] || { records: {}, billing: {} };
      var rec = out.records[uid] || null;
      /* his wage is HIS OWN, off his records doc (the v163 law);
         the pricingFor fallbacks (my cached copy of his wage,
         then a hand-added local entry) stand behind it. */
      var wage = (rec && rec.driverWage && parseFloat(rec.driverWage.rate) > 0)
        ? { payType: rec.driverWage.payType || 'hourly', rate: parseFloat(rec.driverWage.rate) }
        : null;
      var pricing = cp.pricingFor(uid);
      if (!wage) wage = pricing.wage;
      pricing = { clientRate: pricing.clientRate, wage: wage };
      var h = headHtml(name) + '<div class="card"><h3>📊 His revenue — this month</h3>';
      if (!days.length) {
        h += '<div class="empty">No days shared yet this month.</div>';
      } else {
        var tH = 0, tL = 0, tW = 0, anyW = false;
        days.forEach(function (day) {
          var f = M.dayFacts(day);
          var pr = cp.priceDay(day, pricing);
          tH += f.hours; tL += f.loads;
          if (pr.wage !== null && pr.wage !== undefined) { tW += pr.wage; anyW = true; }
          h += '<div class="kv"><span>' + esc(day.date) + ' · ' + num(f.loads, 0) + ' loads · ' + num(f.hours) + ' h</span><b>' +
            (pr.wage !== null && pr.wage !== undefined ? money(pr.wage) : '—') + '</b></div>';
        });
        h += '<div class="kv"><span><b>Month total</b> · ' + num(tL, 0) + ' loads · ' + num(tH) + ' h</span><b>' +
          (anyW ? money(tW) : '—') + '</b></div>';
        if (!wage) h += '<p class="note" style="margin-top:6px">His pay shows once he sets his wage on his side — hours only until then.</p>';
        else h += '<p class="note" style="margin-top:6px">Priced at his own wage — ' + money(wage.rate) +
          (wage.payType === 'perload' ? ' / load' : wage.payType === 'permile' ? ' / km' : ' / h') + ', set on his side.</p>';
      }
      h += '</div>';
      var bill = out.billing[uid];
      if (bill && bill.invoices && bill.invoices.length) {
        h += '<div class="card"><h3>🧾 His pay invoices to you</h3>';
        bill.invoices.forEach(function (iv) {
          h += '<div class="kv"><span>Invoice #' + esc(iv.no) + ' · ' + esc(iv.pa) + ' → ' + esc(iv.pb) +
            (iv.hours != null ? ' · ' + num(iv.hours) + ' h' : '') + '</span><b>' +
            money(iv.total || 0) + ' · ' + esc(iv.status) + '</b></div>';
        });
        h += '<p class="note" style="margin-top:6px">View / print stays on the P&amp;L crew card, as before.</p></div>';
      }
      body.innerHTML = h;
      return true;
    });
  }

  function renderFuel(body, uid, name) {
    var cp = CP();
    return cp.fetchRecords().then(function (out) {
      if (!stillMine(uid)) return false;
      var rec = (out && out.records && out.records[uid]) || null;
      var h = headHtml(name);
      if (!rec) {
        body.innerHTML = h + '<div class="card"><h3>⛽ His fuel &amp; expenses</h3>' +
          '<div class="empty">Nothing shared yet.</div></div>';
        return true;
      }
      var fills = (rec.fuel || []).filter(Boolean);
      h += '<div class="card"><h3>⛽ His fuel</h3>';
      if (!fills.length) h += '<div class="empty">No fill-ups shared yet.</div>';
      var tL = 0, tC = 0;
      fills.slice(0, 100).forEach(function (f) {
        tL += parseFloat(f.litres) || 0; tC += parseFloat(f.cost) || 0;
        h += '<div class="kv"><span>' + esc(f.date) + (f.time ? ' ' + esc(f.time) : '') + ' · ' + esc(f.station || 'Station') +
          (f.odo ? '<br><span style="color:#555;font-size:13px">Odometer ' + Number(f.odo).toLocaleString('en-CA') + ' km</span>' : '') +
          '</span><b>' + num(f.litres) + ' L · ' + money(f.cost) +
          (f.pricePerLitre ? '<br><span style="color:#555;font-size:13px">' + money(f.pricePerLitre) + '/L</span>' : '') + '</b></div>';
        if (f.photoRef && f.photoKey) h += photoBtn(f.photoKey);
      });
      if (fills.length > 100) h += '<p class="note" style="margin-top:6px">Showing the latest 100 of ' + fills.length + ' fill-ups.</p>';
      if (fills.length) h += '<div class="kv"><span><b>Total</b></span><b>' + num(tL) + ' L · ' + money(tC) + '</b></div>';
      h += '</div>';
      var exps = (rec.expenses || []).filter(Boolean);
      if (exps.length) {
        h += '<div class="card"><h3>🧾 His other expenses</h3>';
        var eT = 0;
        exps.slice(0, 100).forEach(function (x) {
          eT += parseFloat(x.cost) || 0;
          h += '<div class="kv"><span>' + esc(x.date) + ' · ' + esc(x.what) + '</span><b>' + money(x.cost) + '</b></div>';
        });
        h += '<div class="kv"><span><b>Total</b></span><b>' + money(eT) + '</b></div></div>';
      }
      body.innerHTML = h;
      wirePhotos(body, uid);
      return true;
    });
  }

  function renderMaintenance(body, uid, name) {
    var cp = CP();
    return cp.fetchRecords().then(function (out) {
      if (!stillMine(uid)) return false;
      var rec = (out && out.records && out.records[uid]) || null;
      var mt = rec && rec.maintenance;
      var h = headHtml(name) + '<div class="card"><h3>🔧 His maintenance</h3>';
      if (!mt) {
        body.innerHTML = h + '<div class="empty">No maintenance record shared.</div></div>';
        return true;
      }
      if (mt.odometer) h += '<div class="kv"><span>Odometer</span><b>' + Number(mt.odometer).toLocaleString('en-CA') + ' km</b></div>';
      if (mt.nextServiceOdo || mt.nextServiceDate) {
        h += '<div class="kv"><span>Next service</span><b>' +
          (mt.nextServiceOdo ? Number(mt.nextServiceOdo).toLocaleString('en-CA') + ' km' : '') +
          (mt.nextServiceOdo && mt.nextServiceDate ? ' · ' : '') + esc(mt.nextServiceDate || '') + '</b></div>';
      }
      if (mt.annualExpiry) h += '<div class="kv"><span>Annual inspection expires</span><b>' + esc(mt.annualExpiry) + '</b></div>';
      (mt.due || []).forEach(function (du) {
        h += '<div class="kv"><span>' + esc(du.name) + '</span><b>' +
          (du.dateBased ? esc(du.annualDate || '')
            : (du.overdue ? '⚠️ overdue' : 'due in ' + Number(du.remainingKm || 0).toLocaleString('en-CA') + ' km')) + '</b></div>';
      });
      (mt.services || []).slice(0, 10).forEach(function (sv) {
        h += '<div class="kv"><span>Service — ' + esc(sv.date) + (sv.notes ? ' · ' + esc(sv.notes) : '') + '</span><b>' + esc(sv.type) +
          (sv.odo ? ' · ' + Number(sv.odo).toLocaleString('en-CA') + ' km' : '') +
          (sv.cost ? ' · ' + money(sv.cost) : '') + '</b></div>';
      });
      body.innerHTML = h + '</div>';
      return true;
    });
  }

  function renderPti(body, uid, name) {
    var cp = CP();
    return cp.fetchRecords().then(function (out) {
      if (!stillMine(uid)) return false;
      var rec = (out && out.records && out.records[uid]) || null;
      var list = (rec && rec.pti ? rec.pti : []).filter(Boolean);
      var h = headHtml(name) + '<div class="card"><h3>🔍 His PTI reports</h3>';
      if (!list.length) {
        body.innerHTML = h + '<div class="empty">No PTI reports shared yet.</div></div>';
        return true;
      }
      list.forEach(function (r) {
        var isMajor = r.result === 'major';
        h += '<div class="kv"><span>' + esc(r.date) + ' · ' + (r.kind === 'post' ? 'Post-trip' : 'Pre-trip') +
          (r.unit ? ' · Unit ' + esc(r.unit) : '') +
          (r.odometer ? ' · odo ' + Number(r.odometer).toLocaleString('en-CA') + ' km' : '') +
          (r.signed ? ' · ✍ Signed' : '') +
          '</span><b>' + (isMajor
            ? '<span style="color:#b91c1c">🚨 MAJOR DEFECT</span>'
            : (r.result === 'minor' ? '<span style="color:#92400e">⚠ Minor defect(s)</span>' : '✓ No defects')) + '</b></div>';
        (r.defects || []).forEach(function (df) {
          var maj = df.severity === 'major';
          h += '<div style="padding-left:26px;margin:1px 0;' + (maj ? 'color:#b91c1c;font-weight:700' : 'color:#555') + '">' +
            (maj ? '⛔ MAJOR — ' : '⚠ Minor — ') + esc(df.item) + (df.note ? ': ' + esc(df.note) : '') + '</div>';
        });
      });
      body.innerHTML = h + '</div>';
      return true;
    });
  }

  function renderDamage(body, uid, name) {
    var cp = CP();
    return cp.fetchRecords().then(function (out) {
      if (!stillMine(uid)) return false;
      var rec = (out && out.records && out.records[uid]) || null;
      var list = (rec && rec.damage ? rec.damage : []).filter(Boolean);
      var h = headHtml(name) + '<div class="card"><h3>📸 His damage &amp; incident reports</h3>';
      if (!list.length) {
        body.innerHTML = h + '<div class="empty">No reports on file.</div></div>';
        return true;
      }
      list.forEach(function (r) {
        h += '<div class="kv"><span>' + esc(r.date) + (r.at ? ' ' + esc(r.at) : '') + ' · ' +
          (r.kind === 'load' ? 'Load' : 'Equipment') +
          (r.dispatch ? ' · ' + esc(r.dispatch) : '') + '</span></div>';
        if (r.desc) h += '<div style="padding-left:14px;color:#555;font-size:13px;margin:1px 0 4px">' + esc(r.desc) + '</div>';
        (r.photoKeys || []).forEach(function (k) { if (k) h += photoBtn(k); });
      });
      body.innerHTML = h + '</div>';
      wirePhotos(body, uid);
      return true;
    });
  }

  function renderManifest(body, uid, name) {
    var cp = CP(), t = today(), ms = t.slice(0, 7) + '-01';
    return Promise.all([cp.fetchCrewRange(ms, t), cp.fetchRecords()]).then(function (res) {
      if (!stillMine(uid)) return false;
      var days = (res[0] || []).filter(function (d) { return d && d.driver === uid; })
        .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      var rec = (res[1] && res[1].records && res[1].records[uid]) || null;
      var fuelByDate = {};
      if (rec) (rec.fuel || []).forEach(function (f) {
        if (!f || !f.date) return;
        fuelByDate[f.date] = (fuelByDate[f.date] || 0) + (parseFloat(f.litres) || 0);
      });
      var h = headHtml(name);
      if (!days.length) {
        body.innerHTML = h + '<div class="card"><h3>📝 His manifest — this month</h3>' +
          '<div class="empty">No days shared yet this month.</div></div>';
        return true;
      }
      /* the daily log: his latest day, places by NAME */
      var last = days[days.length - 1], lf = M.dayFacts(last);
      var places = [];
      (last.dispatches || []).forEach(function (sd) {
        if (sd && sd.jobSite && places.indexOf(sd.jobSite) === -1) places.push(sd.jobSite);
      });
      h += '<div class="card"><h3>📝 Daily log · ' + esc(last.date) + '</h3>';
      if (places.length) h += '<div class="kv"><span>Places</span><b>' + esc(places.join(' · ')) + '</b></div>';
      if (last.close && last.close.material) h += '<div class="kv"><span>Material</span><b>' + esc(last.close.material) + '</b></div>';
      if (last.close && last.close.ticketNo) h += '<div class="kv"><span>Ticket</span><b>#' + esc(last.close.ticketNo) + '</b></div>';
      h += '<div class="kv"><span>Loads</span><b>' + num(lf.loads, 0) + '</b></div>';
      h += '<div class="kv"><span>Hours</span><b>' + num(lf.hours) + ' h</b></div>';
      if (lf.km !== null && lf.km !== undefined) h += '<div class="kv"><span>Distance</span><b>' + num(lf.km) + ' km</b></div>';
      if (fuelByDate[last.date]) h += '<div class="kv"><span>Fuel</span><b>' + num(fuelByDate[last.date]) + ' L</b></div>';
      h += '</div>';
      /* the multi-day summary — the module's own table shape
         (web 344 columns), hours from revenue facts (dayFacts) */
      h += '<div class="card"><h3>📋 Multi-day summary — this month</h3>' +
        '<table class="mn-sumtab"><tr><th>Date</th><th class="r">km</th><th class="r">Hours</th><th class="r">Loads</th><th class="r">Fuel</th></tr>';
      var tKm = 0, tH = 0, tL = 0, tF = 0;
      days.forEach(function (day) {
        var f = M.dayFacts(day), fl = fuelByDate[day.date] || 0;
        tKm += f.km || 0; tH += f.hours; tL += f.loads; tF += fl;
        h += '<tr><td>' + esc(day.date) + '</td><td class="r">' + (f.km == null ? '—' : num(f.km)) +
          '</td><td class="r">' + num(f.hours) + '</td><td class="r">' + num(f.loads, 0) +
          '</td><td class="r">' + (fl ? num(fl) : '—') + '</td></tr>';
      });
      h += '<tr><td><b>Total</b></td><td class="r"><b>' + num(tKm) + '</b></td><td class="r"><b>' + num(tH) +
        '</b></td><td class="r"><b>' + num(tL, 0) + '</b></td><td class="r"><b>' + (tF ? num(tF) : '—') + '</b></td></tr></table>';
      if (!rec) h += '<p class="note" style="margin-top:6px">Fuel column fills in from his shared fuel records.</p>';
      body.innerHTML = h + '</div>';
      return true;
    });
  }

  /* The driver's trips, as published: the records doc's nav
     section (v358 — destination names from his trip log + his
     last destination) over his shared days (the runs themselves,
     places by name, the day's distance). No live position, no
     map controls, and — the owner's one exclusion — no timer:
     a day still working shows its record ("Working now" is a
     fact on his day doc), never a session face. His saved
     places and route pins do not cross in the published docs
     (named gap NAV-PLACES-NOT-PUBLISHED) — the face says so. */
  function renderNavigator(body, uid, name) {
    var cp = CP(), t = today();
    var from = cp && cp.dateShift ? cp.dateShift(t, -13) : t;
    return Promise.all([cp.fetchCrewRange(from, t), cp.fetchRecords()]).then(function (res) {
      if (!stillMine(uid)) return false;
      var days = (res[0] || []).filter(function (d) { return d && d.driver === uid; })
        .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      var rec = (res[1] && res[1].records && res[1].records[uid]) || null;
      var nav = (rec && rec.nav) || null;
      var h = headHtml(name) + '<div class="card"><h3>🧭 His trips — last 14 days</h3>';
      if (nav && nav.lastDest) {
        h += '<div class="kv"><span>Last trip</span><b>→ ' + esc(nav.lastDest) + '</b></div>';
      }
      var trips = (nav && nav.trips) || [];
      if (trips.length) {
        h += '<div style="margin:10px 0 2px;font-weight:700">From his trip log</div>';
        trips.slice(0, 20).forEach(function (tr) {
          h += '<div class="kv"><span>' + esc(tr.date) + (timeText(tr.at) ? ' · ' + esc(timeText(tr.at)) : '') +
            '</span><b>→ ' + esc(tr.name) + '</b></div>';
        });
      }
      if (days.length) {
        h += '<div style="margin:10px 0 2px;font-weight:700">His runs</div>';
        days.forEach(function (day) {
          (day.dispatches || []).forEach(function (sd) {
            h += '<div class="kv"><span>' + esc(day.date) + (timeText(sd.scheduledAt) ? ' · ' + esc(timeText(sd.scheduledAt)) : '') +
              ' · ' + esc(sd.jobSite || 'Dispatch') + '</span><b>' + esc(statusText(sd)) + '</b></div>';
          });
          if (day.session && typeof day.session.km === 'number' && day.session.km > 0) {
            h += '<div class="kv"><span style="padding-left:14px">' + esc(day.date) + ' distance</span><b>' + num(day.session.km) + ' km</b></div>';
          }
        });
      }
      if (!trips.length && !days.length) {
        h += '<div class="empty">No trips shared yet.</div>';
      }
      h += '<p class="note" style="margin-top:8px">His saved places and route pins don\'t cross yet — trips and runs only.</p>';
      body.innerHTML = h + '</div>';
      return true;
    });
  }

  /* NAMED GAP (DOCS-NOT-PUBLISHED): a driver's documents do
     not ride any published doc, so there is nothing honest to
     paint — the face says exactly that, rather than ever
     falling through to the payer's OWN documents under the
     driver's name (the whose-book confusion this build kills). */
  function renderDocuments(body, uid, name) {
    body.innerHTML = headHtml(name) + '<div class="card"><h3>📁 His documents</h3>' +
      '<div class="empty">His documents don\'t cross on Connect yet — nothing of his is published here to show.</div></div>';
    return Promise.resolve(true);
  }

  var RENDER = {
    dispatch: renderDispatch, revenue: renderRevenue, fuel: renderFuel,
    maintenance: renderMaintenance, pti: renderPti, damage: renderDamage,
    manifest: renderManifest, navigator: renderNavigator, documents: renderDocuments
  };

  /* The openModule door (js/app.js v357 hook): paint the picked
     driver's face for a covered module. Always resolves — a
     failed fetch paints an honest empty, never a crash and never
     the payer's own data under the driver's name. */
  M.render = function (key, body) {
    var uid = curUid(), name = M.name();
    body.innerHTML = loadingHtml(name);
    var fn = RENDER[key];
    if (!fn || !CP()) {
      body.innerHTML = headHtml(name) + '<div class="card"><div class="empty">His book could not be loaded.</div></div>';
      return Promise.resolve(false);
    }
    return Promise.resolve()
      .then(function () { return fn(body, uid, name); })
      .catch(function () {
        if (stillMine(uid)) {
          body.innerHTML = headHtml(name) + '<div class="card"><div class="empty">His book could not be loaded — check the connection and try again.</div></div>';
        }
        return false;
      });
  };
})();
