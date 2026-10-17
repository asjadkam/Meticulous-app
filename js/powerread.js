/* Meticulous — ⚡ POWER READ (v59; v94 transport revision)
   Cloud-vision escalation for photos the on-device reader can't crack
   (dot-matrix odometer dashes, handwritten service stickers).

   Owner's decision (Oct 14, 2026, revising the Oct 12 "no Google
   Vision" rule — made with real prices in front of him): Tesseract
   keeps first crack at every photo, free and offline. ONLY when a
   local read comes back with no usable fields does the app send that
   one photo to a cloud vision model (Gemini Flash-class) and bring
   the answer back into the SAME confirm-first flows the local reads
   use.

   v94 (owner ruling, Oct 16, 2026 — "why are we asking users to do
   more work?"): users are NEVER asked for a key. There is no key
   field, prompt, or nag anywhere in the app. Transport order:
   (a) the Meticulous server proxy — store key 'powerReadProxyUrl',
       deliberately NO UI (the chatbot's chatProxyUrl seam is the
       same pattern); the proxy holds Meticulous's own key
       server-side. v102: THE PROXY IS LIVE — DEFAULT_PROXY_URL
       below ships in the bundle, so every install has route (a)
       out of the box (navigator-default semantics: the default
       applies only while no URL was ever saved; a saved URL wins;
       a deliberately cleared '' stays cleared, reads stay
       on-device). Proxy calls carry the shared app token header
       (X-Meticulous-App) — an abuse turnstile the server requires
       alongside the app Origin, not a user credential;
   (b) a key saved on the device before v94 (the owner's own setup)
       — still read silently so existing installs keep working.
   When neither route exists the module is simply quiet: reads stay
   on-device and a failed escalation says one plain line, with no
   instructions to go fetch anything.

   Hard rules baked in:
   - Switch off, or no cloud route → this module is inert:
     zero network calls, local behaviour byte-identical to before.
   - A power-read value is a CANDIDATE, never a save. Odometer values
     land in the field / a tap-to-use chip only; the upward-only master
     odometer moves solely through the user's normal confirmed save,
     exactly as with local OCR. This module writes NOTHING outside its
     own powerRead* store keys.
   - Offline / network failure → the photo + reader type are kept in a
     small synced queue (powerReadQueue) and retried on app open and
     when connectivity returns. Results wait in powerReadResults until
     the owning screen picks them up (still confirm-first).
   - API errors surface as plain in-page text via the caller's status
     line; the photo and the local result are never lost.
   - A stored key (route b) lives only in the synced store key
     'powerReadKey' (+ its device-local mirror). It is sent solely as
     the x-goog-api-key header to generativelanguage.googleapis.com —
     never hardcoded, never in the bundle, never logged. */
(function () {
  'use strict';

  var PowerRead = {};
  window.PowerRead = PowerRead;

  /* Current Gemini Flash-class vision models, cheapest-adequate
     first. New projects can't always see older models, so a 404
     (model not found) automatically walks down the chain and the
     first model that answers is remembered (powerReadModel). */
  PowerRead.MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest'];
  PowerRead.ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

  /* v102: our own AI proxy on the Navigator's box (same host,
     same origin pinning). DEFAULT_PROXY_URL applies only while
     the store key was never saved — see proxyUrl(). APP_TOKEN
     must stay equal to the literal in js/chatbot.js (test-pinned
     parity) and to the server's METICULOUS_APP_TOKEN env value. */
  PowerRead.DEFAULT_PROXY_URL = 'https://2.31.47.19/ai/powerread';
  PowerRead.APP_TOKEN = 'c686ca1a3319a1f8c883f4282d036912e8c5433c5a0119d5';

  var QUEUE_MAX = 4;

  /* ---------- store (lazy: App exists by call time, not load time) ---------- */
  function store() {
    try { return (window.App && App._store) || null; } catch (e) { return null; }
  }
  function sget(k, d) { var s = store(); if (!s) return d; var v = s.get(k, d); return (v === undefined || v === null) ? d : v; }
  function sset(k, v) { var s = store(); if (s) s.set(k, v); }

  /* ---------- settings ---------- */
  /* v80: the key (and the on/off switch) ALSO live in a raw
     localStorage slot OUTSIDE the mt_ store namespace. Why: the
     store copy is the synced one (cloudsync mirrors every mt_ key,
     so a signed-in reinstall pulls it back), but a reinstall that
     wipes the WebView's mt_ data — or a store reset before the key
     ever synced — took the key with it (Oct 15: the owner's phone
     showed an empty key field a day after he pasted it). The mirror
     slot is written on every set and read as a fallback; a mirror
     hit restores the store copy (self-heal), which then re-syncs.
     Nothing here survives a full device wipe — that is what the
     cloud copy is for — but an app-side data loss no longer takes
     the key alone. */
  var MIRROR_SLOT = 'meticulous.pr';
  function mirrorRead() {
    try {
      var raw = localStorage.getItem(MIRROR_SLOT);
      if (!raw) return null;
      var j = JSON.parse(raw);
      return (j && typeof j === 'object') ? j : null;
    } catch (e) { return null; }
  }
  function mirrorWrite(patch) {
    try {
      var j = mirrorRead() || {};
      for (var k in patch) { if (Object.prototype.hasOwnProperty.call(patch, k)) j[k] = patch[k]; }
      localStorage.setItem(MIRROR_SLOT, JSON.stringify(j));
    } catch (e) {}
  }
  PowerRead.getKey = function () {
    var k = String(sget('powerReadKey', '') || '').trim();
    if (k) return k;
    var m = mirrorRead();
    var mk = (m && typeof m.key === 'string') ? m.key.trim() : '';
    if (mk) { sset('powerReadKey', mk); return mk; }   // self-heal the store copy
    return '';
  };
  PowerRead.setKey = function (v) {
    var k = String(v || '').trim();
    sset('powerReadKey', k);
    mirrorWrite({ key: k });
  };
  PowerRead.isOn = function () {
    var v = sget('powerReadOn', null);
    if (v === null || v === undefined) {
      var m = mirrorRead();
      if (m && typeof m.on === 'boolean') { sset('powerReadOn', m.on); return m.on; }
      return true;
    }
    return v !== false;
  };
  PowerRead.setOn = function (on) { sset('powerReadOn', !!on); mirrorWrite({ on: !!on }); };
  PowerRead.hasKey = function () { return PowerRead.getKey().length > 0; };
  /* v94: route (a) — the server proxy. Its URL lives in the synced
     store, written by the server ship (or a future default); there
     is deliberately NO UI for it anywhere in the app. */
  PowerRead.proxyUrl = function () {
    var v = sget('powerReadProxyUrl', null);
    if (v === null || v === undefined) return PowerRead.DEFAULT_PROXY_URL;
    return String(v || '').trim();
  };
  PowerRead.hasRoute = function () { return !!PowerRead.proxyUrl() || PowerRead.hasKey(); };
  PowerRead.enabled = function () { return PowerRead.isOn() && PowerRead.hasRoute(); };

  /* ---------- monthly counter (cost visibility) ---------- */
  function monthStr(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }
  PowerRead.monthCount = function () {
    var rec = sget('powerReadCount', null);
    if (!rec || rec.month !== monthStr(new Date())) return 0;
    return rec.n || 0;
  };
  function bumpCount() {
    var m = monthStr(new Date());
    var rec = sget('powerReadCount', null);
    var n = (rec && rec.month === m) ? (rec.n || 0) : 0;
    sset('powerReadCount', { month: m, n: n + 1 });
  }

  /* ---------- trigger: did the local read produce nothing usable? ---------- */
  PowerRead.localFailed = function (reader, fields) {
    if (reader === 'odometer') return PowerRead.odoReadFailed(fields && fields.value);
    if (reader === 'sticker') return !(fields && (fields.odo || fields.date));
    /* 'text' (generic): callers pass the parser's found-count */
    return !(fields && fields.found > 0);
  };

  /* ---------- v63: odometer plausibility gate ----------
   * ONE master odometer (store key mt_odo, upward-only). A local
   * odometer read counts as FAILED when it produced nothing, OR when
   * a master exists and the value sits BELOW it — odometers never
   * run backwards, so a lower value is a misread, not a bargain.
   * (Oct 14 live test: the dash photo read 45,100 against a 168,518
   * master; because a value existed, v59 called the read a success
   * and never escalated.) A plausible value (>= master, or no master
   * yet — first-run onboarding) passes: the power read costs per
   * call, and cost discipline says escalate only the
   * impossible-or-absent.
   *
   * v80: the gate is TWO-SIDED. Oct 15: the Fuel odometer read
   * returned 519,326 — the INVOICE NO. printed on the fuel receipt
   * in frame — against a 168,759 master. Above the master, the
   * one-sided gate waved it through and the number landed in the
   * form. A candidate more than ODO_MAX_JUMP_KM past the master is
   * just as impossible as one below it: the truck cannot gain
   * 1,000+ km between readings a driver makes. odoImplausible
   * names the direction so each screen can say, in plain words,
   * which way the read is impossible. (A value the USER types is
   * never gated — typing is the confirm. Only machine candidates
   * are distrusted.) */
  PowerRead.ODO_MAX_JUMP_KM = 1000;
  PowerRead.masterOdo = function () {
    var s = store(); if (!s) return null;
    var v = parseFloat(s.get('mt_odo', ''));
    return (isFinite(v) && v > 0) ? v : null;
  };
  /* 'below' | 'jump' | null (plausible, or no master to judge by) */
  PowerRead.odoImplausible = function (value) {
    var v = parseFloat(value);
    if (!(v > 0)) return null;
    var m = PowerRead.masterOdo();
    if (!m) return null;
    if (v < m) return 'below';
    if (v > m + PowerRead.ODO_MAX_JUMP_KM) return 'jump';
    return null;
  };
  PowerRead.odoReadFailed = function (value) {
    var v = parseFloat(value);
    if (!(v > 0)) return true;
    return PowerRead.odoImplausible(v) !== null;
  };
  PowerRead.hasFields = function (reader, fields) {
    if (!fields) return false;
    if (reader === 'odometer') return !!fields.value;
    if (reader === 'sticker') return !!(fields.odo || fields.date);
    return !!fields.rawText;
  };

  /* ---------- prompts: shaped like the local parsers ----------
     v115: the odometer prompt now demands a BARE NUMBER (mirrors
     the server's readPrompt in deploy/ai/server.js — the two are
     kept in step). The JSON demand was honoured only sometimes:
     the model answered in prose, or with a comma inside an
     unquoted number, and the strict parser below threw a perfectly
     good reading away (Oct 16 live acceptance: 3/3 dash reads
     failed while a direct probe returning clean JSON succeeded).
     A bare number is the simplest contract to keep, and the
     tolerant extractor (extractOdometerFromText) now forgives the
     shapes that still slip through. */
  function promptFor(reader) {
    if (reader === 'odometer') {
      return 'You are reading a photo of a truck dashboard odometer. The display is often a dot-matrix or segmented digital readout and may be dim, pixelated or partly washed out. ' +
        'Find the TOTAL odometer reading in kilometres — not the trip meter (the trip meter is smaller and often has a decimal point). ' +
        'Reply with only the odometer number, no other text: the integer total kilometres with no commas, spaces or labels (for example: 168518). If you truly cannot read it, reply with only: 0';
    }
    if (reader === 'sticker') {
      return 'You are reading a vehicle "NEXT SERVICE DUE" windshield sticker. The values are often HANDWRITTEN in marker or pen. ' +
        'Reply with ONLY this JSON and nothing else: {"miles": 175429, "date": "2026-09-28"} where miles is the odometer reading written for the next service (integer, no commas) and date is the due date in YYYY-MM-DD format. Use null for anything you cannot read.';
    }
    return 'Transcribe ALL the text visible in this photo exactly as written, line by line, including every number, date, price and label. ' +
      'Reply with ONLY this JSON and nothing else: {"text": "<the transcription, with \\n between lines>"}';
  }

  /* ---------- response mapping → the local parsers' field shapes ---------- */
  function cleanInt(v, min, max) {
    if (v === null || v === undefined) return null;
    var digits = String(v).replace(/[^\d]/g, '');
    if (!digits) return null;
    var n = parseInt(digits, 10);
    if (!(n >= min && n <= max)) return null;
    return String(n);
  }
  /* ---------- v115: tolerant odometer extraction ----------
     The strict door above (JSON {"value": N}) stays first choice,
     but a vision model answers in the wild shapes too: prose
     ("The odometer reads 169,166 km"), a comma inside an unquoted
     JSON number ({"value": 169,166} — invalid JSON), or a bare
     number. Every one of those carried a perfectly good reading
     that the v114 parser discarded (Oct 16 live acceptance drive:
     the merged odometer card failed 3/3 on the owner's real dash
     photo, true reading 169166, while the fuel receipt read —
     whose parser tolerates prose — worked in-app minutes later).
     extractOdometerFromText recovers the reading from any reply
     text: thousands separators are stripped, every number becomes
     a candidate, and the winner is picked by the same sanity
     thinking the local dash parser (js/app.js parseOdometerReading)
     uses — trip-meter numbers lose (labelled trip, or carrying a
     decimal), labelled/total figures win, and against a stored
     master the candidate nearest it wins; otherwise the largest
     dash-like figure. Range: 4–7 digit values in the plausible
     truck span 1,000–2,000,000 km. NO candidate → null, and the
     caller fails honestly, exactly as before. The result is still
     only a CANDIDATE: escalate()'s two-sided plausibility gate and
     the confirm-first UI judge it downstream, unchanged. */
  function extractOdometerFromText(text) {
    var t = String(text || '');
    if (!t) return null;
    var flat = t.replace(/(\d)[ \t]+(?=\d)/g, '$1');   // glue "169 166"
    var lower = flat.toLowerCase();
    var re = /(\d[\d,]*\.?\d*)/g, m, cands = [];
    while ((m = re.exec(flat)) !== null) {
      var tok = m[1];
      var v = parseFloat(tok.replace(/,/g, ''));
      if (!isFinite(v)) continue;
      var iv = Math.floor(v);
      if (iv < 1000 || iv > 2000000) continue;
      var intDigits = tok.replace(/,/g, '').split('.')[0].length;
      if (intDigits < 4 || intDigits > 7) continue;
      var before = lower.slice(Math.max(0, m.index - 48), m.index);
      var after = lower.slice(m.index + tok.length, m.index + tok.length + 12);
      var labelled = /\b(odometer|total)\b/.test(before);
      cands.push({
        v: iv,
        dec: /\.\d/.test(tok),
        /* a number introduced as the trip meter loses — unless the
           same breath also calls it the odometer/total */
        trip: /\btrip\b/.test(before) && !labelled,
        label: labelled || /\bkm\b/.test(after)
      });
    }
    if (!cands.length) return null;
    var pool = cands;
    var nonTrip = pool.filter(function (c) { return !c.trip; });
    if (nonTrip.length) pool = nonTrip;
    var ints = pool.filter(function (c) { return !c.dec; });
    if (ints.length) pool = ints;
    var labelledPool = pool.filter(function (c) { return c.label; });
    if (labelledPool.length) pool = labelledPool;
    var master = null;
    try { master = PowerRead.masterOdo(); } catch (e) {}
    if (master) {
      var near = pool.filter(function (c) { return c.v >= master && c.v <= master + PowerRead.ODO_MAX_JUMP_KM; });
      if (near.length) {
        near.sort(function (a, b) { return a.v - b.v; });
        return String(near[0].v);   // nearest the master (all are at/above it)
      }
    }
    var best = null;
    pool.forEach(function (c) { if (!best || c.v > best.v) best = c; });
    return best ? String(best.v) : null;
  }
  PowerRead._extractOdometer = extractOdometerFromText;

  function mapFields(reader, j, rawText) {
    var f = {};
    if (reader === 'odometer') {
      var v = null;
      /* v115: a bare-number reply parses to a JSON number, not an
         object — that IS the value (integer only; a fractional
         number falls through to the text extractor, which weighs
         its decimal the way it weighs a trip meter's). */
      if (typeof j === 'number' && isFinite(j) && Math.floor(j) === j) v = cleanInt(j, 1000, 9999999);
      if (!v && j && typeof j === 'object') v = cleanInt(j.value, 1000, 9999999);
      if (!v && rawText) v = extractOdometerFromText(rawText);
      if (v) f.value = v;
      return f;
    }
    if (!j || typeof j !== 'object') return f;
    if (reader === 'sticker') {
      var miles = cleanInt(j.miles, 1000, 1999999);
      if (miles) f.odo = miles;
      if (typeof j.date === 'string') {
        var m = j.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) {
          var mo = parseInt(m[2], 10), dy = parseInt(m[3], 10);
          if (mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) f.date = m[1] + '-' + m[2] + '-' + m[3];
        }
      }
    } else {
      if (typeof j.text === 'string' && j.text.trim()) f.rawText = j.text;
    }
    return f;
  }
  PowerRead._mapFields = mapFields;

  function parseModelJson(text) {
    var t = String(text || '').trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return JSON.parse(t); } catch (e) {
      var a = t.indexOf('{'), b = t.lastIndexOf('}');
      if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e2) {} }
      return null;
    }
  }

  /* ---------- the provider call ---------- */
  function fetchFn() {
    try { if (typeof fetch === 'function') return fetch; } catch (e) {}
    return (typeof window !== 'undefined' && window.fetch) || null;
  }
  function isOffline() {
    try { return typeof navigator !== 'undefined' && navigator && navigator.onLine === false; } catch (e) { return false; }
  }

  function callModel(model, reader, dataUrl, key) {
    var f = fetchFn();
    if (!f) return Promise.resolve({ ok: false, kind: 'network', message: '⚡ Power read needs a network connection.' });
    var mm = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
    if (!mm) return Promise.resolve({ ok: false, kind: 'http', message: '⚡ Power read could not use that photo.' });
    var mime = mm[1] || 'image/jpeg';
    var data = mm[3];
    if (!mm[2]) { /* not base64 — cannot inline it */ return Promise.resolve({ ok: false, kind: 'http', message: '⚡ Power read could not use that photo.' }); }
    var body = {
      contents: [{ parts: [{ text: promptFor(reader) }, { inline_data: { mime_type: mime, data: data } }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: reader === 'text' ? 2048 : 256 }
    };
    var ctrl = null, timer = null;
    var init = { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) };
    try {
      if (typeof AbortController !== 'undefined') {
        ctrl = new AbortController();
        init.signal = ctrl.signal;
        timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 45000);
      }
    } catch (e) {}
    return f(PowerRead.ENDPOINT + model + ':generateContent', init).then(function (resp) {
      if (timer) clearTimeout(timer);
      return resp.json().then(function (j) { return { status: resp.status, ok: resp.ok, json: j }; }, function () { return { status: resp.status, ok: resp.ok, json: null }; });
    }).then(function (r) {
      if (r.status === 200 && r.json) {
        var parts = null;
        try { parts = r.json.candidates[0].content.parts; } catch (e) {}
        if (!parts) return { ok: false, kind: 'http', message: '⚡ Power read got an empty answer — your photo and entries are unchanged.' };
        var text = parts.map(function (p) { return p.text || ''; }).join('');
        var parsed = parseModelJson(text);
        var fields = mapFields(reader, parsed, text);
        /* v115: an unparseable reply is only a failure when the
           tolerant pass recovered NOTHING from it either (the
           odometer extractor forgives prose / bare numbers / a
           comma inside an unquoted JSON number). A parsed-but-empty
           answer ({"value": null}, or the bare-number prompt's 0
           sentinel) stays a successful read with no fields, as
           before — the caller words it as "couldn't read it". */
        if ((parsed === null || parsed === undefined) && !Object.keys(fields).length) return { ok: false, kind: 'http', message: '⚡ Power read could not understand the answer — your photo and entries are unchanged.' };
        return { ok: true, fields: fields, model: model };
      }
      var emsg = '';
      try { emsg = String((r.json && r.json.error && r.json.error.message) || ''); } catch (e) {}
      if (r.status === 404 || /not found/i.test(emsg)) return { ok: false, kind: 'nomodel' };
      if (r.status === 400 || r.status === 401 || r.status === 403) {
        if (/not found/i.test(emsg)) return { ok: false, kind: 'nomodel' };
        return { ok: false, kind: 'badkey', message: '⚡ Power read couldn\'t complete that read — your photo and entries are unchanged.' };
      }
      if (r.status === 429) return { ok: false, kind: 'quota', message: '⚡ Power read hit the cloud reader\'s limit for now — try again later. Your photo and entries are unchanged.' };
      return { ok: false, kind: 'http', status: r.status, message: '⚡ Power read failed (HTTP ' + r.status + ') — your photo and entries are unchanged.' };
    }, function () {
      if (timer) clearTimeout(timer);
      return { ok: false, kind: 'network', message: '⚡ Power read could not reach the cloud reader.' };
    });
  }

  /* v94 route (a): the Meticulous server proxy holds the key —
     the app sends just {reader, image} and gets back either the
     model's JSON text ({text}) or the model JSON itself. A proxy
     network failure reports kind 'network' so the escalation path
     queues the photo exactly as it does for a direct-call dropout. */
  function callProxy(url, reader, dataUrl) {
    var f = fetchFn();
    if (!f) return Promise.resolve({ ok: false, kind: 'network', message: '⚡ Power read needs a network connection.' });
    return f(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Meticulous-App': PowerRead.APP_TOKEN },
      body: JSON.stringify({ reader: reader, image: dataUrl })
    }).then(function (resp) {
      return resp.json().then(function (j) { return { status: resp.status, json: j }; }, function () { return { status: resp.status, json: null }; });
    }).then(function (r) {
      if (r.status !== 200 || !r.json) return { ok: false, kind: 'http', status: r.status, message: '⚡ Power read failed — your photo and entries are unchanged.' };
      var rawText = (typeof r.json.text === 'string') ? r.json.text : null;
      var parsed = (rawText !== null) ? parseModelJson(rawText) : r.json;
      var fields = mapFields(reader, parsed, rawText);
      /* v115: same forgiveness as the direct route — an unparseable
         reply fails only when nothing could be recovered from it. */
      if ((parsed === null || parsed === undefined) && !Object.keys(fields).length) return { ok: false, kind: 'http', message: '⚡ Power read could not understand the answer — your photo and entries are unchanged.' };
      bumpCount();
      return { ok: true, fields: fields, model: 'proxy' };
    }, function () {
      return { ok: false, kind: 'network', message: '⚡ Power read could not reach the cloud reader.' };
    });
  }

  /* One read: the server proxy when one is set; otherwise the
     device-saved key walks the model chain on 404s only, remembers
     the model that worked. Counts exactly one read per success. */
  function readOnce(reader, dataUrl) {
    var proxy = PowerRead.proxyUrl();
    if (proxy) return callProxy(proxy, reader, dataUrl);
    var key = PowerRead.getKey();
    if (!key) return Promise.resolve({ ok: false, kind: 'nokey' });
    var chain = PowerRead.MODELS.slice();
    var remembered = String(sget('powerReadModel', '') || '');
    var start = Math.max(0, chain.indexOf(remembered));
    var order = chain.slice(start).concat(chain.slice(0, start));
    function attempt(i) {
      if (i >= order.length) return { ok: false, kind: 'http', message: '⚡ Power read is unavailable right now (no model answered) — your photo and entries are unchanged.' };
      return callModel(order[i], reader, dataUrl, key).then(function (res) {
        if (res.kind === 'nomodel') return attempt(i + 1);
        if (res.ok) {
          sset('powerReadModel', order[i]);
          bumpCount();
        }
        return res;
      });
    }
    return Promise.resolve().then(function () { return attempt(0); });
  }

  /* v118: ONE automatic retry on a TRANSIENT failure — the soak's
     circuit 1 failed the owner's dash photo ("⚡ Power read
     failed") and circuits 2–3 read the SAME photo fine: a single
     5xx/network blip was being surfaced as a verdict. Transient =
     network-class, or HTTP 5xx from either route. Never retried:
     quota (429 — the reader's limit is real), a bad key, a model
     that doesn't exist, an empty/unparseable 200 answer (not a
     transport failure), or no-key. If the retry also fails
     transiently, the copy says so honestly — it was tried twice. */
  PowerRead.RETRY_DELAY_MS = 1200;
  function prTransient(res) {
    if (!res || res.ok) return false;
    if (res.kind === 'network') return true;
    if (res.kind === 'http' && typeof res.status === 'number' && res.status >= 500) return true;
    return false;
  }
  PowerRead.read = function (reader, dataUrl) {
    return readOnce(reader, dataUrl).then(function (res) {
      if (!prTransient(res)) return res;
      return new Promise(function (resolve) {
        setTimeout(resolve, PowerRead.RETRY_DELAY_MS || 0);
      }).then(function () { return readOnce(reader, dataUrl); }).then(function (res2) {
        if (!res2.ok && prTransient(res2)) {
          res2.retried = true;
          res2.message = '⚡ Power read failed twice — the cloud reader may be having a moment. Your photo and entries are unchanged; you can type the number instead.';
        }
        return res2;
      });
    });
  };

  /* ---------- offline queue (synced store key) ---------- */
  function getQueue() { var q = sget('powerReadQueue', []); return Array.isArray(q) ? q : []; }
  function setQueue(q) { sset('powerReadQueue', q); }
  PowerRead.queueLength = function () { return getQueue().length; };
  function enqueue(reader, image, origin) {
    var q = getQueue();
    for (var i = 0; i < q.length; i++) {
      if (q[i].reader === reader && q[i].image === image) return q[i];
    }
    var entry = { id: 'pr' + Date.now() + '' + Math.floor(Math.random() * 1e6), reader: reader, image: image, origin: origin || null, ts: Date.now() };
    q.push(entry);
    while (q.length > QUEUE_MAX) q.shift();
    setQueue(q);
    return entry;
  }
  PowerRead._enqueue = enqueue;

  /* ---------- finished reads waiting for their screen ---------- */
  function getResults() { var r = sget('powerReadResults', []); return Array.isArray(r) ? r : []; }
  function setResults(r) { sset('powerReadResults', r); }
  PowerRead.pendingResults = function () { return getResults().slice(); };
  function matches(r, reader, originModule) {
    if (r.reader !== reader) return false;
    if (originModule && !(r.origin && r.origin.module === originModule)) return false;
    return true;
  }
  PowerRead.peekResult = function (reader, originModule) {
    var rs = getResults();
    for (var i = rs.length - 1; i >= 0; i--) if (matches(rs[i], reader, originModule)) return rs[i];
    return null;
  };
  PowerRead.takeResult = function (reader, originModule) {
    var rs = getResults();
    for (var i = rs.length - 1; i >= 0; i--) {
      if (matches(rs[i], reader, originModule)) { var r = rs[i]; rs.splice(i, 1); setResults(rs); return r; }
    }
    return null;
  };
  PowerRead.markAllSeen = function () {
    var rs = getResults(), changed = false;
    rs.forEach(function (r) { if (!r.seen) { r.seen = true; changed = true; } });
    if (changed) setResults(rs);
  };
  PowerRead.describeResult = function (r) {
    var f = (r && r.fields) || {}, parts = [], moduleLabel = (r && r.origin && r.origin.label) || '';
    if (r && r.reader === 'odometer') {
      if (f.value) parts.push('odometer ' + Number(f.value).toLocaleString('en-CA') + ' km');
      if (!moduleLabel) moduleLabel = 'Preferences';
    } else if (r && r.reader === 'sticker') {
      if (f.odo) parts.push('next service ' + Number(f.odo).toLocaleString('en-CA') + ' km');
      if (f.date) parts.push('due ' + f.date);
      if (!moduleLabel) moduleLabel = 'Maintenance';
    } else {
      parts.push('a photo read');
      if (!moduleLabel) moduleLabel = 'Fuel';
    }
    return { text: parts.join(' · ') || 'a photo read', moduleLabel: moduleLabel };
  };

  /* ---------- escalation: the one entry every reader uses ----------
     opts = { reader, image (data URL), origin {module,label},
              onStatus({state,message}), onResult({fields, reader}) }
     States: 'working' → 'waiting' (queued; will retry) | 'error'
     (plain message; nothing queued) — success fires onResult.
     Disabled (off / no cloud route) or no usable photo → resolves
     {status:'skipped'} with NO network and nothing written — but
     v63: a host that explicitly asked for an escalation (it passed
     onStatus) is told WHY via state 'unavailable', so the failure
     surfaces in-page instead of vanishing. (In v59 the skip was
     total silence — no callback, no trace — which is how the
     Oct 14 live sticker test failed invisibly: the escalation
     fired, found no usable key on that device, and the user saw
     only the local failure text.) Callers without onStatus stay
     silent, exactly as v59 intended for passive paths. */
  PowerRead.escalate = function (opts) {
    opts = opts || {};
    var reader = opts.reader || 'text';
    if (!PowerRead.enabled() || !opts.image) {
      if (opts.onStatus) {
        var reason, message;
        if (!opts.image) {
          reason = 'noimage';
          message = '⚡ Power read didn\'t run — the photo couldn\'t be prepared for it.';
        } else if (!PowerRead.isOn()) {
          reason = 'off';
          message = '⚡ Power read is off — turn it on in Preferences → Advanced to give hard photos a second read.';
        } else {
          /* v94: no cloud route on this device yet (the server
             proxy isn't live and no key was ever saved here) — one
             quiet line, no errand attached. */
          reason = 'nokey';
          message = '⚡ Power read couldn\'t run — the cloud reader isn\'t reachable from this device yet, so this photo was read on-device only.';
        }
        try { opts.onStatus({ state: 'unavailable', reason: reason, message: message }); } catch (e) {}
      }
      return Promise.resolve({ status: 'skipped' });
    }
    function status(state, message) { try { if (opts.onStatus) opts.onStatus({ state: state, message: message }); } catch (e) {} }
    if (isOffline()) {
      enqueue(reader, opts.image, opts.origin);
      status('waiting', '⚡ Power read waiting for signal — the photo is saved and will be read when you\'re back online.');
      return Promise.resolve({ status: 'waiting' });
    }
    status('working', '⚡ Asking the power read…');
    return PowerRead.read(reader, opts.image).then(function (res) {
      if (res.ok) {
        /* v80: a cloud odometer answer is a candidate like any
           other — it passes the SAME plausibility gate before any
           screen may fill it. An impossible value (below the
           master, or a wild jump past it) is reported in plain
           words and never delivered as a result. */
        if (reader === 'odometer' && res.fields && res.fields.value) {
          var why = PowerRead.odoImplausible(res.fields.value);
          if (why) {
            var m = PowerRead.masterOdo();
            var msg = why === 'jump'
              ? '⚡ Power read got ' + Number(res.fields.value).toLocaleString('en-CA') + ' km — that\'s way past your current odometer (' + Number(m).toLocaleString('en-CA') + ' km), so it can\'t be right and wasn\'t used.'
              : '⚡ Power read got ' + Number(res.fields.value).toLocaleString('en-CA') + ' km — below your current odometer (' + Number(m).toLocaleString('en-CA') + ' km), so it can\'t be right and wasn\'t used.';
            status('error', msg);
            return { status: 'implausible', message: msg };
          }
        }
        try { if (opts.onResult) opts.onResult({ fields: res.fields || {}, reader: reader }); } catch (e) {}
        return { status: 'done', fields: res.fields || {} };
      }
      if (res.kind === 'network') {
        enqueue(reader, opts.image, opts.origin);
        status('waiting', '⚡ Power read waiting for signal — the photo is saved and will be read when you\'re back online.');
        return { status: 'waiting' };
      }
      status('error', res.message || '⚡ Power read failed — your photo and entries are unchanged.');
      return { status: 'error', message: res.message };
    });
  };

  /* ---------- queue drain: app open + connectivity return ----------
     Delivers into powerReadResults for the owning screens to pick up
     (confirm-first — nothing is applied to any form field here). */
  var _processing = false;
  PowerRead.processQueue = function () {
    if (_processing) return Promise.resolve(0);
    if (!PowerRead.enabled() || isOffline()) return Promise.resolve(0);
    var q = getQueue();
    if (!q.length) return Promise.resolve(0);
    _processing = true;
    var delivered = 0;
    function next() {
      var cur = getQueue();
      if (!cur.length) { _processing = false; finish(); return Promise.resolve(); }
      var entry = cur[0];
      return PowerRead.read(entry.reader, entry.image).then(function (res) {
        if (res.ok) {
          var q2 = getQueue();
          q2 = q2.filter(function (e) { return e.id !== entry.id; });
          setQueue(q2);
          /* v80: queued odometer answers pass the same plausibility
             gate — an impossible value is dropped here rather than
             offered later as a tap-to-use chip against a master it
             can never match. */
          var usable = PowerRead.hasFields(entry.reader, res.fields) &&
            !(entry.reader === 'odometer' && res.fields.value && PowerRead.odoImplausible(res.fields.value));
          if (usable) {
            var rs = getResults();
            rs.push({ id: entry.id, reader: entry.reader, fields: res.fields, origin: entry.origin || null, ts: Date.now(), seen: false });
            setResults(rs);
            delivered++;
          }
          return next();
        }
        /* network → still no signal, stop and keep the queue.
           badkey/quota/http → stop too; the next app open retries
           once a cloud route is reachable. The photo is never dropped. */
        _processing = false;
        finish();
        return null;
      });
    }
    function finish() {
      if (delivered > 0) { try { if (typeof PowerRead._onDelivered === 'function') PowerRead._onDelivered(delivered); } catch (e) {} }
    }
    return Promise.resolve().then(next).then(function () { return delivered; }, function () { _processing = false; return delivered; });
  };
})();
