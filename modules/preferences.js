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
        '<label class="f">Rate ($)</label><input id="pf_rate" type="number" inputmode="decimal" value="' + esc(o.payRate || '') + '"></div>';

      h += '<div class="card"><h3>📍 Base location</h3>' +
        '<label class="f">Where do you park your truck?</label><input id="pf_base" value="' + esc(o.baseLocation || '') + '"></div>';

      h += '<div class="card"><h3>🏢 Company</h3>' +
        '<label class="f">Company name</label><input id="pf_cname" value="' + esc(o.companyName || '') + '">' +
        '<label class="f">GST/HST number</label><input id="pf_gst" value="' + esc(o.gst || '') + '">' +
        '<label class="f">Business address</label><input id="pf_caddr" value="' + esc(o.companyAddr || '') + '">' +
        '<label class="f">Contracting company</label><input id="pf_cont" value="' + esc(o.contractingCo || '') + '"></div>';

      h += '<div class="card"><h3>🚛 Truck</h3>' +
        '<label class="f">Truck number</label><input id="pf_tnum" value="' + esc(o.truckNo || '') + '">' +
        '<label class="f">Load / trailer type</label><input id="pf_ttype" value="' + esc(o.truckType || '') + '"></div>';

      h += '<div class="card"><h3>🔔 Notifications</h3>' +
        '<button class="btn navy" id="pf_push">Enable push notifications</button>' +
        '<p class="note" id="pf_pushnote"></p></div>';

      h += '<button class="btn primary" id="pf_save">Save preferences</button>';
      h += '<div class="card"><h3>⚠️ Data</h3><button class="btn ghost" id="pf_wipe">Erase all local data</button></div>';

      body.innerHTML = h;
      body.querySelector('#pf_save').onclick = function () {
        var g = function (id) { return body.querySelector('#' + id).value.trim(); };
        o.accountType = g('pf_acct'); o.employment = g('pf_emp'); o.payStandard = g('pf_std');
        o.payRate = g('pf_rate'); o.baseLocation = g('pf_base'); o.companyName = g('pf_cname');
        o.gst = g('pf_gst'); o.companyAddr = g('pf_caddr'); o.contractingCo = g('pf_cont');
        o.truckNo = g('pf_tnum'); o.truckType = g('pf_ttype');
        App._store.set('onboarding', o);
        App.onAuth(App.user);
        alert('Preferences saved.');
      };
      body.querySelector('#pf_push').onclick = function () {
        if (window.FB && FB.enablePush) {
          FB.enablePush().then(function (r) {
            body.querySelector('#pf_pushnote').textContent = r.ok ? '✓ Push enabled for this device.' : 'Could not enable: ' + (r.reason || 'unknown');
          });
        } else body.querySelector('#pf_pushnote').textContent = 'Push unavailable in this browser.';
      };
      body.querySelector('#pf_wipe').onclick = function () {
        if (confirm('Erase ALL local app data? This cannot be undone.')) {
          Object.keys(localStorage).filter(function (k) { return k.indexOf('mt_') === 0; }).forEach(function (k) { localStorage.removeItem(k); });
          location.reload();
        }
      };
    }
  };
})();
