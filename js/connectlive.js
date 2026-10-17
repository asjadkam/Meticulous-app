/* Meticulous Connect — LIVE handshake (v131, Connect Phase 2 slice 1).
 *
 * Finding and connecting people is LIVE from this build:
 *  - DIRECTORY: every signed-in account publishes a small public
 *    record at directory/{uid} holding IDENTITY ONLY — display name,
 *    business name, role (+ lowercase/token search indexes derived
 *    from those same two strings). No email, no rates, no personal
 *    data ever enters the record. Published on sign-up/sign-in
 *    (App.onAuth -> ConnectLive.onAuth) and re-published whenever the
 *    profile changes (Preferences save, onboarding finish, opening
 *    Connect) — a per-session content key keeps it to one write
 *    unless the identity actually changed. This self-heal is what
 *    makes the accounts created BEFORE v131 findable the next time
 *    they open the app: no re-signup, no manual step.
 *  - SEARCH: by name or business — full-word (token index), prefix
 *    (lowercase range) and multi-word queries all resolve against
 *    the directory; results carry name + business + role only.
 *  - REQUESTS: requests/{fromUid}_{toUid} — one doc per ordered
 *    pair: {from, to, fromName/fromBusiness/fromRole,
 *    toName/toBusiness/toRole, status, createdAt, updatedAt}. The
 *    identity snapshots ride the request so each side can render
 *    and materialize the connection without a second lookup; they
 *    are the same identity-only fields the directory publishes.
 *  - ACCEPT lands the connection in BOTH accounts' own cloud data:
 *    the accepter writes their con_list entry immediately; the
 *    requester's app materializes its side on reconcile (app start
 *    after the first kv pull + every Connect render), because no
 *    account may write another account's tree. con_list entries
 *    keep the existing shape ({id, name, role, contact}) extended
 *    with {uid, status, viaConnect}; a uid the user removed locally
 *    is remembered in con_hidden so reconcile never resurrects it.
 *
 * Firestore rules for both collections ship in firestore.rules and
 * deploy with the app (deploy.yml: hosting,firestore:rules).
 * NOT in this build: dispatch/document sharing across the pipe —
 * the Connect UI says "comes next" wherever that space shows.
 */
(function () {
  'use strict';

  var CL = {
    _pubKey: '',        // identity last published this session (write guard)
    _reconciling: false,
    pendingIn: 0,       // incoming pending count (module status cache)
    _reqs: null         // last listMine() result {incoming, outgoing}
  };
  window.ConnectLive = CL;

  function fb() {
    try { return (window.FB && FB.ready && FB.user && FB.db) ? FB : null; }
    catch (e) { return null; }
  }
  function store() {
    try { return (window.App && App._store) ? App._store : null; } catch (e) { return null; }
  }

  /* ---------------- identity (directory record) ---------------- */

  function titleWord(w) { return w ? w.charAt(0).toUpperCase() + w.slice(1) : w; }

  /* The display name the account is findable by. The app holds no
     separate person-name field: the business/company name IS the
     trading name for this user base (an owner-operator's invoices read
     his business name from exactly this field). Only when it is empty
     do we fall back to a name-shaped reading of the account email's
     local part — the email itself is never stored. */
  CL.identity = function () {
    var st = store();
    var o = (st && st.get('onboarding', {})) || {};
    var business = String(o.companyName || '').trim();
    var name = business;
    if (!name) {
      var f = fb();
      var local = ((f && f.user && f.user.email) || '').split('@')[0] || '';
      name = local.split(/[._\-+]+/)
        .filter(function (w) { return /[a-z]/i.test(w); })
        .map(function (w) { return titleWord(w.toLowerCase()); })
        .join(' ').trim();
    }
    if (!name) name = 'Meticulous user';
    var role = String(o.accountType || '').trim() || 'Driver';
    return { name: name, business: business, role: role };
  };

  function tokensFor(name, business) {
    var seen = {}, out = [];
    ((name || '') + ' ' + (business || '')).toLowerCase().split(/[^a-z0-9]+/).forEach(function (w) {
      if (w.length >= 2 && !seen[w]) { seen[w] = 1; out.push(w); }
    });
    return out;
  }

  function dirRecord() {
    var idn = CL.identity();
    return {
      name: idn.name,
      business: idn.business,
      role: idn.role,
      nameLower: idn.name.toLowerCase(),
      businessLower: idn.business.toLowerCase(),
      tokens: tokensFor(idn.name, idn.business),
      updatedAt: Date.now()
    };
  }

  /* Publish (or heal) my directory record. Resolves true when a
     write happened; unchanged identity within a session is a no-op. */
  CL.publishMine = function () {
    var f = fb();
    if (!f) return Promise.resolve(false);
    var rec = dirRecord();
    var key = JSON.stringify([rec.name, rec.business, rec.role]);
    if (CL._pubKey === key) return Promise.resolve(false);
    CL._pubKey = key;
    return f.db.collection('directory').doc(f.user.uid).set(rec, { merge: true })
      .then(function () { return true; })
      .catch(function () { CL._pubKey = ''; return false; });
  };

  /* ---------------- search ---------------- */

  /* Finds directory records by name/business. Three query shapes are
     unioned so recall does not depend on how much of the name was
     typed: token (a whole word of the name), name prefix range, and
     business prefix range; a final client pass requires EVERY typed
     word to appear in the name/business text. Self is excluded. */
  CL.search = function (q) {
    var f = fb();
    if (!f) return Promise.resolve([]);
    q = String(q || '').trim().toLowerCase();
    if (!q) return Promise.resolve([]);
    var words = q.split(/\s+/);
    var seen = {}, out = [];
    function add(snap) {
      snap.forEach(function (d) {
        if (d.id === f.user.uid || seen[d.id]) return;
        var v = d.data() || {};
        var hay = ((v.nameLower || '') + ' ' + (v.businessLower || '')).trim();
        for (var i = 0; i < words.length; i++) { if (hay.indexOf(words[i]) === -1) return; }
        seen[d.id] = 1;
        out.push({ uid: d.id, name: v.name || '', business: v.business || '', role: v.role || '' });
      });
    }
    function job(p) { return p.then(add).catch(function () {}); }
    var col = f.db.collection('directory');
    return Promise.all([
      job(col.where('tokens', 'array-contains', words[0]).get()),
      job(col.where('nameLower', '>=', q).where('nameLower', '<=', q + '\uf8ff').get()),
      job(col.where('businessLower', '>=', q).where('businessLower', '<=', q + '\uf8ff').get())
    ]).then(function () {
      out.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      return out;
    });
  };

  /* ---------------- requests ---------------- */

  CL.requestId = function (from, to) { return from + '_' + to; };

  /* Creates (or re-opens after a decline) my request to a peer found
     in search. Resolves 'sent' | 'connected' | 'self' | 'error'. */
  CL.sendRequest = function (peer) {
    var f = fb();
    if (!f || !peer || !peer.uid) return Promise.resolve('error');
    if (peer.uid === f.user.uid) return Promise.resolve('self');
    var me = CL.identity();
    var ref = f.db.collection('requests').doc(CL.requestId(f.user.uid, peer.uid));
    return ref.get().then(function (snap) {
      if (snap.exists && (snap.data() || {}).status === 'accepted') return 'connected';
      var now = Date.now();
      var doc = {
        from: f.user.uid, to: peer.uid,
        fromName: me.name, fromBusiness: me.business, fromRole: me.role,
        toName: peer.name || '', toBusiness: peer.business || '', toRole: peer.role || '',
        status: 'pending', updatedAt: now
      };
      if (!snap.exists) doc.createdAt = now;
      return ref.set(doc, { merge: true }).then(function () { return 'sent'; });
    }).catch(function () { return 'error'; });
  };

  /* My requests, both directions. Also refreshes the pendingIn
     cache the module status line reads. */
  CL.listMine = function () {
    var f = fb();
    if (!f) return Promise.resolve({ incoming: [], outgoing: [] });
    var uid = f.user.uid;
    function rows(snap) {
      var a = [];
      snap.forEach(function (d) { var v = d.data() || {}; v.id = d.id; a.push(v); });
      a.sort(function (x, y) { return (y.updatedAt || 0) - (x.updatedAt || 0); });
      return a;
    }
    function job(p) { return p.then(rows).catch(function () { return []; }); }
    var col = f.db.collection('requests');
    return Promise.all([
      job(col.where('to', '==', uid).get()),
      job(col.where('from', '==', uid).get())
    ]).then(function (r) {
      var res = { incoming: r[0], outgoing: r[1] };
      CL.pendingIn = r[0].filter(function (x) { return x.status === 'pending'; }).length;
      CL._reqs = res;
      return res;
    });
  };

  /* Accept / decline an incoming request. On accept, MY con_list
     gains the connection immediately (my own tree, my own write);
     the requester's side materializes on their next reconcile. */
  CL.respond = function (req, accept) {
    var f = fb();
    if (!f || !req || !req.id) return Promise.resolve(false);
    return f.db.collection('requests').doc(req.id)
      .update({ status: accept ? 'accepted' : 'declined', updatedAt: Date.now() })
      .then(function () {
        if (accept) {
          CL.upsertConn({ uid: req.from, name: req.fromName, business: req.fromBusiness, role: req.fromRole }, 'connected');
        }
        return true;
      })
      .catch(function () { return false; });
  };

  /* ---------------- con_list materialization ---------------- */

  /* Upserts the linked entry for a peer into MY con_list, in the
     existing record shape extended with {uid, status, viaConnect}.
     Manual (uid-less) entries are never touched. A uid in
     con_hidden (removed by the user) is never resurrected.
     Returns true when the list actually changed. */
  CL.upsertConn = function (peer, status) {
    var st = store();
    if (!st || !peer || !peer.uid) return false;
    var hidden = st.get('con_hidden', []) || [];
    if (hidden.indexOf(peer.uid) !== -1) return false;
    var list = st.get('con_list', []) || [];
    var found = null;
    list.forEach(function (c) { if (c && c.uid === peer.uid) found = c; });
    var changed = false;
    if (found) {
      if (found.status !== status) { found.status = status; changed = true; }
      if (peer.name && found.name !== peer.name) { found.name = peer.name; changed = true; }
      if (peer.role && found.role !== peer.role) { found.role = peer.role; changed = true; }
      if (!found.viaConnect) { found.viaConnect = true; changed = true; }
    } else {
      list.push({
        id: 'u' + peer.uid,
        name: peer.name || 'Meticulous user',
        role: peer.role || '',
        contact: '',
        uid: peer.uid,
        status: status,
        viaConnect: true
      });
      changed = true;
    }
    if (changed) st.set('con_list', list);
    return changed;
  };

  /* Brings my con_list in line with my requests: outgoing states
     mirror the request status; accepted incoming pairs land as
     connected. Idempotent; resolves true when anything changed. */
  CL.reconcile = function () {
    if (CL._reconciling) return Promise.resolve(false);
    CL._reconciling = true;
    return CL.listMine().then(function (r) {
      var changed = false;
      r.outgoing.forEach(function (q) {
        if (CL.upsertConn({ uid: q.to, name: q.toName, role: q.toRole }, q.status === 'accepted' ? 'connected' : q.status)) changed = true;
      });
      r.incoming.forEach(function (q) {
        if (q.status === 'accepted') {
          if (CL.upsertConn({ uid: q.from, name: q.fromName, role: q.fromRole }, 'connected')) changed = true;
        }
      });
      CL._reconciling = false;
      return changed;
    }).catch(function () { CL._reconciling = false; return false; });
  };

  /* ---------------- lifecycle ---------------- */

  /* Called from App.onAuth on every auth state change (the
     CloudSync funnel). Publishes/heals the directory record right
     away; reconciles connections once the first kv pull has had
     its chance to land, so a pre-pull con_list can never be pushed
     over the cloud copy. */
  CL.onAuth = function (user) {
    if (!user) return;
    try { CL.publishMine(); } catch (e) {}
    var kick = function () { try { CL.reconcile(); } catch (e) {} };
    try {
      if (window.CloudSync && CloudSync.whenFirstPullDone) {
        CloudSync.whenFirstPullDone(9000).then(kick);
        return;
      }
    } catch (e) {}
    kick();
  };
})();
