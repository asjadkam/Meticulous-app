/* Fuel & Expense module — Meticulous standalone (Meticulous.modules convention) */
(function () {
  'use strict';
  var S = function (k, d) { return App._store.get('fuel_' + k, d); };
  var W = function (k, v) { App._store.set('fuel_' + k, v); };
  var esc = function (s) { return App._esc(s); };

  function fills() { return S('fills', []); }

  /* v39: note from the most recent save (e.g. the master-odometer
     outcome), shown at the top of the Fuel-up card after re-render. */
  var saveNote = '';
  function fmtKm(v) { return Number(v).toLocaleString('en-CA'); }

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
    status: function () {
      var t = mpgTrend();
      return t.length ? 'MPG: ' + t[t.length - 1].mpg + ' km/L' : fills().length + ' entries';
    },
    render: function (body) {
      var trend = mpgTrend();
      var h = '<div class="card"><h3>⛽ Fuel trend</h3>' +
        (trend.length ? '<div class="center" style="font-size:24px;font-weight:800;color:var(--navy)">' + trend[trend.length - 1].mpg + ' <small style="font-size:13px">km/L</small></div>' +
          '<div class="note center">Last ' + trend.length + ' fill-ups</div>' +
          trend.slice(-8).map(function (t) { return '<div class="kv"><span>' + esc(t.date) + '</span><b>' + t.mpg + '</b></div>'; }).join('')
          : '<div class="empty">Add 2+ fill-ups with odometer readings to see MPG.</div>') + '</div>';

      h += '<div class="card"><h3>＋ Fuel-up</h3>' +
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
        '<button class="btn primary" id="fu_add">Save fill-up</button></div>';

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

      h += '<div class="card"><h3>📒 Fill-ups</h3>' +
        (fills().length ? fills().slice().reverse().map(function (f) {
          return '<div class="listitem"><div class="a">' + esc(f.litres) + ' L — $' + esc(f.cost) + '</div>' +
            '<div class="b">' + esc(f.date) + ' · odo ' + esc(f.odo) + (f.station ? ' · ' + esc(f.station) : '') + '</div></div>';
        }).join('') : '<div class="empty">No fill-ups yet.</div>') + '</div>';

      body.innerHTML = h;
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
        if (e) e.addEventListener('input', function () { e.setAttribute('data-touched', '1'); });
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
            if (rep.found.length) {
              fuSetRead('⛽ Read: ' + esc(rep.found.join(' · ')) +
                (rep.missing.length ? '<br><span style="color:#e67e22">Couldn\'t find: ' + esc(rep.missing.join(', ')) + '</span>' : ''));
            } else {
              fuSetRead('<span style="color:#e67e22">Couldn\'t read anything from that receipt — fill the form by hand.</span>');
            }
          }).catch(function () {
            if (token !== fuOcrToken) return;
            fuSetRead('<span style="color:#e67e22">Couldn\'t read that receipt — fill the form by hand.</span>');
          });
        });
      }
      fuCamInput.onchange = fuHandlePhoto;
      fuPickInput.onchange = fuHandlePhoto;

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
            if (km) {
              body.querySelector('#fu_odo').value = km;
              setStatus('📸 Odometer read: <b>' + fmtKm(km) + ' km</b>');
            } else {
              setStatus('<span style="color:#e67e22">Couldn\'t read the odometer — type it in.</span>');
            }
          }).catch(function () {
            if (token !== fuOdoToken) return;
            setStatus('<span style="color:#e67e22">Couldn\'t read the odometer — type it in.</span>');
          });
        });
      }
      fuOdoCamInput.onchange = fuOdoHandle;
      fuOdoPickInput.onchange = fuOdoHandle;

      body.querySelector('#fu_add').onclick = function () {
        var odo = parseFloat(body.querySelector('#fu_odo').value);
        if (!odo) { alert('Enter the odometer reading.'); return; }
        var f = fills();
        var rec = { date: body.querySelector('#fu_date').value || App._today(), odo: odo, litres: body.querySelector('#fu_l').value, cost: body.querySelector('#fu_cost').value, station: body.querySelector('#fu_stn').value.trim() };
        f.push(rec); W('fills', f);
        if (window.FB && FB.saveDoc) FB.saveDoc('fuel', 'f' + Date.now(), rec);
        // v39: feed the master odometer (upward only) + show the outcome
        saveNote = masterOnSave(odo);
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
