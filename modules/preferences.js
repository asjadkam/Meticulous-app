/* Preferences module — edit everything from onboarding + app settings */
(function () {
  'use strict';
  var esc = function (s) { return App._esc(s); };

  Meticulous.modules.preferences = {
    render: function (body) {
      var o = App._store.get('onboarding', {});
      var h = '<div class="card"><h3>👤 Account</h3>' +
        '<label class="f">Account type</label><select id="pf_acct">' +
        ['Driver', 'Owner-Operator', 'Fleet Manager'].map(function (x) { return '<option' + (o.accountType === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>' +
        '<label class="f">Employment</label><select id="pf_emp">' +
        ['Contract', 'Payroll'].map(function (x) { return '<option' + (o.employment === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></div>';

      /* v34: in-app password change — distinct from "Forgot password?" (the
         email reset on the sign-in screen). Signed-in users only: Firebase
         needs a current user for updatePassword, and re-authenticates with
         the current password when it demands a recent login. */
      var signedIn = !!(window.FB && FB.user);
      h += '<div class="card"><h3>🔒 Security</h3>';
      if (signedIn) {
        h += '<p class="note">Signed in as ' + esc(FB.user.email || '') + '</p>' +
          '<label class="f">Current password</label><input id="pf_pw_cur" type="password" autocomplete="current-password">' +
          '<label class="f">New password</label><input id="pf_pw_new" type="password" autocomplete="new-password">' +
          '<label class="f">Confirm new password</label><input id="pf_pw_conf" type="password" autocomplete="new-password">' +
          '<button class="btn navy" id="pf_pw_btn" style="margin-top:10px;">Change password</button>' +
          '<p class="note" id="pf_pw_note"></p>';
      } else {
        h += '<p class="note">Sign in to change your password.</p>';
      }
      h += '</div>';

      h += '<div class="card"><h3>💵 Pay</h3>' +
        '<label class="f">Payment standard</label><select id="pf_std">' +
        ['Miles', 'Hourly', 'Trip', 'Weight'].map(function (x) { return '<option' + (o.payStandard === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>' +
        '<label class="f">Rate ($)</label><input id="pf_rate" type="number" inputmode="decimal" value="' + esc(o.payRate || '') + '">' +
        '<label class="f">Travel time bonus (hours/day)</label><input id="pf_travel" type="number" inputmode="decimal" min="0" step="0.5" value="' + esc(o.travelBonus || '1') + '">' +
        '<p class="note">Fixed daily bonus added to foreman ticket hours. Asjad: 1h, some drivers: 1.5h.</p></div>';

      /* v36: tracker auto-start settings MOVED to Revenue (Asjad) — the
         tracker feeds Revenue, so its controls live there. Pointer only
         here; no duplicate controls. */
      h += '<div class="card"><h3>⏰ Tracker auto-start</h3>' +
        '<p class="note">Auto tracker settings live in <b>Revenue</b>.</p></div>';

      h += '<div class="card"><h3>📍 Base location</h3>' +
        '<label class="f">Where do you park your truck?</label><input id="pf_base" value="' + esc(o.baseLocation || '') + '">' +
        '<label class="f">Home province</label><select id="pf_prov">' +
        ['Alberta', 'British Columbia', 'Manitoba', 'New Brunswick', 'Newfoundland and Labrador',
         'Nova Scotia', 'Ontario', 'Prince Edward Island', 'Quebec', 'Saskatchewan',
         'Northwest Territories', 'Nunavut', 'Yukon'].map(function (p) {
          return '<option value="' + p + '"' + (o.homeProvince === p ? ' selected' : '') + '>' + p + '</option>';
        }).join('') +
        '<option value=""' + (!o.homeProvince ? ' selected' : '') + '>— not set —</option></select>' +
        '<p class="note">Sets the workers\u2019 comp name in P&L (WCB in Alberta, WSIB in Ontario, WorkSafeBC in BC, CNESST in Quebec\u2026) and its default rate.</p></div>';

      h += '<div class="card"><h3>🏢 Company</h3>' +
        '<label class="f">Company name</label><input id="pf_cname" value="' + esc(o.companyName || '') + '">' +
        '<label class="f">GST/HST number</label><input id="pf_gst" value="' + esc(o.gst || '') + '">' +
        '<label class="f">Business address</label><input id="pf_caddr" value="' + esc(o.companyAddr || '') + '">' +
        '<label class="f">Contracting company</label><input id="pf_cont" value="' + esc(o.contractingCo || '') + '"></div>';

      /* v31: photo retake buttons — same OCR as onboarding. Lets Asjad update
         the odometer baseline (e.g. new truck / rolled over) or the safety
         sticker (renewed) without redoing onboarding. */
      h += '<div class="card"><h3>🚛 Truck</h3>' +
        '<label class="f">Truck number</label><input id="pf_tnum" value="' + esc(o.truckNo || '') + '">' +
        '<label class="f">Load / trailer type</label><input id="pf_ttype" value="' + esc(o.truckType || '') + '">' +
        '<label class="f">Odometer baseline (km)</label>' +
        '<div style="display:flex;gap:8px;margin:6px 0;">' +
        '<button type="button" class="btn secondary" id="pf_odo_cam" style="flex:1;">📷 Retake photo</button>' +
        '<button type="button" class="btn secondary" id="pf_odo_pick" style="flex:1;">📁 Choose file</button></div>' +
        '<input type="file" id="pf_odo_cam_in" accept="image/*" capture="environment" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<input type="file" id="pf_odo_in" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<div id="pf_odo_prev"></div><div id="pf_odo_status" class="note"></div>' +
        '<input id="pf_odo" type="number" inputmode="decimal" value="' + esc(o.odometerBaseline || '') + '">' +
        '<p class="note">Starting point for oil changes and services in Maintenance.</p>' +
        '<label class="f">Safety sticker expiry</label>' +
        '<div style="display:flex;gap:8px;margin:6px 0;">' +
        '<button type="button" class="btn secondary" id="pf_safety_cam" style="flex:1;">📷 Retake photo</button>' +
        '<button type="button" class="btn secondary" id="pf_safety_pick" style="flex:1;">📁 Choose file</button></div>' +
        '<input type="file" id="pf_safety_cam_in" accept="image/*" capture="environment" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<input type="file" id="pf_safety_in" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<div id="pf_safety_prev"></div><div id="pf_safety_status" class="note"></div>' +
        '<input id="pf_safety" type="date" value="' + esc(o.safetyExpiry || '') + '">' +
        '<p class="note">We remind you 30 days before it expires.</p></div>';

      h += '<div class="card"><h3>🔔 Notifications</h3>' +
        '<button class="btn navy" id="pf_push">Enable push notifications</button>' +
        '<p class="note" id="pf_pushnote"></p></div>';

      h += '<button class="btn primary" id="pf_save">Save preferences</button>';

      h += '<div class="card"><h3>⚙️ Advanced</h3>' +
        '<button class="btn ghost" id="pf_resetonb">Reset onboarding questions</button>' +
        '<p class="note">Shows the setup questions again on next sign-in. Your saved answers stay until you finish the questions again.</p>' +
        '<button class="btn navy" id="pf_checkupd">Check for updates</button>' +
        '<p class="note" id="pf_updnote"></p></div>';
      /* v32: cloud-sync diagnostics — shows live sync state, last error, and
         a manual retry. If the top-bar dot is red/yellow, the reason is here. */
      h += '<div class="card"><h3>☁️ Cloud sync</h3>' +
        '<p class="note" id="pf_syncnote">Checking…</p>' +
        '<button class="btn navy" id="pf_syncnow">Retry sync now</button></div>';
      // v24: removed "Erase all local data" — developer tool, not for users

      body.innerHTML = h;
      body.querySelector('#pf_save').onclick = function () {
        var g = function (id) { return body.querySelector('#' + id).value.trim(); };
        o.accountType = g('pf_acct'); o.employment = g('pf_emp'); o.payStandard = g('pf_std');
        o.payRate = g('pf_rate'); o.travelBonus = g('pf_travel') || '1';
        o.baseLocation = g('pf_base'); o.homeProvince = body.querySelector('#pf_prov').value; o.companyName = g('pf_cname');
        o.gst = g('pf_gst'); o.companyAddr = g('pf_caddr'); o.contractingCo = g('pf_cont');
        o.truckNo = g('pf_tnum'); o.truckType = g('pf_ttype');
        o.odometerBaseline = g('pf_odo'); o.safetyExpiry = g('pf_safety');
        // v28: push through to Maintenance stores so PM baselines stay in sync
        try {
          if (o.odometerBaseline && parseFloat(o.odometerBaseline) > 0) App._store.set('mt_odo', String(o.odometerBaseline));
          if (o.safetyExpiry) App._store.set('mt_annualDate', o.safetyExpiry);
        } catch (e) {}
        App._store.set('onboarding', o);
        App.onAuth(App.user);
        try { if (App.checkAutoStart) App.checkAutoStart(); } catch (e) {}
        alert('Preferences saved.');
      };
      /* v31: wire the odometer/safety photo retake buttons to the same OCR
         used in onboarding. Persists immediately to the stored onboarding
         and to the Maintenance PM stores. */
      try {
        if (App._wirePhotoOCR) {
          var prefsPersistPhoto = function (kind, v) {
            try {
              var ob = App._store.get('onboarding', {}) || {};
              if (kind === 'odometer') {
                ob.odometerBaseline = v;
                if (v && parseFloat(v) > 0) App._store.set('mt_odo', String(v));
              } else {
                ob.safetyExpiry = v;
                if (v) App._store.set('mt_annualDate', v);
              }
              App._store.set('onboarding', ob);
            } catch (e) {}
          };
          App._wirePhotoOCR('pf_odo', 'odometer', prefsPersistPhoto);
          App._wirePhotoOCR('pf_safety', 'safety', prefsPersistPhoto);
        }
      } catch (e) {}
      /* v34: change-password handler (Security card, signed-in only) */
      var pwBtn = body.querySelector('#pf_pw_btn');
      if (pwBtn) pwBtn.onclick = function () {
        var note = body.querySelector('#pf_pw_note');
        // same invisible-character strip as sign-in, so the passwords agree
        var clean = function (p) { return String(p || '').replace(/[\u200B\u200C\u200D\uFEFF\u00AD\u2060]/g, ''); };
        var cur = clean(body.querySelector('#pf_pw_cur').value);
        var nw = clean(body.querySelector('#pf_pw_new').value);
        var conf = clean(body.querySelector('#pf_pw_conf').value);
        if (!cur) { note.textContent = 'Enter your current password.'; return; }
        if (!nw || nw.length < 6) { note.textContent = 'New password must be at least 6 characters.'; return; }
        if (nw !== conf) { note.textContent = 'New passwords do not match.'; return; }
        if (!window.FB || !FB.changePassword) { note.textContent = 'Password change is unavailable right now.'; return; }
        pwBtn.disabled = true; note.textContent = 'Changing…';
        function ok() {
          pwBtn.disabled = false;
          note.textContent = '✓ Password changed.';
          body.querySelector('#pf_pw_cur').value = '';
          body.querySelector('#pf_pw_new').value = '';
          body.querySelector('#pf_pw_conf').value = '';
        }
        function fail(e) {
          pwBtn.disabled = false;
          var code = (e && e.code) || '';
          note.textContent = (code === 'auth/wrong-password' || code === 'auth/invalid-credential')
            ? 'Current password is wrong.'
            : code === 'auth/weak-password' ? 'New password is too weak — use at least 6 characters.'
            : 'Could not change password: ' + ((e && e.message) || e);
        }
        FB.changePassword(nw).then(ok).catch(function (e) {
          if (e && e.code === 'auth/requires-recent-login') {
            note.textContent = 'Confirming it is you…';
            FB.reauthenticate(cur).then(function () { return FB.changePassword(nw); }).then(ok).catch(fail);
          } else fail(e);
        });
      };
      body.querySelector('#pf_push').onclick = function () {
        if (window.FB && FB.enablePush) {
          FB.enablePush().then(function (r) {
            body.querySelector('#pf_pushnote').textContent = r.ok ? '✓ Push enabled for this device.' : 'Could not enable: ' + (r.reason || 'unknown');
          });
        } else body.querySelector('#pf_pushnote').textContent = 'Push unavailable in this browser.';
      };
      /* v28: reset onboarding — shows the setup questions again on next sign-in.
         Deletes the flag locally and in the cloud (tombstone via store.del). */
      body.querySelector('#pf_resetonb').onclick = function () {
        if (!confirm('Show the setup questions again on your next sign-in? Your saved answers stay until you finish the questions again.')) return;
        try { App._store.del('onboarded'); } catch (e) {}
        alert('Done — the setup questions will show on your next sign-in.');
      };
      /* v30 OTA: manual update check. Web updates download in-app; only
         native changes need a fresh APK (announced by the banner in app.js). */
      body.querySelector('#pf_checkupd').onclick = function () {
        var note = body.querySelector('#pf_updnote');
        note.textContent = 'Checking…';
        if (!window.OTA || !OTA.checkNow) { note.textContent = 'Update check is only available in the installed app.'; return; }
        OTA.checkNow().then(function (r) {
          /* v35: a completed healthy check clears any stored OTA damage
             notice; a failure reason keeps it visible. */
          if (r.updated || !r.reason) { try { localStorage.removeItem('ota_notice'); } catch (e) {} }
          if (r.updated) {
            note.textContent = 'Update v' + r.version + ' downloaded.';
            if (confirm('Update v' + r.version + ' is ready. Restart the app now to use it?')) OTA.restart();
          } else if (r.reason) {
            note.textContent = r.reason;
          } else {
            note.textContent = 'You are up to date (web v' + r.version + ').';
          }
        });
      };
      try {
        if (window.OTA && OTA.currentVersion) OTA.currentVersion().then(function (v) {
          var n = body.querySelector('#pf_updnote');
          if (!n) return;
          /* v35: surface a stored OTA damage/repair notice (set by the
             updater's launch self-check) instead of the version line. */
          var notice = null;
          try { notice = localStorage.getItem('ota_notice'); } catch (e) {}
          if (notice) { n.textContent = '⚠️ ' + notice; return; }
          if (!n.textContent) n.textContent = 'App web version: v' + v.active + (v.inOtaCopy ? ' (updated copy)' : ' (installed copy)');
        });
      } catch (e) {}
      /* v32: cloud-sync status + manual retry */
      (function () {
        var note = body.querySelector('#pf_syncnote');
        var btn = body.querySelector('#pf_syncnow');
        if (!note || !btn) return;
        function paint() {
          try {
            if (!window.CloudSync) { note.textContent = 'Sync engine not loaded.'; return; }
            var st = CloudSync.status();
            var word = st.dot === 'ok' ? 'Backed up ✓'
              : st.dot === 'syncing' ? 'Syncing…'
              : st.dot === 'err' ? 'Error' : 'Off (not signed in)';
            var t = 'Status: ' + word;
            if (st.lastError) t += ' — ' + String(st.lastError).slice(0, 140);
            if (st.dirtyKeys && st.dirtyKeys.length) t += ' — ' + st.dirtyKeys.length + ' change(s) waiting to upload (' + st.dirtyKeys.slice(0, 5).join(', ') + (st.dirtyKeys.length > 5 ? '…' : '') + ')';
            note.textContent = t;
          } catch (e) { note.textContent = 'Could not read sync status.'; }
        }
        paint();
        btn.onclick = function () {
          note.textContent = 'Sync requested — watch the top-bar dot…';
          try { if (window.CloudSync && CloudSync.syncNow) CloudSync.syncNow(); } catch (e) {}
          setTimeout(paint, 4000);
        };
      })();
      // v24: pf_wipe handler removed (button removed above)
    }
  };
})();
