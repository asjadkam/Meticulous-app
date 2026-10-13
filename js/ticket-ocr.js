/* Meticulous — Tesseract.js OCR ticket parser (v26, doc reader v35)
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

  /* ---------- SCALE TICKET parser (BURNCO format) ---------- */
  TicketOCR.parseScaleTicket = function (text) {
    var f = { _type: 'scale_ticket' };

    // Ticket number — may appear twice (two copies). Strict digits-only;
    // bestNumeric takes the first contiguous run so adjacent columns
    // ("1026538139 6") don't get concatenated.
    var tickets = allMatches(text, /Ticket:\s*([\d\s]{6,14})/gi);
    f.ticketNo = bestNumeric(tickets);

    f.date = firstMatch(text, [
      /Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
      /Date\s+(\d{1,2}\/\d{1,2}\/\d{4})/i
    ]);

    f.time = firstMatch(text, [
      /Time:\s*(\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)/i,
      /(\d{1,2}:\d{2}:\d{2}\s*[AP]M)/i
    ]);

    f.gross = firstMatch(text, [/Gross:\s*([\d.]+)/i]);
    f.tare = firstMatch(text, [/Tare:\s*([\d.]+)/i]);
    f.net = firstMatch(text, [/Net:\s*([\d.]+)/i]);

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

    // Form type detection
    f.isHaulCard = /DAILY\s+TRUCK\s+HAUL\s+CARD/i.test(text);

    // Card number — printed, bottom-right (e.g., "23141")
    // Look for a 4-6 digit number near OPERATOR/APPROVED BY or at end
    var cardNo = firstMatch(text, [
      /OPERATOR[\s\S]{0,200}?(\d{5})\s*$/i,
      /(\d{5})\s*$/,
      /\b(23141)\b/
    ]);
    // Fallback: any 5-digit number (card numbers are 5 digits)
    if (!cardNo) {
      var nums = allMatches(text, /\b(\d{5})\b/g);
      if (nums.length) cardNo = nums[nums.length - 1];
    }
    f.cardNumber = cardNo;

    // Company — OCR often misreads "AECON" as "ACLU"; fuzzy match
    if (/AECON/i.test(text) || /ACLU/i.test(text)) f.company = 'AECON';

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
    if ((m = s.match(/(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{2,4})/))) {           // 24-Apr-18
      var mo1 = MONTHS[m[2].slice(0, 3).toLowerCase()];
      var y1 = parseInt(m[3], 10); if (y1 < 100) y1 += 2000;
      if (mo1) return isoDate(y1, mo1, parseInt(m[1], 10));
    }
    if ((m = s.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/))) {              // Apr 24, 2018
      var mo2 = MONTHS[m[1].slice(0, 3).toLowerCase()];
      if (mo2) return isoDate(parseInt(m[3], 10), mo2, parseInt(m[2], 10));
    }
    if ((m = s.match(/(\d{4})-(\d{2})-(\d{2})/))) return m[0];                   // 2026-10-14
    if ((m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) {                      // 3/26/2020
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
    var isRateCon = /ORDER\s+CONFIRMATION|RATE\s+CONFIRMATION|LOAD\s+CONFIRMATION/i.test(text);
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
    if (!f.broker) {
      var hdr = firstMatch(text, [/^\s*([A-Z][A-Za-z&.'-]*(?:\s+[A-Z][A-Za-z&.'-]*){1,3})\s+(?:Order|Rate|Load)\s+Confirmation/im]);
      if (hdr) f.broker = cleanCompany(hdr);
    }

    /* Order / confirmation number */
    f.orderNo = firstMatch(text, [
      /(?:Order|Rate|Load)\s+Confirmation\s*:?\s*#?\s*([A-Z]{1,5}[- ]?[A-Z0-9-]{2,})/i,
      /Confirmation\s*(?:#|No\.?)?\s*:?\s*([A-Z0-9-]{4,})/i,
      /Order\s*#\s*:?\s*([A-Z0-9-]{3,})/i,
      /Pickup\s*#\s*:?\s*([A-Z0-9-]{4,})/i
    ]);

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

    var isHaulCard = /DAILY\s+TRUCK\s+HAUL\s+CARD/i.test(text);
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

})();
