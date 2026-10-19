/* Meticulous — live location capability (native builds only).
 *
 * Thin wrapper over the FREE @capacitor-community/background-geolocation
 * plugin (registered to JS as Capacitor.Plugins.BackgroundGeolocation,
 * identified by its addWatcher/removeWatcher API). This replaced the paid
 * background-geolocation plugin that shipped before native v32
 * (versionCode 8): it ran unlicensed, stamped a "LICENSE VALIDATION
 * FAILURE" box on screen at every cold start, and never actually
 * delivered locations to this app.
 *
 * Safety: the wrapper is FEATURE-DETECTED. On the web/PWA, and on native
 * builds that do not carry the community plugin (e.g. APKs built with the
 * old plugin, whose API has no addWatcher), every method is an inert no-op
 * and available() returns false. Nothing calls start() automatically —
 * location only flows when app code explicitly starts it.
 *
 * API:
 *   MeticulousGeo.available()            -> boolean
 *   MeticulousGeo.start(onLoc, onErr)    -> Promise<boolean> (true if watching)
 *   MeticulousGeo.stop()                 -> Promise<void>
 *   MeticulousGeo.isWatching()           -> boolean
 *   MeticulousGeo.last()                 -> last fix {latitude, longitude, accuracy, altitude, speed, bearing, time} | null
 *   MeticulousGeo.getCurrent(timeoutMs)  -> Promise<fix> (one-shot; background-capable watcher, removed after first fix)
 *   MeticulousGeo.geocode(address)       -> Promise<{latitude, longitude, label} | null>
 *                                           (free one-shot address lookup via OpenStreetMap
 *                                           Nominatim — no key, no plugin; callers persist the
 *                                           result so each address is looked up exactly once)
 * Also attached as App.geo when App is present.
 */
(function () {
  'use strict';

  var watcherId = null;
  var lastFix = null;

  try {
    var saved = localStorage.getItem('mt_geo_last');
    if (saved) lastFix = JSON.parse(saved);
  } catch (e) {}

  function plugin() {
    try {
      var p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BackgroundGeolocation;
      // Community plugin signature: addWatcher + removeWatcher. The old paid
      // plugin exposes neither, so this check keeps us inert on old APKs.
      if (p && typeof p.addWatcher === 'function' && typeof p.removeWatcher === 'function') return p;
    } catch (e) {}
    return null;
  }

  function norm(loc) {
    if (!loc) return null;
    return {
      latitude: loc.latitude,
      longitude: loc.longitude,
      accuracy: (loc.accuracy === undefined ? null : loc.accuracy),
      altitude: (loc.altitude === undefined ? null : loc.altitude),
      speed: (loc.speed === undefined ? null : loc.speed),
      bearing: (loc.bearing === undefined ? null : loc.bearing),
      time: (loc.time === undefined ? Date.now() : loc.time)
    };
  }

  function record(loc) {
    var fix = norm(loc);
    if (!fix) return null;
    lastFix = fix;
    try { localStorage.setItem('mt_geo_last', JSON.stringify(fix)); } catch (e) {}
    return fix;
  }

  var Geo = {
    available: function () { return !!plugin(); },

    isWatching: function () { return watcherId !== null; },

    last: function () { return lastFix; },

    start: function (onLocation, onError) {
      var p = plugin();
      if (!p) return Promise.resolve(false);
      if (watcherId !== null) return Promise.resolve(true);
      return p.addWatcher(
        {
          // Defining backgroundMessage enables updates while the app is in
          // the background via an Android foreground service; Android
          // requires the ongoing notification these strings feed.
          backgroundTitle: 'Meticulous location',
          backgroundMessage: 'Meticulous is recording your work trip location.',
          requestPermissions: true,
          stale: false,
          distanceFilter: 0
        },
        function (location, error) {
          if (error) {
            if (typeof onError === 'function') { try { onError(error); } catch (e) {} }
            return;
          }
          var fix = record(location);
          if (fix && typeof onLocation === 'function') { try { onLocation(fix); } catch (e) {} }
        }
      ).then(function (id) {
        watcherId = id;
        return true;
      }).catch(function (err) {
        if (typeof onError === 'function') { try { onError(err); } catch (e) {} }
        return false;
      });
    },

    stop: function () {
      var p = plugin();
      if (!p || watcherId === null) { watcherId = null; return Promise.resolve(); }
      var id = watcherId;
      watcherId = null;
      return p.removeWatcher({ id: id }).catch(function () {});
    },

    /* v169: ONE-TAP LOCATION, LAYERED (owner, Oct 19, 2026
       06:52 MDT — his first real PTI filing: "PTI location —
       couldn't get a fix", indoors at home, while the phone
       itself held a good position). The old getCurrent was
       native-plugin-only and REJECTED on the first error: on
       the web copy it could never succeed at all, and indoors
       a single strict watcher attempt gave up while a coarse
       or cached fix sat unused. Now, in order:
         1. a FRESH cached fix (≤5 min old) — instant;
         2. the native plugin watcher (one attempt);
         3. the plugin again — ONE retry (a first attempt can
            die on a cold GPS radio);
         4. the browser/WebView geolocation, COARSE
            (enableHighAccuracy off — Wi-Fi/cell fixes are fast
            indoors, which is exactly where a fine fix starves);
         5. the last-known fix at any age, marked stale.
       It RESOLVES (fix | stale fix | null) instead of rejecting:
       no caller may dead-end on location, and location NEVER
       blocks the work it decorates (a PTI files with a typed
       location exactly as before). */
    getCurrent: function (timeoutMs) {
      var ms = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs : 15000;
      var fresh = lastFix;
      if (fresh && (Date.now() - (fresh.time || 0)) <= 5 * 60 * 1000) {
        return Promise.resolve(fresh);
      }
      function pluginAttempt() {
        var p = plugin();
        if (!p) return Promise.resolve(null);
        return new Promise(function (resolve) {
          var done = false;
          var wid = null;
          function fin(fix) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (wid !== null) { try { p.removeWatcher({ id: wid }); } catch (e) {} }
            resolve(fix || null);
          }
          var timer = setTimeout(function () { fin(null); }, ms);
          try {
            p.addWatcher(
              { requestPermissions: true, stale: true, distanceFilter: 0 },
              function (location, error) {
                if (error) { fin(null); return; }
                if (location) fin(record(location));
              }
            ).then(function (id) {
              wid = id;
              if (done) { try { p.removeWatcher({ id: id }); } catch (e) {} }
            }).catch(function () { fin(null); });
          } catch (e) { fin(null); }
        });
      }
      function w3cAttempt() {
        return new Promise(function (resolve) {
          try {
            if (!navigator || !navigator.geolocation || !navigator.geolocation.getCurrentPosition) {
              resolve(null);
              return;
            }
            navigator.geolocation.getCurrentPosition(
              function (pos) {
                if (!pos || !pos.coords) { resolve(null); return; }
                resolve(record({
                  latitude: pos.coords.latitude,
                  longitude: pos.coords.longitude,
                  accuracy: pos.coords.accuracy,
                  altitude: pos.coords.altitude,
                  speed: pos.coords.speed,
                  bearing: pos.coords.heading,
                  time: pos.timestamp || Date.now()
                }));
              },
              function () { resolve(null); },
              { enableHighAccuracy: false, timeout: ms, maximumAge: 60000 }
            );
          } catch (e) { resolve(null); }
        });
      }
      return pluginAttempt()
        .then(function (fix) { return fix || pluginAttempt(); })
        .then(function (fix) { return fix || w3cAttempt(); })
        .then(function (fix) {
          if (fix) return fix;
          if (lastFix) {
            var stale = {};
            for (var k in lastFix) stale[k] = lastFix[k];
            stale.stale = true;
            return stale;
          }
          return null;
        })
        .catch(function () { return lastFix; });
    },

    /* Free address -> coordinates lookup (OpenStreetMap Nominatim; no
       API key, $0). Works anywhere fetch works — this is NOT the
       native location plugin, so it is available on web too. Always
       resolves (null on any failure / no match) so callers can treat
       a miss as "no coordinates", never an error state. Callers are
       responsible for asking rarely: geocode once, persist the
       result on the record it belongs to. */
    geocode: function (address) {
      if (!address || typeof address !== 'string' || typeof fetch !== 'function') {
        return Promise.resolve(null);
      }
      var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' +
        encodeURIComponent(address);
      return fetch(url, { headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j || !j.length) return null;
          var lat = parseFloat(j[0].lat), lng = parseFloat(j[0].lon);
          if (!isFinite(lat) || !isFinite(lng)) return null;
          return { latitude: lat, longitude: lng, label: j[0].display_name || address };
        })
        .catch(function () { return null; });
    }
  };

  window.MeticulousGeo = Geo;
  try { if (window.App) window.App.geo = Geo; } catch (e) {}
})();
