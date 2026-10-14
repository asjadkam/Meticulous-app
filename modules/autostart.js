/* Auto-start settings card — shared library.
   v36: the controls live in the REVENUE module (Asjad: the auto tracker
   was "still in preferences, not in revenue" — the tracker feeds Revenue,
   so its settings sit with the earnings it produces). Before v36 the same
   shared card was rendered by Preferences (prefix 'pf') and by a
   standalone sidebar page (prefix 'as'); both are gone — Revenue renders
   it with prefix 'rv'. This file now only provides the card HTML + save,
   plus a pointer stub if anything stale still opens the old page.
   Storage is unchanged: onboarding store, fields autoStart /
   autoStartTime / autoStartDays (cloud-synced with onboarding).
   v53: the card also carries the "Today:" line + a per-day Change
   affordance (dispatch-driven auto-start): today's dispatch time is
   the default start, a manual override for today (synced key
   autostart_override, written via App.setAutostartOverride) beats it,
   and the standing setting is the fallback. Engine + precedence live
   in js/app.js (AUTOSTART-ENGINE region). */
(function () {
  'use strict';
  var esc = function (s) { return App._esc(s); };
  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function getOnboarding() { return App._store.get('onboarding', {}); }

  function labelOf(timeStr) {
    var p = String(timeStr || '06:00').split(':');
    var h = +p[0] || 0, m = ('0' + (+p[1] || 0)).slice(-2);
    var ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12 || 12;
    return h12 + ':' + m + ' ' + ap;
  }

  /* v53: the "Today:" line + Change affordance. Reads the SAME plan the
     engine runs on (App.autostartTodayInfo in js/app.js), so the card
     can never promise what checkAutoStart won't do. The dispatch's
     scheduled time is the day's DEFAULT start; "Set for today" writes a
     per-day override (synced key autostart_override) that wins over it
     for today only — it never edits the dispatch or the saved setting,
     and Clear hands the day back to the dispatch default / setting. */
  function todayHTML(prefix) {
    var info = null;
    try { if (App.autostartTodayInfo) info = App.autostartTodayInfo(); } catch (e) {}
    if (!info) return '';
    var line;
    if (!info.enabled || !info.dayOk) {
      line = '<b>Today:</b> no auto-start scheduled';
    } else if (info.source === 'dispatch') {
      line = '<b>Today:</b> starts ' + esc(info.label) + ' (from Dispatch)';
    } else if (info.source === 'override') {
      line = '<b>Today:</b> starts ' + esc(info.label) + ' (changed for today)';
    } else {
      line = '<b>Today:</b> starts ' + esc(info.label) + ' (your setting)';
    }
    var h = '<p class="note" style="margin-top:10px">' + line + '</p>';
    if (info.enabled) {
      h += '<label class="f">Change today\'s start</label>' +
        '<div class="row"><div><input type="time" id="' + prefix + '_ovtime" value="' + esc(info.time) + '"></div>' +
        '<div><button class="btn small secondary" id="' + prefix + '_ovset">Set for today</button></div></div>';
      if (info.overrideTime) {
        var back = info.dispatchTime
          ? labelOf(info.dispatchTime) + ' (from Dispatch)'
          : labelOf(info.settingTime) + ' (your setting)';
        h += '<div class="row"><button class="btn small ghost" id="' + prefix + '_ovclear">Clear — back to ' + esc(back) + '</button></div>';
      }
      h += '<p class="note">For today only — your dispatch and your saved setting stay untouched.</p>';
    }
    return h;
  }

  /* Wire the Change/Clear buttons inside the today wrap; after a change
     the line is re-rendered in place and the engine is nudged, so what
     the card says and what will happen stay in step. */
  function wireToday(body, prefix) {
    var wrap = body.querySelector('#' + prefix + '_todaywrap');
    if (!wrap) return;
    var refresh = function () { wrap.innerHTML = todayHTML(prefix); wireToday(body, prefix); };
    var setBtn = wrap.querySelector('#' + prefix + '_ovset');
    if (setBtn) setBtn.onclick = function () {
      var inp = wrap.querySelector('#' + prefix + '_ovtime');
      if (inp && inp.value && App.setAutostartOverride) {
        App.setAutostartOverride(inp.value);
        try { if (App.checkAutoStart) App.checkAutoStart(); } catch (e) {}
        refresh();
      }
    };
    var clrBtn = wrap.querySelector('#' + prefix + '_ovclear');
    if (clrBtn) clrBtn.onclick = function () {
      if (App.clearAutostartOverride) App.clearAutostartOverride();
      try { if (App.checkAutoStart) App.checkAutoStart(); } catch (e) {}
      refresh();
    };
  }

  /* Shared settings card. `prefix` namespaces the element ids (Revenue
     uses 'rv'). */
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
      '<p class="note">Time-based only — no location tracking. If the app is open it starts by itself at this time; if it was closed, you\'ll be asked when you open it.</p>' +
      '<div id="' + prefix + '_todaywrap">' + todayHTML(prefix) + '</div></div>';
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
    todayHTML: todayHTML,
    wireToday: wireToday,
    /* v36: no longer a standalone page (sidebar item + Preferences card
       removed; controls live in Revenue). Kept as a pointer stub so a
       stale cached menu entry lands somewhere helpful, not a dead page. */
    render: function (body) {
      body.innerHTML = '<div class="card"><h3>⏰ Tracker auto-start</h3>' +
        '<p class="note">Auto tracker settings live in <b>Revenue</b> now.</p></div>';
    }
  };
})();
