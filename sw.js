// Meticulous service worker v5 — EVICTION NOTICE
// The old cache-first SW trapped users on stale files. This version
// unregisters itself so the app always loads fresh. A smarter offline
// SW will return once the update pipeline is proven.
self.addEventListener('install', function (e) {
  e.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.registration.unregister(); })
      .then(function () { return self.clients.claim(); })
  );
});
