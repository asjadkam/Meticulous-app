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

      h += '<div class="card"><h3>💵 Pay</h3>' +
        '<label class="f">Payment standard</label><select id="pf_std">' +
        ['Miles', 'Hourly', 'Trip', 'Weight'].map(function (x) { return '<option' + (o.payStandard === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>' +
        '<label class="f">Rate ($)</label><input id="pf_rate" type="number" inputmode="decimal" value="' + esc(o.payRate || '') + '">' +
        '<label class="f">Travel time bonus (hours/day)</label><input id="pf_travel" type="number" inputmode="decimal" min="0" step="0.5" value="' + esc(o.travelBonus || '1') + '">' +
        '<p class="note">Fixed daily bonus added to foreman ticket hours. Asjad: 1h, some drivers: 1.5h.</p></div>';

      h += '<div class="card"><h3>⏰ Tracker auto-start</h3>' +
        '<label class="chk"><input type="checkbox" id="pf_autostart"' + (o.autoStart ? ' checked' : '') + '> Start the tracker by itself</label>' +
        '<label class="f">Start time</label><input id="pf_autotime" type="time" value="' + esc(o.autoStartTime || '06:00') + '">' +
        '<label class="f">Days</label><div id="pf_autodays">' +
        (function () {
          var names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          var sel = Array.isArray(o.autoStartDays) ? o.autoStartDays : [1, 2, 3, 4, 5];
          return names.map(function (n, i) {
            return '<label class="daypill"><input type="checkbox" data-day="' + i + '"' + (sel.indexOf(i) !== -1 ? ' checked' : '') + '> ' + n + '</label>';
          }).join('');
        })() + '</div>' +
        '<p class="note">Time-based only — no location tracking. If the app is open it starts by itself at this time; if it was closed, you\'ll be asked when you open it.</p></div>';

      h += '<div class="card"><h3>📍 Base location</h3>' +
        '<label class="f">Where do you park your truck?</label><input id="pf_base" value="' + esc(o.baseLocation || '') + '"></div>';

      h += '<div class="card"><h3>🏢 Company</h3>' +
        '<label class="f">Company name</label><input id="pf_cname" value="' + esc(o.companyName || '') + '">' +
        '<label class="f">GST/HST number</label><input id="pf_gst" value="' + esc(o.gst || '') + '">' +
        '<label class="f">Business address</label><input id="pf_caddr" value="' + esc(o.companyAddr || '') + '">' +
        '<label class="f">Contracting company</label><input id="pf_cont" value="' + esc(o.contractingCo || '') + '"></div>';

      h += '<div class="card"><h3>🚛 Truck</h3>' +
        '<label class="f">Truck number</label><input id="pf_tnum" value="' + esc(o.truckNo || '') + '">' +
        '<label class="f">Load / trailer type</label><input id="pf_ttype" value="' + esc(o.truckType || '') + '">' +
        '<label class="f">Odometer baseline (km)</label><input id="pf_odo" type="number" inputmode="decimal" value="' + esc(o.odometerBaseline || '') + '">' +
        '<p class="note">Starting point for oil changes and services in Maintenance.</p>' +
        '<label class="f">Safety sticker expiry</label><input id="pf_safety" type="date" value="' + esc(o.safetyExpiry || '') + '">' +
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
      // v24: removed "Erase all local data" — developer tool, not for users

      body.innerHTML = h;
      body.querySelector('#pf_save').onclick = function () {
        var g = function (id) { return body.querySelector('#' + id).value.trim(); };
        o.accountType = g('pf_acct'); o.employment = g('pf_emp'); o.payStandard = g('pf_std');
        o.payRate = g('pf_rate'); o.travelBonus = g('pf_travel') || '1';
        o.baseLocation = g('pf_base'); o.companyName = g('pf_cname');
        o.gst = g('pf_gst'); o.companyAddr = g('pf_caddr'); o.contractingCo = g('pf_cont');
        o.truckNo = g('pf_tnum'); o.truckType = g('pf_ttype');
        o.odometerBaseline = g('pf_odo'); o.safetyExpiry = g('pf_safety');
        // v28: push through to Maintenance stores so PM baselines stay in sync
        try {
          if (o.odometerBaseline && parseFloat(o.odometerBaseline) > 0) App._store.set('mt_odo', String(o.odometerBaseline));
          if (o.safetyExpiry) App._store.set('mt_annualDate', o.safetyExpiry);
        } catch (e) {}
        o.autoStart = body.querySelector('#pf_autostart').checked;
        o.autoStartTime = body.querySelector('#pf_autotime').value || '06:00';
        o.autoStartDays = Array.prototype.map.call(
          body.querySelectorAll('#pf_autodays input[data-day]:checked'),
          function (c) { return +c.getAttribute('data-day'); }
        );
        App._store.set('onboarding', o);
        App.onAuth(App.user);
        try { if (App.checkAutoStart) App.checkAutoStart(); } catch (e) {}
        alert('Preferences saved.');
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
          if (n && !n.textContent) n.textContent = 'App web version: v' + v.active + (v.inOtaCopy ? ' (updated copy)' : ' (installed copy)');
        });
      } catch (e) {}
      // v24: pf_wipe handler removed (button removed above)
    }
  };
})();
