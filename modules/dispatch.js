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
    var out = { fields: draft.fields || {}, tickets: [], photo: null, photoDropped: true, savedAt: draft.savedAt || 0 };
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
  /* ================= DSP-SAVE-END ================= */

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

  var api = {
    status: function () {
      var a = active();
      if (a) return 'Active: ' + (a.jobSite || a.pickup || 'dispatch');
      var done = list().filter(function (d) { return d.status === 'completed'; }).length;
      return done ? done + ' completed' : list().length + ' saved';
    },
    getActive: function () { return active(); },
    render: function (body) {
      var a = active();
      var h = '';

      /* ---- Active dispatch card ---- */
      if (a) {
        h += '<div class="card" style="border:2px solid var(--orange)"><h3>🚛 Active dispatch</h3>' +
          '<div class="kv"><span>Status</span><b style="color:var(--orange)">● In progress</b></div>' +
          '<div class="kv"><span>Job site</span><b>' + esc(a.jobSite || a.pickup || '—') + '</b></div>' +
          (a.dropoff ? '<div class="kv"><span>Drop-off</span><b>' + esc(a.dropoff) + '</b></div>' : '') +
          (a.material ? '<div class="kv"><span>Material</span><b>' + esc(a.material) + '</b></div>' : '') +
          (a.ticketNo ? '<div class="kv"><span>Ticket #</span><b>' + esc(a.ticketNo) + '</b></div>' : '') +
          (a.amount ? '<div class="kv"><span>Amount</span><b>$' + esc(a.amount) + '</b></div>' : '') +
          '<div class="kv"><span>Started</span><b>' + esc(fmtTime(a.startedAt)) + '</b></div>' +
          (dspPhotoFor(a) ? '<img src="' + dspPhotoFor(a) + '" style="width:100%;border-radius:10px;margin-top:8px" alt="Ticket photo">' : '') +
          '<div class="row" style="margin-top:10px">' +
          '<button class="btn primary" id="dp_complete">✅ Complete dispatch</button>' +
          '<button class="btn ghost" id="dp_cancel">Cancel</button></div></div>';
      }

      /* ---- New dispatch form ---- */
      h += '<div class="card"><h3>＋ New dispatch</h3>' +
        '<div id="dp_draft_note"></div>' +
        '<div id="dp_draft_warn"></div>' +
        '<div id="dp_save_err"></div>' +
        '<label class="f">Job site</label><input id="dp_site" placeholder="e.g. Aecon — Deerfoot site">' +
        '<div class="row"><div><label class="f">Scheduled</label><input id="dp_when" type="datetime-local"></div>' +
        '<div><label class="f">Truck type</label><input id="dp_equip" placeholder="e.g. Tandem"></div></div>' +
        '<div id="dp_pin" style="font-size:13px;margin:2px 0 6px;"></div>' +
        '<input type="hidden" id="dp_lat"><input type="hidden" id="dp_lng">' +
        '<div class="row"><div><label class="f">Material</label><input id="dp_mat" placeholder="e.g. Gravel"></div>' +
        '<div><label class="f">Ticket #</label><input id="dp_ticket" placeholder="e.g. 48213"></div></div>' +
        '<div class="row"><div><label class="f">Amount $ (optional)</label><input id="dp_amt" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"></div>' +
        '<div><label class="f">Loads</label><input id="dp_loads" type="number" min="1" step="1" value="1"></div></div>' +
        '<label class="f">Notes</label><input id="dp_notes" placeholder="Gate code, contact…">' +
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
        '<div class="row" style="margin-top:10px"><button class="btn primary" id="dp_add">Save dispatch</button>' +
        '<button class="btn navy" id="dp_addstart">Save & start</button></div></div>';

      /* ---- History ---- */
      var hist = list().slice().reverse();
      h += '<div class="card"><h3>📋 History</h3>' +
        (hist.length ? hist.map(function (d, ri) {
          var i = list().length - 1 - ri;
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
            (d.amount ? ' · $' + esc(d.amount) : '') + '</div>' +
            (dspPhotoFor(d) ? '<img src="' + dspPhotoFor(d) + '" style="width:100%;border-radius:8px;margin-top:6px" alt="Ticket">' : '') +
            '<div class="row" style="margin-top:8px">' +
            (d.status === 'saved' ? '<button class="btn small primary" data-start="' + i + '">Start</button>' : '') +
            '<button class="btn small ghost" data-del="' + i + '">Delete</button></div></div>';
        }).join('') : '<div class="empty">No dispatches yet. Create one above.</div>') + '</div>';

      body.innerHTML = h;

      /* v26: Multi-ticket — drivers can have MULTIPLE haul cards per day.
         Each ticket: photo + OCR data + manually-confirmed hours/payment unit.
         "Add another ticket" appends; never overwrites. */
      /* v48: the form's working state is restored from the dsp_draft
         store key when one exists, and re-persisted on every change —
         an unsaved form now survives app close, OTA reload, and
         navigating away. The draft is cleared only after a verified
         save (see attemptSave below). */
      var draft0 = dspLoadDraft();
      var pendingTickets = (draft0 && draft0.tickets) ? draft0.tickets.slice() : []; // [{id, photo, ocrType, ticketNo, cardNumber, foremanHours, paymentUnit, netWeight, grossWeight, tareWeight}]
      var pendingPhoto = draft0 ? (draft0.photo || null) : null; // legacy single-photo (kept for backward compat)
      if (pendingPhoto === null) { var _dp0 = dspPhotoFor({ tickets: pendingTickets }); if (_dp0) pendingPhoto = _dp0; }

      function collectDraft() {
        var q = function (id) { var n = body.querySelector(id); return n ? n.value : ''; };
        return {
          fields: {
            jobSite: q('#dp_site'), scheduledAt: q('#dp_when'), equipment: q('#dp_equip'),
            lat: q('#dp_lat'), lng: q('#dp_lng'),
            material: q('#dp_mat'), ticketNo: q('#dp_ticket'),
            amount: q('#dp_amt'), loads: q('#dp_loads'), notes: q('#dp_notes')
          },
          tickets: pendingTickets.slice(),
          photo: pendingPhoto,
          savedAt: Date.now()
        };
      }
      function draftIsEmpty(d) {
        var f = d.fields || {};
        var any = f.jobSite || f.scheduledAt || f.equipment || f.material ||
                  f.ticketNo || f.amount || f.notes || f.lat || f.lng;
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
        set('#dp_site', f.jobSite); set('#dp_when', f.scheduledAt); set('#dp_equip', f.equipment);
        set('#dp_lat', f.lat); set('#dp_lng', f.lng);
        set('#dp_mat', f.material); set('#dp_ticket', f.ticketNo);
        set('#dp_amt', f.amount); if (f.loads) set('#dp_loads', f.loads); set('#dp_notes', f.notes);
        if (f.lat !== '' && f.lat !== undefined && f.lat !== null && f.lng !== '' && f.lng !== undefined && f.lng !== null) {
          body.querySelector('#dp_pin').innerHTML = '📍 Map pin set' +
            ' — <a href="https://www.google.com/maps?q=' + f.lat + ',' + f.lng + '" target="_blank" rel="noopener">Open in Maps</a>';
        }
        if (!draftIsEmpty({ fields: f, tickets: pendingTickets, photo: pendingPhoto })) {
          body.querySelector('#dp_draft_note').innerHTML =
            '<div style="border:2px solid var(--orange);border-radius:10px;padding:8px 10px;margin-bottom:10px">📝 <b>Draft restored</b> — this unsaved dispatch was kept from last time. Check it, then tap Save.' +
            (draft0.photoDropped ? '<br>⚠️ The ticket photo could not be kept (the app storage on your phone was full) — please add the photo again.' : '') + '</div>';
        }
      }
      ['#dp_site', '#dp_when', '#dp_equip', '#dp_mat', '#dp_ticket', '#dp_amt', '#dp_loads', '#dp_notes'].forEach(function (id) {
        var n = body.querySelector(id);
        if (n) { n.addEventListener('input', persistDraft); n.addEventListener('change', persistDraft); }
      });

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
             couldn't find. */
          var readLines = '';
          if (t.docRead) {
            if (t.docRead.found && t.docRead.found.length) {
              readLines += '<div class="b">📄 Read: ' + esc(t.docRead.found.join(' · ')) + '</div>';
            }
            if (t.docRead.missing && t.docRead.missing.length) {
              readLines += '<div class="b" style="color:var(--orange)">Couldn\'t find: ' + esc(t.docRead.missing.join(', ')) + '</div>';
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

      /* v48: restore a kept draft (fields + tickets + note) */
      if (draft0) { restoreDraft(); renderTicketList(); updateNameEl(); }

      /* v26: OCR — after photo selected, run Tesseract, then append ticket.
         v35: OCR runs on the larger rendition (ocrUrl); the ticket keeps
         the small thumb (photoUrl). Documents (rate confirmations / BOLs)
         go through the full field-sweep reader; upside-down scans are
         retried at 180° inside recognizeWithRotation. */
      function runOCR(ocrUrl, photoUrl) {
        if (!window.TicketOCR) return;
        var nameEl = body.querySelector('#dp_img_name');
        nameEl.textContent = 'Reading ticket…';
        TicketOCR.recognizeWithRotation(ocrUrl || photoUrl, function (p) {
          try { nameEl.textContent = 'Reading ticket… ' + Math.round(p * 100) + '%'; } catch (e) {}
        }).then(function (text) {
          var parsed = TicketOCR.parse(text);
          var form = TicketOCR.toDispatchForm(parsed);
          var docRead = (window.TicketOCR.describeRead) ? TicketOCR.describeRead(parsed, form) : null;
          var isDoc = parsed._type === 'rate_confirmation' || parsed._type === 'bill_of_lading' || parsed._type === 'document';
          // Auto-fill dispatch form from first ticket (if empty)
          if (pendingTickets.length === 0) {
            if (form.jobSite && !body.querySelector('#dp_site').value) body.querySelector('#dp_site').value = form.jobSite;
            /* v35: rate/amount from a rate confirmation */
            if (form.amount && !body.querySelector('#dp_amt').value) body.querySelector('#dp_amt').value = form.amount;
            /* v31: scheduled datetime + truck type + map pin from OCR */
            if (form.scheduledAt && !body.querySelector('#dp_when').value) body.querySelector('#dp_when').value = form.scheduledAt;
            if (form.equipment && !body.querySelector('#dp_equip').value) body.querySelector('#dp_equip').value = form.equipment;
            if (form.lat !== undefined && form.lat !== null && form.lng !== undefined && form.lng !== null) {
              body.querySelector('#dp_lat').value = form.lat;
              body.querySelector('#dp_lng').value = form.lng;
              body.querySelector('#dp_pin').innerHTML = '📍 Map pin set' +
                (form.coordinates ? ' (' + esc(form.coordinates) + ')' : '') +
                ' — <a href="https://www.google.com/maps?q=' + form.lat + ',' + form.lng + '" target="_blank" rel="noopener">Open in Maps</a>';
            }
            if (form.material && !body.querySelector('#dp_mat').value) body.querySelector('#dp_mat').value = form.material;
            if (form.ticketNo && !body.querySelector('#dp_ticket').value) body.querySelector('#dp_ticket').value = form.ticketNo;
            if (form.notes && !body.querySelector('#dp_notes').value) body.querySelector('#dp_notes').value = form.notes;
          }
          // Build ticket object
          var t = {
            id: ticketId(),
            photo: photoUrl,
            ocrType: parsed._type,
            ticketNo: parsed.ticketNo || form.ticketNo || null,
            orderNo: parsed.orderNo || null,
            docRead: docRead,
            cardNumber: parsed.cardNumber || null,
            foremanHours: null, // manual — haul cards need user confirmation
            paymentUnit: null,  // manual — checkbox state needs user confirmation
            netWeight: form.netWeight || null,
            grossWeight: form.grossWeight || null,
            tareWeight: form.tareWeight || null,
            date: App._today()
          };
          pendingTickets.push(t);
          pendingPhoto = photoUrl; // legacy compat
          renderTicketList();
          updateNameEl();
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
        return {
          jobSite: body.querySelector('#dp_site').value.trim(),
          scheduledAt: body.querySelector('#dp_when').value || '', // v31: dispatch datetime from OCR/manual
          equipment: body.querySelector('#dp_equip').value.trim(), // v31: truck type (Tandem…)
          lat: latV !== '' ? parseFloat(latV) : null,               // v31: map pin from OCR coords
          lng: lngV !== '' ? parseFloat(lngV) : null,
          material: body.querySelector('#dp_mat').value.trim(),
          ticketNo: body.querySelector('#dp_ticket').value.trim(),
          amount: body.querySelector('#dp_amt').value.trim(),
          loads: body.querySelector('#dp_loads').value.trim() || '1',
          notes: body.querySelector('#dp_notes').value.trim(),
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
        if (start) {
          if (!lastSaveTry.startedAt) lastSaveTry.startedAt = Date.now();
          d.status = 'active'; d.startedAt = lastSaveTry.startedAt;
        }
        var res = dspSaveRecord(d, start);
        if (!res.ok) {
          persistDraft(); // best effort — the on-screen form is untouched either way
          showSaveError('⚠️ That save did NOT go through — the app storage on your phone looks full, or the write failed, so your dispatch was not saved. Your entry is kept as a draft below, so nothing is lost. Free up some phone space, then tap ' + (start ? '“Save & start”' : '“Save dispatch”') + ' again.');
          return;
        }
        lastSaveTry = null;
        dspClearDraft(); // only a verified save clears the draft
        fbSave(d);
        manifestFeedPush('dispatch', 'Dispatch ' + (start ? 'started' : 'saved') + ': ' + d.jobSite + (d.ticketNo ? ' · ticket #' + d.ticketNo : ''));
        if (start && window.FB && FB.localNotify) { try { FB.localNotify('Dispatch started', d.jobSite); } catch (e) {} }
        api.render(body);
      }

      body.querySelector('#dp_add').onclick = function () { attemptSave(false); };
      body.querySelector('#dp_addstart').onclick = function () { attemptSave(true); };

      var doneBtn = body.querySelector('#dp_complete');
      if (doneBtn) doneBtn.onclick = function () {
        var cur = active(); if (!cur) return;
        cur.status = 'completed'; cur.endedAt = Date.now();
        var l = list();
        for (var i = 0; i < l.length; i++) if (l[i].id === cur.id) { l[i] = cur; break; }
        W('list', l); W('active', null); fbSave(cur);
        /* One confirmation updates Revenue: log the dispatch earnings.
           v26: Multi-ticket — sum foreman hours from all tickets + travel bonus.
           Pay by Weight: sum net weights × rate/tonne. */
        var o = App._store.get('onboarding', {});
        var std = (o.payStandard || 'hourly').toLowerCase();
        var rate = parseFloat(o.payRate) || 0;
        var travelBonus = parseFloat(o.travelBonus) || 0;
        var revEntry = null;
        var tickets = cur.tickets || [];
        if (tickets.length && window.TicketOCR) {
          var sum = TicketOCR.summarizeTickets(tickets, travelBonus);
          if (std === 'weight' && sum.totalNetWeight > 0 && rate > 0) {
            var wAmt = sum.totalNetWeight * rate;
            revEntry = {
              date: App._today(),
              amount: wAmt.toFixed(2),
              tons: sum.totalNetWeight.toFixed(2),
              type: 'weight',
              loads: tickets.length,
              note: 'Dispatch: ' + (cur.jobSite || '') +
                ' · ' + sum.totalNetWeight.toFixed(2) + 't @ $' + rate + '/t' +
                ' (' + tickets.length + ' tickets)'
            };
          } else if ((std === 'hourly' || std === 'trip') && sum.totalForemanHours > 0) {
            var hAmt = sum.totalPaidHours * rate;
            var brk = sum.breakdown.map(function (b) {
              return b.label + ': ' + (b.foremanHours || 0) + 'h';
            }).join(', ');
            revEntry = {
              date: App._today(),
              amount: hAmt.toFixed(2),
              hours: sum.totalPaidHours.toFixed(2),
              type: 'hourly',
              loads: tickets.length,
              note: 'Dispatch: ' + (cur.jobSite || '') +
                ' · foreman ' + sum.totalForemanHours + 'h + travel ' + travelBonus + 'h' +
                ' = ' + sum.totalPaidHours + 'h' +
                (brk ? ' (' + brk + ')' : '')
            };
          }
        }
        // Fallback: legacy single amount
        if (!revEntry) {
          var amt = parseFloat(cur.amount);
          if (amt > 0) {
            revEntry = {
              date: App._today(),
              amount: amt.toFixed(2),
              type: 'load',
              loads: cur.loads || 1,
              note: 'Dispatch: ' + (cur.jobSite || '') + (cur.ticketNo ? ' · ticket #' + cur.ticketNo : '')
            };
          } else if (cur.netWeight && std === 'weight' && rate > 0) {
            // Legacy single-weight dispatch
            var lwAmt = parseFloat(cur.netWeight) * rate;
            revEntry = {
              date: App._today(),
              amount: lwAmt.toFixed(2),
              tons: cur.netWeight,
              type: 'weight',
              loads: 1,
              note: 'Dispatch: ' + (cur.jobSite || '') + ' · ' + cur.netWeight + 't @ $' + rate + '/t'
            };
          }
        }
        if (revEntry && Meticulous.modules.revenue && Meticulous.modules.revenue.addEntry) {
          Meticulous.modules.revenue.addEntry(revEntry);
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
          (cur.ticketNo ? ' · ticket #' + cur.ticketNo : '') + (amt > 0 ? ' · $' + amt.toFixed(2) : ''));
        alert(amt > 0 ? 'Dispatch completed — $' + amt.toFixed(2) + ' logged to Revenue.' : 'Dispatch completed.');
        api.render(body);
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
          d.status = 'active'; d.startedAt = Date.now();
          var l = list(); l[+b.getAttribute('data-start')] = d;
          W('list', l); W('active', d); fbSave(d);
          if (window.FB && FB.localNotify) { try { FB.localNotify('Dispatch started', d.jobSite || ''); } catch (e) {} }
          api.render(body);
        };
      });
      body.querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = function () {
          if (!confirm('Delete this dispatch?')) return;
          var l = list(); l.splice(+b.getAttribute('data-del'), 1); W('list', l); api.render(body);
        };
      });
    }
  };

  Meticulous.modules.dispatch = api;
})();
