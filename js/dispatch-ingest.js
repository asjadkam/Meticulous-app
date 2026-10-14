/* Meticulous — Dispatch INGESTION (v65).
   Owner direction (Oct 14, 2026): dispatches should arrive from the
   driver's messages instead of being retyped. They come from MANY
   different senders across text / email / WhatsApp, so the system is
   SENDER-AGNOSTIC and CONTENT-JUDGED: any text, from anyone, is asked
   one question — "does this read like a dispatch?" — by the same
   v57 dispatch-phrasing engine that reads dispatch screenshots
   (TicketOCR.parseDispatch, 27/27 on tools/corpus/phrasing.json).

   Product rules (owner's, non-negotiable):
   - A matching message becomes a DRAFT SUGGESTION only (synced key
     dsp_suggest). It is NEVER a saved dispatch, and suggestions live
     in their own key that the v53 auto-start engine never reads —
     a suggestion can never start a shift (see
     tools/dispatch-ingest-test.js, which proves both statically and
     by driving the real engine).
   - One-tap human confirm: "Use" loads the suggestion into the normal
     dispatch form THROUGH the v48 draft machinery (dsp_draft), where
     the usual verified Save is the only thing that creates a record;
     "Dismiss" deletes the suggestion. Nothing else mutates.
   - Chit-chat produces NOTHING: a text becomes a suggestion only if
     the content scores as dispatch-shaped (see shapeScore below).

   Intake doors in this build: PASTE (Dispatch module box) and SHARE
   (Web Share Target — assets/manifest.json share_target lands on
   /?share=1&text=… and captureShare() below stashes it for the
   Dispatch module's drain). GMAIL auto-scan (stage 2) and ANDROID
   NOTIFICATION capture (stage 3) are designed but NOT built here —
   see the v65 ship report for exactly what they need. Suggestions
   created by those doors later will carry source 'gmail' /
   'notification' through this same intake().

   Learning hook (groundwork only): when a suggestion is Used, its
   source + any sender hint the raw text carried are remembered in
   the synced key dsp_suggest_stats. Nothing reads it yet.
*/
(function () {
  'use strict';

  var SUGGEST_KEY = 'dsp_suggest';
  var STATS_KEY = 'dsp_suggest_stats';
  var INBOX_KEY = 'dsp_share_inbox';
  var DRAFT_KEY = 'dsp_draft';

  function store() {
    try { return (window.App && App._store) || null; } catch (e) { return null; }
  }
  function uid() {
    return 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  /* ---------------- sender hint ----------------
     Best-effort, display/stats only — never a filter (sender-agnostic
     by design). Recognises a WhatsApp chat-export header
     ("[10/14/26, 8:01 AM] Saleem: …"), an email "From:" line, and a
     trailing "- Name" signature line. */
  function senderHint(text) {
    var t = String(text == null ? '' : text);
    var m = t.match(/^\s*\[[^\]]{1,48}\]\s*([^:\n]{2,48}):\s/);
    if (m) return m[1].trim() || null;
    m = t.match(/^\s*From:\s*([^\n]{2,64})$/im);
    if (m) return m[1].replace(/\s*<[^>]*>\s*$/, '').trim() || null;
    m = t.match(/^\s*[-—]\s*([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,2})\s*$/m);
    if (m) return m[1].trim() || null;
    return null;
  }

  /* ---------------- the content judge ----------------
     parseDispatchText(text) -> { isDispatchShape, score, confidence,
     fields, parsed }. Wraps TicketOCR.parseDispatch (the v57 engine)
     and maps its output onto dispatch-form-shaped fields, then scores
     the CONTENT for dispatch shape. Signals (points):
       movement verb phrase w/ a place (moveType + origin/destination) 4
       moveType alone (e.g. "grab … and dump here")                     2
       strong site name (Aecon / Ltd / Construction / …)                2
       weak site-looking phrase (generic capitalised words)             1
       location code (A2-L20)                                           3
       coordinates                                                      3
       truck type (Tandem / Tridem / …)                                 2
       clock time / resolved datetime                                   1
       "Go Empty To"-style instruction                                  1
       material words / sizes (40mm, gravel, drain, clay, …)            1
     A suggestion needs score >= 3 — so a lone time ("see you at
     8:00am"), a lone price, or a lone "pick up" can never qualify,
     while every one of the 11 real phrasing fixtures does. */
  var MATERIAL_RE = /\b\d+(?:\.\d+)?\s?mm\b|\b(gravel|clay|sand|drain|fill|topsoil|rip\s?rap|crush(?:er)?\s?run|rock|dirt|soil|asphalt|concrete|mulch)\b/i;
  var SITE_STRONG_RE = /Aecon|\b(Ltd|Inc|Corp|Group|Construction|Infrastructure|Aggregates|Trucking|Hauling|Developments)\b/i;

  function composeNotes(p, formNotes) {
    var parts = [];
    if (formNotes) parts.push(formNotes);
    var move = '';
    if (p.moveType === 'empty' && p.destination) move = 'Go to ' + p.destination + ' empty';
    else if (p.moveType === 'loaded' && p.origin && p.destination) move = 'Haul from ' + p.origin + ' to ' + p.destination;
    else if (p.moveType === 'loaded' && p.destination) move = 'Haul to ' + p.destination;
    else if (p.destination) move = 'Go to ' + p.destination;
    if (move) {
      var hay = parts.join(' ').toLowerCase();
      if (!p.destination || hay.indexOf(String(p.destination).toLowerCase()) === -1) parts.push(move);
      else if (!parts.length) parts.push(move);
    }
    return parts.join(' · ');
  }

  function parseDispatchText(text) {
    var out = { isDispatchShape: false, score: 0, confidence: null, fields: null, parsed: null };
    var t = String(text == null ? '' : text).trim();
    if (t.length < 4 || !/[A-Za-z]/.test(t)) return out;
    if (!window.TicketOCR || !TicketOCR.parseDispatch) return out;
    var p = TicketOCR.parseDispatch(t);
    out.parsed = p;
    var form = TicketOCR.toDispatchForm ? TicketOCR.toDispatchForm(p) : {};

    var score = 0;
    if (p.moveType) score += 2;
    if (p.destination || p.origin) score += 2;
    if (p.site) score += SITE_STRONG_RE.test(p.site) ? 2 : 1;
    if (p.locationCode) score += 3;
    if (p.lat !== undefined && p.lat !== null) score += 3;
    if (p.equipment) score += 2;
    if (p.datetime || p.time) score += 1;
    if (p.instructions) score += 1;
    if (MATERIAL_RE.test(t)) score += 1;
    out.score = score;
    out.isDispatchShape = score >= 3;
    if (!out.isDispatchShape) return out;
    out.confidence = score >= 6 ? 'high' : 'medium';

    out.fields = {
      jobSite: p.site || p.origin || p.destination || '',
      scheduledAt: p.datetime || '',
      timeLabel: p.time || '',
      equipment: p.equipment || '',
      destination: p.destination || '',
      origin: p.origin || '',
      dropoff: p.moveType === 'loaded' ? (p.destination || '') : '',
      type: p.moveType || null,
      locationCode: p.locationCode || '',
      lat: (p.lat !== undefined && p.lat !== null) ? p.lat : null,
      lng: (p.lng !== undefined && p.lng !== null) ? p.lng : null,
      notes: composeNotes(p, form.notes || '')
    };
    return out;
  }

  /* ---------------- the suggestion store ---------------- */

  function list() {
    var st = store(); if (!st) return [];
    var v = st.get(SUGGEST_KEY, []);
    return Array.isArray(v) ? v : [];
  }

  /* intake(text, source) -> the stored suggestion entry, or null when
     the text is not dispatch-shaped (chit-chat produces NOTHING) or
     the store refused the write. Identical raw text already waiting
     is returned as-is — a re-shared message never duplicates. */
  function intake(text, source) {
    var t = String(text == null ? '' : text).trim();
    if (t.length < 4) return null;
    var r = parseDispatchText(t);
    if (!r.isDispatchShape) return null;
    var st = store(); if (!st) return null;
    var existing = list();
    for (var i = 0; i < existing.length; i++) {
      if (existing[i] && existing[i].rawText === t) return existing[i];
    }
    var entry = {
      id: uid(),
      rawText: t.slice(0, 2000),
      source: source || 'paste',
      senderHint: senderHint(t),
      fields: r.fields,
      verdict: 'dispatch',
      shapeScore: r.score,
      confidence: r.confidence,
      createdAt: Date.now(),
      status: 'suggested'
    };
    existing.push(entry);
    if (st.set(SUGGEST_KEY, existing) === false) return null;
    return entry;
  }

  function dismiss(id) {
    var st = store(); if (!st) return false;
    var keep = list().filter(function (e) { return e && e.id !== id; });
    return st.set(SUGGEST_KEY, keep) !== false;
  }

  /* The form fields a suggestion loads, in the dispatch form's own
     field names — identical shape to the drafts dsp_draft carries. */
  function formFieldsFor(entry) {
    var f = (entry && entry.fields) || {};
    return {
      jobSite: f.jobSite || '',
      scheduledAt: f.scheduledAt || '',
      equipment: f.equipment || '',
      lat: (f.lat !== null && f.lat !== undefined) ? String(f.lat) : '',
      lng: (f.lng !== null && f.lng !== undefined) ? String(f.lng) : '',
      material: '',
      ticketNo: '',
      amount: '',
      loads: '1',
      notes: f.notes || '',
      driverId: ''
    };
  }

  /* "Empty draft" test — the same rule the Dispatch module applies to
     dsp_draft (an edit in progress is never empty, and never
     clobbered). */
  function draftBusy(draft) {
    if (!draft || typeof draft !== 'object') return false;
    if (draft.editId) return true;
    var f = draft.fields || {};
    var any = f.jobSite || f.scheduledAt || f.equipment || f.material ||
              f.ticketNo || f.amount || f.notes || f.lat || f.lng || f.driverId;
    return !!any || !!(draft.tickets && draft.tickets.length) || !!draft.photo;
  }

  /* use(id): the one-tap confirm. Loads the suggestion into the form
     THROUGH the draft machinery: writes dsp_draft (fields only, no
     tickets/photos, editId null) for the Dispatch module to restore,
     consumes the suggestion, and records the learning-hook stat.
     Refuses — changing nothing — when the form is busy (an edit or an
     unsaved entry is in progress) or the draft write fails, so a
     suggestion can never eat someone's half-typed dispatch. Creating
     the actual dispatch still takes the form's verified Save; this
     function never touches dsp_list / dsp_active. */
  function use(id) {
    var st = store(); if (!st) return { ok: false, reason: 'nostore' };
    var all = list();
    var entry = null;
    for (var i = 0; i < all.length; i++) { if (all[i] && all[i].id === id) { entry = all[i]; break; } }
    if (!entry) return { ok: false, reason: 'gone' };
    var draft = st.get(DRAFT_KEY, null);
    if (draftBusy(draft)) {
      return { ok: false, reason: (draft && draft.editId) ? 'editing' : 'draft-busy', entry: entry };
    }
    var newDraft = {
      fields: formFieldsFor(entry),
      tickets: [],
      photo: null,
      editId: null,
      savedAt: Date.now()
    };
    if (st.set(DRAFT_KEY, newDraft) === false) return { ok: false, reason: 'store', entry: entry };
    var keep = all.filter(function (e) { return e && e.id !== id; });
    st.set(SUGGEST_KEY, keep);
    try {
      var stats = st.get(STATS_KEY, []);
      if (!Array.isArray(stats)) stats = [];
      stats.push({ ts: Date.now(), source: entry.source || 'paste', senderHint: entry.senderHint || null });
      st.set(STATS_KEY, stats.slice(-200));
    } catch (e) {}
    return { ok: true, entry: entry, draft: newDraft };
  }

  /* ---------------- SHARE intake door ----------------
     The Web Share Target (assets/manifest.json) points at
     /?share=1&title=…&text=…&url=… (GET). On boot, app.js calls
     captureShare(): the shared text is stashed in dsp_share_inbox
     and the URL is cleaned, so a share never re-fires on later
     boots. The Dispatch module drains the inbox through intake()
     (source 'share') when it renders — non-dispatch shares are
     counted as failed and dropped, never suggested. */
  function captureShare() {
    try {
      var q = (window.location && window.location.search) || '';
      if (!/[?&]share=1(&|$)/.test(q)) return false;
      var text = '';
      try {
        var params = new URLSearchParams(q);
        var parts = [];
        var ti = params.get('title'), tx = params.get('text'), ur = params.get('url');
        if (ti) parts.push(ti);
        if (tx) parts.push(tx);
        if (ur) parts.push(ur);
        text = parts.join('\n').trim();
      } catch (e) { text = ''; }
      try { window.history.replaceState(null, '', window.location.pathname); } catch (e2) {}
      if (!text) return false;
      var st = store(); if (!st) return false;
      var inbox = st.get(INBOX_KEY, []);
      if (!Array.isArray(inbox)) inbox = [];
      inbox.push({ text: text, at: Date.now() });
      return st.set(INBOX_KEY, inbox.slice(-10)) !== false;
    } catch (e) { return false; }
  }

  function drainShareInbox() {
    var st = store(); if (!st) return { added: 0, failed: 0 };
    var inbox = st.get(INBOX_KEY, []);
    if (!Array.isArray(inbox) || !inbox.length) return { added: 0, failed: 0 };
    st.set(INBOX_KEY, []);
    var added = 0, failed = 0;
    inbox.forEach(function (item) {
      if (item && intake(item.text, 'share')) added++;
      else failed++;
    });
    return { added: added, failed: failed };
  }

  window.DispatchIngest = {
    parseDispatchText: parseDispatchText,
    senderHint: senderHint,
    list: list,
    intake: intake,
    dismiss: dismiss,
    use: use,
    formFieldsFor: formFieldsFor,
    captureShare: captureShare,
    drainShareInbox: drainShareInbox,
    KEYS: { suggest: SUGGEST_KEY, stats: STATS_KEY, inbox: INBOX_KEY, draft: DRAFT_KEY }
  };
})();
