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
    /* v48: set/del REPORT success (true) or failure (false) — a failed
       write (e.g. storage full) used to be silently swallowed, making a
       lost save look exactly like a good one. Returning a boolean is
       backward-compatible: existing callers ignore it. */
    set: function (k, v) { try { localStorage.setItem('mt_' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem('mt_' + k); return true; } catch (e) { return false; } }
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

  /* v60: Android system back button (Capacitor native app). Root cause of
     "back closes the app": this SPA swaps views without ever pushing
     WebView history, so the OS back has no history to walk and the
     activity finishes. The v18 handler made it deterministic — it only
     knew the top-level view (App.currentView) and called exitApp() for
     EVERY back press inside 'main', even with a module or a sheet open,
     because modules/sheets swap inside #main without touching
     currentView. The in-app back arrow worked because it calls
     App.showDashboard() directly. The shell needs no change: @capacitor/app
     is registered in the shell (capacitor.plugins.json) and its
     backButton events ARE delivered to OTA pages (same bridge the
     Filesystem/BackgroundGeolocation plugins already use from OTA code).
     The fix mirrors the app's own navigation, innermost layer first:
       open sheet -> close it (same closers as each sheet's Cancel)
       sidebar open -> close it
       module open -> back to dashboard (App.showDashboard)
       onboarding -> previous step (same as the in-app Back button),
                     or auth from step 0 (v25: never strand the user)
       dashboard root / auth -> exitApp() (the default exit; one press,
                     never a trap)
     Navigation ONLY: no branch touches the tracker, so a back press can
     never start/stop/pause a live session (closing the end-time sheet is
     its Cancel — the session keeps running). In a plain browser / iPhone
     install there is no Capacitor bridge, wireSystemBack returns false,
     and behavior is byte-identical to before. */
  /* SYS-BACK-BEGIN — harness-extractable (tools/back-button-test.js).
     Pure decision + listener registration; every DOM read/write lives in
     the fx object the app passes in below. */
  App.navBackStep = function (s) {
    s = s || {};
    if (s.sheet) return { act: 'sheet', sheet: s.sheet };
    if (s.sidebar) return { act: 'sidebar' };
    if (s.view === 'onboarding') {
      return (s.onbStep || 0) > 0 ? { act: 'onb-prev' } : { act: 'onb-auth' };
    }
    if (s.view === 'main' && s.module) return { act: 'module' };
    return { act: 'exit' };
  };
  App.wireSystemBack = function (Cap, fx) {
    if (!Cap || !Cap.Plugins || !Cap.Plugins.App ||
        typeof Cap.Plugins.App.addListener !== 'function') return false;
    Cap.Plugins.App.addListener('backButton', function () {
      try { fx.perform(App.navBackStep(fx.snapshot())); } catch (e) {}
    });
    return true;
  };
  /* SYS-BACK-END */
  (function () {
    try {
      var Cap = window.Capacitor;
      App.wireSystemBack(Cap, {
        snapshot: function () {
          var sheet = null;
          ['trkStartSheet', 'trkEndSheet', 'odoSheet', 'loadSheet', 'fbSheet'].forEach(function (id) {
            if (sheet) return;
            var n = el(id);
            if (n && n.classList.contains('open')) sheet = id;
          });
          var sb = el('sidebar');
          var mv = el('modView');
          return {
            view: App.currentView || 'auth',
            onbStep: App.onbStep || 0,
            sheet: sheet,
            sidebar: !!(sb && sb.classList.contains('open')),
            module: !!(mv && !mv.classList.contains('hidden'))
          };
        },
        perform: function (a) {
          if (!a) return;
          if (a.act === 'sheet') {
            if (a.sheet === 'trkStartSheet') closeTrackerStartSheet();
            else if (a.sheet === 'trkEndSheet') closeTrackerEndSheet();
            else if (a.sheet === 'odoSheet') closeOdoSheet();
            else if (a.sheet === 'loadSheet') closeLoadSheet();
            else if (a.sheet === 'fbSheet') {
              el('fbSheet').classList.remove('open');
              el('scrim').classList.remove('show');
              el('scrim').onclick = closeSidebar;
            }
          } else if (a.act === 'sidebar') {
            closeSidebar();
          } else if (a.act === 'module') {
            /* v116: a module sub-view unwinds first (App.moduleBack);
               only a module already on its main view exits. */
            if (!App.moduleBack()) App.showDashboard();
          } else if (a.act === 'onb-prev') {
            collectOnbInputs(); // same as the in-app onboarding Back button
            var pv = onbPrevVisible(App.onbStep, App.onb); // v76 (F2): skip role-hidden steps
            if (pv >= 0) App.onbStep = pv;
            renderOnbStep();
          } else if (a.act === 'onb-auth') {
            App.showView('auth');
          } else { // 'exit' — dashboard root or auth: the default exit
            try { Cap.Plugins.App.exitApp(); } catch (e) {}
          }
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
      var APK_VERSION = 35; // <- bump on every native (APK) release
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
    /* v95: the sign-in door in the drawer's account block — visible
       exactly when there is no signed-in user (Local mode), painted by
       this same funnel, so it can never disagree with the account
       lines above it or appear mid-session for a signed-in user. */
    var sbDoor = el('sbSignIn');
    if (sbDoor) sbDoor.classList.toggle('hidden', !!user);
    try { ensureUserRole(); } catch (e) {} // v52: stamp the role default before dashboards build
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
      /* v76 (F9, boss QA Oct 14): the flag still unlocks everything
         (tierAllows reads BETA_MODE itself — display is decoupled from
         the gate), but the "🧪 Beta testing" banner is developer
         wording on the user's face. For OFFICE users (the boss being
         courted as the proving user) the home screen's first line is
         his tools, not our construction notes: banner hidden, tools
         stay unlocked. */
      var bbar = el('trialBar');
      var officeFace = false;
      try { officeFace = (App.userRole && App.userRole() === 'office'); } catch (e) {}
      if (officeFace) {
        bbar.classList.add('hidden');
        bbar.innerHTML = '';
        return;
      }
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
  /* v119 (owner, Oct 16 22:00 MDT: "Why are there 2 modules?
     Navigation and navigator?"): ONE door — Navigator 🧭. The
     Navigation module survives only as the merged module's
     places component (its file still loads; the Navigator's
     front face renders it). No card, no drawer entry, no meta. */
  var MODULE_ORDER = ['revenue', 'dispatch', 'navigator', 'fuel', 'pnl', 'maintenance', 'damage', 'manifest', 'invoice', 'connect'];
  var MODULE_META = {
    revenue:    { title: 'Revenue',           icon: '📊', tier: 'basic' },
    dispatch:   { title: 'Dispatch',          icon: '📋', tier: 'basic' },
    navigator:  { title: 'Navigator',         icon: '🧭', tier: 'basic' },
    fuel:       { title: 'Fuel & Expense',    icon: '⛽', tier: 'basic' },
    pnl:        { title: 'P&L',               icon: '📈', tier: 'basic' },
    maintenance:{ title: 'Maintenance',       icon: '🔧', tier: 'basic' },
    damage:     { title: 'Damage & Incident', icon: '📸', tier: 'basic' },
    manifest:   { title: 'Manifest / Daily Log', icon: '📝', tier: 'pro' },
    invoice:    { title: 'Invoice',           icon: '🧾', tier: 'pro' },
    connect:    { title: 'Connect',           icon: '🤝', tier: 'premium' }
    // v36: 'autostart' registry entry removed — settings moved into Revenue (Asjad); modules/autostart.js is now a shared card library + pointer stub
  };

  /* ---------------- v52: user role — the PERSON, not the account ----------------
     Onboarding's last question: "Do you drive a truck yourself?" Stored as
     onboarding.userRole: 'driver' (drives only) / 'both' (drives + office) /
     'office' (office only, never drives). Deliberately separate from
     accountType (business entitlements): it tunes the home dashboard and
     decides whose pay the travel bonus is (audit Oct 14: the bonus is the
     DRIVER's income; payer-side books owe it as a wage cost).
     ================= ROLE-BEGIN =================
     Harness-extractable: functions in this region use only `store` + pure JS. */
  var USER_ROLES = ['driver', 'both', 'office'];
  var USER_ROLE_DEFAULTS = { 'Driver': 'driver', 'Owner-Operator': 'both', 'Fleet Manager': 'office' };
  var ROLE_MODULE_ORDER = {
    driver: ['revenue', 'dispatch', 'fuel', 'maintenance', 'manifest', 'navigator', 'damage', 'pnl', 'invoice', 'connect'],
    /* v76 (F4, boss QA Oct 14): the office home leads with the boss's
       five tools IN BLUEPRINT ORDER — Connect first (his #1: his
       connection to his drivers), then Dispatch, Invoice, Maintenance,
       P&L. Everything else follows; nothing is removed. */
    office: ['connect', 'dispatch', 'invoice', 'maintenance', 'pnl', 'manifest', 'revenue', 'fuel', 'damage', 'navigator'],
    both: ['revenue', 'dispatch', 'navigator', 'fuel', 'pnl', 'maintenance', 'damage', 'manifest', 'invoice', 'connect']
  };
  /* Sidebar lead-ins: items named here come first (in this order); every
     other sidebar item keeps its current place after them. Nothing is
     removed — tuning is emphasis only. */
  var ROLE_SIDEBAR_LEAD = {
    driver: ['dashboard', 'revenue', 'dispatch', 'navigator', 'fuel', 'maintenance', 'damage', 'manifest'],
    office: ['dashboard', 'connect', 'dispatch', 'invoice', 'maintenance', 'pnl'],
    both: ['dashboard']
  };
  function roleDefaultFor(accountType) { return USER_ROLE_DEFAULTS[accountType] || 'driver'; }
  function isUserRole(v) { return USER_ROLES.indexOf(v) >= 0; }
  function roleAnswered(o) { return isUserRole(o && o.userRole); }
  function resolveUserRole(o) {
    o = o || {};
    return isUserRole(o.userRole) ? o.userRole : roleDefaultFor(o.accountType);
  }
  /* v76 (F1, boss QA Oct 14): the PROVISIONAL role — what an UNANSWERED
     "Do you drive?" means until the person answers. 'both' is a DRIVER
     face (tracker card up front, road order): stamping or resolving it
     on a guess put the giant START tracker on the boss's first screen
     when he tapped Next through setup, because Owner-Operator defaults
     to 'both'. An unanswered question now holds the SAFE face —
     'office' (no tracker, office order) — and stamps NOTHING, so the
     question stays genuinely unanswered until he picks (onboarding
     now requires the pick; Preferences can change it any time). The
     driver/office accountType defaults are safe faces and keep their
     old migration behaviour; an answered pick is never overridden. */
  function provisionalRole(o) {
    o = o || {};
    if (isUserRole(o.userRole)) return o.userRole;
    var d = roleDefaultFor(o.accountType);
    return d === 'both' ? 'office' : d;
  }
  /* One-time, idempotent migration: stamp the accountType-derived default
     when no valid userRole is stored — EXCEPT 'both', which is never
     stamped on an unanswered user (see provisionalRole above). A value
     the user picked is never overwritten. */
  function ensureUserRole() {
    var o = store.get('onboarding', {}) || {};
    if (isUserRole(o.userRole)) return o.userRole;
    var d = roleDefaultFor(o.accountType);
    if (d === 'both') return 'office'; // unanswered: hold at the safe face, stamp nothing
    if (o.userRole !== d) { o.userRole = d; store.set('onboarding', o); }
    return d;
  }
  function roleShowsTracker(role) { return role !== 'office'; }
  function roleModuleOrder(role) { return (ROLE_MODULE_ORDER[role] || ROLE_MODULE_ORDER.both).slice(); }
  function roleSidebarOrder(role, items) {
    var lead = ROLE_SIDEBAR_LEAD[role] || [];
    var head = [], tail = [];
    items.forEach(function (it) {
      if (lead.indexOf(it[0]) >= 0) head.push(it); else tail.push(it);
    });
    head.sort(function (a, b) { return lead.indexOf(a[0]) - lead.indexOf(b[0]); });
    return head.concat(tail);
  }
  App.userRole = function () { return provisionalRole(store.get('onboarding', {}) || {}); };
  /* ================= ROLE-END ================= */

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

  /* v116 (owner, Oct 16, 2026 21:38 MDT): "Where I park" is NOT
     wired here anymore. The v107 re-home put the settings card on
     the dashboard under the tracker; the owner overruled it over
     his own screenshot ("Why is this asking me right, right on
     the face? It's supposed to ask in the preferences."). The
     card + its wiring now live in Preferences → Settings
     (modules/preferences.js) — same ParkPlace engine, same store
     keys, same words. The home face carries the tracker and the
     module cards only. */

  function buildDashboard() {
    var g = el('modGrid');
    var html = '';
    /* v52: role tuning — office users get NO tracker card on home and an
       office-led module order; drivers keep the tracker front and center
       with road modules leading; 'both' is the dashboard as it was.
       Tuning only reorders/hides the tracker card — it never removes a
       module the user's tier + accountType entitle them to. */
    var role = App.userRole();
    var tc = el('trkCard');
    if (tc) tc.style.display = roleShowsTracker(role) ? '' : 'none';
    roleModuleOrder(role).forEach(function (key) {
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
    ['navigator', '🧭', 'Navigator'],
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
    /* v106: Account & login — the Security / change-password screen
       that left Preferences (owner: "Give login its own page!").
       Quiet placement near the bottom of the menu: it is a
       rarely-used plumbing destination, not a feature card, so it
       gets NO dashboard card (not in MODULE_META / role orders). */
    ['account', '🔑', 'Account & login'],
    ['feedback', '💬', 'Feedback'],
    ['logout', '🚪', 'Logout']
  ];

  function buildSidebar() {
    var nav = el('sbNav');
    var html = '';
    roleSidebarOrder(App.userRole(), SIDEBAR_ITEMS).forEach(function (it) {
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

  /* v77: modules with live resources (the Navigator's GPS watch, map
     and speech) expose teardown(); leaving a module — to the dashboard
     or to another module — runs the OUTGOING module's teardown first.
     Modules without teardown are untouched. */
  function teardownModule() {
    try {
      var prev = App._modKey && Meticulous.modules[App._modKey];
      if (prev && prev.teardown) prev.teardown();
    } catch (e) {}
    App._modKey = null;
  }

  App.showDashboard = function () {
    teardownModule();
    el('dashView').classList.remove('hidden');
    el('modView').classList.add('hidden');
    buildDashboard();
  };

  /* v116 (owner recording, Oct 16 2026): Back from a module
     SUB-VIEW kicked him straight out to the dashboard, and
     re-entering the module landed back on the stale sub-view —
     the sub-view was acting as the module's root. Two shell rules
     now: (1) a back press first offers the open module its own
     sub-view via mod.back() — true means "handled, stay here"
     (the module returned to its MAIN view); false/absent falls
     through to the dashboard as before. (2) EVERY fresh entry
     (dashboard card, drawer, programmatic) calls mod.resetView()
     before render, so a module always opens on its main view,
     never a remembered detail page. Internal re-renders call
     mod.render() directly and never pass through openModule, so
     a module's own navigation is untouched. */
  App.moduleBack = function () {
    try {
      var m = App._modKey && Meticulous.modules[App._modKey];
      if (m && typeof m.back === 'function') return !!m.back();
    } catch (e) {}
    return false;
  };

  App.openModule = function (key) {
    /* v119: the retired 'navigation' door routes into the merged
       Navigator — on its front (places) face, which is where the
       Navigator's resetView lands it. */
    if (key === 'navigation') key = 'navigator';
    var meta = MODULE_META[key];
    var special = { reminders: 1, preferences: 1, subscription: 1, account: 1 };
    /* P&L + Maintenance gates removed Oct 13, 2026 — Asjad (Driver) gets full access. */
    if (meta && !App.tierAllows(meta.tier)) {
      // locked -> go to subscription
      key = 'subscription';
    }
    var mod = Meticulous.modules[key];
    if (!mod) return;
    if (App._modKey !== key) teardownModule();
    App._modKey = key;
    el('dashView').classList.add('hidden');
    el('modView').classList.remove('hidden');
    var title = meta ? meta.title : ({ reminders: 'Reminders', preferences: 'Preferences', subscription: 'Subscription', account: 'Account & login' }[key] || key);
    el('modTitle').textContent = title;
    var body = el('modBody');
    body.innerHTML = '';
    /* v116: fresh entry always lands on the module's main view. */
    try { if (mod.resetView) mod.resetView(); } catch (e) {}
    try { mod.render(body); } catch (e) { body.innerHTML = '<div class="empty">Could not load module.</div>'; console.error(e); }
    paintPowerBanner(body);
    window.scrollTo(0, 0);
  };

  /* v59: a queued power read may have finished while this screen was
     closed. Plain banner at the top of whatever module opens next —
     it only POINTS at the result; the owning screen still confirms
     before anything is saved. "Got it" just hides the banner. */
  function paintPowerBanner(body) {
    try {
      if (!window.PowerRead || !body || !body.insertBefore) return;
      var rs = PowerRead.pendingResults().filter(function (r) { return !r.seen; });
      if (!rs.length) return;
      var r = rs[rs.length - 1];
      var desc = PowerRead.describeResult(r);
      var d = document.createElement('div');
      d.className = 'card';
      d.style.cssText = 'border:2px solid #f5a623;background:#fff8e6';
      d.innerHTML = '<b>⚡ Power read finished:</b> ' + esc(desc.text) +
        '<br><span style="color:#555">Open ' + esc(desc.moduleLabel) + ' to check it — nothing was saved yet.</span> ' +
        '<button type="button" class="btn small ghost" id="prBannerOk">Got it</button>';
      body.insertBefore(d, body.firstChild);
      var b = d.querySelector('#prBannerOk');
      if (b) b.onclick = function () { try { PowerRead.markAllSeen(); } catch (e) {} if (d.parentNode) d.parentNode.removeChild(d); };
    } catch (e) {}
  }

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

  /* DYN-TRACKER-BEGIN — the dynamic tracker (v41, Asjad: "a very key
     feature"). The big home-screen tracker tracks a different quantity
     per pay method (onboarding.payStandard):
       Hourly -> a timer (unchanged) · Miles -> a live-miles dial ·
       Weight -> accumulated NET weight · Trip -> a simple load counter.
     Same start/pause/stop for all; elapsed time always records
     underneath. Decision + bookkeeping only (DOM glue is paintHero
     below). Harness-extractable: may use `store`, `App.tracker`,
     `fmtClock`, `trackerSave`, and window.LiveMiles (guarded). */
  function payMode() {
    var o = store.get('onboarding', {});
    var s = String((o && o.payStandard) || 'Hourly').toLowerCase();
    if (s === 'miles') return 'Miles';
    if (s === 'weight') return 'Weight';
    if (s === 'trip') return 'Trip';
    return 'Hourly';
  }
  function round2(n) { return Math.round(n * 100) / 100; }
  var LBS_PER_KG = 2.2046;
  function kgFromUnit(v, unit) {
    v = parseFloat(v) || 0;
    if (unit === 't') return v * 1000;
    if (unit === 'lbs') return v / LBS_PER_KG;
    return v; // kg
  }
  function withCommas(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  /* Display formatting for a kg quantity in the chosen unit. */
  function fmtWeightKg(kg, unit) {
    kg = parseFloat(kg) || 0;
    if (unit === 'lbs') return { text: withCommas(Math.round(kg * LBS_PER_KG)), unit: 'lbs' };
    if (unit === 't') return { text: String(Math.round(kg / 10) / 100), unit: 't' };
    return { text: withCommas(Math.round(kg)), unit: 'kg' };
  }
  /* Weight display unit: 't' | 'kg' | 'lbs', chosen by tapping the unit
     on the tracker hero; persisted as a preference (store key). */
  function weightUnit() {
    var u = store.get('weightUnit', 't');
    return (u === 't' || u === 'kg' || u === 'lbs') ? u : 't';
  }
  function cycleWeightUnit() {
    var order = ['t', 'kg', 'lbs'];
    var n = order[(order.indexOf(weightUnit()) + 1) % order.length];
    store.set('weightUnit', n);
    return n;
  }
  function sessionActive() {
    return !!(App.tracker && App.tracker.status && App.tracker.status !== 'idle');
  }
  /* Session-scoped accumulators, persisted on the tracker state (so a
     relaunch mid-shift keeps the day). Fresh at every fresh start. */
  function trkAccum() {
    var t = App.tracker;
    if (!t.accum || typeof t.accum !== 'object') t.accum = { weightKg: 0, loadCount: 0, tripCount: 0, manualLoads: 0 };
    if (typeof t.accum.weightKg !== 'number') t.accum.weightKg = 0;
    if (typeof t.accum.loadCount !== 'number') t.accum.loadCount = 0;
    if (typeof t.accum.tripCount !== 'number') t.accum.tripCount = 0;
    if (typeof t.accum.manualLoads !== 'number') t.accum.manualLoads = 0;
    return t.accum;
  }
  function resetAccum() {
    App.tracker.accum = { weightKg: 0, loadCount: 0, tripCount: 0, manualLoads: 0 };
  }
  /* v82 (item 3b): the one-tap load counter for hourly card work.
     The AECON haul card carries NO load count (one card = the whole
     day) and the GPS counter can only run when both site pins exist
     — the dump site is given out loud on site — so before this the
     manifest's Loads could only ever be 0/absent. One tap per load
     dumped, counted on the session accumulator; the close flow
     pre-fills its Loads field from this count for his confirm, and
     the stopped session carries it (manualLoads) to the manifest. */
  function trackerAddLoadTap() {
    if (!sessionActive()) return null;
    var a = trkAccum();
    a.manualLoads += 1;
    trackerSave();
    return a;
  }
  /* Manual "+ Add load" (Weight mode): weight entered in t/kg/lbs,
     stored as kg. Allowed whenever the session is active (running OR
     paused) — never when idle/stopped. Returns the accumulator, or
     null when refused. */
  function trackerAddLoad(weight, unit) {
    if (!sessionActive()) return null;
    var kg = kgFromUnit(weight, unit);
    if (!(kg > 0)) return null;
    var a = trkAccum();
    a.weightKg = round2(a.weightKg + kg);
    a.loadCount += 1;
    trackerSave();
    return a;
  }
  function trackerAddTrip() {
    if (!sessionActive()) return null;
    var a = trkAccum();
    a.tripCount += 1;
    trackerSave();
    return a;
  }
  /* A dispatch completed while a session is active counts as one trip
     toward the day; its tickets' NET weights (tonnes) join the Weight
     accumulator. info: { netTonnes, weightLoads }. Returns false when
     no session is active (that completion belongs to no tracked day). */
  function noteDispatchCompleted(info) {
    if (!sessionActive()) return false;
    var a = trkAccum();
    a.tripCount += 1;
    var nt = parseFloat(info && info.netTonnes) || 0;
    if (nt > 0) {
      a.weightKg = round2(a.weightKg + nt * 1000);
      a.loadCount += parseInt(info.weightLoads, 10) || 1;
    }
    trackerSave();
    return true;
  }
  /* stopSessionAt: move the accumulated quantities onto the session
     entry — canonical storage is totalWeightKg (kg) + loadCount, and
     tripCount. Fields appear only when something was accumulated. */
  function takeSessionAccum(entry) {
    var a = App.tracker.accum;
    if (!a) return;
    if (a.weightKg > 0) {
      entry.totalWeightKg = round2(a.weightKg);
      entry.loadCount = a.loadCount || 0;
    }
    if (a.tripCount > 0) entry.tripCount = a.tripCount;
    /* v82: the day's tapped load count rides the session to the
       manifest (kept apart from the Weight mode's loadCount). */
    if (a.manualLoads > 0) entry.manualLoads = a.manualLoads;
  }
  function liveKmNow() {
    try { if (window.LiveMiles && LiveMiles.currentKm) return LiveMiles.currentKm(); } catch (e) {}
    return null;
  }
  /* What the hero shows for a session with `sec` elapsed seconds.
     Miles with no live fix: '— km' plus the session's starting-odometer
     anchor when one exists — never a fake 0. */
  function heroModel(sec) {
    var mode = payMode(), t = App.tracker, a = trkAccum();
    var m = { mode: mode, big: fmtClock(sec), unit: null, sub: '', showSub: false };
    if (mode === 'Miles') {
      var live = liveKmNow();
      m.big = (live === null) ? '— km' : (Math.round(live * 10) / 10).toFixed(1) + ' km';
      var parts = ['Elapsed ' + fmtClock(sec)];
      if (t.odoStart && t.odoStart.value) parts.push('Start odo ' + Number(t.odoStart.value).toLocaleString('en-CA') + ' km');
      m.sub = parts.join(' · '); m.showSub = true;
    } else if (mode === 'Weight') {
      var f = fmtWeightKg(a.weightKg, weightUnit());
      m.big = f.text; m.unit = f.unit;
      m.sub = (a.loadCount || 0) + (a.loadCount === 1 ? ' load' : ' loads');
      m.showSub = true;
    } else if (mode === 'Trip') {
      m.big = String(a.tripCount || 0); m.unit = 'loads';
      m.sub = 'Elapsed ' + fmtClock(sec); m.showSub = true;
    }
    return m;
  }
  /* DYN-TRACKER-END */

  var _heroSig = '';
  function paintHero(sec) {
    var clock = el('trkClock');
    if (!clock) return;
    var m = heroModel(sec);
    var html;
    if (m.mode === 'Weight') html = esc(m.big) + ' <span class="trkUnit" id="trkUnitBtn" title="Tap to change unit">' + m.unit + '</span>';
    else if (m.mode === 'Trip') html = esc(m.big) + ' <span class="trkUnitLbl">' + m.unit + '</span>';
    else html = esc(m.big);
    var sig = m.mode + '|' + html + '|' + (m.showSub ? m.sub : '');
    if (sig !== _heroSig) {
      _heroSig = sig;
      clock.innerHTML = html;
      var sub = el('trkSub');
      if (sub) {
        sub.textContent = m.showSub ? m.sub : '';
        sub.classList.toggle('hidden', !m.showSub);
      }
    }
    paintTrackerExtra(m.mode);
  }
  var _extraSig = '';
  function paintTrackerExtra(mode) {
    var box = el('trkExtra');
    if (!box) return;
    /* v82: the load-tap button shows its running count, so the
       count is part of the repaint signature for those modes. */
    var taps = (mode === 'Hourly' || mode === 'Miles') ? trkAccum().manualLoads : 0;
    var sig = mode + '|' + App.tracker.status + '|' + taps;
    if (sig === _extraSig) return;
    _extraSig = sig;
    var h = '';
    if (sessionActive() && mode === 'Weight') h = '<button type="button" class="trkAddBtn" id="trkAddLoadBtn">＋ Add load</button>';
    else if (sessionActive() && mode === 'Trip') h = '<button type="button" class="trkAddBtn" id="trkAddTripBtn">＋ Load</button>';
    /* v82 (item 3b): hourly/miles card work gets the big one-tap
       load counter — one tap per load dumped, no form. */
    else if (sessionActive()) h = '<button type="button" class="trkAddBtn" id="trkLoadTapBtn">🚛 +1 load' + (taps ? ' · ' + taps + ' today' : '') + '</button>';
    box.innerHTML = h;
  }
  /* v41: "+ Add load" sheet (Weight mode) + public tracker APIs for
     Dispatch (completion hook) and the tracker card controls. */
  function closeLoadSheet() {
    var s = el('loadSheet');
    if (s) s.classList.remove('open');
    el('scrim').classList.remove('show');
    el('scrim').onclick = closeSidebar;
  }
  App.openLoadSheet = function () {
    if (!sessionActive()) return;
    var sel = el('ldUnit'); if (sel) sel.value = weightUnit();
    var inp = el('ldWeight'); if (inp) inp.value = '';
    el('loadSheet').classList.add('open');
    el('scrim').classList.add('show');
    el('scrim').onclick = function () { closeLoadSheet(); };
  };
  App.loadSheetSave = function () {
    var w = parseFloat(el('ldWeight').value);
    if (!(w > 0)) { alert('Enter the load weight.'); return; }
    App.trackerAddLoad(w, el('ldUnit').value);
    closeLoadSheet();
  };
  App.loadSheetCancel = function () { closeLoadSheet(); };
  App.trackerAddLoad = function (w, u) { var a = trackerAddLoad(w, u); trackerTick(); return a; };
  App.trackerAddTrip = function () { var a = trackerAddTrip(); trackerTick(); return a; };
  App.trackerAddLoadTap = function () { var a = trackerAddLoadTap(); trackerTick(); return a; };
  App.trackerLoadTaps = function () { return sessionActive() ? trkAccum().manualLoads : 0; };
  App.noteDispatchCompleted = function (info) { var okd = noteDispatchCompleted(info); trackerTick(); return okd; };

  function trackerTick() {
    var t = App.tracker, sec = t.elapsed;
    if (t.status === 'running') sec += Math.floor((Date.now() - t.startTs) / 1000);
    // v41: the hero quantity depends on the pay method (dynamic tracker);
    // for Hourly this renders exactly the same clock as before.
    paintHero(sec);
    // v40: keep the "Miles (live)" dashboard line current
    try { if (window.LiveMiles) LiveMiles.paint(); } catch (e) {}
    // v41: in Miles mode the dial IS the miles display — the small
    // live-miles line would only repeat it.
    if (payMode() === 'Miles') { var mm = el('trkMiles'); if (mm) mm.classList.add('hidden'); }
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
  /* v69: the session's STABLE record identity, in ms. trackerSessionStartMs()
     above is a DISPLAY value ("Counting from …"): it is re-derived from
     whole-second elapsed on every call, so it jitters by up to a second
     between calls — and walks forward in real time while paused. Keying
     the miles / geofence / native-service records by it meant a
     relaunched app looked its record up under a key that had never
     been written and began at zero (field bug, Oct 14: force-close
     mid-shift -> the timer restored fine but "Miles (live)" came back
     0.0 km; the day's 45.7 km record sat orphaned under the start-tap
     key). sessionId is pinned ONCE when a session starts (manual and
     auto-start paths below), persisted with the tracker, and never
     moves again for that session — a start-time Edit moves the clock,
     not the session. Sessions restored from before v69 pin it lazily
     here on first use. LiveMiles additionally ADOPTS orphaned records
     the old derivation left behind (js/miles.js). */
  function trackerSessionKeyMs() {
    var t = App.tracker;
    if (!t || t.status === 'idle') return trackerSessionStartMs();
    if (!t.sessionId) { t.sessionId = trackerSessionStartMs(); trackerSave(); }
    return t.sessionId;
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
      resetAccum(); // v41: a fresh shift starts with empty weight/trip totals
    }
    else if (t.status === 'running') { t.elapsed += Math.floor((Date.now() - t.startTs) / 1000); t.status = 'paused'; }
    else { t.status = 'running'; t.startTs = Date.now(); }
    trackerSave(); trackerPaint();
    // v40: a fresh shift start also starts live-miles tracking (inert
    // when the build has no live location — js/miles.js).
    // v39: a fresh shift start (not a resume) may prompt for the
    // starting odometer — by-mile pay, or any pay mode with the v46
    // "Daily odometer photos" preference on; non-blocking either way.
    if (wasIdle) {
      // v69: pin the session's stable record identity BEFORE anything
      // keys a record by it (see trackerSessionKeyMs) — pinned to the
      // effective start instant at this moment; it never moves again,
      // even if the driver edits the start clock afterwards.
      t.sessionId = trackerSessionStartMs();
      trackerSave();
      try { if (window.LiveMiles) LiveMiles.startDay('s' + trackerSessionKeyMs()); } catch (e) {}
      // v50: geofence load counting rides the same session (js/geoloads.js)
      try { if (window.GeoLoads) GeoLoads.startDay('s' + trackerSessionKeyMs()); } catch (e) {}
      // v63: native background tracking (new shell only) rides it too
      try { if (window.ShiftTrack) ShiftTrack.sessionStarted('s' + trackerSessionKeyMs()); } catch (e) {}
      // v92: today is underway — the native arm now belongs to the NEXT day
      try { App.armNativeDay(); } catch (e) {}
      try { maybePromptOdo('start'); } catch (e) {}
    }
    // v62: the screen wake lock follows the session state — a pause
    // releases the hold, a resume takes it back (js/miles.js owns it).
    try { if (window.LiveMiles && LiveMiles.syncWake) LiveMiles.syncWake(); } catch (e) {}
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
  function stopSessionAt(endMs, endOdoVal) {
    var sec = trackedSecondsAt(endMs);
    // v40: close out live-miles tracking first (watcher off, final
    // crumb + total persisted) so the finished entry can carry the day.
    var milesFin = null;
    try { if (window.LiveMiles) milesFin = LiveMiles.stopDay(); } catch (e) {}
    try { if (window.GeoLoads) GeoLoads.stopDay(); } catch (e) {}
    // v63: native background tracking — final crumb drain + service stop
    try { if (window.ShiftTrack) ShiftTrack.sessionStopped(milesFin && milesFin.key); } catch (e) {}
    // v92: with today closed, arm tomorrow natively — the evening a
    // dispatch lands is exactly when tomorrow's plan becomes known.
    try { App.armNativeDay(); } catch (e) {}
    if (sec > 0) {
      var sessions = store.get('sessions', []);
      var entry = { date: todayStr(new Date(endMs)), seconds: sec, endedAt: new Date(endMs).toISOString() };
      // v39: carry the by-mile starting-odometer reading (captured at
      // shift start, pending on the tracker) onto the day's session.
      var pendingStart = takePendingStartOdo(todayStr(new Date(trackerSessionStartMs())));
      if (pendingStart) entry.startOdo = pendingStart;
      // End-sheet odometer: a closing reading handed in with the stop
      // (typed or snapped on the End shift sheet) lands on the entry
      // being saved — every pay mode, no start reading required. Runs
      // before the reconcile below and before the entry is handed to
      // FB.saveDoc / Revenue, so every consumer sees the whole entry.
      applyEndOdoToEntry(entry, endOdoVal);
      // v40: live miles for the day (only when fixes actually flowed —
      // no field at all when location was unavailable; never a fake 0).
      if (milesFin && typeof milesFin.liveKm === 'number') {
        entry.liveKm = milesFin.liveKm;
        entry.milesKey = milesFin.key;
      }
      // v41: the dynamic tracker's accumulated quantities for the day
      // (Weight: totalWeightKg + loadCount; Trip: tripCount).
      takeSessionAccum(entry);
      sessions.push(entry); store.set('sessions', sessions);
      // v40: both odometer readings already on the entry -> reconcile
      // now (the usual path reconciles when the end reading lands via
      // applyOdoReading, since the end prompt follows the stop).
      try { if (window.LiveMiles && LiveMiles.reconcileSession(entry)) store.set('sessions', sessions); } catch (e) {}
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
  /* v82: a USER-initiated completion of the active dispatch closes
     the shift with it (owner, Oct 15: "Closed dispatch was suppose
     to close my shift!"). Dispatch calls this ONLY from its two
     completion taps (plain Complete, close-with-ticket Confirm) —
     both complete the ACTIVE dispatch by construction. This is the
     only dispatch-driven stop there is: the dispatch END TIME /
     window passing never stops a session (Oct 14 law — a session
     ends when the driver stops it, and this stop IS the driver
     stopping it, by closing his dispatch). Goes through the same
     stopSessionAt as the tracker's own Stop, so the saved session
     is identical either way (live miles, accumulated loads/weight,
     odometer prompt). Returns true when a session was stopped. */
  App.stopSessionOnDispatchClose = function () {
    if (!sessionActive()) return false;
    stopSessionAt(Date.now());
    return true;
  };
  function closeTrackerEndSheet() {
    el('trkEndSheet').classList.remove('open');
    el('scrim').classList.remove('show');
    el('scrim').onclick = closeSidebar;
  }
  App.trackerStopPrompt = function () {
    // v63: fold the native service's latest breadcrumbs while the
    // end-time sheet is open, so the saved entry carries them.
    try { if (window.ShiftTrack) ShiftTrack.drainNow(); } catch (e) {}
    var now = new Date();
    el('trkEndTime').value = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
    // The end-odometer field starts blank every time the sheet opens:
    // yesterday's reading must never ride into today's close, and any
    // photo read still in flight from a previous open is disowned.
    _endOdoToken++;
    var eoIn = el('trkEndOdo'); if (eoIn) eoIn.value = '';
    var eoSt = el('trkEndOdoStatus'); if (eoSt) eoSt.innerHTML = '';
    // Owner refinement (Oct 14): the sheet leads with the APP'S OWN
    // count for the shift — closing the day is never the extra job of
    // snapping the odometer. The counted line shows only when the app
    // actually counted something; the dash snap below stays an
    // optional override for drivers who want the dash's word instead.
    var ecEl = el('trkEndCounted');
    if (ecEl) {
      var cKm = null;
      try { if (window.LiveMiles && LiveMiles.currentKm) cKm = LiveMiles.currentKm(); } catch (e) {}
      if (typeof cKm === 'number' && cKm > 0) {
        ecEl.textContent = 'The app counted ' + (Math.round(cKm * 10) / 10).toLocaleString('en-CA') + ' km today.';
        ecEl.style.display = 'block';
      } else { ecEl.textContent = ''; ecEl.style.display = 'none'; }
    }
    el('trkEndSheet').classList.add('open');
    el('scrim').classList.add('show');
    el('scrim').onclick = function () { closeTrackerEndSheet(); };
  };
  App.trackerSaveEnd = function () {
    var v = el('trkEndTime').value; // "HH:MM"
    // Optional end-odometer value from this sheet (typed or snapped).
    // Blank = skipped — the stop saves exactly as it always has.
    var eoEl = el('trkEndOdo');
    var endOdoVal = eoEl ? eoEl.value : '';
    if (!v) { closeTrackerEndSheet(); stopSessionAt(Date.now(), endOdoVal); return; }
    var parts = v.split(':'), startMs = trackerSessionStartMs(), sd = new Date(startMs);
    var end = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate(),
      parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
    if (end.getTime() <= startMs) end = new Date(end.getTime() + 24 * 3600 * 1000); // overnight shift
    if (end.getTime() > Date.now()) end = new Date(); // can't end in the future
    var secs = trackedSecondsAt(end.getTime());
    if (secs <= 0) { alert('That end time is not after the start. Check the times and try again.'); return; }
    if (secs > 12 * 3600 && !confirm('That makes a ' + fmtClock(secs) + ' shift. Is that right?')) { return; }
    closeTrackerEndSheet();
    stopSessionAt(end.getTime(), endOdoVal);
  };

  /* End-sheet odometer photo: the End shift sheet's own camera/file
     actions — present for EVERY pay mode, unlike the v46 odo prompt
     (by-mile, or the opt-in "Daily odometer photos" preference; that
     sheet stays as-is for its start/end prompts). Same reader
     pipeline as the odo sheet: TicketOCR -> parseOdometerReading ->
     the v63 plausibility gate (a below-master read counts as failed,
     never filled) -> the v59 power-read escalation on a local miss.
     A read only FILLS the editable field — nothing persists until
     "Stop & save", and the field may stay blank. Callbacks re-check
     the token + the sheet is still open, so a late answer never
     hijacks a later close. */
  var _endOdoToken = 0;
  function endOdoLive(token) {
    var s = el('trkEndSheet');
    return token === _endOdoToken && !!(s && s.classList.contains('open'));
  }
  function endOdoSetStatus(html) {
    var st = el('trkEndOdoStatus');
    if (st) st.innerHTML = html;
  }
  function endSheetOdoHandleFile(file) {
    if (!file) return;
    var token = ++_endOdoToken;
    if (!window.TicketOCR || !TicketOCR.fileToOCRImage) {
      endOdoSetStatus('⚠️ Photo reader not ready — type the reading above, or leave it blank.');
      return;
    }
    endOdoSetStatus('📖 Reading photo…');
    TicketOCR.fileToOCRImage(file, function (ocrUrl) {
      if (!endOdoLive(token)) return;
      if (!ocrUrl) { endOdoSetStatus('⚠️ Couldn\'t read the odometer — type it above, or leave it blank.'); return; }
      TicketOCR.recognizeWithRotation(ocrUrl, function (p) {
        try { if (endOdoLive(token)) endOdoSetStatus('📖 Reading photo… ' + Math.round(p * 100) + '%'); } catch (e) {}
      }).then(function (text) {
        if (!endOdoLive(token)) return;
        var km = parseOdometerReading(text);
        if (km && !odoLocalFailed(km)) {
          var inp = el('trkEndOdo');
          if (inp) inp.value = km;
          endOdoSetStatus('✓ Read: <b>' + Number(km).toLocaleString('en-CA') + ' km</b> — check the number, fix it if wrong, then tap Stop & save.');
        } else {
          if (km && odoImplausible(km) === 'jump') endOdoSetStatus('⚠️ That read (<b>' + Number(km).toLocaleString('en-CA') + ' km</b>) is way past your current odometer (<b>' + Number(odoMasterNow()).toLocaleString('en-CA') + ' km</b>) — it can\'t be right; it\'s likely another number in the photo. Trying the power read…');
          else if (km) endOdoSetStatus('⚠️ That read (<b>' + Number(km).toLocaleString('en-CA') + ' km</b>) is below your current odometer (<b>' + Number(odoMasterNow()).toLocaleString('en-CA') + ' km</b>) — it can\'t be right. Trying the power read…');
          else endOdoSetStatus('⚠️ Couldn\'t read the odometer — type it above, or leave it blank.');
          endSheetOdoPowerRead(ocrUrl, token);
        }
      }).catch(function () {
        if (endOdoLive(token)) endOdoSetStatus('⚠️ Couldn\'t read the odometer — type it above, or leave it blank.');
      });
    });
  }
  /* Power-read escalation for the end sheet — mirrors the odo
     sheet's: the cloud value fills this same field, and the sheet's
     Stop & save stays the confirm. A skip (off / no key) is reported
     in the sheet, never silent. */
  function endSheetOdoPowerRead(ocrUrl, token) {
    if (!window.PowerRead || !PowerRead.escalate) return;
    PowerRead.escalate({
      reader: 'odometer', image: ocrUrl, origin: { module: 'tracker', label: 'the end-of-shift sheet' },
      onStatus: function (s) {
        if (!endOdoLive(token)) return;
        if (s.state === 'waiting') endOdoSetStatus('⚡ Power read waiting for signal — the photo is saved and will be read when you\'re back online. You can still type the reading, or leave it blank.');
        else if (s.state === 'unavailable') endOdoSetStatus(s.message + ' Type the reading above, or leave it blank.');
        else if (s.state === 'error') endOdoSetStatus(s.message + ' Type the reading above, or leave it blank.');
      },
      onResult: function (res) {
        if (!endOdoLive(token)) return;
        var v = res.fields && res.fields.value;
        if (!v) { endOdoSetStatus('⚡ Power read couldn\'t read it either — type it above, or leave it blank.'); return; }
        var inp = el('trkEndOdo');
        if (inp) inp.value = v;
        endOdoSetStatus('⚡ Power read: <b>' + Number(v).toLocaleString('en-CA') + ' km</b> — check the number, fix it if wrong, then tap Stop & save.');
      }
    });
  }

  /* ODO-PROMPT-BEGIN — day odometer prompts (v39, generalized v46).
     Decision + record-keeping only (DOM lives in maybePromptOdo below).
     Harness-extractable: may use `store`, `App.tracker`, `todayStr`,
     `trackerSave` and the ODO-MASTER helpers.
     Rules (Asjad, Oct 13 + Oct 14): pay mode is onboarding.payStandard;
     'Miles' means by-mile. By-mile days prompt once at shift start and
     once at stop, always. Hourly/trip/weight prompt ONLY when the
     Preferences toggle onboarding.odoDailyPhotos ("Daily odometer
     photos", default OFF) is on — drivers who still want a per-day
     miles record like the old hour sheet's start-odo column. The prompt
     is non-blocking — the timer runs regardless — and shows at most
     once per day per kind. Readings live on the day's session entry
     (startOdo/endOdo); while a shift is running the start reading waits
     on the tracker state. */
  function isByMile() {
    var o = store.get('onboarding', {});
    return String((o && o.payStandard) || '').toLowerCase() === 'miles';
  }
  function odoDailyPhotosOn() {
    var o = store.get('onboarding', {});
    return !!(o && o.odoDailyPhotos);
  }
  /* v46: the day's kilometres from a session's odometer pair, or null.
     Both readings stay on the record either way; a closing reading at
     or below the start (misread/typo) yields NO distance rather than a
     negative or zero one. Same rule Revenue's Miles fallback uses. */
  function odoDailyKm(session) {
    if (!session) return null;
    var s = parseFloat(session.startOdo), e = parseFloat(session.endOdo);
    if (!(s > 0) || !(e > s)) return null;
    return Math.round((e - s) * 100) / 100;
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
    if (!isByMile() && !odoDailyPhotosOn()) return false;
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
        // v40: the end reading completes the pair — reconcile live
        // miles against the odometer (Asjad's confirmation rule).
        try { if (window.LiveMiles) LiveMiles.reconcileSession(ss[i]); } catch (e) {}
        store.set('sessions', ss);
        return true;
      }
    }
    return false;
  }
  /* End-of-shift sheet reading (owner, Oct 14: "make sure there is a
     way at the end of the shift to snap a picture of the odo to close
     it"). The End shift sheet asks EVERY driver for the closing
     odometer — typed, or snapped with its camera/file actions — and
     hands the value in WITH the stop, so it lands here, on the entry
     stopSessionAt is saving. Unlike applyOdoReading('end', ...) it
     needs NO start reading first and never creates a session; it only
     completes the one being saved. The master moves upward only, like
     every other capture point; a reading at or below the master still
     stays on the entry (the driver's word for the day) — it just
     cannot drag the master down. Blank/garbage = skipped, returns
     false, entry untouched. */
  function applyEndOdoToEntry(entry, value) {
    var n = parseFloat(value);
    if (!entry || !(n > 0)) return false;
    entry.endOdo = n;
    bumpOdometer(n);
    return true;
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
    // v46: wording follows WHY the prompt is showing — by-mile pay, or
    // the driver's own "Daily odometer photos" preference.
    var byMile = isByMile();
    el('odoSheetNote').textContent = kind === 'start'
      ? (byMile
        ? 'Paid by the mile — snap the dash for your starting reading. Your timer is already running.'
        : 'Daily odometer photos are on — snap the dash for your starting reading, or type it below. Your timer is already running.')
      : (byMile
        ? 'Paid by the mile — snap the dash for your closing reading.'
        : 'Daily odometer photos are on — snap the dash for your closing reading, or type it below.');
    el('odoSheetStatus').innerHTML = '';
    var valIn = el('odoSheetVal');
    if (valIn) valIn.value = '';
    sheet.classList.add('open');
    el('scrim').classList.add('show');
    el('scrim').onclick = function () { closeOdoSheet(); };
    return true;
  }
  App.odoSheetSkip = function () { closeOdoSheet(); };
  /* v46: the reading is confirmed in the sheet before it lands. OCR
     fills the editable field; the driver checks/fixes it and taps Save
     (or just types the reading with no photo at all). Nothing is
     applied — and nothing blocks the shift — until Save, and Skip
     always walks away clean. */
  App.odoSheetSave = function () {
    var st = el('odoSheetStatus');
    var inp = el('odoSheetVal');
    var n = inp ? parseFloat(inp.value) : NaN;
    if (!(_odoPromptKind && n > 0)) {
      if (st) st.innerHTML = 'Type the reading first — or tap Skip.';
      return;
    }
    applyOdoReading(_odoPromptKind, n);
    if (st) st.innerHTML = '✓ Saved: <b>' + Number(n).toLocaleString('en-CA') + ' km</b>';
    setTimeout(closeOdoSheet, 900);
  };
  function odoSheetHandleFile(file) {
    if (!file || !_odoPromptKind) return;
    var kindAtStart = _odoPromptKind;
    var st = el('odoSheetStatus');
    function setStatus(html) { if (st) st.innerHTML = html; }
    if (!window.TicketOCR || !TicketOCR.fileToOCRImage) {
      setStatus('⚠️ Photo reader not ready — type the reading below, or tap Skip.');
      return;
    }
    setStatus('📖 Reading photo…');
    TicketOCR.fileToOCRImage(file, function (ocrUrl) {
      if (!ocrUrl) { setStatus('⚠️ Couldn\'t read the odometer — type it below, or tap Skip.'); return; }
      TicketOCR.recognizeWithRotation(ocrUrl, function (p) {
        try { setStatus('📖 Reading photo… ' + Math.round(p * 100) + '%'); } catch (e) {}
      }).then(function (text) {
        var km = parseOdometerReading(text);
        if (km && !odoLocalFailed(km)) {
          var inp = el('odoSheetVal');
          if (inp) inp.value = km;
          setStatus('✓ Read: <b>' + Number(km).toLocaleString('en-CA') + ' km</b> — check the number, fix it if wrong, then tap Save reading.');
        } else {
          /* v59: local read found nothing → power-read escalation.
             The value fills this same field; the sheet's Save reading
             stays the confirm. v63: an impossible below-master value
             (odoLocalFailed) takes the same path — never filled into
             the sheet — and a skip is reported, never silent. */
          if (km && odoImplausible(km) === 'jump') setStatus('⚠️ That read (<b>' + Number(km).toLocaleString('en-CA') + ' km</b>) is way past your current odometer (<b>' + Number(odoMasterNow()).toLocaleString('en-CA') + ' km</b>) — it can\'t be right; it\'s likely another number in the photo. Trying the power read…');
          else if (km) setStatus('⚠️ That read (<b>' + Number(km).toLocaleString('en-CA') + ' km</b>) is below your current odometer (<b>' + Number(odoMasterNow()).toLocaleString('en-CA') + ' km</b>) — it can\'t be right. Trying the power read…');
          else setStatus('⚠️ Couldn\'t read the odometer — type it below, or tap Skip.');
          odoSheetPowerRead(ocrUrl, kindAtStart);
        }
      }).catch(function () {
        setStatus('⚠️ Couldn\'t read the odometer — type it below, or tap Skip.');
      });
    });
  }
  /* v59: power-read escalation for the day start/end odometer sheet.
     Callbacks re-check the sheet is still on the same prompt before
     touching it — a late answer never hijacks a later prompt. */
  function odoSheetPowerRead(ocrUrl, kindAtStart) {
    if (!window.PowerRead || !PowerRead.escalate) return;
    PowerRead.escalate({
      reader: 'odometer', image: ocrUrl, origin: { module: 'tracker', label: 'the odometer prompt' },
      onStatus: function (s) {
        if (_odoPromptKind !== kindAtStart) return;
        var st = el('odoSheetStatus'); if (!st) return;
        if (s.state === 'waiting') st.innerHTML = '⚡ Power read waiting for signal — the photo is saved and will be read when you\'re back online. You can still type the reading, or tap Skip.';
        else if (s.state === 'unavailable') st.innerHTML = s.message + ' Type the reading below, or tap Skip.';
        else if (s.state === 'error') st.innerHTML = s.message + ' Type the reading below, or tap Skip.';
      },
      onResult: function (res) {
        if (_odoPromptKind !== kindAtStart) return;
        var st = el('odoSheetStatus'); if (!st) return;
        var v = res.fields && res.fields.value;
        if (!v) { st.innerHTML = '⚡ Power read couldn\'t read it either — type it below, or tap Skip.'; return; }
        var inp = el('odoSheetVal');
        if (inp) inp.value = v;
        st.innerHTML = '⚡ Power read: <b>' + Number(v).toLocaleString('en-CA') + ' km</b> — check the number, fix it if wrong, then tap Save reading.';
      }
    });
  }

  /* ---------------- timed auto-start ---------------- */
  // v27: start the tracker by itself at a set time on chosen days.
  // Time-based ONLY — no location/GPS involved. Runs when the app is open
  // (minute check + resume check); if the app was closed, it prompts on next open.
  /* AUTOSTART-ENGINE-BEGIN
     v53: this whole region (prefs -> pure effective-time functions ->
     App.checkAutoStart + the Revenue-card helpers) is harness-extractable
     by design — tools/dispatch-autostart-test.js slices it out verbatim
     and drives it over an in-memory store. Keep it free of DOM access;
     it may use: store, todayStr, App, confirm, resetAccum, trackerSave,
     trackerPaint, maybePromptOdo, trackerSessionStartMs. */
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

  /* ------------- v53: dispatch-driven auto-start -------------
     Asjad (Oct 14, 2026): "whatever the start time says on the Dispatch…
     It should be automatically set as an auto starter" — refined the
     same morning: "Can be changed but as a default dispatch time."
     So TODAY's start time resolves by precedence:
       1. a per-day manual override (autostart_override for today) —
          set from the Revenue card's Change affordance, never edits
          the dispatch or the standing setting;
       2. today's dispatch scheduled time — the DEFAULT (active
          dispatch first in spirit, but the earliest of ALL of today's
          eligible dispatches wins; completed/cancelled records have
          no claim);
       3. the standing Revenue setting (autoStartTime).
     The standing on/off + day-of-week rules still gate WHETHER any
     auto-start happens at all: a dispatch or override changes the
     WHEN, never the WHETHER. Pure functions — the caller passes prefs,
     the dispatch records, the override and today's date string. */
  function autostartParseSched(s) {
    // dispatch records carry a datetime-local string "2026-10-14T08:00"
    if (!s || typeof s !== 'string') return null;
    var m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(s);
    return m ? { date: m[1], time: m[2] + ':' + m[3] } : null;
  }
  function autostartDispatchTimeFor(active, list, today) {
    var best = null, seen = {};
    function consider(d) {
      if (!d || typeof d !== 'object') return;
      if (d.status === 'completed' || d.status === 'cancelled') return;
      if (d.id) { if (seen[d.id]) return; seen[d.id] = 1; }
      var p = autostartParseSched(d.scheduledAt);
      if (!p || p.date !== today) return;
      if (best === null || p.time < best) best = p.time;
    }
    consider(active);
    if (Array.isArray(list)) for (var i = 0; i < list.length; i++) consider(list[i]);
    return best; // 'HH:MM' or null
  }
  function autostartEffective(prefs, active, list, override, today) {
    if (override && override.date === today && typeof override.time === 'string' && /^\d{2}:\d{2}$/.test(override.time)) {
      return { time: override.time, source: 'override' };
    }
    var dt = autostartDispatchTimeFor(active, list, today);
    if (dt) return { time: dt, source: 'dispatch' };
    return { time: prefs.time, source: 'setting' };
  }
  function autostartPlan(prefs, active, list, override, today, dayIdx) {
    if (!prefs.enabled) return { willStart: false, reason: 'off' };
    if (!Array.isArray(prefs.days) || prefs.days.indexOf(dayIdx) === -1) return { willStart: false, reason: 'wrong-day' };
    var eff = autostartEffective(prefs, active, list, override, today);
    return { willStart: true, reason: 'ok', time: eff.time, source: eff.source };
  }
  function autostartTodayMs(today, timeStr) {
    // ms epoch of `today` ('YYYY-MM-DD') at 'HH:MM' local — the anchor a
    // backdated (missed) start counts from.
    var dp = String(today).split('-'), tp = String(timeStr || '00:00').split(':');
    return new Date(+dp[0] || 1970, (+dp[1] || 1) - 1, +dp[2] || 1, +tp[0] || 0, +tp[1] || 0, 0, 0).getTime();
  }

  App.checkAutoStart = function () {
    try {
      /* v52: office users never drive — no tracker auto-start, and (with
         no tracker card on their home screen) no odometer prompts. */
      if (App.userRole && App.userRole() === 'office') return 'office';
      var p = autoStartPrefs();
      var now = new Date();
      var today = todayStr(now);
      /* v53: the effective start for today — override > dispatch >
         standing setting. Recomputed on every check (minute tick, app
         open, resume), so a dispatch saved or changed for today updates
         today's start by itself. The plan's willStart gate is the
         standing on/off + days: 'off' / 'wrong-day' return as before. */
      var plan = autostartPlan(p, store.get('dsp_active', null), store.get('dsp_list', []), store.get('autostart_override', null), today, now.getDay());
      if (!plan.willStart) return plan.reason;
      if (autoStartFired(today)) return 'fired';
      var t = App.tracker || { status: 'idle' };
      if (t.status === 'running') { markAutoStartFired(today); return 'running'; }
      var tp = String(plan.time).split(':');
      var startMins = (+tp[0] || 0) * 60 + (+tp[1] || 0);
      var nowMins = now.getHours() * 60 + now.getMinutes();
      if (nowMins < startMins) return 'not-yet';
      var label = autoStartLabel(plan.time);
      markAutoStartFired(today);
      /* v53: a today-specific time (dispatch or override) ANCHORS the
         session to its scheduled time — the driver was working from
         then; the app just woke up. The standing setting keeps the
         long-standing behavior (count from now). */
      var anchored = plan.source !== 'setting';
      var anchorMs = autostartTodayMs(today, plan.time);
      if (t.status === 'idle' && (nowMins - startMins) <= AUTOSTART_GRACE_MIN) {
        // Within grace window: start by itself, no questions.
        App.tracker.status = 'running';
        App.tracker.startTs = Date.now();
        App.tracker.elapsed = anchored ? Math.max(0, Math.floor((Date.now() - anchorMs) / 1000)) : 0;
        resetAccum(); // v41: fresh auto-started shift, fresh totals
        trackerSave(); trackerPaint();
        // v69: pin the session's stable record identity before the
        // tracking hooks key anything by it (see trackerSessionKeyMs).
        App.tracker.sessionId = trackerSessionStartMs();
        trackerSave();
        autoStartNotify('Tracker auto-started at ' + label +
          (plan.source === 'dispatch' ? ' (from your dispatch)' : plan.source === 'override' ? ' (changed for today)' : ''));
        // v40: an auto-started shift tracks live miles like any other.
        try { if (window.LiveMiles) LiveMiles.startDay('s' + trackerSessionKeyMs()); } catch (e) {}
        try { if (window.GeoLoads) GeoLoads.startDay('s' + trackerSessionKeyMs()); } catch (e) {}
        // v63: native background tracking rides an auto-started shift too
        try { if (window.ShiftTrack) ShiftTrack.sessionStarted('s' + trackerSessionKeyMs()); } catch (e) {}
        // v39: auto-start is a shift start too — same by-mile odometer
        // prompt as the manual play button (non-blocking).
        try { maybePromptOdo('start'); } catch (e) {}
        return 'started';
      }
      // Time passed long ago (app was closed), or tracker was paused mid-shift: ask.
      var srcNote = plan.source === 'dispatch' ? ' from your dispatch' : plan.source === 'override' ? ' (changed for today)' : '';
      var msg = t.status === 'paused'
        ? 'Auto-start time (' + label + srcNote + ') has passed and your tracker is paused. Resume it now?'
        : 'Auto-start time (' + label + srcNote + ') has passed. Start the tracker now?' +
          (anchored ? ' It will count from ' + label + '.' : '');
      if (confirm(msg)) {
        /* v53: an accepted missed start counts from the scheduled time,
           never silently from the tap — the v28 presetStart mechanism
           (trackerToggle applies it) does the backdating. */
        if (anchored && t.status === 'idle') App.tracker.presetStart = anchorMs;
        App.trackerToggle(); // idle -> start fresh; paused -> resume
        return 'prompted-started';
      }
      return 'prompted-declined';
    } catch (e) { return 'error'; }
  };

  /* v53: what will happen today, for the Revenue auto-start card's
     "Today:" line (modules/autostart.js). One read of the same plan
     checkAutoStart runs on, so the card can never promise what the
     engine won't do. */
  App.autostartTodayInfo = function () {
    var p = autoStartPrefs();
    var now = new Date();
    var today = todayStr(now);
    var active = store.get('dsp_active', null);
    var list = store.get('dsp_list', []);
    var override = store.get('autostart_override', null);
    var plan = autostartPlan(p, active, list, override, today, now.getDay());
    var oTime = (override && override.date === today && typeof override.time === 'string' && /^\d{2}:\d{2}$/.test(override.time)) ? override.time : null;
    return {
      enabled: p.enabled,
      dayOk: Array.isArray(p.days) && p.days.indexOf(now.getDay()) !== -1,
      willStart: plan.willStart,
      reason: plan.reason || 'ok',
      time: plan.time || p.time,
      source: plan.source || 'setting',
      label: autoStartLabel(plan.time || p.time),
      settingTime: p.time,
      dispatchTime: autostartDispatchTimeFor(active, list, today),
      overrideTime: oTime
    };
  };
  /* v53: the per-day override behind the card's Change affordance.
     Stored per date in the synced store ({date, time}); the date check
     in autostartEffective means yesterday's override can never leak
     into today. Writing one never touches the dispatch or the standing
     setting. */
  App.setAutostartOverride = function (timeStr) {
    if (typeof timeStr !== 'string' || !/^\d{2}:\d{2}$/.test(timeStr)) return false;
    return store.set('autostart_override', { date: todayStr(new Date()), time: timeStr });
  };
  App.clearAutostartOverride = function () {
    if (store.del) return store.del('autostart_override');
    return store.set('autostart_override', null);
  };
  /* AUTOSTART-ENGINE-END */

  /* v92: ARM THE NEXT WORKDAY NATIVELY (native v35 shell).
     The plan above decides WHEN a session should start; until now
     only this WebView could act on it, so a dead app at 8:00 meant
     the day counted nothing until the driver opened the app — and
     the drive from home before the session was never recorded at
     all. The shell now keeps the schedule itself (ShiftTrack.armDay
     -> a native alarm -> the foreground service): while the app is
     alive we hand it the next planned start, and at the fire time
     it begins recording on its own.
     Fire time = planned start minus a 60-minute lead: the morning's
     drive TO the site is the driver's own kilometres, and 60
     minutes is exactly the pre-session window the miles engine's
     adoption rules (js/miles.js ADOPT_FIRST_SLACK_MS) already
     treat as belonging to the day. The arm's session key is the
     SAME 's<startMs>' an anchored auto-start will pin, so when the
     session later begins (by the alarm's recording, by auto-start,
     or by hand) the day's record is one record.
     Recomputed on boot, on resume, after session start/stop and
     after any plan change (checkAutoStart's callers nudge it);
     the native side treats a repeat of the same arm as a no-op. */
  var ARM_LEAD_MS = 60 * 60 * 1000; // = ADOPT_FIRST_SLACK_MS in js/miles.js
  App.armNativeDay = function () {
    try {
      var ST = window.ShiftTrack;
      if (!ST || typeof ST.armDay !== 'function') return;
      if (App.userRole && App.userRole() === 'office') { ST.disarmDay(); return; }
      var p = autoStartPrefs();
      if (!p.enabled) { ST.disarmDay(); return; }
      var active = store.get('dsp_active', null);
      var list = store.get('dsp_list', []);
      var ov = store.get('autostart_override', null);
      var t = App.tracker || { status: 'idle' };
      var now = new Date();
      var plan = null;
      // Today first — but only while its start is still the next
      // event: no session running yet, and auto-start hasn't
      // already fired (or been declined) for today.
      if (t.status === 'idle') {
        var today = todayStr(now);
        if (!autoStartFired(today)) {
          var plT = autostartPlan(p, active, list, ov, today, now.getDay());
          if (plT.willStart) {
            var msT = autostartTodayMs(today, plT.time);
            plan = { date: today, startMs: msT, key: 's' + msT };
          }
        }
      }
      if (!plan) {
        var tm = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        var tmr = todayStr(tm);
        var plM = autostartPlan(p, active, list, ov, tmr, tm.getDay());
        if (plM.willStart) {
          var msM = autostartTodayMs(tmr, plM.time);
          plan = { date: tmr, startMs: msM, key: 's' + msM };
        }
      }
      if (!plan) { ST.disarmDay(); return; }
      ST.armDay({
        key: plan.key,
        fireMs: plan.startMs - ARM_LEAD_MS,
        startMs: plan.startMs,
        date: plan.date
      });
    } catch (e) {}
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
    /* v52: the second question is about the person holding the phone,
       not the business (owner, Oct 14): it tunes the home screen for the
       road or the office, and decides whose pay travel time belongs to. */
    { key: 'userRole', title: 'Do you drive a truck yourself?', hint: 'Drivers get the tracker and road tools up front; office-only users get dispatches, invoices and paperwork — no tracker in the way. This also decides whether travel time is your income or a wage you pay a driver.',
      type: 'opts', opts: [['driver', '🚛', 'Yes — I drive'], ['both', '🚛🧾', 'I drive and do office work'], ['office', '🧾', 'No — office only']] },
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

  /* v76 (F1/F2, boss QA Oct 14): role-branched, role-gated flow.
     - The "Do you drive?" step must be ANSWERED to advance — Next,
       Skip and Finish all hold at the question while it is unanswered
       (the old flow let an Owner-Operator tap through and silently
       inherit the 'both' driver face; see provisionalRole).
     - An 'office' answer SKIPS the driver homework entirely: park
       place, Truck details, Odometer photo, Safety sticker photo —
       an office-only user never sees them.
     Navigation walks VISIBLE steps only; App.onbStep stays a raw
     ONB_STEPS index and every mover snaps through hidden steps. */
  var ONB_OFFICE_SKIP = ['base', 'truck', 'odometer', 'safety'];
  var _onbRoleNudge = false; // set when a mover is blocked at the role question
  function onbRoleStepIndex() {
    for (var i = 0; i < ONB_STEPS.length; i++) { if (ONB_STEPS[i].key === 'userRole') return i; }
    return -1;
  }
  function onbStepVisible(idx, o) {
    var st = ONB_STEPS[idx];
    if (!st) return false;
    if (o && o.userRole === 'office' && ONB_OFFICE_SKIP.indexOf(st.key) >= 0) return false;
    return true;
  }
  function onbNextVisible(idx, o) {
    for (var j = idx + 1; j < ONB_STEPS.length; j++) { if (onbStepVisible(j, o)) return j; }
    return -1;
  }
  function onbPrevVisible(idx, o) {
    for (var j = idx - 1; j >= 0; j--) { if (onbStepVisible(j, o)) return j; }
    return -1;
  }
  function onbVisibleCount(o) {
    var n = 0;
    for (var j = 0; j < ONB_STEPS.length; j++) { if (onbStepVisible(j, o)) n++; }
    return n;
  }
  function onbVisiblePos(idx, o) {
    var n = 0;
    for (var j = 0; j <= idx && j < ONB_STEPS.length; j++) { if (onbStepVisible(j, o)) n++; }
    return n;
  }
  /* v76 (F8): the company step collects country + province/state for
     EVERY role — Invoice reads onboarding.country / onboarding.province
     (codes, matching its CA_TAX prefill) and until now NOTHING in the
     app ever wrote them, so every fresh user met Invoice's red
     "Set your location first" banner. Canadian provinces are a code
     select; anything else is a plain state/province field. */
  var ONB_CA_PROVINCES = [['AB', 'Alberta'], ['BC', 'British Columbia'], ['MB', 'Manitoba'],
    ['NB', 'New Brunswick'], ['NL', 'Newfoundland and Labrador'], ['NS', 'Nova Scotia'],
    ['NT', 'Northwest Territories'], ['NU', 'Nunavut'], ['ON', 'Ontario'],
    ['PE', 'Prince Edward Island'], ['QC', 'Quebec'], ['SK', 'Saskatchewan'], ['YT', 'Yukon']];
  function onbProvinceCodeForName(name) {
    for (var i = 0; i < ONB_CA_PROVINCES.length; i++) { if (ONB_CA_PROVINCES[i][1] === name) return ONB_CA_PROVINCES[i][0]; }
    return '';
  }
  function onbProvinceNameForCode(code) {
    for (var i = 0; i < ONB_CA_PROVINCES.length; i++) { if (ONB_CA_PROVINCES[i][0] === code) return ONB_CA_PROVINCES[i][1]; }
    return '';
  }

  function optGrid(opts, cur) {
    var h = '<div class="optgrid">';
    opts.forEach(function (o) {
      h += '<div class="opt' + (cur === o[0] ? ' sel' : '') + '" data-v="' + o[0] + '"><span class="e">' + o[1] + '</span>' + o[2] + '</div>';
    });
    return h + '</div>';
  }

  function renderOnbStep() {
    var i = App.onbStep, o = App.onb;
    /* v76 (F2): a step the answered role skips is never landed on —
       snap forward to the next visible step (e.g. a restored session
       parked on Truck details after an 'office' answer). */
    if (!onbStepVisible(i, o)) {
      var snap = onbNextVisible(i, o);
      if (snap >= 0) { App.onbStep = snap; i = snap; }
    }
    var st = ONB_STEPS[i];
    var vCount = onbVisibleCount(o), vPos = onbVisiblePos(i, o);
    el('onbProg').style.width = Math.round((vPos / vCount) * 100) + '%';
    el('onbBack').style.visibility = onbPrevVisible(i, o) < 0 ? 'hidden' : 'visible';
    el('onbNext').textContent = onbNextVisible(i, o) < 0 ? 'Finish' : 'Next';
    var h = '<div class="step on"><h3>Step ' + vPos + ' of ' + vCount + ': ' + st.title + '</h3><p class="hint">' + st.hint + '</p>';
    if (st.type === 'opts') {
      h += optGrid(st.opts, o[st.key]);
      /* v76 (F1): blocked at the role question — say so HERE, at the
         question, in plain words (never a silent no-op). */
      if (st.key === 'userRole' && _onbRoleNudge && !isUserRole(o.userRole)) {
        h += '<p class="hint" id="onb_role_warn" style="color:#b3541e;font-weight:700;margin-top:10px">👆 Pick one to continue — this decides your home screen. You can change it later in Preferences.</p>';
      }
    } else if (st.type === 'pay') {
      h += optGrid([['Miles', '🛣️', 'Miles'], ['Hourly', '⏱️', 'Hourly'], ['Trip', '🔁', 'Trip'], ['Weight', '⚖️', 'Weight']], o.payStandard);
      h += '<label class="f">Rate ($)</label><input id="ob_rate" type="number" inputmode="decimal" placeholder="e.g. 95" value="' + esc(o.payRate || '') + '">';
    } else if (st.type === 'text') {
      h += '<input id="ob_base" placeholder="' + esc(st.ph || '') + '" value="' + esc(o.baseLocation || '') + '">';
    } else if (st.type === 'company') {
      /* v76 (F8): country + province/state — Invoice's tax prefill and
         jurisdiction read these from the onboarding record; asking
         here, once, in context, is what keeps a fresh user's first
         invoice free of the red "Set your location first" banner. */
      var obCountry = o.country || 'Canada';
      var obProv = o.province || onbProvinceCodeForName(o.homeProvince || '');
      h += '<label class="f">Company name</label><input id="ob_cname" value="' + esc(o.companyName || '') + '">' +
        '<label class="f">GST/HST number</label><input id="ob_gst" value="' + esc(o.gst || '') + '" placeholder="e.g. 123456789RT0001">' +
        '<label class="f">Business address</label><input id="ob_caddr" value="' + esc(o.companyAddr || '') + '">' +
        '<label class="f">Contracting company</label><input id="ob_cont" value="' + esc(o.contractingCo || '') + '">' +
        '<label class="f">Country</label><select id="ob_country">' +
        ['Canada', 'United States', 'Other'].map(function (c) {
          return '<option value="' + c + '"' + (obCountry === c ? ' selected' : '') + '>' + c + '</option>';
        }).join('') + '</select>' +
        '<label class="f">Province / state</label>' +
        (obCountry === 'Canada'
          ? '<select id="ob_prov"><option value="">— pick yours —</option>' +
            ONB_CA_PROVINCES.map(function (p) {
              return '<option value="' + p[0] + '"' + (obProv === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
            }).join('') + '</select>'
          : '<input id="ob_prov" value="' + esc(o.province || '') + '" placeholder="e.g. Texas">') +
        '<p class="note">Sets the tax rate on your invoices — the app will not guess your location.</p>';
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
        '<div class="kv"><span>Location</span><b>' + esc(o.country ? (o.country + (o.province ? ' / ' + (onbProvinceNameForCode(o.province) || o.province) : '')) : '—') + '</b></div>' +
        '<div class="kv"><span>Truck</span><b>' + esc(o.truckNo || '—') + '</b></div>' +
        '<div class="kv"><span>Odometer</span><b>' + esc(o.odometerBaseline ? Number(o.odometerBaseline).toLocaleString('en-CA') + ' km' : '—') + '</b></div>' +
        '<div class="kv"><span>Safety expiry</span><b>' + esc(o.safetyExpiry || '—') + '</b></div>' +
        '<div class="kv"><span>You drive</span><b>' + esc({ driver: 'Yes — I drive', both: 'I drive and do office work', office: 'No — office only' }[resolveUserRole(o)] || '—') + '</b></div></div>';
    }
    h += '</div>';
    el('onbSteps').innerHTML = h;
    Array.prototype.forEach.call(el('onbSteps').querySelectorAll('.opt'), function (d) {
      d.onclick = function () {
        var v = d.getAttribute('data-v');
        if (st.key === 'pay') o.payStandard = v; else o[st.key] = v;
        if (st.key === 'userRole') _onbRoleNudge = false; // answered — the gate is satisfied
        store.set('onboarding', o);
        renderOnbStep();
      };
    });
    /* v76 (F8): changing the country swaps the province control
       (Canadian code select <-> free state field) — collect first so
       nothing typed on this step is lost, then re-render. */
    if (st.type === 'company') {
      var csEl = el('ob_country');
      if (csEl) csEl.onchange = function () {
        collectOnbInputs();
        App.onb.country = csEl.value;
        if (csEl.value !== 'Canada') App.onb.province = '';
        else if (!onbProvinceNameForCode(App.onb.province || '')) App.onb.province = onbProvinceCodeForName(App.onb.homeProvince || '');
        store.set('onboarding', App.onb);
        renderOnbStep();
      };
    }
    // v28: photo steps — wire camera/file buttons + per-step skip
    if (st.type === 'odometer') {
      onbWirePhoto('ob_odo', 'odometer');
      var osk = el('ob_odo_skip');
      if (osk) osk.onclick = function () { collectOnbInputs(); var nx = onbNextVisible(App.onbStep, App.onb); if (nx >= 0) { App.onbStep = nx; renderOnbStep(); } };
    } else if (st.type === 'safety') {
      onbWirePhoto('ob_safety', 'safety');
      var ssk = el('ob_safety_skip');
      if (ssk) ssk.onclick = function () { collectOnbInputs(); var nx2 = onbNextVisible(App.onbStep, App.onb); if (nx2 >= 0) { App.onbStep = nx2; renderOnbStep(); } };
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
    /* v80: plausible-first. When a master odometer exists and the
       ranked winner is IMPOSSIBLE against it (below it, or more
       than ODO_MAX_JUMP_KM past it — Oct 15: a receipt's INVOICE NO.
       519326 outranked the dash), prefer the largest PLAUSIBLE
       candidate in frame, KM-line candidates first. When nothing in
       frame is plausible the winner stands and the callers' gate
       rejects it with a plain message + power-read escalation —
       the parser never invents a value that wasn't printed. The
       typeof guards keep this leaf function whole when a test
       harness extracts it on its own: no master context, no
       plausible-first — the pre-v80 ranking, unchanged. */
    var master = (typeof masterOdometer === 'function') ? masterOdometer() : null;
    var jumpKm = (typeof ODO_MAX_JUMP_KM === 'number') ? ODO_MAX_JUMP_KM : 1000;
    if (pick && master && (pick.v < master || pick.v > master + jumpKm)) {
      var plaus = all.filter(function (c) { return c.v >= master && c.v <= master + jumpKm; });
      var pPick = largest(onKm.filter(function (c) { return plaus.indexOf(c) >= 0; })) || largest(plaus);
      if (pPick) pick = pPick;
    }
    return pick ? String(pick.v) : null;
  }
  /* v80: how far past the master a machine-read odometer candidate
     may sit before it counts as impossible. A truck cannot gain
     1,000+ km between readings its driver makes; anything further
     is another number in frame (an invoice no., a phone number…).
     PowerRead.ODO_MAX_JUMP_KM mirrors this value. */
  var ODO_MAX_JUMP_KM = 1000;
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
    /* v86: the bump is a WRITE, so the two-sided gate applies here
       too — a value more than ODO_MAX_JUMP_KM past the master is
       refused (refused: 'jump'), never written. Before v86 this
       upward-only bump let ANY larger number through, which is how
       the Fuel save carried the 519,326 receipt invoice number into
       the master live on Oct 15, past the v80 read gate. Callers
       that need to move the master by more than the gate (a real
       correction) go through odoSaveDecision with the user's arm. */
    if (prev !== null && n > prev + ODO_MAX_JUMP_KM) {
      return { value: prev, raised: false, previous: prev, refused: 'jump' };
    }
    if (prev === null || n > prev) {
      store.set('mt_odo', String(n));
      return { value: n, raised: true, previous: prev };
    }
    return { value: prev, raised: false, previous: prev };
  }
  /* v80: the SUPERVISED odometer save decision (Preferences). The
     master moves UP on any confirmed save at or above it. A save
     BELOW the master is a correction — it applies ONLY when the
     user explicitly armed it ("This corrects a wrong reading"),
     because that is the one door that can fix a poisoned master
     (Oct 15: had the 519,326 misread been saved, every later true
     reading would sit "below the master" forever with no way back).
     Unarmed + lower → keep the master and say so; the caller
     restores the field to the master so the stale number can't
     ride along on the next save. Pure: (typed, master, armed).
     v86: EVERY master write routes through this decision (Fuel,
     Maintenance and onboarding joined Preferences), and the gate
     is two-sided — see the jump branch inside. */
  function odoSaveDecision(typed, master, correctionArmed) {
    var n = parseFloat(typed);
    if (!(n > 0)) return { action: 'ignore', value: (master === undefined ? null : master) };
    if (master === null || master === undefined || !(master > 0)) return { action: 'set', value: n };
    /* v86: the decision is TWO-SIDED, like the read gate — a value
       more than ODO_MAX_JUMP_KM ABOVE the master is as impossible
       as one below it (the Oct 15 fuel-save poison: 519,326 against
       a 168,759 master, waved through by the old "at-or-above sets"
       rule because the Fuel form never consulted this decision).
       Unarmed it keeps the master; armed it is a correction — the
       same supervised door as the downward un-poisoning fix. */
    if (n > master + ODO_MAX_JUMP_KM) {
      return correctionArmed ? { action: 'correct', value: n } : { action: 'keep', value: master };
    }
    if (n >= master) return { action: 'set', value: n };
    if (correctionArmed) return { action: 'correct', value: n };
    return { action: 'keep', value: master };
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
      if (m2) {
        mo = parseInt(m2[1], 10) - 1;
        y = parseInt(m2[2], 10);
      } else {
        /* v107: separated month + year — a transcription of a
           PUNCHED sticker names the punches in words, often apart
           ("Month punched: MAY / Year: 2027"), which neither
           pattern above can see. A month name anywhere plus a
           plausible year anywhere is the same fact stated loosely;
           the result is always confirm-first, like every read. */
        var mName = t.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\b/);
        var mYear = t.match(/\b(20\d{2})\b/);
        if (!mName || !mYear) return null;
        mo = _ONB_MONTHS[mName[1].slice(0, 3).toLowerCase()];
        y = parseInt(mYear[1], 10);
      }
    }
    return stickerExpiryISO(mo, y);
  }
  /* v107 (Stage 5): the ONE composition of a sticker expiry from
     its month + year — a punched sticker expires on the LAST day
     of the month shown. parseStickerExpiry uses it, and so do the
     manual month/year steppers the safety flow falls back to when
     no reader can read the punches. */
  function stickerExpiryISO(mo, y) {
    if (mo === null || mo === undefined || !(y >= 2020 && y <= 2045)) return null;
    var last = new Date(y, mo + 1, 0).getDate();
    return y + '-' + ('0' + (mo + 1)).slice(-2) + '-' + ('0' + last).slice(-2);
  }
  /* v31: onbWirePhoto now accepts an optional persistFn(kind, value) so
     Preferences can reuse the same OCR wiring with its own save logic.
     Exposed as App._wirePhotoOCR for the preferences module.
     v61: a fourth, optional opts.origin lets another host screen
     (Maintenance) label its v59 power-read escalations as its own;
     hosts that pass nothing keep the historical 'preferences' origin,
     byte-identical to v59 behaviour. */
  /* v63: odometer plausibility gate, shared by the day start/end
     sheet and the photo pipeline below. A local odometer read counts
     as FAILED when it found nothing, OR when it found a value BELOW
     the master odometer — odometers never run backwards, so a lower
     number is a misread (Oct 14 live test: the dash read 45,100
     against the 168,518 master and was accepted as a success, which
     blocked the power-read escalation entirely). Plausible values
     pass untouched: escalate only the impossible-or-absent. The
     gate only distrusts the silent auto-fill — the user can always
     still type or tap a value themselves. */
  function odoMasterNow() {
    var v = parseFloat(store.get('mt_odo', ''));
    return (isFinite(v) && v > 0) ? v : null;
  }
  function odoLocalFailed(km) {
    if (!km) return true;
    var v = parseFloat(km);
    if (!(v > 0)) return true;
    return odoImplausible(v) !== null;
  }
  /* v80: WHY a machine-read candidate is impossible against the
     master — 'below' (odometers never run backwards) or 'jump'
     (more than ODO_MAX_JUMP_KM past it: another number in frame,
     e.g. the 519,326 invoice no. of Oct 15) — or null when the
     value is plausible (or there is no master to judge by). Every
     odometer photo surface words its rejection from this, so the
     driver hears one consistent plain explanation. Mirrors
     PowerRead.odoImplausible. */
  function odoImplausible(km) {
    var v = parseFloat(km);
    if (!(v > 0)) return null;
    var m = odoMasterNow();
    if (!m) return null;
    if (v < m) return 'below';
    if (v > m + ODO_MAX_JUMP_KM) return 'jump';
    return null;
  }

  function onbWirePhoto(prefix, kind, persistFn, opts) {
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
            if (km && fieldEl && !odoLocalFailed(km)) {
              fieldEl.value = km;
              persist(kind, km);
              onbSetStatus(prefix, '✓ We read <b>' + Number(km).toLocaleString('en-CA') + ' km</b> — fix it below if that is wrong.');
            } else if (km && odoLocalFailed(km)) {
              /* v63 plausibility gate: the value exists but is
                 impossible against the master odometer, so it counts
                 as a FAILED read: never filled, never persisted, and
                 the power read gets its crack at the photo below (its
                 answer still lands as a tap-to-use chip, never
                 auto-applied). v80: the gate is two-sided and the
                 message names the direction — below the master
                 (v63), or a wild jump past it (Oct 15: a receipt's
                 invoice number outranked the dash). */
              if (odoImplausible(km) === 'jump') {
                onbSetStatus(prefix, '⚠️ We read <b>' + Number(km).toLocaleString('en-CA') + ' km</b> — but your odometer is at <b>' + Number(odoMasterNow()).toLocaleString('en-CA') + ' km</b>, so that can\'t be right — it\'s likely another number in the photo. Trying the power read…');
              } else {
                onbSetStatus(prefix, '⚠️ We read <b>' + Number(km).toLocaleString('en-CA') + ' km</b> — but the odometer is already at <b>' + Number(odoMasterNow()).toLocaleString('en-CA') + ' km</b>, so that can\'t be right. Trying the power read…');
              }
            } else {
              onbSetStatus(prefix, '⚠️ Could not read the mileage — enter it manually below.');
            }
            /* v58 (Round 2 Lane B): keep hunting in the background —
               pooled extra reads may surface the true value as
               tap-to-pick chips. Never auto-accepts: a chip fills the
               field only when the user taps it. */
            odoHunt(prefix, dataUrl, token, text);
            /* v59: local read AND the primary parse found nothing →
               power-read escalation. The cloud value arrives as a
               tap-to-use chip (never auto-filled, never persisted by
               the escalation itself). v63: the trigger is now the
               plausibility gate — nothing found OR an impossible
               below-master value both escalate; a skip (off / no key
               on this device) is reported in-page, never silent. */
            if (odoLocalFailed(km)) odoPowerRead(prefix, file, token);
          } else {
            var iso = parseStickerExpiry(text);
            if (iso && fieldEl) {
              fieldEl.value = iso;
              persist(kind, iso);
              onbSetStatus(prefix, '✓ We read expiry <b>' + iso + '</b> — fix it below if that is wrong.');
            } else {
              /* v107 (Stage 5): a failed sticker read used to end
                 at this status line with a dead manual path — the
                 punched-hole CVIP sticker defeats the local reader
                 AND the vision model (proven on the owner's own
                 sticker, Oct 16). Now the failure does two things:
                 escalate to the power read (its transcription is
                 re-parsed by the same parseStickerExpiry), and
                 present MONTH/YEAR STEPPERS as the manual path —
                 the driver taps the punched month and year, the
                 expiry composes as the last day of that month,
                 and the photo stays attached above. */
              onbSetStatus(prefix, '⚠️ Could not read the expiry date from the photo — asking the power read to try. You can also set the sticker\'s month and year below: it expires on the last day of that month.');
              showSafetySteppers(prefix);
              safetyPowerRead(prefix, file, token);
            }
          }
        }).catch(function () {
          if (token !== _onbOcrToken) return;
          onbSetStatus(prefix, '⚠️ Photo reader needs internet the first time — enter it manually below.');
          if (kind === 'safety') showSafetySteppers(prefix);
        });
      };
      try { rd.readAsDataURL(file); } catch (e) {
        onbSetStatus(prefix, '⚠️ Could not read that file — enter it manually below.');
      }
    }
    if (camIn) camIn.onchange = function () { handleFile(camIn.files[0]); camIn.value = ''; };
    if (pickIn) pickIn.onchange = function () { handleFile(pickIn.files[0]); pickIn.value = ''; };

    /* v58: background candidate hunt for odometer photos (Round 2).
       Renders up to 4 ranked candidate chips under the status line;
       a tap fills the field and persists through the SAME persist()
       the primary read uses — the hunt itself never writes anything. */
    function odoHunt(prefix, dataUrl, token, seedText) {
      if (!window.TicketOCR || !TicketOCR.huntCandidates) return;
      var statusEl = el(prefix + '_status');
      if (!statusEl || !statusEl.parentNode) return;
      var box = document.getElementById(prefix + '_chips');
      if (!box) {
        box = document.createElement('div');
        box.id = prefix + '_chips';
        statusEl.parentNode.insertBefore(box, statusEl.nextSibling);
      }
      box.innerHTML = '';
      TicketOCR.huntCandidates(dataUrl, {
        kind: 'odometer',
        parseOdo: parseOdometerReading,
        seedTexts: seedText ? [{ text: seedText, whitelist: false }] : [],
        onUpdate: function (res) {
          if (token !== _onbOcrToken) return;
          var cur = fieldEl ? String(fieldEl.value || '').replace(/[^\d]/g, '') : '';
          /* v80: hunt chips are machine candidates too — an
             impossible one (below the master, or a wild jump past
             it, like a receipt's invoice number) is never offered
             as a tap-to-use chip. */
          var list = (res.odo || []).filter(function (c) { return String(c.value) !== cur && !odoImplausible(c.value); }).slice(0, 4);
          box.innerHTML = '';
          if (!list.length) return;
          var lbl = document.createElement('div');
          lbl.style.cssText = 'font-size:13px;color:#555;margin:4px 0 2px';
          lbl.textContent = 'Or is it one of these? Tap the right one:';
          box.appendChild(lbl);
          list.forEach(function (c) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn small ghost';
            b.style.margin = '2px 4px 2px 0';
            b.textContent = Number(c.value).toLocaleString('en-CA') + ' km';
            b.onclick = function () {
              if (fieldEl) fieldEl.value = c.value;
              persist(kind, c.value);
              box.innerHTML = '';
              onbSetStatus(prefix, '✓ Using <b>' + Number(c.value).toLocaleString('en-CA') + ' km</b> — thanks for confirming.');
            };
            box.appendChild(b);
          });
        }
      }).catch(function () {});
    }

    /* v59: power-read escalation for the odometer photo (onboarding +
       Preferences share this wiring). Escalates the small OCR
       rendition, not the full-size photo. The answer renders as ONE
       labelled chip; tapping it fills the field and persists through
       the same persist() the local reads use — nothing is written
       until that tap. */
    function odoPowerRead(prefix, file, token) {
      if (!window.PowerRead || !PowerRead.escalate) return;
      function go(img) {
        if (token !== _onbOcrToken) return;
        PowerRead.escalate({
          reader: 'odometer', image: img, origin: (opts && opts.origin) || { module: 'preferences', label: 'Preferences' },
          onStatus: function (s) {
            if (token !== _onbOcrToken) return;
            if (s.state === 'working') onbSetStatus(prefix, '⚡ Asking the power read to try…');
            else if (s.state === 'waiting') onbSetStatus(prefix, '⚡ Power read waiting for signal — the photo is saved and will be read when you\'re back online. You can still enter the mileage below.');
            else if (s.state === 'unavailable') onbSetStatus(prefix, s.message + ' You can still enter the mileage below.');
            else if (s.state === 'error') onbSetStatus(prefix, s.message + ' You can still enter the mileage below.');
          },
          onResult: function (res) {
            if (token !== _onbOcrToken) return;
            var v = res.fields && res.fields.value;
            if (!v) { onbSetStatus(prefix, '⚡ Power read couldn\'t read it either — enter it manually below.'); return; }
            var statusEl = el(prefix + '_status');
            if (!statusEl || !statusEl.parentNode) return;
            var box = document.getElementById(prefix + '_chips');
            if (!box) {
              box = document.createElement('div');
              box.id = prefix + '_chips';
              statusEl.parentNode.insertBefore(box, statusEl.nextSibling);
            }
            box.innerHTML = '';
            var lbl = document.createElement('div');
            lbl.style.cssText = 'font-size:13px;color:#555;margin:4px 0 2px';
            lbl.textContent = '⚡ Power read — check before using:';
            box.appendChild(lbl);
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn small';
            b.style.margin = '2px 4px 2px 0';
            b.textContent = Number(v).toLocaleString('en-CA') + ' km';
            b.onclick = function () {
              if (fieldEl) fieldEl.value = v;
              persist(kind, v);
              box.innerHTML = '';
              onbSetStatus(prefix, '⚡ Power read: using <b>' + Number(v).toLocaleString('en-CA') + ' km</b> — thanks for confirming.');
            };
            box.appendChild(b);
            onbSetStatus(prefix, '⚡ Power read found a reading — tap it below if it looks right, or type the mileage yourself.');
          }
        });
      }
      if (window.TicketOCR && TicketOCR.fileToOCRImage && file) {
        TicketOCR.fileToOCRImage(file, function (u) {
          if (u) { go(u); return; }
          /* v63: a rendition failure used to end the flow in total
             silence — say so, with the manual fallback. */
          if (token === _onbOcrToken) onbSetStatus(prefix, '⚡ Power read didn\'t run — that photo couldn\'t be prepared for it. You can still enter the mileage below.');
        });
      }
    }

    /* v107 (Stage 5): the safety sticker's manual path — MONTH/YEAR
       STEPPERS. A punched sticker (his CVIP: year 2027, month May)
       is two facts a driver can tap in seconds; the expiry is
       always the last day of the tapped month (stickerExpiryISO).
       Shown the moment a read fails, whatever the power read
       later returns; a power-read hit arrives as a tap-to-use
       chip and never overrides a stepper choice already made. */
    function showSafetySteppers(prefix) {
      var statusEl = el(prefix + '_status');
      if (!statusEl || !statusEl.parentNode) return;
      var box = document.getElementById(prefix + '_steppers');
      if (!box) {
        box = document.createElement('div');
        box.id = prefix + '_steppers';
        statusEl.parentNode.insertBefore(box, statusEl.nextSibling);
      }
      var now = new Date();
      var st = { mo: now.getMonth(), y: now.getFullYear() };
      if (fieldEl && /^\d{4}-\d{2}-\d{2}$/.test(fieldEl.value || '')) {
        st.y = parseInt(fieldEl.value.slice(0, 4), 10);
        st.mo = parseInt(fieldEl.value.slice(5, 7), 10) - 1;
      }
      var NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      function stepBtn(label, fn) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn small ghost';
        b.style.cssText = 'min-width:40px;margin:0 2px;';
        b.textContent = label;
        b.onclick = fn;
        return b;
      }
      function paint() {
        box.innerHTML = '';
        var head = document.createElement('div');
        head.style.cssText = 'font-size:13px;color:#555;margin:6px 0 2px';
        head.textContent = 'Which month and year are punched on the sticker?';
        box.appendChild(head);
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:2px;';
        row.appendChild(stepBtn('‹', function () { st.mo = (st.mo + 11) % 12; paint(); }));
        var moLbl = document.createElement('b');
        moLbl.style.cssText = 'min-width:86px;text-align:center;';
        moLbl.textContent = NAMES[st.mo];
        row.appendChild(moLbl);
        row.appendChild(stepBtn('›', function () { st.mo = (st.mo + 1) % 12; paint(); }));
        row.appendChild(stepBtn('‹', function () { if (st.y > 2020) { st.y--; paint(); } }));
        var yLbl = document.createElement('b');
        yLbl.style.cssText = 'min-width:52px;text-align:center;';
        yLbl.textContent = String(st.y);
        row.appendChild(yLbl);
        row.appendChild(stepBtn('›', function () { if (st.y < 2045) { st.y++; paint(); } }));
        box.appendChild(row);
        var use = document.createElement('button');
        use.type = 'button';
        use.className = 'btn small';
        use.style.marginTop = '6px';
        var iso = stickerExpiryISO(st.mo, st.y);
        use.textContent = 'Use ' + NAMES[st.mo] + ' ' + st.y + (iso ? ' — expires ' + iso : '');
        use.onclick = function () {
          var v = stickerExpiryISO(st.mo, st.y);
          if (!v) return;
          if (fieldEl) fieldEl.value = v;
          persist(kind, v);
          box.innerHTML = '';
          onbSetStatus(prefix, '✓ Expiry set to <b>' + v + '</b> — the last day of ' + NAMES[st.mo] + ' ' + st.y + ', as punched on the sticker.');
        };
        box.appendChild(use);
      }
      paint();
    }

    /* v107 (Stage 5): the safety sticker's power-read escalation —
       the mirror of odoPowerRead for the safety branch, which
       never escalated at all before tonight. The transcription
       reader ('text') fits a punched sticker: the model describes
       the punches in words, and the SAME local parseStickerExpiry
       that reads printed stickers extracts the month/year from
       the transcription. A hit lands as a tap-to-use chip, never
       auto-applied; the steppers stay available either way. */
    function safetyPowerRead(prefix, file, token) {
      if (!window.PowerRead || !PowerRead.escalate) return;
      function go(img) {
        if (token !== _onbOcrToken) return;
        PowerRead.escalate({
          reader: 'text', image: img, origin: (opts && opts.origin) || { module: 'preferences', label: 'Preferences' },
          onStatus: function (s) {
            if (token !== _onbOcrToken) return;
            if (s.state === 'working') onbSetStatus(prefix, '⚡ Asking the power read to try…');
            else if (s.state === 'waiting') onbSetStatus(prefix, '⚡ Power read waiting for signal — the photo is saved and will be read when you\'re back online. Meanwhile, the month/year steppers below always work.');
            else if (s.state === 'unavailable' || s.state === 'error') onbSetStatus(prefix, s.message + ' The month/year steppers below always work.');
          },
          onResult: function (res) {
            if (token !== _onbOcrToken) return;
            var iso = parseStickerExpiry(res && res.fields && res.fields.rawText);
            if (!iso) { onbSetStatus(prefix, '⚡ Power read couldn\'t read the sticker either — set the punched month and year with the steppers below.'); return; }
            var statusEl = el(prefix + '_status');
            if (!statusEl || !statusEl.parentNode) return;
            var box = document.getElementById(prefix + '_chips');
            if (!box) {
              box = document.createElement('div');
              box.id = prefix + '_chips';
              statusEl.parentNode.insertBefore(box, statusEl.nextSibling);
            }
            box.innerHTML = '';
            var lbl = document.createElement('div');
            lbl.style.cssText = 'font-size:13px;color:#555;margin:4px 0 2px';
            lbl.textContent = '⚡ Power read — check before using:';
            box.appendChild(lbl);
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn small';
            b.style.margin = '2px 4px 2px 0';
            b.textContent = 'Expiry ' + iso;
            b.onclick = function () {
              if (fieldEl) fieldEl.value = iso;
              persist(kind, iso);
              box.innerHTML = '';
              onbSetStatus(prefix, '⚡ Power read: using expiry <b>' + iso + '</b> — thanks for confirming.');
            };
            box.appendChild(b);
            onbSetStatus(prefix, '⚡ Power read found an expiry — tap it below if it looks right, or use the steppers.');
          }
        });
      }
      if (window.TicketOCR && TicketOCR.fileToOCRImage && file) {
        TicketOCR.fileToOCRImage(file, function (u) {
          if (u) { go(u); return; }
          if (token === _onbOcrToken) onbSetStatus(prefix, '⚡ Power read didn\'t run — that photo couldn\'t be prepared for it. The month/year steppers below always work.');
        });
      }
    }
  }

  function collectOnbInputs() {
    var o = App.onb, g = function (id) { var n = el(id); return n ? n.value.trim() : ''; };
    if (g('ob_rate')) o.payRate = g('ob_rate');
    if (g('ob_base')) o.baseLocation = g('ob_base');
    if (g('ob_cname')) o.companyName = g('ob_cname');
    if (g('ob_gst')) o.gst = g('ob_gst');
    if (g('ob_caddr')) o.companyAddr = g('ob_caddr');
    if (g('ob_cont')) o.contractingCo = g('ob_cont');
    if (g('ob_country')) o.country = g('ob_country');
    if (g('ob_prov')) o.province = g('ob_prov');
    if (g('ob_tnum')) o.truckNo = g('ob_tnum');
    if (g('ob_ttype')) o.truckType = g('ob_ttype');
    if (g('ob_odo')) o.odometerBaseline = g('ob_odo');
    if (g('ob_safety')) o.safetyExpiry = g('ob_safety');
    store.set('onboarding', o);
  }

  function finishOnboarding() {
    collectOnbInputs();
    var o = App.onb || {};
    /* v76 (F1): finishing is impossible with the role question
       unanswered — hold AT the question instead of stamping a
       default. (The v52 stamp this replaces is what put the driver
       face on the boss: Owner-Operator defaulted to 'both'.) The
       movers gate earlier; this is the last line of defence. */
    if (!isUserRole(o.userRole)) {
      _onbRoleNudge = true;
      var ri = onbRoleStepIndex();
      if (ri >= 0) App.onbStep = ri;
      renderOnbStep();
      return;
    }
    /* v76 (F8): keep the location pair coherent for Invoice + P&L —
       a Canadian province code implies Canada, and P&L's workers-comp
       lookup reads the full province name (homeProvince). */
    try {
      if (o.province && onbProvinceNameForCode(o.province)) {
        if (!o.country) o.country = 'Canada';
        if (!o.homeProvince) o.homeProvince = onbProvinceNameForCode(o.province);
        App.onb = o; store.set('onboarding', o);
      }
    } catch (e) {}
    // v28: odometer baseline -> Maintenance PM starting point
    // v86: routed through the SAME supervised decision as every
    // other master write — a first reading (no master yet) sets it;
    // a re-onboarding value that trips the two-sided gate (below
    // the master, or impossibly far past it) leaves the master be.
    try {
      if (o.odometerBaseline && parseFloat(o.odometerBaseline) > 0) {
        var obDec = odoSaveDecision(o.odometerBaseline, odoMasterNow(), false);
        if (obDec.action === 'set' || obDec.action === 'correct') {
          App._store.set('mt_odo', String(obDec.value));
        }
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
  /* v45: EVERY Firebase auth error maps to plain English — the raw code
     and raw Firebase message must never reach the screen (new users read
     "auth/invalid-credential" as gibberish and give up). */
  function friendlyAuthError(e) {
    var code = (e && e.code) || '';
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' ||
        code === 'auth/user-not-found' || code === 'auth/invalid-password')
      return 'Wrong email or password. If you just reset your password, make sure you are typing the new one.';
    if (code === 'auth/email-already-in-use')
      return 'That email already has an account. Tap Back and choose Sign in instead — or use Forgot password on the sign-in screen.';
    if (code === 'auth/invalid-email')
      return 'That email address doesn\'t look right. Check it and try again.';
    if (code === 'auth/weak-password')
      return 'That password is too weak. Use at least 6 characters.';
    if (code === 'auth/missing-password')
      return 'Enter your password.';
    if (code === 'auth/too-many-requests')
      return 'Too many tries — sign-in is paused for a bit. Wait about 10 minutes and try again.';
    if (code === 'auth/network-request-failed')
      return 'Could not reach the server. Check your internet and try again.';
    if (code === 'auth/user-disabled')
      return 'This account has been disabled. Please contact support.';
    if (code === 'auth/requires-recent-login')
      return 'For security, sign out and sign back in, then try again right away.';
    if (code === 'auth/operation-not-allowed')
      return 'Email sign-in is not available right now. Please try again later.';
    return 'Something went wrong. Please try again.';
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
     signup and sign-in so they always agree.
     v45: ALSO trim ordinary leading/trailing spaces — a trailing space
     typed at registration or sign-in caused a real auth/invalid-credential
     lockout (Oct 12). Firebase passwords are exact-match; trimming at BOTH
     ends keeps register and sign-in in agreement. */
  function cleanPw(pw) {
    return String(pw || '').replace(/[\u200B\u200C\u200D\uFEFF\u00AD\u2060]/g, '').trim();
  }
  /* v45: emails are case-insensitive identities — trim + lowercase
     everywhere so Register and Sign in always agree. */
  function cleanEmail(em) {
    return String(em || '').trim().toLowerCase();
  }
  function looksLikeEmail(em) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em);
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
      var em = cleanEmail(el('authEmail').value);
      if (!em) return authError('Enter your email first, then tap Forgot password.');
      if (!looksLikeEmail(em)) return authError('That email address doesn\'t look right. Check it and try again.');
      if (!window.FB || !FB.ready || !FB.auth) return authError('Could not reach the server. Try again.');
      authError('Sending reset email...', true);
      FB.sendReset(em).then(function () {
        authError('Reset email sent! Check your inbox (and spam folder).', true);
      }).catch(function (e) {
        authError(friendlyAuthError(e));
      });
    };
    el('btnSignIn').onclick = function () {
      var em = cleanEmail(el('authEmail').value), pw = cleanPw(el('authPass').value);
      if (!em || !pw) return authError('Enter email and password.');
      if (!looksLikeEmail(em)) return authError('That email address doesn\'t look right. Check it and try again.');
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
      var em = cleanEmail(el('authEmail').value), pw = cleanPw(el('authPass').value);
      var pw2 = el('authPass2') ? cleanPw(el('authPass2').value) : pw;
      if (!em || !pw) return authError('Enter email and password.');
      if (!looksLikeEmail(em)) return authError('That email address doesn\'t look right. Check it and try again.');
      if (pw.length < 6) return authError('Password must be at least 6 characters.');
      if (pw !== pw2) return authError('Passwords do not match. Type the same password in both boxes.');
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
      try { em = cleanEmail(el('authEmail').value); } catch (e) {}
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
      /* v45: confirm-password box exists only when creating an account */
      if (el('authPass2Wrap')) el('authPass2Wrap').classList.toggle('hidden', !isUp);
      el('authPass').setAttribute('autocomplete', isUp ? 'new-password' : 'current-password');
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
    /* v95: THE SIGN-IN DOOR (owner, Oct 16 — a Local-mode user had NO
       reachable sign-in at all: the only route was Preferences →
       Advanced → "Reset onboarding questions", a destructive-sounding
       detour whose native confirm() browser automation auto-cancels,
       and which strands a human behind a reset they never asked for).
       The door routes straight to the sign-in form. It touches
       NOTHING else: no onboarding flag, no local data; a completed
       sign-in continues through the ordinary afterAuth() path (the
       existing merge/sync behaviour), and the form's own "Continue
       without an account" stays the way back to the Local dashboard.
       Entering from a module (Preferences) first returns #main to the
       dashboard, so a completed sign-in — or a skip back — lands
       where the boot path lands, never on a stale module render. */
    App.goSignIn = function () {
      try { App.showDashboard(); } catch (e) {}
      showAuthForm('signin');
      App.showView('auth');
    };
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
    // v40: the tracker survived a relaunch (or an OTA reload) — reattach
    // live-miles tracking to the SAME session. Its breadcrumb record was
    // persisted before the kill; the engine restores it and does not
    // count the unobserved join segment.
    if (App.tracker.status === 'running' || App.tracker.status === 'paused') {
      try { if (window.LiveMiles) LiveMiles.startDay('s' + trackerSessionKeyMs(), { resume: true }); } catch (e) {}
      try { if (window.GeoLoads) GeoLoads.startDay('s' + trackerSessionKeyMs(), { resume: true }); } catch (e) {}
    }
    // v63: reconcile with the native background tracker — it may hold
    // breadcrumbs (or a whole orphaned session) from while we were dead.
    try { if (window.ShiftTrack) ShiftTrack.syncOnBoot(); } catch (e) {}
    // v27: if the auto-start time passed while the app was closed, start or prompt now
    try { App.checkAutoStart(); } catch (e) {}
    // v92: hand the NEXT planned start to the native shell, so
    // tomorrow's counting can begin with this app completely dead.
    try { App.armNativeDay(); } catch (e) {}

    // v59: power-read queue — retry waiting cloud reads on app open
    // and the moment connectivity returns. Inert without a key.
    try {
      if (window.PowerRead) {
        PowerRead.processQueue();
        window.addEventListener('online', function () { try { PowerRead.processQueue(); } catch (e) {} });
      }
    } catch (e) {}

    // v65: Web Share Target capture — "Share → Meticulous" from any
    // app lands on /?share=1&text=… ; stash the text for the Dispatch
    // module's ingestion drain (it becomes a suggestion there, never
    // a dispatch). Inert without the share params.
    try { if (window.DispatchIngest && DispatchIngest.captureShare) DispatchIngest.captureShare(); } catch (e) {}

    el('onbBack').onclick = function () {
      collectOnbInputs();
      var pv = onbPrevVisible(App.onbStep, App.onb);
      if (pv >= 0) { App.onbStep = pv; renderOnbStep(); }
    };
    el('onbNext').onclick = function () {
      collectOnbInputs();
      /* v76 (F1): the role question must be ANSWERED to advance —
         no Next-through, ever. The nudge renders at the question. */
      var cur = ONB_STEPS[App.onbStep];
      if (cur && cur.key === 'userRole' && !isUserRole(App.onb.userRole)) {
        _onbRoleNudge = true;
        renderOnbStep();
        return;
      }
      var nx = onbNextVisible(App.onbStep, App.onb);
      if (nx >= 0) { App.onbStep = nx; renderOnbStep(); }
      else finishOnboarding();
    };
    el('onbSkip').onclick = function () {
      /* v76 (F1): Skip can no longer walk past the role question —
         with it unanswered, Skip lands ON the question (it is the
         one answer the app cannot guess). Once answered, Skip works
         exactly as before. */
      collectOnbInputs();
      if (!isUserRole(App.onb.userRole)) {
        _onbRoleNudge = true;
        var ri = onbRoleStepIndex();
        if (ri >= 0) App.onbStep = ri;
        renderOnbStep();
        return;
      }
      store.set('onboarded', true); App.showView('main');
    };

    el('btnMenu').onclick = function () {
      el('sidebar').classList.add('open'); el('scrim').classList.add('show');
      el('scrim').onclick = closeSidebar;
    };
    /* v95: the drawer's sign-in door (rendered in the account block;
       shown/hidden by App.onAuth) — close the drawer, open the form. */
    var sbDoorBtn = el('sbSignIn');
    if (sbDoorBtn) sbDoorBtn.onclick = function () { closeSidebar(); if (App.goSignIn) App.goSignIn(); };
    el('scrim').onclick = closeSidebar;
    el('btnBell').onclick = function () { App.openModule('reminders'); };
    var sdEl = el('syncDot');
    if (sdEl) sdEl.onclick = function () { App.showSyncStatus(); }; // v34: tap dot = sync status
    /* v116: the in-app back arrow follows the same rule as the
       system back — a module sub-view unwinds to the module's
       main view first; only a main view exits to the dashboard. */
    el('btnModBack').onclick = function () { if (!App.moduleBack()) App.showDashboard(); };
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
    el('trkEndOdoCam').onclick = function () { el('trkEndOdoCamIn').click(); };
    el('trkEndOdoPick').onclick = function () { el('trkEndOdoIn').click(); };
    el('trkEndOdoCamIn').onchange = function () { endSheetOdoHandleFile(el('trkEndOdoCamIn').files[0]); el('trkEndOdoCamIn').value = ''; };
    el('trkEndOdoIn').onchange = function () { endSheetOdoHandleFile(el('trkEndOdoIn').files[0]); el('trkEndOdoIn').value = ''; };
    el('odoSheetSave').onclick = function () { App.odoSheetSave(); }; // v46: confirm the reading in the sheet
    // v41: dynamic tracker controls — mode buttons under the hero
    // (delegated: the buttons are re-rendered by paintTrackerExtra), the
    // tappable weight unit on the hero, and the "+ Add load" sheet.
    el('trkExtra').onclick = function (ev) {
      var id = ev.target && ev.target.id;
      if (id === 'trkAddTripBtn') App.trackerAddTrip();
      else if (id === 'trkAddLoadBtn') App.openLoadSheet();
      else if (id === 'trkLoadTapBtn') App.trackerAddLoadTap();
    };
    el('trkClock').onclick = function (ev) {
      if (ev.target && ev.target.id === 'trkUnitBtn' && payMode() === 'Weight') {
        cycleWeightUnit(); _heroSig = ''; trackerTick();
      }
    };
    el('ldSave').onclick = App.loadSheetSave;
    el('ldCancel').onclick = function () { App.loadSheetCancel(); };
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
      if (document.visibilityState === 'hidden') {
        try { trackerSave(); } catch (e) {}
        // v40: persist live-miles state before a possible kill
        try { if (window.LiveMiles) LiveMiles.flush(); } catch (e) {}
        try { if (window.GeoLoads) GeoLoads.flush(); } catch (e) {}
      }
      // v27: when the app comes back, check whether the auto-start time arrived
      if (document.visibilityState === 'visible') {
        try { App.checkAutoStart(); } catch (e2) {}
        // v92: a dispatch saved or changed while we were away may
        // have moved the next day's plan — re-arm the native side.
        try { App.armNativeDay(); } catch (e5) {}
        // v59: resume is also a power-read retry point
        try { if (window.PowerRead) PowerRead.processQueue(); } catch (e3) {}
        // v62: foreground return — re-hold the screen for a running
        // session and revive a geo watch that died while we were away
        try { if (window.LiveMiles && LiveMiles.onVisible) LiveMiles.onVisible(); } catch (e4) {}
      }
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
  App._stickerExpiryISO = stickerExpiryISO; // v107: the steppers' composition, pinned by test
  App._parseStickerExpiry = parseStickerExpiry;
  App._parseOdometerReading = parseOdometerReading; // v39: reused by Fuel odometer photo
  App._masterOdometer = masterOdometer; // v39: the single master odometer (mt_odo)
  App._bumpOdometer = bumpOdometer; // v39: upward-only master write for every capture point
  App._odoImplausible = odoImplausible; // v80: 'below' | 'jump' | null for a machine-read candidate
  App._odoSaveDecision = odoSaveDecision; // v80: supervised Preferences odometer save (correction door)
  App._odoDailyKm = odoDailyKm; // v46: session start/end pair -> the day's km (or null), used by Revenue
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
