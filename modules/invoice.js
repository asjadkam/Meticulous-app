/* Invoice / Pay Stub module (Meticulous.modules convention)
   Contractor: period-based lines from revenue + manual items, province-based
   tax (editable), invoice numbering, print. Payroll: manual deductions only —
   nothing auto-calculated, never defaults to US rules; country/province
   required from Preferences before use. */
(function () {
  'use strict';
  var S = function (k, d) { return App._store.get('inv_' + k, d); };
  var W = function (k, v) { return App._store.set('inv_' + k, v); }; // v55: returns write result
  var esc = function (s) { return App._esc(s); };

  /* Canadian GST/HST by province — prefill only, always editable */
  var CA_TAX = { AB: 5, BC: 5, MB: 5, NB: 15, NL: 15, NS: 15, NT: 5, NU: 5, ON: 13, PE: 15, QC: 5, SK: 5, YT: 5 };

  function onb() { return App._store.get('onboarding', {}); }
  function invoices() { return S('list', []); }
  function paystubs() { return S('stubs', []); }

  function defaultTaxRate(o) {
    if (o.country === 'Canada' && o.province && CA_TAX[o.province]) return CA_TAX[o.province];
    return 0;
  }

  function nextInvNo() { return invCycNextNo(invoices()); }

  /* ================= INV-CYCLE-BEGIN =================
     v55: the invoice CYCLE — semi-monthly periods, verified issuing,
     automatic rollover. Pure date/numbering helpers plus one
     store-mediated issue function; harness-extractable
     (tools/invoice-cycle-test.js runs this region verbatim).

     Periods: 1st–15th and 16th–last day of the month. The OPEN period
     is the period after the most recently issued invoice's period end
     (records carry pa/pb from this version on; for an older record
     without pb, fall back to the period containing its date). With no
     issued invoices, the open period is the one containing today.

     Issuing is VERIFIED (the v48 rule): the inv_list write must read
     back before anything else happens. On failure the draft stays
     exactly as it was and nothing prints. Only a verified save starts
     the new cycle: the draft is cleared, the period inputs advance to
     the new open period, and a one-shot confirmation is stored for
     the next render.

     Numbering: a typed number wins; an empty number auto-assigns
     max(numeric issued #) + 1, or 1 when no issued number is numeric.
     A typed number that collides with an issued one is refused.
     "(auto on save)" is a placeholder, never a value — a legacy draft
     still carrying it as a value is treated as empty. */
  var INV_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function invS(k, d) { return App._store.get('inv_' + k, d); }
  function invW(k, v) { return App._store.set('inv_' + k, v); }

  function invCycDim(y, m) {
    var t = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (m === 2 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) return 29;
    return t[m - 1];
  }
  function invCycParse(s) {
    if (typeof s !== 'string') return null;
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > invCycDim(y, mo)) return null;
    return { y: y, m: mo, d: d };
  }
  function invCycFmt(y, m, d) { return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2); }
  function invCycDayAfter(s) {
    var p = invCycParse(s); if (!p) return null;
    var dt = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
    return invCycFmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  /* The semi-monthly period containing a date: {a, b} as ISO dates. */
  function invCycPeriodOf(s) {
    var p = invCycParse(s); if (!p) return null;
    if (p.d <= 15) return { a: invCycFmt(p.y, p.m, 1), b: invCycFmt(p.y, p.m, 15) };
    return { a: invCycFmt(p.y, p.m, 16), b: invCycFmt(p.y, p.m, invCycDim(p.y, p.m)) };
  }
  function invCycNextPeriod(p) { return invCycPeriodOf(invCycDayAfter(p.b)); }
  function invCycOpenPeriod(list, today) {
    var maxB = null;
    (list || []).forEach(function (r) {
      if (!r) return;
      var end = invCycParse(r.pb) ? r.pb : (invCycParse(r.date) ? r.date : (invCycParse(r.at) ? r.at : null));
      if (!end) return;
      var per = invCycPeriodOf(end);
      if (per && (!maxB || per.b > maxB)) maxB = per.b;
    });
    if (maxB) return invCycPeriodOf(invCycDayAfter(maxB));
    return invCycPeriodOf(today);
  }
  function invCycShort(p) {
    var a = invCycParse(p && p.a), b = invCycParse(p && p.b);
    if (!a || !b) return '';
    return INV_MON[a.m - 1] + ' ' + a.d + '–' + b.d;
  }
  function invCycLabel(p) {
    var a = invCycParse(p && p.a), s = invCycShort(p);
    return a && s ? s + ', ' + a.y : s;
  }
  function invCycDateShort(s) {
    var p = invCycParse(s);
    return p ? INV_MON[p.m - 1] + ' ' + p.d : String(s || '');
  }
  /* Numeric value of an issued invoice number: the number itself for
     plain numbers ("10" -> 10), the trailing group for formatted ones
     ("INV-2026-0007" -> 7); null when it carries no digits. */
  function invCycNoValue(no) {
    if (no === null || no === undefined) return null;
    var s = String(no).trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    var m = s.match(/(\d+)\s*$/);
    return m ? parseInt(m[1], 10) : null;
  }
  function invCycNextNo(list) {
    var max = 0;
    (list || []).forEach(function (r) {
      var v = invCycNoValue(r && r.no);
      if (v !== null && v > max) max = v;
    });
    return String(max + 1);
  }
  function invCycCollision(list, no) {
    var t = String(no || '').trim().toLowerCase();
    if (!t) return false;
    return (list || []).some(function (r) {
      return !!r && String(r.no || '').trim().toLowerCase() === t;
    });
  }
  /* Dates whose invoice lines come from BOTH a dispatch completion
     and the tracker — the classic double count. Lines carry
     {date, src} (see revenueLines). Returns short labels, sorted. */
  function invCycDupDates(lines) {
    var byDate = {};
    (lines || []).forEach(function (l) {
      if (!l || !l.date) return;
      if (l.src !== 'dispatch' && l.src !== 'tracker') return;
      var m = byDate[l.date] || (byDate[l.date] = {});
      m[l.src] = true;
    });
    var out = [];
    Object.keys(byDate).sort().forEach(function (d) {
      if (byDate[d].dispatch && byDate[d].tracker) out.push(invCycDateShort(d));
    });
    return out;
  }
  function invVerifyIssued(id) {
    var l = invS('list', []);
    for (var i = 0; i < l.length; i++) { if (l[i] && l[i].id === id) return true; }
    return false;
  }
  /* Verified issue + cycle rollover. x: {draft, revLines, sub, tax,
     total, pa, pb, today, now?, company, province, country}.
     Returns {ok:true, rec, next} or {ok:false, stage, message}.
     On failure NOTHING is written that matters: the list is only
     replaced by a verified write, and the draft is left untouched. */
  function invIssue(x) {
    var draft = x.draft || {};
    var list = invS('list', []);
    var typed = String(draft.no || '').trim();
    if (typed === '(auto on save)') typed = '';
    var no;
    if (typed) {
      if (invCycCollision(list, typed)) {
        return {
          ok: false, stage: 'collision',
          message: 'Invoice #' + typed + ' has already been issued. Type a different number — nothing was saved and your draft is unchanged.'
        };
      }
      no = typed;
    } else {
      no = invCycNextNo(list);
    }
    var rec = {
      id: 'inv' + (x.now || Date.now()), no: no, date: draft.date, billTo: draft.billTo,
      pa: x.pa, pb: x.pb,
      revLines: x.revLines, items: (draft.items || []).slice(),
      taxRate: Number(draft.taxRate) || 0, sub: x.sub, tax: x.tax, total: x.total,
      notes: draft.notes, company: x.company,
      province: x.province, country: x.country, at: x.today
    };
    var newList = list.slice(); newList.push(rec);
    if (invW('list', newList) === false || !invVerifyIssued(rec.id)) {
      return {
        ok: false, stage: 'write',
        message: 'Invoice #' + no + ' could not be saved — nothing was printed and your draft is unchanged. Check storage or connection, then try again.'
      };
    }
    /* Verified — the invoice is archived. Start the new cycle: clear
       the whole draft and advance the period to the new open period. */
    invW('draft', null);
    var next = invCycOpenPeriod(newList, x.today);
    if (next) { invW('pa', next.a); invW('pb', next.b); }
    invW('cycmsg', 'Invoice #' + no + ' saved for ' + invCycShort({ a: x.pa, b: x.pb }) +
      '. Next period: ' + invCycShort(next) + '.');
    return { ok: true, rec: rec, next: next };
  }
  /* ================= INV-CYCLE-END ================= */

  /* Where a stored revenue entry came from — dispatch completions
     keep their "Dispatch: …" note through revenue.addEntry, tracker
     sessions carry auto/'Auto from tracker'. Used by the duplicate-
     date heads-up (invCycDupDates); not shown on the invoice. */
  function entrySrc(e) {
    if (!e) return 'entry';
    if (e.auto) return 'tracker';
    var n = e.note || '';
    if (n.indexOf('Dispatch:') === 0) return 'dispatch';
    if (n === 'Auto from tracker') return 'tracker';
    return 'entry';
  }

  /* lines from revenue entries + extras inside a period, using pay standard */
  function revenueLines(a, b) {
    var o = onb();
    var rate = parseFloat(o.payRate) || 0;
    var std = (o.payStandard || '').toLowerCase();
    var entries = App._store.get('rev_entries', []).filter(function (e) { return e.date >= a && e.date <= b; });
    var extras = App._store.get('rev_extras', []).filter(function (x) { return x.date >= a && x.date <= b; });
    var lines = [];
    entries.forEach(function (e) {
      var amt = 0, desc = '';
      if (std === 'hourly') { amt = (parseFloat(e.hours) || 0) * rate; desc = (e.hours || 0) + ' hrs @ $' + rate; }
      else if (std === 'miles') { amt = (parseFloat(e.miles) || 0) * rate; desc = (e.miles || 0) + ' mi @ $' + rate; }
      else if (std === 'trip') { amt = (parseFloat(e.trips) || 0) * rate; desc = (e.trips || 0) + ' trips @ $' + rate; }
      else if (std === 'weight') { amt = (parseFloat(e.tons) || 0) * rate; desc = (e.tons || 0) + ' tons @ $' + rate; }
      else { amt = parseFloat(e.amount) || 0; desc = e.note || e.date; }
      if (amt > 0) lines.push({ desc: desc + ' — ' + e.date, amt: amt, date: e.date, src: entrySrc(e) });
    });
    extras.forEach(function (x) {
      var v = parseFloat(x.amount) || 0;
      if (v !== 0) lines.push({ desc: (x.type || 'Extra') + ' — ' + x.date, amt: v, date: x.date, src: 'extra' });
    });
    return lines;
  }

  function jurisdictionBanner() {
    var o = onb();
    if (o.country && o.province) return '';
    return '<div class="card" style="border-left:4px solid #d23b3b">' +
      '<h3>⚠️ Set your location first</h3>' +
      '<p class="note">Tax and payroll rules depend on your country and province/state. ' +
      'Add them in Preferences before creating invoices or pay stubs — the app will not guess for you.</p>' +
      '<button class="btn navy small" id="iv_goprefs">Open Preferences</button></div>';
  }

  function printDoc(title, bodyHtml) {
    var w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { alert('Pop-up blocked — allow pop-ups to print.'); return; }
    w.document.write('<!DOCTYPE html><html><head><title>' + esc(title) + '</title><style>' +
      'body{font-family:Arial,Helvetica,sans-serif;color:#1a2340;max-width:720px;margin:24px auto;padding:0 16px;}' +
      'h1{color:#1F3764;margin:0 0 4px;}h2{color:#1F3764;border-bottom:3px solid #F26522;padding-bottom:6px;}' +
      'table{width:100%;border-collapse:collapse;margin:14px 0;}' +
      'th{background:#1F3764;color:#fff;text-align:left;padding:8px;}td{padding:8px;border-bottom:1px solid #dfe4f2;}' +
      '.tot{text-align:right;font-weight:700;}.muted{color:#6b7690;font-size:13px;}' +
      '.row{display:flex;justify-content:space-between;margin:4px 0;}' +
      '</style></head><body>' + bodyHtml + '</body></html>');
    w.document.close(); w.focus();
    setTimeout(function () { w.print(); }, 400);
  }

  /* ---------------- contractor invoice ---------------- */
  function renderInvoice(body) {
    var o = onb();
    var draft = S('draft', null) || {
      items: [], taxRate: defaultTaxRate(o),
      billTo: o.contractingCo || '', no: null, date: App._today(), notes: ''
    };
    /* Legacy drafts (pre-v55) could hold the placeholder text as the
       # value — it is not a number; treat it as empty. */
    if (draft.no === '(auto on save)') draft.no = null;
    function saveDraft() { W('draft', draft); }

    function totals(lines) {
      var sub = 0;
      lines.forEach(function (l) { sub += l.amt; });
      draft.items.forEach(function (it) { sub += (Number(it.qty) || 0) * (Number(it.rate) || 0); });
      var tax = sub * (Number(draft.taxRate) || 0) / 100;
      return { sub: sub, tax: tax, total: sub + tax };
    }

    function draw() {
      var openP = invCycOpenPeriod(invoices(), App._today());
      var pa = S('pa', null), pb = S('pb', null);
      if (!pa || !pb) { pa = openP.a; pb = openP.b; }
      var revLines = revenueLines(pa, pb);
      var t = totals(revLines);
      var h = jurisdictionBanner();
      var cycMsg = S('cycmsg', ''); if (cycMsg) W('cycmsg', '');
      var errMsg = S('err', ''); if (errMsg) W('err', '');
      if (cycMsg) h += '<div class="card" style="border-left:4px solid #2e9e5b"><p class="note" style="margin:0">✅ ' + esc(cycMsg) + '</p></div>';
      if (errMsg) h += '<div class="card" style="border-left:4px solid #d23b3b"><p class="note" style="margin:0">⚠️ ' + esc(errMsg) + '</p></div>';
      h += '<div class="card"><h3>🧾 New invoice</h3>' +
        '<p class="note">Current period: <b>' + esc(invCycLabel(openP)) + '</b></p>' +
        '<div class="row"><div><label class="f">Period from</label><input type="date" id="iv_a" value="' + esc(pa) + '"></div>' +
        '<div><label class="f">Period to</label><input type="date" id="iv_b" value="' + esc(pb) + '"></div></div>' +
        '<div class="row"><div><label class="f">Invoice #</label><input id="iv_no" value="' + esc(draft.no || '') + '" placeholder="(auto on save)"></div>' +
        '<div><label class="f">Date</label><input type="date" id="iv_date" value="' + esc(draft.date) + '"></div></div>' +
        '<label class="f">Bill to</label><input id="iv_billto" value="' + esc(draft.billTo) + '" placeholder="Contracting company">' +
        '<label class="f">Tax rate % (GST/HST)</label><input id="iv_tax" type="number" step="0.01" min="0" value="' + esc(draft.taxRate) + '">' +
        '<p class="note">Prefilled from your province. Change it if your situation differs.</p></div>';

      h += '<div class="card"><h3>Line items</h3>';
      if (revLines.length) {
        h += '<p class="note">From revenue (' + esc(pa) + ' → ' + esc(pb) + '):</p>';
        revLines.forEach(function (l) {
          h += '<div class="kv"><span>' + esc(l.desc) + '</span><b>$' + l.amt.toFixed(2) + '</b></div>';
        });
      } else {
        h += '<p class="note">No revenue entries in this period. Add items manually:</p>';
      }
      var dupDates = invCycDupDates(revLines);
      if (dupDates.length) {
        h += '<p class="note" style="color:#b97a0f">⚠️ Heads up: ' + dupDates.map(esc).join(', ') +
          (dupDates.length === 1 ? ' appears' : ' appear') + ' twice — check for a double count.</p>';
      }
      draft.items.forEach(function (it, i) {
        h += '<div class="kv"><span>' + esc(it.desc) + ' × ' + esc(it.qty) + ' @ $' + Number(it.rate).toFixed(2) + '</span>' +
          '<span><b>$' + ((Number(it.qty) || 0) * (Number(it.rate) || 0)).toFixed(2) + '</b> ' +
          '<a href="#" data-mdel="' + i + '" style="color:#d23b3b">✕</a></span></div>';
      });
      h += '<div class="row"><div><label class="f">Description</label><input id="iv_idesc" placeholder="e.g. Gravel haul"></div></div>' +
        '<div class="row"><div><label class="f">Qty</label><input id="iv_iqty" type="number" step="any" value="1"></div>' +
        '<div><label class="f">Rate $</label><input id="iv_irate" type="number" step="0.01" placeholder="0.00"></div></div>' +
        '<button class="btn navy small" id="iv_additem">Add line item</button>' +
        '<label class="f">Notes</label><textarea id="iv_notes" placeholder="Payment terms...">' + esc(draft.notes) + '</textarea></div>';

      h += '<div class="card"><h3>Totals</h3>' +
        '<div class="kv"><span>Subtotal</span><b>$' + t.sub.toFixed(2) + '</b></div>' +
        '<div class="kv"><span>Tax (' + esc(draft.taxRate) + '%)</span><b>$' + t.tax.toFixed(2) + '</b></div>' +
        '<div class="kv" style="font-size:17px"><span><b>Total due</b></span><b>$' + t.total.toFixed(2) + '</b></div></div>';

      h += '<button class="btn primary" id="iv_issue">Save &amp; print invoice</button>';
      h += issuedHtml();
      body.innerHTML = h;
      wireInvoice(body, draft, revLines, t, saveDraft, draw);
    }

    function issuedHtml() {
      var list = invoices();
      var h = '<div class="card"><h3>📁 Issued invoices</h3>';
      if (!list.length) return h + '<div class="empty">No invoices yet.</div></div>';
      list.slice().reverse().slice(0, 10).forEach(function (r) {
        h += '<div class="kv"><span>#' + esc(r.no) + ' <span class="note">' + esc(r.date) + '</span></span>' +
          '<span><b>$' + r.total.toFixed(2) + '</b> <a href="#" data-reprint="' + r.id + '" style="color:var(--navy)">print</a></span></div>';
      });
      return h + '</div>';
    }

    function wireInvoice(body, draft, revLines, t, saveDraft, draw) {
      var gp = body.querySelector('#iv_goprefs');
      if (gp) gp.onclick = function () { App.openModule('preferences'); };
      function sync() {
        draft.no = body.querySelector('#iv_no').value.trim();
        draft.date = body.querySelector('#iv_date').value;
        draft.billTo = body.querySelector('#iv_billto').value.trim();
        draft.taxRate = body.querySelector('#iv_tax').value;
        draft.notes = body.querySelector('#iv_notes').value;
        W('pa', body.querySelector('#iv_a').value); W('pb', body.querySelector('#iv_b').value);
        saveDraft();
      }
      ['iv_no', 'iv_date', 'iv_billto', 'iv_tax', 'iv_notes', 'iv_a', 'iv_b'].forEach(function (id) {
        var n = body.querySelector('#' + id);
        if (n) n.addEventListener('change', function () { sync(); draw(); });
      });
      body.querySelector('#iv_additem').onclick = function () {
        var d = body.querySelector('#iv_idesc').value.trim();
        var q = Number(body.querySelector('#iv_iqty').value) || 0;
        var r = Number(body.querySelector('#iv_irate').value) || 0;
        if (!d || !(q > 0) || !(r > 0)) { alert('Enter a description, quantity and rate.'); return; }
        draft.items.push({ desc: d, qty: q, rate: r });
        sync(); saveDraft(); draw();
      };
      body.querySelectorAll('[data-mdel]').forEach(function (a) {
        a.onclick = function (e) { e.preventDefault(); draft.items.splice(+a.getAttribute('data-mdel'), 1); saveDraft(); draw(); };
      });
      body.querySelector('#iv_issue').onclick = function () {
        sync();
        if (t.sub <= 0) { alert('Add at least one line item first.'); return; }
        /* v55: verified issue + rollover lives in invIssue (INV-CYCLE
           region). A failed or refused save keeps the draft exactly as
           it is and prints nothing; only a verified save archives the
           invoice, clears the draft, advances the period, and prints. */
        var res = invIssue({
          draft: draft, revLines: revLines, sub: t.sub, tax: t.tax, total: t.total,
          pa: body.querySelector('#iv_a').value, pb: body.querySelector('#iv_b').value,
          today: App._today(),
          company: { name: o.companyName, gst: o.gst, addr: o.companyAddr },
          province: o.province, country: o.country
        });
        if (!res.ok) {
          W('err', res.message);
          Meticulous.modules.invoice.render(body);
          return;
        }
        if (window.FB && FB.saveDoc) FB.saveDoc('invoices', res.rec.no, { no: res.rec.no, date: res.rec.date, total: res.rec.total });
        printInvoice(res.rec);
        Meticulous.modules.invoice.render(body);
      };
      body.querySelectorAll('[data-reprint]').forEach(function (a) {
        a.onclick = function (e) {
          e.preventDefault();
          var id = a.getAttribute('data-reprint');
          invoices().forEach(function (r) { if (r.id === id) printInvoice(r); });
        };
      });
    }

    function printInvoice(rec) {
      var rows = '';
      (rec.revLines || []).forEach(function (l) {
        rows += '<tr><td>' + esc(l.desc) + '</td><td class="tot">$' + l.amt.toFixed(2) + '</td></tr>';
      });
      (rec.items || []).forEach(function (it) {
        rows += '<tr><td>' + esc(it.desc) + ' × ' + esc(it.qty) + ' @ $' + Number(it.rate).toFixed(2) + '</td>' +
          '<td class="tot">$' + ((Number(it.qty) || 0) * (Number(it.rate) || 0)).toFixed(2) + '</td></tr>';
      });
      printDoc('Invoice ' + rec.no,
        '<h1>' + esc((rec.company && rec.company.name) || 'Invoice') + '</h1>' +
        '<p class="muted">' + esc((rec.company && rec.company.addr) || '') +
        (rec.company && rec.company.gst ? '<br>GST/HST: ' + esc(rec.company.gst) : '') + '</p>' +
        '<h2>INVOICE #' + esc(rec.no) + '</h2>' +
        '<div class="row"><span><b>Bill to:</b> ' + esc(rec.billTo || '—') + '</span><span><b>Date:</b> ' + esc(rec.date) + '</span></div>' +
        '<table><tr><th>Description</th><th style="text-align:right">Amount</th></tr>' + rows + '</table>' +
        '<div class="row"><span>Subtotal</span><span>$' + rec.sub.toFixed(2) + '</span></div>' +
        '<div class="row"><span>Tax (' + esc(rec.taxRate) + '%)</span><span>$' + rec.tax.toFixed(2) + '</span></div>' +
        '<div class="row" style="font-size:18px"><span><b>Total due</b></span><span><b>$' + rec.total.toFixed(2) + '</b></span></div>' +
        (rec.notes ? '<p class="muted">' + esc(rec.notes) + '</p>' : ''));
    }

    draw();
  }

  /* ---------------- payroll pay stub (manual deductions) ---------------- */
  function renderPayroll(body) {
    var o = onb();
    var h = jurisdictionBanner();
    h += '<div class="card"><h3>💵 New pay stub</h3>' +
      '<p class="note">Jurisdiction: <b>' + esc(o.country || 'not set') + ' / ' + esc(o.province || 'not set') + '</b><br>' +
      'Enter deductions yourself — the app does not calculate tax for you.</p>' +
      '<div class="row"><div><label class="f">Period from</label><input type="date" id="ps_a" value="' + esc(App._today()) + '"></div>' +
      '<div><label class="f">Period to</label><input type="date" id="ps_b" value="' + esc(App._today()) + '"></div></div>' +
      '<label class="f">Gross earnings $</label><input id="ps_gross" type="number" step="0.01" placeholder="0.00">' +
      '<label class="f">EI deducted $</label><input id="ps_ei" type="number" step="0.01" placeholder="0.00">' +
      '<label class="f">CPP deducted $</label><input id="ps_cpp" type="number" step="0.01" placeholder="0.00">' +
      '<label class="f">Income tax deducted $</label><input id="ps_tax" type="number" step="0.01" placeholder="0.00">' +
      '<label class="f">Other deductions $</label><input id="ps_other" type="number" step="0.01" placeholder="0.00">' +
      '<label class="f">Other deduction note</label><input id="ps_onote" placeholder="e.g. benefits, union dues">' +
      '<div class="kv" style="font-size:17px;margin-top:10px"><span><b>Net pay</b></span><b id="ps_net">$0.00</b></div></div>' +
      '<button class="btn primary" id="ps_save">Save &amp; print pay stub</button>';

    var stubs = paystubs();
    if (stubs.length) {
      h += '<div class="card"><h3>📁 Saved pay stubs</h3>';
      stubs.slice().reverse().slice(0, 10).forEach(function (r) {
        h += '<div class="kv"><span>' + esc(r.a) + ' → ' + esc(r.b) + '</span>' +
          '<span><b>$' + r.net.toFixed(2) + '</b> <a href="#" data-psprint="' + r.id + '" style="color:var(--navy)">print</a></span></div>';
      });
      h += '</div>';
    }
    body.innerHTML = h;

    var gp = body.querySelector('#iv_goprefs');
    if (gp) gp.onclick = function () { App.openModule('preferences'); };

    function calc() {
      var g = Number(body.querySelector('#ps_gross').value) || 0;
      var d = ['ps_ei', 'ps_cpp', 'ps_tax', 'ps_other'].reduce(function (s, id) {
        return s + (Number(body.querySelector('#' + id).value) || 0);
      }, 0);
      return { gross: g, net: g - d };
    }
    ['ps_gross', 'ps_ei', 'ps_cpp', 'ps_tax', 'ps_other'].forEach(function (id) {
      body.querySelector('#' + id).addEventListener('input', function () {
        body.querySelector('#ps_net').textContent = '$' + calc().net.toFixed(2);
      });
    });
    body.querySelector('#ps_save').onclick = function () {
      var n = calc();
      if (!(n.gross > 0)) { alert('Enter gross earnings first.'); return; }
      var rec = {
        id: 'ps' + Date.now(),
        a: body.querySelector('#ps_a').value, b: body.querySelector('#ps_b').value,
        gross: n.gross, ei: Number(body.querySelector('#ps_ei').value) || 0,
        cpp: Number(body.querySelector('#ps_cpp').value) || 0,
        tax: Number(body.querySelector('#ps_tax').value) || 0,
        other: Number(body.querySelector('#ps_other').value) || 0,
        otherNote: body.querySelector('#ps_onote').value.trim(),
        net: n.net, country: o.country, province: o.province,
        employer: o.contractingCo || o.companyName || ''
      };
      var l = paystubs(); l.push(rec); W('stubs', l);
      printPayStub(rec);
      Meticulous.modules.invoice.render(body);
    };
    body.querySelectorAll('[data-psprint]').forEach(function (a) {
      a.onclick = function (e) {
        e.preventDefault();
        var id = a.getAttribute('data-psprint');
        paystubs().forEach(function (r) { if (r.id === id) printPayStub(r); });
      };
    });
  }

  function printPayStub(rec) {
    printDoc('Pay stub ' + rec.a,
      '<h1>Pay Stub</h1>' +
      '<p class="muted">' + esc(rec.employer) + '<br>Pay period: ' + esc(rec.a) + ' to ' + esc(rec.b) +
      '<br>Jurisdiction: ' + esc(rec.country || '') + ' / ' + esc(rec.province || '') + '</p>' +
      '<table><tr><th>Description</th><th style="text-align:right">Amount</th></tr>' +
      '<tr><td>Gross earnings</td><td class="tot">$' + rec.gross.toFixed(2) + '</td></tr>' +
      '<tr><td>EI</td><td class="tot">−$' + rec.ei.toFixed(2) + '</td></tr>' +
      '<tr><td>CPP</td><td class="tot">−$' + rec.cpp.toFixed(2) + '</td></tr>' +
      '<tr><td>Income tax</td><td class="tot">−$' + rec.tax.toFixed(2) + '</td></tr>' +
      '<tr><td>Other' + (rec.otherNote ? ' (' + esc(rec.otherNote) + ')' : '') + '</td><td class="tot">−$' + rec.other.toFixed(2) + '</td></tr></table>' +
      '<div class="row" style="font-size:18px"><span><b>Net pay</b></span><span><b>$' + rec.net.toFixed(2) + '</b></span></div>' +
      '<p class="muted">Deductions entered manually. This stub is a record, not tax advice.</p>');
  }

  /* ---------------- main ---------------- */
  Meticulous.modules.invoice = {
    status: function () { return invoices().length + ' issued'; },
    render: function (body) {
      var o = onb();
      var mode = S('mode', o.employment === 'Payroll' ? 'paystub' : 'invoice');
      var h = '<div class="card"><div class="row">' +
        '<button class="btn small ' + (mode === 'invoice' ? 'primary' : 'ghost') + '" data-m="invoice" style="margin:0">🧾 Invoice</button>' +
        '<button class="btn small ' + (mode === 'paystub' ? 'primary' : 'ghost') + '" data-m="paystub" style="margin:0">💵 Pay Stub</button>' +
        '</div></div><div id="iv_body"></div>';
      body.innerHTML = h;
      body.querySelectorAll('[data-m]').forEach(function (b) {
        b.onclick = function () { W('mode', b.getAttribute('data-m')); Meticulous.modules.invoice.render(body); };
      });
      var inner = body.querySelector('#iv_body');
      if (mode === 'invoice') renderInvoice(inner); else renderPayroll(inner);
    }
  };
})();
