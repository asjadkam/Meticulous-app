/* Damage & Incident module — photo + record only (Meticulous.modules convention) */
(function () {
  'use strict';
  var S = function (k, d) { return App._store.get('dmg_' + k, d); };
  var W = function (k, v) { App._store.set('dmg_' + k, v); };
  var esc = function (s) { return App._esc(s); };

  function reports() { return S('reports', []); }
  function tab() { return S('tab', 'load'); }

  Meticulous.modules.damage = {
    status: function () { return reports().length + ' on file'; },
    render: function (body) {
      var t = tab();
      var h = '<div class="row" style="margin-bottom:4px">' +
        '<button class="btn small ' + (t === 'load' ? 'primary' : 'ghost') + '" data-tab="load">📦 Load</button>' +
        '<button class="btn small ' + (t === 'equipment' ? 'primary' : 'ghost') + '" data-tab="equipment">🚛 Equipment</button></div>';

      h += '<div class="card"><h3>＋ New report (' + (t === 'load' ? 'Load' : 'Equipment') + ')</h3>' +
        '<label class="f">📷 Photo</label><input type="file" id="dg_img" accept="image/*" capture="environment"><div id="dg_prev"></div>' +
        '<label class="f">What happened?</label><textarea id="dg_desc" placeholder="Describe the damage or incident…"></textarea>' +
        '<button class="btn primary" id="dg_add">Save report</button>' +
        '<p class="note">Timestamped automatically. Active dispatch attached if one is running.</p></div>';

      var mine = reports().filter(function (r) { return r.tab === t; });
      h += '<div class="card"><h3>📁 ' + (t === 'load' ? 'Load' : 'Equipment') + ' reports</h3>' +
        (mine.length ? mine.slice().reverse().map(function (r) {
          return '<div class="listitem">' +
            (r.photo ? '<img src="' + r.photo + '" style="width:100%;border-radius:8px;margin-bottom:8px">' +
              (App._photoDl ? App._photoDl(r.photo, 'damage-' + (r.date || '')) : '') : '') +
            '<div class="a">' + esc(r.at) + '</div><div class="b">' + esc(r.desc) + (r.dispatch ? '<br>Dispatch: ' + esc(r.dispatch) : '') + '</div></div>';
        }).join('') : '<div class="empty">No reports yet.</div>') + '</div>';

      body.innerHTML = h;
      var photoData = '';
      body.querySelectorAll('[data-tab]').forEach(function (b) {
        b.onclick = function () { W('tab', b.getAttribute('data-tab')); Meticulous.modules.damage.render(body); };
      });
      body.querySelector('#dg_img').onchange = function (ev) {
        var f = ev.target.files[0]; if (!f) return;
        var r = new FileReader();
        r.onload = function () {
          photoData = r.result;
          body.querySelector('#dg_prev').innerHTML = '<img src="' + r.result + '" style="width:100%;border-radius:10px;margin-top:10px">';
        };
        r.readAsDataURL(f);
      };
      body.querySelector('#dg_add').onclick = function () {
        var desc = body.querySelector('#dg_desc').value.trim();
        if (!desc && !photoData) { alert('Add a photo or a description.'); return; }
        var a = App._store.get('dsp_active', null);
        var r = reports();
        var rec = { tab: t, desc: desc, photo: photoData, at: new Date().toLocaleString(), dispatch: a ? (a.pickup + ' → ' + a.dropoff) : '' };
        r.push(rec); W('reports', r);
        if (window.FB && FB.saveDoc) { var c = Object.assign({}, rec); delete c.photo; FB.saveDoc('damage', 'd' + Date.now(), c); }
        Meticulous.modules.damage.render(body);
      };
    }
  };
})();
