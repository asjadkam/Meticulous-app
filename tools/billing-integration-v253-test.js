#!/usr/bin/env node
/* Meticulous v253 — BILLING-INTEGRATION (owner's payment-ready
 * push, Oct 24, 2026; prices his Oct 24 decision — Standard
 * $12 / Gold $18 / Premium $25; BETA-PAYWALL-OFF his Oct 24
 * rule). The payment-prep agent's modules/billing.js core is
 * proven by tools/billing-v244-test.js (98 checks); THIS suite
 * proves the INTEGRATION: the module is loaded, the
 * Subscription face renders from it, the app's trial + gates
 * run on its record, and Connect spends shares through it.
 *
 * Run: node tools/billing-integration-v253-test.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } }
function eq(name, got, want) { check(name, got === want, 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }

const indexSrc = read('index.html');
const subSrc = read('modules/subscription.js');
const appSrc = read('js/app.js');
const conSrc = read('modules/connect.js');

/* ---------- the Subscription face, behaviourally ---------- */
function subWorld(billingRec, accountType) {
  const data = new Map();
  if (billingRec) data.set('billing', JSON.parse(JSON.stringify(billingRec)));
  data.set('onboarding', { accountType: accountType || 'Driver' });
  const store = {
    get: function (k, d) { return data.has(k) ? data.get(k) : d; },
    set: function (k, v) { data.set(k, v); }
  };
  const alerts = [];
  const sb = { console, JSON, Math, Date, Object, Array, String, Number, Promise, setTimeout };
  sb.window = sb; sb.globalThis = sb;
  sb.alert = function (m) { alerts.push(String(m)); };
  sb.App = { _store: store, _esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }, _today: function () { return '2026-10-24'; }, user: { email: 'a@b.c', uid: 'u1' } };
  sb.Meticulous = { modules: {} };
  vm.createContext(sb);
  vm.runInContext(read('modules/billing.js'), sb);
  vm.runInContext(subSrc, sb);
  function makeBody() {
    const body = { innerHTML: '', _btns: [] };
    body.querySelectorAll = function (sel) {
      if (sel !== '[data-billing-tier]') return [];
      const out = [];
      const re = /data-billing-tier="([a-z]+)"/g; let m;
      while ((m = re.exec(body.innerHTML))) (function (tier) {
        out.push({ getAttribute: function () { return tier; }, onclick: null });
      })(m[1]);
      body._btns = out;
      return out;
    };
    return body;
  }
  return { sb, store, data, alerts, makeBody, B: sb.Meticulous.billing };
}

(async function main() {
  console.log('— wiring pins —');
  check('index loads billing.js BEFORE subscription.js',
    indexSrc.indexOf('<script src="modules/billing.js') !== -1 &&
    indexSrc.indexOf('<script src="modules/billing.js') < indexSrc.indexOf('<script src="modules/subscription.js'));
  check('subscription has no local price list left', subSrc.indexOf("monthly: 9") === -1 && subSrc.indexOf('var TIERS') === -1);
  check('subscription renders cards from Billing.planCardsHTML', subSrc.indexOf('planCardsHTML') !== -1);
  check('app trial runs on the billing record', appSrc.indexOf("store.get('billing'") !== -1 || appSrc.indexOf('billingRecord') !== -1);
  check('app creates the record with Billing.newBilling', appSrc.indexOf('newBilling') !== -1);
  check('tierAllows is per-module Billing.canAccess now', appSrc.indexOf('tierAllows = function (key)') !== -1 && appSrc.slice(appSrc.indexOf('tierAllows = function (key)'), appSrc.indexOf('tierAllows = function (key)') + 700).indexOf('canAccess') !== -1);
  check('no tierAllows(meta.tier) call site remains', appSrc.indexOf('tierAllows(meta.tier)') === -1);
  check('connect spends a share before the send', conSrc.indexOf('consumeShare') !== -1 && conSrc.indexOf('consumeShare') < conSrc.indexOf('CL.sendRequest(p, k'));
  check('connect answers share_limit with the pack offer', conSrc.indexOf('share_limit') !== -1 && conSrc.indexOf('share pack') !== -1);

  console.log('— the face renders HIS prices from the core —');
  {
    const B0 = JSON.parse(JSON.stringify({ status: 'trialing', tier: null, pendingTier: null, trialStart: Date.now() - 86400000, trialEndsAt: Date.now() + 13 * 86400000, periodEnd: null, stripeCustomerId: null, stripeSubscriptionId: null, sharesMonth: '2026-10', sharesUsed: 0, packBalance: 0, createdAt: Date.now() - 86400000 }));
    const w = subWorld(B0, 'Driver');
    const body = w.makeBody();
    w.sb.Meticulous.modules.subscription.render(body);
    check('status card says Free trial', body.innerHTML.indexOf('Free trial') !== -1);
    check('days left come from the record (13)', body.innerHTML.indexOf('<b>13</b>') !== -1, body.innerHTML.slice(0, 200));
    check('Gold shows $18', body.innerHTML.indexOf('$18') !== -1);
    check('Premium shows $25', body.innerHTML.indexOf('$25') !== -1);
    check('the old $9 Basic is gone', body.innerHTML.indexOf('$9') === -1 && body.innerHTML.indexOf('Basic') === -1);
    check('shares line is on the card', body.innerHTML.indexOf('Connect shares') !== -1);
    /* choose during trial -> recorded, no checkout, no charge.
       body._btns holds the very objects the module wired during
       render (its own querySelectorAll call) — click those. */
    const gold = body._btns.filter(function (b) { return b.getAttribute() === 'gold'; })[0];
    check('a Gold choose button rendered', !!gold);
    if (gold) {
      const wired = gold;
      if (wired && wired.onclick) { wired.onclick(); }
      const rec = w.store.get('billing', null);
      eq('the trial choice is recorded as pendingTier', rec && rec.pendingTier, 'gold');
      check('no checkout was faked (status still trialing)', rec && rec.status === 'trialing');
    }
  }

  console.log('— after the trial: Choose goes to checkout, which refuses gracefully unconfigured —');
  {
    const expired = { status: 'expired', tier: null, pendingTier: null, trialStart: Date.now() - 30 * 86400000, trialEndsAt: Date.now() - 16 * 86400000, periodEnd: null, stripeCustomerId: null, stripeSubscriptionId: null, sharesMonth: '2026-09', sharesUsed: 0, packBalance: 0, createdAt: Date.now() - 30 * 86400000 };
    const w = subWorld(expired, 'Driver');
    const body = w.makeBody();
    w.sb.Meticulous.modules.subscription.render(body);
    check('status card says Trial ended', body.innerHTML.indexOf('Trial ended') !== -1);
    const btns = body._btns;
    const std = btns.filter(function (b) { return b.getAttribute() === 'standard'; })[0];
    check('a Standard choose button rendered', !!std);
    if (std && std.onclick) std.onclick();
    await new Promise(function (r) { setTimeout(r, 30); });
    check('the unconfigured checkout answers in plain words (no fake charge)', w.alerts.some(function (a) { return /launch|soon/i.test(a); }), JSON.stringify(w.alerts));
    eq('nothing was marked paid', w.store.get('billing', {}).status, 'expired');
  }

  console.log('\nbilling-integration-v253 test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
