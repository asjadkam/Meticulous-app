/* Damage & Incident module — photo + record only (Meticulous.modules convention) */
(function () {
  'use strict';
  var S = function (k, d) { return App._store.get('dmg_' + k, d); };
  var W = function (k, v) { return App._store.set('dmg_' + k, v); };
  var esc = function (s) { return App._esc(s); };

  function reports() { return S('reports', []); }
  function tab() { return S('tab', 'load'); }

  /* v307: the OFFICE surface (owner, Nov 2, 2026 — the PTI
     module's v213 pattern, word for word in shape): office-only
     users (owners, fleet managers, office staff who do NOT
     drive) never file a damage report — their Damage screen is
     the VIEWER for their connected drivers' reports, read from
     the same sharedrecords doc the pipe publishes (rec.damage,
     CP.sharedDamage) with the photo one tap away (its
     sharedphotos rendition, CP.fetchPhoto). A peer sees a
     driver's reports here only when Damage & Incident is in
     his access — fetchRecords strips the section otherwise.
     Read-only by construction — no buttons that file, edit or
     send anything. */
  function officeDmgRowHtml(uid, r) {
    return '<div class="kv"><span>' + esc(r.date || '') +
      (r.kind === 'load' ? ' · Load' : ' · Equipment') +
      (r.dispatch ? ' · ' + esc(r.dispatch) : '') +
      '</span><b></b></div>' +
      '<div style="padding-left:14px;margin:1px 0;color:#555">' + esc(r.desc || '') + '</div>' +
      (r.photoRef && r.photoKey
        ? '<div style="margin:2px 0 4px"><button class="btn small ghost" data-dmgphoto="' + esc(uid) + ':' + esc(r.photoKey) + '">📸 Photo</button></div>' +
          '<div id="dmg_photo_' + esc(uid) + '_' + esc(r.photoKey) + '"></div>'
        : '');
  }
  function renderOfficeDamage(body) {
    body.innerHTML =
      '<div class="card"><h3>📸 Drivers\' damage & incident reports</h3>' +
      '<p class="note" style="margin-top:0">You don\'t file these — a report is the driver\'s own. These are the reports your connected drivers filed and shared with you.</p>' +
      '<div id="dmg_office_wrap"><p class="note">Loading…</p></div></div>';
    var wrap = null;
    try { wrap = body.querySelector('#dmg_office_wrap'); } catch (e) {}
    if (!wrap) return;
    if (!window.ConnectPipe || !ConnectPipe.fetchRecords) {
      wrap.innerHTML = '<div class="empty">No damage reports shared with you yet.</div>';
      return;
    }
    ConnectPipe.fetchRecords().then(function (out) {
      var recs = (out && out.records) || {};
      var uids = Object.keys(recs).filter(function (u) { return recs[u] && Array.isArray(recs[u].damage) && recs[u].damage.length; });
      if (!uids.length) {
        wrap.innerHTML = '<div class="empty">No damage reports shared with you yet. When a connected driver files one — and Damage &amp; Incident is ticked on your connection — it shows here.</div>';
        return;
      }
      var h = '';
      uids.forEach(function (uid) {
        var rec = recs[uid];
        var nm = rec.driverName || rec.driverBusiness || '';
        if (!nm) { try { if (ConnectPipe.peerNames) nm = (ConnectPipe.peerNames(uid) || [])[0] || ''; } catch (e) {} }
        h += '<div style="margin:10px 0 2px;font-weight:700">' + esc(nm || 'Driver') + '</div>';
        rec.damage.forEach(function (r) { h += officeDmgRowHtml(uid, r); });
      });
      wrap.innerHTML = h;
      /* the photo buttons: one tap fetches the rendition into
         its slot (the P&L fuel-receipt pattern) */
      wrap.querySelectorAll('[data-dmgphoto]').forEach(function (b) {
        b.onclick = function () {
          var parts = String(b.getAttribute('data-dmgphoto') || '').split(':');
          var uid = parts[0], key = parts.slice(1).join(':');
          var slot = null;
          try { slot = wrap.querySelector('#dmg_photo_' + uid + '_' + key); } catch (e) {}
          if (!slot || !window.ConnectPipe || !ConnectPipe.fetchPhoto) return;
          b.disabled = true;
          ConnectPipe.fetchPhoto(uid, key).then(function (url) {
            slot.innerHTML = url
              ? '<img src="' + url + '" style="width:100%;border-radius:8px;margin:4px 0 8px">'
              : '<p class="note">That photo could not be loaded.</p>';
            b.disabled = false;
          }).catch(function () { b.disabled = false; });
        };
      });
    }).catch(function () {
      wrap.innerHTML = '<div class="empty">The reports could not be loaded — check your connection and reopen.</div>';
    });
  }

  Meticulous.modules.damage = {
    status: function () { return reports().length + ' on file'; },
    render: function (body) {
      /* v307 (the PTI v213 pattern): an office-only user's
         Damage screen is the viewer — their drivers' reports,
         never the filing form. */
      var roleNow = '';
      try { roleNow = (App.userRole && App.userRole()) || ''; } catch (e) {}
      if (roleNow === 'office') { renderOfficeDamage(body); return; }
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
