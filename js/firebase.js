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
  /* v438 (ACCOUNT-DELETE — owner order Nov 12, 2026: "Add the delete
     account button"; also Google Play's in-app account-deletion
     rule): the cloud engine behind the Delete account card on the
     Account & login screen (modules/account.js drives the confirm,
     the re-authentication, the device wipe and the auth delete
     around it). FB.deleteOwnData() erases, IN ORDER:
       (1) the account's own tree — every doc in every subcollection
           under users/{uid} (OWN_COLLECTIONS is the union of every
           collection name the app writes: kv is the cloudsync
           store; the rest are the record collections named in
           firestore.rules and the FB.saveDoc call sites), then the
           users/{uid} document itself;
       (2) the Connect presence — the directory/{uid} listing; every
           requests pair: accepted pairs are ENDED with the app's
           own stamp (endedAt — either party may stamp it; the same
           write the one-time sweep uses), pending requests
           addressed TO this account are declined; the account's own
           published share docs lose their audience
           (shareddays/sharedrecords viewers -> [] and the records
           sections emptied; sharedbilling/sharedmanifests emptied
           to the v148 cleared shape); the account's sharedphotos
           are deleted outright (the one share collection the rules
           let the owner delete);
       (3) Firebase Storage — the app stores NO files there (photos
           ride inside Firestore records, which step (1) deletes),
           so there is nothing to do in this step.
     The rules forbid deleting requests / shareddays / sharedrecords
     / sharedbilling / sharedmanifests / pipedispatches docs outright
     (delete:false since v131–v148): those records are the other
     party's copies too, so the flow ends the pairs and strips the
     audiences instead — after it runs no connection can read
     anything of this account any more, and what a peer already
     received stays in their hands, exactly as the privacy policy
     states. (Pending requests SENT BY this account cannot be
     withdrawn under the rules — the recipient declines them; the
     account they point from no longer exists.)
     Any failure rejects immediately: later steps never run, and the
     auth account is untouched — the caller deletes it LAST, only on
     this promise resolving. Safe to retry after a partial failure:
     every step is a delete or an idempotent stamp on what remains. */
  FB.OWN_COLLECTIONS = ['kv', 'meta', 'sessions', 'dispatches', 'fuel', 'damage',
    'invoices', 'maintenance', 'pti', 'documents', 'feedback', 'revenue',
    'pnl', 'pnl_drivers', 'pnl_wage_entries', 'pnl_card_wages', 'pnl_travel_claims'];

  function deleteEveryDoc(ref) {
    return ref.get().then(function (snap) {
      var refs = [];
      snap.forEach(function (d) { refs.push(d.ref); });
      var i = 0;
      function chunk() {
        if (i >= refs.length) return Promise.resolve();
        var batch = FB.db.batch();
        var n = 0;
        while (i < refs.length && n < 400) { batch.delete(refs[i]); i++; n++; }
        return batch.commit().then(chunk);
      }
      return chunk();
    });
  }

  function endAllPairs(db, uid) {
    var now = Date.now();
    function handle(snap) {
      var jobs = [];
      snap.forEach(function (d) {
        var r = d.data() || {};
        if (r.status === 'accepted' && !((r.endedAt || 0) > 0)) {
          jobs.push(d.ref.update({ endedAt: now, updatedAt: now }));
        } else if (r.status === 'pending' && r.to === uid) {
          jobs.push(d.ref.update({ status: 'declined', updatedAt: now }));
        }
      });
      return Promise.all(jobs);
    }
    return db.collection('requests').where('from', '==', uid).get().then(handle)
      .then(function () { return db.collection('requests').where('to', '==', uid).get(); })
      .then(handle);
  }

  function stripOwnShares(db, uid) {
    var now = Date.now();
    var jobs = [];
    jobs.push(db.collection('shareddays').where('driver', '==', uid).get().then(function (snap) {
      var js = [];
      snap.forEach(function (d) { js.push(d.ref.update({ viewers: [] })); });
      return Promise.all(js);
    }));
    jobs.push(db.collection('sharedrecords').doc(uid).get().then(function (snap) {
      if (!snap.exists) return null;
      return snap.ref.update({ viewers: [], fuel: [], expenses: [], pti: [], damage: [] });
    }));
    jobs.push(db.collection('sharedbilling').where('driver', '==', uid).get().then(function (snap) {
      var js = [];
      snap.forEach(function (d) {
        var r = d.data() || {};
        js.push(d.ref.set({
          driver: uid, viewer: r.viewer,
          driverName: r.driverName || '', driverBusiness: r.driverBusiness || '',
          invoices: [], manifests: [], updatedAt: now
        }));
      });
      return Promise.all(js);
    }));
    jobs.push(db.collection('sharedmanifests').where('driver', '==', uid).get().then(function (snap) {
      var js = [];
      snap.forEach(function (d) {
        var r = d.data() || {};
        js.push(d.ref.set({
          driver: uid, viewer: r.viewer,
          driverName: r.driverName || '', driverBusiness: r.driverBusiness || '',
          manifests: [], updatedAt: now
        }));
      });
      return Promise.all(js);
    }));
    jobs.push(deleteEveryDoc(db.collection('sharedphotos').where('driver', '==', uid)));
    return Promise.all(jobs);
  }

  FB.deleteOwnData = function () {
    if (!FB.ready || !FB.user || !FB.db) return Promise.reject(new Error('Not signed in.'));
    var uid = FB.user.uid;
    var db = FB.db;
    var userRef = db.collection('users').doc(uid);
    var chain = Promise.resolve();
    FB.OWN_COLLECTIONS.forEach(function (name) {
      chain = chain.then(function () { return deleteEveryDoc(userRef.collection(name)); });
    });
    chain = chain.then(function () { return userRef.delete(); });
    chain = chain.then(function () { return db.collection('directory').doc(uid).delete(); });
    chain = chain.then(function () { return endAllPairs(db, uid); });
    chain = chain.then(function () { return stripOwnShares(db, uid); });
    return chain;
  };
  /* v438: the LAST step of the delete flow — the caller runs it
     only after FB.deleteOwnData() has resolved and the device store
     has been wiped, and re-authenticates first (delete() demands a
     recent login, same as updatePassword). */
  FB.deleteAuthAccount = function () {
    if (!FB.auth || !FB.auth.currentUser) return Promise.reject(new Error('Not signed in.'));
    return FB.auth.currentUser.delete();
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
