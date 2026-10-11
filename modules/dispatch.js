/* Meticulous — Dispatch module (standalone, complete)
   Active dispatch card (job site, material, ticket #, status), manual entry,
   ticket image upload with preview + downscaled storage, history list,
   "Complete dispatch" logs earnings to the Revenue module.
   Persists via App._store (localStorage, mt_ prefix). Firebase via FB.saveDoc.
*/
(function () {
  'use strict';
  window.Meticulous = window.Meticulous || {};
  Meticulous.modules = Meticulous.modules || {};

  var S = function (k, d) { return App._store.get('dsp_' + k, d); };
  var W = function (k, v) { App._store.set('dsp_' + k, v); };
  var esc = function (s) { return App._esc(s); };

  function list() { return S('list', []); }       // saved / history
  function active() { return S('active', null); } // current active dispatch
  function uid() { return 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  function fbSave(doc) {
    if (window.FB && FB.saveDoc) { try { FB.saveDoc('dispatches', doc.id, doc); } catch (e) {} }
  }
  function manifestFeedPush(kind, summaryText) {
    try {
      var feed = App._store.get('manifest_feed', []);
      feed.push({ ts: Date.now(), date: App._today(), kind: kind, summary: summaryText });
      App._store.set('manifest_feed', feed.slice(-500));
    } catch (e) {}
  }
  function fmtTime(ts) {
    try { return new Date(ts).toLocaleString('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return ''; }
  }

  /* Downscale a photo so it fits localStorage: max 640px, JPEG 0.7. */
  function fileToThumb(file, cb) {
    var r = new FileReader();
    r.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 640, w = img.width, h = img.height;
        if (w > max || h > max) {
          var s = Math.min(max / w, max / h);
          w = Math.round(w * s); h = Math.round(h * s);
        }
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(c.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = function () { cb(r.result); };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  }

  var api = {
    status: function () {
      var a = active();
      if (a) return 'Active: ' + (a.jobSite || a.pickup || 'dispatch');
      var done = list().filter(function (d) { return d.status === 'completed'; }).length;
      return done ? done + ' completed' : list().length + ' saved';
    },
    getActive: function () { return active(); },
    render: function (body) {
      var a = active();
      var h = '';

      /* ---- Active dispatch card ---- */
      if (a) {
        h += '<div class="card" style="border:2px solid var(--orange)"><h3>🚛 Active dispatch</h3>' +
          '<div class="kv"><span>Status</span><b style="color:var(--orange)">● In progress</b></div>' +
          '<div class="kv"><span>Job site</span><b>' + esc(a.jobSite || a.pickup || '—') + '</b></div>' +
          (a.dropoff ? '<div class="kv"><span>Drop-off</span><b>' + esc(a.dropoff) + '</b></div>' : '') +
          (a.material ? '<div class="kv"><span>Material</span><b>' + esc(a.material) + '</b></div>' : '') +
          (a.ticketNo ? '<div class="kv"><span>Ticket #</span><b>' + esc(a.ticketNo) + '</b></div>' : '') +
          (a.amount ? '<div class="kv"><span>Amount</span><b>$' + esc(a.amount) + '</b></div>' : '') +
          '<div class="kv"><span>Started</span><b>' + esc(fmtTime(a.startedAt)) + '</b></div>' +
          (a.photo ? '<img src="' + a.photo + '" style="width:100%;border-radius:10px;margin-top:8px" alt="Ticket photo">' : '') +
          '<div class="row" style="margin-top:10px">' +
          '<button class="btn primary" id="dp_complete">✅ Complete dispatch</button>' +
          '<button class="btn ghost" id="dp_cancel">Cancel</button></div></div>';
      }

      /* ---- New dispatch form ---- */
      h += '<div class="card"><h3>＋ New dispatch</h3>' +
        '<label class="f">Job site</label><input id="dp_site" placeholder="e.g. Aecon — Deerfoot site">' +
        '<div class="row"><div><label class="f">Material</label><input id="dp_mat" placeholder="e.g. Gravel"></div>' +
        '<div><label class="f">Ticket #</label><input id="dp_ticket" placeholder="e.g. 48213"></div></div>' +
        '<div class="row"><div><label class="f">Amount $ (optional)</label><input id="dp_amt" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"></div>' +
        '<div><label class="f">Loads</label><input id="dp_loads" type="number" min="1" step="1" value="1"></div></div>' +
        '<label class="f">Notes</label><input id="dp_notes" placeholder="Gate code, contact…">' +
        '<label class="f">Ticket photo</label><input type="file" id="dp_img" accept="image/*" capture="environment">' +
        '<div id="dp_preview"></div>' +
        '<div class="row" style="margin-top:10px"><button class="btn primary" id="dp_add">Save dispatch</button>' +
        '<button class="btn navy" id="dp_addstart">Save & start</button></div></div>';

      /* ---- History ---- */
      var hist = list().slice().reverse();
      h += '<div class="card"><h3>📋 History</h3>' +
        (hist.length ? hist.map(function (d, ri) {
          var i = list().length - 1 - ri;
          var st = d.status === 'completed' ? '<span class="pill">completed</span>' :
                   d.status === 'cancelled' ? '<span class="pill">cancelled</span>' : '<span class="pill">saved</span>';
          return '<div class="listitem"><div class="a">' + esc(d.jobSite || d.pickup || 'Dispatch') + ' ' + st + '</div>' +
            '<div class="b">' + esc(d.date || '') +
            (d.material ? ' · ' + esc(d.material) : '') +
            (d.ticketNo ? ' · #' + esc(d.ticketNo) : '') +
            (d.amount ? ' · $' + esc(d.amount) : '') + '</div>' +
            (d.photo ? '<img src="' + d.photo + '" style="width:100%;border-radius:8px;margin-top:6px" alt="Ticket">' : '') +
            '<div class="row" style="margin-top:8px">' +
            (d.status === 'saved' ? '<button class="btn small primary" data-start="' + i + '">Start</button>' : '') +
            '<button class="btn small ghost" data-del="' + i + '">Delete</button></div></div>';
        }).join('') : '<div class="empty">No dispatches yet. Create one above.</div>') + '</div>';

      body.innerHTML = h;

      var pendingPhoto = null;
      var imgInput = body.querySelector('#dp_img');
      imgInput.onchange = function (ev) {
        var f = ev.target.files[0]; if (!f) return;
        fileToThumb(f, function (dataUrl) {
          pendingPhoto = dataUrl;
          body.querySelector('#dp_preview').innerHTML =
            '<img src="' + dataUrl + '" style="width:100%;border-radius:10px;margin-top:10px" alt="Ticket preview">' +
            '<p class="note">Photo attached. It will be saved with the dispatch.</p>';
        });
      };

      function readForm() {
        return {
          id: uid(),
          jobSite: body.querySelector('#dp_site').value.trim(),
          material: body.querySelector('#dp_mat').value.trim(),
          ticketNo: body.querySelector('#dp_ticket').value.trim(),
          amount: body.querySelector('#dp_amt').value.trim(),
          loads: body.querySelector('#dp_loads').value.trim() || '1',
          notes: body.querySelector('#dp_notes').value.trim(),
          photo: pendingPhoto,
          date: App._today(),
          status: 'saved'
        };
      }
      function pushDispatch(d) {
        var l = list(); l.push(d); W('list', l); fbSave(d); return d;
      }

      body.querySelector('#dp_add').onclick = function () {
        var d = readForm();
        if (!d.jobSite) { alert('Enter the job site.'); return; }
        pushDispatch(d);
        manifestFeedPush('dispatch', 'Dispatch saved: ' + d.jobSite + (d.ticketNo ? ' · ticket #' + d.ticketNo : ''));
        api.render(body);
      };
      body.querySelector('#dp_addstart').onclick = function () {
        var d = readForm();
        if (!d.jobSite) { alert('Enter the job site.'); return; }
        d.status = 'active'; d.startedAt = Date.now();
        pushDispatch(d); W('active', d);
        manifestFeedPush('dispatch', 'Dispatch started: ' + d.jobSite + (d.ticketNo ? ' · ticket #' + d.ticketNo : ''));
        if (window.FB && FB.localNotify) { try { FB.localNotify('Dispatch started', d.jobSite); } catch (e) {} }
        api.render(body);
      };

      var doneBtn = body.querySelector('#dp_complete');
      if (doneBtn) doneBtn.onclick = function () {
        var cur = active(); if (!cur) return;
        cur.status = 'completed'; cur.endedAt = Date.now();
        var l = list();
        for (var i = 0; i < l.length; i++) if (l[i].id === cur.id) { l[i] = cur; break; }
        W('list', l); W('active', null); fbSave(cur);
        /* One confirmation updates Revenue: log the dispatch earnings. */
        var amt = parseFloat(cur.amount);
        if (amt > 0 && Meticulous.modules.revenue && Meticulous.modules.revenue.addEntry) {
          Meticulous.modules.revenue.addEntry({
            date: App._today(),
            amount: amt.toFixed(2),
            type: 'load',
            loads: cur.loads || 1,
            note: 'Dispatch: ' + (cur.jobSite || '') + (cur.ticketNo ? ' · ticket #' + cur.ticketNo : '')
          });
        }
        manifestFeedPush('dispatch', 'Dispatch completed: ' + (cur.jobSite || '') +
          (cur.ticketNo ? ' · ticket #' + cur.ticketNo : '') + (amt > 0 ? ' · $' + amt.toFixed(2) : ''));
        alert(amt > 0 ? 'Dispatch completed — $' + amt.toFixed(2) + ' logged to Revenue.' : 'Dispatch completed.');
        api.render(body);
      };
      var cancelBtn = body.querySelector('#dp_cancel');
      if (cancelBtn) cancelBtn.onclick = function () {
        if (!confirm('Cancel the active dispatch?')) return;
        var cur = active();
        if (cur) {
          cur.status = 'cancelled';
          var l = list();
          for (var i = 0; i < l.length; i++) if (l[i].id === cur.id) { l[i] = cur; break; }
          W('list', l); fbSave(cur);
        }
        W('active', null); api.render(body);
      };

      body.querySelectorAll('[data-start]').forEach(function (b) {
        b.onclick = function () {
          var d = list()[+b.getAttribute('data-start')];
          d.status = 'active'; d.startedAt = Date.now();
          var l = list(); l[+b.getAttribute('data-start')] = d;
          W('list', l); W('active', d); fbSave(d);
          if (window.FB && FB.localNotify) { try { FB.localNotify('Dispatch started', d.jobSite || ''); } catch (e) {} }
          api.render(body);
        };
      });
      body.querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = function () {
          if (!confirm('Delete this dispatch?')) return;
          var l = list(); l.splice(+b.getAttribute('data-del'), 1); W('list', l); api.render(body);
        };
      });
    }
  };

  Meticulous.modules.dispatch = api;
})();
