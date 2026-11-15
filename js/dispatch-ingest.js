/* Meticulous — Dispatch INGESTION (v65; multi-dispatch v66).
   Owner direction (Oct 14, 2026): dispatches should arrive from the
   driver's messages instead of being retyped. They come from MANY
   different senders across text / email / WhatsApp, so the system is
   SENDER-AGNOSTIC and CONTENT-JUDGED: any text, from anyone, is asked
   one question — "does this read like a dispatch?" — by the same
   v57 dispatch-phrasing engine that reads dispatch screenshots
   (TicketOCR.parseDispatch, 27/27 on tools/corpus/phrasing.json).

   v66 (owner, same day): ONE message often carries SEVERAL
   dispatches — today's, yesterday's, a few days at once (a foreman's
   catch-up / week-at-a-glance). intake() therefore segments a
   multi-block message on its date cues (explicit dates, weekday
   names, today/tomorrow/yesterday, per-block headers) and on sender
   label lines ("Boss:", a bare name line), judges each block on its
   own, and stores one suggestion per dispatch-shaped block — past
   dates included (they are records for those days). The two
   authorities problem (boss daily + a fleet manager, possibly for
   the SAME day) is handled by attribution + flagging, never by
   choosing: each suggestion carries its own senderHint, and
   DispatchIngest.conflicts() reports dates with 2+ live suggestions
   so the tray can warn "pick one" — the human always picks.

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

   v457 (DISPATCH-PHOTO-INTAKE, owner Nov 15, 2026): two more
   doors into this same intake — a PHOTO of the dispatch and an
   uploaded dispatch FILE (image or PDF). The Dispatch module
   turns the file into text with the readers it already owns
   (TicketOCR for images and scanned PDFs, the bundled pdf.js
   text layer for printed PDFs) and hands the text to
   intakeResolved with source 'photo' / 'file', so a photographed
   or uploaded dispatch lands on exactly the suggestion a paste
   produces. The recognition itself grew: TicketOCR's places +
   key-number readers keep the company address, pickup address
   and every delivery address separate and every key number
   typed, and the learn store (dsp_learn) remembers what the
   driver confirms — address roles, company addresses, number
   label spellings, per sender/company — and applies it to the
   next read. See extractDetail / learnFromEntry below.
*/
(function () {
  'use strict';

  var SUGGEST_KEY = 'dsp_suggest';
  var STATS_KEY = 'dsp_suggest_stats';
  var INBOX_KEY = 'dsp_share_inbox';
  var DRAFT_KEY = 'dsp_draft';
  /* v457 (DISPATCH-PHOTO-INTAKE, owner Nov 15, 2026): the learn
     store — what this account's CONFIRMED dispatches teach the
     reader (see the learning section below). Synced kv like
     dsp_suggest_stats, per-account by construction. */
  var LEARN_KEY = 'dsp_learn';

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

  /* ---------------- v457: places, key numbers, learning ----------------
     The recognition the owner ordered Nov 15, 2026: a dispatch's
     company address, pickup address and delivery addresses stay
     SEPARATE, its key numbers stay TYPED, and what the driver
     confirms teaches the next read. The extractors live in
     TicketOCR (pure text readers); everything account-shaped —
     the learn store, the application of remembered roles — lives
     here, beside the suggestion store it feeds. */

  function learnStore() {
    var st = store(); if (!st) return null;
    var v = st.get(LEARN_KEY, null);
    if (!v || typeof v !== 'object') v = { labels: {}, roles: {}, companyAddr: {}, detailLabels: {} };
    if (!v.labels) v.labels = {};
    if (!v.roles) v.roles = {};
    if (!v.companyAddr) v.companyAddr = {};
    if (!v.detailLabels) v.detailLabels = {};
    return v;
  }
  function saveLearn(v) {
    var st = store(); if (!st || !v) return false;
    /* caps: the store stays small enough to sync forever */
    function capObj(o, n) {
      var keys = Object.keys(o);
      if (keys.length <= n) return o;
      var out = {};
      keys.slice(keys.length - n).forEach(function (k) { out[k] = o[k]; });
      return out;
    }
    v.labels = capObj(v.labels, 60);
    v.roles = capObj(v.roles, 40);
    v.companyAddr = capObj(v.companyAddr, 40);
    v.detailLabels = capObj(v.detailLabels, 40);
    return st.set(LEARN_KEY, v) !== false;
  }
  function normKey(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function normAddr(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }
  /* an address's core — street + city, without the name line —
     so a remembered role survives the name line being present
     in one read and missing in the next */
  function coreOfAddr(s) {
    var m = String(s || '').match(/(\d{1,6}\s+[^,]+(?:,[^,]+)?,\s*[A-Z]{2}\s+\S+)\s*$/i);
    return m ? normAddr(m[1]) : '';
  }
  /* the key a dispatch's lessons file under: the sender when the
     text carries one, else the company/site it names */
  function learnKeyFor(text, places, p) {
    var hint = senderHint(text);
    if (hint) return normKey(hint);
    if (places && places.company) return normKey(places.company);
    if (p && p.site) return normKey(p.site);
    return '';
  }
  function learnedLabelsList(v) {
    if (!v) return [];
    return Object.keys(v.labels).map(function (k) {
      return { spelling: v.labels[k].spelling, type: v.labels[k].type };
    }).filter(function (x) { return x.spelling && x.type; });
  }
  /* v459: the detail fields' remembered label spellings —
     the same lesson shape as the number labels, kept apart so
     a detail spelling is never read as a number label */
  function learnedDetailLabelsList(v) {
    if (!v || !v.detailLabels) return [];
    return Object.keys(v.detailLabels).map(function (k) {
      return { spelling: v.detailLabels[k].spelling, key: v.detailLabels[k].key };
    }).filter(function (x) { return x.spelling && x.key; });
  }
  /* the name an address string carries: its first segment,
     when the next segment is a street (starts with a digit) —
     "PUBLIX DACULA, 445 HURRICANE TRL, …" -> "PUBLIX DACULA";
     a city-only address ("TAMPA, FL 33619") carries none */
  function nameOfAddr(addr) {
    var parts = String(addr || '').split(', ');
    if (parts.length >= 3 && /^\d/.test(parts[1])) return parts[0];
    return '';
  }
  /* the v459 detail keys the card may carry — anything else a
     patch offers is ignored, exactly like the v457 shapes */
  var DETAIL_KEYS = { startDate: 1, startTime: 1, puDateTime: 1, delDateTime: 1, commodity: 1, broker: 1, temperature: 1, weight: 1, quantity: 1, shipperPhone: 1, consigneePhone: 1 };

  /* extractDetail(text, p) -> { companyName, companyAddress,
     pickupAddress, pickups, deliveries, numbers } — the v457
     structured read of one dispatch text, with this account's
     remembered lessons applied: an address a confirmed dispatch
     already placed keeps its confirmed role for this sender /
     company, a remembered company address fills a blank the
     document left, and remembered number-label spellings are
     read beside the built-in table. */
  function extractDetail(text, p) {
    var empty = { companyName: '', companyAddress: '', pickupAddress: '', pickups: [], deliveries: [], numbers: [], pickupName: '', deliveryName: '', details: [] };
    if (!window.TicketOCR || !TicketOCR.parseDispatchPlaces || !TicketOCR.extractKeyNumbers) return empty;
    var learn = learnStore();
    var places = null, numbers = [];
    try { places = TicketOCR.parseDispatchPlaces(text); } catch (e) {}
    try { numbers = TicketOCR.extractKeyNumbers(text, learnedLabelsList(learn)) || []; } catch (e) {}
    if (!places) return empty;
    var out = {
      companyName: places.company || '',
      companyAddress: places.companyAddress || '',
      pickupAddress: (places.pickups && places.pickups[0]) || '',
      pickups: (places.pickups || []).slice(),
      deliveries: (places.deliveries || []).slice(),
      numbers: numbers,
      /* v459: the parties as NAMED fields — the shipper is the
         pickup party, the consignee the (first) delivery party;
         the name is the address's own name segment when it has
         one, else the name a party label printed */
      pickupName: nameOfAddr((places.pickups || [])[0]) || places.shipperName || '',
      deliveryName: nameOfAddr((places.deliveries || [])[0]) || places.consigneeName || '',
      details: []
    };
    /* v459: the long-haul detail fields (commodity, broker,
       temperature, weight, quantity, dates/times, phones) —
       read by TicketOCR.extractDispatchDetails with this
       account's remembered detail-label spellings and the
       phones the address blocks carried */
    try {
      if (TicketOCR.extractDispatchDetails) {
        out.details = TicketOCR.extractDispatchDetails(text, learnedDetailLabelsList(learn), {
          pickup: places.pickupPhone || '', delivery: places.deliveryPhone || ''
        }) || [];
      }
    } catch (e) {}
    var key = learnKeyFor(text, places, p);
    if (learn && key) {
      /* remembered roles: an address this sender/company already
         confirmed somewhere is filed under that role again */
      var roles = learn.roles[key] || {};
      var all = [];
      out.pickups.forEach(function (a) { all.push({ a: a, role: 'pickup' }); });
      out.deliveries.forEach(function (a) { all.push({ a: a, role: 'delivery' }); });
      if (out.companyAddress) all.push({ a: out.companyAddress, role: 'company' });
      var moved = { pickup: [], delivery: [], company: '' };
      all.forEach(function (it) {
        var r = roles[normAddr(it.a)];
        if (!r) { var c = coreOfAddr(it.a); if (c) r = roles['c:' + c]; }
        r = r || it.role;
        if (r === 'pickup') moved.pickup.push(it.a);
        else if (r === 'delivery') moved.delivery.push(it.a);
        else if (r === 'company' && !moved.company) moved.company = it.a;
      });
      if (moved.pickup.length || moved.delivery.length || moved.company) {
        out.pickups = moved.pickup;
        out.deliveries = moved.delivery;
        if (moved.company) out.companyAddress = moved.company;
        out.pickupAddress = out.pickups[0] || '';
      }
      /* remembered company address fills a blank — never
         overwrites an address the document itself carries */
      if (!out.companyAddress && learn.companyAddr[key]) out.companyAddress = learn.companyAddr[key];
    }
    return out;
  }

  /* learnFromEntry(entry, beforeFields): record what a CONFIRMED
     suggestion teaches — called when a suggestion is Used (the
     confirmation) and when its fields are edited on the card
     (a correction). Learns, per sender/company key:
       - address -> role (the fields as they stand AFTER the
         driver's word, so a correction replaces the guess);
       - company -> its confirmed company address;
       - number label spellings -> their types, for every typed
         number the confirmed suggestion carries.
     Nothing else is learned: no raw text is kept, no guess is
     ever promoted — only what the driver confirmed. */
  function learnFromEntry(entry, beforeFields) {
    if (!entry || !entry.fields) return;
    var learn = learnStore(); if (!learn) return;
    var f = entry.fields;
    var places = { company: f.companyName || '' };
    var key = learnKeyFor(entry.rawText || '', places, { site: f.jobSite || '' });
    if (!key) return;
    var roles = learn.roles[key] || (learn.roles[key] = {});
    function mark(addr, role) {
      if (!addr) return;
      roles[normAddr(addr)] = role;
      var c = coreOfAddr(addr);
      if (c) roles['c:' + c] = role;
    }
    (f.pickups && f.pickups.length ? f.pickups : (f.pickupAddress ? [f.pickupAddress] : [])).forEach(function (a) { mark(a, 'pickup'); });
    (f.deliveries || []).forEach(function (a) { mark(a, 'delivery'); });
    mark(f.companyAddress, 'company');
    /* a corrected-away address keeps no stale role: when the
       before-fields held an address the after-fields place
       differently (or drop), the after word above already won
       for shared addresses; a dropped address is forgotten */
    if (beforeFields) {
      var afterAddrs = {};
      (f.pickups || []).forEach(function (a) { afterAddrs[normAddr(a)] = true; });
      (f.deliveries || []).forEach(function (a) { afterAddrs[normAddr(a)] = true; });
      if (f.companyAddress) afterAddrs[normAddr(f.companyAddress)] = true;
      if (f.pickupAddress) afterAddrs[normAddr(f.pickupAddress)] = true;
      [beforeFields.pickupAddress].concat(beforeFields.pickups || [], beforeFields.deliveries || [], [beforeFields.companyAddress]).forEach(function (a) {
        if (a && !afterAddrs[normAddr(a)]) {
          delete roles[normAddr(a)];
          var c = coreOfAddr(a);
          if (c) delete roles['c:' + c];
        }
      });
    }
    if (f.companyAddress) learn.companyAddr[key] = f.companyAddress;
    (f.numbers || []).forEach(function (n) {
      if (!n || !n.label || !n.type) return;
      var lk = normKey(n.label);
      if (!lk) return;
      var cur = learn.labels[lk] || { spelling: n.label, type: n.type, count: 0 };
      cur.spelling = n.label;
      cur.type = n.type;
      cur.count = (cur.count || 0) + 1;
      learn.labels[lk] = cur;
    });
    /* v459: a confirmed detail field teaches its printed label
       spelling -> its key ("Reefer Setting" -> temperature),
       the same lesson the number labels learn */
    (f.details || []).forEach(function (d) {
      if (!d || !d.srcLabel || !d.key || !DETAIL_KEYS[d.key]) return;
      var dk = normKey(d.srcLabel);
      if (!dk) return;
      learn.detailLabels[dk] = { spelling: d.srcLabel, key: d.key };
    });
    saveLearn(learn);
  }

  function parseDispatchText(text) {
    var out = { isDispatchShape: false, score: 0, confidence: null, fields: null, parsed: null };
    var t = String(text == null ? '' : text).trim();
    if (t.length < 4 || !/[A-Za-z]/.test(t)) return out;
    if (!window.TicketOCR || !TicketOCR.parseDispatch) return out;
    var p = TicketOCR.parseDispatch(t);
    out.parsed = p;
    var form = TicketOCR.toDispatchForm ? TicketOCR.toDispatchForm(p) : {};

    var detail = extractDetail(t, p);
    out.detail = detail;

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
    /* v457: a DOCUMENT-shaped dispatch (a rate confirmation, a
       BOL) speaks in addresses and typed numbers instead of
       driver-speak; that structure is its own dispatch signal.
       It can only add to a read that also carries a place — a
       lone labelled number (an invoice line in a family chat)
       still produces nothing. */
    var placeCount = detail.pickups.length + detail.deliveries.length + (detail.companyAddress ? 1 : 0);
    if (placeCount >= 1 && detail.numbers.length >= 1) score += 3;
    else if (placeCount >= 2) score += 2;
    else if (placeCount === 1) score += 1;
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
      /* v358: the second pin (haul/dump end) — see parseDispatch */
      dumpLat: (p.dumpLat !== undefined && p.dumpLat !== null) ? p.dumpLat : null,
      dumpLng: (p.dumpLng !== undefined && p.dumpLng !== null) ? p.dumpLng : null,
      notes: composeNotes(p, form.notes || '')
    };
    /* v358: a Maps link whose pin could NOT be read (a short link
       the resolver could not follow) is preserved in the notes —
       the saved record keeps the link itself, so the driver can
       still open it by hand. Nothing pretends a pin exists. */
    var un358 = (p && p.unresolvedLinks) || [];
    if (un358.length) {
      var bits358 = un358.map(function (u) { return 'Pin link: ' + u; }).join(' · ');
      out.fields.notes = out.fields.notes ? out.fields.notes + ' · ' + bits358 : bits358;
    }
    /* v457: the structured read rides the suggestion as its own
       fields — separate, labelled, editable on the card — and
       never folded into the notes blob at this stage. */
    out.fields.companyName = detail.companyName || '';
    out.fields.companyAddress = detail.companyAddress || '';
    out.fields.pickupAddress = detail.pickupAddress || '';
    out.fields.pickups = detail.pickups || [];
    out.fields.deliveries = detail.deliveries || [];
    out.fields.numbers = detail.numbers || [];
    /* v459: the named parties and the long-haul detail fields
       ride the suggestion the same way — separate, labelled,
       editable on the card */
    out.fields.pickupName = detail.pickupName || '';
    out.fields.deliveryName = detail.deliveryName || '';
    out.fields.details = detail.details || [];
    return out;
  }

  /* ---------------- MULTI-DISPATCH segmentation (v66) ----------------
     splitSegments cuts a message into blocks at DATE CUES (a line
     starting with an explicit date, a weekday name, or
     today/tomorrow/yesterday) and at SENDER LABELS (a standalone
     "Boss:" line heads the next block; a bare name line trailing one
     block belongs to the next; a "Name:" prefix on a block's first
     line attributes it). A block is "anchored" when it carries a cue
     or a sender; a message is a BATCH when 2+ anchored blocks exist.
     Anything else keeps the exact v65 single-message behaviour. */

  var MONTH_NUM = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
  var WEEKDAY_NUM = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
  var MONTH_SRC = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)';
  var WEEKDAY_SRC = '(sunday|monday|tuesday|wednesday|thursday|friday|saturday|tues|thur|thurs|sun|mon|tue|wed|thu|fri|sat)';
  /* words that must never be read as a sender's name —
     v459: a DOCUMENT's structural labels join the list. On a
     trip report or BOL, "Shipper:" / "Consignee:" head the
     parties' own blocks; read as sender labels they cut one
     dispatch into three fragments (the header scored as its
     own message, each party became a separate "dispatch" and
     the consignee landed as a pickup). They are structure,
     never a sender — no dispatcher's name is "Shipper". */
  var NOT_A_NAME_RE = /^(note|reminder|subject|re|fyi|update|important|warning|tandem|tridem|tri-?axle|end\s?dump|single\s?axle|shipper|ship\s+from|consignee|receiver|deliver\s+to|customs\s+broker|broker|carrier|pick\s?-?\s?up|delivery|drop\s?-?\s?off|dispatch|driver)$/i;
  var NOT_A_NAME_LINE_RE = /\b(tandem|tridem|tri-?axle|end\s?dump|single\s?axle|aecon|construction|trucking|hauling|aggregates|infrastructure|developments|yard|plant|pond|pit|empty|loaded|today|tomorrow|yesterday|haul|bring|grab|dump|load|please|thanks|shipper|consignee)\b/i;

  function pad2(n) { return ('0' + n).slice(-2); }
  function fmtDateStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function datePart(s) {
    s = String(s == null ? '' : s);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
  }

  /* A year-less explicit date ("Oct 12") resolves to the occurrence
     NEAREST today: a catch-up text's dates sit just behind us, a
     week-preview's just ahead — nearest serves both. */
  function nearestYearDate(month, day) {
    var now = startOfDay(new Date());
    var best = null, bestDist = Infinity;
    for (var dy = -1; dy <= 1; dy++) {
      var cand = new Date(now.getFullYear() + dy, month, day);
      if (cand.getMonth() !== month || cand.getDate() !== day) continue; // Feb 30 etc.
      var dist = Math.abs(Math.round((cand - now) / 86400000));
      if (dist < bestDist) { bestDist = dist; best = cand; }
    }
    return best;
  }
  /* A bare weekday ("Monday") resolves to its nearest occurrence
     (0 = today; forward wins at distance 3, backward at 4). */
  function weekdayToDate(wd) {
    var now = startOfDay(new Date());
    var fwd = (wd - now.getDay() + 7) % 7;
    var d = new Date(now);
    d.setDate(d.getDate() + (fwd <= 3 ? fwd : fwd - 7));
    return d;
  }
  function relativeToDate(word) {
    var d = startOfDay(new Date());
    if (/^tomorrow$/i.test(word)) d.setDate(d.getDate() + 1);
    else if (/^yesterday$/i.test(word)) d.setDate(d.getDate() - 1);
    return d;
  }

  /* matchDateCue(line) -> null | { dateStr, label, textStart }.
     textStart = index in the ORIGINAL line just past the cue tokens.
     A cue is only a cue when what follows it on the line is empty, a
     separator (":" "-" "," ")" …), a clock time, or the cue itself
     carried 2+ date elements ("Mon Oct 12 Tandem…" is unambiguous;
     "Monday shift starts…" is not a cue at all). */
  function matchDateCue(line) {
    var s = String(line == null ? '' : line);
    var rest = s.replace(/^\s+/, '');
    var base = s.length - rest.length;
    var lm = rest.match(/^(?:[-*•·]\s+|\d{1,2}\s*[.)]\s+)/);
    if (lm) { base += lm[0].length; rest = rest.slice(lm[0].length); }
    if (/^[[(]/.test(rest)) { base += 1; rest = rest.slice(1); }

    var elements = 0, explicit = null, weekday = null, relative = null;
    var pos = 0, m;
    function skipSep() { var sm = rest.slice(pos).match(/^[\s,]+/); if (sm) pos += sm[0].length; }
    for (var i = 0; i < 3; i++) {
      skipSep();
      var tail = rest.slice(pos);
      if (!explicit && (m = tail.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\b/))) {
        var iso = new Date(+m[1], +m[2] - 1, +m[3]);
        if (iso.getMonth() === +m[2] - 1 && iso.getDate() === +m[3]) { explicit = iso; pos += m[0].length; elements++; continue; }
      }
      if (!explicit && (m = tail.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/))) {
        var mo = +m[1] - 1, dy = +m[2];
        if (mo >= 0 && mo <= 11 && dy >= 1 && dy <= 31) {
          var nd = m[3] ? new Date(m[3].length === 2 ? 2000 + (+m[3]) : +m[3], mo, dy) : nearestYearDate(mo, dy);
          if (nd && nd.getMonth() === mo && nd.getDate() === dy) { explicit = nd; pos += m[0].length; elements++; continue; }
        }
      }
      if (!explicit && (m = tail.match(new RegExp('^' + MONTH_SRC + '\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s*,?\\s*(\\d{4})\\b)?', 'i')))) {
        var mn = MONTH_NUM[m[1].toLowerCase()];
        var md = m[3] ? new Date(+m[3], mn, +m[2]) : nearestYearDate(mn, +m[2]);
        if (md && md.getMonth() === mn && md.getDate() === +m[2]) { explicit = md; pos += m[0].length; elements++; continue; }
      }
      if (!explicit && (m = tail.match(new RegExp('^(\\d{1,2})(?:st|nd|rd|th)?\\s+' + MONTH_SRC + '\\b(?:\\s*,?\\s*(\\d{4})\\b)?', 'i')))) {
        var mn2 = MONTH_NUM[m[2].toLowerCase()];
        var md2 = m[3] ? new Date(+m[3], mn2, +m[1]) : nearestYearDate(mn2, +m[1]);
        if (md2 && md2.getMonth() === mn2) { explicit = md2; pos += m[0].length; elements++; continue; }
      }
      if (weekday === null && (m = tail.match(new RegExp('^' + WEEKDAY_SRC + '\\.?\\b', 'i')))) {
        weekday = WEEKDAY_NUM[m[1].toLowerCase()]; pos += m[0].length; elements++; continue;
      }
      if (!relative && !explicit && weekday === null && (m = tail.match(/^(today|tomorrow|yesterday)\b/i))) {
        relative = m[1]; pos += m[0].length; elements++; continue;
      }
      break;
    }
    if (!elements) return null;
    var date = explicit || (relative ? relativeToDate(relative) : (weekday !== null ? weekdayToDate(weekday) : null));
    if (!date) return null;
    var after = rest.slice(pos).replace(/^\s+/, '');
    var okRemainder = after === '' || /^[:\-–—,)\]]/.test(after) || /^\d{1,2}:\d{2}\b/.test(after) || elements >= 2;
    if (!okRemainder) return null;
    return {
      dateStr: fmtDateStr(date),
      label: rest.slice(0, pos).replace(/[\s,]+$/, '').replace(/\s+/g, ' ').trim(),
      textStart: base + pos
    };
  }

  /* A line that is ONLY "Name:" — a chain header for the next block. */
  function matchLabelLine(trimmed) {
    var m = String(trimmed).match(/^([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,2}):$/);
    if (!m) return null;
    var name = m[1].trim();
    if (NOT_A_NAME_RE.test(name) || SITE_STRONG_RE.test(name)) return null;
    return name;
  }
  /* A bare name line ("Saleem") — a sender label when it trails one
     block and the next block follows. */
  function matchBareNameLine(trimmed) {
    var t = String(trimmed);
    if (t.length > 30 || /\d/.test(t)) return null;
    if (!/^[A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){0,2}$/.test(t)) return null;
    if (NOT_A_NAME_LINE_RE.test(t)) return null;
    var low = t.toLowerCase();
    if (MONTH_NUM[low] !== undefined || WEEKDAY_NUM[low] !== undefined) return null;
    return t;
  }
  /* "Name: <rest of line>" — attribution for the block this line opens.
     Returns { sender, rest, consumed } or null. */
  function peelSenderPrefix(line) {
    var s = String(line);
    var m = s.match(/^(\s*)([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,2}):\s+(\S[\s\S]*)$/);
    if (!m) return null;
    var name = m[2].trim();
    if (NOT_A_NAME_RE.test(name) || SITE_STRONG_RE.test(name)) return null;
    return { sender: name, rest: m[3], restAt: s.length - m[3].length };
  }

  function splitSegments(text) {
    var lines = String(text).split('\n');
    var segs = [];
    var cur = null, pendingSender = null, boundary = false;
    function openSeg(cue, sender) {
      cur = { cue: cue || null, sender: sender || null, lines: [] };
      segs.push(cur);
      boundary = false;
    }
    /* a bare name line trailing the current block heads the NEXT one */
    function popTrailingName() {
      if (!cur || !cur.lines.length) return null;
      var j = cur.lines.length - 1;
      while (j >= 0 && !cur.lines[j].trim()) j--;
      if (j < 0) return null;
      var nm = matchBareNameLine(cur.lines[j].trim());
      if (!nm) return null;
      cur.lines = cur.lines.slice(0, j);
      return nm;
    }
    lines.forEach(function (line) {
      var trimmed = line.trim();
      var label = trimmed ? matchLabelLine(trimmed) : null;
      if (label) {
        popTrailingName();
        pendingSender = label;
        boundary = true;
        return;
      }
      var peel = trimmed ? peelSenderPrefix(line) : null;
      var cue = matchDateCue(peel ? peel.rest : line);
      if (cue) {
        var moved = popTrailingName();
        openSeg(
          { dateStr: cue.dateStr, label: cue.label, textStart: cue.textStart + (peel ? peel.restAt : 0) },
          pendingSender || moved || (peel ? peel.sender : null)
        );
        pendingSender = null;
        cur.lines.push(line);
        return;
      }
      if (!cur || boundary) {
        openSeg(null, pendingSender || (peel ? peel.sender : null));
        pendingSender = null;
      } else if (!cur.sender && peel) {
        cur.sender = peel.sender;
      }
      cur.lines.push(line);
    });
    return segs.map(function (sg) {
      var text = sg.lines.join('\n').trim();
      var body = text;
      if (sg.cue && sg.lines.length) {
        var firstRaw = sg.lines[0];
        var restLines = sg.lines.slice(1).join('\n');
        var head = firstRaw.slice(sg.cue.textStart).replace(/^[\s:,\-–—)\]]+/, '').trim();
        body = ((head ? head + (restLines ? '\n' : '') : '') + restLines).trim();
      }
      return {
        text: text,
        bodyText: body,
        cue: sg.cue ? { dateStr: sg.cue.dateStr, label: sg.cue.label } : null,
        sender: sg.sender || null
      };
    }).filter(function (sg) { return sg.text.length > 0; });
  }

  /* The dedupe fingerprint body: lowercased, sender-prefix-free,
     punctuation-collapsed — the same block re-pasted under a
     different header format ("Mon Oct 12" vs "Oct 12") keys the
     same, because the header itself never enters the body. */
  function normalizeForKey(s) {
    var t = String(s == null ? '' : s).toLowerCase();
    t = t.replace(/^[a-z][\w.'-]*(?:\s+[a-z][\w.'-]*){0,2}:\s+/, '');
    return t.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function keyFor(dateStr, bodyText) { return (dateStr || '') + '|' + normalizeForKey(bodyText); }
  function fingerprintOf(dateStr, fields) {
    if (!dateStr || !fields || !fields.jobSite) return null;
    function ci(v) { return String(v || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
    return dateStr + '|' + ci(fields.jobSite) + '|' + ci(fields.equipment || '');
  }

  /* A segment's resolved date overrides the parser's own date guess
     (the parser only understands today/tomorrow); the time of day
     the parser found is kept. No time anywhere -> the trade's
     standard 08:00 start, visible and editable in the form. */
  function applySegmentDate(fields, cue) {
    var f = {};
    for (var k in fields) f[k] = fields[k];
    var time = '';
    if (f.scheduledAt && f.scheduledAt.indexOf('T') !== -1) time = f.scheduledAt.split('T')[1];
    var clockLabel = '';
    if (f.timeLabel) {
      var cm = String(f.timeLabel).match(/(\d{1,2}):(\d{2})\s*([aApP])[mM]/);
      if (cm) {
        clockLabel = cm[1] + ':' + cm[2] + cm[3].toLowerCase() + 'm';
        if (!time) {
          var h = parseInt(cm[1], 10) % 12;
          if (/p/i.test(cm[3])) h += 12;
          time = pad2(h) + ':' + cm[2];
        }
      }
    }
    if (!time) time = '08:00';
    f.scheduledAt = cue.dateStr + 'T' + time;
    f.segmentDate = cue.dateStr;
    f.timeLabel = cue.label + (clockLabel ? ' · ' + clockLabel : '');
    return f;
  }

  /* parseDispatchBatch(text) -> { isBatch, segments: [{ text,
     bodyText, dateStr, dateLabel, sender, isDispatchShape, score,
     confidence, fields, parsed }] }. Batch = 2+ anchored blocks
     (date-cued or sender-labelled). Non-batch input returns
     isBatch:false and the caller keeps the v65 path byte-identical. */
  function parseDispatchBatch(text) {
    var t = String(text == null ? '' : text).trim();
    var out = { isBatch: false, segments: [] };
    if (t.length < 4) return out;
    var raw = splitSegments(t);
    var anchored = 0;
    raw.forEach(function (sg) { if (sg.cue || sg.sender) anchored++; });
    if (raw.length < 2 || anchored < 2) return out;
    out.isBatch = true;
    out.segments = raw.map(function (sg) {
      /* a cued segment is judged on its BODY (header stripped): the
         header is metadata — left in, its own capitalised words
         ("Tue Oct") pollute the parser's site guess. The resolved
         date is re-applied by applySegmentDate below, and a bare
         clock time survives the strip (it sits past the cue). */
      var r = parseDispatchText(sg.cue ? sg.bodyText : sg.text);
      var seg = {
        text: sg.text,
        bodyText: sg.bodyText,
        dateStr: sg.cue ? sg.cue.dateStr : null,
        dateLabel: sg.cue ? sg.cue.label : null,
        sender: sg.sender,
        isDispatchShape: r.isDispatchShape,
        score: r.score,
        confidence: r.confidence,
        fields: r.fields,
        parsed: r.parsed
      };
      if (r.isDispatchShape && sg.cue) seg.fields = applySegmentDate(r.fields, sg.cue);
      return seg;
    });
    return out;
  }

  /* conflicts(entries?) -> [{ date, count, ids }] for every date
     holding 2+ LIVE suggestions (two authorities can legitimately
     dispatch the same day). Purely a report — flagging only; the
     app never picks a winner and Use stays per-suggestion. */
  function conflicts(entries) {
    var byDate = {};
    var src = Array.isArray(entries) ? entries : list();
    src.forEach(function (e) {
      if (!e || e.status !== 'suggested') return;
      var f = e.fields || {};
      var d = f.segmentDate || datePart(f.scheduledAt);
      if (!d) return;
      (byDate[d] = byDate[d] || []).push(e.id);
    });
    return Object.keys(byDate)
      .filter(function (d) { return byDate[d].length >= 2; })
      .sort()
      .map(function (d) { return { date: d, count: byDate[d].length, ids: byDate[d] }; });
  }

  /* ---------------- the suggestion store ---------------- */

  function list() {
    var st = store(); if (!st) return [];
    var v = st.get(SUGGEST_KEY, []);
    return Array.isArray(v) ? v : [];
  }

  /* intakeSingle(text, source) -> { entry, duplicate }: the v65
     single-message path, unchanged. entry is null when the text is
     not dispatch-shaped (chit-chat produces NOTHING) or the store
     refused the write. Identical raw text — or the full text of a
     batch stored earlier — already waiting is returned flagged as a
     duplicate: a re-shared message never duplicates. */
  function intakeSingle(text, source) {
    var none = { entry: null, duplicate: false };
    var t = String(text == null ? '' : text).trim();
    if (t.length < 4) return none;
    var r = parseDispatchText(t);
    if (!r.isDispatchShape) return none;
    var st = store(); if (!st) return none;
    var existing = list();
    for (var i = 0; i < existing.length; i++) {
      if (existing[i] && (existing[i].rawText === t || existing[i].batchText === t)) {
        return { entry: existing[i], duplicate: true };
      }
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
    if (st.set(SUGGEST_KEY, existing) === false) return none;
    return { entry: entry, duplicate: false };
  }

  /* intakeBatch(text, source) -> { added: [entries], duplicates,
     batch }: the one entry point every door uses. A BATCH message
     (2+ anchored blocks) stores one suggestion per dispatch-shaped
     segment — each with its own parsed date and its own sender —
     while a non-dispatch-shaped block inside the message yields
     nothing. Per-segment dedupe: a segment is skipped when its key
     (resolved date + cue-stripped body, normalised) or its
     date+site+truck fingerprint matches a live suggestion, so
     re-pasting the same multi-day message — or an overlapping one —
     adds only the genuinely new days. Anything else (one block,
     chit-chat) falls through to the v65 single path untouched. */
  function intakeBatch(text, source) {
    var t = String(text == null ? '' : text).trim();
    var res = { added: [], duplicates: 0, batch: false };
    if (t.length < 4) return res;
    var b = parseDispatchBatch(t);
    if (!b.isBatch) {
      var one = intakeSingle(t, source);
      if (one.entry) { res.added = [one.entry]; res.duplicates = one.duplicate ? 1 : 0; }
      return res;
    }
    res.batch = true;
    var st = store(); if (!st) return res;
    var existing = list();
    var keys = {}, fps = {};
    existing.forEach(function (e) {
      if (!e) return;
      if (e.segmentKey) keys[e.segmentKey] = true;
      var fp = fingerprintOf((e.fields && e.fields.segmentDate) || datePart(e.fields && e.fields.scheduledAt), e.fields);
      if (fp) fps[fp] = true;
    });
    var hint = senderHint(t);
    var batchId = uid();
    var changed = false;
    b.segments.forEach(function (sg) {
      if (!sg.isDispatchShape) return; // partial validity: bad blocks land nothing
      var key = keyFor(sg.dateStr, sg.bodyText);
      var fp = fingerprintOf(sg.dateStr, sg.fields);
      if (keys[key] || (fp && fps[fp])) { res.duplicates++; return; }
      var entry = {
        id: uid(),
        rawText: sg.text.slice(0, 2000),
        batchText: t.slice(0, 4000),
        batchId: batchId,
        segmentKey: key,
        segmentDate: sg.dateStr || null,
        source: source || 'paste',
        senderHint: sg.sender || hint,
        fields: sg.fields,
        verdict: 'dispatch',
        shapeScore: sg.score,
        confidence: sg.confidence,
        createdAt: Date.now(),
        status: 'suggested'
      };
      existing.push(entry);
      keys[key] = true;
      if (fp) fps[fp] = true;
      res.added.push(entry);
      changed = true;
    });
    if (changed && st.set(SUGGEST_KEY, existing) === false) {
      return { added: [], duplicates: res.duplicates, batch: true, failed: true };
    }
    return res;
  }

  /* intakeResolved(text, source) -> Promise of the intakeBatch
     result (v358, GOOGLE-MAPS-PIN-INTO-NAVIGATOR). A pasted
     dispatch's pins arrive as Maps LINKS: full links parse
     locally inside intakeBatch itself, but a SHORT link's pin
     hides behind a redirect — so this door first asks PinLinks
     to follow the text's links and rewrite each resolved one in
     place as its "lat, lng" pair; the proven synchronous intake
     then reads the rewritten text exactly as if the dispatcher
     had pasted coordinates. A link that cannot be resolved stays
     in the text verbatim (and lands in the suggestion's notes —
     see parseDispatchText). A text with no Maps links takes the
     synchronous path unchanged, wrapped in a promise. This door
     NEVER rejects: any resolver failure falls back to the plain
     intake of the original text. */
  function intakeResolved(text, source) {
    var t = String(text == null ? '' : text);
    var PL = (typeof window !== 'undefined' && window.PinLinks) || null;
    if (!PL || !PL.findLinks || !PL.rewriteText || !PL.findLinks(t).length) {
      return Promise.resolve(intakeBatch(t, source));
    }
    return PL.rewriteText(t).then(function (nt) {
      return intakeBatch(nt, source);
    }, function () {
      return intakeBatch(t, source);
    });
  }

  /* intake(text, source) -> the stored suggestion entry, or null:
     the v65 signature, kept for existing callers. A batch message
     returns its first newly-added suggestion (or the first stored
     entry of that batch when it was already waiting). */
  function intake(text, source) {
    var t = String(text == null ? '' : text).trim();
    if (t.length >= 4 && parseDispatchBatch(t).isBatch) {
      var r = intakeBatch(t, source);
      if (r.added.length) return r.added[0];
      var ex = list();
      for (var i = 0; i < ex.length; i++) {
        if (ex[i] && ex[i].batchText === t) return ex[i];
      }
      return null;
    }
    return intakeSingle(t, source).entry;
  }

  function dismiss(id) {
    var st = store(); if (!st) return false;
    var keep = list().filter(function (e) { return e && e.id !== id; });
    return st.set(SUGGEST_KEY, keep) !== false;
  }

  /* updateSuggestionFields(id, patch) — v457: the confirmation
     card's own edits. The driver corrects the structured read
     (company / pickup / delivery addresses, typed numbers) ON
     the suggestion, before Use; the correction is stored on the
     suggestion and taught to the learn store in the same step,
     so the next similar dispatch reads better. Only the v457
     field shapes are patchable; anything else is ignored. */
  function updateSuggestionFields(id, patch) {
    var st = store(); if (!st || !patch) return null;
    var all = list();
    var entry = null;
    for (var i = 0; i < all.length; i++) { if (all[i] && all[i].id === id) { entry = all[i]; break; } }
    if (!entry) return null;
    var before = {};
    var f = entry.fields || (entry.fields = {});
    ['companyName', 'companyAddress', 'pickupAddress', 'pickups', 'deliveries', 'numbers', 'pickupName', 'deliveryName', 'details'].forEach(function (k) {
      before[k] = Array.isArray(f[k]) ? f[k].slice() : f[k];
    });
    function cleanStr(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 300); }
    function cleanList(v, cap) {
      if (!Array.isArray(v)) return null;
      return v.map(cleanStr).filter(Boolean).slice(0, cap);
    }
    if (patch.companyName !== undefined) f.companyName = cleanStr(patch.companyName);
    if (patch.companyAddress !== undefined) f.companyAddress = cleanStr(patch.companyAddress);
    var pk = cleanList(patch.pickups, 4);
    if (pk !== null) { f.pickups = pk; f.pickupAddress = pk[0] || ''; }
    if (patch.pickupAddress !== undefined && pk === null) {
      f.pickupAddress = cleanStr(patch.pickupAddress);
      f.pickups = f.pickupAddress ? [f.pickupAddress] : [];
    }
    var dl = cleanList(patch.deliveries, 6);
    if (dl !== null) f.deliveries = dl;
    if (Array.isArray(patch.numbers)) {
      f.numbers = patch.numbers.filter(function (n) { return n && n.value; }).slice(0, 14).map(function (n) {
        return { type: cleanStr(n.type || 'other').slice(0, 40), label: cleanStr(n.label || n.type || 'Number').slice(0, 40), value: cleanStr(n.value).slice(0, 60) };
      });
    }
    /* v459: the named parties and the detail fields are
       patchable on the card the same way */
    if (patch.pickupName !== undefined) f.pickupName = cleanStr(patch.pickupName);
    if (patch.deliveryName !== undefined) f.deliveryName = cleanStr(patch.deliveryName);
    if (Array.isArray(patch.details)) {
      f.details = patch.details.filter(function (d) { return d && d.value && DETAIL_KEYS[d.key]; }).slice(0, 12).map(function (d) {
        return { key: d.key, label: cleanStr(d.label || d.key).slice(0, 40), value: cleanStr(d.value).slice(0, 120), srcLabel: cleanStr(d.srcLabel || '').slice(0, 60) };
      });
    }
    if (st.set(SUGGEST_KEY, all) === false) return null;
    try { learnFromEntry(entry, before); } catch (e) {}
    return entry;
  }

  /* The form fields a suggestion loads, in the dispatch form's own
     field names — identical shape to the drafts dsp_draft carries. */
  function formFieldsFor(entry) {
    var f = (entry && entry.fields) || {};
    /* v457: the structured read lands on the record in labelled
       lines (the form's Notes is the field that carries them
       through the draft machinery), and as its own keys for the
       direct-save door, which keeps every key it is handed. A
       line already in the notes is never duplicated. */
    var notes = f.notes || '';
    var lines = [];
    function addLine(s) {
      if (!s) return;
      if (notes.toLowerCase().indexOf(s.toLowerCase()) !== -1) return;
      if (lines.indexOf(s) !== -1) return;
      lines.push(s);
    }
    if (f.companyAddress) addLine('Company: ' + (f.companyName ? f.companyName + ' — ' : '') + f.companyAddress);
    else if (f.companyName && f.companyName !== f.jobSite) addLine('Company: ' + f.companyName);
    var pks = (f.pickups && f.pickups.length) ? f.pickups : (f.pickupAddress ? [f.pickupAddress] : []);
    /* v459: a party name earns its own line only when it adds
       something the address does not already say (an address's
       leading segment IS its name — never written twice) */
    if (f.pickupName && f.pickupName !== nameOfAddr(pks[0] || '')) addLine('Shipper: ' + f.pickupName);
    pks.forEach(function (a, i) { addLine((pks.length > 1 ? 'Pickup ' + (i + 1) : 'Pickup') + ': ' + a); });
    if (f.deliveryName && f.deliveryName !== nameOfAddr((f.deliveries || [])[0] || '')) addLine('Consignee: ' + f.deliveryName);
    (f.deliveries || []).forEach(function (a, i) { addLine('Delivery ' + (i + 1) + ': ' + a); });
    (f.numbers || []).forEach(function (n) { if (n && n.value) addLine((n.label || n.type || 'Number') + ': ' + n.value); });
    (f.details || []).forEach(function (d) { if (d && d.value) addLine((d.label || d.key || 'Detail') + ': ' + d.value); });
    if (lines.length) notes = notes ? notes + ' · ' + lines.join(' · ') : lines.join(' · ');
    return {
      jobSite: f.jobSite || '',
      scheduledAt: f.scheduledAt || '',
      equipment: f.equipment || '',
      lat: (f.lat !== null && f.lat !== undefined) ? String(f.lat) : '',
      lng: (f.lng !== null && f.lng !== undefined) ? String(f.lng) : '',
      /* v358: the dump pin rides the draft like the main pin */
      dumpLat: (f.dumpLat !== null && f.dumpLat !== undefined) ? String(f.dumpLat) : '',
      dumpLng: (f.dumpLng !== null && f.dumpLng !== undefined) ? String(f.dumpLng) : '',
      material: '',
      ticketNo: '',
      amount: '',
      loads: '1',
      notes: notes,
      driverId: '',
      /* v457: the structured read, kept as itself on the record
         wherever the save door keeps handed keys */
      companyName: f.companyName || '',
      companyAddress: f.companyAddress || '',
      pickupAddress: f.pickupAddress || '',
      pickups: f.pickups || [],
      deliveries: f.deliveries || [],
      numbers: f.numbers || [],
      /* v459: the named parties and the detail fields ride
         along the same way */
      pickupName: f.pickupName || '',
      deliveryName: f.deliveryName || '',
      details: f.details || []
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
    /* v457: a Use is a confirmation — what it carries teaches
       the learn store (address roles, company address, number
       label spellings) for this sender/company. */
    try { learnFromEntry(entry, null); } catch (e) {}
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
      if (!item) { failed++; return; }
      var r = null;
      try { r = intakeBatch(item.text, 'share'); } catch (e) {}
      if (r && r.added.length) added += r.added.length; // a shared multi-day message counts each dispatch
      else if (!r || !r.duplicates) failed++;
    });
    return { added: added, failed: failed };
  }

  window.DispatchIngest = {
    parseDispatchText: parseDispatchText,
    parseDispatchBatch: parseDispatchBatch,
    splitSegments: splitSegments,
    conflicts: conflicts,
    senderHint: senderHint,
    list: list,
    intake: intake,
    intakeBatch: intakeBatch,
    intakeResolved: intakeResolved,
    dismiss: dismiss,
    use: use,
    formFieldsFor: formFieldsFor,
    /* v457 */
    extractDetail: extractDetail,
    updateSuggestionFields: updateSuggestionFields,
    learnFromEntry: learnFromEntry,
    learnSnapshot: function () { return learnStore(); },
    captureShare: captureShare,
    drainShareInbox: drainShareInbox,
    KEYS: { suggest: SUGGEST_KEY, stats: STATS_KEY, inbox: INBOX_KEY, draft: DRAFT_KEY, learn: LEARN_KEY }
  };
})();
