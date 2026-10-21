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
    try { if (window.ConnectLive) ConnectLive.onAuth(user); } catch (e) {} // v131: live Connect (directory self-heal + connection reconcile)
    try { if (window.ConnectPipe) ConnectPipe.onAuth(user); } catch (e) {} // v132: the pipe (shared days publish + inbox lands + crew cache)
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
  var MODULE_ORDER = ['revenue', 'dispatch', 'navigator', 'fuel', 'pnl', 'maintenance', 'pti', 'damage', 'manifest', 'invoice', 'connect'];
  /* MODULE-TITLE-BEGIN — harness-extractable (store + pure JS). */
  var MODULE_META = {
    revenue:    { title: 'Revenue',           icon: '📊', tier: 'basic' },
    dispatch:   { title: 'Dispatch',          icon: '📋', tier: 'basic' },
    navigator:  { title: 'Navigator',         icon: '🧭', tier: 'basic' },
    fuel:       { title: 'Fuel & Expense',    icon: '⛽', tier: 'basic' },
    pnl:        { title: 'P&L',               icon: '📈', tier: 'basic' },
    maintenance:{ title: 'Maintenance',       icon: '🔧', tier: 'basic' },
    pti:        { title: 'PTI', icon: '🔍', tier: 'basic' },
    damage:     { title: 'Damage & Incident', icon: '📸', tier: 'basic' },
    manifest:   { title: 'Manifest / Daily Log', icon: '📝', tier: 'pro' },
    invoice:    { title: 'Invoice',           icon: '🧾', tier: 'pro' },
    connect:    { title: 'Connect',           icon: '🤝', tier: 'premium' }
    // v36: 'autostart' registry entry removed — settings moved into Revenue (owner); modules/autostart.js is now a shared card library + pointer stub
  };
  /* v122: the invoice module's NAME follows how the user is paid
     (owner catch, Oct 17: "I changed my payment method to
     payroll... And that was suppose to change the name of the
     invoice module to paystub!"). The module's guts already
     switch on onboarding.employment (modules/invoice.js opens
     renderPayroll for a payroll employee); this function is the
     ONE place the presented name is decided, and every surface
     — dashboard card, drawer, module header — reads it here, so
     the name can never disagree with the guts again. Contract
     keeps 'Invoice'. */
  function moduleTitle(key) {
    if (key === 'invoice') {
      var o = {};
      try { o = store.get('onboarding', {}) || {}; } catch (e) {}
      if (o.employment === 'Payroll') return 'Pay Stub';
    }
    var meta = MODULE_META[key];
    return meta ? meta.title : key;
  }
  /* MODULE-TITLE-END */

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
    driver: ['revenue', 'dispatch', 'fuel', 'maintenance', 'pti', 'manifest', 'navigator', 'damage', 'pnl', 'invoice', 'connect'],
    /* v76 (F4, boss QA Oct 14): the office home leads with the boss's
       five tools IN BLUEPRINT ORDER — Connect first (his #1: his
       connection to his drivers), then Dispatch, Invoice, Maintenance,
       P&L. Everything else follows; nothing is removed.
       v167 SUPERSEDES the tail (owner, Oct 18, 2026 21:50 MDT):
       the office face carries ONLY the five office tools —
       Connect, Dispatch, Invoice, P&L, Manifest. The driver
       modules (Maintenance, Fuel & Expense, Revenue, and the
       rest) are REMOVED from the office face — an office-only
       user never drives, and driver tools on his face are noise
       he has to look past. */
    office: ['connect', 'dispatch', 'invoice', 'pnl', 'manifest'],
    both: ['revenue', 'dispatch', 'navigator', 'fuel', 'pnl', 'maintenance', 'pti', 'damage', 'manifest', 'invoice', 'connect']
  };
  /* Sidebar lead-ins: items named here come first (in this order); every
     other sidebar item keeps its current place after them. Nothing is
     removed — tuning is emphasis only. */
  var ROLE_SIDEBAR_LEAD = {
    driver: ['dashboard', 'revenue', 'dispatch', 'navigator', 'fuel', 'maintenance', 'pti', 'damage', 'manifest'],
    office: ['dashboard', 'connect', 'dispatch', 'invoice', 'pnl', 'manifest'],
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
    /* v177 (D7, owner Oct 20, 2026): THE STAMP HEAL. Builds
       before v76 STAMPED the accountType default into userRole
       at onboarding finish — an unanswered Owner-Operator /
       Fleet Manager carries 'both' that was never an answer,
       and because a stored value reads as an answer forever,
       the office prune never reaches those accounts (the
       office-only tester still got the tracker + driver cards).
       A Fleet Manager's own default is 'office', so a 'both'
       stored beside that type with no genuine-answer marker
       (roleStamped — written when a person actually picks, in
       onboarding or Preferences) is the old stamp, not a pick:
       the face resolves office. A marked 'both' is a real
       answer and always wins. */
    if (isUserRole(o.userRole)) {
      if (o.userRole === 'both' && o.accountType === 'Fleet Manager' && o.roleStamped !== 'answer') {
        return 'office';
      }
      return o.userRole;
    }
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
    /* v167: the office sidebar is FILTERED, not just reordered —
       the five office tools plus the account utilities (dashboard,
       reminders, preferences, subscription, account, feedback,
       logout). Driver modules never appear on the office face,
       in the sidebar any more than on the dashboard. */
    if (role === 'office') {
      var keep = ROLE_MODULE_ORDER.office.concat(['dashboard', 'reminders', 'preferences', 'subscription', 'account', 'feedback', 'logout']);
      items = items.filter(function (it) { return keep.indexOf(it[0]) >= 0; });
    }
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

  /* ================= ACCT-GATE-BEGIN =================
     v199 (ACCT-DRIVER-CLEAN, owner, Oct 21, 2026 09:48 MDT): the
     Oct 13 exception ("He is a Driver but needs access to
     everything") is RETIRED — he has a separate tester account
     for the owner side now, and his own account is a Driver
     account. He named the two modules himself: "take off owners
     stuff off my account namely pnl and maintainance". P&L was
     already the owner's book by product law (Oct 12: P&L follows
     account type — a Driver never gets it, regardless of tier);
     Maintenance gets the same account-type treatment by his
     explicit naming today. On a Driver account both come OFF
     every surface that lists modules — buildDashboard and
     buildSidebar read these two gates, and they are the only
     places modules are surfaced. Owner-Operator and Fleet
     Manager keep both. NOTHING underneath changes: the modules,
     their data and every calculation stay exactly as they are.
     Harness-extractable: uses only `store` + pure JS. */
  function acctTypeNow() {
    try { return (store.get('onboarding', {}) || {}).accountType || 'Driver'; }
    catch (e) { return 'Driver'; }
  }
  function pnlAllowed() {
    return acctTypeNow() !== 'Driver';
  }
  function maintAllowed() {
    return acctTypeNow() !== 'Driver';
  }
  /* ================= ACCT-GATE-END ================= */

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
      if (key === 'pnl' && !pnlAllowed()) return; // v199: Driver accounts never surface P&L
      if (key === 'maintenance' && !maintAllowed()) return; // v199: Driver accounts never surface Maintenance
      var meta = MODULE_META[key];
      var ok = App.tierAllows(meta.tier);
      html += '<div class="modcard' + (ok ? '' : ' locked') + '" data-mod="' + key + '">' +
        (ok ? '' : '<span class="lock">🔒</span>') +
        '<div class="ic">' + meta.icon + '</div><div class="t">' + moduleTitle(key) + '</div>' +
        '<div class="s">' + esc(modStatus(key)) + '</div></div>';
    });
    g.innerHTML = html;
    Array.prototype.forEach.call(g.querySelectorAll('.modcard'), function (c) {
      c.onclick = function () { App.openModule(c.getAttribute('data-mod')); };
    });
    paintNameCard(); // v147: the one-time name ask (self-hiding once settled)
    /* v187 (PTI-DASH): the no-PTI flag rides EVERY dashboard paint
       (showDashboard, sign-in, the cloud-sync repaint) — not only
       trackerPaint — so it always reads the filed state the PTI
       card beside it reads. */
    try { paintPtiFlag(); } catch (e) {}
  }

  /* NAME-CARD-BEGIN — v147 (owner, Oct 17, 2026 21:31 MDT): the
     ONE-TIME name ask for accounts created before setup asked.
     Their Connect identity has always been a business or an
     email guess; this card asks the PERSON once, on the
     dashboard, in the parkCard slot's own shape. The law:
       - shows only for a finished account (onboarded) with no
         person name on the record and the question not yet
         settled (onboarding.nameAsked unset);
       - Save (a real name) stores it on the onboarding record —
         the same record setup + Preferences write — marks the
         question settled, and republishes the directory at once;
       - Skip is one tap and settles the question forever with
         no name invented;
       - an empty Save settles NOTHING (the card stays, with a
         hint) — and nothing anywhere waits on this card: it
         never blocks the dashboard, never gates a save, never
         re-appears after answer or skip. Accounts that finished
         setup on v147+ were asked there (finishOnboarding and
         the Skip path both stamp nameAsked), so they never see
         this card at all. */
  function paintNameCard() {
    try {
      var card = el('nameCard');
      if (!card) return;
      var o = store.get('onboarding', {}) || {};
      var person = ((o.firstName || '') + ' ' + (o.lastName || '')).replace(/\s+/g, ' ').trim();
      var show = !!store.get('onboarded', false) && !person && !o.nameAsked;
      if (!show) {
        card.classList.add('hidden');
        if (card.innerHTML) card.innerHTML = '';
        return;
      }
      card.classList.remove('hidden');
      card.innerHTML =
        '<div class="parkTxt">👋 What is your name?</div>' +
        '<p class="note" style="margin:0 0 10px">People connect with people. Right now your Connect listing shows only your business — add your name once and people can find you by it. Your business still shows under your name.</p>' +
        '<label class="f">First name</label><input id="nm_first" value="">' +
        '<label class="f">Last name</label><input id="nm_last" value="">' +
        '<p class="note" id="nm_hint" style="display:none;color:#b3541e;font-weight:700"></p>' +
        '<div class="parkRow" style="margin-top:10px">' +
        '<button type="button" class="btn primary" id="nm_save" style="flex:1">Save</button>' +
        '<button type="button" class="btn ghost" id="nm_skip" style="flex:1">Skip</button></div>';
      var saveBtn = card.querySelector('#nm_save');
      if (saveBtn) saveBtn.onclick = function () {
        var fEl = card.querySelector('#nm_first'), lEl = card.querySelector('#nm_last');
        var fn = fEl ? fEl.value.trim() : '', ln = lEl ? lEl.value.trim() : '';
        if (!fn && !ln) {
          var hint = card.querySelector('#nm_hint');
          if (hint) { hint.textContent = 'Type your name — or tap Skip.'; hint.style.display = ''; }
          return;
        }
        var cur = store.get('onboarding', {}) || {};
        cur.firstName = fn; cur.lastName = ln; cur.nameAsked = true;
        store.set('onboarding', cur);
        try { if (window.ConnectLive && ConnectLive.publishMine) ConnectLive.publishMine(); } catch (e) {}
        paintNameCard();
      };
      var skipBtn = card.querySelector('#nm_skip');
      if (skipBtn) skipBtn.onclick = function () {
        var cur = store.get('onboarding', {}) || {};
        cur.nameAsked = true;
        store.set('onboarding', cur);
        paintNameCard();
      };
    } catch (e) {}
  }
  /* NAME-CARD-END */

  var SIDEBAR_ITEMS = [
    ['dashboard', '🏠', 'Dashboard'],
    ['revenue', '📊', 'Revenue'],
    ['dispatch', '📋', 'Dispatch'],
    ['navigator', '🧭', 'Navigator'],
    ['fuel', '⛽', 'Fuel & Expense'],
    ['pnl', '📈', 'P&L'],
    ['maintenance', '🔧', 'Maintenance'],
    ['pti', '🔍', 'PTI'],
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
      if (it[0] === 'pnl' && !pnlAllowed()) return; // v199: Driver accounts never surface P&L
      if (it[0] === 'maintenance' && !maintAllowed()) return; // v199: Driver accounts never surface Maintenance
      html += '<button data-act="' + it[0] + '"><span>' + it[1] + '</span> ' + (it[0] === 'invoice' ? moduleTitle('invoice') : it[2]) + '</button>';
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

  /* v165: DOT INSPECTION MODE LOCK (owner, Oct 18, 2026 21:48
     MDT) — while the PTI module's officer view is active (the
     pti_dot store flag, owned by modules/pti.js), the shell
     routes EVERYTHING back to it: no dashboard, no other
     module, until the driver unlocks with his PIN inside PTI. */
  function dotLockActive() {
    try { var s = App._store.get('pti_dot', null); return !!(s && s.active); } catch (e) { return false; }
  }
  App._dotLockActive = dotLockActive;

  App.showDashboard = function () {
    if (dotLockActive()) { App.openModule('pti'); return; }
    teardownModule();
    el('dashView').classList.remove('hidden');
    el('modView').classList.add('hidden');
    buildDashboard();
    try { App.ptrNoteRepainted(); } catch (e) {} // v145: a fresh paint ends any dirty spell
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
    /* v165: the DOT Inspection Mode lock — see dotLockActive. */
    if (key !== 'pti' && dotLockActive()) key = 'pti';
    /* v119: the retired 'navigation' door routes into the merged
       Navigator — on its front (places) face, which is where the
       Navigator's resetView lands it. */
    if (key === 'navigation') key = 'navigator';
    var meta = MODULE_META[key];
    var special = { reminders: 1, preferences: 1, subscription: 1, account: 1 };
    /* P&L + Maintenance gates removed Oct 13, 2026 — the owner (Driver) gets full access. */
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
    var title = meta ? moduleTitle(key) : ({ reminders: 'Reminders', preferences: 'Preferences', subscription: 'Subscription', account: 'Account & login' }[key] || key);
    el('modTitle').textContent = title;
    var body = el('modBody');
    body.innerHTML = '';
    /* v116: fresh entry always lands on the module's main view. */
    try { if (mod.resetView) mod.resetView(); } catch (e) {}
    try { mod.render(body); } catch (e) { body.innerHTML = '<div class="empty">Could not load module.</div>'; console.error(e); }
    paintPowerBanner(body);
    try { App.ptrNoteRepainted(); } catch (e) {} // v145: a fresh paint ends any dirty spell
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

  /* PTR-BEGIN — v145 PULL-TO-REFRESH (owner, Oct 17 21:11 MDT,
     over his own screen recording of the Connect screen: "When
     pulled down, it should update by it self!"). One shared gesture
     for every scrollable screen in the shell — no per-screen hacks:
     a pull that STARTS at the very top of the page and travels
     past PTR_THRESHOLD fires exactly ONE refresh cycle:
       1. the cloud sync settles (CloudSync.syncNow: pull + flush);
       2. the visible screen re-reads and repaints through its OWN
          load path — a module re-enters exactly as if the user had
          left and come back (App.openModule: resetView + render,
          which is also what makes Connect republish + reconcile on
          open); the dashboard rebuilds its cards (their statuses
          re-read the store) and repaints the tracker hero.
     Hard guards: never while a sheet or the sidebar is open, never
     while the Navigator shell (the Drive screen) is up, never off
     the main view, never a second cycle while one is running, and
     the REPAINT leg never runs over a screen the user has typed in
     or is focused into — the sync leg still runs, but typed input
     is never blown away. The dirt is scoped to the screen it was
     typed on and ends at the next real repaint (openModule /
     showDashboard call App.ptrNoteRepainted). Note the cloud pull
     keeps its own 60s freshness gap inside CloudSync: a pull
     inside that window settles from the pull that just ran, while
     the screen's own live re-read (Connect requests/connections,
     Dispatch lists) always runs. Harness-extractable region:
     tools/pull-refresh-v145-test.js drives it whole against fakes. */
  var PTR_THRESHOLD = 80;    // px of downward travel that arms a refresh
  var PTR_MIN_WAIT_MS = 500; // a refresh is never an invisible flash
  var PTR_SETTLE_MS = 9000;  // longest wait on the cloud settle
  var PTR_SHEETS = ['trkStartSheet', 'trkEndSheet', 'odoSheet', 'loadSheet', 'fbSheet', 'chatSheet'];

  var ptrTrack = null;       // {y0, dy} of the touch being tracked
  var ptrRefreshing = false;
  var ptrDirtyFor = null;    // screen key carrying unsaved typing
  var ptrPill = null;
  var ptrHideTimer = 0;

  function ptrScreenKey() {
    var mv = el('modView');
    if (mv && !mv.classList.contains('hidden') && App._modKey) return 'mod:' + App._modKey;
    return 'dashboard';
  }

  function ptrOverlayOpen() {
    for (var i = 0; i < PTR_SHEETS.length; i++) {
      var s = el(PTR_SHEETS[i]);
      if (s && s.classList.contains('open')) return true;
    }
    var sb = el('sidebar');
    if (sb && sb.classList.contains('open')) return true;
    try { if (document.querySelector('.nv-shell')) return true; } catch (e) {}
    return false;
  }

  function ptrEditing() {
    if (ptrDirtyFor && ptrDirtyFor === ptrScreenKey()) return true;
    if (App.currentView !== 'main') return false;
    var a = document.activeElement;
    if (!a) return false;
    var tag = a.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!a.isContentEditable;
  }

  /* the pure gesture decision — the harness pins this table */
  function ptrDecide(s) {
    if (s.refreshing || s.view !== 'main' || s.overlay) return 'ignore';
    if (s.phase === 'start') return s.scrollY <= 0 ? 'track' : 'ignore';
    if (!s.tracking) return 'ignore';
    if (s.phase === 'move') return (s.scrollY <= 0 && s.dy > 0) ? 'show' : 'hide';
    if (s.phase === 'end') return (s.scrollY <= 0 && s.dy >= PTR_THRESHOLD) ? 'fire' : 'cancel';
    return 'ignore';
  }
  App.ptrDecide = ptrDecide;

  function ptrPillEl() {
    if (ptrPill) return ptrPill;
    var d = document.createElement('div');
    d.id = 'ptrPill';
    document.body.appendChild(d);
    ptrPill = d;
    return d;
  }
  function ptrPaint(mode, dy) {
    var p = ptrPillEl();
    if (ptrHideTimer) { clearTimeout(ptrHideTimer); ptrHideTimer = 0; }
    if (mode === 'hide') { p.classList.remove('show'); return; }
    if (mode === 'pull') p.textContent = dy >= PTR_THRESHOLD ? '↑ Release to refresh' : '↓ Pull to refresh';
    else if (mode === 'refreshing') p.textContent = '↻ Refreshing…';
    else if (mode === 'update') p.textContent = '✓ New version ready — restarting…';
    else if (mode === 'done') p.textContent = '✓ Updated';
    p.classList.add('show');
    if (mode === 'done') ptrHideTimer = setTimeout(function () { ptrPaint('hide'); }, 900);
  }

  function ptrSettleWait(t0) {
    return new Promise(function (resolve) {
      (function step() {
        var syncing = false;
        try {
          if (window.CloudSync && CloudSync.status) syncing = CloudSync.status().state === 'syncing';
        } catch (e) {}
        var waited = Date.now() - t0;
        if ((!syncing && waited >= PTR_MIN_WAIT_MS) || waited >= PTR_SETTLE_MS) return resolve();
        setTimeout(step, 150);
      })();
    });
  }

  function ptrRepaint() {
    if (ptrOverlayOpen()) return false;
    if (ptrEditing()) return false; // the sync leg ran; the form keeps its text
    if (ptrScreenKey() === 'dashboard') { buildDashboard(); trackerTick(); }
    else if (App._modKey) App.openModule(App._modKey); // == leaving and re-entering
    ptrDirtyFor = null;
    return true;
  }

  /* v166: THE VERSION LEG (owner, Oct 18, 2026 18:55 MDT — he
     pulled to refresh and the app repainted its DATA but stayed
     on the old code; v162's PTI card only arrived after a full
     restart: "just got it after restart"). A pull must bring a
     NEW VERSION too, not just new data. Two doors, one rule —
     the update is fetched by the same machinery the rest of the
     app trusts, and it is only APPLIED when the screen carries
     no unsaved typing (the PTR contract above outranks it: a
     downloaded update that can't apply yet simply lands at the
     next launch):
       NATIVE (the installed app): OTA.checkNow() downloads a
         newer bundle (the Preferences check, minus its confirm);
         OTA.restart() steps into it.
       WEB / PWA: the service worker is asked for an update; a
         waiting worker is activated (SKIP_WAITING) and the page
         reloads into the new copy — the showUpdateBanner dance,
         without making him hunt for the banner.
     Resolves true when the app is stepping into the new version
     (the page is going away — the repaint leg is skipped). */
  function ptrVersionLeg() {
    return new Promise(function (resolve) {
      var settled = false;
      function fin(v) { if (!settled) { settled = true; resolve(v); } }
      /* the native door first */
      try {
        if (window.OTA && OTA.checkNow) {
          OTA.checkNow().then(function (r) {
            if (r && r.updated) {
              if (ptrEditing()) { fin(false); return; } // downloaded — lands next launch; never blow away typing
              ptrPaint('update');
              try { OTA.restart(); } catch (e) {}
              fin(true);
              return;
            }
            /* the plain-web answer: fall through to the SW door */
            if (r && r.reason === 'OTA works inside the installed app.') { ptrSwLeg(fin); return; }
            fin(false);
          }).catch(function () { fin(false); });
          return;
        }
      } catch (e) {}
      ptrSwLeg(fin);
    });
  }
  function ptrSwLeg(fin) {
    try {
      if (!('serviceWorker' in navigator)) { fin(false); return; }
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (!reg) { fin(false); return; }
        var apply = function (worker) {
          if (!worker) { fin(false); return; }
          if (ptrEditing()) { fin(false); return; } // the banner stays his door; typing is never blown away
          ptrPaint('update');
          var reloaded = false;
          try {
            navigator.serviceWorker.addEventListener('controllerchange', function () {
              if (!reloaded) { reloaded = true; window.location.reload(); }
            });
          } catch (e) {}
          try { worker.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {}
          setTimeout(function () { if (!reloaded) { reloaded = true; window.location.reload(); } }, 1500);
          fin(true);
        };
        reg.update().then(function () {
          if (reg.waiting) { apply(reg.waiting); return; }
          if (reg.installing) {
            var w = reg.installing, doneWaiting = false;
            var to = setTimeout(function () { if (!doneWaiting) { doneWaiting = true; fin(false); } }, 6000);
            w.addEventListener('statechange', function () {
              if (w.state === 'installed' && !doneWaiting) {
                doneWaiting = true; clearTimeout(to);
                apply(reg.waiting || w);
              }
            });
            return;
          }
          fin(false);
        }).catch(function () { fin(false); });
      }).catch(function () { fin(false); });
    } catch (e) { fin(false); }
  }
  App._ptrVersionLeg = ptrVersionLeg;

  App.ptrRefreshNow = function () {
    if (ptrRefreshing) return Promise.resolve(false);
    if (App.currentView !== 'main' || ptrOverlayOpen()) return Promise.resolve(false);
    ptrRefreshing = true;
    ptrPaint('refreshing');
    try { if (window.CloudSync && CloudSync.syncNow) CloudSync.syncNow(); } catch (e) {}
    var t0 = Date.now();
    return ptrSettleWait(t0).then(function () {
      return ptrVersionLeg();
    }).then(function (steppedIntoUpdate) {
      if (steppedIntoUpdate) {
        /* the page is reloading into the new version — no
           repaint, no '✓ Updated' for a screen that is going away */
        ptrRefreshing = false;
        return true;
      }
      try { ptrRepaint(); } catch (e) {}
      ptrRefreshing = false;
      ptrPaint('done');
      return true;
    });
  };

  App.ptrNoteRepainted = function () { ptrDirtyFor = null; };

  function ptrTouchY(e) {
    var t = (e.touches && e.touches.length) ? e.touches[0]
      : (e.changedTouches && e.changedTouches.length) ? e.changedTouches[0] : null;
    return t ? t.clientY : null;
  }
  function ptrSnapshot(phase, dy) {
    return {
      phase: phase, tracking: !!ptrTrack, refreshing: ptrRefreshing,
      view: App.currentView || '', overlay: ptrOverlayOpen(),
      scrollY: window.scrollY || 0, dy: dy || 0
    };
  }
  try {
    document.addEventListener('touchstart', function (e) {
      if (ptrTrack) { ptrTrack = null; ptrPaint('hide'); return; } // a second finger cancels the pull
      var y = ptrTouchY(e);
      if (y === null) return;
      if (ptrDecide(ptrSnapshot('start', 0)) === 'track') ptrTrack = { y0: y, dy: 0 };
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (!ptrTrack) return;
      var y = ptrTouchY(e);
      if (y === null) return;
      ptrTrack.dy = y - ptrTrack.y0;
      if (ptrDecide(ptrSnapshot('move', ptrTrack.dy)) === 'show') {
        ptrPaint('pull', ptrTrack.dy);
        if (ptrTrack.dy > 8 && e.cancelable) e.preventDefault();
      } else { ptrTrack = null; ptrPaint('hide'); }
    }, { passive: false });
    document.addEventListener('touchend', function () {
      if (!ptrTrack) return;
      var d = ptrDecide(ptrSnapshot('end', ptrTrack.dy));
      ptrTrack = null;
      if (d === 'fire') App.ptrRefreshNow();
      else ptrPaint('hide');
    }, { passive: true });
    document.addEventListener('touchcancel', function () {
      ptrTrack = null; ptrPaint('hide');
    }, { passive: true });
    /* typing on the visible screen marks it dirty for the repaint
       leg — capture phase, main view only; sheets and the chat are
       already behind the overlay guard and never reach the flag */
    document.addEventListener('input', function (e) {
      if (App.currentView !== 'main') return;
      var t = e.target;
      if (!t) return;
      var tag = t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) {
        ptrDirtyFor = ptrScreenKey();
      }
    }, true);
  } catch (e) {}
  /* PTR-END */

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

  /* DYN-TRACKER-BEGIN — the dynamic tracker (v41, owner: "a very key
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
     the stopped session carries it (manualLoads) to the manifest.
     v140: this accumulator is the driver's CORRECTION now, not
     the counter — the movement count (GeoLoads) is the count of
     record on the dashboard and in the shared dayLoads ladder;
     taps are consumed only when the machine has nothing. The
     bookkeeping itself is unchanged. */
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
       count is part of the repaint signature for those modes.
       v140: the count of record is the MACHINE's (js/geoloads.js
       GeoLoads.today()) — the signature carries it, and the face
       below shows it; taps ride along as the correction count. */
    var taps = (mode === 'Hourly' || mode === 'Miles') ? trkAccum().manualLoads : 0;
    var geoToday = null;
    if (mode === 'Hourly' || mode === 'Miles') {
      try { if (window.GeoLoads && GeoLoads.today) geoToday = GeoLoads.today(); } catch (e) { geoToday = null; }
    }
    var sig = mode + '|' + App.tracker.status + '|' + taps + '|' +
      (geoToday ? (geoToday.armed ? 'g' + geoToday.count : 'off') : 'na');
    if (sig === _extraSig) return;
    _extraSig = sig;
    var h = '';
    if (sessionActive() && mode === 'Weight') h = '<button type="button" class="trkAddBtn" id="trkAddLoadBtn">＋ Add load</button>';
    else if (sessionActive() && mode === 'Trip') h = '<button type="button" class="trkAddBtn" id="trkAddTripBtn">＋ Load</button>';
    /* v82 (item 3b): hourly/miles card work gets the big one-tap
       load counter — one tap per load dumped, no form.
       v140: DEMOTED. The day's load count is counted by the app
       from movement and shown as the count; the button is now a
       small correction underneath it — never the counter of
       record, never required. While counting has no site pair
       yet (armed=false), the correction count is what shows,
       honestly, until the machine takes over. */
    else if (sessionActive()) {
      var machineLoads = (geoToday && geoToday.armed) ? geoToday.count : null;
      var shownLoads = (machineLoads !== null) ? machineLoads : taps;
      h = '<div class="trkLoadCount">🚛 Loads today: <b>' + shownLoads + '</b>' +
          (machineLoads !== null ? ' <span class="trkLoadSrc">counted by GPS</span>' : '') + '</div>' +
          '<button type="button" class="trkAddBtn trkFixBtn" id="trkLoadTapBtn">+1 load correction</button>';
    }
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
    if (sec < 0) sec = 0; // v174: an anchored session (start ahead) reads zero until its time
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
    // v174: the standing no-PTI flag rides every tracker paint
    try { paintPtiFlag(); } catch (e) {}
    // v28: show the effective start time + the Edit control
    var st = el('trkStartLabel');
    if (st) {
      if (t.status !== 'idle') {
        st.textContent = 'Counting from ' + fmtTimeAMPM(trackerSessionStartMs());
      } else if (t.presetStart) {
        st.textContent = 'Will count from ' + fmtTimeAMPM(t.presetStart);
      } else {
        /* v123: an armed plan (today's dispatch, a per-day override,
           or the standing setting) shows on the card in plain words
           — never a bare "Starts from now" while a plan exists. */
        var armed = null;
        try { if (App.autostartPlanLabel && App.autostartTodayInfo) armed = App.autostartPlanLabel(App.autostartTodayInfo()); } catch (e) {}
        st.textContent = armed || 'Starts from now';
      }
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
    var presetUsed = false;
    if (t.status === 'idle') {
      t.status = 'running'; t.startTs = Date.now();
      // v28: if a start time was preset ("I actually started at 8:30"), count from there
      presetUsed = !!t.presetStart;
      t.elapsed = t.presetStart ? Math.max(0, Math.floor((Date.now() - t.presetStart) / 1000)) : 0;
      delete t.presetStart;
      resetAccum(); // v41: a fresh shift starts with empty weight/trip totals
    }
    else if (t.status === 'running') { t.elapsed = Math.max(0, t.elapsed + Math.floor((Date.now() - t.startTs) / 1000)); t.status = 'paused'; } // v174: never negative (an anchored start lies ahead)
    else { t.status = 'running'; t.startTs = Date.now(); }
    trackerSave(); trackerPaint();
    // v40: a fresh shift start also starts live-miles tracking (inert
    // when the build has no live location — js/miles.js).
    // v39: a fresh shift start (not a resume) may prompt for the
    // starting odometer — by-mile pay, or any pay mode with the v46
    // "Daily odometer photos" preference on; non-blocking either way.
    if (wasIdle) {
      /* v174: a manual START with a plan for today anchors to the
         PLAN time, exactly like auto-start (owner's settled law:
         the session start is the dispatch's scheduled time —
         never the tap, never movement; Oct 19, 2026 07:26 MDT
         steer). The anchor pins the session identity too, so the
         miles/geofence/native records key to the same 's<8:00>'
         the native arm uses. His own preset ("I actually started
         at…") still wins when he set one. An early tap leaves
         startTs at the anchor: the running clock reads zero
         until the plan time, then counts — the pay clock never
         starts early. */
      var anchorPin = 0;
      if (!presetUsed) {
        try {
          var pA = autoStartPrefs();
          var nowA = new Date(), todayA = todayStr(nowA);
          var planA = autostartPlan(pA, store.get('dsp_active', null), store.get('dsp_list', []), store.get('autostart_override', null), todayA, nowA.getDay());
          if (planA && planA.willStart) {
            anchorPin = autostartTodayMs(todayA, planA.time);
            t.elapsed = Math.max(0, Math.floor((Date.now() - anchorPin) / 1000));
            t.startTs = anchorPin;
          }
        } catch (e) {}
      }
      // v69: pin the session's stable record identity BEFORE anything
      // keys a record by it (see trackerSessionKeyMs) — pinned to the
      // effective start instant at this moment; it never moves again,
      // even if the driver edits the start clock afterwards.
      t.sessionId = anchorPin || trackerSessionStartMs();
      trackerSave();
      try { if (window.LiveMiles) LiveMiles.startDay('s' + trackerSessionKeyMs()); } catch (e) {}
      // v50: geofence load counting rides the same session (js/geoloads.js)
      try { if (window.GeoLoads) GeoLoads.startDay('s' + trackerSessionKeyMs()); } catch (e) {}
      // v63: native background tracking (new shell only) rides it too
      try { if (window.ShiftTrack) ShiftTrack.sessionStarted('s' + trackerSessionKeyMs()); } catch (e) {}
      // v92: today is underway — the native arm now belongs to the NEXT day
      try { App.armNativeDay(); } catch (e) {}
      try { maybePromptOdo('start'); } catch (e) {}
      try { if (App.maybePtiNudge) App.maybePtiNudge(); } catch (e) {} // v174: one PTI nudge as the day starts moving
    }
    // v62: the screen wake lock follows the session state — a pause
    // releases the hold, a resume takes it back (js/miles.js owns it).
    try { if (window.LiveMiles && LiveMiles.syncWake) LiveMiles.syncWake(); } catch (e) {}
  };
  /* v34: stop with an explicit end time. The owner often forgets to press STOP
     when the shift actually ends, so the recorded end overshot. The STOP
     button now opens an end-time sheet (defaults to now — same result as
     before) where he can set the real finish; the saved session's duration
     and endedAt are computed to that end. Mirrors the start-time Edit. */
  function trackedSecondsAt(endMs) {
    var t = App.tracker;
    /* v174: clamped at zero — an anchored session's start can lie
       ahead of an early stop, and a negative duration is never a fact. */
    return Math.max(0, t.elapsed + (t.status === 'running' ? Math.floor((endMs - t.startTs) / 1000) : 0));
  }
  /* v122: set by App.stopSessionOnDispatchClose for the duration
     of its stopSessionAt call — a dispatch-close stop stamps the
     session's closing odometer from the nearest capture the app
     already holds (see inside stopSessionAt); a tracker Stop
     never does (its end prompt follows, as always). */
  var _stopViaDispatch = false;
  /* v143: the End shift sheet's ticket photo (owner, Oct 17
     16:22 MDT — closing the shift offered "no way to choose a
     picture"). Chosen on the sheet, held in memory through the
     close review, and handed to the stop through
     _endTicketPhoto: stopSessionAt consumes it (reads + clears)
     and stamps it on the session entry it saves — the closed
     record of the shift. Any stop consumes it, so a photo can
     never ride into a later day's close. */
  var _endTicketPhoto = null;
  var _endTicketChosen = null;
  var _endClosePending = null; // { end: Date|null, endOdoVal } awaiting the review's Confirm
  function stopSessionAt(endMs, endOdoVal) {
    var viaDispatch = _stopViaDispatch; _stopViaDispatch = false;
    var ticketPhoto = _endTicketPhoto; _endTicketPhoto = null;
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
      // v143: the sheet's ticket photo, when one was chosen and
      // confirmed, lands on the same entry the same way.
      if (ticketPhoto) entry.ticketPhoto = ticketPhoto;
      /* v122: a DISPATCH-CLOSE stop (the path the owner actually
         uses — he closes the day by completing the dispatch, then
         saves the dash reading at night on the Maintenance card)
         stamps the closing odometer from the nearest capture the
         app already holds: the latest entry in the dated readings
         log, else the master itself. Without this the session the
         manifest reads never carries an end reading on his flow,
         and the manifest's Odometer line had nothing to print
         (Oct 17 root cause). Only when no end reading was handed
         in with the stop. */
      if (viaDispatch && !entry.endOdo) {
        var stamp = null, stampTs = -1;
        var rlog = store.get('odo_readings', []);
        if (Array.isArray(rlog)) {
          for (var ri = 0; ri < rlog.length; ri++) {
            var rv = parseFloat(rlog[ri] && rlog[ri].value);
            var rt = parseFloat(rlog[ri] && rlog[ri].ts) || 0;
            if (rv > 0 && rt >= stampTs) { stamp = rv; stampTs = rt; }
          }
        }
        if (!(stamp > 0)) stamp = masterOdometer();
        if (stamp > 0) entry.endOdo = stamp;
      }
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
    _stopViaDispatch = true;
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
    // v143: the close starts on the form step every time — no
    // ticket photo and no pending close may ride in from a
    // previous open (same rule as the odometer field above).
    _endTicketChosen = null; _endClosePending = null;
    var tpv = el('trkEndTicketPreview'); if (tpv) tpv.innerHTML = '';
    var eform = el('trkEndForm'); if (eform) eform.style.display = '';
    var erev = el('trkEndReview'); if (erev) { erev.style.display = 'none'; erev.innerHTML = ''; }
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
    /* v143 (owner, Oct 17 16:22 MDT — "there was no confirmation
       before it actually closed the shift!"): NOTHING stops
       here any more. The values are validated exactly as before,
       held in _endClosePending, and the sheet moves to the close
       review (paintEndReview) — the summary the driver reads,
       with the ticket photo or its absence stated plainly. Only
       the review's Confirm (App.trackerConfirmEnd) runs the
       stop; Back from the review writes nothing. */
    if (!v) {
      _endClosePending = { end: null, endOdoVal: endOdoVal };
      paintEndReview(Date.now());
      return;
    }
    var parts = v.split(':'), startMs = trackerSessionStartMs(), sd = new Date(startMs);
    var end = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate(),
      parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
    if (end.getTime() <= startMs) end = new Date(end.getTime() + 24 * 3600 * 1000); // overnight shift
    if (end.getTime() > Date.now()) end = new Date(); // can't end in the future
    var secs = trackedSecondsAt(end.getTime());
    if (secs <= 0) { alert('That end time is not after the start. Check the times and try again.'); return; }
    if (secs > 12 * 3600 && !confirm('That makes a ' + fmtClock(secs) + ' shift. Is that right?')) { return; }
    _endClosePending = { end: end, endOdoVal: endOdoVal };
    paintEndReview(end.getTime());
  };
  /* v143: the close review's figures — the same inputs the stop
     and Revenue's onSession price from: the hours are the
     tracker's own count at the chosen end, the quantities are
     the session accumulators, and the amount mirrors onSession's
     arithmetic (pay standard × the driver's own rate chain,
     v137) so what the review promises is what Confirm logs. */
  function endCloseSummary(endMs) {
    var secs = trackedSecondsAt(endMs);
    var acc = trkAccum();
    var o = store.get('onboarding', {});
    var std = String(o.payStandard || 'hourly').toLowerCase();
    var rate = parseFloat(o.ownWageRate) || parseFloat(o.payRate) || 0;
    var km = liveKmNow();
    var amount = null;
    if (std === 'miles') {
      if (typeof km === 'number' && km > 0 && rate > 0) amount = km * rate;
    } else if (std === 'weight') {
      var kg = parseFloat(acc.weightKg) || 0;
      if (kg > 0 && rate > 0) amount = (Math.round(kg / 10) / 100) * rate;
    } else if (std === 'trip') {
      var trips = parseInt(acc.tripCount, 10) || 0;
      if (trips > 0 && rate > 0) amount = trips * rate;
    } else if (rate > 0) {
      amount = (secs / 3600) * rate;
    }
    return {
      secs: secs, std: std, km: (typeof km === 'number' ? km : null), amount: amount,
      loads: (parseInt(acc.loadCount, 10) || 0) + (parseInt(acc.manualLoads, 10) || 0),
      trips: parseInt(acc.tripCount, 10) || 0,
      weightKg: parseFloat(acc.weightKg) || 0
    };
  }
  function paintEndReview(endMs) {
    var rev = el('trkEndReview');
    var form = el('trkEndForm');
    if (!rev) {
      /* No review surface (a shell without the v143 sheet):
         never strand a validated close — run the stop the
         pre-v143 way, with the photo handed in. */
      var p0 = _endClosePending; _endClosePending = null;
      _endTicketPhoto = _endTicketChosen; _endTicketChosen = null;
      closeTrackerEndSheet();
      if (p0 && p0.end) { var end0 = p0.end; stopSessionAt(end0.getTime(), p0.endOdoVal); }
      else stopSessionAt(Date.now(), p0 ? p0.endOdoVal : '');
      return;
    }
    var s = endCloseSummary(endMs);
    var startMs = trackerSessionStartMs();
    var p = _endClosePending || {};
    var h = '<p class="note" style="margin:0 0 8px">Check the close — nothing is saved until you confirm.</p>';
    h += '<div class="kv"><span>Date</span><b>' + esc(new Date(startMs).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })) + '</b></div>';
    h += '<div class="kv"><span>Shift</span><b>' + esc(fmtTimeAMPM(startMs)) + ' → ' + esc(fmtTimeAMPM(endMs)) + ' · ' + esc(fmtClock(s.secs)) + '</b></div>';
    if (s.loads > 0) h += '<div class="kv"><span>Loads</span><b>' + s.loads + '</b></div>';
    if (s.trips > 0) h += '<div class="kv"><span>Trips</span><b>' + s.trips + '</b></div>';
    if (s.weightKg > 0) h += '<div class="kv"><span>Weight</span><b>' + (Math.round(s.weightKg / 10) / 100) + ' t</b></div>';
    if (typeof s.km === 'number' && s.km > 0) h += '<div class="kv"><span>Distance</span><b>' + (Math.round(s.km * 10) / 10).toLocaleString('en-CA') + ' km</b></div>';
    if (p.endOdoVal) h += '<div class="kv"><span>End odometer</span><b>' + esc(p.endOdoVal) + ' km</b></div>';
    if (s.amount !== null) h += '<div class="kv"><span>Logs to Revenue</span><b>$' + s.amount.toFixed(2) + '</b></div>';
    if (_endTicketChosen) {
      h += '<img src="' + _endTicketChosen + '" style="width:100%;border-radius:10px;margin:8px 0" alt="Ticket photo">' +
        '<div class="b">📸 Ticket photo — it saves on this close.</div>';
    } else {
      h += '<div class="b" style="color:var(--orange)">No ticket photo — the shift still closes. Go back to add one.</div>';
    }
    var dspA = store.get('dsp_active', null);
    if (dspA) h += '<div class="b">Your dispatch is still open — ending the shift does not close it. Close it from the Dispatch card to log its ticket and pay.</div>';
    h += '<div class="row" style="margin-top:10px">' +
      '<button class="btn ghost" id="trkEndBack">← Back</button>' +
      '<button class="btn primary" id="trkEndConfirm">✅ Confirm — end shift</button></div>';
    rev.innerHTML = h;
    if (form) form.style.display = 'none';
    rev.style.display = '';
    el('trkEndBack').onclick = function () { App.trackerBackEnd(); };
    el('trkEndConfirm').onclick = function () { App.trackerConfirmEnd(); };
  }
  /* v143: Back from the close review — the form returns with
     every value as it was; nothing was written. */
  App.trackerBackEnd = function () {
    var rev = el('trkEndReview');
    var form = el('trkEndForm');
    if (rev) { rev.style.display = 'none'; rev.innerHTML = ''; }
    if (form) form.style.display = '';
  };
  /* v143: the review's Confirm — the ONLY tracker stop that
     comes out of the End shift sheet. Runs the stop with the
     values trackerSaveEnd validated, the sheet's ticket photo
     handed in through _endTicketPhoto. */
  App.trackerConfirmEnd = function () {
    var p = _endClosePending; if (!p) return;
    _endClosePending = null;
    var endOdoVal = p.endOdoVal;
    _endTicketPhoto = _endTicketChosen; _endTicketChosen = null;
    closeTrackerEndSheet();
    var end = p.end;
    if (end) stopSessionAt(end.getTime(), endOdoVal);
    else stopSessionAt(Date.now(), endOdoVal);
  };
  /* v143: the End shift sheet's ticket photo — the 640px thumb
     convention of the dispatch tickets. The choice is held in
     memory and previewed on the form; replacing is tapping
     Take photo / Choose file again. Nothing persists until the
     review's Confirm hands it to the stop. */
  function endTicketThumb(file, cb) {
    var r = new FileReader();
    r.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 640, w = img.width, h = img.height;
        if (w > max || h > max) {
          var sc = Math.min(max / w, max / h);
          w = Math.round(w * sc); h = Math.round(h * sc);
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
  function endSheetTicketHandleFile(file) {
    if (!file) return;
    endTicketThumb(file, function (url) {
      if (!url) return;
      /* the sheet may have closed while the photo was read in */
      var sheet = el('trkEndSheet');
      if (!sheet || !sheet.classList.contains('open')) return;
      _endTicketChosen = url;
      var pv = el('trkEndTicketPreview');
      if (pv) pv.innerHTML = '<img src="' + url + '" style="width:100%;border-radius:10px;margin-top:8px" alt="Ticket photo">' +
        '<p class="note" style="margin:6px 0 0">That photo closes with the shift. Tap Take photo / Choose file again to replace it.</p>';
    });
  }

  /* End-sheet odometer photo: the End shift sheet's own camera/file
     actions — present for EVERY pay mode, unlike the v46 odo prompt
     (by-mile, or the opt-in "Daily odometer photos" preference; that
     sheet stays as-is for its start/end prompts). Same reader
     pipeline as the odo sheet: TicketOCR -> parseOdometerReading ->
     the v63 plausibility gate (a below-master read counts as failed,
     never filled) -> the v59 power-read escalation on a local miss.
     A read only FILLS the editable field — nothing persists until
     "Review the close", and the field may stay blank. Callbacks re-check
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
  /* v142: per-photo race record for the end sheet (see the odo
     sheet's twin below). */
  var _endRace = null;
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
      /* v142: the cloud read starts NOW, in parallel with the
         local read (it used to start only after the local read
         failed — the serial wait the owner clocked in minutes). */
      var race = { km: null, cloudVal: null, delivered: false, prImg: null };
      _endRace = race;
      var startCloud = function (prImg) {
        if (!endOdoLive(token)) return;
        race.prImg = prImg || ocrUrl;
        if (window.PowerRead && PowerRead.beginEarly) {
          var h = PowerRead.beginEarly({ reader: 'odometer', image: race.prImg, origin: { module: 'tracker', label: 'the end-of-shift sheet' } });
          if (h) h.onSettled(function (out) { endSheetCloudSettled(token, race, out); });
        }
      };
      if (TicketOCR.urlToReadImage) TicketOCR.urlToReadImage(ocrUrl, 'odometer', startCloud);
      else startCloud(ocrUrl);
      TicketOCR.recognizeWithRotation(ocrUrl, function (p) {
        try { if (endOdoLive(token)) endOdoSetStatus('📖 Reading photo… ' + Math.round(p * 100) + '%'); } catch (e) {}
      }).then(function (text) {
        if (!endOdoLive(token)) return;
        var km = parseOdometerReading(text);
        if (km && !odoLocalFailed(km)) {
          race.km = km;
          var inp = el('trkEndOdo');
          if (race.delivered && race.cloudVal && String(race.cloudVal) !== String(km)) {
            /* v142: the cloud value reached the field first and
               holds it; the local read speaks in the status line
               only — first confident answer is never displaced
               silently. Save stays the confirm either way. */
            endOdoSetStatus('⚡ Power read: <b>' + Number(race.cloudVal).toLocaleString('en-CA') + ' km</b> is in the field. The on-device read got <b>' + Number(km).toLocaleString('en-CA') + ' km</b> — type that instead if it\'s right, then tap Review the close.');
          } else {
            if (inp) inp.value = km;
            endOdoSetStatus('✓ Read: <b>' + Number(km).toLocaleString('en-CA') + ' km</b> — check the number, fix it if wrong, then tap Review the close.');
          }
        } else {
          if (km && odoImplausible(km) === 'jump') endOdoSetStatus('⚠️ That read (<b>' + Number(km).toLocaleString('en-CA') + ' km</b>) is way past your current odometer (<b>' + Number(odoMasterNow()).toLocaleString('en-CA') + ' km</b>) — it can\'t be right; it\'s likely another number in the photo. Trying the power read…');
          else if (km) endOdoSetStatus('⚠️ That read (<b>' + Number(km).toLocaleString('en-CA') + ' km</b>) is below your current odometer (<b>' + Number(odoMasterNow()).toLocaleString('en-CA') + ' km</b>) — it can\'t be right. Trying the power read…');
          else endOdoSetStatus('⚠️ Couldn\'t read the odometer — type it above, or leave it blank.');
          endSheetOdoPowerRead(race.prImg || ocrUrl, token, race);
        }
      }).catch(function () {
        if (endOdoLive(token)) endOdoSetStatus('⚠️ Couldn\'t read the odometer — type it above, or leave it blank.');
      });
    });
  }
  /* v142: the end sheet's cloud read settles. Same rules as the
     odo sheet's twin: fill an untouched field, correct a field
     still holding exactly the local value, never displace a value
     the driver typed or a first answer already standing. */
  function endSheetCloudSettled(token, race, out) {
    if (!endOdoLive(token) || race !== _endRace) return;
    if (!out || out.status !== 'done') return;
    var v = out.fields && out.fields.value;
    if (!v) return;
    race.cloudVal = v;
    if (race.delivered) return;
    var inp = el('trkEndOdo');
    if (!race.km) {
      if (inp && !inp.value) {
        inp.value = v;
        race.delivered = true;
        endOdoSetStatus('⚡ Power read: <b>' + Number(v).toLocaleString('en-CA') + ' km</b> — check the number, fix it if wrong, then tap Review the close.');
      }
      return;
    }
    if (String(v) === String(race.km)) {
      endOdoSetStatus('✓ Power read agrees: <b>' + Number(v).toLocaleString('en-CA') + ' km</b> — check the number, fix it if wrong, then tap Review the close.');
      return;
    }
    if (inp && String(inp.value) === String(race.km)) {
      inp.value = v;
      endOdoSetStatus('⚡ Power read corrected it: <b>' + Number(v).toLocaleString('en-CA') + ' km</b> — check the number, fix it if wrong, then tap Review the close.');
    } else {
      endOdoSetStatus('⚡ Power read got <b>' + Number(v).toLocaleString('en-CA') + ' km</b> — type it above if that\'s the right one, otherwise keep yours.');
    }
  }
  /* Power-read escalation for the end sheet — mirrors the odo
     sheet's: the cloud value fills this same field, and the sheet's
     Review the close leads to the confirm. A skip (off / no key) is reported
     in the sheet, never silent. */
  function endSheetOdoPowerRead(ocrUrl, token, race) {
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
        /* v142: the settle callback may already have filled this
           exact value (the cloud beat the local read) — don't
           repaint it. */
        if (race) {
          race.cloudVal = v;
          if (race.delivered) return;
          race.delivered = true;
        }
        var inp = el('trkEndOdo');
        if (inp) inp.value = v;
        endOdoSetStatus('⚡ Power read: <b>' + Number(v).toLocaleString('en-CA') + ' km</b> — check the number, fix it if wrong, then tap Review the close.');
      }
    });
  }

  /* ODO-PROMPT-BEGIN — day odometer prompts (v39, generalized v46).
     Decision + record-keeping only (DOM lives in maybePromptOdo below).
     Harness-extractable: may use `store`, `App.tracker`, `todayStr`,
     `trackerSave` and the ODO-MASTER helpers.
     Rules (owner, Oct 13 + Oct 14): pay mode is onboarding.payStandard;
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
  /* v174: THE PTI READING IS THE DAY'S START READING (owner,
     Oct 19, 2026 07:38 MDT, live from the road: he filed his
     PTI WITH the dash photo, then the shift start asked him to
     snap the SAME dash again — "PTI odometer must populate
     everywhere — no second photo at shift start"). The PTI
     commit lands in the dated readings log with source 'pti'
     (App._bumpOdometer from modules/pti.js); the EARLIEST such
     reading of the day is the day's start boundary — the same
     one the manifest reads. The filed pre-trip report itself
     is the fallback evidence (a reading whose master bump was
     refused still stands on the report he signed). */
  function ptiStartOdoFor(dateStr) {
    var log = store.get('odo_readings', []);
    var best = null, bestTs = Infinity;
    if (Array.isArray(log)) {
      for (var i = 0; i < log.length; i++) {
        var r = log[i];
        if (r && r.date === dateStr && r.source === 'pti' && parseFloat(r.value) > 0) {
          var ts = parseFloat(r.ts) || 0;
          if (ts < bestTs) { bestTs = ts; best = parseFloat(r.value); }
        }
      }
    }
    if (best > 0) return best;
    var reps = store.get('pti_reports', []);
    if (Array.isArray(reps)) {
      for (var j = reps.length - 1; j >= 0; j--) {
        var rp = reps[j];
        if (rp && rp.date === dateStr && rp.kind !== 'post' && parseFloat(rp.odometer) > 0) return parseFloat(rp.odometer);
      }
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
      /* v174: a PTI reading for today IS the start reading —
         the photo prompt never asks for a second one. */
      if (ptiStartOdoFor(today)) return false;
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
    bumpOdometer(n, 'session');
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
        // miles against the odometer (the owner's confirmation rule).
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
    bumpOdometer(n, 'session');
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
    /* v174: no sheet reading was taken — the day's PTI reading
       is the session's startOdo (it populates everywhere the
       sheet reading would have: the manifest's day boundary,
       the day's miles pair, Revenue's by-mile fallback). */
    return ptiStartOdoFor(sessionStartDate);
  }
  /* ODO-PROMPT-END */

  /* PTI-NUDGE-BEGIN — v174: DRIVING WITHOUT A PTI FILED PROMPTS
     A NUDGE (owner, Oct 19, 2026 07:40 MDT). It is not legal to
     drive the truck without an inspection on file, so when the
     day starts moving (a manual Start, or the auto-start) with
     NO PTI filed for today, the app says so ONCE — one clear
     sheet with a direct door into the PTI form (index.html
     #ptiNudgeSheet) — and then never nags again that day: the
     standing flag on the tracker card (paintPtiFlag) stays
     visible until he files. The PTI also feeds the day (its
     dash photo is the day's starting odometer — see
     ptiStartOdoFor), which is the second reason the prompt
     matters. Decision + record-keeping only; harness-
     extractable: may use `store`, `App`, `todayStr`. */
  function ptiFiledFor(dateStr) {
    /* v187 (PTI-DASH, owner Oct 21, 2026 07:19 MDT): the PTI
       module's filedFor is THE filed-state source — the dashboard
       card reads it, so the banner reads it too, and the two can
       never disagree again. The local loop below remains only as
       the fallback for a shell paint that lands before the PTI
       module has loaded. */
    try {
      var pm = window.Meticulous && Meticulous.modules && Meticulous.modules.pti;
      if (pm && typeof pm.filedFor === 'function') return !!pm.filedFor(dateStr);
    } catch (e) {}
    var reps = store.get('pti_reports', []);
    if (!Array.isArray(reps)) return false;
    for (var i = 0; i < reps.length; i++) {
      var r = reps[i];
      if (r && r.date === dateStr && r.kind !== 'post') return true;
    }
    return false;
  }
  function ptiNudgeShown(dateStr) {
    var rec = store.get('pti_nudge', {});
    return !!(rec && rec.date === dateStr);
  }
  function shouldNudgePti() {
    if (App.userRole && App.userRole() === 'office') return false; // office never drives
    var today = todayStr(new Date());
    if (ptiFiledFor(today)) return false;
    if (ptiNudgeShown(today)) return false;
    return true;
  }
  function markPtiNudgeShown() {
    store.set('pti_nudge', { date: todayStr(new Date()), ts: Date.now() });
  }
  /* The standing flag: visible whenever the day is a driving day
     (a session running/paused, or a plan standing for today) and
     no PTI is filed — including BEFORE the start, so the morning
     face already carries it. Gone the moment he files. */
  function ptiFlagVisible() {
    if (App.userRole && App.userRole() === 'office') return false;
    var today = todayStr(new Date());
    if (ptiFiledFor(today)) return false;
    var t = App.tracker || { status: 'idle' };
    if (t.status === 'running' || t.status === 'paused') return true;
    try {
      var p = autoStartPrefs();
      var plan = autostartPlan(p, store.get('dsp_active', null), store.get('dsp_list', []), store.get('autostart_override', null), today, new Date().getDay());
      return !!(plan && plan.willStart);
    } catch (e) { return false; }
  }
  /* PTI-NUDGE-END */

  function closePtiNudge() {
    var s = el('ptiNudgeSheet');
    if (s) s.classList.remove('open');
    var sc = el('scrim');
    if (sc) { sc.classList.remove('show'); sc.onclick = closeSidebar; }
  }
  /* Called from BOTH start paths the moment a session begins.
     Marks BEFORE showing — once per day, whatever happens next. */
  App.maybePtiNudge = function () {
    if (!shouldNudgePti()) return false;
    markPtiNudgeShown();
    var sheet = el('ptiNudgeSheet');
    if (!sheet) return false;
    sheet.classList.add('open');
    var sc = el('scrim');
    if (sc) { sc.classList.add('show'); sc.onclick = function () { closePtiNudge(); }; }
    return true;
  };
  App.ptiNudgeGo = function () {
    closePtiNudge();
    App.openModule('pti');
  };
  App.ptiNudgeLater = function () { closePtiNudge(); };
  /* Wired + painted from trackerPaint: the flag is a door, not
     just a warning — tapping it opens the PTI form.
     v187 (PTI-DASH): also painted from buildDashboard (every
     dashboard paint, incl. the cloud-sync repaint) and directly
     by the PTI module the moment a report is filed — the flag
     used to repaint only inside trackerPaint, so a filed PTI
     never cleared it until the next tracker action, while the
     PTI card beside it (painted on dashboard paints) already
     read filed. One source (pti.filedFor) + a repaint on every
     surface that shows it ends the disagreement. */
  function paintPtiFlag() {
    var f = el('trkPtiFlag');
    if (!f) return;
    var show = false;
    try { show = ptiFlagVisible(); } catch (e) { show = false; }
    if (show) {
      f.textContent = '⚠ No PTI filed today — tap to file';
      f.classList.remove('hidden');
      f.onclick = function () { App.openModule('pti'); };
    } else {
      f.classList.add('hidden');
      f.onclick = null;
    }
  }
  App.paintPtiFlag = paintPtiFlag;

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
  /* v142: per-photo race record for the odo sheet. */
  var _odoRace = null;
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
      if (_odoPromptKind !== kindAtStart) return;
      /* v142: the cloud read starts NOW, in parallel with the
         local read — the morning-departure wait the owner clocked
         was the two reads running one after another. */
      var race = { km: null, cloudVal: null, delivered: false, prImg: null };
      _odoRace = race;
      var startCloud = function (prImg) {
        if (_odoPromptKind !== kindAtStart) return;
        race.prImg = prImg || ocrUrl;
        if (window.PowerRead && PowerRead.beginEarly) {
          var h = PowerRead.beginEarly({ reader: 'odometer', image: race.prImg, origin: { module: 'tracker', label: 'the odometer prompt' } });
          if (h) h.onSettled(function (out) { odoSheetCloudSettled(kindAtStart, race, out); });
        }
      };
      if (TicketOCR.urlToReadImage) TicketOCR.urlToReadImage(ocrUrl, 'odometer', startCloud);
      else startCloud(ocrUrl);
      TicketOCR.recognizeWithRotation(ocrUrl, function (p) {
        try { setStatus('📖 Reading photo… ' + Math.round(p * 100) + '%'); } catch (e) {}
      }).then(function (text) {
        var km = parseOdometerReading(text);
        if (km && !odoLocalFailed(km)) {
          race.km = km;
          var inp = el('odoSheetVal');
          if (race.delivered && race.cloudVal && String(race.cloudVal) !== String(km)) {
            /* v142: the cloud value holds the field (it landed
               first); the local read speaks in the status line. */
            setStatus('⚡ Power read: <b>' + Number(race.cloudVal).toLocaleString('en-CA') + ' km</b> is in the field. The on-device read got <b>' + Number(km).toLocaleString('en-CA') + ' km</b> — type that instead if it\'s right, then tap Save reading.');
          } else {
            if (inp) inp.value = km;
            setStatus('✓ Read: <b>' + Number(km).toLocaleString('en-CA') + ' km</b> — check the number, fix it if wrong, then tap Save reading.');
          }
        } else {
          /* v59: local read found nothing → power-read escalation.
             The value fills this same field; the sheet's Save reading
             stays the confirm. v63: an impossible below-master value
             (odoLocalFailed) takes the same path — never filled into
             the sheet — and a skip is reported, never silent. */
          if (km && odoImplausible(km) === 'jump') setStatus('⚠️ That read (<b>' + Number(km).toLocaleString('en-CA') + ' km</b>) is way past your current odometer (<b>' + Number(odoMasterNow()).toLocaleString('en-CA') + ' km</b>) — it can\'t be right; it\'s likely another number in the photo. Trying the power read…');
          else if (km) setStatus('⚠️ That read (<b>' + Number(km).toLocaleString('en-CA') + ' km</b>) is below your current odometer (<b>' + Number(odoMasterNow()).toLocaleString('en-CA') + ' km</b>) — it can\'t be right. Trying the power read…');
          else setStatus('⚠️ Couldn\'t read the odometer — type it below, or tap Skip.');
          odoSheetPowerRead(race.prImg || ocrUrl, kindAtStart, race);
        }
      }).catch(function () {
        setStatus('⚠️ Couldn\'t read the odometer — type it below, or tap Skip.');
      });
    });
  }
  /* v142: the odo sheet's cloud read settles — same rules as the
     end sheet's twin (fill untouched, correct the exact local
     value, never displace the driver's own edit). */
  function odoSheetCloudSettled(kindAtStart, race, out) {
    if (_odoPromptKind !== kindAtStart || race !== _odoRace) return;
    if (!out || out.status !== 'done') return;
    var v = out.fields && out.fields.value;
    if (!v) return;
    race.cloudVal = v;
    if (race.delivered) return;
    var st = el('odoSheetStatus'); if (!st) return;
    var inp = el('odoSheetVal');
    if (!race.km) {
      if (inp && !inp.value) {
        inp.value = v;
        race.delivered = true;
        st.innerHTML = '⚡ Power read: <b>' + Number(v).toLocaleString('en-CA') + ' km</b> — check the number, fix it if wrong, then tap Save reading.';
      }
      return;
    }
    if (String(v) === String(race.km)) {
      st.innerHTML = '✓ Power read agrees: <b>' + Number(v).toLocaleString('en-CA') + ' km</b> — check the number, fix it if wrong, then tap Save reading.';
      return;
    }
    if (inp && String(inp.value) === String(race.km)) {
      inp.value = v;
      st.innerHTML = '⚡ Power read corrected it: <b>' + Number(v).toLocaleString('en-CA') + ' km</b> — check the number, fix it if wrong, then tap Save reading.';
    } else {
      st.innerHTML = '⚡ Power read got <b>' + Number(v).toLocaleString('en-CA') + ' km</b> — type it below if that\'s the right one, otherwise keep yours.';
    }
  }
  /* v59: power-read escalation for the day start/end odometer sheet.
     Callbacks re-check the sheet is still on the same prompt before
     touching it — a late answer never hijacks a later prompt. */
  function odoSheetPowerRead(ocrUrl, kindAtStart, race) {
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
        /* v142: no double-paint when the settle callback already
           delivered this value. */
        if (race) {
          race.cloudVal = v;
          if (race.delivered) return;
          race.delivered = true;
        }
        var inp = el('odoSheetVal');
        if (inp) inp.value = v;
        st.innerHTML = '⚡ Power read: <b>' + Number(v).toLocaleString('en-CA') + ' km</b> — check the number, fix it if wrong, then tap Save reading.';
      }
    });
  }

  /* ---------------- timed auto-start ---------------- */
  // v27: start the tracker by itself at a set time on chosen days.
  // Time-based ONLY — no location/GPS involved. Runs when the app is open
  // (minute check + resume check); if the app was closed, the session
  // starts backdated to the set time on next open (v123 — the old
  // prompt-on-open is gone; see checkAutoStart).
  /* AUTOSTART-ENGINE-BEGIN
     v53: this whole region (prefs -> pure effective-time functions ->
     App.checkAutoStart + the Revenue-card helpers) is harness-extractable
     by design — tools/dispatch-autostart-test.js slices it out verbatim
     and drives it over an in-memory store. Keep it free of DOM access;
     it may use: store, todayStr, App, resetAccum, trackerSave,
     trackerPaint, maybePromptOdo, trackerSessionStartMs.
     v123: tools/movement-arm-test.js slices the same region and pins
     the armed-plan label + the start-stamped-at-the-planned-time
     rule over a fake clock. */
  /* v123: no grace window and no prompt anymore. The owner's rule
     (Oct 17, 2026, correcting his own looser phrasing the same
     morning): the session start time is ALWAYS the planned time —
     "Has to start on at 8 AM not earlier" — and when the app wakes
     or is opened late, the session starts backdated to that time,
     silently. The v27/v53 prompt ("Start the tracker now?") was
     itself a way the tracker never came to life in the field:
     Oct 17 the dispatch flipped ACTIVE at 07:22, he drove 15+ km,
     and at 07:38 the dashboard still showed "Ready to work ·
     00:00:00 · Starts from now". */

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
     The owner (Oct 14, 2026): "whatever the start time says on the Dispatch…
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
  /* The dispatch that supplies today's start: the earliest eligible
     scheduled time (active considered first, dedup by id, completed /
     cancelled have no claim). Returns { time, name } or null — the
     name (jobSite, else pickup) is what the armed dashboard plan
     shows, so the card can say WHICH dispatch starts the day. */
  function autostartDispatchFor(active, list, today) {
    var best = null, bestName = '', seen = {};
    function consider(d) {
      if (!d || typeof d !== 'object') return;
      if (d.status === 'completed' || d.status === 'cancelled') return;
      if (d.id) { if (seen[d.id]) return; seen[d.id] = 1; }
      var p = autostartParseSched(d.scheduledAt);
      if (!p || p.date !== today) return;
      if (best === null || p.time < best) { best = p.time; bestName = d.jobSite || d.pickup || ''; }
    }
    consider(active);
    if (Array.isArray(list)) for (var i = 0; i < list.length; i++) consider(list[i]);
    return best === null ? null : { time: best, name: bestName };
  }
  function autostartDispatchTimeFor(active, list, today) {
    var w = autostartDispatchFor(active, list, today);
    return w ? w.time : null; // 'HH:MM' or null
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
      if (!plan.willStart) {
        /* v174: no plan for today — a day watch armed earlier
           (before today's dispatch was cancelled) stands down. */
        try {
          if (window.LiveMiles && LiveMiles.dayKey && LiveMiles.dayKey() === 'd' + today && LiveMiles.stopDay) LiveMiles.stopDay();
        } catch (e) {}
        return plan.reason;
      }
      if (autoStartFired(today)) return 'fired';
      var t = App.tracker || { status: 'idle' };
      if (t.status === 'running') { markAutoStartFired(today); return 'running'; }
      /* v123: a day that already has a closed session never gets a
         second, phantom auto-start. The once-a-day fired flag is the
         primary guard; this catches the flows that ran entirely
         between checks (start + stop inside one backgrounding). */
      var sessions = store.get('sessions', []);
      if (Array.isArray(sessions)) {
        for (var si = 0; si < sessions.length; si++) {
          if (sessions[si] && sessions[si].date === today) { markAutoStartFired(today); return 'done-today'; }
        }
      }
      var tp = String(plan.time).split(':');
      var startMins = (+tp[0] || 0) * 60 + (+tp[1] || 0);
      var nowMins = now.getHours() * 60 + now.getMinutes();
      if (nowMins < startMins) {
        /* v174: KMS COUNT FROM FIRST MOVEMENT, NOT SHIFT START
           (owner, Oct 19, 2026 06:57 MDT — live evidence 07:26:
           driving to the pit with the 8:00 dispatch armed, the
           face read "Ready to work · 00:00:00" and no distance
           counted). The SESSION still starts at the plan time —
           that law does not move — but DISTANCE is separate:
           arm the date-keyed day watch now, so the miles engine
           records from the first movement of the day, the face's
           live-miles line counts it up while the clock still
           waits for 8:00, and the session adopts the whole day
           record when it starts (js/miles.js adoptableFragments:
           the date key is adopted whole). */
        if (t.status === 'idle') {
          try { if (window.LiveMiles && LiveMiles.startDay) LiveMiles.startDay('d' + today); } catch (e) {}
        }
        return 'not-yet';
      }
      /* v123: his pause is his — auto-start never force-resumes a
         session he paused. The fired flag stays unset here: if he
         resumes, the running branch consumes it; if he stops, the
         done-today guard above does. */
      if (t.status === 'paused') return 'paused';
      /* v123 (owner, Oct 17, 2026): the plan time has arrived — START,
         stamped with the planned time, at ANY lateness, with no
         prompt. "Has to start on at 8 AM not earlier": the anchor is
         the dispatch's scheduled time, a per-day override, or the
         standing setting — the fallback behaves identically — never
         the wake time, and never an earlier movement time (movement
         only ARMS: yardstart flips the dispatch ACTIVE; it stamps
         nothing). A late start announces itself by notification,
         exactly like an on-time one. */
      var label = autoStartLabel(plan.time);
      markAutoStartFired(today);
      var anchorMs = autostartTodayMs(today, plan.time);
      App.tracker.status = 'running';
      App.tracker.startTs = Date.now();
      App.tracker.elapsed = Math.max(0, Math.floor((Date.now() - anchorMs) / 1000));
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
      try { if (App.maybePtiNudge) App.maybePtiNudge(); } catch (e) {} // v174: one PTI nudge as the day starts moving
      return 'started';
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
    var win = autostartDispatchFor(active, list, today);
    return {
      enabled: p.enabled,
      dayOk: Array.isArray(p.days) && p.days.indexOf(now.getDay()) !== -1,
      willStart: plan.willStart,
      reason: plan.reason || 'ok',
      time: plan.time || p.time,
      source: plan.source || 'setting',
      label: autoStartLabel(plan.time || p.time),
      settingTime: p.time,
      dispatchTime: win ? win.time : null,
      dispatchName: win ? win.name : '',
      overrideTime: oTime,
      fired: autoStartFired(today)
    };
  };
  /* v123: the armed plan in plain words, for the dashboard tracker
     card (trackerPaint). One read of the same plan checkAutoStart
     runs on: while a plan exists and has not fired, the card says
     when the day starts — "Starts 8:00 AM · Maple Ridge" — instead
     of the bare "Starts from now" that showed at 07:38 on Oct 17
     with an ACTIVE 8:00 dispatch already in hand. Returns null when
     there is nothing armed to promise (no plan today, or the plan
     already fired and the day is underway / done). */
  App.autostartPlanLabel = function (info) {
    if (!info || !info.willStart || info.fired) return null;
    var s = 'Starts ' + info.label;
    if (info.source === 'dispatch' && info.dispatchName) s += ' · ' + info.dispatchName;
    else if (info.source === 'override') s += ' (changed for today)';
    return s;
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
        /* v136: the truth in owner-readable pieces — when the last
           full settle happened, which store is failing (plain words),
           and whether only live tracking is still catching up. */
        if (st.lastSettledLabel) lines.push('Last fully backed up: ' + st.lastSettledLabel);
        if (st.failKey) lines.push('Not backing up: ' + (st.failPlain || st.failKey));
        if (st.telemetryBehind) lines.push('Live tracking (miles + loads) is still catching up — your records are backed up.');
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
    /* v147 (owner, Oct 17 21:31 MDT): the FIRST question is the
       person's own name — "why are we not asking first and last
       name?" Setup never asked, so Connect identity fell back to
       the business name (a man listed as a company) or an
       email-derived string, and nobody could find or recognize
       the person. The fields may be left blank (asking is fine,
       walling is not) — Finish marks the question asked
       (nameAsked) so the one-time dashboard ask never repeats it. */
    { key: 'name', title: 'What is your name?', hint: 'How people you connect with will find and recognize you — Connect is between people. Your business name still shows under your name.',
      type: 'name' },
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
  /* v147: the account-type question gets the SAME must-answer law
     as the role question — until now it could be walked past
     unanswered while every downstream fallback (identity role,
     the Preferences role note, the Preferences select) treated
     the missing answer as 'Driver', so accounts were mis-typed
     from birth. The step def still carries no pre-selection:
     optGrid marks an option only when the record holds the value. */
  var _onbTypeNudge = false; // set when a mover is blocked at the type question
  function isAccountType(v) { return v === 'Driver' || v === 'Owner-Operator' || v === 'Fleet Manager'; }
  function onbTypeStepIndex() {
    for (var i = 0; i < ONB_STEPS.length; i++) { if (ONB_STEPS[i].key === 'accountType') return i; }
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
    if (st.type === 'name') {
      /* v147: the person's own name — plain text fields, collected
         by collectOnbInputs like every other typed answer. */
      h += '<label class="f">First name</label><input id="ob_fname" value="' + esc(o.firstName || '') + '">' +
        '<label class="f">Last name</label><input id="ob_lname" value="' + esc(o.lastName || '') + '">';
    } else if (st.type === 'opts') {
      h += optGrid(st.opts, o[st.key]);
      /* v76 (F1): blocked at the role question — say so HERE, at the
         question, in plain words (never a silent no-op). */
      if (st.key === 'userRole' && _onbRoleNudge && !isUserRole(o.userRole)) {
        h += '<p class="hint" id="onb_role_warn" style="color:#b3541e;font-weight:700;margin-top:10px">👆 Pick one to continue — this decides your home screen. You can change it later in Preferences.</p>';
      }
      /* v147: the same law at the type question — it decides what
         the directory calls this account, and until now the
         fallbacks quietly answered "Driver" for him. */
      if (st.key === 'accountType' && _onbTypeNudge && !isAccountType(o.accountType)) {
        h += '<p class="hint" id="onb_type_warn" style="color:#b3541e;font-weight:700;margin-top:10px">👆 Pick one to continue — this shapes what the app tracks for you. You can change it later in Preferences.</p>';
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
      h += '<div class="card"><div class="kv"><span>Name</span><b>' + esc(((o.firstName || '') + ' ' + (o.lastName || '')).trim() || '—') + '</b></div>' +
        '<div class="kv"><span>Account</span><b>' + esc(o.accountType || '—') + '</b></div>' +
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
        if (st.key === 'userRole') { _onbRoleNudge = false; o.roleStamped = 'answer'; } // answered — the gate is satisfied (v177 D7: mark the genuine pick)
        if (st.key === 'accountType') _onbTypeNudge = false; // v147: same
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
    /* v34: prefer the TOTAL odometer over the trip meter. On the owner's dash
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
  /* v122: THE DATED ODOMETER LOG (store key 'odo_readings').
     The master is ONE undated number — the manifest needs to know
     what the dash read at the START and END of a given day, and
     before v122 no dated record existed for it to draw a day's
     boundaries from (Oct 17 root cause: the owner's readings
     existed — in the master, saved at night on the Maintenance
     card — but the manifest reads session startOdo/endOdo, which
     his close-by-dispatch workflow never fills, so the Odometer
     line silently vanished with the section ON). Every capture
     that lands on the master now also lands here as
     {ts, date, value, source}. The master's upward-only semantics
     are unchanged; this log only REMEMBERS.
     Trust rules: an ordinary capture BELOW the current master is
     a stale or misread number and is refused (it would poison a
     day boundary with a backwards value at a fresh timestamp);
     only a supervised correction (isCorrection — the audited
     Maintenance/Preferences/Fuel correction paths, whose whole
     point is moving the master deliberately) may log below it.
     A repeat of the same value inside a minute collapses. */
  function logOdoReading(value, source, tsMs, isCorrection) {
    var n = parseFloat(value);
    if (!(n > 0)) return false;
    var master = masterOdometer();
    if (!isCorrection && master !== null && n < master) return false;
    var ts = (typeof tsMs === 'number' && isFinite(tsMs) && tsMs > 0) ? Math.round(tsMs) : Date.now();
    var d = new Date(ts);
    var date = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    var log = store.get('odo_readings', []);
    if (!Array.isArray(log)) log = [];
    var last = log[log.length - 1];
    if (last && parseFloat(last.value) === n && Math.abs(ts - (parseFloat(last.ts) || 0)) < 60000) return false;
    log.push({ ts: ts, date: date, value: n, source: String(source || 'app') });
    if (log.length > 2000) log = log.slice(log.length - 2000);
    store.set('odo_readings', log);
    return true;
  }
  /* v127: SEED THE DATED LOG FROM DATED RECORDS THE APP ALREADY
     HOLDS. The log was born with v122 (Oct 17), so every reading
     captured before that morning exists in the app — as a fuel
     fill's odometer (with the fill's date/time) or a session's
     start/end odometer (with its stamps) — but has no dated-log
     entry, and the manifest honestly reported "no readings
     captured" for days the driver HAD photographed (owner,
     Oct 17 09:53 MDT: "I uploaded that to you last night!"). The
     seed derives log entries from exactly that evidence — never
     from the undated master, which proves a value but not a
     moment. Rules:
       - a candidate already in the log (same value, same date)
         is skipped, so re-running adds nothing (idempotent —
         it runs on every app open);
       - fills are walked in the order they happened as an
         ascending chain: a stamp that runs backwards, or leaps
         more than 50,000 km past the previous accepted stamp
         (the economy sanity rule's leg ceiling), or sits more
         than ODO_MAX_JUMP_KM past the master, is skipped — the
         Oct 15 receipt whose invoice number (519,326) was saved
         as an odometer can never seed a day boundary;
       - seeded entries carry their source ('seed-fill' /
         'seed-session') so every boundary stays auditable;
       - the manifest's boundary rules are untouched — the seed
         only supplies evidence, it decides nothing. */
  function seedOdoReadings() {
    var log = store.get('odo_readings', []);
    if (!Array.isArray(log)) log = [];
    var have = {};
    log.forEach(function (r) {
      if (r && parseFloat(r.value) > 0 && r.date) have[String(parseFloat(r.value)) + '|' + String(r.date)] = true;
    });
    var added = [];
    function consider(value, ts, source) {
      var v = parseFloat(value);
      if (!(v > 0)) return;
      if (!(typeof ts === 'number' && isFinite(ts) && ts > 0)) return;
      var d = new Date(ts);
      var date = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
      var key = String(v) + '|' + date;
      if (have[key]) return;
      have[key] = true;
      added.push({ ts: Math.round(ts), date: date, value: v, source: source });
    }
    function dayTs(dateStr, timeStr) {
      var p = String(dateStr || '').split('-');
      if (p.length !== 3) return null;
      var hh = 12, mm = 0;
      var tm = /(\d{1,2}):(\d{2})/.exec(String(timeStr || ''));
      if (tm) { hh = parseInt(tm[1], 10); mm = parseInt(tm[2], 10); }
      var t = new Date(+p[0], +p[1] - 1, +p[2], hh, mm).getTime();
      return isFinite(t) ? t : null;
    }
    /* fuel fills — the pump readings, in the order they happened */
    var master = masterOdometer();
    var fills = store.get('fuel_fills', []);
    if (Array.isArray(fills)) {
      var stamped = fills.filter(function (f) { return f && parseFloat(f.odo) > 0 && dayTs(f.date, f.time) !== null; });
      stamped.sort(function (a, b) {
        var dt = dayTs(a.date, a.time) - dayTs(b.date, b.time);
        return dt !== 0 ? dt : parseFloat(a.odo) - parseFloat(b.odo);
      });
      var lastV = 0;
      stamped.forEach(function (f) {
        var v = parseFloat(f.odo);
        if (master !== null && v > master + ODO_MAX_JUMP_KM) return;
        if (lastV > 0 && (v < lastV || v - lastV > 50000)) return;
        lastV = v;
        consider(v, dayTs(f.date, f.time), 'seed-fill');
      });
    }
    /* sessions — the day start/end readings the by-mile flow saved */
    var sessions = store.get('sessions', []);
    if (Array.isArray(sessions)) {
      sessions.forEach(function (s) {
        if (!s) return;
        var endMs = (typeof s.endedAt === 'number') ? s.endedAt : Date.parse(s.endedAt);
        if (!(isFinite(endMs) && endMs > 0)) return;
        var startMs = endMs - (parseFloat(s.seconds) || 0) * 1000;
        if (parseFloat(s.startOdo) > 0) consider(s.startOdo, startMs, 'seed-session');
        if (parseFloat(s.endOdo) > 0) consider(s.endOdo, endMs, 'seed-session');
      });
    }
    /* v163: TWO MORE DATED SOURCES the app already holds —
       maintenance service events (mt_events carry the dash
       reading the service was logged at, with their date) and
       filed PTI reports (pti_reports carry the inspection's
       odometer with their filing moment). Both are walked as
       ONE ascending chain under the fills' own discipline (a
       stamp that runs backwards, leaps more than 50,000 km, or
       sits more than the jump gate past the master is skipped),
       so a service or inspection reading from before the log
       existed can open the lifetime window the way a fill can —
       the Oct 18 face claimed readings "start 2026-10-13" while
       older dated evidence sat unseeded in these two stores. */
    var extra = [];
    var mtEvents = store.get('mt_events', []);
    if (Array.isArray(mtEvents)) {
      mtEvents.forEach(function (e) {
        if (!e || !(parseFloat(e.odo) > 0)) return;
        var t = dayTs(e.date, '');
        if (t !== null) extra.push({ v: parseFloat(e.odo), ts: t, source: 'seed-event' });
      });
    }
    var ptiReports = store.get('pti_reports', []);
    if (Array.isArray(ptiReports)) {
      ptiReports.forEach(function (r) {
        if (!r || !(parseFloat(r.odometer) > 0)) return;
        var t = (typeof r.filedAt === 'number' && isFinite(r.filedAt) && r.filedAt > 0)
          ? r.filedAt : dayTs(r.date, '');
        if (t !== null && t !== undefined) extra.push({ v: parseFloat(r.odometer), ts: t, source: 'seed-pti' });
      });
    }
    extra.sort(function (a, b) { return a.ts - b.ts; });
    var lastX = 0;
    extra.forEach(function (c) {
      if (master !== null && c.v > master + ODO_MAX_JUMP_KM) return;
      if (lastX > 0 && (c.v < lastX || c.v - lastX > 50000)) return;
      lastX = c.v;
      consider(c.v, c.ts, c.source);
    });
    if (!added.length) return 0;
    var merged = log.concat(added);
    merged.sort(function (a, b) { return (parseFloat(a.ts) || 0) - (parseFloat(b.ts) || 0); });
    /* the log's own same-value collapse, applied across the seam */
    var out = [];
    merged.forEach(function (r) {
      var prev = out[out.length - 1];
      if (prev && parseFloat(prev.value) === parseFloat(r.value) && Math.abs((parseFloat(r.ts) || 0) - (parseFloat(prev.ts) || 0)) < 60000) return;
      out.push(r);
    });
    if (out.length > 2000) out = out.slice(out.length - 2000);
    store.set('odo_readings', out);
    return added.length;
  }
  /* v185 (ODO-BACKFILL, owner Oct 20 21:12 MDT — "I have them
     since May of this year… Upload them!"): the BULK import for
     dated past readings (his monthly sheets). There is no safe
     direct write into his phone's store from outside the app,
     so the import is an in-app CONFIRM-FIRST door (Maintenance →
     past-reading box): the driver pastes the list, reviews the
     parsed result, and only a Confirm tap calls this. The merge
     follows the seed's discipline exactly: dedupe on value|date,
     candidates walked in date order as an ascending chain (a
     candidate that runs backwards from the previous kept entry,
     leaps more than 50,000 km past it, or sits more than the
     jump gate past the master is skipped and COUNTED, never
     silently dropped), existing entries are never removed or
     rewritten, the master is never touched, and the merged log
     is stored sorted by ts. Imported entries carry the source
     the caller names (default 'sheet-import') so every boundary
     stays auditable, exactly like the seed sources. */
  function importOdoReadings(list, source) {
    if (!Array.isArray(list)) return { added: 0, skipped: 0 };
    var log = store.get('odo_readings', []);
    if (!Array.isArray(log)) log = [];
    var have = {};
    log.forEach(function (r) {
      if (r && parseFloat(r.value) > 0 && r.date) have[String(parseFloat(r.value)) + '|' + String(r.date)] = true;
    });
    var master = masterOdometer();
    var cands = [], skipped = 0;
    list.forEach(function (r) {
      if (!r) { skipped++; return; }
      var v = parseFloat(r.value);
      var dv = String(r.date || '');
      if (!(v > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(dv)) { skipped++; return; }
      var key = String(v) + '|' + dv;
      if (have[key]) { skipped++; return; }
      have[key] = true;
      var ts = (typeof r.ts === 'number' && isFinite(r.ts) && r.ts > 0) ? Math.round(r.ts) : null;
      if (ts === null) {
        var p = dv.split('-');
        ts = new Date(+p[0], +p[1] - 1, +p[2], 12, 0).getTime();
      }
      if (master !== null && v > master + ODO_MAX_JUMP_KM) { skipped++; return; }
      cands.push({ ts: ts, date: dv, value: v, source: String(source || r.source || 'sheet-import') });
    });
    if (!cands.length) return { added: 0, skipped: skipped };
    var merged = log.concat(cands);
    merged.sort(function (a, b) { return (parseFloat(a.ts) || 0) - (parseFloat(b.ts) || 0); });
    var candSet = {};
    cands.forEach(function (c) { candSet[c.ts + '|' + c.value + '|' + c.date] = true; });
    var out = [], lastV = 0, added = 0;
    merged.forEach(function (r) {
      var v = parseFloat(r.value) || 0;
      var isCand = !!candSet[(parseFloat(r.ts) || 0) + '|' + v + '|' + String(r.date)];
      if (isCand && lastV > 0 && (v < lastV || v - lastV > 50000)) { skipped++; return; }
      var prev = out[out.length - 1];
      if (prev && parseFloat(prev.value) === v && Math.abs((parseFloat(r.ts) || 0) - (parseFloat(prev.ts) || 0)) < 60000) {
        if (isCand) skipped++;
        return;
      }
      out.push(r);
      if (v > 0) lastV = v;
      if (isCand) added++;
    });
    if (out.length > 2000) out = out.slice(out.length - 2000);
    if (added > 0) store.set('odo_readings', out);
    return { added: added, skipped: skipped };
  }
  function bumpOdometer(v, src) {
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
      /* v122: a master write is a dated reading (see above). */
      try { logOdoReading(n, src || 'app'); } catch (e) {}
      return { value: n, raised: true, previous: prev };
    }
    /* v122: a capture that CONFIRMS the master (same value, new
       moment — e.g. the morning start reading equals last night's
       closing number) is genuine boundary evidence too: log it.
       A below-master capture is not (stale/misread — see
       logOdoReading's trust rules). */
    if (n === prev) { try { logOdoReading(n, src || 'app'); } catch (e) {} }
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
  /* ECON-UNIT-BEGIN (v127) — THE ECONOMY UNIT. One preference
     (store key 'mt_econUnit': 'kpl' | 'l100' | 'mpg'), chosen once
     in Preferences (owner, Oct 17 09:33 MDT: "there has to be a
     way to change the unit… some users prefer mpg, not km/L"),
     read by every surface that prints an economy figure (Fuel
     trend, the Maintenance summary + lifetime). The records never
     change — km and litres are the facts; only the printed figure
     converts: L/100 km = 100 / (km/L); MPG (US) = (km/L) ×
     2.3521458 (US gallon 3.785411784 L ÷ 1.609344 km/mile).
     Default 'kpl' — the historical display. Harness-extractable:
     store + pure JS only. */
  var ECON_UNIT_LABELS = { kpl: 'km/L', l100: 'L/100 km', mpg: 'MPG' };
  function econUnit() {
    var u = store.get('mt_econUnit', 'kpl');
    return ECON_UNIT_LABELS[u] ? u : 'kpl';
  }
  function econConvert(kpl, unit) {
    var v = parseFloat(kpl);
    if (!(v > 0)) return null;
    var u = unit || econUnit();
    if (u === 'l100') return 100 / v;
    if (u === 'mpg') return v * 2.3521458;
    return v;
  }
  function econFormat(kpl) {
    var c = econConvert(kpl);
    if (c === null) return null;
    return { value: c.toFixed(1), unit: ECON_UNIT_LABELS[econUnit()] };
  }
  /* ECON-UNIT-END */
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
    /* v142: per-photo race state. The cloud read starts the moment
       the photo is taken (PowerRead.beginEarly) and races the local
       read; this record is how the two arrivals meet: localVal =
       what the on-device read filled, cloudVal = what the power
       read answered, delivered = a suggestion/correction for this
       photo is already on screen (the escalation path and the
       settle callback must never paint it twice). */
    var photoState = null;
    function handleFile(file) {
      if (!file) return;
      var token = ++_onbOcrToken;
      /* v142: this photo's race record (see photoState above).
         localDone: the local read has landed and spoken — a cloud
         chip arriving after that must not talk over its line.
         gated: the local read produced a value the plausibility
         gate rejected — its plain explanation is the status this
         photo keeps; the cloud chip stands below it, unannounced. */
      var state = { localVal: null, cloudVal: null, delivered: false, prImg: null, localDone: false, gated: false, gateLine: null, announced: false };
      photoState = state;
      /* v127: a NEW photo supersedes any pending suggestion — this
         is the one legitimate clear of the suggestion boxes (a user
         act, not a timer or another producer's repaint; see prBox). */
      var oldChips = document.getElementById(prefix + '_chips');
      if (oldChips) oldChips.innerHTML = '';
      var oldPr = document.getElementById(prefix + '_prbox');
      if (oldPr) oldPr.innerHTML = '';
      var rd = new FileReader();
      rd.onload = function () {
        var dataUrl = rd.result;
        if (token !== _onbOcrToken) return;
        /* v182 (P1): a host may ask for the photo itself to be
           KEPT on its record (downloadable copy) — stored under
           opts.keepKey the moment it is taken. */
        try { if (opts && opts.keepKey) store.set(opts.keepKey, dataUrl); } catch (e) {}
        if (prevEl) prevEl.innerHTML = '<img src="' + dataUrl + '" style="width:100%;border-radius:8px;margin:8px 0" alt="Photo">';
        if (!window.TicketOCR) { onbSetStatus(prefix, '⚠️ Photo reader not ready — enter it manually below.'); return; }
        onbSetStatus(prefix, '📖 Reading photo… 0%');
        /* v142: both reads start NOW, off the same photo. The
           local read starts immediately — TicketOCR.recognize caps
           its input to the OCR rendition internally (it used to
           run on the raw full-resolution frame: measured 23 s on
           the owner's real dash photo, while the cloud was only
           asked AFTER it gave up). The cloud read starts in
           parallel on its own smaller rendition
           (TicketOCR.READ_MAX). First confident answer shows; the
           cloud answer corrects an untouched local value or waits
           as a tap-to-use chip (onbCloudSettled). */
        var reader = kind === 'odometer' ? 'odometer' : 'text';
        var startCloud = function (prImg) {
          if (token !== _onbOcrToken) return;
          state.prImg = prImg || dataUrl;
          if (window.PowerRead && PowerRead.beginEarly) {
            var h = PowerRead.beginEarly({ reader: reader, image: state.prImg, origin: (opts && opts.origin) || { module: 'preferences', label: 'Preferences' } });
            if (h) h.onSettled(function (out) { if (token === _onbOcrToken) onbCloudSettled(prefix, kind, state, out, token); });
          }
        };
        if (window.TicketOCR && TicketOCR.urlToReadImage) TicketOCR.urlToReadImage(dataUrl, reader, startCloud);
        else startCloud(dataUrl);
        TicketOCR.recognize(dataUrl, function (p) {
          if (token !== _onbOcrToken) return;
          try { onbSetStatus(prefix, '📖 Reading photo… ' + Math.round(p * 100) + '%'); } catch (e) {}
        }).then(function (text) {
          state.localDone = true;
          if (token !== _onbOcrToken) return;
          if (kind === 'odometer') {
            var km = parseOdometerReading(text);
            if (km && fieldEl && !odoLocalFailed(km)) {
              state.localVal = km;
              fieldEl.value = km;
              persist(kind, km);
              onbSetStatus(prefix, '✓ We read <b>' + Number(km).toLocaleString('en-CA') + ' km</b> — fix it below if that is wrong.');
              /* v142: if the cloud read beat this one and left its
                 chip up, the chip STAYS (v127's box is touched only
                 by prBox/prSuggest + the new-photo clear): same
                 value — tapping it is a harmless no-op; different
                 value — it is the driver's alternative, and the
                 field keeps the local read until he taps. */
            } else if (km && odoLocalFailed(km)) {
              state.gated = true; /* v142: the gate's line stands (see state above) */
              /* v63 plausibility gate: the value exists but is
                 impossible against the master odometer, so it counts
                 as a FAILED read: never filled, never persisted, and
                 the power read gets its crack at the photo below (its
                 answer still lands as a tap-to-use chip, never
                 auto-applied). v80: the gate is two-sided and the
                 message names the direction — below the master
                 (v63), or a wild jump past it (Oct 15: a receipt's
                 invoice number outranked the dash). */
              /* v142: the gate line is kept on the race record —
                 when the cloud answer lands, its announcement is
                 APPENDED to this explanation (the driver keeps the
                 why AND gets the what-next), never swapped for it. */
              if (odoImplausible(km) === 'jump') {
                state.gateLine = '⚠️ We read <b>' + Number(km).toLocaleString('en-CA') + ' km</b> — but your odometer is at <b>' + Number(odoMasterNow()).toLocaleString('en-CA') + ' km</b>, so that can\'t be right — it\'s likely another number in the photo. Trying the power read…';
              } else {
                state.gateLine = '⚠️ We read <b>' + Number(km).toLocaleString('en-CA') + ' km</b> — but the odometer is already at <b>' + Number(odoMasterNow()).toLocaleString('en-CA') + ' km</b>, so that can\'t be right. Trying the power read…';
              }
              onbSetStatus(prefix, state.gateLine);
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
            if (odoLocalFailed(km)) odoPowerRead(prefix, state.prImg, file, token, state);
          } else {
            var iso = parseStickerExpiry(text);
            if (iso && fieldEl) {
              state.localVal = iso;
              fieldEl.value = iso;
              persist(kind, iso);
              onbSetStatus(prefix, '✓ We read expiry <b>' + iso + '</b> — fix it below if that is wrong.');
              /* v142: a standing power-read chip stays standing
                 (see the odometer branch's note). */
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
              safetyPowerRead(prefix, state.prImg, file, token, state);
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

    /* v127: THE POWER-READ SUGGESTION'S OWN BOX. Owner evidence
       (Oct 17, 09:32 MDT, Maintenance): the odometer power read
       returned 169,211 correctly and its tap-to-use chip showed
       for ~2 seconds, then vanished before he could tap it; the
       field kept the old value. ROOT CAUSE: the chip lived in the
       SHARED #<prefix>_chips box, and the background candidate
       hunt's onUpdate blanks that box wholesale (box.innerHTML =
       '') on every pass before re-rendering only its own
       candidates. The pooled hunt runs SECONDS behind the ~2 s
       cloud answer, so its next pass erased a suggestion it never
       painted. THE FIX: the power-read suggestion gets its OWN
       box (#<prefix>_prbox) that no other producer writes. It is
       cleared only by the user's own acts — tapping the value
       (accept), tapping ✕ Not it (dismiss), or snapping a NEW
       photo (handleFile). No timer, no repaint clears it. */
    function prBox(prefix) {
      var statusEl = el(prefix + '_status');
      if (!statusEl || !statusEl.parentNode) return null;
      var box = document.getElementById(prefix + '_prbox');
      if (!box) {
        box = document.createElement('div');
        box.id = prefix + '_prbox';
        statusEl.parentNode.insertBefore(box, statusEl.nextSibling);
      }
      return box;
    }
    function prSuggest(prefix, btnText, onAccept, acceptedStatus) {
      var box = prBox(prefix);
      if (!box) return;
      box.innerHTML = '';
      var lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:13px;color:#555;margin:4px 0 2px';
      lbl.textContent = '⚡ Power read — check before using:';
      box.appendChild(lbl);
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small';
      b.style.margin = '2px 4px 2px 0';
      b.textContent = btnText;
      b.onclick = function () {
        box.innerHTML = '';
        onAccept();
        onbSetStatus(prefix, acceptedStatus);
      };
      box.appendChild(b);
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'btn small ghost';
      x.style.margin = '2px 4px 2px 0';
      x.textContent = '✕ Not it';
      x.onclick = function () {
        box.innerHTML = '';
        onbSetStatus(prefix, '⚡ Power-read suggestion set aside — enter the value yourself below.');
      };
      box.appendChild(x);
    }

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
          /* v127: an empty later pass no longer blanks the box —
             chips painted by an earlier pass of THIS photo stay
             until the user taps one or snaps a new photo. (The
             wholesale clear was one of the two erasers of the
             shared box; the power-read suggestion has moved to
             its own box entirely — see prBox.) */
          if (!list.length) return;
          box.innerHTML = '';
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
       until that tap.
       v142: the caller hands over the READ rendition it started at
       capture (prImg) — the escalation ADOPTS that in-flight read
       (same reader + photo) instead of sending a second one. The
       file-based rendition build remains as the fallback for when
       no early image exists. */
    function odoPowerRead(prefix, prImg, file, token, state) {
      if (!window.PowerRead || !PowerRead.escalate) return;
      function go(img) {
        if (token !== _onbOcrToken) return;
        PowerRead.escalate({
          reader: 'odometer', image: img, origin: (opts && opts.origin) || { module: 'preferences', label: 'Preferences' },
          onStatus: function (s) {
            if (token !== _onbOcrToken) return;
            /* v142: when the capture-time read already delivered
               its chip, "asking…" would be a stale line — skip it.
               A gated local read's explanation also stands (its own
               line already ends "Trying the power read…"). */
            if (s.state === 'working') { if (!(state && (state.delivered || state.gated))) onbSetStatus(prefix, '⚡ Asking the power read to try…'); }
            else if (s.state === 'waiting') onbSetStatus(prefix, '⚡ Power read waiting for signal — the photo is saved and will be read when you\'re back online. You can still enter the mileage below.');
            else if (s.state === 'unavailable') onbSetStatus(prefix, s.message + ' You can still enter the mileage below.');
            else if (s.state === 'error') onbSetStatus(prefix, s.message + ' You can still enter the mileage below.');
          },
          onResult: function (res) {
            if (token !== _onbOcrToken) return;
            var v = res.fields && res.fields.value;
            if (!v) { onbSetStatus(prefix, '⚡ Power read couldn\'t read it either — enter it manually below.'); return; }
            if (state) state.cloudVal = v;
            /* v142: the settle callback may already have put this
               exact suggestion up (the cloud beat the local read) —
               never paint the CHIP twice. The completion line still
               lands here (it is the last word on the escalation),
               except over a gated read's explanation, which stands. */
            if (state && state.delivered) {
              announceFind(prefix, state);
              return;
            }
            if (state) state.delivered = true;
            /* v127: the suggestion renders in its OWN box and
               stays until the user accepts or dismisses it (see
               prBox) — the hunt can no longer erase it. */
            prSuggest(prefix, Number(v).toLocaleString('en-CA') + ' km',
              function () {
                if (fieldEl) fieldEl.value = v;
                persist(kind, v);
              },
              '⚡ Power read: using <b>' + Number(v).toLocaleString('en-CA') + ' km</b> — thanks for confirming.');
            announceFind(prefix, state);
          }
        });
      }
      if (prImg) { go(prImg); return; }
      if (window.TicketOCR && TicketOCR.fileToOCRImage && file) {
        TicketOCR.fileToOCRImage(file, function (u) {
          if (u) { go(u); return; }
          /* v63: a rendition failure used to end the flow in total
             silence — say so, with the manual fallback. */
          if (token === _onbOcrToken) onbSetStatus(prefix, '⚡ Power read didn\'t run — that photo couldn\'t be prepared for it. You can still enter the mileage below.');
        });
      }
    }

    /* v142: the completion line for a delivered power-read chip.
       Over a gated local read it APPENDS to the gate's explanation
       (state.gateLine) — the driver keeps the why and gets the
       what-next; the announced flag keeps the two delivery paths
       (settle callback, escalation onResult) from saying it twice. */
    function announceFind(prefix, state) {
      if (state && state.gated && state.gateLine) {
        if (state.announced) return;
        state.announced = true;
        onbSetStatus(prefix, state.gateLine + '<br>⚡ Power read found a reading — tap it below if it looks right, or type the mileage yourself.');
      } else {
        onbSetStatus(prefix, '⚡ Power read found a reading — tap it below if it looks right, or type the mileage yourself.');
      }
    }

    /* v142: the cloud read settles (it started at capture, in
       parallel with the local read). Only a 'done' outcome speaks
       here — waiting/error/implausible are the escalation path's
       words when the local read also failed; when the local read
       landed, silence about a failed confirmation is the honest
       state (the local value stands, labelled as the local read).
       A DONE cloud value:
         · local hasn't landed → the suggestion chip, NOW (this is
           the common case on the owner's dash: local Tesseract
           never cracks the dot-matrix display, the cloud answers
           in ~2 s);
         · agrees with the local value → a one-line agreement;
         · disagrees and the field still holds EXACTLY the local
           value (the driver hasn't typed, tapped a chip, or used
           the steppers since) → correct the field through the same
           persist() the local read used, and SAY it was corrected;
         · disagrees and the driver HAS touched the field → the
           cloud value waits as a tap-to-use chip. The driver's act
           is never silently overwritten. */
    function onbCloudSettled(prefix, kind, state, out, token) {
      if (token !== _onbOcrToken) return;
      if (!out || out.status !== 'done' || !out.fields) return;
      if (kind === 'odometer') {
        var v = out.fields.value;
        if (!v) return;
        state.cloudVal = v;
        if (state.delivered) return;
        if (!state.localVal) {
          state.delivered = true;
          prSuggest(prefix, Number(v).toLocaleString('en-CA') + ' km',
            function () {
              if (fieldEl) fieldEl.value = v;
              persist(kind, v);
            },
            '⚡ Power read: using <b>' + Number(v).toLocaleString('en-CA') + ' km</b> — thanks for confirming.');
          announceFind(prefix, state);
          return;
        }
        if (String(v) === String(state.localVal)) {
          onbSetStatus(prefix, '✓ Power read agrees: <b>' + Number(v).toLocaleString('en-CA') + ' km</b>.');
          return;
        }
        var cur = fieldEl ? String(fieldEl.value || '').replace(/[^\d]/g, '') : '';
        if (cur === String(state.localVal)) {
          fieldEl.value = v;
          persist(kind, v);
          onbSetStatus(prefix, '⚡ Power read corrected the reading to <b>' + Number(v).toLocaleString('en-CA') + ' km</b> — fix it below if that is wrong.');
        } else {
          state.delivered = true;
          prSuggest(prefix, Number(v).toLocaleString('en-CA') + ' km',
            function () {
              if (fieldEl) fieldEl.value = v;
              persist(kind, v);
            },
            '⚡ Power read: using <b>' + Number(v).toLocaleString('en-CA') + ' km</b> — thanks for confirming.');
          onbSetStatus(prefix, '⚡ Power read got a different reading — tap it below to use it, or keep yours.');
        }
        return;
      }
      /* safety: the cloud answer is a transcription; the same local
         parser the escalation path uses reads the expiry from it. */
      var iso = parseStickerExpiry(out.fields.rawText);
      if (!iso) return;
      state.cloudVal = iso;
      if (state.delivered) return;
      if (!state.localVal) {
        state.delivered = true;
        prSuggest(prefix, 'Expiry ' + iso,
          function () {
            if (fieldEl) fieldEl.value = iso;
            persist(kind, iso);
          },
          '⚡ Power read: using expiry <b>' + iso + '</b> — thanks for confirming.');
        if (!state.localDone) onbSetStatus(prefix, '⚡ Power read found an expiry — tap it below if it looks right, or set the month and year yourself.');
        return;
      }
      if (String(iso) === String(state.localVal)) {
        onbSetStatus(prefix, '✓ Power read agrees: expiry <b>' + iso + '</b>.');
        return;
      }
      var curD = fieldEl ? String(fieldEl.value || '') : '';
      if (curD === String(state.localVal)) {
        fieldEl.value = iso;
        persist(kind, iso);
        onbSetStatus(prefix, '⚡ Power read corrected the expiry to <b>' + iso + '</b> — fix it below if that is wrong.');
      } else {
        state.delivered = true;
        prSuggest(prefix, 'Expiry ' + iso,
          function () {
            if (fieldEl) fieldEl.value = iso;
            persist(kind, iso);
          },
          '⚡ Power read: using expiry <b>' + iso + '</b> — thanks for confirming.');
        onbSetStatus(prefix, '⚡ Power read got a different expiry — tap it below to use it, or keep yours.');
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
    function safetyPowerRead(prefix, prImg, file, token, state) {
      if (!window.PowerRead || !PowerRead.escalate) return;
      function go(img) {
        if (token !== _onbOcrToken) return;
        PowerRead.escalate({
          reader: 'text', image: img, origin: (opts && opts.origin) || { module: 'preferences', label: 'Preferences' },
          onStatus: function (s) {
            if (token !== _onbOcrToken) return;
            if (s.state === 'working') { if (!(state && state.delivered)) onbSetStatus(prefix, '⚡ Asking the power read to try…'); }
            else if (s.state === 'waiting') onbSetStatus(prefix, '⚡ Power read waiting for signal — the photo is saved and will be read when you\'re back online. Meanwhile, the month/year steppers below always work.');
            else if (s.state === 'unavailable' || s.state === 'error') onbSetStatus(prefix, s.message + ' The month/year steppers below always work.');
          },
          onResult: function (res) {
            if (token !== _onbOcrToken) return;
            var iso = parseStickerExpiry(res && res.fields && res.fields.rawText);
            if (!iso) { onbSetStatus(prefix, '⚡ Power read couldn\'t read the sticker either — set the punched month and year with the steppers below.'); return; }
            if (state) state.cloudVal = iso;
            /* v142: never paint the suggestion twice (see
               odoPowerRead's onResult). */
            if (state && state.delivered) return;
            if (state) state.delivered = true;
            /* v127: same own-box rule as the odometer suggestion
               (see prBox) — the sticker suggestion stays until the
               user accepts or dismisses it. */
            prSuggest(prefix, 'Expiry ' + iso,
              function () {
                if (fieldEl) fieldEl.value = iso;
                persist(kind, iso);
              },
              '⚡ Power read: using expiry <b>' + iso + '</b> — thanks for confirming.');
            onbSetStatus(prefix, '⚡ Power read found an expiry — tap it below if it looks right, or use the steppers.');
          }
        });
      }
      /* v142: adopt the capture-time read when there is one. */
      if (prImg) { go(prImg); return; }
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
    /* v147: the name fields write whenever the name step is on
       screen (element present) — including an emptied field, so a
       corrected name is the stored name. Off-step, nothing is
       touched (the pattern the guarded reads below follow). */
    if (el('ob_fname')) o.firstName = g('ob_fname');
    if (el('ob_lname')) o.lastName = g('ob_lname');
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
    /* v131: the company step may have just given this account its
       findable name — publish the Connect directory record now,
       not at the next app start. */
    try { if (window.ConnectLive) ConnectLive.publishMine(); } catch (e) {}
    var o = App.onb || {};
    /* v147: finishing is impossible with the account-type question
       unanswered too — hold AT the question (it is the earlier
       step) instead of letting the fallbacks answer "Driver" for
       him, which is how accounts were mis-typed from birth. */
    if (!isAccountType(o.accountType)) {
      _onbTypeNudge = true;
      var txi = onbTypeStepIndex();
      if (txi >= 0) App.onbStep = txi;
      renderOnbStep();
      return;
    }
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
          /* v122: an applied onboarding odometer write is a dated
             reading like every other master write path. */
          try { logOdoReading(obDec.value, 'onboarding', null, obDec.action === 'correct'); } catch (e) {}
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
    /* v147: setup ASKED the name question — the one-time dashboard
       ask must not repeat it for this account, answered or left
       blank (see paintNameCard). */
    try { o.nameAsked = true; App.onb = o; store.set('onboarding', o); } catch (e) {}
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

    // v127: seed the dated odometer log from the app's own dated
    // records (fuel fills + session readings) — idempotent, runs
    // on every open, adds only what the records can prove.
    try { seedOdoReadings(); } catch (e) {}

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
      /* v147: the account-type question is a must-answer too — its
         fallbacks used to answer "Driver" silently. */
      if (cur && cur.key === 'accountType' && !isAccountType(App.onb.accountType)) {
        _onbTypeNudge = true;
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
      if (!isAccountType(App.onb.accountType)) { /* v147: Skip lands on the earlier unanswered question (the type) first */
        _onbTypeNudge = true;
        var txi = onbTypeStepIndex();
        if (txi >= 0) App.onbStep = txi;
        renderOnbStep();
        return;
      }
      if (!isUserRole(App.onb.userRole)) {
        _onbRoleNudge = true;
        var ri = onbRoleStepIndex();
        if (ri >= 0) App.onbStep = ri;
        renderOnbStep();
        return;
      }
      /* v147: setup presented the name question on the way here —
         the one-time dashboard ask must not repeat it. */
      try { App.onb.nameAsked = true; store.set('onboarding', App.onb); } catch (e) {}
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
    // v143: the end sheet's ticket-photo door (same two-button pattern)
    el('trkEndTicketCam').onclick = function () { el('trkEndTicketCamIn').click(); };
    el('trkEndTicketPick').onclick = function () { el('trkEndTicketIn').click(); };
    el('trkEndTicketCamIn').onchange = function () { endSheetTicketHandleFile(el('trkEndTicketCamIn').files[0]); el('trkEndTicketCamIn').value = ''; };
    el('trkEndTicketIn').onchange = function () { endSheetTicketHandleFile(el('trkEndTicketIn').files[0]); el('trkEndTicketIn').value = ''; };
    el('trkEndOdoCamIn').onchange = function () { endSheetOdoHandleFile(el('trkEndOdoCamIn').files[0]); el('trkEndOdoCamIn').value = ''; };
    el('trkEndOdoIn').onchange = function () { endSheetOdoHandleFile(el('trkEndOdoIn').files[0]); el('trkEndOdoIn').value = ''; };
    el('odoSheetSave').onclick = function () { App.odoSheetSave(); }; // v46: confirm the reading in the sheet
    // v174: the PTI nudge sheet controls
    el('ptiNudgeGo').onclick = function () { App.ptiNudgeGo(); };
    el('ptiNudgeLater').onclick = function () { App.ptiNudgeLater(); };
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
  /* v182 (P1, owner Oct 20, 2026 16:06 MDT): EVERY PHOTO THAT FEEDS
     THE APP KEEPS A DOWNLOADABLE COPY ON ITS RECORD. This is the
     one download door every record view uses: an anchor on the
     record's own stored photo (a data URL), named for the record.
     Modules guard on its presence, like every App helper. */
  App._photoDl = function (photo, label) {
    if (!photo || typeof photo !== 'string' || photo.indexOf('data:') !== 0) return '';
    var name = 'meticulous-' + String(label || 'photo').replace(/[^A-Za-z0-9._-]+/g, '-') + '.jpg';
    return '<a class="btn small ghost" href="' + photo + '" download="' + name + '" style="display:inline-block;margin-top:6px;text-decoration:none">\u2B07 Download this photo</a>';
  };
  App._bumpOdometer = bumpOdometer; // v39: upward-only master write for every capture point
  App._logOdoReading = logOdoReading; // v122: the dated readings log (odo_readings) — every master write path appends
  App._importOdoReadings = importOdoReadings; // v185: the confirm-first bulk import (ODO-BACKFILL)
  App._seedOdoReadings = seedOdoReadings; // v127: seed the dated log from the app's own dated records (fills + sessions)
  App._econUnit = econUnit; // v127: the economy-unit preference ('kpl' | 'l100' | 'mpg')
  App._econConvert = econConvert; // v127: km/L → the chosen unit (pure, test-pinned)
  App._econFormat = econFormat; // v127: { value, unit } for economy displays
  App._moduleTitle = moduleTitle; // v122: the presented module name (Payroll → 'Pay Stub')
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
