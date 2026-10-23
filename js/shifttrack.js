/* Meticulous — native background shift tracking (web v63 / native v34).
 *
 * The Android shell (native v34+) carries a foreground service that
 * records timestamped GPS breadcrumbs to app-local storage while a
 * work session runs — with the app in the background, its WebView
 * destroyed, or the process restarted by the system. This file is
 * the web half: it starts/stops that service with the tracker,
 * asks for the "Allow all the time" location permission in plain
 * language, and folds the service's breadcrumbs into the SAME
 * engines the live stream feeds (js/miles.js LiveMiles,
 * js/geoloads.js GeoLoads) — one timeline, deduped by timestamp,
 * so background driving counts exactly once.
 *
 * Why it matters (owner, Oct 14): drivers paid BY THE MILE are paid
 * from these numbers. Miles the service observed while the app was
 * closed are real miles; stretches NObody observed stay uncounted
 * (the engines' gap rules are unchanged).
 *
 * Safety: the plugin is FEATURE-DETECTED. On the old shell, the
 * boss's iPhone web install, or a desktop browser there is no
 * ShiftTrack plugin: available() is false, every method is inert,
 * and the app behaves exactly as before (foreground counting +
 * wake lock). Nothing in here ever throws into the tracker.
 *
 * v92 (native v35): THE ARMED DAY. Until now the service could only
 * record once a session existed, and a session could only begin in
 * the WebView — so the 8:00 auto-start silently waited for the app
 * to be opened, and the morning's pre-session driving (home -> site)
 * was dropped as "stale" by the drain below. The native shell now
 * keeps its own schedule: while the app is alive, js/app.js arms the
 * next workday (armDay: sessionKey + fire time = planned start minus
 * a 60-minute lead, the same window the miles engine's adoption
 * rules already bless), and at the fire time the native side starts
 * recording on its own. This file's halves of that bargain:
 *  - armDay()/disarmDay() wrappers + the 'dayarm' store record that
 *    remembers the day's true counting window;
 *  - the drain's freshness cutoff widens to that window, so crumbs
 *    the service observed before the session's start FOLD instead
 *    of being cleared unread;
 *  - foldIntoRecord() creates the day's record when none exists —
 *    natively observed miles are never acked into the void;
 *  - the once-per-session ask also covers the battery state: if
 *    Android can still starve the service (battery not Unrestricted,
 *    or the service was refused), the driver hears it once, in
 *    plain words, with the one-tap fix — never a nag loop.
 */
(function () {
  'use strict';

  function plugin() {
    try {
      var p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ShiftTrack;
      if (p && typeof p.start === 'function' && typeof p.stop === 'function' &&
          typeof p.status === 'function' && typeof p.readCrumbs === 'function' &&
          typeof p.ack === 'function') return p;
    } catch (e) {}
    return null;
  }
  function store() {
    try { return (window.App && App._store) || null; } catch (e) { return null; }
  }
  function trackerActive() {
    try {
      var t = window.App && App.tracker;
      return !!(t && (t.status === 'running' || t.status === 'paused'));
    } catch (e) { return false; }
  }

  var currentKey = null;      // 's<sessionStartMs>' being recorded
  var lastStatus = null;      // last status() snapshot from the plugin
  var draining = false;
  var drainTimer = null;
  var bannerDone = {};        // sessionKey -> true once the ask is settled

  /* ---------------- the armed day (v92) ---------------- */

  /* The web-side memory of the armed day: { key, fireMs, startMs,
     date }. It is what lets a later drain know the day's counting
     window legitimately began BEFORE the session's own start (the
     service was recording the drive from home). Written when the
     arm is placed, refreshed from the plugin's status on boot, and
     kept (not cleared) when the session starts — the window is a
     fact about the day, not about the arm's pending state. */
  function loadDayArm() {
    var s = store();
    if (!s) return null;
    var rec = null;
    try { rec = s.get('dayarm', null); } catch (e) {}
    return (rec && rec.key) ? rec : null;
  }
  function storeDayArm(rec) {
    var s = store();
    if (!s || !rec || !rec.key) return;
    try { s.set('dayarm', rec); } catch (e) {}
  }
  function clearDayArm() {
    var s = store();
    if (!s) return;
    try { if (s.del) s.del('dayarm'); else s.set('dayarm', null); } catch (e) {}
  }
  function dateOfKeyMs(ms) {
    var d = new Date(ms || Date.now());
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  /* The stored arm that belongs to a drain: same session key, or
     the same calendar date (a hand-started session takes a
     different key than the armed one, but it is the same workday
     and the same window — LiveMiles' adoption slack agrees). */
  function dayArmFor(key, startMs) {
    var rec = loadDayArm();
    if (!rec) return null;
    if (rec.key === key) return rec;
    if (startMs && rec.date && rec.date === dateOfKeyMs(startMs)) return rec;
    return null;
  }

  /* ---------------- status ---------------- */

  function refreshStatus() {
    var p = plugin();
    if (!p) return Promise.resolve(null);
    return p.status().then(function (s) {
      lastStatus = s || null;
      return lastStatus;
    }).catch(function () { return lastStatus; });
  }

  /* ---------------- breadcrumb drain ---------------- */

  /* Read ALL un-acked crumbs (the plugin caps one response; loop
     while it says there are more). Crumbs are acked — deleted
     natively — only after they have been folded, and the merge is
     idempotent, so a crash anywhere in here costs nothing. */
  function readAllCrumbs() {
    var p = plugin();
    if (!p) return Promise.resolve([]);
    var all = [];
    function step() {
      return p.readCrumbs({ since: 0 }).then(function (res) {
        var batch = (res && res.crumbs) || [];
        for (var i = 0; i < batch.length; i++) all.push(batch[i]);
        if (res && res.more && batch.length) return step();
        return all;
      });
    }
    return step().catch(function () { return all; });
  }

  /* Fold crumbs into a session whose live engine is NOT running
     (session already stopped, or orphaned by a WebView death):
     rebuild the day's miles record with a throwaway engine begun
     from the persisted snapshot, so the same join/dedupe rules
     apply as in the live path. Returns true when the record moved.
     v92: when no record exists yet — the armed day recorded a whole
     morning before any WebView existed to begin one — the record is
     CREATED from the crumbs. Observed miles must never be acked
     into the void just because the web layer arrived late. */
  function foldIntoRecord(key, crumbs) {
    var s = store();
    if (!s || !key || !crumbs || !crumbs.length) return false;
    var lm = null;
    try { lm = window.LiveMiles || null; } catch (e) {}
    if (!lm || !lm._engine) return false;
    var d = s.get('livemiles', null);
    if (!d || typeof d !== 'object') d = { days: {} };
    if (!d.days || typeof d.days !== 'object') d.days = {};
    var rec = d.days[key];
    if (!rec) {
      var keyMs = parseInt(String(key).slice(1), 10) || Date.now();
      rec = {
        key: key, date: dateOfKeyMs(keyMs), totalM: 0,
        anchor: null, crumbs: [], hasFix: false, updatedAt: Date.now()
      };
      d.days[key] = rec;
    }
    var eng = lm._engine.createMilesTracker();
    eng.begin(key, rec);
    var r = eng.mergeCrumbs(crumbs);
    if (!r || !r.accepted) return false;
    var snap = eng.snapshot();
    snap.date = rec.date;
    snap.updatedAt = Date.now();
    d.days[key] = snap;
    try { s.set('livemiles', d); } catch (e) { return false; }
    return true;
  }

  /* After a late fold, bring the stopped session's entry in line
     with the record it points at (liveKm + reconciliation). Local
     store only — cloud sync mirrors the store. */
  function patchSessionEntry(key) {
    var s = store();
    if (!s || !key) return;
    var km = null;
    try { km = window.LiveMiles ? LiveMiles.recordKmFor(key) : null; } catch (e) {}
    if (typeof km !== 'number') return;
    var sessions = s.get('sessions', []);
    for (var i = sessions.length - 1; i >= 0; i--) {
      var entry = sessions[i];
      if (entry && entry.milesKey === key) {
        if (entry.liveKm !== km) {
          entry.liveKm = km;
          try { if (window.LiveMiles) LiveMiles.reconcileSession(entry); } catch (e) {}
          try { s.set('sessions', sessions); } catch (e) {}
        }
        return;
      }
    }
  }

  /* Drain the service's breadcrumbs for a session: fold them into
     the live engines when the session is on screen, or into the
     stored record when it is not, then ack natively up to the
     newest crumb READ (crumbs from before this day's counting
     window are stale leftovers — never folded, still cleared).
     v92: the window no longer starts at the session. When the day
     was ARMED, the service legitimately recorded from the arm's
     fire time — the drive from home before the 8:00 session is the
     owner's own kilometres, and dropping them was the Oct 16 bug.
     The cutoff is the earliest of: session start - 1 min, the
     stored arm's fire time, and the native side's own startedAt
     for this key (set when the alarm began the recording). */
  function drainCutoffMs(key, startMs) {
    var cutoff = startMs ? startMs - 60000 : 0;
    var arm = dayArmFor(key, startMs);
    if (arm && arm.fireMs && (!cutoff || arm.fireMs - 60000 < cutoff)) {
      cutoff = arm.fireMs - 60000;
    }
    if (lastStatus && lastStatus.sessionKey === key &&
        lastStatus.startedAt && (!cutoff || lastStatus.startedAt - 60000 < cutoff)) {
      cutoff = lastStatus.startedAt - 60000;
    }
    return cutoff;
  }
  function drain(key) {
    var p = plugin();
    if (!p || !key || draining) return Promise.resolve(false);
    draining = true;
    return readAllCrumbs().then(function (crumbs) {
      draining = false;
      if (!crumbs.length) return false;
      var maxT = 0;
      var startMs = parseInt(String(key).slice(1), 10) || 0;
      var cutoff = drainCutoffMs(key, startMs);
      var fresh = [];
      for (var i = 0; i < crumbs.length; i++) {
        var t = +crumbs[i].t || 0;
        if (t > maxT) maxT = t;
        if (!cutoff || t >= cutoff) fresh.push(crumbs[i]);
      }
      if (trackerActive()) {
        // v69: while the tracker is live, these crumbs fold through
        // the LIVE engines — which exist only once LiveMiles has
        // begun the session's day (dayKey set). If this drain won
        // the race against the boot-time startDay (or the engine is
        // otherwise not up), folding would go nowhere — and the ack
        // below would delete crumbs nobody folded (the old
        // ack-before-fold hole). Leave them in the native file
        // untouched; the next drain (45 s loop / foreground / end
        // sheet) folds them once the engine is ready. When the
        // tracker is NOT active the foldIntoRecord path below is
        // self-contained and needs no such gate.
        var liveReady = false;
        try {
          liveReady = !!(window.LiveMiles && typeof LiveMiles.dayKey === 'function' && LiveMiles.dayKey());
        } catch (e) {}
        if (!liveReady) return false;
      }
      var moved = false;
      if (fresh.length) {
        if (trackerActive()) {
          try { if (window.LiveMiles) moved = !!LiveMiles.mergeNativeCrumbs(fresh) || moved; } catch (e) {}
          try { if (window.GeoLoads) GeoLoads.ingestNativeCrumbs(fresh); } catch (e) {}
          try { if (window.ParkPlace) ParkPlace.ingestCrumbs(fresh); } catch (e) {}
          try { if (window.YardStart) YardStart.ingestCrumbs(fresh); } catch (e) {}
        } else {
          moved = foldIntoRecord(key, fresh);
          if (moved) patchSessionEntry(key);
        }
      }
      if (maxT > 0) { try { p.ack({ upTo: maxT }); } catch (e) {} }
      return moved;
    }).catch(function () { draining = false; return false; });
  }

  function startDrainLoop() {
    if (drainTimer) return;
    drainTimer = setInterval(function () {
      if (currentKey && trackerActive()) drain(currentKey);
    }, 45000);
  }
  function stopDrainLoop() {
    if (drainTimer) { clearInterval(drainTimer); drainTimer = null; }
  }

  /* ---------------- the plain-language ask ---------------- */

  function bannerEl() {
    try { return document.getElementById('trkBgAsk'); } catch (e) { return null; }
  }
  /* Show the ask inside the tracker card when a running session is
     not fully set up for background counting. Once per session: when
     the driver answers (or grants), it stays away for that session
     and comes back for the next one — no mid-shift nagging.
     v92: the battery state joins the ask. A foreground service the
     phone may kill is the difference between a counted day and the
     Oct 14–16 undercounts, so when battery is not Unrestricted —
     or the service has already been refused by the phone — the
     driver hears it ONCE here, in plain words, with the one-tap
     fix. Same once-per-session rule; nothing stands or repeats. */
  function paintBanner() {
    var elm = bannerEl();
    if (!elm) return;
    var s = lastStatus;
    var svcRefused = !!(s && s.lastError &&
      (s.lastError === 'foreground-service-refused' ||
       s.lastError === 'day-start-refused' ||
       s.lastError === 'watchdog-restart-refused'));
    var battRisk = !!(s && (s.batteryExempt === false || svcRefused));
    var kind = null;
    if (s && !s.fineLocation) kind = 'nofine';
    else if (s && !s.backgroundLocation) kind = 'bg';
    else if (battRisk) kind = 'battery';
    var show = !!(plugin() && currentKey && trackerActive() && s &&
      !bannerDone[currentKey] && kind);
    if (!show) {
      elm.classList.add('hidden');
      elm.innerHTML = '';
      return;
    }
    var noFine = kind === 'nofine';
    elm.innerHTML = '';
    var txt = document.createElement('span');
    txt.textContent = kind === 'battery'
      ? (svcRefused
          ? 'The phone stopped background counting. Set Meticulous battery to “Unrestricted” so your miles can\'t be cut off mid-shift.'
          : 'Battery saver can stop your miles mid-shift. Set Meticulous battery to “Unrestricted” so counting can\'t be cut off.')
      : noFine
      ? 'Location is off, so miles can\'t be counted. Tap Allow and pick “Allow all the time”.'
      : 'Counting stops when the app closes. Set location to “Allow all the time” so your miles keep counting.';
    var allow = document.createElement('button');
    allow.className = 'trkEdit';
    allow.textContent = kind === 'battery' ? 'Open battery settings' : 'Allow';
    allow.onclick = function () {
      var p = plugin();
      if (!p) return;
      if (kind === 'battery') {
        // The fix lives on a system screen; the ask is settled for
        // this session either way (once means once).
        try { p.openBatterySettings(); } catch (e) {}
        bannerDone[currentKey] = true;
        paintBanner();
        return;
      }
      p.requestBackground().then(function () {
        return refreshStatus();
      }).then(function (s2) {
        if (s2 && s2.backgroundLocation) {
          bannerDone[currentKey] = true;
          paintBanner();
        } else {
          // The system prompt is exhausted (Android routes further
          // changes to the settings page): offer that instead.
          txt.textContent = 'One more step: in Settings, set Location to “Allow all the time” for Meticulous.';
          allow.textContent = 'Open settings';
          allow.onclick = function () {
            try { p.openAppSettings(); } catch (e) {}
            bannerDone[currentKey] = true;
            paintBanner();
          };
        }
      }).catch(function () {});
    };
    var no = document.createElement('button');
    no.className = 'trkEdit';
    no.textContent = 'Not now';
    no.onclick = function () {
      bannerDone[currentKey] = true;
      paintBanner();
    };
    elm.appendChild(txt);
    elm.appendChild(document.createTextNode(' '));
    elm.appendChild(allow);
    elm.appendChild(document.createTextNode(' '));
    elm.appendChild(no);
    elm.classList.remove('hidden');
  }

  /* ---------------- lifecycle (called from js/app.js) ---------------- */

  var ShiftTrack = {
    available: function () { return !!plugin(); },

    /* Latest plugin status (cached; pass true to force a read). */
    status: function (force) {
      if (!plugin()) return Promise.resolve(null);
      if (!force && lastStatus) return Promise.resolve(lastStatus);
      return refreshStatus();
    },

    /* A work session started (manual or auto-start). Start the
       service for it, fold anything it may already hold, and put
       the permission ask up if the session is not fully set up.
       v92: a live session supersedes any pending day-arm (the
       native start() consumes a matching/past arm itself; this
       disarm covers the rest) — but the stored dayarm record is
       KEPT: it remembers the window this day's crumbs belong to. */
    sessionStarted: function (key) {
      var p = plugin();
      if (!p || !key) return;
      currentKey = key;
      ShiftTrack.setSession(true); // v222: the session arm is the web tracker's own fact
      p.start({ sessionKey: key }).then(function () {
        if (typeof p.disarmDay === 'function') {
          try { p.disarmDay(); } catch (e) {}
        }
        return refreshStatus();
      }).then(function () {
        paintBanner();
        startDrainLoop();
        drain(key);
      }).catch(function () {});
    },

    /* v92: arm the next workday natively (called from js/app.js's
       App.armNativeDay, which owns the plan math). arm:
       { key, fireMs, startMs, date }. Inert on shells without the
       armDay method (pre-v35 APKs) — those keep today's behavior:
       counting starts when the app wakes. */
    armDay: function (arm) {
      var p = plugin();
      if (!p || typeof p.armDay !== 'function' || !arm || !arm.key) {
        return Promise.resolve(null);
      }
      storeDayArm({ key: arm.key, fireMs: arm.fireMs, startMs: arm.startMs, date: arm.date });
      return p.armDay({
        sessionKey: arm.key, fireMs: arm.fireMs,
        startMs: arm.startMs, date: arm.date
      }).then(function (r) {
        refreshStatus();
        return r;
      }).catch(function () { return null; });
    },

    /* v92: cancel the arm AND forget the stored window (the plan
       is gone — auto-start off, office role, no upcoming day). */
    disarmDay: function () {
      var p = plugin();
      clearDayArm();
      if (!p || typeof p.disarmDay !== 'function') return Promise.resolve(null);
      return p.disarmDay().catch(function () { return null; });
    },

    /* The app came back to life. If the native side says a session
       is being recorded: with the tracker running, make sure the
       service is up and fold its crumbs; with the tracker idle, the
       session ended while the app was dead — fold, patch, and stop
       the service so it does not record a finished shift. */
    syncOnBoot: function () {
      var p = plugin();
      if (!p) return;
      refreshStatus().then(function (s) {
        if (!s) return;
        // v92: whatever the native side knows about the armed day
        // refreshes the stored window FIRST — a drain below may be
        // folding crumbs that predate the session's own start.
        if (s.armed || s.armStarted || s.sessionActive) {
          var aKey = s.sessionKey || s.armSessionKey;
          if (aKey) {
            storeDayArm({
              key: aKey,
              fireMs: s.armFireMs || s.startedAt || 0,
              startMs: s.armStartMs || 0,
              date: s.armDate || ''
            });
          }
        }
        if (!s.sessionActive) return;
        var key = s.sessionKey || currentKey;
        if (!key) return;
        currentKey = key;
        if (trackerActive()) {
          ShiftTrack.setSession(true); // v222: a live tracker + a native session = the bubble arm is up
          p.start({ sessionKey: key }).then(function () {
            return refreshStatus();
          }).then(function () {
            paintBanner();
            startDrainLoop();
            drain(key);
          }).catch(function () {});
        } else {
          drain(key).then(function () {
            try { p.stop(); } catch (e) {}
          });
        }
      }).catch(function () {});
    },

    /* Fold now (e.g. the end-of-shift sheet just opened — the
       driver's thinking time closes the last background stretch). */
    drainNow: function () {
      if (currentKey) drain(currentKey);
    },

    /* A work session stopped. Final drain (folds into the stored
       record — the live engines are already closed), patch the
       session entry, then stop the service. */
    sessionStopped: function (key) {
      var p = plugin();
      ShiftTrack.setSession(false); // v222: the bubble arm comes down with the session
      stopDrainLoop();
      var elm = bannerEl();
      if (elm) { elm.classList.add('hidden'); elm.innerHTML = ''; }
      var k = key || currentKey;
      currentKey = null;
      if (!p) return;
      if (k) {
        drain(k).then(function () {
          try { p.stop(); } catch (e) {}
        });
      } else {
        try { p.stop(); } catch (e) {}
      }
    },

    /* Preferences passthroughs (quiet status + one-tap fixes). */
    requestBackground: function () {
      var p = plugin();
      if (!p) return Promise.resolve(null);
      return p.requestBackground().then(function () { return refreshStatus(); })
        .catch(function () { return lastStatus; });
    },
    openBatterySettings: function () {
      var p = plugin();
      if (p) { try { p.openBatterySettings(); } catch (e) {} }
    },
    openAppSettings: function () {
      var p = plugin();
      if (p) { try { p.openAppSettings(); } catch (e) {} }
    },

    /* ---------------- v212 (native v36) bridges ----------------
       Each is feature-detected against the v36 plugin surface:
       on the v35 shell (or no shell at all) the native method is
       simply not there and every wrapper below is inert. */

    /* NATIVE TTS: speakNative returns true when the line was
       handed to the native engine — the caller (the Navigator's
       speak) then skips the WebView voice. The engine's health
       is learned from the plugin's answers: a resolution saying
       the engine could not speak flips _ttsDead, and later lines
       fall back to the web voice instead of vanishing. */
    _ttsDead: false,
    speakNative: function (text) {
      var p = plugin();
      if (!p || typeof p.speakText !== 'function' || ShiftTrack._ttsDead || !text) return false;
      try {
        p.speakText({ text: String(text) }).then(function (r) {
          if (r && r.ok === false) ShiftTrack._ttsDead = true;
        }).catch(function () {});
      } catch (e) { return false; }
      return true;
    },
    stopNativeSpeak: function () {
      var p = plugin();
      if (p && typeof p.stopSpeak === 'function') { try { p.stopSpeak(); } catch (e) {} }
    },
    /* TRAY READOUT: the drive's next-turn line, kept in the
       notification tray while the app is minimized. */
    navNotify: function (title, text) {
      var p = plugin();
      if (p && typeof p.navNotify === 'function') { try { p.navNotify({ title: String(title || ''), text: String(text || '') }); } catch (e) {} }
    },
    navNotifyClear: function () {
      var p = plugin();
      if (p && typeof p.navNotifyClear === 'function') { try { p.navNotifyClear(); } catch (e) {} }
    },
    /* PiP ARM: while a drive is live, leaving the app drops the
       drive screen into picture-in-picture (MainActivity reads
       this flag in onUserLeaveHint). */
    _driving: false,
    setDriving: function (on) {
      ShiftTrack._driving = !!on;
      var p = plugin();
      if (p && typeof p.setDriving === 'function') { try { p.setDriving({ on: !!on }); } catch (e) {} }
    },
    /* v222 (BUBBLE-NO-SHOW-OCT22): the SESSION PiP arm, owned by
       the WEB tracker — a live session floats the tracker bubble
       when the driver leaves the app. v220 armed this only as a
       side effect of the native service's start(), so any session
       whose service start never ran — above all a session
       RESTORED after a reinstall, whose native preferences were
       wiped with the old install — left the app with the arm down
       and no bubble ever appeared. The web layer knows the truth
       (its tracker is running), so it sets the arm directly:
       session start, session restore (boot + sign-in), and stops
       it at session end. The plugin persists the arm so it also
       survives a process death inside one install. Inert on
       shells without the method (pre-v38 APKs). */
    _session: false,
    setSession: function (on) {
      ShiftTrack._session = !!on;
      var p = plugin();
      if (p && typeof p.setSession === 'function') { try { p.setSession({ on: !!on }); } catch (e) {} }
    },
    /* v220 (PIP-BACK-BEHAVIOR): ask the shell to enter PiP NOW —
       the Navigator's Back during a live drive. Returns true when
       the request was dispatched to a shell that has the method
       (the caller then treats Back as handled and stays put);
       false off-shell, where the caller's old staircase applies. */
    enterPip: function () {
      var p = plugin();
      if (p && typeof p.enterPip === 'function') {
        try { p.enterPip(); } catch (e) { return false; }
        return true;
      }
      return false;
    },
    /* v220: PiP entry/exit events (the plugin's 'pipChanged').
       Subscribers swap their faces: the Navigator shows its
       compact PiP face, the shell shows the tracker bubble. */
    _pipFns: [],
    _pipWired: false,
    addPipListener: function (fn) {
      if (typeof fn !== 'function') return;
      if (ShiftTrack._pipFns.indexOf(fn) < 0) ShiftTrack._pipFns.push(fn);
      if (ShiftTrack._pipWired) return;
      var p = plugin();
      if (p && typeof p.addListener === 'function') {
        ShiftTrack._pipWired = true;
        try {
          p.addListener('pipChanged', function (data) {
            var inPip = !!(data && data.inPip);
            ShiftTrack._pipFns.slice().forEach(function (f) { try { f(inPip); } catch (e) {} });
          });
        } catch (e) { ShiftTrack._pipWired = false; }
      }
    },
    /* v224 (BUBBLE-FACE-WRONG-OCT22): the shell announces PiP
       entry BEFORE it happens (the plugin's 'pipWillEnter',
       fired from onUserLeaveHint) — subscribers swap their face
       while the app is still full-size, so the first frame the
       PiP window shows is already the compact face, never a
       miniature of the whole app waiting on the after-the-fact
       'pipChanged' event. */
    _pipWillFns: [],
    _pipWillWired: false,
    addPipWillEnterListener: function (fn) {
      if (typeof fn !== 'function') return;
      if (ShiftTrack._pipWillFns.indexOf(fn) < 0) ShiftTrack._pipWillFns.push(fn);
      if (ShiftTrack._pipWillWired) return;
      var p = plugin();
      if (p && typeof p.addListener === 'function') {
        ShiftTrack._pipWillWired = true;
        try {
          p.addListener('pipWillEnter', function () {
            ShiftTrack._pipWillFns.slice().forEach(function (f) { try { f(); } catch (e) {} });
          });
        } catch (e) { ShiftTrack._pipWillWired = false; }
      }
    },
    /* v220 (WIDGET-CONTROLS): collect a home-screen widget button
       tap (start/pause/stop), stashed natively from the widget's
       intent. Resolves '' when there is nothing (or no shell). */
    takeWidgetAction: function () {
      var p = plugin();
      if (p && typeof p.takeWidgetAction === 'function') {
        try {
          return p.takeWidgetAction().then(function (r) { return (r && r.action) || ''; })
            .catch(function () { return ''; });
        } catch (e) {}
      }
      return Promise.resolve('');
    },
    /* WIDGET: the home-screen widget mirrors the composed
       lines; the web side change-gates before calling. */
    pushWidgetState: function (state) {
      var p = plugin();
      if (p && typeof p.widgetState === 'function' && state) {
        try { p.widgetState({ status: String(state.status || ''), primary: String(state.primary || ''), secondary: String(state.secondary || '') }); } catch (e) {}
      }
    },
    /* v227 (NAV-NO-MOVEMENT-V39): the NATIVE nav feed. The shell
       pushes a 'navFix' bridge event per native GPS fix while
       driving is armed; the wrapper fans it out to subscribers
       (the Navigator's third intake). navLastFix() seeds from
       the shell's newest held fix. All inert off-shell. */
    _navFixFns: [],
    _navFixWired: false,
    addNavFixListener: function (fn) {
      if (typeof fn === 'function') ShiftTrack._navFixFns.push(fn);
      if (!ShiftTrack._navFixWired) {
        ShiftTrack._navFixWired = true;
        var p = plugin();
        if (p && typeof p.addListener === 'function') {
          try {
            p.addListener('navFix', function (ev) {
              ShiftTrack._navFixFns.slice().forEach(function (f) { try { f(ev); } catch (e) {} });
            });
          } catch (e) { ShiftTrack._navFixWired = false; }
        }
      }
    },
    navLastFix: function () {
      var p = plugin();
      if (p && typeof p.navLastFix === 'function') {
        try { return p.navLastFix().then(function (r) { return r || null; }).catch(function () { return null; }); } catch (e) {}
      }
      return Promise.resolve(null);
    },
    /* v227 (BUBBLE-FACE): the shell-drawn PiP face state — the
       web side composes the same facts the in-app bubble shows
       and pushes them (change-gated in js/app.js); the native
       face renders them over whatever app is beneath the float. */
    /* v231 (PIP-DOUBLE-FACE): does this shell DRAW its own PiP
       face? True exactly when the plugin carries bubbleState
       (native v40+). The web face stands down in system PiP
       when the shell draws — one float, never two stacked. */
    shellDrawsBubble: function () {
      var p = plugin();
      return !!(p && typeof p.bubbleState === 'function');
    },
    pushBubbleState: function (state) {
      var p = plugin();
      if (p && typeof p.bubbleState === 'function' && state) {
        try {
          p.bubbleState({
            status: String(state.status || ''), primary: String(state.primary || ''),
            secondary: String(state.secondary || ''), line: String(state.line || '')
          });
        } catch (e) {}
      }
    },
    /* v227: collect a face-button tap from system PiP (start/
       pause/stop, load +/-), stashed natively by the PiP action
       receiver. Resolves '' when there is nothing (or no shell). */
    takePipAction: function () {
      var p = plugin();
      if (p && typeof p.takePipAction === 'function') {
        try {
          return p.takePipAction().then(function (r) { return (r && r.action) || ''; })
            .catch(function () { return ''; });
        } catch (e) {}
      }
      return Promise.resolve('');
    },
    /* v227: live delivery of PiP face taps while the app process
       is alive (the collect path above is the cold-start twin). */
    _pipActionFns: [],
    _pipActionWired: false,
    addPipActionListener: function (fn) {
      if (typeof fn === 'function') ShiftTrack._pipActionFns.push(fn);
      if (!ShiftTrack._pipActionWired) {
        ShiftTrack._pipActionWired = true;
        var p = plugin();
        if (p && typeof p.addListener === 'function') {
          try {
            p.addListener('pipAction', function (ev) {
              var a = (ev && ev.action) || '';
              ShiftTrack._pipActionFns.slice().forEach(function (f) { try { f(a); } catch (e) {} });
            });
          } catch (e) { ShiftTrack._pipActionWired = false; }
        }
      }
    }
  };

  /* Coming back to the foreground mid-session: fold whatever the
     service saw while we were away. */
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && currentKey && trackerActive()) {
        refreshStatus().then(function () { paintBanner(); });
        drain(currentKey);
      }
    });
  } catch (e) {}

  window.ShiftTrack = ShiftTrack;
  try { if (window.App) window.App.shiftTrack = ShiftTrack; } catch (e) {}
})();
