/* Reminders module (Meticulous.modules convention)
   Three types: Safety (annual sticker expiry), PM (time OR odometer —
   whichever comes first), Location-based (geofence + message).
   Sorted by due date, due-soon highlighting. */
(function () {
  'use strict';
  var S = function (k, d) { return App._store.get('rem_' + k, d); };
  var W = function (k, v) { App._store.set('rem_' + k, v); };
  var esc = function (s) { return App._esc(s); };

  var TYPE_META = {
    safety: { icon: '🛡️', label: 'Safety' },
    pm: { icon: '🔧', label: 'PM service' },
    location: { icon: '📍', label: 'Location' }
  };

  function list() { return S('list', []); }
  /* v39 (addition #2): the PM math runs off the ONE master odometer
     (store key 'mt_odo', written upward-only by onboarding / Preferences
     / Fuel / the by-mile prompts) read LIVE — not this module's old
     private copy, which only changed when someone typed on this screen
     and silently went stale. The legacy rem_odo value is still honored
     as a floor so no pre-v39 reading is lost. */
  function odo() {
    var m = parseFloat(App._store.get('mt_odo', ''));
    var r = parseFloat(S('odo', ''));
    var v = Math.max(isFinite(m) ? m : 0, isFinite(r) ? r : 0);
    return v > 0 ? String(v) : '';
  }
  /* v39 (addition #2): the annual-safety expiry lives in the master key
     'mt_annualDate' (onboarding/Preferences/Maintenance). The reminder
     seeded at onboarding carries a COPY in expiryDate, which went stale
     whenever Preferences updated the master — so the live master wins
     whenever it is set. */
  function effExpiry(r) {
    if (r.type === 'safety') {
      var m = App._store.get('mt_annualDate', '');
      if (m) return m;
    }
    return r.expiryDate || '';
  }
  function distUnit() { var u = App._store.get('units', {}); return u.distance === 'mi' ? 'mi' : 'km'; }

  function daysUntil(iso) {
    if (!iso) return null;
    var t = new Date(iso + 'T00:00:00').getTime();
    if (isNaN(t)) return null;
    var now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.round((t - now.getTime()) / 86400000);
  }

  function statusOf(r) {
    var o = odo();
    if (r.type === 'safety') {
      var d = daysUntil(effExpiry(r));
      if (d === null) return { level: 'nodate', text: 'No date set' };
      if (d < 0) return { level: 'overdue', text: Math.abs(d) + 'd overdue' };
      if (d <= 14) return { level: 'soon', text: 'Due in ' + d + 'd' };
      return { level: 'ok', text: 'Due in ' + d + 'd' };
    }
    if (r.type === 'pm') {
      var dd = daysUntil(r.dueDate), bits = [], lvl = 'ok';
      var odoLeft = (r.dueOdometer !== '' && r.dueOdometer !== undefined && o !== '') ?
        (Number(r.dueOdometer) - Number(o)) : null;
      if (dd !== null) {
        if (dd < 0) { lvl = 'overdue'; bits.push('date passed'); }
        else if (dd <= 14) { lvl = 'soon'; bits.push('in ' + dd + 'd'); }
      }
      if (odoLeft !== null && !isNaN(odoLeft)) {
        if (odoLeft <= 0) { lvl = 'overdue'; bits.push('odometer reached'); }
        else if (odoLeft <= 1000) { if (lvl === 'ok') lvl = 'soon'; bits.push(odoLeft + ' ' + distUnit() + ' left'); }
      }
      if (!bits.length) return { level: 'nodate', text: 'No date / odometer' };
      return { level: lvl, text: bits.join(', ') };
    }
    return { level: 'nodate', text: (r.radiusM || 200) + 'm radius' };
  }

  function sortKey(r) {
    if (r.type === 'location') return '9999-99-99';
    if (r.type === 'safety') return effExpiry(r) || '9999-99-99';
    return r.expiryDate || r.dueDate || '9999-99-99';
  }

  function pill(st) {
    var color = st.level === 'overdue' ? '#d23b3b' : (st.level === 'soon' ? '#F26522' : '#6b7690');
    var bg = st.level === 'overdue' ? '#fdecea' : (st.level === 'soon' ? '#fff1e8' : '#eef1f8');
    return '<span class="pill" style="color:' + color + ';background:' + bg + '">' + esc(st.text) + '</span>';
  }

  Meticulous.modules.reminders = {
    status: function () {
      var l = list(), n = 0;
      l.forEach(function (r) { var s = statusOf(r); if (s.level === 'overdue' || s.level === 'soon') n++; });
      return l.length + ' reminder' + (l.length === 1 ? '' : 's') + (n ? ' · ' + n + ' due' : '');
    },
    render: function (body) {
      var showForm = S('showForm', false);
      var editing = S('editing', null);

      function draw() {
        var h = '<div class="card"><label class="f" style="margin-top:0">Current odometer (' + distUnit() + ')</label>' +
          '<input id="rm_odo" type="number" step="any" value="' + esc(odo()) + '" placeholder="e.g. 184500">' +
          '<p class="note" style="margin:6px 0 0">Used for PM reminders — whichever comes first, date or odometer.</p></div>';

        var sorted = list().slice().sort(function (a, b) { return sortKey(a) < sortKey(b) ? -1 : 1; });
        h += '<div class="card"><h3>⏰ Reminders (' + sorted.length + ')</h3>';
        if (!sorted.length) {
          h += '<div class="empty">No reminders yet.<br>Safety stickers, PM service, and location alerts live here.</div>';
        } else {
          sorted.forEach(function (r) {
            var m = TYPE_META[r.type] || TYPE_META.safety;
            var st = statusOf(r);
            var border = st.level === 'overdue' ? 'border-left:4px solid #d23b3b' :
                         st.level === 'soon' ? 'border-left:4px solid #F26522' : '';
            h += '<div class="listitem" style="' + border + '"><div class="a">' + m.icon + ' ' + esc(r.title || m.label) + '</div>' +
              '<div class="b">' + m.label + ' · ' + pill(st) + '</div>' +
              (r.notes ? '<div class="b">' + esc(r.notes) + '</div>' : '') +
              (r.type === 'location' && r.message ? '<div class="b">“' + esc(r.message) + '”</div>' : '') +
              '<div style="margin-top:6px"><a href="#" data-edit="' + r.id + '" style="font-size:13px;color:var(--navy)">Edit</a> · ' +
              '<a href="#" data-del="' + r.id + '" style="font-size:13px;color:#d23b3b">Delete</a></div></div>';
          });
        }
        h += showForm ? '' : '<button class="btn primary small" id="rm_new">+ Add reminder</button></div>';

        if (showForm) {
          var r = editing || { type: 'safety', title: '', expiryDate: '', dueDate: '', dueOdometer: '', lat: '', lng: '', radiusM: 200, message: '', notes: '' };
          h += '<div class="card"><h3>' + (editing ? 'Edit reminder' : 'New reminder') + '</h3>' +
            '<label class="f">Type</label><select id="rm_type">' +
            '<option value="safety"' + (r.type === 'safety' ? ' selected' : '') + '>🛡️ Safety — sticker expiry</option>' +
            '<option value="pm"' + (r.type === 'pm' ? ' selected' : '') + '>🔧 PM — service by date or odometer</option>' +
            '<option value="location"' + (r.type === 'location' ? ' selected' : '') + '>📍 Location — alert on arrival</option></select>' +
            '<label class="f">Title</label><input id="rm_title" value="' + esc(r.title) + '" placeholder="e.g. Annual safety inspection">' +
            '<div id="rm_dyn"></div>' +
            '<label class="f">Notes</label><input id="rm_notes" value="' + esc(r.notes) + '" placeholder="Optional">' +
            '<div class="row"><button class="btn ghost small" id="rm_cancel">Cancel</button>' +
            '<button class="btn primary small" id="rm_save">Save reminder</button></div></div>';
        }
        body.innerHTML = h;
        wire();
        if (showForm) drawDyn();
      }

      function drawDyn() {
        var type = body.querySelector('#rm_type').value;
        var r = editing || {};
        var d = body.querySelector('#rm_dyn');
        if (type === 'safety') {
          d.innerHTML = '<label class="f">Expiry date</label><input id="rm_exp" type="date" value="' + esc(r.expiryDate || '') + '">';
        } else if (type === 'pm') {
          d.innerHTML = '<label class="f">Due date</label><input id="rm_duedate" type="date" value="' + esc(r.dueDate || '') + '">' +
            '<label class="f">Due odometer (' + distUnit() + ')</label><input id="rm_dueodo" type="number" step="any" value="' + esc(r.dueOdometer || '') + '" placeholder="e.g. 190000">' +
            '<p class="note">Whichever comes first triggers the reminder.</p>';
        } else {
          var o = App._store.get('onboarding', {});
          d.innerHTML = '<div class="row"><div><label class="f">Latitude</label><input id="rm_lat" type="number" step="any" value="' + esc(r.lat || '') + '"></div>' +
            '<div><label class="f">Longitude</label><input id="rm_lng" type="number" step="any" value="' + esc(r.lng || '') + '"></div></div>' +
            '<label class="f">Radius (meters)</label><input id="rm_rad" type="number" value="' + esc(r.radiusM || 200) + '">' +
            '<label class="f">Message on arrival</label><textarea id="rm_msg" placeholder="e.g. Call dispatcher at the pit">' + esc(r.message || '') + '</textarea>' +
            (o.baseLocation ? '<p class="note">Your base: ' + esc(o.baseLocation) + '</p>' : '');
        }
      }

      function wire() {
        var odoInput = body.querySelector('#rm_odo');
        odoInput.addEventListener('change', function () {
          /* v39: typing a current odometer here writes the MASTER
             (upward only, via App._bumpOdometer) and mirrors the result
             locally — this screen no longer keeps a private reading. */
          var v = odoInput.value.trim();
          if (v && window.App && App._bumpOdometer) {
            var res = App._bumpOdometer(parseFloat(v));
            if (res && res.value) W('odo', String(res.value));
          } else if (v) {
            W('odo', v);
          }
          draw();
        });
        var nb = body.querySelector('#rm_new');
        if (nb) nb.onclick = function () { W('editing', null); W('showForm', true); draw(); };
        var cb = body.querySelector('#rm_cancel');
        if (cb) cb.onclick = function () { W('editing', null); W('showForm', false); draw(); };
        var ts = body.querySelector('#rm_type');
        if (ts) ts.onchange = drawDyn;
        var sv = body.querySelector('#rm_save');
        if (sv) sv.onclick = function () {
          var type = body.querySelector('#rm_type').value;
          var title = body.querySelector('#rm_title').value.trim();
          if (!title) { alert('Give the reminder a title.'); return; }
          var rec = editing || { id: 'rem' + Date.now() };
          rec.type = type; rec.title = title;
          rec.notes = body.querySelector('#rm_notes').value.trim();
          if (type === 'safety') {
            rec.expiryDate = body.querySelector('#rm_exp').value;
            if (!rec.expiryDate) { alert('Pick an expiry date.'); return; }
          } else if (type === 'pm') {
            rec.dueDate = body.querySelector('#rm_duedate').value;
            rec.dueOdometer = body.querySelector('#rm_dueodo').value.trim();
            if (!rec.dueDate && !rec.dueOdometer) { alert('Set a due date, an odometer reading, or both.'); return; }
          } else {
            rec.lat = body.querySelector('#rm_lat').value.trim();
            rec.lng = body.querySelector('#rm_lng').value.trim();
            rec.radiusM = Number(body.querySelector('#rm_rad').value) || 200;
            rec.message = body.querySelector('#rm_msg').value.trim();
            if (!rec.lat || !rec.lng) { alert('Enter the location coordinates.'); return; }
          }
          var l = list();
          if (editing) l = l.map(function (x) { return x.id === rec.id ? rec : x; });
          else { rec.created = Date.now(); l.push(rec); }
          W('list', l); W('editing', null); W('showForm', false);
          draw();
        };
        body.querySelectorAll('[data-edit]').forEach(function (a) {
          a.onclick = function (e) {
            e.preventDefault();
            var id = a.getAttribute('data-edit');
            list().forEach(function (x) { if (x.id === id) W('editing', Object.assign({}, x)); });
            W('showForm', true); draw();
          };
        });
        body.querySelectorAll('[data-del]').forEach(function (a) {
          a.onclick = function (e) {
            e.preventDefault();
            if (!confirm('Delete this reminder?')) return;
            var id = a.getAttribute('data-del');
            W('list', list().filter(function (x) { return x.id !== id; }));
            draw();
          };
        });
      }

      draw();
    }
  };
})();
