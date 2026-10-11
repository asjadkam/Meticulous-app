// Meticulous service worker — offline app shell cache with auto-update
// Bump CACHE on every deploy so users always get the latest version.
var CACHE = 'meticulous-v3';
var SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/firebase.js',
  '/assets/manifest.json',
  '/assets/logo.svg',
  '/assets/icon-192.png',
  '/assets/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Allow the page to tell us to activate immediately when user taps "Update"
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isShell(url) {
  return url.pathname === '/' || url.pathname === '/index.html' ||
    url.pathname.indexOf('/js/') === 0 || url.pathname.indexOf('/css/') === 0;
}

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  // Never cache Firebase / Google API calls
  if (/googleapis\.com|gstatic\.com|firebaseio\.com|fcm\.googleapis\.com/.test(url.hostname)) return;
  // App shell: network-first so updates always come through when online
  if (isShell(url)) {
    e.respondWith(
      fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      }).catch(function () {
        return caches.match(e.request).then(function (hit) { return hit || caches.match('/index.html'); });
      })
    );
    return;
  }
  // Assets (images, etc.): cache-first for speed
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      }).catch(function () {
        return caches.match('/index.html');
      });
    })
  );
});
