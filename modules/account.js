/* Account & login module — the sign-in account line + change password.
   v106 (owner directive, Oct 16, 2026 19:49 MDT): "Give login its own
   page!" The Security card LIVED at the bottom of Preferences since
   v34/v52; it now has its own dedicated screen (drawer entry "Account
   & login", near the bottom of the menu — a rarely-used plumbing
   destination, not a feature card). Markup, ids, copy and wiring are
   the v34/v45/v95 code moved UNCHANGED: same fields (pf_pw_cur /
   pf_pw_new / pf_pw_conf / pf_pw_btn / pf_pw_note), same handler
   (FB.changePassword with the reauthenticate fallback), same sign-in
   door (pf_signin → App.goSignIn) in the signed-out render. Moving
   the password inputs off Preferences also unblocks assisted
   browsing of that page, which the password fields used to shield.
   v438 (owner order Nov 12, 2026: "Add the delete account button";
   also Google Play's in-app account-deletion rule): a fenced
   DELETE card now sits below the Security card — visually separated
   (red frame), after Change password as befits the destructive
   action. Two steps, no dark patterns: (1) the warning naming
   exactly what will be deleted + the account password (re-auth) +
   typing DELETE; (2) a final "Yes, delete everything" / "Keep my
   account". The cloud engine is FB.deleteOwnData (js/firebase.js);
   the auth account is deleted LAST, only after the data is gone
   and the device store (mt_* keys) has been wiped, then the app
   reloads into the signed-out state. Any failure stops the flow,
   keeps the user signed in, and shows a plain try-again / email
   meticuloustech1@gmail.com message — never a half-deleted account
   left silent. Local mode (no account) gets the same card as
   "Delete local data": the same two-step confirm, no password,
   and it wipes only this device's store. */
(function () {
  'use strict';
  var esc = function (s) { return App._esc(s); };

  Meticulous.modules.account = {
    render: function (body) {
      var signedIn = !!(window.FB && FB.user);
      var h = '<div class="card"><h3>🔒 Security</h3>';
      if (signedIn) {
        h += '<p class="note">Signed in as ' + esc(FB.user.email || '') + '</p>' +
          '<label class="f">Current password</label><input id="pf_pw_cur" type="password" autocomplete="current-password">' +
          '<label class="f">New password</label><input id="pf_pw_new" type="password" autocomplete="new-password">' +
          '<label class="f">Confirm new password</label><input id="pf_pw_conf" type="password" autocomplete="new-password">' +
          '<button class="btn ghost" id="pf_pw_btn" style="margin-top:10px;">Change password</button>' +
          '<p class="note" id="pf_pw_note"></p>';
      } else {
        /* v95: THE SIGN-IN DOOR — at the top of the Security card, in
           the open: a signed-out user sees it the moment this screen
           opens. One tap routes to the app's sign-in form
           (App.goSignIn); local data is untouched. */
        h += '<button class="btn primary" id="pf_signin">Sign in</button>' +
          '<p class="note">You are not signed in — this device is in Local mode, so your data lives only here. Sign in to back it up, sync your devices, and change your password.</p>';
      }
      h += '</div>';

      /* v438: THE DELETE CARD — fenced off below the Security card
         (red frame, its own card), after Change password. */
      h += '<div class="card" style="border:2px solid #c0392b;margin-top:16px;">' +
        '<h3>🗑 ' + (signedIn ? 'Delete account' : 'Delete local data') + '</h3>' +
        '<div id="pf_del_step1">';
      if (signedIn) {
        h += '<p class="note">This permanently deletes your account and everything in it — your days, tickets, loads, fuel, expenses, documents and settings, in the cloud and on this device — and ends all your Connect connections. Copies you already shared stay in the other person\'s account. <b>This cannot be undone.</b></p>' +
          '<label class="f">Your password</label><input id="pf_del_pw" type="password" autocomplete="current-password">' +
          '<label class="f">Type DELETE to confirm</label><input id="pf_del_type" type="text" autocomplete="off">' +
          '<button class="btn" id="pf_del_btn" style="margin-top:10px;background:#c0392b;color:#fff;">Delete my account</button>' +
          '<p class="note" id="pf_del_note"></p>';
      } else {
        h += '<p class="note">You are in Local mode — there is no cloud account to delete. This permanently deletes everything the app has stored on this device. <b>This cannot be undone.</b></p>' +
          '<label class="f">Type DELETE to confirm</label><input id="pf_del_type" type="text" autocomplete="off">' +
          '<button class="btn" id="pf_del_btn" style="margin-top:10px;background:#c0392b;color:#fff;">Delete local data</button>' +
          '<p class="note" id="pf_del_note"></p>';
      }
      h += '</div>' +
        '<div id="pf_del_step2" style="display:none;">' +
          '<p class="note"><b>Are you sure?</b> ' + (signedIn ? 'Your account and all its data will be deleted now.' : 'Everything the app has stored on this device will be deleted now.') + ' This cannot be undone.</p>' +
          '<button class="btn" id="pf_del_yes" style="background:#c0392b;color:#fff;">Yes, delete everything</button>' +
          '<button class="btn ghost" id="pf_del_no" style="margin-top:8px;">' + (signedIn ? 'Keep my account' : 'Keep my data') + '</button>' +
          '<p class="note" id="pf_del_note2"></p>' +
        '</div>' +
      '</div>';

      body.innerHTML = h;
      /* v95: the sign-in door (signed-out renders only — the button
         exists only in that render) */
      var signInBtn = body.querySelector('#pf_signin');
      if (signInBtn) signInBtn.onclick = function () { if (window.App && App.goSignIn) App.goSignIn(); };
      /* v34: change-password handler (signed-in only) */
      var pwBtn = body.querySelector('#pf_pw_btn');
      if (pwBtn) pwBtn.onclick = function () {
        var note = body.querySelector('#pf_pw_note');
        // same cleaning as sign-in (invisible-char strip + v45 trim), so
        // the passwords agree — a stray trailing space must not fail reauth
        var clean = function (p) { return String(p || '').replace(/[\u200B\u200C\u200D\uFEFF\u00AD\u2060]/g, '').trim(); };
        var cur = clean(body.querySelector('#pf_pw_cur').value);
        var nw = clean(body.querySelector('#pf_pw_new').value);
        var conf = clean(body.querySelector('#pf_pw_conf').value);
        if (!cur) { note.textContent = 'Enter your current password.'; return; }
        if (!nw || nw.length < 6) { note.textContent = 'New password must be at least 6 characters.'; return; }
        if (nw !== conf) { note.textContent = 'New passwords do not match.'; return; }
        if (!window.FB || !FB.changePassword) { note.textContent = 'Password change is unavailable right now.'; return; }
        pwBtn.disabled = true; note.textContent = 'Changing…';
        function ok() {
          pwBtn.disabled = false;
          note.textContent = '✓ Password changed.';
          body.querySelector('#pf_pw_cur').value = '';
          body.querySelector('#pf_pw_new').value = '';
          body.querySelector('#pf_pw_conf').value = '';
        }
        function fail(e) {
          pwBtn.disabled = false;
          /* v45: plain English only — never show the raw Firebase message */
          var code = (e && e.code) || '';
          note.textContent = (code === 'auth/wrong-password' || code === 'auth/invalid-credential')
            ? 'Current password is wrong.'
            : code === 'auth/weak-password' ? 'New password is too weak — use at least 6 characters.'
            : code === 'auth/requires-recent-login' ? 'For security, sign out and sign back in, then change your password right after signing in.'
            : code === 'auth/too-many-requests' ? 'Too many tries. Wait about 10 minutes and try again.'
            : code === 'auth/network-request-failed' ? 'Could not reach the server. Check your internet and try again.'
            : 'Could not change password. Please try again.';
        }
        FB.changePassword(nw).then(ok).catch(function (e) {
          if (e && e.code === 'auth/requires-recent-login') {
            note.textContent = 'Confirming it is you…';
            FB.reauthenticate(cur).then(function () { return FB.changePassword(nw); }).then(ok).catch(fail);
          } else fail(e);
        });
      };
      /* v438: DELETE flow wiring (both renders — the card exists
         signed in and out; only the signed-in one asks a password
         and touches the cloud). The gate is deliberate: password +
         typed DELETE arm the final confirm, and only the final
         "Yes, delete everything" runs anything destructive. */
      var delBtn = body.querySelector('#pf_del_btn');
      if (delBtn) {
        var dStep1 = body.querySelector('#pf_del_step1');
        var dStep2 = body.querySelector('#pf_del_step2');
        var dNote = body.querySelector('#pf_del_note');
        var dNote2 = body.querySelector('#pf_del_note2');
        var dClean = function (p) { return String(p || '').replace(/[\u200B\u200C\u200D\uFEFF\u00AD\u2060]/g, '').trim(); };
        delBtn.onclick = function () {
          if (dClean(body.querySelector('#pf_del_type').value) !== 'DELETE') {
            dNote.textContent = 'Type DELETE (all capitals) to confirm.';
            return;
          }
          if (signedIn && !dClean(body.querySelector('#pf_del_pw').value)) {
            dNote.textContent = 'Enter your password.';
            return;
          }
          dNote.textContent = '';
          dStep1.style.display = 'none';
          dStep2.style.display = '';
        };
        body.querySelector('#pf_del_no').onclick = function () {
          dStep2.style.display = 'none';
          dStep1.style.display = '';
          dNote2.textContent = '';
        };
        body.querySelector('#pf_del_yes').onclick = function () {
          var yesBtn = body.querySelector('#pf_del_yes');
          var noBtn = body.querySelector('#pf_del_no');
          yesBtn.disabled = true; noBtn.disabled = true;
          dNote2.textContent = 'Deleting…';
          function fail(msg) {
            yesBtn.disabled = false; noBtn.disabled = false;
            dNote2.textContent = msg;
          }
          function wipeLocalAndReload() {
            try {
              var keys = [];
              for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf('mt_') === 0) keys.push(k);
              }
              for (var j = 0; j < keys.length; j++) localStorage.removeItem(keys[j]);
            } catch (e) {}
            try { location.reload(); } catch (e) {}
          }
          if (!signedIn) { wipeLocalAndReload(); return; }
          if (!window.FB || !FB.reauthenticate || !FB.deleteOwnData || !FB.deleteAuthAccount) {
            fail('Account deletion is unavailable right now. Please try again later, or email meticuloustech1@gmail.com and we will delete it for you.');
            return;
          }
          var stage = 'reauth';
          FB.reauthenticate(dClean(body.querySelector('#pf_del_pw').value))
            .then(function () {
              stage = 'data';
              /* stop the sync engine for this account first — its
                 own session-end call, the same one sign-out makes —
                 so no queued flush can re-push the account's local
                 copy into the tree while it is being deleted */
              try { if (window.CloudSync && CloudSync.onAuth) CloudSync.onAuth(null); } catch (e) {}
              return FB.deleteOwnData();
            })
            .then(function () {
              /* the cloud is gone: wipe this device BEFORE the auth
                 delete, so no queued sync can re-push the account's
                 local copy into the tree we just deleted */
              stage = 'auth';
              try {
                var keys = [];
                for (var i = 0; i < localStorage.length; i++) {
                  var k = localStorage.key(i);
                  if (k && k.indexOf('mt_') === 0) keys.push(k);
                }
                for (var j = 0; j < keys.length; j++) localStorage.removeItem(keys[j]);
              } catch (e) {}
              return FB.deleteAuthAccount();
            })
            .then(function () { try { location.reload(); } catch (e) {} })
            .catch(function (e) {
              var code = (e && e.code) || '';
              if (stage === 'reauth' && (code === 'auth/wrong-password' || code === 'auth/invalid-credential')) {
                fail('Password is wrong. Nothing was deleted.');
              } else if (stage === 'data') {
                fail('Something went wrong while deleting your data, so we stopped. You are still signed in — please try again, or email meticuloustech1@gmail.com and we will delete it for you.');
              } else if (stage === 'auth') {
                fail('Your data was deleted, but the account itself could not be closed. Please tap delete once more to finish, or email meticuloustech1@gmail.com and we will close it for you.');
              } else {
                fail('Something went wrong, so your account was not deleted. You are still signed in — please try again, or email meticuloustech1@gmail.com and we will delete it for you.');
              }
            });
        };
      }
    }
  };
})();
