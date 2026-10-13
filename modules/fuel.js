/* Fuel & Expense module — Meticulous standalone (Meticulous.modules convention) */
(function () {
  'use strict';
  var S = function (k, d) { return App._store.get('fuel_' + k, d); };
  var W = function (k, v) { App._store.set('fuel_' + k, v); };
  var esc = function (s) { return App._esc(s); };

  function fills() { return S('fills', []); }

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
        '<label class="f">Date</label><input type="date" id="fu_date" value="' + App._today() + '">' +
        '<div class="row"><div><label class="f">Odometer (km)</label><input id="fu_odo" type="number" inputmode="decimal"></div>' +
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
        '<button class="btn primary" id="fu_add">Save fill-up</button></div>';

      h += '<div class="card"><h3>🧾 Other expenses</h3>' +
        '<div class="row"><div><label class="f">What</label><input id="fx_what" placeholder="e.g. DEF fluid"></div>' +
        '<div><label class="f">Cost $</label><input id="fx_cost" type="number" inputmode="decimal"></div></div>' +
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
      function fuPreview(ev) {
        var f = ev.target.files[0]; if (!f) return;
        var r = new FileReader();
        r.onload = function () { body.querySelector('#fu_prev').innerHTML = '<img src="' + r.result + '" style="width:100%;border-radius:10px;margin-top:10px">'; };
        r.readAsDataURL(f);
      }
      fuCamInput.onchange = fuPreview;
      fuPickInput.onchange = fuPreview;
      body.querySelector('#fu_add').onclick = function () {
        var odo = parseFloat(body.querySelector('#fu_odo').value);
        if (!odo) { alert('Enter the odometer reading.'); return; }
        var f = fills();
        var rec = { date: body.querySelector('#fu_date').value || App._today(), odo: odo, litres: body.querySelector('#fu_l').value, cost: body.querySelector('#fu_cost').value, station: body.querySelector('#fu_stn').value.trim() };
        f.push(rec); W('fills', f);
        if (window.FB && FB.saveDoc) FB.saveDoc('fuel', 'f' + Date.now(), rec);
        Meticulous.modules.fuel.render(body);
      };
      body.querySelector('#fx_add').onclick = function () {
        var what = body.querySelector('#fx_what').value.trim(), cost = body.querySelector('#fx_cost').value;
        if (!what || !cost) return;
        var x = S('expenses', []); x.push({ what: what, cost: cost, date: App._today() }); W('expenses', x);
        Meticulous.modules.fuel.render(body);
      };
    }
  };
})();
