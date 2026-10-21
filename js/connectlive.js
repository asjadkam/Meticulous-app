/* Meticulous Connect — LIVE handshake (v131, Connect Phase 2 slice 1).
 *
 * Finding and connecting people is LIVE from this build:
 *  - DIRECTORY: every signed-in account publishes a small public
 *    record at directory/{uid} holding IDENTITY ONLY — display name,
 *    business name, role (+ lowercase/token search indexes derived
 *    from those same two strings). v155 adds the FACE (driver /
 *    both / office — whether the person drives) beside the role:
 *    the role is the account TYPE, which cannot say that (an
 *    owner-operator may be office-only). v147 adds the PERSON —
 *    the man's own first + last name, asked in setup (js/app.js)
 *    and Preferences — beside the business: the display name IS
 *    the person when he is known, the business rides as its own
 *    field (the listing's second line), and `person` travels the
 *    exact channels `face` travels (record, request snapshots,
 *    con_list entries, the reconcile heal). No email, no rates, no personal
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
 *    pair: {from, to, fromName/fromBusiness/fromRole/fromFace/
 *    fromPerson, toName/toBusiness/toRole/toFace/toPerson, status,
 *    createdAt, updatedAt}. The identity snapshots ride the
 *    request so each side can render and materialize the
 *    connection without a second lookup; they are the same
 *    identity-only fields the directory publishes.
 *  - ACCEPT lands the connection in BOTH accounts' own cloud data:
 *    the accepter writes their con_list entry immediately; the
 *    requester's app materializes its side on reconcile (app start
 *    after the first kv pull + every Connect render), because no
 *    account may write another account's tree. con_list entries
 *    keep the existing shape ({id, name, role, contact}) extended
 *    with {uid, status, viaConnect, face, person, business}; a uid
 *    the user removed locally is remembered in con_hidden so
 *    reconcile never resurrects it.
 *
 * Firestore rules for both collections ship in firestore.rules and
 * deploy with the app (deploy.yml: hosting,firestore:rules).
 * NOT in this build: dispatch/document sharing across the pipe —
 * the Connect UI says "comes next" wherever that space shows.
 *
 * v148 — CONNECTION KINDS (owner, Oct 17, 2026 21:35–21:36 +
 * 22:26 MDT): at connect time a man chooses the KIND of
 * connection — 'all' (Connect all), 'limited' (Connect limited),
 * 'once' (One time connection). The kind rides the request doc
 * (the requester proposes; the accepter sees it and can change
 * it at accept — the ACCEPTED value governs) and lands on both
 * con_list entries through upsertConn, exactly the channels face
 * and person ride. A pair with NO kind anywhere (every pre-v148
 * connection — the owner's own payer pair included) reads as
 * 'all' — his words for that pair: Full access — and behaves
 * byte-identically to before. Later changes go through
 * CL.setKind: the entry re-stamps at once and the accepted
 * request doc(s) carry the new kind to the other side (the rules
 * allow either party a kind-only update on an accepted doc), so
 * reconcile re-governs both apps from that moment.
 *   LIMITED: the sharing side publishes nothing but dispatches
 *   + manifests to that viewer (connectpipe gates the viewers
 *   lists, the billing doc and the records), the reading side
 *   renders no money/share surfaces for him, and the rules deny
 *   the withheld dirs outright.
 *   ONE-TIME: the connection is for ONE day (onceDate — the day
 *   of the request, re-stamped to the riding dispatch's date
 *   when one is sent). It ENDS ITSELF when that day closes: the
 *   earlier of (a) the riding dispatch completing on the
 *   driver's books (a completed dispatch with pipeFrom = that
 *   peer, dated onceDate — the sweep in reconcile sees it from
 *   the pipe's own facts), or (b) the day simply ending (today
 *   passes onceDate, either side's reconcile). The end stamps
 *   endedAt on the pair's request doc, so the other side ends
 *   on its next reconcile and the rules shut at the same mark;
 *   the row stays as an ended row until removed, and a fresh
 *   request re-opens the ended doc (sendRequest) any time.
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

  /* v147: the PERSON's full name — onboarding.firstName +
     lastName, asked in setup and Preferences. Connect is between
     people: the directory, the requests and the crew boards name
     the man, with his business as the second line. '' when the
     account has never been asked (or left it blank — asking is
     fine, walling is not: every surface falls back exactly as
     before when the person is unknown). */
  function personOf(o) {
    o = o || {};
    return (String(o.firstName || '').trim() + ' ' + String(o.lastName || '').trim())
      .replace(/\s+/g, ' ').trim();
  }
  CL.personOf = personOf;

  /* The display name the account is findable by. v147 law: the
     PERSON's full name when he is known — a man is found and
     recognized by his name, not his company. The business/company
     name stays the trading name on its own field (an
     owner-operator's invoices read his business name from exactly
     that field), and only when NEITHER person nor business is
     known do we fall back to a name-shaped reading of the account
     email's local part — the email itself is never stored. With
     no person name, every output below is byte-identical to the
     pre-v147 behaviour. */
  CL.identity = function () {
    var st = store();
    var o = (st && st.get('onboarding', {})) || {};
    var business = String(o.companyName || '').trim();
    var person = personOf(o);
    var name = person || business;
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
    return { name: name, business: business, role: role, face: faceOf(o), person: person };
  }

  /* v155: the FACE — the person-level answer to "Do you drive a
     truck yourself?" (onboarding.userRole: 'driver' / 'both' /
     'office'), resolved with the app's OWN law (js/app.js v52
     role region + the v76 provisional hold): a stored answer
     wins; an unanswered one falls back to the accountType
     default, and the 'both' default (Owner-Operator) holds at
     'office' until the person answers. The directory publishes
     the face BESIDE the type because the type alone cannot say
     whether a man drives — an owner-operator may never touch a
     wheel (the payer: type Owner-Operator, face office) — and
     the Dispatch send picker (modules/dispatch.js) offers work
     only to faces that drive. Identity-only, like the type. */
  var FACE_DEFAULTS = { 'Driver': 'driver', 'Owner-Operator': 'both', 'Fleet Manager': 'office' };
  function isFace(v) { return v === 'driver' || v === 'both' || v === 'office'; }
  function faceOf(o) {
    o = o || {};
    if (isFace(o.userRole)) return o.userRole;
    var d = FACE_DEFAULTS[String(o.accountType || '').trim()] || 'driver';
    return d === 'both' ? 'office' : d;
  }
  CL.isFace = isFace;;

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
      face: idn.face,
      person: idn.person,
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
    var key = JSON.stringify([rec.name, rec.business, rec.role, rec.face, rec.person]);
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
        out.push({ uid: d.id, name: v.name || '', business: v.business || '', role: v.role || '', face: v.face || '', person: v.person || '' });
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

  /* ---------------- v148: connection kinds ---------------- */

  /* The kind vocabulary. Absent/invalid reads as 'all' everywhere
     (CL.kindOf) — every pre-v148 pair is grandfathered Full
     access with no field written anywhere. */
  CL.isKind = function (v) { return v === 'all' || v === 'limited' || v === 'once'; };
  CL.kindOf = function (entry) {
    return (entry && CL.isKind(entry.kind)) ? entry.kind : 'all';
  };

  /* v176 (L1/L2, owner Oct 20, 2026 14:24 MDT): LIMITED is no
     longer a fixed preset. The approver ticks exactly which
     modules the connecter gets; the ticked list rides the request
     doc and both con_list entries as `modules` (an array of module
     keys). Enforcement reads CL.modulesOf everywhere the kinds are
     read (pipe publishers, readers, P&L crew gates, rules mirror).
     A Limited pair with NO modules list (every pre-v176 pair)
     reads as the legacy preset ['dispatch','manifest'] so nothing
     already live changes shape. Connect All ignores the list —
     everything, past and present. For a ONE-TIME pair the same
     list is the ITEM LIST the request covers (L2): both sides see
     exactly what the one-time access is for. */
  CL.MODULES = [
    { key: 'dispatch', label: 'Dispatches' },
    { key: 'manifest', label: 'Manifests' },
    { key: 'fuel', label: 'Fuel' },
    { key: 'expenses', label: 'Expenses & receipts' },
    { key: 'maintenance', label: 'Maintenance' },
    { key: 'pti', label: 'PTI inspections' },
    { key: 'invoices', label: 'Invoices' },
    { key: 'pnl', label: 'P&L money picture' }
  ];
  CL.MODULE_KEYS = CL.MODULES.map(function (m) { return m.key; });
  CL.LEGACY_LIMITED_MODULES = ['dispatch', 'manifest'];
  CL.sanitizeModules = function (v) {
    if (!Array.isArray(v)) return null;
    var out = [];
    v.forEach(function (k) {
      if (CL.MODULE_KEYS.indexOf(k) !== -1 && out.indexOf(k) === -1) out.push(k);
    });
    return out;
  };
  /* The effective module list for an entry/doc. 'all' -> null
     (no restriction). 'limited'/'once' -> the ticked list, or the
     legacy preset when none was ever ticked. */
  CL.modulesOf = function (entry) {
    var k = CL.kindOf(entry);
    if (k === 'all') return null;
    var m = CL.sanitizeModules(entry && entry.modules);
    if (m && m.length) return m;
    return CL.LEGACY_LIMITED_MODULES.slice();
  };
  CL.allowsModule = function (entry, key) {
    var m = CL.modulesOf(entry);
    return m === null || m.indexOf(key) !== -1;
  };
  CL.moduleLabel = function (key) {
    for (var i = 0; i < CL.MODULES.length; i++) if (CL.MODULES[i].key === key) return CL.MODULES[i].label;
    return key;
  };

  function z2(n) { return ('0' + n).slice(-2); }
  function dateOfMs(ms) {
    var d = new Date(ms || 0);
    if (!isFinite(d.getTime())) return '';
    return d.getFullYear() + '-' + z2(d.getMonth() + 1) + '-' + z2(d.getDate());
  }
  function todayStr() {
    try { if (window.App && App._today) { var t = App._today(); if (t) return t; } } catch (e) {}
    return dateOfMs(Date.now());
  }
  CL.todayStr = todayStr;

  /* Send-side preselection (owner's law: a DISPATCHER usually
     connects Limited). The best available signal on the
     requester's own side: MY face is office (I don't drive) AND
     the peer's face drives AND the peer is NOT on my payroll
     books (no pnl_drivers entry carries his uid — a payer asking
     his own driver is an All pairing). Anything else: All. */
  function payrollHas(uid) {
    var st = store();
    if (!st || !uid) return false;
    return (st.get('pnl_drivers', []) || []).some(function (d) { return d && d.uid === uid; });
  }
  CL.defaultKindFor = function (peer) {
    if (!peer || !peer.uid) return 'all';
    var me = CL.identity();
    var peerDrives = peer.face === 'driver' || peer.face === 'both';
    if (me.face === 'office' && peerDrives && !payrollHas(peer.uid)) return 'limited';
    return 'all';
  };

  /* Accept-side preselection: the PROPOSAL governs when the doc
     carries one. For a kind-less (pre-v148) request, the same
     dispatcher shape read from the other side: the requester's
     face is office, MY face drives, and he is not my payer of
     record (he matches none of my issued invoices' bill-to,
     through the pipe's own matcher over the request snapshots /
     my books) -> Limited; otherwise All. */
  function billToMatchesName(billTo, name) {
    try {
      if (!(window.ConnectPipe && ConnectPipe.normName && ConnectPipe.billToName)) return false;
      var bt = ConnectPipe.billToName(billTo), pn = ConnectPipe.normName(name);
      if (!bt || bt.length < 3 || !pn || pn.length < 3) return false;
      return pn === bt || pn.indexOf(bt) !== -1 || bt.indexOf(pn) !== -1;
    } catch (e) { return false; }
  }
  CL.defaultKindForRequest = function (q) {
    if (!q) return 'all';
    if (CL.isKind(q.kind)) return q.kind;
    var me = CL.identity();
    var iDrive = me.face === 'driver' || me.face === 'both';
    if (q.fromFace === 'office' && iDrive) {
      var payer = false;
      try {
        var st = store();
        if (st) {
          payer = (st.get('inv_list', []) || []).some(function (r) {
            if (!r) return false;
            try {
              if (window.ConnectPipe && ConnectPipe.peerMatchesBillTo &&
                  ConnectPipe.peerMatchesBillTo(q.from, r.billTo)) return true;
            } catch (e) {}
            return billToMatchesName(r.billTo, q.fromName) || billToMatchesName(r.billTo, q.fromBusiness);
          });
        }
      } catch (e) { payer = false; }
      if (!payer) return 'limited';
    }
    return 'all';
  };

  /* ---------------- requests ---------------- */

  CL.requestId = function (from, to) { return from + '_' + to; };

  /* Creates (or re-opens after a decline) my request to a peer found
     in search. Resolves 'sent' | 'connected' | 'self' | 'error'.
     v148: the caller (the Connect picker's choice) may stamp the
     proposed kind (+ the once day) on the doc; called the old
     way (no kind), the doc keeps the exact pre-v148 shape. An
     accepted pair whose one-time connection has ENDED itself
     (endedAt stamped) is not 'connected' — the fresh request
     re-opens the same doc as pending with the end cleared (the
     rules carry that branch). */
  CL.sendRequest = function (peer, kind, onceDate, modules) {
    var f = fb();
    if (!f || !peer || !peer.uid) return Promise.resolve('error');
    if (peer.uid === f.user.uid) return Promise.resolve('self');
    var me = CL.identity();
    var ref = f.db.collection('requests').doc(CL.requestId(f.user.uid, peer.uid));
    return ref.get().then(function (snap) {
      var cur = snap.exists ? (snap.data() || {}) : null;
      if (cur && cur.status === 'accepted' && !((cur.endedAt || 0) > 0)) return 'connected';
      var now = Date.now();
      var doc = {
        from: f.user.uid, to: peer.uid,
        fromName: me.name, fromBusiness: me.business, fromRole: me.role, fromFace: me.face, fromPerson: me.person,
        toName: peer.name || '', toBusiness: peer.business || '', toRole: peer.role || '', toFace: peer.face || '', toPerson: peer.person || '',
        status: 'pending', updatedAt: now
      };
      if (cur && (cur.endedAt || 0) > 0) doc.endedAt = 0; // the re-open clears the end
      if (CL.isKind(kind)) doc.kind = kind;
      if (kind === 'once') doc.onceDate = onceDate || todayStr();
      /* v176 (L1/L2): the module/item list rides the request —
         for Limited, the requester's proposed ticks (the approver
         may change them at accept; the accepted list governs);
         for One-Time, the item list the access covers. */
      var sm = CL.sanitizeModules(modules);
      if (sm && (kind === 'limited' || kind === 'once')) doc.modules = sm;
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
     the requester's side materializes on their next reconcile.
     v148: the accepter may pass the kind he chose at accept (the
     picker preselects the proposal through defaultKindForRequest)
     — the ACCEPTED kind is stamped on the doc and on my entry,
     and it governs both sides; a re-accept of a re-opened
     one-time pair clears the old end. Called the old way (no
     kind), the doc keeps the proposal (or the pre-v148 shape). */
  CL.respond = function (req, accept, kind, onceDate, modules) {
    var f = fb();
    if (!f || !req || !req.id) return Promise.resolve(false);
    var upd = { status: accept ? 'accepted' : 'declined', updatedAt: Date.now() };
    var ak = null, od = null, am = null;
    if (accept) {
      ak = CL.isKind(kind) ? kind : (CL.isKind(req.kind) ? req.kind : null);
      if (ak) upd.kind = ak;
      if (ak === 'once') {
        od = onceDate || req.onceDate || todayStr();
        upd.onceDate = od;
      }
      /* v176 (L1/L2): the APPROVER's ticked list governs. The
         approver may pass his ticks; absent ticks, the request's
         proposed list stands; absent both, a Limited pair keeps
         no list and reads as the legacy preset. */
      var sm = CL.sanitizeModules(modules) || CL.sanitizeModules(req.modules);
      if (sm && (ak === 'limited' || ak === 'once')) { upd.modules = sm; am = sm; }
      if ((req.endedAt || 0) > 0) upd.endedAt = 0;
    }
    return f.db.collection('requests').doc(req.id)
      .update(upd)
      .then(function () {
        if (accept) {
          CL.upsertConn({ uid: req.from, name: req.fromName, business: req.fromBusiness, role: req.fromRole, face: req.fromFace, person: req.fromPerson, kind: ak, onceDate: od, modules: am }, 'connected');
        }
        return true;
      })
      .catch(function () { return false; });
  };

  /* ---------------- con_list materialization ---------------- */

  /* v171: ONE ENTRY PER ACCOUNT (owner, Oct 18, 2026 21:35 MDT —
     his screenshot: 'Current connections (3)' with the same
     person painted TWICE, identically). Entries are keyed by
     uid: two rows for one account are ONE connection, however
     they got there (an older accept path, a cloud merge, a
     restore). dedupeConList collapses them — the survivor holds
     the strongest status (connected > pending > declined >
     ended), its empty fields filled from the dropped rows.
     Uid-less manual entries are the user's own address book and
     are never touched. Pure: callers persist the result. */
  var CONN_STATUS_RANK = { connected: 4, pending: 3, declined: 2, ended: 1 };
  CL.dedupeConList = function (list) {
    var out = [], byUid = {};
    (list || []).forEach(function (c) {
      if (!c || !c.uid) { out.push(c); return; }
      var cur = byUid[c.uid];
      if (!cur) { byUid[c.uid] = c; out.push(c); return; }
      var keep = (CONN_STATUS_RANK[c.status] || 0) > (CONN_STATUS_RANK[cur.status] || 0) ? c : cur;
      var drop = (keep === c) ? cur : c;
      ['name', 'role', 'face', 'person', 'business', 'contact', 'kind', 'onceDate', 'modules'].forEach(function (k) {
        if (!keep[k] && drop[k]) keep[k] = drop[k];
      });
      if (drop.viaConnect) keep.viaConnect = true;
      if (keep !== cur) {
        var idx = out.indexOf(cur);
        if (idx >= 0) out[idx] = keep;
        byUid[c.uid] = keep;
      }
    });
    return out;
  };

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
      /* v155: the face rides the same refresh — but only a real
         face value may land; a pre-v155 snapshot's empty face
         never erases a known one. */
      if (isFace(peer.face) && found.face !== peer.face) { found.face = peer.face; changed = true; }
      /* v147: the person rides the same refresh under the same
         guard (a pre-v147 snapshot's missing person never erases
         a known one), and the BUSINESS lands on the entry too —
         it is one of the names the peer is known by (bill-to
         matching reads the entry), and his display name becoming
         his person must not cost the books his company. */
      if (peer.person && found.person !== peer.person) { found.person = peer.person; changed = true; }
      if (peer.business && found.business !== peer.business) { found.business = peer.business; changed = true; }
      /* v148: the KIND (and a one-time pair's day) rides the same
         refresh under the same discipline — only a valid kind
         lands, so a pre-v148 snapshot never invents or erases
         one; an entry formed before kinds existed gains no kind
         key at all and reads as 'all' (CL.kindOf). */
      if (CL.isKind(peer.kind) && found.kind !== peer.kind) { found.kind = peer.kind; changed = true; }
      if (peer.onceDate && found.onceDate !== peer.onceDate) { found.onceDate = peer.onceDate; changed = true; }
      /* v176 (L1/L2): the ticked module list rides the same
         refresh — only a valid non-empty sanitized list lands, so
         a pre-v176 snapshot never invents or erases one. */
      var pm = CL.sanitizeModules(peer.modules);
      if (pm && pm.length && JSON.stringify(found.modules || null) !== JSON.stringify(pm)) { found.modules = pm; changed = true; }
      if (!found.viaConnect) { found.viaConnect = true; changed = true; }
    } else {
      var entry = {
        id: 'u' + peer.uid,
        name: peer.name || 'Meticulous user',
        role: peer.role || '',
        face: isFace(peer.face) ? peer.face : '',
        person: peer.person || '',
        business: peer.business || '',
        contact: '',
        uid: peer.uid,
        status: status,
        viaConnect: true
      };
      if (CL.isKind(peer.kind)) entry.kind = peer.kind;
      if (peer.onceDate) entry.onceDate = peer.onceDate;
      var em = CL.sanitizeModules(peer.modules);
      if (em && em.length) entry.modules = em;
      list.push(entry);
      changed = true;
    }
    /* v171: every upsert leaves the list deduped by account —
       even when THIS upsert changed nothing, a list that arrived
       dirty (duplicates from an older path) heals on the pass */
    var dd = CL.dedupeConList(list);
    if (dd.length !== list.length) { list = dd; changed = true; }
    if (changed) st.set('con_list', list);
    return changed;
  };

  /* v155 heal: a link formed before faces were published carries
     none, and its request doc is a send-time snapshot besides —
     the peer may have changed his setup since (the payer turned
     office-only AFTER the owner's request snapshot froze him as
     'Driver'). The DIRECTORY is the peer's current word: refresh
     each linked entry's identity (name / type / face) from his
     directory record, at his entry's CURRENT status so a heal
     never moves a link's state. Best-effort — offline or a
     missing record changes nothing — and it only ever touches
     entries already in con_list (upsertConn's con_hidden guard
     still applies), so it creates and resurrects nothing. */
  function healFromDirectory() {
    var f = fb();
    var st = store();
    if (!f || !st) return Promise.resolve(false);
    var list = st.get('con_list', []) || [];
    var jobs = [];
    list.forEach(function (c) {
      if (!c || !c.uid) return;
      jobs.push(f.db.collection('directory').doc(c.uid).get().then(function (snap) {
        if (!snap.exists) return false;
        var v = snap.data() || {};
        return CL.upsertConn(
          { uid: c.uid, name: v.name, role: v.role, face: v.face, person: v.person, business: v.business },
          c.status || 'connected');
      }).catch(function () { return false; }));
    });
    return Promise.all(jobs).then(function (rs) {
      return rs.some(function (x) { return !!x; });
    });
  }

  /* v148: THE ONE-TIME SWEEP. A one-time connection ends itself
     when its day closes — the earlier of (a) the riding dispatch
     completing on the driver's books: a completed dispatch in
     MY list with pipeFrom = that peer, dated the pair's day
     (the pipe's own completion fact, read from the side that
     holds the driver's books), or (b) the day ending: today has
     passed the pair's day, on either side. An end already
     stamped on the doc (by the other side) ends my entry too.
     Ending = the entry's status becomes 'ended' (the row stays,
     removable as today) + endedAt stamped on the pair's accepted
     doc (fire-and-forget; the rules' kind-governance branch
     allows either party), so the other side and the rules shut
     at the same mark. Runs inside reconcile, over the requests
     reconcile just loaded. Resolves true when an entry ended. */
  function recordDateOf(d) {
    if (!d) return '';
    if (typeof d.scheduledAt === 'string') {
      var m = /^(\d{4}-\d{2}-\d{2})/.exec(d.scheduledAt);
      if (m) return m[1];
    }
    return d.date || '';
  }
  function dayClosedFor(peerUid, dateStr) {
    var st = store();
    if (!st || !peerUid || !dateStr) return false;
    return (st.get('dsp_list', []) || []).some(function (d) {
      return d && d.pipeFrom === peerUid && d.status === 'completed' && recordDateOf(d) === dateStr;
    });
  }
  CL.sweepOnce = function (r) {
    var st = store(), f = fb();
    if (!st || !f || !r) return false;
    var me = f.user.uid, today = todayStr();
    var docs = [];
    (r.outgoing || []).forEach(function (q) { if (q && q.status === 'accepted' && q.kind === 'once') docs.push(q); });
    (r.incoming || []).forEach(function (q) { if (q && q.status === 'accepted' && q.kind === 'once') docs.push(q); });
    if (!docs.length) return false;
    var list = st.get('con_list', []) || [];
    var changed = false;
    docs.forEach(function (q) {
      var peer = q.from === me ? q.to : q.from;
      var entry = null;
      list.forEach(function (c) { if (c && c.uid === peer) entry = c; });
      if (!entry || entry.status !== 'connected') return;
      var od = q.onceDate || (q.createdAt ? dateOfMs(q.createdAt) : '');
      var ended = (q.endedAt || 0) > 0 || (!!od && today > od) || dayClosedFor(peer, od);
      if (!ended) return;
      entry.status = 'ended';
      changed = true;
      if (!((q.endedAt || 0) > 0)) {
        try {
          f.db.collection('requests').doc(q.id)
            .update({ endedAt: Date.now(), updatedAt: Date.now() })
            .catch(function () {});
        } catch (e) {}
      }
    });
    if (changed) st.set('con_list', list);
    return changed;
  };

  /* v148: CHANGE A CONNECTION'S KIND from its row (either side).
     My entry re-stamps at once; the pair's accepted request
     doc(s) carry the new kind to the other side's next reconcile
     (the rules allow either party a kind-only update on an
     accepted doc). The pipe re-governs from the caller's next
     publish (the Connect screen republishes on the change).
     Switching TO one-time stamps the day as given (the row
     passes today; a dispatch sent later re-stamps it to the
     job's day through CL.stampOnceDate). */
  CL.setKind = function (uid, kind, onceDate, modules) {
    var st = store();
    if (!st || !uid || !CL.isKind(kind)) return Promise.resolve(false);
    var list = st.get('con_list', []) || [];
    var entry = null;
    list.forEach(function (c) { if (c && c.uid === uid) entry = c; });
    if (!entry) return Promise.resolve(false);
    entry.kind = kind;
    if (kind === 'once') entry.onceDate = onceDate || entry.onceDate || todayStr();
    /* v176 (L1/L2): a kind change may also carry the new ticked
       list; it lands on my entry and on the pair doc(s). */
    var sm = CL.sanitizeModules(modules);
    if (sm && (kind === 'limited' || kind === 'once')) entry.modules = sm;
    if (kind === 'all' && entry.modules) { delete entry.modules; }
    st.set('con_list', list);
    var f = fb();
    if (!f) return Promise.resolve(true);
    return CL.listMine().then(function (r) {
      var jobs = [];
      [r.outgoing, r.incoming].forEach(function (arr) {
        (arr || []).forEach(function (q) {
          if (!q || q.status !== 'accepted') return;
          var peer = q.from === f.user.uid ? q.to : q.from;
          if (peer !== uid) return;
          var upd = { kind: kind, updatedAt: Date.now() };
          if (kind === 'once') upd.onceDate = entry.onceDate;
          if (sm && (kind === 'limited' || kind === 'once')) upd.modules = sm;
          jobs.push(f.db.collection('requests').doc(q.id).update(upd).catch(function () {}));
        });
      });
      return Promise.all(jobs).then(function () { return true; });
    }).catch(function () { return true; });
  };

  /* v148: a dispatch sent over a one-time connection re-stamps
     the pair's day to the JOB's day (the connection rides in
     with that dispatch). No-op for any other kind. */
  CL.stampOnceDate = function (uid, dateStr) {
    var st = store();
    if (!st || !uid || !dateStr) return Promise.resolve(false);
    var entry = null;
    (st.get('con_list', []) || []).forEach(function (c) { if (c && c.uid === uid) entry = c; });
    if (!entry || entry.kind !== 'once' || entry.onceDate === dateStr) return Promise.resolve(false);
    return CL.setKind(uid, 'once', dateStr);
  };

  /* Brings my con_list in line with my requests: outgoing states
     mirror the request status; accepted incoming pairs land as
     connected. Idempotent; resolves true when anything changed. */
  CL.reconcile = function () {
    if (CL._reconciling) return Promise.resolve(false);
    CL._reconciling = true;
    return CL.listMine().then(function (r) {
      var changed = false;
      /* v148: an accepted doc whose one-time end is already
         stamped (endedAt — by either side's sweep) upserts as
         ENDED, never back to 'connected': the doc's own facts
         govern, and upsert-then-sweep would otherwise flip the
         entry on every reconcile forever. The sweep below still
         ends pairs whose trigger fired but whose stamp has not
         landed yet. */
      var pairStatus = function (q) {
        if (q.status !== 'accepted') return q.status;
        return (q.endedAt || 0) > 0 ? 'ended' : 'connected';
      };
      r.outgoing.forEach(function (q) {
        if (CL.upsertConn({ uid: q.to, name: q.toName, role: q.toRole, face: q.toFace, person: q.toPerson, business: q.toBusiness, kind: q.kind, onceDate: q.onceDate, modules: q.modules }, pairStatus(q))) changed = true;
      });
      r.incoming.forEach(function (q) {
        if (q.status === 'accepted') {
          if (CL.upsertConn({ uid: q.from, name: q.fromName, role: q.fromRole, face: q.fromFace, person: q.fromPerson, business: q.fromBusiness, kind: q.kind, onceDate: q.onceDate, modules: q.modules }, pairStatus(q))) changed = true;
        }
      });
      return healFromDirectory().then(function (healed) {
        var swept = false;
        try { swept = CL.sweepOnce(r); } catch (e) {}
        /* v171: the reconcile heal — a list that arrived with
           duplicate rows for one account (an old build, a cloud
           merge) collapses to one entry per account, persisted. */
        var deduped = false;
        try {
          var st2 = store();
          if (st2) {
            var l2 = st2.get('con_list', []) || [];
            var d2 = CL.dedupeConList(l2);
            if (d2.length !== l2.length) { st2.set('con_list', d2); deduped = true; }
          }
        } catch (e) {}
        CL._reconciling = false;
        return changed || healed || swept || deduped;
      });
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
