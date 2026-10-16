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
     apply as in the live path. Returns true when the record moved. */
  function foldIntoRecord(key, crumbs) {
    var s = store();
    if (!s || !key || !crumbs || !crumbs.length) return false;
    var lm = null;
    try { lm = window.LiveMiles || null; } catch (e) {}
    if (!lm || !lm._engine) return false;
    var d = s.get('livemiles', null);
    if (!d || !d.days || !d.days[key]) return false;
    var rec = d.days[key];
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
     newest crumb READ (crumbs from before this session's start are
     stale leftovers — never folded, still cleared). */
  function drain(key) {
    var p = plugin();
    if (!p || !key || draining) return Promise.resolve(false);
    draining = true;
    return readAllCrumbs().then(function (crumbs) {
      draining = false;
      if (!crumbs.length) return false;
      var maxT = 0;
      var startMs = parseInt(String(key).slice(1), 10) || 0;
      var fresh = [];
      for (var i = 0; i < crumbs.length; i++) {
        var t = +crumbs[i].t || 0;
        if (t > maxT) maxT = t;
        if (!startMs || t >= startMs - 60000) fresh.push(crumbs[i]);
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
     and comes back for the next one — no mid-shift nagging. */
  function paintBanner() {
    var elm = bannerEl();
    if (!elm) return;
    var s = lastStatus;
    var show = !!(plugin() && currentKey && trackerActive() && s &&
      !bannerDone[currentKey] && (!s.fineLocation || !s.backgroundLocation));
    if (!show) {
      elm.classList.add('hidden');
      elm.innerHTML = '';
      return;
    }
    var noFine = !s.fineLocation;
    elm.innerHTML = '';
    var txt = document.createElement('span');
    txt.textContent = noFine
      ? 'Location is off, so miles can\'t be counted. Tap Allow and pick “Allow all the time”.'
      : 'Counting stops when the app closes. Set location to “Allow all the time” so your miles keep counting.';
    var allow = document.createElement('button');
    allow.className = 'trkEdit';
    allow.textContent = 'Allow';
    allow.onclick = function () {
      var p = plugin();
      if (!p) return;
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
       the permission ask up if the session is not fully set up. */
    sessionStarted: function (key) {
      var p = plugin();
      if (!p || !key) return;
      currentKey = key;
      p.start({ sessionKey: key }).then(function () {
        return refreshStatus();
      }).then(function () {
        paintBanner();
        startDrainLoop();
        drain(key);
      }).catch(function () {});
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
        if (!s || !s.sessionActive) return;
        var key = s.sessionKey || currentKey;
        if (!key) return;
        currentKey = key;
        if (trackerActive()) {
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
