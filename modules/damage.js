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
     CP.sharedDamage) with the photos in sharedphotos
     renditions (CP.fetchPhoto). A peer sees a driver's
     reports here only when Damage & Incident is in his
     access — fetchRecords strips the section otherwise.
     Read-only by construction — no buttons that file, edit or
     send anything.
     v312 (owner, Nov 2, 2026, 15:26 — "She should be able to
     just go to damage and incident module and see my report
     there... So she doesn't have to go looking for it!"): the
     v307 list was plain text rows — the report sat on the
     page with no door into it, and its (single) photo hid
     behind a small extra button. Now every shared report is
     ONE clear full-width tappable card, and one tap opens
     the FULL report — text, dispatch line, and ALL its
     photos (the fact's photoKeys, v312 in the pipe), loaded
     on open, no second hunt. The same list + open view also
     rides the driver face (a driver who is connected to
     other drivers sees their reports under his own), so no
     connected user has to go looking anywhere else. */
  function sharedEntries(recs) {
    var out = [];
    Object.keys(recs || {}).forEach(function (uid) {
      var rec = recs[uid];
      if (!rec || !Array.isArray(rec.damage)) return;
      var nm = rec.driverName || rec.driverBusiness || '';
      if (!nm) { try { if (window.ConnectPipe && ConnectPipe.peerNames) nm = (ConnectPipe.peerNames(uid) || [])[0] || ''; } catch (e) {} }
      rec.damage.forEach(function (r) { out.push({ uid: uid, name: nm || 'Driver', rec: r }); });
    });
    return out;
  }
  function reportKeys(r) {
    var keys = (Array.isArray(r.photoKeys) ? r.photoKeys : []).filter(Boolean);
    if (!keys.length && r.photoKey) keys = [r.photoKey];
    return keys;
  }
  function cleanDispatch(d) {
    d = String(d || '');
    return d && d.indexOf('undefined') === -1 ? d : '';
  }
  function sharedRowHtml(e, idx) {
    var r = e.rec, keys = reportKeys(r), dsp = cleanDispatch(r.dispatch);
    return '<button type="button" class="btn ghost" data-dmgopen="' + idx + '" ' +
      'style="display:block;width:100%;text-align:left;margin:0 0 8px;padding:12px;height:auto;white-space:normal">' +
      '<span style="display:block;font-weight:700">⚠️ Damage report from ' + esc(e.name) + ' — ' + esc(r.date || r.at || '') + '</span>' +
      '<span style="display:block;color:#555;margin-top:2px">' +
      (r.kind === 'load' ? 'Load' : 'Equipment') +
      (dsp ? ' · ' + esc(dsp) : '') +
      (keys.length ? ' · 📸 ' + keys.length + (keys.length === 1 ? ' photo' : ' photos') : '') +
      '</span>' +
      '<span style="display:block;color:#1a56db;font-weight:600;margin-top:4px">Tap to open ›</span></button>';
  }
  function openSharedReport(body, e) {
    var r = e.rec, keys = reportKeys(r), dsp = cleanDispatch(r.dispatch);
    var h = '<div class="card"><button class="btn small ghost" id="dmg_op_back">← Back</button>' +
      '<h3 style="margin-top:10px">⚠️ Damage report</h3>' +
      '<div class="kv"><span>From</span><b>' + esc(e.name) + '</b></div>' +
      '<div class="kv"><span>Filed</span><b>' + esc(r.at || r.date || '') + '</b></div>' +
      '<div class="kv"><span>Type</span><b>' + (r.kind === 'load' ? 'Load' : 'Equipment') + '</b></div>' +
      (dsp ? '<div class="kv"><span>Dispatch</span><b>' + esc(dsp) + '</b></div>' : '') +
      '<div style="margin:10px 0;color:#333;white-space:pre-wrap">' + esc(r.desc || '') + '</div>';
    keys.forEach(function (key, i) {
      h += '<div id="dmg_op_' + i + '"><p class="note">Loading photo ' + (i + 1) + ' of ' + keys.length + '…</p></div>';
    });
    if (!keys.length) h += '<p class="note">No photos were filed with this report.</p>';
    h += '</div>';
    body.innerHTML = h;
    var back = null;
    try { back = body.querySelector('#dmg_op_back'); } catch (err) {}
    if (back) back.onclick = function () { Meticulous.modules.damage.render(body); };
    if (!window.ConnectPipe || !ConnectPipe.fetchPhoto) return;
    keys.forEach(function (key, i) {
      var slot = null;
      try { slot = body.querySelector('#dmg_op_' + i); } catch (err) {}
      if (!slot) return;
      ConnectPipe.fetchPhoto(e.uid, key).then(function (url) {
        slot.innerHTML = url
          ? '<img src="' + url + '" style="width:100%;border-radius:8px;margin:4px 0 8px">'
          : '<p class="note">That photo could not be loaded.</p>';
      }).catch(function () {
        slot.innerHTML = '<p class="note">That photo could not be loaded.</p>';
      });
    });
  }
  function paintSharedInto(wrap, body, emptyHtml) {
    if (!window.ConnectPipe || !ConnectPipe.fetchRecords) {
      wrap.innerHTML = emptyHtml;
      return;
    }
    ConnectPipe.fetchRecords().then(function (out) {
      var entries = sharedEntries((out && out.records) || {});
      if (!entries.length) { wrap.innerHTML = emptyHtml; return; }
      var lastName = null, h = '';
      entries.forEach(function (e, idx) {
        if (e.name !== lastName) { h += '<div style="margin:10px 0 4px;font-weight:700">' + esc(e.name) + '</div>'; lastName = e.name; }
        h += sharedRowHtml(e, idx);
      });
      wrap.innerHTML = h;
      wrap.querySelectorAll('[data-dmgopen]').forEach(function (b) {
        b.onclick = function () {
          var e = entries[+b.getAttribute('data-dmgopen')];
          if (e) openSharedReport(body, e);
        };
      });
    }).catch(function () {
      wrap.innerHTML = '<div class="empty">The reports could not be loaded — check your connection and reopen.</div>';
    });
  }
  function renderOfficeDamage(body) {
    body.innerHTML =
      '<div class="card"><h3>📸 Drivers\' damage & incident reports</h3>' +
      '<p class="note" style="margin-top:0">You don\'t file these — a report is the driver\'s own. These are the reports your connected drivers filed and shared with you.</p>' +
      '<div id="dmg_office_wrap"><p class="note">Loading…</p></div></div>';
    var wrap = null;
    try { wrap = body.querySelector('#dmg_office_wrap'); } catch (e) {}
    if (!wrap) return;
    paintSharedInto(wrap, body,
      '<div class="empty">No damage reports shared with you yet. When a connected driver files one — and Damage &amp; Incident is ticked on your connection — it shows here.</div>');
  }
  /* the driver face's shared slot: the same list, quietly —
     present only when a connected driver actually shared a
     report with this user (nothing to hunt for, nothing to
     hide behind). */
  function paintSharedSlot(body) {
    var slot = null;
    try { slot = body.querySelector('#dmg_shared_slot'); } catch (e) {}
    if (!slot) return;
    if (!window.ConnectPipe || !ConnectPipe.fetchRecords) return;
    ConnectPipe.fetchRecords().then(function (out) {
      var entries = sharedEntries((out && out.records) || {});
      if (!entries.length) { slot.innerHTML = ''; return; }
      slot.innerHTML = '<div class="card"><h3>📸 Damage reports shared with you</h3><div id="dmg_shared_wrap"></div></div>';
      var wrap = null;
      try { wrap = slot.querySelector('#dmg_shared_wrap'); } catch (e) {}
      if (!wrap) return;
      var lastName = null, h = '';
      entries.forEach(function (e, idx) {
        if (e.name !== lastName) { h += '<div style="margin:10px 0 4px;font-weight:700">' + esc(e.name) + '</div>'; lastName = e.name; }
        h += sharedRowHtml(e, idx);
      });
      wrap.innerHTML = h;
      wrap.querySelectorAll('[data-dmgopen]').forEach(function (b) {
        b.onclick = function () {
          var e = entries[+b.getAttribute('data-dmgopen')];
          if (e) openSharedReport(body, e);
        };
      });
    }).catch(function () {});
  }

  Meticulous.modules.damage = {
    status: function () {
      /* v312: the office face (which can now reach this
         module — js/app.js) files nothing of its own; its
         card previews the viewer it opens. */
      try { if (App.userRole && App.userRole() === 'office') return 'Drivers\' reports'; } catch (e) {}
      return reports().length + ' on file';
    },
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

      /* v312: reports other connected drivers shared with
         THIS user ride under his own — filled in async by
         paintSharedSlot, present only when there are any. */
      h += '<div id="dmg_shared_slot"></div>';

      body.innerHTML = h;
      paintSharedSlot(body);
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
