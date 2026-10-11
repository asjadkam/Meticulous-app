/* Firebase client integration (compat SDKs loaded via CDN in index.html) */
(function () {
  'use strict';

  var firebaseConfig = {
    apiKey: "AIzaSyDVfWYmz-20ygXfdm-T8DFcMWNtw_bfva8",
    authDomain: "meticulous-dd570.firebaseapp.com",
    projectId: "meticulous-dd570",
    storageBucket: "meticulous-dd570.firebasestorage.app",
    messagingSenderId: "1047679373820",
    appId: "1:1047679373820:web:bd75841126fa2561f82279"
  };
  var VAPID_KEY = "BOtJEJ0lJrlDmC14afqSWUZ9dTKFBls_thzsMkPQy91E-XKvhe8U-nT9syIHZgZdzyX_MYpAjRGtyec2ZtO2gp0";

  var FB = {
    ready: false,
    user: null,
    vapidKey: VAPID_KEY,
    config: firebaseConfig
  };
  window.FB = FB;

  function init() {
    if (typeof firebase === 'undefined' || !firebase.apps) {
      console.warn('Firebase SDK not loaded; running in local mode.');
      if (window.App && App.onAuth) App.onAuth(null);
      return;
    }
    try {
      firebase.initializeApp(firebaseConfig);
      FB.auth = firebase.auth();
      FB.db = firebase.firestore();
      try { FB.messaging = firebase.messaging(); } catch (e) { console.warn('FCM unavailable:', e.message); }
      FB.ready = true;
      FB.auth.onAuthStateChanged(function (user) {
        FB.user = user;
        if (window.App && App.onAuth) App.onAuth(user);
      });
    } catch (e) {
      console.error('Firebase init failed:', e);
      if (window.App && App.onAuth) App.onAuth(null);
    }
  }

  FB.signUp = function (email, password) {
    return FB.auth.createUserWithEmailAndPassword(email, password);
  };
  FB.signIn = function (email, password) {
    return FB.auth.signInWithEmailAndPassword(email, password);
  };
  FB.signOut = function () {
    return FB.auth.signOut();
  };

  // Firestore helpers — everything scoped to the signed-in user
  FB.uid = function () { return FB.user ? FB.user.uid : 'local'; };
  FB.col = function (name) {
    if (!FB.ready || !FB.user) return null;
    return FB.db.collection('users').doc(FB.user.uid).collection(name);
  };
  FB.saveDoc = function (collection, id, data) {
    var c = FB.col(collection);
    if (!c) return Promise.resolve(null);
    data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    return c.doc(id).set(data, { merge: true });
  };
  FB.loadDocs = function (collection) {
    var c = FB.col(collection);
    if (!c) return Promise.resolve([]);
    return c.get().then(function (snap) {
      var out = [];
      snap.forEach(function (d) { out.push(Object.assign({ id: d.id }, d.data())); });
      return out;
    });
  };
  FB.deleteDoc = function (collection, id) {
    var c = FB.col(collection);
    if (!c) return Promise.resolve(null);
    return c.doc(id).delete();
  };

  // Push notifications
  FB.enablePush = function () {
    if (!FB.messaging) return Promise.resolve({ ok: false, reason: 'messaging-unavailable' });
    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') return { ok: false, reason: 'denied' };
      return FB.messaging.getToken({ vapidKey: VAPID_KEY }).then(function (token) {
        return FB.saveDoc('meta', 'fcm', { token: token, categories: ['reminders', 'base-alerts'] })
          .then(function () { return { ok: true, token: token }; });
      });
    }).catch(function (e) { return { ok: false, reason: e.message }; });
  };

  // Local push fallback (works without FCM, app must be open)
  FB.localNotify = function (title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      try { new Notification(title, { body: body, icon: '/assets/icon-192.png' }); } catch (e) {}
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
