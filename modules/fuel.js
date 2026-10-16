/* Fuel & Expense module — Meticulous standalone (Meticulous.modules convention) */
(function () {
  'use strict';
  var S = function (k, d) { return App._store.get('fuel_' + k, d); };
  var W = function (k, v) { App._store.set('fuel_' + k, v); };
  var esc = function (s) { return App._esc(s); };

  function fills() { return S('fills', []); }

  /* FUEL-OPEN-BEGIN — v75: records you can open (owner, Oct 14:
     "These entries should be editable... When clicked nothing
     happens"). The guard / edit / verified-save logic lives here so
     the tests drive the shipped code; the render wiring below uses
     exactly these helpers.
     - fillGuard: a fill with BOTH litres and cost empty must never
       save (the owner's phone holds a blank "L — $ · 2026-10-13 ·
       odo 168510" entry that slipped through the old form). Returns
       a plain message, or null when the fill may save.
     - applyFillEdit: the updated record — the original's other
       fields survive, the form's fields win, and an emptied
       odometer REMOVES the odo field (the v44 no-odo convention:
       odo-less rows are ignored by the master and the MPG trend).
     - saveFillsVerified: the v48 rule — write, read back, compare;
       false means the stored list is unchanged and the caller keeps
       the form open with a plain in-page error. */
  function fillGuard(litres, cost) {
    var l = parseFloat(litres), c = parseFloat(cost);
    if (!(l > 0) && !(c > 0)) {
      return 'Enter the litres or the cost — a fill-up with neither can\'t be saved.';
    }
    return null;
  }
  function applyFillEdit(orig, form) {
    var rec = {};
    for (var k in orig) { if (Object.prototype.hasOwnProperty.call(orig, k)) rec[k] = orig[k]; }
    rec.date = form.date || rec.date;
    rec.litres = form.litres;
    rec.cost = form.cost;
    rec.station = form.station;
    var odo = parseFloat(form.odo);
    if (odo > 0) rec.odo = odo; else delete rec.odo;
    return rec;
  }
  function saveFillsVerified(f) {
    W('fills', f);
    var back = S('fills', null);
    return JSON.stringify(back) === JSON.stringify(f);
  }
  /* FUEL-OPEN-END */

  /* v75: which fill-up (index into fills()) the form is editing, or
     null for a new fill-up; editErr is the guard/save message kept
     visible in the form after a blocked save (the form is NOT
     re-rendered on failure, so typed values are never lost). */
  var editFillIdx = null;
  var editErr = '';

  /* v39: note from the most recent save (e.g. the master-odometer
     outcome), shown at the top of the Fuel-up card after re-render. */
  var saveNote = '';
  function fmtKm(v) { return Number(v).toLocaleString('en-CA'); }

  /* v78: when the last fill happened, in the driver's words —
     "today" / "yesterday" / "3 days ago", else the short date.
     Date math runs on the ISO day strings (UTC-parsed), never on
     local midnights, so DST can never shift the answer. */
  var FUEL_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fillDayMs(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function fillWhen(iso) {
    if (!iso) return '';
    var today = '';
    try { today = App._today(); } catch (e) {}
    if (iso === today) return 'today';
    var a = fillDayMs(iso), b = fillDayMs(today);
    if (a !== null && b !== null) {
      var diff = Math.round((b - a) / 86400000);
      if (diff === 1) return 'yesterday';
      if (diff > 1 && diff < 7) return diff + ' days ago';
    }
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? FUEL_MON[+m[2] - 1] + ' ' + (+m[3]) : String(iso);
  }

  /* v39 (addition #2): a saved fill-up's odometer feeds the ONE master
     odometer (mt_odo) — upward only. A lower saved reading (OCR misread
     or typo) never drags the master down; the returned note says which
     way it went so the driver sees it after the save re-render. */
  function masterOnSave(odoVal) {
    var n = parseFloat(odoVal);
    if (!(n > 0)) return '';
    if (!(window.App && App._bumpOdometer)) return '';
    var res = App._bumpOdometer(n);
    if (!res || res.value === null || res.value === undefined) return '';
    if (res.raised) {
      return res.previous
        ? '✓ Master odometer updated to ' + fmtKm(res.value) + ' km.'
        : '✓ Master odometer set to ' + fmtKm(res.value) + ' km.';
    }
    return 'Odometer kept at ' + fmtKm(res.value) + ' km — the reading you saved (' +
      fmtKm(n) + ') was lower, so the master was not changed.';
  }

  function mpgTrend() {
    var f = fills().filter(function (x) { return x.odo && x.litres; })
      .sort(function (a, b) { return a.odo - b.odo; });
    var out = [];
    for (var i = 1; i < f.length; i++) {
      var dist = f[i].odo - f[i - 1].odo, l = parseFloat(f[i].litres);
      if (dist > 0 && l > 0) out.push({ date: f[i].date, mpg: (dist / l).toFixed(1) });
    }
    return out;
  }

  Meticulous.modules.fuel = {
    _masterOnSave: masterOnSave,
    /* v78: the card preview — the most recent fill-up (litres · $
       · when), the fact a driver glances for; the MPG trend stays
       inside the module where it always lived. */
    status: function () {
      var f = fills(), last = null;
      f.forEach(function (x) {
        if (x && (!last || String(x.date || '') >= String(last.date || ''))) last = x;
      });
      if (!last) return 'No fill-ups yet';
      var parts = [];
      var L = parseFloat(last.litres);
      if (L > 0) parts.push(String(+L.toFixed(1)) + ' L');
      var C = parseFloat(last.cost);
      if (C > 0) parts.push('$' + C.toFixed(2));
      var when = fillWhen(last.date);
      if (when) parts.push(when);
      return parts.length ? 'Last fill: ' + parts.join(' · ') : 'No fill-ups yet';
    },
    render: function (body) {
      var trend = mpgTrend();
      /* v75: an edit target that vanished (deleted elsewhere) falls
         back to a plain new-fill-up form — never edits a ghost. */
      var editRec = null;
      if (editFillIdx !== null) {
        editRec = fills()[editFillIdx] || null;
        if (!editRec) editFillIdx = null;
      }
      var h = '<div class="card"><h3>⛽ Fuel trend</h3>' +
        (trend.length ? '<div class="center" style="font-size:24px;font-weight:800;color:var(--navy)">' + trend[trend.length - 1].mpg + ' <small style="font-size:13px">km/L</small></div>' +
          '<div class="note center">Last ' + trend.length + ' fill-ups</div>' +
          trend.slice(-8).map(function (t) { return '<div class="kv"><span>' + esc(t.date) + '</span><b>' + t.mpg + '</b></div>'; }).join('')
          : '<div class="empty">Add 2+ fill-ups with odometer readings to see MPG.</div>') + '</div>';

      h += '<div class="card" id="fu_form_card"><h3>' + (editRec ? '✏️ Edit fill-up' : '＋ Fuel-up') + '</h3>' +
        (editRec ? '<div class="note" style="margin-bottom:8px">You\'re editing the fill-up from ' + esc(editRec.date || '') + ' — “Save changes” updates that same entry, it does not add a new one.</div>' : '') +
        (saveNote ? '<p class="note" style="color:var(--navy);font-weight:600">' + esc(saveNote) + '</p>' : '') +
        '<label class="f">Date</label><input type="date" id="fu_date" value="' + App._today() + '">' +
        '<div class="row"><div><label class="f">Odometer (km)</label><input id="fu_odo" type="number" inputmode="decimal">' +
        '<div style="display:flex;gap:8px;margin-top:6px;">' +
        '<button type="button" class="btn secondary small" id="fu_odo_cam" style="flex:1;">📷 Take photo</button>' +
        '<button type="button" class="btn secondary small" id="fu_odo_pick" style="flex:1;">📁 Choose file</button>' +
        '</div>' +
        '<input type="file" id="fu_odo_cam_in" accept="image/*" capture="environment" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<input type="file" id="fu_odo_in" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<div id="fu_odo_read" style="font-size:13px;margin-top:4px;"></div></div>' +
        '<div><label class="f">Litres</label><input id="fu_l" type="number" inputmode="decimal"></div></div>' +
        /* v86: the correction door for THIS form — the same one
           Preferences has. Hidden until the typed odometer trips
           the two-sided gate against the master (below it, or
           impossibly far past it); those are the saves the master
           refuses unarmed (see the save handler below). */
        '<div id="fu_odo_fixrow" style="display:none;margin-top:6px;">' +
        '<p class="note" id="fu_odo_fixnote" style="color:#c2410c;font-weight:600"></p>' +
        '<label class="chk"><input type="checkbox" id="fu_odo_fix"> This corrects a wrong odometer reading</label></div>' +
        '<div class="row"><div><label class="f">Cost $</label><input id="fu_cost" type="number" inputmode="decimal"></div>' +
        '<div><label class="f">Station</label><input id="fu_stn" placeholder="e.g. Petro-Pass"></div></div>' +
        '<label class="f">📷 Receipt photo</label>' +
        '<div style="display:flex;gap:10px;margin-bottom:8px;">' +
        '<button type="button" class="btn secondary" id="fu_cam" style="flex:1;">📷 Take photo</button>' +
        '<button type="button" class="btn secondary" id="fu_pick" style="flex:1;">📁 Choose file</button>' +
        '</div>' +
        '<input type="file" id="fu_img_cam" accept="image/*" capture="environment" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<input type="file" id="fu_img" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<div id="fu_prev"></div>' +
        '<div id="fu_read" style="font-size:14px;margin-top:8px;"></div>' +
        '<div id="fu_err" style="font-size:14px;margin:8px 0">' + (editErr ? '<span style="color:#c2410c;font-weight:600">⚠️ ' + esc(editErr) + '</span>' : '') + '</div>' +
        '<button class="btn primary" id="fu_add">' + (editRec ? '💾 Save changes' : 'Save fill-up') + '</button>' +
        (editRec ? '<button class="btn ghost" id="fu_cancel_edit" style="margin-left:8px">Cancel edit</button>' : '') + '</div>';

      h += '<div class="card"><h3>🧾 Other expenses</h3>' +
        '<div class="row"><div><label class="f">What</label><input id="fx_what" placeholder="e.g. DEF fluid"></div>' +
        '<div><label class="f">Cost $</label><input id="fx_cost" type="number" inputmode="decimal"></div></div>' +
        '<label class="f">📷 Receipt photo</label>' +
        '<div style="display:flex;gap:10px;margin-bottom:8px;">' +
        '<button type="button" class="btn secondary" id="fx_cam" style="flex:1;">📷 Take photo</button>' +
        '<button type="button" class="btn secondary" id="fx_pick" style="flex:1;">📁 Choose file</button>' +
        '</div>' +
        '<input type="file" id="fx_img_cam" accept="image/*" capture="environment" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<input type="file" id="fx_img" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<div id="fx_prev"></div>' +
        '<div id="fx_read" style="font-size:13px;margin-top:4px;"></div>' +
        '<button class="btn navy" id="fx_add">Add expense</button>' +
        '<div id="fx_list">' + S('expenses', []).slice().reverse().map(function (x) {
          return '<div class="listitem"><div class="a">' + esc(x.what) + ' — $' + esc(x.cost) + '</div><div class="b">' + esc(x.date) + '</div></div>';
        }).join('') + '</div></div>';

      /* v75: rows are TAPPABLE — a tap opens the entry in the form
         above (edit mode), and the tap scrolls the form into view
         (the LOOK TWICE rule: the response happens where he's
         looking, or takes him straight to it). */
      var flAll = fills();
      h += '<div class="card"><h3>📒 Fill-ups</h3>' +
        (flAll.length ? flAll.slice().reverse().map(function (f, ri) {
          var i = flAll.length - 1 - ri;
          return '<div class="listitem" data-fuedit="' + i + '" style="cursor:pointer"><div class="a">' + esc(f.litres) + ' L — $' + esc(f.cost) +
            '<span style="float:right;color:var(--muted);font-weight:400">›</span></div>' +
            '<div class="b">' + esc(f.date) + (f.odo ? ' · odo ' + esc(f.odo) : '') + (f.station ? ' · ' + esc(f.station) : '') + ' · tap to view or edit</div></div>';
        }).join('') : '<div class="empty">No fill-ups yet.</div>') + '</div>';

      body.innerHTML = h;

      /* v75: edit-mode prefill — the form opens holding the tapped
         entry's own values. Fields are marked touched so a stray
         OCR read can never silently rewrite them (v39 rule). The
         receipt photo shows when the record carries one. */
      if (editRec) {
        var pre = { '#fu_date': editRec.date, '#fu_odo': editRec.odo, '#fu_l': editRec.litres, '#fu_cost': editRec.cost, '#fu_stn': editRec.station };
        Object.keys(pre).forEach(function (id) {
          var e = body.querySelector(id);
          if (e && pre[id] !== undefined && pre[id] !== null && pre[id] !== '') {
            e.value = pre[id];
            e.setAttribute('data-touched', '1');
          }
        });
        if (editRec.photo) {
          var pv = body.querySelector('#fu_prev');
          if (pv) pv.innerHTML = '<img src="' + editRec.photo + '" style="width:100%;border-radius:10px;margin-top:10px">';
        }
      }
      body.querySelectorAll('[data-fuedit]').forEach(function (el) {
        el.onclick = function () {
          editFillIdx = +el.getAttribute('data-fuedit');
          editErr = ''; saveNote = '';
          Meticulous.modules.fuel.render(body);
          var card = body.querySelector('#fu_form_card');
          function go() { if (card && card.scrollIntoView) { try { card.scrollIntoView({ block: 'start' }); } catch (e) {} } }
          go();
          try { if (window.requestAnimationFrame) window.requestAnimationFrame(go); } catch (e) {}
        };
      });
      var cancelEditBtn = body.querySelector('#fu_cancel_edit');
      if (cancelEditBtn) cancelEditBtn.onclick = function () {
        editFillIdx = null; editErr = '';
        Meticulous.modules.fuel.render(body);
      };
      // v26: two-button pattern (Take photo / Choose file) like dispatch
      var fuCamInput = body.querySelector('#fu_img_cam');
      var fuPickInput = body.querySelector('#fu_img');
      body.querySelector('#fu_cam').onclick = function () { fuCamInput.click(); };
      body.querySelector('#fu_pick').onclick = function () { fuPickInput.click(); };

      /* v39: fields the user has typed in are never overwritten by OCR.
         (The date field starts pre-filled with today by the app — that
         default is NOT a user entry, so a receipt's date may replace it
         until the user actually edits the field.) */
      ['#fu_date', '#fu_l', '#fu_cost', '#fu_stn'].forEach(function (id) {
        var e = body.querySelector(id);
        if (e) e.addEventListener('input', function () {
          e.setAttribute('data-touched', '1');
          /* v85: a hand-changed date detaches the receipt's time —
             the time belongs to the receipt's day, not his edit. */
          if (id === '#fu_date') fuReadTime = '';
        });
      });
      function fillField(id, v) {
        var e = body.querySelector(id);
        if (!e || !v) return;
        if (e.getAttribute('data-touched')) return;
        if (e.value && id !== '#fu_date') return;
        e.value = v;
      }

      /* v39: receipt photo → OCR (same engine as Dispatch: 1600px
         rendition + recognizeWithRotation) → fill the form, and SAY
         what was read / missed. Never silent. */
      var fuOcrToken = 0;
      /* v85: the receipt's sale time, read in the same pass as the
         other fields and shown in the read line; saved on the
         record at Save. Not a form field — nothing extra to type. */
      var fuReadTime = '';
      function fuSetRead(html) { var d = body.querySelector('#fu_read'); if (d) d.innerHTML = html; }
      function fuHandlePhoto(ev) {
        var file = ev.target.files && ev.target.files[0]; if (!file) return;
        var token = ++fuOcrToken;
        var r = new FileReader();
        r.onload = function () { body.querySelector('#fu_prev').innerHTML = '<img src="' + r.result + '" style="width:100%;border-radius:10px;margin-top:10px">'; };
        r.readAsDataURL(file);
        if (!window.TicketOCR || !TicketOCR.fileToOCRImage || !TicketOCR.parseFuelReceipt) {
          fuSetRead('<span style="color:#e67e22">Photo added — the reader isn\'t ready, fill the form by hand.</span>');
          return;
        }
        fuSetRead('📖 Reading receipt…');
        TicketOCR.fileToOCRImage(file, function (ocrUrl) {
          if (token !== fuOcrToken) return;
          if (!ocrUrl) { fuSetRead('<span style="color:#e67e22">Couldn\'t read that photo — fill the form by hand.</span>'); return; }
          TicketOCR.recognizeWithRotation(ocrUrl, function (p) {
            if (token !== fuOcrToken) return;
            try { fuSetRead('📖 Reading receipt… ' + Math.round(p * 100) + '%'); } catch (e) {}
          }).then(function (text) {
            if (token !== fuOcrToken) return;
            var parsed = TicketOCR.parseFuelReceipt(text);
            var rep = TicketOCR.describeFuelRead(parsed);
            fillField('#fu_l', parsed.litres);
            fillField('#fu_cost', parsed.cost);
            fillField('#fu_stn', parsed.station);
            fillField('#fu_date', parsed.date);
            if (parsed.time) fuReadTime = parsed.time;
            if (rep.found.length) {
              fuSetRead('⛽ Read: ' + esc(rep.found.join(' · ')) +
                (rep.missing.length ? '<br><span style="color:#e67e22">Couldn\'t find: ' + esc(rep.missing.join(', ')) + '</span>' : ''));
            } else {
              fuSetRead('<span style="color:#e67e22">Couldn\'t read anything from that receipt — fill the form by hand.</span>');
            }
            /* v59: local read found nothing → power-read escalation
               (generic path: the cloud transcribes the photo, the
               SAME local parser extracts the fields, the same form
               is filled — Save fill-up stays the confirm).
               v80: a PARTIAL read escalates too when the two money
               fields — litres or cost — are among the missing
               (Oct 15: a real Mobil receipt landed NOTHING in this
               form; a station+date-only read would have stranded
               the numbers he actually needs). The local finds stay
               in the fields; the power read only fills the gaps
               (fillField never overwrites). */
            if (!parsed.litres || !parsed.cost) fuPowerRead(ocrUrl, token);
          }).catch(function () {
            if (token !== fuOcrToken) return;
            fuSetRead('<span style="color:#e67e22">Couldn\'t read that receipt — fill the form by hand.</span>');
          });
        });
      }
      fuCamInput.onchange = fuHandlePhoto;
      fuPickInput.onchange = fuHandlePhoto;

      /* v59: generic power-read consumer — cloud transcription fed
         through the existing receipt parser. Fill-only; the form's
         own Save is the confirm. */
      function fuFillFromParsed(parsed, rep, label) {
        fillField('#fu_l', parsed.litres);
        fillField('#fu_cost', parsed.cost);
        fillField('#fu_stn', parsed.station);
        fillField('#fu_date', parsed.date);
        if (parsed.time) fuReadTime = parsed.time;
        fuSetRead(label + ' ' + esc(rep.found.join(' · ')) +
          (rep.missing.length ? '<br><span style="color:#e67e22">Couldn\'t find: ' + esc(rep.missing.join(', ')) + '</span>' : ''));
      }
      function fuPowerRead(ocrUrl, token) {
        if (!window.PowerRead || !PowerRead.escalate) return;
        PowerRead.escalate({
          reader: 'text', image: ocrUrl, origin: { module: 'fuel', label: 'Fuel' },
          onStatus: function (s) {
            if (token !== fuOcrToken) return;
            if (s.state === 'working') fuSetRead('⚡ Asking the power read…');
            else if (s.state === 'waiting') fuSetRead('⚡ Power read waiting for signal — the photo is saved and will be read when you\'re back online. You can still fill the form by hand.');
            else if (s.state === 'unavailable') fuSetRead('<span style="color:#e67e22">' + esc(s.message) + ' You can still fill the form by hand.</span>');
            else if (s.state === 'error') fuSetRead('<span style="color:#e67e22">' + esc(s.message) + '</span>');
          },
          onResult: function (res) {
            if (token !== fuOcrToken) return;
            var txt = res.fields && res.fields.rawText;
            if (!txt) { fuSetRead('<span style="color:#e67e22">⚡ Power read couldn\'t read that receipt either — fill the form by hand.</span>'); return; }
            var parsed = TicketOCR.parseFuelReceipt(txt);
            var rep = TicketOCR.describeFuelRead(parsed);
            if (!rep.found.length) { fuSetRead('<span style="color:#e67e22">⚡ Power read couldn\'t read that receipt either — fill the form by hand.</span>'); return; }
            fuFillFromParsed(parsed, rep, '⚡ <b>Power read — check before saving:</b>');
          }
        });
      }

      /* v59: a queued power read of an earlier receipt may have
         finished — peek and prefill (Save fill-up consumes it). */
      try {
        if (window.PowerRead && PowerRead.peekResult && window.TicketOCR) {
          var prFuel = PowerRead.peekResult('text', 'fuel');
          if (prFuel && prFuel.fields && prFuel.fields.rawText) {
            var pp = TicketOCR.parseFuelReceipt(prFuel.fields.rawText);
            var rr = TicketOCR.describeFuelRead(pp);
            if (rr.found.length) fuFillFromParsed(pp, rr, '⚡ <b>Power read — check before saving:</b> from your earlier receipt photo:');
          }
        }
      } catch (e) {}

      /* v39 (addition #1): odometer photo beside the Odometer field —
         snap the dash instead of typing. Reuses the v34 odometer parser
         (App._parseOdometerReading: total over trip). The photo tap IS
         the user's intent, so a good read replaces the field value —
         always with the visible read-back line; a failed read leaves
         the field untouched. */
      var fuOdoCamInput = body.querySelector('#fu_odo_cam_in');
      var fuOdoPickInput = body.querySelector('#fu_odo_in');
      body.querySelector('#fu_odo_cam').onclick = function () { fuOdoCamInput.click(); };
      body.querySelector('#fu_odo_pick').onclick = function () { fuOdoPickInput.click(); };
      var fuOdoToken = 0;
      function fuOdoHandle(ev) {
        var file = ev.target.files && ev.target.files[0]; if (!file) return;
        var token = ++fuOdoToken;
        var st = body.querySelector('#fu_odo_read');
        function setStatus(html) { if (st) st.innerHTML = html; }
        if (!window.TicketOCR || !TicketOCR.fileToOCRImage || !(window.App && App._parseOdometerReading)) {
          setStatus('<span style="color:#e67e22">Photo reader not ready — type the odometer.</span>');
          return;
        }
        setStatus('📖 Reading odometer…');
        TicketOCR.fileToOCRImage(file, function (ocrUrl) {
          if (token !== fuOdoToken) return;
          if (!ocrUrl) { setStatus('<span style="color:#e67e22">Couldn\'t read the odometer — type it in.</span>'); return; }
          TicketOCR.recognizeWithRotation(ocrUrl, function (p) {
            if (token !== fuOdoToken) return;
            try { setStatus('📖 Reading odometer… ' + Math.round(p * 100) + '%'); } catch (e) {}
          }).then(function (text) {
            if (token !== fuOdoToken) return;
            var km = App._parseOdometerReading(text);
            /* v63 plausibility gate: a value BELOW the master
               odometer is a misread, not a reading — it counts as a
               failed read (never filled) and escalates, same as an
               empty parse. Falls back to the v59 empty-only rule if
               the power-read module is somehow absent.
               v80: the gate is two-sided — a value wildly ABOVE the
               master fails too (Oct 15: this read returned 519,326,
               the INVOICE NO. on the fuel receipt, against a 168,759
               master, and the old one-sided gate filled it). The
               message names the direction in plain words. */
            var odoFailed = (window.PowerRead && PowerRead.odoReadFailed)
              ? PowerRead.odoReadFailed(km) : !km;
            if (km && !odoFailed) {
              body.querySelector('#fu_odo').value = km;
              setStatus('📸 Odometer read: <b>' + fmtKm(km) + ' km</b>');
            } else {
              var why = (km && window.PowerRead && PowerRead.odoImplausible) ? PowerRead.odoImplausible(km) : null;
              var master = (window.PowerRead && PowerRead.masterOdo) ? PowerRead.masterOdo() : null;
              if (km && why === 'jump') setStatus('<span style="color:#e67e22">That read (<b>' + fmtKm(km) + ' km</b>) is way past your current odometer' + (master ? ' (<b>' + fmtKm(master) + ' km</b>)' : '') + ' — it can\'t be right; it\'s likely another number in the photo (a receipt\'s invoice number, say). Type the real reading. Trying the power read…</span>');
              else if (km) setStatus('<span style="color:#e67e22">That read (<b>' + fmtKm(km) + ' km</b>) is below your current odometer — it can\'t be right. Trying the power read…</span>');
              else setStatus('<span style="color:#e67e22">Couldn\'t read the odometer — type it in.</span>');
              /* v59: power-read escalation — fills this same field
                 only; Save fill-up remains the confirm and the master
                 odometer still moves solely through that save. */
              fuOdoPowerRead(ocrUrl, token, setStatus);
            }
          }).catch(function () {
            if (token !== fuOdoToken) return;
            setStatus('<span style="color:#e67e22">Couldn\'t read the odometer — type it in.</span>');
          });
        });
      }
      fuOdoCamInput.onchange = fuOdoHandle;
      fuOdoPickInput.onchange = fuOdoHandle;

      /* v59: power-read escalation for the Fuel odometer photo. */
      function fuOdoPowerRead(ocrUrl, token, setStatus) {
        if (!window.PowerRead || !PowerRead.escalate) return;
        PowerRead.escalate({
          reader: 'odometer', image: ocrUrl, origin: { module: 'fuel', label: 'Fuel' },
          onStatus: function (s) {
            if (token !== fuOdoToken) return;
            if (s.state === 'working') setStatus('⚡ Asking the power read…');
            else if (s.state === 'waiting') setStatus('⚡ Power read waiting for signal — the photo is saved and will be read when you\'re back online. You can still type the odometer.');
            else if (s.state === 'unavailable') setStatus('<span style="color:#e67e22">' + esc(s.message) + ' You can still type the odometer.</span>');
            else if (s.state === 'error') setStatus('<span style="color:#e67e22">' + esc(s.message) + '</span>');
          },
          onResult: function (res) {
            if (token !== fuOdoToken) return;
            var v = res.fields && res.fields.value;
            if (!v) { setStatus('<span style="color:#e67e22">⚡ Power read couldn\'t read the odometer either — type it in.</span>'); return; }
            body.querySelector('#fu_odo').value = v;
            setStatus('⚡ <b>Power read — check before saving:</b> odometer <b>' + fmtKm(v) + ' km</b>');
          }
        });
      }

      /* v86: paint the correction door live — it shows only while
         the typed odometer trips the two-sided gate against the
         master (App._odoImplausible), with the reason in plain
         words, exactly like Preferences. */
      (function () {
        var odoEl = body.querySelector('#fu_odo');
        var row = body.querySelector('#fu_odo_fixrow');
        var note = body.querySelector('#fu_odo_fixnote');
        if (!odoEl || !row) return;
        function paintFix() {
          var master = (window.App && App._masterOdometer) ? App._masterOdometer() : null;
          var v = parseFloat(odoEl.value);
          var why = (v > 0 && master !== null && window.App && App._odoImplausible) ? App._odoImplausible(v) : null;
          if (why === 'jump') {
            row.style.display = '';
            if (note) note.textContent = 'That\'s way past your odometer now (' + Number(master).toLocaleString('en-CA') + ' km) — it can\'t be right; it\'s likely another number (a receipt\'s invoice number, say). Saving will keep the odometer at ' + Number(master).toLocaleString('en-CA') + ' km and save the fill-up without that reading — unless you tick the box to say the saved reading is wrong.';
          } else if (why === 'below') {
            row.style.display = '';
            if (note) note.textContent = 'That\'s lower than your odometer now (' + Number(master).toLocaleString('en-CA') + ' km). Odometers only move up — the master stays where it is unless you tick the box to say the saved reading is wrong.';
          } else {
            row.style.display = 'none';
          }
        }
        odoEl.addEventListener('input', paintFix);
        paintFix();
      })();

      body.querySelector('#fu_add').onclick = function () {
        /* v75: the guard runs FIRST for new and edited fills alike —
           litres AND cost both empty never saves (the blank phone
           entry in BUGS.md slipped through without one). A blocked
           or failed save shows the error IN the form and does NOT
           re-render, so what he typed is never lost. */
        var errEl = body.querySelector('#fu_err');
        function showErr(msg) {
          editErr = msg;
          if (errEl) errEl.innerHTML = '<span style="color:#c2410c;font-weight:600">⚠️ ' + esc(msg) + '</span>';
        }
        var litresV = body.querySelector('#fu_l').value;
        var costV = body.querySelector('#fu_cost').value;
        var guard = fillGuard(litresV, costV);
        if (guard) { showErr(guard); return; }
        // v44: odometer is OPTIONAL — many fuel receipts show no reading,
        // and the user wants those entered as-is. Empty/invalid → the
        // record is saved with NO odo field at all; the master odometer
        // and MPG/trend ignore odo-less rows (they filter on x.odo).
        var odo = parseFloat(body.querySelector('#fu_odo').value);
        var hasOdo = odo > 0;
        /* v86: THE MASTER DECISION FOR THIS SAVE — the two-sided
           supervised decision (App._odoSaveDecision), the same one
           Preferences saves through. Before v86 this form fed the
           typed number straight into the upward-only bump, so a
           reading impossibly far past the master (519,326 — a
           receipt's invoice number — against a 168,759 master,
           live Oct 15) poisoned the master with no warning. Now:
           an unarmed JUMP is refused — the fill-up still saves
           (with no odometer reading on a new fill; its own
           previous reading on an edit) and the master never
           moves; an armed one is a correction and writes through;
           anything plausible keeps the v39 bump behaviour. */
        var odoPlan = { mode: hasOdo ? 'bump' : 'none', value: odo, master: null };
        if (hasOdo && window.App && App._odoSaveDecision && App._masterOdometer) {
          var masterNow86 = App._masterOdometer();
          var fixEl86 = body.querySelector('#fu_odo_fix');
          var dec86 = App._odoSaveDecision(odo, masterNow86, !!(fixEl86 && fixEl86.checked));
          var why86 = (window.App && App._odoImplausible) ? App._odoImplausible(odo) : null;
          if (dec86.action === 'correct') odoPlan = { mode: 'correct', value: dec86.value, master: masterNow86 };
          else if (dec86.action === 'keep' && why86 === 'jump') odoPlan = { mode: 'refuse', value: odo, master: masterNow86 };
          else if (dec86.action === 'ignore') odoPlan = { mode: 'none', value: odo, master: masterNow86 };
        }
        function odoOutcomeNote() {
          if (odoPlan.mode === 'correct') return '✓ Master odometer corrected to ' + fmtKm(odoPlan.value) + ' km.';
          if (odoPlan.mode === 'refuse') {
            return '⚠️ Odometer NOT updated: ' + fmtKm(odoPlan.value) + ' km is way past your current odometer (' + fmtKm(odoPlan.master) + ' km) — it can\'t be right (it\'s likely another number, like a receipt\'s invoice number), so the fill-up was saved without changing the odometer. If that number really is your odometer, edit the fill-up, tick “This corrects a wrong odometer reading”, and save again.';
          }
          return null; /* the bump path words itself via masterOnSave */
        }
        var f = fills();
        var formVals = {
          date: body.querySelector('#fu_date').value || App._today(),
          litres: litresV, cost: costV,
          station: body.querySelector('#fu_stn').value.trim(),
          /* a refused jump never lands on the record either: an
             edit keeps the entry's own previous reading, a new
             fill goes in with none (the v44 odo-less convention). */
          odo: odoPlan.mode === 'refuse'
            ? String((editFillIdx !== null && f[editFillIdx] && f[editFillIdx].odo) || '')
            : body.querySelector('#fu_odo').value
        };
        if (editFillIdx !== null && f[editFillIdx]) {
          /* v75: EDIT — update the SAME entry in place (no duplicate),
             verified the v48 way before anything else happens. */
          var updated = applyFillEdit(f[editFillIdx], formVals);
          if (fuReadTime) updated.time = fuReadTime;
          f[editFillIdx] = updated;
          if (!saveFillsVerified(f)) {
            showErr('Those changes did NOT go through — the app storage on your phone looks full, or the write failed, so the saved fill-up is unchanged. Your edit is still in the form — free up some phone space and tap “Save changes” again.');
            return;
          }
          try { if (window.PowerRead && PowerRead.takeResult) PowerRead.takeResult('text', 'fuel'); } catch (e) {}
          if (window.FB && FB.saveDoc) FB.saveDoc('fuel', 'f' + Date.now(), updated);
          editFillIdx = null; editErr = '';
          var un = '';
          if (odoPlan.mode === 'correct') { try { App._store.set('mt_odo', String(odoPlan.value)); } catch (e) {} un = odoOutcomeNote(); }
          else if (odoPlan.mode === 'refuse') { un = odoOutcomeNote(); }
          else if (hasOdo) { un = masterOnSave(odo); }
          saveNote = un || '✓ Fill-up updated.';
          Meticulous.modules.fuel.render(body);
          return;
        }
        var rec = { date: formVals.date };
        if (fuReadTime) rec.time = fuReadTime;
        if (hasOdo && odoPlan.mode !== 'refuse') rec.odo = odo;
        rec.litres = litresV;
        rec.cost = costV;
        rec.station = formVals.station;
        f.push(rec);
        /* v75: the add path is verified too — a failed write used to
           look exactly like a saved fill-up. */
        if (!saveFillsVerified(f)) {
          showErr('That fill-up did NOT save — the app storage on your phone looks full, or the write failed. Your entry is still in the form — free up some phone space and tap “Save fill-up” again.');
          return;
        }
        /* v59: this save confirms the form — consume any power-read
           result that was waiting for this screen. */
        try { if (window.PowerRead && PowerRead.takeResult) PowerRead.takeResult('text', 'fuel'); } catch (e) {}
        if (window.FB && FB.saveDoc) FB.saveDoc('fuel', 'f' + Date.now(), rec);
        // v39: feed the master odometer (upward only) + show the outcome —
        // ONLY when a real reading was entered. An odo-less save never
        // touches the master (mt_odo) and just confirms the save.
        editErr = '';
        if (odoPlan.mode === 'correct') { try { App._store.set('mt_odo', String(odoPlan.value)); } catch (e) {} saveNote = odoOutcomeNote(); }
        else if (odoPlan.mode === 'refuse') { saveNote = odoOutcomeNote(); }
        else { saveNote = hasOdo ? masterOnSave(odo) : '✓ Fill-up saved.'; }
        Meticulous.modules.fuel.render(body);
      };
      /* v42: receipt photo → OCR on the Other-expenses card — same
         shared pipeline as the fill-up form above (1600px rendition +
         rotation retry). Fills only untouched fields; a date read from
         the receipt is used for the saved entry (this card has no date
         field of its own). Never silent. */
      ['#fx_what', '#fx_cost'].forEach(function (id) {
        var e = body.querySelector(id);
        if (e) e.addEventListener('input', function () { e.setAttribute('data-touched', '1'); });
      });
      function fxFillField(id, v) {
        var e = body.querySelector(id);
        if (!e || !v) return;
        if (e.getAttribute('data-touched')) return;
        if (e.value) return;
        e.value = v;
      }
      var fxOcrDate = '';
      var fxCamInput = body.querySelector('#fx_img_cam');
      var fxPickInput = body.querySelector('#fx_img');
      body.querySelector('#fx_cam').onclick = function () { fxCamInput.click(); };
      body.querySelector('#fx_pick').onclick = function () { fxPickInput.click(); };
      var fxOcrToken = 0;
      function fxSetRead(html) { var d = body.querySelector('#fx_read'); if (d) d.innerHTML = html; }
      function fxHandlePhoto(ev) {
        var file = ev.target.files && ev.target.files[0]; if (!file) return;
        var token = ++fxOcrToken;
        var r = new FileReader();
        r.onload = function () { body.querySelector('#fx_prev').innerHTML = '<img src="' + r.result + '" style="width:100%;border-radius:10px;margin-top:10px">'; };
        r.readAsDataURL(file);
        if (!window.TicketOCR || !TicketOCR.fileToOCRImage || !TicketOCR.parseExpenseReceipt) {
          fxSetRead('<span style="color:#e67e22">Photo added — the reader isn\'t ready, fill the form by hand.</span>');
          return;
        }
        fxSetRead('📖 Reading receipt…');
        TicketOCR.fileToOCRImage(file, function (ocrUrl) {
          if (token !== fxOcrToken) return;
          if (!ocrUrl) { fxSetRead('<span style="color:#e67e22">Couldn\'t read that photo — fill the form by hand.</span>'); return; }
          TicketOCR.recognizeWithRotation(ocrUrl, function (p) {
            if (token !== fxOcrToken) return;
            try { fxSetRead('📖 Reading receipt… ' + Math.round(p * 100) + '%'); } catch (e) {}
          }).then(function (text) {
            if (token !== fxOcrToken) return;
            var parsed = TicketOCR.parseExpenseReceipt(text);
            var rep = TicketOCR.describeExpenseRead(parsed);
            fxFillField('#fx_cost', parsed.total);
            fxFillField('#fx_what', parsed.vendor);
            if (parsed.date) fxOcrDate = parsed.date;
            if (rep.found.length) {
              fxSetRead('🧾 Read: ' + esc(rep.found.join(' · ')) +
                (rep.missing.length ? '<br><span style="color:#e67e22">Couldn\'t find: ' + esc(rep.missing.join(', ')) + '</span>' : ''));
            } else {
              fxSetRead('<span style="color:#e67e22">Couldn\'t read anything from that receipt — fill the form by hand.</span>');
            }
          }).catch(function () {
            if (token !== fxOcrToken) return;
            fxSetRead('<span style="color:#e67e22">Couldn\'t read that receipt — fill the form by hand.</span>');
          });
        });
      }
      fxCamInput.onchange = fxHandlePhoto;
      fxPickInput.onchange = fxHandlePhoto;

      body.querySelector('#fx_add').onclick = function () {
        var what = body.querySelector('#fx_what').value.trim(), cost = body.querySelector('#fx_cost').value;
        if (!what || !cost) return;
        var x = S('expenses', []); x.push({ what: what, cost: cost, date: fxOcrDate || App._today() }); W('expenses', x);
        Meticulous.modules.fuel.render(body);
      };
    }
  };
})();
