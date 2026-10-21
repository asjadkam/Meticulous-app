/* Connect module — Phase 2 slice 1 (v131): finding and connecting
   people is LIVE (js/connectlive.js + the directory/requests
   collections). The screen: Find people (directory search by name
   or business -> tap Connect), Requests (incoming Accept/Decline,
   outgoing states), Current connections (manual entries + linked
   accounts from their own cloud data), History (prepared shares).

   v76 (owner directive Oct 14 19:15 + boss QA F7): TWO cards only —
   (1) Current connections (the list + Add; sharing lives ON the
   connection, via its own picker), (2) History (the outbox, rendered
   as history; queued items are pending). The per-connection Send
   buttons package the ACTUAL content (a dispatch share carries the
   dispatch's fields, and the picker names dispatches by jobSite)
   instead of content-free stubs. No native alert()/confirm() —
   errors and the remove confirm are in-page, like the newer
   modules. Store keys unchanged (con_list/con_outbox); old outbox
   stubs still render in History.

   v131: dispatch/document SHARING across a connection is not live
   yet — the copy says "comes next" wherever that space shows, and
   shares still package locally into History as preparation. What
   IS live: search, requests, accept/decline, and the connection
   itself (con_list entries extended with {uid, status,
   viaConnect} by ConnectLive; manual entries untouched).

   v132: THE PIPE is live (js/connectpipe.js). A dispatch picked
   for a CONNECTED connection is really sent — it lands in their
   Dispatch as their scheduled job, and the History entry is
   marked Sent. A connected driver's DAY also flows up by itself
   (his Dispatch board aggregates it; nothing to send by hand).
   What still prepares locally: documents (damage / manifest /
   location) and anything aimed at a manual connection.
   v146: invoice & manifest SHARING is built too — the driver's
   issued pay invoices and period manifests cross to the payer
   they are billed to, with his fuel (receipts too), expenses
   and maintenance record (js/connectpipe.js, the shared
   records), and his priced pay lands in the payer's P&L as an
   expense. The honesty line under Current connections names
   exactly what crosses.
   v147: PEOPLE, NOT COMPANIES — the directory results, the
   requests and the connection rows headline the PERSON (the
   display name ConnectLive publishes is the man's own name
   when he has given it), with his business as the second
   line; the connection row reads the business off the
   con_list entry itself, which ConnectLive now keeps there.
   A peer with no person name renders exactly as before.
   v148: CONNECTION KINDS — Connect now asks WHAT KIND before
   anything is sent: tapping Connect opens the picker (Connect
   all / Connect limited / One time connection, each with one
   plain line), preselected by role through CL.defaultKindFor
   (a dispatcher pairing preselects Limited). The accept row
   carries the same three kinds preselected to the proposal
   (CL.defaultKindForRequest), changeable at accept; the
   accepted kind governs. Every connection row shows its kind
   ("Full access" for All — the owner's phrase) with a select
   that changes it on the spot; an ended one-time row reads
   ended. The honesty line names the kinds. */
(function () {
  'use strict';
  var S = function (k, d) { return App._store.get('con_' + k, d); };
  var W = function (k, v) { App._store.set('con_' + k, v); };
  var esc = function (s) { return App._esc(s); };

  var TYPE_ICON = { dispatch: '🚚', damage: '📸', manifest: '📋', location: '📍', doc: '📎' };
  var TYPE_LABEL = { dispatch: 'Dispatch', damage: 'Damage photo', manifest: 'Manifest', location: 'Location', doc: 'Document' };
  var DOC_TYPES = ['damage', 'manifest', 'location'];

  /* v171: the list the FACE reads is deduped by account — one
     card per real connection (owner, Oct 18, 2026 21:35 MDT:
     the same person painted twice). Same rule as the data
     layer (ConnectLive.dedupeConList): keyed by uid, strongest
     status survives, uid-less manual entries untouched. Every
     index-based row action resolves through this list, so the
     indices the rows carry always name the card he sees; the
     writes that flow from here (add/delete) persist the
     deduped list, healing the store as a side effect. */
  var CONN_RANK = { connected: 4, pending: 3, declined: 2, ended: 1 };
  function conns() {
    var list = S('list', []) || [];
    var out = [], byUid = {};
    list.forEach(function (c) {
      if (!c || !c.uid) { out.push(c); return; }
      var cur = byUid[c.uid];
      if (!cur) { byUid[c.uid] = c; out.push(c); return; }
      var keep = (CONN_RANK[c.status] || 0) > (CONN_RANK[cur.status] || 0) ? c : cur;
      var drop = (keep === c) ? cur : c;
      ['name', 'role', 'face', 'person', 'business', 'contact', 'kind', 'onceDate'].forEach(function (k) {
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
  }
  function outbox() { return S('outbox', []); }

  /* ---- UI state (this session only — never persisted) ---- */
  var uiAdd = false;        // add-connection form open
  var uiAddErr = '';        // inline error inside the add form
  var uiAddDraft = null;    // {name, contact} kept across a failed save
  var uiPicker = null;      // {conn: index, type: 'dispatch'|DOC_TYPES…}
  var uiConfirmDel = -1;    // connection index awaiting its inline confirm
  var uiFlash = '';         // one-shot note at the top of the connections card
  var uiResults = null;     // last directory search results (v131)
  var uiSearchMsg = '';     // general line under the search box (v131)
  var uiPeerNote = null;    // {uid, name} the results tail is ABOUT (v145)
  var uiReqs = null;        // last requests load {incoming, outgoing} (v131)
  var uiKindPick = null;    // v148: {peer, kind} — the kind picker open under a search result
  var uiKindChoice = {};    // v148: reqId -> kind chosen on an accept row (session only)

  function live() {
    try { return (window.ConnectLive && window.FB && FB.ready && FB.user) ? window.ConnectLive : null; }
    catch (e) { return null; }
  }

  /* ---- v148: CONNECTION KINDS (owner, Oct 17, 2026 21:35–21:36
     MDT). The picker wording is the owner's own: the three kinds,
     each with ONE plain line of what it means. The row label for
     All is his own phrase for the full pairing: "Full access".
     Absent kind = 'all' everywhere (every pre-v148 pair). ---- */
  var KIND_NAMES = { all: 'Connect all', limited: 'Connect limited', once: 'One time connection' };
  var KIND_LINES = {
    all: 'Everything crosses — days, fuel, receipts, maintenance, invoices and manifests.',
    limited: 'Only the modules you tick cross — nothing else. You pick them one by one.',
    once: 'For one job — it ends by itself when that day closes.'
  };
  var KIND_ROW_LABEL = { all: 'Full access', limited: 'Connect limited', once: 'One time connection' };
  function kindOfConn(c) {
    return (c && (c.kind === 'limited' || c.kind === 'once')) ? c.kind : 'all';
  }
  function kindOfReq(q) {
    return (q && (q.kind === 'limited' || q.kind === 'once')) ? q.kind : null;
  }
  function kindOptions(sel) {
    return ['all', 'limited', 'once'].map(function (k) {
      return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + KIND_NAMES[k] + '</option>';
    }).join('');
  }
  function kindToday() {
    try { return App._today(); } catch (e) { return ''; }
  }
  function kindDateOfMs(ms) {
    var d = new Date(ms || 0);
    if (!isFinite(d.getTime())) return '';
    var z = function (n) { return ('0' + n).slice(-2); };
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }

  /* ---- v176: L1/L2 MODULE TICKS (owner, Oct 20, 2026 14:24 MDT).
     Limited is the approver's own pick, module by module — not a
     fixed package. One-Time carries the item list it covers, shown
     to both sides. The vocabulary is ConnectLive.MODULES; the
     fallback list below only serves a paint before the engine
     loads. ---- */
  var MODULE_FALLBACK = [
    { key: 'dispatch', label: 'Dispatches' }, { key: 'manifest', label: 'Manifests' },
    { key: 'fuel', label: 'Fuel' }, { key: 'expenses', label: 'Expenses & receipts' },
    { key: 'maintenance', label: 'Maintenance' }, { key: 'pti', label: 'PTI inspections' },
    { key: 'invoices', label: 'Invoices' }, { key: 'pnl', label: 'P&L money picture' }
  ];
  function moduleList() {
    try { if (window.ConnectLive && ConnectLive.MODULES) return ConnectLive.MODULES; } catch (e) {}
    return MODULE_FALLBACK;
  }
  function modulesOfThing(x) {
    try { if (window.ConnectLive && ConnectLive.modulesOf) return ConnectLive.modulesOf(x); } catch (e) {}
    if (!x || (x.kind !== 'limited' && x.kind !== 'once')) return null;
    return (Array.isArray(x.modules) && x.modules.length) ? x.modules.slice() : ['dispatch', 'manifest'];
  }
  function moduleNames(keys) {
    var labels = {};
    moduleList().forEach(function (m) { labels[m.key] = m.label; });
    return (keys || []).map(function (k) { return labels[k] || k; }).join(', ');
  }
  var uiModPick = null;     // v176: ticks in the send picker (session only)
  var uiModChoice = {};     // v176: reqId -> ticks chosen on an accept row
  function defaultTicks(kind, proposed) {
    if (Array.isArray(proposed) && proposed.length) return proposed.slice();
    return kind === 'once' ? ['dispatch', 'manifest'] : ['dispatch', 'manifest'];
  }
  function moduleTicksHtml(attr, selected) {
    var sel = selected || [];
    var h = '<div style="margin:4px 0 2px"><div class="note" style="font-weight:600">Tick exactly what they can see — nothing else crosses:</div>';
    moduleList().forEach(function (m) {
      h += '<label style="display:block;margin-top:4px"><input type="checkbox" ' + attr + '="' + m.key + '"' +
        (sel.indexOf(m.key) !== -1 ? ' checked' : '') + '> ' + esc(m.label) + '</label>';
    });
    return h + '</div>';
  }
  function readTicks(root, attr) {
    var out = [];
    if (!root) return out;
    root.querySelectorAll('input[' + attr + ']').forEach(function (cb) {
      if (cb.checked) out.push(cb.getAttribute(attr));
    });
    return out;
  }
  function moduleTicksHtmlFor(reqId, selected) {
    var sel = selected || [];
    var h = '<div style="margin:4px 0 2px">';
    moduleList().forEach(function (m) {
      h += '<label style="display:block;margin-top:4px"><input type="checkbox" data-cn-modacc="' + esc(reqId) + '" data-cn-modkey="' + m.key + '"' +
        (sel.indexOf(m.key) !== -1 ? ' checked' : '') + '> ' + esc(m.label) + '</label>';
    });
    return h + '</div>';
  }
  function readTicksFor(root, reqId) {
    var out = [];
    if (!root) return out;
    root.querySelectorAll('input[data-cn-modacc]').forEach(function (cb) {
      if (cb.getAttribute('data-cn-modacc') === reqId && cb.checked) out.push(cb.getAttribute('data-cn-modkey'));
    });
    return out;
  }

  function dispatchName(d) {
    /* v76 (F7): dispatch records carry jobSite — the old picker read
       site/destination/desc, which dispatch records don't carry, so
       every real dispatch listed as a bare "date — Dispatch". */
    return d.jobSite || d.site || d.destination || d.desc || 'Dispatch';
  }

  /* shareable content pulled from other modules; each item carries
     the CONTENT a share packages (packaged locally into the outbox
     item — the same payload cross-account delivery will send when
     sharing ships). */
  function contentItems(type) {
    var out = [];
    if (type === 'dispatch') {
      App._store.get('dsp_list', []).forEach(function (d, i) {
        /* v153: the picker label + packaged date carry the
           record's date truth — scheduledAt's date wins, the
           same derivation the receiving side (below) already
           applies when it lands the record. */
        var dDate = '';
        if (typeof d.scheduledAt === 'string') {
          var dm = /^(\d{4}-\d{2}-\d{2})/.exec(d.scheduledAt);
          if (dm) dDate = dm[1];
        }
        dDate = dDate || d.date || '';
        out.push({
          id: d.id || ('d' + i),
          label: dDate + ' — ' + dispatchName(d),
          content: {
            jobSite: dispatchName(d), date: dDate, scheduledAt: d.scheduledAt || '',
            equipment: d.equipment || '', material: d.material || '',
            ticketNo: d.ticketNo || '', notes: d.notes || ''
          }
        });
      });
    } else if (type === 'damage') {
      App._store.get('dmg_reports', []).forEach(function (d, i) {
        out.push({
          id: d.id || ('g' + i),
          label: (d.date || d.at || '') + ' — ' + (d.title || d.desc || 'Damage report'),
          content: { title: d.title || '', desc: d.desc || '', date: d.date || d.at || '' }
        });
      });
    } else if (type === 'manifest') {
      App._store.get('manifest_feed', []).forEach(function (m, i) {
        out.push({
          id: 'f' + i,
          label: (m.date || m.at || '') + ' — ' + (m.text || 'Manifest entry'),
          content: { text: m.text || '', date: m.date || m.at || '' }
        });
      });
    } else if (type === 'location') {
      var o = App._store.get('onboarding', {});
      out.push({ id: 'base', label: 'Base — ' + (o.baseLocation || 'not set'), content: { base: o.baseLocation || '' } });
      out.push({ id: 'current', label: 'My current location (when shared)', content: { current: true } });
    }
    return out;
  }

  function queueShare(connIdx, type, item) {
    var c = conns()[connIdx];
    if (!c || !item) return false;
    var o = outbox();
    o.push({
      type: type,
      label: (TYPE_LABEL[type] || 'Share') + ' — ' + item.label,
      to: c.name, connId: c.id || '', refId: item.id,
      content: item.content || null,
      ts: Date.now(), note: ''
    });
    return W('outbox', o) !== false;
  }

  /* the history line's content summary (new shares); legacy stubs
     carry no content and simply show no summary */
  function contentSummary(o) {
    var c = o && o.content;
    if (!c) return '';
    if (o.type === 'dispatch') {
      return [c.jobSite, c.scheduledAt ? String(c.scheduledAt).replace('T', ' ') : c.date, c.material]
        .filter(Boolean).join(' · ');
    }
    if (o.type === 'damage') return c.title || c.desc || '';
    if (o.type === 'manifest') return c.text || '';
    if (o.type === 'location') return c.base ? 'Base — ' + c.base : (c.current ? 'Current location' : '');
    return '';
  }

  function fmtTs(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /* ---- v131: live handshake rendering helpers ---- */

  /* the action state for one directory result, from my con_list and
     my requests: connected / sent (outgoing pending) / incoming
     (they already asked me) / declined / none */
  function peerState(uid) {
    var st = 'none';
    conns().forEach(function (c) { if (c && c.uid === uid && c.status === 'connected') st = 'connected'; });
    if (st === 'connected' || !uiReqs) return st;
    uiReqs.outgoing.forEach(function (q) {
      if (q.to === uid) { if (q.status === 'pending') st = 'sent'; else if (q.status === 'declined' && st === 'none') st = 'declined'; }
    });
    uiReqs.incoming.forEach(function (q) {
      if (q.from === uid && q.status === 'pending') st = 'incoming';
    });
    return st;
  }

  /* CN-NOTE-BEGIN — v145: the line under the search results is a
     claim about ONE person's state, so it is DERIVED from that
     state at paint time, never stored as a sentence. The stored
     version kept printing "Request sent to X — they accept it in
     their Connect screen" under a card that already read
     "✓ Connected" (owner's recording, Oct 17 21:10 MDT): the
     button had moved on, the sentence had not. Same rule as the
     buttons above it — state in, copy out:
       connected -> the connected truth
       sent      -> the request is out, they accept on their side
       incoming  -> they asked too; the answer lives in Requests
       anything else -> silence (no claim the state can't back) */
  function cnStateNote(st, name) {
    if (st === 'sent') return 'Request sent to ' + name + ' — they accept it in their Connect screen.';
    if (st === 'connected') return '✓ Connected to ' + name + ' — you are linked.';
    if (st === 'incoming') return name + ' asked you too — answer in Requests below.';
    return '';
  }
  /* CN-NOTE-END */

  /* the tail under the results: a live peer note (derived through
     cnStateNote from the peer's CURRENT state) outranks the
     general line; the general line (search errors, hints) shows
     only while no peer note is live. */
  function resultsTail() {
    var tail = '';
    if (uiPeerNote) tail = cnStateNote(peerState(uiPeerNote.uid), uiPeerNote.name);
    else if (uiSearchMsg) tail = uiSearchMsg;
    return tail ? '<p class="note" style="margin-top:6px">' + esc(tail) + '</p>' : '';
  }

  /* v148: the kind picker — opens under the results when Connect
     is tapped, BEFORE anything is sent: the three kinds in the
     owner's words, the role default preselected (a dispatcher
     pairing preselects Limited — CL.defaultKindFor; a payer
     pairing preselects All), the chosen kind's one plain line,
     and the send that carries the choice. */
  function kindPickHtml() {
    if (!uiKindPick) return '';
    var p = uiKindPick.peer;
    var h = '<div style="border-top:1px solid #e3e3e3;margin-top:10px;padding-top:8px">' +
      '<div style="font-weight:700;margin-bottom:2px">🤝 Connect to ' + esc(p.name) + ' — what kind of connection?</div>';
    ['all', 'limited', 'once'].forEach(function (k) {
      var sel = uiKindPick.kind === k;
      h += '<button class="btn ' + (sel ? 'primary' : 'ghost') + ' small" data-cn-kind-opt="' + k + '" style="display:block;width:100%;text-align:left;margin-top:6px">' +
        (sel ? '● ' : '○ ') + KIND_NAMES[k] + '</button>' +
        '<p class="note" style="margin:2px 0 0 4px' + (sel ? ';font-weight:600' : ';color:#999') + '">' + esc(KIND_LINES[k]) + '</p>';
    });
    /* v176 (L1/L2): Limited and One-Time carry a tick list —
       Limited: the modules you are offering; One-Time: the items
       this one-time access is for. Both sides see the same list. */
    if (uiKindPick.kind === 'limited' || uiKindPick.kind === 'once') {
      if (!uiModPick) uiModPick = defaultTicks(uiKindPick.kind, null);
      h += '<p class="note" style="margin:6px 0 0 4px;font-weight:600">' +
        (uiKindPick.kind === 'limited' ? 'They will see only what you tick:' : 'This one-time connection is for:') + '</p>' +
        moduleTicksHtml('data-cn-modpick', uiModPick);
    }
    h += '<div class="row" style="margin-top:8px">' +
      '<button class="btn ghost small" id="cn_kind_cancel">Cancel</button>' +
      '<button class="btn primary small" id="cn_kind_send">Send request</button></div></div>';
    return h;
  }

  function resultsHtml() {
    if (uiResults === null) return uiSearchMsg ? '<p class="note" style="margin-top:8px">' + esc(uiSearchMsg) + '</p>' : '';
    if (!uiResults.length) return '<p class="note" style="margin-top:8px">Nobody found by that name yet. Check the spelling — or they may not be on Meticulous yet.</p>';
    return uiResults.map(function (p, i) {
      var st = peerState(p.uid);
      var btn = st === 'connected' ? '<button class="btn small ghost" disabled>✓ Connected</button>'
        : st === 'sent' ? '<button class="btn small ghost" disabled>Request sent ✓</button>'
        : st === 'incoming' ? '<button class="btn small ghost" disabled>Asked you — answer below ↓</button>'
        : '<button class="btn small primary" data-cn-connect="' + i + '">🤝 Connect</button>';
      return '<div class="listitem"><div class="a">' + esc(p.name) + '</div>' +
        '<div class="b">' + esc(p.role || '') + (p.business && p.business !== p.name ? ' · ' + esc(p.business) : '') + '</div>' +
        '<div class="row" style="margin-top:8px">' + btn + '</div></div>';
    }).join('') + resultsTail() + kindPickHtml();
  }

  function requestsHtml() {
    if (!live()) return '<p class="note">Sign in to see your requests.</p>';
    if (!uiReqs) return '<p class="note">Loading…</p>';
    var inc = uiReqs.incoming.filter(function (q) { return q.status === 'pending'; });
    var out = uiReqs.outgoing;
    if (!inc.length && !out.length) return '<div class="empty">No requests right now. Find your people above and tap Connect.</div>';
    var h = '';
    var CLr = live();
    inc.forEach(function (q) {
      /* v148: the kind rides the accept row — the requester's
         proposal preselected (or, for a kind-less pre-v148
         request, the role default through CL.defaultKindForRequest),
         changeable before Accept; the accepted kind governs. */
      var kSel = uiKindChoice[q.id];
      if (!kSel) {
        try { kSel = CLr && CLr.defaultKindForRequest ? CLr.defaultKindForRequest(q) : (kindOfReq(q) || 'all'); }
        catch (e) { kSel = kindOfReq(q) || 'all'; }
      }
      /* v176 (L2): a one-time request SHOWS the items it is
         asking for, right on the request — both sides see
         exactly what the access covers before anyone accepts. */
      var qMods = modulesOfThing(q);
      var askLine = (kindOfReq(q) === 'once' && qMods)
        ? '<div class="b">Asking for: <b>' + esc(moduleNames(qMods)) + '</b></div>' : '';
      var tickSel = uiModChoice[q.id] || defaultTicks(kSel, q.modules);
      h += '<div class="listitem"><div class="a">' + esc(q.fromName || 'Meticulous user') + '</div>' +
        '<div class="b">' + esc(q.fromRole || '') + (q.fromBusiness && q.fromBusiness !== q.fromName ? ' · ' + esc(q.fromBusiness) : '') +
        ' · wants to connect</div>' + askLine +
        '<label class="f">Kind of connection</label>' +
        '<select data-cn-kindsel="' + esc(q.id) + '">' + kindOptions(kSel) + '</select>' +
        '<p class="note" style="margin:2px 0 6px">' + esc(KIND_LINES[kSel] || '') + '</p>' +
        ((kSel === 'limited' || kSel === 'once')
          ? '<p class="note" style="margin:2px 0 0;font-weight:600">You approve exactly what crosses — tick the modules:</p>' +
            moduleTicksHtmlFor(q.id, tickSel)
          : '') +
        '<div class="row" style="margin-top:8px">' +
        '<button class="btn small primary" data-cn-accept="' + esc(q.id) + '">✓ Accept</button>' +
        '<button class="btn small ghost" data-cn-decline="' + esc(q.id) + '">Decline</button></div></div>';
    });
    out.forEach(function (q) {
      if (q.status === 'accepted') return; // lives in Current connections now
      var qk = kindOfReq(q);
      var line = q.status === 'pending'
        ? '⏳ Waiting for them to accept' + (qk ? ' · ' + KIND_NAMES[qk] : '')
        : 'They declined — you can send the request again any time.';
      h += '<div class="listitem"><div class="a">' + esc(q.toName || 'Meticulous user') + '</div>' +
        '<div class="b">' + esc(line) + '</div>' +
        (q.status === 'declined'
          ? '<div class="row" style="margin-top:8px"><button class="btn small navy" data-cn-resend="' + esc(q.id) + '">Send again</button></div>'
          : '') + '</div>';
    });
    return h || '<div class="empty">No requests right now. Find your people above and tap Connect.</div>';
  }

  Meticulous.modules.connect = {
    /* v78: the card preview — shares WAITING lead (the fact that
       needs the user); the connection count is the quiet fallback.
       v131: an incoming connection request outranks both — it is
       the one thing on this screen that needs the user's tap. */
    status: function () {
      var pin = 0;
      try { pin = (window.ConnectLive && window.ConnectLive.pendingIn) || 0; } catch (e) {}
      var q = outbox().filter(function (o) { return !o.sent; }).length, n = conns().length;
      var cs = n + ' connection' + (n === 1 ? '' : 's');
      if (pin) return pin + ' request' + (pin === 1 ? '' : 's') + ' waiting' + (n ? ' · ' + cs : '');
      if (q) return q + ' waiting to send' + (n ? ' · ' + cs : '');
      return n ? cs : 'No connections yet';
    },
    render: function (body) {
      var list = conns(), ob = outbox();
      var CL = live();

      /* ============ CARD 0: Find people (v131, LIVE) ============ */
      var h = '<div class="card"><h3>🔎 Find people</h3>';
      if (CL) {
        h += '<div class="row"><div style="flex:1"><label class="f">Name or business</label>' +
          '<input id="cn_q" placeholder="e.g. a person or business"></div>' +
          '<button class="btn primary" id="cn_search" style="align-self:flex-end">Search</button></div>' +
          '<div id="cn_results">' + resultsHtml() + '</div>';
      } else {
        h += '<p class="note" style="margin-top:0">Sign in to find people and connect — search runs on your account, not on this device alone.</p>';
      }
      h += '</div>';

      /* ============ CARD: Requests (v131, LIVE) ============ */
      h += '<div class="card"><h3>🤝 Requests</h3><div id="cn_req_wrap">' + requestsHtml() + '</div></div>';

      /* ============ CARD 1: Current connections ============ */
      h += '<div class="card"><h3>👥 Current connections (' + list.length + ')</h3>' +
        /* the sharing honesty: ONE quiet line, not a banner card.
           v132: dispatches flow both ways across a live connection
           (the pipe) and a connected driver's day lands on the
           boss's Dispatch board by itself. v146 (owner, Oct 17
           21:25–21:33 MDT): the driver's fuel (receipts too), his
           expenses, his maintenance record, and his pay invoices
           & manifests for the periods billed to that payer now
           cross too, and his pay lands in the payer's P&L as an
           expense — the line below says exactly that, derived
           from what the pipe actually publishes. */
        '<p class="note" style="margin-top:0">Dispatches flow both ways with connected drivers — a driver\u2019s day lands on your Dispatch board by itself. A connected driver also shares his fuel (receipts too), his expenses, his truck maintenance, and his pay invoices &amp; manifests for the periods billed to you — and his pay lands in the payer\u2019s P&amp;L as an expense. Rates never cross either way. Every connection also has a kind — Connect all, Connect limited, or One time — and the kind decides what crosses; it shows on the connection below. Documents you prepare by hand still wait in History below.</p>';
      if (uiFlash) h += '<p class="note" style="color:#2e7d32;font-weight:600">' + esc(uiFlash) + '</p>';
      if (!list.length) {
        h += '<div class="empty">No connections yet.<br>Add your dispatcher, manager, or family below.</div>';
      } else {
        list.forEach(function (c, i) {
          var linked = !!c.uid;
          var shareable = !linked || c.status === 'connected';
          h += '<div class="listitem"><div class="a">' + esc(c.name) + '</div>' +
            '<div class="b">' + esc(c.role || '') +
            /* v147: the person headlines; his business rides the
               second line (manual entries carry no business —
               rendered exactly as before). */
            (c.business && c.business !== c.name ? ' · ' + esc(c.business) : '') +
            (c.contact ? ' · ' + esc(c.contact) : '') + '</div>' +
            (linked && c.status === 'connected' ? '<div class="b" style="color:#2e7d32;font-weight:600">🤝 Connected</div>' : '') +
            (linked && c.status === 'pending' ? '<div class="b">⏳ Request sent — waiting for them to accept</div>' : '') +
            (linked && c.status === 'declined' ? '<div class="b">Request declined</div>' : '') +
            /* v148: the KIND shows on every linked row, in plain
               words (All reads "Full access" — the owner's own
               phrase). On a live connection either side can
               change it right here: the change re-stamps the
               pair (CL.setKind) and re-governs from that
               moment. An ended one-time row reads ended, with
               its day; it is removed like any row. */
            (linked && c.status === 'connected'
              ? '<div class="b">Kind: <b>' + esc(KIND_ROW_LABEL[kindOfConn(c)]) + '</b>' +
                (kindOfConn(c) === 'once' && c.onceDate ? ' — for ' + esc(c.onceDate) + '; ends when that day closes' : '') + '</div>' +
                /* v176 (L1/L2): the ticked list shows on the row —
                   what this connection can see, at a glance. */
                ((kindOfConn(c) === 'limited' || kindOfConn(c) === 'once') && modulesOfThing(c)
                  ? '<div class="b">Can see: <b>' + esc(moduleNames(modulesOfThing(c))) + '</b></div>' : '') +
                '<div class="row" style="margin-top:4px"><select data-cn-kindchg="' + i + '" aria-label="Connection kind">' + kindOptions(kindOfConn(c)) + '</select></div>'
              : '') +
            (linked && c.status === 'ended'
              ? '<div class="b" style="color:#888">One time connection — ended' + (c.onceDate ? ' · ' + esc(c.onceDate) : '') + '</div>'
              : '') +
            (shareable
              ? '<div class="row" style="margin-top:8px">' +
                '<button class="btn small navy" data-quick="dispatch" data-i="' + i + '">📋 Send dispatch</button>' +
                '<button class="btn small navy" data-quick="doc" data-i="' + i + '">📎 Send doc</button></div>'
              : '');
          /* the share picker lives ON the connection (v76) */
          if (uiPicker && uiPicker.conn === i) {
            var isDsp = uiPicker.type === 'dispatch';
            h += '<div style="border-top:1px solid #e3e3e3;margin-top:10px;padding-top:8px">' +
              '<div style="font-weight:700;margin-bottom:6px">' + (isDsp ? '📋 Send a dispatch to ' : '📎 Send a document to ') + esc(c.name) + '</div>';
            if (!isDsp) {
              h += '<label class="f">Kind</label><select id="cn_ptype">' +
                DOC_TYPES.map(function (t) {
                  return '<option value="' + t + '"' + (uiPicker.type === t ? ' selected' : '') + '>' + TYPE_ICON[t] + ' ' + TYPE_LABEL[t] + '</option>';
                }).join('') + '</select>';
            }
            var items = contentItems(uiPicker.type);
            if (!items.length) {
              h += '<p class="note" style="margin:8px 0">No ' + esc((TYPE_LABEL[uiPicker.type] || 'items').toLowerCase()) +
                's saved yet — create one in its module first.</p>';
            } else {
              h += items.map(function (it, ii) {
                return '<button class="btn ghost small" data-pick="' + ii + '" style="display:block;width:100%;text-align:left;margin-top:6px">' +
                  (TYPE_ICON[uiPicker.type] || '📦') + ' ' + esc(it.label) + '</button>';
              }).join('');
            }
            h += '<button class="btn ghost small" id="cn_pcancel" style="margin-top:8px">Cancel</button></div>';
          }
          /* remove: in-page two-step confirm, never a native dialog */
          if (uiConfirmDel === i) {
            h += '<div style="margin-top:8px"><span style="font-size:13px">Remove ' + esc(c.name) + '?</span> ' +
              '<button class="btn small" data-condel-yes="' + i + '" style="background:#d23b3b;color:#fff">Yes, remove</button> ' +
              '<button class="btn small ghost" id="cn_del_no">Keep</button></div>';
          } else {
            h += '<div style="margin-top:6px"><a href="#" data-condel="' + i + '" style="color:#d23b3b;font-size:13px">Remove</a></div>';
          }
          h += '</div>';
        });
      }
      if (uiAdd) {
        var dr = uiAddDraft || {};
        h += '<label class="f">Name</label><input id="cn_name" placeholder="e.g. Dispatcher Mike" value="' + esc(dr.name || '') + '">' +
          '<div class="row"><div><label class="f">Role</label><select id="cn_role">' +
          ['Dispatcher', 'Fleet manager', 'Driver', 'Family', 'Mechanic', 'Other'].map(function (r) {
            return '<option>' + r + '</option>';
          }).join('') + '</select></div>' +
          '<div><label class="f">Phone / email</label><input id="cn_contact" placeholder="Optional" value="' + esc(dr.contact || '') + '"></div></div>' +
          (uiAddErr ? '<p class="note" id="cn_err" style="color:#c0392b;font-weight:600;margin-top:6px">' + esc(uiAddErr) + '</p>' : '') +
          '<div class="row"><button class="btn ghost small" id="cn_cancel">Cancel</button>' +
          '<button class="btn primary small" id="cn_save">Save connection</button></div>';
      } else {
        h += '<button class="btn navy small" id="cn_add">+ Add connection</button>';
      }
      h += '</div>';

      /* ============ CARD 2: History ============ */
      h += '<div class="card"><h3>🕘 History (' + ob.length + ')</h3>';
      if (!ob.length) {
        h += '<div class="empty">Nothing shared yet. Send a dispatch or a document from a connection above.</div>';
      } else {
        ob.slice().reverse().forEach(function (o, ri) {
          var i = ob.length - 1 - ri;
          var sum = contentSummary(o);
          h += '<div class="listitem"><div class="a">' + (TYPE_ICON[o.type] || '📦') + ' ' + esc(o.label || TYPE_LABEL[o.type] || o.kind || 'Share') +
            (o.sent
              ? ' <span class="pill" style="background:#e6f4ea;color:#1e7d32">Sent ✓</span></div>'
              : ' <span class="pill">Queued — on this device</span></div>') +
            '<div class="b">To: ' + esc(o.to || '') + ' · ' + esc(fmtTs(o.ts)) +
            (sum ? '<br>' + esc(sum) : '') +
            (o.note ? '<br>“' + esc(o.note) + '”' : '') + '</div>' +
            '<div style="margin-top:6px"><a href="#" data-obdel="' + i + '" style="color:#d23b3b;font-size:13px">Remove</a></div></div>';
        });
      }
      h += '</div>';

      body.innerHTML = h;
      uiFlash = ''; // one-shot

      /* ---- wiring ---- */
      var rerender = function () { Meticulous.modules.connect.render(body); };
      var addBtn = body.querySelector('#cn_add');
      if (addBtn) addBtn.onclick = function () { uiAdd = true; uiAddErr = ''; rerender(); };
      var cancelBtn = body.querySelector('#cn_cancel');
      if (cancelBtn) cancelBtn.onclick = function () { uiAdd = false; uiAddErr = ''; uiAddDraft = null; rerender(); };
      var saveBtn = body.querySelector('#cn_save');
      if (saveBtn) saveBtn.onclick = function () {
        var name = body.querySelector('#cn_name').value.trim();
        var contact = body.querySelector('#cn_contact').value.trim();
        uiAddDraft = { name: name, contact: contact };
        if (!name) { uiAddErr = 'Enter a name first.'; rerender(); return; }
        var l = conns();
        l.push({ id: 'c' + Date.now(), name: name, role: body.querySelector('#cn_role').value, contact: contact });
        W('list', l);
        uiAdd = false; uiAddErr = ''; uiAddDraft = null;
        uiFlash = name + ' added to your connections.';
        rerender();
      };
      body.querySelectorAll('[data-condel]').forEach(function (a) {
        a.onclick = function (e) {
          e.preventDefault();
          uiConfirmDel = +a.getAttribute('data-condel');
          uiPicker = null;
          rerender();
        };
      });
      body.querySelectorAll('[data-condel-yes]').forEach(function (a) {
        a.onclick = function () {
          var l = conns();
          var gone = l.splice(+a.getAttribute('data-condel-yes'), 1)[0];
          W('list', l);
          /* v131: a removed LINKED connection stays removed — the
             uid is remembered locally (con_hidden) so reconcile
             never resurrects it from the accepted request. */
          if (gone && gone.uid) {
            var hid = App._store.get('con_hidden', []) || [];
            if (hid.indexOf(gone.uid) === -1) { hid.push(gone.uid); App._store.set('con_hidden', hid); }
          }
          uiConfirmDel = -1;
          rerender();
        };
      });
      var delNo = body.querySelector('#cn_del_no');
      if (delNo) delNo.onclick = function () { uiConfirmDel = -1; rerender(); };

      /* v148: change a connection's kind from its own row — the
         entry re-stamps at once, the pair doc carries it to the
         other side (CL.setKind), and the pipe republishes so the
         new kind governs from this moment. */
      body.querySelectorAll('[data-cn-kindchg]').forEach(function (sel) {
        sel.onchange = function () {
          var c = conns()[+sel.getAttribute('data-cn-kindchg')];
          var CLc = live();
          if (!c || !c.uid || !CLc || !CLc.setKind) return;
          var v = sel.value;
          CLc.setKind(c.uid, v, v === 'once' ? kindToday() : undefined).then(function () {
            try { if (window.ConnectPipe && ConnectPipe.publishAll) ConnectPipe.publishAll(); } catch (e) {}
            uiFlash = 'Kind changed for ' + c.name + ' — ' + KIND_NAMES[v] + '.';
            rerender();
          });
        };
      });

      /* per-connection share buttons open that connection's picker */
      body.querySelectorAll('[data-quick]').forEach(function (b) {
        b.onclick = function () {
          var i = +b.getAttribute('data-i');
          var t = b.getAttribute('data-quick');
          uiPicker = (uiPicker && uiPicker.conn === i && ((t === 'dispatch') === (uiPicker.type === 'dispatch')))
            ? null
            : { conn: i, type: t === 'dispatch' ? 'dispatch' : 'damage' };
          uiConfirmDel = -1;
          rerender();
        };
      });
      var pType = body.querySelector('#cn_ptype');
      if (pType) pType.onchange = function () {
        if (uiPicker) uiPicker.type = pType.value;
        rerender();
      };
      body.querySelectorAll('[data-pick]').forEach(function (b) {
        b.onclick = function () {
          if (!uiPicker) return;
          var items = contentItems(uiPicker.type);
          var item = items[+b.getAttribute('data-pick')];
          var c = conns()[uiPicker.conn];
          /* v132: a DISPATCH picked for a CONNECTED connection is
             really sent down the pipe — it lands in their Dispatch
             as their scheduled job for that day, and the History
             entry is marked Sent. Documents, and anything aimed
             at a manual (unlinked) connection, still prepare
             locally in History, exactly as before. */
          if (item && c && uiPicker.type === 'dispatch' && c.uid && c.status === 'connected' &&
              window.ConnectPipe) {
            var content = item.content || {};
            var connName = c.name, connId = c.id || '';
            uiPicker = null;
            ConnectPipe.sendDispatch(c.uid, {
              date: String(content.scheduledAt || content.date || '').slice(0, 10),
              scheduledAt: content.scheduledAt || '',
              jobSite: content.jobSite || '',
              material: content.material || '', equipment: content.equipment || '',
              notes: content.notes || ''
            }).then(function (r) {
              if (r === 'sent') {
                var o = outbox();
                o.push({
                  type: 'dispatch', label: 'Dispatch — ' + item.label,
                  to: connName, connId: connId, refId: item.id,
                  content: item.content || null, ts: Date.now(), note: '', sent: true
                });
                W('outbox', o);
                uiFlash = 'Dispatch sent to ' + connName + ' ✓ — it lands in their Dispatch.';
              } else {
                uiFlash = 'Could not send that dispatch — check your connection and try again. Nothing was sent.';
              }
              rerender();
            });
            return;
          }
          if (item && c && queueShare(uiPicker.conn, uiPicker.type, item)) {
            uiFlash = (TYPE_LABEL[uiPicker.type] || 'Share') + ' queued for ' + c.name + ' — it waits in History below.';
          }
          uiPicker = null;
          rerender();
        };
      });
      var pCancel = body.querySelector('#cn_pcancel');
      if (pCancel) pCancel.onclick = function () { uiPicker = null; rerender(); };

      body.querySelectorAll('[data-obdel]').forEach(function (a) {
        a.onclick = function (e) {
          e.preventDefault();
          var o = outbox(); o.splice(+a.getAttribute('data-obdel'), 1); W('outbox', o);
          rerender();
        };
      });

      /* ---- v131: live handshake wiring ---- */
      var paintResults = function () {
        var w = body.querySelector('#cn_results');
        if (w) w.innerHTML = resultsHtml();
        wireResults();
      };
      var paintRequests = function () {
        var w = body.querySelector('#cn_req_wrap');
        if (w) w.innerHTML = requestsHtml();
        wireRequests();
      };
      function wireResults() {
        body.querySelectorAll('[data-cn-connect]').forEach(function (b) {
          b.onclick = function () {
            if (!CL || !uiResults) return;
            var p = uiResults[+b.getAttribute('data-cn-connect')];
            if (!p) return;
            /* v148: Connect opens the KIND PICKER first — nothing
               is sent until the kind is chosen (the role default
               preselected through CL.defaultKindFor). */
            var dk = 'all';
            try { dk = CL.defaultKindFor ? CL.defaultKindFor(p) : 'all'; } catch (e) {}
            uiKindPick = { peer: p, kind: dk };
            paintResults();
          };
        });
        body.querySelectorAll('[data-cn-kind-opt]').forEach(function (ob) {
          ob.onclick = function () {
            if (!uiKindPick) return;
            uiKindPick.kind = ob.getAttribute('data-cn-kind-opt');
            uiModPick = null; // v176: ticks re-seed for the new kind
            paintResults();
          };
        });
        body.querySelectorAll('input[data-cn-modpick]').forEach(function (cb) {
          cb.onchange = function () { uiModPick = readTicks(body, 'data-cn-modpick'); };
        });
        var kSend = body.querySelector('#cn_kind_send');
        if (kSend) kSend.onclick = function () {
          if (!CL || !uiKindPick) return;
          var p = uiKindPick.peer, k = uiKindPick.kind;
          var mods = (k === 'limited' || k === 'once') ? readTicks(body, 'data-cn-modpick') : undefined;
          if ((k === 'limited' || k === 'once') && !mods.length) mods = defaultTicks(k, null);
          uiKindPick = null; uiModPick = null;
          kSend.disabled = true;
          CL.sendRequest(p, k, k === 'once' ? kindToday() : undefined, mods).then(function (r) {
            /* v145: the outcome is bound to THIS peer (uiPeerNote)
               and re-derived from his live state at every paint
               through cnStateNote — the old code stored the
               sentence itself, and it outlived the state it
               described (the stale-helper recording). A failed
               send stays a general line: it claims nothing about
               the peer's state. */
            if (r === 'sent' || r === 'connected') { uiPeerNote = { uid: p.uid, name: p.name }; uiSearchMsg = ''; }
            else { uiPeerNote = null; uiSearchMsg = 'Could not send the request — check your connection and try again.'; }
            CL.listMine().then(function (res) { uiReqs = res; paintResults(); paintRequests(); CL.reconcile(); });
          });
        };
        var kCancel = body.querySelector('#cn_kind_cancel');
        if (kCancel) kCancel.onclick = function () { uiKindPick = null; paintResults(); };
      }
      function wireRequests() {
        /* v148: the accept row's kind select — the choice is
           remembered for the row (and the meaning line repaints
           with it) until Accept carries it. */
        body.querySelectorAll('[data-cn-kindsel]').forEach(function (sel) {
          sel.onchange = function () {
            uiKindChoice[sel.getAttribute('data-cn-kindsel')] = sel.value;
            paintRequests();
          };
        });
        body.querySelectorAll('[data-cn-accept]').forEach(function (b) {
          b.onclick = function () {
            if (!CL || !uiReqs) return;
            var q = null;
            uiReqs.incoming.forEach(function (x) { if (x.id === b.getAttribute('data-cn-accept')) q = x; });
            if (!q) return;
            b.disabled = true;
            /* v148: accept stamps the kind chosen on the row
               (preselected to the proposal / role default) —
               the accepted kind governs both sides. A one-time
               accept is for the day the request was made. */
            var ak = uiKindChoice[q.id];
            if (!ak) {
              try { ak = CL.defaultKindForRequest ? CL.defaultKindForRequest(q) : (kindOfReq(q) || 'all'); }
              catch (e) { ak = kindOfReq(q) || 'all'; }
            }
            /* v176 (L1/L2): the approver's ticks on THIS row are
               what crosses — read them at Accept, never the
               requester's proposal alone. */
            var amods = (ak === 'limited' || ak === 'once') ? readTicksFor(body, q.id) : undefined;
            if ((ak === 'limited' || ak === 'once') && amods && !amods.length) amods = defaultTicks(ak, q.modules);
            CL.respond(q, true, ak, ak === 'once' ? (q.onceDate || kindDateOfMs(q.createdAt) || kindToday()) : undefined, amods).then(function () {
              delete uiKindChoice[q.id]; delete uiModChoice[q.id];
              uiFlash = 'Connected to ' + (q.fromName || 'them') + '.';
              refreshLive(true);
            });
          };
        });
        body.querySelectorAll('[data-cn-decline]').forEach(function (b) {
          b.onclick = function () {
            if (!CL || !uiReqs) return;
            var q = null;
            uiReqs.incoming.forEach(function (x) { if (x.id === b.getAttribute('data-cn-decline')) q = x; });
            if (!q) return;
            b.disabled = true;
            CL.respond(q, false).then(function () { refreshLive(true); });
          };
        });
        body.querySelectorAll('[data-cn-resend]').forEach(function (b) {
          b.onclick = function () {
            if (!CL || !uiReqs) return;
            var q = null;
            uiReqs.outgoing.forEach(function (x) { if (x.id === b.getAttribute('data-cn-resend')) q = x; });
            if (!q) return;
            b.disabled = true;
            /* v148: a re-send carries the kind the request was
               made with — the proposal survives the decline. */
            CL.sendRequest({ uid: q.to, name: q.toName, business: q.toBusiness, role: q.toRole, face: q.toFace, person: q.toPerson || '' }, q.kind, q.onceDate).then(function () { refreshLive(true); });
          };
        });
      }
      /* Reloads requests from the cloud, paints them, then lets
         reconcile land any newly-accepted pairs in con_list (one
         re-render if it changed anything). */
      function refreshLive(rerenderAfter) {
        if (!CL) return;
        CL.listMine().then(function (res) {
          uiReqs = res;
          paintRequests();
          if (uiResults !== null) paintResults();
          return CL.reconcile();
        }).then(function (changed) {
          /* v132: a fresh link changes who my days publish to —
             republish right away so the pipe starts flowing from
             this moment, not the next app start. */
          try { if (window.ConnectPipe) { if (ConnectPipe.publishAll) ConnectPipe.publishAll(); else ConnectPipe.publishRecent(); } } catch (e) {}
          if (changed && rerenderAfter) rerender();
        }).catch(function () {});
      }
      var searchBtn = body.querySelector('#cn_search');
      var runSearch = function () {
        if (!CL) return;
        var qEl = body.querySelector('#cn_q');
        var q = qEl ? qEl.value.trim() : '';
        uiPeerNote = null; // v145: a new search retires the old peer's note
        uiKindPick = null; // v148: and any open kind picker
        if (!q) { uiResults = null; uiSearchMsg = 'Type a name or business first.'; paintResults(); return; }
        uiSearchMsg = 'Searching…'; paintResults();
        CL.search(q).then(function (res) {
          uiResults = res; uiSearchMsg = '';
          paintResults();
        });
      };
      if (searchBtn) searchBtn.onclick = runSearch;
      var qInput = body.querySelector('#cn_q');
      if (qInput) qInput.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } };
      wireResults();
      wireRequests();
      if (CL) {
        /* self-heal on every visit: my directory record is current
           (so I stay findable) and my connections reflect reality. */
        try { CL.publishMine(); } catch (e) {}
        refreshLive(true);
        /* arrived via P&L's "Connect a driver" door: land on the
           search box, ready to type. */
        try {
          if (window.__mtConnectSearch) {
            window.__mtConnectSearch = false;
            if (qInput) { qInput.focus(); try { qInput.scrollIntoView(); } catch (e2) {} }
          }
        } catch (e) {}
      }
    }
  };
})();
