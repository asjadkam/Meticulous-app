/* billing-v244-test.js — PAYMENT-READY prep (Oct 24, 2026)
   Harness for modules/billing.js: tier gating matrix + trial->paid
   state machine + Connect share allowance. Pure node, no DOM. */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

var src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'billing.js'), 'utf8');
var sandbox = { window: {}, console: console };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
var B = sandbox.Meticulous && sandbox.Meticulous.billing;
if (!B) { console.log('FAIL: Meticulous.billing not exported'); process.exit(1); }

var pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; } else { fail++; console.log('  RED: ' + name); } }
function eq(a, b, name) { ok(a === b, name + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

var DAY = 86400000, T0 = 1760000000000; // fixed clock

/* ---------- config: his sketch, one spot ---------- */
eq(B.CONFIG.prices.standard, 12, 'price standard = his sketch $12');
eq(B.CONFIG.prices.gold, 18, 'price gold = $18 (his Oct 24 decision: "Do it on your Suggestions. 12, 18 and 25.")');
eq(B.CONFIG.prices.premium, 25, 'price premium = $25 (his Oct 24 decision)');
eq(B.CONFIG.currency, 'CAD', 'currency CAD');
eq(B.CONFIG.trialDays, 14, 'trial = 14 days (2 weeks)');
eq(B.CONFIG.stripe.mode, 'test', 'stripe TEST mode');
ok(/^pk_test_/.test(B.CONFIG.stripe.publishableKey), 'publishable key is a pk_test_ placeholder');
ok(!/pk_live_|sk_live_|sk_test_/.test(JSON.stringify(B.CONFIG)), 'no live/secret key anywhere in CONFIG');

/* ---------- monthly totals incl. his account-type surcharge sketch ---------- */
eq(B.monthlyTotal('standard', 'Driver'), 12, 'standard driver total 12');
eq(B.monthlyTotal('gold', 'Owner-Operator'), 19, 'gold owner total 18+1');
eq(B.monthlyTotal('premium', 'Fleet Manager'), 27, 'premium fleet total 25+2');

/* ---------- BETA-PAYWALL-OFF (his rule, Oct 24 08:43 MDT):
   "while on beta, keep the pay wall ready but don't enforce
   that yet." The switch ships OFF: canAccess allows EVERY
   module for EVERY account — nothing locks, no redirects —
   while the record, trial clock, tier choice and share
   counting still run (proven by every section below, which
   reads the same record machinery). ---------- */
eq(B.CONFIG.enforcePaywall, false, 'BETA: the paywall ships OFF');
eq(B.canAccess('connect', { billing: { status: 'expired' }, accountType: 'Driver', now: T0 }), true, 'BETA OFF: expired trial still opens the Connect face');
eq(B.canAccess('pnl', { billing: paidRec('standard'), accountType: 'Driver', now: T0 }), true, 'BETA OFF: even the account-type gate rests (no locks at all)');
eq(B.canAccess('revenue', { billing: { status: 'expired' }, accountType: 'Driver', now: T0 }), true, 'BETA OFF: expired locks nothing');
B.CONFIG.enforcePaywall = true;
eq(B.canAccess('revenue', { billing: { status: 'expired' }, accountType: 'Driver', now: T0 }), false, 'flag ON: the matrix bites again (expired locks revenue)');

/* ---------- gating matrix: tier x module (Driver account) ---------- */
var MODULES = ['revenue', 'dispatch', 'navigator', 'fuel', 'pti', 'damage', 'manifest', 'invoice', 'connect', 'pnl', 'maintenance'];
function paidRec(tier) { return { status: 'active', tier: tier, trialStart: T0 - 30 * DAY, trialEndsAt: T0 - 16 * DAY }; }
var EXPECT = {
  standard: { revenue: 1, dispatch: 1, navigator: 1, fuel: 1, pti: 1, damage: 1, manifest: 0, invoice: 0, connect: 0, pnl: 0, maintenance: 0 },
  gold:     { revenue: 1, dispatch: 1, navigator: 1, fuel: 1, pti: 1, damage: 1, manifest: 1, invoice: 1, connect: 0, pnl: 0, maintenance: 0 },
  premium:  { revenue: 1, dispatch: 1, navigator: 1, fuel: 1, pti: 1, damage: 1, manifest: 1, invoice: 1, connect: 1, pnl: 0, maintenance: 0 }
};
Object.keys(EXPECT).forEach(function (tier) {
  MODULES.forEach(function (m) {
    eq(B.canAccess(m, { billing: paidRec(tier), accountType: 'Driver', now: T0 }) ? 1 : 0,
      EXPECT[tier][m], 'gate ' + tier + '/Driver/' + m);
  });
});
/* account-type gate rides ON TOP of tier: P&L + Maintenance = Owner/Fleet only */
eq(B.canAccess('pnl', { billing: paidRec('standard'), accountType: 'Owner-Operator', now: T0 }), true, 'owner standard gets pnl (base module, owner-gated)');
eq(B.canAccess('maintenance', { billing: paidRec('standard'), accountType: 'Fleet Manager', now: T0 }), true, 'fleet standard gets maintenance');
eq(B.canAccess('pnl', { billing: paidRec('premium'), accountType: 'Driver', now: T0 }), false, 'driver premium NEVER gets pnl');
eq(B.canAccess('maintenance', { billing: paidRec('premium'), accountType: 'Driver', now: T0 }), false, 'driver premium NEVER gets maintenance');
/* always-on surfaces never gated */
['dashboard', 'preferences', 'subscription', 'account', 'reminders'].forEach(function (m) {
  eq(B.canAccess(m, { billing: { status: 'expired' }, accountType: 'Driver', now: T0 }), true, 'always-on: ' + m);
});

/* ---------- trial state machine ---------- */
var fresh = B.newBilling(T0);
eq(fresh.status, 'trialing', 'new signup starts trialing');
eq(B.effectiveTier(fresh, T0), 'premium', 'trial grants Premium');
eq(B.trialDaysLeft(fresh, T0), 14, '14 days left at start');
eq(B.trialDaysLeft(fresh, T0 + 13 * DAY), 1, '1 day left on day 13');
eq(B.canAccess('connect', { billing: fresh, accountType: 'Driver', now: T0 + 5 * DAY }), true, 'trial: connect face open (Premium)');
eq(B.canAccess('pnl', { billing: fresh, accountType: 'Driver', now: T0 + 5 * DAY }), false, 'trial does NOT break account-type law (driver, no pnl)');
eq(B.canAccess('pnl', { billing: fresh, accountType: 'Owner-Operator', now: T0 + 5 * DAY }), true, 'trial owner gets pnl');

/* trial ends, nothing chosen -> expired, paid modules locked */
var lapsed = B.tick(B.newBilling(T0), T0 + 15 * DAY);
eq(lapsed.status, 'expired', 'trial lapses to expired with no choice');
eq(B.effectiveTier(lapsed, T0 + 15 * DAY), null, 'expired has no tier');
eq(B.canAccess('revenue', { billing: lapsed, accountType: 'Driver', now: T0 + 15 * DAY }), false, 'expired locks revenue');

/* chose Gold during trial -> at end: awaiting_checkout -> success: active gold */
var chose = B.chooseTier(B.newBilling(T0), 'gold', T0 + 2 * DAY);
eq(chose.pendingTier, 'gold', 'choice recorded during trial');
var due = B.tick(chose, T0 + 15 * DAY);
eq(due.status, 'awaiting_checkout', 'trial end with a choice -> awaiting_checkout (no card was taken up front)');
eq(B.canAccess('revenue', { billing: due, accountType: 'Driver', now: T0 + 15 * DAY }), false, 'awaiting_checkout: paid modules paused until checkout completes');
var active = B.recordCheckoutSuccess(due, 'sub_test_123', T0 + 15 * DAY);
eq(active.status, 'active', 'checkout success -> active');
eq(active.tier, 'gold', 'active on chosen tier');
eq(active.stripeSubscriptionId, 'sub_test_123', 'stripe sub id recorded');
eq(B.canAccess('manifest', { billing: active, accountType: 'Driver', now: T0 + 16 * DAY }), true, 'active gold: manifest open');
eq(B.canAccess('connect', { billing: active, accountType: 'Driver', now: T0 + 16 * DAY }), false, 'active gold: connect face closed (shares still work, tested below)');

/* subscribe AFTER trial (from expired) also flows through checkout */
var late = B.recordCheckoutSuccess(B.chooseTier(lapsed, 'standard', T0 + 20 * DAY), 'sub_test_9', T0 + 20 * DAY);
eq(late.status, 'active', 'expired -> choose -> checkout -> active');
eq(late.tier, 'standard', 'late tier standard');

/* payment failure + cancel */
var failed = B.recordPaymentFailed(active, T0 + 45 * DAY);
eq(failed.status, 'past_due', 'failed payment -> past_due');
eq(B.canAccess('revenue', { billing: failed, accountType: 'Driver', now: T0 + 45 * DAY }), true, 'past_due keeps access (grace, named choice)');
var canc = B.cancel(active, T0 + 40 * DAY);
eq(canc.status, 'canceled', 'cancel -> canceled');
eq(B.canAccess('revenue', { billing: canc, accountType: 'Driver', now: T0 + 41 * DAY }), true, 'canceled keeps access to period end');
eq(B.tick(canc, T0 + 46 * DAY).status, 'expired', 'canceled lapses at period end (checkout T0+15 + 30d = T0+45)');

/* ---------- Connect shares: every tier, limited; premium unlimited ---------- */
eq(B.sharesLeft(paidRec('standard'), T0), B.CONFIG.connectSharesPerMonth.standard, 'standard share allowance from config');
eq(B.sharesLeft(paidRec('premium'), T0), Infinity, 'premium shares unlimited');
var s1 = B.consumeShare(paidRec('standard'), { ownCrew: false }, T0);
eq(s1.ok, true, 'standard share #1 ok');
eq(B.sharesLeft(s1.billing, T0), B.CONFIG.connectSharesPerMonth.standard - 1, 'allowance decremented');
var own = B.consumeShare(paidRec('standard'), { ownCrew: true }, T0);
eq(own.ok, true, 'own-crew share ok');
eq(B.sharesLeft(own.billing, T0), B.CONFIG.connectSharesPerMonth.standard, 'own crew NEVER consumes allowance');
var fleet = B.consumeShare(paidRec('standard'), { ownCrew: true, fleetOwnDriver: true }, T0);
eq(fleet.ok, true, 'fleet manager -> own driver unlimited');
/* exhaust standard allowance -> next share refused, pack tops up */
var drained = paidRec('standard');
for (var i = 0; i < B.CONFIG.connectSharesPerMonth.standard; i++) drained = B.consumeShare(drained, {}, T0).billing;
eq(B.consumeShare(drained, {}, T0).ok, false, 'past the limit: pay-to-play (refused without a pack)');
var packed = B.addSharePack(drained, 10, T0);
eq(B.sharesLeft(packed, T0), 10, 'share pack adds balance');
eq(B.consumeShare(packed, {}, T0).ok, true, 'pack share spends');
/* new month resets allowance, pack balance carries */
var nextMonth = T0 + 32 * DAY;
eq(B.sharesLeft(packed, nextMonth), B.CONFIG.connectSharesPerMonth.standard + 10, 'month rollover: allowance resets, pack balance carries in full');
/* shares work on Gold even though the Connect face is Premium-only */
eq(B.consumeShare(paidRec('gold'), {}, T0).ok, true, 'gold spends shares (every tier gets shares)');

/* ---------- checkout wiring guards ---------- */
eq(B.checkoutAllowed('pk_test_abc'), true, 'test key allowed');
eq(B.checkoutAllowed('pk_live_abc'), false, 'LIVE key refused in this build');
eq(B.priceIdFor('gold').indexOf('price_'), 0, 'gold has a (placeholder) test price id slot');

console.log('billing-v244: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
