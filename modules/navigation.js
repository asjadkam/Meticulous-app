/* Meticulous — Navigation module (standalone, complete)
   Tabs: Work favorites (logged to Manifest) vs Personal (never logged).
   Favorites have name, address, type (pit / job site / dump site).
   Route cards offer Google Maps, Waze, CoPilot Truck GPS, Apple Maps.
   Recent destinations list. Work visits feed the Manifest; personal never does.
   Persists via App._store (localStorage, mt_ prefix).
*/
(function () {
  'use strict';
  window.Meticulous = window.Meticulous || {};
  Meticulous.modules = Meticulous.modules || {};

  var S = function (k, d) { return App._store.get('nav_' + k, d); };
  var W = function (k, v) { App._store.set('nav_' + k, v); };
  var esc = function (s) { return App._esc(s); };

  var TYPE_OPTS = ['pit', 'job site', 'dump site'];
  var TYPE_ICON = { 'pit': '⛏️', 'job site': '🏗️', 'dump site': '🚧' };
  var tab = 'work'; // active tab: 'work' | 'personal'

  function data() {
    return S('data', { work: [], personal: [], recent: [] });
  }
  function saveData(d) { W('data', d); }
  function uid() { return 'n' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  function manifestFeedPush(kind, summaryText) {
    try {
      var feed = App._store.get('manifest_feed', []);
      feed.push({ ts: Date.now(), date: App._today(), kind: kind, summary: summaryText });
      App._store.set('manifest_feed', feed.slice(-500));
    } catch (e) {}
  }

  /* External navigation URLs for each supported app. */
  function navUrl(app, query) {
    var e = encodeURIComponent(query);
    if (app === 'waze') return 'https://waze.com/ul?q=' + e + '&navigate=yes';
    if (app === 'apple') return 'https://maps.apple.com/?daddr=' + e;
    if (app === 'copilot') return 'geo:0,0?q=' + e; // Android: opens app chooser incl. CoPilot
    return 'https://www.google.com/maps/dir/?api=1&destination=' + e;
  }
  var APP_LABEL = { google: 'Google Maps', waze: 'Waze', copilot: 'CoPilot', apple: 'Apple Maps' };

  function fmtWhen(ts) {
    try {
      var d = new Date(ts), now = new Date();
      var sameDay = d.toDateString() === now.toDateString();
      var t = d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
      return sameDay ? 'Today ' + t : d.toLocaleDateString('en', { month: 'short', day: 'numeric' }) + ' ' + t;
    } catch (e) { return ''; }
  }

  /* Record a navigation. Work visits are logged to Manifest; personal never. */
  function recordNav(fav, kind) {
    var d = data();
    d.recent.unshift({ id: uid(), name: fav.name, address: fav.address || '', kind: kind, ts: Date.now() });
    d.recent = d.recent.slice(0, 20);
    if (kind === 'work') {
      for (var i = 0; i < d.work.length; i++) {
        if (d.work[i].id === fav.id) {
          d.work[i].visits = (d.work[i].visits || 0) + 1;
          d.work[i].lastVisit = Date.now();
          break;
        }
      }
      manifestFeedPush('navigation', 'Navigated to work site: ' + fav.name + (fav.address ? ' — ' + fav.address : ''));
    }
    saveData(d);
  }

  function openNav(app, fav, kind) {
    recordNav(fav, kind);
    var q = fav.address ? fav.name + ', ' + fav.address : fav.name;
    window.open(navUrl(app, q), '_blank', 'noopener');
  }

  function navButtons(fav, kind) {
    return '<div class="row">' +
      ['google', 'waze', 'copilot', 'apple'].map(function (a) {
        return '<button class="btn small ' + (a === 'google' ? 'navy' : 'ghost') + '" data-navapp="' + a +
          '" data-navid="' + esc(fav.id) + '" data-navkind="' + kind + '">' + APP_LABEL[a] + '</button>';
      }).join('') + '</div>';
  }

  var api = {
    status: function () {
      var d = data();
      return d.work.length ? d.work.length + ' work places' : 'No favorites yet';
    },
    render: function (body) {
      var d = data();
      var defApp = S('defApp', 'google');

      var h = '<div class="card"><div class="row">' +
        '<button class="btn small ' + (tab === 'work' ? 'primary' : 'ghost') + '" data-tab="work" style="flex:1">⭐ Work</button>' +
        '<button class="btn small ' + (tab === 'personal' ? 'primary' : 'ghost') + '" data-tab="personal" style="flex:1">🏠 Personal</button>' +
        '</div>' +
        (tab === 'work'
          ? '<p class="note">Work favorites are logged to your Manifest automatically.</p>'
          : '<p class="note">Personal places are <b>never</b> logged anywhere.</p>') +
        '</div>';

      /* ---- Add favorite form ---- */
      h += '<div class="card"><h3>＋ Add ' + (tab === 'work' ? 'work favorite' : 'personal place') + '</h3>' +
        '<label class="f">Name</label><input id="nv_name" placeholder="' + (tab === 'work' ? 'e.g. Burnco Shepard pit' : 'e.g. Walmart Deerfoot') + '">' +
        '<label class="f">Address</label><input id="nv_addr" placeholder="Street address or area">';
      if (tab === 'work') {
        h += '<label class="f">Type</label><select id="nv_type">' +
          TYPE_OPTS.map(function (t) { return '<option value="' + t + '">' + (TYPE_ICON[t] || '') + ' ' + t + '</option>'; }).join('') + '</select>';
      }
      h += '<button class="btn primary" id="nv_add" style="margin-top:10px">Add</button></div>';

      /* ---- Favorite cards ---- */
      var items = tab === 'work' ? d.work : d.personal;
      h += '<div class="card"><h3>' + (tab === 'work' ? '⭐ Work favorites' : '🏠 Personal places') + '</h3>';
      if (!items.length) {
        h += '<div class="empty">' + (tab === 'work' ? 'No work places yet. Add your pits and job sites above.' : 'No personal places yet.') + '</div>';
      }
      items.forEach(function (f) {
        h += '<div class="listitem"><div class="a">' +
          (tab === 'work' ? (TYPE_ICON[f.type] || '📍') + ' ' : '📍 ') + esc(f.name) +
          (tab === 'work' ? ' <span class="pill">' + esc(f.type || 'site') + '</span>' : '') +
          '</div>' +
          (f.address ? '<div class="b">' + esc(f.address) + '</div>' : '') +
          (tab === 'work' && f.visits ? '<div class="b">' + f.visits + ' visits' + (f.lastVisit ? ' · last ' + fmtWhen(f.lastVisit) : '') + '</div>' : '') +
          '<div style="margin-top:8px">' + navButtons(f, tab) + '</div>' +
          '<div class="row" style="margin-top:6px"><button class="btn small ghost" data-del="' + esc(f.id) + '">Remove</button></div></div>';
      });
      h += '</div>';

      /* ---- Recent destinations ---- */
      h += '<div class="card"><h3>🕘 Recent destinations</h3>';
      if (!d.recent.length) {
        h += '<div class="empty">Nothing yet. Navigate somewhere and it will show here.</div>';
      } else {
        h += d.recent.slice(0, 10).map(function (r) {
          return '<div class="listitem"><div class="a">' + esc(r.name) +
            ' <span class="pill">' + (r.kind === 'work' ? 'work' : 'personal') + '</span></div>' +
            (r.address ? '<div class="b">' + esc(r.address) + '</div>' : '') +
            '<div class="b">' + fmtWhen(r.ts) + '</div>' +
            '<div class="row" style="margin-top:6px"><button class="btn small navy" data-rgo="' + esc(r.id) + '">Go again</button></div></div>';
        }).join('');
      }
      h += '</div>';

      body.innerHTML = h;

      /* ---- Wire events ---- */
      body.querySelectorAll('[data-tab]').forEach(function (b) {
        b.onclick = function () { tab = b.getAttribute('data-tab'); api.render(body); };
      });

      body.querySelector('#nv_add').onclick = function () {
        var name = body.querySelector('#nv_name').value.trim();
        var addr = body.querySelector('#nv_addr').value.trim();
        if (!name) { alert('Enter a name for this place.'); return; }
        var dd = data();
        var fav = { id: uid(), name: name, address: addr };
        if (tab === 'work') {
          fav.type = body.querySelector('#nv_type').value;
          fav.visits = 0;
          dd.work.push(fav);
        } else {
          dd.personal.push(fav);
        }
        saveData(dd);
        api.render(body);
      };

      function findFav(id, kind) {
        var dd = data();
        var arr = kind === 'work' ? dd.work : dd.personal;
        for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
        return null;
      }
      body.querySelectorAll('[data-navapp]').forEach(function (b) {
        b.onclick = function () {
          var fav = findFav(b.getAttribute('data-navid'), b.getAttribute('data-navkind'));
          if (fav) openNav(b.getAttribute('data-navapp'), fav, b.getAttribute('data-navkind'));
        };
      });
      body.querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = function () {
          if (!confirm('Remove this place?')) return;
          var dd = data(), id = b.getAttribute('data-del');
          if (tab === 'work') dd.work = dd.work.filter(function (f) { return f.id !== id; });
          else dd.personal = dd.personal.filter(function (f) { return f.id !== id; });
          saveData(dd); api.render(body);
        };
      });
      body.querySelectorAll('[data-rgo]').forEach(function (b) {
        b.onclick = function () {
          var dd = data(), id = b.getAttribute('data-rgo'), r = null;
          for (var i = 0; i < dd.recent.length; i++) if (dd.recent[i].id === id) { r = dd.recent[i]; break; }
          if (!r) return;
          /* Re-navigate: reuses favorite record if it still exists so visits keep counting. */
          var fav = findFav(id, r.kind) || { id: r.id, name: r.name, address: r.address };
          openNav(defApp, fav, r.kind);
          api.render(body);
        };
      });
    }
  };

  Meticulous.modules.navigation = api;
})();
