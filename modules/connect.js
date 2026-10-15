/* Connect module — Phase 1 (Meticulous.modules convention)
   Connections (name / role / phone-email), per-connection share
   pickers, and a local outbox. Phase 1 is UI + local packaging only —
   real-time delivery arrives with Connect Phase 2.

   v76 (owner directive Oct 14 19:15 + boss QA F7): TWO cards only —
   (1) Current connections (the list + Add; sharing lives ON the
   connection, via its own picker), (2) History (the outbox, rendered
   as history; queued items are pending). The "Phase 1 — local only"
   banner card and the standalone "Share something" card are gone —
   the local-only honesty is ONE quiet line inside the module. The
   per-connection Send buttons now package the ACTUAL content (a
   dispatch share carries the dispatch's fields, and the picker names
   dispatches by jobSite) instead of content-free stubs. No native
   alert()/confirm() — errors and the remove confirm are in-page,
   like the newer modules. Store keys unchanged (con_list/con_outbox);
   old outbox stubs still render in History. */
(function () {
  'use strict';
  var S = function (k, d) { return App._store.get('con_' + k, d); };
  var W = function (k, v) { App._store.set('con_' + k, v); };
  var esc = function (s) { return App._esc(s); };

  var TYPE_ICON = { dispatch: '🚚', damage: '📸', manifest: '📋', location: '📍', doc: '📎' };
  var TYPE_LABEL = { dispatch: 'Dispatch', damage: 'Damage photo', manifest: 'Manifest', location: 'Location', doc: 'Document' };
  var DOC_TYPES = ['damage', 'manifest', 'location'];

  function conns() { return S('list', []); }
  function outbox() { return S('outbox', []); }

  /* ---- UI state (this session only — never persisted) ---- */
  var uiAdd = false;        // add-connection form open
  var uiAddErr = '';        // inline error inside the add form
  var uiAddDraft = null;    // {name, contact} kept across a failed save
  var uiPicker = null;      // {conn: index, type: 'dispatch'|DOC_TYPES…}
  var uiConfirmDel = -1;    // connection index awaiting its inline confirm
  var uiFlash = '';         // one-shot note at the top of the connections card

  function dispatchName(d) {
    /* v76 (F7): dispatch records carry jobSite — the old picker read
       site/destination/desc, which dispatch records don't carry, so
       every real dispatch listed as a bare "date — Dispatch". */
    return d.jobSite || d.site || d.destination || d.desc || 'Dispatch';
  }

  /* shareable content pulled from other modules; each item carries
     the CONTENT a share packages (Phase 1: packaged locally into the
     outbox item — the same payload Phase 2 delivery will send). */
  function contentItems(type) {
    var out = [];
    if (type === 'dispatch') {
      App._store.get('dsp_list', []).forEach(function (d, i) {
        out.push({
          id: d.id || ('d' + i),
          label: (d.date || '') + ' — ' + dispatchName(d),
          content: {
            jobSite: dispatchName(d), date: d.date || '', scheduledAt: d.scheduledAt || '',
            equipment: d.equipment || '', material: d.material || '',
            ticketNo: d.ticketNo || '', notes: d.notes || ''
          }
        });
      });
    } else if (type === 'damage') {
      App._store.get('dmg_reports', []).forEach(function (d, i) {
        out.push({
          id: d.id || ('g' + i),
          label: (d.date || d.at || '') + ' — ' + (d.title || d.desc || 'Damage report'),
          content: { title: d.title || '', desc: d.desc || '', date: d.date || d.at || '' }
        });
      });
    } else if (type === 'manifest') {
      App._store.get('manifest_feed', []).forEach(function (m, i) {
        out.push({
          id: 'f' + i,
          label: (m.date || m.at || '') + ' — ' + (m.text || 'Manifest entry'),
          content: { text: m.text || '', date: m.date || m.at || '' }
        });
      });
    } else if (type === 'location') {
      var o = App._store.get('onboarding', {});
      out.push({ id: 'base', label: 'Base — ' + (o.baseLocation || 'not set'), content: { base: o.baseLocation || '' } });
      out.push({ id: 'current', label: 'My current location (when shared)', content: { current: true } });
    }
    return out;
  }

  function queueShare(connIdx, type, item) {
    var c = conns()[connIdx];
    if (!c || !item) return false;
    var o = outbox();
    o.push({
      type: type,
      label: (TYPE_LABEL[type] || 'Share') + ' — ' + item.label,
      to: c.name, connId: c.id || '', refId: item.id,
      content: item.content || null,
      ts: Date.now(), note: ''
    });
    return W('outbox', o) !== false;
  }

  /* the history line's content summary (new shares); legacy stubs
     carry no content and simply show no summary */
  function contentSummary(o) {
    var c = o && o.content;
    if (!c) return '';
    if (o.type === 'dispatch') {
      return [c.jobSite, c.scheduledAt ? String(c.scheduledAt).replace('T', ' ') : c.date, c.material]
        .filter(Boolean).join(' · ');
    }
    if (o.type === 'damage') return c.title || c.desc || '';
    if (o.type === 'manifest') return c.text || '';
    if (o.type === 'location') return c.base ? 'Base — ' + c.base : (c.current ? 'Current location' : '');
    return '';
  }

  function fmtTs(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  Meticulous.modules.connect = {
    /* v78: the card preview — shares WAITING lead (the fact that
       needs the user); the connection count is the quiet fallback. */
    status: function () {
      var q = outbox().length, n = conns().length;
      var cs = n + ' connection' + (n === 1 ? '' : 's');
      if (q) return q + ' waiting to send' + (n ? ' · ' + cs : '');
      return n ? cs : 'No connections yet';
    },
    render: function (body) {
      var list = conns(), ob = outbox();

      /* ============ CARD 1: Current connections ============ */
      var h = '<div class="card"><h3>👥 Current connections (' + list.length + ')</h3>' +
        /* the local-only honesty: ONE quiet line, not a banner card */
        '<p class="note" style="margin-top:0">Shares are packaged on this device and wait in History below — delivery to your connections arrives in a later update.</p>';
      if (uiFlash) h += '<p class="note" style="color:#2e7d32;font-weight:600">' + esc(uiFlash) + '</p>';
      if (!list.length) {
        h += '<div class="empty">No connections yet.<br>Add your dispatcher, manager, or family below.</div>';
      } else {
        list.forEach(function (c, i) {
          h += '<div class="listitem"><div class="a">' + esc(c.name) + '</div>' +
            '<div class="b">' + esc(c.role || '') + (c.contact ? ' · ' + esc(c.contact) : '') + '</div>' +
            '<div class="row" style="margin-top:8px">' +
            '<button class="btn small navy" data-quick="dispatch" data-i="' + i + '">📋 Send dispatch</button>' +
            '<button class="btn small navy" data-quick="doc" data-i="' + i + '">📎 Send doc</button></div>';
          /* the share picker lives ON the connection (v76) */
          if (uiPicker && uiPicker.conn === i) {
            var isDsp = uiPicker.type === 'dispatch';
            h += '<div style="border-top:1px solid #e3e3e3;margin-top:10px;padding-top:8px">' +
              '<div style="font-weight:700;margin-bottom:6px">' + (isDsp ? '📋 Send a dispatch to ' : '📎 Send a document to ') + esc(c.name) + '</div>';
            if (!isDsp) {
              h += '<label class="f">Kind</label><select id="cn_ptype">' +
                DOC_TYPES.map(function (t) {
                  return '<option value="' + t + '"' + (uiPicker.type === t ? ' selected' : '') + '>' + TYPE_ICON[t] + ' ' + TYPE_LABEL[t] + '</option>';
                }).join('') + '</select>';
            }
            var items = contentItems(uiPicker.type);
            if (!items.length) {
              h += '<p class="note" style="margin:8px 0">No ' + esc((TYPE_LABEL[uiPicker.type] || 'items').toLowerCase()) +
                's saved yet — create one in its module first.</p>';
            } else {
              h += items.map(function (it, ii) {
                return '<button class="btn ghost small" data-pick="' + ii + '" style="display:block;width:100%;text-align:left;margin-top:6px">' +
                  (TYPE_ICON[uiPicker.type] || '📦') + ' ' + esc(it.label) + '</button>';
              }).join('');
            }
            h += '<button class="btn ghost small" id="cn_pcancel" style="margin-top:8px">Cancel</button></div>';
          }
          /* remove: in-page two-step confirm, never a native dialog */
          if (uiConfirmDel === i) {
            h += '<div style="margin-top:8px"><span style="font-size:13px">Remove ' + esc(c.name) + '?</span> ' +
              '<button class="btn small" data-condel-yes="' + i + '" style="background:#d23b3b;color:#fff">Yes, remove</button> ' +
              '<button class="btn small ghost" id="cn_del_no">Keep</button></div>';
          } else {
            h += '<div style="margin-top:6px"><a href="#" data-condel="' + i + '" style="color:#d23b3b;font-size:13px">Remove</a></div>';
          }
          h += '</div>';
        });
      }
      if (uiAdd) {
        var dr = uiAddDraft || {};
        h += '<label class="f">Name</label><input id="cn_name" placeholder="e.g. Dispatcher Mike" value="' + esc(dr.name || '') + '">' +
          '<div class="row"><div><label class="f">Role</label><select id="cn_role">' +
          ['Dispatcher', 'Fleet manager', 'Driver', 'Family', 'Mechanic', 'Other'].map(function (r) {
            return '<option>' + r + '</option>';
          }).join('') + '</select></div>' +
          '<div><label class="f">Phone / email</label><input id="cn_contact" placeholder="Optional" value="' + esc(dr.contact || '') + '"></div></div>' +
          (uiAddErr ? '<p class="note" id="cn_err" style="color:#c0392b;font-weight:600;margin-top:6px">' + esc(uiAddErr) + '</p>' : '') +
          '<div class="row"><button class="btn ghost small" id="cn_cancel">Cancel</button>' +
          '<button class="btn primary small" id="cn_save">Save connection</button></div>';
      } else {
        h += '<button class="btn navy small" id="cn_add">+ Add connection</button>';
      }
      h += '</div>';

      /* ============ CARD 2: History ============ */
      h += '<div class="card"><h3>🕘 History (' + ob.length + ')</h3>';
      if (!ob.length) {
        h += '<div class="empty">Nothing shared yet. Shares you queue wait here until delivery is enabled.</div>';
      } else {
        ob.slice().reverse().forEach(function (o, ri) {
          var i = ob.length - 1 - ri;
          var sum = contentSummary(o);
          h += '<div class="listitem"><div class="a">' + (TYPE_ICON[o.type] || '📦') + ' ' + esc(o.label || TYPE_LABEL[o.type] || o.kind || 'Share') +
            ' <span class="pill">Queued — on this device</span></div>' +
            '<div class="b">To: ' + esc(o.to || '') + ' · ' + esc(fmtTs(o.ts)) +
            (sum ? '<br>' + esc(sum) : '') +
            (o.note ? '<br>“' + esc(o.note) + '”' : '') + '</div>' +
            '<div style="margin-top:6px"><a href="#" data-obdel="' + i + '" style="color:#d23b3b;font-size:13px">Remove</a></div></div>';
        });
      }
      h += '</div>';

      body.innerHTML = h;
      uiFlash = ''; // one-shot

      /* ---- wiring ---- */
      var rerender = function () { Meticulous.modules.connect.render(body); };
      var addBtn = body.querySelector('#cn_add');
      if (addBtn) addBtn.onclick = function () { uiAdd = true; uiAddErr = ''; rerender(); };
      var cancelBtn = body.querySelector('#cn_cancel');
      if (cancelBtn) cancelBtn.onclick = function () { uiAdd = false; uiAddErr = ''; uiAddDraft = null; rerender(); };
      var saveBtn = body.querySelector('#cn_save');
      if (saveBtn) saveBtn.onclick = function () {
        var name = body.querySelector('#cn_name').value.trim();
        var contact = body.querySelector('#cn_contact').value.trim();
        uiAddDraft = { name: name, contact: contact };
        if (!name) { uiAddErr = 'Enter a name first.'; rerender(); return; }
        var l = conns();
        l.push({ id: 'c' + Date.now(), name: name, role: body.querySelector('#cn_role').value, contact: contact });
        W('list', l);
        uiAdd = false; uiAddErr = ''; uiAddDraft = null;
        uiFlash = name + ' added to your connections.';
        rerender();
      };
      body.querySelectorAll('[data-condel]').forEach(function (a) {
        a.onclick = function (e) {
          e.preventDefault();
          uiConfirmDel = +a.getAttribute('data-condel');
          uiPicker = null;
          rerender();
        };
      });
      body.querySelectorAll('[data-condel-yes]').forEach(function (a) {
        a.onclick = function () {
          var l = conns(); l.splice(+a.getAttribute('data-condel-yes'), 1); W('list', l);
          uiConfirmDel = -1;
          rerender();
        };
      });
      var delNo = body.querySelector('#cn_del_no');
      if (delNo) delNo.onclick = function () { uiConfirmDel = -1; rerender(); };

      /* per-connection share buttons open that connection's picker */
      body.querySelectorAll('[data-quick]').forEach(function (b) {
        b.onclick = function () {
          var i = +b.getAttribute('data-i');
          var t = b.getAttribute('data-quick');
          uiPicker = (uiPicker && uiPicker.conn === i && ((t === 'dispatch') === (uiPicker.type === 'dispatch')))
            ? null
            : { conn: i, type: t === 'dispatch' ? 'dispatch' : 'damage' };
          uiConfirmDel = -1;
          rerender();
        };
      });
      var pType = body.querySelector('#cn_ptype');
      if (pType) pType.onchange = function () {
        if (uiPicker) uiPicker.type = pType.value;
        rerender();
      };
      body.querySelectorAll('[data-pick]').forEach(function (b) {
        b.onclick = function () {
          if (!uiPicker) return;
          var items = contentItems(uiPicker.type);
          var item = items[+b.getAttribute('data-pick')];
          var c = conns()[uiPicker.conn];
          if (item && c && queueShare(uiPicker.conn, uiPicker.type, item)) {
            uiFlash = (TYPE_LABEL[uiPicker.type] || 'Share') + ' queued for ' + c.name + ' — it waits in History below.';
          }
          uiPicker = null;
          rerender();
        };
      });
      var pCancel = body.querySelector('#cn_pcancel');
      if (pCancel) pCancel.onclick = function () { uiPicker = null; rerender(); };

      body.querySelectorAll('[data-obdel]').forEach(function (a) {
        a.onclick = function (e) {
          e.preventDefault();
          var o = outbox(); o.splice(+a.getAttribute('data-obdel'), 1); W('outbox', o);
          rerender();
        };
      });
    }
  };
})();
