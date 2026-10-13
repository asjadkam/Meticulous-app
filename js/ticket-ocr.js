/* Meticulous — Tesseract.js OCR ticket parser (v26)
   On-device, offline, free. NO Google Vision.
   
   Handles two document types:
   1. SCALE TICKETS (e.g., BURNCO Aggregate Scale Ticket):
      Ticket#, Date, Time, Gross, Tare, Net, Product, Customer, Job, PO,
      Vehicle, Vehicle Type, Received Today, Weighmaster
   2. DISPATCH SCREENSHOTS (e.g., WhatsApp dispatch message):
      Time, Equipment, Site, Location code, Instructions, Coordinates
   
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
  TicketOCR.parseDispatch = function (text) {
    var f = { _type: 'dispatch' };

    // Time — e.g., "Tomorrow 8:00am", "8:00am"
    var tm = text.match(/(Tomorrow\s+)?(\d{1,2}:\d{2}\s*[ap]m)/i);
    if (tm) {
      f.time = (tm[1] || '') + tm[2];
      f.time = f.time.trim();
    }

    // Equipment type
    var eq = firstMatch(text, [/(Tandem|Tridem|Tri-axle|End\s*dump|Single\s*axle)/i]);
    if (eq) f.equipment = eq;

    // Site/company — e.g., "Aecon Inf". Usually the line after equipment.
    var site = firstMatch(text, [/(Aecon\s+\w+)/i]);
    if (site) f.site = site;

    // Location code — e.g., "A2-L20"
    f.locationCode = firstMatch(text, [/\b([A-Z]\d+-[A-Z]\d+)\b/]);

    // Instructions — e.g., "Go Empty To"
    var inst = firstMatch(text, [/(Go\s+Empty\s+To)/i]);
    if (inst) f.instructions = inst;

    // Coordinates — e.g., 50°57'59.4"N  114°01'54.4"W
    var lat = firstMatch(text, [/(\d+°\d+'[\d.]+"N)/]);
    var lng = firstMatch(text, [/(\d+°\d+'[\d.]+"W)/]);
    if (lat && lng) {
      f.coordinates = lat + ' ' + lng;
      f.latitude = lat;
      f.longitude = lng;
    }

    var count = 0;
    ['time', 'equipment', 'site', 'locationCode', 'instructions', 'coordinates'].forEach(function (k) {
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

  /* ---------- Auto-detect and parse ---------- */
  TicketOCR.parse = function (text) {
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
    } else {
      // Dispatch screenshot
      if (parsed.site) form.jobSite = parsed.site;
      var n = [];
      if (parsed.time) n.push(parsed.time);
      if (parsed.equipment) n.push(parsed.equipment);
      if (parsed.instructions && parsed.locationCode) {
        n.push(parsed.instructions + ' ' + parsed.locationCode);
      } else if (parsed.locationCode) {
        n.push(parsed.locationCode);
      }
      if (parsed.coordinates) n.push(parsed.coordinates);
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
