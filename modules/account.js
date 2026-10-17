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
   browsing of that page, which the password fields used to shield. */
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
    }
  };
})();
