/* Meticulous — Tesseract.js OCR ticket parser (v26, doc reader v35, service sticker v51)
   On-device, offline, free. NO Google Vision.

   Handles document types:
   1. SCALE TICKETS (e.g., BURNCO Aggregate Scale Ticket):
      Ticket#, Date, Time, Gross, Tare, Net, Product, Customer, Job, PO,
      Vehicle, Vehicle Type, Received Today, Weighmaster
   2. DISPATCH SCREENSHOTS (e.g., WhatsApp dispatch message):
      Time, Equipment, Site, Location code, Instructions, Coordinates
   3. BROKER DOCUMENTS (v35): rate confirmations & bills of lading —
      full field sweep (parties, cities, dates/times, amount, material,
      qty/weight, waiting terms, instructions) via parseDocument(), plus
      a found/missed report via describeRead(). Upside-down scans are
      retried once at 180° via recognizeWithRotation().
   
   Training data:
   - training-data/scale-tickets/burnco-2026-09-30.jpg (+ .json)
   - Dispatch screenshot: workspace/user/files/63185_23_vreu.jpg
*/
(function () {
  'use strict';

  var TicketOCR = {};
  window.TicketOCR = TicketOCR;

  /* ---------- Tesseract.js loader ---------- */
  var _tessReady = null;
  TicketOCR.ensureLoaded = function () {
    if (_tessReady) return _tessReady;
    _tessReady = new Promise(function (resolve, reject) {
      if (typeof Tesseract !== 'undefined') { resolve(); return; }
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Failed to load Tesseract.js')); };
      document.head.appendChild(s);
    });
    return _tessReady;
  };

  /* Run OCR on an image (data URL, File, or URL). Returns raw text. */
  TicketOCR.recognize = function (image, onProgress) {
    return TicketOCR.ensureLoaded().then(function () {
      return Tesseract.recognize(image, 'eng', {
        logger: function (m) {
          if (onProgress && m.status === 'recognizing text') {
            try { onProgress(m.progress); } catch (e) {}
          }
        }
      });
    }).then(function (result) {
      return result.data.text;
    });
  };

  /* Rotate an image data-URL 180° (upside-down scans). Returns a data URL. */
  TicketOCR.rotate180 = function (image) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          var ctx = c.getContext('2d');
          ctx.translate(w, h);
          ctx.rotate(Math.PI);
          ctx.drawImage(img, 0, 0);
          resolve(c.toDataURL('image/jpeg', 0.92));
        } catch (e) { reject(e); }
      };
      img.onerror = function () { reject(new Error('rotate180: could not load image')); };
      img.src = image;
    });
  };

  /* OCR with one upside-down retry: if the first read comes back
     near-empty (a rotated scan reads as gibberish/nothing), rotate the
     image 180° and read again, keeping whichever read found more text. */
  TicketOCR.recognizeWithRotation = function (image, onProgress) {
    function textLen(t) { return String(t || '').replace(/\s+/g, ' ').trim().length; }
    return TicketOCR.recognize(image, onProgress).then(function (text) {
      if (textLen(text) >= 40 || typeof image !== 'string') return text;
      return TicketOCR.rotate180(image).then(function (rotated) {
        return TicketOCR.recognize(rotated, onProgress);
      }).then(function (text2) {
        return textLen(text2) > textLen(text) ? text2 : text;
      }).catch(function () { return text; });
    });
  };

  /* ---------- Helpers ---------- */
  function firstMatch(text, patterns) {
    for (var i = 0; i < patterns.length; i++) {
      var m = text.match(patterns[i]);
      if (m && m[1]) {
        var v = m[1].trim();
        if (v) return v;
      }
    }
    return null;
  }

  function allMatches(text, pattern) {
    var out = [], m, re = new RegExp(pattern.source, pattern.flags.indexOf('g') >= 0 ? pattern.flags : pattern.flags + 'g');
    while ((m = re.exec(text)) !== null) {
      if (m[1]) out.push(m[1].trim());
    }
    return out;
  }

  /* Pick the best from duplicates (e.g., ticket printed twice).
     Takes the first contiguous digit run from each candidate, then prefers
     the longest clean result. Avoids concatenating adjacent columns
     (e.g., "1026538139 6" must not become "102653813963"). */
  function bestNumeric(candidates) {
    if (!candidates.length) return null;
    var cleaned = [];
    candidates.forEach(function (c) {
      var m = String(c).match(/\d{4,}/);
      if (m) cleaned.push(m[0]);
    });
    if (!cleaned.length) return null;
    cleaned.sort(function (a, b) { return b.length - a.length; });
    return cleaned[0];
  }

  /* Most common value wins (two copies → dedupe; noisy Copy 1 loses). */
  function mostCommon(candidates) {
    if (!candidates.length) return null;
    var counts = {}, best = null, bestN = 0;
    candidates.forEach(function (c) {
      var k = String(c).trim();
      if (!k) return;
      counts[k] = (counts[k] || 0) + 1;
      if (counts[k] > bestN) { bestN = counts[k]; best = k; }
    });
    return best;
  }

  /* Truncate a captured field at the first sign of bleed-through from an
     adjacent column or next field label. */
  function truncField(s) {
    if (!s) return s;
    var cut = s.search(/\s{2,}[A-Z][a-z]+:\s|\bpate:\s|\bDate\s*:\s|\bTime\s*:\s/i);
    if (cut > 8) s = s.slice(0, cut);
    return s.replace(/\s{2,}/g, ' ').trim();
  }

  /* v107: the gibberish gate. OCR of a printed form can hallucinate
     letter-salad — Oct 16 the template reader rendered the job site
     as "ONBNERREEEEARAL HH HHE". A free-text value is gibberish
     when it carries a run of 4+ identical letters, or when it is a
     longer letters-only string almost devoid of vowels (real
     place and material names have vowels; codes carry digits and
     pass). Gibberish is NEVER rendered as a value: the field stays
     blank, the read report lists it as not found, and the caller
     escalates the photo to Power Read instead. */
  TicketOCR.looksGibberish = function (s) {
    if (!s) return false;
    var t = String(s);
    if (/([A-Za-z])\1{3,}/.test(t)) return true;
    var letters = t.replace(/[^A-Za-z]/g, '');
    if (letters.length >= 8 && !/\d/.test(t)) {
      var vowels = (letters.match(/[AEIOUaeiou]/g) || []).length;
      if (vowels / letters.length < 0.15) return true;
    }
    return false;
  };

  /* ---------- SCALE TICKET parser (BURNCO format) ---------- */
  TicketOCR.parseScaleTicket = function (text) {
    var f = { _type: 'scale_ticket' };

    // Ticket number — may appear twice (two copies). Strict digits-only;
    // bestNumeric takes the first contiguous run so adjacent columns
    // ("1026538139 6") don't get concatenated. Photo OCR renders the
    // label "Ticket." (period) as often as "Ticket:".
    var tickets = allMatches(text, /Ticket\s*[.:]?\s*([\d\s]{6,14})/gi);
    f.ticketNo = bestNumeric(tickets);

    f.date = firstMatch(text, [
      /Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
      /Date\s+(\d{1,2}\/\d{1,2}\/\d{4})/i
    ]);

    f.time = firstMatch(text, [
      /Time:\s*(\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)/i,
      /(\d{1,2}:\d{2}:\d{2}\s*[AP]M)/i
    ]);

    // Weights — photo OCR drops the colon and sometimes the decimal
    // point ("Gross 22.42Tare;_1024Net 12 14" on one run-together
    // line). Tolerate both; a space inside the number is the decimal.
    var weightSpaceForm = {};
    function weightVal(label) {
      var m = text.match(new RegExp(label + '[^0-9\\n]{0,3}([\\d]+(?:[.\\s][\\d]+)?)', 'i'));
      if (!m) return null;
      if (/\s/.test(m[1])) weightSpaceForm[label] = true; // decimal point OCR'd as a space — lower confidence
      var v = m[1].replace(/\s+/g, '.');
      var n = parseFloat(v);
      return isFinite(n) ? String(n) : null;
    }
    f.gross = weightVal('Gross');
    f.tare = weightVal('Tare');
    f.net = weightVal('Net');
    // Decimal-point repair: a weight that OCR'd as a bare 3+ digit
    // integer ("1024" for 10.24) is rescaled when the result is a
    // plausible scale weight and the raw value is not.
    ['gross', 'tare', 'net'].forEach(function (k) {
      if (!f[k] || f[k].indexOf('.') >= 0) return;
      var raw = parseFloat(f[k]);
      if (raw >= 100) {
        var fixed = raw / 100;
        var g = parseFloat(f.gross);
        if (fixed < 200 && (k === 'gross' || !isFinite(g) || fixed < g)) f[k] = String(fixed);
      }
    });
    // Scale arithmetic is definitional: any two weights give the third.
    // And when all three are present but disagree slightly, a weight
    // whose decimal point OCR'd as a space is the least reliable —
    // recompute it from the other two.
    (function () {
      var g = parseFloat(f.gross), t = parseFloat(f.tare), n = parseFloat(f.net);
      function r2(x) { return String(Math.round(x * 100) / 100); }
      if (isFinite(g) && isFinite(t) && !isFinite(n) && g > t) f.net = r2(g - t);
      else if (isFinite(g) && isFinite(n) && !isFinite(t) && g > n) f.tare = r2(g - n);
      else if (isFinite(t) && isFinite(n) && !isFinite(g)) f.gross = r2(t + n);
      else if (isFinite(g) && isFinite(t) && isFinite(n) && Math.abs(g - t - n) > 0.02 && Math.abs(g - t - n) <= 0.15) {
        if (weightSpaceForm.Net && !weightSpaceForm.Gross && !weightSpaceForm.Tare) f.net = r2(g - t);
        else if (weightSpaceForm.Tare && !weightSpaceForm.Gross && !weightSpaceForm.Net) f.tare = r2(g - n);
        else if (weightSpaceForm.Gross && !weightSpaceForm.Tare && !weightSpaceForm.Net) f.gross = r2(t + n);
      }
    })();

    // Product — e.g., "40MM CRUSHED ROCK". OCR may misread digits ("20MM").
    // Prefer the match that appears most often (two copies = dedupe).
    var products = allMatches(text, /(\d{1,3}\s*MM\s+[A-Z][A-Z\s]*?(?:CRUSHED\s+ROCK|GRAVEL|SAND|FILL|ROCK))/gi);
    if (products.length) {
      var counts = {};
      products.forEach(function (p) {
        var k = p.toUpperCase().replace(/\s+/g, ' ');
        counts[k] = (counts[k] || 0) + 1;
      });
      var best = null, bestN = 0;
      for (var k in counts) { if (counts[k] > bestN) { bestN = counts[k]; best = k; } }
      f.product = best;
    }
    // Product code (e.g., SG0403300)
    f.productCode = firstMatch(text, [/Product:\s*([A-Z0-9]{6,})/i]);

    f.customer = firstMatch(text, [
      /Customer:\s*([^\n]{3,70})/i
    ]);
    if (f.customer) f.customer = truncField(f.customer);

    f.job = firstMatch(text, [/Job:\s*([A-Z0-9\-]+)/i]);

    // P.O. — OCR variants: "P.O.:", "P.O", "PD:"
    f.po = firstMatch(text, [
      /P\.?\s*O\.?\s*:\s*(\d{6,})/i,
      /\bPD:\s*(\d{6,})/i
    ]);

    // Vehicle type — specific equipment words, optional "- X" suffix.
    // Avoids greedy capture bleeding into "Received Today".
    var vt = text.match(/Type:\s*(Tandem|Tridem|Tri-axle|Single|End\s*dump)(?:\s*-\s*([A-Z]))?/i);
    if (vt) {
      f.vehicleType = vt[1] + (vt[2] ? ' - ' + vt[2] : '');
    } else {
      f.vehicleType = firstMatch(text, [/Type:\s*([A-Za-z\- ]{2,20})/i]);
      if (f.vehicleType) f.vehicleType = truncField(f.vehicleType);
    }

    f.vehicle = firstMatch(text, [/Vehicle:\s*([A-Z0-9]+)/i]);

    // Carrier — OCR sometimes reads "Comer"
    f.carrier = firstMatch(text, [/(?:Carrier|Comer)\s*:\s*([A-Z0-9]+)/i]);

    f.receivedToday = firstMatch(text, [
      /Received Today:?\s*([\d.]+)\s*[t1lI]?\b/i
    ]);
    // Photo OCR drops the decimal point in this cumulative figure
    // ("10022" for 100.22 t): a 4+ digit integer here is tonnes with
    // two implied decimals.
    if (f.receivedToday && /^\d{4,}$/.test(f.receivedToday)) {
      f.receivedToday = f.receivedToday.slice(0, -2) + '.' + f.receivedToday.slice(-2);
    }
    // Normalize: ensure it ends with " t" for tonnes
    if (f.receivedToday && !/[a-z]/i.test(f.receivedToday)) {
      f.receivedToday = f.receivedToday + ' t';
    }

    f.weighmaster = firstMatch(text, [/Weighmaster:\s*([A-Z0-9]+)/i]);

    // Site ID appears twice (two copies); Copy 2 (later in text) is cleaner.
    // Prefer the last distinct match.
    var siteIds = allMatches(text, /Site ID:\s*(\d{4,6})/gi);
    if (siteIds.length) {
      f.siteId = siteIds[siteIds.length - 1];
    }
    f.order = firstMatch(text, [/Order:\s*([A-Z0-9]+)/i]);

    // Count how many fields we got (confidence)
    var count = 0;
    ['ticketNo', 'date', 'time', 'gross', 'tare', 'net', 'product',
     'customer', 'job', 'po', 'vehicleType'].forEach(function (k) {
      if (f[k]) count++;
    });
    f._confidence = count;
    f._raw = text;

    return f;
  };

  /* ---------- DISPATCH SCREENSHOT parser ---------- */

  /* DMS → decimal degrees. e.g. 50°57'59.4"N → 50.9665 */
  function dmsToDecimal(deg, min, sec, hemi) {
    var v = parseFloat(deg) + parseFloat(min) / 60 + parseFloat(sec || 0) / 3600;
    if (!isFinite(v)) return null;
    if (hemi === 'S' || hemi === 'W') v = -v;
    return Math.round(v * 1000000) / 1000000;
  }

  /* "Tomorrow 8:00am" / "Today 6:30 PM" / "8:00am" → local ISO string for a
     datetime-local input ("YYYY-MM-DDTHH:MM"). Bare times assume today. */
  function parseDispatchDateTime(text) {
    var tm = String(text).match(/(Today|Tomorrow)?\s*(\d{1,2}):(\d{2})\s*([aApP])[mM]/);
    if (!tm) return null;
    var d = new Date();
    if (tm[1] && /tomorrow/i.test(tm[1])) d.setDate(d.getDate() + 1);
    var h = parseInt(tm[2], 10) % 12;
    if (/p/i.test(tm[4])) h += 12;
    d.setHours(h, parseInt(tm[3], 10), 0, 0);
    function p2(n) { return ('0' + n).slice(-2); }
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
      'T' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }

  TicketOCR.parseDispatch = function (text) {
    var f = { _type: 'dispatch' };

    // Time — e.g., "Tomorrow 8:00am", "8:00am"
    var tm = text.match(/(Tomorrow\s+)?(\d{1,2}:\d{2}\s*[ap]m)/i);
    if (tm) {
      f.time = (tm[1] || '') + tm[2];
      f.time = f.time.trim();
      // v31 fix: resolve to an actual dispatch datetime (was dumped in notes)
      f.datetime = parseDispatchDateTime(text);
    }

    // Equipment type
    var eq = firstMatch(text, [/(Tandem|Tridem|Tri-axle|End\s*dump|Single\s*axle)/i]);
    if (eq) f.equipment = eq;

    // Site/company — full name, not one word. v31 fix: the old regex
    // /(Aecon\s+\w+)/ captured only "Aecon" + a single word and could clip
    // the name ("Aecon Inf…"). Capture Aecon + following name words, but
    // stop before instruction/equipment words ("Go Empty To", "Tandem"…).
    var site = firstMatch(text, [/(Aecon(?:\s+(?!Go\b|Empty\b|Tomorrow\b|Today\b|Tandem\b|Tridem\b)[A-Z][\w&.'-]*){1,4})/i]);
    if (!site) {
      // Generic fallback: a Capitalized company-ish line (2-5 words)
      site = firstMatch(text, [/\b([A-Z][\w&.'-]+(?:\s+[A-Z][\w&.'-]+){1,4})\s*(?:Ltd|Inc|Corp|Group|Construction|Infrastructure)?\b/]);
    }
    if (site) {
      // Belt-and-braces: cut anything from an instruction phrase onward
      site = site.replace(/\s+(Go\s+Empty.*|Tomorrow\b.*|Today\b.*)$/i, '');
      f.site = site.replace(/\s+/g, ' ').trim();
    }

    // Location code — e.g., "A2-L20"
    f.locationCode = firstMatch(text, [/\b([A-Z]\d+-[A-Z]\d+)\b/]);

    // Instructions — e.g., "Go Empty To"
    var inst = firstMatch(text, [/(Go\s+Empty\s+To)/i]);
    if (inst) f.instructions = inst;

    /* v52: driver-speak movement extraction — move type, destination,
       origin. Dispatches arrive as terse instructions: "Go to Ivor East
       Pond empty", "Twins East loaded to the plant", "Haul from North
       Pit to South Plant". The extracted place names are LABELS ONLY —
       never geocode a name (v50 rule); fences need coordinates. */
    function trimPlace(s) {
      if (!s) return null;
      s = String(s).replace(/\s+/g, ' ').trim();
      s = s.replace(/^(the|to|at)\s+/i, '');
      s = s.replace(/\s+(empty|loaded|tomorrow|today|tandem|tridem|please|and then)\b.*$/i, '');
      s = s.replace(/[\s,.:;]+$/, '').trim();
      if (s.length < 3 || !/[A-Za-z]/.test(s)) return null;
      if (/^(here|there|site|yard\s+gate)$/i.test(s)) return s.length >= 4 ? s : null;
      return s;
    }
    var mv = null; // {moveType, destination, origin, clause}
    var mFromTo = text.match(/\bfrom\s+(?:the\s+)?(.{2,40}?)\s+to\s+(?:the\s+)?(.{2,40}?)(?=[.,;\n]|$|\s+empty\b|\s+loaded\b)/i);
    if (mFromTo) {
      mv = { origin: trimPlace(mFromTo[1]), destination: trimPlace(mFromTo[2]),
             moveType: /\bempty\b/i.test(text) ? 'empty' : 'loaded' };
    }
    if (!mv) {
      var mLead = text.match(/^(.{2,40}?)\s+loaded\s+to\s+(?:the\s+)?(.{2,40}?)(?=[.,;\n]|$)/im);
      if (mLead) mv = { origin: trimPlace(mLead[1]), destination: trimPlace(mLead[2]), moveType: 'loaded' };
    }
    if (!mv) {
      var mAt = text.match(/\bloaded\s+at\s+(.{2,40}?)[,;]\s*dump\s+(?:at|to)\s+(?:the\s+)?(.{2,40}?)(?=[.,;\n]|$)/i);
      if (mAt) mv = { origin: trimPlace(mAt[1]), destination: trimPlace(mAt[2]), moveType: 'loaded' };
    }
    if (!mv) {
      var mGet = text.match(/\bgo\s+empty\s+to\s+(?:the\s+)?(.{2,40}?)(?=[.,;:\n]|$)/i);
      if (mGet) mv = { destination: trimPlace(mGet[1]), moveType: 'empty' };
    }
    if (!mv) {
      var mDh = text.match(/\bdeadhead\s+(?:to\s+)?(?:the\s+)?(.{2,40}?)(?=[.,;\n]|$)/i);
      if (mDh) mv = { destination: trimPlace(mDh[1]), moveType: 'empty' };
    }
    if (!mv) {
      var mGte = text.match(/\bgo\s+to\s+(?:the\s+)?(.{2,40}?)\s+empty\b/i);
      if (mGte) mv = { destination: trimPlace(mGte[1]), moveType: 'empty' };
    }
    if (!mv) {
      var mHt = text.match(/\b(?:haul|bring|grab|load)\b[^.\n]{0,30}?\bto\s+(?:the\s+)?(.{2,40}?)(?=[.,;\n]|$)/i);
      if (mHt) {
        mv = { destination: trimPlace(mHt[1]), moveType: 'loaded' };
        var mLead2 = text.match(/^(.{2,40}?),\s*(?:haul|bring|grab|load)\b/i);
        if (mLead2) mv.origin = trimPlace(mLead2[1]);
      }
    }
    if (!mv && /\bempty\b/i.test(text) && /\b(go|to|deadhead|travel|head)\b/i.test(text)) {
      mv = { moveType: 'empty' };
    }
    if (!mv && /\b(grab|dump|haul|load|loaded|pick\s?up)\b/i.test(text)) {
      mv = { moveType: 'loaded' };
    }
    if (mv) {
      if (mv.moveType) f.moveType = mv.moveType;
      if (mv.destination) f.destination = mv.destination;
      else if (f.locationCode && mv.moveType === 'empty') f.destination = f.locationCode;
      if (mv.origin) f.origin = mv.origin;
      if (!f.instructions) {
        var clause = text.match(/[^\n.!?]*\b(go|deadhead|haul|bring|grab|dump|loaded)\b[^\n.!?]*/i);
        if (clause) f.instructions = clause[0].replace(/\s+/g, ' ').trim().slice(0, 90);
      }
    }

    // Coordinates — e.g., 50°57'59.4"N  114°01'54.4"W
    // v31 fix: convert DMS to decimal lat/lng so a real map pin can be made
    // (previously the raw DMS text was dumped into Notes).
    var cm = String(text).match(/(\d{1,3})°\s*(\d{1,2})'\s*([\d.]+)["”]?\s*([NS])[\s,]*(\d{1,3})°\s*(\d{1,2})'\s*([\d.]+)["”]?\s*([EW])/);
    if (cm) {
      var la = dmsToDecimal(cm[1], cm[2], cm[3], cm[4]);
      var lo = dmsToDecimal(cm[5], cm[6], cm[7], cm[8]);
      if (la !== null && lo !== null) {
        f.lat = la;
        f.lng = lo;
        f.coordinates = cm[1] + '°' + cm[2] + "'" + cm[3] + '"' + cm[4] + ' ' +
                        cm[5] + '°' + cm[6] + "'" + cm[7] + '"' + cm[8];
        f.latitude = f.coordinates;
        f.longitude = '';
      }
    }
    if (f.lat === undefined) {
      // Fallback: decimal coords already in text, e.g. "51.0447, -114.0719"
      var dm = String(text).match(/(-?\d{2,3}\.\d{4,})[\s,]+(-?\d{2,3}\.\d{4,})/);
      if (dm) {
        var dLat = parseFloat(dm[1]), dLng = parseFloat(dm[2]);
        if (Math.abs(dLat) <= 90 && Math.abs(dLng) <= 180) {
          f.lat = dLat; f.lng = dLng;
          f.coordinates = dLat + ', ' + dLng;
        }
      }
    }

    var count = 0;
    ['time', 'datetime', 'equipment', 'site', 'locationCode', 'instructions', 'coordinates'].forEach(function (k) {
      if (f[k]) count++;
    });
    f._confidence = count;
    f._raw = text;

    return f;
  };

  /* ---------- AECON DAILY TRUCK HAUL CARD (foreman ticket) parser ----------
     CRITICAL LIMITATION (tested Oct 13 2026 with real card):
     Tesseract.js CANNOT reliably read:
     - Handwriting (Project "A01728" → "ROI7 26", Date "Oct 13, 2026" → "Cut 12 2006",
       Material "Clay" → "(ls", Start Time "8:30 AM" → missing entirely)
     - Checkbox states (checked vs unchecked needs image analysis, not OCR)
     - Table cell contents (grid lines confuse the OCR engine)
     What it CAN read:
     - Form type: "DAILY TRUCK HAUL CARD"
     - Card number: "23141" (printed)
     - Printed field labels (START TIME, PAYMENT UNIT, etc.)
     Strategy: detect the form, extract the card number, and return
     needsReview[] listing the handwritten/checkbox fields the app must
     prompt the user to confirm. NEVER guess a handwritten value. */
  TicketOCR.parseHaulCard = function (text) {
    var f = { _type: 'haul_card' };

    // Form type detection — the printed header OCRs imperfectly at
    // photo resolution ("BAILY TRUCK HAUL CARD", words dropped), so
    // accept the distinctive fragments in combination.
    f.isHaulCard = /DAILY\s+TRUCK\s+HAUL\s+CARD/i.test(text) ||
      /(DAILY|BAILY|DAIL)\s+TRUCK\s+HAUL/i.test(text) ||
      (/TRUCK\s+HAUL/i.test(text) && /\bCARD\b/i.test(text)) ||
      (/\bHAUL\s+CARD\b/i.test(text) && /(AECON|ACLU|ABCON)/i.test(text));

    // Card number — printed, bottom-right (e.g., "23141"); most are 5
    // digits but 4-digit cards exist (8590, 8367). Prefer a candidate
    // near the end of the text (bottom of the form), 5-6 digits first,
    // then a 4-digit that is not a year.
    var cardNo = firstMatch(text, [
      /OPERATOR[\s\S]{0,200}?(\d{5})\s*$/i,
      /(\d{5})\s*$/,
      /\b(23141)\b/
    ]);
    if (!cardNo) {
      var cand = [];
      var reCN = /\b(\d{4,6})\b/g, mCN;
      while ((mCN = reCN.exec(text)) !== null) cand.push({ v: mCN[1], at: mCN.index });
      var tail = cand.filter(function (c) { return c.at > text.length * 0.6 && c.v.length >= 5; });
      if (tail.length) cardNo = tail[tail.length - 1].v;
      if (!cardNo) {
        var fives = cand.filter(function (c) { return c.v.length >= 5; });
        if (fives.length) cardNo = fives[fives.length - 1].v;
      }
      if (!cardNo) {
        var fours = cand.filter(function (c) {
          var n = parseInt(c.v, 10); return !(n >= 1900 && n <= 2099);
        });
        if (fours.length) cardNo = fours[fours.length - 1].v;
      }
    }
    f.cardNumber = cardNo;

    // Company — OCR misreads "AECON" several ways ("ACLU", "ABCON",
    // "Aecon" with broken case); fuzzy match the observed variants
    if (/AECON|ACLU|ABCON/i.test(text)) f.company = 'AECON';

    // Payment unit options — known for AECON haul cards.
    // OCR cannot reliably read these labels from the form, so we use the
    // known options when the form type is detected. Checkbox STATE still
    // needs manual confirmation (see needsReview).
    if (f.isHaulCard) {
      f.paymentUnitOptions = ['HOUR', 'TONNE', 'TONNE / KM', 'OTHER'];
    } else {
      f.paymentUnitOptions = [];
      if (/HOUR/i.test(text)) f.paymentUnitOptions.push('HOUR');
      if (/TONNE/i.test(text)) f.paymentUnitOptions.push('TONNE');
    }

    // Truck type options (printed labels)
    f.truckTypeOptions = [];
    if (/TANDEM\s+TRUCK\s+ONLY/i.test(text)) f.truckTypeOptions.push('TANDEM TRUCK ONLY');

    // Fields that MUST be manually confirmed (handwriting/checkboxes)
    f.needsReview = [
      'project',      // handwritten, e.g., "A01728"
      'date',         // handwritten, e.g., "Oct 13, 2026"
      'material',     // handwritten, e.g., "Clay"
      'startTime',    // handwritten, e.g., "8:30 AM" — CRITICAL for pay
      'finishTime',   // handwritten — CRITICAL for pay
      'totalHours',   // handwritten — CRITICAL: foreman ticket hours determine pay
      'paymentUnit',  // checkbox: HOUR / TONNE / TONNE/KM / OTHER — CRITICAL
      'truckType',    // checkbox
      'totalNetWeight' // handwritten table total — for Pay by Weight
    ];

    /* v107: labeled start/finish/total-hours attempts. On-device
       handwriting rarely yields these cleanly, but the Power Read
       transcription of the same card is clean text ("Start Time:
       8:00 AM", "Total Hours: 10.0") and this parser is what reads
       transcriptions too — the labels are the anchors either way.
       Values land as CANDIDATES: the close confirm view shows them
       in its fields for the driver's check, exactly like every
       other read. */
    var stM = text.match(/START(?:\s*TIME)?\s*[:.]?\s*(\d{1,2}[:.]\d{2}\s*[AP]M)/i);
    if (stM) { var stV = normTime(stM[1].replace('.', ':')); if (stV) f.startTime = stV; }
    var fnM = text.match(/FINISH(?:\s*TIME)?\s*[:.]?\s*(\d{1,2}[:.]\d{2}\s*[AP]M)/i);
    if (fnM) { var fnV = normTime(fnM[1].replace('.', ':')); if (fnV) f.finishTime = fnV; }
    var thM = text.match(/TOTAL\s*HOURS?\s*[:.]?\s*(\d{1,2}(?:\.\d{1,2})?)/i);
    if (thM) { var thV = parseFloat(thM[1]); if (thV > 0 && thV <= 24) f.totalHours = String(thV); }

    // Attempt handwritten field extraction (best-effort, LOW confidence)
    // These are returned but flagged — the app MUST ask user to confirm.
    f._handwritingAttempts = {};

    // Project: handwritten after "Project" label — try to find alphanumeric near it
    // (Unreliable; included for debugging, not for use)
    var projAttempt = text.match(/Project\s*([A-Z0-9]{4,10})/i);
    if (projAttempt) f._handwritingAttempts.project = projAttempt[1];

    var count = 0;
    ['cardNumber', 'company'].forEach(function (k) { if (f[k]) count++; });
    if (f.isHaulCard) count += 2;
    f._confidence = count;
    f._raw = text;

    return f;
  };

  /* ---------- DOCUMENT parser (rate confirmations & bills of lading) ----------
     v35: drivers' real paperwork is broker rate confirmations and BOLs,
     not just haul cards. Full field sweep across everything a dispatch
     can use: parties + cities, dates/times, amount, truck type,
     material/description, qty/weight, waiting-time terms, instructions.
     Table layouts OCR line-by-line with columns interleaved, so party
     extraction is layered: label anchors first, then same-line and
     ordered-phrase fallbacks. Whatever is missed is reported through
     describeRead() — never silently dropped. */
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7,
                 aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function isoDate(y, mo, d) {
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    function p2(n) { return ('0' + n).slice(-2); }
    return y + '-' + p2(mo) + '-' + p2(d);
  }
  function normDate(s) {
    if (!s) return null;
    s = String(s);
    var m;
    if ((m = s.match(/\b(\d{1,2})[-\t ]([A-Za-z]{3,9})[-\t ](\d{2,4})\b/))) {    // 24-Apr-18 — same-line separators only + \b both ends (v88/v89): a newline hop let a number ending the line above pose as the day ("8001\nOct 14" -> 2014-10-01; "$234.32\nOct 14" -> day "32" vetoed the real date). An invalid candidate falls through instead of vetoing the patterns below.
      var mo1 = MONTHS[m[2].slice(0, 3).toLowerCase()];
      var y1 = parseInt(m[3], 10); if (y1 < 100) y1 += 2000;
      if (mo1) { var r1 = isoDate(y1, mo1, parseInt(m[1], 10)); if (r1) return r1; }
    }
    if ((m = s.match(/([A-Za-z]{3,9})[\t ]+(\d{1,2}),?[\t ]+(\d{4})/))) {        // Apr 24, 2018 — same-line only (v89), invalid falls through
      var mo2 = MONTHS[m[1].slice(0, 3).toLowerCase()];
      if (mo2) { var r2 = isoDate(parseInt(m[3], 10), mo2, parseInt(m[2], 10)); if (r2) return r2; }
    }
    if ((m = s.match(/(\d{4})-(\d{2})-(\d{2})/))) return m[0];                   // 2026-10-14
    if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/))) {                  // 3/26/2020 — \b both ends, same v88 anchoring
      var y3 = parseInt(m[3], 10); if (y3 < 100) y3 += 2000;
      return isoDate(y3, parseInt(m[1], 10), parseInt(m[2], 10));
    }
    return null;
  }
  function normTime(s) {
    if (!s) return null;
    var m = String(s).match(/(\d{1,2}):(\d{2})\s*([AP]M)?/i);
    if (!m) return null;
    var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (m[3]) {
      if (/p/i.test(m[3]) && h < 12) h += 12;
      if (/a/i.test(m[3]) && h === 12) h = 0;
    }
    if (h > 23 || mi > 59) return null;
    function p2(n) { return ('0' + n).slice(-2); }
    return p2(h) + ':' + p2(mi);
  }
  function cleanCompany(s) {
    if (!s) return null;
    s = String(s).replace(/\s+/g, ' ').replace(/[\s,;]+$/, '').trim();
    return s.length >= 3 ? s : null;
  }
  function cutAtDigit(s) {
    if (!s) return s;
    var i = s.search(/\s+\d/);
    return i > 2 ? s.slice(0, i) : s;
  }
  /* Capitalized company-like phrases in reading order. ALL-CAPS label
     runs and street/label tail words are filtered out, and known form
     labels are trimmed off phrase edges (OCR linearization chains them
     onto real names: "INFORMATION MoveMore Freight Pickup"). */
  function companyPhrases(str) {
    var out = [];
    var stop = { 'order confirmation': 1, 'pick up information': 1,
      'third notified party': 1, 'united states': 1, 'special instructions': 1,
      'other comments': 1, 'company name': 1 };
    var labelWord = /^(INFORMATION|PICK|UP|PICKUP|SHIP|TO|TOTAL|SUBTOTAL|BILL|DATE|TIME|NAME|ADDRESS|CITY|PHONE|PARTY|CONFIRMATION|ORDER|RATE|LOAD|QTY|WEIGHT|DESCRIPTION)$/i;
    function trimLabels(p) {
      var w = p.split(' ');
      while (w.length > 2 && labelWord.test(w[0])) w.shift();
      while (w.length > 2 && labelWord.test(w[w.length - 1])) w.pop();
      return w.join(' ');
    }
    var re = /\b([A-Z][A-Za-z&.'-]*(?:\s+(?:[A-Z][A-Za-z&.'-]*|of|the|and)){1,3})\b/g, m;
    while ((m = re.exec(String(str)))) {
      var p = trimLabels(m[1].replace(/\s+/g, ' ').trim());
      if (p.split(' ').length < 2) continue;
      if (stop[p.toLowerCase()]) continue;
      if (!/[a-z]/.test(p)) continue;
      if (/(Avenue|Ave|Street|Road|Blvd|Drive|Lane|Court|Way|Information|Confirmation|Party|Instructions|Comments|Name|Address|City|Phone)$/i.test(p)) continue;
      if (out.indexOf(p) === -1) out.push(p);
    }
    return out;
  }
  /* City candidates with positions: "Mississauga, ON" and
     "Catskill New York 12414" shapes. */
  function cityCandidates(text) {
    var out = [], m;
    var reCA = /([A-Z][a-z]+(?: [A-Z][a-z]+)?),\s*(ON|QC|AB|BC|MB|SK|NB|NS|NL|Ontario|Quebec|Alberta)\b/g;
    while ((m = reCA.exec(text))) out.push({ city: m[1], idx: m.index });
    var reUS = /([A-Z][a-z]+(?: [A-Z][a-z]+)?)\s+(New York|Florida|Texas|California|Ohio|Georgia|Illinois|Michigan|Pennsylvania|New Jersey)\s+\d{5}/g;
    while ((m = reUS.exec(text))) {
      var city = m[1];
      // "169 Maple Avenue Catskill New York 12414" — the street suffix
      // word ("Avenue") is not part of the city; drop a leading one.
      city = city.replace(/^(Avenue|Ave|Street|St|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way)\s+/, '');
      out.push({ city: city, idx: m.index });
    }
    out.sort(function (a, b) { return a.idx - b.idx; });
    return out;
  }

  TicketOCR.parseDocument = function (text) {
    var isRateCon = /ORDER\s+CONFIRMATION|RATE\s+CONFIRMATION|LOAD\s+CONFIRMATION|CARRIER\s+CONFIRMATION/i.test(text);
    var isBOL = /STRAIGHT\s+BILL\s+OF\s+LADING/i.test(text) ||
                (/BILL\s+OF\s+LADING/i.test(text) && !/NOT\s+A\s+BILL\s+OF\s+LADING/i.test(text));
    var weakDoc = /PICK\s?UP/i.test(text) && /SHIP\s+TO/i.test(text) &&
                  /TOTAL\s*\$?\s*[\d,]+\.\d{2}/i.test(text);
    if (!isRateCon && !isBOL && !weakDoc) return null;

    var f = { _type: isRateCon ? 'rate_confirmation' : isBOL ? 'bill_of_lading' : 'document',
              _strong: !!(isRateCon || isBOL) };

    /* Broker / carrier (the party issuing the document) */
    var billToAt = text.search(/BILL\s+TO/i);
    if (billToAt >= 0) {
      var bp = companyPhrases(text.slice(billToAt, billToAt + 220));
      if (bp.length) f.broker = bp[0];
    }
    if (f.broker) {
      // Strip a leading section label ("Broker Info BBI" -> "BBI") and
      // reject a bare label with no company behind it ("Bill To").
      f.broker = f.broker.replace(/^(Broker\s+Info|Bill\s+To|Ship\s+To|Carrier|Broker)\s+/i, '');
      if (/^(Bill\s+To|Ship\s+To|Pickup|Delivery|Broker\s+Info)$/i.test(f.broker)) f.broker = undefined;
    }
    if (!f.broker) {
      var hdr = firstMatch(text, [/^\s*([A-Z][A-Za-z&.'-]*(?:\s+[A-Z][A-Za-z&.'-]*){1,3})\s+(?:Order|Rate|Load|Carrier)\s+Confirmation/im]);
      if (hdr) f.broker = cleanCompany(hdr);
    }

    /* Order / confirmation number — broker formats vary wildly:
       "Route # 3000217588", "Load #: 1551183", "LOAD# 268133",
       "Load ID: 31367432", "LOAD NUMBER 13865084". Label-anchored
       digit runs win; the generic fallbacks must contain a digit
       (they used to capture words like "Date" / "Bill To"). */
    f.orderNo = firstMatch(text, [
      /\bRoute\s*#\s*:?\s*(\d{5,})/i,
      /\bLoad\s*#\s*:?\s*(\d{4,})/i,
      /\bLoad\s+ID\s*:?\s*(\d{4,})/i,
      /\bLoad\s+Number\s*:?\s*(\d{4,})/i,
      /\bOrder\s*#\s*:?\s*(\d{3,})/i,
      /\bConfirmation\s*(?:#|No\.?)\s*:?\s*(\d{4,})/i
    ]);
    if (!f.orderNo) {
      var gen = firstMatch(text, [
        /(?:Order|Rate|Load)\s+Confirmation\s*:?\s*#?\s*([A-Z]{1,5}[- ]?[A-Z0-9-]{2,})/i,
        /Confirmation\s*(?:#|No\.?)?\s*:?\s*([A-Z0-9-]{4,})/i,
        /Pickup\s*#\s*:?\s*([A-Z0-9-]{4,})/i
      ]);
      if (gen && /\d/.test(gen)) f.orderNo = gen;
    }

    /* Total amount / rate */
    var amt = firstMatch(text, [
      /TOTAL[\s:]*\$?\s*([\d,]+\.\d{2})/i,
      /Total\s*(?:Due|Amount)[\s:]*\$?\s*([\d,]+(?:\.\d{2})?)/i,
      /Rate[\s:]*\$\s*([\d,]+(?:\.\d{2})?)/i
    ]);
    if (!amt) {
      var dollars = allMatches(text, /\$\s*([\d,]+\.\d{2})/g);
      if (dollars.length) {
        dollars.sort(function (a, b) {
          return parseFloat(b.replace(/,/g, '')) - parseFloat(a.replace(/,/g, ''));
        });
        amt = dollars[0];
      }
    }
    if (amt) f.amount = amt.replace(/,/g, '');

    /* Parties — pickup (shipper) and delivery (consignee) */
    var pc = firstMatch(text, [
      /Company Name:\s*([^\n]{3,60})/i,
      /Pickup Company:\s*([^\n]{3,60})/i,
      /Shipper:?\s*([^\n]{3,60})/i
    ]);
    if (pc) pc = cleanCompany(cutAtDigit(pc));
    f.pickupCompany = pc;

    var dc = firstMatch(text, [
      /Consignee\s*:\s*([A-Z][^\n]{3,60})/i,
      /To\s*\(Consignee\)\s*:?\s*([A-Z][^\n]{3,60})/i,
      /Ship\s*To:?\s*\n\s*([A-Z][^\n]{3,60})/i,
      /Destination:?\s*([^\n]{3,60})/i
    ]);
    if (dc) dc = cleanCompany(cutAtDigit(dc));
    // Reject label-bleed: a capture that is really the parties-row labels
    // or that contains the pickup company is not the delivery company
    // (e.g. "Company Name: Rock Solid Provisions…" from the SHIP TO row).
    if (dc && ((pc && dc.indexOf(pc) >= 0) || /^(Company|Address|City|Zip|Phone|State|Province)\b/i.test(dc))) {
      dc = null;
    }
    if (!dc && pc) {
      // Same-line fallback: the parties row linearizes as
      // "PickupCo 169 Maple  DeliveryCo  BrokerCo" — strip the pickup
      // company, its street number + street-name word, and the broker.
      var lines = text.split('\n');
      for (var li = 0; li < lines.length && !dc; li++) {
        if (lines[li].indexOf(pc) === -1) continue;
        var rest = lines[li].slice(lines[li].indexOf(pc) + pc.length);
        rest = rest.replace(/^\s*\d+\s+[A-Za-z]+\s+/, ' ');
        if (f.broker) rest = rest.replace(f.broker, ' ');
        dc = cleanCompany(cutAtDigit(rest.replace(/\s+/g, ' ')));
        if (dc && dc.length < 4) dc = null;
      }
    }
    if (!dc && pc) {
      var afterPc = text.slice(text.indexOf(pc) + pc.length, text.indexOf(pc) + pc.length + 700);
      var phrases = companyPhrases(afterPc);
      for (var pi = 0; pi < phrases.length; pi++) {
        if (phrases[pi] !== pc && phrases[pi] !== f.broker) { dc = phrases[pi]; break; }
      }
    }
    // The broker's name can trail the delivery company in the parties
    // row ("Five Star Rags MoveMore Freight") — cut it off.
    if (dc && f.broker) {
      var bw = f.broker.split(' ').slice(0, 2).join(' ');
      var bi = dc.indexOf(bw);
      if (bi > 2) dc = cleanCompany(dc.slice(0, bi));
    }
    f.deliveryCompany = dc;

    /* Cities — nearest candidate after each company, each used once */
    var cities = cityCandidates(text);
    var usedCity = {};
    function cityAfter(company) {
      if (!company) return null;
      var at = text.indexOf(company);
      for (var i = 0; i < cities.length; i++) {
        if (cities[i].idx > at && !usedCity[cities[i].idx]) {
          usedCity[cities[i].idx] = 1;
          return cities[i].city;
        }
      }
      return null;
    }
    f.pickupCity = cityAfter(f.pickupCompany);
    f.deliveryCity = cityAfter(f.deliveryCompany);

    /* Dates & times */
    var pdRaw = firstMatch(text, [
      /Pickup Date\s*:?\s*([^\n]{4,18})/i,
      /Ship\s*Date:?\s*([^\n]{4,18})/i,
      /\bShip:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
      /\bLoad:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i
    ]);
    f.pickupDate = normDate(pdRaw);
    var ptRaw = firstMatch(text, [/Pickup Time\s*:?\s*([^\n]{3,22})/i]);
    if (ptRaw) {
      f.pickupTime = normTime(ptRaw);
      if (/before/i.test(ptRaw)) f.pickupQualifier = 'before';
      else if (/after/i.test(ptRaw)) f.pickupQualifier = 'after';
    }
    if (f.pickupDate) {
      f.scheduledAt = f.pickupDate + 'T' + (f.pickupTime || '08:00');
    }
    var ddRaw = firstMatch(text, [/Delivery Date\s*:?\s*([^\n]{2,30})/i]);
    var dtRaw = firstMatch(text, [/Delivery Time\s*:?\s*([^\n]{2,30})/i]);
    f.deliveryDate = normDate(ddRaw);
    var dNotes = [];
    if (ddRaw && !f.deliveryDate && !/same/i.test(ddRaw)) dNotes.push(ddRaw.replace(/\s+/g, ' ').trim());
    if (dtRaw) dNotes.push(dtRaw.replace(/\s+/g, ' ').trim());
    else if (ddRaw && /same/i.test(ddRaw)) dNotes.push(ddRaw.replace(/\s+/g, ' ').trim());
    if (dNotes.length) f.deliveryNote = dNotes.join(' · ');
    if (!f.deliveryDate && f.pickupDate && /same/i.test((ddRaw || '') + ' ' + (dtRaw || ''))) {
      f.deliveryDate = f.pickupDate;
    }

    /* Truck type (FTL/LTL are load types, not trucks — see material) */
    f.equipment = firstMatch(text, [/(Tandem|Tridem|Tri-axle|Tri\s+axle|Quad\s+axle|End\s*dump|Single\s*axle)/i]);

    /* Material / description */
    var descParts = [];
    if (/NON\s*HAZ/i.test(text)) descParts.push('NON HAZ');
    else if (/\bHAZMAT\b/i.test(text)) descParts.push('HAZMAT');
    var lt = firstMatch(text, [/\b(FTL|LTL)\b/i]);
    if (lt) descParts.push(lt.toUpperCase());
    if (!descParts.length || isBOL) {
      var goods = firstMatch(text, [
        /([A-Z][a-z]{3,}(?:\s+[\w#-]{1,8}){0,3})\s+\d+\s+CHEP\s+PALLETS/i,
        /Description:?\s*\n?\s*([A-Z][^\n]{3,50})/i
      ]);
      if (goods) descParts.push(goods.replace(/\s+/g, ' ').trim());
    }
    if (descParts.length) f.material = descParts.join(' · ');

    /* Quantity & weight */
    f.qty = firstMatch(text, [
      /(\d[\d,]*)\s+(cases|cartons|boxes|skids|pallets|units)\b/i,
      /(\d+)\s+CHEP\s+PALLETS/i
    ]);
    if (f.qty && /CHEP/i.test(text) && !/pallet/i.test(f.qty)) f.qty = f.qty + ' CHEP pallets';
    f.weight = firstMatch(text, [
      /Gross Weight:?\s*([\d,]{3,})/i,
      /Net Weight:?\s*([\d,]{3,})/i,
      /Weight:?\s*([\d,]{4,})\s*(lbs|kg)?/i
    ]);

    /* Waiting-time terms */
    var wait = firstMatch(text, [
      /\$?(\d+(?:\.\d+)?)\s*\/\s*hr\s+(?:for\s+)?waiting/i,
      /waiting time[^.\n]{0,40}?\$(\d+(?:\.\d+)?)/i,
      /detention[^.\n]{0,30}?\$(\d+(?:\.\d+)?)/i
    ]);
    if (wait) f.waitingRate = '$' + wait + '/hr';

    /* Key instructions worth surfacing */
    var inst = [];
    if (/blind\s*bol/i.test(text)) inst.push('Blind BOL — send paperwork to broker for border clearing');
    if (/must\s+scale/i.test(text)) inst.push('Must scale full/empty at the same location');
    var dropT = text.match(/drop trailer for\s+([\d.]+)\s*days/i);
    if (dropT) inst.push('Drop trailer for ' + dropT[1] + ' days at receiver');
    var dock = text.match(/drop in dock\s+(\w+)/i);
    if (dock) inst.push('Drop in dock ' + dock[1]);
    if (/no later than|before (the )?time stated/i.test(text)) inst.push('Strict times — pickup/delivery no later than stated');
    var temp = text.match(/Low:?\s*(\d+)[\s\S]{0,16}?High:?\s*(\d+)/i);
    if (temp && /temp|degree/i.test(text)) inst.push('Keep between ' + temp[1] + '–' + temp[2] + '°F');
    if (inst.length) f.instructions = inst;

    var count = 0;
    ['orderNo', 'amount', 'pickupCompany', 'deliveryCompany', 'pickupDate',
     'equipment', 'material', 'qty', 'weight', 'waitingRate'].forEach(function (k) {
      if (f[k]) count++;
    });
    if (f.instructions) count++;
    f._confidence = count;
    f._raw = text;
    return f;
  };

  /* What the reader found / missed, for the UI read-report line.
     Found entries carry values; missing entries are plain field names. */
  TicketOCR.describeRead = function (parsed, form) {
    form = form || TicketOCR.toDispatchForm(parsed);
    var found = [], missing = [];
    function add(ok, foundLabel, missingLabel) {
      if (ok) found.push(foundLabel); else missing.push(missingLabel);
    }
    if (parsed._type === 'rate_confirmation' || parsed._type === 'bill_of_lading' || parsed._type === 'document') {
      add(!!form.amount, 'amount $' + (form.amount ? Number(form.amount).toLocaleString('en-US') : ''), 'amount');
      add(!!parsed.pickupCompany, 'pickup ' + parsed.pickupCompany + (parsed.pickupCity ? ' (' + parsed.pickupCity + ')' : ''), 'pickup');
      add(!!parsed.deliveryCompany, 'delivery ' + parsed.deliveryCompany + (parsed.deliveryCity ? ' (' + parsed.deliveryCity + ')' : ''), 'delivery');
      add(!!parsed.pickupDate, 'pickup ' + parsed.pickupDate + (parsed.pickupTime ? ' ' + (parsed.pickupQualifier ? parsed.pickupQualifier + ' ' : '') + parsed.pickupTime : ''), 'pickup date/time');
      add(!!(parsed.deliveryDate || parsed.deliveryNote), 'delivery ' + (parsed.deliveryDate || parsed.deliveryNote), 'delivery date/time');
      add(!!parsed.equipment, 'truck ' + parsed.equipment, 'truck type');
      add(!!parsed.material, 'material ' + parsed.material, 'material');
      add(!!(parsed.qty || parsed.weight), (parsed.qty ? 'qty ' + parsed.qty : '') + (parsed.qty && parsed.weight ? ' · ' : '') + (parsed.weight ? 'weight ' + parsed.weight : ''), 'qty/weight');
      add(!!parsed.waitingRate, 'waiting ' + parsed.waitingRate, 'waiting time');
      add(!!(parsed.instructions && parsed.instructions.length), 'instructions (' + (parsed.instructions ? parsed.instructions.length : 0) + ')', 'instructions');
    } else {
      add(!!form.jobSite, 'job site ' + form.jobSite, 'job site');
      add(!!form.scheduledAt, 'scheduled ' + form.scheduledAt, 'scheduled time');
      add(!!form.material, 'material ' + form.material, 'material');
      add(!!form.ticketNo, 'ticket #' + form.ticketNo, 'ticket #');
      add(!!form.notes, 'notes', 'notes');
    }
    return { found: found, missing: missing };
  };

  /* ---------- Auto-detect and parse ---------- */
  TicketOCR.parse = function (text) {
    var doc = TicketOCR.parseDocument(text);
    if (doc && doc._strong) return doc;

    /* v107: the haul-card gate uses the SAME tolerant detection
       parseHaulCard itself accepts — the strict single regex here
       let a garbled-header card ("BAILY TRUCK HAUL CARD") fall
       through to the confidence contest, where the dispatch parser
       won and hallucinated a job site out of the card's printed
       labels (Oct 16's "ONBNERREEEEARAL HH HHE"). A detected haul
       card goes to the haul-card parser, full stop. */
    var isHaulCard = /DAILY\s+TRUCK\s+HAUL\s+CARD/i.test(text) ||
      /(DAILY|BAILY|DAIL)\s+TRUCK\s+HAUL/i.test(text) ||
      (/\bTRUCK\s+HAUL\b/i.test(text) && /\bCARD\b/i.test(text)) ||
      (/\bHAUL\s+CARD\b/i.test(text) && /(AECON|ACLU|ABCON)/i.test(text));
    var isScale = /SCALE\s+TICKET/i.test(text) ||
                  (/Gross:/i.test(text) && /Tare:/i.test(text));
    var isDispatch = /([A-Z]\d+-[A-Z]\d+)/.test(text) &&
                     /(Tandem|Tridem|Go\s+Empty)/i.test(text);

    if (isHaulCard) return TicketOCR.parseHaulCard(text);
    if (isScale && !isDispatch) return TicketOCR.parseScaleTicket(text);
    if (isDispatch && !isScale) return TicketOCR.parseDispatch(text);

    // Ambiguous — try all, return the one with higher confidence
    var s = TicketOCR.parseScaleTicket(text);
    var d = TicketOCR.parseDispatch(text);
    var h = TicketOCR.parseHaulCard(text);
    var best = s;
    if (d._confidence > best._confidence) best = d;
    if (h._confidence > best._confidence) best = h;
    if (doc && doc._confidence > best._confidence) best = doc;
    return best;
  };

  /* ---------- Map parsed fields to dispatch form ---------- */
  TicketOCR.toDispatchForm = function (parsed) {
    var form = {};
    if (parsed._type === 'scale_ticket') {
      // Ticket number → ticket #
      if (parsed.ticketNo) form.ticketNo = parsed.ticketNo;
      // Customer or Job → job site
      if (parsed.customer) {
        // Clean up: "496010 AECON TRANSPORTATION WEST LTD - CAL" → "Aecon Transportation West"
        var c = parsed.customer.replace(/^\d+\s*/, '').replace(/\s*-\s*CAL\s*$/i, '').trim();
        form.jobSite = c || parsed.customer;
      } else if (parsed.job) {
        form.jobSite = 'Job ' + parsed.job;
      }
      // Product → material
      if (parsed.product) form.material = parsed.product;
      // Weight fields → stored on the dispatch for Pay-by-Weight revenue
      if (parsed.net) form.netWeight = parsed.net;
      if (parsed.gross) form.grossWeight = parsed.gross;
      if (parsed.tare) form.tareWeight = parsed.tare;
      if (parsed.receivedToday) form.receivedToday = parsed.receivedToday;
      // Weights + PO + vehicle → notes
      var notes = [];
      if (parsed.gross && parsed.net) {
        notes.push('Gross ' + parsed.gross + ' / Net ' + parsed.net + 't');
      }
      if (parsed.po) notes.push('PO ' + parsed.po);
      if (parsed.job) notes.push('Job ' + parsed.job);
      if (parsed.vehicleType) notes.push(parsed.vehicleType);
      if (parsed.date) notes.push(parsed.date);
      if (notes.length) form.notes = notes.join(' · ');
    } else if (parsed._type === 'rate_confirmation' || parsed._type === 'bill_of_lading' || parsed._type === 'document') {
      // v35: broker documents (rate con / BOL) — sweep results mapped to
      // the dispatch fields they can feed. Job site carries the route
      // (pickup → delivery); notes carry the key instructions only.
      if (parsed.amount) form.amount = parsed.amount;
      var route = '';
      if (parsed.pickupCompany) route = parsed.pickupCompany + (parsed.pickupCity ? ' (' + parsed.pickupCity + ')' : '');
      if (parsed.deliveryCompany) route += (route ? ' → ' : '') + parsed.deliveryCompany + (parsed.deliveryCity ? ' (' + parsed.deliveryCity + ')' : '');
      if (route) form.jobSite = route;
      if (parsed.pickupCompany) form.pickup = parsed.pickupCompany + (parsed.pickupCity ? ', ' + parsed.pickupCity : '');
      if (parsed.deliveryCompany) form.dropoff = parsed.deliveryCompany + (parsed.deliveryCity ? ', ' + parsed.deliveryCity : '');
      if (parsed.scheduledAt) form.scheduledAt = parsed.scheduledAt;
      if (parsed.pickupDate) {
        form.scheduledLabel = parsed.pickupDate + (parsed.pickupTime ? ' ' + (parsed.pickupQualifier ? parsed.pickupQualifier + ' ' : '') + parsed.pickupTime : '');
      }
      if (parsed.equipment) form.equipment = parsed.equipment;
      if (parsed.material) form.material = parsed.material;
      var dn = [];
      (parsed.instructions || []).forEach(function (s) { dn.push(s); });
      if (parsed.waitingRate) dn.push('Waiting ' + parsed.waitingRate);
      if (parsed.deliveryNote) dn.push('Delivery: ' + parsed.deliveryNote);
      if (parsed.orderNo) dn.push('Order ' + parsed.orderNo);
      if (parsed.qty) dn.push('Qty ' + parsed.qty);
      if (parsed.weight) dn.push('Weight ' + parsed.weight);
      if (dn.length) form.notes = dn.join(' · ');
    } else if (parsed._type === 'haul_card') {
      /* v107: the card's own facts map to the form like every other
         document's — the card number IS the ticket # (before v107
         it lived only on parsed.cardNumber, so the form's Ticket #
         sat empty beside a ticket chip that showed the number),
         and any start/finish/total-hours the read carried ride
         along for the form and the close confirm. */
      if (parsed.cardNumber) form.ticketNo = parsed.cardNumber;
      if (parsed.startTime) form.startTime = parsed.startTime;
      if (parsed.finishTime) form.finishTime = parsed.finishTime;
      if (parsed.totalHours) form.totalHours = parsed.totalHours;
    } else {
      // Dispatch screenshot — v31 fix: map each extracted field to its own
      // form field (previously time/equipment/coords were ALL dumped into
      // notes, e.g. "Tomorrow 8:00am · Tandem · 50°57'59.4"N…").
      if (parsed.site) form.jobSite = parsed.site;
      if (parsed.datetime) form.scheduledAt = parsed.datetime;   // → dispatch datetime field
      if (parsed.time) form.scheduledLabel = parsed.time;        // display string ("Tomorrow 8:00am")
      if (parsed.equipment) form.equipment = parsed.equipment;   // → truck type field
      if (parsed.lat !== undefined && parsed.lat !== null) form.lat = parsed.lat;
      if (parsed.lng !== undefined && parsed.lng !== null) form.lng = parsed.lng;
      if (parsed.coordinates) form.coordinates = parsed.coordinates; // DMS display string
      // Notes holds ONLY genuine free-text: the instruction + location code.
      var n = [];
      if (parsed.instructions && parsed.locationCode) {
        n.push(parsed.instructions + ' ' + parsed.locationCode);
      } else if (parsed.instructions) {
        n.push(parsed.instructions);
      } else if (parsed.locationCode) {
        n.push('Location ' + parsed.locationCode);
      }
      if (n.length) form.notes = n.join(' · ');
    }
    /* v107 gibberish gate (see TicketOCR.looksGibberish): a
       hallucinated free-text value never reaches the form — the
       field stays blank, describeRead lists it as not found, and
       the read escalates to Power Read. One choke point here
       covers every parser and every caller. */
    if (form.jobSite && TicketOCR.looksGibberish(form.jobSite)) delete form.jobSite;
    if (form.material && TicketOCR.looksGibberish(form.material)) delete form.material;
    return form;
  };
  /* ---------- Multi-ticket aggregation (v26) ----------
     Drivers can have MULTIPLE tickets per day (e.g., 2 haul cards).
     Total foreman hours = sum of each ticket's hours.
     Total paid hours = total foreman hours + travel bonus.
     Returns per-ticket breakdown for the manifest. */
  TicketOCR.summarizeTickets = function (tickets, travelBonus) {
    var tb = parseFloat(travelBonus) || 0;
    var totalHours = 0, totalWeight = 0;
    var breakdown = [];
    (tickets || []).forEach(function (t, i) {
      var hrs = parseFloat(t.foremanHours) || 0;
      var wt = parseFloat(t.netWeight) || 0;
      totalHours += hrs;
      totalWeight += wt;
      breakdown.push({
        index: i + 1,
        label: t.cardNumber ? 'Card #' + t.cardNumber :
               t.ticketNo ? 'Ticket #' + t.ticketNo : 'Ticket ' + (i + 1),
        type: t.ocrType || 'unknown',
        foremanHours: hrs || null,
        paymentUnit: t.paymentUnit || null,
        netWeight: wt || null
      });
    });
    return {
      ticketCount: (tickets || []).length,
      totalForemanHours: Math.round(totalHours * 100) / 100,
      travelBonus: tb,
      totalPaidHours: Math.round((totalHours + tb) * 100) / 100,
      totalNetWeight: Math.round(totalWeight * 100) / 100,
      breakdown: breakdown
    };
  };

  /* ---------- v39: shared OCR rendition ----------
     OCR needs resolution: a full-page document at the 640px storage size
     is unreadable. Build a larger rendition (max 1600px) purely for OCR;
     callers keep/store their own smaller copy. (Dispatch has used this
     recipe since v35; it lives here now so Fuel and future modules share
     one implementation instead of growing private copies.) */
  TicketOCR.fileToOCRImage = function (file, cb) {
    var r = new FileReader();
    r.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1600, w = img.width, h = img.height;
        if (w > max || h > max) {
          var s = Math.min(max / w, max / h);
          w = Math.round(w * s); h = Math.round(h * s);
        }
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { cb(null); };
      img.src = r.result;
    };
    r.onerror = function () { cb(null); };
    r.readAsDataURL(file);
  };

  /* ---------- v39: FUEL RECEIPT parser ----------
     Pump receipts (Mobil / Petro-Canada / Shell …) print the sale as a
     column row — litres × price/L = line total — plus a TOTAL line, the
     station brand in the header, and the date. Extract: litres, total
     cost, price per litre, station, date. The column triple is only
     trusted when its own arithmetic checks out (litres × price ≈ total),
     which also makes it immune to random number triples elsewhere. */
  TicketOCR.parseFuelReceipt = function (text) {
    var f = { _type: 'fuel_receipt' };
    var t = String(text || '');
    function num(s) { return parseFloat(String(s).replace(/,/g, '')); }
    function clean(n, dp) {
      if (!isFinite(n)) return null;
      return String(Math.round(n * Math.pow(10, dp)) / Math.pow(10, dp));
    }

    /* Column triple: "83.965 (L)  2.279 ($/L)  191.36 ($)" — the unit
       markers may sit between the numbers or be absent entirely. */
    var trip = null;
    var tm = t.match(/([\d,]+\.\d{3})\s*(?:\(L\))?\s*\$?\s*([\d,]+\.\d{3})\s*(?:\(\$\/L\))?\s*\$?\s*([\d,]+\.\d{2})\b/);
    if (tm) {
      var tL = num(tm[1]), tP = num(tm[2]), tC = num(tm[3]);
      if (tL > 0 && tP > 0.3 && tP < 6 && Math.abs(tL * tP - tC) <= 0.06 + tC * 0.01) {
        trip = { litres: tL, price: tP, total: tC };
      }
    }
    /* v80: LOOSE verified triple. Pump receipts also print the sale
       as a labelled column — "78.175 L / PRICE/L 2.479 / AMOUNT
       $193.80" — where words sit BETWEEN the numbers and the strict
       pattern above can never match (Oct 15: a real Mobil receipt
       in exactly this shape landed nothing). Scan the decimal tokens
       in reading order and test consecutive windows of three —
       litres-shaped (3 decimals, 5–2000), price-shaped (3 decimals,
       0.3–6), total-shaped (2 decimals) — trusting only a window
       whose own arithmetic checks out, the same immunity the strict
       triple has. A token like an invoice number (no decimals)
       never enters the scan. */
    if (!trip) {
      var toks = [], tkm, tokRe = /([\d,]+\.\d{1,4})/g;
      while ((tkm = tokRe.exec(t)) !== null) {
        var raw = tkm[1].replace(/,/g, '');
        var dp = (raw.split('.')[1] || '').length;
        toks.push({ v: parseFloat(raw), dp: dp });
      }
      for (var ti = 0; ti + 2 < toks.length && !trip; ti++) {
        var A = toks[ti], B = toks[ti + 1], C = toks[ti + 2];
        if (A.dp === 3 && A.v >= 5 && A.v <= 2000 &&
            B.dp === 3 && B.v > 0.3 && B.v < 6 &&
            C.dp === 2 && Math.abs(A.v * B.v - C.v) <= 0.06 + C.v * 0.01) {
          trip = { litres: A.v, price: B.v, total: C.v };
        }
      }
    }

    /* Total cost — the TOTAL line wins; \b keeps SUBTOTAL out.
       v80: the patterns run FIRST over the text with GST/HST lines
       removed — these pump receipts print "GST INCLUDED IN TOTAL
       $9.23", and the bare TOTAL pattern would otherwise take the
       TAX as the total whenever the real total line is garbled or
       missing (the Oct 15 failure, second act). The last patterns
       tolerate an OCR-garbled TOTAL (T0TAL, TOTA1) and a missing $. */
    var tNoTax = t.split('\n').filter(function (l) { return !/GST|HST/i.test(l); }).join('\n');
    var COST_PATTERNS = [
      /\bTOTAL\b[\s:]*CAD\s*\$\s*([\d,]+\.\d{2})/i,
      /\bTOTAL\b[\s:]*CAD\s*([\d,]+\.\d{2})/i,
      /\bTOTAL\b[\s:]*\$\s*([\d,]+\.\d{2})/i,
      /\bTOTAL\b[\s:]+\$?\s*([\d,]+\.\d{2})/i,
      /\bPURCHASE\b[\s:]*\$\s*([\d,]+\.\d{2})/i,
      /\bAMOUNT\s+DUE\b[\s:]*\$?\s*([\d,]+\.\d{2})/i,
      /\bAMOUNT\b[\s:]*\$\s*([\d,]+\.\d{2})/i,
      /\bT[O0]TA[L1]\b[\s:]*\$?\s*([\d,]+\.\d{2})/i
    ];
    var cost = firstMatch(tNoTax, COST_PATTERNS);
    if (!cost) {
      /* Second pass for a genuine total line that mentions the tax
         ("TOTAL (INCL. GST) $193.80"): only lines that START with
         the TOTAL label qualify — a "GST INCLUDED IN TOTAL 9.23"
         line starts with GST and stays excluded. */
      var leadLines = t.split('\n').filter(function (l) { return /^\s*T[O0]TA[L1]\b/i.test(l); }).join('\n');
      cost = firstMatch(leadLines, COST_PATTERNS);
    }
    if (cost) f.cost = clean(num(cost), 2);
    else if (trip) f.cost = clean(trip.total, 2);

    /* Litres — labeled first, then the verified column triple, then
       "45.2 L @ 1.939" and "83.965 L" shapes. v80: the label may sit
       on the line ABOVE its number (labelled-column receipts), so a
       second pattern lets the value follow the label across a line
       break (up to 20 non-digit characters). */
    var lit = firstMatch(t, [
      /(?:LITRES|LITERS|VOLUME|QTY|QUANTITY)[\s:]*([\d,]+\.\d{1,3})/i,
      /(?:LITRES|LITERS|VOLUME)\D{0,20}?([\d,]+\.\d{1,3})\b/i
    ]);
    if (lit) f.litres = clean(num(lit), 3);
    else if (trip) f.litres = clean(trip.litres, 3);
    else {
      var at = t.match(/([\d,]+\.\d{1,3})\s*L\s*@\s*\$?\s*([\d,]+\.\d{3})/i) ||
               t.match(/([\d,]+\.\d{3,4})\s*(?:AT|@)\s*\$?\s*([\d,]+\.\d{3})\s*\/\s*L/i);
      if (at) {
        f.litres = clean(num(at[1]), 3); f.pricePerLitre = clean(num(at[2]), 3);
        // The pair is printed together ("103.805 AT $2.348/L"), so when
        // the TOTAL line itself didn't survive OCR, litres x price is
        // the total within the printed price's rounding.
        if (!f.cost) f.cost = clean(num(at[1]) * num(at[2]), 2);
      }
      else {
        var lu = t.match(/([\d,]+\.\d{2,3})\s*(?:LITRES|LITERS)\b/i) || t.match(/([\d,]+\.\d{3})\s*L\b/i);
        if (lu) f.litres = clean(num(lu[1]), 3);
      }
    }

    /* Price per litre — from the triple or an explicit $/L figure.
       v80: the label-reach pattern covers "PRICE/L\n2.479" layouts. */
    if (!f.pricePerLitre) {
      if (trip) f.pricePerLitre = clean(trip.price, 3);
      else {
        var pp = firstMatch(t, [
          /\$\s*([\d,]+\.\d{3})\s*\/\s*L\b/i,
          /([\d,]+\.\d{3})\s*\(\$\/L\)/i,
          /\bPRICE\s*\/\s*L\b[\s:]*\$?\s*([\d,]+\.\d{3})/i,
          /\bPRICE\b[\s:]*\$?\s*([\d,]+\.\d{3})/i,
          /\bPRICE(?:\s*\/\s*L)?\b\D{0,20}?([\d,]+\.\d{3})\b/i
        ]);
        if (pp) { var pv = num(pp); if (pv > 0.3 && pv < 6) f.pricePerLitre = clean(pv, 3); }
      }
    }

    /* v80: cost derivation for EVERY path — when the total line
       itself didn't survive OCR but litres and the per-litre price
       both did, their product IS the total within the printed
       price's rounding (the `at` path has always trusted this; the
       labelled paths now get it too). 78.175 × 2.479 = 193.80. */
    if (!f.cost && f.litres && f.pricePerLitre) {
      f.cost = clean(num(f.litres) * num(f.pricePerLitre), 2);
    }

    /* Station — brand in the header (first lines win over body text). */
    var BRANDS = [
      ['Petro-Pass', /petro[\s\-–]?pass/i],
      ['Petro-Canada', /petro[\s\-–]?canada/i],
      ['Mobil', /\bmobil\b|\bmobile\b/i],
      ['Shell', /\bshell\b/i],
      ['Esso', /\besso\b/i],
      ['Husky', /\bhusky\b/i],
      ['Co-op', /\bco[\s\-]?op\b/i],
      ['Canadian Tire', /canadian\s+tire/i],
      ['Costco', /\bcostco\b/i],
      ['Fas Gas', /fas\s*gas/i],
      ['Domo', /\bdomo\b/i],
      ['Centex', /\bcentex\b/i],
      ['Ultramar', /\bultramar\b/i],
      ['Irving', /\birving\b/i],
      ['Circle K', /circle\s*k\b/i],
      ['7-Eleven', /7[\s\-]?eleven/i],
      ['Safeway', /\bsafeway\b/i],
      ['Superstore', /\bsuperstore\b/i]
    ];
    var head = t.split('\n').slice(0, 10).join('\n');
    for (var bi = 0; bi < BRANDS.length && !f.station; bi++) {
      if (BRANDS[bi][1].test(head) || BRANDS[bi][1].test(t)) f.station = BRANDS[bi][0];
    }
    /* v85: the station NUMBER when the header carries one — "Mobil
       @ 1742 Gas Stn" / "Mobil @ 1739 Gas Stn" are DIFFERENT
       stations in the owner's records (Westwinds vs Heritage
       Meadows), and a bare brand merges them. */
    if (f.station) {
      var brandEsc = f.station.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      /* v90 (soak Pass 21): the number search ran over the head lines
         only, while the brand itself is found over the whole text —
         a header pushed past line 10 by OCR line-splitting kept its
         brand but lost its number, merging two different stations
         in the records. Head still wins when it carries a number;
         the full text is the fallback. */
      var snm = head.match(new RegExp(brandEsc + '\\s*@\\s*(\\d{3,5})', 'i')) ||
                t.match(new RegExp(brandEsc + '\\s*@\\s*(\\d{3,5})', 'i'));
      if (snm) f.station = f.station + ' @ ' + snm[1];
    }

    /* Date — ISO as printed, else the DATE: label via normDate, else any
       date normDate can find in the text. */
    var iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso) f.date = iso[1];
    else {
      var draw = firstMatch(t, [/DATE[\s:]*([A-Za-z0-9\/\- ]{6,14})/i]);
      f.date = normDate(draw) || normDate(t);
    }
    /* v85: the transaction TIME (the form lands date/time in one
       pass). First clock-shaped token wins — receipts print the
       sale time once, beside the date; prices have no colon, so
       they can never match. Stored 24h 'HH:MM'. */
    var tmm = t.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*([aApP][mM])?\b/);
    if (tmm) {
      var th = parseInt(tmm[1], 10), tmin = parseInt(tmm[2], 10);
      if (tmm[3]) { th = th % 12; if (/p/i.test(tmm[3])) th += 12; }
      if (th >= 0 && th <= 23 && tmin >= 0 && tmin <= 59) {
        f.time = ('0' + th).slice(-2) + ':' + ('0' + tmin).slice(-2);
      }
    }

    var count = 0;
    ['litres', 'cost', 'station', 'date'].forEach(function (k) { if (f[k]) count++; });
    f._confidence = count;
    f._raw = text;
    return f;
  };

  /* What the fuel reader found / missed, for the Fuel form read line.
     Found entries carry values in display form; missing are field names.
     Price per litre has no form field — reported when found, never as
     "missing". */
  TicketOCR.describeFuelRead = function (parsed) {
    var found = [], missing = [];
    function add(ok, foundLabel, missingLabel) {
      if (ok) found.push(foundLabel); else missing.push(missingLabel);
    }
    add(!!parsed.litres, parsed.litres ? parsed.litres + ' L' : '', 'litres');
    add(!!parsed.cost, parsed.cost ? '$' + parsed.cost : '', 'cost');
    add(!!parsed.station, parsed.station || '', 'station');
    add(!!parsed.date, parsed.date || '', 'date');
    /* v85: the sale time rides the read line (display form) — it is
       shown for his check and saved on the record, never a form
       field he has to babysit. */
    if (parsed.time) {
      var tp = parsed.time.split(':');
      var th2 = parseInt(tp[0], 10);
      var tap = th2 >= 12 ? 'PM' : 'AM';
      found.push(((th2 % 12) || 12) + ':' + tp[1] + ' ' + tap);
    }
    if (parsed.pricePerLitre) found.push('@ ' + parsed.pricePerLitre + '/L');
    return { found: found, missing: missing };
  };

  /* ---------- v42: EXPENSE RECEIPT parser ----------
     Generic store/service receipts (parts stores, restaurants, phone
     bills, permit offices…) for the expense forms: Fuel → "Other
     expenses" and P&L → "Business expense". Extract: total, date,
     vendor, and a category hint (one of the P&L BIZ_CATS labels, only
     on an obvious keyword).

     The total is anchored on TOTAL / AMOUNT DUE / BALANCE DUE lines.
     Tax and subtotal lines are never the total: "GST included in
     total $9.11" must not win over the real "TOTAL $191.36", and an
     HST line is an amount ON THE WAY to the total, not the total.
     When a subtotal and tax lines are both printed, an anchored value
     that satisfies subtotal + tax ≈ total is trusted first; otherwise
     the largest anchored value that is at least the subtotal wins. */
  TicketOCR.parseExpenseReceipt = function (text) {
    var f = { _type: 'expense_receipt' };
    var t = String(text || '');
    function num(s) { return parseFloat(String(s).replace(/,/g, '')); }
    function clean2(n) { return isFinite(n) && n > 0 ? n.toFixed(2) : null; }
    var lines = t.split('\n');

    /* Money printed on a line: "$12.34" preferred, else a trailing
       bare "12.34" (many receipts right-align amounts without $). */
    function moneyOf(line) {
      var m = line.match(/\$\s*([\d,]+\.\d{2})/) ||
              line.match(/\b([\d,]+\.\d{2})\s*(?:CAD)?\s*$/i);
      return m ? num(m[1]) : null;
    }
    var TAXWORD = /\b(GST|HST|PST|QST|TAX)\b/i;
    var STRONGTOTAL = /GRAND\s+TOTAL|TOTAL\s+DUE|AMOUNT\s+DUE|BALANCE\s+DUE|TOTAL\s+CAD|TOTAL\s+SALE|^\s*TOTAL\b/i;
    var totalCands = [], bareMoney = [], subtotal = null, taxSum = 0, sawTax = false;
    lines.forEach(function (ln) {
      var v = moneyOf(ln);
      if (v === null) return;
      if (/SUB\s*TOTAL/i.test(ln)) { subtotal = v; return; }
      if (/CHANGE|TENDERED|CASH\s*TENDER/i.test(ln)) return;
      if (STRONGTOTAL.test(ln)) { totalCands.push(v); return; }
      if (TAXWORD.test(ln)) { taxSum += v; sawTax = true; return; }
      if (/\bTOTAL\b/i.test(ln)) { totalCands.push(v); return; }
      bareMoney.push(v);
    });
    var expected = (subtotal !== null && sawTax) ? subtotal + taxSum : null;
    var total = null, i, c;
    if (expected !== null) {
      for (i = 0; i < totalCands.length; i++) {
        c = totalCands[i];
        if (Math.abs(c - expected) <= 0.06 + c * 0.01) { total = c; break; }
      }
    }
    if (total === null && totalCands.length) {
      var pool = totalCands;
      if (subtotal !== null) {
        var ge = totalCands.filter(function (v) { return v >= subtotal; });
        if (ge.length) pool = ge;
      }
      total = Math.max.apply(null, pool);
    }
    if (total === null && expected !== null) {
      for (i = 0; i < bareMoney.length; i++) {
        if (Math.abs(bareMoney[i] - expected) <= 0.06 + bareMoney[i] * 0.01) { total = bareMoney[i]; break; }
      }
    }
    if (total === null && bareMoney.length) total = Math.max.apply(null, bareMoney);
    if (total !== null) f.total = clean2(total);

    /* Date — ISO as printed, YYYY/MM/DD, else normDate (label first,
       then anywhere in the text), same strategy as the fuel parser. */
    var iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso) f.date = iso[1];
    else {
      var ymd = t.match(/\b(\d{4})\/(\d{1,2})\/(\d{1,2})\b/);
      if (ymd) {
        var yi = isoDate(parseInt(ymd[1], 10), parseInt(ymd[2], 10), parseInt(ymd[3], 10));
        if (yi) f.date = yi;
      }
      if (!f.date) {
        var draw = firstMatch(t, [/DATE[\s:]*([A-Za-z0-9\/\- ]{6,14})/i]);
        var nd = normDate(draw) || normDate(t);
        if (nd) f.date = nd;
      }
    }

    /* Vendor — known brands first (header lines win, like the fuel
       parser), then the first name-like line near the top. */
    var VENDORS = [
      ['NAPA Auto Parts', /\bnapa\b/i],
      ['Princess Auto', /princess\s*auto/i],
      ['Canadian Tire', /canadian\s*tire/i],
      ['PartSource', /\bpartsource\b/i],
      ['Bumper to Bumper', /bumper\s*to\s*bumper/i],
      ['Kal Tire', /kal\s*tire/i],
      ['Fountain Tire', /fountain\s*tire/i],
      ['OK Tire', /\bok\s*tire\b/i],
      ['Mr. Lube', /mr\.?\s*lube/i],
      ['Jiffy Lube', /jiffy\s*lube/i],
      ['Midas', /\bmidas\b/i],
      ['Walmart', /wal\s*-?\s*mart/i],
      ['Costco', /\bcostco\b/i],
      ['Home Depot', /home\s*depot/i],
      ['RONA', /\brona\b/i],
      ["Lowe's", /lowe'?s\b/i],
      ['Staples', /\bstaples\b/i],
      ['Tim Hortons', /tim\s*hortons/i],
      ["McDonald's", /mcdonald/i],
      ['Subway', /\bsubway\b/i],
      ['Starbucks', /starbucks/i],
      ['TELUS', /\btelus\b/i],
      ['Rogers', /\brogers\b/i],
      ['Koodo', /\bkoodo\b/i],
      ['Mobil', /\bmobil\b|\bmobile\b/i],
      ['Shell', /\bshell\b/i],
      ['Esso', /\besso\b/i],
      ['Petro-Canada', /petro[\s\-–]?canada/i],
      ['Husky', /\bhusky\b/i],
      ['Co-op', /\bco[\s\-]?op\b/i]
    ];
    var head8 = lines.slice(0, 8).join('\n');
    for (var vi = 0; vi < VENDORS.length && !f.vendor; vi++) {
      if (VENDORS[vi][1].test(head8) || VENDORS[vi][1].test(t)) f.vendor = VENDORS[vi][0];
    }
    if (!f.vendor) {
      for (var li = 0; li < Math.min(6, lines.length) && !f.vendor; li++) {
        var ln = lines[li].replace(/\s+/g, ' ').trim();
        if (ln.length < 3 || ln.length > 48) continue;
        if (!/[A-Za-z]{2,}/.test(ln)) continue;
        if (/^\d/.test(ln)) continue;                       // street address
        if (/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/.test(ln)) continue; // phone
        if (/receipt|invoice|welcome|thank|cashier|server|order\s|gst|hst|www\.|@|tel\b|phone|fax/i.test(ln)) continue;
        // OCR-garble guard: on a real vendor line most letters live in
        // real words (3+ letters); symbol soup is fragments and singles.
        var words = ln.match(/[A-Za-z]{2,}/g) || [];
        if (!words.some(function (w) { return w.length >= 4; })) continue;
        var lettersTotal = (ln.match(/[A-Za-z]/g) || []).length;
        var lettersInWords = words.reduce(function (a, w) { return a + (w.length >= 3 ? w.length : 0); }, 0);
        if (!lettersTotal || lettersInWords / lettersTotal < 0.5) continue;
        var singles = (ln.match(/\b[A-Za-z]\b/g) || []).length;
        if (singles >= 3 && singles * 2 > words.length + singles) continue;
        if (normDate(ln) && ln.length < 22) continue;       // a bare date line
        ln = ln.replace(/\s+(#\d+|store\s*\d+)$/i, '');
        var cc = cleanCompany(ln);
        if (cc) f.vendor = cc;
      }
    }

    /* Category hint — ONLY an obvious keyword, mapped to the P&L
       module's own category labels (BIZ_CATS in modules/pnl.js).
       Anything less obvious is left for the user to pick. */
    if (/kal\s*tire|fountain\s*tire|ok\s*tire|\b(tire|tyre|tires|tyres)\b/i.test(t)) f.category = 'Tires';
    else if (/\binsurance\b/i.test(t)) f.category = 'Insurance';
    else if (/\b(telus|rogers|koodo|fido|freedom\s*mobile|virgin\s*mobile|bell\s*mobility)\b/i.test(t)) f.category = 'Phone';
    else if (/\b(permit|licen[cs]e|registration|plate\s*renewal|\birp\b)\b/i.test(t)) f.category = 'Permits & Licenses';
    else if (/\bnapa\b|princess\s*auto|\bpartsource\b|bumper\s*to\s*bumper|mr\.?\s*lube|jiffy\s*lube|\bmidas\b|oil\s*change|auto\s*parts|\brepair\b/i.test(t)) f.category = 'Maintenance';

    var count = 0;
    ['total', 'vendor', 'date'].forEach(function (k) { if (f[k]) count++; });
    f._confidence = count;
    f._raw = text;
    return f;
  };

  /* What the expense reader found / missed, for the expense forms'
     read line. Category is a bonus — reported when found, never
     listed as "missing" (it is the user's call by default). */
  TicketOCR.describeExpenseRead = function (parsed) {
    var found = [], missing = [];
    function add(ok, foundLabel, missingLabel) {
      if (ok) found.push(foundLabel); else missing.push(missingLabel);
    }
    add(!!parsed.total, parsed.total ? '$' + parsed.total : '', 'cost');
    add(!!parsed.vendor, parsed.vendor || '', 'store');
    add(!!parsed.date, parsed.date || '', 'date');
    if (parsed.category) found.push(parsed.category);
    return { found: found, missing: missing };
  };

  /* ---------- v51: SERVICE STICKER parser ----------
     Windshield "NEXT SERVICE DUE" stickers (printed shop stickers with
     a handwritten or printed due date + odometer). Extract:
       odo  — next-service odometer (string of digits, e.g. '175429')
       date — next-service date, ISO 'YYYY-MM-DD'
     These stickers are usually HANDWRITTEN, and this app's own testing
     (haul card, Oct 13 2026) proved Tesseract reads handwriting poorly.
     So the parser is deliberately conservative — anchored, validated
     candidates only — and the caller NEVER auto-saves: the values
     prefill the Maintenance next-service fields and the driver checks
     them before tapping Save.

     Traps handled:
     - "10W30" (oil grade): short digit runs split by a letter — never a
       5-7 digit odometer, never a date.
     - Years (2026) and phone numbers (403-555-0182, dashed; spaced
       1-800 numbers): length/group rules keep them out of the odo pick.
     - Month names with OCR noise ("5ept", "Sepf", "0ct"): a fuzzy
       month resolver (digit-confusion fixes + abbrev prefixes +
       one-edit matches). */

  /* Fuzzy month token -> 1..12 or null. Accepts full names, 3-4 letter
     abbreviations ("sep", "sept"), and common OCR confusions. */
  function fuzzyMonth(tok) {
    if (!tok) return null;
    var s = String(tok).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!s) return null;
    var NAMES = ['january', 'february', 'march', 'april', 'may', 'june',
                 'july', 'august', 'september', 'october', 'november', 'december'];
    function fromName(w) {
      for (var i = 0; i < NAMES.length; i++) {
        if (NAMES[i] === w || NAMES[i].slice(0, 3) === w ||
            (w.length >= 4 && NAMES[i].indexOf(w) === 0)) return i + 1;
      }
      return null;
    }
    var m = fromName(s);
    if (m) return m;
    // OCR digit confusions inside a month word: 5ept, 0ct, 1an…
    var fixed = s.replace(/0/g, 'o').replace(/1/g, 'l').replace(/5/g, 's').replace(/8/g, 'b');
    m = fromName(fixed);
    if (m) return m;
    // One-edit distance from a 3-letter abbreviation (Sepf -> Sep)
    var abbr = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    for (var j = 0; j < abbr.length; j++) {
      var a = abbr[j], b = fixed.slice(0, 3);
      if (b.length === 3) {
        var diff = 0;
        for (var k = 0; k < 3; k++) if (a[k] !== b[k]) diff++;
        if (diff <= 1) return j + 1;
      }
    }
    return null;
  }

  /* Numeric date with slash (or dash) separators. North-American
     M/D/Y is the house convention (see normDate), but when the first
     component can't be a month (> 12) it must be the day: D/M/Y —
     e.g. the owner's "28/09/26". */
  function stickerSlashDate(a, b, y) {
    a = parseInt(a, 10); b = parseInt(b, 10); y = parseInt(y, 10);
    if (y < 100) y += 2000;
    if (a > 12 && b >= 1 && b <= 12) return isoDate(y, b, a); // D/M/Y
    return isoDate(y, a, b);                                   // M/D/Y
  }

  TicketOCR.parseServiceSticker = function (text) {
    var f = { _type: 'service_sticker' };
    var t = String(text || '');
    f._confidence = 0;
    f._raw = text;

    /* Gate: only read text that looks like a service sticker at all.
       An unrelated document (a fuel or store receipt) must yield
       NOTHING here — not even a stray date off its header. Real
       stickers always carry SERVICE / NEXT / DUE / OIL CHANGE wording
       (OCR-tolerant on the S in SERVICE). */
    if (!/SERV[IL1]CE|NEXT|DUE|OIL\s*CHANGE/i.test(t)) return f;

    /* ----- Date ----- */
    // Prefer the text from the DATE/DUE label onward (stickers put the
    // value right after the label); fall back to the whole text.
    var li = t.search(/NEXT|DUE|DATE/i);
    var zones = li >= 0 ? [t.slice(li), t] : [t];
    var date = null, zi, m;
    for (zi = 0; zi < zones.length && !date; zi++) {
      var z = zones[zi];
      // "28 Sept 2026" / "28-Sep-26" (day, month name, year)
      m = z.match(/(\d{1,2})\s*[-\s]\s*([A-Za-z0-9]{3,9})\s*[-\s,]\s*(\d{2,4})(?!\d)/);
      if (m) {
        var mo1 = fuzzyMonth(m[2]);
        var y1 = parseInt(m[3], 10); if (y1 < 100) y1 += 2000;
        if (mo1 && y1 >= 2015 && y1 <= 2040) date = isoDate(y1, mo1, parseInt(m[1], 10));
      }
      // "Sept 28, 2026" (month name, day, year)
      if (!date) {
        m = z.match(/([A-Za-z0-9]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s+(\d{2,4})(?!\d)/);
        if (m) {
          var mo2 = fuzzyMonth(m[1]);
          var y2 = parseInt(m[3], 10); if (y2 < 100) y2 += 2000;
          if (mo2 && y2 >= 2015 && y2 <= 2040) date = isoDate(y2, mo2, parseInt(m[2], 10));
        }
      }
      // ISO "2026-09-28"
      if (!date) {
        m = z.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
        if (m) date = isoDate(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
      }
      // Slash date "03/15/2027" or "28/09/26"
      if (!date) {
        m = z.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
        if (m) date = stickerSlashDate(m[1], m[2], m[3]);
      }
    }
    if (date) f.date = date;

    /* ----- Odometer ----- */
    // Candidates: digit runs with at most ONE internal separator group
    // ("175429", "175 429", "175,429", "182,000"). Runs with more
    // groups (spaced phone numbers, account numbers) are rejected, as
    // are runs under 5 or over 7 digits once cleaned (years, "10W30"
    // fragments, and litre/price figures never qualify).
    var cands = [];
    var re = /(\d{1,3}(?:[,\s]\d{3})|\d{4,7})/g, cm;
    while ((cm = re.exec(t)) !== null) {
      var raw = cm[1];
      var digits = raw.replace(/[,\s]/g, '');
      if (digits.length < 5 || digits.length > 7) continue;
      var val = parseInt(digits, 10);
      if (!(val >= 10000 && val <= 1999999)) continue;
      cands.push({ raw: raw, val: val, idx: cm.index });
    }
    if (cands.length) {
      // Anchored wins: a candidate within ~24 chars after (or ~8 chars
      // before) a MILES/KM/ODOMETER label is the sticker's due reading.
      var anchors = [], am;
      var are = /(MILES|MILEAGE|KILOMET(?:ER|RE)S?|KMS?|ODOMETER|ODO)\b/gi;
      while ((am = are.exec(t)) !== null) anchors.push({ idx: am.index, end: am.index + am[0].length });
      var best = null, bestScore = -1;
      cands.forEach(function (c) {
        var score = c.val; // fallback: largest plausible reading wins
        anchors.forEach(function (a) {
          var gap = c.idx >= a.end ? c.idx - a.end : (a.idx - (c.idx + c.raw.length));
          if (gap >= -2 && gap <= 24) score += 10000000 - gap * 1000;
        });
        if (score > bestScore) { bestScore = score; best = c; }
      });
      f.odo = String(best.val);
    }

    var count = 0;
    if (f.odo) count++;
    if (f.date) count++;
    f._confidence = count;
    f._raw = text;
    return f;
  };

  /* What the sticker reader found / missed, for the Maintenance
     next-service read line (same contract as describeFuelRead). */
  TicketOCR.describeStickerRead = function (parsed) {
    var found = [], missing = [];
    if (parsed.odo) found.push('next service ' + Number(parsed.odo).toLocaleString('en-US') + ' km');
    else missing.push('odometer');
    if (parsed.date) found.push('due date ' + parsed.date);
    else missing.push('date');
    return { found: found, missing: missing };
  };

  /* ================= v58: candidate hunt (Round 2, Lane B) ================
     Proven on the bench (tools/round2-miner.js + results-round2.json):
     pooling MANY OCR reads of the same photo (different preprocessing /
     engine settings) and mining the pooled text for validated numeric
     candidates recovers values no single read gets — odometer exact
     top-1 on 2/8 corpus photos and top-4 on 3/8 (single-read baseline
     0/8); service-sticker miles AND date top-1 on the legible sample.
     The hunt NEVER auto-accepts: it only produces ranked candidates
     that the UI offers as tap-to-pick chips. The user taps, or types.
     (Measured honestly: on the owner's own dash and sticker photos the
     hunt found no candidates — chips simply don't appear there.) */

  var _R2_CONFUSE = { O: '0', o: '0', Q: '0', l: '1', I: '1', i: '1', '|': '1', Z: '2', z: '2', S: '5', s: '5', G: '6', B: '8', q: '9', A: '4' };
  function _r2digitizeToken(tok) {
    var t = String(tok || '').replace(/^[^0-9A-Za-z]+/, '').replace(/[^0-9A-Za-z]+$/, '');
    if (t.length < 3) return null;
    var out = '', digits = 0;
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (c >= '0' && c <= '9') { out += c; digits++; }
      else if (c === ',' || c === '.' || c === ' ') { out += c; }
      else if (_R2_CONFUSE[c]) { out += _R2_CONFUSE[c]; }
      else return null;
    }
    if (digits < 2) return null;
    return out;
  }
  function _r2extractDigitRuns(text) {
    var out = [];
    var lines = String(text || '').split(/\r?\n/);
    lines.forEach(function (line) {
      var m, re;
      var glued = line.replace(/(\d)[ \t]+(?=\d)/g, '$1').replace(/(\d),[ \t]+(?=\d)/g, '$1,');
      re = /(\d[\d,]*\d|\d)/g;
      while ((m = re.exec(glued)) !== null) {
        var raw = m[1];
        var dec = false;
        var dm = raw.match(/^([\d,]+)\.(\d)$/);
        var digits = raw.replace(/,/g, '');
        if (dm && digits.replace('.', '').length >= 5) { digits = dm[1].replace(/,/g, ''); dec = true; }
        else digits = digits.replace(/\./g, '');
        if (digits.length >= 4 && digits.length <= 8) out.push({ digits: digits, repaired: false, decimal: dec });
      }
      var toks = line.split(/\s+/);
      var digToks = toks.map(_r2digitizeToken);
      digToks.forEach(function (dt) {
        if (!dt) return;
        var d = dt.replace(/[,.]/g, '');
        if (d.length >= 4 && d.length <= 8) out.push({ digits: d, repaired: true, decimal: /\.\d$/.test(dt) });
      });
      for (var i = 0; i + 1 < digToks.length; i++) {
        if (!digToks[i] || !digToks[i + 1]) continue;
        var a = digToks[i].replace(/[,.]/g, ''), b = digToks[i + 1].replace(/[,.]/g, '');
        var j = a + b;
        if (j.length >= 5 && j.length <= 7 && a.length >= 2 && b.length >= 2) out.push({ digits: j, repaired: true, decimal: false });
      }
    });
    return out;
  }
  function _r2rankOdo(texts, parseOdo) {
    var byVal = {};
    texts.forEach(function (src) {
      var runs = _r2extractDigitRuns(src.text);
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
      if (parseOdo) {
        try {
          var pv = parseOdo(src.text);
          if (pv && byVal[String(parseInt(pv, 10))]) byVal[String(parseInt(pv, 10))].score += 3;
        } catch (e) {}
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
  function _r2rankStickerMiles(texts, master, parseSticker) {
    var byVal = {};
    texts.forEach(function (src) {
      var runs = _r2extractDigitRuns(src.text);
      var seenHere = {};
      runs.forEach(function (r) {
        var v = parseInt(r.digits, 10);
        if (!(v >= 10000 && v <= 1999999)) return;
        if (r.digits.length < 5 || r.digits.length > 7) return;
        var key = String(v);
        var c = byVal[key] || (byVal[key] = { value: v, digits: String(v), score: 0, sources: 0 });
        if (!seenHere[key]) { c.sources++; c.score += 2; seenHere[key] = 1; }
      });
      var t = String(src.text || '');
      var am = t.search(/MILES|MILEAGE|KILOMET|KMS?\b|ODOMETER|ODO\b/i);
      if (am >= 0) {
        var zone = t.slice(Math.max(0, am - 10), am + 90);
        _r2extractDigitRuns(zone).forEach(function (r) {
          var v = parseInt(r.digits, 10);
          if (byVal[String(v)]) byVal[String(v)].score += 2;
        });
      }
      if (parseSticker) {
        try {
          var f = parseSticker(src.text);
          if (f && f.odo && byVal[String(parseInt(f.odo, 10))]) byVal[String(parseInt(f.odo, 10))].score += 3;
        } catch (e) {}
      }
    });
    var list = Object.keys(byVal).map(function (k) { return byVal[k]; });
    list.forEach(function (c) {
      if (c.digits.length === 6) c.score += 2; else c.score += 1;
      if (master) {
        if (c.value > master && c.value <= master + 40000) c.score += 6;
        else if (c.value <= master) c.score -= 4;
        else c.score -= 2;
      }
    });
    list.sort(function (a, b) { return (b.score - a.score) || (b.sources - a.sources) || (b.value - a.value); });
    return list;
  }
  var _R2_MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  function _r2fuzzyMonth(tok) {
    var t = String(tok || '').toUpperCase().replace(/[^A-Z]/g, '').replace(/0/g, 'O').replace(/5/g, 'S').replace(/1/g, 'I');
    if (t.length < 3) return null;
    var keys = Object.keys(_R2_MONTHS);
    for (var i = 0; i < keys.length; i++) if (t.indexOf(keys[i]) === 0) return _R2_MONTHS[keys[i]];
    if (t.indexOf('SEPT') === 0 || t.indexOf('SEF') === 0) return 9;
    return null;
  }
  function _r2isoOf(y, mo, d) {
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    if (!(y >= 2015 && y <= 2045)) return null;
    return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
  }
  function _r2dateInterpretations(a, b, y) {
    var out = [];
    var yy = parseInt(y, 10); if (String(y).length === 2) yy += 2000;
    var i1 = _r2isoOf(yy, parseInt(a, 10), parseInt(b, 10)); if (i1) out.push(i1);
    var i2 = _r2isoOf(yy, parseInt(b, 10), parseInt(a, 10)); if (i2 && i2 !== i1) out.push(i2);
    if (String(a).length === 2 && parseInt(a, 10) > 31) {
      var a2 = String(a).slice(1);
      var i3 = _r2isoOf(yy, parseInt(a2, 10), parseInt(b, 10)); if (i3 && out.indexOf(i3) < 0) out.push(i3);
      var i4 = _r2isoOf(yy, parseInt(b, 10), parseInt(a2, 10)); if (i4 && out.indexOf(i4) < 0) out.push(i4);
    }
    return out;
  }
  function _r2rankStickerDates(texts, parseSticker) {
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
      while ((m = re.exec(t)) !== null) { var iso0 = _r2isoOf(+m[1], +m[2], +m[3]); if (iso0 && !seenHere[iso0]) { add(iso0, 2); seenHere[iso0] = 1; } }
      re = /\b(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})\b/g;
      while ((m = re.exec(t)) !== null) {
        _r2dateInterpretations(m[1], m[2], m[3]).forEach(function (iso) { if (!seenHere[iso]) { add(iso, 2); seenHere[iso] = 1; } });
      }
      re = /(\d{1,2})\s*[-\s]\s*([A-Za-z]{3,9})\.?,?\s*(\d{2,4})(?!\d)/g;
      while ((m = re.exec(t)) !== null) {
        var mo = _r2fuzzyMonth(m[2]); if (!mo) continue;
        var y = parseInt(m[3], 10); if (String(m[3]).length === 2) y += 2000;
        var iso = _r2isoOf(y, mo, parseInt(m[1], 10)); if (iso && !seenHere[iso]) { add(iso, 2); seenHere[iso] = 1; }
      }
      re = /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})(?!\d)/g;
      while ((m = re.exec(t)) !== null) {
        var mo2 = _r2fuzzyMonth(m[1]); if (!mo2) continue;
        var y2 = parseInt(m[3], 10); if (String(m[3]).length === 2) y2 += 2000;
        var iso2 = _r2isoOf(y2, mo2, parseInt(m[2], 10)); if (iso2 && !seenHere[iso2]) { add(iso2, 2); seenHere[iso2] = 1; }
      }
      if (parseSticker) {
        try {
          var f = parseSticker(t);
          if (f && f.date) add(f.date, 4);
        } catch (e) {}
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

  /* Mine ranked candidates from pooled OCR texts.
     texts: [{ text, whitelist }] — opts: { kind:'odometer'|'sticker',
     master, parseOdo, parseSticker }. Returns { odo, miles, dates }. */
  TicketOCR.mineCandidates = function (texts, opts) {
    opts = opts || {};
    var out = { odo: [], miles: [], dates: [] };
    if (opts.kind === 'sticker') {
      out.miles = _r2rankStickerMiles(texts, opts.master || null, opts.parseSticker || TicketOCR.parseServiceSticker);
      out.dates = _r2rankStickerDates(texts, opts.parseSticker || TicketOCR.parseServiceSticker);
    } else {
      out.odo = _r2rankOdo(texts, opts.parseOdo || null);
    }
    return out;
  };

  /* ---------- hunt: canvas variants + pooled reads ----------
     Two workers, mirroring the bench's fix for the tesseract.js
     empty-whitelist trap: the plain worker NEVER gets setParameters;
     the param worker only ever gets a NON-EMPTY whitelist. */
  var _huntWorkers = null;
  function _huntGetWorkers() {
    if (_huntWorkers) return _huntWorkers;
    _huntWorkers = TicketOCR.ensureLoaded().then(function () {
      if (!Tesseract.createWorker) return null;
      return Promise.all([
        Tesseract.createWorker('eng'),
        Tesseract.createWorker('eng')
      ]).then(function (ws) { return { plain: ws[0], param: ws[1] }; })
        .catch(function () { return null; });
    });
    return _huntWorkers;
  }
  function _huntRead(workers, img, cfg) {
    if (!workers) {
      // fallback: plain one-shot reads only (still pools variants)
      if (cfg !== 'dflt') return Promise.resolve(null);
      return TicketOCR.recognize(img).catch(function () { return null; });
    }
    if (cfg === 'dflt') {
      return workers.plain.recognize(img).then(function (r) { return r.data.text; }).catch(function () { return null; });
    }
    var params = cfg === 'wl7'
      ? { tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789.,' }
      : { tessedit_pageseg_mode: '6', tessedit_char_whitelist: '0123456789.,/-' };
    return workers.param.setParameters(params)
      .then(function () { return workers.param.recognize(img); })
      .then(function (r) { return r.data.text; })
      .catch(function () { return null; });
  }
  function _huntLoadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('hunt: image load failed')); };
      img.src = src;
    });
  }
  function _huntVariants(img) {
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    var scale = Math.min(1, 1600 / Math.max(w, h));
    var W = Math.max(2, Math.round(w * scale)), H = Math.max(2, Math.round(h * scale));
    var base = document.createElement('canvas'); base.width = W; base.height = H;
    base.getContext('2d').drawImage(img, 0, 0, W, H);
    function otsuFrom(srcCanvas, invert, preBlur) {
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      var ctx = c.getContext('2d');
      if (preBlur) { try { ctx.filter = 'blur(' + preBlur + 'px)'; } catch (e) {} }
      ctx.drawImage(srcCanvas, 0, 0);
      try { ctx.filter = 'none'; } catch (e) {}
      var id = ctx.getImageData(0, 0, W, H), d = id.data;
      var hist = new Array(256).fill(0), i, v;
      for (i = 0; i < d.length; i += 4) { v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; hist[v]++; }
      var total = W * H, sum = 0;
      for (i = 0; i < 256; i++) sum += i * hist[i];
      var sumB = 0, wB = 0, maxVar = -1, thr = 127;
      for (i = 0; i < 256; i++) {
        wB += hist[i]; if (!wB) continue;
        var wF = total - wB; if (!wF) break;
        sumB += i * hist[i];
        var mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
        if (between > maxVar) { maxVar = between; thr = i; }
      }
      for (i = 0; i < d.length; i += 4) {
        v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
        var ink = v <= thr ? 0 : 255;
        if (invert) ink = 255 - ink;
        d[i] = d[i + 1] = d[i + 2] = ink;
      }
      ctx.putImageData(id, 0, 0);
      return c;
    }
    function adaptFrom(srcCanvas) {
      var blurC = document.createElement('canvas'); blurC.width = W; blurC.height = H;
      var bctx = blurC.getContext('2d');
      try { bctx.filter = 'blur(9px)'; } catch (e) {}
      bctx.drawImage(srcCanvas, 0, 0);
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      var ctx = c.getContext('2d');
      ctx.drawImage(srcCanvas, 0, 0);
      var id = ctx.getImageData(0, 0, W, H), bd = bctx.getImageData(0, 0, W, H).data, d = id.data;
      for (var i = 0; i < d.length; i += 4) {
        var g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
        var bg = (bd[i] * 299 + bd[i + 1] * 587 + bd[i + 2] * 114) / 1000;
        var ink = g < bg - 12 ? 0 : 255;
        d[i] = d[i + 1] = d[i + 2] = ink;
      }
      ctx.putImageData(id, 0, 0);
      return c;
    }
    function url(canvas) { return canvas.toDataURL('image/jpeg', 0.92); }
    var V = [];
    V.push({ name: 'gray', url: url(base) });
    V.push({ name: 'otsu', url: url(otsuFrom(base, false, 0)) });
    V.push({ name: 'adapt', url: url(adaptFrom(base)) });
    V.push({ name: 'fuse', url: url(otsuFrom(base, false, 1.2)) });
    V.push({ name: 'inv', url: url(otsuFrom(base, true, 0)) });
    var offs = [[0, 0], [0.4, 0], [0, 0.4], [0.4, 0.4]];
    for (var ti = 0; ti < 4; ti++) {
      var tc = document.createElement('canvas');
      tc.width = Math.round(W * 0.6); tc.height = Math.round(H * 0.6);
      tc.getContext('2d').drawImage(base, Math.round(W * offs[ti][0]), Math.round(H * offs[ti][1]), tc.width, tc.height, 0, 0, tc.width, tc.height);
      V.push({ name: 'tile' + ti, url: url(tc) });
    }
    return V;
  }

  /* Run the hunt on a photo (data URL). Progressive: opts.onUpdate(result)
     fires after every read with the current rankings. Resolves with the
     final { odo, miles, dates }. Never rejects. */
  TicketOCR.huntCandidates = function (dataUrl, opts) {
    opts = opts || {};
    var pool = (opts.seedTexts || []).slice();
    function current() { return TicketOCR.mineCandidates(pool, opts); }
    return _huntLoadImage(dataUrl).then(function (img) {
      var variants = _huntVariants(img);
      var byName = {};
      variants.forEach(function (v) { byName[v.name] = v.url; });
      var plan = [
        { img: 'gray', cfg: 'dflt' }, { img: 'otsu', cfg: 'dflt' },
        { img: 'adapt', cfg: 'dflt' }, { img: 'fuse', cfg: 'dflt' },
        { img: 'inv', cfg: 'dflt' },
        { img: 'tile0', cfg: 'dflt' }, { img: 'tile1', cfg: 'dflt' },
        { img: 'tile2', cfg: 'dflt' }, { img: 'tile3', cfg: 'dflt' },
        { img: 'otsu', cfg: 'wl' }, { img: 'fuse', cfg: 'wl7' }
      ];
      return _huntGetWorkers().then(function (workers) {
        var chain = Promise.resolve();
        plan.forEach(function (step) {
          chain = chain.then(function () {
            return _huntRead(workers, byName[step.img], step.cfg).then(function (text) {
              if (text) {
                pool.push({ text: text, whitelist: step.cfg !== 'dflt' });
                if (opts.onUpdate) { try { opts.onUpdate(current()); } catch (e) {} }
              }
            });
          });
        });
        return chain.then(function () { return current(); });
      });
    }).catch(function () { return current(); });
  };

})();
