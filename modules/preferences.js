/* Preferences module — edit everything from onboarding + app settings */
(function () {
  'use strict';
  var esc = function (s) { return App._esc(s); };

  Meticulous.modules.preferences = {
    render: function (body) {
      var o = App._store.get('onboarding', {});
      /* v52: person-level role (onboarding.userRole) — computed here
         because the control sits in the Account card next to Account
         type. The note states the CURRENT effective value plainly:
         when it was set automatically from the account type, it says
         so, so a wrong default is easy to spot and fix. */
      var rawRole = o.userRole;
      var effRole = (window.App && App.userRole) ? App.userRole() : 'driver';
      /* v80: the Truck card's odometer field shows the ONE master
         odometer (mt_odo) when one exists — that is the truck's
         current reading, whatever set it last. The onboarding
         baseline is only the fallback for a truck with no master
         yet. (Before v80 the field rendered the stale setup-day
         baseline while the master advanced through fuel saves, and
         Save preferences then wrote the stale number back OVER the
         master — a silent rewind on every save.) */
      var odoMaster = (window.App && App._masterOdometer) ? App._masterOdometer() : null;
      var ROLE_LABEL = { driver: 'Yes — I drive', both: 'I drive and do office work', office: 'No — office only' };
      var h = '<div class="card"><h3>👤 Account</h3>' +
        '<label class="f">Account type</label><select id="pf_acct">' +
        ['Driver', 'Owner-Operator', 'Fleet Manager'].map(function (x) { return '<option' + (o.accountType === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>' +
        '<label class="f">Do you drive a truck yourself?</label><select id="pf_role">' +
        ['driver', 'both', 'office'].map(function (x) { return '<option value="' + x + '"' + (effRole === x ? ' selected' : '') + '>' + ROLE_LABEL[x] + '</option>'; }).join('') + '</select>' +
        '<p class="note" id="pf_role_note">' +
        (rawRole
          ? 'Your answer now: <b>' + esc(ROLE_LABEL[effRole]) + '</b>. This tunes your home screen (tracker for drivers, office tools for office-only) and decides whether travel time is your income or a wage owed to a driver. It saves the moment you change it.'
          : 'Set automatically from your account type (' + esc(o.accountType || 'Driver') + ') as: <b>' + esc(ROLE_LABEL[effRole]) + '</b>. If that\u2019s wrong, change it here — it tunes your home screen and decides whether travel time is your income or a wage owed to a driver.') +
        '</p>' +
        '<label class="f">Employment</label><select id="pf_emp">' +
        ['Contract', 'Payroll'].map(function (x) { return '<option' + (o.employment === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></div>';

      /* v34: in-app password change — distinct from "Forgot password?" (the
         email reset on the sign-in screen). Signed-in users only: Firebase
         needs a current user for updatePassword, and re-authenticates with
         the current password when it demands a recent login.
         v52 placement (owner, Oct 14): the Security card renders LAST on
         the page — it is built into a variable here and appended at the
         bottom, just above the final Save preferences button. */
      var signedIn = !!(window.FB && FB.user);
      var securityCard = '<div class="card"><h3>🔒 Security</h3>';
      if (signedIn) {
        securityCard += '<p class="note">Signed in as ' + esc(FB.user.email || '') + '</p>' +
          '<label class="f">Current password</label><input id="pf_pw_cur" type="password" autocomplete="current-password">' +
          '<label class="f">New password</label><input id="pf_pw_new" type="password" autocomplete="new-password">' +
          '<label class="f">Confirm new password</label><input id="pf_pw_conf" type="password" autocomplete="new-password">' +
          '<button class="btn ghost" id="pf_pw_btn" style="margin-top:10px;">Change password</button>' +
          '<p class="note" id="pf_pw_note"></p>';
      } else {
        securityCard += '<p class="note">Sign in to change your password.</p>';
      }
      securityCard += '</div>';

      h += '<div class="card"><h3>💵 Pay</h3>' +
        '<label class="f">Payment standard</label><select id="pf_std">' +
        ['Miles', 'Hourly', 'Trip', 'Weight'].map(function (x) { return '<option' + (o.payStandard === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>' +
        '<label class="f">Rate ($)</label><input id="pf_rate" type="number" inputmode="decimal" value="' + esc(o.payRate || '') + '">' +
        '<label class="f">Travel time bonus (hours/day)</label><input id="pf_travel" type="number" inputmode="decimal" min="0" step="0.5" value="' + esc(o.travelBonus || '1') + '">' +
        '<p class="note">Fixed daily bonus added to foreman ticket hours. Asjad: 1h, some drivers: 1.5h.</p></div>';

      /* v36: tracker auto-start settings live in Revenue (the tracker
         feeds Revenue). A pointer card sat here until v52 — removed at
         the owner's ask (Oct 14): a stub that only points elsewhere
         doesn't belong in the settings list. */

      h += '<div class="card"><h3>📍 Base location</h3>' +
        '<label class="f">Where do you park your truck?</label><input id="pf_base" value="' + esc(o.baseLocation || '') + '">' +
        '<label class="f">Home province</label><select id="pf_prov">' +
        ['Alberta', 'British Columbia', 'Manitoba', 'New Brunswick', 'Newfoundland and Labrador',
         'Nova Scotia', 'Ontario', 'Prince Edward Island', 'Quebec', 'Saskatchewan',
         'Northwest Territories', 'Nunavut', 'Yukon'].map(function (p) {
          return '<option value="' + p + '"' + (o.homeProvince === p ? ' selected' : '') + '>' + p + '</option>';
        }).join('') +
        '<option value=""' + (!o.homeProvince ? ' selected' : '') + '>— not set —</option></select>' +
        '<p class="note">Sets the workers\u2019 comp name in P&L (WCB in Alberta, WSIB in Ontario, WorkSafeBC in BC, CNESST in Quebec\u2026) and its default rate.</p></div>';

      h += '<div class="card"><h3>🏢 Company</h3>' +
        '<label class="f">Company name</label><input id="pf_cname" value="' + esc(o.companyName || '') + '">' +
        '<label class="f">GST/HST number</label><input id="pf_gst" value="' + esc(o.gst || '') + '">' +
        '<label class="f">Business address</label><input id="pf_caddr" value="' + esc(o.companyAddr || '') + '">' +
        '<label class="f">Contracting company</label><input id="pf_cont" value="' + esc(o.contractingCo || '') + '">' +
        /* v79: invoice settings live with the business details — the
           user's own next invoice number (no silent counter) and the
           tax-inclusive rate switch. They save with Save preferences,
           like every other field on this card. */
        '<div style="border-top:1px solid #e3e3e3;margin-top:16px;padding-top:12px;">' +
        '<p class="note" style="margin-top:0">🧾 Invoices</p>' +
        '<label class="f">Next invoice number</label><input id="pf_nextinv" value="' + esc(o.nextInvoiceNo || '') + '" placeholder="e.g. 1152">' +
        '<label class="chk" style="display:block;margin-top:10px;"><input type="checkbox" id="pf_taxincl"' + (o.rateIncludesTax ? ' checked' : '') + '> My rate includes tax</label>' +
        '<label class="f">Tax rate %</label><input id="pf_invtax" type="number" step="0.01" min="0" value="' + esc(o.invoiceTaxRate == null || o.invoiceTaxRate === '' ? '5' : o.invoiceTaxRate) + '">' +
        '<p class="note">The next invoice uses this number. After it is saved, the number moves up by one.</p></div></div>';

      /* v31: photo retake buttons — same OCR as onboarding. Lets Asjad update
         the odometer baseline (e.g. new truck / rolled over) or the safety
         sticker (renewed) without redoing onboarding. */
      h += '<div class="card"><h3>🚛 Truck</h3>' +
        '<label class="f">Truck number</label><input id="pf_tnum" value="' + esc(o.truckNo || '') + '">' +
        '<label class="f">Load / trailer type</label><input id="pf_ttype" value="' + esc(o.truckType || '') + '">';
      /* v76 (F6, boss QA Oct 14): the odometer-baseline photo flow and
         the Daily-odometer-photos tracker toggle are DRIVER tools —
         hidden for office-only users (a man who never starts a tracker
         should not be asked for photos of an odometer he doesn't sit
         in front of). Truck number/type and the safety sticker stay:
         an office manages the fleet's trucks and inspections. */
      if (effRole !== 'office') {
        h += '<label class="f">Odometer (km)</label>' +
        '<div style="display:flex;gap:8px;margin:6px 0;">' +
        '<button type="button" class="btn secondary" id="pf_odo_cam" style="flex:1;">📷 Retake photo</button>' +
        '<button type="button" class="btn secondary" id="pf_odo_pick" style="flex:1;">📁 Choose file</button></div>' +
        '<input type="file" id="pf_odo_cam_in" accept="image/*" capture="environment" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<input type="file" id="pf_odo_in" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<div id="pf_odo_prev"></div><div id="pf_odo_status" class="note"></div>' +
        '<input id="pf_odo" type="number" inputmode="decimal" value="' + esc(odoMaster !== null ? String(odoMaster) : (o.odometerBaseline || '')) + '">' +
        /* v80: the correction door. Hidden until the typed number
           trips the gate against the master (the wiring below shows
           it live). Odometers only move up, so a lower save is
           refused — unless the user ticks this box to say the saved
           reading itself is wrong (the supervised exception that
           un-poisons a master a misread once set). v86: the gate is
           two-sided — an implausible jump past the master opens the
           same door, worded for that direction. */
        '<div id="pf_odo_fixrow" style="display:none;margin-top:6px;">' +
        '<p class="note" id="pf_odo_fixnote" style="color:#c2410c;font-weight:600"></p>' +
        '<label class="chk"><input type="checkbox" id="pf_odo_fix"> This corrects a wrong odometer reading</label></div>' +
        '<p class="note">Your truck\'s current reading — it also drives oil changes and services in Maintenance. Fuel saves and day photos move it up automatically.</p>' +
        /* v46: optional start/end-of-day odometer photos for every pay
           mode (by-mile drivers get the prompts automatically). Stored
           on onboarding.odoDailyPhotos, default OFF; read live by the
           tracker's prompt logic in app.js. */
        '<label class="chk" style="display:block;margin-top:10px;"><input type="checkbox" id="pf_odo_photos"' + (o.odoDailyPhotos ? ' checked' : '') + '> 📸 Daily odometer photos</label>' +
        '<p class="note">When on, starting and stopping the tracker offers a photo of the odometer (morning and end of day — always skippable), and the day\'s kilometres show in Revenue, like the starting-odometer column on a paper hour sheet.</p>';
      }
      h += '<label class="f">Safety sticker expiry</label>' +
        '<div style="display:flex;gap:8px;margin:6px 0;">' +
        '<button type="button" class="btn secondary" id="pf_safety_cam" style="flex:1;">📷 Retake photo</button>' +
        '<button type="button" class="btn secondary" id="pf_safety_pick" style="flex:1;">📁 Choose file</button></div>' +
        '<input type="file" id="pf_safety_cam_in" accept="image/*" capture="environment" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<input type="file" id="pf_safety_in" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<div id="pf_safety_prev"></div><div id="pf_safety_status" class="note"></div>' +
        '<input id="pf_safety" type="date" value="' + esc(o.safetyExpiry || '') + '">' +
        '<p class="note">We remind you 30 days before it expires.</p></div>';

      /* v77 (Navigator): the truck profile every truck route is costed
         with — dimensions and weights the routing engine checks against
         Calgary's truck-network rules. Defaults are a tandem dump
         truck. The fields persist the moment they change (the power-
         read pattern), never through Save preferences, and live in the
         shared 'navigator' store (MeticulousNav) the Navigator module
         reads. The routing server URL itself is plumbing — it lives
         in Advanced below, not on this card. */
      var nvSet = (window.MeticulousNav && MeticulousNav.loadSettings) ? MeticulousNav.loadSettings()
        : { profile: { height: 3.9, width: 2.6, length: 9.0, weight: 24, axleLoad: 10, axles: 3, hazmat: false }, serverUrl: '' };
      var nvp = nvSet.profile;
      h += '<div class="card"><h3>🧭 Navigator</h3>' +
        '<p class="note" style="margin-top:0">Your truck, as the Navigator sees it. Truck routes keep you legal for a truck of this size and weight.</p>' +
        '<label class="f">Height (m)</label><input id="pf_nv_height" type="number" inputmode="decimal" step="0.1" min="0" value="' + esc(nvp.height) + '">' +
        '<label class="f">Width (m)</label><input id="pf_nv_width" type="number" inputmode="decimal" step="0.1" min="0" value="' + esc(nvp.width) + '">' +
        '<label class="f">Length (m)</label><input id="pf_nv_length" type="number" inputmode="decimal" step="0.1" min="0" value="' + esc(nvp.length) + '">' +
        '<label class="f">Weight (tonnes)</label><input id="pf_nv_weight" type="number" inputmode="decimal" step="0.5" min="0" value="' + esc(nvp.weight) + '">' +
        '<label class="f">Axle load (tonnes)</label><input id="pf_nv_axleload" type="number" inputmode="decimal" step="0.5" min="0" value="' + esc(nvp.axleLoad) + '">' +
        '<label class="f">Axles</label><input id="pf_nv_axles" type="number" inputmode="numeric" step="1" min="1" value="' + esc(nvp.axles) + '">' +
        '<label class="chk" style="display:block;margin-top:10px;"><input type="checkbox" id="pf_nv_hazmat"' + (nvp.hazmat ? ' checked' : '') + '> ☣️ I haul hazardous goods (placarded)</label>' +
        '<p class="note" id="pf_nv_note">Saves as you type. The routing server address lives in Advanced → Navigator server.</p></div>';

      /* v54 (owner, Oct 14): the standalone Notifications card is gone —
         "Updates and notifications should also be in advanced features!
         These are plumbings a user doesn't click on daily." The push
         button + note now live as a row inside Advanced below (same
         pf_push / pf_pushnote ids and wiring — layout only). */

      /* v52 layout (owner, Oct 14): "Save preferences" used to sit here,
         mid-list, above a crowd of similar big navy buttons — "a user
         will press the wrong button." It now lives at the very BOTTOM of
         the page as the one solid primary button; every utility action
         (push, updates, sync, password) is a quiet ghost button, and
         Reset onboarding questions is fenced off at the bottom of
         Advanced in danger colours. Layout only — no save behaviour
         changed. */
      h += '<div class="card"><h3>⚙️ Advanced</h3>' +
        '<button class="btn ghost" id="pf_checkupd">Check for updates</button>' +
        '<p class="note" id="pf_updnote"></p>' +
        /* v54 (owner, Oct 14): Notifications row — plumbing a user
           doesn't click daily, so it lives here in Advanced, in the
           same pattern as the cloud-sync troubleshooting row below.
           (The push wiring still uses the same pf_push / pf_pushnote
           ids.) */
        '<div style="border-top:1px solid #e3e3e3;margin-top:18px;padding-top:14px;">' +
        '<p class="note" style="margin-top:0">🔔 Notifications</p>' +
        '<button class="btn ghost" id="pf_push">Enable push notifications</button>' +
        '<p class="note" id="pf_pushnote"></p></div>' +
        /* v52 (owner, Oct 14): cloud sync is not a feature card — it is a
           troubleshooting tool, so its status + retry live here in
           Advanced. (The sync status wiring below still uses the same
           pf_syncnote / pf_syncnow ids.) */
        '<div style="border-top:1px solid #e3e3e3;margin-top:18px;padding-top:14px;">' +
        '<p class="note" style="margin-top:0">☁️ Cloud sync — troubleshooting</p>' +
        '<p class="note" id="pf_syncnote">Checking…</p>' +
        '<button class="btn ghost" id="pf_syncnow">Retry sync now</button></div>' +
        /* v59 (owner, Oct 14): Power read is plumbing too — it lives
           here in Advanced, not as a feature card. The switch persists
           the moment it changes (same pattern as the role select),
           never through Save preferences.
           v94 (owner ruling, Oct 16): the key field is GONE — users
           are never asked for a key. Power read reaches Meticulous's
           cloud reader through the server; there is nothing here to
           set up, so the card carries only the switch. */
        '<div style="border-top:1px solid #e3e3e3;margin-top:18px;padding-top:14px;">' +
        '<p class="note" style="margin-top:0">⚡ Power read — cloud help for hard photos</p>' +
        '<p class="note">When a photo is too hard for the built-in reader, Power read sends just that photo to Meticulous\'s cloud reader for a second look. Nothing to set up — and the answer always waits for your check.</p>' +
        '<label class="chk"><input type="checkbox" id="pf_pr_on"> Power read on</label>' +
        '<p class="note" id="pf_pr_note"></p></div>' +
        /* v63 (native v34): Background tracking status — plumbing like
           the rows above, not a feature card. On the new Android shell
           it reports, in plain words, whether miles keep counting with
           the app closed ("Allow all the time" location) and whether
           battery saver can stop the tracker mid-shift, with one-tap
           fixes. On any other build it says so in one quiet line.
           Status is READ live at render; nothing nags anywhere else. */
        '<div style="border-top:1px solid #e3e3e3;margin-top:18px;padding-top:14px;">' +
        '<p class="note" style="margin-top:0">🛰️ Background tracking</p>' +
        '<p class="note" id="pf_bgtrack">Checking…</p>' +
        '<button class="btn ghost hidden" id="pf_bgallow">Allow location all the time</button>' +
        '<button class="btn ghost hidden" id="pf_bgbatt">Open battery settings</button></div>' +
        /* v74 (owner, Oct 14): Park-place nudges — plumbing like the
           rows above. The app learns where the truck sleeps (from
           shift starts/ends) and ASKS once each way: "Start your
           shift?" in the morning, "Close your day?" in the evening.
           It never starts or stops anything by itself. Status +
           manual set/forget live here; the asks themselves appear
           as a card under the tracker (and as real notifications
           on the Android app when allowed). */
        '<div style="border-top:1px solid #e3e3e3;margin-top:18px;padding-top:14px;">' +
        '<p class="note" style="margin-top:0">📍 Park-place nudges</p>' +
        '<p class="note" id="pf_parknote">Checking…</p>' +
        '<button class="btn ghost" id="pf_parkset">📍 Set where I park (use my location now)</button>' +
        '<button class="btn ghost hidden" id="pf_parknn">Allow notifications</button>' +
        '<button class="btn ghost hidden" id="pf_parkforget">Forget this place</button></div>' +
        /* v77 (Navigator): the routing server URL is plumbing — a user
           sets it once (or never) — so it lives here in Advanced, not
           on the Navigator card. Empty means the Navigator honestly
           reports routing unavailable; the app ships with NO server
           address built in. Persists the moment it changes. */
        '<div style="border-top:1px solid #e3e3e3;margin-top:18px;padding-top:14px;">' +
        '<p class="note" style="margin-top:0">🧭 Navigator server</p>' +
        '<p class="note">Where the Navigator gets its truck routes. Your truck\'s size and weight are set on the Navigator card above.</p>' +
        '<label class="f">Server address</label>' +
        '<input id="pf_nav_url" type="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://your-routing-server.example">' +
        '<p class="note" id="pf_nav_note"></p></div>' +
        '<div style="border-top:1px solid #e3e3e3;margin-top:18px;padding-top:14px;">' +
        '<button class="btn ghost" id="pf_resetonb" style="color:#c0392b;border:1px solid #c0392b;">Reset onboarding questions</button>' +
        '<p class="note">Shows the setup questions again on next sign-in. Your saved answers stay until you finish the questions again.</p></div></div>';
      /* v32: cloud-sync diagnostics used to be their own card here;
         v52 moved them into Advanced as a troubleshooting row (owner:
         "you only need this as a troubleshooting tool"). The status +
         retry wiring below is unchanged and works on the same ids. */
      // v24: removed "Erase all local data" — developer tool, not for users

      /* v52 (owner, Oct 14): the Security / change-password card is the
         LAST card on the page (built as `securityCard` up top), and the
         role control lives in the Account card next to Account type —
         an earlier end-of-list placement for the role question was a
         misread and was withdrawn. */
      h += securityCard;

      /* v52: THE button — one solid primary, full width, at the very
         bottom of the page, under the last card. */
      h += '<button class="btn primary big" id="pf_save" style="margin-top:2px;">Save preferences</button>';

      body.innerHTML = h;
      body.querySelector('#pf_save').onclick = function () {
        var g = function (id) { return body.querySelector('#' + id).value.trim(); };
        o.accountType = g('pf_acct'); o.employment = g('pf_emp'); o.payStandard = g('pf_std');
        o.payRate = g('pf_rate'); o.travelBonus = g('pf_travel') || '1';
        o.baseLocation = g('pf_base'); o.homeProvince = body.querySelector('#pf_prov').value; o.companyName = g('pf_cname');
        o.gst = g('pf_gst'); o.companyAddr = g('pf_caddr'); o.contractingCo = g('pf_cont');
        o.nextInvoiceNo = g('pf_nextinv');
        o.rateIncludesTax = body.querySelector('#pf_taxincl').checked;
        o.invoiceTaxRate = g('pf_invtax') || '5';
        o.truckNo = g('pf_tnum'); o.truckType = g('pf_ttype');
        /* v76 (F6): office renders have no odometer field/toggle —
           keep whatever is stored, never reach for missing inputs. */
        if (body.querySelector('#pf_odo')) o.odometerBaseline = g('pf_odo');
        o.safetyExpiry = g('pf_safety');
        var odoTglSave = body.querySelector('#pf_odo_photos');
        o.odoDailyPhotos = odoTglSave ? odoTglSave.checked : !!o.odoDailyPhotos; // v46
        /* v80: the master odometer moves through the SUPERVISED
           decision (App._odoSaveDecision), never by blindly copying
           the field: at-or-above the master sets it; below it applies
           ONLY with the correction box ticked; unarmed-and-lower
           keeps the master, restores the stored baseline to the
           master (so the refused number can't ride the next save),
           and the outcome is said out loud in the saved message.
           (The v28 direct copy this replaces rewound the master to
           the setup-day baseline on every save.) */
        var odoNote = '';
        try {
          var masterNow = (window.App && App._masterOdometer) ? App._masterOdometer() : null;
          var fixEl = body.querySelector('#pf_odo_fix');
          /* office renders have no odometer field — the decision
             (and its note) belongs only to a save that carried one. */
          var dec = (!body.querySelector('#pf_odo') || !(window.App && App._odoSaveDecision))
            ? { action: 'ignore', value: masterNow }
            : App._odoSaveDecision(o.odometerBaseline, masterNow, !!(fixEl && fixEl.checked));
          if (dec.action === 'set' || dec.action === 'correct') {
            App._store.set('mt_odo', String(dec.value));
            o.odometerBaseline = String(dec.value);
            if (dec.action === 'correct') odoNote = ' Odometer corrected to ' + Number(dec.value).toLocaleString('en-CA') + ' km.';
          } else if (dec.action === 'keep') {
            /* v86: the refusal words match the direction — a value
               way PAST the master (the two-sided gate's jump side)
               is refused for the opposite reason than a lower one. */
            var typedWhy = (window.App && App._odoImplausible && o.odometerBaseline !== String(dec.value))
              ? App._odoImplausible(o.odometerBaseline) : null;
            o.odometerBaseline = String(dec.value);
            odoNote = typedWhy === 'jump'
              ? ' Odometer kept at ' + Number(dec.value).toLocaleString('en-CA') + ' km — the number in the box was way past it, and a reading that far ahead is almost certainly another number (a receipt\'s invoice number, say). If the saved reading itself is wrong, type the true one, tick “This corrects a wrong odometer reading”, and save again.'
              : ' Odometer kept at ' + Number(dec.value).toLocaleString('en-CA') + ' km — the number in the box was lower, and odometers only move up. If the saved reading itself is wrong, type the true one, tick “This corrects a wrong odometer reading”, and save again.';
          }
          if (o.safetyExpiry) App._store.set('mt_annualDate', o.safetyExpiry);
        } catch (e) {}
        App._store.set('onboarding', o);
        App.onAuth(App.user);
        try { if (App.checkAutoStart) App.checkAutoStart(); } catch (e) {}
        alert('Preferences saved.' + odoNote);
      };
      /* v80: show the correction door live — only while the typed
         odometer trips the gate against the master it would have
         to correct. v86: the gate is two-sided, so the door also
         opens for an implausible JUMP past the master, worded for
         that direction. */
      (function () {
        var odoEl = body.querySelector('#pf_odo');
        var row = body.querySelector('#pf_odo_fixrow');
        var note = body.querySelector('#pf_odo_fixnote');
        if (!odoEl || !row || odoMaster === null) return;
        function paintFix() {
          var v = parseFloat(odoEl.value);
          var why = (v > 0 && window.App && App._odoImplausible) ? App._odoImplausible(v) : null;
          if (why === 'jump') {
            row.style.display = '';
            if (note) note.textContent = 'That\'s way past the odometer now (' + Number(odoMaster).toLocaleString('en-CA') + ' km) — a truck can\'t gain that much between readings, so it\'s likely another number (a receipt\'s invoice number, say). Saving keeps ' + Number(odoMaster).toLocaleString('en-CA') + ' km unless you tick the box to say the saved reading is wrong.';
          } else if (why === 'below') {
            row.style.display = '';
            if (note) note.textContent = 'That\'s lower than the odometer now (' + Number(odoMaster).toLocaleString('en-CA') + ' km). Odometers only move up — saving keeps ' + Number(odoMaster).toLocaleString('en-CA') + ' km unless you tick the box to say the saved reading is wrong.';
          } else {
            row.style.display = 'none';
          }
        }
        odoEl.addEventListener('input', paintFix);
        paintFix();
      })();
      /* v31: wire the odometer/safety photo retake buttons to the same OCR
         used in onboarding. Persists immediately to the stored onboarding
         and to the Maintenance PM stores. */
      try {
        if (App._wirePhotoOCR) {
          var prefsPersistPhoto = function (kind, v) {
            try {
              var ob = App._store.get('onboarding', {}) || {};
              if (kind === 'odometer') {
                /* v80: a photo read updates the FIELD's stored
                   draft (the baseline) only — the master odometer
                   moves at Save preferences through the supervised
                   decision, never on a raw read. (Before v80 this
                   wrote mt_odo directly — even DOWNWARD, since it
                   bypassed the upward-only bump.) */
                ob.odometerBaseline = v;
              } else {
                ob.safetyExpiry = v;
                if (v) App._store.set('mt_annualDate', v);
              }
              App._store.set('onboarding', ob);
            } catch (e) {}
          };
          App._wirePhotoOCR('pf_odo', 'odometer', prefsPersistPhoto);
          App._wirePhotoOCR('pf_safety', 'safety', prefsPersistPhoto);
        }
      } catch (e) {}
      /* v59: a queued power read of an earlier dash photo may have
         finished — offer it in the odometer status line as a tap-to-use
         button. The button fills the field and persists through the
         SAME prefsPersistPhoto path as a local read; until it is
         tapped, nothing is written (peek, not take). */
      try {
        if (window.PowerRead && PowerRead.peekResult) {
          var prOdo = PowerRead.peekResult('odometer');
          if (prOdo && prOdo.fields && prOdo.fields.value) {
            var prSt = body.querySelector('#pf_odo_status');
            /* v80: a queued value is still a machine candidate —
               if it is impossible against the master, say so in
               plain words instead of offering a Use button. */
            var prWhy = (window.App && App._odoImplausible) ? App._odoImplausible(prOdo.fields.value) : null;
            if (prSt && prWhy) {
              prSt.innerHTML = '⚡ A power read from your earlier dash photo got <b>' + Number(prOdo.fields.value).toLocaleString('en-CA') + ' km</b> — that can\'t be right against your current odometer' + (odoMaster !== null ? ' (' + Number(odoMaster).toLocaleString('en-CA') + ' km)' : '') + ', so it wasn\'t kept.';
              try { PowerRead.takeResult('odometer'); } catch (e) {}
            } else if (prSt) {
              prSt.innerHTML = '⚡ <b>Power read — check before using:</b> from your earlier dash photo: ';
              var prBtn = document.createElement('button');
              prBtn.type = 'button';
              prBtn.className = 'btn small';
              prBtn.textContent = 'Use ' + Number(prOdo.fields.value).toLocaleString('en-CA') + ' km';
              prBtn.onclick = function () {
                var inp = body.querySelector('#pf_odo');
                if (inp) inp.value = prOdo.fields.value;
                try { PowerRead.takeResult('odometer'); } catch (e) {}
                /* v80: the tap fills the field + the stored draft —
                   the master moves at Save preferences (supervised),
                   not on this tap. */
                try {
                  var ob = App._store.get('onboarding', {}) || {};
                  ob.odometerBaseline = prOdo.fields.value;
                  App._store.set('onboarding', ob);
                } catch (e) {}
                prSt.innerHTML = '⚡ Power read: <b>' + Number(prOdo.fields.value).toLocaleString('en-CA') + ' km</b> is in the field — tap Save preferences to keep it.';
              };
              prSt.appendChild(prBtn);
            }
          }
        }
      } catch (e) {}
      /* v52: the role select also persists the moment it changes (same
         pattern as the toggle below), and re-runs App.onAuth so the
         sidebar + dashboard re-tune immediately. It also keeps the
         render-closure `o` in sync, so a later "Save preferences" can
         never write a stale role back over the user's pick. */
      try {
        var roleSel = body.querySelector('#pf_role');
        if (roleSel) roleSel.onchange = function () {
          o.userRole = roleSel.value;
          App._store.set('onboarding', o);
          var rn = body.querySelector('#pf_role_note');
          if (rn) rn.innerHTML = 'Your answer now: <b>' + esc(ROLE_LABEL[roleSel.value]) + '</b>. Changing it re-tunes your home screen right away.';
          App.onAuth(App.user);
        };
      } catch (e) {}
      /* v46: the Daily-odometer-photos toggle also persists the moment
         it changes (like the photo retakes above), so it takes effect
         even if the user leaves without pressing "Save preferences".
         The Save handler reads the same checkbox, so the two agree. */
      try {
        var odoTgl = body.querySelector('#pf_odo_photos');
        if (odoTgl) odoTgl.onchange = function () {
          var ob = App._store.get('onboarding', {}) || {};
          ob.odoDailyPhotos = odoTgl.checked;
          App._store.set('onboarding', ob);
        };
      } catch (e) {}
      /* v34: change-password handler (Security card, signed-in only) */
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
      body.querySelector('#pf_push').onclick = function () {
        if (window.FB && FB.enablePush) {
          FB.enablePush().then(function (r) {
            body.querySelector('#pf_pushnote').textContent = r.ok ? '✓ Push enabled for this device.' : 'Could not enable: ' + (r.reason || 'unknown');
          });
        } else body.querySelector('#pf_pushnote').textContent = 'Push unavailable in this browser.';
      };
      /* v28: reset onboarding — shows the setup questions again on next sign-in.
         Deletes the flag locally and in the cloud (tombstone via store.del). */
      body.querySelector('#pf_resetonb').onclick = function () {
        if (!confirm('Show the setup questions again on your next sign-in? Your saved answers stay until you finish the questions again.')) return;
        try { App._store.del('onboarded'); } catch (e) {}
        alert('Done — the setup questions will show on your next sign-in.');
      };
      /* v30 OTA: manual update check. Web updates download in-app; only
         native changes need a fresh APK (announced by the banner in app.js). */
      body.querySelector('#pf_checkupd').onclick = function () {
        var note = body.querySelector('#pf_updnote');
        note.textContent = 'Checking…';
        if (!window.OTA || !OTA.checkNow) { note.textContent = 'Update check is only available in the installed app.'; return; }
        OTA.checkNow().then(function (r) {
          /* v35: a completed healthy check clears any stored OTA damage
             notice; a failure reason keeps it visible. */
          if (r.updated || !r.reason) { try { localStorage.removeItem('ota_notice'); } catch (e) {} }
          if (r.updated) {
            note.textContent = 'Update v' + r.version + ' downloaded.';
            if (confirm('Update v' + r.version + ' is ready. Restart the app now to use it?')) OTA.restart();
          } else if (r.reason) {
            note.textContent = r.reason;
          } else {
            note.textContent = 'You are up to date (web v' + r.version + ').';
          }
        });
      };
      try {
        if (window.OTA && OTA.currentVersion) OTA.currentVersion().then(function (v) {
          var n = body.querySelector('#pf_updnote');
          if (!n) return;
          /* v35: surface a stored OTA damage/repair notice (set by the
             updater's launch self-check) instead of the version line. */
          var notice = null;
          try { notice = localStorage.getItem('ota_notice'); } catch (e) {}
          if (notice) { n.textContent = '⚠️ ' + notice; return; }
          if (!n.textContent) n.textContent = 'App web version: v' + v.active + (v.inOtaCopy ? ' (updated copy)' : ' (installed copy)');
        });
      } catch (e) {}
      /* v32: cloud-sync status + manual retry */
      (function () {
        var note = body.querySelector('#pf_syncnote');
        var btn = body.querySelector('#pf_syncnow');
        if (!note || !btn) return;
        function paint() {
          try {
            if (!window.CloudSync) { note.textContent = 'Sync engine not loaded.'; return; }
            var st = CloudSync.status();
            var word = st.dot === 'ok' ? 'Backed up ✓'
              : st.dot === 'syncing' ? 'Syncing…'
              : st.dot === 'err' ? 'Error' : 'Off (not signed in)';
            var t = 'Status: ' + word;
            if (st.lastError) t += ' — ' + String(st.lastError).slice(0, 140);
            if (st.dirtyKeys && st.dirtyKeys.length) t += ' — ' + st.dirtyKeys.length + ' change(s) waiting to upload.';
            note.textContent = t;
          } catch (e) { note.textContent = 'Could not read sync status.'; }
        }
        paint();
        btn.onclick = function () {
          note.textContent = 'Sync requested — watch the top-bar dot…';
          try { if (window.CloudSync && CloudSync.syncNow) CloudSync.syncNow(); } catch (e) {}
          setTimeout(paint, 4000);
        };
      })();
      /* v59: the power-read switch persists on change (never via
         Save preferences); the note shows the month's read count.
         v94: no key control exists here anymore (owner ruling,
         Oct 16) — nothing on this card reads, writes, or mentions
         a key. A key saved on the device before v94 stays where it
         is and PowerRead still uses it silently. */
      (function () {
        var onEl = body.querySelector('#pf_pr_on');
        var note = body.querySelector('#pf_pr_note');
        if (!note) return;
        function paint(extra) {
          if (!window.PowerRead) { note.textContent = 'Power read is not loaded in this version.'; return; }
          var bits = [];
          bits.push('Power reads this month: ' + PowerRead.monthCount() + '.');
          var q = 0;
          try { q = PowerRead.queueLength(); } catch (e) {}
          if (q) bits.push(q + ' power read' + (q === 1 ? '' : 's') + ' waiting for signal.');
          if (extra) bits.push(extra);
          note.textContent = bits.join(' ');
        }
        if (window.PowerRead) {
          if (onEl) onEl.checked = PowerRead.isOn();
        }
        if (onEl) onEl.onchange = function () {
          if (window.PowerRead) PowerRead.setOn(!!onEl.checked);
          paint(onEl.checked ? 'Power read is on.' : 'Power read is off — hard photos get the built-in reader only.');
        };
        paint();
      })();
      /* v63: background-tracking status (native v34 shell). Reads the
         live plugin status at render and re-reads after a fix tap.
         Inert everywhere else — one honest line, no dead buttons. */
      (function () {
        var note = body.querySelector('#pf_bgtrack');
        if (!note) return;
        var allowBtn = body.querySelector('#pf_bgallow');
        var battBtn = body.querySelector('#pf_bgbatt');
        function show(btn, on) { if (btn) btn.classList.toggle('hidden', !on); }
        function paint() {
          var ST = window.ShiftTrack;
          if (!ST || !ST.available()) {
            note.textContent = 'Not in this build — miles count only while the app is open. The newest Android app counts in the background.';
            show(allowBtn, false); show(battBtn, false);
            return;
          }
          ST.status(true).then(function (s) {
            if (!s) { note.textContent = 'Could not read tracking status.'; return; }
            var lines = [];
            if (!s.fineLocation) {
              lines.push('Location is off for Meticulous — miles can\'t be counted. Turn it on, then allow it below.');
            } else if (s.backgroundLocation) {
              lines.push('Background location: allowed — miles keep counting with the app closed. ✓');
            } else {
              lines.push('Background location: not allowed — counting stops when the app closes.');
            }
            lines.push(s.batteryExempt
              ? 'Battery: unrestricted — saver can\'t stop tracking mid-shift. ✓'
              : 'Battery: saver can stop tracking mid-shift — set Meticulous battery to “Unrestricted”.');
            if (s.sessionActive) lines.push('Right now: a shift is being tracked in the background.');
            /* v92: the armed day, in plain words — counting that
               starts by itself, before the app is ever opened. */
            if (s.armStarted && s.sessionActive) {
              lines.push('Today\'s counting started by itself.');
            } else if (s.armed && s.armFireMs) {
              var armWhen = new Date(s.armFireMs).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
              var armDay = new Date(s.armFireMs).toDateString() === new Date().toDateString() ? 'today' : 'tomorrow';
              lines.push('Next shift: counting starts by itself ' + armDay + ' at ' + armWhen + '.');
            }
            note.textContent = lines.join(' ');
            show(allowBtn, !s.backgroundLocation);
            show(battBtn, !s.batteryExempt);
          }).catch(function () { note.textContent = 'Could not read tracking status.'; });
        }
        if (allowBtn) allowBtn.onclick = function () {
          var ST = window.ShiftTrack;
          if (!ST) return;
          ST.requestBackground().then(function () { setTimeout(paint, 600); });
        };
        if (battBtn) battBtn.onclick = function () {
          var ST = window.ShiftTrack;
          if (ST) ST.openBatterySettings();
          setTimeout(paint, 1500);
        };
        paint();
      })();
      /* v74: park-place nudges status + manual set/forget + the
         notifications permission (js/parkplace.js). Reads live state
         at render; learning a place repaints via onPlaceChange. */
      (function () {
        var note = body.querySelector('#pf_parknote');
        if (!note) return;
        var setBtn = body.querySelector('#pf_parkset');
        var nnBtn = body.querySelector('#pf_parknn');
        var forgetBtn = body.querySelector('#pf_parkforget');
        function show(btn, on) { if (btn) btn.classList.toggle('hidden', !on); }
        function paint() {
          var PP = window.ParkPlace;
          if (!PP) {
            note.textContent = 'Park-place nudges are not in this build.';
            show(setBtn, false); show(nnBtn, false); show(forgetBtn, false);
            return;
          }
          var info = PP.info();
          var lines = [];
          if (info.place) {
            lines.push('Park place: set (' + info.place.lat.toFixed(4) + ', ' + info.place.lng.toFixed(4) + ') — ' +
              (info.place.source === 'manual' ? 'you set it.' : 'learned from your shifts.'));
          } else {
            lines.push('No park place yet — the app learns it from a few shifts, or set it now while you\'re parked there.');
          }
          lines.push('Asks at most twice a day — “Start your shift?” in the morning, “Close your day?” in the evening — and never starts or stops anything by itself.');
          if (!info.notificationsAvailable) {
            lines.push('Notifications aren\'t in this build — the asks show as a card in the app.');
            show(nnBtn, false);
          } else if (info.notificationsGranted) {
            lines.push('Notifications: allowed ✓.');
            show(nnBtn, false);
          } else if (info.notificationsGranted === false) {
            lines.push('Notifications: not allowed — the asks show as a card in the app instead.');
            show(nnBtn, true);
          } else {
            lines.push('Notifications: checking…');
            show(nnBtn, false);
            PP.refreshNotifications().then(function () { paint(); }).catch(function () {});
          }
          note.textContent = lines.join(' ');
          show(forgetBtn, !!info.place);
        }
        if (setBtn) setBtn.onclick = function () {
          var PP = window.ParkPlace;
          if (!PP) return;
          note.textContent = 'Getting your location…';
          PP.setPlaceHere().then(function () { paint(); }).catch(function () {
            note.textContent = 'Could not get your location. Location may be off for Meticulous, or this build has no location. Nothing was set.';
          });
        };
        if (nnBtn) nnBtn.onclick = function () {
          var PP = window.ParkPlace;
          if (!PP) return;
          PP.requestNotifications().then(function () { setTimeout(paint, 400); });
        };
        if (forgetBtn) forgetBtn.onclick = function () {
          var PP = window.ParkPlace;
          if (PP) PP.forgetPlace();
          paint();
        };
        try { if (window.ParkPlace) ParkPlace.onPlaceChange(paint); } catch (e) {}
        paint();
      })();
      /* v77: Navigator profile + server URL — persist the moment they
         change (the power-read pattern), through the shared
         MeticulousNav store helpers the Navigator module reads. If the
         module failed to load, fall back to the same 'navigator' store
         key directly so the settings are never lost. */
      (function () {
        function navLoad() {
          if (window.MeticulousNav && MeticulousNav.loadSettings) return MeticulousNav.loadSettings();
          var s = {}; try { s = App._store.get('navigator', {}) || {}; } catch (e) {}
          return { profile: s.profile || {}, serverUrl: String(s.serverUrl || '') };
        }
        function navSave(patch) {
          if (window.MeticulousNav && MeticulousNav.saveSettings) { MeticulousNav.saveSettings(patch); return; }
          var s = {}; try { s = App._store.get('navigator', {}) || {}; } catch (e) {}
          for (var k in patch) s[k] = patch[k];
          try { App._store.set('navigator', s); } catch (e) {}
        }
        var urlEl = body.querySelector('#pf_nav_url');
        var urlNote = body.querySelector('#pf_nav_note');
        if (urlEl) {
          urlEl.value = navLoad().serverUrl || '';
          if (urlNote) urlNote.textContent = urlEl.value
            ? 'Server set — the Navigator routes through it.'
            : 'No server set — the Navigator will say routing is unavailable.';
          urlEl.onchange = function () {
            var v = urlEl.value.trim();
            navSave({ serverUrl: v });
            if (urlNote) urlNote.textContent = v
              ? '✓ Saved — the Navigator routes through this server.'
              : 'Cleared — the Navigator will say routing is unavailable.';
          };
        }
        var profIds = { height: 'pf_nv_height', width: 'pf_nv_width', length: 'pf_nv_length', weight: 'pf_nv_weight', axleLoad: 'pf_nv_axleload', axles: 'pf_nv_axles' };
        var nvNote = body.querySelector('#pf_nv_note');
        function saveProfile() {
          var cur = navLoad().profile || {};
          var p = {}, k, el;
          for (k in profIds) {
            el = body.querySelector('#' + profIds[k]);
            if (el && el.value !== '') p[k] = Number(el.value);
            else if (cur[k] !== undefined) p[k] = cur[k];
          }
          var hz = body.querySelector('#pf_nv_hazmat');
          p.hazmat = hz ? !!hz.checked : !!cur.hazmat;
          navSave({ profile: p });
          if (nvNote) nvNote.textContent = '✓ Truck profile saved — the Navigator routes for this truck.';
        }
        Object.keys(profIds).forEach(function (k) {
          var el = body.querySelector('#' + profIds[k]);
          if (el) el.onchange = saveProfile;
        });
        var hzEl = body.querySelector('#pf_nv_hazmat');
        if (hzEl) hzEl.onchange = saveProfile;
      })();
      // v24: pf_wipe handler removed (button removed above)
    }
  };
})();
