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
  var W = function (k, v) { App._store.set('dsp_' + k, v); };
  var esc = function (s) { return App._esc(s); };

  function list() { return S('list', []); }       // saved / history
  function active() { return S('active', null); } // current active dispatch
  function uid() { return 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

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
          (a.photo ? '<img src="' + a.photo + '" style="width:100%;border-radius:10px;margin-top:8px" alt="Ticket photo">' : '') +
          '<div class="row" style="margin-top:10px">' +
          '<button class="btn primary" id="dp_complete">✅ Complete dispatch</button>' +
          '<button class="btn ghost" id="dp_cancel">Cancel</button></div></div>';
      }

      /* ---- New dispatch form ---- */
      h += '<div class="card"><h3>＋ New dispatch</h3>' +
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
            (d.photo ? '<img src="' + d.photo + '" style="width:100%;border-radius:8px;margin-top:6px" alt="Ticket">' : '') +
            '<div class="row" style="margin-top:8px">' +
            (d.status === 'saved' ? '<button class="btn small primary" data-start="' + i + '">Start</button>' : '') +
            '<button class="btn small ghost" data-del="' + i + '">Delete</button></div></div>';
        }).join('') : '<div class="empty">No dispatches yet. Create one above.</div>') + '</div>';

      body.innerHTML = h;

      /* v26: Multi-ticket — drivers can have MULTIPLE haul cards per day.
         Each ticket: photo + OCR data + manually-confirmed hours/payment unit.
         "Add another ticket" appends; never overwrites. */
      var pendingTickets = []; // [{id, photo, ocrType, ticketNo, cardNumber, foremanHours, paymentUnit, netWeight, grossWeight, tareWeight}]
      var pendingPhoto = null; // legacy single-photo (kept for backward compat)
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
            renderTicketList();
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
        };
      }

      function updateNameEl() {
        var n = pendingTickets.length;
        body.querySelector('#dp_img_name').textContent =
          n === 0 ? 'No tickets yet — add the first one above.' :
          n + ' ticket' + (n > 1 ? 's' : '') + ' added. Tap "Take ticket photo" to add another.';
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
        }).catch(function () {
          body.querySelector('#dp_img_name').textContent = 'Photo added (OCR unavailable)';
          pendingTickets.push({ id: ticketId(), photo: photoUrl, ocrType: 'unknown', date: App._today() });
          renderTicketList();
          updateNameEl();
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
          id: uid(),
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
          photo: pendingPhoto,
          tickets: pendingTickets.slice(), // v26: multi-ticket array
          date: App._today(),
          status: 'saved'
        };
      }
      function pushDispatch(d) {
        var l = list(); l.push(d); W('list', l); fbSave(d); return d;
      }

      body.querySelector('#dp_add').onclick = function () {
        var d = readForm();
        if (!d.jobSite) { alert('Enter the job site.'); return; }
        pushDispatch(d);
        manifestFeedPush('dispatch', 'Dispatch saved: ' + d.jobSite + (d.ticketNo ? ' · ticket #' + d.ticketNo : ''));
        api.render(body);
      };
      body.querySelector('#dp_addstart').onclick = function () {
        var d = readForm();
        if (!d.jobSite) { alert('Enter the job site.'); return; }
        d.status = 'active'; d.startedAt = Date.now();
        pushDispatch(d); W('active', d);
        manifestFeedPush('dispatch', 'Dispatch started: ' + d.jobSite + (d.ticketNo ? ' · ticket #' + d.ticketNo : ''));
        if (window.FB && FB.localNotify) { try { FB.localNotify('Dispatch started', d.jobSite); } catch (e) {} }
        api.render(body);
      };

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
