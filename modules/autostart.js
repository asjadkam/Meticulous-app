/* Auto-start module — tracker auto-start settings, also reachable from the
   sidebar menu (Asjad, Oct 13: "should not be buried in preferences, put it
   in the menu"). The settings card HTML is shared with Preferences so both
   places always look and behave the same. */
(function () {
  'use strict';
  var esc = function (s) { return App._esc(s); };
  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function getOnboarding() { return App._store.get('onboarding', {}); }

  /* Shared settings card. `prefix` namespaces the element ids so the
     Preferences copy (prefix 'pf') and this module (prefix 'as') can coexist. */
  function settingsHTML(prefix) {
    var o = getOnboarding();
    var sel = Array.isArray(o.autoStartDays) ? o.autoStartDays : [1, 2, 3, 4, 5];
    return '<div class="card"><h3>⏰ Tracker auto-start</h3>' +
      '<label class="chk"><input type="checkbox" id="' + prefix + '_autostart"' + (o.autoStart ? ' checked' : '') + '> Start the tracker by itself</label>' +
      '<label class="f">Start time</label><input id="' + prefix + '_autotime" type="time" value="' + esc(o.autoStartTime || '06:00') + '">' +
      '<label class="f">Days</label><div id="' + prefix + '_autodays">' +
      DAY_NAMES.map(function (n, i) {
        return '<label class="daypill"><input type="checkbox" data-day="' + i + '"' + (sel.indexOf(i) !== -1 ? ' checked' : '') + '> ' + n + '</label>';
      }).join('') + '</div>' +
      '<p class="note">Time-based only — no location tracking. If the app is open it starts by itself at this time; if it was closed, you\'ll be asked when you open it.</p></div>';
  }

  /* Shared save: reads the inputs under `body`, persists to the onboarding
     store (which cloud-syncs), then nudges the auto-start checker. */
  function saveFrom(prefix, body) {
    var q = function (s) { return body.querySelector(s); };
    var o = getOnboarding();
    o.autoStart = q('#' + prefix + '_autostart').checked;
    o.autoStartTime = q('#' + prefix + '_autotime').value || '06:00';
    o.autoStartDays = Array.prototype.map.call(
      body.querySelectorAll('#' + prefix + '_autodays input[data-day]:checked'),
      function (c) { return +c.getAttribute('data-day'); }
    );
    App._store.set('onboarding', o);
    try { if (App.checkAutoStart) App.checkAutoStart(); } catch (e) {}
  }

  Meticulous.modules.autostart = {
    settingsHTML: settingsHTML,
    saveFrom: saveFrom,
    render: function (body) {
      body.innerHTML = settingsHTML('as') +
        '<button class="btn primary" id="as_save">Save auto-start</button>';
      body.querySelector('#as_save').onclick = function () {
        saveFrom('as', body);
        alert('Auto-start saved.');
      };
    },
    status: function () {
      var o = getOnboarding();
      if (!o.autoStart) return 'Off';
      return 'On — ' + (o.autoStartTime || '06:00');
    }
  };
})();
