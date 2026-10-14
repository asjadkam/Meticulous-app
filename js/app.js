/* Meticulous standalone — core app */
(function () {
  'use strict';

  window.Meticulous = window.Meticulous || {};
  Meticulous.modules = Meticulous.modules || {};

  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem('mt_' + k); return v === null || v === undefined ? d : JSON.parse(v); }
      catch (e) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem('mt_' + k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem('mt_' + k); } catch (e) {} }
  };

  var TIERS = { none: -1, basic: 0, pro: 1, premium: 2 };
  var TIER_NAMES = { basic: 'Basic', pro: 'Pro', premium: 'Premium' };

  var App = {
    user: null,
    userTier: 'basic',
    trialDaysLeft: null,
    tracker: { status: 'idle', startTs: 0, elapsed: 0 },
    onbStep: 0,
    onb: {}
  };
  window.App = App;

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function fmtClock(sec) {
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2);
  }

  /* ---------------- views ---------------- */
  App.showView = function (name) {
    App.currentView = name; // v18: track for Android back button
    // v23: hide via inline none, but CLEAR inline on show so CSS controls layout
    // (forcing display:block broke #auth's flex centering)
    ['onboarding', 'auth', 'main'].forEach(function (v) {
      var vEl = document.getElementById(v);
      if (vEl) {
        vEl.classList.remove('active');
        vEl.style.display = 'none';
      }
    });
    var target = document.getElementById(name);
    if (target) {
      target.classList.add('active');
      target.style.display = ''; // let CSS decide (flex for auth, block for others)
    }
    var fab = document.getElementById('fbFab');
    if (fab) fab.classList.toggle('hidden', name !== 'main');
    // v22: scroll to top on view change so stacked content can't linger
    try { window.scrollTo(0, 0); } catch (e) {}
  };

  /* v18: Android back button (Capacitor native app). Without this, the system
     back button either does nothing or kills the app. */
  (function () {
    try {
      var Cap = window.Capacitor;
      if (!Cap || !Cap.Plugins || !Cap.Plugins.App) return;
      Cap.Plugins.App.addListener('backButton', function () {
        var v = App.currentView || 'auth';
        if (v === 'onboarding' && App.onbStep > 0) {
          App.onbStep--;
          try { renderOnbStep(); } catch (e) {}
        } else if (v === 'onboarding') {
          // v25: back from onboarding goes to auth (not main) — don't strand user
          try { App.showView('auth'); } catch (e) {}
        } else if (v === 'main') {
          // v25: back from main EXITS the app — never bounce to login screen
          try { Cap.Plugins.App.exitApp(); } catch (e) {}
        } else {
          try { Cap.Plugins.App.exitApp(); } catch (e) {}
        }
      });
    } catch (e) {}
  })();

  /* v19/v30: native-APK update banner. Web changes arrive via OTA (js/ota.js)
     and never need a reinstall; this banner is ONLY for native changes
     (new plugins, permissions, Capacitor upgrades). The site owner publishes
     the new APK and sets version.json:apkUrl. Bump APK_VERSION with each
     native release. */
  (function () {
    try {
      if (!window.Capacitor) return;
      var APK_VERSION = 30; // <- bump on every native (APK) release
      fetch('https://meticulous-dd570.web.app/version.json', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (info) {
          if (info && info.version > APK_VERSION && info.apkUrl) {
            var bar = document.createElement('div');
            var link = document.createElement('a');
            link.href = info.apkUrl;
            link.textContent = 'Tap to download v' + info.version;
            link.style.cssText = 'color:#fff;font-weight:bold;text-decoration:underline;';
            bar.appendChild(document.createTextNode('Update available — '));
            bar.appendChild(link);
            bar.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#F26522;color:#fff;text-align:center;padding:12px;z-index:99999;font-size:14px;';
            document.body.appendChild(bar);
          }
        })
        .catch(function () {});
    } catch (e) {}
  })();

  App.onAuth = function (user) {
    App.user = user;
    var em = user ? user.email : store.get('localEmail', null);
    el('sbEmail').textContent = em || 'Local mode';
    var nm = store.get('onboarding', {}).accountType || 'Driver';
    el('sbName').textContent = nm + (user ? '' : ' (offline)');
    syncTrial();
    buildSidebar();
    buildDashboard();
    try { if (window.CloudSync) CloudSync.onAuth(user); } catch (e) {} // v27: cloud sync
  };

  /* ---------------- trial & tiers ---------------- */
  var BETA_MODE = true; // beta testing: no paywall, full access for everyone
  function syncTrial() {
    if (BETA_MODE) {
      App.userTier = 'premium';
      App.trialDaysLeft = 999;
      var bbar = el('trialBar');
      bbar.classList.remove('hidden');
      bbar.innerHTML = '🧪 <b>Beta testing</b> — full access, no paywall yet.';
      return;
    }
    var start = store.get('trialStart', 0);
    if (!start) { start = Date.now(); store.set('trialStart', start); }
    var days = Math.max(0, 7 - Math.floor((Date.now() - start) / 86400000));
    App.trialDaysLeft = days;
    var sub = store.get('subscription', null);
    if (days > 0) {
      App.userTier = 'premium'; // trial unlocks everything
      var bar = el('trialBar');
      bar.classList.remove('hidden');
      bar.innerHTML = '🎉 <b>' + days + ' day' + (days === 1 ? '' : 's') + ' left</b> in your free trial — full access.';
    } else if (sub && sub.tier) {
      App.userTier = sub.tier;
      el('trialBar').classList.add('hidden');
    } else {
      App.userTier = 'none';
      var bar2 = el('trialBar');
      bar2.classList.remove('hidden');
      bar2.innerHTML = '⏰ Trial ended. <b><a href="#" id="trialUpgrade" style="color:#7a5c00">Choose a plan</a></b> to keep using Meticulous.';
      var u = el('trialUpgrade');
      if (u) u.onclick = function (e) { e.preventDefault(); App.openModule('subscription'); };
    }
  }

  App.tierAllows = function (need) {
    if (BETA_MODE) return true;
    return TIERS[App.userTier] >= TIERS[need];
  };

  /* ---------------- module registry / dashboard ---------------- */
  var MODULE_ORDER = ['revenue', 'dispatch', 'navigation', 'fuel', 'pnl', 'maintenance', 'damage', 'manifest', 'invoice', 'connect'];
  var MODULE_META = {
    revenue:    { title: 'Revenue',           icon: '📊', tier: 'basic' },
    dispatch:   { title: 'Dispatch',          icon: '📋', tier: 'basic' },
    navigation: { title: 'Navigation',        icon: '🗺️', tier: 'basic' },
    fuel:       { title: 'Fuel & Expense',    icon: '⛽', tier: 'basic' },
    pnl:        { title: 'P&L',               icon: '📈', tier: 'basic' },
    maintenance:{ title: 'Maintenance',       icon: '🔧', tier: 'basic' },
    damage:     { title: 'Damage & Incident', icon: '📸', tier: 'basic' },
    manifest:   { title: 'Manifest / Daily Log', icon: '📝', tier: 'pro' },
    invoice:    { title: 'Invoice',           icon: '🧾', tier: 'pro' },
    connect:    { title: 'Connect',           icon: '🤝', tier: 'premium' }
    // v36: 'autostart' registry entry removed — settings moved into Revenue (Asjad); modules/autostart.js is now a shared card library + pointer stub
  };

  /* P&L gate REMOVED (Asjad, Oct 13): He is a Driver but needs access to everything. */
  function pnlAllowed() {
    return true;
  }

  /* Maintenance gate REMOVED (Asjad, Oct 13): He is a Driver but needs access to everything. */
  function maintAllowed() {
    return true;
  }

  function modStatus(key) {
    try {
      var m = Meticulous.modules[key];
      if (m && m.status) return m.status();
    } catch (e) {}
    return '';
  }

  function buildDashboard() {
    var g = el('modGrid');
    var html = '';
    MODULE_ORDER.forEach(function (key) {
      if (key === 'pnl' && !pnlAllowed()) return; // gate removed — everyone sees P&L
      if (key === 'maintenance' && !maintAllowed()) return; // gate removed — everyone sees Maintenance
      var meta = MODULE_META[key];
      var ok = App.tierAllows(meta.tier);
      html += '<div class="modcard' + (ok ? '' : ' locked') + '" data-mod="' + key + '">' +
        (ok ? '' : '<span class="lock">🔒</span>') +
        '<div class="ic">' + meta.icon + '</div><div class="t">' + meta.title + '</div>' +
        '<div class="s">' + esc(modStatus(key)) + '</div></div>';
    });
    g.innerHTML = html;
    Array.prototype.forEach.call(g.querySelectorAll('.modcard'), function (c) {
      c.onclick = function () { App.openModule(c.getAttribute('data-mod')); };
    });
  }

  var SIDEBAR_ITEMS = [
    ['dashboard', '🏠', 'Dashboard'],
    ['revenue', '📊', 'Revenue'],
    ['dispatch', '📋', 'Dispatch'],
    ['navigation', '🗺️', 'Navigation'],
    ['fuel', '⛽', 'Fuel & Expense'],
    ['pnl', '📈', 'P&L'],
    ['maintenance', '🔧', 'Maintenance'],
    ['damage', '📸', 'Damage & Incident'],
    ['manifest', '📝', 'Manifest / Daily Log'],
    ['invoice', '🧾', 'Invoice'],
    ['connect', '🤝', 'Connect'],
    ['reminders', '🔔', 'Reminders'],
    ['preferences', '⚙️', 'Preferences'],
    ['subscription', '💳', 'Subscription'],
    ['feedback', '💬', 'Feedback'],
    ['logout', '🚪', 'Logout']
  ];

  function buildSidebar() {
    var nav = el('sbNav');
    var html = '';
    SIDEBAR_ITEMS.forEach(function (it) {
      if (it[0] === 'pnl' && !pnlAllowed()) return; // gate removed — everyone sees P&L
      if (it[0] === 'maintenance' && !maintAllowed()) return; // gate removed — everyone sees Maintenance
      html += '<button data-act="' + it[0] + '"><span>' + it[1] + '</span> ' + it[2] + '</button>';
    });
    nav.innerHTML = html;
    Array.prototype.forEach.call(nav.querySelectorAll('button'), function (b) {
      b.onclick = function () {
        closeSidebar();
        var act = b.getAttribute('data-act');
        if (act === 'dashboard') App.showDashboard();
        else if (act === 'feedback') openFeedback();
        else if (act === 'logout') doLogout();
        else App.openModule(act);
      };
    });
  }

  function closeSidebar() {
    el('sidebar').classList.remove('open');
    el('scrim').classList.remove('show');
  }

  App.showDashboard = function () {
    el('dashView').classList.remove('hidden');
    el('modView').classList.add('hidden');
    buildDashboard();
  };

  App.openModule = function (key) {
    var meta = MODULE_META[key];
    var special = { reminders: 1, preferences: 1, subscription: 1 };
    /* P&L + Maintenance gates removed Oct 13, 2026 — Asjad (Driver) gets full access. */
    if (meta && !App.tierAllows(meta.tier)) {
      // locked -> go to subscription
      key = 'subscription';
    }
    var mod = Meticulous.modules[key];
    if (!mod) return;
    el('dashView').classList.add('hidden');
    el('modView').classList.remove('hidden');
    var title = meta ? meta.title : ({ reminders: 'Reminders', preferences: 'Preferences', subscription: 'Subscription' }[key] || key);
    el('modTitle').textContent = title;
    var body = el('modBody');
    body.innerHTML = '';
    try { mod.render(body); } catch (e) { body.innerHTML = '<div class="empty">Could not load module.</div>'; console.error(e); }
    window.scrollTo(0, 0);
  };

  function doLogout() {
    if (window.FB && FB.ready && FB.user) {
      FB.signOut().then(function () { location.reload(); });
    } else {
      store.del('localEmail');
      location.reload();
    }
  }

  /* ---------------- tracker ---------------- */
  function trackerSave() { store.set('tracker', App.tracker); }
  function trackerTick() {
    var t = App.tracker, sec = t.elapsed;
    if (t.status === 'running') sec += Math.floor((Date.now() - t.startTs) / 1000);
    el('trkClock').textContent = fmtClock(sec);
    // v27: minute check — start the tracker by itself when the auto-start time arrives
    // while the app is open (covers "set 6 AM and forget").
    if (!trackerTick._as || Date.now() - trackerTick._as > 60000) {
      trackerTick._as = Date.now();
      try { if (App.checkAutoStart) App.checkAutoStart(); } catch (e) {}
    }
  }
  function trackerPaint() {
    var t = App.tracker, main = el('trkMain'), stop = el('trkStop'), meta = el('trkMeta');
    main.classList.remove('play', 'pause');
    if (t.status === 'idle') {
      main.classList.add('play'); main.innerHTML = '▶<br>START';
      stop.classList.add('hidden'); meta.textContent = 'Ready to work';
    } else if (t.status === 'running') {
      main.classList.add('pause'); main.innerHTML = '⏸<br>PAUSE';
      stop.classList.remove('hidden'); meta.textContent = 'Working…';
    } else {
      main.classList.add('play'); main.innerHTML = '▶<br>RESUME';
      stop.classList.remove('hidden'); meta.textContent = 'Paused';
    }
    // v28: show the effective start time + the Edit control
    var st = el('trkStartLabel');
    if (st) {
      st.textContent = (t.status === 'idle')
        ? (t.presetStart ? 'Will count from ' + fmtTimeAMPM(t.presetStart) : 'Starts from now')
        : 'Counting from ' + fmtTimeAMPM(trackerSessionStartMs());
    }
    trackerTick();
  }

  /* ---------------- v28: backdate / adjust the tracker start time ----------------
     "I started my shift at 8:30 but opened the app at 11:20 — the timer shows
     5 seconds and I have no way to fix it." Now he does.
     - While RUNNING or PAUSED: "Edit" sets the real start time; elapsed recalculates.
     - While IDLE: "Edit" presets a start time; tapping START counts from there. */
  function fmtTimeAMPM(ms) {
    var d = new Date(ms), h = d.getHours(), m = d.getMinutes();
    var ap = h >= 12 ? 'PM' : 'AM'; h = h % 12; if (h === 0) h = 12;
    return h + ':' + ('0' + m).slice(-2) + ' ' + ap;
  }
  /* Overall session start in ms, accounting for accumulated elapsed across pauses. */
  function trackerSessionStartMs() {
    var t = App.tracker, now = Date.now();
    if (t.status === 'idle') return t.presetStart || now;
    var live = t.elapsed + (t.status === 'running' ? Math.floor((now - t.startTs) / 1000) : 0);
    return now - live * 1000;
  }
  function closeTrackerStartSheet() {
    el('trkStartSheet').classList.remove('open');
    el('scrim').classList.remove('show');
    el('scrim').onclick = closeSidebar;
  }
  App.trackerEditStart = function () {
    var d = new Date(trackerSessionStartMs());
    el('trkStartTime').value = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    el('trkStartSheet').classList.add('open');
    el('scrim').classList.add('show');
    el('scrim').onclick = function () { closeTrackerStartSheet(); };
  };
  App.trackerSaveStart = function () {
    var v = el('trkStartTime').value; // "HH:MM"
    if (!v) { closeTrackerStartSheet(); return; }
    var parts = v.split(':'), now = new Date();
    var target = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
      parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
    if (target.getTime() > Date.now()) target = new Date(target.getTime() - 24 * 3600 * 1000); // assume yesterday
    var secs = Math.max(0, Math.floor((Date.now() - target.getTime()) / 1000));
    if (secs > 12 * 3600 && !confirm('That is ' + fmtClock(secs) + ' ago. Is that right?')) { return; }
    var t = App.tracker;
    if (t.status === 'idle') {
      t.presetStart = target.getTime(); // applied when START is tapped
    } else {
      // Collapse the session to "started at <target>": elapsed holds the whole total,
      // startTs resets to now so the running segment contributes ~0. Paused works the same.
      t.elapsed = secs; t.startTs = Date.now();
      if (t.presetStart) delete t.presetStart;
    }
    trackerSave(); trackerPaint(); closeTrackerStartSheet();
  };
  App.trackerToggle = function () {
    var t = App.tracker;
    var wasIdle = t.status === 'idle';
    if (t.status === 'idle') {
      t.status = 'running'; t.startTs = Date.now();
      // v28: if a start time was preset ("I actually started at 8:30"), count from there
      t.elapsed = t.presetStart ? Math.max(0, Math.floor((Date.now() - t.presetStart) / 1000)) : 0;
      delete t.presetStart;
    }
    else if (t.status === 'running') { t.elapsed += Math.floor((Date.now() - t.startTs) / 1000); t.status = 'paused'; }
    else { t.status = 'running'; t.startTs = Date.now(); }
    trackerSave(); trackerPaint();
    // v39: a fresh shift start (not a resume) may prompt for the
    // starting odometer — by-mile pay only, non-blocking.
    if (wasIdle) { try { maybePromptOdo('start'); } catch (e) {} }
  };
  /* v34: stop with an explicit end time. Asjad often forgets to press STOP
     when the shift actually ends, so the recorded end overshot. The STOP
     button now opens an end-time sheet (defaults to now — same result as
     before) where he can set the real finish; the saved session's duration
     and endedAt are computed to that end. Mirrors the start-time Edit. */
  function trackedSecondsAt(endMs) {
    var t = App.tracker;
    return t.elapsed + (t.status === 'running' ? Math.floor((endMs - t.startTs) / 1000) : 0);
  }
  function stopSessionAt(endMs) {
    var sec = trackedSecondsAt(endMs);
    if (sec > 0) {
      var sessions = store.get('sessions', []);
      var entry = { date: todayStr(new Date(endMs)), seconds: sec, endedAt: new Date(endMs).toISOString() };
      // v39: carry the by-mile starting-odometer reading (captured at
      // shift start, pending on the tracker) onto the day's session.
      var pendingStart = takePendingStartOdo(todayStr(new Date(trackerSessionStartMs())));
      if (pendingStart) entry.startOdo = pendingStart;
      sessions.push(entry); store.set('sessions', sessions);
      if (window.FB && FB.saveDoc) FB.saveDoc('sessions', 's' + Date.now(), entry);
      if (Meticulous.modules.revenue && Meticulous.modules.revenue.onSession) {
        try { Meticulous.modules.revenue.onSession(entry); } catch (e) {}
      }
    }
    App.tracker = { status: 'idle', startTs: 0, elapsed: 0 };
    trackerSave(); trackerPaint();
    // v39: shift stopped — by-mile days with a start reading and no end
    // reading get the closing-odometer prompt (once per day).
    try { maybePromptOdo('end'); } catch (e) {}
  }
  App.trackerStop = function () { stopSessionAt(Date.now()); };
  function closeTrackerEndSheet() {
    el('trkEndSheet').classList.remove('open');
    el('scrim').classList.remove('show');
    el('scrim').onclick = closeSidebar;
  }
  App.trackerStopPrompt = function () {
    var now = new Date();
    el('trkEndTime').value = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
    el('trkEndSheet').classList.add('open');
    el('scrim').classList.add('show');
    el('scrim').onclick = function () { closeTrackerEndSheet(); };
  };
  App.trackerSaveEnd = function () {
    var v = el('trkEndTime').value; // "HH:MM"
    if (!v) { closeTrackerEndSheet(); App.trackerStop(); return; }
    var parts = v.split(':'), startMs = trackerSessionStartMs(), sd = new Date(startMs);
    var end = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate(),
      parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
    if (end.getTime() <= startMs) end = new Date(end.getTime() + 24 * 3600 * 1000); // overnight shift
    if (end.getTime() > Date.now()) end = new Date(); // can't end in the future
    var secs = trackedSecondsAt(end.getTime());
    if (secs <= 0) { alert('That end time is not after the start. Check the times and try again.'); return; }
    if (secs > 12 * 3600 && !confirm('That makes a ' + fmtClock(secs) + ' shift. Is that right?')) { return; }
    closeTrackerEndSheet();
    stopSessionAt(end.getTime());
  };

  /* ODO-PROMPT-BEGIN — paid-by-mile day odometer prompts (v39).
     Decision + record-keeping only (DOM lives in maybePromptOdo below).
     Harness-extractable: may use `store`, `App.tracker`, `todayStr`,
     `trackerSave` and the ODO-MASTER helpers.
     Rules (Asjad, Oct 13): pay mode is onboarding.payStandard; 'Miles'
     means by-mile. By-mile days prompt once at shift start and once at
     stop; hourly/trip/weight NEVER prompt. The prompt is non-blocking —
     the timer runs regardless — and shows at most once per day per kind.
     Readings live on the day's session entry (startOdo/endOdo); while a
     shift is running the start reading waits on the tracker state. */
  function isByMile() {
    var o = store.get('onboarding', {});
    return String((o && o.payStandard) || '').toLowerCase() === 'miles';
  }
  function odoPromptShown(kind, dateStr) {
    var rec = store.get('odoPrompt', {});
    return !!(rec && rec[dateStr] && rec[dateStr][kind]);
  }
  function markOdoPromptShown(kind, dateStr) {
    var rec = store.get('odoPrompt', {});
    if (!rec[dateStr]) rec[dateStr] = {};
    rec[dateStr][kind] = true;
    store.set('odoPrompt', rec);
  }
  function sessionWithStartOdo(dateStr) {
    var ss = store.get('sessions', []);
    for (var i = ss.length - 1; i >= 0; i--) {
      if (ss[i].date === dateStr && ss[i].startOdo) return ss[i];
    }
    return null;
  }
  function shouldPromptOdo(kind) {
    if (!isByMile()) return false;
    var today = todayStr(new Date());
    if (odoPromptShown(kind, today)) return false;
    if (kind === 'start') {
      if (App.tracker && App.tracker.odoStart && App.tracker.odoStart.date === today) return false;
      if (sessionWithStartOdo(today)) return false;
      return true;
    }
    var s = sessionWithStartOdo(today);
    return !!(s && !s.endOdo);
  }
  /* A successful photo read. Start readings wait on the tracker state
     (persisted) until stopSessionAt moves them onto the session; end
     readings patch the day's session directly. Every read also bumps
     the master odometer (upward only, addition #2 rule). */
  function applyOdoReading(kind, value) {
    var n = parseFloat(value);
    if (!(n > 0)) return false;
    bumpOdometer(n);
    var today = todayStr(new Date());
    if (kind === 'start') {
      App.tracker.odoStart = { date: today, value: n };
      trackerSave();
      return true;
    }
    var ss = store.get('sessions', []);
    for (var i = ss.length - 1; i >= 0; i--) {
      if (ss[i].date === today && ss[i].startOdo && !ss[i].endOdo) {
        ss[i].endOdo = n;
        store.set('sessions', ss);
        return true;
      }
    }
    return false;
  }
  /* stopSessionAt: move the pending start reading onto the new session
     entry. Matches on the session's START date, so an overnight shift
     still lands its reading on the entry (the entry itself is dated by
     its end day, per the existing session convention). */
  function takePendingStartOdo(sessionStartDate) {
    var t = App.tracker;
    if (t && t.odoStart && t.odoStart.date === sessionStartDate) {
      var v = t.odoStart.value;
      delete t.odoStart;
      return v;
    }
    return null;
  }
  /* ODO-PROMPT-END */

  /* v39: the prompt sheet itself (index.html #odoSheet) — mirrors the
     tracker start/end sheets. Shown from trackerToggle (manual start),
     checkAutoStart (timed start) and stopSessionAt (stop). */
  var _odoPromptKind = null;
  function closeOdoSheet() {
    var s = el('odoSheet');
    if (s) s.classList.remove('open');
    el('scrim').classList.remove('show');
    el('scrim').onclick = closeSidebar;
  }
  function maybePromptOdo(kind) {
    if (!shouldPromptOdo(kind)) return false;
    var sheet = el('odoSheet');
    if (!sheet) return false;
    // Mark BEFORE showing: once per day per kind, even if skipped.
    markOdoPromptShown(kind, todayStr(new Date()));
    _odoPromptKind = kind;
    el('odoSheetTitle').textContent = kind === 'start' ? '📸 Starting odometer' : '📸 Ending odometer';
    el('odoSheetNote').textContent = kind === 'start'
      ? 'Paid by the mile — snap the dash for your starting reading. Your timer is already running.'
      : 'Paid by the mile — snap the dash for your closing reading.';
    el('odoSheetStatus').innerHTML = '';
    sheet.classList.add('open');
    el('scrim').classList.add('show');
    el('scrim').onclick = function () { closeOdoSheet(); };
    return true;
  }
  App.odoSheetSkip = function () { closeOdoSheet(); };
  function odoSheetHandleFile(file) {
    if (!file || !_odoPromptKind) return;
    var kind = _odoPromptKind;
    var st = el('odoSheetStatus');
    function setStatus(html) { if (st) st.innerHTML = html; }
    if (!window.TicketOCR || !TicketOCR.fileToOCRImage) {
      setStatus('⚠️ Photo reader not ready — skip for now; you can add the reading in Fuel.');
      return;
    }
    setStatus('📖 Reading photo…');
    TicketOCR.fileToOCRImage(file, function (ocrUrl) {
      if (!ocrUrl) { setStatus('⚠️ Couldn\'t read the odometer — tap Skip; you can add it later in Fuel.'); return; }
      TicketOCR.recognizeWithRotation(ocrUrl, function (p) {
        try { setStatus('📖 Reading photo… ' + Math.round(p * 100) + '%'); } catch (e) {}
      }).then(function (text) {
        var km = parseOdometerReading(text);
        if (km) {
          applyOdoReading(kind, km);
          setStatus('✓ Read: <b>' + Number(km).toLocaleString('en-CA') + ' km</b>');
          setTimeout(closeOdoSheet, 1200);
        } else {
          setStatus('⚠️ Couldn\'t read the odometer — tap Skip; you can add it later in Fuel.');
        }
      }).catch(function () {
        setStatus('⚠️ Couldn\'t read the odometer — tap Skip; you can add it later in Fuel.');
      });
    });
  }

  /* ---------------- timed auto-start ---------------- */
  // v27: start the tracker by itself at a set time on chosen days.
  // Time-based ONLY — no location/GPS involved. Runs when the app is open
  // (minute check + resume check); if the app was closed, it prompts on next open.
  var AUTOSTART_GRACE_MIN = 60; // start silently within 60 min of set time; prompt after that

  function autoStartPrefs() {
    var o = store.get('onboarding', {});
    var days = o.autoStartDays;
    if (!Array.isArray(days)) days = [1, 2, 3, 4, 5]; // Mon–Fri default
    return { enabled: !!o.autoStart, time: o.autoStartTime || '06:00', days: days };
  }
  function autoStartFired(today) {
    var rec = store.get('autostart', {});
    return !!(rec && rec[today]);
  }
  function markAutoStartFired(today) {
    var rec = store.get('autostart', {});
    rec[today] = true;
    store.set('autostart', rec);
  }
  function autoStartLabel(timeStr) {
    var p = String(timeStr || '06:00').split(':');
    var h = +p[0] || 0, m = ('0' + (+p[1] || 0)).slice(-2);
    var ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12 || 12;
    return h12 + ':' + m + ' ' + ap;
  }
  function autoStartNotify(body) {
    try { if (window.FB && FB.localNotify) { FB.localNotify('Meticulous', body); return; } } catch (e) {}
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Meticulous', { body: body, icon: 'assets/icon-192.png' });
      }
    } catch (e2) {}
  }

  App.checkAutoStart = function () {
    try {
      var p = autoStartPrefs();
      if (!p.enabled) return 'off';
      var now = new Date();
      if (p.days.indexOf(now.getDay()) === -1) return 'wrong-day';
      var today = todayStr(now);
      if (autoStartFired(today)) return 'fired';
      var t = App.tracker || { status: 'idle' };
      if (t.status === 'running') { markAutoStartFired(today); return 'running'; }
      var tp = String(p.time).split(':');
      var startMins = (+tp[0] || 0) * 60 + (+tp[1] || 0);
      var nowMins = now.getHours() * 60 + now.getMinutes();
      if (nowMins < startMins) return 'not-yet';
      var label = autoStartLabel(p.time);
      markAutoStartFired(today);
      if (t.status === 'idle' && (nowMins - startMins) <= AUTOSTART_GRACE_MIN) {
        // Within grace window: start by itself, no questions.
        App.tracker.status = 'running';
        App.tracker.startTs = Date.now();
        App.tracker.elapsed = 0;
        trackerSave(); trackerPaint();
        autoStartNotify('Tracker auto-started at ' + label);
        // v39: auto-start is a shift start too — same by-mile odometer
        // prompt as the manual play button (non-blocking).
        try { maybePromptOdo('start'); } catch (e) {}
        return 'started';
      }
      // Time passed long ago (app was closed), or tracker was paused mid-shift: ask.
      var msg = t.status === 'paused'
        ? 'Auto-start time (' + label + ') has passed and your tracker is paused. Resume it now?'
        : 'Auto-start time (' + label + ') has passed. Start the tracker now?';
      if (confirm(msg)) {
        App.trackerToggle(); // idle -> start fresh; paused -> resume
        return 'prompted-started';
      }
      return 'prompted-declined';
    } catch (e) { return 'error'; }
  };

  /* ---------------- v34: sync status popup (tap the top-bar dot) ----------------
     The dot's state used to live only in its `title` tooltip — invisible on
     Android — so a stuck sync could not be diagnosed from a screenshot.
     Tapping the dot now pops the same status Preferences shows, and first
     kicks a sync (which also heals a signed-in user the engine missed). */
  App.showSyncStatus = function () {
    try { if (window.CloudSync && CloudSync.syncNow) CloudSync.syncNow(); } catch (e) {}
    setTimeout(function () {
      try {
        if (!window.CloudSync || !CloudSync.status) { alert('Sync engine not loaded.'); return; }
        var st = CloudSync.status();
        var who = (window.FB && FB.user && FB.user.email) || (App.user && App.user.email) || null;
        var word = st.dot === 'ok' ? 'Backed up ✓'
          : st.dot === 'syncing' ? 'Syncing…'
          : st.dot === 'err' ? 'Error' : 'Off';
        var lines = ['Cloud sync: ' + word];
        lines.push(who ? 'Signed in as: ' + who : 'Not signed in (local mode)');
        if (st.dirtyKeys && st.dirtyKeys.length) lines.push('Waiting to upload: ' + st.dirtyKeys.join(', '));
        if (st.stats) lines.push('Uploaded: ' + (st.stats.pushed || 0) + ' · Downloaded: ' + (st.stats.pulled || 0));
        if (st.lastError) lines.push('Last error: ' + st.lastError);
        if (!st.online) lines.push('Phone reports offline.');
        alert(lines.join('\n'));
      } catch (e) { alert('Could not read sync status.'); }
    }, 600);
  };

  /* ---------------- feedback ---------------- */
  function openFeedback() {
    el('fbSheet').classList.add('open');
    var scr = el('scrim'); scr.classList.add('show');
    scr.onclick = function () { el('fbSheet').classList.remove('open'); scr.classList.remove('show'); scr.onclick = closeSidebar; };
  }
  App.openFeedback = openFeedback;
  function sendFeedback() {
    var text = el('fbText').value.trim();
    if (!text) { el('fbText').focus(); return; }
    var item = {
      text: text,
      screen: el('fbScreen').checked ? (el('modView').classList.contains('hidden') ? 'dashboard' : el('modTitle').textContent) : '',
      at: new Date().toISOString()
    };
    var all = store.get('feedback', []); all.push(item); store.set('feedback', all);
    if (window.FB && FB.saveDoc) FB.saveDoc('feedback', 'f' + Date.now(), item);
    el('fbText').value = '';
    el('fbSheet').classList.remove('open');
    el('scrim').classList.remove('show');
    el('scrim').onclick = closeSidebar;
    alert('Thanks — feedback saved.');
  }

  /* ---------------- onboarding ---------------- */
  var ONB_STEPS = [
    { key: 'accountType', title: 'What best describes you?', hint: 'This shapes what the app tracks for you.',
      type: 'opts', opts: [['Driver', '🚛', 'Driver'], ['Owner-Operator', '🧾', 'Owner-Operator'], ['Fleet Manager', '👥', 'Fleet Manager']] },
    { key: 'employment', title: 'How are you paid?', hint: 'Contract or payroll — used for invoices and pay stubs.',
      type: 'opts', opts: [['Contract', '📝', 'Contract'], ['Payroll', '💼', 'Payroll']] },
    { key: 'pay', title: 'Payment standard', hint: 'How your pay is calculated, and your rate.',
      type: 'pay' },
    { key: 'base', title: 'Where do you park your truck?', hint: 'Home, yard, quarry — your base location.',
      type: 'text', ph: 'e.g. Home — 123 Main St, Calgary' },
    { key: 'company', title: 'Company details', hint: 'Used on invoices and manifests.', type: 'company' },
    { key: 'truck', title: 'Truck details', hint: 'Your rig.', type: 'truck' },
    { key: 'odometer', title: 'Odometer photo', hint: 'Snap your odometer — we read the mileage and use it as the starting point for services.', type: 'odometer' },
    { key: 'safety', title: 'Safety sticker photo', hint: 'Snap your safety inspection sticker — we read the expiry date and remind you before it is due.', type: 'safety' },
    { key: 'done', title: 'You are set!', hint: 'Review and finish.', type: 'done' }
  ];

  function optGrid(opts, cur) {
    var h = '<div class="optgrid">';
    opts.forEach(function (o) {
      h += '<div class="opt' + (cur === o[0] ? ' sel' : '') + '" data-v="' + o[0] + '"><span class="e">' + o[1] + '</span>' + o[2] + '</div>';
    });
    return h + '</div>';
  }

  function renderOnbStep() {
    var i = App.onbStep, st = ONB_STEPS[i], o = App.onb;
    el('onbProg').style.width = Math.round(((i + 1) / ONB_STEPS.length) * 100) + '%';
    el('onbBack').style.visibility = i === 0 ? 'hidden' : 'visible';
    el('onbNext').textContent = i === ONB_STEPS.length - 1 ? 'Finish' : 'Next';
    var h = '<div class="step on"><h3>Step ' + (i + 1) + ' of ' + ONB_STEPS.length + ': ' + st.title + '</h3><p class="hint">' + st.hint + '</p>';
    if (st.type === 'opts') {
      h += optGrid(st.opts, o[st.key]);
    } else if (st.type === 'pay') {
      h += optGrid([['Miles', '🛣️', 'Miles'], ['Hourly', '⏱️', 'Hourly'], ['Trip', '🔁', 'Trip'], ['Weight', '⚖️', 'Weight']], o.payStandard);
      h += '<label class="f">Rate ($)</label><input id="ob_rate" type="number" inputmode="decimal" placeholder="e.g. 95" value="' + esc(o.payRate || '') + '">';
    } else if (st.type === 'text') {
      h += '<input id="ob_base" placeholder="' + esc(st.ph || '') + '" value="' + esc(o.baseLocation || '') + '">';
    } else if (st.type === 'company') {
      h += '<label class="f">Company name</label><input id="ob_cname" value="' + esc(o.companyName || '') + '">' +
        '<label class="f">GST/HST number</label><input id="ob_gst" value="' + esc(o.gst || '') + '" placeholder="e.g. 123456789RT0001">' +
        '<label class="f">Business address</label><input id="ob_caddr" value="' + esc(o.companyAddr || '') + '">' +
        '<label class="f">Contracting company</label><input id="ob_cont" value="' + esc(o.contractingCo || '') + '">';
    } else if (st.type === 'truck') {
      h += '<label class="f">Truck number</label><input id="ob_tnum" value="' + esc(o.truckNo || '') + '" placeholder="e.g. 007">' +
        '<label class="f">Load / trailer type</label><input id="ob_ttype" value="' + esc(o.truckType || '') + '" placeholder="e.g. Tandem dump">';
    } else if (st.type === 'odometer') {
      h += '<div style="display:flex;gap:10px;margin:10px 0;">' +
        '<button type="button" class="btn secondary" id="ob_odo_cam" style="flex:1;">📷 Take photo</button>' +
        '<button type="button" class="btn secondary" id="ob_odo_pick" style="flex:1;">📁 Choose file</button></div>' +
        '<input type="file" id="ob_odo_cam_in" accept="image/*" capture="environment" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<input type="file" id="ob_odo_in" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<div id="ob_odo_prev"></div><div id="ob_odo_status" class="note"></div>' +
        '<label class="f">Odometer (km) — or type it in</label>' +
        '<input id="ob_odo" type="number" inputmode="decimal" placeholder="e.g. 245678" value="' + esc(o.odometerBaseline || '') + '">' +
        '<p class="note">This becomes the starting point for oil changes and services in Maintenance. Skip it if you prefer to set it later.</p>' +
        '<button type="button" class="btn ghost" id="ob_odo_skip" style="margin-top:6px;">Skip this step →</button>';
    } else if (st.type === 'safety') {
      h += '<div style="display:flex;gap:10px;margin:10px 0;">' +
        '<button type="button" class="btn secondary" id="ob_safety_cam" style="flex:1;">📷 Take photo</button>' +
        '<button type="button" class="btn secondary" id="ob_safety_pick" style="flex:1;">📁 Choose file</button></div>' +
        '<input type="file" id="ob_safety_cam_in" accept="image/*" capture="environment" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<input type="file" id="ob_safety_in" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<div id="ob_safety_prev"></div><div id="ob_safety_status" class="note"></div>' +
        '<label class="f">Safety sticker expiry — or pick it</label>' +
        '<input id="ob_safety" type="date" value="' + esc(o.safetyExpiry || '') + '">' +
        '<p class="note">We will remind you 30 days before it expires. Skip it if you prefer to set it later.</p>' +
        '<button type="button" class="btn ghost" id="ob_safety_skip" style="margin-top:6px;">Skip this step →</button>';
    } else if (st.type === 'done') {
      h += '<div class="card"><div class="kv"><span>Account</span><b>' + esc(o.accountType || '—') + '</b></div>' +
        '<div class="kv"><span>Employment</span><b>' + esc(o.employment || '—') + '</b></div>' +
        '<div class="kv"><span>Pay</span><b>' + esc(o.payStandard || '—') + (o.payRate ? ' @ $' + esc(o.payRate) : '') + '</b></div>' +
        '<div class="kv"><span>Base</span><b>' + esc(o.baseLocation || '—') + '</b></div>' +
        '<div class="kv"><span>Company</span><b>' + esc(o.companyName || '—') + '</b></div>' +
        '<div class="kv"><span>Truck</span><b>' + esc(o.truckNo || '—') + '</b></div>' +
        '<div class="kv"><span>Odometer</span><b>' + esc(o.odometerBaseline ? Number(o.odometerBaseline).toLocaleString('en-CA') + ' km' : '—') + '</b></div>' +
        '<div class="kv"><span>Safety expiry</span><b>' + esc(o.safetyExpiry || '—') + '</b></div></div>';
    }
    h += '</div>';
    el('onbSteps').innerHTML = h;
    Array.prototype.forEach.call(el('onbSteps').querySelectorAll('.opt'), function (d) {
      d.onclick = function () {
        var v = d.getAttribute('data-v');
        if (st.key === 'pay') o.payStandard = v; else o[st.key] = v;
        store.set('onboarding', o);
        renderOnbStep();
      };
    });
    // v28: photo steps — wire camera/file buttons + per-step skip
    if (st.type === 'odometer') {
      onbWirePhoto('ob_odo', 'odometer');
      var osk = el('ob_odo_skip');
      if (osk) osk.onclick = function () { collectOnbInputs(); if (App.onbStep < ONB_STEPS.length - 1) { App.onbStep++; renderOnbStep(); } };
    } else if (st.type === 'safety') {
      onbWirePhoto('ob_safety', 'safety');
      var ssk = el('ob_safety_skip');
      if (ssk) ssk.onclick = function () { collectOnbInputs(); if (App.onbStep < ONB_STEPS.length - 1) { App.onbStep++; renderOnbStep(); } };
    }
  }

  /* v28: onboarding photo → OCR. kind is 'odometer' or 'safety'.
     Runs Tesseract on the chosen photo, parses the value, and fills the
     manual input so the user can confirm or correct it. Never blocks. */
  var _onbOcrToken = 0;
  function onbSetStatus(prefix, html) {
    var s = el(prefix + '_status');
    if (s) s.innerHTML = html;
  }
  function onbPersistPhoto(kind, v) {
    var o = App.onb || {};
    if (kind === 'odometer') o.odometerBaseline = v; else o.safetyExpiry = v;
    App.onb = o;
    store.set('onboarding', o);
  }
  /* ODO-MASTER-BEGIN — the odometer reader + the single master odometer
     store (v39). Harness-extractable: functions in this region may use
     only `store` and pure JS. */
  function parseOdometerReading(text) {
    if (!text) return null;
    /* v34: prefer the TOTAL odometer over the trip meter. On Asjad's dash
       photo the old largest-number rule still lost because the trip value
       came through clean while the total (168472, beside its "KM" label)
       competed with every other gauge number. Ranking now:
         1. largest 5-6 digit whole number on a "KM" line (or next to one)
         2. largest 5-6 digit whole number anywhere — totals have no
            decimal; trip meters usually do (1553.5) or fewer digits
         3. largest plausible reading at all (old behaviour)
       The manual field stays as the fallback when OCR gets it wrong. */
    var lines = String(text).split(/\r?\n/);
    var kmOnly = lines.map(function (l) { return /^\s*km\s*$/i.test(l); });
    var all = [], onKm = [];
    lines.forEach(function (line, i) {
      // glue digits OCR split with spaces/commas: "168 472" / "168, 472"
      var t = line.replace(/(\d)[ \t]+(?=\d)/g, '$1').replace(/(\d),[ \t]+(?=\d)/g, '$1,');
      var nearKm = /km/i.test(t) || !!kmOnly[i + 1] || !!kmOnly[i - 1];
      var re = /(\d[\d,]*\.?\d*)/g, m;
      while ((m = re.exec(t)) !== null) {
        var v = parseFloat(m[1].replace(/,/g, ''));
        if (!isFinite(v)) continue;
        var iv = Math.floor(v);
        if (iv < 1000 || iv >= 10000000) continue; // sanity cap; drops RPM/speed noise
        var cand = { v: iv, digits: m[1].replace(/,/g, '').split('.')[0].length, dec: /\.\d/.test(m[1]) };
        all.push(cand);
        if (nearKm) onKm.push(cand);
      }
    });
    function largest(list) {
      var best = null;
      list.forEach(function (c) { if (!best || c.v > best.v) best = c; });
      return best;
    }
    function isTotal(c) { return c.digits >= 5 && c.digits <= 6 && !c.dec; }
    var pick = largest(onKm.filter(isTotal)) || largest(all.filter(isTotal)) || largest(all);
    return pick ? String(pick.v) : null;
  }
  /* v39: ONE master odometer, stored once in the synced store key
     'mt_odo' (the key onboarding/Preferences/Maintenance already use).
     Every capture point (onboarding, Preferences, Fuel, the by-mile day
     prompts) writes through bumpOdometer — UPWARD ONLY: a lower OCR
     misread or typo must never drag the master down. Everything
     mileage-based reads masterOdometer() live at render/fire time. */
  function masterOdometer() {
    var v = parseFloat(store.get('mt_odo', ''));
    return (isFinite(v) && v > 0) ? v : null;
  }
  function bumpOdometer(v) {
    var n = parseFloat(v);
    var prev = masterOdometer();
    if (!(n > 0)) return { value: prev, raised: false, previous: prev };
    if (prev === null || n > prev) {
      store.set('mt_odo', String(n));
      return { value: n, raised: true, previous: prev };
    }
    return { value: prev, raised: false, previous: prev };
  }
  /* ODO-MASTER-END */
  var _ONB_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function parseStickerExpiry(text) {
    if (!text) return null;
    var t = String(text).toUpperCase();
    var mo = null, y = null;
    var m = t.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s.,-]*(\d{2,4})/);
    if (m) {
      mo = _ONB_MONTHS[m[1].slice(0, 3).toLowerCase()];
      y = parseInt(m[2], 10);
      if (y < 100) y += 2000;
    } else {
      var m2 = t.match(/\b(0?[1-9]|1[0-2])[\/\-](20\d{2})\b/);
      if (!m2) return null;
      mo = parseInt(m2[1], 10) - 1;
      y = parseInt(m2[2], 10);
    }
    if (mo === null || mo === undefined || !(y >= 2020 && y <= 2045)) return null;
    // sticker expires at end of the printed month
    var last = new Date(y, mo + 1, 0).getDate();
    return y + '-' + ('0' + (mo + 1)).slice(-2) + '-' + ('0' + last).slice(-2);
  }
  /* v31: onbWirePhoto now accepts an optional persistFn(kind, value) so
     Preferences can reuse the same OCR wiring with its own save logic.
     Exposed as App._wirePhotoOCR for the preferences module. */
  function onbWirePhoto(prefix, kind, persistFn) {
    var persist = persistFn || onbPersistPhoto;
    var camBtn = el(prefix + '_cam'), pickBtn = el(prefix + '_pick');
    var camIn = el(prefix + '_cam_in'), pickIn = el(prefix + '_in');
    var fieldEl = el(prefix), prevEl = el(prefix + '_prev');
    if (!camBtn || !pickBtn) return;
    camBtn.onclick = function () { if (camIn) camIn.click(); };
    pickBtn.onclick = function () { if (pickIn) pickIn.click(); };
    function handleFile(file) {
      if (!file) return;
      var token = ++_onbOcrToken;
      var rd = new FileReader();
      rd.onload = function () {
        var dataUrl = rd.result;
        if (token !== _onbOcrToken) return;
        if (prevEl) prevEl.innerHTML = '<img src="' + dataUrl + '" style="width:100%;border-radius:8px;margin:8px 0" alt="Photo">';
        if (!window.TicketOCR) { onbSetStatus(prefix, '⚠️ Photo reader not ready — enter it manually below.'); return; }
        onbSetStatus(prefix, '📖 Reading photo… 0%');
        TicketOCR.recognize(dataUrl, function (p) {
          if (token !== _onbOcrToken) return;
          try { onbSetStatus(prefix, '📖 Reading photo… ' + Math.round(p * 100) + '%'); } catch (e) {}
        }).then(function (text) {
          if (token !== _onbOcrToken) return;
          if (kind === 'odometer') {
            var km = parseOdometerReading(text);
            if (km && fieldEl) {
              fieldEl.value = km;
              persist(kind, km);
              onbSetStatus(prefix, '✓ We read <b>' + Number(km).toLocaleString('en-CA') + ' km</b> — fix it below if that is wrong.');
            } else {
              onbSetStatus(prefix, '⚠️ Could not read the mileage — enter it manually below.');
            }
          } else {
            var iso = parseStickerExpiry(text);
            if (iso && fieldEl) {
              fieldEl.value = iso;
              persist(kind, iso);
              onbSetStatus(prefix, '✓ We read expiry <b>' + iso + '</b> — fix it below if that is wrong.');
            } else {
              onbSetStatus(prefix, '⚠️ Could not read the expiry date — pick it manually below.');
            }
          }
        }).catch(function () {
          if (token !== _onbOcrToken) return;
          onbSetStatus(prefix, '⚠️ Photo reader needs internet the first time — enter it manually below.');
        });
      };
      try { rd.readAsDataURL(file); } catch (e) {
        onbSetStatus(prefix, '⚠️ Could not read that file — enter it manually below.');
      }
    }
    if (camIn) camIn.onchange = function () { handleFile(camIn.files[0]); camIn.value = ''; };
    if (pickIn) pickIn.onchange = function () { handleFile(pickIn.files[0]); pickIn.value = ''; };
  }

  function collectOnbInputs() {
    var o = App.onb, g = function (id) { var n = el(id); return n ? n.value.trim() : ''; };
    if (g('ob_rate')) o.payRate = g('ob_rate');
    if (g('ob_base')) o.baseLocation = g('ob_base');
    if (g('ob_cname')) o.companyName = g('ob_cname');
    if (g('ob_gst')) o.gst = g('ob_gst');
    if (g('ob_caddr')) o.companyAddr = g('ob_caddr');
    if (g('ob_cont')) o.contractingCo = g('ob_cont');
    if (g('ob_tnum')) o.truckNo = g('ob_tnum');
    if (g('ob_ttype')) o.truckType = g('ob_ttype');
    if (g('ob_odo')) o.odometerBaseline = g('ob_odo');
    if (g('ob_safety')) o.safetyExpiry = g('ob_safety');
    store.set('onboarding', o);
  }

  function finishOnboarding() {
    collectOnbInputs();
    var o = App.onb || {};
    // v28: odometer baseline -> Maintenance PM starting point
    try {
      if (o.odometerBaseline && parseFloat(o.odometerBaseline) > 0) {
        App._store.set('mt_odo', String(o.odometerBaseline));
      }
    } catch (e) {}
    // v28: safety sticker expiry -> Maintenance annual date + safety reminder
    try {
      if (o.safetyExpiry) {
        App._store.set('mt_annualDate', o.safetyExpiry);
        var rl = App._store.get('rem_list', []) || [];
        var exists = rl.some(function (r) { return r && r.type === 'safety' && /annual safety/i.test(r.title || ''); });
        if (!exists) {
          rl.push({
            id: 'r' + Date.now().toString(36),
            type: 'safety',
            title: 'Annual safety inspection',
            expiryDate: o.safetyExpiry,
            dueDate: '',
            dueOdometer: '',
            message: 'Safety sticker expires ' + o.safetyExpiry,
            notes: 'Added from onboarding photo.'
          });
          App._store.set('rem_list', rl);
        }
      }
    } catch (e) {}
    store.set('onboarded', true);
    // ask for notification permission once — never let it block onboarding
    // (v19: Notification API throws synchronously in some WebViews, which
    // previously aborted finishOnboarding before showing the main screen)
    try {
      if (window.FB && FB.enablePush) { FB.enablePush().catch(function () {}); }
    } catch (e) {}
    App.showView('main');
  }

  /* auth first, then onboarding: after any sign-in, route based on onboarded flag */
  function friendlyAuthError(e) {
    var code = (e && e.code) || '';
    var msg = (e && e.message) || 'Sign in failed.';
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found')
      return 'Wrong email or password. If you just reset your password, make sure you are typing the new one. (' + code + ')';
    if (code === 'auth/too-many-requests')
      return 'Too many tries — Firebase locked this for a bit. Wait 10 minutes and try again. (' + code + ')';
    if (code === 'auth/network-request-failed')
      return 'Could not reach the server. Check your internet and try again. (' + code + ')';
    if (code === 'auth/user-disabled')
      return 'This account is disabled. Contact support. (' + code + ')';
    return msg + (code ? ' (' + code + ')' : '');
  }
  /* v16: show auth errors visibly. The authErr box is hidden on the landing
     view, so failures there were invisible. If the form is hidden, use alert. */
  function visibleAuthError(msg) {
    try {
      var box = el('authBox'), err = el('authErr');
      if (box && !box.classList.contains('hidden') && err) {
        err.textContent = msg; err.style.display = 'block'; err.style.color = '';
      } else {
        alert(msg);
      }
    } catch (e) { try { alert(msg); } catch (e2) {} }
  }
  function afterAuth() {
    try {
      var u = (window.FB && FB.user) ? FB.user : null;
      // If FB.user not yet set, try Firebase's currentUser directly
      if (!u && window.FB && FB.auth && FB.auth.currentUser) {
        u = FB.auth.currentUser; FB.user = u;
      }
      App.onAuth(u);
      routeAfterFirstSync();
    } catch (e) {
      visibleAuthError('Navigation error: ' + (e.message || e));
    }
  }

  /* v28: wait for the first cloud pull before choosing onboarding vs main.
     On a fresh install the local onboarded flag is empty until the pull
     restores it from the cloud; routing immediately would show the onboarding
     questions even though the answers are already saved. Falls back to local
     state on timeout so a slow network never strands the user. */
  function routeAfterFirstSync() {
    var proceed = function () {
      try {
        if (store.get('onboarded', false)) App.showView('main');
        else { App.onbStep = 0; renderOnbStep(); App.showView('onboarding'); }
      } catch (e) { try { App.showView('main'); } catch (e2) {} }
    };
    try {
      if (window.CloudSync && CloudSync.whenFirstPullDone) {
        CloudSync.whenFirstPullDone(9000).then(proceed, proceed);
      } else proceed();
    } catch (e) { proceed(); }
  }

  /* ---------------- auth ---------------- */
  /* v15: strip invisible characters glitchy keyboards insert into passwords
     (zero-width spaces etc. are invisible even with the eye toggle on,
     so the password looks right but never matches). Applied on both
     signup and sign-in so they always agree. */
  function cleanPw(pw) {
    return String(pw || '').replace(/[\u200B\u200C\u200D\uFEFF\u00AD\u2060]/g, '');
  }
  function authError(msg, ok) {
    var e = el('authErr'); e.textContent = msg; e.style.display = 'block';
    e.style.color = ok ? '#15803d' : '';
  }
  function wireAuth() {
    if (el('btnShowPass')) el('btnShowPass').onclick = function () {
      var p = el('authPass');
      var show = p.type === 'password';
      p.type = show ? 'text' : 'password';
      el('btnShowPass').innerHTML = show ? '&#128064;' : '&#128065;';
    };
    if (el('btnForgot')) el('btnForgot').onclick = function () {
      var em = el('authEmail').value.trim();
      if (!em) return authError('Enter your email first, then tap Forgot password.');
      if (!window.FB || !FB.ready || !FB.auth) return authError('Could not reach the server. Try again.');
      authError('Sending reset email...');
      FB.sendReset(em).then(function () {
        authError('Reset email sent! Check your inbox (and spam folder).');
      }).catch(function (e) {
        authError((e && e.message) || 'Could not send reset email.');
      });
    };
    el('btnSignIn').onclick = function () {
      var em = el('authEmail').value.trim(), pw = cleanPw(el('authPass').value);
      if (!em || !pw) return authError('Enter email and password.');
      if (!window.FB || !FB.ready) return authError('Could not reach the server. Try "Continue without an account".');
      var btn = el('btnSignIn');
      btn.disabled = true; btn.textContent = 'Signing in...';
      function done() { btn.disabled = false; btn.textContent = 'Sign in'; }
      try {
        if (!FB.auth) throw new Error('Auth not ready. Reload the app and try again.');
        FB.signIn(em, pw).then(function () { done(); afterAuth(); })
          .catch(function (e) { done(); authError(friendlyAuthError(e)); });
      } catch (e) { done(); authError(e.message || 'Sign in failed.'); }
    };
    el('btnSignUp').onclick = function () {
      var em = el('authEmail').value.trim(), pw = cleanPw(el('authPass').value);
      if (!em || !pw) return authError('Enter email and password.');
      if (pw.length < 6) return authError('Password must be at least 6 characters.');
      if (!window.FB || !FB.ready) return authError('Could not reach the server. Try "Continue without an account".');
      var btn = el('btnSignUp');
      btn.disabled = true; btn.textContent = 'Creating...';
      function done() { btn.disabled = false; btn.textContent = 'Create account'; }
      FB.signUp(em, pw).then(function () {
        done();
        authError('Account created! Setting things up...', true);
        setTimeout(afterAuth, 600); // brief beat so the confirmation is seen
      })
        .catch(function (e) { done(); authError(friendlyAuthError(e)); });
    };
    /* v17: verify navigation actually happened; afterAuth swallows its own
       errors, so check the view and force minimal navigation if stuck. */
    function enterLocalMode() {
      var em = '';
      try { em = el('authEmail').value.trim(); } catch (e) {}
      if (em) { try { store.set('localEmail', em); } catch (e) {} }
      try { afterAuth(); } catch (e) {}
      /* v28: routing after sign-in waits for the first cloud pull (async), so
         defer this check past the microtask queue. */
      setTimeout(function () {
        var moved = false;
        try {
          moved = el('onboarding').classList.contains('active') ||
                  el('main').classList.contains('active');
        } catch (e) {}
        if (!moved) {
          try { App.onbStep = 0; renderOnbStep(); } catch (e) {}
          try { App.showView('onboarding'); }
          catch (e2) { visibleAuthError('Could not enter: ' + (e2 && e2.message || e2)); }
        }
      }, 120);
    }
    el('authSkip').onclick = enterLocalMode;
    /* auth landing (v2): two-button welcome -> form */
    function showAuthForm(mode) {
      el('authLand').classList.add('hidden');
      el('authBox').classList.remove('hidden');
      var isUp = mode === 'signup';
      el('authTitle').textContent = isUp ? 'Create account' : 'Sign in';
      el('btnSignIn').classList.toggle('hidden', isUp);
      el('btnSignUp').classList.toggle('hidden', !isUp);
      el('authErr').style.display = 'none';
    }
    function showAuthLand() {
      el('authBox').classList.add('hidden');
      el('authLand').classList.remove('hidden');
    }
    if (el('btnGoSignUp')) el('btnGoSignUp').onclick = function () { showAuthForm('signup'); };
    if (el('btnGoSignIn')) el('btnGoSignIn').onclick = function () { showAuthForm('signin'); };
    if (el('btnAuthBack')) el('btnAuthBack').onclick = showAuthLand;
    if (el('authSkipLand')) el('authSkipLand').onclick = el('authSkip').onclick;
  }

  /* ---------------- init ---------------- */
  function init() {
    App.onb = store.get('onboarding', {});
    App.tracker = store.get('tracker', { status: 'idle', startTs: 0, elapsed: 0 });
    if (App.tracker.status === 'running') { // v26: app was closed mid-shift — keep RUNNING, account for closed time
      App.tracker.elapsed += Math.floor((Date.now() - App.tracker.startTs) / 1000);
      App.tracker.startTs = Date.now();
      trackerSave(); // persist updated startTs so a quick re-close doesn't double-count
    }
    // v27: if the auto-start time passed while the app was closed, start or prompt now
    try { App.checkAutoStart(); } catch (e) {}

    el('onbBack').onclick = function () { collectOnbInputs(); if (App.onbStep > 0) { App.onbStep--; renderOnbStep(); } };
    el('onbNext').onclick = function () {
      collectOnbInputs();
      if (App.onbStep < ONB_STEPS.length - 1) { App.onbStep++; renderOnbStep(); }
      else finishOnboarding();
    };
    el('onbSkip').onclick = function () { store.set('onboarded', true); App.showView('main'); };

    el('btnMenu').onclick = function () {
      el('sidebar').classList.add('open'); el('scrim').classList.add('show');
      el('scrim').onclick = closeSidebar;
    };
    el('scrim').onclick = closeSidebar;
    el('btnBell').onclick = function () { App.openModule('reminders'); };
    var sdEl = el('syncDot');
    if (sdEl) sdEl.onclick = function () { App.showSyncStatus(); }; // v34: tap dot = sync status
    el('btnModBack').onclick = App.showDashboard;
    el('trkMain').onclick = App.trackerToggle;
    el('trkStop').onclick = function () { App.trackerStopPrompt(); }; // v34: end-time sheet
    el('trkEditStart').onclick = App.trackerEditStart;
    el('trkStartCancel').onclick = closeTrackerStartSheet;
    el('trkStartSave').onclick = App.trackerSaveStart;
    el('trkEndCancel').onclick = closeTrackerEndSheet;
    el('trkEndSave').onclick = App.trackerSaveEnd;
    // v39: by-mile odometer prompt sheet controls
    el('odoSheetSkip').onclick = function () { App.odoSheetSkip(); };
    el('odoSheetCam').onclick = function () { el('odoSheetCamIn').click(); };
    el('odoSheetPick').onclick = function () { el('odoSheetIn').click(); };
    el('odoSheetCamIn').onchange = function () { odoSheetHandleFile(el('odoSheetCamIn').files[0]); el('odoSheetCamIn').value = ''; };
    el('odoSheetIn').onchange = function () { odoSheetHandleFile(el('odoSheetIn').files[0]); el('odoSheetIn').value = ''; };
    el('fbFab').onclick = App.openFeedback;
    el('fbCancel').onclick = function () { el('fbSheet').classList.remove('open'); el('scrim').classList.remove('show'); el('scrim').onclick = closeSidebar; };
    el('fbSend').onclick = sendFeedback;

    wireAuth();
    /* v34: sign-in version label = the live web version, from the same
       source Preferences uses (OTA.currentVersion().active). The old label
       was hard-coded "v25" and had lied about every release since. */
    try {
      if (window.OTA && OTA.currentVersion) OTA.currentVersion().then(function (v) {
        var n = el('authVer');
        if (n && v && v.active) n.textContent = 'v' + v.active;
      });
    } catch (e) {}
    trackerPaint();
    setInterval(trackerTick, 1000);

    // v26: save tracker state when app goes to background (Android WebView may be killed)
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { try { trackerSave(); } catch (e) {} }
      // v27: when the app comes back, check whether the auto-start time arrived
      if (document.visibilityState === 'visible') { try { App.checkAutoStart(); } catch (e2) {} }
    });

    renderOnbStep();
    // v21: if already onboarded, go straight to main — don't show login at all.
    // Firebase session restores in background via onAuthStateChanged.
    if (store.get('onboarded', false)) {
      try { App.onAuth(null); } catch (e) {}
      try { App.showView('main'); } catch (e2) {}
    } else {
    // auth comes first; after sign-in, afterAuth() routes to onboarding or main
    App.showView('auth');
    // if already signed in (returning user), firebase onAuthStateChanged fires -> route there
    // v14: keep polling for the restored session instead of giving up after 2.5s
    // (slow networks need longer; giving up strands signed-in users on the login screen)
    var _authRouted = false, _authWaitMs = 0;
    function routeReturningUser() {
      if (_authRouted) return;
      if (window.FB && FB.user) { _authRouted = true; afterAuth(); return; }
      _authWaitMs += 500;
      if (_authWaitMs < 15000) setTimeout(routeReturningUser, 500);
      else {
        _authRouted = true;
        // v20: local-mode returning user — if previously onboarded, go to main
        // instead of stranding on sign-in (no Firebase session to restore)
        if (store.get('onboarded', false)) {
          try { App.onAuth(null); } catch (e) {}
          try { App.showView('main'); } catch (e2) {}
        }
      }
    }
    function watchAuthState() {
      if (window.FB && FB.auth) {
        FB.auth.onAuthStateChanged(function () { setTimeout(routeReturningUser, 300); });
      } else {
        setTimeout(watchAuthState, 500); // Firebase not ready yet; retry
      }
    }
    watchAuthState();
    setTimeout(routeReturningUser, 500);
    } // end v21 else (not onboarded)

    /* splash: fade out once the first view is up */
    window.__appReady = true;
    setTimeout(function () {
      var s = document.getElementById('splash');
      if (s) { s.classList.add('hide'); setTimeout(function () { s.style.display = 'none'; }, 650); }
    }, 400);

    // foreground FCM messages
    if (window.FB && FB.messaging) {
      try {
        FB.messaging.onMessage(function (p) {
          var t = (p.notification && p.notification.title) || 'Meticulous';
          var b = (p.notification && p.notification.body) || '';
          FB.localNotify(t, b);
        });
      } catch (e) {}
    }
  }

  App._store = store; App._esc = esc; App._today = todayStr; App._fmtClock = fmtClock;
  App._wirePhotoOCR = onbWirePhoto; // v31: reused by Preferences for odometer/safety retakes
  App._parseOdometerReading = parseOdometerReading; // v39: reused by Fuel odometer photo
  App._masterOdometer = masterOdometer; // v39: the single master odometer (mt_odo)
  App._bumpOdometer = bumpOdometer; // v39: upward-only master write for every capture point
  try { if (window.CloudSync) CloudSync.attach(store); } catch (e) {} // v27: Firestore mirror
  /* v30 OTA: wait for the over-the-air updater before booting. OTA.ready()
     resolves when it is safe to start (update applied or not needed / offline).
     If js/ota.js failed to load, window.OTA is undefined and we boot at once. */
  function __bootApp() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
  try {
    if (window.OTA && OTA.ready) OTA.ready().then(__bootApp, __bootApp);
    else __bootApp();
  } catch (e) { __bootApp(); }
})();
