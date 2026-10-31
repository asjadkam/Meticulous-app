/* Fuel & Expense module — Meticulous standalone (Meticulous.modules convention) */
(function () {
  'use strict';
  var S = function (k, d) { return App._store.get('fuel_' + k, d); };
  var W = function (k, v) { App._store.set('fuel_' + k, v); };
  var esc = function (s) { return App._esc(s); };

  function fills() { return S('fills', []); }

  /* v242 (WORK-PROFILES): a fill is stamped with the profile
     active at its creation — the truck that took the fuel. The
     stamp drives the per-truck odometer seed and keeps a temp
     truck's fills out of Ai-facing Connect shares. keyFor is
     the per-truck chain door (Truck 07 keeps the legacy keys). */
  function wpActiveId() {
    try { if (window.App && App.workProfiles) return App.workProfiles.activeId(); } catch (e) {}
    return 'p1';
  }
  function wpKeyFor(base) {
    try { if (window.App && App.workProfiles) return App.workProfiles.keyFor(base); } catch (e) {}
    return base;
  }

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
    /* v293: every edit is a new VERSION of the same fill — the
       stamp is what lets the sync merge keep this copy over a
       stale device book that still holds the pre-edit values
       (the id, when the record was born with one, rides the
       field copy above untouched). */
    rec.updAt = Date.now();
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
  var fuelBody = null; // v116: last render target, for api.back's re-render
  var editErr = '';
  /* v118: the fill-up DETAILS view (owner spec, Oct 16 21:56) —
     which fill the read-only details page shows, or null. A row
     tap opens THIS, not the edit form; Edit lives on the page as
     a quiet secondary action. */
  var detailFillIdx = null;
  var fxView = false; // v202 FUEL-TAB: the Other-expenses view is open (its tab on the face opens it)
  var detailDelArm = false;
  var fuShowAll = false; /* v177 (D6): Fill-ups shows the latest 3 until asked for more (the Entries pattern) */
  /* v118: receipt precision — litres carry 3 decimals, money 2.
     A receipt read derives litres as cost ÷ price when the litres
     line itself is unread, which produces raw float junk
     (88.10600280761719) in the form fields while the read line
     prints the clean 88.106. Prefills are rounded to exactly
     what the read line says, so the fields (and therefore the
     saved record) hold receipt numbers, never binary residue. */
  function fuRoundL(v) { var n = parseFloat(v); return isFinite(n) ? String(Math.round(n * 1000) / 1000) : v; }
  function fuRoundC(v) { var n = parseFloat(v); return isFinite(n) ? String(Math.round(n * 100) / 100) : v; }

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
    var res = App._bumpOdometer(n, 'fuel');
    if (!res || res.value === null || res.value === undefined) return '';
    if (res.raised) {
      return res.previous
        ? '✓ Master odometer updated to ' + fmtKm(res.value) + ' km.'
        : '✓ Master odometer set to ' + fmtKm(res.value) + ' km.';
    }
    return 'Odometer kept at ' + fmtKm(res.value) + ' km — the reading you saved (' +
      fmtKm(n) + ') was lower, so the master was not changed.';
  }

  /* v122: the moment a fill's odometer reading belongs to — the
     fill's own date + its read time when the receipt carried one,
     else the save moment. The dated readings log (odo_readings)
     stamps the fill reading THERE, not at data-entry time, so a
     fill typed in at night still evidences the afternoon's dash.
     Unparseable → null (the log stamps 'now'). */
  function fuFillTs(rec) {
    try {
      var p = String((rec && rec.date) || '').split('-');
      if (p.length !== 3) return null;
      var hh = 12, mm = 0;
      var tm = /(\d{1,2}):(\d{2})/.exec(String((rec && rec.time) || ''));
      if (tm) { hh = parseInt(tm[1], 10); mm = parseInt(tm[2], 10); }
      var t = new Date(+p[0], +p[1] - 1, +p[2], hh, mm).getTime();
      return isFinite(t) ? t : null;
    } catch (e) { return null; }
  }

  /* v107 — ECONOMY SANITY (Stage 3): one poisoned odometer stamp
     must never poison the trend. Oct 15's fill carried 519,326 km
     (a receipt's invoice number read as the odometer) beside real
     168k readings, so the leg INTO it "drove" ~350,000 km on one
     tank and the trend printed 4,484.5 km/L. A leg is only real
     when its distance is possible between fill-ups (<= 50,000 km)
     and the economy it implies is possible for a truck
     (0.5–20 km/L — his class is ~2.5). The DATA is left intact:
     the fill stays in the history, editable as always; only the
     impossible leg is excluded from the math. The same rule
     guards Maintenance's mileage stats (modules/maintenance.js). */
  var ECON_MAX_LEG_KM = 50000, ECON_MIN_KPL = 0.5, ECON_MAX_KPL = 20;
  function econLegOk(dist, l) {
    if (!(dist > 0) || dist > ECON_MAX_LEG_KM || !(l > 0)) return false;
    var kpl = dist / l;
    return kpl >= ECON_MIN_KPL && kpl <= ECON_MAX_KPL;
  }

  function mpgTrend() {
    var f = fills().filter(function (x) { return x.odo && x.litres; })
      .sort(function (a, b) { return a.odo - b.odo; });
    var out = [];
    for (var i = 1; i < f.length; i++) {
      var dist = f[i].odo - f[i - 1].odo, l = parseFloat(f[i].litres);
      if (econLegOk(dist, l)) out.push({ date: f[i].date, mpg: (dist / l).toFixed(1) });
    }
    return out;
  }

  /* v202 FUEL-TAB (owner, Oct 21, 2026 10:02 MDT): the Other-
     expenses form gets a tab of its own (see renderFxView below).
     wireFx is the form's wiring — the v42 receipt-photo OCR block
     and the Add handler, moved VERBATIM out of the face render:
     same fields, same photo pipeline, same save. It runs only
     where the form actually is — its own view now. */
  function wireFx(body) {
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

  /* v202 FUEL-TAB: the Other-expenses VIEW — opened from the
     small tab at the top of the Fuel & Expense face, the same
     pattern as Revenue's tabs (v201). The card below is the
     pre-v202 face card verbatim (form + the past-expenses list:
     history rides with its form, behind the tap). A save
     re-renders this view (the new expense lands in the list)
     and republishes the shared records, exactly as the face
     render did (v146). */
  function renderFxView(body) {
    fuelBody = body;
    var h = '<button class="btn small ghost" id="fx_back" style="margin-bottom:10px">‹ Back</button>';
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
    body.innerHTML = h;
    body.querySelector('#fx_back').onclick = function () {
      fxView = false;
      Meticulous.modules.fuel.render(body);
    };
    wireFx(body);
    try { if (window.ConnectPipe) ConnectPipe.publishRecords(); } catch (e) {}
  }


  Meticulous.modules.fuel = {
    _masterOnSave: masterOnSave,
    _mpgTrend: mpgTrend,
    _econLegOk: econLegOk,
    /* v116: shell back contract — an in-progress fill-up EDIT is
       Fuel's sub-state: Back cancels the edit (exactly what the
       form's own Cancel edit button does) instead of leaving the
       module, and a fresh entry never opens mid-edit.
       v118: the DETAILS view is the layer under the edit — Back
       from details returns to the Fill-ups list. */
    back: function () {
      if (editFillIdx !== null) {
        editFillIdx = null; editErr = '';
        if (fuelBody) Meticulous.modules.fuel.render(fuelBody);
        return true;
      }
      if (detailFillIdx !== null) {
        detailFillIdx = null; detailDelArm = false;
        if (fuelBody) Meticulous.modules.fuel.render(fuelBody);
        return true;
      }
      return false;
    },
    resetView: function () { editFillIdx = null; editErr = ''; detailFillIdx = null; detailDelArm = false; },
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
      fuelBody = body;
      var trend = mpgTrend();
      /* v75: an edit target that vanished (deleted elsewhere) falls
         back to a plain new-fill-up form — never edits a ghost. */
      var editRec = null;
      if (editFillIdx !== null) {
        editRec = fills()[editFillIdx] || null;
        if (!editRec) editFillIdx = null;
      }
      /* v118: THE DETAILS VIEW (owner spec, Oct 16 21:56) — a row
         tap lands here, NOT in the edit form: every stored field
         read-only at receipt precision, the entry's receipt photo
         (or a clean no-photo state), and Edit / Delete as quiet
         secondary actions. Back returns to the Fill-ups list
         (api.back above + the page's own ‹ button). */
      if (detailFillIdx !== null && editFillIdx === null) {
        var dRec = fills()[detailFillIdx] || null;
        if (!dRec) { detailFillIdx = null; detailDelArm = false; }
        else {
          var dL = parseFloat(dRec.litres), dC = parseFloat(dRec.cost);
          var dPrice = (isFinite(dL) && dL > 0 && isFinite(dC) && dC > 0) ? (dC / dL) : null;
          var kv = function (k, v) { return '<div class="kv"><span>' + k + '</span><b>' + esc(v) + '</b></div>'; };
          var dh = '<div class="card"><h3>🧾 Fill-up details</h3>' +
            kv('Date', String(dRec.date || '—') + (dRec.time ? ' · ' + dRec.time : '')) +
            (dRec.station ? kv('Station', dRec.station) : '') +
            (isFinite(dL) ? kv('Litres', String(+dL.toFixed(3)) + ' L') : '') +
            (isFinite(dC) ? kv('Total cost', '$' + dC.toFixed(2)) : '') +
            (dPrice !== null ? kv('Price per litre', '$' + dPrice.toFixed(3) + '/L') : '') +
            (dRec.odo ? kv('Odometer', fmtKm(dRec.odo) + ' km') : '') +
            (dRec.type ? kv('Fuel type', dRec.type) : '') +
            (dRec.fuelType ? kv('Fuel type', dRec.fuelType) : '') +
            (dRec.note ? kv('Note', dRec.note) : '') +
            (dRec.photo
              ? '<img id="fu_det_photo" src="' + dRec.photo + '" style="width:100%;border-radius:10px;margin-top:10px">' +
                (App._photoDl ? App._photoDl(dRec.photo, 'fuel-receipt-' + (dRec.date || '')) : '')
              : '<div class="empty" style="margin-top:10px">No photo for this entry</div>') +
            '<div class="row" style="margin-top:12px">' +
            '<button class="btn ghost" id="fu_det_edit" style="flex:1">✏️ Edit</button>' +
            '<button class="btn ghost" id="fu_det_del" style="flex:1;color:#c2410c">' + (detailDelArm ? 'Tap again to delete' : '🗑 Delete') + '</button></div>' +
            '<button class="btn ghost" id="fu_det_back" style="margin-top:8px">‹ Back to fill-ups</button></div>';
          body.innerHTML = dh;
          body.querySelector('#fu_det_back').onclick = function () {
            detailFillIdx = null; detailDelArm = false;
            Meticulous.modules.fuel.render(body);
          };
          body.querySelector('#fu_det_edit').onclick = function () {
            editFillIdx = detailFillIdx; detailFillIdx = null; detailDelArm = false;
            editErr = ''; saveNote = '';
            Meticulous.modules.fuel.render(body);
            var card = body.querySelector('#fu_form_card');
            if (card && card.scrollIntoView) { try { card.scrollIntoView({ block: 'start' }); } catch (e) {} }
          };
          body.querySelector('#fu_det_del').onclick = function () {
            if (!detailDelArm) { detailDelArm = true; Meticulous.modules.fuel.render(body); return; }
            var f2 = fills();
            f2.splice(detailFillIdx, 1);
            if (!saveFillsVerified(f2)) { detailDelArm = false; Meticulous.modules.fuel.render(body); return; }
            detailFillIdx = null; detailDelArm = false;
            saveNote = 'Fill-up deleted.';
            Meticulous.modules.fuel.render(body);
          };
          return;
        }
      }
      /* v202 FUEL-TAB: the Other-expenses view replaces the face
         while it is open (Back returns). The details view above
         still wins when a fill-up is open. */
      if (fxView) { renderFxView(body); return; }
      /* v127: the trend card tells the truth about what it is.
         (c) HONESTY — under 3 legs there is no trend: the figure
         is the LAST LEG and is labelled as such (owner, Oct 17
         09:14 MDT: "Fuel trend 2.5 liters?" over a card reading
         "Last 1 fill-ups" off ONE leg — and legs are not
         fill-ups; the label now counts legs). (d) UNIT — every
         economy figure renders in the driver's chosen unit via
         App._econFormat (Preferences → "Fuel economy shown as");
         the records stay km/L — only the print converts. */
      function econDisp(kpl) {
        var f = null;
        try { if (window.App && App._econFormat) f = App._econFormat(parseFloat(kpl)); } catch (e) {}
        return f || { value: String(kpl), unit: 'km/L' };
      }
      var lastLeg = trend.length ? econDisp(trend[trend.length - 1].mpg) : null;
      var h = '<div class="card"><h3>⛽ Fuel trend</h3>' +
        (trend.length
          ? '<div class="center" style="font-size:24px;font-weight:800;color:var(--navy)">' + lastLeg.value + ' <small style="font-size:13px">' + lastLeg.unit + '</small></div>' +
            (trend.length >= 3
              ? '<div class="note center">Last ' + trend.length + ' legs</div>'
              : '<div class="note center">Last leg — a trend needs 3 legs; you have ' + trend.length + ' so far</div>') +
            trend.slice(-8).map(function (t) { var d = econDisp(t.mpg); return '<div class="kv"><span>' + esc(t.date) + '</span><b>' + d.value + ' ' + d.unit + '</b></div>'; }).join('')
          : '<div class="empty">Add 2+ fill-ups with odometer readings to see your fuel economy.</div>') + '</div>';

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

      /* v202 FUEL-TAB: the Other-expenses card no longer stacks
         on this face — it lives on its own view behind the tab
         at the top (renderFxView). The face keeps the trend, the
         Fuel-up form and the Fill-ups list. */

      /* v75: rows are TAPPABLE — a tap opens the entry in the form
         above (edit mode), and the tap scrolls the form into view
         (the LOOK TWICE rule: the response happens where he's
         looking, or takes him straight to it). */
      var flAll = fills();
      /* v177 (D6): latest 3 + Show more — the list scrolled
         unbroken back to June. Same pattern as Revenue Entries. */
      var flRev = flAll.slice().reverse();
      var flShown = fuShowAll ? flRev : flRev.slice(0, 3);
      h += '<div class="card"><h3>📒 Fill-ups</h3>' +
        (flAll.length ? flShown.map(function (f, ri) {
          var i = flAll.length - 1 - ri;
          return '<div class="listitem" data-fuedit="' + i + '" style="cursor:pointer"><div class="a">' + esc(f.litres) + ' L — $' + esc(f.cost) +
            '<span style="float:right;color:var(--muted);font-weight:400">›</span></div>' +
            '<div class="b">' + esc(f.date) + (f.odo ? ' · odo ' + esc(f.odo) : '') + (f.station ? ' · ' + esc(f.station) : '') + ' · tap to view or edit</div></div>';
        }).join('') : '<div class="empty">No fill-ups yet.</div>') +
        (flAll.length > 3
          ? '<button class="btn ghost" id="fu_more" style="width:100%;margin-top:8px">' +
            (fuShowAll ? 'Show less' : 'Show more — ' + (flAll.length - 3) + ' more fill-up' + (flAll.length - 3 === 1 ? '' : 's')) + '</button>'
          : '') + '</div>';

      /* v202 FUEL-TAB: the face's top strip — one small tab for
         Other expenses (the Revenue-tab pattern, v201), above
         everything the page is for. */
      var fxTabHtml = '<div class="row" style="margin-bottom:10px">' +
        '<button class="btn small ghost" id="fx_tab">🧾 Other expenses ›</button></div>';
      body.innerHTML = fxTabHtml + h;
      body.querySelector('#fx_tab').onclick = function () {
        fxView = true;
        Meticulous.modules.fuel.render(body);
      };

      /* v75: edit-mode prefill — the form opens holding the tapped
         entry's own values. Fields are marked touched so a stray
         OCR read can never silently rewrite them (v39 rule). The
         receipt photo shows when the record carries one. */
      if (editRec) {
        /* v118: even a stored record carrying old float residue
           opens at receipt precision (fuRoundL / fuRoundC). */
        var pre = { '#fu_date': editRec.date, '#fu_odo': editRec.odo, '#fu_l': fuRoundL(editRec.litres), '#fu_cost': fuRoundC(editRec.cost), '#fu_stn': editRec.station };
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
      /* v118: a row tap opens the DETAILS view for the entry
         (read-only first) — Edit lives there now, not as the
         tap's direct destination. */
      /* v177 (D6): Fill-ups Show more / Show less */
      var fuMore = body.querySelector('#fu_more');
      if (fuMore) fuMore.onclick = function () { fuShowAll = !fuShowAll; Meticulous.modules.fuel.render(body); };
      body.querySelectorAll('[data-fuedit]').forEach(function (el) {
        el.onclick = function () {
          detailFillIdx = +el.getAttribute('data-fuedit');
          detailDelArm = false; editErr = ''; saveNote = '';
          Meticulous.modules.fuel.render(body);
          try { if (body.scrollIntoView) body.scrollIntoView({ block: 'start' }); } catch (e) {}
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
      /* v248 (POWER-READ-FUEL-FIELDS): the receipt's rate per
         litre and station address ride exactly the same road as
         the sale time — held from a read, shown in the read line,
         saved on the record at Save. Not form fields. */
      var fuReadPrice = '';
      var fuReadAddr = '';
      /* v127: the receipt photo itself (the 1600px OCR rendition —
         already downscaled by TicketOCR.fileToOCRImage), held
         until Save. Before v127 the photo was read and THROWN
         AWAY: the save built the record with no photo field, so
         the v118 details page's photo slot had nothing to show
         for any entry (owner, Oct 17 09:53 MDT: "Why is there no
         photo entry?... The picture I took yesterday?"). Save now
         attaches it — see the save handler. */
      var fuPhoto = '';
      /* v142: per-photo race record for the receipt read — the
         cloud read starts at capture (PowerRead.beginEarly) and
         races the local read; litres/cost remember what the LOCAL
         read put in the fields so a later cloud answer can be
         compared against them (see fuCloudSettled). */
      var fuRace = null;
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
          fuPhoto = ocrUrl; /* v127: keep the photo for the record (see fuPhoto above) */
          var race = { litres: null, cost: null, delivered: false, prImg: null };
          fuRace = race;
          var startCloud = function (prImg) {
            if (token !== fuOcrToken) return;
            race.prImg = prImg || ocrUrl;
            if (window.PowerRead && PowerRead.beginEarly) {
              var h = PowerRead.beginEarly({ reader: 'text', image: race.prImg, origin: { module: 'fuel', label: 'Fuel' } });
              if (h) h.onSettled(function (out) { fuCloudSettled(token, race, out); });
            }
          };
          if (TicketOCR.urlToReadImage) TicketOCR.urlToReadImage(ocrUrl, 'text', startCloud);
          else startCloud(ocrUrl);
          TicketOCR.recognizeWithRotation(ocrUrl, function (p) {
            if (token !== fuOcrToken) return;
            try { fuSetRead('📖 Reading receipt… ' + Math.round(p * 100) + '%'); } catch (e) {}
          }).then(function (text) {
            if (token !== fuOcrToken) return;
            var parsed = TicketOCR.parseFuelReceipt(text);
            var rep = TicketOCR.describeFuelRead(parsed);
            race.litres = parsed.litres ? fuRoundL(parsed.litres) : null;
            race.cost = parsed.cost ? fuRoundC(parsed.cost) : null;
            fillField('#fu_l', fuRoundL(parsed.litres));
            fillField('#fu_cost', fuRoundC(parsed.cost));
            fillField('#fu_stn', parsed.station);
            fillField('#fu_date', parsed.date);
            if (parsed.time) fuReadTime = parsed.time;
            if (parsed.pricePerLitre) fuReadPrice = parsed.pricePerLitre;
            if (parsed.address) fuReadAddr = parsed.address;
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
            if (!parsed.litres || !parsed.cost) fuPowerRead(race.prImg || ocrUrl, token, race);
          }).catch(function () {
            if (token !== fuOcrToken) return;
            fuSetRead('<span style="color:#e67e22">Couldn\'t read that receipt — fill the form by hand.</span>');
          });
        });
      }
      /* v142: the receipt's cloud read settles (it started at
         capture, in parallel). A money field is CORRECTED only
         while it still holds exactly the value the local read put
         there and the driver hasn't touched it — the same guard
         fillField has always applied; a field the driver edited
         is never overwritten, and the form's Save stays the
         confirm for everything. */
      function fuCloudSettled(token, race, out) {
        if (token !== fuOcrToken || race !== fuRace) return;
        if (!out || out.status !== 'done') return;
        var txt = out.fields && out.fields.rawText;
        if (!txt || !window.TicketOCR) return;
        var parsed = TicketOCR.parseFuelReceipt(txt);
        var rep = TicketOCR.describeFuelRead(parsed);
        if (!rep.found.length) return;
        if (race.delivered) return;
        if (!race.litres && !race.cost) {
          /* The local read hasn't landed (or found nothing): the
             cloud transcription fills the form exactly the way the
             escalation delivery does — fill-only. */
          race.delivered = true;
          fuFillFromParsed(parsed, rep, '⚡ <b>Power read — check before saving:</b>');
          return;
        }
        race.delivered = true;
        var corrected = [], filled = [];
        function money(id, cloudVal, localVal, name) {
          if (!cloudVal) return;
          var e = body.querySelector(id);
          if (!e || e.getAttribute('data-touched')) return;
          if (!e.value) { e.value = cloudVal; filled.push(name); return; }
          if (localVal && e.value === localVal && cloudVal !== localVal) { e.value = cloudVal; corrected.push(name); }
        }
        money('#fu_l', parsed.litres ? fuRoundL(parsed.litres) : null, race.litres, 'litres');
        money('#fu_cost', parsed.cost ? fuRoundC(parsed.cost) : null, race.cost, 'total');
        fillField('#fu_stn', parsed.station);
        fillField('#fu_date', parsed.date);
        if (parsed.time && !fuReadTime) fuReadTime = parsed.time;
        if (parsed.pricePerLitre && !fuReadPrice) fuReadPrice = parsed.pricePerLitre;
        if (parsed.address && !fuReadAddr) fuReadAddr = parsed.address;
        if (corrected.length) {
          fuSetRead('⚡ <b>Power read corrected:</b> ' + esc(corrected.join(' + ')) + ' — check before saving.<br>Read: ' + esc(rep.found.join(' · ')));
        } else if (filled.length) {
          fuSetRead('⚡ <b>Power read filled in:</b> ' + esc(filled.join(' + ')) + ' — check before saving.<br>Read: ' + esc(rep.found.join(' · ')));
        } else {
          fuSetRead('✓ Power read agrees with the receipt read — check before saving.');
        }
      }
      fuCamInput.onchange = fuHandlePhoto;
      fuPickInput.onchange = fuHandlePhoto;

      /* v59: generic power-read consumer — cloud transcription fed
         through the existing receipt parser. Fill-only; the form's
         own Save is the confirm. */
      function fuFillFromParsed(parsed, rep, label) {
        fillField('#fu_l', fuRoundL(parsed.litres));
        fillField('#fu_cost', fuRoundC(parsed.cost));
        fillField('#fu_stn', parsed.station);
        fillField('#fu_date', parsed.date);
        if (parsed.time) fuReadTime = parsed.time;
        if (parsed.pricePerLitre) fuReadPrice = parsed.pricePerLitre;
        if (parsed.address) fuReadAddr = parsed.address;
        fuSetRead(label + ' ' + esc(rep.found.join(' · ')) +
          (rep.missing.length ? '<br><span style="color:#e67e22">Couldn\'t find: ' + esc(rep.missing.join(', ')) + '</span>' : ''));
      }
      function fuPowerRead(ocrUrl, token, race) {
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
            /* v142: the settle callback may already have delivered
               this read (the cloud beat the local read) — don't
               paint it twice. */
            if (race) {
              if (race.delivered) return;
              race.delivered = true;
            }
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
      /* v142: per-photo race record for the odometer read. */
      var fuOdoRace = null;
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
          var race = { km: null, cloudVal: null, delivered: false, prImg: null };
          fuOdoRace = race;
          var startCloud = function (prImg) {
            if (token !== fuOdoToken) return;
            race.prImg = prImg || ocrUrl;
            if (window.PowerRead && PowerRead.beginEarly) {
              var h = PowerRead.beginEarly({ reader: 'odometer', image: race.prImg, origin: { module: 'fuel', label: 'Fuel' } });
              if (h) h.onSettled(function (out) { fuOdoCloudSettled(token, race, setStatus, out); });
            }
          };
          if (TicketOCR.urlToReadImage) TicketOCR.urlToReadImage(ocrUrl, 'odometer', startCloud);
          else startCloud(ocrUrl);
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
              race.km = km;
              if (race.delivered && race.cloudVal && String(race.cloudVal) !== String(km)) {
                /* v142: the cloud value landed first and holds the
                   field; the local read speaks in the status line. */
                setStatus('⚡ <b>Power read — check before saving:</b> odometer <b>' + fmtKm(race.cloudVal) + ' km</b> is in the field. The on-device read got <b>' + fmtKm(km) + ' km</b> — type that instead if it\'s right.');
              } else {
                body.querySelector('#fu_odo').value = km;
                setStatus('📸 Odometer read: <b>' + fmtKm(km) + ' km</b>');
              }
            } else {
              var why = (km && window.PowerRead && PowerRead.odoImplausible) ? PowerRead.odoImplausible(km) : null;
              var master = (window.PowerRead && PowerRead.masterOdo) ? PowerRead.masterOdo() : null;
              if (km && why === 'jump') setStatus('<span style="color:#e67e22">That read (<b>' + fmtKm(km) + ' km</b>) is way past your current odometer' + (master ? ' (<b>' + fmtKm(master) + ' km</b>)' : '') + ' — it can\'t be right; it\'s likely another number in the photo (a receipt\'s invoice number, say). Type the real reading. Trying the power read…</span>');
              else if (km) setStatus('<span style="color:#e67e22">That read (<b>' + fmtKm(km) + ' km</b>) is below your current odometer — it can\'t be right. Trying the power read…</span>');
              else setStatus('<span style="color:#e67e22">Couldn\'t read the odometer — type it in.</span>');
              /* v59: power-read escalation — fills this same field
                 only; Save fill-up remains the confirm and the master
                 odometer still moves solely through that save. */
              fuOdoPowerRead(race.prImg || ocrUrl, token, setStatus, race);
            }
          }).catch(function () {
            if (token !== fuOdoToken) return;
            setStatus('<span style="color:#e67e22">Couldn\'t read the odometer — type it in.</span>');
          });
        });
      }
      /* v142: the Fuel odometer cloud read settles — same rules as
         the other surfaces: fill an empty field, correct a field
         still holding exactly the local value, never displace a
         typed or first-standing value. */
      function fuOdoCloudSettled(token, race, setStatus, out) {
        if (token !== fuOdoToken || race !== fuOdoRace) return;
        if (!out || out.status !== 'done') return;
        var v = out.fields && out.fields.value;
        if (!v) return;
        race.cloudVal = v;
        if (race.delivered) return;
        var fld = body.querySelector('#fu_odo');
        if (!race.km) {
          if (fld && !fld.value) {
            fld.value = v;
            race.delivered = true;
            setStatus('⚡ <b>Power read — check before saving:</b> odometer <b>' + fmtKm(v) + ' km</b>');
          }
          return;
        }
        if (String(v) === String(race.km)) {
          setStatus('✓ Power read agrees: odometer <b>' + fmtKm(v) + ' km</b> — check before saving.');
          return;
        }
        if (fld && String(fld.value) === String(race.km)) {
          fld.value = v;
          setStatus('⚡ <b>Power read corrected the odometer:</b> <b>' + fmtKm(v) + ' km</b> — check before saving.');
        } else {
          setStatus('⚡ Power read got odometer <b>' + fmtKm(v) + ' km</b> — type it in if that\'s the right one, otherwise keep yours.');
        }
      }
      fuOdoCamInput.onchange = fuOdoHandle;
      fuOdoPickInput.onchange = fuOdoHandle;

      /* v59: power-read escalation for the Fuel odometer photo. */
      function fuOdoPowerRead(ocrUrl, token, setStatus, race) {
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
            /* v142: no double-paint when the settle callback
               already delivered this value. */
            if (race) {
              race.cloudVal = v;
              if (race.delivered) return;
              race.delivered = true;
            }
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
          var prevPhoto = f[editFillIdx].photo;
          var updated = applyFillEdit(f[editFillIdx], formVals);
          if (fuReadTime) updated.time = fuReadTime;
          if (fuReadPrice) updated.pricePerLitre = fuReadPrice;
          if (fuReadAddr) updated.address = fuReadAddr;
          /* v127: a FRESH receipt photo replaces the stored one;
             no new photo → applyFillEdit already kept the old one. */
          var freshPhoto = !!(fuPhoto && fuPhoto !== updated.photo);
          if (freshPhoto) updated.photo = fuPhoto;
          f[editFillIdx] = updated;
          var editPhotoDropped = false;
          if (!saveFillsVerified(f)) {
            /* v127: if the fresh photo is what didn't fit, fall
               back to the entry's previous photo state and retry
               ONCE — the edit itself is never blocked by a photo. */
            var editRetry = false;
            if (freshPhoto) {
              if (prevPhoto) updated.photo = prevPhoto; else delete updated.photo;
              editPhotoDropped = true;
              editRetry = saveFillsVerified(f);
            }
            if (!editRetry) {
              showErr('Those changes did NOT go through — the app storage on your phone looks full, or the write failed, so the saved fill-up is unchanged. Your edit is still in the form — free up some phone space and tap “Save changes” again.');
              return;
            }
          }
          try { if (window.PowerRead && PowerRead.takeResult) PowerRead.takeResult('text', 'fuel'); } catch (e) {}
          if (window.FB && FB.saveDoc) FB.saveDoc('fuel', 'f' + Date.now(), updated);
          editFillIdx = null; editErr = '';
          var un = '';
          if (odoPlan.mode === 'correct') { try { App._store.set(wpKeyFor('mt_odo'), String(odoPlan.value)); } catch (e) {} try { if (App._logOdoReading) App._logOdoReading(odoPlan.value, 'fuel', null, true); } catch (e) {} un = odoOutcomeNote(); }
          else if (odoPlan.mode === 'refuse') { un = odoOutcomeNote(); }
          else if (hasOdo) { un = masterOnSave(odo); }
          /* v122: the fill's own reading joins the dated log at
             the fill's moment (see fuFillTs). */
          if (hasOdo && odoPlan.mode !== 'refuse' && odoPlan.mode !== 'correct') {
            try { if (App._logOdoReading) App._logOdoReading(odo, 'fuel', fuFillTs(updated)); } catch (e) {}
          }
          saveNote = un || '✓ Fill-up updated.';
          if (editPhotoDropped) saveNote += ' The new receipt photo didn\'t fit in the app storage, so it wasn\'t kept.';
          Meticulous.modules.fuel.render(body);
          return;
        }
        var rec = { date: formVals.date };
        /* v293 (FUEL-EDIT-STOMPED): a fill is born with a STABLE
           id and a version stamp. The id is the record's identity
           for cloud sync (an edit preserves it — applyFillEdit
           copies the original's fields), and updAt is the version
           the sync merge arbitrates by, so the newest version of
           a fill wins on every device and a stale book can never
           resurrect its old field values. */
        rec.id = 'fu' + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36);
        rec.updAt = Date.now();
        rec.profileId = wpActiveId(); // v242: the truck that took this fuel
        if (fuReadTime) rec.time = fuReadTime;
        if (fuReadPrice) rec.pricePerLitre = fuReadPrice;
        if (fuReadAddr) rec.address = fuReadAddr;
        if (hasOdo && odoPlan.mode !== 'refuse') rec.odo = odo;
        /* v156: a fill saved with NO reading of its own is stamped
           with the CURRENT master odometer — the app knows the
           reading, so a fill never lands odo-less again (the leg
           watch and Maintenance's lifetime figures feed on
           stamps). A reading the driver typed or a photo supplied
           always wins (rec.odo above); a REFUSED jump keeps the
           v86 contract — that save was told it carries no reading,
           and hasOdo is true there, so it never reaches this
           stamp. Existing entries are never rewritten: this
           stamps only the record being created, here at its save. */
        if (!(rec.odo > 0) && !hasOdo) {
          var stampMaster = null;
          try { if (window.App && App._masterOdometer) stampMaster = App._masterOdometer(); } catch (e) {}
          if (stampMaster > 0) rec.odo = stampMaster;
        }
        rec.litres = litresV;
        rec.cost = costV;
        rec.station = formVals.station;
        /* v127: the receipt photo rides on the record (see
           fuPhoto) — the details page and the edit form read
           rec.photo, which no save path ever wrote before v127. */
        if (fuPhoto) rec.photo = fuPhoto;
        f.push(rec);
        /* v75: the add path is verified too — a failed write used to
           look exactly like a saved fill-up. */
        var photoDropped = false;
        if (!saveFillsVerified(f)) {
          /* v127: the photo is the largest thing in the record —
             if it is what didn't fit, retry ONCE without it. The
             entry always saves; the photo is kept only when it
             fits, and the drop is said once (saveNote below). */
          var addRetry = false;
          if (rec.photo) { delete rec.photo; photoDropped = true; addRetry = saveFillsVerified(f); }
          if (!addRetry) {
            showErr('That fill-up did NOT save — the app storage on your phone looks full, or the write failed. Your entry is still in the form — free up some phone space and tap “Save fill-up” again.');
            return;
          }
        }
        /* v59: this save confirms the form — consume any power-read
           result that was waiting for this screen. */
        try { if (window.PowerRead && PowerRead.takeResult) PowerRead.takeResult('text', 'fuel'); } catch (e) {}
        if (window.FB && FB.saveDoc) FB.saveDoc('fuel', 'f' + Date.now(), rec);
        // v39: feed the master odometer (upward only) + show the outcome —
        // ONLY when a real reading was entered. An odo-less save never
        // touches the master (mt_odo) and just confirms the save.
        editErr = '';
        if (odoPlan.mode === 'correct') { try { App._store.set(wpKeyFor('mt_odo'), String(odoPlan.value)); } catch (e) {} try { if (App._logOdoReading) App._logOdoReading(odoPlan.value, 'fuel', null, true); } catch (e) {} saveNote = odoOutcomeNote(); }
        else if (odoPlan.mode === 'refuse') { saveNote = odoOutcomeNote(); }
        else { saveNote = hasOdo ? masterOnSave(odo) : '✓ Fill-up saved.'; }
        if (photoDropped) saveNote = (saveNote ? saveNote + ' ' : '') + 'The receipt photo didn\'t fit in the app storage, so this entry was saved without it.';
        /* v122: the fill's own reading joins the dated log at
           the fill's moment (see fuFillTs). */
        if (hasOdo && odoPlan.mode !== 'refuse' && odoPlan.mode !== 'correct') {
          try { if (App._logOdoReading) App._logOdoReading(odo, 'fuel', fuFillTs(rec)); } catch (e) {}
        }
        Meticulous.modules.fuel.render(body);
      };
      /* v146: my shared records republish on this module's own
         lifecycle — a fill saved or an expense added here lands
         in my connected payers' hands on the same pass this
         screen repaints (content-guarded in the pipe: unchanged
         facts are never written twice). */
      try { if (window.ConnectPipe) ConnectPipe.publishRecords(); } catch (e) {}
    }
  };
})();
