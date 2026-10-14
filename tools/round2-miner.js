'use strict';
/* Round 2 — Lane B: constrained numeric candidate mining.
 * Pools the OCR text of MANY passes (different preprocessing / engine
 * settings of the same photo) and hunts validated numeric candidates:
 * digit-confusion repair, space/comma group joining, consensus scoring,
 * sanity windows. Output is a RANKED candidate list (top-3 is what a
 * tap-to-pick UX needs) — never a silent auto-accept.
 * Written in plain ES5-style functions: this file is the reference
 * implementation for TicketOCR.mineCandidates if the lane ships. */

/* ---------- digit-confusion repair ---------- */
var CONFUSE = { O: '0', o: '0', Q: '0', l: '1', I: '1', i: '1', '|': '1', Z: '2', z: '2', S: '5', s: '5', G: '6', B: '8', q: '9', A: '4' };
function digitizeToken(tok) {
  // A token is digit-like when every char is a digit, a separator, or a
  // known digit-confusable letter, and at least half its chars are digits
  // or confusables-that-map. Returns the digit string or null.
  var t = String(tok || '').replace(/^[^0-9A-Za-z]+/, '').replace(/[^0-9A-Za-z]+$/, '');
  if (t.length < 3) return null;
  var out = '', digits = 0;
  for (var i = 0; i < t.length; i++) {
    var c = t[i];
    if (c >= '0' && c <= '9') { out += c; digits++; }
    else if (c === ',' || c === '.' || c === ' ') { out += c; }
    else if (CONFUSE[c]) { out += CONFUSE[c]; }
    else return null;
  }
  if (digits < 2) return null;
  return out;
}

/* Extract raw candidate digit-strings from one OCR text.
 * Returns [{ digits:'175429', repaired:bool, decimal:bool }] */
function extractDigitRuns(text) {
  var out = [];
  var lines = String(text || '').split(/\r?\n/);
  lines.forEach(function (line) {
    var m, re;
    // Pass 1: plain digit runs, separators (space/comma) glued like the app parser
    var glued = line.replace(/(\d)[ \t]+(?=\d)/g, '$1').replace(/(\d),[ \t]+(?=\d)/g, '$1,');
    re = /(\d[\d,]*\d|\d)/g;
    while ((m = re.exec(glued)) !== null) {
      var raw = m[1];
      var dec = false;
      var dm = raw.match(/^([\d,]+)\.(\d)$/); // trailing decimal digit = tenths (trip/LCD decimal)
      var digits = raw.replace(/,/g, '');
      if (dm && digits.replace('.', '').length >= 5) { digits = dm[1].replace(/,/g, ''); dec = true; }
      else digits = digits.replace(/\./g, '');
      if (digits.length >= 4 && digits.length <= 8) out.push({ digits: digits, repaired: false, decimal: dec });
    }
    // Pass 2: confusion-repaired tokens
    var toks = line.split(/\s+/);
    var digToks = toks.map(digitizeToken);
    digToks.forEach(function (dt) {
      if (!dt) return;
      var d = dt.replace(/[,.]/g, '');
      if (d.length >= 4 && d.length <= 8) out.push({ digits: d, repaired: true, decimal: /\.\d$/.test(dt) });
    });
    // Pass 3: join adjacent digitized tokens ("175 429", "161, 199")
    for (var i = 0; i + 1 < digToks.length; i++) {
      if (!digToks[i] || !digToks[i + 1]) continue;
      var a = digToks[i].replace(/[,.]/g, ''), b = digToks[i + 1].replace(/[,.]/g, '');
      var j = a + b;
      if (j.length >= 5 && j.length <= 7 && a.length >= 2 && b.length >= 2) out.push({ digits: j, repaired: true, decimal: false });
    }
  });
  return out;
}

/* ---------- odometer candidates ---------- */
function rankOdoCandidates(texts, parsers) {
  var byVal = {};
  texts.forEach(function (src, ti) {
    var runs = extractDigitRuns(src.text);
    var seenHere = {};
    runs.forEach(function (r) {
      var v = parseInt(r.digits, 10);
      if (!(v >= 10000 && v <= 1999999)) return;
      if (r.digits.length < 5 || r.digits.length > 7) return;
      var key = String(v);
      var c = byVal[key] || (byVal[key] = { value: v, digits: String(v), score: 0, sources: 0, repairedOnly: true });
      if (!seenHere[key]) { c.sources++; c.score += 2; seenHere[key] = 1; if (src.whitelist) c.score += 1; }
      if (!r.repaired) c.repairedOnly = false;
    });
    if (parsers && parsers.parseOdometerReading) {
      var pv = parsers.parseOdometerReading(src.text);
      if (pv && byVal[String(parseInt(pv, 10))]) byVal[String(parseInt(pv, 10))].score += 3;
    }
  });
  var list = Object.keys(byVal).map(function (k) { return byVal[k]; });
  list.forEach(function (c) {
    if (c.digits.length === 6) c.score += 2;
    else if (c.digits.length === 5 || c.digits.length === 7) c.score += 1;
  });
  list.sort(function (a, b) { return (b.score - a.score) || (b.sources - a.sources) || (b.value - a.value); });
  return list;
}

/* ---------- service-sticker miles candidates ---------- */
function rankStickerMiles(texts, master, parsers) {
  var byVal = {};
  texts.forEach(function (src) {
    var runs = extractDigitRuns(src.text);
    var seenHere = {};
    runs.forEach(function (r) {
      var v = parseInt(r.digits, 10);
      if (!(v >= 10000 && v <= 1999999)) return;
      if (r.digits.length < 5 || r.digits.length > 7) return;
      var key = String(v);
      var c = byVal[key] || (byVal[key] = { value: v, digits: String(v), score: 0, sources: 0 });
      if (!seenHere[key]) { c.sources++; c.score += 2; seenHere[key] = 1; }
    });
    // MILES/KM anchor proximity bonus (same idea as the parser's anchor rule)
    var t = String(src.text || '');
    var am = t.search(/MILES|MILEAGE|KILOMET|KMS?\b|ODOMETER|ODO\b/i);
    if (am >= 0) {
      var zone = t.slice(Math.max(0, am - 10), am + 90);
      extractDigitRuns(zone).forEach(function (r) {
        var v = parseInt(r.digits, 10);
        if (byVal[String(v)]) byVal[String(v)].score += 2;
      });
    }
    if (parsers && parsers.parseServiceSticker) {
      var f = parsers.parseServiceSticker(src.text);
      if (f && f.odo && byVal[String(parseInt(f.odo, 10))]) byVal[String(parseInt(f.odo, 10))].score += 3;
    }
  });
  var list = Object.keys(byVal).map(function (k) { return byVal[k]; });
  list.forEach(function (c) {
    if (c.digits.length === 6) c.score += 2; else c.score += 1;
    if (master) {
      if (c.value > master && c.value <= master + 40000) c.score += 6;       // sane next-service window
      else if (c.value <= master) c.score -= 4;                              // can't be due BELOW current odo
      else c.score -= 2;                                                     // implausibly far ahead
    }
  });
  list.sort(function (a, b) { return (b.score - a.score) || (b.sources - a.sources) || (b.value - a.value); });
  return list;
}

/* ---------- service-sticker date candidates ---------- */
var MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
function fuzzyMonth(tok) {
  var t = String(tok || '').toUpperCase().replace(/[^A-Z]/g, '').replace(/0/g, 'O').replace(/5/g, 'S').replace(/1/g, 'I');
  if (t.length < 3) return null;
  var keys = Object.keys(MONTHS);
  for (var i = 0; i < keys.length; i++) if (t.indexOf(keys[i]) === 0) return MONTHS[keys[i]];
  if (t.indexOf('SEPT') === 0 || t.indexOf('SEF') === 0) return 9;
  return null;
}
function isoOf(y, mo, d) {
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  if (!(y >= 2015 && y <= 2045)) return null;
  return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
}
function dateInterpretations(a, b, y) {
  var out = [];
  var yy = parseInt(y, 10); if (String(y).length === 2) yy += 2000;
  var i1 = isoOf(yy, parseInt(a, 10), parseInt(b, 10)); if (i1) out.push(i1); // M/D/Y
  var i2 = isoOf(yy, parseInt(b, 10), parseInt(a, 10)); if (i2 && i2 !== i1) out.push(i2); // D/M/Y
  // leading-digit-garble repair: "83-19-25" hides "3-19-25"
  if (String(a).length === 2 && parseInt(a, 10) > 31) {
    var a2 = String(a).slice(1);
    var i3 = isoOf(yy, parseInt(a2, 10), parseInt(b, 10)); if (i3 && out.indexOf(i3) < 0) out.push(i3);
    var i4 = isoOf(yy, parseInt(b, 10), parseInt(a2, 10)); if (i4 && out.indexOf(i4) < 0) out.push(i4);
  }
  return out;
}
function rankStickerDates(texts, parsers) {
  var byDate = {};
  function add(iso, pts) {
    if (!iso) return;
    var c = byDate[iso] || (byDate[iso] = { date: iso, score: 0, sources: 0 });
    c.score += pts;
  }
  texts.forEach(function (src) {
    var t = String(src.text || '');
    var seenHere = {};
    var m, re;
    re = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
    while ((m = re.exec(t)) !== null) { var iso0 = isoOf(+m[1], +m[2], +m[3]); if (iso0 && !seenHere[iso0]) { add(iso0, 2); seenHere[iso0] = 1; } }
    re = /\b(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})\b/g;
    while ((m = re.exec(t)) !== null) {
      dateInterpretations(m[1], m[2], m[3]).forEach(function (iso) { if (!seenHere[iso]) { add(iso, 2); seenHere[iso] = 1; } });
    }
    re = /(\d{1,2})\s*[-\s]\s*([A-Za-z]{3,9})\.?,?\s*(\d{2,4})(?!\d)/g;
    while ((m = re.exec(t)) !== null) {
      var mo = fuzzyMonth(m[2]); if (!mo) continue;
      var y = parseInt(m[3], 10); if (String(m[3]).length === 2) y += 2000;
      var iso = isoOf(y, mo, parseInt(m[1], 10)); if (iso && !seenHere[iso]) { add(iso, 2); seenHere[iso] = 1; }
    }
    re = /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})(?!\d)/g;
    while ((m = re.exec(t)) !== null) {
      var mo2 = fuzzyMonth(m[1]); if (!mo2) continue;
      var y2 = parseInt(m[3], 10); if (String(m[3]).length === 2) y2 += 2000;
      var iso2 = isoOf(y2, mo2, parseInt(m[2], 10)); if (iso2 && !seenHere[iso2]) { add(iso2, 2); seenHere[iso2] = 1; }
    }
    if (parsers && parsers.parseServiceSticker) {
      var f = parsers.parseServiceSticker(t);
      if (f && f.date) add(f.date, 4);
    }
  });
  var list = Object.keys(byDate).map(function (k) { return byDate[k]; });
  list.forEach(function (c) {
    var y = parseInt(c.date.slice(0, 4), 10);
    if (y >= 2024 && y <= 2030) c.score += 1;
  });
  list.sort(function (a, b) { return b.score - a.score; });
  return list;
}

module.exports = { extractDigitRuns, rankOdoCandidates, rankStickerMiles, rankStickerDates };
