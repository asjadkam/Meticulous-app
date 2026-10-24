/* =====================================================================
   billing.js — PAYMENT-READY prep (Oct 24, 2026). NEW FILE, not yet
   wired into index.html/app.js — see integration patch notes in the
   build report. Pure logic core (Node-harnessable) + thin browser
   glue for Stripe Checkout in TEST MODE only.

   Tier model (ASJAD'S, Oct 22, 2026):
     Standard = all modules EXCEPT Manifest, Invoice, Connect.
     Gold     = everything EXCEPT Connect.
     Premium  = everything + UNLIMITED Connect.
   EVERY tier also gets a limited number of individual Connect SHARES
   per month; past the limit it is pay-to-play (share packs). A share
   to your OWN crew never consumes allowance; a Fleet Manager's shares
   to his OWN drivers are unlimited.
   Account types stay SEPARATE from tiers: P&L + Maintenance belong
   to Owner-Operator / Fleet Manager accounts only, on every tier.
   Trial (his law): every new signup gets PREMIUM for 2 weeks free,
   NO card up front; paid conversion happens only after the trial,
   onto the tier the user chose.
   ===================================================================== */
(function () {
  'use strict';

  /* ================= CONFIG — ONE SPOT =================
     PRICES: his sketch Oct 22 was $12 / $14 / $15 (+$1 owner,
     +$2 fleet); on Oct 24, 2026 (08:42 MDT) he decided the
     final numbers: "Do it on your Suggestions. 12, 18 and 25."
     — Standard $12 / Gold $18 / Premium $25 per month CAD.
     The account-type surcharges (+$1 / +$2) stand from the
     accepted structure. All still changeable in one line.
     Share counts: Standard 5/mo, Gold 25/mo (the Oct 22
     structure); counts are config too. */
  var CONFIG = {
    currency: 'CAD',
    prices: { standard: 12, gold: 18, premium: 25 },          // <- his Oct 24 decision
    accountSurcharge: { 'Owner-Operator': 1, 'Fleet Manager': 2 }, // <- his sketch
    enforcePaywall: false, // BETA-PAYWALL-OFF (his rule, Oct 24 08:43): ready but NOT enforced while on beta
    trialDays: 14,
    trialTier: 'premium',
    connectSharesPerMonth: { standard: 5, gold: 25, premium: Infinity },
    sharePacks: [ { shares: 10, price: 4.99 }, { shares: 25, price: 9.99 } ],
    annualMonthsFree: 2, // annual = 10 x monthly (his Oct 22 sketch)
    stripe: {
      mode: 'test', // TEST MODE ONLY in this build. Live wiring is a separate, named pass.
      /* Publishable key is NOT a secret, but it still does not live in
         code as a real value: at runtime the app sets
         window.METICULOUS_STRIPE_PK (from build config); the value
         below is a placeholder so the flow can be harness-proven. */
      publishableKey: 'pk_test_REPLACE_ME',
      /* Test-mode Price IDs, filled in after the products are created
         in the Stripe TEST dashboard (a separate step, his go-ahead). */
      priceIds: { standard: 'price_REPLACE_ME_STANDARD', gold: 'price_REPLACE_ME_GOLD', premium: 'price_REPLACE_ME_PREMIUM' },
      /* Checkout sessions are created SERVER-side (the secret key
         never ships in the app). Endpoint lives on the existing
         meticulous-ai server; until it exists, startCheckout reports
         'not_configured' instead of pretending. */
      checkoutEndpoint: '' // e.g. 'https://2.31.47.19/api/billing/checkout'
    }
  };

  var TIERS = ['standard', 'gold', 'premium'];
  var DAY = 86400000, PERIOD = 30 * DAY;

  /* Minimum tier per module. 'connect' here = the full Connect FACE
     (Premium per his structure). Individual share SENDS are governed
     by the share allowance below, on EVERY tier — that split is the
     reading of his Oct 22 model (module excluded, shares included). */
  var MODULE_MIN_TIER = {
    revenue: 'standard', dispatch: 'standard', navigator: 'standard',
    fuel: 'standard', pti: 'standard', damage: 'standard',
    pnl: 'standard', maintenance: 'standard',       // + account-type gate below
    manifest: 'gold', invoice: 'gold',
    connect: 'premium'
  };
  /* Account-type gate (role law, independent of tier): these modules
     exist only for Owner-Operator / Fleet Manager accounts. */
  var OWNER_ONLY = { pnl: 1, maintenance: 1 };
  var OWNER_TYPES = { 'Owner-Operator': 1, 'Fleet Manager': 1 };
  /* Never gated: the user must always be able to reach the paywall,
     their settings, and their account. */
  var ALWAYS_ON = { dashboard: 1, preferences: 1, subscription: 1, billing: 1, account: 1, reminders: 1, feedback: 1, logout: 1 };

  function tierRank(t) { return TIERS.indexOf(t); }
  function clone(o) { return JSON.parse(JSON.stringify(o || {})); }
  function monthKey(now) { var d = new Date(now); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2); }

  /* ---------------- billing record + state machine ----------------
     Record shape (stored by the app under store key 'billing'):
       { status: 'trialing'|'awaiting_checkout'|'active'|'past_due'|
                 'canceled'|'expired',
         tier, pendingTier, trialStart, trialEndsAt, periodEnd,
         stripeCustomerId, stripeSubscriptionId,
         sharesMonth, sharesUsed, packBalance, createdAt }
     Transitions happen in tick() (time) and the record*() events
     (checkout/payment). No card is ever taken during the trial. */
  function newBilling(now) {
    return {
      status: 'trialing', tier: null, pendingTier: null,
      trialStart: now, trialEndsAt: now + CONFIG.trialDays * DAY,
      periodEnd: null, stripeCustomerId: null, stripeSubscriptionId: null,
      sharesMonth: monthKey(now), sharesUsed: 0, packBalance: 0,
      createdAt: now
    };
  }

  function tick(rec, now) {
    var b = clone(rec);
    if (b.status === 'trialing' && now >= b.trialEndsAt) {
      b.status = b.pendingTier ? 'awaiting_checkout' : 'expired';
    } else if (b.status === 'canceled' && b.periodEnd && now >= b.periodEnd) {
      b.status = 'expired'; b.tier = null;
    }
    return b;
  }

  function effectiveTier(rec, now) {
    if (!rec) return null;
    if (rec.status === 'trialing') return now < rec.trialEndsAt ? CONFIG.trialTier : null;
    if (rec.status === 'active' || rec.status === 'past_due') return rec.tier || null;
    if (rec.status === 'canceled') return (rec.periodEnd && now < rec.periodEnd) ? (rec.tier || null) : null;
    return null; // awaiting_checkout / expired
  }

  function trialDaysLeft(rec, now) {
    if (!rec || rec.status !== 'trialing') return 0;
    return Math.max(0, Math.ceil((rec.trialEndsAt - now) / DAY));
  }

  function chooseTier(rec, tier, now) {
    if (tierRank(tier) < 0) throw new Error('unknown tier: ' + tier);
    var b = clone(rec); b.pendingTier = tier; return b;
  }

  function recordCheckoutSuccess(rec, stripeSubscriptionId, now) {
    var b = clone(rec);
    b.tier = b.pendingTier || b.tier;
    if (tierRank(b.tier) < 0) throw new Error('checkout success with no tier chosen');
    b.pendingTier = null;
    b.status = 'active';
    b.stripeSubscriptionId = stripeSubscriptionId || b.stripeSubscriptionId;
    b.periodEnd = now + PERIOD;
    return b;
  }

  function recordPaymentFailed(rec, now) {
    var b = clone(rec); if (b.status === 'active') b.status = 'past_due'; return b;
  }

  function cancel(rec, now) {
    var b = clone(rec);
    if (b.status === 'active' || b.status === 'past_due') b.status = 'canceled';
    return b;
  }

  /* ---------------- gating ---------------- */
  function canAccess(moduleKey, ctx) {
    /* BETA-PAYWALL-OFF (his rule, Oct 24, 2026 08:43 MDT):
       "while on beta, keep the pay wall ready but don't
       enforce that yet — until the app is ready to stand on
       her own weight." While the switch is OFF every module
       is allowed for every account — nothing locks, nothing
       redirects — while the billing record, the trial clock,
       tier selection and share counting still run and record
       (the sections above/below are untouched), so the data
       is real the day enforcement flips on. */
    if (!CONFIG.enforcePaywall) return true;
    if (ALWAYS_ON[moduleKey]) return true;
    var min = MODULE_MIN_TIER[moduleKey];
    if (!min) return false; // unknown module: closed, never open by accident
    if (OWNER_ONLY[moduleKey] && !OWNER_TYPES[ctx.accountType]) return false;
    var t = effectiveTier(ctx.billing, ctx.now);
    if (!t) return false;
    return tierRank(t) >= tierRank(min);
  }

  function monthlyTotal(tier, accountType) {
    return (CONFIG.prices[tier] || 0) + (CONFIG.accountSurcharge[accountType] || 0);
  }

  /* ---------------- Connect shares ---------------- */
  function normShares(b, now) {
    var c = clone(b), mk = monthKey(now);
    if (c.sharesMonth !== mk) { c.sharesMonth = mk; c.sharesUsed = 0; }
    return c;
  }
  function sharesLeft(rec, now) {
    var t = effectiveTier(rec, now);
    if (!t) return 0;
    var allow = CONFIG.connectSharesPerMonth[t];
    if (allow === Infinity) return Infinity;
    var b = normShares(rec, now);
    return Math.max(0, allow - (b.sharesUsed || 0)) + (b.packBalance || 0);
  }
  /* opts: { ownCrew } — a share to your own crew/driver is free;
     Fleet Managers to their OWN drivers pass ownCrew:true (unlimited
     by the same rule). Premium never decrements. */
  function consumeShare(rec, opts, now) {
    opts = opts || {};
    var t = effectiveTier(rec, now);
    if (!t) return { ok: false, reason: 'no_active_tier', billing: clone(rec) };
    if (opts.ownCrew || opts.fleetOwnDriver) return { ok: true, free: true, billing: clone(rec) };
    if (CONFIG.connectSharesPerMonth[t] === Infinity) return { ok: true, free: true, billing: clone(rec) };
    var b = normShares(rec, now);
    var allowLeft = CONFIG.connectSharesPerMonth[t] - (b.sharesUsed || 0);
    if (allowLeft > 0) { b.sharesUsed = (b.sharesUsed || 0) + 1; return { ok: true, from: 'allowance', billing: b }; }
    if ((b.packBalance || 0) > 0) { b.packBalance -= 1; return { ok: true, from: 'pack', billing: b }; }
    return { ok: false, reason: 'share_limit', billing: b };
  }
  function addSharePack(rec, shares, now) {
    var b = normShares(rec, now); b.packBalance = (b.packBalance || 0) + shares; return b;
  }

  /* ---------------- Stripe Checkout (TEST MODE, browser glue) ------ */
  function publishableKey() {
    var w = (typeof window !== 'undefined') ? window : {};
    return w.METICULOUS_STRIPE_PK || CONFIG.stripe.publishableKey;
  }
  function checkoutAllowed(key) { return typeof key === 'string' && /^pk_test_/.test(key); }
  function priceIdFor(tier) { return CONFIG.stripe.priceIds[tier]; }

  /* Creates a Checkout Session via the server endpoint (secret key
     stays server-side) and redirects. Resolves {ok:false, reason}
     instead of throwing when billing is not configured yet — the UI
     shows a plain "payments open soon" line, never a fake charge. */
  function startCheckout(tier, opts) {
    opts = opts || {};
    var key = publishableKey();
    if (!checkoutAllowed(key)) return Promise.resolve({ ok: false, reason: 'live_key_refused_or_unset' });
    if (!CONFIG.stripe.checkoutEndpoint) return Promise.resolve({ ok: false, reason: 'not_configured' });
    var body = { priceId: priceIdFor(tier), tier: tier, mode: 'subscription',
      currency: CONFIG.currency, accountType: opts.accountType || null,
      email: opts.email || null, uid: opts.uid || null };
    return fetch(CONFIG.stripe.checkoutEndpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data && data.url) { window.location.href = data.url; return { ok: true, redirected: true }; }
      return { ok: false, reason: 'no_checkout_url', detail: data || null };
    }).catch(function (e) { return { ok: false, reason: 'network', detail: String(e) }; });
  }

  /* ---------------- plan picker UI (for the Subscription face) -----
     Rendered by modules/subscription.js at integration time; classes
     reuse the app's existing card/tier/btn styles. Prices read from
     CONFIG so a price change is one line, UI included. */
  function planCardsHTML(ctx) {
    var cur = effectiveTier(ctx.billing, ctx.now);
    var names = { standard: 'Standard', gold: 'Gold', premium: 'Premium' };
    var feats = {
      standard: ['Everything except Manifest, Invoice & Connect', 'A few Connect shares each month'],
      gold: ['Everything except Connect', 'Manifest + Invoice included', 'More Connect shares each month'],
      premium: ['Everything, plus unlimited Connect', 'All modules, no share limits']
    };
    var h = '';
    TIERS.forEach(function (t) {
      var total = monthlyTotal(t, ctx.accountType);
      h += '<div class="tier' + (t === 'gold' ? ' hot' : '') + '"><h3>' + names[t] + '</h3>' +
        '<div class="price">$' + total + '<small>/' + CONFIG.currency + ' per month</small></div><ul>' +
        feats[t].map(function (f) { return '<li>' + f + '</li>'; }).join('') + '</ul>' +
        (cur === t && ctx.billing.status !== 'trialing'
          ? '<div class="pill">Current plan</div>'
          : '<button class="btn ' + (t === 'gold' ? 'primary' : 'navy') + '" data-billing-tier="' + t + '">Choose ' + names[t] + '</button>') +
        '</div>';
    });
    return h;
  }

  var Billing = {
    CONFIG: CONFIG, TIERS: TIERS,
    MODULE_MIN_TIER: MODULE_MIN_TIER, ALWAYS_ON: ALWAYS_ON,
    newBilling: newBilling, tick: tick, effectiveTier: effectiveTier,
    trialDaysLeft: trialDaysLeft, chooseTier: chooseTier,
    recordCheckoutSuccess: recordCheckoutSuccess,
    recordPaymentFailed: recordPaymentFailed, cancel: cancel,
    canAccess: canAccess, monthlyTotal: monthlyTotal,
    sharesLeft: sharesLeft, consumeShare: consumeShare, addSharePack: addSharePack,
    publishableKey: publishableKey, checkoutAllowed: checkoutAllowed,
    priceIdFor: priceIdFor, startCheckout: startCheckout,
    planCardsHTML: planCardsHTML
  };

  var g = (typeof window !== 'undefined') ? window : globalThis;
  g.Meticulous = g.Meticulous || {};
  g.Meticulous.billing = Billing;
  if (typeof module !== 'undefined' && module.exports) module.exports = Billing;
})();
