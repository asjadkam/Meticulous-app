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

  /* v269 (AUTH-LOGOUT-ON-UPDATE): the first-auth-verdict channel.
     onAuthStateChanged's FIRST callback is the only moment the app
     learns whether a persisted session exists. js/app.js's boot
     gate waits on whenAuthKnown() instead of guessing "signed out"
     while the restore is still in flight — the guess is what
     stranded signed-in users on the sign-in landing after every
     OTA restart (the restore lands during the OTA gate; init then
     slammed App.onAuth(null) over it and nothing ever re-checked).
     The flag flips exactly once, carrying the user (or null) that
     first callback delivered. The SDK-missing / init-failure paths
     mark it known-with-null AND set authUnavailable: there the
     absence is permanent for this page, not a restore still in
     flight, so the boot may proceed exactly as it always has.
     Persistence itself is untouched — the SDK's default (local)
     persistence at the app origin is what carries the session
     across bundle swaps; see the v269 entry in BUGS.md. */
  FB.authStateKnown = false;
  FB.authUnavailable = false;
  var _authKnownWaiters = [];
  function noteAuthKnown(user) {
    if (FB.authStateKnown) return;
    FB.authStateKnown = true;
    var w = _authKnownWaiters; _authKnownWaiters = [];
    for (var i = 0; i < w.length; i++) { try { w[i](user || null); } catch (e) {} }
  }
  FB.whenAuthKnown = function () {
    if (FB.authStateKnown) return Promise.resolve(FB.user || null);
    return new Promise(function (res) { _authKnownWaiters.push(res); });
  };

  function init() {
    if (typeof firebase === 'undefined' || !firebase.apps) {
      console.warn('Firebase SDK not loaded; running in local mode.');
      FB.authUnavailable = true; noteAuthKnown(null);
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
        noteAuthKnown(user);
        if (window.App && App.onAuth) App.onAuth(user);
      });
    } catch (e) {
      console.error('Firebase init failed:', e);
      FB.authUnavailable = true; noteAuthKnown(null);
      if (window.App && App.onAuth) App.onAuth(null);
    }
  }

  /* v45: normalize at the boundary too — trim + lowercase the email and
     trim the password, so no caller can re-introduce the trailing-space
     lockout (auth/invalid-credential, Oct 12) below the UI layer. */
  function normEmail(email) { return String(email || '').trim().toLowerCase(); }
  function normPw(password) { return String(password || '').trim(); }
  FB.signUp = function (email, password) {
    return FB.auth.createUserWithEmailAndPassword(normEmail(email), normPw(password));
  };
  FB.signIn = function (email, password) {
    return FB.auth.signInWithEmailAndPassword(normEmail(email), normPw(password));
  };
  FB.sendReset = function (email) {
    return FB.auth.sendPasswordResetEmail(normEmail(email));
  };
  /* v34: in-app password change (the Security card; since v106 it
     lives on the Account & login screen, modules/account.js).
     updatePassword can reject with auth/requires-recent-login;
     reauthenticate covers it. */
  FB.changePassword = function (newPassword) {
    if (!FB.auth || !FB.auth.currentUser) return Promise.reject(new Error('Not signed in.'));
    return FB.auth.currentUser.updatePassword(normPw(newPassword));
  };
  FB.reauthenticate = function (password) {
    if (!FB.auth || !FB.auth.currentUser) return Promise.reject(new Error('Not signed in.'));
    var cred = firebase.auth.EmailAuthProvider.credential(FB.auth.currentUser.email, normPw(password));
    return FB.auth.currentUser.reauthenticateWithCredential(cred);
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
  /* v276 (SPARK-QUOTA): ONE doc, one read. The record-save
     merge in cloudsync used to loadDocs the whole kv tree
     (~36 reads) to find the single doc it merges; on the free
     plan's 50k reads/day that made every fuel/PTI/session save
     cost 36 reads. Resolves null when signed out or the doc
     does not exist — the same shape loadDocs items carry. */
  FB.loadDoc = function (collection, id) {
    var c = FB.col(collection);
    if (!c) return Promise.resolve(null);
    return c.doc(id).get().then(function (snap) {
      if (!snap.exists) return null;
      return Object.assign({ id: snap.id }, snap.data());
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
      try { new Notification(title, { body: body, icon: 'assets/icon-192.png' }); } catch (e) {}
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
