/* Meticulous OTA (over-the-air) updater — v30.
 *
 * Lets beta testers receive web updates (HTML/JS/CSS/modules) WITHOUT
 * reinstalling the APK. Only native changes (new plugins, permissions,
 * AndroidManifest edits, Capacitor upgrades) still need a fresh APK —
 * those are announced via the APK banner in js/app.js (version.json:apkUrl).
 *
 * How it works (native app only; no-op on the plain website):
 *  1. This script runs before anything else. Inside the Capacitor WebView it
 *     fetches https://meticulous-dd570.web.app/version.json (short timeout).
 *  2. If the hosted webVersion is newer than the local copy, only the files
 *     whose sha256 changed are downloaded into the app-private directory
 *     "ota-web", hash-verified, then the WebView is redirected to that copy
 *     via Capacitor.convertFileSrc(). Origin stays https://localhost, so
 *     localStorage, Firebase Auth and cloud sync all keep working.
 *  3. If offline (or anything fails), the app boots the newest LOCAL copy:
 *     the previously downloaded OTA copy if present, else the APK-bundled www/.
 *
 * Safety: every failure path resolves OTA.ready() and boots local. An update
 * never leaves the user stranded. Interrupted downloads self-heal on the
 * next launch (version.json in ota-web is only written after ALL files land).
 *
 * v35 integrity: a bundle activates only after EVERY manifest file verifies
 * on disk by sha256 (not just the files that download fetched). At every
 * launch the running OTA copy re-verifies itself against its manifest and
 * re-fetches missing/corrupt files — even at the same version number — and
 * failures are surfaced via localStorage 'ota_notice' (shown in
 * Preferences) instead of failing silently.
 */
(function () {
  'use strict';

  var HOST = 'https://meticulous-dd570.web.app';
  var OTA_DIR = 'ota-web';
  var TEXT_EXT = { html: 1, js: 1, css: 1, json: 1, svg: 1, txt: 1, xml: 1, webmanifest: 1 };

  var state = 'pending'; // pending -> ready
  var waiters = [];
  var currentInfo = { bundled: 0, ota: 0, running: 'bundled' };

  function ready() {
    return new Promise(function (res) {
      if (state === 'ready') res();
      else waiters.push(res);
    });
  }
  function done() {
    if (state === 'ready') return;
    state = 'ready';
    try { window.__otaActive = false; } catch (e) {}
    var w = waiters; waiters = [];
    for (var i = 0; i < w.length; i++) { try { w[i](); } catch (e) {} }
  }

  function setStatus(msg) {
    try {
      var t = document.querySelector('#splash .sp-tag');
      if (t) t.textContent = msg;
    } catch (e) {}
  }

  function isNative() {
    try {
      var Cap = window.Capacitor;
      return !!(Cap && Cap.Plugins && Cap.Plugins.Filesystem && Cap.convertFileSrc);
    } catch (e) { return false; }
  }
  function FS() { return window.Capacitor.Plugins.Filesystem; }

  function fetchTimeout(url, ms, asBuffer) {
    return new Promise(function (resolve, reject) {
      var to = setTimeout(function () { reject(new Error('timeout')); }, ms || 6000);
      var p;
      try {
        if (window.AbortController) {
          var c = new AbortController();
          var to2 = setTimeout(function () { try { c.abort(); } catch (e) {} }, ms || 6000);
          p = fetch(url, { cache: 'no-store', signal: c.signal }).finally(function () { clearTimeout(to2); });
        } else {
          p = fetch(url, { cache: 'no-store' });
        }
      } catch (e) { clearTimeout(to); reject(e); return; }
      p.then(function (r) {
        clearTimeout(to);
        if (!r.ok) throw new Error('http ' + r.status);
        return asBuffer ? r.arrayBuffer() : r.text();
      }).then(resolve, function (e) { clearTimeout(to); reject(e); });
    });
  }

  function bufToBase64(buf) {
    var bytes = new Uint8Array(buf), s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }
  function hexOf(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += ('0' + b[i].toString(16)).slice(-2);
    return s;
  }
  function sha256hex(buf) {
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      return crypto.subtle.digest('SHA-256', buf).then(hexOf);
    }
    return Promise.resolve(null); // hash check skipped, download still validated by HTTP status
  }
  function looksLikeHtmlFallback(path, text) {
    var p = path.toLowerCase();
    if (p.indexOf('.js') > 0 || p.indexOf('.css') > 0 || p.indexOf('.json') > 0) {
      return /^\s*<!doctype html/i.test(text);
    }
    return false;
  }

  /* v35 integrity helpers. Root cause of the v33/v34 partial bundles:
     downloadFiles() only ever fetched files whose hash differed from the
     BASE manifest, then booted ota-web as if it were the complete app —
     files unchanged between versions (most modules, the logo) were never
     in ota-web at all, and nothing ever checked. From v35: a bundle only
     activates when EVERY manifest file is present on disk with a matching
     sha256, and the running copy re-verifies (and repairs) itself at
     launch — including when the version number already matches, which is
     exactly the trap a partial bundle sets. */
  function b64ToBuf(b64) {
    var bin = atob(b64 || ''), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  function noteFailure(msg) {
    try { localStorage.setItem('ota_notice', msg); } catch (e) {}
    setStatus(msg);
  }
  function clearNotice() {
    try { localStorage.removeItem('ota_notice'); } catch (e) {}
  }
  function fetchOne(p, expectedHash) {
    return fetchTimeout(HOST + '/' + p, 20000, true).then(function (buf) {
      return sha256hex(buf).then(function (hex) {
        if (hex && expectedHash && hex !== expectedHash) throw new Error('hash mismatch: ' + p);
        var str;
        try { str = new TextDecoder().decode(buf); } catch (e) { str = ''; }
        if (str && looksLikeHtmlFallback(p, str)) throw new Error('fallback html: ' + p);
        return buf;
      });
    });
  }
  function writeBuf(p, buf) {
    return FS().writeFile({ path: OTA_DIR + '/' + p, data: bufToBase64(buf), directory: 'DATA', recursive: true });
  }
  /* Check every manifest file in ota-web against its sha256. Resolves
     with the list of missing/corrupt paths ([] = bundle complete). When
     crypto.subtle is unavailable, degrades to an existence check. */
  function verifySet(files) {
    var paths = Object.keys(files || {});
    var bad = [];
    var chain = Promise.resolve();
    paths.forEach(function (p) {
      chain = chain.then(function () {
        return FS().readFile({ path: OTA_DIR + '/' + p, directory: 'DATA' }).then(function (r) {
          return sha256hex(b64ToBuf(r.data)).then(function (hex) {
            if (hex && hex !== files[p]) bad.push(p);
          });
        }).catch(function () { bad.push(p); });
      });
    });
    return chain.then(function () { return bad; });
  }
  function repairFiles(files, badPaths) {
    var chain = Promise.resolve();
    badPaths.forEach(function (p) {
      chain = chain.then(function () {
        return fetchOne(p, files[p]).then(function (buf) { return writeBuf(p, buf); });
      });
    });
    return chain;
  }

  function readOtaVersionJson() {
    return FS().readFile({ path: OTA_DIR + '/version.json', directory: 'DATA', encoding: 'utf8' })
      .then(function (r) {
        try { return JSON.parse(r.data); } catch (e) { return null; }
      })
      .catch(function () { return null; });
  }
  function readBundledVersionJson() {
    return fetchTimeout('version.json', 4000, false)
      .then(function (t) { try { return JSON.parse(t); } catch (e) { return null; } })
      .catch(function () { return null; });
  }

  function downloadFiles(hosted, baseManifest, onProgress) {
    var files = hosted.files || {};
    var paths = Object.keys(files);
    var todo = [];
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      if (!baseManifest || baseManifest[p] !== files[p]) todo.push(p);
    }
    // Backup existing files so a failed update can roll back to a consistent copy.
    var backups = {}; // path -> base64 data | null (null = did not exist)
    function backupOne(p) {
      return FS().readFile({ path: OTA_DIR + '/' + p, directory: 'DATA' }).then(
        function (r) { backups[p] = r.data; },
        function () { backups[p] = null; }
      );
    }
    function rollback() {
      var chain = Promise.resolve();
      Object.keys(backups).forEach(function (p) {
        chain = chain.then(function () {
          if (backups[p] === null) {
            return FS().deleteFile({ path: OTA_DIR + '/' + p, directory: 'DATA' }).catch(function () {});
          }
          return FS().writeFile({ path: OTA_DIR + '/' + p, data: backups[p], directory: 'DATA', recursive: true }).catch(function () {});
        });
      });
      return chain;
    }
    var chain = Promise.resolve();
    todo.forEach(function (p) { chain = chain.then(function () { return backupOne(p); }); });
    var doneCount = 0;
    todo.forEach(function (p) {
      chain = chain.then(function () {
        onProgress(doneCount, todo.length, p);
        return fetchOne(p, files[p]).then(function (buf) {
          return writeBuf(p, buf);
        }).then(function () { doneCount++; });
      });
    });
    return chain.then(function () {
      // remove files deleted upstream
      var rm = [];
      if (baseManifest) {
        Object.keys(baseManifest).forEach(function (p) {
          if (!files[p]) rm.push(p);
        });
      }
      var rc = Promise.resolve();
      rm.forEach(function (p) {
        rc = rc.then(function () {
          return FS().deleteFile({ path: OTA_DIR + '/' + p, directory: 'DATA' }).catch(function () {});
        });
      });
      return rc;
    }).then(function () {
      // v35: FULL verification before this bundle may activate — every
      // manifest file must be on disk with a matching hash, not just the
      // ones this download fetched. Missing/corrupt files (e.g. unchanged
      // files a diff-only download never wrote) are re-fetched; anything
      // still bad after 2 repair rounds aborts the update and the
      // rollback below keeps the previous complete bundle.
      function attempt(round) {
        return verifySet(files).then(function (bad) {
          if (!bad.length) return;
          if (round >= 2) throw new Error('incomplete bundle: ' + bad.join(', '));
          var bc = Promise.resolve();
          bad.forEach(function (p) {
            if (!(p in backups)) bc = bc.then(function () { return backupOne(p); });
          });
          return bc.then(function () { return repairFiles(files, bad); })
            .then(function () { return attempt(round + 1); });
        });
      }
      return attempt(0);
    }).then(function () {
      // commit: version.json goes last — an interrupted update self-heals
      var data = btoa(unescape(encodeURIComponent(JSON.stringify(hosted))));
      return FS().writeFile({ path: OTA_DIR + '/version.json', data: data, directory: 'DATA', recursive: true })
        .then(function () { clearNotice(); });
    }).catch(function (e) {
      // roll the OTA dir back to its previous consistent state, then rethrow
      return rollback().then(function () { throw e; });
    });
  }

  function restartToOta() {
    try { window.__otaActive = false; } catch (e) {}
    try { sessionStorage.setItem('ota_boot', '1'); } catch (e) {}
    FS().getUri({ path: OTA_DIR + '/index.html', directory: 'DATA' }).then(function (r) {
      var url = window.Capacitor.convertFileSrc(r.uri);
      setStatus('Restarting…');
      window.location.href = url;
    }).catch(function () { done(); });
  }

  function alreadyInOtaCopy() {
    try {
      if (location.href.indexOf('_capacitor_file_') !== -1) return true;
      if (sessionStorage.getItem('ota_boot') === '1') return true;
    } catch (e) {}
    return false;
  }

  function bootCheck() {
    if (!isNative()) { done(); return; }           // website / desktop: no-op
    if (alreadyInOtaCopy()) {                       // running the downloaded copy
      currentInfo.running = 'ota';
      readOtaVersionJson().then(function (v) {
        if (v && v.webVersion) currentInfo.ota = v.webVersion;
        /* v35 self-heal: never trust the version number alone — verify
           the running copy's files against its own manifest at every
           launch. A partial bundle is repaired in place from the host at
           the SAME version, then restarted once into the healed copy
           (sessionStorage guard prevents a repair loop). */
        if (!v || !v.files) { done(); return; }
        verifySet(v.files).then(function (bad) {
          if (!bad.length) { clearNotice(); done(); return; }
          var alreadyTried = false;
          try { alreadyTried = sessionStorage.getItem('ota_healed') === '1'; } catch (e) {}
          if (alreadyTried) {
            noteFailure('Some app files are damaged (' + bad.length + ') and a repair attempt did not fix them. Connect to the internet and reopen the app.');
            done();
            return;
          }
          setStatus('Repairing app files…');
          fetchTimeout(HOST + '/version.json', 6000, false).then(function (t) {
            var hosted = null;
            try { hosted = JSON.parse(t); } catch (e) {}
            // Repair against the running manifest's hashes; when the host
            // serves the same version, only files whose hashes agree are
            // used as a repair source.
            var src = {};
            Object.keys(v.files).forEach(function (p) {
              if (!hosted || !hosted.files || hosted.files[p] === v.files[p]) src[p] = v.files[p];
            });
            var todoBad = bad.filter(function (p) { return !!src[p]; });
            if (!todoBad.length) throw new Error('no repair source');
            return repairFiles(src, todoBad).then(function () { return verifySet(v.files); });
          }).then(function (bad2) {
            if (bad2 && bad2.length) {
              noteFailure('Some app files could not be repaired. Connect to the internet and reopen the app.');
              done();
              return;
            }
            try { sessionStorage.setItem('ota_healed', '1'); } catch (e) {}
            clearNotice();
            restartToOta();
          }).catch(function () {
            noteFailure('Some app files are damaged and could not be repaired (no connection?). Reopen the app with internet to fix this.');
            done();
          });
        }).catch(function () { done(); });
      }).catch(done);
      return;
    }
    // Cold start from the APK-bundled copy.
    try { window.__otaActive = true; } catch (e) {}
    setStatus('Checking for updates…');
    var bundled = null, otaLocal = null;
    readBundledVersionJson().then(function (v) {
      bundled = v;
      if (v && v.webVersion) currentInfo.bundled = v.webVersion;
      return readOtaVersionJson();
    }).then(function (v) {
      otaLocal = v;
      if (v && v.webVersion) currentInfo.ota = v.webVersion;
      return fetchTimeout(HOST + '/version.json', 6000, false).then(function (t) {
        try { return JSON.parse(t); } catch (e) { return null; }
      });
    }).then(function (hosted) {
      var localVer = Math.max(currentInfo.bundled, currentInfo.ota);
      if (!hosted || !hosted.webVersion || !hosted.files || hosted.webVersion <= localVer) {
        // No update (or offline check failed and hosted==null): run newest local copy.
        if (currentInfo.ota > currentInfo.bundled && otaLocal && otaLocal.files) {
          /* v35: verify the stored OTA copy before booting into it.
             Verification is local (works offline); repair needs the host.
             If the copy is damaged and cannot be repaired, boot the
             APK-bundled copy instead — it is complete by construction —
             and say so, rather than booting a broken bundle. */
          verifySet(otaLocal.files).then(function (bad) {
            if (!bad.length) { restartToOta(); return; }
            setStatus('Repairing app files…');
            repairFiles(otaLocal.files, bad).then(function () { return verifySet(otaLocal.files); })
              .then(function (bad2) {
                if (bad2.length) {
                  noteFailure('The downloaded update is damaged and could not be repaired. Starting the installed version instead — reopen the app with internet to fix this.');
                  done();
                } else {
                  clearNotice();
                  restartToOta();
                }
              }).catch(function () {
                noteFailure('The downloaded update is damaged and could not be repaired (no connection?). Starting the installed version instead.');
                done();
              });
          }).catch(function () { restartToOta(); });
          return;
        }
        if (currentInfo.ota > currentInfo.bundled) { restartToOta(); return; }
        done();
        return;
      }
      var base = (otaLocal && otaLocal.files) || (bundled && bundled.files) || null;
      setStatus('Downloading update…');
      var total = Object.keys(hosted.files).length;
      downloadFiles(hosted, base, function (n, count) {
        setStatus('Downloading update… ' + n + '/' + count);
      }).then(function () {
        setStatus('Update ready — restarting…');
        setTimeout(restartToOta, 400);
      }).catch(function (e) {
        noteFailure('Update to v' + hosted.webVersion + ' did not finish: ' + (e && e.message ? e.message : 'download error') + '. Your current version was kept.');
        setStatus('Update failed — starting installed version…');
        setTimeout(function () {
          if (currentInfo.ota > currentInfo.bundled) restartToOta();
          else done();
        }, 800);
      });
    }).catch(function () {
      // offline or any error: newest local copy wins
      if (currentInfo.ota > currentInfo.bundled) restartToOta();
      else done();
    });
  }

  /* Manual check (Preferences > Advanced > "Check for updates"). Resolves with
     { updated:boolean, version:number, reason:string }. Never throws. */
  function checkNow() {
    return new Promise(function (resolve) {
      if (!isNative()) { resolve({ updated: false, version: 0, reason: 'OTA works inside the installed app.' }); return; }
      var localVer = 0, otaLocal = null, bundled = null;
      readOtaVersionJson().then(function (v) {
        otaLocal = v;
        if (v && v.webVersion) localVer = Math.max(localVer, v.webVersion);
        return readBundledVersionJson();
      }).then(function (v) {
        bundled = v;
        if (v && v.webVersion) localVer = Math.max(localVer, v.webVersion);
        return fetchTimeout(HOST + '/version.json', 10000, false).then(function (t) {
          try { return JSON.parse(t); } catch (e) { return null; }
        });
      }).then(function (hosted) {
        if (!hosted) { resolve({ updated: false, version: localVer, reason: 'Could not reach the update server. Check your connection.' }); return; }
        if (!hosted.webVersion || !hosted.files || hosted.webVersion < localVer) {
          resolve({ updated: false, version: localVer, reason: '' });
          return;
        }
        if (hosted.webVersion === localVer) {
          /* v35: "up to date" must mean COMPLETE, not just the same
             number — verify the stored OTA copy and repair it in place. */
          if (otaLocal && otaLocal.files) {
            verifySet(otaLocal.files).then(function (bad) {
              if (!bad.length) { clearNotice(); resolve({ updated: false, version: localVer, reason: '' }); return; }
              repairFiles(hosted.files, bad).then(function () { return verifySet(otaLocal.files); })
                .then(function (bad2) {
                  if (bad2.length) {
                    var msg = 'Some app files are damaged and could not be repaired. Check your connection and try again.';
                    noteFailure(msg);
                    resolve({ updated: false, version: localVer, reason: msg });
                  } else {
                    clearNotice();
                    resolve({ updated: true, version: localVer, reason: 'Repaired ' + bad.length + ' missing/damaged app file(s).' });
                  }
                }).catch(function () {
                  var msg = 'Some app files are damaged and could not be repaired. Check your connection and try again.';
                  noteFailure(msg);
                  resolve({ updated: false, version: localVer, reason: msg });
                });
            }).catch(function () { resolve({ updated: false, version: localVer, reason: '' }); });
          } else {
            resolve({ updated: false, version: localVer, reason: '' });
          }
          return;
        }
        try { window.__otaActive = true; } catch (e) {}
        var base = (otaLocal && otaLocal.files) || (bundled && bundled.files) || null;
        downloadFiles(hosted, base, function () {}).then(function () {
          try { window.__otaActive = false; } catch (e) {}
          resolve({ updated: true, version: hosted.webVersion, reason: '' });
        }).catch(function (e) {
          try { window.__otaActive = false; } catch (e) {}
          var msg = 'Update did not finish: ' + (e && e.message ? e.message : 'download error') + '. Your current version was kept.';
          noteFailure(msg);
          resolve({ updated: false, version: localVer, reason: msg });
        });
      }).catch(function () {
        resolve({ updated: false, version: localVer, reason: 'Could not reach the update server. Check your connection.' });
      });
    });
  }

  function currentVersion() {
    return readOtaVersionJson().then(function (v) {
      var o = (v && v.webVersion) || 0;
      return readBundledVersionJson().then(function (b) {
        var bd = (b && b.webVersion) || 0;
        return { bundled: bd, ota: o, active: Math.max(bd, o), inOtaCopy: alreadyInOtaCopy() };
      });
    });
  }

  window.OTA = {
    ready: ready,
    checkNow: checkNow,
    currentVersion: currentVersion,
    restart: restartToOta
  };

  // Kick off immediately; app.js waits on OTA.ready() before init.
  try { bootCheck(); } catch (e) { done(); }
})();
