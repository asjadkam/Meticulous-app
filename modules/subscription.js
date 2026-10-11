/* Subscription module — 7-day trial, 3 tiers, placeholder checkout */
(function () {
  'use strict';
  var esc = function (s) { return App._esc(s); };

  var TIERS = [
    { id: 'basic', name: 'Basic', monthly: 9,
      feats: ['Work tracker', 'Revenue', 'Dispatch', 'Navigation', 'Fuel & Expense', 'Damage & Incident', 'Reminders'] },
    { id: 'pro', name: 'Pro', monthly: 15,
      feats: ['Everything in Basic', 'Manifest / Daily Log', 'Invoice / Pay Stub'] },
    { id: 'premium', name: 'Premium', monthly: 25,
      feats: ['Everything in Pro', 'Connect network'] }
  ];

  Meticulous.modules.subscription = {
    render: function (body) {
      var sub = App._store.get('subscription', null);
      var days = App.trialDaysLeft;
      var h = '<div class="card"><h3>💳 Subscription</h3>';
      if (days > 0) {
        h += '<div class="kv"><span>Status</span><b>🎉 Free trial</b></div>' +
          '<div class="kv"><span>Days left</span><b>' + days + '</b></div>' +
          '<div class="kv"><span>Access</span><b>All tiers</b></div>';
      } else if (sub && sub.tier) {
        var t = TIERS.filter(function (x) { return x.id === sub.tier; })[0];
        h += '<div class="kv"><span>Status</span><b>Active</b></div>' +
          '<div class="kv"><span>Plan</span><b>' + esc(t ? t.name : sub.tier) + '</b></div>';
      } else {
        h += '<div class="kv"><span>Status</span><b>⏰ Trial ended</b></div>' +
          '<p class="note">Pick a plan below to keep using Meticulous.</p>';
      }
      h += '</div>';

      TIERS.forEach(function (t) {
        var isCur = sub && sub.tier === t.id;
        h += '<div class="tier' + (t.id === 'pro' ? ' hot' : '') + '">' +
          '<h3>' + t.name + (t.id === 'pro' ? ' ⭐ <span class="note">most popular</span>' : '') + '</h3>' +
          '<div class="price">$' + t.monthly + '<small>/month · $' + (t.monthly * 10) + '/year (2 months free)</small></div>' +
          '<ul>' + t.feats.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' +
          (isCur ? '<div class="pill">Current plan</div>'
            : '<button class="btn ' + (t.id === 'pro' ? 'primary' : 'navy') + '" data-tier="' + t.id + '">Choose ' + t.name + '</button>') +
          '</div>';
      });
      h += '<p class="note center">Payments open at launch — choosing a plan now reserves it (no charge).</p>';

      body.innerHTML = h;
      body.querySelectorAll('[data-tier]').forEach(function (b) {
        b.onclick = function () {
          var id = b.getAttribute('data-tier');
          App._store.set('subscription', { tier: id, since: App._today() });
          App.userTier = id;
          alert('Plan reserved: ' + id + '. No charge until launch.');
          Meticulous.modules.subscription.render(body);
        };
      });
    }
  };
})();
