/* Damage & Incident module — photo + record only (Meticulous.modules convention) */
(function () {
  'use strict';
  var S = function (k, d) { return App._store.get('dmg_' + k, d); };
  var W = function (k, v) { return App._store.set('dmg_' + k, v); };
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
        '<label class="f">📷 Photo</label><input type="file" id="dg_img" accept="image/*" multiple><div id="dg_prev"></div>' +
        '<label class="f">What happened?</label><textarea id="dg_desc" placeholder="Describe the damage or incident…"></textarea>' +
        '<button class="btn primary" id="dg_add">Save report</button>' +
        '<p class="note">Timestamped automatically. Active dispatch attached if one is running.</p></div>';

      var mine = reports().filter(function (r) { return r.tab === t; });
      h += '<div class="card"><h3>📁 ' + (t === 'load' ? 'Load' : 'Equipment') + ' reports</h3>' +
        (mine.length ? mine.slice().reverse().map(function (r) {
          return '<div class="listitem">' +
            ((r.photos && r.photos.length) ? r.photos.map(function (p) {
              return '<img src="' + p + '" style="width:100%;border-radius:8px;margin-bottom:8px">' +
                (App._photoDl ? App._photoDl(p, 'damage-' + (r.date || '')) : '');
            }).join('') : (r.photo ? '<img src="' + r.photo + '" style="width:100%;border-radius:8px;margin-bottom:8px">' +
              (App._photoDl ? App._photoDl(r.photo, 'damage-' + (r.date || '')) : '') : '')) +
            '<div class="a">' + esc(r.at) + '</div><div class="b">' + esc(r.desc) + (r.dispatch ? '<br>Dispatch: ' + esc(r.dispatch) : '') + '</div></div>';
        }).join('') : '<div class="empty">No reports yet.</div>') + '</div>';

      body.innerHTML = h;
      var photoList = [];
      body.querySelectorAll('[data-tab]').forEach(function (b) {
        b.onclick = function () { W('tab', b.getAttribute('data-tab')); Meticulous.modules.damage.render(body); };
      });
      body.querySelector('#dg_img').onchange = function (ev) {
        var files = Array.prototype.slice.call(ev.target.files || []);
        if (!files.length) return;
        photoList = [];
        var pending = files.length;
        files.forEach(function (f, i) {
          var r = new FileReader();
          r.onload = function () {
            /* v306: downscale before storing (house canvas pattern,
               1280px / JPEG 0.8) — raw camera files overflow the
               local store and the save silently dropped the report. */
            var img = new Image();
            img.onload = function () {
              var max = 1280, w = img.width, h = img.height;
              if (w > max || h > max) {
                var sc = Math.min(max / w, max / h);
                w = Math.round(w * sc); h = Math.round(h * sc);
              }
              try {
                var c = document.createElement('canvas');
                c.width = w; c.height = h;
                c.getContext('2d').drawImage(img, 0, 0, w, h);
                photoList[i] = c.toDataURL('image/jpeg', 0.8);
              } catch (e) { photoList[i] = r.result; }
              if (--pending === 0) {
                body.querySelector('#dg_prev').innerHTML = photoList.map(function (p) {
                  return '<img src="' + p + '" style="width:100%;border-radius:10px;margin-top:10px">';
                }).join('');
              }
            };
            img.onerror = function () {
              photoList[i] = r.result;
              if (--pending === 0) {
                body.querySelector('#dg_prev').innerHTML = photoList.map(function (p) {
                  return '<img src="' + p + '" style="width:100%;border-radius:10px;margin-top:10px">';
                }).join('');
              }
            };
            img.src = r.result;
          };
          r.readAsDataURL(f);
        });
      };
      body.querySelector('#dg_add').onclick = function () {
        var desc = body.querySelector('#dg_desc').value.trim();
        if (!desc && !photoList.length) { alert('Add a photo or a description.'); return; }
        var a = App._store.get('dsp_active', null);
        var r = reports();
        var rec = { tab: t, desc: desc, photo: photoList[0] || '', photos: photoList.slice(), at: new Date().toLocaleString(), dispatch: a ? (a.pickup + ' → ' + a.dropoff) : '' };
        /* v243 (CONNECT-SENDDOC): a report is born with its real
           date and its v242 profile stamp, so the Connect share
           picker finds it under the profile it was filed on (the
           picker reads unstamped records as Profile 1, so old
           reports keep working untouched). */
        try { rec.date = App._today(); } catch (e) {}
        try { if (App.workProfiles) rec.profileId = App.workProfiles.activeId(); } catch (e) {}
        r.push(rec);
        if (!W('reports', r)) { alert('The report could NOT be saved on this phone — storage is full. Nothing was saved; try again with fewer photos.'); return; }
        if (window.FB && FB.saveDoc) { var c = Object.assign({}, rec); delete c.photo; delete c.photos; FB.saveDoc('damage', 'd' + Date.now(), c); }
        Meticulous.modules.damage.render(body);
      };
    }
  };
})();
