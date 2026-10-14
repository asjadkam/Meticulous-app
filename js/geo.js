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

    getCurrent: function (timeoutMs) {
      var p = plugin();
      if (!p) return Promise.reject(new Error('Live location is not available in this build.'));
      var ms = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs : 15000;
      return new Promise(function (resolve, reject) {
        var done = false;
        var wid = null;
        var timer = setTimeout(function () {
          if (done) return;
          done = true;
          if (wid !== null) { try { p.removeWatcher({ id: wid }); } catch (e) {} }
          reject(new Error('Timed out waiting for a location fix.'));
        }, ms);
        p.addWatcher(
          { requestPermissions: true, stale: true, distanceFilter: 0 },
          function (location, error) {
            if (done) return;
            if (error) {
              done = true;
              clearTimeout(timer);
              if (wid !== null) { try { p.removeWatcher({ id: wid }); } catch (e) {} }
              reject(error);
              return;
            }
            if (location) {
              done = true;
              clearTimeout(timer);
              var fix = record(location);
              if (wid !== null) { try { p.removeWatcher({ id: wid }); } catch (e) {} }
              resolve(fix);
            }
          }
        ).then(function (id) {
          wid = id;
          if (done) { try { p.removeWatcher({ id: id }); } catch (e) {} }
        }).catch(function (err) {
          if (!done) { done = true; clearTimeout(timer); reject(err); }
        });
      });
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
