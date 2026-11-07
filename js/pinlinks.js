/* Meticulous — PIN LINKS (v358).
   Owner (Nov 7, 2026 08:25): "Is there a way to open these
   Google Map pins in our navigator?" Dispatchers (Saleem, Chad)
   send pins as Google Maps LINKS in their texts. A full link
   carries its coordinates inside it (…/@51.12,-113.98…, ?q=…,
   the !3d/!4d place segment); a SHORT link (maps.app.goo.gl/…)
   hides them behind a redirect. This file is the ONE link brain
   every door shares — dispatch ingest (js/dispatch-ingest.js via
   js/ticket-ocr.js), and the Navigator's sent-pin door
   (modules/navigator.js):

     findLinks(text)      the Maps links in a text, in order
     coordsFromUrl(url)   the pin inside a full link, or null
     isShortLink(url)     maps.app.goo.gl / goo.gl — pin hidden
     extractPins(text)    every readable pin in a text, in order,
                          + the Maps links that yielded none
     resolveUrl(url)      follow a short link to its pin:
                          stage 1 the direct follow (the browser
                          hands back the landing address when its
                          CORS rules allow), stage 2 the app's own
                          server door (resolveViaServer). Resolves
                          null when neither route answers — the
                          callers degrade honestly, never invent
                          a pin.
     rewriteText(text)    a text with each resolvable link
                          replaced IN PLACE by its "lat, lng"
                          pair, so the proven synchronous parsers
                          downstream see exactly the shape they
                          already read. Unresolvable links stay
                          verbatim — the record keeps the link.

   The server door: GET https://2.31.47.19/ai/resolve?url=<enc>
   on the Navigator's box (the meticulous-ai host of /ai/chat and
   /ai/powerread), carrying the same X-Meticulous-App turnstile
   token those doors use (read from PowerRead at call time — no
   third copy of the literal). Expected answer: JSON naming the
   landing address ({finalUrl} / {url}) or the pin itself
   ({lat, lng}). Probed Nov 7, 2026: the door does not exist yet
   (404) — the client ships ready, and until the endpoint lands,
   short links that the direct follow cannot open degrade to
   "link kept in the notes", exactly as specified.

   No pin ever leaves to Google Maps: resolution reads a
   redirect's landing address or the server's answer, and the
   pin itself is consumed by the app's own navigation hand-off. */
(function () {
  'use strict';

  var RESOLVE_ENDPOINT = 'https://2.31.47.19/ai/resolve?url=';
  var FETCH_TIMEOUT_MS = 8000;

  function validPair(la, ln) {
    return isFinite(la) && isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180 && !(la === 0 && ln === 0);
  }
  /* A "lat, lng" pair inside a URL: the comma is literal or
     %2C-escaped; 3+ decimals, the shape Google writes (@51.1252302,
     -113.9828043 / ?q=51.1252,-113.9828). Same reading contract as
     the Navigator's parseLatLngText / sentPinCoords (v101/v330). */
  function pairIn(s) {
    if (!s) return null;
    var m = String(s).match(/(-?\d{1,2}\.\d{3,})(?:,|%2C)\s*(-?\d{1,3}\.\d{3,})/i);
    if (!m) return null;
    var la = Number(m[1]), ln = Number(m[2]);
    return validPair(la, ln) ? { lat: la, lng: ln } : null;
  }
  function dataPairIn(s) {
    if (!s) return null;
    var m = String(s).match(/!3d(-?\d{1,2}\.\d+)[^!]*!4d(-?\d{1,3}\.\d+)/);
    if (!m) return null;
    var la = Number(m[1]), ln = Number(m[2]);
    return validPair(la, ln) ? { lat: la, lng: ln } : null;
  }
  function safeDecode(s) {
    try { return decodeURIComponent(String(s)); } catch (e) { return String(s); }
  }
  /* The pin inside ONE Maps link — the v330 precedence (a pair in
     the link is the view centre, which for a shared place link
     sits ON the place; the !3d/!4d data segment is read when no
     pair exists). */
  function coordsFromUrl(url) {
    if (!url) return null;
    var u = String(url);
    var p = pairIn(u);
    if (p) return p;
    var dec = safeDecode(u);
    p = dataPairIn(dec);
    if (p) return p;
    return pairIn(dec);
  }
  function hostOf(url) {
    var m = String(url || '').match(/^https?:\/\/([^\/:?#]+)/i);
    return m ? m[1].toLowerCase() : '';
  }
  function isMapsUrl(url) {
    var h = hostOf(url);
    if (!h) return false;
    if (h === 'maps.app.goo.gl' || h === 'goo.gl') return true;
    if (h.indexOf('maps.google') === 0) return true;
    if (h.indexOf('google.') !== -1 && /\/maps(\/|\?|#|$)/.test(String(url))) return true;
    return false;
  }
  function isShortLink(url) {
    var h = hostOf(url);
    return h === 'maps.app.goo.gl' || h === 'goo.gl';
  }
  /* The Maps links in a text, in order of appearance. Trailing
     sentence punctuation is not part of a link. */
  function findLinks(text) {
    var t = String(text == null ? '' : text);
    var out = [];
    var re = /https?:\/\/[^\s<>"'\)\]]+/g, m;
    while ((m = re.exec(t)) !== null) {
      var url = m[0].replace(/[.,;:]+$/, '');
      if (!isMapsUrl(url)) continue;
      out.push({ url: url, index: m.index, end: m.index + url.length });
    }
    return out;
  }

  function dmsToDec(d, mi, s, hemi) {
    var v = parseFloat(d) + parseFloat(mi) / 60 + parseFloat(s) / 3600;
    if (/[SW]/i.test(hemi)) v = -v;
    return isFinite(v) ? v : null;
  }
  var BARE_PAIR_RE = /(-?\d{2,3}\.\d{4,})[\s,]+(-?\d{2,3}\.\d{4,})/g;
  var DMS_RE = /(\d{1,3})°\s*(\d{1,2})'\s*([\d.]+)["”]?\s*([NS])[\s,]*(\d{1,3})°\s*(\d{1,2})'\s*([\d.]+)["”]?\s*([EW])/g;

  /* extractPins(text) -> { pins: [{lat, lng, index, via}],
     links: [{url, index}], unresolved: [url] }.
     Walks the text left to right: a Maps link contributes the pin
     inside it (via 'link'); the text between links contributes
     bare decimal pairs (via 'coords') and DMS pairs (via 'dms')
     — the two shapes TicketOCR.parseDispatch has always read.
     A pin within ~50 m of an earlier one is the same place said
     twice and is dropped. A Maps link with no readable pin is
     listed in `unresolved` — it is a pin the app could not read,
     never a pin invented. */
  function extractPins(text) {
    var t = String(text == null ? '' : text);
    var links = findLinks(t);
    var pins = [];
    function pushPin(la, ln, index, via) {
      if (!validPair(la, ln)) return;
      for (var i = 0; i < pins.length; i++) {
        if (Math.abs(pins[i].lat - la) < 0.0005 && Math.abs(pins[i].lng - ln) < 0.0005) return;
      }
      pins.push({ lat: la, lng: ln, index: index, via: via });
    }
    function scanGap(from, to) {
      if (to <= from) return;
      var seg = t.slice(from, to), m;
      BARE_PAIR_RE.lastIndex = 0;
      while ((m = BARE_PAIR_RE.exec(seg)) !== null) {
        pushPin(parseFloat(m[1]), parseFloat(m[2]), from + m.index, 'coords');
      }
      DMS_RE.lastIndex = 0;
      while ((m = DMS_RE.exec(seg)) !== null) {
        var la = dmsToDec(m[1], m[2], m[3], m[4]);
        var ln = dmsToDec(m[5], m[6], m[7], m[8]);
        if (la !== null && ln !== null) pushPin(la, ln, from + m.index, 'dms');
      }
    }
    var unresolved = [];
    var cursor = 0;
    links.forEach(function (L) {
      scanGap(cursor, L.index);
      var c = coordsFromUrl(L.url);
      if (c) pushPin(c.lat, c.lng, L.index, 'link');
      else unresolved.push(L.url);
      cursor = L.end;
    });
    scanGap(cursor, t.length);
    pins.sort(function (a, b) { return a.index - b.index; });
    return { pins: pins, links: links, unresolved: unresolved };
  }

  function fetchFn() {
    try { if (typeof fetch === 'function') return fetch; } catch (e) {}
    return (typeof window !== 'undefined' && window.fetch) || null;
  }
  function appToken() {
    try {
      if (typeof window !== 'undefined' && window.PowerRead && window.PowerRead.APP_TOKEN) return window.PowerRead.APP_TOKEN;
    } catch (e) {}
    return '';
  }
  function fetchWithTimeout(f, url, init) {
    var ctrl = null, timer = null;
    var opts = {};
    for (var k in (init || {})) { if (Object.prototype.hasOwnProperty.call(init, k)) opts[k] = init[k]; }
    try {
      if (typeof AbortController !== 'undefined') {
        ctrl = new AbortController();
        opts.signal = ctrl.signal;
        timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, FETCH_TIMEOUT_MS);
      }
    } catch (e) {}
    return f(url, opts).then(function (r) {
      if (timer) clearTimeout(timer);
      return r;
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }
  /* Stage 2 alone (the Navigator's door already runs its own
     stage 1 — see openSentPin): ask the app's server door to
     follow the link. Resolves {lat, lng} or null. */
  function resolveViaServer(url) {
    var f = fetchFn();
    if (!f) return Promise.resolve(null);
    var headers = {};
    var tok = appToken();
    if (tok) headers['X-Meticulous-App'] = tok;
    return fetchWithTimeout(f, RESOLVE_ENDPOINT + encodeURIComponent(String(url)), { headers: headers })
      .then(function (r) {
        if (!r || !r.ok) return null;
        return r.json().then(function (j) {
          if (!j || typeof j !== 'object') return null;
          var la = Number(j.lat), ln = Number(j.lng);
          if (validPair(la, ln)) return { lat: la, lng: ln };
          var fin = j.finalUrl || j.url || j.expanded || j.location || '';
          return fin ? coordsFromUrl(fin) : null;
        }, function () { return null; });
      })
      .catch(function () { return null; });
  }
  /* resolveUrl(url) -> Promise<{lat, lng} | null>: the pin inside
     the link when it carries one; otherwise follow it — stage 1
     the direct follow (its landing address), stage 2 the server
     door. Never rejects. */
  function resolveUrl(url) {
    var direct = coordsFromUrl(url);
    if (direct) return Promise.resolve(direct);
    var f = fetchFn();
    if (!f) return Promise.resolve(null);
    return fetchWithTimeout(f, String(url), { redirect: 'follow' })
      .then(function (r) {
        var c = (r && r.url) ? coordsFromUrl(r.url) : null;
        return c || resolveViaServer(url);
      })
      .catch(function () { return resolveViaServer(url); });
  }
  function fmtCoord(v) {
    return String(Math.round(v * 1e7) / 1e7);
  }
  /* rewriteText(text) -> Promise<string>: each Maps link that
     yields no pin locally is followed (at most 3); a resolved
     link is replaced in place by its "lat, lng" pair. A link that
     cannot be resolved stays exactly as written. Never rejects. */
  function rewriteText(text) {
    var t = String(text == null ? '' : text);
    var links = findLinks(t);
    var todo = [];
    links.forEach(function (L) { if (!coordsFromUrl(L.url)) todo.push(L); });
    if (!todo.length) return Promise.resolve(t);
    var out = t;
    var chain = Promise.resolve();
    todo.slice(0, 3).forEach(function (L) {
      chain = chain.then(function () {
        return resolveUrl(L.url).then(function (c) {
          if (c) out = out.split(L.url).join(fmtCoord(c.lat) + ', ' + fmtCoord(c.lng));
        });
      });
    });
    return chain.then(function () { return out; }, function () { return out; });
  }

  window.PinLinks = {
    RESOLVE_ENDPOINT: RESOLVE_ENDPOINT,
    coordsFromUrl: coordsFromUrl,
    isMapsUrl: isMapsUrl,
    isShortLink: isShortLink,
    findLinks: findLinks,
    extractPins: extractPins,
    resolveUrl: resolveUrl,
    resolveViaServer: resolveViaServer,
    rewriteText: rewriteText
  };
})();
