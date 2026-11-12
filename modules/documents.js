/* Documents module — v339 (DOCUMENT-VAULT, owner Nov 5, 2026
 * 17:11 MST: "In the app there should be place to keep all my
 * documents and all my inspections everything!"; second half
 * 17:12: an owner / fleet manager connected through Connect can
 * SEND a document to a driver — renewed ownership, insurance,
 * anything — and it lands in the driver's Documents by itself).
 *
 * One module card, "Documents", holding:
 *  - MY DOCUMENTS: the driver's own paperwork — a photo or a
 *    PDF, a quick label (Licence / Registration / Insurance /
 *    CVIP / Safety / Other) + a name — stored on the record
 *    list docs_items, the same local + cloud-sync pattern as
 *    Fuel's receipt photos (js/cloudsync.js carries docs_items
 *    as an append-only record list; the file bytes ride the
 *    `data` field and shed from the sync copy only when the
 *    whole book outgrows one cloud doc, exactly the v289 fuel
 *    law). View any document full-size any time; delete sits
 *    behind a two-tap confirm, away from the primary action.
 *  - MY INSPECTIONS (v339–v430, REMOVED in v431 — see the
 *    v431 note at the foot of this header): every PTI report
 *    already filed in the app, listed under My documents on
 *    this page. Gone from the face on the owner's ruling;
 *    inspections live in the PTI module.
 *  - SEND (owner / fleet-manager faces): pick a connected
 *    driver, a photo or PDF, a label — the document crosses
 *    through the existing Connect pipe as a 'vaultdoc'
 *    docshare (js/connectpipe.js sendDoc, v307) and the pipe's
 *    inbox landing files it into the DRIVER's docs_items,
 *    marked with who sent it and when. Renewed versions land
 *    beside the older ones — a send never overwrites.
 *
 * Store keys: docs_items (the vault). PTI data is only READ
 * here (pti_reports) — this module files no inspection.
 *
 * v431 (DOCUMENTS-PAGE-INSPECTIONS-REMOVAL, owner Nov 12,
 * 2026): the "🔍 My inspections" list that stood under My
 * documents on this page (the newest 3 + "Show more — N more
 * inspections") is REMOVED, on the owner's ruling confirmed
 * this day: the Documents page holds documents only —
 * licence, registration, insurance. Inspections do NOT
 * belong on this page; they live in their own place, the
 * PTI module, whose own Past inspections list reads the
 * same pti_reports — so the removal strands nothing and no
 * inspection record is touched. The face is now: the Audit
 * button, Add a document, My documents, and (owner faces)
 * Send a document. The module's read of pti_reports stays
 * for the Audit view, which is a separate door and was not
 * named in the ruling.
 */
(function () {
  'use strict';
  var S = function (k, d) { return App._store.get('docs_' + k, d); };
  var W = function (k, v) { return App._store.set('docs_' + k, v); };
  var esc = function (s) { return App._esc(s); };

  var LABELS = ['Licence', 'Registration', 'Insurance', 'CVIP / Safety', 'Other'];
  /* the Firestore-safe ceiling for one pipe doc (js/connect.js
     DOC_SEND_MAX_BYTES — js/cloudsync.js MAX_DOC_BYTES) */
  var WIRE_MAX = 900000;

  /* ---------------- the vault ---------------- */
  function items() {
    var v = S('items', []);
    return Array.isArray(v) ? v : [];
  }
  function saveItemsVerified(list) {
    W('items', list);
    var back = S('items', null);
    return JSON.stringify(back) === JSON.stringify(list);
  }
  function newDocId() {
    return 'doc' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }
  /* One vault record from the Add form (also the shape the
     pipe landing writes for a received document). */
  function buildDoc(input, nowMs) {
    var now = (typeof nowMs === 'number' && isFinite(nowMs) && nowMs > 0) ? nowMs : Date.now();
    var label = String((input && input.label) || 'Other');
    if (LABELS.indexOf(label) === -1) label = 'Other';
    var name = String((input && input.name) || '').trim() || (label === 'Other' ? 'Document' : label);
    return {
      id: newDocId(),
      label: label,
      name: name,
      kind: (input && input.kind === 'pdf') ? 'pdf' : 'image',
      data: String((input && input.data) || ''),
      addedAt: now
    };
  }
  /* v394 (APP-STORAGE-WALL-NOV9): THE ACCOUNT COPY. A document's
     bytes used to live ONLY in this device's local store — the
     sync copy sheds `data` whenever the vault outgrows one cloud
     doc (the v339 law) — so a save the local store refused lost
     the document everywhere (the Nov 5 CVSA report, twice, on
     Nov 9), and this module had no ladder and no fallback of any
     kind. Now every save first writes the FULL record to its own
     account document (the fuel photo-doc law), so the full page
     is in the account whatever the local store can hold; the
     form's save then retries down the fit ladder (960px, 640px —
     the fuel law again) before it reports failure, and the store's
     own relief (js/app.js) frees room from provably-held photo
     caches ahead of all of it. */
  function writeAccountDoc(rec) {
    try {
      if (!(window.FB && FB.saveDoc) || !rec || !rec.id || !rec.data) return;
      if (JSON.stringify(rec).length > WIRE_MAX) return;
      FB.saveDoc('documents', rec.id, { label: rec.label, name: rec.name, kind: rec.kind, data: rec.data, addedAt: rec.addedAt });
    } catch (e) {}
  }
  function saveDocRec(rec) {
    var list = items();
    list.unshift(rec);
    if (!saveItemsVerified(list)) return null;
    return rec;
  }
  function addDoc(input) {
    var rec = buildDoc(input);
    if (!rec.data) return null;
    writeAccountDoc(rec);
    return saveDocRec(rec);
  }
  function deleteDoc(id) {
    var list = items().filter(function (x) { return !x || x.id !== id; });
    return saveItemsVerified(list);
  }
  function fmtDay(ts) {
    try { return new Date(ts).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch (e) { return ''; }
  }
  function fmtWhen(ts) {
    try { return new Date(ts).toLocaleString('en-CA'); } catch (e) { return ''; }
  }

  /* ---------------- inspections (read from PTI) ---------------- */
  function inspections() {
    var reps = [];
    try { reps = App._store.get('pti_reports', []) || []; } catch (e) {}
    if (!Array.isArray(reps)) return [];
    return reps.slice().sort(function (a, b) { return (b.filedAt || 0) - (a.filedAt || 0); });
  }
  /* One inspection's summary parts — Inspection Mode's own
     words (web 327 amendment 1): pre/post, time, odometer,
     ONE result line, signed. When the PTI module is loaded
     its exported _dotSummaryText is the source of truth and
     summaryLine() below defers to it whole; the parts here
     mirror it for the sheet's rows. */
  function summaryParts(r) {
    var kind = (r && r.kind === 'post') ? 'Post-trip' : 'Pre-trip';
    var time = '';
    try { time = new Date(r.filedAt).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }); } catch (e) {}
    var odo = r && r.odometer ? Number(r.odometer).toLocaleString('en-CA') + ' km' : '—';
    var result;
    if (!r || r.result === 'pass' || !r.defects || !r.defects.length) {
      result = 'All items OK';
    } else {
      result = 'Defects: ' + r.defects.map(function (d) {
        return String(d.item || 'Item') + ' (' + (d.severity === 'major' ? 'major' : 'minor') + ')';
      }).join(', ');
    }
    var signed = !!(r && r.signed);
    return { kind: kind, time: time, odo: odo, result: result, signed: signed };
  }
  function summaryLine(r) {
    try {
      var pt = window.Meticulous && Meticulous.modules && Meticulous.modules.pti;
      if (pt && typeof pt._dotSummaryText === 'function') return pt._dotSummaryText(r);
    } catch (e) {}
    var p = summaryParts(r);
    return p.kind + ' · ' + p.time + ' · Odometer ' + p.odo + ' · ' + p.result + ' · ' + (p.signed ? 'Signed' : 'NOT signed');
  }

  /* ---------------- Connect send (owner -> driver) ---------------- */
  function connectedPeers() {
    try {
      if (window.ConnectPipe && ConnectPipe.connectedPeers) return ConnectPipe.connectedPeers();
    } catch (e) {}
    return [];
  }
  function peerName(c) {
    return (c && (c.name || c.business)) || 'Connected driver';
  }
  /* The wire guard, the v307/v312 discipline restated for the
     vault: content that fits crosses as-is; an oversize IMAGE
     is shrunk once through the pipe's own rendition door; a
     PDF that cannot fit is refused plainly (never sent cut). */
  function wireContent(content) {
    if (!content || !content.data) return Promise.resolve(null);
    if (JSON.stringify(content).length <= WIRE_MAX) return Promise.resolve(content);
    if (content.kind !== 'pdf') {
      try {
        if (window.ConnectPipe && ConnectPipe._rendition) {
          return ConnectPipe._rendition(content.data).then(function (url) {
            if (!url) return null;
            var c2 = { label: content.label, name: content.name, kind: content.kind, data: url };
            return JSON.stringify(c2).length <= WIRE_MAX ? c2 : null;
          }).catch(function () { return null; });
        }
      } catch (e) {}
    }
    return Promise.resolve(null);
  }
  /* Send ONE vault document to a connected driver through the
     pipe's existing document channel (docType 'vaultdoc').
     Resolves 'sent' | 'error' | 'toobig'. The driver's side
     files it by itself (connectpipe pullInbox) — receive and
     store only. */
  function sendToPeer(peerUid, doc) {
    var CP = null;
    try { CP = window.ConnectPipe; } catch (e) {}
    if (!CP || !CP.sendDoc || !peerUid || !doc || !doc.data) return Promise.resolve('error');
    var content = {
      label: String(doc.label || 'Other'), name: String(doc.name || ''),
      kind: doc.kind === 'pdf' ? 'pdf' : 'image', data: String(doc.data)
    };
    return wireContent(content).then(function (wire) {
      if (!wire) return 'toobig';
      return CP.sendDoc(peerUid, {
        type: 'vaultdoc',
        label: wire.name || wire.label,
        content: wire,
        shareId: CP.newShareId ? CP.newShareId() : ''
      });
    }).catch(function () { return 'error'; });
  }

  /* ---------------- view state ---------------- */
  var view = { mode: 'main', id: null };   // 'main' | 'doc' | 'insp' | 'audit'
  var viewFrom = 'main';   // where a detail view returns to ('main' | 'audit')
  var delArm = false;
  var docsShowAll = false;
  var addPending = null;    // {kind, data, fileName} held by the Add form
  var addLabel = 'Other';
  var addErr = '';
  var sendPending = null;   // {kind, data, fileName} held by the Send form
  var sendLabel = 'Other';
  var sendNote = '';
  var docsBody = null;
  var pulling = false;

  function roleNow() {
    try { return (App.userRole && App.userRole()) || ''; } catch (e) { return ''; }
  }

  /* ---------------- file capture ----------------
     A photo is downscaled before it is stored (the Damage
     module's house canvas pattern, 1280px / JPEG 0.8 — raw
     camera files overflow the local store). A PDF rides as
     read: there is no honest way to shrink one here. */
  function readFile(file, done) {
    var isPdf = !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(String(file.name || '')));
    var r = new FileReader();
    r.onload = function () {
      if (isPdf) { done({ kind: 'pdf', data: String(r.result || ''), fileName: String(file.name || 'document.pdf') }); return; }
      var raw = String(r.result || '');
      try {
        var img = new Image();
        img.onload = function () {
          var max = 1280, w = img.width, h = img.height;
          if (w > max || h > max) {
            var sc = Math.min(max / w, max / h);
            w = Math.round(w * sc); h = Math.round(h * sc);
          }
          try {
            var c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            done({ kind: 'image', data: c.toDataURL('image/jpeg', 0.8), fileName: String(file.name || '') });
          } catch (e) { done({ kind: 'image', data: raw, fileName: String(file.name || '') }); }
        };
        img.onerror = function () { done({ kind: 'image', data: raw, fileName: String(file.name || '') }); };
        img.src = raw;
      } catch (e) { done({ kind: 'image', data: raw, fileName: String(file.name || '') }); }
    };
    r.onerror = function () { done(null); };
    r.readAsDataURL(file);
  }
  function openPdf(dataUrl) {
    try {
      var parts = String(dataUrl).split(',');
      var bin = atob(parts[1] || '');
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
      window.open(url, '_blank');
    } catch (e) {}
  }

  /* ---------------- pieces of the face ---------------- */
  function labelChips(prefix, current) {
    return '<div style="display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 8px">' + LABELS.map(function (l) {
      return '<button type="button" class="btn small ' + (l === current ? 'primary' : 'ghost') + '" data-' + prefix + 'label="' + esc(l) + '">' + esc(l) + '</button>';
    }).join('') + '</div>';
  }
  function fileButtons(prefix) {
    return '<div style="display:flex;gap:10px;margin-bottom:8px;">' +
      '<button type="button" class="btn secondary" id="' + prefix + '_cam" style="flex:1;">📷 Take photo</button>' +
      '<button type="button" class="btn secondary" id="' + prefix + '_pick" style="flex:1;">📁 Photo or PDF</button>' +
      '</div>' +
      '<input type="file" id="' + prefix + '_cam_in" accept="image/*" capture="environment" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
      '<input type="file" id="' + prefix + '_in" accept="image/*,.pdf,application/pdf" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">';
  }
  function pendingLine(p) {
    if (!p) return '';
    return p.kind === 'pdf'
      ? '<div class="note" style="margin-top:6px">📄 ' + esc(p.fileName || 'PDF ready') + ' — ready to save.</div>'
      : '<img src="' + p.data + '" style="width:100%;border-radius:10px;margin-top:10px">';
  }

  function renderMain(body) {
    var role = roleNow();
    var docs = items();
    var peers = connectedPeers();
    var canSend = (role === 'office' || role === 'both') && peers.length > 0;
    var h = '<button class="btn small ghost" id="docs_audit_btn" style="margin-bottom:10px">🔎 Audit</button>';

    /* ---- Add a document ---- */
    h += '<div class="card"><h3 style="margin-top:0">＋ Add a document</h3>' +
      '<label class="f">📷 Document — photo or PDF</label>' +
      fileButtons('docs') +
      '<div id="docs_prev">' + pendingLine(addPending) + '</div>' +
      '<label class="f">Label</label>' + labelChips('doc', addLabel) +
      '<label class="f">Name</label><input id="docs_name" placeholder="e.g. Truck insurance 2026">' +
      (addErr ? '<div style="color:#c2410c;font-weight:600;margin:8px 0">⚠️ ' + esc(addErr) + '</div>' : '') +
      '<button class="btn primary" id="docs_save" style="width:100%">Save document</button></div>';

    /* ---- My documents ---- */
    var shownDocs = docsShowAll ? docs : docs.slice(0, 3);
    h += '<div class="card"><h3 style="margin-top:0">📁 My documents</h3>' +
      (docs.length ? shownDocs.map(function (d) {
        return '<div class="listitem" data-doc-open="' + esc(d.id) + '" style="cursor:pointer">' +
          '<div class="a">' + (d.kind === 'pdf' ? '📄 ' : '🖼 ') + esc(d.name || 'Document') +
          '<span style="float:right;color:var(--muted);font-weight:400">›</span></div>' +
          '<div class="b">' + esc(d.label || '') + ' · ' + esc(fmtDay(d.addedAt)) +
          (d.sentBy ? ' · From ' + esc(d.sentBy) : '') + '</div></div>';
      }).join('') : '<div class="empty">No documents yet — add your licence, registration or insurance above.</div>') +
      (docs.length > 3
        ? '<button class="btn ghost" id="docs_more" style="width:100%;margin-top:8px">' +
          (docsShowAll ? 'Show less' : 'Show more — ' + (docs.length - 3) + ' more document' + (docs.length - 3 === 1 ? '' : 's')) + '</button>'
        : '') + '</div>';

    /* ---- v431: NO inspections list on this page. The
       "🔍 My inspections" card that stood here is removed on
       the owner's ruling (Nov 12, 2026): documents only on
       the Documents page; inspections live in the PTI
       module. ---- */

    /* ---- Send a document to a driver (owner faces) ---- */
    if (canSend) {
      h += '<div class="card"><h3 style="margin-top:0">📤 Send a document to a driver</h3>' +
        '<p class="note" style="margin-top:0">Renewed ownership, insurance, anything — it lands in the driver\'s Documents by itself, with your name on it. A new version never replaces the old one.</p>' +
        '<label class="f">Driver</label><select id="docs_send_peer">' +
        peers.map(function (c) {
          return '<option value="' + esc(c.uid) + '">' + esc(peerName(c)) + '</option>';
        }).join('') + '</select>' +
        '<label class="f">📷 Document — photo or PDF</label>' +
        fileButtons('docs_s') +
        '<div id="docs_s_prev">' + pendingLine(sendPending) + '</div>' +
        '<label class="f">Label</label>' + labelChips('send', sendLabel) +
        '<label class="f">Name</label><input id="docs_send_name" placeholder="e.g. Insurance renewal 2026">' +
        '<div id="docs_send_note">' + (sendNote ? '<p class="note" style="margin-top:6px">' + esc(sendNote) + '</p>' : '') + '</div>' +
        '<button class="btn primary" id="docs_send_btn" style="width:100%">Send document</button></div>';
    }

    body.innerHTML = h;
    wireMain(body, canSend);
    /* A document an owner sent lands through the pipe's inbox
       (the same pull Dispatch and Connect ride); if anything
       new landed, repaint once so it is simply THERE. */
    try {
      if (window.ConnectPipe && ConnectPipe.pullInbox && !pulling) {
        pulling = true;
        ConnectPipe.pullInbox().then(function (n) {
          pulling = false;
          if (n > 0 && docsBody === body) Meticulous.modules.documents.render(body);
        }).catch(function () { pulling = false; });
      }
    } catch (e) { pulling = false; }
  }

  function wireMain(body, canSend) {
    var auditB = body.querySelector('#docs_audit_btn');
    if (auditB) auditB.onclick = function () {
      view = { mode: 'audit', id: null };
      Meticulous.modules.documents.render(body);
    };
    /* Add form */
    var camIn = body.querySelector('#docs_cam_in'), pickIn = body.querySelector('#docs_in');
    var camB = body.querySelector('#docs_cam'), pickB = body.querySelector('#docs_pick');
    if (camB && camIn) camB.onclick = function () { camIn.click(); };
    if (pickB && pickIn) pickB.onclick = function () { pickIn.click(); };
    function onAddFile(ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      readFile(file, function (p) {
        if (!p) { addErr = 'That file could not be read — try again.'; Meticulous.modules.documents.render(body); return; }
        addPending = p; addErr = '';
        var prev = body.querySelector('#docs_prev');
        if (prev) prev.innerHTML = pendingLine(p);
      });
    }
    if (camIn) camIn.onchange = onAddFile;
    if (pickIn) pickIn.onchange = onAddFile;
    body.querySelectorAll('[data-doclabel]').forEach(function (b) {
      b.onclick = function () {
        addLabel = b.getAttribute('data-doclabel') || 'Other';
        Meticulous.modules.documents.render(body);
      };
    });
    var saveB = body.querySelector('#docs_save');
    if (saveB) saveB.onclick = function () {
      if (!addPending || !addPending.data) { addErr = 'Add the photo or PDF first, then save.'; Meticulous.modules.documents.render(body); return; }
      var nameEl = body.querySelector('#docs_name');
      /* v394: build ONCE (one id), write the account copy with
         the FULL page, then the local save — and on a refusal,
         the fit ladder (960px, then 640px; the fuel law) before
         the save is given up. The account copy already holds
         the full page either way. */
      var rec0 = buildDoc({ label: addLabel, name: nameEl ? nameEl.value : '', kind: addPending.kind, data: addPending.data });
      if (!rec0.data) { addErr = 'Add the photo or PDF first, then save.'; Meticulous.modules.documents.render(body); return; }
      writeAccountDoc(rec0);
      var done394 = function () { addPending = null; addErr = ''; Meticulous.modules.documents.render(body); };
      var fail394 = function () { addErr = 'The document could NOT be saved on this phone — storage may be full. Nothing was saved.'; Meticulous.modules.documents.render(body); };
      if (saveDocRec(rec0)) { done394(); return; }
      if (rec0.kind === 'image' && window.TicketOCR && TicketOCR.shrinkDataUrl) {
        TicketOCR.shrinkDataUrl(rec0.data, 960, function (s1) {
          if (s1 && s1 !== rec0.data && saveDocRec(Object.assign({}, rec0, { data: s1 }))) { done394(); return; }
          TicketOCR.shrinkDataUrl(rec0.data, 640, function (s2) {
            if (s2 && s2 !== rec0.data && saveDocRec(Object.assign({}, rec0, { data: s2 }))) { done394(); return; }
            fail394();
          });
        });
        return;
      }
      fail394();
    };
    var moreB = body.querySelector('#docs_more');
    if (moreB) moreB.onclick = function () { docsShowAll = !docsShowAll; Meticulous.modules.documents.render(body); };
    body.querySelectorAll('[data-doc-open]').forEach(function (elx) {
      elx.onclick = function () {
        viewFrom = 'main';
        view = { mode: 'doc', id: elx.getAttribute('data-doc-open') };
        delArm = false;
        Meticulous.modules.documents.render(body);
      };
    });
    /* v431: the face's [data-insp-open] wiring went with the
       removed list — the Audit view wires its own rows. */

    if (!canSend) return;
    /* Send form */
    var sCamIn = body.querySelector('#docs_s_cam_in'), sPickIn = body.querySelector('#docs_s_in');
    var sCamB = body.querySelector('#docs_s_cam'), sPickB = body.querySelector('#docs_s_pick');
    if (sCamB && sCamIn) sCamB.onclick = function () { sCamIn.click(); };
    if (sPickB && sPickIn) sPickB.onclick = function () { sPickIn.click(); };
    function onSendFile(ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      readFile(file, function (p) {
        if (!p) { sendNote = 'That file could not be read — try again.'; Meticulous.modules.documents.render(body); return; }
        sendPending = p; sendNote = '';
        var prev = body.querySelector('#docs_s_prev');
        if (prev) prev.innerHTML = pendingLine(p);
      });
    }
    if (sCamIn) sCamIn.onchange = onSendFile;
    if (sPickIn) sPickIn.onchange = onSendFile;
    body.querySelectorAll('[data-sendlabel]').forEach(function (b) {
      b.onclick = function () {
        sendLabel = b.getAttribute('data-sendlabel') || 'Other';
        Meticulous.modules.documents.render(body);
      };
    });
    var sendB = body.querySelector('#docs_send_btn');
    if (sendB) sendB.onclick = function () {
      var sel = body.querySelector('#docs_send_peer');
      var uid = sel ? sel.value : '';
      if (!uid) { sendNote = 'Pick the driver first.'; Meticulous.modules.documents.render(body); return; }
      if (!sendPending || !sendPending.data) { sendNote = 'Add the photo or PDF first, then send.'; Meticulous.modules.documents.render(body); return; }
      var nameEl = body.querySelector('#docs_send_name');
      var doc = { label: sendLabel, name: nameEl ? nameEl.value : '', kind: sendPending.kind, data: sendPending.data };
      if (!doc.name) doc.name = sendLabel === 'Other' ? 'Document' : sendLabel;
      sendNote = 'Sending…';
      Meticulous.modules.documents.render(body);
      sendToPeer(uid, doc).then(function (r) {
        if (r === 'sent') { sendPending = null; sendNote = '✓ Sent — it lands in the driver\'s Documents by itself.'; }
        else if (r === 'toobig') { sendNote = 'That file is too large to send — it was not sent.'; }
        else { sendNote = 'Couldn\'t send — check your connection and try again. The document was not sent.'; }
        Meticulous.modules.documents.render(body);
      });
    };
  }

  /* ---------------- detail views ---------------- */
  function renderDocDetail(body, d) {
    var h = '<div class="card"><button class="btn small ghost" id="docs_back">‹ Back</button>' +
      '<h3 style="margin-top:10px">' + (d.kind === 'pdf' ? '📄 ' : '🖼 ') + esc(d.name || 'Document') + '</h3>' +
      '<div class="kv"><span>Label</span><b>' + esc(d.label || '') + '</b></div>' +
      '<div class="kv"><span>Added</span><b>' + esc(fmtWhen(d.addedAt)) + '</b></div>' +
      (d.sentBy ? '<div class="kv"><span>Sent by</span><b>' + esc(d.sentBy) + (d.sentAt ? ' · ' + esc(fmtWhen(d.sentAt)) : '') + '</b></div>' : '') +
      (d.kind === 'pdf'
        ? '<button class="btn primary" id="docs_open_pdf" style="width:100%;margin-top:12px">📄 Open the PDF</button>'
        : '<img src="' + d.data + '" style="width:100%;border-radius:10px;margin-top:10px">' +
          (App._photoDl ? App._photoDl(d.data, 'document-' + (d.label || '')) : '')) +
      '<div style="margin-top:16px;border-top:1px solid #eef1f6;padding-top:10px">' +
      '<button class="btn ghost" id="docs_del" style="color:#c2410c">' + (delArm ? 'Tap again to delete this document' : '🗑 Delete document') + '</button></div></div>';
    body.innerHTML = h;
    body.querySelector('#docs_back').onclick = function () {
      view = { mode: viewFrom === 'audit' ? 'audit' : 'main', id: null }; delArm = false;
      Meticulous.modules.documents.render(body);
    };
    var openB = body.querySelector('#docs_open_pdf');
    if (openB) openB.onclick = function () { openPdf(d.data); };
    body.querySelector('#docs_del').onclick = function () {
      if (!delArm) { delArm = true; Meticulous.modules.documents.render(body); return; }
      delArm = false;
      if (deleteDoc(d.id)) view = { mode: viewFrom === 'audit' ? 'audit' : 'main', id: null };
      Meticulous.modules.documents.render(body);
    };
  }

  function renderInspSheet(body, r) {
    var p = summaryParts(r);
    var kv = function (k, v) { return '<div class="kv"><span>' + k + '</span><b>' + esc(v) + '</b></div>'; };
    var h = '<div class="card"><button class="btn small ghost" id="docs_back">‹ Back</button>' +
      '<h3 style="margin-top:10px">🔍 Inspection summary</h3>' +
      kv('Date', String(r.date || '')) +
      kv('Inspection', p.kind) +
      kv('Time', p.time) +
      kv('Odometer', p.odo) +
      kv('Result', p.result) +
      kv('Signed', p.signed ? 'Signed' : 'NOT signed') +
      '<p class="note" style="margin-top:10px">This is the summary an officer sees in Inspection Mode. The full report lives in the PTI module.</p></div>';
    body.innerHTML = h;
    body.querySelector('#docs_back').onclick = function () {
      view = { mode: viewFrom === 'audit' ? 'audit' : 'main', id: null };
      Meticulous.modules.documents.render(body);
    };
  }

  /* ---------------- v340: the Audit view ----------------
     AUDIT-BUTTON-EVERY-MODULE (owner Nov 5, 2026 17:16 MST):
     the COMPLETE history in date order — every document and
     every inspection, uncapped (the face lists show the
     newest 3; an auditor goes through ALL of them). A tap
     opens the same detail / summary sheet as the face, and
     Back from there returns here. */
  function renderAudit(body) {
    var role = roleNow();
    /* the audit sorts by arrival explicitly — an auditor's
       list must be date-true even if a store was ever written
       out of order (the face rides the store's newest-first
       invariant; the audit does not assume it). */
    var docs = items().slice().sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); });
    var insps = inspections();
    var h = '<button class="btn small ghost" id="docs_back" style="margin-bottom:10px">‹ Back</button>' +
      '<div class="card"><h3 style="margin-top:0">🔎 Audit — Documents</h3>' +
      '<p class="note" style="margin-top:0">Every document in the vault, newest first — ' + docs.length + ' on file.</p>' +
      (docs.length ? docs.map(function (d) {
        return '<div class="listitem" data-doc-open="' + esc(d.id) + '" style="cursor:pointer">' +
          '<div class="a">' + (d.kind === 'pdf' ? '📄 ' : '🖼 ') + esc(d.name || 'Document') +
          '<span style="float:right;color:var(--muted);font-weight:400">›</span></div>' +
          '<div class="b">' + esc(d.label || '') + ' · ' + esc(fmtDay(d.addedAt)) +
          (d.sentBy ? ' · From ' + esc(d.sentBy) : '') + '</div></div>';
      }).join('') : '<div class="empty">No documents on file.</div>') + '</div>';
    if (role !== 'office') {
      h += '<div class="card"><h3 style="margin-top:0">🔎 Audit — Inspections</h3>' +
        '<p class="note" style="margin-top:0">Every inspection filed, newest first — ' + insps.length + ' on file.</p>' +
        (insps.length ? insps.map(function (r) {
          return '<div class="listitem" data-insp-open="' + esc(r.id) + '" style="cursor:pointer">' +
            '<div class="a">' + esc(r.date || '') +
            '<span style="float:right;color:var(--muted);font-weight:400">›</span></div>' +
            '<div class="b">' + esc(summaryLine(r)) + '</div></div>';
        }).join('') : '<div class="empty">No inspections on file.</div>') + '</div>';
    }
    body.innerHTML = h;
    body.querySelector('#docs_back').onclick = function () {
      view = { mode: 'main', id: null };
      Meticulous.modules.documents.render(body);
    };
    body.querySelectorAll('[data-doc-open]').forEach(function (elx) {
      elx.onclick = function () {
        viewFrom = 'audit';
        view = { mode: 'doc', id: elx.getAttribute('data-doc-open') };
        delArm = false;
        Meticulous.modules.documents.render(body);
      };
    });
    body.querySelectorAll('[data-insp-open]').forEach(function (elx) {
      elx.onclick = function () {
        viewFrom = 'audit';
        view = { mode: 'insp', id: elx.getAttribute('data-insp-open') };
        Meticulous.modules.documents.render(body);
      };
    });
  }

  Meticulous.modules.documents = {
    status: function () {
      var n = items().length;
      return n ? n + ' document' + (n === 1 ? '' : 's') : 'No documents yet';
    },
    back: function () {
      if (view.mode === 'doc' || view.mode === 'insp') {
        view = { mode: viewFrom === 'audit' ? 'audit' : 'main', id: null }; delArm = false;
        if (docsBody) Meticulous.modules.documents.render(docsBody);
        return true;
      }
      if (view.mode === 'audit') {
        view = { mode: 'main', id: null };
        if (docsBody) Meticulous.modules.documents.render(docsBody);
        return true;
      }
      return false;
    },
    resetView: function () {
      view = { mode: 'main', id: null }; delArm = false; viewFrom = 'main';
      docsShowAll = false;
    },
    render: function (body) {
      docsBody = body;
      if (view.mode === 'audit') { renderAudit(body); return; }
      if (view.mode === 'doc' && view.id) {
        var d = null;
        items().forEach(function (x) { if (x && x.id === view.id) d = x; });
        if (d) { renderDocDetail(body, d); return; }
        view = { mode: 'main', id: null };
      }
      if (view.mode === 'insp' && view.id) {
        var r = null;
        inspections().forEach(function (x) { if (x && x.id === view.id) r = x; });
        if (r) { renderInspSheet(body, r); return; }
        view = { mode: 'main', id: null };
      }
      renderMain(body);
    },
    /* test hooks */
    _items: items,
    _buildDoc: buildDoc,
    _addDoc: addDoc,
    _deleteDoc: deleteDoc,
    _inspections: inspections,
    _summaryParts: summaryParts,
    _summaryLine: summaryLine,
    _sendToPeer: sendToPeer,
    _labels: LABELS,
    _viewMode: function () { return view.mode; }
  };
})();
