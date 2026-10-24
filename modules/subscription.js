/* Subscription module — v253 (BILLING-INTEGRATION, Oct 24,
   2026): the face of modules/billing.js. The old local tier
   list ($9/$15/$25, 7-day trial) is GONE: the status card
   reads the app's `billing` store record, the plan cards are
   Billing.planCardsHTML (prices from the core's CONFIG —
   his Oct 24 decision: Standard $12 / Gold $18 / Premium
   $25 CAD), Choose during the trial RECORDS the pick
   (Billing.chooseTier — no card is ever taken up front), and
   Choose after the trial goes to Billing.startCheckout,
   which answers {ok:false} in plain words until the server
   endpoint + Stripe TEST price IDs land in the separate
   server pass — never a faked charge. BETA-PAYWALL-OFF:
   while on beta nothing is locked; this face still shows the
   real state of the record underneath. */
(function () {
  'use strict';
  var esc = function (s) { return App._esc(s); };
  var NAMES = { standard: 'Standard', gold: 'Gold', premium: 'Premium' };

  function B() { return (window.Meticulous && Meticulous.billing) || null; }
  function record() {
    var b = B(); if (!b) return null;
    var rec = App._store.get('billing', null);
    if (!rec) { rec = b.newBilling(Date.now()); App._store.set('billing', rec); }
    var ticked = b.tick(rec, Date.now());
    if (JSON.stringify(ticked) !== JSON.stringify(rec)) App._store.set('billing', ticked);
    return ticked;
  }

  Meticulous.modules.subscription = {
    render: function (body) {
      var b = B();
      var h = '<div class="card"><h3>💳 Subscription</h3>';
      if (!b) {
        h += '<p class="note">Plans are not available on this build yet.</p></div>';
        body.innerHTML = h;
        return;
      }
      var rec = record();
      var now = Date.now();
      var ob = App._store.get('onboarding', {}) || {};
      var ctx = { billing: rec, accountType: ob.accountType || '', now: now };
      if (rec.status === 'trialing') {
        h += '<div class="kv"><span>Status</span><b>🎉 Free trial</b></div>' +
          '<div class="kv"><span>Days left</span><b>' + b.trialDaysLeft(rec, now) + '</b></div>' +
          '<div class="kv"><span>Access</span><b>Premium — everything open</b></div>' +
          (rec.pendingTier ? '<div class="kv"><span>Plan after trial</span><b>' + esc(NAMES[rec.pendingTier] || rec.pendingTier) + '</b></div>' : '');
      } else if (rec.status === 'active' || rec.status === 'past_due') {
        h += '<div class="kv"><span>Status</span><b>' + (rec.status === 'active' ? 'Active' : 'Payment due') + '</b></div>' +
          '<div class="kv"><span>Plan</span><b>' + esc(NAMES[rec.tier] || rec.tier || '') + '</b></div>' +
          '<div class="kv"><span>Price</span><b>$' + b.monthlyTotal(rec.tier, ctx.accountType) + ' CAD / month</b></div>';
      } else if (rec.status === 'awaiting_checkout') {
        h += '<div class="kv"><span>Status</span><b>Plan chosen</b></div>' +
          '<div class="kv"><span>Plan</span><b>' + esc(NAMES[rec.pendingTier] || rec.pendingTier || '') + '</b></div>' +
          '<p class="note">Checkout opens at launch — no charge until then.</p>';
      } else if (rec.status === 'canceled') {
        h += '<div class="kv"><span>Status</span><b>Canceled</b></div>' +
          '<p class="note">Your plan runs to the end of the paid period. Pick a plan below to restart.</p>';
      } else {
        h += '<div class="kv"><span>Status</span><b>⏰ Trial ended</b></div>' +
          '<p class="note">Pick a plan below to keep using Meticulous.</p>';
      }
      var left = b.sharesLeft(rec, now);
      h += '<div class="kv"><span>Connect shares this month</span><b>' + (left === Infinity ? 'Unlimited' : left) + '</b></div>';
      h += '</div>';
      h += b.planCardsHTML(ctx);
      h += '<p class="note center">While Meticulous is in beta everything stays open and nothing is charged — choosing a plan now records your pick for launch.</p>';

      body.innerHTML = h;
      body.querySelectorAll('[data-billing-tier]').forEach(function (btn) {
        btn.onclick = function () {
          var tier = btn.getAttribute('data-billing-tier');
          var rec2 = record();
          if (rec2.status === 'trialing') {
            /* steer: during the trial, Choose RECORDS the tier
               (Billing.chooseTier) — paid conversion happens
               only after the trial, onto the chosen tier. */
            App._store.set('billing', b.chooseTier(rec2, tier, Date.now()));
            alert('Plan saved: ' + (NAMES[tier] || tier) + '. It starts when your free trial ends — no card, no charge during the trial.');
            Meticulous.modules.subscription.render(body);
          } else {
            b.startCheckout(tier, {
              accountType: ctx.accountType,
              email: (App.user && App.user.email) || null,
              uid: (App.user && App.user.uid) || null
            }).then(function (r) {
              if (!r || !r.ok) alert('Payments open at launch — nothing was charged. Your current access is unchanged.');
            });
          }
        };
      });
    }
  };
})();
