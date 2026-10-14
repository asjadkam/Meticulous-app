/* Meticulous — PDF export (web v69).
 *
 * Why this exists (owner field report, Oct 14): on the Manifest
 * screen BOTH "Print / PDF" and "Download" were dead in the Android
 * shell. Root causes were mechanical, not data problems:
 *   - Print called window.print(). The app runs in a Capacitor
 *     WebView (bare BridgeActivity — no print bridge is registered),
 *     and an Android WebView does nothing at all for window.print()
 *     unless the native side wires it to the PrintManager. It is a
 *     silent no-op in the shell.
 *   - Download built a blob: URL and clicked an <a download>. An
 *     Android WebView without a DownloadListener ignores that click
 *     completely — also a silent no-op in the shell.
 * In a desktop/mobile BROWSER both calls work, which is why the bug
 * only showed on the phone.
 *
 * What lives here: (1) a small dependency-free PDF writer (real
 * %PDF bytes, core Helvetica fonts, wrapped + paginated text), and
 * (2) delivery routed by environment — in the shell the PDF is
 * written with the @capacitor/filesystem plugin that the v34 shell
 * already carries (into the device Documents folder, where the
 * Files app can open / print / share it); in a browser it downloads
 * as a normal blob file. One-tap printing from inside the shell
 * still needs a native PrintManager bridge — that is next-APK work;
 * nothing here pretends otherwise.
 *
 * Line model: callers pass typed lines —
 *   { k:'title'|'sub'|'h'|'kv'|'p'|'note'|'gap', a:'text', b:'value' }
 * ('kv' = label a + right-aligned value b; everything else uses a).
 */
(function () {
  'use strict';

  /* ---------------- text hygiene (WinAnsi) ---------------- */

  // Characters outside Latin-1 that WinAnsi (cp1252) can still show,
  // mapped to their byte values so the PDF stays valid.
  var WINANSI_EXTRA = {
    '\u2018': 0x91, '\u2019': 0x92, '\u201C': 0x93, '\u201D': 0x94,
    '\u2013': 0x96, '\u2014': 0x97, '\u2022': 0x95, '\u2026': 0x85,
    '\u20AC': 0x80, '\u2122': 0x99, '\u2039': 0x8B, '\u203A': 0x9B
  };
  var SIMPLE_MAP = {
    '\u2212': '-', '\u2192': '->', '\u00A0': ' ', '\u2009': ' ',
    '\u2713': 'yes', '\u2714': 'yes'
  };

  /* Convert a JS string to a string whose char codes ARE the PDF
     bytes (Latin-1). Anything unrepresentable is dropped. */
  function toWinAnsi(s) {
    s = String(s === null || s === undefined ? '' : s);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i), code = s.charCodeAt(i);
      if (SIMPLE_MAP[ch] !== undefined) { out += SIMPLE_MAP[ch]; continue; }
      if (WINANSI_EXTRA[ch] !== undefined) { out += String.fromCharCode(WINANSI_EXTRA[ch]); continue; }
      if (code === 0x0A || code === 0x0D || code === 0x09) { out += ' '; continue; }
      if ((code >= 0x20 && code <= 0x7E) || (code >= 0xA0 && code <= 0xFF)) { out += ch; continue; }
      /* everything else (emoji, symbols) is dropped */
    }
    return out;
  }

  function escPdfText(s) {
    return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  /* ---------------- Helvetica metrics (AFM, units/1000) ----------- */

  var W = { 32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 222, 40: 333, 41: 333, 42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278, 48: 556, 49: 556, 50: 556, 51: 556, 52: 556, 53: 556, 54: 556, 55: 556, 56: 556, 57: 556, 58: 278, 59: 278, 60: 584, 61: 584, 62: 584, 63: 556, 64: 1015, 65: 667, 66: 667, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778, 72: 722, 73: 278, 74: 500, 75: 667, 76: 556, 77: 833, 78: 722, 79: 778, 80: 667, 81: 778, 82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944, 88: 667, 89: 667, 90: 611, 91: 278, 92: 278, 93: 278, 94: 469, 95: 556, 96: 333, 97: 556, 98: 556, 99: 500, 100: 556, 101: 556, 102: 278, 103: 556, 104: 556, 105: 222, 106: 222, 107: 500, 108: 222, 109: 833, 110: 556, 111: 556, 112: 556, 113: 556, 114: 333, 115: 500, 116: 278, 117: 556, 118: 500, 119: 722, 120: 500, 121: 500, 122: 500, 123: 334, 124: 260, 125: 334, 126: 584 };

  function textWidth(winAnsiStr, size) {
    var units = 0;
    for (var i = 0; i < winAnsiStr.length; i++) {
      var c = winAnsiStr.charCodeAt(i);
      units += (W[c] !== undefined) ? W[c] : 556;
    }
    return units * size / 1000;
  }

  /* Greedy word wrap. Returns an array of WinAnsi strings. */
  function wrapText(winAnsiStr, size, maxWidth) {
    var words = winAnsiStr.split(' '), lines = [], cur = '';
    function pushLongWord(word) {
      // a single word wider than the column: hard-split by characters
      var rest = word;
      while (textWidth(rest, size) > maxWidth && rest.length > 1) {
        var n = rest.length;
        while (n > 1 && textWidth(rest.slice(0, n), size) > maxWidth) n--;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      return rest;
    }
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w === '') continue;
      var cand = cur ? cur + ' ' + w : w;
      if (textWidth(cand, size) <= maxWidth) { cur = cand; continue; }
      if (cur) { lines.push(cur); cur = ''; }
      cur = (textWidth(w, size) > maxWidth) ? pushLongWord(w) : w;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  /* ---------------- layout + writer ---------------- */

  var PAGE_W = 595, PAGE_H = 842, MARGIN = 46, RIGHT = PAGE_W - MARGIN;
  var CONTENT_W = PAGE_W - 2 * MARGIN;
  var TOP = PAGE_H - 54, BOTTOM = 58;

  var NAVY = '0.102 0.192 0.373', ORANGE = '0.949 0.396 0.133',
      INK = '0.10 0.13 0.25', GRAY = '0.42 0.46 0.56';

  var STYLES = {
    title: { font: 'F2', size: 17, leading: 22, color: NAVY, before: 0, after: 6 },
    sub: { font: 'F1', size: 10.5, leading: 14, color: GRAY, before: 0, after: 2 },
    h: { font: 'F2', size: 12, leading: 15, color: NAVY, before: 10, after: 5, rule: true },
    kv: { font: 'F1', size: 10.5, leading: 14.5, color: INK, before: 0, after: 0 },
    p: { font: 'F1', size: 10.5, leading: 14.5, color: INK, before: 0, after: 0 },
    note: { font: 'F1', size: 9.5, leading: 13, color: GRAY, before: 0, after: 0 },
    gap: { font: 'F1', size: 10.5, leading: 8, color: INK, before: 0, after: 0 }
  };

  /* Turn typed lines into pages of draw operations. */
  function layout(doc) {
    var pages = [[]], y = TOP;
    function newPage() { pages.push([]); y = TOP; }
    function need(hgt) { if (y - hgt < BOTTOM) newPage(); }
    function textOp(st, x, yy, txt, font, color) {
      pages[pages.length - 1].push(
        'BT /' + font + ' ' + st.size + ' Tf ' + color + ' rg 1 0 0 1 ' +
        x.toFixed(1) + ' ' + yy.toFixed(1) + ' Tm (' + escPdfText(txt) + ') Tj ET');
    }
    var lines = (doc && doc.lines) || [];
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i] || {};
      var st = STYLES[ln.k] || STYLES.p;
      if (ln.k === 'gap') { y -= 8; if (y < BOTTOM) newPage(); continue; }
      var a = toWinAnsi(ln.a || '');
      if (ln.k === 'kv') {
        var b = toWinAnsi(ln.b || '');
        var bw = textWidth(b, st.size);
        need(st.before + st.leading);
        y -= st.before;
        if (textWidth(a, st.size) + bw + 18 <= CONTENT_W) {
          y -= st.leading - 3;
          textOp(st, MARGIN, y, a, 'F1', st.color);
          if (b) textOp(st, RIGHT - bw, y, b, 'F2', st.color);
          y -= 3;
        } else {
          var wrapped = wrapText(a, st.size, CONTENT_W);
          for (var wI = 0; wI < wrapped.length; wI++) {
            need(st.leading);
            y -= st.leading - 3;
            textOp(st, MARGIN, y, wrapped[wI], 'F1', st.color);
            y -= 3;
          }
          if (b) {
            need(st.leading);
            y -= st.leading - 3;
            textOp(st, RIGHT - bw, y, b, 'F2', st.color);
            y -= 3;
          }
        }
        y -= st.after;
        continue;
      }
      // paragraph-like styles
      y -= st.before;
      var parts = wrapText(a, st.size, CONTENT_W);
      for (var pI = 0; pI < parts.length; pI++) {
        need(st.leading + (pI === parts.length - 1 && st.rule ? 4 : 0));
        y -= st.leading - 3;
        textOp(st, MARGIN, y, parts[pI], st.font, st.color);
        y -= 3;
        if (st.rule && pI === parts.length - 1) {
          pages[pages.length - 1].push(
            ORANGE + ' RG 0.8 w ' + MARGIN + ' ' + (y - 0.5).toFixed(1) +
            ' m ' + RIGHT + ' ' + (y - 0.5).toFixed(1) + ' l S');
          y -= 3.5;
        }
      }
      y -= st.after;
    }
    return pages;
  }

  function buildPdf(doc) {
    doc = doc || {};
    var title = toWinAnsi(doc.title || 'Document');
    var pages = layout(doc);
    var nPages = pages.length;

    // footer pass
    for (var i = 0; i < nPages; i++) {
      var foot = '1 0 0 1 ' + MARGIN + ' 30 Tm (' + escPdfText(title) + ') Tj ET';
      var label = 'Page ' + (i + 1) + ' of ' + nPages;
      var lw = textWidth(label, 8);
      pages[i].push('BT /F1 8 Tf ' + GRAY + ' rg ' + foot);
      pages[i].push('BT /F1 8 Tf ' + GRAY + ' rg 1 0 0 1 ' +
        (RIGHT - lw).toFixed(1) + ' 30 Tm (' + escPdfText(label) + ') Tj ET');
    }

    var objs = [];
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    var kids = [];
    for (var p = 0; p < nPages; p++) kids.push((5 + p * 2) + ' 0 R');
    objs[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + nPages + ' >>';
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    for (var q = 0; q < nPages; q++) {
      var pageObj = 5 + q * 2, contObj = 6 + q * 2;
      objs[pageObj] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H +
        '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + contObj + ' 0 R >>';
      var stream = pages[q].join('\n');
      objs[contObj] = '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream';
    }

    var out = '%PDF-1.4\n';
    var offsets = [0];
    for (var o = 1; o < objs.length; o++) {
      offsets[o] = out.length;
      out += o + ' 0 obj\n' + objs[o] + '\nendobj\n';
    }
    var xrefPos = out.length;
    out += 'xref\n0 ' + objs.length + '\n';
    out += '0000000000 65535 f \n';
    for (var x = 1; x < objs.length; x++) {
      var off = ('0000000000' + offsets[x]).slice(-10);
      out += off + ' 00000 n \n';
    }
    out += 'trailer\n<< /Size ' + objs.length + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF';

    var bytes = new Uint8Array(out.length);
    for (var bi = 0; bi < out.length; bi++) bytes[bi] = out.charCodeAt(bi) & 0xFF;
    return { base64: b64encode(bytes), bytes: bytes, pages: nPages };
  }

  /* ---------------- base64 (env-safe, no btoa) ---------------- */

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64encode(bytes) {
    var out = '', i = 0;
    for (; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) +
             B64.charAt((n >> 6) & 63) + B64.charAt(n & 63);
    }
    var rem = bytes.length - i;
    if (rem === 1) {
      var n1 = bytes[i] << 16;
      out += B64.charAt((n1 >> 18) & 63) + B64.charAt((n1 >> 12) & 63) + '==';
    } else if (rem === 2) {
      var n2 = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64.charAt((n2 >> 18) & 63) + B64.charAt((n2 >> 12) & 63) +
             B64.charAt((n2 >> 6) & 63) + '=';
    }
    return out;
  }
  function b64decodeBytes(b64) {
    var rev = {};
    for (var i = 0; i < B64.length; i++) rev[B64.charAt(i)] = i;
    var clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
    var bytes = [], acc = 0, bits = 0;
    for (var j = 0; j < clean.length; j++) {
      var ch = clean.charAt(j);
      if (ch === '=') break;
      acc = (acc << 6) | rev[ch]; bits += 6;
      if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xFF); }
    }
    return new Uint8Array(bytes);
  }

  /* ---------------- HTML -> lines (invoice markup) ---------------- */

  function decodeEntities(s) {
    return String(s)
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
  }
  function stripTags(html) {
    return decodeEntities(String(html).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  }

  /* Understands the shapes modules/invoice.js printDoc receives:
     h1, h2, p (with <br>), div.row > span + span, table > tr > th/td.
     Anything else degrades to plain text lines, in order. */
  function htmlToLines(html) {
    var lines = [];
    var src = String(html || '');
    var tokenRe = /<(h1|h2|p|div|table|tr)([^>]*)>|<\/table>|<br\s*\/?>/gi;
    var pos = 0, m, mode = null, rowCells = null, pendingText = '';

    function flushText(endIdx) {
      var raw = src.slice(pos, endIdx);
      if (!raw) return;
      var txt = stripTags(raw);
      if (!txt) return;
      if (mode === 'h1') lines.push({ k: 'title', a: txt });
      else if (mode === 'h2') lines.push({ k: 'h', a: txt });
      else if (mode === 'rowspan') pendingText = txt; // handled by row close
      else if (mode === 'cell') { if (rowCells) rowCells.push(txt); }
      else lines.push({ k: 'p', a: txt });
    }

    var stack = [];
    while ((m = tokenRe.exec(src)) !== null) {
      flushText(m.index);
      pos = tokenRe.lastIndex;
      var tag = (m[1] || '').toLowerCase();
      if (m[0].charAt(1) === '/') { // </table>
        mode = null;
        continue;
      }
      if (/^<br/i.test(m[0])) {
        if (mode === 'p') {
          // forced line break inside a paragraph: emit what we have via a marker line
          lines.push({ k: 'gap', a: '' });
        }
        continue;
      }
      if (tag === 'h1') { mode = 'h1'; stack.push('h1'); }
      else if (tag === 'h2') { mode = 'h2'; stack.push('h2'); }
      else if (tag === 'p') { mode = 'p'; stack.push('p'); }
      else if (tag === 'div') {
        if (/class="row"/.test(m[2] || '')) {
          // collect this row's spans now (rows are flat in our markup)
          var close = src.indexOf('</div>', pos);
          var inner = close >= 0 ? src.slice(pos, close) : '';
          var spans = inner.match(/<span[^>]*>([\s\S]*?)<\/span>/g) || [];
          var texts = spans.map(function (sp) { return stripTags(sp); }).filter(Boolean);
          if (texts.length >= 2) lines.push({ k: 'kv', a: texts[0], b: texts[texts.length - 1] });
          else if (texts.length === 1) lines.push({ k: 'p', a: texts[0] });
          if (close >= 0) { pos = close + 6; tokenRe.lastIndex = pos; }
        }
      }
      else if (tag === 'table') { mode = 'table'; }
      else if (tag === 'tr') {
        var tClose = src.indexOf('</tr>', pos);
        var tInner = tClose >= 0 ? src.slice(pos, tClose) : '';
        var cells = [];
        var cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g, cm;
        while ((cm = cellRe.exec(tInner)) !== null) cells.push(stripTags(cm[1]));
        cells = cells.filter(function (c) { return c !== ''; });
        if (cells.length === 2) lines.push({ k: 'kv', a: cells[0], b: cells[1] });
        else if (cells.length > 2) lines.push({ k: 'p', a: cells.join('   ') });
        else if (cells.length === 1) lines.push({ k: 'p', a: cells[0] });
        if (tClose >= 0) { pos = tClose + 5; tokenRe.lastIndex = pos; }
      }
      if (tag === 'h1' || tag === 'h2' || tag === 'p') {
        // mode ends at the matching close tag; simplest: let the next
        // block tag (or end) flush it — tracked by close-tag scan below.
        var closeTag = '</' + tag + '>';
        var cIdx = src.indexOf(closeTag, pos);
        if (cIdx >= 0) {
          var innerTxt = stripTags(src.slice(pos, cIdx));
          // handle <br> inside paragraphs as separate lines
          var rawInner = src.slice(pos, cIdx);
          if (/<br/i.test(rawInner)) {
            rawInner.split(/<br\s*\/?>/i).forEach(function (part) {
              var t = stripTags(part);
              if (t) lines.push({ k: mode === 'h1' ? 'title' : (mode === 'h2' ? 'h' : 'p'), a: t });
            });
          } else if (innerTxt) {
            lines.push({ k: mode === 'h1' ? 'title' : (mode === 'h2' ? 'h' : 'p'), a: innerTxt });
          }
          pos = cIdx + closeTag.length;
          tokenRe.lastIndex = pos;
          mode = null;
        }
      }
    }
    flushText(src.length);
    return lines;
  }

  /* ---------------- environment + delivery ---------------- */

  function fsPlugin() {
    try {
      var p = window.Capacitor && window.Capacitor.Plugins &&
        window.Capacitor.Plugins.Filesystem;
      if (p && typeof p.writeFile === 'function') return p;
    } catch (e) {}
    return null;
  }

  /* The native shell is present exactly when the Capacitor bridge
     injected the Filesystem plugin (same feature-detect style as
     js/shifttrack.js). A plain browser never has it. */
  function isNativeShell() {
    if (!fsPlugin()) return false;
    try {
      if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function') {
        return !!window.Capacitor.isNativePlatform();
      }
    } catch (e) {}
    return true;
  }

  function deliver(filename, pdf) {
    var fs = fsPlugin();
    if (fs && isNativeShell()) {
      var opts = { path: filename, data: pdf.base64, directory: 'DOCUMENTS', recursive: true };
      return fs.writeFile(opts).then(function () {
        function done(uri) { return { ok: true, where: 'documents', uri: uri || null }; }
        if (typeof fs.getUri === 'function') {
          return fs.getUri({ path: filename, directory: 'DOCUMENTS' }).then(
            function (r) { return done(r && r.uri); },
            function () { return done(null); });
        }
        return done(null);
      }, function (err) {
        return { ok: false, where: 'documents', error: String((err && err.message) || err) };
      });
    }
    // browser: a real file download of the PDF bytes
    try {
      var blob = new Blob([pdf.bytes], { type: 'application/pdf' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try { document.body.removeChild(a); } catch (e) {}
        try { URL.revokeObjectURL(url); } catch (e) {}
      }, 800);
      return Promise.resolve({ ok: true, where: 'download', uri: null });
    } catch (e) {
      return Promise.resolve({ ok: false, where: 'download', error: String((e && e.message) || e) });
    }
  }

  /* Build + deliver, with a plain-words result message. */
  function savePdf(doc, filename) {
    var pdf;
    try { pdf = buildPdf(doc); } catch (e) {
      return Promise.resolve({ ok: false, where: 'build', pages: 0,
        message: 'The PDF could not be made (' + String((e && e.message) || e) + ').' });
    }
    return deliver(filename, pdf).then(function (r) {
      var msg;
      if (r.ok && r.where === 'documents') {
        msg = 'Saved as a PDF in your Documents folder: ' + filename +
          '. Open it in the Files app to print it or send it.';
      } else if (r.ok) {
        msg = 'PDF downloaded: ' + filename;
      } else {
        msg = 'The PDF could not be saved (' + r.error + '). Check storage and try again.';
      }
      return { ok: r.ok, where: r.where, uri: r.uri || null, pages: pdf.pages, message: msg };
    });
  }

  window.MetPdf = {
    buildPdf: buildPdf,
    htmlToLines: htmlToLines,
    isNativeShell: isNativeShell,
    deliver: deliver,
    savePdf: savePdf,
    _b64decodeBytes: b64decodeBytes
  };
})();
