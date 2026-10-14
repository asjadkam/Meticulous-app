/* Meticulous — ⚡ POWER READ (v59)
   Cloud-vision escalation for photos the on-device reader can't crack
   (dot-matrix odometer dashes, handwritten service stickers).

   Owner's decision (Oct 14, 2026, revising the Oct 12 "no Google
   Vision" rule — made with real prices in front of him): Tesseract
   keeps first crack at every photo, free and offline. ONLY when a
   local read comes back with no usable fields does the app send that
   one photo to Google's Gemini vision model (Flash-class, the user's
   OWN free AI Studio key) and bring the answer back into the SAME
   confirm-first flows the local reads use.

   Hard rules baked in:
   - No key, or the Preferences switch is off → this module is inert:
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
   - The API key lives only in the synced store key 'powerReadKey'
     (Preferences → Advanced, password field). It is sent solely as
     the x-goog-api-key header to generativelanguage.googleapis.com —
     never hardcoded, never in the bundle, never logged.

   KNOWN FOLLOW-UP (pre-rollout, not this ship): the call is made from
   the client with the user's own key because the Firebase project has
   no Cloud Functions / Blaze plan. A shared-key rollout for other
   drivers needs a small backend proxy; per-user keys are fine for
   the owner's own use and keep Google's bill (fractions of a cent
   per read) on the key's owner. */
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

  var QUEUE_MAX = 4;

  /* ---------- store (lazy: App exists by call time, not load time) ---------- */
  function store() {
    try { return (window.App && App._store) || null; } catch (e) { return null; }
  }
  function sget(k, d) { var s = store(); if (!s) return d; var v = s.get(k, d); return (v === undefined || v === null) ? d : v; }
  function sset(k, v) { var s = store(); if (s) s.set(k, v); }

  /* ---------- settings ---------- */
  PowerRead.getKey = function () { return String(sget('powerReadKey', '') || '').trim(); };
  PowerRead.setKey = function (v) { sset('powerReadKey', String(v || '').trim()); };
  PowerRead.isOn = function () { return sget('powerReadOn', true) !== false; };
  PowerRead.setOn = function (on) { sset('powerReadOn', !!on); };
  PowerRead.hasKey = function () { return PowerRead.getKey().length > 0; };
  PowerRead.enabled = function () { return PowerRead.isOn() && PowerRead.hasKey(); };

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
   * impossible-or-absent. */
  PowerRead.masterOdo = function () {
    var s = store(); if (!s) return null;
    var v = parseFloat(s.get('mt_odo', ''));
    return (isFinite(v) && v > 0) ? v : null;
  };
  PowerRead.odoReadFailed = function (value) {
    var v = parseFloat(value);
    if (!(v > 0)) return true;
    var m = PowerRead.masterOdo();
    return !!(m && v < m);
  };
  PowerRead.hasFields = function (reader, fields) {
    if (!fields) return false;
    if (reader === 'odometer') return !!fields.value;
    if (reader === 'sticker') return !!(fields.odo || fields.date);
    return !!fields.rawText;
  };

  /* ---------- prompts: JSON-only, shaped like the local parsers ---------- */
  function promptFor(reader) {
    if (reader === 'odometer') {
      return 'You are reading a photo of a truck dashboard odometer. The display is often a dot-matrix or segmented digital readout and may be dim, pixelated or partly washed out. ' +
        'Find the TOTAL odometer reading in kilometres — not the trip meter (the trip meter is smaller and often has a decimal point). ' +
        'Reply with ONLY this JSON and nothing else: {"value": 168518} where the number is the integer total kilometres with no commas or spaces. If you truly cannot read it, reply {"value": null}.';
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
  function mapFields(reader, j) {
    var f = {};
    if (!j || typeof j !== 'object') return f;
    if (reader === 'odometer') {
      var v = cleanInt(j.value, 1000, 9999999);
      if (v) f.value = v;
    } else if (reader === 'sticker') {
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
        if (!parsed) return { ok: false, kind: 'http', message: '⚡ Power read could not understand the answer — your photo and entries are unchanged.' };
        return { ok: true, fields: mapFields(reader, parsed), model: model };
      }
      var emsg = '';
      try { emsg = String((r.json && r.json.error && r.json.error.message) || ''); } catch (e) {}
      if (r.status === 404 || /not found/i.test(emsg)) return { ok: false, kind: 'nomodel' };
      if (r.status === 400 || r.status === 401 || r.status === 403) {
        if (/not found/i.test(emsg)) return { ok: false, kind: 'nomodel' };
        return { ok: false, kind: 'badkey', message: '⚡ Power read: that API key didn\'t work — check it in Preferences → Advanced. Your photo and entries are unchanged.' };
      }
      if (r.status === 429) return { ok: false, kind: 'quota', message: '⚡ Power read hit Google\'s limit for now — try again later. Your photo and entries are unchanged.' };
      return { ok: false, kind: 'http', message: '⚡ Power read failed (HTTP ' + r.status + ') — your photo and entries are unchanged.' };
    }, function () {
      if (timer) clearTimeout(timer);
      return { ok: false, kind: 'network', message: '⚡ Power read could not reach Google.' };
    });
  }

  /* One read: walks the model chain on 404s only, remembers the model
     that worked, counts exactly one read per successful answer. */
  PowerRead.read = function (reader, dataUrl) {
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
     Disabled (off / no key) or no usable photo → resolves
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
          message = '⚡ Power read is turned off — switch it on in Preferences → Advanced and tough photos get a second, stronger read.';
        } else {
          reason = 'nokey';
          message = '⚡ Power read didn\'t run — no Gemini key is saved on THIS device yet. Paste your free key in Preferences → Advanced once, and tough photos get a second, stronger read.';
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
          if (PowerRead.hasFields(entry.reader, res.fields)) {
            var rs = getResults();
            rs.push({ id: entry.id, reader: entry.reader, fields: res.fields, origin: entry.origin || null, ts: Date.now(), seen: false });
            setResults(rs);
            delivered++;
          }
          return next();
        }
        /* network → still no signal, stop and keep the queue.
           badkey/quota/http → stop too; the key may be fixed later
           and the next app open retries. The photo is never dropped. */
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
