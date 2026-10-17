/* Meticulous — Dispatch module (standalone, complete)
   Active dispatch card (job site, material, ticket #, status), manual entry,
   ticket image upload with preview + downscaled storage, history list,
   "Complete dispatch" logs earnings to the Revenue module.
   Persists via App._store (localStorage, mt_ prefix). Firebase via FB.saveDoc.
*/
(function () {
  'use strict';
  window.Meticulous = window.Meticulous || {};
  Meticulous.modules = Meticulous.modules || {};

  var S = function (k, d) { return App._store.get('dsp_' + k, d); };
  var W = function (k, v) { return App._store.set('dsp_' + k, v); }; // v48: returns write result
  var esc = function (s) { return App._esc(s); };

  function list() { return S('list', []); }       // saved / history
  function active() { return S('active', null); } // current active dispatch
  function uid() { return 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  /* ================= DSP-SAVE-BEGIN =================
     v48: save integrity. The Oct 13 loss: the user uploaded a dispatch
     photo, tapped "Save & start", and the dispatch was gone next
     morning — the store swallowed write errors, so a failed save
     looked exactly like a successful one, and the unsaved form lived
     only in memory. These helpers are marker-delimited and extracted
     verbatim by tools/dispatch-save-test.js:
       - a form DRAFT (fields + tickets + photos) persists to the
         synced key dsp_draft as the user works, and is only cleared
         after a VERIFIED save;
       - a save is verified by reading the record back from the store
         before anyone claims success;
       - the ticket photo is stored ONCE (inside tickets[]); the
         top-level photo field is only used when there are no tickets,
         and readers resolve the photo via dspPhotoFor so old records
         (photo at top level) and new ones both display.
  */
  function dspGet(k, d) { return App._store.get('dsp_' + k, d); }
  function dspSet(k, v) { return App._store.set('dsp_' + k, v); }
  function dspPhotoFor(d) {
    if (!d) return null;
    if (d.photo) return d.photo;
    if (d.tickets && d.tickets.length) {
      for (var i = 0; i < d.tickets.length; i++) {
        if (d.tickets[i] && d.tickets[i].photo) return d.tickets[i].photo;
      }
    }
    return null;
  }
  function dspBuildRecord(f, tickets, legacyPhoto, newId) {
    var d = {};
    for (var k in f) { if (Object.prototype.hasOwnProperty.call(f, k)) d[k] = f[k]; }
    d.id = newId;
    d.tickets = tickets ? tickets.slice() : [];
    /* photo stored once: inside tickets[] when tickets carry it;
       top-level only for the legacy no-ticket case. */
    d.photo = d.tickets.length ? null : (legacyPhoto || null);
    d.status = 'saved';
    return d;
  }
  function dspSaveDraft(draft) { return dspSet('draft', draft); }
  /* Fallback for a full/failing local store: the same draft with the
     ticket photos stripped (metadata kept). Much smaller, so it can
     still land when the photo-carrying draft cannot — the typed entry
     survives even when the photo cannot be kept. */
  function dspSlimDraft(draft) {
    if (!draft) return draft;
    var out = { fields: draft.fields || {}, tickets: [], photo: null, photoDropped: true, savedAt: draft.savedAt || 0, editId: draft.editId || null };
    (draft.tickets || []).forEach(function (t) {
      var c = {};
      for (var k in t) { if (Object.prototype.hasOwnProperty.call(t, k)) c[k] = t[k]; }
      c.photo = null;
      out.tickets.push(c);
    });
    return out;
  }
  function dspLoadDraft() {
    var d = dspGet('draft', null);
    return (d && typeof d === 'object') ? d : null;
  }
  function dspClearDraft() {
    if (App._store.del) return App._store.del('dsp_draft');
    return dspSet('draft', null);
  }
  function dspVerifySaved(id, wantActive) {
    var l = dspGet('list', []);
    var found = false;
    for (var i = 0; i < l.length; i++) { if (l[i] && l[i].id === id) { found = true; break; } }
    if (!found) return false;
    if (wantActive) {
      var a = dspGet('active', null);
      if (!a || a.id !== id) return false;
    }
    return true;
  }
  function dspSaveRecord(d, start) {
    var l = dspGet('list', []);
    var exists = false;
    for (var i = 0; i < l.length; i++) { if (l[i] && l[i].id === d.id) { exists = true; break; } }
    if (!exists) {
      l.push(d);
      if (dspSet('list', l) === false) return { ok: false, stage: 'list' };
    }
    if (start) {
      if (dspSet('active', d) === false) return { ok: false, stage: 'active' };
    }
    if (!dspVerifySaved(d.id, !!start)) return { ok: false, stage: 'verify' };
    return { ok: true };
  }
  /* ---- v56: EDITING a saved dispatch ----
     Until now the only save flow CREATED records: a saved dispatch
     could not be corrected at all (the owner's Oct 14 note fix —
     "Go Empty To" should have read "Go to Ivor East Pond empty" —
     had no path). Editing an existing record:
       - keeps the SAME id (no duplicate history entry);
       - overlays only form fields — status, startedAt / endedAt and
         the record's day are lifecycle facts, pinned from the
         original, so editing the ACTIVE dispatch can never restart
         it, complete it, or move its day;
       - stores the ticket photo exactly once (same rule as create);
       - writes with the same discipline as a create: write, then
         READ BACK and compare; on any failure the stored record is
         left untouched (a failed list write never landed; a failed
         active write rolls the list copy back to the original). */
  function dspFindRecord(id) {
    if (!id) return null;
    var l = dspGet('list', []);
    for (var i = 0; i < l.length; i++) { if (l[i] && l[i].id === id) return l[i]; }
    var a = dspGet('active', null);
    return (a && a.id === id) ? a : null;
  }
  function dspApplyEdit(orig, f, tickets, legacyPhoto) {
    var d = {};
    var k;
    for (k in orig) { if (Object.prototype.hasOwnProperty.call(orig, k)) d[k] = orig[k]; }
    for (k in f) { if (Object.prototype.hasOwnProperty.call(f, k)) d[k] = f[k]; }
    d.id = orig.id;           // an edit never mints a new id
    d.status = orig.status;   // lifecycle is not a form field
    d.date = orig.date;       // an edit never moves the dispatch's day
    if (orig.startedAt !== undefined) d.startedAt = orig.startedAt;
    if (orig.endedAt !== undefined) d.endedAt = orig.endedAt;
    d.tickets = tickets ? tickets.slice() : [];
    /* photo stored once — same rule as dspBuildRecord */
    d.photo = d.tickets.length ? null : (legacyPhoto || null);
    /* v129: EDIT SAFETY on a completed dispatch — its ticket #,
       material and amount are CLOSE FACTS (see dspCloseFactsFor):
       an edit whose form leaves one blank keeps the value the
       close recorded, so a save can never stomp a closed day's
       truth with blanks. A value the form DID carry still wins —
       correcting a close fact stays possible; erasing one by
       omission does not. */
    if (orig.status === 'completed') {
      var cf = dspCloseFactsFor(orig);
      if (!String(d.ticketNo || '').trim() && cf.ticketNo) d.ticketNo = cf.ticketNo;
      if (!String(d.material || '').trim() && cf.material) d.material = cf.material;
      if (!(parseFloat(d.amount) > 0) && cf.amount) d.amount = cf.amount;
    }
    return d;
  }
  /* v129: the ticket facts a read produced, mined from wherever
     the read left them: the tickets' parsed fields first
     (cardNumber / ticketNo / material), then the tickets' stored
     read reports (docRead.found — "ticket #22729", "material
     Gravel"), cleaned through the v117 gibberish gate so a dirty
     entry can never pose as a fact. Pure; never writes. */
  function dspTicketFacts(tickets) {
    var no = '', mat = '';
    (tickets || []).forEach(function (t) {
      if (!t) return;
      if (!no && (t.cardNumber || t.ticketNo)) no = String(t.cardNumber || t.ticketNo);
      if (!mat && t.material) mat = String(t.material);
    });
    if (!no || !mat) {
      (tickets || []).forEach(function (t) {
        if (!t || !t.docRead) return;
        var clean = dspCleanDocRead(t.docRead);
        (clean.found || []).forEach(function (entry) {
          var s = String(entry);
          if (!no) { var m1 = /^ticket\s*#\s*(.+)$/i.exec(s); if (m1) no = m1[1].trim(); }
          if (!mat) { var m2 = /^material\s+(.+)$/i.exec(s); if (m2) mat = m2[1].trim(); }
        });
      });
    }
    return { ticketNo: no, material: mat };
  }
  /* v129: a record's CLOSE FACTS — the values its completion
     established — read with healing: a stored top-level field
     wins; a blank one is derived from the tickets (display and
     comparison only — reading never rewrites the stored record).
     amount is the record's own stamped close amount ('' when the
     close logged none). */
  function dspCloseFactsFor(d) {
    if (!d) return { ticketNo: '', material: '', amount: '' };
    var mined = dspTicketFacts(d.tickets);
    var amt = parseFloat(d.amount);
    return {
      ticketNo: d.ticketNo || mined.ticketNo || '',
      material: d.material || mined.material || '',
      amount: (isNaN(amt) || !(amt > 0)) ? '' : String(d.amount)
    };
  }
  /* v117 (owner, Oct 16 2026, over the Oct 16 Aecon edit form):
     the edit form's pre-fill, from the record AND its tickets.
     The facts a ticket read produced live ON the tickets — the
     haul card's number, the tickets' loads — and a record whose
     top-level fields were never promoted opened HALF-EMPTY:
     Material blank, Ticket # blank, Amount 0.00, Loads reset to
     the bare default 1. Promotion rule: a set top-level field
     always wins; a blank one is filled from the tickets (first
     card/ticket number, first material, the tickets' loads sum);
     Loads falls back to the form default ONLY when nothing was
     recorded anywhere; a zero amount opens blank (the field's
     placeholder), never as a fake 0.00 value. When the loads came
     from the tickets they are recorded loads, so loadsSet rides
     true — the same trust dspBuildClosed gives a ticket sum. */
  function dspEditFieldsFor(d) {
    var mined = dspTicketFacts(d.tickets);
    var tkNo = mined.ticketNo, tkMat = mined.material, tkLoads = 0;
    (d.tickets || []).forEach(function (t) {
      if (!t) return;
      var tl = parseInt(t.loads, 10);
      if (tl > 0) tkLoads += tl;
    });
    var amt = parseFloat(d.amount);
    return {
      jobSite: d.jobSite || '', scheduledAt: d.scheduledAt || '', equipment: d.equipment || '',
      lat: (d.lat !== null && d.lat !== undefined) ? String(d.lat) : '',
      lng: (d.lng !== null && d.lng !== undefined) ? String(d.lng) : '',
      material: d.material || tkMat || '',
      ticketNo: d.ticketNo || tkNo || '',
      amount: (isNaN(amt) || !(amt > 0)) ? '' : String(d.amount),
      loads: d.loadsSet ? String(d.loads) : (tkLoads > 0 ? String(tkLoads) : ((d.loads !== null && d.loads !== undefined && d.loads !== '') ? String(d.loads) : '1')),
      loadsSet: !!d.loadsSet || tkLoads > 0,
      notes: d.notes || '', driverId: d.driverId || ''
    };
  }
  /* v117: the read-summary cleaner for STORED docRead reports.
     Summaries composed before the gibberish gate (or through a
     path that bypassed it) sit on saved tickets forever and
     rendered verbatim — the owner's Oct 16 ticket still printed
     "Read: Job site ONBNERREEEEARAL HH HHE". A found entry is
     dirty when any word in it (4+ letters) is gibberish by the
     v108 gate; dirty entries never render — their field label
     (recovered from the known prefixes) joins the missing list
     instead, which is the honest state of that read. Clean
     entries pass through untouched. */
  function dspCleanDocRead(docRead) {
    if (!docRead) return docRead;
    var gate = (typeof window !== 'undefined' && window.TicketOCR && window.TicketOCR.looksGibberish) || null;
    if (!gate) return docRead;
    var LABELS = ['job site', 'scheduled', 'material', 'ticket #', 'notes',
      'amount', 'pickup', 'delivery', 'truck', 'qty', 'weight', 'waiting', 'instructions'];
    var MISS = { 'job site': 'job site', 'scheduled': 'scheduled time', 'material': 'material',
      'ticket #': 'ticket #', 'notes': 'notes', 'amount': 'amount', 'pickup': 'pickup',
      'delivery': 'delivery', 'truck': 'truck type', 'qty': 'qty/weight', 'weight': 'qty/weight',
      'waiting': 'waiting time', 'instructions': 'instructions' };
    var found = [], missing = (docRead.missing || []).slice();
    (docRead.found || []).forEach(function (entry) {
      var words = String(entry).split(/\s+/);
      var dirty = words.some(function (w) {
        var letters = w.replace(/[^A-Za-z]/g, '');
        return letters.length >= 4 && gate(letters);
      });
      if (!dirty) { found.push(entry); return; }
      var label = null;
      LABELS.forEach(function (L) {
        if (!label && String(entry).toLowerCase().indexOf(L) === 0) label = L;
      });
      var miss = label ? (MISS[label] || label) : null;
      if (miss && missing.indexOf(miss) === -1) missing.push(miss);
    });
    return { found: found, missing: missing };
  }
  function dspVerifyUpdated(updated, inList, isActive) {
    var want = JSON.stringify(updated);
    if (inList) {
      var l = dspGet('list', []);
      var found = null;
      for (var i = 0; i < l.length; i++) { if (l[i] && l[i].id === updated.id) { found = l[i]; break; } }
      if (!found || JSON.stringify(found) !== want) return false;
    }
    if (isActive) {
      var a = dspGet('active', null);
      if (!a || a.id !== updated.id || JSON.stringify(a) !== want) return false;
    }
    return true;
  }
  function dspUpdateRecord(updated, orig) {
    var l = dspGet('list', []);
    var idx = -1;
    for (var i = 0; i < l.length; i++) { if (l[i] && l[i].id === updated.id) { idx = i; break; } }
    var act = dspGet('active', null);
    var isActive = !!(act && act.id === updated.id);
    if (idx === -1 && !isActive) return { ok: false, stage: 'missing' };
    if (idx !== -1) {
      var nl = l.slice(); nl[idx] = updated;
      if (dspSet('list', nl) === false) return { ok: false, stage: 'list' };
    }
    if (isActive) {
      if (dspSet('active', updated) === false) {
        /* roll the list copy back so the two stores cannot disagree */
        if (idx !== -1 && orig) {
          var rl = dspGet('list', []);
          for (var j = 0; j < rl.length; j++) { if (rl[j] && rl[j].id === updated.id) { rl[j] = orig; break; } }
          dspSet('list', rl);
        }
        return { ok: false, stage: 'active' };
      }
    }
    if (!dspVerifyUpdated(updated, idx !== -1, isActive)) return { ok: false, stage: 'verify' };
    return { ok: true, wasActive: isActive };
  }
  /* ---- v66: the ACTIVE-DISPATCH guard ----
     The owner's day (Oct 14, 2026): tomorrow's dispatch arrives
     mid-afternoon while TODAY's dispatch is still active until
     ~7 PM. Saving the new one must never disturb the active record
     and never start the new one early. A dispatch's day is its
     scheduledAt date (the same key the v53 auto-start engine reads);
     a record with no scheduled date is today's, as it always was.
     dspMayStart is the single gate attemptSave routes "Save & start"
     through: start is honoured ONLY for today's dispatch — a past
     or future record saves as a plain scheduled record for its own
     day (where the engine will find it when that day comes). */
  function dspRecordDate(d) {
    var s = d && d.scheduledAt;
    if (typeof s === 'string') {
      var m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
      if (m) return m[1];
    }
    return (d && typeof d.date === 'string') ? d.date : '';
  }
  /* v86: the Scheduled field is a DATE input + a TIME input, not
     one datetime-local. A datetime-local takes a typed time only
     as part of a complete date+time — a time typed on its own is
     silently discarded (the field reads ''), which is exactly how
     the Oct 15 live drive's dispatch got saved with NO scheduled
     time and the manifest fell back to session times. The two
     fields each accept typing AND a picker, independently; the
     stored scheduledAt string format is unchanged
     ('YYYY-MM-DDTHH:MM', or the date alone when no time is set). */
  function dspComposeSched(dateStr, timeStr, fallbackDate) {
    var d = String(dateStr || '').trim(), t = String(timeStr || '').trim();
    if (d && t) return d + 'T' + t;
    if (d) return d;
    if (t) return fallbackDate ? (String(fallbackDate) + 'T' + t) : '';
    return '';
  }
  function dspSplitSched(s) {
    var out = { date: '', time: '' };
    if (typeof s !== 'string') return out;
    var m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(s);
    if (m) { out.date = m[1]; out.time = m[2] || ''; return out; }
    var t = /(\d{2}:\d{2})/.exec(s);
    if (t) out.time = t[1];
    return out;
  }
  function dspMayStart(d, today) {
    var rd = dspRecordDate(d);
    return !rd || rd === today;
  }
  /* ================= DSP-SAVE-END ================= */

  /* ---- v78: dashboard card preview helpers ----
     The card face shows ONE live fact (owner, Oct 15: he missed the
     old app's cards previewing state on the dashboard). dspCardLabel
     is the short job line — the site, plus where the load goes when
     the record carries a drop-off/destination; dspDayShort renders a
     record day as "Fri Oct 16". Plain text only (app.js escapes the
     status into the card's muted line). */
  var DSP_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DSP_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function dspCardLabel(d) {
    var s = (d && (d.jobSite || d.pickup)) || 'Dispatch';
    var drop = d && (d.dropoff || d.destination);
    return (drop && drop !== s) ? s + ' → ' + drop : s;
  }
  function dspDayShort(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return String(iso || '');
    var dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return DSP_DOW[dt.getUTCDay()] + ' ' + DSP_MON[dt.getUTCMonth()] + ' ' + dt.getUTCDate();
  }

  /* ================= DSP-COMPLETE-BEGIN =================
     v52: completion money plan — PURE and harness-extractable: given the
     ticket summary + account settings + the completing user's role, it
     decides the Revenue entry, any P&L travel-wage claim, and the exact
     disclosure wording. The Complete handler applies the plan; it does
     no money math of its own anymore.

     Travel-bonus rule (owner, Oct 14; audit travel-bonus-role-audit):
     the bonus is the DRIVER's income. A completer who drives ('driver'
     or 'both') gets the entry exactly as pre-v52 — foreman + travel,
     same amounts, same hours, same note — PLUS the split fields
     foremanHours / travelHours stored on the entry (invoice A1: the
     components are no longer hidden inside one hours number). An
     'office' completer never drove the work: the entry carries foreman
     hours ONLY, the travel hours are held out of income, and they are
     routed to the identified driver's wages as a claim
     (pnl_travel_claims, consumed by P&L driverWages) — or, when no
     driver is identified, the disclosure says they were held out and
     where to pay them. The money is never silently dropped.

     v105 (owner, Oct 16, 2026 — "one ticket, two books" made
     complete): the plan now also emits the card's WAGE POSTING for
     the payer-side books, so a closed card posts BOTH sides from
     the single record, each priced off its own rate:
       - 'office' + identified driver: wagePosting = (foreman +
         travel) × the DRIVER's rate, superseding the v52
         travel-only claim (the claim plumbing stays for claims
         already on file; no new claim is minted when a posting
         exists, and P&L never counts both for one dispatch).
       - 'both' (owner-operator): the entry becomes the CLIENT
         billing — foreman hours ONLY × the billing rate (customers
         never pay the travel hour) — and wagePosting = (foreman +
         travel) × his own wage rate lands in his P&L as driver pay.
         Revenue fh×billing, expense (fh+th)×wage: the travel hour
         is the carrier's absorbed cost between the two.
       - 'driver': unchanged — the entry IS his income, no posting
         (nobody owes him a second copy of it in his own books).
     Billing/wage rates arrive as x.billingRate / x.wageRate
     (Preferences; each falls back to the plain rate). Postings are
     keyed by dispatch id and applied with replace semantics
     (dspMergeCardWages / revenue.addEntry), so re-completing or
     editing a card UPDATES its postings — never duplicates them. */
  function dspFmtH(x) {
    var n = Math.round((parseFloat(x) || 0) * 100) / 100;
    return (n % 1 === 0) ? n.toFixed(1) : String(n);
  }
  function dspCompletionPlan(x) {
    var entry = null, claim = null, wagePosting = null, heldOut = 0, disclosure = '', mode = 'none';
    var sum = x.sum || null;
    if (sum) {
      var brk = (sum.breakdown || []).map(function (b) {
        return b.label + ': ' + (b.foremanHours || 0) + 'h';
      }).join(', ');
      if (x.std === 'weight' && sum.totalNetWeight > 0 && x.rate > 0) {
        var wAmt = sum.totalNetWeight * x.rate;
        entry = {
          date: x.date,
          amount: wAmt.toFixed(2),
          tons: sum.totalNetWeight.toFixed(2),
          type: 'weight',
          loads: x.ticketCount,
          note: 'Dispatch: ' + (x.jobSite || '') +
            ' · ' + sum.totalNetWeight.toFixed(2) + 't @ $' + x.rate + '/t' +
            ' (' + x.ticketCount + ' tickets)'
        };
        mode = 'weight';
      } else if ((x.std === 'hourly' || x.std === 'trip') && sum.totalForemanHours > 0) {
        var fh = sum.totalForemanHours, th = sum.travelBonus;
        if (x.role === 'office') {
          var oAmt = fh * x.rate;
          entry = {
            date: x.date,
            amount: oAmt.toFixed(2),
            hours: fh.toFixed(2),
            type: 'hourly',
            loads: x.ticketCount,
            foremanHours: fh,
            travelHours: th,
            travelInIncome: false,
            note: 'Dispatch: ' + (x.jobSite || '') +
              ' · foreman ' + fh + 'h' +
              (brk ? ' (' + brk + ')' : '') +
              ' · travel ' + dspFmtH(th) + 'h not in income (office — it is the driver\u2019s wage)'
          };
          heldOut = th;
          mode = 'office-held';
          if (x.driver) {
            /* v105: the card's FULL wage posts to the driver's P&L
               pay from this one record — foreman + travel at the
               DRIVER's rate. (v52 routed only the travel hour, as a
               claim, and left the base wage to be hand-logged.) */
            var dRate = parseFloat(x.driver.rate) || 0;
            var wHrs = Math.round((fh + th) * 100) / 100;
            wagePosting = {
              date: x.date,
              driverId: x.driver.id,
              driverName: x.driver.name || '',
              foremanHours: fh,
              travelHours: th,
              hours: wHrs,
              rate: dRate,
              wage: Math.round(wHrs * dRate * 100) / 100,
              source: 'dispatch',
              jobSite: x.jobSite || ''
            };
            mode = 'office-routed';
            if (th > 0) {
              disclosure = 'Travel ' + dspFmtH(th) + 'h not added to income — the card\u2019s full wage (' +
                dspFmtH(wHrs) + 'h \u00d7 $' + dRate + ' = $' + wagePosting.wage.toFixed(2) +
                ') was posted to ' + (x.driver.name || 'the driver') + '\u2019s pay in P&L.';
            }
          } else if (th > 0) {
            disclosure = 'Travel ' + dspFmtH(th) + 'h not added to income — assign the driver in P&L to pay it.';
          }
        } else if (x.role === 'both') {
          /* v105: the owner-operator's card does DOUBLE DUTY in his
             own books. Revenue = foreman hours ONLY × the billing
             rate (the customer never pays the travel hour); the
             driver-pay expense = (foreman + travel) × his wage rate.
             The two rates are his own Preferences values and may
             differ — the margin between them is the card's gross. */
          var bRate = parseFloat(x.billingRate) > 0 ? parseFloat(x.billingRate) : x.rate;
          var wRate = parseFloat(x.wageRate) > 0 ? parseFloat(x.wageRate) : x.rate;
          var bAmt = fh * bRate;
          entry = {
            date: x.date,
            amount: bAmt.toFixed(2),
            hours: fh.toFixed(2),
            type: 'hourly',
            loads: x.ticketCount,
            foremanHours: fh,
            travelHours: th,
            travelInIncome: false,
            note: 'Dispatch: ' + (x.jobSite || '') +
              ' · foreman ' + fh + 'h billed @ $' + bRate + '/h' +
              (brk ? ' (' + brk + ')' : '') +
              ' · travel ' + dspFmtH(th) + 'h not billed — it is your wage cost'
          };
          var bwHrs = Math.round((fh + th) * 100) / 100;
          wagePosting = {
            date: x.date,
            driverId: 'self',
            driverName: 'You (owner-operator)',
            foremanHours: fh,
            travelHours: th,
            hours: bwHrs,
            rate: wRate,
            wage: Math.round(bwHrs * wRate * 100) / 100,
            source: 'dispatch',
            jobSite: x.jobSite || ''
          };
          mode = 'both-books';
        } else {
          /* driver: byte-identical to the pre-v52 entry, plus the
             split fields foremanHours / travelHours. */
          var hAmt = sum.totalPaidHours * x.rate;
          entry = {
            date: x.date,
            amount: hAmt.toFixed(2),
            hours: sum.totalPaidHours.toFixed(2),
            type: 'hourly',
            loads: x.ticketCount,
            foremanHours: fh,
            travelHours: th,
            travelInIncome: true,
            note: 'Dispatch: ' + (x.jobSite || '') +
              ' · foreman ' + fh + 'h + travel ' + x.travelBonusRaw + 'h' +
              ' = ' + sum.totalPaidHours + 'h' +
              (brk ? ' (' + brk + ')' : '')
          };
          mode = 'driver';
        }
      }
    }
    if (!entry) {
      var amt = parseFloat(x.legacyAmount);
      if (amt > 0) {
        entry = {
          date: x.date,
          amount: amt.toFixed(2),
          type: 'load',
          loads: x.loads || 1,
          note: 'Dispatch: ' + (x.jobSite || '') + (x.ticketNo ? ' · ticket #' + x.ticketNo : '')
        };
        mode = 'legacy-amount';
      } else if (x.legacyNetWeight && x.std === 'weight' && x.rate > 0) {
        var lwAmt = parseFloat(x.legacyNetWeight) * x.rate;
        entry = {
          date: x.date,
          amount: lwAmt.toFixed(2),
          tons: x.legacyNetWeight,
          type: 'weight',
          loads: 1,
          note: 'Dispatch: ' + (x.jobSite || '') + ' · ' + x.legacyNetWeight + 't @ $' + x.rate + '/t'
        };
        mode = 'legacy-weight';
      }
    }
    return { entry: entry, claim: claim, wagePosting: wagePosting, heldOut: heldOut, disclosure: disclosure, mode: mode };
  }
  /* v105: card wage postings are keyed by dispatch — applying a
     posting REPLACES any earlier posting for the same dispatch, so
     re-completing or correcting a card updates its P&L pay line
     instead of stacking a second one (the never-twice rule). */
  function dspMergeCardWages(list, posting) {
    var out = [];
    (list || []).forEach(function (p) {
      if (!p || !posting || p.dspId !== posting.dspId) out.push(p);
    });
    if (posting) out.push(posting);
    return out;
  }
  /* ================= DSP-COMPLETE-END ================= */

  /* ================= DSP-CLOSE-BEGIN =================
     v73: CLOSE WITH TICKET PHOTO (owner, Oct 14) — the ticket photo
     IS the close of the dispatch, not an attachment chore inside
     Edit followed by a separate Complete tap. Pure helpers for the
     one-motion close; the render glue (capture sheet + confirm view)
     drives them. The transaction rules are the v48 rules:
       - the closed record is built from the stored active record
         (identity/lifecycle pinned by construction), with the new
         ticket appended and the photo stored ONCE (inside
         tickets[] — the dspBuildRecord convention);
       - the close write is VERIFIED: the completed record is read
         back from the list byte-for-byte, and dsp_active must no
         longer hold the id; if the active-clearing write fails, the
         list copy is rolled back to the open record so the two
         stores can never disagree — the dispatch stays active and
         the caller shows a plain error and keeps the confirm view;
       - dspCompletionFor is the SINGLE assembly of the completion
         money inputs (ticket summary + dspCompletionPlan). The
         plain Complete handler, the close-with-ticket Confirm, and
         the confirm view's "what happens" preview all run it, so
         what the preview promises is what Confirm logs — the same
         inputs always produce the same Revenue entry;
       - an unfinished EDIT draft on this very dispatch blocks the
         close (dspCloseBlocked): the close never silently discards
         an edit — it says so plainly and sends him back to the
         form to save or cancel it first (the v65 busy-form rule).
     v143 (owner, Oct 17 16:22 MDT — "there was no way to choose a
     picture! And there was no confirmation before it actually
     closed the shift!"): EVERY driver close ends on the confirm
     step now. Plain Complete opens it in mode 'plain' (summary +
     photo door + one Confirm; the write is the v129 construction
     through dspCloseRecord above), and picking a photo there
     becomes the closing ticket through the same reader, so the
     two buttons differ only in where they START, never in how
     the close is confirmed or written. */
  function dspBuildClosed(orig, ticket, endedAt) {
    var d = {};
    for (var k in orig) { if (Object.prototype.hasOwnProperty.call(orig, k)) d[k] = orig[k]; }
    var tk = (orig.tickets || []).slice();
    if (ticket) tk.push(ticket);
    d.tickets = tk;
    /* photo stored once — inside tickets[] when tickets carry it;
       top-level only for the legacy no-ticket case. */
    d.photo = tk.length ? null : (orig.photo || null);
    /* v82 (item 3b): loads hauled, when the tickets carry counts,
       total onto the record — the manifest reads the day's loads
       from the tickets/the record. Tickets without counts leave
       the record's own loads exactly as it was.
       v107: a ticket-summed count is a RECORDED count (it was
       confirmed in the close view) — loadsSet marks it so the
       shared dayLoads truth (invoice.js) may trust the record's
       loads, while an untouched form default '1' never carries
       the mark and never masquerades as data. */
    var loadSum = 0, anyLoads = false;
    tk.forEach(function (t) {
      var v = parseFloat(t && t.loads);
      if (v > 0) { loadSum += v; anyLoads = true; }
    });
    if (anyLoads) { d.loads = String(loadSum); d.loadsSet = true; }
    d.status = 'completed';
    d.endedAt = endedAt;
    return d;
  }
  function dspCloseRecord(doneRec) {
    var l = dspGet('list', []);
    var idx = -1, origEntry = null;
    for (var i = 0; i < l.length; i++) { if (l[i] && l[i].id === doneRec.id) { idx = i; origEntry = l[i]; break; } }
    if (idx === -1) return { ok: false, stage: 'missing' };
    var nl = l.slice(); nl[idx] = doneRec;
    if (dspSet('list', nl) === false) return { ok: false, stage: 'list' };
    var act = dspGet('active', null);
    if (act && act.id === doneRec.id) {
      if (dspSet('active', null) === false) {
        /* roll the list copy back to the open record so the two
           stores cannot disagree — the dispatch stays active */
        var rl = dspGet('list', []);
        for (var j = 0; j < rl.length; j++) { if (rl[j] && rl[j].id === doneRec.id) { rl[j] = origEntry; break; } }
        dspSet('list', rl);
        return { ok: false, stage: 'active' };
      }
    }
    /* read back: the completed record must be in the list
       byte-for-byte, and nothing may still be active under this id */
    var back = dspGet('list', []);
    var found = null;
    for (var k = 0; k < back.length; k++) { if (back[k] && back[k].id === doneRec.id) { found = back[k]; break; } }
    if (!found || JSON.stringify(found) !== JSON.stringify(doneRec)) return { ok: false, stage: 'verify' };
    var a2 = dspGet('active', null);
    if (a2 && a2.id === doneRec.id) return { ok: false, stage: 'verify' };
    return { ok: true };
  }
  function dspCloseBlocked(draft, activeId) {
    if (draft && draft.editId && activeId && draft.editId === activeId) {
      return 'You have an unfinished edit on this dispatch in the form below — tap “Save changes” or “Cancel edit” there first, then close with the ticket. Nothing was closed.';
    }
    return '';
  }
  function dspCompletionFor(rec, sett) {
    var tickets = (rec && rec.tickets) || [];
    var sum = (tickets.length && typeof window !== 'undefined' && window.TicketOCR && window.TicketOCR.summarizeTickets)
      ? window.TicketOCR.summarizeTickets(tickets, sett.travelBonus) : null;
    var plan = dspCompletionPlan({
      sum: sum, std: sett.std, rate: sett.rate, role: sett.role, date: sett.today,
      jobSite: (rec && rec.jobSite) || '', ticketCount: tickets.length,
      travelBonusRaw: sett.travelBonus, driver: sett.driver || null,
      billingRate: sett.billingRate, wageRate: sett.wageRate,
      legacyAmount: rec ? rec.amount : null, legacyNetWeight: rec ? rec.netWeight : null,
      loads: rec ? rec.loads : null, ticketNo: rec ? rec.ticketNo : null
    });
    /* v105: the entry carries the day's card numbers, so the
       invoice's closing note can name them without re-reading the
       dispatch record. */
    if (plan.entry && tickets.length) {
      var nums = [];
      tickets.forEach(function (t) {
        var n = t && (t.cardNumber || t.ticketNo);
        if (n) nums.push(String(n));
      });
      if (nums.length) plan.entry.ticketNos = nums;
    }
    return { tickets: tickets, sum: sum, plan: plan };
  }
  /* ================= DSP-CLOSE-END ================= */

  /* ================= DSP-COMPLETED-BEGIN =================
     v129 (owner, Oct 17, 2026 — his Oct 16 Aecon dispatch, ticket
     #22729): opening a COMPLETED dispatch dropped him into the
     Edit form with Material blank, Ticket # blank, Amount 0.00.
     The day's close had written the hours (foreman 10.0 + 1
     travel = 11.0 h) and the pay ($319.00) into Revenue and the
     manifest, but never onto the dispatch record itself — the
     ticket lived on the record as the haul-card PHOTO and its
     number was never parsed into the record — so every later
     view honestly showed blanks, and the user read a closed day
     as un-closed. His words: "Can you close that dispatch with
     that picture? I sent you yesterday?" Three rules land here:
       - THE CLOSE WRITES THE RECORD (dspApplyCloseFacts): every
         close path stamps the close facts — ticket # / material
         the ticket read found, the day amount from the ONE
         completion plan — onto the record and its ticket(s), so
         the record carries its own closed truth.
       - THE FACE HEALS AT READ (dspCompletedFace): a completed
         record that predates the stamping still opens complete —
         facts derived from the tickets, the day's amount from
         the SAME shared per-day builder the manifest/invoice
         print from. Display-only: reading never rewrites stored
         data.
       - A CLOSED THING LOOKS CLOSED: the render opens completed
         records on this face (status, hours, amount, photos),
         with Edit a secondary action below it — never the form
         first (see the render + history wiring). */
  /* Stamp the close facts onto a closed record (returns a copy;
     the input is not mutated). plan is the dspCompletionPlan the
     close logged with — its entry amount is the day's money, the
     same number Revenue received. Fill-only for ticket # /
     material: a value already on the record (typed by the
     driver) always wins over a mined one. The day amount is the
     plan's, because the plan is what the close actually logged;
     with no entry (nothing earned) the record's amount stands. */
  function dspApplyCloseFacts(d, plan) {
    if (!d) return d;
    var out = {};
    for (var k in d) { if (Object.prototype.hasOwnProperty.call(d, k)) out[k] = d[k]; }
    var mined = dspTicketFacts(out.tickets);
    var planNo = '';
    if (plan && plan.entry && plan.entry.ticketNos && plan.entry.ticketNos.length) {
      planNo = String(plan.entry.ticketNos[0]);
    }
    var no = planNo || mined.ticketNo;
    if (no && !String(out.ticketNo || '').trim()) out.ticketNo = no;
    if (mined.material && !String(out.material || '').trim()) out.material = mined.material;
    if (plan && plan.entry && parseFloat(plan.entry.amount) > 0) {
      out.amount = String(plan.entry.amount);
    }
    /* the same facts land on each ticket that lacks its own —
       a ticket is the record's evidence; it carries its number. */
    if (out.tickets && out.tickets.length) {
      var tk = out.tickets.slice(), tkChanged = false;
      for (var i = 0; i < tk.length; i++) {
        var t = tk[i];
        if (!t) continue;
        var tf = dspTicketFacts([t]);
        if (!tf.ticketNo && !tf.material) continue;
        var tc = null;
        if (tf.ticketNo && !t.cardNumber && !t.ticketNo) { tc = tc || {}; tc.ticketNo = tf.ticketNo; }
        if (tf.material && !t.material) { tc = tc || {}; tc.material = tf.material; }
        if (tc) {
          for (var q in t) { if (Object.prototype.hasOwnProperty.call(t, q) && !(q in tc)) tc[q] = t[q]; }
          tk[i] = tc; tkChanged = true;
        }
      }
      if (tkChanged) out.tickets = tk;
    }
    return out;
  }
  /* The day's earned, for the completed face — priced by the
     SAME shared per-day builder the manifest and the invoice
     print from (Meticulous.shared.buildRevenueLines over the
     day's Revenue entries + extras at the account rate /
     standard). Never a second math path: without the builder,
     the fallback is the manifest's own legacy fallback (qty ×
     rate, extras added). 0 when the day logged nothing. */
  function dspDayEarned(dateStr) {
    if (!dateStr) return 0;
    /* NB: rev_entries / rev_extras / onboarding are TOP-LEVEL
       store keys (not dsp_ keys) — read them the way
       completionSettings and the manifest do. */
    var entries = App._store.get('rev_entries', []).filter(function (e) { return e && e.date === dateStr; });
    var extras = App._store.get('rev_extras', []).filter(function (e) { return e && e.date === dateStr; });
    var o = App._store.get('onboarding', {});
    var rate = parseFloat(o.ownWageRate) || parseFloat(o.payRate) || 0; // v137: the user's own wage chain (was the universal payRate)
    var std = String(o.payStandard || '').toLowerCase();
    var built = null;
    try {
      if (typeof window !== 'undefined' && window.Meticulous && Meticulous.shared && Meticulous.shared.buildRevenueLines) {
        built = Meticulous.shared.buildRevenueLines(entries, extras, rate, std);
      }
    } catch (e) { built = null; }
    var earned = 0;
    if (built) {
      built.lines.forEach(function (l) { earned += Number(l.amt) || 0; });
      return Math.round(earned * 100) / 100;
    }
    entries.forEach(function (e) {
      if (std === 'hourly') earned += (parseFloat(e.hours) || 0) * rate;
      else if (std === 'miles') earned += (parseFloat(e.miles) || 0) * rate;
      else if (std === 'trip') earned += (parseFloat(e.trips) || 0) * rate;
      else if (std === 'weight') earned += (parseFloat(e.tons) || 0) * rate;
    });
    extras.forEach(function (x) { earned += parseFloat(x.amount) || 0; });
    return Math.round(earned * 100) / 100;
  }
  /* The day's loads for the completed face, from the ONE shared
     loads truth (Meticulous.shared.dayLoads) over the day's
     dispatch records — the same assembly the manifest makes.
     Without the shared helper, only the record-local rungs of
     that ladder (ticket counts, then deliberately recorded
     loads) are honestly available, and they are what shows. */
  function dspDayLoadsFor(dateStr) {
    if (!dateStr) return 0;
    var day = dspGet('list', []).filter(function (x) {
      return x && dspRecordDate(x) === dateStr;
    });
    try {
      if (typeof window !== 'undefined' && window.Meticulous && Meticulous.shared && Meticulous.shared.dayLoads) {
        return Meticulous.shared.dayLoads(dateStr, { dispatches: day }).loads || 0;
      }
    } catch (e) {}
    var tk = 0;
    day.forEach(function (x) {
      (x.tickets || []).forEach(function (t) { var v = parseFloat(t && t.loads); if (v > 0) tk += v; });
    });
    if (tk > 0) return Math.round(tk);
    var rec = 0;
    day.forEach(function (x) { if (x && x.loadsSet) { var v = parseFloat(x.loads); if (v > 0) rec += v; } });
    return rec > 0 ? Math.round(rec) : 0;
  }
  /* Everything the completed face shows, assembled in one place
     — the render paints it, the suites pin it. Every value is a
     READ-TIME derivation (close facts healed from the tickets,
     the day's money from the shared builder, hours from the
     ticket summary): opening the face writes nothing. */
  function dspCompletedFace(d) {
    var facts = dspCloseFactsFor(d);
    var dateStr = dspRecordDate(d) || d.date || '';
    var earned = dspDayEarned(dateStr);
    var sum = null;
    try {
      if (typeof window !== 'undefined' && window.TicketOCR && TicketOCR.summarizeTickets) {
        var o = App._store.get('onboarding', {});
        sum = TicketOCR.summarizeTickets(d.tickets || [], parseFloat(o.travelBonus) || 0);
      }
    } catch (e) { sum = null; }
    var photos = [];
    (d.tickets || []).forEach(function (t) { if (t && t.photo) photos.push(t.photo); });
    if (!photos.length && d.photo) photos.push(d.photo);
    return {
      id: d.id, status: d.status, endedAt: d.endedAt || null,
      jobSite: d.jobSite || d.pickup || '', date: dateStr,
      scheduledAt: d.scheduledAt || '', equipment: d.equipment || '',
      material: facts.material, ticketNo: facts.ticketNo,
      amount: earned > 0 ? earned : (parseFloat(facts.amount) || 0),
      loads: dspDayLoadsFor(dateStr),
      foremanHours: sum ? sum.totalForemanHours : 0,
      travelHours: sum ? sum.travelBonus : 0,
      totalHours: sum ? sum.totalPaidHours : 0,
      netWeight: sum ? sum.totalNetWeight : 0,
      notes: d.notes || '', photos: photos
    };
  }
  /* ================= DSP-COMPLETED-END ================= */

  function fbSave(doc) {
    if (window.FB && FB.saveDoc) { try { FB.saveDoc('dispatches', doc.id, doc); } catch (e) {} }
  }
  function manifestFeedPush(kind, summaryText) {
    try {
      var feed = App._store.get('manifest_feed', []);
      feed.push({ ts: Date.now(), date: App._today(), kind: kind, summary: summaryText });
      App._store.set('manifest_feed', feed.slice(-500));
    } catch (e) {}
  }
  function fmtTime(ts) {
    try { return new Date(ts).toLocaleString('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  /* v66: 'YYYY-MM-DD' -> 'Tue, Oct 13' (parsed as a LOCAL date —
     never through the UTC-shifting Date(string) path). */
  function fmtDay(iso) {
    var p = String(iso || '').split('-');
    if (p.length !== 3) return String(iso || '');
    try { return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }); }
    catch (e) { return String(iso || ''); }
  }
  /* v82: the relative day word for a date, computed FRESH against
     today at render time. Suggestion cards used to print the word
     baked in when the message was parsed (f.timeLabel): a message
     read on Oct 14 said "Tomorrow" for the Oct 15 dispatch, and on
     Oct 15 the card STILL said "Tomorrow 8:00am" for that day's own
     dispatch (BUGS.md, Oct 15 07:07). The stored scheduledAt /
     segmentDate is the truth; the word is derived, never stored. */
  function dspRelDay(isoDate, today) {
    if (!isoDate || !today) return '';
    if (isoDate === today) return 'Today';
    var p = String(isoDate).split('-'), t = String(today).split('-');
    if (p.length !== 3 || t.length !== 3) return fmtDay(isoDate);
    var diff = Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(+t[0], +t[1] - 1, +t[2])) / 86400000);
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    return fmtDay(isoDate);
  }
  /* v82: the clock for a suggestion card — the part after '·' in
     the ingest timeLabel when it carried one, else the scheduledAt
     time, rendered like the ingest labels ('8:00am'). */
  function dspClockLabel(f) {
    f = f || {};
    if (f.timeLabel) {
      var i = String(f.timeLabel).indexOf('·');
      if (i !== -1) { var c = String(f.timeLabel).slice(i + 1).trim(); if (c) return c; }
    }
    var m = /T(\d{1,2}):(\d{2})/.exec(f.scheduledAt || '');
    if (m) {
      var h = parseInt(m[1], 10), ap = h >= 12 ? 'pm' : 'am';
      h = h % 12 || 12;
      return h + ':' + m[2] + ap;
    }
    return '';
  }

  /* v65: dispatch INGESTION — a one-shot note for the "📩 Suggested
     dispatches" card (set by an intake action or the share drain,
     shown once by paintIngest inside render, then cleared). All
     ingestion state/logic lives in js/dispatch-ingest.js
     (window.DispatchIngest): suggestions are dsp_suggest entries —
     never dispatches — and "Use" loads one into the form via
     dsp_draft, so the verified Save below remains the only way a
     dispatch record is ever created. */
  var ingestFlash = '';
  /* v76 (owner field report, Oct 14 19:22): a Use REFUSAL must be
     visible AT THE TAP — ingestTopFlash renders at the top of the
     suggestions card, beside the Use buttons (ingestFlash renders at
     the card's bottom, by the paste box, where a man who just tapped
     Use at the top never looks). And a Use SUCCESS names what it
     loaded in the form's own banner (usedSugNote, consumed once by
     restoreDraft) — the suggestion vanishing from the list was the
     only sign the tap worked, and it was not enough. */
  var ingestTopFlash = '';
  var usedSugNote = '';
  /* v103: the history Delete confirm is IN-APP (the connect.js
     two-step pattern), never the native dialog — the native
     dialog is auto-dismissed by browser automation, which made
     record deletion unverifiable and, from the driver's seat,
     indistinguishable from a dead button (field defect, Oct 16,
     2026 evening). pendingDelId holds the id of the record whose
     row is showing its Delete/Cancel strip; null = no confirm
     open. Matched by id, not row index, so a list change between
     arm and confirm can never delete the wrong record. */
  var pendingDelId = null;
  /* v129: the COMPLETED FACE's open record (see DSP-COMPLETED).
     Opening a completed dispatch lands on its read-complete
     summary — this id is that view's only state; null = closed. */
  var viewCompletedId = null;
  var dspBody = null; // v116: last render target, for api.back's re-render

  /* ================= DSP-PIPE-BEGIN =================
     v132: THE PIPE on this screen (engine: js/connectpipe.js).
     BOSS faces (office + owner-operator) gain the board — every
     connected driver's day for today, aggregated by itself from
     the shared day records and priced HERE with this account's
     own rates (the ticket's double duty: revenue at his client
     rate, wages at his pay rate for that driver) — plus the
     compose card that sends a dispatch DOWN into a connected
     driver's app. A pure DRIVER gains no surface at all: his day
     publishes by itself, and what his boss sends lands in his own
     list below like any dispatch (with a one-line arrival note).
     State here is session-only paint state; the records are the
     engine's. */
  var pipeDays = null;    // last fetchCrew(today) — null = loading
  var pipeSent = null;    // last listSent()
  var pipeFlash = '';     // one-shot arrival note (driver side)
  var pipeSendMsg = '';   // one-shot line inside the send card

  function pipeMoney(v) { return (v === null || v === undefined) ? '—' : '$' + Number(v).toFixed(2); }
  function pipeTicks(s) {
    if (!s) return '';
    if (s.status === 'seen') return '<span style="color:#1a73e8">✓✓ Seen</span>';
    if (s.status === 'delivered') return '✓✓ Delivered';
    return '✓ Sent';
  }
  function crewDayHtml(day) {
    var pricing = ConnectPipe.pricingFor(day.driver);
    var priced = ConnectPipe.priceDay(day, pricing);
    var ses = day.session || {};
    var state = ses.active ? '<b style="color:var(--orange)">● Working now</b>'
      : (ses.hours > 0 ? '<b>Day done</b>' : '<b>Not started</b>');
    var h = '<div class="listitem"><div class="a">' + esc(day.driverName || 'Driver') + ' — ' + state + '</div>' +
      '<div class="b">' +
      (ses.hours > 0 ? dspFmtH(ses.hours) + ' h on the clock' : 'no hours yet') +
      (day.loads > 0 ? ' · ' + day.loads + ' loads' : '') +
      (day.ticketsClosed > 0 ? ' · ' + day.ticketsClosed + ' ticket' + (day.ticketsClosed === 1 ? '' : 's') + ' closed' : ' · no tickets closed yet') +
      '</div>';
    priced.rows.forEach(function (r) {
      var sd = r.dispatch, pr = r.price;
      h += '<div class="kv"><span>' + esc(sd.jobSite || 'Dispatch') +
        (sd.ticketNo ? ' · #' + esc(sd.ticketNo) : '') +
        (sd.origin === 'driver'
          ? ' · declared by the driver' + (sd.sourceLabel ? ' (' + esc(sd.sourceLabel) + ')' : '')
          : ' · sent by you') +
        '</span><b>' + (sd.status === 'completed' ? 'Closed' : esc(sd.status || '')) + '</b></div>';
      if (sd.status === 'completed') {
        /* the ticket's double duty, priced on THIS side only */
        h += '<div class="kv"><span style="padding-left:14px">Hours — ' + dspFmtH(sd.foremanHours) + ' foreman' +
          (sd.travelHours > 0 ? ' + ' + dspFmtH(sd.travelHours) + ' travel' : '') + '</span><b></b></div>' +
          '<div class="kv"><span style="padding-left:14px">↳ Revenue (your client rate)</span><b>' + pipeMoney(pr.revenue) + '</b></div>' +
          '<div class="kv"><span style="padding-left:14px">↳ His pay (foreman + travel, your rate for him)</span><b>' + pipeMoney(pr.wage) + '</b></div>';
      }
    });
    h += '<div class="kv"><span><b>Day revenue</b></span><b>' + pipeMoney(priced.revenue) + '</b></div>' +
      '<div class="kv"><span><b>Day wages</b></span><b>' + pipeMoney(priced.wage) + '</b></div>' +
      (priced.margin !== null ? '<div class="kv"><span><b>Margin</b></span><b>' + pipeMoney(priced.margin) + '</b></div>' : '') +
      (!pricing.wage
        ? '<div style="margin-top:6px"><button class="btn small navy" data-pipesetpay="' + esc(day.driver) + '" data-pipename="' + esc(day.driverName || '') + '">Set his pay rate</button></div>'
        : '') +
      (pricing.clientRate > 0 ? '' : '<div class="b" style="margin-top:4px">Revenue is not priced yet — set your client rate in Preferences.</div>') +
      '</div>';
    return h;
  }
  function crewHtml() {
    if (!window.ConnectPipe) return '';
    if (!ConnectPipe.connectedPeers().length) {
      return '<div class="empty">No connected drivers yet. Connect in the Connect screen — when a driver accepts, his day shows up here by itself.</div>';
    }
    if (pipeDays === null) return '<p class="note">Loading your crew…</p>';
    if (!pipeDays.length) return '<div class="empty">Nothing from your crew yet today. When a connected driver works, his day appears here on its own.</div>';
    return pipeDays.map(crewDayHtml).join('');
  }
  function sentHtml() {
    if (!pipeSent || !pipeSent.length) return '';
    var h = '<div style="margin-top:10px;font-weight:700">Sent by you</div>';
    pipeSent.slice(0, 10).forEach(function (s) {
      h += '<div class="kv"><span>' + esc(s.jobSite || 'Dispatch') + ' · ' + esc(s.date || '') + '</span><b>' + pipeTicks(s) + '</b></div>';
    });
    return h;
  }
  function sendHtml() {
    var peers = ConnectPipe.connectedPeers();
    if (!peers.length) {
      return '<p class="note">Connect a driver first (Connect screen) — then a dispatch you send lands straight in his app, as his scheduled job for that day.</p>';
    }
    var today = ''; try { today = App._today(); } catch (e) {}
    var tom = today; try { tom = ConnectPipe.dateShift(today, 1); } catch (e) {}
    return '<label class="f">Driver</label><select id="dp_send_to">' +
      peers.map(function (c) { return '<option value="' + esc(c.uid) + '">' + esc(c.name) + '</option>'; }).join('') + '</select>' +
      '<div class="row"><div><label class="f">Date</label><input type="date" id="dp_send_date" value="' + esc(tom) + '"></div>' +
      '<div><label class="f">Start time</label><input type="time" id="dp_send_time" value="08:00"></div></div>' +
      '<label class="f">Job site</label><input id="dp_send_site" placeholder="e.g. Maple Ridge">' +
      '<div class="row"><div><label class="f">Material</label><input id="dp_send_mat" placeholder="Optional"></div>' +
      '<div><label class="f">Truck / equipment</label><input id="dp_send_eq" placeholder="Optional"></div></div>' +
      '<label class="f">Notes</label><input id="dp_send_notes" placeholder="Optional">' +
      (pipeSendMsg ? '<p class="note" style="color:#2e7d32;font-weight:600;margin-top:6px">' + esc(pipeSendMsg) + '</p>' : '') +
      '<button class="btn primary" id="dp_send_btn" style="margin-top:8px">📤 Send dispatch</button>' +
      '<div id="dp_sentlist">' + sentHtml() + '</div>';
  }
  function wirePipe(body) {
    body.querySelectorAll('[data-pipesetpay]').forEach(function (b) {
      b.onclick = function () {
        try {
          window.__mtPnlPrefillDriver = {
            uid: b.getAttribute('data-pipesetpay'),
            name: b.getAttribute('data-pipename') || ''
          };
        } catch (e) {}
        if (window.App && App.openModule) App.openModule('pnl');
      };
    });
    var sendBtn = body.querySelector('#dp_send_btn');
    if (sendBtn) sendBtn.onclick = function () {
      var to = body.querySelector('#dp_send_to');
      var date = (body.querySelector('#dp_send_date') || {}).value || '';
      var time = (body.querySelector('#dp_send_time') || {}).value || '';
      var site = (body.querySelector('#dp_send_site') || {}).value || '';
      site = String(site).trim();
      if (!to || !to.value || !date || !site) {
        pipeSendMsg = 'Pick the driver, the date, and the job site first — nothing was sent.';
        var w = body.querySelector('#dp_send'); if (w) { w.innerHTML = sendHtml(); wirePipe(body); }
        return;
      }
      sendBtn.disabled = true; sendBtn.textContent = 'Sending…';
      ConnectPipe.sendDispatch(to.value, {
        date: date, scheduledAt: dspComposeSched(date, time, date),
        jobSite: site,
        material: (body.querySelector('#dp_send_mat') || {}).value || '',
        equipment: (body.querySelector('#dp_send_eq') || {}).value || '',
        notes: (body.querySelector('#dp_send_notes') || {}).value || ''
      }).then(function (r) {
        pipeSendMsg = r === 'sent'
          ? 'Sent ✓ — it lands in his Dispatch as his scheduled job for that day.'
          : 'Could not send — check your connection and try again.';
        var w = body.querySelector('#dp_send'); if (w) { w.innerHTML = sendHtml(); wirePipe(body); }
        ConnectPipe.listSent().then(function (sent) {
          pipeSent = sent;
          var w2 = body.querySelector('#dp_sentlist'); if (w2) w2.innerHTML = sentHtml();
        });
      });
    };
  }
  /* ================= DSP-PIPE-END ================= */

  /* Downscale a photo so it fits localStorage: max 640px, JPEG 0.7. */
  function fileToThumb(file, cb) {
    var r = new FileReader();
    r.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 640, w = img.width, h = img.height;
        if (w > max || h > max) {
          var s = Math.min(max / w, max / h);
          w = Math.round(w * s); h = Math.round(h * s);
        }
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(c.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = function () { cb(r.result); };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  }

  /* v35: OCR needs resolution — a full-page rate confirmation / BOL at
     the 640px storage size is unreadable. OCR runs on a larger rendition
     (max 1600px); only the small thumb is stored on the ticket. */
  function fileToOCRImage(file, cb) {
    var r = new FileReader();
    r.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1600, w = img.width, h = img.height;
        if (w > max || h > max) {
          var s = Math.min(max / w, max / h);
          w = Math.round(w * s); h = Math.round(h * s);
        }
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { cb(null); };
      img.src = r.result;
    };
    r.onerror = function () { cb(null); };
    r.readAsDataURL(file);
  }

  /* DSP-SCROLL-BEGIN — v75: after an Edit tap the form must COME
     TO the user (owner video, Oct 14: Edit loaded the form at the
     top of the module but nothing scrolled to it, so the tap read
     as "nothing happens" — the LOOK TWICE rule). A single
     scrollIntoView right after the re-render was already there and
     was not enough on the phone: the ingest card paints after the
     render and ticket photos decode late, both shifting layout
     after the one scroll. So: scroll to the FORM CARD now, again
     on the next frame, and once more shortly after — the last
     layout settles with the form in view. scrollIntoView is the
     only mechanism (a WebView has no window.scrollTo target for a
     module body); every attempt is guarded. */
  function dspScrollToForm(body) {
    function go() {
      try {
        var el = body.querySelector('#dp_form_card') || body.querySelector('#dp_site');
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
      } catch (e) {}
    }
    go();
    try { if (window.requestAnimationFrame) window.requestAnimationFrame(go); } catch (e) {}
    setTimeout(go, 350);
  }
  /* DSP-SCROLL-END */

  /* v129: the completed face gets the same come-to-the-user
     treatment as the form (v75) — a View tap that renders the
     summary at the top of the module but never scrolls to it
     would read as "nothing happens". */
  function dspScrollToCompleted(body) {
    function go() {
      try {
        var el = body.querySelector('#dp_completed_card');
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
      } catch (e) {}
    }
    go();
    try { if (window.requestAnimationFrame) window.requestAnimationFrame(go); } catch (e) {}
    setTimeout(go, 350);
  }

  /* ================= DSP-ACTIVATE-BEGIN =================
     v91: THE one activation path. Flipping a saved dispatch to
     active is exactly these writes — status + startedAt on the
     record in the list, the list write, dsp_active, the cloud
     mirror, and the same "Dispatch started" notification the
     Start button has always sent. NOTHING else: no revenue
     record, no tracker session (pay stays ticket-based and the
     session machinery belongs to the autostart plan, which reads
     dsp_active itself). The Start button and the yard-departure
     watcher (js/yardstart.js, via api.activateById) both come
     through here, so an automatic activation can never drift
     from what a manual Start produces. Only a 'saved' record can
     be activated — the same records the Start button is offered
     on. Extracted verbatim by tools/yard-start-test.js. */
  function dspActivateRecord(d) {
    if (!d || d.status !== 'saved') return false;
    var l = list(), idx = -1, i;
    for (i = 0; i < l.length; i++) if (l[i] && l[i].id === d.id) { idx = i; break; }
    if (idx === -1) return false;
    d.status = 'active'; d.startedAt = Date.now();
    l[idx] = d;
    W('list', l); W('active', d); fbSave(d);
    if (window.FB && FB.localNotify) { try { FB.localNotify('Dispatch started', d.jobSite || ''); } catch (e) {} }
    return true;
  }
  function dspActivateById(id) {
    if (!id) return false;
    var l = list();
    for (var i = 0; i < l.length; i++) {
      if (l[i] && l[i].id === id) return dspActivateRecord(l[i]);
    }
    return false;
  }
  /* ================= DSP-ACTIVATE-END ================= */

  var api = {
    /* v78: the card preview — ONE live fact in priority order: the
       ACTIVE dispatch, else today's saved dispatch, else the next
       upcoming one (with its day), else the history count. */
    status: function () {
      var a = active();
      if (a) return 'Active: ' + dspCardLabel(a);
      var l = list(), i, d, rd;
      var today = '';
      try { today = App._today(); } catch (e) {}
      if (today) {
        for (i = 0; i < l.length; i++) {
          d = l[i];
          if (d && dspRecordDate(d) === today && d.status !== 'completed' && d.status !== 'cancelled') {
            return 'Today: ' + dspCardLabel(d);
          }
        }
        var next = null, nextDate = '';
        for (i = 0; i < l.length; i++) {
          d = l[i];
          if (!d) continue;
          rd = dspRecordDate(d);
          if (rd && rd > today && d.status !== 'completed' && d.status !== 'cancelled' &&
              (!nextDate || rd < nextDate)) { next = d; nextDate = rd; }
        }
        if (next) return dspCardLabel(next) + ' · ' + dspDayShort(nextDate);
      }
      /* v132: a boss's home card leads with his crew (the pipe's
         last fetch for today), not his own empty dispatch list. */
      try {
        if (today && window.ConnectPipe && ConnectPipe._crewCache &&
            ConnectPipe._crewCache.date === today && ConnectPipe._crewCache.days.length &&
            (App.userRole ? App.userRole() : 'driver') !== 'driver') {
          var cw = 0, ch = 0, cl = 0;
          ConnectPipe._crewCache.days.forEach(function (dy) {
            if (dy.session && dy.session.active) cw++;
            ch += (dy.session && dy.session.hours) || 0;
            cl += dy.loads || 0;
          });
          return 'Crew today: ' + cw + ' working · ' + (Math.round(ch * 10) / 10) + ' h · ' + cl + ' loads';
        }
      } catch (e) {}
      var done = l.filter(function (x) { return x.status === 'completed'; }).length;
      return done ? done + ' completed' : (l.length ? l.length + ' saved' : 'No dispatch today');
    },
    getActive: function () { return active(); },
    /* v91: yard-departure activation (js/yardstart.js) — the
       manual Start below routes through the same path. */
    activateById: function (id) { return dspActivateById(id); },
    /* v116: shell back contract. This module's one screen IS its
       main view (form + active card + history together); its
       transient sub-states are the armed delete confirm and
       (v129) the open completed face, and Back closes either
       instead of leaving the module. The form DRAFT —
       including an in-progress edit (draft.editId) — is NOT a
       sub-view: it is saved user work (v48: never lose a dispatch
       form; v56: an edit stays an edit across reloads), so fresh
       entry restores it by design and there is deliberately no
       resetView here. */
    back: function () {
      if (viewCompletedId !== null && viewCompletedId !== undefined) {
        viewCompletedId = null;
        if (dspBody) api.render(dspBody);
        return true;
      }
      if (pendingDelId === null || pendingDelId === undefined) return false;
      pendingDelId = null;
      if (dspBody) api.render(dspBody);
      return true;
    },
    render: function (body) {
      dspBody = body;
      var a = active();
      /* v76 (F3, boss QA Oct 14): the OFFICE face. An office-only user
         (the boss) composes dispatches at a desk: nothing he saves
         "starts" — no started semantics, no session implication (the
         engine already hard-returns 'office'; this is the wording
         catching up with the fact). His Save is a plain Save, his
         records read as saved-on-this-device, and one honest line
         points at the pipe card that does the sending (v132). */
      var isOffice = (App.userRole ? App.userRole() : 'driver') === 'office';
      /* v56: the form's draft is resolved BEFORE the HTML is built —
         a draft carrying editId means the form opens in EDIT mode for
         that record (title, single "Save changes" button). If the
         record was deleted elsewhere since the edit began, the edit
         draft is safely DISCARDED (never resurrected as a new
         dispatch) and a note says so. */
      var draft0 = dspLoadDraft();
      var editRec = null, editGone = false;
      if (draft0 && draft0.editId) {
        editRec = dspFindRecord(draft0.editId);
        if (!editRec) { dspClearDraft(); draft0 = null; editGone = true; }
      }
      var editingId = editRec ? editRec.id : null;
      /* v52: optional driver picker — only when the account keeps P&L
         drivers. It is how a dispatch "identifies a driver", which the
         travel-bonus routing needs when an office user completes the
         dispatch (the travel hours become that driver's wage claim). */
      /* v65: drain any "Share → Meticulous" messages into suggestions
         (the inbox empties, so this fires once per share) and carry a
         one-line note if a share didn't read as a dispatch. */
      try {
        if (window.DispatchIngest) {
          var dr65 = DispatchIngest.drainShareInbox();
          if (dr65 && dr65.failed > 0 && !ingestFlash) {
            ingestFlash = 'A shared message didn\'t look like a dispatch — nothing was added from it.';
          }
        }
      } catch (e) {}
      var drvList = App._store.get('pnl_drivers', []) || [];
      var drvField = '';
      if (drvList.length) {
        drvField = '<label class="f">Driver <span style="font-weight:normal;color:var(--muted)">(optional — who ran this job)</span></label>' +
          '<select id="dp_driver"><option value="">— Not set —</option>' +
          drvList.map(function (d) { return '<option value="' + esc(d.id) + '">' + esc(d.name) + '</option>'; }).join('') + '</select>';
      }
      var h = '';

      /* v132: a dispatch that arrived down the pipe gets ONE line
         at the top of the driver's own screen — then it is simply
         his dispatch, in his list, like any other. */
      if (pipeFlash) {
        h += '<div class="card" style="border:2px solid var(--green)"><b>' + esc(pipeFlash) + '</b></div>';
        pipeFlash = '';
      }

      /* ---- Active dispatch card ---- */
      if (a) {
        h += '<div class="card" style="border:2px solid var(--orange)"><h3>🚛 Active dispatch</h3>' +
          (isOffice
            ? '<div class="kv"><span>Status</span><b>Saved on this device</b></div>'
            : '<div class="kv"><span>Status</span><b style="color:var(--orange)">● In progress</b></div>') +
          '<div class="kv"><span>Job site</span><b>' + esc(a.jobSite || a.pickup || '—') + '</b></div>' +
          (a.dropoff ? '<div class="kv"><span>Drop-off</span><b>' + esc(a.dropoff) + '</b></div>' : '') +
          (a.material ? '<div class="kv"><span>Material</span><b>' + esc(a.material) + '</b></div>' : '') +
          (a.ticketNo ? '<div class="kv"><span>Ticket #</span><b>' + esc(a.ticketNo) + '</b></div>' : '') +
          (a.amount ? '<div class="kv"><span>Amount</span><b>$' + esc(a.amount) + '</b></div>' : '') +
          (a.notes ? '<div class="kv"><span>Notes</span><b>' + esc(a.notes) + '</b></div>' : '') +
          (isOffice ? '' : '<div class="kv"><span>Started</span><b>' + esc(fmtTime(a.startedAt)) + '</b></div>') +
          (dspPhotoFor(a) ? '<img src="' + dspPhotoFor(a) + '" style="width:100%;border-radius:10px;margin-top:8px" alt="Ticket photo">' : '') +
          '<div id="dp_close_note"></div>' +
          /* v124 (owner, Oct 17 07:47 — "why are they so mismatched,
             why is it not consistent"): ONE primary on this card —
             Close with ticket photo, his daily close path, full
             width. The old row put four .btn (each width:100% by
             the global rule) in one .row whose align-items:center
             let every button keep its own wrapped height: a big
             orange block, a TALLER navy block, two small pale
             ones. The rest are now ONE uniform secondary row —
             same height, same radius, same quiet styling. The
             handlers and the v52 completion routing are untouched;
             this is presentation only. */
          '<button class="btn primary big" id="dp_close_ticket" style="margin-top:10px">📸 Close with ticket photo</button>' +
          '<div class="row dsp-actions">' +
          '<button class="btn ghost small" id="dp_complete">✅ Complete dispatch</button>' +
          '<button class="btn ghost small" id="dp_edit_active">✏️ Edit</button>' +
          '<button class="btn ghost small" id="dp_cancel">Cancel</button></div>' +
          '<div id="dp_closeflow"></div></div>';
      }

      /* ---- v129: the COMPLETED FACE ----
         Opening a completed dispatch lands HERE — a read-complete
         summary (status + when, site, date, truck, the healed
         close facts, the day's hours, the amount the shared
         builder prices the day at, the ticket photos, the notes),
         never the edit form. Edit is a secondary action at the
         bottom of the face ("✏️ Edit this record"). The values
         come from dspCompletedFace — read-time derivations, so a
         record closed before the close wrote its facts still
         opens complete, and opening this face writes nothing. */
      var viewRec = viewCompletedId ? dspFindRecord(viewCompletedId) : null;
      if (viewRec && viewRec.status !== 'completed') { viewRec = null; viewCompletedId = null; }
      if (viewRec && editingId === viewRec.id) { viewRec = null; viewCompletedId = null; } // the open edit form is its one presence (v117)
      if (viewRec) {
        var face = dspCompletedFace(viewRec);
        h += '<div class="card" id="dp_completed_card" style="border:2px solid var(--green)"><h3>✅ Completed dispatch</h3>' +
          '<div class="kv"><span>Status</span><b>Completed' + (face.endedAt ? ' · ' + esc(fmtTime(face.endedAt)) : '') + '</b></div>' +
          '<div class="kv"><span>Job site</span><b>' + esc(face.jobSite || '—') + '</b></div>' +
          (face.date ? '<div class="kv"><span>Date</span><b>' + esc(fmtDay(face.date)) + '</b></div>' : '') +
          (face.equipment ? '<div class="kv"><span>Truck</span><b>' + esc(face.equipment) + '</b></div>' : '') +
          (face.material ? '<div class="kv"><span>Material</span><b>' + esc(face.material) + '</b></div>' : '') +
          (face.ticketNo ? '<div class="kv"><span>Ticket #</span><b>' + esc(face.ticketNo) + '</b></div>' : '') +
          (face.foremanHours > 0 ?
            '<div class="kv"><span>Foreman hours</span><b>' + dspFmtH(face.foremanHours) + ' h</b></div>' +
            '<div class="kv"><span>Travel</span><b>' + dspFmtH(face.travelHours) + ' h</b></div>' +
            '<div class="kv"><span>Total hours</span><b>' + dspFmtH(face.totalHours) + ' h</b></div>' : '') +
          (face.netWeight > 0 ? '<div class="kv"><span>Net weight</span><b>' + esc(String(face.netWeight)) + ' t</b></div>' : '') +
          (face.loads > 0 ? '<div class="kv"><span>Loads</span><b>' + face.loads + '</b></div>' : '') +
          '<div class="kv"><span>Amount earned</span><b>$' + face.amount.toFixed(2) + '</b></div>' +
          (face.notes ? '<div class="kv"><span>Notes</span><b>' + esc(face.notes) + '</b></div>' : '') +
          face.photos.map(function (p) { return '<img src="' + p + '" style="width:100%;border-radius:10px;margin-top:8px" alt="Ticket photo">'; }).join('') +
          '<div class="row" style="margin-top:10px">' +
          '<button class="btn ghost small" id="dp_view_edit">✏️ Edit this record</button>' +
          '<button class="btn ghost small" id="dp_view_done">Done</button></div></div>';
      }

      /* ---- v65: 📩 Suggested dispatches + "Add from a message" ----
           Filled and wired by paintIngest() at the end of render. When
           there are no suggestions the card is just the quiet paste
           box; suggestions never touch the form until "Use". */
      h += '<div id="dp_ingest"></div>';

      /* ---- v132: THE PIPE — crew board + send (boss faces) ----
         Office + owner-operator only. The board aggregates each
         connected driver's TODAY from the shared day records; the
         send card delivers a dispatch down the pipe. Both paint
         async into their containers (wiring at render end). */
      if ((App.userRole ? App.userRole() : 'driver') !== 'driver' && window.ConnectPipe) {
        h += '<div class="card"><h3>👥 Crew today</h3><div id="dp_crew">' + crewHtml() + '</div></div>';
        h += '<div class="card"><h3>📤 Send a dispatch</h3><div id="dp_send">' + sendHtml() + '</div></div>';
      }

      /* ---- New dispatch form (v56: the same form is the EDIT form
           when editingId is set — one form, prefilled either way) ---- */
      h += '<div class="card" id="dp_form_card"><h3>' + (editingId ? '✏️ Edit dispatch' : '＋ New dispatch') + '</h3>' +
        '<div id="dp_draft_note"></div>' +
        '<div id="dp_draft_warn"></div>' +
        '<div id="dp_save_err"></div>' +
        /* v129: the form SAYS the edit-safety rule out loud when
           the record being edited is completed — its close facts
           are protected (see dspApplyEdit), and the driver should
           not have to guess what a cleared field would do. */
        (editRec && editRec.status === 'completed' ?
          '<div class="note" style="border:2px solid var(--orange);border-radius:10px;padding:8px 10px;margin:6px 0 10px;">This dispatch is <b>completed</b>. Its ticket #, material and amount are the day\'s close facts — leave a field as it is to keep it; clearing one will not erase what the close recorded.</div>' : '') +
        '<label class="f">Job site</label><input id="dp_site" placeholder="e.g. Aecon — Deerfoot site">' +
        '<div class="row"><div><label class="f">Scheduled date</label><input id="dp_date" type="date"></div>' +
        '<div><label class="f">Start time</label><input id="dp_time" type="time"></div></div>' +
        '<label class="f">Truck type</label><input id="dp_equip" placeholder="e.g. Tandem">' +
        '<div id="dp_active_note"></div>' +
        '<div id="dp_pin" style="font-size:13px;margin:2px 0 6px;"></div>' +
        '<input type="hidden" id="dp_lat"><input type="hidden" id="dp_lng">' +
        '<div class="row"><div><label class="f">Material</label><input id="dp_mat" placeholder="e.g. Gravel"></div>' +
        '<div><label class="f">Ticket #</label><input id="dp_ticket" placeholder="e.g. 48213"></div></div>' +
        '<div class="row"><div><label class="f">Amount $ (optional)</label><input id="dp_amt" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"></div>' +
        '<div><label class="f">Loads</label><input id="dp_loads" type="number" min="1" step="1" value="1"></div></div>' +
        /* v107: whether the Loads value was DELIBERATELY set (typed
           by the driver, restored from a draft that recorded it, or
           carried from the record being edited) — the marker the
           shared dayLoads truth checks before trusting the record.
           Set by the field's own input listener and by the fill
           paths; a programmatic fill never fires it. */
        '<input type="hidden" id="dp_loadsset" value="">' +
        '<label class="f">Notes</label><input id="dp_notes" placeholder="Gate code, contact…">' +
        drvField +
        '<label class="f">🎫 Tickets <span style="font-weight:normal;color:var(--muted)">(add one per haul card / scale ticket)</span></label>' +
        '<div id="dp_ticketlist"></div>' +
        '<div style="display:flex;gap:10px;margin-bottom:8px;">' +
        '<button type="button" class="btn secondary" id="dp_cam" style="flex:1;">📷 Take ticket photo</button>' +
        '<button type="button" class="btn secondary" id="dp_pick" style="flex:1;">📁 Choose ticket file</button>' +
        '</div>' +
        '<input type="file" id="dp_img_cam" accept="image/*" capture="environment" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<input type="file" id="dp_img" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<div id="dp_img_name" style="font-size:12px;color:var(--muted);margin-bottom:8px;">No tickets yet — add the first one above.</div>' +
        '<div id="dp_ocr_prompt"></div>' +
        '<div id="dp_preview"></div>' +
        (editingId ?
          /* v124: the same unification as the active card — Save
             changes is the ONE primary (full width); Cancel edit
             is a quiet full-width ghost under it, same 52px height
             as every stacked form button. They used to share a
             .row, a loud primary shoulder-to-shoulder with a
             ghost at equal width. */
          '<button class="btn primary" id="dp_saveedit" style="margin-top:10px">💾 Save changes</button>' +
          '<button class="btn ghost" id="dp_canceledit">Cancel edit</button></div>' :
          isOffice ?
            /* v76 (F3): office Save is a PLAIN Save — no "& start",
               no started semantics; the honest line sits with it
               (a line in the view, never a banner card).
               v132: the line now points at the real door — saving
               here is still this device's own record; SENDING to a
               connected driver happens in the pipe card above. */
            '<div class="row" style="margin-top:10px"><button class="btn primary" id="dp_add">Save</button></div>' +
            '<p class="note" style="margin-top:8px">Saving here keeps the dispatch on this device. To send one to a connected driver, use “📤 Send a dispatch” above — it lands in his app.</p></div>' :
            '<div class="row" style="margin-top:10px"><button class="btn primary" id="dp_add">Save dispatch</button>' +
            '<button class="btn navy" id="dp_addstart">Save & start</button></div></div>');

      /* ---- History ---- */
      var hist = list().slice().reverse();
      /* v117 (owner, Oct 16 2026: "Why is it showing me on 2
         cards?"): while a dispatch is being edited, its History
         card is NOT rendered — the open edit form IS that record's
         one presence on the page. The card returns on its own
         when the edit closes (Save changes / Cancel edit clear
         the edit and re-render). The v75 "you're editing this
         one" marker card is superseded by this rule. */
      var histShown = [];
      hist.forEach(function (d, ri) {
        if (editingId && d.id === editingId) return; // v117: the form is its one presence
        histShown.push({ d: d, i: hist.length - 1 - ri });
      });
      h += '<div class="card"><h3>📋 History</h3>' +
        (histShown.length ? histShown.map(function (it) {
          var d = it.d, i = it.i;
          var st = d.status === 'completed' ? '<span class="pill">completed</span>' :
                   d.status === 'cancelled' ? '<span class="pill">cancelled</span>' : '<span class="pill">saved</span>';
          return '<div class="listitem"><div class="a">' + esc(d.jobSite || d.pickup || 'Dispatch') + ' ' + st + '</div>' +
            '<div class="b">' + esc(d.date || '') +
            (d.scheduledAt ? ' · 🕗 ' + esc(String(d.scheduledAt).replace('T', ' ')) : '') +
            (d.equipment ? ' · 🚛 ' + esc(d.equipment) : '') +
            (d.lat !== null && d.lat !== undefined && d.lng !== null && d.lng !== undefined ?
              ' · <a href="https://www.google.com/maps?q=' + d.lat + ',' + d.lng + '" target="_blank" rel="noopener">📍 Map</a>' : '') +
            (d.material ? ' · ' + esc(d.material) : '') +
            (d.ticketNo ? ' · #' + esc(d.ticketNo) : '') +
            (d.amount ? ' · $' + esc(d.amount) : '') +
            (d.notes ? ' · 📝 ' + esc(d.notes) : '') + '</div>' +
            (dspPhotoFor(d) ? '<img src="' + dspPhotoFor(d) + '" style="width:100%;border-radius:8px;margin-top:6px" alt="Ticket">' : '') +
            /* v103: Delete is a two-step IN-APP confirm — the
               armed row swaps its buttons for one clear red
               Delete + Cancel strip (see pendingDelId). */
            (pendingDelId && d.id === pendingDelId ?
              '<div style="margin-top:8px;border:2px solid #c0392b;background:#fdecea;border-radius:10px;padding:8px 10px">' +
              '<b>Delete this dispatch?</b> <span class="b">This cannot be undone.</span>' +
              '<div class="row" style="margin-top:6px">' +
              '<button class="btn small" data-delconfirm="' + i + '" style="background:#c0392b;color:#fff;flex:1">Delete</button>' +
              '<button class="btn small ghost" data-delcancel="1" style="flex:1">Cancel</button></div></div>' :
              '<div class="row" style="margin-top:8px">' +
              (d.status === 'saved' && !isOffice ? '<button class="btn small primary" data-start="' + i + '">Start</button>' : '') +
              /* v129: a completed dispatch opens on its FACE
                 (data-view), never straight into the edit form —
                 Edit lives inside the face as "Edit this record".
                 Open records keep their row Edit as before. */
              (d.status === 'completed' ?
                '<button class="btn small primary" data-view="' + i + '">👁 View</button>' :
                '<button class="btn small ghost" data-edit="' + i + '">✏️ Edit</button>') +
              '<button class="btn small ghost" data-del="' + i + '">Delete</button></div>') + '</div>';
        }).join('') : '<div class="empty">' + (hist.length ? 'No other dispatches yet — the one you are editing is in the form above.' : 'No dispatches yet. Create one above.') + '</div>') + '</div>';

      body.innerHTML = h;

      /* ---- v65: ingestion card (suggestions + paste box) ----
         Rebuilt in place by paintIngest so Dismiss / paste feedback
         never disturb the form; "Use" goes through DispatchIngest.use
         (draft machinery) and then a full render, whose draft restore
         fills the form — the same path a kept draft takes. */
      function ingestHTML() {
        var sug = [];
        try { if (window.DispatchIngest) sug = DispatchIngest.list(); } catch (e) {}
        /* v66: same-day conflicts (two authorities, one day) are
           flagged, never resolved — the human picks. */
        var conf = [];
        try { if (window.DispatchIngest && DispatchIngest.conflicts) conf = DispatchIngest.conflicts(sug); } catch (e) {}
        var confByDate = {};
        conf.forEach(function (c) { confByDate[c.date] = c.count; });
        var h = '<div class="card">';
        /* v76: tap-point feedback for Use renders HERE, beside the
           buttons. v82: hoisted above the suggestions/empty split —
           a successful Use consumes the LAST suggestion, and the
           empty branch never showed the confirmation at all. */
        if (ingestTopFlash) {
          h += '<div style="border:2px solid var(--orange);background:#fdf6e9;border-radius:10px;padding:8px 10px;margin-bottom:8px">' + ingestTopFlash + '</div>';
        }
        if (sug.length) {
          h += '<h3>📩 Suggested dispatches <span class="pill">' + sug.length + '</span></h3>' +
            '<p class="note">From messages you pasted or shared — whoever sent them. Tap <b>Use</b> to put one in the form below. Nothing is saved until you tap Save there.</p>' +
            conf.map(function (c) {
              return '<div style="border:2px solid #b45309;background:#fdf6e9;border-radius:10px;padding:8px 10px;margin-bottom:8px;color:#7c4a03">⚠️ <b>' + c.count + ' dispatches for ' + esc(fmtDay(c.date)) + '</b> — more than one sender dispatched this day. Pick the right one below; nothing is chosen for you.</div>';
            }).join('') +
            sug.map(function (e) {
              var f = e.fields || {};
              var title = f.jobSite || f.destination || 'Dispatch';
              var bits = [];
              var eDate = f.segmentDate || (/^\d{4}-\d{2}-\d{2}/.test(f.scheduledAt || '') ? String(f.scheduledAt).slice(0, 10) : '');
              /* v82: the day word is derived from the suggestion's
                 DATE right now — never the word baked in at ingest
                 (it went stale overnight: "Tomorrow 8:00am" shown
                 for today's own dispatch). */
              if (eDate) {
                var ck = dspClockLabel(f);
                bits.push('🕗 ' + esc(dspRelDay(eDate, App._today()) + (ck ? ' · ' + ck : '')));
              }
              else if (f.timeLabel) bits.push('🕗 ' + esc(f.timeLabel));
              else if (f.scheduledAt) bits.push('🕗 ' + esc(String(f.scheduledAt).replace('T', ' ')));
              if (e.senderHint) bits.push('From: ' + esc(e.senderHint));
              if (f.equipment) bits.push('🚛 ' + esc(f.equipment));
              if (f.type === 'empty') bits.push('Travel empty');
              if (f.type === 'loaded') bits.push('Loaded haul');
              if (f.destination && f.destination !== f.jobSite) bits.push('→ ' + esc(f.destination));
              var raw = String(e.rawText || '');
              if (raw.length > 140) raw = raw.slice(0, 140) + '…';
              return '<div class="listitem"><div style="flex:1"><div class="a">' + esc(title) + '</div>' +
                (bits.length ? '<div class="b">' + bits.join(' · ') + '</div>' : '') +
                (confByDate[eDate] ? '<div class="b" style="color:#b45309">⚠️ One of ' + confByDate[eDate] + ' suggestions for this day — pick one.</div>' : '') +
                (f.notes ? '<div class="b">📝 ' + esc(f.notes) + '</div>' : '') +
                '<div class="b" style="color:var(--muted)">' + esc(raw) + '</div>' +
                '<div class="b" style="color:var(--muted);font-size:11px">From a ' + esc(e.source || 'paste') + '</div></div>' +
                '<div style="display:flex;flex-direction:column;gap:6px">' +
                '<button class="btn small primary" data-suguse="' + esc(e.id) + '">Use</button>' +
                '<button class="btn small ghost" data-sugdismiss="' + esc(e.id) + '">Dismiss</button></div></div>';
            }).join('') +
            '<div style="margin-top:12px">';
        } else {
          h += '<h3>📩 Add from a message</h3><div>';
        }
        h += '<p class="note">Paste a dispatch from a text, email or WhatsApp — whoever sent it. If it reads like a dispatch, it becomes a suggestion for you to confirm.</p>' +
          '<textarea id="dp_paste" rows="3" placeholder="Paste the message here…" style="width:100%"></textarea>' +
          '<div class="row" style="margin-top:6px"><button class="btn secondary" id="dp_paste_btn">Read message</button></div>' +
          (ingestFlash ? '<p class="note" style="margin-top:6px">' + ingestFlash + '</p>' : '') +
          '</div></div>';
        return h;
      }
      function paintIngest() {
        var wrap = body.querySelector('#dp_ingest');
        if (!wrap) return;
        wrap.innerHTML = ingestHTML();
        ingestFlash = '';
        ingestTopFlash = '';
        var pb = wrap.querySelector('#dp_paste_btn');
        if (pb) pb.onclick = function () {
          var ta = wrap.querySelector('#dp_paste');
          var res = null;
          try {
            if (window.DispatchIngest) {
              res = DispatchIngest.intakeBatch
                ? DispatchIngest.intakeBatch(ta ? ta.value : '', 'paste')
                : (DispatchIngest.intake(ta ? ta.value : '', 'paste') ? { added: [1], duplicates: 0 } : { added: [], duplicates: 0 });
            }
          } catch (e) {}
          if (res && res.added.length > 1) {
            ingestFlash = '✓ That message held ' + res.added.length + ' dispatches — each one is in your suggestions above. Tap <b>Use</b> to put one in the form.';
          } else if (res && res.added.length === 1) {
            ingestFlash = '✓ That reads like a dispatch — it is in your suggestions above. Tap <b>Use</b> to put it in the form.';
          } else if (res && res.duplicates > 0) {
            ingestFlash = 'Those dispatches are already in your suggestions above — nothing was added twice.';
          } else {
            ingestFlash = 'That doesn\'t look like a dispatch — nothing was added. You can still type the dispatch in the form below.';
          }
          paintIngest();
        };
        wrap.querySelectorAll('[data-sugdismiss]').forEach(function (b) {
          b.onclick = function () {
            try { if (window.DispatchIngest) DispatchIngest.dismiss(b.getAttribute('data-sugdismiss')); } catch (e) {}
            paintIngest();
          };
        });
        wrap.querySelectorAll('[data-suguse]').forEach(function (b) {
          b.onclick = function () {
            var res = null;
            try { if (window.DispatchIngest) res = DispatchIngest.use(b.getAttribute('data-suguse')); } catch (e) {}
            if (res && res.ok) {
              /* v76 (owner field report, Oct 14 19:22: "tapping Use
                 does nothing — the suggestion never loads into the
                 form"): the load itself worked (draft written,
                 restore fills the form on render), but the tap's
                 only feedback was the suggestion vanishing and a
                 ONE-SHOT scrollIntoView — the exact pattern v75
                 proved dead on the phone (ingest paint + photo
                 decode shift the layout after the one scroll).
                 Now: name the load in the form's own banner
                 (usedSugNote, consumed by restoreDraft), say it in
                 the card too, and bring the form to the user with
                 dspScrollToForm — the v75 repeated scroll. */
              var ef = (res.entry && res.entry.fields) || {};
              usedSugNote = (ef.jobSite || ef.destination || 'Dispatch') +
                (ef.scheduledAt ? ' · ' + String(ef.scheduledAt).replace('T', ' ') : '');
              ingestTopFlash = '✓ Loaded into the form below — check it, then tap Save there. Nothing is saved yet.';
              api.render(body); // draft restore fills the form from dsp_draft
              dspScrollToForm(body);
              return;
            }
            /* v76: a refusal explains itself AT THE TAP (top of the
               card) — the old text rendered at the card's bottom by
               the paste box, off-screen from the button he pressed.
               v82: a busy form is no longer a dead end at all — the
               owner's rule is that intake never fights the active
               form. When the form holds an edit or an unsaved entry,
               Use saves the suggestion as a SCHEDULED dispatch for
               its own day through the module's verified save (never
               started, never touches the form, the draft or the
               active dispatch), and the suggestion is consumed only
               after that save verifies. The form's contents stay
               exactly as they were. */
            if (res && (res.reason === 'editing' || res.reason === 'draft-busy')) {
              var sugId = b.getAttribute('data-suguse');
              var sugEntry = null;
              try {
                (DispatchIngest.list() || []).forEach(function (e2) { if (e2 && e2.id === sugId) sugEntry = e2; });
              } catch (e) {}
              if (sugEntry && window.DispatchIngest && DispatchIngest.formFieldsFor) {
                var sFields = DispatchIngest.formFieldsFor(sugEntry);
                sFields.date = dspRecordDate(sFields) || App._today();
                var sRec = dspBuildRecord(sFields, [], null, uid());
                var sRes = dspSaveRecord(sRec, false);
                if (sRes.ok) {
                  try { DispatchIngest.dismiss(sugId); } catch (e) {}
                  fbSave(sRec);
                  manifestFeedPush('dispatch', 'Dispatch saved from a suggestion (form was busy): ' + (sRec.jobSite || ''));
                  ingestTopFlash = '✓ Your form below was left exactly as it is — this suggestion was saved as a scheduled dispatch for ' +
                    esc(dspRelDay(sFields.date, App._today())) + ' instead. It is in your dispatch list below.';
                  api.render(body);
                  return;
                }
                ingestTopFlash = '⚠️ That save did NOT go through — the suggestion is still here and your form was not touched. Free up some phone space and tap Use again.';
                paintIngest();
                return;
              }
            }
            ingestTopFlash = (res && res.reason === 'gone')
              ? 'That suggestion is no longer there — the list has been refreshed.'
              : 'Finish or cancel the edit in the form below first — then tap Use.';
            paintIngest();
          };
        });
      }

      /* v26: Multi-ticket — drivers can have MULTIPLE haul cards per day.
         Each ticket: photo + OCR data + manually-confirmed hours/payment unit.
         "Add another ticket" appends; never overwrites. */
      /* v48: the form's working state is restored from the dsp_draft
         store key when one exists, and re-persisted on every change —
         an unsaved form now survives app close, OTA reload, and
         navigating away. The draft is cleared only after a verified
         save (see attemptSave below). */
      /* draft0 was loaded at the top of render (v56 needs it before
         the HTML is built, to render the form in edit mode). */
      var pendingTickets = (draft0 && draft0.tickets) ? draft0.tickets.slice() : []; // [{id, photo, ocrType, ticketNo, cardNumber, foremanHours, paymentUnit, netWeight, grossWeight, tareWeight}]
      var pendingPhoto = draft0 ? (draft0.photo || null) : null; // legacy single-photo (kept for backward compat)
      if (pendingPhoto === null) { var _dp0 = dspPhotoFor({ tickets: pendingTickets }); if (_dp0) pendingPhoto = _dp0; }

      function collectDraft() {
        var q = function (id) { var n = body.querySelector(id); return n ? n.value : ''; };
        return {
          fields: {
            jobSite: q('#dp_site'), scheduledAt: dspComposeSched(q('#dp_date'), q('#dp_time'), App._today()), equipment: q('#dp_equip'),
            lat: q('#dp_lat'), lng: q('#dp_lng'),
            material: q('#dp_mat'), ticketNo: q('#dp_ticket'),
            amount: q('#dp_amt'), loads: q('#dp_loads'), loadsSet: q('#dp_loadsset') === '1',
            notes: q('#dp_notes'),
            driverId: q('#dp_driver')
          },
          tickets: pendingTickets.slice(),
          photo: pendingPhoto,
          editId: editingId || null, // v56: an in-progress edit stays an edit across reloads
          savedAt: Date.now()
        };
      }
      function draftIsEmpty(d) {
        if (d.editId) return false; // v56: an edit in progress is never an "empty" draft
        var f = d.fields || {};
        var any = f.jobSite || f.scheduledAt || f.equipment || f.material ||
                  f.ticketNo || f.amount || f.notes || f.lat || f.lng || f.driverId;
        return !any && !(d.tickets && d.tickets.length) && !d.photo;
      }
      function showDraftWarn(msg) {
        var e = body.querySelector('#dp_draft_warn');
        if (e) e.innerHTML = msg ?
          '<div style="border:2px solid #c0392b;background:#fdecea;border-radius:10px;padding:10px;margin-bottom:10px;color:#7b1d12">' + esc(msg) + '</div>' : '';
      }
      /* v48: a failed local write is DETECTED and said out loud, never
         silent. If the full draft (with photo) will not write — app
         storage full/failing — fall back to the photo-less slim draft
         so the typed entry still survives, and tell the user plainly.
         If even that fails, warn that the entry lives only on this
         screen until space is freed and Save succeeds. */
      function persistDraft() {
        var d = collectDraft();
        if (draftIsEmpty(d)) { dspClearDraft(); showDraftWarn(''); return 'empty'; }
        if (dspSaveDraft(d) !== false) { showDraftWarn(''); return 'full'; }
        if (dspSaveDraft(dspSlimDraft(d)) !== false) {
          showDraftWarn('⚠️ The app storage on your phone looks full — your dispatch words are safe as a draft, but the ticket photo could not be kept. Free up some phone space, then add the photo again and tap Save.');
          return 'slim';
        }
        showDraftWarn('⚠️ The app storage on your phone is full — even the draft could not be saved. Keep this screen open, free up some phone space, and tap Save. If you close the app now, this entry could be lost.');
        return 'failed';
      }
      function showSaveError(msg) {
        var e = body.querySelector('#dp_save_err');
        if (e) e.innerHTML = '<div style="border:2px solid #c0392b;background:#fdecea;border-radius:10px;padding:10px;margin-bottom:10px;color:#7b1d12">' + esc(msg) + '</div>';
      }
      function clearSaveError() {
        var e = body.querySelector('#dp_save_err');
        if (e) e.innerHTML = '';
      }
      function restoreDraft() {
        if (!draft0 || !draft0.fields) return;
        var f = draft0.fields;
        var set = function (id, v) { var n = body.querySelector(id); if (n && v !== undefined && v !== null) n.value = v; };
        set('#dp_site', f.jobSite);
        var schedParts = dspSplitSched(f.scheduledAt);
        set('#dp_date', schedParts.date); set('#dp_time', schedParts.time);
        set('#dp_equip', f.equipment);
        set('#dp_lat', f.lat); set('#dp_lng', f.lng);
        set('#dp_mat', f.material); set('#dp_ticket', f.ticketNo);
        set('#dp_amt', f.amount); if (f.loads) set('#dp_loads', f.loads); set('#dp_notes', f.notes);
        set('#dp_loadsset', f.loadsSet ? '1' : '');
        set('#dp_driver', f.driverId);
        if (f.lat !== '' && f.lat !== undefined && f.lat !== null && f.lng !== '' && f.lng !== undefined && f.lng !== null) {
          body.querySelector('#dp_pin').innerHTML = '📍 Map pin set' +
            ' — <a href="https://www.google.com/maps?q=' + f.lat + ',' + f.lng + '" target="_blank" rel="noopener">Open in Maps</a>';
        }
        if (editingId) {
          /* v56: an edit draft restores AS an edit — the banner names
             the record and promises exactly what Save changes does. */
          body.querySelector('#dp_draft_note').innerHTML =
            '<div style="border:2px solid var(--orange);border-radius:10px;padding:8px 10px;margin-bottom:10px">✏️ <b>Editing: ' + esc(editRec.jobSite || editRec.pickup || 'dispatch') + '</b> — your changes update this saved dispatch when you tap “Save changes”. Its start time and status do not change.' +
            (draft0.photoDropped ? '<br>⚠️ The ticket photo could not be kept (the app storage on your phone was full) — please add the photo again.' : '') + '</div>';
        } else if (!draftIsEmpty({ fields: f, tickets: pendingTickets, photo: pendingPhoto })) {
          body.querySelector('#dp_draft_note').innerHTML =
            '<div style="border:2px solid var(--orange);border-radius:10px;padding:8px 10px;margin-bottom:10px">📝 <b>Draft restored</b> — this unsaved dispatch was kept from last time. Check it, then tap Save.' +
            (draft0.photoDropped ? '<br>⚠️ The ticket photo could not be kept (the app storage on your phone was full) — please add the photo again.' : '') + '</div>';
        }
        /* v76: a suggestion loaded by Use names itself HERE, in the
           form it landed in — the "Draft restored" wording would
           undersell that the tap worked, and name nothing. */
        if (usedSugNote) {
          body.querySelector('#dp_draft_note').innerHTML =
            '<div style="border:2px solid #2e9e5b;border-radius:10px;padding:8px 10px;margin-bottom:10px">📩 <b>Loaded from your suggestions:</b> ' + esc(usedSugNote) + ' — check the form, then tap Save. Nothing is saved until you do.</div>';
          usedSugNote = '';
        }
      }
      ['#dp_site', '#dp_date', '#dp_time', '#dp_equip', '#dp_mat', '#dp_ticket', '#dp_amt', '#dp_loads', '#dp_notes'].forEach(function (id) {
        var n = body.querySelector(id);
        if (n) { n.addEventListener('input', persistDraft); n.addEventListener('change', persistDraft); }
      });
      /* v107: a genuine edit of the Loads field marks the count as
         deliberately recorded (see dp_loadsset) — draft fills and
         edit fills set the marker directly, never through here. */
      (function () {
        var lEl = body.querySelector('#dp_loads');
        var sEl = body.querySelector('#dp_loadsset');
        if (lEl && sEl) {
          var mark = function () { sEl.value = '1'; };
          lEl.addEventListener('input', mark);
          lEl.addEventListener('change', mark);
        }
      })();

      var imgInput = body.querySelector('#dp_img');
      var imgCamInput = body.querySelector('#dp_img_cam');
      // v24: two buttons — camera and file picker
      body.querySelector('#dp_cam').onclick = function () { imgCamInput.click(); };
      body.querySelector('#dp_pick').onclick = function () { imgInput.click(); };

      function ticketId() { return 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

      /* Render the ticket list UI */
      function renderTicketList() {
        var el = body.querySelector('#dp_ticketlist');
        var o = App._store.get('onboarding', {});
        var tb = parseFloat(o.travelBonus) || 0;
        if (!pendingTickets.length) {
          el.innerHTML = '';
          return;
        }
        var h = '';
        pendingTickets.forEach(function (t, i) {
          var desc = t.ocrType === 'haul_card' ? 'Haul card' :
                     t.ocrType === 'scale_ticket' ? 'Scale ticket' :
                     t.ocrType === 'rate_confirmation' ? 'Rate confirmation' :
                     t.ocrType === 'bill_of_lading' ? 'Bill of lading' :
                     t.ocrType === 'document' ? 'Document' : 'Dispatch';
          var num = t.cardNumber ? '#' + esc(t.cardNumber) :
                    t.orderNo ? '#' + esc(t.orderNo) :
                    t.ticketNo ? '#' + esc(t.ticketNo) : '';
          var detail = '';
          if (t.foremanHours) detail += esc(t.foremanHours) + 'h';
          if (t.paymentUnit) detail += (detail ? ' · ' : '') + esc(t.paymentUnit);
          if (t.netWeight) detail += (detail ? ' · ' : '') + esc(t.netWeight) + 't';
          /* v35: no silent failure — the read report is always visible:
             every field the document reader filled, and every one it
             couldn't find.
             v117: the summary renders through dspCleanDocRead — a
             stored pre-gate summary can never print gibberish here. */
          var readLines = '';
          if (t.docRead) {
            var cleanRead = dspCleanDocRead(t.docRead);
            if (cleanRead.found && cleanRead.found.length) {
              readLines += '<div class="b">📄 Read: ' + esc(cleanRead.found.join(' · ')) + '</div>';
            }
            if (cleanRead.missing && cleanRead.missing.length) {
              readLines += '<div class="b" style="color:var(--orange)">Couldn\'t find: ' + esc(cleanRead.missing.join(', ')) + '</div>';
            }
          }
          h += '<div class="listitem" style="align-items:flex-start">' +
            (t.photo ? '<img src="' + t.photo + '" style="width:56px;height:56px;object-fit:cover;border-radius:8px;margin-right:10px" alt="Ticket">' : '') +
            '<div style="flex:1"><div class="a">' + desc + ' ' + num + '</div>' +
            (detail ? '<div class="b">' + detail + '</div>' :
              (t.ocrType === 'haul_card' ? '<div class="b" style="color:var(--orange)">Needs hours — tap ✏️</div>' : '')) +
            readLines +
            '</div>' +
            '<button class="btn small ghost" data-tedit="' + i + '">✏️</button>' +
            '<button class="btn small ghost" data-tdel="' + i + '">🗑</button></div>';
        });
        // Totals
        if (window.TicketOCR) {
          var s = TicketOCR.summarizeTickets(pendingTickets, tb);
          if (s.ticketCount > 0) {
            h += '<div class="kv"><span>Foreman hours (' + s.ticketCount + ' tickets)</span><b>' + s.totalForemanHours + 'h</b></div>';
            if (tb > 0) h += '<div class="kv"><span>+ Travel bonus</span><b>' + tb + 'h</b></div>';
            h += '<div class="kv"><span><b>Total paid hours</b></span><b style="color:var(--orange)">' + s.totalPaidHours + 'h</b></div>';
            if (s.totalNetWeight > 0) h += '<div class="kv"><span>Total net weight</span><b>' + s.totalNetWeight + 't</b></div>';
          }
        }
        el.innerHTML = h;
        el.querySelectorAll('[data-tdel]').forEach(function (b) {
          b.onclick = function () {
            if (!confirm('Remove this ticket?')) return;
            pendingTickets.splice(+b.getAttribute('data-tdel'), 1);
            if (!pendingTickets.length) pendingPhoto = null;
            else pendingPhoto = pendingTickets[pendingTickets.length - 1].photo || pendingPhoto;
            renderTicketList();
            updateNameEl();
            persistDraft(); // v48
          };
        });
        el.querySelectorAll('[data-tedit]').forEach(function (b) {
          b.onclick = function () { editTicket(+b.getAttribute('data-tedit')); };
        });
      }

      /* Edit a ticket's manually-confirmed fields (hours, payment unit) */
      function editTicket(i) {
        var t = pendingTickets[i]; if (!t) return;
        var promptEl = body.querySelector('#dp_ocr_prompt');
        var h = '<div class="card" style="border:2px solid var(--orange)"><h3>✏️ Ticket ' + (i + 1) + '</h3>';
        if (t.ocrType === 'haul_card') {
          h += '<label class="f">Foreman hours (from card)</label>' +
               '<input id="t_hours" type="number" inputmode="decimal" min="0" step="0.25" value="' + esc(t.foremanHours || '') + '" placeholder="e.g. 4">' +
               '<label class="f">Payment unit (checked on card)</label><select id="t_punit">' +
               ['HOUR', 'TONNE', 'TONNE / KM', 'OTHER'].map(function (x) {
                 return '<option' + (t.paymentUnit === x ? ' selected' : '') + '>' + x + '</option>';
               }).join('') + '</select>';
        } else if (t.ocrType === 'scale_ticket') {
          h += '<label class="f">Net weight (tonnes)</label>' +
               '<input id="t_net" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(t.netWeight || '') + '">';
        }
        h += '<div class="row" style="margin-top:8px">' +
             '<button class="btn primary" id="t_save">Save ticket</button>' +
             '<button class="btn ghost" id="t_cancel">Cancel</button></div></div>';
        promptEl.innerHTML = h;
        promptEl.querySelector('#t_cancel').onclick = function () { promptEl.innerHTML = ''; };
        promptEl.querySelector('#t_save').onclick = function () {
          if (t.ocrType === 'haul_card') {
            t.foremanHours = promptEl.querySelector('#t_hours').value.trim();
            t.paymentUnit = promptEl.querySelector('#t_punit').value;
          } else if (t.ocrType === 'scale_ticket') {
            t.netWeight = promptEl.querySelector('#t_net').value.trim();
          }
          promptEl.innerHTML = '';
          renderTicketList();
          updateNameEl();
          persistDraft(); // v48
        };
      }

      function updateNameEl() {
        var n = pendingTickets.length;
        body.querySelector('#dp_img_name').textContent =
          n === 0 ? 'No tickets yet — add the first one above.' :
          n + ' ticket' + (n > 1 ? 's' : '') + ' added. Tap "Take ticket photo" to add another.';
      }

      /* v66: the active-dispatch note — while another dispatch is
         ACTIVE and this form is being filled for a DIFFERENT day,
         say plainly that today's stays active and this one only
         saves for its own day (the save guard in attemptSave makes
         it true). Recomputed whenever the Scheduled field changes. */
      function paintActiveNote() {
        var e = body.querySelector('#dp_active_note');
        if (!e) return;
        var msg = '';
        var act = active();
        if (!editingId && act) {
          var dateEl = body.querySelector('#dp_date');
          var timeEl = body.querySelector('#dp_time');
          var rd = dateEl ? dspRecordDate({ scheduledAt: dspComposeSched(dateEl.value, timeEl ? timeEl.value : '', App._today()) }) : '';
          if (rd && rd !== App._today()) {
            msg = '🚛 Today\'s dispatch stays active — this saves for ' + fmtDay(rd) + ' and will not start now.';
          }
        }
        e.innerHTML = msg ? '<div style="border:2px solid var(--orange);border-radius:10px;padding:8px 10px;margin:6px 0 10px;">' + esc(msg) + '</div>' : '';
      }
      ['#dp_date', '#dp_time'].forEach(function (sel) {
        var schedNode = body.querySelector(sel);
        if (schedNode) { schedNode.addEventListener('input', paintActiveNote); schedNode.addEventListener('change', paintActiveNote); }
      });

      /* v48: restore a kept draft (fields + tickets + note) */
      if (draft0) { restoreDraft(); renderTicketList(); updateNameEl(); }
      paintActiveNote();
      /* v56: the record behind an abandoned edit draft was deleted —
         the edit was discarded at the top of render; say so plainly. */
      if (editGone) {
        body.querySelector('#dp_draft_note').innerHTML =
          '<div style="border:2px solid var(--orange);border-radius:10px;padding:8px 10px;margin-bottom:10px">✏️ The dispatch you were editing is no longer there, so that unfinished edit was discarded. Nothing was changed.</div>';
      }

      /* v107: does this ticket read still owe the driver facts?
         Escalation is for reads that came back thin: a haul card
         (its material, times and hours are handwritten — the local
         reader structurally cannot finish it), or any read whose
         report still lists a key field missing. Gibberish never
         reaches this check as a value — the OCR layer refuses it
         (looksGibberish) and the field reads as missing instead. */
      function readNeedsEscalation(parsed, docRead) {
        if (!parsed) return false;
        if (parsed._type === 'haul_card') return true;
        if (!docRead || !docRead.missing) return false;
        return docRead.missing.indexOf('material') >= 0 ||
          docRead.missing.indexOf('ticket #') >= 0 ||
          docRead.missing.indexOf('job site') >= 0;
      }
      /* v107: offer a read's facts to the form. Fill-only-empty is
         absolute — a read never overwrites what the driver typed —
         but EVERY read now gets the offer. Before v107 only the
         FIRST ticket of a form session filled anything, so a haul
         card attached to an existing dispatch (his Oct 16 close)
         never landed its ticket #, material or time in the form
         at all: the fields sat empty under a "Couldn't find"
         banner while the ticket chip itself showed card #22729. */
      function fillFormFromRead(parsed, form) {
        if (!form) return;
        if (form.jobSite && !body.querySelector('#dp_site').value) body.querySelector('#dp_site').value = form.jobSite;
        /* v35: rate/amount from a rate confirmation */
        if (form.amount && !body.querySelector('#dp_amt').value) body.querySelector('#dp_amt').value = form.amount;
        /* v31: scheduled datetime + truck type + map pin from OCR */
        if (form.scheduledAt) {
          var sp86 = dspSplitSched(form.scheduledAt);
          var dEl86 = body.querySelector('#dp_date'), tEl86 = body.querySelector('#dp_time');
          if (dEl86 && sp86.date && !dEl86.value) dEl86.value = sp86.date;
          if (tEl86 && sp86.time && !tEl86.value) tEl86.value = sp86.time;
        }
        if (form.equipment && !body.querySelector('#dp_equip').value) body.querySelector('#dp_equip').value = form.equipment;
        if (form.lat !== undefined && form.lat !== null && form.lng !== undefined && form.lng !== null) {
          body.querySelector('#dp_lat').value = form.lat;
          body.querySelector('#dp_lng').value = form.lng;
          body.querySelector('#dp_pin').innerHTML = '📍 Map pin set' +
            (form.coordinates ? ' (' + esc(form.coordinates) + ')' : '') +
            ' — <a href="https://www.google.com/maps?q=' + form.lat + ',' + form.lng + '" target="_blank" rel="noopener">Open in Maps</a>';
        }
        if (form.material && !body.querySelector('#dp_mat').value) body.querySelector('#dp_mat').value = form.material;
        /* v107: the ticket # comes from the form mapping OR the
           haul card's own cardNumber — one source or the other,
           the field fills whenever the read carries the number. */
        var ticketVal = form.ticketNo || (parsed && parsed.cardNumber) || null;
        if (ticketVal && !body.querySelector('#dp_ticket').value) body.querySelector('#dp_ticket').value = ticketVal;
        /* v107: a start clock the read carried (a haul card's
           handwritten start, recovered by the labeled attempts or
           the power read) fills the form's Start time. */
        var startVal = form.startTime || (parsed && parsed.startTime) || null;
        if (startVal) {
          var tmEl = body.querySelector('#dp_time');
          if (tmEl && !tmEl.value) tmEl.value = startVal;
        }
        if (form.notes && !body.querySelector('#dp_notes').value) body.querySelector('#dp_notes').value = form.notes;
      }
      /* v142: a cloud transcription → the merged-read shape, via
         the SAME local pipeline the local read uses (parse →
         dispatch form → read report). Shared by the escalation leg
         and the capture-time settle path — one parse, one shape. */
      function cloudMergedFromText(txt) {
        if (!txt || !window.TicketOCR) return null;
        var p2 = TicketOCR.parse(txt);
        var f2 = TicketOCR.toDispatchForm(p2);
        var dr2 = (window.TicketOCR.describeRead) ? TicketOCR.describeRead(p2, f2) : null;
        return { parsed: p2, form: f2, docRead: dr2 };
      }
      /* v142: start the ticket photo's cloud read the moment the
         photo exists (PowerRead.beginEarly), on its own smaller
         rendition, and remember the image it used. The escalation
         leg ADOPTS this read when the local read comes back thin
         (same reader + photo — no second send); when the local
         read is rich, onSettled delivers the cloud read instead
         and the caller merges it fill-only. When power read is
         unavailable the funnels behave exactly as before. */
      function dspBeginEarly(img, onSettled) {
        var state = { prImg: null };
        if (!img || !window.PowerRead || !PowerRead.beginEarly) return state;
        function begin(prImg) {
          state.prImg = prImg || img;
          var h = PowerRead.beginEarly({ reader: 'text', image: state.prImg, origin: { module: 'dispatch', label: 'Dispatch' } });
          if (h && onSettled) h.onSettled(function (out) {
            if (!out || out.status !== 'done') { onSettled(null); return; }
            onSettled(cloudMergedFromText(out.fields && out.fields.rawText));
          });
        }
        if (window.TicketOCR && TicketOCR.urlToReadImage) TicketOCR.urlToReadImage(img, 'text', begin);
        else begin(img);
        return state;
      }

      /* v107: the Power Read escalation shared by both ticket
         funnels (form attach + close-with-ticket). The cloud
         transcription is parsed by the SAME local pipeline and
         merged fill-only: form fields that are still empty, and
         ticket facts the local read missed. Nothing is saved by
         the escalation itself — the normal Save / Confirm stays
         the confirm. Resolves with the merged {parsed, docRead}
         or null when no better read arrived.
         v142: prImg (the capture-time read's image, when the
         funnel started one) is what the escalation asks with —
         PowerRead.escalate adopts that in-flight read. */
      function escalateTicketRead(ocrUrl, onMerged, prImg) {
        if (!window.PowerRead || !PowerRead.escalate || !window.TicketOCR) { onMerged(null); return; }
        var got = null;
        PowerRead.escalate({
          reader: 'text', image: prImg || ocrUrl, origin: { module: 'dispatch', label: 'Dispatch' },
          onStatus: function () {},
          onResult: function (res) {
            var txt = res && res.fields && res.fields.rawText;
            if (!txt) return;
            got = cloudMergedFromText(txt);
          }
        }).then(function () { onMerged(got); }, function () { onMerged(got); });
      }

      /* v26: OCR — after photo selected, run Tesseract, then append ticket.
         v35: OCR runs on the larger rendition (ocrUrl); the ticket keeps
         the small thumb (photoUrl). Documents (rate confirmations / BOLs)
         go through the full field-sweep reader; upside-down scans are
         retried at 180° inside recognizeWithRotation. */
      function runOCR(ocrUrl, photoUrl) {
        if (!window.TicketOCR) return;
        var nameEl = body.querySelector('#dp_img_name');
        nameEl.textContent = 'Reading ticket…';
        /* v142: the cloud read starts NOW, in parallel with the
           local read (it used to start only after a thin local read
           — the serial wait). Its merge is fill-only, so whenever
           it lands it can only complete the ticket, never rewrite
           it; a thin local read still escalates, and the escalation
           adopts this same read instead of sending a second one. */
        var cloudMerged = null, cloudSettled = false, ticketBuilt = false;
        var early = dspBeginEarly(ocrUrl || photoUrl, function (m) {
          cloudMerged = m;
          cloudSettled = true;
          if (ticketBuilt) applyCloudMerged();
        });
        var applyMergedRef = null;
        function applyCloudMerged() { if (applyMergedRef) applyMergedRef(cloudMerged); }
        TicketOCR.recognizeWithRotation(ocrUrl || photoUrl, function (p) {
          try { nameEl.textContent = 'Reading ticket… ' + Math.round(p * 100) + '%'; } catch (e) {}
        }).then(function (text) {
          var parsed = TicketOCR.parse(text);
          var form = TicketOCR.toDispatchForm(parsed);
          var docRead = (window.TicketOCR.describeRead) ? TicketOCR.describeRead(parsed, form) : null;
          var isDoc = parsed._type === 'rate_confirmation' || parsed._type === 'bill_of_lading' || parsed._type === 'document';
          fillFormFromRead(parsed, form);
          // Build ticket object
          var t = {
            id: ticketId(),
            photo: photoUrl,
            ocrType: parsed._type,
            ticketNo: parsed.ticketNo || form.ticketNo || null,
            orderNo: parsed.orderNo || null,
            docRead: docRead,
            cardNumber: parsed.cardNumber || null,
            /* v107: hours/clocks the read itself carried (the
               labeled attempts, or a document's times) ride on the
               ticket as candidates — haul-card hours still land in
               the confirm fields for the driver's check before
               anything is saved. */
            foremanHours: parsed.totalHours || null,
            paymentUnit: null,  // manual — checkbox state needs user confirmation
            startTime: parsed.startTime || null,
            finishTime: parsed.finishTime || null,
            netWeight: form.netWeight || null,
            grossWeight: form.grossWeight || null,
            tareWeight: form.tareWeight || null,
            date: App._today()
          };
          pendingTickets.push(t);
          pendingPhoto = photoUrl; // legacy compat
          renderTicketList();
          updateNameEl();
          /* v107: the merge itself — fill-only into the form and
             this ticket (see escalateTicketRead). v142: one shared
             body serves both arrivals (the escalation's answer and
             the capture-time read settling late); every write in
             it is fill-only/absent-only, so applying it twice is a
             no-op the second time. */
          function applyMerged(merged) {
            if (!merged) return;
            fillFormFromRead(merged.parsed, merged.form);
            if (!t.cardNumber && merged.parsed.cardNumber) t.cardNumber = merged.parsed.cardNumber;
            if (!t.ticketNo && (merged.parsed.ticketNo || merged.form.ticketNo)) t.ticketNo = merged.parsed.ticketNo || merged.form.ticketNo;
            if (!t.foremanHours && merged.parsed.totalHours) t.foremanHours = merged.parsed.totalHours;
            if (!t.startTime && merged.parsed.startTime) t.startTime = merged.parsed.startTime;
            if (!t.finishTime && merged.parsed.finishTime) t.finishTime = merged.parsed.finishTime;
            if (merged.docRead && (!t.docRead || (merged.docRead.found || []).length > ((t.docRead && t.docRead.found) || []).length)) t.docRead = merged.docRead;
            renderTicketList();
            persistDraft();
          }
          applyMergedRef = applyMerged;
          ticketBuilt = true;
          /* v142: the cloud read beat the local one — merge it now. */
          if (cloudSettled) applyCloudMerged();
          /* v107: a thin local read escalates to Power Read; the
             better read merges fill-only into the form and this
             ticket (see escalateTicketRead). */
          if (readNeedsEscalation(parsed, docRead)) {
            escalateTicketRead(ocrUrl || photoUrl, function (merged) {
              applyMerged(merged);
            }, early.prImg);
          }
          // If haul card, immediately prompt for hours/payment unit
          if (parsed._type === 'haul_card') {
            body.querySelector('#dp_img_name').textContent =
              '✓ Haul card detected (card #' + (t.cardNumber || '?') + '). Enter foreman hours below.';
            editTicket(pendingTickets.length - 1);
          } else if (isDoc) {
            /* v35: plain-language result — never silent. */
            var docLabel = parsed._type === 'rate_confirmation' ? 'Rate confirmation' :
                           parsed._type === 'bill_of_lading' ? 'Bill of lading' : 'Document';
            if (docRead && docRead.found.length) {
              body.querySelector('#dp_img_name').textContent =
                '✓ ' + docLabel + ' added — read ' + docRead.found.length + ' fields (details on the ticket).';
            } else {
              body.querySelector('#dp_img_name').textContent =
                'Couldn\'t read anything from that photo — it\'s added below; please fill the form by hand.';
            }
          } else {
            var label = parsed._type === 'scale_ticket' ? 'Scale ticket' : 'Dispatch';
            body.querySelector('#dp_img_name').textContent =
              '✓ ' + label + ' added (' + parsed._confidence + ' fields). Add another or save.';
          }
          body.querySelector('#dp_preview').innerHTML = '';
          persistDraft(); // v48: OCR-filled form + ticket are kept as a draft immediately
        }).catch(function () {
          body.querySelector('#dp_img_name').textContent = 'Photo added (OCR unavailable)';
          pendingTickets.push({ id: ticketId(), photo: photoUrl, ocrType: 'unknown', date: App._today() });
          pendingPhoto = photoUrl;
          renderTicketList();
          updateNameEl();
          persistDraft(); // v48
        });
      }
      function handlePhoto(ev) {
        var f = ev.target.files[0]; if (!f) return;
        body.querySelector('#dp_img_name').textContent = f.name || 'Photo selected';
        fileToThumb(f, function (thumbUrl) {
          body.querySelector('#dp_preview').innerHTML =
            '<img src="' + thumbUrl + '" style="width:100%;border-radius:10px;margin-top:10px" alt="Ticket preview">';
          /* v35: OCR the larger rendition so full-page documents stay
             readable; fall back to the thumb if it can't be built. */
          fileToOCRImage(f, function (ocrUrl) {
            runOCR(ocrUrl || thumbUrl, thumbUrl);
          });
        });
      }
      imgInput.onchange = handlePhoto;
      imgCamInput.onchange = handlePhoto;

      function readForm() {
        var latV = body.querySelector('#dp_lat').value, lngV = body.querySelector('#dp_lng').value;
        var drvEl = body.querySelector('#dp_driver'); // v52: absent when no P&L drivers
        return {
          jobSite: body.querySelector('#dp_site').value.trim(),
          scheduledAt: dspComposeSched(body.querySelector('#dp_date').value, body.querySelector('#dp_time').value, App._today()), // v31/v86: dispatch date+time from the split fields
          equipment: body.querySelector('#dp_equip').value.trim(), // v31: truck type (Tandem…)
          lat: latV !== '' ? parseFloat(latV) : null,               // v31: map pin from OCR coords
          lng: lngV !== '' ? parseFloat(lngV) : null,
          material: body.querySelector('#dp_mat').value.trim(),
          ticketNo: body.querySelector('#dp_ticket').value.trim(),
          amount: body.querySelector('#dp_amt').value.trim(),
          loads: body.querySelector('#dp_loads').value.trim() || '1',
          loadsSet: !!(body.querySelector('#dp_loadsset') && body.querySelector('#dp_loadsset').value === '1'),
          notes: body.querySelector('#dp_notes').value.trim(),
          driverId: drvEl ? drvEl.value : '',                        // v52
          driverName: (drvEl && drvEl.value) ? drvEl.options[drvEl.selectedIndex].text : '', // v52
          date: App._today()
        };
      }

      /* v48: VERIFIED save. The record is written, then READ BACK from
         the store; only a verified save clears the draft and re-renders.
         On failure the form and draft stay exactly as they are and an
         in-page error says so — never a silent loss, never a native
         dialog. A retry with an unchanged form reuses the same record
         id, so a partial first attempt cannot duplicate the entry. */
      var lastSaveTry = null; // { fp, rec, startedAt }
      function attemptSave(start) {
        clearSaveError();
        var fields = readForm();
        if (!fields.jobSite) { showSaveError('Enter the job site first — nothing was saved yet. Your entry is kept below as a draft.'); return; }
        var fp = JSON.stringify([fields, pendingTickets.map(function (t) { return t.id; }), pendingPhoto]);
        var d;
        if (lastSaveTry && lastSaveTry.fp === fp) {
          d = lastSaveTry.rec;
        } else {
          d = dspBuildRecord(fields, pendingTickets, pendingPhoto, uid());
          lastSaveTry = { fp: fp, rec: d, startedAt: 0 };
        }
        /* v66 guard: "Save & start" on a dispatch whose day is NOT
           today saves it as a scheduled record for its own day —
           it never starts, and the active dispatch (usually today's,
           still running) is never touched. */
        var mayStart = start && dspMayStart(d, App._today());
        if (mayStart) {
          if (!lastSaveTry.startedAt) lastSaveTry.startedAt = Date.now();
          d.status = 'active'; d.startedAt = lastSaveTry.startedAt;
        }
        var res = dspSaveRecord(d, mayStart);
        if (!res.ok) {
          persistDraft(); // best effort — the on-screen form is untouched either way
          showSaveError('⚠️ That save did NOT go through — the app storage on your phone looks full, or the write failed, so your dispatch was not saved. Your entry is kept as a draft below, so nothing is lost. Free up some phone space, then tap ' + (isOffice ? '“Save”' : (start ? '“Save & start”' : '“Save dispatch”')) + ' again.');
          return;
        }
        lastSaveTry = null;
        dspClearDraft(); // only a verified save clears the draft
        fbSave(d);
        manifestFeedPush('dispatch', 'Dispatch ' + (mayStart ? 'started' : 'saved') + ': ' + d.jobSite + (d.ticketNo ? ' · ticket #' + d.ticketNo : ''));
        if (mayStart && window.FB && FB.localNotify) { try { FB.localNotify('Dispatch started', d.jobSite); } catch (e) {} }
        api.render(body);
      }

      /* v56: EDIT save — the verified-update twin of attemptSave.
         Builds the updated record from the ORIGINAL (lifecycle
         fields pinned by dspApplyEdit), writes it back under the
         SAME id, and only then clears the draft. On failure the
         stored record is untouched, the edit stays as a draft, and
         an in-page error says so — the v48 rules, unchanged. */
      function attemptEditSave() {
        clearSaveError();
        var orig = dspFindRecord(editingId);
        if (!orig) { dspClearDraft(); api.render(body); return; } // gone mid-edit; render discards + explains
        var fields = readForm();
        if (!fields.jobSite) { showSaveError('Enter the job site first — nothing was saved. Your edit is kept below as a draft.'); return; }
        fields.date = orig.date; // readForm stamps today; an edit never moves the dispatch's day
        var updated = dspApplyEdit(orig, fields, pendingTickets, pendingPhoto);
        var res = dspUpdateRecord(updated, orig);
        if (!res.ok) {
          persistDraft(); // best effort — the on-screen form is untouched either way
          showSaveError('⚠️ Those changes did NOT go through — the app storage on your phone looks full, or the write failed, so the saved dispatch is unchanged. Your edit is kept as a draft below, so nothing is lost. Free up some phone space, then tap “Save changes” again.');
          return;
        }
        dspClearDraft(); // only a verified update clears the draft
        fbSave(updated);
        manifestFeedPush('dispatch', 'Dispatch edited: ' + updated.jobSite + (updated.ticketNo ? ' · ticket #' + updated.ticketNo : ''));
        api.render(body);
      }
      /* v56: enter edit mode for a record — the record is loaded into
         the form THROUGH the draft (editId carried), so a mid-edit
         app close restores the edit itself, never a new dispatch.
         v117: the pre-fill comes from dspEditFieldsFor — the record
         AND its tickets — never the half-empty top-level-only read
         that opened Material/Ticket # blank and Loads at default. */
      function startEdit(d) {
        if (!d) return;
        viewCompletedId = null; // v129: the edit form becomes the record's one presence
        var fields = dspEditFieldsFor(d);
        var tk = (d.tickets || []).map(function (t) {
          var c = {};
          for (var k in t) { if (Object.prototype.hasOwnProperty.call(t, k)) c[k] = t[k]; }
          return c;
        });
        var draft = { fields: fields, tickets: tk, photo: dspPhotoFor(d), editId: d.id, savedAt: Date.now() };
        if (dspSaveDraft(draft) === false) { dspSaveDraft(dspSlimDraft(draft)); }
        api.render(body);
        /* v75: bring the edit form to him (repeated scroll — see
           DSP-SCROLL above; the one-shot scroll this replaces did
           not survive the phone's late layout). */
        dspScrollToForm(body);
      }

      var addBtn = body.querySelector('#dp_add');
      if (addBtn) addBtn.onclick = function () { attemptSave(false); };
      var addStartBtn = body.querySelector('#dp_addstart');
      if (addStartBtn) addStartBtn.onclick = function () { attemptSave(true); };
      var saveEditBtn = body.querySelector('#dp_saveedit');
      if (saveEditBtn) saveEditBtn.onclick = function () { attemptEditSave(); };
      var cancelEditBtn = body.querySelector('#dp_canceledit');
      if (cancelEditBtn) cancelEditBtn.onclick = function () { dspClearDraft(); api.render(body); };
      var editActiveBtn = body.querySelector('#dp_edit_active');
      if (editActiveBtn) editActiveBtn.onclick = function () { startEdit(active()); };
      /* v129: the completed face's own actions — Edit (secondary,
         into the one form) and Done (close the face). */
      var viewEditBtn = body.querySelector('#dp_view_edit');
      if (viewEditBtn) viewEditBtn.onclick = function () {
        var d = dspFindRecord(viewCompletedId);
        if (d) startEdit(d);
      };
      var viewDoneBtn = body.querySelector('#dp_view_done');
      if (viewDoneBtn) viewDoneBtn.onclick = function () { viewCompletedId = null; api.render(body); };

      /* ---- completion glue (v73): ONE application path ----
         completionSettings assembles the account inputs (pay
         standard/rate/travel bonus, the completing user's role, the
         identified driver for an office completer); applyCompletion
         runs dspCompletionFor — the single money assembly — and
         applies its plan: Revenue entry, P&L travel claim, tracker
         note, manifest feed, result message. The plain Complete
         button and the close-with-ticket Confirm both end here, so
         the same closed record always logs the same entry. */
      function completionSettings(rec) {
        var o = App._store.get('onboarding', {});
        var role = (App.userRole ? App.userRole() : 'driver');
        var matchedDriver = null;
        if (role === 'office') {
          var pds = App._store.get('pnl_drivers', []) || [];
          pds.forEach(function (pd) { if (!matchedDriver && rec.driverId && pd.id === rec.driverId) matchedDriver = pd; });
          if (!matchedDriver && rec.driverName) {
            var nm = String(rec.driverName).trim().toLowerCase();
            pds.forEach(function (pd) { if (!matchedDriver && pd.name && String(pd.name).trim().toLowerCase() === nm) matchedDriver = pd; });
          }
        }
        return {
          std: (o.payStandard || 'hourly').toLowerCase(),
          /* v137: the base rate is the completer's OWN wage chain
             (ownWageRate || payRate) — the universal Preferences
             "Rate" field is gone. Crew wages never come from here:
             an office completer's drivers are priced from their
             P&L entries (v132). */
          rate: parseFloat(o.ownWageRate) || parseFloat(o.payRate) || 0,
          travelBonus: parseFloat(o.travelBonus) || 0,
          /* v105: the two-books rates (owner-operator). v137 chain:
             billing falls back to the wage rate, then the setup
             rate; wage falls back to the setup rate. For a setup
             that never split them, every value is unchanged. */
          billingRate: parseFloat(o.billingRate) || parseFloat(o.ownWageRate) || parseFloat(o.payRate) || 0,
          wageRate: parseFloat(o.ownWageRate) || parseFloat(o.payRate) || 0,
          role: role, driver: matchedDriver, today: App._today()
        };
      }
      function applyCompletion(cur, prePlan) {
        /* One confirmation updates Revenue: log the dispatch earnings.
           v26: Multi-ticket — sum foreman hours from all tickets + travel bonus.
           Pay by Weight: sum net weights × rate/tonne.
           v52: the money decision lives in dspCompletionPlan (pure,
           harness-tested). Driver/both completers get the pre-v52 entry
           unchanged; an office completer's entry excludes the travel
           hours, which are routed to the identified driver's P&L wages
           as a claim — or disclosed as held out when no driver matches.
           v129: a close path that already assembled the plan (to
           stamp the close facts from it) hands it in — the plan is
           assembled exactly once per close either way. */
        var planRes = prePlan || dspCompletionFor(cur, completionSettings(cur));
        var plan = planRes.plan;
        var tickets = planRes.tickets;
        var revEntry = plan.entry;
        var amt = parseFloat(cur.amount);
        if (revEntry && Meticulous.modules.revenue && Meticulous.modules.revenue.addEntry) {
          /* v105: keyed by dispatch — addEntry replaces any earlier
             entry for THIS dispatch, so a re-completion updates the
             day's money instead of doubling it. */
          revEntry.dspId = cur.id;
          Meticulous.modules.revenue.addEntry(revEntry);
        }
        if (plan.claim) {
          plan.claim.id = 'tc' + Date.now().toString(36);
          plan.claim.dispatchId = cur.id;
          var claims = App._store.get('pnl_travel_claims', []) || [];
          claims.push(plan.claim);
          App._store.set('pnl_travel_claims', claims);
          if (window.FB && FB.saveDoc) { try { FB.saveDoc('pnl_travel_claims', plan.claim.id, plan.claim); } catch (e) {} }
        }
        /* v105: the card's wage posting lands in P&L's books,
           keyed by this dispatch (replace, never duplicate). */
        if (plan.wagePosting) {
          plan.wagePosting.dspId = cur.id;
          plan.wagePosting.id = 'cw_' + String(cur.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
          var cws = dspMergeCardWages(App._store.get('pnl_card_wages', []) || [], plan.wagePosting);
          App._store.set('pnl_card_wages', cws);
          if (window.FB && FB.saveDoc) { try { FB.saveDoc('pnl_card_wages', plan.wagePosting.id, plan.wagePosting); } catch (e) {} }
        }
        /* v41: dynamic tracker — a dispatch completed during a running
           session counts as one trip for the day, and its tickets' NET
           weights (tonnes) accumulate into the session's Weight total.
           No-op when the tracker is idle (App.noteDispatchCompleted). */
        try {
          if (window.App && App.noteDispatchCompleted) {
            var netTonnes = 0, wLoads = 0;
            tickets.forEach(function (t) {
              var nw = parseFloat(t && t.netWeight);
              if (nw > 0) { netTonnes += nw; wLoads++; }
            });
            if (!(netTonnes > 0) && parseFloat(cur.netWeight) > 0) {
              netTonnes = parseFloat(cur.netWeight); wLoads = 1;
            }
            App.noteDispatchCompleted({ netTonnes: netTonnes, weightLoads: wLoads });
          }
        } catch (e) {}
        manifestFeedPush('dispatch', 'Dispatch completed: ' + (cur.jobSite || '') +
          (cur.ticketNo ? ' · ticket #' + cur.ticketNo : '') + (amt > 0 ? ' · $' + amt.toFixed(2) : '') +
          (plan.disclosure ? ' · ' + plan.disclosure : ''));
        /* v82: closing the ACTIVE dispatch closes the shift with it
           (owner, Oct 15: "Closed dispatch was suppose to close my
           shift!"). This runs ONLY here — inside the completion the
           driver himself tapped (plain Complete or the
           close-with-ticket Confirm; both complete the active
           dispatch by construction, and both end in applyCompletion).
           Nothing stops a session because a dispatch window passed:
           the v53 autostart / dispatch-end paths never call this.
           Runs AFTER noteDispatchCompleted above, so the day's
           trip/weight accumulations land on the session it saves. */
        var shiftClosed = false;
        try {
          if (window.App && App.stopSessionOnDispatchClose) shiftClosed = !!App.stopSessionOnDispatchClose();
        } catch (e) {}
        /* v52: when travel was held out (office completion), the result
           text says so in plain words — the money is never dropped
           silently. Same pre-existing alert; extended message only. */
        var doneMsg = amt > 0 ? 'Dispatch completed — $' + amt.toFixed(2) + ' logged to Revenue.' : 'Dispatch completed.';
        if (plan.disclosure) {
          doneMsg = 'Dispatch completed' + (revEntry ? ' — $' + revEntry.amount + ' logged to Revenue' : '') + '. ' + plan.disclosure;
        }
        if (shiftClosed) doneMsg += ' Your shift was closed with it — the tracker is stopped.';
        /* v132: the closed day flows UP the pipe to his connected
           peers by itself — facts only (ConnectPipe.buildDay holds
           no rates and no money; the boss prices the same record
           on his side with his own rates). Guarded like every
           other pipe call: a pipe failure can never touch the
           close itself. */
        try { if (window.ConnectPipe) ConnectPipe.publishDay(dspRecordDate(cur)); } catch (e) {}
        alert(doneMsg);
      }

      var doneBtn = body.querySelector('#dp_complete');
      if (doneBtn) doneBtn.onclick = function () {
        var cur = active(); if (!cur) return;
        /* v143 (owner, Oct 17 16:22 MDT: "I think I closed the
           shift wrong, I didn't upload my ticket, because there
           was no way to choose a picture! And there was no
           confirmation before it actually closed the shift!"):
           plain Complete NO LONGER closes on this tap. It opens
           the SAME confirm step the ticket-photo close ends on
           (mode 'plain') — the summary first (date, hours split,
           loads, amount, the ticket photo or its absence in plain
           words), a photo door right there for a dispatch that
           has none yet, and one explicit Confirm that writes.
           The write itself (confirmClose's plain arm) is the
           v129 construction — dspBuildClosed + the ONE plan
           assembly + dspApplyCloseFacts — now through the
           verified dspCloseRecord transaction like the ticket
           close, instead of the old unverified direct writes. */
        var blocked = dspCloseBlocked(dspLoadDraft(), cur.id);
        if (blocked) { paintCloseNote(blocked); return; }
        paintCloseNote('');
        closeState = { targetId: cur.id, step: 'confirm', mode: 'plain', ticket: null, readFail: false };
        paintCloseFlow();
      };

      /* ---- v73: CLOSE WITH TICKET PHOTO ----
         One motion: snap the haul card → the reader reads it → ONE
         confirm view shows what was read and exactly what will
         happen → Confirm files the ticket (photo stored once),
         completes the dispatch and logs the earnings, all through
         the verified dspCloseRecord. Before Confirm, NOTHING is
         written (the read ticket is held in memory only) — a cancel
         or a failed write leaves the day exactly as it was. If the
         read is weak, the same confirm view takes typed hours; the
         photo still goes on the record. An unfinished edit on this
         dispatch blocks the open (dspCloseBlocked) — resolve the
         form first. */
      var closeState = null; // { targetId, step:'capture'|'confirm', mode:'ticket'|'plain', ticket, readFail }
      function closeFlowEl() { return body.querySelector('#dp_closeflow'); }
      function paintCloseNote(msg) {
        var e = body.querySelector('#dp_close_note');
        if (e) e.innerHTML = msg ?
          '<div style="border:2px solid var(--orange);border-radius:10px;padding:8px 10px;margin:6px 0 10px;">' + esc(msg) + '</div>' : '';
      }
      function closeTicketDesc(t) {
        return t.ocrType === 'haul_card' ? 'Haul card' :
               t.ocrType === 'scale_ticket' ? 'Scale ticket' :
               t.ocrType === 'rate_confirmation' ? 'Rate confirmation' :
               t.ocrType === 'bill_of_lading' ? 'Bill of lading' :
               t.ocrType === 'document' ? 'Document' : 'Ticket';
      }
      function closeTicketNum(t) {
        return t.cardNumber ? '#' + t.cardNumber :
               t.orderNo ? '#' + t.orderNo :
               t.ticketNo ? '#' + t.ticketNo : '';
      }
      function paintCloseFlow() {
        var wrap = closeFlowEl();
        if (!wrap) return;
        if (!closeState) { wrap.innerHTML = ''; return; }
        var t = closeState.ticket;
        if (closeState.step === 'capture') {
          wrap.innerHTML =
            '<div class="card" style="border:2px solid var(--orange);margin-top:10px"><h3>📸 Close with the ticket photo</h3>' +
            '<p class="note">Snap the haul card — the app reads it, shows you the close before anything happens, and one Confirm tap files the ticket, completes this dispatch and logs the earnings.</p>' +
            '<div style="display:flex;gap:10px;margin-bottom:8px;">' +
            '<button type="button" class="btn secondary" id="dp_ct_cam" style="flex:1;">📷 Take photo</button>' +
            '<button type="button" class="btn secondary" id="dp_ct_pick" style="flex:1;">📁 Choose file</button>' +
            '</div>' +
            /* v86: the photo is ONE door, never the only door (the
               owner's standing capture rule, same as fuel). A card
               he never held can't block the close: typing the ticket
               number + foreman hours by hand lands on the exact same
               confirm view. Before v86 this step offered the camera
               or nothing, so the Oct 15 live drive fell back to a
               plain Complete and lost the foreman-hours entry. */
            '<p class="note">No photo? Type the ticket number and the foreman hours by hand instead — the close works exactly the same.</p>' +
            '<button type="button" class="btn navy" id="dp_ct_manual" style="width:100%;margin-bottom:8px;">✍️ Type it instead — no photo</button>' +
            '<input type="file" id="dp_ct_img_cam" accept="image/*" capture="environment" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
            '<input type="file" id="dp_ct_img" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
            '<div id="dp_ct_status" style="font-size:14px;margin:6px 0;"></div>' +
            '<div id="dp_ct_preview"></div>' +
            '<div class="row"><button type="button" class="btn ghost" id="dp_ct_cancel">Cancel</button></div></div>';
          var camIn = wrap.querySelector('#dp_ct_img_cam');
          var fileIn = wrap.querySelector('#dp_ct_img');
          wrap.querySelector('#dp_ct_cam').onclick = function () { camIn.click(); };
          wrap.querySelector('#dp_ct_pick').onclick = function () { fileIn.click(); };
          wrap.querySelector('#dp_ct_cancel').onclick = function () { closeState = null; paintCloseFlow(); };
          wrap.querySelector('#dp_ct_manual').onclick = function () {
            closeToConfirm({ id: ticketId(), photo: null, ocrType: 'haul_card', manual: true, date: App._today() }, false);
          };
          camIn.onchange = handleClosePhoto;
          fileIn.onchange = handleClosePhoto;
          return;
        }
        /* ---- v143: plain Complete lands on this SAME confirm
           step (mode 'plain') — the summary, the photo door and
           one Confirm; nothing is written until Confirm
           (confirmClose's plain arm). ---- */
        if (closeState.mode === 'plain') { paintPlainConfirm(wrap); return; }
        /* ---- confirm step ---- */
        var readLines = '';
        if (t.manual) {
          readLines = '<div class="b">✍️ Typed by hand — no photo attached. The ticket number and hours below are the record.</div>';
        } else if (closeState.readFail) {
          readLines = '<div class="b" style="color:var(--orange)">⚠️ That photo couldn\'t be read — it is still attached below as the record. Type the hours from the card.</div>';
        } else if (t.docRead) {
          /* v117: cleaned at render like everywhere else — a
             stored pre-gate summary never prints gibberish. */
          var cleanRead2 = dspCleanDocRead(t.docRead);
          if (cleanRead2.found && cleanRead2.found.length) {
            readLines += '<div class="b">📄 Read: ' + esc(cleanRead2.found.join(' · ')) + '</div>';
          }
          if (cleanRead2.missing && cleanRead2.missing.length) {
            readLines += '<div class="b" style="color:var(--orange)">Couldn\'t find: ' + esc(cleanRead2.missing.join(', ')) + '</div>';
          }
        }
        /* v86: the ticket number is an editable field on EVERY
           confirm (it was display-only before, so a hand-typed
           close had nowhere to put the number at all — and a
           misread number on a photo close couldn't be fixed). */
        var inputs = '<label class="f">Ticket / card #</label>' +
          '<input id="dp_cf_ticketno" type="text" value="' + esc(t.cardNumber || t.orderNo || t.ticketNo || '') + '" placeholder="e.g. 23177">';
        if (t.ocrType === 'scale_ticket') {
          inputs += '<label class="f">Net weight (tonnes)</label>' +
            '<input id="dp_cf_net" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(t.netWeight || '') + '">';
        } else {
          inputs += '<label class="f">Foreman hours (from the card)</label>' +
            '<input id="dp_cf_hours" type="number" inputmode="decimal" min="0" step="0.25" value="' + esc(t.foremanHours || '') + '" placeholder="e.g. 9.5">';
          if (t.ocrType === 'haul_card') {
            inputs += '<label class="f">Payment unit (checked on card)</label><select id="dp_cf_punit">' +
              ['HOUR', 'TONNE', 'TONNE / KM', 'OTHER'].map(function (x) {
                return '<option' + (t.paymentUnit === x ? ' selected' : '') + '>' + x + '</option>';
              }).join('') + '</select>';
          }
          /* v82 (item 3b): LOADS for hourly card work — the card
             itself carries no count, so the count is confirmed
             here, in the same one pass as the hours. Pre-filled
             from the day's +1 load taps when he used them; blank
             stays unrecorded rather than inventing a number.
             v107: the learned-site count (the truck's own pit↔dump
             visits, js/geoloads.js) pre-fills when there are no
             taps — the count is never the driver's job (owner,
             Oct 16: "I don't even know and remember how many loads
             I did"), and this field is exactly where he can
             override the machine's count before it records.
             v140: the machine count pre-fills FIRST now — taps are
             the correction, used only when counting could not
             run (no count recorded). */
          var tapsNow = 0;
          try { if (window.App && App.trackerLoadTaps) tapsNow = App.trackerLoadTaps() || 0; } catch (e) {}
          var geoNow = 0;
          try {
            if (window.GeoLoads && GeoLoads.forDate) geoNow = (GeoLoads.forDate(App._today()) || {}).count || 0;
            if (!geoNow) {
              var gd107 = (App._store.get('geoloads', { days: {} }).days || {})[App._today()];
              if (gd107) geoNow = gd107.count || 0;
            }
          } catch (e) { geoNow = 0; }
          var loadsVal = (t.loads !== null && t.loads !== undefined && t.loads !== '') ? t.loads
            : (geoNow > 0 ? String(geoNow) : (tapsNow > 0 ? String(tapsNow) : ''));
          inputs += '<label class="f">Loads hauled today</label>' +
            '<input id="dp_cf_loads" type="number" inputmode="numeric" min="0" step="1" value="' + esc(loadsVal) + '" placeholder="e.g. 6">' +
            (geoNow > 0 && String(loadsVal) === String(geoNow) ? '<div class="b">Counted from your truck\'s pit &amp; dump visits today — change it if it\'s off.</div>'
              : (tapsNow > 0 && String(loadsVal) === String(tapsNow) ? '<div class="b">Counted from your +1 load taps today — change it if it\'s off.</div>' : ''));
        }
        wrap.innerHTML =
          '<div class="card" style="border:2px solid var(--orange);margin-top:10px"><h3>✅ Check the close</h3>' +
          (t.photo ? '<img src="' + t.photo + '" style="width:100%;border-radius:10px;margin-bottom:8px" alt="Ticket photo">' : '') +
          /* v143: the photo stays replaceable until Confirm — a
             wrong snap (or a hand-typed close that turns out to
             have the card after all) goes back to the capture
             step and picks again; nothing has been written. */
          '<div style="margin-bottom:8px;"><button type="button" class="btn ghost small" id="dp_cf_replace">' +
          (t.photo ? '↩ Use a different photo' : '📷 Add the ticket photo instead') + '</button></div>' +
          '<div class="kv"><span>Ticket</span><b>' + esc(closeTicketDesc(t) + ' ' + closeTicketNum(t)) + '</b></div>' +
          readLines +
          inputs +
          '<div id="dp_cf_plan" style="margin-top:8px"></div>' +
          '<div id="dp_cf_err"></div>' +
          '<div class="row" style="margin-top:10px">' +
          '<button type="button" class="btn primary" id="dp_cf_confirm">✅ Confirm — close this dispatch</button>' +
          '<button type="button" class="btn ghost" id="dp_cf_back">Cancel</button></div></div>';
        ['#dp_cf_hours', '#dp_cf_net', '#dp_cf_punit'].forEach(function (id) {
          var n = wrap.querySelector(id);
          if (n) { n.addEventListener('input', paintClosePlan); n.addEventListener('change', paintClosePlan); }
        });
        wrap.querySelector('#dp_cf_back').onclick = function () { closeState = null; paintCloseFlow(); };
        wrap.querySelector('#dp_cf_confirm').onclick = confirmClose;
        var repBtn = wrap.querySelector('#dp_cf_replace');
        if (repBtn) repBtn.onclick = function () {
          closeState.step = 'capture'; closeState.ticket = null; closeState.readFail = false;
          paintCloseFlow();
        };
        paintClosePlan();
      }
      /* ---- v143: the PLAIN confirm (plain Complete's landing) ----
         The same "Check the close" card with no new ticket: the
         record's own photo is shown, or its absence is stated
         plainly WITH the photo door right there (Take photo /
         Choose file / type it instead — picking one runs the
         shared reader and lands on the ticket confirm above, so
         the photo becomes the closing ticket exactly as if he
         had tapped "Close with ticket photo" first). The plan
         block below is the same assembly Confirm will log with.
         Cancel writes nothing; Confirm is confirmClose's plain
         arm. */
      function paintPlainConfirm(wrap) {
        var cur = active();
        if (!cur || cur.id !== closeState.targetId) { wrap.innerHTML = ''; return; }
        var photo = dspPhotoFor(cur);
        var photoBlock;
        if (photo) {
          photoBlock =
            '<img src="' + photo + '" style="width:100%;border-radius:10px;margin-bottom:8px" alt="Ticket photo">' +
            '<div class="b">📸 Ticket photo already on this dispatch — it closes with it.</div>';
        } else {
          photoBlock =
            '<div class="b" style="color:var(--orange)">No ticket photo on this dispatch yet.</div>' +
            '<div style="display:flex;gap:10px;margin:8px 0;">' +
            '<button type="button" class="btn secondary" id="dp_pl_cam" style="flex:1;">📷 Take photo</button>' +
            '<button type="button" class="btn secondary" id="dp_pl_pick" style="flex:1;">📁 Choose file</button></div>' +
            '<button type="button" class="btn navy" id="dp_pl_manual" style="width:100%;margin-bottom:8px;">✍️ Type the ticket instead — no photo</button>' +
            '<input type="file" id="dp_pl_img_cam" accept="image/*" capture="environment" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
            '<input type="file" id="dp_pl_img" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
            '<div id="dp_pl_status" style="font-size:14px;margin:6px 0;"></div><div id="dp_pl_preview"></div>';
        }
        wrap.innerHTML =
          '<div class="card" style="border:2px solid var(--orange);margin-top:10px"><h3>✅ Check the close</h3>' +
          photoBlock +
          '<div id="dp_cf_plan" style="margin-top:8px"></div>' +
          '<div id="dp_cf_err"></div>' +
          '<div class="row" style="margin-top:10px">' +
          '<button type="button" class="btn primary" id="dp_cf_confirm">✅ Confirm — close this dispatch</button>' +
          '<button type="button" class="btn ghost" id="dp_cf_back">Cancel</button></div></div>';
        if (!photo) {
          var camIn = wrap.querySelector('#dp_pl_img_cam');
          var fileIn = wrap.querySelector('#dp_pl_img');
          wrap.querySelector('#dp_pl_cam').onclick = function () { camIn.click(); };
          wrap.querySelector('#dp_pl_pick').onclick = function () { fileIn.click(); };
          wrap.querySelector('#dp_pl_manual').onclick = function () {
            closeState.mode = 'ticket';
            closeToConfirm({ id: ticketId(), photo: null, ocrType: 'haul_card', manual: true, date: App._today() }, false);
          };
          camIn.onchange = handlePlainPhoto;
          fileIn.onchange = handlePlainPhoto;
        }
        wrap.querySelector('#dp_cf_back').onclick = function () { closeState = null; paintCloseFlow(); };
        wrap.querySelector('#dp_cf_confirm').onclick = confirmClose;
        paintClosePlan();
      }
      /* a photo picked on the PLAIN confirm: it becomes the
         closing ticket — the shared reader runs and the ticket
         confirm replaces this view (closeToConfirm). */
      function handlePlainPhoto(ev) {
        var f = ev.target.files[0]; if (!f) return;
        var wrap = closeFlowEl();
        var statusEl = wrap ? wrap.querySelector('#dp_pl_status') : null;
        if (statusEl) statusEl.textContent = 'Reading ticket…';
        fileToThumb(f, function (thumbUrl) {
          var pv = wrap ? wrap.querySelector('#dp_pl_preview') : null;
          if (pv) pv.innerHTML = '<img src="' + thumbUrl + '" style="width:100%;border-radius:10px;margin-top:10px" alt="Ticket preview">';
          fileToOCRImage(f, function (ocrUrl) {
            if (!closeState) return; // cancelled while the photo was being prepared
            closeState.mode = 'ticket';
            runCloseOCR(ocrUrl || thumbUrl, thumbUrl);
          });
        });
      }
      /* the ticket as it stands in the confirm view, typed values in */
      function currentCloseTicket() {
        var wrap = closeFlowEl();
        var t = {};
        for (var k in closeState.ticket) { if (Object.prototype.hasOwnProperty.call(closeState.ticket, k)) t[k] = closeState.ticket[k]; }
        if (!wrap) return t;
        var noEl = wrap.querySelector('#dp_cf_ticketno');
        if (noEl) {
          /* a typed number wins; an EMPTY field never erases a
             number the read already found (the field opens showing
             it — empty here means untouched, not cleared). */
          var nv2 = noEl.value.trim();
          if (nv2) {
            if (t.cardNumber || t.ocrType === 'haul_card') t.cardNumber = nv2;
            else if (t.orderNo) t.orderNo = nv2;
            else t.ticketNo = nv2;
          }
        }
        var hEl = wrap.querySelector('#dp_cf_hours'); if (hEl) t.foremanHours = hEl.value.trim();
        var pEl = wrap.querySelector('#dp_cf_punit'); if (pEl) t.paymentUnit = pEl.value;
        var nEl = wrap.querySelector('#dp_cf_net'); if (nEl) t.netWeight = nEl.value.trim();
        var lEl = wrap.querySelector('#dp_cf_loads'); if (lEl) t.loads = lEl.value.trim();
        return t;
      }
      /* the confirm view's promise — computed by the SAME assembly
         Confirm will log with, so the two can never drift apart */
      function paintClosePlan() {
        var wrap = closeFlowEl();
        var el = wrap ? wrap.querySelector('#dp_cf_plan') : null;
        if (!el || !closeState || closeState.step !== 'confirm') return;
        var cur = active();
        if (!cur || cur.id !== closeState.targetId) { el.innerHTML = ''; return; }
        /* v143: the preview is built the way THIS confirm will
           close — plain mode carries no new ticket (the record as
           it stands), ticket mode carries the ticket being
           confirmed. Same one money assembly either way. */
        var preview = closeState.mode === 'plain'
          ? dspBuildClosed(cur, null, Date.now())
          : dspBuildClosed(cur, currentCloseTicket(), Date.now());
        var plan = dspCompletionFor(preview, completionSettings(preview)).plan;
        var h = '<div class="kv"><span>Date</span><b>' + esc(dspRecordDate(cur) || '') + '</b></div>' +
          '<div class="kv"><span>Dispatch</span><b>' + esc(cur.jobSite || cur.pickup || '—') + '</b></div>' +
          '<div class="kv"><span>Loads</span><b>' + esc(preview.loads != null && preview.loads !== '' ? String(preview.loads) : '—') + '</b></div>';
        if (plan.entry) {
          h += '<div class="kv"><span>Logs to Revenue</span><b>$' + esc(plan.entry.amount) + '</b></div>' +
               '<div class="b">' + esc(plan.entry.note) + '</div>';
        } else {
          h += '<div class="b" style="color:var(--orange)">No earnings entry will be logged — no hours or amount on the ticket yet. The ticket still attaches as the record, and the dispatch still closes.</div>';
        }
        if (plan.disclosure) h += '<div class="b">' + esc(plan.disclosure) + '</div>';
        el.innerHTML = h;
      }
      function showCloseError(msg) {
        var wrap = closeFlowEl();
        var e = wrap ? wrap.querySelector('#dp_cf_err') : null;
        if (e) e.innerHTML = '<div style="border:2px solid #c0392b;background:#fdecea;border-radius:10px;padding:10px;margin:8px 0;color:#7b1d12">' + esc(msg) + '</div>';
      }
      function confirmClose() {
        var cur = active();
        if (!cur || !closeState || cur.id !== closeState.targetId) {
          showCloseError('⚠️ This dispatch changed while you were closing it — nothing was closed. Reopen the dispatch and try again.');
          return;
        }
        var blocked = dspCloseBlocked(dspLoadDraft(), cur.id);
        if (blocked) { showCloseError(blocked); return; }
        if (closeState.mode === 'plain') {
          /* v143: plain Complete's Confirm — the v129 write,
             unchanged in construction (dspBuildClosed with no new
             ticket, the ONE plan assembly, close facts stamped
             from it), now through the verified dspCloseRecord
             transaction the ticket close has always used, so a
             failed write closes nothing and says so right here. */
          var doneRec = dspBuildClosed(cur, null, Date.now());
          var planRes = dspCompletionFor(doneRec, completionSettings(doneRec));
          doneRec = dspApplyCloseFacts(doneRec, planRes.plan);
          var resP = dspCloseRecord(doneRec);
          if (!resP.ok) {
            showCloseError('⚠️ That close did NOT go through — the app storage on your phone looks full, or the write failed, so nothing was closed and nothing was logged. Your dispatch is still active. Free up some phone space, then tap Confirm again.');
            return;
          }
          fbSave(doneRec);
          applyCompletion(doneRec, planRes);
          closeState = null;
          api.render(body);
          return;
        }
        var t = currentCloseTicket();
        closeState.ticket = t;
        var doneRec = dspBuildClosed(cur, t, Date.now());
        /* v129: stamp the close facts onto the record from the
           SAME plan assembly Confirm is about to log with (the
           preview already promised these numbers) — the record
           leaves this close carrying its ticket #, material and
           day amount, and applyCompletion reuses the plan. */
        var planRes = dspCompletionFor(doneRec, completionSettings(doneRec));
        doneRec = dspApplyCloseFacts(doneRec, planRes.plan);
        var res = dspCloseRecord(doneRec);
        if (!res.ok) {
          showCloseError('⚠️ That close did NOT go through — the app storage on your phone looks full, or the write failed, so nothing was closed and nothing was logged. Your dispatch is still active and this ticket is still here. Free up some phone space, then tap Confirm again.');
          return;
        }
        fbSave(doneRec);
        applyCompletion(doneRec, planRes);
        closeState = null;
        api.render(body);
      }
      function closeToConfirm(ticket, readFail) {
        if (!closeState) return; // cancelled while the read was running
        closeState.ticket = ticket;
        closeState.readFail = !!readFail;
        closeState.step = 'confirm';
        paintCloseFlow();
      }
      /* the shared ticket reader — the same engine the form uses
         (recognizeWithRotation → parse → toDispatchForm) */
      function runCloseOCR(ocrUrl, photoUrl) {
        var wrap = closeFlowEl();
        var statusEl = wrap ? wrap.querySelector('#dp_ct_status') : null;
        if (!window.TicketOCR || !TicketOCR.recognizeWithRotation) {
          closeToConfirm({ id: ticketId(), photo: photoUrl, ocrType: 'unknown', date: App._today() }, true);
          return;
        }
        /* v142: the cloud read starts at capture here too — a haul
           card's read is handwritten, so this funnel escalates
           almost every time, and its confirm used to wait for the
           local read AND THEN the whole cloud read in series. The
           escalation below now adopts the in-flight read. (No
           settle callback: a rich local read opens the confirm
           immediately, exactly as before.) */
        var early = dspBeginEarly(ocrUrl || photoUrl, null);
        TicketOCR.recognizeWithRotation(ocrUrl || photoUrl, function (p) {
          try { if (statusEl) statusEl.textContent = 'Reading ticket… ' + Math.round(p * 100) + '%'; } catch (e) {}
        }).then(function (text) {
          var parsed = TicketOCR.parse(text);
          var form = TicketOCR.toDispatchForm(parsed);
          var docRead = (window.TicketOCR.describeRead) ? TicketOCR.describeRead(parsed, form) : null;
          var ticket = {
            id: ticketId(),
            photo: photoUrl,
            ocrType: parsed._type,
            ticketNo: parsed.ticketNo || form.ticketNo || null,
            orderNo: parsed.orderNo || null,
            docRead: docRead,
            cardNumber: parsed.cardNumber || null,
            /* v107: hours/clocks the read carried prefill the
               confirm fields — still confirmed in the view before
               anything saves, exactly as a typed value is. */
            foremanHours: parsed.totalHours || null,
            paymentUnit: null,  // checkbox state — confirmed in the view
            startTime: parsed.startTime || null,
            finishTime: parsed.finishTime || null,
            netWeight: form.netWeight || null,
            grossWeight: form.grossWeight || null,
            tareWeight: form.tareWeight || null,
            date: App._today()
          };
          /* v107: a thin local read (every haul card — its facts
             are handwritten) escalates to Power Read BEFORE the
             confirm opens, so the confirm shows the best read the
             app could get, not the first one that failed. */
          if (readNeedsEscalation(parsed, docRead)) {
            if (statusEl) statusEl.textContent = '⚡ Asking the power read…';
            escalateTicketRead(ocrUrl || photoUrl, function (merged) {
              if (merged) {
                if (!ticket.cardNumber && merged.parsed.cardNumber) ticket.cardNumber = merged.parsed.cardNumber;
                if (!ticket.ticketNo && (merged.parsed.ticketNo || merged.form.ticketNo)) ticket.ticketNo = merged.parsed.ticketNo || merged.form.ticketNo;
                if (!ticket.foremanHours && merged.parsed.totalHours) ticket.foremanHours = merged.parsed.totalHours;
                if (!ticket.startTime && merged.parsed.startTime) ticket.startTime = merged.parsed.startTime;
                if (!ticket.finishTime && merged.parsed.finishTime) ticket.finishTime = merged.parsed.finishTime;
                if (merged.docRead && (!ticket.docRead || (merged.docRead.found || []).length > ((ticket.docRead && ticket.docRead.found) || []).length)) ticket.docRead = merged.docRead;
              }
              closeToConfirm(ticket, false);
            }, early.prImg);
          } else {
            closeToConfirm(ticket, false);
          }
        }).catch(function () {
          closeToConfirm({ id: ticketId(), photo: photoUrl, ocrType: 'unknown', date: App._today() }, true);
        });
      }
      function handleClosePhoto(ev) {
        var f = ev.target.files[0]; if (!f) return;
        var wrap = closeFlowEl();
        var statusEl = wrap ? wrap.querySelector('#dp_ct_status') : null;
        if (statusEl) statusEl.textContent = 'Reading ticket…';
        fileToThumb(f, function (thumbUrl) {
          var pv = wrap ? wrap.querySelector('#dp_ct_preview') : null;
          if (pv) pv.innerHTML = '<img src="' + thumbUrl + '" style="width:100%;border-radius:10px;margin-top:10px" alt="Ticket preview">';
          fileToOCRImage(f, function (ocrUrl) {
            runCloseOCR(ocrUrl || thumbUrl, thumbUrl);
          });
        });
      }
      var closeBtn = body.querySelector('#dp_close_ticket');
      if (closeBtn) closeBtn.onclick = function () {
        var cur = active(); if (!cur) return;
        var blocked = dspCloseBlocked(dspLoadDraft(), cur.id);
        if (blocked) { paintCloseNote(blocked); return; }
        paintCloseNote('');
        closeState = { targetId: cur.id, step: 'capture', mode: 'ticket', ticket: null, readFail: false };
        paintCloseFlow();
      };
      var cancelBtn = body.querySelector('#dp_cancel');
      if (cancelBtn) cancelBtn.onclick = function () {
        if (!confirm('Cancel the active dispatch?')) return;
        var cur = active();
        if (cur) {
          cur.status = 'cancelled';
          var l = list();
          for (var i = 0; i < l.length; i++) if (l[i].id === cur.id) { l[i] = cur; break; }
          W('list', l); fbSave(cur);
        }
        W('active', null); api.render(body);
      };

      body.querySelectorAll('[data-start]').forEach(function (b) {
        b.onclick = function () {
          var d = list()[+b.getAttribute('data-start')];
          if (dspActivateRecord(d)) api.render(body);
        };
      });
      /* v103: Delete arms the row's in-app confirm (no native
         dialog anywhere in this flow); only the strip's own
         Delete button removes the record. */
      body.querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = function () {
          var d = list()[+b.getAttribute('data-del')];
          pendingDelId = d ? d.id : null;
          api.render(body);
        };
      });
      body.querySelectorAll('[data-delconfirm]').forEach(function (b) {
        b.onclick = function () {
          var l = list(); l.splice(+b.getAttribute('data-delconfirm'), 1); W('list', l);
          pendingDelId = null;
          api.render(body);
        };
      });
      body.querySelectorAll('[data-delcancel]').forEach(function (b) {
        b.onclick = function () { pendingDelId = null; api.render(body); };
      });
      body.querySelectorAll('[data-edit]').forEach(function (b) {
        b.onclick = function () { startEdit(list()[+b.getAttribute('data-edit')]); };
      });
      /* v129: a completed record's row View opens its face. */
      body.querySelectorAll('[data-view]').forEach(function (b) {
        b.onclick = function () {
          var d = list()[+b.getAttribute('data-view')];
          if (d && d.status === 'completed') {
            viewCompletedId = d.id;
            api.render(body);
            dspScrollToCompleted(body);
          }
        };
      });

      /* v132: the pipe wiring. EVERY role: land my inbox (a
         boss-sent dispatch becomes my scheduled record — never
         active, never disturbing my active day) and mark what I
         was shown as seen. BOSS faces: fetch today's crew into
         the board + my sent box, and wire the send card. All
         guarded: the pipe can never break this screen. */
      try {
        if (window.ConnectPipe) {
          ConnectPipe.pullInbox().then(function (n) {
            if (n > 0) {
              pipeFlash = '📩 ' + n + ' dispatch' + (n === 1 ? '' : 'es') +
                ' arrived from your connection — in your list below.';
              api.render(body);
            }
          });
          ConnectPipe.markSeen(list());
          if ((App.userRole ? App.userRole() : 'driver') !== 'driver') {
            ConnectPipe.fetchCrew(App._today()).then(function (days) {
              pipeDays = days;
              var w = body.querySelector('#dp_crew');
              if (w) { w.innerHTML = crewHtml(); wirePipe(body); }
            });
            ConnectPipe.listSent().then(function (sent) {
              pipeSent = sent;
              var w2 = body.querySelector('#dp_sentlist');
              if (w2) w2.innerHTML = sentHtml();
            });
            wirePipe(body);
          }
        }
      } catch (e) {}

      paintIngest(); // v65: suggestions + paste box (see above)
    }
  };

  Meticulous.modules.dispatch = api;
})();
