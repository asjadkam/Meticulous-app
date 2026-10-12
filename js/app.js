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
    ['onboarding', 'auth', 'main'].forEach(function (v) {
      el(v === 'onboarding' ? 'onboarding' : v).classList.toggle('active', v === name);
    });
    el('fbFab').classList.toggle('hidden', name !== 'main');
  };

  App.onAuth = function (user) {
    App.user = user;
    var em = user ? user.email : store.get('localEmail', null);
    el('sbEmail').textContent = em || 'Local mode';
    var nm = store.get('onboarding', {}).accountType || 'Driver';
    el('sbName').textContent = nm + (user ? '' : ' (offline)');
    syncTrial();
    buildSidebar();
    buildDashboard();
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
  var MODULE_ORDER = ['revenue', 'dispatch', 'navigation', 'fuel', 'damage', 'manifest', 'invoice', 'connect'];
  var MODULE_META = {
    revenue:    { title: 'Revenue',           icon: '📊', tier: 'basic' },
    dispatch:   { title: 'Dispatch',          icon: '📋', tier: 'basic' },
    navigation: { title: 'Navigation',        icon: '🗺️', tier: 'basic' },
    fuel:       { title: 'Fuel & Expense',    icon: '⛽', tier: 'basic' },
    damage:     { title: 'Damage & Incident', icon: '📸', tier: 'basic' },
    manifest:   { title: 'Manifest / Daily Log', icon: '📝', tier: 'pro' },
    invoice:    { title: 'Invoice',           icon: '🧾', tier: 'pro' },
    connect:    { title: 'Connect',           icon: '🤝', tier: 'premium' }
  };

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
    trackerTick();
  }
  App.trackerToggle = function () {
    var t = App.tracker;
    if (t.status === 'idle') { t.status = 'running'; t.startTs = Date.now(); t.elapsed = 0; }
    else if (t.status === 'running') { t.elapsed += Math.floor((Date.now() - t.startTs) / 1000); t.status = 'paused'; }
    else { t.status = 'running'; t.startTs = Date.now(); }
    trackerSave(); trackerPaint();
  };
  App.trackerStop = function () {
    var t = App.tracker;
    var sec = t.elapsed + (t.status === 'running' ? Math.floor((Date.now() - t.startTs) / 1000) : 0);
    if (sec > 0) {
      var sessions = store.get('sessions', []);
      var entry = { date: todayStr(), seconds: sec, endedAt: new Date().toISOString() };
      sessions.push(entry); store.set('sessions', sessions);
      if (window.FB && FB.saveDoc) FB.saveDoc('sessions', 's' + Date.now(), entry);
      if (Meticulous.modules.revenue && Meticulous.modules.revenue.onSession) {
        try { Meticulous.modules.revenue.onSession(entry); } catch (e) {}
      }
    }
    App.tracker = { status: 'idle', startTs: 0, elapsed: 0 };
    trackerSave(); trackerPaint();
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
    } else if (st.type === 'done') {
      h += '<div class="card"><div class="kv"><span>Account</span><b>' + esc(o.accountType || '—') + '</b></div>' +
        '<div class="kv"><span>Employment</span><b>' + esc(o.employment || '—') + '</b></div>' +
        '<div class="kv"><span>Pay</span><b>' + esc(o.payStandard || '—') + (o.payRate ? ' @ $' + esc(o.payRate) : '') + '</b></div>' +
        '<div class="kv"><span>Base</span><b>' + esc(o.baseLocation || '—') + '</b></div>' +
        '<div class="kv"><span>Company</span><b>' + esc(o.companyName || '—') + '</b></div>' +
        '<div class="kv"><span>Truck</span><b>' + esc(o.truckNo || '—') + '</b></div></div>';
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
    store.set('onboarding', o);
  }

  function finishOnboarding() {
    collectOnbInputs();
    store.set('onboarded', true);
    // ask for notification permission once
    if (window.FB && FB.enablePush) { FB.enablePush().catch(function () {}); }
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
  function afterAuth() {
    try {
      var u = (window.FB && FB.user) ? FB.user : null;
      // If FB.user not yet set, try Firebase's currentUser directly
      if (!u && window.FB && FB.auth && FB.auth.currentUser) {
        u = FB.auth.currentUser; FB.user = u;
      }
      App.onAuth(u);
      if (store.get('onboarded', false)) App.showView('main');
      else { App.onbStep = 0; renderOnbStep(); App.showView('onboarding'); }
    } catch (e) {
      authError('Navigation error: ' + (e.message || e));
    }
  }

  /* ---------------- auth ---------------- */
  function authError(msg) {
    var e = el('authErr'); e.textContent = msg; e.style.display = 'block';
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
      var em = el('authEmail').value.trim(), pw = el('authPass').value;
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
      var em = el('authEmail').value.trim(), pw = el('authPass').value;
      if (!em || !pw) return authError('Enter email and password.');
      if (pw.length < 6) return authError('Password must be at least 6 characters.');
      if (!window.FB || !FB.ready) return authError('Could not reach the server. Try "Continue without an account".');
      var btn = el('btnSignUp');
      btn.disabled = true; btn.textContent = 'Creating...';
      function done() { btn.disabled = false; btn.textContent = 'Create account'; }
      FB.signUp(em, pw).then(function () { done(); afterAuth(); })
        .catch(function (e) { done(); authError(friendlyAuthError(e)); });
    };
    el('authSkip').onclick = function () {
      var em = el('authEmail').value.trim();
      if (em) store.set('localEmail', em);
      afterAuth();
    };
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
    if (App.tracker.status === 'running') { // app was closed mid-shift: keep elapsed, pause
      App.tracker.elapsed += Math.floor((Date.now() - App.tracker.startTs) / 1000);
      App.tracker.status = 'paused';
    }

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
    el('btnModBack').onclick = App.showDashboard;
    el('trkMain').onclick = App.trackerToggle;
    el('trkStop').onclick = function () { if (confirm('Stop and save this session?')) App.trackerStop(); };
    el('fbFab').onclick = App.openFeedback;
    el('fbCancel').onclick = function () { el('fbSheet').classList.remove('open'); el('scrim').classList.remove('show'); el('scrim').onclick = closeSidebar; };
    el('fbSend').onclick = sendFeedback;

    wireAuth();
    trackerPaint();
    setInterval(trackerTick, 1000);

    renderOnbStep();
    // auth comes first; after sign-in, afterAuth() routes to onboarding or main
    App.showView('auth');
    // if already signed in (returning user), firebase onAuthStateChanged fires -> route there
    var _authRouted = false;
    function routeReturningUser() {
      if (_authRouted) return; _authRouted = true;
      if (window.FB && FB.user) afterAuth();
    }
    if (window.FB && FB.auth) {
      FB.auth.onAuthStateChanged(function () { setTimeout(routeReturningUser, 300); });
    }
    setTimeout(routeReturningUser, 2500); // fallback in case the listener was already attached

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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
