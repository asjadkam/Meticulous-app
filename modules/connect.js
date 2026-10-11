/* Connect module — Phase 1 (Meticulous.modules convention)
   Connections (name / role / phone-email), share sheet with content-type
   picker (dispatch, damage photo, manifest, location), and a local outbox.
   Phase 1 is UI + local packaging only — real-time delivery arrives later. */
(function () {
  'use strict';
  var S = function (k, d) { return App._store.get('con_' + k, d); };
  var W = function (k, v) { App._store.set('con_' + k, v); };
  var esc = function (s) { return App._esc(s); };

  var TYPE_ICON = { dispatch: '🚚', damage: '📸', manifest: '📋', location: '📍' };
  var TYPE_LABEL = { dispatch: 'Dispatch', damage: 'Damage photo', manifest: 'Manifest', location: 'Location' };

  function conns() { return S('list', []); }
  function outbox() { return S('outbox', []); }

  /* shareable content pulled from other modules */
  function contentItems(type) {
    var out = [];
    if (type === 'dispatch') {
      App._store.get('dsp_list', []).forEach(function (d, i) {
        out.push({ id: d.id || ('d' + i), label: (d.date || d.at || '') + ' — ' + (d.site || d.destination || d.desc || 'Dispatch') });
      });
    } else if (type === 'damage') {
      App._store.get('dmg_reports', []).forEach(function (d, i) {
        out.push({ id: d.id || ('g' + i), label: (d.date || d.at || '') + ' — ' + (d.title || d.desc || 'Damage report') });
      });
    } else if (type === 'manifest') {
      App._store.get('manifest_feed', []).forEach(function (m, i) {
        out.push({ id: 'f' + i, label: (m.date || m.at || '') + ' — ' + (m.text || 'Manifest entry') });
      });
    } else if (type === 'location') {
      var o = App._store.get('onboarding', {});
      out.push({ id: 'base', label: 'Base — ' + (o.baseLocation || 'not set') });
      out.push({ id: 'current', label: 'My current location (when shared)' });
    }
    return out;
  }

  function fmtTs(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  Meticulous.modules.connect = {
    status: function () {
      var q = outbox().length;
      return conns().length + ' connection' + (conns().length === 1 ? '' : 's') + (q ? ', ' + q + ' queued' : '');
    },
    render: function (body) {
      var list = conns(), ob = outbox();
      var showAdd = S('showAdd', false);

      var h = '<div class="card" style="border-left:4px solid var(--orange)">' +
        '<h3>🔗 Phase 1 — local only</h3>' +
        '<p class="note" style="margin:0">Shares are packaged on this device and held in your outbox. ' +
        'Real-time delivery to your connections arrives in a later update.</p></div>';

      /* connections */
      h += '<div class="card"><h3>👥 My connections (' + list.length + ')</h3>';
      if (!list.length) {
        h += '<div class="empty">No connections yet.<br>Add your dispatcher, manager, or family below.</div>';
      } else {
        list.forEach(function (c, i) {
          h += '<div class="listitem"><div class="a">' + esc(c.name) + '</div>' +
            '<div class="b">' + esc(c.role || '') + (c.contact ? ' · ' + esc(c.contact) : '') + '</div>' +
            '<div class="row" style="margin-top:8px">' +
            '<button class="btn small navy" data-quick="dispatch" data-i="' + i + '">📋 Send dispatch</button>' +
            '<button class="btn small navy" data-quick="doc" data-i="' + i + '">📎 Send doc</button></div>' +
            '<div style="margin-top:6px"><a href="#" data-condel="' + i + '" style="color:#d23b3b;font-size:13px">Remove</a></div></div>';
        });
      }
      if (showAdd) {
        h += '<label class="f">Name</label><input id="cn_name" placeholder="e.g. Dispatcher Mike">' +
          '<div class="row"><div><label class="f">Role</label><select id="cn_role">' +
          ['Dispatcher', 'Fleet manager', 'Driver', 'Family', 'Mechanic', 'Other'].map(function (r) {
            return '<option>' + r + '</option>';
          }).join('') + '</select></div>' +
          '<div><label class="f">Phone / email</label><input id="cn_contact" placeholder="Optional"></div></div>' +
          '<div class="row"><button class="btn ghost small" id="cn_cancel">Cancel</button>' +
          '<button class="btn primary small" id="cn_save">Save connection</button></div>';
      } else {
        h += '<button class="btn navy small" id="cn_add">+ Add connection</button>';
      }
      h += '</div>';

      /* share sheet */
      h += '<div class="card"><h3>📤 Share something</h3>';
      if (!list.length) {
        h += '<p class="note">Add a connection first, then share dispatches, photos, manifests and locations.</p>';
      } else {
        h += '<label class="f">What to share</label><select id="sh_type">' +
          '<option value="dispatch">🚚 Dispatch</option><option value="damage">📸 Damage photo</option>' +
          '<option value="manifest">📋 Manifest</option><option value="location">📍 Location</option></select>' +
          '<div id="sh_itemwrap"></div>' +
          '<label class="f">Send to</label><select id="sh_con">' +
          list.map(function (c, i) { return '<option value="' + i + '">' + esc(c.name) + '</option>'; }).join('') + '</select>' +
          '<label class="f">Note (optional)</label><textarea id="sh_note" placeholder="Add a message..."></textarea>' +
          '<button class="btn primary" id="sh_queue">Queue share</button>';
      }
      h += '</div>';

      /* outbox */
      h += '<div class="card"><h3>📥 Outbox (' + ob.length + ')</h3>';
      if (!ob.length) {
        h += '<div class="empty">Nothing queued. Queued shares wait here until delivery is enabled.</div>';
      } else {
        ob.slice().reverse().forEach(function (o, ri) {
          var i = ob.length - 1 - ri;
          h += '<div class="listitem"><div class="a">' + (TYPE_ICON[o.type] || '📦') + ' ' + esc(o.label || TYPE_LABEL[o.type] || o.kind || 'Share') +
            ' <span class="pill">Queued</span></div>' +
            '<div class="b">To: ' + esc(o.to) + ' · ' + esc(fmtTs(o.ts)) + (o.note ? '<br>“' + esc(o.note) + '”' : '') + '</div>' +
            '<div style="margin-top:6px"><a href="#" data-obdel="' + i + '" style="color:#d23b3b;font-size:13px">Remove</a></div></div>';
        });
      }
      h += '</div>';

      body.innerHTML = h;

      /* wiring */
      var addBtn = body.querySelector('#cn_add');
      if (addBtn) addBtn.onclick = function () { W('showAdd', true); Meticulous.modules.connect.render(body); };
      var cancelBtn = body.querySelector('#cn_cancel');
      if (cancelBtn) cancelBtn.onclick = function () { W('showAdd', false); Meticulous.modules.connect.render(body); };
      var saveBtn = body.querySelector('#cn_save');
      if (saveBtn) saveBtn.onclick = function () {
        var name = body.querySelector('#cn_name').value.trim();
        if (!name) { alert('Enter a name.'); return; }
        var l = conns();
        l.push({ id: 'c' + Date.now(), name: name, role: body.querySelector('#cn_role').value, contact: body.querySelector('#cn_contact').value.trim() });
        W('list', l); W('showAdd', false);
        Meticulous.modules.connect.render(body);
      };
      body.querySelectorAll('[data-condel]').forEach(function (a) {
        a.onclick = function (e) {
          e.preventDefault();
          if (!confirm('Remove this connection?')) return;
          var l = conns(); l.splice(+a.getAttribute('data-condel'), 1); W('list', l);
          Meticulous.modules.connect.render(body);
        };
      });

      /* quick send buttons */
      body.querySelectorAll('[data-quick]').forEach(function (b) {
        b.onclick = function () {
          var i = +b.getAttribute('data-i');
          var kind = b.getAttribute('data-quick') === 'dispatch' ? 'Dispatch' : 'Document';
          var o = outbox();
          o.push({ type: b.getAttribute('data-quick'), kind: kind, label: kind, to: conns()[i].name, ts: Date.now(), note: '' });
          W('outbox', o);
          Meticulous.modules.connect.render(body);
        };
      });

      /* share sheet */
      var typeSel = body.querySelector('#sh_type');
      function drawItems() {
        var items = contentItems(typeSel.value);
        var wrap = body.querySelector('#sh_itemwrap');
        if (!items.length) {
          wrap.innerHTML = '<p class="note" style="margin:8px 0">No ' + esc(TYPE_LABEL[typeSel.value]).toLowerCase() +
            's saved yet — create one in its module first.</p>';
        } else {
          wrap.innerHTML = '<label class="f">Pick one</label><select id="sh_item">' +
            items.map(function (it) { return '<option value="' + esc(it.id) + '">' + esc(it.label) + '</option>'; }).join('') + '</select>';
        }
      }
      if (typeSel) {
        drawItems();
        typeSel.onchange = drawItems;
        body.querySelector('#sh_queue').onclick = function () {
          var itemSel = body.querySelector('#sh_item');
          if (!itemSel) { alert('Nothing to share yet — create it in its module first.'); return; }
          var ci = +body.querySelector('#sh_con').value;
          var o = outbox();
          o.push({
            type: typeSel.value,
            label: TYPE_LABEL[typeSel.value] + ' — ' + itemSel.options[itemSel.selectedIndex].text,
            to: conns()[ci].name, ts: Date.now(),
            note: body.querySelector('#sh_note').value.trim()
          });
          W('outbox', o);
          Meticulous.modules.connect.render(body);
        };
      }
      body.querySelectorAll('[data-obdel]').forEach(function (a) {
        a.onclick = function (e) {
          e.preventDefault();
          var o = outbox(); o.splice(+a.getAttribute('data-obdel'), 1); W('outbox', o);
          Meticulous.modules.connect.render(body);
        };
      });
    }
  };
})();
