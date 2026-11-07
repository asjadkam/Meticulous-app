/* Meticulous — MAPS LINK DEEP LINK (v362).
   Owner (Nov 7, 2026 08:45): "Is there a way for us to just click
   on the link like we click on for it to open Google Maps? But
   it opens our navigation instead."

   The shell half (native v72) registers Meticulous for Google
   Maps link patterns (maps.app.goo.gl, goo.gl/maps, the google
   domains' /maps paths, maps.google.com) and the geo: scheme
   in AndroidManifest.xml —
   so a tap on a dispatcher's pin link in a text, WhatsApp or any
   other app offers Meticulous in Android's chooser, and comes
   straight here once he picks "Always". (Those are Google's
   domains: plain intent filters + the chooser is the honest
   route — they can never be this app's verified App Links.)

   This file is the web half. It receives the tapped URL from the
   Capacitor App plugin — getLaunchUrl() for a cold start,
   'appUrlOpen' for a warm one — deduped so ONE tap is handled
   exactly once (the launch URL stays readable for the activity's
   life, so the cold read is taken once per page load and every
   delivery passes a seen-marker). The URL waits in the store
   (App._store, localStorage — it survives the process dying
   between the tap and the app settling) until the app is signed
   in and the Navigation module is up; js/app.js re-runs the
   drain beside its widget-action collects, and the drain retries
   on its own while an inbox item waits.

   Processing runs the ONE link brain (js/pinlinks.js) into the
   ONE navigation hand-off (Navigation.navigateToPin — the
   dispatch pin's own door: the visit is recorded, the pin rides
   nav_pending, the Navigator opens). A link whose pin cannot be
   read and cannot be resolved is NEVER given an invented pin:
   the Navigator opens with the link preserved in its sent-pin
   box (the 'maplink_link' store key, consumed by the Navigator's
   render) under a plain note, where the v330 door's own tries
   take over.

   Inert everywhere the App plugin is absent (desktop browser,
   the boss's iPhone web install): no listener, no inbox, no
   behaviour change. */
(function () {
  'use strict';

  var INBOX_KEY = 'maplink_inbox';   // {url, ts} — waiting to process
  var SEEN_KEY = 'maplink_seen';     // {url, ts} — last intake (dedupe)
  var LINK_KEY = 'maplink_link';     // {url, ts} — unresolvable, preserved for the Navigator
  var DEDUPE_MS = 30000;
  var RETRY_MS = 1500;
  var RETRY_MAX = 40;

  var wired = false;
  var launchRead = false;
  var draining = false;
  var retries = 0;

  function appPlugin() {
    try {
      var p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (p && typeof p.addListener === 'function' && typeof p.getLaunchUrl === 'function') return p;
    } catch (e) {}
    return null;
  }
  function store() {
    try { return (window.App && App._store) || null; } catch (e) { return null; }
  }
  function sget(k) {
    var s = store();
    if (s) { try { return s.get(k, null); } catch (e) {} }
    try {
      var raw = localStorage.getItem('mt_dl_' + k);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function sset(k, v) {
    var s = store();
    if (s) { try { s.set(k, v); return; } catch (e) {} }
    try { localStorage.setItem('mt_dl_' + k, JSON.stringify(v)); } catch (e) {}
  }
  function sdel(k) {
    var s = store();
    if (s) { try { s.del(k); return; } catch (e) {} }
    try { localStorage.removeItem('mt_dl_' + k); } catch (e) {}
  }

  /* A URL this door accepts: a Maps link the link brain knows,
     or a geo: URI. Anything else that reaches the app (the
     launcher intent, an OTA link) is not ours to consume. */
  function isMapsLinkUrl(url) {
    if (!url) return false;
    var u = String(url).trim();
    if (/^geo:/i.test(u)) return true;
    if (window.PinLinks && PinLinks.isMapsUrl) return !!PinLinks.isMapsUrl(u);
    return /(^|\.)maps\.app\.goo\.gl|(^|\.)goo\.gl\/maps|(^|\.)maps\.google\.|(^|\.)google\.[a-z.]+\/maps/i.test(u);
  }

  /* The place name a full link carries: /maps/place/<name>/… on
     a place link, or a q= that is words rather than coordinates.
     '' when the link names nothing — the hand-off calls it a
     sent pin, exactly as the Navigator's own door does. */
  function nameFromUrl(url) {
    var u = String(url || '');
    var m = u.match(/\/maps\/place\/([^/@?]+)/i);
    if (!m) m = u.match(/[?&](?:q|query|destination)=([^&]+)/i);
    if (!m) return '';
    var raw = String(m[1] || '').replace(/\+/g, ' ');
    try { raw = decodeURIComponent(raw); } catch (e) {}
    raw = raw.trim();
    if (!raw) return '';
    /* A q= that IS the pin is not a name. */
    if (window.PinLinks && PinLinks.coordsFromUrl && PinLinks.coordsFromUrl(raw)) return '';
    if (/^-?\d{1,2}\.\d+,\s*-?\d{1,3}\.\d+$/.test(raw)) return '';
    return raw;
  }

  function ready() {
    try {
      if (!store()) return false;
      var signedIn = (window.App && App.user) ||
        (window.FB && FB.auth && FB.auth.currentUser);
      if (!signedIn) return false;
      var nav = window.Meticulous && Meticulous.modules && Meticulous.modules.navigation;
      return !!(nav && typeof nav.navigateToPin === 'function');
    } catch (e) { return false; }
  }

  /* The hand-off itself — Navigation.navigateToPin, the dispatch
     pin's door. The bare nav_pending fallback keeps the exact
     shape goNavigate writes, for a shell where the module has
     somehow not registered yet. */
  function land(name, lat, lng) {
    try {
      var nav = window.Meticulous && Meticulous.modules && Meticulous.modules.navigation;
      if (nav && typeof nav.navigateToPin === 'function') {
        nav.navigateToPin(name || 'Sent pin', lat, lng);
        return true;
      }
    } catch (e) {}
    try {
      var s = store();
      if (s && window.App && typeof App.openModule === 'function') {
        s.set('nav_pending', { name: name || 'Sent pin', ts: Date.now(), lat: lat, lng: lng });
        App.openModule('navigator');
        return true;
      }
    } catch (e) {}
    return false;
  }

  /* No readable pin and no resolution: the Navigator opens with
     the link preserved in its sent-pin box (modules/navigator.js
     consumes LINK_KEY on render) and a plain note. No fake pin,
     no dead end. */
  function degrade(url) {
    sset(LINK_KEY, { url: String(url), ts: Date.now() });
    try {
      if (window.App && typeof App.openModule === 'function') App.openModule('navigator');
    } catch (e) {}
  }

  function process(url) {
    var name = nameFromUrl(url);
    var c = null;
    try { c = window.PinLinks ? PinLinks.coordsFromUrl(url) : null; } catch (e) {}
    if (c) { land(name, c.lat, c.lng); return Promise.resolve('pin'); }
    if (window.PinLinks && typeof PinLinks.resolveUrl === 'function') {
      return PinLinks.resolveUrl(url).then(function (c2) {
        if (c2) { land(name, c2.lat, c2.lng); return 'resolved'; }
        degrade(url);
        return 'unresolved';
      }).catch(function () { degrade(url); return 'unresolved'; });
    }
    degrade(url);
    return Promise.resolve('unresolved');
  }

  /* One tap, one handling: every delivery (launch read, appUrlOpen,
     a repeated echo of either) passes the seen-marker first. A
     genuinely new tap on the SAME link after the window is a new
     delivery and is honoured. */
  function intake(url, source) {
    if (!isMapsLinkUrl(url)) return false;
    var u = String(url).trim();
    var now = Date.now();
    var seen = sget(SEEN_KEY);
    if (seen && seen.url === u && (now - (seen.ts || 0)) < DEDUPE_MS) return false;
    sset(SEEN_KEY, { url: u, ts: now });
    sset(INBOX_KEY, { url: u, ts: now, source: source || '' });
    retries = 0;
    drain();
    return true;
  }

  function drain() {
    var inbox = sget(INBOX_KEY);
    if (!inbox || !inbox.url) return;
    if (draining) return;
    if (!ready()) {
      if (retries < RETRY_MAX) {
        retries++;
        setTimeout(drain, RETRY_MS);
      }
      return;
    }
    draining = true;
    sdel(INBOX_KEY);
    var done = function () { draining = false; retries = 0; drain(); };
    try {
      Promise.resolve(process(inbox.url)).then(done, done);
    } catch (e) { done(); }
  }

  function wire() {
    if (wired) return;
    wired = true;
    var p = appPlugin();
    if (p) {
      try {
        p.addListener('appUrlOpen', function (data) {
          if (data && data.url) intake(data.url, 'appUrlOpen');
        });
      } catch (e) {}
      try {
        p.addListener('appStateChange', function (state) {
          if (state && state.isActive) drain();
        });
      } catch (e) {}
      /* The cold-start read is taken ONCE per page load: the
         launch URL stays readable for the activity's whole life,
         so re-reading it on every foreground would re-deliver a
         tap long after it was handled. Warm taps arrive through
         appUrlOpen instead. */
      if (!launchRead) {
        launchRead = true;
        try {
          p.getLaunchUrl().then(function (r) {
            if (r && r.url) intake(r.url, 'launch');
          }).catch(function () {});
        } catch (e) {}
      }
    }
    try {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') drain();
      });
    } catch (e) {}
    /* A tap that landed while the app was still booting (or
       signed out) waits in the inbox; give the drain its first
       chances as the app settles. */
    drain();
  }

  window.DeepLink = {
    intake: intake,
    drain: drain,
    wire: wire,
    _isMapsLinkUrl: isMapsLinkUrl,
    _nameFromUrl: nameFromUrl,
    _keys: { inbox: INBOX_KEY, seen: SEEN_KEY, link: LINK_KEY }
  };

  wire();
})();
