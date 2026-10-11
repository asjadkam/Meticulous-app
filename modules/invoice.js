/* Invoice / Pay Stub module (Meticulous.modules convention)
   Contractor: period-based lines from revenue + manual items, province-based
   tax (editable), invoice numbering, print. Payroll: manual deductions only —
   nothing auto-calculated, never defaults to US rules; country/province
   required from Preferences before use. */
(function () {
  'use strict';
  var S = function (k, d) { return App._store.get('inv_' + k, d); };
  var W = function (k, v) { App._store.set('inv_' + k, v); };
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

  function nextInvNo() {
    var seq = S('seq', 0) + 1;
    W('seq', seq);
    return 'INV-' + new Date().getFullYear() + '-' + ('0000' + seq).slice(-4);
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
      if (amt > 0) lines.push({ desc: desc + ' — ' + e.date, amt: amt });
    });
    extras.forEach(function (x) {
      var v = parseFloat(x.amount) || 0;
      if (v !== 0) lines.push({ desc: (x.type || 'Extra') + ' — ' + x.date, amt: v });
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
    function saveDraft() { W('draft', draft); }

    function totals(lines) {
      var sub = 0;
      lines.forEach(function (l) { sub += l.amt; });
      draft.items.forEach(function (it) { sub += (Number(it.qty) || 0) * (Number(it.rate) || 0); });
      var tax = sub * (Number(draft.taxRate) || 0) / 100;
      return { sub: sub, tax: tax, total: sub + tax };
    }

    function draw() {
      var pa = S('pa', App._today()), pb = S('pb', App._today());
      var revLines = revenueLines(pa, pb);
      var t = totals(revLines);
      var h = jurisdictionBanner();
      h += '<div class="card"><h3>🧾 New invoice</h3>' +
        '<div class="row"><div><label class="f">Period from</label><input type="date" id="iv_a" value="' + esc(pa) + '"></div>' +
        '<div><label class="f">Period to</label><input type="date" id="iv_b" value="' + esc(pb) + '"></div></div>' +
        '<div class="row"><div><label class="f">Invoice #</label><input id="iv_no" value="' + esc(draft.no || '(auto on save)') + '" placeholder="(auto on save)"></div>' +
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
        var no = draft.no || nextInvNo();
        var rec = {
          id: 'inv' + Date.now(), no: no, date: draft.date, billTo: draft.billTo,
          revLines: revLines, items: draft.items.slice(),
          taxRate: Number(draft.taxRate) || 0, sub: t.sub, tax: t.tax, total: t.total,
          notes: draft.notes, company: { name: o.companyName, gst: o.gst, addr: o.companyAddr },
          province: o.province, country: o.country, at: App._today()
        };
        var l = invoices(); l.push(rec); W('list', l);
        W('draft', null);
        if (window.FB && FB.saveDoc) FB.saveDoc('invoices', no, { no: no, date: rec.date, total: rec.total });
        printInvoice(rec);
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
