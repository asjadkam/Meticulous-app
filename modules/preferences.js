/* Preferences module — edit everything from onboarding + app settings */
(function () {
  'use strict';
  var esc = function (s) { return App._esc(s); };

  /* v116: the "Where I park" card (Settings view, rendered below)
     paints through here. Preferences rebuilds its DOM on every
     render, so the paint re-queries the live document and quietly
     does nothing while Preferences is closed; the place-change
     listener registers once for the page's lifetime. The words
     and behavior are the v74/v107 card's, unchanged — only the
     home moved (dashboard in v112–v115, Preferences again now,
     at the owner's order). */
  var _parkListenerOn = false;
  var pfBackHook = null; // v116: installed by each render's tab wiring; api.back delegates to it
  /* v118: the safety-sticker expiry lives in TWO stores —
     onboarding.safetyExpiry (the form's field) and mt_annualDate
     (Maintenance / reminders / the manifest read it there). The
     old one-way mirror (form → mt_annualDate on every Preferences
     save) let a STALE form value stomp a newer date set anywhere
     else: the owner's 2027-05-31, set and verified Oct 16 19:44,
     reverted to 2027-05-01 when a later Preferences save copied
     the form's older value over it. The rule now: a form value
     the user did not touch in this visit NEVER overwrites a
     different stored annualDate — the stored one is adopted
     into the form's record instead. A value actually edited
     here still wins, always. */
  var pfSafetyRendered = null;
  function pfSafetyWinner(formVal, renderedVal, annualNow) {
    formVal = String(formVal || '');
    if (annualNow && formVal === String(renderedVal || '') && String(annualNow) !== formVal) return String(annualNow);
    return formVal;
  }
  function paintParkCard() {
    var doc = (typeof document !== 'undefined') ? document : null;
    if (!doc || !doc.getElementById) return;
    var note = doc.getElementById('pf_park_note');
    if (!note) return;
    var setBtn = doc.getElementById('pf_park_set'), nnBtn = doc.getElementById('pf_park_nn'), forgetBtn = doc.getElementById('pf_park_forget');
    function show(btn, on) { if (btn) btn.classList.toggle('hidden', !on); }
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
      PP.refreshNotifications().then(function () { paintParkCard(); }).catch(function () {});
    }
    note.textContent = lines.join(' ');
    show(forgetBtn, !!info.place);
  }

  Meticulous.modules.preferences = {
    /* v116: shell back contract — the Advanced TAB is this
       screen's sub-view: Back from Advanced returns to Settings
       (via the hook the tab wiring installs at render) instead of
       leaving Preferences. Fresh entry needs no resetView: every
       render starts on Settings. */
    back: function () {
      try { return !!(pfBackHook && pfBackHook()); } catch (e) { return false; }
    },
    render: function (body) {
      var o = App._store.get('onboarding', {});
      pfSafetyRendered = o.safetyExpiry || ''; // v118: what the safety field opened with (see pfSafetyWinner)
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
      var econU = (window.App && App._econUnit) ? App._econUnit() : 'kpl'; // v127: the economy-unit preference
      var ROLE_LABEL = { driver: 'Yes — I drive', both: 'I drive and do office work', office: 'No — office only' };
      /* v107 (Stage 6, owner Oct 16 19:39-19:43): Advanced is a
         TAB at the top of Preferences — its own swapped view, never
         an expanding drawer in the scroll. Settings is the default
         view and owns the Save button; Advanced holds plumbing
         only (updates, notifications, sync retry, reset) and its
         controls persist as they change.
         v137 (owner, Oct 17 12:25): "Power read and navigator
         Server are plumbing! Don't need to be there!" — the Power
         Read switch and the Navigator server text box are GONE
         from Advanced entirely (see the Advanced build below):
         both machines run in the background with baked values,
         and no user-facing surface edits either. */
      var h = '<div class="card" style="padding:10px 12px;"><div class="row" style="gap:6px;margin:0;">' +
        '<button type="button" class="btn navy" id="pf_tab_settings" style="flex:1;">Settings</button>' +
        '<button type="button" class="btn ghost" id="pf_tab_advanced" style="flex:1;">⚙️ Advanced</button></div></div>' +
        '<div id="pf_view_settings">' +
        '<div class="card"><h3>👤 Account</h3>' +
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
        ['Contract', 'Payroll'].map(function (x) { return '<option' + (o.employment === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>' +
        /* v149: the truth about this card, stated where the user
           stands — the three selects above persist on change (the
           wiring sits with the role select's below). */
        '<p class="note" id="pf_acct_note">Account type, the driving answer and Employment save the moment you change them — your screens and your Connect listing update right away. No need to close the app.</p></div>';

      /* v106 (owner directive, Oct 16, 2026 19:49 MDT): "Give login its
         own page!" The Security card (v34 change-password + the v95
         sign-in door) is GONE from Preferences — it lives on the
         dedicated Account & login screen (modules/account.js), same
         ids, same wiring. This page now carries NO password inputs,
         which also unblocks assisted browsing of Preferences. */

      /* v137 (owner, Oct 17 12:22 MDT): "This shouldn't say my
         rate... Under pnl each driver gets their own rate!" There
         is NO universal rate field in Preferences anymore: crew
         pay rates live in each driver's P&L entry (the v132 pipe
         prices wages from pnl_drivers — the single source). What
         renders here is only the signed-in user's OWN money
         identity, framed as theirs: an owner-operator's two rates
         (what he bills, what he pays himself), a driver's one pay
         rate, and no PERSONAL rate fields for an office/boss face.
         v149 (owner, Oct 17 21:43 MDT): the office face DOES carry
         the client billing rate — it is a company setting, not a
         personal rate, and pricingFor reads it (see the Pay card
         build below).
         The setup-time onboarding.payRate stays stored as the
         legacy fallback inside every rate chain (wage readers use
         ownWageRate || payRate; billing uses billingRate ||
         ownWageRate || payRate) — Preferences no longer writes it,
         so every computed number for an existing setup is
         unchanged. */
      var pfOfficeFace = (effRole === 'office' || o.accountType === 'Fleet Manager');
      var pfOO = (!pfOfficeFace && o.accountType === 'Owner-Operator');
      h += '<div class="card"><h3>💵 Pay</h3>' +
        '<label class="f">Payment standard</label><select id="pf_std">' +
        ['Miles', 'Hourly', 'Trip', 'Weight'].map(function (x) { return '<option' + (o.payStandard === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>' +
        '<label class="f">Travel time bonus (hours/day)</label><input id="pf_travel" type="number" inputmode="decimal" min="0" step="0.5" value="' + esc(o.travelBonus || '1') + '">' +
        '<p class="note">Fixed daily bonus added to foreman ticket hours — for example 1 h, some drivers 1.5 h.</p>';
      if (pfOO) {
        /* v105: the two-books rates for an owner-operator whose
           card posts BOTH sides of his own P&L — v137 framing:
           shown only to an owner-operator, as HIS two rates. */
        h += '<label class="f">Client billing rate ($/foreman hour)</label><input id="pf_billrate" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(o.billingRate || '') + '" placeholder="Blank = your wage rate">' +
          '<label class="f">My wage rate ($/hour)</label><input id="pf_wagerate" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(o.ownWageRate || o.payRate || '') + '">' +
          '<p class="note">If you own the truck AND drive it, a closed haul card posts both sides of your books: revenue = foreman hours × billing rate (customers never pay the travel hour), and driver pay = foreman + travel × your wage rate. Leave the billing rate blank to bill at your wage rate.</p>';
      } else if (!pfOfficeFace) {
        h += '<label class="f">Your pay rate ($/hour)</label><input id="pf_wagerate" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(o.ownWageRate || o.payRate || '') + '">' +
          '<p class="note">Your own rate — your pay stubs, invoices and day earnings are figured at it. Every driver carries their own; a boss sets his drivers\u2019 rates in P&L, not here.</p>';
      } else {
        /* v149 (owner, Oct 17 21:43 MDT — over the payer's own
           evening): the office/boss face rendered NO rate fields
           (v137: personal wage rates don't belong on a boss's
           face — that stands, and no wage field joins this card),
           but the CLIENT BILLING RATE is a company setting, not a
           personal rate, and this field is the only Preferences
           writer of the onboarding.billingRate that
           ConnectPipe.pricingFor reads. The payer's Crew card
           told him "set your client rate in Preferences" while
           his face had no such field — an office-only owner could
           never set the rate, so his crew revenue could never
           price. The door now renders on the payer faces too
           (office role, Fleet Manager, owner-operator of any
           role), framed as the company's rate. It writes through
           the same guarded Save line as the owner-operator's. */
        h += '<label class="f">Client billing rate ($/foreman hour)</label><input id="pf_billrate" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(o.billingRate || '') + '" placeholder="e.g. 52">' +
          '<p class="note">Your company\u2019s rate — what you bill your customer for each foreman hour a connected driver works. It prices the revenue on your crew board and in P&L. Each driver\u2019s pay rate is set on his own entry in P&L, not here.</p>';
      }
      h += '</div>';

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

      /* v116 (owner, Oct 16, 2026 21:38 MDT): "Where I park" is a
         Preferences card again. The v112 re-home put it on the
         dashboard face under the tracker; the owner overruled that
         over his own screenshot ("Why is this asking me right,
         right on the face? It's supposed to ask in the
         preferences."). It is a set-once user fact, so it sits in
         the SETTINGS view beside Base location — not in Advanced
         (not plumbing) and never on the home face, which stays the
         tracker + module cards only. Same ParkPlace engine, same
         store keys, same setter, same words; the wiring is below
         and the paint is paintParkCard (top of this file). Role
         gating matches the dashboard card it replaces: hidden for
         office-only users (roleShowsTracker), like the Truck
         card's driver tools. */
      if (effRole !== 'office') {
        h += '<div class="card"><h3>📍 Where I park</h3>' +
          '<p class="note" id="pf_park_note">Checking…</p>' +
          '<div class="row" style="gap:6px;">' +
          '<button type="button" class="btn ghost" id="pf_park_set" style="flex:1;">📍 Set where I park (use my location now)</button>' +
          '<button type="button" class="btn ghost hidden" id="pf_park_nn" style="flex:1;">Allow notifications</button>' +
          '<button type="button" class="btn ghost hidden" id="pf_park_forget" style="flex:1;">Forget this place</button>' +
          '</div></div>';
      }

      h += '<div class="card"><h3>🏢 Company</h3>' +
        '<label class="f">Company name</label><input id="pf_cname" value="' + esc(o.companyName || '') + '">' +
        '<label class="f">GST/HST number</label><input id="pf_gst" value="' + esc(o.gst || '') + '">' +
        '<label class="f">Business address</label><input id="pf_caddr" value="' + esc(o.companyAddr || '') + '">' +
        '<label class="f">Contracting company</label><input id="pf_cont" value="' + esc(o.contractingCo || '') + '">' +
        '<label class="f">Contracting company address</label><input id="pf_contaddr" value="' + esc(o.contractingAddr || '') + '" placeholder="Street, City, Province Postal">' +
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

      /* v31: photo retake buttons — same OCR as onboarding. Lets the user update
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
        '<p class="note">We remind you 30 days before it expires.</p>' +
        /* v127 (owner, Oct 17 09:33 MDT: "there has to be a way to
           change the unit… some users prefer mpg, not km/L"): the
           economy unit — set once here, read live by Fuel and
           Maintenance. It persists the moment it changes (the
           role-select pattern below), never through Save
           preferences, and it changes only how economy is
           PRINTED: distances stay km, fuel stays litres. */
        '<label class="f">Fuel economy shown as</label><select id="pf_econ">' +
        [['kpl', 'km/L'], ['l100', 'L/100 km'], ['mpg', 'MPG (US)']].map(function (x) {
          return '<option value="' + x[0] + '"' + (econU === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
        }).join('') + '</select>' +
        '<p class="note">How fuel economy is printed in Fuel and Maintenance.</p></div>';

      /* v77 (Navigator): the truck profile every truck route is costed
         with — dimensions and weights the routing engine checks against
         Calgary's truck-network rules. Defaults are a tandem dump
         truck. The fields persist the moment they change (the power-
         read pattern), never through Save preferences, and live in the
         shared 'navigator' store (MeticulousNav) the Navigator
         module reads. v137: the routing server address is NOT here
         and NOT in Advanced — it is a baked-in constant inside the
         Navigator module, with no user-editable surface anywhere
         (the old Advanced text box is gone: one altered character
         used to break routing silently). */
      var nvSet = (window.MeticulousNav && MeticulousNav.loadSettings) ? MeticulousNav.loadSettings()
        : { profile: { height: 3.9, width: 2.6, length: 9.0, weight: 24, axleLoad: 10, axles: 3, hazmat: false } };
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
        '<p class="note" id="pf_nv_note">Saves as you type.</p></div>';

      /* v54 (owner, Oct 14): the standalone Notifications card is gone —
         "Updates and notifications should also be in advanced features!
         These are plumbings a user doesn't click on daily." The push
         button + note now live as a row inside Advanced below (same
         pf_push / pf_pushnote ids and wiring — layout only). */

      /* v52 layout (owner, Oct 14): "Save preferences" used to sit here,
         mid-list, above a crowd of similar big navy buttons — "a user
         will press the wrong button." It now lives at the very BOTTOM of
         the page as the one solid primary button; every utility action
         (push, updates, sync) is a quiet ghost button, and
         Reset onboarding questions is fenced off at the bottom of
         Advanced in danger colours. Layout only — no save behaviour
         changed. */
      /* v95 (owner, Oct 16, on the Preferences screenshot): "Put the
         entire advanced drawer in a button somewhere, not in the wide
         open like that." The whole Advanced area now sits behind ONE
         quiet button, CLOSED when Preferences opens; unfolding it
         reveals exactly the rows that were here before — same controls,
         ids, order and behaviour, v94 copy standing. The wiring below
         queries the same ids (elements in a hidden container are still
         in the DOM), so nothing about how the rows work changes. */

      /* v32: cloud-sync diagnostics used to be their own card here;
         v52 moved them into Advanced as a troubleshooting row (owner:
         "you only need this as a troubleshooting tool"). The status +
         retry wiring below is unchanged and works on the same ids. */
      // v24: removed "Erase all local data" — developer tool, not for users

      /* v52 (owner, Oct 14): the role control lives in the Account
         card next to Account type — an earlier end-of-list placement
         for the role question was a misread and was withdrawn.
         v106: the Security card that used to close the list moved to
         the Account & login screen (modules/account.js); the Advanced
         drawer card is now the last card above Save. */

      /* v52: THE button — one solid primary, full width, at the very
         bottom of the page, under the last card. */
      h += '<button class="btn primary big" id="pf_save" style="margin-top:2px;">Save preferences</button>';
      h += '</div>';
      h += '<div id="pf_view_advanced" class="hidden">';
      h += '<div class="card"><h3>⚙️ Advanced</h3>' +
        '<button class="btn ghost" id="pf_checkupd" style="margin-top:14px;">Check for updates</button>' +
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
        '<p class="note" id="pf_syncnote"></p>' +
        '<button class="btn ghost" id="pf_syncnow">Retry sync now</button></div>' +
        /* v137 (owner, Oct 17 12:25 MDT: "Power read and navigator
           Server are plumbing! Don't need to be there!"): the Power
           Read switch row and the Navigator server row that stood
           here are REMOVED from the face entirely — not greyed, not
           moved. Power Read keeps running in the background for the
           capture flows (it defaults on; the app figures it out by
           itself, and users are never asked for a key — the v94
           ruling). The routing server address is a baked-in
           constant in the Navigator module; the text box that let
           one altered character break routing is gone, and no
           user-facing surface anywhere edits it. */
        '<div style="border-top:1px solid #e3e3e3;margin-top:18px;padding-top:14px;">' +
        '<button class="btn ghost" id="pf_resetonb" style="color:#c0392b;border:1px solid #c0392b;">Reset onboarding questions</button>' +
        '<p class="note">Shows the setup questions again on next sign-in. Your saved answers stay until you finish the questions again.</p></div></div></div>';
      h += '</div>';

      body.innerHTML = h;
      body.querySelector('#pf_save').onclick = function () {
        var g = function (id) { return body.querySelector('#' + id).value.trim(); };
        o.accountType = g('pf_acct'); o.employment = g('pf_emp'); o.payStandard = g('pf_std');
        o.travelBonus = g('pf_travel') || '1';
        /* v137: only the rate fields this role's face rendered are
           written. o.payRate is NOT written here anymore — the
           setup-time value stays as the legacy fallback inside
           every rate chain. v149: an office face renders the
           company billing rate (only), so its Save writes
           billingRate through this same guarded line. */
        var pfBrEl = body.querySelector('#pf_billrate'); if (pfBrEl) o.billingRate = pfBrEl.value.trim();
        var pfWgEl = body.querySelector('#pf_wagerate'); if (pfWgEl) o.ownWageRate = pfWgEl.value.trim();
        o.baseLocation = g('pf_base'); o.homeProvince = body.querySelector('#pf_prov').value; o.companyName = g('pf_cname');
        o.gst = g('pf_gst'); o.companyAddr = g('pf_caddr'); o.contractingCo = g('pf_cont'); o.contractingAddr = g('pf_contaddr');
        o.nextInvoiceNo = g('pf_nextinv');
        o.rateIncludesTax = body.querySelector('#pf_taxincl').checked;
        o.invoiceTaxRate = g('pf_invtax') || '5';
        o.truckNo = g('pf_tnum'); o.truckType = g('pf_ttype');
        /* v76 (F6): office renders have no odometer field/toggle —
           keep whatever is stored, never reach for missing inputs. */
        if (body.querySelector('#pf_odo')) o.odometerBaseline = g('pf_odo');
        /* v118: an untouched safety field never stomps a newer
           stored annualDate (see pfSafetyWinner above). */
        o.safetyExpiry = pfSafetyWinner(g('pf_safety'), pfSafetyRendered, App._store.get('mt_annualDate', ''));
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
            /* v122: an applied Preferences odometer write joins
               the dated readings log (odo_readings). */
            try { if (App._logOdoReading) App._logOdoReading(dec.value, 'preferences', null, dec.action === 'correct'); } catch (e) {}
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
      /* v149 (owner, Oct 17 21:45 MDT — the payer's first evening:
         "why does he have to close the app to have his settings
         saved?"): the identity-shaping selects persist the MOMENT
         they change, in the v52 role pattern above — the store is
         written with the render-closure `o` kept in sync, so a
         later "Save preferences" can never write a stale value
         back over the pick. ACCOUNT TYPE is the identity the
         whole face hangs from: until v149 it was written ONLY
         inside the Save button's handler, nothing re-tuned or
         re-published in-session, and the Preferences page itself
         kept the pre-save face — on an iPhone that reads as
         "close the app or it didn't save" (the payer changed his
         type twice and still saw a driver's face). Its change now
         also re-runs App.onAuth: the sidebar + dashboard re-tune
         at once, and the funnel's ConnectLive leg republishes
         the directory record, so the new type is what the world
         sees without a restart. EMPLOYMENT rides the same
         pattern (it is the pay-stub identity); PAYMENT STANDARD
         persists on change too (the v127 economy-select pattern —
         its readers read the store live at their own render, so
         no re-tune is owed). Typed fields keep Save as their
         commit, and Save already ends in App.onAuth — no path
         leaves the app showing the old face. */
      try {
        var acctSel = body.querySelector('#pf_acct');
        if (acctSel) acctSel.onchange = function () {
          o.accountType = acctSel.value;
          App._store.set('onboarding', o);
          App.onAuth(App.user);
        };
        var empSel = body.querySelector('#pf_emp');
        if (empSel) empSel.onchange = function () {
          o.employment = empSel.value;
          App._store.set('onboarding', o);
        };
        var stdSel = body.querySelector('#pf_std');
        if (stdSel) stdSel.onchange = function () {
          o.payStandard = stdSel.value;
          App._store.set('onboarding', o);
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
      /* v127: the economy-unit select also persists the moment it
         changes — Fuel and Maintenance read it live next render. */
      try {
        var econSel = body.querySelector('#pf_econ');
        if (econSel) econSel.onchange = function () {
          try { App._store.set('mt_econUnit', econSel.value); } catch (e) {}
        };
      } catch (e) {}
      /* v106: the sign-in door + change-password wiring moved with
         the Security card to modules/account.js. */
      /* v107: the tab strip — swaps the two top-level views; every
         control inside keeps its own wiring below, untouched. The
         Settings view (with Save) is the default; Advanced never
         expands inside the Settings scroll. */
      (function () {
        var sBtn = body.querySelector('#pf_tab_settings');
        var aBtn = body.querySelector('#pf_tab_advanced');
        var sView = body.querySelector('#pf_view_settings');
        var aView = body.querySelector('#pf_view_advanced');
        function showTab(adv) {
          if (sView) sView.classList.toggle('hidden', adv);
          if (aView) aView.classList.toggle('hidden', !adv);
          if (sBtn) sBtn.className = 'btn ' + (adv ? 'ghost' : 'navy');
          if (aBtn) aBtn.className = 'btn ' + (adv ? 'navy' : 'ghost');
        }
        /* v116: the shell's back hook for this render — Back on
           the Advanced tab returns to Settings. */
        pfBackHook = function () {
          if (aView && !aView.classList.contains('hidden')) { showTab(false); return true; }
          return false;
        };
        if (sBtn) sBtn.onclick = function () { showTab(false); };
        if (aBtn) aBtn.onclick = function () { showTab(true); };
      })();
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
      /* v32: manual sync retry. v107: no standing status readout
         (owner: Advanced shouldn't show the app's skeleton) — the
         note line started EMPTY and reported only the result of a
         Retry tap.
         v136 (owner order, Oct 17 — "sync is not turning green
         anymore"): the no-readout rule is superseded for THIS line.
         The note is now a live face of the one sync truth — the same
         state machine the header dot paints (CloudSync.status()) —
         so the card and the dot can never disagree, and the owner can
         see WHEN the last full settle happened. One line, kept plain:
         status, not skeleton. */
      (function () {
        var note = body.querySelector('#pf_syncnote');
        var btn = body.querySelector('#pf_syncnow');
        if (!btn) return;
        function paint() {
          if (!note) return;
          try { if (document && document.contains && !document.contains(note)) return; } catch (e) {}
          try {
            if (!window.CloudSync || !CloudSync.status) { note.textContent = 'Sync engine not loaded.'; return; }
            var st = CloudSync.status();
            note.textContent =
              st.state === 'ok' ? '✓ All synced' + (st.lastSettledLabel ? ' · ' + st.lastSettledLabel : '') + '.'
              : st.state === 'err' && st.failKey ? '⚠️ Sync problem — ' + (st.failPlain || 'one of your records') + " hasn't backed up. Tap “Retry sync now”."
              : st.state === 'err' && st.failKind === 'offline' ? '⚠️ You are offline — changes back up when the connection returns.'
              : st.state === 'err' ? '⚠️ Sync can\'t reach the cloud — check your connection, then tap “Retry sync now”.'
              : st.state === 'syncing' ? 'Syncing…'
              : 'Sync is off (not signed in).';
          } catch (e) { if (note) note.textContent = 'Could not read the sync result.'; }
        }
        paint();
        try { if (window.CloudSync && CloudSync.addStatusListener) CloudSync.addStatusListener(paint); } catch (e) {}
        btn.onclick = function () {
          if (note) note.textContent = 'Syncing…';
          try { if (window.CloudSync && CloudSync.syncNow) CloudSync.syncNow(); } catch (e) {}
          setTimeout(paint, 1500);
          setTimeout(paint, 4500);
        };
      })();
      /* v137: the power-read switch wiring that stood here is
         GONE with its card (see the Advanced build above).
         PowerRead.isOn() defaults on and the stored value, if one
         was ever set, simply stays — no UI remains to flip it. */
      /* v107: the background-tracking status block is GONE from
         Preferences (owner, Stage 6: no skeleton prose in Advanced).
         The native ask banner on the tracker (trkBgAsk) still
         carries the one actionable fix, where it happens. */
      /* v116: the park-place controls live in the Settings-view
         card above (they sat on the dashboard in v112–v115; the
         owner ordered them back into Preferences, Oct 16 21:38
         MDT). Same handlers the dashboard card carried; the
         location-failure wording can now only ever appear inside
         this card, never on the home face. Buttons wire per
         render (fresh DOM each time); the place-change listener
         registers once — paintParkCard re-queries the document,
         so a learned-place change repaints the open card live. */
      (function () {
        var note = body.querySelector('#pf_park_note');
        var setBtn = body.querySelector('#pf_park_set'), nnBtn = body.querySelector('#pf_park_nn'), forgetBtn = body.querySelector('#pf_park_forget');
        if (!note || !setBtn) return; // office renders carry no park card
        setBtn.onclick = function () {
          var PP = window.ParkPlace;
          if (!PP) return;
          note.textContent = 'Getting your location…';
          PP.setPlaceHere().then(function () { paintParkCard(); }).catch(function () {
            note.textContent = 'Could not get your location. Location may be off for Meticulous, or this build has no location. Nothing was set.';
          });
        };
        if (nnBtn) nnBtn.onclick = function () {
          var PP = window.ParkPlace;
          if (!PP) return;
          PP.requestNotifications().then(function () { setTimeout(paintParkCard, 400); });
        };
        if (forgetBtn) forgetBtn.onclick = function () {
          var PP = window.ParkPlace;
          if (PP) PP.forgetPlace();
          paintParkCard();
        };
        if (!_parkListenerOn) {
          _parkListenerOn = true;
          try { if (window.ParkPlace) ParkPlace.onPlaceChange(paintParkCard); } catch (e) {}
        }
        paintParkCard();
      })();
      /* v77: Navigator truck profile — persists the moment it
         changes, through the shared MeticulousNav store helpers
         the Navigator module reads. If the module failed to load,
         fall back to the same 'navigator' store key directly so
         the settings are never lost.
         v137: the server-URL wiring that shared this block is
         GONE — Preferences no longer reads, shows, or writes a
         routing address anywhere. The address is a baked-in
         constant inside MeticulousNav.loadSettings. */
      (function () {
        function navLoad() {
          if (window.MeticulousNav && MeticulousNav.loadSettings) return MeticulousNav.loadSettings();
          var s = {}; try { s = App._store.get('navigator', {}) || {}; } catch (e) {}
          return { profile: s.profile || {} };
        }
        function navSave(patch) {
          if (window.MeticulousNav && MeticulousNav.saveSettings) { MeticulousNav.saveSettings(patch); return; }
          var s = {}; try { s = App._store.get('navigator', {}) || {}; } catch (e) {}
          for (var k in patch) s[k] = patch[k];
          try { App._store.set('navigator', s); } catch (e) {}
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
